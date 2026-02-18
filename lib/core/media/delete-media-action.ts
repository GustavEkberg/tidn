'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { NotFoundError, ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const DeleteMediaInput = S.Struct({
  mediaId: S.String.pipe(S.minLength(1))
});

type DeleteMediaInput = S.Schema.Type<typeof DeleteMediaInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const deleteMediaAction = async (input: DeleteMediaInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(DeleteMediaInput)(input).pipe(
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
      // 5. GET SERVICES
      // --------------------------------------------------------
      const db = yield* Db;
      const s3 = yield* S3;

      // --------------------------------------------------------
      // 6. FETCH MEDIA RECORD
      // --------------------------------------------------------
      const [existing] = yield* db
        .select({
          id: schema.media.id,
          dayId: schema.media.dayId,
          s3Key: schema.media.s3Key,
          thumbnailS3Key: schema.media.thumbnailS3Key
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

      // --------------------------------------------------------
      // 7. FETCH DAY (two-hop: media → day → timeline)
      // --------------------------------------------------------
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
      // 8. AUTHORIZE (editor or owner on parent timeline)
      // --------------------------------------------------------
      yield* getTimelineAccess(existingDay.timelineId, 'editor');

      // --------------------------------------------------------
      // 9. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'media.id': parsed.mediaId,
        'media.s3Key': existing.s3Key,
        'day.id': existing.dayId,
        'timeline.id': existingDay.timelineId
      });

      // --------------------------------------------------------
      // 10. DELETE S3 FILES (original + thumbnail)
      // --------------------------------------------------------
      const s3Keys: Array<string> = [existing.s3Key];
      if (existing.thumbnailS3Key) {
        s3Keys.push(existing.thumbnailS3Key);
      }

      yield* Effect.all(
        s3Keys.map(key => s3.deleteFile(key)),
        { concurrency: 2 }
      ).pipe(
        Effect.tapError(error =>
          Effect.logError('Failed to delete S3 media files', {
            mediaId: parsed.mediaId,
            error
          })
        )
      );

      // --------------------------------------------------------
      // 11. DELETE MEDIA RECORD FROM DATABASE
      // --------------------------------------------------------
      yield* db.delete(schema.media).where(eq(schema.media.id, parsed.mediaId));

      return existingDay.timelineId;
    }).pipe(
      // --------------------------------------------------------
      // 12. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.media.delete', {
        attributes: { operation: 'media.delete' }
      }),

      // --------------------------------------------------------
      // 13. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 14. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.media.delete failed', { error: e })),

      // --------------------------------------------------------
      // 15. HANDLE RESULT
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
                message: 'Failed to delete media'
              })
            )
          ),

        onSuccess: timelineId =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 15. REVALIDATE CACHE
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
