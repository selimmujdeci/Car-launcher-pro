/**
 * legacyEdgeIdAdapter.ts — NAV v3 · L1 · ESKİ GRAF KİMLİĞİ ↔ KANONİK `EdgeId`
 * (SAF · F1).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F1/5 · F0 `navEdgeId.ts` · v2 ADR-N07.
 *
 * SAF: I/O YOK · timer YOK · global durum YOK · React YOK · saat YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLMÜŞ GERÇEKLİK (2026-09-03, `public/maps/routing-graph.bin` okundu) ─
 * ══════════════════════════════════════════════════════════════════════════
 *   biçim      : `RTG2` (sürüm 2)
 *   düğüm      : 238 252
 *   kenar      : 295 346
 *   boyut      : 7 651 542 bayt
 *
 * Bugünkü graf **KAROLU DEĞİLDİR** — tek monolit dosyadır ve kenarların
 * kimliği, dosyadaki **sıra numarasıdır** (`0 … edgeCount-1`). Okuyucu
 * `NavigationCompute.worker.ts:_loadGraph()` içindedir ve komşuluk listesine
 * yazarken bu sırayı ATAR.
 *
 * ── BU FAZDA YAPILMAYAN ──────────────────────────────────────────────────
 * Binary format DEĞİŞTİRİLMEZ · okuyucu TAŞINMAZ · routing algoritması
 * `number` düğüm indeksleriyle çalışmaya DEVAM EDER. Bu dosya yalnız
 * **sınırda** (MapStore yüzeyinde) kimlik çevirir.
 *
 * ── KİMLİK EŞLEMESİ ──────────────────────────────────────────────────────
 * Kanonik `EdgeId = { tileId(32) | localIdx(23) | dir(1) }` (F0).
 * Monolit graf için:
 *   `tileId`   = `LEGACY_MONOLITH_TILE_ID` (ayrılmış nöbetçi)
 *   `localIdx` = kenarın dosyadaki sıra numarası
 *   `dir`      = 0 ileri (`from → to`) · 1 geri (çift yönlü kenarın ters kolu)
 *
 * ── PRECISION SÖZLEŞMESİ (pazarlıksız) ───────────────────────────────────
 *  · Sessiz kırpma (truncate) YASAK.
 *  · Aralık dışı → `RangeError` (fail-closed, gürültülü).
 *  · Round-trip kayıpsız: `toLegacy(toCanonical(i, d)) === { i, d }`.
 *  · Serialization deterministik (`edgeIdToString` — F0).
 */

import type { EdgeId } from '../../contracts/navEdgeId';
import { makeEdgeId, splitEdgeId, EDGE_ID_LOCAL_IDX_MAX } from '../../contracts/navEdgeId';

/**
 * "Bu kenar karolu bir pakete DEĞİL, monolit `routing-graph.bin`e aittir"
 * nöbetçisi.
 *
 * `0xFFFFFFFF` seçildi çünkü gerçek karo kimlikleri z9 ızgarasından gelir
 * (`2^18 = 262 144` karo) — bu değere ASLA ulaşamaz. Çakışma yapısal olarak
 * imkânsızdır.
 */
export const LEGACY_MONOLITH_TILE_ID = 0xFFFFFFFF;

/** Monolit graf için kenar sıra numarası tavanı (F0 `localIdx` 23 bit). */
export const LEGACY_MAX_EDGE_ORDINAL = EDGE_ID_LOCAL_IDX_MAX;

/**
 * Ölçülmüş kenar sayısı (2026-09-03). **Bir sınır DEĞİL**, bir kayıttır:
 * kapasite kilidi `LEGACY_MAX_EDGE_ORDINAL`dir. Bu sabit yalnız kilit testin
 * "bugünkü graf tavanın altında mı" sorusunu kanıtla yanıtlaması içindir.
 */
export const MEASURED_GRAPH_EDGE_COUNT = 295_346;
export const MEASURED_GRAPH_NODE_COUNT = 238_252;

export type LegacyEdgeDirection = 0 | 1;

export interface LegacyEdgeRef {
  /** `routing-graph.bin` kenar tablosundaki sıra numarası. */
  readonly edgeOrdinal: number;
  /** 0 = `from → to` · 1 = ters kol (çift yönlü kenar). */
  readonly dir: LegacyEdgeDirection;
}

/**
 * Eski graf kenar referansını kanonik `EdgeId`'ye çevirir.
 *
 * @throws {RangeError} sıra numarası tam sayı değilse, negatifse veya
 *         `LEGACY_MAX_EDGE_ORDINAL`i aşarsa (sessiz kırpma YASAK).
 */
export function toCanonicalEdgeId(edgeOrdinal: number, dir: LegacyEdgeDirection): EdgeId {
  if (!Number.isInteger(edgeOrdinal) || edgeOrdinal < 0 || edgeOrdinal > LEGACY_MAX_EDGE_ORDINAL) {
    throw new RangeError(
      `toCanonicalEdgeId: kenar sıra numarası aralık dışı (0..${LEGACY_MAX_EDGE_ORDINAL}): ${edgeOrdinal}`,
    );
  }
  if (dir !== 0 && dir !== 1) {
    throw new RangeError(`toCanonicalEdgeId: dir 0 veya 1 olmalı: ${dir}`);
  }
  return makeEdgeId(LEGACY_MONOLITH_TILE_ID, edgeOrdinal, dir);
}

/** `EdgeId` monolit (karosuz) graf ad alanına mı ait. */
export function isLegacyMonolithEdgeId(id: EdgeId): boolean {
  try {
    return splitEdgeId(id).tileId === LEGACY_MONOLITH_TILE_ID;
  } catch {
    return false;
  }
}

/**
 * Kanonik `EdgeId`'yi eski graf referansına geri çevirir.
 *
 * @throws {RangeError} kimlik geçersizse veya monolit ad alanına AİT DEĞİLSE.
 *         Karolu bir paket kimliğini sessizce monolit sıra numarası gibi
 *         yorumlamak, yanlış yola yanlış öznitelik demektir (v2 FMEA F08).
 */
export function toLegacyEdgeRef(id: EdgeId): LegacyEdgeRef {
  const parts = splitEdgeId(id);
  if (parts.tileId !== LEGACY_MONOLITH_TILE_ID) {
    throw new RangeError(
      `toLegacyEdgeRef: kimlik monolit ad alanına ait değil (tileId=${parts.tileId})`,
    );
  }
  return { edgeOrdinal: parts.localIdx, dir: parts.dir };
}

/**
 * Verilen kenar sayısına sahip bir grafın kanonik kimlik uzayına SIĞIP
 * sığmadığı. Sığmıyorsa `toCanonicalEdgeId` atacaktır — çağıran bunu ÖNCEDEN
 * öğrenip fail-closed davranabilir.
 */
export function graphFitsCanonicalIdSpace(edgeCount: number): boolean {
  return Number.isInteger(edgeCount) && edgeCount >= 0
    && edgeCount - 1 <= LEGACY_MAX_EDGE_ORDINAL;
}
