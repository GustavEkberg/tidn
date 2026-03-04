import { createLoader, parseAsStringLiteral } from 'nuqs/server';

export const sortOrderOptions = ['newest', 'oldest'] as const;

export const searchParams = {
  order: parseAsStringLiteral(sortOrderOptions).withDefault('newest')
};

export const loadSearchParams = createLoader(searchParams);
