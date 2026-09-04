/**
 * musicVoiceWiringTelemetry.ts — MUSIC F14 · Canlı ses → F9 kablolama kanıtı.
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): ASR metni · sesli komut
 * içeriği BURAYA GİRMEZ. Yalnız hit/miss adedi, hangi kapıdan (legacy tip
 * yeniden-yönlendirme / dar-güvenli kalıp) geçtiği ve "eski çift-yürütme yolu
 * yine de çağrıldı mı" anomali sayacı tutulur.
 *
 * OTORİTE SINIRI: sayaçlar hiçbir karara GERİ BESLENMEZ — yalnız gözlem.
 * Rota/durum/iddia/gecikme F9'un KENDİ `musicIntentTelemetry`sinde ZATEN
 * tutuluyor (`dispatchMusicIntent` her çağrıda `noteIntentOutcome` yazar);
 * burada TEKRARLANMAZ — yalnız "canlı ses bu dispatch'i NASIL TETİKLEDİ"
 * bilgisi eklenir.
 */

export interface MusicVoiceWiringCounters {
  /** Bypass kapısı denendi (yerel parser null döndü ya da zaten müzik dedi). */
  bypassAttempts: number;
  /** F9 niyeti tanıdı → `dispatchMusicIntent`e devredildi. */
  bypassHits: number;
  /** F9 niyeti tanımadı/güvenli kalıp değildi → mevcut zincire (AI/yerel) düşüldü. */
  bypassMisses: number;
  /** Kapı (a): yerel parser ZATEN müzik dedi, F9 metni yeniden yorumladı. */
  legacyTypeReroute: number;
  /** Kapı (b): yerel parser hiçbir şey bulamadı, F9 kendi dar/güvenli kalıbıyla yakaladı. */
  narrowSafeBypass: number;
  /**
   * ANOMALİ SAYACI: `routeIntent`in artık compatibility-adapter'a inen müzik
   * dalı yine de çağrıldı. Beklenen değer HER ZAMAN 0'dır — >0 ise "aynı
   * komutun iki kez yürütülmesi imkânsız" güvencesinde bir BOŞLUK var demektir.
   */
  legacyRouteIntentCalls: number;
}

const counters: MusicVoiceWiringCounters = {
  bypassAttempts: 0, bypassHits: 0, bypassMisses: 0,
  legacyTypeReroute: 0, narrowSafeBypass: 0, legacyRouteIntentCalls: 0,
};

let lastGateAtMs: number | null = null;

export function noteMusicVoiceBypassAttempt(): void {
  counters.bypassAttempts += 1;
}

export function noteMusicVoiceBypassHit(reroute: 'legacy' | 'narrow_safe', atMs: number): void {
  counters.bypassHits += 1;
  if (reroute === 'legacy') counters.legacyTypeReroute += 1;
  else counters.narrowSafeBypass += 1;
  lastGateAtMs = Number.isFinite(atMs) ? atMs : null;
}

export function noteMusicVoiceBypassMiss(atMs: number): void {
  counters.bypassMisses += 1;
  lastGateAtMs = Number.isFinite(atMs) ? atMs : null;
}

/** `routeIntent`in müzik compatibility-adapter'ı çağrılırsa (beklenmez). */
export function noteLegacyRouteIntentMusicCall(): void {
  counters.legacyRouteIntentCalls += 1;
}

export interface MusicVoiceWiringSnapshot {
  readonly counters: Readonly<MusicVoiceWiringCounters>;
  readonly lastGateAtMs: number | null;
}

export function getMusicVoiceWiringTelemetry(): MusicVoiceWiringSnapshot {
  return Object.freeze({ counters: Object.freeze({ ...counters }), lastGateAtMs });
}

export function _resetMusicVoiceWiringTelemetryForTest(): void {
  (Object.keys(counters) as (keyof MusicVoiceWiringCounters)[]).forEach((k) => { counters[k] = 0; });
  lastGateAtMs = null;
}
