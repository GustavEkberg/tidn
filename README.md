# Init

A Next.js project starter with Effect-TS, designed to be cloned as the foundation for new projects.

## Stack

| Category      | Technology                               |
| ------------- | ---------------------------------------- |
| Framework     | Next.js 16 (App Router, Turbopack)       |
| Language      | TypeScript 5                             |
| Functional    | Effect-TS                                |
| Database      | PostgreSQL via Drizzle ORM + @effect/sql |
| Auth          | better-auth (Email OTP, passwordless)    |
| Email         | Resend                                   |
| File Storage  | AWS S3                                   |
| Notifications | Telegram                                 |
| Styling       | Tailwind CSS 4                           |
| Testing       | Vitest + Playwright                      |

## Getting Started

1. **Clone and rename:**

   ```bash
   git clone <repo> my-project
   cd my-project
   rm -rf .git && git init
   git branch -M main
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Set up environment:**

   ```bash
   cp .env.example .env.local
   cp .env.example .env.test   # For e2e tests (use a separate test database)
   ```

   | File         | Purpose                                                 |
   | ------------ | ------------------------------------------------------- |
   | `.env.local` | Development - used by Next.js, Drizzle, Vitest          |
   | `.env.test`  | E2E tests - used by Playwright (separate test database) |

   Both files are gitignored.

4. **Run development server:**
   ```bash
   pnpm dev
   ```

## Project Structure

```
lib/
├── core/                    # Core business logic (each subfolder has own errors)
│   └── post/                # Example: getPosts()
├── services/                # Infrastructure services
│   ├── auth/                # Authentication (better-auth)
│   ├── db/                  # Database (Drizzle + Effect SQL)
│   ├── email/               # Email (Resend)
│   ├── s3/                  # AWS S3 file storage
│   ├── telegram/            # Telegram notifications
│   └── activity/            # Activity logging
├── layers.ts                # Effect layer composition
└── next-effect/             # Next.js + Effect utilities

app/
├── (auth)/                  # Auth routes (login)
├── (dashboard)/             # Protected routes
├── api/
│   ├── auth/[...all]/       # Auth API handler
│   └── example/             # Example API route
└── page.tsx                 # Home page example
```

## Database

Schema is defined in `lib/services/db/schema.ts`. Migrations are stored in `lib/services/db/migrations/`.

### Development

Use `db:push` for rapid iteration - applies schema changes directly without migration files:

```bash
pnpm db:push
```

### Production

Use `db:generate` to create migration files, then apply them:

```bash
pnpm db:generate  # Creates migration files from schema changes
pnpm db:push      # Applies migrations to database
```

### Workflow

1. Edit `lib/services/db/schema.ts`
2. Run `pnpm db:generate` to create migration
3. Review generated migration in `lib/services/db/migrations/`
4. Run `pnpm db:push` to apply
5. Commit migration files

### Drizzle Studio

```bash
pnpm db:studio  # Opens GUI to browse/edit data
```

## Patterns

### Effect in Pages

```typescript
async function Content() {
  await cookies()

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const posts = yield* getPosts()
      return <div>{/* render posts */}</div>
    }).pipe(
      Effect.provide(Layer.mergeAll(AppLayer)),
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
  )
}
```

### Effect in API Routes

```typescript
const handler = Effect.gen(function* () {
  const posts = yield* getPosts();
  return yield* HttpServerResponse.json({ posts });
}).pipe(
  Effect.catchAll(error =>
    Match.value(error).pipe(
      Match.tag('UnauthenticatedError', () =>
        HttpServerResponse.json({ error: 'Not authenticated' }, { status: 401 })
      ),
      Match.orElse(() =>
        HttpServerResponse.json({ error: 'Internal server error' }, { status: 500 })
      )
    )
  )
);
```

### Creating Services

```typescript
// lib/core/example/get-something.ts
export const getSomething = (id: string) =>
  Effect.gen(function* () {
    const { user } = yield* getSession();
    const db = yield* DbLive;

    const result = yield* Effect.tryPromise(() =>
      db.select().from(schema.something).where(eq(schema.something.id, id))
    );

    return result;
  }).pipe(Effect.withSpan('example.get-something'));
```

## After Cloning

1. Update `package.json` name and version
2. Update this README
3. Remove example code (`lib/core/post/`, example routes)
4. Add your own database schema in `lib/services/db/schema.ts`
5. Create your services in `lib/core/`
6. Remove unwanted services in `lib/services/`. Add more services as needed (port them to the init repo).

## Inspiration

- [ghuntley/loom](https://github.com/ghuntley/loom) - Ralph
- [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles) - OpenCode skills and commands
- [mikearnaldi/accountability](https://github.com/mikearnaldi/accountability) - Specs & Effect
