/**
 * companionProactiveAlert.ts — **MAVI-F13/3 · PROAKTİF KRİTİK ARIZA UYARISI.**
 *
 * ── NEDEN AYRI BİR DOSYA ────────────────────────────────────────────────────
 * Bu alt sistem `companionChatProvider` içinde yaşıyordu ama oraya **hiç ait
 * değildi**: sohbet sağlayıcısının işi sağlayıcı seçmek, prompt kurmak, modeli
 * çağırmak ve cevabı ayrıştırmaktır. Proaktif uyarı ise bunların HİÇBİRİNİ
 * yapmaz — **AĞA ÇIKMAZ**, model çağırmaz, sağlayıcı bilmez. Kendi durumu
 * (debounce · sayaçlar · iz toplaması), kendi kapıları ve kendi gözlem yüzeyi
 * olan bağımsız bir alt sistemdir.
 *
 * ── SÖZLEŞME (PAZARLIKSIZ — taşımadan önce neyse o) ─────────────────────────
 *  · **KONUŞMA OTORİTESİ DEĞİL.** Tek çıkış `opts.onSpeak` portudur; bu modül
 *    `maviSpeech`/`ttsService` import ETMEZ ve UI'a dokunmaz.
 *  · Aynı arıza için {@link PROACTIVE_ALERT_DEBOUNCE_MS} içinde İKİNCİ uyarı YOK.
 *  · Metin HER durumda {@link PROACTIVE_ALERT_MAX_CHARS} ile sınırlı.
 *  · Geri manevra / bilişsel koruma anında SUSAR (fail-closed).
 *  · Susturma sebebi SESSİZ KALMAZ — `recordProactiveDecision` ile kaydedilir.
 *  · **YENİ TELEMETRİ YOK:** mevcut iki gözlem yüzeyi (`aiOfflineReason` halkası +
 *    `diagnosticTrailCore` izi) AYNEN kullanılır.
 *
 * Genel API `companionChatProvider`dan yeniden dışa verilir → mevcut tüketiciler
 * (`companionProactiveWiring` · `maviConsoleSources` · `maviScenarioRunner` ·
 * LAB modeli) DEĞİŞMEDEN çalışır.
 */

import {
  recordProactiveDecision, sanitizeReasonSummary,
  type ProactiveReasonCode,
} from '../ai/aiOfflineReason';
/* Bağımlılıksız YAZMA çekirdeği (ağır obd/store zinciri modül grafiğine GİRMEZ). */
import { pushTrail } from '../diagnosticTrailCore';
import {
  buildSafetyContext, evaluatePreGate, SAFETY_TEMPLATES, type SafetyContext,
} from '../assistant/assistantSafetyKernel';
import { trimToLimit } from './companionAnswerShaping';

