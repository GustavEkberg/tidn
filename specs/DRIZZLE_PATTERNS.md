# Drizzle ORM Patterns

Database operations using Drizzle ORM with Effect-TS integration.

## Critical: Effect-Only Database Access

This project uses `drizzle-orm/effect-postgres` which returns **Effect** types, not Promises. All database operations MUST use Effect patterns:

```typescript
// CORRECT - yield* returns Effect, use inside Effect.gen
const posts = yield * db.select().from(schema.post);

// WRONG - don't use await, Drizzle returns Effect not Promise
const posts = await db.select().from(schema.post); // Type error!

// WRONG - don't use db outside Effect context
const posts = db.select().from(schema.post); // Returns Effect, not data
```

**Key rule:** Every database operation must be inside `Effect.gen(function* () { ... })` and yielded with `yield*`.

## Schema Definition

### Table Structure

```typescript
// lib/services/db/schema.ts
import { pgTable, text, timestamp, boolean, decimal, index, unique } from 'drizzle-orm/pg-core';
import { defineRelations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

export const transaction = pgTable(
  'transaction',
  {
    // Primary key with CUID2 generation
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Required fields
    date: timestamp('date').notNull(),
    merchant: text('merchant').notNull(),
    description: text('description'),

    // Decimal for monetary values (precision: total digits, scale: decimal places)
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),

    // Foreign keys
    categoryId: text('categoryId').references(() => category.id),
    userId: text('userId')
      .notNull()
      .references(() => user.id),

    // Timestamps with auto-update
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  // Third argument: indexes and constraints
  t => [
    index('transaction_date_idx').on(t.date),
    index('transaction_user_idx').on(t.userId),
    unique('transaction_hash_unique').on(t.originalHash)
  ]
);

// Type exports - use these throughout the codebase
export type Transaction = typeof transaction.$inferSelect;
export type InsertTransaction = typeof transaction.$inferInsert;
```

### Column Types Reference

| Type      | Drizzle                                       | TypeScript | Notes                          |
| --------- | --------------------------------------------- | ---------- | ------------------------------ |
| String    | `text('col')`                                 | `string`   | Variable length                |
| Integer   | `integer('col')`                              | `number`   | 32-bit                         |
| Decimal   | `decimal('col', { precision: 12, scale: 2 })` | `string`   | Returns string, parse manually |
| Boolean   | `boolean('col')`                              | `boolean`  |                                |
| Timestamp | `timestamp('col')`                            | `Date`     |                                |
| JSON      | `jsonb('col')`                                | `unknown`  | Use `.$type<T>()` for typing   |

### Constraints

```typescript
// Inline constraints
text('email').notNull().unique();

// Table-level constraints (in third argument)
t => [
  unique('user_email_unique').on(t.email),
  index('user_created_idx').on(t.createdAt),
  // Composite unique
  unique('mapping_user_merchant').on(t.userId, t.merchantPattern)
];
```

---

## Relations (RQB v2 API)

Drizzle 1.0 uses `defineRelations()` for the relational query builder:

```typescript
export const relations = defineRelations(
  // All tables that participate in relations
  { user, transaction, category, upload },
  r => ({
    // Relations for each table
    user: {
      transactions: r.many.transaction({
        from: r.user.id,
        to: r.transaction.userId
      }),
      uploads: r.many.upload({
        from: r.user.id,
        to: r.upload.uploadedBy
      })
    },
    transaction: {
      // Required relation (foreign key is NOT NULL)
      user: r.one.user({
        from: r.transaction.userId,
        to: r.user.id,
        optional: false
      }),
      // Optional relation (foreign key is nullable)
      category: r.one.category({
        from: r.transaction.categoryId,
        to: r.category.id,
        optional: true // categoryId can be null
      }),
      upload: r.one.upload({
        from: r.transaction.uploadId,
        to: r.upload.id,
        optional: true
      })
    },
    category: {
      transactions: r.many.transaction({
        from: r.category.id,
        to: r.transaction.categoryId
      })
    }
  })
);
```

### Relation Types

| Pattern                            | Use When                  |
| ---------------------------------- | ------------------------- |
| `r.one.table({ optional: false })` | Foreign key is `NOT NULL` |
| `r.one.table({ optional: true })`  | Foreign key is nullable   |
| `r.many.table()`                   | One-to-many relationship  |

---

## Query Patterns with Effect

### Basic Select

