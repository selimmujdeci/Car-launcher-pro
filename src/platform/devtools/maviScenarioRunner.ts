/**
 * maviScenarioRunner — CAROS LAB · Mavi DETERMİNİSTİK SENARYO KOŞUCUSU (Faz A9).
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * Mavi'nin kritik güvenlik ve karar davranışlarını araç/ağ/telefon OLMADAN,
 * izole ve tekrar üretilebilir biçimde koşturur. Her senaryo GERÇEK üretim
 * fonksiyonunu çağırır — paralel/sahte bir kopya implementasyon YOKTUR.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · Gerçek EventBus'a HİÇBİR olay YAYINLANMAZ (bus import bile edilmez).
 *  · Gerçek TTS · telefon · navigasyon · storage · ağ · OBD çağrısı YOK —
 *    hepsi ya enjekte edilir ya da çağrılan fonksiyon zaten saf.
 *  · Production singleton MONKEY PATCH EDİLMEZ: `deepScanRuntimeService` /
 *    `deepScanIgnitionSource` tekilleri yerine FABRİKA ile yeni örnek kurulur.
 *  · Timer/poll/interval/arka plan görevi YOK. Saat enjekte edilir (senaryo
 *    kapsamında kontrollü `now`) → aynı girdi ⇒ aynı çıktı.
 *  · Her senaryo KENDİ bağımlılıklarıyla çalışır; modül durumu paylaşılmaz.
 *    Modül durumu kullanan tek yol (proaktif debounce) senaryo başında ve
 *    sonunda `_resetCompanionChatForTest()` ile İZOLE edilir.
 *  · Bir senaryo throw ederse yalnız O senaryo FAIL olur; koşu DEVAM EDER.
 *  · Rapor BOUNDED: ham prompt · kullanıcı mesajı · tam sensör paketi · PII ·
 *    model düşüncesi RAPORA GİRMEZ (yalnız bounded kod ve kısa özet).
 *
 * ⚠️ BU BİR SİMÜLASYONDUR — cihaz/araç doğrulaması DEĞİLDİR. Sonuçlar
 * `docs/DEVICE_VALIDATION_LEDGER.md` 🔴 maddelerini 🟢 yapmaz.
 */

import {
  triggerProactiveDiagnosticAlert,
  _resetCompanionChatForTest,
  PROACTIVE_ALERT_DEBOUNCE_MS,
  PROACTIVE_MIN_CONFIDENCE,
  getActiveTopicSnapshot,
  type ProactiveVerdictLike,
} from '../companion/companionChatProvider';
import { handleAiCoreRunResult } from '../companion/companionProactiveWiring';
import { buildTopicHintLine, resolveDemonstrativeReference } from '../companion/companionContext';
import { DeepScanRuntimeService } from '../deepScan/deepScanRuntimeService';
import { createDeepScanIgnitionSource } from '../deepScan/deepScanIgnitionSource';
import { deriveEngineRunningEvidence } from '../deepScan/ignitionEvidenceAdapter';
import { createPilotHandlers, type PilotHandlerDeps } from '../maviCore/wiring/maviPilotHandlers';
import { createPilotActionRegistry } from '../maviCore/actionRegistry';
import { evaluateActionIdSafety } from '../maviCore/actionSafety';
import { createAiSafetyGate } from '../aiCore/safetyGate';
import { errorKindFromException, offlineReasonFromErrorKind } from '../ai/aiOfflineReason';
// GERÇEK karar satırlarının yazıldığı çekirdek (ağır obd/store zinciri YOK).
import { getOwnTrail } from '../diagnosticTrailCore';
import type { ProactiveReasonCode, ConfidenceScale } from '../ai/aiOfflineReason';

/* ══════════════════════════════════════════════════════════════════════════
 * Rapor sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

/** Rapor alanı tavanları (bounded — uzun metin taşınmaz). */
export const MAX_SCENARIO_TEXT = 120;
/** Koşu başına azami senaryo (liste sınırsız büyümez). */
export const MAX_SCENARIO_RESULTS = 32;

/** Bu koşunun NE OLMADIĞI — UI'dan silinemeyen beyan. */
export const SCENARIO_SIMULATION_LABEL =
  'SİMÜLASYON — cihaz/araç doğrulaması DEĞİLDİR';

