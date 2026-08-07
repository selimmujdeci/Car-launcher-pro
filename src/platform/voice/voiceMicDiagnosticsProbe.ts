/**
 * voiceMicDiagnosticsProbe — MAVI-STT-LAB-1 native gözlem önbelleği (SALT-OKUNUR).
 *
 * Desen `platform/phoneHub/phoneHubHardwareProbe.ts` ile BİREBİR aynıdır:
 *   · `refreshVoiceMicDiagnostics()` → ASYNC native pull, modül önbelleğini doldurur.
 *   · `getVoiceMicDiagnostics()`     → SENKRON, YAN ETKİSİZ; yalnız önbelleği okur.
 * Yeni desen icat EDİLMEZ, yeni telemetri servisi veya kalıcı depo KURULMAZ.
 *
 * ── BU MODÜL NE YAPMAZ ──────────────────────────────────────────────────────
 * Mikrofon açmaz/kapatmaz · AudioRecord oluşturmaz · STT motoru başlatmaz/durdurmaz ·
 * wake motoruna dokunmaz · VAD eşiği veya AudioSource seçimini DEĞİŞTİRMEZ ·
 * AEC/NS/AGC aç-kapa YAPMAZ · timer/abonelik KURMAZ · disk/ağ KULLANMAZ.
 *
 * ── FAIL-SOFT ───────────────────────────────────────────────────────────────
 * Native metot yoksa (eski APK) veya çağrı patlarsa önbellek `present:false`
 * kalır → tüketici "kanıt yok" görür, SAHTE varsayılan ÜRETİLMEZ.
 */

import { CarLauncher } from '../nativePlugin';
import type { NativeVoiceMicDiagnostics } from '../nativePlugin';

/** Önbellek — modül seviyesinde tek kayıt. Başlangıçta KANIT YOK. */
let _cache: NativeVoiceMicDiagnostics = { present: false };
/** Önbelleğin JS tarafında ne zaman yazıldığı (duvar saati). 0 = hiç yazılmadı. */
let _cachedAt = 0;

/** Senkron, yan etkisiz okuma. Native'e GİTMEZ. */
export function getVoiceMicDiagnostics(): NativeVoiceMicDiagnostics {
  return _cache;
}

/** Önbelleğin JS damgası (ms). 0 = hiç tazelenmedi — "şimdi" UYDURULMAZ. */
export function getVoiceMicDiagnosticsCachedAt(): number {
  return _cachedAt;
}

/**
 * Native salt-okunur gözlemi çeker ve önbelleği tazeler.
 * Hata durumunda önbellek `present:false` yapılır (eski kanıt YANLIŞLIKLA taze
 * görünmesin diye) ve istisna YUTULUR — çağıran çökmez.
 */
export async function refreshVoiceMicDiagnostics(): Promise<NativeVoiceMicDiagnostics> {
  try {
    const fn = CarLauncher.getVoiceMicDiagnostics;
    if (typeof fn !== 'function') {
      // Eski APK: metot yok. "Kanıt yok" DÜRÜSTÇE bildirilir.
      _cache = { present: false };
      _cachedAt = Date.now();
      return _cache;
    }
    const raw = await CarLauncher.getVoiceMicDiagnostics!();
    _cache = raw && raw.present === true ? raw : { present: false };
    _cachedAt = Date.now();
    return _cache;
  } catch {
    _cache = { present: false };
    _cachedAt = Date.now();
    return _cache;
  }
}

/** @internal — testler arası izolasyon. */
export function _resetVoiceMicDiagnosticsForTest(): void {
  _cache = { present: false };
  _cachedAt = 0;
}
