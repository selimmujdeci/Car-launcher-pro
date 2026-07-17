/**
 * obdForegroundResume.test.ts — Foreground auto-resume (appStateChange).
 *
 * SORUN: uygulama arka plandayken Android JS timer'larını kısar/askıya alır ve BT linki
 * düşebilir. Öne gelindiğinde HİÇBİR ŞEY oturumu yeniden doğrulamıyordu → "bağlı görünüyor
 * ama veri akmıyor" → kullanıcı ayarlardan manuel bağlamak zorunda.
 *
 * TASARIM SÖZLEŞMESİ (bu testler kilitler):
 *   - KÖR CONNECT YOK: önce oturum sağlığı DÖRT AYRI eksende ölçülür
 *     (transportReady · sessionReady · pollingActive · dataFresh).
 *   - SAĞLIKLI OTURUMA DOKUNMA: hepsi yeşilse foreground olayı hiçbir şey yapmaz.
 *   - KANIT KAPISI: yalnız geçmişte GERÇEK ECU verisi akmış adaptöre otomatik dönülür.
 *   - Kullanıcı cihazı UNUTTUYSA (storage'da adres yok) otomatik bağlanma YOK.
 *   - Debounce + in-flight guard + cooldown → resume fırtınası yok.
 *   - IDEMPOTENT: tek manager / tek session / tek poll loop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(d: unknown) => void>>,
  appStateCbs: [] as Array<(s: { isActive: boolean }) => void>,
  appStateRemoveCalls: 0,
  addCalls: 0, removeCalls: 0, connectCalls: 0,
  connectShouldFail: false,
  verifiedAddresses: new Set<string>(),
  savedAddress: null as string | null,
}));

vi.mock('../platform/remoteLogService', () => ({ reportObdDiag: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));

/** @capacitor/app — appStateChange köprüsü. */
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (event: string, cb: (s: { isActive: boolean }) => void) => {
      if (event === 'appStateChange') M.appStateCbs.push(cb);
      return { remove: vi.fn(async () => { M.appStateRemoveCalls++; M.appStateCbs = M.appStateCbs.filter((f) => f !== cb); }) };
    }),
  },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn(async () => {
      M.connectCalls++;
      if (M.connectShouldFail) throw new Error('read failed, socket might closed');
    }),
    disconnectOBD: vi.fn(async () => {}),
    addListener: vi.fn(async (event: string, cb: (d: unknown) => void) => {
      M.addCalls++;
      (M.listeners[event] ??= []).push(cb);
      return { remove: vi.fn(async () => { M.removeCalls++; M.listeners[event] = (M.listeners[event] ?? []).filter((f) => f !== cb); }) };
    }),
  } as Record<string, unknown>,
}));

vi.mock('../platform/performanceMode', () => ({
  getConfig: vi.fn(() => ({ obdPollInterval: 1_000, obdListenerDebounce: 0 })),
  onPerformanceModeChange: vi.fn(() => () => {}),
}));
vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'PERFORMANCE'),
    getConfig: vi.fn(() => ({ obdPollingMs: 1_000 })),
    subscribe: vi.fn(() => () => {}), reportFailure: vi.fn(),
  },
}));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));
vi.mock('../platform/rafSmoother', () => ({ useRafSmoothed: vi.fn((v: number) => v) }));
vi.mock('../platform/obdBinaryParser', () => ({
  parseBinaryOBDFrame: vi.fn(() => null), hasBinaryFrame: vi.fn(() => false), clearAccumulatedBuffer: vi.fn(),
}));
vi.mock('../platform/canSnapshotService', () => ({
  hydrateCanSnapshotSync: vi.fn(() => ({})), hydrateCanSnapshotAsync: vi.fn(() => Promise.resolve({})),
  scheduleCanSnapshot: vi.fn(), flushCanSnapshotNow: vi.fn(), stopCanSnapshot: vi.fn(),
}));
vi.mock('../platform/safety/SafetyBrain', () => ({ isFeatureEnabled: vi.fn(() => true), recordFault: vi.fn() }));
vi.mock('../platform/obdStorage', () => ({
  loadObdAddress: vi.fn(() => M.savedAddress),
  saveObdAddress: vi.fn((a: string) => { M.savedAddress = a; }),
  clearObdAddress: vi.fn(() => { M.savedAddress = null; }),
  loadObdTransport: vi.fn(() => 'classic'), saveObdTransport: vi.fn(),
  loadObdTransportVerified: vi.fn(() => true), saveObdTransportVerified: vi.fn(),
  clearObdTransport: vi.fn(),
  loadObdProfileId: vi.fn(() => null), saveObdProfileId: vi.fn(),
  loadObdProtocol: vi.fn(() => '6'), saveObdProtocol: vi.fn(), clearObdProtocol: vi.fn(),
  loadObdFuelCalib: vi.fn(() => 1), saveObdFuelCalib: vi.fn(),
  isValidTcpAddress: vi.fn(() => false),
  markObdAddressVerified: vi.fn((a: string) => { M.verifiedAddresses.add(a.toUpperCase()); }),
  loadVerifiedObdAddresses: vi.fn(() => new Set(M.verifiedAddresses)),
}));
vi.mock('../platform/vehicleProfileService', () => ({ persistHandshakeVin: vi.fn() }));
vi.mock('../platform/obdDiagnosticRecorder', () => ({ recordDiag: vi.fn() }));
vi.mock('../platform/obdSanitizer', () => ({
  sanitizeNativeOBDPacket: vi.fn((d: Record<string, unknown>) => ({ patch: d, nextRpm: null })),
}));

