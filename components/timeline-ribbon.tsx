'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// ============================================================
// TYPES
// ============================================================

type RibbonDateGroup = {
  readonly date: string;
  readonly mediaCount: number;
};

type ColumnPosition = {
  readonly x: number;
  readonly width: number;
};

type Props = {
  dateGroups: ReadonlyArray<RibbonDateGroup>;
  columnRefs: React.RefObject<Map<number, HTMLDivElement>>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  focusedIndex: number;
};

/**
 * A segment of the tree. Every branch/twig knows which column it
 * belongs to (columnIndex) and its origin point on the trunk so
 * we can scale it from the attachment point.
 */
type Segment = {
  readonly path: string;
  readonly strokeWidth: number;
  readonly tipX: number;
  readonly tipY: number;
  /** 0 = trunk, 1 = branch, 2 = twig */
  readonly depth: number;
  /** Which date column this segment belongs to (-1 for trunk) */
  readonly columnIndex: number;
  /** Origin point on the trunk (for transform-origin) */
  readonly originX: number;
  readonly originY: number;
};

type Leaf = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly rotation: number;
  readonly rotationDrift: number;
  readonly scale: number;
  readonly delay: number;
  readonly duration: number;
  /** Which date column this leaf belongs to */
  readonly columnIndex: number;
  /** Origin on trunk (for transform-origin of scale) */
  readonly originX: number;
  readonly originY: number;
};

/** Tiny floating dot particle (spore/pollen) */
type Spore = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly radius: number;
  readonly delay: number;
  readonly duration: number;
  readonly columnIndex: number;
  readonly originX: number;
  readonly originY: number;
};

// ============================================================
// DETERMINISTIC RANDOM
// ============================================================

