# SPEC — COLLECT-WEB

**Goal:** every deal gets its website, news, deck and passive outside-in security evidence as cited sources
within minutes of creation.

**Scope:** jobs `deal.collect` (fans out), `web.collect` (httpx + trafilatura, Playwright fallback,
robots.txt respected, ≤ 30 pages, same-site), `news.collect` (web search API), `files.parse` (PDF, PPTX,
XLSX via PyMuPDF / python-pptx / openpyxl), `chunks.embed` (Voyage, 1024-d, batch), `security.outside_in`
(TLS versions and certificate, security headers, SPF/DKIM/DMARC, JS libraries with known CVEs, third-party
scripts loaded). Storage bucket `deal-files` with path `<fund_id>/<deal_id>/<uuid>.<ext>`; storage
policies: members insert/read only under their fund's prefix; RPC `register_file(deal, path)` (new
migration + tests + canary).
**Non-scope:** social platforms; repositories; active probing of any kind.

**Data:** writes `sources`, `chunks`, `code_issues` (`category = 'external'`), `deals.pipeline`.
**Flag:** `collect-web`.

**Acceptance criteria**
- Re-running a job creates no duplicates (`unique (deal_id, content_hash)`).
- A page with "ignore previous instructions" text is stored as plain evidence (no special handling needed
  here; covered by ADR 0005 evals).
- Outside-in check makes only normal HTTPS GETs and DNS lookups (test asserts the request list).
- Storage isolation test: fund B can't read or write under fund A's prefix (SQL test on `storage.objects`
  policies) + canary.

**Slices:** (1) storage migration + RPC; (2) web/news/files/embeddings; (3) outside-in. **Estimate:** 1.5 days.
