/**
 * bootTimingRecorder — boot dalga (Wave) süre kaydedici (tanı genişliği).
 *
 * SystemBoot.start() dört dalgayı (Wave 1-4) sırayla bekler; bu kaydedici o
 * sıranın DIŞINDA, yalnız GÖZLEMCİ olarak her Wave'in süresini (ms) alır.
 * Boot sırasını/mantığını DEĞİŞTİRMEZ — yalnız ölçüm eklenir.
 *
 * Zero-Allocation: module-level sabit tavanlı dizi, hot-path DEĞİL (boot bir
 * kez çalışır, ömür boyu tek seferlik — 3Hz hız/RPM döngüsüne asla girmez).
 *
 * PII yok — yalnız wave adı (statik metin) + süre (ms, sayısal).
 */

export interface BootWaveTiming {
  name:       string;
  durationMs: number;
}

export interface BootTimingSnapshot {
  waves:       BootWaveTiming[];
  /** Toplam cold-start süresi (ms) — boot tamamlanmadıysa şimdiye kadarki toplam. */
  totalMs:     number;
  /** En yavaş dalganın adı — açılış yavaşlığının kökü. Ölçüm yoksa null. */
  slowestWave: string | null;
}

// Güvenlik tavanı — 4 dalga + pay (sınırsız büyüme yok, zero-leak).
const MAX_WAVES = 8;

let _waves: BootWaveTiming[] = [];
let _bootStartTs: number | null = null;
let _totalMs: number | null = null;

/**
 * SystemBoot.start() girişinde bir kez çağrılır — toplam süre ölçümü için taban.
 * Yeniden boot (stop→start) öncesi önce resetBootTiming() çağrılmalı.
 */
export function recordBootStart(): void {
  _bootStartTs = performance.now();
}

/** Bir Wave tamamlandığında çağrılır — adı + süresi (ms, tam sayıya yuvarlanır). */
export function recordBootWave(name: string, durationMs: number): void {
  if (_waves.length >= MAX_WAVES) return; // tavan koruması
  _waves.push({ name, durationMs: Math.max(0, Math.round(durationMs)) });
}

/** Boot tamamen bitince (window.__APP_READY__) çağrılır — toplam süreyi mühürler. */
export function recordBootComplete(): void {
  if (_bootStartTs === null) return;
  _totalMs = Math.max(0, Math.round(performance.now() - _bootStartTs));
}

/** Tanı payload'ı için boot zaman çizelgesi anlık görüntüsü (kopya, fail-soft). */
export function getBootTimingSnapshot(): BootTimingSnapshot {
  let slowest:   string | null = null;
  let slowestMs = -1;
  for (const w of _waves) {
    if (w.durationMs > slowestMs) { slowestMs = w.durationMs; slowest = w.name; }
  }
  const total = _totalMs ?? _waves.reduce((acc, w) => acc + w.durationMs, 0);
  return { waves: [..._waves], totalMs: total, slowestWave: slowest };
}

/** Yeniden boot (stop→start) öncesi sıfırlar — SystemBoot.start() girişinde çağrılır. */
export function resetBootTiming(): void {
  _waves = [];
  _bootStartTs = null;
  _totalMs = null;
}

/* ══════════════════════════════════════════════════════════════════════════
   ARCH-06/F1 — BOOT KİLOMETRE TAŞLARI VE SERVİS SÜRELERİ
   ══════════════════════════════════════════════════════════════════════════

   ── NEDEN DALGA SÜRESİ YETMİYOR ─────────────────────────────────────────
   "Boot 4200 ms sürdü" cümlesi kullanıcının HİSSETTİĞİ hiçbir şeyi anlatmaz.
   Kullanıcı ekranın ne zaman ÇİZİLDİĞİNİ, ne zaman DOKUNABİLDİĞİNİ ve aracın
   ne zaman GERÇEK veri gösterdiğini yaşar. Bu bölüm o soruları ölçer.

   ── İKİNCİ BOOT OTORİTESİ KURULMADI ─────────────────────────────────────
   Burada hiçbir servis başlatılmaz, sıra değiştirilmez, karar verilmez.
   `SystemBoot` tek boot otoritesidir; bu modül yalnız GÖZLEMCİDİR.

   ── SAHTE HAZIRLIK ÜRETİLMEZ ────────────────────────────────────────────
   Ölçülmemiş kilometre taşı `null` kalır. "Wave 2 bitti ⇒ araç hazır" gibi
   çıkarımlar YAPILMAZ: alt yapı ayakta olabilir ama araçtan tek bayt
   gelmemiş olabilir. Bu yüzden `*_INITIALIZED` (alt yapı ayakta) ile
   `*_AVAILABLE` / `*_FIRST_OBSERVATION` (gerçek kanıt var) AYRI taşlardır.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Kilometre taşları. `INITIALIZED` ≠ `AVAILABLE` ayrımı BİLİNÇLİDİR ve
 * hiçbir tüketici birini diğerinin yerine kullanamaz.
 */
