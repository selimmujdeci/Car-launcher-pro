/**
 * musicUiPerf.ts — F1/F4 · Müzik yüzeyi zamanlama kanıtı (bounded, salt gözlem).
 *
 * Bu modül TIMER KURMAZ, playback durumu tutmaz ve hiçbir karara geri beslenmez.
 * Yalnız "ne kadar sürdü" sorusunu sabit bellekte cevaplar.
 *
 * DÜRÜSTLÜK: ölçülmemiş alan `null` kalır — sahte 0 üretilmez. Host (jsdom /
 * geliştirme makinesi) süresi CİHAZ performansı DEĞİLDİR; bu ayrım rapor ve LAB
 * tarafında açıkça korunur.
 */
const CAP = 64;
const projection = new Float64Array(CAP);
const miniCommit = new Float64Array(CAP);
const nowPlayingCommit = new Float64Array(CAP);
/** F4 · kuyruk yüzeyi ölçümleri. */
const queueProjection = new Float64Array(CAP);
const queueCommit = new Float64Array(CAP);
const queueRowRender = new Float64Array(CAP);

let projectionN = 0; let miniN = 0; let nowPlayingN = 0;
let queueProjectionN = 0; let queueCommitN = 0; let queueRowRenderN = 0;

let snapshotAt: number | null = null;
let interactionAt: number | null = null;
let artworkReadyAt: number | null = null;
/** Açılış gecikmesi İLK commit'te sabitlenir — sonra "açık kaldığı süre" olmaz. */
let nowPlayingOpenMs: number | null = null;

let queueInteractionAt: number | null = null;
let queueOpenMs: number | null = null;

let metadataChangedAt: number | null = null;
let metadataCommitMs: number | null = null;

/** Aynı açılış içinde kaç kez yeniden çizildi — gereksiz render teşhisi. */
let nowPlayingRenders = 0;
let queueRenders = 0;
/** Son kuyruk render'ında çizilen satır sayısı (pencere maliyeti bağlamı). */
let lastQueueRowCount: number | null = null;

function now(): number { try { return performance.now(); } catch { return Date.now(); } }
function push(buf: Float64Array, count: number, value: number): number { buf[count % CAP] = value; return count + 1; }
function percentile(buf: Float64Array, count: number, p: number): number | null {
  const n = Math.min(count, CAP); if (n === 0) return null;
  const copy = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  return copy[Math.min(n - 1, Math.ceil(n * p) - 1)] ?? null;
}

export interface MusicUiPerfSnapshot {
  readonly samples: Readonly<{
    projection: number; miniCommit: number; nowPlayingCommit: number;
    queueProjection: number; queueCommit: number; queueRowRender: number;
  }>;
  readonly p50Ms: Readonly<{
    projection: number | null; miniCommit: number | null; nowPlayingCommit: number | null;
    queueProjection: number | null; queueCommit: number | null; queueRowRender: number | null;
  }>;
  readonly p95Ms: Readonly<{
    projection: number | null; miniCommit: number | null; nowPlayingCommit: number | null;
    queueProjection: number | null; queueCommit: number | null; queueRowRender: number | null;
  }>;
  /** MiniPlayer dokunuşundan Now Playing'in İLK çiziminE kadar (sabitlenmiş). */
  readonly nowPlayingOpenMs: number | null;
  readonly artworkReadyAfterOpenMs: number | null;
  /** Kuyruk açma dokunuşundan kuyruğun İLK çiziminE kadar. */
  readonly queueOpenMs: number | null;
  /** Metadata değişiminden ekrana yansımasına kadar. */
  readonly metadataCommitMs: number | null;
  readonly nowPlayingRenders: number;
  readonly queueRenders: number;
  readonly lastQueueRowCount: number | null;
}

export function markMusicSnapshotReceived(): void { snapshotAt = now(); }
export function recordMusicProjection(startedAt: number): void {
  projectionN = push(projection, projectionN, Math.max(0, now() - startedAt));
}
export function recordMiniPlayerCommit(): void {
  if (snapshotAt !== null) miniN = push(miniCommit, miniN, Math.max(0, now() - snapshotAt));
}

/** MiniPlayer → Now Playing geçişi başladı. */
export function markNowPlayingInteraction(): void {
  interactionAt = now();
  artworkReadyAt = null;
  nowPlayingOpenMs = null;
  nowPlayingRenders = 0;
}

