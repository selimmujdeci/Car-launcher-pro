/**
 * predictionRuntime — Prediction Engine'in ÜRÜN KOŞUCUSU (V-09).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Anayasanın 6. kapısı *"5 dk sonra ne olacak?"* fiilen KAPALIYDI: 164 satırlık
 * trend/öngörü motoru (`fitTrend` · `predict` · `DEFAULT_PREDICTION_RULES`)
 * yazılmış ama **tek tüketicisi kendi testiydi** — üretimde 0 çağrı. Bu modül
 * o motorun eksik koşucusudur; motorun kendisine DOKUNMAZ.
 *
 * ── SOĞUK YOL, HOT-PATH DEĞİL (pazarlıksız) ────────────────────────────────
 * CLAUDE.md: *"Ağır analiz soğuk-yolda / düşük frekansta; hot-path'e (3Hz
 * hız/RPM) ASLA girmez."* Bu koşucu 3 Hz veri akışına HİÇ dokunmaz; kendi
 * periyodunda (`SAMPLE_PERIOD_MS`) mevcut anlık görüntüyü OKUR. Örnekleme
 * maliyeti: üç skaler okuma + üç halka tamponu yazımı — tahsis YOK.
 *
 * ── AMA GÜVENLİK-KRİTİK: HER TIER'DA AÇIK ──────────────────────────────────
 * Aynı anayasa: *"Güvenlik-kritik katmanlar (overheat, düşük yağ basıncı) HER
 * tier'da garanti açık — ucuzdurlar."* Bu yüzden görev `SAFETY` kritikliğinde
 * kaydedilir: düşük-uç cihazda mod çarpanıyla YAVAŞLATILMAZ. Aşırı ısınma
 * uyarısını "cihaz zayıf" diye geciktirmek, korumak için var olduğu şeyi
 * kaybetmektir.
 *
 * ── ÖRNEKLEM DÜRÜSTLÜĞÜ ────────────────────────────────────────────────────
 *  · Veri BAYATSA örnek ALINMAZ (`dataFresh` false → tampon büyümez). Bayat
 *    değeri örneklemek, duran bir sayıdan "trend yok" sonucu üretir ve gerçek
 *    yükselişi maskeler.
 *  · Sensör YOKSA (`null`/sentinel) örnek ALINMAZ — sahte 0 bir ÖLÇÜM DEĞİLDİR.
 *  · Araç değişimi/bağlantı kopması tamponu TEMİZLER: iki farklı aracın
 *    değerlerini aynı doğruya uydurmak uydurma trend üretir.
 *
 * Tahmin ÜRETMEZ: `predict()` fail-closed'dır (yetersiz örneklem, zayıf uyum,
 * yanlış yön, ufuk dışı → `null`). Bu modül o kararı DEĞİŞTİRMEZ, yalnız
 * sonucu saklar.
 */

import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { getOBDDataSnapshot } from '../obdService';
import {
  predict, DEFAULT_PREDICTION_RULES, MIN_TREND_SAMPLES,
  type Prediction, type PredictionKind, type TrendSample,
} from './predictionEngine';

/** Görev kimliği — çift kayıt öncekini değiştirir (idempotent). */
export const PREDICTION_TASK_ID = 'prediction-engine';

/**
 * Örnekleme periyodu. 15 sn: 5 örneklik asgari trend ≈ 1 dakikada oluşur —
 * 10 dakikalık ufuk için fazlasıyla erken, hot-path için ise çok seyrek.
 */
export const SAMPLE_PERIOD_MS = 15_000;

/**
 * Halka tampon tavanı. 40 örnek × 15 sn = 10 dakikalık pencere — kuralların
 * en uzun ufkuyla (15 dk) aynı büyüklük sınıfında, bellekte önemsiz.
 */
export const MAX_SAMPLES = 40;

/**
 * Bir örneğin "taze" sayılacağı azami yaş. Bundan eskisi tampona GİRMEZ.
 * (Bağımsız bir eşik değil, veri kapısının kendi tazelik kararına ek bir
 * savunma katmanı — `dataFresh` bir nedenle yanlış pozitif verirse.)
 */
export const MAX_SAMPLE_AGE_MS = 60_000;

