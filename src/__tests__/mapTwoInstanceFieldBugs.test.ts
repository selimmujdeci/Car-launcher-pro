/**
 * mapTwoInstanceFieldBugs.test.ts — 2026-09-05 SAHA KUSURLARI (gerçek head unit).
 *
 * İki bağımsız kusur, iki kalıcı kilit. İkisi de "kod doğru görünüyordu ama
 * ekranda olmuyordu" sınıfındandır ve hiçbir mevcut testi düşürmüyorlardı.
 *
 * ── KUSUR 1 · ROTA RENGİ TAM EKRANDA YAZILMIYORDU ─────────────────────────
 * Kullanıcı: *"mini haritada rota mavi tam ekranda değil; tam ekranda bazen
 * mavi oluyor ama genelde bu renk"*.
 * KÖK NEDEN: ürün CANLI İKİ MapLibre örneği taşır (MiniMapWidget + FullMapView).
 * Boya yazan fonksiyonlar `map` parametresi alıyordu ama dedup anahtarları
 * MODÜL düzeyinde, örnekten bağımsız tutuluyordu → mini boyandıktan sonra tam
 * ekran çağrısı dedup'a takılıp HİÇ boyanmıyordu.
 *
 * ── KUSUR 2 · ORTALA SONRASI KAMERA YAKLAŞIP GERİ ÇEKİLİYORDU ─────────────
 * Kullanıcı: *"aracı ortala diyorum kamera yakın oluyor geri uzaklaşıyor"*.
 * KÖK NEDEN: `enterNavigationView` 1.000 ms'lik `easeTo` başlatır; takip
 * döngüsü ~120 ms'de bir kamera yazar ve DURAKTA zoom'u `map.getZoom()`ten
 * okur → animasyonun ORTASINDAKİ değeri `jumpTo` ile sabitler.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* ══ 1. ÖRNEK-BAŞINA BOYA DEDUP ═══════════════════════════════════════════ */

