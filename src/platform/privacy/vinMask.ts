/**
 * vinMask — VIN maskelemenin TEK OTORİTESİ (saf, bağımlılıksız).
 *
 * ── NEDEN TEK DOSYA ─────────────────────────────────────────────────────────
 * VIN maskeleme bir **gizlilik kapısıdır**. 2026-08-09 ölçümünde repoda beş ayrı
 * uygulama bulundu ve ÜÇ FARKLI derinlikte maskeliyorlardı:
 *
 *   vehicleIdentityReport  "•••345678"          → son 6 hane AÇIK
 *   longRoadModel          "…345678"            → son 6 hane AÇIK
 *   legalVehicleClass      "VF1…78"             → ilk 3 + son 2 AÇIK
 *   validationExport       "VF1**************"  → yalnız ilk 3 AÇIK
 *   remoteLogService       "VF1**************"  → yalnız ilk 3 AÇIK
 *
 * ISO 3779'da 12–17. haneler **seri numarasıdır**: aynı fabrikadan çıkan iki
 * araç yalnız orada ayrışır. Yani "son 6 hane" maskesi aracı **tekilleştirir** —
 * maskeleme değeri pratikte sıfırdır (ölçüldü: iki komşu VIN farklı çıktı verdi).
 * İlk 3 hane (WMI) yalnız üretici/bölge taşır ve iki aracı ayırmaz.
 *
 * ── KURAL ───────────────────────────────────────────────────────────────────
 * Yalnız **WMI açık** kalır; 4. haneden sonrası `*`. Tekilleştirici hane SIFIR.
 * Bu biçim ayrıca `remoteLogService` ve `validationExport` metin süzgeçlerinin
 * 17-hane VIN regex'ine **takılmaz** (`*` içerdiği için) → maske ikinci kapıdan
 * geçerken bozulmaz ve fonksiyon **idempotenttir**: `mask(mask(v)) === mask(v)`.
 *
 * Bu dosya hiçbir servisi import ETMEZ (saf) — her katman güvenle bağlanabilir.
 */

/** VIN'de asla bulunmayan harfler hariç ISO 3779 alfabesi. */
const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]+$/;

/** WMI uzunluğu — açık kalan tek bölüm. */
const WMI_LEN = 3;

/**
 * Maskeyi WMI'ye kadar açar, gerisini gizler — SAF, ASLA throw etmez.
 *
 * - string değilse / boşsa → `null` (uydurma değer YOK)
 * - 6 haneden kısaysa → tamamı `*` (kısa girdide WMI bile açılmaz)
 * - aksi hâlde → ilk 3 hane + `*` × (uzunluk − 3)
 */
export function maskVinStrict(vin: unknown): string | null {
  if (typeof vin !== 'string') return null;
  const v = vin.trim().toUpperCase();
  if (v.length === 0) return null;
  if (v.length < 6) return '*'.repeat(v.length);
  return v.slice(0, WMI_LEN) + '*'.repeat(v.length - WMI_LEN);
}

/**
 * Ekranda gösterilecek maske — değer yoksa `null` DEĞİL, dürüst `'UNKNOWN'`.
 * (Gözlemlenebilirlik kuralı: bilinmeyen alan boş bırakılmaz, işaretlenir.)
 */
export function maskVinForDisplay(vin: unknown): string {
  return maskVinStrict(vin) ?? 'UNKNOWN';
}

/**
 * Bir metnin maskelenmiş VIN olup olmadığını söyler — kilit/denetim içindir.
 * Ham VIN (17 hane, hepsi VIN alfabesinde) `false` döner.
 */
export function isMaskedVin(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (VIN_ALPHABET.test(value)) return false; // hiç `*` yok → maskelenmemiş
  return value.includes('*');
}
