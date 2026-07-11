/**
 * gpsSubscriptionSingle.test.ts — GPS ÇİFT ABONELİK tekilleştirmesi (saha fix 2026-07-11).
 *
 * SAHA KANITI (`dumpsys location`, gerçek cihaz Xiaomi zircon):
 *   10290/com.cockpitos.pro  Request[@+10s0ms BALANCED, minUpdateDistance=50.0]
 *   10290/com.cockpitos.pro  min/max interval = 1s/1s  → HIGH_ACCURACY (fused), locations = 8219
 *   10290/com.cockpitos.pro  min/max interval = 10s/10s → locations = 363
 * Yani uygulama aynı anda ÜÇ OS konum akışı tutuyordu:
 *   (1) WebView → Capacitor watchPosition (GMS fused, HIGH_ACCURACY)
 *   (2) Native FGS → LocationManager.GPS_PROVIDER 1 Hz / 2 m
 *   (3) Native FGS → LocationManager.NETWORK_PROVIDER 10 s / 50 m
 * (1) ve (2) aynı `handlePosition`'a akıyor → aynı konum iki kanaldan geliyor.
 *
 * BU TESTLER KİLİTLER:
 *  - Native besleme KANITLANINCA Capacitor watch BIRAKILIR (tek abonelik).
 *  - Kanıt yetersizken (az fix / kısa süre) watch BIRAKILMAZ (erken kapatma yok).
 *  - Native besleme ÖLÜNCE watch GERİ AÇILIR (fail-soft self-healing).
 *  - Web platformunda hiçbir askıya alma YAPILMAZ.
 *  - stopGPSTracking watchdog timer'ını temizler (zero-leak).
 *  - Native tarafta NETWORK_PROVIDER, GPS 1 Hz ile EŞZAMANLI istenmez (kaynak kilidi).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ── Mocks ───────────────────────────────────────────────── */

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions:   vi.fn().mockResolvedValue({ location: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
    getCurrentPosition: vi.fn().mockRejectedValue(new Error('no warm fix')),
    watchPosition:      vi.fn().mockResolvedValue('watch-1'),
    clearWatch:         vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setNative(val: boolean) {
  (globalThis as any).Capacitor = { isNativePlatform: () => val };
}

import { Geolocation } from '@capacitor/geolocation';
import { startGPSTracking, stopGPSTracking, feedBackgroundLocation, getGPSState } from '../platform/gpsService';

/** Kaynak sabitleri — kod ile test aynı eşikleri kullanmalı (drift kilidi). */
const GPS_SRC = readFileSync(join(process.cwd(), 'src', 'platform', 'gpsService.ts'), 'utf8');
const FGS_SRC = readFileSync(
  join(process.cwd(), 'android', 'app', 'src', 'main', 'java', 'com', 'cockpitos', 'pro', 'CarLauncherForegroundService.java'),
  'utf8',
);
const num = (name: string): number => {
  const m = GPS_SRC.match(new RegExp(`const ${name}\\s*=\\s*([0-9_]+)`));
  if (!m) throw new Error(`${name} kaynakta yok`);
  return Number(m[1].replace(/_/g, ''));
};
const CONFIRM_FIXES = num('NATIVE_FEED_CONFIRM_FIXES');
const CONFIRM_MS    = num('NATIVE_FEED_CONFIRM_MS');
const STALE_MS      = num('NATIVE_FEED_STALE_MS');
const WATCHDOG_MS   = num('NATIVE_FEED_WATCHDOG_MS');

const FIX = { lat: 37.9, lng: 40.2, speed: 0, bearing: 0, accuracy: 5 };

/** N native fix besle (her biri perf saatini ilerletir). */
function feedNative(n: number) {
  for (let i = 0; i < n; i++) feedBackgroundLocation({ ...FIX });
}

let nowMs = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  setNative(true);
  (Geolocation.watchPosition as ReturnType<typeof vi.fn>).mockResolvedValue('watch-1');
});

