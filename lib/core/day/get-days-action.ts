'use server';

import { Effect, Match } from 'effect';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getDays, type DayCursor, type SortOrder } from './get-days';

type GetDaysInput = {
  readonly timelineId: string;
  readonly cursor?: DayCursor | undefined;
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
  readonly isPrivate: boolean;
  readonly createdAt: string;
};

type SerializedComment = {
  readonly id: string;
  readonly text: string;
  readonly authorId: string;
  readonly authorName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SerializedMediaComment = {
  readonly id: string;
  readonly mediaId: string;
  readonly text: string;
  readonly authorId: string;
  readonly authorName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type SerializedDay = {
  readonly id: string;
  readonly date: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly media: ReadonlyArray<SerializedMedia>;
  readonly comments: ReadonlyArray<SerializedComment>;
  readonly mediaComments: ReadonlyArray<SerializedMediaComment>;
};

type SuccessResult = {
  readonly _tag: 'Success';
  readonly days: ReadonlyArray<SerializedDay>;
  readonly nextCursor: DayCursor | null;
};

type ErrorResult = {
  readonly _tag: 'Error';
  readonly message: string;
};

/**
 * Server action to fetch paginated days for a timeline.
 * Used by client component for "load more" pagination.
 */
export const getDaysAction = async (input: GetDaysInput): Promise<SuccessResult | ErrorResult> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({
        'timeline.id': input.timelineId,
        'pagination.hasCursor': input.cursor !== undefined,
        'pagination.order': input.order ?? 'newest'
      });

      const result = yield* getDays({
        timelineId: input.timelineId,
        cursor: input.cursor,
        order: input.order,
        limit: input.limit
      });

      const serializedDays: ReadonlyArray<SerializedDay> = result.days.map(d => ({
        id: d.id,
        date: d.date,
        title: d.title,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
        media: d.media.map(m => ({
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
          isPrivate: m.isPrivate,
          createdAt: m.createdAt.toISOString()
        })),
        comments: d.comments.map(c => ({
          id: c.id,
          text: c.text,
          authorId: c.authorId,
          authorName: c.authorName,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString()
        })),
        mediaComments: d.mediaComments.map(mc => ({
          id: mc.id,
          mediaId: mc.mediaId,
          text: mc.text,
          authorId: mc.authorId,
          authorName: mc.authorName,
          createdAt: mc.createdAt.toISOString(),
          updatedAt: mc.updatedAt.toISOString()
        }))
      }));

      return {
        _tag: 'Success' as const,
        days: serializedDays,
        nextCursor: result.nextCursor
      };
    }).pipe(
      Effect.withSpan('action.day.getDays'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.tapError(e => Effect.logError('action.day.getDays failed', { error: e })),
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.tag('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Failed to load days'
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
};
