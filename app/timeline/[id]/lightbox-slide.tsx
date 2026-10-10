'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { motion, type MotionValue } from 'motion/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  media: {
    type: 'photo' | 'video';
    fileName: string;
    width: number | null;
    height: number | null;
  };
  url: string | undefined;
  thumbnailUrl?: string;
  onReady?: () => void;
  onRetry?: () => void;
  urlError?: boolean;
  imageTransform?: { scale: MotionValue<number>; x: MotionValue<number>; y: MotionValue<number> };
};

export function LightboxSlide({
  media,
  url,
  thumbnailUrl,
  onReady,
  onRetry,
  urlError,
  imageTransform
}: Props) {
  const [imageState, setImageState] = useState<
    { url: string; status: 'loaded' | 'error' } | undefined
  >();
  const loaded = imageState?.url === url && imageState?.status === 'loaded';
  const failed = urlError || (imageState?.url === url && imageState?.status === 'error');
  const imageClass = 'max-h-[90dvh] max-w-full rounded object-contain select-none sm:max-w-[90dvw]';
  return (
    <div className="relative flex size-full items-center justify-center px-2 sm:px-0">
      {media.type === 'photo' ? (
        <motion.div
          className="relative flex max-w-full items-center justify-center sm:max-w-[90dvw]"
          style={{
            ...imageTransform,
            width:
              media.width && media.height
                ? `min(${media.width}px, calc(90dvh * ${media.width / media.height}))`
                : undefined
          }}
        >
          {thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- Reuse the cached private thumbnail
            <img
              src={thumbnailUrl}
              alt=""
              aria-hidden="true"
              width={media.width ?? undefined}
              height={media.height ?? undefined}
              className={cn(imageClass, 'h-auto w-full', loaded && 'invisible')}
              draggable={false}
              data-lightbox-image
            />
          )}
          {url && (
            // eslint-disable-next-line @next/next/no-img-element -- Private media uses signed URLs
            <img
              key={url}
              src={url}
              alt={media.fileName}
              width={media.width ?? undefined}
              height={media.height ?? undefined}
              className={cn(
                imageClass,
                thumbnailUrl ? 'absolute inset-0 size-full' : 'h-auto w-full',
                !loaded && 'opacity-0'
              )}
              draggable={false}
              decoding="async"
              fetchPriority="high"
              data-lightbox-image
              ref={image => {
                if (image?.complete && image.naturalWidth > 0 && !loaded) {
                  setImageState({ url, status: 'loaded' });
                  onReady?.();
                }
              }}
              onLoad={() => {
                setImageState({ url, status: 'loaded' });
                onReady?.();
              }}
              onError={() => setImageState({ url, status: 'error' })}
            />
          )}
        </motion.div>
      ) : url ? (
        <video
          key={url}
          src={url}
          poster={thumbnailUrl}
          controls
          playsInline
          preload="metadata"
          data-lightbox-controls
          className={imageClass}
          onLoadedMetadata={() => {
            setImageState({ url, status: 'loaded' });
            onReady?.();
          }}
          onError={() => setImageState({ url, status: 'error' })}
        >
          Your browser does not support video playback.
        </video>
      ) : null}
      {failed ? (
        <div
          className="absolute bottom-24 flex flex-col items-center gap-2 rounded-lg bg-background p-3 text-foreground"
          data-lightbox-controls
          role="alert"
        >
          <p className="text-sm">
            Could not load {media.type === 'photo' ? 'full image' : 'video'}.
          </p>
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : !loaded ? (
        <div
          className="pointer-events-none absolute bottom-24 flex items-center gap-2 rounded-full bg-black/60 px-3 py-2 text-xs text-white"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading {media.type === 'photo' ? 'full image' : 'video'}…
        </div>
      ) : null}
    </div>
  );
}
