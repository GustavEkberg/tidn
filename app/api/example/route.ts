import { HttpApp, HttpServerResponse } from '@effect/platform';
import { Effect, Match, ManagedRuntime } from 'effect';
import { AppLayer } from '@/lib/layers';
import { getPosts } from '@/lib/core/post/get-posts';

export const dynamic = 'force-dynamic';

// GET /api/example - Fetch posts for authenticated user
const getHandler = Effect.gen(function* () {
  const posts = yield* getPosts();

  return yield* HttpServerResponse.json({ posts });
}).pipe(
  Effect.catchAll(error =>
    Match.value(error).pipe(
      Match.tag('UnauthenticatedError', () =>
        HttpServerResponse.json({ error: 'Not authenticated' }, { status: 401 })
      ),
      Match.orElse(e => {
        console.error('API error:', e);
        return HttpServerResponse.json({ error: 'Internal server error' }, { status: 500 });
      })
    )
  )
);

const managedRuntime = ManagedRuntime.make(AppLayer);
const runtime = await managedRuntime.runtime();
const effectHandler = HttpApp.toWebHandlerRuntime(runtime)(getHandler);

export const GET = (request: Request) => effectHandler(request);
