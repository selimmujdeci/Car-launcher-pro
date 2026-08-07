/**
 * driverAuthentication.ts — SÜRÜCÜ KİMLİK DOĞRULAMA SÖZLEŞMESİ VE OTORİTESİ (P1).
 *
 * ── PRESENCE ≠ AUTHENTICATION (bu paketin bütün nedeni) ────────────────
 *   · **Presence**        bir GÖZLEMDİR : "bu kişiye ait bir işaret araçta görüldü"
 *   · **Authentication**  bir KANITTIR  : "bu kişi KİMLİĞİNİ doğruladı"
 *
 * Bir NFC kartın okunması kişinin araçta olduğunu gösterir; kartın **o kişiye
 * ait olduğunu** göstermez (kart ödünç verilebilir, kopyalanabilir, çalınabilir).
 * P1'de presence tek başına `VERY_HIGH` üretebiliyordu — bu, "kart = kişi"
 * varsayımıydı ve bir kimlik doğrulaması DEĞİLDİ. Bu modül o boşluğu kapatır:
 *
 *     VERY_HIGH ancak KİMLİK DOĞRULAMASI + FİZİKSEL VARLIK birlikteyken mümkündür.
 *
 * ── BU PAKETTE GERÇEK KAYNAK YOK (bilinçli) ───────────────────────────
 * NFC · PHONE · BLUETOOTH · PIN entegrasyonlarının HİÇBİRİ yazılmadı. Bu modül
 * yalnız **sözleşmeyi ve tek otoriteyi** kurar. Doğrulama ÜRETEN hiçbir yol
 * olmadığı için depo boş kalır → davranış P2'deki gibi sürer, yalnız artık
 * presence tek başına `VERY_HIGH` ÜRETEMEZ (tavan `HIGH`).
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────
 * Doğrulama üretilemiyorsa cevap `UNKNOWN`'dır. Doğrulamanın VARLIĞI tek
 * başına kimseyi "kanıtlanmış" yapmaz: kaynağının doğrulayabiliyor olması,
 * süresinin geçmemiş olması, doğru araca bağlı olması ve sürücünün uygun
 * olması gerekir.
 *
 * ── SAFLIK SINIRI ─────────────────────────────────────────────────────
 * Sözleşme + otorite katmanı SAFTIR: I/O YOK · timer YOK · `Date.now()` YOK ·
 * abonelik YOK · React YOK. Zaman DIŞARIDAN verilir. Dosyanın sonundaki
 * **depo** yalnız bellekte tutar (kalıcılık bu turun kapsamı DEĞİL) ve
 * otoriteyi ne çağırır ne de etkiler.
 */

import type {
  PresenceResolution, PresenceConfidence,
} from './driverPresence';

/* ── Kaynak ────────────────────────────────────────────────────────────── */

/**
 * Doğrulamanın DAYANDIĞI kanıt türü.
 *
 * `HEAD_UNIT` BİLİNÇLİ OLARAK YOKTUR: head unit `anon` rolünde çalışır ve
 * kullanıcı oturumu yoktur — ekranda "ben Ahmet'im" diyen herkes Ahmet
 * sayılırdı. Bu, P0'da kapatılan kapıdır ve doğrulama katmanı onu arkadan
 * DOLANMAMALIDIR. `PIN` ise farklıdır: PIN bir **bilgi faktörüdür** ve
 * sunucuda sürücü kaydına karşı doğrulanır — istemci kendi PIN'ini "doğru"
 * ilan edemez.
 */
export const AUTHENTICATION_SOURCES = [
  'UNKNOWN',
  'PIN',
  'PHONE',
  'BLUETOOTH',
  'NFC',
] as const;
export type AuthenticationSource = (typeof AUTHENTICATION_SOURCES)[number];

export function isAuthenticationSource(v: unknown): v is AuthenticationSource {
  return typeof v === 'string' && (AUTHENTICATION_SOURCES as readonly string[]).includes(v);
}

/* ── Seviye ────────────────────────────────────────────────────────────── */

/**
 * Doğrulamanın GÜCÜ.
 *
 *   · `VERIFIED` — kimlik kanıtlandı (fiziksel kart teması, sunucuda
 *                  doğrulanmış PIN). `VERY_HIGH` güvenin ÖN KOŞULUDUR.
 *   · `PARTIAL`  — bir işaret var ama kişiyi kanıtlamaz (eşleşmiş cihazın
 *                  yakınlığı: cihaz başkasının elinde olabilir).
 *   · `UNKNOWN`  — doğrulama yok / kullanılamaz.
 */
