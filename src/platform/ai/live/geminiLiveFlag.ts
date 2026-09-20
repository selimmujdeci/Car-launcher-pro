/**
 * geminiLiveFlag — Gemini Live birincil yol ŞALTERİ.
 *
 * Ürün kararı (2026-09-21): Live VARSAYILAN AÇIK — Mavi'nin birincil online
 * konuşma yolu. Bu dosya yalnız KAPATMA/ZORLAMA kapısıdır:
 *   · yerel `mavi.geminiLive.enabled` = 'false' → kapalı (cihazda hızlı geri alma)
 *   · yerel `mavi.geminiLive.enabled` = 'true'  → açık (uzak kapatmayı ezer)
 *   · uzak `mavi_gemini_live_off` = true         → kapalı (filo geri alma)
 *   · aksi hâlde AÇIK.
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
  let remoteOff = false;
  try { remoteOff = getFlag(GEMINI_LIVE_REMOTE_OFF_FLAG) === true; } catch { remoteOff = false; }
  _cached = !remoteOff;
  return _cached;
}

/** @internal — testler / ayar değişimi sonrası yeniden türetme. */
export function _resetGeminiLiveFlagForTest(): void { _cached = null; }
