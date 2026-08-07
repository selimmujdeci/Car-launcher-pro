/**
 * phoneHubFieldModel.ts — Phone Hub SAHA DOĞRULAMA aracının SAF modeli (P0.8).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu YOK.
 * Zaman DAİMA çağırandan parametre olarak gelir → gerçek birim testi mümkün.
 *
 * ── BU DOSYA NE ÜRETİR, NE ÜRETMEZ ──────────────────────────────────────────
 * ÜRETİR: cihaz rolü kapısı · senaryo durum makinesi · authority karar motoru ·
 * coexistence hükmü · readiness kuralları · PII'siz dışa aktarma gövdesi · şema göçü.
 * ÜRETMEZ: hiçbir bağlantı, komut, izin isteği veya sistem durumu değişikliği.
 * Bu dosya bir GÖZLEM DEFTERİDİR, bir kontrol düzlemi DEĞİLDİR.
 *
 * ── PAZARLIKSIZ KURALLAR ────────────────────────────────────────────────────
 *  1. UNKNOWN VARSAYILANDIR. Kanıt yoksa hiçbir alan "başarılı" görünmez.
 *  2. TELEFONDA ALINAN KANIT HEAD UNIT OTORİTESİ ÜRETMEZ (rol kapısı zorunlu).
 *  3. Tek zayıf paket eşleşmesi authority kanıtı DEĞİLDİR.
 *  4. Profil/servis VARLIĞI authority kanıtı DEĞİLDİR — bağlıyken GÖZLEM şarttır.
 *  5. Çelişkili kanıt → HYBRID veya UNKNOWN; asla "biri kazanır" denmez.
 *  6. P1-A için control-plane güveni EN AZ MEDIUM olmalı.
 *  7. PII yapısal olarak taşınmaz; ayrıca dışa aktarımda ikinci kez süzülür.
 *
 * Gözlemlenebilirlik sınıflandırması `sessionInspectorModel` sözleşmesini KULLANIR
 * (OBSERVED · DERIVED · UNAVAILABLE · STALE) — paralel sistem KURULMAZ.
 */

import type { Observability } from './sessionInspectorModel';
import type { PhoneHubProbeRaw } from './phoneHubProbeModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler / sınırlar
 * ════════════════════════════════════════════════════════════════════════ */

export const PH_FIELD_SCHEMA_VERSION = 1;
export const PH_FIELD_STORAGE_KEY = 'caros.lab.phoneHubFieldSession.v1';
export const PH_FIELD_EXPORT_SCHEMA = 'caros.phonehub.fieldvalidation.v1';

/** Yakalanmış senaryo bu yaştan sonra BAYAT sayılır (donanım durumu değişir). */
export const SCENARIO_STALE_MS = 30 * 60_000;
/** Oturumun tamamı bu yaştan sonra bayat kabul edilir (yeni oturum önerilir). */
export const SESSION_STALE_MS = 24 * 60 * 60_000;

export const MAX_EVIDENCE_PER_SCENARIO = 24;
export const MAX_OBSERVATIONS_PER_SCENARIO = 32;
export const MAX_BLOCKERS = 24;
export const MAX_TEXT_CHARS = 240;
export const MAX_EXPORT_BYTES = 256 * 1024;

/* ══════════════════════════════════════════════════════════════════════════
 * Enum sözleşmeleri (native ile AYNI dizeler)
 * ════════════════════════════════════════════════════════════════════════ */

export type DeviceRole =
  | 'HEAD_UNIT_CONFIRMED' | 'PHONE_CONFIRMED' | 'ANDROID_DEVICE_UNKNOWN' | 'UNAVAILABLE';

export const DEVICE_ROLE_LABEL: Readonly<Record<DeviceRole, string>> = {
  HEAD_UNIT_CONFIRMED:    'HEAD UNIT DOĞRULANDI',
  PHONE_CONFIRMED:        'TELEFON DOĞRULANDI',
  ANDROID_DEVICE_UNKNOWN: 'ANDROID CİHAZ — ROL BİLİNMİYOR',
  UNAVAILABLE:            'KİMLİK OKUNAMADI',
} as const;

export type Confidence = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = {
  NONE: 'GÜVEN YOK', LOW: 'DÜŞÜK', MEDIUM: 'ORTA', HIGH: 'YÜKSEK',
} as const;

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = {
  NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3,
} as const;

export type ScenarioId =
  | 'BASELINE_HEAD_UNIT' | 'PHONE_CONNECTED' | 'PHONE_MEDIA_ACTIVE'
  | 'OBD_CONNECTED' | 'PHONE_AND_OBD_CONNECTED';

export const SCENARIO_ORDER: readonly ScenarioId[] = [
  'BASELINE_HEAD_UNIT', 'PHONE_CONNECTED', 'PHONE_MEDIA_ACTIVE',
  'OBD_CONNECTED', 'PHONE_AND_OBD_CONNECTED',
] as const;

export const SCENARIO_TITLE: Readonly<Record<ScenarioId, string>> = {
  BASELINE_HEAD_UNIT:      '1 · Baseline (telefon ve OBD YOK)',
  PHONE_CONNECTED:         '2 · Telefon Bağlı',
  PHONE_MEDIA_ACTIVE:      '3 · Telefon Medyası Aktif',
  OBD_CONNECTED:           '4 · OBD Bağlı',
  PHONE_AND_OBD_CONNECTED: '5 · Telefon + OBD Birlikte',
} as const;

/** Her adımda gösterilecek AÇIK talimat (görev §4 — birebir). */
export const SCENARIO_INSTRUCTION: Readonly<Record<ScenarioId, string>> = {
  BASELINE_HEAD_UNIT:
    'Telefon ve OBD bağlı değilken ölçüm alın.',
  PHONE_CONNECTED:
    'Telefonu aracın mevcut Bluetooth ekranından normal şekilde bağlayın. CAROS bağlantı başlatmaz.',
  PHONE_MEDIA_ACTIVE:
    'Telefonda müziği manuel başlatın. CAROS medya komutu göndermez.',
  OBD_CONNECTED:
    'OBD adaptörünü CAROS’un mevcut bağlantı akışıyla bağlayın.',
  PHONE_AND_OBD_CONNECTED:
    'Telefon ve OBD aynı anda bağlıyken ölçüm alın.',
} as const;

export type ScenarioStatus =
  | 'NOT_STARTED' | 'READY' | 'CAPTURING' | 'CAPTURED' | 'BLOCKED' | 'FAILED' | 'STALE';

export const SCENARIO_STATUS_LABEL: Readonly<Record<ScenarioStatus, string>> = {
  NOT_STARTED: 'BAŞLAMADI',
  READY:       'HAZIR',
  CAPTURING:   'ÖLÇÜLÜYOR',
  CAPTURED:    'ÖLÇÜLDÜ',
  BLOCKED:     'ENGELLİ',
  FAILED:      'DÜŞTÜ',
  STALE:       'BAYAT',
} as const;

export type Readiness = 'NOT_READY' | 'READY_FOR_MORE_EVIDENCE' | 'READY_FOR_P1_A';

export const READINESS_LABEL: Readonly<Record<Readiness, string>> = {
  NOT_READY:               'HAZIR DEĞİL',
  READY_FOR_MORE_EVIDENCE: 'DAHA FAZLA KANIT GEREKLİ',
  READY_FOR_P1_A:          'P1-A İÇİN HAZIR',
} as const;

export type AuthorityKey = 'bluetooth' | 'audio' | 'call' | 'media';

export const AUTHORITY_KEY_LABEL: Readonly<Record<AuthorityKey, string>> = {
  bluetooth: 'Bluetooth Otoritesi',
  audio:     'Ses / A2DP Otoritesi',
  call:      'Çağrı / HFP Otoritesi',
  media:     'MediaSession Otoritesi',
} as const;

export type AuthorityValue =
  | 'ANDROID_FRAMEWORK' | 'ANDROID_TELECOM' | 'LOCAL_MEDIASESSION'
  | 'VENDOR_SERVICE' | 'VENDOR_MEDIASESSION' | 'MCU_BRIDGE'
  | 'AVRCP_METADATA_ONLY' | 'HYBRID' | 'UNKNOWN';

export const AUTHORITY_VALUE_LABEL: Readonly<Record<AuthorityValue, string>> = {
  ANDROID_FRAMEWORK:   'ANDROID FRAMEWORK',
  ANDROID_TELECOM:     'ANDROID TELECOM',
  LOCAL_MEDIASESSION:  'YEREL MEDIASESSION',
  VENDOR_SERVICE:      'ÜRETİCİ SERVİSİ',
  VENDOR_MEDIASESSION: 'ÜRETİCİ MEDIASESSION',
  MCU_BRIDGE:          'MCU KÖPRÜSÜ',
  AVRCP_METADATA_ONLY: 'YALNIZ AVRCP METADATA',
  HYBRID:              'HİBRİT (ÇELİŞKİLİ KANIT)',
  UNKNOWN:             'BİLİNMİYOR',
} as const;

export type CoexistenceResult =
  | 'COEXISTENCE_OBSERVED' | 'COEXISTENCE_DERIVED' | 'CONFLICT_RISK' | 'UNKNOWN';

export const COEXISTENCE_LABEL: Readonly<Record<CoexistenceResult, string>> = {
  COEXISTENCE_OBSERVED: 'EŞZAMANLILIK GÖZLENDİ',
  COEXISTENCE_DERIVED:  'EŞZAMANLILIK TÜRETİLDİ',
  CONFLICT_RISK:        'ÇAKIŞMA RİSKİ',
  UNKNOWN:              'BİLİNMİYOR',
} as const;

export type MediaResult =
  | 'LOCAL_MEDIASESSION_USABLE' | 'VENDOR_MEDIASESSION_USABLE'
  | 'AVRCP_METADATA_ONLY' | 'NO_MEDIASESSION' | 'UNKNOWN';

export type CallResult =
  | 'ANDROID_TELECOM_AUTHORITY' | 'VENDOR_CALL_AUTHORITY'
  | 'MCU_CALL_AUTHORITY' | 'HYBRID' | 'UNKNOWN';

/** Üç durumlu bayrak — native ile aynı sözleşme ("okunamadı" ≠ "yok"). */
export type Tri = 'YES' | 'NO' | 'UNKNOWN';

/* ══════════════════════════════════════════════════════════════════════════
 * Blocker kataloğu — SABİT KODLAR (serbest metin yok)
 * ════════════════════════════════════════════════════════════════════════ */

export interface BlockerDef {
  readonly code: string;
  readonly text: string;
  /** Kritik blocker P1-A'yı KESİN engeller. */
  readonly critical: boolean;
}

