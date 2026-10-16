'use client';

import {
  createTimelineOverviewPoints,
  TIMELINE_OVERVIEW_DAY_SPACING,
  TIMELINE_OVERVIEW_HEIGHT
} from '@/components/timeline-overview-geometry';
import { TimelineTree } from '@/components/timeline-tree';

type OverviewPathDay = {
  readonly id: string;
  readonly date: string;
  readonly mediaCount: number;
};

type Props = {
  readonly days: ReadonlyArray<OverviewPathDay>;
  readonly activeDayId: string | null;
};

const OVERVIEW_TREE_SCALE = 0.22;

export function TimelineOverviewPath({ days, activeDayId }: Props) {
  const positions = createTimelineOverviewPoints(days).map(point => ({
    x: point.x / OVERVIEW_TREE_SCALE,
    y: point.y / OVERVIEW_TREE_SCALE,
    width: TIMELINE_OVERVIEW_DAY_SPACING / OVERVIEW_TREE_SCALE
  }));

  return (
    <TimelineTree
      dateGroups={days}
      positions={positions}
      width={(days.length * TIMELINE_OVERVIEW_DAY_SPACING) / OVERVIEW_TREE_SCALE}
      height={TIMELINE_OVERVIEW_HEIGHT / OVERVIEW_TREE_SCALE}
      centerY={TIMELINE_OVERVIEW_HEIGHT / 2 / OVERVIEW_TREE_SCALE}
      focusedIndex={days.findIndex(day => day.id === activeDayId)}
      scale={OVERVIEW_TREE_SCALE}
      restingPresence={0.6}
      showNodes
    />
  );
}
