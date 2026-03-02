import { Effect, Match } from 'effect';
import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { AppLayer } from '@/lib/layers';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import { S3 } from '@/lib/services/s3/live-layer';
import * as schema from '@/lib/services/db/schema';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';

/**
 * GET /api/media/download?mediaId=...&timelineId=...
 *
 * Generates a presigned S3 URL with Content-Disposition: attachment
 * and redirects the browser to it, triggering a file download.
 *
 * Access checks:
 * - Authenticated user
 * - Viewer (or higher) on the timeline
 * - Viewers cannot download private media
 * - Media must belong to the specified timeline (via day)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mediaId = url.searchParams.get('mediaId');
  const timelineId = url.searchParams.get('timelineId');

  if (!mediaId || !timelineId) {
    return NextResponse.json({ error: 'Missing mediaId or timelineId' }, { status: 400 });
  }

  return await Effect.runPromise(
    Effect.gen(function* () {
      // 1. Authenticate
      yield* getSession();

      // 2. Authorize — viewer or higher on the timeline
      const { role } = yield* getTimelineAccess(timelineId, 'viewer');

      // 3. Fetch media with its parent day
      const db = yield* Db;
      const [record] = yield* db
        .select({
          id: schema.media.id,
          s3Key: schema.media.s3Key,
          fileName: schema.media.fileName,
          isPrivate: schema.media.isPrivate,
          dayId: schema.media.dayId,
          timelineId: schema.day.timelineId
        })
        .from(schema.media)
        .innerJoin(schema.day, eq(schema.media.dayId, schema.day.id))
        .where(and(eq(schema.media.id, mediaId), eq(schema.day.timelineId, timelineId)))
        .limit(1);

      if (!record) {
        return NextResponse.json({ error: 'Media not found' }, { status: 404 });
      }

      // 4. Privacy check — viewers cannot download private media
      if (record.isPrivate && role === 'viewer') {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      // 5. Generate presigned URL with attachment disposition
      const s3 = yield* S3;
      const signedUrl = yield* s3.createSignedDownloadUrl(record.s3Key, 300, {
        disposition: `attachment; filename="${record.fileName}"`
      });

      // 6. Redirect to the presigned URL
      return NextResponse.redirect(signedUrl, 302);
    }).pipe(
      Effect.withSpan('api.media.download'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.tapError(e => Effect.logError('api.media.download failed', { error: e })),
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error).pipe(
            Match.tag('UnauthenticatedError', () =>
              Effect.succeed(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
            ),
            Match.tag('NotFoundError', () =>
              Effect.succeed(NextResponse.json({ error: 'Not found' }, { status: 404 }))
            ),
            Match.tag('UnauthorizedError', () =>
              Effect.succeed(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
            ),
            Match.orElse(() =>
              Effect.succeed(NextResponse.json({ error: 'Internal server error' }, { status: 500 }))
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
}
