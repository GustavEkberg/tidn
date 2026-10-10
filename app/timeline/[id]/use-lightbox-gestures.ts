'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useSyncExternalStore,
  type RefObject
} from 'react';
import { animate, useMotionValue, type MotionValue } from 'motion/react';

type Point = { x: number; y: number };
type Transform = Point & { scale: number };
type Gesture =
  | { type: 'swipe'; start: Point; axis: 'x' | 'y' | null }
  | { type: 'pan'; start: Point; transform: Transform }
  | { type: 'pinch'; midpoint: Point; distance: number; transform: Transform }
  | { type: 'idle' };

const MAX_ZOOM = 5;
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function useLightboxGestures({
  mediaId,
  areaRef,
  isPhoto,
  canGoPrev,
  canGoNext,
  dragX,
  dragY,
  onNavigate,
  onClose,
  onTap,
  onPeek
}: {
  mediaId: string | undefined;
  areaRef: RefObject<HTMLDivElement | null>;
  isPhoto: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  dragX: MotionValue<number>;
  dragY: MotionValue<number>;
  onNavigate: (direction: 'prev' | 'next') => void;
  onClose: () => void;
  onTap: (isTouch: boolean) => void;
  onPeek: (direction: 'prev' | 'next' | null) => void;
}) {
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const subscribe = useCallback((callback: () => void) => scale.on('change', callback), [scale]);
  const zoomed = useSyncExternalStore(
    subscribe,
    () => scale.get() > 1,
    () => false
  );

  const resetZoom = useCallback(() => {
    scale.jump(1);
    x.jump(0);
    y.jump(0);
  }, [scale, x, y]);

  const applyZoom = useCallback(
    (next: Transform) => {
      const area = areaRef.current;
      if (!area) return;
      const image = area.querySelector('[data-lightbox-current] [data-lightbox-image]');
      if (!(image instanceof HTMLImageElement)) return;
      const zoom = Math.max(1, Math.min(MAX_ZOOM, next.scale));
      const bounds = area.getBoundingClientRect();
      // offset dimensions are untransformed; portrait/landscape images have different pan limits.
      const maxX = Math.max(0, (image.offsetWidth * zoom - bounds.width) / 2);
      const maxY = Math.max(0, (image.offsetHeight * zoom - bounds.height) / 2);
      scale.set(zoom);
      x.set(clamp(next.x, maxX));
      y.set(clamp(next.y, maxY));
    },
    [areaRef, scale, x, y]
  );

  const zoomBy = useCallback(
    (factor: number, anchor: Point = { x: 0, y: 0 }) => {
      const nextScale = Math.max(1, Math.min(MAX_ZOOM, scale.get() * factor));
      const ratio = nextScale / scale.get();
      applyZoom({
        scale: nextScale,
        x: anchor.x - (anchor.x - x.get()) * ratio,
        y: anchor.y - (anchor.y - y.get()) * ratio
      });
    },
    [applyZoom, scale, x, y]
  );

  useLayoutEffect(() => {
    resetZoom();
    dragX.jump(0);
    dragY.jump(0);
    onPeek(null);
  }, [mediaId, resetZoom, dragX, dragY, onPeek]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area || !mediaId) return;
    const pointers = new Map<number, Point>();
    let gesture: Gesture = { type: 'idle' };
    let moved = false;
    let multiTouch = false;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    let lastTap: { point: Point; time: number } | undefined;

    const readTransform = (): Transform => ({ scale: scale.get(), x: x.get(), y: y.get() });
    const relativePoint = (point: Point): Point => {
      const bounds = area.getBoundingClientRect();
      return {
        x: point.x - bounds.left - bounds.width / 2,
        y: point.y - bounds.top - bounds.height / 2
      };
    };
    const springBack = () => {
      animate(dragX, 0, { type: 'spring', stiffness: 300, damping: 30 });
      animate(dragY, 0, { type: 'spring', stiffness: 300, damping: 30 });
    };
    const startPinch = () => {
      const [a, b] = pointers.values();
      if (!a || !b) return;
      clearTimeout(tapTimer);
      lastTap = undefined;
      multiTouch = true;
      moved = true;
      dragX.jump(0);
      dragY.jump(0);
      onPeek(null);
      gesture = {
        type: 'pinch',
        midpoint: relativePoint(midpoint(a, b)),
        distance: Math.max(1, distance(a, b)),
        transform: readTransform()
      };
    };

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest('[data-lightbox-controls]'))
        return;
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      area?.setPointerCapture(event.pointerId);
      if (pointers.size > 1) {
        if (isPhoto && event.pointerType === 'touch') startPinch();
        else {
          multiTouch = true;
          gesture = { type: 'idle' };
          springBack();
        }
        return;
      }
      dragX.stop();
      dragY.stop();
      moved = false;
      multiTouch = false;
      gesture =
        isPhoto && scale.get() > 1
          ? { type: 'pan', start: point, transform: readTransform() }
          : { type: 'swipe', start: point, axis: null };
    }

    function onPointerMove(event: PointerEvent) {
      if (!pointers.has(event.pointerId)) return;
      const point = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, point);
      if (gesture.type === 'pinch') {
        const [a, b] = pointers.values();
        if (!a || !b) return;
        const mid = relativePoint(midpoint(a, b));
        const nextScale = Math.max(
          1,
          Math.min(MAX_ZOOM, (gesture.transform.scale * distance(a, b)) / gesture.distance)
        );
        const ratio = nextScale / gesture.transform.scale;
        applyZoom({
          scale: nextScale,
          x: mid.x - (gesture.midpoint.x - gesture.transform.x) * ratio,
          y: mid.y - (gesture.midpoint.y - gesture.transform.y) * ratio
        });
        return;
      }
      if (gesture.type === 'idle') return;
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
      if (gesture.type === 'pan') {
        applyZoom({
          ...gesture.transform,
          x: gesture.transform.x + dx,
          y: gesture.transform.y + dy
        });
      } else {
        if (!gesture.axis && moved) gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (gesture.axis === 'x') {
          onPeek(dx < 0 ? 'next' : 'prev');
          dragX.set((!canGoPrev && dx > 0) || (!canGoNext && dx < 0) ? dx * 0.15 : dx);
          dragY.set(0);
        } else if (gesture.axis === 'y') {
          dragX.set(0);
          dragY.set(dy);
        }
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (area?.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
        // Cancellation must never navigate, dismiss, or toggle controls.
        gesture = { type: 'idle' };
        multiTouch = true;
        springBack();
        return;
      }
      if (pointers.size > 0) {
        if (pointers.size >= 2 && isPhoto) {
          startPinch();
          return;
        }
        const [remaining] = pointers.values();
        gesture =
          remaining && isPhoto
            ? { type: 'pan', start: remaining, transform: readTransform() }
            : { type: 'idle' };
        return;
      }
      const ended = gesture;
      gesture = { type: 'idle' };
      if (multiTouch) return;
      if (ended.type === 'swipe') {
        const dx = event.clientX - ended.start.x;
        const dy = event.clientY - ended.start.y;
        if (ended.axis === 'y' && Math.abs(dy) > 120) {
          onClose();
          return;
        }
        const threshold = (area?.getBoundingClientRect().width ?? window.innerWidth) * 0.2;
        if (
          ended.axis === 'x' &&
          ((dx < -threshold && canGoNext) || (dx > threshold && canGoPrev))
        ) {
          onNavigate(dx < 0 ? 'next' : 'prev');
          return;
        }
        springBack();
      }
      if (!moved) {
        const point = { x: event.clientX, y: event.clientY };
        const now = Date.now();
        if (
          isPhoto &&
          event.pointerType === 'touch' &&
          lastTap &&
          now - lastTap.time < 300 &&
          distance(lastTap.point, point) < 30
        ) {
          clearTimeout(tapTimer);
          lastTap = undefined;
          if (scale.get() > 1) resetZoom();
          else zoomBy(2.5, relativePoint(point));
        } else {
          lastTap = { point, time: now };
          if (event.pointerType === 'touch') tapTimer = setTimeout(() => onTap(true), 300);
          else onTap(false);
        }
      }
    }

    const resizeObserver = new ResizeObserver(() => applyZoom(readTransform()));
    resizeObserver.observe(area);
    area.addEventListener('pointerdown', onPointerDown);
    area.addEventListener('pointermove', onPointerMove);
    area.addEventListener('pointerup', onPointerUp);
    area.addEventListener('pointercancel', onPointerUp);
    area.addEventListener('lostpointercapture', onPointerUp);
    return () => {
      clearTimeout(tapTimer);
      resizeObserver.disconnect();
      area.removeEventListener('pointerdown', onPointerDown);
      area.removeEventListener('pointermove', onPointerMove);
      area.removeEventListener('pointerup', onPointerUp);
      area.removeEventListener('pointercancel', onPointerUp);
      area.removeEventListener('lostpointercapture', onPointerUp);
      for (const id of pointers.keys()) {
        if (area.hasPointerCapture(id)) area.releasePointerCapture(id);
      }
    };
  }, [
    areaRef,
    mediaId,
    isPhoto,
    canGoPrev,
    canGoNext,
    dragX,
    dragY,
    scale,
    x,
    y,
    applyZoom,
    resetZoom,
    zoomBy,
    onNavigate,
    onClose,
    onTap,
    onPeek
  ]);

  return { scale, x, y, zoomed, zoomBy, resetZoom };
}
