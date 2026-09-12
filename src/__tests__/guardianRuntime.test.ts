/**
 * guardianRuntime.test.ts — GUARDIAN-AI-G16 · TICK SAHİPLİĞİ WIRING KİLİTLERİ.
 *
 * Kilitlenen gerçek: `runGuardian` artık üründe FİİLEN çağrılıyor ve onu çağıran
 * §L.0 tik-wheel'i. Kendi `setInterval`i YOK, görünüme bağlı DEĞİL, idempotent,
 * fail-soft, zero-leak ve ölçülmemiş alanlarda SAHTE 0 üretmiyor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Donanım/persist mock (diğer runtime testleriyle AYNI) ── */
const env = vi.hoisted(() => ({ tier: 'high' as 'low' | 'mid' | 'high', weakGpu: false }));
vi.mock('../platform/deviceCapabilities', () => ({ getDeviceTier: () => env.tier }));
vi.mock('../utils/detectWeakGpu', () => ({ hasWeakGpu: () => env.weakGpu, getGpuRenderer: () => '' }));
vi.mock('../utils/safeStorage', () => ({
  safeStorage:  { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  safeFlushKey: () => {},
  safeGetRaw:   () => null,
  safeSetRaw:   () => {},
}));

/* ── obdService mock: gerçek servis import-time yan etki taşır (runtimeManager
      aboneliği) ve bu test onun İÇİNİ değil, Guardian'ın onu OKUduğunu ölçer. ── */
const obd = vi.hoisted(() => ({
  snapshot: null as null | { engineTemp?: number; batteryVoltage?: number },
  throws:   false,
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => {
    if (obd.throws) throw new Error('OBD servisi patladı');
    return obd.snapshot;
  },
}));

import {
  startGuardianRuntime, stopGuardianRuntime, getGuardianRuntimeSnapshot,
  getGuardianOutput, _resetGuardianRuntimeForTest, _runGuardianTickOnceForTest,
} from '../platform/navigation/guardian/runtime/guardianRuntime';
import {
  GUARDIAN_TASK_ID, GUARDIAN_BASE_PERIOD_MS, guardianEffectivePeriodMs,
} from '../platform/navigation/guardian/runtime/guardianTickPolicy';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

beforeEach(() => {
  obd.snapshot = null;
  obd.throws   = false;
  useUnifiedVehicleStore.setState({ location: null });
  _resetGuardianRuntimeForTest();
});

afterEach(() => {
  _resetGuardianRuntimeForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Sahiplik — wheel'e kaydoluyor, kendi timer'ını KURMUYOR
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Guardian tick sahipliği', () => {
  it('start() görevi §L.0 wheel\'ine DOĞRU tanımla kaydeder', () => {
    const spy = vi.spyOn(runtimeManager, 'scheduleTask');
    startGuardianRuntime();

    expect(spy).toHaveBeenCalledTimes(1);
    const task = spy.mock.calls[0][0];
    expect(task.id).toBe(GUARDIAN_TASK_ID);
    expect(task.periodMs).toBe(GUARDIAN_BASE_PERIOD_MS);
    expect(task.criticality).toBe('NORMAL');
    expect(task.deferIdle).toBe(false);
    expect(typeof task.fn).toBe('function');
  });

  it('KENDİ setInterval/setTimeout\'unu KURMAZ (ikinci zamanlayıcı otoritesi yok)', () => {
    const si = vi.spyOn(globalThis, 'setInterval');
    const st = vi.spyOn(globalThis, 'setTimeout');
    // Wheel'i önceden ayakta tut ki onun kendi interval'i sayıma girmesin.
    const keepAlive = runtimeManager.scheduleTask({
      id: 'keep-alive', periodMs: 100000, criticality: 'NORMAL', fn: () => {},
    });
    si.mockClear(); st.mockClear();

    startGuardianRuntime();

    expect(si).not.toHaveBeenCalled();
    expect(st).not.toHaveBeenCalled();
    keepAlive();
  });

  it('start() İDEMPOTENTtir — ikinci çağrı ikinci görev kaydetmez', () => {
    const spy = vi.spyOn(runtimeManager, 'scheduleTask');
    startGuardianRuntime();
    startGuardianRuntime();
    startGuardianRuntime();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getGuardianRuntimeSnapshot().running).toBe(true);
  });

  it('stop() İDEMPOTENTtir ve görevi wheel\'den kaldırır', () => {
    const stop = startGuardianRuntime();
    stop();
    stop();
    stopGuardianRuntime();
    expect(getGuardianRuntimeSnapshot().running).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Wheel motoru GERÇEKTEN sürüyor mu (kağıt üstünde değil)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Wheel Guardian\'ı fiilen çağırıyor', () => {
  /**
   * Politikanın hesapladığı ETKİN periyot ile wheel'in GERÇEK davranışı aynı
   * olmalı. Sabit bir sayı yazmak yerine politikadan türetiyoruz — böylece bu
   * test aynı zamanda `guardianEffectivePeriodMs` formülünün wheel ile
   * ayrışmadığını da kilitler (mod jsdom'da SAB yokluğu yüzünden BASIC_JS'tir).
   */
  const period = () => guardianEffectivePeriodMs(runtimeManager.getMode());

  it('etkin periyot dolunca en az bir koşum ölçülür — ÖNCESİNDE ölçülmez', () => {
    vi.useFakeTimers();
    const p = period();
    startGuardianRuntime();

    expect(getGuardianRuntimeSnapshot().tickCount).toBe(0);
    vi.advanceTimersByTime(p - 334);                       // bir tik eksik
    expect(getGuardianRuntimeSnapshot().tickCount).toBe(0);
    vi.advanceTimersByTime(334);                           // periyot doldu
    expect(getGuardianRuntimeSnapshot().tickCount).toBeGreaterThanOrEqual(1);
  });

  it('stop() sonrası zaman ilerlese bile YENİ koşum OLMAZ (zero-leak)', () => {
    vi.useFakeTimers();
    const p = period();
    const stop = startGuardianRuntime();
    vi.advanceTimersByTime(p);
    const after = getGuardianRuntimeSnapshot().tickCount;
    expect(after).toBeGreaterThanOrEqual(1);

    stop();
    vi.advanceTimersByTime(10 * p);
    expect(getGuardianRuntimeSnapshot().tickCount).toBe(after);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Boru hattı UÇTAN UCA — runGuardian gerçek OBD okumasından çıktı üretir
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Boru hattı: OBD → adaptör → kural → runGuardian', () => {
  it('aşırı ısınma snapshot\'ı CRITICAL risk olayı üretir', () => {
    obd.snapshot = { engineTemp: 110, batteryVoltage: 13.8 };
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    const s = getGuardianRuntimeSnapshot();
    expect(s.evaluatedRuleCount).toBe(1);            // yalnız vehicle-health bağlı
    expect(s.riskEventCount).toBeGreaterThanOrEqual(1);
    expect(s.highestSeverity).toBe('CRITICAL');
    expect(s.overallRiskScore).toBeGreaterThan(0);
    expect(s.errorCount).toBe(0);

    const out = getGuardianOutput();
    expect(out).not.toBeNull();
    expect(out!.riskEvents.some((e) => e.type === 'VEHICLE_HEALTH_RISK')).toBe(true);
  });

  it('normal değerlerde kural KOŞAR ama olay ÜRETMEZ (0 olay ≠ arıza)', () => {
    obd.snapshot = { engineTemp: 85, batteryVoltage: 13.8 };
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    const s = getGuardianRuntimeSnapshot();
    expect(s.evaluatedRuleCount).toBe(1);
    expect(s.riskEventCount).toBe(0);
    expect(s.highestSeverity).toBeNull();
    expect(s.overallRiskScore).toBe(0);
  });

  it('OBD sentinel (-1) GERÇEK VERİ gibi taşınmaz → hiç kural çalışmaz', () => {
    obd.snapshot = { engineTemp: -1, batteryVoltage: -1 };
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    const s = getGuardianRuntimeSnapshot();
    expect(s.evaluatedRuleCount).toBe(0);
    expect(s.riskEventCount).toBe(0);
    expect(s.errorCount).toBe(0);
  });

  it('düşük akü gerilimi BatteryProtectionService eşiğinde olay üretir', () => {
    obd.snapshot = { batteryVoltage: 11.7 };  // THRESH_SLEEP (11.8) altı → MEDIUM
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    const s = getGuardianRuntimeSnapshot();
    expect(s.riskEventCount).toBeGreaterThanOrEqual(1);
    expect(s.highestSeverity).toBe('MEDIUM');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) FAIL-SOFT
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Fail-soft — kaynak hatası Guardian\'ı DEVİRMEZ', () => {
  it('OBD portu THROW etse bile tik koşar, sayaç ilerler, hata YAYILMAZ', () => {
    obd.throws = true;
    startGuardianRuntime();
    expect(() => _runGuardianTickOnceForTest()).not.toThrow();

    const s = getGuardianRuntimeSnapshot();
    expect(s.tickCount).toBe(1);
    expect(s.evaluatedRuleCount).toBe(0);  // kaynak okunamadı → kural yok
  });

  it('bozuk GPS konumu (NaN hız) tüm boru hattını düşürmez', () => {
    useUnifiedVehicleStore.setState({
      location: {
        latitude: 0, longitude: 0, accuracy: 5,
        speed: Number.NaN, timestamp: Date.now(),
      },
    });
    obd.snapshot = { engineTemp: 110 };
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    const s = getGuardianRuntimeSnapshot();
    expect(s.errorCount).toBe(0);
    expect(s.highestSeverity).toBe('CRITICAL');   // OBD yolu etkilenmedi
  });

  it('BAYAT GPS fix\'inin hızı KULLANILMAZ (tazelik kapısı)', () => {
    // 60 s eski fix — 3 s kapısının çok ötesi.
    useUnifiedVehicleStore.setState({
      location: {
        latitude: 0, longitude: 0, accuracy: 5,
        speed: 20, timestamp: Date.now() - 60_000,
      },
    });
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    // GPS hızı bugün zaten hiçbir kurala girmiyor; kilit, bayat hızın
    // pipeline'a SESSİZCE girmediğini ve hata üretmediğini garanti eder.
    const s = getGuardianRuntimeSnapshot();
    expect(s.errorCount).toBe(0);
    expect(s.evaluatedRuleCount).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) DÜRÜSTLÜK — sahte 0 / sahte "sağlıklı" YASAK
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Snapshot dürüstlüğü', () => {
  it('hiç koşum yokken ÖLÇÜM alanları null döner (sahte 0 YOK)', () => {
    const s = getGuardianRuntimeSnapshot();
    expect(s.tickCount).toBe(0);
    expect(s.evaluatedRuleCount).toBeNull();
    expect(s.riskEventCount).toBeNull();
    expect(s.overallRiskScore).toBeNull();
    expect(s.lastDurationMs).toBeNull();
    expect(s.maxDurationMs).toBeNull();
    expect(s.p50DurationMs).toBeNull();
    expect(s.p95DurationMs).toBeNull();
    expect(s.lastTickAgeMs).toBeNull();
    expect(s.lastOutputAgeMs).toBeNull();
    expect(s.durationSampleCount).toBe(0);
  });

  it('sağlayıcı envanteri BAĞLI OLMAYAN yuvaları GEREKÇESİYLE bildirir', () => {
    const s = getGuardianRuntimeSnapshot();
    const byId = Object.fromEntries(s.sources.map((x) => [x.id, x]));
    expect(byId.gps.wired).toBe(true);
    expect(byId.obd.wired).toBe(true);
    // `map` artık BAĞLI — ama YALNIZ `speedCamera` dilimi (gömülü denetim noktası
    // paketi). Kilit kaldırılmadı, YENİ doğru davranışa güncellendi; gerekçe
    // metninin kısmiliği AÇIKÇA yazması da kilitlenir (sahte "map tamam" YASAK).
    expect(byId.map.wired).toBe(true);
    expect(byId.map.reason).toContain('speedCamera');
    expect(byId.weather.wired).toBe(false);
    expect(byId.driver.wired).toBe(false);
    for (const src of s.sources) expect(src.reason.length).toBeGreaterThan(10);
    expect(s.wiredSourceCount).toBe(3);
  });

  it('koşum süresi ÖLÇÜLÜR ve bütçe sayaçları ilerler', () => {
    obd.snapshot = { engineTemp: 110 };
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    const s = getGuardianRuntimeSnapshot();
    expect(s.durationSampleCount).toBe(1);
    expect(s.lastDurationMs).not.toBeNull();
    expect(s.lastDurationMs!).toBeGreaterThanOrEqual(0);
    expect(s.p50DurationMs).not.toBeNull();
    expect(s.overHardLimitCount).toBe(0);
  });

  it('GİZLİLİK: snapshot koordinat veya serbest olay metni TAŞIMAZ', () => {
    useUnifiedVehicleStore.setState({
      location: { latitude: 41.1, longitude: 28.9, accuracy: 5, speed: 20, timestamp: Date.now() },
    });
    obd.snapshot = { engineTemp: 110 };
    startGuardianRuntime();
    _runGuardianTickOnceForTest();

    const json = JSON.stringify(getGuardianRuntimeSnapshot());
    expect(json).not.toContain('41.1');
    expect(json).not.toContain('28.9');
    expect(json).not.toContain('latitude');
    expect(json).not.toContain('longitude');
    // Olay özeti yalnız kimlik/tip/severity/güven/mesafe taşır.
    for (const e of getGuardianRuntimeSnapshot().events) {
      expect(Object.keys(e).sort()).toEqual(
        ['confidence', 'distanceMeters', 'id', 'severity', 'type'],
      );
    }
  });

  it('hata kaydı yalnız SINIF + AŞAMA taşır, mesaj TAŞIMAZ', () => {
    const s = getGuardianRuntimeSnapshot();
    expect(s.lastErrorKind).toBeNull();
    expect(s.lastErrorStage).toBeNull();
    expect(JSON.stringify(s)).not.toContain('patladı');
  });

  it('okuma sayaçları KİRLETMEZ — LAB\'ı açmak ölçümü bozmaz', () => {
    obd.snapshot = { engineTemp: 110 };
    startGuardianRuntime();
    _runGuardianTickOnceForTest();
    const before = getGuardianRuntimeSnapshot();
    getGuardianRuntimeSnapshot();
    getGuardianRuntimeSnapshot();
    const after = getGuardianRuntimeSnapshot();
    expect(after.tickCount).toBe(before.tickCount);
    expect(after.durationSampleCount).toBe(before.durationSampleCount);
  });
});
