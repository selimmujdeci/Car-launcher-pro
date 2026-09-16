/**
 * phoneLinkPortalRuntime.ts — PHONE LINK F3 · portal efekt katmanı.
 *
 * F1'in `phoneLinkPortalLifecycle.ts` dosyası "portal ŞU AN çalışmalı mı"
 * kararını SAF olarak veriyordu ve şöyle bitiyordu: *"Gerçek transport
 * bağlanınca bir efekt katmanı bu kararın üzerine start()/stop() çağıracaktır."*
 * BU dosya o efekt katmanıdır — KARARI ÜRETMEZ, yalnız uygular.
 *
 * ── TIMER YOK, POLLING YOK (F3.7/F3.8) ──────────────────────────────────────
 * Bu modülde `setInterval`/`setTimeout` YOKTUR. Üç gerçek olay vardır:
 *   1. Kullanıcı QR ister      → `openGuestPortal()`
 *   2. Portal isteği gelir     → native `portalRequest` olayı
 *   3. Kanonik Music değişir   → `subscribeMusicCanonicalSnapshot`
 * Portal kapalıyken hiçbir abonelik, thread, soket veya sayaç ÇALIŞMAZ.
 *
 * ── TAZELİK NASIL SAĞLANIR (ikinci freshness otoritesi YOK) ─────────────────
 * Native köprü link durumu için olay YAYINLAMAZ (F2 ölçümü) — yalnız
 * `refreshPhoneHubLink()` çekilebilir. Bu yüzden yetki gerektiren yollarda
 * (`/bootstrap`, `/command`) istek işlenmeden ÖNCE bir kez tazeleme yapılır;
 * bu, `phoneLinkAttachment.ts`in kendi dokümantasyonunun tarif ettiği
 * kanonik desendir ("komut göndermeden hemen önce refresh"). Yeni bir tazelik
 * sistemi/timer'ı KURULMAZ.
 *
 * ── KOPUŞ ANINDA NE OLUR (F4'TE DEĞİŞTİ) ────────────────────────────────────
 * F3'te yetki reddi anlıktı ama sunucunun KAPANMASI bir sonraki isteğe/Music
 * olayına/UI çağrısına bağlıydı — native köprü link-state olayı yayınlamadığı
 * için. F4.1 o olayı ekledi; artık kopuşun KENDİSİ tetikleyicidir:
 *
 *   native geçiş → kanonik olay → `phoneLinkLifecycle` zinciri
 *     → otorite düşer (senkron) → akışlar kapanır → sunucu durur
 *
 * Bu modül o zincire KAYNAK SAHİBİ olarak kaydolur (`registerPortalResourceReleaser`).
 * Portal kaynaklarını yalnız bu modül açar/kapatır; PhoneHub native'i HTTP
 * sunucusu BİLMEZ (F4.13 domain sınırı). İstek/Music tetiklemeli tazeleme
 * hâlâ vardır ama artık bir GEREKLİLİK değil, ikinci savunmadır.
 */

import { registerPlugin } from '@capacitor/core';
import { refreshPhoneHubLink } from '../phoneHub/phoneHubLink';
import { subscribeMusicCanonicalSnapshot } from '../media/authority/musicCanonicalSnapshot';
import { getPhoneAttachmentSnapshot } from './phoneLinkAttachment';
import {
  createGuestSession, hasActiveGuestSession, revokeAllGuestSessions,
} from './phoneLinkGuestSession';
import { issueGuestMediaGrant, revokeAllGuestGrants } from './phoneLinkCapabilityGrant';
import { derivePortalDesiredState, type PhoneLinkPortalStatus } from './phoneLinkPortalLifecycle';
import {
  handlePortalRequest, readPortalState, buildPortalStateEvent,
  PORTAL_SHELL_PATH, type PortalHttpRequest,
} from './phoneLinkPortalHttp';
import { buildGuestQrPayload, buildGuestQrDisplayValue, type PhoneLinkQrPayload } from './phoneLinkQrContract';
import {
  registerPortalResourceReleaser, initPhoneLinkLifecycle,
} from './phoneLinkLifecycle';
import { initPhoneHubLinkStateBridge } from '../phoneHub/phoneHubLink';

