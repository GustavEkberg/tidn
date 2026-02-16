# Server Action Patterns

Complete patterns for server actions with Effect-TS, including validation, error handling, and observability.

## File Structure

```
lib/core/
├── errors/
│   └── index.ts              # Shared domain errors
├── transaction/
│   ├── create-transaction-action.ts
│   ├── update-transaction-action.ts
│   ├── delete-transaction-action.ts
│   └── queries.ts            # Read-only queries (not actions)
├── category/
│   ├── create-category-action.ts
│   └── delete-category-action.ts
```

**Rules:**

- One action per file
- File name: `{verb}-{entity}-action.ts`
- Queries (read-only) go in `queries.ts`, not as actions

---

## Domain Errors

Define errors in `lib/core/errors/index.ts`:

```typescript
import { Data } from 'effect';

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  message: string;
  entity: string;
  id: string;
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  message: string;
  field?: string;
}> {}

export class UnauthenticatedError extends Data.TaggedError('UnauthenticatedError')<{
  message: string;
}> {}

export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  message: string;
  requiredRole?: string;
}> {}

export class ConstraintError extends Data.TaggedError('ConstraintError')<{
  message: string;
  constraint: string;
}> {}
```

---

## Complete Server Action Template

```typescript
// lib/core/category/create-category-action.ts
'use server';

import { Effect, Match, Schema as S } from 'effect';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ValidationError, UnauthenticatedError } from '@/lib/core/errors';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
// Define with Effect Schema for runtime validation
const CreateCategoryInput = S.Struct({
  name: S.String.pipe(S.minLength(1), S.maxLength(100)),
  description: S.optional(S.String.pipe(S.maxLength(500))),
  icon: S.optional(S.String.pipe(S.maxLength(10)))
});

type CreateCategoryInput = S.Schema.Type<typeof CreateCategoryInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const createCategoryAction = async (input: CreateCategoryInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(CreateCategoryInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Category name is required (1-100 characters)',
              field: 'name'
            })
        )
      );

      // --------------------------------------------------------
      // 4. AUTHENTICATE
      // --------------------------------------------------------
      const session = yield* getSession();

      // --------------------------------------------------------
      // 5. GET DATABASE
      // --------------------------------------------------------
      const db = yield* Db;

      // --------------------------------------------------------
      // 6. ADD SPAN ATTRIBUTES (for observability)
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'category.name': parsed.name
      });

      // --------------------------------------------------------
      // 7. BUSINESS LOGIC
      // --------------------------------------------------------
      const [category] = yield* db
        .insert(schema.category)
        .values({
          name: parsed.name,
          description: parsed.description,
          icon: parsed.icon,
          isDefault: false
        })
        .returning();

      return category;
    }).pipe(
      // --------------------------------------------------------
      // 8. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.category.create', {
        attributes: { operation: 'category.create' }
      }),

      // --------------------------------------------------------
      // 9. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 10. HANDLE RESULT
      // --------------------------------------------------------
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            // Redirect to login if not authenticated
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),

            // Return user-friendly error for validation
            Match.when('ValidationError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),

            // Fallback for unexpected errors
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to create category'
              })
            )
          ),

        onSuccess: category =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 11. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath('/categories');

            return {
              _tag: 'Success' as const,
              category
            };
          })
      })
    )
  );
};
```

---

## Response Pattern

All server actions return a discriminated union:

```typescript
// Success response
{ _tag: 'Success', ...data }

// Error response
{ _tag: 'Error', message: string }
```

**Client consumption:**

```typescript
'use client';

const handleSubmit = async () => {
  const result = await createCategoryAction({ name, description, icon });

  if (result._tag === 'Error') {
    toast.error(result.message);
    return;
  }

  toast.success(`Created ${result.category.name}`);
  router.push('/categories');
};
```

---

## Error Handling Patterns

### Pattern: Match on Error Tags

