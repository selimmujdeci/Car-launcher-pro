/**
 * playbackTruth.ts — MÜZİK HUB PAKET A · Playback Truth Modeli (SAF).
 *
 * NEDEN: Eski hatta "komut gönderildi" ile "müzik çalıyor" aynı şeydi. Spotify
 * Connect'e PUT atılınca UI anında `playing: true` yazıyordu; YouTube iframe'e
 * loadVideoById denince de öyle. Kullanıcı sessizlik duyarken uygulama "çalıyor"
 * diyordu — ve Mavi de aynı yalanı sesli tekrarlıyordu.
 *
 * BU MODÜLÜN SÖZLEŞMESİ: her komut, hangi kanıt düzeyine ULAŞABİLDİĞİNİ taşır.
 * Kanıtlanamayan başarı "başarı" sayılmaz; `ACCEPTED_UNVERIFIED` diye ayrı bir
 * sonuçtur ve UI/Mavi bunu dürüstçe farklı ifade eder.
 *
 * SAFLIK (CLAUDE.md gözlemlenebilirlik deseni): I/O · timer · Date.now · global
 * durum · React importu YOKTUR. Tüm zaman değerleri parametre olarak girer.
 */

/* ── Truth zinciri aşamaları ─────────────────────────────────────────────── */

export type TruthStage =
  | 'command_received'
  | 'intent_resolved'
  | 'source_resolved'
  | 'playback_requested'
  | 'transport_acknowledged'
  | 'player_preparing'
  | 'playback_started'
  | 'playback_observed'
  | 'audible_verification_supported'
  | 'audible_verified'
  | 'playback_failed'
  | 'timed_out'
  | 'cancelled'
  | 'superseded';

/**
 * Bir backend'in ulaşabildiği EN YÜKSEK kanıt düzeyi.
 *
 *  NONE                   — hiçbir geri bildirim yok.
 *  TRANSPORT_ACK          — komut kabul edildi; oynatma hakkında BİLGİ YOK.
 *  REMOTE_STATE_OBSERVED  — uzak cihaz "çalıyor" diyor (Spotify Connect, harici
 *                           MediaSession). Sesin gerçekten çıktığı DOĞRULANAMAZ.
 *  OBSERVED_STARTED       — yerel oynatıcı "başladı" olayı verdi (HTML5 audio
 *                           `play`, YouTube iframe PLAYING) — ses yolu doğrulanmadı.
 *  RENDERING_VERIFIED     — native ExoPlayer render ediyor + audio focus BİZDE +
 *                           etkin ses > 0. Elimizdeki en güçlü "duyulabilir" kanıtı.
 */
export type VerificationLevel =
  | 'NONE'
  | 'TRANSPORT_ACK'
  | 'REMOTE_STATE_OBSERVED'
  | 'OBSERVED_STARTED'
  | 'RENDERING_VERIFIED';

const VERIFICATION_RANK: Record<VerificationLevel, number> = {
  NONE: 0,
  TRANSPORT_ACK: 1,
  REMOTE_STATE_OBSERVED: 2,
  OBSERVED_STARTED: 3,
  RENDERING_VERIFIED: 4,
};

export type DesiredState = 'PLAYING' | 'PAUSED' | 'STOPPED' | 'UNCHANGED';
export type ObservedState =
  | 'PLAYING'
  | 'PAUSED'
  | 'STOPPED'
  | 'BUFFERING'
  | 'ERROR'
  | 'UNKNOWN';

/** Komutun nihai sonucu. */
export type CommandOutcome =
  /** Hedef durum GÖZLENDİ (kanıt düzeyi verificationLevel alanındadır). */
  | 'VERIFIED'
  /** Backend kabul etti ama bu backend doğrulama SAĞLAYAMIYOR — yalan söyleme. */
  | 'ACCEPTED_UNVERIFIED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'
  | 'SUPERSEDED'
  | 'REJECTED';

export interface TruthEvent {
  readonly stage: TruthStage;
  readonly atMs: number;
  readonly detail?: string;
}

/** Bir komutun tam kanıt kaydı. */
export interface CommandTruth {
  readonly commandId: string;
  readonly sessionId: string;
  readonly sourceId: string;
  readonly backend: string;
  readonly command: string;
  readonly desiredState: DesiredState;
  readonly observedState: ObservedState;
  readonly outcome: CommandOutcome;
  readonly verificationLevel: VerificationLevel;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly elapsedMs: number;
  readonly failureCode: string | null;
  readonly retryable: boolean;
  readonly stages: readonly TruthEvent[];
}

/* ── Hata kodları ────────────────────────────────────────────────────────── */

/** Yeniden denenebilir hatalar — ağ/geçici kaynak sorunları. */
const RETRYABLE_CODES = new Set([
  'network_error',
  'stream_error',
  'buffering_timeout',
  'authority_unavailable',
  'focus_delayed',
  'player_unavailable',
  'command_timeout',
]);

