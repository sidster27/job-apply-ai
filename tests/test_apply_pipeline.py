"""Tests for the apply side: queue order, eligibility, tracker, write-back guard. Fake fixture data only.

Run: scripts/py.sh -m unittest discover -s tests -p 'test_*.py'   (also part of `npm test`)
"""
import datetime as dt
import importlib.util
import os
import sys
import tempfile
import time
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
sys.path.insert(0, os.path.join(HERE, 'fixtures'))

import apply_common  # noqa: E402
import make_workbook  # noqa: E402
import tracker  # noqa: E402
import writeback  # noqa: E402

spec = importlib.util.spec_from_file_location('build_apply_queue', os.path.join(ROOT, 'scripts', 'build-apply-queue.py'))
bq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bq)

TODAY = dt.date(2026, 11, 11)
GRAD = dt.date(2027, 5, 1)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        self.wb = make_workbook.make(os.path.join(d, 'Target_Company_List.xlsx'))
        self.tr = os.path.join(d, 'Application_Tracker.xlsx')
        # keep tracker backups / session inside the temp dir
        self._saved = (tracker.DATA_DIR, tracker.SESSION_FILE)
        tracker.DATA_DIR = os.path.join(d, 'data')
        tracker.SESSION_FILE = os.path.join(d, 'data', 'apply-session.json')
        tracker.add({'key': 'kappa|10', 'company': 'Kappa Holdings', 'title': 'Analyst', 'status': 'Applied',
                     'date_applied': '2026-11-11'}, path=self.tr)

    def tearDown(self):
        tracker.DATA_DIR, tracker.SESSION_FILE = self._saved
        self.tmp.cleanup()

    def queue(self, **kw):
        return bq.build(self.wb, self.tr, today=TODAY, grad=GRAD, **kw)


class QueueOrder(Base):
    def test_newest_first_ties_by_row_descending(self):
        q = [x['dedupeKey'] for x in self.queue()['queue']]
        # Nov 12: gamma (row 5) before beta (row 4, text date); then Nov 10 alpha; then Nov 9 iota
        self.assertEqual(q, ['gamma|3', 'beta|2', 'alpha|1', 'iota|9'])

    def test_order_ignores_fit_and_deadline(self):
        q = self.queue()['queue']
        self.assertEqual(q[-1]['dedupeKey'], 'iota|9')  # closing soonest, still last by Date Added
        self.assertEqual([x['rank'] for x in q], [1, 2, 3, 4])

    def test_closing_within_7_days_listed_separately(self):
        r = self.queue()
        ranks = r['closingWithin7Days']
        self.assertEqual([x['dedupeKey'] for x in r['queue'] if x['rank'] in ranks], ['iota|9'])


class Eligibility(Base):
    def reasons(self, **kw):
        return {e['company']: e['reason'] for e in self.queue(**kw)['excluded']}

    def test_filters(self):
        r = self.reasons()
        self.assertIn('deadline passed', r['Delta Bank'])
        self.assertEqual(r['Epsilon AM'], 'closed/removed')
        self.assertIn('fit Low', r['Zeta Group'])
        self.assertIn('status Applied', r['Eta Advisors'])
        self.assertIn('user-driven', r['Theta Capital'])

    def test_include_low(self):
        keys = [x['dedupeKey'] for x in self.queue(include_low=True)['queue']]
        self.assertIn('zeta|6', keys)

    def test_dedupe_against_tracker(self):
        self.assertEqual(self.reasons()['Kappa Holdings'], 'already in tracker')

    def test_blockers(self):
        q = {x['dedupeKey']: x for x in self.queue()['queue']}
        self.assertTrue(any('class-year' in b for b in q['iota|9']['blockers']))
        self.assertTrue(any('account needed' in b for b in q['gamma|3']['blockers']))      # Workday URL
        self.assertTrue(any('Workday' in b for b in q['beta|2']['blockers']))              # via Careers Sources
        self.assertEqual(q['alpha|1']['route'], 'auto-fill-with-approval')

    def test_deadline_text_uses_last_date(self):
        d, passed, not_open = bq.deadline_info('Opens Dec 15, 2026; window to Jan 16, 2027', TODAY)
        self.assertEqual(d, dt.date(2027, 1, 16))
        self.assertFalse(passed)
        self.assertTrue(not_open)
        self.assertEqual(bq.deadline_info('Rolling', TODAY), (None, False, False))

    def test_header_found_by_name_not_letter(self):
        import openpyxl
        ws = openpyxl.load_workbook(self.wb)['Main Database']
        row, H = apply_common.find_header(ws)
        self.assertEqual(row, 2)
        self.assertEqual(H['Dedupe Key'], 21)


