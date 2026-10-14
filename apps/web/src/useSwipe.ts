import { useRef, type TouchEvent } from 'react';

const IGNORE = '.sc, .year-scroll, .recharts-wrapper, input, select, textarea, [role="slider"], .sheet, .overlay';

export function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const p = e.touches[0];
      const blocked = (e.target as HTMLElement).closest(IGNORE) || p.clientX < 24;
      start.current = blocked ? null : { x: p.clientX, y: p.clientY, t: Date.now() };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - s.t > 600) return;
      if (dx < 0) onNext();
      else onPrev();
    },
  };
}
