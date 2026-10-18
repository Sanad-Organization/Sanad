'use server';

import { redirect } from 'next/navigation';
import { formValues, FIELD_MESSAGES, parseDealForm, type DealFormValues, type FieldErrors } from '@/lib/deal-form';
import { dealCheckField, userMessage } from '@/lib/errors';
import { flagOn } from '@/lib/flags-server';
import { getSession } from '@/lib/fund';
import { errorFields } from '@/lib/logger';
import { startAction } from '@/lib/request';
import { supabaseServer } from '@/lib/supabase/server';

export type NewDealState =
  | { status: 'idle' }
  | { status: 'invalid'; errors: FieldErrors; values: DealFormValues }
  | { status: 'error'; message: string; values: DealFormValues; fund?: { id: string; name: string } };

/**
 * Create a deal in the fund the member is working in, through create_deal with
 * the member's JWT. The fund comes from the session, never from the form.
 */
export async function createDeal(_prev: NewDealState, form: FormData): Promise<NewDealState> {
  const act = await startAction('deal.create');
  const values = formValues(form);
  const session = await getSession();
  if (!session) {
    act.end('no_session');
    redirect('/login?next=/deals/new');
  }
  const fund = session.current;
  if (!fund) {
    act.end('no_fund', { user_id: session.userId });
    return { status: 'error', message: "Your account isn't part of a fund yet.", values };
  }
  // The form carries the fund it was shown for. If the member switched funds in
  // another tab since, refuse rather than create the deal in a fund they didn't see.
  if (form.get('fund_id') !== fund.fundId) {
    act.end('fund_changed', { fund_id: fund.fundId, user_id: session.userId }, 'warn');
    return {
      status: 'error',
      message: `You switched to ${fund.fundName} in another tab. Check the details and submit again to create the deal there.`,
      values,
      fund: { id: fund.fundId, name: fund.fundName },
    };
  }
  if (!(await flagOn('app-shell', fund.fundId))) {
    act.end('feature_off', { fund_id: fund.fundId });
    return { status: 'error', message: "This isn't available to your fund yet.", values };
  }

  const parsed = parseDealForm(form);
  if (!parsed.ok) {
    act.end('invalid', { fund_id: fund.fundId, count: Object.keys(parsed.errors).length });
    return { status: 'invalid', errors: parsed.errors, values };
  }
  const d = parsed.data;
  const supabase = await supabaseServer();
  const { data: dealId, error } = await supabase.rpc('create_deal', {
    p_fund: fund.fundId,
    p_company_name: d.company_name,
    p_github_urls: d.github_urls,
    ...(d.website ? { p_website: d.website } : {}),
    ...(d.sector ? { p_sector: d.sector } : {}),
    ...(d.country ? { p_country: d.country } : {}),
    ...(d.round ? { p_round: d.round } : {}),
  });
  if (error) {
    const field = dealCheckField(error);
    const outcome = error.code === '42501' ? 'refused' : field ? 'invalid' : 'error';
    act.end(outcome, { fund_id: fund.fundId, ...errorFields(error) }, outcome === 'error' ? 'error' : 'warn');
    if (field) return { status: 'invalid', errors: { [field]: FIELD_MESSAGES[field] }, values };
    return { status: 'error', message: userMessage(error), values };
  }
  act.end('ok', { fund_id: fund.fundId, deal_id: dealId, user_id: session.userId });
  redirect('/deals');
}
