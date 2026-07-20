/**
 * aiCore/runtime/diagnosticEvidence.ts — TANI KANITI ZENGİNLEŞTİRME (SAF · additive · Faz-2.5).
 *
 * AMAÇ: Mevcut Diagnostics V2 otoritesinin ürettiği zengin OBD teşhis anlık görüntüsünü
 * (ObdDeepSnapshot: DTC · handshake/protocol · transport/health · capability outcome ·
 * recovery/disconnect) + kaynak sağlığı + Vehicle Memory bilinen-sınırları AI Core kanıt
 * satırlarına çevirir. VERİ ÜRETMEZ / İKİNCİ OTORİTE KURMAZ — yalnız mevcut kanıtın ŞEKLİNİ
 * AI Core'a uyarlar (read-only, additive).
 *
 * KURALLAR (görev sözleşmesi):
 *  - "0 ≠ no-data": lastPacketAgeMs -1 / null = ÖLÇÜLMEDİ (no-data), 0 DEĞİL. Ölçülmemiş alan
 *    kanıt üretmez veya AÇIKÇA "yakalanmadı" işaretlenir (uydurma yok).
 *  - EKSİK/ESKİ AÇIKÇA: isStale/bayat okuma → summary'de "(bayat)" + düşük güven; hiç
 *    çalışmamış handshake / cache'siz freeze-frame → "yakalanmadı" kanıtı (missing marker).
 *  - BOUNDED/DEDUP: her kategori tavana tabi; anahtarlar kararlı (EvidenceStore dedup eder).
 *  - PII yok: yalnız kod/sayı/enum (makeEvidence sanitize eder). SAF: zaman enjekte, yan etki yok.
 *
 * DECOUPLED: diagnosticSections/obd modüllerini import ETMEZ (yalnız yapısal *Like şekli bilir)
 * → bağımlılık döngüsü yok, OBD çalışma-ağacına dokunmaz, test gerçek servis kurmadan çalışır.
 */

import type { AiEvidenceItem } from '../types';
import type { TriageSections } from '../../diagnosticTriage';
import { makeEvidence } from '../evidenceStore';

/* ── Decoupled girdi şekilleri (ObdDeepSnapshot / sourceHealth *Like) ── */

export interface DiagDtcCodeLike { readonly code?: string; readonly severity?: string; readonly system?: string }
export interface DiagObdDeepLike {
  readonly adapter?: { readonly source?: string; readonly connectionState?: string; readonly lastSeenMs?: number } | null;
  readonly health?: {
    readonly connectionQuality?: number; readonly lastPacketAgeMs?: number;
    readonly isStale?: boolean; readonly reconnectPressure?: number;
  } | null;
  readonly handshake?: {
    readonly outcome?: string; readonly protocolTried?: string | null; readonly protocolActive?: string | null;
    readonly bitmapClass?: string | null; readonly vinClass?: string | null; readonly failReason?: string | null;
    readonly reconnectHistory?: readonly ({ readonly reason?: string } | null)[];
  } | null;
  readonly dtc?: {
    readonly count?: number; readonly isStale?: boolean; readonly error?: string | null;
    readonly codes?: readonly (DiagDtcCodeLike | null)[];
  } | null;
  readonly extended?: { readonly discovered?: boolean; readonly supportedCount?: number; readonly unavailable?: readonly string[] } | null;
  readonly connLifecycle?: Readonly<Record<string, unknown>> | null;
  readonly kwpRecoveryEvidence?: {
    readonly status?: string; readonly recoveryCount?: number;
    readonly maxCoreNoDataStreak?: number; readonly suppressedCount?: number;
  } | null;
}

/** Kaynak başına sağlık (PlatformSourceHealthDiag *Like — sub-şekil opak, defansif okunur). */
export interface DiagSourceHealthLike {
  readonly can?: unknown;
  readonly obd?: unknown;
  readonly gps?: unknown;
}

/** Cache'lenmiş freeze-frame (varsa). null → bu oturumda yakalanmadı (canlı sorgu YAPILMAZ). */
export interface DiagFreezeFrameLike {
  readonly dtcCode?: string | null;
  readonly valueCount?: number;
  readonly capturedAt?: number;
}

/** Vehicle Memory'den bilinen-sınır gerçeği. */
export interface DiagMemoryLimitLike {
  readonly key: string;
  readonly statement: string;
  readonly confidence: number;
  readonly lastSeen?: number;
}

