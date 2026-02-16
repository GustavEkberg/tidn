# Page Patterns for Dynamic Routes

This document defines patterns for building pages that require authentication or other dynamic server features in Next.js 16 with Effect-TS.

## The Problem

Next.js attempts to statically prerender pages at build time. Pages that use `cookies()`, `headers()`, or authentication fail during this prerendering phase with errors like:

```
Error: Dynamic server usage: Route /dashboard couldn't be rendered statically
because it used `cookies`. See more info here: https://nextjs.org/docs/messages/dynamic-server-error
```

## Solution: Suspense + Content Pattern

Wrap data-fetching code in a `Content` component inside `Suspense`, and explicitly mark pages as dynamic.

### Required Elements

1. **`export const dynamic = 'force-dynamic'`** - Opt out of static generation
2. **`await cookies()`** - Called at start of Content to ensure dynamic rendering
3. **`<Suspense>` wrapper** - Provides loading state during server render
4. **`Effect.matchEffect`** - Typed error handling with redirects

## Pattern: Basic Dynamic Page

```typescript
// app/(dashboard)/posts/page.tsx
import { Suspense } from 'react'
import { Effect, Match } from 'effect'
import { cookies } from 'next/headers'
import { NextEffect } from '@/lib/next-effect'
import { AppLayer } from '@/lib/layers'
import { getSession } from '@/lib/services/auth/get-session'
import { getPosts } from '@/lib/core/post/get-posts'

export const dynamic = 'force-dynamic'

async function Content() {
  await cookies()

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()
      const posts = yield* getPosts({ userId: session.user.id })

      return (
        <div className="p-6">
          <h1 className="text-2xl font-bold">Posts</h1>
          <PostList posts={posts} />
        </div>
      )
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed(
                <div className="p-6">
                  <p>Something went wrong.</p>
                  <p className="text-red-500">Error: {error.message}</p>
                </div>
              )
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  )
}

export default async function PostsPage() {
  return (
    <Suspense fallback={<p className="p-6">Laddar...</p>}>
      <Content />
    </Suspense>
  )
}
```

## Pattern: Page with URL State (nuqs)

When using nuqs for filters/search, pass searchParams to Content:

```typescript
// app/(dashboard)/posts/page.tsx
import { Suspense } from 'react'
import { Effect, Match } from 'effect'
import { cookies } from 'next/headers'
import type { SearchParams } from 'nuqs/server'
import { NextEffect } from '@/lib/next-effect'
import { AppLayer } from '@/lib/layers'
import { getSession } from '@/lib/services/auth/get-session'
import { getPosts } from '@/lib/core/post/get-posts'
import { loadSearchParams } from './search-params'
import { PostFilters } from './post-filters'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<SearchParams>
}

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await cookies()

  const { q, status, sortBy } = await loadSearchParams(searchParams)

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()
      const posts = yield* getPosts({
        userId: session.user.id,
        query: q,
        status,
        sortBy
      })

      return (
        <div className="p-6">
          <h1 className="text-2xl font-bold">Posts</h1>
          <PostFilters />
          <PostList posts={posts} />
        </div>
      )
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed(
                <div className="p-6">
                  <p>Something went wrong.</p>
                  <p className="text-red-500">Error: {error.message}</p>
                </div>
              )
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  )
}

export default async function PostsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<p className="p-6">Laddar...</p>}>
      <Content searchParams={searchParams} />
    </Suspense>
  )
}
```

## Pattern: Admin-Only Page with Role Check

Redirect non-admins inside the Effect pipeline using `NextEffect.redirect()`:

```typescript
async function Content() {
  await cookies()

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()

      // Role check inside Effect - redirects cleanly
      if (session.user.role !== 'ADMIN') {
        return yield* NextEffect.redirect('/dashboard')
      }

      const users = yield* getUsers()

      return (
        <div className="p-6">
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <UserList users={users} />
        </div>
      )
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed(
                <div className="p-6">
                  <p>Something went wrong.</p>
                  <p className="text-red-500">Error: {error.message}</p>
                </div>
              )
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  )
}
```

