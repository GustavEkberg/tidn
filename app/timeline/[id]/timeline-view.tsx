'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useQueryState } from 'nuqs';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteEventAction } from '@/lib/core/event/delete-event-action';
import { getEventsAction } from '@/lib/core/event/get-events-action';
import { getMediaUrlsAction } from '@/lib/core/media/get-media-urls-action';
import { searchParams, sortOrderOptions } from './search-params';
import { UploadMedia, usePageDropZone, PageDropOverlay } from './upload-media';
import type { UploadMediaHandle } from './upload-media';
import { AddCommentEvent } from './add-comment-event';
import { EditEvent } from './edit-event';
import type { EditEventHandle } from './edit-event';

// ============================================================
// TYPES (local, matching serialized shapes from server)
// ============================================================

type TimelineRole = 'owner' | 'editor' | 'viewer';

type MediaItem = {
  id: string;
  type: 'photo' | 'video';
  s3Key: string;
  thumbnailS3Key: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
};

type TimelineEvent = {
  id: string;
  date: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  media: ReadonlyArray<MediaItem>;
};

type EventCursor = {
  readonly date: string;
  readonly id: string;
};

type DateGroup = {
  date: string;
  events: Array<TimelineEvent>;
};

/** A flat list item for the virtualizer — either a date header or an event card */
type VirtualListItem =
  | { readonly type: 'date-header'; readonly date: string }
  | { readonly type: 'event'; readonly event: TimelineEvent };

type Props = {
  timeline: {
    id: string;
    name: string;
    description: string | null;
  };
  role: TimelineRole;
  initialEvents: ReadonlyArray<TimelineEvent>;
  initialCursor: EventCursor | null;
  initialThumbnailUrls: Record<string, string>;
};

// ============================================================
// HELPERS
// ============================================================

const ROLE_LABELS: Record<TimelineRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer'
};

const ROLE_VARIANTS: Record<TimelineRole, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  editor: 'secondary',
  viewer: 'outline'
};

function formatEventDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === yesterday.getTime()) return 'Yesterday';

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function groupEventsByDate(events: ReadonlyArray<TimelineEvent>): Array<DateGroup> {
  const groups = new Map<string, Array<TimelineEvent>>();

  for (const event of events) {
    const existing = groups.get(event.date);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(event.date, [event]);
    }
  }

  return Array.from(groups.entries()).map(([date, groupEvents]) => ({
    date,
    events: groupEvents
  }));
}

/**
 * Flatten date groups into a linear list of virtual items: date headers + events.
 * This supports fine-grained virtualization — each item is measured independently.
 */
function flattenToVirtualItems(groups: ReadonlyArray<DateGroup>): Array<VirtualListItem> {
  const items: Array<VirtualListItem> = [];
  for (const group of groups) {
    items.push({ type: 'date-header', date: group.date });
    for (const event of group.events) {
      items.push({ type: 'event', event });
    }
  }
  return items;
}

// ============================================================
// MEDIA LIGHTBOX
// ============================================================

type LightboxState = {
  media: ReadonlyArray<MediaItem>;
  currentIndex: number;
} | null;

