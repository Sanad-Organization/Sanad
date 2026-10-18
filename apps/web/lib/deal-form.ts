// New-deal form: read and validate the submitted fields before create_deal.
// The rules mirror the database CHECKs (20261013090200_deals_evidence.sql),
// which stay the authority; this only gives the member early, per-field help.
import { z } from 'zod';

export const ROUNDS = [
  { value: 'pre_seed', label: 'Pre-seed' },
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'series_b', label: 'Series B' },
  { value: 'other', label: 'Other' },
] as const;
type Round = (typeof ROUNDS)[number]['value'];
const ROUND_VALUES = ROUNDS.map((r) => r.value) as [Round, ...Round[]];

export const MAX_GITHUB_URLS = 5;
const WEBSITE_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
const GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export type DealField = 'company_name' | 'website' | 'sector' | 'country' | 'round' | 'github_urls';
export type FieldErrors = Partial<Record<DealField, string>>;
/** What the member typed, echoed back into the form after a refusal. Never logged. */
export type DealFormValues = Record<DealField, string>;

/** Message per field when the database refuses a value the form let through. */
export const FIELD_MESSAGES: Record<DealField, string> = {
  company_name: 'Enter the company name (up to 200 characters).',
  website: 'Enter a web address starting with https://, up to 500 characters.',
  sector: 'Use 100 characters or fewer.',
  country: 'Use a two-letter country code, such as AE.',
  round: 'Choose a round from the list.',
  github_urls: `Add up to ${MAX_GITHUB_URLS} repository addresses like https://github.com/owner/repo, one per line.`,
};

const NewDeal = z.object({
  company_name: z
    .string()
    .min(1, { error: FIELD_MESSAGES.company_name })
    .max(200, { error: FIELD_MESSAGES.company_name }),
  website: z
    .string()
    .max(500, { error: FIELD_MESSAGES.website })
    .regex(WEBSITE_RE, { error: FIELD_MESSAGES.website })
    .optional(),
  sector: z.string().max(100, { error: FIELD_MESSAGES.sector }).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, { error: FIELD_MESSAGES.country })
    .optional(),
  round: z.enum(ROUND_VALUES, { error: FIELD_MESSAGES.round }).optional(),
  github_urls: z
    .array(z.string().regex(GITHUB_RE, { error: FIELD_MESSAGES.github_urls }))
    .max(MAX_GITHUB_URLS, { error: FIELD_MESSAGES.github_urls }),
});
export type NewDeal = z.infer<typeof NewDeal>;

export type ParsedDeal = { ok: true; data: NewDeal } | { ok: false; errors: FieldErrors };

function text(form: FormData, key: DealField): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

export function formValues(form: FormData): DealFormValues {
  return {
    company_name: text(form, 'company_name'),
    website: text(form, 'website'),
    sector: text(form, 'sector'),
    country: text(form, 'country'),
    round: text(form, 'round'),
    github_urls: text(form, 'github_urls'),
  };
}

/** A bare domain gets https:// so "example.com" is accepted; the scheme is lower-cased. */
function website(v: string): string | undefined {
  if (!v) return undefined;
  const scheme = /^https?:\/\//i.exec(v)?.[0];
  return scheme ? scheme.toLowerCase() + v.slice(scheme.length) : `https://${v}`;
}

/** One address per line (commas and spaces also split); trailing "/" and ".git" dropped; duplicates removed. */
function githubUrls(v: string): string[] {
  const urls = v
    .split(/[\s,]+/)
    .map((u) => u.replace(/\/+$/, '').replace(/\.git$/, ''))
    .filter(Boolean);
  return [...new Set(urls)];
}

export function parseDealForm(form: FormData): ParsedDeal {
  const v = formValues(form);
  const result = NewDeal.safeParse({
    company_name: v.company_name,
    website: website(v.website),
    sector: v.sector || undefined,
    country: v.country ? v.country.toUpperCase() : undefined,
    round: v.round || undefined,
    github_urls: githubUrls(v.github_urls),
  });
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    // Every issue in this flat schema has the field name as its first path element.
    const field = issue.path[0] as DealField;
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

export function roundLabel(round: string | null): string {
  return ROUNDS.find((r) => r.value === round)?.label ?? '—';
}
