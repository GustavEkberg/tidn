import { Effect } from 'effect';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';

export type TimelineRole = 'owner' | 'editor' | 'viewer';

export type TimelineWithRole = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  role: TimelineRole;
};

/**
 * Returns all timelines the current user owns or has joined as a member.
 * Each result includes the user's role (owner/editor/viewer).
 */
export const getTimelines = () =>
  Effect.gen(function* () {
    const { user } = yield* getSession();
    const db = yield* Db;

    yield* Effect.annotateCurrentSpan({ 'user.id': user.id });

    // Owned timelines
    const owned = yield* db
      .select({
        id: schema.timeline.id,
        name: schema.timeline.name,
        description: schema.timeline.description,
        ownerId: schema.timeline.ownerId,
        createdAt: schema.timeline.createdAt,
        updatedAt: schema.timeline.updatedAt,
        role: sql<TimelineRole>`'owner'`.as('role')
      })
      .from(schema.timeline)
      .where(eq(schema.timeline.ownerId, user.id));

    // Timelines where user is a joined member (userId set + joinedAt populated)
    const membered = yield* db
      .select({
        id: schema.timeline.id,
        name: schema.timeline.name,
        description: schema.timeline.description,
        ownerId: schema.timeline.ownerId,
        createdAt: schema.timeline.createdAt,
        updatedAt: schema.timeline.updatedAt,
        role: sql<TimelineRole>`${schema.timelineMember.role}`.as('role')
      })
      .from(schema.timelineMember)
      .innerJoin(schema.timeline, eq(schema.timelineMember.timelineId, schema.timeline.id))
      .where(
        and(eq(schema.timelineMember.userId, user.id), isNotNull(schema.timelineMember.joinedAt))
      );

    // Merge and sort by most recently updated
    const all = [...owned, ...membered].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );

    return all;
  }).pipe(Effect.withSpan('Timeline.getAll'));