export const AUTHENTICATION_LEVELS = ['VERIFIED', 'PARTIAL', 'UNKNOWN'] as const;
export type AuthenticationLevel = (typeof AUTHENTICATION_LEVELS)[number];

const LEVEL_ORDER: readonly AuthenticationLevel[] = ['UNKNOWN', 'PARTIAL', 'VERIFIED'];

export function isAuthenticationLevel(v: unknown): v is AuthenticationLevel {
  return typeof v === 'string' && (AUTHENTICATION_LEVELS as readonly string[]).includes(v);
}

/** İki seviyenin DAHA ZAYIFI (en zayıf halka kuralı — 049 ile aynı desen). */
export function weakestAuthenticationLevel(
  a: AuthenticationLevel, b: AuthenticationLevel,
): AuthenticationLevel {
  return LEVEL_ORDER.indexOf(a) <= LEVEL_ORDER.indexOf(b) ? a : b;
}

/**
 * Kaynağın verebileceği EN YÜKSEK seviye — **istemci kendi seviyesini
 * YÜKSELTEMEZ** (P0'ın "güven sunucuda üretilir" ilkesinin devamı).
 */
export function sourceAuthenticationCeiling(s: AuthenticationSource): AuthenticationLevel {
  switch (s) {
    /* Fiziksel kart teması — kimlik kanıtı sayılır. */
    case 'NFC':       return 'VERIFIED';
    /* Sunucuda sürücü kaydına karşı doğrulanan bilgi faktörü. */
    case 'PIN':       return 'VERIFIED';
    /* Eşleşmiş cihazın YAKINLIĞI kişiyi kanıtlamaz — cihaz ödünç verilebilir. */
    case 'BLUETOOTH': return 'PARTIAL';
    case 'PHONE':     return 'PARTIAL';
    case 'UNKNOWN':   return 'UNKNOWN';
  }
}

/* ── Kanonik model ─────────────────────────────────────────────────────── */

/**
 * Bir sürücünün KİMLİĞİNİ doğruladığına dair kayıt.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, ehliyet, telefon, e-posta, PIN'in KENDİSİ,
 * kart numarası veya ham token YOKTUR — yalnız kimlik referansları, kaynak,
 * seviye, zaman ve **oturum kimliği**.
 */
export interface DriverAuthentication {
  readonly driverId: string | null;
  /** Doğrulamanın YAPILDIĞI araç. `null` = bilinmiyor (UYDURULMAZ). */
  readonly vehicleId: string | null;
  readonly authenticationSource: AuthenticationSource;
  readonly authenticationLevel: AuthenticationLevel;
  /** Doğrulamanın gerçekleştiği an (epoch ms). */
  readonly verifiedAt: number | null;
  /** Doğrulamanın geçerliliğini yitirdiği an (epoch ms). */
  readonly expiresAt: number | null;
  /**
   * Oturum kimliği — **tekrar saldırısının (replay) kilididir**.
   *
   * Aynı `sessionId` ikinci kez kabul edilmez: kaydedilmiş bir doğrulama
   * mesajının yeniden oynatılması, kişi araçta olmadan onu "doğrulanmış"
   * yapardı. Oturumsuz doğrulama KABUL EDİLMEZ.
   */
  readonly sessionId: string | null;
}

export const UNKNOWN_AUTHENTICATION: DriverAuthentication = Object.freeze({
  driverId: null,
  vehicleId: null,
  authenticationSource: 'UNKNOWN',
  authenticationLevel: 'UNKNOWN',
  verifiedAt: null,
  expiresAt: null,
  sessionId: null,
});

/**
 * DOĞRULAMA VARSAYILAN ÖMRÜ (ms).
 *
 * Presence'ın 8 saatinden KISADIR ve bu bilinçlidir: "araçta bir işaret var"
 * ile "bu kişi kimliğini kanıtladı" farklı ağırlıktadır; ikincisi daha güçlü
 * sonuç doğurduğu için daha kısa yaşamalıdır. 4 saat bir sürüş bloğunu
 * kapsar; üstü YENİ bir doğrulama gerektirir.
 */
export const AUTHENTICATION_DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