export function recordNowPlayingCommit(): void {
  nowPlayingRenders += 1;
  // Açılış gecikmesi YALNIZ ilk çizimde ölçülür; sonraki çizimler onu bozmaz.
  if (nowPlayingOpenMs === null && interactionAt !== null) {
    nowPlayingOpenMs = Math.max(0, now() - interactionAt);
  }
  if (snapshotAt !== null) nowPlayingN = push(nowPlayingCommit, nowPlayingN, Math.max(0, now() - snapshotAt));
}

export function markMusicArtworkReady(): void { artworkReadyAt = now(); }

/* ── F4 · Kuyruk yüzeyi ──────────────────────────────────────────────────── */

export function markQueueInteraction(): void {
  queueInteractionAt = now();
  queueOpenMs = null;
  queueRenders = 0;
}

export function recordQueueProjection(startedAt: number): void {
  queueProjectionN = push(queueProjection, queueProjectionN, Math.max(0, now() - startedAt));
}

export function recordQueueCommit(rowCount: number): void {
  queueRenders += 1;
  lastQueueRowCount = Number.isFinite(rowCount) ? rowCount : null;
  if (queueOpenMs === null && queueInteractionAt !== null) {
    queueOpenMs = Math.max(0, now() - queueInteractionAt);
  }
  if (snapshotAt !== null) queueCommitN = push(queueCommit, queueCommitN, Math.max(0, now() - snapshotAt));
}

/** Uzun kuyruk pencere maliyeti — satır listesi çizim süresi. */
export function recordQueueRowRender(startedAt: number): void {
  queueRowRenderN = push(queueRowRender, queueRowRenderN, Math.max(0, now() - startedAt));
}

/* ── F4 · Metadata değişim gecikmesi ─────────────────────────────────────── */

export function markMetadataChanged(): void { metadataChangedAt = now(); }

export function recordMetadataCommit(): void {
  if (metadataChangedAt === null) return;
  metadataCommitMs = Math.max(0, now() - metadataChangedAt);
  metadataChangedAt = null;
}

export function getMusicUiPerfSnapshot(): MusicUiPerfSnapshot {
  return Object.freeze({
    samples: Object.freeze({
      projection: Math.min(projectionN, CAP),
      miniCommit: Math.min(miniN, CAP),
      nowPlayingCommit: Math.min(nowPlayingN, CAP),
      queueProjection: Math.min(queueProjectionN, CAP),
      queueCommit: Math.min(queueCommitN, CAP),
      queueRowRender: Math.min(queueRowRenderN, CAP),
    }),
    p50Ms: Object.freeze({
      projection: percentile(projection, projectionN, .5),
      miniCommit: percentile(miniCommit, miniN, .5),
      nowPlayingCommit: percentile(nowPlayingCommit, nowPlayingN, .5),
      queueProjection: percentile(queueProjection, queueProjectionN, .5),
      queueCommit: percentile(queueCommit, queueCommitN, .5),
      queueRowRender: percentile(queueRowRender, queueRowRenderN, .5),
    }),
    p95Ms: Object.freeze({
      projection: percentile(projection, projectionN, .95),
      miniCommit: percentile(miniCommit, miniN, .95),
      nowPlayingCommit: percentile(nowPlayingCommit, nowPlayingN, .95),
      queueProjection: percentile(queueProjection, queueProjectionN, .95),
      queueCommit: percentile(queueCommit, queueCommitN, .95),
      queueRowRender: percentile(queueRowRender, queueRowRenderN, .95),
    }),
    nowPlayingOpenMs,
    artworkReadyAfterOpenMs:
      interactionAt === null || artworkReadyAt === null ? null : Math.max(0, artworkReadyAt - interactionAt),
    queueOpenMs,
    metadataCommitMs,
    nowPlayingRenders,
    queueRenders,
    lastQueueRowCount,
  });
}

export function _resetMusicUiPerfForTest(): void {
  projectionN = 0; miniN = 0; nowPlayingN = 0;
  queueProjectionN = 0; queueCommitN = 0; queueRowRenderN = 0;
  snapshotAt = null; interactionAt = null; artworkReadyAt = null;
  nowPlayingOpenMs = null; queueInteractionAt = null; queueOpenMs = null;
  metadataChangedAt = null; metadataCommitMs = null;
  nowPlayingRenders = 0; queueRenders = 0; lastQueueRowCount = null;
}
