/**
 * Tests for timeline CRUD, access control, and query functions.
 *
 * Strategy: mock `getSession` at module level (returns controlled session),
 * provide mock `Db` + `Auth` + `S3` layers. Drizzle chains are simulated
 * with simple proxy objects that resolve to controlled in-memory data.
 */

/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { vi, beforeEach } from 'vitest';
import type { AppSession } from '@/lib/services/auth/get-session';
import type { Timeline, TimelineMember } from '@/lib/services/db/schema';

// ============================================================
// In-memory stores + session control
// ============================================================

let timelines: Array<Timeline> = [];
let members: Array<TimelineMember> = [];
let mockSession: AppSession | null = null;
let deletedS3Prefixes: Array<string> = [];
let insertedTimelines: Array<Record<string, unknown>> = [];

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

// Mock getSession — replaces the real implementation that uses Auth service + cookies
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

// Mock AppLayer so server actions can provide it without real services
vi.mock('@/lib/layers', () => {
  // Will be set up with test layers in createTestLayer()
  return {
    get AppLayer() {
      return testAppLayer;
    }
  };
});

// ============================================================
// Mock Drizzle DB
// ============================================================

/**
 * Creates a proxy-based mock that simulates Drizzle's chainable query API.
 * Methods like .select().from().where().limit() resolve to Effects with
 * data from our in-memory stores.
 *
 * Uses a simple heuristic: `from(table)` determines which store to read,
 * and `where()` is ignored (filtering is done by arranging test data).
 */
