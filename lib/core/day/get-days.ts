import { Effect } from 'effect';
import { eq, and, or, gt, lt, asc, desc, sql } from 'drizzle-orm';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';

// ============================================================
// TYPES
// ============================================================

export type SortOrder = 'newest' | 'oldest';

/**
 * Cursor for keyset pagination.
 * Uses (date, id) pair for stable ordering since we paginate by date.
 */
export type DayCursor = {
  readonly date: string;
  readonly id: string;
};

export type GetDaysInput = {
  readonly timelineId: string;
  readonly cursor?: DayCursor | undefined;
  readonly limit?: number | undefined;
  readonly order?: SortOrder | undefined;
};

export type DayMediaItem = Pick<
  schema.Media,
  | 'id'
  | 'type'
  | 's3Key'
  | 'thumbnailS3Key'
  | 'fileName'
  | 'mimeType'
  | 'fileSize'
  | 'width'
  | 'height'
  | 'duration'
  | 'processingStatus'
  | 'isPrivate'
  | 'createdAt'
>;

export type DayCommentItem = Pick<schema.DayComment, 'id' | 'text' | 'authorId' | 'createdAt'>;

export type DayWithMedia = schema.Day & {
  media: ReadonlyArray<DayMediaItem>;
  comments: ReadonlyArray<DayCommentItem>;
};

export type GetDaysResult = {
  readonly days: ReadonlyArray<DayWithMedia>;
  readonly nextCursor: DayCursor | null;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ============================================================
// QUERY
// ============================================================

/**
 * Returns paginated days for a timeline with their media records and comments.
 * Uses cursor-based (keyset) pagination on (date, id) for stable ordering.
 *
 * Requires at least viewer access to the timeline.
 */
export const getDays = (input: GetDaysInput) =>
  Effect.gen(function* () {
    yield* getSession();
    const { role } = yield* getTimelineAccess(input.timelineId, 'viewer');
    const isViewer = role === 'viewer';

    const db = yield* Db;
    const order = input.order ?? 'newest';
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    yield* Effect.annotateCurrentSpan({
      'timeline.id': input.timelineId,
      order,
      limit,
      hasCursor: input.cursor !== undefined
    });

    // Build cursor condition for keyset pagination.
    const cursorCondition = input.cursor
      ? order === 'newest'
        ? or(
            lt(schema.day.date, input.cursor.date),
            and(eq(schema.day.date, input.cursor.date), lt(schema.day.id, input.cursor.id))
          )
        : or(
            gt(schema.day.date, input.cursor.date),
            and(eq(schema.day.date, input.cursor.date), gt(schema.day.id, input.cursor.id))
          )
      : undefined;

    const dateOrder = order === 'newest' ? desc(schema.day.date) : asc(schema.day.date);
    const idOrder = order === 'newest' ? desc(schema.day.id) : asc(schema.day.id);

    // Fetch limit + 1 to detect if there are more pages
    const days = yield* db
      .select()
      .from(schema.day)
      .where(
        cursorCondition
          ? and(eq(schema.day.timelineId, input.timelineId), cursorCondition)
          : eq(schema.day.timelineId, input.timelineId)
      )
      .orderBy(dateOrder, idOrder)
      .limit(limit + 1);

    // Determine if there is a next page
    const hasMore = days.length > limit;
    const page = hasMore ? days.slice(0, limit) : days;

    // Fetch media for the page's days
    const dayIds = page.map(d => d.id);
    const mediaRecords =
      dayIds.length > 0
        ? yield* db
            .select({
              id: schema.media.id,
              dayId: schema.media.dayId,
              type: schema.media.type,
              s3Key: schema.media.s3Key,
              thumbnailS3Key: schema.media.thumbnailS3Key,
              fileName: schema.media.fileName,
              mimeType: schema.media.mimeType,
              fileSize: schema.media.fileSize,
              width: schema.media.width,
              height: schema.media.height,
              duration: schema.media.duration,
              processingStatus: schema.media.processingStatus,
              isPrivate: schema.media.isPrivate,
              createdAt: schema.media.createdAt
            })
            .from(schema.media)
            .where(sql`${schema.media.dayId} IN ${dayIds}`)
            .orderBy(asc(schema.media.createdAt))
        : [];

    // Filter out private media for viewers
    const visibleMedia = isViewer ? mediaRecords.filter(m => !m.isPrivate) : mediaRecords;

    // Group media by dayId
    const mediaByDay = new Map<string, typeof visibleMedia>();
    for (const m of visibleMedia) {
      const existing = mediaByDay.get(m.dayId);
      if (existing) {
        existing.push(m);
      } else {
        mediaByDay.set(m.dayId, [m]);
      }
    }

    // Fetch comments for the page's days
    const commentRecords =
      dayIds.length > 0
        ? yield* db
            .select({
              id: schema.dayComment.id,
              dayId: schema.dayComment.dayId,
              text: schema.dayComment.text,
              authorId: schema.dayComment.authorId,
              createdAt: schema.dayComment.createdAt
            })
            .from(schema.dayComment)
            .where(sql`${schema.dayComment.dayId} IN ${dayIds}`)
            .orderBy(asc(schema.dayComment.createdAt))
        : [];

    // Group comments by dayId
    const commentsByDay = new Map<string, typeof commentRecords>();
    for (const c of commentRecords) {
      const existing = commentsByDay.get(c.dayId);
      if (existing) {
        existing.push(c);
      } else {
        commentsByDay.set(c.dayId, [c]);
      }
    }

    const daysWithMedia: ReadonlyArray<DayWithMedia> = page.map(d => ({
      ...d,
      media: mediaByDay.get(d.id) ?? [],
      comments: commentsByDay.get(d.id) ?? []
    }));

    const lastDay = page[page.length - 1];
    const nextCursor: DayCursor | null =
      hasMore && lastDay ? { date: lastDay.date, id: lastDay.id } : null;

    return { days: daysWithMedia, nextCursor } satisfies GetDaysResult;
  }).pipe(
    Effect.tapError(e => Effect.logError('Day.getAll failed', { error: e })),
    Effect.withSpan('Day.getAll')
  );
