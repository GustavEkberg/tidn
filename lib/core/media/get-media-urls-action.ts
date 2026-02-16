'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { S3 } from '@/lib/services/s3/live-layer';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';

type UrlResult = {
  readonly _tag: 'Success';
  readonly urls: Record<string, string>;
};

type ErrorResult = {
  readonly _tag: 'Error';
  readonly message: string;
};

/**
 * Generate signed download URLs for a batch of S3 keys belonging to a timeline.
 * Returns a map of s3Key -> signedUrl.
 *
 * Verifies the caller has at least viewer access to the timeline.
 * Only generates URLs for keys matching the `timelines/{timelineId}/` prefix.
 * Skips nulls/empty strings and keys outside the timeline scope.
 */
export const getMediaUrlsAction = async (
  timelineId: string,
  s3Keys: ReadonlyArray<string>
): Promise<UrlResult | ErrorResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // Verify caller has viewer access to this timeline
      yield* getTimelineAccess(timelineId, 'viewer');
      const s3 = yield* S3;

      // Only allow keys scoped to this timeline's S3 prefix
      const prefix = `timelines/${timelineId}/`;
      const validKeys = s3Keys.filter(k => k.length > 0 && k.startsWith(prefix));

      yield* Effect.annotateCurrentSpan({
        'timeline.id': timelineId,
        'media.keyCount': validKeys.length,
        'media.rejectedCount': s3Keys.length - validKeys.length
      });

      const entries = yield* Effect.all(
        validKeys.map(key =>
          Effect.gen(function* () {
            const signedUrl = yield* s3.createSignedDownloadUrl(key, 3600);
            return [key, signedUrl] as const;
          })
        ),
        { concurrency: 10 }
      );

      const urls: Record<string, string> = {};
      for (const [key, url] of entries) {
        urls[key] = url;
      }

      return { _tag: 'Success' as const, urls };
    }).pipe(
      Effect.withSpan('action.media.getUrls'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.tag('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.tag('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Timeline not found'
              })
            ),
            Match.tag('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Access denied'
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to generate media URLs'
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
};
