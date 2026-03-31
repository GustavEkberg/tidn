/**
 * Tests for media upload flow and processing:
 * - get-media-upload-url-action (file size limits, mime type validation)
 * - confirm-media-upload-action
 * - delete-media-action (S3 cleanup)
 * - photo processing (EXIF extraction, stripping, thumbnail generation)
 *
 * Strategy: same as timeline.test.ts — mock `getSession` at module level,
 * provide mock `Db`/`Auth`/`S3` layers. Drizzle chains simulated with proxy
 * objects resolving to in-memory stores. Sharp mocked for photo processing tests.
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
let insertedMedia: Array<Record<string, unknown>> = [];
let updatedMedia: Array<Record<string, unknown>> = [];
let deletedS3Keys: Array<string> = [];
let savedS3Files: Array<{ key: string; contentType: string }> = [];
let s3Buffers: Map<string, Buffer> = new Map();

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

vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    // Execute the callback immediately in tests so processing runs synchronously
    fn();
  })
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

// Mock processMedia to avoid triggering real photo/video processing
// from confirm-media-upload-action tests
vi.mock('@/lib/core/media/process-media', () => ({
  processMedia: () => Effect.void
}));

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
          if (name === 'day') return [...days];
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
          if (name === 'media') {
            insertedMedia.push(record);
          }
          return Effect.succeed([record]);
        }
      })
    }),

    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => {
        const name = resolveTable(table);
        const chainResult = {
          where: (_cond: unknown) => {
            if (name === 'media') {
              updatedMedia.push(data);
              if (mediaRecords.length > 0) {
                const updated = { ...mediaRecords[0], ...data, updatedAt: new Date() };
                return {
                  returning: () => Effect.succeed([updated]),
                  // Make chain yield-able as an Effect when no returning() called
                  [Symbol.iterator]: function* () {
                    return yield* Effect.succeed([updated]);
                  }
                };
              }
            }
            const empty = {
              returning: () => Effect.succeed([]),
              [Symbol.iterator]: function* () {
                return yield* Effect.succeed([]);
              }
            };
            return empty;
          }
        };
        return chainResult;
      }
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

function createS3Test() {
  return Layer.succeed(S3, {
    deleteFolder: () => Effect.succeed({ deletedCount: 0 }),
    deleteFile: (key: string) => {
      deletedS3Keys.push(key);
      return Effect.succeed(undefined);
    },
    createSignedUploadUrl: () => Effect.succeed('https://mock.test/upload'),
    createSignedDownloadUrl: () => Effect.succeed('https://mock.test/download'),
    getBuffer: (key: string) => {
      const buf = s3Buffers.get(key);
      if (buf) return Effect.succeed(buf);
      return Effect.succeed(Buffer.from('mock-file-content'));
    },
    saveFile: (key: string, _buffer: Buffer, contentType?: string) => {
      savedS3Files.push({ key, contentType: contentType ?? 'application/octet-stream' });
      return Effect.succeed(`https://mock.test/${key}`);
    },
    copyFile: () => Effect.succeed('https://mock.test/copied'),
    listObjects: () => Effect.succeed([]),
    createSignedUrl: () => Effect.succeed('https://mock.test/signed'),
    getObjectKeyFromUrl: (url: string) => url,
    getUrlFromObjectKey: (key: string) => `https://mock.test/${key}`,
    config: { bucket: 'test', region: 'us-east-1', baseUrl: 'https://mock.test/' }
  } as never);
}

function createTestLayer() {
  const mockDb = createMockDb();
  const DbTest = Layer.succeed(Db, mockDb as never);
  return Layer.mergeAll(AuthTest, DbTest, createS3Test());
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
  insertedMedia = [];
  updatedMedia = [];
  deletedS3Keys = [];
  savedS3Files = [];
  s3Buffers = new Map();
  testAppLayer = createTestLayer();
}

// ============================================================
// Tests: getMediaUploadUrlAction
// ============================================================

describe('getMediaUploadUrlAction', () => {
  beforeEach(resetStores);

  it('generates upload URL for valid JPEG photo', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024 * 1024 // 1MB
    });

    expect(result._tag).toBe('Success');
    if (result._tag === 'Success') {
      expect(result.uploadUrl).toBe('https://mock.test/upload');
      expect(result.mediaId).toBeTruthy();
    }
  });

  it('generates upload URL for PNG photo', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'image.png',
      mimeType: 'image/png',
      fileSize: 5 * 1024 * 1024 // 5MB
    });

    expect(result._tag).toBe('Success');
  });

  it('generates upload URL for WebP photo', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'image.webp',
      mimeType: 'image/webp',
      fileSize: 2 * 1024 * 1024
    });

    expect(result._tag).toBe('Success');
  });

  it('generates upload URL for HEIC photo', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'IMG_0001.HEIC',
      mimeType: 'image/heic',
      fileSize: 3 * 1024 * 1024
    });

    expect(result._tag).toBe('Success');
  });

  it('generates upload URL for MP4 video', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      fileSize: 5 * 1024 * 1024 // 5MB
    });

    expect(result._tag).toBe('Success');
  });

  it('generates upload URL for MOV video', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'video.mov',
      mimeType: 'video/quicktime',
      fileSize: 8 * 1024 * 1024 // 8MB
    });

    expect(result._tag).toBe('Success');
  });

  it('generates upload URL for WebM video', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'video.webm',
      mimeType: 'video/webm',
      fileSize: 9 * 1024 * 1024 // 9MB
    });

    expect(result._tag).toBe('Success');
  });

  // -- FILE SIZE LIMITS --

  it('rejects photo exceeding 10MB limit', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'huge.jpg',
      mimeType: 'image/jpeg',
      fileSize: 11 * 1024 * 1024 // 11MB — over 10MB limit
    });

    expect(result._tag).toBe('Error');
    if (result._tag === 'Error') {
      expect(result.message).toContain('too large');
    }
  });

  it('accepts photo at exactly 10MB', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'exact.jpg',
      mimeType: 'image/jpeg',
      fileSize: 10 * 1024 * 1024 // exactly 10MB
    });

    expect(result._tag).toBe('Success');
  });

  it('rejects video exceeding 10MB limit', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'huge.mp4',
      mimeType: 'video/mp4',
      fileSize: 11 * 1024 * 1024 // 11MB — over 10MB limit
    });

    expect(result._tag).toBe('Error');
    if (result._tag === 'Error') {
      expect(result.message).toContain('too large');
    }
  });

  it('accepts video at exactly 10MB', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'exact.mp4',
      mimeType: 'video/mp4',
      fileSize: 10 * 1024 * 1024 // exactly 10MB
    });

    expect(result._tag).toBe('Success');
  });

  // -- MIME TYPE VALIDATION --

  it('rejects unsupported mime type (application/pdf)', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'doc.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024
    });

    expect(result._tag).toBe('Error');
  });

  it('rejects unsupported mime type (image/gif)', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'animation.gif',
      mimeType: 'image/gif',
      fileSize: 1024
    });

    expect(result._tag).toBe('Error');
  });

  it('rejects unsupported mime type (video/avi)', async () => {
    setSession({ id: 'user-owner' });

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'video.avi',
      mimeType: 'video/x-msvideo',
      fileSize: 1024
    });

    expect(result._tag).toBe('Error');
  });

  // -- INPUT VALIDATION --

  it('rejects empty dayId', async () => {
    setSession({ id: 'user-owner' });

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: '',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024
    });

    expect(result._tag).toBe('Error');
  });

  it('rejects empty fileName', async () => {
    setSession({ id: 'user-owner' });

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: '',
      mimeType: 'image/jpeg',
      fileSize: 1024
    });

    expect(result._tag).toBe('Error');
  });

  it('rejects zero fileSize', async () => {
    setSession({ id: 'user-owner' });

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 0
    });

    expect(result._tag).toBe('Error');
  });

  it('rejects negative fileSize', async () => {
    setSession({ id: 'user-owner' });

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: -100
    });

    expect(result._tag).toBe('Error');
  });

  // -- AUTH / ACCESS CONTROL --

  it('creates media record with correct processingStatus', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024
    });

    expect(insertedMedia).toHaveLength(1);
    expect(insertedMedia[0].processingStatus).toBe('pending');
    expect(insertedMedia[0].type).toBe('photo');
    expect(insertedMedia[0].uploadedById).toBe('user-owner');
  });

  it('creates media record with video type for video mimeType', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'vid.mp4',
      mimeType: 'video/mp4',
      fileSize: 5 * 1024 * 1024
    });

    expect(insertedMedia).toHaveLength(1);
    expect(insertedMedia[0].type).toBe('video');
  });

  it('generates S3 key with correct pattern', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024
    });

    expect(insertedMedia).toHaveLength(1);
    const s3Key = insertedMedia[0].s3Key;
    expect(typeof s3Key).toBe('string');
    // Pattern: timelines/{timelineId}/{dayId}/{timestamp}-{fileName}
    expect(s3Key).toMatch(/^timelines\/tl-1\/day-1\/\d+-photo\.jpg$/);
  });

  it('allows editor to generate upload URL', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024
    });

    expect(result._tag).toBe('Success');
  });

  it('rejects viewer from generating upload URL', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'day-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024
    });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent day', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = []; // no days

    const { getMediaUploadUrlAction } = await import('./get-media-upload-url-action');
    const result = await getMediaUploadUrlAction({
      dayId: 'nonexistent',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024
    });

    expect(result._tag).toBe('Error');
  });
});

// ============================================================
// Tests: confirmMediaUploadAction
// ============================================================

describe('confirmMediaUploadAction', () => {
  beforeEach(resetStores);

  it('confirms upload and sets status to processing', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [
      makeMedia({
        id: 'media-1',
        dayId: 'day-1',
        processingStatus: 'pending',
        s3Key: 'timelines/tl-1/day-1/photo.jpg',
        mimeType: 'image/jpeg',
        type: 'photo'
      })
    ];

    const { confirmMediaUploadAction } = await import('./confirm-media-upload-action');
    const result = await confirmMediaUploadAction({ mediaId: 'media-1' });

    expect(result._tag).toBe('Success');
    expect(updatedMedia.length).toBeGreaterThanOrEqual(1);
    expect(updatedMedia[0].processingStatus).toBe('processing');
  });

  it('allows editor to confirm upload', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [
      makeMedia({
        id: 'media-1',
        dayId: 'day-1',
        processingStatus: 'pending',
        type: 'photo'
      })
    ];

    const { confirmMediaUploadAction } = await import('./confirm-media-upload-action');
    const result = await confirmMediaUploadAction({ mediaId: 'media-1' });

    expect(result._tag).toBe('Success');
  });

  it('rejects viewer from confirming upload', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [
      makeMedia({
        id: 'media-1',
        dayId: 'day-1',
        processingStatus: 'pending',
        type: 'photo'
      })
    ];

    const { confirmMediaUploadAction } = await import('./confirm-media-upload-action');
    const result = await confirmMediaUploadAction({ mediaId: 'media-1' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent media', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [];

    const { confirmMediaUploadAction } = await import('./confirm-media-upload-action');
    const result = await confirmMediaUploadAction({ mediaId: 'nonexistent' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty mediaId', async () => {
    setSession({ id: 'user-owner' });

    const { confirmMediaUploadAction } = await import('./confirm-media-upload-action');
    const result = await confirmMediaUploadAction({ mediaId: '' });

    expect(result._tag).toBe('Error');
  });
});

// ============================================================
// Tests: deleteMediaAction
// ============================================================

describe('deleteMediaAction', () => {
  beforeEach(resetStores);

  it('deletes media and cleans up S3 (original + thumbnail)', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [
      makeMedia({
        id: 'media-1',
        dayId: 'day-1',
        s3Key: 'timelines/tl-1/day-1/photo.jpg',
        thumbnailS3Key: 'timelines/tl-1/day-1/photo-thumb.jpg'
      })
    ];

    const { deleteMediaAction } = await import('./delete-media-action');
    const result = await deleteMediaAction({ mediaId: 'media-1' });

    expect(result._tag).toBe('Success');
    expect(deletedS3Keys).toHaveLength(2);
    expect(deletedS3Keys).toContain('timelines/tl-1/day-1/photo.jpg');
    expect(deletedS3Keys).toContain('timelines/tl-1/day-1/photo-thumb.jpg');
  });

  it('deletes media with no thumbnail (only original S3 key)', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [
      makeMedia({
        id: 'media-1',
        dayId: 'day-1',
        s3Key: 'timelines/tl-1/day-1/video.mp4',
        thumbnailS3Key: null
      })
    ];

    const { deleteMediaAction } = await import('./delete-media-action');
    const result = await deleteMediaAction({ mediaId: 'media-1' });

    expect(result._tag).toBe('Success');
    expect(deletedS3Keys).toHaveLength(1);
    expect(deletedS3Keys).toContain('timelines/tl-1/day-1/video.mp4');
  });

  it('allows editor to delete media', async () => {
    setSession({ id: 'user-editor' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-editor', role: 'editor', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [makeMedia({ id: 'media-1', dayId: 'day-1', thumbnailS3Key: null })];

    const { deleteMediaAction } = await import('./delete-media-action');
    const result = await deleteMediaAction({ mediaId: 'media-1' });

    expect(result._tag).toBe('Success');
  });

  it('rejects viewer from deleting media', async () => {
    setSession({ id: 'user-viewer' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    members = [makeMember({ userId: 'user-viewer', role: 'viewer', joinedAt: NOW })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [makeMedia({ id: 'media-1', dayId: 'day-1' })];

    const { deleteMediaAction } = await import('./delete-media-action');
    const result = await deleteMediaAction({ mediaId: 'media-1' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for nonexistent media', async () => {
    setSession({ id: 'user-owner' });
    timelines = [makeTimeline({ ownerId: 'user-owner' })];
    days = [makeDay({ id: 'day-1', timelineId: 'tl-1' })];
    mediaRecords = [];

    const { deleteMediaAction } = await import('./delete-media-action');
    const result = await deleteMediaAction({ mediaId: 'nonexistent' });

    expect(result._tag).toBe('Error');
  });

  it('returns error for empty mediaId', async () => {
    setSession({ id: 'user-owner' });

    const { deleteMediaAction } = await import('./delete-media-action');
    const result = await deleteMediaAction({ mediaId: '' });

    expect(result._tag).toBe('Error');
  });
});

// ============================================================
// Tests: processPhoto (photo processing pipeline)
//
// These tests use real sharp to create test images and verify
// the processing pipeline end-to-end (with mock S3/DB).
// ============================================================

import sharp from 'sharp';
import { processPhoto } from './process-photo';

/**
 * Helper: create a test image buffer with sharp.
 */
