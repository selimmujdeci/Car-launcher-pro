/**
 * enforcement.ts — ARCH-05 ÜRETİM YAPTIRIMI (adaptör katmanı).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ GÜVENLİK MOTORU DEĞİLDİR.** Karar kuralı TEK yerdedir:
 *     `authorization.authorize`. Burada yalnız o kuralın ihtiyaç duyduğu
 *     KANIT (principal · araç kapsamı · hareket · native izin) mevcut
 *     otoritelerden OKUNUR ve karar geri verilir.
 * (2) **YÖNLENDİRMEZ · YÜRÜTMEZ · TEKRAR DENEMEZ · SAHİP OLMAZ.** Hiçbir
 *     komut göndermez, hiçbir oturum yaratmaz, hiçbir yetenek üretmez.
 * (3) **YENİ KİMLİK/OTURUM OTORİTESİ DEĞİLDİR.** Telefon oturumunun sahibi
 *     `companionSessionManager`, araç kapsamının sahibi `capabilityStore`,
 *     hareket kanıtının sahibi `obdService`, native yüzeyin sahibi ARCH-04
 *     `nativeHalEvidence`tir. Hepsi burada YALNIZ OKUNUR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── YETKİ TABLOSU NEDEN STATİK ────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `PRINCIPAL_GRANTS` bir çalışma-zamanı yetki DEPOSU DEĞİL, `CAPABILITIES`
 * gibi bir POLİTİKA SABİTİDİR. Çalışma zamanında yetki üreten bir depo açmak,
 * "kendine yetki veren istemci" sınıfını yapısal olarak mümkün kılardı:
 * Mavi kendi yeteneğini yazabilir, telefon kendi rolünü yükseltebilirdi.
 * Bu yüzden yetki yalnız (a) principal SINIFINDAN ve (b) kanalın KENDİ
 * ölçtüğü kriptografik/oturum kanıtından türer; ÇAĞIRANIN İDDİASINDAN asla.
 */

import { Capacitor } from '@capacitor/core';
import {
  authorize, canExecute, CAPABILITIES,
  type Capability, type MotionClass, type Principal, type Provenance,
  type SecurityDecisionEvidence,
} from './authorization';
import type { NativeSourceId } from '../native/nativeHalEvidence';

/* ══════════════════════════════════════════════════════════════════════════
   1) PRINCIPAL SINIFLARI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ürün yolunda GERÇEKTEN var olan çağıran sınıfları.
 *
 * `PHONE_LINK` (BLE companion oturumu) ile `PHONE_REMOTE` ("Arabam Cebimde"
 * bulut komut kanalı) AYRI sınıflardır: ikisinin kimlik doğrulama kanıtı,
 * oturum modeli ve yetki kümesi FARKLIDIR. Tek "PHONE" sınıfı yapmak, bir
 * kanalda kazanılan güveni diğerine taşırdı (confused deputy).
 */
export type SecurityPrincipalClass =
  | 'LOCAL_UI' | 'MAVI' | 'PHONE_LINK' | 'PHONE_REMOTE'
  | 'SYSTEM_INTERNAL' | 'LAB' | 'REPLAY' | 'IMPORTED' | 'UNKNOWN';

/**
 * SINIF → YETKİ. Bu tablo ürünün TAMAMINDAKİ yetki gerçeğidir.
 *
 * Burada OLMAYAN bir yetki hiçbir çağıran tarafından kazanılamaz:
 *  · `DIAGNOSTIC_PRIVILEGED` — bu üründe privileged teşhis (SecurityAccess ·
 *    coding · adaptation · flashing) DESTEKLENMİYOR. Yetkiyi kimseye vermemek
 *    "sonra açarız" notundan daha güçlüdür: yol yapısal olarak kapalıdır.
 *  · `REMOTE_INPUT` — uzaktan girdi enjeksiyonu ürün yolunda YOK.
 *  · `RUNTIME_ADMIN` — yalnız süreç-içi kurtarma (SYSTEM_INTERNAL). Kullanıcı
 *    yüzeyi, Mavi ve telefon bunu ALAMAZ.
 *  · `STORAGE_ADMIN` — yalnız fiziksel olarak başındaki kullanıcı (LOCAL_UI).
 *
 * PHONE_LINK satırı kasıtlı BOŞTUR: telefonun yetkisi statik değil,
 * `companionCapabilityRegistry`in ANLAŞTIĞI yetenekten türer (§3).
 */
