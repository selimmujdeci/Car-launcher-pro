/**
 * rawTrafficExport.ts — Raw OBD Traffic'in MASKELİ dışa aktarımı (SAF · fail-closed).
 *
 * ═══ SÖZLEŞME ═══════════════════════════════════════════════════════════════
 *  1. Dışa aktarım EKRANDAKİ NESNEYE GÜVENMEZ. Girdi HAM kayıt tamponudur;
 *     maskeleme burada YENİDEN uygulanır (görünüm katmanı atlanabilir/değişebilir).
 *  2. ÜÇ KAPI üst üste biner:
 *       (a) `maskObdTrafficEntry` — OBD'ye özgü: VIN istek/yanıt yükü + sağlayıcı
 *           anahtarı + e-posta + MAC + UUID + IBAN + kart + telefon
 *       (b) `maskSensitiveText`   — mevcut doğrulama raporu maskesi (VIN→WMI, MAC,
 *           koordinat, anahtar=değer) · `validation/validationExport`ten YENİDEN KULLANILDI
 *       (c) `sanitizeValue`       — deny-key düşürme + derinlik/uzunluk tavanı, ASLA throw
 *  3. FAIL-CLOSED: maskelenemeyen yapı (cmd/resp string değil) dışa AKTARILMAZ, düşürülür
 *     ve sayısı raporda dürüstçe beyan edilir.
 *  4. BOUNDED: kayıt sayısı · alan uzunluğu · toplam bayt tavanlıdır.
 *  5. Dosya adında araç/kimlik bilgisi YOKTUR (yalnız zaman damgası).
 *  6. Native olayda BULUNMAYAN alanlar (protokol · oturum · transport) rapora
 *     UYDURULARAK yazılmaz; yokluk açıkça beyan edilir.
 *
 * SAF: I/O yok (dosya yazımı çağıran tarafta), modül durumu yok.
 */

import type { ObdTrafficEntry } from '../debug';
import { maskObdTrafficEntry } from './obdTrafficMask';
import { maskSensitiveText, sanitizeValue } from '../validation/validationExport';
import { classifyCommand, classifyResponse, type RawTrafficKind } from './rawTrafficModel';

/* ── Sınırlar ─────────────────────────────────────────────────────────────── */

export const RAW_TRAFFIC_EXPORT_SCHEMA = 'caros.obd.rawtraffic.v1';
/** Azami kayıt (en YENİ kayıtlar korunur). */
export const MAX_EXPORT_RECORDS = 300;
/** Alan başına azami karakter. */
export const MAX_EXPORT_FIELD_CHARS = 240;
/** Serileştirilmiş toplam azami bayt. */
export const MAX_EXPORT_BYTES = 256 * 1024;

/* ── Tipler ───────────────────────────────────────────────────────────────── */

export interface RawTrafficExportMeta {
  readonly generatedAtWallMs: number;
  /** Capacitor.getPlatform() — 'web' | 'android' | 'ios'. Kimlik değildir. */
  readonly platform?: string;
}

export interface RawTrafficExportResult {
  readonly fileName:     string;
  readonly body:         string;
  readonly recordCount:  number;
  /** Maskelenemediği için DÜŞÜRÜLEN kayıt sayısı (fail-closed kanıtı). */
  readonly droppedCount: number;
  /** Bayt/kayıt tavanı nedeniyle kırpıldı mı. */
  readonly truncated:    boolean;
  readonly bytes:        number;
}

interface ExportRecord {
  readonly seq:       number;
  readonly ts:        number;
  readonly elapsedMs: number | null;
  readonly cmdKind:   RawTrafficKind;
  readonly respKind:  RawTrafficKind | null;
  readonly cmd:       string;
  readonly resp:      string | null;
}

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function _clamp(s: string): string {
  return s.length > MAX_EXPORT_FIELD_CHARS ? s.slice(0, MAX_EXPORT_FIELD_CHARS) : s;
}

/** İki maskeleme kapısını arka arkaya uygular. */
function _doubleMask(s: string): string {
  return _clamp(maskSensitiveText(s, MAX_EXPORT_FIELD_CHARS));
}

function _byteLength(s: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  } catch { /* fail-soft */ }
  return s.length;
}

/** Kimlik taşımayan dosya adı — YALNIZ zaman damgası. */
export function buildExportFileName(wallMs: number): string {
  const ms = typeof wallMs === 'number' && Number.isFinite(wallMs) ? wallMs : 0;
  let stamp: string;
  try {
    stamp = new Date(ms).toISOString().replace(/[:.]/g, '-');
  } catch {
    stamp = String(ms);
  }
  return `caros-obd-raw-${stamp}.json`;
}

/* ── Kayıt dönüşümü (fail-closed) ─────────────────────────────────────────── */

