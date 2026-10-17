// Only same-site relative paths survive a login round trip (no open redirect).
export function safeNextPath(raw: string | null | undefined, fallback = '/deals'): string {
  if (!raw || raw.length > 200) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  for (const ch of raw) if (ch.charCodeAt(0) < 0x20 || ch === '\\') return fallback;
  return raw;
}
