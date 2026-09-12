/**
 * ARCH-04 — NATIVE BOUNDARY / HAL / NATIVE BRIDGE üretim benimseme kilitleri.
 *
 * Bu dosya bir DAVRANIŞ kasasıdır: her `it` görev §14'teki numaralı kabul
 * davranışlarından birine karşılık gelir ve o davranış sessizce geri gelirse
 * kilit DÜŞER.
 *
 * ⚠️ Statik taramalar KÖR OLMAMALIDIR: her tarama önce korpusun BOŞ OLMADIĞINI
 * doğrular. Taranan yapı değişip 0 sonuç üretirse bu bir başarı değil ARIZADIR
 * ve kilit bunu ayrıca yakalar (CLAUDE.md §Kör guard = düşen guard).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  classifyPhoneLinkStage, getPhoneHubIngressEvidence, ingestPhoneHubNativeEvent,
  normalizePhoneHubNativeEvent, phoneLinkStageRank, _resetPhoneHubIngressForTest,
} from '../platform/phoneHub/phoneHubNativeIngress';
import {
  normalizePermissionState, projectDomainReadiness, projectOperationAllowance,
  projectResilience, projectServiceReadiness, unmeasuredDomainReadiness,
} from '../platform/native/nativeReadinessModel';
import {
  CRITICAL_NATIVE_METHODS, negotiateNativeMethod, summarizeNativeNegotiation,
} from '../platform/native/nativeCapabilityNegotiation';
import {
  getObdNativeProvenanceEvidence, judgeObdProvenanceFreshness,
  recordObdNativeProvenance, _resetObdNativeProvenanceForTest,
} from '../platform/obd/obdNativeProvenance';
import {
  getCanNativeProvenanceEvidence, isStaleCanCallback, recordCanNativeProvenance,
  _resetCanNativeProvenanceForTest,
} from '../platform/vehicleDataLayer/canNativeProvenance';
import {
  beginStorageWrite, completeStorageWrite, firstFailedStage, isDurableWriteProven,
  judgeStorageWriteOutcome, markStorageWriteStage, getStorageWriteEvidence,
  REQUIRED_DURABILITY_STAGES, _resetStorageWriteEvidenceForTest,
} from '../utils/safeStorageWriteEvidence';
import {
  assessConformanceRow, buildNativeConformanceMatrix, CRITICAL_CAPABILITY_IDS,
} from '../platform/native/nativeConformanceMatrix';
import {
  assessNativeBoundaryConformance, getNativeCapabilityDescriptors,
} from '../platform/native/nativeBoundaryContract';
import { GENERIC_READ_ONLY_SERVICES, judgeGenericPdu } from '../platform/obd/genericPduTransport';

/* ══════════════════════════════════════════════════════════════════════════
 * Statik tarama altyapısı (kör guard yasağı)
 * ════════════════════════════════════════════════════════════════════════ */

const ROOT = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
      continue;
    }
    if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const ALL_SOURCES: readonly string[] = Object.freeze(walk(ROOT));

