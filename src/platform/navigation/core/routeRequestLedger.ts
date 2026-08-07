/**
 * routeRequestLedger.ts — Rota isteklerinin yaşam döngüsü ve gecikme defteri.
 *
 * Timer YOK · React YOK · ağ YOK. Saat DIŞARIDAN gelir (`nowMs`) — bu modül
 * `Date.now`/`performance.now` OKUMAZ, böylece testler deterministiktir.
 * Modül düzeyinde yalnız sayaç/kayıt tutar (mevcut `offlineRoutingStatus.ts`
 * deseninin aynısı) — YENİ bir global store KURULMAZ.
 *
 * ── ÇÖZDÜĞÜ ARIZA ───────────────────────────────────────────────────────────
 * `fetchRoute` bugüne kadar KİMLİKSİZDİ: iki istek yarışırsa hangisi SONRA
 * biterse store'u o yazıyordu. Yani ESKİ bir yanıt, aracın güncel konumundan
 * hesaplanmış YENİ rotayı sessizce ezebiliyordu. Sapma anında bu, "rota
 * saçmaladı" olarak görünür. Bir "generation" sayacı bunu kapatır:
 * **yalnız en güncel isteğin yanıtı uygulanabilir.**
 */

export type RouteRequestKind = 'INITIAL' | 'REROUTE' | 'MANUAL';

export type RouteRequestOutcome =
  | 'PENDING'
  | 'COMMITTED'
  | 'REJECTED_STALE'
  | 'REJECTED_INVALID'
  | 'SUPERSEDED'
  | 'FAILED';

export interface RouteRequestRecord {
  readonly id: number;
  readonly kind: RouteRequestKind;
  readonly startedAtMs: number;
  readonly respondedAtMs: number | null;
  readonly committedAtMs: number | null;
  readonly outcome: RouteRequestOutcome;
  readonly provider: string | null;
}

/** Sapmadan ilk yeni talimata kadar geçen sürenin ayrıştırılmış ölçümü. */
export interface RerouteLatency {
  readonly offRouteDetectedAtMs: number | null;
  readonly requestStartedAtMs: number | null;
  readonly responseReceivedAtMs: number | null;
  readonly routeCommittedAtMs: number | null;
  readonly firstNewInstructionAtMs: number | null;
  /** Türetilmiş toplam (ms) — uçlardan biri yoksa null. */
  readonly detectToCommitMs: number | null;
  readonly detectToFirstInstructionMs: number | null;
  readonly requestToResponseMs: number | null;
}

const EMPTY_LATENCY: RerouteLatency = Object.freeze({
  offRouteDetectedAtMs: null,
  requestStartedAtMs: null,
  responseReceivedAtMs: null,
  routeCommittedAtMs: null,
  firstNewInstructionAtMs: null,
  detectToCommitMs: null,
  detectToFirstInstructionMs: null,
  requestToResponseMs: null,
});

/* ── Durum ────────────────────────────────────────────────────────────────── */

const MAX_HISTORY = 12;

let _seq = 0;
let _currentId = 0;
let _current: RouteRequestRecord | null = null;
const _history: RouteRequestRecord[] = [];

let _committedCount = 0;
let _staleRejected  = 0;
let _invalidRejected = 0;
let _supersededCount = 0;
let _failedCount     = 0;
let _suppressedCount = 0;

let _latency: RerouteLatency = EMPTY_LATENCY;
let _lastCompletedLatency: RerouteLatency = EMPTY_LATENCY;

function _push(rec: RouteRequestRecord): void {
  _history.unshift(rec);
  if (_history.length > MAX_HISTORY) _history.length = MAX_HISTORY;
}

/**
 * Sapma DOĞRULANDI — gecikme ölçümünün T0'ı.
 * Reroute isteği henüz başlamadı; bu ayrım "tespit gecikmesi" ile "ağ
 * gecikmesi"ni birbirinden ayırmayı mümkün kılar.
 */
export function markOffRouteDetected(nowMs: number): void {
  _latency = { ...EMPTY_LATENCY, offRouteDetectedAtMs: nowMs };
}

/**
 * Yeni bir rota isteği başlat. Uçuşta kalan istek varsa SUPERSEDED işaretlenir
 * — yanıtı gelse bile uygulanamaz.
 */