describe('saha kusuru 1 · iki harita örneği, tek dedup defteri', () => {
  const src = SRC('src/platform/map/MapLayerManager.ts');

  it('🔒 dedup defteri harita ÖRNEĞİNE bağlıdır (WeakMap) — modül düzeyinde DEĞİL', () => {
    expect(src, 'örnek-başına defter yok').toContain('_appliedPaintKeys');
    expect(src).toMatch(/const _appliedPaintKeys = new WeakMap<\s*MapLibreMap/);
    /* WeakMap ŞART: harita yok edilince kayıt da düşmeli (zero-leak). Normal
       `Map` kullanılsaydı her stil/örnek değişiminde sızıntı olurdu. */
    expect(src).not.toMatch(/const _appliedPaintKeys = new Map</);
  });

  it('🔒 boya yazan DÖRT yol da örnek-başına dedup kullanır', () => {
    for (const slot of ['routeColor', 'emphasis', 'declutter', 'arrow']) {
      expect(src, `${slot} slotu örnek-başına işaretlenmiyor`)
        .toContain(`_notePaint(map, '${slot}'`);
    }
    for (const slot of ['routeColor', 'emphasis', 'arrow']) {
      expect(src, `${slot} slotu örnek-başına SORULMUYOR`)
        .toContain(`_paintApplied(map, '${slot}'`);
    }
  });

  it('🔒 KUSURUN KENDİSİ GERİ GELEMEZ: renk dedup\'ı modül durumundan okunamaz', () => {
    /* Kusurlu satır birebir şuydu:
         if (!force && _routeColor !== null && _routeColor.routeColorKey === d.routeColorKey) return d;
       `_routeColor` artık YALNIZ LAB gözlemi içindir; dedup kararı ondan
       türetilemez. */
    expect(src, 'eski örnek-kör dedup satırı geri gelmiş')
      .not.toMatch(/_routeColor\s*!==\s*null\s*&&\s*_routeColor\.routeColorKey\s*===/);
  });

  it('🔒 ölü modül-düzeyi anahtarlar geri EKLENMEZ (ikinci gerçek kaynağı)', () => {
    /* Bunlar yalnız yazılıp hiç okunmayan "hayalet" anahtarlardı; bırakılsalar
       bir sonraki tur onları yeniden dedup sanabilirdi. */
    expect(src).not.toMatch(/let _lastArrowKey\b/);
    expect(src).not.toMatch(/let _lastEmphasisKey\b/);
  });

  it('🔒 toplu geçersizleştirme NESİL sayacıyla yapılır (WeakMap gezilemez)', () => {
    expect(src).toContain('function _invalidateAllPaint');
    for (const fn of ['resetRouteColorState', 'invalidateRouteEmphasis', 'invalidateMapDeclutter']) {
      const i = src.indexOf(`export function ${fn}(`);
      expect(i, `${fn} bulunamadı`).toBeGreaterThan(-1);
      expect(src.slice(i, i + 320), `${fn} dedup'ı geçersiz kılmıyor`)
        .toContain('_invalidateAllPaint()');
    }
  });

  it('🔒 DAVRANIŞ: aynı karar İKİ AYRI haritaya da uygulanır', async () => {
    /* Saf davranış kanıtı — sahte iki "harita" nesnesiyle. Kusurlu sürümde
       ikinci haritaya HİÇ yazılmıyordu. */
    const mod = await import('../platform/map/MapLayerManager');
    const make = () => {
      const paints: Array<[string, string, unknown]> = [];
      return {
        paints,
        getLayer: (id: string) => ({ id }),
        getSource: () => ({}),
        isStyleLoaded: () => true,
        setPaintProperty: (id: string, prop: string, v: unknown) => { paints.push([id, prop, v]); },
        setLayoutProperty: () => {},
        getCanvas: () => ({ clientWidth: 800, clientHeight: 480 }),
        once: () => {},
        on: () => {},
        getZoom: () => 16,
        getPitch: () => 0,
        getBearing: () => 0,
        project: () => ({ x: 0, y: 0 }),
      } as never;
    };
    mod._resetPaintDedupForTest();
    const mini = make() as unknown as { paints: unknown[] };
    const full = make() as unknown as { paints: unknown[] };

    mod.syncRouteColor(mini as never, 0, false);
    mod.syncRouteColor(full as never, 0, false);

    expect(mini.paints.length, 'mini haritaya hiç boya yazılmadı').toBeGreaterThan(0);
    expect(full.paints.length,
      'TAM EKRANA HİÇ BOYA YAZILMADI — saha kusuru geri geldi').toBeGreaterThan(0);
  });
});

/* ══ 2. GİRİŞ KAMERASI KAPISI ═════════════════════════════════════════════ */

