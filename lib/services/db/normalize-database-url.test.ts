// @vitest-environment node

import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeDatabaseUrl } from './normalize-database-url';

describe('database SSL configuration', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['prefer', 'require', 'verify-ca'])(
    'makes %s explicitly verify-full without changing the connection details',
    mode => {
      const original = `postgresql://user:p%40ss%26word@db.example.com:5432/tidn?sslmode=${mode}&channel_binding=require&application_name=tidn`;
      const result = new URL(normalizeDatabaseUrl(original));
      expect(result.searchParams.get('sslmode')).toBe('verify-full');
      const before = new URL(original);
      expect(result.username).toBe(before.username);
      expect(result.password).toBe(before.password);
      expect(result.host).toBe(before.host);
      expect(result.pathname).toBe(before.pathname);
      expect(result.searchParams.get('channel_binding')).toBe('require');
      expect(result.searchParams.get('application_name')).toBe('tidn');
    }
  );

  it('configures pg without the SSL deprecation warning or disabling verification', () => {
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const client = new pg.Client({
      connectionString: normalizeDatabaseUrl(
        'postgresql://user:password@db.example.com/tidn?sslmode=require'
      )
    });
    expect(warning).not.toHaveBeenCalled();
    expect(client.ssl).toEqual({});
  });

  it.each([
    'postgresql://user:password@localhost:5432/tidn',
    'postgresql://user:password@127.0.0.1:5432/tidn?sslmode=disable',
    'postgresql://user:password@db.example.com/tidn?sslmode=verify-full',
    'postgresql://user:password@db.example.com/tidn?sslmode=require&uselibpqcompat=true',
    '/var/run/postgresql tidn',
    'not a connection URL'
  ])('preserves existing explicit settings and non-URL strings', original => {
    expect(normalizeDatabaseUrl(original)).toBe(original);
  });
});
