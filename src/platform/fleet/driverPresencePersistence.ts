/**
 * driverPresencePersistence.ts — PRESENCE DEFTERİNİN KALICILIK SÖZLEŞMESİ (P2).
 *
 * ── HANGİ SORUNU ÇÖZER ─────────────────────────────────────────────────
 * P1'de defter yalnız BELLEKTE yaşıyordu: uygulama yeniden başladığında
 * (head unit gece kapanır, WebView çöker, APK güncellenir) AÇIK segment ve
 * `refreshCount` KAYBOLURDU. Sürücü sabah kartını okutup öğlen uygulamayı
 * yeniden başlatınca "hiç kimse araçta değildi" görünürdü — defter, tam da
 * cevaplamak için var olduğu soruya (ne kadar kaldı?) yanlış cevap verirdi.
 *
 * ── NE YAPMAZ (BAĞLAYICI) ──────────────────────────────────────────────
 * · Kayıp bir dönemi TAHMİN ETMEZ. Yeniden başlatma sırasında geçen süre
 *   "araçtaydı" sayılmaz; segmentin TTL'i neyse odur.
 * · Bozuk/eski şemayı ONARMAYA ÇALIŞMAZ. Kısmen okunabilen bir defter,
 *   okunamayan defterden DAHA TEHLİKELİDİR (yalancı kanıt üretir) →
 *   fail-closed: gerekçesiyle birlikte tümü REDDEDİLİR.
 * · Karar üretmez: bu katman `resolveDriverPresence`'a hiçbir şey beslemez.
 *
 * ── GİZLİLİK ───────────────────────────────────────────────────────────
 * Diskte tutulan: sürücü/araç KİMLİK REFERANSI, kaynak, güven, zaman.
 * Ad, ehliyet, telefon, e-posta, konum, VIN **YOKTUR**.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 * Depolama çağrısı ÇAĞIRANDA yapılır; bu modül yalnız KODLAR/ÇÖZER.
 */

import {
  EMPTY_PRESENCE_HISTORY, PRESENCE_HISTORY_MAX_ENTRIES,
  PRESENCE_CLOSE_REASONS,
  type PresenceHistoryEntry, type PresenceHistoryState, type PresenceCloseReason,
} from './driverPresenceHistory';
import {
  isPresenceSource, isPresenceConfidence,
  type PresenceSource, type PresenceConfidence,
} from './driverPresence';

/** Depolama anahtarı — sürüm anahtarın İÇİNDEDİR (eski sürüm sessizce okunmaz). */
export const PRESENCE_SNAPSHOT_KEY = 'fleet:presenceLedger:v1';

/**
 * ŞEMA SÜRÜMÜ. Alan anlamı değişirse ARTIRILIR; eski sürüm okunmaz
 * (`VERSION_MISMATCH`) — yanlış yorumlanmış bir defter, boş defterden kötüdür.
 */
export const PRESENCE_SNAPSHOT_VERSION = 1;

/** Kalıcı anlık görüntü — diske yazılan TEK yapı. */
export interface PresenceSnapshot {
  readonly version: number;
  /** Yazılma anı (epoch ms) — restore yaşı buradan ölçülür. */
  readonly savedAtMs: number;
  /**
   * Defterin BAĞLI olduğu doğrulanmış araç kimliği; bilinmiyorsa `null`.
   * Yeniden başlatmada bağ DEĞİŞMİŞSE defter geri yüklenmez (bkz.
   * `decodePresenceSnapshot` → `VEHICLE_BINDING_CHANGED`).
   */
  readonly boundVehicleId: string | null;
  readonly history: PresenceHistoryState;
  readonly observationCount: number;
  readonly rejectedCount: number;
  readonly bindingRejectedCount: number;
}

/** Çözümleme sonucu — sessiz düşüş YOK, her ret bir GEREKÇE taşır. */
export type PresenceSnapshotDecodeReason =
  | 'EMPTY'                    // hiç yazılmamış (ilk açılış) — hata DEĞİL
  | 'PARSE_ERROR'              // JSON bozuk
  | 'VERSION_MISMATCH'         // başka şema sürümü
  | 'SCHEMA_INVALID'           // alanlar sözleşmeye uymuyor
  | 'INVARIANT_VIOLATION'      // defter kendi kurallarını çiğniyor
  | 'VEHICLE_BINDING_CHANGED'; // defter başka araca ait

