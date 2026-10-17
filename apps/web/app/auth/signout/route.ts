import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

// POST only, so a link or image can't sign someone out.
export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${siteUrl()}/login`, { status: 303 });
}
