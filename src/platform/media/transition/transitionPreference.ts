/**
 * transitionPreference.ts — MUSIC F20 · Geçiş TERCİHİNİN kalıcı sahibi.
 *
 * NEDEN AYRI DOSYA: tercihi okuyan/yazan tek yüzey UI'dır (Ses Deneyimi
 * paneli). Tercihi `transitionRuntime` içinde bırakmak, bir UI bileşenine
 * termal/bellek gözcüsü ve kütüphane indeksi dâhil AĞIR bir import zinciri
 * taşırdı (ölçüldü: `musicF6AudioSurface` paketi bu yüzden düştü). Sınır
 * bilinçlidir: **tercih hafiftir, politika ağırdır.**
 *
 * OTORİTE SINIRI: burası yalnız KULLANICI TERCİHİNİ tutar. Geçişin gerçekten
 * uygulanıp uygulanmayacağına `transitionModel` karar verir; native'e yazan
 * `transitionRuntime`dır. Bu dosya hiçbir komut GÖNDERMEZ.
 */

import { safeStorage } from '../../../utils/safeStorage';
import {
  DEFAULT_TRANSITION_PREFERENCE, sanitizePreference, type TransitionPreference,
} from './transitionModel';

const STORAGE_KEY = 'caros.music.transition.v1';
/** Kalıcı şema sürümü — kural değişince eski kayıt REDDEDİLİR (§13). */
export const TRANSITION_SCHEMA_VERSION = 1;

let preference: TransitionPreference | null = null;
let persistFailures = 0;
let loadRejected = 0;
const subscribers = new Set<() => void>();
/** Tercih değişince politikayı yeniden uygulayacak dinleyici (runtime kurar). */
let applyHook: (() => void) | null = null;

export function getTransitionPreference(): TransitionPreference {
  if (preference !== null) return preference;
  let raw: unknown = null;
  try { raw = safeStorage.getItem(STORAGE_KEY); } catch { raw = null; }
  if (typeof raw !== 'string' || raw.length === 0) {
    preference = DEFAULT_TRANSITION_PREFERENCE;
    return preference;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const body = parsed as { schemaVersion?: unknown; preference?: unknown };
    if (body?.schemaVersion !== TRANSITION_SCHEMA_VERSION) {
      /* Şema değişti → eski kayıt LIVE TRUTH değildir. */
      loadRejected += 1;
      preference = DEFAULT_TRANSITION_PREFERENCE;
      return preference;
    }
    preference = sanitizePreference(body.preference);
  } catch {
    loadRejected += 1;
    preference = DEFAULT_TRANSITION_PREFERENCE;
  }
  return preference;
}

/** Kullanıcı tercihini değiştirir; politika YENİDEN uygulanır (kanca varsa). */
export function setTransitionPreference(next: Partial<TransitionPreference>): void {
  preference = sanitizePreference({ ...getTransitionPreference(), ...next });
  try {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: TRANSITION_SCHEMA_VERSION, preference,
    }));
  } catch {
    /* Kalıcılık başarısız olsa da tercih OTURUM İÇİNDE geçerlidir. */
    persistFailures += 1;
  }
  subscribers.forEach((fn) => { try { fn(); } catch { /* fail-soft */ } });
  if (applyHook !== null) { try { applyHook(); } catch { /* fail-soft */ } }
}

export function subscribeTransition(listener: () => void): () => void {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

/** @internal `transitionRuntime` politikayı yeniden uygulamak için bağlanır. */
export function _setTransitionApplyHook(fn: (() => void) | null): void {
  applyHook = fn;
}

export function getPreferencePersistCounters(): {
  readonly persistFailures: number; readonly loadRejected: number;
} {
  return Object.freeze({ persistFailures, loadRejected });
}

export function _resetTransitionPreferenceForTest(): void {
  preference = null;
  persistFailures = 0;
  loadRejected = 0;
  subscribers.clear();
  applyHook = null;
}