export type PresenceSnapshotDecodeResult =
  | { readonly ok: true;  readonly snapshot: PresenceSnapshot }
  | { readonly ok: false; readonly reason: PresenceSnapshotDecodeReason };

/* ── Kodlama ───────────────────────────────────────────────────────────── */

export function encodePresenceSnapshot(s: PresenceSnapshot): string {
  return JSON.stringify({
    version: PRESENCE_SNAPSHOT_VERSION,
    savedAtMs: s.savedAtMs,
    boundVehicleId: s.boundVehicleId,
    observationCount: s.observationCount,
    rejectedCount: s.rejectedCount,
    bindingRejectedCount: s.bindingRejectedCount,
    history: {
      switchCount: s.history.switchCount,
      duplicateCount: s.history.duplicateCount,
      droppedCount: s.history.droppedCount,
      replayCount: s.history.replayCount,
      entries: s.history.entries.map((e) => ({
        vehicleId: e.vehicleId,
        driverId: e.driverId,
        source: e.source,
        confidence: e.confidence,
        detectedAt: e.detectedAt,
        expiresAt: e.expiresAt,
        expiredAt: e.expiredAt,
        durationMs: e.durationMs,
        closeReason: e.closeReason,
        refreshCount: e.refreshCount,
        lastDetectedAt: e.lastDetectedAt,
      })),
    },
  });
}

