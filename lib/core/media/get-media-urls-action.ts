'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { S3 } from '@/lib/services/s3/live-layer';

type UrlResult = {
  readonly _tag: 'Success';
  readonly urls: Record<string, string>;
};

type ErrorResult = {
  readonly _tag: 'Error';
  readonly message: string;
};

/**
 * Generate signed download URLs for a batch of S3 keys.
 * Returns a map of s3Key -> signedUrl.
 *
 * Only generates URLs for non-empty keys. Skips nulls/empty strings.
 */
export const getMediaUrlsAction = async (
  s3Keys: ReadonlyArray<string>
): Promise<UrlResult | ErrorResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* getSession();
      const s3 = yield* S3;

      const validKeys = s3Keys.filter(k => k.length > 0);

      yield* Effect.annotateCurrentSpan({
        'media.keyCount': validKeys.length
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
