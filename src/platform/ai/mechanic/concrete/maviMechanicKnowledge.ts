/**
 * maviMechanicKnowledge — Bilgi Beyni composition root (kod bazlı otomotiv bilgisi).
 *
 * ⚠️ YENİ TEŞHİS MOTORU / YENİ AI ALTYAPISI / YENİ DEPO YOK. İki MEVCUT
 * deterministik kaynak SALT OKUNUR okunur:
 *
 *   1) `resolveDtcRecord(code)` — bundled DTC kataloğu (dtcDataSource). Yalnız
 *      YÜKLENMİŞ kayıtlara bakar; ağ/lazy indirme TETİKLEMEZ.
 *   2) `diagnoseDtc(code)` — MEVCUT `diagnosticKnowledgeEngine`; yalnız var olan
 *      araç/üretici bilgi depolarını OKUR (kronik/geçmiş gözlem sayıları). Yeni
 *      OBD sorgusu YAPMAZ, hiçbir yere YAZMAZ.
 *
 * Teşhisin güven yüzdesi/riski/nedenleri DEĞİŞMEZ — bu blok yalnız kod bazlı
 * GENEL bilgi ekler. Fail-closed: şalter kapalı / kaynak yok / hata → BOŞ blok
 * (asistan akışı ETKİLENMEZ, uydurma bilgi ÜRETİLMEZ). ASLA throw etmez.
 */

import { resolveDtcRecord } from '../../../obd/dtcDataSource';
import { diagnoseDtc } from '../../../diagnosticKnowledgeEngine';
import { isMaviMechanicKnowledgeEnabled } from '../../gateway/aiGatewayFlag';
import {
  buildVehicleKnowledgeReport,
  buildKnowledgeCard,
  MAX_KNOWLEDGE_CODES,
  type KnowledgeSource,
} from '../knowledgeMapper';
import { serializeVehicleKnowledge } from '../knowledgeSerializer';
import type { MechanicDiagnosis } from '../mechanicTypes';
import type { KnowledgeTelemetry, VehicleKnowledgeCard, VehicleKnowledgeReport } from '../knowledgeTypes';

export interface KnowledgeOutcome {
  /** System prompt'a eklenecek etiketli blok; yoksa BOŞ. */
  readonly block:     string;
  readonly report?:   VehicleKnowledgeReport;
  readonly telemetry: KnowledgeTelemetry;
}

const DISABLED: KnowledgeOutcome = {
  block: '',
  telemetry: { enabled: false, requestedCount: 0, foundCount: 0, cardCount: 0 },
};

/**
 * Bir kod için MEVCUT kaynaklardan birleşik bilgi kaynağı — SALT OKUNUR, fail-soft.
 * Her kaynak ayrı try/catch ile izole; biri düşse diğeri korunur.
 */
function resolveKnowledge(code: string): KnowledgeSource {
  let record: KnowledgeSource['record'] = null;
  try { record = resolveDtcRecord(code) ?? null; } catch { record = null; }

  let vehicleSeenCount = 0;
  let manufacturerSeenCount = 0;
  try {
    const insight = diagnoseDtc(code);              // MEVCUT motor — yalnız okur
    vehicleSeenCount = insight.vehicleSeenCount ?? 0;
    manufacturerSeenCount = insight.manufacturerSeenCount ?? 0;
  } catch { /* fail-soft: gözlem sayıları olmadan da kart üretilir */ }

  return { record, vehicleSeenCount, manufacturerSeenCount };
}

/**
 * Teşhisten çıkarılan arıza kodları için bilgi notu bloğunu üretir.
 * `diagnosis` yoksa (teşhis üretilememişse) bilgi notu da üretilmez.
 */
export function buildVehicleKnowledgeBlock(diagnosis: MechanicDiagnosis | undefined): KnowledgeOutcome {
  try {
    if (!isMaviMechanicKnowledgeEnabled()) return DISABLED;
    if (!diagnosis) return { ...DISABLED, telemetry: { ...DISABLED.telemetry, enabled: true } };

    const report = buildVehicleKnowledgeReport(diagnosis, resolveKnowledge);
    const block = serializeVehicleKnowledge(report);

    return {
      block,
      report,
      telemetry: {
        enabled:        true,
        requestedCount: report.requestedCodes.length,
        foundCount:     report.cards.filter((c) => c.found).length,
        cardCount:      report.cards.length,
      },
    };
  } catch {
    return { ...DISABLED, telemetry: { ...DISABLED.telemetry, enabled: true } };
  }
}

/**
 * KULLANICININ VERDİĞİ arıza kodları için bilgi notu üretir (ör. "P0401 ne demek?").
 * Teşhisten değil, doğrudan kod listesinden çalışır — MEVCUT Bilgi Beyni saf
 * fonksiyonlarını (buildKnowledgeCard + serializeVehicleKnowledge) yeniden kullanır.
 * YENİ MOTOR/DEPO YOK, yeni OBD sorgusu YOK. Aynı şalter kapısına tabidir
 * (fail-closed). Kod bilgi tabanında yoksa AÇIKÇA belirtilir (uydurma yok).
 */
export function buildVehicleKnowledgeBlockForCodes(codes: readonly string[]): KnowledgeOutcome {
  try {
    if (!isMaviMechanicKnowledgeEnabled()) return DISABLED;

    const bounded = [...new Set((codes ?? [])
      .filter((c): c is string => typeof c === 'string' && !!c)
      .map((c) => c.toUpperCase()))].slice(0, MAX_KNOWLEDGE_CODES);
    if (bounded.length === 0) return { ...DISABLED, telemetry: { ...DISABLED.telemetry, enabled: true } };

    const cards: VehicleKnowledgeCard[] = bounded.map((code) => buildKnowledgeCard(code, resolveKnowledge(code)));
    const report: VehicleKnowledgeReport = { cards, requestedCodes: bounded, available: true };
    const block = serializeVehicleKnowledge(report);

    return {
      block,
      report,
      telemetry: {
        enabled:        true,
        requestedCount: report.requestedCodes.length,
        foundCount:     report.cards.filter((c) => c.found).length,
        cardCount:      report.cards.length,
      },
    };
  } catch {
    return { ...DISABLED, telemetry: { ...DISABLED.telemetry, enabled: true } };
  }
}
