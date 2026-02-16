'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { S3 } from '@/lib/services/s3/live-layer';

type GetUploadUrlInput = {
  fileName: string;
  folder: string;
};

/**
 * Server action to get a signed URL for uploading a file to S3.
 *
 * Usage:
 * 1. Client calls this action with fileName and folder
 * 2. Server returns signedUrl (for upload) and publicUrl (for storage)
 * 3. Client uploads directly to S3 using the signedUrl
 * 4. Client saves publicUrl to database via another action
 *
 * @example
 * ```tsx
 * const result = await getUploadUrlAction({ fileName: 'photo.jpg', folder: 'avatars' })
 * if (result._tag === 'Success') {
 *   await fetch(result.signedUrl, { method: 'PUT', body: file })
 *   // Now save result.publicUrl to your database
 * }
 * ```
 */
export const getUploadUrlAction = async (input: GetUploadUrlInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();
      const s3 = yield* S3;

      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'file.name': input.fileName,
        'file.folder': input.folder
      });

      // Generate unique key: folder/userId/timestamp-filename
      // This prevents collisions and organizes files by user
      const key = `${input.folder}/${session.user.id}/${Date.now()}-${input.fileName}`;

      // Signed URL expires in 5 minutes - enough time for upload
      const signedUrl = yield* s3.createSignedUrl(key, 300);

      // Public URL is what gets stored in the database
      const publicUrl = s3.getUrlFromObjectKey(key);

      return {
        signedUrl,
        publicUrl,
        key
      };
    }).pipe(
      Effect.withSpan('action.file.getUploadUrl', {
        attributes: {
          'file.name': input.fileName,
          'file.folder': input.folder,
          operation: 'file.getUploadUrl'
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
                message: 'Failed to generate upload URL'
              })
            )
          ),
        onSuccess: data => Effect.succeed({ _tag: 'Success' as const, ...data })
      })
    )
  );
};
