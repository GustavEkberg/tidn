import { Effect } from 'effect';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq } from 'drizzle-orm';

// ============================================================
// Process Media — stub for async thumbnail/EXIF processing
//
// This module will be fleshed out by processing-1 (photo),
// processing-2 (video), and processing-3 (HEIC conversion).
// For now it sets processingStatus to 'completed' as a no-op.
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
 * Current behavior (stub): marks media as completed.
 * Future: EXIF stripping, thumbnail generation, HEIC conversion,
 * video frame extraction.
 *
 * Requires Db + S3 services in context.
 */
export const processMedia = (input: ProcessMediaInput) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const _s3 = yield* S3;

    yield* Effect.annotateCurrentSpan({
      'media.id': input.mediaId,
      'media.type': input.type,
      'media.mimeType': input.mimeType,
      'media.s3Key': input.s3Key
    });

    // TODO: processing-1 — photo EXIF extraction, stripping, thumbnail
    // TODO: processing-2 — video frame extraction for thumbnail
    // TODO: processing-3 — HEIC to JPEG conversion

    // For now, mark as completed (no-op stub)
    yield* db
      .update(schema.media)
      .set({ processingStatus: 'completed' })
      .where(eq(schema.media.id, input.mediaId));

    yield* Effect.logInfo('Media processing completed (stub)', {
      mediaId: input.mediaId
    });
  }).pipe(Effect.withSpan('media.process'));
