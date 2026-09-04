/**
 * navEdgeId.ts — NAV v3 · JS-GÜVENLİ KENAR KİMLİĞİ SÖZLEŞMESİ (SAF · F0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/5 · v2 ADR-N07.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK.
 * Yalnız tam sayı matematiği.
 *
 * ── NEDEN (ölçülmüş sınır) ────────────────────────────────────────────────
 * İç kenar kimliği alanları: `tileId(32) | localIdx(23) | dir(1)` = 56 bit.
 * JS `number` yalnız 53 bitte tam sayı GÜVENLİDİR (`Number.MAX_SAFE_INTEGER`).
 * 56-bitlik bir kimliği tek `number`'da tutmak → sessiz hassasiyet kaybı,
 * yanlış kenar eşleşmesi, yanlış yola yanlış hız limiti (v2 FMEA F08).
 * Ayrıca hedef donanımda eski WebView'ler var → `BigInt`'e GÜVENİLMEZ.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * Kenar kimliği DAİMA `{ hi, lo }` — iki uint32. Ham `number` kenar kimliği
 * v3 sözleşmelerinde YASAK (kilit test). Bit düzeni:
 *   bit  0        : dir        (1 bit)
 *   bit  1 .. 23  : localIdx   (23 bit)
 *   bit 24 .. 55  : tileId     (32 bit)
 * `lo` = bit 0..31 · `hi` = bit 32..55 (üst 24 bit; `hi ≤ 0xFFFFFF`).
 * Paketleme/çözme ADIMLARININ HİÇBİRİ 2^32'yi aşan bir ara sayı üretmez.
 */

/** İki uint32 hâlinde taşınan kenar kimliği. */
export interface EdgeId {
  /** Üst 24 bit (bit 32..55). `0 ≤ hi ≤ 0xFFFFFF`. */
  readonly hi: number;
  /** Alt 32 bit (bit 0..31). `0 ≤ lo ≤ 0xFFFFFFFF`. */
  readonly lo: number;
}

/** "Kenar yok" nöbetçisi — `null` yerine kullanılmaz; `null` tercih edilir. */
export const EDGE_ID_NULL: EdgeId = { hi: 0, lo: 0 } as const;

export const EDGE_ID_TILE_MAX = 0xFFFFFFFF;      // 32 bit
export const EDGE_ID_LOCAL_IDX_MAX = 0x7FFFFF;   // 23 bit
export const EDGE_ID_DIR_MAX = 1;                 // 1 bit

const POW_2_24 = 16777216;   // 2^24
const POW_2_8 = 256;         // 2^8

function _isU32(n: number): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xFFFFFFFF;
}

/**
 * Alanlardan kenar kimliği kurar. Aralık dışı girdi → `RangeError` (sessiz
 * taşma yerine gürültülü hata — yanlış kenar kimliği bir güvenlik kusurudur).
 */
export function makeEdgeId(tileId: number, localIdx: number, dir: number): EdgeId {
  if (!Number.isInteger(tileId) || tileId < 0 || tileId > EDGE_ID_TILE_MAX) {
    throw new RangeError(`makeEdgeId: tileId aralık dışı (0..${EDGE_ID_TILE_MAX}): ${tileId}`);
  }
  if (!Number.isInteger(localIdx) || localIdx < 0 || localIdx > EDGE_ID_LOCAL_IDX_MAX) {
    throw new RangeError(`makeEdgeId: localIdx aralık dışı (0..${EDGE_ID_LOCAL_IDX_MAX}): ${localIdx}`);
  }
  if (dir !== 0 && dir !== 1) {
    throw new RangeError(`makeEdgeId: dir 0 veya 1 olmalı: ${dir}`);
  }

  // packed24 = localIdx(23) << 1 | dir  → en fazla 2^24-1 (güvenli)
  const packed24 = localIdx * 2 + dir;
  // lo = packed24 | ((tileId & 0xFF) << 24)
  //   (tileId % 256) * 2^24 ≤ 255 * 2^24 ≈ 4.28e9 < 2^32 · toplam < 2^32 (güvenli)
  const lo = (packed24 + (tileId % POW_2_8) * POW_2_24) >>> 0;
  // hi = tileId >> 8  → en fazla 2^24 (güvenli, uint32)
  const hi = Math.floor(tileId / POW_2_8);

  return { hi, lo };
}

