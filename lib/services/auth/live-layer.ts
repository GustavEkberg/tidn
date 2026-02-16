import { Effect, Context, Layer, Config } from 'effect';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import * as schema from '../db/schema';
import { emailOTP } from 'better-auth/plugins';
import { Email } from '../email/live-layer';
import { AuthApiError, AuthConfigError } from './errors';
import { drizzle as drizzleNeon, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

// Auth database service (internal) - uses Neon HTTP driver for serverless or local pg
class AuthDb extends Context.Tag('@app/AuthDb')<
  AuthDb,
  NeonHttpDatabase<typeof schema> | NodePgDatabase<typeof schema>
>() {}

const AuthDbLive = Layer.effect(
  AuthDb,
  Effect.gen(function* () {
    const url = yield* Config.string('DATABASE_URL');
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');

    if (isLocal) {
      const pool = new pg.Pool({ connectionString: url });
      return drizzleNode({ client: pool, schema });
    }
    return drizzleNeon({ connection: url, schema });
  })
);

// Auth configuration service (internal)
class AuthConfig extends Context.Tag('@app/AuthConfig')<
  AuthConfig,
  {
    readonly projectUrl: string;
    readonly appName: string;
    readonly emailSender: string;
    readonly vercelUrl: string | undefined;
    readonly vercelBranchUrl: string | undefined;
  }
>() {}

const AuthConfigLive = Layer.effect(
  AuthConfig,
  Effect.gen(function* () {
    const projectUrl = yield* Config.string('VERCEL_PROJECT_PRODUCTION_URL').pipe(
      Effect.mapError(
        () => new AuthConfigError({ message: 'VERCEL_PROJECT_PRODUCTION_URL not found' })
      )
    );
    const appName = yield* Config.string('APP_NAME').pipe(
      Effect.mapError(() => new AuthConfigError({ message: 'APP_NAME not found' }))
    );
    const emailSender = yield* Config.string('EMAIL_SENDER').pipe(
      Effect.mapError(() => new AuthConfigError({ message: 'EMAIL_SENDER not found' }))
    );
    // Optional env vars (Vercel deployment)
    const vercelUrl = yield* Config.string('VERCEL_URL').pipe(
      Effect.option,
      Effect.map(opt => (opt._tag === 'Some' ? opt.value : undefined))
    );
    const vercelBranchUrl = yield* Config.string('VERCEL_BRANCH_URL').pipe(
      Effect.option,
      Effect.map(opt => (opt._tag === 'Some' ? opt.value : undefined))
    );

    return { projectUrl, appName, emailSender, vercelUrl, vercelBranchUrl };
  })
);

// Service definition
// v4 migration: Change Effect.Service to ServiceMap.Service
export class Auth extends Effect.Service<Auth>()('@app/Auth', {
  effect: Effect.gen(function* () {
    const authDb = yield* AuthDb;
    const emailService = yield* Email;
    const config = yield* AuthConfig;

    const auth = betterAuth({
      baseURL: config.vercelUrl ? `https://${config.vercelUrl}` : config.projectUrl,
      trustedOrigins: [
        config.projectUrl,
        ...(config.vercelBranchUrl ? [`https://${config.vercelBranchUrl}`] : []),
        ...(config.vercelUrl ? [`https://${config.vercelUrl}`] : [])
      ],
      database: drizzleAdapter(authDb, {
        provider: 'pg',
        schema
      }),
      user: {
        additionalFields: {
          role: {
            type: 'string',
            required: true,
            defaultValue: 'USER',
            input: false
          }
        }
      },
      session: {
        expiresIn: 60 * 60 * 24 * 90, // 90 days
        cookieCache: {
          enabled: true,
          maxAge: 5 * 60
        }
      },
      plugins: [
        emailOTP({
          async sendVerificationOTP({ email, otp, type }) {
            if (type !== 'sign-in') return;

            await emailService
              .sendEmail({
                from: `${config.appName} <${config.emailSender}>`,
                to: email,
                subject: `${config.appName} - Login code`,
                html: `Your login code is: <strong>${otp}</strong>`
              })
              .pipe(
                Effect.tap(result => Effect.log(`OTP email sent: ${result.id}`)),
                Effect.tapError(error =>
                  Effect.logError('Error while sending OTP code', { error })
                ),
                Effect.runPromise
              );
          }
        }),
        nextCookies()
      ]
    });

    const call = <A>(f: (client: typeof auth, signal: AbortSignal) => Promise<A>) =>
      Effect.tryPromise({
        try: signal => f(auth, signal),
        catch: error => new AuthApiError({ error })
      });

    const signUp = (email: string, password: string, name: string) =>
      call(auth => auth.api.signUpEmail({ body: { email, password, name } })).pipe(
        Effect.withSpan('Auth.signUp')
      );

    const signIn = (email: string, password: string) =>
      call(auth => auth.api.signInEmail({ body: { email, password } })).pipe(
        Effect.withSpan('Auth.signIn')
      );

    const signOut = (headers: Headers = new Headers()) =>
      call(auth => auth.api.signOut({ headers })).pipe(Effect.withSpan('Auth.signOut'));

    const getSession = (headers: Headers = new Headers()) =>
      call(auth => auth.api.getSession({ headers })).pipe(Effect.withSpan('Auth.getSession'));

    const updateUser = (data: { name?: string; email?: string }) =>
      call(auth => auth.api.updateUser({ body: data })).pipe(Effect.withSpan('Auth.updateUser'));

    const changePassword = (currentPassword: string, newPassword: string) =>
      call(auth =>
        auth.api.changePassword({
          body: { currentPassword, newPassword }
        })
      ).pipe(Effect.withSpan('Auth.changePassword'));

    const getSessionFromCookies = () =>
      Effect.gen(function* () {
        const { cookies } = yield* Effect.tryPromise(() => import('next/headers'));
        const cookieStore = yield* Effect.tryPromise(() => cookies());

        const headers = new Headers();
        cookieStore.getAll().forEach((cookie: { name: string; value: string }) => {
          headers.append('cookie', `${cookie.name}=${cookie.value}`);
        });

        return yield* getSession(headers);
      }).pipe(Effect.withSpan('Auth.getSessionFromCookies'));

    return {
      auth,
      signUp,
      signIn,
      signOut,
      getSession,
      getSessionFromCookies,
      updateUser,
      changePassword
    } as const;
  })
}) {
  // Base layer (has unsatisfied dependencies: AuthDb, AuthConfig, Email)
  static layer = this.Default;

  // Composed layer with all dependencies satisfied
  static Live = this.layer.pipe(
    Layer.provide(Layer.mergeAll(AuthConfigLive, AuthDbLive, Email.Live))
  );
}