## Pattern: Conditional Data Loading

Load different data based on user role without nested async components:

```typescript
async function Content() {
  await cookies()

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()
      const isAdmin = session.user.role === 'ADMIN'

      // User data - always loaded
      const userPosts = yield* getPosts({ userId: session.user.id })

      // Non-admin: return early with just user data
      if (!isAdmin) {
        return (
          <div className="p-6">
            <h1 className="text-2xl font-bold">My Posts</h1>
            <PostList posts={userPosts} />
          </div>
        )
      }

      // Admin: load additional data
      const allPosts = yield* getAllPosts()
      const analytics = yield* getAnalytics()

      return (
        <div className="p-6">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <Analytics data={analytics} />
          <h2 className="text-xl font-semibold mt-8">All Posts</h2>
          <PostList posts={allPosts} />
          <h2 className="text-xl font-semibold mt-8">My Posts</h2>
          <PostList posts={userPosts} />
        </div>
      )
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed(
                <div className="p-6">
                  <p>Something went wrong.</p>
                  <p className="text-red-500">Error: {error.message}</p>
                </div>
              )
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  )
}
```

## Anti-Patterns

### NEVER: Nested Suspense with Async Server Components

Nested async server components inside Suspense boundaries cause prerendering failures:

```typescript
// BAD - Will fail during build
async function Content() {
  await cookies()

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()

      return (
        <div>
          {/* This nested async component causes issues */}
          <Suspense fallback={<Loading />}>
            <AdminData />  {/* Another async server component */}
          </Suspense>
        </div>
      )
    })
  )
}

async function AdminData() {
  // Even with await cookies() here, this causes problems
  await cookies()
  const data = await fetchData()
  return <div>{data}</div>
}
```

**Solution:** Fetch all data in a single Content component and pass to client components:

```typescript
// GOOD - All data fetched in one place
async function Content() {
  await cookies()

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()
      const adminData = yield* getAdminData()

      return (
        <div>
          <AdminPanel data={adminData} />  {/* Client component */}
        </div>
      )
    })
  )
}
```

### NEVER: Missing `export const dynamic`

Without explicit dynamic marking, Next.js attempts static prerendering:

```typescript
// BAD - No dynamic export
async function Content() {
  await cookies(); // This alone is not enough!
  // ...
}
```

**Solution:** Always add at the top of the file:

```typescript
export const dynamic = 'force-dynamic';
```

### NEVER: Auth Outside Effect Pipeline

Don't call `redirect()` directly outside the Effect context:

```typescript
// BAD - redirect() outside Effect
async function Content() {
  await cookies();
  const session = await getSessionSomehow();

  if (!session) {
    redirect('/login'); // This won't work correctly with Effect
  }
}
```

**Solution:** Use `NextEffect.redirect()` inside the Effect pipeline:

```typescript
// GOOD - redirect inside Effect
return await NextEffect.runPromise(
  Effect.gen(function* () {
    const session = yield* getSession();
    if (!session.user.isAdmin) {
      return yield* NextEffect.redirect('/dashboard');
    }
    // ...
  })
);
```

## Error Handling Pattern

Always use `Effect.matchEffect` with typed error tags:

```typescript
Effect.matchEffect({
  onFailure: error =>
    Match.value(error._tag).pipe(
      // Auth errors -> redirect to login
      Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
      // Permission errors -> redirect to home
      Match.when('UnauthorizedError', () => NextEffect.redirect('/')),
      // All other errors -> show error UI
      Match.orElse(() =>
        Effect.succeed(
          <div className="p-6">
            <p>Something went wrong.</p>
            <p className="text-red-500">Error: {error.message}</p>
          </div>
        )
      )
    ),
  onSuccess: Effect.succeed
})
```

## Pattern: Passing Data to Client Components

When passing data from server to client components, ensure all data is serializable:

### Server Component

