/**
 * phoneLinkLifecycleF4.test.ts — PHONE LINK F4 · LIFECYCLE / RACE / MULTI-PHONE.
 *
 * F4.17 kapilari birebir (numaralar test adlarindadir).
 *
 *   Lifecycle   1-9    · event -> authority -> cascade, olaysiz/timersiz
 *   Ordering    10-13  · stale epoch, idempotent, dedupe, unsubscribe
 *   Race        14-17  · A/B/C/D siniri
 *   Multi-phone 18-24  · capability isolation, global authority yok
 *   Role        25-26  · TRUSTED != PRIMARY
 *   Performance 27-30  · timer/polling/idle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Canli attachment taklidi (turetimi ayri dosyada kilitli) ───────────── */
const mockSnapshot = vi.fn();
vi.mock('../platform/phoneLink/phoneLinkAttachment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneLink/phoneLinkAttachment')>();
  return { ...actual, getPhoneAttachmentSnapshot: () => mockSnapshot() };
});

/* ── Kanonik Music kapisi — CAGRI SAYISI olculecek ──────────────────────── */
const mediaMocks = vi.hoisted(() => ({
  play: vi.fn(), pause: vi.fn(), next: vi.fn(), previous: vi.fn(),
}));
vi.mock('../platform/media/authority/mediaCommandGateway', () => mediaMocks);

const canonicalSnapshotMock = vi.fn();
vi.mock('../platform/media/authority/musicCanonicalSnapshot', () => ({
  getMusicCanonicalSnapshot: () => canonicalSnapshotMock(),
  subscribeMusicCanonicalSnapshot: () => () => {},
}));

vi.mock('../platform/media/musicIndex', () => ({
  getMusicLibrarySnapshot: () => ({
    revision: 0, tracks: [], albums: [], artists: [], folders: [], availability: 'READY',
  }),
}));

