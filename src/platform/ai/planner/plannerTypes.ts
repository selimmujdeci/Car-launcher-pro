/**
 * plannerTypes — Mavi Planner sözleşmeleri (SAĞLAYICI-BAĞIMSIZ).
 *
 * Planner, mevcut Tool Router kataloğu üzerinde HANGİ araçların HANGİ SIRAYLA
 * kullanılmasının mantıklı olduğuna karar verir. ARAÇ ÇALIŞTIRMAZ: çıktı yalnız
 * bir PLANDIR. Yürütme (Faz 2) ayrı bir katmandır.
 *
 * Bu dosya IO İÇERMEZ; sağlayıcı adı GEÇMEZ.
 */

import type { ToolEffect } from '../tools/toolTypes';
import type { MaviTaskType } from '../orchestrator/orchestratorTypes';

/** Bir adımın yürütülebilirlik durumu — planlanır ama çalıştırılmaz. */
export type PlanStepStatus =
  | 'ready'               // güvenli ve yürütülebilir (Faz 2'de çalıştırılabilir)
  | 'needs_confirmation'  // RİSKLİ: planlanır ama kullanıcı onayı olmadan ÇALIŞMAZ
  | 'not_permitted';      // katalogda yok / yasak yan etki → ASLA çalıştırılmaz

export interface MaviPlanStep {
  /** 1'den başlayan sıra (deterministik). */
  readonly order:      number;
  readonly toolName:   string;
  readonly effect:     ToolEffect;
  /** Şemaya uygun sabit argümanlar (planner serbest metin ÜRETMEZ). */
  readonly arguments:  Readonly<Record<string, string | number | boolean>>;
  readonly status:     PlanStepStatus;
  /** Neden bu adım seçildi — kapalı küme (kullanıcı verisi İÇERMEZ). */
  readonly reason:     PlanStepReason;
}

/** Adım gerekçesi — serbest metin DEĞİL, sabit jetonlar. */
export type PlanStepReason =
  | 'task_requires_connection'
  | 'task_requires_live_data'
  | 'task_requires_diagnostics'
  | 'user_requested_navigation';

/** Planın bütününe dair sonuç. */
export type PlanStatus =
  | 'empty'              // bu görev için plan gerekmiyor
  | 'ready'              // tüm adımlar yürütülebilir
  | 'partially_blocked'  // bazı adımlar onay/izin bekliyor
  | 'blocked';           // hiçbir adım yürütülemez

export interface MaviPlan {
  readonly taskType:  MaviTaskType;
  readonly steps:     readonly MaviPlanStep[];
  readonly status:    PlanStatus;
  /** Azami adım sınırına takılıp adım DÜŞTÜ mü (dürüst bildirim). */
  readonly truncated: boolean;
}

/** Planlayıcıya verilen katalog girdisi (Tool Router'dan türetilir). */
export interface PlannerToolInfo {
  readonly name:                 string;
  readonly effect:               ToolEffect;
  readonly requiresConfirmation?: boolean;
  /** Katalogda GÖRÜNÜR mü (router izin kapılarından geçti mi). */
  readonly available:            boolean;
  /** Şemada tanımlı parametre adları — planner yalnız bunları doldurabilir. */
  readonly parameterNames:       readonly string[];
  /** `enum` parametrelerin izinli değerleri (allowlist). */
  readonly enumValues?:          Readonly<Record<string, readonly string[]>>;
}

/** Kullanıcı isteğinden türetilen DETERMİNİSTİK ipuçları (AI YOK). */
export interface PlannerHints {
  /** Kullanıcı belirli bir ekran istediyse kanonik kimliği. */
  readonly screenId?: string;
  /** Tanı (arıza kodu) sorusu mu — plan gereksiz araç eklemez. */
  readonly wantsDiagnostics?: boolean;
  /** Anlık ölçüm sorusu mu. */
  readonly wantsLiveData?: boolean;
}

/** YALNIZ güvenli metadata — argüman/kullanıcı metni TAŞIMAZ. */
export interface PlanTelemetry {
  readonly taskType:       MaviTaskType;
  readonly plannerEnabled: boolean;
  readonly stepCount:      number;
  readonly readySteps:     number;
  readonly blockedSteps:   number;
  readonly truncated:      boolean;
  readonly status:         PlanStatus;
}
