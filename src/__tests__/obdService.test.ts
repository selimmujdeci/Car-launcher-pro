/**
 * obdService.test.ts — OBD servis state machine testleri (new API uyumlu).
 *
 * Test kapsamı:
 *  - Web (non-native) modda mock otomatik başlar (VITE_ENABLE_OBD_MOCK=true)
 *  - Native modda cihaz bulunamazsa mock'a düşer
 *  - connectOBD 30 s timeout → hata sonrası mock'a düşer
 *  - stopOBD tüm state'i sıfırlar
 *  - onOBDData listener cleanup
 *  - stopOBD mid-flight koruma (generation guard)
 *  - Çoklu listener eş zamanlı çalışır
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── MOCK_ENABLED: import.meta.env module-level sabit → import'lardan ÖNCE set et ── */
vi.hoisted(() => {
  // vi.hoisted içeriği tüm import'lardan önce çalışır.
  // obdService.ts'nin "const MOCK_ENABLED = import.meta.env['VITE_ENABLE_OBD_MOCK'] === 'true'"
  // satırı bu değeri module yüklenirken okur → hoisted ile garantilenir.
  process.env['VITE_ENABLE_OBD_MOCK'] = 'true';
});

/* ── Capacitor platform tespiti ─────────────────────────────── */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));

/* ── Native plugin mock ─────────────────────────────────────── */

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD:                vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD:             vi.fn().mockImplementation(() => new Promise(() => {})),
    disconnectOBD:          vi.fn().mockResolvedValue(undefined),
    addListener:            vi.fn().mockResolvedValue({ remove: vi.fn() }),
    startBackgroundService: vi.fn().mockResolvedValue(undefined),
    stopBackgroundService:  vi.fn().mockResolvedValue(undefined),
  },
}));

/* ── performanceMode mock ───────────────────────────────────── */

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({
    obdPollInterval:       50,   // hızlı test için kısa interval
    obdListenerDebounce:   0,
    enableRecommendations: false,
    recCooldownMs:         999_999,
  })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));

/* ── canSnapshotService mock ────────────────────────────────── */

vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync:  vi.fn(() => ({})),
  hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot:     vi.fn(),
  flushCanSnapshotNow:     vi.fn(),
  stopCanSnapshot:         vi.fn(),
}));

/* ── obdBinaryParser mock ───────────────────────────────────── */

vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame:    vi.fn(() => null),
  hasBinaryFrame:         vi.fn(() => false),
  clearAccumulatedBuffer: vi.fn(),
}));

/* ── rafSmoother mock ───────────────────────────────────────── */

vi.mock('../platform/rafSmoother', () => ({
  useRafSmoothed: vi.fn((val: number) => val),
}));

/* ── AdaptiveRuntimeManager mock ────────────────────────────── */
// BALANCED modda obdPollingMs=3000 → waitForOBDData(500) timeout atar.
// Test ortamında 50ms hızlı tick kullanılır.

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode:       vi.fn(() => 'BALANCED'),
    getConfig:     vi.fn(() => ({
      obdPollingMs:     50,
      gpsUpdateMs:      200,
      uiFpsTarget:      60,
      enableBlur:       false,
      enableAnimations: false,
      loggingLevel:     'silent',
    })),
    subscribe:     vi.fn(() => () => {}),
    reportFailure: vi.fn(),
  },
  AdaptiveRuntimeManager: { getInstance: vi.fn() },
}));

/* ── crashLogger mock ───────────────────────────────────────── */

vi.mock('../platform/crashLogger', () => ({
  logError: vi.fn(),
}));

/* ── Imports (mock'lardan sonra) ────────────────────────────── */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../platform/nativePlugin';
import {
  startOBD, stopOBD, onOBDData, getHandshakeDiagnostics,
  type OBDData,
} from '../platform/obdService';

/* ── Yardımcı: listener'dan koşullu veri bekle ──────────────── */

