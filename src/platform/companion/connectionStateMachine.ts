/**
 * connectionStateMachine.ts — Companion bağlantı durum makinesi (P1-PREP · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · modül durumu YOK · React importu YOK.
 * Bu dosya bir DURUM DEFTERİDİR; hiçbir bağlantı KURMAZ, hiçbir taşımaya DOKUNMAZ.
 *
 * ── GEÇERSİZ GEÇİŞE İZİN YOK (PAZARLIKSIZ) ──────────────────────────────────
 * Geçiş tablosu AÇIKÇA yazılmıştır. Tabloda olmayan (durum, eylem) çifti
 * REDDEDİLİR: durum DEĞİŞMEZ ve sabit bir gerekçe kodu döner. "Sessizce kabul et"
 * veya "en yakın duruma sıçra" davranışı YOKTUR — sessiz sıçrama, sahada
 * "bağlıyım sanıyordum" hatalarının kaynağıdır.
 *
 * ── GÖNDERİM KAPISI ─────────────────────────────────────────────────────────
 * Mesaj göndermek YALNIZ `CONNECTED` ve `DEGRADED` durumlarında meşrudur.
 * `NEGOTIATING` sırasında bile uygulama mesajı gönderilmez (yalnız el sıkışma
 * trafiği). Bu kural `canSendApplicationMessage()` ile tek yerde tutulur.
 */

import type { CompanionErrorCode } from './companionDomain';

/* ══════════════════════════════════════════════════════════════════════════
 * Durumlar ve eylemler
 * ════════════════════════════════════════════════════════════════════════ */

export type ConnectionState =
  | 'IDLE'
  | 'DISCOVERING'
  | 'PAIRING'
  | 'CONNECTING'
  | 'NEGOTIATING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'FAILED';

export const CONNECTION_STATES: readonly ConnectionState[] = Object.freeze([
  'IDLE', 'DISCOVERING', 'PAIRING', 'CONNECTING', 'NEGOTIATING',
  'CONNECTED', 'DEGRADED', 'RECONNECTING', 'DISCONNECTED', 'FAILED',
]);

export const CONNECTION_STATE_LABEL: Readonly<Record<ConnectionState, string>> = {
  IDLE:         'BOŞTA',
  DISCOVERING:  'ARANIYOR',
  PAIRING:      'EŞLEŞTİRİLİYOR',
  CONNECTING:   'BAĞLANIYOR',
  NEGOTIATING:  'ANLAŞILIYOR',
  CONNECTED:    'BAĞLI',
  DEGRADED:     'ZAYIF',
  RECONNECTING: 'YENİDEN BAĞLANIYOR',
  DISCONNECTED: 'KOPUK',
  FAILED:       'DÜŞTÜ',
} as const;

/**
 * Durum makinesini süren eylemler. HİÇBİRİ yan etki üretmez — yalnız hedef
 * durumu belirler. Gerçek taşıma çağrıları Session Manager'ın işidir.
 */
export type ConnectionAction =
  | 'DISCOVER'
  | 'PAIR'
  | 'OPEN'            // taşımayı açma isteği (gerçek soket DEĞİL — adapter sözleşmesi)
  | 'NEGOTIATE'
  | 'NEGOTIATED'
  | 'DEGRADE'
  | 'RECOVER'
  | 'LOSE'            // beklenmeyen kayıp (heartbeat/taşıma) → yeniden bağlanma
  | 'RETRY'
  | 'CLOSE'           // kasıtlı kapatma
  | 'FAIL'
  | 'RESET';

export const CONNECTION_ACTIONS: readonly ConnectionAction[] = Object.freeze([
  'DISCOVER', 'PAIR', 'OPEN', 'NEGOTIATE', 'NEGOTIATED', 'DEGRADE',
  'RECOVER', 'LOSE', 'RETRY', 'CLOSE', 'FAIL', 'RESET',
]);