```typescript
Effect.matchEffect({
  onFailure: error =>
    Match.value(error._tag).pipe(
      Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
      Match.when('UnauthorizedError', () =>
        Effect.succeed({ _tag: 'Error' as const, message: 'Permission denied' })
      ),
      Match.when('NotFoundError', () =>
        Effect.succeed({ _tag: 'Error' as const, message: error.message })
      ),
      Match.when('ValidationError', () =>
        Effect.succeed({ _tag: 'Error' as const, message: error.message })
      ),
      Match.when('ConstraintError', () =>
        Effect.succeed({ _tag: 'Error' as const, message: error.message })
      ),
      Match.orElse(() =>
        Effect.succeed({ _tag: 'Error' as const, message: 'Operation failed' })
      )
    ),
  onSuccess: // ...
})
```

### Pattern: Yielding Errors

Return domain errors directly in the Effect:

```typescript
Effect.gen(function* () {
  const db = yield* Db;

  // Check existence
  const existing = yield* db
    .select()
    .from(schema.category)
    .where(eq(schema.category.id, parsed.id))
    .limit(1);

  if (!existing.length) {
    return yield* new NotFoundError({
      message: 'Category not found',
      entity: 'category',
      id: parsed.id
    });
  }

  // Check constraints
  if (existing[0].isDefault) {
    return yield* new ConstraintError({
      message: 'Cannot delete default categories',
      constraint: 'isDefault'
    });
  }

  // Proceed with deletion...
});
```

### Pattern: Transform Schema Errors

```typescript
const parsed =
  yield *
  S.decodeUnknown(InputSchema)(input).pipe(
    Effect.mapError(
      parseError =>
        new ValidationError({
          message: formatSchemaError(parseError), // Custom formatter
          field: 'input'
        })
    )
  );
```

---

## Input Validation

### Common Schema Patterns

```typescript
import { Schema as S } from 'effect';

// Required string with length constraints
const Name = S.String.pipe(S.minLength(1), S.maxLength(100));

// Optional string
const Description = S.optional(S.String.pipe(S.maxLength(500)));

// Enum/literal union
const Status = S.Literal('pending', 'approved', 'rejected');

// Email
const Email = S.String.pipe(S.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));

// Positive number
const Amount = S.Number.pipe(S.positive());

// Date (from ISO string)
const DateFromString = S.Date;

// Array with constraints
const Tags = S.Array(S.String).pipe(S.minItems(1), S.maxItems(10));

// Full struct
const CreatePostInput = S.Struct({
  title: Name,
  content: S.String.pipe(S.minLength(1)),
  status: S.optional(Status),
  tags: S.optional(Tags)
});
```

### Validation in Action

```typescript
export const createPostAction = async (input: CreatePostInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Validate at the boundary
      const parsed = yield* S.decodeUnknown(CreatePostInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: title required, max 100 chars',
              field: 'title'
            })
        )
      );

      // `parsed` is now fully typed and validated
      // ...
    })
  );
};
```

---

## Cache Revalidation

### Path Revalidation

```typescript
// Revalidate specific path
revalidatePath('/categories');

// Revalidate with layout
revalidatePath('/categories', 'layout');

// Revalidate dynamic route
revalidatePath(`/posts/${postId}`);
```

### Tag Revalidation

```typescript
// In data fetching (page or query)
const posts = await fetch('/api/posts', { next: { tags: ['posts'] } });

// In server action after mutation
revalidateTag('posts');
```

### When to Use Which

| Scenario                      | Method                            |
| ----------------------------- | --------------------------------- |
| Single page update            | `revalidatePath('/path')`         |
| Multiple pages with same data | `revalidateTag('tag')`            |
| Related pages (list + detail) | Multiple `revalidatePath()` calls |

---

## Observability

### Span Names

Follow the pattern: `action.{entity}.{verb}`

```typescript
Effect.withSpan('action.category.create');
Effect.withSpan('action.post.update');
Effect.withSpan('action.transaction.delete');
Effect.withSpan('action.user.updateProfile');
```

### Span Attributes

Add context for debugging:

```typescript
Effect.gen(function* () {
  yield* Effect.annotateCurrentSpan({
    'user.id': session.user.id,
    'entity.id': parsed.id,
    'entity.type': 'category'
  });

  // ... business logic
});
```

