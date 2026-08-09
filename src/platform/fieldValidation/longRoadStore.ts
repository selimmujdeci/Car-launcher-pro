/**
 * longRoadStore.ts — SAHA DOĞRULAMA oturumunun YEREL kalıcılığı (görev §13 · §17).
 *
 * ── SINIRLAR (pazarlıksız) ──────────────────────────────────────────────────
 *  · YALNIZ YEREL. Production backend · Supabase · Firebase · uzak sunucu ·
 *    telemetri — HİÇBİRİNE gönderim YOK. Bu dosyada AĞ ÇAĞRISI BULUNMAZ.
 *  · Mevcut `safeStorage` sarmalayıcısı kullanılır (kota/bozulma dayanıklı) —
 *    yeni depolama deseni İCAT EDİLMEZ.
 *  · Anahtarlar `caros.lab.*` ad alanında → üretim kullanıcı verisiyle KARIŞMAZ.
 *  · Yazmadan ÖNCE PII süzgeci uygulanır (`sanitizeForExport`) — ikinci kapı.
 *  · Okuma ASLA throw etmez; bozuk/eski kayıt `migrateSession` ile göç eder,
 *    anlaşılamazsa `null` döner → çağıran FAIL-CLOSED davranır (yeni oturum
 *    açmaz, kullanıcıya "bozuk kayıt" der).
 *
 * ── YAZMA BÜTÇESİ (CLAUDE.md §I/O) ──────────────────────────────────────────
 * Checkpoint SANİYEDE DEĞİL, `LR_CHECKPOINT_INTERVAL_MS`te bir yazılır; ayrıca
 * oturum başlangıcı/bitişi ve kritik olaylarda ANINDA yazılır. Örnek başına
 * yazma YOKTUR — 8 saatlik yolculukta ~1000 yazım (eMMC bütçesi içinde).
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import {
  LR_BLACKBOX_KEY, LR_MAX_BLACKBOX_EVENTS, LR_MAX_SESSION_BYTES, LR_MAX_TOTAL_BYTES,
  LR_SESSION_KEY, migrateSession, purgeLegacyVinMasks, sanitizeForExport,
  type LongRoadSession, type StoragePressure,
} from './longRoadModel';
import type { BlackBoxWindow } from './longRoadBlackBox';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Oturum
 * ════════════════════════════════════════════════════════════════════════ */

export interface SaveResult {
  readonly ok: boolean;
  readonly bytes: number | null;
  /** Gövde bütçeyi aştı mı — çağıran budama yapmalı. */
  readonly overBudget: boolean;
}

/**
 * Oturumu diske yazar. ASLA throw etmez; başarısızlıkta `ok:false` döner ve
 * çağıran kullanıcıya DÜRÜST mesaj gösterir (sessiz başarı iddiası YOK).
 */
export function saveSession(session: LongRoadSession): SaveResult {
  try {
    const body = JSON.stringify(sanitizeForExport(session));
    const bytes = body.length;
    const overBudget = bytes > LR_MAX_SESSION_BYTES;
    /* Bütçe aşımında YAZMAYI REDDETMEYİZ — kanıt kaybı daha kötüdür; ama
       çağırana budama gerektiğini bildiririz. */
    safeSetRaw(LR_SESSION_KEY, body, 0, true);
    _writeStats.sessionWrites += 1;
    _writeStats.sessionBytes += bytes;
    return { ok: true, bytes, overBudget };
  } catch {
    return { ok: false, bytes: null, overBudget: false };
  }
}

export type LoadOutcome =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'OK'; readonly session: LongRoadSession }
  | { readonly kind: 'CORRUPT' };

/**
 * Son oturumu okur.
 *
 * FAIL-CLOSED: bozuk JSON veya göç edilemeyen gövde `CORRUPT` döner — sessizce
 * "yeni oturum" gibi davranılmaz, çünkü bu gerçek bir saha kanıtı kaybıdır ve
 * kullanıcıya BİLDİRİLMELİDİR (görev §13).
 */