function makeRand(seed: number): () => number {
  let s = Math.abs(seed) | 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function randRange(rand: () => number, lo: number, hi: number): number {
  return lo + rand() * (hi - lo);
}

// ============================================================
// TREE GENERATION
// ============================================================

const TRUNK_STROKE = 3.5;
const BRANCH_STROKE_MAX = 3.0;
const BRANCH_STROKE_MIN = 1.2;
const TWIG_STROKE_MAX = 1.8;
const TWIG_STROKE_MIN = 0.6;

const BRANCH_LEN_MIN = 100;
const BRANCH_LEN_MAX = 280;
const TWIG_LEN_MIN = 45;
const TWIG_LEN_MAX = 120;

const TRUNK_WANDER = 18;
const MAX_BRANCHES_PER_COL = 10;
const MAX_TWIGS = 3;
/** Max spore particles per branch cluster */
const MAX_SPORES_PER_BRANCH = 4;

/** Resting scale for unfocused columns */
const RESTING_SCALE = 0.0;
/** Full scale for the focused column */
const FOCUSED_SCALE = 1.0;

function generateTree(
  positions: ReadonlyArray<ColumnPosition>,
  groups: ReadonlyArray<RibbonDateGroup>,
  centerY: number,
  totalWidth: number,
  focusedIdx: number
): { segments: ReadonlyArray<Segment>; leaves: ReadonlyArray<Leaf>; spores: ReadonlyArray<Spore> } {
  if (positions.length === 0) return { segments: [], leaves: [], spores: [] };

  const segments: Array<Segment> = [];
  const leaves: Array<Leaf> = [];
  const spores: Array<Spore> = [];
  let leafId = 0;
  let sporeId = 0;

  const globalRand = makeRand(42);

  // ---- TRUNK ----
  // Core trunk spans 180px beyond first/last column (preserves original RNG sequence)
  const coreStartX = Math.max(0, positions[0].x - 180);
  const coreEndX = Math.min(totalWidth, positions[positions.length - 1].x + 180);

  type Waypoint = { x: number; y: number };
  const trunkPoints: Array<Waypoint> = [];

  let currentY = centerY + randRange(globalRand, -20, 20);
  trunkPoints.push({ x: coreStartX, y: currentY });

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const prevX = trunkPoints[trunkPoints.length - 1].x;

    const gap = pos.x - prevX;
    const numIntermediate = Math.max(1, Math.round(gap / 80));
    const stepX = gap / (numIntermediate + 1);

    for (let s = 1; s <= numIntermediate; s++) {
      currentY += randRange(globalRand, -TRUNK_WANDER, TRUNK_WANDER);
      currentY = Math.max(centerY - 80, Math.min(centerY + 80, currentY));
      trunkPoints.push({ x: prevX + stepX * s, y: currentY });
    }

    currentY += randRange(globalRand, -TRUNK_WANDER * 0.6, TRUNK_WANDER * 0.6);
    currentY = Math.max(centerY - 80, Math.min(centerY + 80, currentY));
    trunkPoints.push({ x: pos.x, y: currentY });
  }

  currentY += randRange(globalRand, -TRUNK_WANDER, TRUNK_WANDER);
  trunkPoints.push({ x: coreEndX, y: currentY });

  // Extend trunk to screen edges with a separate RNG (doesn't disturb core path)
  const edgeRand = makeRand(137);

  // Prepend waypoints from x=0 to coreStartX
  if (coreStartX > 0) {
    const leadPoints: Array<Waypoint> = [];
    let y = trunkPoints[0].y;
    const gap = coreStartX;
    const steps = Math.max(1, Math.round(gap / 100));
    const stepX = gap / (steps + 1);
    for (let s = steps; s >= 1; s--) {
      y += randRange(edgeRand, -TRUNK_WANDER * 0.5, TRUNK_WANDER * 0.5);
      y = Math.max(centerY - 60, Math.min(centerY + 60, y));
      leadPoints.unshift({ x: stepX * s, y });
    }
    leadPoints.unshift({ x: 0, y: y + randRange(edgeRand, -8, 8) });
    trunkPoints.unshift(...leadPoints);
  }

  // Append waypoints from coreEndX to totalWidth
  if (coreEndX < totalWidth) {
    const gap = totalWidth - coreEndX;
    const steps = Math.max(1, Math.round(gap / 100));
    const stepX = gap / (steps + 1);
    let y = trunkPoints[trunkPoints.length - 1].y;
    for (let s = 1; s <= steps; s++) {
      y += randRange(edgeRand, -TRUNK_WANDER * 0.5, TRUNK_WANDER * 0.5);
      y = Math.max(centerY - 60, Math.min(centerY + 60, y));
      trunkPoints.push({ x: coreEndX + stepX * s, y });
    }
    trunkPoints.push({ x: totalWidth, y: y + randRange(edgeRand, -8, 8) });
  }

  if (trunkPoints.length >= 2) {
    const trunkPath = catmullRomPath(trunkPoints);
    segments.push({
      path: trunkPath,
      strokeWidth: TRUNK_STROKE,
      tipX: totalWidth,
      tipY: currentY,
      depth: 0,
      columnIndex: -1,
      originX: 0,
      originY: centerY
    });
  }

  // Interpolate trunk Y at any x
  const trunkYAtColumn = (colX: number): number => {
    let lo = 0;
    let hi = trunkPoints.length - 1;
    for (let j = 0; j < trunkPoints.length - 1; j++) {
      if (trunkPoints[j].x <= colX && trunkPoints[j + 1].x >= colX) {
        lo = j;
        hi = j + 1;
        break;
      }
    }
    const loP = trunkPoints[lo];
    const hiP = trunkPoints[hi];
    if (hiP.x === loP.x) return loP.y;
    const t = (colX - loP.x) / (hiP.x - loP.x);
    return loP.y + (hiP.y - loP.y) * t;
  };

  // ---- BRANCHES ----
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const group = groups[i];
    if (!group) continue;

    // Skip columns that are invisible (>1 away from focused) — saves CPU/DOM
    if (!isColumnVisible(i, focusedIdx)) continue;

    const media = group.mediaCount;
    const originY = trunkYAtColumn(pos.x);
    const colRand = makeRand(i * 97 + 7);

    const branchCount = Math.max(1, Math.min(MAX_BRANCHES_PER_COL, Math.ceil(media * 0.8)));

    for (let b = 0; b < branchCount; b++) {
      const goUp = colRand() > 0.5;
      const angle = goUp ? randRange(colRand, -155, -25) : randRange(colRand, 25, 155);

      const mediaT = Math.min(1, media / 8);
      const length =
        BRANCH_LEN_MIN + mediaT * (BRANCH_LEN_MAX - BRANCH_LEN_MIN) + randRange(colRand, -15, 15);
      const branchStroke = BRANCH_STROKE_MIN + mediaT * (BRANCH_STROKE_MAX - BRANCH_STROKE_MIN);

      const branch = buildJaggedBranch(
        pos.x,
        originY,
        angle,
        Math.max(BRANCH_LEN_MIN, length),
        colRand,
        22,
        5 + Math.floor(mediaT * 3)
      );
      segments.push({
        ...branch,
        strokeWidth: branchStroke,
        depth: 1,
        columnIndex: i,
        originX: pos.x,
        originY
      });

      // ---- TWIGS ----
      const twigCount =
        media >= 3 ? Math.min(MAX_TWIGS, Math.floor(colRand() * (media / 4 + 0.5))) : 0;

      for (let t = 0; t < twigCount; t++) {
        const along = randRange(colRand, 0.4, 0.9);
        const ptIdx = Math.floor(along * (branch.points.length - 1));
        const twigOriginX = branch.points[ptIdx].x;
        const twigOriginY = branch.points[ptIdx].y;

        const twigAngle = angle + randRange(colRand, -60, 60);
        const twigLen = TWIG_LEN_MIN + colRand() * (TWIG_LEN_MAX - TWIG_LEN_MIN);
        const twigStroke = TWIG_STROKE_MIN + colRand() * (TWIG_STROKE_MAX - TWIG_STROKE_MIN);

        const twig = buildJaggedBranch(
          twigOriginX,
          twigOriginY,
          twigAngle,
          twigLen,
          colRand,
          30,
          4
        );
        segments.push({
          ...twig,
          strokeWidth: twigStroke,
          depth: 2,
          columnIndex: i,
          originX: pos.x,
          originY
        });

        if (colRand() < 0.7) {
          leaves.push(makeLeaf(leafId++, twig.tipX, twig.tipY, colRand, i, pos.x, originY));
        }
      }

      if (media > 0 && colRand() < 0.6 + mediaT * 0.3) {
        leaves.push(makeLeaf(leafId++, branch.tipX, branch.tipY, colRand, i, pos.x, originY));
      }

      if (media >= 5 && colRand() < 0.5) {
        leaves.push(makeLeaf(leafId++, branch.tipX, branch.tipY, colRand, i, pos.x, originY));
      }

      // Spores — tiny dots scattered around the branch
      const sporeCount = Math.min(MAX_SPORES_PER_BRANCH, Math.floor(colRand() * (media / 2 + 1)));
      for (let sp = 0; sp < sporeCount; sp++) {
        // Spawn from random point along the branch
        const along = randRange(colRand, 0.2, 1.0);
        const spX = pos.x + (branch.tipX - pos.x) * along + randRange(colRand, -20, 20);
        const spY = originY + (branch.tipY - originY) * along + randRange(colRand, -20, 20);
        spores.push(makeSpore(sporeId++, spX, spY, colRand, i, pos.x, originY));
      }
    }
  }

  return { segments, leaves, spores };
}