export interface DiagnosticEvidenceInput {
  readonly obdDeep?: DiagObdDeepLike | null;
  readonly sourceHealth?: DiagSourceHealthLike | null;
  /** null → freeze-frame bu oturumda yakalanmadı (açıkça işaretlenir). */
  readonly freezeFrame?: DiagFreezeFrameLike | null;
  readonly memoryLimits?: readonly DiagMemoryLimitLike[];
}

/* ── Sabitler (bounded) ─────────────────────────────────────────── */

const MAX_DTC_EVIDENCE = 10;
const MAX_MEMORY_EVIDENCE = 8;
const STALE_PACKET_MS = 4_000;   // ObdHealthMonitor STALE eşiğiyle hizalı

/* ── Saf yardımcılar ────────────────────────────────────────────── */

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function _bool(v: unknown): boolean {
  return v === true;
}
/** Opak kaynak-sağlık değerinden 'stale' bayrağını defansif çıkar. */
function _srcStale(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;          // no-data (ölçülmemiş) — 0 DEĞİL
  if (typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return _bool(r.stale) || _bool(r.isStale);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kategori üreticileri (her biri bounded + stale/missing işaretli)
 * ════════════════════════════════════════════════════════════════════════ */

/** current DTC — bayat okuma / okuma hatası AÇIKÇA işaretlenir. */
function _dtcEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const dtc = od.dtc;
  if (!dtc) return;
  const stale = _bool(dtc.isStale);
  if (typeof dtc.error === 'string' && dtc.error) {
    const ev = makeEvidence({
      key: 'dtc.read_error', kind: 'diagnostic',
      summary: `DTC okuması başarısız: ${dtc.error} — arıza kodları doğrulanamadı`,
      confidence: 0.3, observedAt: now, source: 'diagnostics',
    });
    if (ev) out.push(ev);
  }
  const codes = Array.isArray(dtc.codes) ? dtc.codes.filter((c): c is DiagDtcCodeLike => c != null) : [];
  let n = 0;
  for (const c of codes) {
    if (n >= MAX_DTC_EVIDENCE) break;
    if (typeof c.code !== 'string' || !c.code) continue;
    const sev = c.severity === 'critical' ? 'critical' : c.severity === 'warning' ? 'warning' : 'info';
    const baseConf = sev === 'critical' ? 0.95 : sev === 'warning' ? 0.8 : 0.6;
    const ev = makeEvidence({
      key: `dtc.${c.code}`, kind: 'dtc',
      summary: `Arıza kodu ${c.code} (${sev}${c.system ? `, ${c.system}` : ''})${stale ? ' — bayat okuma' : ''}`,
      confidence: stale ? Math.min(baseConf, 0.5) : baseConf,   // bayat → düşük güven
      observedAt: now, source: 'obd',
    });
    if (ev) { out.push(ev); n++; }
  }
}

/** freeze-frame — cache varsa evidence, yoksa AÇIKÇA "yakalanmadı" (canlı sorgu yok). */
function _freezeEvidence(input: DiagnosticEvidenceInput, now: number, out: AiEvidenceItem[]): void {
  const dtcCount = _num(input.obdDeep?.dtc?.count) ?? 0;
  const ff = input.freezeFrame;
  if (ff && (typeof ff.dtcCode === 'string' || _num(ff.valueCount))) {
    const ev = makeEvidence({
      key: 'freeze.frame', kind: 'diagnostic',
      summary: `Freeze-frame yakalandı${ff.dtcCode ? ` (${ff.dtcCode})` : ''}: ${_num(ff.valueCount) ?? 0} değer`,
      confidence: 0.8, observedAt: _num(ff.capturedAt) ?? now, source: 'obd',
    });
    if (ev) out.push(ev);
    return;
  }
  // DTC var ama freeze cache yok → eksik kanıt açıkça işaretlenir (uydurma yok).
  if (dtcCount > 0) {
    const ev = makeEvidence({
      key: 'freeze.missing', kind: 'diagnostic',
      summary: 'Freeze-frame bu oturumda yakalanmadı — arıza anı koşulları doğrulanamadı',
      confidence: 0.25, observedAt: now, source: 'diagnostics',
    });
    if (ev) out.push(ev);
  }
}

/** protocol/handshake — outcome/fail/protocol uyuşmazlığı. */
function _handshakeEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const hs = od.handshake;
  if (!hs || typeof hs.outcome !== 'string' || hs.outcome === 'not_run') {
    if (hs && hs.outcome === 'not_run') {
      const ev = makeEvidence({
        key: 'handshake.not_run', kind: 'diagnostic',
        summary: 'Handshake bu oturumda çalışmadı — VIN/desteklenen-PID keşfi doğrulanamadı',
        confidence: 0.3, observedAt: now, source: 'diagnostics',
      });
      if (ev) out.push(ev);
    }
    return;
  }
  const ok = hs.outcome === 'ok';
  const ev = makeEvidence({
    key: 'handshake.outcome', kind: 'diagnostic',
    summary: `Handshake sonucu: ${hs.outcome}${hs.failReason ? ` (${hs.failReason})` : ''}`,
    confidence: ok ? 0.85 : 0.75, observedAt: now, source: 'obd',
  });
  if (ev) out.push(ev);

  // Protokol uyuşmazlığı: zorlanan var ama aktif yok (araç-değişimi sinyali).
  if (hs.protocolTried && !hs.protocolActive) {
    const pe = makeEvidence({
      key: 'handshake.protocol_mismatch', kind: 'diagnostic',
      summary: `Zorlanan protokol ${hs.protocolTried} aktif değil — araç/protokol uyuşmazlığı`,
      confidence: 0.7, observedAt: now, source: 'obd',
    });
    if (pe) out.push(pe);
  } else if (hs.protocolActive) {
    const pe = makeEvidence({
      key: 'handshake.protocol', kind: 'diagnostic',
      summary: `Aktif protokol: ${hs.protocolActive}`,
      confidence: 0.8, observedAt: now, source: 'obd',
    });
    if (pe) out.push(pe);
  }
}

