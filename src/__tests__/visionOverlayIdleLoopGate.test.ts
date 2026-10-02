/**
 * visionOverlayIdleLoopGate.test.ts — VisionOverlay AR-kapalı idle loop gate (saha fix 2026-07-12).
 *
 * SAHA KANITI (Xiaomi zircon, WebView DevTools + /proc trace): idle harita ana thread'inin
 * ~yarısını (+compositor) VisionOverlay'in 60 fps rAF döngüsü yakıyordu — döngü AR/kamera
 * KAPALIYKEN bile koşulsuz yeniden planlanıyordu.
 * A/B nedensellik: döngü düşürülünce process 35%→20%, main-thread 11%→6%, gfx 5.2→0.3 fps.
 *
 * 2026-10-01 AR yeniden yazımında koruma DEĞİŞMEDİ, biçimi değişti: çizim döngüsü artık tek bir
 * effect'tir ve YALNIZ `arVisible` (AR gerçekten ekranda) iken kurulur; görünmezken hiç rAF
 * planlanmaz, effect temizliği döngüyü iptal eder. Ek olarak kare bütçesi AdaptiveRuntime
 * moduna bağlıdır ve tuval `willReadFrequently` (CPU'ya düşen tuval) ile AÇILMAZ.
 *
 * NOT: bu repo component-render testinde `renderToStaticMarkup` (SSR) kullanır — useEffect/rAF
 * ÇALIŞMAZ; fix KAYNAK-KİLİDİ ile korunur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src', 'components', 'map', 'VisionOverlay.tsx'),
  'utf8',
);

/** Çizim döngüsü effect'inin gövdesi (başlangıç → `}, [arVisible]);`). */
function loopEffect(): string {
  const start = SRC.indexOf('if (!arVisible) return;');
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf('}, [arVisible]);', start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('VisionOverlay — AR-kapalı idle loop gate', () => {
  it('1. döngü YALNIZ AR görünürken kurulur: kapı ilk rAF\'tan ÖNCE', () => {
    const body = loopEffect();
    expect(body.indexOf('if (!arVisible) return;')).toBe(0);
    expect(body).toMatch(/requestAnimationFrame\(draw\)/);
  });

  it('2. arVisible = gezinme + HYBRID mod (kamera görünmüyorsa döngü yok)', () => {
    expect(SRC).toContain('const arVisible  = isNavigating && isHybrid;');
  });

  it('3. temizlik döngüyü iptal eder (zero-leak)', () => {
    expect(loopEffect()).toMatch(/cancelAnimationFrame\(raf\)/);
  });

  it('4. kare bütçesi runtime moduna bağlı; gizli sekmede çizim yok', () => {
    expect(SRC).toMatch(/function frameIntervalMs\(\)/);
    expect(loopEffect()).toMatch(/document\.hidden \|\| now - lastDraw < frameIntervalMs\(\)/);
  });

  it('5. tuval CPU modunda açılmaz (willReadFrequently YOK)', () => {
    expect(SRC).not.toMatch(/willReadFrequently/);
  });
});