const ADDR = '00:11:22:33:44:55';

type ObdSvc = typeof import('../platform/obdService');
let svc: ObdSvc | null = null;

async function boot(): Promise<ObdSvc> {
  vi.resetModules();
  const mod = await import('../platform/obdService');
  (await import('../platform/obdDiagEmitter'))._resetObdDiagEmitterForTest();
  svc = mod;
  return mod;
}

function feed(patch: Record<string, number>): void {
  for (const cb of M.listeners['obdData'] ?? []) cb(patch);
}

/** Uygulamayı öne getir + debounce penceresini geçir. */
async function goForeground(): Promise<void> {
  for (const cb of M.appStateCbs) cb({ isActive: true });
  await vi.advanceTimersByTimeAsync(1_000); // FOREGROUND_DEBOUNCE_MS = 600
  await vi.advanceTimersByTimeAsync(200);   // resume zinciri
}

/** Sağlıklı, veri akan bir oturum kurar. */
async function establishHealthy(mod: ObdSvc): Promise<void> {
  mod.startOBD();
  await vi.advanceTimersByTimeAsync(100);
  feed({ speed: 40, rpm: 1500 });
  await vi.advanceTimersByTimeAsync(20);
}

beforeEach(() => {
  M.listeners = {}; M.appStateCbs = []; M.appStateRemoveCalls = 0;
  M.addCalls = 0; M.removeCalls = 0; M.connectCalls = 0;
  M.connectShouldFail = false;
  M.verifiedAddresses = new Set([ADDR.toUpperCase()]); // KANITLI adaptör
  M.savedAddress = ADDR;
  vi.useFakeTimers();
});
afterEach(() => { svc?.stopOBD(); svc = null; vi.clearAllMocks(); vi.useRealTimers(); });

describe('oturum sağlığı — DÖRT AYRI eksen', () => {
  it('"Bluetooth bağlı" TEK BAŞINA READY değildir', async () => {
    const mod = await boot();
    M.connectShouldFail = false;
    mod.startOBD();
    await vi.advanceTimersByTimeAsync(100); // connect OK — ama ECU verisi YOK

    const h = mod.getObdSessionHealth();
    expect(h.transportReady).toBe(false); // link kanıtı yok (paket gelmedi)
    expect(h.sessionReady).toBe(false);   // veri kapısı geçilmedi
    expect(h.dataFresh).toBe(false);
    expect(h.ready).toBe(false);          // ← READY DEĞİL
  });

  it('ilk gerçek ECU frame"i gelince dört eksen de yeşile döner', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    const h = mod.getObdSessionHealth();
    expect(h).toMatchObject({
      transportReady: true, sessionReady: true, pollingActive: true, dataFresh: true, ready: true,
    });
  });
});

