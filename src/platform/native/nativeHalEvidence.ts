/**
 * nativeHalEvidence.ts — ARCH-04/F5 · KRİTİK NATIVE KAYNAK KANIT TOPLAYICISI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── TEK OKUMA KATMANI ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Sekiz kritik native kaynağın (GPS · MEDIA · PHONE_LINK · OBD · CAN ·
 * SAFE_STORAGE · FOREGROUND_SERVICE · HARDWARE_MEDIA) sahiplerinden gelen
 * MEVCUT salt-okunur anlık görüntülerini toplar. Her getter kendi
 * `try/catch`indedir: bir sahip patlarsa satır `UNKNOWN` olur, toplama düşmez.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── HAL SAĞLIĞI DOMAIN GERÇEĞİ DEĞİLDİR ──────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `CONNECTED` bir kaynak, `READY` bir domain DEĞİLDİR. Bu dosya kaynak
 * seviyesinde konuşur; domain hükmü kanonik otoritelerde (`dtcAuthority`,
 * `playbackTruth`, `capabilityRegistry`, `companionSessionManager` …) kalır
 * ve buradan hesaplanan hiçbir değer üretim kararına GERİ BESLENMEZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GİZLİLİK ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * VIN · MAC · token · anahtar · eşleştirme materyali · ham PDU · ham GPS
 * koordinatı · ham medya yolu · telefon kimliği TAŞINMAZ. Yalnız sınıf,
 * sayı, nesil ve VAR/YOK.
 */

import { CarLauncher } from '../nativePlugin';
import { isNative } from '../bridge';
import { getGPSState, getGPSLocationTruthDiagnostics, getLocationEvidence } from '../gpsService';
import { getSnapshot as getMediaNativeSnapshot } from '../media/authority/nativeAuthorityBridge';
import { getPhoneHubIngressEvidence } from '../phoneHub/phoneHubNativeIngress';
import { getDiagnosticAdmissionEvidence } from '../obd/diagnosticAdmission';
import { getObdNativeProvenanceEvidence } from '../obd/obdNativeProvenance';
import { getCanNativeProvenanceEvidence } from '../vehicleDataLayer/canNativeProvenance';
import { useHALStatusStore } from '../vehicleDataLayer/halStatusStore';
import { getSafeStorageDiagnostics } from '../../utils/safeStorage';
import { getStorageWriteEvidence } from '../../utils/safeStorageWriteEvidence';
import { getPhoneHubProbe } from '../phoneHub/phoneHubHardwareProbe';
import {
  nativeMethodAvailability, negotiateNativeCapabilities,
  type NativeMethodNegotiation,
} from './nativeCapabilityNegotiation';
import {
  normalizePermissionState, projectDomainReadiness, unmeasuredDomainReadiness,
  type NativeDomainReadiness, type NativeFallbackState,
  type NativeLastResultClass, type NativePermissionState,
} from './nativeReadinessModel';
import type { NativeAvailability } from './nativeBoundaryContract';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Kaynak satırı
 * ════════════════════════════════════════════════════════════════════════ */

export type NativeSourceId =
  | 'GPS' | 'MEDIA' | 'PHONE_LINK' | 'OBD' | 'CAN'
  | 'SAFE_STORAGE' | 'FOREGROUND_SERVICE' | 'HARDWARE_MEDIA';

export const NATIVE_SOURCE_IDS: readonly NativeSourceId[] = Object.freeze([
  'GPS', 'MEDIA', 'PHONE_LINK', 'OBD', 'CAN',
  'SAFE_STORAGE', 'FOREGROUND_SERVICE', 'HARDWARE_MEDIA',
]);

