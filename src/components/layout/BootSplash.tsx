import { memo, useEffect, useMemo, useState } from 'react';
import { VehicleEmblem, type ResolvedEmblem } from '../vehicle/VehicleEmblem';
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

/* ── Araç amblemli açılış (Ayarlar > Araç > Açılış ekranı) ───
 * İlk 3 kare hızlı oynar, son sahne CAR OS PRO logosu yerine aracın amblemi.
 * Toplam süre varsayılandan KISA; dokununca atlanır (çağıran `onSkip`). */
const EMBLEM_INTRO_FRAMES = 3;
const EMBLEM_STEP_MS = 450;
const EMBLEM_SCENE_MS = 2600;
export const EMBLEM_BOOT_SHOW_MS = EMBLEM_STEP_MS * EMBLEM_INTRO_FRAMES + EMBLEM_SCENE_MS;

export interface EmblemBootInfo {
  emblem: ResolvedEmblem;
  treatment: 'neon' | 'original';
  /** Yalnız bilinen veri; bilinmeyen alan verilmez (gösterilmez). */
  driverName?: string;
  line?: string;
  /** Düşük performans kademesinde ışık tozları çizilmez. */
  particles: boolean;
}

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export const BootSplash = memo(function BootSplash({ phase, emblem, onSkip }: {
  phase: BootPhase;
  emblem?: EmblemBootInfo | null;
  onSkip?: () => void;
}) {
  if (emblem) return <EmblemBootSplash phase={phase} info={emblem} onSkip={onSkip} />;
  return <CarOsBootSplash phase={phase} />;
});

const CarOsBootSplash = memo(function CarOsBootSplash({ phase }: { phase: BootPhase }) {
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

/* ── Amblemli açılış ─────────────────────────────────────────────────────── */

const DUST_COUNT = 56;

/** Işık tozlarının hedefleri: logo yolunun kenarı (ölçülebilirse), yoksa halka. */
function dustTargets(emblem: ResolvedEmblem, box: number): Array<[number, number]> {
  const k = box / 28;
  if (emblem.kind === 'logo' && typeof document !== 'undefined') {
    try {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', emblem.path);
      const len = p.getTotalLength();
      if (len > 0) {
        return Array.from({ length: DUST_COUNT }, (_, i) => {
          const pt = p.getPointAtLength((i / DUST_COUNT) * len);
          return [(pt.x + 2 - 14) * k, (pt.y + 2 - 14) * k];
        });
      }
    } catch { /* ölçülemedi → halka */ }
  }
  return Array.from({ length: DUST_COUNT }, (_, i) => {
    const a = (i / DUST_COUNT) * Math.PI * 2;
    return [Math.cos(a) * box * 0.35, Math.sin(a) * box * 0.35];
  });
}

const EmblemBootSplash = memo(function EmblemBootSplash({ phase, info, onSkip }: {
  phase: BootPhase; info: EmblemBootInfo; onSkip?: () => void;
}) {
  const [idx, setIdx] = useState(prefersReducedMotion ? EMBLEM_INTRO_FRAMES : 0);

  useEffect(() => {
    if (idx >= EMBLEM_INTRO_FRAMES) return;
    const t = setTimeout(() => setIdx((i) => i + 1), EMBLEM_STEP_MS);
    return () => clearTimeout(t);
  }, [idx]);

  const dust = useMemo(() => {
    if (!info.particles || prefersReducedMotion) return [];
    const box = Math.min(window.innerWidth, window.innerHeight) * 0.33;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return dustTargets(info.emblem, box).map(([tx, ty], i) => {
      const a = rnd() * Math.PI * 2, r = box * (1 + rnd() * 1.5);
      return {
        '--x': `${Math.cos(a) * r}px`, '--y': `${Math.sin(a) * r * 0.7}px`,
        '--tx': `${tx}px`, '--ty': `${ty}px`, '--d': `${(rnd() * 0.35).toFixed(2)}s`,
        '--c': i % 2 ? '#2f7bff' : '#ff7a1a',
      } as React.CSSProperties;
    });
  }, [info.particles, info.emblem]);

  if (phase === 'done') return null;
  const scene = idx >= EMBLEM_INTRO_FRAMES;

  return (
    <div data-testid="boot-emblem"
      className={`fixed inset-0 z-[5000] bg-black transition-opacity duration-500 ${phase === 'fade' ? 'opacity-0' : 'opacity-100'}`}
      onPointerDown={onSkip}>
      {FRAMES.slice(0, EMBLEM_INTRO_FRAMES).map((src, i) => (
        <img key={i} src={src} alt="" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
            opacity: !scene && i === idx ? 1 : 0, transition: 'opacity 320ms ease' }} />
      ))}
      {scene && (
        <div className="ve-boot" style={{ '--ve-brand': info.emblem.hex } as React.CSSProperties}>
          <div className="ve-aura" />
          <div className="ve-floor"><div className="ve-ring" /></div>
          <div className="ve-reflection"><VehicleEmblem emblem={info.emblem} treatment={info.treatment} variant="static" /></div>
          {dust.length > 0 && <div className="ve-dust">{dust.map((st, i) => <i key={i} style={st} />)}</div>}
          <div className="ve-emblem"><VehicleEmblem emblem={info.emblem} treatment={info.treatment} variant="scene" /></div>
          <div className="ve-vignette" />
          <div className="ve-copy">
            <p className="ve-hello">{info.driverName ? <>Hoş geldin, <b>{info.driverName}</b></> : 'Hoş geldin'}</p>
            {info.line && <p className="ve-meta">{info.line}</p>}
          </div>
          <p className="ve-mark">CAR OS <span>PRO</span></p>
        </div>
      )}
    </div>
  );
});
