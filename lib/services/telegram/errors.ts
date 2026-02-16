import { Data } from 'effect';

export class TelegramConfigError extends Data.TaggedError('TelegramConfigError')<{
  message: string;
}> {}

export class TelegramSendError extends Data.TaggedError('TelegramSendError')<{
  message: string;
  cause?: unknown;
}> {}
