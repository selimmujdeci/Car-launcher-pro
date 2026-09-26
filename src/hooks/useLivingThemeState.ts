/**
 * useLivingThemeState — Living Theme System · React köprüsü (Commit 1)
 *
 * Mevcut kaynaklardan living state'i SALT OKUR ve `deriveLivingThemeState`
 * (saf) ile türetir. Hiçbir şey UYGULAMAZ:
 *   - DOM yazımı YOK · CSS YOK · store yazımı YOK · token swap YOK · animasyon YOK.
 *
 * Token/animasyon/component uygulaması sonraki commit'lerin işi. Bu hook yalnızca
 * "şu an hangi living state?" sorusunu cevaplar.
 *
 * Kaynaklar (hepsi mevcut, tek-otorite):
 *   gün/gece → useStore(settings.dayNightMode)  (useDayNightManager yazar; biz okuruz)
 *   araç     → obdService (connectionState / fuelLevel / engineTemp / lastSeenMs)
 *   bağlantı → ConnectivityAuthority (kanonik)
 *   companion→ voiceService (useVoiceState().status)
 *   seviye   → deviceCapabilities.getDeviceTier + runtimeManager.getMode + reduced-motion
 */

import { useEffect, useMemo, useState } from 'react';
import { subscribeConnectivity } from '../platform/connectivity/connectivityAuthority';
import { allowsConnectivity } from '../platform/connectivity/connectivityGate';
import { useStore } from '../store/useStore';
import {
  useOBDConnectionState,
  useOBDFuelLevel,
  getOBDStatusSnapshot,
} from '../platform/obdService';
import { useLiveVehicleSignal } from './useCanonicalVehicleSignal';
import { useVoiceState } from '../platform/voiceService';
import { getDeviceTier } from '../platform/deviceCapabilities';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import {
  deriveLivingThemeState,
  type LivingThemeState,
} from '../platform/livingThemeState';

/**
 * OBD verisi bu süreden eski ise (lastSeenMs) "stale" sayılır → obd-offline.
 * En yavaş polling POWER_SAVE 15s; tazelik penceresi onun üstünde tutulur.
 */
const OBD_FRESH_MS = 20_000;

/* ── Küçük salt-okur yardımcı hook'lar (DOM yazmaz, yalnız dinler) ── */

function useOnlineStatus(): boolean {
  /* F7-B: tarayıcının `online`/`offline` olayları DİNLENMEZ — o ipucu otorite
     değildir ve kanonik otorite onu zaten kanıt olarak yutar. UI burada yalnız
     salt-okur TÜKETİCİdir (§24): durum ÜRETMEZ, geçiş SÜRMEZ, timer AÇMAZ. */
  const [online, setOnline] = useState<boolean>(
    () => allowsConnectivity('LIGHTWEIGHT_INTERNET'),
  );
  useEffect(() => subscribeConnectivity(() => {
    setOnline(allowsConnectivity('LIGHTWEIGHT_INTERNET'));
  }), []);
  return online;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    // Eski WebView uyumu: addEventListener yoksa addListener (deprecated) fallback.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

/* ── Ana hook ────────────────────────────────────────────────── */

/**
 * Anlık Living Theme state'ini döner. Reaktif eksenler (OBD/companion/bağlantı/
 * gün-gece/reduced-motion) değiştiğinde yeniden hesaplanır. Cihaz tier'ı ve
 * runtime modu compute anında okunur (tier sabit; mod nadir değişir).
 */
export function useLivingThemeState(): LivingThemeState {
  const connectionState = useOBDConnectionState();
  const fuelLevel       = useOBDFuelLevel();
  /* P0-OBD-03: tema ekseni de bir KARARDIR (sıcak motor görünümü). Eskiden
     yalnız OBD okunuyordu → CAN'lı/OBD'siz araçta eksen hiç tetiklenmiyordu.
     `null` → `-1`: `deriveLivingThemeState` negatifi "bilinmiyor" sayar. */
  const engineTemp      = useLiveVehicleSignal('coolantTemp') ?? -1;
  const voice           = useVoiceState();
  const dayNightMode    = useStore((s) => s.settings.dayNightMode);
  const online          = useOnlineStatus();
  const reducedMotion   = usePrefersReducedMotion();

  return useMemo(() => {
    // OBD bağlı VE taze mi — stale veri obd-offline sayılır (saf fonksiyon yanlış
    // uyarı vermesin). lastSeenMs salt okunur; Date.now yalnız tazelik kontrolü.
    const snap = getOBDStatusSnapshot();
    const fresh = snap.lastSeenMs > 0 && (Date.now() - snap.lastSeenMs) < OBD_FRESH_MS;
    const obdConnected = connectionState === 'connected' && fresh;

    return deriveLivingThemeState({
      dayNightMode,
      hour:                 new Date().getHours(),
      obdConnected,
      fuelLevel,
      engineTemp,
      online,
      voiceStatus:          voice.status,
      tier:                 getDeviceTier(),
      runtimeMode:          runtimeManager.getMode(),
      prefersReducedMotion: reducedMotion,
    });
  }, [connectionState, fuelLevel, engineTemp, voice.status, dayNightMode, online, reducedMotion]);
}