export const PH_FIELD_BLOCKERS: Readonly<Record<string, BlockerDef>> = {
  DEVICE_NOT_HEAD_UNIT: {
    code: 'DEVICE_NOT_HEAD_UNIT',
    text: 'Bağlı cihaz head unit olarak doğrulanmadı — saha sonuçları head unit sonucu SAYILMAZ.',
    critical: true,
  },
  DEVICE_IS_PHONE: {
    code: 'DEVICE_IS_PHONE',
    text: 'Bu cihaz telefondur. Head unit saha sonuçları üretilemez.',
    critical: true,
  },
  NATIVE_FIELD_PROBE_ABSENT: {
    code: 'NATIVE_FIELD_PROBE_ABSENT',
    text: 'Native saha sondası bulunamadı (eski APK) — kimlik ve yüzey kanıtı okunamıyor.',
    critical: true,
  },
  MEDIA_SESSION_ACCESS_DENIED: {
    code: 'MEDIA_SESSION_ACCESS_DENIED',
    text: 'MediaSession listesi etkin bir NotificationListener ister; CAROS’ta yoktur ve bu fazda izin İSTENMEZ → oturum sayımı okunamaz.',
    critical: false,
  },
  PROFILE_PROXY_NOT_USED: {
    code: 'PROFILE_PROXY_NOT_USED',
    text: 'A2DP/HFP profil proxy’si bilinçli olarak açılmadı (bind sızıntısı riski) → profil detayı yalnız adapter seviyesinde okunur. P0.5 BLOCKER-8 AÇIK.',
    critical: false,
  },
  VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE: {
    code: 'VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE',
    text: 'Vendor yayını için depoda sayaç/damga altyapısı yok → "gözlendi" denemez.',
    critical: false,
  },
  PACKAGE_VISIBILITY_LIMITED: {
    code: 'PACKAGE_VISIBILITY_LIMITED',
    text: 'Paket listesi okunamadı (Android 11+ görünürlük kısıtı olabilir) → işaret sayımları BİLİNMİYOR, 0 DEĞİL.',
    critical: false,
  },
  BASELINE_NOT_CLEAN: {
    code: 'BASELINE_NOT_CLEAN',
    text: 'Baseline ölçümünde telefon profili ve/veya OBD zaten bağlıydı → baseline referans olarak KULLANILAMAZ.',
    critical: false,
  },
  OBD_DATA_NOT_FRESH_WITH_PHONE: {
    code: 'OBD_DATA_NOT_FRESH_WITH_PHONE',
    text: 'Telefon + OBD birlikte bağlıyken OBD verisi TAZE DEĞİL → çakışma şüphesi.',
    critical: false,
  },
  DISCOVERY_ACTIVE_DURING_CAPTURE: {
    code: 'DISCOVERY_ACTIVE_DURING_CAPTURE',
    text: 'Ölçüm sırasında Bluetooth keşfi AKTİFTİ → adapter yarışı ölçümü kirletir.',
    critical: false,
  },
  BLUETOOTH_STATE_UNREADABLE: {
    code: 'BLUETOOTH_STATE_UNREADABLE',
    text: 'Bluetooth adapter/profil durumu okunamadı → "bağlı değil" VARSAYILMADI.',
    critical: false,
  },
  USER_AFFIRMATION_WITHOUT_TECHNICAL_EVIDENCE: {
    code: 'USER_AFFIRMATION_WITHOUT_TECHNICAL_EVIDENCE',
    text: 'Kullanıcı "bu cihaz head unit" dedi ama TEKNİK kanıt yok → onay teknik kanıtın YERİNE GEÇMEZ, rol yükseltilmedi.',
    critical: false,
  },
} as const;

export function blockerText(code: string): string {
  const def = PH_FIELD_BLOCKERS[code];
  return def ? def.text : code;
}