/** Azami ömür — bunu aşan kayıt REDDEDİLİR (sınırsız oturum YOK). */
export const AUTHENTICATION_MAX_TTL_MS = 12 * 60 * 60 * 1000;

/** Ham girdiyi güvenle daraltır — tanınmayan alan UYDURULMAZ. */
export function normalizeDriverAuthentication(raw: unknown): DriverAuthentication {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const source: AuthenticationSource =
    isAuthenticationSource(o.authenticationSource) ? o.authenticationSource : 'UNKNOWN';
  const driverId = typeof o.driverId === 'string' && o.driverId.length > 0 ? o.driverId : null;
  const sessionId = typeof o.sessionId === 'string' && o.sessionId.length > 0
    ? o.sessionId : null;

  /* Sürücüsü, kaynağı veya OTURUMU olmayan kayıt bir doğrulama DEĞİLDİR. */
  if (driverId === null || source === 'UNKNOWN' || sessionId === null) {
    return UNKNOWN_AUTHENTICATION;
  }

  const verifiedAt = typeof o.verifiedAt === 'number' && Number.isFinite(o.verifiedAt)
    ? o.verifiedAt : null;
  const expiresAt = typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt)
    ? o.expiresAt
    : (verifiedAt === null ? null : verifiedAt + AUTHENTICATION_DEFAULT_TTL_MS);

  /* Bildirilen seviye kaynağın TAVANINI AŞAMAZ. */
  const claimed: AuthenticationLevel =
    isAuthenticationLevel(o.authenticationLevel) ? o.authenticationLevel : 'UNKNOWN';

  return {
    driverId,
    vehicleId: typeof o.vehicleId === 'string' && o.vehicleId.length > 0 ? o.vehicleId : null,
    authenticationSource: source,
    authenticationLevel: weakestAuthenticationLevel(claimed, sourceAuthenticationCeiling(source)),
    verifiedAt,
    expiresAt,
    sessionId,
  };
}

/* ── Geçerlilik ────────────────────────────────────────────────────────── */

export const AUTHENTICATION_VALIDITIES = ['VALID', 'EXPIRED', 'FUTURE', 'UNKNOWN'] as const;
export type AuthenticationValidity = (typeof AUTHENTICATION_VALIDITIES)[number];

export function authenticationValidity(
  a: DriverAuthentication, nowMs: number,
): AuthenticationValidity {
  if (a.authenticationSource === 'UNKNOWN' || a.driverId === null
      || a.sessionId === null || a.verifiedAt === null) {
    return 'UNKNOWN';
  }
  if (nowMs < a.verifiedAt) return 'FUTURE';                     // saat kayması/bozuk veri
  if (a.expiresAt !== null && nowMs >= a.expiresAt) return 'EXPIRED';
  return 'VALID';
}

/** Oturumun yaşı (ms); bilinmiyorsa `null`. */
export function authenticationAgeMs(a: DriverAuthentication, nowMs: number): number | null {
  if (a.verifiedAt === null) return null;
  return Math.max(0, nowMs - a.verifiedAt);
}

/* ── TEK OTORİTE: Authentication Authority ─────────────────────────────── */

export const AUTHENTICATION_DECISIONS = [
  'AUTHENTICATED',              // kimlik kanıtlandı (VERIFIED, geçerli, doğru araç)
  'PARTIALLY_AUTHENTICATED',    // işaret var ama kimlik kanıtı değil
  'AUTHENTICATION_EXPIRED',     // süresi doldu → kanıt DEĞİL
  'AUTHENTICATION_UNUSABLE',    // araç/sürücü/oturum kapısına takıldı
  'NO_AUTHENTICATION',          // kayıt yok
] as const;
export type AuthenticationDecision = (typeof AUTHENTICATION_DECISIONS)[number];

export interface AuthenticationResolution {
  readonly decision: AuthenticationDecision;
  /** Doğrulamanın işaret ettiği sürücü — kanıt sayılmadıysa `null`. */
  readonly driverId: string | null;
  readonly level: AuthenticationLevel;
  readonly source: AuthenticationSource;
  readonly validity: AuthenticationValidity;
  readonly sessionId: string | null;
  /** Kararın gerekçesi — sessiz düşüş YOK. */
  readonly reason: string;
  /** Üst katman bu sonucu KANIT sayabilir mi. */
  readonly usable: boolean;
}

