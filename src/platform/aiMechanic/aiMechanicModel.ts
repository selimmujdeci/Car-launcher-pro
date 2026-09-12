/**
 * aiMechanicModel.ts — AI MECHANIC CORE P1: KANONİK MODEL (SAF · YORUM KATMANI).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * EN ÖNEMLİ MİMARİ KURAL — AI MECHANIC KARAR ÜRETMEZ
 * ══════════════════════════════════════════════════════════════════════════
 * Bu modül bir karar motoru DEĞİLDİR. Tek işi, MAVI Reasoning Engine'in
 * ÜRETTİĞİ ve zaten doğrulanmış kararları **mekanik teşhis diline çevirmektir**.
 *
 * Akış TEK YÖNLÜDÜR ve kısa devre YAPILAMAZ:
 *
 *     AI Evidence Engine  →  MAVI Reasoning Engine  →  AI Mechanic
 *        (kanıt)                  (KARAR)               (yorum)
 *
 * Bu katmanda OLMAYAN şeyler (bilinçli ve bağlayıcı):
 *  · yeni karar motoru       — karar `ReasoningDecision`ten GELİR
 *  · yeni güven sistemi      — güven `ReasoningConfidence` olarak AYNEN taşınır
 *  · yeni kanıt sistemi      — kanıt yalnız `evidenceIds` ile REFERANS edilir
 *  · LLM / doğal dil üretimi — cümle yok, `message`/`summary`/`text` alanı YOK
 *  · öneri · tamir tavsiyesi · parça önerisi · maliyet · aciliyet talimatı
 *    → P1 YALNIZCA TEŞHİS KATMANIDIR (paket şartı §5)
 *
 * Predictive Maintenance · Service Advisor · Repair Advisor İLERİDE bu modülün
 * ÜZERİNE kurulacaktır; bu yüzden buraya bir öneri sızarsa o katmanların
 * dayanağı kirlenir.
 *
 * ── UNKNOWN FAIL-CLOSED ────────────────────────────────────────────────
 * Çözülemeyen her şey `UNKNOWN`'dır ve `UNKNOWN` bir kaçış değil bir CEVAPTIR.
 * Kategori çözülemezse `UNKNOWN`, severity çözülemezse `UNKNOWN`. Hiçbir alan
 * "makul varsayılan"a düşürülmez.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK ·
 * `fetch` YOK · depolama YOK · global durum YOK.
 */

