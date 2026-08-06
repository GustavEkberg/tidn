'use client';

import { Loader2 } from 'lucide-react';
import {
  getTimelineOverviewPointY,
  TIMELINE_OVERVIEW_DAY_SPACING,
  TIMELINE_OVERVIEW_HEIGHT
} from '@/components/timeline-overview-geometry';
import { TimelineOverviewPath } from '@/components/timeline-overview-path';
import { useTimelineOverviewScroll } from '@/components/timeline-overview-scroll';
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
  const { overviewRef, scrollerRef, pathRef, buttonRefs, scrollPosition, handleScroll } =
    useTimelineOverviewScroll(days, activeDayId);
  const pathWidth = days.length * TIMELINE_OVERVIEW_DAY_SPACING;

  return (
    <nav
      ref={overviewRef}
      aria-label="Timeline overview"
      className="border-border/50 bg-background/90 safe-pb invisible relative shrink-0 border-t backdrop-blur-md"
    >
      <div
        ref={scrollerRef}
        className="scrollbar-none flex h-36 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x"
        onScroll={handleScroll}
      >
        <div className="w-[calc(50vw-5rem)] shrink-0" />

        <div
          ref={pathRef}
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
                    'group relative flex shrink-0 flex-col items-center px-3 text-center outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    loadingDayId !== null && !isLoading && 'opacity-35'
                  )}
                  style={{ width: TIMELINE_OVERVIEW_DAY_SPACING }}
                >
                  {day.title && (
                    <span
                      className="text-foreground pointer-events-none absolute left-1/2 line-clamp-3 w-[210px] -translate-x-1/2 -translate-y-1/2 text-xs leading-[1.15] font-semibold [text-shadow:0_0_4px_var(--background),0_0_4px_var(--background),0_0_8px_var(--background)]"
                      style={{ top: getTimelineOverviewPointY(day.date) }}
                    >
                      {day.title}
                    </span>
                  )}

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

      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 z-20 flex items-center justify-center transition-all duration-150',
          scrollPosition?.visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        )}
      >
        <div className="bg-background/75 text-foreground flex items-baseline gap-2 rounded-2xl px-5 py-2 shadow-sm backdrop-blur-md">
          <span className="text-4xl leading-none font-black tracking-[-0.05em] sm:text-5xl">
            {scrollPosition?.month}
          </span>
          <span className="text-muted-foreground text-2xl leading-none font-bold sm:text-3xl">
            /{scrollPosition?.year}
          </span>
        </div>
      </div>
    </nav>
  );
}
