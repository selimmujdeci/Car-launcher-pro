/**
 * sonicSources.ts — MUSIC F17 · Analiz kabul girdilerinin TEK okuma katmanı.
 *
 * Desen A3–A8 ve F8 ile birebir aynıdır: senkron getter'lar, her biri kendi
 * try/catch'i içinde, hiçbir şey başlatmaz, timer kurmaz, komut göndermez.
 *
 * OTORİTE SINIRI (Cross-Domain §2 · §5): buradaki hiçbir değer BURADA
 * üretilmez. Cihaz sınıfı `deviceCapabilities`in, termal seviye
 * `thermalWatchdog`un, bellek baskısı `memoryWatchdog`un, oynatma gerçeği
 * kanonik native snapshot'ın truth'udur; bu modül YALNIZ okur.
 *
 * GİZLİLİK: parça adı · sanatçı · URI · konum BU KATMANDAN GEÇMEZ.
 */

import { getDeviceTier } from '../../deviceCapabilities';
import { getThermalLevel } from '../../thermalWatchdog';
import { getMemoryTrimEvidence } from '../../memoryWatchdog';
import { getMusicCanonicalSnapshot } from '../authority/musicCanonicalSnapshot';

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Cihaz sınıfı — okunamıyorsa `null` (fail-closed bütçe uygulanır). */
export function readDeviceTier(): 'low' | 'mid' | 'high' | null {
  return safe<'low' | 'mid' | 'high' | null>(() => getDeviceTier(), null);
}

/** 0..3 termal seviye — ölçülemiyorsa `null` (sahte 0 YOK). */
export function readThermalLevel(): 0 | 1 | 2 | 3 | null {
  return safe<0 | 1 | 2 | 3 | null>(() => {
    const v = getThermalLevel();
    return typeof v === 'number' && Number.isFinite(v) ? (v as 0 | 1 | 2 | 3) : null;
  }, null);
}

/** Bellek merdiveni seviyesi — okunamıyorsa `null`. */
export function readMemoryLevel(): string | null {
  return safe<string | null>(() => getMemoryTrimEvidence().currentLevel ?? null, null);
}

/**
 * Şu anda ses çalıyor mu — KANONİK native snapshot'tan.
 *
 * Gözlem bulunamıyorsa `true` döner: "bilmiyorum" hâlinde çalıyor VARSAYILIR,
 * böylece analiz düşük-uçta ihtiyatlı davranır (fail-closed).
 */
export function readPlaybackActive(): boolean {
  return safe<boolean>(() => getMusicCanonicalSnapshot().playing === true, true);
}
