import { Effect } from 'effect';
import sharp from 'sharp';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq } from 'drizzle-orm';

// ============================================================
// Photo Processing — EXIF extraction, metadata stripping,
// thumbnail generation
//
// Pipeline:
// 1. Download original from S3
// 2. Extract EXIF metadata (date, dimensions, orientation)
// 3. Strip ALL metadata from original (GPS, device info, etc.)
// 4. Re-upload stripped original to S3 (overwrite)
// 5. Generate thumbnail (400px wide) and upload to S3
// 6. Update media record with extracted metadata + status
// ============================================================

const THUMBNAIL_WIDTH = 400;

/**
 * Derive thumbnail S3 key from original key.
 * `timelines/x/y/file.jpg` → `timelines/x/y/file-thumb.jpg`
 */
const getThumbnailKey = (originalKey: string): string => {
  const lastDot = originalKey.lastIndexOf('.');
  if (lastDot === -1) return `${originalKey}-thumb`;
  return `${originalKey.slice(0, lastDot)}-thumb${originalKey.slice(lastDot)}`;
};

export interface ProcessPhotoInput {
  readonly mediaId: string;
  readonly s3Key: string;
  readonly mimeType: string;
}

/**
 * Process a photo: extract EXIF, strip metadata, generate thumbnail.
 *
 * Requires Db + S3 services in context.
 */
export const processPhoto = (input: ProcessPhotoInput) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const s3 = yield* S3;

    yield* Effect.annotateCurrentSpan({
      'media.id': input.mediaId,
      'media.s3Key': input.s3Key,
      'media.mimeType': input.mimeType
    });

    // --------------------------------------------------------
    // 1. DOWNLOAD ORIGINAL FROM S3
    // --------------------------------------------------------
    const originalBuffer = yield* s3.getBuffer(input.s3Key);

    yield* Effect.annotateCurrentSpan({
      'media.originalSize': originalBuffer.length
    });

    // --------------------------------------------------------
    // 2. EXTRACT EXIF METADATA
    // --------------------------------------------------------
    const metadata = yield* Effect.tryPromise(() => sharp(originalBuffer).metadata());

    const width = metadata.width ?? null;
    const height = metadata.height ?? null;

    yield* Effect.annotateCurrentSpan({
      'media.width': width ?? 0,
      'media.height': height ?? 0,
      'media.orientation': metadata.orientation ?? 0,
      'media.format': metadata.format ?? 'unknown'
    });

    yield* Effect.logInfo('Photo EXIF extracted', {
      mediaId: input.mediaId,
      width,
      height,
      orientation: metadata.orientation,
      format: metadata.format
    });

    // --------------------------------------------------------
    // 3. STRIP METADATA + AUTO-ROTATE (based on EXIF orientation)
    //    Re-encode in same format. Sharp auto-rotates based on
    //    EXIF orientation when .rotate() is called with no args.
    // --------------------------------------------------------
    const strippedBuffer = yield* Effect.tryPromise(() =>
      sharp(originalBuffer)
        .rotate() // auto-rotate based on EXIF orientation
        .withMetadata({ orientation: undefined }) // strip all EXIF
        .toBuffer()
    );

    yield* Effect.annotateCurrentSpan({
      'media.strippedSize': strippedBuffer.length
    });

    // --------------------------------------------------------
    // 4. RE-UPLOAD STRIPPED ORIGINAL TO S3 (overwrite)
    // --------------------------------------------------------
    yield* s3.saveFile(input.s3Key, strippedBuffer, input.mimeType);

    yield* Effect.logInfo('Stripped photo re-uploaded', {
      mediaId: input.mediaId,
      originalSize: originalBuffer.length,
      strippedSize: strippedBuffer.length
    });

    // --------------------------------------------------------
    // 5. GENERATE THUMBNAIL (400px wide, JPEG for broad compat)
    // --------------------------------------------------------
    const thumbnailBuffer = yield* Effect.tryPromise(() =>
      sharp(originalBuffer)
        .rotate() // auto-rotate before resize
        .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer()
    );

    const thumbnailKey = getThumbnailKey(input.s3Key);

    yield* s3.saveFile(thumbnailKey, thumbnailBuffer, 'image/jpeg');

    yield* Effect.annotateCurrentSpan({
      'media.thumbnailKey': thumbnailKey,
      'media.thumbnailSize': thumbnailBuffer.length
    });

    yield* Effect.logInfo('Thumbnail generated and uploaded', {
      mediaId: input.mediaId,
      thumbnailKey,
      thumbnailSize: thumbnailBuffer.length
    });

    // --------------------------------------------------------
    // 6. GET FINAL DIMENSIONS (post-rotation — may differ from EXIF)
    // --------------------------------------------------------
    const finalMeta = yield* Effect.tryPromise(() => sharp(strippedBuffer).metadata());
    const finalWidth = finalMeta.width ?? width;
    const finalHeight = finalMeta.height ?? height;

    // --------------------------------------------------------
    // 7. UPDATE MEDIA RECORD
    // --------------------------------------------------------
    yield* db
      .update(schema.media)
      .set({
        thumbnailS3Key: thumbnailKey,
        width: finalWidth,
        height: finalHeight,
        processingStatus: 'completed'
      })
      .where(eq(schema.media.id, input.mediaId));

    yield* Effect.logInfo('Photo processing completed', {
      mediaId: input.mediaId,
      width: finalWidth,
      height: finalHeight,
      thumbnailKey
    });
  }).pipe(Effect.withSpan('media.processPhoto'));
