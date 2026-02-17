import { createLoader, parseAsStringLiteral } from 'nuqs/server';

export const sortOrderOptions = ['newest', 'oldest'] as const;

export const searchParams = {
  order: parseAsStringLiteral(sortOrderOptions).withDefault('oldest')
};

export const loadSearchParams = createLoader(searchParams);
