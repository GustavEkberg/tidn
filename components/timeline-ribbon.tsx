'use client';

import { useEffect, useState } from 'react';
import {
  TimelineTree,
  type ColumnPosition,
  type RibbonDateGroup
} from '@/components/timeline-tree';

type Props = {
  dateGroups: ReadonlyArray<RibbonDateGroup>;
  columnRefs: React.RefObject<Map<number, HTMLDivElement>>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  focusedIndex: number;
};

export function TimelineRibbon({
  dateGroups,
  columnRefs,
  scrollContainerRef,
  focusedIndex
}: Props) {
  const [positions, setPositions] = useState<ReadonlyArray<ColumnPosition>>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function measure() {
      if (!container) return;
      const newPositions: Array<ColumnPosition> = [];
      columnRefs.current.forEach(element => {
        newPositions.push({
          x: element.offsetLeft + element.offsetWidth / 2,
          width: element.offsetWidth
        });
      });
      newPositions.sort((a, b) => a.x - b.x);
      setPositions(newPositions);
      setDimensions({ width: container.scrollWidth, height: container.clientHeight });
    }

    const timer = setTimeout(measure, 100);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [columnRefs, scrollContainerRef, dateGroups.length, focusedIndex]);

  return (
    <TimelineTree
      dateGroups={dateGroups}
      positions={positions}
      width={dimensions.width}
      height={dimensions.height}
      centerY={dimensions.height / 2 + 20}
      focusedIndex={focusedIndex}
    />
  );
}
