# @sanad/design-tokens

The approved Sanad design system (owner, 2026-10-18) as CSS variables. This is the only place a colour, size
or timing may be written; components use `var(--…)` only.

Names map one to one: design-system token `text` → `--color-text`, `surface-sunken` → `--color-surface-sunken`,
`space-4` → `--space-4`, `radius-md` → `--radius-md`, `target-min` → `--target-min`.

Rules that come with the tokens (summary of the design system's brand book):

- Status is never colour alone: finding badges carry a word and a glyph. Verified is blue, never green.
- Borders, not shadows. `--color-border` for hairlines, `--color-border-strong` for anything clickable.
- Mobile-first. Breakpoints `30rem` / `48rem` / `64rem`, written literally in queries; prefer container queries
  for components. Touch targets are at least `--target-min` on `pointer: coarse`.
- Fonts: IBM Plex Sans, Sans Arabic and Mono, self-hosted through `@fontsource` (imported by `apps/web`).
