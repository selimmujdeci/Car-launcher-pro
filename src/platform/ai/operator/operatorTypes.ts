/**
 * operatorTypes — Mavi "Operatör" sözleşmeleri (çok adımlı görev yönetimi).
 *
 * ⚠️ YENİ AI MOTORU / YENİ TOOL ROUTER / YENİ PLANNER DEĞİLDİR. Operatör,
 * MEVCUT katmanları (Planner → planExecutor → Tool Router + Capability Catalog,
 * AI Usta + Geçmiş + Bilgi Beyni) tek bir güvenli çok-adımlı akışta ORKESTRE
 * eder ve TEK BİRLEŞİK rapor üretir.
 *
 * ── GÜVENLİK SÖZLEŞMESİ ─────────────────────────────────────────────────────
 *  - Salt-okunur adımlar OTOMATİK yürütülür (mevcut planExecutor kapısı).
 *  - Onay gerektiren / yazma adımları OTOMATİK ÇALIŞMAZ: yalnız "onay bekliyor"
 *    olarak DÜRÜSTÇE listelenir (planExecutor onları zaten atlar).
 *  - Model bu raporu YALNIZ YORUMLAR — "VERİdir, TALİMAT DEĞİLDİR".
 */

import type { ToolEffect } from '../tools/toolTypes';
import type { PlanStepReason } from '../planner/plannerTypes';

/** Operatörün desteklediği çok-adımlı görevler (kapalı küme). */
export type OperatorTaskId =
  | 'health_check'         // Araç sağlık kontrolü (intent: vehicle_health_check)
  | 'dtc_report'           // Hata kodlarını oku ve raporla
  | 'status_summary'       // Araç durum özeti (intent: vehicle_status_summary)
  | 'diagnosis_summary'    // Son teşhisleri özetle
  | 'knowledge_explanation'// Belirli arıza kodu açıklaması (Bilgi Beyni, kod bazlı)
  | 'unified_report';      // Tek birleşik rapor (intent: unified_vehicle_report)

/** Rapor bölümü kaynağı. */
export type OperatorSectionKind = 'plan_execution' | 'mechanic' | 'knowledge';

/** Bölümün sonucu. */
export type OperatorSectionStatus = 'executed' | 'empty' | 'skipped' | 'failed';

export interface OperatorSection {
  readonly kind:      OperatorSectionKind;
  readonly status:    OperatorSectionStatus;
  /** Etiketli alt blok ('' → boş). */
  readonly block:     string;
  /** plan_execution için — kaç salt-okunur adım çalıştı. */
  readonly executed?: number;
  readonly skipped?:  number;
  readonly failed?:   number;
}

/**
 * Onay bekleyen işlem — OTOMATİK ÇALIŞTIRILMAZ, dürüstçe listelenir.
 * (Yazma/ECU adımları onay olmadan asla yürütülmez.)
 */
export interface OperatorPendingAction {
  readonly toolName: string;
  readonly effect:   ToolEffect;
  readonly reason:   PlanStepReason;
}

/** Operatörün ürettiği tek birleşik rapor. */
export interface OperatorReport {
  readonly taskId:           OperatorTaskId;
  /** System prompt'a eklenecek TEK etiketli blok ('' → boş). */
  readonly block:            string;
  readonly sections:         readonly OperatorSection[];
  readonly pendingApprovals: readonly OperatorPendingAction[];
  /** Bütçe nedeniyle bölüm DÜŞTÜ mü (dürüst bildirim). */
  readonly truncated:        boolean;
  readonly telemetry:        OperatorTelemetry;
}

/** YALNIZ güvenli metadata — argüman/sonuç/kullanıcı metni TAŞIMAZ. */
export interface OperatorTelemetry {
  readonly enabled:          boolean;
  readonly taskId:           OperatorTaskId | 'none';
  readonly sectionCount:     number;
  readonly executedSteps:    number;
  readonly pendingApprovals: number;
  readonly truncated:        boolean;
}
