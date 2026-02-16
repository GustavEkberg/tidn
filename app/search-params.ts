import { createLoader, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server';

// -----------------------------------------------------------------------------
// Filter Values
// -----------------------------------------------------------------------------

export const sortByValues = ['newest', 'oldest', 'title'] as const;
export type SortBy = (typeof sortByValues)[number];

// -----------------------------------------------------------------------------
// Search Params Configuration
// -----------------------------------------------------------------------------

export const searchParams = {
  q: parseAsString,
  published: parseAsBoolean,
  sortBy: parseAsStringLiteral(sortByValues).withDefault('newest')
};

// -----------------------------------------------------------------------------
// Server-side Loader
// -----------------------------------------------------------------------------

export const loadSearchParams = createLoader(searchParams);
