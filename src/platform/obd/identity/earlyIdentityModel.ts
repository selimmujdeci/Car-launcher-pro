/**
 * earlyIdentityModel — P0-VDK-F5H · ERKEN ARAÇ KİMLİĞİ (SAF KARAR KATMANI).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (bu dosyanın var olma nedeni) ───────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F4-C güçlü bir araç parmak izi üretiyor, F5-F/F5-G o parmak iziyle kalıcı
 * bölüm açıyor — ama parmak izi YALNIZ **tam araç taramasının** ölçtüğü
 * `RESPONSE_SIGNATURE` ekseninden doğuyordu (`productionDiscovery` kalibrasyon
 * alanlarına açıkça `null` yazar). Sonuç ölçüldü:
 *
 *   · kullanıcı tam tarama çalıştırmazsa oturum `UNIDENTIFIED` kalıyor,
 *   · boşluk sicili ve yetenek bölümü HİÇ hydrate olmuyor,
 *   · önceki öğrenme kullanılamıyor (aynı araç yeniden "bilinmiyor" oluyor).
 *
 * Bu dosya o boşluğu kapatan kararların SAF yarısıdır: hangi DID sorulur,
 * hangi sonuç kimlik sayılır, hangi sonuçta bir sonraki adaya geçilebilir,
 * erken kimlik ile tam tarama kimliği arasında hangi ilişki KANITLANABİLİR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YENİ ARAÇ KİMLİK OTORİTESİ DEĞİLDİR.** Parmak izi ve gücü MEVCUT
 *     F4-C (`buildCapabilityFingerprint` / `isFingerprintReusable`) otoritesinden
 *     gelir; burada ne yeni bir güven formülü ne de yeni bir eksen tanımlanır.
 * (2) **YENİ KARMA SİSTEMİ DEĞİLDİR.** Tek karma primitifi MEVCUT
 *     `fingerprintHash`tir (aynı FNV-1a çifti). Yeni tuz/anahtar/şifre YOK.
 * (3) **YENİ SONUÇ SÖZLÜĞÜ DEĞİLDİR.** Yoklama sonucu MEVCUT
 *     `deriveServicePresence` (F4-B) ile sınıflandırılır; oturum ihtiyacı
 *     MEVCUT `deriveSessionRequirement` (F5-C) ile türetilir.
 * (4) **OEM SİHİRLİ DID LİSTESİ DEĞİLDİR.** Aday DID'lerin tamamı ISO 14229-1
 *     standardıdır ve HEPSİ bu repoda ZATEN tanımlıdır (§1).
 * (5) **MIGRATION MOTORU DEĞİLDİR.** Kanıtsız hiçbir bölüm birleştirilmez.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import { fingerprintHash } from '../../vehicleFingerprintService';
import type { PduOutcome } from '../pdu';
import {
  deriveServicePresence, NRC_SERVICE_NOT_SUPPORTED, type ServicePresence,
} from '../ecuCapabilityModel';
import { isSessionFamilyNrc } from '../healing/sessionHealing';

/* ══════════════════════════════════════════════════════════════════════════
   1) ADAY DID'LER — SİHİR YOK, HEPSİ STANDART VE HEPSİ REPODA VAR
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Erken kimlik için sorulacak SALT-OKUNUR kimlik/kalibrasyon DID'leri.
 *
 * ⚠️ SIRA BİR ÜSLUP TERCİHİ DEĞİL, BİR KİMLİK KARARIDIR — aşağıdaki
 * `mayTryNextDid` kuralıyla birlikte okunmalıdır.
 *
 * ── SEÇİM ÖLÇÜTÜ (görev §3 sırasıyla) ────────────────────────────────────
 *  1. Repoda/standartta ZATEN tanımlı olmak. Üçü de ISO 14229-1 Tablo C.1'dir
 *     ve üçü de bu repoda ZATEN okunuyor:
 *       · `F18C` → `ecuIdentityService.DID_SERIAL`   + `oemProfileRegistry`
 *       · `F191` → `ecuIdentityService.DID_HW_NUMBER`
 *       · `F187` → `oemProfileRegistry` (yedek parça numarası)
 *     Repoda TANIMSIZ hiçbir DID (F189/F195 dâhil) BURAYA EKLENMEDİ:
 *     tanımsız DID sormak, tam olarak bu turun yasakladığı "sihirli OEM
 *     listesi" davranışıdır.
 *  2. Salt-okunur olmak → hepsi 0x22 (native `DiagnosticServiceGate`
 *     beyaz listesinde) ve hiçbiri yazma/aktüatör değildir.
 *  3. Tek ya da çok az istek → bu liste ÜÇ ile sınırlıdır (§12: 1–3 istek).
 *  4. SecurityAccess gerektirmemek → 0x27 bu turda hiçbir yoldan çağrılmaz.
 *  5. Güçlü eksen üretebilmek → üçü de F4-C'nin `CALIBRATION` eksenini besler.
 *
 * ── NEDEN F18C ÖNCE (ayrım gücü) ──────────────────────────────────────────
 * `F187`/`F191` **varyant** kimliğidir: aynı model/donanımdaki İKİ FARKLI araç
 * bu değerlerde AYNIDIR. `F18C` (ECU seri numarası) ise **örnek** kimliğidir ve
 * iki fiziksel aracı ayırt eder. Filo senaryosunda (bu üründe filo yönetimi
 * VARDIR) varyant kimliğini önce koymak, iki farklı aracın aynı kalıcı bölüme
 * düşmesi demekti — görev §10'un "iki aracı birleştirmek iki bölüm bırakmaktan
 * çok daha kötüdür" kuralının doğrudan ihlali.
 */
