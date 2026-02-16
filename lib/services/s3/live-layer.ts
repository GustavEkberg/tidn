import { S3 as S3Client, S3Service } from '@effect-aws/client-s3';
import { Config, Context, Effect, Layer } from 'effect';
import { S3ConfigError, S3NoBodyError } from './errors';

export { S3ConfigError, S3NoBodyError };

// Configuration service (internal)
class S3Config extends Context.Tag('@app/S3Config')<
  S3Config,
  {
    readonly bucket: string;
    readonly region: string;
    readonly baseUrl: string;
  }
>() {}

const S3ConfigLive = Layer.effect(
  S3Config,
  Effect.gen(function* () {
    const bucket = yield* Config.string('AWS_S3_BUCKET').pipe(
      Effect.mapError(() => new S3ConfigError({ message: 'AWS_S3_BUCKET not found' }))
    );
    const region = yield* Config.string('AWS_REGION').pipe(
      Effect.mapError(() => new S3ConfigError({ message: 'AWS_REGION not found' }))
    );
    const baseUrl = `https://${bucket}.s3.${region}.amazonaws.com/`;

    return { bucket, region, baseUrl };
  })
);

const getContentType = (key: string): string => {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    case 'tiff':
    case 'tif':
      return 'image/tiff';
    case 'ico':
      return 'image/x-icon';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'avif':
      return 'image/avif';
    case 'zip':
      return 'application/zip';
    case 'pdf':
      return 'application/pdf';
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
};

