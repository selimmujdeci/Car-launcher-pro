/**
 * mapDayLocalRoadReadability.test.ts — GÜNDÜZ YEREL/SERVİS YOL OKUNABİLİRLİĞİ (2026-09-09).
 *
 * ÖLÇÜLEN İKİ SESSİZ KUSUR (bu turun gerekçesi):
 *
 *   1. `road-minor-casing` gövdeden (`road-minor`, z13) bir tam zoom kademesi
 *      GECİKMELİ açılıyordu (`minzoom + 1` = z14). z13'te ekranda yalnız çıplak
 *      gövde vardı: `#f4f4f5` zemine (`#e9eef3`) karşı ÖLÇÜLEN kontrast **1,06**
 *      — pratikte görünmezdi. z13 tipik şehir-yaklaşım zoom'udur, prompt'un
 *      odaklandığı z14–z17 sürüş bandının hemen altı.
 *
 *   2. `road-service` HİÇ kasa taşımıyordu — aynı çıplak ~1,06 kontrast, üstüne
 *      `line-opacity: 0.85` harmanlanınca daha da düşük.
 *
 * DÜZELTME PRENSİBİ: yeni bir görsel kademe İCAT EDİLMEDİ — `service`,
 * `minorCasing` tonunu AYNEN devralır ("yerel ağ" ailesi zaten koddaki
 * `GECE_YEREL` ortak çarpanıyla bu ikisini birlikte ele alıyordu). GECE
 * PİKSEL DÜZEYİNDE DOKUNULMADI: bu dosya her iki katman için de gece
 * ifadelerinin ESKİ değerlerle BİREBİR aynı kaldığını ayrıca kilitler.
 */

import { describe, it, expect } from 'vitest';
import { buildVectorStyle, NAV_SUPPRESS_TIERS, ROAD_VISIBILITY, DAY_PALETTE, NIGHT_PALETTE } from '../platform/mapStyleBuilders';
import type { MapSource } from '../platform/mapSourceTypes';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

const LOCAL_PBF: MapSource = {
  id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true,
};
function styleFor(night: boolean): StyleSpecification {
  return buildVectorStyle(new Map([['local', LOCAL_PBF]]), () => {
    throw new Error('raster fallback bu kilidin konusu değil');
  }, night);
}
const DAY = styleFor(false);
const NIGHT = styleFor(true);

function layer(s: StyleSpecification, id: string): LayerSpecification {
  const l = s.layers.find((x) => x.id === id);
  if (!l) throw new Error(`katman yok: ${id}`);
  return l;
}
const paintOf = (s: StyleSpecification, id: string) =>
  (layer(s, id) as unknown as { paint?: Record<string, unknown> }).paint ?? {};
const minzoomOf = (s: StyleSpecification, id: string) =>
  (layer(s, id) as unknown as { minzoom?: number }).minzoom;

/**
 * Zoom-`interpolate` ifadesini belirli bir zoom'da (lineer) değerlendirir.
 * `roadWidth()` durak DEĞERLERİNİN içine bir `case` (rampa dalı) yerleştirir
 * (`cartographyAuthority.test.ts` §evalZoom ile AYNI ilke) — bu yüzden
 * `case` da çözülür; rampa özelliği (`ramp`) verilmezse varsayılan (son) dal
 * seçilir, yani "normal (rampa olmayan) yol" değeri okunur. */
function evalZoom(expr: unknown, zoom: number, feature: Record<string, unknown> = {}): number {
  if (typeof expr === 'number') return expr;
  const e = expr as unknown[];
  if (!Array.isArray(e)) throw new Error('ifade değil');
  if (e[0] === 'interpolate') {
    const stops: Array<[number, unknown]> = [];
    for (let i = 3; i < e.length; i += 2) stops.push([e[i] as number, e[i + 1]]);
    const first = stops[0]!, last = stops[stops.length - 1]!;
    if (zoom <= first[0]) return evalZoom(first[1], zoom, feature);
    if (zoom >= last[0]) return evalZoom(last[1], zoom, feature);
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!, b = stops[i]!;
      if (zoom <= b[0]) {
        const t = (zoom - a[0]) / (b[0] - a[0]);
        const va = evalZoom(a[1], zoom, feature), vb = evalZoom(b[1], zoom, feature);
        return va + (vb - va) * t;
      }
    }
  }
  if (e[0] === 'case') {
    for (let i = 1; i < e.length - 1; i += 2) {
      const c = e[i] as unknown[];
      if (Array.isArray(c) && c[0] === '==' && Array.isArray(c[1]) && (c[1] as unknown[])[0] === 'get') {
        const key = (c[1] as unknown[])[1] as string;
        if (feature[key] === c[2]) return evalZoom(e[i + 1], zoom, feature);
      }
    }
    return evalZoom(e[e.length - 1], zoom, feature);
  }
  throw new Error(`desteklenmeyen ifade: ${String(e[0])}`);
}
const widthAt = (s: StyleSpecification, id: string, z: number) =>
  evalZoom(paintOf(s, id)['line-width'], z);

