/**
 * obdColdReturnResume.test.ts — REPRODUCER + KİLİT: soğuk dönüş (cold-return) auto-resume.
 *
 * SAHA ŞİKAYETİ: araçtan çıkıp uzun süre sonra geri gelince canlı veri BAŞLAMIYOR;
 * kullanıcı AYARLARDAN manuel yeniden bağlamak zorunda kalıyor.
 *
 * KÖK NEDEN: `_addressConnectedOnce` MODÜL-SEVİYESİ BELLEK değişkenidir → her process
 * başlangıcında false. Araç kapanınca head unit ölür → app process ölür → bu bayrak
 * SIFIRLANIR. Kontak açılınca ELM327 henüz beslenmemiş/BT stack hazır değilken 5 deneme
 * (2+4+8+16+32 ≈ 62s) düşer → `_scheduleReconnect` "bu oturumda hiç bağlanamadı → yanlış
 * adaptör olmalı" deyip `clearObdAddress()` çağırır → KAYITLI ADAPTÖR SİLİNİR → sonraki
 * başlatma OBD_NO_DEVICE → kullanıcı ayarlara gitmek ZORUNDA.
 *
 * En acısı: adaptörün İYİ olduğunu kanıtlayan KALICI defter (`obd:verifiedAddresses` —
 * yalnız GERÇEK ECU verisi aktığında yazılır) bu karar noktasında HİÇ OKUNMUYORDU
 * (obdService defteri yalnız YAZIYORDU; okuyan tek yer OBDConnectModal rozetiydi).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<(d: unknown) => void>>,
  connectCalls: 0,
  connectShouldFail: true,
  clearAddressCalls: 0,
  clearTransportCalls: 0,
  /** Kalıcı kanıt defteri — GERÇEK ECU verisi aktığında yazılır (LRU, max 8). */
  verifiedAddresses: new Set<string>(),
  savedAddress: null as string | null,
}));

