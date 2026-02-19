'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const DeleteMediaCommentInput = S.Struct({
  id: S.String.pipe(S.minLength(1))
});

type DeleteMediaCommentInput = S.Schema.Type<typeof DeleteMediaCommentInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const deleteMediaCommentAction = async (input: DeleteMediaCommentInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(DeleteMediaCommentInput)(input).pipe(
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
      // 6. FETCH COMMENT → MEDIA → DAY → TIMELINE
      // --------------------------------------------------------
      const [existingComment] = yield* db
        .select({
          id: schema.mediaComment.id,
          mediaId: schema.mediaComment.mediaId,
          authorId: schema.mediaComment.authorId
        })
        .from(schema.mediaComment)
        .where(eq(schema.mediaComment.id, parsed.id))
        .limit(1);

      if (!existingComment) {
        return yield* new NotFoundError({
          message: 'Comment not found',
          entity: 'mediaComment',
          id: parsed.id
        });
      }

      const [existingMedia] = yield* db
        .select({ dayId: schema.media.dayId })
        .from(schema.media)
        .where(eq(schema.media.id, existingComment.mediaId))
        .limit(1);

      if (!existingMedia) {
        return yield* new NotFoundError({
          message: 'Media not found',
          entity: 'media',
          id: existingComment.mediaId
        });
      }

      const [existingDay] = yield* db
        .select({ timelineId: schema.day.timelineId })
        .from(schema.day)
        .where(eq(schema.day.id, existingMedia.dayId))
        .limit(1);

      if (!existingDay) {
        return yield* new NotFoundError({
          message: 'Day not found',
          entity: 'day',
          id: existingMedia.dayId
        });
      }

      // --------------------------------------------------------
      // 7. AUTHORIZE (viewer can delete own; editor/owner can delete any)
      // --------------------------------------------------------
      const { role } = yield* getTimelineAccess(existingDay.timelineId, 'viewer');
      const isAuthor = existingComment.authorId === session.user.id;
      const isEditorOrAbove = role === 'editor' || role === 'owner';
      if (!isAuthor && !isEditorOrAbove) {
        return yield* new UnauthorizedError({
          message: 'You can only delete your own comments'
        });
      }

      // --------------------------------------------------------
      // 8. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'comment.id': parsed.id,
        'media.id': existingComment.mediaId,
        'timeline.id': existingDay.timelineId
      });

      // --------------------------------------------------------
      // 9. DELETE COMMENT
      // --------------------------------------------------------
      yield* db.delete(schema.mediaComment).where(eq(schema.mediaComment.id, parsed.id));

      return existingDay.timelineId;
    }).pipe(
      // --------------------------------------------------------
      // 10. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.comment.deleteMediaComment', {
        attributes: { operation: 'comment.deleteMediaComment' }
      }),

      // --------------------------------------------------------
      // 11. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 12. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e =>
        Effect.logError('action.comment.deleteMediaComment failed', { error: e })
      ),

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
