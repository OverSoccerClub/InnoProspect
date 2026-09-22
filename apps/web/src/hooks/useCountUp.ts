'use client';

import { useEffect, useState } from 'react';

/**
 * Anima um número de 0 até `target` (ease-out). Desliga sozinho em
 * `prefers-reduced-motion: reduce` — cai direto pro valor final, sem
 * `requestAnimationFrame` nenhum (não é só "mais rápido", é NENHUMA
 * animação, como o resto do projeto já trata movimento).
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    if (target === 0) {
      setValue(0);
      return;
    }

    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
