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
const ToggleMediaPrivacyInput = S.Struct({
  mediaId: S.String.pipe(S.minLength(1)),
  isPrivate: S.Boolean
});

type ToggleMediaPrivacyInput = S.Schema.Type<typeof ToggleMediaPrivacyInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const toggleMediaPrivacyAction = async (input: ToggleMediaPrivacyInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(ToggleMediaPrivacyInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: mediaId and isPrivate are required',
              field: 'input'
            })
        )
      );

      // --------------------------------------------------------
      // 4. AUTHENTICATE
      // --------------------------------------------------------
      const session = yield* getSession();

      // --------------------------------------------------------
      // 5. FETCH MEDIA + DAY CHAIN
      // --------------------------------------------------------
      const db = yield* Db;

      const [existing] = yield* db
        .select({
          id: schema.media.id,
          dayId: schema.media.dayId
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
      // 6. AUTHORIZE (editor or owner)
      // --------------------------------------------------------
      yield* getTimelineAccess(existingDay.timelineId, 'editor');

      // --------------------------------------------------------
      // 7. SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'media.id': parsed.mediaId,
        'media.isPrivate': parsed.isPrivate,
        'day.id': existing.dayId,
        'timeline.id': existingDay.timelineId
      });

      // --------------------------------------------------------
      // 8. UPDATE MEDIA RECORD
      // --------------------------------------------------------
      yield* db
        .update(schema.media)
        .set({ isPrivate: parsed.isPrivate })
        .where(eq(schema.media.id, parsed.mediaId));

      return existingDay.timelineId;
    }).pipe(
      // --------------------------------------------------------
      // 9. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.media.togglePrivacy', {
        attributes: { operation: 'media.togglePrivacy' }
      }),

      // --------------------------------------------------------
      // 10. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 11. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.media.togglePrivacy failed', { error: e })),

      // --------------------------------------------------------
      // 12. HANDLE RESULT
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
                message: 'Failed to update media privacy'
              })
            )
          ),

        onSuccess: timelineId =>
          Effect.sync(() => {
            revalidatePath(`/timeline/${timelineId}`);
            return { _tag: 'Success' as const };
          })
      })
    )
  );
};
