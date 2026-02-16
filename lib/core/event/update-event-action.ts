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
const UpdateEventInput = S.Struct({
  id: S.String.pipe(S.minLength(1)),
  date: S.optional(
    S.String.pipe(
      S.pattern(/^\d{4}-\d{2}-\d{2}$/, {
        message: () => 'Date must be in YYYY-MM-DD format'
      })
    )
  ),
  comment: S.optional(S.NullOr(S.String.pipe(S.maxLength(2000))))
});

type UpdateEventInput = S.Schema.Type<typeof UpdateEventInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const updateEventAction = async (input: UpdateEventInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(UpdateEventInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: date must be YYYY-MM-DD, comment max 2000 characters',
              field: 'date'
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
      // 9. BUILD UPDATE
      // --------------------------------------------------------
      const updates: Record<string, string | null | undefined> = {};
      if (parsed.date !== undefined) updates.date = parsed.date;
      if (parsed.comment !== undefined) updates.comment = parsed.comment ?? null;

      // --------------------------------------------------------
      // 10. UPDATE
      // --------------------------------------------------------
      const [updated] = yield* db
        .update(schema.event)
        .set(updates)
        .where(eq(schema.event.id, parsed.id))
        .returning();

      return updated;
    }).pipe(
      // --------------------------------------------------------
      // 11. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.event.update', {
        attributes: { operation: 'event.update' }
      }),

      // --------------------------------------------------------
      // 12. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

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
                message: 'Failed to update event'
              })
            )
          ),

        onSuccess: event =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 14. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath(`/timeline/${event.timelineId}`);

            return {
              _tag: 'Success' as const,
              event
            };
          })
      })
    )
  );
};
