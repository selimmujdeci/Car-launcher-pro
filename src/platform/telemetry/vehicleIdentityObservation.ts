/**
 * vehicleIdentityObservation.ts — KANONİK ARAÇ KİMLİK GÖZLEMİ (SAF).
 *
 * ── NEDEN ─────────────────────────────────────────────────────────────
 * Kimlik verisi bugün DÖRT ayrı yerde üretiliyor:
 *   1. native handshake  → `CarLauncher.performHandshake()` → Mode 09 PID 02 ham VIN
 *   2. `vehicleProfileService` → `decodeWmi(vin)` / `decodeVinYear(vin)` → marka/yıl
 *   3. `obdStorage`      → aktif protokol + taşıma doğrulaması
 *   4. `vehicleFingerprintService` → deterministik `hash` + öğrenilmiş güven
 * Bunlar `useVidStore` + `vehicleFingerprintStore` üzerinde buluşuyor ama
 * ORTAK BİR KİMLİK SÖZLEŞMESİ YOKTU. Bu modül o sözleşmedir.
 *
 * ── OTORİTE SINIRLARI (BAĞLAYICI) ─────────────────────────────────────
 *   · **VIN sahiplik otoritesi DEĞİLDİR.** Sahiplik yalnız `owner_id` +
 *     `pair_vehicle_to_user` zinciriyle belirlenir. VIN yalnız bir GÖZLEMDİR.
 *   · **`device_id` araç kimliği DEĞİLDİR.** Head unit değişebilir, araç aynı
 *     kalabilir; araç değişebilir, head unit aynı kalabilir. Bu yüzden
 *     `device_id` bu gözleme HİÇ girmez.
 *   · **Ham parmak izi GÖNDERİLMEZ.** Yalnız deterministik `hash` taşınır;
 *     ham girdiler (ECU adresleri, PID bitmap, adaptör MAC) burada YOKTUR.
 *   · **Tahmin ÜRETİLMEZ.** Kanıt yoksa alan `null`'dır — "muhtemelen VW"
 *     gibi çıkarım yapılmaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

import { normalizeVin, normalizeVinSource, type VinSource } from './vehicleIdentityReport';

/* ── Kimlik durumu ─────────────────────────────────────────────────────── */

export const IDENTITY_STATUSES = [
  'UNKNOWN',   // hiç gözlem yok
  'PENDING',   // gözlem var, sunucu onayı YOK
  'VERIFIED',  // sunucu kabul etti
  'CONFLICT',  // sunucu çakışma bildirdi
  'STALE',     // gözlem var ama bayat (araç uzun süre görülmedi)
] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

/** Gözlemin hangi kanıt sınıfından geldiği. */
export const IDENTITY_SOURCES = [
  'OBD_HANDSHAKE',   // Mode 09 PID 02 ham yanıtı (en güçlü)
  'OBD_FINGERPRINT', // protokol + ECU + bitmap türevi hash (VIN'siz araçlar)
  'USER_PROFILE',    // kullanıcının elle girdiği araç profili
  'UNKNOWN',
] as const;
export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

/* ── Kanonik gözlem ────────────────────────────────────────────────────── */

/**
 * TEK kimlik modeli. Her alan bağımsız olarak `null` olabilir — kanıt yoksa
 * `null`, asla `''`/`0`/"bilinmiyor" metni değil.
 */
export interface VehicleIdentityObservation {
  /** 11–17 hane, ISO 3779 karakter kümesi. Kanıt yoksa `null`. */
  readonly vin: string | null;
  /** VIN'in nasıl elde edildiği. VIN `null` ise bu da `null`. */
  readonly vinSource: VinSource | null;
  /** WMI'den çözülen marka. Çözülemezse `null` (tahmin YOK). */
  readonly make: string | null;
  /** Kullanıcı profili adı veya çözülen model. */
  readonly model: string | null;
  /** VIN pozisyon 10'dan çözülen model yılı. */
  readonly modelYear: number | null;
  /** ELM327/ISO protokol numarası veya adı. Bilinmiyorsa `null`. */
  readonly activeProtocol: string | null;
  /** Deterministik parmak izi hash'i (ham girdi DEĞİL). */
  readonly fingerprintHash: string | null;
  /** Parmak izi ŞEMA sürümü — hash algoritması/girdi kümesi sürümü. */
  readonly fingerprintVersion: string | null;
  /** Yerel öğrenilmiş güven [0,1]. Sunucu güveni AYRIDIR. */
  readonly confidence: number | null;
  /** Gözlem anı (epoch ms). */
  readonly observedAt: number | null;
  readonly source: IdentitySource;
  /**
   * Kimlik revizyonu — protokol değişimi gibi ÇAKIŞMA OLMAYAN ama kimliği
   * ilerleten olaylarda artar. Sunucu tek otoritedir; istemci yalnız
   * bildiğini taşır (yoksa `null`).
   */
  readonly identityRevision: number | null;
  /**
   * Araç nesli/kuşağı — VIN yılı + model ipucundan türetilen KABA sınıf.
   * Kanıt yetersizse `null`. Tanı profili seçimi için ipucudur, KARAR DEĞİL.
   */
  readonly vehicleGeneration: string | null;
}