export type BootMilestone =
  /** Süreç/JS bootstrap'in ölçülebilen EN ERKEN anı. */
  | 'PROCESS_STARTED'
  /** İlk gerçek boyamaya en yakın ölçülebilir an (çift rAF sınırı). */
  | 'FIRST_FRAME'
  /** Kabuk çizilmiş ve ana döngü girdi işleyebiliyor. "Uygulama hazır" DEĞİL. */
  | 'SHELL_INTERACTIVE'
  /** VDL + adaptörler kuruldu. Araçtan veri geldiği ANLAMINA GELMEZ. */
  | 'VEHICLE_CORE_INITIALIZED'
  /** Araçtan ÖLÇÜLMÜŞ ilk sinyal. Araç bağlı değilse ASLA düşmez. */
  | 'VEHICLE_DATA_FIRST_OBSERVATION'
  /** Medya otoritesi kuruldu (native kanıt gerekmez). */
  | 'MEDIA_AUTHORITY_INITIALIZED'
  /** Medya otoritesi GERÇEKTEN kullanılabilir (sahipten kanıt geldi). */
  | 'MEDIA_AUTHORITY_AVAILABLE'
  /** Navigasyon çalışma zamanı kuruldu. Konum/rota var demek DEĞİLDİR. */
  | 'NAV_RUNTIME_INITIALIZED'
  /** Navigasyonun kullanabileceği ilk konum kanıtı. */
  | 'NAV_LOCATION_AVAILABLE'
  /** Mavi alt yapısı kuruldu. */
  | 'MAVI_INITIALIZED'
  /** Mavi GERÇEKTEN dinlemeye hazır. */
  | 'MAVI_LISTEN_CAPABLE'
  /** Mevcut `__APP_READY__` — İKİNCİ bayrak kurulmadı, o an damgalanır. */
  | 'BACKGROUND_COMPLETE';

const MILESTONE_IDS: readonly BootMilestone[] = Object.freeze([
  'PROCESS_STARTED', 'FIRST_FRAME', 'SHELL_INTERACTIVE',
  'VEHICLE_CORE_INITIALIZED', 'VEHICLE_DATA_FIRST_OBSERVATION',
  'MEDIA_AUTHORITY_INITIALIZED', 'MEDIA_AUTHORITY_AVAILABLE',
  'NAV_RUNTIME_INITIALIZED', 'NAV_LOCATION_AVAILABLE',
  'MAVI_INITIALIZED', 'MAVI_LISTEN_CAPABLE', 'BACKGROUND_COMPLETE',
]);

export interface BootMilestoneRow {
  readonly milestone: BootMilestone;
  /** Monotonik damga (`performance.now()`); ölçülmediyse `null`. */
  readonly observedAt: number | null;
  /** `PROCESS_STARTED`tan geçen süre; taban veya damga yoksa `null`. */
  readonly elapsedMs: number | null;
  readonly status: 'OBSERVED' | 'NOT_OBSERVED';
  readonly provenance: string | null;
}

/** Kilometre taşı damgaları — sabit anahtarlı, tavanlı, tahsissiz sıcak yol. */
const _milestoneAt: Record<BootMilestone, number | null> = (() => {
  const out = {} as Record<BootMilestone, number | null>;
  for (const id of MILESTONE_IDS) out[id] = null;
  return out;
})();
const _milestoneSrc: Record<BootMilestone, string | null> = (() => {
  const out = {} as Record<BootMilestone, string | null>;
  for (const id of MILESTONE_IDS) out[id] = null;
  return out;
})();

