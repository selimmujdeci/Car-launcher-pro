/**
 * phoneLinkLifecycle.ts — PHONE LINK F4.5/F4.6 · deterministik iptal zinciri.
 *
 * ── F3'TE KALAN TEK RİSKİ KAPATIR ───────────────────────────────────────────
 * F3'te yetki reddi anlıktı ama KAYNAK temizliği bir sonraki HTTP isteğine,
 * Music olayına veya UI çağrısına bağlıydı. F4.1'in kanonik lifecycle olayı
 * sayesinde artık kopuşun KENDİSİ tetikleyicidir:
 *
 *   native geçiş → kanonik olay → TS yutma → BU ZİNCİR
 *
 * Timer YOK, polling YOK, HTTP isteği BEKLENMEZ, Music olayı BEKLENMEZ,
 * UI çağrısı BEKLENMEZ.
 *
 * ── SIRA PAZARLIKSIZ (F4.5) ─────────────────────────────────────────────────
 * ÖNCE GÜVENLİK GERÇEĞİ, SONRA KAYNAK:
 *   1. runtime session indeksinden düş   → attachment o çift için DETACHED
 *   2. capability grant geçersiz
 *   3. GuestSession revoke                → portal yetkilendirmesi artık reddeder
 *   ── buradan sonrası yalnız KAYNAK ──
 *   4. açık SSE istemcileri kapat
 *   5. portal sunucusu YALNIZ başka geçerli guest session kalmadıysa dursun
 *
 * Tersi (önce soket, sonra otorite) yetkinin hâlâ ayakta olduğu bir temizlik
 * penceresi bırakırdı. 1–3 SENKRONDUR: zincir bir `await` görmeden önce
 * güvenlik gerçeği çoktan düşmüştür.
 *
 * ── YENİ OTORİTE YOK ────────────────────────────────────────────────────────
 * Bu modül hiçbir durum ÜRETMEZ. Kararı native verir, canlılığı registry
 * tutar, yetkiyi `authorize()` verir. Burada yalnız SIRA vardır.
 *
 * ── DOMAIN SINIRI (F4.13) ───────────────────────────────────────────────────
 * Portal kaynaklarının sahibi portal runtime'dır; bu modül onları DOĞRUDAN
 * kapatmaz — kayıtlı bir serbest bırakıcıya delege eder. Böylece PhoneHub
 * native'i HTTP sunucusu bilmez, bu modül soket bilmez.
 */

import {
  subscribePhoneHubLinkState,
  type PhoneHubLinkStateEvent,
} from '../phoneHub/phoneHubLink';
import {
  engagePhoneLinkEventMode, upsertRuntimeSession, removeRuntimeSession,
  activeRuntimeSessionCount,
} from './phoneLinkSessionRegistry';
import { revokeGuestSessionsFor, hasActiveGuestSession } from './phoneLinkGuestSession';
import { revokeGuestGrantsFor } from './phoneLinkCapabilityGrant';
import type { PhoneAttachmentState } from './phoneLinkAttachment';

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak sahipliği köprüsü — domain sınırını korur
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkPortalResourceReleaser {
  /** Açık portal istemcilerini (SSE) kapatır. */
  closeStreams(): Promise<void>;
  /** Portal sunucusunun çalışma kararını YENİDEN UYGULAR (start/stop). */
  syncPortal(): Promise<void>;
}

let _releaser: PhoneLinkPortalResourceReleaser | null = null;

/**
 * PHONE LINK F5 — internet gözlemi/oturum ilişkisini bırakan kanca.
 *
 * ⚠️ Bu kanca Android'in AĞ BAĞLANTISINI KAPATMAZ (F5.10). Yalnız Phone Link
 * oturumuyla kurulmuş ilişkiyi ve bizim `NetworkCallback` kaydımızı bırakır.
 * Kimlik/oturum yaşam döngüsü ile OS ağ yaşam döngüsü AYRI tutulur: telefonun
 * hotspot'una bağlı bir Wi-Fi'ı sistem hâlâ kullanıyor olabilir ve bu bizim
 * kararımız değildir.
 */
