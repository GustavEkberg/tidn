# PROJECT KNOWLEDGE BASE

**Project:** tidn — collaborative timeline app for sharing photos, videos, and moments
**Updated:** 2026-02-16

## OVERVIEW

Next.js 16 App Router application with Effect-TS service architecture, Drizzle ORM (PostgreSQL/Neon), better-auth authentication (email OTP, passwordless), S3 media storage, nuqs URL state management, and Tailwind CSS 4.

Users create timelines, invite collaborators (editor/viewer roles), and add events with dates, comments, and media (photos/videos). Media is uploaded directly to S3 via signed URLs with server-side processing (EXIF stripping, thumbnail generation).

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
tidn/
├── proxy.ts                # Cookie-based auth middleware (redirects to /login)
├── app/                    # Next.js App Router pages
│   ├── (auth)/             # Auth route group (login, OTP, logout)
│   ├── timeline/[id]/      # Timeline view + settings (future)
│   └── api/                # API routes (auth catch-all)
├── components/ui/          # Modified shadcn/ui + custom components (see AGENTS.md)
├── lib/
│   ├── services/           # Effect-TS service layer (see lib/services/AGENTS.md)
│   ├── core/               # Domain logic
│   │   ├── errors/         # Tagged error types
│   │   ├── timeline/       # Timeline CRUD, access, collaboration (future)
│   │   ├── event/          # Event CRUD (future)
│   │   └── media/          # Media upload/processing/signed URLs
│   ├── next-effect/        # Effect-TS/Next.js adapter
│   ├── schemas/            # Validation schemas
│   ├── layers.ts           # AppLayer composition
│   └── utils.ts            # Utilities (cn helper)
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
| Media uploads        | `lib/core/media/*-action.ts`    | `DATA_ACCESS_PATTERNS.md`       |
| URL state (filters)  | `app/*/search-params.ts`        | `NUQS_URL_STATE.md`             |

## CODE MAP

| Symbol                  | Type     | Location                           | Role                                      |
| ----------------------- | -------- | ---------------------------------- | ----------------------------------------- |
| `AppLayer`              | Layer    | `lib/layers.ts`                    | Merged service layer for Effect pipelines |
| `NextEffect.runPromise` | Function | `lib/next-effect/index.ts`         | Handles redirects outside Effect context  |
| `Auth`                  | Service  | `lib/services/auth/live-layer.ts`  | Authentication (sign in/up/out, sessions) |
| `Db`                    | Service  | `lib/services/db/live-layer.ts`    | Database (returns Drizzle client)         |
| `Email`                 | Service  | `lib/services/email/live-layer.ts` | Resend email sending                      |
| `S3`                    | Service  | `lib/services/s3/live-layer.ts`    | AWS S3 file operations                    |

## CONVENTIONS

### Code Style (Prettier)

- **Semicolons**
- **No trailing commas**
- Single quotes, 2-space indent, max 100 chars

### File Naming

- **All files use kebab-case** - `search-params.ts`, `live-layer.ts`
- **Server actions** end in `-action.ts` - `create-timeline-action.ts`
- **URL state definitions** - `search-params.ts` in the route directory

### Effect-TS Service Pattern

```typescript
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
└── S3.Live
```

### Auth Middleware

`proxy.ts` provides cookie-based auth middleware. Checks for `better-auth.session_token` cookie, redirects unauthenticated users to `/login`. Sets `x-pathname` header for layout route detection. Public routes: `/`, `/login`.

### Data Access Patterns

See `specs/DATA_ACCESS_PATTERNS.md` for full details. Summary:

| Operation            | Pattern       | Location                                        |
| -------------------- | ------------- | ----------------------------------------------- |
| Read data for pages  | RSC           | `app/*/page.tsx`                                |
| Create/Update/Delete | Server Action | `lib/core/[domain]/*-action.ts`                 |
| Media upload         | S3 signed URL | `lib/core/media/get-media-upload-url-action.ts` |
| Media download       | S3 signed URL | `lib/core/media/get-media-urls-action.ts`       |
| External webhooks    | API Route     | `app/api/webhooks/*/route.ts`                   |

**Server Action Pattern:**

```typescript
// lib/core/timeline/create-timeline-action.ts
'use server'

export const createTimelineAction = async (input: CreateTimelineInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession()
      // ... create timeline
    }).pipe(
      Effect.withSpan('action.timeline.create'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error => /* handle errors */,
        onSuccess: () => Effect.sync(() => revalidatePath('/'))
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

## SUBDIRECTORY DOCS

- `lib/services/AGENTS.md` - Effect-TS service architecture patterns
- `components/ui/AGENTS.md` - UI component patterns and customizations