const PRINCIPAL_GRANTS: Readonly<Record<SecurityPrincipalClass, readonly Capability[]>> = Object.freeze({
  /* Baş ünitenin başındaki kullanıcı: fiziksel varlık kimlik kanıtıdır. */
  LOCAL_UI: Object.freeze<Capability[]>([
    'MEDIA_CONTROL', 'NAVIGATION_CONTROL', 'VEHICLE_READ', 'DIAGNOSTIC_READ',
    'CLEAR_DTC', 'SETTINGS_WRITE', 'STORAGE_ADMIN', 'HARDWARE_MEDIA',
  ]),
  /* Mavi ASLA yıkıcı/yönetimsel yetki almaz — LLM metni yetki değildir. */
  MAVI: Object.freeze<Capability[]>([
    'MEDIA_CONTROL', 'NAVIGATION_CONTROL', 'VEHICLE_READ', 'DIAGNOSTIC_READ',
  ]),
  /* Anlaşılan companion yeteneğinden türer — statik yetki YOK. */
  PHONE_LINK: Object.freeze<Capability[]>([]),
  /* Uzak kanal (eşleştirilmiş "Arabam Cebimde" kullanıcısı): okuma ve normal
     ayar yazımı serbest; CLEAR_DTC yalnız E2E kanıtıyla eklenir (§3). Teşhis
     yazma · runtime · depolama yönetimi ASLA verilmez. */
  PHONE_REMOTE: Object.freeze<Capability[]>(['VEHICLE_READ', 'DIAGNOSTIC_READ', 'SETTINGS_WRITE']),
  /* Süreç-içi kurtarma. Teşhis/silme/ayar yetkisi YOKTUR. */
  SYSTEM_INTERNAL: Object.freeze<Capability[]>(['RUNTIME_ADMIN']),
  LAB: Object.freeze<Capability[]>([]),
  REPLAY: Object.freeze<Capability[]>([]),
  IMPORTED: Object.freeze<Capability[]>([]),
  UNKNOWN: Object.freeze<Capability[]>([]),
});

/** Sınıf → sözleşmedeki principal tipi (kanonik `PrincipalType`). */
const PRINCIPAL_TYPE: Readonly<Record<SecurityPrincipalClass, Principal['principalType']>> = Object.freeze({
  LOCAL_UI: 'LOCAL_UI', MAVI: 'MAVI', PHONE_LINK: 'PHONE_DEVICE', PHONE_REMOTE: 'PHONE_DEVICE',
  SYSTEM_INTERNAL: 'SYSTEM_INTERNAL', LAB: 'LAB', REPLAY: 'REPLAY_SOURCE',
  IMPORTED: 'IMPORTED_SOURCE', UNKNOWN: 'UNKNOWN',
});

/** Sınıf → provenance. LAB/REPLAY/IMPORTED canlı yetki ÜRETEMEZ (fail-closed). */
const PRINCIPAL_PROVENANCE: Readonly<Record<SecurityPrincipalClass, Provenance>> = Object.freeze({
  LOCAL_UI: 'LIVE', MAVI: 'LIVE', PHONE_LINK: 'LIVE', PHONE_REMOTE: 'LIVE',
  SYSTEM_INTERNAL: 'LIVE', LAB: 'LAB', REPLAY: 'REPLAY', IMPORTED: 'IMPORTED', UNKNOWN: 'UNKNOWN',
});

/**
 * Opak principal referansı. Ham telefon kimliği, token, kişi adı, VIN veya
 * cihaz adresi ÜRETİLMEZ — yalnız sınıf adı taşınır.
 */
const PRINCIPAL_REF: Readonly<Record<SecurityPrincipalClass, string>> = Object.freeze({
  LOCAL_UI: 'principal:local_ui', MAVI: 'principal:mavi',
  PHONE_LINK: 'principal:phone_link', PHONE_REMOTE: 'principal:phone_remote',
  SYSTEM_INTERNAL: 'principal:system_internal', LAB: 'principal:lab',
  REPLAY: 'principal:replay', IMPORTED: 'principal:imported', UNKNOWN: 'principal:unknown',
});

/* ══════════════════════════════════════════════════════════════════════════
   2) KANAL KANITI — çağıranın İDDİASI değil, KANAL SAHİBİNİN ölçümü
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kanal sahibinin ölçtüğü kanıt.
 *
 * ⚠️ SÖZLEŞME: bu nesneyi YALNIZ ilgili kanalın sahibi doldurabilir
 * (`companionSessionManager` oturumu, `commandListener` E2E doğrulaması,
 * `runtimeRecoverySupervisor` kaynağı). Bir alt katman bunu kendi adına
 * uyduramaz; kilit testi yaptırım noktalarının sahibini sabitler.
 */
export interface ChannelEvidence {
  /** Oturum GERÇEKTEN bağlı mı (CONNECTED ≠ ATTACHED). */
  readonly attached?: boolean;
  /** İsteğin doğduğu nesil. */
  readonly generation?: number | null;
  /** Kanalın ŞU ANKİ nesli. Farklıysa istek bayattır. */
  readonly currentGeneration?: number | null;
  /** Kanal kimlik doğrulaması TAMAMLANDI mı. */
  readonly authenticated?: boolean;
  /** Uzak kanalda uçtan uca şifreleme DOĞRULANDI mı (kriptografik kanıt). */
  readonly e2eVerified?: boolean;
  /** Telefon oturumunun ANLAŞTIĞI companion yetenekleri (ham liste). */
  readonly negotiatedCapabilities?: readonly string[];
}

