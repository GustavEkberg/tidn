// @vitest-environment node
import { ConfigProvider, Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthenticatedError } from '@/lib/core/errors';
import { AppLayer } from '@/lib/layers';
import { S3 } from '@/lib/services/s3/live-layer';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  getObject: vi.fn(),
  getSession: vi.fn(),
  getTimelineAccess: vi.fn(),
  limit: vi.fn()
}));

vi.mock('@effect-aws/client-s3', async () => {
  const { Context, Layer } = await import('effect');
  const S3Service = Context.GenericTag('@test/S3Service');
  return {
    S3Service,
    S3: { defaultLayer: Layer.succeed(S3Service, { getObject: mocks.getObject }) }
  };
});

vi.mock('@/lib/services/db/live-layer', async () => {
  const { Effect } = await import('effect');
  class Db extends Effect.Service<Db>()('@app/Db', {
    succeed: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: mocks.limit })
          })
        })
      })
    }
  }) {}
  return { Db };
});

vi.mock('@/lib/services/auth/get-session', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/core/timeline/get-timeline-access', () => ({
  getTimelineAccess: mocks.getTimelineAccess
}));

vi.mock('@/lib/layers', async () => {
  const { Db } = await import('@/lib/services/db/live-layer');
  const { S3 } = await import('@/lib/services/s3/live-layer');
  return {
    AppLayer: Layer.mergeAll(Db.Default, S3.Live).pipe(
      Layer.provide(
        Layer.setConfigProvider(
          ConfigProvider.fromMap(
            new Map([
              ['AWS_S3_BUCKET', 'test-bucket'],
              ['AWS_REGION', 'eu-north-1']
            ])
          )
        )
      )
    )
  };
});

const record = {
  id: 'photo',
  s3Key: 'timeline/photo.jpg',
  fileName: 'photo.jpg',
  isPrivate: false,
  dayId: 'day',
  timelineId: 'timeline'
};

function download() {
  return GET(new Request('https://tidn.test/api/media/download?mediaId=photo&timelineId=timeline'));
}

describe('media download', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockReturnValue(Effect.void);
    mocks.getTimelineAccess.mockReturnValue(Effect.succeed({ role: 'viewer' }));
    mocks.limit.mockReturnValue(Effect.succeed([record]));
    mocks.getObject.mockReturnValue(Effect.succeed('https://s3.test/signed-download'));
  });

  it('signs an attachment with a binary content type instead of an image preview', async () => {
    const response = await download();

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://s3.test/signed-download');
    expect(mocks.getTimelineAccess).toHaveBeenCalledWith('timeline', 'viewer');
    expect(mocks.getObject).toHaveBeenCalledWith(
      {
        Bucket: 'test-bucket',
        Key: 'timeline/photo.jpg',
        ResponseContentDisposition: 'attachment; filename="photo.jpg"',
        ResponseContentType: 'application/octet-stream'
      },
      { presigned: true, expiresIn: 300 }
    );
  });

  it('does not sign a download without authentication', async () => {
    mocks.getSession.mockReturnValue(
      Effect.fail(new UnauthenticatedError({ message: 'Not authenticated' }))
    );

    expect((await download()).status).toBe(401);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it('keeps normal image URLs free of download overrides', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const s3 = yield* S3;
        return yield* s3.createSignedDownloadUrl(record.s3Key);
      }).pipe(Effect.provide(AppLayer), Effect.scoped)
    );

    expect(mocks.getObject).toHaveBeenCalledWith(
      { Bucket: 'test-bucket', Key: 'timeline/photo.jpg' },
      { presigned: true, expiresIn: 300 }
    );
  });

  it('does not sign private media for viewers', async () => {
    mocks.limit.mockReturnValue(Effect.succeed([{ ...record, isPrivate: true }]));

    expect((await download()).status).toBe(403);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });
});
