'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { siteUrl } from '@/lib/env';
import { errorFields } from '@/lib/logger';
import { safeNextPath } from '@/lib/redirect';
import { requestLogger } from '@/lib/request';
import { supabaseServer } from '@/lib/supabase/server';

export type LoginState = { status: 'idle' | 'sent' | 'error'; message?: string };

const Email = z.email().max(254);

function callbackUrl(next: string) {
  return `${siteUrl()}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
}

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const log = await requestLogger();
  log.info('action.start', { action: 'login.magic_link' });
  const parsed = Email.safeParse(String(form.get('email') ?? '').trim());
  if (!parsed.success) {
    log.info('action.end', { action: 'login.magic_link', outcome: 'invalid' });
    return { status: 'error', message: 'Enter a valid email address.' };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: callbackUrl(String(form.get('next') ?? '')) },
  });
  // Same answer whether or not the address has an account (no enumeration).
  if (error && error.status !== 422 && error.status !== 400) {
    log.warn('action.end', { action: 'login.magic_link', outcome: 'error', ...errorFields(error) });
    return { status: 'error', message: 'We couldn’t send the link. Try again in a moment.' };
  }
  log.info('action.end', { action: 'login.magic_link', outcome: 'ok' });
  return { status: 'sent' };
}

export async function signInWithGoogle(form: FormData) {
  const log = await requestLogger();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl(String(form.get('next') ?? '')) },
  });
  if (error || !data.url) {
    log.warn('action.end', { action: 'login.google', outcome: 'error', ...errorFields(error) });
    redirect('/login?error=google');
  }
  log.info('action.end', { action: 'login.google', outcome: 'redirect' });
  redirect(data.url);
}
