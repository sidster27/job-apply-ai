#!/usr/bin/env python3
"""Build the apply queue from the live workbook's "Main Database" (read-only).

  scripts/py.sh scripts/build-apply-queue.py [--top 10] [--include-low] [--workbook PATH] [--json-only]

Eligible: Status New / Interested / blank; Fit High or Medium (Low with --include-low); Verification not
closed/removed; deadline not passed; Dedupe Key not already in the workbook's Application Tracker sheet; route not
user-driven (LinkedIn, Handshake, Indeed, Glassdoor, ZipRecruiter -> you apply yourself).

ORDER (strict): Date Added newest first, ties broken by sheet row number descending. Never reordered by
fit or deadline. "Closing within 7 days" is printed separately so you can decide.

Writes data/apply-queue.json. The workbook is read through a temp copy and never modified here.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply_common import (CAREERS, DATA_DIR, MAIN_DB, MONTHS, ROOT, TRACKER_PATH, all_text_dates,  # noqa: E402
                          find_header, norm_company, parse_date, temp_copy, workbook_path)
import tracker  # noqa: E402

OK_STATUS = {'', 'new', 'interested'}
CLOSING_DAYS = 7


def grad_date_from_profile(path=os.path.join(ROOT, 'config', 'profile.json')):
    """Graduation (month, year) of the master's degree in profile.json. Missing -> stop and ask the user."""
    try:
        with open(path) as f:
            prof = json.load(f)
    except (OSError, ValueError):
        raise SystemExit('config/profile.json is missing or unreadable: ask Siddharth for his graduation date.')
    eds = prof.get('education') or []
    ed = next((e for e in eds if 'master' in str(e.get('degree', '')).lower()), eds[0] if eds else None)
    if not ed or not ed.get('endYear') or not ed.get('endMonth'):
        raise SystemExit('Graduation date not in config/profile.json: ask Siddharth, do not assume.')
    mo = MONTHS.get(str(ed['endMonth'])[:3].lower())
    if not mo:
        raise SystemExit(f'Unreadable graduation month {ed["endMonth"]!r} in profile.json: ask Siddharth.')
    return dt.date(int(ed['endYear']), mo, 1)


def deadline_info(value, today):
    """-> (deadline_date or None, passed: bool, not_open_yet: bool). Uses the LAST date in free text."""
    if isinstance(value, (dt.date, dt.datetime)):
        d = parse_date(value)
        return d, d < today, False
    text = str(value or '')
    dates = all_text_dates(text)
    if not dates:
        return None, False, False
    last = dates[-1]
    not_open = bool(re.search(r'\bopens?\b', text, re.I)) and dates[0] > today
    return last, last < today, not_open


SPRING = {'spring', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'june', 'january', 'february', 'march', 'april'}
FALL = {'fall', 'autumn', 'winter', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'july', 'august', 'september',
        'october', 'november', 'december'}
TERM_RE = r'(?:\b([A-Za-z]+)\s+)?\b(20\d\d)\b'


def _terms(fragment):
    out = []
    for word, year in re.findall(TERM_RE, fragment):
        w = word.lower()
        season = 'spring' if w in SPRING else 'fall' if w in FALL else None
        out.append((season, int(year)))
    return out


def class_year_blocker(text, grad):
    """Flag postings whose graduation window does not include the user's graduation (season-aware:
    'Fall 2027 or Spring 2028' does not include May 2027)."""
    t = str(text or '')
    blockers = []
    terms = []
    for m in re.finditer(r'(graduat\w*|grads?\b|class of|expected graduation)([^.;]{0,60})', t, re.I):
        terms += _terms(m.group(0))
    for m in re.finditer(r'\b(?:([A-Za-z]+)\s+)?(20\d\d)\s+(?:[A-Za-z]+\s+)?grads?\b', t, re.I):
        terms += _terms(m.group(0))
    grad_season = 'spring' if grad.month <= 6 else 'fall'
    if terms and not any(y == grad.year and s in (None, grad_season) for s, y in terms):
        named = sorted({(f'{s.title()} ' if s else '') + str(y) for s, y in terms})
        blockers.append(f'class-year: posting names {" / ".join(named)}; you graduate {grad.strftime("%b %Y")}')
    if re.search(r"currently (pursuing|enrolled in) (a |an )?(bachelor|undergrad)", t, re.I):
        blockers.append('undergrad-targeted')
    return blockers


