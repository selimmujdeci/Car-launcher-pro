/**
 * voiceDiagService — Remote Log v1 üzerinde sesli asistan aşama telemetrisi.
 *
 * Amaç: "komut hangi katmanda kayboldu?" sorusunu UZAKTAN cevaplamak.
 * Her aşama vehicle_events'e `voice_diag` tipiyle düşer:
 *
 *   voice_start → voice_listening → voice_transcript → voice_processing
 *     → voice_intent → voice_command_execute → voice_success
 *   sapmalar: voice_error · voice_timeout · voice_cognitive_pause
 *
 * Taşıyıcı: pushVehicleEvent → push_vehicle_event RPC → connectivityService
 * at-least-once kuyruğu (çevrimdışıyken kuyruklanır — Remote Log v1 ile aynı).
 *
 * ── Gizlilik ────────────────────────────────────────────────────
 * TRANSCRIPT METNİ ASLA GÖNDERİLMEZ — yalnız uzunluğu (transcriptLength).
 * API sözleşmesi bunu yapısal kılar: extra alanları sabit şemadır, serbest
 * metin alanı yoktur; string alanlar (intent/command/provider/errorCode)
 * 64 karaktere kırpılır (enum/tanımlayıcı sınıfı değerler için bol).
 *
 * ── Fırtına koruması ────────────────────────────────────────────
 * Aynı stage 60 saniyede en fazla 5 kez (sabit pencere, performance.now —
 * CLAUDE.md saat-atlaması kuralı). Üstü sessiz drop (return false).
 * Sunucu tarafı 30/60sn guard'ı (migration 020/022) ikinci kattır.
 */

/* ── Aşamalar ───────────────────────────────────────────────── */

export const VOICE_DIAG_STAGES = [
  'voice_start',
  'voice_listening',
  'voice_transcript',
  'voice_processing',
  'voice_intent',
  'voice_command_execute',
  'voice_success',
  'voice_error',
  'voice_timeout',
  'voice_cognitive_pause',
] as const;

export type VoiceDiagStage = (typeof VOICE_DIAG_STAGES)[number];

const _STAGE_SET: ReadonlySet<string> = new Set(VOICE_DIAG_STAGES);

/** Serbest metin YOK — yalnız tanımlayıcı sınıfı alanlar (64 char kırpılır). */
export interface VoiceDiagExtra {
  /** Transcript'in KENDİSİ DEĞİL — yalnız karakter sayısı. */
  transcriptLength?: number;
  intent?: string;
  command?: string;
  provider?: string;
  errorCode?: string;
}

/* ── Fırtına koruması: stage başına 60sn/5 ──────────────────── */

export const VOICE_DIAG_WINDOW_MS = 60_000;
export const VOICE_DIAG_MAX_PER_STAGE = 5;

const _stageWindows = new Map<string, { windowStart: number; count: number }>();

function _now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function _stormAllow(stage: VoiceDiagStage): boolean {
  const now = _now();
  const w = _stageWindows.get(stage);
  if (!w || now - w.windowStart >= VOICE_DIAG_WINDOW_MS) {
    _stageWindows.set(stage, { windowStart: now, count: 1 });
    return true;
  }
  if (w.count >= VOICE_DIAG_MAX_PER_STAGE) return false;
  w.count++;
  return true;
}

/* ── Oturum süresi (durationMs) ─────────────────────────────── */

let _sessionT0: number | null = null;

/* ── Yardımcılar ────────────────────────────────────────────── */

const MAX_FIELD_LEN = 64;

function _cleanStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, MAX_FIELD_LEN) : undefined;
}

function _cleanLen(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(100_000, Math.floor(n));
}

/* ── API ────────────────────────────────────────────────────── */

/**
 * Aşama raporu — fire-and-forget güvenli (asla throw etmez).
 * Dönüş: true = kuyruğa kabul; false = fırtına guard'ı / geçersiz stage / hata.
 *
 * durationMs: voice_start'tan bu yana geçen süre (monotonic). voice_start
 * oturum sıfırıdır (durationMs=0); oturum dışı çağrılarda 0.
 */
export async function reportVoiceDiag(
  stage: VoiceDiagStage,
  extra?: VoiceDiagExtra,
): Promise<boolean> {
  try {
    if (!_STAGE_SET.has(stage)) return false;          // runtime guard (JS çağrıları)
    if (!_stormAllow(stage)) return false;              // 60sn/5 stage tavanı

    const now = _now();
    if (stage === 'voice_start') _sessionT0 = now;
    const durationMs = _sessionT0 != null ? Math.max(0, Math.round(now - _sessionT0)) : 0;

    // bootId + appVersion: Remote Log v1 oturumuyla AYNI kaynak (korelasyon için).
    // Lazy import: modül grafiği döngüsüz kalır, test mock'u kolay.
    const { getRemoteLogSession } = await import('./remoteLogService');
    const { pushVehicleEvent }    = await import('./vehicleIdentityService');
    const session = getRemoteLogSession();

    // Sabit şema — serbest metin alanı YOK; undefined alanlar hiç yazılmaz.
    const payload: Record<string, unknown> = {
      stage,
      durationMs,
      appVersion: session.appVersion,
      bootId:     session.bootId,
    };
    const tl = _cleanLen(extra?.transcriptLength);
    if (tl !== undefined) payload['transcriptLength'] = tl;
    const intent    = _cleanStr(extra?.intent);
    const command   = _cleanStr(extra?.command);
    const provider  = _cleanStr(extra?.provider);
    const errorCode = _cleanStr(extra?.errorCode);
    if (intent)    payload['intent']    = intent;
    if (command)   payload['command']   = command;
    if (provider)  payload['provider']  = provider;
    if (errorCode) payload['errorCode'] = errorCode;

    await pushVehicleEvent('voice_diag', payload);
    return true;
  } catch {
    return false; // tanı hattı asistanı ASLA crash ettirmez
  }
}

/* ── Test yardımcıları (yalnız vitest) ──────────────────────── */

/** @internal — fırtına pencerelerini ve oturum sıfırını temizler. */
export function _resetVoiceDiagForTest(): void {
  _stageWindows.clear();
  _sessionT0 = null;
}
