/**
 * navClock.ts — NAV v3 · MONOTONİK SAAT OKUMA NOKTASI (F2.0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.0 · F0 `navMonotonicTime.ts` · v2 ADR-N09.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE İŞE YARAR ──────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F0 `navMonotonicTime.ts` monotonik zamanın **anlamını** (marka tipleri +
 * yaş/bayatlık matematiği) sabitler ama **saat OKUMAZ** (saf olmak zorunda).
 * Bu dosya o boşluğu kapatır: NAV v3'ün L2+ katmanları için monotonik saatin
 * **TEK okuma noktası**dır.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · Timer YOK · abonelik YOK · I/O YOK · React YOK · modül durumu YOK
 *    (yalnız yetenek tespiti için tek seferlik önbellek).
 *  · `Date.now()` bu dosyada **HİÇ** kullanılmaz.
 *  · Yeni L2+ kod (`navigation/ego/**` · `navigation/matching/**`) monotonik
 *    saati YALNIZ buradan okur (kilit test denetler).
 *
 * ── NEDEN ESKİ MODÜLLER BURAYA ZORLANMADI ────────────────────────────────
 * `gpsService` ve `navigationSessionRuntime` zaten `performance.now()`
 * kullanıyor — yani ZATEN monotonik ve DOĞRU. Onları bu dosyaya taşımak
 * davranış değiştirmeyen ama riskli bir toplu refactor olurdu; F2 bunu
 * YAPMAZ. Kilit yalnız YENİ L2 kodunu bağlar.
 *
 * ── FAIL-CLOSED ──────────────────────────────────────────────────────────
 * `performance.now` bulunamazsa (çok eski WebView) sahte bir sayaç
 * ÜRETİLMEZ: `readMonotonicNow()` `null` döner ve
 * `isMonotonicClockAvailable()` `false` olur. Monotonik saat yoksa
 * tazelik/yaş HESAPLANMAZ — uydurma yaş, yanlış konum kararı demektir.
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';
import { asMonotonic } from '../contracts/navMonotonicTime';

/** `performance.now` gerçekten var mı — tek seferlik tespit, sonra önbellek. */
let _probed = false;
let _available = false;

function _probe(): boolean {
  if (_probed) return _available;
  _probed = true;
  try {
    const p = (globalThis as { performance?: { now?: unknown } }).performance;
    _available = !!p && typeof p.now === 'function' && Number.isFinite((p.now as () => number)());
  } catch {
    _available = false;
  }
  return _available;
}

/** Monotonik saat bu ortamda okunabiliyor mu. */
export function isMonotonicClockAvailable(): boolean {
  return _probe();
}

/**
 * Monotonik "şu an". Saat yoksa `null` — **sahte sayaç ÜRETİLMEZ**.
 *
 * Çağıran `null` aldığında tazelik/yaş hesaplamamalı ve ilgili kanıtı
 * `UNAVAILABLE` işaretlemelidir (fail-closed).
 */
export function readMonotonicNow(): MonotonicMs | null {
  if (!_probe()) return null;
  try {
    const n = (globalThis as unknown as { performance: { now(): number } }).performance.now();
    return Number.isFinite(n) && n >= 0 ? asMonotonic(n) : null;
  } catch {
    return null;
  }
}

/** @internal testler arası izolasyon — yetenek tespitini sıfırlar. */
export function _resetNavClockProbeForTest(): void {
  _probed = false;
  _available = false;
}
