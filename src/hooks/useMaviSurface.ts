/**
 * useMaviSurface — **MAVİ F11 · kanonik yüzey durumunun React köprüsü.**
 *
 * `useLivingThemeState` ile BİREBİR aynı desen: mevcut tek-otoritelerden SALT
 * OKUR ve saf `deriveMaviSurface` ile türetir. **Hiçbir şey UYGULAMAZ:**
 * DOM yazımı YOK · store yazımı YOK · komut dispatch YOK · yeni timer YOK ·
 * yeni abonelik YOK (yalnız mevcut `useVoiceState` / `useWakeWordState`).
 *
 * Kaynaklar (hepsi mevcut, tek-otorite):
 *   ses durumu    → `voiceService.useVoiceState()`
 *   wake          → `wakeWordService.useWakeWordState()`
 *   iş yükü       → `maviWorkload.currentMaviWorkload()` (F8)
 *   hareket       → `maviVehicleContext.currentMaviVehicleContext()` (M2)
 *   onay          → `pendingActionConfirmation.peekPendingAction()` (M4)
 *   süren iş      → `maviSpeech` semantik ACK bayrağı (F2 — ara söz DEĞİL)
 *   proaktif      → `proactivePolicyEngine.isProactiveDeliveryInFlight()` (F9)
 *   erteleme      → `maviWorkload.peekDeferredResponse()` (F8)
 *   yetenek kaybı → `navigator.onLine` + `aiHealth` + sağlayıcı soğuması
 *
 * **UI OTORİTE DEĞİLDİR:** bu hook hiçbir kaynağa YAZMAZ ve hiçbir eşiği
 * YENİDEN HESAPLAMAZ; yalnız okur ve saf modele verir.
 */

import { useEffect, useMemo, useState } from 'react';
import { useVoiceState } from '../platform/voiceService';
import { useWakeWordState } from '../platform/wakeWordService';
import {
  currentMaviWorkload, peekDeferredResponse,
} from '../platform/assistant/maviWorkload';
import { currentMaviVehicleContext } from '../platform/assistant/maviVehicleContext';
import { peekPendingAction } from '../platform/action/pendingActionConfirmation';
import { getMaviSpeechDiagnostics } from '../platform/assistant/maviSpeech';
import { isProactiveDeliveryInFlight } from '../platform/assistant/proactivePolicyEngine';
import { getAiHealthSnapshot } from '../platform/aiHealth';
import {
  deriveMaviSurface, noteMaviSurface,
  type MaviDegradedClass, type MaviSurfaceView,
} from '../platform/assistant/maviSurfaceState';

/** Her okuma AYRI try/catch — bir kaynak düşerse yüzey ÇÖKMEZ (fail-soft). */
function _safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined || v === null ? fallback : v;
  } catch { return fallback; }
}

/**
 * Yetenek kaybı sınıfı — **öncelik sırası dürüstlük sırasıdır.**
 * Ağ yoksa bunu söylemek, "bulut yanıt vermiyor" demekten daha doğrudur.
 * Hiçbir dal "AI çalışmıyor" demez; her dal ayakta kalanı bildirir.
 */
function _deriveDegraded(online: boolean): MaviDegradedClass {
  if (!online) return 'OFFLINE';
  const health = _safe(() => getAiHealthSnapshot(), null);
  if (health && health.healthy === false) return 'CLOUD_UNAVAILABLE';
  return 'NONE';
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * Kanonik Mavi yüzey durumu. Yeniden hesaplama YALNIZ ses/wake durumu ya da
 * çevrimiçilik değişince olur — poll YOK, `setInterval` YOK.
 */
export function useMaviSurface(): MaviSurfaceView {
  const voice = useVoiceState();
  const wake = useWakeWordState();
  const online = useOnlineStatus();

  return useMemo(() => {
    const workload = _safe(() => currentMaviWorkload().level, 'UNKNOWN' as const);
    const motionState = _safe(
      () => currentMaviVehicleContext().motionState ?? 'unknown', 'unknown' as const,
    );
    const pendingConfirmation = _safe(() => peekPendingAction() !== null, false);
    /* "Süren iş" kanıtı SEMANTİK ACK'tir ("Araç sistemleri taranıyor") — bu
       gerçek ve süren bir işin BAŞLADIĞINI bildirir. F2 ara sözü DEĞİLDİR ve
       burada bir düşünme göstergesine ÇEVRİLMEZ. */
    const actionInFlight = _safe(() => getMaviSpeechDiagnostics().progressedThisTurn, false);
    const proactiveInFlight = _safe(() => isProactiveDeliveryInFlight(), false);
    /* Bayatlık kararı `maviWorkload` otoritesindedir; süresi dolmuş erteleme
       ZATEN `null` döner → bayat öneri yüzeyde GÖSTERİLEMEZ. */
    const deferredPending = _safe(
      () => peekDeferredResponse(typeof performance !== 'undefined' ? performance.now() : 0) !== null,
      false,
    );

    const view = deriveMaviSurface({
      voiceStatus: voice.status,
      followUp: voice.followUp === true,
      hasError: typeof voice.error === 'string' && voice.error.length > 0,
      wakeArmed: wake.enabled === true,
      workload,
      motionState,
      pendingConfirmation,
      actionInFlight,
      proactiveInFlight,
      deferredPending,
      degraded: _deriveDegraded(online),
    });

    noteMaviSurface(view);              // bounded gözlem — PII YOK
    return view;
  }, [voice.status, voice.followUp, voice.error, wake.enabled, online]);
}