/* ── WCAG ── */
const chan = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * chan(r!) + 0.7152 * chan(g!) + 0.0722 * chan(b!);
};
const contrast = (a: string, b: string) => {
  const x = lum(a), y = lum(b); const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
};

describe('gündüz yerel yol — z13 çıplak-gövde kusuru kapandı', () => {
  it('road-minor-casing GÜNDÜZDE gövdeyle AYNI zoom da başlar (eski: bir kademe gecikmeli)', () => {
    expect(minzoomOf(DAY, 'road-minor-casing')).toBe(ROAD_VISIBILITY.minor.minzoom);
    expect(minzoomOf(DAY, 'road-minor')).toBe(ROAD_VISIBILITY.minor.minzoom);
  });

  it('road-minor-casing minzoom İKİ TEMADA DA AYNI (yapısal alan, canlı yamanamaz)', () => {
    // `minzoom` `applyMapDayNight`in diff döngüsünün (yalnız paint/layout)
    // DIŞINDADIR — temaya göre farklı olsaydı MINI/FULL gibi farklı `night`
    // değeriyle kurulmuş yüzeyler aynı temaya geçince bile kalıcı ayrışırdı
    // (bkz. mapDeviceLifecycleCampaign.test.ts). Bu yüzden düzeltme HER İKİ
    // temaya uygulanır — yalnız gündüze özel bir minzoom YOKTUR.
    expect(minzoomOf(DAY, 'road-minor-casing')).toBe(ROAD_VISIBILITY.minor.minzoom);
    expect(minzoomOf(NIGHT, 'road-minor-casing')).toBe(ROAD_VISIBILITY.minor.minzoom);
  });

  it('road-minor-casing GECEDE genişliği eski değerlerle BİREBİR aynı (yalnız width bağımsız kaldı)', () => {
    const stops: ReadonlyArray<readonly [number, number]> = [[14, 2.6], [16, 4.6], [18, 9]];
    for (const [z, expected] of stops) {
      expect(widthAt(NIGHT, 'road-minor-casing', z), `gece z${z}`).toBeCloseTo(expected, 5);
    }
  });

  it('road-minor gövdesi GECEDE eski değerlerle BİREBİR aynı (z13-z18)', () => {
    // `gece()` yardımcısı 2 ondalığa yuvarlar (mapStyleBuilders.ts) — AYNI
    // yuvarlamayı burada da uygularız, aksi hâlde kilit kendi hassasiyetiyle
    // yanlış pozitif üretir.
    const eski: ReadonlyArray<readonly [number, number]> = [[13, 0.9], [14, 2.2], [16, 4], [18, 7.4]];
    for (const [z, w] of eski) {
      const beklenen = Math.round(w * 0.72 * 100) / 100;
      expect(widthAt(NIGHT, 'road-minor', z), `gece z${z}`).toBeCloseTo(beklenen, 5);
    }
  });

  it('road-minor GÜNDÜZ z14/z16 genişledi, z18 BİLEREK dokunulmadı (oran kilidi marjı orada)', () => {
    expect(widthAt(DAY, 'road-minor', 14)).toBeGreaterThan(2.2);
    expect(widthAt(DAY, 'road-minor', 16)).toBeGreaterThan(4);
    expect(widthAt(DAY, 'road-minor', 18)).toBe(7.4);
    expect(widthAt(DAY, 'road-minor', 13)).toBe(0.9);
  });

  it('road-minor-casing GÜNDÜZ z13 te de gövdeden GENİŞ çizilir (artık gerçekten örter)', () => {
    for (const z of [13, 14, 16]) {
      expect(widthAt(DAY, 'road-minor-casing', z), `z${z}`)
        .toBeGreaterThan(widthAt(DAY, 'road-minor', z));
    }
  });

  it('otoyol/tali GÜNDÜZ oranı z14/z16/z18 de hâlâ >=2,5 (genişletme hiyerarşiyi ezmedi)', () => {
    for (const z of [14, 16, 18]) {
      const oran = widthAt(DAY, 'road-motorway', z) / widthAt(DAY, 'road-minor', z);
      expect(oran, `z${z}`).toBeGreaterThanOrEqual(2.5);
    }
  });
});