def read_workbook(path):
    import openpyxl
    tmp = temp_copy(path)
    try:
        wb = openpyxl.load_workbook(tmp, read_only=True, data_only=True)
        ws = wb[MAIN_DB]
        hrow, H = find_header(ws)
        rows = []
        for r_idx, row in enumerate(ws.iter_rows(min_row=hrow + 1, values_only=True), hrow + 1):
            get = lambda name: row[H[name]] if name in H and H[name] < len(row) else None  # noqa: E731
            if not get('Company'):
                continue
            rows.append({'row': r_idx, **{name: get(name) for name in H}})
        systems = {}
        if CAREERS in wb.sheetnames:
            cs = wb[CAREERS]
            crow, C = find_header(cs, required=('Company', 'System / Type'))
            for r in cs.iter_rows(min_row=crow + 1, values_only=True):
                if r[C['Company']]:
                    systems[norm_company(r[C['Company']])] = r[C['System / Type']] or ''
        wb.close()
        return rows, systems
    finally:
        os.remove(tmp)


def route_and_variant(items):
    if not items:
        return {}
    p = subprocess.run(['node', os.path.join(ROOT, 'scripts', 'queue-bridge.cjs')],
                       input=json.dumps(items), capture_output=True, text=True, check=True)
    return {o['id']: o for o in json.loads(p.stdout)}


def build(workbook, tracker_path=TRACKER_PATH, include_low=False, today=None, grad=None):
    today = today or dt.date.today()
    grad = grad or grad_date_from_profile()
    rows, systems = read_workbook(workbook)
    done = tracker.keys(tracker_path)
    fits = {'high', 'medium'} | ({'low'} if include_low else set())

    excluded, candidates = [], []
    for r in rows:
        key = str(r.get('Dedupe Key') or '').strip()
        why = None
        status = str(r.get('Status') or '').strip().lower()
        fit = str(r.get('Fit (judgment)') or '').strip().lower()
        verif = str(r.get('Verification') or '').lower()
        deadline, passed, not_open = deadline_info(r.get('Deadline / Window'), today)
        if status not in OK_STATUS:
            why = f'status {r.get("Status")}'
        elif fit not in fits:
            why = f'fit {r.get("Fit (judgment)") or "blank"}'
        elif 'closed' in verif or 'removed' in verif:
            why = 'closed/removed'
        elif passed:
            why = f'deadline passed {deadline}'
        elif key and key.lower() in done:
            why = 'already in tracker'
        if why:
            excluded.append({'row': r['row'], 'company': r['Company'], 'title': r.get('Job Title'), 'reason': why})
            continue
        r['_deadline'], r['_not_open'], r['_key'] = deadline, not_open, key
        candidates.append(r)

    info = route_and_variant([{
        'id': r['row'], 'url': r.get('Careers Link') or '', 'title': r.get('Job Title') or '',
        'ats_hint': systems.get(norm_company(r['Company']), ''),
        'text': ' '.join(str(r.get(k) or '') for k in ('Job Title', 'Division / Group', 'Front-Office Category',
                                                         'Responsibilities Summary')),
    } for r in candidates])

    queue = []
    for r in candidates:
        ri = info.get(r['row'], {})
        if ri.get('route') == 'user-driven':
            excluded.append({'row': r['row'], 'company': r['Company'], 'title': r.get('Job Title'),
                             'reason': f'user-driven ({ri.get("label")}): apply yourself'})
            continue
        blockers = []
        if not r['_key']:
            blockers.append('no Dedupe Key in Main Database')
        if r['_not_open']:
            blockers.append('not open yet')
        if ri.get('requiresAccount'):
            blockers.append(f'account needed ({ri.get("label")})')
        if ri.get('route') == 'read-then-decide':
            blockers.append('ATS unknown until Apply is opened')
        if not r.get('Req ID') and 'program page' in str(r.get('Verification') or '').lower():
            blockers.append('program page, no individual posting')
        blockers += class_year_blocker(r.get('Education / Eligibility'), grad)
        added = parse_date(r.get('Date Added'))
        queue.append({
            'row': r['row'], 'dedupeKey': r['_key'], 'company': r['Company'], 'title': r.get('Job Title'),
            'location': r.get('Location'), 'dateAdded': added.isoformat() if added else None,
            'deadline': r['_deadline'].isoformat() if r['_deadline'] else str(r.get('Deadline / Window') or ''),
            'deadlineDate': r['_deadline'].isoformat() if r['_deadline'] else None,
            'fit': r.get('Fit (judgment)'), 'careersLink': r.get('Careers Link'),
            'ats': ri.get('ats'), 'route': ri.get('route'), 'routeLabel': ri.get('label'),
            'resumeVariant': ri.get('variant'), 'blockers': blockers,
        })

    # Strict order: Date Added newest first; ties (and undated rows) by sheet row descending.
    queue.sort(key=lambda q: (-(dt.date.fromisoformat(q['dateAdded']).toordinal()) if q['dateAdded'] else 0,
                              -q['row']))
    for i, q in enumerate(queue, 1):
        q['rank'] = i
    closing = [q for q in queue if q['deadlineDate']
               and today <= dt.date.fromisoformat(q['deadlineDate']) <= today + dt.timedelta(days=CLOSING_DAYS)]
    return {'builtAt': dt.datetime.now().isoformat(timespec='seconds'), 'workbook': workbook,
            'today': today.isoformat(), 'graduation': grad.isoformat(), 'queue': queue,
            'closingWithin7Days': [q['rank'] for q in closing], 'excluded': excluded}


