'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  TIMELINE_OVERVIEW_DAY_SPACING,
  TIMELINE_OVERVIEW_EDGE_PADDING
} from '@/components/timeline-overview-geometry';

type ScrollDay = {
  readonly id: string;
  readonly date: string;
};

type ScrollPosition = {
  readonly month: string;
  readonly year: string;
  readonly visible: boolean;
};

type ScrollSample = {
  readonly left: number;
  readonly time: number;
};

const FAST_SCROLL_THRESHOLD = 0.45;
const CONTINUOUS_SCROLL_GAP = 180;
const MINIMUM_SCROLL_DISTANCE = TIMELINE_OVERVIEW_DAY_SPACING * 3;

function formatScrollPosition(date: string): Omit<ScrollPosition, 'visible'> {
  const [year, month] = date.split('-').map(Number);
  return {
    month: new Date(year, month - 1, 1)
      .toLocaleDateString('en-US', { month: 'short' })
      .toUpperCase(),
    year: year.toString().slice(-2)
  };
}

export function useTimelineOverviewScroll(
  days: ReadonlyArray<ScrollDay>,
  activeDayId: string | null
) {
  const overviewRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hasPositionedRef = useRef(false);
  const lastScrollSampleRef = useRef<ScrollSample | null>(null);
  const scrollDistanceRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollPosition, setScrollPosition] = useState<ScrollPosition | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const handleWheel = (event: WheelEvent) => {
      if (!scroller || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      const acceleration = Math.min(4, 1 + Math.abs(event.deltaY) / 60);
      scroller.scrollLeft += event.deltaY * acceleration;
    };

    scroller?.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      scroller?.removeEventListener('wheel', handleWheel);
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      if (indicatorTimerRef.current !== null) clearTimeout(indicatorTimerRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const path = pathRef.current;
    overviewRef.current?.classList.remove('invisible');
    if (!scroller || !path) return;

    function revealActiveDay(behavior: ScrollBehavior) {
      const button = activeDayId ? buttonRefs.current.get(activeDayId) : undefined;
      if (!scroller || !path || !button) return;

      const itemLeft = path.offsetLeft + button.offsetLeft;
      const itemRight = itemLeft + button.offsetWidth;
      let left = scroller.scrollLeft;
      // Preserve free scrolling and visible neighbors. Only reveal a selected day if needed.
      if (itemLeft - TIMELINE_OVERVIEW_EDGE_PADDING < left) {
        left = itemLeft - TIMELINE_OVERVIEW_EDGE_PADDING;
      } else if (itemRight + TIMELINE_OVERVIEW_EDGE_PADDING > left + scroller.clientWidth) {
        left = itemRight + TIMELINE_OVERVIEW_EDGE_PADDING - scroller.clientWidth;
      }
      left = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, left));
      if (Math.abs(left - scroller.scrollLeft) > 1) {
        scroller.scrollTo({
          left,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : behavior
        });
      }
      lastScrollSampleRef.current = { left: scroller.scrollLeft, time: performance.now() };
      scrollDistanceRef.current = 0;
      hasPositionedRef.current = true;
    }

    revealActiveDay(hasPositionedRef.current ? 'smooth' : 'auto');
    let previousWidth = scroller.clientWidth;
    const observer = new ResizeObserver(() => {
      if (scroller.clientWidth === previousWidth) return;
      previousWidth = scroller.clientWidth;
      revealActiveDay('auto');
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [activeDayId, days.length]);

  const handleScroll = () => {
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const scroller = scrollerRef.current;
      const path = pathRef.current;
      if (!scroller || !path) return;

      const now = performance.now();
      const previous = lastScrollSampleRef.current;
      const current: ScrollSample = { left: scroller.scrollLeft, time: now };
      lastScrollSampleRef.current = current;
      if (!previous) return;

      if (now - previous.time > CONTINUOUS_SCROLL_GAP) {
        scrollDistanceRef.current = 0;
        return;
      }

      const distance = Math.abs(current.left - previous.left);
      scrollDistanceRef.current += distance;
      if (scrollDistanceRef.current < MINIMUM_SCROLL_DISTANCE) return;

      const elapsed = Math.max(1, now - previous.time);
      const velocity = Math.abs(current.left - previous.left) / elapsed;
      if (velocity < FAST_SCROLL_THRESHOLD) return;

      const pathCenter = scroller.scrollLeft + scroller.clientWidth / 2 - path.offsetLeft;
      const index = Math.max(
        0,
        Math.min(days.length - 1, Math.round(pathCenter / TIMELINE_OVERVIEW_DAY_SPACING - 0.5))
      );
      const day = days[index];
      if (!day) return;

      const position = formatScrollPosition(day.date);
      setScrollPosition(currentPosition =>
        currentPosition?.month === position.month && currentPosition.year === position.year
          ? { ...currentPosition, visible: true }
          : { ...position, visible: true }
      );

      if (indicatorTimerRef.current !== null) clearTimeout(indicatorTimerRef.current);
      indicatorTimerRef.current = setTimeout(() => {
        setScrollPosition(currentPosition =>
          currentPosition ? { ...currentPosition, visible: false } : null
        );
      }, 450);
    });
  };

  return { overviewRef, scrollerRef, pathRef, buttonRefs, scrollPosition, handleScroll };
}
