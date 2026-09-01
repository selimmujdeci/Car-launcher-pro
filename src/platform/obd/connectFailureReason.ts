/**
 * connectFailureReason — P0-OBD-CORE-06 · bağlantı başarısızlığının SINIFI (saf).
 *
 * ── ÖLÇÜLEN KUSUR (saha 2026-08-25) ─────────────────────────────────────────
 * `CONNECT_FAILED` sahada 17 kez düştü ama NEDENİ hiçbir yerde yoktu. Tek
 * sınıflandırıcı `classifyObdErrorReason` idi ve o, native'in fırlattığı
 * **hata MESAJINI regex'le** okuyor:
 *   · `e.getMessage()` Java'da `null` olabilir (özellikle `IOException` alt
 *     sınıfları ve reflection yolundan gelen istisnalar) → JS'e boş mesaj
 *     ulaşır → sınıf `unknown`.
 *   · Mesaj Android sürümüne/ROM'a göre değişir (K24 OEM ROM'unda
 *     "read failed, socket might closed" metni farklı) → sınıf `other`.
 * Yani ürün, kopmanın nedenini **cihaz üreticisinin metnine** bağlamıştı.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 * Native artık istisnanın SINIFINDAN (tip + sebep zinciri) türettiği bir enum
 * gönderir (`ObdFailureClass.of`) ve `obdStatus` olayında `failureClass` olarak
 * taşınır. Bu modül iki kanıtı BİRLEŞTİRİR — karar tek yerde, saf ve test edilebilir:
 *
 *   1. JS mesaj sınıflandırması KESİN bir sonuç verdiyse (ör. `resource_busy`)
 *      o kazanır — mesaj gerçekten okunabildiyse en spesifik kanıttır.
 *   2. JS `unknown`/`other` dediyse native sınıfı kullanılır — "bilinmiyor"
 *      yerine ölçülmüş bir sınıf yazılır.
 *   3. İkisi de yoksa `unknown` KALIR — sahte sınıf UYDURULMAZ.
 *
 * Native sınıf listesi KAPALIDIR: tanınmayan bir değer sessizce kabul edilmez
 * (eski/ileri APK uydurma bir dize gönderirse teşhis kirlenmezdi).
 */

/** JS mesaj sınıflandırmasının "cevap veremedim" değerleri. */
const INCONCLUSIVE_JS = new Set(['unknown', 'other']);

/**
 * Native tarafın üretebileceği bağlantı-hatası sınıfları (ObdFailureClass ile
 * BİREBİR aynı küme — iki tarafta iki liste tutulmaz, bu küme sözleşmedir).
 */
export const NATIVE_CONNECT_FAILURE_CLASSES: ReadonlySet<string> = new Set([
  'socket_closed',       // BluetoothSocket kapandı / read ret -1
  'resource_busy',       // aynı MAC'e ikinci soket (EBUSY) — çift deneme imzası
  'connection_refused',  // uzak uç reddetti
  'broken_pipe',         // yazarken hat düştü
  'read_failed',         // okuma hatası (sınıf belli, metin değil)
  'permission_denied',   // BLUETOOTH_CONNECT / SecurityException
  'device_not_found',    // adres bilinmiyor / adaptör listesinde yok
  'bt_disabled',         // adaptör kapalı
  'bond_failed',         // eşleştirme kurulamadı / zaman aşımına uğradı
  'gatt_failure',        // BLE GATT durum kodu ile düştü
  'elm_init_failed',     // soket açıldı, ELM327 init zinciri düştü
  'no_vehicle_response', // ELM bağlandı, araç 0100'e cevap vermedi
  'timeout',             // native tarafın kendi bekleme penceresi doldu
  'io_error',            // sınıfı IOException ama alt ayrım yok
  'interrupted',         // thread kesildi (bizim disconnect'imiz olabilir)
  'unknown',             // native ölçemedi — DÜRÜST boşluk
]);

/** Native sınıf değeri geçerli mi (kapalı küme + boş/undefined reddi). */
export function isNativeConnectFailureClass(v: unknown): v is string {
  return typeof v === 'string' && NATIVE_CONNECT_FAILURE_CLASSES.has(v);
}

/**
 * Bağlantı hatasının nihai sınıfı.
 *
 * @param jsReason     `classifyObdErrorReason(err)` çıktısı (mesaj tabanlı).
 * @param nativeClass  `obdStatus.failureClass` (native istisna SINIFI) — yoksa null.
 * @returns Tek bir enum dize; hiçbir kanıt yoksa `'unknown'`.
 */
export function resolveConnectFailureReason(
  jsReason: string | null | undefined,
  nativeClass: string | null | undefined,
): string {
  const js = typeof jsReason === 'string' && jsReason !== '' ? jsReason : 'unknown';
  if (!INCONCLUSIVE_JS.has(js)) return js;                 // (1) mesaj okunabildi → en spesifik
  if (isNativeConnectFailureClass(nativeClass) && nativeClass !== 'unknown') {
    return nativeClass;                                     // (2) native sınıfı devralır
  }
  return js;                                                // (3) dürüst boşluk
}
