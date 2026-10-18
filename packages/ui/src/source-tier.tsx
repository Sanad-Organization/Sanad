export type Tier = 1 | 2 | 3 | 4;

/**
 * How much weight a citation carries: 1 = Sanad's own measurement (blue) …
 * 4 = the founder's claim (amber). Shown beside every source, Tier 4 included.
 */
export function SourceTier({ tier, label }: { tier: Tier; label: string }) {
  return (
    <span className={`s-tier s-tier--${tier}`}>
      <span className="s-tier__n" aria-label={`Tier ${tier}`}>
        T{tier}
      </span>
      <span className="s-tier__label">{label}</span>
    </span>
  );
}
