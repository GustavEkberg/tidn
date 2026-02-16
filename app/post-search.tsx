'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { Input } from '@/components/ui/input';

export function PostSearch() {
  const [query, setQuery] = useQueryState(
    'q',
    parseAsString.withDefault('').withOptions({
      shallow: false,
      history: 'push',
      throttleMs: 300
    })
  );

  return (
    <Input
      type="search"
      placeholder="Search posts..."
      value={query}
      onChange={e => setQuery(e.target.value || null)}
    />
  );
}
