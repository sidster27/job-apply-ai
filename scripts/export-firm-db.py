#!/usr/bin/env python3
"""
Turn the Firm Database CSV (from the Job Tracker project) into config/finance-companies.json.
OPTIONAL: the pilot works without it (config/careers-sources.json already holds the ~43 target firms).

  python3 scripts/export-firm-db.py [path/to/Firm_Database_Master.csv] [--add-slugs]

  default CSV path : ./Firm_Database_Master.csv   (download it from the project into the repo folder)
  --add-slugs      : also add every Greenhouse slug in the CSV to config/greenhouse-companies.json
                     (marked 'unverified'; then run: node scripts/verify-slugs.cjs --apply)

The CSV and the output are git-ignored (private research), so neither is pushed to the public fork.
"""
import csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
args = [a for a in sys.argv[1:] if not a.startswith("--")]
src = args[0] if args else os.path.join(ROOT, "Firm_Database_Master.csv")
add_slugs = "--add-slugs" in sys.argv

if not os.path.exists(src):
    sys.exit("Cannot find %s. Download Firm_Database_Master.csv from the project into the repo folder, or pass its path." % src)

with open(src, newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))
need = {"Firm", "Category", "Metro", "Website", "Slug"}
if not rows or not need.issubset(rows[0].keys()):
    sys.exit("Unexpected columns. Need at least: " + ", ".join(sorted(need)) + ". Found: " + ", ".join(rows[0].keys() if rows else []))

# energy/utility corporates are not finance-analyst targets (kept but inactive)
INACTIVE_CATS = {"ENC"}
firms = []
for r in rows:
    name = (r.get("Firm") or "").strip()
    if not name:
        continue
    firms.append({
        "firm": name,
        "category": (r.get("Category") or "").strip(),
        "metro": (r.get("Metro") or "").strip(),
        "hq": (r.get("HQ") or "").strip(),
        "website": (r.get("Website") or "").strip(),
        "greenhouseSlug": (r.get("Slug") or "").strip() or None,
        "onTargetList": (r.get("OnTargetList") or "").strip().lower() in ("y", "yes", "true", "1", "x"),
        "active": (r.get("Category") or "").strip() not in INACTIVE_CATS,
    })

out = os.path.join(ROOT, "config", "finance-companies.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump({"_description": "Exported from Firm_Database_Master.csv by scripts/export-firm-db.py. Private research: git-ignored.",
               "_total": len(firms), "firms": firms}, f, indent=2)
    f.write("\n")
print("Wrote %s (%d firms, %d active, %d with a Greenhouse slug)" % (os.path.relpath(out, ROOT), len(firms),
      sum(1 for x in firms if x["active"]), sum(1 for x in firms if x["greenhouseSlug"])))

if add_slugs:
    gp = os.path.join(ROOT, "config", "greenhouse-companies.json")
    doc = json.load(open(gp))
    have = set(doc.get("companies", []))
    added = 0
    for x in firms:
        s = x["greenhouseSlug"]
        if s and x["active"] and s not in have:
            doc["companies"].append(s)
            doc.setdefault("details", []).append({"slug": s, "firm": x["firm"], "status": "unverified"})
            have.add(s); added += 1
    doc["_total"] = len(doc["companies"])
    json.dump(doc, open(gp, "w"), indent=2); open(gp, "a").write("\n")
    print("Added %d new slugs to config/greenhouse-companies.json. Now run: node scripts/verify-slugs.cjs --apply" % added)
