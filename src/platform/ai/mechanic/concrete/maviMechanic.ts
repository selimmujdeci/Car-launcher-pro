/**
 * maviMechanic — AI Usta'nın Mavi'ye bağlanması (composition root).
 *
 * ⚠️ YENİ MOTOR/DEPO YOK. Teşhis, SystemBoot'ta ZATEN çalışan aiCore
 * runtime'ının son sonucundan okunur (`getLastAiMechanicResult()`):
 *   HAL snapshot → evidenceStore → verdictEngine → aiMechanic ajanı.
 * Bu dosya YENİ OBD SORGUSU BAŞLATMAZ, hafıza yazmaz, ajan çalıştırmaz —
 * yalnız SON deterministik sonucu okur ve sunuma çevirir.
 *
 * Fail-closed: şalter kapalı / runtime yok / rapor yok → BOŞ blok (asistan
 * akışı ETKİLENMEZ, uydurma teşhis ÜRETİLMEZ).
 */

import { getLastAiMechanicResult } from '../../../system/platformCoreAiRuntimeWiring';
import { isMaviMechanicEnabled } from '../../gateway/aiGatewayFlag';
import { mapMechanicReport, type MechanicReportLike } from '../mechanicMapper';
import { serializeMechanicDiagnosis } from '../mechanicSerializer';
import { buildMechanicInsightBlock } from './maviMechanicHistory';
import { buildVehicleKnowledgeBlock } from './maviMechanicKnowledge';
import type { MechanicDiagnosis, MechanicTelemetry } from '../mechanicTypes';

/** aiCore ajan kimliği — rapor bu ajandan seçilir. */
const AI_MECHANIC_AGENT_ID = 'ai_mechanic';

export interface MechanicOutcome {
  /** System prompt'a eklenecek etiketli blok; yoksa BOŞ. */
  readonly block:     string;
  readonly diagnosis?: MechanicDiagnosis;
  readonly telemetry: MechanicTelemetry;
}

const DISABLED: MechanicOutcome = {
  block: '',
  telemetry: {
    enabled: false, available: false, causeCount: 0, evidenceCount: 0,
    confidence: 0, risk: 'none', availabilityState: 'unavailable',
  },
};

/**
 * Son deterministik teşhisi okuyup Mavi bloğunu üretir.
 * ASLA throw etmez; hata → BOŞ blok.
 */
export function buildMechanicBlock(): MechanicOutcome {
  try {
    if (!isMaviMechanicEnabled()) return DISABLED;

    const run = getLastAiMechanicResult();
    const reports = (run?.reports ?? []) as readonly MechanicReportLike[];
    const report = reports.find(
      (r) => (r as { agentId?: unknown }).agentId === AI_MECHANIC_AGENT_ID,
    ) ?? reports[0];

    const diagnosis = mapMechanicReport(report ?? null);
    const block = serializeMechanicDiagnosis(diagnosis);

    /* Faz 2 — geçmiş/eğilim/tazelik YORUMU. Teşhis bloğu DEĞİŞMEZ; yorum ayrı
       bütçeli İKİNCİ blok olarak eklenir. Kendi şalteri kapalıysa boş gelir.
       Teşhis bloğu boşsa yorum TEK BAŞINA gönderilmez (bağlamsız yorum olmaz). */
    const insightBlock = block ? buildMechanicInsightBlock(diagnosis, Date.now()).block : '';

    /* Bilgi Beyni — kod bazlı GENEL otomotiv bilgisi (mevcut katalog + bilgi motoru,
       SALT OKUNUR). Teşhis bloğu DEĞİŞMEZ; bilgi notu ayrı bütçeli ÜÇÜNCÜ blok
       olarak eklenir. Kendi şalteri kapalıysa boş gelir. Teşhis bloğu boşsa bilgi
       notu TEK BAŞINA gönderilmez (bağlamsız bilgi olmaz). */
    const knowledgeBlock = block ? buildVehicleKnowledgeBlock(diagnosis).block : '';

    /* Boş olmayan blokları sırayla birleştir — hiçbiri yoksa Faz 1 bloğu
       (veya boş) bayt bayt korunur (tek elemanlı join = kendisi). */
    const combined = [block, insightBlock, knowledgeBlock].filter(Boolean).join('\n\n');

    return {
      block: combined,
      diagnosis,
      telemetry: {
        enabled:           true,
        available:         !!report,
        causeCount:        (diagnosis.topCause ? 1 : 0) + diagnosis.otherCauses.length,
        evidenceCount:     diagnosis.evidence.length,
        confidence:        diagnosis.confidence,
        risk:              diagnosis.risk,
        availabilityState: diagnosis.availability,
      },
    };
  } catch {
    return { ...DISABLED, telemetry: { ...DISABLED.telemetry, enabled: true } };
  }
}
