import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMotionValue } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLightboxGestures } from './use-lightbox-gestures';

describe('lightbox gestures', () => {
  let container: HTMLDivElement;
  let root: Root;
  let area: HTMLDivElement;
  let controller: ReturnType<typeof useLightboxGestures> | undefined;
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  const onTap = vi.fn();
  const onPeek = vi.fn();

  function Harness({ mediaId = 'photo-1' }: { mediaId?: string }) {
    const areaRef = useRef<HTMLDivElement>(null);
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);
    controller = useLightboxGestures({
      mediaId,
      areaRef,
      isPhoto: true,
      canGoPrev: true,
      canGoNext: true,
      dragX,
      dragY,
      onNavigate,
      onClose,
      onTap,
      onPeek
    });
    return (
      <div ref={areaRef}>
        <div data-lightbox-current>
          {/* eslint-disable-next-line @next/next/no-img-element -- Test fixture */}
          <img alt="Test photo" data-lightbox-image />
        </div>
        <button data-lightbox-controls>Control</button>
      </div>
    );
  }

  function pointer(
    type: string,
    id: number,
    x: number,
    y: number,
    target: Element = area,
    pointerType = 'touch'
  ) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: id });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    act(() => target.dispatchEvent(event));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
    const element = container.firstElementChild;
    if (!(element instanceof HTMLDivElement)) throw new Error('Missing gesture area');
    area = element;
    const captured = new Set<number>();
    Object.defineProperties(area, {
      setPointerCapture: { value: (id: number) => captured.add(id) },
      hasPointerCapture: { value: (id: number) => captured.has(id) },
      releasePointerCapture: { value: (id: number) => captured.delete(id) }
    });
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 400));
    const image = area.querySelector('img');
    if (!image) throw new Error('Missing photo');
    Object.defineProperties(image, {
      offsetWidth: { value: 400 },
      offsetHeight: { value: 300 }
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    controller = undefined;
  });

  function pinch() {
    pointer('pointerdown', 1, 150, 200);
    pointer('pointerdown', 2, 250, 200);
    pointer('pointermove', 1, 100, 200);
    pointer('pointermove', 2, 300, 200);
  }

  it('pinches to zoom without swiping or dismissing, then pans with the remaining finger', () => {
    pinch();
    expect(controller?.scale.get()).toBe(2);
    pointer('pointerup', 2, 300, 200);
    pointer('pointermove', 1, 180, 280);
    expect(controller?.x.get()).toBe(80);
    expect(controller?.y.get()).toBe(80);
    pointer('pointerup', 1, 180, 280);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('clamps panning to the scaled image bounds', () => {
    pinch();
    pointer('pointerup', 2, 300, 200);
    pointer('pointermove', 1, 1000, 1000);
    expect(controller?.x.get()).toBe(200);
    expect(controller?.y.get()).toBe(100);
    pointer('pointerup', 1, 1000, 1000);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not turn a pinch back to fit into a swipe', () => {
    pinch();
    pointer('pointermove', 1, 150, 200);
    pointer('pointermove', 2, 250, 200);
    expect(controller?.scale.get()).toBe(1);
    pointer('pointerup', 2, 250, 200);
    pointer('pointermove', 1, 0, 350);
    pointer('pointerup', 1, 0, 350);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retains one-finger navigation and vertical dismissal at fit', () => {
    pointer('pointerdown', 1, 300, 200);
    pointer('pointermove', 1, 100, 200);
    pointer('pointerup', 1, 100, 200);
    expect(onNavigate).toHaveBeenCalledWith('next');
    pointer('pointerdown', 1, 200, 100);
    pointer('pointermove', 1, 200, 300);
    pointer('pointerup', 1, 200, 300);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not dismiss on pointer cancellation', () => {
    pointer('pointerdown', 1, 200, 100);
    pointer('pointermove', 1, 200, 300);
    pointer('pointercancel', 1, 200, 300);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('double-taps to zoom and resets on a different photo', () => {
    pointer('pointerdown', 1, 200, 200);
    pointer('pointerup', 1, 200, 200);
    pointer('pointerdown', 1, 200, 200);
    pointer('pointerup', 1, 200, 200);
    expect(controller?.scale.get()).toBe(2.5);
    expect(onTap).not.toHaveBeenCalled();
    act(() => root.render(<Harness mediaId="photo-2" />));
    expect(controller?.scale.get()).toBe(1);
    expect(controller?.x.get()).toBe(0);
    expect(controller?.y.get()).toBe(0);
  });

  it('leaves controls outside gesture handling', () => {
    const control = area.querySelector('button');
    if (!control) throw new Error('Missing control');
    pointer('pointerdown', 1, 200, 100, control);
    pointer('pointermove', 1, 200, 300);
    pointer('pointerup', 1, 200, 300);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resets zoom with a double-tap on a zoomed image', () => {
    pinch();
    pointer('pointerup', 2, 300, 200);
    pointer('pointerup', 1, 100, 200);
    pointer('pointerdown', 1, 200, 200);
    pointer('pointerup', 1, 200, 200);
    pointer('pointerdown', 1, 200, 200);
    pointer('pointerup', 1, 200, 200);
    expect(controller?.scale.get()).toBe(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('keeps desktop clicks immediate without adding mouse zoom', () => {
    pointer('pointerdown', 1, 200, 200, area, 'mouse');
    pointer('pointerup', 1, 200, 200, area, 'mouse');
    pointer('pointerdown', 1, 200, 200, area, 'mouse');
    pointer('pointerup', 1, 200, 200, area, 'mouse');
    expect(controller?.scale.get()).toBe(1);
    expect(onTap).toHaveBeenCalledTimes(2);
    expect(onTap).toHaveBeenCalledWith(false);
  });
});
