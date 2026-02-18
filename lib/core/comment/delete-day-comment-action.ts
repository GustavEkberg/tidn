'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { NotFoundError, ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const DeleteDayCommentInput = S.Struct({
  id: S.String.pipe(S.minLength(1))
});

type DeleteDayCommentInput = S.Schema.Type<typeof DeleteDayCommentInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const deleteDayCommentAction = async (input: DeleteDayCommentInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(DeleteDayCommentInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: comment id is required',
              field: 'id'
            })
        )
      );

      // --------------------------------------------------------
      // 4. AUTHENTICATE
      // --------------------------------------------------------
      const session = yield* getSession();

      // --------------------------------------------------------
      // 5. GET DATABASE
      // --------------------------------------------------------
      const db = yield* Db;

      // --------------------------------------------------------
      // 6. FETCH COMMENT (two-hop: dayComment → day → timeline)
      // --------------------------------------------------------
      const [existingComment] = yield* db
        .select({
          id: schema.dayComment.id,
          dayId: schema.dayComment.dayId
        })
        .from(schema.dayComment)
        .where(eq(schema.dayComment.id, parsed.id))
        .limit(1);

      if (!existingComment) {
        return yield* new NotFoundError({
          message: 'Comment not found',
          entity: 'dayComment',
          id: parsed.id
        });
      }

      const [existingDay] = yield* db
        .select({ timelineId: schema.day.timelineId })
        .from(schema.day)
        .where(eq(schema.day.id, existingComment.dayId))
        .limit(1);

      if (!existingDay) {
        return yield* new NotFoundError({
          message: 'Day not found',
          entity: 'day',
          id: existingComment.dayId
        });
      }

      // --------------------------------------------------------
      // 7. AUTHORIZE (editor or owner on parent timeline)
      // --------------------------------------------------------
      yield* getTimelineAccess(existingDay.timelineId, 'editor');

      // --------------------------------------------------------
      // 8. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'comment.id': parsed.id,
        'day.id': existingComment.dayId,
        'timeline.id': existingDay.timelineId
      });

      // --------------------------------------------------------
      // 9. DELETE COMMENT
      // --------------------------------------------------------
      yield* db.delete(schema.dayComment).where(eq(schema.dayComment.id, parsed.id));

      return existingDay.timelineId;
    }).pipe(
      // --------------------------------------------------------
      // 10. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.comment.deleteDayComment', {
        attributes: { operation: 'comment.deleteDayComment' }
      }),

      // --------------------------------------------------------
      // 11. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 12. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.comment.deleteDayComment failed', { error: e })),

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
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to delete comment'
              })
            )
          ),

        onSuccess: timelineId =>
          Effect.sync(() => {
            revalidatePath(`/timeline/${timelineId}`);

            return {
              _tag: 'Success' as const
            };
          })
      })
    )
  );
};
