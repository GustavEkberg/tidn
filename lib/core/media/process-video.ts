import { Effect } from 'effect';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq } from 'drizzle-orm';

// ============================================================
// Video Processing — frame extraction for thumbnail, metadata
//
// Pipeline:
// 1. Download video from S3
// 2. Write to temp file (ffmpeg requires file I/O)
// 3. Extract metadata via ffprobe (width, height, duration)
// 4. Extract frame at ~1s via ffmpeg
// 5. Process frame with sharp → JPEG thumbnail
// 6. Upload thumbnail to S3
// 7. Update media record with metadata + thumbnail key
// 8. Clean up temp files
// ============================================================

const THUMBNAIL_WIDTH = 400;

/**
 * Derive thumbnail S3 key from original video key.
 * `timelines/x/y/file.mp4` → `timelines/x/y/file-thumb.jpg`
 */
const getThumbnailKey = (originalKey: string): string => {
  const lastDot = originalKey.lastIndexOf('.');
  const base = lastDot === -1 ? originalKey : originalKey.slice(0, lastDot);
  return `${base}-thumb.jpg`;
};

/**
 * Get the ffmpeg binary path from ffmpeg-static.
 */
const getFfmpegPath = () =>
  Effect.try({
    try: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ffmpegPath: unknown = require('ffmpeg-static');
      if (typeof ffmpegPath !== 'string') {
        throw new Error('ffmpeg-static did not return a string path');
      }
      return ffmpegPath;
    },
    catch: cause => new Error(`Failed to resolve ffmpeg path: ${String(cause)}`)
  });

/**
 * Get the ffprobe binary path from ffprobe-static.
 */
const getFfprobePath = () =>
  Effect.try({
    try: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod: unknown = require('ffprobe-static');
      if (
        typeof mod !== 'object' ||
        mod === null ||
        !('path' in mod) ||
        typeof mod.path !== 'string'
      ) {
        throw new Error('ffprobe-static did not return expected { path: string }');
      }
      return mod.path;
    },
    catch: cause => new Error(`Failed to resolve ffprobe path: ${String(cause)}`)
  });

/**
 * Run a command and return stdout as a string.
 */
const runCommand = (bin: string, args: Array<string>): Effect.Effect<string, Error> =>
  Effect.async<string, Error>(resume => {
    execFile(bin, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        resume(
          Effect.fail(
            new Error(`${path.basename(bin)} failed: ${error.message}\nstderr: ${stderr}`)
          )
        );
      } else {
        resume(Effect.succeed(stdout));
      }
    });
  });

interface VideoMetadata {
  readonly width: number | null;
  readonly height: number | null;
  /** Duration in seconds (integer) */
  readonly duration: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Safely extract video metadata from ffprobe JSON output.
 * No type assertions — all access is runtime-validated.
 */
const parseProbeOutput = (parsed: unknown): VideoMetadata => {
  if (!isRecord(parsed)) return { width: null, height: null, duration: null };

  const streamsRaw = parsed['streams'];
  const streams = Array.isArray(streamsRaw) ? streamsRaw : [];

  const videoStream = streams.find((s: unknown) => isRecord(s) && s['codec_type'] === 'video');

  let width: number | null = null;
  let height: number | null = null;
  let streamDuration: string | null = null;

  if (isRecord(videoStream)) {
    width = typeof videoStream['width'] === 'number' ? videoStream['width'] : null;
    height = typeof videoStream['height'] === 'number' ? videoStream['height'] : null;
    streamDuration = typeof videoStream['duration'] === 'string' ? videoStream['duration'] : null;
  }

  // Duration: prefer format-level (more accurate), fallback to stream-level
  const formatRaw = parsed['format'];
  const formatDuration =
    isRecord(formatRaw) && typeof formatRaw['duration'] === 'string' ? formatRaw['duration'] : null;

  const durationStr = formatDuration ?? streamDuration;
  const durationFloat = durationStr !== null ? parseFloat(durationStr) : NaN;
  const duration = !Number.isNaN(durationFloat) ? Math.round(durationFloat) : null;

  return { width, height, duration };
};

/**
 * Extract video metadata using ffprobe.
 */
const probeVideo = (ffprobePath: string, videoPath: string): Effect.Effect<VideoMetadata, Error> =>
  Effect.gen(function* () {
    const stdout = yield* runCommand(ffprobePath, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      videoPath
    ]);

    const parsed: unknown = JSON.parse(stdout);

    const metadata = parseProbeOutput(parsed);
    return metadata;
  });

/**
 * Extract a single frame from a video using ffmpeg.
 * Seeks to the given timestamp (in seconds).
 */
const extractFrame = (
  ffmpegPath: string,
  videoPath: string,
  outputPath: string,
  seekSeconds: number
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* runCommand(ffmpegPath, [
      '-ss',
      String(seekSeconds),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '2', // high quality JPEG
      '-y', // overwrite output
      outputPath
    ]);
  });

/**
 * Create a temporary directory and ensure cleanup.
 */
