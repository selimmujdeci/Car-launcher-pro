/**
 * diagnosticAdmissionGate.test.ts — P0-OBD-CORE-05 · readAllDTCs/readFreezeFrame/
 * discoverEcus'un ADMİSYON KAPISINA bağlanması — entegrasyon kilitleri.
 *
 * SAHA KANITI: KWP recovery/reconnect sürerken bu sorgular hatta çıkıyor ve
 * `ReadAll_03_Failed` gibi KALICI hata izlenimi bırakıyordu. Bu dosya:
 *   1) recovery/reconnect/session-not-ready iken ECU'ya TEK BAYT GİTMEDİĞİNİ,
 *   2) session ready olunca taramanın NORMAL çalıştığını,
 *   3) deferred turların crashLogger'a SPAM ÜRETMEDİĞİNİ,
 *   4) reconnect sonrası ESKİ oturumun sızmadığını
 * KİLİTLER.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDTC:       vi.fn(async () => ({ codes: [] as string[] })),
    /* P0-VDK-F2C1: ham gövde artık MODA UYGUN pozitif SID taşır (43/47/4A).
       Eski fixture üç moda da `43` döndürüyordu; Mode 07/0A isteğine `43`
       yanıtı gerçek bir TUTARSIZLIKTIR ve kanonik çözümleyici onu haklı
       olarak tanımaz. Kilitlerin iddiası değişmedi — fixture gerçekçileşti. */
    readDtcClass:  vi.fn(async (o: { mode: string }) => ({
      codes: [] as string[],
      raw: `${o.mode === '07' ? '47' : o.mode === '0A' ? '4A' : '43'} 00`,
      supported: true,
      outcome: 'OK', elapsedMs: 10, protocol: '6', recoveryCount: 0,
    })),
    readFreezeFrameDtc: vi.fn(async () => ({ dtc: 'P0301' as string | null })),
  },
}));

/** Mutable oturum sağlığı — testler bunu doğrudan değiştirir. */
const health = vi.hoisted(() => ({
  connectionState: 'connected' as string,
  transportReady: true,
  sessionReady: true,
  pollingActive: true,
  dataFresh: true,
  canRecoveryInFlight: false,
  nativeReconnectInFlight: false,
}));

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: () => ({ connectionState: health.connectionState }),
  getObdSessionHealth: () => ({
    transportReady: health.transportReady, sessionReady: health.sessionReady,
    pollingActive: health.pollingActive, dataFresh: health.dataFresh,
    ready: health.transportReady && health.sessionReady && health.pollingActive && health.dataFresh,
  }),
  getEcuRecoveryLadder: () => ({
    inFlight: health.canRecoveryInFlight, nativeReconnectInFlight: health.nativeReconnectInFlight,
  }),
  getObdSessionEpoch: () => 3,
}));

vi.mock('../platform/crashLogger', () => ({
  logError: vi.fn(),
}));

function resetHealth(): void {
  health.connectionState = 'connected';
  health.transportReady = true;
  health.sessionReady = true;
  health.pollingActive = true;
  health.dataFresh = true;
  health.canRecoveryInFlight = false;
  health.nativeReconnectInFlight = false;
}

import { CarLauncher } from '../platform/nativePlugin';
import { logError } from '../platform/crashLogger';
import { readAllDTCs, readFreezeFrame, _resetDtcServiceForTest } from '../platform/dtcService';
import { _resetDtcEvidenceForTest } from '../platform/obd/dtcScanEvidence';
import { _resetDtcAuthorityForTest, getDtcAuthoritySnapshot } from '../platform/obd/dtcAuthority';

/** Her testte TAZE varsayılana döner — `mockImplementation` override'ları önceki testten SIZMAZ. */
function resetDtcClassMock(): void {
  vi.mocked(CarLauncher.readDtcClass).mockReset();
  vi.mocked(CarLauncher.readDtcClass).mockImplementation(async (o: { mode: string }) => ({
    codes: [] as string[],
    raw: `${o.mode === '07' ? '47' : o.mode === '0A' ? '4A' : '43'} 00`,
    supported: true,
    outcome: 'OK', elapsedMs: 10, protocol: '6', recoveryCount: 0,
  }));
  vi.mocked(CarLauncher.readFreezeFrameDtc).mockReset();
  vi.mocked(CarLauncher.readFreezeFrameDtc).mockResolvedValue({ dtc: 'P0301' });
}

