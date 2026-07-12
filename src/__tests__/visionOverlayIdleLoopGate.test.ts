/**
 * visionOverlayIdleLoopGate.test.ts — VisionOverlay AR-kapalı idle loop gate (saha fix 2026-07-12).
 *
 * SAHA KANITI (Xiaomi zircon, WebView DevTools + /proc trace): idle harita ana thread'inin
 * ~yarısını (+compositor) `VisionOverlay.renderAR` 60 fps rAF döngüsü yakıyordu. Döngü, AR/kamera
 * KAPALIYKEN bile (`!frame || !isHybrid || confidenceLevel==='off'`) `requestAnimationFrame(renderAR)`
 * ile KOŞULSUZ yeniden planlanıyor, FullMapView mount olduğu sürece asla durmuyordu.
 *
 * A/B nedensellik (cihaz, geri alınabilir DevTools trace): VisionOverlay rAF düşürülünce
 * process 35%→20%, main-thread 11%→6%, gfx 5.2→0.3 fps (idle harita hedefe ulaştı).
 *
 * FIX: AR kapalıyken döngüyü DURDUR (rafRef=null, reschedule YOK). Yeniden başlatma otomatik:
 * renderAR deps (isHybrid/confidenceLevel/vision.frame/currentLat/currentLon) değişince renderAR
 * yeniden yaratılır → `useEffect([renderAR])` döngüyü tekrar başlatır. Aktif AR çizim yolu DEĞİŞMEZ.
 *
 * NOT: bu repo component-render testinde `renderToStaticMarkup` (SSR) kullanır — useEffect/rAF
 * ÇALIŞMAZ ve jsdom'da `createRoot` import edilemez (bkz. safetyContext.test.tsx). Bu yüzden fix
 * KAYNAK-KİLİDİ ile korunur: off-path'in döngüyü durdurduğu + aktif yolun bozulmadığı doğrulanır.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src', 'components', 'map', 'VisionOverlay.tsx'),
  'utf8',
);

/** renderAR fonksiyon gövdesini kabaca izole et (useCallback → dep dizisi sonu). */
function renderARBody(): string {
  const start = SRC.indexOf('const renderAR = useCallback(');
  expect(start).toBeGreaterThan(-1);
  // renderAR useCallback'in dep dizisine kadar (currentStepIndex]) al
  const depEnd = SRC.indexOf('currentStepIndex]', start);
  expect(depEnd).toBeGreaterThan(start);
  return SRC.slice(start, depEnd);
}

/** off-branch (AR kapalı skip bloğu) metnini izole et. */
function offBranch(): string {
  const body = renderARBody();
  const cond = body.indexOf("!isHybrid || confidenceLevel === 'off'");
  expect(cond).toBeGreaterThan(-1);
  // koşuldan sonraki ilk `}` kapanışına kadarki blok
  const braceOpen = body.indexOf('{', cond);
  const braceClose = body.indexOf('}', braceOpen);
  expect(braceClose).toBeGreaterThan(braceOpen);
  return body.slice(braceOpen, braceClose + 1);
}

describe('VisionOverlay — AR-kapalı idle loop gate', () => {
  it('1. off-branch döngüyü DURDURUR: rafRef.current = null', () => {
    expect(offBranch()).toMatch(/rafRef\.current\s*=\s*null/);
  });

  it('2. off-branch requestAnimationFrame ÇAĞIRMAZ (60fps boşa dönme regresyonu)', () => {
    // Bu kilidin ASIL amacı: kimse off-branch'e `requestAnimationFrame(renderAR)` geri koymasın.
    expect(offBranch()).not.toMatch(/requestAnimationFrame/);
  });

  it('3. AKTİF AR yolu korunur: renderAR sonunda hâlâ requestAnimationFrame(renderAR) var', () => {
    // Döngü aktif çizimde kendini yeniden planlamaya devam etmeli (AR bozulmasın).
    const body = renderARBody();
    expect(body).toMatch(/rafRef\.current\s*=\s*requestAnimationFrame\(renderAR\)/);
  });

  it('4. yeniden başlatma mekanizması: useEffect [renderAR] rAF başlatır (dep değişince restart)', () => {
    // renderAR deps'i off/on koşulunu (isHybrid/confidenceLevel/vision.frame) içermeli,
    // ve bir useEffect [renderAR] ile döngüyü kurmalı → AR açılınca otomatik restart.
    expect(SRC).toMatch(/\}, \[isHybrid, confidenceLevel[\s\S]*?currentStepIndex\]\);/);
    expect(SRC).toMatch(/useEffect\(\(\) => \{\s*rafRef\.current = requestAnimationFrame\(renderAR\);[\s\S]*?\}, \[renderAR\]\);/);
  });

  it('5. cleanup korunur (zero-leak): cancelAnimationFrame unmount\'ta', () => {
    expect(SRC).toMatch(/cancelAnimationFrame\(rafRef\.current\)/);
  });
});
