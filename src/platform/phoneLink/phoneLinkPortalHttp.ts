/**
 * phoneLinkPortalHttp.ts — PHONE LINK F3.5/F3.11 · portal istek yönlendiricisi.
 *
 * ── NATIVE OPAK, TS KARAR VERİR ──────────────────────────────────────────────
 * Native (`PhoneLinkPortalServer`) yalnız soketi ve HAM HTTP çerçevelemesini
 * bilir; hiçbir yetki/müzik/oturum kararı VERMEZ. Bu, F2'nin native köprüsüyle
 * BİREBİR aynı desendir (opak taşıma → dar TS ingress). Tüm anlam BURADADIR.
 *
 * ── YENİ MÜZİK/OTURUM OTORİTESİ YOK (F3.6) ───────────────────────────────────
 * Her komut ve her durum okuması `dispatchGuestMusicCommand()` üzerinden gider;
 * o da kanonik `authorize()` → `canExecute()` → `mediaCommandGateway`
 * zincirini kullanır. Burada ikinci bir playback state / queue / metadata
 * otoritesi TUTULMAZ — bu dosyadaki tek kalıcı durum, sınırlı hız sayacıdır.
 *
 * ── GÜVENLİK YÜZEYİ (F3.11) ──────────────────────────────────────────────────
 *  · Yol ALLOWLIST'i — sunucunun servis edebileceği DOSYA KÜMESİ BOŞTUR;
 *    statik dosya eşlemesi hiç yoktur → path traversal YAPISAL OLARAK imkânsız.
 *  · Metot allowlist — yol başına tek metot, aksi 405.
 *  · Gövde sert üst sınırı (native ayrıca kesiyor) → 413.
 *  · Komut yetkisi YALNIZ `Authorization: Bearer` başlığındadır. Tarayıcıdan
 *    başlatılan siteler arası bir form/görsel isteği bu başlığı EKLEYEMEZ →
 *    CSRF yapısal olarak kapalıdır. Token QUERY'de ASLA taşınmaz.
 *  · `/events` YALNIZ salt-okunur akış anahtarını kabul eder (EventSource
 *    başlık gönderemez) — o anahtarla komut YÜRÜTÜLEMEZ.
 *  · CORS başlığı HİÇ üretilmez (wildcard yok) → çapraz-origin okuma olmaz.
 *  · `Origin` gönderilmişse portalın KENDİ origin'i olmalıdır; değilse 403.
 *  · Güvenlik başlıkları her yanıtta (bkz. `PORTAL_SECURITY_HEADERS`).
 *  · Hiçbir token/parmak izi yanıt gövdesine veya sayaçlara YAZILMAZ.
 *  · Hız sınırı TIMER'SIZ: pencere yalnız gelen isteğin zaman damgasından
 *    hesaplanır ve sınırlı sayıda oturum için tutulur.
 */

import {
  exchangeGuestBootstrapToken, validatePortalToken, validateStreamToken,
} from './phoneLinkGuestSession';
import {
  dispatchGuestMusicCommand, type PhoneLinkSessionRef,
} from './phoneLinkMusicRemoteAdapter';
import { PHONE_LINK_PORTAL_HTML } from './phoneLinkPortalAsset';

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/** Portal kabuğunun servis edildiği TEK yol. */
export const PORTAL_SHELL_PATH = '/p';

/** Gövde sert üst sınırı — native de ayrıca kesiyor (iki katmanlı savunma). */
export const MAX_PORTAL_BODY_BYTES = 512;

/**
 * Her yanıta eklenen güvenlik başlıkları. `default-src 'none'` portalı
 * dış kaynaklardan TAMAMEN yalıtır; sayfa kendi satır-içi stil/script'ini
 * kullandığı için yalnız o ikisi açılır, ağ erişimi `self` ile sınırlıdır.
 */
export const PORTAL_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'no-referrer'],
  ['X-Frame-Options', 'DENY'],
  ['Cache-Control', 'no-store'],
]);

/** Portalın kabul ettiği komut allowlist'i — `GET_*` okuma komutları HARİÇ. */
const PORTAL_COMMANDS = Object.freeze(['PLAY', 'PAUSE', 'NEXT', 'PREVIOUS'] as const);
export type PortalCommand = (typeof PORTAL_COMMANDS)[number];

