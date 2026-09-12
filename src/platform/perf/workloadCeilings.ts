/**
 * workloadCeilings — ARCH-06/F6 · L7 BİRLEŞİK DEGRADASYON PROJEKSİYONU (SAF).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YENİ BİR PERFORMANS OTORİTESİ DEĞİLDİR.** `RuntimeMode` ve
 *     `PowerCeiling` `AdaptiveRuntimeManager`da, termal seviye
 *     `thermalWatchdog`ta, bellek kademesi `memoryWatchdog`ta, cihaz sınıfı
 *     `deviceCapabilities`te KALIR. Burası onları OKUR.
 * (2) **HİÇBİR ŞEYİ UYGULAMAZ.** Bir tavanı okumak bir davranış üretmez;
 *     alan sahibi tavanı okur ve KENDİ işini kısar. `gpsService`in ARM
 *     config'ini okuyup kendi aralığını yeniden kurması bunun referans
 *     uygulamasıdır.
 * (3) **ZAMANLAYICI KURMAZ.** Kendi tik'i, rAF'ı, aboneliği YOKTUR. Çağrıldığı
 *     anda mevcut sahiplerden okur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN TEK PROJEKSİYON ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Termal · bellek · düşük-uç için ÜÇ AYRI degradasyon tablosu tutmak, üçünün
 * birbiriyle çelişmesi demektir: biri "prefetch açık" derken diğeri "kapat"
 * diyebilir. Tek merdiven, üç girdi. Fark yalnız **hangi kademeye kadar
 * inildiğidir**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ASLA KISILMAYANLAR ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Araç gerçeği · dokunma yanıtı · navigasyon rehberliği · ses çalma ·
 * kritik uyarılar · komut yürütme · güvenlik kapıları.
 *
 * Bunlar bu dosyada bir "iş yükü" olarak TANIMLI DEĞİLDİR — tavanı olmayan
 * şey kısılamaz. Koruma bir `if` koşuluna değil, listede BULUNMAMAYA dayanır
 * (F5'teki `NON_EVICTABLE_TRUTH` kararıyla aynı desen).
 */

import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../../core/runtime/runtimeTypes';
import { getThermalLevel } from '../thermalWatchdog';
import { getMemoryTrimEvidence, type MemoryTrimLevel } from '../memoryWatchdog';
import { getDeviceTier, type DeviceTier } from '../deviceCapabilities';
import { getPerfSeriesSnapshot } from '../perfSeriesRecorder';

/* ══════════════════════════════════════════════════════════════════════════
   1) TAVAN SÖZLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir iş yükünün izin verilen ÜST sınırı. */
export type WorkloadCeiling = 'FULL' | 'REDUCED' | 'MINIMAL' | 'OFF';

const CEILING_ORDER: readonly WorkloadCeiling[] = Object.freeze(['FULL', 'REDUCED', 'MINIMAL', 'OFF']);

/** İki tavandan DAHA KISITLAYICI olanı seçer (girdiler çelişemez). */
function stricter(a: WorkloadCeiling, b: WorkloadCeiling): WorkloadCeiling {
  return CEILING_ORDER.indexOf(a) >= CEILING_ORDER.indexOf(b) ? a : b;
}

/**
 * KISILABİLİR iş yükleri — F6 §2 sırasıyla BİREBİR aynı.
 *
 * Sıra ANLAMLIDIR: küçük indeks önce feda edilir. Kullanıcı en son
 * `maviVisualFx`i kaybeder, en önce `labSampling`i.
 */
export type WorkloadId =
  | 'labSampling'
  | 'telemetrySampling'
  | 'prefetch'
  | 'backgroundIndexing'
  | 'nonCriticalAnimations'
  | 'mapDecoration'
  | 'artworkQuality'
  | 'maviVisualFx';

const WORKLOAD_ORDER: readonly WorkloadId[] = Object.freeze([
  'labSampling', 'telemetrySampling', 'prefetch', 'backgroundIndexing',
  'nonCriticalAnimations', 'mapDecoration', 'artworkQuality', 'maviVisualFx',
]);

export type WorkloadCeilings = Readonly<Record<WorkloadId, WorkloadCeiling>>;

/** Baskının NEREDEN geldiği — LAB "neden kısıldı" sorusuna cevap verir. */
export type DegradationSource = 'THERMAL' | 'MEMORY' | 'DEVICE_TIER' | 'RUNTIME_MODE' | 'NONE';

