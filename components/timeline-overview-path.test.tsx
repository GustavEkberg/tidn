import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineOverviewPath } from './timeline-overview-path';
import { TimelineTree, generateTimelineTree } from './timeline-tree';
import {
  createTimelineOverviewPoints,
  TIMELINE_OVERVIEW_DAY_SPACING,
  TIMELINE_OVERVIEW_HEIGHT
} from './timeline-overview-geometry';

const days = [
  { id: 'older', date: '2026-10-14', mediaCount: 8 },
  { id: 'middle', date: '2026-10-15', mediaCount: 2 },
  { id: 'latest', date: '2026-10-16', mediaCount: 10 }
];

describe('miniature timeline tree', () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: Array<FrameRequestCallback>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    frames = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('includes the main tree’s floating leaves and spores, not just static branches', () => {
    act(() => root.render(<TimelineOverviewPath days={days} activeDayId="latest" />));
    expect(container.querySelector('animateTransform[type="translate"]')).not.toBeNull();
    expect(container.querySelector('animateTransform[type="rotate"]')).not.toBeNull();
  });

  it('keeps unselected days clearly visible even beyond the selected day’s neighbors', () => {
    act(() => root.render(<TimelineOverviewPath days={days} activeDayId="latest" />));
    for (const index of [0, 1]) {
      const branches = container.querySelector(`[data-col="${index}"]`);
      expect(branches).not.toBeNull();
      expect(Number(branches?.getAttribute('opacity'))).toBeGreaterThanOrEqual(0.5);
      expect(
        Number(branches?.getAttribute('transform')?.match(/scale\(([^)]+)\)/)?.[1])
      ).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('scales the same paths and particle animations without changing their geometry or timing', () => {
    const scale = 0.22;
    const width = (days.length * TIMELINE_OVERVIEW_DAY_SPACING) / scale;
    const height = TIMELINE_OVERVIEW_HEIGHT / scale;
    const positions = createTimelineOverviewPoints(days).map(point => ({
      x: point.x / scale,
      y: point.y / scale,
      width: TIMELINE_OVERVIEW_DAY_SPACING / scale
    }));
    act(() =>
      root.render(
        <>
          <TimelineTree
            dateGroups={days}
            positions={positions}
            width={width}
            height={height}
            centerY={height / 2}
            focusedIndex={2}
          />
          <TimelineOverviewPath days={days} activeDayId="latest" />
        </>
      )
    );
    const [main, miniature] = container.querySelectorAll('svg');
    if (!main || !miniature) throw new Error('Missing trees');
    expect(miniature.getAttribute('viewBox')).toBe(main.getAttribute('viewBox'));
    expect(Number(miniature.getAttribute('width'))).toBeCloseTo(
      Number(main.getAttribute('width')) * scale
    );
    expect(Number(miniature.getAttribute('height'))).toBeCloseTo(
      Number(main.getAttribute('height')) * scale
    );
    const paths = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll('[data-col="1"] path, [data-col="2"] path')).map(path => ({
        path: path.getAttribute('d'),
        width: path.getAttribute('stroke-width')
      }));
    expect(paths(miniature)).toEqual(paths(main));
    const animations = (svg: SVGSVGElement) =>
      Array.from(
        svg.querySelectorAll(
          '[data-col="1"] animate, [data-col="1"] animateTransform, [data-col="2"] animate, [data-col="2"] animateTransform'
        )
      ).map(animation => animation.outerHTML);
    expect(animations(miniature)).toEqual(animations(main));
    expect(main.querySelector('[data-col="0"]')).toBeNull();
    expect(miniature.querySelector('[data-col="0"]')).not.toBeNull();
    const ids = Array.from(container.querySelectorAll('[id]')).map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('animates selection changes while retaining a visible baseline for every other day', () => {
    act(() => root.render(<TimelineOverviewPath days={days} activeDayId="middle" />));
    act(() => root.render(<TimelineOverviewPath days={days} activeDayId="latest" />));
    const pending = frames.splice(0);
    act(() => pending.forEach(callback => callback(performance.now() + 100)));
    const active = container.querySelector('[data-col="2"]');
    const adjacent = container.querySelector('[data-col="1"]');
    expect(Number(active?.getAttribute('opacity'))).toBeGreaterThan(0.25 * 0.7);
    expect(Number(active?.getAttribute('opacity'))).toBeLessThan(0.7);
    expect(Number(adjacent?.getAttribute('opacity'))).toBeGreaterThan(0.25 * 0.7);
    expect(Number(adjacent?.getAttribute('opacity'))).toBeLessThan(0.7);
    const resting = container.querySelector('[data-col="0"]');
    expect(resting?.getAttribute('opacity')).toBe('0.6');
    for (const branches of [active, adjacent]) {
      const scale = Number(branches?.getAttribute('transform')?.match(/scale\(([^)]+)\)/)?.[1]);
      expect(scale).toBeGreaterThan(0.6);
      expect(scale).toBeLessThan(1);
    }
  });

  it('keeps a day’s branch shape when its index changes between the main window and overview', () => {
    const day = days[2];
    const position = { x: 400, y: 300, width: 360 };
    const main = generateTimelineTree([position], [day], 300, 800, 0);
    const overview = generateTimelineTree(
      [{ x: 100, y: 300, width: 120 }, position],
      [days[0], day],
      300,
      800,
      1
    );
    expect(
      overview.segments.filter(segment => segment.columnIndex === 1).map(segment => segment.path)
    ).toEqual(
      main.segments.filter(segment => segment.columnIndex === 0).map(segment => segment.path)
    );
    expect(
      overview.leaves.filter(leaf => leaf.columnIndex === 1).map(leaf => leaf.duration)
    ).toEqual(main.leaves.map(leaf => leaf.duration));
  });

  it('keeps date markers and small branches in place when no day is selected', () => {
    act(() => root.render(<TimelineOverviewPath days={days} activeDayId={null} />));
    const clusters = container.querySelectorAll('[data-col]');
    expect(clusters).toHaveLength(days.length);
    clusters.forEach(cluster => expect(cluster.getAttribute('opacity')).toBe('0.6'));
    const markers = container.querySelectorAll('circle[stroke]');
    expect(markers).toHaveLength(days.length);
    const points = createTimelineOverviewPoints(days);
    markers.forEach((marker, index) => {
      expect(Number(marker.getAttribute('cx')) * 0.22).toBeCloseTo(points[index].x);
      expect(Number(marker.getAttribute('cy')) * 0.22).toBeCloseTo(points[index].y);
    });
  });

  it('stops the animation loop when the overview unmounts', () => {
    act(() => root.render(<TimelineOverviewPath days={days} activeDayId="latest" />));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(1);
  });
});