import {
  ingestPhoneHubLinkStateEvent, subscribePhoneHubLinkState, getPhoneHubLinkState,
  _resetPhoneHubLinkStateForTest,
  type PhoneHubLinkStateEvent,
} from '../platform/phoneHub/phoneHubLink';
import {
  handlePhoneHubLinkStateEvent, applyPhoneLinkRevocationCascade,
  registerPortalResourceReleaser, linkStateToAttachment,
  getPhoneLinkLifecycleTelemetry, initPhoneLinkLifecycle,
  _resetPhoneLinkLifecycleForTest,
} from '../platform/phoneLink/phoneLinkLifecycle';
import {
  isSessionLive, activeRuntimeSessionCount, listRuntimeSessions, sessionKey,
  isPhoneLinkEventModeEngaged, removeRuntimeSession,
  _resetPhoneLinkSessionRegistryForTest,
} from '../platform/phoneLink/phoneLinkSessionRegistry';
import {
  createGuestSession, exchangeGuestBootstrapToken, validatePortalToken,
  validateStreamToken, hasActiveGuestSession, activeGuestSessionCount,
  _resetPhoneLinkGuestSessionsForTest,
} from '../platform/phoneLink/phoneLinkGuestSession';
import {
  issueGuestMediaGrant, getActiveGuestGrant, recordedGrantCount,
  _resetPhoneLinkGrantsForTest,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';
import {
  handlePortalRequest, _resetPhoneLinkPortalHttpForTest,
  type PortalHttpRequest,
} from '../platform/phoneLink/phoneLinkPortalHttp';
import { derivePhoneLinkRole } from '../platform/phoneLink/phoneLinkRole';
import {
  driverAuthenticationStore, bindAuthenticationVehicle,
  _resetDriverAuthenticationStoreForTest,
} from '../platform/fleet/driverAuthentication';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardimcilar
 * ════════════════════════════════════════════════════════════════════════ */

const SELF_ORIGIN = 'http://192.168.1.42:41337';

const FP_A = 'fp-alpha';
const FP_B = 'fp-beta';
const EPOCH_A = 11;
const EPOCH_B = 22;

function snapshotFor(fingerprint: string, epoch: number) {
  return {
    state: 'ACTIVE', role: 'GUEST', roleReason: 'no_driver_authentication',
    sessionEpoch: epoch, deviceFingerprint: fingerprint,
  };
}
function detachedSnapshot() {
  return {
    state: 'DETACHED', role: 'GUEST', roleReason: 'link_not_active',
    sessionEpoch: null, deviceFingerprint: null,
  };
}

function event(
  state: PhoneHubLinkStateEvent['state'],
  epoch: number | null,
  fingerprint: string | null,
  reason: PhoneHubLinkStateEvent['reason'] = 'REMOTE_DISCONNECT',
) {
  return {
    protocolVersion: 1, state, sessionEpoch: epoch,
    deviceFingerprint: fingerprint, reason,
  };
}

/** Kanonik olayi YUTMA katmanindan gecirip zinciri calistirir (gercek yol). */
async function deliver(
  state: PhoneHubLinkStateEvent['state'],
  epoch: number | null,
  fingerprint: string | null,
  reason: PhoneHubLinkStateEvent['reason'] = 'REMOTE_DISCONNECT',
): Promise<boolean> {
  const accepted = ingestPhoneHubLinkStateEvent(event(state, epoch, fingerprint, reason));
  /* Abonelik zinciri senkron tetiklenir; async kuyrugun bosalmasini bekle. */
  await Promise.resolve();
  await Promise.resolve();
  return accepted;
}

/** Bir telefon icin: ESTABLISHED + grant + guest session + portal kimlikleri. */
async function bringUpPhone(fingerprint: string, epoch: number) {
  await deliver('ESTABLISHED', epoch, fingerprint, 'UNKNOWN');
  mockSnapshot.mockReturnValue(snapshotFor(fingerprint, epoch));
  issueGuestMediaGrant();
  const session = createGuestSession()!;
  const exchange = exchangeGuestBootstrapToken(session.token);
  if (!exchange.ok) throw new Error('bootstrap reddedildi: ' + fingerprint);
  return { session, credential: exchange.credential };
}

function req(overrides: Partial<PortalHttpRequest> = {}): PortalHttpRequest {
  return {
    method: 'GET', path: '/state', streamKey: null, authorization: null,
    origin: null, body: '', bodyTruncated: false, selfOrigin: SELF_ORIGIN,
    ...overrides,
  };
}
function bearer(token: string) { return { authorization: `Bearer ${token}` }; }

/** Kaynak serbest birakici casusu — HTTP/Music/UI olmadan cagrilmali. */
function spyReleaser() {
  const closeStreams = vi.fn(async () => {});
  const syncPortal = vi.fn(async () => {});
  registerPortalResourceReleaser({ closeStreams, syncPortal });
  return { closeStreams, syncPortal };
}

beforeEach(() => {
  _resetPhoneHubLinkStateForTest();
  _resetPhoneLinkLifecycleForTest();
  _resetPhoneLinkSessionRegistryForTest();
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
  initPhoneLinkLifecycle();
});

/* ══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE (1-9)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4.5/F4.6 Lifecycle', () => {
  it('1. ESTABLISHED event ACTIVE uretir', async () => {
    expect(isPhoneLinkEventModeEngaged()).toBe(false);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(isPhoneLinkEventModeEngaged()).toBe(true);
    expect(linkStateToAttachment('ESTABLISHED')).toBe('ACTIVE');
    expect(isSessionLive(FP_A, EPOCH_A)).toBe(true);
    expect(activeRuntimeSessionCount()).toBe(1);
  });

  it('2. DISCONNECTED event DETACHED uretir', async () => {
    await bringUpPhone(FP_A, EPOCH_A);
    expect(isSessionLive(FP_A, EPOCH_A)).toBe(true);
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'REMOTE_DISCONNECT');
    expect(linkStateToAttachment('DISCONNECTED')).toBe('DETACHED');
    expect(isSessionLive(FP_A, EPOCH_A)).toBe(false);
    expect(activeRuntimeSessionCount()).toBe(0);
  });

  it('3. FAILED event otoriteyi dusurur', async () => {
    await bringUpPhone(FP_A, EPOCH_A);
    await deliver('FAILED', EPOCH_A, FP_A, 'AUTH_FAILED');
    expect(linkStateToAttachment('FAILED')).toBe('DETACHED');
    expect(isSessionLive(FP_A, EPOCH_A)).toBe(false);
    expect(getActiveGuestGrant(Date.now(), { deviceFingerprint: FP_A, sessionEpoch: EPOCH_A }))
      .toBeNull();
  });

  it('3b. CONNECTING/AUTHENTICATING/DEGRADED yetki VERMEZ (LINKED)', async () => {
    for (const state of ['CONNECTING', 'AUTHENTICATING', 'DEGRADED'] as const) {
      expect(linkStateToAttachment(state)).toBe('LINKED');
    }
    await deliver('DEGRADED', EPOCH_A, FP_A, 'TRANSPORT_LOST');
    expect(isSessionLive(FP_A, EPOCH_A)).toBe(false);
  });

  it('4. disconnect GuestSession revoke eder', async () => {
    const { credential } = await bringUpPhone(FP_A, EPOCH_A);
    expect(validatePortalToken(credential.portalToken)).not.toBeNull();
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    expect(validatePortalToken(credential.portalToken)).toBeNull();
    expect(validateStreamToken(credential.streamToken)).toBeNull();
    expect(activeGuestSessionCount()).toBe(0);
    expect(hasActiveGuestSession()).toBe(false);
  });

  it('5. disconnect grant gecersiz yapar', async () => {
    await bringUpPhone(FP_A, EPOCH_A);
    expect(recordedGrantCount()).toBe(1);
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    expect(recordedGrantCount()).toBe(0);
    expect(getActiveGuestGrant(Date.now(), { deviceFingerprint: FP_A, sessionEpoch: EPOCH_A }))
      .toBeNull();
  });

  it('6. disconnect SSE akislarini kapatir', async () => {
    const releaser = spyReleaser();
    await bringUpPhone(FP_A, EPOCH_A);
    releaser.closeStreams.mockClear();
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    expect(releaser.closeStreams).toHaveBeenCalledTimes(1);
  });

  it('7. son guest disconnect olunca portal STOP istenir', async () => {
    const releaser = spyReleaser();
    await bringUpPhone(FP_A, EPOCH_A);
    releaser.syncPortal.mockClear();
    const result = await applyPhoneLinkRevocationCascade(FP_A, EPOCH_A, 'REMOTE_DISCONNECT');
    expect(result.portalStopRequested).toBe(true);
    expect(releaser.syncPortal).toHaveBeenCalled();
  });

  it('8. HTTP/Music/UI olayi BEKLENMEZ — temizlik yalniz lifecycle olayiyla olur', async () => {
    const releaser = spyReleaser();
    const { credential } = await bringUpPhone(FP_A, EPOCH_A);
    releaser.closeStreams.mockClear();
    releaser.syncPortal.mockClear();

    /* TEK girdi: native lifecycle olayi. Hicbir HTTP istegi gonderilmiyor,
       hicbir Music olayi tetiklenmiyor, hicbir UI fonksiyonu cagrilmiyor. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'TRANSPORT_LOST');

    expect(releaser.closeStreams).toHaveBeenCalledTimes(1);
    expect(releaser.syncPortal).toHaveBeenCalledTimes(1);
    expect(validatePortalToken(credential.portalToken)).toBeNull();
    expect(recordedGrantCount()).toBe(0);
    expect(activeRuntimeSessionCount()).toBe(0);
    expect(getPhoneLinkLifecycleTelemetry().lastCleanupReason).toBe('TRANSPORT_LOST');
  });

  it('8b. SIRA: guvenlik gercegi kaynak temizliginden ONCE duser', async () => {
    const order: string[] = [];
    registerPortalResourceReleaser({
      closeStreams: async () => {
        /* Kaynak temizligi CAGRILDIGINDA otorite COKTAN dusmus olmali. */
        order.push(`closeStreams:live=${isSessionLive(FP_A, EPOCH_A)}`);
      },
      syncPortal: async () => {
        order.push(`syncPortal:grants=${recordedGrantCount()}`);
      },
    });
    await bringUpPhone(FP_A, EPOCH_A);
    order.length = 0;   // kurulum sirasindaki ESTABLISHED cagrisi olcume girmez
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    expect(order).toEqual(['closeStreams:live=false', 'syncPortal:grants=0']);
  });

  it('9. temizlik TIMER gerektirmez — zincir tek senkron gecise baglidir', () => {
    for (const file of ['phoneLinkLifecycle.ts', 'phoneLinkSessionRegistry.ts']) {
      const src = readFileSync(resolve(__dirname, '../platform/phoneLink/', file), 'utf8');
      expect(src, file).not.toMatch(/setInterval\(|setTimeout\(/);
    }
    const bridge = readFileSync(
      resolve(__dirname, '../platform/phoneHub/phoneHubLink.ts'), 'utf8');
    expect(bridge).not.toMatch(/setInterval\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ORDERING (10-13)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4.2/F4.7 Ordering', () => {
  it('10. eski nesil disconnect YENI epoch-u oldurmez (Race D)', async () => {
    await bringUpPhone(FP_A, EPOCH_A);
    /* Yeniden baglanma: ayni cihaz, YENI nesil. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    const fresh = await bringUpPhone(FP_A, EPOCH_B);
    expect(isSessionLive(FP_A, EPOCH_B)).toBe(true);

    /* GEC gelen ESKI nesil kopus olayi: zincir (fingerprint, epoch) CIFTINE
       hedeflidir, bu yuzden eski cifti silmek NO-OP olur ve yeni oturuma
       DOKUNMAZ. Onemli olan olayin dusurulmesi degil, ETKISIZ olmasidir. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'TRANSPORT_LOST');
    expect(isSessionLive(FP_A, EPOCH_B)).toBe(true);
    expect(validatePortalToken(fresh.credential.portalToken)).not.toBeNull();
    expect(activeGuestSessionCount()).toBe(1);
  });

  it('11. duplicate disconnect idempotenttir', async () => {
    await bringUpPhone(FP_A, EPOCH_A);
    const first = await applyPhoneLinkRevocationCascade(FP_A, EPOCH_A, 'REMOTE_DISCONNECT');
    const second = await applyPhoneLinkRevocationCascade(FP_A, EPOCH_A, 'REMOTE_DISCONNECT');
    expect(first.revokedGuestSessions).toBe(1);
    expect(first.revokedGrants).toBe(1);
    expect(second.revokedGuestSessions).toBe(0);
    expect(second.revokedGrants).toBe(0);
    expect(second.removedRuntimeSessions).toBe(0);
  });

  it('12. duplicate ESTABLISHED kayit COGALTMAZ', async () => {
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    const again = await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(again).toBe(false);                       // yutma katmani dedupe etti
    expect(listRuntimeSessions()).toHaveLength(1);
    /* Zincire dogrudan iki kez verilse bile indeks tekil kalir. */
    await handlePhoneHubLinkStateEvent(
      event('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN') as PhoneHubLinkStateEvent);
    expect(listRuntimeSessions()).toHaveLength(1);
  });

  it('13. unsubscribe sonrasi callback YOK; abone hatasi digerlerini bozmaz', async () => {
    const seen: string[] = [];
    const bad = () => { throw new Error('abone patladi'); };
    const good = (e: PhoneHubLinkStateEvent) => { seen.push(e.state); };
    const offBad = subscribePhoneHubLinkState(bad);
    const offGood = subscribePhoneHubLinkState(good);

    /* Ayni fonksiyon iki kez eklenirse TEK kayit olur. */
    subscribePhoneHubLinkState(good);

    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(seen).toEqual(['ESTABLISHED']);           // patlayan abone digerini bozmadi

    offGood();
    offBad();
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    expect(seen).toEqual(['ESTABLISHED']);           // sokulen abone CAGRILMADI
  });

  it('13b. epoch semantigi: ayni oturum = ayni epoch, reconnect = farkli epoch', async () => {
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneHubLinkState()?.sessionEpoch).toBe(EPOCH_A);
    /* Ayni canli oturumda tekrar olay: epoch DEGISMEZ. */
    await deliver('DEGRADED', EPOCH_A, FP_A, 'TRANSPORT_LOST');
    expect(getPhoneHubLinkState()?.sessionEpoch).toBe(EPOCH_A);
    /* Yeniden baglanma: FARKLI epoch. */
    await deliver('ESTABLISHED', EPOCH_B, FP_A, 'UNKNOWN');
    expect(getPhoneHubLinkState()?.sessionEpoch).toBe(EPOCH_B);
    /* Ayni cift iki kez ayni anahtari uretir; farkli cift ASLA carpismaz. */
    expect(sessionKey(FP_A, EPOCH_A)).toBe(sessionKey(FP_A, EPOCH_A));
    expect(sessionKey(FP_A, EPOCH_A)).not.toBe(sessionKey(FP_B, EPOCH_A));
    expect(sessionKey(FP_A, EPOCH_A)).not.toBe(sessionKey(FP_A, EPOCH_B));
  });

  it('13c. process restart onceki ephemeral oturumu DIRILTMEZ', async () => {
    const { credential } = await bringUpPhone(FP_A, EPOCH_A);
    /* Process olumu = tum modul bellegi sifirdan. */
    _resetPhoneHubLinkStateForTest();
    _resetPhoneLinkSessionRegistryForTest();
    _resetPhoneLinkGuestSessionsForTest();
    _resetPhoneLinkGrantsForTest();
    expect(validatePortalToken(credential.portalToken)).toBeNull();
    expect(getPhoneHubLinkState()).toBeNull();
    expect(activeRuntimeSessionCount()).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RACE (14-17)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4.7 Race', () => {
  it('14. Race A: istek kabul edildi, sonra disconnect -> dispatch OLMAZ', async () => {
    const { credential } = await bringUpPhone(FP_A, EPOCH_A);
    /* Soket istegi kabul etti; yetkilendirmeden ONCE oturum dustu. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A);

    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: JSON.stringify({ c: 'PLAY' }),
    }));
    expect(res.status).toBe(401);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('15. Race B: yan etki sinirinda son canlilik kapisi fail-closed', async () => {
    const { credential } = await bringUpPhone(FP_A, EPOCH_A);

    /* Yetki okumalari sirasinda oturum dusuyor: ilk okuma canli, sonraki
       her okuma olu. Yan etki sinirindaki son kapi yakalamali. */
    let reads = 0;
    mockSnapshot.mockImplementation(() => {
      reads += 1;
      /* Ilk okumadan SONRA oturum duser — olay modu acik kalir, bu yuzden
         canlilik gercekten indekse sorulur (snapshot geri dirilmez). */
      if (reads > 1) removeRuntimeSession(FP_A, EPOCH_A);
      return snapshotFor(FP_A, EPOCH_A);
    });

    const res = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(credential.portalToken),
      body: JSON.stringify({ c: 'PLAY' }),
    }));
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(mediaMocks.play).not.toHaveBeenCalled();

    /* Kapinin varligi sozlesmedir, cagri sirasinin yan urunu degil. */
    const src = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkMusicRemoteAdapter.ts'), 'utf8');
    expect(src).toMatch(/isGuestMediaDispatchStillLive/);
  });

  it('16. Race C: bayat SSE karesi GONDERILMEZ', async () => {
    const { credential } = await bringUpPhone(FP_A, EPOCH_A);
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    /* Kopus sonrasi akis acma girisimi reddedilir; kare uretilmez. */
    const res = await handlePortalRequest(req({
      path: '/events', streamKey: credential.streamToken,
    }));
    expect(res.status).toBe(401);
    expect(res.kind).toBe('BODY');
  });

  it('17. reconnect ESKI token-i DIRILTMEZ', async () => {
    const old = await bringUpPhone(FP_A, EPOCH_A);
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    /* Ayni cihaz yeniden baglandi — YENI nesil. */
    await deliver('ESTABLISHED', EPOCH_B, FP_A, 'UNKNOWN');
    expect(isSessionLive(FP_A, EPOCH_B)).toBe(true);
    expect(validatePortalToken(old.credential.portalToken)).toBeNull();
    expect(validateStreamToken(old.credential.streamToken)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * MULTI-PHONE (18-24)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4.10 Multi-phone isolation', () => {
  it('18. A grant B icin gecerli DEGIL', async () => {
    await bringUpPhone(FP_A, EPOCH_A);
    await bringUpPhone(FP_B, EPOCH_B);

    const grantA = getActiveGuestGrant(Date.now(), { deviceFingerprint: FP_A, sessionEpoch: EPOCH_A });
    const grantB = getActiveGuestGrant(Date.now(), { deviceFingerprint: FP_B, sessionEpoch: EPOCH_B });
    expect(grantA).not.toBeNull();
    expect(grantB).not.toBeNull();
    expect(grantA!.grantId).not.toBe(grantB!.grantId);

    /* A-nin kimligiyle sorulunca B-nin grant-i BULUNAMAZ. */
    expect(grantA!.deviceFingerprint).toBe(FP_A);
    expect(grantB!.deviceFingerprint).toBe(FP_B);
    /* Carpraz cift (A parmak izi + B nesli) hicbir grant dondurmez. */
    expect(getActiveGuestGrant(Date.now(), { deviceFingerprint: FP_A, sessionEpoch: EPOCH_B }))
      .toBeNull();
  });

  it('19. A portal token-i B oturumunda calismaz', async () => {
    const a = await bringUpPhone(FP_A, EPOCH_A);
    const b = await bringUpPhone(FP_B, EPOCH_B);
    expect(a.credential.portalToken).not.toBe(b.credential.portalToken);

    /* A koptu; B ayakta. A-nin token-i artik hicbir yerde gecmez. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    expect(validatePortalToken(a.credential.portalToken)).toBeNull();
    expect(validatePortalToken(b.credential.portalToken)).not.toBeNull();
  });

  it('20. A stream token-i B oturumunda calismaz', async () => {
    const a = await bringUpPhone(FP_A, EPOCH_A);
    const b = await bringUpPhone(FP_B, EPOCH_B);
    expect(a.credential.streamToken).not.toBe(b.credential.streamToken);
    await deliver('DISCONNECTED', EPOCH_A, FP_A);
    expect(validateStreamToken(a.credential.streamToken)).toBeNull();
    expect(validateStreamToken(b.credential.streamToken)).not.toBeNull();
  });

  it('20b. A bootstrap-i B tarafindan kullanilamaz (tek kullanimlik + oturum bagli)', async () => {
    mockSnapshot.mockReturnValue(snapshotFor(FP_A, EPOCH_A));
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    issueGuestMediaGrant();
    const sessionA = createGuestSession()!;

    await deliver('ESTABLISHED', EPOCH_B, FP_B, 'UNKNOWN');
    await deliver('DISCONNECTED', EPOCH_A, FP_A);

    /* A-nin oturumu olduyse bootstrap-i de olur. */
    const exchange = exchangeGuestBootstrapToken(sessionA.token);
    expect(exchange.ok).toBe(false);
  });

  it('21. A disconnect olunca B ayakta kalir', async () => {
    const releaser = spyReleaser();
    await bringUpPhone(FP_A, EPOCH_A);
    const b = await bringUpPhone(FP_B, EPOCH_B);
    releaser.closeStreams.mockClear();

    const result = await applyPhoneLinkRevocationCascade(FP_A, EPOCH_A, 'REMOTE_DISCONNECT');

    expect(isSessionLive(FP_B, EPOCH_B)).toBe(true);
    expect(validatePortalToken(b.credential.portalToken)).not.toBeNull();
    expect(validateStreamToken(b.credential.streamToken)).not.toBeNull();
    expect(getActiveGuestGrant(Date.now(), { deviceFingerprint: FP_B, sessionEpoch: EPOCH_B }))
      .not.toBeNull();
    /* B-nin akislari KAPATILMAZ ve sunucu DURDURULMAZ. */
    expect(result.portalStopRequested).toBe(false);
    expect(releaser.closeStreams).not.toHaveBeenCalled();
  });

  it('22. B disconnect olunca A ayakta kalir (simetrik)', async () => {
    const a = await bringUpPhone(FP_A, EPOCH_A);
    await bringUpPhone(FP_B, EPOCH_B);

    const result = await applyPhoneLinkRevocationCascade(FP_B, EPOCH_B, 'REMOTE_DISCONNECT');

    expect(isSessionLive(FP_A, EPOCH_A)).toBe(true);
    expect(validatePortalToken(a.credential.portalToken)).not.toBeNull();
    expect(result.portalStopRequested).toBe(false);
    expect(activeGuestSessionCount()).toBe(1);
  });

  it('23. global currentGuest/currentSession authority YOK', () => {
    const dir = resolve(__dirname, '../platform/phoneLink/');
    const files = [
      'phoneLinkSessionRegistry.ts', 'phoneLinkLifecycle.ts', 'phoneLinkGuestSession.ts',
      'phoneLinkCapabilityGrant.ts', 'phoneLinkPortalHttp.ts', 'phoneLinkPortalRuntime.ts',
    ];
    for (const file of files) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      expect(src, file).not.toMatch(/\b(currentGuest|currentSession|currentGrant|activeGuest)\s*[:=]/);
    }
    /* Tek cihazin kopusu GLOBAL iptal CAGIRMAZ. */
    const lifecycle = readFileSync(resolve(dir, 'phoneLinkLifecycle.ts'), 'utf8');
    expect(lifecycle).not.toMatch(/revokeAllGuestSessions|revokeAllGuestGrants|clearRuntimeSessions/);
  });

  it('24. last-connected-wins YOK — ikinci telefon birinciyi dusurmez', async () => {
    const a = await bringUpPhone(FP_A, EPOCH_A);
    await bringUpPhone(FP_B, EPOCH_B);
    /* B baglandi diye A-nin hicbir kaynagi DUSMEZ. */
    expect(isSessionLive(FP_A, EPOCH_A)).toBe(true);
    expect(validatePortalToken(a.credential.portalToken)).not.toBeNull();
    expect(activeRuntimeSessionCount()).toBe(2);
    expect(activeGuestSessionCount()).toBe(2);
    expect(recordedGrantCount()).toBe(2);
  });

  it('24b. iki guest de AYNI kanonik Music-i kontrol eder (ikinci playback authority YOK)', async () => {
    const a = await bringUpPhone(FP_A, EPOCH_A);
    const b = await bringUpPhone(FP_B, EPOCH_B);

    const resA = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(a.credential.portalToken),
      body: JSON.stringify({ c: 'PLAY' }),
    }));
    const resB = await handlePortalRequest(req({
      method: 'POST', path: '/command', ...bearer(b.credential.portalToken),
      body: JSON.stringify({ c: 'NEXT' }),
    }));
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    /* TEK kanonik kapi — her komut TAM BIR KEZ. */
    expect(mediaMocks.play).toHaveBeenCalledTimes(1);
    expect(mediaMocks.next).toHaveBeenCalledTimes(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROLE (25-26)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4.12 PRIMARY authority korunur', () => {
  it('25. TRUSTED device tek basina PRIMARY olmaz', () => {
    const evidence = derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP_A, nowMs: 1_000,
    });
    expect(evidence.role).toBe('GUEST');
  });

  it('26. PHONE/BLUETOOTH evidence tek basina person identity olmaz', () => {
    bindAuthenticationVehicle('veh-1');
    for (const source of ['PHONE', 'BLUETOOTH'] as const) {
      _resetDriverAuthenticationStoreForTest();
      bindAuthenticationVehicle('veh-1');
      driverAuthenticationStore.record({
        driverId: 'drv-1', vehicleId: 'veh-1', authenticationSource: source,
        authenticationLevel: 'VERIFIED', verifiedAt: 1_000, expiresAt: 9_000_000,
        sessionId: `sess-${source}`,
      }, 2_000);
      const evidence = derivePhoneLinkRole({
        attachmentState: 'ACTIVE', deviceFingerprint: FP_A, nowMs: 2_000,
      });
      expect(evidence.role, source).toBe('GUEST');
      expect(evidence.reason, source).toBe('driver_authentication_not_proof');
    }
  });

  it('26b. coklu telefon hakemligi icin sahte driver identity kurulmadi', () => {
    const lifecycle = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkLifecycle.ts'), 'utf8');
    const registry = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkSessionRegistry.ts'), 'utf8');
    for (const [name, src] of [['lifecycle', lifecycle], ['registry', registry]] as const) {
      expect(src, name).not.toMatch(/'PRIMARY'/);
      expect(src, name).not.toMatch(/driverAuthentication|driverPresence|personIdentity/);
    }
    /* Indekse yazilan rol DAIMA GUEST (rol otoritesi ayri dosyada). */
    expect(lifecycle).toMatch(/role: 'GUEST'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PERFORMANCE (27-30)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4.14 Performans', () => {
  it('27. yeni interval YOK', () => {
    const dir = resolve(__dirname, '../platform/phoneLink/');
    for (const file of [
      'phoneLinkLifecycle.ts', 'phoneLinkSessionRegistry.ts', 'phoneLinkPortalRuntime.ts',
      'phoneLinkPortalHttp.ts', 'phoneLinkGuestSession.ts', 'phoneLinkCapabilityGrant.ts',
    ]) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      expect(src, file).not.toMatch(/setInterval\(/);
    }
  });

  it('28. yeni polling YOK — native tarafta da periyodik tarama yok', () => {
    const controller = readFileSync(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonehub/link/PhoneHubLinkController.java'), 'utf8');
    expect(controller).not.toMatch(/ScheduledExecutorService|postDelayed|new Timer\(/);
    const mapping = readFileSync(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonehub/link/PhoneHubLinkStateMapping.java'), 'utf8');
    /* Saf enum esleme — hicbir kaynak/thread/IO icermez. */
    expect(mapping).not.toMatch(/Thread|Socket|Executor|Handler/);
  });

  it('29. portal kapaliyken sunucu YOK — guest session yoksa STOP', async () => {
    const releaser = spyReleaser();
    await bringUpPhone(FP_A, EPOCH_A);
    const result = await applyPhoneLinkRevocationCascade(FP_A, EPOCH_A, 'USER_DISCONNECT');
    expect(result.portalStopRequested).toBe(true);
    expect(hasActiveGuestSession()).toBe(false);
    expect(releaser.syncPortal).toHaveBeenCalled();
  });

  it('30. lifecycle olayi disinda idle is YOK — olay yoksa hicbir sey degismez', async () => {
    const releaser = spyReleaser();
    await bringUpPhone(FP_A, EPOCH_A);
    releaser.closeStreams.mockClear();
    releaser.syncPortal.mockClear();
    const before = getPhoneLinkLifecycleTelemetry().cascadeCount;

    /* Zamani ilerlet ve mikro gorevleri bosalt: OLAY olmadan hicbir sey olmaz. */
    for (let i = 0; i < 50; i += 1) await Promise.resolve();

    expect(getPhoneLinkLifecycleTelemetry().cascadeCount).toBe(before);
    expect(releaser.closeStreams).not.toHaveBeenCalled();
    expect(releaser.syncPortal).not.toHaveBeenCalled();
    expect(isSessionLive(FP_A, EPOCH_A)).toBe(true);
  });

  it('30b. registry sinirlidir ve gecersiz kayit biriktirmez', async () => {
    /* Bellek guvenligi tavani — URUN LIMITI DEGIL. */
    for (let epoch = 100; epoch < 120; epoch += 1) {
      await deliver('ESTABLISHED', epoch, `fp-${epoch}`, 'UNKNOWN');
    }
    expect(listRuntimeSessions().length).toBeLessThanOrEqual(8);
    const registry = readFileSync(
      resolve(__dirname, '../platform/phoneLink/phoneLinkSessionRegistry.ts'), 'utf8');
    expect(registry).not.toMatch(/localStorage|sessionStorage|indexedDB|Preferences/);
    expect(registry).toMatch(/MAX_TRACKED_SESSIONS/);
  });
});
