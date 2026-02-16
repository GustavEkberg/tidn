import { Effect } from 'effect';
import { eq, and, isNotNull } from 'drizzle-orm';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { NotFoundError, UnauthorizedError } from '@/lib/core/errors';
import type { TimelineRole } from './get-timelines';

/**
 * Role hierarchy: owner > editor > viewer.
 * A higher-level role satisfies any lower-level requirement.
 */
const ROLE_LEVEL: Record<TimelineRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1
};

export type TimelineAccess = {
  timeline: schema.Timeline;
  role: TimelineRole;
};

/**
 * Verify the current user has at least `requiredRole` access to a timeline.
 *
 * Resolution order:
 * 1. Check if user is the timeline owner → role = 'owner'
 * 2. Check timeline_member for a joined membership → role from record
 * 3. Otherwise → NotFoundError (no access leak)
 *
 * Fails with:
 * - NotFoundError — timeline doesn't exist
 * - UnauthorizedError — user lacks required role level
 */
export const getTimelineAccess = (timelineId: string, requiredRole: TimelineRole) =>
  Effect.gen(function* () {
    const { user } = yield* getSession();
    const db = yield* Db;

    yield* Effect.annotateCurrentSpan({
      'user.id': user.id,
      'timeline.id': timelineId,
      requiredRole: requiredRole
    });

    // 1. Fetch timeline
    const [existing] = yield* db
      .select()
      .from(schema.timeline)
      .where(eq(schema.timeline.id, timelineId))
      .limit(1);

    if (!existing) {
      return yield* new NotFoundError({
        message: 'Timeline not found',
        entity: 'timeline',
        id: timelineId
      });
    }

    // 2. Determine user's role
    let role: TimelineRole;

    if (existing.ownerId === user.id) {
      role = 'owner';
    } else {
      // Check membership (must be joined — joinedAt not null)
      const [membership] = yield* db
        .select({ role: schema.timelineMember.role })
        .from(schema.timelineMember)
        .where(
          and(
            eq(schema.timelineMember.timelineId, timelineId),
            eq(schema.timelineMember.userId, user.id),
            isNotNull(schema.timelineMember.joinedAt)
          )
        )
        .limit(1);

      if (!membership) {
        // Don't reveal timeline exists — use NotFoundError
        return yield* new NotFoundError({
          message: 'Timeline not found',
          entity: 'timeline',
          id: timelineId
        });
      }

      role = membership.role;
    }

    // 3. Check role level
    if (ROLE_LEVEL[role] < ROLE_LEVEL[requiredRole]) {
      return yield* new UnauthorizedError({
        message: `Requires ${requiredRole} access`
      });
    }

    return { timeline: existing, role } satisfies TimelineAccess;
  }).pipe(Effect.withSpan('Timeline.getAccess'));
