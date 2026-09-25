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
  if (d.evidence.length > 0) { lines.push('Kanıt:'); for (const e of d.evidence) lines.push(`- ${plainEvidence(e)}`); }
  if (d.counterEvidence.length > 0) { lines.push('Karşı kanıt:'); for (const e of d.counterEvidence) lines.push(`- ${plainEvidence(e)}`); }
  if (d.nextSteps.length > 0) { lines.push('Önerilen güvenli kontroller:'); for (const s of d.nextSteps) lines.push(`- ${s}`); }
  lines.push('Bu rapor ölçülen verilerden üretilmiştir; kesin teşhis için usta kontrolü gerekir.');
  return lines.join('\n');
}

/* ── Kanıt satırlarının kullanıcı dili ───────────────────────────────────────
 * Kanıt metinleri teşhis/geliştirici katmanında üretilir ("Handshake sonucu:
 * fail (timeout)", "speed=0km/h (valid, güven 60%)"); CAROS LAB ve Mavi de aynı
 * metni okur, bu yüzden KAYNAKTA değiştirilmez. Yalnız kullanıcı kartında sade
 * Türkçeye çevrilir; tanınmayan satır olduğu gibi kalır (anlam UYDURULMAZ). */

const SIGNAL_LABEL: Readonly<Record<string, string>> = {
  speed: 'Hız', rpm: 'Motor devri', coolantTemp: 'Motor sıcaklığı', engineTemp: 'Motor sıcaklığı',
  batteryVoltage: 'Akü voltajı', voltage: 'Akü voltajı', fuelLevel: 'Yakıt seviyesi',
  throttle: 'Gaz pedalı', intakeTemp: 'Emme havası sıcaklığı', engineLoad: 'Motor yükü',
};
const SIGNAL_STATE: Readonly<Record<string, string>> = {
  valid: 'ölçüldü', stale: 'eski ölçüm', suspect: 'şüpheli ölçüm',
};

export function plainEvidence(text: string): string {
  let m = /^Handshake sonucu: (\w+)(?: \((.+)\))?/.exec(text);
  if (m) {
    const ok = /^(ok|success|connected)$/i.test(m[1]);
    if (ok) return 'OBD adaptörüyle bağlantı kuruldu';
    return `OBD adaptörüyle bağlantı kurulamadı${m[2] && /timeout/i.test(m[2]) ? ' (adaptör yanıt vermedi)' : ''}`;
  }
  if (/^Handshake bu oturumda çalışmadı/.test(text)) return 'OBD bağlantısı bu oturumda hiç kurulmadı';
  if (/^Zorlanan protokol \S+ aktif değil/.test(text)) return 'Ayarlarda seçilen OBD protokolü bu araçla eşleşmedi';
  m = /^Aktif protokol: (.+)$/.exec(text);
  if (m) return `OBD protokolü: ${m[1]}`;
  if (/^Reconnect baskısı [\d.]+ — bağlantı kararsız/.test(text)) return 'OBD bağlantısı son dakikalarda birkaç kez koptu';
  if (/^Reconnect baskısı [\d.]+ — yakın zamanda bir kopma/.test(text)) return 'OBD bağlantısı yakın zamanda bir kez koptu';
  if (/^Reconnect baskısı [\d.]+ — sönümlenmiş/.test(text)) return 'Daha önce bir bağlantı kopması olmuş; şu an sorun görünmüyor';
  m = /^(\d+) reconnect kaydı \((\d+) timeout\)/.exec(text);
  if (m) return `Bu oturumda ${m[1]} kez yeniden bağlanma denendi${Number(m[2]) > 0 ? ` (${m[2]} kez yanıt gelmedi)` : ''}`;
  m = /^Bağlantı kalitesi %(\d+)/.exec(text);
  if (m) return `OBD bağlantı kalitesi %${m[1]}`;
  m = /^(\w+)=([-\d.]+)(\S*) \((\w+), güven (\d+)%\)$/.exec(text);
  if (m) {
    const label = SIGNAL_LABEL[m[1]] ?? m[1];
    const state = SIGNAL_STATE[m[4]] ?? m[4];
    return `${label}: ${m[2]}${m[3] ? ` ${m[3]}` : ''} (${state})`;
  }
  return text;
}
