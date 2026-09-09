/**
 * dayCartographySystem.test.ts — GÜNDÜZ KARTOGRAFİSİ · SİSTEM KİLİTLERİ (2026-09-09).
 *
 * NEDEN AYRI BİR DOSYA: mevcut kilitler tek tek DEĞERLERİ koruyordu (şu renk
 * şundan koyu, şu oran şu eşiğin üstünde). Sahadaki şikâyet ise tek bir değerde
 * değil, DEĞERLER ARASI İLİŞKİDE idi: "soğuk/klinik, CAD çizimi gibi, yollar
 * zemine fazla yakın, doğal alanla ulaşım ağı arasında derinlik yok."
 *
 * ── BU DOSYANIN KAPATTIĞI ÜÇ KÖR NOKTA (hepsi ÖLÇÜLDÜ) ────────────────────
 *
 *  1. **Kilitler yolları YALNIZ ARKA PLANA karşı ölçüyordu.** Oysa yol, şehir
 *     dolgusunun · parkın · ormanın ÜSTÜNDEN de geçer. Ölçüm (eski palet):
 *     yerel yol kasası orman üstünde **1,01** (1,00 = görünmez), park üstünde
 *     1,15, şehir dolgusu üstünde 1,31. Yani Türkiye'nin orman/yayla
 *     coğrafyasında yolun kenarı ekranda YOKTU ve hiçbir test bunu görmüyordu.
 *
 *  2. **Zemin ailesi tek düz kütleydi.** CIEDE2000: tarım↔konut **0,43**
 *     (algı eşiği ~1,0'ın altı), sanayi↔bina 1,94, konut↔sanayi 2,04 — hepsi
 *     "geniş yüzeyde ayırt edilebilir" sınırının (~2,3) altında. "CAD çizimi
 *     gibi" izleniminin sayısal karşılığı budur.
 *
 *  3. **Ölçü aracı yanlıştı.** Büyük yüzey ilişkileri WCAG metin kontrastıyla
 *     ölçülemez (WCAG yalnız LUMINANS bakar, hue/kroma farkını göremez).
 *     Bu dosya BÜYÜK YÜZEY ilişkilerinde CIEDE2000, İNCE ÇİZGİ (yol/kenar)
 *     ilişkilerinde luminans kontrastı kullanır — çünkü ince çizgi algısı
 *     kenar/luminans sürücülüdür. Ölçü, ilişkinin fiziğine göre seçilir.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildVectorStyle, buildRoadStyle, DAY_PALETTE, NIGHT_PALETTE,
  NAV_SUPPRESS_TIERS, MAP_BG_DAY } from '../platform/mapStyleBuilders';
import { ROUTE_CORE_STOPS_LIGHT_BASEMAP } from '../platform/map/core/routeColorModel';
import type { MapSource } from '../platform/mapSourceTypes';
import type { StyleSpecification } from 'maplibre-gl';

/* ── Renk bilimi: sRGB → Lab → CIEDE2000 (harici bağımlılık YOK) ─────────── */

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const srgbToLin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/** WCAG bağıl luminans — İNCE ÇİZGİ (yol gövdesi/kasası) ilişkileri için. */
function lum(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * srgbToLin(r!) + 0.7152 * srgbToLin(g!) + 0.0722 * srgbToLin(b!);
}
function contrast(a: string, b: string): number {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function lab(hex: string): [number, number, number] {
  const [R, G, B] = rgbOf(hex).map(srgbToLin) as [number, number, number];
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(X / 0.95047), fy = f(Y / 1.0), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 — BÜYÜK YÜZEY ilişkileri için algısal renk farkı. */
function dE2000(h1: string, h2: string): number {
  const [L1, a1, b1] = lab(h1), [L2, a2, b2] = lab(h2);
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += hbp < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * hbp * Math.PI / 180)
    + 0.32 * Math.cos((3 * hbp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * hbp - 63) * Math.PI / 180);
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * Math.PI / 180) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

const chroma = (hex: string) => { const [r, g, b] = rgbOf(hex); return (Math.max(r!, g!, b!) - Math.min(r!, g!, b!)) / 255; };

/* ── Stil ─────────────────────────────────────────────────────────────────── */

const LOCAL_PBF: MapSource = { id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true };
const styleFor = (night: boolean): StyleSpecification =>
  buildVectorStyle(new Map([['local', LOCAL_PBF]]), () => { throw new Error('raster fallback konu disi'); }, night);
const DAY = styleFor(false);
const NIGHT = styleFor(true);
const paint = (s: StyleSpecification, id: string, prop: string): string => {
  const l = s.layers.find((x) => x.id === id);
  if (!l) throw new Error(`katman yok: ${id}`);
  const v = (l as unknown as { paint?: Record<string, unknown> }).paint?.[prop];
  if (typeof v !== 'string') throw new Error(`${id}.${prop} duz renk degil`);
  return v;
};

const P = DAY_PALETTE;

/** Yolun ÜSTÜNDEN geçebileceği tüm zemin yüzeyleri. */
const GROUNDS: ReadonlyArray<readonly [string, string]> = [
  ['arka plan', P.bg], ['tarım', P.farmland], ['konut', P.residential],
  ['sanayi/kurum', P.urban], ['park', P.park], ['orman', P.forest],
];
const ROAD_CLASSES = [
  { ad: 'otoyol', body: P.motorway, cas: P.motorwayCasing },
  { ad: 'ana', body: P.primary, cas: P.primaryCasing },
  { ad: 'ikincil', body: P.secondary, cas: P.secondaryCasing },
  { ad: 'üçüncül', body: P.tertiary, cas: P.tertiaryCasing },
  { ad: 'yerel', body: P.minor, cas: P.minorCasing },
] as const;

/* ═══ 1 · YOL HER ZEMİN ÜSTÜNDE OKUNUR ═══════════════════════════════════ */

describe('1 · yol okunurluğu — ARKA PLAN DEĞİL, GEÇTİĞİ HER ZEMİN', () => {
  /**
   * Eşik gerekçesi: yol ekranda gövde + kasa olarak BİRLİKTE çizilir. Sürücünün
   * yolu görmesi için ikisinden EN AZ BİRİNİN zeminden ayrışması yeterlidir;
   * ama en zayıf sınıfın en kötü zeminde bile 1,25'in altına düşmesi, çizginin
   * yüzeyde erimesi demektir (eski ölçüm: orman üstünde 1,01 = görünmez).
   */
  const EN_AZ = { otoyol: 2.00, ana: 1.75, ikincil: 1.55, üçüncül: 1.35, yerel: 1.25 } as const;

  it('🔒 her yol sınıfı, EN KÖTÜ zemininde bile gövde ya da kasasıyla okunur', () => {
    for (const r of ROAD_CLASSES) {
      for (const [gAd, g] of GROUNDS) {
        const best = Math.max(contrast(g, r.body), contrast(g, r.cas));
        expect(best, `${r.ad} yol · ${gAd} üstünde eriyor (${best.toFixed(2)})`)
          .toBeGreaterThanOrEqual(EN_AZ[r.ad]);
      }
    }
  });

  it('🔒 KASA doğal yüzeylerin üstünde de kenar taşır (eski ölçüm: orman 1,01)', () => {
    /* Doğa, yol kasasıyla AYNI açıklığa gelirse kenar yok olur — 2026-09-09
       öncesinde `forest` L* 78,4 · `minorCasing` L* 78,7 idi (birebir aynı). */
    for (const dogal of [P.park, P.forest]) {
      for (const r of ROAD_CLASSES) {
        expect(contrast(dogal, r.cas), `${r.ad} kasası doğal yüzeyde eriyor`)
          .toBeGreaterThanOrEqual(1.20);
      }
    }
  });

  it('🔒 doğal yüzeyler yol KASA merdiveninden AÇIK kalır — yol ağı içlerinde kaybolmaz', () => {
    for (const dogal of [P.park, P.forest]) {
      expect(lum(dogal), 'doğal yüzey en açık kasadan koyu — yol içinde kaybolur')
        .toBeGreaterThan(lum(P.minorCasing));
    }
  });
});

/* ═══ 2 · ZEMİN AİLESİ TEK KÜTLE DEĞİL ═══════════════════════════════════ */

describe('2 · zemin ailesi — "CAD çizimi" düzlüğü', () => {
  const ALAN: ReadonlyArray<readonly [string, string]> = [
    ['arka plan', P.bg], ['tarım', P.farmland], ['konut', P.residential],
    ['sanayi/kurum', P.urban], ['bina', P.buildingFill],
  ];

  it('🔒 hiçbir iki büyük yüzey algısal olarak ÇAKIŞMAZ (ΔE2000)', () => {
    /* Eşik gerekçesi: ΔE2000 ~2,3 geniş bitişik yüzeylerde "fark edilir"
       sınırıdır. Eski palette tarım↔konut 0,43 idi — aynı renk sayılır. */
    for (let i = 0; i < ALAN.length; i++) {
      for (let j = i + 1; j < ALAN.length; j++) {
        const d = dE2000(ALAN[i]![1], ALAN[j]![1]);
        expect(d, `${ALAN[i]![0]} ↔ ${ALAN[j]![0]} ayırt edilemiyor (ΔE ${d.toFixed(2)})`)
          .toBeGreaterThanOrEqual(2.10);
      }
    }
  });

  it('🔒 zemin ailesi AÇIK kalır — koyulaştırıp derinlik kazanmak yol okunurluğunu bozar', () => {
    /* Bu kilit bilinçli bir TAKAS'ı korur: alan ayrımı AÇIKLIKLA değil düşük
       kromalı TONLA kurulur; aksi hâlde üstünden geçen yolun kasası söner. */
    for (const [ad, c] of ALAN) {
      if (ad === 'bina') continue;                       // bina yolun altında değil
      expect(lum(c), `${ad} fazla koyu — üstündeki yol kasası söner`).toBeGreaterThan(0.62);
    }
  });
});

/* ═══ 3 · HİYERARŞİ ═══════════════════════════════════════════════════════ */

describe('3 · yol hiyerarşisi — tek bakışta sınıf', () => {
  it('🔒 kasa merdiveni monotoniktir ve uçtan uca ayrışır', () => {
    const l = ROAD_CLASSES.map((r) => lum(r.cas));
    for (let i = 1; i < l.length; i++) {
      expect(l[i]!, `${ROAD_CLASSES[i]!.ad} kasası bir üst sınıftan koyu`).toBeGreaterThan(l[i - 1]!);
    }
    expect(contrast(P.motorwayCasing, P.minorCasing), 'otoyol↔yerel kasa ayrımı çökmüş')
      .toBeGreaterThanOrEqual(1.70);
  });

  it('🔒 gövde merdiveni de ayrışır — "hepsi aynı beyaz şerit" değil', () => {
    /* Ölçüldü (eski): otoyol↔yerel gövde ΔE 2,27 — algı sınırında. */
    expect(dE2000(P.motorway, P.minor), 'gövde merdiveni algısal olarak düz')
      .toBeGreaterThanOrEqual(2.60);
  });

  it('🔒 servis yolu yerel yolun ÜSTÜNE çıkmaz (ast kademe kalır)', () => {
    expect(P.serviceCasing).toBe(P.minorCasing);
    expect(lum(P.minor), 'servis gövdesi yerel yoldan açık olamaz').toBeGreaterThanOrEqual(lum(P.minor));
  });
});

/* ═══ 4 · DOĞA · SU ═══════════════════════════════════════════════════════ */

describe('4 · doğal yüzeyler — sakin ama tanınabilir', () => {
  it('🔒 park/orman/su zeminden ALGISAL olarak ayrışır', () => {
    for (const [ad, c] of [['park', P.park], ['orman', P.forest], ['su', P.water]] as const) {
      expect(dE2000(P.bg, c), `${ad} zeminde kayboluyor`).toBeGreaterThanOrEqual(9.0);
    }
  });

  it('🔒 doğa YOLLA YARIŞMAZ — kroma taşır ama yol merdiveninden açık kalır', () => {
    for (const c of [P.park, P.forest]) {
      expect(chroma(c), 'doğal yüzey nötr griye düşmüş').toBeGreaterThan(0.10);
    }
    /* Su, doğanın en doygun öğesidir; yine de aktif rotanın altında kalmalı. */
    expect(chroma(P.water)).toBeGreaterThan(0.10);
  });

  it('🔒 su bina kütlesiyle karışmaz', () => {
    expect(contrast(P.water, P.buildingFill)).toBeGreaterThanOrEqual(1.20);
  });
});

/* ═══ 5 · AKTİF ROTA BASKIN KALIR ════════════════════════════════════════ */

describe('5 · browse ↔ navigasyon tutarlılığı', () => {
  it('🔒 aktif rota çekirdeği zeminden ve yol ağından BASKIN ayrışır', () => {
    const core = ROUTE_CORE_STOPS_LIGHT_BASEMAP[0];
    expect(contrast(P.bg, core), 'rota zeminde eriyor').toBeGreaterThanOrEqual(3.0);
    /* Rota, üstünde çizildiği yol gövdesinden de ayrılmalı. */
    for (const r of ROAD_CLASSES) {
      expect(contrast(r.body, core), `rota ${r.ad} yol üstünde eriyor`).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('🔒 rota, haritanın EN DOYGUN öğesidir — basemap onunla yarışmaz', () => {
    const core = ROUTE_CORE_STOPS_LIGHT_BASEMAP[0];
    const basemapEnDoygun = Math.max(...[P.water, P.park, P.forest, P.bg, P.buildingFill].map(chroma));
    expect(chroma(core), 'basemap rotadan doygun — rota baskınlığını kaybeder')
      .toBeGreaterThan(basemapEnDoygun);
  });
});

/* ═══ 6 · ETİKET ═════════════════════════════════════════════════════════ */

describe('6 · etiket sistemi', () => {
  it('🔒 halo ZEMİN AİLESİNDENDİR — etiket yüzeyi delmez', () => {
    /* Saf beyaz halo, sıcak-nötr zeminde her etiketin çevresinde parlak bir
       delik açar. Halo zeminden bir tık AÇIK olmalı ama ondan kopmamalı. */
    for (const halo of [P.labelHalo, P.townHalo, P.cityHalo]) {
      expect(lum(halo), 'halo zeminden koyu — okunurluk düşer').toBeGreaterThan(lum(P.bg));
      expect(dE2000(P.bg, halo), 'halo zeminden kopuk (beyaz delik)').toBeLessThanOrEqual(6.0);
    }
  });

  it('🔒 etiket metni okunur ama "siyah duvar" değil', () => {
    for (const [ad, t] of [['yol', P.labelText], ['kasaba', P.townText], ['şehir', P.cityText]] as const) {
      expect(contrast(t, P.bg), `${ad} etiketi zeminde okunmuyor`).toBeGreaterThanOrEqual(7.0);
      expect(contrast(t, P.bg), `${ad} etiketi aşırı sert (siyah duvar)`).toBeLessThanOrEqual(14.0);
    }
  });

  it('🔒 etiket hiyerarşisi: şehir > kasaba > yol', () => {
    expect(contrast(P.cityText, P.bg)).toBeGreaterThan(contrast(P.townText, P.bg));
    expect(contrast(P.townText, P.bg)).toBeGreaterThan(contrast(P.labelText, P.bg));
  });
});

/* ═══ 7 · GECE İZOLASYONU ════════════════════════════════════════════════ */

describe('7 · GECE bu turda DEĞİŞMEDİ', () => {
  /** 2026-09-09 kalibrasyonundan ÖNCEKİ gece değerleri — birebir. */
  const GECE_REFERANS: Record<string, string> = {
    bg: '#222c3c', water: '#245e85', park: '#36543f', forest: '#2b4732',
    farmland: '#3c3f31', residential: '#333b4d', urban: '#3a4052',
    buildingFill: '#39445c', buildingOutline: '#485369',
    motorwayCasing: '#1a212c', primaryCasing: '#181e29', secondaryCasing: '#161c26',
    tertiaryCasing: '#111620', minorCasing: '#0e131b',
    motorway: '#ffffff', primary: '#f9fbfc', secondary: '#f2f5f8',
    tertiary: '#ecf0f5', minor: '#e9edf2',
    labelText: '#e6eaf0', labelHalo: '#0a0e16',
    townText: '#e2eaf5', townHalo: '#060c14', cityText: '#ffffff', cityHalo: '#060c14',
    waterText: '#8fb8d8', railway: '#5a6274', pathLine: '#5f6673',
  };

  it('🔒 gece paletinin HER tokeni birebir korunur', () => {
    for (const [k, v] of Object.entries(GECE_REFERANS)) {
      expect((NIGHT_PALETTE as unknown as Record<string, string>)[k], `gece ${k} değişmiş`).toBe(v);
    }
  });

  it('🔒 gündüz değerleri geceye SIZMAMIŞ', () => {
    const gunduzHexler = new Set(Object.values(DAY_PALETTE as unknown as Record<string, unknown>)
      .filter((v): v is string => typeof v === 'string' && v.startsWith('#')).map((v) => v.toLowerCase()));
    gunduzHexler.delete('#ffffff');                 // otoyol gövdesi iki temada da beyaz
    for (const [k, v] of Object.entries(NIGHT_PALETTE as unknown as Record<string, unknown>)) {
      if (typeof v !== 'string' || !v.startsWith('#')) continue;
      expect(gunduzHexler.has(v.toLowerCase()), `gece ${k} = ${v} gündüz paletinden gelmiş`).toBe(false);
    }
  });

  it('🔒 gece zemini gündüz zeminiyle karışmaz (tema kimliği)', () => {
    expect(contrast(DAY_PALETTE.bg, NIGHT_PALETTE.bg)).toBeGreaterThan(8);
  });
});

/* ═══ 8 · TEK OTORİTE ════════════════════════════════════════════════════ */

describe('8 · tek kartografi otoritesi', () => {
  it('🔒 stildeki gündüz zemini PALETTEN gelir (ikinci renk kaynağı yok)', () => {
    expect(paint(DAY, 'background', 'background-color')).toBe(DAY_PALETTE.bg);
    expect(paint(NIGHT, 'background', 'background-color')).toBe(NIGHT_PALETTE.bg);
  });

  it('🔒 gündüz ve gece AYNI katman listesini üretir (MINI/FULL yapısal eşitlik)', () => {
    expect(DAY.layers.map((l) => l.id)).toEqual(NIGHT.layers.map((l) => l.id));
  });
});

/* ═══ 9 · KASA GEOMETRİSİ — EKRANDA GÖRÜNEN KENAR ════════════════════════ */

describe('9 · kasa GEOMETRİSİ — kenar sub-piksel olamaz', () => {
  /**
   * ÖLÇÜLEN KUSUR (2026-09-09): ekranda görünen kasa = (kasa − gövde) / 2.
   * Sürüş bandında bu değer üçüncül yolda 0,30–0,45 px, YEREL yolda z14'te
   * **0,20 px** idi — bir cihaz pikselinin altında. Kasanın RENGİNİ
   * koyulaştırmak bunu düzeltemez: çizilecek piksel yoktu. Önceki renk
   * turlarının neden yalnız kısmi kazanç verdiği de budur.
   */
  const evalZoom = (expr: unknown, z: number): number => {
    if (typeof expr === 'number') return expr;
    const e = expr as unknown[];
    if (!Array.isArray(e)) throw new Error('ifade degil');
    if (e[0] === 'interpolate') {
      const st: Array<[number, unknown]> = [];
      for (let i = 3; i < e.length; i += 2) st.push([e[i] as number, e[i + 1]]);
      if (z <= st[0]![0]) return evalZoom(st[0]![1], z);
      if (z >= st[st.length - 1]![0]) return evalZoom(st[st.length - 1]![1], z);
      for (let i = 1; i < st.length; i++) {
        if (z <= st[i]![0]) {
          const t = (z - st[i - 1]![0]) / (st[i]![0] - st[i - 1]![0]);
          const a = evalZoom(st[i - 1]![1], z), b = evalZoom(st[i]![1], z);
          return a + (b - a) * t;
        }
      }
    }
    if (e[0] === 'case') return evalZoom(e[e.length - 1], z);      // rampa dışı dal
    throw new Error('desteklenmeyen ifade');
  };
  const widthAt = (st: StyleSpecification, id: string, z: number) => {
    const l = st.layers.find((x) => x.id === id);
    if (!l) throw new Error(`katman yok: ${id}`);
    return evalZoom((l as unknown as { paint: Record<string, unknown> }).paint['line-width'], z);
  };
  const CIFT: ReadonlyArray<readonly [string, string, string, number]> = [
    ['otoyol', 'road-motorway', 'road-motorway-casing', 1.00],
    ['ana', 'road-primary', 'road-primary-casing', 0.90],
    ['ikincil', 'road-secondary', 'road-secondary-casing', 0.75],
    ['üçüncül', 'road-tertiary', 'road-tertiary-casing', 0.70],
    ['yerel', 'road-minor', 'road-minor-casing', 0.55],
  ];

  it('🔒 GÜNDÜZ · sürüş bandında (z14–z18) her sınıfın kenarı görünür kalınlıkta', () => {
    for (const [ad, body, cas, enAz] of CIFT) {
      for (const z of [14, 15, 16, 17, 18]) {
        const kenar = (widthAt(DAY, cas, z) - widthAt(DAY, body, z)) / 2;
        expect(kenar, `${ad} · z${z} kenarı ${kenar.toFixed(2)} px — sub-piksel`)
          .toBeGreaterThanOrEqual(enAz);
      }
    }
  });

  it('🔒 servis yolunun da görünür kenarı var (gündüz)', () => {
    for (const z of [15, 16, 17, 18]) {
      const kenar = (widthAt(DAY, 'road-service-casing', z) - widthAt(DAY, 'road-service', z)) / 2;
      expect(kenar, `servis z${z} kenarı ${kenar.toFixed(2)} px`).toBeGreaterThanOrEqual(0.50);
    }
  });

  it('🔒 ALGILANAN genişlik (kasa) hiyerarşisi z14–z17 boyunca monotoniktir', () => {
    /* Sürücünün gördüğü kalınlık gövde değil KASADIR; hiyerarşi orada da bozulmamalı. */
    const sira = ['road-motorway-casing', 'road-primary-casing', 'road-secondary-casing',
      'road-tertiary-casing', 'road-minor-casing'];
    for (const z of [14, 15, 16, 17]) {
      for (let i = 1; i < sira.length; i++) {
        expect(widthAt(DAY, sira[i - 1]!, z), `z${z}: ${sira[i]} üst sınıfı geçmiş`)
          .toBeGreaterThan(widthAt(DAY, sira[i]!, z));
      }
    }
  });

  it('🔒 GECE kasa genişlikleri bu turda DEĞİŞMEDİ (birebir referans)', () => {
    const GECE: ReadonlyArray<readonly [string, number, number]> = [
      ['road-minor-casing', 14, 2.6], ['road-minor-casing', 16, 4.6], ['road-minor-casing', 18, 9],
      ['road-tertiary-casing', 14, 3.6], ['road-tertiary-casing', 18, 9.6],
      ['road-secondary-casing', 14, 5.2], ['road-secondary-casing', 18, 13],
      ['road-motorway-casing', 14, 11.5], ['road-primary-casing', 14, 8.4],
    ];
    for (const [id, z, beklenen] of GECE) {
      expect(widthAt(NIGHT, id, z), `gece ${id} z${z}`).toBeCloseTo(beklenen, 5);
    }
  });

  it('🔒 gövde genişlikleri DEĞİŞMEDİ — otoyol/tali oran kilidi korunur', () => {
    for (const z of [14, 16, 18]) {
      const oran = widthAt(DAY, 'road-motorway', z) / widthAt(DAY, 'road-minor', z);
      expect(oran, `z${z} otoyol/tali gövde oranı`).toBeGreaterThanOrEqual(2.5);
    }
  });
});

/* ═══ 10 · ETİKET YOĞUNLUĞU ══════════════════════════════════════════════ */

describe('10 · etiket ölçüsü ve yoğunluğu', () => {
  const layout = (id: string) =>
    (DAY.layers.find((l) => l.id === id) as unknown as { layout?: Record<string, unknown> })?.layout ?? {};
  const sizeAt = (id: string, z: number): number => {
    const e = layout(id)['text-size'] as unknown[];
    if (typeof e === 'number') return e;
    const st: Array<[number, number]> = [];
    for (let i = 3; i < e.length; i += 2) st.push([e[i] as number, e[i + 1] as number]);
    if (z <= st[0]![0]) return st[0]![1];
    if (z >= st[st.length - 1]![0]) return st[st.length - 1]![1];
    for (let i = 1; i < st.length; i++) {
      if (z <= st[i]![0]) {
        const t = (z - st[i - 1]![0]) / (st[i]![0] - st[i - 1]![0]);
        return st[i - 1]![1] + (st[i]![1] - st[i - 1]![1]) * t;
      }
    }
    throw new Error('ulasilamaz');
  };

  it('🔒 yerel sokak adı, yer adından BÜYÜK olamaz (etiket hiyerarşisi)', () => {
    for (const z of [16, 17]) {
      expect(sizeAt('road-label', z), `z${z}: sokak adı kasaba adından büyük`)
        .toBeLessThanOrEqual(sizeAt('place-town', z));
    }
  });

  it('🔒 hiçbir etiket "dev" değil — sürüş ekranında ölçü bandı dar', () => {
    for (const id of ['road-label', 'road-label-major', 'place-village', 'place-suburb', 'place-town']) {
      for (const z of [14, 16, 18]) {
        expect(sizeAt(id, z), `${id} z${z} çok büyük`).toBeLessThanOrEqual(16);
      }
    }
  });

  it('🔒 yerel sokak adı sürüş zoom bandından önce çizilmez (kalabalık bütçesi)', () => {
    const mz = (DAY.layers.find((l) => l.id === 'road-label') as unknown as { minzoom?: number }).minzoom;
    expect(mz, 'yerel sokak adı erken açılıyor').toBeGreaterThanOrEqual(15);
  });
});

/* ═══ 11 · ZOOM MATRİSİ — KENAR HİÇBİR BANTTA ÇÖKMEZ ══════════════════════ */

describe('11 · zoom matrisi — kenar bandı', () => {
  /**
   * ÖLÇÜLEN KUSUR (2026-09-09, §9 düzeltmesinden SONRA bulundu):
   * §9 yalnız bir TABAN koyuyordu ("kenar ≥ X px"). Taban sağlanıyor olsa da
   * kenar bandın İÇİNDE ÇÖKEBİLİYORDU. Yerel yolda ölçülen dizi:
   *
   *     z14 0,80 · z15 0,70 · **z16 0,60** · z17 0,85 · z18 1,10
   *
   * Yani yerel ağın EN ÇOK BAKILAN zoom'unda (z16, sürüş detayı) kenar bandın
   * en zayıf noktasındaydı — kullanıcı z14'te düzelmiş gördüğü yolu z16'da
   * yine soluk görecekti. Sebep: kasa durakları gövde duraklarıyla aynı
   * zoomlarda ama FARKLI eğimle ilerliyordu.
   * DÜZELTME: kasa z16 durağı 5,8 → 6,2 → kenar z14–z16 boyunca SABİT 0,80,
   * sonra 0,95 → 1,10.
   *
   * Bu bölüm o sınıfın hatasını kilitler: taban DEĞİL, BANT boyunca davranış.
   */
  const ev = (expr: unknown, z: number): number => {
    if (typeof expr === 'number') return expr;
    const e = expr as unknown[];
    if (!Array.isArray(e)) throw new Error('ifade degil');
    if (e[0] === 'interpolate') {
      const st: Array<[number, unknown]> = [];
      for (let i = 3; i < e.length; i += 2) st.push([e[i] as number, e[i + 1]]);
      if (z <= st[0]![0]) return ev(st[0]![1], z);
      if (z >= st[st.length - 1]![0]) return ev(st[st.length - 1]![1], z);
      for (let i = 1; i < st.length; i++) {
        if (z <= st[i]![0]) {
          const t = (z - st[i - 1]![0]) / (st[i]![0] - st[i - 1]![0]);
          const a = ev(st[i - 1]![1], z), b = ev(st[i]![1], z);
          return a + (b - a) * t;
        }
      }
    }
    if (e[0] === 'case') return ev(e[e.length - 1], z);            // rampa dışı dal
    throw new Error('desteklenmeyen ifade');
  };
  const lyr = (st: StyleSpecification, id: string) => {
    const l = st.layers.find((x) => x.id === id);
    if (!l) throw new Error(`katman yok: ${id}`);
    return l as unknown as { minzoom?: number; paint: Record<string, unknown> };
  };
  const w = (st: StyleSpecification, id: string, z: number) => ev(lyr(st, id).paint['line-width'], z);
  const kenar = (st: StyleSpecification, body: string, z: number) =>
    (w(st, `${body}-casing`, z) - w(st, body, z)) / 2;

  const SINIF = ['road-motorway', 'road-primary', 'road-secondary',
    'road-tertiary', 'road-minor', 'road-service'] as const;

  it('🔒 GÜNDÜZ · sürüş bandında kenar DİP YAPMAZ (z14→z18 monoton azalmaz)', () => {
    /* Ölçülen kusur tam buydu: yerel yol z14 0,80 → z16 0,60 (dip) → z18 1,10.
       Taban testi bunu göremez; bant testi görür. */
    for (const id of SINIF) {
      const mz = lyr(DAY, id).minzoom ?? 0;
      let onceki = -Infinity;
      for (const z of [14, 15, 16, 17, 18]) {
        if (z < mz) continue;
        const k = kenar(DAY, id, z);
        expect(k, `${id} · z${z} kenarı ${k.toFixed(2)} px — bir önceki zoom'un (${onceki.toFixed(2)}) ALTINA düştü`)
          .toBeGreaterThanOrEqual(onceki - 0.001);
        onceki = k;
      }
    }
  });

  it('🔒 GÜNDÜZ · genel bakış bandında (z10–z13) açılan sınıfın kenarı VARDIR', () => {
    /* Gerekçe: bir sınıf `minzoom`unda "açıldı" ama kenarı yarım pikselin
       altındaysa ekranda yoktur — matris yalan söyler. Ölçülen en düşük değer
       0,60 px (üçüncül z12 · yerel z13); taban onun altında, 0,55'te tutulur.
       Bu bant sürüş detayı DEĞİL bölgesel yapı bandıdır: hedef sınıfın
       varlığını göstermek, kalınlık hiyerarşisi kurmak değildir. */
    for (const id of SINIF) {
      const mz = lyr(DAY, id).minzoom ?? 0;
      for (const z of [10, 11, 12, 13]) {
        if (z < mz) continue;
        const k = kenar(DAY, id, z);
        expect(k, `${id} · z${z} kenarı ${k.toFixed(2)} px — sınıf açıldı ama ekranda kenarı yok`)
          .toBeGreaterThanOrEqual(0.55);
      }
    }
  });

  it('🔒 GÜNDÜZ · sınıf her zoomda kendinden ALT sınıftan kalın çizilir (z10–z18)', () => {
    /* Hiyerarşi tek bir zoomda değil, TÜM bantta ayakta kalmalı: matrisin
       amacı budur. Kıyas yalnız İKİ SINIFIN DA görünür olduğu zoomlarda
       yapılır (bir sınıf henüz açılmamışsa kıyas anlamsızdır). */
    for (let i = 1; i < SINIF.length; i++) {
      const ust = SINIF[i - 1]!, alt = SINIF[i]!;
      const z0 = Math.max(lyr(DAY, ust).minzoom ?? 0, lyr(DAY, alt).minzoom ?? 0);
      for (let z = Math.max(10, z0); z <= 18; z++) {
        expect(w(DAY, `${ust}-casing`, z), `z${z}: ${alt} üst sınıf ${ust} kadar kalın`)
          .toBeGreaterThan(w(DAY, `${alt}-casing`, z));
      }
    }
  });
});

/* ═══ 12 · NAVİGASYONDA BASTIRMA — GÜNDÜZ ZEMİNİNDE ÖLÇÜLDÜ ═════════════ */

describe('12 · navigasyon bastırması gündüz zemininde', () => {
  /**
   * KÖR NOKTA: `navSuppressionContrast.test.ts` bastırma kademelerini YALNIZ
   * GECE zeminine (`NIGHT_PALETTE.bg`) karşı ölçüyor. Gündüz zemini ve
   * üstünden geçilen yüzeyler (orman/park/kentsel) hiç ölçülmemişti — §1'deki
   * kusurun navigasyon tarafındaki İKİZİ. Bu tur gündüz paleti değiştiği için
   * kademe opaklıkları YENİ zeminde yeniden ölçülür.
   *
   * ÖLÇÜLEN (bu palet): en kötü hücre Tier 2 · servis kasası · orman = 1,15.
   * Yerel kasa en kötü 1,17. Taban 1,10'da tutulur: 1,00 = görünmez, 1,10 =
   * "hâlâ kenar var". Kavşakta çapraz sokağın SİLİNMEMESİ güvenlik kuralıdır
   * (bkz. `NAV_SUPPRESS_TIERS` başlığı).
   */
  const over = (fg: string, bg: string, a: number): string => {
    const f = rgbOf(fg), b = rgbOf(bg);
    return '#' + f.map((v, i) => Math.round(v * a + b[i]! * (1 - a)).toString(16).padStart(2, '0')).join('');
  };
  const alpha = (tier: number, id: string, prop: string): number => {
    const e = NAV_SUPPRESS_TIERS[tier]!.find(([i, p]) => i === id && p === prop);
    if (!e) throw new Error(`kademe ${tier} · ${id}.${prop} manifestte yok`);
    return e[2];
  };
  const KASA: ReadonlyArray<readonly [string, string]> = [
    ['road-primary-casing', P.primaryCasing],
    ['road-secondary-casing', P.secondaryCasing],
    ['road-tertiary-casing', P.tertiaryCasing],
    ['road-minor-casing', P.minorCasing],
    ['road-service-casing', P.serviceCasing],
  ];

  it('🔒 HİÇBİR kademede yol kasası, geçtiği HİÇBİR gündüz yüzeyinde silinmez', () => {
    for (let tier = 0; tier < NAV_SUPPRESS_TIERS.length; tier++) {
      for (const [id, col] of KASA) {
        const a = alpha(tier, id, 'line-opacity');
        for (const [gAd, g] of GROUNDS) {
          const c = contrast(over(col, g, a), g);
          expect(c, `kademe ${tier} · ${id} · ${gAd} üstünde ${c.toFixed(2)} — çizgi yüzeyde eridi`)
            .toBeGreaterThanOrEqual(1.10);
        }
      }
    }
  });

  it('🔒 bastırma MONOTONİKTİR ve Tier 0 bastırma YAPMAZ (tam bağlam)', () => {
    for (const [id] of KASA) {
      expect(alpha(0, id, 'line-opacity'), `${id} Tier 0'da bastırılmış`).toBe(1);
      expect(alpha(1, id, 'line-opacity')).toBeGreaterThan(alpha(2, id, 'line-opacity'));
      expect(alpha(1, id, 'line-opacity')).toBeLessThan(1);
    }
  });

  it('🔒 en agresif kademede bile sokak adı gündüz zemininde OKUNUR kalır', () => {
    const a = alpha(NAV_SUPPRESS_TIERS.length - 1, 'road-label', 'text-opacity');
    const c = contrast(over(P.labelText, P.bg, a), P.bg);
    expect(c, `kavşak kademesinde etiket/zemin ${c.toFixed(2)} — yazı kayboldu`)
      .toBeGreaterThanOrEqual(2.5);
  });

  it('🔒 OTOYOL ailesi hiçbir kademede bastırılmaz (otoyol bağlamı korunur)', () => {
    for (const tier of [0, 1, 2]) {
      for (const id of ['road-motorway', 'road-motorway-casing', 'road-label-major']) {
        expect(NAV_SUPPRESS_TIERS[tier]!.some(([i]) => i === id),
          `${id} kademe ${tier} manifestine girmiş — otoyol bağlamı sönebilir`).toBe(false);
      }
    }
  });
});

/* ═══ 13 · TEK STİL YOLU — MINI/FULL · RASTER · YENİDEN YÜKLEME ══════════ */

describe('13 · tek stil yolu (MINI/FULL · raster · reload)', () => {
  /**
   * MINI ve FULL yüzeyleri KENDİ paletlerini kurmaz: ikisi de
   * `mapSourceManager.getMapStyle()` çağırır. Bu bölüm o sözleşmenin
   * KAYNAK METİNDE de bozulmadığını doğrular — ikinci bir gündüz gerçeği
   * (bileşen içinde hex, yerel palet kopyası) bu turda EN BÜYÜK risktir.
   */
  const SRC = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8');
  const YUZEYLER = ['components/map/MiniMapWidget.tsx', 'components/map/FullMapView.tsx'] as const;

  it('🔒 MINI ve FULL stili TEK otoriteden alır (kilidin bağlı olduğu kanıt)', () => {
    for (const f of YUZEYLER) {
      const src = SRC(f);
      expect(src.length, `${f} okunamadı — kilit boş kümede çalışıyor`).toBeGreaterThan(1000);
      expect(src.includes('getMapStyle'), `${f} artık getMapStyle kullanmıyor — kilit yeni yola BAĞLANMALI`)
        .toBe(true);
    }
  });

  it('🔒 harita yüzeyleri gündüz paletinin hiçbir tonunu KENDİ İÇİNDE taşımaz', () => {
    const TONLAR = [P.bg, P.motorway, P.minor, P.minorCasing, P.motorwayCasing,
      P.buildingFill, P.park, P.forest, P.water, P.labelHalo];
    for (const f of YUZEYLER) {
      const src = SRC(f).toLowerCase();
      for (const ton of TONLAR) {
        expect(src.includes(ton.toLowerCase()),
          `${f} içinde ${ton} var — ikinci gündüz gerçeği (palet bileşene sızmış)`).toBe(false);
      }
    }
  });

  it('🔒 stil YENİDEN üretildiğinde birebir aynıdır (style reload sapması yok)', () => {
    const a = styleFor(false), b = styleFor(false);
    expect(a.layers.map((l) => l.id)).toEqual(b.layers.map((l) => l.id));
    expect(JSON.stringify(a.layers)).toBe(JSON.stringify(b.layers));
  });

  it('🔒 RASTER yola düşülse bile gündüz zemini AYNI tokendir (zemin sıçraması yok)', () => {
    /* MINI düşük tier'da veya vektör kaynağı yokken raster'a düşer. Zemin
       tokeni ayrışsaydı kullanıcı gündüz içinde renk sıçraması görürdü —
       2026-09-05'te bir kez yaşandı (iki ayrı MAP_BG_DAY tokeni). */
    const raster = buildRoadStyle(null, new Map(), () => ['https://example.invalid/{z}/{x}/{y}.png'], false);
    const bg = raster.layers.find((l) => l.id === 'background') as unknown as
      { paint?: Record<string, unknown> } | undefined;
    expect(bg?.paint?.['background-color'], 'raster gündüz zemini vektörden ayrışmış').toBe(MAP_BG_DAY);
    expect(paint(DAY, 'background', 'background-color')).toBe(MAP_BG_DAY);
  });
});