export function beginRouteRequest(kind: RouteRequestKind, nowMs: number): number {
  if (_current && _current.outcome === 'PENDING') {
    const superseded: RouteRequestRecord = { ..._current, outcome: 'SUPERSEDED' };
    _supersededCount++;
    _push(superseded);
  }
  _seq += 1;
  _currentId = _seq;
  _current = {
    id: _currentId, kind, startedAtMs: nowMs,
    respondedAtMs: null, committedAtMs: null,
    outcome: 'PENDING', provider: null,
  };
  if (kind === 'REROUTE') {
    _latency = { ..._latency, requestStartedAtMs: nowMs };
  }
  return _currentId;
}

/** Bu istek hâlâ en güncel mi? `false` → yanıtı UYGULANAMAZ. */
export function isCurrentRequest(id: number): boolean {
  return id === _currentId && _current !== null && _current.outcome === 'PENDING';
}

/* `currentRequestId()` KALDIRILDI (2026-08-03 hazırlık denetimi): hiçbir yerde
 * çağrılmıyordu. Aktif istek kimliği zaten `getRouteRequestSnapshot().currentId`
 * ile okunuyor; iki ayrı okuma yolu tutmak gereksiz yüzey ve sapma riskiydi. */

/** Sağlayıcıdan yanıt geldi (henüz uygulanmadı). */
export function recordResponse(id: number, nowMs: number, provider: string | null): void {
  if (_current && _current.id === id) {
    _current = { ..._current, respondedAtMs: nowMs, provider };
    if (_current.kind === 'REROUTE') {
      _latency = {
        ..._latency,
        responseReceivedAtMs: nowMs,
        requestToResponseMs: _latency.requestStartedAtMs != null
          ? nowMs - _latency.requestStartedAtMs : null,
      };
    }
  }
}

/** Rota store'a UYGULANDI. */
export function recordCommit(id: number, nowMs: number, provider: string | null): void {
  if (!_current || _current.id !== id) return;
  const rec: RouteRequestRecord = {
    ..._current, committedAtMs: nowMs, outcome: 'COMMITTED',
    provider: provider ?? _current.provider,
  };
  _committedCount++;
  _current = rec;
  _push(rec);
  if (rec.kind === 'REROUTE') {
    _latency = {
      ..._latency,
      routeCommittedAtMs: nowMs,
      detectToCommitMs: _latency.offRouteDetectedAtMs != null
        ? nowMs - _latency.offRouteDetectedAtMs : null,
    };
  }
}

/** Yeni rotanın İLK talimatı üretildi — sürücünün gerçekten yardım aldığı an. */
export function markFirstNewInstruction(nowMs: number): void {
  if (_latency.firstNewInstructionAtMs != null) return; // ilk olan kalır
  if (_latency.routeCommittedAtMs == null) return;      // commit yoksa anlamsız
  _latency = {
    ..._latency,
    firstNewInstructionAtMs: nowMs,
    detectToFirstInstructionMs: _latency.offRouteDetectedAtMs != null
      ? nowMs - _latency.offRouteDetectedAtMs : null,
  };
  _lastCompletedLatency = _latency;
}

/** Yanıt geldi ama artık güncel değil — UYGULANMADI. */
export function recordStaleRejected(id: number): void {
  _staleRejected++;
  const base = _current && _current.id === id ? _current : null;
  if (base) { _current = { ...base, outcome: 'REJECTED_STALE' }; _push(_current); }
}

/** Rota doğrulama kapısından geçemedi — UYGULANMADI. */
export function recordInvalidRejected(id: number): void {
  _invalidRejected++;
  if (_current && _current.id === id) {
    _current = { ..._current, outcome: 'REJECTED_INVALID' };
    _push(_current);
  }
}

/** Tüm sağlayıcılar düştü. */
export function recordFailure(id: number): void {
  _failedCount++;
  if (_current && _current.id === id) {
    _current = { ..._current, outcome: 'FAILED' };
    _push(_current);
  }
}

/** Aynı sapma için tekrar istek bastırıldı (request storm koruması). */
export function recordSuppressedDuplicate(): void {
  _suppressedCount++;
}

