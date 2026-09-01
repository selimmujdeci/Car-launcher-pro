/**
 * Passenger Service — yolcu müzik kontrolü.
 *
 * Çalışma prensibi:
 *   1. startPassenger() → native HTTP sunucu başlatır, WiFi IP + port + token döner
 *   2. QR kodu bu URL'yi kodlar → yolcu telefonda okur
 *   3. Medya durumu her 2sn'de nativeye push edilir (HTTP /state için)
 *   4. Yolcudan gelen /cmd POST'ları passengerCommand eventi olarak JS'e ulaşır
 *   5. Bu servis komutu mediaService'e yönlendirir
 */

import { useState, useEffect } from 'react';
import { isNative } from './bridge';
import { CarLauncher } from './nativePlugin';
import {
  getMediaState,
  play, pause, next, previous,
} from './mediaService';
import { logError } from './crashLogger';
/* ARCH-06/F2 — TIMER YÖNETİŞİMİ: ham `setInterval` yerine ARM tik-wheel'i.
   SAHİPLİK DEĞİŞMEDİ: geri çağrı, periyot kararı ve cleanup bu modülde
   KALIR; ARM yalnız tier/mod BÜTÇESİNİ uygular (düşük-uçta yavaşlatır,
   yüksek tier'da periyodu AYNEN korur). Yeni merkezî callback mantığı YOK. */
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';

/* ── Types ───────────────────────────────────────────────── */

export interface PassengerSession {
  url:     string;
  active:  boolean;
}

/* ── Module state ────────────────────────────────────────── */

let _session:  PassengerSession | null = null;
/** ARM görev kaydını söken thunk. */
let _stateTimer: (() => void) | null = null;
let _cmdHandle: { remove: () => void } | null = null;

const _listeners = new Set<(s: PassengerSession | null) => void>();

function push(s: PassengerSession | null): void {
  _session = s;
  _listeners.forEach((fn) => fn(s));
}

/* ── Medya durumu push ────────────────────────────────────── */

function pushMediaState(): void {
  if (!isNative) return;
  const ms = getMediaState();
  CarLauncher.updatePassengerState({
    title:   ms.track.title,
    artist:  ms.track.artist,
    appName: ms.activeAppName,
    playing: ms.playing,
  }).catch((e: unknown) => logError('passenger:updatePassengerState', e));
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Yolcu sunucusunu başlatır.
 * Demo modda fake bir URL döner (native olmadan test için).
 */
export async function startPassenger(): Promise<PassengerSession> {
  await stopPassenger();

  if (!isNative) {
    const demoSession: PassengerSession = {
      url:    'http://192.168.1.100:8765/panel?t=demo1234567890ab',
      active: true,
    };
    push(demoSession);
    return demoSession;
  }

  const result = await CarLauncher.startPassengerServer();
  const url = `http://${result.ip}:${result.port}/panel?t=${result.token}`;

  // Yolcu komutlarını dinle → mediaService'e yönlendir
  const handle = await CarLauncher.addListener('passengerCommand', (data) => {
    switch (data.action) {
      case 'play':     play();     break;
      case 'pause':    pause();    break;
      case 'next':     next();     break;
      case 'previous': previous(); break;
    }
  });
  _cmdHandle = handle;

  // Medya durumunu her 2sn'de bir nativeye push et
  pushMediaState();
  _stateTimer = runtimeManager.scheduleTask({
    id: 'passenger.stateSync', periodMs: 2_000,       /* ARM sözlüğü YALNIZ 'SAFETY' | 'NORMAL' taşır. 'NORMAL' zaten
         tier/mod çarpanına TABİ olan sınıftır — bütçelenebilir görev
         tam olarak budur. ARM API'si F2'de GENİŞLETİLMEDİ. */
      criticality: 'NORMAL',
    fn: pushMediaState, deferIdle: true,
  });

  const session: PassengerSession = { url, active: true };
  push(session);
  return session;
}

/** Yolcu sunucusunu durdurur ve kaynakları temizler. */
export async function stopPassenger(): Promise<void> {
  if (_stateTimer) { _stateTimer(); _stateTimer = null; }   // ARM unschedule thunk
  if (_cmdHandle)  { _cmdHandle.remove();         _cmdHandle  = null; }

  if (isNative) {
    await CarLauncher.stopPassengerServer().catch((e: unknown) => logError('passenger:stopPassengerServer', e));
  }

  push(null);
}

export function getPassengerSession(): PassengerSession | null {
  return _session;
}

/* ── React hook ──────────────────────────────────────────── */

export function usePassengerSession(): PassengerSession | null {
  const [session, setSession] = useState<PassengerSession | null>(_session);
  useEffect(() => {
    setSession(_session);
    _listeners.add(setSession);
    return () => { _listeners.delete(setSession); };
  }, []);
  return session;
}