export const NO_AUTHENTICATION_RESOLUTION: AuthenticationResolution = Object.freeze({
  decision: 'NO_AUTHENTICATION', driverId: null, level: 'UNKNOWN',
  source: 'UNKNOWN', validity: 'UNKNOWN', sessionId: null,
  reason: 'NO_RECORD', usable: false,
});

export interface AuthenticationResolverInput {
  readonly authentication: DriverAuthentication;
  /** Bu cihazın DOĞRULANMIŞ aracı; `null` = bağ yok (fail-closed). */
  readonly boundVehicleId: string | null;
  /** Sürücü aynı şirkette ve AKTİF mi (tenant + durum kapısı). */
  readonly driverEligible: boolean;
  readonly nowMs: number;
}

/**
 * DOĞRULAMA OTORİTESİ — başka hiçbir yerde kimlik kararı verilmez.
 *
 * ── KARAR SIRASI ────────────────────────────────────────────────────────
 *  1. Kayıt yok / oturumsuz            → `NO_AUTHENTICATION`
 *  2. Araç bağı yok veya UYUŞMUYOR     → `AUTHENTICATION_UNUSABLE`
 *  3. Süresi geçmiş / gelecek tarihli  → `AUTHENTICATION_EXPIRED`
 *  4. Sürücü uygun değil (tenant/pasif)→ `AUTHENTICATION_UNUSABLE`
 *  5. Seviye `VERIFIED` değil          → `PARTIALLY_AUTHENTICATED` (kanıt DEĞİL)
 *  6. Aksi hâlde                       → `AUTHENTICATED`
 *
 * ── NEDEN `PARTIAL` KANIT SAYILMAZ ──────────────────────────────────────
 * Eşleşmiş bir telefonun araçta olması, SAHİBİNİN araçta olduğunu
 * kanıtlamaz. `PARTIAL`'ı kanıt saymak, kimlik doğrulamayı bir yakınlık
 * ölçümüne indirger — bu paketin var oluş nedeninin tam tersidir.
 */
export function resolveDriverAuthentication(
  input: AuthenticationResolverInput,
): AuthenticationResolution {
  const { authentication: a, boundVehicleId, driverEligible, nowMs } = input;

  if (a.authenticationSource === 'UNKNOWN' || a.driverId === null || a.sessionId === null) {
    return NO_AUTHENTICATION_RESOLUTION;
  }

  const validity = authenticationValidity(a, nowMs);

  /* (2) ARAÇ BAĞI — doğrulama BU araçta yapılmış olmalı. Bağ yoksa
     doğrulanamaz; "herhalde bu araçtır" VARSAYILMAZ (P2 dersi). */
  if (boundVehicleId === null) {
    return {
      decision: 'AUTHENTICATION_UNUSABLE', driverId: null, level: 'UNKNOWN',
      source: a.authenticationSource, validity, sessionId: a.sessionId,
      reason: 'VEHICLE_NOT_BOUND', usable: false,
    };
  }
  if (a.vehicleId !== null && a.vehicleId !== boundVehicleId) {
    return {
      decision: 'AUTHENTICATION_UNUSABLE', driverId: null, level: 'UNKNOWN',
      source: a.authenticationSource, validity, sessionId: a.sessionId,
      reason: 'VEHICLE_BINDING_MISMATCH', usable: false,
    };
  }

  if (validity !== 'VALID') {
    return {
      decision: validity === 'EXPIRED'
        ? 'AUTHENTICATION_EXPIRED' : 'AUTHENTICATION_UNUSABLE',
      driverId: null, level: 'UNKNOWN',
      source: a.authenticationSource, validity, sessionId: a.sessionId,
      reason: validity === 'EXPIRED' ? 'AUTHENTICATION_EXPIRED'
        : validity === 'FUTURE' ? 'AUTHENTICATION_IN_FUTURE' : 'AUTHENTICATION_INCOMPLETE',
      usable: false,
    };
  }

  if (!driverEligible) {
    return {
      decision: 'AUTHENTICATION_UNUSABLE', driverId: null, level: 'UNKNOWN',
      source: a.authenticationSource, validity, sessionId: a.sessionId,
      reason: 'DRIVER_NOT_ELIGIBLE', usable: false,
    };
  }

  /* (5) Kaynağı kimlik kanıtlayamayan doğrulama bir İPUCUDUR. */
  if (a.authenticationLevel !== 'VERIFIED') {
    return {
      decision: 'PARTIALLY_AUTHENTICATED', driverId: null,
      level: a.authenticationLevel, source: a.authenticationSource,
      validity, sessionId: a.sessionId,
      reason: 'LEVEL_NOT_VERIFIED', usable: false,
    };
  }

  return {
    decision: 'AUTHENTICATED', driverId: a.driverId, level: 'VERIFIED',
    source: a.authenticationSource, validity, sessionId: a.sessionId,
    reason: 'IDENTITY_VERIFIED', usable: true,
  };
}