```typescript
import { Effect } from 'effect';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq, and, gte, lt, desc } from 'drizzle-orm';

export const getTransactions = (userId: string, dateRange: DateRange) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const transactions = yield* db
      .select()
      .from(schema.transaction)
      .where(
        and(
          eq(schema.transaction.userId, userId),
          gte(schema.transaction.date, dateRange.startDate),
          lt(schema.transaction.date, dateRange.endDate)
        )
      )
      .orderBy(desc(schema.transaction.date));

    return transactions;
  }).pipe(Effect.withSpan('Transaction.getAll'));
```

### Typed SQL Templates

Use `sql<T>` for raw SQL with type annotations:

```typescript
import { sql } from 'drizzle-orm';

export const getTransactionSummary = (range: DateRange) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const results = yield* db
      .select({
        categoryId: schema.transaction.categoryId,
        categoryName: schema.category.name,
        // sql<T> provides return type annotation
        total: sql<string>`sum(${schema.transaction.amount})`.as('total'),
        count: sql<number>`count(*)::int`.as('count')
      })
      .from(schema.transaction)
      .leftJoin(schema.category, eq(schema.transaction.categoryId, schema.category.id))
      .where(
        and(
          gte(schema.transaction.date, range.startDate),
          lt(schema.transaction.date, range.endDate)
        )
      )
      .groupBy(schema.transaction.categoryId, schema.category.name);

    // Parse decimal strings to numbers
    return results.map(r => ({
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      total: parseFloat(r.total ?? '0'),
      count: r.count
    }));
  }).pipe(Effect.withSpan('Transaction.getSummary'));
```

### Common SQL Functions

```typescript
// Aggregations
sql<string>`sum(${schema.transaction.amount})`;
sql<number>`count(*)::int`;
sql<string>`coalesce(sum(${schema.transaction.amount}), 0)`;
sql<string>`abs(sum(${schema.transaction.amount}))`;

// Date formatting (PostgreSQL)
sql<string>`to_char(${schema.transaction.date}, 'YYYY-MM')`;
sql<string>`to_char(${schema.transaction.date}, '"W"IW')`; // ISO week

// Dynamic SQL fragments (no escaping)
const format = sql.raw(`'YYYY-MM'`);
sql<string>`to_char(${schema.transaction.date}, ${format})`;

// Conditions in select
sql<boolean>`${schema.transaction.amount} < 0`;
```

### Joins

```typescript
// Left join - keeps all rows from left table
const results =
  yield *
  db
    .select({
      transaction: schema.transaction,
      categoryName: schema.category.name // Can be null
    })
    .from(schema.transaction)
    .leftJoin(schema.category, eq(schema.transaction.categoryId, schema.category.id));

// Inner join - only matching rows
const results =
  yield *
  db
    .select()
    .from(schema.transaction)
    .innerJoin(schema.category, eq(schema.transaction.categoryId, schema.category.id));
```

### Distinct Values (PostgreSQL)

```typescript
// Get unique merchants (case-insensitive)
const merchants =
  yield *
  db
    .selectDistinctOn([sql`lower(${schema.transaction.merchant})`], {
      merchant: schema.transaction.merchant,
      merchantLower: sql<string>`lower(${schema.transaction.merchant})`.as('merchant_lower')
    })
    .from(schema.transaction)
    .where(eq(schema.transaction.userId, userId));
```

### Pagination

```typescript
export const getTransactionsPaginated = (userId: string, page: number, pageSize: number) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const transactions = yield* db
      .select()
      .from(schema.transaction)
      .where(eq(schema.transaction.userId, userId))
      .orderBy(desc(schema.transaction.date))
      .limit(pageSize)
      .offset(page * pageSize);

    return transactions;
  }).pipe(Effect.withSpan('Transaction.getPaginated'));
```

---

## Mutations

### Insert with Returning

```typescript
export const createTransaction = (input: InsertTransaction) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [transaction] = yield* db.insert(schema.transaction).values(input).returning();

    return transaction;
  }).pipe(Effect.withSpan('Transaction.create'));
```

### Bulk Insert

```typescript
export const createTransactions = (inputs: InsertTransaction[]) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const transactions = yield* db.insert(schema.transaction).values(inputs).returning();

    return transactions;
  }).pipe(Effect.withSpan('Transaction.createBulk'));
```

### Update with Returning

