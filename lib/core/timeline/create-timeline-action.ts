'use server';

import { Effect, Match, Schema as S } from 'effect';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ValidationError } from '@/lib/core/errors';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const CreateTimelineInput = S.Struct({
  name: S.String.pipe(S.minLength(1), S.maxLength(100)),
  description: S.optional(S.String.pipe(S.maxLength(500)))
});

type CreateTimelineInput = S.Schema.Type<typeof CreateTimelineInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const createTimelineAction = async (input: CreateTimelineInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(CreateTimelineInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Timeline name is required (1-100 characters)',
              field: 'name'
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
      // 6. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'timeline.name': parsed.name
      });

      // --------------------------------------------------------
      // 7. BUSINESS LOGIC
      // --------------------------------------------------------
      const [timeline] = yield* db
        .insert(schema.timeline)
        .values({
          name: parsed.name,
          description: parsed.description,
          ownerId: session.user.id
        })
        .returning();

      return timeline;
    }).pipe(
      // --------------------------------------------------------
      // 8. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.timeline.create', {
        attributes: { operation: 'timeline.create' }
      }),

      // --------------------------------------------------------
      // 9. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 10. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.timeline.create failed', { error: e })),

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
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to create timeline'
              })
            )
          ),

        onSuccess: timeline =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 11. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath('/');

            return {
              _tag: 'Success' as const,
              timeline
            };
          })
      })
    )
  );
};