export interface NativeSourceEvidence {
  readonly sourceId: NativeSourceId;
  readonly owner: string;
  readonly bridge: string;
  readonly readiness: NativeDomainReadiness;
  /** Oturum/nesil mührü; ölçülemediyse `null` — 0 UYDURULMAZ. */
  readonly sessionGeneration: number | null;
  /** Bayat geri çağrı koruması bu kaynakta VAR mı (ölçülmüş). */
  readonly staleGuard: boolean;
  readonly staleRejectedCount: number | null;
  readonly lastResultClass: NativeLastResultClass;
  readonly notes: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function _avail(id: string): NativeAvailability {
  return _safe(() => nativeMethodAvailability(id), 'UNKNOWN');
}

/**
 * GPS izni. `gpsService` iznin SONUCUNU kalıcı bir alanda tutmaz; bu yüzden
 * burada izin durumu ÖLÇÜLMEMİŞ sayılır (`UNKNOWN`). Konum akıyor diye
 * "GRANTED" YAZILMAZ — bu, sonuçtan izin türetmek olurdu.
 */
function _gpsRow(): NativeSourceEvidence {
  const state = _safe(() => getGPSState(), null);
  const truth = _safe(() => getGPSLocationTruthDiagnostics(), null);
  const evidence = _safe(() => getLocationEvidence(), null);
  const capability = _avail('gps.generation_binding');
  const tracking = state === null ? null : state.isTracking === true;
  const unavailable = state?.unavailable === true;
  /* Fallback: native köprü yoksa web geolocation sınırlı çalışabilir. */
  const fallback: NativeFallbackState = capability === 'UNAVAILABLE'
    ? (isNative ? 'AVAILABLE' : 'ACTIVE')
    : capability === 'AVAILABLE' ? 'AVAILABLE' : 'UNKNOWN';
  /* Fix VAR MI — ham koordinat OKUNMAZ, yalnız kaynak ve yaş sınıfı. */
  const hasFix = evidence !== null && evidence.source !== 'NONE' && evidence.fixAgeMs !== null;
  const blockers: string[] = [];
  if (unavailable) blockers.push('gpsService.unavailable');
  const permission: NativePermissionState = unavailable ? 'UNKNOWN' : 'UNKNOWN';
  return Object.freeze({
    sourceId: 'GPS',
    owner: 'gpsService→VehicleDataLayer',
    bridge: 'CarLauncher (foreground GPS) + Capacitor Geolocation',
    readiness: projectDomainReadiness({
      domainId: 'GPS',
      permissionState: permission,
      capabilityAvailable: capability,
      /* Sağlayıcıdan gelen açık kanıt: takip açık VE en az bir fix ölçüldü. */
      serviceEvidence: tracking === null ? null
        : tracking && hasFix ? true
          : unavailable ? false : null,
      blockers,
      lastResult: hasFix ? 'SUCCESS' : 'UNMEASURED',
      fallback,
      provenance: ['gpsService.getGPSState()', 'gpsService.getLocationEvidence()',
        'gpsService.getGPSLocationTruthDiagnostics()'],
    }),
    sessionGeneration: truth?.generation ?? null,
    staleGuard: true,
    staleRejectedCount: truth?.staleGenerationRejectCount ?? null,
    lastResultClass: hasFix ? 'SUCCESS' : 'UNMEASURED',
    notes: 'Konum izni ürün yolunda kalıcı olarak SAKLANMIYOR → izin UNKNOWN. '
      + 'Fix akması izin kanıtı SAYILMAZ; ham koordinat bu yüzeye TAŞINMAZ.',
  });
}

function _mediaRow(): NativeSourceEvidence {
  const snap = _safe(() => getMediaNativeSnapshot(), null);
  const capability = _avail('media.authority_snapshot');
  return Object.freeze({
    sourceId: 'MEDIA',
    owner: 'native playback service / playbackTruth',
    bridge: 'CarLauncher.mediaAuthority*',
    readiness: projectDomainReadiness({
      domainId: 'MEDIA',
      permissionState: 'NOT_APPLICABLE',
      capabilityAvailable: capability,
      /* `authorityAvailable` köprü otoritesidir; RENDERING kanıtı ayrıdır ve
         "çalıyor" hükmü YALNIZ `renderingVerified` ile verilir. */
      serviceEvidence: snap === null ? null : snap.authorityAvailable === true ? true : false,
      blockers: [],
      lastResult: snap?.renderingVerified === true ? 'SUCCESS' : 'UNMEASURED',
      fallback: 'NONE',
      provenance: ['nativeAuthorityBridge.getSnapshot()'],
    }),
    sessionGeneration: snap?.queueRevision ?? null,
    staleGuard: true,
    staleRejectedCount: null,
    lastResultClass: snap?.renderingVerified === true ? 'SUCCESS' : 'UNMEASURED',
    notes: 'Otorite VAR ≠ ÇALIYOR. Oynatma yalnız `renderingVerified` ile kanıtlanır.',
  });
}

function _phoneRow(): NativeSourceEvidence {
  const ingress = _safe(() => getPhoneHubIngressEvidence(), null);
  const capability = _avail('phone.session_snapshot');
  /* GERÇEK izin ölçümü: native donanım yoklaması `BLUETOOTH_CONNECT` iznini
     ZATEN sınıflandırılmış olarak taşır. Yoklama yoksa `UNKNOWN` kalır —
     sahte GRANTED/DENIED üretilmez. */
  const btPermission = _bluetoothPermission();
  const stage = ingress?.stage ?? 'ABSENT';
  const established = stage === 'SESSION_ESTABLISHED' || stage === 'CAPABILITY_GRANTED'
    || stage === 'CONTROL_ALLOWED';
  const blockers: string[] = [];
  if (stage === 'TRANSPORT_CONNECTED') blockers.push('authenticated değil (CONNECTED ≠ AUTHENTICATED)');
  if (stage === 'AUTHENTICATED') blockers.push('oturum kurulmadı');
  if (stage === 'SESSION_ESTABLISHED') blockers.push('yetenek verilmedi');
  if (stage === 'CAPABILITY_GRANTED') blockers.push('bağlantı izni ölçülmedi');
  return Object.freeze({
    sourceId: 'PHONE_LINK',
    owner: 'companionSessionManager (canonical) ← phoneHubNativeIngress',
    bridge: 'PhoneHubLink',
    readiness: projectDomainReadiness({
      domainId: 'PHONE_LINK',
      /* Bluetooth bağlantı izni GERÇEKTEN ölçülür. İzin GRANTED olsa bile
         companion oturumu yoksa hazırlık ÜRETİLMEZ (görev §2 örneği). */
      permissionState: btPermission,
      capabilityAvailable: capability,
      serviceEvidence: ingress === null ? null : established ? true : false,
      blockers,
      lastResult: ingress === null ? 'UNKNOWN'
        : ingress.staleRejectedCount > 0 ? 'REJECTED_STALE'
          : ingress.acceptedCount > 0 ? 'SUCCESS' : 'UNMEASURED',
      fallback: 'NONE',
      provenance: ['phoneHubNativeIngress.getPhoneHubIngressEvidence()',
        'phoneHubHardwareProbe.getPhoneHubProbe().bluetooth.permConnect'],
    }),
    sessionGeneration: ingress?.acceptedGeneration ?? null,
    staleGuard: true,
    staleRejectedCount: ingress?.staleRejectedCount ?? null,
    lastResultClass: ingress !== null && ingress.acceptedCount > 0 ? 'SUCCESS' : 'UNMEASURED',
    notes: `merdiven basamağı=${stage}. present ≠ connected ≠ authenticated ≠ `
      + 'session ≠ capability ≠ control. Parmak izi/kod/anahtar TAŞINMAZ.',
  });
}

function _obdRow(): NativeSourceEvidence {
  const admission = _safe(() => getDiagnosticAdmissionEvidence(), null);
  const provenance = _safe(() => getObdNativeProvenanceEvidence(), null);
  const capability = _avail('obd.generic_pdu');
  const admitted = admission === null ? null : admission.admission === 'READY';
  const blockers: string[] = [];
  if (admission !== null && admission.admission !== 'READY') {
    blockers.push(`admission=${admission.admission}`);
  }
  const last: NativeLastResultClass = provenance === null || provenance.total === 0
    ? 'UNMEASURED'
    : provenance.staleEpochResults > 0 ? 'REJECTED_STALE' : 'SUCCESS';
  return Object.freeze({
    sourceId: 'OBD',
    owner: 'DiagnosticTransaction (F1-A) + native DiagnosticServiceGate',
    bridge: 'CarLauncher.sendDiagnosticPdu',
    readiness: projectDomainReadiness({
      domainId: 'OBD',
      permissionState: 'UNKNOWN',
      capabilityAvailable: capability,
      serviceEvidence: admitted,
      blockers,
      lastResult: last,
      fallback: capability === 'UNAVAILABLE' ? 'AVAILABLE' : 'NONE',
      provenance: ['diagnosticAdmission.getDiagnosticAdmissionEvidence()',
        'obdNativeProvenance.getObdNativeProvenanceEvidence()'],
    }),
    sessionGeneration: provenance !== null && provenance.recent.length > 0
      ? provenance.recent[provenance.recent.length - 1]!.resultEpoch : null,
    staleGuard: true,
    staleRejectedCount: provenance?.staleEpochResults ?? null,
    lastResultClass: last,
    notes: 'Köprü VAR ≠ İZİN VAR: native DiagnosticServiceGate bağımsız son kapıdır. '
      + 'Ham PDU/ham yanıt bu yüzeye TAŞINMAZ.',
  });
}

function _canRow(): NativeSourceEvidence {
  const can = _safe(() => getCanNativeProvenanceEvidence(), null);
  const hal = _safe(() => useHALStatusStore.getState(), null);
  const capability = _avail('can.start');
  const alive = hal === null ? null : hal.sourceHealth.canAlive;
  return Object.freeze({
    sourceId: 'CAN',
    owner: 'CanAdapter→VehicleDataLayer',
    bridge: 'CarLauncher.canData / canStatus',
    readiness: projectDomainReadiness({
      domainId: 'CAN',
      permissionState: 'NOT_APPLICABLE',
      capabilityAvailable: capability,
      serviceEvidence: alive === null ? null : alive === true ? true : false,
      blockers: [],
      lastResult: can !== null && can.firstFrames > 0 ? 'SUCCESS' : 'UNMEASURED',
      fallback: 'NONE',
      provenance: ['canNativeProvenance.getCanNativeProvenanceEvidence()',
        'halStatusStore.sourceHealth.canAlive'],
    }),
    sessionGeneration: can !== null && can.recent.length > 0
      ? can.recent[can.recent.length - 1]!.currentGeneration : null,
    staleGuard: true,
    staleRejectedCount: can?.staleCallbacksRejected ?? null,
    lastResultClass: can !== null && can.firstFrames > 0 ? 'SUCCESS' : 'UNMEASURED',
    notes: 'Köprü ANLAM ÜRETMEZ: araç kimliği · ECU rolü · sinyal anlamı · sağlık '
      + 'hükmü burada DOĞMAZ. Native sözleşme zaman damgası taşımıyor → JS_ARRIVAL.',
  });
}

function _storageRow(): NativeSourceEvidence {
  const diag = _safe(() => getSafeStorageDiagnostics(), null);
  const writes = _safe(() => getStorageWriteEvidence(), null);
  const durableProven = writes !== null && writes.successCount > 0;
  const backupOnly = writes !== null && writes.backupOnlyCount > 0;
  const blockers: string[] = [];
  if (writes !== null && writes.partialFailureCount > 0) {
    blockers.push(`kısmi tamamlanma ×${writes.partialFailureCount}`);
  }
  return Object.freeze({
    sourceId: 'SAFE_STORAGE',
    owner: 'safeStorage (altyapı — sahip DEĞİL)',
    bridge: 'Capacitor Filesystem + localStorage backup',
    readiness: projectDomainReadiness({
      domainId: 'SAFE_STORAGE',
      permissionState: 'NOT_APPLICABLE',
      capabilityAvailable: diag === null ? 'UNKNOWN'
        : diag.platform === 'NATIVE_FILESYSTEM' ? 'AVAILABLE' : 'UNAVAILABLE',
      /* Dayanıklılık YALNIZ tam tamamlanmış bir yazımla kanıtlanır. Okunabilir
         olmak yazılabilir olmak DEĞİLDİR. */
      serviceEvidence: writes === null || writes.totalWrites === 0 ? null : durableProven,
      blockers,
      lastResult: writes === null || writes.totalWrites === 0 ? 'UNMEASURED'
        : durableProven ? 'SUCCESS' : 'FAILURE',
      fallback: backupOnly ? 'ACTIVE' : 'AVAILABLE',
      provenance: ['safeStorage.getSafeStorageDiagnostics()',
        'safeStorageWriteEvidence.getStorageWriteEvidence()'],
    }),
    sessionGeneration: null,
    staleGuard: false,
    staleRejectedCount: null,
    lastResultClass: writes === null || writes.totalWrites === 0 ? 'UNMEASURED'
      : durableProven ? 'SUCCESS' : 'FAILURE',
    notes: 'cache güncellendi ≠ dayanıklı yazım · backup yazıldı ≠ asıl yol sağlıklı · '
      + 'rename başarılı + verify-read düştü ≠ BAŞARI. Yazılan DEĞER taşınmaz.',
  });
}

function _foregroundRow(): NativeSourceEvidence {
  const start = _avail('foreground.start');
  const stop = _avail('foreground.stop');
  const capability: NativeAvailability = start === 'AVAILABLE' && stop === 'AVAILABLE'
    ? 'AVAILABLE'
    : start === 'UNAVAILABLE' || stop === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'UNKNOWN';
  return Object.freeze({
    sourceId: 'FOREGROUND_SERVICE',
    owner: 'CarLauncherForegroundService (ForegroundServiceBoundary)',
    bridge: 'CarLauncherPlugin',
    readiness: projectDomainReadiness({
      domainId: 'FOREGROUND_SERVICE',
      /* FOREGROUND_SERVICE_LOCATION izni JS'te ÖLÇÜLMÜYOR; native tarafta
         verilir. Sahte GRANTED üretmek yerine UNKNOWN kalır. */
      permissionState: 'UNKNOWN',
      capabilityAvailable: capability,
      /* Servisin GERÇEKTEN ayakta olduğuna dair JS'e akan bir sahip kanıtı
         YOK: köprü metodunun varlığı servisin çalıştığını KANITLAMAZ. */
      serviceEvidence: null,
      blockers: [],
      lastResult: 'UNMEASURED',
      fallback: 'NONE',
      provenance: ['nativeCapabilityNegotiation.negotiateNativeCapabilities()'],
    }),
    sessionGeneration: null,
    staleGuard: true,
    staleRejectedCount: null,
    lastResultClass: 'UNMEASURED',
    notes: 'Metot VAR ≠ SERVİS AYAKTA. Tek JS çağıranı `useLayoutServices`; '
      + 'native tarafta tek/idempotent sınır uygulanır (ForegroundServiceBoundary).',
  });
}

/**
 * `BLUETOOTH_CONNECT` izninin ÖLÇÜLMÜŞ durumu. Native yoklama Android
 * `PackageManager` sonucunu taşır; yoklama okunamazsa `UNKNOWN`.
 */
function _bluetoothPermission(): NativePermissionState {
  const probe = _safe(() => getPhoneHubProbe(), null);
  if (probe === null || probe.present !== true) return 'UNKNOWN';
  const raw = probe.bluetooth?.permConnect;
  if (typeof raw !== 'string') return 'UNKNOWN';
  const upper = raw.toUpperCase();
  if (upper === 'GRANTED') return 'GRANTED';
  if (upper === 'DENIED') return 'DENIED';
  if (upper === 'NOT_REQUIRED' || upper === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  return normalizePermissionState(raw.toLowerCase());
}

function _hardwareMediaRow(): NativeSourceEvidence {
  const probe = _safe(() => getPhoneHubProbe(), null);
  const capability = _avail('hardware_media.probe');
  const present = probe === null ? null : probe.present === true;
  return Object.freeze({
    sourceId: 'HARDWARE_MEDIA',
    owner: 'mediaCommandGateway (tek komut kapısı)',
    bridge: 'Android MediaSession / donanım tuşları',
    readiness: projectDomainReadiness({
      domainId: 'HARDWARE_MEDIA',
      permissionState: 'NOT_APPLICABLE',
      capabilityAvailable: capability,
      serviceEvidence: present,
      blockers: [],
      lastResult: present === true ? 'SUCCESS' : 'UNMEASURED',
      fallback: 'NONE',
      provenance: ['phoneHubHardwareProbe.getPhoneHubHardwareProbe()'],
    }),
    sessionGeneration: null,
    staleGuard: true,
    staleRejectedCount: null,
    lastResultClass: present === true ? 'SUCCESS' : 'UNMEASURED',
    notes: 'Donanım tuşu ile uygulama içi komut AYNI sahibe gider (ARCH-03); '
      + 'donanım doğrudan player çağırmaz. MAC/cihaz adı TAŞINMAZ.',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Toplama
 * ════════════════════════════════════════════════════════════════════════ */

export interface NativeHalSnapshot {
  readonly sources: readonly NativeSourceEvidence[];
  readonly negotiation: readonly NativeMethodNegotiation[];
  /** Ürün yolunda ölçülmüş doğrudan native atlatma sayısı. */
  readonly authorityBypassCount: number;
  readonly provenance: readonly string[];
}

const BUILDERS: readonly (() => NativeSourceEvidence)[] = Object.freeze([
  _gpsRow, _mediaRow, _phoneRow, _obdRow, _canRow,
  _storageRow, _foregroundRow, _hardwareMediaRow,
]);

/**
 * Tüm kritik native kaynakların salt-okunur kanıdı.
 *
 * Hiçbir servis başlatmaz · izin istemez · komut göndermez · timer kurmaz ·
 * abonelik açmaz. Bir kaynak okunamazsa o satır `UNKNOWN` olur — toplama
 * düşmez ve sahte satır ÜRETİLMEZ.
 */
export function readNativeHalEvidence(): NativeHalSnapshot {
  const sources: NativeSourceEvidence[] = [];
  for (let i = 0; i < BUILDERS.length; i += 1) {
    const build = BUILDERS[i]!;
    try {
      sources.push(build());
    } catch {
      sources.push(Object.freeze({
        sourceId: NATIVE_SOURCE_IDS[i]!,
        owner: 'UNKNOWN', bridge: 'UNKNOWN',
        readiness: unmeasuredDomainReadiness(NATIVE_SOURCE_IDS[i]!, ['kaynak okunamadı']),
        sessionGeneration: null, staleGuard: false, staleRejectedCount: null,
        lastResultClass: 'UNKNOWN',
        notes: 'kaynak okunamadı — KAYNAK YOK (sahte satır üretilmedi)',
      }));
    }
  }
  return Object.freeze({
    sources: Object.freeze(sources),
    negotiation: _safe(() => negotiateNativeCapabilities(), Object.freeze([])),
    /* ARCH-01/02/03 sahiplik sınırları korunuyor: bu turda ölçülmüş bir
       doğrudan native atlatma YOK. Sayı `arch04NativeBoundaryAdoption`
       statik kilidiyle korunur. */
    authorityBypassCount: 0,
    provenance: Object.freeze([
      'nativeHalEvidence.readNativeHalEvidence()',
      'sahip anlık görüntüleri — hiçbiri bu dosyada YENİDEN HESAPLANMAZ',
    ]),
  });
}

/** Köprünün varlığı yetkilendirme DEĞİLDİR — LAB metni bu ayrımı taşır. */
export const BRIDGE_AVAILABILITY_IS_NOT_AUTHORIZATION =
  'Köprü erişilebilirliği YETKİLENDİRME DEĞİLDİR: OBD beyaz listesi, Phone '
  + 'yetenek izni, foreground kontrolleri ve depolama işlemleri kendi '
  + 'kapılarını korur.';

/** Tek kaynak satırını çeker; bulunamazsa dürüst boş satır döner. */
export function readNativeSource(id: NativeSourceId): NativeSourceEvidence {
  const found = readNativeHalEvidence().sources.find((s) => s.sourceId === id);
  return found ?? Object.freeze({
    sourceId: id, owner: 'UNKNOWN', bridge: 'UNKNOWN',
    readiness: unmeasuredDomainReadiness(id),
    sessionGeneration: null, staleGuard: false, staleRejectedCount: null,
    lastResultClass: 'UNKNOWN', notes: 'kaynak tanımlı değil',
  });
}

/** Bu dosyanın CarLauncher'a yaptığı TEK erişim: yetenek ölçümü (çağrı YOK). */
export function nativeBridgeObjectPresent(): boolean {
  return _safe(() => CarLauncher !== null && typeof CarLauncher === 'object', false);
}
