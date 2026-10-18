# 0010 — File uploads: the one client write (amends ADR 0002)

**Status:** proposed — 2026-10-18. Needs the owner's decision (fund isolation moves up a tier).

## Context

COLLECT-WEB lets a fund attach a deck or model to a deal. ADR 0002 says browsers never write tables, and
CLAUDE.md says "no insert/update/delete policies anywhere". Supabase Storage accepts uploads as INSERTs on
`storage.objects`, checked by row-level policies.

## Options

**A. One narrow client insert policy (this PR).** Signed-in owners, partners and analysts may insert into
bucket `deal-files` only at `<their fund>/<a deal of that fund>/<uuid>.<pdf|pptx|xlsx>`, with `owner_id` =
themselves. No update or delete policy, so nothing can be overwritten, moved or removed by a client. The
file becomes evidence only through the reviewed RPC `register_file`. Tests cover both directions, anon,
viewers, traversal, other buckets, erasure; canaries prove the tests can see.
Cost: none extra. Risk: one write path outside the RPC pattern, guarded by policy instead of code.

**B. No client write at all.** The browser asks the ingress for an upload; the ingress checks the caller's
role through an RPC, then mints a short-lived, single-object signed upload URL with the service role.
Cost: about half a day (an ingress endpoint, JWT verification, tests). Risk: more moving parts; the upload
still lands in the same bucket.

## Decision

[[OWNER: A or B]]. The agent recommends **A** for the MVP: it is equivalent in what a member can do, fully
tested, and smaller. Downloads go through short-lived signed URLs minted server-side in either option.

## Consequences

- A: CLAUDE.md's rule reads "No insert/update/delete policies anywhere, except the `deal-files` upload
  policy (ADR 0010)"; the catalogue sweep allows exactly that one policy and no other on `storage.objects`.
- B: the insert policy is removed from the migration before merge; the sweep then allows none.
