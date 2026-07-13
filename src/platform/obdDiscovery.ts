/**
 * OBD cihaz keşif sınıflandırması — TEK kaynak.
 *
 * ZERO-TRUST: Bir cihaz, LEHİNE kanıt olduğu için OBD adayıdır — aleyhine kanıt
 * bulunmadığı için DEĞİL. Eski `looksLikeObd` bunun tersini yapıyordu: "isim yok"
 * durumunu OBD kanıtı sayıyordu. Native taraf isim çekemediğinde `name = address`
 * yazdığı için (bkz. BleObdScanner/CarLauncherPlugin), bu kural çevredeki İSİMSİZ
 * TÜM BLE cihazlarını (telefon, kulaklık, saat, beacon — çoğu gizlilik için MAC
 * rotasyonu yapar) "OBD" olarak etiketliyordu.
 *
 * Sınıflandırma hem OBDConnectModal (liste + rozet) hem findBestObdDevice (otomatik
 * seçim) tarafından kullanılır → iki yol aynı kararı verir.
 */

/** Bir cihazın OBD adaptörü olduğuna dair kanıt düzeyi. */
export type ObdConfidence =
  | 'verified'  // Bu adresten GERÇEK OBD verisi aktı (handshake/canlı PID) — kanıtlanmış.
  | 'likely'    // Güçlü pozitif kanıt: OBD ismi veya bilinen OBD servis UUID'si.
  | 'possible'  // Zayıf kanıt: isimsiz ama OBD olması FİZİKSEL olarak mümkün (bkz. aşağıda).
  | 'unlikely'; // Kanıt yok veya aleyhte kanıt → OBD listesinde gösterilmez.

// Bilinen OBD marka/ürün isimleri + generic SPP/BLE serial adları.
const OBD_REGEX = /obd|elm|v.?link|obdii|obd2|kw\d{3}|veepeak|icar|vgate|konnwei|obdlink|carscanner|xtool|autel|launch|thinkcar|viecar|bafx|panlong|ediag|carista|tonwon|topdon|ancel|nexas|foseal|spp[-_ ]?dev|ble[-_ ]?spp|mini\s*obd/i;

// Kesin OBD OLMAYAN cihazlar — telefon / kulaklık / saat / TV / araç multimedya.
const NON_OBD_REGEX = /iphone|ipad|airpod|airpods|galaxy\s*(buds|watch)|pixel\s*(buds|watch)|mi\s*band|mi\s*watch|honor\s*band|headset|earbud|speaker|tv|chromecast|laptop|mouse|keyboard|smartwatch|fitbit|huawei\s*watch|samsung\s*(tv|tab)|microntek|kswcar|fyt|car\s*play/i;

/**
 * BLE OBD adaptörlerinde yaygın GATT servis UUID'leri (16-bit kısa biçim).
 *   FFF0 / FFE0 — HM-10 ve türevi seri köprü çipleri (ELM327 BLE klonlarının çoğu)
 *   18F0        — Vgate iCar / vLinker ailesi
 *   FFE5 / FFF6 — bazı Konnwei / Viecar klonları
 * Bu UUID'ler OBD'ye ÖZEL değildir (jenerik seri köprü çipleridir) ama isimsiz bir
 * cihazda bulunmaları anlamlı bir pozitif sinyaldir → 'likely'.
 */
const OBD_SERVICE_UUIDS_16 = new Set(['fff0', 'ffe0', '18f0', 'ffe5', 'fff6']);

/** 128-bit UUID'den 16-bit kısa biçimi çıkarır ("0000fff0-0000-1000-8000-..." → "fff0"). */
function shortUuid(uuid: string): string {
  const u = uuid.trim().toLowerCase();
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(u);
  if (m) return m[1];
  if (/^[0-9a-f]{4}$/.test(u)) return u;
  return u;
}

/** Reklam edilen servis UUID'lerinden herhangi biri bilinen bir OBD köprü servisi mi? */
function hasObdServiceUuid(uuids: readonly string[] | undefined): boolean {
  if (!uuids || uuids.length === 0) return false;
  return uuids.some((u) => OBD_SERVICE_UUIDS_16.has(shortUuid(u)));
}

/**
 * Bir BT adresinin GERÇEK (global, IEEE tahsisli) donanım adresi olup olmadığı.
 *
 * IEEE 802 unicast + globally-unique MAC'te ilk baytın en düşük iki biti sıfırdır:
 *   bit0 (I/G) = 1 → multicast — bir cihazın kendi adresi ASLA böyle olmaz
 *   bit1 (U/L) = 1 → locally administered — IEEE tahsisli OUI değil
 * BLE gizlilik adresleri (random static / resolvable / non-resolvable private) bu
 * bitleri set eder. Yani "false" → adres uydurulmuş/rotasyonlu → tüketici cihazı.
 *
 * NOT: Bu bir HEURİSTİKtir, adres tipi bayrağının yerine geçmez (Android'de
 * BluetoothDevice.getAddressType() API 35+). Yalnızca bir cihazı ELEMEK için
 * kullanılır, doğrulamak için değil.
 */
export function isGlobalHardwareAddress(address: string): boolean {
  const hex = address.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length < 2) return false;
  const firstOctet = parseInt(hex.slice(0, 2), 16);
  if (Number.isNaN(firstOctet)) return false;
  const igBit = firstOctet & 0b01;       // multicast
  const ulBit = (firstOctet >> 1) & 0b01; // locally administered
  return igBit === 0 && ulBit === 0;
}