export interface EdgeIdParts {
  readonly tileId: number;
  readonly localIdx: number;
  readonly dir: 0 | 1;
}

/** Kenar kimliğini alanlarına çözer. Geçersiz `{hi,lo}` → `RangeError`. */
export function splitEdgeId(id: EdgeId): EdgeIdParts {
  if (!id || !_isU32(id.hi) || !_isU32(id.lo) || id.hi > 0xFFFFFF) {
    throw new RangeError('splitEdgeId: geçersiz EdgeId (hi/lo uint32 değil ya da hi > 0xFFFFFF)');
  }
  const tileId = id.hi * POW_2_8 + Math.floor(id.lo / POW_2_24);
  const packed24 = id.lo % POW_2_24;
  const dir = (packed24 % 2) as 0 | 1;
  const localIdx = Math.floor(packed24 / 2);
  return { tileId, localIdx, dir };
}

/** İki kenar kimliği eşit mi. */
export function edgeIdEquals(a: EdgeId | null | undefined, b: EdgeId | null | undefined): boolean {
  if (!a || !b) return false;
  return a.hi === b.hi && a.lo === b.lo;
}

/**
 * İki kimlik AYNI FİZİKSEL kenarın iki yönü mü (yalnız `dir` farklı).
 *
 * ── NEDEN GEREKLİ (F6) ───────────────────────────────────────────────────
 * Çift yönlü bir yol, yakınlık sorgusunda İKİ aday üretir (`dir 0` ve `dir 1`).
 * "Bu denetim noktası kaç FARKLI yola yakın?" sorusunu doğru cevaplayabilmek
 * için aynı yolun iki yönünü İKİ AYRI YOL saymamak gerekir; aksi hâlde her
 * çift yönlü yol yapay olarak "belirsiz" görünür ve hiçbir nokta bağlanamaz.
 *
 * Bu bir KİMLİK işlemidir: graf sıra numarasını AÇIĞA ÇIKARMAZ, yalnız
 * "aynı kenar mı" sorusunu bit düzeyinde cevaplar (`dir` bit 0'dır).
 */
export function isSameUndirectedEdge(
  a: EdgeId | null | undefined, b: EdgeId | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (!_isU32(a.hi) || !_isU32(a.lo) || !_isU32(b.hi) || !_isU32(b.lo)) return false;
  /* `dir` bit 0'dır → yalnız onu düşürüp karşılaştır (uint32 güvenli bölme). */
  return a.hi === b.hi && Math.floor(a.lo / 2) === Math.floor(b.lo / 2);
}

/** Kararlı hex metin gösterimi (`"hi:lo"`, sıfır dolgulu) — LAB / log / anahtar. */
export function edgeIdToString(id: EdgeId): string {
  const h = (id.hi >>> 0).toString(16).padStart(6, '0');
  const l = (id.lo >>> 0).toString(16).padStart(8, '0');
  return `${h}:${l}`;
}

/** `edgeIdToString` çıktısını geri çözer. Biçim dışı → `null`. */
export function edgeIdFromString(s: string): EdgeId | null {
  if (typeof s !== 'string') return null;
  const m = /^([0-9a-fA-F]{1,6}):([0-9a-fA-F]{1,8})$/.exec(s.trim());
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  if (!_isU32(hi) || !_isU32(lo) || hi > 0xFFFFFF) return null;
  return { hi, lo };
}

/** `{hi,lo}` alanlarının uint32 sınırında olduğunu doğrular (guard yardımcı). */
export function isEdgeId(v: unknown): v is EdgeId {
  if (!v || typeof v !== 'object') return false;
  const o = v as { hi?: unknown; lo?: unknown };
  return typeof o.hi === 'number' && typeof o.lo === 'number'
    && _isU32(o.hi) && _isU32(o.lo) && o.hi <= 0xFFFFFF;
}
