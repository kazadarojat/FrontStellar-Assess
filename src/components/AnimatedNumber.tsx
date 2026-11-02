import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number | null | undefined;
  format: (value: number) => string;
  className?: string;
  duration?: number;
}

function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.reducedMotion === 'true') return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Angka yang bergerak halus menuju nilai baru, dengan hormat pada reduced motion. */
export default function AnimatedNumber({
  value,
  format,
  className,
  duration = 620,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState<number | null>(value ?? null);
  const currentRef = useRef<number | null>(value ?? null);
  const frameRef = useRef(0);
  const timeoutRef = useRef(0);

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      currentRef.current = null;
      setDisplay(null);
      return;
    }

    const from = currentRef.current;
    if (from == null || prefersReducedMotion()) {
      currentRef.current = value;
      setDisplay(value);
      return;
    }
    if (Math.abs(value - from) < 0.001) {
      currentRef.current = value;
      setDisplay(value);
      return;
    }

    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (value - from) * eased;
      currentRef.current = next;
      setDisplay(next);
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        currentRef.current = value;
        setDisplay(value);
      }
    };

    frameRef.current = window.requestAnimationFrame(step);
    // Fallback: requestAnimationFrame dapat ditahan saat tab/window tidak terlihat.
    // Pastikan angka akhir tetap muncul walau animasi tidak pernah berjalan.
    timeoutRef.current = window.setTimeout(() => {
      currentRef.current = value;
      setDisplay(value);
    }, duration + 120);
    return () => {
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(timeoutRef.current);
    };
  }, [value, duration]);

  if (display == null || !Number.isFinite(display)) {
    return <span className={className}>—</span>;
  }

  return <span className={className}>{format(display)}</span>;
}
