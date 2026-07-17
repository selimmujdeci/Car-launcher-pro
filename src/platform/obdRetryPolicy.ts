/** Maksimum yeniden bağlanma denemesi (sonrası mock'a düşer) */
export const MAX_RECONNECT_ATTEMPTS = 5;
/** BT cihazı bu süre içinde yanıt vermezse bağlantı iptal edilir.
 *  15 s: ELM327 normalde <5 s'de bağlanır. Düşük tutmanın amacı, classic↔BLE
 *  otomatik fallback'inin HIZLI devreye girmesi — yanlış transport'ta 30 s
 *  beklenmez (2×15=30 s toplam, modal 75 s penceresine rahat sığar). */
export const CONNECT_TIMEOUT_MS     = 15_000; // 15 s
/**
 * ISO 15031-5 §6.3.3 TABANI — protokol sınıfının EN DÜŞÜK bayatlık eşiği.
 *
 * ⚠️ Bu bir TABANDIR, tek başına eşik DEĞİLDİR: gerçek eşik aktif poll kadansından
 * türetilir (bkz. {@link computeStaleThresholdMs}). Doğrudan kullanmak, poll periyodu
 * bu değerden büyük olan modlarda (POWER_SAVE 15s / SAFE_MODE 10s) SAHTE bayatlık
 * üretir — sahada "1-2 sn'lik bağlı/kopuk dalgalanması" kök nedeni buydu.
 */
export const STALE_THRESHOLD_MS     = 12_000; // 12 s
/** Stale watchdog kontrol aralığı */
export const WATCHDOG_INTERVAL_MS   = 5_000;  // 5 s

/* ── Kadans-türevli bayatlık eşiği (dalgalanma kök düzeltmesi) ──────────────── */

/**
 * Bayat saymadan ÖNCE kaçırılmasına izin verilen ardışık poll turu.
 * 3: tek bir kayıp frame (BT paket düşmesi / ELM327 tur atlaması) bayatlık İLAN ETMEZ;
 * üç ardışık tur sessizse gerçekten bir sorun vardır.
 */
export const STALE_MISSED_POLLS = 3;

/**
 * Kadans üstüne eklenen jitter payı (ms). ELM327 + Bluetooth gecikmesi, komut kuyruğu
 * sırası ve extended PID rotasyonunun turdan çaldığı süre için tampon.
 */
export const STALE_JITTER_MARGIN_MS = 2_000;

/**
 * Bayatlık eşiği — AKTİF poll kadansına bağlı.
 *
 * KÖK NEDEN (bu fonksiyonun varlık sebebi): `STALE_THRESHOLD_MS` (12s) sabit bir
 * protokol sabitiydi; oysa native FAST poll periyodu RuntimeMode'a göre 15s'ye kadar
 * çıkar (`computeObdPollProfile` zayıf modda `fastMs = modePollingMs` yapar —
 * POWER_SAVE 15_000 · SAFE_MODE 10_000). İki sabit birbirini HİÇ görmüyordu →
 * çekirdek PID 15s'de bir gelirken watchdog 12s'de "veri kesildi" deyip SAHTE
 * reconnect başlatıyordu → ~1-2 sn süren reconnect turu = UI dalgalanması.
 * (ATRV her ~5s'de geldiği için `_lastRealDataMs`'i koşulsuz tazeliyor ve bu çelişkiyi
 * KAZARA maskeliyordu; ECU-donma düzeltmesi maskeyi kaldırınca çelişki açığa çıktı.)
 *
 * Formül: `max(protocolFloorMs, fastMs × STALE_MISSED_POLLS + STALE_JITTER_MARGIN_MS)`
 * — eşik HER ZAMAN gerçek kadansın üstünde kalır; protokol tabanı da asla altına inilmez
 * (hızlı poll'da 12s/18s/20s taban korunur → mevcut CAN davranışı BİREBİR aynı).
 *
 * @param protocolFloorMs protokol sınıfı tabanı (CAN 12s · KWP 18s · ISO9141 20s)
 * @param fastMs          aktif native FAST poll periyodu (computeObdPollProfile.fastMs)
 */
export function computeStaleThresholdMs(protocolFloorMs: number, fastMs: number): number {
  // Fail-soft: geçersiz kadans (0/NaN/negatif) → yalnız protokol tabanına güven.
  const floor = Number.isFinite(protocolFloorMs) && protocolFloorMs > 0
    ? protocolFloorMs
    : STALE_THRESHOLD_MS;
  if (!Number.isFinite(fastMs) || fastMs <= 0) return floor;
  return Math.max(floor, fastMs * STALE_MISSED_POLLS + STALE_JITTER_MARGIN_MS);
}
/** connectOBD + ısınma sonrası ilk PID için bekleme süresi */
export const DATA_GATE_TIMEOUT_MS   = 10_000; // 10 s
/**
 * Derin yeniden bağlanma aralığı (Automotive "Always-On").
 * Üstel backoff turu (5 deneme) tükenince DOĞRULANMIŞ bir adaptör için sistem
 * pes ETMEZ; bu aralıkta bir yeni tur başlatır. Otomotiv standardı: kontak/araç
 * tekrar açıldığında (saatler sonra bile) bağlantı kendiliğinden geri gelir.
 */
export const DEEP_RECONNECT_INTERVAL_MS = 300_000; // 5 dk

/**
 * Deneme numarasına göre üstel geri-çekilme gecikmesi hesaplar.
 * Formül: 2^attempt × 2000 ms → 2 s, 4 s, 8 s, 16 s, 32 s
 */
export function getReconnectDelay(attempt: number): number {
  return Math.pow(2, attempt) * 2_000;
}

/**
 * Daha fazla yeniden bağlanma denemesi yapılıp yapılmayacağını döner.
 * MAX_RECONNECT_ATTEMPTS aşıldığında false → mock'a düş veya hata göster.
 */
export function shouldAttemptReconnect(attempt: number): boolean {
  return attempt < MAX_RECONNECT_ATTEMPTS;
}

/**
 * Son başarılı veri alımından bu yana geçen sürenin stale eşiğini aşıp
 * aşmadığını döner. RFCOMM socket sessiz drop tespiti için kullanılır.
 */
export function isDataStale(lastSeenMs: number): boolean {
  return Date.now() - lastSeenMs > STALE_THRESHOLD_MS;
}
