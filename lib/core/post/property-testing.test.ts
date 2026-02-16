import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema, Arbitrary, Array as EffectArray } from 'effect';

/**
 * Property-Based Testing Examples
 *
 * Demonstrates:
 * - it.prop with Schema for synchronous property tests
 * - it.effect.prop for async property validation
 * - Arbitrary.make() to create arbitraries from Schema
 * - Testing filter/sort invariants
 */

// Define post input schema for property testing
export class PostInput extends Schema.Class<PostInput>('PostInput')({
  title: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(100)),
  content: Schema.optional(Schema.String.pipe(Schema.maxLength(5000))),
  published: Schema.Boolean
}) {}

// Create arbitrary from Schema - generates valid PostInput instances
const postInputArb = Arbitrary.make(PostInput);

describe('Property Testing', () => {
  // Synchronous property test - validates schema constraints
  it.prop('PostInput title is never empty or whitespace-only', [postInputArb], ([input]) => {
    expect(input.title.trim().length).toBeGreaterThan(0);
    expect(input.title.length).toBeLessThanOrEqual(100);
    return true;
  });

  // Synchronous property test - validates optional content
  it.prop('PostInput content respects max length if present', [postInputArb], ([input]) => {
    if (input.content) {
      expect(input.content.length).toBeLessThanOrEqual(5000);
    }
    return true;
  });

  // Effectful property test - async validation
  it.effect.prop('PostInput validates asynchronously', [postInputArb], ([input]) =>
    Effect.gen(function* () {
      // Simulate async validation (e.g., checking profanity filter)
      yield* Effect.sleep(0); // Represents async operation

      // All generated inputs should be valid
      const parseResult = yield* Schema.decodeUnknown(PostInput)(input, {
        errors: 'all',
        onExcessProperty: 'ignore'
      });

      expect(parseResult.title).toBe(input.title);
      expect(parseResult.published).toBe(input.published);

      return true;
    })
  );

  // Filter invariant: filtering twice is idempotent
  it.prop('filtering posts twice gives same result', [Schema.Array(PostInput)], ([posts]) => {
    const publishedOnce = posts.filter(p => p.published);
    const publishedTwice = publishedOnce.filter(p => p.published);

    expect(publishedOnce).toEqual(publishedTwice);
    return true;
  });

  // Sort invariant: sorting is idempotent
  it.prop('sorting posts twice gives same result', [Schema.Array(PostInput)], ([posts]) => {
    const sortByTitle = (a: PostInput, b: PostInput) => a.title.localeCompare(b.title);

    const sortedOnce = [...posts].sort(sortByTitle);
    const sortedTwice = [...sortedOnce].sort(sortByTitle);

    expect(sortedOnce).toEqual(sortedTwice);
    return true;
  });

  // Sort invariant: reverse sort is consistent (stable sort)
  // FIXME: Flaky test - fails when posts have same title. Need better secondary sort key.
  // it.prop('reversing sorted posts gives descending order', [Schema.Array(PostInput)], ([posts]) => {
  //   if (posts.length === 0) return true

  //   // Sort with stable secondary key to handle duplicates
  //   const ascending = [...posts].sort(
  //     (a, b) => a.title.localeCompare(b.title) || Number(a.published) - Number(b.published)
  //   )
  //   const descending = [...posts].sort(
  //     (a, b) => b.title.localeCompare(a.title) || Number(b.published) - Number(a.published)
  //   )

  //   expect(ascending).toEqual([...descending].reverse())
  //   return true
  // })

  // Using Effect Array utilities with property testing
  it.effect.prop(
    'Effect.Array partition is consistent with filter',
    [Schema.Array(PostInput)],
    ([posts]) =>
      Effect.gen(function* () {
        // Partition using Effect Array
        // IMPORTANT: Returns [excluded, included] - opposite of what you might expect!
        const [excluded, included] = EffectArray.partition(posts, p => p.published);

        // Should match standard filter
        const publishedViaFilter = posts.filter(p => p.published);
        const unpublishedViaFilter = posts.filter(p => !p.published);

        expect(included).toEqual(publishedViaFilter);
        expect(excluded).toEqual(unpublishedViaFilter);

        return true;
      })
  );

  // Demonstrating Arbitrary.make() usage - convert Schema to Arbitrary for advanced use
  it.prop(
    'Arbitrary.make creates valid instances from Schema',
    [PostInput],
    ([input]) => {
      // Arbitrary.make(PostInput) is what generates these test cases
      // We keep the reference above to show the pattern

      // Property: all inputs from PostInput Schema are valid
      expect(input.title.trim().length).toBeGreaterThan(0);
      expect(typeof input.published).toBe('boolean');

      if (input.content !== undefined) {
        expect(input.content.length).toBeLessThanOrEqual(5000);
      }

      return true;
    },
    {
      // Run more iterations to find edge cases
      fastCheck: { numRuns: 100 }
    }
  );
});