function MediaLightbox({
  timelineId,
  state,
  onClose,
  onNavigate
}: {
  timelineId: string;
  state: LightboxState;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const [fullSizeUrls, setFullSizeUrls] = useState<Record<string, string>>({});
  const fetchedKeysRef = useRef<Set<string>>(new Set());

  const currentMedia = state ? state.media[state.currentIndex] : null;
  const canGoPrev = state !== null && state.currentIndex > 0;
  const canGoNext = state !== null && state.currentIndex < state.media.length - 1;

  // Fetch full-size signed URL when current media changes
  useEffect(() => {
    if (!currentMedia || currentMedia.processingStatus !== 'completed') return;

    const key = currentMedia.s3Key;
    if (fetchedKeysRef.current.has(key)) return;

    fetchedKeysRef.current.add(key);

    getMediaUrlsAction(timelineId, [key]).then(result => {
      if (result._tag === 'Success') {
        setFullSizeUrls(prev => ({ ...prev, ...result.urls }));
      }
    });
  }, [currentMedia, timelineId]);

  // Keyboard navigation + body scroll lock
  useEffect(() => {
    if (!state) return;

    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && canGoPrev) {
        onNavigate(state.currentIndex - 1);
      } else if (e.key === 'ArrowRight' && canGoNext) {
        onNavigate(state.currentIndex + 1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [state, canGoPrev, canGoNext, onClose, onNavigate]);

  if (!state || !currentMedia) return null;

  const fullSizeUrl = fullSizeUrls[currentMedia.s3Key];
  const isLoading = !fullSizeUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Media viewer: ${currentMedia.fileName}`}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        aria-label="Close"
      >
        <X className="size-5" />
      </button>

      {/* Navigation: Previous */}
      {canGoPrev && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onNavigate(state.currentIndex - 1);
          }}
          className="absolute left-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          aria-label="Previous"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}

      {/* Navigation: Next */}
      {canGoNext && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onNavigate(state.currentIndex + 1);
          }}
          className="absolute right-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
          aria-label="Next"
        >
          <ChevronRight className="size-5" />
        </button>
      )}

      {/* Media counter */}
      {state.media.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
          {state.currentIndex + 1} / {state.media.length}
        </div>
      )}

      {/* Content */}
      <div
        className="flex max-h-[90dvh] max-w-[90dvw] items-center justify-center"
        onClick={e => e.stopPropagation()}
      >
        {isLoading || !fullSizeUrl ? (
          <Loader2 className="size-8 animate-spin text-white" />
        ) : currentMedia.type === 'photo' ? (
          /* eslint-disable-next-line @next/next/no-img-element -- Dynamic signed URLs can't use next/image */
          <img
            src={fullSizeUrl}
            alt={currentMedia.fileName}
            className="max-h-[90dvh] max-w-[90dvw] rounded object-contain"
          />
        ) : (
          <video
            src={fullSizeUrl}
            controls
            autoPlay
            className="max-h-[90dvh] max-w-[90dvw] rounded"
          >
            Your browser does not support video playback.
          </video>
        )}
      </div>
    </div>
  );
}

// ============================================================
// COMPONENTS
// ============================================================

function MediaThumbnail({
  media,
  thumbnailUrl,
  onClick
}: {
  media: MediaItem;
  thumbnailUrl: string | undefined;
  onClick: (() => void) | undefined;
}) {
  if (media.processingStatus === 'pending' || media.processingStatus === 'processing') {
    return (
      <div className="bg-muted flex aspect-square items-center justify-center rounded-lg">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (media.processingStatus === 'failed' || !thumbnailUrl) {
    return (
      <div className="bg-muted flex aspect-square items-center justify-center rounded-lg">
        <ImageIcon className="text-muted-foreground size-5" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-square overflow-hidden rounded-lg focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 outline-none"
      aria-label={`View ${media.type === 'video' ? 'video' : 'photo'}: ${media.fileName}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic signed URLs can't use next/image */}
      <img
        src={thumbnailUrl}
        alt={media.fileName}
        className="size-full object-cover transition-transform group-hover:scale-105"
        loading="lazy"
      />
      {media.type === 'video' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex size-8 items-center justify-center rounded-full bg-black/60 transition-colors group-hover:bg-black/80">
            <Play className="size-4 fill-white text-white" />
          </div>
          {media.duration !== null && (
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">
              {formatDuration(media.duration)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function EventCard({
  event,
  thumbnailUrls,
  canEdit,
  onMediaClick,
  onEdit,
  onDelete
}: {
  event: TimelineEvent;
  thumbnailUrls: Record<string, string>;
  canEdit: boolean;
  onMediaClick: (media: ReadonlyArray<MediaItem>, index: number) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const hasMedia = event.media.length > 0;
  const hasComment = event.comment !== null && event.comment.length > 0;

  // Only completed media is clickable
  const completedMedia = event.media.filter(m => m.processingStatus === 'completed');

  return (
    <div className="group/event relative flex flex-col gap-2">
      {/* Action buttons — visible on hover/focus for editors/owners */}
      {canEdit && (
        <div className="absolute -top-1 -right-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/event:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            className="flex size-7 items-center justify-center rounded-full bg-background shadow-sm border border-border hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Edit event"
          >
            <Pencil className="size-3.5" />
          </button>
          <ConfirmDialog
            title="Delete event"
            description="This event and all its media will be permanently deleted. This action cannot be undone."
            actionLabel="Delete"
            pendingLabel="Deleting..."
            variant="destructive"
            size="sm"
            onConfirm={onDelete}
            trigger={<button type="button" />}
          >
            <span
              className="flex size-7 items-center justify-center rounded-full bg-background shadow-sm border border-border hover:bg-destructive/10 hover:text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Delete event"
            >
              <Trash2 className="size-3.5" />
            </span>
          </ConfirmDialog>
        </div>
      )}
      {hasMedia && (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
          {event.media.map(media => {
            const completedIndex = completedMedia.indexOf(media);
            return (
              <MediaThumbnail
                key={media.id}
                media={media}
                thumbnailUrl={
                  media.thumbnailS3Key ? thumbnailUrls[media.thumbnailS3Key] : undefined
                }
                onClick={
                  completedIndex >= 0
                    ? () => onMediaClick(completedMedia, completedIndex)
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
      {hasComment && (
        <div className="flex items-start gap-2">
          {!hasMedia && <MessageSquare className="text-muted-foreground mt-0.5 size-4 shrink-0" />}
          <p className="text-sm leading-relaxed">{event.comment}</p>
        </div>
      )}
    </div>
  );
}

function EmptyTimeline() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <h2 className="text-lg font-medium">No events yet</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        Add photos, videos, or comments to start building this timeline.
      </p>
    </div>
  );
}

// ============================================================
// VIRTUALIZED LIST ITEM RENDERERS
// ============================================================

function VirtualDateHeader({ date }: { date: string }) {
  return (
    <h3 className="text-muted-foreground pt-6 pb-2 text-xs font-medium uppercase tracking-wider first:pt-0">
      {formatEventDate(date)}
    </h3>
  );
}

function VirtualEventItem({
  event,
  thumbnailUrls,
  canEdit,
  onMediaClick,
  onEdit,
  onDelete
}: {
  event: TimelineEvent;
  thumbnailUrls: Record<string, string>;
  canEdit: boolean;
  onMediaClick: (media: ReadonlyArray<MediaItem>, index: number) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="pb-4">
      <EventCard
        event={event}
        thumbnailUrls={thumbnailUrls}
        canEdit={canEdit}
        onMediaClick={onMediaClick}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

// ============================================================
// LAZY URL FETCHER HOOK
// ============================================================

/**
 * Lazily fetches signed thumbnail URLs for events as they enter the viewport.
 * Batches requests to avoid per-item network calls.
 */
function useLazyThumbnailUrls(
  timelineId: string,
  thumbnailUrls: Record<string, string>,
  setThumbnailUrls: React.Dispatch<React.SetStateAction<Record<string, string>>>
) {
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestUrls = useCallback(
    (keys: ReadonlyArray<string>) => {
      let hasNew = false;
      for (const key of keys) {
        if (!(key in thumbnailUrls) && !pendingKeysRef.current.has(key)) {
          pendingKeysRef.current.add(key);
          hasNew = true;
        }
      }

      if (!hasNew) return;

      // Debounce: batch multiple requestUrls calls within 50ms
      if (fetchTimerRef.current !== null) {
        clearTimeout(fetchTimerRef.current);
      }

      fetchTimerRef.current = setTimeout(() => {
        const batch = Array.from(pendingKeysRef.current);
        if (batch.length === 0) return;

        // Clear pending set — these are now in-flight
        pendingKeysRef.current = new Set();

        getMediaUrlsAction(timelineId, batch).then(result => {
          if (result._tag === 'Success') {
            setThumbnailUrls(prev => ({ ...prev, ...result.urls }));
          }
        });
      }, 50);
    },
    [timelineId, thumbnailUrls, setThumbnailUrls]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (fetchTimerRef.current !== null) {
        clearTimeout(fetchTimerRef.current);
      }
    };
  }, []);

  return requestUrls;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function TimelineView({
  timeline,
  role,
  initialEvents,
  initialCursor,
  initialThumbnailUrls
}: Props) {
  // Component is keyed by sort order, so it remounts on order change.
  // State is initialized from server props and extended via "load more".
  const [events, setEvents] = useState<Array<TimelineEvent>>([...initialEvents]);
  const [cursor, setCursor] = useState<EventCursor | null>(initialCursor);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>(initialThumbnailUrls);
  const [isLoadingMore, startLoadMore] = useTransition();
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const uploadRef = useRef<UploadMediaHandle>(null);
  const editEventRef = useRef<EditEventHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const canEdit = role === 'owner' || role === 'editor';

  // Page-level drop zone — drops open upload dialog with files
  const handlePageDrop = useCallback((files: ReadonlyArray<File>) => {
    uploadRef.current?.openWithFiles(files);
  }, []);
  const isDraggingOver = usePageDropZone(handlePageDrop, canEdit);

  const openEditEvent = useCallback(
    (event: TimelineEvent) => {
      editEventRef.current?.open(event, thumbnailUrls);
    },
    [thumbnailUrls]
  );

  const handleDeleteEvent = useCallback(async (eventId: string) => {
    const result = await deleteEventAction({ id: eventId });
    if (result._tag === 'Error') {
      toast.error(result.message);
      return;
    }
    setEvents(prev => prev.filter(e => e.id !== eventId));
    toast.success('Event deleted');
  }, []);

  const openLightbox = useCallback((media: ReadonlyArray<MediaItem>, index: number) => {
    setLightbox({ media, currentIndex: index });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  const navigateLightbox = useCallback((index: number) => {
    setLightbox(prev => (prev ? { ...prev, currentIndex: index } : null));
  }, []);

  const [order, setOrder] = useQueryState(
    'order',
    searchParams.order.withOptions({ shallow: false, history: 'push' })
  );

  // Lazy thumbnail URL fetching for virtualized items
  const requestThumbnailUrls = useLazyThumbnailUrls(timeline.id, thumbnailUrls, setThumbnailUrls);

  const loadMore = useCallback(() => {
    if (!cursor || isLoadingMore) return;

    startLoadMore(async () => {
      const result = await getEventsAction({
        timelineId: timeline.id,
        cursor,
        order: order ?? 'newest',
        limit: 20
      });

      if (result._tag === 'Error') {
        toast.error(result.message);
        return;
      }

      setEvents(prev => [...prev, ...result.events]);
      setCursor(result.nextCursor);
    });
  }, [cursor, isLoadingMore, timeline.id, order]);

  // Build virtualized flat list: [date-header, event, event, date-header, event, ...]
  const dateGroups = groupEventsByDate(events);
  const virtualItems = flattenToVirtualItems(dateGroups);

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is not React Compiler compatible; virtualization benefits outweigh memoization skip
  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: index => {
      const item = virtualItems[index];
      // date-header: ~48px (pt-6 + text + pb-2)
      // event: ~200px estimate (varies by media count + comment)
      return item?.type === 'date-header' ? 48 : 200;
    },
    overscan: 5
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Request thumbnail URLs for visible events (lazy loading)
  useEffect(() => {
    if (virtualRows.length === 0) return;

    const keysNeeded: Array<string> = [];
    for (const vRow of virtualRows) {
      const item = virtualItems[vRow.index];
      if (item?.type === 'event') {
        for (const media of item.event.media) {
          if (
            media.thumbnailS3Key &&
            media.processingStatus === 'completed' &&
            !(media.thumbnailS3Key in thumbnailUrls)
          ) {
            keysNeeded.push(media.thumbnailS3Key);
          }
        }
      }
    }

    if (keysNeeded.length > 0) {
      requestThumbnailUrls(keysNeeded);
    }
  }, [virtualRows, virtualItems, thumbnailUrls, requestThumbnailUrls]);

  // Infinite scroll: detect when last virtual row is near bottom
  useEffect(() => {
    if (!cursor) return;

    const lastRow = virtualRows[virtualRows.length - 1];
    if (!lastRow) return;

    // If the last rendered virtual item is within 5 items of the end, load more
    if (lastRow.index >= virtualItems.length - 5) {
      loadMore();
    }
  }, [virtualRows, virtualItems.length, cursor, loadMore]);

  return (
    <div className="flex h-dvh flex-col">
      {/* Header — outside scroll container */}
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-6 sm:px-6">
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="icon-sm">
                <ArrowLeft className="size-4" />
              </Button>
            </Link>
            <div className="flex flex-1 items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{timeline.name}</h1>
                <Badge variant={ROLE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>
              </div>
              <div className="flex items-center gap-1">
                {canEdit && <AddCommentEvent timelineId={timeline.id} />}
                {canEdit && <UploadMedia timelineId={timeline.id} ref={uploadRef} />}
                {role === 'owner' && (
                  <Link href={`/timeline/${timeline.id}/settings`}>
                    <Button variant="ghost" size="icon-sm">
                      <Settings className="size-4" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
          {timeline.description && (
            <p className="text-muted-foreground text-sm">{timeline.description}</p>
          )}
        </div>

        {/* Sort control */}
        {events.length > 0 && (
          <div className="mb-4 flex items-center justify-end gap-2">
            <ArrowUpDown className="text-muted-foreground size-3.5" />
            <Select
              value={order ?? 'newest'}
              onValueChange={val => {
                if (val === null) return;
                const sortOptions: ReadonlySet<string> = new Set(sortOrderOptions);
                if (sortOptions.has(val)) {
                  setOrder(val === 'oldest' ? 'oldest' : 'newest');
                }
              }}
            >
              <SelectTrigger size="sm" className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Virtualized scroll container */}
      {events.length === 0 ? (
        <EmptyTimeline />
      ) : (
        <div ref={scrollContainerRef} className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {virtualRows.map(virtualRow => {
                const item = virtualItems[virtualRow.index];
                if (!item) return null;

                return (
                  <div
                    key={virtualRow.key}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {item.type === 'date-header' ? (
                      <VirtualDateHeader date={item.date} />
                    ) : (
                      <VirtualEventItem
                        event={item.event}
                        thumbnailUrls={thumbnailUrls}
                        canEdit={canEdit}
                        onMediaClick={openLightbox}
                        onEdit={() => openEditEvent(item.event)}
                        onDelete={() => handleDeleteEvent(item.event.id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Load more indicator */}
            {cursor && (
              <div className="flex justify-center py-8">
                {isLoadingMore ? (
                  <Loader2 className="text-muted-foreground size-5 animate-spin" />
                ) : (
                  <Button variant="ghost" size="sm" onClick={loadMore}>
                    Load more
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Media lightbox */}
      <MediaLightbox
        timelineId={timeline.id}
        state={lightbox}
        onClose={closeLightbox}
        onNavigate={navigateLightbox}
      />

      {/* Edit event dialog */}
      {canEdit && <EditEvent ref={editEventRef} />}

      {/* Page-level drop overlay */}
      {canEdit && <PageDropOverlay isDraggingOver={isDraggingOver} />}
    </div>
  );
}
