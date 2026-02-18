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
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Play,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteDayAction } from '@/lib/core/day/delete-day-action';
import { deleteMediaAction } from '@/lib/core/media/delete-media-action';
import { toggleMediaPrivacyAction } from '@/lib/core/media/toggle-media-privacy-action';
import { getDaysAction } from '@/lib/core/day/get-days-action';
import { getMediaUrlsAction } from '@/lib/core/media/get-media-urls-action';
import { searchParams } from './search-params';
import { UploadMedia, usePageDropZone, PageDropOverlay } from './upload-media';
import type { UploadMediaHandle } from './upload-media';
import { AddDayComment } from './add-day-comment';
import { EditDay } from './edit-day';
import type { EditDayHandle } from './edit-day';
import { TimelineRibbon } from './timeline-ribbon';

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
  isPrivate: boolean;
  createdAt: string;
};

type DayComment = {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
};

type TimelineDay = {
  id: string;
  date: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  media: ReadonlyArray<MediaItem>;
  comments: ReadonlyArray<DayComment>;
};

type DayCursor = {
  readonly date: string;
  readonly id: string;
};

type Props = {
  timeline: {
    id: string;
    name: string;
    description: string | null;
  };
  role: TimelineRole;
  initialDays: ReadonlyArray<TimelineDay>;
  initialCursor: DayCursor | null;
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

function parseDateStr(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  const sameYear = date.getFullYear() === now.getFullYear();
  return { date, today, now, diffDays, sameYear, day, month, year };
}

function formatRelativeLabel(dateStr: string): string {
  const { diffDays } = parseDateStr(dateStr);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === -1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) return `${diffDays}d ago`;
  if (diffDays > 7 && diffDays <= 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < -1 && diffDays >= -7) return `in ${Math.abs(diffDays)}d`;
  return '';
}

function formatShortDate(dateStr: string): string {
  const { date, diffDays, sameYear } = parseDateStr(dateStr);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: '2-digit' })
  });
}