vi.mock('../platform/remoteLogService', () => ({ reportObdDiag: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => true) } }));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    scanOBD: vi.fn().mockResolvedValue({ devices: [] }),
    connectOBD: vi.fn(async () => {
      M.connectCalls++;
      if (M.connectShouldFail) throw new Error('read failed, socket might closed');
    }),
    disconnectOBD: vi.fn(async () => {}),
    addListener: vi.fn(async (event: string, cb: (d: unknown) => void) => {
      (M.listeners[event] ??= []).push(cb);
      return { remove: vi.fn(async () => { M.listeners[event] = (M.listeners[event] ?? []).filter((f) => f !== cb); }) };
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
  clearObdAddress: vi.fn(() => { M.clearAddressCalls++; M.savedAddress = null; }),
  loadObdTransport: vi.fn(() => 'classic'),
  saveObdTransport: vi.fn(),
  loadObdTransportVerified: vi.fn(() => true),
  saveObdTransportVerified: vi.fn(),
  clearObdTransport: vi.fn(() => { M.clearTransportCalls++; }),
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

/**
 * SOĞUK BOOT = TAZE MODÜL. Bu testin ÖZÜ budur: `_addressConnectedOnce` ve
 * `_lastKnownAddress` modül-seviyesi değişkenlerdir; head unit kapanınca process ölür ve
 * bunlar SIFIRLANIR. `vi.resetModules()` + dinamik import tam olarak bunu simüle eder
 * (modül tepesinde statik import kullanmak "process hiç ölmemiş" gibi davranırdı).
 *
 * ÇAĞRIDAN ÖNCE M.savedAddress / M.verifiedAddresses ayarlanmalı — modül yükleme anında
 * `let _lastKnownAddress = loadObdAddress()` çalışır.
 */
async function coldBoot(): Promise<ObdSvc> {
  vi.resetModules();
  const mod = await import('../platform/obdService');
  const diag = await import('../platform/obdDiagEmitter');
  diag._resetObdDiagEmitterForTest();
  svc = mod;
  return mod;
}

function feed(patch: Record<string, number>): void {
  for (const cb of M.listeners['obdData'] ?? []) cb(patch);
}

/** Üstel reconnect turunun TAMAMINI ilerletir (2+4+8+16+32 = 62s + pay). */
async function exhaustReconnectLadder(): Promise<void> {
  await vi.advanceTimersByTimeAsync(120_000);
}

beforeEach(() => {
  M.listeners = {};
  M.connectCalls = 0;
  M.connectShouldFail = true;
  M.clearAddressCalls = 0;
  M.clearTransportCalls = 0;
  M.verifiedAddresses = new Set();
  M.savedAddress = ADDR; // araç kapanmadan önce kaydedilmişti
  vi.useFakeTimers();
});
afterEach(() => { svc?.stopOBD(); svc = null; vi.clearAllMocks(); vi.useRealTimers(); });

describe('KÖK: soğuk boot"ta KANITLANMIŞ adaptör silinmemeli', () => {
  it('KRİTİK: geçmişte canlı veri akmış adaptör, soğuk boot"ta bağlanamasa BİLE SİLİNMEZ', async () => {
    // SENARYO: araç bir hafta kapalı kaldı. Önceki oturumda bu adaptörden GERÇEK ECU
    // verisi akmıştı → kalıcı kanıt defterinde. Şimdi process TAZE (bellek bayrakları
    // sıfır) ve kontak yeni açıldı: ELM327 henüz beslenmiyor → connect düşüyor.
    M.savedAddress = ADDR;
    M.verifiedAddresses.add(ADDR.toUpperCase()); // KALICI KANIT: bu adaptör İYİ

    const { startOBD } = await coldBoot(); // process TAZE
    startOBD(); // adressiz — storage'dan yüklenir
    await exhaustReconnectLadder();

    // Kanıtlanmış adaptör ASLA silinmemeli — yoksa kullanıcı ayarlara gitmek zorunda kalır.
    expect(M.clearAddressCalls).toBe(0);
    expect(M.savedAddress).toBe(ADDR);
    expect(M.clearTransportCalls).toBe(0);
  });

  it('KRİTİK: kanıtlanmış adaptörde tur tükenince DERİN döngüye geçilir (pes etme yok)', async () => {
    M.savedAddress = ADDR;
    M.verifiedAddresses.add(ADDR.toUpperCase());

    const { startOBD } = await coldBoot();
    startOBD();
    await exhaustReconnectLadder();
    const afterLadder = M.connectCalls;
    expect(afterLadder).toBeGreaterThan(0);

    // Derin döngü (5 dk) yeni bir tur açmalı → "1 saat sonra dönüldüğünde otomatik başlar".
    await vi.advanceTimersByTimeAsync(320_000);
    expect(M.connectCalls).toBeGreaterThan(afterLadder);
  });

  it('KABUL: adaptör geri gelince (kontak açıldı) canlı veri OTOMATİK başlar — ayar gerekmez', async () => {
    M.savedAddress = ADDR;
    M.verifiedAddresses.add(ADDR.toUpperCase());

    const { startOBD, getOBDDataSnapshot } = await coldBoot();
    startOBD();
    await exhaustReconnectLadder();     // kontak kapalı: hep düşüyor
    expect(getOBDDataSnapshot().dataFresh).toBe(false);

    // Kontak AÇILDI → adaptör beslendi → bir sonraki deneme başarılı.
    M.connectShouldFail = false;
    await vi.advanceTimersByTimeAsync(320_000); // derin döngü yeni tur açar
    feed({ speed: 30, rpm: 900 });              // ilk GERÇEK ECU frame'i
    await vi.advanceTimersByTimeAsync(50);

    expect(getOBDDataSnapshot().dataFresh).toBe(true);
    expect(getOBDDataSnapshot().transportConnected).toBe(true);
  });
});

describe('YANLIŞ ADAPTÖRE ASILMA YOK — kanıtsız adres otomatik denenmez', () => {
  it('KABUL: kanıtsız adres boot"ta düşerse OTOMATİK yeniden deneme YOK (dürüst error)', async () => {
    // Kullanıcı yanlış cihaz seçmiş olabilir / ortada gerçek cihaz olmayabilir: defterde
    // YOK → kanıt YOK → merdivene GİRİLMEZ. Kanıt defterine yalnız GERÇEK ECU verisi
    // akınca yazılır (bağlanmak yetmez) → "yanlış adaptöre otomatik bağlanma" garantisi.
    M.savedAddress = ADDR;
    // verifiedAddresses BOŞ

    const { startOBD, getOBDDataSnapshot } = await coldBoot();
    startOBD();
    await vi.advanceTimersByTimeAsync(200);
    const afterFirstRound = M.connectCalls;
    expect(afterFirstRound).toBeGreaterThan(0);   // bir kez denendi
    expect(getOBDDataSnapshot().connectionState).toBe('error'); // dürüst

    await exhaustReconnectLadder();
    // SONSUZ DÖNGÜ YOK: kanıtsız adres için otomatik tur AÇILMAZ.
    expect(M.connectCalls).toBe(afterFirstRound);
  });

  it('SONSUZ DÖNGÜ YOK: kanıtsız adreste derin döngü de AÇILMAZ (saatler sonra bile)', async () => {
    const { startOBD } = await coldBoot();
    startOBD();
    await exhaustReconnectLadder();
    const afterRound = M.connectCalls;

    await vi.advanceTimersByTimeAsync(3_600_000); // 1 saat
    expect(M.connectCalls).toBe(afterRound);
  });

  it('kanıtsız adres SİLİNMEZ — kullanıcı ayarlarda seçimini kaybetmez', async () => {
    // Eskiden tur tükenince adres temizleniyordu. Artık kanıtsız adres merdivene hiç
    // girmediği için silinmez de: ilk boot connect'i düştü diye kullanıcının seçimini
    // atmak fazla agresifti (adaptör-değişimi sezgisi, boot yarışını yanlış yorumluyordu).
    const { startOBD } = await coldBoot();
    startOBD();
    await exhaustReconnectLadder();

    expect(M.savedAddress).toBe(ADDR);
    expect(M.clearAddressCalls).toBe(0);
  });
});

describe('dataReady dürüstlüğü — "bağlı" YALANI yok', () => {
  it('KABUL: bağlantı kurulsa bile ilk GERÇEK ECU frame"i gelmeden dataFresh true OLMAZ', async () => {
    M.connectShouldFail = false;
    const { startOBD, getOBDDataSnapshot } = await coldBoot();
    startOBD();
    await vi.advanceTimersByTimeAsync(100);

    // "Bluetooth bağlandı" ≠ "sistem hazır". Veri kanıtı gelmeden dataFresh YALAN olurdu.
    expect(getOBDDataSnapshot().dataFresh).toBe(false);
    expect(getOBDDataSnapshot().connectionState).not.toBe('connected');

    // ATRV (adaptör canlı) TEK BAŞINA yetmez — ECU verisi DEĞİL.
    feed({ batteryVoltage: 14.2 });
    await vi.advanceTimersByTimeAsync(10);
    expect(getOBDDataSnapshot().dataFresh).toBe(false);

    // İlk GERÇEK ECU frame'i → ancak ŞİMDİ hazır.
    feed({ speed: 30, rpm: 900 });
    await vi.advanceTimersByTimeAsync(10);
    expect(getOBDDataSnapshot().dataFresh).toBe(true);
    expect(getOBDDataSnapshot().connectionState).toBe('connected');
  });
});
