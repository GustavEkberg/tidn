'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useReducedMotion } from 'motion/react';

// ============================================================
// TYPES
// ============================================================

type DateGroupInfo = {
  readonly eventCount: number;
  readonly mediaCount: number;
};

type BackgroundTimelineProps = {
  dateGroups: ReadonlyArray<DateGroupInfo>;
  focusedIndex: number;
  /** Which column (if any) has its media stack fanned out */
  fannedColumnIndex: number | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  columnRefs: React.RefObject<Map<number, HTMLDivElement>>;
};

// ============================================================
// HELPERS
// ============================================================

function seededWobble(seed: number): number {
  const x = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Catmull-rom spline → cubic bezier path */
function splinePath(
  points: ReadonlyArray<{ x: number; y: number }>,
  tension: number = 0.35
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

/** Evaluate approximate position on path at t ∈ [0,1] using point array lerp */
function lerpOnPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
  t: number
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (points.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, points.length - 1);
  const frac = idx - lo;
  return {
    x: points[lo].x + (points[hi].x - points[lo].x) * frac,
    y: points[lo].y + (points[hi].y - points[lo].y) * frac
  };
}

// ============================================================
// PARTICLE SYSTEM
// ============================================================

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  /** 0 = spine particle, 1 = burst particle */
  kind: 0 | 1;
  /** Base opacity */
  baseAlpha: number;
};

function createSpineParticle(
  points: ReadonlyArray<{ x: number; y: number }>,
  _height: number
): Particle {
  const t = Math.random();
  const pos = lerpOnPoints(points, t);
  return {
    x: pos.x + (Math.random() - 0.5) * 30,
    y: pos.y + (Math.random() - 0.5) * 40,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.2,
    life: 0,
    maxLife: 120 + Math.random() * 180,
    size: 1 + Math.random() * 2,
    kind: 0,
    baseAlpha: 0.03 + Math.random() * 0.06
  };
}

function createBurstParticle(cx: number, cy: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 1 + Math.random() * 3;
  return {
    x: cx + (Math.random() - 0.5) * 10,
    y: cy + (Math.random() - 0.5) * 10,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0,
    maxLife: 40 + Math.random() * 40,
    size: 1.5 + Math.random() * 2.5,
    kind: 1,
    baseAlpha: 0.1 + Math.random() * 0.15
  };
}

// ============================================================
// MAIN COMPONENT — Canvas-based
// ============================================================

