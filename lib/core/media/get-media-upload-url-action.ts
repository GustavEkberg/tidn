'use server';

import { Effect, Match, Schema as S } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { ValidationError } from '@/lib/core/errors';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';
import { eq } from 'drizzle-orm';

// ============================================================
// CONSTANTS
// ============================================================
const PHOTO_MAX_SIZE = 20 * 1024 * 1024; // 20 MB
const VIDEO_MAX_SIZE = 100 * 1024 * 1024; // 100 MB
const SIGNED_URL_EXPIRES_IN = 300; // 5 minutes

const ACCEPTED_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
] as const;

const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

const ACCEPTED_PHOTO_SET: ReadonlySet<string> = new Set(ACCEPTED_PHOTO_TYPES);
const ACCEPTED_MIME_SET: ReadonlySet<string> = new Set([
  ...ACCEPTED_PHOTO_TYPES,
  ...ACCEPTED_VIDEO_TYPES
]);

const isPhotoType = (mime: string): boolean => ACCEPTED_PHOTO_SET.has(mime);

const getMediaType = (mime: string): 'photo' | 'video' => (isPhotoType(mime) ? 'photo' : 'video');

const getMaxFileSize = (mime: string): number =>
  isPhotoType(mime) ? PHOTO_MAX_SIZE : VIDEO_MAX_SIZE;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.round(bytes / (1024 * 1024))}MB`;
};

// ============================================================
// 1. INPUT SCHEMA
// ============================================================
const GetMediaUploadUrlInput = S.Struct({
  eventId: S.String.pipe(S.minLength(1)),
  fileName: S.String.pipe(S.minLength(1), S.maxLength(255)),
  mimeType: S.String.pipe(
    S.filter(s => ACCEPTED_MIME_SET.has(s), {
      message: () => `Unsupported file type. Accepted: JPEG, PNG, WebP, HEIC, MP4, MOV, WebM`
    })
  ),
  fileSize: S.Number.pipe(S.int(), S.greaterThan(0))
});

type GetMediaUploadUrlInput = S.Schema.Type<typeof GetMediaUploadUrlInput>;

// ============================================================
// 2. ACTION FUNCTION
// ============================================================
export const getMediaUploadUrlAction = async (input: GetMediaUploadUrlInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      // --------------------------------------------------------
      // 3. VALIDATE INPUT
      // --------------------------------------------------------
      const parsed = yield* S.decodeUnknown(GetMediaUploadUrlInput)(input).pipe(
        Effect.mapError(
          () =>
            new ValidationError({
              message: 'Invalid input: eventId, fileName, mimeType, and fileSize are required',
              field: 'input'
            })
        )
      );

      // --------------------------------------------------------
      // 4. ENFORCE FILE SIZE LIMITS
      // --------------------------------------------------------
      const maxSize = getMaxFileSize(parsed.mimeType);
      if (parsed.fileSize > maxSize) {
        return yield* new ValidationError({
          message: `File too large (${formatBytes(parsed.fileSize)}). Maximum for ${getMediaType(parsed.mimeType)}s is ${formatBytes(maxSize)}`,
          field: 'fileSize'
        });
      }

      // --------------------------------------------------------
      // 5. AUTHENTICATE + AUTHORIZE
      // --------------------------------------------------------
      const session = yield* getSession();
      const db = yield* Db;

      // Fetch event to get timelineId
      const [existingEvent] = yield* db
        .select({ timelineId: schema.event.timelineId })
        .from(schema.event)
        .where(eq(schema.event.id, parsed.eventId))
        .limit(1);

      if (!existingEvent) {
        return yield* new ValidationError({
          message: 'Event not found',
          field: 'eventId'
        });
      }

      yield* getTimelineAccess(existingEvent.timelineId, 'editor');

      // --------------------------------------------------------
      // 6. ADD SPAN ATTRIBUTES
      // --------------------------------------------------------
      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'event.id': parsed.eventId,
        'timeline.id': existingEvent.timelineId,
        'file.name': parsed.fileName,
        'file.mimeType': parsed.mimeType,
        'file.size': parsed.fileSize
      });

      // --------------------------------------------------------
      // 7. CREATE MEDIA RECORD + SIGNED URL
      // --------------------------------------------------------
      const s3 = yield* S3;

      const s3Key = `timelines/${existingEvent.timelineId}/${parsed.eventId}/${Date.now()}-${parsed.fileName}`;
      const mediaType = getMediaType(parsed.mimeType);

      const [mediaRecord] = yield* db
        .insert(schema.media)
        .values({
          eventId: parsed.eventId,
          type: mediaType,
          s3Key,
          fileName: parsed.fileName,
          mimeType: parsed.mimeType,
          fileSize: parsed.fileSize,
          processingStatus: 'pending',
          uploadedById: session.user.id
        })
        .returning();

      const uploadUrl = yield* s3.createSignedUploadUrl(s3Key, SIGNED_URL_EXPIRES_IN);

      return { uploadUrl, mediaId: mediaRecord.id };
    }).pipe(
      // --------------------------------------------------------
      // 8. TRACING
      // --------------------------------------------------------
      Effect.withSpan('action.media.getUploadUrl', {
        attributes: { operation: 'media.getUploadUrl' }
      }),

      // --------------------------------------------------------
      // 9. PROVIDE DEPENDENCIES
      // --------------------------------------------------------
      Effect.provide(AppLayer),
      Effect.scoped,

      // --------------------------------------------------------
      // 10. HANDLE RESULT
      // --------------------------------------------------------
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('ValidationError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Event not found'
              })
            ),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to generate upload URL'
              })
            )
          ),

        onSuccess: data =>
          Effect.succeed({
            _tag: 'Success' as const,
            ...data
          })
      })
    )
  );
};