/* ══════════════════════════════════════════════════════════════════════════
 * Native köprü sözleşmesi — opak taşıma
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkPortalRequestEvent {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly streamKey: string | null;
  readonly authorization: string | null;
  readonly origin: string | null;
  readonly body: string;
  readonly bodyTruncated: boolean;
}

export interface PhoneLinkPortalPlugin {
  start(): Promise<{ started: boolean; ip: string | null; port: number; reason?: string }>;
  stop(): Promise<{ stopped: boolean }>;
  closeStreams(): Promise<void>;
  respond(options: {
    requestId: string; status: number; contentType: string; body: string;
    sseOpen: boolean; streamSessionId: string | null;
  }): Promise<void>;
  pushEvent(options: { frame: string }): Promise<void>;
  getStatus(): Promise<{ running: boolean; ip: string | null; port: number; streamClients: number }>;
  addListener(
    eventName: 'portalRequest',
    listener: (event: PhoneLinkPortalRequestEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export const PhoneLinkPortal = registerPlugin<PhoneLinkPortalPlugin>('PhoneLinkPortal');

/* ══════════════════════════════════════════════════════════════════════════
 * Modül durumu — YALNIZ efekt sahipliği (truth DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkPortalEndpoint {
  readonly ip: string;
  readonly port: number;
  /** `http://ip:port` — Origin denetimi ve QR için. */
  readonly origin: string;
}

let _endpoint: PhoneLinkPortalEndpoint | null = null;
let _removeRequestListener: (() => void) | null = null;
let _removeMusicListener: (() => void) | null = null;
/** Son uygulanan karar — gereksiz start/stop ÇAĞRILMASIN (idempotent). */
let _appliedState: PhoneLinkPortalStatus['state'] = 'STOPPED';

/** Bağlı endpoint (yalnız sunucu gerçekten çalışıyorsa). */
export function getPhoneLinkPortalEndpoint(): PhoneLinkPortalEndpoint | null {
  return _endpoint;
}

