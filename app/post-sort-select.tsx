'use client';

import { useQueryState, parseAsStringLiteral } from 'nuqs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { sortByValues } from './search-params';

export function PostSortSelect() {
  const [sortBy, setSortBy] = useQueryState(
    'sortBy',
    parseAsStringLiteral(sortByValues).withDefault('newest').withOptions({
      shallow: false,
      history: 'push'
    })
  );

  const handleChange = (value: string | null) => {
    if (value === 'newest' || value === 'oldest' || value === 'title') {
      setSortBy(value);
    }
  };

  return (
    <Select value={sortBy} onValueChange={handleChange}>
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="newest">Newest</SelectItem>
        <SelectItem value="oldest">Oldest</SelectItem>
        <SelectItem value="title">Title</SelectItem>
      </SelectContent>
    </Select>
  );
}