/* ── Çözümleme (fail-closed) ───────────────────────────────────────────── */

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function nonNegInt(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= 0 && Number.isInteger(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function isCloseReason(v: unknown): v is PresenceCloseReason {
  return typeof v === 'string' && (PRESENCE_CLOSE_REASONS as readonly string[]).includes(v);
}

/** Tek segmenti daraltır; SÖZLEŞMEYE uymuyorsa `null` (onarım YOK). */
function decodeEntry(raw: unknown): PresenceHistoryEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const driverId = str(o.driverId);
  const detectedAt = num(o.detectedAt);
  const refreshCount = nonNegInt(o.refreshCount);
  if (driverId === null || detectedAt === null || refreshCount === null) return null;
  if (!isPresenceSource(o.source) || !isPresenceConfidence(o.confidence)) return null;

  const source: PresenceSource = o.source;
  const confidence: PresenceConfidence = o.confidence;

  const expiresAt = o.expiresAt === null ? null : num(o.expiresAt);
  if (o.expiresAt !== null && expiresAt === null) return null;

  const expiredAt = o.expiredAt === null ? null : num(o.expiredAt);
  if (o.expiredAt !== null && expiredAt === null) return null;

  const durationMs = o.durationMs === null ? null : num(o.durationMs);
  if (o.durationMs !== null && durationMs === null) return null;

  const closeReason = o.closeReason === null ? null
    : isCloseReason(o.closeReason) ? o.closeReason : undefined;
  if (closeReason === undefined) return null;

  /* YARIM KAPANIŞ YASAK — DB'deki `vdph_close_consistent` ile AYNI kural:
     kapanış anı varsa süre ve gerekçe de olmalı. "Kapandı ama süresi yok"
     bir defteri sessizce yalancı yapar. */
  if (expiredAt !== null && (durationMs === null || closeReason === null)) return null;
  if (expiredAt === null && durationMs !== null) return null;
  if (expiredAt !== null && expiredAt < detectedAt) return null;
  if (expiresAt !== null && expiresAt <= detectedAt) return null;

  const lastDetectedAt = num(o.lastDetectedAt);
  if (lastDetectedAt === null || lastDetectedAt < detectedAt) return null;

  return {
    vehicleId: str(o.vehicleId),
    driverId,
    source,
    confidence,
    detectedAt,
    expiresAt,
    expiredAt,
    durationMs,
    closeReason,
    refreshCount,
    lastDetectedAt,
  };
}

/**
 * Diskteki metni anlık görüntüye çevirir.
 *
 * @param expectedVehicleId Şu anki DOĞRULANMIŞ araç kimliği. Verilirse ve
 *        defterin bağı FARKLIYSA defter geri yüklenmez: başka araca ait bir
 *        varlık geçmişini bu araca devretmek, defteri yalan yapardı.
 *        `null` geçilirse bağ denetlenmez (bağ henüz bilinmiyor).
 */
export function decodePresenceSnapshot(
  raw: string | null,
  expectedVehicleId: string | null = null,
): PresenceSnapshotDecodeResult {
  if (raw === null || raw.length === 0) return { ok: false, reason: 'EMPTY' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'PARSE_ERROR' };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, reason: 'PARSE_ERROR' };
  }

  const o = parsed as Record<string, unknown>;
  if (o.version !== PRESENCE_SNAPSHOT_VERSION) {
    return { ok: false, reason: 'VERSION_MISMATCH' };
  }

  const savedAtMs = num(o.savedAtMs);
  if (savedAtMs === null) return { ok: false, reason: 'SCHEMA_INVALID' };

  const boundVehicleId = o.boundVehicleId === null ? null : str(o.boundVehicleId);
  if (o.boundVehicleId !== null && boundVehicleId === null) {
    return { ok: false, reason: 'SCHEMA_INVALID' };
  }
  if (expectedVehicleId !== null && boundVehicleId !== null
      && boundVehicleId !== expectedVehicleId) {
    return { ok: false, reason: 'VEHICLE_BINDING_CHANGED' };
  }

  const h = o.history;
  if (h === null || typeof h !== 'object') return { ok: false, reason: 'SCHEMA_INVALID' };
  const ho = h as Record<string, unknown>;

  const switchCount = nonNegInt(ho.switchCount);
  const duplicateCount = nonNegInt(ho.duplicateCount);
  const droppedCount = nonNegInt(ho.droppedCount);
  const replayCount = nonNegInt(ho.replayCount);
  const observationCount = nonNegInt(o.observationCount);
  const rejectedCount = nonNegInt(o.rejectedCount);
  const bindingRejectedCount = nonNegInt(o.bindingRejectedCount);
  if (switchCount === null || duplicateCount === null || droppedCount === null
      || replayCount === null || observationCount === null || rejectedCount === null
      || bindingRejectedCount === null) {
    return { ok: false, reason: 'SCHEMA_INVALID' };
  }

  if (!Array.isArray(ho.entries)) return { ok: false, reason: 'SCHEMA_INVALID' };
  if (ho.entries.length > PRESENCE_HISTORY_MAX_ENTRIES) {
    return { ok: false, reason: 'INVARIANT_VIOLATION' };
  }

  const entries: PresenceHistoryEntry[] = [];
  for (const rawEntry of ho.entries) {
    const e = decodeEntry(rawEntry);
    if (e === null) return { ok: false, reason: 'SCHEMA_INVALID' };
    entries.push(e);
  }

  /* İNVARYANTLAR — DB tarafındaki kilitlerin TS karşılığı. */
  for (let i = 1; i < entries.length; i++) {
    /* Defter eskiden yeniye sıralıdır; bozuk sıra "önceki segment" ve
       "şu anki segment" kavramlarını tersine çevirirdi. */
    if (entries[i]!.detectedAt < entries[i - 1]!.detectedAt) {
      return { ok: false, reason: 'INVARIANT_VIOLATION' };
    }
  }
  /* TEK AÇIK SEGMENT: yalnız SON kayıt açık olabilir. İki açık segment
     "iki kişi aynı anda sürüyor" demektir ve bir veri hatasıdır
     (PG karşılığı: `vdph_single_open_per_vehicle`). */
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i]!.expiredAt === null && entries[i]!.closeReason === null) {
      return { ok: false, reason: 'INVARIANT_VIOLATION' };
    }
  }

  return {
    ok: true,
    snapshot: {
      version: PRESENCE_SNAPSHOT_VERSION,
      savedAtMs,
      boundVehicleId,
      history: { entries, switchCount, duplicateCount, droppedCount, replayCount },
      observationCount,
      rejectedCount,
      bindingRejectedCount,
    },
  };
}

/** Hiç kayıt yokken kullanılan boş anlık görüntü (sahte sayaç üretmez). */
export function emptyPresenceSnapshot(savedAtMs: number): PresenceSnapshot {
  return {
    version: PRESENCE_SNAPSHOT_VERSION,
    savedAtMs,
    boundVehicleId: null,
    history: EMPTY_PRESENCE_HISTORY,
    observationCount: 0,
    rejectedCount: 0,
    bindingRejectedCount: 0,
  };
}
