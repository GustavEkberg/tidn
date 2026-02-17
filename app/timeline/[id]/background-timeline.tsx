'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useMotionValue, useReducedMotion } from 'motion/react';

// ============================================================
// TYPES
// ============================================================

type DateGroupInfo = {
  readonly eventCount: number;
};

type BackgroundTimelineProps = {
  /** One entry per date group, in order */
  dateGroups: ReadonlyArray<DateGroupInfo>;
  /** Index of the currently focused date column */
  focusedIndex: number;
  /** Ref to the horizontal scroll container for tracking scroll */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref map to column DOM elements, keyed by index */
  columnRefs: React.RefObject<Map<number, HTMLDivElement>>;
};

// ============================================================
// HELPERS
// ============================================================

/** Deterministic pseudo-random from numeric seed */
function seededWobble(seed: number): number {
  const x = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Generate a smooth SVG path through a set of points with catmull-rom -> cubic bezier */
function catmullRomToBezier(
  points: ReadonlyArray<{ x: number; y: number }>,
  tension: number = 0.3
): string {
  if (points.length < 2) return '';

  const parts: Array<string> = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    parts.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }

  return parts.join(' ');
}

// ============================================================
// NODE COMPONENT — pulsing dot at each date position
// ============================================================

function TimelineNode({
  cx,
  cy,
  eventCount,
  isFocused,
  index
}: {
  cx: number;
  cy: number;
  eventCount: number;
  isFocused: boolean;
  index: number;
}) {
  // Node radius scales with event count (more events = bigger presence)
  const baseRadius = 3 + Math.min(eventCount, 8) * 0.8;
  const radius = isFocused ? baseRadius * 1.6 : baseRadius;

  return (
    <g>
      {/* Outer glow ring — pulses when focused */}
      {isFocused && (
        <motion.circle
          cx={cx}
          cy={cy}
          fill="none"
          stroke="var(--color-foreground)"
          strokeWidth={0.5}
          initial={{ r: radius, opacity: 0 }}
          animate={{
            r: [radius + 4, radius + 12, radius + 4],
            opacity: [0.2, 0.05, 0.2]
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      )}

      {/* Inner dot */}
      <motion.circle
        cx={cx}
        cy={cy}
        fill="var(--color-foreground)"
        initial={false}
        animate={{
          r: radius,
          opacity: isFocused ? 0.25 : 0.06 + Math.min(eventCount, 6) * 0.015
        }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      />

      {/* Tiny event count ticks — decorative marks radiating from node */}
      {eventCount > 1 &&
        Array.from({ length: Math.min(eventCount, 6) }, (_, i) => {
          const angle = (i / Math.min(eventCount, 6)) * Math.PI * 2 - Math.PI / 2;
          const tickStart = radius + 3;
          const tickEnd = radius + 5 + seededWobble(index * 100 + i) * 3;
          const x1 = cx + Math.cos(angle) * tickStart;
          const y1 = cy + Math.sin(angle) * tickStart;
          const x2 = cx + Math.cos(angle) * tickEnd;
          const y2 = cy + Math.sin(angle) * tickEnd;

          return (
            <motion.line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--color-foreground)"
              strokeWidth={0.5}
              strokeLinecap="round"
              initial={false}
              animate={{
                opacity: isFocused ? 0.2 : 0.05
              }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            />
          );
        })}
    </g>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function BackgroundTimeline({
  dateGroups,
  focusedIndex,
  scrollContainerRef,
  columnRefs
}: BackgroundTimelineProps) {
  const prefersReduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [columnPositions, setColumnPositions] = useState<Array<{ x: number; y: number }>>([]);

  const scrollX = useMotionValue(0);

  // Measure container + column positions
  const measure = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollWidth = container.scrollWidth;
    const scrollHeight = container.clientHeight;
    setDimensions({ width: scrollWidth, height: scrollHeight });

    const positions: Array<{ x: number; y: number }> = [];
    const cols = columnRefs.current;
    const centerY = scrollHeight / 2;

    cols.forEach((el, idx) => {
      const colCenter = el.offsetLeft + el.offsetWidth / 2;
      // Add organic wobble to y position
      const wobble = (seededWobble(idx * 37) - 0.5) * 20;
      positions.push({ x: colCenter, y: centerY + wobble });
    });

    // Sort by x position (Map iteration order = insertion order which should be correct, but be safe)
    positions.sort((a, b) => a.x - b.x);
    setColumnPositions(positions);
  }, [scrollContainerRef, columnRefs]);

  // Track scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      scrollX.set(container.scrollLeft);
    }

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, scrollX]);

  // Measure on mount and when groups change
  useEffect(() => {
    measure();

    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, dateGroups.length, scrollContainerRef]);

  // Re-measure when columns animate (debounced)
  useEffect(() => {
    const timer = setTimeout(measure, 350);
    return () => clearTimeout(timer);
  }, [focusedIndex, measure]);

  if (dateGroups.length === 0 || columnPositions.length === 0 || prefersReduced) return null;

  // Build path points: add edge points for the flowing line
  const centerY = dimensions.height / 2;
  const pathPoints = [
    { x: 0, y: centerY },
    ...columnPositions,
    { x: dimensions.width, y: centerY }
  ];

  const pathD = catmullRomToBezier(pathPoints, 0.35);

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0"
      width={dimensions.width}
      height={dimensions.height}
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Main flowing line */}
      <motion.path
        d={pathD}
        fill="none"
        stroke="var(--color-foreground)"
        strokeWidth={1}
        strokeLinecap="round"
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{ opacity: 0.06, pathLength: 1 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
      />

      {/* Secondary line — slightly offset, thinner, for depth */}
      <motion.path
        d={pathD}
        fill="none"
        stroke="var(--color-foreground)"
        strokeWidth={0.5}
        strokeLinecap="round"
        strokeDasharray="4 8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.04 }}
        transition={{ duration: 2, delay: 0.5 }}
      />

      {/* Nodes at each date position */}
      {columnPositions.map((pos, idx) => {
        const group = dateGroups[idx];
        if (!group) return null;

        return (
          <TimelineNode
            key={idx}
            cx={pos.x}
            cy={pos.y}
            eventCount={group.eventCount}
            isFocused={idx === focusedIndex}
            index={idx}
          />
        );
      })}

      {/* Animated traveling dot along the path — follows scroll */}
      <motion.circle
        r={2}
        fill="var(--color-foreground)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        transition={{ delay: 1 }}
      >
        <animateMotion dur="20s" repeatCount="indefinite" path={pathD} />
      </motion.circle>
    </svg>
  );
}
