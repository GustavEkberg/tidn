'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getEvents, type EventCursor, type SortOrder } from './get-events';

type GetEventsInput = {
  readonly timelineId: string;
  readonly cursor?: EventCursor | undefined;
  readonly order?: SortOrder | undefined;
  readonly limit?: number | undefined;
};

type SerializedMedia = {
  readonly id: string;
  readonly type: 'photo' | 'video';
  readonly s3Key: string;
  readonly thumbnailS3Key: string | null;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  readonly createdAt: string;
};

type SerializedEvent = {
  readonly id: string;
  readonly date: string;
  readonly comment: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly media: ReadonlyArray<SerializedMedia>;
};

type SuccessResult = {
  readonly _tag: 'Success';
  readonly events: ReadonlyArray<SerializedEvent>;
  readonly nextCursor: EventCursor | null;
};

type ErrorResult = {
  readonly _tag: 'Error';
  readonly message: string;
};

/**
 * Server action to fetch paginated events for a timeline.
 * Used by client component for "load more" pagination.
 */
export const getEventsAction = async (
  input: GetEventsInput
): Promise<SuccessResult | ErrorResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const result = yield* getEvents({
        timelineId: input.timelineId,
        cursor: input.cursor,
        order: input.order,
        limit: input.limit
      });

      const serializedEvents: ReadonlyArray<SerializedEvent> = result.events.map(e => ({
        id: e.id,
        date: e.date,
        comment: e.comment,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
        media: e.media.map(m => ({
          id: m.id,
          type: m.type,
          s3Key: m.s3Key,
          thumbnailS3Key: m.thumbnailS3Key,
          fileName: m.fileName,
          mimeType: m.mimeType,
          fileSize: m.fileSize,
          width: m.width,
          height: m.height,
          duration: m.duration,
          processingStatus: m.processingStatus,
          createdAt: m.createdAt.toISOString()
        }))
      }));

      return {
        _tag: 'Success' as const,
        events: serializedEvents,
        nextCursor: result.nextCursor
      };
    }).pipe(
      Effect.withSpan('action.event.getEvents'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.tag('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to load events'
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
};