function _monoNow(): number | null {
  try {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now() : null;
  } catch { return null; }
}

/**
 * Kilometre taşını damgalar — **İLK çağrı kazanır**.
 *
 * Yeniden giriş (re-entry) koruması bilinçlidir: `PROCESS_STARTED` iki kez
 * çağrılırsa ikinci çağrı taşı İLERİ ATAR ve tüm `elapsedMs` değerleri
 * küçülürdü — ölçüm sessizce yalan söylerdi.
 *
 * ASLA throw etmez ve ölçüm alınamazsa hiçbir şey yazmaz.
 */
export function markBootMilestone(m: BootMilestone, provenance: string): void {
  try {
    if (_milestoneAt[m] !== null) return;      // ilk damga kazanır
    const t = _monoNow();
    if (t === null) return;                    // saat yok → sahte 0 YAZILMAZ
    _milestoneAt[m] = t;
    _milestoneSrc[m] = provenance;
    /* Gözlemciler damgadan SONRA çağrılır: bir dinleyici `hasBootMilestone`
       sorarsa taşı DÜŞMÜŞ görmelidir. Her dinleyici ayrı try/catch —
       biri düşerse diğerleri ve damga ETKİLENMEZ. */
    for (const fn of _milestoneListeners) {
      try { fn(m); } catch { /* dinleyici hatası ölçümü bozmaz */ }
    }
  } catch { /* ölçüm hatası ürünü bozmaz */ }
}

/** Damga alındı mı (idempotent çağıranlar için ucuz kontrol). */
export function hasBootMilestone(m: BootMilestone): boolean {
  return _milestoneAt[m] !== null;
}

/* ── Kilometre taşı gözlemcileri (ARCH-06/F2) ───────────────────────────────
   Bu kaydedici HÂLÂ hiçbir şey YÜRÜTMEZ: yalnız "taş düştü" der. İşi kimin
   yapacağına `SystemBoot` karar verir (`boot/bootDeferral`). Gözlemci listesi
   olmasaydı, erteleme runtime'ı ya kendi rAF döngüsünü kurardı (ikinci
   gözlemci) ya da yoklama yapardı (timer farmı) — ikisi de F0'ın açıkça
   yasakladığı desenlerdir. */
type MilestoneListener = (m: BootMilestone) => void;
const MAX_MILESTONE_LISTENERS = 8;
const _milestoneListeners = new Set<MilestoneListener>();

/**
 * Taş düştüğünde haber alır. Abonelik SINIRLIDIR (tavan 8) — sınırsız
 * dinleyici, ölçüm katmanını sessiz bir olay veri yoluna çevirirdi.
 *
 * @returns aboneliği söken thunk (zero-leak)
 */
export function onBootMilestone(fn: MilestoneListener): () => void {
  if (_milestoneListeners.size >= MAX_MILESTONE_LISTENERS) return () => { /* tavan */ };
  _milestoneListeners.add(fn);
  return () => { _milestoneListeners.delete(fn); };
}

/* ── Servis seviyesinde başlangıç süreleri ──────────────────────────────── */

export type BootServiceOutcome = 'STARTED' | 'FAILED' | 'ABORTED' | 'SKIPPED' | 'UNKNOWN';

export interface BootServiceTiming {
  readonly serviceId: string;
  readonly wave: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly durationMs: number | null;
  readonly outcome: BootServiceOutcome;
  /** Boot dizisi bu servisi BEKLEDİ mi (`await`) yoksa ateşle-unut mu. */
  readonly blocking: boolean;
}

/**
 * Servis satırı tavanı. Boot bir kez koşar; tavan sınırsız büyümeyi yapısal
 * olarak imkânsız kılar (zero-leak).
 */
const MAX_SERVICE_ROWS = 96;
let _services: BootServiceTiming[] = [];