def _cut(s, n):
    s = '' if s is None else str(s)
    return s if len(s) <= n else s[:n - 1] + '…'


def print_table(result, top):
    q = result['queue']
    print(f'Apply queue: {len(q)} eligible, {len(result["excluded"])} excluded '
          f'(graduation {result["graduation"][:7]}, today {result["today"]})\n')
    print(f'{"#":>3}  {"Company":22} {"Title":40} {"Location":20} {"Added":10} {"Deadline":11} '
          f'{"Route":24} {"Variant":30} Blockers')
    for x in q[:top]:
        print(f'{x["rank"]:>3}  {_cut(x["company"], 22):22} {_cut(x["title"], 40):40} {_cut(x["location"], 20):20} '
              f'{x["dateAdded"] or "":10} {_cut(x["deadlineDate"] or x["deadline"], 11):11} '
              f'{_cut(x["routeLabel"], 24):24} {_cut(x["resumeVariant"], 30):30} {"; ".join(x["blockers"])}')
    closing = [x for x in q if x['rank'] in result['closingWithin7Days']]
    print('\nClosing within 7 days (for your decision; order above is unchanged):')
    for x in closing:
        print(f'  #{x["rank"]} {x["company"]} - {x["title"]} (deadline {x["deadlineDate"]})')
    if not closing:
        print('  none')
    reasons = {}
    for e in result['excluded']:
        reasons.setdefault(e['reason'].split(':')[0].split(' 20')[0], 0)
        reasons[e['reason'].split(':')[0].split(' 20')[0]] += 1
    print('\nExcluded: ' + ', '.join(f'{k} {v}' for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--workbook', default=workbook_path())
    p.add_argument('--tracker', default=TRACKER_PATH)
    p.add_argument('--include-low', action='store_true')
    p.add_argument('--top', type=int, default=10)
    p.add_argument('--out', default=os.path.join(DATA_DIR, 'apply-queue.json'))
    p.add_argument('--json-only', action='store_true')
    a = p.parse_args(argv)
    result = build(a.workbook, a.tracker, a.include_low)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w') as f:
        json.dump(result, f, indent=2, default=str)
    if a.json_only:
        print(a.out)
    else:
        print_table(result, a.top)
        print(f'\nSaved {a.out}')


if __name__ == '__main__':
    main()
