/**
 * longRoadBlackBox.ts — BOUNDED OLAY PENCERESİ (görev §12) · SAF.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React yok.
 *
 * Kritik bir olay olduğunda olayın ÖNCESİ ve SONRASI dondurulur:
 *   · olay öncesi 60 sn  → halka tamponundan GERİYE dönük alınır
 *   · olay sonrası 120 sn → pencere AÇIK kalır, kareler biriktirilir
 *
 * ── PAZARLIKSIZ ────────────────────────────────────────────────────────────
 *  · Ham token, API anahtarı, TAM VIN, e-posta, tam konum dizisi SAKLANMAZ.
 *    Kare yalnız SAYISAL/ENUM alan taşır — koordinat, metin, kimlik YOKTUR.
 *  · Tampon SINIRLIDIR. Sınır aşılırsa en eski kare düşürülür ve `dropped`
 *    SAYILIR — sessiz kayıp YASAK (görev §12 `droppedRecords`).
 *  · `preWindowComplete` DÜRÜSTTÜR: yeterli geçmiş yoksa `false` yazılır,
 *    eksik pencere "tam" gibi sunulmaz.
 */

import type { Severity } from './longRoadModel';
import type { LongRoadSample } from './longRoadDetect';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Sınırlar
 * ════════════════════════════════════════════════════════════════════════ */

export const BB_PRE_MS = 60_000;
export const BB_POST_MS = 120_000;

/** Halka kapasitesi: (60 + 120) sn @ 1 Hz + pay. */
export const BB_RING_CAPACITY = 200;
/** Aynı anda AÇIK kalabilecek pencere sayısı (olay fırtınası koruması). */
export const BB_MAX_OPEN_WINDOWS = 3;
/** Tek pencerede tutulacak azami kare (pre + post). */
export const BB_MAX_WINDOW_FRAMES = 200;

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Kare — kanal başına TEK skaler (PII yok)
 * ════════════════════════════════════════════════════════════════════════ */

/** Üç durumlu bayrak sayısallaştırması: bilinmiyor `null`, 0/1 DEĞİL. */
function _b(v: boolean | null): 0 | 1 | null {
  return v === null ? null : v ? 1 : 0;
}