/* ══════════════════════════════════════════════════════════════════════════
   2) GİRDİ OKUMA — hepsi mevcut sahiplerden, hepsi fail-soft
   ══════════════════════════════════════════════════════════════════════════ */

export interface DegradationInputs {
  readonly runtimeMode: RuntimeMode | null;
  readonly thermalLevel: 0 | 1 | 2 | 3 | null;
  readonly memoryLevel: MemoryTrimLevel | null;
  readonly deviceTier: DeviceTier | null;
  /**
   * ⚠️ **WORKER DOYGUNLUĞU ÖLÇÜLMÜYOR.**
   *
   * F6 §1 girdi olarak "worker saturation" ister; repoda böyle bir ölçüm
   * YOKTUR. `getWorkerSnapshot()` yalnız YAŞAM DÖNGÜSÜ durumu verir
   * (`active` = worker ayakta), kuyruk derinliği veya meşguliyet DEĞİL.
   *
   * "Hepsi active → doygun" demek SAHTE bir sinyal olurdu: sağlıklı bir
   * sistemde de hepsi active'tir. Bu yüzden alan DAİMA `null`dır ve
   * projeksiyona GİRMEZ. Yaşam döngüsü sayıları yalnız LAB kanıtı olarak
   * `workerLifecycle` altında raporlanır.
   */
  readonly workerSaturation: null;
  /** Salt kanıt — karara GİRMEZ. */
  readonly workerLifecycle: { readonly total: number; readonly active: number } | null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Girdileri MEVCUT sahiplerden okur. Hiçbirini yeniden hesaplamaz. */
export function readDegradationInputs(): DegradationInputs {
  const thermal = safe(() => getThermalLevel(), null);
  const workers = safe(() => runtimeManager.getResourceDiagnostics().workers, null);
  return Object.freeze({
    runtimeMode: safe(() => runtimeManager.getMode(), null),
    thermalLevel: thermal === null ? null : (thermal as 0 | 1 | 2 | 3),
    memoryLevel: safe(() => getMemoryTrimEvidence().currentLevel, null),
    deviceTier: safe(() => getDeviceTier(), null),
    workerSaturation: null,   // ÖLÇÜLMÜYOR — sahte doygunluk üretilmez
    workerLifecycle: workers === null
      ? null
      : Object.freeze({
        total: workers.length,
        active: workers.reduce((n, w) => (w.status === 'active' ? n + 1 : n), 0),
      }),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3) SAF PROJEKSİYON — aynı girdi, aynı çıktı
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir iş yükünün, o merdiven adımında düştüğü tavan. */
type Step = Readonly<Partial<Record<WorkloadId, WorkloadCeiling>>>;

/**
 * TERMAL merdiveni. `_THERMAL_CEILING` ile ÇELİŞMEZ: o `RuntimeMode` tavanı
 * koyar (ARM otoritesi), bu ise İŞ YÜKÜ tavanı koyar. İki farklı soru.
 */
const THERMAL_STEPS: readonly Step[] = Object.freeze([
  Object.freeze({}),                                                    // L0
  Object.freeze({ labSampling: 'REDUCED' as const,
    nonCriticalAnimations: 'REDUCED' as const }),                       // L1 ≥45°C
  Object.freeze({ labSampling: 'OFF' as const, telemetrySampling: 'REDUCED' as const,
    prefetch: 'MINIMAL' as const, mapDecoration: 'REDUCED' as const,
    nonCriticalAnimations: 'MINIMAL' as const, maviVisualFx: 'REDUCED' as const }), // L2 ≥55°C
  Object.freeze({ labSampling: 'OFF' as const, telemetrySampling: 'MINIMAL' as const,
    prefetch: 'OFF' as const, backgroundIndexing: 'OFF' as const,
    nonCriticalAnimations: 'OFF' as const, mapDecoration: 'MINIMAL' as const,
    artworkQuality: 'REDUCED' as const, maviVisualFx: 'OFF' as const }),  // L3 ≥65°C
]);

/** BELLEK merdiveni — F5 kademeleriyle BİREBİR hizalı (ikinci tablo YOK). */
const MEMORY_STEPS: Readonly<Record<MemoryTrimLevel, Step>> = Object.freeze({
  NORMAL: Object.freeze({}),
  TRIM_DEVTOOLS: Object.freeze({ labSampling: 'OFF' as const }),
  TRIM_PREFETCH: Object.freeze({ labSampling: 'OFF' as const, prefetch: 'OFF' as const }),
  TRIM_PRESENTATION: Object.freeze({ labSampling: 'OFF' as const, prefetch: 'OFF' as const,
    artworkQuality: 'REDUCED' as const, mapDecoration: 'REDUCED' as const }),
  PAUSE_BACKGROUND: Object.freeze({ labSampling: 'OFF' as const, prefetch: 'OFF' as const,
    artworkQuality: 'REDUCED' as const, mapDecoration: 'REDUCED' as const,
    backgroundIndexing: 'OFF' as const, telemetrySampling: 'MINIMAL' as const }),
  CRITICAL_PROTECT: Object.freeze({ labSampling: 'OFF' as const, prefetch: 'OFF' as const,
    artworkQuality: 'MINIMAL' as const, mapDecoration: 'MINIMAL' as const,
    backgroundIndexing: 'OFF' as const, telemetrySampling: 'MINIMAL' as const,
    nonCriticalAnimations: 'OFF' as const, maviVisualFx: 'OFF' as const }),
});

/** CİHAZ SINIFI — kalıcı (baskıya bağlı değil) taban tavan. */
const TIER_STEPS: Readonly<Record<DeviceTier, Step>> = Object.freeze({
  high: Object.freeze({}),
  mid: Object.freeze({ maviVisualFx: 'REDUCED' as const }),
  low: Object.freeze({ nonCriticalAnimations: 'MINIMAL' as const,
    mapDecoration: 'REDUCED' as const, artworkQuality: 'REDUCED' as const,
    maviVisualFx: 'OFF' as const, labSampling: 'REDUCED' as const }),
});

/** RUNTIME MODU — ARM'ın verdiği karar iş yüküne yansır. */
function modeStep(mode: RuntimeMode | null): Step {
  if (mode === RuntimeMode.SAFE_MODE) {
    return Object.freeze({
      labSampling: 'OFF' as const, telemetrySampling: 'MINIMAL' as const,
      prefetch: 'OFF' as const, backgroundIndexing: 'OFF' as const,
      nonCriticalAnimations: 'OFF' as const, mapDecoration: 'MINIMAL' as const,
      artworkQuality: 'MINIMAL' as const, maviVisualFx: 'OFF' as const,
    });
  }
  if (mode === RuntimeMode.POWER_SAVE) {
    return Object.freeze({
      labSampling: 'OFF' as const, prefetch: 'MINIMAL' as const,
      backgroundIndexing: 'MINIMAL' as const, nonCriticalAnimations: 'MINIMAL' as const,
      maviVisualFx: 'OFF' as const,
    });
  }
  if (mode === RuntimeMode.BASIC_JS) {
    return Object.freeze({
      nonCriticalAnimations: 'REDUCED' as const, mapDecoration: 'REDUCED' as const,
      maviVisualFx: 'REDUCED' as const,
    });
  }
  return Object.freeze({});
}

export interface WorkloadCeilingProjection {
  readonly ceilings: WorkloadCeilings;
  readonly inputs: DegradationInputs;
  /** En kısıtlayıcı kaynağı adlandırır — LAB "neden" sorusunu cevaplar. */
  readonly dominantSource: DegradationSource;
  /** Sıra — LAB'da neyin önce feda edildiğini gösterir. */
  readonly order: readonly WorkloadId[];
  readonly notes: readonly string[];
}

function emptyCeilings(): Record<WorkloadId, WorkloadCeiling> {
  const o = {} as Record<WorkloadId, WorkloadCeiling>;
  for (const w of WORKLOAD_ORDER) o[w] = 'FULL';
  return o;
}

function applyStep(into: Record<WorkloadId, WorkloadCeiling>, step: Step): boolean {
  let changed = false;
  for (const w of WORKLOAD_ORDER) {
    const v = step[w];
    if (v === undefined) continue;
    const next = stricter(into[w], v);
    if (next !== into[w]) { into[w] = next; changed = true; }
  }
  return changed;
}

/**
 * SAF projeksiyon. Aynı girdi → aynı çıktı. I/O · timer · `Date.now` YOK.
 *
 * Dört girdi BİRLEŞTİRİLİR ve her iş yükü için **en kısıtlayıcı** tavan
 * kazanır — böylece iki kaynak çelişemez.
 */
export function projectWorkloadCeilings(inputs: DegradationInputs): WorkloadCeilingProjection {
  const ceilings = emptyCeilings();
  let dominant: DegradationSource = 'NONE';

  /* Sıra bilinçli: en kalıcı olan (cihaz) önce, en oynak olan (bellek) sonra.
     `dominantSource` en SON kısıtlamayı ekleyen kaynağı adlandırır. */
  if (inputs.deviceTier !== null && applyStep(ceilings, TIER_STEPS[inputs.deviceTier])) {
    dominant = 'DEVICE_TIER';
  }
  if (applyStep(ceilings, modeStep(inputs.runtimeMode))) dominant = 'RUNTIME_MODE';
  if (inputs.thermalLevel !== null
    && applyStep(ceilings, THERMAL_STEPS[inputs.thermalLevel] ?? {})) {
    dominant = 'THERMAL';
  }
  if (inputs.memoryLevel !== null
    && applyStep(ceilings, MEMORY_STEPS[inputs.memoryLevel] ?? {})) {
    dominant = 'MEMORY';
  }

  return Object.freeze({
    ceilings: Object.freeze(ceilings),
    inputs,
    dominantSource: dominant,
    order: WORKLOAD_ORDER,
    notes: Object.freeze([
      'Bu bir PROJEKSİYONDUR: hiçbir tavan burada UYGULANMAZ, alan sahibi okur.',
      'Araç gerçeği · dokunma · navigasyon · ses · kritik uyarı · komut · güvenlik bir iş yükü olarak TANIMLI DEĞİLDİR — tavanı olmayan kısılamaz.',
      'Termal baskı bir ARIZA DEĞİLDİR: tavan düşürmek `reportFailure` üretmez.',
      'Çelişki imkânsız: her iş yükü için EN KISITLAYICI tavan kazanır.',
    ]),
  });
}

/** Kolaylık: girdileri okur ve projeksiyonu döner. */
export function getWorkloadCeilings(): WorkloadCeilingProjection {
  return projectWorkloadCeilings(readDegradationInputs());
}

/** Tek bir iş yükünün tavanı — alan sahibinin okuyacağı ucuz yol. */
export function ceilingFor(id: WorkloadId): WorkloadCeiling {
  return safe(() => getWorkloadCeilings().ceilings[id], 'FULL');
}

/* ══════════════════════════════════════════════════════════════════════════
   3b) TAVANI KİM UYGULAR — ARCH-06/F7 SAHİPLİK HARİTASI
   ══════════════════════════════════════════════════════════════════════════
   F6 sekiz kategori BİLDİRDİ ama yalnız birini bağladı. F7 denetimi geri
   kalan yediyi tek tek inceledi ve şunu buldu: **dördü ZATEN yönetiliyor.**

   `RuntimeConfig` (`enableAnimations` · `enableBlur` · `enableShadows` ·
   `uiFpsTarget`) ARM otoritesinde ve `MainLayout` · `MediaScreen` ·
   `livingThemeState` tarafından GERÇEKTEN okunuyor. Bu yüzeylere ikinci bir
   tavan bağlamak **ikinci otorite kurmak** olurdu — Cross-Domain §1 (ONE
   DOMAIN = ONE AUTHORITY), §5 (yatay katman sahip değildir), §8 (ARM bütçe
   verir) ve §15 (yeni global performans yöneticisi yasağı) ihlali.

   Bu yüzden burada her kategori için **kimin uyguladığı** açıkça yazılır.
   `WorkloadCeilings` o kategoriler için bir BİRLEŞİK GÖRÜNÜM sağlar
   (LAB'da "şu an ne kısıtlı?" sorusuna tek yerden cevap); **uygulama
   otoritesi taşımaz.** */

export type CeilingEnforcer =
  /** Tavanı GERÇEKTEN uygulayan tüketici bu tavanı okur. */
  | 'WORKLOAD_CEILING'
  /** ARM `RuntimeConfig` uygular — buradaki tavan yalnız GÖRÜNÜMdür. */
  | 'ARM_RUNTIME_CONFIG'
  /** Böyle bir alt sistem repoda YOK — tüketici bağlanamaz. */
  | 'NO_CONSUMER'
  /** Bilinçli bağlanmadı; gerekçe `rationale`da. */
  | 'DELIBERATELY_UNBOUND';

export interface CeilingOwnership {
  readonly workload: WorkloadId;
  readonly enforcer: CeilingEnforcer;
  /** Tavanı uygulayan (veya uygulayacak) yer — boşsa yok. */
  readonly consumer: string | null;
  readonly rationale: string;
}

const CEILING_OWNERSHIP: readonly CeilingOwnership[] = Object.freeze([
  Object.freeze({
    workload: 'labSampling' as const, enforcer: 'WORKLOAD_CEILING' as const,
    consumer: 'CarosLabRefreshBar (otomatik tur adımı)',
    rationale: 'LAB örneklemesi kullanıcının GÖRMEDİĞİ iştir ve en önce feda '
      + 'edilir. ELLE YENİLE tavandan ETKİLENMEZ — kullanıcı niyeti kısılmaz.',
  }),
  Object.freeze({
    workload: 'telemetrySampling' as const, enforcer: 'DELIBERATELY_UNBOUND' as const,
    consumer: null,
    rationale: 'Tek tüketici `perfSeriesRecorder` 12 s tikidir; o ÖLÇÜMÜN '
      + 'KENDİSİDİR. Baskı altında örneklemeyi kısmak, tam da kanıta ihtiyaç '
      + 'duyulan anda körleşmek olurdu.',
  }),
  Object.freeze({
    workload: 'prefetch' as const, enforcer: 'NO_CONSUMER' as const,
    consumer: null,
    rationale: 'Repoda prefetch alt sistemi YOK (F6 + F7 denetimi). '
      + 'Var olmayan işe tavan bağlamak sahte bir kazanç iddiası olurdu.',
  }),
  Object.freeze({
    workload: 'backgroundIndexing' as const, enforcer: 'WORKLOAD_CEILING' as const,
    consumer: 'communityService._idlePull (bulut zenginleştirme çekimi)',
    rationale: 'Yeniden üretilebilir GELEN zenginleştirme. GİDEN kullanıcı '
      + 'kuyruğu (`_idleSync`) KISILMAZ — veri kaybı olurdu.',
  }),
  Object.freeze({
    workload: 'nonCriticalAnimations' as const, enforcer: 'ARM_RUNTIME_CONFIG' as const,
    consumer: 'RuntimeConfig.enableAnimations → livingThemeState · MainLayout',
    rationale: 'ARM ZATEN uyguluyor ve tüketiciler GERÇEKTEN okuyor. İkinci '
      + 'tavan bağlamak Cross-Domain §1/§8 ihlali olurdu.',
  }),
  Object.freeze({
    workload: 'mapDecoration' as const, enforcer: 'ARM_RUNTIME_CONFIG' as const,
    consumer: 'RuntimeConfig.enableShadows / uiFpsTarget → harita yüzeyleri',
    rationale: 'Harita render kadansının sahibi MapLibre + bileşendir (§8). '
      + 'Süs kalitesi ARM modundan gelir; L7 ikinci karar üretmez.',
  }),
  Object.freeze({
    workload: 'artworkQuality' as const, enforcer: 'DELIBERATELY_UNBOUND' as const,
    consumer: null,
    rationale: 'F5 denetimi çoklu-decode problemini KANITLAYAMADI (djb2 dedup '
      + '+ 16×16 downsample + lazy yükleme zaten var). Kanıtsız soruna kalite '
      + 'düşürmek, ölçülmemiş bir kazanç için görünür bir kayıp olurdu (#232).',
  }),
  Object.freeze({
    workload: 'maviVisualFx' as const, enforcer: 'ARM_RUNTIME_CONFIG' as const,
    consumer: 'RuntimeConfig.enableBlur → MainLayout · MediaScreen',
    rationale: '`enableBlur` Mali-400 GPU stall koruması olarak ZATEN bağlı '
      + '(runtimeConfig.ts:64). Aynı yüzeye ikinci kapı takmak çelişki üretirdi.',
  }),
]);

/** Tavanı kimin uyguladığı — LAB kanıtı ve kilit testi için. */
export function ceilingOwnership(): readonly CeilingOwnership[] {
  return CEILING_OWNERSHIP;
}

/** Tavanı GERÇEKTEN bir tüketicinin okuduğu kategoriler. */
export function boundWorkloads(): readonly WorkloadId[] {
  return Object.freeze(
    CEILING_OWNERSHIP.filter((o) => o.enforcer === 'WORKLOAD_CEILING').map((o) => o.workload),
  );
}

/** Kapalı listeler (test ve LAB için). */
export function workloadOrder(): readonly WorkloadId[] { return WORKLOAD_ORDER; }

/* ══════════════════════════════════════════════════════════════════════════
   4) GÖZLENEN CİHAZ SINIFI + HİSTEREZİS SÖZLEŞMESİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ EŞİKLER KALİBRE EDİLMEMİŞTİR.
 *
 * F6 §4: "eşikleri baseline yoksa UYDURMA". Saha tabanı henüz alınmadığı
 * için burada SAYI YOKTUR; yalnız MODEL ve ASİMETRİ KURALI tanımlıdır.
 * `UNCALIBRATED` iken `observedTier` DAİMA `null` döner ve hiçbir karar
 * üretmez.
 */
export const HYSTERESIS_CALIBRATION = 'UNCALIBRATED' as const;

export interface HysteresisContract {
  readonly calibration: 'UNCALIBRATED' | 'CALIBRATED';
  /** Düşürme için gereken ardışık kötü örnek sayısı. */
  readonly downgradeConsecutiveSamples: number | null;
  /** Yükseltme için gereken ardışık iyi örnek sayısı. */
  readonly upgradeConsecutiveSamples: number | null;
  /** Son değişimden sonra beklenecek örnek sayısı. */
  readonly cooldownSamples: number | null;
  /** Yükseltme, düşürmeden KAÇ KAT daha zor. */
  readonly upgradeStrictnessFactor: number;
  readonly rationale: string;
}

/**
 * HİSTEREZİS SÖZLEŞMESİ — asimetri KALİBRASYONDAN BAĞIMSIZ olarak geçerlidir.
 *
 * Düşürmek UCUZDUR (görsel kayıp, geri alınabilir); yükseltmek RİSKLİDİR
 * (kasma geri gelir ve kullanıcı bunu "bozuldu" diye okur). Bu yüzden
 * yükseltme daha fazla kanıt ister — sayılar kalibre edilmese bile bu ORAN
 * sözleşmenin parçasıdır ve kilit testiyle korunur.
 */
export function getHysteresisContract(): HysteresisContract {
  return Object.freeze({
    calibration: HYSTERESIS_CALIBRATION,
    downgradeConsecutiveSamples: null,
    upgradeConsecutiveSamples: null,
    cooldownSamples: null,
    upgradeStrictnessFactor: 3,
    rationale: 'Düşürmek ucuz ve geri alınabilir; yükseltmek kasmayı geri getirir. '
      + 'Yükseltme 3× daha fazla kanıt ister. Eşik SAYILARI saha tabanı alınana '
      + 'kadar null KALIR — uydurulmaz.',
  });
}

export interface ObservedTierEvidence {
  /** Ürün kararını VEREN sınıf — `getDeviceTier()` otoritesi. */
  readonly staticTier: DeviceTier | null;
  /**
   * perfSeries kanıtından TÜRETİLEN gözlem. Kalibrasyon yokken DAİMA `null`.
   * **Ürün davranışını DEĞİŞTİRMEZ** — yalnız LAB kanıtıdır.
   */
  readonly observedTier: DeviceTier | null;
  /** İkisi ayrışıyor mu (kanıt; otomatik eylem YOK). */
  readonly mismatch: boolean;
  /** Türetimde kullanılan örnek adedi. */
  readonly sampleCount: number;
  readonly reason: string;
}

/**
 * GÖZLENEN sınıf kanıtı.
 *
 * ⚠️ İlk aşamada `staticTier`ı OTOMATİK DEĞİŞTİRMEZ (F6 §3). Ölçüm gürültüsü
 * ürün davranışını sallamamalıdır; uyuşmazlık yalnız LAB'da GÖRÜNÜR ve saha
 * kalibrasyonundan sonra karara bağlanır.
 */
export function getObservedTierEvidence(): ObservedTierEvidence {
  const staticTier = safe(() => getDeviceTier(), null);
  const series = safe(() => getPerfSeriesSnapshot(), null);
  const samples = series?.samples.length ?? 0;
  return Object.freeze({
    staticTier,
    observedTier: null,          // UNCALIBRATED → türetim YAPILMAZ
    mismatch: false,
    sampleCount: samples,
    reason: HYSTERESIS_CALIBRATION === 'UNCALIBRATED'
      ? 'Eşikler KALİBRE EDİLMEDİ — gözlenen sınıf türetilmez, sahte sınıf üretilmez.'
      : 'kalibre',
  });
}
