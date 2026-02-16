import { Data } from 'effect';

export class S3ConfigError extends Data.TaggedError('S3ConfigError')<{
  message: string;
}> {}

export class S3NoBodyError extends Data.TaggedError('S3NoBodyError')<{
  message: string;
  key: string;
}> {}
