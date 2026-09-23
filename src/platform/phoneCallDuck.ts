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
 * Kendi durum/seviye/timer'ı YOKTUR: seviye ve öncelik `duckPolicy`nindir,
 * istek `duckRequest` adaptöründen geçer (ikinci otorite kurulmaz). Takılı
 * susmaya karşı savunma kaynaktadır: kaçan kaldırmalar ön plana dönüşte
 * native aktif-arama listesiyle budanır (`notificationService`).
 */
import { onNotificationState, type AppNotification } from './notificationService';
import { requestDuck, type DuckHandle } from './media/authority/duckRequest';

/** SAF — listede çalan ya da süren arama var mı. */
export function hasActiveCall(notifications: readonly AppNotification[]): boolean {
  return notifications.some((n) => n.category === 'call');
}

let _handle: DuckHandle | null = null;
let _unsub: (() => void) | null = null;

export function stopPhoneCallDuck(): void {
  if (_unsub) { const u = _unsub; _unsub = null; try { u(); } catch { /* ignore */ } }
  if (_handle) { const h = _handle; _handle = null; h.release(); }
}

/** İdempotent — ikinci çağrı öncekini söker. Dönen fonksiyon sahipliği verir. */
export function startPhoneCallDuck(): () => void {
  stopPhoneCallDuck();
  _unsub = onNotificationState((s) => {
    const active = hasActiveCall(s.notifications);
    if (active && _handle === null) {
      _handle = requestDuck('PHONE');
    } else if (!active && _handle !== null) {
      const h = _handle;
      _handle = null;
      h.release();
    }
  });
  return stopPhoneCallDuck;
}