function makeLeaf(
  id: number,
  x: number,
  y: number,
  rand: () => number,
  columnIndex: number,
  originX: number,
  originY: number
): Leaf {
  return {
    id,
    x,
    y,
    driftX: randRange(rand, -50, 50),
    driftY: randRange(rand, 15, 55),
    rotation: rand() * 360,
    rotationDrift: randRange(rand, -140, 140),
    scale: randRange(rand, 0.5, 1.1),
    delay: rand() * 10,
    duration: randRange(rand, 5, 10),
    columnIndex,
    originX,
    originY
  };
}

function makeSpore(
  id: number,
  x: number,
  y: number,
  rand: () => number,
  columnIndex: number,
  originX: number,
  originY: number
): Spore {
  return {
    id,
    x,
    y,
    driftX: randRange(rand, -35, 35),
    driftY: randRange(rand, -25, 30),
    radius: randRange(rand, 1, 2.5),
    delay: rand() * 12,
    duration: randRange(rand, 4, 9),
    columnIndex,
    originX,
    originY
  };
}

// ============================================================
// GEOMETRY
// ============================================================

/**
 * Build a jagged branch path — walks in the general direction with
 * random angular jitter at each step, producing an organic polyline.
 *
 * @param jitter - max angle deviation per step (degrees). Higher = more jagged.
 * @param segments - number of line segments. More = smoother jaggedness.
 */
