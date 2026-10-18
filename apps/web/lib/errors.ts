// Database error codes → messages a fund member can act on. Raw messages are
// never shown or logged (they can echo input).
import type { DealField } from './deal-form';

export interface DbError {
  code?: string | undefined;
  message?: string | undefined;
}

export function userMessage(err: DbError | null | undefined): string {
  switch (err?.code) {
    case '42501':
      return "You don't have permission to do that.";
    case '23514':
    case '22023':
    case '22001':
      return 'Some details are not valid. Check the highlighted fields.';
    case '23505':
      return 'That already exists.';
    case 'PGRST301':
    case 'PGRST303':
      return 'Your session has ended. Sign in again.';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}

// CHECK constraints the new-deal form can trip → the field to highlight.
const DEAL_CHECKS: Record<string, DealField> = {
  companies_name_check: 'company_name',
  companies_website_check: 'website',
  companies_sector_check: 'sector',
  companies_country_check: 'country',
  deals_round_check: 'round',
  deals_github_urls_check: 'github_urls',
};

/**
 * The form field a CHECK violation (23514) points at. Reads only the constraint
 * name from the message; the message itself is never shown or logged.
 */
export function dealCheckField(err: DbError | null | undefined): DealField | undefined {
  if (err?.code !== '23514' || typeof err.message !== 'string') return undefined;
  const name = /check constraint "([a-z0-9_]+)"/.exec(err.message)?.[1];
  return name ? DEAL_CHECKS[name] : undefined;
}
