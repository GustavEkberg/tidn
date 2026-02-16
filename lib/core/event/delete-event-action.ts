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
const DeleteEventInput = S.Struct({
  id: S.String.pipe(S.minLength(1))
});

type DeleteEventInput = S.Schema.Type<typeof DeleteEventInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const deleteEventAction = async (input: DeleteEventInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(DeleteEventInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: event id is required',
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
      // 6. FETCH EXISTING EVENT
      // --------------------------------------------------------
      const [existing] = yield* db
        .select()
        .from(schema.event)
        .where(eq(schema.event.id, parsed.id))
        .limit(1);

      if (!existing) {
        return yield* new NotFoundError({
          message: 'Event not found',
          entity: 'event',
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
        'event.id': parsed.id,
        'timeline.id': existing.timelineId
      });

      // --------------------------------------------------------
      // 9. DELETE ASSOCIATED S3 MEDIA FILES
      // Query all media records for the event, then delete
      // original + thumbnail files from S3
      // --------------------------------------------------------
      const mediaRecords = yield* db
        .select({
          s3Key: schema.media.s3Key,
          thumbnailS3Key: schema.media.thumbnailS3Key
        })
        .from(schema.media)
        .where(eq(schema.media.eventId, parsed.id));

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
            Effect.logError('Failed to delete S3 media files for event', {
              eventId: parsed.id,
              error
            })
          )
        );
      }

      yield* Effect.annotateCurrentSpan({
        'media.deletedFiles': s3Keys.length
      });

      // --------------------------------------------------------
      // 10. DELETE EVENT (cascades media records in DB)
      // --------------------------------------------------------
      yield* db.delete(schema.event).where(eq(schema.event.id, parsed.id));

      return existing.timelineId;
    }).pipe(
      // --------------------------------------------------------
      // 11. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.event.delete', {
        attributes: { operation: 'event.delete' }
      }),

      // --------------------------------------------------------
      // 12. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 13. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.event.delete failed', { error: e })),

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
                message: 'Failed to delete event'
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
