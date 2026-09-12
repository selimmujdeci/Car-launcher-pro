/**
 * contextGrammarApplier.ts — MAVI-STT-CONTEXT-GRAMMAR: seçilen gramerin
 * DEDUP'lı, fail-soft uygulanması + PII'siz tanı sayaçları.
 *
 * ── SORUMLULUK ──────────────────────────────────────────────────────────────
 * `resolveActiveGrammar()` her dinleme oturumunun BAŞINDA çağrılır ve native'e
 * verilecek sözcük listesini döndürür. Bu bir DURUM MAKİNESİ DEĞİLDİR: karar her
 * çağrıda anlık bağlamdan YENİDEN türetilir; burada tutulan tek şey "en son ne
 * uygulandı" (dedup) ve doyan sayaçlardır.
 *
 * ── FAIL-SOFT (pazarlıksız) ─────────────────────────────────────────────────
 * Bağlam okunamaz · sözlük kurulamaz · plan üretilemezse GENEL sözlüğe düşülür;
 * o da kurulamazsa `undefined` döner → native FULL-VOCAB'da kalır. Hiçbir yolda
 * throw EDİLMEZ ve hiçbir yolda mikrofon/wake zinciri kapatılmaz.
 *
 * ── WAKE HATTI AYRIDIR ──────────────────────────────────────────────────────
 * Bu modül YALNIZ aktif komut dinlemesinin gramerini üretir. Wake grameri
 * native `startWakeWordListening` yolunda kurulur ve buraya HİÇ dokunmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Tanı yüzeyinde SÖZCÜK YOKTUR: yalnız sınıf, ADET, bounded gerekçe kodu ve
 * doyan sayaçlar. Transcript/n-best kaydedilmez.
 */

import { buildCommandGrammar, buildCommandGrammarFor } from '../commandParser';
import { readGrammarContext } from './contextGrammarSources';
import {
  selectGrammar, buildGrammarPlan, generalFallbackPlan,
  type GrammarClass, type GrammarReasonCode, type GrammarVocabulary,
  type GrammarContextSnapshot, type GrammarPlan,
} from './contextGrammarModel';

/** Saturating tavan — uzun oturumda sayaç bozulmaz. */
const SAT = Number.MAX_SAFE_INTEGER - 1;

function bump(n: number): number {
  return n < SAT ? n + 1 : SAT;
}

interface GrammarDiagState {
  grammarClass: GrammarClass;
  grammarEntryCount: number;
  lastReason: GrammarReasonCode;
  transitionCount: number;
  fallbackGeneralCount: number;
  grammarApplyFailureCount: number;
  pendingConfirmation: boolean | null;
  countersSaturated: boolean;
}

const _diag: GrammarDiagState = {
  grammarClass: 'general_command',
  grammarEntryCount: 0,
  lastReason: 'INITIAL',
  transitionCount: 0,
  fallbackGeneralCount: 0,
  grammarApplyFailureCount: 0,
  pendingConfirmation: null,
  countersSaturated: false,
};

/** Son UYGULANAN planın kararlı anahtarı — aynıysa GEÇİŞ SAYILMAZ. */
let _lastKey: string | null = null;

/** Gerçek sözlük üreticileri (parser davranışı DEĞİŞMEZ — yalnız okunur). */
const VOCAB: GrammarVocabulary = {
  buildGeneral: () => buildCommandGrammar(),
  buildFor: (types) => buildCommandGrammarFor(types),
};

function _noteSaturation(): void {
  _diag.countersSaturated = _diag.transitionCount >= SAT
    || _diag.fallbackGeneralCount >= SAT
    || _diag.grammarApplyFailureCount >= SAT;
}

/** Planı kaydet; SINIF veya İÇERİK değiştiyse geçiş say (aksi hâlde no-op). */
function _commit(plan: GrammarPlan): void {
  const changed = _lastKey !== plan.key;
  _lastKey = plan.key;
  _diag.grammarClass = plan.grammarClass;
  _diag.grammarEntryCount = plan.entryCount;
  _diag.lastReason = plan.reasonCode;
  if (changed) _diag.transitionCount = bump(_diag.transitionCount);
  if (plan.grammarClass === 'general_command' && changed) {
    _diag.fallbackGeneralCount = bump(_diag.fallbackGeneralCount);
  }
  _noteSaturation();
}

