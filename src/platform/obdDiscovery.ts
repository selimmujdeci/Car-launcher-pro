/**
 * OBD cihaz keşif heuristikleri — TEK kaynak.
 *
 * `looksLikeObd` hem OBDConnectModal (manuel liste filtresi) hem findBestObdDevice
 * (otomatik direct-reconnect seçimi) tarafından kullanılır → iki yol aynı kararı verir,
 * "modalde OBD görünüyor ama otomatik yanlış cihaza bağlanıyor" tutarsızlığı elenir.
 */

// Geniş OBD anahtar kelime listesi — bilinen markalar + generic SPP/BLE serial isimleri.
const OBD_REGEX = /obd|elm|v.?link|obdii|obd2|kw\d{3}|veepeak|icar|vgate|konnwei|obdlink|carscanner|xtool|autel|launch|thinkcar|viecar|bafx|panlong|ediag|carista|tonwon|topdon|ancel|nexas|foseal|spp[-_ ]?dev|serial|ble[-_ ]?spp|mini\s*obd/i;

// Kesin OBD OLMAYAN cihazlar — telefon / kulaklık / saat / TV / araç multimedya.
const NON_OBD_REGEX = /iphone|ipad|airpod|airpods|galaxy\s*(buds|watch)|pixel\s*(buds|watch)|mi\s*band|mi\s*watch|honor\s*band|headset|earbud|speaker|tv|chromecast|laptop|mouse|keyboard|smartwatch|fitbit|huawei\s*watch|samsung\s*(tv|tab)|microntek|kswcar|fyt|car\s*play/i;

/**
 * Bir BT cihazının OBD adapter adayı olup olmadığını tahmin eder.
 *
 * - İsim yok → aday (ELM327 klonları çoğu kez ad yayınlamaz).
 * - Bilinen NON-OBD ürün (telefon/kulaklık vs.) → asla aday değil.
 * - OBD regex eşleşmesi → aday.
 * - İsim MAC adresine eşit veya sadece hex/MAC karakterleri → muhtemel OBD klonu.
 * - Aksi halde aday değil.
 */
export function looksLikeObd(name: string, address: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;                        // adsız → aday
  if (NON_OBD_REGEX.test(n)) return false;    // telefon / kulaklık vs.
  if (OBD_REGEX.test(n)) return true;
  // BT name çekilemediğinde plugin name=address yazar → muhtemelen OBD'dir.
  if (n.toUpperCase() === address.toUpperCase()) return true;
  // İsim sadece hex/MAC karakterleri ise (xx:xx veya bare hex) → muhtemel OBD.
  if (/^[0-9A-F:-]{8,}$/i.test(n)) return true;
  return false;
}

/**
 * Taranmış BT cihazları listesinden en iyi OBD adaptör adayını seçer.
 *
 * `looksLikeObd` kriterine uyan İLK cihazı döner. Hiçbiri uymuyorsa **null**.
 *
 * KRİTİK: `devices[0]` fallback'i YOKTUR. Aksi halde hiç OBD bulunmadığında
 * listedeki ilk rastgele cihaza (telefon/kulaklık) bağlanmaya çalışılır (Risk A:
 * yanlış cihaza bağlanma). Aday yoksa çağıran null'ı işleyip taramaya yönlendirmelidir.
 */
export function findBestObdDevice(
  devices: Array<{ name: string; address: string }>,
): { name: string; address: string } | null {
  return devices.find((d) => looksLikeObd(d.name, d.address)) ?? null;
}