const createTestImage = (
  width: number,
  height: number,
  format: 'jpeg' | 'png' = 'jpeg'
): Effect.Effect<Buffer, unknown> =>
  Effect.tryPromise(() => {
    const pipeline = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    });
    return format === 'png' ? pipeline.png().toBuffer() : pipeline.jpeg().toBuffer();
  });

describe('processPhoto', () => {
  beforeEach(resetStores);

  it.effect('processes JPEG photo: strips EXIF, generates thumbnail, updates DB', () =>
    Effect.gen(function* () {
      const testBuffer = yield* createTestImage(800, 600);

      s3Buffers.set('timelines/tl-1/day-1/test.jpg', testBuffer);

      mediaRecords = [
        makeMedia({
          id: 'media-process-1',
          dayId: 'day-1',
          s3Key: 'timelines/tl-1/day-1/test.jpg',
          mimeType: 'image/jpeg',
          processingStatus: 'processing'
        })
      ];

      yield* processPhoto({
        mediaId: 'media-process-1',
        s3Key: 'timelines/tl-1/day-1/test.jpg',
        mimeType: 'image/jpeg'
      });

      // Verify S3 saves happened (stripped original + thumbnail)
      expect(savedS3Files.length).toBeGreaterThanOrEqual(2);

      // First save: stripped original
      const originalSave = savedS3Files.find(f => f.key === 'timelines/tl-1/day-1/test.jpg');
      expect(originalSave).toBeTruthy();

      // Second save: thumbnail
      const thumbSave = savedS3Files.find(f => f.key === 'timelines/tl-1/day-1/test-thumb.jpg');
      expect(thumbSave).toBeTruthy();
      expect(thumbSave?.contentType).toBe('image/jpeg');

      // Verify DB update
      expect(updatedMedia.length).toBeGreaterThanOrEqual(1);
      const lastUpdate = updatedMedia[updatedMedia.length - 1];
      expect(lastUpdate.processingStatus).toBe('completed');
      expect(lastUpdate.thumbnailS3Key).toBe('timelines/tl-1/day-1/test-thumb.jpg');
      expect(typeof lastUpdate.width).toBe('number');
      expect(typeof lastUpdate.height).toBe('number');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('HEIC conversion: converts to JPEG, deletes original, updates s3Key', () =>
    Effect.gen(function* () {
      // Use JPEG buffer as proxy for HEIC (sharp processes HEIC natively,
      // but generating real HEIC in tests is impractical). The processing
      // code path is determined by mimeType, not buffer contents.
      const testBuffer = yield* createTestImage(400, 300);

      s3Buffers.set('timelines/tl-1/day-1/IMG_0001.heic', testBuffer);

      mediaRecords = [
        makeMedia({
          id: 'media-heic-1',
          dayId: 'day-1',
          s3Key: 'timelines/tl-1/day-1/IMG_0001.heic',
          mimeType: 'image/heic',
          processingStatus: 'processing'
        })
      ];

      yield* processPhoto({
        mediaId: 'media-heic-1',
        s3Key: 'timelines/tl-1/day-1/IMG_0001.heic',
        mimeType: 'image/heic'
      });

      // Verify converted JPEG was uploaded to new key
      const jpegSave = savedS3Files.find(f => f.key === 'timelines/tl-1/day-1/IMG_0001.jpg');
      expect(jpegSave).toBeTruthy();

      // Verify original HEIC was deleted from S3
      expect(deletedS3Keys).toContain('timelines/tl-1/day-1/IMG_0001.heic');

      // Verify thumbnail was generated
      const thumbSave = savedS3Files.find(f => f.key === 'timelines/tl-1/day-1/IMG_0001-thumb.jpg');
      expect(thumbSave).toBeTruthy();

      // Verify DB update includes new s3Key and mimeType
      const lastUpdate = updatedMedia[updatedMedia.length - 1];
      expect(lastUpdate.processingStatus).toBe('completed');
      expect(lastUpdate.s3Key).toBe('timelines/tl-1/day-1/IMG_0001.jpg');
      expect(lastUpdate.mimeType).toBe('image/jpeg');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('thumbnail key follows convention: {key}-thumb.jpg', () =>
    Effect.gen(function* () {
      const testBuffer = yield* createTestImage(100, 100, 'png');

      s3Buffers.set('timelines/tl-1/day-1/sunset.png', testBuffer);

      mediaRecords = [
        makeMedia({
          id: 'media-png-1',
          dayId: 'day-1',
          s3Key: 'timelines/tl-1/day-1/sunset.png',
          mimeType: 'image/png',
          processingStatus: 'processing'
        })
      ];

      yield* processPhoto({
        mediaId: 'media-png-1',
        s3Key: 'timelines/tl-1/day-1/sunset.png',
        mimeType: 'image/png'
      });

      // PNG thumbnail should be JPEG (thumbnails always JPEG)
      const thumbSave = savedS3Files.find(f => f.key === 'timelines/tl-1/day-1/sunset-thumb.jpg');
      expect(thumbSave).toBeTruthy();
      expect(thumbSave?.contentType).toBe('image/jpeg');
    }).pipe(Effect.provide(createTestLayer()))
  );

  it.effect('sets width and height from processed image', () =>
    Effect.gen(function* () {
      const testBuffer = yield* createTestImage(1920, 1080);

      s3Buffers.set('timelines/tl-1/day-1/landscape.jpg', testBuffer);

      mediaRecords = [
        makeMedia({
          id: 'media-dims-1',
          dayId: 'day-1',
          s3Key: 'timelines/tl-1/day-1/landscape.jpg',
          mimeType: 'image/jpeg',
          processingStatus: 'processing'
        })
      ];

      yield* processPhoto({
        mediaId: 'media-dims-1',
        s3Key: 'timelines/tl-1/day-1/landscape.jpg',
        mimeType: 'image/jpeg'
      });

      const lastUpdate = updatedMedia[updatedMedia.length - 1];
      expect(lastUpdate.width).toBe(1920);
      expect(lastUpdate.height).toBe(1080);
    }).pipe(Effect.provide(createTestLayer()))
  );
});

// ============================================================
// Tests: processPhoto error handling
// ============================================================

describe('processPhoto error handling', () => {
  beforeEach(resetStores);

  it.effect('fails with corrupt image data', () =>
    Effect.gen(function* () {
      s3Buffers.set('timelines/tl-1/day-1/corrupt.jpg', Buffer.from('not-an-image'));

      mediaRecords = [
        makeMedia({
          id: 'media-fail-1',
          dayId: 'day-1',
          s3Key: 'timelines/tl-1/day-1/corrupt.jpg',
          mimeType: 'image/jpeg',
          processingStatus: 'processing'
        })
      ];

      const result = yield* processPhoto({
        mediaId: 'media-fail-1',
        s3Key: 'timelines/tl-1/day-1/corrupt.jpg',
        mimeType: 'image/jpeg'
      }).pipe(Effect.either);

      // processPhoto should fail with corrupt data
      expect(result._tag).toBe('Left');
    }).pipe(Effect.provide(createTestLayer()))
  );
});
