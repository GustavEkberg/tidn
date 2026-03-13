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
const CreateDayInput = S.Struct({
  timelineId: S.String.pipe(S.minLength(1)),
  date: S.String.pipe(
    S.pattern(/^\d{4}-\d{2}-\d{2}$/, {
      message: () => 'Date must be in YYYY-MM-DD format'
    })
  ),
  title: S.optional(S.String.pipe(S.maxLength(200)))
});

type CreateDayInput = S.Schema.Type<typeof CreateDayInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const createDayAction = async (input: CreateDayInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(CreateDayInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: timelineId and date (YYYY-MM-DD) are required',
              field: 'date'
            })
        )
      );

      // Reject future dates
      const today = new Date().toISOString().slice(0, 10);
      if (parsed.date > today) {
        return yield* Effect.fail(
          new ValidationError({
            message: 'Date cannot be in the future',
            field: 'date'
          })
        );
      }

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
        'day.date': parsed.date
      });

      // --------------------------------------------------------
      // 7. UPSERT DAY (unique per timeline+date)
      // --------------------------------------------------------
      const [day] = yield* db
        .insert(schema.day)
        .values({
          timelineId: parsed.timelineId,
          date: parsed.date,
          title: parsed.title,
          createdById: session.user.id
        })
        .onConflictDoUpdate({
          target: [schema.day.timelineId, schema.day.date],
          set: {
            updatedAt: new Date(),
            ...(parsed.title !== undefined ? { title: parsed.title } : {})
          }
        })
        .returning();

      return day;
    }).pipe(
      // --------------------------------------------------------
      // 8. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.day.create', {
        attributes: { operation: 'day.create' }
      }),

      // --------------------------------------------------------
      // 9. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 10. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.day.create failed', { error: e })),

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
                message: 'Failed to create day'
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
