/**
 * maviReasoningSchedule.ts — KARAR KUYRUĞU ZAMANLAYICISI: MODEL (P1).
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────
 * 058 kuyruğu kurdu ama onu periyodik çağıran bir şey YOKTU: kuyruğa
 * alınan hot-path olayları (bağlantı · konum) ve düşüp `RETRY_PENDING`
 * olan her iş sonsuza kadar bekliyordu. Migration 059 koşucuyu zamanladı;
 * bu dosya o koşumun **cihaz tarafındaki okunuş sözleşmesidir**.
 *
 * ── BU KATMAN KARAR VERMEZ (BAĞLAYICI) ─────────────────────────────────
 * Zamanlayıcı bir karar otoritesi DEĞİLDİR: niyet çözmez, kanıt okumaz,
 * güven hesaplamaz. Yalnız "koşucu çalıştı mı, zamanında mı, düştü mü"
 * sorusunu cevaplar. Karar mantığı `maviReasoningEngine`de kalır.
 *
 * ── SUNUCU İLE PARİTE (BAĞLAYICI) ──────────────────────────────────────
 * `classifySchedulerHealth` migration 059'daki `get_reasoning_scheduler_health`
 * sağlık kapısının BİREBİR aynasıdır. İkisi ayrışırsa cihaz ile filo paneli
 * aynı kuyruk için farklı şey söyler — bu ikinci bir otoritedir.
 * (Kilit: `maviReasoningScheduler.test.ts` sıralamayı da sınar.)
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

/* ── Koşum ─────────────────────────────────────────────────────────────── */

/** Koşumu kim tetikledi — bounded KOD. */
export const SCHEDULER_TRIGGER_SOURCES = ['CRON', 'MANUAL'] as const;
export type SchedulerTriggerSource = (typeof SCHEDULER_TRIGGER_SOURCES)[number];

/**
 * Koşumun sonucu.
 *
 * ⚠️ `SKIPPED_LOCKED` bir hata DEĞİLDİR: önceki tik hâlâ çalışıyordu ve bu
 * tik bilinçli olarak iş yapmadı. Hata sayılsaydı sağlıklı bir sistem
 * "sürekli düşüyor" görünürdü.
 */
export const SCHEDULER_OUTCOMES = ['COMPLETED', 'SKIPPED_LOCKED', 'FAILED'] as const;
export type SchedulerOutcome = (typeof SCHEDULER_OUTCOMES)[number];

export function isSchedulerOutcome(v: unknown): v is SchedulerOutcome {
  return typeof v === 'string' && (SCHEDULER_OUTCOMES as readonly string[]).includes(v);
}

/**
 * Beklenen koşum aralığı (sn) — 059 `* * * * *` ile zamanlar.
 *
 * ⚠️ Daha sık koşmak boşuna uyanmaktır: 058'in yeniden deneme geri
 * çekilmesi 1 dakikadan başlar.
 */
export const SCHEDULER_INTERVAL_SECONDS = 60;

/**
 * Kaç aralık geçince koşum GECİKMİŞ sayılır.
 *
 * ⚠️ 1 değil 3: tek bir kaçan tik (yük, bakım, yeniden başlatma) arıza
 * değildir. Eşik sabittir ve çağıran gevşetemez.
 */
export const SCHEDULER_OVERDUE_FACTOR = 3;

/** Tek bir koşum kaydı (sunucudan okunur; head unit ÜRETMEZ). */
export interface SchedulerRun {
  readonly triggerSource: SchedulerTriggerSource;
  readonly outcome: SchedulerOutcome;
  /** Ölçülmeyen sayaç `null`dır — sahte `0` YOK (059 şema kısıtı). */
  readonly processed: number | null;
  readonly completed: number | null;
  readonly failed: number | null;
  readonly skipped: number | null;
  readonly expired: number | null;
  readonly durationMs: number | null;
  readonly ageSeconds: number | null;
}

/* ── Sağlık ────────────────────────────────────────────────────────────── */

/**
 * Zamanlayıcı sağlığı — `get_reasoning_scheduler_health()` karşılığı.
 *
 * ⚠️ Kişisel/şirket verisi TAŞIMAZ: araç, sürücü, plaka, VIN, konum YOKTUR.
 * Zamanlayıcı filo geneli çalışır; bu yüzden okunan tek şey koşumun kendisidir.
 */
export interface SchedulerHealth {
  readonly schedulerInstalled: boolean;
  readonly jobScheduled: boolean;
  /** Ham cron ifadesi; zamanlanmamışsa `null`. */
  readonly scheduleExpression: string | null;
  /** YALNIZ kesin bilinen ifadeden türetilir; tahmin EDİLMEZ. */
  readonly intervalSeconds: number | null;
  readonly runTotal: number;
  readonly lastRunAgeSeconds: number | null;
  readonly lastRunOutcome: SchedulerOutcome | null;
  readonly lastRunDurationMs: number | null;
  readonly lastProcessed: number | null;
  readonly lastExpired: number | null;
  readonly consecutiveFailureCount: number;
  /** Ölçülemiyorsa `null` — "gecikmiyor" DEMEK DEĞİLDİR. */
  readonly overdue: boolean | null;
  /** ÜÇ DEĞERLİ: `null` = bilinmiyor. */
  readonly healthy: boolean | null;
}

/**
 * Sunucudan hiç okunmamış durum.
 *
 * ⚠️ `healthy: null` — okunmamış bir zamanlayıcı "sağlıklı" DEĞİLDİR.
 * Boş nesne `false` da olamaz: arıza ile bilgisizlik farklı şeylerdir.
 */
