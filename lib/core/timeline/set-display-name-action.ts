'use server';

import { Effect, Match, Schema as S } from 'effect';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from './get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const SetDisplayNameInput = S.Struct({
  timelineId: S.String.pipe(S.minLength(1)),
  name: S.String.pipe(S.maxLength(100))
});

type SetDisplayNameInput = S.Schema.Type<typeof SetDisplayNameInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const setDisplayNameAction = async (input: SetDisplayNameInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(SetDisplayNameInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Timeline ID and name are required',
              field: 'name'
            })
        )
      );

      // --------------------------------------------------------
      // 4. CHECK ACCESS (any role)
      // --------------------------------------------------------
      const session = yield* getSession();
      yield* getTimelineAccess(parsed.timelineId, 'viewer');
      const db = yield* Db;

      const trimmedName = parsed.name.trim();

      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'timeline.id': parsed.timelineId,
        'displayName': trimmedName
      });

      // --------------------------------------------------------
      // 5. UPSERT MEMBER RECORD
      // --------------------------------------------------------
      const [existing] = yield* db
        .select({ id: schema.timelineMember.id })
        .from(schema.timelineMember)
        .where(
          and(
            eq(schema.timelineMember.timelineId, parsed.timelineId),
            eq(schema.timelineMember.userId, session.user.id)
          )
        )
        .limit(1);

      if (existing) {
        // Update existing member record
        yield* db
          .update(schema.timelineMember)
          .set({ name: trimmedName || null })
          .where(eq(schema.timelineMember.id, existing.id));
      } else {
        // Create member record (e.g. for owner who has no member row)
        yield* db.insert(schema.timelineMember).values({
          timelineId: parsed.timelineId,
          userId: session.user.id,
          email: session.user.email,
          name: trimmedName || null,
          role: 'editor',
          joinedAt: new Date()
        });
      }

      return { name: trimmedName };
    }).pipe(
      Effect.withSpan('action.timeline.setDisplayName', {
        attributes: { operation: 'timeline.setDisplayName' }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.tapError(e =>
        Effect.logError('action.timeline.setDisplayName failed', { error: e })
      ),
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('ValidationError', () =>
              Effect.succeed({ _tag: 'Error' as const, message: error.message })
            ),
            Match.when('NotFoundError', () =>
              Effect.succeed({ _tag: 'Error' as const, message: error.message })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({ _tag: 'Error' as const, message: error.message })
            ),
            Match.orElse(() =>
              Effect.succeed({ _tag: 'Error' as const, message: 'Failed to set display name' })
            )
          ),
        onSuccess: result =>
          Effect.sync(() => {
            revalidatePath(`/timeline/${input.timelineId}/settings`);
            revalidatePath(`/timeline/${input.timelineId}`);
            return { _tag: 'Success' as const, name: result.name };
          })
      })
    )
  );
};
