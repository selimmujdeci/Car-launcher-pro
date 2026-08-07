/**
 * aiMechanicSources.ts — AI MECHANIC'in TEK OKUMA NOKTASI (senkron · fail-soft).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────
 *  · YALNIZ İKİ KAYNAK okunur (paket şartı §3):
 *        MAVI Reasoning Engine  ·  AI Evidence Engine
 *    Başka HİÇBİR modül doğrudan okunmaz (OBD · Trip · DNA · Fleet · HAL…).
 *    Bir teşhis, kararın arkasından dolanarak ham sinyale bakarsa MAVI'nin
 *    otoritesi delinmiş olur.
 *  · Ağ çağrısı YOK · timer YOK · abonelik YOK · yazma YOK · LLM YOK.
 *  · Okuma patlarsa `null` döner → ekran "okunamadı" der (boş küme VARSAYILMAZ).
 */

import { readMaviReasoning } from '../reasoning/maviReasoningEngine';
import {
  analysisFromReasoning, summarizeAnalyses,
  type MechanicAnalysis, type MechanicSummary,
} from './aiMechanicModel';

/** `fn` çalışırsa sonucu, patlarsa `null` (→ "okunamadı" beyanı). */
function safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/** LAB ekranının tek seferlik, yan etkisiz okuması. */
export interface MechanicReadout {
  readonly readAt: number;
  /**
   * Karar kaynağı — `NONE` ise sunucu köprüsü bağlı DEĞİLDİR.
   * Bu durumda analiz listesinin boş olması "sorun yok" DEMEK DEĞİLDİR.
   */
  readonly source: 'NONE' | 'SERVER';
  /** MAVI defterindeki toplam karar (kapsam dışı olanlar DAHİL). */
  readonly reasoningTotal: number;
  /**
   * Mekanik teşhis kapsamı DIŞINDA kalan karar sayısı (DRIVER/FLEET/…).
   * Görünür tutulur: "neden 12 karardan yalnız 5 analiz var" sorusu yanıtsız kalmasın.
   */
  readonly outOfScopeCount: number;
  /** REJECTED olduğu için analiz üretilmeyen karar sayısı. */
  readonly rejectedCount: number;
  readonly analyses: readonly MechanicAnalysis[];
  readonly summary: MechanicSummary;
}

/**
 * Tek okuma — MAVI defterini AI Mechanic analizlerine çevirir.
 *
 * `nowMs` DIŞARIDAN gelir: bu katman saat OKUMAZ (saf kalır, test edilebilir).
 * Dönen `null` "okuma başarısız" demektir; boş liste ile KARIŞTIRILMAZ.
 */
export function readAiMechanic(nowMs: number): MechanicReadout | null {
  const reasoning = safe(() => readMaviReasoning(nowMs));
  if (reasoning === null) return null;

  const entries = reasoning.ledger?.entries ?? [];
  const analyses: MechanicAnalysis[] = [];
  let outOfScope = 0;
  let rejected = 0;

  for (const e of entries) {
    if (e.decision === 'REJECTED') { rejected++; continue; }
    const a = analysisFromReasoning({
      reasoningId:      e.reasoningId,
      intent:           e.intent,
      decision:         e.decision,
      confidence:       e.confidence,
      confidenceReason: e.confidenceReason,
      state:            e.state,
      // Kanıt/çelişki sayısı MAVI'den; çelişki defterde ayrı alan olarak
      // taşınmadığı için karar KODUNDAN türetilir (uydurma sayı YOK).
      evidenceCount:    e.evidenceIds.length,
      conflictCount:    e.decision === 'CONFLICTED_EVIDENCE' ? 1 : 0,
      vehicleId:        e.vehicleId,
      driverId:         e.driverId,
      tripId:           e.tripId,
      createdAt:        new Date(e.createdAt).toISOString(),
      evidenceIds:      e.evidenceIds,
      // Metrik adları defterde YOK → COOLING ayrımı burada YAPILAMAZ.
      // Sunucu tarafı (`get_ai_mechanic_analyses`) metriği görür ve ayırır;
      // burada TEMPERATURE kalır. Uydurulmuş bir COOLING teşhisi YASAK.
      evidenceMetrics:  undefined,
    });
    if (a === null) { outOfScope++; continue; }
    analyses.push(a);
  }

  return Object.freeze({
    readAt:          nowMs,
    source:          reasoning.source,
    reasoningTotal:  entries.length,
    outOfScopeCount: outOfScope,
    rejectedCount:   rejected,
    analyses:        Object.freeze(analyses),
    summary:         summarizeAnalyses(analyses),
  });
}
