"""Low-level .xlsx editing without openpyxl's save (which silently drops features it does not support).

The workbook is a zip of XML parts. We edit only the part we need (the "Application Tracker" sheet, or the
"Main Database" cells that write-back changes) and copy every other part byte for byte, so formatting,
validation, conditional formats, autofilters and calcPr (fullCalcOnLoad) of the other sheets survive.

Used by scripts/tracker.py and scripts/writeback.py.
"""
import datetime as dt
import os
import re
import shutil
import tempfile
import zipfile
from xml.sax.saxutils import escape

MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


class Blocked(Exception):
    """A guard refused the write (workbook open in Excel, changed during the session, ...)."""


# ---------------------------------------------------------------- reading helpers
def col_letter(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def col_number(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def excel_serial(d):
    if isinstance(d, dt.datetime):
        d = d.date()
    return (d - dt.date(1899, 12, 30)).days


def unxml(s):
    return s.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&apos;', "'").replace('&amp;', '&')


def sheet_member(z, name):
    """Package path of the worksheet called `name`, or None."""
    return sheet_member_from(z.read, name)


def sheet_member_from(read, name):
    """Same, for any read(member)->bytes callable (a ZipFile's .read, or a dict's __getitem__)."""
    wb = read('xl/workbook.xml').decode('utf8')
    m = re.search(r'<sheet\b[^>]*\bname="%s"[^>]*/>' % re.escape(escape(name, {'"': '&quot;'})), wb)
    if not m:
        return None
    rid = re.search(r'r:id="([^"]+)"', m.group(0)).group(1)
    rels = read('xl/_rels/workbook.xml.rels').decode('utf8')
    t = re.search(r'<Relationship\b[^>]*Id="%s"[^>]*Target="([^"]+)"' % re.escape(rid), rels) or \
        re.search(r'<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="%s"' % re.escape(rid), rels)
    t = t.group(1).lstrip('/')
    return t if t.startswith('xl/') else 'xl/' + t


def shared_strings(z):
    return shared_strings_from(z.read)


def shared_strings_from(read):
    try:
        x = read('xl/sharedStrings.xml').decode('utf8')
    except KeyError:
        return []
    return [unxml(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))) for si in re.findall(r'<si>(.*?)</si>', x, re.S)]


CELL_RE = re.compile(r'<c\b([^>]*?)(?:/>|>(.*?)</c>)', re.S)
ROW_RE = re.compile(r'<row\b[^>]*\br="(\d+)"[^>]*?(?:/>|>(.*?)</row>)', re.S)


def cell_value(attrs, inner, sst):
    t = re.search(r'\bt="([^"]+)"', attrs)
    t = t.group(1) if t else None
    if inner is None:
        return None
    if t == 'inlineStr':
        return unxml(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))
    v = re.search(r'<v>(.*?)</v>', inner, re.S)
    if not v:
        return None
    if t == 's':
        return sst[int(v.group(1))]
    return unxml(v.group(1))


def row_cells(row_xml):
    """{column_letter: (full_match, attrs, inner)} for one <row>."""
    out = {}
    for m in CELL_RE.finditer(row_xml):
        ref = re.search(r'\br="([A-Z]+)\d+"', m.group(1)).group(1)
        out[ref] = (m.group(0), m.group(1), m.group(2))
    return out


def style_attr(attrs):
    s = re.search(r'\bs="(\d+)"', attrs or '')
    return f' s="{s.group(1)}"' if s else ''


def set_cell(row_xml, row_num, col, new_cell_body, cells):
    """Replace (or insert, in column order) the cell `col` in this row. new_cell_body(style_attr, ref) -> xml."""
    ref = f'{col}{row_num}'
    if col in cells:
        full, attrs, _ = cells[col]
        return row_xml.replace(full, new_cell_body(style_attr(attrs), ref), 1)
    new = new_cell_body('', ref)
    for other in sorted(cells, key=col_number):
        if col_number(other) > col_number(col):
            return row_xml.replace(cells[other][0], new + cells[other][0], 1)
    return re.sub(r'</row>$', new + '</row>', row_xml)


# ---------------------------------------------------------------- the "Application Tracker" sheet
TRACKER_SHEET = 'Application Tracker'
COLUMNS = ['Dedupe Key', 'Company', 'Job Title', 'Location', 'Careers Link', 'Date Added', 'Date Queued',
           'Resume Variant', 'Cover Letter (Y/N)', 'Status', 'Date Applied', 'Confirmation', 'Blocker',
           'Follow-up Date', 'Notes']
STATUSES = ['Queued', 'Drafted', 'Approved', 'Applied', 'Skipped', 'Blocked', 'Closed']
DATE_COLS = {'Date Added', 'Date Queued', 'Date Applied', 'Follow-up Date'}
# Style ids reused from the workbook's own styles.xml (same look as its other sheets).
STYLE = {'header': 3, 'Dedupe Key': 7, 'Company': 5, 'Job Title': 7, 'Location': 7, 'Careers Link': 23,
         'Date Added': 21, 'Date Queued': 21, 'Resume Variant': 7, 'Cover Letter (Y/N)': 4, 'Status': 6,
         'Date Applied': 9, 'Confirmation': 7, 'Blocker': 7, 'Follow-up Date': 21, 'Notes': 8}
