/**
 * Tests for event CRUD actions and the getEvents query.
 *
 * Strategy: same as timeline.test.ts — mock `getSession` at module level,
 * provide mock `Db`/`Auth`/`S3` layers. Drizzle chains simulated with proxy
 * objects resolving to in-memory stores.
 */

/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { vi, beforeEach } from 'vitest';
import type { AppSession } from '@/lib/services/auth/get-session';
import type { Event, Media, Timeline, TimelineMember } from '@/lib/services/db/schema';

// ============================================================
// In-memory stores + session control
// ============================================================

let timelines: Array<Timeline> = [];
let members: Array<TimelineMember> = [];
let events: Array<Event> = [];
let mediaRecords: Array<Media> = [];
let mockSession: AppSession | null = null;
let insertedEvents: Array<Record<string, unknown>> = [];
let deletedS3Keys: Array<string> = [];

// ============================================================
// Module mocks
// ============================================================

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [] })
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn()
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn()
}));

vi.mock('@/lib/services/auth/get-session', async () => {
  const errors = await import('@/lib/core/errors');
  return {
    getSession: () =>
      Effect.gen(function* () {
        if (!mockSession) {
          return yield* new errors.UnauthenticatedError({ message: 'Not authenticated' });
        }
        return mockSession;
      })
  };
});

vi.mock('@/lib/layers', () => {
  return {
    get AppLayer() {
      return testAppLayer;
    }
  };
});

// ============================================================
// Mock Drizzle DB
// ============================================================

function createMockDb() {
  function makeChain(data: () => Array<Record<string, unknown>>) {
    const effect = Effect.succeed(data());

    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === Symbol.iterator) {
          return function* () {
            return yield* effect;
          };
        }
        if (prop === 'limit') {
          return (n: number) => makeChain(() => data().slice(0, n));
        }
        if (prop === 'from' || prop === 'where' || prop === 'innerJoin' || prop === 'orderBy') {
          return () => makeChain(data);
        }
        return undefined;
      }
    };

    return new Proxy({}, handler);
  }

  function resolveTable(table: unknown): string {
    if (table && typeof table === 'object') {
      const symbols = Object.getOwnPropertySymbols(table);
      for (const sym of symbols) {
        const val = (table as Record<symbol, unknown>)[sym];
        if (typeof val === 'string') return val;
      }
    }
    return 'unknown';
  }

  return {
    select: (_columns?: unknown) => ({
      from: (table: unknown) => {
        const name = resolveTable(table);
        const storeAccessor = () => {
          if (name === 'timeline') return [...timelines];
          if (name === 'timeline_member') return [...members];
          if (name === 'event') return [...events];
          if (name === 'media') return [...mediaRecords];
          return [];
        };
        return makeChain(storeAccessor);
      }
    }),

    insert: (table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: () => {
          const name = resolveTable(table);
          const record = {
            id: `${name}-new-${Date.now()}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data
          };
          if (name === 'event') {
            insertedEvents.push(record);
          }
          return Effect.succeed([record]);
        }
      })
    }),

    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({
          returning: () => {
            const name = resolveTable(table);
            if (name === 'event' && events.length > 0) {
              const updated = { ...events[0], ...data, updatedAt: new Date() };
              return Effect.succeed([updated]);
            }
            return Effect.succeed([]);
          }
        })
      })
    }),

    delete: (_table: unknown) => ({
      where: (_cond: unknown) => Effect.succeed(undefined)
    })
  };
}

// ============================================================
// Test Layer Setup
// ============================================================

import { Auth } from '@/lib/services/auth/live-layer';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';

const AuthTest = Layer.succeed(Auth, {
  auth: {} as never,
  signUp: () => Effect.die('mock'),
  signIn: () => Effect.die('mock'),
  signOut: () => Effect.die('mock'),
  getSession: () => Effect.die('mock'),
  getSessionFromCookies: () => Effect.die('mock'),
  updateUser: () => Effect.die('mock'),
  changePassword: () => Effect.die('mock')
} as never);

const S3Test = Layer.succeed(S3, {
  deleteFolder: () => Effect.succeed({ deletedCount: 0 }),
  deleteFile: (key: string) => {
    deletedS3Keys.push(key);
    return Effect.succeed(undefined);
  },
  createSignedUploadUrl: () => Effect.succeed('https://mock.test/upload'),
  createSignedDownloadUrl: () => Effect.succeed('https://mock.test/download'),
  getBuffer: () => Effect.succeed(Buffer.from('')),
  saveFile: () => Effect.succeed('https://mock.test/saved'),
  copyFile: () => Effect.succeed('https://mock.test/copied'),
  listObjects: () => Effect.succeed([]),
  createSignedUrl: () => Effect.succeed('https://mock.test/signed'),
  getObjectKeyFromUrl: (url: string) => url,
  getUrlFromObjectKey: (key: string) => `https://mock.test/${key}`,
  config: { bucket: 'test', region: 'us-east-1', baseUrl: 'https://mock.test/' }
} as never);

function createTestLayer() {
  const mockDb = createMockDb();
  const DbTest = Layer.succeed(Db, mockDb as never);
  return Layer.mergeAll(AuthTest, DbTest, S3Test);
}

let testAppLayer = createTestLayer();

// ============================================================
// Test Data Helpers
// ============================================================

const NOW = new Date('2026-01-15T00:00:00Z');

function makeTimeline(overrides: Partial<Timeline> = {}): Timeline {
  return {
    id: 'tl-1',
    name: 'Test Timeline',
    description: null,
    ownerId: 'user-owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeMember(overrides: Partial<TimelineMember> = {}): TimelineMember {
  return {
    id: 'member-1',
    timelineId: 'tl-1',
    userId: 'user-editor',
    email: 'editor@example.com',
    role: 'editor',
    invitedAt: NOW,
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'ev-1',
    timelineId: 'tl-1',
    date: '2026-01-15',
    comment: 'Test event',
    createdById: 'user-owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 'media-1',
    eventId: 'ev-1',
    type: 'photo',
    s3Key: 'timelines/tl-1/ev-1/photo.jpg',
    thumbnailS3Key: 'timelines/tl-1/ev-1/photo-thumb.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    fileSize: 1024,
    width: 800,
    height: 600,
    duration: null,
    processingStatus: 'completed',
    isPrivate: false,
    uploadedById: 'user-owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function setSession(overrides: Partial<AppSession['user']> = {}) {
  mockSession = {
    user: {
      id: 'user-owner',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'USER',
      ...overrides
    }
  };
}

function resetStores() {
  timelines = [];
  members = [];
  events = [];
  mediaRecords = [];
  mockSession = null;
  insertedEvents = [];
  deletedS3Keys = [];
  testAppLayer = createTestLayer();
}

// ============================================================
// Tests: createEventAction
// ============================================================

describe('createEventAction', () => {
  beforeEach(resetStores);

  it('creates event with valid input as owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: 'tl-1',
      date: '2026-03-01',
      comment: 'A new event'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.event.timelineId).toBe('tl-1');
      expect(result.event.date).toBe('2026-03-01');
      expect(result.event.comment).toBe('A new event');
      expect(result.event.createdById).toBe('user-owner');
    }
  });

  it('creates event as editor', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.event.createdById).toBe('user-editor');
    }
  });

  it('rejects viewer from creating events', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for non-member', async () => {
    setSession({ id: 'user-stranger' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [];

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for invalid date format', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: 'tl-1',
      date: 'not-a-date'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty timelineId', async () => {
    setSession({ id: 'user-owner' });

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: '',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for comment exceeding max length', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: 'tl-1',
      date: '2026-03-01',
      comment: 'x'.repeat(2001)
    });

    expect(result._tag).toBe('Error');
  });

  it('creates event without comment (comment-only events optional)', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createEventAction } = await import('./create-event-action');
    const result = await createEventAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Success');
  });
});

