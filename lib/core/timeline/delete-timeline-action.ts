'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from './get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const DeleteTimelineInput = S.Struct({
  id: S.String.pipe(S.minLength(1))
});

type DeleteTimelineInput = S.Schema.Type<typeof DeleteTimelineInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const deleteTimelineAction = async (input: DeleteTimelineInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(DeleteTimelineInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: timeline id is required',
              field: 'id'
            })
        )
      );

      // --------------------------------------------------------
      // 4. CHECK ACCESS (owner only)
      // --------------------------------------------------------
      yield* getTimelineAccess(parsed.id, 'owner');

      // --------------------------------------------------------
      // 5. GET SERVICES
      // --------------------------------------------------------
      const db = yield* Db;
      const s3 = yield* S3;

      // --------------------------------------------------------
      // 6. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'timeline.id': parsed.id
      });

      // --------------------------------------------------------
      // 6. DELETE S3 MEDIA FILES
      // S3 keys follow: timelines/{timelineId}/{eventId}/{file}
      // deleteFolder lists + batch-deletes all objects by prefix
      // --------------------------------------------------------
      yield* s3.deleteFolder(`timelines/${parsed.id}/`).pipe(
        Effect.tapError(error =>
          Effect.logError('Failed to delete S3 media for timeline', {
            timelineId: parsed.id,
            error
          })
        )
      );

      // --------------------------------------------------------
      // 7. DELETE TIMELINE (cascades events, media, members in DB)
      // --------------------------------------------------------
      yield* db.delete(schema.timeline).where(eq(schema.timeline.id, parsed.id));
    }).pipe(
      // --------------------------------------------------------
      // 10. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.timeline.delete', {
        attributes: { operation: 'timeline.delete' }
      }),

      // --------------------------------------------------------
      // 11. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 12. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.timeline.delete failed', { error: e })),

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
                message: 'Failed to delete timeline'
              })
            )
          ),

        onSuccess: () =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 13. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath('/');

            return {
              _tag: 'Success' as const
            };
          })
      })
    )
  );
};
