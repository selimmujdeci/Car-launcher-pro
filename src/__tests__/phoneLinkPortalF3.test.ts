/**
 * phoneLinkPortalF3.test.ts — PHONE LINK F3 · SECURITY / LIFECYCLE / MUSIC GATES.
 *
 * F3.14'ün numaralı kapıları BİREBİR kilitlenir (numaralar test adlarındadır).
 *
 *   Authority   1–3    · TRUSTED ≠ PRIMARY, person evidence, guest yetkisi
 *   QR/session  4–10   · bootstrap/one-time/fingerprint/epoch/grant/restart
 *   HTTP        11–19  · auth, gövde, metot, traversal, CORS, log
 *   Lifecycle   20–25  · server ON/OFF, stream kapanışı, yarış, sızıntı
 *   Music       26–30  · exactly-once, ikinci otorite yok, polling yok
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Canlı attachment taklidi (türetimi ayrı dosyada kilitli) ───────────── */
const mockSnapshot = vi.fn();
vi.mock('../platform/phoneLink/phoneLinkAttachment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneLink/phoneLinkAttachment')>();
  return { ...actual, getPhoneAttachmentSnapshot: () => mockSnapshot() };
});

/* ── Kanonik Music kapısı — ÇAĞRI SAYISI ölçülecek ─────────────────────── */
const mediaMocks = vi.hoisted(() => ({
  play: vi.fn(), pause: vi.fn(), next: vi.fn(), previous: vi.fn(),
}));
vi.mock('../platform/media/authority/mediaCommandGateway', () => mediaMocks);

const canonicalSnapshotMock = vi.fn();
vi.mock('../platform/media/authority/musicCanonicalSnapshot', () => ({
  getMusicCanonicalSnapshot: () => canonicalSnapshotMock(),
  subscribeMusicCanonicalSnapshot: () => () => {},
}));

const librarySnapshotMock = vi.fn(() => ({
  revision: 0, tracks: [], albums: [], artists: [], folders: [], availability: 'READY',
}));
vi.mock('../platform/media/musicIndex', () => ({
  getMusicLibrarySnapshot: () => librarySnapshotMock(),
}));

