'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { errorFields } from '@/lib/logger';
import { safeNextPath } from '@/lib/redirect';
import { requestOrigin, startAction } from '@/lib/request';
import { supabaseServer } from '@/lib/supabase/server';

export type LoginState =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string };

const Email = z.email().max(254);

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const act = await startAction('login.magic_link');
  const parsed = Email.safeParse(String(form.get('email') ?? '').trim());
  if (!parsed.success) {
    act.end('invalid');
    return { status: 'invalid', message: 'Enter a valid email address.' };
  }
  const next = safeNextPath(String(form.get('next') ?? ''));
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      // Members are created by staff (runbook add-fund); sign-in never creates an account.
      shouldCreateUser: false,
      // The email template appends token_hash and type (runbook web-hosting), so the link
      // works in any browser, not only the one that asked for it.
      emailRedirectTo: `${await requestOrigin()}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  // Same answer whether or not the address has an account (no enumeration).
  if (error && error.status !== 422 && error.status !== 400) {
    act.end('error', errorFields(error), 'warn');
    return { status: 'error', message: 'We couldn’t send the link. Try again in a moment.' };
  }
  act.end('ok');
  return { status: 'sent' };
}

export async function signInWithGoogle(form: FormData) {
  const act = await startAction('login.google');
  const next = safeNextPath(String(form.get('next') ?? ''));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${await requestOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    act.end('error', errorFields(error), 'warn');
    redirect(`/login?error=google&next=${encodeURIComponent(next)}`);
  }
  act.end('redirect');
  redirect(data.url);
}
