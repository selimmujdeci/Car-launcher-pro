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
import { getOBDDataSnapshot, getObdSignalHealth } from '../obdService';
import { engineRunningFrom, type ObdHealthState } from './obdHealthModel';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import {
  resolveLiveCanonicalSignal, resolveBatteryVoltage, readLiveObdSignal,
} from '../vehicleDataLayer/canonicalVehicleSignal';
import {
  predict, DEFAULT_PREDICTION_RULES, MIN_TREND_SAMPLES,
  type Prediction, type PredictionKind, type TrendSample,
} from './predictionEngine';
import {
  evaluateEarlyWarnings, EARLY_WARNING_RULES,
  type EarlyWarningResult, type SignalWindow,
} from './earlyWarningEngine';
import type { CanonicalObdKey } from './canonicalObdSignals';

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
  readonly read: ((d: ReturnType<typeof getOBDDataSnapshot>, nowMs: number) => number | null) | null;
}> = [
  {
    kind: 'overheat',
    signal: 'coolantTemp',
    /* P0-OBD-04: ham `d.engineTemp` yerine KANONİK otorite (CAN → OBD → yok) +
       tazelik kapısı. Eskiden bu koşucu OBD anlık görüntüsünü okuyordu; CAN'lı
       araçta motor ısısını HİÇ göremiyor, bayat okumayı ise trend sanabiliyordu. */
    read: (_d, nowMs) =>
      resolveLiveCanonicalSignal(useUnifiedVehicleStore.getState(), 'coolantTemp', nowMs).value,
  },
  {
    kind: 'battery_drain',
    signal: 'batteryVolt',
    /* TEK ZİNCİR (P0-OBD-03): CAN → OBD PID 0x42 → adaptör ATRV → yok. */
    read: (d, nowMs) => resolveBatteryVoltage(
      useUnifiedVehicleStore.getState(),
      _num(d.batteryVoltage),
      nowMs,
    ).value,
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

/* ── P0-OBD-04 · ERKEN UYARI ÖRNEKLEMESİ ─────────────────────────────────────
 * AYRI BİR KOŞUCU KURULMADI: erken uyarı, ZATEN çalışan bu tikin içinde ve
 * AYNI örnekleme disipliniyle beslenir (bayat/eksik örnek alınmaz, araç
 * değişince tampon temizlenir). İkinci bir zamanlayıcı, ikinci bir tazelik
 * kapısı ve ikinci bir "araç değişti" kararı demek olurdu.
 *
 * PID EKLENMEDİ: aşağıdaki sinyallerin HEPSİ `canonicalObdSignals` katalogunda
 * ZATEN tanımlı ve köprü tarafından ZATEN okunuyor. Bu liste yalnız hangilerinin
 * TREND TAMPONUNA alınacağını söyler — ELM327 hattına tek bir ek sorgu gitmez.
 *
 * Paylaşılan beş büyüklük (CAN karşılığı olanlar) `resolveLiveCanonicalSignal`
 * ile, OBD'ye özgü olanlar `readLiveObdSignal` ile okunur — ikisi de AYNI
 * tazelik/oturum politikasını uygular.
 */
const EW_SHARED = ['coolantTemp', 'ambientTemp'] as const;
const EW_OBD_ONLY: readonly CanonicalObdKey[] = [
  'longFuelTrimB1', 'longFuelTrimB2', 'shortFuelTrimB1',
  'egrError', 'egrCommanded',
  'moduleVoltage', 'engineRunTime',
  'catTempB1S1', 'oilTemp', 'intakeTemp', 'maf', 'manifoldPressure',
];

/** Erken uyarı tamponları — kanonik anahtar → örnekler. */
const _ewSamples = new Map<CanonicalObdKey, TrendSample[]>();
/** Araç bu sinyali HİÇ verdi mi (desteklenmeyen PID "normal" SAYILMASIN). */
const _ewSeen = new Set<CanonicalObdKey>();
let _earlyWarnings: readonly EarlyWarningResult[] = Object.freeze([]);
let _ewSkippedMissing = 0;

/**
 * Motor çalışıyor mu — `store.rpm` MEVCUT füzyon otoritesidir (yeni kaynak
 * eklenmedi). `undefined`/`null` → BİLİNMİYOR: motor durumuna bağlı kurallar
 * fail-closed susar (kontak kapalıyken düşük voltaj NORMALDİR).
 *
 * ── P0-OBD-07 · SICAK SİNYAL TAZELİK KAPISI (yeni) ─────────────────────────
 * `store.rpm` SAB hot-path'inden akar ve **kanonik tazelik penceresi YOKTUR**
 * (P0-OBD-02 yalnız `obdSignals` kayıtlarını kapsar). Yani hat durduğunda devir
 * son değerinde DONAR ve buradan bakan biri "motor 2000 devirde çalışıyor"
 * sanmaya devam ederdi. O yanlış bağlam, motor-bağımlı TÜM erken uyarı
 * kurallarını (şarj sistemi · termostat · yakıt trimi · EGR · katalizör) ölü
 * bir hattın son değeriyle çalıştırırdı.
 *
 * İKİNCİ FRESHNESS SİSTEMİ DEĞİL: rpm'in BAŞKA hiçbir tazelik otoritesi yok;
 * `obdHealthModel` onun TEK kapısıdır. Kanonik sinyaller bu kapıdan GEÇMEZ —
 * onların otoritesi P0-OBD-02'de kalır.
 *
 * FAIL-CLOSED: devir sinyali `STALLED`/`DISCONNECTED` ise cevap `null`
 * ("bilinmiyor") olur; motor durumuna bağlı kurallar susar. "Motor duruyor"
 * DEMEYİZ — bu da bir iddia olurdu ve bazı kuralları yanlış yönde açardı.
 */
function _engineRunning(): boolean | null {
  let rpmState: ObdHealthState | null = null;
  try {
    rpmState = getObdSignalHealth().fields.find((f) => f.field === 'rpm')?.state ?? null;
  } catch { /* sağlık okunamadı → kapı uygulanmaz (fail-soft, eski davranış) */ }
  try {
    /* Karar TEK yerde: `engineRunningFrom` saf ve kilitli. */
    return engineRunningFrom(rpmState, useUnifiedVehicleStore.getState().rpm);
  } catch {
    return null;
  }
}

function _ewClear(): void {
  _ewSamples.clear();
  _ewSeen.clear();
  _earlyWarnings = Object.freeze([]);
}

/** Tik başına bir kez: kanonik ölçümleri tampona al ve kuralları değerlendir. */
function _ewTick(nowMs: number): void {
  const st = useUnifiedVehicleStore.getState();

  const push = (k: CanonicalObdKey, v: number | null): void => {
    if (v === null) { _ewSkippedMissing += 1; return; }
    _ewSeen.add(k);
    let buf = _ewSamples.get(k);
    if (!buf) { buf = []; _ewSamples.set(k, buf); }
    buf.push({ t: nowMs, value: v });
    if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
  };

  for (const k of EW_SHARED) push(k, resolveLiveCanonicalSignal(st, k, nowMs).value);
  for (const k of EW_OBD_ONLY) push(k, readLiveObdSignal(st, k, nowMs));

  const windows = new Map<CanonicalObdKey, SignalWindow>();
  for (const k of _ewSeen) {
    windows.set(k, { available: true, samples: _ewSamples.get(k) ?? [] });
  }

  _earlyWarnings = Object.freeze(
    evaluateEarlyWarnings({ windows, engineRunning: _engineRunning() }),
  );
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
  /**
   * P0-OBD-04 — erken uyarı hükümleri. HER kural için bir kayıt vardır
   * (`NORMAL` · `WATCH` · `ATTENTION` · `INSUFFICIENT_DATA` · `SIGNAL_MISSING`);
   * sessizce atlanan kural YOKTUR.
   */
  readonly earlyWarnings: readonly EarlyWarningResult[];
  /** Erken uyarı için tanımlı kural adedi. */
  readonly earlyWarningRuleCount: number;
  /** Kanonik ölçüm okunamadığı için alınmayan erken-uyarı örneği sayısı. */
  readonly earlyWarningSkippedMissing: number;
  /** Erken uyarı sinyali başına biriken örnek sayısı. */
  readonly earlyWarningSampleCounts: Readonly<Record<string, number>>;
}

/** LAB salt-okuma yüzeyi — ASLA fırlatmaz, hiçbir şey tetiklemez. */
export function getPredictionSnapshot(): PredictionRuntimeSnapshot {
  const counts: Record<string, number> = {};
  for (const { kind, read } of TRACKED) {
    if (read === null) continue;   // kaynaksız kural sayaçta yer TUTMAZ
    counts[kind] = _samples.get(kind)?.length ?? 0;
  }
  const ewCounts: Record<string, number> = {};
  for (const [k, buf] of _ewSamples) ewCounts[k] = buf.length;
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
    earlyWarnings: _earlyWarnings,
    earlyWarningRuleCount: EARLY_WARNING_RULES.length,
    earlyWarningSkippedMissing: _ewSkippedMissing,
    earlyWarningSampleCounts: ewCounts,
  };
}

/**
 * Erken uyarı hükümleri — Mavi ve ürün yüzeyleri için doğrudan okuma.
 * Yan etkisiz; hiçbir şey tetiklemez.
 */
export function getEarlyWarnings(): readonly EarlyWarningResult[] {
  return _earlyWarnings;
}

/**
 * Aracın/oturumun değiştiğini gösteren anahtar. Değişirse tampon TEMİZLENİR:
 * iki farklı aracın (veya kopma öncesi/sonrası) değerlerini aynı doğruya
 * uydurmak, olmayan bir trend üretir.
 */
function _vehicleKey(d: ReturnType<typeof getOBDDataSnapshot>): string {
  /* P0-OBD-04: OBD OTURUM NUMARASI da anahtara girer. Bağlantı durumu aynı
     kalarak yeniden bağlanılabilir (aynı `connected|real|ice`), o zaman eski
     tampon SESSİZCE yeni oturuma taşınır ve önceki aracın değerleriyle trend
     üretilirdi. Epoch bunu yapısal olarak imkânsız kılar. */
  let epoch = -1;
  try { epoch = useUnifiedVehicleStore.getState().obdSessionEpoch; } catch { /* fail-soft */ }
  return `${d.connectionState}|${d.source}|${d.vehicleType}|${epoch}`;
}

function _clearSamples(): void {
  const had = _samples.size > 0 || _ewSamples.size > 0;
  _samples.clear();
  _predictions = Object.freeze({});
  _ewClear();
  if (had) _clearCount += 1;
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

    const now = Date.now();

    /* ── P0-OBD-06 · BURAYA HAT KAPISI EKLENMEDİ (bilinçli) ────────────────
     * Denendi ve GERİ ALINDI. Sebep ölçüldü: bu koşucunun okuduğu HER ölçüm
     * zaten kendi tazelik penceresinden ve oturum damgasından geçiyor
     * (`resolveLiveCanonicalSignal` · `readLiveObdSignal` — P0-OBD-02). Üstüne
     * bir de hat düzeyi blok koymak İKİNCİ bir tazelik otoritesi olurdu ve
     * yanlış tarafa çalışırdı: hat hükmü ÇEKİRDEK sinyallerden (hız/devir)
     * türer, ama ECU çekirdek PID'lere susarken genişletilmiş rotasyon hâlâ
     * geçerli yakıt trimi verebilir — o ölçüm çöpe atılırdı (P0-OBD-04'ün
     * aynı gerekçeyle aldığı karar).
     *
     * Hat sağlığı bu turda GÖZLEM ve SUNUM katmanına bağlandı (LAB ekranı ·
     * Mavi'nin "veriler bayat" cevabı); karar kapısı per-sinyal olarak
     * TEK yerde kalmaya devam ediyor. */

    /* ── P0-OBD-04 · ERKEN UYARI, ÇEKİRDEK `dataFresh` KAPISINDAN ÖNCE ──────
     * Bilinçli sıra. Erken uyarı örnekleri KANONİK mağazadan okunur ve her
     * ölçüm KENDİ tazelik penceresini taşır (`readLiveObdSignal` bayatı zaten
     * eler). Buraya bir de çekirdek `dataFresh` kapısı koymak İKİNCİ bir
     * tazelik otoritesi olurdu ve yanlış tarafa çalışırdı: ECU çekirdek
     * PID'lere susarken (0x0C/0x0D timeout) genişletilmiş rotasyon hâlâ yakıt
     * trimi verebilir — o ölçüm GEÇERLİDİR ve atılmamalıdır.
     *
     * Aşağıdaki `dataFresh` kapısı ÖNGÖRÜ yolunun MEVCUT sözleşmesidir ve
     * DEĞİŞTİRİLMEDİ. */
    _ewTick(now);

    /* BAYAT VERİ ÖRNEKLENMEZ. Duran bir sayıyı örneklemek "trend yok" üretir
       ve gerçek yükselişi maskeler — sessiz körlük. */
    if (d.dataFresh !== true) { _skippedStale += 1; return; }
    const lastSeen = typeof d.lastSeenMs === 'number' ? d.lastSeenMs : 0;
    if (lastSeen > 0 && now - lastSeen > MAX_SAMPLE_AGE_MS) { _skippedStale += 1; return; }

    const next: Record<string, Prediction> = {};
    for (const { kind, read } of TRACKED) {
      /* Kaynağı olmayan kural HİÇ denenmez — "eksik ölçüm" sayacını da
         şişirmez (eksik olan ölçüm değil, sinyalin KENDİSİ). */
      if (read === null) continue;
      const value = read(d, now);
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
  _ewClear();
  _ewSkippedMissing = 0;
}

/** @internal — testler tik gövdesini doğrudan koşturur (timer beklemeden). */
export function _tickForTest(): void { _tick(); }
