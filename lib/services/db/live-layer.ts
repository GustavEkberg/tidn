import { PgClient } from '@effect/sql-pg';
import { Config, Effect, Layer, Redacted } from 'effect';
import { NodeContext } from '@effect/platform-node';
import { drizzle, type EffectPgDatabase } from 'drizzle-orm/effect-postgres';
import * as schema from './schema';

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
