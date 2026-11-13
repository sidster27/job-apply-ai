#!/usr/bin/env python3
"""Guarded write-back: set Status and Date Applied in the live workbook's "Main Database".

  scripts/py.sh scripts/writeback.py --dry-run     # show what would change
  scripts/py.sh scripts/writeback.py               # write (only if every guard passes)

For each tracker row with Status Applied or Skipped whose Dedupe Key is in Main Database and whose sheet
Status is still New / Interested / blank, it sets Status ("Applied" or "Skip") and, for Applied, Date Applied.
It never touches any other cell, row or sheet.

Guards (any one -> do nothing and say why; the tracker alone is enough):
  - "~$Target_Company_List.xlsx" exists (the workbook is open in Excel)
  - the workbook's mtime differs from the one recorded at session start (data/apply-session.json,
    written by `tracker.py session-start`), or changes while this script runs
Back up first: Target_Company_List.backup-apply-YYYY-MM-DD.xlsx next to the workbook.

Why XML instead of openpyxl: re-saving with openpyxl drops features it does not support (e.g. x14 data
validations), so only the Main Database sheet XML is edited and every other zip member is copied byte for
byte. Formatting, validation, conditional formats, autofilter and fullCalcOnLoad are kept.
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xlsx_edit as X  # noqa: E402
from apply_common import MAIN_DB, TRACKER_PATH, lock_path, parse_date, workbook_path  # noqa: E402
import tracker  # noqa: E402

STATUS_MAP = {'Applied': 'Applied', 'Skipped': 'Skip'}
OVERWRITABLE = {'', 'new', 'interested'}
NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


Blocked = X.Blocked
col_letter, col_number, excel_serial = X.col_letter, X.col_number, X.excel_serial
_row_cells, _set_cell, _style = X.row_cells, X.set_cell, X.style_attr
_cell_value = X.cell_value


def _sheet_member(z, name):
    m = X.sheet_member(z, name)
    if m is None:
        raise SystemExit(f'Sheet "{name}" not found in the workbook.')
    return m


def _shared_strings(z):
    return X.shared_strings(z)


def plan_changes(workbook, tracker_path=TRACKER_PATH):
    """-> (changes, sheet_member). changes: [{row, key, status, date}] for cells that actually change."""
    want = {}
    for r in tracker.list_rows(tracker_path):
        st = STATUS_MAP.get(r.get('Status'))
        if st:
            want[str(r['Dedupe Key']).strip().lower()] = (st, parse_date(r.get('Date Applied')) if st == 'Applied' else None)
    with zipfile.ZipFile(workbook) as z:
        member = _sheet_member(z, MAIN_DB)
        sst = _shared_strings(z)
        xml = z.read(member).decode('utf8')
    header, H = None, None
    changes = []
    for m in re.finditer(r'<row\b[^>]*\br="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        rnum = int(m.group(1))
        cells = _row_cells(m.group(2))
        vals = {c: _cell_value(a, i, sst) for c, (_, a, i) in cells.items()}
        if header is None:
            names = {str(v).strip(): c for c, v in vals.items() if v is not None}
            if all(h in names for h in ('Dedupe Key', 'Status', 'Date Applied')):
                header, H = rnum, names
            continue
        key = str(vals.get(H['Dedupe Key']) or '').strip().lower()
        if key not in want:
            continue
        cur = str(vals.get(H['Status']) or '').strip()
        if cur.lower() not in OVERWRITABLE:
            continue
        st, d = want[key]
        changes.append({'row': rnum, 'key': key, 'from': cur, 'status': st, 'date': d.isoformat() if d else None})
    if header is None:
        raise SystemExit('Main Database header row (Dedupe Key / Status / Date Applied) not found.')
    return changes, member, H


def apply_changes(xml, changes, H):
    status_col, date_col = H['Status'], H['Date Applied']
    by_row = {c['row']: c for c in changes}

    def fix_row(m):
        rnum = int(m.group(1))
        if rnum not in by_row:
            return m.group(0)
        ch = by_row[rnum]
        row_xml = m.group(0)
        cells = _row_cells(row_xml)
        row_xml = _set_cell(row_xml, rnum, status_col,
                            lambda s, ref: f'<c r="{ref}"{s} t="inlineStr"><is><t>{escape(ch["status"])}</t></is></c>', cells)
        if ch['date']:
            cells = _row_cells(row_xml)
            serial = excel_serial(dt.date.fromisoformat(ch['date']))
            # A missing Date Applied cell borrows the row's Date Added style so it displays as a date.
            fallback = _style(cells[H['Date Added']][1]) if 'Date Added' in H and H['Date Added'] in cells else ''
            row_xml = _set_cell(row_xml, rnum, date_col,
                                lambda s, ref: f'<c r="{ref}"{s or fallback}><v>{serial}</v></c>', cells)
        return row_xml

    return re.sub(r'<row\b[^>]*\br="(\d+)"[^>]*>.*?</row>', fix_row, xml, flags=re.S)


def check_guards(workbook, session):
    if os.path.exists(lock_path(workbook)):
        raise Blocked(f'{os.path.basename(lock_path(workbook))} exists: the workbook is open in Excel.')
    base = (session or {}).get('workbook_mtime')
    if base is None or os.path.abspath(session.get('workbook', '')) != os.path.abspath(workbook):
        raise Blocked('No apply session recorded for this workbook (run tracker.py session-start at the start).')
    if abs(os.path.getmtime(workbook) - base) > 1e-6:
        raise Blocked('The workbook changed during the session (mtime differs): another task may be writing it.')
    return base


def writeback(workbook, tracker_path=TRACKER_PATH, session=None, dry_run=False, today=None):
    """Returns (changes, message). Raises Blocked when a guard fails (nothing is written)."""
    session = session if session is not None else tracker._session()
    base = check_guards(workbook, session)
    changes, member, H = plan_changes(workbook, tracker_path)
    if dry_run or not changes:
        return changes, 'dry run' if dry_run else 'nothing to change'
    today = today or dt.date.today()
    backup = os.path.join(os.path.dirname(workbook),
                          f'{os.path.splitext(os.path.basename(workbook))[0]}.backup-apply-{today.isoformat()}.xlsx')
    if not os.path.exists(backup):
        shutil.copy2(workbook, backup)
    fd, tmp = tempfile.mkstemp(suffix='.xlsx', dir=os.path.dirname(workbook), prefix='.writeback-')
    os.close(fd)
    try:
        with zipfile.ZipFile(workbook) as src, zipfile.ZipFile(tmp, 'w') as dst:
            for info in src.infolist():
                data = src.read(info.filename)
                if info.filename == member:
                    data = apply_changes(data.decode('utf8'), changes, H).encode('utf8')
                dst.writestr(info, data)
        check_guards(workbook, dict(session, workbook_mtime=base))  # re-check right before replacing
        os.replace(tmp, workbook)
        session = dict(session, workbook_mtime=os.path.getmtime(workbook))
        try:
            tracker._save_session(session)
        except OSError:
            pass
        return changes, f'written; backup {backup}'
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--workbook', default=workbook_path())
    p.add_argument('--tracker', default=TRACKER_PATH)
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args(argv)
    try:
        changes, msg = writeback(a.workbook, a.tracker, dry_run=a.dry_run)
    except Blocked as e:
        print('Write-back skipped:', e)
        print('Nothing was written. The Application Tracker sheet remains the record.')
        return 2
    for c in changes:
        print(f'  row {c["row"]}: {c["key"]}  Status {c["from"] or "(blank)"} -> {c["status"]}'
              + (f', Date Applied {c["date"]}' if c['date'] else ''))
    print(f'{len(changes)} row(s); {msg}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