import {
  type ReasoningIntent, type ReasoningDecision, type ReasoningConfidence,
  type ConfidenceReason, type ReasoningState,
} from '../reasoning/maviReasoning';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · TEŞHİS KATEGORİSİ (paket şartı §2 — P1'de YALNIZ bunlar)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * AI Mechanic'in P1'de tanıdığı mekanik teşhis alanları.
 *
 * ⚠️ Bu liste Reasoning `intent` listesinden KISADIR ve olması gereken budur:
 * `DRIVER` · `FLEET` · `TRIP_STATUS` · `LOCATION` mekanik teşhis DEĞİLDİR.
 * Onlar Driver Coach ve Fleet Advisor'ın alanıdır; buraya sızarlarsa AI
 * Mechanic kendi kapsamının dışında konuşmuş olur.
 */
export const MECHANIC_CATEGORIES = [
  'ENGINE',
  'COOLING',
  'BATTERY',
  'FUEL',
  'OBD',
  'TEMPERATURE',
  'CONNECTIVITY',
  'UNKNOWN',
] as const;
export type MechanicCategory = (typeof MECHANIC_CATEGORIES)[number];

export function isMechanicCategory(v: unknown): v is MechanicCategory {
  return typeof v === 'string' && (MECHANIC_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Reasoning niyeti → mekanik teşhis kategorisi. SAF ve TAM eşleme.
 *
 * ── `COOLING` NEDEN AYRI BİR KATEGORİ ──────────────────────────────────
 * Reasoning tarafında `COOLING` diye bir niyet YOKTUR; soğutma sinyalleri
 * `TEMPERATURE` niyetinde toplanır. AI Mechanic mekanik dilde konuştuğu için
 * ikisini ayırmak İSTER — ama bu ayrım **kanıt kategorisinden** gelmelidir,
 * niyetten UYDURULAMAZ. Bu yüzden `COOLING` yalnız `resolveCategory()`ye
 * soğutma kanıtı geldiğinde seçilir; kanıt yoksa `TEMPERATURE` kalır.
 * (Uydurulmuş bir `COOLING` teşhisi, olmayan bir alt sistemi suçlamak olurdu.)
 *
 * ⚠️ Mekanik OLMAYAN niyetler (`DRIVER`/`FLEET`/`TRIP_STATUS`/`LOCATION`)
 * `null` döner — "AI Mechanic'in söyleyecek sözü yok" demektir. `UNKNOWN`
 * DEĞİLDİR: `UNKNOWN` "mekanik ama çözülemedi", `null` "mekanik değil"dir.
 */
export function categoryForIntent(intent: ReasoningIntent): MechanicCategory | null {
  switch (intent) {
    case 'ENGINE':         return 'ENGINE';
    case 'BATTERY':        return 'BATTERY';
    case 'FUEL':           return 'FUEL';
    case 'TEMPERATURE':    return 'TEMPERATURE';
    case 'CONNECTIVITY':   return 'CONNECTIVITY';
    case 'DIAGNOSTIC':     return 'OBD';
    /* Araç sağlığı bir ÇATI niyettir (motor+sıcaklık+akü+tanı birlikte);
       tek bir mekanik alt sisteme indirgenemez → çözülemedi. */
    case 'VEHICLE_HEALTH': return 'UNKNOWN';
    case 'UNKNOWN':        return 'UNKNOWN';
    /* Mekanik teşhis kapsamı DIŞI — AI Mechanic bunlar hakkında konuşmaz. */
    case 'DRIVER':
    case 'FLEET':
    case 'TRIP_STATUS':
    case 'LOCATION':       return null;
  }
}

/**
 * Kanıt kategorileri soğutma alt sistemine mi işaret ediyor?
 *
 * Soğutma kanıtı `TEMPERATURE` kategorisinde, metrik adıyla ayrışır. Metrik
 * adı bilinmiyorsa soğutma İDDİA EDİLMEZ (fail-closed).
 */
const COOLING_METRIC_HINTS = ['coolant', 'radiator', 'thermostat', 'water_temp', 'fan'] as const;

export function looksLikeCoolingMetric(metric: unknown): boolean {
  if (typeof metric !== 'string' || metric === '') return false;
  const m = metric.toLowerCase();
  return COOLING_METRIC_HINTS.some((h) => m.includes(h));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · ANALİZ DURUMU (paket şartı §4)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Analizin sonucu. Bire bir `ReasoningDecision` kümesinden TÜRETİLİR —
 * yeni bir sonuç sınıfı İCAT EDİLMEZ.
 *
 * `REJECTED` bilinçli olarak DIŞARIDADIR: reddedilmiş bir karar isteği bir
 * teşhis değildir, girdi hatasıdır → AI Mechanic onu analiz olarak SUNMAZ
 * (bkz. `analysisFromReasoning` — `null` döner).
 */
export const MECHANIC_ANALYSIS_STATES = [
  'SUPPORTED',
  'UNSUPPORTED',
  'UNKNOWN',
  'INSUFFICIENT_EVIDENCE',
  'CONFLICTED_EVIDENCE',
  'EXPIRED_EVIDENCE',
] as const;
export type MechanicAnalysisState = (typeof MECHANIC_ANALYSIS_STATES)[number];

export function isMechanicAnalysisState(v: unknown): v is MechanicAnalysisState {
  return typeof v === 'string' && (MECHANIC_ANALYSIS_STATES as readonly string[]).includes(v);
}

/**
 * Karar → analiz durumu. SAF geçiş; hiçbir yeniden yorumlama YOK.
 *
 * İKİ FARKLI "yok" vardır ve karıştırılmamalıdır:
 *  · `REJECTED` → `null`: analiz ÜRETİLMEZ. Reddedilen istek bir teşhis değil,
 *    girdi hatasıdır; teşhis listesinde yeri yoktur.
 *  · TANINMAYAN karar → `'UNKNOWN'`: analiz ÜRETİLİR ama "bilmiyorum" der.
 *    Bozuk/yeni bir karar kodunu SESSİZCE GİZLEMEK, AI Mechanic sayımının
 *    MAVI sayımından sapmasına yol açardı — eksiklik görünmez olurdu.
 *    UNKNOWN fail-closed ilkesi tam olarak bunu engeller.
 */
export function stateForDecision(d: ReasoningDecision): MechanicAnalysisState | null {
  switch (d) {
    case 'SUPPORTED':             return 'SUPPORTED';
    case 'UNSUPPORTED':           return 'UNSUPPORTED';
    case 'INSUFFICIENT_EVIDENCE': return 'INSUFFICIENT_EVIDENCE';
    case 'CONFLICTED_EVIDENCE':   return 'CONFLICTED_EVIDENCE';
    case 'EXPIRED_EVIDENCE':      return 'EXPIRED_EVIDENCE';
    case 'UNKNOWN':               return 'UNKNOWN';
    case 'REJECTED':              return null;
    default:                      return 'UNKNOWN';   // fail-closed, gizleme YOK
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · SEVERITY (TÜRETİLMİŞ SUNUM — KARAR DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Teşhis şiddeti.
 *
 * ⚠️ BU BİR KARAR DEĞİLDİR ve yeni bir güven/karar sistemi KURMAZ. Yalnızca
 * MAVI'nin verdiği `decision` + `confidence` ikilisinin sunum sıralamasıdır;
 * hiçbir yeni bilgi EKLEMEZ ve hiçbir kararı DEĞİŞTİREMEZ. Girdi çözülemezse
 * `UNKNOWN` döner (fail-closed).
 */
export const MECHANIC_SEVERITIES = ['NONE', 'INFO', 'WARNING', 'CRITICAL', 'UNKNOWN'] as const;
export type MechanicSeverity = (typeof MECHANIC_SEVERITIES)[number];

/**
 * Şiddet türetimi — SAF ve TOTAL.
 *
 * Kural tablosu (yalnız MAVI çıktısına bakar):
 *   · UNSUPPORTED (olumsuz kanıt VAR) + VERY_HIGH/HIGH → CRITICAL
 *   · UNSUPPORTED + MEDIUM/LOW                          → WARNING
 *   · UNSUPPORTED + UNKNOWN güven                       → UNKNOWN (şiddet iddia edilemez)
 *   · SUPPORTED (sorun kanıtı yok)                      → NONE
 *   · CONFLICTED / INSUFFICIENT / EXPIRED / UNKNOWN     → UNKNOWN
 *
 * `CONFLICTED_EVIDENCE` bilinçle `WARNING` DEĞİLDİR: çelişki bir arıza
 * kanıtı değil, bir BİLGİ EKSİKLİĞİDİR. Onu uyarıya çevirmek MAVI'nin
 * "çelişkide karar üretilmez" kuralını arkadan dolanmak olurdu.
 */
export function severityFor(
  state: MechanicAnalysisState,
  confidence: ReasoningConfidence,
): MechanicSeverity {
  if (state === 'SUPPORTED') return 'NONE';
  if (state !== 'UNSUPPORTED') return 'UNKNOWN';
  switch (confidence) {
    case 'VERY_HIGH':
    case 'HIGH':   return 'CRITICAL';
    case 'MEDIUM':
    case 'LOW':    return 'WARNING';
    case 'UNKNOWN': return 'UNKNOWN';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · KANONİK ANALİZ KAYDI (paket şartı §1)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir AI Mechanic analizi.
 *
 * ⚠️ `analysisId` YENİ BİR KİMLİK ÜRETMEZ: `reasoningId`den DETERMİNİSTİK
 * olarak türer (`mech:<reasoningId>`). Böylece aynı karar tekrar okunduğunda
 * aynı analiz kimliği çıkar — replay yeni analiz "üretmez" (MAVI'nin
 * tekilleştirme kuralı 5 ile aynı ilke).
 *
 * ⚠️ Serbest metin alanı YOKTUR. Gerekçe `confidenceReason` olarak MAVI'den
 * gelen bounded KOD'dur.
 */
export interface MechanicAnalysis {
  readonly analysisId: string;
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly tripId: string | null;
  /** Kararın kimliği — analizin TEK dayanağı. */
  readonly reasoningId: string;
  /** Karara katılan kanıtların kimlikleri (referans; kanıt KOPYALANMAZ). */
  readonly evidenceIds: readonly string[];
  readonly diagnosticCategory: MechanicCategory;
  readonly severity: MechanicSeverity;
  /** MAVI'den AYNEN taşınır — yeniden hesaplanmaz. */
  readonly confidence: ReasoningConfidence;
  /** MAVI'den AYNEN taşınan bounded gerekçe kodu. */
  readonly confidenceReason: ConfidenceReason;
  readonly state: MechanicAnalysisState;
  /** Kararın oluştuğu an (ISO-8601, UTC). AI Mechanic saat OKUMAZ. */
  readonly createdAt: string;
  /** Kanıt/çelişki sayıları — MAVI'den taşınır, yeniden sayılmaz. */
  readonly evidenceCount: number;
  readonly conflictCount: number;
  /** MAVI reasoning satırının yaşam-döngüsü durumu (izlenebilirlik). */
  readonly reasoningState: ReasoningState;
}

/** Deterministik analiz kimliği — yeni kimlik uzayı açmaz. */
export function analysisIdFor(reasoningId: string): string {
  return `mech:${reasoningId}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · REASONING → ANALİZ (tek dönüşüm noktası)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * MAVI karar satırının AI Mechanic'in ihtiyaç duyduğu ALT KÜMESİ.
 * Yapısal tip: bu modül Supabase/servis import ETMEZ (saf kalır).
 */
export interface ReasoningRowLike {
  readonly reasoningId: string;
  readonly intent: string;
  readonly decision: string;
  readonly confidence: string;
  readonly confidenceReason: string;
  readonly state: string;
  readonly evidenceCount: number;
  readonly conflictCount: number;
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly tripId: string | null;
  readonly createdAt: string;
  readonly evidenceIds?: readonly string[];
  /** Karara katılan kanıt metrik adları — YALNIZ COOLING ayrımı için. */
  readonly evidenceMetrics?: readonly string[];
}

/** Bilinmeyen dizeyi bounded kümeye indirger; eşleşmezse `UNKNOWN` (fail-closed). */
function _confidence(v: unknown): ReasoningConfidence {
  return v === 'VERY_HIGH' || v === 'HIGH' || v === 'MEDIUM' || v === 'LOW'
    ? v : 'UNKNOWN';
}

const _CONFIDENCE_REASONS: readonly string[] = [
  'NO_EVIDENCE', 'ALL_EVIDENCE_EXPIRED', 'CONFLICTING_EVIDENCE',
  'EVIDENCE_UNKNOWN_CONFIDENCE', 'SINGLE_OBSERVATION', 'COVERAGE_INCOMPLETE',
  'WEAKEST_EVIDENCE_LINK', 'INTENT_UNRESOLVED', 'SUBJECT_MISMATCH',
];

function _confidenceReason(v: unknown): ConfidenceReason {
  return (typeof v === 'string' && _CONFIDENCE_REASONS.includes(v)
    ? v : 'NO_EVIDENCE') as ConfidenceReason;
}

const _REASONING_STATES: readonly string[] = [
  'NEW', 'ANALYZING', 'SUPPORTED', 'UNSUPPORTED', 'UNKNOWN',
  'REJECTED', 'EXPIRED', 'CONFLICTED',
];

function _reasoningState(v: unknown): ReasoningState {
  return (typeof v === 'string' && _REASONING_STATES.includes(v) ? v : 'UNKNOWN') as ReasoningState;
}

/**
 * Kategori çözümü — niyet + (varsa) kanıt metrikleri.
 *
 * `TEMPERATURE` niyeti soğutma metriği taşıyorsa `COOLING`'e ayrışır; metrik
 * yoksa `TEMPERATURE` kalır. Soğutma ASLA metriksiz iddia edilmez.
 */
export function resolveCategory(
  intent: ReasoningIntent,
  evidenceMetrics?: readonly string[],
): MechanicCategory | null {
  const base = categoryForIntent(intent);
  if (base !== 'TEMPERATURE') return base;
  const hasCooling = Array.isArray(evidenceMetrics)
    && evidenceMetrics.some((m) => looksLikeCoolingMetric(m));
  return hasCooling ? 'COOLING' : 'TEMPERATURE';
}

/**
 * MAVI karar satırını AI Mechanic analizine çevirir.
 *
 * `null` döner (analiz ÜRETİLMEZ) şu hâllerde:
 *  · karar `REJECTED` — girdi hatası, teşhis değil
 *  · niyet mekanik teşhis kapsamı DIŞI (DRIVER/FLEET/TRIP_STATUS/LOCATION)
 *  · `reasoningId` yok — dayanaksız analiz olamaz
 *
 * Hiçbir alan uydurulmaz; çözülemeyen her şey `UNKNOWN`'a düşer.
 */
export function analysisFromReasoning(row: ReasoningRowLike | null | undefined): MechanicAnalysis | null {
  if (!row || typeof row.reasoningId !== 'string' || row.reasoningId === '') return null;

  const intent = (typeof row.intent === 'string' ? row.intent : 'UNKNOWN') as ReasoningIntent;
  const category = resolveCategory(intent, row.evidenceMetrics);
  if (category === null) return null;                       // mekanik kapsam dışı

  const state = stateForDecision(
    (typeof row.decision === 'string' ? row.decision : 'UNKNOWN') as ReasoningDecision,
  );
  if (state === null) return null;                          // REJECTED → analiz yok

  const confidence = _confidence(row.confidence);

  return Object.freeze({
    analysisId:         analysisIdFor(row.reasoningId),
    vehicleId:          row.vehicleId ?? null,
    driverId:           row.driverId ?? null,
    tripId:             row.tripId ?? null,
    reasoningId:        row.reasoningId,
    evidenceIds:        Object.freeze([...(row.evidenceIds ?? [])]),
    diagnosticCategory: category,
    severity:           severityFor(state, confidence),
    confidence,
    confidenceReason:   _confidenceReason(row.confidenceReason),
    state,
    createdAt:          typeof row.createdAt === 'string' ? row.createdAt : '',
    evidenceCount:      Number.isFinite(row.evidenceCount) ? Math.max(0, Math.trunc(row.evidenceCount)) : 0,
    conflictCount:      Number.isFinite(row.conflictCount) ? Math.max(0, Math.trunc(row.conflictCount)) : 0,
    reasoningState:     _reasoningState(row.state),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · ÖZET (CAROS LAB §7 · Fleet Dashboard §8 için)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Analiz kümesinin salt-okunur özeti.
 *
 * ⚠️ "Hiç analiz yok" ile "sıfır ölçtük" farklıdır: analiz kümesi boşsa
 * oranlar `null` döner (`0` DEĞİL) — MAVI `get_reasoning_summary` ile aynı ilke.
 */
export interface MechanicSummary {
  readonly analysisTotal: number;
  readonly byCategory: Readonly<Record<MechanicCategory, number>>;
  readonly byState: Readonly<Record<MechanicAnalysisState, number>>;
  readonly bySeverity: Readonly<Record<MechanicSeverity, number>>;
  readonly unknownCount: number;
  readonly conflictCount: number;
  readonly expiredCount: number;
  /** Kanıta dayanan (SUPPORTED+UNSUPPORTED) analizlerin oranı; küme boşsa null. */
  readonly conclusiveRatio: number | null;
  /** HIGH/VERY_HIGH güvenli analiz oranı; küme boşsa null. */
  readonly highConfidenceRatio: number | null;
}

function _emptyCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  return out;
}

/** SAF özet — sayaçlar analizlerden TÜRETİLİR, hiçbir yeni bilgi eklenmez. */
export function summarizeAnalyses(analyses: readonly MechanicAnalysis[]): MechanicSummary {
  const byCategory = _emptyCounts(MECHANIC_CATEGORIES);
  const byState    = _emptyCounts(MECHANIC_ANALYSIS_STATES);
  const bySeverity = _emptyCounts(MECHANIC_SEVERITIES);

  let conclusive = 0;
  let highConf   = 0;

  for (const a of analyses) {
    byCategory[a.diagnosticCategory]++;
    byState[a.state]++;
    bySeverity[a.severity]++;
    if (a.state === 'SUPPORTED' || a.state === 'UNSUPPORTED') conclusive++;
    if (a.confidence === 'HIGH' || a.confidence === 'VERY_HIGH') highConf++;
  }

  const total = analyses.length;
  return Object.freeze({
    analysisTotal:       total,
    byCategory:          Object.freeze(byCategory),
    byState:             Object.freeze(byState),
    bySeverity:          Object.freeze(bySeverity),
    unknownCount:        byState.UNKNOWN,
    conflictCount:       byState.CONFLICTED_EVIDENCE,
    expiredCount:        byState.EXPIRED_EVIDENCE,
    // Küme boşken oran UYDURULMAZ (0 bir ölçüm iddiasıdır).
    conclusiveRatio:     total > 0 ? conclusive / total : null,
    highConfidenceRatio: total > 0 ? highConf / total : null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · MUHAKEME ZİNCİRİ (paket şartı §6)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir analizin hangi karar · kanıt · yolculuk · araç üzerinden oluştuğunun
 * okunabilir künyesi. Yeni zincir depolamaz — MAVI zincirine İŞARET EDER.
 */
export interface MechanicChainRef {
  readonly analysisId: string;
  readonly reasoningId: string;
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly tripId: string | null;
  readonly evidenceIds: readonly string[];
  /** Zincir MAVI'de yaşar; okuma ucu `get_reasoning_chain(reasoningId)`dir. */
  readonly chainSource: 'mavi_reasoning_chain';
}

/** SAF zincir künyesi — analizden türetilir, ek okuma yapmaz. */
export function chainRefFor(a: MechanicAnalysis): MechanicChainRef {
  return Object.freeze({
    analysisId:  a.analysisId,
    reasoningId: a.reasoningId,
    vehicleId:   a.vehicleId,
    driverId:    a.driverId,
    tripId:      a.tripId,
    evidenceIds: a.evidenceIds,
    chainSource: 'mavi_reasoning_chain' as const,
  });
}
