import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponseSuccess
} from 'resend';
import { Resend as ResendClient } from 'resend';
import { Config, Context, Effect, Layer, Redacted } from 'effect';
import { EmailConfigError, SendEmailError } from './errors';

export { EmailConfigError, SendEmailError };

// Configuration service (internal)
class EmailConfig extends Context.Tag('@app/EmailConfig')<
  EmailConfig,
  {
    readonly apiKey: Redacted.Redacted<string>;
  }
>() {}

const EmailConfigLive = Layer.effect(
  EmailConfig,
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted('RESEND_API_KEY').pipe(
      Effect.mapError(() => new EmailConfigError({ message: 'RESEND_API_KEY not found' }))
    );
    return { apiKey };
  })
);

// Service definition
// v4 migration: Change Effect.Service to ServiceMap.Service
export class Email extends Effect.Service<Email>()('@app/Email', {
  effect: Effect.gen(function* () {
    const config = yield* EmailConfig;
    const resendClient = new ResendClient(Redacted.value(config.apiKey));

    const sendEmail = (
      payload: CreateEmailOptions,
      options?: CreateEmailRequestOptions
    ): Effect.Effect<CreateEmailResponseSuccess, SendEmailError> =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          'email.to': Array.isArray(payload.to) ? payload.to.join(',') : payload.to,
          'email.subject': payload.subject ?? 'none'
        });

        const { data, error } = yield* Effect.promise(() =>
          resendClient.emails.send(payload, options)
        );

        if (error) {
          return yield* new SendEmailError({
            message: error.message,
            cause: error
          });
        }

        yield* Effect.annotateCurrentSpan({ 'email.id': data.id });

        return data;
      }).pipe(
        Effect.withSpan('Email.sendEmail'),
        Effect.tapError(error =>
          Effect.logError('Email send failed', {
            to: Array.isArray(payload.to) ? payload.to.join(',') : payload.to,
            subject: payload.subject,
            error
          })
        )
      );

    return { sendEmail } as const;
  })
}) {
  // Base layer (has unsatisfied EmailConfig dependency)
  static layer = this.Default;

  // Composed layer with all dependencies satisfied
  static Live = this.layer.pipe(Layer.provide(EmailConfigLive));
}
