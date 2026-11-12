"""Shared helpers for the apply side (queue builder, tracker, write-back).

The discovery side (a scheduled task) owns the workbook. This repo only READS it, except for the
guarded write-back in scripts/writeback.py. Sheets used: "Target List", "Careers Sources", "Main Database".
"""
import datetime as dt
import os
import re
import shutil
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DEFAULT_WORKBOOK = os.path.join(os.path.expanduser('~'), 'Documents', 'Job:Internship Search', 'Target_Company_List.xlsx')
TRACKER_PATH = os.environ.get('APPLY_TRACKER', os.path.join(ROOT, 'Application_Tracker.xlsx'))
DATA_DIR = os.path.join(ROOT, 'data')

MAIN_DB = 'Main Database'
CAREERS = 'Careers Sources'
TARGETS = 'Target List'
REQUIRED_HEADERS = ('Company', 'Job Title', 'Date Added', 'Status', 'Dedupe Key')

MONTHS = {m: i for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}


def workbook_path():
    return os.environ.get('JOB_WORKBOOK', DEFAULT_WORKBOOK)


def lock_path(path):
    d, b = os.path.split(path)
    return os.path.join(d, '~$' + b)


def temp_copy(path):
    """Copy the workbook to a temp file so an open or locked original never breaks a read."""
    if not os.path.exists(path):
        raise SystemExit(f'Workbook not found: {path}\nSet JOB_WORKBOOK to its location.')
    fd, tmp = tempfile.mkstemp(suffix='.xlsx', prefix='apply-read-')
    os.close(fd)
    shutil.copyfile(path, tmp)
    return tmp


def find_header(ws, required=REQUIRED_HEADERS, max_scan=15):
    """Return (header_row_number, {header_name: column_index_0_based}) by header names, never letters."""
    for r_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=max_scan, values_only=True), 1):
        names = [str(c).strip() if c is not None else '' for c in row]
        if all(h in names for h in required):
            return r_idx, {n: i for i, n in enumerate(names) if n}
    raise SystemExit(f'Header row with {required} not found in sheet "{ws.title}".')


def parse_date(value, today=None):
    """Real dates pass through; text dates ('Nov 13, 2026', '2026-11-12', '11/12/2026') are parsed.
    Returns a date or None."""
    if value is None or value == '':
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    dates = all_text_dates(str(value))
    return dates[0] if dates else None


def all_text_dates(text):
    """Every date found in free text, in order of appearance."""
    s = str(text)
    found = []
    pats = [
        (r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b', lambda m: (int(m[1]), int(m[2]), int(m[3]))),
        (r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b', lambda m: (int(m[3]), int(m[1]), int(m[2]))),
        (r'\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b',
         lambda m: (int(m[3]), MONTHS.get(m[1][:3].lower()), int(m[2]))),
    ]
    for pat, conv in pats:
        for m in re.finditer(pat, s):
            y, mo, d = conv(m)
            if not mo:
                continue
            try:
                found.append((m.start(), dt.date(y, mo, d)))
            except ValueError:
                pass
    return [d for _, d in sorted(found)]


def norm_company(name):
    s = str(name or '').lower()
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    s = re.sub(r'\b(inc|llc|lp|ltd|the|group|co|corp|company)\b', ' ', s)
    return ' '.join(s.split())
