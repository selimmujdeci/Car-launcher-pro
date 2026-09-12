/**
 * navigationSessionContinuity.test.ts — NAVIGATION_MINI_MAP_SESSION_CONTINUITY_P0.
 *
 * ── ÇÖZDÜĞÜ ARIZA ───────────────────────────────────────────────────────────
 * Aktif navigasyon oturumunun SAHİBİ fiilen `FullMapView` idi:
 *   1) Rota ilerlemesini (mesafe · ETA · adım · ses · reroute · varış) süren
 *      GPS aboneliği bileşenin İÇİNDEYDİ → tam ekran kapanınca (unmount) tick
 *      ölüyor, navigasyon topluca donuyordu.
 *   2) Rota isteği dedup'ı bileşen ref'iydi (`lastFetchedRef`) → tam ekran
 *      yeniden açılınca AKTİF oturum için YENİ rota isteniyor ve durum
 *      ACTIVE→ROUTING'e düşüyordu (ilerleme + ETA sıfırlanıyordu).
 *   3) Mini haritanın navigasyondan HABERİ YOKTU → ana ekranda rota kaybolurdu.
 *
 * Bu dosya kalıcı kilitleri kurar: davranış testleri otoritenin kendisini,
 * yapısal kilitler ise görünüm kablolamasını (kapatmak ≠ sonlandırmak) korur.
 */
/// <reference types="vite/client" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import fullMapViewSrc    from '../components/map/FullMapView.tsx?raw';
import miniMapWidgetSrc  from '../components/map/MiniMapWidget.tsx?raw';
import navigationHudSrc  from '../components/map/NavigationHUD.tsx?raw';
import drawerPanelSrc    from '../components/layout/DrawerPanel.tsx?raw';
import mainLayoutSrc     from '../components/layout/MainLayout.tsx?raw';
import navRuntimeSrc     from '../platform/navigation/navigationSessionRuntime.ts?raw';
import systemBootSrc     from '../platform/system/SystemBoot.ts?raw';

/* ── GPS emitter mock — runtime'ın tek besleme hattı ─────────────────────── */
const gpsHarness = vi.hoisted(() => {
  const subs: Array<(loc: unknown) => void> = [];
  return {
    subs,
    emit(loc: unknown) { for (const fn of [...subs]) fn(loc); },
    reset() { subs.length = 0; },
  };
});

vi.mock('../platform/gpsService', () => ({
  onGPSLocation: (fn: (loc: unknown) => void) => {
    gpsHarness.subs.push(fn);
    fn(null); // gerçek servisin anlık senkronizasyon davranışı
    return () => {
      const i = gpsHarness.subs.indexOf(fn);
      if (i >= 0) gpsHarness.subs.splice(i, 1);
    };
  },
  getGPSSpeedKmh: () => 0,
}));

vi.mock('../platform/ttsService', () => ({ speakNavigation: vi.fn() }));
vi.mock('../platform/addressBookService', () => ({}));
vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
}));
vi.mock('../platform/bridge', () => ({ isNative: false }));
vi.mock('../platform/offlineRoutingService', () => ({
  tryLocalDaemon:      vi.fn(async () => null),
  computeOfflineRoute: vi.fn(async () => null),
  straightLineRoute:   vi.fn(() => null),
}));
vi.mock('../core/navigation/CorridorSyncEngine', () => ({
  corridorSync: { activate: vi.fn(), stop: vi.fn(), onGeometryUpdate: vi.fn() },
}));
vi.mock('../utils/safeStorage', () => ({
  safeSetRawImmediate: vi.fn(async () => true),
  safeGetRaw:          vi.fn(() => null),
  safeRemoveRaw:       vi.fn(),
}));

