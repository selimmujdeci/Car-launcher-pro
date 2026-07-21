/**
 * Guardian Decision Engine — saf karar motoru — GUARDIAN-AI-G13.
 *
 * `guardianEngine.runGuardian` (G1) çıktısını (`GuardianOutput`) alıp, DI ile
 * gelen önceliğe göre hangi risk olaylarının kullanıcıya SUNULACAĞINA karar
 * verir (`speakEvents` = sesli, `displayEvents` = ekranda). SAF, deterministik,
 * immutable, fail-closed. Yalnız `./models` (guardian tipleri) içe aktarılır.
 *
 * Bu motor KARAR-SUNUMU yapar, RİSK ANALİZİ DEĞİL:
 *   - Event ÜRETMEZ / severity HESAPLAMAZ / dedup-skorlama YENİDEN YAPMAZ.
 *   - `GuardianRiskEvent`leri DEĞİŞTİRMEZ (aynı referanslar, kopyalanmadan taşınır).
 *   - `guardianOutput.highestSeverity` ve `overallRiskScore` AYNEN korunur
 *     (yeniden hesaplanmaz — GuardianEngine'in sonucuna güvenir).
 *
 * ── ÖNCELİK (tamamen DI — kod içine gömülü priority YOK) ────────────────────
 * Sıralama: önce `policy.severityRank[severity]` AZALAN (yüksek severity önce);
 * eşitlikte `policy.eventTypePriority[type]` AZALAN (yüksek öncelik önce; haritada
 * olmayan tip nötr 0); yine eşitlikte `id` ARTAN (deterministik stabil kırıcı).
 *
 * ── SPAM KORUMASI (bu görevde ZAMAN-TABANLI throttle YOK) ───────────────────
 * Aynı `id` bir Decision içinde YALNIZ BİR KEZ bulunur (savunmacı dedup —
 * GuardianEngine zaten tekilleştirir, bu bir güvenlik ağıdır). Opsiyonel
 * `maxSpeakEvents`/`maxDisplayEvents` sayı sınırları (DI) sıralama SONRASI en
 * yüksek öncelikli N olayı tutar.
 *
 * ── FAIL-CLOSED ──────────────────────────────────────────────────────────────
 * Boş `guardianOutput.riskEvents` → boş decision (listeler boş, highestPriority
 * null; korunan alanlar aynen geçer).
 */
import type { GuardianRiskEvent, GuardianOutput, GuardianSeverity, GuardianRiskType } from './models';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

export interface GuardianDecisionPolicyInput {
  /** Her severity'nin sayısal önceliği (yüksek = daha önemli) — 5 severity de
   *  tanımlı olmalı. Kod içine gömülü DEĞİL, tamamen DI. */
  severityRank:        Record<GuardianSeverity, number>;
  /** Aynı severity içinde tip-bazlı öncelik (yüksek = önce). Kısmi olabilir;
   *  haritada olmayan tip nötr 0 sayılır. */
  eventTypePriority:   Partial<Record<GuardianRiskType, number>>;
  /** severityRank değeri bu severity'nin rank'ine EŞİT/ÜSTÜ olan olaylar sesli
   *  sunulur (`speakEvents`). */
  speakMinSeverity:    GuardianSeverity;
  /** severityRank değeri bu severity'nin rank'ine EŞİT/ÜSTÜ olan olaylar ekranda
   *  gösterilir (`displayEvents`). */
  displayMinSeverity:  GuardianSeverity;
  /** Opsiyonel: sıralama sonrası sesli liste üst sınırı (>=0 tam sayı). */
  maxSpeakEvents?:     number;
  /** Opsiyonel: sıralama sonrası ekran listesi üst sınırı (>=0 tam sayı). */
  maxDisplayEvents?:   number;
}

export interface GuardianDecisionInput {
  guardianOutput:  GuardianOutput;
  policy:          GuardianDecisionPolicyInput;
}

export interface GuardianDecision {
  /** Sesli sunulacak olaylar (öncelik sırasında). */
  speakEvents:       readonly GuardianRiskEvent[];
  /** Ekranda gösterilecek olaylar (öncelik sırasında). */
  displayEvents:     readonly GuardianRiskEvent[];
  /** En yüksek öncelikli tek olay (severity→priority→id); hiç olay yoksa null. */
  highestPriority:   GuardianRiskEvent | null;
  /** GuardianEngine'den AYNEN korunur. */
  highestSeverity:   GuardianSeverity | null;
  /** GuardianEngine'den AYNEN korunur. */
  overallRiskScore:  number;
}

/* ── Merkezi isimli sabitler ──────────────────────────────────────────────── */

export const GUARDIAN_DECISION_ID = 'guardian-decision';

/** Geçerli severity token kümesi — models.ts'ten runtime DEĞER import ETMEDEN
 *  bağımsız yerel kopya (guardian kurallarındaki izolasyon deseniyle tutarlı). */
const VALID_SEVERITY_TOKENS: readonly GuardianSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Haritada olmayan tip için nötr öncelik (magic priority DEĞİL — "belirtilmemiş"
 *  anlamında tarafsız taban; gerçek öncelikler DI `eventTypePriority`den). */
const NEUTRAL_TYPE_PRIORITY = 0;

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isSeverityToken(v: unknown): v is GuardianSeverity {
  return typeof v === 'string' && (VALID_SEVERITY_TOKENS as readonly string[]).includes(v);
}

/* ── Doğrulama — SÖZLEŞME/programlama hatası → THROW ─────────────────────────
 * (boş riskEvents gerçek-dünya durumudur, throw DEĞİL — fail-closed boş decision.) */
