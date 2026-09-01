/**
 * diagnosticAdmission.test.ts — P0-OBD-CORE-05 · TANI ADMİSYON KAPISI kilitleri.
 *
 * SAHA KANITI: KWP recovery/reconnect sürerken tek-seferlik tanı sorguları
 * (DTC/freeze-frame/ECU probe/üretici DID) hatta çıkıyordu ve saha kanıtı
 * bunu "ReadAll_03_Failed" gibi KALICI hata sanıyordu — oysa recovery bitince
 * AYNI sorgu normal cevapladı. Bu dosya SAF çekirdeği (`evaluateDiagnosticAdmission`)
 * her admisyon ekseninde KİLİTLER.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateDiagnosticAdmission, isDiagnosticAdmissionReady,
  type DiagnosticAdmissionInput,
} from '../platform/obd/diagnosticAdmission';

/** Tümüyle sağlıklı/hazır bir oturumu temsil eden taban girdi. */
const READY_INPUT: DiagnosticAdmissionInput = {
  nativePlatform: true,
  connectionState: 'connected',
  transportReady: true,
  sessionReady: true,
  pollingActive: true,
  dataFresh: true,
  canRecoveryInFlight: false,
  nativeReconnectInFlight: false,
  kwpRecoveryInProgress: false,
};

describe('P0-OBD-CORE-05 · evaluateDiagnosticAdmission — SAF çekirdek', () => {
  it('🔒 1 — KİLİT: tam hazır oturum → READY', () => {
    const r = evaluateDiagnosticAdmission(READY_INPUT);
    expect(r.admission).toBe('READY');
    expect(isDiagnosticAdmissionReady(r.admission)).toBe(true);
  });

  it('🔒 2 — KİLİT: KWP recovery IN_PROGRESS → RECOVERY_ACTIVE (TX çıkmaz)', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, kwpRecoveryInProgress: true });
    expect(r.admission).toBe('RECOVERY_ACTIVE');
    expect(isDiagnosticAdmissionReady(r.admission)).toBe(false);
  });

  it('🔒 3 — KİLİT: CAN ECU kurtarma merdiveni sürüyor → RECOVERY_ACTIVE', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, canRecoveryInFlight: true });
    expect(r.admission).toBe('RECOVERY_ACTIVE');
  });

  it('🔒 4 — KİLİT: connectionState=reconnecting → RECONNECTING (TX çıkmaz)', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, connectionState: 'reconnecting' });
    expect(r.admission).toBe('RECONNECTING');
    expect(isDiagnosticAdmissionReady(r.admission)).toBe(false);
  });

  it('4b — connectionState=connecting/initializing de RECONNECTING sayılır', () => {
    expect(evaluateDiagnosticAdmission({ ...READY_INPUT, connectionState: 'connecting' }).admission)
      .toBe('RECONNECTING');
    expect(evaluateDiagnosticAdmission({ ...READY_INPUT, connectionState: 'initializing' }).admission)
      .toBe('RECONNECTING');
  });

  it('🔒 5 — KİLİT: native transport reconnect in-flight → RECONNECTING', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, nativeReconnectInFlight: true });
    expect(r.admission).toBe('RECONNECTING');
  });

  it('🔒 6 — KİLİT: handshake var ama ilk PID kanıtı yok (sessionReady:false) → WAITING_SESSION', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, sessionReady: false });
    expect(r.admission).toBe('WAITING_SESSION');
    expect(isDiagnosticAdmissionReady(r.admission)).toBe(false);
  });

  it('6b — oturum zamanlayıcısı kurulmadı (pollingActive:false) → WAITING_SESSION', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, pollingActive: false });
    expect(r.admission).toBe('WAITING_SESSION');
  });

  it('🔒 7 — KİLİT: transport bağlı değil → TRANSPORT_DOWN', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, transportReady: false });
    expect(r.admission).toBe('TRANSPORT_DOWN');
  });

  it('7b — connectionState=error/idle/scanning → TRANSPORT_DOWN', () => {
    expect(evaluateDiagnosticAdmission({ ...READY_INPUT, connectionState: 'error' }).admission)
      .toBe('TRANSPORT_DOWN');
    expect(evaluateDiagnosticAdmission({ ...READY_INPUT, connectionState: 'idle' }).admission)
      .toBe('TRANSPORT_DOWN');
    expect(evaluateDiagnosticAdmission({ ...READY_INPUT, connectionState: 'scanning' }).admission)
      .toBe('TRANSPORT_DOWN');
  });

  it('🔒 8 — KİLİT: session bir kez hazırdı ama veri şu an taze değil → DATA_NOT_PROVEN', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, dataFresh: false });
    expect(r.admission).toBe('DATA_NOT_PROVEN');
    expect(isDiagnosticAdmissionReady(r.admission)).toBe(false);
  });

  it('🔒 9 — KİLİT: tanınmayan connectionState → UNKNOWN (fail-closed, READY DEĞİL)', () => {
    const r = evaluateDiagnosticAdmission({
      ...READY_INPUT,
      connectionState: 'wat' as unknown as DiagnosticAdmissionInput['connectionState'],
    });
    expect(r.admission).toBe('UNKNOWN');
    expect(isDiagnosticAdmissionReady(r.admission)).toBe(false);
  });

  it('10 — web/demo modu (nativePlatform:false) → her zaman READY (gerçek transport yok)', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, nativePlatform: false, connectionState: 'idle' });
    expect(r.admission).toBe('READY');
  });

  it('11 — SIRA: transport-down her şeyden ÖNCE gelir (recovery bayrağı bile olsa)', () => {
    const r = evaluateDiagnosticAdmission({
      ...READY_INPUT, transportReady: false, canRecoveryInFlight: true, kwpRecoveryInProgress: true,
    });
    expect(r.admission).toBe('TRANSPORT_DOWN');
  });

  it('12 — kwpRecoveryInProgress:null (KWP kanıtı yok/CAN aracı) kararı ETKİLEMEZ', () => {
    const r = evaluateDiagnosticAdmission({ ...READY_INPUT, kwpRecoveryInProgress: null });
    expect(r.admission).toBe('READY');
  });
});

describe('P0-OBD-CORE-05 · getDiagnosticAdmissionEpisode — korelasyon kimliği', () => {
  it('READY dışı ardışık kararlar AYNI episode id taşır; READY sonrası düşer', async () => {
    const mod = await import('../platform/obd/diagnosticAdmission');
    mod._resetDiagnosticAdmissionForTest();
    expect(mod.getDiagnosticAdmissionEpisode()).toBeNull();
  });
});