WIDTHS = [36, 22, 42, 22, 40, 12, 12, 26, 10, 11, 13, 40, 40, 13, 60]
# Conditional-format colours reuse the dxf ids the workbook's Jobs sheet already uses.
CF = [('Approved', 5), ('Applied', 4), ('Skipped', 0), ('Blocked', 1), ('Closed', 0)]
LAST_COL = col_letter(len(COLUMNS))
MAX_ROW = 2000
XF_COUNT = 10 ** 9   # number of cellXfs in the workbook's styles.xml (set by configure_styles)
DXF_COUNT = 10 ** 9  # number of dxfs (conditional-format styles)


def configure_styles(parts):
    """Read styles.xml so style ids that do not exist in this workbook fall back to the default style 0."""
    global XF_COUNT, DXF_COUNT
    st = parts.get('xl/styles.xml', b'').decode('utf8')
    m = re.search(r'<cellXfs count="(\d+)"', st)
    XF_COUNT = int(m.group(1)) if m else 1
    d = re.search(r'<dxfs count="(\d+)"', st)
    DXF_COUNT = int(d.group(1)) if d else 0


def _sid(col):
    n = STYLE[col]
    return n if n < XF_COUNT else 0


def _cell(ref, style, value, col):
    if value is None or value == '':
        return f'<c r="{ref}" s="{style}"/>'
    if col in DATE_COLS:
        d = value.date() if isinstance(value, dt.datetime) else value
        return f'<c r="{ref}" s="{style}"><v>{excel_serial(d)}</v></c>'
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'


def row_xml(r, values):
    cells = ''.join(_cell(f'{col_letter(i)}{r}', _sid(c), values.get(c), c) for i, c in enumerate(COLUMNS, 1))
    return f'<row r="{r}" spans="1:{len(COLUMNS)}" ht="44.25" customHeight="1">{cells}</row>'


def new_tracker_sheet_xml():
    hs = STYLE['header'] if STYLE['header'] < XF_COUNT else 0
    head = ''.join(f'<c r="{col_letter(i)}1" s="{hs}" t="inlineStr"><is><t>{escape(c)}</t></is></c>'
                   for i, c in enumerate(COLUMNS, 1))
    cols = ''.join(f'<col width="{w}" customWidth="1" min="{i}" max="{i}"/>' for i, w in enumerate(WIDTHS, 1))
    cf_rules = ''.join(f'<cfRule type="cellIs" priority="{p}" operator="equal" dxfId="{d}"><formula>"{s}"</formula></cfRule>'
                       for p, (s, d) in enumerate(CF, 1) if d < DXF_COUNT)
    cf = f'<conditionalFormatting sqref="J2:J{MAX_ROW}">{cf_rules}</conditionalFormatting>' if cf_rules else ''
    return (f'<worksheet xmlns="{MAIN_NS}"><sheetPr><outlinePr summaryBelow="1" summaryRight="1"/><pageSetUpPr/></sheetPr>'
            f'<dimension ref="A1:{LAST_COL}1"/>'
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
            f'<sheetFormatPr baseColWidth="10" defaultRowHeight="15"/><cols>{cols}</cols>'
            f'<sheetData><row r="1" ht="32" customHeight="1">{head}</row></sheetData>'
            f'<autoFilter ref="A1:{LAST_COL}1"/>'
            f'{cf}'
            f'<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" '
            f'sqref="J2:J{MAX_ROW}"><formula1>"{",".join(STATUSES)}"</formula1></dataValidation></dataValidations>'
            '<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/></worksheet>')


