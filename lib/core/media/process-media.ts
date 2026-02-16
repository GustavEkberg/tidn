import { Effect } from 'effect';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq } from 'drizzle-orm';
import { processPhoto } from '@/lib/core/media/process-photo';

// ============================================================
// Process Media — async thumbnail/EXIF processing pipeline
//
// Routes to type-specific processors:
// - photo → processPhoto (EXIF extraction, stripping, thumbnail)
// - video → stub (processing-2 will implement frame extraction)
// ============================================================

export interface ProcessMediaInput {
  readonly mediaId: string;
  readonly s3Key: string;
  readonly mimeType: string;
  readonly type: 'photo' | 'video';
}

/**
 * Async media processing pipeline.
 *
 * Photos: EXIF extraction, metadata stripping, thumbnail generation.
 * Videos: stub (marks completed — processing-2 will implement).
 *
 * On failure: sets processingStatus='failed', logs error.
 * Requires Db + S3 services in context.
 */
export const processMedia = (input: ProcessMediaInput) =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({
      'media.id': input.mediaId,
      'media.type': input.type,
      'media.mimeType': input.mimeType,
      'media.s3Key': input.s3Key
    });

    if (input.type === 'photo') {
      // --------------------------------------------------------
      // PHOTO PROCESSING
      // --------------------------------------------------------
      yield* processPhoto({
        mediaId: input.mediaId,
        s3Key: input.s3Key,
        mimeType: input.mimeType
      });
    } else {
      // --------------------------------------------------------
      // VIDEO PROCESSING (stub — processing-2 will implement)
      // --------------------------------------------------------
      const db = yield* Db;

      yield* db
        .update(schema.media)
        .set({ processingStatus: 'completed' })
        .where(eq(schema.media.id, input.mediaId));

      yield* Effect.logInfo('Video processing completed (stub)', {
        mediaId: input.mediaId
      });
    }
  }).pipe(
    // --------------------------------------------------------
    // ERROR HANDLING — on failure, mark as 'failed' (no crash)
    // --------------------------------------------------------
    Effect.tapError(error =>
      Effect.gen(function* () {
        yield* Effect.logError('Media processing failed', {
          mediaId: input.mediaId,
          type: input.type,
          error
        });

        const db = yield* Db;
        yield* db
          .update(schema.media)
          .set({ processingStatus: 'failed' })
          .where(eq(schema.media.id, input.mediaId))
          .pipe(
            Effect.tapError(dbError =>
              Effect.logError('Failed to update processingStatus to failed', {
                mediaId: input.mediaId,
                dbError
              })
            ),
            Effect.catchAll(() => Effect.void)
          );
      })
    ),
    Effect.withSpan('media.process')
  );