export interface ScenarioReport {
  readonly id: string;
  readonly title: string;
  readonly pass: boolean;
  /** Beklenen sonucun kısa, bounded ifadesi. */
  readonly expected: string;
  /** Gerçekleşen sonucun kısa, bounded ifadesi. */
  readonly actual: string;
  /** Senaryonun hedeflediği eylem/karar kimliği; yoksa alan YAZILMAZ. */
  readonly selectedAction?: string;
  readonly reasonCode?: ProactiveReasonCode | string;
  readonly suppressionReason?: ProactiveReasonCode | string;
  /** Değer + ölçek BİRLİKTE; kaynağı yoksa İKİSİ DE yazılmaz (sahte güven YOK). */
  readonly confidence?: number;
  readonly confidenceScale?: ConfidenceScale;
  /** Kararın dayandığı kanıtın bounded özeti. */
  readonly evidenceSummary?: string;
  /** Deterministik eşdeğer: gerçek süre DEĞİL, enjekte saatteki sanal ilerleme (ms). */
  readonly virtualElapsedMs: number;
  /** Senaryo throw ettiyse bounded hata kodu; aksi hâlde alan YAZILMAZ. */
  readonly errorCode?: string;
}

export interface ScenarioRunSummary {
  readonly label: typeof SCENARIO_SIMULATION_LABEL;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly ScenarioReport[];
  /** GERÇEK olay izindeki Mavi karar satırı sayısı (Görev 3 kaynağı). */
  readonly trailRowCount: number | null;
}

/* ── Bounded metin ─────────────────────────────────────────────────────── */

function b(text: unknown): string {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_SCENARIO_TEXT ? flat : `${flat.slice(0, MAX_SCENARIO_TEXT - 1)}…`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Senaryo altyapısı — her senaryo KENDİ saatiyle, KENDİ bağımlılıklarıyla
 * ════════════════════════════════════════════════════════════════════════ */

/** Senaryoya verilen kontrollü saat (gerçek saat OKUNMAZ → determinizm). */
interface Clock { now: () => number; advance: (ms: number) => void; elapsed: () => number }

/**
 * Sabit, SIFIR-OLMAYAN taban: bazı üretim yolları (`deriveEngineRunningEvidence`)
 * `observedAt > 0` şartı arar — 0 damgası "damga yok" sayılır. Taban sabittir →
 * determinizm bozulmaz. `elapsed()` tabandan farkı verir (sanal geçen süre).
 */
const CLOCK_BASE_MS = 1_000_000;

function makeClock(): Clock {
  let t = CLOCK_BASE_MS;
  return { now: () => t, advance: (ms) => { t += ms; }, elapsed: () => t - CLOCK_BASE_MS };
}

/** Bir senaryonun döndürdüğü ham sonuç (rapor alanları buradan kurulur). */
type ScenarioOutcome = Omit<ScenarioReport, 'id' | 'title' | 'virtualElapsedMs' | 'errorCode'>;

interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly run: (clock: Clock) => ScenarioOutcome;
}

/** Test/UI'ın kullandığı seslendirme yakalayıcısı — GERÇEK TTS ASLA çağrılmaz. */
function captureSpeak(): { calls: string[]; fn: (t: string) => void } {
  const calls: string[] = [];
  return { calls, fn: (t: string) => { calls.push(t); } };
}

/** GERÇEK üretim biçimiyle uyumlu verdict fixture'ı (RootCauseHypothesis şekli). */
function fixtureVerdict(opts: {
  severity?: 'critical' | 'warning'; confidence?: number | null;
  code?: string; problem?: string; active?: boolean;
} = {}): ProactiveVerdictLike {
  const active = opts.active ?? true;
  const hyp: Record<string, unknown> = {
    problem: opts.problem ?? 'Soğutma fanı devrede değil',
    severity: opts.severity ?? 'critical',
    code: opts.code ?? 'ROOT_FAN',
  };
  if (opts.confidence !== null) hyp.confidence = opts.confidence ?? 88;
  return { hasActiveRootCause: active, topRootCauses: active ? [hyp as never] : [] };
}

/** Telefon handler'ları için TÜM portları casus fonksiyonla dolduran deps —
 *  gerçek medya/nav/araç servisi ASLA bağlanmaz. */
