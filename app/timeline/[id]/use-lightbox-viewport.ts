'use client';

import { useLayoutEffect } from 'react';
import { useMotionValue } from 'motion/react';

/** Mobile keyboards can resize and pan the visible viewport without resizing the layout. */
export function useLightboxViewport() {
  const top = useMotionValue(0);
  const left = useMotionValue(0);
  const width = useMotionValue<number | string>('100%');
  const height = useMotionValue<number | string>('100%');

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      top.set(viewport?.offsetTop ?? 0);
      left.set(viewport?.offsetLeft ?? 0);
      width.set(viewport?.width ?? window.innerWidth);
      height.set(viewport?.height ?? window.innerHeight);
    };
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [top, left, width, height]);

  return { top, left, width, height };
}