export const UNREAD_SCHEDULER_HEALTH: SchedulerHealth = Object.freeze({
  schedulerInstalled: false,
  jobScheduled: false,
  scheduleExpression: null,
  intervalSeconds: null,
  runTotal: 0,
  lastRunAgeSeconds: null,
  lastRunOutcome: null,
  lastRunDurationMs: null,
  lastProcessed: null,
  lastExpired: null,
  consecutiveFailureCount: 0,
  overdue: null,
  healthy: null,
});

/**
 * Koşum gecikti mi — ölçülemiyorsa `null`.
 *
 * Aralık bilinmiyorsa (tanımadığımız bir cron ifadesi) gecikme TAHMİN
 * EDİLMEZ; hiç koşmamışsa da gecikme değil "hiç koşmadı" gerçeği vardır.
 */
export function isSchedulerOverdue(
  lastRunAgeSeconds: number | null,
  intervalSeconds: number | null,
): boolean | null {
  if (lastRunAgeSeconds === null || intervalSeconds === null) return null;
  if (!Number.isFinite(lastRunAgeSeconds) || !Number.isFinite(intervalSeconds)) return null;
  if (intervalSeconds <= 0) return null;
  return lastRunAgeSeconds > intervalSeconds * SCHEDULER_OVERDUE_FACTOR;
}

/**
 * SAĞLIK KAPISI — 059'daki SQL `CASE` ile **aynı sırada** değerlendirilir.
 *
 *  1. Zamanlanmamış  → `false` (gerçek arıza: kuyruk hiç boşalmayacak)
 *  2. Hiç koşmamış   → `null`  (kurulu ama tetiklenmemiş: BİLİNMİYOR)
 *  3. Art arda hata  → `false`
 *  4. Aralık bilinmiyor → `null` (gecikme ölçülemez → "iyi" denemez)
 *  5. Gecikmiş       → `false`
 *  6. Aksi hâlde     → `true`
 *
 * ⚠️ Sıra rastgele değildir: düşen bir koşum, aralık bilinmese de arızadır.
 */
export function classifySchedulerHealth(h: {
  readonly jobScheduled: boolean;
  readonly lastRunAgeSeconds: number | null;
  readonly consecutiveFailureCount: number;
  readonly intervalSeconds: number | null;
}): boolean | null {
  if (!h.jobScheduled) return false;
  if (h.lastRunAgeSeconds === null) return null;
  if (h.consecutiveFailureCount > 0) return false;
  if (h.intervalSeconds === null) return null;
  return isSchedulerOverdue(h.lastRunAgeSeconds, h.intervalSeconds) ? false : true;
}

/* ── Durum kodu (UI için · bounded) ────────────────────────────────────── */

/**
 * Zamanlayıcının tek kelimelik durumu — **bounded KOD**, serbest metin YOK.
 *
 * ⚠️ `NOT_READ` ile `NEVER_RUN` ayrıdır: birincisi "biz bakmadık",
 * ikincisi "kurulu ama hiç çalışmadı". İkisini birleştirmek, kendi
 * körlüğümüzü sistemin arızası gibi göstermek olurdu.
 */
export const SCHEDULER_STATUSES = [
  'NOT_READ',
  'NOT_INSTALLED',
  'NOT_SCHEDULED',
  'NEVER_RUN',
  'FAILING',
  'OVERDUE',
  'INTERVAL_UNKNOWN',
  'HEALTHY',
] as const;
export type SchedulerStatus = (typeof SCHEDULER_STATUSES)[number];

/** Sağlık okumasından bounded durum kodu (SAF). */
export function schedulerStatus(
  h: SchedulerHealth, read: boolean,
): SchedulerStatus {
  if (!read) return 'NOT_READ';
  if (!h.schedulerInstalled) return 'NOT_INSTALLED';
  if (!h.jobScheduled) return 'NOT_SCHEDULED';
  if (h.lastRunAgeSeconds === null) return 'NEVER_RUN';
  if (h.consecutiveFailureCount > 0) return 'FAILING';
  if (h.intervalSeconds === null) return 'INTERVAL_UNKNOWN';
  return isSchedulerOverdue(h.lastRunAgeSeconds, h.intervalSeconds)
    ? 'OVERDUE' : 'HEALTHY';
}

/* ── Etiketler ─────────────────────────────────────────────────────────── */

export function schedulerStatusLabel(s: SchedulerStatus): string {
  switch (s) {
    case 'NOT_READ':         return 'Sunucudan okunmadı';
    case 'NOT_INSTALLED':    return 'Zamanlayıcı kurulu değil';
    case 'NOT_SCHEDULED':    return 'Koşum zamanlanmamış';
    case 'NEVER_RUN':        return 'Henüz hiç koşmadı';
    case 'FAILING':          return 'Koşum düşüyor';
    case 'OVERDUE':          return 'Koşum gecikti';
    case 'INTERVAL_UNKNOWN': return 'Aralık bilinmiyor';
    case 'HEALTHY':          return 'Zamanında koşuyor';
  }
}

export function schedulerOutcomeLabel(o: SchedulerOutcome): string {
  switch (o) {
    case 'COMPLETED':      return 'Tamamlandı';
    case 'SKIPPED_LOCKED': return 'Atlandı (önceki koşum sürüyordu)';
    case 'FAILED':         return 'Düştü';
  }
}

export function schedulerTriggerSourceLabel(s: SchedulerTriggerSource): string {
  switch (s) {
    case 'CRON':   return 'Zamanlanmış';
    case 'MANUAL': return 'Elle';
  }
}
