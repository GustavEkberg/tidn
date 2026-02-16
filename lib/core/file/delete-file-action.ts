'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { S3 } from '@/lib/services/s3/live-layer';

/**
 * Server action to delete a file from S3.
 *
 * @param fileUrl - The public URL of the file to delete (or the S3 key)
 *
 * @example
 * ```tsx
 * const result = await deleteFileAction('https://bucket.s3.region.amazonaws.com/avatars/user123/photo.jpg')
 * if (result._tag === 'Success') {
 *   // File deleted, update your database to remove the reference
 * }
 * ```
 */
export const deleteFileAction = async (fileUrl: string) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();
      const s3 = yield* S3;

      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'file.url': fileUrl
      });

      // Extract key from URL if it's a full URL
      const key = fileUrl.startsWith('https://') ? s3.getObjectKeyFromUrl(fileUrl) : fileUrl;

      yield* s3.deleteFile(key);
    }).pipe(
      Effect.withSpan('action.file.delete', {
        attributes: {
          'file.url': fileUrl,
          operation: 'file.delete'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to delete file'
              })
            )
          ),
        onSuccess: () => Effect.succeed({ _tag: 'Success' as const })
      })
    )
  );
};
