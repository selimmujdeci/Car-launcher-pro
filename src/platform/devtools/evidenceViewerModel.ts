/**
 * evidenceViewerModel.ts — Evidence Viewer'ın SAF modeli (yeni backend YOK).
 *
 * KAYNAKLAR (hepsi MEVCUT ve salt-okunur; hiçbiri bu modül tarafından üretilmez):
 *   1) `getDiagnosticTrail()`      → kronolojik olay izi (boot/mode/screen/obd/action/error/modal)
 *   2) `getLastAiMechanicResult()` → AI Core'un son çalışmasının kanıt satırları
 *                                    (recovery.* · handshake.* · transport.* · dtc.* · capability.* …)
 *   3) `getValidationSnapshot()`   → saha doğrulama oturumunun kütüğü
 *
 * Bu modül yalnız BİRLEŞTİRİR + SINIFLANDIRIR + MASKELER + SINIRLAR. I/O yok, timer yok,
 * modül durumu yok → jsdom'da doğrudan test edilebilir.
 *
 * MASKELEME (görev §F — pazarlıksız): VIN · API key/token · MAC · koordinat · e-posta /
 * kullanıcı kimliği çıktıya ASLA girmez. Maskeleme kaynakta değil, GÖRÜNTÜ katmanında
 * yapılır (kaynak servisler değiştirilmez).
 */

import type { TrailEvent } from '../diagnosticTrailCore';
import type { AiOrchestratorRunResult } from '../aiCore/aiOrchestrator';
import type { ValidationSnapshot } from '../validation/validationTypes';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type EvidenceChannel =
  | 'obd'
  | 'kwp-recovery'
  | 'discovery'
  | 'validation'
  | 'ai'
  | 'system';

export type EvidenceSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface EvidenceRow {
  readonly id:       string;
  readonly ts:       number;
  readonly channel:  EvidenceChannel;
  /** Teknik tür etiketi (ör. 'trail:obd', 'evidence:diagnostic', 'validation:perf'). */
  readonly kind:     string;
  readonly severity: EvidenceSeverity;
  /** Kaynak/bağlam (ör. 'diagnosticTrail', 'aiCore/ai_mechanic', 'validation'). */
  readonly context:  string;
  /** Ham yük — MASKELENMİŞ ve kırpılmış. */
  readonly payload:  string;
}

export const EVIDENCE_CHANNELS: readonly EvidenceChannel[] = [
  'obd', 'kwp-recovery', 'discovery', 'validation', 'ai', 'system',
] as const;

export const EVIDENCE_CHANNEL_LABEL: Readonly<Record<EvidenceChannel, string>> = {
  'obd':          'OBD',
  'kwp-recovery': 'KWP Kurtarma',
  'discovery':    'Keşif',
  'validation':   'Doğrulama',
  'ai':           'Yapay Zekâ / Mavi',
  'system':       'Sistem',
} as const;

/** Önem derecesinin görünen Türkçe karşılığı (enum değeri veri katmanında AYNEN kalır). */
export const EVIDENCE_SEVERITY_LABEL: Readonly<Record<EvidenceSeverity, string>> = {
  info:     'BİLGİ',
  warn:     'UYARI',
  error:    'HATA',
  critical: 'KRİTİK',
} as const;

/** Low-end (Mali-400) bütçesi: liste her koşulda SINIRLI kalır. */
export const MAX_EVIDENCE_ROWS = 200;
/** Tek satır ham yük üst sınırı (bounded render). */
export const MAX_PAYLOAD_CHARS = 220;

/* ══════════════════════════════════════════════════════════════════════════
 * Maskeleme
 * ════════════════════════════════════════════════════════════════════════ */

const RE_SECRET = /\b(?:sk|pk|api|key|token|bearer|apikey)[-_]?[A-Za-z0-9_-]{12,}\b/gi;
const RE_EMAIL  = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RE_MAC    = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const RE_VIN    = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const RE_COORD  = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g;
const RE_UUID   = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
/** Uzun ham hex bloğu (16+ nibble) — VIN/kimlik taşıyabilir. */
const RE_LONG_HEX = /\b[0-9A-Fa-f]{16,}\b/g;

export const REDACTED = '[redacted]';

/**
 * Hassas alanları maskeler. Sıra ÖNEMLİ: önce anahtar/e-posta/UUID (uzun hex kuralına
 * yem olmasınlar), sonra MAC/VIN/koordinat, en son uzun hex.
 */
export function maskEvidenceText(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  return input
    .replace(RE_SECRET, REDACTED)
    .replace(RE_EMAIL, REDACTED)
    .replace(RE_UUID, REDACTED)
    .replace(RE_MAC, REDACTED)
    .replace(RE_VIN, REDACTED)
    .replace(RE_COORD, REDACTED)
    .replace(RE_LONG_HEX, REDACTED);
}

