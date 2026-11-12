#!/usr/bin/env python3
"""Application tracker: Application_Tracker.xlsx (repo root, git-ignored), sheet "Applications".

The tracker is the source of truth for what was applied to. Append-only: rows are never deleted;
`update` changes cells of an existing row. Rows are deduped on Dedupe Key (the Main Database key,
or greenhouse|<slug>|<jobId> for roles that did not come from the Main Database).

  scripts/py.sh scripts/tracker.py session-start          # new apply session (backup + workbook mtime)
  scripts/py.sh scripts/tracker.py add --key K --company C --title T [--status Queued] [...]
  scripts/py.sh scripts/tracker.py update --key K --status Applied --date-applied 2026-11-11 [...]
  scripts/py.sh scripts/tracker.py list [--status Applied]
  scripts/py.sh scripts/tracker.py keys
"""
import argparse
import datetime as dt
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply_common import DATA_DIR, TRACKER_PATH, parse_date, workbook_path  # noqa: E402

SHEET = 'Applications'
COLUMNS = ['Dedupe Key', 'Company', 'Job Title', 'Location', 'Careers Link', 'Date Added', 'Date Queued',
           'Resume Variant', 'Cover Letter (Y/N)', 'Status', 'Date Applied', 'Confirmation', 'Blocker',
           'Follow-up Date', 'Notes']
STATUSES = ['Queued', 'Drafted', 'Approved', 'Applied', 'Skipped', 'Blocked', 'Closed']
DATE_COLS = {'Date Added', 'Date Queued', 'Date Applied', 'Follow-up Date'}
FOLLOW_UP_DAYS = 7
SESSION_FILE = os.path.join(DATA_DIR, 'apply-session.json')

FIELD_TO_COL = {
    'key': 'Dedupe Key', 'company': 'Company', 'title': 'Job Title', 'location': 'Location',
    'link': 'Careers Link', 'date_added': 'Date Added', 'date_queued': 'Date Queued',
    'variant': 'Resume Variant', 'cover_letter': 'Cover Letter (Y/N)', 'status': 'Status',
    'date_applied': 'Date Applied', 'confirmation': 'Confirmation', 'blocker': 'Blocker', 'notes': 'Notes',
}


def _openpyxl():
    import openpyxl
    return openpyxl