/**
 * Bir servis başlatmasını ÖLÇER — çalıştırma sırasını DEĞİŞTİRMEZ.
 *
 * `fn` senkron ya da `Promise` dönebilir; ikisinde de gerçek başlangıç→bitiş
 * süresi ölçülür. `fn`in fırlattığı hata AYNEN yukarı taşınır: ölçüm katmanı
 * bir hatayı ASLA yutmaz (yutsaydı boot arızası ölçüm yüzünden gizlenirdi).
 */
export function measureBootService<T>(
  serviceId: string, wave: number, blocking: boolean, fn: () => T,
): T {
  const startedAt = _monoNow();
  const push = (finishedAt: number | null, outcome: BootServiceOutcome): void => {
    try {
      if (_services.length >= MAX_SERVICE_ROWS) return;
      _services.push(Object.freeze({
        serviceId, wave, startedAt, finishedAt,
        durationMs: startedAt !== null && finishedAt !== null
          ? Math.max(0, Math.round(finishedAt - startedAt)) : null,
        outcome, blocking,
      }));
    } catch { /* olcum hatasi yutulur - servis etkilenmez */ }
  };

  let result: T;
  try {
    result = fn();
  } catch (e) {
    push(_monoNow(), 'FAILED');
    throw e;                                   // hata AYNEN yukarı gider
  }

  if (result !== null && typeof result === 'object'
    && typeof (result as { then?: unknown }).then === 'function') {
    /* Asenkron: gerçek start→resolve ölçülür. Zincir DEĞİŞTİRİLMEZ —
       aynı promise geri döner, yalnız gözlemci takılır. */
    void (result as unknown as Promise<unknown>).then(
      () => push(_monoNow(), 'STARTED'),
      () => push(_monoNow(), 'FAILED'),
    );
    return result;
  }

  push(_monoNow(), 'STARTED');
  return result;
}

/** Ölçülemeyen/atlanan bir servisi dürüstçe kaydeder. */
export function recordBootServiceOutcome(
  serviceId: string, wave: number, outcome: BootServiceOutcome,
): void {
  try {
    if (_services.length >= MAX_SERVICE_ROWS) return;
    _services.push(Object.freeze({
      serviceId, wave, startedAt: null, finishedAt: null,
      durationMs: null, outcome, blocking: false,
    }));
  } catch { /* yut */ }
}

export interface BootMilestoneSnapshot {
  readonly milestones: readonly BootMilestoneRow[];
  readonly services: readonly BootServiceTiming[];
  /** Ölçülen taş adedi / toplam — LAB "kaçı ölçüldü" der, sahte tam göstermez. */
  readonly observedCount: number;
  readonly totalCount: number;
  readonly provenance: readonly string[];
}

/** Salt-okunur projeksiyon. Hiçbir sayacı sıfırlamaz, hiçbir şey başlatmaz. */
export function getBootMilestoneSnapshot(): BootMilestoneSnapshot {
  const base = _milestoneAt.PROCESS_STARTED;
  const rows: BootMilestoneRow[] = [];
  let observed = 0;
  for (const id of MILESTONE_IDS) {
    const at = _milestoneAt[id];
    if (at !== null) observed += 1;
    rows.push(Object.freeze({
      milestone: id,
      observedAt: at,
      elapsedMs: at !== null && base !== null ? Math.max(0, Math.round(at - base)) : null,
      status: at !== null ? ('OBSERVED' as const) : ('NOT_OBSERVED' as const),
      provenance: _milestoneSrc[id],
    }));
  }
  return Object.freeze({
    milestones: Object.freeze(rows),
    services: Object.freeze([..._services]),
    observedCount: observed,
    totalCount: MILESTONE_IDS.length,
    provenance: Object.freeze([
      'bootTimingRecorder.markBootMilestone()',
      'bootTimingRecorder.measureBootService()',
    ]),
  });
}

/** Kapalı kilometre taşı listesi (test ve LAB için). */
export function bootMilestoneIds(): readonly BootMilestone[] { return MILESTONE_IDS; }

/** @internal testler için. */
export function _resetBootMilestonesForTest(): void {
  for (const id of MILESTONE_IDS) { _milestoneAt[id] = null; _milestoneSrc[id] = null; }
  _services = [];
  _milestoneListeners.clear();
}

/** @internal testler için. */
export function _resetBootTimingForTest(): void {
  resetBootTiming();
  _resetBootMilestonesForTest();
}