/**
 * Tek kaydı dışa aktarılabilir hâle getirir. Maskeleme güvenle uygulanamıyorsa
 * (cmd string değil) `null` döner → kayıt DÜŞER.
 */
export function toExportRecord(entry: ObdTrafficEntry | null | undefined, seq: number): ExportRecord | null {
  if (!entry || typeof entry.cmd !== 'string') return null;

  const masked = maskObdTrafficEntry(entry.cmd, entry.resp);
  const hasResp = typeof entry.resp === 'string' && entry.resp.length > 0;

  return {
    seq,
    ts:        typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : 0,
    elapsedMs: hasResp && typeof entry.ms === 'number' && Number.isFinite(entry.ms) ? entry.ms : null,
    cmdKind:   classifyCommand(entry.cmd),
    respKind:  hasResp ? classifyResponse(entry.cmd, entry.resp) : null,
    cmd:       _doubleMask(masked.cmd),
    resp:      hasResp ? _doubleMask(masked.resp) : null,
  };
}

/* ── Rapor kurulumu ───────────────────────────────────────────────────────── */

/**
 * Maskeli, sınırlı, dürüst dışa aktarım gövdesi. ASLA throw etmez.
 * Bayt tavanı aşılırsa EN ESKİ kayıtlar düşürülerek tekrar serileştirilir.
 */
export function buildRawTrafficExport(
  log: readonly ObdTrafficEntry[],
  meta: RawTrafficExportMeta,
): RawTrafficExportResult {
  const wallMs = typeof meta?.generatedAtWallMs === 'number' ? meta.generatedAtWallMs : 0;
  const source = Array.isArray(log) ? log : [];

  // 1) Kayıt tavanı — en YENİ kayıtlar korunur.
  const sliceStart = Math.max(0, source.length - MAX_EXPORT_RECORDS);
  let truncated = sliceStart > 0;

  // 2) Kayıt dönüşümü + fail-closed düşürme.
  let records: ExportRecord[] = [];
  let droppedCount = 0;
  for (let i = sliceStart; i < source.length; i++) {
    const rec = toExportRecord(source[i], i + 1);
    if (rec === null) { droppedCount++; continue; }
    records.push(rec);
  }

  // 3) Serileştir + bayt tavanı (aşarsa en eskiyi düşür, tekrar dene).
  let body = _serialize(records, wallMs, meta.platform, droppedCount, truncated);
  let bytes = _byteLength(body);
  while (bytes > MAX_EXPORT_BYTES && records.length > 0) {
    const drop = Math.max(1, Math.ceil(records.length * 0.1));
    records = records.slice(drop);
    truncated = true;
    body = _serialize(records, wallMs, meta.platform, droppedCount, truncated);
    bytes = _byteLength(body);
  }

  return {
    fileName: buildExportFileName(wallMs),
    body,
    recordCount: records.length,
    droppedCount,
    truncated,
    bytes,
  };
}

function _serialize(
  records: readonly ExportRecord[],
  wallMs: number,
  platform: string | undefined,
  droppedCount: number,
  truncated: boolean,
): string {
  const report = {
    schema:      RAW_TRAFFIC_EXPORT_SCHEMA,
    generatedAt: _isoOrEmpty(wallMs),
    platform:    typeof platform === 'string' ? platform : 'unknown',
    readOnly:    true,
    masked:      true,
    limits: {
      maxRecords:    MAX_EXPORT_RECORDS,
      maxFieldChars: MAX_EXPORT_FIELD_CHARS,
      maxBytes:      MAX_EXPORT_BYTES,
    },
    counts: {
      exported: records.length,
      dropped:  droppedCount,
      truncated,
    },
    // Native olayda BULUNMAYAN alanlar — uydurma yerine yokluk beyanı.
    absentMetadata: ['protocol', 'sessionId', 'transport', 'ecuAddress'],
    note:
      'Native obdTraffic olayı yalnız {cmd,resp,ms,ts} taşır; yön TX/RX kaydın iki ' +
      'yarısından TÜRETİLİR. Protokol/oturum/transport bilgisi kayıtta YOKTUR.',
    records,
  };

  // Üçüncü kapı: deny-key düşürme + derinlik/uzunluk tavanı (mevcut doğrulama kapısı).
  let safe: unknown;
  try { safe = sanitizeValue(report); } catch { safe = { schema: RAW_TRAFFIC_EXPORT_SCHEMA, error: 'sanitize-failed' }; }

  try {
    return JSON.stringify(safe, null, 2);
  } catch {
    return JSON.stringify({ schema: RAW_TRAFFIC_EXPORT_SCHEMA, error: 'serialize-failed' });
  }
}

function _isoOrEmpty(ms: number): string {
  try { return new Date(ms).toISOString(); } catch { return ''; }
}
