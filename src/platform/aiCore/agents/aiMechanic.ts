/**
 * aiCore/agents/aiMechanic.ts — İLK AJAN: AI USTA (read-only · explainable · deterministik).
 *
 * AMAÇ (VİZYON — "aracın ikinci beyni · Tesla'dan akıllı"): araç arızalarını yalnız GÖSTERMEZ;
 * DOĞRULAR + YORUMLAR + öngörür. Bu ajan mevcut deterministik verdikti (Verdict Engine) +
 * güvenlik-kritik sinyalleri (soğutucu aşırı ısınma) + öğrenilmiş araç hafızasını (Vehicle
 * Memory) birleştirip EXPLAINABLE bir teşhis üretir:
 *   kanıt · güven · olası nedenler · KARŞI KANIT · sonraki GÜVENLİ kontrol · aciliyet.
 *
 * ANAYASAL SINIRLAR:
 *  - READ-ONLY: hiçbir şey yazmaz/çalıştırmaz (requiredScope='read'; ECU write/coding/actuator
 *    KAPSAM DIŞI — Safety Gate zorlar). Güvenli kontroller yalnız GÖZLEM önerisidir.
 *  - KANIT YOKSA TAHMİN YOK: kanıt boşsa dürüstçe "teşhis üretilemedi" der (uydurma YASAK).
 *  - DETERMİNİSTİK: LLM YOK (açıklama Orchestrator'da opsiyonel). Aynı girdi → aynı rapor.
 *  - EXPLAINABLE: her neden kanıta bağlanır; karşı kanıt aşırı-güveni dengeler (zero-trust).
 */

import type { AiAgent, AiAgentAnalysisInput } from './agentContract';
import type {
  AiAgentReport, AiEvidenceItem, AiPossibleCause, AiCounterEvidence, AiSafeCheck,
  AiInconclusive, AiUrgency,
} from '../types';
import { maxUrgency, urgencyRank } from '../types';
import type { VehicleContext } from '../vehicleContext';
import type { EvidenceStore } from '../evidenceStore';
import type { AiCoreVerdict } from '../verdictEngine';
import type { VehicleMemoryFact } from '../vehicleMemory';

export const AI_MECHANIC_ID = 'ai_mechanic';

/* ── Güvenlik-kritik sinyal eşikleri (VİZYON §C: soğutucu >105°C = overheat) ── */
const COOLANT_OVERHEAT_C = 105;
const COOLANT_HIGH_C = 100;
/** Bağlamda soğutucu sıcaklık sinyalinin olası isimleri (esnek eşleşme). */
const COOLANT_KEYS = ['coolant_temp', 'coolantTemp', 'coolant', 'engine_temp', 'engineTemp'];

const MAX_CAUSES = 6;
const MAX_SAFE_CHECKS = 4;
const MAX_COUNTER = 6;

/* ══════════════════════════════════════════════════════════════════════════
 * Güvenlik-kritik sinyal yorumu (evidence-grounded — sinyal yoksa üretmez)
 * ════════════════════════════════════════════════════════════════════════ */

interface OverheatFinding {
  readonly cause: AiPossibleCause;
  readonly urgency: AiUrgency;
  readonly safeCheck: AiSafeCheck;
  readonly signalKey: string;
}

