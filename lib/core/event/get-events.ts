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
 * Uses (date, id) pair for stable ordering since dates are not unique.
 */
export type EventCursor = {
  readonly date: string;
  readonly id: string;
};

export type GetEventsInput = {
  readonly timelineId: string;
  readonly cursor?: EventCursor | undefined;
  readonly limit?: number | undefined;
  readonly order?: SortOrder | undefined;
};

export type EventWithMedia = schema.Event & {
  media: ReadonlyArray<
    Pick<
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
      | 'createdAt'
    >
  >;
};

export type GetEventsResult = {
  readonly events: ReadonlyArray<EventWithMedia>;
  readonly nextCursor: EventCursor | null;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ============================================================
// QUERY
// ============================================================

/**
 * Returns paginated events for a timeline with their media records.
 * Uses cursor-based (keyset) pagination on (date, id) for stable ordering.
 *
 * Requires at least viewer access to the timeline.
 */
export const getEvents = (input: GetEventsInput) =>
  Effect.gen(function* () {
    yield* getSession();
    yield* getTimelineAccess(input.timelineId, 'viewer');

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
    // For newest-first: get rows where (date, id) < cursor
    // For oldest-first: get rows where (date, id) > cursor
    const cursorCondition = input.cursor
      ? order === 'newest'
        ? or(
            lt(schema.event.date, input.cursor.date),
            and(eq(schema.event.date, input.cursor.date), lt(schema.event.id, input.cursor.id))
          )
        : or(
            gt(schema.event.date, input.cursor.date),
            and(eq(schema.event.date, input.cursor.date), gt(schema.event.id, input.cursor.id))
          )
      : undefined;

    const dateOrder = order === 'newest' ? desc(schema.event.date) : asc(schema.event.date);
    const idOrder = order === 'newest' ? desc(schema.event.id) : asc(schema.event.id);

    // Fetch limit + 1 to detect if there are more pages
    const events = yield* db
      .select()
      .from(schema.event)
      .where(
        cursorCondition
          ? and(eq(schema.event.timelineId, input.timelineId), cursorCondition)
          : eq(schema.event.timelineId, input.timelineId)
      )
      .orderBy(dateOrder, idOrder)
      .limit(limit + 1);

    // Determine if there is a next page
    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;

    // Fetch media for the page's events
    const eventIds = page.map(e => e.id);
    const mediaRecords =
      eventIds.length > 0
        ? yield* db
            .select({
              id: schema.media.id,
              eventId: schema.media.eventId,
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
              createdAt: schema.media.createdAt
            })
            .from(schema.media)
            .where(sql`${schema.media.eventId} IN ${eventIds}`)
            .orderBy(asc(schema.media.createdAt))
        : [];

    // Group media by eventId
    const mediaByEvent = new Map<string, typeof mediaRecords>();
    for (const m of mediaRecords) {
      const existing = mediaByEvent.get(m.eventId);
      if (existing) {
        existing.push(m);
      } else {
        mediaByEvent.set(m.eventId, [m]);
      }
    }

    const eventsWithMedia: ReadonlyArray<EventWithMedia> = page.map(e => ({
      ...e,
      media: mediaByEvent.get(e.id) ?? []
    }));

    const lastEvent = page[page.length - 1];
    const nextCursor: EventCursor | null =
      hasMore && lastEvent ? { date: lastEvent.date, id: lastEvent.id } : null;

    return { events: eventsWithMedia, nextCursor } satisfies GetEventsResult;
  }).pipe(Effect.withSpan('Event.getAll'));
