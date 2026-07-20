/**
 * maviCore/latencyTelemetry.ts — MAVİ ÇEKİRDEĞİ Faz-1 · Gecikme TELEMETRİSİ.
 *
 * AMAÇ ("kullanıcı hiçbir aşamada sessizlikte kalmasın"): Sesli etkileşim boru hattının kritik
 * geçişlerini MONOTONİK saatle ölçer, dört segmenti türetir:
 *   1) wake → listening          (uyandırma → mikrofon açık)
 *   2) speechEnd → planStart      (konuşma bitti → planlama başladı)
 *   3) planStart → firstAction    (plan → ilk aksiyon)
 *   4) firstAction → complete     (ilk aksiyon → tamamlanma)
 *
 * TASARIM İLKELERİ (CLAUDE.md §4 clock-jump koruması · aiCore/voiceDiag deseni):
 *  - MONOTONİK: süreler performance.now farklarından hesaplanır (duvar-saati sıçraması sonuçları
 *    bozmaz). Enjekte edilebilir `now` ile tam test edilebilir.
 *  - TIMER YOK: yavaş-aşama tespiti mark() anında (önceki işaretten delta) yapılır; "bekleme
 *    sırasında takılma" için `sinceLastMark()` sorgusu sunulur (harici watchdog kullanabilir —
 *    bu modül sürekli loop KURMAZ).
 *  - PII YOK: yalnız marker adı + süre. Transcript/konum/kimlik TAŞINMAZ.
 *  - BOUNDED: tamamlanan oturum segmentleri sabit tavanlı ring'te tutulur.
 *  - İDEMPOTENT · fail-soft: bozuk marker/saat güvenli yok sayılır; asla throw etmez.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Kontratlar
 * ════════════════════════════════════════════════════════════════════════ */

export type LatencyMarker =
  | 'wake'
  | 'listening'
  | 'speechEnd'
  | 'planStart'
  | 'firstAction'
  | 'complete';

const VALID_MARKERS: ReadonlySet<string> = new Set<LatencyMarker>([
  'wake', 'listening', 'speechEnd', 'planStart', 'firstAction', 'complete',
]);

/** Türetilen segment süreleri (ms). Gerekli iki marker yoksa alan undefined kalır. */
export interface LatencySegments {
  readonly wakeToListening?: number;
  readonly speechEndToPlan?: number;
  readonly planToFirstAction?: number;
  readonly firstActionToComplete?: number;
  /** wake → complete uçtan uca toplam (her iki marker varsa). */
  readonly total?: number;
}

export interface SessionLatency {
  readonly sessionId: number;
  readonly segments: LatencySegments;
  /** Oturumun kapatıldığı an (monotonik). */
  readonly at: number;
}

/** Yavaş-aşama olayı — bir geçiş eşiği aştığında (kullanıcı sessizce bekliyor). */
export interface SlowStageEvent {
  readonly fromMarker: LatencyMarker;
  readonly toMarker: LatencyMarker;
  readonly ms: number;
  readonly sessionId: number;
}

export interface LatencyTrackerDeps {
  /** Monotonik saat. Varsayılan performance.now → Date.now. */
  readonly now?: () => number;
  /** Tamamlanan oturum ring tavanı. Varsayılan 20. */
  readonly maxSessions?: number;
  /** Ardışık iki marker arası bu süreyi aşarsa onSlowStage tetiklenir (ms). Varsayılan 1200. */
  readonly stageThresholdMs?: number;
  /** Yavaş aşama bildirimi (senkron · yalnız ÖLÇÜM — TTS/UI bağlama YOK). */
  readonly onSlowStage?: (e: SlowStageEvent) => void;
}

