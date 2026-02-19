'use server';

import { Config, Effect, Match, Schema as S } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { Email } from '@/lib/services/email/live-layer';
import { ValidationError } from '@/lib/core/errors';

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const SendContactInput = S.Struct({
  name: S.String.pipe(S.minLength(1), S.maxLength(100)),
  email: S.String.pipe(S.minLength(1), S.maxLength(200)),
  message: S.String.pipe(S.minLength(1), S.maxLength(2000))
});

type SendContactInput = S.Schema.Type<typeof SendContactInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const sendContactAction = async (input: SendContactInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(SendContactInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'All fields are required',
              field: 'form'
            })
        )
      );

      // --------------------------------------------------------
      // 4. GET SERVICES + CONFIG
      // --------------------------------------------------------
      const email = yield* Email;
      const adminEmail = yield* Config.string('ADMIN_EMAIL');
      const emailSender = yield* Config.string('EMAIL_SENDER');

      // --------------------------------------------------------
      // 5. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'contact.name': parsed.name,
        'contact.email': parsed.email
      });

      // --------------------------------------------------------
      // 6. SEND EMAIL
      // --------------------------------------------------------
      yield* email.sendEmail({
        from: `tidn <${emailSender}>`,
        to: adminEmail,
        subject: `tidn contact: ${parsed.name}`,
        replyTo: parsed.email,
        text: [
          `Name: ${parsed.name}`,
          `Email: ${parsed.email}`,
          '',
          `Message:`,
          parsed.message
        ].join('\n')
      });
    }).pipe(
      // --------------------------------------------------------
      // 7. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.contact.send', {
        attributes: { operation: 'contact.send' }
      }),

      // --------------------------------------------------------
      // 8. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 9. LOG ERRORS
      // --------------------------------------------------------
      Effect.tapError(e => Effect.logError('action.contact.send failed', { error: e })),

      // --------------------------------------------------------
      // 10. HANDLE RESULT
      // --------------------------------------------------------
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('ValidationError', () =>
              Effect.succeed({
                success: false as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                success: false as const,
                message: 'Something went wrong. Try again later.'
              })
            )
          ),

        onSuccess: () =>
          Effect.succeed({
            success: true as const,
            message: "Thanks! I'll get back to you soon."
          })
      })
    )
  );
};
