/**
 * deviceValidationStore.ts — MÜZİK HUB PAKET B · Cihaz doğrulama oturum deposu.
 *
 * Saf model `deviceValidationModel.ts` içindedir; burada YALNIZ kalıcılık ve
 * oturum yaşam döngüsü vardır (tek yazar, bounded, versioned).
 *
 * KURALLAR:
 *   - Kayıt **versiyonludur**; sürüm uyuşmazsa YÜKLENMEZ (bozuk şema fail-soft silinir).
 *   - En fazla `MAX_SESSIONS` oturum tutulur — sınırsız büyüme YOK.
 *   - Yazma yalnız oturum başında/bitişinde olur (yüksek frekanslı disk yazımı YOK).
 *   - PII · token · medya URL'si TAŞINMAZ (model tipinde böyle alan yoktur).
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../../utils/safeStorage';
import {
  completeSession, markSessionRunning, startSession, abortSession,
  MAX_SESSIONS, SESSION_SCHEMA_VERSION,
  type CompleteSessionInput, type StartSessionInput, type ValidationSession,
} from './deviceValidationModel';

const KEY = 'caros_media_device_validation';

interface PersistedShape {
  readonly version: number;
  readonly sessions: readonly ValidationSession[];
}

let _sessions: ValidationSession[] | null = null;
let _active: ValidationSession | null = null;
let _seq = 0;

function isSession(v: unknown): v is ValidationSession {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<ValidationSession>;
  return typeof s.sessionId === 'string'
    && typeof s.scenarioId === 'string'
    && typeof s.state === 'string'
    && typeof s.result === 'string'
    && typeof s.startedAtMs === 'number'
    && Number.isFinite(s.startedAtMs);
}

/** Diskten yükler. Bozuk/eski kayıt SESSİZCE KABUL EDİLMEZ, temizlenir. */
function load(): ValidationSession[] {
  if (_sessions) return _sessions;
  _sessions = [];
  try {
    const raw = safeGetRaw(KEY);
    if (!raw) return _sessions;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') { safeRemoveRaw(KEY); return _sessions; }
    const shape = parsed as Partial<PersistedShape>;
    if (shape.version !== SESSION_SCHEMA_VERSION || !Array.isArray(shape.sessions)) {
      safeRemoveRaw(KEY);
      return _sessions;
    }
    _sessions = shape.sessions.filter(isSession).slice(-MAX_SESSIONS);
  } catch {
    try { safeRemoveRaw(KEY); } catch { /* fail-soft */ }
    _sessions = [];
  }
  return _sessions;
}

function persist(): void {
  try {
    const shape: PersistedShape = {
      version: SESSION_SCHEMA_VERSION,
      sessions: (_sessions ?? []).slice(-MAX_SESSIONS),
    };
    safeSetRaw(KEY, JSON.stringify(shape));
  } catch { /* fail-soft — doğrulama kaydı ASLA oynatmayı bozmaz */ }
}

/** Tüm oturumlar (salt-okunur kopya). */
export function listSessions(): readonly ValidationSession[] {
  return load().slice();
}

/** Şu an açık oturum (yoksa null). */
export function getActiveSession(): ValidationSession | null {
  return _active;
}

export interface BeginInput extends Omit<StartSessionInput, 'sessionId' | 'nowMs'> {
  readonly nowMs?: number;
}

/**
 * Oturum başlatır. Açık oturum varsa ÖNCE iptal edilir (iki oturum aynı anda
 * koşamaz — ölçüm karışması engellenir).
 */
export function beginSession(input: BeginInput): ValidationSession {
  const nowMs = input.nowMs ?? Date.now();
  if (_active && (_active.state === 'preparing' || _active.state === 'running')) {
    const aborted = abortSession(_active, nowMs);
    load().push(aborted);
  }
  _seq += 1;
  const session = startSession({
    ...input,
    sessionId: `dv-${nowMs}-${_seq}`,
    nowMs,
  });
  _active = session.state === 'blocked' ? null : session;
  if (session.state === 'blocked') {
    // Bilinmeyen senaryo: kayda geçer ama KOŞULMUŞ sayılmaz.
    load().push(session);
    persist();
  }
  return session;
}

/** Hazırlıktan koşmaya geçirir. */
export function runActiveSession(nowMs = Date.now()): ValidationSession | null {
  if (!_active) return null;
  _active = markSessionRunning(_active, nowMs);
  return _active;
}

/**
 * Açık oturumu sonlandırır ve kalıcılaştırır.
 * Kanıtsız PASS model katmanında BLOCKED'a düşürülür.
 */
export function finishActiveSession(
  input: Omit<CompleteSessionInput, 'nowMs'> & { nowMs?: number },
): ValidationSession | null {
  if (!_active) return null;
  const nowMs = input.nowMs ?? Date.now();
  // Sahada akış "başlat → cihazda dene → sonucu gir" şeklindedir; ayrı bir
  // "koşmaya başladı" adımı zorlamak kullanıcıyı sonucu kaydedememe durumunda
  // bırakırdı. Geçiş burada tamamlanır (durum makinesi yine tek yönlüdür).
  if (_active.state === 'preparing') _active = markSessionRunning(_active, nowMs);
  const done = completeSession(_active, { ...input, nowMs });
  _active = null;
  const list = load();
  list.push(done);
  while (list.length > MAX_SESSIONS) list.shift();
  persist();
  return done;
}

/** Açık oturumu iptal eder (sonuç NOT_RUN kalır). */
export function abortActiveSession(nowMs = Date.now()): ValidationSession | null {
  if (!_active) return null;
  const done = abortSession(_active, nowMs);
  _active = null;
  const list = load();
  list.push(done);
  while (list.length > MAX_SESSIONS) list.shift();
  persist();
  return done;
}

/** Tüm doğrulama geçmişini siler (yalnız geliştirici eylemi). */
export function clearSessions(): void {
  _sessions = [];
  _active = null;
  try { safeRemoveRaw(KEY); } catch { /* fail-soft */ }
}

export function __resetValidationStoreForTest(): void {
  _sessions = null;
  _active = null;
  _seq = 0;
}