import {
  NavStatus,
  startNavigation,
  activateNavigation,
  stopNavigation,
  endNavigation,
  getNavigationState,
  getNavSessionId,
  claimRouteRequest,
  releaseRouteRequest,
  getRouteRequestClaim,
} from '../platform/navigationService';
import {
  getRouteState,
  writeActiveRoute,
  clearRoute,
} from '../platform/routingService';
import {
  startNavigationSessionRuntime,
  stopNavigationSessionRuntime,
  isNavigationSessionRuntimeRunning,
  getNavigationSessionRuntimeSnapshot,
  _resetNavigationSessionRuntimeForTest,
} from '../platform/navigation/navigationSessionRuntime';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

/* ── Sabit test rotası — düz doğu-batı hattı (~1.1 km) ────────────────────── */
const ROUTE: [number, number][] = [
  [32.8000, 39.9000],
  [32.8040, 39.9000],
  [32.8080, 39.9000],
  [32.8120, 39.9000],
];
const DEST = {
  id: 'dest-1', name: 'Test Hedefi', type: 'history' as const,
  latitude: 39.9000, longitude: 32.8120,
};

function seedActiveSession(): void {
  startNavigation(DEST, false);
  writeActiveRoute({ geometry: ROUTE, distanceM: 1100, durationS: 120 });
  activateNavigation();
}

function fix(lat: number, lon: number, heading = 90) {
  return { latitude: lat, longitude: lon, heading, speed: 10, accuracy: 5, timestamp: Date.now() };
}

beforeEach(() => {
  _resetNavigationSessionRuntimeForTest();
  gpsHarness.reset();
  stopNavigation();
  clearRoute();
  useUnifiedVehicleStore.setState({ speed: 40 });
});