```typescript
export const updateTransaction = (id: string, updates: Partial<InsertTransaction>) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [updated] = yield* db
      .update(schema.transaction)
      .set(updates)
      .where(eq(schema.transaction.id, id))
      .returning();

    return updated; // undefined if not found
  }).pipe(Effect.withSpan('Transaction.update'));
```

### Bulk Update with Count

```typescript
export const categorizeAllByMerchant = (merchant: string, categoryId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    // Update all matching rows and get count via returning
    const updated = yield* db
      .update(schema.transaction)
      .set({ categoryId })
      .where(and(eq(schema.transaction.merchant, merchant), isNull(schema.transaction.categoryId)))
      .returning({ id: schema.transaction.id });

    return updated.length; // Number of rows updated
  }).pipe(Effect.withSpan('Transaction.categorizeByMerchant'));
```

### Upsert (Insert or Update)

```typescript
export const upsertMerchantMapping = (merchantPattern: string, categoryId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [mapping] = yield* db
      .insert(schema.merchantMapping)
      .values({
        merchantPattern,
        categoryId,
        isMultiMerchant: false
      })
      .onConflictDoUpdate({
        target: schema.merchantMapping.merchantPattern,
        set: {
          categoryId,
          isMultiMerchant: false
        }
      })
      .returning();

    return mapping;
  }).pipe(Effect.withSpan('MerchantMapping.upsert'));
```

### Delete

```typescript
export const deleteTransaction = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* db.delete(schema.transaction).where(eq(schema.transaction.id, id));
  }).pipe(Effect.withSpan('Transaction.delete'));
```

---

## Workflow

### Development: Push

Use `db:push` for rapid iteration during development:

```bash
pnpm db:push
```

This applies schema changes directly without generating migration files. **Warning:** Can cause data loss if columns are removed.

### Production: Migrations

For production, generate and apply migrations:

```bash
# Generate migration from schema changes
pnpm db:generate

# Apply pending migrations
pnpm db:migrate
```

**Configuration:**

```typescript
// drizzle.config.ts
export default defineConfig({
  schema: './lib/services/db/schema.ts',
  out: './lib/services/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!
  },
  migrations: {
    schema: 'drizzle' // Store migration metadata in 'drizzle' schema
  }
});
```

### Seed Script

Seed scripts run outside Effect context - use postgres.js driver directly:

```typescript
// lib/services/db/seed.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DEFAULT_CATEGORIES = [
  { name: 'Food & Dining', icon: '🍽️', isDefault: true },
  { name: 'Transportation', icon: '🚗', isDefault: true }
];

async function seed() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  for (const cat of DEFAULT_CATEGORIES) {
    await db
      .insert(schema.category)
      .values(cat)
      .onConflictDoUpdate({
        target: schema.category.name,
        set: { icon: cat.icon, isDefault: cat.isDefault }
      });
  }

  await client.end(); // Close connection
  console.log('Seed complete');
}

seed();
```

```json
// package.json
{
  "scripts": {
    "db:seed": "tsx lib/services/db/seed.ts"
  }
}
```

---

## Anti-Patterns

| Pattern                              | Problem                             | Correct Approach                          |
| ------------------------------------ | ----------------------------------- | ----------------------------------------- |
| `await db.select()...`               | Drizzle returns Effect, not Promise | `yield* db.select()...` inside Effect.gen |
| `db.select()` without yield          | Returns Effect, not data            | Must `yield*` to execute                  |
| Direct `drizzle()` in app code       | Bypasses Effect service layer       | Use `yield* Db` to get client             |
| `decimal` without parsing            | Returns `string`, not `number`      | `parseFloat(result.amount)`               |
| Missing `.pipe(Effect.withSpan())`   | No tracing                          | Always add span                           |
| `yield* db.query.*`                  | RQB syntax changed in v1.0          | Use `select()`/`insert()`/etc             |
| `sql` without type annotation        | Return type is `unknown`            | `sql<string>\`...\``                      |
| Raw string concatenation in SQL      | SQL injection risk                  | Use `sql` template                        |
| Missing `await cookies()` in queries | Not marked as dynamic               | Add before queries in RSC                 |

---

## See Also

- [DATA_ACCESS_PATTERNS.md](./DATA_ACCESS_PATTERNS.md) - When to use RSC vs server actions
- [SERVER_ACTION_PATTERNS.md](./SERVER_ACTION_PATTERNS.md) - Mutation patterns with validation
- [EFFECT_BEST_PRACTICES.md](./EFFECT_BEST_PRACTICES.md) - Effect-TS patterns
