import 'server-only';
import { errorFields } from './logger';
import { requestLogger } from './request';
import { supabaseServer } from './supabase/server';

export const DEALS_LIST_LIMIT = 200;

/**
 * The fund's deals, newest first, with their company. RLS returns only the
 * member's funds; the filter keeps the list to the fund they work in.
 * Returns null when the read fails (logged); the page shows a notice.
 */
export async function listDeals(fundId: string) {
  const started = Date.now();
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('deals')
    .select('id, status, round, created_at, companies(name, sector, country)')
    .eq('fund_id', fundId)
    .order('created_at', { ascending: false })
    .limit(DEALS_LIST_LIMIT);
  const log = await requestLogger();
  const duration_ms = Date.now() - started;
  if (error) {
    log.error('deals.list_failed', { fund_id: fundId, outcome: 'error', duration_ms, ...errorFields(error) });
    return null;
  }
  log.debug('deals.list', { fund_id: fundId, outcome: 'ok', duration_ms, count: data.length });
  return data;
}