/** Hiç kanıt olmayan gözlem — şablon nesne (V8 hidden-class kararlılığı). */
export const EMPTY_IDENTITY_OBSERVATION: VehicleIdentityObservation = Object.freeze({
  vin: null, vinSource: null, make: null, model: null, modelYear: null,
  activeProtocol: null, fingerprintHash: null, fingerprintVersion: null,
  confidence: null, observedAt: null, source: 'UNKNOWN',
  identityRevision: null, vehicleGeneration: null,
});

/**
 * PARMAK İZİ ŞEMA SÜRÜMÜ.
 *
 * `canonicalFingerprintKey()` girdi kümesi (`vin|protocol|ecuAddresses|bitmap`)
 * veya `fingerprintHash()` algoritması DEĞİŞİRSE bu sabit ARTIRILMALIDIR —
 * aksi halde eski ve yeni şemadan üretilmiş iki farklı hash "araç değişti"
 * sanılıp yanlış `IDENTITY_CONFLICT` üretir.
 */
export const FINGERPRINT_SCHEMA_VERSION = 'fp1';

/* ── Girdi (gerçek kaynakların şekli) ──────────────────────────────────── */

/** `useVidStore.vehicle` + `useVidStore.obdAdapter`ın gözlem için gereken alanları. */
export interface VidIdentitySlice {
  readonly vin?: string | null;
  readonly make?: string | null;
  readonly model?: string | null;
  readonly modelYear?: number | null;
  readonly activeProtocol?: string | null;
  /** Taşıma doğrulanmadıysa protokol gözlemi güvenilir sayılmaz. */
  readonly transportVerified?: boolean;
}

/** `vehicleFingerprintStore`'daki öğrenilmiş kaydın gözlem için gereken alanları. */
export interface FingerprintIdentitySlice {
  readonly hash?: string | null;
  readonly confidence?: number | null;
  /** Kaç bağımsız gözlemden öğrenildi — güven yorumunda kullanılır. */
  readonly sourceCount?: number | null;
  readonly lastSeen?: number | null;
}

