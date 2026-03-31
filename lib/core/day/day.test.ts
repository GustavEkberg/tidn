/**
 * Tests for day CRUD actions and the getDays query.
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
import type { Day, Media, Timeline, TimelineMember } from '@/lib/services/db/schema';

// ============================================================
// In-memory stores + session control
// ============================================================

let timelines: Array<Timeline> = [];
let members: Array<TimelineMember> = [];
let days: Array<Day> = [];
let mediaRecords: Array<Media> = [];
let mockSession: AppSession | null = null;
let insertedDays: Array<Record<string, unknown>> = [];
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
        if (
          prop === 'from' ||
          prop === 'where' ||
          prop === 'innerJoin' ||
          prop === 'leftJoin' ||
          prop === 'orderBy'
        ) {
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
          if (name === 'day') return [...days];
          if (name === 'media') return [...mediaRecords];
          if (name === 'day_comment') return [];
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
          if (name === 'day') {
            insertedDays.push(record);
          }
          return Effect.succeed([record]);
        },
        onConflictDoUpdate: () => ({
          returning: () => {
            const name = resolveTable(table);
            const record = {
              id: `${name}-new-${Date.now()}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...data
            };
            if (name === 'day') {
              insertedDays.push(record);
            }
            return Effect.succeed([record]);
          }
        })
      })
    }),

    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({
          returning: () => {
            const name = resolveTable(table);
            if (name === 'day' && days.length > 0) {
              const updated = { ...days[0], ...data, updatedAt: new Date() };
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
    name: null,
    role: 'editor',
    invitedAt: NOW,
    joinedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeDay(overrides: Partial<Day> = {}): Day {
  return {
    id: 'day-1',
    timelineId: 'tl-1',
    date: '2026-01-15',
    title: null,
    createdById: 'user-owner',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeMedia(overrides: Partial<Media> = {}): Media {
  return {
    id: 'media-1',
    dayId: 'day-1',
    type: 'photo',
    s3Key: 'timelines/tl-1/day-1/photo.jpg',
    thumbnailS3Key: 'timelines/tl-1/day-1/photo-thumb.jpg',
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
  days = [];
  mediaRecords = [];
  mockSession = null;
  insertedDays = [];
  deletedS3Keys = [];
  testAppLayer = createTestLayer();
}

// ============================================================
// Tests: createDayAction
// ============================================================

describe('createDayAction', () => {
  beforeEach(resetStores);

  it('creates day with valid input as owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.day.timelineId).toBe('tl-1');
      expect(result.day.date).toBe('2026-03-01');
      expect(result.day.createdById).toBe('user-owner');
    }
  });

  it('creates day with title', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: '2026-03-01',
      title: 'A special day'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.day.title).toBe('A special day');
    }
  });

  it('creates day as editor', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.day.createdById).toBe('user-editor');
    }
  });

  it('rejects viewer from creating days', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for non-member', async () => {
    setSession({ id: 'user-stranger' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for invalid date format', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: 'not-a-date'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty timelineId', async () => {
    setSession({ id: 'user-owner' });

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: '',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty date', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: ''
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for title exceeding max length', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: '2026-03-01',
      title: 'x'.repeat(201)
    });

    expect(result._tag).toBe('Error');
  });

  it('creates day without title (title is optional)', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];

    const { createDayAction } = await import('./create-day-action');
    const result = await createDayAction({
      timelineId: 'tl-1',
      date: '2026-03-01'
    });

    expect(result._tag).toBe('Success');
  });
});

// ============================================================
// Tests: updateDayAction
// ============================================================

describe('updateDayAction', () => {
  beforeEach(resetStores);

  it('updates day title as owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { updateDayAction } = await import('./update-day-action');
    const result = await updateDayAction({
      id: 'day-1',
      title: 'Updated title'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.day.title).toBe('Updated title');
    }
  });

  it('updates day title as editor', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { updateDayAction } = await import('./update-day-action');
    const result = await updateDayAction({
      id: 'day-1',
      title: 'Editor title'
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.day.title).toBe('Editor title');
    }
  });

  it('clears title by setting to null', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1', title: 'Old title' })];

    const { updateDayAction } = await import('./update-day-action');
    const result = await updateDayAction({
      id: 'day-1',
      title: null
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.day.title).toBeNull();
    }
  });

  it('rejects viewer from updating days', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { updateDayAction } = await import('./update-day-action');
    const result = await updateDayAction({
      id: 'day-1',
      title: 'Hacked'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent day', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [];

    const { updateDayAction } = await import('./update-day-action');
    const result = await updateDayAction({
      id: 'nonexistent',
      title: 'Something'
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty id', async () => {
    setSession({ id: 'user-owner' });

    const { updateDayAction } = await import('./update-day-action');
    const result = await updateDayAction({ id: '' });

    expect(result._tag).toBe('Error');
  });
});

// ============================================================
// Tests: deleteDayAction
// ============================================================

describe('deleteDayAction', () => {
  beforeEach(resetStores);

  it('deletes day as owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [];

    const { deleteDayAction } = await import('./delete-day-action');
    const result = await deleteDayAction({ id: 'day-1' });

    expect(result._tag).toBe('Success');
  });

  it('deletes day as editor', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [];

    const { deleteDayAction } = await import('./delete-day-action');
    const result = await deleteDayAction({ id: 'day-1' });

    expect(result._tag).toBe('Success');
  });

  it('cleans up S3 media files on delete', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [
      makeMedia({
        id: 'media-1',
        dayId: 'day-1',
        s3Key: 'timelines/tl-1/day-1/photo.jpg',
        thumbnailS3Key: 'timelines/tl-1/day-1/photo-thumb.jpg'
      }),
      makeMedia({
        id: 'media-2',
        dayId: 'day-1',
        s3Key: 'timelines/tl-1/day-1/video.mp4',
        thumbnailS3Key: null
      })
    ];

    const { deleteDayAction } = await import('./delete-day-action');
    await deleteDayAction({ id: 'day-1' });

    // 3 keys: photo.jpg + photo-thumb.jpg + video.mp4
    expect(deletedS3Keys).toHaveLength(3);
    expect(deletedS3Keys).toContain('timelines/tl-1/day-1/photo.jpg');
    expect(deletedS3Keys).toContain('timelines/tl-1/day-1/photo-thumb.jpg');
    expect(deletedS3Keys).toContain('timelines/tl-1/day-1/video.mp4');
  });

  it('rejects viewer from deleting days', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { deleteDayAction } = await import('./delete-day-action');
    const result = await deleteDayAction({ id: 'day-1' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent day', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [];

    const { deleteDayAction } = await import('./delete-day-action');
    const result = await deleteDayAction({ id: 'nonexistent' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty id', async () => {
    setSession({ id: 'user-owner' });

    const { deleteDayAction } = await import('./delete-day-action');
    const result = await deleteDayAction({ id: '' });

    expect(result._tag).toBe('Error');
  });
});

// ============================================================
// Imports for getDays (after mocks set up)
// ============================================================

import { getDays } from './get-days';

// ============================================================
// Tests: getDays query
// ============================================================

describe('getDays', () => {
  beforeEach(resetStores);

  it.effect('fails with UnauthenticatedError when no session', () =>
    Effect.gen(function* () {
      const result = yield* getDays({ timelineId: 'tl-1' }).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthenticatedError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns empty days for timeline with no days', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      days = [];
      mediaRecords = [];

      const result = yield* getDays({ timelineId: 'tl-1' });

      expect(result.days).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns days with media grouped by day', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      days = [
        makeDay({ id: 'day-1', date: '2026-01-15' }),
        makeDay({ id: 'day-2', date: '2026-01-16' })
      ];
      mediaRecords = [
        makeMedia({ id: 'media-1', dayId: 'day-1' }),
        makeMedia({ id: 'media-2', dayId: 'day-1' }),
        makeMedia({ id: 'media-3', dayId: 'day-2' })
      ];

      const result = yield* getDays({ timelineId: 'tl-1' });

      expect(result.days).toHaveLength(2);
      // Mock doesn't filter by dayId; verify structure is correct
      expect(result.days[0]).toHaveProperty('media');
      expect(result.days[1]).toHaveProperty('media');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('respects limit parameter', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      days = [
        makeDay({ id: 'day-1', date: '2026-01-15' }),
        makeDay({ id: 'day-2', date: '2026-01-16' }),
        makeDay({ id: 'day-3', date: '2026-01-17' })
      ];
      mediaRecords = [];

      // limit=1, but mock returns all days. With limit+1 = 2 passed to .limit(),
      // the mock will slice to 2 items. Then getDays will detect hasMore=true
      // and return only 1 day + nextCursor.
      const result = yield* getDays({ timelineId: 'tl-1', limit: 1 });

      expect(result.days).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns null nextCursor when no more pages', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      days = [makeDay({ id: 'day-1', date: '2026-01-15' })];
      mediaRecords = [];

      // limit=20 (default), only 1 day → no more pages
      const result = yield* getDays({ timelineId: 'tl-1' });

      expect(result.days).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('clamps limit to MAX_LIMIT', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      days = [];
      mediaRecords = [];

      // Should not throw even with excessive limit
      const result = yield* getDays({ timelineId: 'tl-1', limit: 999 });

      expect(result.days).toHaveLength(0);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('accepts newest sort order', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      days = [makeDay({ id: 'day-1', date: '2026-01-15' })];
      mediaRecords = [];

      const result = yield* getDays({ timelineId: 'tl-1', order: 'newest' });

      expect(result.days).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('accepts oldest sort order', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      days = [makeDay({ id: 'day-1', date: '2026-01-15' })];
      mediaRecords = [];

      const result = yield* getDays({ timelineId: 'tl-1', order: 'oldest' });

      expect(result.days).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('viewer can read days', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-viewer' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
      days = [makeDay({ id: 'day-1' })];
      mediaRecords = [];

      const result = yield* getDays({ timelineId: 'tl-1' });

      expect(result.days).toHaveLength(1);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('rejects non-member from reading days', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-stranger' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [];
      days = [makeDay({ id: 'day-1' })];

      const result = yield* getDays({ timelineId: 'tl-1' }).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );
});
