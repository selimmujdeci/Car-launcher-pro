/**
 * routeColorPolicy.test.ts — rota rengi TEK hakemden gelir (PR-3a).
 *
 * ── KİLİTLENEN KUSUR (K1) ───────────────────────────────────────────────────
 * `ROUTE_CASE.line-color` ve `ROUTE_GLOW_SEL.line-color` özelliklerini İKİ ayrı
 * blok yazıyordu ve her biri KENDİ önbelleğine bakıyordu (`M.lastManeuverTier`
 * / `M.lastExternalRiskAlert`). Hakem yoktu ve manevra bloğu ÖNCE koşuyordu:
 *
 *   risk 0,6 → AMBER · kademe 0→1 → AMBER · kademe 1→0 → **BEYAZ**
 *   risk hâlâ 0,6 ama bayrak değişmediği için risk bloğu HİÇ çalışmaz
 *
 * → Tehlike aktifken uyarı rengi KALICI olarak kayboluyordu.
 *
 * İKİNCİ YOL: yeniden çizim `lastManeuverTier`ı sıfırlıyor ama
 * `lastExternalRiskAlert`i sıfırlamıyordu → risk yüksekken yeni rota çizilirse
 * amber siliniyor ve bir daha uygulanmıyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · Renk DURUM DEĞİŞİMİNDEN değil ANLIK DURUMDAN türer.
 *  · Öncelik: TEHLİKE > MANEVRA > NORMAL.
 *  · Dedup TEK anahtarladır → bir katman güncellenip diğeri eskide kalamaz.
 *  · Renk kararı tek yerdedir; hangi rengin ne zaman kazandığını orası söyler.
 *
 * ── PR-3b EKİ: ZEMİN KUTBU ──────────────────────────────────────────────────
 * PR-3a'daki `dayMode` sözleşmesi FAZLA GENİŞTİ ve daraltıldı → `lightBasemap`.
 * KÖK: `MapMode` (`road|hybrid|satellite`) ile `getMapNight()` bağımsızdır;
 * "gündüz + uydu" gerçek bir kombinasyondur ve uydu ORTA-KOYU bir yüzeydir.
 * Doğru ölçüt zamanın değil ZEMİNİN parlaklığıdır:
 *     lightBasemap = !night && mode === 'road'
 * Açık zeminde kılıf `#0A0C10` olur (ürünün kendi `--oem-ink` gündüz mürekkebi);
 * koyu zeminde PR-3a davranışı BİREBİR korunur. Çekirdek gradient'i, halo mavisi
 * ve amber DEĞİŞMEDİ.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRouteColor,
  relativeLuminance,
  contrastRatio,
  ROUTE_CASING_NORMAL,
  ROUTE_CASING_LIGHT_BASEMAP,
  ROUTE_GLOW_NORMAL,
  ROUTE_ATTENTION_AMBER,
} from '../platform/map/core/routeColorModel';
/* Ağır modüller TEPEDE, statik olarak alınır. Testler bunları `await import`
   ile çekiyordu; yüklü makinede tek bir dinamik import 5 sn'lik varsayılan
   test timeout'unu aşıp yanlış "başarısız" üretiyordu (maplibre-gl graf'ı).
   Statik import maliyeti dosya başına BİR kez ödenir. */
import {
  syncRouteColor, resolveLightBasemap, resetRouteColorState,
  _resetRouteColorForTest,
} from '../platform/map/MapLayerManager';
import { setDrivingView } from '../platform/map/MapInteractionManager';
import { resetCameraSmooth } from '../platform/cameraEngine';
import {
  setMapNight, getMapNight, getMapMode, useMapSourceStore,
} from '../platform/mapSourceManager';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const layerSrc = read('src/platform/map/MapLayerManager.ts');
const interSrc = read('src/platform/map/MapInteractionManager.ts');
const stateSrc = read('src/platform/map/_mapState.ts');

/** Varsayilan KOYU zemin — PR-3a davranisinin birebir korundugu kutup. */
const at = (maneuverTier: number, hazardHigh: boolean, lightBasemap = false) =>
  resolveRouteColor({ maneuverTier, hazardHigh, lightBasemap });

