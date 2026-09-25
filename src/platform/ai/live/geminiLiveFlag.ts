/**
 * geminiLiveFlag — Gemini Live birincil yol ŞALTERİ.
 *
 * Ürün kararı DEĞİŞTİ (2026-09-25, kullanıcı): Live VARSAYILAN KAPALI.
 * Live cevabı kendi sesiyle (Gemini "Sulafat") konuşuyor; geri kalan HER şey
 * ("Buradayım", onaylar, REST cevapları) Edge "Emel" sesiyle → sürücü iki
 * farklı asistan duyuyordu ve Live sesini beğenmedi. Tek ses = Emel.
 *   · yerel `mavi.geminiLive.enabled` = 'true'  → açık (cihazda bilinçli deneme)
 *   · yerel `mavi.geminiLive.enabled` = 'false' → kapalı
 *   · uzak `mavi_gemini_live_off` = true         → kapalı (filo geri alma)
 *   · aksi hâlde KAPALI.
 *
 * Kapalıyken zincir BİREBİR eski dizidir (Live adayı hiç kurulmaz); REST/
 * OpenRouter/Claude/offline davranışı değişmez.
 */

import { getFlag } from '../../remoteConfigService';

export const GEMINI_LIVE_LOCAL_FLAG      = 'mavi.geminiLive.enabled';
export const GEMINI_LIVE_REMOTE_OFF_FLAG = 'mavi_gemini_live_off';

let _cached: boolean | null = null;

function readLocal(): boolean | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(GEMINI_LIVE_LOCAL_FLAG);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  } catch { return null; }
}

export function isGeminiLiveEnabled(): boolean {
  if (_cached !== null) return _cached;
  const local = readLocal();
  if (local !== null) { _cached = local; return local; }
  // Uzak kapatma okunur (filo kanıtı için) ama varsayılan zaten KAPALI.
  try { void getFlag(GEMINI_LIVE_REMOTE_OFF_FLAG); } catch { /* fail-soft */ }
  _cached = false;
  return _cached;
}

/** @internal — testler / ayar değişimi sonrası yeniden türetme. */
export function _resetGeminiLiveFlagForTest(): void { _cached = null; }
