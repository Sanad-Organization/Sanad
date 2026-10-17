# 0004 — Social data: official or licensed sources, public and logged-out only

**Status:** accepted — 2026-10-13 (owner). **Legal review pending before the first real deal.**

## Context

The social overview is the first step on every deal (owner, 2026-10-13). Platforms differ: X sells
pay-per-use API access; Reddit's commercial API is enterprise-priced; Meta, TikTok and LinkedIn offer no
API for this use. Meta v. Bright Data (public, logged-out data) went Bright Data's way, but the matter is
not fully settled.

## Decision

1. X through the official API, pay-per-use. Instagram, Facebook, TikTok, LinkedIn company pages and Reddit
   through Bright Data, **public, logged-out pages only**. Apple's public review feed; Google Play listing
   pages. Websites and news with Sanad's own collector (httpx + trafilatura, Playwright fallback).
2. **Never log in** to collect. **No personal profiles.** Authors are stored as a salted SHA-256
   (`author_hash`), never a name or handle. Quoted text is capped at 2,000 characters.
3. Only **confirmed** profiles are collected (a member confirms what Sanad proposed).
4. Raw collected pages are deleted after 90 days; aggregates and quoted examples stay (retention job).
5. Any figure from fewer than 30 items is labelled low confidence; traction proxies are never called users.

## Consequences

- Bright Data verification can take days: the build starts with X and the app stores.
- **Before launch (Tier C, owner):** legal review of these rules and of the founder data agreement.
- Per-deal data cost (X reads, Bright Data records) is logged so pricing can be tested.
