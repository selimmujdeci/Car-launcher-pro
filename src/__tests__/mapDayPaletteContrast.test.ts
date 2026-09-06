/**
 * mapDayPaletteContrast.test.ts — gündüz vektör paletinin TON SÖZLEŞMESİ kilidi.
 *
 * NEDEN VAR: gündüz paletinin ilk sürümü zemini beyaza (#fafbfc) çekiyordu ve tali
 * yolun zemine kontrastı **1.38**'e düşüyordu — sürücünün sahada gördüğü "yollar
 * beyaz, hiçbir şey seçilmiyor" tam olarak bu sayıydı. Renk tercihi tartışmaya
 * açıktır, ama **ölçülebilir ayrım pazarlık konusu değildir**: bu dosya rolleri ve
 * en düşük kontrast oranlarını kilitler, böylece palet bir daha sessizce beyazlaşamaz.
 *
 * SÖZLEŞME: binalar EN AÇIK (beyaz) · zemin ORTADA · yollar EN KOYU, otoyoldan
 * taliye monoton açılan gri. Hiyerarşi renkle değil TONLA taşınır.
 */

import { describe, it, expect } from 'vitest';
import { buildVectorStyle } from '../platform/mapStyleBuilders';
import { MAP_BG_DAY } from '../platform/map/_mapIds';
import type { MapSource } from '../platform/mapSourceTypes';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

/* ── WCAG bağıl parlaklık + kontrast oranı ────────────────────────────────── */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ── Stil kurulumu ────────────────────────────────────────────────────────── */

const LOCAL_PBF: MapSource = {
  id: 'local', name: 'local', type: 'offline', description: '', isAvailable: true,
};

function styleFor(night: boolean): StyleSpecification {
  const sources = new Map<string, MapSource>([['local', LOCAL_PBF]]);
  return buildVectorStyle(sources, () => {
    throw new Error('vektör stili üretilemedi — raster fallback bu kilidin konusu değil');
  }, night);
}

function layer(style: StyleSpecification, id: string): LayerSpecification {
  const found = style.layers.find((l) => l.id === id);
  if (!found) throw new Error(`katman bulunamadı: ${id}`);
  return found;
}
function paintColor(style: StyleSpecification, id: string, prop: string): string {
  const p = (layer(style, id) as unknown as { paint?: Record<string, unknown> }).paint ?? {};
  const v = p[prop];
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) {
    throw new Error(`${id}.${prop} düz hex renk değil: ${String(v)}`);
  }
  return v;
}

const DAY = styleFor(false);
const NIGHT = styleFor(true);

const bg        = () => paintColor(DAY, 'background', 'background-color');
const bldgFill  = () => paintColor(DAY, 'building', 'fill-color');
const bldgLine  = () => paintColor(DAY, 'building', 'fill-outline-color');

const ROAD_BODY = {
  motorway:  'road-motorway',
  primary:   'road-primary',
  secondary: 'road-secondary',
  /* 2026-09-06: `tertiary` kendi kademesini aldı (kasa + gövde + genişlik).
     ÖLÇÜM (Tarsus z12–14, OpenFreeMap planet): tertiary 303 parça · secondary
     206 — yani EN YOĞUN sınıf, secondary ile AYNI ağırlıkta çiziliyordu. */
  tertiary:  'road-tertiary',
  minor:     'road-minor',
} as const;

/** Gövde → kasa eşlemesi. `secondary` kasası tasarımda `minor` kasasını paylaşır. */
const ROAD_CASING: Record<keyof typeof ROAD_BODY, string> = {
  motorway:  'road-motorway-casing',
  primary:   'road-primary-casing',
  /* 2026-09-05: `secondary` artık `road-minor-casing`i PAYLAŞMIYOR — kendi
     kasası var (`tertiary` ile birlikte). Eşleme gerçeğe göre düzeltildi. */
  secondary: 'road-secondary-casing',
  tertiary:  'road-tertiary-casing',
  minor:     'road-minor-casing',
};

