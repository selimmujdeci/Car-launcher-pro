/**
 * guardianRuntime — GUARDIAN-AI-G16 · GUARDIAN'IN TICK SAHİBİ.
 *
 * Bugüne kadar `runGuardian` üründe HİÇ çağrılmıyordu: çekirdek saf ve testli
 * yazıldı ama motoru KİMSE sürmüyordu. Bu dosya o boşluğu — ve YALNIZ onu —
 * kapatır: kadansı sahiplenir, sağlayıcı→adaptör→kural→motor zincirini kurar,
 * ölçer ve gözlemlenebilir kılar.
 *
 * ── BU DOSYANIN YAPMADIKLARI (bilinçli sınır) ───────────────────────────────
 *  · Yeni KURAL yazmaz, yeni SAĞLAYICI icat etmez, eşik/severity KARARI vermez.
 *  · `guardianAlertRanker`a DOKUNMAZ (sıralama/öncelik zaten kilitli).
 *  · Çıktıyı sürücüye SUNMAZ: ses YOK, HMI YOK, bildirim YOK. Bu tur Guardian'a
 *    **kalp atışı** verir, **ses** vermez. Sunum ayrı bir parçadır.
 *  · Bu yüzden aşırı ısınma/akü uyarısının ÜRÜN otoritesi değişmedi
 *    (`VehicleCompute.worker` → `SystemOrchestrator`). Guardian bu fazda
 *    **gözlem** üretir — ikinci bir eylem otoritesi DOĞMAZ.
 *
 * ── BAĞLI SAĞLAYICILAR (dürüst envanter) ────────────────────────────────────
 *   ✅ `gps`  — `UnifiedVehicleStore` üstünden ARAÇ HIZI (koordinat OKUNMAZ).
 *   ✅ `obd`  — `getOBDDataSnapshot()` üstünden soğutucu + akü gerilimi.
 *   ◐ `map`  — YALNIZ `speedCamera` dilimi (`enforcementMapSource`, gömülü EGM
 *               paketi). Viraj/hız limiti/yokuş/tehlike dilimlerinin üreticisi
 *               HÂLÂ YOK. Denetim noktası uyarısı konum belirsizliği kapısına
 *               tabidir — **şartlı kilit #508** sahada bu kapıyı çoğunlukla
 *               KAPALI tutar ve düşüşler LAB'da SAYILIR.
 *   ⛔ `weather` — veri + lisans işi (P7), bugün yalnız interface.
 *   ⛔ `driver`  — **#509** altında.
 *
 * Sonuç: bugün fiilen KOŞABİLEN kurallar `vehicle-health` ve — kapılar geçilirse
 * — `speed-camera`dır. GPS hızı okunur ama diğer map dilimleri olmadığı için
 * **hiçbir kurala girmez**. Bu gerçek LAB'da AÇIKÇA gösterilir; "8 kural
 * çalışıyor" izlenimi verilmez.
 *
 * ── ZERO-LEAK / FAIL-SOFT / ZERO-ALLOC ──────────────────────────────────────
 *  · Tek timer sahibi `runtimeManager` wheel'idir; burada `setInterval` YOK.
 *    `start` cleanup thunk döner, `stop` idempotenttir.
 *  · Kaynaklar ve politika BİR KEZ, başlatmada kurulur — tik gövdesinde nesne
 *    üretimi yalnız boru hattının kendi çıktılarıdır.
 *  · Kural kayıt defteri sözleşme gereği bozuk girdide THROW EDER; tik gövdesi
 *    bunu yakalar, aşamasıyla SAYAR ve devam eder. Guardian'ın düşmesi
 *    uygulamayı düşürmez.
 *  · Süre defteri SABİT boyutlu halka (`Float64Array`) — sınırsız büyüme YOK.
 */

