/**
 * aiCore/agents/agentContract.ts — AJAN SÖZLEŞMESİ (sonraki ajanlar için genişletilebilir).
 *
 * AMAÇ: Her AI Core ajanının (Faz-1: yalnız AI Mechanic; sonra Enerji Koçu, Sürüş Analisti,
 * Güvenlik Gözcüsü…) uyacağı TEK arayüz. Orchestrator ajanları bu sözleşmeyle çalıştırır →
 * yeni ajan eklemek Orchestrator'ı DEĞİŞTİRMEZ (açık/kapalı ilkesi).
 *
 * SÖZLEŞME GARANTİLERİ:
 *  - `analyze` SAF/deterministiktir (aynı girdi → aynı rapor). LLM çağrısı YOK — açıklama
 *    katmanı Orchestrator'da AYRI/opsiyonel (bkz. AiExplainer). Böylece karar offline kalır.
 *  - Ajan yalnız READ girdisi alır (context/evidence/verdict/memory) — yazma yolu yok.
 *  - `requiredScope` daima 'read' (Faz-1). Orchestrator eylemi Safety Gate'ten geçirir.
 */

import type { AiAgentReport } from '../types';
import type { AiCapabilityScope } from '../safetyGate';
import type { VehicleContext } from '../vehicleContext';
import type { AiCoreVerdict } from '../verdictEngine';
import type { EvidenceStore } from '../evidenceStore';
import type { VehicleMemoryFact } from '../vehicleMemory';

/** Bir ajanın analiz için aldığı read-only girdi demeti. */
export interface AiAgentAnalysisInput {
  readonly context: VehicleContext;
  /** Bağlamdan türetilmiş kanıtın biriktiği depo (read-only sorgu). */
  readonly evidence: EvidenceStore;
  /** Deterministik karar motorunun verdikti. */
  readonly verdict: AiCoreVerdict;
  /** Bu araç için hatırlanan öğrenilmiş gerçekler (varsa). */
  readonly memory: readonly VehicleMemoryFact[];
  readonly now: number;
}

/**
 * AI Core ajanı. `analyze` deterministik, read-only, explainable bir rapor döndürür.
 * `explanation` alanı burada DAİMA null'dır — LLM narrasyonu Orchestrator'da opsiyonel
 * olarak eklenir (karar otoritesi değil).
 */
export interface AiAgent {
  readonly id: string;
  readonly title: string;
  /** Faz-1'de daima 'read' — Orchestrator bunu Safety Gate'ten geçirir. */
  readonly requiredScope: AiCapabilityScope;
  analyze(input: AiAgentAnalysisInput): AiAgentReport;
}

/**
 * Opsiyonel LLM AÇIKLAMA kancası. Deterministik raporu alır, doğal-dil özeti döndürür
 * (veya null → LLM yok/başarısız). Sync veya async olabilir. KARAR OTORİTESİ DEĞİL —
 * yalnız `explanation` alanını doldurur; raporun kararını DEĞİŞTİREMEZ.
 */
export type AiExplainer = (report: AiAgentReport) => Promise<string | null> | string | null;
