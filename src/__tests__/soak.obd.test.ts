/**
 * soak.obd.test.ts — T4 Commit 3: OBD reconnect/backoff long-run leak.
 *
 * Amaç: 8 saatlik SANAL çalışmada OBD reconnect/backoff döngüsü timer sızıntısı
 * yapıyor mu, attempt sayacı kontrolsüz büyüyor mu, reconnect timer tekil kalıyor
 * mu, deep-reconnect döngüsü sızıntısız çalışıyor mu doğrulamak. Gerçek bekleme YOK.
 *
 * Yapı:
 *   PART A — Reconnect backoff sözleşmesi.
 *     obdService'in _scheduleReconnect / _scheduleDeepReconnect fonksiyonları
 *     PRIVATE'tir ve yalnız native handshake akışından tetiklenir (statusHandle
 *     callback → _removeNativeHandles → _scheduleReconnect). Dışarıdan sağlıklı
 *     sürmek için tam native handshake gerekir (kırılgan). Bunun yerine kontrol
 *     akışı, T7 felsefesiyle GERÇEK obdRetryPolicy primitifleri (getReconnectDelay
 *     / shouldAttemptReconnect / DEEP_RECONNECT_INTERVAL_MS / MAX_RECONNECT_ATTEMPTS)
 *     ile sürülen SADIK bir modelle 8h boyunca ölçülür. Model, obdService.ts
 *     436-548 satırlarındaki akışın birebir karşılığıdır (kopya değil — gerçek
 *     policy çağrılır; sızıntı/tekillik GERÇEK leakHarness timer spy ile ölçülür).
 *
 *   PART B — Gerçek obdService yaşam döngüsü.
 *     Kanıtlanmış web/mock mock seti (cleanup.obd.test.ts ile aynı) ile GERÇEK
 *     startOBD/stopOBD/updateOBDData çalıştırılır: stopOBD timer temizliği ve
 *     NO_DATA state tutarlılığı production kodu üzerinden doğrulanır.
 *
 * Kurallar (CLAUDE.md): production/native hot-path'e DOKUNULMAZ; OBD gerçek
 * bağlantı davranışı değiştirilmez; yalnız src/__tests__ altında.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── PART B için mock'lar (cleanup.obd.test.ts ile aynı izole set) ──
   PART A yalnız obdRetryPolicy (saf, mock'lanmaz) + soakHarness kullanır;
   bu mock'lar PART A'yı etkilemez. */
vi.hoisted(() => { process.env['VITE_ENABLE_OBD_MOCK'] = 'true'; });

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:                vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:             vi.fn().mockResolvedValue(undefined),
    disconnectOBD:          vi.fn().mockResolvedValue(undefined),
    addListener:            vi.fn().mockResolvedValue({ remove: vi.fn() }),
    startBackgroundService: vi.fn().mockResolvedValue(undefined),
    stopBackgroundService:  vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 50, obdListenerDebounce: 0, enableRecommendations: false, recCooldownMs: 999_999 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));
vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync:  vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot:     vi.fn(),
  flushCanSnapshotNow:     vi.fn(),
  stopCanSnapshot:         vi.fn(),
}));
vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame:    vi.fn(() => null),
  hasBinaryFrame:         vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));
vi.mock('../platform/rafSmoother', () => ({
  useRafSmoothed: vi.fn((val: number) => val),
}));
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode:   vi.fn(() => 'BALANCED'),
    // obdPollingMs 60_000: 8h soak'ta tick sayısı 480'de kalsın (50ms olsaydı 576k tick).
    getConfig: vi.fn(() => ({ obdPollingMs: 60_000, gpsUpdateMs: 200, uiFpsTarget: 60, enableBlur: false, enableAnimations: false, loggingLevel: 'silent' })),
    subscribe:     vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
  AdaptiveRuntimeManager: { getInstance: vi.fn() },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

/* ── Imports (mock'lardan sonra) ── */
import {
  getReconnectDelay,
  shouldAttemptReconnect,
  MAX_RECONNECT_ATTEMPTS,
  DEEP_RECONNECT_INTERVAL_MS,
} from '../platform/obdRetryPolicy';
import { startOBD, stopOBD, onOBDData, updateOBDData } from '../platform/obdService';
import type { OBDConnectionState, OBDData } from '../platform/obdService';
import {
  startVirtualClock,
  installSoakProbes,
  runSoak,
  seriesOf,
  peak,
  MINUTES,
  HOURS,
} from './sim/soakHarness';

/* ═══════════════════════════════════════════════════════════════════════════
   PART A — Reconnect backoff sözleşmesi (GERÇEK obdRetryPolicy ile)
═══════════════════════════════════════════════════════════════════════════ */

/**
 * obdService _scheduleReconnect / _scheduleDeepReconnect kontrol akışının SADIK
 * modeli. Akıştaki tüm kararlar GERÇEK obdRetryPolicy fonksiyonlarıyla verilir;
 * tek bir _reconnectTimer kullanılır (her zaman önce clearTimeout). Üstel tur
 * tükenince DEEP_RECONNECT_INTERVAL_MS'de bir yeni tur (Always-On).
 */
