/**
 * Orientation Sensor Demand Gating testleri (PR 3/3).
 *
 * İki always-on tüketici talep-güdümlü hale getirildi:
 *   • gpsService COMPASS → Orientation Sensor Gate (background auto-pause + dedup).
 *     Foreground davranışı KORUNUR (GPS tracking'te acquire). ⚠️ Bu PR compass'ı
 *     Settings ekranında KAPATMAZ — foreground Settings-gating "harita ekranda mı"
 *     tüketici sinyali gerektirir (global görünüm store'u yok, MainLayout lokal
 *     drawer state'i; tüketiciye dokunmak KAPSAM DIŞI). Bkz. PR notu.
 *   • smartDrivingEngine ACCELEROMETER → gate + TALEP-GÜDÜMLÜ: yalnız TAZE
 *     güvenilir hız kaynağı (OBD/GPS, recordSpeed) YOKKEN acquire; taze kaynak
 *     varken release. Fail-safe: hiç kaynak yoksa açık.
 *
 * ⚠️ Bu PR native samplingPeriod'u düşürdüğünü İDDİA ETMEZ (gerçek cihaz QA
 * gerekir). Testler yalnız gate abonelik/talep davranışını doğrular.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mocks (gpsService bağımlılıkları) ─────────────────────────── */

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions:   vi.fn(),
    requestPermissions: vi.fn(),
    watchPosition:      vi.fn(),
    clearWatch:         vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import { getSubscriberCounts, getStatus, reset as gateReset } from '../platform/sensors';
import { startGPSTracking, stopGPSTracking, getGPSState } from '../platform/gpsService';
import {
  attachAccelerometer, detachAccelerometer, recordSpeed, detectDrivingMode,
} from '../platform/smartDrivingEngine';
import { DECAY_MAX_SEC } from '../platform/smartConstants';

// Kaynak-metin kilitleri.
import gpsSrc          from '../platform/gpsService.ts?raw';
import smartDrivingSrc from '../platform/smartDrivingEngine.ts?raw';
import arSrc           from '../platform/arAlignmentService.ts?raw';
import dashSrc         from '../platform/dashcamService.ts?raw';
import blackboxSrc     from '../platform/security/blackBoxService.ts?raw';
import deviceApiSrc    from '../platform/deviceApi.ts?raw';

/* ── Ortam yardımcıları ────────────────────────────────────────── */

function setNative(v: boolean): void {
  (globalThis as unknown as Record<string, unknown>).Capacitor = { isNativePlatform: () => v };
}
function mockNavigatorGeolocation(): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { geolocation: { watchPosition: vi.fn().mockReturnValue(42), clearWatch: vi.fn() } },
    writable: true, configurable: true,
  });
}
let _vis: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => _vis });
function setVisibility(v: DocumentVisibilityState): void {
  _vis = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  const w = window as unknown as Record<string, unknown>;
  if (!('DeviceMotionEvent' in window))      w.DeviceMotionEvent = class extends Event {};
  if (!('DeviceOrientationEvent' in window)) w.DeviceOrientationEvent = class extends Event {};
});

/* ════════════════════════════════════════════════════════════════
   COMPASS (gpsService) — gate migration: background-pause + dedup
   ════════════════════════════════════════════════════════════════ */
describe('PR 3 — gpsService compass gate demand/visibility', () => {
  beforeEach(async () => {
    _vis = 'visible';
    setNative(false);
    mockNavigatorGeolocation();
    await stopGPSTracking();
    gateReset();
  });
  afterEach(async () => {
    await stopGPSTracking();
    gateReset();
    vi.clearAllMocks();
  });

  /* 1 — gps start compass acquire eder */
  it('1: GPS tracking başlayınca compass gate\'ten acquire edilir', async () => {
    await startGPSTracking();
    const c = getSubscriberCounts();
    expect(c.orientationAbsolute).toBe(1);
    expect(c.orientation).toBe(1);
  });

  /* 2 — gps stop compass release eder */
  it('2: GPS tracking durunca compass release edilir', async () => {
    await startGPSTracking();
    await stopGPSTracking();
    expect(getSubscriberCounts().orientationAbsolute).toBe(0);
    expect(getSubscriberCounts().orientation).toBe(0);
  });

  /* 3 — duplicate start ekstra abonelik yok */
  it('3: duplicate GPS start ekstra compass aboneliği oluşturmaz', async () => {
    await startGPSTracking();
    await startGPSTracking();
    expect(getSubscriberCounts().orientationAbsolute).toBe(1);
  });

  /* 4 — heading davranışı korunuyor (state yapısı) */
  it('4: heading davranışı korunuyor (getGPSState.heading alanı mevcut)', async () => {
    await startGPSTracking();
    expect(getGPSState()).toHaveProperty('heading');   // null olabilir — yapı korunur
  });

  /* 5 — background'da fiziksel compass listener sökülür */
  it('5: background (hidden) → compass fiziksel listener sökülür, kayıt korunur', async () => {
    await startGPSTracking();
    expect(getStatus().channels.orientationAbsolute.listenerAttached).toBe(true);
    setVisibility('hidden');
    expect(getStatus().channels.orientationAbsolute.listenerAttached).toBe(false);
    expect(getSubscriberCounts().orientationAbsolute).toBe(1); // consumer kaydı korunur
  });

  /* 6 — foreground dönüşünde geri bağlanır */
  it('6: foreground dönüşünde compass yeniden bağlanır', async () => {
    await startGPSTracking();
    setVisibility('hidden');
    setVisibility('visible');
    expect(getStatus().channels.orientationAbsolute.listenerAttached).toBe(true);
  });

  /* 7 — DÜRÜST SINIR: compass Settings'te KAPATILMADI (foreground korunur) */
  it('7: compass foreground davranışı korunur (bu PR Settings-gating YAPMAZ)', async () => {
    // Compass, GPS tracking aktifken ekrandan bağımsız acquire edilir (bugünkü
    // davranış korunur). Settings-foreground-gating tüketici demand sinyali
    // gerektirir → bu PR KAPSAMI DIŞI. Kaynakta ekran/nav koşulu YOK.
    await startGPSTracking();
    expect(getSubscriberCounts().orientationAbsolute).toBe(1);
    expect(gpsSrc).not.toMatch(/isNavigating|drawer|activeScreen|currentView/);
  });
});

