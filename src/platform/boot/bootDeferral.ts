/**
 * bootDeferral — ARCH-06/F2 · BOOT ERTELEME SINIRI (SystemBoot'a AİT).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ BOOT OTORİTESİ DEĞİLDİR.** Hiçbir servisi kendi kararıyla
 *     başlatmaz. `SystemBoot` işi TESLİM EDER, bu runtime yalnız "ne zaman"
 *     sorusunu mevcut kilometre taşlarına bağlar.
 * (2) **ZAMANLAYICI DEĞİLDİR.** `setTimeout(0)` kuyruğu, rAF döngüsü veya
 *     periyodik tik KURMAZ. Tetikleyiciler F1'in ZATEN ölçtüğü kilometre
 *     taşlarıdır; `IDLE` için mevcut `requestIdleCallback` kullanılır.
 * (3) **YENİ EPOCH OTORİTESİ DEĞİLDİR.** Nesil numarasını `SystemBoot`
 *     verir; burada üretilmez.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── DEĞİŞMEZ GÜVENLİK KURALLARI ───────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   · Ertelenen iş KAYBOLMAZ — tetikleyici düştüğünde MUTLAKA koşar.
 *   · `stop()` sonrası tetikleyici düşerse iş **BAŞLAMAZ** (sıfır yan etki).
 *   · Eski boot neslinin işi YENİ boot'a servis KAYDETMEZ.
 *   · Aynı iş İKİ KEZ koşmaz (one-shot).
 *   · Cleanup sahipliği `SystemBoot`ta KALIR — iş bir cleanup döndürürse
 *     `SystemBoot`un LIFO yığınına AYNI sırayla verilir.
 *   · Hiçbir asenkron başlatma "fire-and-forget" bırakılmaz: her red
 *     yakalanır ve kanıta yazılır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── YARIŞ (RACE) KURALI ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bir iş, tetikleyicisi ZATEN düşmüşken kaydedilebilir (ör. `FIRST_FRAME`
 * Wave 1 bitmeden düşer). Bu durumda iş **kayıt anında hemen** çalıştırılır —
 * aksi hâlde sonsuza dek beklerdi ve "erteleme" sessiz bir İPTAL olurdu.
 */

import {
  hasBootMilestone, onBootMilestone, type BootMilestone,
} from '../bootTimingRecorder';

/* ══════════════════════════════════════════════════════════════════════════
   1) SINIFLANDIRMA SÖZLEŞMESİ (SAF — yürütme yetkisi YOK)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir boot servisinin ÜRÜN AÇISINDAN sınıfı.
 *
 * Bu bir ETİKETTİR, bir emir değil: `SystemBoot` hangi işi nereye koyacağına
 * karar verir. Etiket, kararın GEREKÇESİNİ kanıta taşır ve kilit testleri
 * "bu servis sessizce BOOT_CRITICAL'dan çıkarıldı mı" sorusunu sorabilir.
 */
export type BootClass =
  /** Onsuz ürün AÇILAMAZ ya da güvenlik/doğruluk bozulur. Ertelenemez. */
  | 'BOOT_CRITICAL'
  /** Kullanıcının ilk ekranda dokunabileceği yüzey. Ertelenemez. */
  | 'USER_VISIBLE_CRITICAL'
  /** Araç gerçeğinin/güvenlik izlemenin parçası. Wave sırasında kalır. */
  | 'VEHICLE_CORE'
  /** İlk ekran çizildikten sonra kurulabilir. */
  | 'DEFERABLE'
  /** Ana döngü boşalınca kurulur (ağ/bakım/analitik). */
  | 'IDLE_ONLY'
  /** Yalnız kullanıcı o yüzeyi açınca kurulur. */
  | 'ON_DEMAND';

/** Kanonik tetikleyiciler — hepsi F1'in ZATEN ölçtüğü olaylara bağlıdır. */
export type DeferTrigger =
  | 'AFTER_FIRST_FRAME'
  | 'AFTER_SHELL_INTERACTIVE'
  | 'AFTER_VEHICLE_CORE'
  | 'IDLE';

/** Tetikleyici → onu düşüren kilometre taşı. `IDLE`ın taşı yoktur. */
const TRIGGER_MILESTONE: Readonly<Record<Exclude<DeferTrigger, 'IDLE'>, BootMilestone>> =
  Object.freeze({
    AFTER_FIRST_FRAME: 'FIRST_FRAME',
    AFTER_SHELL_INTERACTIVE: 'SHELL_INTERACTIVE',
    AFTER_VEHICLE_CORE: 'VEHICLE_CORE_INITIALIZED',
  });

export type DeferOutcome =
  | 'PENDING' | 'STARTED' | 'FAILED'
  /** `stop()` tetikleyiciden ÖNCE geldi — iş HİÇ başlamadı. */
  | 'ABORTED_BEFORE_START'
  /** Aynı id yeniden kaydedildi — ikinci kayıt YUTULDU. */
  | 'DUPLICATE_SUPPRESSED'
  /** Eski boot neslinin işi yeni boot'ta koşturulmadı. */
  | 'STALE_GENERATION';