export function loadSession(): LoadOutcome {
  let raw: string | null;
  try {
    raw = safeGetRaw(LR_SESSION_KEY);
  } catch {
    return { kind: 'CORRUPT' };
  }
  if (!raw) return { kind: 'NONE' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'CORRUPT' };
  }

  const migrated = migrateSession(parsed);
  if (!migrated) return { kind: 'CORRUPT' };

  /* #507 devamı — ESKİ MASKE ARTIĞI TEMİZLİĞİ.
     2026-08-09 öncesi yazılmış kayıtlarda `vehicleRef` "…891234" biçimindeydi;
     o değer ISO 3779 SERİ NUMARASINI açıkta taşır. Kod düzeldi ama DİSKTEKİ
     kayıt düzelmez — bu yüzden temizlik AÇILIŞTA, okuma yolunda yapılır.

     NEDEN KAYIT SİLİNMİYOR, ALAN DÜŞÜRÜLÜYOR: eski maske WMI'yi silip seriyi
     bıraktığı için doğru maske yeniden ÜRETİLEMEZ; geriye iki seçenek kalır —
     alanı düşürmek ya da tüm oturumu silmek. Uzun yol oturumu zor kazanılmış
     SAHA KANITIDIR (kütük #308/#309: gözlemci gerçek araçta hiç koşmadı) ve
     `vehicleRef` yalnızca bir etikettir, hiçbir kararın girdisi değildir.
     Kanıtı bir etiket yüzünden imha etmek orantısız olurdu.

     Temizlik BELLEKTE KALMAZ: kayıt hemen diske geri yazılır, yoksa sızıntı
     dosyada durmaya devam eder. Yazma başarısız olsa bile çağırana temiz gövde
     döner (fail-soft) — sayaç yazımın denendiğini değil, ALANIN temizlendiğini
     sayar. */
  const { session, purged } = purgeLegacyVinMasks(migrated);
  if (purged > 0) {
    _writeStats.legacyMaskRecords += 1;
    _writeStats.legacyMaskFields += purged;
    try { saveSession(session); } catch { /* fail-soft: gövde yine de temiz döner */ }
  }
  return { kind: 'OK', session };
}

