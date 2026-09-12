/**
 * speedSourcePolicy — HANGİ KAYNAĞIN HIZI GÖSTERİLİR (SAF politika).
 *
 * SAF: I/O · timer · `Date.now` · global durum YOK. Tüm zaman/yaş dışarıdan
 * verilir → cihazsız ve deterministik test edilir (`obdCadenceGate` ile aynı desen).
 * ZERO-ALLOCATION: nesne almaz, nesne döndürmez — yalnız `boolean`/`string` literal.
 * Sıcak yolda (3 Hz hız yayını) çağrılır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN (saha 2026-08-12, kullanıcı bildirimi) ──────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Kullanıcı: *"OBD bağlı olduğunda OBD hız verisi kullanılacak, yoksa GPS —
 * şimdi sadece GPS kullanıyor."* Ölçüm bunu doğruladı ve sebebi mekanikti:
 *
 * Eski karar bir **YARIŞTI**: her kaynağın skoru `confidence × tazelik` idi.
 *     cOBD = 0,85 × (1 − yaş / OBD_eşiği)      cGPS = 0,70 × (1 − yaş / 5 s)
 * Sahada ölçülen OBD kadansı **~4,3 s** (bkz. `obdCadenceGate` başlığındaki
 * snapshot: 102 olay / 438 s), GPS ise **1 Hz**. Sonuç:
 *
 *   · OBD paketi geldiği AN      → cOBD = 0,85  → OBD kazanır
 *   · bir sonraki pakete kadar   → cOBD ↓ 0,42  → GPS (0,63–0,70) kazanır
 *
 * Yani araç OBD'ye bağlıyken bile, iki paket arasındaki sürenin ÇOĞUNDA hız
 * GPS'ten geliyordu; üstelik kaynak saniyeler içinde OBD↔GPS arasında gidip
 * geliyordu. Bu titreme yalnız kozmetik değildir: aynı desen 2026-07-25
 * snapshot'ında sürüş/park modunu flip-flop ettirip odometreye 48 m sahte
 * mesafe yazdırmıştı.
 *
 * ── KURAL (kullanıcı kararı) ──────────────────────────────────────────────
 * **OBD bağlı ve TAZE ise OBD; değilse GPS.** Genel hâli: sabit öncelik
 * **HAL > CAN > OBD > GPS**. Karar bir yarış DEĞİL, sıralamadır → kaynak
 * titremez.
 *
 * ── POLİTİKA NEYİ BİLMEZ (sınır) ──────────────────────────────────────────
 * Bu modül güvenlik kapılarını İÇERMEZ; yalnız "uygun kaynaklar arasından
 * hangisi" sorusunu yanıtlar. Çelişki kapıları (`_hwSpeedContradicted`,
 * `_gpsGhostSpeed`) araç durumunu (RPM, ham OBD hızı) gerektirdiği için
 * worker'da kalır ve BURAYA `usable=false` olarak yansır. Yani bir kaynağın
 * elenmesi kararı hâlâ o kapılarındır — bu modül elenmiş kaynağı yalnız
 * atlar.
 *
 * ── BİLİNEN ÖDÜNÇ (dürüstlük) ─────────────────────────────────────────────
 * "Taze" sayılan bir OBD okuması, kadans gereği GPS okumasından ESKİ olabilir
 * (OBD eşiği 5–20 s arası öğrenilir, GPS 1 Hz'dir). Aracın kendi tekerlek
 * hızını, kaynak titremesine ve GPS Doppler gürültüsüne tercih etmek BİLİNÇLİ
 * bir karardır — tazelik yine de bir ÜST SINIRDIR: bayat kaynak sıraya girmez.
 */

/** Hız kaynağı kimliği — worker'daki `_SpeedSource` ile aynı küme. */
export type SpeedSourceId = 'HAL' | 'CAN' | 'OBD' | 'GPS';

/**
 * Öncelik sırası — SOLDAN SAĞA. Dışa açık ki kilit testi sırayı ELLE yazmasın.
 * GPS daima SONdur: aracın kendi ölçümü varken türev bir ölçüme düşülmez.
 */
export const SPEED_SOURCE_PRIORITY: readonly SpeedSourceId[] =
  ['HAL', 'CAN', 'OBD', 'GPS'] as const;

/**
 * Bir VAL sinyali kaynak sırasına GİREBİLİR mi?
 *
 * Üç şart: sinyal VAR (`present`) · güveni sıfırdan büyük · KENDİ tazelik
 * penceresi içinde. Pencere kaynağa özeldir; OBD'ninki sabit değil, gözlenen
 * kadanstan öğrenilir (`obdCadenceGate`) — bu yüzden dışarıdan verilir.
 *
 * `ageMs < timeoutMs` KATI karşılaştırmadır: tam eşikte sinyal BAYATTIR.
 * Saf fonksiyon.
 */
export function isSpeedSourceUsable(
  present:    boolean,
  confidence: number,
  ageMs:      number,
  timeoutMs:  number,
): boolean {
  if (!present) return false;
  if (!Number.isFinite(confidence) || confidence <= 0) return false;
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false;
  return ageMs < timeoutMs;
}

/**
 * Uygun kaynaklar arasından ÖNCELİKLİ olanı seçer. Hiçbiri uygun değilse `null`
 * ("hız bilinmiyor" — sahte 0 ÜRETİLMEZ, çağıran `null` yayar).
 *
 * Girdi primitiftir: nesne almaz/döndürmez (sıcak yol, zero-allocation).
 * Uygunluk kararı ÇAĞIRANA aittir — güvenlik kapıları oradadır (bkz. başlık).
 * Saf fonksiyon.
 */
export function pickSpeedSource(
  halOk: boolean,
  canOk: boolean,
  obdOk: boolean,
  gpsOk: boolean,
): SpeedSourceId | null {
  if (halOk) return 'HAL';
  if (canOk) return 'CAN';
  if (obdOk) return 'OBD';
  if (gpsOk) return 'GPS';
  return null;
}