/**
 * İzlenen sinyal → hangi kural.
 *
 * `read: null` → **ÜRÜNDE O SİNYALİN KAYNAĞI YOK.** Bu kural asla tahmin
 * üretemez ve bu bir kusur değil, ölçülmüş bir GERÇEKTİR: LAB bunu
 * "SİNYAL KAYNAĞI YOK" diye AÇIKÇA yazar. Sessizce boş bırakmak, kuralın
 * çalıştığı ama arıza olmadığı izlenimi verirdi — tam tersi doğru.
 */
const TRACKED: ReadonlyArray<{
  readonly kind: PredictionKind;
  readonly signal: string;
  readonly read: ((d: ReturnType<typeof getOBDDataSnapshot>) => number | null) | null;
}> = [
  {
    kind: 'overheat',
    signal: 'engineTemp',
    read: (d) => _num(d.engineTemp),
  },
  {
    kind: 'battery_drain',
    signal: 'batteryVoltage',
    read: (d) => _num(d.batteryVoltage),
  },
  {
    kind: 'oil_pressure_drop',
    signal: '—',
    /* YAĞ BASINCI SİNYALİ ÜRÜNDE YOKTUR: `OBDData` böyle bir alan taşımaz ve
       standart Mode-01 PID kümesinde de bulunmaz (araca özel DID gerekir).
       Uydurma bir kaynak bağlamaktansa kural AÇIKÇA kapalı bırakılır. */
    read: null,
  },
];

/** Kaynağı olmayan (dolayısıyla asla tahmin üretemeyecek) kurallar. */
export const RULES_WITHOUT_SOURCE: readonly PredictionKind[] =
  TRACKED.filter((t) => t.read === null).map((t) => t.kind);

/** Sayı mı — sentinel (`-1`) ve `NaN` ÖLÇÜM SAYILMAZ. */
function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > -1 ? v : null;
}

/* ── Durum (süreç ömürlü, sınırlı) ───────────────────────────────────────── */

const _samples = new Map<PredictionKind, TrendSample[]>();
let _predictions: Readonly<Record<string, Prediction>> = Object.freeze({});
let _lastTickAtMs: number | null = null;
let _tickCount = 0;
let _skippedStale = 0;
let _skippedMissing = 0;
let _clearCount = 0;
let _lastVehicleKey: string | null = null;
let _unschedule: (() => void) | null = null;
let _running = false;

export interface PredictionRuntimeSnapshot {
  readonly running: boolean;
  readonly taskId: string;
  readonly periodMs: number;
  /** SAFETY → düşük-uçta bile yavaşlatılmaz. */
  readonly criticality: 'SAFETY';
  readonly minSamples: number;
  readonly maxSamples: number;
  readonly tickCount: number;
  readonly lastTickAtMs: number | null;
  /** Sinyal başına biriken örnek sayısı. */
  readonly sampleCounts: Readonly<Record<string, number>>;
  /** Şu an geçerli olan tahminler (fail-closed: yoksa boş). */
  readonly predictions: Readonly<Record<string, Prediction>>;
  /** Bayat olduğu için ALINMAYAN örnek sayısı — sessiz atlama YOK. */
  readonly skippedStale: number;
  /** Sensör okunamadığı için alınmayan örnek sayısı. */
  readonly skippedMissing: number;
  /** Araç/bağlantı değişimi yüzünden tamponun kaç kez temizlendiği. */
  readonly clearCount: number;
  /**
   * Üründe SİNYAL KAYNAĞI OLMAYAN kurallar — bunlar asla tahmin üretemez.
   * LAB bunu açıkça yazar; sessizce boş bırakmak "kural çalışıyor ama arıza
   * yok" izlenimi verirdi.
   */
  readonly rulesWithoutSource: readonly string[];
}

/** LAB salt-okuma yüzeyi — ASLA fırlatmaz, hiçbir şey tetiklemez. */
export function getPredictionSnapshot(): PredictionRuntimeSnapshot {
  const counts: Record<string, number> = {};
  for (const { kind, read } of TRACKED) {
    if (read === null) continue;   // kaynaksız kural sayaçta yer TUTMAZ
    counts[kind] = _samples.get(kind)?.length ?? 0;
  }
  return {
    running: _running,
    taskId: PREDICTION_TASK_ID,
    periodMs: SAMPLE_PERIOD_MS,
    criticality: 'SAFETY',
    minSamples: MIN_TREND_SAMPLES,
    maxSamples: MAX_SAMPLES,
    tickCount: _tickCount,
    lastTickAtMs: _lastTickAtMs,
    sampleCounts: counts,
    predictions: _predictions,
    skippedStale: _skippedStale,
    skippedMissing: _skippedMissing,
    clearCount: _clearCount,
    rulesWithoutSource: RULES_WITHOUT_SOURCE,
  };
}