export function deleteSession(): boolean {
  try {
    safeRemoveRaw(LR_SESSION_KEY);
    safeRemoveRaw(LR_BLACKBOX_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · BlackBox pencereleri — SÜRÜMLÜ + CHECKSUM'LI ZARF (D2)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Zarf sürümü. v1: checksum YOK (eski). v2: `frameCount` + `checksum` taşır.
 *
 * NEDEN CHECKSUM: eMMC'de yarım yazım (power-loss / process kill) sözdizimsel
 * olarak GEÇERLİ ama içeriği EKSİK bir JSON bırakabilir. Böyle bir gövdeyi
 * "sağlam kanıt" saymak, saha raporunun en tehlikeli yalanı olurdu. Checksum
 * tutmuyorsa gövde FAIL-CLOSED reddedilir — sessizce kısmi veri KULLANILMAZ.
 */
export const BB_ENVELOPE_VERSION = 2;

interface BlackBoxEnvelopeV1 {
  readonly schemaVersion: number;
  readonly sessionId: string;
  readonly windows: readonly BlackBoxWindow[];
}

interface BlackBoxEnvelopeV2 extends BlackBoxEnvelopeV1 {
  readonly frameCount: number;
  readonly checksum: string;
}

/**
 * FNV-1a 32-bit — bağımlılıksız, deterministik, ucuz. Kriptografik DEĞİLDİR ve
 * öyle sunulmaz: amacı kötü niyet değil, YARIM/BOZUK yazımı yakalamaktır.
 */
export function blackBoxChecksum(payload: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function _countFrames(windows: readonly BlackBoxWindow[]): number {
  let n = 0;
  for (const w of windows) {
    n += (Array.isArray(w.preFrames) ? w.preFrames.length : 0)
      + (Array.isArray(w.postFrames) ? w.postFrames.length : 0);
  }
  return n;
}

/* ── Yazma ölçümü (D2 kanıtı) ────────────────────────────────────────────── */

export interface StoreWriteStats {
  readonly sessionWrites: number;
  readonly sessionBytes: number;
  readonly blackBoxWrites: number;
  readonly blackBoxBytes: number;
  /** #507 devamı: eski VIN maskesi taşıdığı için temizlenen KAYIT sayısı. */
  readonly legacyMaskRecords: number;
  /** Aynı temizlikte düşürülen ALAN sayısı (bir kayıtta birden çok olabilir). */
  readonly legacyMaskFields: number;
}

/**
 * Bu MODÜLÜN kendi yazım defteri. Ürünün `_emmcWriteCount` metriğinin YERİNE
 * geçmez ve onu okumaz — gözlemcinin kendi bütçesini ÖLÇÜLEBİLİR kılar
 * (eMMC hacmi artık tahmin değil, sayım).
 */
const _writeStats = {
  sessionWrites: 0, sessionBytes: 0, blackBoxWrites: 0, blackBoxBytes: 0,
  legacyMaskRecords: 0, legacyMaskFields: 0,
};

export function readStoreWriteStats(): StoreWriteStats {
  return {
    sessionWrites: _writeStats.sessionWrites,
    sessionBytes: _writeStats.sessionBytes,
    blackBoxWrites: _writeStats.blackBoxWrites,
    blackBoxBytes: _writeStats.blackBoxBytes,
    legacyMaskRecords: _writeStats.legacyMaskRecords,
    legacyMaskFields: _writeStats.legacyMaskFields,
  };
}

export function _resetStoreWriteStatsForTest(): void {
  _writeStats.sessionWrites = 0;
  _writeStats.sessionBytes = 0;
  _writeStats.blackBoxWrites = 0;
  _writeStats.blackBoxBytes = 0;
  _writeStats.legacyMaskRecords = 0;
  _writeStats.legacyMaskFields = 0;
}

/**
 * Kritik pencereleri ayrı anahtara yazar (oturum gövdesini şişirmemek için).
 * Bütçe aşılırsa EN ESKİ pencereler düşürülür — KRİTİK olanlar korunur.
 *
 * ÇAĞRI DİSİPLİNİ (D2): bu fonksiyon artık her checkpoint'te DEĞİL, yalnız
 * pencere kümesi KENAR değiştirdiğinde çağrılır (bkz. `longRoadRecorder`
 * `_persistBlackBoxIfDirty`). Sürekli tam-blob yeniden yazımı kaldırıldı.
 */
export function saveBlackBox(sessionId: string, windows: readonly BlackBoxWindow[]): SaveResult {
  try {
    const critical = windows.filter((w) => w.severity === 'CRITICAL');
    const rest = windows.filter((w) => w.severity !== 'CRITICAL');
    const keep = [...critical, ...rest].slice(0, LR_MAX_BLACKBOX_EVENTS);

    const windowsBody = JSON.stringify(keep);
    const env: BlackBoxEnvelopeV2 = {
      schemaVersion: BB_ENVELOPE_VERSION,
      sessionId,
      frameCount: _countFrames(keep),
      checksum: blackBoxChecksum(windowsBody),
      windows: keep,
    };
    const body = JSON.stringify(env);
    safeSetRaw(LR_BLACKBOX_KEY, body, 0, true);
    _writeStats.blackBoxWrites += 1;
    _writeStats.blackBoxBytes += body.length;
    return { ok: true, bytes: body.length, overBudget: body.length > LR_MAX_TOTAL_BYTES };
  } catch {
    return { ok: false, bytes: null, overBudget: false };
  }
}

export type BlackBoxLoadKind =
  | 'NONE'
  | 'OK'
  | 'LEGACY_MIGRATED'
  | 'CORRUPT'
  | 'UNSUPPORTED_FORMAT';

export interface BlackBoxLoadOutcome {
  readonly kind: BlackBoxLoadKind;
  /** FAIL-CLOSED: `CORRUPT`/`UNSUPPORTED_FORMAT` durumunda DAİMA boş. */
  readonly windows: readonly BlackBoxWindow[];
  readonly formatVersion: number | null;
  /** `null` → denetlenemedi (v1). `true/false` → gerçekten sınandı. */
  readonly checksumOk: boolean | null;
  readonly reason: string | null;
  /** Şekli bozuk olduğu için atılan pencere sayısı — sessiz kayıp YOK. */
  readonly rejectedWindows: number;
}

function _emptyLoad(kind: BlackBoxLoadKind, reason: string | null = null): BlackBoxLoadOutcome {
  return { kind, windows: [], formatVersion: null, checksumOk: null, reason, rejectedWindows: 0 };
}

/** Pencere şekli asgari sözleşmeyi taşıyor mu (yarım göç kalıntısı yakalanır). */
function _isWindowShape(w: unknown): w is BlackBoxWindow {
  if (!w || typeof w !== 'object') return false;
  const o = w as Record<string, unknown>;
  return typeof o.eventId === 'string'
    && typeof o.eventType === 'string'
    && Number.isFinite(o.detectedAt as number)
    && Array.isArray(o.preFrames)
    && Array.isArray(o.postFrames);
}

/**
 * Pencereleri okur. **Legacy sessizce güvenilir sayılmaz** (D2): v1 gövde
 * okunabilir ama `LEGACY_MIGRATED` olarak işaretlenir ve checksum hükmü `null`
 * kalır; bilinmeyen/gelecek sürüm `UNSUPPORTED_FORMAT` ile REDDEDİLİR.
 */
export function loadBlackBoxOutcome(sessionId: string): BlackBoxLoadOutcome {
  let raw: string | null;
  try {
    raw = safeGetRaw(LR_BLACKBOX_KEY);
  } catch {
    return _emptyLoad('CORRUPT', 'READ_FAILED');
  }
  if (!raw) return _emptyLoad('NONE');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* Yarım yazımın en yaygın biçimi: kesilmiş JSON. */
    return _emptyLoad('CORRUPT', 'PARSE');
  }
  if (!parsed || typeof parsed !== 'object') return _emptyLoad('CORRUPT', 'SHAPE');

  const env = parsed as Partial<BlackBoxEnvelopeV2>;
  if (env.sessionId !== sessionId) return _emptyLoad('NONE', 'SESSION_MISMATCH');
  if (!Array.isArray(env.windows)) return _emptyLoad('CORRUPT', 'SHAPE');

  const version = typeof env.schemaVersion === 'number' ? env.schemaVersion : 1;
  if (version > BB_ENVELOPE_VERSION) {
    return { ..._emptyLoad('UNSUPPORTED_FORMAT', 'FUTURE_VERSION'), formatVersion: version };
  }

  const rawWindows = env.windows as readonly unknown[];
  const windows = rawWindows.filter(_isWindowShape);
  const rejectedWindows = rawWindows.length - windows.length;

  if (version >= 2) {
    if (typeof env.checksum !== 'string') {
      return { ..._emptyLoad('CORRUPT', 'CHECKSUM_MISSING'), formatVersion: version };
    }
    /* Checksum ZARFTAKİ pencere dizisi üzerinden hesaplanır — reddedilen
       pencereler ayıklanmadan ÖNCE, aksi hâlde bozuk gövde "tutuyor" görünürdü. */
    const actual = blackBoxChecksum(JSON.stringify(rawWindows));
    if (actual !== env.checksum) {
      return { ..._emptyLoad('CORRUPT', 'CHECKSUM_MISMATCH'), formatVersion: version, checksumOk: false };
    }
    return {
      kind: 'OK', windows, formatVersion: version, checksumOk: true,
      reason: rejectedWindows > 0 ? 'WINDOW_SHAPE_REJECTED' : null,
      rejectedWindows,
    };
  }

  /* v1: güvenli SALT-OKUNUR göç. "Doğrulandı" DENMEZ — checksumOk `null`. */
  return {
    kind: 'LEGACY_MIGRATED', windows, formatVersion: version, checksumOk: null,
    reason: 'NO_CHECKSUM_IN_V1', rejectedWindows,
  };
}

/**
 * Geriye dönük uyum sarmalayıcısı — yalnız pencereleri döner.
 * Yeni kod `loadBlackBoxOutcome` kullanmalıdır (format hükmü orada görünür).
 */
export function loadBlackBox(sessionId: string): readonly BlackBoxWindow[] {
  return loadBlackBoxOutcome(sessionId).windows;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Depolama baskısı (görev §17)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bu modülün kullandığı toplam bayt. `null` → ölçülemedi (sahte 0 YOK).
 */
export function measureUsedBytes(): number | null {
  try {
    const a = safeGetRaw(LR_SESSION_KEY);
    const b = safeGetRaw(LR_BLACKBOX_KEY);
    if (a === null && b === null) return 0;
    return (a ? a.length : 0) + (b ? b.length : 0);
  } catch {
    return null;
  }
}

/**
 * Baskı sınıfı. Ölçülemezse `OK` DEĞİL — `WARN` döneriz: bilinmeyen durumda
 * iyimser davranmak (fail-open) bu projenin kuralına aykırıdır.
 */
export function classifyStoragePressure(usedBytes: number | null): StoragePressure {
  if (usedBytes === null) return 'WARN';
  if (usedBytes >= LR_MAX_TOTAL_BYTES) return 'CRITICAL';
  if (usedBytes >= Math.floor(LR_MAX_TOTAL_BYTES * 0.75)) return 'WARN';
  return 'OK';
}