```typescript
async function Content({ searchParams }: Props) {
  await cookies();

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();

      // Fetch multiple data sources in parallel
      const [transactions, categories, stats] = yield* Effect.all([
        getTransactions({ userId: session.user.id }),
        getCategories(),
        getStats(session.user.id)
      ]);

      // Convert non-serializable types before passing to client
      // Maps -> Arrays, Classes -> Plain objects
      const statsArray = Array.from(stats.byCategory.entries()).map(([id, data]) => ({
        categoryId: id,
        ...data
      }));

      // Pass ONLY serializable data to client component
      return (
        <DashboardContent
          // Plain objects and arrays are fine
          transactions={transactions}
          // Pick only needed fields to reduce payload
          categories={categories.map(c => ({
            id: c.id,
            name: c.name,
            icon: c.icon
          }))}
          // Converted Map data
          categoryStats={statsArray}
          // Primitives
          userName={session.user.name}
        />
      );
    }).pipe(/* ... */)
  );
}
```

### Client Component Props Types

Define types locally in client components - don't import server-side types:

```typescript
// components/dashboard-content.tsx
'use client';

// Define types locally - these match the serialized shape
type Transaction = {
  id: string;
  date: Date;         // RSC serializes Dates correctly
  merchant: string;
  amount: string;     // Decimal columns return strings
  categoryId: string | null;
};

type Category = {
  id: string;
  name: string;
  icon: string | null;
};

type CategoryStat = {
  categoryId: string;
  total: number;
  count: number;
};

type Props = {
  transactions: Transaction[];
  categories: Category[];
  categoryStats: CategoryStat[];
  userName: string;
};

export function DashboardContent({
  transactions,
  categories,
  categoryStats,
  userName
}: Props) {
  // All data received via props - no fetching in client component
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Client-side filtering, sorting, etc.
  const filtered = selectedCategory
    ? transactions.filter(t => t.categoryId === selectedCategory)
    : transactions;

  return (
    <div>
      <h1>Welcome, {userName}</h1>
      <CategoryFilter categories={categories} onSelect={setSelectedCategory} />
      <TransactionList transactions={filtered} />
    </div>
  );
}
```

### Serialization Rules

| Type                | Serializable? | Solution                                      |
| ------------------- | ------------- | --------------------------------------------- |
| Plain objects       | Yes           | Pass directly                                 |
| Arrays              | Yes           | Pass directly                                 |
| Dates               | Yes           | RSC handles Date serialization                |
| Strings/Numbers     | Yes           | Pass directly                                 |
| `Map`               | No            | Convert to array of `[key, value]` or objects |
| `Set`               | No            | Convert to array                              |
| Classes             | Partial       | Pick plain fields, don't pass methods         |
| Functions           | No            | Never pass functions as props                 |
| `Decimal` (Drizzle) | Partial       | Returns as string, parse in client if needed  |

## Checklist for New Pages

- [ ] Add `export const dynamic = 'force-dynamic'` at top of file
- [ ] Create `Content` async function with `await cookies()` as first line
- [ ] Wrap Content in `<Suspense>` with appropriate fallback
- [ ] Use `Effect.matchEffect` for error handling
- [ ] Handle `UnauthenticatedError` with redirect to `/login`
- [ ] Fetch all data in single Effect pipeline (no nested async components)
- [ ] Pass data to client components as props
- [ ] Ensure all props are serializable (no Maps, Sets, or functions)
- [ ] Define prop types locally in client components

## Summary

| Element                   | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `export const dynamic`    | Opt out of static prerendering             |
| `await cookies()`         | Signal dynamic rendering to Next.js        |
| `<Suspense>` wrapper      | Provide loading state                      |
| `NextEffect.runPromise()` | Handle redirects outside Effect context    |
| `Effect.matchEffect`      | Typed error handling with clean redirects  |
| Single Content component  | Avoid nested async server component issues |
| `Effect.all([...])`       | Parallel data fetching                     |
| Serializable props        | Client components receive plain data       |

## See Also

- [DATA_ACCESS_PATTERNS.md](./DATA_ACCESS_PATTERNS.md) - When to use RSC vs server actions
- [SERVER_ACTION_PATTERNS.md](./SERVER_ACTION_PATTERNS.md) - Mutation patterns
- [NUQS_URL_STATE.md](./NUQS_URL_STATE.md) - URL state with nuqs
