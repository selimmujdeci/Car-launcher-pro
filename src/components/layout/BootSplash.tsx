import { memo, useEffect, useState } from 'react';
import frame1 from '../../assets/boot-anim/frame1.png';
import frame2 from '../../assets/boot-anim/frame2.png';
import frame3 from '../../assets/boot-anim/frame3.png';
import frame4 from '../../assets/boot-anim/frame4.png';
import frame5 from '../../assets/boot-anim/frame5.png';
import frame6 from '../../assets/boot-anim/frame6.png';

export type BootPhase = 'show' | 'fade' | 'done';

/* ── Açılış animasyonu — 6 kareli sinematik sekans ───
 * Storyboard kareleri (SİSTEM BAŞLIYOR → … → CAR OS PRO logosu) sırayla
 * cross-fade ile oynatılır; son kare (logo) açılış bitene kadar kalır.
 * Görseller birebir kullanılır (src/assets/boot-anim). */
const FRAMES = [frame1, frame2, frame3, frame4, frame5, frame6];
const STEP_MS = 850;                                        // kare başına süre
const HOLD_LAST_MS = 1000;                                  // son logo karesinde bekleme
export const BOOT_SHOW_MS = STEP_MS * (FRAMES.length - 1) + HOLD_LAST_MS; // fade'e kadar
export const BOOT_FADE_MS = 420;

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export const BootSplash = memo(function BootSplash({ phase }: { phase: BootPhase }) {
  // Reduced-motion: animasyonu atla, doğrudan son kareyi (logo) göster.
  const [idx, setIdx] = useState(prefersReducedMotion ? FRAMES.length - 1 : 0);

  useEffect(() => {
    if (prefersReducedMotion || idx >= FRAMES.length - 1) return;
    const t = setTimeout(() => setIdx((i) => i + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [idx]);

  if (phase === 'done') return null;

  return (
    <div
      className={`fixed inset-0 z-[5000] bg-black pointer-events-none transition-opacity duration-500 ${
        phase === 'fade' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {FRAMES.map((src, i) => (
        <img
          key={i}
          src={src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain', // tüm kare + alt yazı görünür; siyah letterbox siyah zemine kaynaşır
            opacity: i === idx ? 1 : 0,
            transition: 'opacity 420ms ease',
          }}
        />
      ))}
    </div>
  );
});