type BranchPoint = { readonly x: number; readonly y: number };

function buildJaggedBranch(
  startX: number,
  startY: number,
  angleDeg: number,
  length: number,
  rand: () => number,
  jitter: number = 25,
  numSegments: number = 6
): { path: string; tipX: number; tipY: number; points: ReadonlyArray<BranchPoint> } {
  const segLen = length / numSegments;
  let currentAngle = angleDeg;
  let x = startX;
  let y = startY;

  const points: Array<BranchPoint> = [{ x, y }];
  let d = `M ${x},${y}`;

  for (let i = 0; i < numSegments; i++) {
    // Jitter the angle — bigger jitter early, settles toward tip
    const jitterScale = 1 - (i / numSegments) * 0.4;
    currentAngle += randRange(rand, -jitter, jitter) * jitterScale;

    const rad = (currentAngle * Math.PI) / 180;
    // Slight length variation per segment
    const sl = segLen * (0.85 + rand() * 0.3);
    x += Math.cos(rad) * sl;
    y += Math.sin(rad) * sl;

    points.push({ x, y });
    d += ` L ${x},${y}`;
  }

  return { path: d, tipX: x, tipY: y, points };
}

function catmullRomPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  const tension = 0.35;
  let d = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return d;
}

// ============================================================
// LEAF SVG SHAPE
// ============================================================

const LEAF_PATH =
  'M 0,-4 C 2.5,-3.5 4,-1.5 4,0 C 4,1.5 2.5,3.5 0,3 C -2.5,3.5 -4,1.5 -4,0 C -4,-1.5 -2.5,-3.5 0,-4 Z';

// ============================================================
// SCALE INTERPOLATION
//
// Computes target scale for each column index based on distance
// from focused index. The RAF loop lerps current → target.
// ============================================================

function targetScale(columnIndex: number, focusedIdx: number): number {
  const dist = Math.abs(columnIndex - focusedIdx);
  if (dist === 0) return FOCUSED_SCALE;
  if (dist === 1) return 0.25;
  return RESTING_SCALE;
}

/** Returns true if a column is close enough to focusedIdx to be visible */
function isColumnVisible(columnIndex: number, focusedIdx: number): boolean {
  return Math.abs(columnIndex - focusedIdx) <= 1;
}

// ============================================================
// COMPONENT
// ============================================================