export const CONNECTION_ACTION_LABEL: Readonly<Record<ConnectionAction, string>> = {
  DISCOVER:   'ARA',
  PAIR:       'EŞLEŞTİR',
  OPEN:       'TAŞIMAYI AÇ',
  NEGOTIATE:  'ANLAŞMAYA BAŞLA',
  NEGOTIATED: 'ANLAŞMA TAMAM',
  DEGRADE:    'ZAYIFLADI',
  RECOVER:    'TOPARLANDI',
  LOSE:       'BAĞLANTI KAYBI',
  RETRY:      'YENİDEN DENE',
  CLOSE:      'KAPAT',
  FAIL:       'BAŞARISIZ',
  RESET:      'SIFIRLA',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Geçiş tablosu — TEK GERÇEK KAYNAĞI
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Açık geçiş tablosu. Bir (durum → eylem) çifti burada YOKSA geçiş GEÇERSİZDİR.
 *
 * Tasarım notları:
 *  · `RESET` her durumdan IDLE'a döner — geliştirici kaçış kapısı (yerel, yan etkisiz).
 *  · `FAIL` yalnız AKTİF durumlardan gelir; IDLE/DISCONNECTED'dan "düştü" denmez.
 *  · `NEGOTIATE` CONNECTED ve DEGRADED'dan da kabul edilir: yetenek değişimi
 *    YENİDEN ANLAŞMA gerektirir (Session Manager sözleşmesi).
 *  · `LOSE` (beklenmeyen kayıp) → RECONNECTING; `CLOSE` (kasıtlı) → DISCONNECTED.
 *    İkisi KARIŞTIRILMAZ: kasıtlı kapatma otomatik yeniden bağlanma TETİKLEMEZ.
 */
export const CONNECTION_TRANSITIONS: Readonly<
  Record<ConnectionState, Readonly<Partial<Record<ConnectionAction, ConnectionState>>>>
> = Object.freeze({
  IDLE: Object.freeze({
    DISCOVER: 'DISCOVERING', PAIR: 'PAIRING', OPEN: 'CONNECTING', RESET: 'IDLE',
  }),
  DISCOVERING: Object.freeze({
    PAIR: 'PAIRING', OPEN: 'CONNECTING', CLOSE: 'DISCONNECTED', FAIL: 'FAILED', RESET: 'IDLE',
  }),
  PAIRING: Object.freeze({
    OPEN: 'CONNECTING', CLOSE: 'DISCONNECTED', FAIL: 'FAILED', RESET: 'IDLE',
  }),
  CONNECTING: Object.freeze({
    NEGOTIATE: 'NEGOTIATING', LOSE: 'RECONNECTING', CLOSE: 'DISCONNECTED',
    FAIL: 'FAILED', RESET: 'IDLE',
  }),
  NEGOTIATING: Object.freeze({
    NEGOTIATED: 'CONNECTED', LOSE: 'RECONNECTING', CLOSE: 'DISCONNECTED',
    FAIL: 'FAILED', RESET: 'IDLE',
  }),
  CONNECTED: Object.freeze({
    DEGRADE: 'DEGRADED', NEGOTIATE: 'NEGOTIATING', LOSE: 'RECONNECTING',
    CLOSE: 'DISCONNECTED', FAIL: 'FAILED', RESET: 'IDLE',
  }),
  DEGRADED: Object.freeze({
    RECOVER: 'CONNECTED', NEGOTIATE: 'NEGOTIATING', LOSE: 'RECONNECTING',
    CLOSE: 'DISCONNECTED', FAIL: 'FAILED', RESET: 'IDLE',
  }),
  RECONNECTING: Object.freeze({
    OPEN: 'CONNECTING', RETRY: 'RECONNECTING', NEGOTIATE: 'NEGOTIATING',
    CLOSE: 'DISCONNECTED', FAIL: 'FAILED', RESET: 'IDLE',
  }),
  DISCONNECTED: Object.freeze({
    DISCOVER: 'DISCOVERING', PAIR: 'PAIRING', OPEN: 'CONNECTING',
    RETRY: 'RECONNECTING', RESET: 'IDLE',
  }),
  FAILED: Object.freeze({
    RETRY: 'RECONNECTING', CLOSE: 'DISCONNECTED', RESET: 'IDLE',
  }),
});

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıflandırma yardımcıları
 * ════════════════════════════════════════════════════════════════════════ */

/** Aktif = bir bağlantı süreci yürüyor (kaynak tüketiyor olabilir). */
export function isActiveState(s: ConnectionState): boolean {
  return s === 'DISCOVERING' || s === 'PAIRING' || s === 'CONNECTING'
      || s === 'NEGOTIATING' || s === 'CONNECTED' || s === 'DEGRADED'
      || s === 'RECONNECTING';
}

/** Dinlenme durumu — hiçbir süreç yürümüyor. */
export function isRestingState(s: ConnectionState): boolean {
  return s === 'IDLE' || s === 'DISCONNECTED' || s === 'FAILED';
}

/**
 * UYGULAMA mesajı gönderilebilir mi. YALNIZ CONNECTED/DEGRADED.
 * `NEGOTIATING` dahil DİĞER HİÇBİR durumda uygulama trafiği gönderilmez.
 */
export function canSendApplicationMessage(s: ConnectionState): boolean {
  return s === 'CONNECTED' || s === 'DEGRADED';
}

/** Oturum "yaşıyor" sayılır mı (heartbeat beklenir). */
export function expectsHeartbeat(s: ConnectionState): boolean {
  return s === 'CONNECTED' || s === 'DEGRADED';
}

export function isValidState(v: unknown): v is ConnectionState {
  return typeof v === 'string' && (CONNECTION_STATES as readonly string[]).includes(v);
}

export function isValidAction(v: unknown): v is ConnectionAction {
  return typeof v === 'string' && (CONNECTION_ACTIONS as readonly string[]).includes(v);
}

export function normalizeState(v: unknown): ConnectionState {
  return isValidState(v) ? v : 'IDLE';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Geçiş
 * ════════════════════════════════════════════════════════════════════════ */

export interface TransitionResult {
  readonly ok: boolean;
  /** Geçiş reddedildiyse GİRDİ durumu aynen döner (sessiz sıçrama YOK). */
  readonly next: ConnectionState;
  readonly from: ConnectionState;
  readonly action: ConnectionAction | null;
  /** Reddedilme gerekçesi — sabit kod (`ok:true` ise null). */
  readonly error: CompanionErrorCode | null;
}

/**
 * Saf geçiş. Bilinmeyen durum/eylem ve tabloda olmayan çift REDDEDİLİR;
 * fonksiyon ASLA throw etmez.
 */
export function transition(state: unknown, action: unknown): TransitionResult {
  const from = isValidState(state) ? state : null;
  const act = isValidAction(action) ? action : null;

  if (from === null) {
    return {
      ok: false, next: 'IDLE', from: 'IDLE', action: act,
      error: 'INVALID_STATE_TRANSITION',
    };
  }
  if (act === null) {
    return { ok: false, next: from, from, action: null, error: 'INVALID_STATE_TRANSITION' };
  }

  const next = CONNECTION_TRANSITIONS[from][act];
  if (next === undefined) {
    return { ok: false, next: from, from, action: act, error: 'INVALID_STATE_TRANSITION' };
  }
  return { ok: true, next, from, action: act, error: null };
}

/** Bu durumdan meşru eylemler (deterministik sıra) — geliştirici ekranı için. */
export function allowedActions(state: unknown): readonly ConnectionAction[] {
  if (!isValidState(state)) return [];
  const row = CONNECTION_TRANSITIONS[state];
  return CONNECTION_ACTIONS.filter((a) => row[a] !== undefined);
}

/** Geçiş tablosunun düz listesi — dökümanlama/test için. */
export function transitionTable(): readonly {
  readonly from: ConnectionState;
  readonly action: ConnectionAction;
  readonly to: ConnectionState;
}[] {
  const out: { from: ConnectionState; action: ConnectionAction; to: ConnectionState }[] = [];
  for (const from of CONNECTION_STATES) {
    for (const action of CONNECTION_ACTIONS) {
      const to = CONNECTION_TRANSITIONS[from][action];
      if (to !== undefined) out.push({ from, action, to });
    }
  }
  return out;
}