// ============================================================
// Tests: updateEventAction
// ============================================================

describe('updateEventAction', () => {
  beforeEach(resetStores);

  it('updates event date as owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1' })];

    const { updateEventAction } = await import('./update-event-action');
    const result = await updateEventAction({
      id: 'ev-1',
      date: '2026-06-15'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.event.date).toBe('2026-06-15');
    }
  });

  it('updates event comment as editor', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1' })];

    const { updateEventAction } = await import('./update-event-action');
    const result = await updateEventAction({
      id: 'ev-1',
      comment: 'Updated comment'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.event.comment).toBe('Updated comment');
    }
  });

  it('clears comment by setting to null', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1', comment: 'Old comment' })];

    const { updateEventAction } = await import('./update-event-action');
    const result = await updateEventAction({
      id: 'ev-1',
      comment: null
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.event.comment).toBeNull();
    }
  });

  it('rejects viewer from updating events', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1' })];

    const { updateEventAction } = await import('./update-event-action');
    const result = await updateEventAction({
      id: 'ev-1',
      comment: 'Hacked'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent event', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    events = [];

    const { updateEventAction } = await import('./update-event-action');
    const result = await updateEventAction({
      id: 'nonexistent',
      date: '2026-06-15'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty id', async () => {
    setSession({ id: 'user-owner' });

    const { updateEventAction } = await import('./update-event-action');
    const result = await updateEventAction({ id: '' });

    expect(result._tag).toBe('Error');
  });
});

// ============================================================
// Tests: deleteEventAction
// ============================================================

describe('deleteEventAction', () => {
  beforeEach(resetStores);

  it('deletes event as owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1' })];
    mediaRecords = [];

    const { deleteEventAction } = await import('./delete-event-action');
    const result = await deleteEventAction({ id: 'ev-1' });

    expect(result._tag).toBe('Success');
  });

  it('deletes event as editor', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1' })];
    mediaRecords = [];

    const { deleteEventAction } = await import('./delete-event-action');
    const result = await deleteEventAction({ id: 'ev-1' });

    expect(result._tag).toBe('Success');
  });

  it('cleans up S3 media files on delete', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1' })];
    mediaRecords = [
      makeMedia({
        id: 'media-1',
        eventId: 'ev-1',
        s3Key: 'timelines/tl-1/ev-1/photo.jpg',
        thumbnailS3Key: 'timelines/tl-1/ev-1/photo-thumb.jpg'
      }),
      makeMedia({
        id: 'media-2',
        eventId: 'ev-1',
        s3Key: 'timelines/tl-1/ev-1/video.mp4',
        thumbnailS3Key: null
      })
    ];

    const { deleteEventAction } = await import('./delete-event-action');
    await deleteEventAction({ id: 'ev-1' });

    // 3 keys: photo.jpg + photo-thumb.jpg + video.mp4
    expect(deletedS3Keys).toHaveLength(3);
    expect(deletedS3Keys).toContain('timelines/tl-1/ev-1/photo.jpg');
    expect(deletedS3Keys).toContain('timelines/tl-1/ev-1/photo-thumb.jpg');
    expect(deletedS3Keys).toContain('timelines/tl-1/ev-1/video.mp4');
  });

  it('rejects viewer from deleting events', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
    events = [makeEvent({ id: 'ev-1', timelineId: 'tl-1' })];

    const { deleteEventAction } = await import('./delete-event-action');
    const result = await deleteEventAction({ id: 'ev-1' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent event', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    events = [];

    const { deleteEventAction } = await import('./delete-event-action');
    const result = await deleteEventAction({ id: 'nonexistent' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty id', async () => {
    setSession({ id: 'user-owner' });

    const { deleteEventAction } = await import('./delete-event-action');
    const result = await deleteEventAction({ id: '' });

    expect(result._tag).toBe('Error');
  });
});

// ============================================================
// Imports for getEvents (after mocks set up)
// ============================================================

import { getEvents } from './get-events';

// ============================================================
// Tests: getEvents query
// ============================================================

describe('getEvents', () => {
  beforeEach(resetStores);

  it.effect('fails with UnauthenticatedError when no session', () =>
    Effect.gen(function* () {
      const result = yield* getEvents({ timelineId: 'tl-1' }).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthenticatedError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns empty events for timeline with no events', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      events = [];
      mediaRecords = [];

      const result = yield* getEvents({ timelineId: 'tl-1' });

      expect(result.events).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns events with media grouped by event', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      events = [
        makeEvent({ id: 'ev-1', date: '2026-01-15' }),
        makeEvent({ id: 'ev-2', date: '2026-01-16' })
      ];
      mediaRecords = [
        makeMedia({ id: 'media-1', eventId: 'ev-1' }),
        makeMedia({ id: 'media-2', eventId: 'ev-1' }),
        makeMedia({ id: 'media-3', eventId: 'ev-2' })
      ];

      const result = yield* getEvents({ timelineId: 'tl-1' });

      expect(result.events).toHaveLength(2);
      // Mock doesn't filter by eventId; verify structure is correct
      expect(result.events[0]).toHaveProperty('media');
      expect(result.events[1]).toHaveProperty('media');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('respects limit parameter', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      events = [
        makeEvent({ id: 'ev-1', date: '2026-01-15' }),
        makeEvent({ id: 'ev-2', date: '2026-01-16' }),
        makeEvent({ id: 'ev-3', date: '2026-01-17' })
      ];
      mediaRecords = [];

      // limit=1, but mock returns all events. With limit+1 = 2 passed to .limit(),
      // the mock will slice to 2 items. Then getEvents will detect hasMore=true
      // and return only 1 item + nextCursor.
      const result = yield* getEvents({ timelineId: 'tl-1', limit: 1 });

      expect(result.events).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns null nextCursor when no more pages', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      events = [makeEvent({ id: 'ev-1', date: '2026-01-15' })];
      mediaRecords = [];

      // limit=20 (default), only 1 event → no more pages
      const result = yield* getEvents({ timelineId: 'tl-1' });

      expect(result.events).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('clamps limit to MAX_LIMIT', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      events = [];
      mediaRecords = [];

      // Should not throw even with excessive limit
      const result = yield* getEvents({ timelineId: 'tl-1', limit: 999 });

      expect(result.events).toHaveLength(0);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('accepts newest sort order', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      events = [makeEvent({ id: 'ev-1', date: '2026-01-15' })];
      mediaRecords = [];

      const result = yield* getEvents({ timelineId: 'tl-1', order: 'newest' });

      expect(result.events).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('accepts oldest sort order', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      events = [makeEvent({ id: 'ev-1', date: '2026-01-15' })];
      mediaRecords = [];

      const result = yield* getEvents({ timelineId: 'tl-1', order: 'oldest' });

      expect(result.events).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('viewer can read events', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-viewer' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
      events = [makeEvent({ id: 'ev-1' })];
      mediaRecords = [];

      const result = yield* getEvents({ timelineId: 'tl-1' });

      expect(result.events).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('rejects non-member from reading events', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-stranger' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [];
      events = [makeEvent({ id: 'ev-1' })];

      const result = yield* getEvents({ timelineId: 'tl-1' }).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );
});