import type { GuardianOutput, GuardianRiskEvent, GuardianSeverity } from '../models';
import { runGuardian } from '../guardianEngine';
import { buildGuardianRuleResults } from '../guardianRuleRegistry';
import { buildGuardianRegistryInput } from '../adapters/guardianAdapterRegistry';
import {
  buildGuardianRawPlatformData, type GuardianProviderSources,
} from '../providers/guardianProviderRegistry';
import {
  createGpsServiceSource, createUnifiedStoreGpsLocationPort,
} from '../providers/concrete/gpsServiceSource';
import { createObdServiceSource } from '../providers/concrete/obdServiceSource';
import { createObdServiceHealthPort } from '../providers/concrete/obdServiceHealthPort';
import {
  createEnforcementMapSource, createUnifiedStoreEnforcementLocationPort,
} from '../providers/concrete/enforcementMapSource';
import { ensureEnforcementPointsLoaded } from '../../enforcement/enforcementPointsSource';
import { GUARDIAN_VEHICLE_HEALTH_POLICY } from './guardianVehicleHealthPolicy';
import {
  GUARDIAN_TASK_ID, GUARDIAN_BASE_PERIOD_MS, GUARDIAN_TASK_CRITICALITY,
  GUARDIAN_DEFER_IDLE, GUARDIAN_TICK_BUDGET_MS, GUARDIAN_TICK_HARD_LIMIT_MS,
  GUARDIAN_DURATION_SAMPLE_SIZE, GUARDIAN_TICK_POLICY_VERSION,
  guardianEffectivePeriodMs, guardianWorstCaseDetectionLatencyMs,
  guardianKeepsUpWithObd,
} from './guardianTickPolicy';
import { runtimeManager } from '../../../../core/runtime/AdaptiveRuntimeManager';
import type { RuntimeMode } from '../../../../core/runtime/runtimeTypes';

/* ══════════════════════════════════════════════════════════════════════════
 * Politika sabitleri
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * GPS fix tazelik kapısı (ms). Bu kapı düşerse hız SUNULMAZ (bayat hızdan
 * karar üretmek YASAK). 3 s: 100 km/h'de ~83 m konum kayması.
 *
 * ⚠️ Saha gerçeği (kütük #508): fix yaşı p50 **19,5 s** ölçüldü. Yani bu kapı
 * bugün sahada ÇOĞUNLUKLA KAPALI kalacaktır ve GPS hızı Guardian'a girmeyecektir.
 * Bu bir kusur DEĞİL, dürüstlüktür: G1 düzelene kadar bayat hız kullanılmaz.
 * LAB bu düşüşü sayar → "GPS bağlı ama hız hiç gelmiyor" GÖRÜNÜR olur.
 */
const GUARDIAN_GPS_MAX_AGE_MS = 3_000;

/** GPS doğruluk kapısı (m). Bunu aşan fix'in hızı da güvenilmez sayılır. */
const GUARDIAN_GPS_MAX_ACCURACY_M = 100;

/** LAB'a taşınan olay özeti üst sınırı (bounded — sınırsız liste YOK). */
const MAX_REPORTED_EVENTS = 12;

/** Boru hattı aşamaları — hata sayacı bunlarla etiketlenir. */
export type GuardianTickStage = 'PROVIDER' | 'ADAPT' | 'RULES' | 'ENGINE';

/** LAB'a taşınan tek olay özeti — serbest metin (title/message) TAŞINMAZ. */
export interface GuardianEventSummary {
  readonly id:              string;
  readonly type:            string;
  readonly severity:        GuardianSeverity;
  readonly confidence:      number;
  readonly distanceMeters:  number;
}

/** Bir sağlayıcı yuvasının bağlanma durumu — "yakında" gibi belirsiz ifade YOK. */
export interface GuardianSourceWiring {
  readonly id:      'gps' | 'map' | 'obd' | 'weather' | 'driver';
  readonly wired:   boolean;
  /** Bağlı değilse NEDEN bağlı olmadığı (kanıtsız iyimserlik YASAK). */
  readonly reason:  string;
}

export interface GuardianRuntimeSnapshot {
  /* ── Sahiplik / kadans ─────────────────────────────────────────────────── */
  readonly running:              boolean;
  readonly policyVersion:        string;
  readonly taskId:               string;
  readonly owner:                'ADAPTIVE_RUNTIME_WHEEL';
  readonly criticality:          'NORMAL' | 'SAFETY';
  readonly deferIdle:            boolean;
  readonly mode:                 RuntimeMode | null;
  readonly basePeriodMs:         number;
  /** Aktif modda manager'ın uygulayacağı gerçek periyot. */
  readonly effectivePeriodMs:    number | null;
  /** OBD anketi + Guardian periyodu — uçtan uca EN KÖTÜ tespit gecikmesi. */
  readonly worstCaseLatencyMs:   number | null;
  /** §2 sözleşmesi: Guardian aynı modda OBD'den yavaş DEĞİL. */
  readonly keepsUpWithObd:       boolean | null;

