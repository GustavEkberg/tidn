# Data Access Patterns

This document defines how data flows between the client and server in this Next.js application with Effect-TS.

## Decision Tree

```
Need to fetch data for initial page render?
  └─> Use RSC (React Server Components)

Need to mutate data (create, update, delete)?
  └─> Use Server Actions

Need to handle file uploads/downloads?
  └─> Use S3 signed URLs via Server Actions

Need multiple independent queries?
  └─> Use Effect.all() in RSC or Server Actions

Need webhook endpoints for external services?
  └─> Use API routes
```

## Pattern 1: RSC for Data Loading

Load data directly in Server Components using Effect-TS. This is the **default pattern** for all read operations.

> **Important:** For pages that require authentication, see `specs/PAGE_PATTERNS.md` for the required Suspense + Content pattern with `export const dynamic = 'force-dynamic'`.

### When to Use

- Page initial render
- Layout data (user session, navigation counts)
- Any read-only data fetch

### Pattern (for authenticated pages)

```typescript
// app/posts/page.tsx
import { Suspense } from 'react'
import { Effect, Match } from 'effect'
import { cookies } from 'next/headers'
import { AppLayer } from '@/lib/layers'
import { NextEffect } from '@/lib/next-effect'
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
        <div>
          {posts.map(post => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() => Effect.succeed(<ErrorMessage error={error} />))
          ),
        onSuccess: Effect.succeed
      })
    )
  )
}

export default async function PostsPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Content />
    </Suspense>
  )
}
```

### Domain Function

```typescript
// lib/core/post/get-posts.ts
import { Effect } from 'effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq } from 'drizzle-orm';

export const getPosts = () =>
  Effect.gen(function* () {
    const { user } = yield* getSession();
    const db = yield* Db;

    const posts = yield* db.select().from(schema.post).where(eq(schema.post.userId, user.id));

    return posts;
  }).pipe(Effect.withSpan('Post.getPosts'));
```

### Parallel Data Fetching with Effect.all

When a page needs multiple independent data sources, use `Effect.all()` to fetch them concurrently:

```typescript
// app/(dashboard)/page.tsx
async function Content() {
  await cookies();

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();

      // Fetch all data in parallel
      const [posts, categories, stats, recentActivity] = yield* Effect.all([
        getPosts({ userId: session.user.id }),
        getCategories(),
        getUserStats(session.user.id),
        getRecentActivity(session.user.id)
      ]);

      return (
        <DashboardContent
          posts={posts}
          categories={categories}
          stats={stats}
          recentActivity={recentActivity}
        />
      );
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() => Effect.succeed(<ErrorPage />))
          ),
        onSuccess: Effect.succeed
      })
    )
  );
}
```

**Key points:**

- `Effect.all([...])` runs all effects concurrently
- Fails fast if any effect fails
- Results are returned in array order matching input
- Use for independent queries that don't depend on each other's results

For complex queries with joins and aggregations, see [DRIZZLE_PATTERNS.md](./DRIZZLE_PATTERNS.md).

## Pattern 2: Server Actions for Mutations

Use Server Actions for all data mutations. One action per file, always ending in `-action.ts`.

### When to Use

- Creating records
- Updating records
- Deleting records
- Any operation that changes server state

### File Naming Convention

```
lib/core/[domain]/
├── get-posts.ts           # Read function (used in RSC)
├── create-post-action.ts  # Server action
├── update-post-action.ts  # Server action
├── delete-post-action.ts  # Server action
└── errors.ts              # Domain-specific errors
```

### Server Action Pattern

```typescript
// lib/core/post/delete-post-action.ts
'use server';

import { Effect, Match } from 'effect';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Post } from '@/lib/services/db/schema';
import { deletePost } from './delete-post';

export const deletePostAction = async (postId: Post['id']) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'user.email': session.user.email
      });

      return yield* deletePost(postId);
    }).pipe(
      Effect.withSpan('action.post.delete', {
        attributes: {
          'post.id': postId,
          operation: 'post.delete'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('UnauthorizedError', () => NextEffect.redirect('/')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Something went wrong: ${error.message}`
              })
            )
          ),
        onSuccess: () => Effect.sync(() => revalidatePath('/posts'))
      })
    )
  );
};
```

### Client Component Usage

```typescript
// components/delete-post-dialog.tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { deletePostAction } from '@/lib/core/post/delete-post-action'

