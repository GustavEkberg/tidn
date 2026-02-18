'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { NotFoundError, ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';
import { processMedia } from '@/lib/core/media/process-media';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const ConfirmMediaUploadInput = S.Struct({
  mediaId: S.String.pipe(S.minLength(1))
});

type ConfirmMediaUploadInput = S.Schema.Type<typeof ConfirmMediaUploadInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const confirmMediaUploadAction = async (input: ConfirmMediaUploadInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(ConfirmMediaUploadInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: mediaId is required',
              field: 'mediaId'
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
      // 6. FETCH MEDIA + DAY (two-hop: media → day → timeline)
      // --------------------------------------------------------
      const [existing] = yield* db
        .select({
          id: schema.media.id,
          dayId: schema.media.dayId,
          processingStatus: schema.media.processingStatus,
          s3Key: schema.media.s3Key,
          mimeType: schema.media.mimeType,
          type: schema.media.type
        })
        .from(schema.media)
        .where(eq(schema.media.id, parsed.mediaId))
        .limit(1);

      if (!existing) {
        return yield* new NotFoundError({
          message: 'Media not found',
          entity: 'media',
          id: parsed.mediaId
        });
      }

      // Fetch day to get timelineId
      const [existingDay] = yield* db
        .select({ timelineId: schema.day.timelineId })
        .from(schema.day)
        .where(eq(schema.day.id, existing.dayId))
        .limit(1);

      if (!existingDay) {
        return yield* new NotFoundError({
          message: 'Day not found',
          entity: 'day',
          id: existing.dayId
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
        'media.id': parsed.mediaId,
        'media.type': existing.type,
        'day.id': existing.dayId,
        'timeline.id': existingDay.timelineId
      });

      // --------------------------------------------------------
      // 9. UPDATE PROCESSING STATUS
      // --------------------------------------------------------
      yield* db
        .update(schema.media)
        .set({ processingStatus: 'processing' })
        .where(eq(schema.media.id, parsed.mediaId));

      // --------------------------------------------------------
      // 10. SCHEDULE ASYNC PROCESSING via next/server after()
      // Uses after() so Vercel keeps the function alive until
      // processing completes (forkDaemon gets killed when the
      // serverless function recycles after response is sent).
      // --------------------------------------------------------
      after(() =>
        Effect.runPromise(
          processMedia({
            mediaId: existing.id,
            s3Key: existing.s3Key,
            mimeType: existing.mimeType,
            type: existing.type
          }).pipe(
            Effect.provide(AppLayer),
            Effect.scoped,
            Effect.tapError(error =>
              Effect.logError('Background media processing failed', {
                mediaId: existing.id,
                error
              })
            ),
            Effect.catchAll(() => Effect.void)
          )
        )
      );

      return existingDay.timelineId;
    }).pipe(
      // --------------------------------------------------------
      // 11. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.media.confirmUpload', {
        attributes: { operation: 'media.confirmUpload' }
      }),

      // --------------------------------------------------------
      // 12. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 13. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.media.confirmUpload failed', { error: e })),

      // --------------------------------------------------------
      // 14. HANDLE RESULT
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
                message: 'Failed to confirm media upload'
              })
            )
          ),

        onSuccess: timelineId =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 14. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath(`/timeline/${timelineId}`);

            return {
              _tag: 'Success' as const
            };
          })
      })
    )
  );
};
