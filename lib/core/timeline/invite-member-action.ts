'use server';

import { Config, Effect, Match, Schema as S } from 'effect';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import { Email } from '@/lib/services/email/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ConstraintError, ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from './get-timeline-access';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const InviteMemberInput = S.Struct({
  timelineId: S.String.pipe(S.minLength(1)),
  email: S.String.pipe(S.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), S.maxLength(320)),
  role: S.Literal('editor', 'viewer')
});

type InviteMemberInput = S.Schema.Type<typeof InviteMemberInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const inviteMemberAction = async (input: InviteMemberInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(InviteMemberInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Valid email and role (editor/viewer) are required',
              field: 'email'
            })
        )
      );

      // --------------------------------------------------------
      // 4. AUTHENTICATE + CHECK ACCESS (owner only)
      // --------------------------------------------------------
      const session = yield* getSession();
      const { timeline: existing } = yield* getTimelineAccess(parsed.timelineId, 'owner');

      // --------------------------------------------------------
      // 5. GET SERVICES
      // --------------------------------------------------------
      const db = yield* Db;
      const email = yield* Email;

      // --------------------------------------------------------
      // 6. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'timeline.id': parsed.timelineId,
        'invite.email': parsed.email,
        'invite.role': parsed.role
      });

      // --------------------------------------------------------
      // 8. PREVENT OWNER SELF-INVITE
      // --------------------------------------------------------
      const normalizedEmail = parsed.email.toLowerCase();

      if (session.user.email.toLowerCase() === normalizedEmail) {
        return yield* new ConstraintError({
          message: 'Cannot invite yourself to your own timeline',
          constraint: 'self-invite'
        });
      }

      // --------------------------------------------------------
      // 9. CHECK FOR DUPLICATE INVITE
      // --------------------------------------------------------
      const [existingMember] = yield* db
        .select({ id: schema.timelineMember.id })
        .from(schema.timelineMember)
        .where(
          and(
            eq(schema.timelineMember.timelineId, parsed.timelineId),
            eq(schema.timelineMember.email, normalizedEmail)
          )
        )
        .limit(1);

      if (existingMember) {
        return yield* new ConstraintError({
          message: 'This email has already been invited to this timeline',
          constraint: 'duplicate-invite'
        });
      }

      // --------------------------------------------------------
      // 10. RESOLVE USER IF EXISTS
      // --------------------------------------------------------
      const [existingUser] = yield* db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, normalizedEmail))
        .limit(1);

      // --------------------------------------------------------
      // 11. CREATE MEMBER RECORD
      // --------------------------------------------------------
      const [member] = yield* db
        .insert(schema.timelineMember)
        .values({
          timelineId: parsed.timelineId,
          email: normalizedEmail,
          role: parsed.role,
          userId: existingUser?.id,
          joinedAt: existingUser ? new Date() : null
        })
        .returning();

      // --------------------------------------------------------
      // 12. SEND INVITATION EMAIL
      // --------------------------------------------------------
      const appName = yield* Config.string('APP_NAME');
      const emailSender = yield* Config.string('EMAIL_SENDER');

      yield* email
        .sendEmail({
          from: `${appName} <${emailSender}>`,
          to: normalizedEmail,
          subject: `${session.user.name} invited you to "${existing.name}" on ${appName}`,
          html: [
            `<p><strong>${session.user.name}</strong> invited you to collaborate on the timeline <strong>"${existing.name}"</strong> as a <strong>${parsed.role}</strong>.</p>`,
            existingUser
              ? `<p>You already have an account — sign in to access this timeline.</p>`
              : `<p>Sign up to get started and access this timeline.</p>`
          ].join('\n')
        })
        .pipe(
          Effect.tapError(error =>
            Effect.logError('Failed to send invitation email', {
              timelineId: parsed.timelineId,
              inviteEmail: normalizedEmail,
              error
            })
          )
        );

      return member;
    }).pipe(
      // --------------------------------------------------------
      // 13. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.timeline.inviteMember', {
        attributes: { operation: 'timeline.inviteMember' }
      }),

      // --------------------------------------------------------
      // 14. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 15. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.timeline.inviteMember failed', { error: e })),

      // --------------------------------------------------------
      // 16. HANDLE RESULT
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
            Match.when('ConstraintError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to invite member'
              })
            )
          ),

        onSuccess: member =>
          Effect.sync(() => {
            // --------------------------------------------------------
            // 16. REVALIDATE CACHE
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
