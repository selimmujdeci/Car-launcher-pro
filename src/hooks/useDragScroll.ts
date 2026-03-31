import { useRef, useCallback, type PointerEvent, type MouseEvent } from 'react';

export function useDragScroll() {
  const ref      = useRef<HTMLDivElement>(null);
  const startX   = useRef(0);
  const scrollL  = useRef(0);
  const ptId     = useRef<number | null>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    startX.current   = e.clientX;
    scrollL.current  = ref.current?.scrollLeft ?? 0;
    ptId.current     = e.pointerId;
    dragging.current = false;
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (ptId.current === null || !ref.current) return;
    const dx = e.clientX - startX.current;
    if (!dragging.current && Math.abs(dx) > 6) {
      dragging.current = true;
      ref.current.setPointerCapture(ptId.current);
      ref.current.style.cursor = 'grabbing';
    }
    if (dragging.current) {
      ref.current.scrollLeft = scrollL.current - dx;
    }
  }, []);

  const onPointerUp = useCallback(() => {
    ptId.current     = null;
    dragging.current = false;
    if (ref.current) ref.current.style.cursor = '';
  }, []);

  const onClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (dragging.current) e.stopPropagation();
  }, []);

  return { ref, onPointerDown, onPointerMove, onPointerUp, onClick };
}
