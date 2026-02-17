import { Suspense } from 'react';
import { Effect, Match } from 'effect';
import { cookies } from 'next/headers';
import { NextEffect } from '@/lib/next-effect';
import { AppLayer } from '@/lib/layers';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';
import { getEvents } from '@/lib/core/event/get-events';
import { S3 } from '@/lib/services/s3/live-layer';
import { loadSearchParams } from './search-params';
import { TimelineView } from './timeline-view';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | Array<string> | undefined>>;
};

async function Content({ params, searchParams }: Props) {
  await cookies();
  const { id } = await params;
  const { order } = await loadSearchParams(searchParams);

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const { timeline, role } = yield* getTimelineAccess(id, 'viewer');
      const s3 = yield* S3;

      const result = yield* getEvents({
        timelineId: id,
        order,
        limit: 20
      });

      // Collect all thumbnail S3 keys for batch URL generation
      const thumbnailKeys: Array<string> = [];
      for (const event of result.events) {
        for (const media of event.media) {
          if (media.thumbnailS3Key && media.processingStatus === 'completed') {
            thumbnailKeys.push(media.thumbnailS3Key);
          }
        }
      }

      // Generate signed URLs for all thumbnails in parallel
      const urlEntries =
        thumbnailKeys.length > 0
          ? yield* Effect.all(
              thumbnailKeys.map(key =>
                Effect.gen(function* () {
                  const signedUrl = yield* s3.createSignedDownloadUrl(key, 3600);
                  return [key, signedUrl] as const;
                })
              ),
              { concurrency: 10 }
            )
          : [];

      const thumbnailUrls: Record<string, string> = {};
      for (const [key, url] of urlEntries) {
        thumbnailUrls[key] = url;
      }

      // Serialize events for client component
      const serializedEvents = result.events.map(e => ({
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

      return (
        <TimelineView
          key={order}
          timeline={{
            id: timeline.id,
            name: timeline.name,
            description: timeline.description
          }}
          role={role}
          initialEvents={serializedEvents}
          initialCursor={result.nextCursor}
          initialThumbnailUrls={thumbnailUrls}
        />
      );
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('NotFoundError', () => NextEffect.redirect('/')),
            Match.when('UnauthorizedError', () => NextEffect.redirect('/')),
            Match.orElse(() =>
              Effect.sync(() => {
                if (process.env.NODE_ENV !== 'production') {
                  console.error('[page /timeline/[id]] Error:', error);
                }
                return (
                  <div className="flex min-h-dvh items-center justify-center p-6">
                    <p className="text-muted-foreground">Something went wrong.</p>
                  </div>
                );
              })
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  );
}

export default async function Page(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading timeline...</p>
        </div>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}
