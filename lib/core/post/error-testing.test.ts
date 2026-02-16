import { describe, it, expect } from '@effect/vitest';
import { Effect, Exit, Cause } from 'effect';
import { UnauthenticatedError, NotFoundError, ValidationError } from '@/lib/core/errors';

/**
 * Demonstrates error testing patterns with Effect
 *
 * Three primary patterns for testing errors:
 * 1. Effect.either - converts errors to Either<E, A> for Left/Right matching
 * 2. Effect.exit - converts to Exit for full Cause inspection (including defects)
 * 3. Effect.catchTag - recovers from specific error types
 *
 * For layer sharing and mocking, see test-3 (layer-sharing.test.ts).
 * For property testing, see test-5 (property-testing.test.ts).
 */

/**
 * Pattern 1: Effect.either for expected errors
 *
 * Use Effect.either when:
 * - Testing expected error types (domain errors)
 * - You need to assert error properties (message, fields, etc.)
 * - Error recovery isn't needed (just verification)
 *
 * Returns Either<E, A>:
 * - Left(error) when effect fails
 * - Right(value) when effect succeeds
 */
describe('Effect.either for error assertions', () => {
  it.effect('converts UnauthenticatedError to Left', () =>
    Effect.gen(function* () {
      const getUser = Effect.fail(new UnauthenticatedError({ message: 'Session expired' }));

      const result = yield* getUser.pipe(Effect.either);

      // Assert Left tag
      expect(result._tag).toBe('Left');

      // Type guard for Left access
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthenticatedError');
        expect(result.left.message).toBe('Session expired');
      }
    })
  );

  it.effect('converts success to Right', () =>
    Effect.gen(function* () {
      const getUser = Effect.succeed({ id: 'user-1', email: 'test@example.com' });

      const result = yield* getUser.pipe(Effect.either);

      expect(result._tag).toBe('Right');

      if (result._tag === 'Right') {
        expect(result.right.id).toBe('user-1');
        expect(result.right.email).toBe('test@example.com');
      }
    })
  );

  it.effect('tests ValidationError with field information', () =>
    Effect.gen(function* () {
      const validateTitle = (title: string) =>
        title.length < 3
          ? Effect.fail(
              new ValidationError({
                message: 'Title too short',
                field: 'title'
              })
            )
          : Effect.succeed(title);

      const result = yield* validateTitle('ab').pipe(Effect.either);

      expect(result._tag).toBe('Left');

      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('ValidationError');
        expect(result.left.field).toBe('title');
        expect(result.left.message).toBe('Title too short');
      }
    })
  );
});

/**
 * Pattern 2: Effect.exit for Cause inspection
 *
 * Use Effect.exit when:
 * - You need to distinguish between failures and defects
 * - Testing error chains or multiple errors
 * - Inspecting Cause metadata (spans, annotations)
 *
 * Returns Exit<E, A>:
 * - Success(value) when effect succeeds
 * - Failure(cause) when effect fails/dies
 *
 * Cause can represent:
 * - Fail(error) - expected domain error
 * - Die(defect) - unexpected error (like throw)
 * - Interrupt - fiber interruption
 * - Sequential/Parallel - error combinations
 */
describe('Effect.exit for Cause inspection', () => {
  it.effect('distinguishes Fail from Die', () =>
    Effect.gen(function* () {
      const failEffect = Effect.fail(
        new NotFoundError({ message: 'Not found', entity: 'post', id: '123' })
      );

      const result = yield* failEffect.pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        // Check if Cause is a failure (not defect)
        expect(Cause.isFailType(result.cause)).toBe(true);

        // Extract error from Cause
        const error = Cause.failureOption(result.cause);
        expect(error._tag).toBe('Some');

        if (error._tag === 'Some') {
          expect(error.value._tag).toBe('NotFoundError');
          expect(error.value.entity).toBe('post');
          expect(error.value.id).toBe('123');
        }
      }
    })
  );

  it.effect('detects defects (thrown errors) as Die', () =>
    Effect.gen(function* () {
      const defectEffect = Effect.sync(() => {
        throw new Error('Unexpected error');
      });

      const result = yield* defectEffect.pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        // Defects are Die, not Fail
        expect(Cause.isDieType(result.cause)).toBe(true);

        // Extract defect
        const defect = Cause.dieOption(result.cause);
        expect(defect._tag).toBe('Some');

        if (defect._tag === 'Some') {
          const error = defect.value;
          expect(error).toBeInstanceOf(Error);
          if (error instanceof Error) {
            expect(error.message).toBe('Unexpected error');
          }
        }
      }
    })
  );

  it.effect('inspects success exit', () =>
    Effect.gen(function* () {
      const successEffect = Effect.succeed({ data: 'result' });

      const result = yield* successEffect.pipe(Effect.exit);

      expect(Exit.isSuccess(result)).toBe(true);

      if (Exit.isSuccess(result)) {
        expect(result.value).toEqual({ data: 'result' });
      }
    })
  );

  it.effect('handles sequential errors with Cause', () =>
    Effect.gen(function* () {
      // Chain of effects where first fails
      const pipeline = Effect.fail(new UnauthenticatedError({ message: 'Not logged in' })).pipe(
        Effect.flatMap(() => Effect.succeed('This will not run'))
      );

      const result = yield* pipeline.pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        const error = Cause.failureOption(result.cause);
        expect(error._tag).toBe('Some');

        if (error._tag === 'Some') {
          expect(error.value._tag).toBe('UnauthenticatedError');
        }
      }
    })
  );
});

