import { Suspense } from 'react';
import { Effect, Match } from 'effect';
import { cookies } from 'next/headers';
import { NextEffect } from '@/lib/next-effect';
import { AppLayer } from '@/lib/layers';
import { getTimelines } from '@/lib/core/timeline/get-timelines';
import { TimelineList } from './timeline-list';
import { LandingPage } from './landing-page';

export const dynamic = 'force-dynamic';

const SESSION_COOKIE = 'better-auth.session_token';
const SECURE_SESSION_COOKIE = '__Secure-better-auth.session_token';

async function Content() {
  const jar = await cookies();

  // Fast path: no session cookie → landing page (skip Effect pipeline entirely)
  const hasSession = jar.has(SESSION_COOKIE) || jar.has(SECURE_SESSION_COOKIE);
  if (!hasSession) {
    return <LandingPage />;
  }

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const timelines = yield* getTimelines();

      return <TimelineList timelines={timelines} />;
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => Effect.sync(() => <LandingPage />)),
            Match.orElse(() =>
              Effect.sync(() => {
                if (process.env.NODE_ENV !== 'production') {
                  console.error('[page /] Error:', error);
                }
                return (
                  <div className="flex min-h-dvh items-center justify-center p-6">
                    <p className="text-muted-foreground">Something went wrong.</p>
                  </div>
                );
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
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
