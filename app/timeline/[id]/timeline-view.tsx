'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from 'react';
import Link from 'next/link';
import { useQueryState } from 'nuqs';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteEventAction } from '@/lib/core/event/delete-event-action';
import { getEventsAction } from '@/lib/core/event/get-events-action';
import { getMediaUrlsAction } from '@/lib/core/media/get-media-urls-action';
import { searchParams } from './search-params';
import { UploadMedia, usePageDropZone, PageDropOverlay } from './upload-media';
import type { UploadMediaHandle } from './upload-media';
import { AddCommentEvent } from './add-comment-event';
import { EditEvent } from './edit-event';
import type { EditEventHandle } from './edit-event';

// ============================================================
// TYPES
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

function formatShortDate(dateStr: string): string {
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
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: '2-digit' })
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

/** Deterministic pseudo-random from string seed — for playful offsets */
function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return (Math.abs(hash) % 1000) / 1000;
}

// ============================================================
// LOCALSTORAGE: persisted focused date per timeline
// ============================================================

const FOCUSED_DATE_KEY_PREFIX = 'tidn:timeline-focus:';

function getSavedFocusDate(timelineId: string): string | null {
  try {
    return localStorage.getItem(`${FOCUSED_DATE_KEY_PREFIX}${timelineId}`);
  } catch {
    return null;
  }
}

function saveFocusDate(timelineId: string, date: string): void {
  try {
    localStorage.setItem(`${FOCUSED_DATE_KEY_PREFIX}${timelineId}`, date);
  } catch {
    // localStorage unavailable (SSR, quota, etc.) — ignore
  }
}

/**
 * Resolve initial focused index for the timeline:
 * 1. If localStorage has a saved date, find that date group
 * 2. Otherwise, default to the last group (latest date, rightmost)
 */
function resolveInitialFocusIndex(
  timelineId: string,
  dateGroups: ReadonlyArray<DateGroup>
): number {
  if (dateGroups.length === 0) return 0;

  const saved = getSavedFocusDate(timelineId);
  if (saved) {
    const idx = dateGroups.findIndex(g => g.date === saved);
    if (idx >= 0) return idx;
  }

  // Default: latest date (last in oldest-first order)
  return dateGroups.length - 1;
}

// ============================================================
// DATE COLUMN WIDTH
// ============================================================

/** Base width for date columns. Focused column gets multiplied. */
const DATE_COL_BASE = 220;
const DATE_COL_FOCUSED = 360;
const DATE_COL_MIN = 140;

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
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Media viewer: ${currentMedia.fileName}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 z-10 flex size-11 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 sm:top-4 sm:right-4 sm:size-10"
        aria-label="Close"
      >
        <X className="size-5" />
      </button>

      {canGoPrev && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onNavigate(state.currentIndex - 1);
          }}
          className="absolute left-2 z-10 flex size-11 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 sm:left-4 sm:size-10"
          aria-label="Previous"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}

      {canGoNext && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onNavigate(state.currentIndex + 1);
          }}
          className="absolute right-2 z-10 flex size-11 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 sm:right-4 sm:size-10"
          aria-label="Next"
        >
          <ChevronRight className="size-5" />
        </button>
      )}

      {state.media.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
          {state.currentIndex + 1} / {state.media.length}
        </div>
      )}

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
    </motion.div>
  );
}

// ============================================================
// MEDIA THUMBNAIL
// ============================================================

