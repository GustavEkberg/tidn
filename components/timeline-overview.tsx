'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import {
  TIMELINE_OVERVIEW_DAY_SPACING,
  TIMELINE_OVERVIEW_HEIGHT
} from '@/components/timeline-overview-geometry';
import { TimelineOverviewPath } from '@/components/timeline-overview-path';
import { cn } from '@/lib/utils';

export type TimelineOverviewDay = {
  readonly id: string;
  readonly date: string;
  readonly title: string | null;
  readonly mediaCount: number;
};

type Props = {
  readonly days: ReadonlyArray<TimelineOverviewDay>;
  readonly activeDayId: string | null;
  readonly loadingDayId: string | null;
  readonly onSelect: (day: TimelineOverviewDay) => void;
};

function formatOverviewDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit'
  });
}

export function TimelineOverview({ days, activeDayId, loadingDayId, onSelect }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hasCenteredRef = useRef(false);
  const pathWidth = days.length * TIMELINE_OVERVIEW_DAY_SPACING;

  useEffect(() => {
    if (!activeDayId) return;
    const scroller = scrollerRef.current;
    const button = buttonRefs.current.get(activeDayId);
    if (!scroller || !button) return;

    const left = button.offsetLeft + button.offsetWidth / 2 - scroller.clientWidth / 2;
    scroller.scrollTo({ left, behavior: hasCenteredRef.current ? 'smooth' : 'auto' });
    hasCenteredRef.current = true;
  }, [activeDayId]);

  return (
    <nav
      aria-label="Timeline overview"
      className="border-border/50 bg-background/90 safe-pb relative shrink-0 border-t backdrop-blur-md"
    >
      <div
        ref={scrollerRef}
        className="scrollbar-none flex h-36 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x"
        onWheel={event => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        <div className="w-[calc(50vw-5rem)] shrink-0" />

        <div
          className="relative shrink-0"
          style={{ width: pathWidth, height: TIMELINE_OVERVIEW_HEIGHT }}
        >
          <TimelineOverviewPath days={days} activeDayId={activeDayId} />

          <div className="absolute inset-0 flex">
            {days.map(day => {
              const isActive = day.id === activeDayId;
              const isLoading = day.id === loadingDayId;
              const dateLabel = formatOverviewDate(day.date);

              return (
                <button
                  key={day.id}
                  ref={element => {
                    if (element) buttonRefs.current.set(day.id, element);
                    else buttonRefs.current.delete(day.id);
                  }}
                  type="button"
                  onClick={() => onSelect(day)}
                  disabled={loadingDayId !== null}
                  aria-current={isActive ? 'date' : undefined}
                  aria-label={day.title ? `${day.title}, ${dateLabel}` : dateLabel}
                  className={cn(
                    'group relative flex w-40 shrink-0 flex-col items-center px-3 text-center outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    loadingDayId !== null && !isLoading && 'opacity-35'
                  )}
                >
                  {isLoading && (
                    <Loader2
                      className="absolute top-[64px] size-4 animate-spin text-foreground"
                      aria-hidden="true"
                    />
                  )}

                  <span
                    className={cn(
                      'absolute bottom-3 rounded-full px-2 py-1 text-[10px] leading-none tabular-nums transition-colors',
                      isActive
                        ? 'bg-foreground text-background font-semibold'
                        : 'text-muted-foreground group-hover:bg-muted group-hover:text-foreground'
                    )}
                  >
                    {dateLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="w-[calc(50vw-5rem)] shrink-0" />
      </div>

      <div className="from-background pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r to-transparent" />
      <div className="from-background pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent" />
    </nav>
  );
}