def add_sheet_to_package(parts, name, sheet_xml, after='Main Database'):
    """parts: {member: bytes}. Registers a new worksheet part right after sheet `after`. Returns its member path."""
    nums = [int(m.group(1)) for k in parts for m in [re.match(r'xl/worksheets/sheet(\d+)\.xml$', k)] if m]
    member = f'xl/worksheets/sheet{max(nums + [0]) + 1}.xml'
    wb = parts['xl/workbook.xml'].decode('utf8')
    rels = parts['xl/_rels/workbook.xml.rels'].decode('utf8')
    ct = parts['[Content_Types].xml'].decode('utf8')
    rid_n = max([int(x) for x in re.findall(r'Id="rId(\d+)"', rels)] + [0]) + 1
    sid = max([int(x) for x in re.findall(r'sheetId="(\d+)"', wb)] + [0]) + 1
    rid = f'rId{rid_n}'
    rels = rels.replace('</Relationships>',
                        f'<Relationship Type="{REL_NS}/worksheet" Target="/{member}" Id="{rid}"/></Relationships>')
    ct = ct.replace('</Types>', f'<Override PartName="/{member}" '
                    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    sheets = re.search(r'<sheets>(.*?)</sheets>', wb, re.S).group(1)
    items = re.findall(r'<sheet\b[^>]*?/>', sheets, re.S)
    pos = next((i for i, s in enumerate(items) if f'name="{escape(after, {chr(34): "&quot;"})}"' in s), len(items) - 1) + 1
    new = f'<sheet xmlns:r="{REL_NS}" name="{escape(name)}" sheetId="{sid}" state="visible" r:id="{rid}"/>'
    items.insert(pos, new)
    wb = wb.replace(sheets, ''.join(items), 1)

    def bump(m):  # keep sheet-local defined names (filters, print titles) attached to the right sheet
        n = int(m.group(1))
        return f'localSheetId="{n + 1 if n >= pos else n}"'
    wb = re.sub(r'localSheetId="(\d+)"', bump, wb)
    parts['xl/workbook.xml'], parts['xl/_rels/workbook.xml.rels'] = wb.encode('utf8'), rels.encode('utf8')
    parts['[Content_Types].xml'] = ct.encode('utf8')
    parts[member] = sheet_xml.encode('utf8')
    return member


def tracker_rows(xml, sst):
    """[(row_number, {column name: value})] for the data rows of the tracker sheet XML."""
    out = []
    for m in ROW_RE.finditer(xml):
        r = int(m.group(1))
        if r == 1 or m.group(2) is None:
            continue
        cells = row_cells(m.group(0))
        vals = {}
        for i, c in enumerate(COLUMNS, 1):
            if col_letter(i) in cells:
                _, a, inner = cells[col_letter(i)]
                v = cell_value(a, inner, sst)
                if c in DATE_COLS and v not in (None, ''):
                    try:
                        v = dt.date(1899, 12, 30) + dt.timedelta(days=int(float(v)))
                    except ValueError:
                        pass
                vals[c] = v
        if vals.get('Dedupe Key'):
            out.append((r, vals))
    return out


def _refresh_ranges(xml, last):
    xml = re.sub(r'<dimension ref="[^"]*"/>', f'<dimension ref="A1:{LAST_COL}{last}"/>', xml, count=1)
    return re.sub(r'<autoFilter ref="[^"]*"', f'<autoFilter ref="A1:{LAST_COL}{last}"', xml, count=1)


def append_row(xml, values):
    last = max([r for r, _ in tracker_rows(xml, [])] + [1])
    # robust last-row detection even if the key cell uses shared strings
    last = max([int(m.group(1)) for m in ROW_RE.finditer(xml)] + [last])
    r = last + 1
    xml = xml.replace('</sheetData>', row_xml(r, values) + '</sheetData>', 1)
    return _refresh_ranges(xml, r)


def update_row(xml, row_number, changes):
    """changes: {column name: value}. Replaces those cells in the row; every other cell stays."""
    def fix(m):
        if int(m.group(1)) != row_number:
            return m.group(0)
        rx = m.group(0)
        for col, val in changes.items():
            cells = row_cells(rx)
            letter = col_letter(COLUMNS.index(col) + 1)
            style = _sid(col)
            rx = set_cell(rx, row_number, letter, lambda s, ref, c=col, v=val: _cell(ref, int(s[4:-1]) if s else style, v, c), cells)
        return rx
    return ROW_RE.sub(fix, xml)


# ---------------------------------------------------------------- safe writes
def lock_path(path):
    d, b = os.path.split(path)
    return os.path.join(d, '~$' + b)


def check_guards(path, session):
    """Raise Blocked if Excel has the workbook open or it changed since this session last saw it."""
    if os.path.exists(lock_path(path)):
        raise Blocked(f'{os.path.basename(lock_path(path))} exists: the workbook is open in Excel.')
    s = session or {}
    if s.get('workbook') and os.path.abspath(s['workbook']) == os.path.abspath(path) and s.get('workbook_mtime') is not None:
        if abs(os.path.getmtime(path) - s['workbook_mtime']) > 1e-6:
            raise Blocked('The workbook changed since this session last wrote it (mtime differs): another program edited it.')


def rewrite_package(path, mutate):
    """mutate(parts: {member: bytes}) edits parts in place. Writes a temp zip, then atomically replaces `path`.
    Every part that mutate does not touch is copied byte for byte."""
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        parts = {i.filename: z.read(i.filename) for i in infos}
        order = [i.filename for i in infos]
    before = dict(parts)
    mutate(parts)
    fd, tmp = tempfile.mkstemp(suffix='.xlsx', dir=os.path.dirname(path), prefix='.edit-')
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as out:
            infos_by_name = {i.filename: i for i in infos}
            for name in order + [k for k in parts if k not in before]:
                data = parts[name]
                if name in infos_by_name:
                    out.writestr(infos_by_name[name], data)
                else:
                    out.writestr(name, data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return before


def temp_copy(path):
    if not os.path.exists(path):
        raise SystemExit(f'Workbook not found: {path}\nSet JOB_WORKBOOK to its location.')
    fd, tmp = tempfile.mkstemp(suffix='.xlsx', prefix='apply-read-')
    os.close(fd)
    shutil.copyfile(path, tmp)
    return tmp
