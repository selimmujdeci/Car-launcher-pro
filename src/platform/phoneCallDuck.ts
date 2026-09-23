/**
 * phoneCallDuck.ts — görüşme sürerken CarOS müziği SUSAR.
 *
 * ÖNCESİ: `DuckReason 'PHONE'` (seviye 0.0, öncelik 35) hem JS `duckPolicy`
 * hem native `CarosAudioFocusManager`da tanımlıydı ama üretimde onu isteyen
 * HİÇBİR kaynak yoktu. Head-unit'lerde HFP görüşme sesi çoğu zaman Android ses
 * odağından geçmez → CarOS müziği görüşmenin ÜSTÜNDE çalmaya devam ederdi.
 *
 * SONRASI: tek gerçek sinyal `notificationService`teki arama bildirimidir
 * (category 'call' — çalan VEYA süren; "Yoksay" kartı gizler ama arama
 * sürdüğü için susma sürer). Varken TEK bir `requestDuck('PHONE')` tutulur,
 * son arama bildirimi kalkınca bırakılır.
 *
 * Seviye ve öncelik `duckPolicy`nindir, istek `duckRequest` adaptöründen
 * geçer (ikinci otorite kurulmaz). Tek yerel durum kısa bir BIRAKMA PAYIDIR:
 * saha 2026-09-23 (MIUI) çalan→süren geçişinde arama bildirimini silip 0,4 sn
 * ile 3 sn arası (cevaplayınca görüşme ekranı açılırken) sonra yeniden
 * yayınladı; pay olmasa müzik o arada bir an duyulurdu. Takılı
 * susmaya karşı savunma kaynaktadır: kaçan kaldırmalar ön plana dönüşte
 * native aktif-arama listesiyle budanır (`notificationService`).
 */
import { onNotificationState, type AppNotification } from './notificationService';
import { requestDuck, type DuckHandle } from './media/authority/duckRequest';

/** SAF — listede çalan ya da süren arama var mı. */
export function hasActiveCall(notifications: readonly AppNotification[]): boolean {
  return notifications.some((n) => n.category === 'call');
}

/** Son arama kalktıktan sonra bırakmadan önceki bekleme (silip-yayınlama boşluğu). */
export const CALL_DUCK_RELEASE_GRACE_MS = 5000;

let _handle: DuckHandle | null = null;
let _unsub: (() => void) | null = null;
let _releaseTimer: ReturnType<typeof setTimeout> | null = null;

function _cancelRelease(): void {
  if (_releaseTimer !== null) { clearTimeout(_releaseTimer); _releaseTimer = null; }
}

function _releaseNow(): void {
  _cancelRelease();
  if (_handle) { const h = _handle; _handle = null; h.release(); }
}

export function stopPhoneCallDuck(): void {
  if (_unsub) { const u = _unsub; _unsub = null; try { u(); } catch { /* ignore */ } }
  _releaseNow();
}

/** İdempotent — ikinci çağrı öncekini söker. Dönen fonksiyon sahipliği verir. */
export function startPhoneCallDuck(): () => void {
  stopPhoneCallDuck();
  _unsub = onNotificationState((s) => {
    const active = hasActiveCall(s.notifications);
    if (active) {
      _cancelRelease();                                   // geçiş boşluğu → aynı istek sürer
      if (_handle === null) _handle = requestDuck('PHONE');
    } else if (_handle !== null && _releaseTimer === null) {
      _releaseTimer = setTimeout(_releaseNow, CALL_DUCK_RELEASE_GRACE_MS);
    }
  });
  return stopPhoneCallDuck;
}