/* ── PRESENCE × AUTHENTICATION — nihai güven ───────────────────────────── */

export const TRUST_DECISIONS = [
  'VERIFIED_PRESENCE',    // kimlik doğrulandı + fiziksel varlık → en güçlü kanıt
  'PRESENCE_ONLY',        // yalnız fiziksel işaret — kimlik KANITLANMADI
  'AUTHENTICATION_ONLY',  // yalnız kimlik — araçta olduğu KANITLANMADI
  'TRUST_CONFLICT',       // iki katman FARKLI kişiyi gösteriyor → fail-closed
  'NO_TRUST',             // hiçbiri kullanılabilir değil → atama modeli çalışır
] as const;
export type TrustDecision = (typeof TRUST_DECISIONS)[number];

export interface TrustResolution {
  readonly decision: TrustDecision;
  readonly driverId: string | null;
  readonly confidence: PresenceConfidence;
  readonly reason: string;
  readonly usable: boolean;
  /** `VERY_HIGH` bu kararda mümkün müydü — gözlemlenebilirlik için. */
  readonly veryHighEligible: boolean;
}

/**
 * NİHAİ GÜVEN — presence ve authentication katmanlarını BİRLEŞTİRİR.
 *
 * ── DEĞİŞEN POLİTİKA (P1 DRIVER AUTHENTICATION) ─────────────────────────
 * Eskiden fiziksel gözlem + uyumlu atama `VERY_HIGH` üretebiliyordu. Ama
 * bir kartın okunması **kartı** kanıtlar, **kişiyi** değil. Yeni kural:
 *
 *     VERY_HIGH  ⇔  (kimlik VERIFIED)  ∧  (fiziksel varlık kullanılabilir)
 *                   ∧  (ikisi AYNI sürücüyü gösteriyor)
 *
 * Presence tek başına en fazla `HIGH` üretir. Authentication tek başına da
 * en fazla `HIGH` üretir: kimliğini doğrulamış olmak, kişinin O ANDA
 * direksiyonda olduğunu kanıtlamaz.
 *
 * ── ÇELİŞKİ FAIL-CLOSED ─────────────────────────────────────────────────
 * Kartı Ahmet okutmuş ama PIN'i Mehmet girmişse hangisinin sürdüğü
 * BİLİNEMEZ → sürücü YAZILMAZ, insan incelemesi gerekir.
 *
 * ⚠️ Bu fonksiyon `resolveDriverPresence`'ı ÇAĞIRMAZ ve DEĞİŞTİRMEZ —
 * onun ÇIKTISINI girdi olarak alır. Presence otoritesi olduğu gibi durur.
 */
export function resolveDriverTrust(input: {
  readonly presence: PresenceResolution;
  readonly authentication: AuthenticationResolution;
}): TrustResolution {
  const { presence: p, authentication: a } = input;

  const pDriver = p.usable ? p.driverId : null;
  const aDriver = a.usable ? a.driverId : null;

  /* (1) ÇELİŞKİ — iki katman farklı kişiyi gösteriyor. */
  if (pDriver !== null && aDriver !== null && pDriver !== aDriver) {
    return {
      decision: 'TRUST_CONFLICT', driverId: null, confidence: 'UNKNOWN',
      reason: 'PRESENCE_AUTHENTICATION_MISMATCH', usable: false,
      veryHighEligible: false,
    };
  }

  /* (2) EN GÜÇLÜ KANIT — kimlik doğrulandı VE aynı kişi araçta gözlendi. */
  if (pDriver !== null && aDriver !== null) {
    return {
      decision: 'VERIFIED_PRESENCE', driverId: pDriver,
      /* Presence'ın kendi güveni tavan olarak KORUNUR: doğrulama, zayıf bir
         gözlemi güçlendirmez — yalnız `VERY_HIGH` kapısını AÇAR. */
      confidence: p.confidence,
      reason: 'IDENTITY_VERIFIED_WITH_PRESENCE', usable: true,
      veryHighEligible: true,
    };
  }

  /* (3) YALNIZ FİZİKSEL VARLIK — kimlik kanıtlanmadı → tavan HIGH. */
  if (pDriver !== null) {
    return {
      decision: 'PRESENCE_ONLY', driverId: pDriver,
      confidence: capBelowVeryHigh(p.confidence),
      reason: 'IDENTITY_NOT_VERIFIED', usable: true,
      veryHighEligible: false,
    };
  }

  /* (4) YALNIZ KİMLİK — araçta olduğu kanıtlanmadı → tavan HIGH. */
  if (aDriver !== null) {
    return {
      decision: 'AUTHENTICATION_ONLY', driverId: aDriver,
      confidence: 'HIGH',
      reason: 'PRESENCE_NOT_OBSERVED', usable: true,
      veryHighEligible: false,
    };
  }

  return {
    decision: 'NO_TRUST', driverId: null, confidence: 'UNKNOWN',
    reason: 'NO_USABLE_EVIDENCE', usable: false, veryHighEligible: false,
  };
}