function inertPilotDeps(over: Partial<PilotHandlerDeps> = {}): PilotHandlerDeps {
  const noop = (): void => { /* üretim servisi bağlı DEĞİL */ };
  return {
    setTheme: noop, openScreen: () => false,
    mediaPlay: noop, mediaPause: noop, mediaNext: noop,
    setVolume: noop, navigateTo: noop, openNavScreen: () => false,
    cancelNavigation: noop,
    readHealth: () => ({ dtcCount: 0, criticalCount: 0, summary: 'simülasyon' }),
    readCurrentLocation: () => ({ ok: false, text: 'simülasyon' }),
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SENARYOLAR — her biri GERÇEK üretim fonksiyonunu çağırır
 * ════════════════════════════════════════════════════════════════════════ */

const SCENARIOS: readonly Scenario[] = Object.freeze([
  /* 1 */ {
    id: 'critical-dtc-speaks',
    title: 'Kritik (araç-olayı olmayan) kök-neden → proaktif uyarı uygun',
    run: (c) => {
      const speak = captureSpeak();
      const r = triggerProactiveDiagnosticAlert(fixtureVerdict({ confidence: 88 }), {
        onSpeak: speak.fn, safety: {}, now: c.now,
      });
      return {
        pass: r.outcome === 'spoken' && speak.calls.length === 1
          && speak.calls[0].length <= 180,
        expected: 'spoken · tek seslendirme · ≤180 karakter',
        actual: `${r.outcome} · ${speak.calls.length} seslendirme · ${speak.calls[0]?.length ?? 0} karakter`,
        selectedAction: 'proactive.speak',
        reasonCode: r.reason,
        confidence: 88, confidenceScale: 'percent_0_100',
        evidenceSummary: b('kritik kök-neden · güven eşik üstü'),
      };
    },
  },

  /* 2 */ {
    id: 'overheat-double-voice-suppressed',
    title: 'ENGINE_OVERHEAT → orchestrator zaten seslendirdi, ikinci ses bastırılır',
    run: (c) => {
      const speak = captureSpeak();
      const r = handleAiCoreRunResult({ verdict: fixtureVerdict({ confidence: 92 }) }, {
        speak: speak.fn, safety: () => ({ engineOverheat: true }), now: c.now,
      });
      return {
        pass: r.outcome === 'suppressed'
          && r.reason === 'already_voiced_by_orchestrator' && speak.calls.length === 0,
        expected: 'suppressed · already_voiced_by_orchestrator · 0 seslendirme',
        actual: `${r.outcome} · ${r.reason} · ${speak.calls.length} seslendirme`,
        selectedAction: 'proactive.speak',
        reasonCode: r.reason, suppressionReason: r.reason,
        evidenceSummary: b('SystemOrchestrator ENGINE_OVERHEAT dalı zaten konuşuyor'),
      };
    },
  },

  /* 3 */ {
    id: 'reverse-confirmed-suppressed',
    title: 'Geri manevra DOĞRULANMIŞ → proaktif konuşma bastırılır',
    run: (c) => {
      const speak = captureSpeak();
      const r = triggerProactiveDiagnosticAlert(fixtureVerdict(), {
        onSpeak: speak.fn, safety: { reverseActive: true }, now: c.now,
      });
      return {
        pass: r.outcome === 'suppressed' && r.reason === 'reverse_attention'
          && speak.calls.length === 0,
        expected: 'suppressed · reverse_attention',
        actual: `${r.outcome} · ${r.reason}`,
        selectedAction: 'proactive.speak',
        reasonCode: r.reason, suppressionReason: r.reason,
        evidenceSummary: b('güvenlik ön-kapısı reverse_attention şablonu döndürdü'),
      };
    },
  },

  /* 4 */ {
    id: 'reverse-unknown-failclosed',
    title: 'Geri manevra BİLİNMİYOR (bağlam okunamıyor) → fail-closed bastırılır',
    run: (c) => {
      const speak = captureSpeak();
      // Güvenlik bağlamı ÜRETİLEMİYOR → "geri vitesde değil" VARSAYILMAZ.
      const r = handleAiCoreRunResult({ verdict: fixtureVerdict() }, {
        speak: speak.fn,
        safety: () => { throw new Error('safety context unavailable'); },
        now: c.now,
      });
      return {
        pass: r.outcome === 'suppressed' && speak.calls.length === 0,
        expected: 'suppressed · bilinmeyen durum güvenli sayılmaz',
        actual: `${r.outcome} · ${r.reason}`,
        selectedAction: 'proactive.speak',
        reasonCode: r.reason, suppressionReason: r.reason,
        evidenceSummary: b('bağlam okunamadı → fail-closed'),
      };
    },
  },

  /* 5 */ {
    id: 'ignition-unknown-scan-gate-closed',
    title: 'Kontak BİLİNMİYOR → aktif tarama kapısı KAPALI',
    run: (c) => {
      // Üretim tekili DEĞİL — yeni örnek (monkey patch YOK).
      const svc = new DeepScanRuntimeService({ now: c.now, ignitionResolver: () => null });
      svc.startScan({ vehicleFingerprintHash: 'a1b2c3d4e5f60718', ignitionConfirmed: true });
      const snap = svc.prepare();
      svc.updatePhase('ecu_discovery');
      svc.recordEcuDiscovery({ ecuAddress: '7E8' });
      const after = svc.getSnapshot();
      svc.dispose();
      return {
        pass: snap.status === 'waiting_for_ignition'
          && after.ignitionConfirmed === null
          && after.phase === null && after.discoveredEcuCount === 0,
        expected: 'waiting_for_ignition · ignitionConfirmed=null · 0 ECU sorgusu',
        actual: `${after.status} · ignitionConfirmed=${String(after.ignitionConfirmed)} · ${after.discoveredEcuCount} ECU`,
        selectedAction: 'deepScan.prepare',
        reasonCode: 'ignition_not_confirmed',
        evidenceSummary: b('bilinmeyen kontak "kapalı" diye kaydedilmez; kapı yine de kapalı'),
      };
    },
  },

  /* 6 */ {
    id: 'stale-evidence-not-trusted',
    title: 'BAYAT kanıt → güncel/güvenilir veri gibi sunulmaz',
    run: (c) => {
      const ev = deriveEngineRunningEvidence({ rpm: 900, batteryVoltage: 14, observedAt: c.now() })!;
      c.advance(6_000);                       // stale eşiği (5000 ms) aşıldı
      const src = createDeepScanIgnitionSource({ now: c.now });
      src.submitEvidence(ev);
      const confirmed = src.getConfirmedValue();
      const gate = src.isConfirmedForActiveScan();
      const stale = src.getSnapshot().stale;
      src.dispose();
      return {
        pass: confirmed === null && gate === false && stale === true,
        expected: 'confirmed=null (BİLİNMİYOR) · kapı kapalı · stale=true',
        actual: `confirmed=${String(confirmed)} · kapı=${gate} · stale=${stale}`,
        selectedAction: 'ignition.resolve',
        reasonCode: 'stale_or_low_confidence',
        evidenceSummary: b('taze kanıt yok → "açık" iddiası üretilmez'),
      };
    },
  },

  /* 7 */ {
    id: 'low-confidence-no-speech',
    title: 'DÜŞÜK güvenli kritik verdict → proaktif kritik konuşma YAPILMAZ',
    run: (c) => {
      const speak = captureSpeak();
      const conf = PROACTIVE_MIN_CONFIDENCE - 45;
      const r = triggerProactiveDiagnosticAlert(fixtureVerdict({ confidence: conf }), {
        onSpeak: speak.fn, safety: {}, now: c.now,
      });
      return {
        pass: r.outcome === 'suppressed' && r.reason === 'low_confidence'
          && speak.calls.length === 0,
        expected: `suppressed · low_confidence (eşik ${PROACTIVE_MIN_CONFIDENCE})`,
        actual: `${r.outcome} · ${r.reason}`,
        selectedAction: 'proactive.speak',
        reasonCode: r.reason, suppressionReason: r.reason,
        confidence: conf, confidenceScale: 'percent_0_100',
        evidenceSummary: b('verdictEngine politikası: güven<70 kritik aciliyet üretmez'),
      };
    },
  },

  /* 8 */ {
    id: 'phone-not-connected',
    title: 'phone.call.start · telefon bağlı DEĞİL → PHONE_NOT_CONNECTED',
    run: () => {
      const h = createPilotHandlers(inertPilotDeps());   // isPhoneLinkReady VERİLMEDİ
      const res = h['phone.call.start']({ contactName: 'Ayşe' }, new AbortController().signal);
      const r = res as { ok: boolean; error?: string };
      return {
        pass: r.ok === false && r.error === 'PHONE_NOT_CONNECTED',
        expected: 'ok=false · PHONE_NOT_CONNECTED',
        actual: `ok=${r.ok} · ${r.error ?? '—'}`,
        selectedAction: 'phone.call.start',
        reasonCode: r.error ?? 'unknown',
        evidenceSummary: b('oturum yok → sahte "aradım" DÖNMEZ'),
      };
    },
  },

  /* 9 */ {
    id: 'phone-transport-missing',
    title: 'Telefon oturumu VAR ama komut kanalı YOK → PHONE_TRANSPORT_MISSING',
    run: () => {
      const h = createPilotHandlers(inertPilotDeps({ isPhoneLinkReady: () => true }));
      const r = h['phone.call.start']({ contactName: 'Ayşe' }, new AbortController().signal) as
        { ok: boolean; error?: string };
      return {
        pass: r.ok === false && (r.error ?? '').includes('PHONE_TRANSPORT_MISSING'),
        expected: 'ok=false · PHONE_TRANSPORT_MISSING',
        actual: `ok=${r.ok} · ${b(r.error)}`,
        selectedAction: 'phone.call.start',
        reasonCode: 'PHONE_TRANSPORT_MISSING',
        evidenceSummary: b('bağlı görünmek aramayı YAPTIRMAZ'),
      };
    },
  },

  /* 10 */ {
    id: 'high-risk-needs-confirmation',
    title: 'Yüksek riskli eylem ONAYSIZ → confirmation-required',
    run: () => {
      const reg = createPilotActionRegistry();
      const gate = createAiSafetyGate();
      const d = evaluateActionIdSafety(reg, gate, 'phone.call.start');
      const ok = evaluateActionIdSafety(reg, gate, 'phone.call.start', { confirmed: true });
      return {
        pass: d.outcome === 'confirm' && d.reason === 'needs_confirmation'
          && ok.outcome === 'allow',
        expected: 'onaysız=confirm · onaylı=allow',
        actual: `onaysız=${d.outcome} · onaylı=${ok.outcome}`,
        selectedAction: 'phone.call.start',
        reasonCode: d.reason,
        evidenceSummary: b('risk=high · reversible=false → onay ZORUNLU'),
      };
    },
  },

  /* 11 */ {
    id: 'provider-timeout-fallback',
    title: 'Sağlayıcı TIMEOUT → repodaki gerçek fallback sınıflandırması',
    run: () => {
      // GERÇEK sınıflandırma zinciri; ağ çağrısı YOK (yalnız exception şekli).
      const abort = { name: 'AbortError' };
      const kind = errorKindFromException(abort);
      const reason = offlineReasonFromErrorKind(kind);
      return {
        pass: kind === 'timeout' && reason === 'NETWORK_TIMEOUT',
        expected: 'kind=timeout · reason=NETWORK_TIMEOUT',
        actual: `kind=${kind} · reason=${reason}`,
        selectedAction: 'ai.provider.request',
        reasonCode: reason,
        evidenceSummary: b('AbortError → timeout (sessiz offline YASAK)'),
      };
    },
  },

  /* 12 */ {
    id: 'proactive-debounce',
    title: 'Aynı proaktif olay debounce penceresinde → ikinci uyarı bastırılır',
    run: (c) => {
      const speak = captureSpeak();
      const v = fixtureVerdict({ confidence: 90 });
      const first = triggerProactiveDiagnosticAlert(v, { onSpeak: speak.fn, safety: {}, now: c.now });
      c.advance(PROACTIVE_ALERT_DEBOUNCE_MS - 1);
      const second = triggerProactiveDiagnosticAlert(v, { onSpeak: speak.fn, safety: {}, now: c.now });
      return {
        pass: first.outcome === 'spoken' && second.outcome === 'suppressed'
          && second.reason === 'debounce' && speak.calls.length === 1,
        expected: '1. spoken · 2. suppressed(debounce) · toplam 1 seslendirme',
        actual: `1. ${first.outcome} · 2. ${second.outcome}(${second.reason}) · ${speak.calls.length} seslendirme`,
        selectedAction: 'proactive.speak',
        reasonCode: second.reason, suppressionReason: second.reason,
        confidence: 90, confidenceScale: 'percent_0_100',
        evidenceSummary: b(`aynı anahtar · pencere ${PROACTIVE_ALERT_DEBOUNCE_MS} ms`),
      };
    },
  },

  /* 13 */ {
    id: 'active-topic-hint',
    title: 'Takip sorusunda bounded Active Topic ipucu üretilir',
    run: () => {
      // MEVCUT PII-safe gözlem yüzeyi (ikinci topic modeli KURULMAZ).
      const snap = getActiveTopicSnapshot();
      const hint = buildTopicHintLine('engine_temperature', 'fresh');
      const expired = buildTopicHintLine('engine_temperature', 'expired');
      const leaky = buildTopicHintLine('P0301', 'fresh');   // serbest metin REDDEDİLMELİ
      return {
        pass: hint !== null && hint.length <= 200 && hint.includes('netleştir')
          && expired === null && leaky === null
          && (snap.topic === null || typeof snap.topic === 'string'),
        expected: 'taze konu → bounded ipucu · bayat/serbest metin → ipucu YOK',
        actual: `ipucu=${hint ? 'VAR' : 'YOK'} · bayat=${expired ? 'VAR' : 'YOK'} · serbestMetin=${leaky ? 'KABUL' : 'RED'}`,
        selectedAction: 'prompt.topicHint',
        reasonCode: 'topic_hint_bounded',
        evidenceSummary: b(`anlık konu: ${snap.topic ?? 'YOK'} (${snap.freshness})`),
      };
    },
  },

  /* 14 */ {
    id: 'ambiguous-demonstrative-clarify',
    title: 'Belirsiz "bunu/şunu" → otomatik eylem YOK, netleştirme gerekir',
    run: () => {
      const withTopic = resolveDemonstrativeReference('bunu sonra hatırlat', 'engine_temperature');
      const noTopic = resolveDemonstrativeReference('şunu kaydet', null);
      const clear = resolveDemonstrativeReference('yarın lastik kontrolünü hatırlat', 'engine_temperature');
      return {
        // Konu BİLİNSE BİLE netleştirme şart — konu eylem yetkisi VERMEZ.
        pass: withTopic.needsClarification === true
          && noTopic.needsClarification === true
          && clear.needsClarification === false,
        expected: 'belirsiz → needsClarification=true (konu varken de) · açık → false',
        actual: `konulu=${withTopic.needsClarification} · konusuz=${noTopic.needsClarification} · açık=${clear.needsClarification}`,
        selectedAction: 'command.clarify',
        reasonCode: 'needs_clarification',
        evidenceSummary: b('aktif konu otomatik çözüm ÜRETMEZ'),
      };
    },
  },
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Koşucu
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tüm senaryoları sırayla koşar. DETERMİNİSTİK: gerçek saat okunmaz, rastgelelik
 * yoktur → aynı fixture seti her koşuda AYNI raporu üretir.
 *
 * İZOLASYON: modül durumu kullanan tek yol (proaktif debounce sayaçları) her
 * senaryonun ÖNCESİNDE ve SONRASINDA sıfırlanır → sızıntı yok.
 * FAIL-SOFT: bir senaryo throw ederse yalnız o FAIL olur, koşu sürer.
 */
export function runMaviScenarios(): ScenarioRunSummary {
  const results: ScenarioReport[] = [];

  for (const s of SCENARIOS.slice(0, MAX_SCENARIO_RESULTS)) {
    const clock = makeClock();
    try { _resetCompanionChatForTest(); } catch { /* izolasyon best-effort */ }
    try {
      const out = s.run(clock);
      results.push({ id: s.id, title: s.title, ...out, virtualElapsedMs: clock.elapsed() });
    } catch (err) {
      // Senaryo hatası koşuyu DURDURMAZ — bounded kodla FAIL raporlanır.
      results.push({
        id: s.id, title: s.title, pass: false,
        expected: 'senaryo hatasız koşmalı',
        actual: 'senaryo istisna fırlattı',
        virtualElapsedMs: clock.elapsed(),
        errorCode: b((err as { name?: string })?.name ?? 'ScenarioError'),
      });
    } finally {
      try { _resetCompanionChatForTest(); } catch { /* izolasyon best-effort */ }
    }
  }

  let trailRowCount: number | null = null;
  try {
    // GERÇEK olay izi kaynağı (Görev 3) — paralel raporlama deposu YOK.
    trailRowCount = getOwnTrail()
      .filter((e) => typeof e.label === 'string' && e.label.startsWith('mavi proaktif:')).length;
  } catch { trailRowCount = null; }

  return Object.freeze({
    label: SCENARIO_SIMULATION_LABEL,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results: Object.freeze(results),
    trailRowCount,
  });
}

/** Senaryo kimlikleri (teşhis/test). */
export function listMaviScenarioIds(): readonly string[] {
  return SCENARIOS.map((s) => s.id);
}