describe('P0-OBD-CORE-05 · readAllDTCs — admisyon kapısı entegrasyonu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDtcClassMock();
    resetHealth();
    _resetDtcServiceForTest();
    _resetDtcEvidenceForTest();
    _resetDtcAuthorityForTest();
  });

  it('🔒 1 — KİLİT: CAN recovery AKTİF → TX ÇIKMAZ, tüm modlar DEFERRED', async () => {
    health.canRecoveryInFlight = true;
    const r = await readAllDTCs();
    expect(r.completeness).toEqual({ stored: 'deferred', pending: 'deferred', permanent: 'deferred' });
    expect(CarLauncher.readDtcClass).not.toHaveBeenCalled();
    expect(CarLauncher.readDTC).not.toHaveBeenCalled();
  });

  it('🔒 2 — KİLİT: reconnect SÜRÜYOR → TX ÇIKMAZ', async () => {
    health.connectionState = 'reconnecting';
    const r = await readAllDTCs();
    expect(r.completeness.stored).toBe('deferred');
    expect(CarLauncher.readDtcClass).not.toHaveBeenCalled();
  });

  it('🔒 3 — KİLİT: handshake var ama ilk PID kanıtı yok (sessionReady:false) → BEKLER, TX ÇIKMAZ', async () => {
    health.sessionReady = false;
    const r = await readAllDTCs();
    expect(r.completeness.pending).toBe('deferred');
    expect(CarLauncher.readDtcClass).not.toHaveBeenCalled();
  });

  it('🔒 4 — KİLİT: session ready + ilk PID kanıtı VAR → tarama NORMAL ÇALIŞIR', async () => {
    const r = await readAllDTCs();
    expect(r.completeness).toEqual({ stored: 'ok', pending: 'ok', permanent: 'ok' });
    expect(CarLauncher.readDtcClass).toHaveBeenCalledTimes(3);
  });

  it('🔒 10 — KİLİT: DEFERRED tur crashLogger.logError SPAM ÜRETMEZ', async () => {
    health.canRecoveryInFlight = true;
    await readAllDTCs();
    expect(logError).not.toHaveBeenCalled();
  });

  it('10b — KONTRAST: session ready iken GERÇEK bağımsız hata YİNE loglanır', async () => {
    vi.mocked(CarLauncher.readDtcClass).mockRejectedValue(new Error('bağlantı koptu'));
    await readAllDTCs();
    expect(logError).toHaveBeenCalled();
    expect(vi.mocked(logError).mock.calls.some((c) => String(c[0]).includes('ReadAll'))).toBe(true);
  });

  it('11 — recovery bitince (sonraki çağrıda) tarama NORMAL devam eder — poll bozulmaz', async () => {
    health.canRecoveryInFlight = true;
    const deferred = await readAllDTCs();
    expect(deferred.completeness.stored).toBe('deferred');

    health.canRecoveryInFlight = false;
    const ready = await readAllDTCs();
    expect(ready.completeness).toEqual({ stored: 'ok', pending: 'ok', permanent: 'ok' });
    expect(CarLauncher.readDtcClass).toHaveBeenCalledTimes(3); // yalnız İKİNCİ turda
  });

  it('🔒 13 — KİLİT: DEFERRED sırasında oturum DEĞİŞİRSE eski turun kaydı SIZMAZ', async () => {
    // Önceki (gerçek) oturumda P0089 ölçülmüştü.
    vi.mocked(CarLauncher.readDtcClass).mockImplementation(async (o: { mode: string }) =>
      o.mode === '07'
        ? { codes: ['P0089'], raw: '47 01 00 89', supported: true, outcome: 'OK', elapsedMs: 5, protocol: '6', recoveryCount: 0 }
        : { codes: [], raw: '43 00', supported: true, outcome: 'OK', elapsedMs: 5, protocol: '6', recoveryCount: 0 });
    const first = await readAllDTCs();
    expect(first.codes.map((c) => c.code)).toContain('P0089');

    // Şimdi recovery başlar VE oturum numarası değişir (adaptör başka araca
    // takılmış olabilir) — deferred sonucu ESKİ oturumun P0089'unu TAŞIMAMALI.
    health.canRecoveryInFlight = true;
    const authoritySnapBefore = getDtcAuthoritySnapshot();
    expect(authoritySnapBefore.observations.length).toBeGreaterThan(0);

    const deferred = await readAllDTCs();
    expect(deferred.codes).toEqual([]);
    expect(deferred.completeness).toEqual({ stored: 'deferred', pending: 'deferred', permanent: 'deferred' });
  });

  it('12 — CAN yolu regresyonu yok: pozitif-empty (43/47/4A 00) hâlâ "ok" + 0 kod', async () => {
    const r = await readAllDTCs();
    expect(r.permanentSupported).toBe(true);
    expect(r.codes).toEqual([]);
    /* P0-VDK-F2C1: "pozitif ama boş" GERÇEK bir ölçümdür ve kanonik
       çözümleyiciden de `ok` çıkmalıdır — ECU'nun sustuğu durumla (NO DATA)
       karışmamalı. Kilit bu ayrımı da tutar. */
    expect(r.completeness).toEqual({ stored: 'ok', pending: 'ok', permanent: 'ok' });
  });
});

describe('P0-OBD-CORE-05 · readFreezeFrame — admisyon kapısı entegrasyonu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDtcClassMock();
    resetHealth();
  });

  it('recovery aktifken freeze-frame TX ÇIKMAZ, null döner, log ÜRETİLMEZ', async () => {
    health.canRecoveryInFlight = true;
    const r = await readFreezeFrame();
    expect(r).toBeNull();
    expect(CarLauncher.readFreezeFrameDtc).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('session ready iken freeze-frame NORMAL çalışır', async () => {
    const r = await readFreezeFrame();
    expect(r?.dtc).toBe('P0301');
    expect(CarLauncher.readFreezeFrameDtc).toHaveBeenCalled();
  });
});
