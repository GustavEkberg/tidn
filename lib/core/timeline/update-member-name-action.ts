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
import { getTimelineAccess } from './get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const UpdateMemberNameInput = S.Struct({
  memberId: S.String.pipe(S.minLength(1)),
  name: S.String.pipe(S.maxLength(100))
});

type UpdateMemberNameInput = S.Schema.Type<typeof UpdateMemberNameInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const updateMemberNameAction = async (input: UpdateMemberNameInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(UpdateMemberNameInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Member ID and name are required',
              field: 'name'
            })
        )
      );

      // --------------------------------------------------------
      // 4. GET DATABASE + FETCH MEMBER
      // --------------------------------------------------------
      const session = yield* getSession();
      const db = yield* Db;

      const [member] = yield* db
        .select()
        .from(schema.timelineMember)
        .where(eq(schema.timelineMember.id, parsed.memberId))
        .limit(1);

      if (!member) {
        return yield* new NotFoundError({
          message: 'Member not found',
          entity: 'timelineMember',
          id: parsed.memberId
        });
      }

      // --------------------------------------------------------
      // 5. CHECK ACCESS: owner can edit anyone, member can edit self
      // --------------------------------------------------------
      const { role } = yield* getTimelineAccess(member.timelineId, 'viewer');
      const isOwner = role === 'owner';
      const isSelf = member.userId === session.user.id;

      if (!isOwner && !isSelf) {
        return yield* new UnauthorizedError({
          message: 'Only the owner or the member themselves can edit the name',
          requiredRole: 'owner'
        });
      }

      yield* Effect.annotateCurrentSpan({
        'member.id': parsed.memberId,
        'member.newName': parsed.name,
        'timeline.id': member.timelineId
      });

      // --------------------------------------------------------
      // 6. UPDATE NAME
      // --------------------------------------------------------
      const trimmedName = parsed.name.trim();
      const [updated] = yield* db
        .update(schema.timelineMember)
        .set({ name: trimmedName || null })
        .where(eq(schema.timelineMember.id, parsed.memberId))
        .returning();

      return updated;
    }).pipe(
      Effect.withSpan('action.timeline.updateMemberName', {
        attributes: { operation: 'timeline.updateMemberName' }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.tapError(e =>
        Effect.logError('action.timeline.updateMemberName failed', { error: e })
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
              Effect.succeed({ _tag: 'Error' as const, message: 'Failed to update member name' })
            )
          ),
        onSuccess: member =>
          Effect.sync(() => {
            revalidatePath(`/timeline/${member.timelineId}/settings`);
            revalidatePath(`/timeline/${member.timelineId}`);
            return { _tag: 'Success' as const, member };
          })
      })
    )
  );
};
