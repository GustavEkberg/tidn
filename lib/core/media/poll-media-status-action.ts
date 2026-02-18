'use server';

import { Effect, Match } from 'effect';
import { inArray } from 'drizzle-orm';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';

type MediaStatus = {
  readonly id: string;
  readonly processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  readonly thumbnailS3Key: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
};

type SuccessResult = {
  readonly _tag: 'Success';
  readonly media: ReadonlyArray<MediaStatus>;
};

type ErrorResult = {
  readonly _tag: 'Error';
  readonly message: string;
};

/**
 * Poll processing status for a batch of media IDs.
 * Used by client to detect when background processing completes.
 */
export const pollMediaStatusAction = async (
  mediaIds: ReadonlyArray<string>
): Promise<SuccessResult | ErrorResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* getSession();
      const db = yield* Db;

      const emptyMedia: ReadonlyArray<MediaStatus> = [];

      if (mediaIds.length === 0) {
        return { _tag: 'Success' as const, media: emptyMedia };
      }

      // Cap at 50 to prevent abuse
      const ids = mediaIds.slice(0, 50);

      const rows = yield* db
        .select({
          id: schema.media.id,
          processingStatus: schema.media.processingStatus,
          thumbnailS3Key: schema.media.thumbnailS3Key,
          width: schema.media.width,
          height: schema.media.height,
          duration: schema.media.duration
        })
        .from(schema.media)
        .where(inArray(schema.media.id, [...ids]));

      const media: ReadonlyArray<MediaStatus> = rows;

      return {
        _tag: 'Success' as const,
        media
      };
    }).pipe(
      Effect.withSpan('action.media.pollStatus'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.tapError(e => Effect.logError('action.media.pollStatus failed', { error: e })),
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.tag('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to poll media status'
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
};
