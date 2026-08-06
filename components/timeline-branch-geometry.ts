export type TimelineBranchPoint = {
  readonly x: number;
  readonly y: number;
};

type TimelineBranch = {
  readonly path: string;
  readonly tipX: number;
  readonly tipY: number;
  readonly points: ReadonlyArray<TimelineBranchPoint>;
};

function randomRange(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

export function buildTimelineBranch(
  startX: number,
  startY: number,
  angleDegrees: number,
  length: number,
  random: () => number,
  jitter: number = 25,
  segmentCount: number = 6
): TimelineBranch {
  const segmentLength = length / segmentCount;
  let currentAngle = angleDegrees;
  let x = startX;
  let y = startY;
  const points: Array<TimelineBranchPoint> = [{ x, y }];
  let path = `M ${x},${y}`;

  for (let index = 0; index < segmentCount; index++) {
    const jitterScale = 1 - (index / segmentCount) * 0.4;
    currentAngle += randomRange(random, -jitter, jitter) * jitterScale;
    const radians = (currentAngle * Math.PI) / 180;
    const step = segmentLength * (0.85 + random() * 0.3);
    x += Math.cos(radians) * step;
    y += Math.sin(radians) * step;
    points.push({ x, y });
    path += ` L ${x},${y}`;
  }

  return { path, tipX: x, tipY: y, points };
}
