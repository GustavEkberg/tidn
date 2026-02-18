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
const UpdateDayInput = S.Struct({
  id: S.String.pipe(S.minLength(1)),
  title: S.optional(S.NullOr(S.String.pipe(S.maxLength(200))))
});

type UpdateDayInput = S.Schema.Type<typeof UpdateDayInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const updateDayAction = async (input: UpdateDayInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(UpdateDayInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: title max 200 characters',
              field: 'title'
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
      // 9. BUILD UPDATE
      // --------------------------------------------------------
      const updates: Record<string, string | null | undefined> = {};
      if (parsed.title !== undefined) updates.title = parsed.title ?? null;

      // --------------------------------------------------------
      // 10. UPDATE
      // --------------------------------------------------------
      const [updated] = yield* db
        .update(schema.day)
        .set(updates)
        .where(eq(schema.day.id, parsed.id))
        .returning();

      return updated;
    }).pipe(
      // --------------------------------------------------------
      // 11. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.day.update', {
        attributes: { operation: 'day.update' }
      }),

      // --------------------------------------------------------
      // 12. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 13. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.day.update failed', { error: e })),

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
                message: 'Failed to update day'
              })
            )
          ),

        onSuccess: day =>
          Effect.sync(() => {
            revalidatePath(`/timeline/${day.timelineId}`);

            return {
              _tag: 'Success' as const,
              day
            };
          })
      })
    )
  );
};
