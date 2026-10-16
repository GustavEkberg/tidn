export type TimelineOverviewPoint = {
  readonly x: number;
  readonly y: number;
};

type GeometryDay = {
  readonly date: string;
};

export const TIMELINE_OVERVIEW_DAY_SPACING = 120;
export const TIMELINE_OVERVIEW_EDGE_PADDING = 16;
export const TIMELINE_OVERVIEW_HEIGHT = 144;
const PATH_CENTER_Y = 72;

export function timelineOverviewNoise(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 997;
  }
  return (hash % 25) - 12;
}

export function createTimelineOverviewPoints(
  days: ReadonlyArray<GeometryDay>
): ReadonlyArray<TimelineOverviewPoint> {
  return days.map((day, index) => ({
    x: TIMELINE_OVERVIEW_DAY_SPACING / 2 + index * TIMELINE_OVERVIEW_DAY_SPACING,
    y: getTimelineOverviewPointY(day.date)
  }));
}

export function getTimelineOverviewPointY(date: string): number {
  return PATH_CENTER_Y + timelineOverviewNoise(date);
}