export function DeletePostButton({ postId }: { postId: string }) {
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deletePostAction(postId)

      if (result?._tag === 'Error') {
        toast.error(result.message)
        return
      }

      toast.success('Post deleted')
    })
  }

  return (
    <button onClick={handleDelete} disabled={isPending}>
      {isPending ? 'Deleting...' : 'Delete'}
    </button>
  )
}
```

### Action Return Types

Server actions should return one of:

1. **Nothing** (void) - Action succeeded, page revalidated
2. **Error object** - Action failed with user-facing message
3. **Data** - Action succeeded with data to display

```typescript
// Success with revalidation (most common for mutations)
Effect.matchEffect({
  onFailure: error => /* ... */,
  onSuccess: () => Effect.sync(() => revalidatePath('/posts'))
})

// Success with data return
Effect.matchEffect({
  onFailure: error => /* ... */,
  onSuccess: data => Effect.succeed({ _tag: 'Success' as const, data })
})
```

## Pattern 3: S3 Signed URLs for File Operations

Use Server Actions to generate signed URLs, then upload/download directly from the client.

### File Upload Flow

```
1. Client calls server action with file metadata
2. Server action generates signed upload URL
3. Client uploads directly to S3 using signed URL
4. Client calls another server action to save the file reference
```

### Get Signed Upload URL Action

```typescript
// lib/core/document/get-upload-url-action.ts
'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { S3 } from '@/lib/services/s3/live-layer';

type UploadUrlInput = {
  fileName: string;
  folder: string;
};

export const getUploadUrlAction = async (input: UploadUrlInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();
      const s3 = yield* S3;

      // Generate unique key with user context
      const key = `${input.folder}/${session.user.id}/${Date.now()}-${input.fileName}`;

      const signedUrl = yield* s3.createSignedUrl(key, 300); // 5 min expiry
      const publicUrl = s3.getUrlFromObjectKey(key);

      return {
        _tag: 'Success' as const,
        signedUrl,
        publicUrl,
        key
      };
    }).pipe(
      Effect.withSpan('action.document.getUploadUrl', {
        attributes: {
          'file.name': input.fileName,
          'file.folder': input.folder
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to generate upload URL'
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
};
```

### Save File Reference Action

```typescript
// lib/core/document/save-document-action.ts
'use server';

import { Effect, Match } from 'effect';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';

type SaveDocumentInput = {
  name: string;
  fileUrl: string;
};

export const saveDocumentAction = async (input: SaveDocumentInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();
      const db = yield* Db;

      yield* db.insert(schema.document).values({
        name: input.name,
        fileUrl: input.fileUrl,
        uploadedBy: session.user.id
      });
    }).pipe(
      Effect.withSpan('action.document.save', {
        attributes: {
          'document.name': input.name
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to save document'
              })
            )
          ),
        onSuccess: () => Effect.sync(() => revalidatePath('/documents'))
      })
    )
  );
};
```

### Client Upload Component

```typescript
// components/file-upload.tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { getUploadUrlAction } from '@/lib/core/document/get-upload-url-action'
import { saveDocumentAction } from '@/lib/core/document/save-document-action'

export function FileUpload({ folder }: { folder: string }) {
  const [isUploading, setIsUploading] = useState(false)

  const handleUpload = async (file: File) => {
    setIsUploading(true)

    try {
      // 1. Get signed URL from server
      const urlResult = await getUploadUrlAction({
        fileName: file.name,
        folder
      })

      if (urlResult._tag === 'Error') {
        toast.error(urlResult.message)
        return
      }

      // 2. Upload directly to S3
      const uploadResponse = await fetch(urlResult.signedUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type
        }
      })

      if (!uploadResponse.ok) {
        toast.error('Upload failed')
        return
      }

      // 3. Save file reference to database
      const saveResult = await saveDocumentAction({
        name: file.name,
        fileUrl: urlResult.publicUrl
      })

      if (saveResult?._tag === 'Error') {
        toast.error(saveResult.message)
        return
      }

      toast.success('File uploaded successfully')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <input
      type="file"
      disabled={isUploading}
      onChange={e => {
        const file = e.target.files?.[0]
        if (file) handleUpload(file)
      }}
    />
  )
}
```

### File Download with Signed URL

For private files that need temporary access:

```typescript
// lib/core/document/get-download-url-action.ts
'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { S3 } from '@/lib/services/s3/live-layer';

