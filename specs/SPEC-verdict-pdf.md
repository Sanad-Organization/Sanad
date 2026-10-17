# SPEC — VERDICT-PDF

**Goal:** a one-page verdict PDF of an approved score that a partner can share with the investment committee.

**Scope:** job `verdict.export` (worker renders HTML with Playwright → PDF → `deal-files/<fund>/<deal>/exports/`);
only approved score versions; footer with score version, approval date, approver; signed download URL for
members; audit `export.created`.
**Non-scope:** memo or slide export.

**Flag:** `verdict-pdf`. **Acceptance:** PDF of an unapproved score is impossible (job refuses); fund B can't
fetch fund A's export (storage test). **Estimate:** 0.5 day.