describe('KABUL: sağlıklı bağlantıda foreground olayı reconnect ÜRETMEZ', () => {
  it('dört eksen yeşilken foreground hiçbir şey yapmaz (kör connect yok)', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    const before = M.connectCalls;

    await goForeground();

    expect(M.connectCalls).toBe(before);                 // DOKUNMADI
    expect(mod.getObdSessionHealth().ready).toBe(true);  // oturum bozulmadı
    expect((M.listeners['obdData'] ?? []).length).toBe(1);
  });

  it('art arda 5 foreground olayı sağlıklı oturumda tek connect bile üretmez', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    const before = M.connectCalls;
    for (let i = 0; i < 5; i++) await goForeground();
    expect(M.connectCalls).toBe(before);
  });
});

describe('KABUL: arka plandan dönünce veri otomatik başlar', () => {
  it('transport bağlı görünüp ECU verisi AKMIYORSA resume tetiklenir ve veri döner', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    const before = M.connectCalls;

    // Arka planda 1 saat: ECU sustu, link öldü — ama TS timer'ları da askıya alınmıştı,
    // bu yüzden watchdog hiçbir şey fark etmedi. Bunu dataFresh=false ile simüle ederiz.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mod.getObdSessionHealth().dataFresh).toBe(false);

    await goForeground();
    expect(M.connectCalls).toBeGreaterThan(before); // resume çalıştı

    feed({ speed: 50, rpm: 1700 });                 // yeni oturumdan veri
    await vi.advanceTimersByTimeAsync(20);
    expect(mod.getObdSessionHealth().dataFresh).toBe(true); // AYARLARA GİRMEDEN veri döndü
  });

  it('1 dakika arka plandan dönüşte de çalışır (kısa boşluk)', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    const before = M.connectCalls;

    await vi.advanceTimersByTimeAsync(60_000); // 1 dk arka plan
    await goForeground();

    expect(M.connectCalls).toBeGreaterThan(before);
    feed({ speed: 45, rpm: 1600 });
    await vi.advanceTimersByTimeAsync(20);
    expect(mod.getObdSessionHealth().ready).toBe(true);
  });
});

describe('IDEMPOTENT — tek manager / tek session / tek poll loop', () => {
  it('resume sonrası TEK data + TEK status dinleyicisi kalır', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    await vi.advanceTimersByTimeAsync(60_000);
    await goForeground();
    feed({ speed: 50, rpm: 1700 });
    await vi.advanceTimersByTimeAsync(20);

    expect((M.listeners['obdData'] ?? []).length).toBe(1);
    expect((M.listeners['obdStatus'] ?? []).length).toBe(1);
    expect(M.addCalls - M.removeCalls).toBe(2); // yalnız yeni oturumun 2 handle'ı
  });

  it('ESKİ oturumun event"i reddedilir (sessionId guard)', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    const staleCb = (M.listeners['obdData'] ?? [])[0]!;
    await vi.advanceTimersByTimeAsync(60_000);
    await goForeground();
    feed({ speed: 50, rpm: 1700 });
    await vi.advanceTimersByTimeAsync(20);
    const beforeGhost = mod.getOBDDataSnapshot().lastSeenMs;

    staleCb({ speed: 999, rpm: 9999 }); // hayalet paket
    await vi.advanceTimersByTimeAsync(20);
    expect(mod.getOBDDataSnapshot().lastSeenMs).toBe(beforeGhost);
  });
});

