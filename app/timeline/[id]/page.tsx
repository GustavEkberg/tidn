import { Suspense } from 'react';
import { Effect, Match } from 'effect';
import { cookies } from 'next/headers';
import { NextEffect } from '@/lib/next-effect';
import { AppLayer } from '@/lib/layers';
import { getTimelineAccess } from '@/lib/core/timeline/get-timeline-access';
import { getSession } from '@/lib/services/auth/get-session';
import { getDays } from '@/lib/core/day/get-days';
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
      const session = yield* getSession();
      const { timeline, role } = yield* getTimelineAccess(id, 'viewer');
      const s3 = yield* S3;

      const result = yield* getDays({
        timelineId: id,
        order,
        limit: 20
      });

      // Collect all thumbnail S3 keys for batch URL generation
      const thumbnailKeys: Array<string> = [];
      for (const day of result.days) {
        for (const media of day.media) {
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

      // Serialize days for client component
      const serializedDays = result.days.map(d => ({
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
          createdAt: c.createdAt.toISOString()
        })),
        mediaComments: d.mediaComments.map(mc => ({
          id: mc.id,
          mediaId: mc.mediaId,
          text: mc.text,
          authorId: mc.authorId,
          authorName: mc.authorName,
          createdAt: mc.createdAt.toISOString()
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
          userId={session.user.id}
          initialDays={serializedDays}
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
