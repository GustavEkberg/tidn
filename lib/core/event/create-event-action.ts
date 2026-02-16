'use server';

import { Effect, Match, Schema as S } from 'effect';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const CreateEventInput = S.Struct({
  timelineId: S.String.pipe(S.minLength(1)),
  date: S.String.pipe(
    S.pattern(/^\d{4}-\d{2}-\d{2}$/, {
      message: () => 'Date must be in YYYY-MM-DD format'
    })
  ),
  comment: S.optional(S.String.pipe(S.maxLength(2000)))
});

type CreateEventInput = S.Schema.Type<typeof CreateEventInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const createEventAction = async (input: CreateEventInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(CreateEventInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: timelineId and date (YYYY-MM-DD) are required',
              field: 'date'
            })
        )
      );

      // --------------------------------------------------------
      // 4. AUTHENTICATE + AUTHORIZE
      // --------------------------------------------------------
      const session = yield* getSession();
      yield* getTimelineAccess(parsed.timelineId, 'editor');

      // --------------------------------------------------------
      // 5. GET DATABASE
      // --------------------------------------------------------
      const db = yield* Db;

      // --------------------------------------------------------
      // 6. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'timeline.id': parsed.timelineId,
        'event.date': parsed.date
      });

      // --------------------------------------------------------
      // 7. BUSINESS LOGIC
      // --------------------------------------------------------
      const [event] = yield* db
        .insert(schema.event)
        .values({
          timelineId: parsed.timelineId,
          date: parsed.date,
          comment: parsed.comment,
          createdById: session.user.id
        })
        .returning();

      return event;
    }).pipe(
      // --------------------------------------------------------
      // 8. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.event.create', {
        attributes: { operation: 'event.create' }
      }),

      // --------------------------------------------------------
      // 9. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 10. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.event.create failed', { error: e })),

      // --------------------------------------------------------
      // 11. HANDLE RESULT
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
                message: 'Timeline not found'
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
                message: 'Failed to create event'
              })
            )
          ),

        onSuccess: event =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 11. REVALIDATE CACHE
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
