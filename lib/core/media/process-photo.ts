import { Effect } from 'effect';
import sharp from 'sharp';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq } from 'drizzle-orm';

// ============================================================
// Photo Processing — EXIF extraction, metadata stripping,
// HEIC→JPEG conversion, thumbnail generation
//
// Pipeline:
// 1. Download original from S3
// 2. Extract EXIF metadata (date, dimensions, orientation)
// 3. If HEIC/HEIF: convert to JPEG (browsers can't display HEIC)
// 4. Strip ALL metadata from original (GPS, device info, etc.)
// 5. Re-upload processed image to S3 (overwrite or new key for HEIC)
// 6. Generate thumbnail (400px wide) and upload to S3
// 7. Update media record with extracted metadata + status
// ============================================================

const THUMBNAIL_WIDTH = 400;

const HEIC_MIME_TYPES: ReadonlySet<string> = new Set(['image/heic', 'image/heif']);

const isHeic = (mimeType: string): boolean => HEIC_MIME_TYPES.has(mimeType);

/**
 * Derive thumbnail S3 key from original key.
 * `timelines/x/y/file.jpg` → `timelines/x/y/file-thumb.jpg`
 * Thumbnails are always JPEG regardless of source format.
 */
const getThumbnailKey = (originalKey: string): string => {
  const lastDot = originalKey.lastIndexOf('.');
  const base = lastDot === -1 ? originalKey : originalKey.slice(0, lastDot);
  return `${base}-thumb.jpg`;
};

/**
 * Replace the file extension in an S3 key.
 * `timelines/x/y/file.heic` → `timelines/x/y/file.jpg`
 */
const replaceExtension = (key: string, newExt: string): string => {
  const lastDot = key.lastIndexOf('.');
  const base = lastDot === -1 ? key : key.slice(0, lastDot);
  return `${base}.${newExt}`;
};

export interface ProcessPhotoInput {
  readonly mediaId: string;
  readonly s3Key: string;
  readonly mimeType: string;
}

/**
 * Process a photo: extract EXIF, strip metadata, convert HEIC→JPEG,
 * generate thumbnail.
 *
 * HEIC/HEIF files are converted to JPEG for browser display.
 * The original HEIC is deleted from S3 and replaced with a JPEG
 * at a new key (same path, .jpg extension). The media record's
 * s3Key and mimeType are updated accordingly.
 *
 * Requires Db + S3 services in context.
 */
export const processPhoto = (input: ProcessPhotoInput) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const s3 = yield* S3;

    const heicConversion = isHeic(input.mimeType);

    yield* Effect.annotateCurrentSpan({
      'media.id': input.mediaId,
      'media.s3Key': input.s3Key,
      'media.mimeType': input.mimeType,
      'media.heicConversion': heicConversion
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
    // 3. STRIP METADATA + AUTO-ROTATE + HEIC→JPEG CONVERSION
    //    Sharp auto-rotates based on EXIF orientation when
    //    .rotate() is called with no args.
    //    For HEIC/HEIF: convert to JPEG for browser compat.
    //    For other formats: re-encode in same format.
    // --------------------------------------------------------
    let pipeline = sharp(originalBuffer)
      .rotate() // auto-rotate based on EXIF orientation
      .withMetadata({ orientation: undefined }); // strip all EXIF

    if (heicConversion) {
      pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
    }

    const strippedBuffer = yield* Effect.tryPromise(() => pipeline.toBuffer());

    yield* Effect.annotateCurrentSpan({
      'media.strippedSize': strippedBuffer.length
    });

    // --------------------------------------------------------
    // 4. DETERMINE OUTPUT S3 KEY + MIME TYPE
    //    HEIC: new key with .jpg extension, delete old HEIC key
    //    Other: overwrite at same key
    // --------------------------------------------------------
    const outputS3Key = heicConversion ? replaceExtension(input.s3Key, 'jpg') : input.s3Key;
    const outputMimeType = heicConversion ? 'image/jpeg' : input.mimeType;

    yield* s3.saveFile(outputS3Key, strippedBuffer, outputMimeType);

    // Delete the original HEIC file if we wrote to a new key
    if (heicConversion && outputS3Key !== input.s3Key) {
      yield* s3.deleteFile(input.s3Key);

      yield* Effect.logInfo('HEIC converted to JPEG, original deleted', {
        mediaId: input.mediaId,
        originalKey: input.s3Key,
        newKey: outputS3Key
      });
    }

    yield* Effect.logInfo('Processed photo uploaded', {
      mediaId: input.mediaId,
      originalSize: originalBuffer.length,
      strippedSize: strippedBuffer.length,
      heicConversion
    });

    // --------------------------------------------------------
    // 5. GENERATE THUMBNAIL (400px wide, always JPEG)
    // --------------------------------------------------------
    const thumbnailBuffer = yield* Effect.tryPromise(() =>
      sharp(originalBuffer)
        .rotate() // auto-rotate before resize
        .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer()
    );

    const thumbnailKey = getThumbnailKey(outputS3Key);

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
    //    For HEIC: also update s3Key and mimeType to reflect
    //    the converted JPEG.
    // --------------------------------------------------------
    const baseUpdate = {
      thumbnailS3Key: thumbnailKey,
      width: finalWidth,
      height: finalHeight,
      processingStatus: 'completed' as const
    };

    const update = heicConversion
      ? { ...baseUpdate, s3Key: outputS3Key, mimeType: outputMimeType }
      : baseUpdate;

    yield* db.update(schema.media).set(update).where(eq(schema.media.id, input.mediaId));

    yield* Effect.logInfo('Photo processing completed', {
      mediaId: input.mediaId,
      width: finalWidth,
      height: finalHeight,
      thumbnailKey,
      heicConversion,
      s3Key: outputS3Key
    });
  }).pipe(Effect.withSpan('media.processPhoto'));