export function BackgroundTimeline({
  dateGroups,
  focusedIndex,
  fannedColumnIndex,
  scrollContainerRef,
  columnRefs
}: BackgroundTimelineProps) {
  const prefersReduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Mutable state refs (avoid re-renders in animation loop)
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const scrollVelRef = useRef(0);
  const lastScrollRef = useRef(0);
  const particlesRef = useRef<Array<Particle>>([]);
  const spinePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const nodePositionsRef = useRef<Array<{ x: number; y: number }>>([]);
  const timeRef = useRef(0);
  const burstQueueRef = useRef<Array<{ x: number; y: number; count: number }>>([]);
  const prevFannedRef = useRef<number | null>(null);

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // ---- Measure ----
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
      const wobble = (seededWobble(idx * 37) - 0.5) * 24;
      positions.push({ x: colCenter, y: centerY + wobble });
    });

    positions.sort((a, b) => a.x - b.x);
    nodePositionsRef.current = positions;

    // Build spine points with edges
    const spinePoints = [{ x: 0, y: centerY }, ...positions, { x: scrollWidth, y: centerY }];
    spinePointsRef.current = spinePoints;
  }, [scrollContainerRef, columnRefs]);

  // ---- Sizing + measure ----
  useEffect(() => {
    measure();
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure, dateGroups.length, scrollContainerRef]);

  useEffect(() => {
    const timer = setTimeout(measure, 350);
    return () => clearTimeout(timer);
  }, [focusedIndex, measure]);

  // ---- Canvas sizing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [dimensions]);

  // ---- Mouse tracking (relative to scroll container) ----
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleMouseMove(e: MouseEvent) {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Convert to scroll-content coordinates
      mouseRef.current = {
        x: e.clientX - rect.left + container.scrollLeft,
        y: e.clientY - rect.top
      };
    }

    function handleMouseLeave() {
      mouseRef.current = { x: -9999, y: -9999 };
    }

    container.addEventListener('mousemove', handleMouseMove, { passive: true });
    container.addEventListener('mouseleave', handleMouseLeave, { passive: true });
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [scrollContainerRef]);

  // ---- Scroll velocity tracking ----
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    function handleScroll() {
      if (!container) return;
      const currentScroll = container.scrollLeft;
      scrollVelRef.current = currentScroll - lastScrollRef.current;
      lastScrollRef.current = currentScroll;
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef]);

  // ---- Burst when media fans out ----
  useEffect(() => {
    if (fannedColumnIndex !== null && fannedColumnIndex !== prevFannedRef.current) {
      const pos = nodePositionsRef.current[fannedColumnIndex];
      if (pos) {
        const group = dateGroups[fannedColumnIndex];
        const count = group ? 6 + group.mediaCount * 2 : 8;
        burstQueueRef.current.push({ x: pos.x, y: pos.y, count: Math.min(count, 24) });
      }
    }
    prevFannedRef.current = fannedColumnIndex;
  }, [fannedColumnIndex, dateGroups]);

  // ---- Animation loop ----
  useEffect(() => {
    if (prefersReduced || dimensions.width === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get foreground color from CSS variable
    const computedStyle = getComputedStyle(document.documentElement);
    const fgRaw = computedStyle.getPropertyValue('--foreground').trim();

    // Parse oklch or fallback
    function getFgRgb(): { r: number; g: number; b: number } {
      // Create a temp element to resolve the CSS color
      const el = document.createElement('div');
      el.style.color = `oklch(${fgRaw})`;
      document.body.appendChild(el);
      const resolved = getComputedStyle(el).color;
      document.body.removeChild(el);

      const match = resolved.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
      }
      return { r: 0, g: 0, b: 0 }; // fallback to black
    }

    const fg = getFgRgb();
    const fgStr = (a: number) => `rgba(${fg.r}, ${fg.g}, ${fg.b}, ${a})`;

    // Target particle count based on number of groups
    const targetParticles = Math.min(60, 10 + dateGroups.length * 4);

    function tick() {
      if (!ctx || !canvas) return;
      const w = dimensions.width;
      const h = dimensions.height;
      const time = timeRef.current++;

      ctx.clearRect(0, 0, w, h);

      const spinePoints = spinePointsRef.current;
      const nodePositions = nodePositionsRef.current;
      const mouse = mouseRef.current;
      const scrollVel = scrollVelRef.current;
      const absVel = Math.abs(scrollVel);

      // Decay scroll velocity
      scrollVelRef.current *= 0.92;

      // ---- SPINE LINE ----
      // Draw with time-based wobble affected by scroll velocity
      if (spinePoints.length >= 2) {
        const wobbleAmp = 3 + absVel * 0.3;
        const wobbledPoints = spinePoints.map((p, i) => ({
          x: p.x,
          y:
            p.y +
            Math.sin(time * 0.015 + i * 1.2) * wobbleAmp +
            Math.cos(time * 0.008 + i * 0.7) * wobbleAmp * 0.5
        }));

        const pathStr = splinePath(wobbledPoints, 0.35);

        // Main line
        ctx.save();
        ctx.globalAlpha = 0.07 + absVel * 0.002;
        ctx.strokeStyle = fgStr(1);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const path2d = new Path2D(pathStr);
        ctx.stroke(path2d);
        ctx.restore();

        // Ghost line — offset, dashed
        ctx.save();
        ctx.globalAlpha = 0.035;
        ctx.strokeStyle = fgStr(1);
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 7]);
        ctx.lineDashOffset = -time * 0.5;
        ctx.beginPath();
        ctx.stroke(path2d);
        ctx.restore();

        // Second ghost — slower dash drift
        ctx.save();
        ctx.globalAlpha = 0.02;
        ctx.strokeStyle = fgStr(1);
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 12]);
        ctx.lineDashOffset = time * 0.3;
        const offsetPoints = wobbledPoints.map((p, i) => ({
          x: p.x,
          y: p.y + Math.sin(time * 0.01 + i) * 8
        }));
        const ghostPath = new Path2D(splinePath(offsetPoints, 0.3));
        ctx.stroke(ghostPath);
        ctx.restore();
      }

      // ---- NODES ----
      for (let i = 0; i < nodePositions.length; i++) {
        const pos = nodePositions[i];
        const group = dateGroups[i];
        if (!pos || !group) continue;

        const isFocused = i === focusedIndex;
        const isFanned = i === fannedColumnIndex;
        const mediaCount = group.mediaCount;
        const baseR = 3 + Math.min(mediaCount, 10) * 0.7;
        const r = isFocused ? baseR * 1.5 : baseR;

        // Wobble position
        const nx = pos.x + Math.sin(time * 0.02 + i * 2.1) * 2;
        const ny = pos.y + Math.cos(time * 0.015 + i * 1.7) * 2;

        // Glow ring — bigger when focused or fanned
        const glowR = isFanned ? r * 3.5 : isFocused ? r * 2.5 : r * 1.5;
        const glowAlpha = isFanned ? 0.08 : isFocused ? 0.04 : 0.015;
        const gradient = ctx.createRadialGradient(nx, ny, 0, nx, ny, glowR);
        gradient.addColorStop(0, fgStr(glowAlpha));
        gradient.addColorStop(1, fgStr(0));
        ctx.beginPath();
        ctx.fillStyle = gradient;
        ctx.arc(nx, ny, glowR, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.fillStyle = fgStr(isFocused ? 0.2 : 0.06);
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fill();

        // Pulsing ring when focused
        if (isFocused) {
          const pulseR = r + 4 + Math.sin(time * 0.04) * 4;
          ctx.beginPath();
          ctx.strokeStyle = fgStr(0.08 + Math.sin(time * 0.04) * 0.04);
          ctx.lineWidth = 0.5;
          ctx.arc(nx, ny, pulseR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Orbiting dots for event count
        if (mediaCount > 1) {
          const count = Math.min(mediaCount, 8);
          for (let j = 0; j < count; j++) {
            const angle = (j / count) * Math.PI * 2 + time * 0.008 + i * 0.5;
            const orbitR = r + 6 + seededWobble(i * 100 + j) * 4;
            const ox = nx + Math.cos(angle) * orbitR;
            const oy = ny + Math.sin(angle) * orbitR;
            const dotR = 0.5 + seededWobble(i * 50 + j) * 0.8;
            ctx.beginPath();
            ctx.fillStyle = fgStr(isFocused ? 0.15 : 0.05);
            ctx.arc(ox, oy, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // ---- MOUSE GLOW ----
      if (mouse.x > -1000) {
        const glowSize = 80 + absVel * 0.5;
        const mouseGrad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, glowSize);
        mouseGrad.addColorStop(0, fgStr(0.04));
        mouseGrad.addColorStop(0.5, fgStr(0.015));
        mouseGrad.addColorStop(1, fgStr(0));
        ctx.beginPath();
        ctx.fillStyle = mouseGrad;
        ctx.arc(mouse.x, mouse.y, glowSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- PARTICLES ----
      const particles = particlesRef.current;

      // Spawn spine particles to maintain target count
      while (particles.length < targetParticles && spinePoints.length > 1) {
        particles.push(createSpineParticle(spinePoints, h));
      }

      // Process burst queue
      for (const burst of burstQueueRef.current) {
        for (let b = 0; b < burst.count; b++) {
          particles.push(createBurstParticle(burst.x, burst.y));
        }
      }
      burstQueueRef.current = [];

      // Update + draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;

        if (p.life > p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        // Life curve: fade in, sustain, fade out
        const lifeFrac = p.life / p.maxLife;
        const fadeIn = Math.min(lifeFrac * 5, 1);
        const fadeOut = Math.min((1 - lifeFrac) * 5, 1);
        const alpha = p.baseAlpha * fadeIn * fadeOut;

        // Mouse repulsion
        if (mouse.x > -1000) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100 && dist > 0) {
            const force = ((100 - dist) / 100) * 0.8;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }

        // Scroll push
        p.vx += scrollVel * 0.01;

        // Friction
        p.vx *= 0.97;
        p.vy *= 0.97;

        p.x += p.vx;
        p.y += p.vy;

        // Draw
        ctx.beginPath();
        ctx.fillStyle = fgStr(alpha);
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Burst particles leave a trail
        if (p.kind === 1 && alpha > 0.03) {
          ctx.beginPath();
          ctx.fillStyle = fgStr(alpha * 0.4);
          ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, p.size * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ---- TRAVELING DOTS along spine ----
      if (spinePoints.length > 1) {
        const dotCount = 3;
        for (let d = 0; d < dotCount; d++) {
          const speed = 0.0003 + d * 0.0001 + absVel * 0.00005;
          const t = (time * speed + d * 0.33) % 1;
          const pos = lerpOnPoints(spinePoints, t);
          const wobX = Math.sin(time * 0.03 + d * 2) * 4;
          const wobY = Math.cos(time * 0.02 + d * 3) * 3;
          ctx.beginPath();
          ctx.fillStyle = fgStr(0.1 + absVel * 0.003);
          ctx.arc(pos.x + wobX, pos.y + wobY, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [prefersReduced, dimensions, dateGroups, focusedIndex, fannedColumnIndex, scrollContainerRef]);

  if (prefersReduced || dateGroups.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{ width: dimensions.width, height: dimensions.height }}
      aria-hidden="true"
    />
  );
}
