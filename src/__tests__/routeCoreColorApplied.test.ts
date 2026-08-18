/**
 * routeCoreColorApplied.test.ts — #633 KİLİDİ
 * "Kararın yarısı uygulandı" durumu (kılıf gece · çekirdek gündüz) imkânsız olmalı.
 *
 * ── NEDEN VAR (cihazda ÖLÇÜLDÜ, 2026-08-18 18:07, Xiaomi 23090RA98I) ────────
 * Gece moduna geçildiğinde rota boyası CANLI okundu:
 *
 *     kılıf     `#ffffff`   ← gece kararı UYGULANMIŞ
 *     çekirdek  `#1A73E8`   ← GÜNDÜZ rengi, DEĞİŞMEMİŞ
 *
 * `#1A73E8`in WCAG bağıl parlaklığı **0,183**. #623'te cihazda piksel
 * taramasıyla ölçülen çekirdek **0,128–0,184** idi — üst sınırda BİREBİR.
 * Beklenen gece rengi `#79b0ff` → **0,423**. Yani iki turdur "gece rotası
 * soluk" diye aranan şeyin kaynağı palet DEĞİL, kararın yarısının
 * uygulanmasıydı.
 *
 * ── KÖK: İKİ KARAR NOKTASI, İKİ FARKLI AN ──────────────────────────────────
 * Kaynağın `lineMetrics` yeteneği KURULUM anında sabitlenir (`!_isLowEnd`),
 * ama boya yazan yol `_isPerfLowSurface()`i YAZMA anında yeniden okuyordu.
 * `perf-low` sınıfı çalışma anında değişebilir (#599'da kanıtlandı). İki an
 * ayrışınca `line-gradient`, onu desteklemeyen bir kaynağa yazılıyor ve YAZIM
 * ÖLÜ KALIYOR — çekirdek kurulum renginde donuyordu. Hata `safeSetPaint`in
 * try/catch'i tarafından yutulduğu için hiçbir yerde iz bırakmıyordu.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. Çekirdeğin `line-color`'ı KOŞULSUZ yazılır (gradient yalnız EK'tir).
 *   2. Gradient yalnız kaynağın GERÇEKTEN desteklediği yerde yazılır ve bu
 *      bilgi hesaplanmaz, kurulumdan HATIRLANIR.
 *   3. Rota temizlenince yetenek de unutulur.
 *   4. Gece ve gündüz çekirdek renkleri gerçekten AYRIDIR ve gece olan,
 *      cihazda ölçülen soluk değerin BELİRGİN ÜSTÜNDEDİR.
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRouteColor } from '../platform/map/core/routeColorModel';

const SRC = readFileSync(
  join(process.cwd(), 'src', 'platform', 'map', 'MapLayerManager.ts'), 'utf8');

/** WCAG bağıl parlaklık — ölçüm aracı, göz kararı değil. */
function lum(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`hex değil: ${hex}`);
  const v = m[1];
  const ch = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

describe('#633 — çekirdek rengi HER KOŞULDA yazılır', () => {
  it('🔒 `line-color` koşulsuz, gradient yalnız EK olarak yazılır', () => {
    const fn = SRC.slice(
      SRC.indexOf('function _applyRouteColorDecision'),
      SRC.indexOf('export function syncRouteColor'),
    );
    expect(fn.length).toBeGreaterThan(200);

    const colorAt = fn.indexOf("SEL_LAYER, 'line-color', d.coreStops[0]");
    const gradAt  = fn.indexOf("SEL_LAYER, 'line-gradient'");
    expect(colorAt, 'çekirdek düz rengi hiç yazılmıyor').toBeGreaterThan(-1);
    expect(gradAt, 'gradient yazımı yok').toBeGreaterThan(-1);
    expect(colorAt, 'düz renk gradientten SONRA yazılıyor — sıra yanlış')
      .toBeLessThan(gradAt);

    /* Düz renk bir `else` dalında OLMAMALI: gradient uygulanamazsa geriye
       kurulum rengi kalır ve kusur aynen geri döner. */
    const before = fn.slice(Math.max(0, colorAt - 220), colorAt);
    expect(before, 'düz renk yine koşullu dalda — "kararın yarısı" durumu geri geldi')
      .not.toMatch(/}\s*else\s*{\s*$/);
  });

  it('🔒 yazma yolu `perf-low` sınıfını YENİDEN OKUMAZ', () => {
    const fn = SRC.slice(
      SRC.indexOf('function _applyRouteColorDecision'),
      SRC.indexOf('export function syncRouteColor'),
    );
    expect(fn, 'yazma anı yine DOM sınıfına bakıyor — kurulum anıyla ayrışır')
      .not.toContain('_isPerfLowSurface()');
    expect(fn, 'kaynağın hatırlanan yeteneği kullanılmıyor')
      .toContain('_routeSrcLineMetrics');
  });

  it('🔒 yetenek kurulumda HATIRLANIR ve temizlikte UNUTULUR', () => {
    /* Kurulumda `lineMetrics` ile aynı değerden yazılır. */
    expect(SRC).toMatch(/lineMetrics:\s*!_isLowEnd/);
    expect(SRC).toMatch(/_routeSrcLineMetrics\s*=\s*!_isLowEnd/);
    /* Rota temizlenince sıfırlanır — yoksa sonraki kurulum eski yeteneği varsayar. */
    const clearFn = SRC.slice(SRC.indexOf('export function clearRouteGeometry'));
    expect(clearFn.slice(0, 3000), 'temizlikte yetenek unutulmuyor')
      .toMatch(/_routeSrcLineMetrics\s*=\s*false/);
  });

  it('🔒 kurulum yolunda da düz renk KOŞULSUZ yazılır', () => {
    const setup = SRC.slice(SRC.indexOf('const _coreFillPaint'), SRC.indexOf('id: SEL_LAYER'));
    expect(setup).toMatch(/_coreFillPaint\['line-color'\]\s*=\s*_rc\.coreStops\[0\]/);
    const colorAt = setup.indexOf("_coreFillPaint['line-color']");
    const gradAt  = setup.indexOf("_coreFillPaint['line-gradient']");
    expect(colorAt).toBeGreaterThan(-1);
    if (gradAt > -1) {
      expect(colorAt, 'kurulumda düz renk gradientten sonra/koşullu yazılıyor')
        .toBeLessThan(gradAt);
    }
  });
});

describe('#633 — gece çekirdeği cihazda ölçülen SOLUK değerin üstünde', () => {
  const day   = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: true });
  const night = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false });

  it('🔒 gündüz ve gece çekirdek renkleri AYRIDIR', () => {
    expect(night.coreStops[0].toLowerCase())
      .not.toBe(day.coreStops[0].toLowerCase());
  });

  it('🔒 cihazda ölçülen soluk değer (0,183) GÜNDÜZ rengidir — gece değil', () => {
    /* Sahada gece'de bu renk okunmuştu; kilit onun gündüze ait olduğunu sabitler. */
    expect(lum(day.coreStops[0])).toBeLessThan(0.25);
    expect(lum(night.coreStops[0]), 'gece çekirdeği soluk kalmış')
      .toBeGreaterThan(0.35);
  });

  it('🔒 gece çekirdeği #623 hedefini (0,42) karşılar', () => {
    const l = lum(night.coreStops[0]);
    expect(l).toBeGreaterThan(0.38);
    expect(l).toBeLessThan(0.50);
  });

  it('🔒 karar anahtarı zemin kutbunu taşır (gece↔gündüz dedup\'a takılmaz)', () => {
    expect(night.routeColorKey).not.toBe(day.routeColorKey);
  });
});
