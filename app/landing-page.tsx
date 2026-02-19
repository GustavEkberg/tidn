'use client';

import Link from 'next/link';
import { useRef, useEffect, useCallback, useState, useMemo, lazy, Suspense } from 'react';
import { Camera, Clock, Download, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { AuthBackground } from '@/components/auth-background';
import { Button } from '@/components/ui/button';

const TimelineRibbon = lazy(() =>
  import('@/components/timeline-ribbon').then(m => ({ default: m.TimelineRibbon }))
);

// ============================================================
// DETERMINISTIC RANDOM (same as timeline-view)
// ============================================================

function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

// ============================================================
// CONSTANTS (same as timeline-view)
// ============================================================

const DATE_COL_BASE = 220;
const DATE_COL_FOCUSED = 360;
const DATE_COL_MIN = 140;
const MAX_CHARS_PER_LINE = 18;
// ============================================================
// DEMO DATA
// ============================================================

type DemoMedia = {
  readonly id: string;
  readonly type: 'photo' | 'video';
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
  readonly duration?: number;
};

type DemoDay = {
  readonly id: string;
  readonly date: string;
  readonly title?: string;
  readonly media: ReadonlyArray<DemoMedia>;
};

const DEMO_DAYS: ReadonlyArray<DemoDay> = [
  {
    id: 'd1',
    date: '2026-02-14',
    title: 'Arrival day',
    media: [
      { id: 'a1', type: 'photo', hue: 200, saturation: 40, lightness: 55 },
      { id: 'a2', type: 'photo', hue: 180, saturation: 35, lightness: 60 },
      { id: 'a3', type: 'video', hue: 210, saturation: 30, lightness: 50, duration: 42 },
      { id: 'a4', type: 'photo', hue: 190, saturation: 45, lightness: 58 }
    ]
  },
  {
    id: 'd2',
    date: '2026-02-15',
    title: 'Beach morning',
    media: [
      { id: 'b1', type: 'photo', hue: 45, saturation: 50, lightness: 65 },
      { id: 'b2', type: 'photo', hue: 30, saturation: 55, lightness: 60 },
      { id: 'b3', type: 'photo', hue: 50, saturation: 45, lightness: 70 },
      { id: 'b4', type: 'video', hue: 40, saturation: 40, lightness: 55, duration: 75 },
      { id: 'b5', type: 'photo', hue: 35, saturation: 50, lightness: 62 },
      { id: 'b6', type: 'photo', hue: 55, saturation: 42, lightness: 68 }
    ]
  },
  {
    id: 'd3',
    date: '2026-02-16',
    media: [
      { id: 'c1', type: 'photo', hue: 140, saturation: 35, lightness: 50 },
      { id: 'c2', type: 'photo', hue: 120, saturation: 40, lightness: 55 }
    ]
  },
  {
    id: 'd4',
    date: '2026-02-17',
    title: 'Market day',
    media: [
      { id: 'd1m', type: 'photo', hue: 15, saturation: 50, lightness: 55 },
      { id: 'd2m', type: 'photo', hue: 25, saturation: 55, lightness: 50 },
      { id: 'd3m', type: 'photo', hue: 10, saturation: 45, lightness: 58 },
      { id: 'd4m', type: 'video', hue: 20, saturation: 40, lightness: 52, duration: 28 },
      { id: 'd5m', type: 'photo', hue: 5, saturation: 48, lightness: 56 }
    ]
  },
  {
    id: 'd5',
    date: '2026-02-18',
    title: 'Sunset hike',
    media: [
      { id: 'e1', type: 'photo', hue: 280, saturation: 35, lightness: 45 },
      { id: 'e2', type: 'video', hue: 300, saturation: 30, lightness: 50, duration: 123 },
      { id: 'e3', type: 'photo', hue: 270, saturation: 40, lightness: 48 },
      { id: 'e4', type: 'photo', hue: 290, saturation: 38, lightness: 52 },
      { id: 'e5', type: 'photo', hue: 310, saturation: 32, lightness: 47 },
      { id: 'e6', type: 'photo', hue: 275, saturation: 36, lightness: 50 },
      { id: 'e7', type: 'photo', hue: 295, saturation: 34, lightness: 46 }
    ]
  },
  {
    id: 'd6',
    date: '2026-02-19',
    media: [
      { id: 'f1', type: 'photo', hue: 160, saturation: 30, lightness: 60 },
      { id: 'f2', type: 'photo', hue: 170, saturation: 35, lightness: 55 },
      { id: 'f3', type: 'photo', hue: 155, saturation: 32, lightness: 58 }
    ]
  },
  {
    id: 'd7',
    date: '2026-02-20',
    title: 'Last day',
    media: [
      { id: 'g1', type: 'photo', hue: 220, saturation: 45, lightness: 50 },
      { id: 'g2', type: 'photo', hue: 230, saturation: 40, lightness: 55 },
      { id: 'g3', type: 'video', hue: 215, saturation: 35, lightness: 48, duration: 96 },
      { id: 'g4', type: 'photo', hue: 225, saturation: 42, lightness: 52 },
      { id: 'g5', type: 'photo', hue: 210, saturation: 38, lightness: 56 }
    ]
  }
];

// ============================================================
// HELPERS
// ============================================================

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateParts(dateStr: string): {
  dayNum: string;
  weekday: string;
  monthYear: string;
} {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return {
    dayNum: date.getDate().toString(),
    weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
    monthYear: date.toLocaleDateString('en-US', { month: 'long' })
  };
}

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

// ============================================================
// PLACEHOLDER THUMBNAIL
// ============================================================

function PlaceholderThumb({ media, size }: { media: DemoMedia; size: 'normal' | 'small' }) {
  const bg = `hsl(${media.hue}, ${media.saturation}%, ${media.lightness}%)`;
  const bgLight = `hsl(${media.hue}, ${media.saturation - 10}%, ${media.lightness + 12}%)`;
  const sizeClass = size === 'small' ? 'size-14' : 'size-20';

  return (
    <div
      className={`relative overflow-hidden rounded-md ${sizeClass}`}
      style={{ background: `linear-gradient(135deg, ${bg}, ${bgLight})` }}
    >
      {media.type === 'video' && (
        <>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex size-6 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
              <Play className="size-3 fill-white text-white" />
            </div>
          </div>
          {media.duration != null && (
            <div className="absolute bottom-0.5 right-0.5 rounded bg-black/50 px-1 py-px text-[9px] leading-tight text-white backdrop-blur-sm">
              {formatDuration(media.duration)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// MEDIA STACK (polaroid pile — fans out when focused)
// ============================================================

function stackedTransform(index: number, total: number, seed: string) {
  const rand = seededRandom(seed);
  const randY = seededRandom(seed + 'sy');
  const maxRotate = Math.min(12, 4 + total * 1.2);
  const rotate = (rand - 0.5) * maxRotate * 2;
  const x = (rand - 0.5) * Math.min(16, total * 3);
  const y = (randY - 0.5) * Math.min(10, total * 2);
  return { rotate, x, y, zIndex: index, scale: 1 };
}

function fannedTransform(index: number, total: number, seed: string) {
  if (total === 1) return { rotate: 0, x: 0, y: 0, zIndex: 1, scale: 1 };
  const cols = Math.min(3, total);
  const rows = Math.ceil(total / cols);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const cellW = 76;
  const cellH = 84;
  const gridW = cols * cellW;
  const gridH = rows * cellH;
  const baseX = col * cellW - gridW / 2 + cellW / 2;
  const baseY = row * cellH - gridH / 2 + cellH / 2;
  const randX = seededRandom(seed + 'fx');
  const randY = seededRandom(seed + 'fy');
  const randR = seededRandom(seed + 'fr');
  return {
    rotate: (randR - 0.5) * 7,
    x: baseX + (randX - 0.5) * 10,
    y: baseY + (randY - 0.5) * 8,
    zIndex: index + 10,
    scale: 1
  };
}

function DemoMediaStack({
  media,
  isFocused
}: {
  media: ReadonlyArray<DemoMedia>;
  isFocused: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const total = media.length;
  const thumbSize = isFocused ? 'normal' : 'small';
  const dimension = isFocused ? 80 : 56;

  const isFanned = (isFocused || isHovered) && total > 1;

  const cols = Math.min(3, total);
  const rows = Math.ceil(total / cols);
  const stackH = dimension + Math.min(total, 6) * 4;
  const fanH = rows * 84 + 12;
  const stackW = dimension + Math.min(total, 6) * 5;
  const fanW = cols * 76 + 12;

  const containerH = isFanned ? fanH : stackH;
  const containerW = isFanned ? Math.max(fanW, stackW) : stackW;

  if (total === 0) return null;

  return (
    <motion.div
      className="relative flex items-center justify-center overflow-visible"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      animate={{ height: containerH, width: containerW }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      {media.map((m, i) => {
        const seed = m.id;
        const transform = isFanned
          ? fannedTransform(i, total, seed)
          : stackedTransform(i, total, seed);

        return (
          <motion.div
            key={m.id}
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
            <div className="flex rounded-lg border border-border/60 bg-card p-1 shadow-sm">
              <PlaceholderThumb media={m} size={thumbSize} />
            </div>
          </motion.div>
        );
      })}

      {total > 1 && !isFanned && (
        <motion.div
          className="absolute -bottom-1.5 -right-1.5 z-20 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background shadow-sm"
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
// CURVED TITLE (SVG arc text — same as timeline-view)
// ============================================================

function CurvedTitle({ text, dayId }: { text: string; dayId: string }) {
  const lines = splitIntoLines(text);
  const lineHeight = 34;
  const totalHeight = lines.length * lineHeight + 24;
  const svgW = 440;
  const midX = svgW / 2;
  const longestLine = Math.max(...lines.map(l => l.length));
  const baseFontSize = longestLine > 14 ? 18 : longestLine > 10 ? 20 : 24;
  const fontSize = lines.length > 2 ? Math.min(baseFontSize, 16) : baseFontSize;

  return (
    <svg
      viewBox={`0 0 ${svgW} ${totalHeight}`}
      className="-mb-5 h-auto w-80 overflow-visible"
      aria-label={text}
    >
      <defs>
        {lines.map((_, i) => {
          const y = 22 + i * lineHeight;
          const curve = Math.max(6, 18 - i * 5);
          return (
            <path
              key={i}
              id={`demo-arc-${dayId}-${i}`}
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
          <textPath href={`#demo-arc-${dayId}-${i}`} startOffset="50%">
            {line}
          </textPath>
        </text>
      ))}
    </svg>
  );
}

// ============================================================
// DATE COLUMN (same visual structure as timeline-view)
// ============================================================

function DemoDateColumn({
  day,
  isFocused,
  distanceFromCenter,
  onActivate
}: {
  day: DemoDay;
  isFocused: boolean;
  distanceFromCenter: number;
  onActivate?: () => void;
}) {
  const scale = isFocused ? 1 : Math.max(0.7, 1 - distanceFromCenter * 0.12);
  const opacity = isFocused ? 1 : Math.max(0.5, 1 - distanceFromCenter * 0.15);
  const width = isFocused
    ? DATE_COL_FOCUSED
    : Math.max(DATE_COL_MIN, DATE_COL_BASE - distanceFromCenter * 30);

  const dateParts = useMemo(() => formatDateParts(day.date), [day.date]);

  return (
    <motion.div
      className={`group/column flex shrink-0 flex-col items-center gap-3 overflow-visible ${!isFocused ? 'cursor-pointer' : ''}`}
      style={{ width }}
      animate={{ scale, opacity }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      onClick={!isFocused ? onActivate : undefined}
    >
      {/* Day title */}
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
              <span className="block max-w-28 text-center text-[10px] font-medium text-muted-foreground line-clamp-2">
                {day.title}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Date label */}
      {isFocused ? (
        <div className="flex flex-col items-center gap-0">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {dateParts.weekday}
          </span>
          <span className="-mt-0.5 text-3xl font-bold leading-tight tabular-nums text-foreground">
            {dateParts.dayNum}
          </span>
          <span className="text-[11px] leading-tight text-muted-foreground">
            {dateParts.monthYear}
          </span>
        </div>
      ) : (
        <motion.div
          className="rounded-full bg-muted px-3 py-1 text-center text-xs font-medium text-muted-foreground"
          layout
        >
          {formatShortDate(day.date)}
        </motion.div>
      )}

      {/* Media stack */}
      <div className="relative flex flex-col items-center gap-1.5 px-2">
        <DemoMediaStack media={day.media} isFocused={isFocused} />
      </div>
    </motion.div>
  );
}

// ============================================================
// DEMO TIMELINE — horizontally scrollable, same as real app
// ============================================================

function DemoTimeline() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const isProgrammaticScroll = useRef(false);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const ribbonGroups = useMemo(
    () => DEMO_DAYS.map(d => ({ date: d.date, mediaCount: d.media.length })),
    []
  );

  const setColumnRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) {
      columnRefs.current.set(idx, el);
    } else {
      columnRefs.current.delete(idx);
    }
  }, []);

  // Scroll to a specific column — sets focusedIndex first so widths settle,
  // then scrolls to final position (mirrors real timeline-view.tsx)
  const scrollToColumn = useCallback((index: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Lock out scroll-driven focus updates during programmatic scroll
    isProgrammaticScroll.current = true;
    setFocusedIndex(index);

    // After layout settles with new widths, scroll to center the target
    requestAnimationFrame(() => {
      const el = columnRefs.current.get(index);
      if (!el || !container) return;
      const target = el.offsetLeft + el.offsetWidth / 2 - container.clientWidth / 2;
      container.style.scrollSnapType = 'none';
      container.scrollTo({ left: target, behavior: 'smooth' });

      let lastScroll = container.scrollLeft;
      let stableFrames = 0;
      function checkArrival() {
        if (!container) return;
        const current = container.scrollLeft;
        if (Math.abs(current - lastScroll) < 1) {
          stableFrames++;
          if (stableFrames > 3) {
            container.style.scrollSnapType = '';
            isProgrammaticScroll.current = false;
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

  // Track which column is closest to center — RAF-throttled, skipped during
  // programmatic scrolls to prevent layout-shift feedback loops
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    function handleScroll() {
      if (isProgrammaticScroll.current) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!container) return;
        const centerX = container.scrollLeft + container.clientWidth / 2;

        let closest = 0;
        let closestDist = Infinity;
        columnRefs.current.forEach((el, idx) => {
          const colCenter = el.offsetLeft + el.offsetWidth / 2;
          const dist = Math.abs(colCenter - centerX);
          if (dist < closestDist) {
            closestDist = dist;
            closest = idx;
          }
        });
        setFocusedIndex(closest);
      });
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section className="relative py-12 sm:py-16">
      <div className="mb-4 text-center sm:mb-8">
        <motion.h2
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.4 }}
        >
          A week in Lisbon
        </motion.h2>
        <motion.p
          className="mt-1 text-sm text-muted-foreground"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          Swipe or scroll to explore
        </motion.p>
      </div>

      {/* Timeline scroll container — same as real timeline-view */}
      <div
        ref={scrollContainerRef}
        className="relative flex items-center overflow-x-auto overflow-y-hidden scrollbar-none snap-x snap-mandatory"
        style={{ height: 480 }}
      >
        {/* TimelineRibbon — the living tree SVG behind columns (lazy) */}
        <Suspense>
          <TimelineRibbon
            dateGroups={ribbonGroups}
            columnRefs={columnRefs}
            scrollContainerRef={scrollContainerRef}
            focusedIndex={focusedIndex}
          />
        </Suspense>

        {/* Left spacer */}
        <div className="w-[50vw] shrink-0" />

        {DEMO_DAYS.map((day, idx) => {
          const distanceFromCenter = Math.abs(idx - focusedIndex);
          return (
            <div
              key={day.id}
              ref={el => setColumnRef(idx, el)}
              className="flex shrink-0 snap-center items-center"
            >
              <DemoDateColumn
                day={day}
                isFocused={idx === focusedIndex}
                distanceFromCenter={distanceFromCenter}
                onActivate={() => scrollToColumn(idx)}
              />
            </div>
          );
        })}

        {/* Right spacer */}
        <div className="w-[50vw] shrink-0" />
      </div>

      {/* Dot indicators */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {DEMO_DAYS.map((day, i) => (
          <button
            key={day.id}
            type="button"
            className={`h-1.5 rounded-full transition-all ${
              i === focusedIndex ? 'w-6 bg-foreground' : 'w-1.5 bg-muted-foreground/30'
            }`}
            onClick={() => scrollToColumn(i)}
            aria-label={`Go to ${day.title ?? formatShortDate(day.date)}`}
          />
        ))}
      </div>
    </section>
  );
}

// ============================================================
// FEATURES
// ============================================================

const FEATURES = [
  {
    icon: Camera,
    title: 'Your memories, together',
    description:
      'Photos and videos from everyone who was there. Invite friends and family to contribute to a shared timeline.'
  },
  {
    icon: Clock,
    title: 'Organized by time',
    description:
      'Every moment has a date. Scroll through days and watch your timeline grow into a living record of what happened.'
  },
  {
    icon: Download,
    title: 'Always exportable',
    description:
      'Your photos and videos belong to you. Download originals anytime, in full quality, however you want to use them.'
  }
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 }
};

// ============================================================
// HEADER
// ============================================================

function Header() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          tidn
        </Link>
        <Button variant="outline" size="sm" render={<Link href="/login" />}>
          Sign in
        </Button>
      </nav>
    </header>
  );
}

// ============================================================
// LANDING PAGE
// ============================================================

export function LandingPage() {
  return (
    <div className="relative min-h-dvh">
      <Header />

      {/* Hero */}
      <section className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6 pt-14">
        <AuthBackground />
        <motion.div
          className="flex max-w-xl flex-col items-center gap-6 text-center"
          initial="hidden"
          animate="visible"
          transition={{ staggerChildren: 0.12 }}
        >
          <motion.h1
            className="text-7xl font-bold tracking-tight sm:text-8xl"
            variants={fadeUp}
            transition={{ duration: 0.5 }}
          >
            tidn
          </motion.h1>
          <motion.p
            className="text-xl text-muted-foreground sm:text-2xl"
            variants={fadeUp}
            transition={{ duration: 0.5 }}
          >
            Your memories. Your photos and videos.
            <br />
            Collected together, organized by time.
          </motion.p>
          <motion.div variants={fadeUp} transition={{ duration: 0.5 }}>
            <Button size="lg" render={<Link href="/login" />}>
              Get started
            </Button>
          </motion.div>
        </motion.div>
      </section>

      {/* Example Timeline */}
      <DemoTimeline />

      {/* Features */}
      <section className="relative flex items-center justify-center px-6 py-24">
        <div className="mx-auto w-full max-w-4xl">
          <motion.div
            className="grid gap-6 sm:grid-cols-3"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-100px' }}
            transition={{ staggerChildren: 0.1 }}
          >
            {FEATURES.map(feature => (
              <motion.div
                key={feature.title}
                className="rounded-xl border bg-card/80 p-6 backdrop-blur-sm"
                variants={fadeUp}
                transition={{ duration: 0.4 }}
              >
                <feature.icon className="mb-3 size-6 text-muted-foreground" />
                <h3 className="mb-1.5 font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative flex min-h-[50dvh] items-center justify-center px-6">
        <motion.div
          className="text-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          transition={{ staggerChildren: 0.1 }}
        >
          <motion.h2
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
            variants={fadeUp}
            transition={{ duration: 0.4 }}
          >
            Start your first timeline
          </motion.h2>
          <motion.p
            className="mt-2 text-muted-foreground"
            variants={fadeUp}
            transition={{ duration: 0.4 }}
          >
            No passwords. Just your email.
          </motion.p>
          <motion.div className="mt-6" variants={fadeUp} transition={{ duration: 0.4 }}>
            <Button size="lg" render={<Link href="/login" />}>
              Get started
            </Button>
          </motion.div>
        </motion.div>
      </section>
    </div>
  );
}
