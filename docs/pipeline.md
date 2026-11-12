# The full loop

```mermaid
flowchart LR
    subgraph Discovery["Discovery (scheduled cloud task, not this repo)"]
        A[Add US finance firms<br/>sheet: Target List] --> B[Scan careers pages<br/>sheet: Careers Sources]
        B --> C[Add matching roles<br/>sheet: Main Database]
    end
    subgraph Apply["Apply side (this repo)"]
        D[Queue<br/>build-apply-queue.py] --> E[Re-check + draft<br/>resume bank, facts check]
        E --> F{Batch approval}
        F --> G[Apply one by one<br/>Playwright MCP, per-role 'submit']
        G --> H[(Application_Tracker.xlsx<br/>tracker.py)]
    end
    C -->|read-only, temp copy| D
    H -->|excluded from next queue| D
    H -->|guarded write-back<br/>Status + Date Applied| C
```

| Stage | Who | What |
|---|---|---|
| Discover firms | Scheduled task | Adds US finance firms to **Target List** |
| Scan careers | Scheduled task | Visits each firm's careers page, logs the result in **Careers Sources** |
| Main Database | Scheduled task | Adds matching roles with Date Added, Fit, Verification, Deadline and a Dedupe Key |
| Queue | `scripts/build-apply-queue.py` | Reads the live workbook (`$JOB_WORKBOOK`) through a temp copy. Keeps New/Interested rows with Fit High/Medium that are open, not closed and not in the tracker. Orders them **Date Added newest first, ties by row**. Joins Careers Sources for the ATS, picks route (`config/job-sources.json`) and resume variant (`config/search-spec.json`, `config/role-title-map.json`). Writes `data/apply-queue.json` |
| Re-check + draft | Claude (`skills/apply-queue`) | Confirms each posting is live and he is eligible (May 2027 graduation), drafts the resume (and cover letter) from the resume bank only; `resume-bank.cjs facts` must pass |
| Approval | Him | Approves the batch and each resume before upload |
| Apply | Claude + him | One role at a time; he handles logins, CAPTCHAs, codes and anything not in `profile.json`; nothing is submitted until he types "submit" |
| Tracker | `scripts/tracker.py` | `Application_Tracker.xlsx`, sheet Applications: one row per role, append-only, deduped on Dedupe Key, updated right after each role. Source of truth for what was applied to |
| Write-back | `scripts/writeback.py` | At the end: sets Status (Applied/Skip) and Date Applied in **Main Database** for those rows only. Skipped if the workbook is open (`~$` lock) or changed during the session; backs up first; edits only that sheet's XML so formatting, validation and formulas survive |

Only three sheets are used: **Target List**, **Careers Sources**, **Main Database**. "Job Database" and
"Jobs" are older sheets and are ignored.
