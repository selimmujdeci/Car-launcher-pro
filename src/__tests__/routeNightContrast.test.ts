/**
 * routeNightContrast.test.ts — #619 KİLİDİ
 *
 * KULLANICI BİLDİRİMİ (2026-08-17, gerçek araç, gece, tam ekran navigasyon):
 * *"gece rota böyle karanlık oluyor."*
 *
 * KÖK: rota çekirdeği tema-BAĞIMSIZDI. #612'de gece YOLLARI açıldı (yol↔zemin
 * 3,21) ama çekirdek gündüz için seçilmiş koyu tonlarda kaldı → rota, ÜZERİNDE
 * çizildiği yoldan neredeyse ayrışmıyordu: her iki mavi kademe için **1,18**.
 *
 * Bu kilit üç şeyi birlikte korur:
 *   1. gece çekirdeği ZEMİNDEN ayrışır,
 *   2. gece çekirdeği YOLDAN ayrışır (asıl kusur buydu),
 *   3. beyaz KILIF/çekirdek ayrımı ölmez (fazla parlatma da kusurdur).
 * Değerler bilinçli değişirse eşikler GÜNCELLENİR — kilit kaldırılmaz.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRouteColor,
  ROUTE_COLOR_POLICY_VERSION,
  ROUTE_CORE_STOPS_DARK_BASEMAP,
  ROUTE_CORE_STOPS_LIGHT_BASEMAP,
} from '../platform/map/core/routeColorModel';
import { NIGHT_PALETTE } from '../platform/mapStyleBuilders';

/* ── Ölçüm yardımcıları (WCAG 2.1 relative luminance) ─────────────────────── */
const lum = (hex: string): number => {
  const c = hex.replace('#', '');
  const v = [0, 2, 4]
    .map((i) => parseInt(c.substr(i, 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const cr = (a: string, b: string): number => {
  const l1 = lum(a), l2 = lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * #622 — ZEMİN VE YOL ARTIK CANLI PALETTEN OKUNUR (sabit kopya TUTULMAZ).
 *
 * Bu kilit ilk yazımında `#161c28` / `#6a6b70` sabitlerini taşıyordu. #622'de
 * palet değişti (zemin `#222c3c`, tali yol `#6f7581`) ama kilit eski dünyayı
 * ölçmeye devam ettiği için YEŞİL KALDI — oysa gerçek ekranda rota↔yol
 * kontrastı **1,95 → 1,70**'e düşmüştü: yol açıldı, rota çekirdeği yerinde
 * kaldı. Yani kilit, korumakla görevli olduğu regresyonun tam olarak kendisini
 * kaçırdı. Sabitler kaldırıldı: palet değişirse kilit onunla hareket eder.
 */
const NIGHT_BG   = NIGHT_PALETTE.bg;
const NIGHT_ROAD = NIGHT_PALETTE.minor;
const WHITE_CASE = '#ffffff';

describe('#619 — gece rota çekirdeği', () => {
  const stops = ROUTE_CORE_STOPS_DARK_BASEMAP;

  it('🔒 koyu zemin kararı gece duraklarını verir; açık zemin gündüz duraklarını', () => {
    const night = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false });
    const day   = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: true });
    expect(night.coreStops).toEqual([...ROUTE_CORE_STOPS_DARK_BASEMAP]);
    expect(day.coreStops).toEqual([...ROUTE_CORE_STOPS_LIGHT_BASEMAP]);
  });

  it('🔒 gece çekirdeği ZEMİNDEN ayrışır (her kademe ≥ 4,5)', () => {
    for (const s of stops) {
      expect(cr(NIGHT_BG, s), `${s} ↔ zemin`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('🔒 gece çekirdeği YOLDAN ayrışır (asıl kusur: 1,18 idi → ≥ 1,9)', () => {
    for (const s of stops) {
      expect(cr(NIGHT_ROAD, s), `${s} ↔ gece yolu`).toBeGreaterThanOrEqual(1.9);
    }
  });

  it('🔒 beyaz KILIF/çekirdek ayrımı ölmez (≥ 1,8) — fazla parlatma da kusur', () => {
    for (const s of stops) {
      expect(cr(WHITE_CASE, s), `${s} ↔ beyaz kılıf`).toBeGreaterThanOrEqual(1.8);
    }
  });

  it('gece duraklarının HEPSİ eski gündüz duraklarından parlak (regresyon yönü)', () => {
    for (let i = 0; i < 3; i++) {
      expect(lum(ROUTE_CORE_STOPS_DARK_BASEMAP[i]))
        .toBeGreaterThan(lum(ROUTE_CORE_STOPS_LIGHT_BASEMAP[i]));
    }
  });

  it('ESKİ AÇIK-MAVİ gece durakları beyaz yolda bu kilidi GEÇEMEZDİ', () => {
    /* 2026-09-05 · kullanıcı gece yollarını beyaz istedi. Eski duraklar
       (`#72B6FF · #9CA2FF · #24D6C4`) KOYU GRİ yol için tasarlanmıştı; beyaz
       yolun üstünde turkuaz durak 1,83'e düşüyor ve ≥1,9 kuralını KIRIYORDU.
       Kilidin anlamı budur: yeni duraklar bu sınavı geçer, eskiler geçemez. */
    expect(cr(NIGHT_ROAD, '#24D6C4'), 'eski turkuaz durak beyaz yolda ayrışıyor mu?')
      .toBeLessThan(1.9);
    expect(cr(NIGHT_ROAD, ROUTE_CORE_STOPS_DARK_BASEMAP[2]), 'yeni durak ayrışmıyor')
      .toBeGreaterThanOrEqual(1.9);
  });

  it('eski (kusurlu) tema-bağımsız gradient bu kilidi GEÇEMEZDİ — kilidin anlamı', () => {
    // Sahada ölçülen kusur: orta kademe yola karşı 1,18.
    /* Gündüz durağı gece ZEMİNİNDE kaybolur — kilidin özü bu (yol karşısındaki
       ölçüm beyaz yol sözleşmesiyle anlamını yitirdi, üstteki yeni kilide
       taşındı). */
    expect(cr(NIGHT_BG,   ROUTE_CORE_STOPS_LIGHT_BASEMAP[1])).toBeLessThan(4.5);
  });

  it('🔒 gündüz kararı POLİTİKA SÜRÜMÜNE bağlı — sessizce değişemez', () => {
    /* #619 gündüz paletini KAPSAM DIŞI bırakmıştı ve bu kilit onu donduruyordu.
       RC-2026.08.24-OEM turu gündüz duraklarını BİLİNÇLİ değiştirdi (doygun OEM
       mavi → derin mavi → camgöbeği) ve gerekçesini `routeColorPolicy.test.ts`
       içinde ölçtü (çekirdek ↔ koyu kılıf ≥ 3:1, üç durak).

       Kilit KALDIRILMADI, GÜÇLENDİRİLDİ: artık yalnız değerleri değil, o
       değerlerin AİT OLDUĞU politika sürümünü de bağlar. Palet sürüm
       yükseltilmeden değiştirilirse bu kilit yine düşer — "sessiz palet
       kayması" #622'nin kök nedeniydi ve bir daha sessiz olamaz. */
    expect(ROUTE_COLOR_POLICY_VERSION).toBe('RC-2026.09.05-WHITE-NIGHT');
    expect(ROUTE_CORE_STOPS_LIGHT_BASEMAP).toEqual(['#006CFF', '#0057D9', '#00A6FF']);
  });

  it('🔒 karar anahtarı zemin kutbunu taşır — tema geçişinde gradient yeniden yazılır', () => {
    const night = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: false });
    const day   = resolveRouteColor({ maneuverTier: 0, hazardHigh: false, lightBasemap: true });
    expect(night.routeColorKey).not.toBe(day.routeColorKey);
  });
});
