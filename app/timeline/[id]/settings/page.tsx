import { Suspense } from 'react';
import { Effect, Match } from 'effect';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { NextEffect } from '@/lib/next-effect';
import { AppLayer } from '@/lib/layers';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { TimelineSettings } from './timeline-settings';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
};

async function Content({ params }: Props) {
  await cookies();
  const { id } = await params;

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { timeline, role } = yield* getTimelineAccess(id, 'viewer');
      const db = yield* Db;

      // Fetch members with optional user info (name)
      const members = yield* db
        .select({
          id: schema.timelineMember.id,
          email: schema.timelineMember.email,
          role: schema.timelineMember.role,
          userId: schema.timelineMember.userId,
          invitedAt: schema.timelineMember.invitedAt,
          joinedAt: schema.timelineMember.joinedAt,
          userName: schema.user.name
        })
        .from(schema.timelineMember)
        .leftJoin(schema.user, eq(schema.timelineMember.userId, schema.user.id))
        .where(eq(schema.timelineMember.timelineId, id));

      const isOwner = role === 'owner';

      // Serialize for client
      const serializedMembers = members.map(m => ({
        id: m.id,
        email: m.email,
        role: m.role,
        userId: m.userId,
        userName: m.userName,
        invitedAt: m.invitedAt.toISOString(),
        joinedAt: m.joinedAt ? m.joinedAt.toISOString() : null
      }));

      return (
        <TimelineSettings
          timeline={{
            id: timeline.id,
            name: timeline.name,
            description: timeline.description
          }}
          members={serializedMembers}
          isOwner={isOwner}
          role={role}
        />
      );
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () => NextEffect.redirect('/')),
            Match.when('UnauthorizedError', () => NextEffect.redirect('/')),
            Match.orElse(() =>
              Effect.sync(() => {
                if (process.env.NODE_ENV !== 'production') {
                  console.error('[page /timeline/[id]/settings] Error:', error);
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

export default async function Page(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading settings...</p>
        </div>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}