function makeReconnectModel(connect: () => boolean) {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduledDelays: number[] = [];
  let deepRounds = 0;

  const clear = (): void => { if (timer) { clearTimeout(timer); timer = null; } };

  function fireAttempt(): void {
    timer = null;
    if (connect()) { attempts = 0; return; } // başarı → sayaç reset, yeni timer yok
    schedule();                              // başarısız → bir sonraki deneme
  }

  function schedule(): void {
    if (!shouldAttemptReconnect(attempts)) {
      // Üstel tur tükendi → Always-On deep-reconnect (tek timer)
      attempts = 0;
      deepRounds++;
      clear();
      timer = setTimeout(fireAttempt, DEEP_RECONNECT_INTERVAL_MS);
      return;
    }
    const delayMs = getReconnectDelay(attempts);
    scheduledDelays.push(delayMs);
    attempts++;
    clear();                                 // tek-timer garantisi
    timer = setTimeout(fireAttempt, delayMs);
  }

  return {
    drop:    schedule,                       // bağlantı koptu → zinciri başlat/sürdür
    attempts:        () => attempts,
    scheduledDelays: () => scheduledDelays.slice(),
    deepRounds:      () => deepRounds,
    hasTimer:        () => timer !== null,
    stop:    (): void => { clear(); attempts = 0; },
  };
}

