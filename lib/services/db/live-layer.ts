import { PgClient } from '@effect/sql-pg';
import { Config, Effect, Layer, Redacted } from 'effect';
import { NodeContext } from '@effect/platform-node';
import { drizzle, type EffectPgDatabase } from 'drizzle-orm/effect-postgres';
import * as Pg from 'pg';
import * as schema from './schema';

// Override pg's built-in DATE parser (OID 1082) to return the raw YYYY-MM-DD
// string instead of a Date object. The default parser passes date strings through
// `new Date()` which interprets them in the server's local timezone, causing a
// one-day shift for any timezone ahead of UTC.
Pg.types.setTypeParser(1082, (val: string) => val);

// PostgreSQL connection layer (internal)
const PgLive = PgClient.layerConfig({
  url: Config.redacted('DATABASE_URL'),
  ssl: Config.redacted('DATABASE_URL').pipe(
    Config.map(url => {
      const value = Redacted.value(url);
      return !value.includes('localhost') && !value.includes('127.0.0.1');
    })
  )
});

// Service definition
// v4 migration: Change Effect.Service to ServiceMap.Service
export class Db extends Effect.Service<Db>()('@app/Db', {
  effect: Effect.gen(function* () {
    const client = yield* PgClient.PgClient;
    return drizzle(client, { schema });
  })
}) {
  // Base layer (has unsatisfied PgClient dependency)
  static layer = this.Default;

  // Composed layer with all dependencies satisfied
  static Live = this.layer.pipe(Layer.provideMerge(PgLive), Layer.provide(NodeContext.layer));
}

// Type export for convenience
export type Database = EffectPgDatabase<typeof schema>;