describe('KÖR CONNECT YOK — debounce / cooldown / kanıt kapısı', () => {
  it('DEBOUNCE: aynı geçişte 3 olay TEK resume üretir', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    await vi.advanceTimersByTimeAsync(60_000);
    const before = M.connectCalls;

    // Debounce penceresi İÇİNDE üç olay.
    for (const cb of M.appStateCbs) cb({ isActive: true });
    for (const cb of M.appStateCbs) cb({ isActive: true });
    for (const cb of M.appStateCbs) cb({ isActive: true });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(200);

    expect(M.connectCalls - before).toBeLessThanOrEqual(1);
  });

  it('COOLDOWN: ikinci foreground penceresi hemen yeni resume ÜRETMEZ', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    await vi.advanceTimersByTimeAsync(60_000);

    await goForeground();
    const afterFirst = M.connectCalls;
    await goForeground(); // cooldown içinde (30s)
    expect(M.connectCalls).toBe(afterFirst);
  });

  it('KANITSIZ adrese otomatik bağlanma YOK (hiç bağlanamamış + defterde yok)', async () => {
    // Kanıt İKİ kaynaktan gelir: (a) bu oturumda bağlandı (_addressConnectedOnce),
    // (b) kalıcı defterde (geçmişte VERİ aktı). İkisi de yoksa otomatik dönüş YASAK —
    // kullanıcı yanlış cihaz seçmiş veya ortada gerçek cihaz yok olabilir.
    M.verifiedAddresses = new Set(); // defter BOŞ
    M.connectShouldFail = true;      // bu oturumda da HİÇ bağlanamıyor
    const mod = await boot();
    mod.startOBD();
    await vi.advanceTimersByTimeAsync(100);
    const before = M.connectCalls;
    expect(before).toBeGreaterThan(0); // bir kez denendi

    await goForeground();
    expect(M.connectCalls).toBe(before); // dokunmadı — kör connect YOK
  });

  it('bu oturumda bağlanmış adres (defterde olmasa da) kanıtlı sayılır — resume çalışır', async () => {
    // `_addressConnectedOnce` = "RFCOMM/GATT+init başarılı" → adaptör GERÇEK, yokluğu
    // geçici. Defterde olmaması yalnız "henüz ECU verisi akmadı" demek (ör. kontak kapalı).
    M.verifiedAddresses = new Set();
    const mod = await boot();
    await establishHealthy(mod);           // connect başarılı → _addressConnectedOnce=true
    await vi.advanceTimersByTimeAsync(60_000);
    const before = M.connectCalls;

    await goForeground();
    expect(M.connectCalls).toBeGreaterThan(before);
  });

  it('KULLANICI CİHAZI UNUTTUYSA otomatik bağlanma YOK (kullanıcı iradesi kazanır)', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    await vi.advanceTimersByTimeAsync(60_000);
    M.savedAddress = null;  // "Cihazı unut"
    const before = M.connectCalls;

    await goForeground();
    expect(M.connectCalls).toBe(before);
  });

  it('sürmekte olan reconnect varken foreground KARIŞMAZ (çift motor yok)', async () => {
    M.connectShouldFail = true;
    const mod = await boot();
    mod.startOBD();
    await vi.advanceTimersByTimeAsync(100); // ilk connect düştü → merdiven kuruldu
    const before = M.connectCalls;

    await goForeground();
    // Merdiven zaten çalışıyor → foreground ek tur AÇMAZ.
    expect(M.connectCalls).toBe(before);
  });
});

describe('adres tazeliği + zero-leak', () => {
  it('resume adresi STORAGE"dan yeniden okur (modül-yükleme anındaki bayat değeri değil)', async () => {
    // Modül, storage'da adres YOKKEN yüklenir → _lastKnownAddress = null (bayat).
    M.savedAddress = null;
    const mod = await boot();
    mod.startOBD();
    await vi.advanceTimersByTimeAsync(100);

    // Kullanıcı sonradan cihazı kaydetti (başka bir yol) + kanıt defterinde var.
    M.savedAddress = ADDR;
    M.verifiedAddresses = new Set([ADDR.toUpperCase()]);
    const before = M.connectCalls;

    await goForeground();
    // Bayat null yerine storage'daki adres okunmalı → resume çalışır.
    expect(M.connectCalls).toBeGreaterThan(before);
  });

  it('stopOBD appStateChange aboneliğini bırakır (zero-leak)', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    expect(M.appStateCbs.length).toBe(1);

    mod.stopOBD();
    await vi.advanceTimersByTimeAsync(10);
    expect(M.appStateRemoveCalls).toBeGreaterThan(0);
    expect(M.appStateCbs.length).toBe(0);
  });

  it('stopOBD sonrası foreground olayı hiçbir şey yapmaz', async () => {
    const mod = await boot();
    await establishHealthy(mod);
    const cbs = [...M.appStateCbs];
    mod.stopOBD();
    await vi.advanceTimersByTimeAsync(10);
    const before = M.connectCalls;

    for (const cb of cbs) cb({ isActive: true }); // kopmuş referans
    await vi.advanceTimersByTimeAsync(1_000);
    expect(M.connectCalls).toBe(before);
  });
});
