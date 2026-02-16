# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-17
**Commit:** 1753789
**Branch:** main

## BOILERPLATE REPO

**This is a starter/boilerplate repository.** It is not a project itself - it exists to be cloned as the foundation for new projects.

### When a PRD is Created or Project is Started

Before implementing anything, **ask the user which boilerplate parts to keep** for their specific project. Present the available modules and let them choose:

| Module            | Description                                    | Key Files                                       |
| ----------------- | ---------------------------------------------- | ----------------------------------------------- |
| **Auth**          | better-auth with email OTP, passwordless login | `lib/services/auth/`, `app/(auth)/`, `proxy.ts` |
| **Database**      | Drizzle ORM + PostgreSQL/Neon + Effect SQL     | `lib/services/db/`, `lib/services/db/schema.ts` |
| **Email**         | Resend email sending                           | `lib/services/email/`                           |
| **S3**            | AWS S3 file storage with signed URLs           | `lib/services/s3/`, `lib/core/file/`            |
| **Telegram**      | Telegram bot notifications                     | `lib/services/telegram/`                        |
| **Activity**      | Activity logging via Telegram                  | `lib/services/activity/`                        |
| **UI Components** | shadcn/ui + Base UI primitives                 | `components/ui/`                                |
| **Example Code**  | Post CRUD scaffolding, example routes          | `lib/core/post/`, `app/api/example/`            |

### After User Chooses

1. **Remove unwanted modules** - delete service directories, remove from `lib/layers.ts` AppLayer, delete related routes/pages, clean up unused env vars from `.env.example`
2. **Remove example/scaffolding code** - always remove `lib/core/post/`, example API routes, sample schemas
3. **Rewrite AGENTS.md** - regenerate this file to reflect the actual project being built: update OVERVIEW, STRUCTURE, CODE MAP, WHERE TO LOOK, service dependency hierarchy, and all sections referencing removed modules
4. **Rewrite README.md** - replace boilerplate README with project-specific README: update project name, stack table (only kept modules), getting started instructions, project structure, env vars needed
5. **Update `package.json`** - change name and version to match new project
6. **Update `lib/layers.ts`** - remove layers for deleted services

### What Always Stays

These are core architectural pieces, not optional modules:

- Effect-TS service architecture + patterns
- Next.js App Router structure
- `lib/next-effect/` (Effect/Next.js adapter)
- `lib/core/errors/` (tagged error pattern)
- Tailwind CSS 4 + styling setup
- ESLint rules (Effect-TS rules, no-any, no-as)
- Specs directory (`specs/`) - prune specs for removed modules
- nuqs URL state management

## OVERVIEW

Next.js 16 App Router application with Effect-TS service architecture, Drizzle ORM (PostgreSQL/Neon), better-auth authentication, nuqs URL state management, and Tailwind CSS 4.

## CRITICAL RULES

- **Use `pnpm` exclusively** - not npm or yarn
- **Run `pnpm tsc` before finishing** - ensure types pass
- **Run `pnpm lint` to check for errors** - fix any issues
- **Run `pnpm test:run` to verify tests pass** - fix failures before committing

### Effect-TS Rules (Enforced by ESLint)

| Rule                                            | Description                                           |
| ----------------------------------------------- | ----------------------------------------------------- |
| `local/no-disable-validation`                   | NEVER use `{ disableValidation: true }`               |
| `local/no-catch-all-cause`                      | NEVER use `Effect.catchAllCause` - catches defects    |
| `local/no-schema-from-self`                     | NEVER use `*FromSelf` schemas (use standard variants) |
| `local/no-schema-decode-sync`                   | NEVER use sync decode/encode (throws exceptions)      |
| `local/prefer-option-from-nullable`             | Use `Option.fromNullable()` instead of ternary        |
| `@typescript-eslint/no-explicit-any`            | NEVER use `any` type                                  |
| `@typescript-eslint/consistent-type-assertions` | NEVER use `as` type casts                             |

See `specs/EFFECT_BEST_PRACTICES.md` for detailed explanations and alternatives.

## SPECIFICATIONS

**Before implementing any feature, consult `specs/README.md`.**

- **Specs describe intent; code describes reality.** Check the codebase first before assuming something is/isn't implemented.
- **Use specs as guidance.** Follow patterns, types, and architecture defined in relevant specs.

## STRUCTURE

