"""Generate a fake Target_Company_List-style workbook for tests. Fake firms and data only."""
import datetime as dt

import openpyxl
from openpyxl.worksheet.datavalidation import DataValidation

MDB_HEADERS = ['Company', 'Job Title', 'Division / Group', 'Role Type', 'Front-Office Category', 'Location', 'Posted',
               'Deadline / Window', 'Req ID', 'Pay', 'Education / Eligibility', 'Responsibilities Summary',
               'Careers Link', 'Verification', 'Source', 'Date Added', 'Fit (judgment)', 'Fit Notes / Flags', 'Status',
               'Date Applied', 'My Notes / Next Step', 'Dedupe Key']

# (company, title, deadline, education, link, verification, date_added, fit, status, key)
ROWS = [
    ('Alpha Capital', 'Equity Research Analyst', 'Not stated', '', 'https://job-boards.greenhouse.io/alphacap/jobs/1',
     'Live', dt.datetime(2026, 11, 10), 'High', 'New', 'alpha|1'),                                    # row 3
    ('Beta Partners', 'Investment Banking Analyst', 'Rolling', '', 'https://beta.example.com/careers',
     'Live', '2026-11-12', 'Medium', 'New', 'beta|2'),                                                # row 4 (text date)
    ('Gamma Funds', 'Portfolio Analyst', 'Open until Feb 1, 2027', '', 'https://gamma.wd1.myworkdayjobs.com/x/job/1',
     'Live', dt.datetime(2026, 11, 12), 'Medium', 'New', 'gamma|3'),                                  # row 5 (tie with 4)
    ('Delta Bank', 'Markets Analyst', 'Closes Nov 1, 2026', '', 'https://delta.example.com/jobs/4',
     'Live', dt.datetime(2026, 11, 11), 'High', 'New', 'delta|4'),                                    # row 6: deadline passed
    ('Epsilon AM', 'Research Associate', 'Not stated', '', 'https://epsilon.example.com/jobs/5',
     'Closed/removed on Nov 10', dt.datetime(2026, 11, 11), 'High', 'New', 'epsilon|5'),             # row 7: closed
    ('Zeta Group', 'Analyst', 'Not stated', '', 'https://zeta.example.com/jobs/6',
     'Live', dt.datetime(2026, 11, 11), 'Low', 'New', 'zeta|6'),                                       # row 8: low fit
    ('Eta Advisors', 'Credit Analyst', 'Not stated', '', 'https://eta.example.com/jobs/7',
     'Live', dt.datetime(2026, 11, 11), 'High', 'Applied', 'eta|7'),                                  # row 9: status
    ('Theta Capital', 'Associate', 'Not stated', '', 'https://www.linkedin.com/jobs/view/8',
     'Live', dt.datetime(2026, 11, 11), 'High', '', 'theta|8'),                                       # row 10: user-driven
    ('Iota Trading', 'Summer Analyst', 'Closes about Nov 14, 2026 (per posting)',
     "Bachelor's degree graduating Fall 2027 or Spring 2028", 'https://iota.example.com/jobs/9',
     'Live', dt.datetime(2026, 11, 9), 'Medium', 'Interested', 'iota|9'),                             # row 11: closing soon
    ('Kappa Holdings', 'Analyst', 'Not stated', '', 'https://kappa.example.com/jobs/10',
     'Live', dt.datetime(2026, 11, 11), 'High', 'New', 'kappa|10'),                                   # row 12: in tracker
]


def make(path):
    wb = openpyxl.Workbook()
    tl = wb.active
    tl.title = 'Target List'
    tl.append(['TL #', 'Company'])
    tl.append([1, 'Alpha Capital'])

    md = wb.create_sheet('Main Database')
    md.append(['="Main Database: "&COUNTA(A3:A2000)&" roles"'])
    md.append(MDB_HEADERS)
    for c, t, dl, edu, link, ver, added, fit, st, key in ROWS:
        row = dict(zip(MDB_HEADERS, [None] * len(MDB_HEADERS)))
        row.update({'Company': c, 'Job Title': t, 'Deadline / Window': dl, 'Education / Eligibility': edu,
                    'Careers Link': link, 'Verification': ver, 'Date Added': added, 'Fit (judgment)': fit,
                    'Status': st or None, 'Dedupe Key': key, 'Location': 'New York, NY'})
        md.append([row[h] for h in MDB_HEADERS])
    dv = DataValidation(type='list', formula1='"New,Interested,Applied,Interview,Offer,Rejected,Skip"', allow_blank=True)
    md.add_data_validation(dv)
    dv.add('S3:S2000')
    md.auto_filter.ref = 'A2:V12'

    cs = wb.create_sheet('Careers Sources')
    cs.append(['TL #', 'Company', 'Metro Priority', 'Careers URL', 'System / Type'])
    cs.append([2, 'Beta Partners', 'NYC', 'https://beta.example.com/careers', 'Custom careers site + Workday'])

    wb.create_sheet('Jobs').append(['ignored'])
    wb.save(path)
    return path
