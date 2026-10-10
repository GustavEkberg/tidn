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

export function createTimelineOverviewRandom(seed: string): () => number {
  let state = Math.abs(
    seed.split('').reduce((hash, character) => hash * 31 + character.charCodeAt(0), 17)
  );
  state = (state % 2147483646) + 1;

  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
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

export function createTimelineOverviewTrunk(points: ReadonlyArray<TimelineOverviewPoint>): string {
  const first = points[0];
  if (!first) return '';

  let path = `M 0,${first.y} L ${first.x},${first.y}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const controlDistance = TIMELINE_OVERVIEW_DAY_SPACING * 0.42;
    path += ` C ${previous.x + controlDistance},${previous.y} ${current.x - controlDistance},${current.y} ${current.x},${current.y}`;
  }

  const last = points[points.length - 1];
  return `${path} L ${points.length * TIMELINE_OVERVIEW_DAY_SPACING},${last.y}`;
}
