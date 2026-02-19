import { Suspense } from 'react';
import { Effect, Match } from 'effect';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextEffect } from '@/lib/next-effect';
import { AppLayer } from '@/lib/layers';
import { getTimelines } from '@/lib/core/timeline/get-timelines';
import { LandingPage } from './landing-page';
import { NewTimelinePage } from './new-timeline';

export const dynamic = 'force-dynamic';

const SESSION_COOKIE = 'better-auth.session_token';
const SECURE_SESSION_COOKIE = '__Secure-better-auth.session_token';

type ContentResult =
  | { _tag: 'redirect'; path: string }
  | { _tag: 'render'; element: React.ReactNode };

async function Content() {
  const jar = await cookies();

  // Fast path: no session cookie → landing page (skip Effect pipeline entirely)
  const hasSession = jar.has(SESSION_COOKIE) || jar.has(SECURE_SESSION_COOKIE);
  if (!hasSession) {
    return <LandingPage />;
  }

  const result: ContentResult = await NextEffect.runPromise(
    Effect.gen(function* () {
      const timelines = yield* getTimelines();

      // Has timelines → return redirect intent (executed outside Effect)
      if (timelines.length > 0) {
        return { _tag: 'redirect' as const, path: `/timeline/${timelines[0].id}` };
      }

      // No timelines → show create-first-timeline page
      return { _tag: 'render' as const, element: <NewTimelinePage /> };
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () =>
              Effect.succeed({
                _tag: 'render' as const,
                element: <LandingPage />
              })
            ),
            Match.orElse(() =>
              Effect.sync(() => {
                if (process.env.NODE_ENV !== 'production') {
                  console.error('[page /] Error:', error);
                }
                return {
                  _tag: 'render' as const,
                  element: (
                    <div className="flex min-h-dvh items-center justify-center p-6">
                      <p className="text-muted-foreground">Something went wrong.</p>
                    </div>
                  )
                };
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );

  // Redirect OUTSIDE Effect runtime — Next.js redirect() throws NEXT_REDIRECT
  if (result._tag === 'redirect') {
    redirect(result.path);
  }

  return result.element;
}

export default async function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      }
    >
      <Content />
    </Suspense>
  );
}
