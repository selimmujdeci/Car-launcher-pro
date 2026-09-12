/**
 * taskStrategies — görev tipi başına varsayılan seçim stratejisi.
 *
 * Strateji İKİ parçadır:
 *   1) `required` → ZORUNLU yetenekler. Sağlamayan aday ELENİR (fail-closed:
 *      "belki yapar" diye denenmez).
 *   2) ağırlıklar → kalan adaylar arasında SIRALAMA. Toplamları 1 olmak zorunda
 *      değildir; puan normalize edilir.
 *
 * Sağlayıcı adı GEÇMEZ — tamamen yetenek düzeyinde tanımlıdır.
 */

import type { MaviTaskType, OrchestratorPolicy, TaskStrategy } from './orchestratorTypes';

/**
 * Araç içi kullanımın değişmez gerçeği: sürücü BEKLEYEMEZ. Bu yüzden hemen her
 * görevde gecikme ağırlığı sıfırdan büyüktür; "uzun açıklama" ve "kod analizi"
 * gibi derinlik isteyen görevlerde bile güvenilirlik gecikmeden önce gelmez.
 */
export const DEFAULT_TASK_STRATEGIES: Readonly<Record<MaviTaskType, TaskStrategy>> = {
  /* Genel sohbet: hızlı ve ucuz olsun; derinlik ikincil. */
  general_chat: {
    required:          [],
    weightLatency:     0.45,
    weightCost:        0.30,
    weightReliability: 0.20,
    weightReasoning:   0.05,
    weightLongContext: 0.00,
  },

  /* Araç soruları: yanlış cevap güven kaybettirir → güvenilirlik ÖNCE,
     ardından gecikme. Akıl yürütme orta önemde (belirti→neden çıkarımı). */
  vehicle_question: {
    required:          [],
    weightLatency:     0.30,
    weightCost:        0.10,
    weightReliability: 0.40,
    weightReasoning:   0.20,
    weightLongContext: 0.00,
  },

  /* Teknik analiz: akıl yürütme ZORUNLU; maliyet en az önemli. */
  technical_analysis: {
    required:          ['supportsReasoning'],
    weightLatency:     0.15,
    weightCost:        0.05,
    weightReliability: 0.30,
    weightReasoning:   0.35,
    weightLongContext: 0.15,
  },

  /* Kod analizi: uzun bağlam + akıl yürütme ZORUNLU (yarım dosyayla yorum yapılmaz). */
  code_analysis: {
    required:          ['supportsReasoning', 'supportsLongContext'],
    weightLatency:     0.10,
    weightCost:        0.05,
    weightReliability: 0.25,
    weightReasoning:   0.35,
    weightLongContext: 0.25,
  },

  /* Kısa cevap: gecikme her şeyden önemli (sürüşte tek cümle). */
  short_answer: {
    required:          [],
    weightLatency:     0.65,
    weightCost:        0.20,
    weightReliability: 0.15,
    weightReasoning:   0.00,
    weightLongContext: 0.00,
  },

  /* Uzun açıklama: uzun bağlam ZORUNLU; gecikme toleransı yüksek. */
  long_explanation: {
    required:          ['supportsLongContext'],
    weightLatency:     0.15,
    weightCost:        0.15,
    weightReliability: 0.30,
    weightReasoning:   0.20,
    weightLongContext: 0.20,
  },
};

/** Bilinmeyen görev tipinde kullanılacak güvenli varsayılan. */
export const FALLBACK_STRATEGY: TaskStrategy = DEFAULT_TASK_STRATEGIES.general_chat;

/** Politika ezmesi varsa onu, yoksa varsayılanı döndürür. */
export function resolveStrategy(task: MaviTaskType, policy?: OrchestratorPolicy): TaskStrategy {
  return policy?.[task] ?? DEFAULT_TASK_STRATEGIES[task] ?? FALLBACK_STRATEGY;
}