export interface PortalHttpRequest {
  readonly method: string;
  /** Query'den AYRILMIŞ yol. */
  readonly path: string;
  /** Yalnız `/events` için anlamlı olan salt-okunur akış anahtarı (`?k=`). */
  readonly streamKey: string | null;
  /** `Authorization` başlığının ham değeri. */
  readonly authorization: string | null;
  readonly origin: string | null;
  readonly body: string;
  /** Native gövdeyi sınırı aştığı için kestiyse `true`. */
  readonly bodyTruncated: boolean;
  /** Bu sunucunun bağlı olduğu origin (`http://ip:port`) — Origin denetimi. */
  readonly selfOrigin: string;
}

export type PortalResponseKind = 'BODY' | 'SSE_OPEN';

export interface PortalHttpResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly kind: PortalResponseKind;
  /** `SSE_OPEN` ise: akışın bağlanacağı oturum — native soketi bu ada yazar. */
  readonly streamSessionId?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sabit yanıtlar — iç ayrıntı/stack trace/token TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

function json(status: number, body: string): PortalHttpResponse {
  return { status, contentType: 'application/json; charset=utf-8', body, kind: 'BODY' };
}

function plain(status: number, body: string): PortalHttpResponse {
  return { status, contentType: 'text/plain; charset=utf-8', body, kind: 'BODY' };
}

const NOT_FOUND = plain(404, 'not found');
const METHOD_NOT_ALLOWED = plain(405, 'method not allowed');
const PAYLOAD_TOO_LARGE = plain(413, 'payload too large');
const BAD_REQUEST = json(400, '{"error":"malformed"}');
const UNAUTHORIZED = json(401, '{"error":"unauthorized"}');
const FORBIDDEN = json(403, '{"error":"forbidden"}');
const CONSUMED = json(409, '{"error":"consumed"}');
const TOO_MANY = json(429, '{"error":"rate_limited"}');

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlemlenebilirlik (F3.13) — SIR TAŞIMAZ, TIMER YOK
 * ════════════════════════════════════════════════════════════════════════ */

export type PortalRejectReason =
  | 'bootstrap_rejected' | 'bootstrap_consumed' | 'unauthorized' | 'rate_limited'
  | 'origin_mismatch' | 'malformed' | 'oversized';

interface PortalCounters {
  bootstrapAccepted: number;
  bootstrapRejected: number;
  commandsAccepted: number;
  commandsRejected: number;
  lastRejectReason: PortalRejectReason | null;
}

const _counters: PortalCounters = {
  bootstrapAccepted: 0, bootstrapRejected: 0,
  commandsAccepted: 0, commandsRejected: 0, lastRejectReason: null,
};

function reject(reason: PortalRejectReason, response: PortalHttpResponse): PortalHttpResponse {
  _counters.lastRejectReason = reason;
  return response;
}

