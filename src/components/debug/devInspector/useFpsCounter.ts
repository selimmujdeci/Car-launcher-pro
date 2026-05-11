import { useEffect, useRef, useState } from 'react';

export function useFpsCounter(active: boolean): number {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const last   = useRef(0);
  const raf    = useRef(0);

  useEffect(() => {
    if (!active) {
      setFps(0);
      return;
    }
    last.current   = performance.now();
    frames.current = 0;

    function tick(now: number): void {
      frames.current++;
      const dt = now - last.current;
      if (dt >= 1000) {
        setFps(Math.round((frames.current * 1000) / dt));
        frames.current = 0;
        last.current   = now;
      }
      raf.current = requestAnimationFrame(tick);
    }

    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); };
  }, [active]);

  return fps;
}