export const getDownloadUrlAction = async (fileUrl: string) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* getSession(); // Ensure authenticated
      const s3 = yield* S3;

      const key = s3.getObjectKeyFromUrl(fileUrl);
      const signedUrl = yield* s3.createSignedUrl(key, 60); // 1 min expiry for download

      return { _tag: 'Success' as const, signedUrl };
    }).pipe(
      Effect.withSpan('action.document.getDownloadUrl'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to generate download URL'
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
};
```

## Pattern 4: API Routes (Exception Cases)

Only use API routes when:

1. **External webhooks** - Services calling your app (Stripe, auth callbacks)
2. **Parallelization needed** - Multiple independent DB queries that benefit from parallel execution
3. **Non-browser clients** - Mobile apps, CLI tools, third-party integrations

### When NOT to Use API Routes

- Regular CRUD operations (use server actions)
- Data loading for pages (use RSC)
- File uploads/downloads (use S3 signed URLs)

### API Route Pattern (if needed)

```typescript
// app/api/webhooks/stripe/route.ts
import { Effect, Match } from 'effect';
import { HttpApp, HttpServerResponse } from '@effect/platform';
import { ManagedRuntime } from 'effect';
import { AppLayer } from '@/lib/layers';
import { handleStripeWebhook } from '@/lib/core/billing/handle-stripe-webhook';

const postHandler = Effect.gen(function* () {
  yield* handleStripeWebhook();
  return yield* HttpServerResponse.json({ received: true });
}).pipe(
  Effect.catchAll(error =>
    Match.value(error).pipe(
      Match.tag('WebhookVerificationError', () =>
        HttpServerResponse.json({ error: 'Invalid signature' }, { status: 400 })
      ),
      Match.orElse(() => HttpServerResponse.json({ error: 'Internal error' }, { status: 500 }))
    )
  )
);

const managedRuntime = ManagedRuntime.make(AppLayer);
const runtime = await managedRuntime.runtime();
const effectHandler = HttpApp.toWebHandlerRuntime(runtime)(postHandler);

export const POST = (request: Request) => effectHandler(request);
```

## Summary: Which Pattern to Use

| Operation            | Pattern                 | Location                         |
| -------------------- | ----------------------- | -------------------------------- |
| Page data loading    | RSC                     | `app/*/page.tsx`                 |
| Create/Update/Delete | Server Action           | `lib/core/[domain]/*-action.ts`  |
| File upload          | S3 signed URL + Action  | `lib/core/[domain]/*-action.ts`  |
| File download        | S3 signed URL + Action  | `lib/core/[domain]/*-action.ts`  |
| External webhooks    | API Route               | `app/api/webhooks/*/route.ts`    |
| Auth callbacks       | API Route (better-auth) | `app/api/auth/[...all]/route.ts` |
| Third-party API      | API Route               | `app/api/*/route.ts`             |

## Key Principles

1. **Prefer server actions over API routes** - Less boilerplate, better type safety
2. **One action per file** - Easier to find, test, and maintain
3. **Use `revalidatePath`** - Keep UI in sync after mutations
4. **Always use `NextEffect.runPromise`** - Handles redirects correctly
5. **Consistent error handling** - Return typed error objects for client handling
6. **S3 for all files** - Never stream files through your server
7. **Use `Effect.all()` for parallel queries** - Don't fetch sequentially when queries are independent

## See Also

- [DRIZZLE_PATTERNS.md](./DRIZZLE_PATTERNS.md) - Database query patterns
- [SERVER_ACTION_PATTERNS.md](./SERVER_ACTION_PATTERNS.md) - Complete action templates
- [PAGE_PATTERNS.md](./PAGE_PATTERNS.md) - Suspense + Content pattern