describe('Öncelik matrisi — TEHLİKE > MANEVRA > NORMAL', () => {
  it('NORMAL: kademe 0, tehlike yok', () => {
    const d = at(0, false);
    expect(d.casing).toBe(ROUTE_CASING_NORMAL);
    expect(d.glow).toBe(ROUTE_GLOW_NORMAL);
    expect(d.coreMode).toBe('NORMAL');
    expect(d.reason).toBe('NORMAL');
  });

  it('MANEVRA YAKLAŞMA (kademe 1): YALNIZ kılıf amber, halo NORMAL kalır', () => {
    // Eski kod bu dalda glow'a HİÇ dokunmuyordu — davranış birebir korunmalı.
    const d = at(1, false);
    expect(d.casing).toBe(ROUTE_ATTENTION_AMBER);
    expect(d.glow, 'kademe 1\'de halo da amber olmuş — bu bir TASARIM değişikliği olurdu')
      .toBe(ROUTE_GLOW_NORMAL);
    expect(d.reason).toBe('MANEUVER_APPROACH');
  });

  it('MANEVRA KRİTİK (kademe 2): kılıf + halo amber', () => {
    const d = at(2, false);
    expect(d.casing).toBe(ROUTE_ATTENTION_AMBER);
    expect(d.glow).toBe(ROUTE_ATTENTION_AMBER);
    expect(d.coreMode).toBe('EMPHASIS');
    expect(d.reason).toBe('MANEUVER_CRITICAL');
  });

  it('TEHLİKE her kademede KAZANIR', () => {
    for (const tier of [0, 1, 2]) {
      const d = at(tier, true);
      expect(d.reason, `kademe ${tier}: tehlike kaybetmiş`).toBe('HAZARD');
      expect(d.casing).toBe(ROUTE_ATTENTION_AMBER);
      expect(d.glow, `kademe ${tier}: tehlikede halo amber değil`).toBe(ROUTE_ATTENTION_AMBER);
    }
  });

  it('KOYU ZEMIN: PR-3a davranisi BIREBIR korunur', () => {
    // Gece · uydu · hibrit — ucu de koyu zemindir ve kilif BEYAZ kalmali.
    expect(at(0, false, false).casing).toBe(ROUTE_CASING_NORMAL);
    expect(at(1, false, false).casing).toBe(ROUTE_ATTENTION_AMBER);
    expect(at(2, false, false).casing).toBe(ROUTE_ATTENTION_AMBER);
    expect(at(0, true, false).casing).toBe(ROUTE_ATTENTION_AMBER);
  });

  it('ACIK ZEMIN: kilif HER durumda koyu murekkep (#0A0C10)', () => {
    /* Kilifin isi rotayi zeminden AYIRMAKTIR. Acik zeminde amber 1,08-2,15:1,
       yani kilif olarak zaten gorunmuyordu — kaybedilen sinyal yok. */
    for (const [tier, hz] of [[0, false], [1, false], [2, false], [0, true], [2, true]] as const) {
      expect(at(tier, hz, true).casing, `kademe ${tier}/tehlike ${hz}: acik zeminde kilif koyu degil`)
        .toBe(ROUTE_CASING_LIGHT_BASEMAP);
    }
    expect(ROUTE_CASING_LIGHT_BASEMAP, 'urun tokeni disinda bir renk icat edilmis').toBe('#0A0C10');
  });

  it('ACIK ZEMIN: sinyal KAYBOLMAZ, katman degistirir (halo amber kalir)', () => {
    expect(at(2, false, true).glow, 'kritik manevrada halo amber degil').toBe(ROUTE_ATTENTION_AMBER);
    expect(at(0, true, true).glow, 'tehlikede halo amber degil').toBe(ROUTE_ATTENTION_AMBER);
    expect(at(0, false, true).glow, 'normalde halo kimligi degismis').toBe(ROUTE_GLOW_NORMAL);
  });

  it('ACIK ZEMIN: cekirdek ve halo hue degismez (kimlik korunur)', () => {
    for (const [tier, hz] of [[0, false], [1, false], [2, false], [0, true]] as const) {
      const dark = at(tier, hz, false);
      const light = at(tier, hz, true);
      expect(light.glow, `kademe ${tier}: acik zeminde halo hue degismis`).toBe(dark.glow);
      expect(light.coreMode).toBe(dark.coreMode);
      expect(light.coreOpacity).toBe(dark.coreOpacity);
      expect(light.reason).toBe(dark.reason);
    }
  });

  it('ANAHTAR zemin KUTBUNU tasir (tema degil)', () => {
    // Tema ayni kalip mod road->satellite degisirse dedup bunu GORMELIDIR.
    expect(at(0, false, true).routeColorKey).not.toBe(at(0, false, false).routeColorKey);
    expect(at(0, false, true).routeColorKey).toContain('|light|');
    expect(at(0, false, false).routeColorKey).toContain('|dark|');
  });

  it('FAIL-SOFT: ÖLÇÜLEMEYEN kademe NORMAL sayılır, dikkat rengi UYDURULMAZ', () => {
    /* Ayrım bilinçli: `NaN` ve `Infinity` bir ÖLÇÜM DEĞİLDİR → dikkat rengi
       uydurulmaz, NORMAL'e düşülür. Sonlu ama bant dışı bir sayı (−3 / 99)
       gerçek bir kademe niyetidir → banda KIRPILIR. */
    for (const notMeasured of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(at(notMeasured, false).reason, `${notMeasured}: ölçülemeyen kademede renk uydurulmuş`)
        .toBe('NORMAL');
    }
    expect(at(-3, false).reason, 'negatif kademe tabana kırpılmalı').toBe('NORMAL');
    expect(at(99, false).reason, 'büyük kademe tavana kırpılmalı').toBe('MANEUVER_CRITICAL');
    expect(at(1.7, false).reason, 'ondalık kademe aşağı yuvarlanmalı').toBe('MANEUVER_APPROACH');
  });
});