/** LAB salt-okunur — token/parmak izi/payload TAŞIMAZ. */
export function getPhoneLinkPortalCounters(): Readonly<PortalCounters> {
  return Object.freeze({ ..._counters });
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkPortalHttpForTest(): void {
  _counters.bootstrapAccepted = 0; _counters.bootstrapRejected = 0;
  _counters.commandsAccepted = 0; _counters.commandsRejected = 0;
  _counters.lastRejectReason = null;
  _rateWindows.clear();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hız sınırı — sınırlı, TIMER'SIZ
 * ════════════════════════════════════════════════════════════════════════ */

const RATE_WINDOW_MS = 10_000;
const RATE_MAX_REQUESTS = 40;
const RATE_MAX_TRACKED_SESSIONS = 8;

const _rateWindows = new Map<string, { startMs: number; count: number }>();

function rateLimited(sessionId: string, nowMs: number): boolean {
  const w = _rateWindows.get(sessionId);
  if (w === undefined || nowMs - w.startMs >= RATE_WINDOW_MS) {
    if (w === undefined && _rateWindows.size >= RATE_MAX_TRACKED_SESSIONS) {
      /* Sınırsız büyüme YOK: en eski girdi düşürülür (Map ekleme sırasını korur). */
      const oldest = _rateWindows.keys().next();
      if (!oldest.done) _rateWindows.delete(oldest.value);
    }
    _rateWindows.set(sessionId, { startMs: nowMs, count: 1 });
    return false;
  }
  w.count += 1;
  return w.count > RATE_MAX_REQUESTS;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanonik durum projeksiyonu — İKİNCİ state store DEĞİL
 * ════════════════════════════════════════════════════════════════════════ */

export interface PortalStatePayload {
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly playing: boolean;
  readonly queueCount: number;
}

/**
 * Kanonik Music gerçeğinden TÜRETİLMİŞ salt-okunur projeksiyon.
 *
 * Artwork binary'si veya kimlik dizisi TAŞINMAZ (F3 için zorunlu değil; kimlik
 * dizisi bir dosya yolu olabileceğinden ağa çıkarılmaz). Yetki reddedilirse
 * `null` döner — sahte "boş ama sağlıklı" durum ÜRETİLMEZ.
 */
export async function readPortalState(
  session: PhoneLinkSessionRef | null = null,
): Promise<PortalStatePayload | null> {
  const np = await dispatchGuestMusicCommand('GET_NOW_PLAYING', undefined, session);
  if (!np.ok || np.command !== 'GET_NOW_PLAYING') return null;
  const q = await dispatchGuestMusicCommand('GET_QUEUE', undefined, session);
  const queueCount = q.ok && q.command === 'GET_QUEUE' ? q.queue.length : 0;
  return Object.freeze({
    title: np.nowPlaying.title,
    artist: np.nowPlaying.artist,
    album: np.nowPlaying.album,
    playing: np.nowPlaying.playing,
    queueCount,
  });
}

/** SSE olarak yayınlanacak tek kare — native bunu olduğu gibi yazar. */
export function buildPortalStateEvent(state: PortalStatePayload): string {
  return `data: ${JSON.stringify(state)}\n\n`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ayrıştırıcılar — katı, sınırlı, refleksiyon YOK
 * ════════════════════════════════════════════════════════════════════════ */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function readBearer(authorization: string | null): string | null {
  if (typeof authorization !== 'string') return null;
  const m = /^Bearer ([A-Za-z0-9_-]{8,128})$/.exec(authorization.trim());
  return m ? m[1] : null;
}

/** Katı gövde ayrıştırma — yalnız düz JSON nesnesi kabul edilir. */
function parseJsonObject(body: string): Record<string, unknown> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** Guest session → taşınabilir oturum kimliği (fingerprint + epoch ÇİFTİ). */
function toSessionRef(session: {
  readonly deviceFingerprint: string; readonly sessionEpoch: number;
}): PhoneLinkSessionRef {
  return { deviceFingerprint: session.deviceFingerprint, sessionEpoch: session.sessionEpoch };
}

function isPortalCommand(v: unknown): v is PortalCommand {
  return typeof v === 'string' && (PORTAL_COMMANDS as readonly string[]).includes(v);
}

/* ══════════════════════════════════════════════════════════════════════════
 * TEK yönlendirici
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir portal isteğini yanıta çevirir. HİÇBİR adım throw ETMEZ.
 *
 * Sıra kasıtlıdır: taşıma denetimleri (boyut/origin/metot) → kimlik → yetki
 * → kanonik yürütme. Yetkisiz bir istek kanonik Music kapısına HİÇ ULAŞMAZ.
 */
export async function handlePortalRequest(
  request: PortalHttpRequest, nowMs: number = Date.now(),
): Promise<PortalHttpResponse> {
  /* Gövde sınırı — native kesmişse gövde zaten eksiktir, tahmin YÜRÜTÜLMEZ. */
  if (request.bodyTruncated || request.body.length > MAX_PORTAL_BODY_BYTES) {
    return reject('oversized', PAYLOAD_TOO_LARGE);
  }

  /* Origin gönderilmişse KENDİ origin'imiz olmalı (CSRF derinliği). */
  if (request.origin !== null && request.origin !== request.selfOrigin) {
    return reject('origin_mismatch', FORBIDDEN);
  }

  switch (request.path) {
    case PORTAL_SHELL_PATH: {
      if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
      /* Kabuk sır TAŞIMAZ ve durum İÇERMEZ — bootstrap token'ı URL
       * FRAGMENT'indedir ve sunucuya HİÇ ulaşmaz, bu yüzden kabuğun kendisi
       * doğrulanamaz. Yetki gerektiren HER ŞEY (durum, komut, akış) ayrı
       * yollardadır ve token'sız reddedilir. */
      return {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: PHONE_LINK_PORTAL_HTML,
        kind: 'BODY',
      };
    }

    case '/bootstrap': {
      if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
      const parsed = parseJsonObject(request.body);
      const token = parsed === null ? null : parsed.t;
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
        _counters.bootstrapRejected += 1;
        return reject('malformed', BAD_REQUEST);
      }
      const exchange = exchangeGuestBootstrapToken(token, nowMs);
      if (!exchange.ok) {
        _counters.bootstrapRejected += 1;
        return exchange.reason === 'ALREADY_CONSUMED'
          ? reject('bootstrap_consumed', CONSUMED)
          : reject('bootstrap_rejected', UNAUTHORIZED);
      }
      _counters.bootstrapAccepted += 1;
      /* F4.10 — durum BU oturumun kimliğiyle okunur; başka bir telefonun
         canlı oturumu üzerinden gerçek SIZDIRILMAZ. */
      const state = await readPortalState({
        deviceFingerprint: exchange.credential.deviceFingerprint,
        sessionEpoch: exchange.credential.sessionEpoch,
      });
      /* Yanıt SABİT alanlıdır; oturumun parmak izi/epoch'u TAŞINMAZ. */
      return json(200, JSON.stringify({
        portalToken: exchange.credential.portalToken,
        streamToken: exchange.credential.streamToken,
        sessionId: exchange.credential.sessionId,
        state,
      }));
    }

    case '/state': {
      if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
      const bearer = readBearer(request.authorization);
      if (bearer === null) return reject('unauthorized', UNAUTHORIZED);
      const session = validatePortalToken(bearer, nowMs);
      if (session === null) return reject('unauthorized', UNAUTHORIZED);
      if (rateLimited(session.sessionId, nowMs)) return reject('rate_limited', TOO_MANY);
      const state = await readPortalState(toSessionRef(session));
      if (state === null) return reject('unauthorized', FORBIDDEN);
      return json(200, JSON.stringify({ state }));
    }

    case '/command': {
      if (request.method !== 'POST') return METHOD_NOT_ALLOWED;
      const bearer = readBearer(request.authorization);
      if (bearer === null) {
        _counters.commandsRejected += 1;
        return reject('unauthorized', UNAUTHORIZED);
      }
      const session = validatePortalToken(bearer, nowMs);
      if (session === null) {
        _counters.commandsRejected += 1;
        return reject('unauthorized', UNAUTHORIZED);
      }
      if (rateLimited(session.sessionId, nowMs)) {
        _counters.commandsRejected += 1;
        return reject('rate_limited', TOO_MANY);
      }
      const parsed = parseJsonObject(request.body);
      const command = parsed === null ? null : parsed.c;
      if (!isPortalCommand(command)) {
        _counters.commandsRejected += 1;
        return reject('malformed', BAD_REQUEST);
      }

      /* KANONİK YOL — doğrudan player çağrısı YOK. `dispatchGuestMusicCommand`
       * kendi içinde `authorize()` + TOCTOU `canExecute()` yapar; oturum BU AN
       * koptuysa gateway'e HİÇ gitmez (F3.9 yarış koşulu kilidi). */
      const result = await dispatchGuestMusicCommand(
        command, `phone-link-portal:${command.toLowerCase()}`, toSessionRef(session),
      );
      if (!result.ok) {
        _counters.commandsRejected += 1;
        return reject('unauthorized', result.denialCode === 'STALE' ? FORBIDDEN : UNAUTHORIZED);
      }
      _counters.commandsAccepted += 1;
      const state = await readPortalState(toSessionRef(session));
      return json(200, JSON.stringify({ ok: true, state }));
    }

    case '/events': {
      if (request.method !== 'GET') return METHOD_NOT_ALLOWED;
      const key = request.streamKey;
      if (typeof key !== 'string' || !TOKEN_PATTERN.test(key)) {
        return reject('unauthorized', UNAUTHORIZED);
      }
      /* SALT OKUNUR kapı: akış anahtarı komut yollarında KABUL EDİLMEZ
       * (`/command` yalnız `validatePortalToken` sorar). */
      const session = validateStreamToken(key, nowMs);
      if (session === null) return reject('unauthorized', UNAUTHORIZED);
      const state = await readPortalState(toSessionRef(session));
      return {
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: state === null ? ': open\n\n' : buildPortalStateEvent(state),
        kind: 'SSE_OPEN',
        streamSessionId: session.sessionId,
      };
    }

    default:
      /* Statik dosya eşlemesi YOKTUR — `/../../etc/passwd`, `/index.html`,
       * `/assets/x.js` hepsi buraya düşer. Keyfi dosya erişimi YAPISAL
       * OLARAK imkânsızdır (servis edilecek bir dosya kümesi YOK). */
      return NOT_FOUND;
  }
}