```
init/
├── proxy.ts                # Cookie-based auth middleware (redirects to /login)
├── app/                    # Next.js App Router pages
│   ├── (auth)/             # Auth route group (login, OTP, logout)
│   ├── (dashboard)/        # Empty - future dashboard
│   └── api/                # API routes (auth catch-all, example)
├── components/ui/          # Modified shadcn/ui + custom components (see AGENTS.md)
├── lib/
│   ├── services/           # Effect-TS service layer (see AGENTS.md)
│   ├── core/               # Domain logic (each subfolder has own errors)
│   ├── next-effect/        # Effect-TS/Next.js adapter
│   ├── schemas/            # Validation schemas
│   ├── layers.ts           # AppLayer composition
│   └── utils.ts            # Utilities (cn helper)
└── lib/utils.ts            # Utilities (cn helper)
```

## WHERE TO LOOK

| Task                 | Location                        | Spec                            |
| -------------------- | ------------------------------- | ------------------------------- |
| Add server action    | `lib/core/[domain]/*-action.ts` | `SERVER_ACTION_PATTERNS.md`     |
| Add domain function  | `lib/core/[domain]/*.ts`        | Pure Effect functions           |
| Add new service      | `lib/services/[name]/`          | `lib/services/AGENTS.md`        |
| Add dynamic page     | `app/*/page.tsx`                | `PAGE_PATTERNS.md`              |
| Add API route        | `app/api/[route]/route.ts`      | Only for webhooks/external APIs |
| Add UI component     | `components/ui/`                | `components/ui/AGENTS.md`       |
| Add tests            | `lib/core/[domain]/*.test.ts`   | `EFFECT_TESTING.md`             |
| Database schema      | `lib/services/db/schema.ts`     | `DRIZZLE_PATTERNS.md`           |
| Database queries     | `lib/core/[domain]/queries.ts`  | `DRIZZLE_PATTERNS.md`           |
| Auth flow            | `app/(auth)/`                   | better-auth + OTP email         |
| Service dependencies | `lib/layers.ts`                 | AppLayer merges all services    |
| Error types          | `lib/core/errors/index.ts`      | `Data.TaggedError` pattern      |
| File uploads         | `lib/core/file/*-action.ts`     | `DATA_ACCESS_PATTERNS.md`       |
| URL state (filters)  | `app/*/search-params.ts`        | `NUQS_URL_STATE.md`             |

## CODE MAP

| Symbol                  | Type     | Location                              | Role                                      |
| ----------------------- | -------- | ------------------------------------- | ----------------------------------------- |
| `AppLayer`              | Layer    | `lib/layers.ts`                       | Merged service layer for Effect pipelines |
| `NextEffect.runPromise` | Function | `lib/next-effect/index.ts`            | Handles redirects outside Effect context  |
| `Auth`                  | Service  | `lib/services/auth/live-layer.ts`     | Authentication (sign in/up/out, sessions) |
| `Db`                    | Service  | `lib/services/db/live-layer.ts`       | Database (returns Drizzle client)         |
| `Email`                 | Service  | `lib/services/email/live-layer.ts`    | Resend email sending                      |
| `S3`                    | Service  | `lib/services/s3/live-layer.ts`       | AWS S3 file operations                    |
| `Telegram`              | Service  | `lib/services/telegram/live-layer.ts` | Telegram bot notifications                |
| `Activity`              | Service  | `lib/services/activity/live-layer.ts` | Activity logging via Telegram             |

## CONVENTIONS

### Code Style (Prettier)

- **Semicolons**
- **No trailing commas**
- Single quotes, 2-space indent, max 100 chars

### File Naming

- **All files use kebab-case** - `search-params.ts`, `post-list.tsx`, `live-layer.ts`
- **Server actions** end in `-action.ts` - `delete-post-action.ts`
- **URL state definitions** - `search-params.ts` in the route directory

### Effect-TS Service Pattern

```typescript
// Services use static layer/Live properties for v4 compatibility
export class ServiceName extends Effect.Service<ServiceName>()('@app/ServiceName', {
  effect: Effect.gen(function* () {
    /* ... */
  })
}) {
  static layer = this.Default;
  static Live = this.layer.pipe(Layer.provide(ConfigLive));
}
```

### Configuration

- **Always** use `Config.string('VAR')` or `Config.redacted('SECRET')`
- **Never** use `process.env` directly with throws

### Observability

- All service methods: `Effect.withSpan('Service.method')`
- Error logging: `Effect.tapError()`
- Span attributes: `Effect.annotateCurrentSpan()`

### Imports

- Use `@/` path alias for project imports
- **No barrel files** - import directly from source files
- Import services from `live-layer.ts` directly

