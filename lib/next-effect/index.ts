import { Data, Effect, Either } from 'effect';
import { redirect } from 'next/navigation';

// Tagged error for redirect intents
class RedirectError extends Data.TaggedError('RedirectError')<{
  path: string;
}> {}

/**
 * Create a redirect effect. Use this instead of Next.js redirect() inside Effect pipelines.
 */
const redirectEffect = (path: string) => Effect.fail(new RedirectError({ path }));

/**
 * Custom Effect.runPromise that handles Next.js redirects outside the Effect context.
 */
const runPromise = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const result = await Effect.runPromise(
    Effect.catchAll(Effect.map(effect, Either.right), e =>
      e instanceof RedirectError ? Effect.succeed(Either.left(e)) : Effect.fail(e)
    )
  );
  if (Either.isLeft(result)) {
    return redirect(result.left.path);
  }
  return result.right;
};

export const NextEffect = {
  redirect: redirectEffect,
  runPromise
};