/**
 * Companion (BLE) yeteneği → CarOS yeteneği. **Tek yönlü ve DAR.**
 *
 * Teşhis · silme · runtime · depolama yetkilerinin companion karşılığı
 * BİLİNÇLİ OLARAK YOKTUR: bir telefon anlaşma yoluyla bunları ASLA elde
 * edemez. Yeni bir eşleme eklemek, o yetkiyi telefona açmak demektir.
 */
const COMPANION_CAPABILITY_MAP: Readonly<Record<string, Capability>> = Object.freeze({
  MEDIA: 'MEDIA_CONTROL',
  CALLS: 'PHONE_CONTROL',
  VIDEO: 'SCREEN_PROJECTION',
});

/**
 * Uzak (bulut) komut → gerektirdiği yetki. Yalnız E2E doğrulanmış bir
 * komut yıkıcı yetki kazanabilir; doğrulanmamış komut okuma kümesinde kalır.
 */
const REMOTE_E2E_CAPABILITIES: readonly Capability[] = Object.freeze(['CLEAR_DTC']);

/** Kanal kanıtından NİHAİ yetki kümesi. Çağıranın iddiası buraya GİREMEZ. */
function resolveGrants(
  principalClass: SecurityPrincipalClass, channel: ChannelEvidence,
): readonly Capability[] {
  const base = PRINCIPAL_GRANTS[principalClass] ?? PRINCIPAL_GRANTS.UNKNOWN;
  if (principalClass === 'PHONE_LINK') {
    /* Anlaşılmış yetenek ANCAK canlı bir oturumun içinde yetkiye dönüşür.
       CONNECTED bir taşıma, önbellekteki bir liste ya da doğrulanmamış bir
       eşleşme yetki DEĞİLDİR: kimlik doğrulanmadan ve oturum bağlanmadan
       yetenek listesi BOŞ sayılır (fail-closed). */
    if (channel.authenticated !== true || channel.attached !== true) return Object.freeze([]);
    const negotiated = channel.negotiatedCapabilities ?? [];
    const mapped: Capability[] = [];
    for (const token of negotiated) {
      const cap = COMPANION_CAPABILITY_MAP[token];
      if (cap !== undefined && !mapped.includes(cap)) mapped.push(cap);
    }
    return Object.freeze(mapped);
  }
  if (principalClass === 'PHONE_REMOTE' && channel.e2eVerified === true) {
    return Object.freeze([...base, ...REMOTE_E2E_CAPABILITIES]);
  }
  return base;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BAĞLAM OKUYUCULARI — araç kapsamı · hareket · native izin
   ══════════════════════════════════════════════════════════════════════════ */

/** Karar anındaki ölçülmüş bağlam. Hiçbiri bu dosyada HESAPLANMAZ. */
export interface SecurityRuntimeContext {
  /** Aktif araç parmak izi (16 hex) veya `null`. Ham VIN ASLA taşınmaz. */
  readonly vehicleRef: string | null;
  /** Doğrulanmış hareket sınıfı. GPS hızı buraya GİREMEZ. */
  readonly motion: MotionClass;
}

type ContextProvider = () => SecurityRuntimeContext;

/**
 * Üretim okuyucusu — hepsi try/catch; bir kaynak düşerse karar FAIL-CLOSED
 * tarafa (bilinmeyen kapsam / bilinmeyen hareket) düşer, sahte değer üretmez.
 */
function readProductionContext(): SecurityRuntimeContext {
  let vehicleRef: string | null = null;
  try {
    /* Araç kapsamının TEK sahibi: `capabilityStore`. Dinamik import kullanılır
       çünkü güvenlik katmanı OBD grafiğini AÇILIŞTA yüklememelidir. */
    vehicleRef = _vehicleRefReader === null ? null : _vehicleRefReader();
  } catch { vehicleRef = null; }
  let motion: MotionClass = 'UNKNOWN';
  try {
    motion = _motionReader === null ? 'UNKNOWN' : _motionReader();
  } catch { motion = 'UNKNOWN'; }
  return Object.freeze({ vehicleRef, motion });
}

let _vehicleRefReader: (() => string | null) | null = null;
let _motionReader: (() => MotionClass) | null = null;
let _contextProvider: ContextProvider = readProductionContext;

/**
 * Sahibi tarafından BİR KEZ bağlanan okuyucular (ARCH-01 wiring deseni).
 *
 * Güvenlik katmanı OBD/VDL modüllerini doğrudan import etseydi, açılış grafiği
 * ve test izolasyonu bozulur, döngüsel bağımlılık riski doğardı. Bağlanmamış
 * okuyucu = "ölçüm yok" = fail-closed; sahte varsayılan ÜRETİLMEZ.
 */
export function bindSecurityContextReaders(readers: {
  readonly vehicleRef?: () => string | null;
  readonly motion?: () => MotionClass;
}): void {
  if (readers.vehicleRef !== undefined) _vehicleRefReader = readers.vehicleRef;
  if (readers.motion !== undefined) _motionReader = readers.motion;
}

/** YALNIZ TEST. Üretim kodu çağırmaz (statik kilit testiyle korunur). */
export function _setSecurityContextForTest(ctx: SecurityRuntimeContext | null): void {
  _contextProvider = ctx === null ? readProductionContext : () => ctx;
}

/** YALNIZ TEST — bağlı okuyucuları söker. */
export function _resetSecurityContextReadersForTest(): void {
  _vehicleRefReader = null; _motionReader = null; _contextProvider = readProductionContext;
}

/** Karar anındaki bağlamı okur (üretimde gerçek kaynaklar). */
export function readSecurityContext(): SecurityRuntimeContext {
  try { return _contextProvider(); } catch { return Object.freeze({ vehicleRef: null, motion: 'UNKNOWN' as const }); }
}

/* ── Native izin kanıtı (ARCH-04 modeli YENİDEN HESAPLANMAZ) ─────────────── */

/** Yetki → o yetkinin dokunduğu native kaynak (ARCH-04 `NativeSourceId`). */
const CAPABILITY_NATIVE_SOURCE: Readonly<Partial<Record<Capability, NativeSourceId>>> = Object.freeze({
  PHONE_CONTROL: 'PHONE_LINK', SCREEN_PROJECTION: 'PHONE_LINK', REMOTE_INPUT: 'PHONE_LINK',
  DIAGNOSTIC_READ: 'OBD', CLEAR_DTC: 'OBD', DIAGNOSTIC_PRIVILEGED: 'OBD',
  STORAGE_ADMIN: 'SAFE_STORAGE', RUNTIME_ADMIN: 'FOREGROUND_SERVICE',
  HARDWARE_MEDIA: 'HARDWARE_MEDIA',
});

let _nativeReader: ((id: NativeSourceId) => { permission: string; capability: string }) | null = null;

/** Sahibi tarafından bağlanan ARCH-04 okuyucusu (bkz. `bindSecurityContextReaders`). */
export function bindNativePermissionReader(
  read: ((id: NativeSourceId) => { permission: string; capability: string }) | null,
): void { _nativeReader = read; }

/**
 * NATIVE İZİN KANITI — üç değerli, fail-closed.
 *
 * `true`  → yüzey ölçüldü ve engel YOK.
 * `false` → izin AÇIKÇA reddedildi ya da köprü ölçülerek YOK bulundu.
 * `null`  → ölçüm yok → sözleşme `UNAVAILABLE` verir (sahte "izinli" YOK).
 *
 * ⚠️ ANDROID İZNİ CAROS YETKİSİ DEĞİLDİR: bu fonksiyon `true` dönse bile karar
 * ALLOW olmaz — açık yetenek kapısı (`grantedCapabilities`) AYRI ve SONRAKİ
 * kapıdır. Ölçülmemiş bir izin hiçbir yetki ÜRETMEZ.
 */
export function readNativePermissionEvidence(capability: Capability): boolean | null {
  const descriptor = CAPABILITIES[capability] ?? CAPABILITIES.UNKNOWN;
  if (!descriptor.requiresNativePermission) return true;
  const sourceId = CAPABILITY_NATIVE_SOURCE[capability];
  if (sourceId === undefined) return null;
  let isNative = false;
  try { isNative = Capacitor.isNativePlatform(); } catch { isNative = false; }
  if (!isNative) return null; // native yüzey YOK → kanıt YOK
  if (_nativeReader === null) return null;
  let row: { permission: string; capability: string };
  try { row = _nativeReader(sourceId); } catch { return null; }
  if (row.permission === 'DENIED' || row.permission === 'RESTRICTED') return false;
  if (row.capability === 'UNAVAILABLE') return false;
  if (row.permission === 'GRANTED') return true;
  /* İzin ölçülemeyen (NOT_APPLICABLE / UNKNOWN) domainlerde TEK kabul edilebilir
     kanıt, köprünün ÖLÇÜLMÜŞ varlığıdır. Bu bir yetki değil, yalnız "yüzey
     gerçekten var" kanıtıdır; yetki kapısı bundan bağımsız işler. */
  return row.capability === 'AVAILABLE' ? true : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) YETKİLENDİRME — tek giriş noktası
   ══════════════════════════════════════════════════════════════════════════ */

export interface OperationAuthorizationRequest {
  readonly principalClass: SecurityPrincipalClass;
  readonly capability: Capability;
  /** ARCH-03 operasyon kimliği — karar bu operasyona BAĞLANIR. */
  readonly operationId: string;
  /** Neyin üzerinde işlem yapılıyor (opak). */
  readonly targetRef: string | null;
  readonly channel?: ChannelEvidence;
  /** Native izin kanıtı çağıran tarafından ölçüldüyse (aksi halde okunur). */
  readonly nativePermission?: boolean | null;
}

/** Yürütme öncesi TOCTOU yeniden doğrulaması için gereken bağ. */
export interface AuthorizedOperation {
  readonly evidence: SecurityDecisionEvidence;
  readonly allowed: boolean;
  readonly request: OperationAuthorizationRequest;
}

/** Kimlik doğrulama durumu — sınıf + kanal kanıtından türer, iddia edilmez. */
function resolveAuthentication(
  principalClass: SecurityPrincipalClass, channel: ChannelEvidence,
): Principal['authenticationState'] {
  /* Baş ünitenin başındaki kullanıcı ve süreç-içi kurtarma yapısal olarak
     doğrulanmıştır (fiziksel varlık / aynı süreç). Diğer her sınıf KANIT ister. */
  if (principalClass === 'LOCAL_UI' || principalClass === 'SYSTEM_INTERNAL') return 'AUTHENTICATED';
  if (principalClass === 'MAVI') return 'AUTHENTICATED'; // süreç-içi, ama yetkisi DAR
  if (channel.authenticated === true) return 'AUTHENTICATED';
  if (channel.authenticated === false) return 'NOT_AUTHENTICATED';
  return 'UNKNOWN';
}

/**
 * ÜRETİM YETKİLENDİRMESİ. Kararı `authorize` verir; burada yalnız kanıt
 * toplanır. Yan etki YOKTUR (kanıt defterine yazmak hariç — o da salt-okunur
 * bir gözlem projeksiyonudur ve karara ASLA geri beslenmez).
 */
export function authorizeOperation(request: OperationAuthorizationRequest): AuthorizedOperation {
  const channel = request.channel ?? {};
  const ctx = readSecurityContext();
  const principal: Principal = Object.freeze({
    principalType: PRINCIPAL_TYPE[request.principalClass] ?? 'UNKNOWN',
    principalIdRef: PRINCIPAL_REF[request.principalClass] ?? PRINCIPAL_REF.UNKNOWN,
    deviceIdentityRef: null,
    personIdentityRef: null,
    /* Principal DAİMA aktif araca bağlanır — kapsam ZORUNLU olmasa bile.
       Gerekçe: zorunlu olmayan bir yetkide de karar, üretildiği ARACA aittir;
       araç değişince TOCTOU yeniden doğrulaması onu bayat sayabilmelidir.
       Değer 16 hane parmak izidir; ham VIN yapısal olarak buraya giremez. */
    vehicleRef: ctx.vehicleRef,
    sessionRef: null,
    generation: channel.generation ?? null,
    authenticationState: resolveAuthentication(request.principalClass, channel),
    provenance: PRINCIPAL_PROVENANCE[request.principalClass] ?? 'UNKNOWN',
  });
  const nativePermission = request.nativePermission !== undefined
    ? request.nativePermission
    : readNativePermissionEvidence(request.capability);
  const evidence = authorize({
    principal,
    capability: request.capability,
    targetRef: request.targetRef,
    vehicleRef: ctx.vehicleRef,
    attached: channel.attached ?? false,
    currentGeneration: channel.currentGeneration ?? null,
    grantedCapabilities: resolveGrants(request.principalClass, channel),
    motion: ctx.motion,
    nativePermission,
    /* CANLILIK BİR YETKİ SORUSU DEĞİLDİR ve burada VARSAYILMAZ: "sahip ayakta
       mı" kararı alan kapısının KENDİSİNDEDİR ve her yaptırım noktası onu
       zaten ölçer (`clearDTCCodes` → bağlantı durumu · `companionSessionManager`
       → `canSendApplicationMessage` · `genericPduTransport` → köprü varlığı).
       Ölçülmemiş bir canlılığı burada `false` saymak her işlemi kilitlerdi,
       `true` saymak ise ölçülmemiş bir şeyi iddia etmek olurdu; bu yüzden
       canlılık bu katmanın GİRDİSİ OLMAKTAN ÇIKARILDI. */
    available: true,
    operationId: request.operationId,
  });
  return Object.freeze({ evidence, allowed: evidence.decision === 'ALLOW', request });
}

/**
 * TOCTOU KAPISI — yan etkiden HEMEN ÖNCE çağrılır.
 *
 * Yetkilendirme ile yürütme arasında araç değişmiş, oturum nesli ilerlemiş,
 * hareket durumu bozulmuş ya da yetki geri alınmış olabilir. Bu fonksiyon
 * kararı YENİDEN üretmez; kararın hâlâ AYNI dünyaya ait olduğunu doğrular.
 *
 * @param op         `authorizeOperation` çıktısı
 * @param channelNow yürütme anındaki KANAL kanıtı (yoksa ilk kanıt kullanılır)
 */
export function revalidateAuthorization(
  op: AuthorizedOperation, channelNow?: ChannelEvidence,
): boolean {
  if (!op.allowed) return false;
  const channel = channelNow ?? op.request.channel ?? {};
  const ctx = readSecurityContext();
  const descriptor = CAPABILITIES[op.request.capability] ?? CAPABILITIES.UNKNOWN;
  const scopedVehicle = ctx.vehicleRef;
  /* Kanonik yeniden kontrol (araç · nesil · provenance). */
  const principalNow: Principal = Object.freeze({
    principalType: PRINCIPAL_TYPE[op.request.principalClass] ?? 'UNKNOWN',
    principalIdRef: PRINCIPAL_REF[op.request.principalClass] ?? PRINCIPAL_REF.UNKNOWN,
    vehicleRef: scopedVehicle,
    sessionRef: null,
    generation: channel.generation ?? null,
    authenticationState: resolveAuthentication(op.request.principalClass, channel),
    provenance: PRINCIPAL_PROVENANCE[op.request.principalClass] ?? 'UNKNOWN',
  });
  if (!canExecute(op.evidence, {
    principal: principalNow, vehicleRef: scopedVehicle,
    currentGeneration: channel.currentGeneration ?? null,
  })) return false;
  /* Oturum ayrılması / kimlik kaybı / yetki geri alınması — kanonik kontrolün
     kapsamadığı iptal tetikleyicileri BURADA kapanır (§revocation). */
  if (descriptor.requiresAttachedSession && channel.attached !== true) return false;
  if (descriptor.requiresAuthenticatedPrincipal
    && principalNow.authenticationState !== 'AUTHENTICATED') return false;
  if (descriptor.parkedOnly && ctx.motion !== 'PARKED') return false;
  if (!resolveGrants(op.request.principalClass, channel).includes(op.request.capability)) return false;
  return true;
}

/**
 * Kararın BAŞKA bir operasyonda yeniden kullanılmasını engeller.
 * Bir ALLOW yalnız üretildiği `operationId` için geçerlidir.
 */
export function decisionMatchesOperation(
  evidence: SecurityDecisionEvidence, operationId: string, capability: Capability,
): boolean {
  return evidence.decision === 'ALLOW'
    && evidence.correlationId === operationId
    && evidence.capability === capability;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) TEŞHİS İŞLEM SINIFLANDIRMASI (§OBD READ vs PRIVILEGED)
   ══════════════════════════════════════════════════════════════════════════ */

export type DiagnosticOperationClass =
  | 'DIAGNOSTIC_READ' | 'CLEAR_DTC' | 'ACTIVE_TEST' | 'ROUTINE_CONTROL'
  | 'SECURITY_ACCESS' | 'WRITE_DATA' | 'CODING' | 'ADAPTATION' | 'FLASHING' | 'UNKNOWN';

/**
 * SERVİS BAYTI → İŞLEM SINIFI (ISO 14229-1 / ISO 14230-3 / SAE J1979).
 *
 * Bu tablo native `DiagnosticServiceGate`in beyaz listesini GENİŞLETMEZ ve
 * onun yerine GEÇMEZ: yalnız ürün tarafında işlemin RİSK SINIFINI adlandırır.
 * Tabloda olmayan her servis `UNKNOWN`dur ve `UNKNOWN` = DENY.
 */
const DIAGNOSTIC_SERVICE_CLASS: Readonly<Record<string, DiagnosticOperationClass>> = Object.freeze({
  '01': 'DIAGNOSTIC_READ', '03': 'DIAGNOSTIC_READ', '06': 'DIAGNOSTIC_READ',
  '07': 'DIAGNOSTIC_READ', '09': 'DIAGNOSTIC_READ', '0A': 'DIAGNOSTIC_READ',
  '10': 'DIAGNOSTIC_READ', '13': 'DIAGNOSTIC_READ', '17': 'DIAGNOSTIC_READ',
  '18': 'DIAGNOSTIC_READ', '19': 'DIAGNOSTIC_READ', '1A': 'DIAGNOSTIC_READ',
  '21': 'DIAGNOSTIC_READ', '22': 'DIAGNOSTIC_READ', '3E': 'DIAGNOSTIC_READ',
  '04': 'CLEAR_DTC', '14': 'CLEAR_DTC',
  '11': 'ACTIVE_TEST', '2F': 'ACTIVE_TEST', '85': 'ACTIVE_TEST', '28': 'ACTIVE_TEST',
  '31': 'ROUTINE_CONTROL',
  '27': 'SECURITY_ACCESS',
  '2E': 'WRITE_DATA', '3B': 'WRITE_DATA',
  '34': 'FLASHING', '35': 'FLASHING', '36': 'FLASHING', '37': 'FLASHING',
});

/** Salt-okunur olmayan her sınıf privileged'dır ve bu üründe DESTEKLENMEZ. */
const PRIVILEGED_CLASSES: ReadonlySet<DiagnosticOperationClass> = new Set<DiagnosticOperationClass>([
  'ACTIVE_TEST', 'ROUTINE_CONTROL', 'SECURITY_ACCESS', 'WRITE_DATA',
  'CODING', 'ADAPTATION', 'FLASHING',
]);

/** Servis baytını sınıflandırır. Bozuk/bilinmeyen bayt → `UNKNOWN` (DENY). */
export function classifyDiagnosticOperation(service: string | null | undefined): DiagnosticOperationClass {
  if (typeof service !== 'string') return 'UNKNOWN';
  const sid = service.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (sid.length !== 2) return 'UNKNOWN';
  return DIAGNOSTIC_SERVICE_CLASS[sid] ?? 'UNKNOWN';
}

/** Sınıf → gereken yetki. `UNKNOWN` ve privileged sınıflar KİMSEYE verilmez. */
export function diagnosticCapabilityFor(cls: DiagnosticOperationClass): Capability {
  if (cls === 'DIAGNOSTIC_READ') return 'DIAGNOSTIC_READ';
  if (cls === 'CLEAR_DTC') return 'CLEAR_DTC';
  if (PRIVILEGED_CLASSES.has(cls)) return 'DIAGNOSTIC_PRIVILEGED';
  return 'UNKNOWN';
}

/**
 * ÜRÜN TARAFI TEŞHİS KAPISI (çift kapının BİRİNCİSİ).
 *
 * Native `DiagnosticServiceGate` İKİNCİ ve BAĞIMSIZ kapıdır; bu fonksiyon onu
 * ne gevşetir ne de yerine geçer. İkisinden biri reddederse hatta TEK BAYT
 * çıkmaz.
 */
export function judgeDiagnosticOperation(input: {
  readonly principalClass: SecurityPrincipalClass;
  readonly service: string | null | undefined;
  readonly operationId: string;
  readonly targetRef: string | null;
  readonly channel?: ChannelEvidence;
  /** Alan sahibinin ÖLÇTÜĞÜ native yüzey kanıtı (köprü var mı). */
  readonly nativePermission?: boolean | null;
}): { readonly allowed: boolean; readonly operationClass: DiagnosticOperationClass; readonly evidence: SecurityDecisionEvidence } {
  const operationClass = classifyDiagnosticOperation(input.service);
  const capability = diagnosticCapabilityFor(operationClass);
  const op = authorizeOperation({
    principalClass: input.principalClass, capability,
    operationId: input.operationId, targetRef: input.targetRef, channel: input.channel,
    nativePermission: input.nativePermission,
  });
  return Object.freeze({ allowed: op.allowed, operationClass, evidence: op.evidence });
}

/* ══════════════════════════════════════════════════════════════════════════
   6) AYAR SINIFLANDIRMASI (§SETTINGS)
   ══════════════════════════════════════════════════════════════════════════ */

export type SettingClass =
  | 'PRESENTATION' | 'NORMAL_USER' | 'VEHICLE_SPECIFIC'
  | 'SECURITY_SENSITIVE' | 'RUNTIME_ADMIN';

/**
 * Güvenlik açısından hassas ayar ANAHTAR DESENLERİ (repo gerçeğinden).
 *
 * Kalıcı bir ayar değeri ASLA yetki üretmez: uygulama anında yetki AYRICA
 * sorulur. Bu yüzden açılışta hidrasyon bir yetki kapısı AÇAMAZ.
 */
const SECURITY_SENSITIVE_SETTING_PATTERNS: readonly RegExp[] = Object.freeze([
  /expert/i, /developer/i, /debug/i, /diagnostic.*(enable|unlock|write)/i,
  /trust(ed)?/i, /remote.*(input|control)/i, /native.*(override|bypass)/i,
  /unsafe/i, /bypass/i, /\badmin\b/i,
]);

const RUNTIME_ADMIN_SETTING_PATTERNS: readonly RegExp[] = Object.freeze([
  /runtime.*(restart|shutdown|admin)/i, /force.*(restart|reboot)/i,
]);

/** Ayar anahtarını sınıflandırır — bilinmeyen ayar en DAR sınıfa düşmez. */
export function classifySetting(key: string): SettingClass {
  if (typeof key !== 'string' || key.length === 0) return 'SECURITY_SENSITIVE';
  if (RUNTIME_ADMIN_SETTING_PATTERNS.some((re) => re.test(key))) return 'RUNTIME_ADMIN';
  if (SECURITY_SENSITIVE_SETTING_PATTERNS.some((re) => re.test(key))) return 'SECURITY_SENSITIVE';
  return 'NORMAL_USER';
}

/** Ayar sınıfı → gereken yetki. Sunum/normal ayar yetki İSTEMEZ. */
export function settingCapabilityFor(cls: SettingClass): Capability | null {
  if (cls === 'RUNTIME_ADMIN') return 'RUNTIME_ADMIN';
  if (cls === 'SECURITY_SENSITIVE') return 'SETTINGS_WRITE';
  return null;
}

/**
 * HASSAS AYAR UYGULAMA KAPISI. `null` yetki → kapı YOK (normal ayar serbest);
 * yetki varsa açık yetkilendirme zorunlu.
 */
export function authorizeSettingApply(input: {
  readonly principalClass: SecurityPrincipalClass;
  readonly key: string;
  readonly operationId: string;
  readonly channel?: ChannelEvidence;
}): { readonly allowed: boolean; readonly settingClass: SettingClass; readonly evidence: SecurityDecisionEvidence | null } {
  const settingClass = classifySetting(input.key);
  const capability = settingCapabilityFor(settingClass);
  if (capability === null) return Object.freeze({ allowed: true, settingClass, evidence: null });
  const op = authorizeOperation({
    principalClass: input.principalClass, capability,
    operationId: input.operationId, targetRef: `setting:${settingClass.toLowerCase()}`,
    channel: input.channel,
  });
  return Object.freeze({ allowed: op.allowed, settingClass, evidence: op.evidence });
}

/* ══════════════════════════════════════════════════════════════════════════
   7) DEPOLAMA YÖNETİMİ (§STORAGE / DELETE / RESET)
   ══════════════════════════════════════════════════════════════════════════ */

export type StorageAdminOperation =
  | 'CLEAR_TRIP_HISTORY' | 'CLEAR_SAVED_LOCATIONS' | 'RESET_PAIRING'
  | 'DELETE_TRUSTED_DEVICE' | 'CLEAR_DIAGNOSTIC_HISTORY' | 'VEHICLE_DATA_WIPE'
  | 'SECURE_STORAGE_RESET' | 'FULL_RESET';

/**
 * YIKICI DEPOLAMA KAPISI. Normal ayar yazımı bu kapıdan GEÇMEZ ve bu yetkiyi
 * ASLA vermez — `SETTINGS_WRITE` ≠ `STORAGE_ADMIN` (confused deputy kapısı).
 */
export function authorizeStorageAdmin(input: {
  readonly principalClass: SecurityPrincipalClass;
  readonly operation: StorageAdminOperation;
  readonly operationId: string;
  readonly channel?: ChannelEvidence;
}): AuthorizedOperation {
  return authorizeOperation({
    principalClass: input.principalClass, capability: 'STORAGE_ADMIN',
    operationId: input.operationId, targetRef: `storage:${input.operation.toLowerCase()}`,
    channel: input.channel,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   8) YETENEK DURUM MATRİSİ (LAB projeksiyonu — DÜRÜST durum)
   ══════════════════════════════════════════════════════════════════════════ */

export type CapabilityStatusClass =
  | 'SUPPORTED' | 'SUPPORTED_GATED' | 'DENY_DEFAULT' | 'NOT_SUPPORTED';

/**
 * Her yeteneğin ÜRÜNDEKİ dürüst durumu.
 *
 * `DENY_DEFAULT` = sözleşmede tanımlı ama hiçbir principal'a VERİLMİYOR.
 * `NOT_SUPPORTED` = ürün yolunda karşılığı YOK (bugün üretilemez).
 */
export const CAPABILITY_STATUS: Readonly<Record<Capability, CapabilityStatusClass>> = Object.freeze({
  MEDIA_CONTROL: 'SUPPORTED_GATED',
  NAVIGATION_CONTROL: 'SUPPORTED_GATED',
  PHONE_CONTROL: 'SUPPORTED_GATED',
  VEHICLE_READ: 'SUPPORTED_GATED',
  DIAGNOSTIC_READ: 'SUPPORTED_GATED',
  CLEAR_DTC: 'SUPPORTED_GATED',
  DIAGNOSTIC_PRIVILEGED: 'DENY_DEFAULT',
  RUNTIME_ADMIN: 'SUPPORTED_GATED',
  SETTINGS_WRITE: 'SUPPORTED_GATED',
  STORAGE_ADMIN: 'SUPPORTED_GATED',
  REMOTE_INPUT: 'DENY_DEFAULT',
  SCREEN_PROJECTION: 'SUPPORTED_GATED',
  HARDWARE_MEDIA: 'SUPPORTED_GATED',
  UNKNOWN: 'NOT_SUPPORTED',
});

/** Sözleşmede KARŞILIĞI OLMAYAN yetenek adları — dürüst `NOT_SUPPORTED`. */
export const UNMODELLED_CAPABILITIES: Readonly<Record<string, CapabilityStatusClass>> = Object.freeze({
  MAVI_ACTION: 'NOT_SUPPORTED',
  MEDIA_CAST: 'NOT_SUPPORTED',
});

/** LAB için sınıf → yetki projeksiyonu (salt-okunur; yetki ÜRETMEZ). */
export function principalGrantMatrix(): Readonly<Record<SecurityPrincipalClass, readonly Capability[]>> {
  return PRINCIPAL_GRANTS;
}