## ANTI-PATTERNS (THIS PROJECT)

| Pattern                               | Correct Approach                                      |
| ------------------------------------- | ----------------------------------------------------- |
| API routes for CRUD operations        | Server actions (`lib/core/[domain]/*-action.ts`)      |
| Streaming files through server        | S3 signed URLs (client uploads directly to S3)        |
| `process.env.X` with throws           | `yield* Config.string('X')`                           |
| `router.push()` for logout            | `window.location.href = '/'` (layout cache issue)     |
| Barrel files (`index.ts` re-exports)  | Import from `live-layer.ts` directly                  |
| `Effect.runPromise()` in pages        | `NextEffect.runPromise()` (handles redirects)         |
| Layer `dependencies` option           | `Layer.provide()` externally (v4 compat)              |
| Multiple services per directory       | One service per directory                             |
| Multiple actions per file             | One action per file ending in `-action.ts`            |
| `useState` for shareable UI state     | nuqs URL state (`app/*/search-params.ts`)             |
| Import `parseAs*` from `nuqs`         | Import from `nuqs/server` in search-params.ts         |
| Direct data fetch in page component   | Suspense + Content pattern (see PAGE_PATTERNS spec)   |
| Nested Suspense with async components | Single Content component fetches all data             |
| Missing `export const dynamic`        | Add `export const dynamic = 'force-dynamic'` for auth |
| Sequential independent queries        | Use `Effect.all([...])` for parallel fetching         |
| Raw SQL strings                       | Use `sql<T>\`...\`` typed templates                   |
| Skipping input validation             | Use `S.decodeUnknown()` in all server actions         |
| Global `Error` in Effect              | Use `Data.TaggedError` for domain errors              |
| `await db.select()...`                | Use `yield* db.select()...` (Drizzle returns Effect)  |

## UNIQUE STYLES

### Next.js + Effect Integration

Pages use `NextEffect.runPromise()` which catches `RedirectError` and calls `redirect()` outside the Effect context. This is required because Next.js redirects must be called outside try-catch.

### UI Components

Uses **Base UI** (`@base-ui/react`) primitives instead of Radix UI. Components are shadcn-styled but built on a different foundation. See `components/ui/AGENTS.md`.

### Service Dependency Hierarchy

```
AppLayer
├── Auth.Live → Email.Live
├── Db.Live
├── Email.Live
├── S3.Live
├── Telegram.Live
└── Activity.Live → Telegram.Live
```

### Auth Middleware

`proxy.ts` provides cookie-based auth middleware. Checks for `better-auth.session_token` cookie, redirects unauthenticated users to `/login`. Sets `x-pathname` header for layout route detection. Public routes: `/`, `/login`.

### Data Access Patterns

See `specs/DATA_ACCESS_PATTERNS.md` for full details. Summary:

| Operation            | Pattern       | Location                                   |
| -------------------- | ------------- | ------------------------------------------ |
| Read data for pages  | RSC           | `app/*/page.tsx`                           |
| Create/Update/Delete | Server Action | `lib/core/[domain]/*-action.ts`            |
| File upload          | S3 signed URL | `lib/core/file/get-upload-url-action.ts`   |
| File download        | S3 signed URL | `lib/core/file/get-download-url-action.ts` |
| External webhooks    | API Route     | `app/api/webhooks/*/route.ts`              |

**Server Action Pattern:**

```typescript
// lib/core/post/delete-post-action.ts
'use server'

export const deletePostAction = async (postId: Post['id']) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()
      yield* deletePost(postId)
    }).pipe(
      Effect.withSpan('action.post.delete'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error => /* handle errors */,
        onSuccess: () => Effect.sync(() => revalidatePath('/posts'))
      })
    )
  )
}
```

## NOTES

- **No CI/CD configured** - deployment via Vercel auto-deploy
- **React Compiler enabled** - automatic memoization (experimental)
- **Drizzle beta** - using `1.0.0-beta.11`, may have breaking changes
- Effect v4 migration: services designed for easy `Effect.Service` → `ServiceMap.Service` transition
- **Delete example files after setup** - Example schemas (post), sample routes, and template files are scaffolding only. Remove once real structure established
- **This is a boilerplate repo** - See BOILERPLATE REPO section above. When starting a new project, ask user which modules to keep and rewrite AGENTS.md + README.md after cleanup

## SUBDIRECTORY DOCS

- `lib/services/AGENTS.md` - Effect-TS service architecture patterns
- `components/ui/AGENTS.md` - UI component patterns and customizations