function _n(v: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/**
 * Tek zaman diliminin tüm kanalları. Alan sırası SABİTTİR (V8 hidden-class).
 * Kanal karşılıkları: obd* → OBD · loc* → GPS · online → connectivity ·
 * visible → lifecycle · mem/mode → thermal-memory · trip* → trip.
 */
export interface BlackBoxFrame {
  readonly t: number;
  readonly wall: number;
  readonly speed: number | null;
  readonly rpm: number | null;
  readonly engineTemp: number | null;
  readonly obdConn: 0 | 1 | null;
  readonly obdFresh: 0 | 1 | null;
  readonly obdAgeMs: number | null;
  readonly locState: string | null;
  readonly locAccM: number | null;
  readonly online: 0 | 1 | null;
  readonly visible: 0 | 1 | null;
  readonly mem: string | null;
  readonly mode: string | null;
  readonly tripActive: 0 | 1 | null;
}

export function frameFromSample(s: LongRoadSample): BlackBoxFrame {
  return {
    t: s.monoMs,
    wall: s.wallMs,
    speed: _n(s.speed),
    rpm: _n(s.rpm),
    engineTemp: _n(s.engineTemp),
    obdConn: _b(s.obdTransportConnected),
    obdFresh: _b(s.obdDataFresh),
    obdAgeMs: _n(s.obdLastPacketAgeMs),
    locState: s.locationState,
    locAccM: _n(s.locationAccuracyM),
    online: _b(s.online),
    visible: _b(s.appVisible),
    mem: s.memoryPressure,
    mode: s.runtimeMode,
    tripActive: _b(s.tripActive),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Halka tamponu
 * ════════════════════════════════════════════════════════════════════════ */

export interface Ring {
  readonly frames: readonly BlackBoxFrame[];
  readonly dropped: number;
  readonly capacity: number;
}

export function emptyRing(capacity = BB_RING_CAPACITY): Ring {
  return { frames: [], dropped: 0, capacity };
}

/** Kare ekler; kapasite dolduğunda EN ESKİ kare düşer ve SAYILIR. */
export function ringPush(ring: Ring, frame: BlackBoxFrame): Ring {
  if (ring.frames.length < ring.capacity) {
    return { frames: [...ring.frames, frame], dropped: ring.dropped, capacity: ring.capacity };
  }
  return {
    frames: [...ring.frames.slice(1), frame],
    dropped: ring.dropped + 1,
    capacity: ring.capacity,
  };
}

/** Halkanın kaç ms geçmişi tuttuğu — `preWindowComplete` hükmü buna dayanır. */
export function ringSpanMs(ring: Ring): number {
  if (ring.frames.length < 2) return 0;
  return ring.frames[ring.frames.length - 1].t - ring.frames[0].t;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Pencere
 * ════════════════════════════════════════════════════════════════════════ */

export interface BlackBoxWindow {
  readonly eventId: string;
  readonly eventType: string;
  readonly severity: Severity;
  readonly detectedAt: number;
  readonly detectedMono: number;
  readonly preFrames: readonly BlackBoxFrame[];
  readonly postFrames: readonly BlackBoxFrame[];
  readonly preWindowComplete: boolean;
  readonly postWindowComplete: boolean;
  readonly droppedRecords: number;
  /** Bu pencereyle ilişkili kanıt referansları (olay id'leri) — PII YOK. */
  readonly evidenceRefs: readonly string[];
}

/** Dışa aktarılan META — gövde ayrı saklanır (görev §12). */
export interface BlackBoxMeta {
  readonly eventId: string;
  readonly eventType: string;
  readonly severity: Severity;
  readonly detectedAt: number;
  readonly preWindowComplete: boolean;
  readonly postWindowComplete: boolean;
  readonly droppedRecords: number;
  readonly frameCount: number;
  readonly evidenceRefs: readonly string[];
}

export function windowMeta(w: BlackBoxWindow): BlackBoxMeta {
  return {
    eventId: w.eventId,
    eventType: w.eventType,
    severity: w.severity,
    detectedAt: w.detectedAt,
    preWindowComplete: w.preWindowComplete,
    postWindowComplete: w.postWindowComplete,
    droppedRecords: w.droppedRecords,
    frameCount: w.preFrames.length + w.postFrames.length,
    evidenceRefs: w.evidenceRefs,
  };
}

/**
 * Olay anında pencereyi AÇAR: `pre` kareler halkadan GERİYE dönük kopyalanır.
 *
 * `preWindowComplete` yalnız halkada GERÇEKTEN 60 sn'lik geçmiş varsa `true`
 * olur — oturumun ilk saniyelerinde açılan pencere dürüstçe eksik işaretlenir.
 */
export function openWindow(
  ring: Ring,
  eventId: string,
  eventType: string,
  severity: Severity,
  detectedAt: number,
  detectedMono: number,
  evidenceRefs: readonly string[] = [],
): BlackBoxWindow {
  const cutoff = detectedMono - BB_PRE_MS;
  const pre = ring.frames.filter((f) => f.t >= cutoff);
  const complete = ring.frames.length > 0 && ring.frames[0].t <= cutoff;

  return {
    eventId,
    eventType,
    severity,
    detectedAt,
    detectedMono,
    preFrames: pre.slice(-BB_MAX_WINDOW_FRAMES),
    postFrames: [],
    preWindowComplete: complete,
    postWindowComplete: false,
    droppedRecords: ring.dropped,
    evidenceRefs,
  };
}

/**
 * Pencereyi ilerletir. Post süresi dolduğunda pencere KAPANIR ve yeni kare
 * kabul etmez. Kare bütçesi dolarsa kayıt düşürülür ve SAYILIR.
 */
export function advanceWindow(w: BlackBoxWindow, frame: BlackBoxFrame): BlackBoxWindow {
  if (w.postWindowComplete) return w;

  const age = frame.t - w.detectedMono;
  if (age > BB_POST_MS) {
    return { ...w, postWindowComplete: true };
  }
  if (w.preFrames.length + w.postFrames.length >= BB_MAX_WINDOW_FRAMES) {
    return { ...w, droppedRecords: w.droppedRecords + 1 };
  }
  return { ...w, postFrames: [...w.postFrames, frame] };
}

/** Zaman geçtiği hâlde kare gelmezse pencere yine de kapanmalı. */
export function closeIfElapsed(w: BlackBoxWindow, nowMono: number): BlackBoxWindow {
  if (w.postWindowComplete) return w;
  return nowMono - w.detectedMono >= BB_POST_MS ? { ...w, postWindowComplete: true } : w;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Pencere kümesi yönetimi
 * ════════════════════════════════════════════════════════════════════════ */

export interface BlackBoxState {
  readonly ring: Ring;
  readonly open: readonly BlackBoxWindow[];
  readonly closed: readonly BlackBoxWindow[];
  /** Bütçe dolduğu için AÇILAMAYAN pencere sayısı — sessizce yutulmaz. */
  readonly refusedWindows: number;
}

export function emptyBlackBoxState(): BlackBoxState {
  return { ring: emptyRing(), open: [], closed: [], refusedWindows: 0 };
}

/** Kareyi hem halkaya hem AÇIK pencerelere işler. */
export function blackBoxTick(state: BlackBoxState, frame: BlackBoxFrame): BlackBoxState {
  const advanced = state.open.map((w) => advanceWindow(w, frame));
  const stillOpen = advanced.filter((w) => !w.postWindowComplete);
  const justClosed = advanced.filter((w) => w.postWindowComplete);

  return {
    ring: ringPush(state.ring, frame),
    open: stillOpen,
    closed: justClosed.length > 0 ? [...state.closed, ...justClosed] : state.closed,
    refusedWindows: state.refusedWindows,
  };
}

/**
 * Yeni pencere açar. AYNI olay tipi için hâlihazırda AÇIK pencere varsa yenisi
 * AÇILMAZ (olay fırtınasında çoğaltma yasağı — görev §11/§12 dedupe).
 */
export function blackBoxOpen(
  state: BlackBoxState,
  eventId: string,
  eventType: string,
  severity: Severity,
  detectedAt: number,
  detectedMono: number,
  maxTotal: number,
  evidenceRefs: readonly string[] = [],
): BlackBoxState {
  if (state.open.some((w) => w.eventType === eventType)) return state;
  if (state.open.length >= BB_MAX_OPEN_WINDOWS
      || state.open.length + state.closed.length >= maxTotal) {
    return { ...state, refusedWindows: state.refusedWindows + 1 };
  }
  const w = openWindow(state.ring, eventId, eventType, severity, detectedAt, detectedMono, evidenceRefs);
  return { ...state, open: [...state.open, w] };
}

/** Oturum bitişinde tüm açık pencereleri kapatır (eksik post dürüstçe işaretli). */
export function blackBoxFinalize(state: BlackBoxState, nowMono: number): BlackBoxState {
  const closedNow = state.open.map((w) => closeIfElapsed(w, nowMono))
    .map((w) => (w.postWindowComplete ? w : { ...w, postWindowComplete: false }));
  return { ring: state.ring, open: [], closed: [...state.closed, ...closedNow], refusedWindows: state.refusedWindows };
}

export function allWindows(state: BlackBoxState): readonly BlackBoxWindow[] {
  return [...state.closed, ...state.open];
}

export function blackBoxMetas(state: BlackBoxState): readonly BlackBoxMeta[] {
  return allWindows(state).map(windowMeta);
}