describe('K1 REGRESYONU — birebir saha dizisi', () => {
  it('risk yüksek → kademe 1 → kademe 0 → renk HÂLÂ tehlike rengi', () => {
    const s1 = at(0, true);   // 1. tehlike doğdu
    const s2 = at(1, true);   // 2. dönüşe yaklaşma
    const s3 = at(0, true);   // 3. dönüş geçildi — ESKİDEN BURADA BEYAZA DÖNÜYORDU

    expect(s1.casing).toBe(ROUTE_ATTENTION_AMBER);
    expect(s2.casing).toBe(ROUTE_ATTENTION_AMBER);
    expect(s3.casing, 'K1 GERİ GELDİ: dönüş geçilince tehlike rengi silindi')
      .toBe(ROUTE_ATTENTION_AMBER);
    expect(s3.glow, 'K1 GERİ GELDİ: tehlike halosu silindi')
      .toBe(ROUTE_ATTENTION_AMBER);
    expect(s3.reason).toBe('HAZARD');
  });

  it('anahtar tehlike boyunca DEĞİŞMEZ → gereksiz boya yazımı da olmaz', () => {
    expect(at(0, true).routeColorKey).toBe(at(1, true).routeColorKey);
    expect(at(1, true).routeColorKey).toBe(at(2, true).routeColorKey);
  });

  it('tehlike bitince kademeye göre DOĞRU renge döner', () => {
    expect(at(0, false).reason).toBe('NORMAL');
    expect(at(2, false).reason).toBe('MANEUVER_CRITICAL');
    // Eski kodda tehlike düşerken kademe 0 değilse beyaz yazılmıyordu; yeni
    // modelde bu ayrım gerekmez çünkü karar anlık durumdan türer.
  });

  it('KUSUR KANITI: eski iki-bayraklı mantık aynı dizide sinyali kaybederdi', () => {
    // Eski algoritmanın bağımsız kopyası (oracle).
    let lastTier = -1, lastRisk = false;
    let casing = '#ffffff';
    const oldStep = (tier: number, risk: boolean) => {
      if (tier !== lastTier) {          // manevra bloğu ÖNCE
        lastTier = tier;
        if (tier === 0) casing = '#ffffff';
        else casing = '#f59e0b';
      }
      if (risk !== lastRisk) {          // risk bloğu SONRA, yalnız DEĞİŞİMDE
        lastRisk = risk;
        if (risk) casing = '#f59e0b';
        else if (tier === 0) casing = '#ffffff';
      }
    };
    oldStep(0, true);
    oldStep(1, true);
    oldStep(0, true);
    expect(casing, 'kusur zaten yokmuş gibi görünüyor — kilit anlamsız').toBe('#ffffff');
  });
});