export function isCriticalBlocker(code: string): boolean {
  const def = PH_FIELD_BLOCKERS[code];
  return def ? def.critical : false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ham gözlem girdisi — YAPISAL tip (PII alanı YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhFieldIdentity {
  readonly manufacturer: string;
  readonly model: string;
  readonly device: string;
  readonly product: string;
  readonly androidRelease: string;
  readonly sdkInt: number;
  /** İki segmentlik ÖZET — ham fingerprint DEĞİL. */
  readonly fingerprintSummary: string;
  /** Geri çevrilemez karma. */
  readonly fingerprintHash: string;
  readonly automotiveFeature: Tri;
  readonly carServicePresent: Tri;
  readonly telephonyFeature: Tri;
  /** -1 = okunamadı (0 DEĞİL). */
  readonly headUnitMarkerCount: number;
  readonly phoneOemMarkerCount: number;
  readonly vendorFamily: string;
  /** Native'in saf kuralıyla hesaplanan rol (kullanıcı onayı KATILMAMIŞ). */
  readonly deviceRoleTechnical: string;
  readonly deviceRoleConfidence: string;
}

export interface PhFieldCall {
  readonly dialerClass: string;
  readonly telecomManagerAvailable: Tri;
  readonly callVendorMarkerCount: number;
}

export interface PhFieldMedia {
  readonly mediaSessionAccess: string;
  readonly activeSessionCount: number;
  readonly ownerLocalCount: number;
  readonly ownerSystemCount: number;
  readonly ownerVendorCount: number;
  readonly ownerOtherCount: number;
  readonly playbackStatePresent: Tri;
  readonly metadataPresent: Tri;
  readonly artworkPresent: Tri;
  readonly transportControlsPresent: Tri;
}

/**
 * Tek atışlık ham gözlem. P0.5 snapshot'ı AYNEN yeniden kullanılır (`hw`) —
 * paralel bir donanım okuma modeli KURULMAZ.
 */
export interface PhoneHubFieldRaw {
  readonly readAt: number;
  readonly fieldPresent: boolean;
  readonly hw: PhoneHubProbeRaw;
  readonly identity: PhFieldIdentity | null;
  readonly call: PhFieldCall | null;
  readonly media: PhFieldMedia | null;
  readonly errors: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Oturum modeli (versiyonlu)
 * ════════════════════════════════════════════════════════════════════════ */

export interface FieldEvidence {
  readonly id: string;
  readonly observation: string;
  readonly evidenceSource: string;
  readonly classification: Observability;
  readonly confidence: Confidence;
  readonly architecturalConsequence: string;
  /** Kanıtın TOPLANDIĞI rol — telefon kanıtı head unit hükmüne SAYILMAZ. */
  readonly deviceRole: DeviceRole;
  readonly scenario: ScenarioId | null;
  readonly capturedAt: number;
}

export interface ScenarioObservation {
  readonly key: string;
  readonly value: string;
  readonly klass: Observability;
}

export interface ScenarioRecord {
  readonly id: ScenarioId;
  readonly status: ScenarioStatus;
  readonly startedAt: number | null;
  readonly capturedAt: number | null;
  readonly completedAt: number | null;
  readonly deviceRole: DeviceRole;
  readonly snapshotVersion: number;
  readonly evidence: readonly FieldEvidence[];
  readonly observations: readonly ScenarioObservation[];
  readonly blockers: readonly string[];
}

export interface DeviceIdentitySummary {
  readonly manufacturer: string;
  readonly model: string;
  readonly device: string;
  readonly product: string;
  readonly androidRelease: string;
  readonly sdkInt: number;
  readonly fingerprintSummary: string;
  readonly fingerprintHash: string;
  readonly automotiveFeature: Tri;
  readonly carServicePresent: Tri;
  readonly telephonyFeature: Tri;
  readonly headUnitMarkerCount: number;
  readonly phoneOemMarkerCount: number;
  readonly vendorFamily: string;
}

export interface AuthorityDecision {
  readonly key: AuthorityKey;
  readonly value: AuthorityValue;
  readonly classification: Observability;
  readonly confidence: Confidence;
  readonly supportingEvidenceIds: readonly string[];
  readonly conflictingEvidenceIds: readonly string[];
  readonly architecturalConsequence: string;
}

export interface CoexistenceVerdict {
  readonly result: CoexistenceResult;
  readonly classification: Observability;
  readonly confidence: Confidence;
  readonly reasons: readonly string[];
}

export interface PhoneHubFieldValidationSession {
  readonly schemaVersion: number;
  readonly sessionId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deviceIdentity: DeviceIdentitySummary | null;
  readonly deviceRole: DeviceRole;
  readonly deviceRoleConfidence: Confidence;
  /** Kullanıcı beyanı — YALNIZ bir evidence kaydıdır, teknik kanıtın yerine GEÇMEZ. */
  readonly userAffirmedHeadUnit: boolean;
  readonly scenarios: readonly ScenarioRecord[];
  readonly blockers: readonly string[];
  readonly evidence: readonly FieldEvidence[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar (saf)
 * ════════════════════════════════════════════════════════════════════════ */

function _clampText(v: unknown): string {
  const s = typeof v === 'string' ? v : String(v ?? '');
  return s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) : s;
}

function _int(v: unknown, fallback = -1): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function _tri(v: unknown): Tri {
  return v === 'YES' || v === 'NO' ? v : 'UNKNOWN';
}

function _role(v: unknown): DeviceRole {
  return v === 'HEAD_UNIT_CONFIRMED' || v === 'PHONE_CONFIRMED'
      || v === 'ANDROID_DEVICE_UNKNOWN' || v === 'UNAVAILABLE'
    ? v : 'UNAVAILABLE';
}

function _conf(v: unknown): Confidence {
  return v === 'LOW' || v === 'MEDIUM' || v === 'HIGH' || v === 'NONE' ? v : 'NONE';
}

function _minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export function confidenceAtLeast(c: Confidence, min: Confidence): boolean {
  return CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[min];
}

function _pushBounded<T>(list: T[], item: T, max: number): void {
  if (list.length < max) list.push(item);
}

/**
 * Dizi güvencesi. Oturum nesnesi diskten, göçten veya bir başka ekrandan gelebilir;
 * beklenen alan dizi DEĞİLSE hüküm fonksiyonları ÇÖKMEZ — boş kabul edilir.
 * Bu "ASLA throw etmez" sözleşmesinin yapısal karşılığıdır.
 */
function _arr<T>(v: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(v) ? v : [];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · CİHAZ ROLÜ KAPISI
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bağımsız head unit sinyali sayısı.
 *
 * KRİTİK: `android.hardware.type.automotive` YOKLUĞU tek başına cihazın head unit
 * OLMADIĞINI KANITLAMAZ — pek çok aftermarket ünite sıradan Android tablet
 * yapısındadır. Sinyaller TOPLANIR; hiçbiri veto etmez.
 *
 * NOT: bu kural `PhoneHubFieldSnapshot.countHeadUnitSignals` ile BİREBİR AYNIDIR
 * (P0.5'teki çakışma kuralı gibi bilinçli ikizdir — iki taraf da testle kilitlidir).
 */
export function countHeadUnitSignals(id: PhFieldIdentity | null): number {
  if (!id) return 0;
  let n = 0;
  if (id.automotiveFeature === 'YES') n++;
  if (id.carServicePresent === 'YES') n++;
  if (id.headUnitMarkerCount > 0) n++;
  return n;
}

export function isIdentityReadable(id: PhFieldIdentity | null): boolean {
  return !!id && typeof id.manufacturer === 'string'
    && id.manufacturer.length > 0 && id.manufacturer !== 'UNKNOWN'
    && id.sdkInt > 0;
}

/**
 * Cihaz rolü — BİRLEŞİK KANIT MODELİ (native `classifyDeviceRole` ile aynı tablo).
 *
 * KULLANICI ONAYI TEKNİK KANITIN YERİNE GEÇMEZ: sıfır teknik sinyalle onay verilse
 * bile rol HEAD_UNIT_CONFIRMED OLMAZ. Telefon teşhis edilmişse onay rolü EZMEZ.
 */
export function classifyDeviceRole(
  id: PhFieldIdentity | null,
  userAffirmedHeadUnit: boolean,
): DeviceRole {
  if (!isIdentityReadable(id)) return 'UNAVAILABLE';
  const signals = countHeadUnitSignals(id);
  const phoneMarkers = id ? id.phoneOemMarkerCount : -1;
  const telephony = id ? id.telephonyFeature : 'UNKNOWN';

  if (phoneMarkers > 0 && telephony === 'YES' && signals === 0) return 'PHONE_CONFIRMED';
  if (signals >= 2) return 'HEAD_UNIT_CONFIRMED';
  if (signals === 1 && userAffirmedHeadUnit) return 'HEAD_UNIT_CONFIRMED';
  return 'ANDROID_DEVICE_UNKNOWN';
}

export function deviceRoleConfidence(
  role: DeviceRole,
  id: PhFieldIdentity | null,
  userAffirmedHeadUnit: boolean,
): Confidence {
  if (role === 'UNAVAILABLE') return 'NONE';
  const signals = countHeadUnitSignals(id);
  if (role === 'HEAD_UNIT_CONFIRMED') {
    if (signals >= 2) return 'HIGH';
    return userAffirmedHeadUnit ? 'MEDIUM' : 'LOW';
  }
  if (role === 'PHONE_CONFIRMED') {
    return id && id.phoneOemMarkerCount >= 2 ? 'HIGH' : 'MEDIUM';
  }
  return signals > 0 ? 'LOW' : 'NONE';
}

/** Saha aşamaları bu rolde KİLİTLİ mi (telefon → kilit). */
export function areScenariosLocked(role: DeviceRole): boolean {
  return role === 'PHONE_CONFIRMED';
}

/** Kilit gerekçesi — telefonda açıkça gösterilecek metin. */
export const PHONE_LOCK_MESSAGE =
  'Bu cihaz telefondur. Head unit saha sonuçları üretilemez.';

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · SENARYO DURUM MAKİNESİ
 * ════════════════════════════════════════════════════════════════════════ */

export type ScenarioAction = 'ARM' | 'START' | 'CAPTURE' | 'BLOCK' | 'FAIL' | 'RESET';

/**
 * Durum geçişi. GEÇERSİZ geçiş mevcut durumu KORUR (sessizce sıçrama YOK).
 *
 *  NOT_STARTED → (ARM) READY → (START) CAPTURING → (CAPTURE) CAPTURED
 *  her durum → (BLOCK) BLOCKED · (FAIL) FAILED · (RESET) NOT_STARTED
 *  CAPTURED → (START) CAPTURING  (yeniden ölç)
 *  STALE    → (START) CAPTURING  (yeniden ölç)
 *  BLOCKED  → yalnız RESET/ARM ile çıkılır (kapı açılırsa)
 */
export function nextScenarioStatus(
  current: ScenarioStatus,
  action: ScenarioAction,
): ScenarioStatus {
  if (action === 'RESET') return 'NOT_STARTED';
  if (action === 'BLOCK') return 'BLOCKED';
  if (action === 'FAIL') return 'FAILED';

  if (action === 'ARM') {
    return current === 'NOT_STARTED' || current === 'BLOCKED' ? 'READY' : current;
  }
  if (action === 'START') {
    if (current === 'BLOCKED') return 'BLOCKED';   // kapı kapalıyken ölçüm YOK
    return 'CAPTURING';
  }
  if (action === 'CAPTURE') {
    return current === 'CAPTURING' ? 'CAPTURED' : current;
  }
  return current;
}

/**
 * Bayatlık: YALNIZ gerçek damgası olan CAPTURED kayıt bayatlar. Damga yoksa
 * bayatlık HESAPLANMAZ (sahte bayatlık YASAK — sessionInspector kuralı).
 */
export function applyScenarioStaleness(rec: ScenarioRecord, nowMs: number): ScenarioRecord {
  if (rec.status !== 'CAPTURED') return rec;
  if (rec.capturedAt === null || !Number.isFinite(nowMs)) return rec;
  const age = nowMs - rec.capturedAt;
  return age > SCENARIO_STALE_MS ? { ...rec, status: 'STALE' } : rec;
}

export function emptyScenario(id: ScenarioId): ScenarioRecord {
  /* Template object literal — TÜM anahtarlar aynı sırada (V8 hidden-class). */
  return {
    id,
    status: 'NOT_STARTED',
    startedAt: null,
    capturedAt: null,
    completedAt: null,
    deviceRole: 'UNAVAILABLE',
    snapshotVersion: PH_FIELD_SCHEMA_VERSION,
    evidence: [],
    observations: [],
    blockers: [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · GÖZLEM ÇIKARIMI (ham → senaryo kaydı)
 * ════════════════════════════════════════════════════════════════════════ */

function _obs(key: string, value: unknown, klass: Observability): ScenarioObservation {
  return { key, value: _clampText(value), klass };
}

/** Sayısal sentinel: -1 → UNAVAILABLE (0 GÖSTERİLMEZ). */
function _countObs(key: string, n: number): ScenarioObservation {
  return n >= 0 ? _obs(key, n, 'OBSERVED') : _obs(key, '—', 'UNAVAILABLE');
}

function _triObs(key: string, v: Tri): ScenarioObservation {
  return v === 'UNKNOWN' ? _obs(key, '—', 'UNAVAILABLE') : _obs(key, v, 'OBSERVED');
}

/**
 * Ham gözlemden senaryo GÖZLEM listesi üretir. Yalnız YAPISAL kanıt: sayım, enum,
 * var/yok. Parça adı, sanatçı, MAC, numara, paket adı TAŞINMAZ.
 */
export function buildScenarioObservations(raw: PhoneHubFieldRaw): ScenarioObservation[] {
  const out: ScenarioObservation[] = [];
  const bt = raw.hw ? raw.hw.bluetooth : null;
  const pr = raw.hw ? raw.hw.profiles : null;
  const au = raw.hw ? raw.hw.audio : null;
  const vd = raw.hw ? raw.hw.vendor : null;
  const ob = raw.hw ? raw.hw.obd : null;

  const add = (o: ScenarioObservation): void => _pushBounded(out, o, MAX_OBSERVATIONS_PER_SCENARIO);

  /* Bluetooth adapter yüzeyi */
  if (bt) {
    add(_obs('btAdapterAvailable', bt.adapterAvailable ? 'YES' : 'NO', 'OBSERVED'));
    add(_obs('btAdapterEnabled', bt.adapterEnabled ? 'YES' : 'NO', 'OBSERVED'));
    add(_obs('btDiscovery', bt.discoveryActive, bt.discoveryActive === 'UNKNOWN' ? 'UNAVAILABLE' : 'OBSERVED'));
    add(_countObs('bondedDeviceCount', bt.bondedDeviceCount));
  } else {
    add(_obs('btAdapter', '—', 'UNAVAILABLE'));
  }

  /* Profiller — "bağlı değil" UYDURULMAZ */
  if (pr) {
    add(_obs('a2dpState', pr.a2dpConnectionState,
      pr.a2dpConnectionState === 'UNKNOWN' || pr.a2dpConnectionState === 'UNAVAILABLE'
        ? 'UNAVAILABLE' : 'OBSERVED'));
    add(_obs('hfpState', pr.headsetConnectionState,
      pr.headsetConnectionState === 'UNKNOWN' || pr.headsetConnectionState === 'UNAVAILABLE'
        ? 'UNAVAILABLE' : 'OBSERVED'));
  } else {
    add(_obs('profiles', '—', 'UNAVAILABLE'));
  }

  /* Ses yüzeyi */
  if (au) {
    add(_obs('musicActive', au.musicActive ? 'YES' : 'NO', 'OBSERVED'));
    add(_obs('communicationDeviceType', au.communicationDeviceType,
      au.communicationDeviceType === 'UNKNOWN' || au.communicationDeviceType === 'UNAVAILABLE'
        ? 'UNAVAILABLE' : 'OBSERVED'));
  }

  /* Vendor yüzeyi */
  if (vd) {
    add(_obs('vendorPackageDetected', vd.knownVendorPackageDetected ? 'YES' : 'NO', 'OBSERVED'));
    add(_obs('vendorFamily', vd.vendorFamily, vd.vendorFamily === 'UNKNOWN' ? 'UNAVAILABLE' : 'OBSERVED'));
    add(_obs('vendorBroadcastObserved', vd.knownVendorBroadcastObserved ? 'YES' : 'NO(kanıt altyapısı yok)',
      vd.knownVendorBroadcastObserved ? 'OBSERVED' : 'UNAVAILABLE'));
  }

  /* Çağrı yüzeyi */
  if (raw.call) {
    add(_obs('dialerClass', raw.call.dialerClass,
      raw.call.dialerClass === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'OBSERVED'));
    add(_triObs('telecomManagerAvailable', raw.call.telecomManagerAvailable));
    add(_countObs('callVendorMarkerCount', raw.call.callVendorMarkerCount));
  } else {
    add(_obs('callSurface', '—', 'UNAVAILABLE'));
  }

  /* MediaSession yüzeyi */
  if (raw.media) {
    add(_obs('mediaSessionAccess', raw.media.mediaSessionAccess,
      raw.media.mediaSessionAccess === 'GRANTED' ? 'OBSERVED' : 'UNAVAILABLE'));
    add(_countObs('activeSessionCount', raw.media.activeSessionCount));
    add(_countObs('ownerLocalCount', raw.media.ownerLocalCount));
    add(_countObs('ownerVendorCount', raw.media.ownerVendorCount));
    add(_countObs('ownerSystemCount', raw.media.ownerSystemCount));
    add(_triObs('metadataPresent', raw.media.metadataPresent));
    add(_triObs('artworkPresent', raw.media.artworkPresent));
    add(_triObs('transportControlsPresent', raw.media.transportControlsPresent));
  } else {
    add(_obs('mediaSurface', '—', 'UNAVAILABLE'));
  }

  /* OBD yüzeyi — YALNIZ OKUNUR */
  if (ob) {
    add(_obs('obdTransportConnected', ob.transportConnected ? 'YES' : 'NO', 'OBSERVED'));
    add(_obs('obdPollingActive', ob.pollingActive ? 'YES' : 'NO', 'OBSERVED'));
    add(_obs('obdDataFresh', ob.dataFresh ? 'YES' : 'NO', 'OBSERVED'));
    add(_countObs('obdLastPacketAgeMs', ob.lastPacketAgeMs));
    add(_obs('obdResetInProgress', ob.resetInProgress ? 'YES' : 'NO', 'OBSERVED'));
    add(_obs('obdTransport', ob.transport ?? '—', ob.transport ? 'OBSERVED' : 'UNAVAILABLE'));
  } else {
    add(_obs('obdSurface', '—', 'UNAVAILABLE'));
  }

  return out;
}

/** Senaryo-özel blocker tespiti (fail-closed; kanıt yoksa blocker EKLENİR). */
export function detectScenarioBlockers(id: ScenarioId, raw: PhoneHubFieldRaw): string[] {
  const out: string[] = [];
  const add = (c: string): void => { if (!out.includes(c)) _pushBounded(out, c, MAX_BLOCKERS); };

  if (!raw.fieldPresent) add('NATIVE_FIELD_PROBE_ABSENT');

  const bt = raw.hw ? raw.hw.bluetooth : null;
  const pr = raw.hw ? raw.hw.profiles : null;
  const ob = raw.hw ? raw.hw.obd : null;

  if (!bt || !pr) add('BLUETOOTH_STATE_UNREADABLE');
  if (bt && bt.discoveryActive === 'ACTIVE') add('DISCOVERY_ACTIVE_DURING_CAPTURE');

  const phoneProfileConnected = !!pr
    && (pr.a2dpConnectionState === 'CONNECTED' || pr.headsetConnectionState === 'CONNECTED');
  const obdConnected = !!ob && ob.transportConnected;

  if (id === 'BASELINE_HEAD_UNIT' && (phoneProfileConnected || obdConnected)) {
    add('BASELINE_NOT_CLEAN');
  }
  if (id === 'PHONE_AND_OBD_CONNECTED' && phoneProfileConnected && obdConnected && ob && !ob.dataFresh) {
    add('OBD_DATA_NOT_FRESH_WITH_PHONE');
  }

  for (const e of _arr(raw.errors)) {
    if (e === 'MEDIA_SESSION_ACCESS_DENIED') add('MEDIA_SESSION_ACCESS_DENIED');
    if (e === 'PROFILE_PROXY_NOT_USED') add('PROFILE_PROXY_NOT_USED');
    if (e === 'PACKAGE_READ_FAILED') add('PACKAGE_VISIBILITY_LIMITED');
  }
  for (const e of _arr(raw.hw ? raw.hw.errors : [])) {
    if (e === 'VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE') add('VENDOR_BROADCAST_EVIDENCE_UNAVAILABLE');
  }

  return out;
}

/** Senaryo kanıtı — kanıt ID'si senaryo + sıra ile deterministiktir. */
export function buildScenarioEvidence(
  id: ScenarioId,
  raw: PhoneHubFieldRaw,
  role: DeviceRole,
): FieldEvidence[] {
  const out: FieldEvidence[] = [];
  let seq = 0;
  const mk = (
    observation: string, evidenceSource: string,
    classification: Observability, confidence: Confidence,
    architecturalConsequence: string,
  ): void => {
    seq += 1;
    _pushBounded(out, {
      id: `EV-${id}-${seq}`,
      observation: _clampText(observation),
      evidenceSource: _clampText(evidenceSource),
      classification,
      confidence,
      architecturalConsequence: _clampText(architecturalConsequence),
      deviceRole: role,
      scenario: id,
      capturedAt: raw.readAt,
    }, MAX_EVIDENCE_PER_SCENARIO);
  };

  const pr = raw.hw ? raw.hw.profiles : null;
  const au = raw.hw ? raw.hw.audio : null;
  const ob = raw.hw ? raw.hw.obd : null;

  if (!raw.fieldPresent) {
    mk('Native saha sondası yanıt vermedi (present=false)',
       'CarLauncher.getPhoneHubFieldProbe()', 'UNAVAILABLE', 'NONE',
       'Kimlik ve yüzey kanıtı yok → rol ve otorite kararı VERİLEMEZ.');
    return out;
  }

  if (raw.identity) {
    mk(`Cihaz kimliği okundu (automotive=${raw.identity.automotiveFeature}, ` +
       `CarService=${raw.identity.carServicePresent}, HU işareti=${raw.identity.headUnitMarkerCount})`,
       'Build.* + PackageManager (TAM EŞLEŞME)', 'OBSERVED',
       isIdentityReadable(raw.identity) ? 'HIGH' : 'NONE',
       'Rol kapısı bu kanıtla belirlenir; automotive özelliğinin yokluğu tek başına ' +
       'head unit olmadığını KANITLAMAZ.');
  }

  if (pr) {
    const readable = pr.a2dpConnectionState !== 'UNKNOWN' && pr.a2dpConnectionState !== 'UNAVAILABLE';
    mk(`A2DP=${pr.a2dpConnectionState} · HFP=${pr.headsetConnectionState}`,
       'BluetoothAdapter.getProfileConnectionState (salt-okunur)',
       readable ? 'OBSERVED' : 'UNAVAILABLE', readable ? 'MEDIUM' : 'NONE',
       'Bağlantı DURUMU kontrol OTORİTESİ değildir; vendor/MCU yığını da bağlamış olabilir.');
  }

  if (raw.media) {
    const granted = raw.media.mediaSessionAccess === 'GRANTED';
    mk(`MediaSession erişimi=${raw.media.mediaSessionAccess} · aktif oturum=` +
       `${raw.media.activeSessionCount >= 0 ? raw.media.activeSessionCount : 'okunamadı'}`,
       'MediaSessionManager.getActiveSessions (dinleyici YOK → beklenen kısıt)',
       granted ? 'OBSERVED' : 'UNAVAILABLE', granted ? 'MEDIUM' : 'NONE',
       granted
         ? 'Sahip sınıfı sayımı medya otoritesini ayırt etmek için kullanılabilir.'
         : 'MediaSession tabanlı medya otoritesi bu cihazda ÖLÇÜLEMEZ → UNKNOWN kalır.');
  }

  if (raw.call) {
    const readable = raw.call.dialerClass !== 'UNAVAILABLE';
    mk(`Varsayılan dialer sınıfı=${raw.call.dialerClass} · Telecom=${raw.call.telecomManagerAvailable}`,
       'TelecomManager.getDefaultDialerPackage → SINIF (paket adı taşınmaz)',
       readable ? 'OBSERVED' : 'UNAVAILABLE', readable ? 'MEDIUM' : 'NONE',
       'Vendor dialer, çağrı otoritesinin Android Telecom’da OLMADIĞINA dair ' +
       'en güçlü tek göstergedir; yine de tek başına kesin değildir.');
  }

  if (au) {
    mk(`musicActive=${au.musicActive ? 'YES' : 'NO'} · commDevice=${au.communicationDeviceType}`,
       'AudioManager (salt-okunur; mod/route DEĞİŞTİRİLMEDİ)', 'OBSERVED', 'LOW',
       'Ses AKIŞININ görünmesi, yolu bizim SÜRDÜĞÜMÜZ anlamına gelmez.');
  }

  if (ob) {
    mk(`OBD bağlı=${ob.transportConnected ? 'YES' : 'NO'} · taze=${ob.dataFresh ? 'YES' : 'NO'} · ` +
       `sıfırlama=${ob.resetInProgress ? 'YES' : 'NO'}`,
       'obdService + ObdHealthMonitor (mevcut getter\'lar — davranış DEĞİŞTİRİLMEDİ)',
       'OBSERVED', 'MEDIUM',
       'Eşzamanlılık hükmü bu alanların telefon profilleriyle AYNI ANDA okunmasına dayanır.');
  }

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · AUTHORITY KARAR MOTORU
 * ════════════════════════════════════════════════════════════════════════ */

interface AuthorityInput {
  readonly role: DeviceRole;
  readonly identity: PhFieldIdentity | null;
  readonly captured: ReadonlyMap<ScenarioId, ScenarioRecord>;
}

function _capturedScenario(
  captured: ReadonlyMap<ScenarioId, ScenarioRecord>, id: ScenarioId,
): ScenarioRecord | null {
  const rec = captured.get(id);
  if (!rec) return null;
  return rec.status === 'CAPTURED' || rec.status === 'STALE' ? rec : null;
}

function _obsValue(rec: ScenarioRecord | null, key: string): string | null {
  if (!rec) return null;
  for (const o of _arr(rec.observations)) if (o.key === key) return o.value;
  return null;
}

function _evidenceIds(rec: ScenarioRecord | null): string[] {
  return rec ? _arr(rec.evidence).map((e) => e.id) : [];
}

/** Rol kapısı: head unit doğrulanmadıysa HİÇBİR otorite kararı üretilmez. */
function _roleGated(key: AuthorityKey, role: DeviceRole): AuthorityDecision | null {
  if (role === 'HEAD_UNIT_CONFIRMED') return null;
  return {
    key,
    value: 'UNKNOWN',
    classification: 'UNAVAILABLE',
    confidence: 'NONE',
    supportingEvidenceIds: [],
    conflictingEvidenceIds: [],
    architecturalConsequence: role === 'PHONE_CONFIRMED'
      ? 'Cihaz TELEFON olarak doğrulandı — telefonda alınan snapshot head unit otoritesi ÜRETMEZ.'
      : 'Cihaz head unit olarak doğrulanmadı → otorite kararı VERİLEMEZ (fail-closed).',
  };
}

function _bluetoothAuthority(inp: AuthorityInput): AuthorityDecision {
  const gated = _roleGated('bluetooth', inp.role);
  if (gated) return gated;

  const baseline = _capturedScenario(inp.captured, 'BASELINE_HEAD_UNIT');
  const phone    = _capturedScenario(inp.captured, 'PHONE_CONNECTED');
  const support: string[] = [];
  const conflict: string[] = [];

  /* KURAL: tek zayıf paket eşleşmesi authority kanıtı DEĞİLDİR — vendor otoritesi
     için ≥2 işaret VEYA gözlenmiş vendor yayını şart. */
  const huMarkers = inp.identity ? inp.identity.headUnitMarkerCount : -1;
  const vendorStrong = huMarkers >= 2;
  const vendorWeak   = huMarkers === 1;

  /* KURAL: framework otoritesi için profil VARLIĞI yetmez — telefon BAĞLIYKEN
     framework'ün profili CONNECTED gördüğü GÖZLENMELİ. */
  const a2dpWithPhone = _obsValue(phone, 'a2dpState');
  const hfpWithPhone  = _obsValue(phone, 'hfpState');
  const frameworkSees = a2dpWithPhone === 'CONNECTED' || hfpWithPhone === 'CONNECTED';

  if (frameworkSees) support.push(...(_evidenceIds(phone)));
  if (vendorStrong || vendorWeak) support.push(...(_evidenceIds(baseline)));

  if (!phone) {
    return {
      key: 'bluetooth', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
      supportingEvidenceIds: [], conflictingEvidenceIds: [],
      architecturalConsequence:
        'Telefon bağlıyken ölçüm YOK → Bluetooth otoritesi belirlenemez (fail-closed).',
    };
  }

  if (frameworkSees && vendorStrong) {
    conflict.push(...(_evidenceIds(baseline)));
    return {
      key: 'bluetooth', value: 'HYBRID', classification: 'DERIVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: conflict,
      architecturalConsequence:
        'Framework profili görüyor AMA güçlü vendor yığını da var → sahiplik paylaşılıyor ' +
        'olabilir. Faz 1 tek sahip VARSAYMAMALI; adapter erişimi serileştirilmeli.',
    };
  }
  if (frameworkSees) {
    return {
      key: 'bluetooth', value: 'ANDROID_FRAMEWORK', classification: 'DERIVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Android framework profil durumunu görüyor ve güçlü vendor işareti yok → Faz 1 ' +
        'framework API’leri üzerinden GÖZLEM yapabilir (kontrol iddiası hâlâ ayrı kanıt ister).',
    };
  }
  if (vendorStrong) {
    return {
      key: 'bluetooth', value: 'VENDOR_SERVICE', classification: 'DERIVED', confidence: 'LOW',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Framework profili bağlı GÖRMÜYOR ama vendor yığını mevcut → bağlantıyı vendor ' +
        'yönetiyor olabilir. Faz 1 framework üzerinden kontrol VARSAYMAMALI.',
    };
  }
  return {
    key: 'bluetooth', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
    supportingEvidenceIds: support, conflictingEvidenceIds: [],
    architecturalConsequence:
      vendorWeak
        ? 'Yalnız TEK zayıf vendor paket eşleşmesi var → authority kanıtı SAYILMAZ.'
        : 'Ne framework gözlemi ne vendor kanıtı yeterli → UNKNOWN (fail-closed).',
  };
}

function _audioAuthority(inp: AuthorityInput): AuthorityDecision {
  const gated = _roleGated('audio', inp.role);
  if (gated) return gated;

  const media = _capturedScenario(inp.captured, 'PHONE_MEDIA_ACTIVE');
  if (!media) {
    return {
      key: 'audio', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
      supportingEvidenceIds: [], conflictingEvidenceIds: [],
      architecturalConsequence:
        'Telefonda müzik çalarken ölçüm YOK → ses otoritesi belirlenemez.',
    };
  }

  const musicActive = _obsValue(media, 'musicActive') === 'YES';
  const a2dp = _obsValue(media, 'a2dpState') === 'CONNECTED';
  const huMarkers = inp.identity ? inp.identity.headUnitMarkerCount : -1;
  const support = _evidenceIds(media);

  if (musicActive && a2dp && huMarkers >= 2) {
    return {
      key: 'audio', value: 'HYBRID', classification: 'DERIVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Framework ses akışını GÖRÜYOR ama vendor yığını da var → yolu kimin sürdüğü ' +
        'belirsiz. Faz 1 ses yolunu DEĞİŞTİRMEYE çalışmamalı.',
    };
  }
  if (musicActive && a2dp) {
    return {
      key: 'audio', value: 'ANDROID_FRAMEWORK', classification: 'DERIVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'A2DP bağlı ve framework müzik akışını görüyor → Faz 1 ses DURUMUNU okuyabilir. ' +
        'Yolu SÜRME yetkisi bu kanıtla KANITLANMAZ.',
    };
  }
  if (!a2dp && huMarkers >= 2) {
    return {
      key: 'audio', value: 'VENDOR_SERVICE', classification: 'DERIVED', confidence: 'LOW',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Framework A2DP bağlı görmüyor ama vendor yığını var → ses vendor/MCU yolundan ' +
        'gidiyor olabilir; Faz 1’de ses kontrolü PLANLANMAMALI.',
    };
  }
  return {
    key: 'audio', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
    supportingEvidenceIds: support, conflictingEvidenceIds: [],
    architecturalConsequence: 'Ses yüzeyi kanıtı yetersiz → UNKNOWN (fail-closed).',
  };
}

function _callAuthority(inp: AuthorityInput): AuthorityDecision {
  const gated = _roleGated('call', inp.role);
  if (gated) return gated;

  const phone = _capturedScenario(inp.captured, 'PHONE_CONNECTED')
    ?? _capturedScenario(inp.captured, 'BASELINE_HEAD_UNIT');
  const dialer = _obsValue(phone, 'dialerClass');
  const telecom = _obsValue(phone, 'telecomManagerAvailable');
  const vendorCallRaw = _obsValue(phone, 'callVendorMarkerCount');
  const vendorCall = vendorCallRaw !== null && vendorCallRaw !== '—'
    ? Number.parseInt(vendorCallRaw, 10) : -1;
  const support = _evidenceIds(phone);

  if (dialer === null || dialer === 'UNAVAILABLE' || telecom !== 'YES') {
    return {
      key: 'call', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Dialer sınıfı ve/veya TelecomManager okunamadı → çağrı otoritesi belirlenemez.',
    };
  }
  if (dialer === 'VENDOR_OR_OEM' && Number.isFinite(vendorCall) && vendorCall > 0) {
    return {
      key: 'call', value: 'VENDOR_SERVICE', classification: 'DERIVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Varsayılan dialer vendor/OEM ve vendor çağrı paketi de var → çağrı düzlemi ' +
        'Android Telecom’da DEĞİL. Faz 1 çağrı özelliği PLANLAMAMALI.',
    };
  }
  if (dialer === 'VENDOR_OR_OEM') {
    return {
      key: 'call', value: 'VENDOR_SERVICE', classification: 'DERIVED', confidence: 'LOW',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Varsayılan dialer vendor/OEM görünüyor ama ikinci kanıt yok → çağrı otoritesi ' +
        'muhtemelen vendor; kesin hüküm için ek kanıt gerekir.',
    };
  }
  if (dialer === 'AOSP_TELECOM' && Number.isFinite(vendorCall) && vendorCall > 0) {
    return {
      key: 'call', value: 'HYBRID', classification: 'DERIVED', confidence: 'LOW',
      supportingEvidenceIds: support, conflictingEvidenceIds: support,
      architecturalConsequence:
        'AOSP dialer varsayılan AMA vendor çağrı paketi de kurulu → çağrı yolu ' +
        'paylaşılıyor olabilir; çelişki çözülmeden çağrı özelliği açılmamalı.',
    };
  }
  if (dialer === 'AOSP_TELECOM') {
    return {
      key: 'call', value: 'ANDROID_TELECOM', classification: 'DERIVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'AOSP Telecom varsayılan dialer ve vendor çağrı paketi yok → Faz 1 çağrı ' +
        'DURUMUNU Telecom üzerinden gözlemleyebilir.',
    };
  }
  return {
    key: 'call', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
    supportingEvidenceIds: support, conflictingEvidenceIds: [],
    architecturalConsequence: 'Dialer sınıfı beklenmeyen değer → UNKNOWN (fail-closed).',
  };
}

function _mediaAuthority(inp: AuthorityInput): AuthorityDecision {
  const gated = _roleGated('media', inp.role);
  if (gated) return gated;

  const media = _capturedScenario(inp.captured, 'PHONE_MEDIA_ACTIVE');
  if (!media) {
    return {
      key: 'media', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
      supportingEvidenceIds: [], conflictingEvidenceIds: [],
      architecturalConsequence: 'Medya aktif senaryosu ölçülmedi → medya otoritesi belirlenemez.',
    };
  }

  const access = _obsValue(media, 'mediaSessionAccess');
  const local  = _numObs(media, 'ownerLocalCount');
  const vendor = _numObs(media, 'ownerVendorCount');
  const total  = _numObs(media, 'activeSessionCount');
  const a2dp   = _obsValue(media, 'a2dpState') === 'CONNECTED';
  const musicActive = _obsValue(media, 'musicActive') === 'YES';
  const support = _evidenceIds(media);

  if (access !== 'GRANTED') {
    /* MediaSession okunamıyor. Elde YALNIZ A2DP + müzik akışı var → en fazla
       "AVRCP metadata düzeyinde görünürlük" TÜRETİLİR, oturum otoritesi DEĞİL. */
    if (a2dp && musicActive) {
      return {
        key: 'media', value: 'AVRCP_METADATA_ONLY', classification: 'DERIVED', confidence: 'LOW',
        supportingEvidenceIds: support, conflictingEvidenceIds: [],
        architecturalConsequence:
          'MediaSession listesi erişilemez; yalnız A2DP + ses akışı gözlendi → Faz 1 en ' +
          'fazla AVRCP düzeyinde METADATA bekleyebilir, oturum kontrolü BEKLEMEMELİ.',
      };
    }
    return {
      key: 'media', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'MediaSession erişimi yok ve ses akışı da gözlenmedi → medya otoritesi UNKNOWN.',
    };
  }

  if (vendor > 0 && local > 0) {
    return {
      key: 'media', value: 'HYBRID', classification: 'DERIVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: support,
      architecturalConsequence:
        'Hem yerel hem vendor MediaSession var → iki otorite yarışır; Faz 1 tek oturum ' +
        'sahibi VARSAYMAMALI.',
    };
  }
  if (vendor > 0) {
    return {
      key: 'media', value: 'VENDOR_MEDIASESSION', classification: 'OBSERVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Vendor MediaSession yayımlıyor → Faz 1 medya durumunu vendor oturumundan ' +
        'OKUYABİLİR (kontrol iddiası ayrı kanıt ister).',
    };
  }
  if (local > 0) {
    return {
      key: 'media', value: 'LOCAL_MEDIASESSION', classification: 'OBSERVED', confidence: 'MEDIUM',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Yalnız yerel MediaSession var → telefon medyası head unit’e MediaSession ' +
        'olarak YANSIMIYOR; köprü AVRCP üzerinden kurulmalı.',
    };
  }
  if (total === 0) {
    return {
      key: 'media', value: 'UNKNOWN', classification: 'OBSERVED', confidence: 'LOW',
      supportingEvidenceIds: support, conflictingEvidenceIds: [],
      architecturalConsequence:
        'Erişim VAR ama hiç aktif oturum yok → telefon medyası MediaSession olarak ' +
        'görünmüyor; medya köprüsü bu yoldan KURULAMAZ.',
    };
  }
  return {
    key: 'media', value: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
    supportingEvidenceIds: support, conflictingEvidenceIds: [],
    architecturalConsequence: 'Oturum sahibi sınıfları okunamadı → UNKNOWN (fail-closed).',
  };
}

function _numObs(rec: ScenarioRecord | null, key: string): number {
  const v = _obsValue(rec, key);
  if (v === null || v === '—') return -1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : -1;
}

/** Dört otorite kararı — hepsi kanıt girdilerinden TÜRETİLİR. */
export function decideAuthorities(
  session: PhoneHubFieldValidationSession,
): readonly AuthorityDecision[] {
  const captured = new Map<ScenarioId, ScenarioRecord>();
  for (const s of _arr(session.scenarios)) captured.set(s.id, s);

  const identity: PhFieldIdentity | null = session.deviceIdentity
    ? {
        manufacturer: session.deviceIdentity.manufacturer,
        model: session.deviceIdentity.model,
        device: session.deviceIdentity.device,
        product: session.deviceIdentity.product,
        androidRelease: session.deviceIdentity.androidRelease,
        sdkInt: session.deviceIdentity.sdkInt,
        fingerprintSummary: session.deviceIdentity.fingerprintSummary,
        fingerprintHash: session.deviceIdentity.fingerprintHash,
        automotiveFeature: session.deviceIdentity.automotiveFeature,
        carServicePresent: session.deviceIdentity.carServicePresent,
        telephonyFeature: session.deviceIdentity.telephonyFeature,
        headUnitMarkerCount: session.deviceIdentity.headUnitMarkerCount,
        phoneOemMarkerCount: session.deviceIdentity.phoneOemMarkerCount,
        vendorFamily: session.deviceIdentity.vendorFamily,
        deviceRoleTechnical: session.deviceRole,
        deviceRoleConfidence: session.deviceRoleConfidence,
      }
    : null;

  const inp: AuthorityInput = { role: session.deviceRole, identity, captured };
  return [
    _bluetoothAuthority(inp), _audioAuthority(inp),
    _callAuthority(inp), _mediaAuthority(inp),
  ];
}

/** Control-plane güveni = Bluetooth otoritesinin güveni (kontrol düzlemi budur). */
export function controlPlaneConfidence(
  decisions: readonly AuthorityDecision[],
): Confidence {
  for (const d of decisions) if (d.key === 'bluetooth') return d.confidence;
  return 'NONE';
}

/** MediaSession sonucu — görev §6 enum'una çevrilmiş medya otoritesi. */
export function mediaResultOf(decisions: readonly AuthorityDecision[]): MediaResult {
  for (const d of decisions) {
    if (d.key !== 'media') continue;
    if (d.value === 'LOCAL_MEDIASESSION')  return 'LOCAL_MEDIASESSION_USABLE';
    if (d.value === 'VENDOR_MEDIASESSION') return 'VENDOR_MEDIASESSION_USABLE';
    if (d.value === 'AVRCP_METADATA_ONLY') return 'AVRCP_METADATA_ONLY';
    if (d.value === 'UNKNOWN' && d.classification === 'OBSERVED') return 'NO_MEDIASESSION';
    return 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/** Çağrı sonucu — görev §7 enum'una çevrilmiş çağrı otoritesi. */
export function callResultOf(decisions: readonly AuthorityDecision[]): CallResult {
  for (const d of decisions) {
    if (d.key !== 'call') continue;
    if (d.value === 'ANDROID_TELECOM') return 'ANDROID_TELECOM_AUTHORITY';
    if (d.value === 'VENDOR_SERVICE')   return 'VENDOR_CALL_AUTHORITY';
    if (d.value === 'MCU_BRIDGE')       return 'MCU_CALL_AUTHORITY';
    if (d.value === 'HYBRID')           return 'HYBRID';
    return 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · COEXISTENCE HÜKMÜ
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Telefon + OBD eşzamanlılığı. GÖZLENDİ demek için ÜÇ senaryo da yakalanmış olmalı
 * ve birleşik ölçümde ikisi de bağlı + OBD verisi TAZE olmalı. Aksi hâlde asla
 * "sorunsuz" denmez.
 */
export function assessCoexistence(
  session: PhoneHubFieldValidationSession,
): CoexistenceVerdict {
  const reasons: string[] = [];
  const map = new Map<ScenarioId, ScenarioRecord>();
  for (const s of _arr(session.scenarios)) map.set(s.id, s);

  if (session.deviceRole !== 'HEAD_UNIT_CONFIRMED') {
    return {
      result: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
      reasons: ['DEVICE_NOT_HEAD_UNIT'],
    };
  }

  const both = _capturedScenario(map, 'PHONE_AND_OBD_CONNECTED');
  const phone = _capturedScenario(map, 'PHONE_CONNECTED');
  const obd = _capturedScenario(map, 'OBD_CONNECTED');

  if (!both) {
    return {
      result: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE',
      reasons: ['PHONE_AND_OBD_NOT_CAPTURED'],
    };
  }

  const phoneProfile = _obsValue(both, 'a2dpState') === 'CONNECTED'
    || _obsValue(both, 'hfpState') === 'CONNECTED';
  const obdConnected = _obsValue(both, 'obdTransportConnected') === 'YES';
  const obdFresh     = _obsValue(both, 'obdDataFresh') === 'YES';
  const resetting    = _obsValue(both, 'obdResetInProgress') === 'YES';
  const discovering  = _obsValue(both, 'btDiscovery') === 'ACTIVE';

  if (discovering) reasons.push('DISCOVERY_ACTIVE_DURING_CAPTURE');
  if (resetting) reasons.push('OBD_RESET_IN_PROGRESS');
  if (obdConnected && phoneProfile && !obdFresh) reasons.push('OBD_DATA_NOT_FRESH_WITH_PHONE');

  if (reasons.length > 0) {
    return { result: 'CONFLICT_RISK', classification: 'OBSERVED', confidence: 'MEDIUM', reasons };
  }

  if (!phoneProfile || !obdConnected) {
    reasons.push(!phoneProfile ? 'PHONE_PROFILE_NOT_CONNECTED' : 'OBD_NOT_CONNECTED');
    return { result: 'UNKNOWN', classification: 'UNAVAILABLE', confidence: 'NONE', reasons };
  }

  /* İkisi de bağlı, veri taze, çakışma göstergesi yok. Ayrı tekil senaryolar da
     yakalandıysa hüküm GÖZLENDİ; yalnız birleşik ölçüm varsa TÜRETİLDİ. */
  const full = !!phone && !!obd;
  return {
    result: full ? 'COEXISTENCE_OBSERVED' : 'COEXISTENCE_DERIVED',
    classification: full ? 'OBSERVED' : 'DERIVED',
    confidence: full ? 'HIGH' : 'MEDIUM',
    reasons: full ? [] : ['SINGLE_SCENARIO_ONLY'],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · READINESS
 * ════════════════════════════════════════════════════════════════════════ */

export interface ReadinessVerdict {
  readonly readiness: Readiness;
  /** Karşılanmayan koşul kodları — boş değilse P1-A ASLA açılmaz. */
  readonly unmet: readonly string[];
}

/**
 * P1-A hazırlığı — YEDİ koşulun TAMAMI şart (görev §10):
 *  1. deviceRole = HEAD_UNIT_CONFIRMED
 *  2. BASELINE_HEAD_UNIT = CAPTURED
 *  3. PHONE_CONNECTED = CAPTURED
 *  4. PHONE_AND_OBD_CONNECTED = CAPTURED
 *  5. control-plane güveni >= MEDIUM
 *  6. coexistence sonucu UNKNOWN değil
 *  7. kritik blocker yok
 *
 * ARAÇ YOKKEN DOĞAL SONUÇ NOT_READY'dir — bu bir hata değil, tasarımdır.
 * STALE bir yakalama CAPTURED SAYILMAZ (bayat kanıtla P1-A açılmaz).
 */
export function assessReadiness(session: PhoneHubFieldValidationSession): ReadinessVerdict {
  const unmet: string[] = [];
  const map = new Map<ScenarioId, ScenarioRecord>();
  for (const s of _arr(session.scenarios)) map.set(s.id, s);

  const isCaptured = (id: ScenarioId): boolean => {
    const rec = map.get(id);
    return !!rec && rec.status === 'CAPTURED';
  };

  if (session.deviceRole !== 'HEAD_UNIT_CONFIRMED') unmet.push('ROLE_NOT_HEAD_UNIT');
  if (!isCaptured('BASELINE_HEAD_UNIT')) unmet.push('BASELINE_NOT_CAPTURED');
  if (!isCaptured('PHONE_CONNECTED')) unmet.push('PHONE_CONNECTED_NOT_CAPTURED');
  if (!isCaptured('PHONE_AND_OBD_CONNECTED')) unmet.push('PHONE_AND_OBD_NOT_CAPTURED');

  const decisions = decideAuthorities(session);
  if (!confidenceAtLeast(controlPlaneConfidence(decisions), 'MEDIUM')) {
    unmet.push('CONTROL_PLANE_CONFIDENCE_BELOW_MEDIUM');
  }

  const coex = assessCoexistence(session);
  if (coex.result === 'UNKNOWN') unmet.push('COEXISTENCE_UNKNOWN');

  for (const b of _arr(session.blockers)) if (isCriticalBlocker(b)) unmet.push(`CRITICAL_BLOCKER:${b}`);
  for (const s of _arr(session.scenarios)) {
    for (const b of _arr(s.blockers)) if (isCriticalBlocker(b)) unmet.push(`CRITICAL_BLOCKER:${b}`);
  }

  if (unmet.length === 0) return { readiness: 'READY_FOR_P1_A', unmet: [] };

  /* Bir şeyler ölçülmüşse "daha fazla kanıt gerekli", hiçbir şey yoksa "hazır değil". */
  const anyCaptured = _arr(session.scenarios).some(
    (s) => s.status === 'CAPTURED' || s.status === 'STALE');
  return {
    readiness: anyCaptured ? 'READY_FOR_MORE_EVIDENCE' : 'NOT_READY',
    unmet: unmet.slice(0, MAX_BLOCKERS),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · OTURUM KURUCULARI / GÖÇ
 * ════════════════════════════════════════════════════════════════════════ */

export function identitySummaryOf(id: PhFieldIdentity | null): DeviceIdentitySummary | null {
  if (!id) return null;
  return {
    manufacturer: _clampText(id.manufacturer),
    model: _clampText(id.model),
    device: _clampText(id.device),
    product: _clampText(id.product),
    androidRelease: _clampText(id.androidRelease),
    sdkInt: _int(id.sdkInt),
    fingerprintSummary: _clampText(id.fingerprintSummary),
    fingerprintHash: _clampText(id.fingerprintHash),
    automotiveFeature: _tri(id.automotiveFeature),
    carServicePresent: _tri(id.carServicePresent),
    telephonyFeature: _tri(id.telephonyFeature),
    headUnitMarkerCount: _int(id.headUnitMarkerCount),
    phoneOemMarkerCount: _int(id.phoneOemMarkerCount),
    vendorFamily: _clampText(id.vendorFamily),
  };
}

/**
 * Yeni oturum. `sessionId` ÇAĞIRANDAN gelir — bu dosya `Date.now()`/rastgele
 * KULLANMAZ (saflık şartı).
 */
export function createSession(sessionId: string, nowMs: number): PhoneHubFieldValidationSession {
  return {
    schemaVersion: PH_FIELD_SCHEMA_VERSION,
    sessionId: _clampText(sessionId),
    createdAt: nowMs,
    updatedAt: nowMs,
    deviceIdentity: null,
    deviceRole: 'UNAVAILABLE',
    deviceRoleConfidence: 'NONE',
    userAffirmedHeadUnit: false,
    scenarios: SCENARIO_ORDER.map(emptyScenario),
    blockers: [],
    evidence: [],
  };
}

/** Oturum seviyesindeki blocker'ları roldan ve kimlikten TÜRETİR (fail-closed). */
export function deriveSessionBlockers(
  role: DeviceRole,
  id: PhFieldIdentity | null,
  userAffirmed: boolean,
  fieldPresent: boolean,
): string[] {
  const out: string[] = [];
  const add = (c: string): void => { if (!out.includes(c)) _pushBounded(out, c, MAX_BLOCKERS); };

  if (!fieldPresent) add('NATIVE_FIELD_PROBE_ABSENT');
  if (role === 'PHONE_CONFIRMED') add('DEVICE_IS_PHONE');
  else if (role !== 'HEAD_UNIT_CONFIRMED') add('DEVICE_NOT_HEAD_UNIT');

  if (userAffirmed && countHeadUnitSignals(id) === 0) {
    add('USER_AFFIRMATION_WITHOUT_TECHNICAL_EVIDENCE');
  }
  if (id && id.headUnitMarkerCount < 0) add('PACKAGE_VISIBILITY_LIMITED');

  return out;
}

/**
 * Kimlik/rol güncellemesi — ölçüm yapmadan yalnız cihaz kapısını tazeler.
 * Senaryo kayıtlarına DOKUNMAZ (izolasyon).
 */
export function withIdentity(
  session: PhoneHubFieldValidationSession,
  raw: PhoneHubFieldRaw,
  nowMs: number,
): PhoneHubFieldValidationSession {
  const role = classifyDeviceRole(raw.identity, session.userAffirmedHeadUnit);
  const conf = deviceRoleConfidence(role, raw.identity, session.userAffirmedHeadUnit);
  return {
    ...session,
    updatedAt: nowMs,
    deviceIdentity: identitySummaryOf(raw.identity),
    deviceRole: role,
    deviceRoleConfidence: conf,
    blockers: deriveSessionBlockers(role, raw.identity, session.userAffirmedHeadUnit, raw.fieldPresent),
  };
}

/**
 * Kullanıcı beyanını ayarlar. Beyan YALNIZ rol kuralına girdi olur; teknik kanıt
 * sıfırsa rolü YÜKSELTMEZ ve bir blocker olarak KAYDA GEÇER.
 */
export function withUserAffirmation(
  session: PhoneHubFieldValidationSession,
  affirmed: boolean,
  raw: PhoneHubFieldRaw | null,
  nowMs: number,
): PhoneHubFieldValidationSession {
  const id: PhFieldIdentity | null = raw ? raw.identity : _identityFromSummary(session);
  const role = classifyDeviceRole(id, affirmed);
  return {
    ...session,
    updatedAt: nowMs,
    userAffirmedHeadUnit: affirmed,
    deviceRole: role,
    deviceRoleConfidence: deviceRoleConfidence(role, id, affirmed),
    blockers: deriveSessionBlockers(role, id, affirmed, raw ? raw.fieldPresent : true),
  };
}

function _identityFromSummary(s: PhoneHubFieldValidationSession): PhFieldIdentity | null {
  const d = s.deviceIdentity;
  if (!d) return null;
  return {
    manufacturer: d.manufacturer, model: d.model, device: d.device, product: d.product,
    androidRelease: d.androidRelease, sdkInt: d.sdkInt,
    fingerprintSummary: d.fingerprintSummary, fingerprintHash: d.fingerprintHash,
    automotiveFeature: d.automotiveFeature, carServicePresent: d.carServicePresent,
    telephonyFeature: d.telephonyFeature,
    headUnitMarkerCount: d.headUnitMarkerCount, phoneOemMarkerCount: d.phoneOemMarkerCount,
    vendorFamily: d.vendorFamily,
    deviceRoleTechnical: s.deviceRole, deviceRoleConfidence: s.deviceRoleConfidence,
  };
}

/**
 * Senaryo ölçümünü kaydeder.
 *
 * ROL KAPISI: cihaz TELEFON olarak doğrulandıysa ölçüm BLOCKED olarak yazılır —
 * telefon verisi head unit senaryosu gibi CAPTURED SAYILMAZ.
 */
export function withScenarioCapture(
  session: PhoneHubFieldValidationSession,
  id: ScenarioId,
  raw: PhoneHubFieldRaw,
  nowMs: number,
): PhoneHubFieldValidationSession {
  const locked = areScenariosLocked(session.deviceRole);
  const observations = buildScenarioObservations(raw);
  const evidence = buildScenarioEvidence(id, raw, session.deviceRole);
  const blockers = detectScenarioBlockers(id, raw);

  const scenarios = _arr(session.scenarios).map((rec): ScenarioRecord => {
    if (rec.id !== id) return rec;   // İZOLASYON: diğer senaryolara DOKUNULMAZ
    const status: ScenarioStatus = locked
      ? 'BLOCKED'
      : nextScenarioStatus(nextScenarioStatus(rec.status, 'START'), 'CAPTURE');
    return {
      id: rec.id,
      status,
      startedAt: rec.startedAt ?? nowMs,
      capturedAt: locked ? rec.capturedAt : nowMs,
      completedAt: status === 'CAPTURED' ? nowMs : null,
      deviceRole: session.deviceRole,
      snapshotVersion: PH_FIELD_SCHEMA_VERSION,
      evidence: locked ? _arr(rec.evidence) : evidence,
      observations: locked ? _arr(rec.observations) : observations,
      blockers: locked ? [...new Set([...rec.blockers, 'DEVICE_IS_PHONE'])] : blockers,
    };
  });

  const allEvidence = locked
    ? _arr(session.evidence)
    : [..._arr(session.evidence).filter((e) => e.scenario !== id), ...evidence];

  return { ...session, updatedAt: nowMs, scenarios, evidence: allEvidence };
}

/**
 * Senaryo sıfırlama — YALNIZ bu LAB kaydını temizler. Sistem, Bluetooth veya OBD
 * durumuna DOKUNMAZ (saf fonksiyon olduğu için yapısal garanti).
 */
export function withScenarioReset(
  session: PhoneHubFieldValidationSession,
  id: ScenarioId,
  nowMs: number,
): PhoneHubFieldValidationSession {
  return {
    ...session,
    updatedAt: nowMs,
    scenarios: _arr(session.scenarios).map((rec) => (rec.id === id ? emptyScenario(id) : rec)),
    evidence: _arr(session.evidence).filter((e) => e.scenario !== id),
  };
}

/** Tüm CAPTURED kayıtlara bayatlık uygular (görünüm için). */
export function withStaleness(
  session: PhoneHubFieldValidationSession,
  nowMs: number,
): PhoneHubFieldValidationSession {
  return {
    ...session,
    scenarios: _arr(session.scenarios).map((rec) => applyScenarioStaleness(rec, nowMs)),
  };
}

export function isSessionStale(session: PhoneHubFieldValidationSession, nowMs: number): boolean {
  if (!Number.isFinite(session.updatedAt) || session.updatedAt <= 0) return true;
  return nowMs - session.updatedAt > SESSION_STALE_MS;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · ŞEMA GÖÇÜ (fail-soft, ASLA throw)
 * ════════════════════════════════════════════════════════════════════════ */

function _migrateScenario(v: unknown, id: ScenarioId): ScenarioRecord {
  const base = emptyScenario(id);
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;

  const statusRaw = o.status;
  const status: ScenarioStatus =
    statusRaw === 'READY' || statusRaw === 'CAPTURING' || statusRaw === 'CAPTURED'
      || statusRaw === 'BLOCKED' || statusRaw === 'FAILED' || statusRaw === 'STALE'
      ? statusRaw : 'NOT_STARTED';

  const evidence: FieldEvidence[] = [];
  if (Array.isArray(o.evidence)) {
    for (const e of o.evidence) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      _pushBounded(evidence, {
        id: _clampText(r.id),
        observation: _clampText(r.observation),
        evidenceSource: _clampText(r.evidenceSource),
        classification: _klass(r.classification),
        confidence: _conf(r.confidence),
        architecturalConsequence: _clampText(r.architecturalConsequence),
        deviceRole: _role(r.deviceRole),
        scenario: id,
        capturedAt: _int(r.capturedAt, 0),
      }, MAX_EVIDENCE_PER_SCENARIO);
    }
  }

  const observations: ScenarioObservation[] = [];
  if (Array.isArray(o.observations)) {
    for (const ob of o.observations) {
      if (!ob || typeof ob !== 'object') continue;
      const r = ob as Record<string, unknown>;
      _pushBounded(observations, {
        key: _clampText(r.key), value: _clampText(r.value), klass: _klass(r.klass),
      }, MAX_OBSERVATIONS_PER_SCENARIO);
    }
  }

  const blockers: string[] = [];
  if (Array.isArray(o.blockers)) {
    for (const b of o.blockers) {
      if (typeof b === 'string' && b.length > 0) _pushBounded(blockers, b, MAX_BLOCKERS);
    }
  }

  return {
    id,
    status,
    startedAt: _nullableTs(o.startedAt),
    capturedAt: _nullableTs(o.capturedAt),
    completedAt: _nullableTs(o.completedAt),
    deviceRole: _role(o.deviceRole),
    snapshotVersion: _int(o.snapshotVersion, PH_FIELD_SCHEMA_VERSION),
    evidence,
    observations,
    blockers,
  };
}

function _klass(v: unknown): Observability {
  return v === 'OBSERVED' || v === 'DERIVED' || v === 'STALE' ? v : 'UNAVAILABLE';
}

function _nullableTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Kalıcı veriden oturumu geri yükler. Bozuk/eksik/eski şema ASLA throw etmez;
 * anlaşılamayan alan güvenli varsayılana düşer. Tanınamayan gövde → null
 * (çağıran yeni oturum açar).
 */
export function migrateSession(v: unknown): PhoneHubFieldValidationSession | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.sessionId !== 'string' || o.sessionId.length === 0) return null;

  const byId = new Map<string, unknown>();
  if (Array.isArray(o.scenarios)) {
    for (const s of o.scenarios) {
      if (s && typeof s === 'object') {
        const sid = (s as Record<string, unknown>).id;
        if (typeof sid === 'string') byId.set(sid, s);
      }
    }
  }

  const scenarios = SCENARIO_ORDER.map((id) => _migrateScenario(byId.get(id), id));

  const blockers: string[] = [];
  if (Array.isArray(o.blockers)) {
    for (const b of o.blockers) {
      if (typeof b === 'string' && b.length > 0) _pushBounded(blockers, b, MAX_BLOCKERS);
    }
  }

  const evidence: FieldEvidence[] = [];
  for (const s of scenarios) for (const e of _arr(s.evidence)) {
    _pushBounded(evidence, e, MAX_EVIDENCE_PER_SCENARIO * SCENARIO_ORDER.length);
  }

  const identity = _migrateIdentity(o.deviceIdentity);
  const affirmed = o.userAffirmedHeadUnit === true;

  return {
    // Şema sürümü DAİMA güncel yazılır (göç tamamlandı) — eski sürüm saklanmaz.
    schemaVersion: PH_FIELD_SCHEMA_VERSION,
    sessionId: _clampText(o.sessionId),
    createdAt: _int(o.createdAt, 0),
    updatedAt: _int(o.updatedAt, 0),
    deviceIdentity: identity,
    deviceRole: _role(o.deviceRole),
    deviceRoleConfidence: _conf(o.deviceRoleConfidence),
    userAffirmedHeadUnit: affirmed,
    scenarios,
    blockers,
    evidence,
  };
}

function _migrateIdentity(v: unknown): DeviceIdentitySummary | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    manufacturer: _clampText(o.manufacturer ?? 'UNKNOWN'),
    model: _clampText(o.model ?? 'UNKNOWN'),
    device: _clampText(o.device ?? 'UNKNOWN'),
    product: _clampText(o.product ?? 'UNKNOWN'),
    androidRelease: _clampText(o.androidRelease ?? 'UNKNOWN'),
    sdkInt: _int(o.sdkInt),
    fingerprintSummary: _clampText(o.fingerprintSummary ?? 'UNKNOWN'),
    fingerprintHash: _clampText(o.fingerprintHash ?? 'UNKNOWN'),
    automotiveFeature: _tri(o.automotiveFeature),
    carServicePresent: _tri(o.carServicePresent),
    telephonyFeature: _tri(o.telephonyFeature),
    headUnitMarkerCount: _int(o.headUnitMarkerCount),
    phoneOemMarkerCount: _int(o.phoneOemMarkerCount),
    vendorFamily: _clampText(o.vendorFamily ?? 'UNKNOWN'),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · PII SÜZGECİ + DIŞA AKTARMA
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * PII desenleri — dışa aktarımda İKİNCİ KAPI. Model tipleri zaten PII taşımaz,
 * ama dışa aktarım ekrandaki nesneye GÜVENMEZ (rawTrafficExport ile aynı ilke).
 */
const PII_PATTERNS: readonly RegExp[] = [
  /\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g,          // MAC
  /\b\+?\d[\d\s()-]{8,}\d\b/g,                           // telefon numarası
  /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g,                     // e-posta
  /\b[A-HJ-NPR-Z0-9]{17}\b/g,                            // VIN
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                        // IPv4
];

/** Yasaklı anahtar parçaları — bu anahtarlar dışa aktarımdan DÜŞÜRÜLÜR. */
const DENY_KEY_FRAGMENTS: readonly string[] = [
  'mac', 'address', 'phone', 'number', 'contact', 'name',
  'title', 'artist', 'album', 'artworkdata', 'token', 'key', 'secret',
  'notification', 'message', 'transcript', 'vin', 'plate', 'lat', 'lon',
  'packagename', 'pkg', 'ssid', 'imei', 'serial', 'androidid',
];

/**
 * Anahtar dışa aktarılabilir mi.
 *
 * İSTİSNA: `deviceIdentity` altındaki `manufacturer`/`model`/`device`/`product`
 * DONANIM kimliğidir ve bu fazın ASIL sorusudur — bu yüzden 'name' parçası
 * yüzünden düşürülmemeleri için deny listesi 'name' değil 'contactname' gibi
 * bileşik parçalarla değil, TAM anahtar adıyla karşılaştırılır.
 */
export function isDeniedKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return true;
  const k = key.toLowerCase();
  /* İzin verilen donanım kimliği anahtarları — açık liste. */
  if (k === 'manufacturer' || k === 'model' || k === 'device' || k === 'product'
    || k === 'vendorfamily' || k === 'fingerprintsummary' || k === 'fingerprinthash'
    || k === 'androidrelease' || k === 'sdkint') {
    return false;
  }
  for (const frag of DENY_KEY_FRAGMENTS) if (k.includes(frag)) return true;
  return false;
}

/** Metinde PII deseni varsa maskeler (asla throw etmez). */
export function maskPii(v: string): string {
  let out = typeof v === 'string' ? v : '';
  for (const re of PII_PATTERNS) {
    try { out = out.replace(re, '[REDACTED]'); } catch { /* fail-soft */ }
  }
  return out.length > MAX_TEXT_CHARS ? out.slice(0, MAX_TEXT_CHARS) : out;
}

/** Derinlik/uzunluk tavanlı, deny-key düşüren, PII maskeleyen özyineli süzgeç. */
export function sanitizeForExport(v: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return maskPii(v);
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length && i < 256; i++) out.push(sanitizeForExport(v[i], depth + 1));
    return out;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (isDeniedKey(k)) continue;
      out[k] = sanitizeForExport(val, depth + 1);
    }
    return out;
  }
  return null;
}

export interface FieldExportResult {
  readonly fileName: string;
  readonly body: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

/** Kimlik taşımayan dosya adı — YALNIZ zaman damgası. */
export function buildFieldExportFileName(wallMs: number): string {
  const ms = typeof wallMs === 'number' && Number.isFinite(wallMs) ? wallMs : 0;
  let stamp: string;
  try { stamp = new Date(ms).toISOString().replace(/[:.]/g, '-'); }
  catch { stamp = String(ms); }
  return `phone-hub-field-validation-${stamp}.json`;
}

/**
 * PII'siz dışa aktarma gövdesi. ASLA throw etmez; serileştirme başarısızsa
 * hata gövdesi döner (fail-soft) — çağıran kullanıcıya dürüst mesaj gösterir.
 */
export function buildFieldExport(
  session: PhoneHubFieldValidationSession,
  wallMs: number,
): FieldExportResult {
  const decisions = decideAuthorities(session);
  const coex = assessCoexistence(session);
  const ready = assessReadiness(session);

  const report = {
    schema: PH_FIELD_EXPORT_SCHEMA,
    schemaVersion: PH_FIELD_SCHEMA_VERSION,
    generatedAt: _isoOrEmpty(wallMs),
    readOnly: true,
    piiFree: true,
    deviceRole: session.deviceRole,
    deviceRoleConfidence: session.deviceRoleConfidence,
    userAffirmedHeadUnit: session.userAffirmedHeadUnit,
    deviceIdentity: session.deviceIdentity,
    scenarios: _arr(session.scenarios).map((s) => ({
      id: s.id,
      status: s.status,
      startedAt: s.startedAt,
      capturedAt: s.capturedAt,
      completedAt: s.completedAt,
      deviceRole: s.deviceRole,
      snapshotVersion: s.snapshotVersion,
      observations: s.observations,
      evidenceCount: _arr(s.evidence).length,
      blockers: _arr(s.blockers),
    })),
    authorities: decisions,
    coexistence: coex,
    readiness: ready.readiness,
    unmetReadinessConditions: ready.unmet,
    blockers: _arr(session.blockers),
    evidence: _arr(session.evidence),
    honesty: [
      'Bu dosya CAROS LAB saha aracıyla ölçülmüştür; elle yazılmamıştır.',
      'UNKNOWN varsayılandır: kanıt yoksa hiçbir alan başarılı gösterilmez.',
      'Telefonda alınan ölçüm head unit otoritesi üretmez (rol kapısı zorunludur).',
      'PII (MAC, numara, kişi, mesaj, parça adı, paket adı) yapısal olarak taşınmaz ' +
      've dışa aktarımda ikinci kez süzülür.',
    ],
  };

  let body: string;
  let truncated = false;
  try {
    body = JSON.stringify(sanitizeForExport(report), null, 2);
  } catch {
    return {
      fileName: buildFieldExportFileName(wallMs),
      body: JSON.stringify({ schema: PH_FIELD_EXPORT_SCHEMA, error: 'serialize-failed' }),
      bytes: 0,
      truncated: false,
    };
  }

  let bytes = _byteLength(body);
  if (bytes > MAX_EXPORT_BYTES) {
    /* Tavan aşıldı: kanıt gövdesi düşürülür, SAYISI dürüstçe beyan edilir. */
    truncated = true;
    try {
      body = JSON.stringify(sanitizeForExport({
        ...report,
        evidence: [],
        evidenceOmittedCount: _arr(session.evidence).length,
        truncated: true,
      }), null, 2);
    } catch {
      body = JSON.stringify({ schema: PH_FIELD_EXPORT_SCHEMA, error: 'serialize-failed' });
    }
    bytes = _byteLength(body);
  }

  return { fileName: buildFieldExportFileName(wallMs), body, bytes, truncated };
}

function _byteLength(s: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  } catch { /* fail-soft */ }
  return s.length;
}

function _isoOrEmpty(ms: number): string {
  try { return new Date(ms).toISOString(); } catch { return ''; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · ÜST ÖZET (UI için tek çağrı)
 * ════════════════════════════════════════════════════════════════════════ */

export interface FieldSummary {
  readonly deviceRole: DeviceRole;
  readonly deviceRoleConfidence: Confidence;
  readonly readiness: Readiness;
  readonly unmet: readonly string[];
  readonly controlPlaneConfidence: Confidence;
  readonly authorities: readonly AuthorityDecision[];
  readonly coexistence: CoexistenceVerdict;
  readonly mediaResult: MediaResult;
  readonly callResult: CallResult;
  readonly openBlockers: readonly string[];
  readonly scenariosLocked: boolean;
  readonly capturedCount: number;
}

export function buildFieldSummary(session: PhoneHubFieldValidationSession): FieldSummary {
  const authorities = decideAuthorities(session);
  const ready = assessReadiness(session);
  const open = new Set<string>(_arr(session.blockers));
  for (const s of _arr(session.scenarios)) for (const b of _arr(s.blockers)) open.add(b);

  return {
    deviceRole: session.deviceRole,
    deviceRoleConfidence: session.deviceRoleConfidence,
    readiness: ready.readiness,
    unmet: ready.unmet,
    controlPlaneConfidence: controlPlaneConfidence(authorities),
    authorities,
    coexistence: assessCoexistence(session),
    mediaResult: mediaResultOf(authorities),
    callResult: callResultOf(authorities),
    openBlockers: [...open].slice(0, MAX_BLOCKERS),
    scenariosLocked: areScenariosLocked(session.deviceRole),
    capturedCount: _arr(session.scenarios).filter((s) => s.status === 'CAPTURED').length,
  };
}

/** Otorite güvenlerinin EN ZAYIFI — üst özet rozeti için. */
export function weakestAuthorityConfidence(
  decisions: readonly AuthorityDecision[],
): Confidence {
  let worst: Confidence = 'HIGH';
  for (const d of decisions) worst = _minConfidence(worst, d.confidence);
  return decisions.length === 0 ? 'NONE' : worst;
}
