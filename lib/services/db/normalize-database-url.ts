/** Preserve pg's current certificate and hostname verification for legacy SSL aliases. */
export function normalizeDatabaseUrl(value: string): string {
  if (!URL.canParse(value)) return value;
  const url = new URL(value);
  if (url.searchParams.get('uselibpqcompat') === 'true') return value;
  const mode = url.searchParams.get('sslmode');
  if (mode === 'prefer' || mode === 'require' || mode === 'verify-ca') {
    url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  }
  return value;
}