export interface DeferredJobEvidence {
  readonly jobId: string;
  readonly wave: number;
  readonly bootClass: BootClass;
  readonly trigger: DeferTrigger;
  /** Kaydın yapıldığı monotonik an. */
  readonly scheduledAt: number | null;
  /** İşin GERÇEKTEN başladığı an. */
  readonly actualStartAt: number | null;
  /** Kayıt → başlangıç arası gerçek gecikme. */
  readonly delayMs: number | null;
  readonly outcome: DeferOutcome;
  readonly generation: number;
  readonly reason: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) ÇALIŞMA ZAMANI
   ══════════════════════════════════════════════════════════════════════════ */

export type DeferredCleanup = void | (() => void);
export type DeferredJobFn = () => DeferredCleanup | Promise<DeferredCleanup>;

interface PendingJob {
  readonly jobId: string;
  readonly wave: number;
  readonly bootClass: BootClass;
  readonly trigger: DeferTrigger;
  readonly generation: number;
  readonly scheduledAt: number | null;
  readonly run: DeferredJobFn;
}

const MAX_EVIDENCE_ROWS = 64;

function monoNow(): number | null {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : null;
  } catch { return null; }
}

/**
 * `requestIdleCallback` — MEVCUT tarayıcı API'si kullanılır. Yoksa iş
 * KAYBOLMAZ: bounded bir `setTimeout` ile çalışır. Bu, bir "timer farmı"
 * değildir; iş başına TEK ATIŞLIK bir zamanlayıcıdır ve iş koşunca ölür.
 */
function scheduleIdle(fn: () => void): void {
  try {
    const ric = (globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
    }).requestIdleCallback;
    if (typeof ric === 'function') { ric(fn, { timeout: 10_000 }); return; }
  } catch { /* aşağıdaki yedeğe düş */ }
  setTimeout(fn, 1_000);
}

class BootDeferralRuntime {
  private _generation = 0;
  private _active = false;
  private _pending: PendingJob[] = [];
  private _seen = new Set<string>();
  private _evidence: DeferredJobEvidence[] = [];
  private _unsubscribe: (() => void) | null = null;
  /** `SystemBoot`un LIFO yığınına cleanup teslim eden kanal. */
  private _cleanupSink: ((jobId: string, cleanup: () => void) => void) | null = null;

  /**
   * Yeni bir boot turu açar. `SystemBoot.start()` içinden ÇAĞRILIR ve nesli
   * ilerletir — önceki turun bekleyen işleri yapısal olarak BAYAT olur.
   */
  begin(generation: number, cleanupSink: (jobId: string, cleanup: () => void) => void): void {
    this._generation = generation;
    this._active = true;
    this._pending = [];
    this._seen.clear();
    this._cleanupSink = cleanupSink;
    this._unsubscribe?.();
    /* Kilometre taşları ZATEN ölçülüyor; burada yalnız DİNLENİR. İkinci bir
       gözlemci ya da rAF döngüsü KURULMAZ. */
    this._unsubscribe = onBootMilestone((m) => this._onMilestone(m));
  }

