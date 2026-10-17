# Sanad

Technical due diligence for venture funds: public evidence, a live GitHub scan and the deck's claims,
turned into a cited, scored verdict a partner signs off.

- How we work: [`CLAUDE.md`](CLAUDE.md) · state: [`PROGRESS.md`](PROGRESS.md) · queue: [`BACKLOG.md`](BACKLOG.md)
- What we're building: `docs/private/Sanad-Architecture-Plan.pdf`, `docs/adr/`, `specs/`
- Engineering contract: `docs/private/engineering-bootstrap.md`

## Local checks

```sh
pnpm install
pnpm gate                      # format, lint, typecheck, tests, guard tests, secret scan (+ DB if changed)
PGHOST=… PGUSER=postgres scripts/db-test.sh      # local Postgres 16 + pgvector only
scripts/db-canaries.sh
```
