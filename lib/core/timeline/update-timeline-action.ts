'use server';

import { Effect, Match, Schema as S } from 'effect';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/core/errors';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const UpdateTimelineInput = S.Struct({
  id: S.String.pipe(S.minLength(1)),
  name: S.optional(S.String.pipe(S.minLength(1), S.maxLength(100))),
  description: S.optional(S.NullOr(S.String.pipe(S.maxLength(500))))
});

type UpdateTimelineInput = S.Schema.Type<typeof UpdateTimelineInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const updateTimelineAction = async (input: UpdateTimelineInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(UpdateTimelineInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: name must be 1-100 characters',
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
        'timeline.id': parsed.id
      });

      // --------------------------------------------------------
      // 7. CHECK EXISTENCE + OWNERSHIP
      // --------------------------------------------------------
      const [existing] = yield* db
        .select()
        .from(schema.timeline)
        .where(eq(schema.timeline.id, parsed.id))
        .limit(1);

      if (!existing) {
        return yield* new NotFoundError({
          message: 'Timeline not found',
          entity: 'timeline',
          id: parsed.id
        });
      }

      if (existing.ownerId !== session.user.id) {
        return yield* new UnauthorizedError({
          message: 'Only the timeline owner can edit it'
        });
      }

      // --------------------------------------------------------
      // 8. BUILD UPDATE
      // --------------------------------------------------------
      const updates: Record<string, string | null | undefined> = {};
      if (parsed.name !== undefined) updates.name = parsed.name;
      if (parsed.description !== undefined) updates.description = parsed.description ?? null;

      // --------------------------------------------------------
      // 9. UPDATE
      // --------------------------------------------------------
      const [updated] = yield* db
        .update(schema.timeline)
        .set(updates)
        .where(eq(schema.timeline.id, parsed.id))
        .returning();

      return updated;
    }).pipe(
      // --------------------------------------------------------
      // 10. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.timeline.update', {
        attributes: { operation: 'timeline.update' }
      }),

      // --------------------------------------------------------
      // 11. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

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
                message: 'Failed to update timeline'
              })
            )
          ),

        onSuccess: timeline =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 13. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath('/');
            revalidatePath(`/timeline/${timeline.id}`);

            return {
              _tag: 'Success' as const,
              timeline
            };
          })
      })
    )
  );
};
