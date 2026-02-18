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
const DeleteDayInput = S.Struct({
  id: S.String.pipe(S.minLength(1))
});

type DeleteDayInput = S.Schema.Type<typeof DeleteDayInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const deleteDayAction = async (input: DeleteDayInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(DeleteDayInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: day id is required',
              field: 'id'
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
      // 6. FETCH EXISTING DAY
      // --------------------------------------------------------
      const [existing] = yield* db
        .select()
        .from(schema.day)
        .where(eq(schema.day.id, parsed.id))
        .limit(1);

      if (!existing) {
        return yield* new NotFoundError({
          message: 'Day not found',
          entity: 'day',
          id: parsed.id
        });
      }

      // --------------------------------------------------------
      // 7. AUTHORIZE (editor or owner on parent timeline)
      // --------------------------------------------------------
      yield* getTimelineAccess(existing.timelineId, 'editor');

      // --------------------------------------------------------
      // 8. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'day.id': parsed.id,
        'timeline.id': existing.timelineId
      });

      // --------------------------------------------------------
      // 9. DELETE ASSOCIATED S3 MEDIA FILES
      // --------------------------------------------------------
      const mediaRecords = yield* db
        .select({
          s3Key: schema.media.s3Key,
          thumbnailS3Key: schema.media.thumbnailS3Key
        })
        .from(schema.media)
        .where(eq(schema.media.dayId, parsed.id));

      const s3Keys = mediaRecords.flatMap(m => {
        const keys: Array<string> = [m.s3Key];
        if (m.thumbnailS3Key) {
          keys.push(m.thumbnailS3Key);
        }
        return keys;
      });

      if (s3Keys.length > 0) {
        yield* Effect.all(
          s3Keys.map(key => s3.deleteFile(key)),
          { concurrency: 10 }
        ).pipe(
          Effect.tapError(error =>
            Effect.logError('Failed to delete S3 media files for day', {
              dayId: parsed.id,
              error
            })
          )
        );
      }

      yield* Effect.annotateCurrentSpan({
        'media.deletedFiles': s3Keys.length
      });

      // --------------------------------------------------------
      // 10. DELETE DAY (cascades media + comments in DB)
      // --------------------------------------------------------
      yield* db.delete(schema.day).where(eq(schema.day.id, parsed.id));

      return existing.timelineId;
    }).pipe(
      // --------------------------------------------------------
      // 11. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.day.delete', {
        attributes: { operation: 'day.delete' }
      }),

      // --------------------------------------------------------
      // 12. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 13. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.day.delete failed', { error: e })),

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
                message: 'Failed to delete day'
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
