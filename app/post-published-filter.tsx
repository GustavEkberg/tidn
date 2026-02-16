'use client';

import { useQueryState, parseAsBoolean } from 'nuqs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

export function PostPublishedFilter() {
  const [published, setPublished] = useQueryState(
    'published',
    parseAsBoolean.withOptions({
      shallow: false,
      history: 'push'
    })
  );

  // Convert boolean | null to string for Select
  const value = published === null ? 'all' : published ? 'true' : 'false';

  const handleChange = (newValue: string | null) => {
    if (newValue === null || newValue === 'all') {
      setPublished(null);
    } else {
      setPublished(newValue === 'true');
    }
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All posts</SelectItem>
        <SelectItem value="true">Published</SelectItem>
        <SelectItem value="false">Drafts</SelectItem>
      </SelectContent>
    </Select>
  );
}
