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
const UpdateMemberRoleInput = S.Struct({
  memberId: S.String.pipe(S.minLength(1)),
  role: S.Literal('editor', 'viewer')
});

type UpdateMemberRoleInput = S.Schema.Type<typeof UpdateMemberRoleInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const updateMemberRoleAction = async (input: UpdateMemberRoleInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(UpdateMemberRoleInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Member ID and valid role (editor/viewer) are required',
              field: 'role'
            })
        )
      );

      // --------------------------------------------------------
      // 4. AUTHENTICATE
      // --------------------------------------------------------
      const session = yield* getSession();

      // --------------------------------------------------------
      // 5. GET SERVICES
      // --------------------------------------------------------
      const db = yield* Db;

      // --------------------------------------------------------
      // 6. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'member.id': parsed.memberId,
        'member.newRole': parsed.role
      });

      // --------------------------------------------------------
      // 7. FETCH MEMBER RECORD
      // --------------------------------------------------------
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
      // 8. CHECK TIMELINE OWNERSHIP
      // --------------------------------------------------------
      const [tl] = yield* db
        .select({ ownerId: schema.timeline.ownerId })
        .from(schema.timeline)
        .where(eq(schema.timeline.id, member.timelineId))
        .limit(1);

      if (!tl || tl.ownerId !== session.user.id) {
        return yield* new UnauthorizedError({
          message: 'Only the timeline owner can change member roles'
        });
      }

      // --------------------------------------------------------
      // 9. UPDATE ROLE
      // --------------------------------------------------------
      const [updated] = yield* db
        .update(schema.timelineMember)
        .set({ role: parsed.role })
        .where(eq(schema.timelineMember.id, parsed.memberId))
        .returning();

      return updated;
    }).pipe(
      // --------------------------------------------------------
      // 10. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.timeline.updateMemberRole', {
        attributes: { operation: 'timeline.updateMemberRole' }
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
                message: 'Failed to update member role'
              })
            )
          ),

        onSuccess: member =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 13. REVALIDATE CACHE
            // --------------------------------------------------------
            revalidatePath(`/timeline/${member.timelineId}/settings`);

            return {
              _tag: 'Success' as const,
              member
            };
          })
      })
    )
  );
};
