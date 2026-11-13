#!/usr/bin/env python3
"""Application tracker: the "Application Tracker" sheet inside Target_Company_List.xlsx (repo root, git-ignored).

The tracker is the source of truth for what was applied to. Append-only: rows are never deleted; `update`
changes cells of an existing row. Rows are deduped on Dedupe Key (the Main Database key, or
greenhouse|<slug>|<jobId> for roles that did not come from the Main Database).

Writes edit only this sheet's XML inside the .xlsx (every other sheet stays byte-identical). If Excel has the
workbook open (a "~$" lock file) the change is queued in data/tracker-pending.jsonl and applied by `flush`
(it also runs automatically before the next write) - close the workbook in Excel to let it through.

  scripts/py.sh scripts/tracker.py session-start          # new apply session (records the workbook's mtime)
  scripts/py.sh scripts/tracker.py add --key K --company C --title T [--status Queued] [...]
  scripts/py.sh scripts/tracker.py update --key K --status Applied --date-applied 2026-11-11 [...]
  scripts/py.sh scripts/tracker.py list [--status Applied]
  scripts/py.sh scripts/tracker.py keys
  scripts/py.sh scripts/tracker.py flush                  # apply queued changes
  scripts/py.sh scripts/tracker.py migrate --from Application_Tracker.xlsx   # one-off import of the old tracker
"""
import argparse
import datetime as dt
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xlsx_edit as X  # noqa: E402
from apply_common import DATA_DIR, TRACKER_PATH, parse_date, workbook_path  # noqa: E402

SHEET = X.TRACKER_SHEET
COLUMNS = X.COLUMNS
STATUSES = X.STATUSES
DATE_COLS = X.DATE_COLS
FOLLOW_UP_DAYS = 7
SESSION_FILE = os.path.join(DATA_DIR, 'apply-session.json')
PENDING_FILE = os.path.join(DATA_DIR, 'tracker-pending.jsonl')

FIELD_TO_COL = {
    'key': 'Dedupe Key', 'company': 'Company', 'title': 'Job Title', 'location': 'Location',
    'link': 'Careers Link', 'date_added': 'Date Added', 'date_queued': 'Date Queued',
    'variant': 'Resume Variant', 'cover_letter': 'Cover Letter (Y/N)', 'status': 'Status',
    'date_applied': 'Date Applied', 'confirmation': 'Confirmation', 'blocker': 'Blocker', 'notes': 'Notes',
}