describe('gündüz servis yolu — hiç kasa yokken artık VAR', () => {
  it('road-service-casing katmanı gerçekten mevcut ve gövdeyle AYNI minzoom da', () => {
    expect(minzoomOf(DAY, 'road-service-casing')).toBe(ROAD_VISIBILITY.service.minzoom);
    expect(minzoomOf(DAY, 'road-service-casing')).toBe(minzoomOf(DAY, 'road-service'));
  });

  it('GÜNDÜZ kasa gövdeden GENİŞ çizilir (z15-z18)', () => {
    for (const z of [15, 16, 18]) {
      expect(widthAt(DAY, 'road-service-casing', z), `z${z}`)
        .toBeGreaterThan(widthAt(DAY, 'road-service', z));
    }
  });

  it('GÜNDÜZ kasa tonu minorCasing ile BİREBİR aynı — yeni bir kademe İCAT EDİLMEDİ', () => {
    expect(DAY_PALETTE.serviceCasing).toBe(DAY_PALETTE.minorCasing);
  });

  it('eski çıplak gövde kontrastı (~1,06) hâlâ zayıf; kasa bunu telafi eder', () => {
    const bg = DAY_PALETTE.bg;
    const ciplakGovde = contrast(bg, DAY_PALETTE.minor);
    expect(ciplakGovde, 'gövde tek başına hâlâ neredeyse görünmez olmalı (ölçülen kusur)')
      .toBeLessThan(1.15);
    const kasali = contrast(bg, DAY_PALETTE.serviceCasing);
    expect(kasali, 'kasa zemine karşı GÖVDEDEN belirgin ayrışmalı')
      .toBeGreaterThan(1.4);
  });

  it('GECEDE kasa gövdeyle piksel düzeyinde AYNI — renk VE genişlik (kasıtlı no-op)', () => {
    expect(paintOf(NIGHT, 'road-service-casing')['line-color'])
      .toBe(paintOf(NIGHT, 'road-service')['line-color']);
    expect(NIGHT_PALETTE.serviceCasing).toBe(NIGHT_PALETTE.minor);
    for (const z of [15, 16, 17, 18]) {
      expect(widthAt(NIGHT, 'road-service-casing', z), `gece z${z}`)
        .toBeCloseTo(widthAt(NIGHT, 'road-service', z), 10);
    }
  });

  it('GECEDE genişlik BİREBİR eski değerlerle aynı (dokunulmadı)', () => {
    expect(widthAt(NIGHT, 'road-service', 15)).toBeCloseTo(0.65, 5);
    expect(widthAt(NIGHT, 'road-service', 18)).toBeCloseTo(2.45, 5);
  });

  it('road-service-casing NAV_SUPPRESS_TIERS te road-service İLE AYNI değerleri taşır', () => {
    for (let t = 0; t < NAV_SUPPRESS_TIERS.length; t++) {
      const svc = NAV_SUPPRESS_TIERS[t]!.find((e) => e[0] === 'road-service');
      const cas = NAV_SUPPRESS_TIERS[t]!.find((e) => e[0] === 'road-service-casing');
      expect(svc, `tier ${t} road-service yok`).toBeTruthy();
      expect(cas, `tier ${t} road-service-casing yok`).toBeTruthy();
      expect(cas![2], `tier ${t} değerleri ayrışmış`).toBe(svc![2]);
    }
  });
});

describe('stil bütünlüğü — yeni katman mevcut sözleşmeleri BOZMADI', () => {
  it('gündüz ve gece hâlâ AYNI katman kimlik listesini üretir', () => {
    expect(DAY.layers.map((l) => l.id)).toEqual(NIGHT.layers.map((l) => l.id));
  });

  it('road-service-casing draw-order da road-minor-casing DEN ÖNCE (küçükten büyüğe)', () => {
    const idx = (s: StyleSpecification, id: string) => s.layers.findIndex((l) => l.id === id);
    expect(idx(DAY, 'road-service-casing')).toBeLessThan(idx(DAY, 'road-minor-casing'));
    expect(idx(DAY, 'road-service-casing')).toBeLessThan(idx(DAY, 'road-path'));
  });
});