/** Monotonik saat — duvar saati sıçraması debounce'u bozmasın. */
function _now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * PROAKTİF KRİTİK ARIZA UYARISI — Mavi kendiliğinden konuşur
 *
 * Mavi yalnız SORULDUĞUNDA değil, araçta hayati bir arıza belirdiğinde de
 * konuşur. Bu yol AĞA ÇIKMAZ: metin `assistantSafetyKernel`in DETERMİNİSTİK
 * şablonundan ya da verdict'in kendi başlığından kurulur → çevrimdışıyken de
 * çalışır, sağlayıcı kotasına dokunmaz.
 *
 * PAZARLIKSIZ SINIRLAR:
 *  · UI manipülasyonu YOK — tek çıkış `onSpeak`.
 *  · Aynı arıza için {@link PROACTIVE_ALERT_DEBOUNCE_MS} içinde İKİNCİ uyarı YOK.
 *  · Metin HER durumda {@link PROACTIVE_ALERT_MAX_CHARS} ile sınırlı (spec sürüş
 *    hâli için 180 diyor; proaktif kesinti park hâlinde de kısa olmalı → tavan
 *    KOŞULSUZ uygulanır, spec'ten daha sıkı).
 *  · Geri manevra / bilişsel koruma anında SUSAR (fail-closed: güvenlik kapısı
 *    okunamazsa da susar).
 *  · Susturma sebebi SESSİZ KALMAZ — `recordProactiveSuppression` ile kaydedilir.
 * ════════════════════════════════════════════════════════════════════════ */

/** Aynı arıza için iki proaktif uyarı arası asgari süre (monotonik saat). */
export const PROACTIVE_ALERT_DEBOUNCE_MS = 5 * 60_000;
/** ISO 15008 dikkat bütçesi — proaktif kesinti bu uzunluğu AŞAMAZ. */
export const PROACTIVE_ALERT_MAX_CHARS = 180;

/**
 * Proaktif konuşma için asgari kök-neden güveni (ölçek: `percent_0_100`).
 *
 * ⚠️ UYDURULMADI: repodaki MEVCUT eşikten türetildi — `aiCore/verdictEngine`
 * `urgencyFromHypothesis` kritik severity'yi ancak `confidence >= 70` iken
 * `critical` aciliyetine yükseltir (40-69 → `urgent`, altı → `soon`). Yani
 * "%25 güvenli kritik hipotez" repo politikasınca ZATEN kritik sayılmaz;
 * proaktif ses de bu politikaya uyar (sahte güvenle sürücüyü irkiltmemek).
 *
 * ⚠️ GÜVEN BİLİNMİYORSA (alan yok/sayı değil) bu kapı UYGULANMAZ: severity
 * 'critical' zaten güçlü bir sinyaldir ve güveni ölçemediğimiz için sürücüyü
 * uyarmamak güvenlik açısından daha kötü olurdu. Bilinmeyen ≠ düşük.
 */
export const PROACTIVE_MIN_CONFIDENCE = 70;

/**
 * Proaktif uyarının ihtiyaç duyduğu MİNİMUM verdict şekli — YAPISAL tip.
 * `diagnosticTriage.DiagnosticVerdict` ve `aiCore/verdictEngine.AiCoreVerdict`
 * İKİSİ DE bunu karşılar (ikincisinde `errorFreshness` yoktur) → tek fonksiyon
 * her iki üreticiyi de besleyebilir. Parametre GENİŞLETİLDİ, daraltılmadı:
 * eski `DiagnosticVerdict` çağrıları aynen çalışır (geriye dönük uyumlu).
 */
export interface ProactiveVerdictLike {
  readonly hasActiveRootCause: boolean;
  readonly topRootCauses: readonly {
    readonly problem: string;
    readonly severity: string;
    readonly code: string;
  }[];
}

export interface ProactiveAlertResult {
  readonly outcome:  'spoken' | 'suppressed';
  /** Makine-okur gerekçe ('ok' · 'not_critical' · 'debounce' · 'reverse_attention' …). */
  readonly reason:   ProactiveReasonCode;
  /** Dedup anahtarı (kök-neden kodu). Karar verilemediyse null. */
  readonly alertKey: string | null;
  /** Seslendirilen metin; susturulduysa null. */
  readonly text:     string | null;
}

export interface ProactiveAlertOpts {
  /** TEK çıkış kanalı. Yoksa uyarı üretilmez (fail-closed). */
  readonly onSpeak:   (text: string) => void;
  readonly isDriving?: boolean;
  /** Test enjeksiyonu — verilmezse canlı `buildSafetyContext()`. */
  readonly safety?:   SafetyContext;
  /** Test enjeksiyonu — MONOTONİK saat. Verilmezse `_now()` (performance.now). */
  readonly now?:      () => number;
}

let _lastProactiveKey  = '';
let _lastProactiveAtMs = 0;
let _proactiveSpoken     = 0;
let _proactiveSuppressed = 0;
/** Son kararın açıklama künyesi (LAB gözlemi). Kaynağı olmayan alan `undefined` KALIR. */
let _lastDecisionReason: ProactiveReasonCode | null = null;
let _lastDecisionConfidence: number | null = null;
let _lastDecisionSummary: string | null = null;

/**
 * Kararı MEVCUT iki gözlem yüzeyine taşır — YENİ telemetri modeli KURULMAZ:
 *  (1) `aiOfflineReason` proaktif karar halkası (bounded künye),
 *  (2) `diagnosticTrailCore` olay izi (mevcut breadcrumb hattı).
 *
 * GİZLİLİK: seslendirilen METİN, ham prompt, model düşüncesi ve kullanıcı cümlesi
 * TAŞINMAZ. Özet yalnız tanı motorunun STATİK kural başlığından (`problem`) gelir
 * ve `sanitizeReasonSummary` ile kırpılır.
 * Fail-soft: kayıt hattı hatası kararı ETKİLEMEZ.
 */
function _emitDecisionEvidence(input: {
  outcome: 'spoken' | 'suppressed';
  reasonCode: ProactiveReasonCode;
  alertKey: string | null;
  summary?: string;
  confidence?: number;
}): void {
  // Güven yalnız GERÇEK kaynağı varsa taşınır. Ölçek: diagnosticTriage
  // RootCauseHypothesis.confidence → 0-100 (repodaki DİĞER ölçek 0-1'dir ve
  // buraya KARIŞTIRILMAZ).
  const hasConf = typeof input.confidence === 'number' && Number.isFinite(input.confidence);
  const summary = sanitizeReasonSummary(input.summary);

  _lastDecisionReason = input.reasonCode;
  _lastDecisionConfidence = hasConf ? (input.confidence as number) : null;
  _lastDecisionSummary = summary ?? null;

  try {
    recordProactiveDecision({
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      alertKey: input.alertKey ?? undefined,
      source: 'rule',                      // deterministik tanı motoru — LLM DEĞİL
      ...(summary !== undefined ? { reasonSummary: summary } : {}),
      ...(hasConf ? { confidence: input.confidence, confidenceScale: 'percent_0_100' as const } : {}),
      // fallbackReason: bu yolda KAYNAĞI YOK → yazılmaz.
    });
  } catch { /* teşhis akışı kararı bozmaz */ }

  try {
    const detail = [
      `reason=${input.reasonCode}`,
      input.alertKey ? `key=${input.alertKey}` : null,
      hasConf ? `conf=${input.confidence}%` : null,   // ölçek AÇIKÇA yazılır
      summary ? `özet=${summary}` : null,
    ].filter(Boolean).join(' ');

    // T12: KARAR DEĞİŞMEZ — yalnız gözlem üretimi sınırlanır.
    if (_shouldEmitProactiveTrail(input.outcome, input.reasonCode)) {
      pushTrail('action', `mavi proaktif: ${input.outcome}`, detail);
    }
  } catch { /* iz hattı hatası kararı bozmaz */ }
}

/* ── T12: proaktif susturma iz-gürültüsü sınırlama ──────────────────────────
 *
 * SAHA KUSURU (snapshot 2026-08-01): `mavi proaktif: suppressed — reason=not_critical`
 * satırı 4 saniyede bir yazılıyordu; 59 kayıtlık iz halkasının ~35'i (%60) TEK bu
 * satırdı. Gerçek olaylar (boot, OBD kaynak geçişleri, modal, hata) halkadan
 * TAŞIP KAYBOLUYORDU — yani gözlemlenebilirlik kendi gürültüsüyle körleşiyordu.
 *
 * Çözüm: RUTİN susturmalar (aynı reason art arda) pencere içinde TEK satıra
 * toplanır; sayım kaybolmaz, özet olarak yazılır. Kritik/beklenmedik nedenler ve
 * `spoken` sonucu HER ZAMAN anında yazılır.
 */

/** Bu pencere içinde aynı rutin reason tekrar yazılmaz; sonunda özet basılır. */
const PROACTIVE_TRAIL_WINDOW_MS = 60_000;
/**
 * Rutin (beklenen, aksiyon gerektirmeyen) susturma nedenleri. Bunların DIŞINDAKİ
 * her neden beklenmediktir → anında yazılır (kanıt kaybı YASAK).
 */
const ROUTINE_SUPPRESS_REASONS = new Set(['not_critical', 'no_verdict', 'duplicate', 'cooldown']);

let _trailAggReason: string | null = null;
let _trailAggCount  = 0;
let _trailAggFirstAt = 0;
let _trailAggLastAt  = 0;

/** @internal T12 kilit testleri — karar mantığını yan etkisiyle birlikte sorgular. */
export function _testShouldEmitProactiveTrail(outcome: string, reasonCode: string): boolean {
  return _shouldEmitProactiveTrail(outcome, reasonCode);
}

/** @internal T12 kilit testleri — gerçek iz yazımını da tetikler. */
export function _testEmitProactiveTrail(outcome: string, reasonCode: string): void {
  if (_shouldEmitProactiveTrail(outcome, reasonCode)) {
    pushTrail('action', `mavi proaktif: ${outcome}`, `reason=${reasonCode}`);
  }
}

/** Test/teardown izolasyonu — aggregation state sonraki oturuma SIZMAZ. */
export function _resetProactiveTrailAggregation(): void {
  _trailAggReason = null;
  _trailAggCount = 0;
  _trailAggFirstAt = 0;
  _trailAggLastAt = 0;
}

function _flushProactiveTrailAggregate(): void {
  if (_trailAggReason === null || _trailAggCount <= 0) return;
  const spanS = Math.max(0, Math.round((_trailAggLastAt - _trailAggFirstAt) / 1000));
  pushTrail(
    'action',
    'mavi proaktif: suppressed ×' + _trailAggCount,
    `reason=${_trailAggReason} pencere=${spanS}s (özet — her karar ayrı yazılmaz)`,
  );
  _trailAggReason = null;
  _trailAggCount = 0;
}

/**
 * Bu susturma kararı ANINDA yazılmalı mı? Saf-yan-etkili karar (aggregation state
 * günceller) — kararın KENDİSİNİ etkilemez, yalnız iz üretimini.
 */
function _shouldEmitProactiveTrail(outcome: string, reasonCode: string): boolean {
  // Konuşulan her şey + rutin OLMAYAN her neden → anında görünür.
  if (outcome !== 'suppressed' || !ROUTINE_SUPPRESS_REASONS.has(reasonCode)) {
    _flushProactiveTrailAggregate();   // birikmiş özet kaybolmasın
    return true;
  }

  const now = Date.now();
  // Farklı bir rutin nedene geçildi → önceki özeti bas, yenisini anında göster.
  if (_trailAggReason !== reasonCode) {
    _flushProactiveTrailAggregate();
    _trailAggReason  = reasonCode;
    _trailAggCount   = 0;
    _trailAggFirstAt = now;
    _trailAggLastAt  = now;
    return true;                       // pencerenin İLK örneği her zaman yazılır
  }

  _trailAggCount++;
  _trailAggLastAt = now;

  // Pencere doldu → özeti bas, sayacı sıfırla.
  if (now - _trailAggFirstAt >= PROACTIVE_TRAIL_WINDOW_MS) {
    _flushProactiveTrailAggregate();
    _trailAggReason  = reasonCode;
    _trailAggFirstAt = now;
  }
  return false;                        // pencere içi tekrar → iz halkasını doldurma
}

/**
 * Kritik tanı verdikti geldiğinde TEK ATIMLIK proaktif sesli uyarı üretir.
 * Karar sırası (ilk eşleşen kazanır — hepsi fail-closed):
 *  1. `onSpeak` yok / verdict bozuk                 → sustur
 *  2. Kritik kök-neden yok                          → sustur
 *  3. Güvenlik kapısı okunamadı / geri manevra      → sustur
 *  4. Aynı arıza 5 dk içinde zaten konuşuldu        → sustur
 *  5. Aksi hâlde: deterministik metin + tavan → `onSpeak`
 */
export function triggerProactiveDiagnosticAlert(
  verdict: ProactiveVerdictLike | null | undefined,
  opts: ProactiveAlertOpts,
): ProactiveAlertResult {
  /**
   * Susturma kararını AÇIKLANABİLİR künyeyle kaydeder.
   * `confidence` yalnız verdict'ten GERÇEKTEN okunabildiğinde taşınır — kaynağı
   * yoksa alan HİÇ YAZILMAZ (sahte güven yasağı).
   */
  const suppress = (
    reason: ProactiveReasonCode,
    alertKey: string | null = null,
    explain?: { summary?: string; confidence?: number },
  ): ProactiveAlertResult => {
    _proactiveSuppressed++;
    _emitDecisionEvidence({
      outcome: 'suppressed', reasonCode: reason, alertKey,
      summary: explain?.summary, confidence: explain?.confidence,
    });
    return Object.freeze({ outcome: 'suppressed' as const, reason, alertKey, text: null });
  };

  const speak = opts && typeof opts.onSpeak === 'function' ? opts.onSpeak : null;
  if (!speak) return suppress('no_speech_sink');
  if (!verdict || !Array.isArray(verdict.topRootCauses)) return suppress('invalid_verdict');

  // 2 — YALNIZ kritik severity taşıyan AKTİF kök-neden proaktif uyarıya değer.
  const top = verdict.hasActiveRootCause
    ? verdict.topRootCauses.find((h) => h && h.severity === 'critical')
    : undefined;
  if (!top) return suppress('not_critical');
  const key = typeof top.code === 'string' && top.code.length > 0 ? top.code : 'unknown_root_cause';
  /* GERÇEK açıklama kaynağı — UYDURULMAZ:
     · confidence ← `diagnosticTriage.RootCauseHypothesis.confidence` (ölçek 0-100)
       Sayı değilse alan HİÇ TAŞINMAZ (varsayılan/sahte değer YOK).
     · summary    ← `top.problem` = tanı kuralının STATİK başlığı (PII'siz).
       Seslendirilen metin, ham prompt ve model düşüncesi BURAYA GİRMEZ. */
  const explain = {
    summary: typeof top.problem === 'string' ? top.problem : undefined,
    ...(typeof (top as { confidence?: unknown }).confidence === 'number'
      && Number.isFinite((top as { confidence: number }).confidence)
      ? { confidence: (top as { confidence: number }).confidence } : {}),
  };

  // 2b — GÜVEN KAPISI: kritik AMA güven eşiğin altındaysa konuşma (sahte güven yasağı).
  //      Güven BİLİNMİYORSA kapı uygulanmaz (bkz. PROACTIVE_MIN_CONFIDENCE gerekçesi).
  if (typeof explain.confidence === 'number' && explain.confidence < PROACTIVE_MIN_CONFIDENCE) {
    return suppress('low_confidence', key, explain);
  }

  // 3 — Güvenlik kapısı. Okunamazsa da SUSAR (kapısız proaktif konuşma YASAK).
  let pre: ReturnType<typeof evaluatePreGate> | null = null;
  try { pre = evaluatePreGate(opts.safety ?? buildSafetyContext()); } catch { pre = null; }
  if (!pre) return suppress('safety_gate_unavailable', key, explain);
  if (pre.safetyTemplateId === 'reverse_attention') return suppress('reverse_attention', key, explain);

  // 4 — 5 dk debounce (MONOTONİK saat → clock-jump güvenli, CLAUDE.md §4).
  const nowFn = typeof opts.now === 'function' ? opts.now : _now;
  let now = 0;
  try { now = nowFn(); } catch { now = 0; }
  if (!Number.isFinite(now)) now = 0;
  // "Daha önce konuşuldu" kanıtı ANAHTARdır, damga DEĞİL: `performance` yoksa
  // `_now()` 0 döner ve damga-tabanlı kontrol debounce'u sessizce ÖLDÜRÜRDÜ.
  // O ortamda elapsed=0 kalır → pencere hep kapalı sayılır (fail-safe: daha AZ kesinti).
  if (_lastProactiveKey === key && now - _lastProactiveAtMs < PROACTIVE_ALERT_DEBOUNCE_MS) {
    return suppress('debounce', key, explain);
  }

  // 5 — Metin: güvenlik çekirdeğinin deterministik cevabı varsa O kullanılır
  //     (aşırı ısınma/yağ basıncı gibi doğrulanmış şablonlar); yoksa kök-neden
  //     başlığı + "servise kontrol ettir" şablonu. AĞA ÇIKILMAZ.
  const base = pre.deterministicResponse
    ? pre.deterministicResponse
    : `${top.problem}. ${SAFETY_TEMPLATES.service_required.text}`;
  const text = trimToLimit(base, PROACTIVE_ALERT_MAX_CHARS);
  if (!text) return suppress('empty_text', key, explain);

  _lastProactiveKey  = key;
  _lastProactiveAtMs = now;
  _proactiveSpoken++;
  // KONUŞULAN karar da açıklanabilir künyeye + olay izine yazılır (yalnız
  // susturmalar değil) — "neden konuştu?" sorusu da kanıtla yanıtlanır.
  _emitDecisionEvidence({ outcome: 'spoken', reasonCode: 'ok', alertKey: key, ...explain });
  try { speak(text); } catch { /* seslendirme gözlemcisinin hatası akışı bozmaz */ }
  return Object.freeze({ outcome: 'spoken' as const, reason: 'ok' as const, alertKey: key, text });
}

/**
 * Proaktif uyarı motorunun CAROS LAB gözlem yüzeyi — salt okunur, PII YOK
 * (uyarı METNİ taşınmaz, yalnız adet + dedup anahtarı + kalan debounce).
 */
export function getProactiveAlertDiagnostics(): {
  spokenCount: number; suppressedCount: number;
  lastAlertKey: string | null; debounceRemainingMs: number;
  /** Son kararın bounded sebep kodu; karar yoksa null. */
  lastReasonCode: ProactiveReasonCode | null;
  /** Son kararın güveni — KAYNAĞI YOKSA null (sahte 0 DEĞİL). */
  lastConfidence: number | null;
  /** Yukarıdaki değerin ölçeği; değer yoksa null (sessiz normalize YOK). */
  lastConfidenceScale: 'percent_0_100' | null;
  /** Kısa sanitize açıklama; yoksa null. Model düşüncesi DEĞİL. */
  lastReasonSummary: string | null;
  /** Kararın üreticisi — bugün üretimde yalnız deterministik kural motoru. */
  lastDecisionSource: 'rule' | null;
} {
  const now = _now();
  const elapsed = _lastProactiveKey !== '' ? now - _lastProactiveAtMs : Infinity;
  return {
    spokenCount:     _proactiveSpoken,
    suppressedCount: _proactiveSuppressed,
    lastAlertKey:    _lastProactiveKey || null,
    debounceRemainingMs: Number.isFinite(elapsed) && elapsed < PROACTIVE_ALERT_DEBOUNCE_MS
      ? Math.max(0, Math.round(PROACTIVE_ALERT_DEBOUNCE_MS - elapsed))
      : 0,
    lastReasonCode:      _lastDecisionReason,
    lastConfidence:      _lastDecisionConfidence,
    // Ölçek yalnız DEĞER varsa anlamlıdır; değer yoksa ölçek de null.
    lastConfidenceScale: _lastDecisionConfidence !== null ? 'percent_0_100' : null,
    lastReasonSummary:   _lastDecisionSummary,
    lastDecisionSource:  _lastDecisionReason !== null ? 'rule' : null,
  };
}

/* ── Driver DNA: canlı sürüş stili (kimliğe enjekte edilir) ──── */


/**
 * @internal — testler arası izolasyon. Alt sistemin TÜM durumu burada
 * sıfırlanır; `companionChatProvider` artık alanları tek tek bilmez (tek kapı).
 */
export function _resetProactiveAlertForTest(): void {
  _lastProactiveKey = '';
  _lastProactiveAtMs = 0;
  _proactiveSpoken = 0;
  _proactiveSuppressed = 0;
  _lastDecisionReason = null;
  _lastDecisionConfidence = null;
  _lastDecisionSummary = null;
  _resetProactiveTrailAggregation();
}