# ---------------------------------------------------------------- session + backup
def _session():
    try:
        with open(SESSION_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_session(s):
    os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
    with open(SESSION_FILE, 'w') as f:
        json.dump(s, f, indent=2)


def session_start(path=TRACKER_PATH, workbook=None):
    """Start an apply session: remember the workbook's mtime (the write guard for tracker and write-back)."""
    wbp = workbook or path or workbook_path()
    s = {'started': dt.datetime.now().isoformat(timespec='seconds'), 'workbook': wbp,
         'workbook_mtime': os.path.getmtime(wbp) if os.path.exists(wbp) else None, 'tracker_backed_up': False}
    _save_session(s)
    return s


def _backup_once(path):
    """Back the workbook up before the first write of a session (or before every write if no session)."""
    if not os.path.exists(path):
        return None
    s = _session()
    if s.get('tracker_backed_up'):
        return None
    bdir = os.path.join(os.path.dirname(SESSION_FILE), 'backups')
    os.makedirs(bdir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(path))[0]
    dest = os.path.join(bdir, f'{stem}.' + dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '.xlsx')
    shutil.copyfile(path, dest)
    if s:
        s['tracker_backed_up'] = True
        _save_session(s)
    return dest


def _note_write(path):
    s = _session()
    if s and s.get('workbook') and os.path.abspath(s['workbook']) == os.path.abspath(path):
        s['workbook_mtime'] = os.path.getmtime(path)
        _save_session(s)


# ---------------------------------------------------------------- reading
def _read_sheet(path):
    """-> (sheet_xml or None, shared strings). Reads a temp copy so an open workbook never breaks a read."""
    import zipfile
    if not os.path.exists(path):
        return None, []
    tmp = X.temp_copy(path)
    try:
        with zipfile.ZipFile(tmp) as z:
            m = X.sheet_member(z, SHEET)
            return (z.read(m).decode('utf8') if m else None), X.shared_strings(z)
    finally:
        os.remove(tmp)


def list_rows(path=TRACKER_PATH, status=None):
    xml, sst = _read_sheet(path)
    if xml is None:
        return []
    rows = [v for _, v in X.tracker_rows(xml, sst)]
    return [r for r in rows if not status or r.get('Status') == status]


def keys(path=TRACKER_PATH):
    return {str(r['Dedupe Key']).strip().lower() for r in list_rows(path)}


# ---------------------------------------------------------------- writing
def _coerce(col, value):
    if value is None:
        return None
    if col in DATE_COLS:
        d = parse_date(value)
        if d is None:
            raise SystemExit(f'{col}: cannot read a date from {value!r}')
        return d
    if col == 'Status' and value not in STATUSES:
        raise SystemExit(f'Status must be one of {STATUSES}, got {value!r}')
    if col == 'Cover Letter (Y/N)' and value not in ('Y', 'N'):
        raise SystemExit('Cover Letter must be Y or N')
    return value


def _follow_up(row):
    if row.get('Date Applied') and not row.get('Follow-up Date'):
        row['Follow-up Date'] = parse_date(row['Date Applied']) + dt.timedelta(days=FOLLOW_UP_DAYS)


def _edit(path, ops):
    """Apply ops [('add', row) | ('update', key, changes)] in one rewrite. Returns the list of results."""
    results = []

    def mutate(parts):
        X.configure_styles(parts)
        member = X.sheet_member_from(parts.__getitem__, SHEET)
        if member is None:
            member = X.add_sheet_to_package(parts, SHEET, X.new_tracker_sheet_xml())
        xml = parts[member].decode('utf8')
        sst = X.shared_strings_from(parts.__getitem__)

        def index():
            return {str(v['Dedupe Key']).strip().lower(): (r, v) for r, v in X.tracker_rows(xml, sst)}

        idx = index()
        for op in ops:
            if op[0] == 'add':
                if str(op[1]['Dedupe Key']).strip().lower() in idx:
                    results.append('exists')
                    continue
                xml = X.append_row(xml, op[1])
                idx = index()
                results.append('added')
            else:
                _, key, changes = op
                k = key.strip().lower()
                if k not in idx:
                    results.append('missing')
                    continue
                row_number, row = idx[k]
                merged = dict(row, **changes)
                if 'Date Applied' in changes:
                    merged['Follow-up Date'] = None
                _follow_up(merged)
                xml = X.update_row(xml, row_number, dict(changes, **{'Follow-up Date': merged.get('Follow-up Date')}))
                idx = index()
                results.append('updated')
        parts[member] = xml.encode('utf8')

    X.rewrite_package(path, mutate)
    return results


def _queue_pending(op):
    os.makedirs(os.path.dirname(PENDING_FILE), exist_ok=True)
    with open(PENDING_FILE, 'a') as f:
        f.write(json.dumps(op, default=str) + '\n')


def _load_pending():
    try:
        with open(PENDING_FILE) as f:
            return [json.loads(line) for line in f if line.strip()]
    except OSError:
        return []


def _decode(op):
    if op[0] == 'add':
        return ('add', {c: (_coerce(c, v) if v not in (None, '') else None) for c, v in op[1].items()})
    return ('update', op[1], {c: _coerce(c, v) for c, v in op[2].items()})


def _write(path, ops):
    """Run ops through the guards. Returns results, or None if blocked (ops are queued for later)."""
    pending = [_decode(o) for o in _load_pending()]
    all_ops = pending + list(ops)
    try:
        X.check_guards(path, _session())
    except X.Blocked as e:
        for o in ops:
            _queue_pending(o)
        print(f'Tracker write queued, not lost: {e}\n'
              f'Close the workbook in Excel, then run: scripts/py.sh scripts/tracker.py flush', file=sys.stderr)
        return None
    _backup_once(path)
    res = _edit(path, all_ops)
    if pending and os.path.exists(PENDING_FILE):
        os.remove(PENDING_FILE)
    _note_write(path)
    return res[len(pending):]


def add(fields, path=TRACKER_PATH):
    """Append one row. Returns 'added' or 'exists' (dedupe on Dedupe Key; existing rows are untouched)."""
    row = {FIELD_TO_COL[k]: _coerce(FIELD_TO_COL[k], v) for k, v in fields.items() if v is not None}
    key = str(row.get('Dedupe Key') or '').strip()
    if not key:
        raise SystemExit('add needs --key (Dedupe Key)')
    row['Dedupe Key'] = key
    row.setdefault('Status', 'Queued')
    row.setdefault('Date Queued', dt.date.today())
    _follow_up(row)
    if key.lower() in keys(path):
        return 'exists'
    res = _write(path, [('add', row)])
    return 'queued' if res is None else res[0]


def update(key, fields, path=TRACKER_PATH):
    """Change cells of the row with this Dedupe Key. Never deletes. Returns 'updated', 'missing' or 'queued'."""
    changes = {FIELD_TO_COL[k]: _coerce(FIELD_TO_COL[k], v) for k, v in fields.items() if v is not None and k != 'key'}
    if key.strip().lower() not in keys(path) and not any(
            o[0] == 'add' and str(o[1].get('Dedupe Key', '')).strip().lower() == key.strip().lower() for o in _load_pending()):
        return 'missing'
    res = _write(path, [('update', key, changes)])
    return 'queued' if res is None else res[0]


def add_many(rows, path=TRACKER_PATH):
    """rows: list of {column name: value}. One rewrite, one backup. Returns {'added': n, 'exists': n}."""
    ops = []
    for r in rows:
        row = {c: _coerce(c, v) for c, v in r.items() if c in COLUMNS and v not in (None, '')}
        row.setdefault('Status', 'Queued')
        _follow_up(row)
        ops.append(('add', row))
    res = _write(path, ops)
    if res is None:
        return {'queued': len(ops)}
    return {'added': res.count('added'), 'exists': res.count('exists')}


def flush(path=TRACKER_PATH):
    pending = _load_pending()
    if not pending:
        return 0
    res = _write(path, [])
    return len(pending) if res is not None else 0


def migrate(src, path=TRACKER_PATH):
    """One-off import of the old standalone Application_Tracker.xlsx (sheet "Applications") into the workbook."""
    import openpyxl
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    ws = wb['Applications']
    hdr = [c for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0]:
            rows.append(dict(zip(hdr, r)))
    return add_many(rows, path), len(rows)


def _fmt(v):
    if isinstance(v, dt.datetime):
        v = v.date()
    return v.isoformat() if isinstance(v, dt.date) else ('' if v is None else str(v))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--workbook', default=None, help='override the workbook (default: $JOB_WORKBOOK or repo Target_Company_List.xlsx)')
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('add', 'update'):
        s = sub.add_parser(name)
        s.add_argument('--key', required=True)
        for f in FIELD_TO_COL:
            if f != 'key':
                s.add_argument('--' + f.replace('_', '-'), dest=f)
    ls = sub.add_parser('list')
    ls.add_argument('--status', choices=STATUSES)
    sub.add_parser('keys')
    sub.add_parser('session-start')
    sub.add_parser('flush')
    mg = sub.add_parser('migrate')
    mg.add_argument('--from', dest='src', required=True)
    a = p.parse_args(argv)
    path = a.workbook or workbook_path()
    if a.cmd == 'add':
        print(add({k: getattr(a, k) for k in FIELD_TO_COL}, path), a.key)
    elif a.cmd == 'update':
        res = update(a.key, {k: getattr(a, k) for k in FIELD_TO_COL if k != 'key'}, path)
        print(res, a.key)
        if res == 'missing':
            sys.exit(1)
    elif a.cmd == 'list':
        rows = list_rows(path, a.status)
        for r in rows:
            print(' | '.join(_fmt(r.get(c)) for c in ('Status', 'Date Applied', 'Company', 'Job Title', 'Follow-up Date', 'Dedupe Key')))
        print(f'{len(rows)} row(s)')
    elif a.cmd == 'keys':
        for k in sorted(keys(path)):
            print(k)
    elif a.cmd == 'session-start':
        print(json.dumps(session_start(path), indent=2))
    elif a.cmd == 'flush':
        print(f'applied {flush(path)} queued change(s)')
    elif a.cmd == 'migrate':
        res, n = migrate(a.src, path)
        print(f'migrated {n} row(s): {res}')


if __name__ == '__main__':
    main()