/** Yeniden denemenin ANLAMSIZ olduğu hatalar — politika/doğrulama redleri. */
const TERMINAL_CODES = new Set([
  'invalid_command',
  'unknown_command',
  'invalid_source',
  'invalid_volume',
  'invalid_repeat_mode',
  'invalid_duck_reason',
  'invalid_duck_token',
  'invalid_position',
  'empty_queue',
  'queue_too_large',
  'duplicate_command',
  'focus_denied',
  'no_media',
  'no_next_item',
  'unsupported_capability',
  'source_stop_unverified',
]);

export function isRetryableFailure(code: string | null): boolean {
  if (!code) return false;
  if (TERMINAL_CODES.has(code)) return false;
  if (RETRYABLE_CODES.has(code)) return true;
  // Bilinmeyen kod → fail-closed: yeniden deneme ÖNERİLMEZ (sonsuz döngü riski).
  return false;
}

/* ── Truth kaydı üreticisi (saf, mutasyonsuz) ────────────────────────────── */

export interface TruthDraft {
  readonly commandId: string;
  readonly sessionId: string;
  readonly sourceId: string;
  readonly backend: string;
  readonly command: string;
  readonly desiredState: DesiredState;
  readonly startedAtMs: number;
  readonly stages: readonly TruthEvent[];
}

export function beginTruth(input: {
  commandId: string;
  sessionId: string;
  sourceId: string;
  backend: string;
  command: string;
  desiredState: DesiredState;
  atMs: number;
}): TruthDraft {
  return {
    commandId: input.commandId,
    sessionId: input.sessionId,
    sourceId: input.sourceId,
    backend: input.backend,
    command: input.command,
    desiredState: input.desiredState,
    startedAtMs: input.atMs,
    stages: [{ stage: 'command_received', atMs: input.atMs }],
  };
}

/** Aşama ekler — kopya döner (girdi mutasyona uğramaz). */
export function withStage(
  draft: TruthDraft,
  stage: TruthStage,
  atMs: number,
  detail?: string,
): TruthDraft {
  const event: TruthEvent = detail === undefined ? { stage, atMs } : { stage, atMs, detail };
  return { ...draft, stages: [...draft.stages, event] };
}

/**
 * Kaydı sonlandırır. `outcome` UYDURULMAZ: doğrulama düzeyi yetersizse
 * VERIFIED verilse bile ACCEPTED_UNVERIFIED'a DÜŞÜRÜLÜR.
 */
export function finishTruth(
  draft: TruthDraft,
  input: {
    outcome: CommandOutcome;
    observedState: ObservedState;
    verificationLevel: VerificationLevel;
    failureCode?: string | null;
    atMs: number;
  },
): CommandTruth {
  const failureCode = input.failureCode ?? null;
  // Dürüstlük kapısı: kanıt düzeyi TRANSPORT_ACK veya altındaysa "VERIFIED" denemez.
  const outcome: CommandOutcome =
    input.outcome === 'VERIFIED' &&
    VERIFICATION_RANK[input.verificationLevel] <= VERIFICATION_RANK.TRANSPORT_ACK
      ? 'ACCEPTED_UNVERIFIED'
      : input.outcome;

  const endStage: TruthStage =
    outcome === 'VERIFIED'
      ? 'audible_verified'
      : outcome === 'TIMED_OUT'
        ? 'timed_out'
        : outcome === 'CANCELLED'
          ? 'cancelled'
          : outcome === 'SUPERSEDED'
            ? 'superseded'
            : outcome === 'ACCEPTED_UNVERIFIED'
              ? 'playback_requested'
              : 'playback_failed';

  const stages = [...draft.stages, { stage: endStage, atMs: input.atMs }];

  return {
    commandId: draft.commandId,
    sessionId: draft.sessionId,
    sourceId: draft.sourceId,
    backend: draft.backend,
    command: draft.command,
    desiredState: draft.desiredState,
    observedState: input.observedState,
    outcome,
    verificationLevel: input.verificationLevel,
    startedAtMs: draft.startedAtMs,
    endedAtMs: input.atMs,
    elapsedMs: Math.max(0, input.atMs - draft.startedAtMs),
    failureCode,
    retryable: outcome === 'FAILED' || outcome === 'TIMED_OUT'
      ? isRetryableFailure(failureCode ?? (outcome === 'TIMED_OUT' ? 'command_timeout' : null))
      : false,
    stages,
  };
}

/** Sonuç başarı sayılır mı — "çalıyor" iddiası YALNIZ VERIFIED ile kurulabilir. */
export function isSuccess(t: CommandTruth): boolean {
  return t.outcome === 'VERIFIED' || t.outcome === 'ACCEPTED_UNVERIFIED';
}

/** Kullanıcıya/Mavi'ye söylenebilecek DÜRÜST ifade sınıfı. */
export type HonestClaim = 'PLAYING' | 'REQUEST_SENT' | 'FAILED' | 'NOT_ATTEMPTED';

export function honestClaim(t: CommandTruth): HonestClaim {
  if (t.outcome === 'VERIFIED') return 'PLAYING';
  if (t.outcome === 'ACCEPTED_UNVERIFIED') return 'REQUEST_SENT';
  if (t.outcome === 'REJECTED' || t.outcome === 'CANCELLED') return 'NOT_ATTEMPTED';
  return 'FAILED';
}

export function verificationRank(level: VerificationLevel): number {
  return VERIFICATION_RANK[level];
}