  /* ── Sağlayıcılar ──────────────────────────────────────────────────────── */
  readonly sources:              readonly GuardianSourceWiring[];
  readonly wiredSourceCount:     number;

  /* ── Koşum sayaçları ───────────────────────────────────────────────────── */
  readonly tickCount:            number;
  readonly lastTickAtWallMs:     number | null;
  readonly lastTickAgeMs:        number | null;
  readonly errorCount:           number;
  /** Hata SINIFI + aşaması (mesaj/değer TAŞINMAZ). */
  readonly lastErrorKind:        string | null;
  readonly lastErrorStage:       GuardianTickStage | null;
  readonly lastErrorAgeMs:       number | null;

  /* ── Motor çıktısı ─────────────────────────────────────────────────────── */
  /** Kaç kural FİİLEN çalıştı (girdisi olan kural sayısı) — 0 olabilir. */
  readonly evaluatedRuleCount:   number | null;
  readonly riskEventCount:       number | null;
  readonly highestSeverity:      GuardianSeverity | null;
  readonly overallRiskScore:     number | null;
  readonly events:               readonly GuardianEventSummary[];
  readonly lastOutputAtWallMs:   number | null;
  readonly lastOutputAgeMs:      number | null;

  /* ── Bütçe ölçümü ──────────────────────────────────────────────────────── */
  readonly budgetMs:             number;
  readonly hardLimitMs:          number;
  readonly lastDurationMs:       number | null;
  readonly maxDurationMs:        number | null;
  readonly p50DurationMs:        number | null;
  readonly p95DurationMs:        number | null;
  readonly durationSampleCount:  number;
  readonly overBudgetCount:      number;
  readonly overHardLimitCount:   number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Modül durumu (tek sahip)
 * ══════════════════════════════════════════════════════════════════════════ */

let _running = false;
/** `scheduleTask()` cleanup thunk'ı — `clearInterval` handle'ı DEĞİL. */
let _unschedule: (() => void) | null = null;

/** Başlatmada BİR KEZ kurulan kaynaklar — tik gövdesinde yeniden kurulmaz. */
let _sources: GuardianProviderSources | null = null;

let _tickCount = 0;
let _lastTickAtWallMs: number | null = null;
let _lastTickAtMonoMs: number | null = null;

let _errorCount = 0;
let _lastErrorKind: string | null = null;
let _lastErrorStage: GuardianTickStage | null = null;
let _lastErrorAtMonoMs: number | null = null;

let _lastOutput: GuardianOutput | null = null;
let _lastEvaluatedRuleCount: number | null = null;
let _lastOutputAtWallMs: number | null = null;
let _lastOutputAtMonoMs: number | null = null;

/* Süre defteri — SABİT boyutlu halka (sınırsız büyüme YOK). */
const _durations = new Float64Array(GUARDIAN_DURATION_SAMPLE_SIZE);
let _durationWriteIdx = 0;
let _durationCount = 0;
let _lastDurationMs: number | null = null;
let _maxDurationMs = 0;
let _overBudgetCount = 0;
let _overHardLimitCount = 0;

/* Yüzdelik hesabı için ÖNCEDEN tahsis edilmiş sıralama tamponu — LAB okumasında
   kullanılır (tik gövdesinde DEĞİL), yine de her okumada yeni dizi üretmez. */
const _sortScratch = new Float64Array(GUARDIAN_DURATION_SAMPLE_SIZE);

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ══════════════════════════════════════════════════════════════════════════ */

function _nowMono(): number {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  } catch {
    return Date.now();
  }
}

function _nowWall(): number {
  try { return Date.now(); } catch { return 0; }
}

/** Hata SINIFINI verir — mesaj/değer TAŞINMAZ (gizlilik + gürültü kontrolü). */
function _errorKind(err: unknown): string {
  if (err instanceof Error && typeof err.name === 'string' && err.name.length > 0) return err.name;
  return typeof err;
}

