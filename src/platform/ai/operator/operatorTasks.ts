/**
 * operatorTasks — Operatör görev KATALOĞU (deterministik reçeteler).
 *
 * Her görev, MEVCUT katmanların hangi parçalarının hangi ayarla çalışacağını
 * SABİT olarak tanımlar. Serbest metin / AI / rastgelelik YOK → aynı görev her
 * zaman aynı reçeteyi verir. Katalogda olmayan araç eklenmez (Planner kendi
 * allowlist'ini uygular).
 *
 * Reçete alanları:
 *  - planTaskType : Planner'a verilecek görev tipi (hangi salt-okunur araçlar).
 *  - hints        : niyet filtresi (canlı veri / tanı).
 *  - includeMechanic : MEVCUT AI Usta bloğunu (teşhis + geçmiş + Bilgi Beyni) ekle.
 */

import type { PlannerHints } from '../planner/plannerTypes';
import type { MaviTaskType } from '../orchestrator/orchestratorTypes';
import type { OperatorTaskId } from './operatorTypes';

export interface OperatorRecipe {
  /** Kullanıcı-okur sabit etiket (rapor başlığı). */
  readonly label:           string;
  /** Planner görev tipi — verilmezse plan/araç yürütme YAPILMAZ. */
  readonly planTaskType?:   MaviTaskType;
  readonly hints?:          PlannerHints;
  /** MEVCUT AI Usta bloğu (teşhis + geçmiş + Bilgi Beyni açıklamaları) eklensin mi. */
  readonly includeMechanic: boolean;
}

/**
 * Görev reçeteleri. Not: `dtc_report` ve `unified_report` `includeMechanic:true`
 * ile Bilgi Beyni açıklamalarını da taşır (AI Usta bloğu Bilgi Beyni'ni zaten
 * kendi içinde birleştirir).
 */
export const OPERATOR_TASKS: Readonly<Record<OperatorTaskId, OperatorRecipe>> = {
  // Araç sağlık kontrolü — bağlantı + canlı + DTC + teşhis/geçmiş/bilgi.
  health_check: {
    label:           'Araç sağlık kontrolü',
    planTaskType:    'vehicle_question',
    includeMechanic: true,
  },
  // Hata kodlarını oku ve raporla — bağlantı + DTC (canlı ölçüm dışarıda) + bilgi.
  dtc_report: {
    label:           'Hata kodu raporu',
    planTaskType:    'technical_analysis',
    hints:           { wantsDiagnostics: true, wantsLiveData: false },
    includeMechanic: true,
  },
  // Araç durum özeti — bağlantı + canlı ölçüm (teşhis eklenmez, hızlı özet).
  status_summary: {
    label:           'Araç durum özeti',
    planTaskType:    'long_explanation',
    hints:           { wantsLiveData: true },
    includeMechanic: false,
  },
  // Son teşhisleri özetle — yeni araç sorgusu YOK; yalnız mevcut teşhis + geçmiş.
  diagnosis_summary: {
    label:           'Son teşhis özeti',
    includeMechanic: true,
  },
  // Tek birleşik rapor — tüm salt-okunur veriler + teşhis + geçmiş + bilgi.
  unified_report: {
    label:           'Birleşik araç raporu',
    planTaskType:    'vehicle_question',
    includeMechanic: true,
  },
};

/** Bilinen görev mi? (bilinmeyen görev fail-closed boş rapora düşer.) */
export function isOperatorTaskId(value: unknown): value is OperatorTaskId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(OPERATOR_TASKS, value);
}