export interface PhoneLinkInternetAssociationReleaser {
  releaseInternetAssociation(): Promise<void>;
}

let _internetReleaser: PhoneLinkInternetAssociationReleaser | null = null;

/** Gateway kendi kaynağının sahibi olarak kaydolur (TEK kayıt). */
export function registerInternetAssociationReleaser(
  releaser: PhoneLinkInternetAssociationReleaser,
): () => void {
  _internetReleaser = releaser;
  return () => { if (_internetReleaser === releaser) _internetReleaser = null; };
}

/**
 * PHONE LINK F6 — telefon-entegrasyon sahipliğini bırakan kanca.
 *
 * ⚠️ Rakip bir uygulamayı BAŞLATMAZ ve hiçbir process/paket işlemi YAPMAZ.
 * Yalnız CarOS'un sahiplik iddiasını düşürür; alanlar `AVAILABLE` olur.
 * Serbest bırakmak ≠ zorla başlatmak (F6.3).
 */
export interface PhoneLinkIntegrationOwnershipReleaser {
  /**
   * PHONE LINK F6.1 — canonical ACTIVE gecisine tepki olarak mevcut politika
   * (ayar + oturum) YENIDEN uygulanir. Yeni karar kurali BURADA yoktur —
   * `phoneIntegrationOwnership.reconcilePhoneIntegrationOwnership()`e delege
   * eder; bu arayuz yalniz domain sinirini (F4.13) korur.
   */
  reconcileOwnership(): Promise<void>;
  releaseIntegrationOwnership(): Promise<void>;
}

let _ownershipReleaser: PhoneLinkIntegrationOwnershipReleaser | null = null;

/** Arbiter efekt katmanı kendi sahipliğinin sahibi olarak kaydolur. */
export function registerIntegrationOwnershipReleaser(
  releaser: PhoneLinkIntegrationOwnershipReleaser,
): () => void {
  _ownershipReleaser = releaser;
  return () => { if (_ownershipReleaser === releaser) _ownershipReleaser = null; };
}

/**
 * Portal runtime kendi kaynaklarının sahibi olarak kaydolur. TEK kayıt
 * tutulur; ikinci kayıt öncekini DEĞİŞTİRİR (çift temizlik YOK).
 */