  /**
   * Boot durdu. Bekleyen HER iş `ABORTED_BEFORE_START` olarak kapatılır ve
   * bir daha ASLA çalışmaz — tetikleyici sonradan düşse bile.
   */
  abort(reason: string): void {
    this._active = false;
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const job of this._pending) {
      this._record(job, null, 'ABORTED_BEFORE_START', reason);
    }
    this._pending = [];
    this._cleanupSink = null;
  }

  /**
   * Ertelenmiş bir işi kaydeder.
   *
   * Tetikleyici ZATEN düşmüşse iş **hemen** koşar (bkz. yarış kuralı).
   * Aynı `jobId` ikinci kez kaydedilirse ikinci kayıt YUTULUR.
   */
  schedule(input: {
    readonly jobId: string;
    readonly wave: number;
    readonly bootClass: BootClass;
    readonly trigger: DeferTrigger;
    readonly run: DeferredJobFn;
  }): void {
    const scheduledAt = monoNow();
    const job: PendingJob = {
      jobId: input.jobId, wave: input.wave, bootClass: input.bootClass,
      trigger: input.trigger, generation: this._generation, scheduledAt, run: input.run,
    };

    if (!this._active) { this._record(job, null, 'ABORTED_BEFORE_START', 'boot aktif değil'); return; }
    if (this._seen.has(input.jobId)) { this._record(job, null, 'DUPLICATE_SUPPRESSED', 'aynı jobId'); return; }
    this._seen.add(input.jobId);

    if (input.trigger === 'IDLE') {
      this._pending.push(job);
      scheduleIdle(() => this._fireJob(job));
      return;
    }

    const milestone = TRIGGER_MILESTONE[input.trigger];
    if (hasBootMilestone(milestone)) {
      /* YARIŞ: taş kayıttan ÖNCE düşmüş. Beklemek sessiz bir iptal olurdu. */
      this._pending.push(job);
      this._fireJob(job);
      return;
    }
    this._pending.push(job);
  }

  private _onMilestone(m: BootMilestone): void {
    if (!this._active) return;
    for (const [trigger, milestone] of Object.entries(TRIGGER_MILESTONE)) {
      if (milestone !== m) continue;
      const ready = this._pending.filter((j) => j.trigger === trigger);
      for (const job of ready) this._fireJob(job);
    }
  }

  /** İşi TEK KEZ çalıştırır. Kuyruktan çıkarma, çalıştırmadan ÖNCE yapılır. */
  private _fireJob(job: PendingJob): void {
    const idx = this._pending.indexOf(job);
    if (idx === -1) return;                       // zaten koştu ya da iptal edildi
    this._pending.splice(idx, 1);

    if (!this._active) { this._record(job, null, 'ABORTED_BEFORE_START', 'boot durdu'); return; }
    if (job.generation !== this._generation) {
      /* Eski boot neslinin işi YENİ boot'a servis KAYDEDEMEZ. */
      this._record(job, null, 'STALE_GENERATION', 'boot nesli ilerledi');
      return;
    }

    const startAt = monoNow();
    let result: DeferredCleanup | Promise<DeferredCleanup>;
    try {
      result = job.run();
    } catch (e) {
      this._record(job, startAt, 'FAILED', e instanceof Error ? e.message : 'start_threw');
      return;
    }

    if (result !== null && result !== undefined && typeof result === 'object'
      && typeof (result as { then?: unknown }).then === 'function') {
      /* Asenkron başlatma: red YUTULMAZ, kanıta yazılır. Unhandled rejection
         bırakmak, arızayı görünmez kılmak olurdu (§35). */
      void (result as Promise<DeferredCleanup>).then(
        (cleanup) => { this._acceptCleanup(job, cleanup); this._record(job, startAt, 'STARTED', null); },
        (e: unknown) => this._record(job, startAt, 'FAILED', e instanceof Error ? e.message : 'start_rejected'),
      );
      return;
    }

    this._acceptCleanup(job, result as DeferredCleanup);
    this._record(job, startAt, 'STARTED', null);
  }

  /**
   * Cleanup'ı `SystemBoot`un LIFO yığınına TESLİM EDER — bu runtime cleanup
   * SAHİBİ OLMAZ. Boot durduysa cleanup ANINDA çalıştırılır (zombi önleme).
   */
  private _acceptCleanup(job: PendingJob, cleanup: DeferredCleanup): void {
    if (typeof cleanup !== 'function') return;
    if (!this._active || job.generation !== this._generation || this._cleanupSink === null) {
      try { cleanup(); } catch { /* geç kapanış — yut */ }
      return;
    }
    try { this._cleanupSink(job.jobId, cleanup); } catch { /* sink hatası işi düşürmez */ }
  }

  private _record(job: PendingJob, actualStartAt: number | null, outcome: DeferOutcome, reason: string | null): void {
    try {
      if (this._evidence.length >= MAX_EVIDENCE_ROWS) this._evidence.shift();
      this._evidence.push(Object.freeze({
        jobId: job.jobId, wave: job.wave, bootClass: job.bootClass, trigger: job.trigger,
        scheduledAt: job.scheduledAt, actualStartAt,
        delayMs: job.scheduledAt !== null && actualStartAt !== null
          ? Math.max(0, Math.round(actualStartAt - job.scheduledAt)) : null,
        outcome, generation: job.generation, reason,
      }));
    } catch { /* kanıt kaybı ürünü bozmaz */ }
  }

  /** Salt-okunur kanıt. Bekleyen işler `PENDING` olarak görünür. */
  snapshot(): readonly DeferredJobEvidence[] {
    const pending = this._pending.map((j) => Object.freeze({
      jobId: j.jobId, wave: j.wave, bootClass: j.bootClass, trigger: j.trigger,
      scheduledAt: j.scheduledAt, actualStartAt: null, delayMs: null,
      outcome: 'PENDING' as DeferOutcome, generation: j.generation, reason: null,
    }));
    return Object.freeze([...this._evidence, ...pending]);
  }

  /** @internal YALNIZ TEST. */
  _resetForTest(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._generation = 0; this._active = false;
    this._pending = []; this._seen.clear(); this._evidence = [];
    this._cleanupSink = null;
  }
}

export const bootDeferral = new BootDeferralRuntime();

/** Salt-okunur projeksiyon (LAB + testler). */
export function getBootDeferralEvidence(): readonly DeferredJobEvidence[] {
  try { return bootDeferral.snapshot(); } catch { return Object.freeze([]); }
}

/** @internal YALNIZ TEST. */
export function _resetBootDeferralForTest(): void { bootDeferral._resetForTest(); }