export function TimelineRibbon({
  dateGroups,
  columnRefs,
  scrollContainerRef,
  focusedIndex
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const swayGroupRef = useRef<SVGGElement>(null);
  const [positions, setPositions] = useState<ReadonlyArray<ColumnPosition>>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  // Per-column animated scale values (current → target via lerp)
  const scalesRef = useRef<Array<number>>([]);
  const focusedRef = useRef(focusedIndex);

  // Sync focusedIndex into ref so RAF loop can read it without re-creating
  useEffect(() => {
    focusedRef.current = focusedIndex;
  }, [focusedIndex]);

  // Measure column positions
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function measure() {
      const cols = columnRefs.current;
      if (!cols || !container) return;

      const newPositions: Array<ColumnPosition> = [];
      cols.forEach(el => {
        newPositions.push({
          x: el.offsetLeft + el.offsetWidth / 2,
          width: el.offsetWidth
        });
      });
      newPositions.sort((a, b) => a.x - b.x);

      setPositions(newPositions);
      setDimensions({
        width: container.scrollWidth,
        height: container.clientHeight
      });
    }

    const timer = setTimeout(measure, 100);
    const observer = new ResizeObserver(measure);
    observer.observe(container);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [columnRefs, scrollContainerRef, dateGroups.length, focusedIndex]);

  // Generate tree (deterministic, layout-dependent only)
  const { segments, leaves, spores } = useMemo(() => {
    if (positions.length === 0 || dimensions.height === 0) {
      const emptySegments: ReadonlyArray<Segment> = [];
      const emptyLeaves: ReadonlyArray<Leaf> = [];
      const emptySpores: ReadonlyArray<Spore> = [];
      return { segments: emptySegments, leaves: emptyLeaves, spores: emptySpores };
    }
    const centerY = dimensions.height / 2 + 20;
    return generateTree(positions, dateGroups, centerY, dimensions.width, focusedIndex);
  }, [positions, dimensions, dateGroups, focusedIndex]);

  // Group segments, leaves, and spores by columnIndex for efficient DOM updates
  const columnGroups = useMemo(() => {
    const map = new Map<
      number,
      { segments: Array<Segment>; leaves: Array<Leaf>; spores: Array<Spore> }
    >();

    const getOrCreate = (idx: number) => {
      const existing = map.get(idx);
      if (existing) return existing;
      const segs: Array<Segment> = [];
      const lvs: Array<Leaf> = [];
      const sps: Array<Spore> = [];
      const entry = { segments: segs, leaves: lvs, spores: sps };
      map.set(idx, entry);
      return entry;
    };

    for (const seg of segments) {
      if (seg.columnIndex < 0) continue;
      getOrCreate(seg.columnIndex).segments.push(seg);
    }
    for (const leaf of leaves) {
      getOrCreate(leaf.columnIndex).leaves.push(leaf);
    }
    for (const spore of spores) {
      getOrCreate(spore.columnIndex).spores.push(spore);
    }
    return map;
  }, [segments, leaves, spores]);

  const trunk = useMemo(() => segments.filter(s => s.depth === 0), [segments]);

  // Initialize scales
  useEffect(() => {
    const numCols = dateGroups.length;
    if (scalesRef.current.length !== numCols) {
      scalesRef.current = Array.from({ length: numCols }, (_, i) => targetScale(i, focusedIndex));
    }
  }, [dateGroups.length, focusedIndex]);

  // Animation loop: sway + scale lerp
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let lastTime = performance.now();

    function animate(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
      lastTime = now;
      phaseRef.current += dt * 0.5;

      // Sway
      if (!prefersReduced && swayGroupRef.current) {
        const swayX = Math.sin(phaseRef.current * 0.7) * 2;
        const swayY = Math.sin(phaseRef.current * 0.5 + 1) * 1.5;
        swayGroupRef.current.setAttribute('transform', `translate(${swayX},${swayY})`);
      }

      // Lerp scales toward targets
      const focused = focusedRef.current;
      const scales = scalesRef.current;
      const lerpSpeed = 5; // higher = snappier
      let changed = false;

      for (let i = 0; i < scales.length; i++) {
        // Only lerp visible columns; invisible ones stay at 0
        if (!isColumnVisible(i, focused)) {
          if (scales[i] !== RESTING_SCALE) {
            scales[i] = RESTING_SCALE;
            changed = true;
          }
          continue;
        }
        const target = targetScale(i, focused);
        const current = scales[i];
        if (Math.abs(current - target) > 0.001) {
          scales[i] = current + (target - current) * Math.min(1, lerpSpeed * dt);
          changed = true;
        }
      }

      // Apply scales only to visible column group elements
      if (changed) {
        const svg = svgRef.current;
        if (svg) {
          for (let i = 0; i < scales.length; i++) {
            // Skip columns with no DOM elements (invisible, dist > 1)
            if (!isColumnVisible(i, focused)) continue;

            const s = scales[i];

            // Scale branch/particle groups
            const els = svg.querySelectorAll<SVGGElement>(`[data-col="${i}"]`);
            els.forEach(el => {
              const ox = el.dataset.ox ?? '0';
              const oy = el.dataset.oy ?? '0';
              el.setAttribute(
                'transform',
                `translate(${ox},${oy}) scale(${s}) translate(${-Number(ox)},${-Number(oy)})`
              );
              el.setAttribute('opacity', String(s * 0.7));
            });

            // Animate trunk glow
            const glow = svg.querySelector<SVGCircleElement>(`[data-glow="${i}"]`);
            if (glow) {
              glow.setAttribute('r', String(10 + s * 20));
              glow.setAttribute('opacity', String(s * 0.15));
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (positions.length === 0 || dimensions.width === 0 || segments.length === 0) return null;

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
      <defs>
        <linearGradient id="trunk-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#b5e88a" />
          <stop offset="30%" stopColor="#7cc95e" />
          <stop offset="60%" stopColor="#4a9e3f" />
          <stop offset="100%" stopColor="#2d6e2e" />
        </linearGradient>
        <linearGradient id="branch-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5aad42" />
          <stop offset="100%" stopColor="#7cc95e" />
        </linearGradient>
        <linearGradient id="twig-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6abf4b" />
          <stop offset="100%" stopColor="#9ad87a" />
        </linearGradient>
        <radialGradient id="leaf-grad">
          <stop offset="0%" stopColor="#a3e060" />
          <stop offset="100%" stopColor="#5cb83c" />
        </radialGradient>
      </defs>

      <g ref={swayGroupRef}>
        {/* Trunk */}
        {trunk.map((seg, i) => (
          <path
            key={`t-${i}`}
            d={seg.path}
            fill="none"
            stroke="url(#trunk-grad)"
            strokeWidth={seg.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.55"
          />
        ))}

        {/* Trunk glow at each column — brightens near focused */}
        {Array.from(columnGroups.entries()).map(([colIdx, group]) => {
          const firstSeg = group.segments[0];
          if (!firstSeg) return null;
          const initialScale = targetScale(colIdx, focusedIndex);
          return (
            <circle
              key={`glow-${colIdx}`}
              data-glow={colIdx}
              cx={firstSeg.originX}
              cy={firstSeg.originY}
              r={10 + initialScale * 20}
              fill="#7cc95e"
              opacity={String(initialScale * 0.15)}
            />
          );
        })}

        {/* Per-column groups: branches + twigs + buds (animated scale) */}
        {Array.from(columnGroups.entries()).map(([colIdx, group]) => {
          // Use first segment's origin as the scale anchor
          const firstSeg = group.segments[0];
          const ox = firstSeg ? firstSeg.originX : 0;
          const oy = firstSeg ? firstSeg.originY : 0;
          const initialScale = targetScale(colIdx, focusedIndex);

          return (
            <g
              key={`col-${colIdx}`}
              data-col={colIdx}
              data-ox={ox}
              data-oy={oy}
              transform={`translate(${ox},${oy}) scale(${initialScale}) translate(${-ox},${-oy})`}
              opacity={String(initialScale * 0.7)}
            >
              {group.segments.map((seg, si) =>
                seg.depth === 1 ? (
                  <path
                    key={`b-${si}`}
                    d={seg.path}
                    fill="none"
                    stroke="url(#branch-grad)"
                    strokeWidth={seg.strokeWidth}
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    key={`w-${si}`}
                    d={seg.path}
                    fill="none"
                    stroke="url(#twig-grad)"
                    strokeWidth={seg.strokeWidth}
                    strokeLinecap="round"
                  />
                )
              )}
              {/* Buds */}
              {group.segments.map((seg, si) => (
                <circle
                  key={`bud-${si}`}
                  cx={seg.tipX}
                  cy={seg.tipY}
                  r={seg.depth === 1 ? 2.5 : 1.5}
                  fill="#7cc95e"
                />
              ))}
            </g>
          );
        })}
      </g>

      {/* Floating leaves + spores — grouped by column for scale animation */}
      {Array.from(columnGroups.entries()).map(([colIdx, group]) => {
        if (group.leaves.length === 0 && group.spores.length === 0) return null;
        const firstLeaf = group.leaves[0];
        const firstSpore = group.spores[0];
        const ox = firstLeaf?.originX ?? firstSpore?.originX ?? 0;
        const oy = firstLeaf?.originY ?? firstSpore?.originY ?? 0;
        const initialScale = targetScale(colIdx, focusedIndex);

        return (
          <g
            key={`particles-${colIdx}`}
            data-col={colIdx}
            data-ox={ox}
            data-oy={oy}
            transform={`translate(${ox},${oy}) scale(${initialScale}) translate(${-ox},${-oy})`}
            opacity={String(initialScale * 0.7)}
          >
            {/* Leaves */}
            {group.leaves.map(leaf => (
              <g key={`l-${leaf.id}`} opacity="0">
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values={`${leaf.x} ${leaf.y}; ${leaf.x + leaf.driftX * 0.3} ${leaf.y + leaf.driftY * 0.3}; ${leaf.x + leaf.driftX * 0.7} ${leaf.y + leaf.driftY * 0.7}; ${leaf.x + leaf.driftX} ${leaf.y + leaf.driftY}`}
                  dur={`${leaf.duration}s`}
                  begin={`${leaf.delay}s`}
                  repeatCount="indefinite"
                />
                <g>
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    values={`${leaf.rotation}; ${leaf.rotation + leaf.rotationDrift * 0.4}; ${leaf.rotation + leaf.rotationDrift * 0.8}; ${leaf.rotation + leaf.rotationDrift}`}
                    dur={`${leaf.duration}s`}
                    begin={`${leaf.delay}s`}
                    repeatCount="indefinite"
                  />
                  <g transform={`scale(${leaf.scale})`}>
                    <path d={LEAF_PATH} fill="url(#leaf-grad)" />
                    <line
                      x1="0"
                      y1="-2.5"
                      x2="0"
                      y2="2.5"
                      stroke="#3d8f30"
                      strokeWidth="0.4"
                      opacity="0.6"
                    />
                  </g>
                </g>
                <animate
                  attributeName="opacity"
                  values="0; 0.5; 0.5; 0"
                  keyTimes="0; 0.15; 0.7; 1"
                  dur={`${leaf.duration}s`}
                  begin={`${leaf.delay}s`}
                  repeatCount="indefinite"
                />
              </g>
            ))}

            {/* Spores — tiny drifting dots */}
            {group.spores.map(spore => (
              <g key={`s-${spore.id}`} opacity="0">
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  values={`${spore.x} ${spore.y}; ${spore.x + spore.driftX * 0.4} ${spore.y + spore.driftY * 0.4}; ${spore.x + spore.driftX * 0.8} ${spore.y + spore.driftY * 0.6}; ${spore.x + spore.driftX} ${spore.y + spore.driftY}`}
                  dur={`${spore.duration}s`}
                  begin={`${spore.delay}s`}
                  repeatCount="indefinite"
                />
                <circle r={spore.radius} fill="#b5e88a" />
                <animate
                  attributeName="opacity"
                  values="0; 0.6; 0.5; 0"
                  keyTimes="0; 0.2; 0.65; 1"
                  dur={`${spore.duration}s`}
                  begin={`${spore.delay}s`}
                  repeatCount="indefinite"
                />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
