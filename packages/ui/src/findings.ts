// Finding types (database enum public.finding_type) → the word and glyph shown
// with them. findings.test.ts fails if the enum and this map drift apart.
export type FindingType = 'strength' | 'verified' | 'contradicted' | 'risk' | 'red_flag';

export const FINDINGS: Record<FindingType, { word: string; plural: string; glyph: string; cls: string }> = {
  strength: { word: 'Strength', plural: 'strengths', glyph: '+', cls: 'strength' },
  verified: { word: 'Verified', plural: 'verified', glyph: '✓', cls: 'verified' },
  contradicted: { word: 'Contradicted', plural: 'contradicted', glyph: '≠', cls: 'contradicted' },
  risk: { word: 'Risk', plural: 'risks', glyph: '△', cls: 'risk' },
  red_flag: { word: 'Red flag', plural: 'red flags', glyph: '!', cls: 'red-flag' },
};

/** Screen-reader text for a counted badge: "1 red flag", "3 red flags". */
export function countLabel(type: FindingType, count: number): string {
  const f = FINDINGS[type];
  return count === 1 ? `1 ${f.word.toLowerCase()}` : `${count} ${f.plural}`;
}

export type Tier = 1 | 2 | 3 | 4;
