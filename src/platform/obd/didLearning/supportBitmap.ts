/**
 * supportBitmap — UDS "desteklenen DID" maske zinciri (SAF).
 *
 * ── SAHA KANITI (2026-09-23, Renault motor ECU 7E0) ─────────────────────────
 * Bazı ECU'lar 0x20'nin katı olan DID'lerde (2000, 2020 … 22A0) Mode 01 `0100`
 * ile AYNI biçimde 4 baytlık bir destek maskesi döner: bit (31-i) → taban+i+1
 * destekli; son bit (taban+0x20) zincirin devam ettiğini söyler. Ölçüldü:
 * 2000–20FF'de maske 183 DID'i "var" dedi, kaba tarama da tam o 183'ü buldu
 * (fazla/eksik yok) → 2000→22A0 zinciri 398 DID'i birkaç saniyede verir.
 *
 * ── BU BİR STANDART DEĞİL ────────────────────────────────────────────────
 * ISO 14229-1 böyle bir tablo zorunlu kılmaz. Bu yüzden 4 baytlık bir yanıt
 * KENDİLİĞİNDEN maske SAYILMAZ: `evaluateMaskSemantics` ile maskenin "var"
 * dediği birkaç DID'in gerçekten yanıt verdiği ve "yok" dediklerinin
 * reddedildiği KANITLANMADAN zincire güvenilmez (fail-closed).
 *
 * SAF: I/O yok · timer yok · global durum yok.
 */

export const MASK_BLOCK = 0x20;

/** Maske aranacak zincir başlangıçları — üretici bağımsız, ucuz yoklama (taban başına 1 istek). */
export const DEFAULT_MASK_BASES: readonly number[] = Object.freeze([
  0x1000, 0x2000, 0x3000, 0x4000, 0x5000, 0x6000, 0x7000,
  0x8000, 0x9000, 0xA000, 0xB000, 0xC000, 0xD000, 0xE000,
]);

/** Güvenlik tavanı — bozuk/sonsuz zincir hattı meşgul etmesin (0x20 × 64 = 2048 DID). */
export const MAX_MASK_CHAIN_LENGTH = 64;

export const toDidHex = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

export function isMaskDid(did: number): boolean {
  return did % MASK_BLOCK === 0;
}

export interface ParsedSupportMask {
  readonly base: number;
  /** Maskenin "var" dediği VERİ DID'leri (bir sonraki maske DID'i HARİÇ). */
  readonly supported: readonly number[];
  /** Son bit: base+0x20 de bir maske DID'i mi (zincir devam ediyor mu). */
  readonly continues: boolean;
}

/**
 * 4 baytlık maskeyi çözer. Uzunluk tam 4 bayt değilse `null` — maske DEĞİL
 * (tahmin edilmez). Tüm bitleri sıfır maske geçerlidir (o blokta DID yok).
 */
export function parseSupportMask(base: number, dataHex: string | null | undefined): ParsedSupportMask | null {
  if (!isMaskDid(base) || typeof dataHex !== 'string') return null;
  const clean = dataHex.replace(/[^0-9A-Fa-f]/g, '');
  if (clean.length !== 8) return null;
  const word = parseInt(clean, 16) >>> 0;
  const supported: number[] = [];
  for (let i = 0; i < 31; i++) {
    if (word & (1 << (31 - i))) supported.push(base + i + 1);
  }
  const continues = (word & 1) === 1;
  return { base, supported, continues };
}

/**
 * Maskenin "var" / "yok" beyanını doğrulamak için okunacak örnek DID'ler.
 * Deterministik (test edilebilir): "var" listesinden baş/orta/son, "yok"
 * listesinden en fazla 2 tane.
 */
export function pickMaskProbes(mask: ParsedSupportMask): { claimed: number[]; unclaimed: number[] } {
  const s = mask.supported;
  const claimed = s.length === 0 ? [] : [...new Set([s[0]!, s[Math.floor(s.length / 2)]!, s[s.length - 1]!])];
  const unclaimed: number[] = [];
  for (let i = 1; i < MASK_BLOCK && unclaimed.length < 2; i++) {
    const d = mask.base + i;
    if (!s.includes(d)) unclaimed.push(d);
  }
  return { claimed, unclaimed };
}

export type ProbeOutcome = 'ok' | 'rejected' | 'no_data' | 'error';

export type MaskVerdict = 'CONFIRMED' | 'CONTRADICTED' | 'INCONCLUSIVE';

/**
 * Maske semantiği kararı. CONFIRMED için: "var" denenlerin HEPSİ `ok` VE en az
 * bir "yok" örneği `rejected` (NRC 31/12/33 gibi) — iki yönde de kanıt.
 * Hat hatası (`error`) kanıt değildir → INCONCLUSIVE.
 */
export function evaluateMaskSemantics(
  claimed: readonly ProbeOutcome[], unclaimed: readonly ProbeOutcome[],
): MaskVerdict {
  if (claimed.some((o) => o === 'error') || unclaimed.some((o) => o === 'error')) return 'INCONCLUSIVE';
  if (claimed.some((o) => o !== 'ok')) return 'CONTRADICTED';
  if (unclaimed.some((o) => o === 'ok')) return 'CONTRADICTED';
  if (claimed.length === 0) {
    // Boş maske: yalnız "yok" tarafı kanıtlanabilir.
    return unclaimed.length > 0 && unclaimed.every((o) => o === 'rejected' || o === 'no_data') ? 'CONFIRMED' : 'INCONCLUSIVE';
  }
  return unclaimed.some((o) => o === 'rejected' || o === 'no_data') ? 'CONFIRMED' : 'INCONCLUSIVE';
}
