'use client';

import { useEffect, useMemo, useRef } from 'react';

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
// TYPES
// ============================================================

type BranchPoint = { readonly x: number; readonly y: number };

type Branch = {
  readonly path: string;
  readonly tipX: number;
  readonly tipY: number;
  readonly points: ReadonlyArray<BranchPoint>;
  readonly strokeWidth: number;
  readonly depth: number;
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
};

type Spore = {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly radius: number;
  readonly delay: number;
  readonly duration: number;
};

// ============================================================
// GEOMETRY
// ============================================================

function buildJaggedBranch(
  startX: number,
  startY: number,
  angleDeg: number,
  length: number,
  rand: () => number,
  jitter: number = 25,
  numSegments: number = 6
): { path: string; tipX: number; tipY: number; points: Array<BranchPoint> } {
  const segLen = length / numSegments;
  let currentAngle = angleDeg;
  let x = startX;
  let y = startY;

  const points: Array<BranchPoint> = [{ x, y }];
  let d = `M ${x},${y}`;

  for (let i = 0; i < numSegments; i++) {
    const jitterScale = 1 - (i / numSegments) * 0.4;
    currentAngle += randRange(rand, -jitter, jitter) * jitterScale;

    const rad = (currentAngle * Math.PI) / 180;
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

const LEAF_PATH =
  'M 0,-4 C 2.5,-3.5 4,-1.5 4,0 C 4,1.5 2.5,3.5 0,3 C -2.5,3.5 -4,1.5 -4,0 C -4,-1.5 -2.5,-3.5 0,-4 Z';

// ============================================================
// TREE GENERATION (viewport-filling ambient tree)
// ============================================================

function generateAuthTree(width: number, height: number) {
  const branches: Array<Branch> = [];
  const leaves: Array<Leaf> = [];
  const spores: Array<Spore> = [];
  let leafId = 0;
  let sporeId = 0;

  const rand = makeRand(314159);

  // Trunk: wanders vertically from left to right
  const centerY = height * 0.55;
  const trunkPoints: Array<{ x: number; y: number }> = [];
  let cy = centerY + randRange(rand, -50, 50);
  const numWaypoints = 16;

  for (let i = 0; i <= numWaypoints; i++) {
    const x = (i / numWaypoints) * width;
    cy += randRange(rand, -40, 40);
    cy = Math.max(height * 0.3, Math.min(height * 0.75, cy));
    trunkPoints.push({ x, y: cy });
  }

  const trunkPath = catmullRomPath(trunkPoints);

  // Interpolate trunk Y at any X
  const trunkYAt = (targetX: number): number => {
    for (let j = 0; j < trunkPoints.length - 1; j++) {
      const a = trunkPoints[j];
      const b = trunkPoints[j + 1];
      if (a.x <= targetX && b.x >= targetX) {
        const t = b.x === a.x ? 0 : (targetX - a.x) / (b.x - a.x);
        return a.y + (b.y - a.y) * t;
      }
    }
    return centerY;
  };

  // Generate clusters of branches along the trunk
  const clusterCount = 10 + Math.floor(rand() * 4);
  for (let c = 0; c < clusterCount; c++) {
    const cx = randRange(rand, width * 0.03, width * 0.97);
    const originY = trunkYAt(cx);
    const clusterRand = makeRand(Math.round(cx * 17) + c * 53);
    const branchCount = 3 + Math.floor(clusterRand() * 6);

    for (let b = 0; b < branchCount; b++) {
      const goUp = clusterRand() > 0.5;
      const angle = goUp ? randRange(clusterRand, -155, -25) : randRange(clusterRand, 25, 155);
      const length = randRange(clusterRand, 100, 350);
      const strokeWidth = randRange(clusterRand, 1.0, 2.8);

      const branch = buildJaggedBranch(cx, originY, angle, length, clusterRand, 22, 5);
      branches.push({ ...branch, strokeWidth, depth: 1 });

      // Twigs — spawn from actual branch waypoints
      const twigCount = Math.floor(clusterRand() * 3);
      for (let t = 0; t < twigCount; t++) {
        const along = randRange(clusterRand, 0.3, 0.85);
        const ptIdx = Math.floor(along * (branch.points.length - 1));
        const twigX = branch.points[ptIdx].x;
        const twigY = branch.points[ptIdx].y;
        const twigAngle = angle + randRange(clusterRand, -55, 55);
        const twigLen = randRange(clusterRand, 50, 140);
        const twigStroke = randRange(clusterRand, 0.5, 1.5);

        const twig = buildJaggedBranch(twigX, twigY, twigAngle, twigLen, clusterRand, 28, 4);
        branches.push({ ...twig, strokeWidth: twigStroke, depth: 2 });

        // Leaf at twig tip
        if (clusterRand() < 0.65) {
          leaves.push({
            id: leafId++,
            x: twig.tipX,
            y: twig.tipY,
            driftX: randRange(clusterRand, -45, 45),
            driftY: randRange(clusterRand, 15, 50),
            rotation: clusterRand() * 360,
            rotationDrift: randRange(clusterRand, -120, 120),
            scale: randRange(clusterRand, 0.45, 1.0),
            delay: clusterRand() * 12,
            duration: randRange(clusterRand, 6, 12)
          });
        }
      }

      // Leaf at branch tip
      if (clusterRand() < 0.5) {
        leaves.push({
          id: leafId++,
          x: branch.tipX,
          y: branch.tipY,
          driftX: randRange(clusterRand, -40, 40),
          driftY: randRange(clusterRand, 15, 45),
          rotation: clusterRand() * 360,
          rotationDrift: randRange(clusterRand, -100, 100),
          scale: randRange(clusterRand, 0.5, 1.0),
          delay: clusterRand() * 10,
          duration: randRange(clusterRand, 5, 10)
        });
      }

      // Spores along branch
      const sporeCount = Math.floor(clusterRand() * 3);
      for (let sp = 0; sp < sporeCount; sp++) {
        const along = randRange(clusterRand, 0.2, 1.0);
        spores.push({
          id: sporeId++,
          x: cx + (branch.tipX - cx) * along + randRange(clusterRand, -15, 15),
          y: originY + (branch.tipY - originY) * along + randRange(clusterRand, -15, 15),
          driftX: randRange(clusterRand, -30, 30),
          driftY: randRange(clusterRand, -20, 25),
          radius: randRange(clusterRand, 0.8, 2.2),
          delay: clusterRand() * 14,
          duration: randRange(clusterRand, 5, 10)
        });
      }
    }
  }

  return { trunkPath, branches, leaves, spores };
}

// ============================================================
// COMPONENT
// ============================================================

export function AuthBackground() {
  const svgRef = useRef<SVGSVGElement>(null);
  const swayRef = useRef<SVGGElement>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  const tree = useMemo(() => generateAuthTree(1920, 1080), []);

  // Gentle sway animation
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    let lastTime = performance.now();

    function tick(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      phaseRef.current += dt * 0.4;

      if (swayRef.current) {
        const x = Math.sin(phaseRef.current * 0.6) * 2.5;
        const y = Math.sin(phaseRef.current * 0.4 + 1.2) * 1.8;
        swayRef.current.setAttribute('transform', `translate(${x},${y})`);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="auth-trunk" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#b5e88a" />
          <stop offset="30%" stopColor="#7cc95e" />
          <stop offset="60%" stopColor="#4a9e3f" />
          <stop offset="100%" stopColor="#2d6e2e" />
        </linearGradient>
        <linearGradient id="auth-branch" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5aad42" />
          <stop offset="100%" stopColor="#7cc95e" />
        </linearGradient>
        <linearGradient id="auth-twig" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6abf4b" />
          <stop offset="100%" stopColor="#9ad87a" />
        </linearGradient>
        <radialGradient id="auth-leaf">
          <stop offset="0%" stopColor="#a3e060" />
          <stop offset="100%" stopColor="#5cb83c" />
        </radialGradient>
      </defs>

      <g ref={swayRef} opacity="0.35">
        {/* Trunk */}
        <path
          d={tree.trunkPath}
          fill="none"
          stroke="url(#auth-trunk)"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.6"
        />

        {/* Branches + twigs */}
        {tree.branches.map((seg, i) => (
          <path
            key={`b-${i}`}
            d={seg.path}
            fill="none"
            stroke={seg.depth === 1 ? 'url(#auth-branch)' : 'url(#auth-twig)'}
            strokeWidth={seg.strokeWidth}
            strokeLinecap="round"
          />
        ))}

        {/* Buds at tips */}
        {tree.branches.map((seg, i) => (
          <circle
            key={`bud-${i}`}
            cx={seg.tipX}
            cy={seg.tipY}
            r={seg.depth === 1 ? 2.2 : 1.3}
            fill="#7cc95e"
          />
        ))}
      </g>

      {/* Floating leaves */}
      {tree.leaves.map(leaf => (
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
              <path d={LEAF_PATH} fill="url(#auth-leaf)" />
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
            values="0; 0.3; 0.25; 0"
            keyTimes="0; 0.15; 0.7; 1"
            dur={`${leaf.duration}s`}
            begin={`${leaf.delay}s`}
            repeatCount="indefinite"
          />
        </g>
      ))}

      {/* Spores */}
      {tree.spores.map(spore => (
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
            values="0; 0.35; 0.3; 0"
            keyTimes="0; 0.2; 0.65; 1"
            dur={`${spore.duration}s`}
            begin={`${spore.delay}s`}
            repeatCount="indefinite"
          />
        </g>
      ))}
    </svg>
  );
}