/**
 * Pattern 3: Effect.catchTag for error recovery
 *
 * Use Effect.catchTag when:
 * - Recovering from specific error types
 * - Providing fallback values
 * - Testing error handling logic
 *
 * catchTag matches error by _tag property, useful for:
 * - Handling only certain errors (others propagate)
 * - Different recovery strategies per error type
 * - Converting errors to default values
 */
describe('Effect.catchTag for error recovery', () => {
  it.effect('recovers from NotFoundError with default', () =>
    Effect.gen(function* () {
      const getPost = (id: string): Effect.Effect<{ id: string; title: string }, NotFoundError> =>
        id === 'invalid'
          ? Effect.fail(new NotFoundError({ message: 'Post not found', entity: 'post', id }))
          : Effect.succeed({ id, title: 'Found Post' });

      // Recover from NotFoundError with null
      const result = yield* Effect.catchTag(getPost('invalid'), 'NotFoundError', () =>
        Effect.succeed(null)
      );

      expect(result).toBe(null);
    })
  );

  it.effect('allows unhandled errors to propagate', () =>
    Effect.gen(function* () {
      const operation: Effect.Effect<string, UnauthenticatedError | NotFoundError> = Effect.fail(
        new UnauthenticatedError({ message: 'Not logged in' })
      );

      // catchTag only catches NotFoundError, not UnauthenticatedError
      const result = yield* operation.pipe(
        Effect.catchTag('NotFoundError', () => Effect.succeed<string>('recovered')),
        Effect.either
      );

      expect(result._tag).toBe('Left');

      if (result._tag === 'Left') {
        // UnauthenticatedError propagated through catchTag
        expect(result.left._tag).toBe('UnauthenticatedError');
      }
    })
  );

  it.effect('chains multiple catchTag for different errors', () =>
    Effect.gen(function* () {
      const operation = (
        scenario: 'notfound' | 'unauth' | 'success'
      ): Effect.Effect<string, NotFoundError | UnauthenticatedError> => {
        if (scenario === 'notfound') {
          return Effect.fail(new NotFoundError({ message: 'Not found', entity: 'post', id: '1' }));
        }
        if (scenario === 'unauth') {
          return Effect.fail(new UnauthenticatedError({ message: 'Not logged in' }));
        }
        return Effect.succeed('success');
      };

      // Recover from both error types using nested catchTag
      const notFoundRecovered = Effect.catchTag(operation('notfound'), 'NotFoundError', () =>
        Effect.succeed('default-for-notfound')
      );
      const notFoundResult = yield* Effect.catchTag(notFoundRecovered, 'UnauthenticatedError', () =>
        Effect.succeed('default-for-unauth')
      );

      const unauthRecovered = Effect.catchTag(operation('unauth'), 'NotFoundError', () =>
        Effect.succeed('default-for-notfound')
      );
      const unauthResult = yield* Effect.catchTag(unauthRecovered, 'UnauthenticatedError', () =>
        Effect.succeed('default-for-unauth')
      );

      const successRecovered = Effect.catchTag(operation('success'), 'NotFoundError', () =>
        Effect.succeed('default-for-notfound')
      );
      const successResult = yield* Effect.catchTag(successRecovered, 'UnauthenticatedError', () =>
        Effect.succeed('default-for-unauth')
      );

      expect(notFoundResult).toBe('default-for-notfound');
      expect(unauthResult).toBe('default-for-unauth');
      expect(successResult).toBe('success');
    })
  );

  it.effect('uses error data in recovery logic', () =>
    Effect.gen(function* () {
      const getPost = (id: string) =>
        Effect.fail(
          new NotFoundError({
            message: `Post ${id} not found`,
            entity: 'post',
            id
          })
        );

      // Access error properties in recovery
      const result = yield* getPost('123').pipe(
        Effect.catchTag('NotFoundError', error =>
          Effect.succeed({
            id: error.id,
            title: 'Deleted Post',
            deleted: true
          })
        )
      );

      expect(result.id).toBe('123');
      expect(result.title).toBe('Deleted Post');
      expect(result.deleted).toBe(true);
    })
  );
});

/**
 * Bonus: Combining patterns
 *
 * Real-world tests often combine:
 * - catchTag for recovery
 * - either for testing recovery logic
 * - exit for Cause inspection
 */
describe('Combining error patterns', () => {
  it.effect('tests recovery with Effect.either', () =>
    Effect.gen(function* () {
      const operation = Effect.fail(
        new NotFoundError({ message: 'Not found', entity: 'post', id: '1' })
      );

      // Recover and verify with either
      const result = yield* operation.pipe(
        Effect.catchTag('NotFoundError', () => Effect.succeed('recovered')),
        Effect.either
      );

      expect(result._tag).toBe('Right');

      if (result._tag === 'Right') {
        expect(result.right).toBe('recovered');
      }
    })
  );

  it.effect('tests partial recovery leaving some errors', () =>
    Effect.gen(function* () {
      const operation: Effect.Effect<string, UnauthenticatedError | NotFoundError> = Effect.fail(
        new UnauthenticatedError({ message: 'Not logged in' })
      );

      // Recover NotFoundError, but not UnauthenticatedError
      const result = yield* operation.pipe(
        Effect.catchTag('NotFoundError', () => Effect.succeed<string>('recovered')),
        Effect.either
      );

      expect(result._tag).toBe('Left');

      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthenticatedError');
      }
    })
  );
});