function _recordDuration(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  _lastDurationMs = ms;
  if (ms > _maxDurationMs) _maxDurationMs = ms;
  if (ms > GUARDIAN_TICK_BUDGET_MS) _overBudgetCount++;
  if (ms > GUARDIAN_TICK_HARD_LIMIT_MS) _overHardLimitCount++;
  _durations[_durationWriteIdx] = ms;
  _durationWriteIdx = (_durationWriteIdx + 1) % GUARDIAN_DURATION_SAMPLE_SIZE;
  if (_durationCount < GUARDIAN_DURATION_SAMPLE_SIZE) _durationCount++;
}

/** Halkadan yüzdelik — örnek yoksa `null` (sahte 0 YASAK). */
function _percentile(p: number): number | null {
  if (_durationCount === 0) return null;
  for (let i = 0; i < _durationCount; i++) _sortScratch[i] = _durations[i];
  const view = _sortScratch.subarray(0, _durationCount);
  view.sort();
  const idx = Math.min(_durationCount - 1, Math.max(0, Math.ceil((p / 100) * _durationCount) - 1));
  return view[idx];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sağlayıcı envanteri (dürüst — bağlı olmayan yuva NEDENİYLE birlikte)
 * ══════════════════════════════════════════════════════════════════════════ */

const _SOURCE_WIRING: readonly GuardianSourceWiring[] = Object.freeze([
  Object.freeze({
    id: 'gps' as const, wired: true,
    reason: 'UnifiedVehicleStore hızı (koordinat okunmaz). Bugün HİÇBİR kurala girmiyor — map dilimleri yok.',
  }),
  Object.freeze({
    id: 'obd' as const, wired: true,
    reason: 'getOBDDataSnapshot(): soğutucu + akü gerilimi. Bugün kurala giren TEK kaynak.',
  }),
  Object.freeze({
    id: 'map' as const, wired: true,
    reason: 'YALNIZ speedCamera dilimi bağlı (gömülü EGM denetim noktası paketi). Viraj/limit/eğim/tehlike dilimlerinin üreticisi YOK. Uyarı konum belirsizliği kapısına tabidir — #508 sahada bu kapıyı çoğunlukla kapalı tutar.',
  }),
  Object.freeze({
    id: 'weather' as const, wired: false,
    reason: 'Yalnız interface — veri sağlayıcı + lisans (BYOK) işi (P7).',
  }),
  Object.freeze({
    id: 'driver' as const, wired: false,
    reason: 'Yalnız interface — yorgunluk sinyali #509 altında.',
  }),
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Tik gövdesi
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * TEK koşum. Wheel bunu `_invokeTask` içinde zaten try/catch'ler; buradaki
 * kendi try/catch'imiz **aşama bilgisini** korumak ve sayaç tutmak içindir
 * (hangi aşamada düştüğü bilinmeden kanıt üretilemez).
 */
function _tick(): void {
  const startedMono = _nowMono();
  _tickCount++;
  _lastTickAtWallMs = _nowWall();
  _lastTickAtMonoMs = startedMono;

  let stage: GuardianTickStage = 'PROVIDER';
  try {
    const raw = buildGuardianRawPlatformData(_sources ?? undefined);

    stage = 'ADAPT';
    const registryInput = buildGuardianRegistryInput(raw);

    stage = 'RULES';
    const ruleResults = buildGuardianRuleResults(registryInput);

    stage = 'ENGINE';
    const output = runGuardian({ ruleResults });

    _lastOutput = output;
    _lastEvaluatedRuleCount = ruleResults.length;
    _lastOutputAtWallMs = _lastTickAtWallMs;
    _lastOutputAtMonoMs = startedMono;
  } catch (err) {
    /* FAIL-SOFT: sayılır, sınıflandırılır — ÖNCEKİ çıktı SİLİNMEZ ama
       tazelenmez de. LAB `lastOutputAgeMs` ile bayatlığı GÖSTERİR (sessizce
       eski çıktıyı taze göstermek YASAK). */
    _errorCount++;
    _lastErrorKind = _errorKind(err);
    _lastErrorStage = stage;
    _lastErrorAtMonoMs = startedMono;
  } finally {
    _recordDuration(_nowMono() - startedMono);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Guardian'ı §L.0 tik-wheel'ine kaydeder. İDEMPOTENT — ikinci çağrı yeni görev
 * kaydetmez. Dönen thunk görevi wheel'den kaldırır (SystemBoot `_reg` deseni).
 *
 * Kaynak kurulumu FAIL-SOFT'tur: bir factory DI doğrulamasında fırlatırsa o
 * yuva bağlanmadan kalır ve Guardian diğer kaynakla çalışmaya DEVAM EDER
 * (wiring hatası tüm katmanı düşürmez).
 */
export function startGuardianRuntime(): () => void {
  if (_running) return stopGuardianRuntime;
  _running = true;

  const sources: GuardianProviderSources = {};

  try {
    sources.gps = createGpsServiceSource({
      port:   createUnifiedStoreGpsLocationPort(),
      policy: {
        maxLocationAgeMs:  GUARDIAN_GPS_MAX_AGE_MS,
        maxAccuracyMeters: GUARDIAN_GPS_MAX_ACCURACY_M,
      },
      /* `GPSLocation.timestamp` kaynaktaki ÖLÇÜM anıdır ve duvar saatidir
         (`GpsAdapter` #458 notu) → tazelik hesabı da duvar saatiyle yapılır.
         Monotonik saat KARIŞTIRILMAZ. */
      clock: { nowMs: _nowWall },
    });
  } catch {
    /* fail-soft: GPS yuvası bağlanmadı — Guardian OBD ile devam eder. */
  }

  try {
    sources.obd = createObdServiceSource({
      port:   createObdServiceHealthPort(),
      policy: GUARDIAN_VEHICLE_HEALTH_POLICY,
    });
  } catch {
    /* fail-soft: OBD yuvası bağlanmadı — Guardian GPS ile devam eder. */
  }

  try {
    sources.map = createEnforcementMapSource({
      port:  createUnifiedStoreEnforcementLocationPort(),
      /* Fix zaman damgası duvar saatidir (`GpsAdapter` #458) → yaş hesabı da
         duvar saatiyle yapılır. Monotonik saat KARIŞTIRILMAZ. */
      clock: { nowMs: _nowWall },
    });
    /* Paket yüklemesi ATEŞLE-UNUT: tik gövdesi ağa çıkmaz, ilk tik'ler paket
       hazır olana kadar PACKAGE_NOT_READY sayar (sessiz "denetim yok" DEĞİL).
       Yükleme düşerse durum FAILED kalır; yeniden deneme döngüsü YOK. */
    void ensureEnforcementPointsLoaded();
  } catch {
    /* fail-soft: map yuvası bağlanmadı — Guardian diğer kaynaklarla devam eder. */
  }

  _sources = sources;

  _unschedule = runtimeManager.scheduleTask({
    id:          GUARDIAN_TASK_ID,
    periodMs:    GUARDIAN_BASE_PERIOD_MS,
    criticality: GUARDIAN_TASK_CRITICALITY,
    deferIdle:   GUARDIAN_DEFER_IDLE,
    fn:          _tick,
  });

  return stopGuardianRuntime;
}

/** İDEMPOTENT durdurma — görev wheel'den kaldırılır, kaynaklar bırakılır. */
export function stopGuardianRuntime(): void {
  if (!_running) return;
  _running = false;
  try { _unschedule?.(); } catch { /* fail-soft */ }
  _unschedule = null;
  _sources = null;
}

/** Test izolasyonu — ÜRÜN KODU ÇAĞIRMAZ. Tüm sayaç/defteri sıfırlar. */
export function _resetGuardianRuntimeForTest(): void {
  stopGuardianRuntime();
  _tickCount = 0;
  _lastTickAtWallMs = null;
  _lastTickAtMonoMs = null;
  _errorCount = 0;
  _lastErrorKind = null;
  _lastErrorStage = null;
  _lastErrorAtMonoMs = null;
  _lastOutput = null;
  _lastEvaluatedRuleCount = null;
  _lastOutputAtWallMs = null;
  _lastOutputAtMonoMs = null;
  _durations.fill(0);
  _durationWriteIdx = 0;
  _durationCount = 0;
  _lastDurationMs = null;
  _maxDurationMs = 0;
  _overBudgetCount = 0;
  _overHardLimitCount = 0;
}

/** Test/ölçüm için tek koşumu ELLE tetikler — wheel beklemeden. */
export function _runGuardianTickOnceForTest(): void {
  _tick();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Okuma ucu
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Motorun SON çıktısı — henüz hiç koşulmadıysa `null` (sahte boş çıktı YOK).
 * Gelecekteki sunum katmanı (HMI/ses) buradan okuyacaktır; bugün TÜKETİCİSİ
 * yalnız CAROS LAB'dır.
 */
export function getGuardianOutput(): GuardianOutput | null {
  return _lastOutput;
}

function _summarizeEvents(events: readonly GuardianRiskEvent[]): readonly GuardianEventSummary[] {
  const out: GuardianEventSummary[] = [];
  const n = Math.min(events.length, MAX_REPORTED_EVENTS);
  for (let i = 0; i < n; i++) {
    const e = events[i];
    out.push({
      id: e.id, type: e.type, severity: e.severity,
      confidence: e.confidence, distanceMeters: e.distanceMeters,
    });
  }
  return out;
}

/**
 * Salt-okunur anlık görüntü — LAB'ın TEK okuma ucu. HİÇBİR şey başlatmaz,
 * durdurmaz, tetiklemez; okuma sayaçları KİRLETMEZ (ölçüm gözlemden etkilenmez).
 * Ölçülmemiş alanlar `null` döner — sahte 0 / sahte "sağlıklı" YOK.
 */
export function getGuardianRuntimeSnapshot(): GuardianRuntimeSnapshot {
  let mode: RuntimeMode | null = null;
  try { mode = runtimeManager.getMode(); } catch { mode = null; }

  const nowMono = _nowMono();

  return {
    running:            _running,
    policyVersion:      GUARDIAN_TICK_POLICY_VERSION,
    taskId:             GUARDIAN_TASK_ID,
    owner:              'ADAPTIVE_RUNTIME_WHEEL',
    criticality:        GUARDIAN_TASK_CRITICALITY,
    deferIdle:          GUARDIAN_DEFER_IDLE,
    mode,
    basePeriodMs:       GUARDIAN_BASE_PERIOD_MS,
    effectivePeriodMs:  mode ? guardianEffectivePeriodMs(mode) : null,
    worstCaseLatencyMs: mode ? guardianWorstCaseDetectionLatencyMs(mode) : null,
    keepsUpWithObd:     mode ? guardianKeepsUpWithObd(mode) : null,

    sources:            _SOURCE_WIRING,
    wiredSourceCount:   _SOURCE_WIRING.filter((s) => s.wired).length,

    tickCount:          _tickCount,
    lastTickAtWallMs:   _lastTickAtWallMs,
    lastTickAgeMs:      _lastTickAtMonoMs === null ? null : Math.max(0, Math.round(nowMono - _lastTickAtMonoMs)),
    errorCount:         _errorCount,
    lastErrorKind:      _lastErrorKind,
    lastErrorStage:     _lastErrorStage,
    lastErrorAgeMs:     _lastErrorAtMonoMs === null ? null : Math.max(0, Math.round(nowMono - _lastErrorAtMonoMs)),

    evaluatedRuleCount: _lastEvaluatedRuleCount,
    riskEventCount:     _lastOutput ? _lastOutput.riskEvents.length : null,
    highestSeverity:    _lastOutput ? _lastOutput.highestSeverity : null,
    overallRiskScore:   _lastOutput ? _lastOutput.overallRiskScore : null,
    events:             _lastOutput ? _summarizeEvents(_lastOutput.riskEvents) : [],
    lastOutputAtWallMs: _lastOutputAtWallMs,
    lastOutputAgeMs:    _lastOutputAtMonoMs === null ? null : Math.max(0, Math.round(nowMono - _lastOutputAtMonoMs)),

    budgetMs:            GUARDIAN_TICK_BUDGET_MS,
    hardLimitMs:         GUARDIAN_TICK_HARD_LIMIT_MS,
    lastDurationMs:      _lastDurationMs,
    maxDurationMs:       _durationCount === 0 ? null : _maxDurationMs,
    p50DurationMs:       _percentile(50),
    p95DurationMs:       _percentile(95),
    durationSampleCount: _durationCount,
    overBudgetCount:     _overBudgetCount,
    overHardLimitCount:  _overHardLimitCount,
  };
}