function MediaThumbnail({
  media,
  thumbnailUrl,
  onClick,
  size = 'normal'
}: {
  media: MediaItem;
  thumbnailUrl: string | undefined;
  onClick: (() => void) | undefined;
  size?: 'small' | 'normal';
}) {
  const sizeClass = size === 'small' ? 'size-14' : 'size-20';

  if (media.processingStatus === 'pending' || media.processingStatus === 'processing') {
    return (
      <div className={`${sizeClass} bg-muted flex shrink-0 items-center justify-center rounded-lg`}>
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      </div>
    );
  }

  if (media.processingStatus === 'failed' || !thumbnailUrl) {
    return (
      <div className={`${sizeClass} bg-muted flex shrink-0 items-center justify-center rounded-lg`}>
        <ImageIcon className="text-muted-foreground size-4" />
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={`${sizeClass} group/thumb relative shrink-0 overflow-hidden rounded-lg focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 outline-none`}
      whileHover={{ scale: 1.08, zIndex: 10 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      aria-label={`View ${media.type === 'video' ? 'video' : 'photo'}: ${media.fileName}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic signed URLs can't use next/image */}
      <img
        src={thumbnailUrl}
        alt={media.fileName}
        className="size-full object-cover"
        loading="lazy"
      />
      {media.type === 'video' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex size-6 items-center justify-center rounded-full bg-black/60">
            <Play className="size-3 fill-white text-white" />
          </div>
          {media.duration !== null && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-0.5 text-[9px] font-medium text-white">
              {formatDuration(media.duration)}
            </span>
          )}
        </div>
      )}
    </motion.button>
  );
}

// ============================================================
// EVENT CARD (floating, playful)
// ============================================================

function EventCard({
  event,
  thumbnailUrls,
  canEdit,
  onMediaClick,
  onEdit,
  onDelete,
  style,
  isFocused
}: {
  event: TimelineEvent;
  thumbnailUrls: Record<string, string>;
  canEdit: boolean;
  onMediaClick: (media: ReadonlyArray<MediaItem>, index: number) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  style?: { rotate?: number; y?: number };
  isFocused: boolean;
}) {
  const hasMedia = event.media.length > 0;
  const hasComment = event.comment !== null && event.comment.length > 0;
  const completedMedia = event.media.filter(m => m.processingStatus === 'completed');

  const thumbSize = isFocused ? 'normal' : 'small';

  return (
    <motion.div
      className="group/event bg-card relative rounded-xl border border-border/60 p-3 shadow-sm"
      initial={false}
      animate={{
        opacity: 1,
        y: style?.y ?? 0,
        rotate: style?.rotate ?? 0
      }}
      whileHover={{
        y: (style?.y ?? 0) - 4,
        scale: 1.03,
        rotate: 0,
        boxShadow: '0 8px 30px rgba(0,0,0,0.08)'
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      layout
    >
      {/* Edit/delete controls */}
      {canEdit && (
        <div className="absolute -top-2 -right-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/event:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            className="flex size-6 items-center justify-center rounded-full bg-background shadow-sm border border-border hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Edit event"
          >
            <Pencil className="size-3" />
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
              className="flex size-6 items-center justify-center rounded-full bg-background shadow-sm border border-border hover:bg-destructive/10 hover:text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Delete event"
            >
              <Trash2 className="size-3" />
            </span>
          </ConfirmDialog>
        </div>
      )}

      {/* Media thumbnails — horizontal row */}
      {hasMedia && (
        <div className="flex flex-wrap gap-1.5">
          {event.media.map(media => {
            const completedIndex = completedMedia.indexOf(media);
            return (
              <MediaThumbnail
                key={media.id}
                media={media}
                size={thumbSize}
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

      {/* Comment */}
      {hasComment && (
        <div className={`flex items-start gap-1.5 ${hasMedia ? 'mt-2' : ''}`}>
          {!hasMedia && (
            <MessageSquare className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          )}
          <p className="text-foreground/80 text-xs leading-relaxed line-clamp-3">{event.comment}</p>
        </div>
      )}
    </motion.div>
  );
}

// ============================================================
// DATE COLUMN (vertical cluster of events for one date)
// ============================================================

function DateColumn({
  group,
  thumbnailUrls,
  canEdit,
  isFocused,
  distanceFromCenter,
  onMediaClick,
  onEdit,
  onDelete
}: {
  group: DateGroup;
  thumbnailUrls: Record<string, string>;
  canEdit: boolean;
  isFocused: boolean;
  distanceFromCenter: number;
  onMediaClick: (media: ReadonlyArray<MediaItem>, index: number) => void;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (eventId: string) => Promise<void>;
}) {
  // Scale down columns further from center
  const scale = isFocused ? 1 : Math.max(0.7, 1 - distanceFromCenter * 0.12);
  const opacity = isFocused ? 1 : Math.max(0.5, 1 - distanceFromCenter * 0.15);
  const width = isFocused
    ? DATE_COL_FOCUSED
    : Math.max(DATE_COL_MIN, DATE_COL_BASE - distanceFromCenter * 30);

  return (
    <motion.div
      className="flex shrink-0 flex-col items-center gap-3"
      style={{ width }}
      animate={{ scale, opacity }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
    >
      {/* Date label */}
      <motion.div
        className={`rounded-full px-3 py-1 text-center transition-colors ${
          isFocused
            ? 'bg-foreground text-background font-semibold text-sm'
            : 'bg-muted text-muted-foreground text-xs font-medium'
        }`}
        layout
      >
        {isFocused ? formatEventDate(group.date) : formatShortDate(group.date)}
      </motion.div>

      {/* Event cluster */}
      <div className="flex w-full flex-col gap-2.5 px-2">
        {group.events.map(event => {
          // Playful offset: small rotation + y shift based on event id
          const rand = seededRandom(event.id);
          const rotate = (rand - 0.5) * 4; // -2 to +2 degrees
          const yOffset = (seededRandom(event.id + 'y') - 0.5) * 6; // -3 to +3px

          return (
            <EventCard
              key={event.id}
              event={event}
              thumbnailUrls={thumbnailUrls}
              canEdit={canEdit}
              isFocused={isFocused}
              onMediaClick={onMediaClick}
              onEdit={() => onEdit(event)}
              onDelete={() => onDelete(event.id)}
              style={{ rotate, y: yOffset }}
            />
          );
        })}
      </div>
    </motion.div>
  );
}

// ============================================================
// TIMELINE TRACK (thin line at bottom with date markers)
// ============================================================

function TimelineTrack({
  dateGroups,
  focusedIndex,
  onDateClick
}: {
  dateGroups: ReadonlyArray<DateGroup>;
  focusedIndex: number;
  onDateClick: (index: number) => void;
}) {
  return (
    <div className="relative flex items-center gap-0 px-8">
      {/* The line */}
      <div className="absolute top-1/2 left-4 right-4 h-px bg-border" />

      {dateGroups.map((group, idx) => {
        const isFocused = idx === focusedIndex;
        const eventCount = group.events.length;

        return (
          <button
            key={group.date}
            type="button"
            onClick={() => onDateClick(idx)}
            className="relative z-10 flex shrink-0 flex-col items-center gap-1 px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-label={`Go to ${formatEventDate(group.date)}`}
          >
            <motion.div
              className={`rounded-full ${
                isFocused ? 'size-3 bg-foreground' : 'size-2 bg-muted-foreground/40'
              }`}
              animate={{
                scale: isFocused ? 1.2 : 1,
                backgroundColor: isFocused ? undefined : undefined
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            />
            <span
              className={`whitespace-nowrap text-[10px] ${
                isFocused ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
              }`}
            >
              {formatShortDate(group.date)}
            </span>
            {eventCount > 1 && (
              <span className="text-muted-foreground/40 text-[9px]">{eventCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// EMPTY STATE
// ============================================================

function EmptyTimeline() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h2 className="text-lg font-medium">No events yet</h2>
      <p className="text-muted-foreground max-w-sm text-sm">
        Add photos, videos, or comments to start building this timeline.
      </p>
    </div>
  );
}

// ============================================================
// LAZY THUMBNAIL URL HOOK
// ============================================================

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

      if (fetchTimerRef.current !== null) {
        clearTimeout(fetchTimerRef.current);
      }

      fetchTimerRef.current = setTimeout(() => {
        const batch = Array.from(pendingKeysRef.current);
        if (batch.length === 0) return;

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
  const [events, setEvents] = useState<Array<TimelineEvent>>([...initialEvents]);
  const [cursor, setCursor] = useState<EventCursor | null>(initialCursor);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>(initialThumbnailUrls);
  const [isLoadingMore, startLoadMore] = useTransition();
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  // Resolve initial focus from localStorage or default to latest date
  const initialFocusIndex = useMemo(() => {
    const groups = groupEventsByDate(initialEvents);
    return resolveInitialFocusIndex(timeline.id, groups);
  }, [initialEvents, timeline.id]);

  const [focusedIndex, setFocusedIndex] = useState(initialFocusIndex);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const uploadRef = useRef<UploadMediaHandle>(null);
  const editEventRef = useRef<EditEventHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const canEdit = role === 'owner' || role === 'editor';

  const [order] = useQueryState(
    'order',
    searchParams.order.withOptions({ shallow: false, history: 'push' })
  );

  // Page-level drop zone
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

  // Lazy thumbnail URL fetching
  const requestThumbnailUrls = useLazyThumbnailUrls(timeline.id, thumbnailUrls, setThumbnailUrls);

  const loadMore = useCallback(() => {
    if (!cursor || isLoadingMore) return;

    startLoadMore(async () => {
      const result = await getEventsAction({
        timelineId: timeline.id,
        cursor,
        order: order ?? 'oldest',
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

  // Group events by date
  const dateGroups = useMemo(() => groupEventsByDate(events), [events]);

  // Position scroll then reveal — useLayoutEffect runs before browser paint.
  // We mutate the DOM directly (remove invisible class) to avoid a React re-render.
  useLayoutEffect(() => {
    if (dateGroups.length === 0) return;
    const container = scrollContainerRef.current;
    const el = columnRefs.current.get(focusedIndex);
    if (container && el) {
      const containerCenter = container.clientWidth / 2;
      const elCenter = el.offsetLeft + el.offsetWidth / 2;
      container.scrollLeft = elCenter - containerCenter;
    }
    // Reveal: remove invisible from scroll area and track
    scrollAreaRef.current?.classList.remove('invisible');
  }, [dateGroups.length, focusedIndex]);

  // Persist focused date to localStorage when it changes
  useEffect(() => {
    const group = dateGroups[focusedIndex];
    if (group) {
      saveFocusDate(timeline.id, group.date);
    }
  }, [focusedIndex, dateGroups, timeline.id]);

  // Request thumbnail URLs for all visible events
  useEffect(() => {
    const keysNeeded: Array<string> = [];
    // Request for focused group + neighbors
    const start = Math.max(0, focusedIndex - 3);
    const end = Math.min(dateGroups.length - 1, focusedIndex + 3);
    for (let i = start; i <= end; i++) {
      const group = dateGroups[i];
      if (group) {
        for (const event of group.events) {
          for (const media of event.media) {
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
    }

    if (keysNeeded.length > 0) {
      requestThumbnailUrls(keysNeeded);
    }
  }, [dateGroups, focusedIndex, thumbnailUrls, requestThumbnailUrls]);

  // Infinite scroll: load more when approaching the end
  useEffect(() => {
    if (!cursor) return;
    if (focusedIndex >= dateGroups.length - 3) {
      loadMore();
    }
  }, [focusedIndex, dateGroups.length, cursor, loadMore]);

  // Wheel -> horizontal scroll + focus tracking
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent) {
      if (!container) return;
      // Prevent vertical scroll, translate to horizontal
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      container.scrollLeft += delta;
    }

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Track focused index based on scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      const containerCenter = container.scrollLeft + container.clientWidth / 2;

      let closestIdx = 0;
      let closestDist = Infinity;

      columnRefs.current.forEach((el, idx) => {
        const colCenter = el.offsetLeft + el.offsetWidth / 2;
        const dist = Math.abs(colCenter - containerCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });

      setFocusedIndex(closestIdx);
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [dateGroups.length]);

  // Scroll to a specific date column
  const scrollToDate = useCallback((index: number) => {
    const container = scrollContainerRef.current;
    const el = columnRefs.current.get(index);
    if (!container || !el) return;

    const containerCenter = container.clientWidth / 2;
    const elCenter = el.offsetLeft + el.offsetWidth / 2;
    const target = elCenter - containerCenter;

    container.scrollTo({ left: target, behavior: 'smooth' });
  }, []);

  // Keyboard navigation: left/right arrows when not in lightbox
  useEffect(() => {
    if (lightbox) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        setFocusedIndex(prev => {
          const next = Math.max(0, prev - 1);
          requestAnimationFrame(() => scrollToDate(next));
          return next;
        });
      } else if (e.key === 'ArrowRight') {
        setFocusedIndex(prev => {
          const next = Math.min(dateGroups.length - 1, prev + 1);
          requestAnimationFrame(() => scrollToDate(next));
          return next;
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightbox, dateGroups.length, scrollToDate]);

  // Store column ref callback
  const setColumnRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      columnRefs.current.set(index, el);
    } else {
      columnRefs.current.delete(index);
    }
  }, []);

  return (
    <div className="flex h-dvh flex-col safe-pt">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon-sm">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2 sm:gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{timeline.name}</h1>
              <Badge variant={ROLE_VARIANTS[role]} className="shrink-0">
                {ROLE_LABELS[role]}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1">
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
          <p className="text-muted-foreground mt-2 ml-9 text-sm">{timeline.description}</p>
        )}
      </div>

      {/* Timeline content */}
      {events.length === 0 ? (
        <EmptyTimeline />
      ) : (
        <div ref={scrollAreaRef} className="invisible flex flex-1 flex-col overflow-hidden">
          {/* Horizontal scrolling event area */}
          <div
            ref={scrollContainerRef}
            className="flex flex-1 items-start overflow-x-auto overflow-y-hidden scrollbar-none"
          >
            {/* Left spacer: half viewport so first column can center */}
            <div className="w-[50vw] shrink-0" />

            {dateGroups.map((group, idx) => {
              const distanceFromCenter = Math.abs(idx - focusedIndex);

              return (
                <div
                  key={group.date}
                  ref={el => setColumnRef(idx, el)}
                  className="flex shrink-0 items-start pt-6"
                >
                  <DateColumn
                    group={group}
                    thumbnailUrls={thumbnailUrls}
                    canEdit={canEdit}
                    isFocused={idx === focusedIndex}
                    distanceFromCenter={distanceFromCenter}
                    onMediaClick={openLightbox}
                    onEdit={openEditEvent}
                    onDelete={handleDeleteEvent}
                  />
                </div>
              );
            })}

            {/* Loading indicator */}
            {cursor && (
              <div className="flex shrink-0 items-center justify-center px-8 pt-20">
                {isLoadingMore ? (
                  <Loader2 className="text-muted-foreground size-5 animate-spin" />
                ) : (
                  <Button variant="ghost" size="sm" onClick={loadMore}>
                    Load more
                  </Button>
                )}
              </div>
            )}

            {/* Right spacer */}
            <div className="w-[50vw] shrink-0" />
          </div>

          {/* Bottom timeline track */}
          <div className="shrink-0 overflow-x-auto overflow-y-hidden border-t border-border/50 py-3 scrollbar-none safe-pb">
            <TimelineTrack
              dateGroups={dateGroups}
              focusedIndex={focusedIndex}
              onDateClick={scrollToDate}
            />
          </div>
        </div>
      )}

      {/* Media lightbox */}
      <AnimatePresence>
        {lightbox && (
          <MediaLightbox
            timelineId={timeline.id}
            state={lightbox}
            onClose={closeLightbox}
            onNavigate={navigateLightbox}
          />
        )}
      </AnimatePresence>

      {/* Edit event dialog */}
      {canEdit && <EditEvent ref={editEventRef} />}

      {/* Page-level drop overlay */}
      {canEdit && <PageDropOverlay isDraggingOver={isDraggingOver} />}
    </div>
  );
}
