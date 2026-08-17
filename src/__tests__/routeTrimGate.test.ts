/**
 * routeTrimGate.test.ts — KİLİT: kat edilen rota SEGMENT SINIRINI BEKLEMEZ.
 *
 * ── NEDEN BU DOSYA VAR (kütük #601, cihazda ölçüldü 2026-08-16) ────────────
 * Kullanıcı: *"rota arkasına siliniyor ama geç kalıyor; aracın arkası mavi
 * olmamalı."* Kırpma yalnız `prog.segIdx` değişince çiziliyordu.
 *
 * Adana-Şanlıurfa Otoyolu · 277,1 km · 2711 OSRM segmenti · 115 km/h ölçümü:
 *   segment p50  88 m →  2,8 s   ·  p90 188 m →  5,9 s
 *   segment p99 340 m → 10,6 s   ·  MAX 1956 m → 61,2 s
 * Yani en kötü durumda ~2 km rota, bir dakika boyunca aracın arkasında kalıyordu.
 *
 * Bu kilit iki şeyi birden korur:
 *   (a) aynı segment içinde ilerleyince kırpma TETİKLENİR (kusurun kendisi),
 *   (b) duran araçta GPS drift'i kırpma TETİKLEMEZ (eşiğin varlık sebebi).
 * Biri uğruna diğeri feda edilirse test düşer.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldTrimRoute,
  nextTrimMark,
  EMPTY_TRIM_MARK,
  ROUTE_TRIM_ADVANCE_M,
  type RouteTrimMark,
} from '../platform/map/routeTrimGate';

/** Otoyol ekseninde, verilen metre kadar KUZEYE kaydırılmış nokta. */
function ilerlet(lat: number, metre: number): number {
  return lat + metre / 111_320;
}

const GEOM_A = [[37.0, 37.2], [37.1, 37.3]];
const GEOM_B = [[37.0, 37.2], [37.1, 37.31]]; // farklı REFERANS = reroute