/* ── DOĞRULANMIŞ SAPMA NEDEN ROTAYA DÖNÜŞMEDİ (kütük #402) ──────────────────
 * SAHADA: `CONFIRMED_OFF_ROUTE` %17,5, `isRerouting` %0,0 — arada ne olduğunu
 * söyleyen HİÇBİR KAYIT yoktu. Karar ile aksiyon arasındaki boşluk artık
 * adlandırılır; "sessizce hiçbir şey olmadı" durumu üründen kaldırılır. */
export type RerouteBlockReason =
  | 'WEAK_ACCURACY'      // doğruluk aksiyon eşiğinin dışında
  | 'THROTTLED'          // istek fırtınası koruması penceresi
  | 'NO_CONTEXT'         // hedef/rota bağlamı yok
  | 'STRAIGHT_LINE'      // gerçek yol ağı olmayan rota (kuş uçuşu)
  | 'DR_POSITION';       // ölü hesap konumu — sapma kararı verilmez

let _blockedCount = 0;
let _lastBlock: { reason: RerouteBlockReason; tsMs: number } | null = null;
const _blockByReason: Record<RerouteBlockReason, number> = {
  WEAK_ACCURACY: 0, THROTTLED: 0, NO_CONTEXT: 0, STRAIGHT_LINE: 0, DR_POSITION: 0,
};

/** Doğrulanmış sapma vardı ama rota isteği ÇIKMADI — nedeniyle kaydedilir. */
export function recordRerouteBlocked(reason: RerouteBlockReason, tsMs: number): void {
  _blockedCount++;
  _blockByReason[reason]++;
  _lastBlock = { reason, tsMs };
}

export function getRerouteBlockStats(): {
  blockedCount: number;
  byReason: Readonly<Record<RerouteBlockReason, number>>;
  last: { reason: RerouteBlockReason; tsMs: number } | null;
} {
  return { blockedCount: _blockedCount, byReason: { ..._blockByReason }, last: _lastBlock };
}

export interface RouteRequestSnapshot {
  readonly currentId: number;
  readonly current: RouteRequestRecord | null;
  readonly history: readonly RouteRequestRecord[];
  readonly committedCount: number;
  readonly staleRejectedCount: number;
  readonly invalidRejectedCount: number;
  readonly supersededCount: number;
  readonly failedCount: number;
  readonly suppressedDuplicateCount: number;
  readonly latency: RerouteLatency;
  readonly lastCompletedLatency: RerouteLatency;
}

export function getRouteRequestSnapshot(): RouteRequestSnapshot {
  return {
    currentId: _currentId,
    current: _current,
    history: _history.slice(),
    committedCount: _committedCount,
    staleRejectedCount: _staleRejected,
    invalidRejectedCount: _invalidRejected,
    supersededCount: _supersededCount,
    failedCount: _failedCount,
    suppressedDuplicateCount: _suppressedCount,
    latency: _latency,
    lastCompletedLatency: _lastCompletedLatency,
  };
}

/** Navigasyon durunca defter temizlenir (sayaçlar oturum içi anlamlıdır). */
export function resetRouteRequestLedger(): void {
  _seq = 0; _currentId = 0; _current = null; _history.length = 0;
  _committedCount = 0; _staleRejected = 0; _invalidRejected = 0;
  _supersededCount = 0; _failedCount = 0; _suppressedCount = 0;
  _blockedCount = 0; _lastBlock = null;
  _blockByReason.WEAK_ACCURACY = 0; _blockByReason.THROTTLED = 0;
  _blockByReason.NO_CONTEXT = 0; _blockByReason.STRAIGHT_LINE = 0; _blockByReason.DR_POSITION = 0;
  _latency = EMPTY_LATENCY; _lastCompletedLatency = EMPTY_LATENCY;
}

export const REQUEST_OUTCOME_LABEL: Readonly<Record<RouteRequestOutcome, string>> = {
  PENDING:          'BEKLİYOR',
  COMMITTED:        'UYGULANDI',
  REJECTED_STALE:   'BAYAT — UYGULANMADI',
  REJECTED_INVALID: 'DOĞRULAMA DÜŞTÜ — UYGULANMADI',
  SUPERSEDED:       'YENİSİ GELDİ — İPTAL',
  FAILED:           'BAŞARISIZ',
} as const;