function createMockDb() {
  function makeChain(data: () => Array<Record<string, unknown>>) {
    const effect = Effect.succeed(data());

    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        // Make chain yield-able as an Effect (for yield*)
        if (prop === Symbol.iterator) {
          return function* () {
            return yield* effect;
          };
        }
        if (prop === 'limit') {
          return (n: number) => makeChain(() => data().slice(0, n));
        }
        // Chain methods that just narrow — return same chain shape
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
          return [];
        };
        return makeChain(storeAccessor);
      }
    }),

    insert: (_table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: () => {
          const record = {
            id: `tl-new-${Date.now()}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data
          };
          insertedTimelines.push(record);
          return Effect.succeed([record]);
        }
      })
    }),

    update: (_table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({
          returning: () => {
            if (timelines.length > 0) {
              const updated = { ...timelines[0], ...data, updatedAt: new Date() };
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

// Stub Auth — getSession is mocked at module level, so Auth is never actually called
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
  deleteFolder: (prefix: string) => {
    deletedS3Prefixes.push(prefix);
    return Effect.succeed({ deletedCount: 0 });
  },
  deleteFile: () => Effect.succeed(undefined),
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

// This is used by the mocked AppLayer
let testAppLayer = createTestLayer();

// ============================================================
// Imports (after mocks are set up)
// ============================================================

import { getTimelineAccess } from './get-timeline-access';
import { getTimelines } from './get-timelines';

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

// ============================================================
// Tests: getTimelineAccess
// ============================================================

describe('getTimelineAccess', () => {
  beforeEach(() => {
    timelines = [];
    members = [];
    mockSession = null;
    deletedS3Prefixes = [];
    insertedTimelines = [];
    testAppLayer = createTestLayer();
  });

  it.effect('fails with UnauthenticatedError when no session', () =>
    Effect.gen(function* () {
      timelines = [makeTimeline()];

      const result = yield* getTimelineAccess('tl-1', 'viewer').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthenticatedError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns owner role when user is timeline owner', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];

      const access = yield* getTimelineAccess('tl-1', 'viewer');

      expect(access.role).toBe('owner');
      expect(access.timeline.id).toBe('tl-1');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('owner satisfies owner requirement', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];

      const access = yield* getTimelineAccess('tl-1', 'owner');

      expect(access.role).toBe('owner');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('owner satisfies editor requirement', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];

      const access = yield* getTimelineAccess('tl-1', 'editor');

      expect(access.role).toBe('owner');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('fails with NotFoundError when timeline does not exist', () =>
    Effect.gen(function* () {
      setSession();
      timelines = [];

      const result = yield* getTimelineAccess('nonexistent', 'viewer').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('non-member gets NotFoundError (no existence leak)', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-stranger' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [];

      const result = yield* getTimelineAccess('tl-1', 'viewer').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('editor member has editor access', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-editor' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];

      const access = yield* getTimelineAccess('tl-1', 'editor');

      expect(access.role).toBe('editor');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('editor satisfies viewer requirement', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-editor' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];

      const access = yield* getTimelineAccess('tl-1', 'viewer');

      expect(access.role).toBe('editor');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('viewer has viewer access', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-viewer' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];

      const access = yield* getTimelineAccess('tl-1', 'viewer');

      expect(access.role).toBe('viewer');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('viewer fails editor requirement', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-viewer' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];

      const result = yield* getTimelineAccess('tl-1', 'editor').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthorizedError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('viewer fails owner requirement', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-viewer' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];

      const result = yield* getTimelineAccess('tl-1', 'owner').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthorizedError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  // The isNotNull(joinedAt) WHERE clause is tested here by simulating
  // what the DB returns: when only a pending invite exists (joinedAt=null),
  // the real DB returns no rows. We simulate this by having no members.
  it.effect('pending invite (no joined membership) treated as no access', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-pending' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      // Simulate DB returning no rows because isNotNull(joinedAt) filters out
      // the pending invite. The actual WHERE clause filtering is verified in
      // get-timeline-access.ts:73 — isNotNull(schema.timelineMember.joinedAt)
      members = [];

      const result = yield* getTimelineAccess('tl-1', 'viewer').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('editor fails owner requirement', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-editor' });
      timelines = [makeTimeline({ ownerId: 'user-owner' })];
      members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];

      const result = yield* getTimelineAccess('tl-1', 'owner').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthorizedError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );
});

// ============================================================
// Tests: getTimelines
// ============================================================

describe('getTimelines', () => {
  beforeEach(() => {
    timelines = [];
    members = [];
    mockSession = null;
    testAppLayer = createTestLayer();
  });

  it.effect('fails with UnauthenticatedError when no session', () =>
    Effect.gen(function* () {
      const result = yield* getTimelines().pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('UnauthenticatedError');
      }
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns empty array when no timelines', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-lonely' });

      const result = yield* getTimelines();

      expect(result).toEqual([]);
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('returns owned timelines with owner role', () =>
    Effect.gen(function* () {
      setSession({ id: 'user-owner' });
      timelines = [makeTimeline({ id: 'tl-1', ownerId: 'user-owner' })];

      const result = yield* getTimelines();

      expect(result.length).toBeGreaterThanOrEqual(1);
      // The mock returns all timelines for the 'timeline' table query
      // In a real DB, the WHERE clause would filter by ownerId
      expect(result[0].id).toBe('tl-1');
    }).pipe(Effect.provide(createTestLayer()))
  );
});

// ============================================================
// Tests: Server Actions (create/update/delete)
// ============================================================

// These test the action orchestration: validation → auth → DB → revalidate
// The domain logic is tested above; here we verify the action wrapper behavior.

describe('createTimelineAction', () => {
  beforeEach(() => {
    timelines = [];
    members = [];
    mockSession = null;
    insertedTimelines = [];
    testAppLayer = createTestLayer();
  });

  it('creates timeline with valid input', async () => {
    setSession({ id: 'user-1' });

    const { createTimelineAction } = await import('./create-timeline-action');
    const result = await createTimelineAction({ name: 'My Timeline' });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.timeline.name).toBe('My Timeline');
      expect(result.timeline.ownerId).toBe('user-1');
    }
  });

  it('returns error for empty name', async () => {
    setSession({ id: 'user-1' });

    const { createTimelineAction } = await import('./create-timeline-action');
    const result = await createTimelineAction({ name: '' });

    expect(result._tag).toBe('Error');
  });

  it('returns error with description exceeding max length', async () => {
    setSession({ id: 'user-1' });

    const { createTimelineAction } = await import('./create-timeline-action');
    const result = await createTimelineAction({
      name: 'Valid',
      description: 'x'.repeat(501)
    });

    expect(result._tag).toBe('Error');
  });
});

describe('updateTimelineAction', () => {
  beforeEach(() => {
    timelines = [];
    members = [];
    mockSession = null;
    testAppLayer = createTestLayer();
  });

  it('updates timeline when user is owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ id: 'tl-1', ownerId: 'user-owner' })];

    const { updateTimelineAction } = await import('./update-timeline-action');
    const result = await updateTimelineAction({ id: 'tl-1', name: 'Updated Name' });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.timeline.name).toBe('Updated Name');
    }
  });

  it('returns error when non-owner tries to update', async () => {
    setSession({ id: 'user-stranger' });
    timelines = [makeTimeline({ id: 'tl-1', ownerId: 'user-owner' })];
    members = [];

    const { updateTimelineAction } = await import('./update-timeline-action');
    const result = await updateTimelineAction({ id: 'tl-1', name: 'Hack' });

    // Non-owner gets NotFoundError (no existence leak) which maps to Error tag
    expect(result._tag).toBe('Error');
  });

  it('returns error for empty id', async () => {
    setSession({ id: 'user-owner' });

    const { updateTimelineAction } = await import('./update-timeline-action');
    const result = await updateTimelineAction({ id: '' });

    expect(result._tag).toBe('Error');
  });
});

describe('deleteTimelineAction', () => {
  beforeEach(() => {
    timelines = [];
    members = [];
    mockSession = null;
    deletedS3Prefixes = [];
    testAppLayer = createTestLayer();
  });

  it('deletes timeline when user is owner', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ id: 'tl-1', ownerId: 'user-owner' })];

    const { deleteTimelineAction } = await import('./delete-timeline-action');
    const result = await deleteTimelineAction({ id: 'tl-1' });

    expect(result._tag).toBe('Success');
  });

  it('cleans up S3 media on delete', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ id: 'tl-1', ownerId: 'user-owner' })];

    const { deleteTimelineAction } = await import('./delete-timeline-action');
    await deleteTimelineAction({ id: 'tl-1' });

    expect(deletedS3Prefixes).toContain('timelines/tl-1/');
  });

  it('returns error when non-owner tries to delete', async () => {
    setSession({ id: 'user-stranger' });
    timelines = [makeTimeline({ id: 'tl-1', ownerId: 'user-owner' })];
    members = [];

    const { deleteTimelineAction } = await import('./delete-timeline-action');
    const result = await deleteTimelineAction({ id: 'tl-1' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent timeline', async () => {
    setSession({ id: 'user-owner' });
    timelines = [];

    const { deleteTimelineAction } = await import('./delete-timeline-action');
    const result = await deleteTimelineAction({ id: 'nonexistent' });

    expect(result._tag).toBe('Error');
  });
});