/* ══════════════════════════════════════════════════════════════════════════
 * İzleyici
 * ════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_MAX_LATENCY_SESSIONS = 20;
export const DEFAULT_STAGE_THRESHOLD_MS = 1_200;

export class MaviLatencyTracker {
  private readonly _now: () => number;
  private readonly _maxSessions: number;
  private readonly _stageThresholdMs: number;
  private readonly _onSlowStage?: (e: SlowStageEvent) => void;

  private _sessionId = 0;
  private _marks = new Map<LatencyMarker, number>();
  private _lastMarker: LatencyMarker | null = null;
  private _lastMarkAt = -1;
  private readonly _ring: SessionLatency[] = [];

  constructor(deps: LatencyTrackerDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : defaultNow;
    this._maxSessions = typeof deps.maxSessions === 'number' && deps.maxSessions > 0
      ? Math.floor(deps.maxSessions) : DEFAULT_MAX_LATENCY_SESSIONS;
    this._stageThresholdMs = typeof deps.stageThresholdMs === 'number' && deps.stageThresholdMs >= 0
      ? deps.stageThresholdMs : DEFAULT_STAGE_THRESHOLD_MS;
    this._onSlowStage = typeof deps.onSlowStage === 'function' ? deps.onSlowStage : undefined;
  }

  /** Yeni oturum başlat (işaretleri temizler). sessionId lifecycle ile hizalanabilir. */
  beginSession(sessionId: number): void {
    this._sessionId = typeof sessionId === 'number' && Number.isFinite(sessionId) ? sessionId : 0;
    this._marks = new Map();
    this._lastMarker = null;
    this._lastMarkAt = -1;
  }

  /**
   * Bir marker'ı şu ana damgala. Aynı marker tekrar gelirse İLK değer korunur (ilk gerçekleşme
   * anı anlamlıdır). Önceki marker'dan delta eşiği aşarsa onSlowStage tetiklenir.
   */
  mark(marker: LatencyMarker): void {
    if (!VALID_MARKERS.has(marker)) return; // bozuk marker fail-soft yok sayılır
    const now = this._safeNow();
    if (this._marks.has(marker)) return;    // ilk gerçekleşme korunur
    this._marks.set(marker, now);

    if (this._lastMarker !== null && this._lastMarkAt >= 0) {
      const delta = now - this._lastMarkAt;
      if (delta > this._stageThresholdMs && this._onSlowStage) {
        try {
          this._onSlowStage(Object.freeze({
            fromMarker: this._lastMarker, toMarker: marker, ms: delta, sessionId: this._sessionId,
          }));
        } catch { /* dinleyici hatası ölçümü bozmaz */ }
      }
    }
    this._lastMarker = marker;
    this._lastMarkAt = now;
  }

  /** Mevcut oturumun türetilmiş segmentleri (eksik marker → ilgili alan undefined). */
  segments(): LatencySegments {
    return deriveSegments(this._marks);
  }

  /** Son işaretten bu yana geçen süre (ms); hiç işaret yoksa -1. Harici watchdog "takılma" için. */
  sinceLastMark(): number {
    if (this._lastMarkAt < 0) return -1;
    return Math.max(0, this._safeNow() - this._lastMarkAt);
  }

  /** Mevcut oturumu kapat: segmentleri bounded ring'e yaz, işaretleri temizle. */
  endSession(): SessionLatency {
    const entry: SessionLatency = Object.freeze({
      sessionId: this._sessionId,
      segments: deriveSegments(this._marks),
      at: this._safeNow(),
    });
    this._ring.push(entry);
    if (this._ring.length > this._maxSessions) {
      this._ring.splice(0, this._ring.length - this._maxSessions);
    }
    this._marks = new Map();
    this._lastMarker = null;
    this._lastMarkAt = -1;
    return entry;
  }

  /** Son tamamlanan oturum segmentleri (en eski → en yeni). */
  recent(): readonly SessionLatency[] {
    return this._ring.slice();
  }

  /** Tümünü temizle (idempotent — dispose/restart için). */
  reset(): void {
    this._marks = new Map();
    this._lastMarker = null;
    this._lastMarkAt = -1;
    this._ring.length = 0;
    this._sessionId = 0;
  }

  private _safeNow(): number {
    try {
      const t = this._now();
      return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    } catch { return 0; }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}

function diff(marks: Map<LatencyMarker, number>, a: LatencyMarker, b: LatencyMarker): number | undefined {
  const ta = marks.get(a);
  const tb = marks.get(b);
  if (ta === undefined || tb === undefined) return undefined;
  const d = tb - ta;
  return d >= 0 ? d : undefined; // negatif (saat anomalisi/sıra dışı) → yok say
}

/** İşaret haritasından dört segmenti + toplamı türetir (SAF). */
export function deriveSegments(marks: Map<LatencyMarker, number>): LatencySegments {
  return Object.freeze({
    wakeToListening: diff(marks, 'wake', 'listening'),
    speechEndToPlan: diff(marks, 'speechEnd', 'planStart'),
    planToFirstAction: diff(marks, 'planStart', 'firstAction'),
    firstActionToComplete: diff(marks, 'firstAction', 'complete'),
    total: diff(marks, 'wake', 'complete'),
  });
}

/** Fabrika — DI ile izleyici. Import yan etkisizdir. */
export function createLatencyTracker(deps: LatencyTrackerDeps = {}): MaviLatencyTracker {
  return new MaviLatencyTracker(deps);
}
