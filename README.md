# tidn

Collaborative timeline app for sharing photos, videos, and moments.

## Stack

| Category     | Technology                               |
| ------------ | ---------------------------------------- |
| Framework    | Next.js 16 (App Router, Turbopack)       |
| Language     | TypeScript 5                             |
| Functional   | Effect-TS                                |
| Database     | PostgreSQL via Drizzle ORM + @effect/sql |
| Auth         | better-auth (Email OTP, passwordless)    |
| Email        | Resend                                   |
| File Storage | AWS S3                                   |
| Styling      | Tailwind CSS 4                           |
| Testing      | Vitest + Playwright                      |

## Getting Started

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Set up environment:**

   ```bash
   cp .env.example .env.local
   ```

3. **Push database schema:**

   ```bash
   pnpm db:push
   ```

4. **Run development server:**

   ```bash
   pnpm dev
   ```

## Project Structure

```
lib/
├── core/                    # Domain logic
│   ├── errors/              # Tagged error types
│   ├── timeline/            # Timeline CRUD, access, collaboration
│   ├── event/               # Event CRUD
│   ├── media/               # Media upload/processing
│   └── file/                # S3 file upload helpers
├── services/                # Infrastructure services
│   ├── auth/                # Authentication (better-auth)
│   ├── db/                  # Database (Drizzle + Effect SQL)
│   ├── email/               # Email (Resend)
│   └── s3/                  # AWS S3 file storage
├── layers.ts                # Effect layer composition
└── next-effect/             # Next.js + Effect utilities

app/
├── (auth)/                  # Auth routes (login, OTP)
├── timeline/[id]/           # Timeline view + settings
├── api/
│   └── auth/[...all]/       # Auth API handler
└── page.tsx                 # Timeline list
```

## Database

Schema is defined in `lib/services/db/schema.ts`.

```bash
pnpm db:push      # Apply schema changes
pnpm db:generate   # Create migration files
pnpm db:studio     # Browse data in GUI
```
