import { describe, expect, it } from '@effect/vitest';
import { Effect, Duration, TestClock, Fiber, Schedule } from 'effect';

/**
 * TestClock patterns for deterministic time-based testing
 *
 * CRITICAL: Always fork effects that use time (sleep, timeout, retry, schedule).
 * The TestClock only affects forked effects. Without forking, Effect.sleep blocks
 * forever because the clock never advances.
 *
 * See specs/EFFECT_TESTING.md for full TestClock documentation.
 */

describe('TestClock patterns', () => {
  /**
   * Fork + TestClock.adjust - Basic pattern
   *
   * WHY FORK IS REQUIRED:
   * - TestClock.adjust only affects forked effects
   * - Without fork, Effect.sleep blocks forever (clock doesn't auto-advance)
   * - Fork lets you advance time while the effect is suspended
   */
  it.effect('advances time for forked effects', () =>
    Effect.gen(function* () {
      // Fork an effect that sleeps for 10 seconds
      // Without fork, this would block forever!
      const fiber = yield* Effect.fork(
        Effect.sleep(Duration.seconds(10)).pipe(Effect.map(() => 'completed'))
      );

      // Advance the TestClock by 10 seconds
      // This makes the forked sleep complete instantly
      yield* TestClock.adjust(Duration.seconds(10));

      // Join the fiber - it's already done
      const result = yield* Fiber.join(fiber);
      expect(result).toBe('completed');
    })
  );

  /**
   * Timeout testing with TestClock
   *
   * Tests that operations time out correctly without waiting for real time.
   */
  it.effect('times out slow operations', () =>
    Effect.gen(function* () {
      // Fork an effect with a 10-second timeout
      // The sleep is 30 seconds, so it should time out
      const fiber = yield* Effect.fork(
        Effect.sleep(Duration.seconds(30))
          .pipe(Effect.as('completed'))
          .pipe(Effect.timeoutOption(Duration.seconds(10)))
      );

      // Advance past the timeout threshold
      yield* TestClock.adjust(Duration.seconds(10));

      // The effect timed out, returning Option.none()
      const result = yield* Fiber.join(fiber);
      expect(result._tag).toBe('None');
    })
  );

  /**
   * Retry with exponential backoff
   *
   * Tests retry logic without waiting for exponential delays.
   * Demonstrates multiple TestClock.adjust calls for different retry intervals.
   */
  it.effect('retries with exponential backoff', () =>
    Effect.gen(function* () {
      let attempts = 0;

      // Effect that fails twice, then succeeds
      const unreliableEffect = Effect.gen(function* () {
        attempts++;
        if (attempts < 3) {
          return yield* Effect.fail(new Error('not ready'));
        }
        return 'success';
      }).pipe(
        Effect.retry({
          times: 5,
          schedule: Schedule.exponential(Duration.millis(100))
        })
      );

      const fiber = yield* Effect.fork(unreliableEffect);

      // First retry after 100ms (2^0 * 100)
      yield* TestClock.adjust(Duration.millis(100));

      // Second retry after 200ms (2^1 * 100)
      yield* TestClock.adjust(Duration.millis(200));

      // Effect should now succeed
      const result = yield* Fiber.join(fiber);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    })
  );

  /**
   * ANTI-PATTERN: Effect.sleep without fork
   *
   * This test demonstrates what NOT to do.
   * Uncomment to see it block forever.
   */
  // it.effect('BROKEN - blocks forever without fork', () =>
  //   Effect.gen(function* () {
  //     // This will block forever because TestClock.adjust is never reached!
  //     yield* Effect.sleep(Duration.seconds(10))
  //     yield* TestClock.adjust(Duration.seconds(10)) // Never executed
  //   })
  // )
});
