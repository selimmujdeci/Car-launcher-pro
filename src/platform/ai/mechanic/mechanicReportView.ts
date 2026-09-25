/**
 * mechanicReportView — AI Usta raporunun KULLANICI görünümü (Arıza Teşhisi kartı).
 *
 * Yeni teşhis motoru DEĞİLDİR: deterministik AI Usta'nın son sonucunu
 * (`getLastAiMechanicResult`) mevcut `mapMechanicReport` ile okur, yalnız
 * TAZELİK ve servis metni ekler.
 *
 *  - Sonuç yoksa `null` → kart hiç teşhis uydurmaz.
 *  - Eski rapor (`MECHANIC_REPORT_STALE_MS`) "güncel" gösterilmez: `stale` işaretlenir.
 *  - Servis metni yalnız rapordaki alanlardan kurulur; kanıt yoksa neden yazılmaz.
 *  - SAF: IO yok; zaman dışarıdan verilir.
 */

import type { MechanicDiagnosis } from './mechanicTypes';
import { mapMechanicReport, type MechanicReportLike } from './mechanicMapper';
import { AI_MECHANIC_ID } from '../../aiCore/agents/aiMechanic';
import { stripControlChars } from '../controlChars';

/** Kart özeti üst sınırı — Mavi bloğunun 140 karakterlik sınırı ekranda cümleyi yarıda kesiyordu. */
const DISPLAY_SUMMARY_MAX = 320;

/** Bu süreden eski rapor "son değerlendirme" olarak gösterilir, güncel sayılmaz. */
export const MECHANIC_REPORT_STALE_MS = 10 * 60_000;

export interface MechanicRunLike {
  readonly generatedAt: number;
  readonly reports: readonly unknown[];
}

export interface MechanicReportView {
  readonly diagnosis: MechanicDiagnosis;
  /** Ekranda gösterilecek TAM özet (Mavi'ye giden `diagnosis.summary` sınırlı kalır). */
  readonly displaySummary: string;
  readonly generatedAt: number;
  readonly ageMs: number;
  readonly stale: boolean;
}

export function buildMechanicReportView(run: MechanicRunLike | null | undefined, nowMs: number): MechanicReportView | null {
  if (!run || !Number.isFinite(run.generatedAt)) return null;
  const reports = (Array.isArray(run.reports) ? run.reports : []) as readonly MechanicReportLike[];
  const report = reports.find((r) => (r as { agentId?: unknown })?.agentId === AI_MECHANIC_ID);
  if (!report) return null;
  const ageMs = Math.max(0, nowMs - run.generatedAt);
  const diagnosis = mapMechanicReport(report);
  const rawHeadline = typeof report.headline === 'string'
    ? stripControlChars(report.headline).replace(/\s+/g, ' ').trim().slice(0, DISPLAY_SUMMARY_MAX) : '';
  return {
    diagnosis,
    displaySummary: rawHeadline || diagnosis.summary,
    generatedAt: run.generatedAt,
    ageMs,
    stale: ageMs > MECHANIC_REPORT_STALE_MS,
  };
}

/** "3 dk önce" gibi kısa yaş metni. */
export function formatReportAge(ageMs: number): string {
  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

/**
 * Servise/ustaya gösterilecek düz metin. Ölçülen DTC kodları (varsa) eklenir;
 * rapor kanıtsızsa neden YAZILMAZ, bunun nedeni yazılır.
 */
export function buildServiceReportText(
  view: MechanicReportView,
  dtcCodes: readonly string[],
  vehicleLabel: string | null,
): string {
  const d = view.diagnosis;
  const lines: string[] = ['CarOS — Araç Ustası raporu'];
  if (vehicleLabel) lines.push(`Araç: ${vehicleLabel}`);
  lines.push(`Tarih: ${new Date(view.generatedAt).toLocaleString('tr-TR')}${view.stale ? ' (eski değerlendirme)' : ''}`);
  lines.push(`Özet: ${view.displaySummary}`);
  lines.push(`Aciliyet: ${d.risk}${d.availability === 'sufficient' ? ` · güven %${d.confidence}` : ''}`);
  lines.push(`Arıza kodları: ${dtcCodes.length > 0 ? dtcCodes.join(', ') : 'okunmadı / yok'}`);
  const causes = d.topCause ? [d.topCause, ...d.otherCauses] : [];
  if (causes.length > 0) {
    lines.push('Olası nedenler:');
    for (const c of causes) lines.push(`- ${c.description} (%${c.confidence})`);
  } else if (d.insufficientDataNote) {
    lines.push(`Not: ${d.insufficientDataNote}`);
  }
  if (d.evidence.length > 0) { lines.push('Kanıt:'); for (const e of d.evidence) lines.push(`- ${e}`); }
  if (d.counterEvidence.length > 0) { lines.push('Karşı kanıt:'); for (const e of d.counterEvidence) lines.push(`- ${e}`); }
  if (d.nextSteps.length > 0) { lines.push('Önerilen güvenli kontroller:'); for (const s of d.nextSteps) lines.push(`- ${s}`); }
  lines.push('Bu rapor ölçülen verilerden üretilmiştir; kesin teşhis için usta kontrolü gerekir.');
  return lines.join('\n');
}