describe('YAPISAL kilitler — ikinci renk sahibi doğmaz', () => {
  it('🔒 rota line-color YALNIZ tek yazıcıdan geçer', () => {
    // MapInteractionManager artık HİÇ line-color yazmamalı.
    expect(/safeSetPaint\([^)]*ROUTE_CASE[^)]*'line-color'/.test(interSrc),
      'MapInteractionManager yine kılıf rengi yazıyor — ikinci sahip doğdu').toBe(false);
    expect(/safeSetPaint\([^)]*ROUTE_GLOW_SEL[^)]*'line-color'/.test(interSrc),
      'MapInteractionManager yine halo rengi yazıyor — ikinci sahip doğdu').toBe(false);
    // MapLayerManager'da tek yazıcı fonksiyon var.
    expect(layerSrc).toContain('function _applyRouteColorDecision');
    expect(layerSrc).toContain('export function syncRouteColor');
  });

  it('🔒 eski iki bayrak KALDIRILDI (ayrı sahiplik geri gelemez)', () => {
    expect(stateSrc, 'lastManeuverTier geri gelmiş — renk ikinci sahibe döner')
      .not.toMatch(/^\s*lastManeuverTier\s*:/m);
    expect(stateSrc, 'lastExternalRiskAlert geri gelmiş — K1 geri döner')
      .not.toMatch(/^\s*lastExternalRiskAlert\s*:/m);
  });

  it('🔒 sabit renk kodları karar noktası DIŞINDA kullanılmaz', () => {
    for (const [src, name] of [[interSrc, 'MapInteractionManager'], [layerSrc, 'MapLayerManager']] as const) {
      const inColorWrite = src.match(/'line-color',\s*'#[0-9a-fA-F]{6}'/g) ?? [];
      expect(inColorWrite, `${name}: karar dışı sabit renk yazımı: ${inColorWrite.join(' | ')}`)
        .toEqual([]);
    }
  });

  it('🔒 kurulum ve yeniden-çizim AYNI karardan beslenir', () => {
    expect(layerSrc).toContain("'line-color':  _rc.glow");
    expect(layerSrc).toContain("'line-color':  _rc.casing");
    expect(layerSrc, 'yeniden çizimde karar KAYDEDİLMİYOR — sonraki sync dedup\'ta atlar')
      .toContain('syncRouteColor(map, 0, _hazardHighNow, true)');
  });

  it('🔒 rota silinince renk kararı UNUTULUR (bayat anahtar kalmaz)', () => {
    expect(layerSrc).toContain('resetRouteColorState()');
  });

  it('🔒 safeSetPaint güvenlik sözleşmesi korunur', () => {
    for (const src of [layerSrc, interSrc]) {
      expect(/map\.setPaintProperty\(\s*ROUTE_GLOW_SEL/.test(src)).toBe(false);
      expect(/map\.setPaintProperty\(\s*ROUTE_SHADOW/.test(src)).toBe(false);
      expect(/map\.setPaintProperty\(\s*ROUTE_CASE/.test(src)).toBe(false);
    }
  });

  it('🔒 saf model I/O taşımaz, timer/listener kurmaz', () => {
    const model = read('src/platform/map/core/routeColorModel.ts');
    expect(model).not.toMatch(/addEventListener|ResizeObserver|setInterval|setTimeout|requestAnimationFrame/);
    /* Daha GÜÇLÜ invaryant: saf model HİÇBİR ŞEY import etmez.
       Önceki hâli `getMapNight` adını METİNDE arıyordu ve `lightBasemap`
       gerekçesini anlatan KENDİ YORUMUMUZDA geçtiği için yanlış alarm verdi —
       kilit, ismin geçmesini değil BAĞIMLILIĞI denetlemeli. */
    expect(model, 'saf model dışarıya bağımlı hâle gelmiş').not.toMatch(/^\s*import\s/m);
  });
});

describe('ENTEGRASYON — gerçek yazım zinciri (mock harita)', () => {
  /** Boya yazımlarını kaydeden asgari MapLibre taklidi. */
  function mockMap() {
    const paints: Array<{ layer: string; prop: string; value: unknown }> = [];
    const map = {
      getLayer: (id: string) => ({ id }),
      setPaintProperty: (layer: string, prop: string, value: unknown) => {
        paints.push({ layer, prop, value });
      },
      isStyleLoaded: () => true,
      getCanvas: () => ({ clientWidth: 1024, clientHeight: 600 }),
      getZoom: () => 16,
      getPitch: () => 30,
      getBearing: () => 0,
      jumpTo: () => {},
      easeTo: () => {},
      project: () => ({ x: 512, y: 300 }),
    } as unknown as import('maplibre-gl').Map;
    /** Bir katmanın EN SON yazılan rengi. */
    const lastColor = (layer: string) =>
      [...paints].reverse().find((p) => p.layer === layer && p.prop === 'line-color')?.value ?? null;
    return { map, paints, lastColor };
  }

  /**
   * Zemin kutbunu AÇIKÇA sürer.
   *
   * NEDEN GEREKLİ: bu blok saf modeli değil `syncRouteColor`ı çağırır; o da
   * ÜRÜNÜN kendi `resolveLightBasemap()`ini okur. Kutup sürülmezse test,
   * ortamın varsayılanına (`getMapNight()=false` + `getMapMode()='road'`
   * → **AÇIK zemin**) sessizce bağlanır ve neyi ölçtüğü belirsizleşir.
   * PR-3a döneminde kılıf her zaman `#ffffff` olduğu için bu bağımlılık
   * görünmüyordu; PR-3b kılıfı zemin kutbuna bağlayınca ortaya çıktı.
   */
  function withPole<T>(night: boolean, mode: 'road' | 'satellite', fn: () => T): T {
    const prevNight = getMapNight();
    const prevMode = getMapMode();
    try {
      setMapNight(night);
      useMapSourceStore.setState({ mapMode: mode });
      return fn();
    } finally {
      setMapNight(prevNight);
      useMapSourceStore.setState({ mapMode: prevMode });
    }
  }

  /**
   * İki kutup, beklenen kılıf renkleriyle. Aşağıdaki üç kilit HER İKİSİNDE de
   * koşar → "tehlike sinyali kaybolmaz" invaryantı artık tek kutupta değil,
   * zemin kutbundan BAĞIMSIZ olarak kanıtlanır (eski hâlinden daha güçlü).
   *
   * Açık zeminde kılıf HER durumda `#0A0C10`tır (bkz. "ACIK ZEMIN: kilif HER
   * durumda koyu murekkep" kilidi) → orada tehlikeyi kılıf DEĞİL **halo**
   * taşır. Bu yüzden her kilit kılıfın yanında haloyu da denetler.
   */
  const POLES = [
    {
      name: 'AÇIK zemin (gündüz + road)', night: false, mode: 'road' as const,
      casingNormal: ROUTE_CASING_LIGHT_BASEMAP, casingHazard: ROUTE_CASING_LIGHT_BASEMAP,
    },
    {
      name: 'KOYU zemin (gece + road)', night: true, mode: 'road' as const,
      casingNormal: ROUTE_CASING_NORMAL, casingHazard: ROUTE_ATTENTION_AMBER,
    },
  ] as const;

  for (const p of POLES) {
    it(`TEHLİKE yüksekken kademe 1→0 geçişinde SİNYAL KORUNUR (K1, uçtan uca) — ${p.name}`, () => {
      _resetRouteColorForTest();
      const { map, lastColor } = mockMap();

      withPole(p.night, p.mode, () => {
        syncRouteColor(map, 0, true);   // tehlike doğdu
        syncRouteColor(map, 1, true);   // dönüşe yaklaşma
        syncRouteColor(map, 0, true);   // dönüş geçildi ← ESKİDEN BEYAZA DÖNÜYORDU
      });

      expect(lastColor('car-route-casing'), 'K1 GERİ GELDİ: kılıf zemin kutbunun rengini bıraktı')
        .toBe(p.casingHazard);
      /* SİNYALİN KENDİSİ: halo HER İKİ kutupta da amber KALMALI. Açık zeminde
         kılıf koyu mürekkeptir, dolayısıyla K1'in ("uyarı kalıcı olarak
         kayboluyordu") tek kanıtı budur. */
      expect(lastColor('car-route-glow-sel'), 'K1 GERİ GELDİ: tehlike halosu maviye döndü')
        .toBe(ROUTE_ATTENTION_AMBER);
    });
  }

  it('DEDUP: anahtar değişmezse ikinci kez boya YAZILMAZ', async () => {
    _resetRouteColorForTest();
    const { map, paints } = mockMap();

    syncRouteColor(map, 0, true);
    const afterFirst = paints.length;
    syncRouteColor(map, 1, true);   // aynı karar (TEHLİKE) → yazım olmamalı
    syncRouteColor(map, 2, true);
    expect(paints.length, 'aynı kararda gereksiz boya yazımı var').toBe(afterFirst);
  });

  /* ── KİLİT GÜNCELLENDİ (#633) ─────────────────────────────────────────────
   * Eski sözleşme "üç katmana da yazılır" diyordu ve `line-color`ı katman
   * BAŞINA tek sayıyordu. Sahada ölçülen kusur tam bu boşluktaydı: çekirdeğe
   * yazılan tek şey `line-gradient` olduğunda ve kaynak `lineMetrics`
   * taşımadığında yazım ÖLÜ kalıyor, çekirdek kurulum renginde donuyordu
   * (gece'de gündüz mavisi `#1A73E8`, WCAG parlaklık 0,183). Yeni sözleşme:
   * çekirdeğin DÜZ RENGİ her koşulda yazılır; gradient yalnız EK'tir. */
  it('RENK ÜÇÜ BİRLİKTE yazılır — ve çekirdeğin DÜZ rengi her koşulda', async () => {
    _resetRouteColorForTest();
    const { map, paints } = mockMap();

    syncRouteColor(map, 0, false);
    const written = paints.filter((p) => p.prop === 'line-color' || p.prop === 'line-opacity');
    /* Üç katmanın hepsi güncellenir (çekirdek hem opaklık hem düz renk alır). */
    expect([...new Set(written.map((p) => p.layer))].sort())
      .toEqual(['car-route-casing', 'car-route-glow-sel', 'selected-route-layer']);
    /* Ve çekirdeğin DÜZ RENGİ gerçekten yazılmış olmalı — gradient'e
       güvenilmez: kaynak `lineMetrics` taşımıyorsa o yazım sessizce ölür. */
    expect(
      written.some((p) => p.layer === 'selected-route-layer' && p.prop === 'line-color'),
      'çekirdeğin düz rengi yazılmadı — "kararın yarısı uygulandı" kusuru geri geldi',
    ).toBe(true);
  });

  for (const p of POLES) {
    it(`YENİDEN ÇİZİM: rota silinip yeniden çizilse de tehlike SİNYALİ KAYBOLMAZ — ${p.name}`, () => {
      _resetRouteColorForTest();
      const { map, lastColor } = mockMap();

      withPole(p.night, p.mode, () => {
        syncRouteColor(map, 0, true);              // tehlike aktif
        resetRouteColorState();                    // rota silindi (clearRouteGeometry)
        syncRouteColor(map, 0, true, true);        // yeni rota kuruldu — tehlike HÂLÂ aktif
      });

      expect(lastColor('car-route-casing'), 'yeniden çizimde kılıf zemin kutbunun rengini bıraktı')
        .toBe(p.casingHazard);
      expect(lastColor('car-route-glow-sel'), 'yeniden çizimde tehlike halosu silindi')
        .toBe(ROUTE_ATTENTION_AMBER);
    });
  }

  for (const p of POLES) {
    it(`BAYAT ANAHTAR TUZAĞI: sıfırlama olmadan yeni rota yanlış renkte kalmaz — ${p.name}`, () => {
      _resetRouteColorForTest();
      const { map, lastColor } = mockMap();

      withPole(p.night, p.mode, () => {
        syncRouteColor(map, 0, true);              // tehlike sinyali
        // Kurulum yolu `force: true` kullanır → dedup atlanır, boya kesin yazılır.
        syncRouteColor(map, 0, false, true);       // tehlike bitti + yeniden kurulum
      });

      expect(lastColor('car-route-casing'), 'force kurulumda kılıf yanlış kutupta')
        .toBe(p.casingNormal);
      /* Açık zeminde kılıf tehlikeli/normal AYRIMI TAŞIMAZ (her ikisi de
         `#0A0C10`) → "boya gerçekten yazıldı mı, bayat anahtar kaldı mı"
         sorusunu orada YALNIZ halo yanıtlar. Bu satır olmadan kilit açık
         kutupta gücünü kaybederdi. */
      expect(lastColor('car-route-glow-sel'), 'force kurulumda boya atlandı — bayat anahtar kaldı')
        .toBe(ROUTE_GLOW_NORMAL);
    });
  }

  it('setDrivingView renk yazımını TEK noktadan yapar (iki blok birleşti)', async () => {
    _resetRouteColorForTest();
    resetCameraSmooth();
    const { map, paints } = mockMap();

    // 40 km/h, kavşak 300 m (kademe 0) — jitter filtresine takılmaz.
    setDrivingView(map, 36.9146, 34.8973, 45, 40, 600, 300);
    const colorWrites = paints.filter((p) => p.prop === 'line-color');
    // Kılıf + halo tam BİRER kez; ikinci bir karar bloğu olsaydı tekrar yazılırdı.
    expect(colorWrites.filter((p) => p.layer === 'car-route-casing').length,
      'kılıf rengi birden fazla kez yazıldı — ikinci sahip var').toBe(1);
    expect(colorWrites.filter((p) => p.layer === 'car-route-glow-sel').length,
      'halo rengi birden fazla kez yazıldı — ikinci sahip var').toBe(1);
  });
});

describe('ZEMİN KUTBU TÜRETMESİ — "gündüz mü" DEĞİL, "zemin açık mı" (PR-3b)', () => {
  /**
   * `resolveLightBasemap` iki modül-durumunu okur (`getMapNight` · `getMapMode`);
   * ikisi de `mapSourceManager`'ın gerçek setter'larıyla sürülür → ikinci bir
   * sahte otorite kurulmaz, ÜRÜNÜN kendi durumu sınanır.
   */
  const MATRIX: ReadonlyArray<readonly [boolean, 'road' | 'hybrid' | 'satellite', boolean]> = [
    [false, 'road',      true ],   // gündüz + road      → AÇIK
    [false, 'hybrid',    false],   // gündüz + hibrit    → koyu
    [false, 'satellite', false],   // gündüz + uydu      → koyu
    [true,  'road',      false],   // gece   + road      → koyu
    [true,  'hybrid',    false],   // gece   + hibrit    → koyu
    [true,  'satellite', false],   // gece   + uydu      → koyu
  ];

  /**
   * Durum DOĞRUDAN sürülür (`useMapSourceStore.setState`), `setMapMode` ile
   * DEĞİL: o setter çevrimdışıyken uydu/hibrit'i bilerek `road`a düşürür
   * (kendi politikası, doğru davranış). Burada sınanan şey o politika değil,
   * `resolveLightBasemap`in VERİLEN durumu doğru yorumlaması.
   */
  async function withBasemap<T>(
    night: boolean, mode: 'road' | 'hybrid' | 'satellite', fn: () => T,
  ): Promise<T> {
    const prevNight = getMapNight();
    const prevMode = getMapMode();
    try {
      setMapNight(night);
      useMapSourceStore.setState({ mapMode: mode });
      return fn();
    } finally {
      setMapNight(prevNight);
      useMapSourceStore.setState({ mapMode: prevMode });
    }
  }

  it('altı kombinasyonun tamamı doğru kutba düşer', async () => {
    for (const [night, mode, expected] of MATRIX) {
      const got = await withBasemap(night, mode, () => resolveLightBasemap());
      expect(got, `${night ? 'gece' : 'gündüz'} + ${mode}`).toBe(expected);
    }
  });

  it('GÜNDÜZ + UYDU: koyu kılıf UYGULANMAZ (rota görüntüde kaybolmaz)', async () => {
    const light = await withBasemap(false, 'satellite', () => resolveLightBasemap());
    expect(light, 'uydu görüntüsü açık zemin sayılmış').toBe(false);
    expect(at(0, false, light).casing, 'uyduda koyu kılıf uygulanmış — rota kaybolur')
      .toBe(ROUTE_CASING_NORMAL);
  });

  it('GÜNDÜZ + ROAD: koyu kılıf UYGULANIR', async () => {
    const light = await withBasemap(false, 'road', () => resolveLightBasemap());
    expect(light).toBe(true);
    expect(at(0, false, light).casing).toBe(ROUTE_CASING_LIGHT_BASEMAP);
  });

  it('🔒 türetme TEK yerdedir ve `mode === road` kapısını taşır', () => {
    expect(layerSrc).toContain('export function resolveLightBasemap');
    expect(layerSrc).toMatch(/!getMapNight\(\)\s*&&\s*getMapMode\(\)\s*===\s*'road'/);
    /* Modelin tema/mod okumadığı ayrıca kilitli: "saf model HİÇBİR ŞEY import
       etmez" testi bunu bağımlılık düzeyinde kanıtlar. Burada METİN araması
       YAPILMAZ — gerekçe yorumlarında bu adların geçmesi normaldir. */
  });

  it('🔒 saf model artık `dayMode` DEĞİL `lightBasemap` alır', () => {
    const model = read('src/platform/map/core/routeColorModel.ts');
    expect(model).toContain('readonly lightBasemap: boolean;');
    expect(model, 'geniş `dayMode` sözleşmesi geri gelmiş').not.toMatch(/readonly dayMode/);
  });
});

describe('Kontrast yardımcısı — YALNIZ ÖLÇER (PR-3b kabul ölçütü)', () => {
  it('bilinen değerleri doğru hesaplar', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
  });

  it('geçersiz girdide UYDURMAZ', () => {
    expect(relativeLuminance('mavi')).toBeNull();
    expect(contrastRatio('#fff', '#000000')).toBeNull();
  });

  /* ── PR-3b KABUL ÖLÇÜTLERİ ────────────────────────────────────────────────
   * Raporlanan sayılar burada TEST eşiği olur. Yeni renk icat ederek eşiği
   * geçmek YASAK: aşağıdaki her renk üründe zaten var olan bir token'dır. */
  const OSM_DAY = {
    'konut/tersiyer': '#ffffff', 'birincil': '#fcd6a4', 'ikincil': '#f7fabf',
    'otoyol': '#e892a2', 'zemin': '#f2efe9',
  } as const;

  it('KABUL: açık zemin kılıfı TÜM gündüz zeminlerinde ≥ 3:1 (otoyol dahil)', () => {
    for (const [name, bg] of Object.entries(OSM_DAY)) {
      const r = contrastRatio(ROUTE_CASING_LIGHT_BASEMAP, bg);
      expect(r, `${name} zemininde kılıf ölçülemedi`).not.toBeNull();
      expect(r as number, `${name}: kılıf eşiğin altında`).toBeGreaterThanOrEqual(3);
    }
    // Otoyol en kötü durumdur — ayrıca ve açıkça kilitlenir.
    expect(contrastRatio(ROUTE_CASING_LIGHT_BASEMAP, '#e892a2') as number)
      .toBeGreaterThanOrEqual(3);
  });

  it('KABUL: çekirdeğin koyu kılıfla İÇ KENAR kontrastı ≥ 3:1 (üç durak)', () => {
    for (const core of ['#1A73E8', '#4F46E5', '#10b981']) {
      const r = contrastRatio(core, ROUTE_CASING_LIGHT_BASEMAP) as number;
      expect(r, `${core}: çekirdek koyu kılıftan ayrışmıyor`).toBeGreaterThanOrEqual(3);
    }
  });

  it('KABUL: amber sinyalin koyu kılıfla İÇ KENAR kontrastı ≥ 3:1', () => {
    expect(contrastRatio(ROUTE_ATTENTION_AMBER, ROUTE_CASING_LIGHT_BASEMAP) as number)
      .toBeGreaterThanOrEqual(3);
  });

  it('KOYU ZEMİN korunuyor: beyaz kılıf gece yolunda ≥ 3:1', () => {
    // Gece paleti DEĞİŞMEDİ — bu kilit onun kanıtıdır.
    expect(contrastRatio(ROUTE_CASING_NORMAL, '#404040') as number).toBeGreaterThanOrEqual(3);
    // Ve koyu kılıf gecede KULLANILAMAZ — kutup ayrımının gerekçesi.
    expect(contrastRatio(ROUTE_CASING_LIGHT_BASEMAP, '#404040') as number).toBeLessThan(3);
  });

  it('REDDEDİLEN ADAY kayıt altında: çekirdeği koyulaştırmak İÇ KENARI bozar', () => {
    /* `#1A56C4` zeminle kontrastı artırır ama koyu kılıfla iç kenarı eşiğin
       ALTINA düşürür → rota tek koyu bloğa dönüşür. Bu kilit, ileride birinin
       "kontrast için çekirdeği koyulaştıralım" demesini ölçüyle karşılar. */
    expect(contrastRatio('#1A56C4', ROUTE_CASING_LIGHT_BASEMAP) as number).toBeLessThan(3);
    expect(contrastRatio('#1A73E8', ROUTE_CASING_LIGHT_BASEMAP) as number).toBeGreaterThanOrEqual(3);
  });

  it('K2 ÖLÇÜMÜ: beyaz kılıf açık gündüz zemininde eşiğin ALTINDA', () => {
    /* Metin-dışı öğe eşiği WCAG 1.4.11 = 3:1. Gündüz OSM yolu ≈ #f7f7f7.
       Bu ölçüm PR-3b'nin kabul ölçütüdür; PR-3a hiçbir rengi DEĞİŞTİRMEZ. */
    const day = contrastRatio(ROUTE_CASING_NORMAL, '#f7f7f7');
    expect(day).not.toBeNull();
    expect(day as number, 'gündüz kılıf kontrastı beklenenden yüksek — K2 ölçümü yanlış')
      .toBeLessThan(1.2);

    // Gece zemininde (raster brightness-max 0.25 ≈ #404040 civarı) güçlü.
    const night = contrastRatio(ROUTE_CASING_NORMAL, '#404040');
    expect(night as number).toBeGreaterThan(3);
  });

  it('K2 ÖLÇÜMÜ: amber dikkat rengi gündüz zemininde de eşiğin ALTINDA', () => {
    const day = contrastRatio(ROUTE_ATTENTION_AMBER, '#f7f7f7');
    expect(day as number, 'amber gündüz kontrastı beklenenden yüksek')
      .toBeLessThan(3);
  });
});