/**
 * ⚠️ **KİLİT YENİDEN HEDEFLENDİ (2026-09-05 akşamı · GERÇEK CİHAZ KARARI).**
 *
 * Eski tablo *gövde/zemin* kontrastını ölçüyordu (otoyol ≥3,9 … tali ≥1,68) ve
 * bu, "yollar zeminden KOYU" sözleşmesinin sayısal karşılığıydı. Kullanıcı
 * gerçek head unit'te aynı konumun iki görünümünü yan yana koyup **gri yollu
 * olanı işaretleyerek REDDETTİ**, beyaz yollu / krem zeminli olanı seçti
 * (bkz. `DAY_PALETTE` üstündeki karar kaydı). Sözleşme tersine döndüğü için
 * gövde/zemin oranı ARTIK DOĞRU ÖLÇÜ DEĞİLDİR: beyaz yolun krem zemine
 * kontrastı zaten düşüktür ve OLMASI GEREKEN budur.
 *
 * Kilit SİLİNMEDİ — ölçtüğü YER düzeltildi. Beyaz yollu kartografide
 * okunabilirliği **kasa** taşır, bu yüzden iki oran kilitlenir:
 *   · kasa ↔ zemin  (yol kenarı zeminde kaybolmasın)
 *   · gövde ↔ kasa  (gövde kasanın içinde kaybolmasın)
 *
 * 2026-08'deki *"yollar beyaz, hiçbir şey seçilmiyor"* (1,38) fiyaskosunun
 * gerçek sebebi beyaz GÖVDE değil, o turda KASANIN da açık olmasıydı — bu
 * kilit tam olarak o kusuru yakalar (altındaki karşıt-örnek testine bakınız).
 *
 * Bugünkü ölçüm — kasa/zemin: otoyol 2,65 · ana 2,34 · ikincil 2,03 · tali 1,76
 *                 gövde/kasa: otoyol 3,05 · ana 2,63 · ikincil 2,20 · tali 1,84
 */
/* ── EŞİK TABLOSU 5 KADEMEYE GENİŞLETİLDİ (2026-09-06) ─────────────────────
 * Kilit SİLİNMEDİ; ölçülen yeni davranışa GÜNCELLENDİ. Gerekçe sayısaldır:
 * merdiven 4 → 5 kademe oldu ve `tertiary` ESKİ `minor` basamağını (kasa/zemin
 * 1,72) devraldı; `minor` ise bilinçli olarak GERİ ÇEKİLDİ (1,51).
 *
 * Neden geri çekilmesi DOĞRU: yerel yol, navigasyonda bağlamdır, hedef değildir.
 * Kullanıcının saha bildirimi *"çok fazla yol aynı görsel ağırlıkta"* idi ve
 * ölçüm bunu doğruladı (tertiary+secondary tek kasayı, minor+service tek tonu
 * paylaşıyordu → 5 sınıf, 2 görsel kademe).
 *
 * Ölçülen yeni merdiven — kasa/zemin: 2,61 · 2,30 · 2,00 · 1,72 · 1,51
 *                          komşu ayrışma: 1,132 · 1,153 · 1,158 · 1,140
 *                          uçtan uca: 1,725
 * Bu değerler `mapDayPaletteContrast` içindeki "sınıf ayrımı" kilidiyle de
 * ayrıca korunur; yani eşik düşürmek ayrışmayı serbest bırakmaz. */
const MIN_CASING_BG_CONTRAST: Record<keyof typeof ROAD_BODY, number> = {
  motorway: 2.5, primary: 2.2, secondary: 1.95, tertiary: 1.60, minor: 1.45,
};
const MIN_BODY_CASING_CONTRAST: Record<keyof typeof ROAD_BODY, number> = {
  motorway: 2.9, primary: 2.5, secondary: 2.1, tertiary: 1.75, minor: 1.55,
};