export interface EarlyIdentityDidSpec {
  /** 4 hex hane, büyük harf. */
  readonly did: string;
  /** Bu turda YALNIZ UDS 0x22 (CAN) — KWP LID karşılığı repoda TANIMSIZ. */
  readonly service: '22';
  readonly name: string;
  /** Standart referansı — metin kopyalanmadı. */
  readonly reference: string;
  /** Kimliğin AYRIM GÜCÜ: örnek (araç) mi, varyant (model) mi. */
  readonly discrimination: 'INSTANCE' | 'VARIANT';
}

export const EARLY_IDENTITY_DID_ORDER: readonly EarlyIdentityDidSpec[] = Object.freeze([
  {
    did: 'F18C', service: '22', name: 'ECU seri numarası',
    reference: 'ISO 14229-1 · ECUSerialNumberDataIdentifier',
    discrimination: 'INSTANCE',
  },
  {
    did: 'F191', service: '22', name: 'ECU donanım numarası',
    reference: 'ISO 14229-1 · vehicleManufacturerECUHardwareNumberDataIdentifier',
    discrimination: 'VARIANT',
  },
  {
    did: 'F187', service: '22', name: 'Yedek parça numarası',
    reference: 'ISO 14229-1 · vehicleManufacturerSparePartNumberDataIdentifier',
    discrimination: 'VARIANT',
  },
] as const);

/** Erken kimlik turunun MUTLAK istek tavanı (§12: 1–3 salt-okunur istek). */
export const EARLY_IDENTITY_MAX_REQUESTS = EARLY_IDENTITY_DID_ORDER.length;

/* ══════════════════════════════════════════════════════════════════════════
   2) TEK YOKLAMANIN SINIFI
   ══════════════════════════════════════════════════════════════════════════ */

export type DidProbeVerdict =
  /** Pozitif yanıt + gövde ölçüldü → kimlik ekseni ÜRETİLEBİLİR. */
  | 'MEASURED'
  /** Pozitif yanıt ama gövde BOŞ → değer yok, kimlik üretilemez. */
  | 'EMPTY_VALUE'
  /** ECU `7F .. 11` dedi: bu DID bu ECU'da YOK — DETERMİNİSTİK araç gerçeği. */
  | 'NOT_SUPPORTED'
  /** Oturum ailesi NRC (7E·7F·22·24) — servis VAR, erişim oturuma bağlı. */
  | 'SESSION_REQUIRED'
  /** Başka NRC — VAR ama koşullu (güvenlik/koşul); bu turda kimlik üretilmez. */
  | 'CONDITIONED'
  /** Köprü/kapı taşımadı — ARAÇ hakkında hiçbir şey ölçülmedi. */
  | 'NOT_CARRIED'
  /** Sessizlik · zaman aşımı · hat hatası · bozuk yanıt → DETERMİNİSTİK DEĞİL. */
  | 'UNSTABLE';