/** Bağlamdan soğutucu aşırı ısınmasını yorumlar. Sinyal yoksa/normalse → null (uydurma yok). */
function interpretCoolant(ctx: VehicleContext): OverheatFinding | null {
  let name: string | null = null;
  for (const k of COOLANT_KEYS) { if (ctx.signals[k]) { name = k; break; } }
  if (!name) return null;
  const sig = ctx.signals[name];
  if (!sig || sig.value === null || sig.state !== 'valid') return null;   // yalnız GEÇERLİ ölçüm
  const temp = sig.value;
  if (temp < COOLANT_HIGH_C) return null;

  const overheat = temp >= COOLANT_OVERHEAT_C;
  const evKey = `signal.${name}`;
  const cause: AiPossibleCause = {
    code: overheat ? 'ENGINE_OVERHEAT' : 'ENGINE_TEMP_HIGH',
    description: overheat ? 'Motor aşırı ısınması' : 'Motor sıcaklığı yükseliyor',
    confidence: overheat ? Math.round(sig.confidence * 92) : Math.round(sig.confidence * 60),
    supportingEvidence: [evKey],
  };
  return {
    cause,
    urgency: overheat ? 'critical' : 'watch',
    safeCheck: {
      title: overheat ? 'Güvenli yere çek, motoru durdur' : 'Motor sıcaklığını izle',
      detail: overheat
        ? `Soğutucu ${temp}°C — güvenli yere çekip motoru durdur, soğumasını bekle; soğutucu seviyesini gözle kontrol et.`
        : `Soğutucu ${temp}°C yükseliyor — göstergeyi izle, uzun yük/rampada dikkat et.`,
      readOnly: true,
    },
    signalKey: name,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Verdict hipotezleri → olası nedenler (kanıta bağlı)
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir nedeni destekleyen evidence-store anahtarlarını (güvenle eşleşenleri) bulur. */
function linkSupport(code: string, evidence: EvidenceStore): string[] {
  if (code === 'OBD_DTC_PRESENT') return evidence.query({ keyPrefix: 'dtc.' }).map((e) => e.key);
  if (code.startsWith('TRANSPORT') || code.startsWith('OBD_')) {
    // OBD kaynaklı taze sinyaller bu bağlantı-nedenini bağlamsal olarak destekler.
    return evidence.query({ keyPrefix: 'signal.', source: 'obd' }).map((e) => e.key).slice(0, 3);
  }
  return [];
}

function verdictToCauses(verdict: AiCoreVerdict, evidence: EvidenceStore): AiPossibleCause[] {
  const out: AiPossibleCause[] = [];
  for (const h of verdict.topRootCauses) {
    out.push({
      code: h.code,
      description: h.problem,
      confidence: Math.max(0, Math.min(100, Math.round(h.confidence))),
      supportingEvidence: linkSupport(h.code, evidence),
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karşı kanıt (explainable ayırt edici — aşırı-güveni dengeler)
 * ════════════════════════════════════════════════════════════════════════ */

function deriveCounterEvidence(
  causes: readonly AiPossibleCause[],
  evidence: EvidenceStore,
  memory: readonly VehicleMemoryFact[],
  inconclusive: readonly AiInconclusive[],
): AiCounterEvidence[] {
  const out: AiCounterEvidence[] = [];

  // 1) TAZE SİNYAL KARŞI KANITI: bağlantı-arızası nedeni varken OBD taze veri veriyorsa,
  //    transport tamamen ölü DEĞİLDİR (aralıklı olabilir) — aşırı-teşhisi dengeler.
  const connectionCause = causes.find((c) =>
    c.code.startsWith('TRANSPORT') || c.code === 'OBD_DATA_STALE' || c.code === 'OBD_HS_FAIL_TRANSPORT');
  if (connectionCause) {
    const freshObd = evidence.query({ keyPrefix: 'signal.', source: 'obd', minConfidence: 0.7 });
    if (freshObd.length > 0) {
      out.push({
        againstCode: connectionCause.code,
        note: `OBD ${freshObd.length} taze sinyal veriyor → bağlantı tamamen ölü değil, aralıklı/yavaş olabilir.`,
      });
    }
  }

  // 2) HAFIZA SINIR KARŞI KANITI: bir neden, bu araçta BİLİNEN sınırı arıza sanıyorsa —
  //    öğrenilmiş gerçek "arıza değil, araç sınırı" der (self-learning devreye girer).
  for (const fact of memory) {
    const isLimit = /desteklemiyor|desteklemez|sınır|normal|arıza değil|unsupported|not_supported/i.test(
      `${fact.key} ${fact.statement}`,
    );
    if (!isLimit || fact.confidence < 0.6) continue;
    const related = causes.find((c) => _shareKeyword(c.code + ' ' + c.description, fact.key + ' ' + fact.statement));
    out.push({
      againstCode: related?.code ?? '',
      note: `Bilinen araç sınırı (arıza değil, güven %${Math.round(fact.confidence * 100)}): ${fact.statement}`,
    });
    if (out.length >= MAX_COUNTER) break;
  }

  // 3) SONUÇSUZLUK KARŞI KANITI: doğrulanamayan subsystem aşırı-güvenli sonucu zayıflatır.
  for (const inc of inconclusive) {
    if (out.length >= MAX_COUNTER) break;
    out.push({
      againstCode: '',
      note: `${inc.subsystem} doğrulanamadı (${inc.reason}) → bu alandaki sonuçlar kesin değil.`,
    });
  }

  return out.slice(0, MAX_COUNTER);
}

/** İki metin ortak anlamlı bir sözcük paylaşıyor mu (kaba eşleşme; ≥4 harf). */
function _shareKeyword(a: string, b: string): boolean {
  const wa = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
  for (const w of b.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && wa.has(w)) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Güvenli kontroller (DAİMA read-only gözlem önerisi)
 * ════════════════════════════════════════════════════════════════════════ */

/** Neden koduna göre read-only güvenli kontrol (kavramsal aile eşleşmesi). */
function safeCheckForCause(cause: AiPossibleCause): AiSafeCheck {
  const c = cause.code;
  if (c === 'OBD_DTC_PRESENT') {
    return { title: 'Arıza kodlarını doğrulat', detail: 'Okunan DTC\'leri bir uzmana doğrulat; ilgili sistemi kontrol ettir (silme yok).', readOnly: true };
  }
  if (c.startsWith('TRANSPORT') || c.startsWith('OBD_')) {
    return { title: 'OBD adaptörünü gözle kontrol et', detail: 'Adaptörün porta tam oturduğunu ve gücünü gözle kontrol et; menzil/kablo sorununu gözlemle.', readOnly: true };
  }
  if (c.startsWith('POWER')) {
    return { title: 'Akü/alternatör bağlantısını gözle kontrol et', detail: 'Akü terminallerini ve alternatör kayışını gözle kontrol et; voltaj eğilimini izle.', readOnly: true };
  }
  if (c.includes('FUEL')) {
    return { title: 'Yakıt seviyesini kontrol et', detail: 'Yakıt seviyesini ve en yakın istasyon menzilini gözle kontrol et.', readOnly: true };
  }
  return { title: `Gözlemle: ${cause.description}`, detail: 'İlgili göstergeyi/sistemi gözlemle; değişimi izle (otomatik aksiyon yok).', readOnly: true };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ajan
 * ════════════════════════════════════════════════════════════════════════ */

function analyze(input: AiAgentAnalysisInput): AiAgentReport {
  const { context, evidence, verdict, memory, now } = input;

  // Hafıza gerçeklerini de rapora kanıt olarak dahil et (izlenebilirlik).
  const memEvidence: AiEvidenceItem[] = memory.slice(0, 8).map((f) => Object.freeze({
    key: `memory.${f.key}`, kind: 'memory' as const,
    summary: f.statement, confidence: f.confidence, observedAt: f.lastSeen, source: f.source,
  }));
  const evidenceList: AiEvidenceItem[] = [...evidence.snapshot(), ...memEvidence];

  // Güvenlik-kritik sinyal yorumu (evidence-grounded).
  const overheat = interpretCoolant(context);

  // Nedenler: güvenlik-kritik sinyal (varsa, ÖNCE) + verdict hipotezleri.
  const causes: AiPossibleCause[] = [];
  if (overheat) causes.push(overheat.cause);
  causes.push(...verdictToCauses(verdict, evidence));
  const possibleCauses = causes.slice(0, MAX_CAUSES);

  // "KANIT YOKSA TAHMİN YOK": kanıt da yok, aktif neden de yoksa dürüstçe sus.
  const hasEvidence = evidenceList.length > 0 || verdict.hasActiveRootCause || overheat !== null;
  if (!hasEvidence) {
    return Object.freeze({
      agentId: AI_MECHANIC_ID, generatedAt: now,
      headline: context.connected
        ? 'Yeterli kanıt yok — güvenilir teşhis üretilemedi.'
        : 'Araç bağlı değil — teşhis için canlı veri yok.',
      urgency: 'none', confidence: 0, hasEvidence: false,
      evidence: [], possibleCauses: [], counterEvidence: [], nextSafeChecks: [],
      inconclusive: verdict.inconclusive.map(_incNote), explanation: null,
    });
  }

  const counterEvidence = deriveCounterEvidence(possibleCauses, evidence, memory, verdict.inconclusive.map(_incNote));

  // Güvenli kontroller: overheat (varsa önce) + en güçlü nedenlerden (dedup).
  const safeChecks: AiSafeCheck[] = [];
  const seenTitles = new Set<string>();
  if (overheat) { safeChecks.push(overheat.safeCheck); seenTitles.add(overheat.safeCheck.title); }
  for (const c of possibleCauses) {
    if (c.code === 'ENGINE_OVERHEAT' || c.code === 'ENGINE_TEMP_HIGH') continue;
    const sc = safeCheckForCause(c);
    if (!seenTitles.has(sc.title)) { safeChecks.push(sc); seenTitles.add(sc.title); }
    if (safeChecks.length >= MAX_SAFE_CHECKS) break;
  }

  // Aciliyet: verdict + güvenlik-kritik sinyal (yüksek olan).
  let urgency: AiUrgency = verdict.urgency;
  if (overheat) urgency = maxUrgency(urgency, overheat.urgency);

  // Genel güven: en güçlü nedenden.
  const confidence = possibleCauses.length > 0 ? Math.max(...possibleCauses.map((c) => c.confidence)) : 0;

  // Headline: en aciliyetli/güvenli neden önce.
  const top = possibleCauses.slice().sort((a, b) => b.confidence - a.confidence)[0];
  const headline = urgencyRank(urgency) >= urgencyRank('urgent') && overheat && overheat.cause === top
    ? `${top.description} — hemen dikkat (%${top.confidence})`
    : top
      ? `${top.description} (%${top.confidence})`
      : verdict.headline;

  return Object.freeze({
    agentId: AI_MECHANIC_ID, generatedAt: now, headline, urgency, confidence,
    hasEvidence: true,
    evidence: Object.freeze(evidenceList),
    possibleCauses: Object.freeze(possibleCauses),
    counterEvidence: Object.freeze(counterEvidence),
    nextSafeChecks: Object.freeze(safeChecks),
    inconclusive: Object.freeze(verdict.inconclusive.map(_incNote)),
    explanation: null,   // LLM narrasyonu Orchestrator'da opsiyonel
  });
}

function _incNote(n: { subsystem: string; reason: string; missingEvidence: readonly string[] }): AiInconclusive {
  return { subsystem: n.subsystem, reason: n.reason, missingEvidence: n.missingEvidence };
}

/** AI Usta ajanı — Orchestrator'a kaydedilecek tekil örnek (saf/deterministik). */
export const aiMechanic: AiAgent = Object.freeze({
  id: AI_MECHANIC_ID,
  title: 'AI Usta',
  requiredScope: 'read',
  analyze,
});
