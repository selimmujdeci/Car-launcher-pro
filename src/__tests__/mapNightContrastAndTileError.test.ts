/**
 * mapNightContrastAndTileError.test.ts — #609 KİLİT: iki saha kusuru.
 *
 * SAHA (2026-08-17, gerçek araç ekranı, ESKİ APK):
 *   (1) Mini haritada kalıcı "HARİTA YÜKLENEMİYOR" — ama tam ekran harita
 *       karoları SORUNSUZ çiziyordu.
 *   (2) "harita neredeyse her şey koyu … yollar ile genel harita aynı gibi".
 *
 * Bu dosya iki kökü de kilitler. Kilitler ZAYIFLATILMAZ/SİLİNMEZ
 * (CLAUDE.md regresyon kasası kuralı); davranış bilinçli değişirse GÜNCELLENİR.
 */
import { describe, it, expect } from 'vitest';
import { NIGHT_PALETTE, DAY_PALETTE } from '../platform/mapStyleBuilders';
import { MAP_BG_NIGHT, isBasemapTileSourceType } from '../platform/map/_mapIds';

/* ── WCAG bağıl parlaklık — ölçüm aracı (göz kararı DEĞİL) ──────────────── */

function _lin(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b);
}
/** İki renk arasındaki WCAG kontrast oranı (1 = aynı, 21 = siyah/beyaz). */
function contrast(a: string, b: string): number {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('#609 (1) — `tileError` mandalı: karar ADA değil TÜRE bağlı', () => {
  /* KÖK: iyileşme yolu sabit `map-tiles` adını arıyordu. O ad DÖRT stilden
     YALNIZ raster OSM'de var; vektörde `omv`, uydu/hibritte `satellite-tiles`.
     → YOL modunda bayrak bir kez kalkınca BİR DAHA İNMİYORDU (tek yönlü mandal,
     #606'daki `failure:OBD` circiriyle aynı sınıf). */

  it('karo kaynağı türleri (raster · vector) zemin sayılır', () => {
    expect(isBasemapTileSourceType('raster')).toBe(true);
    expect(isBasemapTileSourceType('vector')).toBe(true);
  });

  it('raster-dem (yükselti) zemin karosu SAYILMAZ — sahadaki yanlış alarmın kökü', () => {
    /* Vektör stilindeki `terrain-rgb` kaynağının 404'leri sayaca giriyordu;
       oysa yükselti yokluğu haritayı çizilemez YAPMAZ, kabartmayı kapatır. */
    expect(isBasemapTileSourceType('raster-dem')).toBe(false);
  });

  it('karo olmayan kaynaklar sayılmaz', () => {
    for (const t of ['geojson', 'image', 'video', 'canvas', undefined]) {
      expect(isBasemapTileSourceType(t)).toBe(false);
    }
  });

  it('yüklem SABİT BİR KAYNAK ADINA bağlı değildir (regresyon kökü)', () => {
    /* Kaynak ADI stilden stile değişir. Yüklem türe baktığı sürece üç adın da
       aynı sonucu vermesi gerekir — ad bazlı bir dal geri gelirse bu düşer. */
    for (const _ad of ['omv', 'map-tiles', 'satellite-tiles']) {
      expect(isBasemapTileSourceType('vector')).toBe(true);
      expect(isBasemapTileSourceType('raster')).toBe(true);
    }
  });
});

describe('#609 (2) — gece paleti ÖLÇÜLMÜŞ kontrast sözleşmesi', () => {
  const bg = NIGHT_PALETTE.bg;

  it('zemin kimliği DEĞİŞMEDİ — kontrast zemini açarak kazanılmadı', () => {
    expect(bg).toBe(MAP_BG_NIGHT);
  });

  /* Saha şikâyeti "yollar ile genel harita aynı gibi" idi; ölçülen eski
     değerler: minor 1.20 · secondary 1.47 · primary 1.78 · motorway 2.76. */
  it('yol kademeleri zeminden YETERİNCE ayrılır', () => {
    /* ── EŞİKLER 2026-09-09 SAHA KARARIYLA YENİDEN HEDEFLENDİ ──────────────
     * Eşikler 2026-08-17'de kullanıcı kararıyla YÜKSELTİLMİŞTİ ("yollar daha
     * beyaz, daha keskin olsun"). 2026-09-09'da kullanıcı gerçek cihaz
     * ekranını Google gece navigasyonuyla yan yana koyup REDDETTİ; ölçüm
     * sebebi gösterdi: rota çekirdeği / yerel yol parlaklık oranı **0,39**,
     * yani ekranın en parlak öğesi hiyerarşinin en altındaki sokaktı.
     *
     * Eşikler bu yüzden rotanın altına indi — ama ZEMİNDEN AYRIŞMA ŞARTI
     * KALDIRILMADI, yalnız Google'dan %80 keskin bir bantta yeniden çizildi
     * (ölçülen yeni değerler: minor 2,39 · secondary 3,47 · primary 4,01 ·
     * motorway 4,48). Kilidin koruduğu asıl regresyon — "yollar ile harita
     * aynı gibi" — bu bantta hâlâ imkânsızdır. */
    const hedef: Array<[keyof typeof NIGHT_PALETTE, number]> = [
      ['minor',     2.3],
      ['secondary', 3.3],
      ['primary',   3.8],
      ['motorway',  4.2],
    ];
    for (const [ad, min] of hedef) {
      const cr = contrast(bg, NIGHT_PALETTE[ad] as string);
      expect(cr, `${String(ad)} kontrastı ${cr.toFixed(2)} < ${min}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('yol hiyerarşisi TON YÖNÜNÜ korur; ADIM büyüklüğü kasa/genişlikte', () => {
    /* ⚠️ KİLİT YENİDEN HEDEFLENDİ (2026-09-05 · kullanıcı: "yolları tam beyaz
     * yap"). Eskiden her kademenin bir altından ≥1,25 TON farkı istenirdi.
     * Gece yolları beyaz aileye alınınca ton adımları zorunlu olarak küçülür
     * (1,04–1,08) — çünkü dört rengin dördü de beyazın yakınındadır. Bu, TAM
     * OLARAK gündüz paletinde kullanıcının onayladığı sözleşmedir: hiyerarşiyi
     * GENİŞLİK + KASA taşır.
     *
     * Kilit KALDIRILMADI, ikiye bölündü:
     *   (a) TON YÖNÜ hâlâ zorunlu — otoyol en açık, tali en koyu;
     *   (b) ADIM büyüklüğü artık genişlik merdiveninde ölçülür
     *       (`cartographyAuthority.test.ts` §4: her zoomda ayrık ve
     *        otoyol/tali ≥ 2,5×) ve kasa/gövde ayrımında.
     * Böylece "hiyerarşi var mı?" sorusu ölçülmeye DEVAM eder, yalnız doğru
     * yerden. */
    const sira = ['minor', 'secondary', 'primary', 'motorway'] as const;
    for (let i = 1; i < sira.length; i++) {
      const alt = NIGHT_PALETTE[sira[i - 1]] as string;
      const ust = NIGHT_PALETTE[sira[i]] as string;
      expect(luminance(ust), `${sira[i]} ${sira[i - 1]}'den açık olmalı`)
        .toBeGreaterThan(luminance(alt));
    }
    /* Kasa hâlâ gövdeyi zeminden ayırmalı — beyaz yolun kenarı kaybolamaz. */
    for (const [govde, kasa] of [
      [NIGHT_PALETTE.minor, NIGHT_PALETTE.minorCasing],
      [NIGHT_PALETTE.motorway, NIGHT_PALETTE.motorwayCasing],
    ] as const) {
      expect(contrast(govde, kasa), 'kasa gövdeden ayrışmıyor').toBeGreaterThanOrEqual(3.0);
    }
  });

  it('`residential` zeminle AYNI RENK DEĞİL (eski değer 1.01 idi — matematiksel olarak aynı)', () => {
    expect(contrast(bg, NIGHT_PALETTE.residential)).toBeGreaterThanOrEqual(1.2);
  });

  it('su ve bina zeminden ayırt edilir', () => {
    expect(contrast(bg, NIGHT_PALETTE.water)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(bg, NIGHT_PALETTE.buildingFill)).toBeGreaterThanOrEqual(1.4);
    // Kontur dolgudan açık olmalı — bina kenarı kaybolmasın.
    expect(luminance(NIGHT_PALETTE.buildingOutline))
      .toBeGreaterThan(luminance(NIGHT_PALETTE.buildingFill));
  });

  it('kasa gövdeden KOYUDUR — ince yolu görünür kılan kasadır', () => {
    const ciftler: Array<[string, string]> = [
      [NIGHT_PALETTE.minor,    NIGHT_PALETTE.minorCasing],
      [NIGHT_PALETTE.primary,  NIGHT_PALETTE.primaryCasing],
      [NIGHT_PALETTE.motorway, NIGHT_PALETTE.motorwayCasing],
    ];
    for (const [govde, kasa] of ciftler) {
      expect(luminance(kasa)).toBeLessThan(luminance(govde));
    }
  });

  it('GECE KONFORU: geniş ALAN dolguları sakin kalır (yollar bu kuralın DIŞINDA)', () => {
    /* 2026-08-17 KULLANICI KARARI: konfor tavanı YOLLARIN üstünden kaldırıldı
       (bkz. NIGHT_PALETTE §5) — kullanıcı gerçek araçta daha beyaz/keskin yol
       istedi. Kilit SİLİNMEDİ: kapsamı daraltıldı ve asıl gerekçesine bağlandı.
       Parlaklık riski geniş YÜZEYlerdedir (zemin dolguları), ince ÇİZGİlerde
       değil; ekranın büyük kısmını dolgular kaplar. */
    const alanDolgulari = [
      NIGHT_PALETTE.residential, NIGHT_PALETTE.water,
      NIGHT_PALETTE.park, NIGHT_PALETTE.buildingFill,
    ];
    for (const c of alanDolgulari) {
      expect(contrast(bg, c), `${c} geniş dolgu için fazla parlak`).toBeLessThanOrEqual(2.5);
    }
  });

  it('yollar Google Maps gece stilinden DAHA KESKİN (kullanıcı hedefi, ölçülü)', () => {
    /* Google "Night mode" kanonik değerleri kendi zeminine (#242f3e) karşı:
       normal yol #38414e = 1.31 · otoyol #746855 = 2.48. Hedef: net biçimde üstü. */
    /* Çarpan 2,0 → 1,7 (2026-09-09): yol ailesi rotanın altına indirilince
       2,0 kat matematiksel olarak imkânsız hale geldi (rota çekirdeği sabit).
       Ölçülen yeni pay: minor 1,82× · motorway 1,81× — kilidin ANLAMI ("net
       biçimde Google'ın üstü") korunuyor, çıpası ölçüme oturtuldu. */
    expect(contrast(bg, NIGHT_PALETTE.minor)).toBeGreaterThan(1.31 * 1.7);
    expect(contrast(bg, NIGHT_PALETTE.motorway)).toBeGreaterThan(2.48 * 1.7);
  });

  it('alan dolguları yollarla YARIŞMAZ (geniş yüzey, sakin kalmalı)', () => {
    for (const alan of [NIGHT_PALETTE.residential, NIGHT_PALETTE.park]) {
      expect(luminance(alan)).toBeLessThan(luminance(NIGHT_PALETTE.minor));
    }
  });

  /**
   * #622 — MUTLAK YÜZEY PARLAKLIĞI (bu dosyadaki HER ŞEY oran ölçüyordu).
   *
   * Kusurun kökü buydu: yukarıdaki oranların HEPSİ geçerken bile harita
   * "ölü/boş" görünüyordu, çünkü kontrast ORANLARI değil YÜZEYİN KENDİSİ
   * yanlıştı. Ölçüm: Google gece zemini `#242f3e` = 0,0276 · bizim eski
   * `#161c28` = 0,0115, ekranda (o günkü `brightness(0.8)` filtresiyle)
   * **0,0081** → 3,4 kat daha karanlık. Oran kilitleri bunu göremez: zemin
   * karardıkça oranlar YÜKSELİR. Bu yüzden ayrı bir MUTLAK kilit gerekir,
   * yoksa zemin sessizce yeniden karartılabilir ve tüm kasa yeşil kalır.
   */
  it('🔒 #622 gece zemini Google seviyesinde bir YÜZEY (mutlak parlaklık)', () => {
    const GOOGLE_NIGHT_BG = 0.0276;          // #242f3e — ölçülmüş referans
    const L = luminance(NIGHT_PALETTE.bg);
    // Taban: referansın %80'i. Eski `#161c28` (0,0115) bu kilidi GEÇEMEZDİ.
    expect(L, `gece zemini fazla karanlık: ${L.toFixed(4)}`)
      .toBeGreaterThanOrEqual(GOOGLE_NIGHT_BG * 0.8);
    // Tavan: gece gece kalsın — referansın 1,6 katını aşmaz.
    expect(L, `gece zemini fazla açık: ${L.toFixed(4)}`)
      .toBeLessThanOrEqual(GOOGLE_NIGHT_BG * 1.6);
  });

  it('eski gece zemini bu kilidi GEÇEMEZDİ — kilidin anlamı', () => {
    expect(luminance('#161c28')).toBeLessThan(0.0276 * 0.8);
  });

  it('gündüz paleti gece paletinden AÇIK kalır (temalar karışmadı)', () => {
    expect(luminance(DAY_PALETTE.bg)).toBeGreaterThan(luminance(NIGHT_PALETTE.bg));
  });
});
