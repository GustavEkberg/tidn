import { Suspense } from 'react';
import { Effect, Layer, Match } from 'effect';
import { cookies } from 'next/headers';
import type { SearchParams } from 'nuqs/server';
import { NextEffect } from '@/lib/next-effect';
import { AppLayer } from '@/lib/layers';
import { getPosts } from '@/lib/core/post/get-posts';
import { loadSearchParams } from './search-params';
import { PostSearch } from './post-search';
import { PostPublishedFilter } from './post-published-filter';
import { PostSortSelect } from './post-sort-select';

type Props = {
  searchParams: Promise<SearchParams>;
};

async function Content({
  q,
  published,
  sortBy
}: {
  q: string | null;
  published: boolean | null;
  sortBy: 'newest' | 'oldest' | 'title';
}) {
  await cookies();

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const posts = yield* getPosts({ q, published, sortBy });

      return (
        <>
          {posts.length === 0 ? (
            <p className="text-muted-foreground">No posts found.</p>
          ) : (
            <ul className="space-y-4">
              {posts.map(post => (
                <li key={post.id} className="border p-4 rounded-lg">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-medium">{post.title}</h2>
                    {post.published ? (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                        Published
                      </span>
                    ) : (
                      <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                        Draft
                      </span>
                    )}
                  </div>
                  {post.content && <p className="text-muted-foreground mt-2">{post.content}</p>}
                  <p className="text-sm text-muted-foreground/60 mt-2">
                    {post.createdAt.toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    }).pipe(
      Effect.provide(Layer.mergeAll(AppLayer)),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed(
                <div>
                  <p>Something went wrong.</p>
                  <p className="text-red-500">Error: {error.message}</p>
                </div>
              )
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
}

export default async function Page({ searchParams }: Props) {
  const { q, published, sortBy } = await loadSearchParams(searchParams);

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-3xl font-semibold">Posts</h1>
      <p className="text-muted-foreground">
        Example of URL state with nuqs for search, filters, and sorting.
      </p>

      <div className="flex flex-wrap gap-3">
        <PostSearch />
        <PostPublishedFilter />
        <PostSortSelect />
      </div>

      <Suspense key={`${q}-${published}-${sortBy}`} fallback={<p>Loading...</p>}>
        <Content q={q} published={published} sortBy={sortBy} />
      </Suspense>
    </main>
  );
}