### Error Logging

```typescript
Effect.tapError(error =>
  Effect.logError('Category creation failed', {
    error: error.message,
    input: { name: parsed.name }
  })
);
```

---

## Delete Action Example

```typescript
// lib/core/category/delete-category-action.ts
'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ValidationError, NotFoundError, ConstraintError } from '@/lib/core/errors';

const DeleteCategoryInput = S.Struct({
  id: S.String.pipe(S.minLength(1))
});

type DeleteCategoryInput = S.Schema.Type<typeof DeleteCategoryInput>;

export const deleteCategoryAction = async (input: DeleteCategoryInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const parsed = yield* S.decodeUnknown(DeleteCategoryInput)(input).pipe(
        Effect.mapError(() => new ValidationError({ message: 'Invalid ID', field: 'id' }))
      );

      yield* getSession();
      const db = yield* Db;

      yield* Effect.annotateCurrentSpan({ 'category.id': parsed.id });

      // Check existence
      const [existing] = yield* db
        .select()
        .from(schema.category)
        .where(eq(schema.category.id, parsed.id))
        .limit(1);

      if (!existing) {
        return yield* new NotFoundError({
          message: 'Category not found',
          entity: 'category',
          id: parsed.id
        });
      }

      // Check constraints
      if (existing.isDefault) {
        return yield* new ConstraintError({
          message: 'Cannot delete default categories',
          constraint: 'isDefault'
        });
      }

      // Perform deletion
      yield* db.delete(schema.category).where(eq(schema.category.id, parsed.id));

      return { id: parsed.id, name: existing.name };
    }).pipe(
      Effect.withSpan('action.category.delete'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () =>
              Effect.succeed({ _tag: 'Error' as const, message: error.message })
            ),
            Match.when('ConstraintError', () =>
              Effect.succeed({ _tag: 'Error' as const, message: error.message })
            ),
            Match.orElse(() =>
              Effect.succeed({ _tag: 'Error' as const, message: 'Failed to delete' })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath('/categories');
            return { _tag: 'Success' as const, ...result };
          })
      })
    )
  );
};
```

---

## Anti-Patterns

| Pattern                        | Problem                  | Correct Approach           |
| ------------------------------ | ------------------------ | -------------------------- |
| Multiple actions per file      | Hard to find, test       | One action per file        |
| `Effect.runPromise()`          | Misses redirect handling | `NextEffect.runPromise()`  |
| Skipping validation            | Runtime errors, security | Always `S.decodeUnknown()` |
| Generic error messages         | Poor UX                  | Domain-specific messages   |
| Missing `Effect.scoped`        | Resource leaks           | Always include             |
| `try/catch` around action call | Loses structure          | Check `result._tag`        |
| Throwing in generator          | Becomes defect           | `yield* new Error()`       |
| Missing span                   | No tracing               | `Effect.withSpan()`        |

---

## Checklist

Before committing a server action, verify:

- [ ] File is named `{verb}-{entity}-action.ts`
- [ ] Has `'use server'` directive at top
- [ ] Input schema defined with `S.Struct`
- [ ] Uses `S.decodeUnknown()` for validation
- [ ] Calls `getSession()` if auth required
- [ ] Uses `Effect.annotateCurrentSpan()` for context
- [ ] Has `Effect.withSpan('action.entity.verb')`
- [ ] Uses `Effect.provide(AppLayer)` and `Effect.scoped`
- [ ] Returns `{ _tag: 'Success' | 'Error', ... }`
- [ ] Handles all error types with `Match`
- [ ] Redirects on `UnauthenticatedError`
- [ ] Calls `revalidatePath()` after mutations

---

## See Also

- [DATA_ACCESS_PATTERNS.md](./DATA_ACCESS_PATTERNS.md) - When to use actions vs RSC
- [DRIZZLE_PATTERNS.md](./DRIZZLE_PATTERNS.md) - Database query patterns
- [EFFECT_BEST_PRACTICES.md](./EFFECT_BEST_PRACTICES.md) - Effect-TS rules
