import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMELINE_OVERVIEW_DAY_SPACING } from './timeline-overview-geometry';
import { useTimelineOverviewScroll } from './timeline-overview-scroll';

const days = Array.from({ length: 12 }, (_, index) => ({
  id: `day-${index}`,
  date: `2026-10-${String(index + 1).padStart(2, '0')}`
}));

describe('bottom timeline scrolling', () => {
  let root: Root;
  let container: HTMLDivElement;
  let scroller: HTMLDivElement | null;
  let viewportWidth: number;
  let onResize: (() => void) | undefined;
  const scrollTo = vi.fn((_options?: ScrollToOptions | number, _top?: number) => {});

  function Harness({ activeDayId }: { activeDayId: string }) {
    const { overviewRef, scrollerRef, pathRef, buttonRefs, handleScroll } =
      useTimelineOverviewScroll(days, activeDayId);
    return (
      <nav ref={overviewRef}>
        <div
          ref={element => {
            scrollerRef.current = element;
            scroller = element;
            if (element) {
              Object.defineProperties(element, {
                clientWidth: { configurable: true, get: () => viewportWidth },
                scrollWidth: {
                  configurable: true,
                  value: days.length * TIMELINE_OVERVIEW_DAY_SPACING + 32
                }
              });
              element.scrollTo = scrollTo;
            }
          }}
          onScroll={handleScroll}
        >
          <div
            ref={element => {
              pathRef.current = element;
              if (element)
                Object.defineProperty(element, 'offsetLeft', { configurable: true, value: 16 });
            }}
          >
            {days.map((day, index) => (
              <button
                key={day.id}
                ref={element => {
                  if (element) {
                    buttonRefs.current.set(day.id, element);
                    Object.defineProperties(element, {
                      offsetLeft: {
                        configurable: true,
                        value: index * TIMELINE_OVERVIEW_DAY_SPACING
                      },
                      offsetWidth: { configurable: true, value: TIMELINE_OVERVIEW_DAY_SPACING }
                    });
                  } else buttonRefs.current.delete(day.id);
                }}
              >
                {day.date}
              </button>
            ))}
          </div>
        </div>
      </nav>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    viewportWidth = 900;
    scroller = null;
    onResize = undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('reveals the latest day at the right edge without wasting half the viewport', () => {
    act(() => root.render(<Harness activeDayId="day-11" />));
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: days.length * TIMELINE_OVERVIEW_DAY_SPACING + 32 - viewportWidth,
      behavior: 'auto'
    });
  });

  it('keeps an arbitrary scroll position when the selected day is already visible', () => {
    act(() => root.render(<Harness activeDayId="day-1" />));
    if (!scroller) throw new Error('Missing scroller');
    scroller.scrollLeft = 87;
    scrollTo.mockClear();
    act(() => root.render(<Harness activeDayId="day-2" />));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scroller.scrollLeft).toBe(87);
  });

  it('moves only enough to reveal an off-screen selected day', () => {
    act(() => root.render(<Harness activeDayId="day-1" />));
    scrollTo.mockClear();
    act(() => root.render(<Harness activeDayId="day-11" />));
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: days.length * TIMELINE_OVERVIEW_DAY_SPACING + 32 - viewportWidth,
      behavior: 'smooth'
    });
  });

  it('keeps the selected day visible after resizing', () => {
    act(() => root.render(<Harness activeDayId="day-5" />));
    scrollTo.mockClear();
    viewportWidth = 390;
    act(() => onResize?.());
    expect(scrollTo).toHaveBeenLastCalledWith({
      left: 6 * TIMELINE_OVERVIEW_DAY_SPACING + 32 - viewportWidth,
      behavior: 'auto'
    });
  });
});