/** Focused date: structured parts for richer display */
function formatDateParts(dateStr: string): {
  dayNum: string;
  weekday: string;
  monthYear: string;
  relative: string;
} {
  const { date, diffDays, sameYear } = parseDateStr(dateStr);
  const dayNum = date.getDate().toString();
  const weekday =
    diffDays === 0
      ? 'Today'
      : diffDays === 1
        ? 'Yesterday'
        : date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthYear = date.toLocaleDateString('en-US', {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' })
  });
  const relative = formatRelativeLabel(dateStr);
  return { dayNum, weekday, monthYear, relative };
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// No grouping needed — each day is unique per (timeline, date)

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
// LOCALSTORAGE: last active timeline (for redirect on revisit)
// ============================================================

const LAST_TIMELINE_KEY = 'tidn:last-timeline';

function saveLastTimelineId(timelineId: string): void {
  try {
    localStorage.setItem(LAST_TIMELINE_KEY, timelineId);
  } catch {
    // localStorage unavailable (SSR, quota, etc.) — ignore
  }
}

// ============================================================
// LOCALSTORAGE: persisted focused date per timeline
// ============================================================

const FOCUSED_DATE_KEY_PREFIX = 'tidn:timeline-focus:';

/** Sentinel value: when focused date is "today", persist this instead of a
 *  literal date so that revisiting tomorrow lands on the new today. */
const TODAY_SENTINEL = 'today';

function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getSavedFocusDate(timelineId: string): string | null {
  try {
    const raw = localStorage.getItem(`${FOCUSED_DATE_KEY_PREFIX}${timelineId}`);
    if (raw === TODAY_SENTINEL) return getTodayDateStr();
    return raw;
  } catch {
    return null;
  }
}

function saveFocusDate(timelineId: string, date: string): void {
  try {
    const value = date === getTodayDateStr() ? TODAY_SENTINEL : date;
    localStorage.setItem(`${FOCUSED_DATE_KEY_PREFIX}${timelineId}`, value);
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
  dateGroups: ReadonlyArray<TimelineDay>
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

/** Swipe distance threshold (fraction of viewport) to trigger navigation */
const SWIPE_FRACTION = 0.2;
/** Vertical drag distance (px) to dismiss lightbox */
const DISMISS_DISTANCE = 120;

/** Render a single slide (photo, video, or loading state) */
function LightboxSlide({ media, url }: { media: MediaItem; url: string | undefined }) {
  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-white" />
      </div>
    );
  }

  if (media.type === 'photo') {
    return (
      <div className="flex h-full w-full items-center justify-center px-2 sm:px-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic signed URLs can't use next/image */}
        <img
          src={url}
          alt={media.fileName}
          className="max-h-[90dvh] max-w-full rounded object-contain select-none sm:max-w-[90dvw]"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center px-2 sm:px-0">
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className="max-h-[90dvh] max-w-full rounded sm:max-w-[90dvw]"
      >
        Your browser does not support video playback.
      </video>
    </div>
  );
}

function MediaLightbox({
  timelineId,
  state,
  canEdit,
  onClose,
  onNavigate,
  onDelete,
  onTogglePrivacy
}: {
  timelineId: string;
  state: LightboxState;
  canEdit: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete: (mediaId: string) => Promise<void>;
  onTogglePrivacy: (mediaId: string, isPrivate: boolean) => void;
}) {
  const [fullSizeUrls, setFullSizeUrls] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPrivacyConfirm, setShowPrivacyConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  const isDraggingRef = useRef(false);

  // Track drag direction to lock axis (horizontal vs vertical)
  const dragAxisRef = useRef<'x' | 'y' | null>(null);

  // Motion values for the slide strip and vertical dismiss
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const bgOpacity = useTransform(dragY, [-200, 0, 200], [0.4, 1, 0.4]);

  const currentMedia = state ? state.media[state.currentIndex] : null;
  const canGoPrev = state !== null && state.currentIndex > 0;
  const canGoNext = state !== null && state.currentIndex < state.media.length - 1;

  // Build the visible slides: prev + current + next
  const visibleSlides = useMemo(() => {
    if (!state) return [];
    const slides: Array<{ media: MediaItem; offset: number }> = [];
    for (let delta = -1; delta <= 1; delta++) {
      const idx = state.currentIndex + delta;
      if (idx >= 0 && idx < state.media.length) {
        slides.push({ media: state.media[idx], offset: delta });
      }
    }
    return slides;
  }, [state]);

  // Fetch full-size URL for current + prefetch neighbors
  useEffect(() => {
    if (!state) return;

    const keysToFetch: Array<string> = [];
    const indices = [state.currentIndex - 1, state.currentIndex, state.currentIndex + 1];
    for (const idx of indices) {
      if (idx < 0 || idx >= state.media.length) continue;
      const m = state.media[idx];
      if (m.processingStatus !== 'completed') continue;
      if (fetchedKeysRef.current.has(m.s3Key)) continue;
      fetchedKeysRef.current.add(m.s3Key);
      keysToFetch.push(m.s3Key);
    }

    if (keysToFetch.length > 0) {
      getMediaUrlsAction(timelineId, keysToFetch).then(result => {
        if (result._tag === 'Success') {
          setFullSizeUrls(prev => ({ ...prev, ...result.urls }));
        }
      });
    }
  }, [state, timelineId]);

  // Reset delete confirm when navigating or closing
  const isOpen = state !== null;
  useEffect(() => {
    setShowDeleteConfirm(false);
    setIsDeleting(false);
  }, [state?.currentIndex, isOpen]);

  // Show controls when lightbox opens; reset drag values on index change
  useEffect(() => {
    setControlsVisible(true);
    dragX.jump(0);
    dragY.jump(0);
    dragAxisRef.current = null;
  }, [isOpen, state?.currentIndex, dragX, dragY]);

  const handleDeleteMedia = useCallback(async () => {
    if (!currentMedia || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(currentMedia.id);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [currentMedia, isDeleting, onDelete]);

  // Keyboard navigation
  useEffect(() => {
    if (!state) return;

    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (showDeleteConfirm) return;
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
  }, [state, canGoPrev, canGoNext, onClose, onNavigate, showDeleteConfirm]);

  // Touch/pointer gesture handling — manual for axis locking
  useEffect(() => {
    if (!state) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onPointerDown(e: PointerEvent) {
      // Don't capture on controls or when confirm is open
      const target = e.target;
      if (target instanceof HTMLElement && target.closest('[data-lightbox-controls]')) return;

      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
      dragAxisRef.current = null;
    }

    function onPointerMove(e: PointerEvent) {
      if (!tracking) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Lock axis after 8px of movement
      if (dragAxisRef.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        dragAxisRef.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        isDraggingRef.current = true;
      }

      if (dragAxisRef.current === 'x') {
        // Apply resistance at edges
        let clampedDx = dx;
        if ((!canGoPrev && dx > 0) || (!canGoNext && dx < 0)) {
          clampedDx = dx * 0.15; // Rubber-band effect at edges
        }
        dragX.set(clampedDx);
        dragY.set(0);
      } else if (dragAxisRef.current === 'y') {
        dragX.set(0);
        dragY.set(dy);
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!tracking) return;
      tracking = false;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const axis = dragAxisRef.current;

      if (axis === 'y' && Math.abs(dy) > DISMISS_DISTANCE) {
        // Dismiss
        onClose();
        return;
      }

      const vw = window.innerWidth;
      if (axis === 'x') {
        const swipedLeft = dx < -(vw * SWIPE_FRACTION);
        const swipedRight = dx > vw * SWIPE_FRACTION;

        if (swipedLeft && canGoNext) {
          // Animate strip off-screen then navigate
          animate(dragX, -vw, {
            type: 'spring',
            stiffness: 300,
            damping: 30,
            onComplete: () => onNavigate(state.currentIndex + 1)
          });
          return;
        } else if (swipedRight && canGoPrev) {
          animate(dragX, vw, {
            type: 'spring',
            stiffness: 300,
            damping: 30,
            onComplete: () => onNavigate(state.currentIndex - 1)
          });
          return;
        }
      }

      // Not a valid tap if we were dragging
      if (!isDraggingRef.current) {
        // Tap — toggle controls on touch, close on desktop
        if ('ontouchstart' in window) {
          setControlsVisible(prev => !prev);
        } else {
          onClose();
        }
      }

      // Spring back to center
      animate(dragX, 0, { type: 'spring', stiffness: 300, damping: 30 });
      animate(dragY, 0, { type: 'spring', stiffness: 300, damping: 30 });

      isDraggingRef.current = false;
      dragAxisRef.current = null;
    }

    // Use the lightbox container
    const el = document.getElementById('lightbox-gesture-area');
    if (!el) return;

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [state, canGoPrev, canGoNext, dragX, dragY, onClose, onNavigate]);

  if (!state || !currentMedia) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-hidden bg-black touch-none select-none"
      style={{ opacity: bgOpacity }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Media viewer: ${currentMedia.fileName}`}
    >
      {/* Controls overlay — auto-hides on mobile tap */}
      <AnimatePresence>
        {controlsVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-0 z-20"
            data-lightbox-controls
          >
            {/* Top-right controls */}
            <div className="pointer-events-auto absolute top-16 right-3 flex items-center gap-2 sm:top-4 sm:right-4">
              {canEdit && currentMedia && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setShowPrivacyConfirm(true);
                  }}
                  className={`flex size-11 items-center justify-center rounded-full backdrop-blur-sm transition-colors sm:size-10 ${
                    currentMedia.isPrivate
                      ? 'bg-amber-600/70 text-white hover:bg-amber-600/90'
                      : 'bg-black/50 text-white hover:bg-black/70'
                  }`}
                  aria-label={currentMedia.isPrivate ? 'Make public' : 'Make private'}
                >
                  {currentMedia.isPrivate ? (
                    <Lock className="size-5" />
                  ) : (
                    <LockOpen className="size-5" />
                  )}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setShowDeleteConfirm(true);
                  }}
                  disabled={isDeleting}
                  className="flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-red-600/80 sm:size-10"
                  aria-label="Delete media"
                >
                  {isDeleting ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Trash2 className="size-5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onClose();
                }}
                className="flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:size-10"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Desktop prev/next arrows — hidden on mobile */}
            {canGoPrev && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onNavigate(state.currentIndex - 1);
                }}
                className="pointer-events-auto absolute left-4 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:flex sm:size-10"
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
                className="pointer-events-auto absolute right-4 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:flex sm:size-10"
                aria-label="Next"
              >
                <ChevronRight className="size-5" />
              </button>
            )}

            {/* Bottom indicators */}
            {state.media.length > 1 && (
              <div className="pointer-events-auto absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/50 px-3 py-2 backdrop-blur-sm sm:bottom-4 sm:gap-0 sm:px-3 sm:py-1">
                {/* Dot indicators for mobile */}
                <div className="flex items-center gap-1.5 sm:hidden">
                  {state.media.length <= 10 ? (
                    state.media.map((m, i) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onNavigate(i);
                        }}
                        className={`rounded-full transition-all ${
                          i === state.currentIndex ? 'size-2 bg-white' : 'size-1.5 bg-white/40'
                        }`}
                        aria-label={`Go to item ${i + 1}`}
                      />
                    ))
                  ) : (
                    <span className="text-xs text-white">
                      {state.currentIndex + 1} / {state.media.length}
                    </span>
                  )}
                </div>
                {/* Counter for desktop */}
                <span className="hidden text-xs text-white sm:block">
                  {state.currentIndex + 1} / {state.media.length}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <ConfirmDialog
        title="Delete media"
        description="This photo/video will be permanently deleted. This action cannot be undone."
        actionLabel="Delete"
        pendingLabel="Deleting..."
        variant="destructive"
        size="sm"
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        onConfirm={handleDeleteMedia}
      />

      {/* Privacy toggle confirmation */}
      {currentMedia && (
        <ConfirmDialog
          title={currentMedia.isPrivate ? 'Make public' : 'Make private'}
          description={
            currentMedia.isPrivate
              ? 'This media will become visible to all timeline members.'
              : 'This media will be hidden from viewers. Only editors and the owner will see it.'
          }
          actionLabel={currentMedia.isPrivate ? 'Make public' : 'Make private'}
          variant="default"
          size="sm"
          open={showPrivacyConfirm}
          onOpenChange={setShowPrivacyConfirm}
          onConfirm={() => onTogglePrivacy(currentMedia.id, !currentMedia.isPrivate)}
        />
      )}

      {/* Swipeable slide strip: renders prev + current + next side-by-side */}
      <motion.div
        id="lightbox-gesture-area"
        className="relative h-full w-full"
        style={{ x: dragX, y: dragY }}
      >
        {visibleSlides.map(({ media, offset }) => (
          <div
            key={media.id}
            className="absolute inset-0 flex items-center justify-center"
            style={{ transform: `translateX(${offset * 100}%)` }}
          >
            <LightboxSlide media={media} url={fullSizeUrls[media.s3Key]} />
          </div>
        ))}
      </motion.div>
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
  onDelete,
  size = 'normal',
  showPrivateBadge = false
}: {
  media: MediaItem;
  thumbnailUrl: string | undefined;
  onClick: (() => void) | undefined;
  /** Delete handler — shown as overlay button on failed/stuck media */
  onDelete?: ((mediaId: string) => void) | undefined;
  size?: 'small' | 'normal';
  /** Show a lock badge when the media is private (editors only) */
  showPrivateBadge?: boolean;
}) {
  const sizeClass = size === 'small' ? 'size-14' : 'size-20';

  const privateBadge =
    showPrivateBadge && media.isPrivate ? (
      <div className="absolute top-0.5 left-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-black/60">
        <Lock className="size-2.5 text-white" />
      </div>
    ) : null;

  if (media.processingStatus === 'pending' || media.processingStatus === 'processing') {
    return (
      <div
        className={`${sizeClass} bg-muted group/thumb relative flex shrink-0 items-center justify-center rounded-lg`}
      >
        {privateBadge}
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
        {onDelete && (
          <ConfirmDialog
            title="Delete media"
            description="This photo/video will be permanently deleted. This action cannot be undone."
            actionLabel="Delete"
            variant="destructive"
            size="sm"
            onConfirm={() => onDelete(media.id)}
            trigger={
              <button
                type="button"
                onClick={e => e.stopPropagation()}
                className="absolute top-0.5 right-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100"
                aria-label={`Delete ${media.fileName}`}
              >
                <X className="size-2.5" />
              </button>
            }
          />
        )}
      </div>
    );
  }

  if (media.processingStatus === 'failed' || !thumbnailUrl) {
    return (
      <div
        className={`${sizeClass} bg-muted group/thumb relative flex shrink-0 items-center justify-center rounded-lg`}
      >
        {privateBadge}
        <ImageIcon className="text-muted-foreground size-4" />
        {onDelete && (
          <ConfirmDialog
            title="Delete media"
            description="This photo/video will be permanently deleted. This action cannot be undone."
            actionLabel="Delete"
            variant="destructive"
            size="sm"
            onConfirm={() => onDelete(media.id)}
            trigger={
              <button
                type="button"
                onClick={e => e.stopPropagation()}
                className="absolute top-0.5 right-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100"
                aria-label={`Delete ${media.fileName}`}
              >
                <X className="size-2.5" />
              </button>
            }
          />
        )}
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
      aria-label={`View ${media.type === 'video' ? 'video' : 'photo'}: ${media.fileName}${media.isPrivate ? ' (private)' : ''}`}
    >
      {privateBadge}
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
// CURVED TITLE (arced text above date)
// ============================================================

const MAX_CHARS_PER_LINE = 18;

function splitIntoLines(text: string): Array<string> {
  const words = text.split(/\s+/);
  const lines: Array<string> = [];
  let current = '';
  for (const word of words) {
    if (current.length > 0 && current.length + 1 + word.length > MAX_CHARS_PER_LINE) {
      lines.push(current);
      current = word;
    } else {
      current = current.length > 0 ? `${current} ${word}` : word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function CurvedTitle({ text, dayId }: { text: string; dayId: string }) {
  const lines = splitIntoLines(text);
  const lineHeight = 34;
  const totalHeight = lines.length * lineHeight + 24;
  const svgW = 440;
  const midX = svgW / 2;
  // Font size: shrink for longer lines / more lines
  const longestLine = Math.max(...lines.map(l => l.length));
  const baseFontSize = longestLine > 14 ? 18 : longestLine > 10 ? 20 : 24;
  const fontSize = lines.length > 2 ? Math.min(baseFontSize, 16) : baseFontSize;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${totalHeight}`}
      className="w-80 h-auto overflow-visible -mb-5"
      aria-label={text}
    >
      <defs>
        {lines.map((_, i) => {
          const y = 22 + i * lineHeight;
          const curve = Math.max(6, 18 - i * 5);
          return (
            <path
              key={i}
              id={`arc-${dayId}-${i}`}
              d={`M 5,${y + curve} Q ${midX},${y - curve} ${svgW - 5},${y + curve}`}
              fill="none"
            />
          );
        })}
      </defs>
      {lines.map((line, i) => (
        <text
          key={i}
          className="fill-foreground font-black"
          style={{ fontSize }}
          textAnchor="middle"
        >
          <textPath href={`#arc-${dayId}-${i}`} startOffset="50%">
            {line}
          </textPath>
        </text>
      ))}
    </svg>
  );
}

// ============================================================
// COMMENT BUBBLE (floats above media stack)
// ============================================================

function _CommentBubble({
  comment,
  seed,
  index
}: {
  comment: string;
  seed: string;
  index: number;
}) {
  const rand = seededRandom(seed + 'bubble');
  const bubbleRotate = (rand - 0.5) * 5; // -2.5 to +2.5 deg
  // Stagger horizontal offset so multiple bubbles don't overlap perfectly
  const xShift = (seededRandom(seed + 'bx') - 0.5) * 24;

  return (
    <motion.div
      className="relative max-w-44"
      style={{ x: xShift }}
      initial={{ opacity: 0, y: 10, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: bubbleRotate }}
      whileHover={{ scale: 1.08, rotate: 0, zIndex: 20 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 20,
        delay: 0.04 * index
      }}
    >
      <div className="rounded-2xl bg-foreground/[0.07] px-3 py-2 backdrop-blur-sm">
        <p className="text-foreground/80 text-xs leading-relaxed line-clamp-3">{comment}</p>
      </div>
      <div className="flex justify-center">
        <div className="border-foreground/[0.07] size-0 border-x-[5px] border-t-[5px] border-x-transparent" />
      </div>
    </motion.div>
  );
}

// ============================================================
// MEDIA STACK (polaroid pile — fans out on hover)
// ============================================================

/** A single media item with its parent day reference */
type StackedMedia = {
  media: MediaItem;
  dayId: string;
  /** Index within the flattened stack */
  stackIndex: number;
};

/** Compute stacked (piled) transform for a media item */
function stackedTransform(index: number, total: number, seed: string) {
  const rand = seededRandom(seed);
  const randY = seededRandom(seed + 'sy');
  // Rotation: ±8 degrees, more spread with more items
  const maxRotate = Math.min(8, 3 + total * 0.8);
  const rotate = (rand - 0.5) * maxRotate * 2;
  // Slight offset so edges peek out
  const x = (rand - 0.5) * Math.min(12, total * 2);
  const y = (randY - 0.5) * Math.min(8, total * 1.5);
  // Later items slightly in front
  const zIndex = index;

  return { rotate, x, y, zIndex, scale: 1 };
}

/** Compute fanned-out (sorted) transform for a media item */
function fannedTransform(index: number, total: number) {
  if (total === 1) return { rotate: 0, x: 0, y: 0, zIndex: 1, scale: 1 };

  // Arrange in a grid-like fan: up to 3 columns, centered both axes
  const cols = Math.min(3, total);
  const rows = Math.ceil(total / cols);
  const row = Math.floor(index / cols);
  const col = index % cols;

  const cellW = 72;
  const cellH = 80;
  const gridW = cols * cellW;
  const gridH = rows * cellH;
  const x = col * cellW - gridW / 2 + cellW / 2;
  const y = row * cellH - gridH / 2 + cellH / 2;

  return { rotate: 0, x, y, zIndex: index + 10, scale: 1 };
}

function MediaStack({
  items,
  thumbnailUrls,
  isFocused,
  allCompletedMedia,
  onMediaClick,
  onDeleteMedia,
  onFanChange,
  canEdit = false
}: {
  items: ReadonlyArray<StackedMedia>;
  thumbnailUrls: Record<string, string>;
  isFocused: boolean;
  allCompletedMedia: ReadonlyArray<MediaItem>;
  onMediaClick: (media: ReadonlyArray<MediaItem>, index: number) => void;
  /** Delete handler for failed/stuck media (editors only) */
  onDeleteMedia?: ((mediaId: string) => void) | undefined;
  onFanChange?: (fanned: boolean) => void;
  canEdit?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const total = items.length;
  const thumbSize = isFocused ? 'normal' : 'small';
  const dimension = isFocused ? 80 : 56; // size-20 or size-14

  // Fan out when focused (active column) or hovered
  const isFanned = (isFocused || isHovered) && total > 1;

  // Stack/fan dimensions — items are absolutely positioned inside
  const cols = Math.min(3, total);
  const rows = Math.ceil(total / cols);
  const stackH = dimension + Math.min(total, 6) * 3;
  const fanH = rows * 80;
  const stackW = dimension + Math.min(total, 6) * 4;
  const fanW = cols * 72;

  const containerH = isFanned ? fanH : stackH;
  const containerW = isFanned ? Math.max(fanW, stackW) : stackW;

  if (total === 0) return null;

  return (
    <motion.div
      className="relative flex items-center justify-center overflow-visible"
      onMouseEnter={() => {
        setIsHovered(true);
        onFanChange?.(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onFanChange?.(false);
      }}
      animate={{ height: containerH, width: containerW }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      {items.map(({ media, stackIndex }) => {
        const seed = media.id;
        const transform = isFanned
          ? fannedTransform(stackIndex, total)
          : stackedTransform(stackIndex, total, seed);

        const completedIndex = allCompletedMedia.indexOf(media);
        const thumbnailUrl = media.thumbnailS3Key ? thumbnailUrls[media.thumbnailS3Key] : undefined;

        return (
          <motion.div
            key={media.id}
            className="absolute"
            initial={false}
            animate={{
              rotate: transform.rotate,
              x: transform.x,
              y: transform.y,
              zIndex: transform.zIndex,
              scale: transform.scale
            }}
            whileHover={{ scale: 1.1, zIndex: 50 }}
            transition={{ type: 'spring', stiffness: 350, damping: 22 }}
          >
            <div className="rounded-lg bg-card border border-border/60 p-1 shadow-sm">
              <MediaThumbnail
                media={media}
                size={thumbSize}
                thumbnailUrl={thumbnailUrl}
                showPrivateBadge={canEdit}
                onClick={
                  completedIndex >= 0
                    ? () => onMediaClick(allCompletedMedia, completedIndex)
                    : undefined
                }
                onDelete={onDeleteMedia}
              />
            </div>
          </motion.div>
        );
      })}

      {/* Item count badge when stacked and multiple */}
      {total > 1 && !isFanned && (
        <motion.div
          className="absolute -right-1.5 -bottom-1.5 z-20 flex size-5 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-semibold shadow-sm"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.1 }}
        >
          {total}
        </motion.div>
      )}
    </motion.div>
  );
}

// ============================================================
// DATE COLUMN (media-grouped with stacked pile)
// ============================================================

function DateColumn({
  day,
  thumbnailUrls,
  canEdit,
  isFocused,
  distanceFromCenter,
  onMediaClick,
  onDeleteMedia,
  onEdit,
  onDelete,
  onActivate
}: {
  day: TimelineDay;
  thumbnailUrls: Record<string, string>;
  canEdit: boolean;
  isFocused: boolean;
  distanceFromCenter: number;
  onMediaClick: (media: ReadonlyArray<MediaItem>, index: number) => void;
  /** Delete handler for individual media (editors only) */
  onDeleteMedia?: ((mediaId: string) => void) | undefined;
  onEdit: (day: TimelineDay) => void;
  onDelete: (dayId: string) => Promise<void>;
  onActivate?: () => void;
}) {
  const [controlsActive, setControlsActive] = useState(false);

  // Controls visible only when focused AND user has toggled them on
  const showControls = isFocused && controlsActive;

  // Scale down columns further from center
  const scale = isFocused ? 1 : Math.max(0.7, 1 - distanceFromCenter * 0.12);
  const opacity = isFocused ? 1 : Math.max(0.5, 1 - distanceFromCenter * 0.15);
  const width = isFocused
    ? DATE_COL_FOCUSED
    : Math.max(DATE_COL_MIN, DATE_COL_BASE - distanceFromCenter * 30);

  // Build stacked media from the day's media
  const stackedMedia: Array<StackedMedia> = [];
  const allCompletedMedia: Array<MediaItem> = [];

  for (const media of day.media) {
    stackedMedia.push({
      media,
      dayId: day.id,
      stackIndex: stackedMedia.length
    });
    if (media.processingStatus === 'completed') {
      allCompletedMedia.push(media);
    }
  }

  const dateParts = formatDateParts(day.date);

  return (
    <motion.div
      className={`group/column flex shrink-0 flex-col items-center gap-3 overflow-visible ${!isFocused ? 'cursor-pointer' : ''}`}
      style={{ width }}
      animate={{ scale, opacity }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      onClick={!isFocused ? onActivate : undefined}
    >
      {/* Day title — curved arc above date */}
      <AnimatePresence mode="wait">
        {day.title && (
          <motion.div
            key={isFocused ? 'focused' : 'unfocused'}
            initial={{ opacity: 0, scale: 0.5, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25, mass: 0.4 }}
          >
            {isFocused ? (
              <CurvedTitle text={day.title} dayId={day.id} />
            ) : (
              <span className="text-muted-foreground max-w-28 text-center text-[10px] font-medium block line-clamp-2">
                {day.title}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Date label + controls */}
      {isFocused ? (
        <div className="relative flex items-center gap-1.5">
          <AnimatePresence>
            {canEdit && showControls && (
              <motion.button
                type="button"
                onClick={() => onEdit(day)}
                className="flex size-6 items-center justify-center rounded-full bg-background shadow-sm border border-border hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Edit day"
                initial={{ opacity: 0, scale: 0.5, x: 8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.5, x: 8 }}
                transition={{ duration: 0.15 }}
              >
                <Pencil className="size-3" />
              </motion.button>
            )}
          </AnimatePresence>

          <motion.button
            type="button"
            className="relative flex flex-col items-center gap-0 outline-none"
            onClick={() => setControlsActive(prev => !prev)}
            initial={false}
            layout
          >
            <span className="text-muted-foreground text-[11px] uppercase tracking-widest">
              {dateParts.weekday}
            </span>
            <span className="text-foreground -mt-0.5 text-3xl font-bold leading-tight tabular-nums">
              {dateParts.dayNum}
            </span>
            <span className="text-muted-foreground text-[11px] leading-tight">
              {dateParts.monthYear}
            </span>
            {dateParts.relative.length > 0 &&
              dateParts.relative !== 'Today' &&
              dateParts.relative !== 'Yesterday' && (
                <span className="text-muted-foreground/60 mt-0.5 text-[9px] italic">
                  {dateParts.relative}
                </span>
              )}
          </motion.button>

          <AnimatePresence>
            {canEdit && showControls && (
              <ConfirmDialog
                title="Delete day"
                description="This day and all its media will be permanently deleted. This action cannot be undone."
                actionLabel="Delete"
                pendingLabel="Deleting..."
                variant="destructive"
                size="sm"
                onConfirm={() => onDelete(day.id)}
                trigger={<button type="button" />}
              >
                <motion.span
                  className="flex size-6 items-center justify-center rounded-full bg-background shadow-sm border border-border hover:bg-destructive/10 hover:text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Delete day"
                  initial={{ opacity: 0, scale: 0.5, x: -8 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.5, x: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  <Trash2 className="size-3" />
                </motion.span>
              </ConfirmDialog>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <motion.div
          className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-center text-xs font-medium transition-colors"
          layout
        >
          {formatShortDate(day.date)}
        </motion.div>
      )}

      {/* Content area */}
      <div className="relative flex flex-col items-center gap-1.5 px-2">
        {/* Media pile */}
        {stackedMedia.length > 0 && (
          <MediaStack
            items={stackedMedia}
            thumbnailUrls={thumbnailUrls}
            isFocused={isFocused}
            allCompletedMedia={allCompletedMedia}
            onMediaClick={onMediaClick}
            onDeleteMedia={canEdit ? onDeleteMedia : undefined}
            canEdit={canEdit}
          />
        )}

        {/* Empty state */}
        {stackedMedia.length === 0 && day.comments.length === 0 && (
          <div className="text-muted-foreground text-xs italic">Empty</div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================
// EMPTY STATE
// ============================================================

function EmptyTimeline() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h2 className="text-lg font-medium">No days yet</h2>
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
  initialDays,
  initialCursor,
  initialThumbnailUrls
}: Props) {
  const [days, setDays] = useState<Array<TimelineDay>>([...initialDays]);
  const [cursor, setCursor] = useState<DayCursor | null>(initialCursor);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>(initialThumbnailUrls);
  const [isLoadingMore, startLoadMore] = useTransition();
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  // Resolve initial focus from localStorage or default to latest date
  const initialFocusIndex = useMemo(() => {
    return resolveInitialFocusIndex(timeline.id, initialDays);
  }, [initialDays, timeline.id]);

  const [focusedIndex, setFocusedIndex] = useState(initialFocusIndex);

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const uploadRef = useRef<UploadMediaHandle>(null);
  const editDayRef = useRef<EditDayHandle>(null);
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

  const openEditDay = useCallback(
    (day: TimelineDay) => {
      editDayRef.current?.open(day, thumbnailUrls);
    },
    [thumbnailUrls]
  );

  const handleDeleteDay = useCallback(async (dayId: string) => {
    const result = await deleteDayAction({ id: dayId });
    if (result._tag === 'Error') {
      toast.error(result.message);
      return;
    }
    setDays(prev => prev.filter(d => d.id !== dayId));
    toast.success('Day deleted');
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

  const handleDeleteMedia = useCallback(async (mediaId: string) => {
    const result = await deleteMediaAction({ mediaId });
    if (result._tag === 'Error') {
      toast.error(result.message);
      return;
    }

    // Remove media from days state
    setDays(prev =>
      prev
        .map(day => ({
          ...day,
          media: day.media.filter(m => m.id !== mediaId)
        }))
        // Remove days that have no media and no comments
        .filter(day => day.media.length > 0 || day.comments.length > 0)
    );

    // Adjust lightbox: navigate to next/prev or close if last item
    setLightbox(prev => {
      if (!prev) return null;
      const remaining = prev.media.filter(m => m.id !== mediaId);
      if (remaining.length === 0) return null;
      const newIndex = Math.min(prev.currentIndex, remaining.length - 1);
      return { media: remaining, currentIndex: newIndex };
    });

    toast.success('Media deleted');
  }, []);

  const handleTogglePrivacy = useCallback((mediaId: string, isPrivate: boolean) => {
    // Optimistic update: toggle in days state
    setDays(prev =>
      prev.map(day => ({
        ...day,
        media: day.media.map(m => (m.id === mediaId ? { ...m, isPrivate } : m))
      }))
    );

    // Optimistic update: toggle in lightbox state
    setLightbox(prev => {
      if (!prev) return null;
      return {
        ...prev,
        media: prev.media.map(m => (m.id === mediaId ? { ...m, isPrivate } : m))
      };
    });

    toast.success(isPrivate ? 'Media set to private' : 'Media set to public');

    // Fire server action (non-blocking)
    toggleMediaPrivacyAction({ mediaId, isPrivate }).then(result => {
      if (result._tag === 'Error') {
        toast.error(result.message);
        // Revert optimistic update
        setDays(prev =>
          prev.map(day => ({
            ...day,
            media: day.media.map(m => (m.id === mediaId ? { ...m, isPrivate: !isPrivate } : m))
          }))
        );
        setLightbox(prev => {
          if (!prev) return null;
          return {
            ...prev,
            media: prev.media.map(m => (m.id === mediaId ? { ...m, isPrivate: !isPrivate } : m))
          };
        });
      }
    });
  }, []);

  // Lazy thumbnail URL fetching
  const requestThumbnailUrls = useLazyThumbnailUrls(timeline.id, thumbnailUrls, setThumbnailUrls);

  const loadMore = useCallback(() => {
    if (!cursor || isLoadingMore) return;

    startLoadMore(async () => {
      const result = await getDaysAction({
        timelineId: timeline.id,
        cursor,
        order: order ?? 'oldest',
        limit: 20
      });

      if (result._tag === 'Error') {
        toast.error(result.message);
        return;
      }

      setDays(prev => [...prev, ...result.days]);
      setCursor(result.nextCursor);
    });
  }, [cursor, isLoadingMore, timeline.id, order]);

  // Ribbon data: lightweight projection of media counts per day
  const ribbonGroups = useMemo(
    () =>
      days.map(d => ({
        date: d.date,
        mediaCount: d.media.length
      })),
    [days]
  );

  // Position scroll then reveal — useLayoutEffect runs before browser paint.
  // We mutate the DOM directly (remove invisible class) to avoid a React re-render.
  useLayoutEffect(() => {
    if (days.length === 0) return;
    const container = scrollContainerRef.current;
    const el = columnRefs.current.get(focusedIndex);
    if (container && el) {
      const containerCenter = container.clientWidth / 2;
      const elCenter = el.offsetLeft + el.offsetWidth / 2;
      container.scrollLeft = elCenter - containerCenter;
    }
    // Reveal: remove invisible from scroll area and track
    scrollAreaRef.current?.classList.remove('invisible');
  }, [days.length, focusedIndex]);

  // Persist focused date to localStorage when it changes
  useEffect(() => {
    const day = days[focusedIndex];
    if (day) {
      saveFocusDate(timeline.id, day.date);
    }
  }, [focusedIndex, days, timeline.id]);

  // Remember this timeline as the last active one
  useEffect(() => {
    saveLastTimelineId(timeline.id);
  }, [timeline.id]);

  // Request thumbnail URLs for all visible days
  useEffect(() => {
    const keysNeeded: Array<string> = [];
    // Request for focused day + neighbors
    const start = Math.max(0, focusedIndex - 3);
    const end = Math.min(days.length - 1, focusedIndex + 3);
    for (let i = start; i <= end; i++) {
      const day = days[i];
      if (day) {
        for (const media of day.media) {
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
  }, [days, focusedIndex, thumbnailUrls, requestThumbnailUrls]);

  // Infinite scroll: load more when approaching the end
  useEffect(() => {
    if (!cursor) return;
    if (focusedIndex >= days.length - 3) {
      loadMore();
    }
  }, [focusedIndex, days.length, cursor, loadMore]);

  // Wheel → horizontal scroll (translate vertical wheel to horizontal)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent) {
      if (!container) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      container.scrollLeft += delta;
    }

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Track which column is closest to center — updates in real-time during scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    function handleScroll() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
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
      });
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [days.length]);

  // Scroll to a specific date column (keyboard nav, track clicks, column clicks).
  // Sets focusedIndex first so column widths settle, then scrolls to final position.
  const scrollToDate = useCallback((index: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Update focus immediately — columns resize
    setFocusedIndex(index);

    // After layout settles with new widths, scroll to center the target
    const scrollEl = container;
    requestAnimationFrame(() => {
      const el = columnRefs.current.get(index);
      if (!el) return;
      const target = el.offsetLeft + el.offsetWidth / 2 - scrollEl.clientWidth / 2;
      // Disable snap so we can scroll past intermediate columns
      scrollEl.style.scrollSnapType = 'none';
      scrollEl.scrollTo({ left: target, behavior: 'smooth' });

      // Re-enable snap after scroll completes
      let lastScroll = scrollEl.scrollLeft;
      let stableFrames = 0;
      function checkArrival() {
        const current = scrollEl.scrollLeft;
        if (Math.abs(current - lastScroll) < 1) {
          stableFrames++;
          if (stableFrames > 3) {
            scrollEl.style.scrollSnapType = '';
            return;
          }
        } else {
          stableFrames = 0;
        }
        lastScroll = current;
        requestAnimationFrame(checkArrival);
      }
      requestAnimationFrame(checkArrival);
    });
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
          const next = Math.min(days.length - 1, prev + 1);
          requestAnimationFrame(() => scrollToDate(next));
          return next;
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightbox, days.length, scrollToDate]);

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
              {canEdit && <AddDayComment timelineId={timeline.id} />}
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
      {days.length === 0 ? (
        <EmptyTimeline />
      ) : (
        <div ref={scrollAreaRef} className="invisible flex flex-1 flex-col overflow-hidden">
          {/* Horizontal scrolling day columns */}
          <div
            ref={scrollContainerRef}
            className="relative flex flex-1 items-center overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-none"
          >
            {/* Flowing ribbon background — connects dates visually */}
            <TimelineRibbon
              dateGroups={ribbonGroups}
              columnRefs={columnRefs}
              scrollContainerRef={scrollContainerRef}
              focusedIndex={focusedIndex}
            />

            {/* Left spacer: half viewport so first column can center */}
            <div className="w-[50vw] shrink-0" />

            {days.map((day, idx) => {
              const distanceFromCenter = Math.abs(idx - focusedIndex);

              return (
                <div
                  key={day.date}
                  ref={el => setColumnRef(idx, el)}
                  className="flex shrink-0 snap-center items-center"
                >
                  <DateColumn
                    day={day}
                    thumbnailUrls={thumbnailUrls}
                    canEdit={canEdit}
                    isFocused={idx === focusedIndex}
                    distanceFromCenter={distanceFromCenter}
                    onMediaClick={openLightbox}
                    onDeleteMedia={canEdit ? handleDeleteMedia : undefined}
                    onEdit={openEditDay}
                    onDelete={handleDeleteDay}
                    onActivate={() => scrollToDate(idx)}
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
        </div>
      )}

      {/* Media lightbox */}
      <AnimatePresence>
        {lightbox && (
          <MediaLightbox
            timelineId={timeline.id}
            state={lightbox}
            canEdit={canEdit}
            onClose={closeLightbox}
            onNavigate={navigateLightbox}
            onDelete={handleDeleteMedia}
            onTogglePrivacy={handleTogglePrivacy}
          />
        )}
      </AnimatePresence>

      {/* Edit day dialog */}
      {canEdit && <EditDay ref={editDayRef} />}

      {/* Page-level drop overlay */}
      {canEdit && <PageDropOverlay isDraggingOver={isDraggingOver} />}
    </div>
  );
}