const withTempDir = <A, E>(fn: (dir: string) => Effect.Effect<A, E>): Effect.Effect<A, E | Error> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => fs.mkdtemp(path.join(os.tmpdir(), 'tidn-video-')),
      catch: cause => new Error(`Failed to create temp dir: ${String(cause)}`)
    }),
    dir => fn(dir),
    dir =>
      Effect.tryPromise({
        try: () => fs.rm(dir, { recursive: true, force: true }),
        catch: () => new Error('Failed to cleanup temp dir')
      }).pipe(
        Effect.tapError(e => Effect.logWarning('Temp dir cleanup failed', { error: e })),
        Effect.catchAll(() => Effect.void)
      )
  );

export interface ProcessVideoInput {
  readonly mediaId: string;
  readonly s3Key: string;
  readonly mimeType: string;
}

/**
 * Process a video: extract metadata, generate thumbnail from frame.
 *
 * Requires Db + S3 services in context.
 */
export const processVideo = (input: ProcessVideoInput) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const s3 = yield* S3;

    yield* Effect.annotateCurrentSpan({
      'media.id': input.mediaId,
      'media.s3Key': input.s3Key,
      'media.mimeType': input.mimeType
    });

    // --------------------------------------------------------
    // 1. RESOLVE BINARY PATHS
    // --------------------------------------------------------
    const ffmpegPath = yield* getFfmpegPath();
    const ffprobePath = yield* getFfprobePath();

    yield* Effect.logInfo('Video processing started', {
      mediaId: input.mediaId,
      ffmpegPath,
      ffprobePath
    });

    // --------------------------------------------------------
    // 2. DOWNLOAD VIDEO FROM S3
    // --------------------------------------------------------
    const videoBuffer = yield* s3.getBuffer(input.s3Key);

    yield* Effect.annotateCurrentSpan({
      'media.videoSize': videoBuffer.length
    });

    // --------------------------------------------------------
    // 3. PROCESS IN TEMP DIRECTORY
    // --------------------------------------------------------
    const result = yield* withTempDir(tmpDir =>
      Effect.gen(function* () {
        const videoPath = path.join(tmpDir, 'input.video');
        const framePath = path.join(tmpDir, 'frame.jpg');

        // Write video to temp file
        yield* Effect.tryPromise({
          try: () => fs.writeFile(videoPath, videoBuffer),
          catch: cause => new Error(`Failed to write temp video: ${String(cause)}`)
        });

        // 3a. EXTRACT METADATA via ffprobe
        const metadata = yield* probeVideo(ffprobePath, videoPath);

        yield* Effect.annotateCurrentSpan({
          'media.width': metadata.width ?? 0,
          'media.height': metadata.height ?? 0,
          'media.duration': metadata.duration ?? 0
        });

        yield* Effect.logInfo('Video metadata extracted', {
          mediaId: input.mediaId,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration
        });

        // 3b. EXTRACT FRAME — seek to 1s or 0s for short videos
        const seekTime = metadata.duration !== null && metadata.duration > 1 ? 1 : 0;

        yield* extractFrame(ffmpegPath, videoPath, framePath, seekTime);

        // 3c. READ FRAME AND GENERATE THUMBNAIL via sharp
        const frameBuffer = yield* Effect.tryPromise({
          try: () => fs.readFile(framePath),
          catch: cause => new Error(`Failed to read extracted frame: ${String(cause)}`)
        });

        const thumbnailBuffer = yield* Effect.tryPromise(() =>
          sharp(frameBuffer)
            .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer()
        );

        return { metadata, thumbnailBuffer };
      })
    );

    // --------------------------------------------------------
    // 4. UPLOAD THUMBNAIL TO S3
    // --------------------------------------------------------
    const thumbnailKey = getThumbnailKey(input.s3Key);

    yield* s3.saveFile(thumbnailKey, result.thumbnailBuffer, 'image/jpeg');

    yield* Effect.annotateCurrentSpan({
      'media.thumbnailKey': thumbnailKey,
      'media.thumbnailSize': result.thumbnailBuffer.length
    });

    yield* Effect.logInfo('Video thumbnail uploaded', {
      mediaId: input.mediaId,
      thumbnailKey,
      thumbnailSize: result.thumbnailBuffer.length
    });

    // --------------------------------------------------------
    // 5. UPDATE MEDIA RECORD
    // --------------------------------------------------------
    yield* db
      .update(schema.media)
      .set({
        thumbnailS3Key: thumbnailKey,
        width: result.metadata.width,
        height: result.metadata.height,
        duration: result.metadata.duration,
        processingStatus: 'completed'
      })
      .where(eq(schema.media.id, input.mediaId));

    yield* Effect.logInfo('Video processing completed', {
      mediaId: input.mediaId,
      width: result.metadata.width,
      height: result.metadata.height,
      duration: result.metadata.duration,
      thumbnailKey
    });
  }).pipe(Effect.withSpan('media.processVideo'));