describe('T4 — OBD backoff sözleşmesi (PART A: gerçek obdRetryPolicy)', () => {
  it('backoff dizisi 2/4/8/16/32s ve 32s üstüne taşmaz', () => {
    const seq: number[] = [];
    for (let a = 0; a < MAX_RECONNECT_ATTEMPTS; a++) seq.push(getReconnectDelay(a));

    expect(seq).toEqual([2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(Math.max(...seq)).toBe(32_000);            // üst sınır 32s
    // MAX'a ulaşınca deneme durur → 64s ASLA planlanmaz
    expect(shouldAttemptReconnect(MAX_RECONNECT_ATTEMPTS)).toBe(false);
  });

  it('tek kopma zinciri gerçek backoff dizisini üretir, sonra deep-loop\'a girer', async () => {
    const clock  = startVirtualClock();
    const probes = installSoakProbes();
    const m = makeReconnectModel(() => false); // bağlantı hep başarısız

    m.drop();                       // attempt0 → 2s timer
    await clock.advance(2_000);     // fail → attempt1 (4s)
    await clock.advance(4_000);     // fail → attempt2 (8s)
    await clock.advance(8_000);     // fail → attempt3 (16s)
    await clock.advance(16_000);    // fail → attempt4 (32s)
    await clock.advance(32_000);    // fail → tur tükendi → deep-loop

    const delays   = m.scheduledDelays();
    const deep     = m.deepRounds();
    const timers   = probes.timers.activeTimeouts();

    probes.restore();
    clock.restore();

    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(deep).toBe(1);          // tur tükendi → 1 deep round
    expect(timers).toBe(1);        // tek deep timer beklemede (sızıntı yok)
  });

  it('8h boyunca reconnect timer TEKIL kalır, attempt sınırlı (sızıntı yok)', async () => {
    const m = makeReconnectModel(() => false);

    const result = await runSoak({
      durationMs: HOURS(8),
      stepMs:     MINUTES(1),
      onStep: ({ index }) => { if (index === 1) m.drop(); }, // 1. dakikada kopma
      collect: () => ({
        recTimers: m.hasTimer() ? 1 : 0,
        attempts:  m.attempts(),
      }),
    });

    const recTimersPeak = peak(seriesOf(result, 'recTimers'));
    const attemptsPeak  = peak(seriesOf(result, 'attempts'));
    const timeoutsPeak  = peak(seriesOf(result, 'timeouts')); // global timer sayısı
    m.stop();
    result.teardown();

    expect(recTimersPeak).toBe(1);                          // her an ≤1 reconnect timer
    expect(timeoutsPeak).toBe(1);                           // global sızıntı yok
    expect(attemptsPeak).toBeLessThanOrEqual(MAX_RECONNECT_ATTEMPTS); // attempt kontrolsüz büyümez
  });

  it('başarılı bağlantı sonrası attempt sıfırlanır; yeni kopma 2s\'den başlar', async () => {
    const clock = startVirtualClock();
    let allowSuccess = false;
    const m = makeReconnectModel(() => allowSuccess);

    m.drop();                    // attempt0 (2s)
    await clock.advance(2_000);  // fail → attempt1 (4s)
    await clock.advance(4_000);  // fail → attempt2 (8s)
    const attemptsBefore = m.attempts();

    allowSuccess = true;
    await clock.advance(8_000);  // fire → başarı → attempts=0
    const attemptsAfter = m.attempts();
    const timerAfter    = m.hasTimer();

    const before = m.scheduledDelays().length;
    m.drop();                    // yeni kopma
    const firstNewDelay = m.scheduledDelays()[before];

    clock.restore();

    expect(attemptsBefore).toBe(3);
    expect(attemptsAfter).toBe(0);     // başarı → sayaç reset
    expect(timerAfter).toBe(false);    // başarı → bekleyen timer yok
    expect(firstNewDelay).toBe(2_000); // yeni kopma tekrar düşük backoff'tan başlar
  });

  it('8h boyunca bağlantı yoksa DEEP_RECONNECT döngüsü çalışır, sızıntı yok', async () => {
    const m = makeReconnectModel(() => false);

    const result = await runSoak({
      durationMs: HOURS(8),
      stepMs:     MINUTES(5),
      onStep: ({ index }) => { if (index === 1) m.drop(); },
      collect: () => ({
        deep:      m.deepRounds(),
        recTimers: m.hasTimer() ? 1 : 0,
      }),
    });

    const deepFinal     = result.last.custom.deep;
    const recTimersPeak = peak(seriesOf(result, 'recTimers'));
    const timeoutsPeak  = peak(seriesOf(result, 'timeouts'));
    m.stop();
    result.teardown();

    // 8h içinde her ~5dk+62s'de bir deep round → onlarca tur (kesin sayı drift'e bağlı)
    expect(deepFinal).toBeGreaterThanOrEqual(40);
    expect(recTimersPeak).toBe(1);   // deep-loop tek timer kullanır
    expect(timeoutsPeak).toBe(1);    // sızıntı yok
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   PART B — Gerçek obdService yaşam döngüsü (web/mock modu)
═══════════════════════════════════════════════════════════════════════════ */

const VALID_STATES: readonly OBDConnectionState[] = [
  'idle', 'scanning', 'connecting', 'initializing', 'connected', 'reconnecting', 'error',
];

// Sanal saat epoch'u GERÇEK duvar-saatinin ilerisinde (2030). Sebep: beforeEach
// stopOBD() gerçek-zaman altında _lastNotifyTime'ı set eder; fake saat geçmişe
// kurulursa _notify debounce'u negatif Δ görüp bildirimi bloke eder. İleri epoch
// fake now > gerçek _lastNotifyTime garantiler → bildirimler akar.
const SOAK_EPOCH = Date.UTC(2030, 0, 1);

describe('T4 — OBD gerçek servis yaşam döngüsü (PART B)', () => {
  beforeEach(() => { stopOBD(); });
  afterEach(() => { vi.useRealTimers(); stopOBD(); vi.clearAllMocks(); });

  it('8h mock çalışma sonrası stopOBD tüm timer\'ları temizler (singleton + cleanup)', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    onOBDData(() => {});

    startOBD(); // web/mock → _startMock interval (senkron)
    const running = probes.timers.activeIntervals();

    await clock.advance(HOURS(8)); // mock 8h aksın
    const afterSoak = probes.timers.activeIntervals();

    stopOBD();
    const afterStop = probes.timers.activeIntervals();

    probes.restore();
    clock.restore();

    expect(running).toBeGreaterThanOrEqual(1);  // mock interval kuruldu
    expect(afterSoak).toBe(running);            // 8h sonra interval sayısı SABIT (singleton)
    expect(afterStop).toBe(0);                  // stopOBD → sıfır timer kalıntısı
  });

  it('çift stopOBD idempotent — reconnect/stale/dataGate/mock timer kalmaz', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();
    onOBDData(() => {});

    startOBD();
    await clock.advance(MINUTES(30));
    stopOBD();
    stopOBD(); // idempotent — çift stop güvenli

    const leftover = probes.timers.activeIntervals();
    probes.restore();
    clock.restore();

    expect(leftover).toBe(0);
  });

  it('NO_DATA: veri sustuğunda state kilitlenmez, tutarlı kalır, temiz kapanır', async () => {
    const clock  = startVirtualClock(SOAK_EPOCH);
    const probes = installSoakProbes();

    let last: OBDData | null = null;
    onOBDData((d) => { last = d; });

    // Gerçek veri paketi → connected/real (startOBD mock akışına bağlı kalmadan).
    updateOBDData({ speed: 80, rpm: 2500 });
    const afterData = last?.connectionState ?? null;

    await clock.advance(HOURS(8)); // 8h: yeni gerçek veri yok (çalışan timer yok)
    const afterSilence = last?.connectionState ?? null;

    stopOBD();
    const afterStop = last?.connectionState ?? null;
    const leftover  = probes.timers.activeIntervals();

    // Ölç → restore → assert: bir assertion düşse bile fake-timer/spy sızmaz.
    probes.restore();
    clock.restore();

    expect(afterData).not.toBeNull();
    expect(VALID_STATES).toContain(afterData!);   // geçerli enum
    expect(afterSilence).toBe(afterData);          // 8h sessizlikte değişmedi (kilitlenmedi/bozulmadı)
    expect(afterStop).toBe('idle');                // servis kontrol edilebilir → temiz kapanış
    expect(leftover).toBe(0);                      // stop sonrası timer sızıntısı yok
  });
});
