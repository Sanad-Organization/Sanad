export type FindingType = 'strength' | 'verified' | 'contradicted' | 'risk' | 'red_flag';

const FINDINGS: Record<FindingType, { word: string; glyph: string; cls: string }> = {
  strength: { word: 'Strength', glyph: '+', cls: 'strength' },
  verified: { word: 'Verified', glyph: '✓', cls: 'verified' },
  contradicted: { word: 'Contradicted', glyph: '≠', cls: 'contradicted' },
  risk: { word: 'Risk', glyph: '△', cls: 'risk' },
  red_flag: { word: 'Red flag', glyph: '!', cls: 'red-flag' },
};

/**
 * The type of a finding (database enum `finding_type`). Word, glyph and colour
 * always travel together, so meaning never depends on colour. `count` replaces
 * the word with a number (e.g. red flags in a table) and keeps the word for
 * screen readers.
 */
export function FindingBadge({ type, count }: { type: FindingType; count?: number }) {
  const f = FINDINGS[type];
  return (
    <span className={`s-badge s-badge--${f.cls}`}>
      <span className="s-badge__glyph" aria-hidden="true">
        {f.glyph}
      </span>
      {count === undefined ? (
        f.word
      ) : (
        <>
          {count}
          <span className="visually-hidden"> {f.word.toLowerCase()}</span>
        </>
      )}
    </span>
  );
}
