/**
 * aiCore/verdictEngine.ts — DETERMİNİSTİK KARAR MOTORU (offline · LLM'siz).
 *
 * AMAÇ: AI Core'un karar otoritesi. Mevcut Diagnostics V2 kök-neden motorunu
 * (`buildDiagnosticVerdict` — RootCauseHypothesis + InconclusiveNote) SARAR ve üstüne AI
 * Core aciliyet (urgency) + genel güven zarfı ekler. İKİNCİ KARAR MOTORU KURMAZ — mevcut
 * kuralları/hipotezleri yeniden kullanır (tek otorite).
 *
 * ANAYASA (görev sözleşmesi): "Bulut/LLM zorunlu olmasın; deterministik karar motoru
 * offline çalışsın." Bu modül TAMAMEN offline + saftır; ağ/LLM/DOM/native YOK. LLM (varsa)
 * yalnız ajan katmanında açıklama üretir, BU motorun kararını DEĞİŞTİRMEZ.
 *
 * "8 Kapı" gate-8 (en doğru aksiyon ne kadar acele?): aciliyet, kök-neden severity +
 * KANITTAN türeyen confidence + kritik DTC varlığından türetilir (sabit değil).
 */

import { buildDiagnosticVerdict } from '../diagnosticTriage';
import type {
  TriageSections, ErrorLedgerLike, RootCauseHypothesis, InconclusiveNote,
} from '../diagnosticTriage';
import type { AiUrgency } from './types';
import { maxUrgency } from './types';

export interface AiCoreVerdict {
  /** Tek satır sonuç (Diagnostics V2 headline — dosya işaretçili). */
  readonly headline: string;
  readonly urgency: AiUrgency;
  /** 0..100 — en güçlü hipotezin güveni (aktif kök-neden yoksa 0). */
  readonly confidence: number;
  /** Güvene göre sıralı kök-neden hipotezleri (≤10, mevcut motordan). */
  readonly topRootCauses: readonly RootCauseHypothesis[];
  /** Sonuca varılamayan subsystem beyanları (eksik kanıtla). */
  readonly inconclusive: readonly InconclusiveNote[];
  readonly hasActiveRootCause: boolean;
}

/**
 * Kök-neden severity + confidence → temel aciliyet. Eskalasyon güvenlik lehine
 * (kritik yüksek-güven → critical); düşük güven kritik yine dikkat ister ama daha düşük.
 */
function urgencyFromHypothesis(top: RootCauseHypothesis | undefined): AiUrgency {
  if (!top) return 'none';
  if (top.severity === 'critical') {
    if (top.confidence >= 70) return 'critical';
    if (top.confidence >= 40) return 'urgent';
    return 'soon';
  }
  if (top.severity === 'warning') {
    return top.confidence >= 60 ? 'soon' : 'watch';
  }
  return 'watch';   // info
}

/** Bölümlerde KRİTİK DTC var mı → aciliyet tabanı yükselir (arıza kodu = somut kanıt). */
function hasCriticalDtc(sections: TriageSections): boolean {
  const codes = sections?.obdDeep?.dtc?.codes;
  if (!Array.isArray(codes)) return false;
  return codes.some((c) => c && c.severity === 'critical');
}

/**
 * Diagnostics bölümlerinden deterministik AI Core verdikti üretir. SAF/offline. Aktif
 * kök-neden yoksa güven 0 ve aciliyet 'none' (inconclusive varsa 'watch' — "belirsiz, gözle").
 */
export function buildAiCoreVerdict(
  sections: TriageSections,
  errorLedger?: ErrorLedgerLike | null,
): AiCoreVerdict {
  const dv = buildDiagnosticVerdict(sections ?? {}, errorLedger ?? null);
  const top = dv.topRootCauses[0];

  let urgency = urgencyFromHypothesis(top);
  // Kritik DTC varsa aciliyet en az 'urgent' (somut arıza kanıtı bastırılmaz).
  if (hasCriticalDtc(sections ?? {})) urgency = maxUrgency(urgency, 'urgent');
  // Aktif kök-neden yok ama belirsizlik var → sessiz kalma, "gözle" seviyesi.
  if (!dv.hasActiveRootCause && dv.inconclusive.length > 0) urgency = maxUrgency(urgency, 'watch');

  return Object.freeze({
    headline: dv.headline,
    urgency,
    confidence: dv.hasActiveRootCause && top ? top.confidence : 0,
    topRootCauses: dv.topRootCauses,
    inconclusive: dv.inconclusive,
    hasActiveRootCause: dv.hasActiveRootCause,
  });
}