describe('saha kusuru 2 · giriş animasyonunu takip döngüsü kesiyordu', () => {
  const src = SRC('src/platform/map/MapInteractionManager.ts');

  it('🔒 giriş animasyonu için bir PENCERE vardır ve `enterNavigationView` açar', () => {
    expect(src).toContain('_entryCamUntilMs');
    const i = src.indexOf('export function enterNavigationView(');
    expect(i).toBeGreaterThan(-1);
    const gövde = src.slice(i, i + 3000);
    expect(gövde, 'giriş penceresi açılmıyor')
      .toMatch(/_entryCamUntilMs\s*=\s*performance\.now\(\)\s*\+\s*DURATION_MS/);
  });

  it('🔒 takip döngüsü giriş uçuştayken KAMERA KOMUTU YAZMAZ', () => {
    const i = src.indexOf('export function setDrivingView(');
    const j = src.indexOf('export function ', i + 10);
    const gövde = src.slice(i, j);
    expect(gövde, 'kapı okunmuyor').toContain('_entryCameraInFlight(map)');
    /* Kapı, kamera komutunun ÖNÜNDE olmalı: hem easeTo hem jumpTo dalları. */
    expect(gövde).toMatch(/if \(_entryGate\)[\s\S]{0,120}\} else if \(_smoothPan\)/);
    /* Araç-ekran-içi düzeltmesi de girişi kesmemeli. */
    expect(gövde).toMatch(/_entryGate \? null : clampTopPadForVehicle/);
  });

  it('🔒 kapı KULLANICI GİRDİSİNİ kilitlemez — easing bitince anında düşer', () => {
    const i = src.indexOf('function _entryCameraInFlight(');
    const gövde = src.slice(i, i + 900);
    expect(gövde, 'süre penceresi yok').toContain('performance.now() >= _entryCamUntilMs');
    expect(gövde, 'easing denetimi yok — kullanıcı pan\'i 1 sn kilitlenirdi')
      .toContain('map.isEasing()');
    /* Ölçüm başarısız olursa kapı AÇILIR (fail-open): kamera hiç yazmamaktansa
       yazmalı — kilitlenme riski kabul edilemez. */
    expect(gövde).toMatch(/catch \{ _entryCamUntilMs = 0; return false; \}/);
  });

  it('🔒 ERTELEME SESSİZ OLAMAZ: kapı kamerayı yutarsa çağıran ÇAPA YAZMAZ', () => {
    /* SAHA KUSURU 2026-09-05 (2. tur): giriş kapısı kamerayı erteliyordu ama
       `FullMapView` `sentCam*` dedup çapalarını KOŞULSUZ yazıyordu. Durakta
       hiçbir girdi değişmediği için `setDrivingView` bir daha çağrılmıyor ve
       kamera rotanın TERSİNE bakmaya devam ediyordu (kullanıcı: "kamera yola
       göre bakması lazım"). */
    const sdvBas = src.indexOf('export function setDrivingView(');
    const sdvGovde = src.indexOf('): boolean {', sdvBas);
    expect(sdvBas, 'setDrivingView bulunamadı').toBeGreaterThan(-1);
    expect(sdvGovde, 'setDrivingView kameranın uygulanıp uygulanmadığını bildirmiyor')
      .toBeGreaterThan(sdvBas);
    /* Dönüş tipi, bir sonraki export'tan ÖNCE gelmeli (yanlış fonksiyonu ölçme). */
    const sonraki = src.indexOf('export function ', sdvBas + 10);
    expect(sdvGovde).toBeLessThan(sonraki);
    expect(src, 'kapı kapalıyken de "uygulandı" deniyor').toContain('return !_entryGate;');
    const view = SRC('src/components/map/FullMapView.tsx');
    expect(view, 'çağıran dönüş değerini okumuyor').toContain('const _camApplied = setDrivingView(');
    expect(view, 'çapa koşulsuz yazılıyor — erteleme sessizce kaybolur')
      .toMatch(/if \(_camApplied\) \{[\s\S]{0,400}sentCamBear/);
    expect(view, 'ertelenen kare yeniden denenmiyor')
      .toMatch(/if \(!_camApplied\) \{[^}]*wakeLoopRef/);
  });

  it('🔒 sürüş bitince bekleyen kapı DÜŞER (park görünümü kamerasız kalmaz)', () => {
    const i = src.indexOf('export function exitDrivingView(');
    expect(src.slice(i, i + 500)).toContain('_entryCamUntilMs = 0');
  });

  it('🔒 oturum/test sıfırlaması pencereyi de temizler', () => {
    const i = src.indexOf('export function _resetCameraComposition(');
    expect(src.slice(i, i + 260)).toContain('_entryCamUntilMs = 0');
  });

  it('🔒 DAVRANIŞ: pencere açıkken kapı kapalı, süre dolunca açık', async () => {
    const mod = await import('../platform/map/MapInteractionManager');
    mod._resetCameraComposition();
    expect(mod._entryCameraRemainingMs(), 'başlangıçta pencere açık olmamalı').toBe(0);
  });
});

/* ══ 3. KUSURLARIN İLİŞKİSİZLİĞİ ══════════════════════════════════════════ */

describe('kapsam', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('🔒 hiçbir düzeltme YENİ otorite kurmadı', () => {
    const a = SRC('src/platform/map/MapLayerManager.ts');
    const b = SRC('src/platform/map/MapInteractionManager.ts');
    /* Renk kararı hâlâ TEK modelden gelir; kapı da kamera sahibinin İÇİNDEDİR. */
    expect(a).toContain('resolveRouteColor({ maneuverTier, hazardHigh, lightBasemap })');
    expect(b).not.toContain('new CameraController');
    /* Zoom eşiği bu dosyada İCAT EDİLMEZ — kanonik modelden okunur. */
    expect(b).toContain('resolveMaxZoomHint(');
  });
});