/** İsim gerçek bir cihaz adı mı, yoksa native'in "isim yok" ikamesi mi (MAC/hex)? */
function isPlaceholderName(name: string, address: string): boolean {
  const n = name.trim();
  if (!n) return true;                                   // isim hiç yok
  if (n.toUpperCase() === address.toUpperCase()) return true; // native name=address yazdı
  if (/^[0-9A-F:-]{8,}$/i.test(n)) return true;          // sadece hex/MAC karakterleri
  return false;
}

export interface ObdCandidate {
  name:          string;
  address:       string;
  /** Native taraftan gelir; yoksa 'classic' varsayılır (eski plugin geriye dönük). */
  transport?:    'classic' | 'ble';
  /** BLE reklam paketinde duyurulan GATT servis UUID'leri (varsa). */
  serviceUuids?: readonly string[];
}

/**
 * Bir cihazın OBD adaptörü olduğuna dair kanıt düzeyini belirler.
 *
 * Kural sırası (ilk eşleşen kazanır):
 *  1. Bu adresten daha önce GERÇEK OBD verisi aktı        → 'verified'
 *  2. İsim bilinen bir NON-OBD ürüne işaret ediyor        → 'unlikely'
 *  3. İsim OBD regex'ine uyuyor                           → 'likely'
 *  4. Bilinen OBD servis UUID'si reklam ediliyor          → 'likely'  (isimsiz klonu kurtarır)
 *  5. İsim var ama tanınmıyor                             → 'unlikely'
 *  6. İsimsiz + BLE + rotasyonlu/yerel adres              → 'unlikely' ← ASIL DÜZELTME
 *  7. İsimsiz + BLE + global donanım adresi               → 'possible'
 *  8. İsimsiz + Classic BT                                → 'possible'
 *
 * (6) neden: BLE reklamlarında isim yaymamak TÜKETİCİ cihazların normudur ve bu
 * cihazlar gizlilik için rotasyonlu adres kullanır. Gerçek BLE OBD adaptörleri ise
 * ya isim ya da servis UUID'si duyurur (bkz. 3/4) — ikisini de yapmayan, üstelik
 * uydurma adresli bir cihaz OBD adaptörü DEĞİLDİR.
 *
 * (8) neden: Classic BT inquiry'de isim yanıtı GERÇEKTEN gelmeyebilir (ELM327
 * klonlarında sık) ve Classic adres her zaman gerçek donanım MAC'idir → aday kalır.
 */
export function classifyObdDevice(
  dev: ObdCandidate,
  verifiedAddresses?: ReadonlySet<string>,
): ObdConfidence {
  const name    = (dev.name ?? '').trim();
  const address = dev.address ?? '';

  if (verifiedAddresses?.has(address.toUpperCase())) return 'verified';

  const named = !isPlaceholderName(name, address);

  if (named && NON_OBD_REGEX.test(name)) return 'unlikely';
  if (named && OBD_REGEX.test(name))     return 'likely';
  if (hasObdServiceUuid(dev.serviceUuids)) return 'likely';
  if (named) return 'unlikely';   // gerçek isim var ama OBD'ye benzemiyor

  // ── Buradan aşağısı: İSİMSİZ cihazlar ──
  if (dev.transport === 'ble' && !isGlobalHardwareAddress(address)) return 'unlikely';
  return 'possible';
}

/** OBD listesinde gösterilmeye değer mi (kanıt düzeyi 'unlikely' değil mi)? */
export function looksLikeObd(
  dev: ObdCandidate,
  verifiedAddresses?: ReadonlySet<string>,
): boolean {
  return classifyObdDevice(dev, verifiedAddresses) !== 'unlikely';
}

/** Kanıt düzeyi sıralaması — güçlü kanıt listede önce gelir. */
export const CONFIDENCE_RANK: Record<ObdConfidence, number> = {
  verified: 0,
  likely:   1,
  possible: 2,
  unlikely: 3,
};

/**
 * Taranmış cihazlardan otomatik bağlantı için EN İYİ adayı seçer.
 *
 * En yüksek kanıt düzeyine sahip cihazı döner ('verified' > 'likely' > 'possible').
 * Hiçbir aday yoksa **null** — `devices[0]` fallback'i YOKTUR (yanlış cihaza bağlanma).
 *
 * KRİTİK: Eski sürümde `looksLikeObd` isimsiz her cihaza `true` dediği için
 * `find()` pratikte `devices[0]`'a çöküyordu — yani "fallback yok" koruması
 * fiilen etkisizdi. Artık eleme gerçek kanıta dayanıyor.
 */
export function findBestObdDevice<T extends ObdCandidate>(
  devices: readonly T[],
  verifiedAddresses?: ReadonlySet<string>,
): T | null {
  let best: T | null = null;
  let bestRank = CONFIDENCE_RANK.unlikely;

  for (const dev of devices) {
    const rank = CONFIDENCE_RANK[classifyObdDevice(dev, verifiedAddresses)];
    if (rank < bestRank) {
      best = dev;
      bestRank = rank;
      if (rank === CONFIDENCE_RANK.verified) break; // daha iyisi olamaz
    }
  }
  return best;
}
