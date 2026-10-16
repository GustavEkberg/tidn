import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { normalizeDatabaseUrl } from './lib/services/db/normalize-database-url';

config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL env variable not found');

export default defineConfig({
  schema: './lib/services/db/schema.ts',
  out: './lib/services/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: normalizeDatabaseUrl(DATABASE_URL)
  }
});
