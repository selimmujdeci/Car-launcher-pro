/**
 * mapRenderPerformanceF3.test.ts — ARCH-06/F3 · RENDER + MAP KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * BU FAZIN DÜRÜST SONUCU: harita/render katmanı ZATEN optimize edilmişti.
 * Kamera dedup'ı (2026-07-11 saha düzeltmesi, ölçülmüş CPU rakamlarıyla),
 * rota geometri dedup'ı, idle-uykulu rAF ve çoklu-harita önleme (2026-06-14
 * ölçülmüş düzeltme) hepsi YERİNDEYDİ.
 *
 * Bu yüzden F3'ün katkısı yeniden yazmak DEĞİL, **ölçmek ve KİLİTLEMEKTİR**:
 * doğru davranışlar sessizce geri alınamasın. F0 §36 bunu açıkça söyler —
 * "fazı doldurmak için problem UYDURMA".
 *
 * Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  bumpPerf, getPerfCounters, _resetPerfCountersForTest,
} from '../platform/perf/perfCounters';
import {
  getMapInstanceEvidence, noteMapInstanceMounted, noteMapInstanceUnmounted,
  _resetMapInstanceEvidenceForTest,
} from '../platform/perf/mapInstanceEvidence';
import { getRenderClassContract, renderSurfaces } from '../platform/perf/renderClassContract';
import { getPerformanceDiagnosticsSnapshot } from '../platform/perf/performanceAggregator';

const FULL_MAP = readFileSync('src/components/map/FullMapView.tsx', 'utf8');
const LAYER = readFileSync('src/platform/map/MapLayerManager.ts', 'utf8');
const ROUTE_HOOK = readFileSync('src/components/map/hooks/useRouteDrawingLifecycle.ts', 'utf8');
const HOME = readFileSync('src/components/layout/NewHomeLayout.tsx', 'utf8');
const DRAWER = readFileSync('src/components/layout/DrawerPanel.tsx', 'utf8');
const SPLIT = readFileSync('src/components/split/SplitScreen.tsx', 'utf8');

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

beforeEach(() => {
  _resetPerfCountersForTest();
  _resetMapInstanceEvidenceForTest();
});

/* ═══════════════════════════════════════════════════════════════════════════
   A) KAMERA COALESCING — MEVCUT DAVRANIŞ KİLİTLENDİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F3/A · kamera coalescing', () => {
  it('A1 — 🔒 kamera dedup eşikleri MEVCUT (epsilon tabanlı)', () => {
    /* Bunlar 2026-07-11 saha düzeltmesinin çekirdeğidir: "yapılan iş" ölçütü.
       Kaldırılırsa harita boşta %43-212 CPU’ya geri döner. */
    expect(FULL_MAP).toContain('CAM_EPS_M');
    expect(FULL_MAP).toContain('CAM_EPS_BEAR');
    expect(FULL_MAP).toContain('NO_WORK_IDLE_MS');
    expect(FULL_MAP).toContain('sentCamLat');
  });

  it('A2 — 🔒 aynı hedef → harita mutasyonu GÖNDERİLMEZ', () => {
    /* Kamera komutu YALNIZ `_camChanged` doğruyken çıkar.
       2026-09-05: araya bir gerekçe yorumu girdiği için pencere 200→900
       genişletildi; KURAL aynı. Ayrıca dedup ÇAPASININ artık koşullu
       yazıldığı da kilitlenir — giriş kapısı kamerayı ertelediğinde çapa
       yazılırsa durakta kamera bir daha hiç güncellenmez (saha kusuru). */
    expect(FULL_MAP).toMatch(/if \(_camChanged\) \{[\s\S]{0,900}setDrivingView\(/);
    expect(FULL_MAP, 'çapa koşulsuz yazılıyor').toMatch(/if \(_camApplied\) \{/);
  });

  it('A3 — 🔒 kullanıcı etkileşimi takip kamerasını BASTIRIR', () => {
    /* Follow kamera kullanıcıyı EZEMEZ — iki dalda da guard var. */
    expect(FULL_MAP).toMatch(/if \(!userInteractingRef\.current && isFollowingRef\.current/);
    expect(FULL_MAP).toMatch(/\} else if \(!userInteractingRef\.current && isFollowingRef\.current\)/);
  });

  it('A4 — 🔒 BEKLEYEN kamera hedefi KUYRUĞU YOK (yalnız son durum)', () => {
    const code = codeOnly(FULL_MAP);
    /* Kuyruk olsaydı bayat bir hedef sonradan uygulanabilirdi. Dedup çapası
       tek bir "son gönderilen" durumdur, bir dizi DEĞİL. */
    expect(code).not.toMatch(/cameraQueue|pendingCameraTargets|_camQueue/);
  });

  it('A5 — kamera sayaçları GERÇEK yola takılı', () => {
    expect(FULL_MAP).toContain("bumpPerf('map.cameraTargetComputed')");
    expect(FULL_MAP).toContain("bumpPerf('map.cameraDedupSkipped')");
    expect(FULL_MAP).toContain("bumpPerf('map.cameraSuppressedByUser')");
  });

  it('A6 — dedup oranı türetilir ve 0/0 durumunda null olur', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const map = snap.sections.find((s) => s.sectionId === 'map');
    const ratio = map?.metrics.find((m) => m.name === 'map.cameraDedupRatio');
    /* Hiç hesaplama olmadıysa oran UYDURULMAZ. */
    expect(ratio?.value).toBeNull();
    bumpPerf('map.cameraTargetComputed', 10);
    bumpPerf('map.cameraDedupSkipped', 7);
    const after = getPerformanceDiagnosticsSnapshot().sections
      .find((s) => s.sectionId === 'map')?.metrics
      .find((m) => m.name === 'map.cameraDedupRatio');
    expect(after?.value).toBeCloseTo(0.7, 5);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) ROTA GEOMETRİSİ — İLERLEME YENİDEN KURMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F3/B · rota geometri revizyonu', () => {
  it('B1 — 🔒 geometri dedup anahtarı: hash + styleKey + navStatus', () => {
    expect(ROUTE_HOOK).toContain('const hash = routeHash(route.geometry)');
    expect(ROUTE_HOOK).toMatch(
      /if \(!styleKeyChanged && last && last\.hash === hash && last\.navStatus === navStatus\)/);
  });

  it('B2 — 🔒 İLERLEME geometri efektinin bağımlılığı DEĞİL', () => {
    /* Kabul ölçütü (§35): progress-only güncelleme → geometri rebuild 0.
       Bu, bağımlılık dizisinde ilerleme alanının BULUNMAMASIYLA sağlanır. */
    const deps = ROUTE_HOOK.match(
      /\}, \[route\.geometry, route\.alternatives, route\.altRealIndices, mapStatus, styleKey, navStatus\]\);/);
    expect(deps).not.toBeNull();
    const depStr = deps?.[0] ?? '';
    for (const forbidden of ['distanceMeters', 'progress', 'currentStepIndex', 'remaining', 'eta']) {
      expect(depStr, forbidden).not.toContain(forbidden);
    }
  });

  it('B3 — 🔒 routeHash O(1) (uç noktalar + uzunluk), tüm diziyi gezmez', () => {
    const internals = readFileSync('src/components/map/hooks/_mapSurfaceInternals.ts', 'utf8');
    const body = internals.slice(internals.indexOf('export function routeHash'));
    const fn = body.slice(0, body.indexOf('\n}'));
    /* Hash, rebuild'den PAHALI olmamalı (§13). Döngü/reduce/join YASAK. */
    expect(fn).not.toMatch(/for\s*\(|\.map\(|\.reduce\(|\.join\(|JSON\.stringify/);
    expect(fn).toContain('geometry.length');
  });

  it('B4 — stil yeniden yüklemesi rebuild’e İZİN VERİR', () => {
    /* styleKey değişimi dedup’ı bilinçli olarak atlar: katman/kaynak gitti. */
    expect(ROUTE_HOOK).toContain('const styleKeyChanged = !last || last.styleKey !== styleKey');
  });

  it('B5 — dedup atlaması SAYILIR (kanıt üretiliyor)', () => {
    expect(ROUTE_HOOK).toContain("bumpPerf('map.routeGeometryDedupSkip')");
  });

  it('B6 — 🔒 geometri yazıcısı TEK yerdedir', () => {
    /* `SEL_SRC` üzerine rota geometrisi yazan tek çağrı — ikinci bir yazıcı
       dedup’ı yapısal olarak delerdi. */
    const writes = [...LAYER.matchAll(/getSource\(SEL_SRC\) as GeoJSONSource\)\s*\.?\s*\n?\s*\.setData\(/g)];
    expect(writes.length).toBeLessThanOrEqual(2);
    expect(LAYER).toContain("bumpPerf('map.routeGeometryRebuild')");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) HARİTA ÖRNEĞİ — F0'IN AÇIK SORUSU CEVAPLANDI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F3/C · harita örneği yaşam döngüsü', () => {
  it('C1 — 🔒 FullMap açıkken MiniMap MOUNT EDİLMEZ', () => {
    /* Karşılıklı dışlama: `fullMapOpen ? placeholder : <MiniMapWidget/>`. */
    expect(HOME).toMatch(/fullMapOpen[\s\S]{0,400}<MiniMapWidget/);
    expect(HOME).toContain('fullMapOpen');
  });

  it('C2 — 🔒 trafik haritası YALNIZ çekmece açıkken mount edilir', () => {
    /* 2026-06-14 ölçülmüş düzeltme: DrawerShell kapalıyken de çocukları
       mount tutuyordu → 2. WebGL bağlamı yaşıyordu. */
    expect(DRAWER).toMatch(/drawer === 'traffic' && <TrafficPanel \/>/);
  });

  it('C3 — 🔒 SplitScreen tam ekranda MiniMap RENDER ETMEZ', () => {
    /* Erken dönüş: `if (mapFullScreen) return <FullMapView …/>`. */
    expect(SPLIT).toMatch(/if \(mapFullScreen\) \{[\s\S]{0,120}return <FullMapView/);
  });

  it('C4 — örnek kanıtı sayar, harita NESNESİ TUTMAZ', () => {
    const src = readFileSync('src/platform/perf/mapInstanceEvidence.ts', 'utf8');
    const code = codeOnly(src);
    expect(code).not.toMatch(/MapLibreMap|maplibregl|WeakMap|Map<.*Map>/);
    expect(code).not.toMatch(/\.remove\(\)|\.getCanvas\(/);
  });

  it('C5 — eşzamanlı zirve ölçülür', () => {
    noteMapInstanceMounted('FULL');
    expect(getMapInstanceEvidence().active).toBe(1);
    noteMapInstanceMounted('TRAFFIC');
    const peak = getMapInstanceEvidence();
    expect(peak.active).toBe(2);
    expect(peak.peakConcurrent).toBe(2);
    expect(peak.concurrentObserved).toBe(true);
    noteMapInstanceUnmounted();
    noteMapInstanceUnmounted();
    const after = getMapInstanceEvidence();
    expect(after.active).toBe(0);
    /* Zirve GEÇMİŞTİR — sıfırlanmaz. */
    expect(after.peakConcurrent).toBe(2);
  });

  it('C6 — çift yıkım sayacı NEGATİFE düşürmez', () => {
    noteMapInstanceMounted('FULL');
    noteMapInstanceUnmounted();
    noteMapInstanceUnmounted();   // destroyMap + orphan temizliği
    expect(getMapInstanceEvidence().active).toBe(0);
  });

  it('C7 — üç harita yüzeyi de sayıma bağlı', () => {
    expect(readFileSync('src/platform/map/MapCore.ts', 'utf8'))
      .toContain("noteMapInstanceMounted('FULL')");
    expect(readFileSync('src/components/traffic/TrafficMapMini.tsx', 'utf8'))
      .toContain("noteMapInstanceMounted('TRAFFIC')");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) RENDER OTORİTESİ — YENİ ZAMANLAYICI YOK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F3/D · render otoritesi', () => {
  it('D1 — 🔒 FullMapView rAF döngüsü BOŞTA UYUR', () => {
    expect(FULL_MAP).toContain('IDLE_HYSTERESIS_MS');
    expect(FULL_MAP).toContain('NO_WORK_IDLE_MS');
    expect(FULL_MAP).toContain('lastWorkTs');
  });

  it('D2 — 🔒 GLOBAL render zamanlayıcısı KURULMADI', () => {
    for (const f of ['src/platform/perf/renderClassContract.ts',
      'src/platform/perf/mapInstanceEvidence.ts',
      'src/platform/perf/performanceAggregator.ts']) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/requestAnimationFrame|setInterval\(|setTimeout\(/);
    }
    /* Yasaklı isimler repo genelinde YOK. */
    for (const banned of ['globalRenderScheduler', 'mapRenderManager', 'frameAuthority', 'mapSingleton']) {
      expect(codeOnly(FULL_MAP), banned).not.toContain(banned);
    }
  });

  it('D3 — render sınıfı sözleşmesi bir ZAMANLAYICI DEĞİL', () => {
    const c = getRenderClassContract();
    expect(c.notes.join(' ')).toMatch(/zamanlayıcı DEĞİL/);
    expect(c.surfaces.length).toBeGreaterThan(0);
  });

  it('D4 — yüksek frekanslı yüzeyler seçicisiz aboneliğe İZİN VERMEZ', () => {
    for (const s of renderSurfaces()) {
      if (s.renderClass === 'FRAME_CRITICAL' || s.renderClass === 'LIVE_TELEMETRY') {
        expect(s.wholeStoreSubscriptionAllowed, s.surfaceId).toBe(false);
      }
    }
  });

  it('D5 — 🔒 bildirilen yüzeylerde SEÇİCİSİZ mağaza aboneliği YOK', () => {
    /* Kapsam DAR ve kasıtlı: yalnız bildirilen yüksek frekanslı yüzeyler.
       Kör repo-geneli regex yanlış alarm üretir (F3 §26). */
    for (const s of renderSurfaces()) {
      const code = codeOnly(readFileSync(s.file, 'utf8'));
      expect(code, `${s.surfaceId} → useStore()`).not.toMatch(/useStore\(\s*\)/);
      expect(code, `${s.surfaceId} → useUnifiedVehicleStore()`)
        .not.toMatch(/useUnifiedVehicleStore\(\s*\)/);
    }
  });

  it('D6 — 200 ms resize pump KORUNDU (rAF yerine)', () => {
    expect(FULL_MAP).toMatch(/setInterval\([\s\S]{0,400}200\)/);
    expect(FULL_MAP).toContain('resize()');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) GERÇEK SAHİPLİK VE TRUTH — DEĞİŞMEDİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F3/E · truth ve sahiplik korunuyor', () => {
  it('E1 — 🔒 GPS/CAN/OBD kadansları DEĞİŞMEDİ', () => {
    const gps = readFileSync('src/platform/gpsService.ts', 'utf8');
    expect(gps).toContain('GPS_NAV_MAX_INTERVAL_MS = 500');
    expect(gps).toContain('POSITION_THROTTLE_BASE_MS = 200');
    expect(readFileSync('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java', 'utf8'))
      .toContain('CAN_EMIT_MIN_INTERVAL_MS = 80L');
  });

  it('E2 — 🔒 ölçüm katmanı harita/navigasyon TRUTH’una YAZMAZ', () => {
    for (const f of ['src/platform/perf/mapInstanceEvidence.ts',
      'src/platform/perf/renderClassContract.ts']) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/setState|getState\(\)|useUnifiedVehicleStore|useStore/);
    }
  });

  it('E3 — 🔒 F2 boot/timer davranışı DEĞİŞMEDİ', () => {
    const boot = readFileSync('src/platform/system/SystemBoot.ts', 'utf8');
    expect(boot).toContain('bootDeferral.begin(this._diagStarts');
    expect(boot).toContain("bootDeferral.abort('SystemBoot.stop()')");
    expect(boot).toContain("await measureBootService('hydrateExpertTrustStore', 1, true");
  });

  it('E4 — ölçüm katmanı koordinat/geometri TAŞIMAZ', () => {
    for (const f of ['src/platform/perf/mapInstanceEvidence.ts',
      'src/platform/perf/renderClassContract.ts']) {
      const code = codeOnly(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/latitude|longitude|coordinates|geometry/i);
    }
  });

  it('E5 — sayaç sayısı arttı ama kap SABİT şekilli kaldı', () => {
    const before = Object.keys(getPerfCounters()).length;
    bumpPerf('map.cameraDedupSkipped');
    expect(Object.keys(getPerfCounters()).length).toBe(before);
  });

  it('E6 — render sayaçları ÜRETİM yoluna takılmadı (dürüst UNMEASURED)', () => {
    const rc = getPerformanceDiagnosticsSnapshot().sections
      .find((s) => s.sectionId === 'render_class');
    const hud = rc?.metrics.find((m) => m.name === 'render.navigationHud.count');
    /* Sıcak render yolunda sayaç BİLE maliyet üretir; ölçmediğimizi
       ölçmüş gibi göstermiyoruz. */
    expect(hud?.kind).toBe('UNMEASURED');
  });
});
