/** Maksimum yeniden bağlanma denemesi (sonrası mock'a düşer) */
export const MAX_RECONNECT_ATTEMPTS = 5;
/** BT cihazı bu süre içinde yanıt vermezse bağlantı iptal edilir */
export const CONNECT_TIMEOUT_MS     = 30_000; // 30 s
/** ISO 15031-5 §6.3.3: Bu süre boyunca gerçek frame gelmezse RFCOMM düşmüş sayılır */
export const STALE_THRESHOLD_MS     = 12_000; // 12 s
/** Stale watchdog kontrol aralığı */
export const WATCHDOG_INTERVAL_MS   = 5_000;  // 5 s
/** connectOBD + ısınma sonrası ilk PID için bekleme süresi */
export const DATA_GATE_TIMEOUT_MS   = 10_000; // 10 s

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