def _new_book():
    openpyxl = _openpyxl()
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.worksheet.datavalidation import DataValidation
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET
    ws.append(COLUMNS)
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor='1F3864')
        c.alignment = Alignment(wrap_text=True, vertical='center')
    widths = [34, 22, 40, 22, 40, 12, 12, 26, 10, 11, 12, 34, 30, 12, 50]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
    ws.freeze_panes = 'B2'
    dv = DataValidation(type='list', formula1='"' + ','.join(STATUSES) + '"', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add('J2:J5000')
    ws.auto_filter.ref = 'A1:O1'
    return wb


def _load(path=TRACKER_PATH, create=False):
    openpyxl = _openpyxl()
    if not os.path.exists(path):
        if not create:
            return None
        return _new_book()
    return openpyxl.load_workbook(path)


def _rows(ws):
    hdr = [c.value for c in ws[1]]
    idx = {h: i for i, h in enumerate(hdr) if h}
    for r in range(2, ws.max_row + 1):
        key = ws.cell(r, idx['Dedupe Key'] + 1).value
        if key:
            yield r, {h: ws.cell(r, i + 1).value for h, i in idx.items()}


def keys(path=TRACKER_PATH):
    wb = _load(path)
    if wb is None:
        return set()
    return {str(row['Dedupe Key']).strip().lower() for _, row in _rows(wb[SHEET])}


def list_rows(path=TRACKER_PATH, status=None):
    wb = _load(path)
    if wb is None:
        return []
    out = [row for _, row in _rows(wb[SHEET])]
    return [r for r in out if not status or r.get('Status') == status]


def _session():
    try:
        with open(SESSION_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_session(s):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SESSION_FILE, 'w') as f:
        json.dump(s, f, indent=2)


def session_start(path=TRACKER_PATH, workbook=None):
    """Start an apply session: remember the workbook's mtime (for the write-back guard)."""
    wbp = workbook or workbook_path()
    s = {'started': dt.datetime.now().isoformat(timespec='seconds'),
         'workbook': wbp,
         'workbook_mtime': os.path.getmtime(wbp) if os.path.exists(wbp) else None,
         'tracker_backed_up': False}
    _save_session(s)
    return s


def _backup_once(path):
    """Back up the tracker before the first write of a session (or every write if no session)."""
    if not os.path.exists(path):
        return None
    s = _session()
    if s.get('tracker_backed_up'):
        return None
    bdir = os.path.join(DATA_DIR, 'backups')
    os.makedirs(bdir, exist_ok=True)
    dest = os.path.join(bdir, 'Application_Tracker.' + dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '.xlsx')
    shutil.copyfile(path, dest)
    if s:
        s['tracker_backed_up'] = True
        _save_session(s)
    return dest


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


def _write_cell(ws, r, col_idx, col, value):
    c = ws.cell(r, col_idx, value)
    if col in DATE_COLS and value is not None:
        c.number_format = 'yyyy-mm-dd'


def _apply_follow_up(row):
    if row.get('Date Applied') and not row.get('Follow-up Date'):
        row['Follow-up Date'] = parse_date(row['Date Applied']) + dt.timedelta(days=FOLLOW_UP_DAYS)


def add(fields, path=TRACKER_PATH):
    """Append one row. Returns 'added' or 'exists' (dedupe on Dedupe Key; existing rows are untouched)."""
    row = {FIELD_TO_COL[k]: _coerce(FIELD_TO_COL[k], v) for k, v in fields.items() if v is not None}
    key = str(row.get('Dedupe Key') or '').strip()
    if not key:
        raise SystemExit('add needs --key (Dedupe Key)')
    row['Dedupe Key'] = key
    row.setdefault('Status', 'Queued')
    row.setdefault('Date Queued', dt.date.today())
    _apply_follow_up(row)
    if key.lower() in keys(path):
        return 'exists'
    _backup_once(path)
    wb = _load(path, create=True)
    ws = wb[SHEET]
    r = ws.max_row + 1
    for i, col in enumerate(COLUMNS, 1):
        _write_cell(ws, r, i, col, row.get(col))
    wb.save(path)
    return 'added'


def update(key, fields, path=TRACKER_PATH):
    """Change cells of the row with this Dedupe Key. Never deletes. Returns 'updated' or 'missing'."""
    wb = _load(path)
    if wb is None:
        return 'missing'
    ws = wb[SHEET]
    hdr = {c.value: i + 1 for i, c in enumerate(ws[1]) if c.value}
    for r, row in _rows(ws):
        if str(row['Dedupe Key']).strip().lower() == key.strip().lower():
            changes = {FIELD_TO_COL[k]: _coerce(FIELD_TO_COL[k], v) for k, v in fields.items()
                       if v is not None and k != 'key'}
            merged = dict(row, **changes)
            if 'Date Applied' in changes:
                merged['Follow-up Date'] = None
            _apply_follow_up(merged)
            changes['Follow-up Date'] = merged.get('Follow-up Date')
            _backup_once(path)
            for col, val in changes.items():
                _write_cell(ws, r, hdr[col], col, val)
            wb.save(path)
            return 'updated'
    return 'missing'


def _fmt(v):
    if isinstance(v, dt.datetime):
        v = v.date()
    return v.isoformat() if isinstance(v, dt.date) else ('' if v is None else str(v))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
    a = p.parse_args(argv)
    if a.cmd == 'add':
        fields = {k: getattr(a, k) for k in FIELD_TO_COL}
        print(add(fields), a.key)
    elif a.cmd == 'update':
        fields = {k: getattr(a, k) for k in FIELD_TO_COL if k != 'key'}
        res = update(a.key, fields)
        print(res, a.key)
        if res == 'missing':
            sys.exit(1)
    elif a.cmd == 'list':
        rows = list_rows(status=a.status)
        for r in rows:
            print(' | '.join(_fmt(r.get(c)) for c in ('Status', 'Date Applied', 'Company', 'Job Title', 'Follow-up Date', 'Dedupe Key')))
        print(f'{len(rows)} row(s)')
    elif a.cmd == 'keys':
        for k in sorted(keys()):
            print(k)
    elif a.cmd == 'session-start':
        print(json.dumps(session_start(), indent=2))


if __name__ == '__main__':
    main()