function waitForOBDData(
  timeoutMs = 500,
  predicate?: (d: OBDData) => boolean,
): Promise<OBDData> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitForOBDData timeout')), timeoutMs);
    const unsub = onOBDData((d) => {
      if (!predicate || predicate(d)) {
        clearTimeout(timer);
        unsub();
        resolve(d);
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   1. WEB MODU (non-native) — MOCK_ENABLED = true
═══════════════════════════════════════════════════════════════ */

describe('obdService — web modu (non-native)', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('startOBD → mock moda geçer, source=mock', async () => {
    startOBD();
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
    expect(data.connectionState).toBe('connected');
  });

  it('stopOBD sonrası source=none, connectionState=idle', async () => {
    startOBD();
    await waitForOBDData(500, (d) => d.source === 'mock');

    const afterStop = await new Promise<OBDData>((resolve) => {
      const unsub = onOBDData((d) => { unsub(); resolve(d); });
      stopOBD();
    });

    expect(afterStop.source).toBe('none');
    expect(afterStop.connectionState).toBe('idle');
  });

  it('startOBD idempotent — iki kez çağrılınca tek mock başlar', async () => {
    startOBD();
    startOBD(); // ikinci çağrı _running=true olduğu için atlanır
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
  });

  it('mock verisinde speed, rpm, engineTemp gerçekçi aralıklarda', async () => {
    startOBD();
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.speed).toBeGreaterThanOrEqual(0);
    expect(data.speed).toBeLessThanOrEqual(180);
    // ICE mock: rpm başlangıcı 1450, ±150 drift → test için geniş aralık
    expect(data.rpm).toBeGreaterThanOrEqual(0);
    expect(data.rpm).toBeLessThanOrEqual(8_000);
    expect(data.engineTemp).toBeGreaterThanOrEqual(70);
    expect(data.engineTemp).toBeLessThanOrEqual(110);
    expect(data.fuelLevel).toBeGreaterThanOrEqual(0);
    expect(data.fuelLevel).toBeLessThanOrEqual(100);
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. NATIVE MODU — CİHAZ BULUNAMADI
═══════════════════════════════════════════════════════════════ */

describe('obdService — native modu, cihaz bulunamadı', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CarLauncher.scanOBD).mockResolvedValue({ devices: [] });
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
  });

  it('eşleşmiş BT cihazı yok → native modda error state (mock başlamaz)', async () => {
    startOBD();
    // native: scanOBD → boş liste → throw → error state.
    // Otomotiv dürüstlüğü: native platformda hata sonrası sahte veri gösterilmez.
    const data = await waitForOBDData(500, (d) => d.connectionState === 'error');
    expect(data.connectionState).toBe('error');
    expect(data.source).toBe('none');
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. NATIVE MODU — connectOBD ZAMAN AŞIMI
═══════════════════════════════════════════════════════════════ */

describe('obdService — native modu, connectOBD zaman aşımı', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CarLauncher.scanOBD).mockResolvedValue({
      devices: [{ name: 'ELM327 BT', address: '00:11:22:33:44:55' }],
    });
    // connectOBD asla resolve etmez → 30 s timeout tetiklenir
    vi.mocked(CarLauncher.connectOBD).mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('çift transport 30 s + 30 s timeout sonrası hata durumuna geçer, native modda error kalır', async () => {
    const states: string[] = [];
    const unsub = onOBDData((d) => { states.push(d.connectionState); });

    // PERF 2026-06-11 sözleşmesi: otomatik tarama yok → adresle direct-connect
    startOBD('00:11:22:33:44:55');

    // addListener Promise'lerini çöz (mikro-task flush)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Yeni davranış (BLE çift-transport fallback): primary transport CONNECT_TIMEOUT_MS
    // (30 s) içinde bağlanamazsa OTOMATİK fallback transport denenir → ikinci 30 s.
    // Error state'e geçmek için TOPLAM iki timeout (2 × 30 s) ilerletilmeli.

    // 1. Faz — primary transport 30 s timeout → reject → catch: disconnectOBD + 'connecting'
    await vi.advanceTimersByTimeAsync(30_500);
    // catch zincirini temizle (disconnectOBD await, _merge 'connecting', fallback timer kur)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // 2. Faz — fallback transport 30 s timeout → reject → _startNative throw → error
    await vi.advanceTimersByTimeAsync(30_500);
    // dış catch zincirini temizle (logError, _removeNativeHandles, _merge 'error')
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    unsub();

    // Fallback gerçekten denendi: connectOBD iki kez, iki FARKLI transport ile çağrıldı.
    const transports = vi.mocked(CarLauncher.connectOBD).mock.calls
      .map(([arg]) => (arg as { transport?: string }).transport);
    expect(transports.length).toBe(2);
    expect(transports[0]).not.toBe(transports[1]);

    // Otomotiv dürüstlüğü: native platformda hata sonrası sahte veri gösterilmez.
    expect(states).toContain('error');
    expect(states[states.length - 1]).toBe('error');
  });
});

/* ═══════════════════════════════════════════════════════════════
   3b. ARAÇ-DEĞİŞİMİ KURTARMASI — öğrenilmiş protokol ısrarlı timeout → sıfırla
   (2026-07-14 saha: dongle Doblo→Trafic; önbellek protokol '7' yanlış → sonsuz
   "Bağlanıyor…". Fix: 2 ardışık timeout sonrası obd:lastProtocol temizlenir → ATSP0.)
═══════════════════════════════════════════════════════════════ */

describe('obdService — araç-değişimi: yanlış öğrenilmiş protokol kendini onarır', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CarLauncher.scanOBD).mockResolvedValue({
      devices: [{ name: 'ELM327 BT', address: '00:11:22:33:44:55' }],
    });
    // Yanlış protokol → araç yanıt vermez → connectOBD asla resolve etmez (timeout).
    vi.mocked(CarLauncher.connectOBD).mockImplementation(() => new Promise(() => {}));
    // Önceki araçtan (Doblo) öğrenilmiş protokol '7' (CAN 29-bit) önbellekte.
    localStorage.setItem('obd:lastProtocol', '7');
  });
  afterEach(() => {
    stopOBD();
    localStorage.removeItem('obd:lastProtocol');
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('ilk denemeler protokol=7 zorlar; ısrarlı timeout sonrası protokol SIFIRLANIR', async () => {
    startOBD('00:11:22:33:44:55');
    for (let i = 0; i < 6; i++) await Promise.resolve();

    // İlk connectOBD çağrısı önbellek protokolünü (7) zorlamalı.
    const firstProtocol = (vi.mocked(CarLauncher.connectOBD).mock.calls[0]?.[0] as { protocol?: string })?.protocol;
    expect(firstProtocol).toBe('7');

    // Bir connect denemesini sonuna kadar sür (primary + fallback timeout, fazlı flush).
    const driveOneAttempt = async () => {
      await vi.advanceTimersByTimeAsync(31_000);            // primary timeout
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(31_000);            // fallback timeout
      for (let i = 0; i < 6; i++) await Promise.resolve();
    };

    // Kullanıcı/modal retry döngüsü = stop + start (sahadaki "YENİDEN TARA"/oto-retry).
    // Her deneme öğrenilmiş '7'yi zorlayıp timeout olur; 2 ardışık timeout eşiğinde
    // araç-değişimi kurtarması obd:lastProtocol'ü temizler → sonraki bağlantı ATSP0.
    await driveOneAttempt();                 // deneme 1 → timeout sayacı 1
    stopOBD();
    for (let i = 0; i < 3; i++) await Promise.resolve();
    startOBD('00:11:22:33:44:55');           // retry
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await driveOneAttempt();                 // deneme 2 → eşik → protokol sıfırlanır

    // KİLİT: önbellek protokol temizlendi → bir sonraki bağlantı ATSP0-otomatik'e düşer.
    expect(localStorage.getItem('obd:lastProtocol')).toBeNull();

    // PR-1a KİLİT: handshake yaşam-döngüsü kanıtı GERÇEK akıştan yakalandı — root-cause
    // motoru "protokol uyuşmazlığı"nı bu kanıtla üretebilir (uydurma değil).
    const hd = getHandshakeDiagnostics();
    expect(hd.outcome).toBe('fail');
    expect(hd.protocolTried).toBe('7');          // önbellek protokolü zorlandı
    expect(hd.protocolActive).toBeNull();        // ATDPN yanıtsız → uyuşmazlık sinyali
    expect(hd.timeoutStage).toBe('connect');
    expect(hd.reconnectReason).toBe('timeout');
    expect(hd.reconnectHistory.some((r) => r.reason === 'timeout')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. onOBDData LİSTENER YÖNETİMİ
═══════════════════════════════════════════════════════════════ */

describe('obdService — onOBDData listener yönetimi', () => {
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('cleanup fonksiyonu listener kaldırır — kaldırılan listener tetiklenmez', async () => {
    vi.useRealTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

    let callCount = 0;
    const unsub = onOBDData(() => { callCount++; });
    unsub(); // hemen kaldır

    startOBD();

    // Mock tick 50 ms sonra ateşlenir — listener kaldırıldığı için çağrılmamalı
    await new Promise((r) => setTimeout(r, 100));

    expect(callCount).toBe(0);
    stopOBD();
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. stopOBD MID-FLIGHT KORUMA (generation guard)
═══════════════════════════════════════════════════════════════ */

describe('obdService — stopOBD mid-flight koruma (generation guard)', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    // PERF 2026-06-11: otomatik tarama yok → askı noktası artık connectOBD.
    // connectOBD asla resolve etmez → _startNative() bağlantı aşamasında askıda
    vi.mocked(CarLauncher.connectOBD).mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
  });

  it('stopOBD() mid-flight sonrası state connected olmaz', async () => {
    const states: string[] = [];
    const unsub = onOBDData((d) => states.push(d.connectionState));

    startOBD('00:11:22:33:44:55'); // _startNative() başlar, connectOBD'de askıda
    await Promise.resolve();
    await Promise.resolve();
    stopOBD(); // generation++ → in-flight call geçersiz

    await Promise.resolve();
    await Promise.resolve();

    unsub();
    // stopOBD sonrası son state 'idle' olmalı, asla 'connected' olmamalı
    const last = states[states.length - 1];
    expect(last).toBe('idle');
    expect(states).not.toContain('connected');
  });

  it('startOBD idempotent — ikinci çağrı yeni native döngü başlatmaz', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    startOBD();
    startOBD(); // _running=true → atlanır
    const data = await waitForOBDData(500, (d) => d.source === 'mock');
    expect(data.source).toBe('mock');
    stopOBD();
  });
});

/* ═══════════════════════════════════════════════════════════════
   6. ÇOKLU LİSTENER
═══════════════════════════════════════════════════════════════ */

describe('obdService — çoklu listener', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('birden fazla listener eş zamanlı çalışır', async () => {
    const received: number[] = [];

    startOBD();
    // Mock tick 50ms sonra gelir — listener'ları şimdi kayıt et
    const u1 = onOBDData((d) => { if (d.source === 'mock') received.push(1); });
    const u2 = onOBDData((d) => { if (d.source === 'mock') received.push(2); });

    // İki listener de mock tick'i alana kadar bekle
    await waitForOBDData(500, (d) => d.source === 'mock');
    // Biraz daha bekle — her iki listener'ın da işlemesi için
    await new Promise((r) => setTimeout(r, 60));

    u1();
    u2();

    expect(received).toContain(1);
    expect(received).toContain(2);
  });
});

/* ═══════════════════════════════════════════════════════════════
   7. NATIVE MODU — RECONNECT BACKOFF
═══════════════════════════════════════════════════════════════ */

describe('obdService — native modu, reconnect backoff', () => {
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('disconnect eventi → reconnecting state', async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    // obdStatus ve obdData listener'larını yakala
    let statusCallback: ((e: unknown) => void) | null = null;
    let dataCallback:   ((e: unknown) => void) | null = null;
    vi.mocked(CarLauncher.addListener).mockImplementation(
      async (event: string, cb: (e: unknown) => void) => {
        if (event === 'obdStatus') statusCallback = cb;
        if (event === 'obdData')   dataCallback   = cb;
        return { remove: vi.fn() };
      },
    );

    // connectOBD başarıyla tamamlanır
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);

    const states: string[] = [];
    const unsub = onOBDData((d) => states.push(d.connectionState));

    // PERF 2026-06-11 sözleşmesi: otomatik tarama yok → adresle direct-connect
    startOBD('AA:BB:CC:DD:EE:FF');

    // addListener×2 → connectOBD → 'initializing' (2s warmup başlar)
    for (let i = 0; i < 6; i++) await Promise.resolve();

    // Fix 3 uyumlu: 2s ısınma deadline'ını geç, ardından veri kapısını aç
    await vi.advanceTimersByTimeAsync(2_001);
    // warmup continuation: _warmupActive=false, handshake skip, _startDataValidationGate
    for (let i = 0; i < 4; i++) await Promise.resolve();

    // Data gate: geçerli speed + RPM ile 'connected' state'e geç
    dataCallback?.({ speed: 50, rpm: 1_500 });
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(states).toContain('connected');

    // obdStatus eventi → _removeNativeHandles().then(_scheduleReconnect)
    statusCallback?.({});
    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(states).toContain('reconnecting');

    // temizlik
    await vi.advanceTimersByTimeAsync(500);
    unsub();
  });
});

/* ═══════════════════════════════════════════════════════════════
   8. PATCH 1 — obdStatus reason disiplini (reconnect fırtınası fix)
═══════════════════════════════════════════════════════════════ */

describe('obdService — obdStatus reason disiplini', () => {
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("reason='connect_failed'/'user_disconnect' reconnect TETİKLEMEZ (fallback disconnectOBD yankısı)", async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    let statusCallback: ((e: unknown) => void) | null = null;
    let dataCallback:   ((e: unknown) => void) | null = null;
    vi.mocked(CarLauncher.addListener).mockImplementation(
      async (event: string, cb: (e: unknown) => void) => {
        if (event === 'obdStatus') statusCallback = cb;
        if (event === 'obdData')   dataCallback   = cb;
        return { remove: vi.fn() };
      },
    );

    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);

    const states: string[] = [];
    const unsub = onOBDData((d) => states.push(d.connectionState));

    startOBD('AA:BB:CC:DD:EE:FF');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_001);
    for (let i = 0; i < 4; i++) await Promise.resolve();

    // Data gate geçilir — 'connected' state'e ulaşılır.
    dataCallback?.({ speed: 50, rpm: 1_500 });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(states).toContain('connected');

    const connectCallsBefore = vi.mocked(CarLauncher.connectOBD).mock.calls.length;

    // Gerçek fallback yankısı: obdService._startNative() transport-fallback yolunda
    // KENDİ disconnectOBD() çağrısını yapar → native bunu reason='user_disconnect' ile
    // yayınlar. Bu event bu (aktif/connected) generation'a da düşebilir — reconnect
    // TETİKLEMEMELİ (BC8 kararsız döngü kök nedeni).
    statusCallback?.({ state: 'disconnected', reason: 'user_disconnect' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(states[states.length - 1]).toBe('connected'); // hâlâ connected — reconnect YOK

    // connect_failed de aynı şekilde yok sayılır (bağlantı DENEMESİ başarısızlığı, ayrı zincirde ele alınır).
    statusCallback?.({ state: 'error', reason: 'connect_failed' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(states[states.length - 1]).toBe('connected');

    // Hiçbir ek connectOBD çağrısı yapılmadı — paralel reconnect başlamadı.
    expect(vi.mocked(CarLauncher.connectOBD).mock.calls.length).toBe(connectCallsBefore);

    unsub();
  });

  it("reason='link_lost' reconnect'i BEKLENDİĞİ gibi tetikler", async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    let statusCallback: ((e: unknown) => void) | null = null;
    let dataCallback:   ((e: unknown) => void) | null = null;
    vi.mocked(CarLauncher.addListener).mockImplementation(
      async (event: string, cb: (e: unknown) => void) => {
        if (event === 'obdStatus') statusCallback = cb;
        if (event === 'obdData')   dataCallback   = cb;
        return { remove: vi.fn() };
      },
    );
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);

    const states: string[] = [];
    const unsub = onOBDData((d) => states.push(d.connectionState));

    startOBD('AA:BB:CC:DD:EE:FF');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_001);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    dataCallback?.({ speed: 50, rpm: 1_500 });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(states).toContain('connected');

    statusCallback?.({ state: 'disconnected', reason: 'link_lost' });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(states).toContain('reconnecting');

    await vi.advanceTimersByTimeAsync(500);
    unsub();
  });
});

/* ═══════════════════════════════════════════════════════════════
   9. PATCH 3 — protokol öğrenme (ElmInitSequencer ATDPN persist +
      PROTOCOL_CYCLE yalnız UNABLE_TO_CONNECT sınıfında ilerler)

   NOT: bu dosya obdStorage'ı MOCK'LAMIYOR (gerçek localStorage kullanılır) —
   bu yüzden her test öncesi/sonrası 'obd:lastProtocol' anahtarı temizlenir.
   Bu describe dosyanın SON bloğu; _protocolCycleIndex (yalnız bellek-içi,
   dışa açık reset'i yok) burada artırılsa bile sonraki bir test dosyasını
   ETKİLEMEZ (her test dosyası kendi modül örneğini yükler).
═══════════════════════════════════════════════════════════════ */

describe('obdService — Patch 3: protokol öğrenme', () => {
  beforeEach(() => {
    localStorage.removeItem('obd:lastProtocol');
  });
  afterEach(() => {
    stopOBD();
    localStorage.removeItem('obd:lastProtocol');
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('öğrenilmiş protokol varsa ilk denemede ATSP<n> ile ZORLANIR (arama yok)', async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem('obd:lastProtocol', '6');
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue(undefined);

    startOBD('AA:BB:CC:DD:EE:02');
    for (let i = 0; i < 8; i++) await Promise.resolve();

    const firstCall = vi.mocked(CarLauncher.connectOBD).mock.calls[0]?.[0] as { protocol?: string };
    expect(firstCall.protocol).toBe('6');
  });

  it('bağlantı başarılı + native ATDPN protokol döndürürse persist edilir', async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CarLauncher.connectOBD).mockResolvedValue({ protocol: '5' });

    startOBD('AA:BB:CC:DD:EE:03');
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(localStorage.getItem('obd:lastProtocol')).toBe('5');
  });

  it("OBD_UNABLE_TO_CONNECT hatası PROTOCOL_CYCLE'ı ilerletir; diğer hatalar İLERLETMEZ", async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    const unableErr  = Object.assign(new Error('ELM327: UNABLE TO CONNECT'), { code: 'OBD_UNABLE_TO_CONNECT' });
    const genericErr = new Error('RFCOMM soket hatası'); // code YOK — BT/soket sınıfı hata

    // 1. deneme: öğrenilmiş protokol yok → auto (undefined). Her iki transport da
    // UNABLE_TO_CONNECT ile reddedilir → _protocolCycleIndex 0'dan 1'e çıkar.
    vi.mocked(CarLauncher.connectOBD).mockRejectedValue(unableErr);
    startOBD('AA:BB:CC:DD:EE:04');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const firstCall = vi.mocked(CarLauncher.connectOBD).mock.calls[0]?.[0] as { protocol?: string };
    expect(firstCall.protocol).toBeUndefined();

    // 2. deneme (manuel retry — aynı adres), bu kez GENERİK hata (code YOK):
    // _protocolCycleIndex hâlâ 1 → PROTOCOL_CYCLE[1] = '6' zorlanmalı, VE bu generik
    // hata döngüyü İLERLETMEMELİ (BT/soket/timeout protokol tahminini terk ettirmez).
    vi.mocked(CarLauncher.connectOBD).mockClear();
    vi.mocked(CarLauncher.connectOBD).mockRejectedValue(genericErr);
    startOBD('AA:BB:CC:DD:EE:04');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const secondCall = vi.mocked(CarLauncher.connectOBD).mock.calls[0]?.[0] as { protocol?: string };
    expect(secondCall.protocol).toBe('6');

    // 3. deneme: yine GENERİK hata — index hâlâ 1 ise protokol yine '6' olmalı
    // (art arda iki generik hata döngüyü HİÇ ilerletmemiş olmalı).
    vi.mocked(CarLauncher.connectOBD).mockClear();
    startOBD('AA:BB:CC:DD:EE:04');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const thirdCall = vi.mocked(CarLauncher.connectOBD).mock.calls[0]?.[0] as { protocol?: string };
    expect(thirdCall.protocol).toBe('6');
  });
});