/**
 * Aracın/oturumun değiştiğini gösteren anahtar. Değişirse tampon TEMİZLENİR:
 * iki farklı aracın (veya kopma öncesi/sonrası) değerlerini aynı doğruya
 * uydurmak, olmayan bir trend üretir.
 */
function _vehicleKey(d: ReturnType<typeof getOBDDataSnapshot>): string {
  return `${d.connectionState}|${d.source}|${d.vehicleType}`;
}

function _clearSamples(): void {
  if (_samples.size === 0) return;
  _samples.clear();
  _predictions = Object.freeze({});
  _clearCount += 1;
}

/** Tik gövdesi — tahsis-fakiri, ASLA fırlatmaz. */
function _tick(): void {
  try {
    const d = getOBDDataSnapshot();
    _tickCount += 1;
    _lastTickAtMs = Date.now();

    const key = _vehicleKey(d);
    if (_lastVehicleKey !== null && _lastVehicleKey !== key) _clearSamples();
    _lastVehicleKey = key;

    /* BAYAT VERİ ÖRNEKLENMEZ. Duran bir sayıyı örneklemek "trend yok" üretir
       ve gerçek yükselişi maskeler — sessiz körlük. */
    if (d.dataFresh !== true) { _skippedStale += 1; return; }

    const now = Date.now();
    const lastSeen = typeof d.lastSeenMs === 'number' ? d.lastSeenMs : 0;
    if (lastSeen > 0 && now - lastSeen > MAX_SAMPLE_AGE_MS) { _skippedStale += 1; return; }

    const next: Record<string, Prediction> = {};
    for (const { kind, read } of TRACKED) {
      /* Kaynağı olmayan kural HİÇ denenmez — "eksik ölçüm" sayacını da
         şişirmez (eksik olan ölçüm değil, sinyalin KENDİSİ). */
      if (read === null) continue;
      const value = read(d);
      if (value === null) { _skippedMissing += 1; continue; }

      let buf = _samples.get(kind);
      if (!buf) { buf = []; _samples.set(kind, buf); }
      buf.push({ t: now, value });
      if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);

      /* Motorun kendi fail-closed kararı DEĞİŞTİRİLMEZ — yalnız çağrılır. */
      const p = predict(buf, DEFAULT_PREDICTION_RULES[kind], value);
      if (p) next[kind] = p;
    }
    _predictions = Object.freeze(next);
  } catch {
    /* fail-soft: öngörü katmanı hiçbir koşulda veri yolunu bozamaz. */
  }
}

/**
 * Koşucuyu başlatır. İDEMPOTENT — ikinci çağrı ikinci görev kaydetmez.
 * @returns temizleyici (SystemBoot `_reg` ile kaydeder → zero-leak).
 */
export function startPredictionRuntime(): () => void {
  if (_running) return stopPredictionRuntime;
  _running = true;
  try {
    _unschedule = runtimeManager.scheduleTask({
      id: PREDICTION_TASK_ID,
      periodMs: SAMPLE_PERIOD_MS,
      /* SAFETY: overheat ve yağ basıncı düşük-uçta da zamanında uyarmalı. */
      criticality: 'SAFETY',
      /* deferIdle YOK: güvenlik uyarısı "boşta kalınca" ertelenmez. */
      fn: _tick,
    });
  } catch {
    _running = false;   // wheel kurulamadı — sahte "çalışıyor" gösterme
  }
  return stopPredictionRuntime;
}

/** İdempotent durdurma — görev wheel'den kaldırılır. */
export function stopPredictionRuntime(): void {
  if (!_running) return;
  _running = false;
  try { _unschedule?.(); } catch { /* fail-soft */ }
  _unschedule = null;
}

/** @internal — testler arası izolasyon. */
export function _resetPredictionRuntimeForTest(): void {
  stopPredictionRuntime();
  _samples.clear();
  _predictions = Object.freeze({});
  _lastTickAtMs = null;
  _tickCount = 0;
  _skippedStale = 0;
  _skippedMissing = 0;
  _clearCount = 0;
  _lastVehicleKey = null;
}

/** @internal — testler tik gövdesini doğrudan koşturur (timer beklemeden). */
export function _tickForTest(): void { _tick(); }
