'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import {
  ConstraintError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from '@/lib/core/errors';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const RemoveMemberInput = S.Struct({
  memberId: S.String.pipe(S.minLength(1))
});

type RemoveMemberInput = S.Schema.Type<typeof RemoveMemberInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const removeMemberAction = async (input: RemoveMemberInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(RemoveMemberInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Member ID is required',
              field: 'memberId'
            })
        )
      );

      // --------------------------------------------------------
      // 4. AUTHENTICATE
      // --------------------------------------------------------
      const session = yield* getSession();

      // --------------------------------------------------------
      // 5. GET SERVICES
      // --------------------------------------------------------
      const db = yield* Db;

      // --------------------------------------------------------
      // 6. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'member.id': parsed.memberId
      });

      // --------------------------------------------------------
      // 7. FETCH MEMBER RECORD
      // --------------------------------------------------------
      const [member] = yield* db
        .select()
        .from(schema.timelineMember)
        .where(eq(schema.timelineMember.id, parsed.memberId))
        .limit(1);

      if (!member) {
        return yield* new NotFoundError({
          message: 'Member not found',
          entity: 'timelineMember',
          id: parsed.memberId
        });
      }

      // --------------------------------------------------------
      // 8. CHECK TIMELINE OWNERSHIP
      // --------------------------------------------------------
      const [tl] = yield* db
        .select({ ownerId: schema.timeline.ownerId })
        .from(schema.timeline)
        .where(eq(schema.timeline.id, member.timelineId))
        .limit(1);

      if (!tl || tl.ownerId !== session.user.id) {
        return yield* new UnauthorizedError({
          message: 'Only the timeline owner can remove members'
        });
      }

      // --------------------------------------------------------
      // 9. PREVENT OWNER SELF-REMOVAL
      // --------------------------------------------------------
      if (member.userId === session.user.id) {
        return yield* new ConstraintError({
          message: 'Cannot remove yourself from your own timeline',
          constraint: 'self-remove'
        });
      }

      // --------------------------------------------------------
      // 10. DELETE MEMBER RECORD
      // --------------------------------------------------------
      yield* db.delete(schema.timelineMember).where(eq(schema.timelineMember.id, parsed.memberId));

      return { timelineId: member.timelineId };
    }).pipe(
      // --------------------------------------------------------
      // 11. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.timeline.removeMember', {
        attributes: { operation: 'timeline.removeMember' }
      }),

      // --------------------------------------------------------
      // 12. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 13. HANDLE RESULT
      // --------------------------------------------------------
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('ValidationError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('ConstraintError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to remove member'
              })
            )
          ),

        onSuccess: result =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 14. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath(`/timeline/${result.timelineId}/settings`);

            return {
              _tag: 'Success' as const
            };
          })
      })
    )
  );
};
