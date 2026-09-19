/**
 * serverClock — SUNUCU SAATİ GÖZLEMİ (MRI N-7).
 *
 * İkinci bir zaman otoritesi DEĞİLDİR: hiçbir şey planlamaz, hiçbir truth
 * üretmez. Yalnız Supabase yanıtlarının `Date` başlığından "sunucu saati −
 * yerel saat" farkını (offset) not eder ve isteyene sunucu saati TAHMİNİ verir.
 *
 * Neden gerek: head-unit duvar saati ağsız cihazlarda dakikalarca sapabilir.
 * Komut geçerliliği (TTL, zarf tazeliği) sunucu tarafından `now()` ile
 * verildiğinden, araç da aynı referansı kullanmalı; aksi hâlde meşru komut
 * "süresi doldu" diye ya da süresi dolmuş komut "geçerli" diye yorumlanır.
 *
 * Fail-closed: gözlem yoksa ya da bayatladıysa `null` döner; çağıran yerel
 * saate düşer (eski davranış) — sahte bir sunucu saati UYDURULMAZ.
 */

/** Gözlem bu yaştan sonra bayat sayılır (yoklama 15 s; 1 saat bol pay). */
export const SERVER_CLOCK_MAX_AGE_MS = 60 * 60_000;

interface Observation {
  readonly offsetMs:   number;   // sunucu − yerel
  readonly observedAt: number;   // yerel ms
  readonly source:     string;
}

let _obs: Observation | null = null;

/** SAF: `Date` başlığını ve yerel anı offset'e çevirir; okunamazsa null. */
export function parseServerDateOffset(dateHeader: string | null | undefined, localNowMs: number): number | null {
  if (!dateHeader) return null;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs) || !Number.isFinite(localNowMs)) return null;
  return serverMs - localNowMs;
}

/** Bir sunucu yanıtının `Date` başlığını not eder (çağıran: `callVehicleRpc`). */
export function observeServerDate(dateHeader: string | null | undefined, source: string, localNowMs = Date.now()): void {
  const offset = parseServerDateOffset(dateHeader, localNowMs);
  if (offset === null) return;
  _obs = Object.freeze({ offsetMs: offset, observedAt: localNowMs, source });
}

/** Sunucu saati tahmini (ms) — gözlem yok/bayat ise `null` (yerel saat uydurulmaz). */
export function getServerNowMs(localNowMs = Date.now()): number | null {
  const o = _obs;
  if (!o) return null;
  const age = localNowMs - o.observedAt;
  if (age < 0 || age > SERVER_CLOCK_MAX_AGE_MS) return null;
  return localNowMs + o.offsetMs;
}

/** Salt-okunur teşhis (CAROS LAB). */
export function getServerClockSnapshot(localNowMs = Date.now()): {
  readonly offsetMs: number | null; readonly ageMs: number | null; readonly source: string | null;
} {
  const o = _obs;
  if (!o) return { offsetMs: null, ageMs: null, source: null };
  return { offsetMs: o.offsetMs, ageMs: localNowMs - o.observedAt, source: o.source };
}

/** Yalnız test. */
export function resetServerClockForTest(): void { _obs = null; }