/**
 * Aktif dinleme için gramer çözümü.
 *
 * @param online `voiceService`teki TEK çevrimiçi kararı (ikinci hüküm üretilmez).
 * @returns native'e verilecek sözcükler; `undefined` = gramer VERİLMEZ (çevrimiçi
 *          tam dikte ya da sözlük kurulamadı → native full-vocab).
 */
export function resolveActiveGrammar(online: boolean, nowMs: number = Date.now()): string[] | undefined {
  let ctx: GrammarContextSnapshot;
  try {
    ctx = readGrammarContext(online, nowMs);
  } catch {
    // Bağlam katmanı komple patladı → tahmin YOK, genele düş.
    ctx = {
      pendingConfirmation: null, navigationActive: null,
      mediaPlaying: null, vehicleSessionReady: null, online: online === true,
    };
  }
  _diag.pendingConfirmation = ctx.pendingConfirmation;

  const selection = selectGrammar(ctx);
  const plan = buildGrammarPlan(selection, VOCAB);

  if (plan === null) {
    // Sözlük kurulamadı → GENEL fallback (görev kuralı).
    _diag.grammarApplyFailureCount = bump(_diag.grammarApplyFailureCount);
    const fb = generalFallbackPlan(VOCAB);
    if (fb === null) {
      // Genel de kurulamadı: gramer VERME. Mikrofon zinciri AÇIK kalır.
      _diag.grammarClass = 'general_command';
      _diag.grammarEntryCount = 0;
      _diag.lastReason = 'APPLY_FAILED_FALLBACK';
      _noteSaturation();
      return undefined;
    }
    _commit(fb);
    return fb.words ? fb.words.slice() : undefined;
  }

  _commit(plan);
  return plan.words ? plan.words.slice() : undefined;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlem yüzeyi (CAROS LAB) — PII YOK, SÖZCÜK YOK
 * ════════════════════════════════════════════════════════════════════════ */

export interface GrammarDiagnostics {
  readonly grammarClass: GrammarClass;
  readonly grammarEntryCount: number;
  readonly lastReason: GrammarReasonCode;
  readonly transitionCount: number;
  readonly fallbackGeneralCount: number;
  readonly grammarApplyFailureCount: number;
  /** `null` = onay kaynağı okunamadı ("bekleyen yok" DEĞİL). */
  readonly pendingConfirmation: boolean | null;
  readonly countersSaturated: boolean;
}

/** Salt-okunur kopya. Sözcük listesi DÖNMEZ (gizlilik yapısal). */
export function getGrammarDiagnostics(): GrammarDiagnostics {
  return Object.freeze({
    grammarClass: _diag.grammarClass,
    grammarEntryCount: _diag.grammarEntryCount,
    lastReason: _diag.lastReason,
    transitionCount: _diag.transitionCount,
    fallbackGeneralCount: _diag.fallbackGeneralCount,
    grammarApplyFailureCount: _diag.grammarApplyFailureCount,
    pendingConfirmation: _diag.pendingConfirmation,
    countersSaturated: _diag.countersSaturated,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetGrammarDiagnosticsForTest(): void {
  _diag.grammarClass = 'general_command';
  _diag.grammarEntryCount = 0;
  _diag.lastReason = 'INITIAL';
  _diag.transitionCount = 0;
  _diag.fallbackGeneralCount = 0;
  _diag.grammarApplyFailureCount = 0;
  _diag.pendingConfirmation = null;
  _diag.countersSaturated = false;
  _lastKey = null;
}

/** @internal — sayaç doyma davranışını test etmek için. */
export function _setGrammarCountersForTest(v: {
  transitionCount?: number; fallbackGeneralCount?: number; grammarApplyFailureCount?: number;
}): void {
  if (typeof v.transitionCount === 'number') _diag.transitionCount = v.transitionCount;
  if (typeof v.fallbackGeneralCount === 'number') _diag.fallbackGeneralCount = v.fallbackGeneralCount;
  if (typeof v.grammarApplyFailureCount === 'number') _diag.grammarApplyFailureCount = v.grammarApplyFailureCount;
  _noteSaturation();
}