afterEach(() => {
  stopNavigationSessionRuntime();
  vi.clearAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
   1. OTURUM MOTORU GÖRÜNÜMDEN BAĞIMSIZ
   ══════════════════════════════════════════════════════════════════════════ */
describe('1. Oturum motoru görünümden bağımsız çalışır', () => {
  it('hiçbir görünüm mount edilmeden ilerleme İŞLENİR (ETA + kalan mesafe üretilir)', () => {
    startNavigationSessionRuntime();
    seedActiveSession();

    gpsHarness.emit(fix(39.9000, 32.8000));
    gpsHarness.emit(fix(39.9000, 32.8040));

    const snap = getNavigationSessionRuntimeSnapshot();
    expect(snap.running).toBe(true);
    expect(snap.tickCount).toBeGreaterThanOrEqual(2);

    // Motor kalan mesafeyi rota geometrisi üzerinden yazdı — hiçbir harita yokken.
    const nav = getNavigationState();
    expect(nav.status).toBe(NavStatus.ACTIVE);
    expect(nav.distanceMeters).toBeGreaterThan(0);
    expect(nav.distanceMeters).toBeLessThan(1200);
  });

  it('ilerleme rota geometrisini TEK otoriteden okur (görünüm kopyası YOK)', () => {
    startNavigationSessionRuntime();
    seedActiveSession();
    gpsHarness.emit(fix(39.9000, 32.8000));
    const first = getNavigationState().distanceMeters!;

    gpsHarness.emit(fix(39.9000, 32.8080));
    const later = getNavigationState().distanceMeters!;
    expect(later).toBeLessThan(first);   // rota üzerinde ilerledi
  });

  it('navigasyon AKTİF değilken tick İŞLENMEZ (boşuna CPU yok)', () => {
    startNavigationSessionRuntime();
    startNavigation(DEST, false);        // PREVIEW — henüz sürülmüyor
    writeActiveRoute({ geometry: ROUTE, distanceM: 1100, durationS: 120 });

    gpsHarness.emit(fix(39.9000, 32.8000));
    const snap = getNavigationSessionRuntimeSnapshot();
    expect(snap.tickCount).toBe(0);
    expect(snap.skippedInactive).toBeGreaterThanOrEqual(1);
    expect(snap.lastObservedStatus).toBe(NavStatus.PREVIEW);
  });

  it('fix YOKKEN motor çalışmaz ama abonelik ölmez', () => {
    startNavigationSessionRuntime();
    seedActiveSession();
    gpsHarness.emit(null);
    expect(getNavigationSessionRuntimeSnapshot().skippedNoFix).toBeGreaterThanOrEqual(1);
    expect(isNavigationSessionRuntimeRunning()).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2. GÖRÜNÜM GEÇİŞLERİ — ABONELİK / İSTEK ÇOĞALMAZ
   ══════════════════════════════════════════════════════════════════════════ */
describe('2. Görünüm geçişleri kaynak çoğaltmaz', () => {
  it('motor İDEMPOTENT — 20 başlatma çağrısı TEK abonelik açar', () => {
    for (let i = 0; i < 20; i++) startNavigationSessionRuntime();
    expect(gpsHarness.subs.length).toBe(1);
  });

  it('20 mini→tam→mini döngüsünde tick SAYISI fix sayısına eşit kalır (çift tick yok)', () => {
    startNavigationSessionRuntime();
    seedActiveSession();

    // Her "görünüm açılışı" motoru yeniden başlatmayı DENER (boot idempotency).
    for (let i = 0; i < 20; i++) {
      startNavigationSessionRuntime();          // tam ekran açıldı
      startNavigationSessionRuntime();          // mini haritaya dönüldü
    }
    expect(gpsHarness.subs.length).toBe(1);

    gpsHarness.emit(fix(39.9000, 32.8010));
    expect(getNavigationSessionRuntimeSnapshot().tickCount).toBe(1); // 1 fix = 1 tick
  });

  it('aynı oturumda İKİNCİ rota isteği sahiplenilemez — 20 görünüm döngüsü sonrası bile', () => {
    seedActiveSession();
    // İlk sahiplenme = tam ekranın ilk rota isteği
    expect(claimRouteRequest(DEST.id)).toBe(true);

    // 20 kez aç/kapa → hiçbiri yeni istek atamaz
    for (let i = 0; i < 20; i++) {
      expect(claimRouteRequest(DEST.id)).toBe(false);
    }
  });

  it('oturum kimliği görünüm geçişlerinde DEĞİŞMEZ; yalnız YENİ hedef artırır', () => {
    startNavigation(DEST, false);
    const sid = getNavSessionId();
    activateNavigation();

    // görünüm açılıp kapanmak oturum otoritesine dokunmaz
    for (let i = 0; i < 20; i++) {
      expect(getNavSessionId()).toBe(sid);
      expect(getNavigationState().status).toBe(NavStatus.ACTIVE);
    }

    startNavigation({ ...DEST, id: 'dest-2' }, false);
    expect(getNavSessionId()).toBe(sid + 1);
  });

  it('istek hatası sahipliği BIRAKIR — yeniden deneme mümkün (H2 yolu korunur)', () => {
    startNavigation(DEST, false);
    expect(claimRouteRequest(DEST.id)).toBe(true);
    releaseRouteRequest();
    expect(getRouteRequestClaim()).toBeNull();
    expect(claimRouteRequest(DEST.id)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3. KAPATMAK ≠ SONLANDIRMAK
   ══════════════════════════════════════════════════════════════════════════ */
describe('3. Görünüm kapatmak oturumu bitirmez; yalnız açık eylem bitirir', () => {
  it('oturum + rota + ETA, hiçbir görünüm yokken YAŞAMAYA devam eder', () => {
    startNavigationSessionRuntime();
    seedActiveSession();
    gpsHarness.emit(fix(39.9000, 32.8000));

    const before = getNavigationState();
    expect(before.status).toBe(NavStatus.ACTIVE);

    // "Tam ekran kapandı" — hiçbir sonlandırma çağrısı YOK, yalnız görünüm gitti.
    const after = getNavigationState();
    expect(after.status).toBe(NavStatus.ACTIVE);
    expect(after.destination?.id).toBe(DEST.id);
    expect(getRouteState().geometry).not.toBeNull();
    expect(getRouteState().geometry!.length).toBe(ROUTE.length);

    // Motor kapanmadan çalışmaya devam eder → mini harita canlı veri görür.
    gpsHarness.emit(fix(39.9000, 32.8040));
    expect(getNavigationSessionRuntimeSnapshot().tickCount).toBeGreaterThanOrEqual(2);
  });

  it('endNavigation oturumu VE rotayı birlikte kapatır (tek giriş noktası)', () => {
    startNavigationSessionRuntime();
    seedActiveSession();
    gpsHarness.emit(fix(39.9000, 32.8000));

    endNavigation();

    expect(getNavigationState().status).toBe(NavStatus.IDLE);
    expect(getNavigationState().destination).toBeNull();
    expect(getRouteState().geometry).toBeNull();
    expect(getRouteRequestClaim()).toBeNull();
  });

  it('sonlandırmadan sonra motor tick ÜRETMEZ (lifecycle temiz kapanır)', () => {
    startNavigationSessionRuntime();
    seedActiveSession();
    gpsHarness.emit(fix(39.9000, 32.8000));
    const ticks = getNavigationSessionRuntimeSnapshot().tickCount;

    endNavigation();
    gpsHarness.emit(fix(39.9000, 32.8040));
    gpsHarness.emit(fix(39.9000, 32.8080));

    expect(getNavigationSessionRuntimeSnapshot().tickCount).toBe(ticks);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4. BAYAT YANIT / OTURUM EZİLMESİ
   ══════════════════════════════════════════════════════════════════════════ */
describe('4. Görünüm geçişi bayat rotanın güncel oturumu ezmesine izin vermez', () => {
  it('yeni hedef oturum kimliğini artırır → eski oturumun istek anahtarı geçersizleşir', () => {
    startNavigation(DEST, false);
    claimRouteRequest(DEST.id);
    const staleKey = getRouteRequestClaim();

    startNavigation({ ...DEST, id: 'dest-2', name: 'Yeni Hedef' }, false);
    expect(getRouteRequestClaim()).toBeNull();
    // Eski anahtar artık hiçbir isteği bastıramaz — yeni oturumda ilk istek geçer.
    expect(claimRouteRequest(DEST.id)).toBe(true);
    expect(getRouteRequestClaim()).not.toBe(staleKey);
  });

  it('rota geometrisi değişince kalan mesafe BAYAT değerde donmaz', () => {
    startNavigationSessionRuntime();
    seedActiveSession();
    gpsHarness.emit(fix(39.9000, 32.8000));
    expect(getNavigationState().distanceMeters).toBeGreaterThan(0);

    // Reroute benzeri: yeni (daha kısa) geometri yazılır
    writeActiveRoute({
      geometry: [[32.8100, 39.9000], [32.8120, 39.9000]],
      distanceM: 170, durationS: 20,
    });
    gpsHarness.emit(fix(39.9000, 32.8100));
    expect(getNavigationState().distanceMeters!).toBeLessThan(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5. YAPISAL KİLİTLER — GÖRÜNÜM KABLOLAMASI
   ══════════════════════════════════════════════════════════════════════════ */
describe('5. 🔒 Yapısal kilitler — sahiplik görünüme geri dönmesin', () => {
  it('🔒 FullMapView ilerleme MOTORUNU GPS aboneliğinde ÇALIŞTIRMAZ', () => {
    /* Motorun görünüme geri taşınması bu görevin kök nedenini geri getirir.
       Tek istisna: GPS KAYBINDA ölü hesaplama (DR) yolu — o `allowReroute: false`
       ile ve yalnız fix gelmezken çalışır, GPS tick'iyle asla yarışmaz. */
    const gpsTickBlock = fullMapViewSrc.slice(
      fullMapViewSrc.indexOf('const unsub = onGPSLocation('),
      fullMapViewSrc.indexOf('// 3) Düşük frekanslı render commit'),
    );
    expect(gpsTickBlock.length).toBeGreaterThan(100); // blok gerçekten bulundu
    expect(gpsTickBlock).not.toContain('updateRouteProgress(');
    expect(gpsTickBlock).not.toContain('updateNavigationProgress(');
  });

  it('🔒 FullMapView unmount / onClose oturum sonlandırma yoluna BAĞLANMAZ', () => {
    // Görünümü kapatan buton `onClose` prop'unu çağırır; sonlandırma ayrı eylemdir.
    expect(fullMapViewSrc).toContain('onClose={onClose}');
    // MapHudControls'a (kapat butonu) sonlandırma fonksiyonu GEÇİLEMEZ.
    const hudControls = fullMapViewSrc.slice(fullMapViewSrc.indexOf('<MapHudControls'));
    for (const forbidden of ['endNavigation', 'stopNavigation', 'clearRoute', 'handleNavCancel']) {
      expect(hudControls.slice(0, hudControls.indexOf('/>')), `kapat butonu ${forbidden} çağırıyor`)
        .not.toContain(forbidden);
    }
  });

  it('🔒 tam ekranı kapatan yollar YALNIZ görünüm bayrağını düşürür', () => {
    expect(drawerPanelSrc).toContain('onClose={onCloseMap}');
    expect(mainLayoutSrc).toContain('onCloseMap={() => setFullMapOpen(false)}');
    // Donanım geri tuşu da yalnız görünümü kapatır.
    expect(mainLayoutSrc).toMatch(/if \(fullMapOpen\)\s*\{\s*setFullMapOpen\(false\);\s*return;\s*\}/);
    // Bu iki dosya oturumu sonlandıran hiçbir fonksiyonu ÇAĞIRMAZ.
    for (const src of [drawerPanelSrc, mainLayoutSrc]) {
      expect(src).not.toContain('endNavigation(');
      expect(src).not.toContain('stopNavigation(');
    }
  });

  it('🔒 rota isteği dedup\'ı BİLEŞEN REF\'İ değil oturum otoritesidir', () => {
    // `lastFetchedRef` unmount'ta ölüyordu → yeniden açılışta yeni istek + ROUTING.
    expect(fullMapViewSrc).not.toContain('lastFetchedRef');
    expect(fullMapViewSrc).toContain('claimRouteRequest(destination.id)');
  });

  it('🔒 mini harita AYRI rota otoritesi kurmaz — yalnız okur ve çizer', () => {
    for (const forbidden of [
      'fetchRoute', 'writeActiveRoute', 'updateRouteProgress',
      'updateNavigationProgress', 'setNavStatus', 'activateNavigation',
      'startNavigation(', 'create(', 'useState<[number, number][]',
    ]) {
      expect(miniMapWidgetSrc, `mini harita ${forbidden} kullanıyor — ikinci otorite`)
        .not.toContain(forbidden);
    }
    // Okuma TEK otoriteden
    expect(miniMapWidgetSrc).toContain("from '../../platform/routingService'");
    expect(miniMapWidgetSrc).toContain('useRouteState()');
    expect(miniMapWidgetSrc).toContain('useNavigation()');
  });

  it('🔒 mini harita aktif rotayı ÇİZER ve ilerlemeyi kırpar', () => {
    expect(miniMapWidgetSrc).toContain('setRouteGeometry(map, geom)');
    expect(miniMapWidgetSrc).toContain('trimRouteGeometry(');
    expect(miniMapWidgetSrc).toContain('getRouteProgressPoint()');
    // Rota bitince katman temizlenir (hayalet çizgi kalmaz)
    expect(miniMapWidgetSrc).toContain('clearRouteGeometry(map)');
  });

  it('🔒 mini harita KANITSIZ manevra bilgisi üretmez', () => {
    // Şerit / dönel kavşak çıkışı mini haritada HİÇ üretilmez.
    expect(miniMapWidgetSrc).not.toContain('roundaboutExit');
    expect(miniMapWidgetSrc).not.toContain('lanes');
    // Manevra mesafesi yalnız yöntemi BİLİNEN ölçüden gösterilir.
    expect(miniMapWidgetSrc).toContain("distanceToNextTurnSource !== 'UNKNOWN'");
  });

  it('🔒 oturumu sonlandıran TEK fonksiyon var — kopya kapanış yolu yok', () => {
    // HUD ve FullMapView aynı giriş noktasını kullanır.
    expect(navigationHudSrc).toContain('endNavigation()');
    expect(navigationHudSrc).not.toContain('stopNavigation()');
    expect(fullMapViewSrc).toContain('endNavigation();');
  });

  it('🔒 motor uygulama boot\'una bağlı — görünüme değil', () => {
    expect(systemBootSrc).toContain('startNavigationSessionRuntime()');
    expect(systemBootSrc).toContain("this._regNamed('NavigationSessionRuntime', startNavigationSessionRuntime());");
    expect(systemBootSrc).not.toContain('this._reg(startNavigationSessionRuntime());');
    // Hiçbir görünüm motoru başlatmaz.
    expect(fullMapViewSrc).not.toContain('startNavigationSessionRuntime');
    expect(miniMapWidgetSrc).not.toContain('startNavigationSessionRuntime');
  });

  /* KİLİT GÜNCELLENDİ (NAVIGATION_DELIVERY_CORE_P0) — DAVRANIŞ BİLİNÇLİ DEĞİŞTİ.
   *
   * Eski kilit motorun HİÇ timer kurmamasını şart koşuyordu; bu doğruydu çünkü
   * kadans GPS fix'inden geliyordu. Ama GPS KESİLDİĞİNDE geri çağrı hiç gelmez
   * → ölü hesaplama (DR) bir zamanlayıcı OLMADAN çalışamaz. DR'nin görünümde
   * (FullMapView RAF) kalması, mini haritadayken tünelde mesafe/ETA/adımın
   * DONMASI demekti.
   *
   * Yeni sözleşme: **tam olarak BİR** zamanlayıcı, yalnız DR için, `setInterval`
   * ile ve `stopNavigationSessionRuntime`/`_onNavigationInactive` içinde
   * kesinlikle temizlenir. `setTimeout` hâlâ YASAK (gecikmeli tek atış = sahipsiz
   * iş). Koordinat sızıntısı kuralı DEĞİŞMEDİ. */
  it('🔒 motor YALNIZ DR için TEK timer kurar ve koordinat SIZDIRMAZ', () => {
    const intervals = navRuntimeSrc.match(/setInterval\(/g) ?? [];
    expect(intervals, 'birden fazla zamanlayıcı = çift ilerleme riski').toHaveLength(1);
    expect(navRuntimeSrc).toContain('setInterval(_drTick');
    expect(navRuntimeSrc).not.toContain('setTimeout(');
    // Zero-Leak: kurulan tek timer iki ayrı yolda da kapatılır.
    const clears = navRuntimeSrc.match(/clearInterval\(_drTimer\)/g) ?? [];
    expect(clears.length).toBeGreaterThanOrEqual(2);
    // Gözlem görüntüsü koordinat/konum alanı TAŞIMAZ (CLAUDE.md gözlem kuralı 6).
    const snap = getNavigationSessionRuntimeSnapshot() as Record<string, unknown>;
    for (const key of Object.keys(snap)) {
      expect(/lat|lon|coord|position|destination/i.test(key), `alan sızdırıyor: ${key}`).toBe(false);
    }
    // Değerler de yalnız sayı/boolean/durum etiketi olabilir.
    for (const v of Object.values(snap)) {
      expect(['number', 'boolean', 'object', 'string']).toContain(typeof v);
    }
    expect(typeof snap.lastObservedStatus === 'string' || snap.lastObservedStatus === null).toBe(true);
  });

  it('🔒 motor fail-soft — tick hatası aboneliği öldürmez', () => {
    expect(navRuntimeSrc).toContain('logError(');
    expect(navRuntimeSrc).toMatch(/catch \(e\) \{[\s\S]*?_errorCount\+\+/);
  });
});