export const DID_PROBE_VERDICT_LABEL: Readonly<Record<DidProbeVerdict, string>> = {
  MEASURED:         'ÖLÇÜLDÜ — kimlik ekseni üretilebilir',
  EMPTY_VALUE:      'POZİTİF ama GÖVDE BOŞ — değer yok',
  NOT_SUPPORTED:    'ECU 7F-11 dedi — bu DID bu ECU\'da YOK (deterministik)',
  SESSION_REQUIRED: 'OTURUM GEREKİR (7E·7F·22·24) — kör oturum komutu YOK',
  CONDITIONED:      'KOŞULLU NRC — servis var, erişim koşula bağlı',
  NOT_CARRIED:      'KÖPRÜ/KAPI TAŞIMADI — araç kararı DEĞİL',
  UNSTABLE:         'SESSİZLİK/ZAMAN AŞIMI/BOZUK — deterministik değil',
} as const;

/**
 * Bir DID yoklamasının sınıfı — **MEVCUT** `deriveServicePresence` üzerinden.
 *
 * İkinci bir sonuç sözlüğü KURULMAZ: varlık kararı F4-B otoritesinindir,
 * burada yalnız o karar erken kimlik diline çevrilir.
 */
export function classifyDidProbe(
  outcome: PduOutcome, nrc: number | null, dataHexLength: number,
): DidProbeVerdict {
  const presence: ServicePresence = deriveServicePresence(outcome, nrc);
  switch (presence) {
    case 'PRESENT':
      return dataHexLength > 0 ? 'MEASURED' : 'EMPTY_VALUE';
    case 'ABSENT':
      return 'NOT_SUPPORTED';
    case 'PRESENT_BUT_CONDITIONED':
      return isSessionFamilyNrc(nrc) ? 'SESSION_REQUIRED' : 'CONDITIONED';
    case 'UNKNOWN_TRANSPORT_LIMIT':
    case 'UNKNOWN_ADDRESSING':
    case 'PROBE_FORBIDDEN':
      return 'NOT_CARRIED';
    default:
      return 'UNSTABLE';
  }
}

/**
 * Bir sonraki aday DID DENENEBİLİR Mİ — **kimlik KARARLILIĞININ kilidi**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Bu, bu dosyanın en kritik kuralıdır ve sebebi şudur: parmak izi metnine
 * HANGİ DID'in girdiği kimliğin kendisini değiştirir. Eğer geçici bir
 * sessizlikte bir sonraki adaya geçseydik, AYNI ARAÇ bir açılışta `F18C`,
 * başka bir açılışta `F191` ile kimliklenir ve **her açılışta başka bir kalıcı
 * bölüm** açardı — yani F5-H'nin çözmeye çalıştığı sorunun daha kötüsünü
 * üretirdik.
 *
 * Bu yüzden yalnız `NOT_SUPPORTED` (ECU'nun `7F .. 11` beyanı) bir sonraki
 * adaya geçmeyi hak eder: o, aracın DETERMİNİSTİK ve tekrarlanabilir bir
 * gerçeğidir. Sessizlik/zaman aşımı/hat hatası ise ÖLÇÜM KAYBIDIR ve turu
 * bitirir — kimlik üretilmez (fail-closed).
 */
