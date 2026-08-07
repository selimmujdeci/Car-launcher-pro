/**
 * tripUploadCoordinator.ts — TRIP YÜKLEMENİN TEK OTORİTESİ (SAF DURUM MAKİNESİ).
 *
 * ── §5 SÖZLEŞME ───────────────────────────────────────────────────────
 * Trip **anlık yüklenmez**. Yolculuk BİTTİĞİNDE tek bir kanonik özet
 * üretilir ve mevcut at-least-once kuyruğuna (`connectivityService`) TEK
 * kalem olarak verilir. Retry · backoff · dedupe **o kuyruğun** mevcut
 * davranışıdır ve DEĞİŞTİRİLMEZ — bu koordinatör onun ÜSTÜNDE durur:
 * neyin, kaç kez, hangi revizyonla gideceğine karar verir.
 *
 * ── NEDEN AYRI OTORİTE ────────────────────────────────────────────────
 * Trip verisi yüksek değerli ve TEKRARA DUYARLIDIR: aynı yolculuk iki kez
 * yüklenirse Fleet Reports mesafeyi ikiye katlar, Cost Analysis maliyeti
 * şişirir, Driver DNA skoru bozar. Bu yüzden dedupe **istemcide** (tripKey)
 * ve **sunucuda** (unique kısıt) iki kez uygulanır.
 *
 * ── §6 REVİZYON ───────────────────────────────────────────────────────
 * Aynı `tripKey` için yeniden gönderim `revision`'ı artırır. Sunucu daha
 * yüksek revizyonu KABUL eder (düzeltme), aynı/daha düşüğü REDDEDER
 * (tekrar). Böylece "hiç yükleme kaybetme" ile "asla iki kez sayma"
 * birlikte sağlanır.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 * Zaman ve ağ DIŞARIDAN verilir.
 */

import type { TripSummary } from './tripCanonicalModel';

/* ── Yükleme durumu ────────────────────────────────────────────────────── */

export const UPLOAD_STATES = [
  'IDLE',        // kuyruğa girmedi
  'QUEUED',      // kuyruğa verildi, sonuç bekleniyor
  'UPLOADED',    // sunucu kabul etti
  'DUPLICATE',   // sunucu tekrar olarak reddetti (BAŞARI sayılır)
  'RETRY_WAIT',  // geçici hata, kuyrukta bekliyor
  'FAILED',      // deneme bütçesi tükendi
] as const;
export type UploadState = (typeof UPLOAD_STATES)[number];

/** Yükleme denemesi bütçesi — sonsuz retry YOK (batarya + sunucu yükü). */
export const MAX_TRIP_UPLOAD_ATTEMPTS = 5;

/* ── Sunucu yanıtı ─────────────────────────────────────────────────────── */

export const TRIP_ACK_STATES = ['CREATED', 'UPDATED', 'DUPLICATE', 'REJECTED'] as const;
export type TripAckState = (typeof TRIP_ACK_STATES)[number];

export interface TripUploadAck {
  readonly state: TripAckState | 'UNKNOWN';
  /** Sunucudaki revizyon. Bilinmiyorsa `null` (uydurma 1 YASAK). */
  readonly serverRevision: number | null;
  readonly reason: string | null;
}

/** RPC yanıtını güvenle daraltır — beklenmeyen alanlar YOK SAYILIR. */
export function parseTripAck(raw: unknown): TripUploadAck {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = String(o.state ?? '');
  const rev = o.serverRevision ?? o.revision;
  return {
    state: (TRIP_ACK_STATES as readonly string[]).includes(s)
      ? (s as TripAckState) : 'UNKNOWN',
    serverRevision:
      typeof rev === 'number' && Number.isFinite(rev) && Number.isInteger(rev) && rev >= 0
        ? rev : null,
    reason: typeof o.reason === 'string' && o.reason.length > 0 ? o.reason : null,
  };
}

/* ── Kayıt defteri ─────────────────────────────────────────────────────── */

/** Bir trip'in yükleme defteri kaydı. */
export interface TripUploadEntry {
  readonly tripKey: string;
  readonly tripId: string;
  readonly state: UploadState;
  readonly revision: number;
  readonly attempts: number;
  /** Sunucunun bildirdiği revizyon; bilinmiyorsa `null`. */
  readonly serverRevision: number | null;
  readonly lastAckState: TripAckState | 'UNKNOWN' | null;
  readonly lastFailureReason: string | null;
  /** Epoch ms; hiç olmadıysa `null` (uydurma tarih YOK). */
  readonly lastAttemptAtMs: number | null;
  readonly lastSuccessAtMs: number | null;
  readonly lastFailureAtMs: number | null;
}