function validateInput(input: GuardianDecisionInput): void {
  if (!isObject(input)) {
    throw new RangeError('evaluateGuardianDecision: input bir nesne olmalı.');
  }
  const { guardianOutput, policy } = input;

  if (!isObject(guardianOutput)) {
    throw new RangeError('evaluateGuardianDecision: guardianOutput zorunludur.');
  }
  if (!Array.isArray(guardianOutput.riskEvents)) {
    throw new RangeError('evaluateGuardianDecision: guardianOutput.riskEvents bir dizi olmalı.');
  }
  if (guardianOutput.highestSeverity !== null && !isSeverityToken(guardianOutput.highestSeverity)) {
    throw new RangeError(`evaluateGuardianDecision: geçersiz guardianOutput.highestSeverity (${String(guardianOutput.highestSeverity)}).`);
  }
  if (!isFiniteNumber(guardianOutput.overallRiskScore)) {
    throw new RangeError(`evaluateGuardianDecision: geçersiz guardianOutput.overallRiskScore (${guardianOutput.overallRiskScore}) — finite olmalı.`);
  }

  if (!isObject(policy)) {
    throw new RangeError('evaluateGuardianDecision: policy zorunludur.');
  }
  if (!isObject(policy.severityRank)) {
    throw new RangeError('evaluateGuardianDecision: policy.severityRank zorunludur.');
  }
  // Beş severity de tanımlı ve finite olmalı (aksi halde sıralama belirsiz).
  for (const token of VALID_SEVERITY_TOKENS) {
    if (!isFiniteNumber(policy.severityRank[token])) {
      throw new RangeError(`evaluateGuardianDecision: policy.severityRank['${token}'] tanımlı ve finite olmalı.`);
    }
  }
  if (!isObject(policy.eventTypePriority)) {
    throw new RangeError('evaluateGuardianDecision: policy.eventTypePriority zorunludur (kısmi olabilir).');
  }
  for (const [key, value] of Object.entries(policy.eventTypePriority)) {
    if (value !== undefined && !isFiniteNumber(value)) {
      throw new RangeError(`evaluateGuardianDecision: policy.eventTypePriority.${key} geçersiz (${value}) — finite olmalı.`);
    }
  }
  if (!isSeverityToken(policy.speakMinSeverity)) {
    throw new RangeError(`evaluateGuardianDecision: geçersiz policy.speakMinSeverity (${String(policy.speakMinSeverity)}).`);
  }
  if (!isSeverityToken(policy.displayMinSeverity)) {
    throw new RangeError(`evaluateGuardianDecision: geçersiz policy.displayMinSeverity (${String(policy.displayMinSeverity)}).`);
  }
  for (const [key, value] of [['maxSpeakEvents', policy.maxSpeakEvents], ['maxDisplayEvents', policy.maxDisplayEvents]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new RangeError(`evaluateGuardianDecision: geçersiz policy.${key} (${value}) — verildiyse negatif-olmayan tam sayı olmalı.`);
    }
  }
}

/* ── Ana motor ────────────────────────────────────────────────────────────── */

/**
 * TEK giriş noktası. Girdi MUTASYONA UĞRATILMAZ; `GuardianRiskEvent` nesneleri
 * değiştirilmeden (aynı referansla) yeni dizilere taşınır. Aynı girdi her zaman
 * AYNI çıktıyı verir — `Date.now`/`Math.random`/global durum YOK.
 */
export function evaluateGuardianDecision(input: GuardianDecisionInput): GuardianDecision {
  validateInput(input);

  const { guardianOutput, policy } = input;

  // Savunmacı dedup by id (ilk görülen tutulur) — GuardianEngine zaten tekil,
  // bu bir güvenlik ağı.
  const seen = new Set<string>();
  const unique: GuardianRiskEvent[] = [];
  for (const event of guardianOutput.riskEvents) {
    if (!seen.has(event.id)) {
      seen.add(event.id);
      unique.push(event);
    }
  }

  const typePriority = (type: GuardianRiskType): number =>
    isFiniteNumber(policy.eventTypePriority[type]) ? policy.eventTypePriority[type]! : NEUTRAL_TYPE_PRIORITY;

  // Öncelik sırası: severityRank DESC → eventTypePriority DESC → id ASC.
  const sorted = [...unique].sort((a, b) => {
    const rankDiff = policy.severityRank[b.severity] - policy.severityRank[a.severity];
    if (rankDiff !== 0) return rankDiff;
    const prioDiff = typePriority(b.type) - typePriority(a.type);
    if (prioDiff !== 0) return prioDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const speakThreshold = policy.severityRank[policy.speakMinSeverity];
  const displayThreshold = policy.severityRank[policy.displayMinSeverity];

  let speakEvents = sorted.filter((e) => policy.severityRank[e.severity] >= speakThreshold);
  let displayEvents = sorted.filter((e) => policy.severityRank[e.severity] >= displayThreshold);

  if (policy.maxSpeakEvents !== undefined)   speakEvents = speakEvents.slice(0, policy.maxSpeakEvents);
  if (policy.maxDisplayEvents !== undefined) displayEvents = displayEvents.slice(0, policy.maxDisplayEvents);

  return {
    speakEvents,
    displayEvents,
    highestPriority:  sorted.length > 0 ? sorted[0] : null,
    highestSeverity:  guardianOutput.highestSeverity,  // AYNEN korunur
    overallRiskScore: guardianOutput.overallRiskScore, // AYNEN korunur
  };
}