describe('routeTrimGate — kat edilen rota kırpma kapısı', () => {
  it('KİLİT: ilk çizim her zaman tetiklenir', () => {
    expect(shouldTrimRoute(EMPTY_TRIM_MARK, {
      segIdx: 0, lon: 37.2, lat: 37.0, geom: GEOM_A,
    })).toBe(true);
  });

  it('KİLİT: segment indeksi değişince tetiklenir (eski davranış KORUNDU)', () => {
    const prev: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    expect(shouldTrimRoute(prev, {
      segIdx: 6, lon: 37.2, lat: 37.0, geom: GEOM_A,
    })).toBe(true);
  });

  it('KİLİT: reroute (geometri REFERANSI değişti) anında tetiklenir', () => {
    const prev: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    expect(shouldTrimRoute(prev, {
      segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_B,
    })).toBe(true);
  });

  /* ── #601'in ta kendisi ────────────────────────────────────────────── */

  it('KİLİT: AYNI segment içinde eşiği aşan ilerleme tetikler (#601 kusuru)', () => {
    const prev: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    expect(shouldTrimRoute(prev, {
      segIdx: 5, lon: 37.2, lat: ilerlet(37.0, ROUTE_TRIM_ADVANCE_M + 5), geom: GEOM_A,
    }), 'aynı segment içinde 30 m ilerledi — çizgi arkada kalmamalı').toBe(true);
  });

  it('KİLİT: 1956 m\'lik otoyol segmenti içinde defalarca tetiklenir', () => {
    /* Ölçülen en uzun segment. Eski kapıyla bu 1956 m boyunca TEK bir çizim
       vardı (61,2 s gecikme). Yeni kapıyla 25 m'de bir tetiklenmeli. */
    /* Adım 30 m: `ilerlet` derece→metre yaklaşımı (111 320 m/derece) haversine
       ile birebir aynı değildir; eşiğe EŞİT adım seçmek testi kayan-nokta
       toleransına bağımlı kılardı. 30 m eşiğin güvenle üstündedir. */
    const ADIM_M = 30;
    let mark: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    let tetikleme = 0;
    for (let m = ADIM_M; m <= 1956; m += ADIM_M) {
      const next = { segIdx: 5, lon: 37.2, lat: ilerlet(37.0, m), geom: GEOM_A };
      if (shouldTrimRoute(mark, next)) { tetikleme++; mark = nextTrimMark(next); }
    }
    const beklenen = Math.floor(1956 / ADIM_M);          // 65
    expect(tetikleme, `uzun segment içinde her ~${ADIM_M} m'de kırpma yenilenmeli`)
      .toBeGreaterThanOrEqual(beklenen - 2);
    /* Eski davranışın kanıtı: segment sabit olduğu için ESKİ kapı bu döngüde
       hiç tetiklenmezdi (1956 m boyunca TEK çizim → 61,2 s gecikme). */
    expect(tetikleme).toBeGreaterThan(1);
  });

  /* ── Eşiğin varlık sebebi: duran araçta drift ──────────────────────── */

  it('KİLİT: duran araçta GPS drift\'i (≈2 m) kırpma TETİKLEMEZ', () => {
    /* Aynı sürüşte GPS doğruluğu 1,6–2,2 m ölçüldü. Eşik bu gürültünün ~10
       katıdır; drift boşuna GL yazımı üretmemeli. */
    const prev: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    expect(shouldTrimRoute(prev, {
      segIdx: 5, lon: 37.2, lat: ilerlet(37.0, 2.2), geom: GEOM_A,
    })).toBe(false);
  });

  it('KİLİT: eşiğin hemen ALTI tetiklemez, eşiğin KENDİSİ tetikler', () => {
    const prev: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    expect(shouldTrimRoute(prev, {
      segIdx: 5, lon: 37.2, lat: ilerlet(37.0, ROUTE_TRIM_ADVANCE_M - 3), geom: GEOM_A,
    })).toBe(false);
    expect(shouldTrimRoute(prev, {
      segIdx: 5, lon: 37.2, lat: ilerlet(37.0, ROUTE_TRIM_ADVANCE_M + 1), geom: GEOM_A,
    })).toBe(true);
  });

  /* ── Kanıtsız veriyle çizim yapılmaz ───────────────────────────────── */

  it('KİLİT: geçersiz koordinat (NaN/Infinity) çizim TETİKLEMEZ', () => {
    const prev: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    expect(shouldTrimRoute(prev, { segIdx: 6, lon: NaN, lat: 37.0, geom: GEOM_A })).toBe(false);
    expect(shouldTrimRoute(prev, { segIdx: 6, lon: 37.2, lat: Infinity, geom: GEOM_A })).toBe(false);
    expect(shouldTrimRoute(prev, { segIdx: NaN, lon: 37.2, lat: 37.0, geom: GEOM_A })).toBe(false);
  });

  /* ── Saflık sözleşmesi ─────────────────────────────────────────────── */

  it('KİLİT: saf — aynı girdi aynı çıktı, girdi MUTASYONA uğramaz', () => {
    const prev: RouteTrimMark = { segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A };
    const next = { segIdx: 5, lon: 37.2, lat: ilerlet(37.0, 40), geom: GEOM_A };
    const a = shouldTrimRoute(prev, next);
    const b = shouldTrimRoute(prev, next);
    expect(a).toBe(b);
    expect(prev).toEqual({ segIdx: 5, lon: 37.2, lat: 37.0, geom: GEOM_A });
    expect(next.segIdx).toBe(5);
  });

  it('KİLİT: nextTrimMark tüm alanları taşır (kısmi işaret bırakmaz)', () => {
    const next = { segIdx: 9, lon: 37.25, lat: 37.05, geom: GEOM_A };
    expect(nextTrimMark(next)).toEqual({ segIdx: 9, lon: 37.25, lat: 37.05, geom: GEOM_A });
  });

  it('ÖLÇÜM: eşik 25 m — 115 km/h\'te ≈0,8 s (GPS 1,06 Hz tick\'inden hızlı)', () => {
    /* Eşik hız SINIRLAMAZ: çağrı GPS fix tick'ine bağlı ve cihazda 1,06 Hz
       ölçüldü. Yani en kötü ihtimalle saniyede bir setData olur. Bu test
       eşiğin o tick'ten daha sık tetiklenecek kadar KÜÇÜK olduğunu kilitler —
       aksi hâlde kusur geri gelir. */
    const metrePerSaniye = 115 / 3.6;
    expect(ROUTE_TRIM_ADVANCE_M / metrePerSaniye).toBeLessThan(1.0);
  });
});