export interface UploadDecision {
  /** Kuyruğa verilmeli mi. */
  readonly shouldEnqueue: boolean;
  /** Verilecekse hangi revizyonla. */
  readonly revision: number;
  /** Verilmeyecekse gerekçe — sessiz atlama YOK. */
  readonly skipReason: UploadSkipReason | null;
}

export type UploadSkipReason =
  | 'NOT_COMPLETED'      // trip henüz kapanmadı
  | 'ALREADY_UPLOADED'   // sunucu kabul etti
  | 'ALREADY_DUPLICATE'  // sunucu tekrar dedi (yeniden denemek anlamsız)
  | 'IN_FLIGHT'          // kuyrukta bekliyor
  | 'BUDGET_EXHAUSTED'   // deneme bütçesi doldu
  | 'NO_DISTANCE';       // ölçülebilir mesafe yok → yüklemeye değmez

/* ── Koordinatör ───────────────────────────────────────────────────────── */

export interface TripUploadSnapshot {
  readonly entries: readonly TripUploadEntry[];
  readonly queuedCount: number;
  readonly uploadedCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
  readonly retryCount: number;
  readonly lastSuccessAtMs: number | null;
  readonly lastFailureAtMs: number | null;
}

const EMPTY_SNAPSHOT: TripUploadSnapshot = Object.freeze({
  entries: [], queuedCount: 0, uploadedCount: 0, duplicateCount: 0,
  failedCount: 0, retryCount: 0, lastSuccessAtMs: null, lastFailureAtMs: null,
});

/**
 * Trip yükleme defteri.
 *
 * Ağ çağrısı YAPMAZ; yalnız "ne gönderilmeli" kararını verir ve sonucu
 * kaydeder. Gerçek gönderim `tripUploadRuntime` tarafından kuyruğa yapılır.
 */
export class TripUploadCoordinator {
  private readonly _ledger = new Map<string, TripUploadEntry>();
  private _retryCount = 0;
  private _lastSuccessAtMs: number | null = null;
  private _lastFailureAtMs: number | null = null;

  /**
   * Bu özet kuyruğa verilmeli mi?
   *
   * Karar tamamen defter durumuna bakar; ağ durumuna BAKMAZ (çevrimdışıysa
   * kuyruk zaten bekletir — offline-first sözleşmesi).
   */
  decide(summary: TripSummary): UploadDecision {
    const existing = this._ledger.get(summary.tripKey);

    if (summary.state !== 'COMPLETED' && summary.state !== 'UPLOADED') {
      return { shouldEnqueue: false, revision: summary.revision, skipReason: 'NOT_COMPLETED' };
    }

    /* Ölçülebilir mesafesi olmayan trip Fleet'e bilgi EKLEMEZ. */
    const d = summary.metrics.distanceKm.value;
    if (d === null || d <= 0) {
      return { shouldEnqueue: false, revision: summary.revision, skipReason: 'NO_DISTANCE' };
    }

    if (existing !== undefined) {
      if (existing.state === 'UPLOADED') {
        return { shouldEnqueue: false, revision: existing.revision, skipReason: 'ALREADY_UPLOADED' };
      }
      if (existing.state === 'DUPLICATE') {
        return { shouldEnqueue: false, revision: existing.revision, skipReason: 'ALREADY_DUPLICATE' };
      }
      if (existing.state === 'QUEUED') {
        return { shouldEnqueue: false, revision: existing.revision, skipReason: 'IN_FLIGHT' };
      }
      if (existing.attempts >= MAX_TRIP_UPLOAD_ATTEMPTS) {
        return { shouldEnqueue: false, revision: existing.revision, skipReason: 'BUDGET_EXHAUSTED' };
      }
      /* Yeniden deneme: revizyon ARTAR (§6) — sunucu daha yükseği kabul eder. */
      return { shouldEnqueue: true, revision: existing.revision + 1, skipReason: null };
    }

    return { shouldEnqueue: true, revision: summary.revision, skipReason: null };
  }