class Tracker(Base):
    def test_append_and_dedupe(self):
        self.assertEqual(tracker.add({'key': 'new|1', 'company': 'N', 'title': 'T'}, path=self.tr), 'added')
        self.assertEqual(tracker.add({'key': 'NEW|1', 'company': 'dup', 'title': 'dup'}, path=self.tr), 'exists')
        rows = tracker.list_rows(self.tr)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]['Status'], 'Queued')

    def test_update_never_deletes_and_sets_follow_up(self):
        tracker.add({'key': 'new|1', 'company': 'N', 'title': 'T'}, path=self.tr)
        self.assertEqual(tracker.update('new|1', {'status': 'Applied', 'date_applied': '2026-11-11'}, path=self.tr), 'updated')
        self.assertEqual(tracker.update('missing|0', {'status': 'Applied'}, path=self.tr), 'missing')
        rows = {r['Dedupe Key']: r for r in tracker.list_rows(self.tr)}
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows['new|1']['Status'], 'Applied')
        self.assertEqual(rows['new|1']['Follow-up Date'].date(), dt.date(2026, 11, 18))
        self.assertEqual(rows['kappa|10']['Company'], 'Kappa Holdings')

    def test_backup_before_first_write_of_session(self):
        tracker.session_start(path=self.tr, workbook=self.wb)
        tracker.add({'key': 'b|1', 'company': 'B', 'title': 'T'}, path=self.tr)
        tracker.add({'key': 'b|2', 'company': 'B', 'title': 'T'}, path=self.tr)
        backups = os.listdir(os.path.join(tracker.DATA_DIR, 'backups'))
        self.assertEqual(len(backups), 1)


class WriteBack(Base):
    def session(self):
        return {'workbook': self.wb, 'workbook_mtime': os.path.getmtime(self.wb)}

    def test_blocked_by_lock_file(self):
        s = self.session()
        open(apply_common.lock_path(self.wb), 'w').close()
        with open(self.wb, "rb") as f:
            before = f.read()
        with self.assertRaises(writeback.Blocked):
            writeback.writeback(self.wb, self.tr, session=s, today=TODAY)
        with open(self.wb, "rb") as f:
            self.assertEqual(f.read(), before)

    def test_blocked_when_mtime_changed(self):
        s = self.session()
        os.utime(self.wb, (time.time() + 60, time.time() + 60))
        with self.assertRaises(writeback.Blocked):
            writeback.writeback(self.wb, self.tr, session=s, today=TODAY)

    def test_blocked_without_session(self):
        with self.assertRaises(writeback.Blocked):
            writeback.writeback(self.wb, self.tr, session={}, today=TODAY)

    def test_only_status_and_date_cells_change(self):
        import openpyxl
        before_zip = zipfile.ZipFile(self.wb)
        before = {n: before_zip.read(n) for n in before_zip.namelist()}
        member = writeback._sheet_member(before_zip, 'Main Database')
        before_zip.close()
        old = [[c.value for c in r] for r in openpyxl.load_workbook(self.wb)['Main Database'].iter_rows()]

        changes, msg = writeback.writeback(self.wb, self.tr, session=self.session(), today=TODAY)
        self.assertEqual([(c['row'], c['status'], c['date']) for c in changes], [(12, 'Applied', '2026-11-11')])
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, 'Target_Company_List.backup-apply-2026-11-11.xlsx')))

        after_zip = zipfile.ZipFile(self.wb)
        for n, data in before.items():
            if n != member:
                self.assertEqual(after_zip.read(n), data, n)   # every other member byte-identical
        after_zip.close()
        wb = openpyxl.load_workbook(self.wb)
        new = [[c.value for c in r] for r in wb['Main Database'].iter_rows()]
        diffs = [(r, c) for r in range(len(old)) for c in range(len(old[r])) if old[r][c] != new[r][c]]
        self.assertEqual(diffs, [(11, 18), (11, 19)])          # row 12: Status (S) and Date Applied (T) only
        self.assertEqual(new[11][18], 'Applied')
        self.assertEqual(new[11][19].date(), dt.date(2026, 11, 11))
        self.assertEqual(len(wb['Main Database'].data_validations.dataValidation), 1)
        self.assertEqual(wb['Main Database'].auto_filter.ref, 'A2:V12')

    def test_does_not_overwrite_progressed_status(self):
        tracker.add({'key': 'eta|7', 'company': 'Eta', 'title': 'T', 'status': 'Applied',
                     'date_applied': '2026-11-11'}, path=self.tr)
        changes, _ = writeback.plan_changes(self.wb, self.tr)[0], None
        self.assertNotIn('eta|7', [c['key'] for c in changes])  # sheet already says Applied


if __name__ == '__main__':
    unittest.main()
