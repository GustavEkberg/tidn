import { Effect } from 'effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq, and, ilike, asc, desc, type SQL } from 'drizzle-orm';

type GetPostsParams = {
  q?: string | null;
  published?: boolean | null;
  sortBy?: 'newest' | 'oldest' | 'title';
};

export const getPosts = (params: GetPostsParams = {}) =>
  Effect.gen(function* () {
    const { user } = yield* getSession();
    const db = yield* Db;

    // Build where conditions
    const conditions: SQL[] = [eq(schema.post.userId, user.id)];

    if (params.q) {
      conditions.push(ilike(schema.post.title, `%${params.q}%`));
    }

    if (params.published !== null && params.published !== undefined) {
      conditions.push(eq(schema.post.published, params.published));
    }

    // Build order by
    const orderBy =
      params.sortBy === 'oldest'
        ? asc(schema.post.createdAt)
        : params.sortBy === 'title'
          ? asc(schema.post.title)
          : desc(schema.post.createdAt);

    const posts = yield* db
      .select()
      .from(schema.post)
      .where(and(...conditions))
      .orderBy(orderBy);

    return posts;
  }).pipe(Effect.withSpan('Post.getPosts'));