export function mayTryNextDid(v: DidProbeVerdict): boolean {
  return v === 'NOT_SUPPORTED';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ADMİSYON — SAF, FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

export type EarlyIdentityAdmission = 'RUN' | 'DEFERRED' | 'BLOCKED';

export const EARLY_IDENTITY_ADMISSION_LABEL:
Readonly<Record<EarlyIdentityAdmission, string>> = {
  RUN:      'ÇALIŞTI — erken kimlik ölçüldü',
  DEFERRED: 'ERTELENDİ — bütçe/öncelik; bir sonraki fırsatta',
  BLOCKED:  'ENGELLENDİ — yapısal ön koşul YOK',
} as const;

export interface EarlyIdentityAdmissionInput {
  /** `diagnosticAdmission` sonucu; `READY` değilse tek bayt çıkmaz. */
  readonly admission: string;
  readonly transactionLive: boolean;
  readonly cancelled: boolean;
  /** Oturum mührü ölçülemedi (`sessionEpoch === -1`). */
  readonly staleEpoch: boolean;
  /** Protokol ÖLÇÜLDÜ mü (ATDPN) — bilinmiyorsa hangi tanım geçerli bilinemez. */
  readonly protocolKnown: boolean;
  /** Aktif protokol sınıfı 0x22'nin tanımlı olduğu sınıf mı (`can`). */
  readonly protocolSupportsDid: boolean;
  /** Genel salt-okunur PDU köprüsü bu ortamda VAR mı (ölçüm). */
  readonly genericBridgeAvailable: boolean;
  /** Adresi ve yanıt kanıtı ÖLÇÜLMÜŞ hedef sayısı. */
  readonly provenTargets: number;
  /** Hedefe uyan güvenli CDDL 0x22 tanımı bulundu mu. */
  readonly didServiceDefAvailable: boolean;
  readonly remainingRequests: number;
}

export interface EarlyIdentityAdmissionDecision {
  readonly admission: EarlyIdentityAdmission;
  readonly reason: string;
  readonly allocatedRequests: number;
}

const NO_ALLOC = { allocatedRequests: 0 } as const;

/**
 * Erken kimlik ölçümü ŞİMDİ yapılabilir mi — SAF karar.
 *
 * FAIL-CLOSED ve **hiçbir dal araç hakkında hüküm üretmez**: reddedilen bir tur
 * "bu araçta kimlik yok" DEMEZ; yalnız "ölçemedik" der. Erken kimlik bir
 * KULLANILABİLİRLİK KAPISI DEĞİLDİR (§12): burada `BLOCKED` dönmesi normal
 * OBD/PID akışını etkilemez.
 */
export function evaluateEarlyIdentityAdmission(
  i: EarlyIdentityAdmissionInput,
): EarlyIdentityAdmissionDecision {
  if (i.admission !== 'READY') {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: `tanı admisyonu READY değil: ${i.admission}` };
  }
  if (i.cancelled) {
    return { admission: 'BLOCKED', ...NO_ALLOC, reason: 'işlem iptal edildi' };
  }
  if (i.staleEpoch) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'OBD oturum mührü ölçülemedi — ölçüm başka araca yazılamaz' };
  }
  if (!i.transactionLive) {
    return { admission: 'BLOCKED', ...NO_ALLOC, reason: 'işlem canlı değil' };
  }
  if (!i.protocolKnown) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'aktif protokol ÖLÇÜLMEDİ — hangi tanımın geçerli olduğu bilinemez' };
  }
  if (!i.protocolSupportsDid) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'aktif protokol sınıfında 0x22 DID tanımı YOK — '
        + 'KWP/ISO kimlik LID\'i bu repoda TANIMSIZ, uydurulmaz' };
  }
  if (!i.genericBridgeAvailable) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'genel salt-okunur PDU köprüsü YOK (eski APK) — araç kararı DEĞİL' };
  }
  if (i.provenTargets === 0) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'ölçülmüş ECU hedefi YOK — adres/rol uydurulmaz' };
  }
  if (!i.didServiceDefAvailable) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'güvenli CDDL 0x22 tanımı yok — kör istek kurulmaz' };
  }
  if (i.remainingRequests < 1) {
    return { admission: 'DEFERRED', ...NO_ALLOC,
      reason: 'istek bütçesi kalmadı — kısmi kimlik İDDİA EDİLMEZ' };
  }

  const alloc = Math.min(EARLY_IDENTITY_MAX_REQUESTS, i.remainingRequests);
  return {
    admission: 'RUN', allocatedRequests: alloc,
    reason: `kalan ${i.remainingRequests} istekten ${alloc} pay ayrıldı · `
      + `${i.provenTargets} ölçülmüş hedef`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KALİBRASYON KANIT SÖZLEŞMESİ — HAM DEĞER TAŞINMAZ
   ══════════════════════════════════════════════════════════════════════════ */

/** Tek bir DID okumasının ÖLÇÜLMÜŞ sonucu (ham değer BU TİPTE DE YOKTUR). */
export interface CalibrationReading {
  readonly did: string;
  readonly verdict: DidProbeVerdict;
  readonly nrc: number | null;
  readonly latencyMs: number | null;
  /** Yanıt gövdesinin hex hane sayısı — İÇERİK DEĞİL, yalnız ölçü. */
  readonly valueHexLength: number;
}

export interface CalibrationEvidence {
  /** Kimliği üreten DID (ör. `F18C`). */
  readonly calibrationDid: string;
  /** Değerin KARMASI — mevcut `fingerprintHash` primitifi. Ham değer YOK. */
  readonly calibrationValueHash: string;
  /** Kimliği üreten DID'in ayrım gücü — filo riski burada görünür. */
  readonly discrimination: 'INSTANCE' | 'VARIANT';
}

/**
 * Ham DID gövdesinden KALICI KİMLİK KANITI üretir.
 *
 * ⚠️ **HAM DEĞER BU FONKSİYONDAN DIŞARI ÇIKMAZ.** Girdi olarak alınır, karması
 * alınır, atılır. Dönen nesnede seri numarası, VIN, metin ya da hex gövde
 * YOKTUR; `fingerprintHash` geri döndürülemezdir ve çıktısı 16 küçük hex
 * hanedir — yani `gapLedgerScope.isPersistableVehicleRef` kalıbıyla uyumlu,
 * ham VIN/MAC/token ile YAPISAL OLARAK karışamaz.
 *
 * Karma anahtarına DID de girer: aynı gövdenin farklı DID'den gelmesi farklı
 * kimliktir (iki DID'i aynı saymak, kanıtı uydurmaktır).
 *
 * Gövde boşsa `null` — sahte karma ÜRETİLMEZ.
 */
export function buildCalibrationEvidence(
  spec: EarlyIdentityDidSpec, rawValueHex: string | null,
): CalibrationEvidence | null {
  if (typeof rawValueHex !== 'string') return null;
  const clean = rawValueHex.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (clean.length === 0) return null;
  return {
    calibrationDid: spec.did.toUpperCase(),
    calibrationValueHash: fingerprintHash(`CAL:${spec.did.toUpperCase()}:${clean}`),
    discrimination: spec.discrimination,
  };
}

/**
 * Kalıcı kimlik yüzeyinde HAM değer var mı — test ve LAB için kanıt yardımcı.
 *
 * `fingerprintLeaksRawVin` ile AYNI felsefe: iddia değil, ARAMA.
 */
export function evidenceLeaksRawValue(
  evidence: unknown, rawValueHex: string | null,
): boolean {
  if (typeof rawValueHex !== 'string') return false;
  const needle = rawValueHex.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (needle.length === 0) return false;
  try {
    return JSON.stringify(evidence).toUpperCase().includes(needle);
  } catch { return false; }
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ERKEN ↔ TAM TARAMA UZLAŞTIRMASI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * İki kimlik arasındaki KANITLANMIŞ ilişki.
 *
 * ── NEDEN KİMLİKLER BİREBİR AYNI ÇIKMAZ ───────────────────────────────────
 * F4-C'nin ECU kimliği `TX|RX|P|S|C` metninden doğar. Erken turda `S`
 * (yanıt imzası) BOŞTUR (henüz servis taraması yapılmadı), tam taramada ise
 * DOLUDUR. Yani aynı araçta bile iki parmak izi ID'si FARKLI çıkar. Bu bir
 * kusur değil, ölçümün dürüst sonucudur — ve gizlenmez.
 */
export type IdentityRelation =
  /** Parmak izi kimlikleri BİREBİR aynı. */
  | 'MATCH'
  /** Kimlikler farklı ama ORTAK GÜÇLÜ KANIT aynı → aynı araç/ECU örneği. */
  | 'EARLY_WEAKER_SAME_VEHICLE'
  /** Ortak güçlü kanıt ÇELİŞİYOR → fail-closed. */
  | 'CONFLICT'
  /** Ortak güçlü kanıt ÖLÇÜLEMEDİ → ilişki KANITSIZ; birleştirme YOK. */
  | 'UNVERIFIED_RELATION';

export const IDENTITY_RELATION_LABEL: Readonly<Record<IdentityRelation, string>> = {
  MATCH:                     'AYNI KİMLİK — parmak izi birebir',
  EARLY_WEAKER_SAME_VEHICLE: 'AYNI ARAÇ — erken kimlik daha zayıf ama ORTAK KANIT aynı',
  CONFLICT:                  'ÇELİŞKİ — ortak kanıt uyuşmadı; kalıcılık DONDURULDU',
  UNVERIFIED_RELATION:       'KANITSIZ — ilişki ölçülemedi; hiçbir bölüm BİRLEŞTİRİLMEDİ',
} as const;

export interface IdentityReconcileInput {
  /** Erken turda ölçülen kimlik referansı. */
  readonly earlyRef: string;
  /** Erken turda ölçülen kalibrasyon kanıtı. */
  readonly earlyDid: string;
  readonly earlyValueHash: string;
  /** Erken kimliğin ölçüldüğü ECU yanıt adresi. */
  readonly earlyEcuRx: string;
  /** Tam taramanın ürettiği parmak izi kimliği. */
  readonly fullRef: string;
  /**
   * Tam tarama SIRASINDA aynı ECU'da AYNI DID'in YENİDEN ölçülmüş karması.
   * Ölçülemediyse `null` — burada varsayım YAPILMAZ.
   */
  readonly reverifiedValueHash: string | null;
  /** Yeniden doğrulamanın yapıldığı ECU yanıt adresi; yapılmadıysa `null`. */
  readonly reverifiedEcuRx: string | null;
}

export interface IdentityReconcileResult {
  readonly relation: IdentityRelation;
  readonly reason: string;
  /**
   * Bölümün bağlı kalacağı kimlik. `null` = güvenilir kimlik YOK
   * (çağıran kalıcılığı DONDURUR).
   */
  readonly adoptedRef: string | null;
  /** Kalıcılık dondurulmalı mı (yalnız `CONFLICT`). */
  readonly persistenceFrozen: boolean;
}

/**
 * Erken kimlik ile tam tarama kimliğini UZLAŞTIRIR — **birleştirme yalnız
 * ORTAK ÖLÇÜLMÜŞ GÜÇLÜ KANITLA** yapılır.
 *
 * ── PAZARLIKSIZ SINIR ─────────────────────────────────────────────────────
 * Protokol, adres kümesi ve PID bitmap'inin aynı olması bir birleştirme kanıtı
 * DEĞİLDİR (görev §9): aynı model iki araç bu üçünde de birebir aynıdır. Tek
 * kabul edilen kanıt, **aynı ECU'da aynı DID'in aynı karmayı vermesidir**.
 *
 * ── NEDEN `UNVERIFIED_RELATION` BİLE `adoptedRef` VEREBİLİR ───────────────
 * Verilen `adoptedRef`, kanıtsız bir BİRLEŞTİRME değil, kanıtsız bir
 * DEĞİŞTİRMEDEN kaçınmadır: erken kimlik ZATEN aktiftir ve onu kanıtsız bir
 * kimliğe çevirmek de en az onun kadar kanıtsız bir iddiadır. Bu kararı
 * çağıran, YALNIZ aynı oturum mührü içinde kullanır — ve oturum mührü bir
 * kimlik ekseni DEĞİLDİR (hiçbir kimliği DEĞİŞTİRMEZ, yalnız değiştirmemeyi
 * meşrulaştırır).
 */
export function reconcileVehicleIdentity(
  i: IdentityReconcileInput,
): IdentityReconcileResult {
  if (i.reverifiedValueHash === null || i.reverifiedEcuRx === null) {
    return {
      relation: 'UNVERIFIED_RELATION',
      reason: 'ortak kanıt (aynı ECU · aynı DID) YENİDEN ÖLÇÜLEMEDİ — '
        + 'protokol/adres/bitmap benzerliği birleştirme kanıtı DEĞİLDİR',
      adoptedRef: i.earlyRef,
      persistenceFrozen: false,
    };
  }
  if (i.reverifiedEcuRx.toUpperCase() !== i.earlyEcuRx.toUpperCase()) {
    return {
      relation: 'UNVERIFIED_RELATION',
      reason: `yeniden doğrulama BAŞKA ECU'da yapıldı `
        + `(${i.reverifiedEcuRx} ≠ ${i.earlyEcuRx}) — kanıt ortak DEĞİL`,
      adoptedRef: i.earlyRef,
      persistenceFrozen: false,
    };
  }
  if (i.reverifiedValueHash !== i.earlyValueHash) {
    return {
      relation: 'CONFLICT',
      reason: `aynı ECU (${i.earlyEcuRx}) aynı DID (${i.earlyDid}) için FARKLI `
        + 'değer verdi — iki aracı birleştirmektense kalıcılık DONDURULUR',
      adoptedRef: null,
      persistenceFrozen: true,
    };
  }
  if (i.earlyRef === i.fullRef) {
    return {
      relation: 'MATCH',
      reason: 'parmak izi kimlikleri birebir aynı ve ortak kanıt doğrulandı',
      adoptedRef: i.earlyRef,
      persistenceFrozen: false,
    };
  }
  return {
    relation: 'EARLY_WEAKER_SAME_VEHICLE',
    reason: `kimlikler farklı (erken turda yanıt imzası ölçülmemişti) ama aynı `
      + `ECU'da aynı DID (${i.earlyDid}) AYNI karmayı verdi — bölüm KORUNUR`,
    adoptedRef: i.earlyRef,
    persistenceFrozen: false,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   6) TUR SONUCU
   ══════════════════════════════════════════════════════════════════════════ */

export type EarlyIdentityOutcome =
  /** Güçlü, yeniden kullanılabilir kimlik ölçüldü ve bağlam AKTİVE EDİLDİ. */
  | 'EARLY_IDENTITY_MEASURED'
  /** Kalibrasyon ölçüldü ama F4-C yeniden kullanıma YETMEDİ (kalıcılık yok). */
  | 'EARLY_IDENTITY_WEAK'
  /** Ölçüm denendi, deterministik sonuç ALINAMADI. */
  | 'EARLY_IDENTITY_UNAVAILABLE'
  /** Yapısal ön koşul yok; hatta TEK BAYT ÇIKMADI. */
  | 'EARLY_IDENTITY_BLOCKED'
  /** Bütçe/oturum nedeniyle ertelendi; bir sonraki fırsatta denenir. */
  | 'EARLY_IDENTITY_DEFERRED';

export const EARLY_IDENTITY_OUTCOME_LABEL:
Readonly<Record<EarlyIdentityOutcome, string>> = {
  EARLY_IDENTITY_MEASURED:    'ÖLÇÜLDÜ — güçlü kimlik, bölüm bağlandı',
  EARLY_IDENTITY_WEAK:        'ZAYIF — kalıcı bölüm AÇILMADI (bellek içi)',
  EARLY_IDENTITY_UNAVAILABLE: 'ÖLÇÜLEMEDİ — deterministik sonuç yok',
  EARLY_IDENTITY_BLOCKED:     'ENGELLENDİ — hatta tek bayt çıkmadı',
  EARLY_IDENTITY_DEFERRED:    'ERTELENDİ — bütçe/oturum',
} as const;

/**
 * Yoklama sonuçlarından TUR SONUCU türetir — SAF.
 *
 * `null` kalibrasyon + tek bir `SESSION_REQUIRED` görülmüşse sonuç
 * `DEFERRED`dir (bir dahaki sefere oturum otoritesiyle denenebilir);
 * `NOT_SUPPORTED` zinciri tükendiyse sonuç `UNAVAILABLE`dır (bu araçta bu üç
 * DID YOK — ama bu bir ÖLÇÜMDÜR, "araç kimliksiz" hükmü DEĞİLDİR).
 */
export function deriveEarlyIdentityOutcome(
  readings: readonly CalibrationReading[],
  hasCalibration: boolean,
  fingerprintReusable: boolean,
): EarlyIdentityOutcome {
  if (hasCalibration) {
    return fingerprintReusable
      ? 'EARLY_IDENTITY_MEASURED' : 'EARLY_IDENTITY_WEAK';
  }
  if (readings.length === 0) return 'EARLY_IDENTITY_BLOCKED';
  if (readings.some((r) => r.verdict === 'SESSION_REQUIRED')) {
    return 'EARLY_IDENTITY_DEFERRED';
  }
  return 'EARLY_IDENTITY_UNAVAILABLE';
}

/** ISO 14229-1'in "servis/DID yok" NRC'si — tek yerde, kopyalanmaz. */
export { NRC_SERVICE_NOT_SUPPORTED };
