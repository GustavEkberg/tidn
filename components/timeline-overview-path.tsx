import {
  createTimelineOverviewRandom,
  createTimelineOverviewPoints,
  createTimelineOverviewTrunk,
  TIMELINE_OVERVIEW_DAY_SPACING,
  TIMELINE_OVERVIEW_HEIGHT
} from '@/components/timeline-overview-geometry';
import { buildTimelineBranch } from '@/components/timeline-branch-geometry';

type OverviewPathDay = {
  readonly id: string;
  readonly date: string;
  readonly mediaCount: number;
};

type Props = {
  readonly days: ReadonlyArray<OverviewPathDay>;
  readonly activeDayId: string | null;
};

function randomRange(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

const OVERVIEW_BRANCH_SCALE = 0.22;

export function TimelineOverviewPath({ days, activeDayId }: Props) {
  const points = createTimelineOverviewPoints(days);
  const pathWidth = days.length * TIMELINE_OVERVIEW_DAY_SPACING;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={pathWidth}
      height={TIMELINE_OVERVIEW_HEIGHT}
      viewBox={`0 0 ${pathWidth} ${TIMELINE_OVERVIEW_HEIGHT}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="overview-trunk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b5e88a" />
          <stop offset="45%" stopColor="#69bd4c" />
          <stop offset="100%" stopColor="#2d6e2e" />
        </linearGradient>
        <filter id="overview-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <path
        d={createTimelineOverviewTrunk(points)}
        fill="none"
        stroke="url(#overview-trunk)"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.72"
      />

      {days.map((day, index) => {
        const point = points[index];
        const isActive = day.id === activeDayId;
        const media = day.mediaCount;
        const mediaScale = Math.min(1, media / 8);
        const random = createTimelineOverviewRandom(day.id);
        const branches: Array<{ path: string; strokeWidth: number; depth: 1 | 2 }> = [];

        if (media > 0) {
          const branchCount = Math.min(10, Math.ceil(media * 0.8));
          for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
            const goesUp = random() > 0.5;
            const angle = goesUp ? randomRange(random, -155, -25) : randomRange(random, 25, 155);
            const length = 100 + mediaScale * (280 - 100) + randomRange(random, -15, 15);
            const branchStroke = 1.2 + mediaScale * (3 - 1.2);
            const branch = buildTimelineBranch(
              point.x,
              point.y,
              angle,
              Math.max(100, length),
              random,
              22,
              5 + Math.floor(mediaScale * 3)
            );
            branches.push({ path: branch.path, strokeWidth: branchStroke, depth: 1 });

            const twigCount =
              media >= 3 ? Math.min(3, Math.floor(random() * (media / 4 + 0.5))) : 0;
            for (let twigIndex = 0; twigIndex < twigCount; twigIndex++) {
              const along = randomRange(random, 0.4, 0.9);
              const pointIndex = Math.floor(along * (branch.points.length - 1));
              const twigOrigin = branch.points[pointIndex] ?? point;
              const twigAngle = angle + randomRange(random, -60, 60);
              const twigLength = 45 + random() * (120 - 45);
              const twigStroke = 0.6 + random() * (1.8 - 0.6);
              const twig = buildTimelineBranch(
                twigOrigin.x,
                twigOrigin.y,
                twigAngle,
                twigLength,
                random,
                30,
                4
              );
              branches.push({ path: twig.path, strokeWidth: twigStroke, depth: 2 });
            }
          }
        }

        const nodeRadius = (isActive ? 6 : 3) + Math.min(day.mediaCount, 8) * 0.28;

        return (
          <g key={day.id}>
            <g
              className="transition-opacity duration-300 motion-reduce:transition-none"
              transform={`translate(${point.x},${point.y}) scale(${OVERVIEW_BRANCH_SCALE}) translate(${-point.x},${-point.y})`}
              opacity={isActive ? 0.9 : 0.58}
            >
              {branches.map((branch, branchIndex) => (
                <path
                  key={`${day.id}-branch-${branchIndex}`}
                  d={branch.path}
                  fill="none"
                  stroke={branch.depth === 1 ? '#69bd4c' : '#7cc95e'}
                  strokeWidth={branch.strokeWidth}
                  strokeLinecap="round"
                />
              ))}
            </g>

            {isActive && (
              <g opacity="0.22">
                <circle
                  className="motion-safe:animate-pulse"
                  cx={point.x}
                  cy={point.y}
                  r="15"
                  fill="#7cc95e"
                  filter="url(#overview-glow)"
                />
              </g>
            )}
            <circle
              cx={point.x}
              cy={point.y}
              r={nodeRadius}
              fill={isActive ? '#f8fff4' : '#7cc95e'}
              stroke={isActive ? '#3f9139' : '#5aad42'}
              strokeWidth={isActive ? 3 : 1.5}
            />
          </g>
        );
      })}
    </svg>
  );
}
