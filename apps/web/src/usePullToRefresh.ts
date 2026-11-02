import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function usePullToRefresh(threshold = 72) {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const inSheet = (e.target as HTMLElement).closest('.sheet, .overlay');
      startY.current = window.scrollY <= 0 && !inSheet ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null || busyRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      // Segura o scroll nativo enquanto puxa pra baixo: sem isso, o "bounce"
      // elástico do navegador soma com a nossa animação e o ícone pisca atrás
      // do que está acima dele por um frame.
      if (dy > 0 && e.cancelable) e.preventDefault();
      pullRef.current = dy > 0 ? Math.min(dy, threshold * 1.4) : 0;
      setPull(pullRef.current);
    };
    const onEnd = async () => {
      if (startY.current == null) return;
      const hit = pullRef.current >= threshold;
      startY.current = null;
      pullRef.current = 0;
      setPull(0);
      if (!hit || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await qc.invalidateQueries();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [qc, threshold]);

  return { pull, busy, ready: pull >= threshold };
}
