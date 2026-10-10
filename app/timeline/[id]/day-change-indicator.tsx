'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export function DayChangeIndicator({
  date,
  direction
}: {
  date: string;
  direction: 'prev' | 'next';
}) {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-36 z-30 flex justify-center">
      <AnimatePresence>
        {visible && (
          <motion.div
            role="status"
            className="flex items-center gap-2 rounded-full border border-white/20 bg-black/80 px-4 py-2.5 text-sm text-white shadow-sm backdrop-blur-sm"
            initial={{ opacity: 1, x: reducedMotion ? 0 : direction === 'next' ? 8 : -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <time dateTime={date}>
              {new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              })}
            </time>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