  /** Kuyruğa verildi — defteri güncelle. */
  markQueued(summary: TripSummary, revision: number, nowMs: number): void {
    const prev = this._ledger.get(summary.tripKey);
    this._ledger.set(summary.tripKey, {
      tripKey: summary.tripKey,
      tripId: summary.tripId,
      state: 'QUEUED',
      revision,
      attempts: (prev?.attempts ?? 0) + 1,
      serverRevision: prev?.serverRevision ?? null,
      lastAckState: prev?.lastAckState ?? null,
      lastFailureReason: prev?.lastFailureReason ?? null,
      lastAttemptAtMs: nowMs,
      lastSuccessAtMs: prev?.lastSuccessAtMs ?? null,
      lastFailureAtMs: prev?.lastFailureAtMs ?? null,
    });
  }

  /**
   * Sunucu yanıtını kaydet.
   *
   * `DUPLICATE` **BAŞARI SAYILIR**: sunucuda veri zaten var, tekrar denemek
   * anlamsızdır. Bunu "hata" saymak sonsuz retry döngüsü üretir.
   */
  applyAck(tripKey: string, ack: TripUploadAck, nowMs: number): void {
    const prev = this._ledger.get(tripKey);
    if (prev === undefined) return;

    let state: UploadState;
    if (ack.state === 'CREATED' || ack.state === 'UPDATED') state = 'UPLOADED';
    else if (ack.state === 'DUPLICATE') state = 'DUPLICATE';
    else if (ack.state === 'REJECTED') state = 'FAILED';
    else state = prev.attempts >= MAX_TRIP_UPLOAD_ATTEMPTS ? 'FAILED' : 'RETRY_WAIT';

    const success = state === 'UPLOADED' || state === 'DUPLICATE';
    if (state === 'RETRY_WAIT') this._retryCount += 1;
    if (success) this._lastSuccessAtMs = nowMs;
    else this._lastFailureAtMs = nowMs;

    this._ledger.set(tripKey, {
      ...prev,
      state,
      serverRevision: ack.serverRevision ?? prev.serverRevision,
      lastAckState: ack.state,
      lastFailureReason: success ? null : (ack.reason ?? prev.lastFailureReason),
      lastSuccessAtMs: success ? nowMs : prev.lastSuccessAtMs,
      lastFailureAtMs: success ? prev.lastFailureAtMs : nowMs,
    });
  }

  /** Ağ/HTTP hatası — sunucu hükmü YOK, geçici sayılır. */
  applyTransportFailure(tripKey: string, nowMs: number): void {
    const prev = this._ledger.get(tripKey);
    if (prev === undefined) return;
    const exhausted = prev.attempts >= MAX_TRIP_UPLOAD_ATTEMPTS;
    if (!exhausted) this._retryCount += 1;
    this._lastFailureAtMs = nowMs;
    this._ledger.set(tripKey, {
      ...prev,
      state: exhausted ? 'FAILED' : 'RETRY_WAIT',
      lastFailureReason: 'TRANSPORT',
      lastFailureAtMs: nowMs,
    });
  }

  /** LAB salt-okur — ASLA fırlatmaz. */
  getSnapshot(): TripUploadSnapshot {
    try {
      const entries = [...this._ledger.values()];
      return {
        entries,
        queuedCount:    entries.filter((e) => e.state === 'QUEUED').length,
        uploadedCount:  entries.filter((e) => e.state === 'UPLOADED').length,
        duplicateCount: entries.filter((e) => e.state === 'DUPLICATE').length,
        failedCount:    entries.filter((e) => e.state === 'FAILED').length,
        retryCount:     this._retryCount,
        lastSuccessAtMs: this._lastSuccessAtMs,
        lastFailureAtMs: this._lastFailureAtMs,
      };
    } catch {
      return EMPTY_SNAPSHOT;
    }
  }

  getEntry(tripKey: string): TripUploadEntry | null {
    return this._ledger.get(tripKey) ?? null;
  }

  /**
   * Defteri kalıcı biçime çevirir (yeniden başlatmada dedupe hafızası
   * korunsun — aksi halde her açılışta tüm geçmiş yeniden yüklenir).
   */
  serialize(): readonly TripUploadEntry[] {
    return [...this._ledger.values()];
  }

  /** Kalıcı defteri geri yükler. Bozuk kayıt SESSİZCE atlanır. */
  hydrate(entries: unknown): void {
    if (!Array.isArray(entries)) return;
    for (const raw of entries) {
      try {
        const e = raw as TripUploadEntry;
        if (typeof e?.tripKey !== 'string' || e.tripKey.length === 0) continue;
        if (!(UPLOAD_STATES as readonly string[]).includes(e.state)) continue;
        this._ledger.set(e.tripKey, e);
      } catch { /* bozuk kayıt atlanır */ }
    }
  }
}
