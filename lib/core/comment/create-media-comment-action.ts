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
const CreateMediaCommentInput = S.Struct({
  mediaId: S.String.pipe(S.minLength(1)),
  text: S.String.pipe(S.minLength(1), S.maxLength(2000))
});

type CreateMediaCommentInput = S.Schema.Type<typeof CreateMediaCommentInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const createMediaCommentAction = async (input: CreateMediaCommentInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(CreateMediaCommentInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: mediaId and text are required',
              field: 'text'
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
      // 6. FETCH MEDIA → DAY → TIMELINE for authorization
      // --------------------------------------------------------
      const [existingMedia] = yield* db
        .select({ dayId: schema.media.dayId })
        .from(schema.media)
        .where(eq(schema.media.id, parsed.mediaId))
        .limit(1);

      if (!existingMedia) {
        return yield* new NotFoundError({
          message: 'Media not found',
          entity: 'media',
          id: parsed.mediaId
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
      // 7. AUTHORIZE (viewer or above on parent timeline)
      // --------------------------------------------------------
      yield* getTimelineAccess(existingDay.timelineId, 'viewer');

      // --------------------------------------------------------
      // 8. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'media.id': parsed.mediaId,
        'timeline.id': existingDay.timelineId
      });

      // --------------------------------------------------------
      // 9. INSERT COMMENT
      // --------------------------------------------------------
      const [comment] = yield* db
        .insert(schema.mediaComment)
        .values({
          mediaId: parsed.mediaId,
          text: parsed.text,
          authorId: session.user.id
        })
        .returning();

      return { comment, timelineId: existingDay.timelineId };
    }).pipe(
      // --------------------------------------------------------
      // 10. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.comment.createMediaComment', {
        attributes: { operation: 'comment.createMediaComment' }
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
        Effect.logError('action.comment.createMediaComment failed', { error: e })
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
                message: 'Failed to create comment'
              })
            )
          ),

        onSuccess: ({ comment, timelineId }) =>
          Effect.sync(() => {
            revalidatePath(`/timeline/${timelineId}`);

            return {
              _tag: 'Success' as const,
              comment
            };
          })
      })
    )
  );
};
