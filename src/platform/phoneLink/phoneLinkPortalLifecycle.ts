/**
 * phoneLinkPortalLifecycle.ts — PHONE LINK F1 · Local Music Remote Portal lifecycle SÖZLEŞMESİ.
 *
 * ── BU DOSYA NE YAPMAZ (F0 kararı) ───────────────────────────────────────────
 * Gerçek bir HTTP/WebSocket sunucusu BAŞLATMAZ/DURDURMAZ. F0 taramasında repoda
 * hiçbir local HTTP/WS server yeteneği (ne TS ne native) bulunamadı ve telefonun
 * DÜZ TARAYICISINA ulaşmak IP taşıması (WiFi AP/Direct/LAN) gerektirir — bu,
 * "Wi-Fi/data-plane bu fazda AÇILMAYACAK" kuralıyla çelişir ("Wi-Fi Direct
 * orchestration" zaten kullanıcının kendi NOT-implemented listesinde).
 *
 * Bu modül yalnız "portal ŞU AN çalışıyor OLMALI MI" kararını SAF ve
 * DETERMİNİSTİK biçimde kilitler. Gerçek transport bağlanınca bir efekt
 * katmanı bu kararın üzerine `start()/stop()` çağıracaktır — o katman F1
 * KAPSAMI DIŞINDADIR.
 *
 * ── RACE-CONDITION GÜVENLİĞİ SAF FONKSİYONDAN GELİR ─────────────────────────
 * Kasıtlı olarak İÇ DURUM TUTULMAZ (ne "RUNNING" bayrağı ne timer). Karar HER
 * ÇAĞRIDA güncel `attachmentState` + `hasActiveGuestSession`den YENİDEN
 * hesaplanır — bu yüzden "bayat RUNNING" diye bir durum YAPISAL OLARAK
 * MÜMKÜN DEĞİLDİR (Round-1 `getActiveVehicle()` ile aynı desen).
 */

import type { PhoneAttachmentState } from './phoneLinkAttachment';

export type PhoneLinkPortalState = 'STOPPED' | 'RUNNING';

export type PhoneLinkPortalStopReason =
  | 'link_detached' | 'link_not_active' | 'no_active_guest_session';

export type PhoneLinkPortalStatus =
  | { readonly state: 'RUNNING'; readonly reason: 'active_guest_session' }
  | { readonly state: 'STOPPED'; readonly reason: PhoneLinkPortalStopReason };

/**
 * Kesin sözleşme (spec madde 8):
 *   ACTIVE + guest grant + guest session + QR ⇒ portal ERİŞİLEBİLİR.
 *   DETACHED (veya guest session yok) ⇒ portal DURMALI; komutlar 401/403 olur
 *   çünkü `phoneLinkMusicRemoteAdapter` zaten aynı canlı attachment'ı sorar.
 */
export function derivePortalDesiredState(input: {
  readonly attachmentState: PhoneAttachmentState;
  readonly hasActiveGuestSession: boolean;
}): PhoneLinkPortalStatus {
  if (input.attachmentState === 'DETACHED') {
    return { state: 'STOPPED', reason: 'link_detached' };
  }
  if (input.attachmentState === 'LINKED') {
    return { state: 'STOPPED', reason: 'link_not_active' };
  }
  if (!input.hasActiveGuestSession) {
    return { state: 'STOPPED', reason: 'no_active_guest_session' };
  }
  return { state: 'RUNNING', reason: 'active_guest_session' };
}

/**
 * İki ardışık kararın GERÇEK bir geçiş mi (start/stop tetiklenmeli) yoksa
 * no-op mu olduğunu söyler — gelecekteki efekt katmanı gereksiz
 * start()/stop() çağrısı YAPMASIN diye (idempotent lifecycle).
 */
export function isPortalTransition(
  previous: PhoneLinkPortalStatus, next: PhoneLinkPortalStatus,
): boolean {
  return previous.state !== next.state;
}