describe('gündüz vektör paleti — ton sözleşmesi', () => {
  it('zemin SAF BEYAZ değildir ve bina sınırı konturla korunur', () => {
    /*
     * ⚠️ BU KİLİT DÜZELTİLDİ. Önceki hali "zemin beyazdan en az 1.1 uzakta olsun"
     * diyordu — yanlış bir VEKİL ölçüydü. Asıl kural yol/zemin ayrımıdır ve
     * yollar koyulaştıktan sonra zemini beyaza yaklaştırmak o ayrımı BOZMAZ,
     * artırır (tali sokak 1.63 → 1.71). Eski eşik korunsaydı doğru paleti
     * engelleyecekti. Kilit gevşetilmedi, ölçtüğü şey DÜZELTİLDİ: zemin saf
     * beyaz olamaz, ve zemin beyaza yaklaştıkça kaybolan bina/zemin farkını
     * KONTUR taşımak zorundadır.
     */
    expect(luminance(bg())).toBeLessThan(luminance('#ffffff'));
    expect(contrast(bldgLine(), bg())).toBeGreaterThanOrEqual(1.4);
  });

  it('YOLLAR haritanın EN AÇIK öğesidir; bina kütlesi zeminden koyudur', () => {
    /* KİLİDİN GEÇMİŞİ: bu test 2026-08'de "binalar en açık (beyaz)" diyor ve
       `buildingFill === '#ffffff'` sabitini tutuyordu. 2026-09-05 akşamı
       kullanıcı gerçek cihazda gri-yollu görünümü işaretleyip reddetti,
       beyaz-yollu görünümü seçti → rol dağılımı DEĞİŞTİ: yol en açık ·
       zemin ortada · bina en koyu. Kilit kaldırılmadı, yeni role bağlandı. */
    expect(paintColor(DAY, 'road-motorway', 'line-color').toLowerCase()).toBe('#ffffff');
    for (const id of Object.values(ROAD_BODY)) {
      const body = paintColor(DAY, id, 'line-color');
      expect(luminance(body), `${id} zeminden açık olmalı`)
        .toBeGreaterThan(luminance(bg()));
      expect(luminance(bldgFill()), `bina kütlesi ${id}'den koyu olmalı`)
        .toBeLessThan(luminance(body));
    }
    expect(luminance(bldgFill()), 'bina zeminden koyu olmalı').toBeLessThan(luminance(bg()));
    expect(contrast(bg(), bldgFill()), 'bina zeminde kayboluyor').toBeGreaterThanOrEqual(1.2);
  });

  it('bina konturu dolgudan koyudur → beyaz binalar birbirine yapışmaz', () => {
    expect(luminance(bldgLine())).toBeLessThan(luminance(bldgFill()));
    expect(contrast(bldgFill(), bldgLine())).toBeGreaterThan(1.2);
  });

  it('yol/zemin ayrımını KASA taşır — her kademe iki eşiği de geçer', () => {
    for (const key of Object.keys(ROAD_BODY) as Array<keyof typeof ROAD_BODY>) {
      const body   = paintColor(DAY, ROAD_BODY[key], 'line-color');
      const casing = paintColor(DAY, ROAD_CASING[key], 'line-color');
      expect(contrast(bg(), casing), `${key} kasa/zemin kontrastı yetersiz`)
        .toBeGreaterThanOrEqual(MIN_CASING_BG_CONTRAST[key]);
      expect(contrast(body, casing), `${key} gövde/kasa kontrastı yetersiz`)
        .toBeGreaterThanOrEqual(MIN_BODY_CASING_CONTRAST[key]);
    }
  });

  it('eski (kusurlu) "beyaz gövde + AÇIK kasa" paleti bu kilidi GEÇEMEZDİ', () => {
    /* Kilidin anlamı: 2026-08'deki 1,38 fiyaskosunda kasa da açıktı. Aynı zemin
       üstünde açık bir kasa (ör. `#dfe3e8`) eşiği açıkça DÜŞÜRÜR. */
    expect(contrast(bg(), '#dfe3e8')).toBeLessThan(MIN_CASING_BG_CONTRAST.minor);
  });

  it('yol hiyerarşisi TON olarak monotondur: otoyol en AÇIK → tali en koyu', () => {
    /* Yön 2026-09-05 cihaz kararıyla TERSİNE döndü. Monotonluk şartı
       KALDIRILMADI — yalnız yönü değişti; ayrıca kasa merdiveninin de monoton
       olması artık AYRICA kilitlenir, çünkü gündüz hiyerarşisinin asıl
       taşıyıcısı odur. */
    const govde = (['motorway', 'primary', 'secondary', 'minor'] as const)
      .map((k) => luminance(paintColor(DAY, ROAD_BODY[k], 'line-color')));
    for (let i = 1; i < govde.length; i++) {
      expect(govde[i], `gövde hiyerarşisi ${i}. adımda bozuldu`).toBeLessThan(govde[i - 1]!);
    }
    const kasa = (['motorway', 'primary', 'secondary', 'minor'] as const)
      .map((k) => luminance(paintColor(DAY, ROAD_CASING[k], 'line-color')));
    for (let i = 1; i < kasa.length; i++) {
      expect(kasa[i], `kasa hiyerarşisi ${i}. adımda bozuldu`).toBeGreaterThan(kasa[i - 1]!);
    }
  });

  it('her kasa kendi gövdesinden koyudur — ince yolu görünür kılan kasadır', () => {
    for (const key of Object.keys(ROAD_BODY) as Array<keyof typeof ROAD_BODY>) {
      const body   = paintColor(DAY, ROAD_BODY[key], 'line-color');
      const casing = paintColor(DAY, ROAD_CASING[key], 'line-color');
      expect(luminance(casing), `${key} kasası gövdeden koyu olmalı`).toBeLessThan(luminance(body));
    }
  });

  it('su ve park zeminden ayrışır (nötr griye karışmaz)', () => {
    for (const id of ['water-fill', 'landuse-park']) {
      expect(contrast(bg(), paintColor(DAY, id, 'fill-color')), id).toBeGreaterThan(1.05);
    }
  });
});