function readAll(files: readonly string[]): { path: string; text: string }[] {
  return files.map((f) => ({ path: relative(ROOT, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
}

const CORPUS = readAll(ALL_SOURCES);
const UI_CORPUS = CORPUS.filter((f) => f.path.startsWith('components/') || f.path.startsWith('hooks/'));
const MAVI_CORPUS = CORPUS.filter((f) => f.path.startsWith('platform/maviCore/')
  || f.path.startsWith('platform/assistant/') || f.path.startsWith('platform/ai'));

/** Kritik native metotların ürün yolundaki çağrı satırları. */
function callSites(method: string): { path: string; line: string }[] {
  const out: { path: string; line: string }[] = [];
  const re = new RegExp(`CarLauncher\\.${method}\\b`);
  for (const file of CORPUS) {
    if (file.path === 'platform/nativePlugin.ts') continue;
    if (file.path === 'platform/native/nativeCapabilityNegotiation.ts') continue;
    for (const line of file.text.split('\n')) {
      if (re.test(line)) out.push({ path: file.path, line: line.trim() });
    }
  }
  return out;
}

/* Korpusun gerçekten dolu olduğunu tek yerde kanıtla — boş küme "geçen"
   bir kilit üretemesin. */
describe('ARCH-04 statik tarama korpusu', () => {
  it('kaynak korpusu BOŞ DEĞİL (kör guard yasağı)', () => {
    expect(CORPUS.length).toBeGreaterThan(300);
    expect(UI_CORPUS.length).toBeGreaterThan(50);
    expect(CORPUS.some((f) => f.path === 'platform/nativePlugin.ts')).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–5) Phone native giriş + izin/yetenek/hazırlık merdiveni
 * ════════════════════════════════════════════════════════════════════════ */

const BASE_SNAPSHOT = {
  present: true,
  server: { state: 'LISTENING', running: true, hasActiveSocket: true },
  preconditions: { ready: true, connectPermission: true },
  session: {
    generation: 7, state: 'ESTABLISHED', handshakeStage: 'DONE',
    awaitingUserConfirm: false, trustSkipped: false, encryptionActive: true,
    trulyEstablished: true, disposed: false,
    grantedCapabilities: ['NOTIFICATION_MIRROR', 'MEDIA_META'],
    peerFingerprint: 'AA:BB:CC:DD', peerAppVersion: '9.9.9',
  },
  uuid: 'secret-uuid-value',
  trust: { peerFingerprint: 'AA:BB:CC:DD', hasTrustedPeer: true },
} as const;

describe('ARCH-04/1 Phone native olayı companion GİRİŞİNDEN geçer', () => {
  beforeEach(() => { _resetPhoneHubIngressForTest(); });

  it('güncel native olay giriş adaptöründen KABUL edilir ve öneri üretir', () => {
    const result = ingestPhoneHubNativeEvent(BASE_SNAPSHOT);
    expect(result.verdict).toBe('ACCEPTED');
    expect(result.stage).toBe('CONTROL_ALLOWED');
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.proposesApplicationTraffic).toBe(true);
    /* ÖNERİ bir hüküm DEĞİLDİR: companion gerçeğine yazılan mutasyon YOK. */
    expect(getPhoneHubIngressEvidence().directCompanionTruthWrites).toBe(0);
  });

  it('2) eski nesil REDDEDİLİR ve mevcut companion basamağı DEĞİŞMEZ', () => {
    ingestPhoneHubNativeEvent(BASE_SNAPSHOT);
    const before = getPhoneHubIngressEvidence();
    const stale = {
      ...BASE_SNAPSHOT,
      session: { ...BASE_SNAPSHOT.session, generation: 3, grantedCapabilities: [] },
    };
    const result = ingestPhoneHubNativeEvent(stale);
    expect(result.verdict).toBe('REJECTED_STALE');
    expect(result.proposal).toBeNull();
    const after = getPhoneHubIngressEvidence();
    expect(after.stage).toBe(before.stage);
    expect(after.acceptedGeneration).toBe(before.acceptedGeneration);
    expect(after.staleRejectedCount).toBe(1);
    expect(after.directCompanionTruthWrites).toBe(0);
  });

  it('3) CONNECTED ≠ AUTHENTICATED — şifreleme kanıtı yoksa merdiven durur', () => {
    const connectedOnly = {
      ...BASE_SNAPSHOT,
      session: { ...BASE_SNAPSHOT.session, encryptionActive: false },
    };
    const result = ingestPhoneHubNativeEvent(connectedOnly);
    expect(result.stage).toBe('TRANSPORT_CONNECTED');
    expect(result.proposal!.proposesApplicationTraffic).toBe(false);
    /* Native "trulyEstablished:true" DİYOR ama merdiven onu yükseltmiyor. */
    expect(phoneLinkStageRank(result.stage)).toBeLessThan(phoneLinkStageRank('SESSION_ESTABLISHED'));
  });

  it('present ≠ capability granted — yetenek adedi 0 ise basamak yükselmez', () => {
    const noCaps = {
      ...BASE_SNAPSHOT,
      session: { ...BASE_SNAPSHOT.session, grantedCapabilities: [] },
    };
    expect(ingestPhoneHubNativeEvent(noCaps).stage).toBe('SESSION_ESTABLISHED');
  });

  it('kullanıcı onayı beklenirken veya güven atlanmışken AUTHENTICATED verilmez', () => {
    expect(classifyPhoneLinkStage(normalizePhoneHubNativeEvent({
      ...BASE_SNAPSHOT,
      session: { ...BASE_SNAPSHOT.session, awaitingUserConfirm: true },
    }))).toBe('TRANSPORT_CONNECTED');
    expect(classifyPhoneLinkStage(normalizePhoneHubNativeEvent({
      ...BASE_SNAPSHOT,
      session: { ...BASE_SNAPSHOT.session, trustSkipped: true },
    }))).toBe('TRANSPORT_CONNECTED');
  });

  it('köprü yoksa "bağlı" hükmü TAZE görünmez — basamak ABSENT’e düşer', () => {
    ingestPhoneHubNativeEvent(BASE_SNAPSHOT);
    const result = ingestPhoneHubNativeEvent({ present: false });
    expect(result.verdict).toBe('REJECTED_UNAVAILABLE');
    expect(result.stage).toBe('ABSENT');
  });

  it('24) GİZLİLİK: parmak izi · uuid · uygulama sürümü giriş olayına GİRMEZ', () => {
    const event = normalizePhoneHubNativeEvent(BASE_SNAPSHOT);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('AA:BB:CC:DD');
    expect(serialized).not.toContain('secret-uuid-value');
    expect(serialized).not.toContain('9.9.9');
    expect(Object.keys(event)).not.toContain('peerFingerprint');
    /* Kanıt defterine de sızmamalı. */
    ingestPhoneHubNativeEvent(BASE_SNAPSHOT);
    const evidence = JSON.stringify(getPhoneHubIngressEvidence());
    expect(evidence).not.toContain('AA:BB:CC:DD');
    expect(evidence).not.toContain('secret-uuid-value');
  });
});

describe('ARCH-04/2 izin → yetenek → hazırlık → işlem merdiveni', () => {
  it('4) İZİN VERİLDİ ≠ HAZIR — sağlayıcı kanıtı yoksa READY yok', () => {
    const row = projectDomainReadiness({
      domainId: 'GPS', permissionState: 'GRANTED', capabilityAvailable: 'AVAILABLE',
      serviceEvidence: null, blockers: [], lastResult: 'UNMEASURED',
      fallback: 'NONE', provenance: ['test'],
    });
    expect(row.serviceReady).toBe('UNKNOWN');
    expect(row.operationAllowed).toBe('UNKNOWN');
    expect(row.reason).toContain('İZİN VERİLDİ ≠ HAZIR');
  });

  it('Konum izni GRANTED ama sağlayıcı yok → GPS READY YOK (görev örneği)', () => {
    const row = projectDomainReadiness({
      domainId: 'GPS', permissionState: 'GRANTED', capabilityAvailable: 'UNAVAILABLE',
      serviceEvidence: null, blockers: [], lastResult: 'UNMEASURED',
      fallback: 'AVAILABLE', provenance: ['test'],
    });
    expect(row.serviceReady).toBe('NOT_READY');
    expect(row.operationAllowed).toBe('BLOCKED');
    expect(row.resilience).toBe('LIMITED');
  });

  it('Bluetooth izni GRANTED ama companion oturumu yok → Phone READY YOK', () => {
    const row = projectDomainReadiness({
      domainId: 'PHONE_LINK', permissionState: 'GRANTED', capabilityAvailable: 'AVAILABLE',
      serviceEvidence: false, blockers: ['oturum kurulmadı'], lastResult: 'UNMEASURED',
      fallback: 'NONE', provenance: ['test'],
    });
    expect(row.serviceReady).toBe('NOT_READY');
    expect(row.operationAllowed).toBe('BLOCKED');
  });

  it('5) YETENEK VAR ≠ İŞLEM BAŞARILI — geçmiş sonuç hazırlığı yükseltmez', () => {
    const row = projectDomainReadiness({
      domainId: 'OBD', permissionState: 'GRANTED', capabilityAvailable: 'AVAILABLE',
      serviceEvidence: null, blockers: [], lastResult: 'SUCCESS',
      fallback: 'NONE', provenance: ['test'],
    });
    expect(row.lastResult).toBe('SUCCESS');
    expect(row.serviceReady).toBe('UNKNOWN');
    expect(row.operationAllowed).not.toBe('ALLOWED');
  });

  it('izin bilinmiyorsa sahte DENIED/GRANTED üretilmez', () => {
    expect(normalizePermissionState(undefined)).toBe('UNKNOWN');
    expect(normalizePermissionState('weird')).toBe('UNKNOWN');
    expect(normalizePermissionState('granted')).toBe('GRANTED');
    expect(normalizePermissionState('denied')).toBe('DENIED');
    const row = unmeasuredDomainReadiness('X');
    expect(row.permissionState).toBe('UNKNOWN');
    expect(row.serviceReady).toBe('UNKNOWN');
    expect(row.operationAllowed).toBe('UNKNOWN');
  });

  it('izin DENIED ise yetenek/kanıt ne olursa olsun işlem BLOCKED', () => {
    expect(projectServiceReadiness('AVAILABLE', true, 'DENIED', [])).toBe('NOT_READY');
    expect(projectOperationAllowance('READY', 'DENIED', [])).toBe('BLOCKED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6–8) OBD sınır kökeni
 * ════════════════════════════════════════════════════════════════════════ */

describe('ARCH-04/3 OBD sonuç/köken adaptörü', () => {
  beforeEach(() => { _resetObdNativeProvenanceForTest(); });

  it('6) salt-okunur istek mevcut güvenli kapıdan geçer ve köken taşır', () => {
    expect(judgeGenericPdu({
      service: '22', subFunction: '', payload: 'F190', protocol: 'CAN',
      target: { addressing: 'physical', txHeader: '7E0', rxHeader: '7E8' },
      responseEchoBytes: 0,
    } as never)).toBe('OK');
    const record = recordObdNativeProvenance({
      bridgeMethod: 'sendDiagnosticPdu', transportClass: 'ELM327', transactionRef: 'TXN-1',
      requestEpoch: 4, resultEpoch: 4, targetRef: '7E0', serviceRef: '22',
      nativeResultClass: 'POSITIVE', latencyMs: 42, byteCount: 9,
      nativeCapabilityAvailable: true, gateReason: null,
    });
    expect(record.freshness).toBe('CURRENT');
    expect(record.bridgeMethod).toBe('sendDiagnosticPdu');
    expect(record.targetRef).toBe('7E0');
    expect(record.latencyMs).toBe(42);
    expect(record.provenance.length).toBeGreaterThan(0);
  });

  it('7) destructive/native yasak servis erken kapıda REDDEDİLİR', () => {
    for (const sid of ['04', '11', '14', '27', '2E', '2F', '31', '34', '85']) {
      expect(GENERIC_READ_ONLY_SERVICES.has(sid)).toBe(false);
      expect(judgeGenericPdu({
        service: sid, subFunction: '', payload: '', protocol: 'CAN',
        target: { addressing: 'physical', txHeader: '7E0', rxHeader: '7E8' },
        responseEchoBytes: 0,
      } as never)).toBe('SERVICE_NOT_READ_ONLY');
    }
    /* 0x19'un salt-okunur OLMAYAN alt fonksiyonu da geçemez. */
    expect(judgeGenericPdu({
      service: '19', subFunction: '04', payload: '', protocol: 'CAN',
      target: { addressing: 'physical', txHeader: '7E0', rxHeader: '7E8' },
      responseEchoBytes: 0,
    } as never)).toBe('SUBFUNCTION_NOT_READ_ONLY');
  });

  it('8) bayat epoch sonucu işaretlenir ve GÜNCEL GERÇEĞE YAZILMAZ', () => {
    const record = recordObdNativeProvenance({
      bridgeMethod: 'sendDiagnosticPdu', transportClass: null, transactionRef: null,
      requestEpoch: 4, resultEpoch: 5, targetRef: '7E0', serviceRef: '19',
      nativeResultClass: 'POSITIVE', latencyMs: null, byteCount: null,
      nativeCapabilityAvailable: true, gateReason: null,
    });
    expect(record.freshness).toBe('STALE');
    expect(record.acceptedAsCurrentTruth).toBe(false);
    const evidence = getObdNativeProvenanceEvidence();
    expect(evidence.staleEpochResults).toBe(1);
    expect(evidence.staleResultsAcceptedAsTruth).toBe(0);
  });

  it('epoch ölçülemezse sahte "bayat"/"taze" hükmü üretilmez', () => {
    expect(judgeObdProvenanceFreshness(null, 5)).toBe('UNKNOWN');
    expect(judgeObdProvenanceFreshness(4, null)).toBe('UNKNOWN');
    expect(judgeObdProvenanceFreshness(-1, -1)).toBe('UNKNOWN');
  });

  it('desteklenmeyen köprü FAIL-CLOSED ve "araç desteklemiyor" DEMEZ', () => {
    const record = recordObdNativeProvenance({
      bridgeMethod: 'sendDiagnosticPdu', transportClass: null, transactionRef: null,
      requestEpoch: 1, resultEpoch: 1, targetRef: '7E0', serviceRef: '22',
      nativeResultClass: 'NOT_SUPPORTED_BY_TRANSPORT', latencyMs: null, byteCount: null,
      nativeCapabilityAvailable: false, gateReason: 'NO_BRIDGE',
    });
    expect(record.nativeResultClass).toBe('NOT_SUPPORTED_BY_TRANSPORT');
    expect(record.nativeCapabilityAvailable).toBe(false);
    expect(getObdNativeProvenanceEvidence().transportUnsupported).toBe(1);
  });

  it('ham yük/ham yanıt kanıta SIZMAZ (adaptör yürütme otoritesi değildir)', () => {
    recordObdNativeProvenance({
      bridgeMethod: 'sendDiagnosticPdu', transportClass: '62F190 4141', transactionRef: null,
      requestEpoch: 1, resultEpoch: 1, targetRef: '7E0', serviceRef: '22',
      nativeResultClass: 'POSITIVE', latencyMs: null, byteCount: 20,
      nativeCapabilityAvailable: true, gateReason: null,
    });
    const dump = JSON.stringify(getObdNativeProvenanceEvidence());
    /* Boşluk içeren ham gövde referans biçimine uymaz → düşürülür. */
    expect(dump).not.toContain('62F190 4141');
    const keys = Object.keys(getObdNativeProvenanceEvidence().recent[0]!);
    expect(keys).not.toContain('raw');
    expect(keys).not.toContain('payload');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–11) CAN sınır kökeni
 * ════════════════════════════════════════════════════════════════════════ */

describe('ARCH-04/4 CAN sonuç/köken adaptörü', () => {
  beforeEach(() => { _resetCanNativeProvenanceForTest(); });

  it('9) nesil korunur ve köken taşınır', () => {
    const record = recordCanNativeProvenance({
      sourceRef: 'CanAdapter', eventClass: 'REGISTERED',
      listenerGeneration: 3, currentGeneration: 3, busContext: 'uart',
      nativeAvailable: true,
    });
    expect(record.listenerGeneration).toBe(3);
    expect(record.currentGeneration).toBe(3);
    expect(record.busContext).toBe('uart');
    expect(record.provenance.length).toBeGreaterThan(0);
    expect(getCanNativeProvenanceEvidence().registrations).toBe(1);
  });

  it('bayat dinleyici geri çağrısı REDDEDİLİR ve sayılır', () => {
    expect(isStaleCanCallback(2, 3)).toBe(true);
    expect(isStaleCanCallback(3, 3)).toBe(false);
    expect(isStaleCanCallback(null, 3)).toBeNull();
    recordCanNativeProvenance({
      sourceRef: 'CanAdapter', eventClass: 'STALE_CALLBACK_REJECTED',
      listenerGeneration: 2, currentGeneration: 3, busContext: null, nativeAvailable: true,
    });
    expect(getCanNativeProvenanceEvidence().staleCallbacksRejected).toBe(1);
  });

  it('11) çift kayıt GÜVENLİDİR: engellenir ve kanıtlanır', () => {
    recordCanNativeProvenance({
      sourceRef: 'CanAdapter', eventClass: 'DUPLICATE_REGISTRATION_BLOCKED',
      listenerGeneration: 1, currentGeneration: 1, busContext: null, nativeAvailable: true,
    });
    const evidence = getCanNativeProvenanceEvidence();
    expect(evidence.duplicateRegistrationsBlocked).toBe(1);
    expect(evidence.registrations).toBe(0);
  });

  it('10) köprüde ANLAM ÜRETİLMEZ: araç kimliği · ECU rolü · sinyal anlamı YOK', () => {
    const record = recordCanNativeProvenance({
      sourceRef: 'CanAdapter', eventClass: 'FIRST_FRAME',
      listenerGeneration: 1, currentGeneration: 1, busContext: 'usb', nativeAvailable: true,
    });
    const keys = Object.keys(record);
    for (const forbidden of ['vin', 'vehicleId', 'ecuRole', 'signalMeaning', 'healthVerdict', 'calibration']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(record.semanticInferences).toBe(0);
    expect(getCanNativeProvenanceEvidence().semanticInferences).toBe(0);
  });

  it('SAHTE ZAMAN DAMGASI YOK — varış ile native gözlem AYRI', () => {
    const record = recordCanNativeProvenance({
      sourceRef: 'CanAdapter', eventClass: 'FIRST_FRAME',
      listenerGeneration: 1, currentGeneration: 1, busContext: null, nativeAvailable: true,
    });
    expect(record.timestampBasis).toBe('JS_ARRIVAL');
    expect(record.nativeObservedAtMs).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 12–13) SafeStorage tamamlanma kanıtı
 * ════════════════════════════════════════════════════════════════════════ */

describe('ARCH-04/5 SafeStorage tamamlanma kanıtı', () => {
  beforeEach(() => { _resetStorageWriteEvidenceForTest(); });

  const FULL = {
    writeRequested: true, tempWriteCompleted: true, statVerified: true,
    renameCompleted: true, verifyReadCompleted: true, cacheUpdated: true,
    backupUpdated: true,
  } as const;

  it('12) tam tamamlanma SUCCESS üretir ve tüm aşamalar görünür', () => {
    const id = beginStorageWrite('car-launcher-storage', 'NATIVE_FILESYSTEM', 1024);
    for (const stage of REQUIRED_DURABILITY_STAGES) markStorageWriteStage(id, stage);
    markStorageWriteStage(id, 'cacheUpdated');
    markStorageWriteStage(id, 'backupUpdated');
    const record = completeStorageWrite(id, false, null)!;
    expect(record.finalOutcome).toBe('SUCCESS');
    expect(record.durableWriteProven).toBe(true);
    expect(record.failureStage).toBeNull();
    expect(getStorageWriteEvidence().successCount).toBe(1);
  });

  it('13) tmp yazımı düşerse BAŞARI SAYILMAZ', () => {
    const id = beginStorageWrite('k', 'NATIVE_FILESYSTEM', 10);
    const record = completeStorageWrite(id, true, 'writeFile threw')!;
    expect(record.finalOutcome).toBe('FAILED');
    expect(record.failureStage).toBe('tempWriteCompleted');
    expect(record.durableWriteProven).toBe(false);
  });

  it('rename düşerse KISMİ — asla SUCCESS değil', () => {
    const id = beginStorageWrite('k', 'NATIVE_FILESYSTEM', 10);
    markStorageWriteStage(id, 'tempWriteCompleted');
    markStorageWriteStage(id, 'statVerified');
    const record = completeStorageWrite(id, true, 'rename threw')!;
    expect(record.finalOutcome).toBe('PARTIAL_FAILURE');
    expect(record.failureStage).toBe('renameCompleted');
  });

  it('rename BAŞARILI + verify-read DÜŞTÜ → TAM KALICILIK YOK', () => {
    const stages = { ...FULL, verifyReadCompleted: false };
    expect(isDurableWriteProven(stages, 'NATIVE_FILESYSTEM')).toBe(false);
    expect(judgeStorageWriteOutcome(stages, 'NATIVE_FILESYSTEM', false)).toBe('PARTIAL_FAILURE');
    expect(firstFailedStage(stages)).toBe('verifyReadCompleted');
  });

  it('yalnız yedek yazıldıysa ASIL yol sağlıklı SAYILMAZ', () => {
    const stages = {
      writeRequested: true, tempWriteCompleted: false, statVerified: false,
      renameCompleted: false, verifyReadCompleted: false, cacheUpdated: false,
      backupUpdated: true,
    };
    expect(judgeStorageWriteOutcome(stages, 'NATIVE_FILESYSTEM', true)).toBe('BACKUP_ONLY');
    expect(isDurableWriteProven(stages, 'NATIVE_FILESYSTEM')).toBe(false);
  });

  it('cache güncellemesi DAYANIKLILIK kanıtı DEĞİLDİR', () => {
    const stages = { ...FULL, verifyReadCompleted: false, cacheUpdated: true };
    expect(isDurableWriteProven(stages, 'NATIVE_FILESYSTEM')).toBe(false);
    expect(REQUIRED_DURABILITY_STAGES).not.toContain('cacheUpdated');
    expect(REQUIRED_DURABILITY_STAGES).not.toContain('backupUpdated');
  });

  it('kanıt SALT-OKUNUR: dönen kayıtlar dondurulmuş', () => {
    const id = beginStorageWrite('k', 'WEB_STORAGE', 5);
    markStorageWriteStage(id, 'backupUpdated');
    const record = completeStorageWrite(id, false, null)!;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.stages)).toBe(true);
    expect(Object.isFrozen(getStorageWriteEvidence())).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14–15) Yetenek pazarlığı + fallback semantiği
 * ════════════════════════════════════════════════════════════════════════ */

describe('ARCH-04/6 kritik native yetenek pazarlığı', () => {
  it('14) eksik kritik metot FAIL-CLOSED: çökme yok, sahte başarı yok', () => {
    const missing = negotiateNativeMethod({
      id: 'test.missing', domain: 'TEST', bridge: 'CarLauncher',
      method: '__method_that_does_not_exist__', resultSemanticsKnown: false, fallback: null,
    });
    expect(missing.status).toBe('NOT_SUPPORTED');
    expect(missing.methodAvailable).toBe(false);
    expect(missing.nativeCapabilityKnown).toBe('UNAVAILABLE');
    expect(missing.operationProven).toBe(false);
    expect(missing.fallbackAvailable).toBe(false);
  });

  it('metot VAR olması işlem BAŞARILI anlamına GELMEZ', () => {
    for (const row of summarizeNativeNegotiation().rows) {
      expect(row.operationProven).toBe(false);
      expect(row.methodKnown).toBe(true);
    }
  });

  it('kritik köprülerin tamamı pazarlık künyesinde SAYILIR', () => {
    const ids = CRITICAL_NATIVE_METHODS.map((m) => m.id);
    for (const required of ['foreground.start', 'gps.generation_binding',
      'media.authority_command', 'phone.session_control', 'obd.generic_pdu',
      'can.start', 'storage.persist_odometer', 'hardware_media.probe']) {
      expect(ids).toContain(required);
    }
  });

  it('15) YEDEK AKTİF ≠ ASIL SAĞLIKLI — fallback varken FULL üretilmez', () => {
    expect(projectResilience('READY', 'ACTIVE', 'AVAILABLE')).toBe('DEGRADED');
    expect(projectResilience('UNKNOWN', 'ACTIVE', 'UNKNOWN')).toBe('LIMITED');
    expect(projectResilience('READY', 'NONE', 'AVAILABLE')).toBe('FULL');
    expect(projectResilience('NOT_READY', 'AVAILABLE', 'UNAVAILABLE')).toBe('LIMITED');
    expect(projectResilience('NOT_READY', 'NONE', 'UNAVAILABLE')).toBe('UNAVAILABLE');
  });

  it('fallback başarısı native yetenek VARLIĞI anlamına gelmez', () => {
    const row = projectDomainReadiness({
      domainId: 'GPS', permissionState: 'GRANTED', capabilityAvailable: 'UNAVAILABLE',
      serviceEvidence: true, blockers: [], lastResult: 'SUCCESS',
      fallback: 'ACTIVE', provenance: ['test'],
    });
    expect(row.capabilityAvailable).toBe('UNAVAILABLE');
    expect(row.resilience).not.toBe('FULL');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 16–17, 19–21) HAL · foreground · GPS · donanım medya
 * ════════════════════════════════════════════════════════════════════════ */

describe('ARCH-04/8 HAL toplama ve sahiplik sınırları', () => {
  it('16) HAL sağlığı DOMAIN GERÇEĞİ DEĞİLDİR — kaynak satırı hüküm vermez', () => {
    const source = CORPUS.find((f) => f.path === 'platform/native/nativeHalEvidence.ts')!;
    expect(source.text).toContain('HAL SAĞLIĞI DOMAIN GERÇEĞİ DEĞİLDİR');
    /* Kanonik otoritelere GERİ BESLEME yok: HAL kimseye yazmaz. */
    expect(/\.setState\(/.test(source.text)).toBe(false);
    expect(/dispatch\(/.test(source.text)).toBe(false);
  });

  it('17) foreground çağıranları TEK sınırda — başka JS çağıranı YOK', () => {
    const start = callSites('startBackgroundService');
    const stop = callSites('stopBackgroundService');
    expect(start.length).toBeGreaterThan(0);
    expect(stop.length).toBeGreaterThan(0);
    for (const site of [...start, ...stop]) {
      expect(site.path).toBe('hooks/useLayoutServices.ts');
      /* Eski APK'da metot yoksa reddi yutulmalı — çökme YASAK. */
      expect(site.line.includes('.catch(') || site.line.includes('?.')).toBe(true);
    }
  });

  it('18) medya bayat geri çağrısı REDDEDİLİR (nesil kapısı üretimde duruyor)', () => {
    const bridge = CORPUS.find((f) => f.path === 'platform/media/authority/nativeAuthorityBridge.ts')!;
    expect(bridge.text).toContain('generation !== _listenerGeneration');
    expect(bridge.text).toContain('_listenerGeneration += 1');
  });

  it('19) GPS foreground/background nesil bağı TEK kanonik nesilden gelir', () => {
    const sites = callSites('setBackgroundGpsGeneration');
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site.path).toBe('platform/gpsService.ts');
    const layout = CORPUS.find((f) => f.path === 'hooks/useLayoutServices.ts')!;
    /* Foreground servis de AYNI kanonik nesli taşır. */
    expect(layout.text).toContain('getGPSLocationTruthDiagnostics().generation');
  });

  it('20) donanım medya ile uygulama içi komut AYNI sahibe gider', () => {
    const mediaCalls = callSites('mediaAuthorityCommand');
    expect(mediaCalls.length).toBeGreaterThan(0);
    for (const site of mediaCalls) {
      expect(site.path).toBe('platform/media/authority/nativeAuthorityBridge.ts');
    }
  });

  it('21) CAN dinleyici temizliği ve nesil artışı üretimde duruyor', () => {
    const adapter = CORPUS.find((f) => f.path === 'platform/vehicleDataLayer/CanAdapter.ts')!;
    expect(adapter.text).toContain('this._listenerGeneration += 1');
    expect(adapter.text).toContain('handle.remove()');
    expect(adapter.text).toContain('STALE_CALLBACK_REJECTED');
    expect(adapter.text).toContain('DUPLICATE_REGISTRATION_BLOCKED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 22–24) Doğrudan native atlatma + gizlilik
 * ════════════════════════════════════════════════════════════════════════ */

const CRITICAL_METHOD_NAMES: readonly string[] = Object.freeze([
  'startBackgroundService', 'stopBackgroundService', 'setBackgroundGpsGeneration',
  'mediaAuthorityConnect', 'mediaAuthorityCommand', 'sendDiagnosticPdu',
  'startCanBus', 'stopCanBus', 'persistOdometer',
]);

describe('ARCH-04/11 doğrudan native atlatma denetimi', () => {
  it('22) UI kritik native köprüyü DOĞRUDAN çağırmaz', () => {
    expect(UI_CORPUS.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of UI_CORPUS) {
      for (const method of CRITICAL_METHOD_NAMES) {
        if (!new RegExp(`CarLauncher\\.${method}\\b`).test(file.text)) continue;
        /* Foreground yaşam döngüsünün TEK kanonik çağıranı istisnadır. */
        if (file.path === 'hooks/useLayoutServices.ts'
          && (method === 'startBackgroundService' || method === 'stopBackgroundService')) continue;
        offenders.push(`${file.path}:${method}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('23) Mavi kritik native köprüyü DOĞRUDAN çağırmaz', () => {
    const offenders: string[] = [];
    for (const file of MAVI_CORPUS) {
      for (const method of CRITICAL_METHOD_NAMES) {
        if (new RegExp(`CarLauncher\\.${method}\\b`).test(file.text)) {
          offenders.push(`${file.path}:${method}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('kritik metotların HER çağrı satırı fail-closed sarmalı içinde', () => {
    let inspected = 0;
    for (const method of CRITICAL_METHOD_NAMES) {
      for (const site of callSites(method)) {
        if (site.path.startsWith('platform/native/nativeHalEvidence')) continue;
        if (site.path.startsWith('platform/native/nativeBoundaryContract')) continue;
        if (site.line.startsWith('*') || site.line.startsWith('//')) continue;
        inspected += 1;
        const guarded = site.line.includes('?.')
          || site.line.includes('.catch(')
          || site.line.includes('typeof ')
          || site.line.includes('const fn =')
          || site.line.includes('await ');
        expect(`${site.path} → ${site.line}`).toBe(guarded ? `${site.path} → ${site.line}` : 'UNGUARDED');
      }
    }
    /* Kör guard yasağı: hiçbir çağrı satırı görülmediyse kilit ARIZALIDIR. */
    expect(inspected).toBeGreaterThan(5);
  });

  it('24) LAB native sınır ekranı hassas alan TAŞIMAZ', () => {
    const screen = CORPUS.find((f) => f.path === 'components/devtools/screens/NativeBoundaryHalScreen.tsx')!;
    for (const forbidden of ['peerFingerprint', 'pairingCode', 'apiKey', 'token',
      'latitude', 'longitude', 'macAddress', 'vin']) {
      expect(screen.text.includes(forbidden)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 25–26) Uygunluk matrisi + LAB salt-okunurluk
 * ════════════════════════════════════════════════════════════════════════ */

describe('ARCH-04/10 uygunluk matrisi', () => {
  it('25) matris GERÇEK kanıttan doldurulur ve kanıtsız PASS ÜRETMEZ', () => {
    const matrix = buildNativeConformanceMatrix();
    expect(matrix.rows.length).toBe(getNativeCapabilityDescriptors().length);
    expect(matrix.criticalRowsWithFakePass).toEqual([]);
    for (const row of matrix.rows) {
      expect(row.evidence.length).toBeGreaterThan(0);
      if (row.status !== 'PASS') expect(row.gap).not.toBe('NONE');
    }
  });

  it('kanıt yoksa satır PASS değil UNKNOWN olur ve sebebi ayırt edilir', () => {
    const descriptor = getNativeCapabilityDescriptors()[0]!;
    const row = assessConformanceRow(descriptor, null,
      assessNativeBoundaryConformance(descriptor));
    expect(row.status).toBe('UNKNOWN');
    expect(row.gap).toBe('EVIDENCE_MISSING');
    expect(row.evidence).toContain('KAYNAK YOK');
  });

  it('kritik yetenek listesi matris satırlarıyla ÖRTÜŞÜR', () => {
    const ids = getNativeCapabilityDescriptors().map((d) => d.id);
    for (const critical of CRITICAL_CAPABILITY_IDS) expect(ids).toContain(critical);
  });

  it('26) LAB ekranı TAMAMEN SALT-OKUNUR — aktif komut göndermez', () => {
    const screen = CORPUS.find((f) => f.path === 'components/devtools/screens/NativeBoundaryHalScreen.tsx')!;
    for (const forbidden of ['requestPermissions', 'startBackgroundService',
      'stopBackgroundService', 'sendDiagnosticPdu', 'mediaAuthorityCommand',
      'startCanBus', 'stopCanBus', 'setBluetooth', 'safeRemoveRaw', 'clearCompanionStorage',
      'startPhoneHubServer', 'confirmPhoneHubPairing']) {
      expect(screen.text.includes(forbidden)).toBe(false);
    }
    /* Timer/abonelik YOK: açılışta tek okuma + elle YENİLE. */
    expect(screen.text.includes('setInterval')).toBe(false);
    expect(screen.text.includes('useEffect')).toBe(false);

    const sources = CORPUS.find((f) => f.path === 'platform/devtools/nativeBoundarySources.ts')!;
    expect(sources.text.includes('setInterval')).toBe(false);
    expect(sources.text.includes('addListener')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 27–29) Önceki ARCH turlarının sınırları DEĞİŞMEDİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('ARCH-04 önceki turların sınırlarını EZMEZ', () => {
  it('27) ARCH-01 sahipleri değişmedi — HAL registry sahipliğini devralmaz', () => {
    const hal = CORPUS.find((f) => f.path === 'platform/native/nativeHalEvidence.ts')!;
    /* HAL kaynak satırı yazar; runtime registry/lifecycle sahipliğine dokunmaz. */
    expect(hal.text.includes('buildRuntimeServiceRegistry')).toBe(false);
    expect(hal.text.includes('systemBoot')).toBe(false);
  });

  it('28) ARCH-02 gerçeği değişmedi — köprü kanıtı signal/state gerçeği yazmaz', () => {
    for (const path of ['platform/obd/obdNativeProvenance.ts',
      'platform/vehicleDataLayer/canNativeProvenance.ts',
      'platform/phoneHub/phoneHubNativeIngress.ts']) {
      const file = CORPUS.find((f) => f.path === path)!;
      expect(file.text.includes('.setState(')).toBe(false);
      expect(file.text.includes('signalHub')).toBe(false);
      expect(file.text.includes('UnifiedVehicleStore')).toBe(false);
    }
  });

  it('29) ARCH-03 komut sahipleri değişmedi — kanıt yolları komut göndermez', () => {
    for (const path of ['platform/obd/obdNativeProvenance.ts',
      'platform/vehicleDataLayer/canNativeProvenance.ts',
      'platform/phoneHub/phoneHubNativeIngress.ts',
      'platform/native/nativeCapabilityNegotiation.ts',
      'utils/safeStorageWriteEvidence.ts']) {
      const file = CORPUS.find((f) => f.path === path)!;
      expect(/CarLauncher\.[a-zA-Z]+\(/.test(file.text)).toBe(false);
      expect(/PhoneHubLink\.[a-zA-Z]+\(/.test(file.text)).toBe(false);
    }
  });
});