import {
  createGuestSession, exchangeGuestBootstrapToken, validatePortalToken,
  validateStreamToken, hasActiveGuestSession, revokeAllGuestSessions,
  _resetPhoneLinkGuestSessionsForTest,
} from '../platform/phoneLink/phoneLinkGuestSession';
import {
  handlePortalRequest, getPhoneLinkPortalCounters, PORTAL_SHELL_PATH,
  MAX_PORTAL_BODY_BYTES, _resetPhoneLinkPortalHttpForTest,
  type PortalHttpRequest,
} from '../platform/phoneLink/phoneLinkPortalHttp';
import { derivePortalDesiredState } from '../platform/phoneLink/phoneLinkPortalLifecycle';
import { derivePhoneLinkRole } from '../platform/phoneLink/phoneLinkRole';
import {
  issueGuestMediaGrant, _resetPhoneLinkGrantsForTest,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';
import {
  driverAuthenticationStore, bindAuthenticationVehicle,
  _resetDriverAuthenticationStoreForTest,
} from '../platform/fleet/driverAuthentication';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

const SELF_ORIGIN = 'http://192.168.1.42:41337';

function activeSnapshot(overrides: Record<string, unknown> = {}) {
  return { state: 'ACTIVE', role: 'GUEST', roleReason: 'no_driver_authentication', sessionEpoch: 7, deviceFingerprint: 'fp-A', ...overrides };
}
function detachedSnapshot() {
  return { state: 'DETACHED', role: 'GUEST', roleReason: 'link_not_active', sessionEpoch: null, deviceFingerprint: null };
}

function req(overrides: Partial<PortalHttpRequest> = {}): PortalHttpRequest {
  return {
    method: 'GET', path: '/state', streamKey: null, authorization: null,
    origin: null, body: '', bodyTruncated: false, selfOrigin: SELF_ORIGIN,
    ...overrides,
  };
}

/** ACTIVE link + guest session + tamamlanmış bootstrap → çalışır portal. */
function openPortalSession() {
  mockSnapshot.mockReturnValue(activeSnapshot());
  /* Kanonik MEDIA_CONTROL grant'ı — `openGuestPortal()` üretimde bunu verir. */
  issueGuestMediaGrant();
  const session = createGuestSession()!;
  const exchange = exchangeGuestBootstrapToken(session.token);
  if (!exchange.ok) throw new Error('bootstrap exchange beklenmedik şekilde reddedildi');
  return { session, credential: exchange.credential };
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  _resetPhoneLinkGuestSessionsForTest();
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkPortalHttpForTest();
  _resetDriverAuthenticationStoreForTest();
  mockSnapshot.mockReset().mockReturnValue(detachedSnapshot());
  mediaMocks.play.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.pause.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.next.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.previous.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  canonicalSnapshotMock.mockReset().mockReturnValue({
    authorityAvailable: true, activeSource: 'LOCAL', focusState: 'GAIN',
    audioRoute: 'SPEAKER', playing: true, queueEntryIds: [], currentIndex: null,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * AUTHORITY (1–3)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F3.0 Authority', () => {
  it('1. TRUSTED device tek başına PRIMARY olmaz', () => {
    /* Kriptografik olarak kurulmuş + güvenilen cihaz: yine de GUEST. */
    const evidence = derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: 'fp-trusted', nowMs: 1_000,
    });
    expect(evidence.role).toBe('GUEST');
    expect(evidence.reason).toBe('no_driver_authentication');
  });

  it('2. PRIMARY yalnız kanonik person/driver kanıtıyla mümkün — PARTIAL kanıt DEĞİL', () => {
    /* Telefon kaynaklı doğrulama kanonik otoritede tavan olarak PARTIAL'dır. */
    bindAuthenticationVehicle('veh-1');
    driverAuthenticationStore.record({
      driverId: 'drv-1', vehicleId: 'veh-1', authenticationSource: 'PHONE',
      authenticationLevel: 'VERIFIED', verifiedAt: 1_000, expiresAt: 9_000_000,
      sessionId: 'sess-1',
    }, 2_000);
    const evidence = derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: 'fp-A', nowMs: 2_000,
    });
    expect(evidence.role).toBe('GUEST');
    expect(evidence.reason).toBe('driver_authentication_not_proof');
  });

  it('2b. VERIFIED kişi kanıtı VARKEN bile cihaz↔kişi bağı yoksa PRIMARY ÜRETİLMEZ', () => {
    /* NFC = kanonik tavanı VERIFIED olan tek gerçek kimlik kanıtı. */
    bindAuthenticationVehicle('veh-1');
    driverAuthenticationStore.record({
      driverId: 'drv-1', vehicleId: 'veh-1', authenticationSource: 'NFC',
      authenticationLevel: 'VERIFIED', verifiedAt: 1_000, expiresAt: 9_000_000,
      sessionId: 'sess-nfc',
    }, 2_000);
    const evidence = derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: 'fp-A', nowMs: 2_000,
    });
    /* Kişi kanıtlandı — ama "BU telefon O kişinin" diyen kanonik bağ YOK. */
    expect(evidence.role).toBe('GUEST');
    expect(evidence.reason).toBe('no_device_person_binding');
  });

  it('3. Guest MEDIA_CONTROL dışında yetki alamaz — portal komut allowlist tam 4 komuttur', async () => {
    const { credential } = openPortalSession();
    for (const forbidden of ['UNLOCK', 'START_ENGINE', 'GET_QUEUE', 'SET_VOLUME', 'NAVIGATE']) {
      const res = await handlePortalRequest(req({
        method: 'POST', path: '/command', ...bearer(credential.portalToken),
        body: JSON.stringify({ c: forbidden }),
      }));
      expect(res.status, forbidden).toBe(400);
    }
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * QR / SESSION (4–10)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F3.3 QR / bootstrap', () => {
  it('4. expired bootstrap reject', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const session = createGuestSession()!;
    const res = await handlePortalRequest(req({
      method: 'POST', path: '/bootstrap', body: JSON.stringify({ t: session.token }),
    }), session.expiresAt + 1);
    expect(res.status).toBe(401);
    expect(getPhoneLinkPortalCounters().bootstrapAccepted).toBe(0);
  });

  it('5. reused one-time token reject (QR ekran görüntüsü ikinci telefonda)', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const session = createGuestSession()!;
    const first = await handlePortalRequest(req({
      method: 'POST', path: '/bootstrap', body: JSON.stringify({ t: session.token }),
    }));
    expect(first.status).toBe(200);
    const second = await handlePortalRequest(req({
      method: 'POST', path: '/bootstrap', body: JSON.stringify({ t: session.token }),
    }));
    expect(second.status).toBe(409);
    expect(getPhoneLinkPortalCounters().lastRejectReason).toBe('bootstrap_consumed');
  });

  it('6. wrong fingerprint reject — portal token başka cihazın oturumunda çalışmaz', async () => {
    const { credential } = openPortalSession();
    mockSnapshot.mockReturnValue(activeSnapshot({ deviceFingerprint: 'fp-OTHER' }));
    expect(validatePortalToken(credential.portalToken)).toBeNull();
    const res = await handlePortalRequest(req({ path: '/state', ...bearer(credential.portalToken) }));
    expect(res.status).toBe(401);
  });

  it('7. wrong sessionEpoch reject', async () => {
    const { credential } = openPortalSession();
    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 8 }));
    const res = await handlePortalRequest(req({ path: '/state', ...bearer(credential.portalToken) }));
    expect(res.status).toBe(401);
  });

  it('8. wrong grantId reject — grant iptal edilince komut kanonik kapıya GİTMEZ', async () => {
    const { credential } = openPortalSession();
    _resetPhoneLinkGrantsForTest();          // grant kaydı yok edildi
    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: JSON.stringify({ c: 'PLAY' }),
    }));
    expect(res.status).toBe(401);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('9. reconnect sonrası eski token reject (epoch ilerledi)', async () => {
    const { credential } = openPortalSession();
    mockSnapshot.mockReturnValue(detachedSnapshot());
    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 9 }));
    expect(validatePortalToken(credential.portalToken)).toBeNull();
    expect(validateStreamToken(credential.streamToken)).toBeNull();
  });

  it('10. process-restart state restore EDİLMEZ (yalnız bellek)', () => {
    const { credential } = openPortalSession();
    expect(validatePortalToken(credential.portalToken)).not.toBeNull();
    /* Yeniden başlatma = modül belleğinin sıfırlanması. */
    _resetPhoneLinkGuestSessionsForTest();
    expect(validatePortalToken(credential.portalToken)).toBeNull();
    expect(hasActiveGuestSession()).toBe(false);

    /* Kalıcılık yolu kodda da YOKTUR — statik kanıt. */
    const src = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkGuestSession.ts'), 'utf8');
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|Preferences|Filesystem/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * HTTP (11–19)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F3.11 HTTP güvenlik yüzeyi', () => {
  it('11. auth olmadan command reject — kanonik Music kapısına HİÇ ulaşmaz', async () => {
    openPortalSession();
    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', body: JSON.stringify({ c: 'PLAY' }),
    }));
    expect(res.status).toBe(401);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('11b. akış anahtarı KOMUT veremez (salt-okunur ayrımı)', async () => {
    const { credential } = openPortalSession();
    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.streamToken),
      body: JSON.stringify({ c: 'PLAY' }),
    }));
    expect(res.status).toBe(401);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('12. malformed body reject', async () => {
    const { credential } = openPortalSession();
    for (const body of ['', 'not json', '[]', '{"c":123}', 'null']) {
      const res = await handlePortalRequest(req({
        method: 'POST', path: '/command', ...bearer(credential.portalToken), body,
      }));
      expect(res.status, body).toBe(400);
    }
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('13. oversized body reject', async () => {
    const { credential } = openPortalSession();
    const huge = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: 'x'.repeat(MAX_PORTAL_BODY_BYTES + 1),
    }));
    expect(huge.status).toBe(413);

    /* Native kestiyse tahmin YÜRÜTÜLMEZ — yine 413. */
    const truncated = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: JSON.stringify({ c: 'PLAY' }), bodyTruncated: true,
    }));
    expect(truncated.status).toBe(413);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('14. unknown command reject', async () => {
    const { credential } = openPortalSession();
    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: JSON.stringify({ c: 'SELF_DESTRUCT' }),
    }));
    expect(res.status).toBe(400);
  });

  it('15. path traversal reject', async () => {
    const { credential } = openPortalSession();
    const paths = [
      '/../../../etc/passwd', '/p/../../secret', '/./p', '/%2e%2e/config',
      '/assets/index.js', '/index.html', '/', '/p/', '/command/../state',
    ];
    for (const path of paths) {
      const res = await handlePortalRequest(req({ path, ...bearer(credential.portalToken) }));
      expect(res.status, path).toBe(404);
    }
  });

  it('16. unsupported method reject', async () => {
    const { credential } = openPortalSession();
    const cases: Array<[string, string]> = [
      ['PUT', '/command'], ['DELETE', '/command'], ['POST', '/state'],
      ['POST', PORTAL_SHELL_PATH], ['PUT', '/bootstrap'], ['POST', '/events'],
      ['TRACE', '/state'], ['OPTIONS', '/command'],
    ];
    for (const [method, path] of cases) {
      const res = await handlePortalRequest(req({ method, path, ...bearer(credential.portalToken) }));
      expect(res.status, `${method} ${path}`).toBe(405);
    }
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('17. arbitrary file access reject — servis edilen dosya kümesi BOŞ', () => {
    const src = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkPortalHttp.ts'), 'utf8');
    /* TS yönlendiricisi dosya sistemine HİÇ dokunmaz. */
    expect(src).not.toMatch(/readFile|createReadStream|node:fs|from 'fs'/);
    const java = readFileSync(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneLinkPortalServer.java'), 'utf8');
    /* Native sunucu da dosya OKUMAZ — statik kök YOKTUR. */
    expect(java).not.toMatch(/FileInputStream|getAssets\(\)|new File\(/);
  });

  it('18. CORS wildcard YOK — hiçbir yanıtta CORS başlığı üretilmez', () => {
    const tsSrc = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkPortalHttp.ts'), 'utf8');
    const javaSrc = readFileSync(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneLinkPortalServer.java'), 'utf8');
    for (const [name, src] of [['ts', tsSrc], ['java', javaSrc]] as const) {
      expect(src, name).not.toMatch(/Access-Control-Allow-Origin/);
      expect(src, name).not.toMatch(/Access-Control-Allow-\*/);
    }
    /* Güvenlik başlıkları ise GERÇEKTEN yazılıyor. */
    expect(javaSrc).toMatch(/X-Content-Type-Options: nosniff/);
    expect(javaSrc).toMatch(/Content-Security-Policy: default-src 'none'/);
  });

  it('18b. yabancı Origin reddedilir (CSRF derinliği)', async () => {
    const { credential } = openPortalSession();
    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      origin: 'http://evil.example', body: JSON.stringify({ c: 'PLAY' }),
    }));
    expect(res.status).toBe(403);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('19. token loglara dusmez — yanıt gövdeleri ve sayaçlar sır TAŞIMAZ', async () => {
    const { credential } = openPortalSession();
    const state = await handlePortalRequest(req({ path: '/state', ...bearer(credential.portalToken) }));
    expect(state.body).not.toContain(credential.portalToken);
    expect(state.body).not.toContain(credential.streamToken);
    expect(state.body).not.toContain('fp-A');

    const counters = JSON.stringify(getPhoneLinkPortalCounters());
    expect(counters).not.toContain(credential.portalToken);
    expect(counters).not.toContain('fp-A');

    /* Portal katmanlarinin hicbiri console cagirmaz. */
    for (const file of ['phoneLinkPortalHttp.ts', 'phoneLinkPortalRuntime.ts', 'phoneLinkGuestSession.ts']) {
      const src = readFileSync(resolve(__dirname, '../platform/phoneLink/', file), 'utf8');
      expect(src, file).not.toMatch(/console\.(log|warn|error|info|debug)\(/);
    }
  });

  it('19b. hız sınırı sınırlıdır ve TIMER kullanmaz', async () => {
    const { credential } = openPortalSession();
    let limited = false;
    for (let i = 0; i < 60; i += 1) {
      const res = await handlePortalRequest(
        req({ path: '/state', ...bearer(credential.portalToken) }), 1_000);
      if (res.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
    const src = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkPortalHttp.ts'), 'utf8');
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE (20–25)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F3.8/F3.9 Lifecycle', () => {
  it('20. no GuestSession → server OFF', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    expect(hasActiveGuestSession()).toBe(false);
    expect(derivePortalDesiredState({
      attachmentState: 'ACTIVE', hasActiveGuestSession: hasActiveGuestSession(),
    })).toEqual({ state: 'STOPPED', reason: 'no_active_guest_session' });
  });

  it('21. first valid GuestSession → server START', () => {
    openPortalSession();
    expect(hasActiveGuestSession()).toBe(true);
    expect(derivePortalDesiredState({
      attachmentState: 'ACTIVE', hasActiveGuestSession: hasActiveGuestSession(),
    })).toEqual({ state: 'RUNNING', reason: 'active_guest_session' });
  });

  it('22. last GuestSession revoke → server STOP', () => {
    openPortalSession();
    revokeAllGuestSessions();
    expect(hasActiveGuestSession()).toBe(false);
    expect(derivePortalDesiredState({
      attachmentState: 'ACTIVE', hasActiveGuestSession: hasActiveGuestSession(),
    }).state).toBe('STOPPED');
  });

  it('23. session drop - acik client kapatilir (tokenlar ANINDA gecersiz)', async () => {
    const { credential } = openPortalSession();
    mockSnapshot.mockReturnValue(detachedSnapshot());

    expect(validatePortalToken(credential.portalToken)).toBeNull();
    expect(validateStreamToken(credential.streamToken)).toBeNull();
    const stream = await handlePortalRequest(req({
      path: '/events', streamKey: credential.streamToken,
    }));
    expect(stream.status).toBe(401);
    expect(derivePortalDesiredState({
      attachmentState: 'DETACHED', hasActiveGuestSession: hasActiveGuestSession(),
    }).state).toBe('STOPPED');
  });

  it('24. session drop YARIŞI — istek geldi, oturum düştü ⇒ music dispatch OLMAZ', async () => {
    const { credential } = openPortalSession();

    /* Yarış: yetki okumaları sırasında oturum DÜŞÜYOR. İlk okuma hâlâ ACTIVE
       görür (istek "geçerli" görünerek girer), sonraki her okuma DETACHED. */
    let reads = 0;
    mockSnapshot.mockImplementation(() => {
      reads += 1;
      return reads <= 1 ? activeSnapshot() : detachedSnapshot();
    });

    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: JSON.stringify({ c: 'PLAY' }),
    }));

    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(mediaMocks.play).not.toHaveBeenCalled();
    expect(mediaMocks.next).not.toHaveBeenCalled();
  });

  it('25. listener/socket sızıntısı YOK — native stop() her şeyi kapatır', () => {
    const java = readFileSync(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneLinkPortalServer.java'), 'utf8');
    /* stop(): dinleme soketi + tüm akışlar + bekleyen kuyruklar. */
    expect(java).toMatch(/public synchronized void stop\(\)/);
    expect(java).toMatch(/closeAllStreams\(\)/);
    expect(java).toMatch(/pending\.clear\(\)/);
    /* Yazma hatasında istemci kaydı DÜŞER (yetim soket kalmaz). */
    expect(java).toMatch(/streamClients\.remove/);
    /* Tum threadler daemon — uygulama kapanışını ASMAZ. */
    expect(java).toMatch(/setDaemon\(true\)/);
    /* Wake lock / foreground service / alarm YOK. */
    expect(java).not.toMatch(/WakeLock|startForeground|AlarmManager/);

    /* TS runtime stop yolunda her iki aboneliği de söker. */
    const ts = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkPortalRuntime.ts'), 'utf8');
    expect(ts).toMatch(/_removeMusicListener = null;/);
    expect(ts).toMatch(/_removeRequestListener = null;/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * MUSIC (26–30)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F3.6/F3.7 Kanonik Music', () => {
  it('26. PLAY exactly once kanonik gateway cagrilir', async () => {
    const { credential } = openPortalSession();
    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: JSON.stringify({ c: 'PLAY' }),
    }));
    expect(res.status).toBe(200);
    expect(mediaMocks.play).toHaveBeenCalledTimes(1);
    expect(mediaMocks.pause).not.toHaveBeenCalled();
    expect(mediaMocks.next).not.toHaveBeenCalled();
    expect(mediaMocks.previous).not.toHaveBeenCalled();
  });

  it('27. NEXT exactly once gider (PAUSE/PREVIOUS de tam bir kez)', async () => {
    const { credential } = openPortalSession();
    for (const [command, spy] of [
      ['NEXT', mediaMocks.next], ['PAUSE', mediaMocks.pause], ['PREVIOUS', mediaMocks.previous],
    ] as const) {
      const res = await handlePortalRequest(req({
        method: 'POST', path: '/command', ...bearer(credential.portalToken),
        body: JSON.stringify({ c: command }),
      }));
      expect(res.status, command).toBe(200);
      expect(spy, command).toHaveBeenCalledTimes(1);
    }
  });

  it('28. ikinci playback authority YOK — portal doğrudan player/backend çağırmaz', () => {
    for (const file of ['phoneLinkPortalHttp.ts', 'phoneLinkPortalRuntime.ts', 'phoneLinkPortalAsset.ts']) {
      const src = readFileSync(resolve(__dirname, '../platform/phoneLink/', file), 'utf8');
      expect(src, file).not.toMatch(/carosMediaLayer|backendAdapters|pipedProvider|youtubeService|videoModeStore/);
      expect(src, file).not.toMatch(/new Audio\(|HTMLAudioElement|\.play\(\)/);
    }
    /* Komut yolu TEK adaptörden geçer: gateway DOĞRUDAN import EDİLMEZ. */
    const http = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkPortalHttp.ts'), 'utf8');
    expect(http).toMatch(/dispatchGuestMusicCommand/);
    expect(http).not.toMatch(/^import .*mediaCommandGateway/m);
  });

  it('29. portal kanonik Music state OKUR - kendi kopyasini tutmaz', async () => {
    const { credential } = openPortalSession();
    canonicalSnapshotMock.mockReturnValue({
      authorityAvailable: true, activeSource: 'LOCAL', focusState: 'GAIN',
      audioRoute: 'SPEAKER', playing: false,
      queueEntryIds: ['t1', 't2', 't3'], currentIndex: 1,
    });
    librarySnapshotMock.mockReturnValue({
      revision: 1, albums: [], artists: [], folders: [], availability: 'READY',
      tracks: [{ id: 't2', title: 'Ikinci', artist: 'Sanatci', album: 'Kayit', artworkIdentity: null }],
    } as unknown as ReturnType<typeof librarySnapshotMock>);

    const res = await handlePortalRequest(req({ path: '/state', ...bearer(credential.portalToken) }));
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.state).toEqual({
      title: 'Ikinci', artist: 'Sanatci', album: 'Kayit', playing: false, queueCount: 3,
    });
    /* Artwork kimliği (dosya yolu olabilir) ağa ÇIKARILMAZ. */
    expect(res.body).not.toContain('artwork');
  });

  it('30. polling YOK - ne portal sayfasinda ne runtime tarafinda timer var', () => {
    const asset = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkPortalAsset.ts'), 'utf8');
    /* Tarayıcı tarafı: EventSource var, setInterval/setTimeout YOK. */
    const script = asset.slice(asset.indexOf('<script>'));
    expect(script).toMatch(/new EventSource\(/);
    expect(script).not.toMatch(/setInterval|setTimeout/);

    const runtime = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkPortalRuntime.ts'), 'utf8');
    expect(runtime).not.toMatch(/setInterval\(|setTimeout\(/);
    /* Push kanonik Music olayına bağlıdır — yeni timer kurulmaz. */
    expect(runtime).toMatch(/subscribeMusicCanonicalSnapshot/);

    const java = readFileSync(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneLinkPortalServer.java'), 'utf8');
    expect(java).not.toMatch(/ScheduledExecutorService|Timer\(|postDelayed/);
  });
});