describe('gündüz etiketleri — halo palete bağlı (gece sabiti sızmaz)', () => {
  /*
   * REGRESYON: `place-town` ve `place-city` halo'ları palette `townHalo`/`cityHalo`
   * TANIMLI olmasına rağmen gece sabitini (#060c14) doğrudan yazıyordu → gündüz
   * beyaz zeminde koyu lacivert gölge. Palet kurulmuş ama katmanlar ona
   * BAĞLANMAMIŞTI; bu kilit o yarım işin geri gelmesini engeller.
   */
  it('hiçbir gündüz katmanı gece halo sabitini taşımaz', () => {
    expect(JSON.stringify(DAY.layers)).not.toContain('#060c14');
  });

  it('şehir/kasaba/yol etiketlerinin halosu açık, metni koyudur', () => {
    for (const id of ['road-label', 'place-town', 'place-city']) {
      const text = paintColor(DAY, id, 'text-color');
      const halo = paintColor(DAY, id, 'text-halo-color');
      expect(luminance(halo), `${id} halosu açık olmalı`).toBeGreaterThan(luminance(text));
      expect(contrast(text, halo), `${id} metin/halo kontrastı`).toBeGreaterThan(4.5);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * KULLANICI SAHA BİLDİRİMİ · 2026-09-06 — "AMBER RENGİ NAVİGASYONU BU HALE GETİRİYOR"
 * ═══════════════════════════════════════════════════════════════════════════
 * Kullanıcı aynı konumun iki görünümünü yan yana koydu ve KREM olanı İŞARETLEYEREK
 * reddetti. Ölçüm (cihaz): yapısal ailedeki **19 rengin 19'u** 33–48° sıcak hue
 * bandında, ortalama doygunluk **%23**. Zemin/bina/kasa/gövde/arazi aynı hue'yu
 * paylaşınca harita TEK PARÇA krem ağ gibi okunuyordu.
 *
 * Üstteki kilit bunu YAKALAYAMADI çünkü yalnız **parlaklık** ölçüyor ve gövde
 * merdiveninden sadece **monotonluk** istiyordu. `#fdfcf8 < #ffffff` monotondur
 * ama 1,027:1'dir — algı eşiğinin altı. **Monoton olmak ≠ ayrışmak.**
 *
 * Bu blok o iki deliği kapatır:
 *   1) NÖTR AİLE gerçekten nötr mü?      (doygunluk tavanı)
 *   2) SINIF AYRIMI gerçekten var mı?     (kasa merdiveni ayrışması)
 *   3) Kromatik olanlar kromatik kaldı mı? (nötrleme fazla uygulanmasın)
 */
/* ÖLÇÜ SEÇİMİ — neden HSL doygunluğu DEĞİL:
   Beyaza yakın renklerde HSL doygunluğu patlar (`#e9eef3` tamamen nötr olduğu
   hâlde %29 çıkar) → kilit sahte pozitif verirdi. Kusur zaten BÜYÜKLÜK değildi:
   reddedilen paletin 12 renginin 12'si de **40–48° sıcak hue bandındaydı**, yeni
   paletin 13 renginin hiçbiri değil (210–240° ya da saf gri). Ölçü bu yüzden
   **hue YÖNÜ** + mutlak kroma tavanıdır. */
function chroma(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}
/** Gri ise `null`. */
function hueOf(hex: string): number | null {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return null;
  const h = mx === r ? 60 * (((g - b) / d) % 6)
    : mx === g ? 60 * ((b - r) / d + 2)
    : 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
}
/** Amber/sıcak bandı — kullanıcının reddettiği cast tam olarak burası. */
const AMBER_BAND: readonly [number, number] = [15, 75];
/** Bu kromanın altında hue anlamsızdır (yuvarlama gürültüsü). */
const HUE_SIGNIFICANT_CHROMA = 0.015;

/** Nötr aile: yapıyı çizen, kendi anlamı olan rengi OLMAYAN katmanlar. */
const NEUTRAL_FAMILY: ReadonlyArray<readonly [string, string]> = [
  ['background', 'background-color'],
  ['building', 'fill-color'],
  ['building', 'fill-outline-color'],
  ['landuse-residential', 'fill-color'],
  ['landuse-urban', 'fill-color'],
  ['road-motorway', 'line-color'],
  ['road-primary', 'line-color'],
  ['road-secondary', 'line-color'],
  ['road-minor', 'line-color'],
  ['road-motorway-casing', 'line-color'],
  ['road-primary-casing', 'line-color'],
  ['road-secondary-casing', 'line-color'],
  ['road-minor-casing', 'line-color'],
];

/** Kromatik aile: rengi ANLAM taşır — nötrlenmesi kusurdur. */
const CHROMATIC_FAMILY: ReadonlyArray<readonly [string, string]> = [
  ['water-fill', 'fill-color'],
  ['landuse-park', 'fill-color'],
];

/** Ölçüldü: yeni palette nötr ailenin en yüksek kroması %3,9. Tavan %15 —
 *  asıl kapı hue YÖNÜDÜR; bu yalnız "hiçbir yapısal renk kuvvetli boyanmasın" sınırı. */
const MAX_NEUTRAL_CHROMA = 0.15;

describe('🔒 gündüz paleti — AMBER CAST YASAK (kullanıcı saha reddi 2026-09-06)', () => {
  it('yapısal (nötr) aile AMBER BANDINDA DEĞİLDİR — sıcak cast geri gelemez', () => {
    for (const [id, prop] of NEUTRAL_FAMILY) {
      const hex = paintColor(DAY, id, prop);
      expect(chroma(hex), `${id}.${prop} = ${hex} — nötr aile fazla renkli`)
        .toBeLessThanOrEqual(MAX_NEUTRAL_CHROMA);
      const h = hueOf(hex);
      if (h === null || chroma(hex) < HUE_SIGNIFICANT_CHROMA) continue;
      expect(h >= AMBER_BAND[0] && h <= AMBER_BAND[1],
        `${id}.${prop} = ${hex} hue ${h.toFixed(0)}° — AMBER BANDINDA; kullanıcının reddettiği cast geri gelmiş`)
        .toBe(false);
    }
  });

  it('reddedilen krem paletin HER RENGİ bu kilidi GEÇEMEZDİ (karşıt-örnek — kilit kör değil)', () => {
    /* 2026-09-06'da kullanıcının işaretleyerek reddettiği paletin bire bir değerleri. */
    const REDDEDİLEN = ['#f2efe6', '#ded6c6', '#c6bda9', '#ece8dc', '#e4dfd0',
      '#9a9384', '#a49d8e', '#b0a999', '#bdb6a6', '#fdfcf8', '#faf8f1', '#f7f4ec'];
    for (const hex of REDDEDİLEN) {
      const h = hueOf(hex);
      expect(h, `${hex} gri çıktı — karşıt-örnek bozulmuş`).not.toBeNull();
      expect(chroma(hex), `${hex} kroma eşiğinin altında — karşıt-örnek zayıf`)
        .toBeGreaterThanOrEqual(HUE_SIGNIFICANT_CHROMA);
      expect(h! >= AMBER_BAND[0] && h! <= AMBER_BAND[1],
        `${hex} (hue ${h!.toFixed(0)}°) kilidi GEÇİYOR — kilit artık hiçbir şeyi korumuyor`)
        .toBe(true);
    }
  });

  it('su ve park KROMATİK kalır — nötrleme fazla uygulanmamış', () => {
    for (const [id, prop] of CHROMATIC_FAMILY) {
      const hex = paintColor(DAY, id, prop);
      expect(chroma(hex), `${id} nötr griye düşmüş — anlam taşıyan renk kaybolmuş`)
        .toBeGreaterThan(0.10);
    }
  });

  it('SINIF AYRIMI gerçekten görünür — "monoton" YETMEZ', () => {
    /* Ayrımı taşıyan KASA'dır (gövde beyaza yakın kalmalı — 2026-09-05 cihaz kararı),
       bu yüzden ölçüm kasa merdiveninde yapılır. Ölçüldü: komşu 1,13–1,16 · uçtan uca 1,513. */
    const rungs = (['motorway', 'primary', 'secondary', 'tertiary', 'minor'] as const)
      .map((k) => paintColor(DAY, ROAD_CASING[k], 'line-color'));
    for (let i = 1; i < rungs.length; i++) {
      expect(contrast(rungs[i - 1]!, rungs[i]!), `${i}. komşu sınıf çifti ayrışmıyor (monoton ama görünmez)`)
        .toBeGreaterThanOrEqual(1.10);
    }
    expect(contrast(rungs[0]!, rungs[rungs.length - 1]!), 'otoyol↔tali uçtan uca hiyerarşi çökmüş')
      .toBeGreaterThanOrEqual(1.60);   // 5 kademe: ölçülen 1,725
  });

  it('gündüz zemini TEK TOKENDIR — raster ve vektör aynı zemini yazar', () => {
    /* ÖNCE iki token vardı (`MAP_BG_DAY` #e9eef3 · vektör #f2efe6) ve `applyMapDayNight`
       ikisini de yazıyordu → cihazda aynı anda FULL rgb(233,238,243), MINI #f2efe6. */
    expect(paintColor(DAY, 'background', 'background-color').toLowerCase())
      .toBe(MAP_BG_DAY.toLowerCase());
  });
});

describe('🔒 VEKTÖR STİLİ · TERRAIN BİLDİRİLMEZ (cihazda ölçüldü 2026-09-06)', () => {
  /* KULLANICI: *"rota çizgisi neden açık mavi · harita uzaklaşınca mavi oluyor,
     kamera zoom yapınca açık mavi oluyor."*

     TEK DEĞİŞKENLİ DENEY (Xiaomi 23090RA98I, canlı harita, CDP):
       rota çekirdeği `line-color:#FF0000` · `line-opacity:1` yazıldı.
         terrain AÇIK   → ekranda `#edaeaf`  (efektif alfa ≈ 0,27)
         terrain KAPALI → ekranda `#ff0000`  (tam güç)
       Mavi çekirdekte de birebir aynı: `#006CFF` → `#adc4e5`.

     `terrain` bildirildiğinde MapLibre tüm vektör katmanlarını arazi örgüsüne
     giydirmek için ayrı framebuffer'a çizip yeniden örnekler; bu cihazda o yol
     katman alfasını ~0,27'ye düşürüyor — rota değil HARİTANIN TAMAMI yıkanıyordu.
     Raster stilde terrain YOK; kullanıcının "OSM canlı, vektör soluk"
     karşılaştırmasının sebebi buydu. */

  it('vektör stili `terrain` TAŞIMAZ — tüm katmanları yıkayan render yolu kapalı', () => {
    for (const night of [false, true]) {
      const style = styleFor(night) as unknown as { terrain?: unknown };
      expect(style.terrain, `${night ? 'gece' : 'gündüz'} stilinde terrain geri gelmiş — harita solar`)
        .toBeUndefined();
    }
  });

  it('kullanılmayan `raster-dem` kaynağı da yok — ölü DEM isteği üretilmez', () => {
    for (const night of [false, true]) {
      const srcs = (styleFor(night).sources ?? {}) as Record<string, { type?: string }>;
      const dem = Object.entries(srcs).filter(([, v]) => v && v.type === 'raster-dem');
      expect(dem.map(([k]) => k), 'terrain tüketicisi yokken DEM kaynağı duruyor (404 trafiği)')
        .toEqual([]);
    }
  });

  it('3B bina terrain’e BAĞLI DEĞİL — kaldırma görsel yetenek kaybetmedi', () => {
    const ids = styleFor(false).layers.map((l) => l.id);
    expect(ids.some((id) => /building/i.test(id)), 'bina katmanı kaybolmuş').toBe(true);
    expect(styleFor(false).layers.some((l) => l.type === 'hillshade'),
      'hillshade katmanı varsa terrain kaldırılamaz — kilit yanlış').toBe(false);
  });
});

describe('gece paleti — bu turda DEĞİŞMEDİ', () => {
  it('gece halo değerleri birebir korunur (halo palete bağlanması gece davranışını değiştirmez)', () => {
    expect(paintColor(NIGHT, 'place-town', 'text-halo-color')).toBe('#060c14');
    expect(paintColor(NIGHT, 'place-city', 'text-halo-color')).toBe('#060c14');
  });

  it('gecede zemin koyu, yollar zeminden AÇIK kalır — gündüzün tersi ve doğrusu', () => {
    const nightBg = paintColor(NIGHT, 'background', 'background-color');
    for (const id of Object.values(ROAD_BODY)) {
      expect(luminance(paintColor(NIGHT, id, 'line-color')), id).toBeGreaterThan(luminance(nightBg));
    }
  });
});