/* ════════════════════════════════════════════════════════════════
   ACCELEROMETER (smartDrivingEngine) — talep-güdümlü fallback
   ════════════════════════════════════════════════════════════════ */
describe('PR 3 — smartDrivingEngine accelerometer demand gating', () => {
  let _now = 1_000_000;
  beforeEach(() => {
    _vis = 'visible';
    _now += 10_000_000;                          // her test için taze taban (prior stale)
    vi.spyOn(performance, 'now').mockImplementation(() => _now);
    detachAccelerometer();                        // özellik kapalı + release
    gateReset();
  });
  afterEach(() => {
    detachAccelerometer();
    gateReset();
    vi.restoreAllMocks();
  });
  const advance = (sec: number): void => { _now += sec * 1000; };

  /* 8 — kaynak yokken fail-safe acquire (fallback açılıyor) */
  it('8: taze hız kaynağı yokken accel fail-safe acquire edilir', () => {
    attachAccelerometer();                        // recordSpeed yok / prior stale
    expect(getSubscriberCounts().motion).toBe(1);
  });

  /* 9 — taze GPS/HAL hızı varken accel AÇILMAZ */
  it('9: taze hız kaynağı (recordSpeed) varken accel açılmaz', () => {
    recordSpeed(50);                              // taze kaynak
    attachAccelerometer();
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 10 — kaynak gelince release (fresh → bırak) */
  it('10: accel açıkken taze kaynak gelince release edilir', () => {
    attachAccelerometer();                        // kaynak yok → acquire
    expect(getSubscriberCounts().motion).toBe(1);
    recordSpeed(50);                              // taze kaynak → release
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 11 — kaynak stale olunca (yeni değerlendirmede) fallback açılıyor */
  it('11: kaynak stale olduğunda accel yeniden fallback olur (attach re-eval)', () => {
    recordSpeed(50);                              // taze
    attachAccelerometer();
    expect(getSubscriberCounts().motion).toBe(0); // taze → kapalı
    advance(DECAY_MAX_SEC + 5);                    // kaynak stale
    detachAccelerometer();                         // özellik döngüsü (re-eval tetikleyici)
    attachAccelerometer();
    expect(getSubscriberCounts().motion).toBe(1); // stale → fallback açık
  });

  /* 12 — detach release eder */
  it('12: detachAccelerometer accel\'i release eder', () => {
    attachAccelerometer();
    detachAccelerometer();
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 13 — duplicate attach ekstra abonelik yok */
  it('13: duplicate attach ekstra abonelik oluşturmaz', () => {
    attachAccelerometer();
    attachAccelerometer();
    expect(getSubscriberCounts().motion).toBe(1);
  });

  /* 14 — background release (gate) */
  it('14: background (hidden) → accel fiziksel listener sökülür', () => {
    attachAccelerometer();
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
    setVisibility('hidden');
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
  });

  /* 15 — foreground re-attach */
  it('15: foreground dönüşünde accel yeniden bağlanır (talep sürerken)', () => {
    attachAccelerometer();
    setVisibility('hidden');
    setVisibility('visible');
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
  });

  /* 16 — detectDrivingMode davranışı DEĞİŞMEDİ (accel yalnız Kademe 4) */
  it('16: detectDrivingMode davranışı korunuyor', () => {
    expect(detectDrivingMode({ btConnected: false, charging: false }, undefined, 30)).toBe('driving');
    expect(detectDrivingMode({ btConnected: false, charging: false }, 0, undefined)).toBe('idle');
    expect(detectDrivingMode({ btConnected: false, charging: false }, undefined, 10)).toBe('normal');
  });

  /* 17 — leak yok: attach/detach döngüsü sonrası sıfır */
  it('17: attach/detach döngüsü sonrası gate\'te sızıntı yok', () => {
    attachAccelerometer(); detachAccelerometer();
    attachAccelerometer(); detachAccelerometer();
    expect(getSubscriberCounts().total).toBe(0);
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════
   KAYNAK KİLİTLERİ — kapsam, güvenlik, dürüstlük
   ════════════════════════════════════════════════════════════════ */
describe('PR 3 — kaynak kilitleri', () => {
  /* 18 — compass gate'e taşındı */
  it('18: gpsService compass gate kullanır (ham deviceorientation yok)', () => {
    expect(gpsSrc).toMatch(/from '\.\/sensors'/);
    expect(gpsSrc).toMatch(/subscribeOrientationAbsolute\(_onDeviceOrientation\)/);
    expect(gpsSrc).not.toMatch(/addEventListener\('deviceorientation/);
  });

  /* 19 — accel gate + demand-gate */
  it('19: smartDrivingEngine accel gate + talep-güdümlü (subscribeMotion + _evaluateAccelDemand)', () => {
    expect(smartDrivingSrc).toMatch(/from '\.\/sensors'/);
    expect(smartDrivingSrc).toMatch(/subscribeMotion\(_handleDeviceMotion\)/);
    expect(smartDrivingSrc).toMatch(/_evaluateAccelDemand/);
    expect(smartDrivingSrc).toMatch(/_accelDemandNeeded/);
    expect(smartDrivingSrc).not.toMatch(/addEventListener\('devicemotion'/);
  });

  /* 20 — permission davranışı korunur (feature-detect korundu, orientation için
     yeni izin akışı EKLENMEDİ). NOT: gpsService'in mevcut Geolocation izni
     (checkPermissions/requestPermissions) compass'la İLGİSİZ ve bu PR'da
     dokunulmadı — bu yüzden orientation permission'ı için ayrı bir kanıt yok. */
  it('20: permission davranışı korunur (feature-detect, yeni orientation izni yok)', () => {
    expect(smartDrivingSrc).toMatch(/window\.DeviceMotionEvent/);       // feature-detect korundu
    expect(smartDrivingSrc).not.toMatch(/requestPermission/);           // accel için izin akışı yok
    // compass migration'ı izin akışına dokunmadı — subscribe doğrudan (iOS
    // DeviceOrientation requestPermission tüketicinin mevcut davranışında kalır).
    expect(gpsSrc).not.toMatch(/DeviceOrientationEvent\s*\.\s*requestPermission/);
  });

  /* 21 — magic number yok: staleness DECAY_MAX_SEC ile (mevcut sabit) */
  it('21: accel staleness DECAY_MAX_SEC sabitiyle (uydurma eşik yok)', () => {
    expect(smartDrivingSrc).toMatch(/ageSec > DECAY_MAX_SEC/);
  });

  /* 22 — yeni timer/rAF/polling YOK (değişen dosyalarda sensör için) */
  it('22: smartDrivingEngine yeni timer/rAF/polling eklemez', () => {
    expect(smartDrivingSrc).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });

  /* 23 — Generic Sensor API / JS throttle EKLENMEDİ */
  it('23: Generic Sensor API veya yeni JS throttle eklenmedi', () => {
    for (const src of [gpsSrc, smartDrivingSrc]) {
      expect(src).not.toMatch(/new\s+(Gyroscope|Accelerometer|AbsoluteOrientationSensor|RelativeOrientationSensor)/);
    }
    // smartDrivingEngine'e yeni throttle sabiti eklenmedi (accel event'i throttle YOK).
    expect(smartDrivingSrc).not.toMatch(/THROTTLE|throttle/);
  });

  /* 24 — native samplingPeriod düşüşü İDDİA edilmiyor */
  it('24: değişen dosyalar native samplingPeriod düşüşü iddia etmez', () => {
    expect(gpsSrc).not.toMatch(/samplingPeriod/i);
    expect(smartDrivingSrc).not.toMatch(/samplingPeriod/i);
  });

  /* 25 — diğer tüketiciler bu PR'da DEĞİŞMEDİ (PR 2 gate kullanımı korunur) */
  it('25: arAlignment/dashcam/blackBox/deviceApi bu PR\'da değişmedi (hâlâ gate)', () => {
    expect(arSrc).toMatch(/subscribeMotion\(_onMotion\)/);
    expect(dashSrc).toMatch(/subscribeMotion\(_onMotion\)/);
    expect(blackboxSrc).toMatch(/return subscribeMotion\(handler\)/);
    expect(deviceApiSrc).toMatch(/return subscribeMotion\(handler\)/);
  });

  /* 26 — SystemBoot/Platform Kernel/OBD-CAN wiring'e bağlanmadı */
  it('26: değişen dosyalar SystemBoot/Kernel wiring eklemez', () => {
    expect(smartDrivingSrc).not.toMatch(/SystemBoot|from '[^']*kernel/i);
    // gpsService zaten SystemBoot import etmiyor; compass değişikliği eklemedi.
    expect(gpsSrc).not.toMatch(/serviceLifecycle|platformKernel/i);
  });
});