export interface BuildIdentityInput {
  readonly nowMs: number;
  readonly vid?: VidIdentitySlice | null;
  readonly fingerprint?: FingerprintIdentitySlice | null;
  /** Sunucudan bilinen son revizyon (varsa). */
  readonly knownRevision?: number | null;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

function text(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length === 0 || s.length > maxLen ? null : s;
}

function year(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const y = Math.trunc(raw);
  return y >= 1950 && y <= 2100 ? y : null;
}

function conf(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Araç neslini TÜRETİR — yalnız yeterli kanıt varsa.
 *
 * Kural: marka VE model yılı GEREKLİ. Yalnız yılla "2019 nesli" demek
 * anlamsızdır; yalnız markayla nesil belirlenemez. Kanıt yetersizse `null`
 * (tahmin ÜRETMEZ). Beş yıllık kaba kova kullanılır — bu bir İPUÇTUR,
 * tanı kararı değildir.
 */
export function deriveVehicleGeneration(
  make: string | null,
  modelYear: number | null,
): string | null {
  if (make === null || modelYear === null) return null;
  const bucketStart = Math.floor(modelYear / 5) * 5;
  return `${make} ${bucketStart}-${bucketStart + 4}`;
}

/* ── Kurucu ────────────────────────────────────────────────────────────── */

/**
 * Gerçek kaynaklardan kanonik gözlemi kurar.
 *
 * Kanıt kapıları:
 *   · VIN şekli tutmuyorsa → `vin` ve `vinSource` İKİSİ de `null`
 *     (kaynaksız VIN veya VIN'siz kaynak taşınmaz).
 *   · Marka/yıl YALNIZ geçerli VIN varsa taşınır — `decodeWmi`/`decodeVinYear`
 *     VIN türevidir; VIN yoksa bunlar da kanıtsızdır.
 *   · Taşıma doğrulanmadıysa `activeProtocol` → `null` (öğrenilmiş ama
 *     doğrulanmamış protokol "aktif" sayılmaz).
 *   · Parmak izi hash'i yoksa `fingerprintVersion` de taşınmaz.
 */
export function buildIdentityObservation(
  input: BuildIdentityInput,
): VehicleIdentityObservation {
  const vid = input.vid ?? null;
  const fp = input.fingerprint ?? null;

  const vin = normalizeVin(vid?.vin);
  /* VIN kaynağı: bu zincirde VIN yalnız Mode 09 handshake'inden veya kullanıcı
     profilinden gelir. Handshake VIN'i `vehicleProfileService` üzerinden
     VID'ye yansır; ayrım korunur ama VIN yoksa kaynak da yoktur. */
  const vinSource: VinSource | null = vin === null ? null : normalizeVinSource('OBD_MODE09');

  /* Marka/yıl VIN TÜREVİDİR — VIN yoksa bunlar kanıtsızdır. */
  const make = vin === null ? null : text(vid?.make, 64);
  const modelYear = vin === null ? null : year(vid?.modelYear);
  /* Model kullanıcı profili adından da gelebilir → VIN'e bağlı DEĞİL. */
  const model = text(vid?.model, 64);

  /* Doğrulanmamış taşımada protokol "aktif" sayılmaz. */
  const activeProtocol =
    vid?.transportVerified === true ? text(vid?.activeProtocol, 48) : null;

  const fingerprintHash = text(fp?.hash, 128);
  const fingerprintVersion = fingerprintHash === null ? null : FINGERPRINT_SCHEMA_VERSION;

  const observedAt =
    typeof input.nowMs === 'number' && Number.isFinite(input.nowMs) ? input.nowMs : null;

  /* Kaynak sınıfı: en güçlü kanıt kazanır. */
  const source: IdentitySource =
    vin !== null ? 'OBD_HANDSHAKE'
    : fingerprintHash !== null ? 'OBD_FINGERPRINT'
    : model !== null ? 'USER_PROFILE'
    : 'UNKNOWN';

  return {
    vin, vinSource, make, model, modelYear,
    activeProtocol, fingerprintHash, fingerprintVersion,
    confidence: conf(fp?.confidence),
    observedAt,
    source,
    identityRevision: typeof input.knownRevision === 'number' && Number.isFinite(input.knownRevision)
      ? input.knownRevision : null,
    vehicleGeneration: deriveVehicleGeneration(make, modelYear),
  };
}

/* ── Yayınlanabilirlik kapısı ──────────────────────────────────────────── */

export type PublishRejection =
  | 'NO_EVIDENCE'          // ne VIN ne parmak izi → yazacak kimlik yok
  | 'NO_OBSERVED_AT'       // gözlem anı yok → tazelik kurulamaz
  | 'PROTOCOL_UNVERIFIED'; // yalnız protokol var, o da doğrulanmamış

export interface PublishDecision {
  readonly publishable: boolean;
  readonly rejection: PublishRejection | null;
}

/**
 * Gözlem sunucuya gönderilmeye DEĞER mi?
 *
 * `record_vehicle_identity` kimliksiz satır yazmamalı: ne VIN ne parmak izi
 * varsa çağrı yalnız güven puanını şişirir, bilgi eklemez.
 */
export function evaluatePublishable(obs: VehicleIdentityObservation): PublishDecision {
  if (obs.observedAt === null) return { publishable: false, rejection: 'NO_OBSERVED_AT' };
  if (obs.vin === null && obs.fingerprintHash === null) {
    return {
      publishable: false,
      rejection: obs.activeProtocol !== null ? 'PROTOCOL_UNVERIFIED' : 'NO_EVIDENCE',
    };
  }
  return { publishable: true, rejection: null };
}

/* ── Değişim sınıflandırması (§4 güven politikası) ─────────────────────── */

export const IDENTITY_CHANGES = [
  'UNCHANGED',           // aynı kimlik → tekrar GÖNDERİLMEZ
  'FIRST_OBSERVATION',   // önceki gözlem yok
  'ENRICHED',            // yeni alan öğrenildi (ör. sonradan VIN geldi)
  'PROTOCOL_CHANGED',    // protokol değişti → revision++ (çakışma DEĞİL)
  'VIN_CONFLICT',        // VIN değişti → IDENTITY_CONFLICT
  'FINGERPRINT_CONFLICT',// parmak izi değişti → IDENTITY_CONFLICT
] as const;
export type IdentityChange = (typeof IDENTITY_CHANGES)[number];

/**
 * İki gözlemi karşılaştırır ve §4 politikasını uygular.
 *
 * Öncelik sırası ÖNEMLİ: çakışma, zenginleşmeyi EZER — aynı turda hem yeni
 * alan öğrenilip hem VIN değiştiyse bu "zenginleşme" değil ÇAKIŞMADIR.
 * `null` → değer geçişi ASLA çakışma sayılmaz (bilinmeyenin öğrenilmesi
 * çakışma değildir); yalnız DEĞER → BAŞKA DEĞER çakışmadır.
 */
export function classifyIdentityChange(
  prev: VehicleIdentityObservation | null,
  next: VehicleIdentityObservation,
): IdentityChange {
  if (prev === null) return 'FIRST_OBSERVATION';

  /* ÇAKIŞMA: iki taraf da BİLİNİYOR ve FARKLI. */
  if (prev.vin !== null && next.vin !== null && prev.vin !== next.vin) {
    return 'VIN_CONFLICT';
  }
  if (
    prev.fingerprintHash !== null && next.fingerprintHash !== null &&
    prev.fingerprintHash !== next.fingerprintHash
  ) {
    /* Şema sürümü değiştiyse hash farkı ARAÇ DEĞİŞİMİ DEĞİLDİR —
       aynı araç, farklı hesaplama. Çakışma İLAN EDİLMEZ. */
    if (
      prev.fingerprintVersion !== null && next.fingerprintVersion !== null &&
      prev.fingerprintVersion !== next.fingerprintVersion
    ) {
      return 'ENRICHED';
    }
    return 'FINGERPRINT_CONFLICT';
  }

  /* PROTOKOL DEĞİŞİMİ: çakışma değil — aynı araç farklı taşıma/protokolde
     konuşabilir (adaptör değişimi, CAN→KWP düşüşü). Revizyon ilerler. */
  if (
    prev.activeProtocol !== null && next.activeProtocol !== null &&
    prev.activeProtocol !== next.activeProtocol
  ) {
    return 'PROTOCOL_CHANGED';
  }

  /* ZENGİNLEŞME: önce bilinmeyen bir alan artık biliniyor. */
  const learned =
    (prev.vin === null && next.vin !== null) ||
    (prev.fingerprintHash === null && next.fingerprintHash !== null) ||
    (prev.activeProtocol === null && next.activeProtocol !== null) ||
    (prev.make === null && next.make !== null) ||
    (prev.model === null && next.model !== null) ||
    (prev.modelYear === null && next.modelYear !== null);
  if (learned) return 'ENRICHED';

  return 'UNCHANGED';
}

/** Bu değişim sunucuya gönderilmeli mi? `UNCHANGED` → hayır (dedupe). */
export function shouldPublishChange(change: IdentityChange): boolean {
  return change !== 'UNCHANGED';
}

/** Değişim çakışma mı? */
export function isConflictChange(change: IdentityChange): boolean {
  return change === 'VIN_CONFLICT' || change === 'FINGERPRINT_CONFLICT';
}

/**
 * KİMLİK İMZASI — dedupe anahtarı.
 *
 * `confidence`, `observedAt` ve `identityRevision` DAHİL EDİLMEZ: bunlar her
 * tick'te değişebilir ve kimliğin KENDİSİ değişmediği hâlde sonsuz yayına
 * yol açar. `vehicleGeneration` de türevdir → dahil edilmez.
 */
export function identitySignature(obs: VehicleIdentityObservation): string {
  return [
    obs.vin ?? '-',
    obs.vinSource ?? '-',
    obs.make ?? '-',
    obs.model ?? '-',
    obs.modelYear === null ? '-' : String(obs.modelYear),
    obs.activeProtocol ?? '-',
    obs.fingerprintHash ?? '-',
    obs.fingerprintVersion ?? '-',
  ].join('|');
}