export function registerPortalResourceReleaser(
  releaser: PhoneLinkPortalResourceReleaser,
): () => void {
  _releaser = releaser;
  return () => { if (_releaser === releaser) _releaser = null; };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlemlenebilirlik (F4.16) — sır TAŞIMAZ, TIMER YOK
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkLifecycleTelemetry {
  readonly lastState: PhoneHubLinkStateEvent['state'] | null;
  readonly lastReason: PhoneHubLinkStateEvent['reason'] | null;
  readonly lastEpoch: number | null;
  readonly lastCleanupReason: PhoneHubLinkStateEvent['reason'] | null;
  readonly cascadeCount: number;
  readonly revokedGuestSessions: number;
  readonly revokedGrants: number;
}

const _telemetry = {
  lastState: null as PhoneHubLinkStateEvent['state'] | null,
  lastReason: null as PhoneHubLinkStateEvent['reason'] | null,
  lastEpoch: null as number | null,
  lastCleanupReason: null as PhoneHubLinkStateEvent['reason'] | null,
  cascadeCount: 0,
  revokedGuestSessions: 0,
  revokedGrants: 0,
};

/** LAB salt-okunur — parmak izi, token, payload, kripto materyali TAŞIMAZ. */
export function getPhoneLinkLifecycleTelemetry(): PhoneLinkLifecycleTelemetry {
  return Object.freeze({ ..._telemetry });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Durum eşlemesi — kanonik olay → attachment basamağı
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kanonik olay durumunu attachment basamağına indirger.
 *
 * Eşik `deriveUserState()` ile AYNIDIR: yalnız `ESTABLISHED` yetki verir.
 * `CONNECTING`/`AUTHENTICATING`/`DEGRADED` bağlı ama YETKİSİZDİR (`LINKED`) —
 * DEGRADED'ın ACTIVE sayılmaması F1'in kendi hükmüdür.
 */
export function linkStateToAttachment(state: PhoneHubLinkStateEvent['state']): PhoneAttachmentState {
  switch (state) {
    case 'ESTABLISHED': return 'ACTIVE';
    case 'CONNECTING':
    case 'AUTHENTICATING':
    case 'DEGRADED': return 'LINKED';
    case 'DISCONNECTED':
    case 'FAILED':
    default: return 'DETACHED';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Zincir
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkCascadeResult {
  readonly revokedGuestSessions: number;
  readonly revokedGrants: number;
  readonly removedRuntimeSessions: number;
  readonly portalStopRequested: boolean;
}

/**
 * Bir oturumun düşüşünü uygular. SENKRON kısım (1–3) güvenlik gerçeğidir ve
 * bu fonksiyon `await` görmeden ÖNCE tamamlanır.
 *
 * İdempotenttir: aynı kopuş iki kez gelirse ikincisi hiçbir şey bulamaz ve
 * sayaçlar `0` döner — çift temizlik veya hata YOKTUR.
 */
export async function applyPhoneLinkRevocationCascade(
  deviceFingerprint: string | null,
  sessionEpoch: number,
  reason: PhoneHubLinkStateEvent['reason'] = 'UNKNOWN',
): Promise<PhoneLinkCascadeResult> {
  /* ── 1–3: GÜVENLİK GERÇEĞİ (senkron, await'ten ÖNCE) ────────────────── */
  const removedRuntimeSessions = removeRuntimeSession(deviceFingerprint, sessionEpoch);
  const revokedGrants = revokeGuestGrantsFor(deviceFingerprint, sessionEpoch);
  const revokedGuestSessions = revokeGuestSessionsFor(deviceFingerprint, sessionEpoch);

  _telemetry.cascadeCount += 1;
  _telemetry.lastCleanupReason = reason;
  _telemetry.revokedGuestSessions += revokedGuestSessions;
  _telemetry.revokedGrants += revokedGrants;

  /* ── 4–5: KAYNAK (otorite ÇOKTAN düştü) ─────────────────────────────── */
  const releaser = _releaser;
  /* Başka geçerli guest session kaldıysa DİĞER telefonun akışı kapatılmaz
     (F4.7 Race E / F4.10). */
  const portalStopRequested = !hasActiveGuestSession();
  if (releaser !== null) {
    if (portalStopRequested) {
      await releaser.closeStreams().catch(() => {});
    }
    await releaser.syncPortal().catch(() => {});
  }

  /* F5 — internet ilişkisi de bırakılır. Grant ZATEN yukarıda (adım 2)
     düştü; burada yalnız gözlemci kaydı sökülür. Hiçbir ağ KAPATILMAZ. */
  if (_internetReleaser !== null && activeRuntimeSessionCount() === 0) {
    await _internetReleaser.releaseInternetAssociation().catch(() => {});
  }

  /* F6 — telefon-entegrasyon sahipliği bırakılır: rakip entegrasyonlar
     serbest kalır. Hiçbir uygulama BAŞLATILMAZ, hiçbir process'e
     DOKUNULMAZ. Timer/polling/UI olayı BEKLENMEZ. */
  if (_ownershipReleaser !== null && activeRuntimeSessionCount() === 0) {
    await _ownershipReleaser.releaseIntegrationOwnership().catch(() => {});
  }

  return Object.freeze({
    revokedGuestSessions, revokedGrants, removedRuntimeSessions, portalStopRequested,
  });
}

/**
 * Kanonik olayı uygular. TEK giriş noktası — native köprü de, testler de
 * buradan geçer.
 *
 * Sıra/nesil güvenliği YUTMA katmanındadır (`ingestPhoneHubLinkStateEvent`):
 * bayat nesilli bir olay BURAYA HİÇ ULAŞMAZ (F4.7 Race D).
 */
export async function handlePhoneHubLinkStateEvent(
  event: PhoneHubLinkStateEvent,
): Promise<void> {
  /* İlk kanonik olay: indeks artık TEK canlılık otoritesidir. */
  engagePhoneLinkEventMode();

  _telemetry.lastState = event.state;
  _telemetry.lastReason = event.reason;
  _telemetry.lastEpoch = event.sessionEpoch;

  const attachment = linkStateToAttachment(event.state);

  if (attachment === 'DETACHED') {
    if (event.sessionEpoch === null) {
      /* Nesli bilinmeyen kopuş hedeflenemez — sahte bir hedef UYDURULMAZ.
         Canlı kayıt zaten yoksa yapacak bir şey de yoktur. */
      const releaser = _releaser;
      if (releaser !== null && activeRuntimeSessionCount() === 0) {
        await releaser.syncPortal().catch(() => {});
      }
      return;
    }
    await applyPhoneLinkRevocationCascade(
      event.deviceFingerprint, event.sessionEpoch, event.reason);
    return;
  }

  /* Bağlı basamaklar: indeks güncellenir. Parmak izi henüz yoksa (el sıkışma
     bitmedi) kayıt AÇILMAZ — kimliksiz bir oturum yetki taşıyamaz. */
  if (event.sessionEpoch === null || event.deviceFingerprint === null) return;

  upsertRuntimeSession({
    deviceFingerprint: event.deviceFingerprint,
    sessionEpoch: event.sessionEpoch,
    attachmentState: attachment,
    /* Rol AYRI otoritenindir (`phoneLinkRole.ts`, F3.0). Burada PRIMARY
       ÜRETİLMEZ — çoklu telefon hakemliği için sahte sürücü kimliği
       kurulmaz (F4.12). */
    role: 'GUEST',
  });

  /* Yeni bir oturum kurulduğunda portal kararını da tazele — ama yalnız
     zaten geçerli bir guest session varsa bir şey değişir. */
  const releaser = _releaser;
  if (releaser !== null && attachment === 'ACTIVE') {
    await releaser.syncPortal().catch(() => {});
  }

  /* F6.1 — PRODUCTION ACTIVATION WIRING: canonical ACTIVE geçişi burada
     kanıtlanır; bu ANDA mevcut "CarOS Bağlantı Önceliği" ayarı okunup
     sahiplik politikası YENİDEN uygulanır. UI/LAB bunu SÜRMEZ — tetikleyici
     yalnız bu kanonik lifecycle olayıdır. */
  if (_ownershipReleaser !== null && attachment === 'ACTIVE') {
    await _ownershipReleaser.reconcileOwnership().catch(() => {});
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Abonelik — TEK kayıt, deterministik sökülme
 * ════════════════════════════════════════════════════════════════════════ */

let _unsubscribe: (() => void) | null = null;

/**
 * Kanonik lifecycle olayına abone olur ve zinciri bağlar. İkinci çağrı önce
 * var olan aboneliği söker (çift zincir YOK). Dönen fonksiyon sahipliği
 * çağırana verir.
 */
export function initPhoneLinkLifecycle(): () => void {
  _unsubscribe?.();
  _unsubscribe = subscribePhoneHubLinkState((event) => {
    void handlePhoneHubLinkStateEvent(event);
  });
  return () => {
    _unsubscribe?.();
    _unsubscribe = null;
  };
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkLifecycleForTest(): void {
  _unsubscribe?.();
  _unsubscribe = null;
  _releaser = null;
  _internetReleaser = null;
  _ownershipReleaser = null;
  _telemetry.lastState = null;
  _telemetry.lastReason = null;
  _telemetry.lastEpoch = null;
  _telemetry.lastCleanupReason = null;
  _telemetry.cascadeCount = 0;
  _telemetry.revokedGuestSessions = 0;
  _telemetry.revokedGrants = 0;
}
