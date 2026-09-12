/**
 * nominatimRateLimit — Nominatim ToS hız sınırının TEK OTORİTESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN AYRI MODÜL (ikinci otorite yasağı) ──────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Nominatim'in kullanım şartı **saniyede 1 istektir** ve bu sınır İSTEMCİ
 * BAŞINADIR — kaç kod yolundan çağırdığımız Nominatim'i ilgilendirmez.
 * Üründe Nominatim'e çıkan İKİ yol var:
 *   · `geocodingService` (Mavi / adres kartı zinciri) — kendi bekleyicisi VARDI
 *   · `mapService.searchPlaces` (harita arama çubuğu) — bekleyicisi **YOKTU**
 * Yani iki yüzey aynı anda arama yaptığında sınır sessizce aşılıyordu; P0-NAV-07
 * ikinci bir Nominatim geçişi eklediği için bu risk **ikiye katlanacaktı**.
 *
 * Bu projenin tekrar eden saha kusuru "aynı gerçeğin iki otoritesi"dir
 * (bkz. `poi.db`nin iki okuyucusu — P0-NAV-06/2). Bu yüzden sayaç TEK yerde
 * tutulur; `geocodingService._waitNominatim` de buraya delege eder ve kendi
 * çağrı yeri (`await _waitNominatim()`) kilitli olduğu için DEĞİŞMEZ.
 *
 * SÖZLEŞME:
 *  · THROW ETMEZ.
 *  · Sıra KORUNUR: bekleyenler geliş sırasına göre slot alır (aç kalma yok).
 *  · Zamanlayıcı sızdırmaz — her bekleme kendi `setTimeout`unu temizler.
 */

/** İki istek arasındaki en az süre (ms). 1 sn ToS + 100 ms güvenlik payı. */
export const NOMINATIM_GAP_MS = 1_100;

/**
 * Bir SONRAKİ isteğin yapılabileceği en erken an (epoch ms).
 * Slot ALINIRKEN ileri sarılır → eşzamanlı çağrılar aynı slotu paylaşmaz.
 */
let _nextFreeAt = 0;

/**
 * Nominatim'e çıkmadan ÖNCE beklenmesi gereken süreyi bekler.
 * Çağıran, dönüşten sonra isteği yapabilir.
 */
export async function awaitNominatimSlot(): Promise<void> {
  const now = Date.now();
  /* Slot ya "şimdi" ya da sıradaki boş andır; hangisi büyükse o. */
  const slotAt = Math.max(now, _nextFreeAt);
  _nextFreeAt = slotAt + NOMINATIM_GAP_MS;   // sıradaki çağıran için REZERVE
  const wait = slotAt - now;
  if (wait <= 0) return;
  await new Promise<void>((res) => { setTimeout(res, wait); });
}

/** Test izolasyonu — sayaç testler arasında SIZMASIN. */
export function _resetNominatimRateLimitForTest(): void { _nextFreeAt = 0; }

/** Salt-okunur gözlem (CAROS LAB): şu an slot için kaç ms beklenir. */
export function readNominatimSlotDelayMs(now: number = Date.now()): number {
  return Math.max(0, _nextFreeAt - now);
}