/** transport + health — connectionQuality/reconnectPressure/freshness (stale AÇIKÇA). */
function _transportEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const h = od.health;
  if (!h) return;
  const q = _num(h.connectionQuality);
  if (q !== null) {
    const ev = makeEvidence({
      key: 'transport.quality', kind: 'diagnostic',
      summary: `Bağlantı kalitesi %${Math.round(q)}`,
      confidence: q < 50 ? 0.85 : 0.6, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
  const rp = _num(h.reconnectPressure);
  if (rp !== null && rp > 0) {
    const ev = makeEvidence({
      key: 'transport.reconnect_pressure', kind: 'diagnostic',
      summary: `Reconnect baskısı ${rp} — bağlantı kararsız`,
      confidence: 0.75, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
  // Freshness — lastPacketAgeMs -1/null = ÖLÇÜLMEDİ (no-data), 0 DEĞİL.
  const age = _num(h.lastPacketAgeMs);
  const stale = _bool(h.isStale) || (age !== null && age >= 0 && age > STALE_PACKET_MS);
  if (stale) {
    const ageTxt = age !== null && age >= 0 ? `${(age / 1000).toFixed(1)}s` : '?';
    const ev = makeEvidence({
      key: 'transport.freshness', kind: 'diagnostic',
      summary: `Veri donuk/bayat — son paket ${ageTxt} önce (bağlı ama veri akmıyor)`,
      confidence: 0.8, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
}

/** source health — kaynak başına (null = ölçülmedi, stale = AÇIKÇA). */
function _sourceHealthEvidence(sh: DiagSourceHealthLike, now: number, out: AiEvidenceItem[]): void {
  for (const src of ['can', 'obd', 'gps'] as const) {
    const raw = (sh as Record<string, unknown>)[src];
    const st = _srcStale(raw);
    if (st === null) continue;                 // ölçülmedi → kanıt yok (no-data, uydurma yok)
    const ev = makeEvidence({
      key: `source_health.${src}`, kind: 'diagnostic',
      summary: st ? `${src.toUpperCase()} kaynağı bayat (veri gelmiyor)` : `${src.toUpperCase()} kaynağı sağlıklı`,
      confidence: st ? 0.8 : 0.55, observedAt: now, source: 'diagnostics',
    });
    if (ev) out.push(ev);
  }
}

/** capability outcome — araç tarafından verilmeyen PID'ler (NRC/NO_DATA sonrası bilinen sınır). */
function _capabilityEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const unavail = od.extended?.unavailable;
  if (Array.isArray(unavail) && unavail.length > 0) {
    const sample = unavail.filter((x) => typeof x === 'string').slice(0, 6).join(', ');
    const ev = makeEvidence({
      key: 'capability.unavailable_pids', kind: 'capability',
      summary: `${unavail.length} PID araç tarafından verilmiyor (bilinen sınır, arıza değil): ${sample}`,
      confidence: 0.7, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
}

/** recovery/disconnect — KWP kurtarma + reconnect geçmişi + connLifecycle sayaçları. */
function _recoveryEvidence(od: DiagObdDeepLike, now: number, out: AiEvidenceItem[]): void {
  const kwp = od.kwpRecoveryEvidence;
  if (kwp && typeof kwp.status === 'string') {
    const rc = _num(kwp.recoveryCount) ?? 0;
    const maxStreak = _num(kwp.maxCoreNoDataStreak) ?? 0;
    const ev = makeEvidence({
      key: 'recovery.kwp', kind: 'diagnostic',
      summary: `KWP kurtarma: ${kwp.status} (ATPC ${rc}×, max NO_DATA serisi ${maxStreak})`,
      confidence: 0.7, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
  const hist = od.handshake?.reconnectHistory;
  if (Array.isArray(hist) && hist.length > 0) {
    const reasons = hist.filter((h) => h != null);
    const timeouts = reasons.filter((h) => h!.reason === 'timeout').length;
    const ev = makeEvidence({
      key: 'recovery.reconnect_history', kind: 'diagnostic',
      summary: `${reasons.length} reconnect kaydı (${timeouts} timeout) bu oturumda`,
      confidence: 0.65, observedAt: now, source: 'obd',
    });
    if (ev) out.push(ev);
  }
  // connLifecycle: defansif — herhangi pozitif sayaç varsa "yaşam-döngüsü aktivitesi" kanıtı.
  const cl = od.connLifecycle;
  if (cl && typeof cl === 'object') {
    let activity = 0;
    for (const v of Object.values(cl)) { const n = _num(v); if (n !== null && n > 0) activity += n; }
    if (activity > 0) {
      const ev = makeEvidence({
        key: 'recovery.lifecycle', kind: 'diagnostic',
        summary: `Bağlantı yaşam-döngüsü aktivitesi kaydedildi (reset/disconnect/reconnect toplam ${activity})`,
        confidence: 0.55, observedAt: now, source: 'diagnostics',
      });
      if (ev) out.push(ev);
    }
  }
}

/** Vehicle Memory bilinen-sınırları → 'memory' kanıtı (arıza değil, öğrenilmiş sınır). */
function _memoryEvidence(limits: readonly DiagMemoryLimitLike[], now: number, out: AiEvidenceItem[]): void {
  let n = 0;
  for (const f of limits) {
    if (n >= MAX_MEMORY_EVIDENCE) break;
    if (!f || typeof f.key !== 'string' || !f.key || typeof f.statement !== 'string' || !f.statement) continue;
    const ev = makeEvidence({
      key: `memory.${f.key}`, kind: 'memory',
      summary: `Bilinen araç sınırı (arıza değil): ${f.statement}`,
      confidence: _num(f.confidence) ?? 0.6, observedAt: _num(f.lastSeen) ?? now, source: 'memory',
    });
    if (ev) { out.push(ev); n++; }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Genel API
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Mevcut tanı anlık görüntüsünden bounded, dedup-anahtarlı, PII-güvenli kanıt satırları
 * üretir. SAF; hiçbir alan yoksa boş döner (sahte kanıt yok). Fail-soft: her kategori
 * kendi null-check'ini yapar.
 */
export function deriveDiagnosticEvidence(input: DiagnosticEvidenceInput, now: number = Date.now()): AiEvidenceItem[] {
  const out: AiEvidenceItem[] = [];
  const od = input.obdDeep;
  if (od) {
    _dtcEvidence(od, now, out);
    _handshakeEvidence(od, now, out);
    _transportEvidence(od, now, out);
    _capabilityEvidence(od, now, out);
    _recoveryEvidence(od, now, out);
  }
  _freezeEvidence(input, now, out);
  if (input.sourceHealth) _sourceHealthEvidence(input.sourceHealth, now, out);
  if (Array.isArray(input.memoryLimits) && input.memoryLimits.length > 0) _memoryEvidence(input.memoryLimits, now, out);
  return out;
}

/**
 * Zengin OBD anlık görüntüsünü Verdict çekirdeğinin okuduğu TriageSections'a sarar
 * (mevcut Diagnostics V2 motorunu DAHA İYİ besler — ikinci motor değil). SAF.
 */
export function obdDeepToSections(obdDeep: DiagObdDeepLike | null | undefined): TriageSections {
  if (!obdDeep) return {};
  return { obdDeep: obdDeep as unknown as TriageSections['obdDeep'] };
}