/** Maskele + kırp (bounded satır). */
export function maskAndClamp(input: unknown, max: number = MAX_PAYLOAD_CHARS): string {
  const masked = maskEvidenceText(input);
  return masked.length > max ? masked.slice(0, max) + '…' : masked;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıflandırma
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * AI Core kanıt anahtarı → kanal. Anahtar önekleri `aiCore/runtime/diagnosticEvidence.ts`
 * ve `vehicleContext.ts` tarafından üretilen GERÇEK öneklerdir (uydurma değil).
 */
export function classifyEvidenceKey(key: string): EvidenceChannel {
  if (typeof key !== 'string' || key.length === 0) return 'system';
  if (key.startsWith('recovery.')) return 'kwp-recovery';
  if (
    key.startsWith('signal.') || key.startsWith('dtc.') || key.startsWith('freeze.') ||
    key.startsWith('handshake.') || key.startsWith('transport.') || key.startsWith('source_health.')
  ) return 'obd';
  if (key.startsWith('capability.') || key.startsWith('fingerprint.')) return 'discovery';
  if (key.startsWith('memory.')) return 'ai';
  return 'system';
}

/** Olay izi satırı → kanal. */
export function classifyTrailEvent(ev: TrailEvent): EvidenceChannel {
  if (!ev) return 'system';
  if (ev.kind === 'obd') return 'obd';
  if (ev.kind === 'action' && typeof ev.label === 'string' && ev.label.startsWith('sesli komut')) return 'ai';
  return 'system';
}

function _trailSeverity(ev: TrailEvent): EvidenceSeverity {
  if (ev.kind !== 'error') return 'info';
  return typeof ev.label === 'string' && ev.label.includes('[critical]') ? 'critical' : 'error';
}

function _urgencySeverity(urgency: string): EvidenceSeverity {
  if (urgency === 'critical') return 'critical';
  if (urgency === 'urgent') return 'error';
  if (urgency === 'soon' || urgency === 'watch') return 'warn';
  return 'info';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Birleştirme
 * ════════════════════════════════════════════════════════════════════════ */

export interface EvidenceSourcesInput {
  readonly trail?:      readonly TrailEvent[] | null;
  readonly aiResult?:   AiOrchestratorRunResult | null;
  readonly validation?: ValidationSnapshot | null;
  readonly maxRows?:    number;
}

/**
 * Tüm kaynakları TEK zaman çizgisinde birleştirir: en YENİ önce, maskelenmiş, bounded.
 * Kaynaklardan biri bozuk/boşsa sessizce atlanır (fail-soft; görünüm asla çökmez).
 */
export function buildEvidenceRows(input: EvidenceSourcesInput): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  const max = typeof input.maxRows === 'number' && input.maxRows > 0
    ? Math.floor(input.maxRows) : MAX_EVIDENCE_ROWS;

  /* 1) Olay izi */
  try {
    const trail = input.trail;
    if (Array.isArray(trail)) {
      for (let i = 0; i < trail.length; i++) {
        const ev = trail[i];
        if (!ev || typeof ev.ts !== 'number') continue;
        rows.push({
          id:       `trail-${i}-${ev.ts}`,
          ts:       ev.ts,
          channel:  classifyTrailEvent(ev),
          kind:     `trail:${ev.kind}`,
          severity: _trailSeverity(ev),
          context:  'diagnosticTrail',
          payload:  maskAndClamp(ev.detail ? `${ev.label} — ${ev.detail}` : ev.label),
        });
      }
    }
  } catch { /* fail-soft */ }

  /* 2) AI Core — rapor başlığı + kanıt satırları */
  try {
    const ai = input.aiResult;
    if (ai && Array.isArray(ai.reports)) {
      for (const report of ai.reports) {
        if (!report) continue;
        rows.push({
          id:       `ai-report-${report.agentId}-${report.generatedAt}`,
          ts:       typeof report.generatedAt === 'number' ? report.generatedAt : 0,
          channel:  'ai',
          kind:     'ai:report',
          severity: _urgencySeverity(String(report.urgency)),
          context:  `aiCore/${report.agentId}`,
          payload:  maskAndClamp(
            `${report.headline} · güven ${report.confidence} · kanıt ${report.hasEvidence ? 'VAR' : 'YOK'}`,
          ),
        });
        const evidence = report.evidence;
        if (!Array.isArray(evidence)) continue;
        for (const item of evidence) {
          if (!item || typeof item.key !== 'string') continue;
          rows.push({
            id:       `ai-ev-${report.agentId}-${item.key}`,
            ts:       typeof item.observedAt === 'number' && item.observedAt > 0
              ? item.observedAt
              : (typeof report.generatedAt === 'number' ? report.generatedAt : 0),
            channel:  classifyEvidenceKey(item.key),
            kind:     `evidence:${item.kind}`,
            severity: 'info',
            context:  `${item.key} · ${item.source}`,
            payload:  maskAndClamp(item.summary),
          });
        }
      }
    }
  } catch { /* fail-soft */ }

  /* 3) Saha doğrulama kütüğü */
  try {
    const v = input.validation;
    if (v && Array.isArray(v.log)) {
      for (const entry of v.log) {
        if (!entry || typeof entry.tsWallMs !== 'number') continue;
        rows.push({
          id:       `validation-${entry.id}`,
          ts:       entry.tsWallMs,
          channel:  'validation',
          kind:     `validation:${entry.channel}`,
          severity: entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info',
          context:  `validation/${v.sessionId}`,
          payload:  maskAndClamp(entry.message),
        });
      }
    }
  } catch { /* fail-soft */ }

  rows.sort((a, b) => b.ts - a.ts);
  return rows.length > max ? rows.slice(0, max) : rows;
}

/** Kanal filtresi. `null` → hepsi. */
export function filterEvidenceRows(
  rows: readonly EvidenceRow[],
  channel: EvidenceChannel | null,
): EvidenceRow[] {
  if (!Array.isArray(rows)) return [];
  if (channel === null) return rows.slice();
  return rows.filter((r) => r.channel === channel);
}

/** Kanal başına satır sayısı (rozet/sayaç için). */
export function countByChannel(rows: readonly EvidenceRow[]): Record<EvidenceChannel, number> {
  const out: Record<EvidenceChannel, number> = {
    'obd': 0, 'kwp-recovery': 0, 'discovery': 0, 'validation': 0, 'ai': 0, 'system': 0,
  };
  if (!Array.isArray(rows)) return out;
  for (const r of rows as readonly EvidenceRow[]) {
    if (r && Object.prototype.hasOwnProperty.call(out, r.channel)) out[r.channel]++;
  }
  return out;
}
