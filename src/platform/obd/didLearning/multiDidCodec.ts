/**
 * multiDidCodec — tek UDS 0x22 isteğinde birden fazla DID (SAF).
 *
 * Native (`ElmProtocol.readDataByIdDetailed`) çoklu istekte yalnız İLK DID'in
 * önekini (`62 D1`) soyar ve kalanı ham döndürür:
 *   `<v1> D2 <v2> D3 <v3>`
 * DID başına bayt uzunluğu biliniyorsa (tekli okumadan) kesin ayrılır. Bilinmiyorsa
 * bir sonraki DID'in yankısı aranır; yankı birden fazla yerde olabiliyorsa
 * (veri içinde aynı 2 bayt geçiyorsa) sonuç BELİRSİZDİR → `null` (uydurma yok).
 *
 * Saha ölçümü (Renault 7E0): istek başına en fazla 3 DID (tek CAN karesi).
 */

export const MAX_DIDS_PER_REQUEST = 3;

const clean = (h: string): string => h.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

/**
 * Yanıtı DID → veri-hex eşlemesine ayırır. `lengths`: DID → bayt (bilinmiyorsa yok).
 * Herhangi bir parça çözülemezse TÜM sonuç `null` (kısmi eşleme yanlış atama riski taşır).
 */
export function splitMultiDidResponse(
  dids: readonly string[], rawHex: string | null | undefined, lengths: ReadonlyMap<string, number>,
): Map<string, string> | null {
  if (typeof rawHex !== 'string' || dids.length === 0) return null;
  const hex = clean(rawHex);
  const out = new Map<string, string>();
  let pos = 0;
  for (let i = 0; i < dids.length; i++) {
    const did = dids[i]!.toUpperCase();
    if (i > 0) {
      if (hex.slice(pos, pos + 4) !== did) return null; // yankı yok → hizalama bozuk
      pos += 4;
    }
    const isLast = i === dids.length - 1;
    const known = lengths.get(did);
    let len: number;
    if (known !== undefined) {
      len = known * 2;
    } else if (isLast) {
      len = hex.length - pos;
    } else {
      const next = dids[i + 1]!.toUpperCase();
      const hits: number[] = [];
      for (let p = pos + 2; p + 4 <= hex.length; p += 2) if (hex.slice(p, p + 4) === next) hits.push(p);
      if (hits.length !== 1) return null; // belirsiz ya da yok
      len = hits[0]! - pos;
    }
    if (len <= 0 || pos + len > hex.length) return null;
    out.set(did, hex.slice(pos, pos + len));
    pos += len;
  }
  return pos === hex.length ? out : null; // artık bayt varsa hizalama şüpheli
}

/** Listeyi istek başına ≤ n DID'lik gruplara böler (sıra korunur). */
export function chunkDids(dids: readonly string[], n = MAX_DIDS_PER_REQUEST): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < dids.length; i += n) out.push(dids.slice(i, i + n));
  return out;
}

/** Ham hex → işaretsiz tamsayı (≤ 6 bayt güvenli). Boş/uzun → NaN. */
export function hexToUnsigned(h: string): number {
  const c = clean(h);
  if (c.length === 0 || c.length > 12) return NaN;
  return parseInt(c, 16);
}