// Service definition
// v4 migration: Change Effect.Service to ServiceMap.Service
export class S3 extends Effect.Service<S3>()('@app/S3', {
  effect: Effect.gen(function* () {
    const config = yield* S3Config;
    // Capture the AWS S3 service instance at construction time
    const s3Client = yield* S3Service;

    const getObjectKeyFromUrl = (url: string) => url.replace(config.baseUrl, '');

    const getUrlFromObjectKey = (objectKey: string) => `${config.baseUrl}${objectKey}`;

    const getBuffer = (keyOrUrl: string) =>
      Effect.gen(function* () {
        const key = keyOrUrl.startsWith('https://') ? getObjectKeyFromUrl(keyOrUrl) : keyOrUrl;

        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.key': key
        });

        const response = yield* s3Client.getObject({
          Bucket: config.bucket,
          Key: key
        });

        const body = response.Body;
        if (!body) {
          return yield* new S3NoBodyError({
            message: `No body in S3 response for key: ${key}`,
            key
          });
        }

        const bytes = yield* Effect.tryPromise(() => body.transformToByteArray());
        // Buffer.from accepts Uint8Array directly
        const buffer = Buffer.from(bytes);

        yield* Effect.annotateCurrentSpan({
          's3.size': buffer.length
        });

        return buffer;
      }).pipe(
        Effect.withSpan('S3.getBuffer'),
        Effect.tapError(error => Effect.logError('S3 getBuffer failed', { keyOrUrl, error }))
      );

    const saveFile = (key: string, buffer: Buffer, contentType?: string) =>
      Effect.gen(function* () {
        const resolvedContentType = contentType ?? getContentType(key);

        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.key': key,
          's3.size': buffer.length,
          's3.contentType': resolvedContentType
        });

        yield* s3Client.putObject({
          Bucket: config.bucket,
          Key: key,
          Body: buffer,
          ContentType: resolvedContentType
        });

        const url = getUrlFromObjectKey(key);

        yield* Effect.annotateCurrentSpan({ 's3.url': url });

        return url;
      }).pipe(
        Effect.withSpan('S3.saveFile'),
        Effect.tapError(error => Effect.logError('S3 saveFile failed', { key, error }))
      );

    const createSignedUploadUrl = (key: string, expiresIn = 300) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.key': key,
          's3.expiresIn': expiresIn
        });

        const signedUrl = yield* s3Client.putObject(
          {
            Bucket: config.bucket,
            Key: key
          },
          { presigned: true, expiresIn }
        );

        return signedUrl;
      }).pipe(
        Effect.withSpan('S3.createSignedUploadUrl'),
        Effect.tapError(error => Effect.logError('S3 createSignedUploadUrl failed', { key, error }))
      );

    const createSignedDownloadUrl = (keyOrUrl: string, expiresIn = 300) =>
      Effect.gen(function* () {
        const key = keyOrUrl.startsWith('https://') ? getObjectKeyFromUrl(keyOrUrl) : keyOrUrl;

        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.key': key,
          's3.expiresIn': expiresIn
        });

        const signedUrl = yield* s3Client.getObject(
          {
            Bucket: config.bucket,
            Key: key
          },
          { presigned: true, expiresIn }
        );

        return signedUrl;
      }).pipe(
        Effect.withSpan('S3.createSignedDownloadUrl'),
        Effect.tapError(error =>
          Effect.logError('S3 createSignedDownloadUrl failed', { keyOrUrl, error })
        )
      );

    // Backwards compatibility alias
    const createSignedUrl = createSignedUploadUrl;

    const copyFile = (sourceKey: string, destKey: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.sourceKey': sourceKey,
          's3.destKey': destKey
        });

        yield* s3Client.copyObject({
          Bucket: config.bucket,
          CopySource: `${config.bucket}/${sourceKey}`,
          Key: destKey
        });

        const url = getUrlFromObjectKey(destKey);

        yield* Effect.annotateCurrentSpan({ 's3.url': url });

        return url;
      }).pipe(
        Effect.withSpan('S3.copyFile'),
        Effect.tapError(error =>
          Effect.logError('S3 copyFile failed', { sourceKey, destKey, error })
        )
      );

    const listObjects = (prefix: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.prefix': prefix
        });

        const response = yield* s3Client.listObjectsV2({
          Bucket: config.bucket,
          Prefix: prefix
        });

        const keys = (response.Contents || [])
          .map((obj: { Key?: string }) => obj.Key)
          .filter((key: string | undefined): key is string => !!key);

        yield* Effect.annotateCurrentSpan({ 's3.count': keys.length });

        return keys;
      }).pipe(
        Effect.withSpan('S3.listObjects'),
        Effect.tapError(error => Effect.logError('S3 listObjects failed', { prefix, error }))
      );

    const deleteFile = (key: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.key': key
        });

        yield* s3Client.deleteObject({
          Bucket: config.bucket,
          Key: key
        });
      }).pipe(
        Effect.withSpan('S3.deleteFile'),
        Effect.tapError(error => Effect.logError('S3 deleteFile failed', { key, error }))
      );

    const deleteFolder = (prefix: string) =>
      Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({
          's3.bucket': config.bucket,
          's3.prefix': prefix
        });

        const response = yield* s3Client.listObjectsV2({
          Bucket: config.bucket,
          Prefix: prefix
        });

        const objects = response.Contents;
        if (!objects || objects.length === 0) {
          yield* Effect.annotateCurrentSpan({ 's3.deletedCount': 0 });
          return { deletedCount: 0 };
        }

        yield* s3Client.deleteObjects({
          Bucket: config.bucket,
          Delete: {
            Objects: objects.map((obj: { Key?: string }) => ({ Key: obj.Key! })),
            Quiet: true
          }
        });

        yield* Effect.annotateCurrentSpan({ 's3.deletedCount': objects.length });

        return { deletedCount: objects.length };
      }).pipe(
        Effect.withSpan('S3.deleteFolder'),
        Effect.tapError(error => Effect.logError('S3 deleteFolder failed', { prefix, error }))
      );

    return {
      getObjectKeyFromUrl,
      getUrlFromObjectKey,
      getBuffer,
      saveFile,
      createSignedUrl,
      createSignedUploadUrl,
      createSignedDownloadUrl,
      copyFile,
      listObjects,
      deleteFile,
      deleteFolder,
      config
    } as const;
  })
}) {
  // Base layer (has unsatisfied S3Config and S3Service dependencies)
  static layer = this.Default;

  // Composed layer with all dependencies satisfied
  static Live = this.layer.pipe(Layer.provide(S3ConfigLive), Layer.provide(S3Client.defaultLayer));
}