/** `VERY_HIGH`'ı `HIGH`'a indirir; diğer seviyeler DEĞİŞMEZ. */
function capBelowVeryHigh(c: PresenceConfidence): PresenceConfidence {
  return c === 'VERY_HIGH' ? 'HIGH' : c;
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function authenticationSourceLabel(s: AuthenticationSource): string {
  switch (s) {
    case 'NFC':       return 'NFC kart';
    case 'PIN':       return 'PIN kodu';
    case 'BLUETOOTH': return 'Bluetooth';
    case 'PHONE':     return 'Telefon';
    case 'UNKNOWN':   return 'Bilinmiyor';
  }
}

export function authenticationLevelLabel(l: AuthenticationLevel): string {
  switch (l) {
    case 'VERIFIED': return 'Kimlik doğrulandı';
    case 'PARTIAL':  return 'Kısmi işaret';
    case 'UNKNOWN':  return 'Bilinmiyor';
  }
}

export function authenticationDecisionLabel(d: AuthenticationDecision): string {
  switch (d) {
    case 'AUTHENTICATED':           return 'Doğrulandı';
    case 'PARTIALLY_AUTHENTICATED': return 'Kısmi (kanıt değil)';
    case 'AUTHENTICATION_EXPIRED':  return 'Süresi doldu';
    case 'AUTHENTICATION_UNUSABLE': return 'Kullanılamaz';
    case 'NO_AUTHENTICATION':       return 'Doğrulama yok';
  }
}

export function trustDecisionLabel(d: TrustDecision): string {
  switch (d) {
    case 'VERIFIED_PRESENCE':   return 'Kimlik + varlık doğrulandı';
    case 'PRESENCE_ONLY':       return 'Yalnız fiziksel varlık';
    case 'AUTHENTICATION_ONLY': return 'Yalnız kimlik';
    case 'TRUST_CONFLICT':      return 'Katmanlar çelişiyor';
    case 'NO_TRUST':            return 'Kanıt yok';
  }
}

/* ── Depo (head unit tarafı) ───────────────────────────────────────────── */

/** Doğrulamanın neden reddedildiği — bounded KOD (serbest metin/PII YOK). */
export const AUTHENTICATION_REJECT_REASONS = [
  'MALFORMED_RECORD',          // sürücüsüz / kaynaksız / oturumsuz
  'VEHICLE_NOT_BOUND',         // araç bağı doğrulanmamış
  'VEHICLE_BINDING_MISMATCH',  // başka aracı iddia ediyor
  'DUPLICATE_SESSION',         // aynı oturum ikinci kez
  'REPLAY_REJECTED',           // eski/tekrarlanmış doğrulama mesajı
  'TTL_TOO_LONG',              // sınırsız oturum denemesi
  'ALREADY_EXPIRED',           // gelir gelmez süresi geçmiş
] as const;
export type AuthenticationRejectReason = (typeof AUTHENTICATION_REJECT_REASONS)[number];

/** Otoritenin ANLIK durumu — LAB bunu okur (sahte "sağlıklı" YOK). */
export const AUTHORITY_STATES = [
  'UNBOUND',    // araç bağı yok → hiçbir doğrulama kabul edilemez
  'IDLE',       // bağ var ama hiç doğrulama gelmedi
  'ACTIVE',     // geçerli bir doğrulama var
  'EXPIRED',    // son doğrulamanın süresi doldu
  'DEGRADED',   // son kayıt REDDEDİLDİ (gerekçe görünür)
] as const;
export type AuthorityState = (typeof AUTHORITY_STATES)[number];

/**
 * Son doğrulamayı tutar.
 *
 * ── ŞU AN HİÇBİR ŞEY YAZMIYOR ─────────────────────────────────────────
 * `record()` çağıran **hiçbir üretim yolu YOKTUR**: NFC · PIN · telefon ·
 * Bluetooth doğrulaması uygulanmadı. Depo boş kaldığı sürece nihai güven
 * `VERY_HIGH`'a ÇIKAMAZ ve davranış P2'deki gibi kalır — bu, katmanın
 * güvenlik tasarımının parçasıdır, eksiklik değil.
 *
 * Kalıcılık BU TURUN KAPSAMI DEĞİLDİR (presence P2'deki gibi diske yazılmaz):
 * bir kimlik doğrulama oturumunun yeniden başlatmadan sonra "hâlâ geçerli"
 * sayılması, kanıtı zayıflatır — yeniden doğrulama İSTENİR.
 */
class DriverAuthenticationStore {
  private _current: DriverAuthentication = UNKNOWN_AUTHENTICATION;
  private _boundVehicleId: string | null = null;
  private _acceptedCount = 0;
  private _rejectedCount = 0;
  private _lastRejectReason: AuthenticationRejectReason | null = null;
  private _lastUpdateAtMs: number | null = null;
  /** Görülen oturum kimlikleri — tekrar (replay) kilidi. Bounded. */
  private readonly _seenSessions = new Set<string>();
  /** Kabul edilen en son doğrulama anı — geriye giden mesaj REDDEDİLİR. */
  private _lastVerifiedAtMs: number | null = null;

  /** Oturum halkası tavanı — sınırsız büyüyen Set bellek sızıntısıdır. */
  private static readonly MAX_SESSIONS = 200;

  /**
   * DOĞRULANMIŞ araç bağını kurar. Kaynağı sunucunun verdiği araç kaydıdır
   * (`getVehicleIdentity()`), doğrulama yükü DEĞİL.
   *
   * Bağ değişirse aktif doğrulama DÜŞER: başka araçta yapılmış bir kimlik
   * doğrulaması bu araçta geçerli değildir.
   */
  bindVehicle(vehicleId: string | null): void {
    const next = typeof vehicleId === 'string' && vehicleId.length > 0 ? vehicleId : null;
    if (this._boundVehicleId === next) return;
    this._boundVehicleId = next;
    this._current = UNKNOWN_AUTHENTICATION;
    this._seenSessions.clear();
    this._lastVerifiedAtMs = null;
  }

  /**
   * Yeni doğrulama kaydeder. YEDİ kapı — hepsi fail-closed, her ret sayılır.
   */
  record(raw: unknown, nowMs: number): DriverAuthentication {
    const a = normalizeDriverAuthentication(raw);

    if (a.authenticationSource === 'UNKNOWN' || a.driverId === null || a.sessionId === null
        || a.verifiedAt === null) {
      return this._reject('MALFORMED_RECORD');
    }
    if (this._boundVehicleId === null) return this._reject('VEHICLE_NOT_BOUND');
    if (a.vehicleId !== null && a.vehicleId !== this._boundVehicleId) {
      return this._reject('VEHICLE_BINDING_MISMATCH');
    }
    /* DUPLICATE: aynı oturum ikinci kez kabul edilmez. */
    if (this._seenSessions.has(a.sessionId)) return this._reject('DUPLICATE_SESSION');
    /* REPLAY: kaydedilmiş ESKİ bir mesajın yeniden oynatılması. Kabul edilen
       son doğrulamadan geriye giden bir kayıt yeni kanıt olamaz. */
    if (this._lastVerifiedAtMs !== null && a.verifiedAt < this._lastVerifiedAtMs) {
      return this._reject('REPLAY_REJECTED');
    }
    if (a.expiresAt !== null && a.expiresAt - a.verifiedAt > AUTHENTICATION_MAX_TTL_MS) {
      return this._reject('TTL_TOO_LONG');
    }
    if (a.expiresAt !== null && nowMs >= a.expiresAt) return this._reject('ALREADY_EXPIRED');

    this._current = { ...a, vehicleId: this._boundVehicleId };
    this._acceptedCount += 1;
    this._lastUpdateAtMs = nowMs;
    this._lastVerifiedAtMs = a.verifiedAt;
    this._rememberSession(a.sessionId);
    this._lastRejectReason = null;
    return this._current;
  }

  private _reject(reason: AuthenticationRejectReason): DriverAuthentication {
    this._rejectedCount += 1;
    this._lastRejectReason = reason;
    return this._current;
  }

  private _rememberSession(id: string): void {
    this._seenSessions.add(id);
    if (this._seenSessions.size > DriverAuthenticationStore.MAX_SESSIONS) {
      const oldest = this._seenSessions.values().next().value;
      if (oldest !== undefined) this._seenSessions.delete(oldest);
    }
  }

  /** Oturumu kapatır (araç değişimi / çıkış). Doğrulama SİLİNMEZ, DÜŞER. */
  clear(): void {
    this._current = UNKNOWN_AUTHENTICATION;
  }

  /** LAB salt-okur — ASLA fırlatmaz, hiçbir şey tetiklemez. */
  read(nowMs: number): {
    readonly authentication: DriverAuthentication;
    readonly resolution: AuthenticationResolution;
    readonly authorityState: AuthorityState;
    readonly sessionAgeMs: number | null;
    readonly boundVehicleId: string | null;
    readonly acceptedCount: number;
    readonly rejectedCount: number;
    readonly lastRejectReason: AuthenticationRejectReason | null;
    readonly lastUpdateAtMs: number | null;
    readonly knownSessionCount: number;
  } {
    try {
      const resolution = resolveDriverAuthentication({
        authentication: this._current,
        boundVehicleId: this._boundVehicleId,
        /* Sürücü uygunluğu SUNUCUDA belirlenir; head unit bunu BİLEMEZ →
           gözlem yüzeyinde varsayılmaz, otoritenin diğer kapıları gösterilir. */
        driverEligible: true,
        nowMs,
      });
      return {
        authentication: this._current,
        resolution,
        authorityState: this._authorityState(resolution),
        sessionAgeMs: authenticationAgeMs(this._current, nowMs),
        boundVehicleId: this._boundVehicleId,
        acceptedCount: this._acceptedCount,
        rejectedCount: this._rejectedCount,
        lastRejectReason: this._lastRejectReason,
        lastUpdateAtMs: this._lastUpdateAtMs,
        knownSessionCount: this._seenSessions.size,
      };
    } catch {
      return {
        authentication: UNKNOWN_AUTHENTICATION,
        resolution: NO_AUTHENTICATION_RESOLUTION,
        authorityState: 'DEGRADED', sessionAgeMs: null, boundVehicleId: null,
        acceptedCount: 0, rejectedCount: 0, lastRejectReason: null,
        lastUpdateAtMs: null, knownSessionCount: 0,
      };
    }
  }

  private _authorityState(r: AuthenticationResolution): AuthorityState {
    if (this._boundVehicleId === null) return 'UNBOUND';
    if (this._lastRejectReason !== null) return 'DEGRADED';
    if (r.decision === 'AUTHENTICATED') return 'ACTIVE';
    if (r.decision === 'AUTHENTICATION_EXPIRED') return 'EXPIRED';
    return 'IDLE';
  }

  /** @internal — testler arası izolasyon. */
  _resetForTest(): void {
    this._current = UNKNOWN_AUTHENTICATION;
    this._boundVehicleId = null;
    this._acceptedCount = 0;
    this._rejectedCount = 0;
    this._lastRejectReason = null;
    this._lastUpdateAtMs = null;
    this._lastVerifiedAtMs = null;
    this._seenSessions.clear();
  }
}

export const driverAuthenticationStore = new DriverAuthenticationStore();

/** LAB salt-okuma yüzeyi — hiçbir doğrulama ÜRETMEZ. */
export function readDriverAuthentication(nowMs: number) {
  return driverAuthenticationStore.read(nowMs);
}

/**
 * DOĞRULANMIŞ araç bağını kurar (kaynak: `getVehicleIdentity()`).
 * Doğrulama üreticileri BU FONKSİYONU ÇAĞIRMAZ.
 */
export function bindAuthenticationVehicle(vehicleId: string | null): void {
  driverAuthenticationStore.bindVehicle(vehicleId);
}

/** @internal — testler arası izolasyon. */
export function _resetDriverAuthenticationStoreForTest(): void {
  driverAuthenticationStore._resetForTest();
}
