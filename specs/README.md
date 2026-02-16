# Specifications

Architecture and pattern documentation for this Next.js + Effect-TS application.

## Data Flow

| Spec                                                     | Purpose                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| [DATA_ACCESS_PATTERNS.md](./DATA_ACCESS_PATTERNS.md)     | RSC for reads, server actions for mutations, S3 signed URLs for files |
| [SERVER_ACTION_PATTERNS.md](./SERVER_ACTION_PATTERNS.md) | Complete server action template with validation and error handling    |
| [PAGE_PATTERNS.md](./PAGE_PATTERNS.md)                   | Suspense + Content pattern for dynamic/authenticated pages            |
| [NUQS_URL_STATE.md](./NUQS_URL_STATE.md)                 | URL state for filters, search, pagination with nuqs                   |

## Database

| Spec                                         | Purpose                                                      |
| -------------------------------------------- | ------------------------------------------------------------ |
| [DRIZZLE_PATTERNS.md](./DRIZZLE_PATTERNS.md) | Schema, queries, mutations, migrations with Drizzle + Effect |

## Effect-TS

| Spec                                                   | Purpose                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [EFFECT_BEST_PRACTICES.md](./EFFECT_BEST_PRACTICES.md) | Critical rules: no `any`, no type casts, no `disableValidation`, service patterns |
| [EFFECT_TESTING.md](./EFFECT_TESTING.md)               | @effect/vitest patterns, TestClock, property testing                              |

## Testing

| Spec                                         | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) | Philosophy, coverage targets, mock patterns, what to test |

## Code Quality

| Spec                                                         | Purpose                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| [TYPESCRIPT_CONVENTIONS.md](./TYPESCRIPT_CONVENTIONS.md)     | Flat modules, no barrel files, eslint-disable justification |
| [USABILITY_BEST_PRACTICES.md](./USABILITY_BEST_PRACTICES.md) | Navigation, empty states, errors, forms, accessibility      |