/** LAB gözlemlenebilirliği — sır TAŞIMAZ. */
export function getPhoneLinkPortalRuntimeStatus(): {
  readonly running: boolean;
  readonly boundOrigin: string | null;
  readonly appliedState: PhoneLinkPortalStatus['state'];
} {
  return Object.freeze({
    running: _endpoint !== null,
    boundOrigin: _endpoint?.origin ?? null,
    appliedState: _appliedState,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * İstek işleme — native olay → saf yönlendirici → native yanıt
 * ════════════════════════════════════════════════════════════════════════ */

/** Yetki gerektiren yollar: işlemeden ÖNCE canlı link tazelenir. */
const FRESHNESS_REQUIRED_PATHS: ReadonlySet<string> = new Set(['/bootstrap', '/command']);

async function onPortalRequest(event: PhoneLinkPortalRequestEvent): Promise<void> {
  const endpoint = _endpoint;
  if (endpoint === null) {
    /* Sunucu bizim için artık yok — sahte başarı YOK. */
    await PhoneLinkPortal.respond({
      requestId: event.requestId, status: 503,
      contentType: 'text/plain; charset=utf-8', body: 'stopped',
      sseOpen: false, streamSessionId: null,
    }).catch(() => {});
    return;
  }

  if (FRESHNESS_REQUIRED_PATHS.has(event.path)) {
    /* Kanonik tazelik deseni — ikinci bir freshness otoritesi KURULMAZ. */
    await refreshPhoneHubLink().catch(() => {});
  }

  const request: PortalHttpRequest = {
    method: event.method,
    path: event.path,
    streamKey: event.streamKey,
    authorization: event.authorization,
    origin: event.origin,
    body: event.body,
    bodyTruncated: event.bodyTruncated,
    selfOrigin: endpoint.origin,
  };

  let response;
  try {
    response = await handlePortalRequest(request);
  } catch {
    /* Hiçbir iç ayrıntı SIZDIRILMAZ; hata success GÖSTERİLMEZ. */
    response = {
      status: 500, contentType: 'text/plain; charset=utf-8',
      body: 'error', kind: 'BODY' as const,
    };
  }

  await PhoneLinkPortal.respond({
    requestId: event.requestId,
    status: response.status,
    contentType: response.contentType,
    body: response.body,
    sseOpen: response.kind === 'SSE_OPEN',
    streamSessionId: response.kind === 'SSE_OPEN' ? (response.streamSessionId ?? null) : null,
  }).catch(() => {});

  /* İstek bir OLAYDIR — yaşam döngüsü kararını bu olayda yeniden uygula.
   * Oturum bu arada düştüyse sunucu BURADA kapanır (timer gerekmez). */
  await syncGuestPortal();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanonik Music değişimi → PUSH (polling YOK)
 * ════════════════════════════════════════════════════════════════════════ */

async function onCanonicalMusicChanged(): Promise<void> {
  if (_endpoint === null) return;
  /* Oturum düştüyse PUSH YOK: açık akışlar kapatılır (F3.9). */
  if (getPhoneAttachmentSnapshot().state !== 'ACTIVE' || !hasActiveGuestSession()) {
    await PhoneLinkPortal.closeStreams().catch(() => {});
    await syncGuestPortal();
    return;
  }
  const state = await readPortalState();
  if (state === null) {
    await PhoneLinkPortal.closeStreams().catch(() => {});
    return;
  }
  await PhoneLinkPortal.pushEvent({ frame: buildPortalStateEvent(state) }).catch(() => {});
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü uygulaması (F3.8) — kararı `derivePortalDesiredState` verir
 * ════════════════════════════════════════════════════════════════════════ */

async function startPortal(): Promise<boolean> {
  const result = await PhoneLinkPortal.start().catch(() => null);
  if (result === null || !result.started || !result.ip || result.port <= 0) {
    _endpoint = null;
    return false;
  }
  _endpoint = Object.freeze({
    ip: result.ip, port: result.port, origin: `http://${result.ip}:${result.port}`,
  });

  if (_removeRequestListener === null) {
    const handle = await PhoneLinkPortal.addListener('portalRequest', (event) => {
      void onPortalRequest(event);
    }).catch(() => null);
    if (handle !== null) _removeRequestListener = () => { void handle.remove(); };
  }
  if (_removeMusicListener === null) {
    /* Kanonik Music olayına bağlanılır — YENİ timer KURULMAZ (F3.7). */
    _removeMusicListener = subscribeMusicCanonicalSnapshot(() => {
      void onCanonicalMusicChanged();
    });
  }
  return true;
}

async function stopPortal(): Promise<void> {
  _endpoint = null;
  _removeMusicListener?.();
  _removeMusicListener = null;
  _removeRequestListener?.();
  _removeRequestListener = null;
  await PhoneLinkPortal.stop().catch(() => {});
}

/**
 * Kararı UYGULAR. Karar SAF fonksiyondan gelir; burada yeni kural YOKTUR.
 *
 * İdempotent: aynı karar art arda gelirse native'e ikinci kez start/stop
 * ÇAĞRILMAZ (`isPortalTransition` ile aynı amaç).
 */
export async function syncGuestPortal(): Promise<PhoneLinkPortalStatus> {
  const snap = getPhoneAttachmentSnapshot();
  const status = derivePortalDesiredState({
    attachmentState: snap.state,
    hasActiveGuestSession: hasActiveGuestSession(),
  });

  if (status.state === 'RUNNING') {
    if (_appliedState !== 'RUNNING' || _endpoint === null) {
      const ok = await startPortal();
      _appliedState = ok ? 'RUNNING' : 'STOPPED';
    }
  } else if (_appliedState !== 'STOPPED' || _endpoint !== null) {
    await stopPortal();
    _appliedState = 'STOPPED';
  }
  return status;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kullanıcı eylemi — QR aç / kapat
 * ════════════════════════════════════════════════════════════════════════ */

export type GuestPortalOpenFailure =
  | 'LINK_NOT_ACTIVE'      // Phone Link kriptografik oturumu yok
  | 'NO_LOCAL_NETWORK';    // head unit'in ulaşılabilir LAN IPv4'ü yok

export type GuestPortalOpenResult =
  | { readonly ok: true; readonly qr: PhoneLinkQrPayload; readonly qrValue: string; readonly endpoint: PhoneLinkPortalEndpoint }
  | { readonly ok: false; readonly reason: GuestPortalOpenFailure };

/**
 * Misafir portalını açar: canlı link tazelenir → kanonik `MEDIA_CONTROL`
 * grant'ı verilir → guest session üretilir → sunucu başlatılır → QR üretilir.
 *
 * ── EK SÜRÜCÜ ONAYI YOK (F3 ürün kararı) ────────────────────────────────────
 * Grant `issueGuestMediaGrant()` ile verilir; o da ZATEN `ACTIVE` kriptografik
 * oturum şartını arar. İkinci bir onay akışı EKLENMEZ — yeni bir yetki motoru
 * da kurulmaz, F1'in kanonik broker'ı çağrılır.
 *
 * FAIL CLOSED: link `ACTIVE` değilse VEYA ulaşılabilir bir yerel ağ yoksa
 * QR ÜRETİLMEZ — telefonun açamayacağı sahte bir URL GÖSTERİLMEZ.
 */
export async function openGuestPortal(): Promise<GuestPortalOpenResult> {
  /* Kopuş zincirini portal AÇILMADAN ÖNCE bağla — aksi hâlde açılışla ilk
     olay arasında zincirsiz bir pencere kalırdı. İdempotenttir. */
  initGuestPortalLifecycle();
  await refreshPhoneHubLink().catch(() => {});
  /* Kanonik yetenek — portal yalnız bu grant ile komut yürütebilir. */
  const grant = issueGuestMediaGrant();
  const session = grant === null ? null : createGuestSession();
  if (session === null) {
    await syncGuestPortal();
    return { ok: false, reason: 'LINK_NOT_ACTIVE' };
  }

  await syncGuestPortal();
  const endpoint = _endpoint;
  if (endpoint === null) {
    /* Sunucu açılamadı → yetim oturum/grant BIRAKILMAZ. */
    revokeAllGuestSessions();
    revokeAllGuestGrants();
    _appliedState = 'STOPPED';
    return { ok: false, reason: 'NO_LOCAL_NETWORK' };
  }

  const qr = buildGuestQrPayload(session, `${endpoint.origin}${PORTAL_SHELL_PATH}`);
  return { ok: true, qr, qrValue: buildGuestQrDisplayValue(qr), endpoint };
}

/**
 * Misafir erişimini ANINDA sonlandırır: tüm guest session'lar VE
 * `MEDIA_CONTROL` grant'ı iptal, açık akışlar kapatılır, sunucu durur.
 * Token'lar geçersizdir (bellekte hiçbir kayıt kalmaz); yeniden bağlanmada
 * eski QR ÇALIŞMAZ.
 */
export async function closeGuestPortal(): Promise<void> {
  revokeAllGuestSessions();
  revokeAllGuestGrants();
  await PhoneLinkPortal.closeStreams().catch(() => {});
  await stopPortal();
  _appliedState = 'STOPPED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * F4 — kaynak sahipliği kaydı + kanonik olay köprüsü
 * ════════════════════════════════════════════════════════════════════════ */

let _lifecycleDisposers: Array<() => void> = [];

/**
 * Portal runtime'ı kanonik lifecycle zincirine bağlar.
 *
 * İdempotenttir: ikinci çağrı önce var olan kayıtları söker (çift dinleyici
 * ya da çift temizlik YOK). Hiçbir timer KURULMAZ — yalnız olay abonelikleri.
 */
export function initGuestPortalLifecycle(): () => void {
  disposeGuestPortalLifecycle();
  _lifecycleDisposers = [
    /* Native `linkState` olayını TS'e taşır (tarayıcı modunda sessizce no-op). */
    initPhoneHubLinkStateBridge(),
    /* Olayı iptal zincirine bağlar. */
    initPhoneLinkLifecycle(),
    /* Portal KAYNAKLARININ sahibi biziz — zincir bize delege eder. */
    registerPortalResourceReleaser({
      closeStreams: async () => { await PhoneLinkPortal.closeStreams().catch(() => {}); },
      syncPortal: async () => { await syncGuestPortal(); },
    }),
  ];
  return disposeGuestPortalLifecycle;
}

function disposeGuestPortalLifecycle(): void {
  for (const dispose of _lifecycleDisposers) {
    try { dispose(); } catch { /* sökülme hatası diğerlerini engellemez */ }
  }
  _lifecycleDisposers = [];
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkPortalRuntimeForTest(): void {
  disposeGuestPortalLifecycle();
  _endpoint = null;
  _removeMusicListener?.();
  _removeMusicListener = null;
  _removeRequestListener?.();
  _removeRequestListener = null;
  _appliedState = 'STOPPED';
}