afterEach(async () => {
  await stopGPSTracking();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── Tekilleştirme ───────────────────────────────────────── */

describe('Tek abonelik — native besleme kanıtlanınca Capacitor watch bırakılır', () => {
  it('1. başlangıçta Capacitor watch AÇILIR (native besleme henüz kanıtlanmadı)', async () => {
    await startGPSTracking();
    expect(Geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(Geolocation.clearWatch).not.toHaveBeenCalled();
  });

  it('2. yeterli fix + yeterli süre → watch BIRAKILIR (tek akış: native)', async () => {
    await startGPSTracking();

    nowMs = 0;
    feedNative(1);                       // ilk native fix → çapa
    nowMs = CONFIRM_MS + 1;              // yeterli süre geçti
    feedNative(CONFIRM_FIXES);           // yeterli fix
    await vi.runOnlyPendingTimersAsync();

    expect(Geolocation.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('3. fix sayısı YETERSİZ → watch BIRAKILMAZ (erken kapatma yok)', async () => {
    await startGPSTracking();
    nowMs = 0;
    feedNative(1);
    nowMs = CONFIRM_MS + 1;
    feedNative(CONFIRM_FIXES - 3);       // eşik altı
    await vi.runOnlyPendingTimersAsync();
    expect(Geolocation.clearWatch).not.toHaveBeenCalled();
  });

  it('4. süre YETERSİZ → watch BIRAKILMAZ (kısa süreli akış kanıt değildir)', async () => {
    await startGPSTracking();
    nowMs = 0;
    feedNative(CONFIRM_FIXES + 5);       // bol fix ama…
    nowMs = 1_000;                       // …yalnız 1 saniye
    feedNative(2);
    await vi.runOnlyPendingTimersAsync();
    expect(Geolocation.clearWatch).not.toHaveBeenCalled();
  });

  it('5. watch bırakıldıktan sonra İKİNCİ kez bırakılmaz (idempotent)', async () => {
    await startGPSTracking();
    nowMs = 0; feedNative(1);
    nowMs = CONFIRM_MS + 1; feedNative(CONFIRM_FIXES);
    await vi.runOnlyPendingTimersAsync();

    feedNative(20);                       // akış sürüyor
    await vi.runOnlyPendingTimersAsync();
    expect(Geolocation.clearWatch).toHaveBeenCalledTimes(1);
  });
});

/* ── Fail-soft: native akış ölürse geri dön ──────────────── */

describe('Self-healing — native besleme ölürse watch geri açılır', () => {
  it('6. native fix akışı kesilince (stale) Capacitor watch YENİDEN açılır', async () => {
    await startGPSTracking();
    expect(Geolocation.watchPosition).toHaveBeenCalledTimes(1);

    nowMs = 0; feedNative(1);
    nowMs = CONFIRM_MS + 1; feedNative(CONFIRM_FIXES);
    await vi.runOnlyPendingTimersAsync();
    expect(Geolocation.clearWatch).toHaveBeenCalledTimes(1);   // askıya alındı

    // Native besleme durdu → watchdog stale görsün
    nowMs = CONFIRM_MS + 1 + STALE_MS + 1;
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 50);

    expect(Geolocation.watchPosition).toHaveBeenCalledTimes(2); // geri açıldı
  });

  it('7. besleme SÜRDÜĞÜ sürece watch geri açılmaz (gereksiz flapping yok)', async () => {
    await startGPSTracking();
    nowMs = 0; feedNative(1);
    nowMs = CONFIRM_MS + 1; feedNative(CONFIRM_FIXES);
    await vi.runOnlyPendingTimersAsync();

    // Her watchdog turundan önce taze fix gelsin
    for (let i = 0; i < 4; i++) {
      nowMs += WATCHDOG_MS - 100;
      feedNative(1);
      await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    }
    expect(Geolocation.watchPosition).toHaveBeenCalledTimes(1); // hâlâ tek çağrı
  });
});

/* ── Platform / lifecycle ────────────────────────────────── */

describe('Platform ve yaşam döngüsü', () => {
  it('8. WEB platformunda askıya alma YAPILMAZ (native besleme yok)', async () => {
    setNative(false);
    Object.defineProperty(globalThis, 'navigator', {
      value: { geolocation: { watchPosition: vi.fn().mockReturnValue(7), clearWatch: vi.fn() } },
      writable: true, configurable: true,
    });
    await startGPSTracking();

    nowMs = 0; feedNative(1);
    nowMs = CONFIRM_MS + 1; feedNative(CONFIRM_FIXES + 10);
    await vi.runOnlyPendingTimersAsync();

    expect(Geolocation.clearWatch).not.toHaveBeenCalled();
  });

  it('9. zero-leak: stopGPSTracking watchdog timer\'ını temizler', async () => {
    await startGPSTracking();
    nowMs = 0; feedNative(1);
    nowMs = CONFIRM_MS + 1; feedNative(CONFIRM_FIXES);
    await vi.runOnlyPendingTimersAsync();
    expect(vi.getTimerCount()).toBeGreaterThan(0);      // watchdog çalışıyor

    await stopGPSTracking();
    // Kalan tek timer olmamalı: watchdog temizlendi
    nowMs += STALE_MS * 3;
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3);
    expect(Geolocation.watchPosition).toHaveBeenCalledTimes(1);  // stop sonrası yeniden açılmadı
  });

  it('10. stop → start döngüsünde durum sıfırlanır (yeniden kanıt istenir)', async () => {
    await startGPSTracking();
    nowMs = 0; feedNative(1);
    nowMs = CONFIRM_MS + 1; feedNative(CONFIRM_FIXES);
    await vi.runOnlyPendingTimersAsync();
    await stopGPSTracking();

    (Geolocation.clearWatch as ReturnType<typeof vi.fn>).mockClear();
    await startGPSTracking();
    feedNative(2);                                   // az kanıt
    await vi.runOnlyPendingTimersAsync();
    expect(Geolocation.clearWatch).not.toHaveBeenCalled();   // yeniden kanıt bekleniyor
  });
});

/* ── Veri bütünlüğü (davranış korunuyor) ─────────────────── */

describe('Davranış koruması', () => {
  it('11. native fix\'ler askıya alma sonrasında da store\'a işlenmeye DEVAM eder', async () => {
    await startGPSTracking();

    nowMs = 0; feedNative(1);
    nowMs = CONFIRM_MS + 1; feedNative(CONFIRM_FIXES);
    await vi.runOnlyPendingTimersAsync();

    nowMs += 5_000;
    feedBackgroundLocation({ lat: 38.1, lng: 40.5, speed: 50, bearing: 90, accuracy: 4 });

    const loc = getGPSState().location;
    expect(loc?.latitude).toBeCloseTo(38.1, 3);
    expect(loc?.longitude).toBeCloseTo(40.5, 3);
  });

  it('12. bozuk native veri askıya alma sayacını İLERLETMEZ (kanıt yalnız geçerli fix)', async () => {
    await startGPSTracking();
    nowMs = 0;
    for (let i = 0; i < CONFIRM_FIXES + 5; i++) {
      feedBackgroundLocation({ lat: NaN, lng: 40.2, speed: 0, bearing: 0, accuracy: 5 });
    }
    nowMs = CONFIRM_MS + 1;
    feedBackgroundLocation({ lat: NaN, lng: 40.2, speed: 0, bearing: 0, accuracy: 5 });
    await vi.runOnlyPendingTimersAsync();
    expect(Geolocation.clearWatch).not.toHaveBeenCalled();
  });
});

/* ── Kaynak kilitleri ────────────────────────────────────── */

describe('Regresyon kilitleri', () => {
  it('13. gpsService: tek-abonelik mantığı kodda VAR', () => {
    expect(GPS_SRC).toMatch(/_maybeSuspendCapacitorWatch/);
    expect(GPS_SRC).toMatch(/_resumeCapacitorWatch/);
    expect(GPS_SRC).toMatch(/NATIVE_FEED_STALE_MS/);
    expect(GPS_SRC).toMatch(/_resetNativeFeedState\(\)/);   // stop'ta zero-leak
  });

  it('14. native FGS: NETWORK_PROVIDER, GPS 1 Hz ile EŞZAMANLI istenmez', () => {
    // startLocationUpdates: koşulsuz requestNetworkUpdates() ARTIK YOK
    expect(FGS_SRC).toMatch(/requestGpsHighAccuracy\(\);\s*\n\s*if \(!gpsHighAccuracyActive\) requestNetworkUpdates\(\);/);
    // resumeGpsHighAccuracy: GPS geri gelirken NETWORK aboneliği kaldırılıyor
    expect(FGS_SRC).toMatch(/resumeGpsHighAccuracy[\s\S]{0,400}removeUpdates\(locationListener\)/);
  });

  it('15. park modunda NETWORK_PROVIDER yedeği KORUNUYOR (davranış kaybı yok)', () => {
    expect(FGS_SRC).toMatch(/stopGpsHighAccuracy[\s\S]{0,500}requestNetworkUpdates\(\)/);
  });
});
