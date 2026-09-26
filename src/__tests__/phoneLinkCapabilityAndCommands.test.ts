/**
 * phoneLinkCapabilityAndCommands.test.ts — PHONE LINK F1 · SECURITY GATES.
 *
 * `phoneLinkAttachment.getPhoneAttachmentSnapshot` taklit edilir (attachment
 * türetimi zaten `phoneLinkAttachment.test.ts`de ayrı kilitli) — burada yalnız
 * grant + kanonik `authorize()`/`canExecute()` + adaptör sözleşmesi test edilir.
 *
 * Kilitlenen güvenlik kapıları (görev listesindeki numaralarla):
 *  1. Bluetooth/RFCOMM bağlı olmak (LINKED) tek başına komut vermez.
 *  2. Established session (ACTIVE) olmadan grant yok.
 *  3. Grant başka deviceFingerprint ile kullanılamaz.
 *  4. Grant başka sessionEpoch ile kullanılamaz.
 *  6. Link kopunca komut anında reddedilir.
 *  8/9. Adaptör YALNIZ `mediaCommandGateway`e gider — doğrudan backend/native yok.
 *  11. `commandListener`/`remoteCommandService` importu YOK (statik denetim).
 *  12. Destructive vehicle command yolu YOK (adaptör yalnız 6 medya komutunu tanır).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockSnapshot = vi.fn();
vi.mock('../platform/phoneLink/phoneLinkAttachment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneLink/phoneLinkAttachment')>();
  return { ...actual, getPhoneAttachmentSnapshot: () => mockSnapshot() };
});

const mediaMocks = vi.hoisted(() => ({
  play: vi.fn(), pause: vi.fn(), next: vi.fn(), previous: vi.fn(),
}));
vi.mock('../platform/media/authority/mediaCommandGateway', () => mediaMocks);

const canonicalSnapshotMock = vi.fn();
vi.mock('../platform/media/authority/musicCanonicalSnapshot', () => ({
  getMusicCanonicalSnapshot: () => canonicalSnapshotMock(),
}));

const librarySnapshotMock = vi.fn(() => ({ revision: 0, tracks: [], albums: [], artists: [], folders: [], availability: 'READY' }));
vi.mock('../platform/media/musicIndex', () => ({
  getMusicLibrarySnapshot: () => librarySnapshotMock(),
}));

import {
  issueGuestMediaGrant, getActiveGuestGrant, authorizeGuestMediaCommand,
  canExecuteGuestMediaCommand, revokeAllGuestGrants, revokeGuestGrant,
  _resetPhoneLinkGrantsForTest,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';
import { dispatchGuestMusicCommand } from '../platform/phoneLink/phoneLinkMusicRemoteAdapter';

function activeSnapshot(overrides: Record<string, unknown> = {}) {
  return { state: 'ACTIVE', role: 'GUEST', sessionEpoch: 7, deviceFingerprint: 'fp-A', ...overrides };
}
function linkedSnapshot() {
  return { state: 'LINKED', role: 'GUEST', sessionEpoch: 7, deviceFingerprint: 'fp-A' };
}
function detachedSnapshot() {
  return { state: 'DETACHED', role: 'GUEST', sessionEpoch: null, deviceFingerprint: null };
}

beforeEach(() => {
  _resetPhoneLinkGrantsForTest();
  mockSnapshot.mockReset().mockReturnValue(detachedSnapshot());
  mediaMocks.play.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.pause.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.next.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.previous.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  canonicalSnapshotMock.mockReset().mockReturnValue({ authorityAvailable: false, activeSource: 'NONE', focusState: 'NONE', audioRoute: 'UNKNOWN', playing: false });
});

describe('Gate 2 — established session olmadan grant yok', () => {
  it('DETACHED iken grant verilmez', () => {
    mockSnapshot.mockReturnValue(detachedSnapshot());
    expect(issueGuestMediaGrant()).toBeNull();
  });

  it('LINKED (yalnız transport/authenticated, ama SESSION_ESTABLISHED değil) iken grant verilmez', () => {
    mockSnapshot.mockReturnValue(linkedSnapshot());
    expect(issueGuestMediaGrant()).toBeNull();
  });

  it('ACTIVE iken grant verilir', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const grant = issueGuestMediaGrant();
    expect(grant).not.toBeNull();
    expect(grant?.capability).toBe('MEDIA_CONTROL');
  });

  it('aynı canlı oturum için ikinci çağrı AYNI grant\'ı döner (çoğaltma yok)', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const a = issueGuestMediaGrant();
    const b = issueGuestMediaGrant();
    expect(a?.grantId).toBe(b?.grantId);
  });
});

describe('Gate 1 — Bluetooth/RFCOMM bağlı olmak (LINKED) tek başına komut vermez', () => {
  it('LINKED durumda authorize DENY/CAPABILITY_NOT_GRANTED döner', () => {
    mockSnapshot.mockReturnValue(linkedSnapshot());
    const evidence = authorizeGuestMediaCommand('op-1');
    expect(evidence.decision).not.toBe('ALLOW');
  });

  it('LINKED durumda dispatchGuestMusicCommand PLAY reddedilir, mediaCommandGateway ÇAĞRILMAZ', async () => {
    mockSnapshot.mockReturnValue(linkedSnapshot());
    const result = await dispatchGuestMusicCommand('PLAY');
    expect(result.ok).toBe(false);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gate 3 — grant başka deviceFingerprint ile kullanılamaz', () => {
  it('grant fp-A için verildi; snapshot fp-B\'ye değişince grant GEÇERSİZ', () => {
    mockSnapshot.mockReturnValue(activeSnapshot({ deviceFingerprint: 'fp-A' }));
    const grant = issueGuestMediaGrant();
    expect(grant).not.toBeNull();

    mockSnapshot.mockReturnValue(activeSnapshot({ deviceFingerprint: 'fp-B', sessionEpoch: 7 }));
    expect(getActiveGuestGrant()).toBeNull();
  });
});

describe('Gate 4 — grant başka sessionEpoch ile kullanılamaz', () => {
  it('grant epoch=7 için verildi; snapshot epoch=8\'e ilerleyince (reconnect) grant GEÇERSİZ', () => {
    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 7 }));
    const grant = issueGuestMediaGrant();
    expect(grant).not.toBeNull();

    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 8 }));
    expect(getActiveGuestGrant()).toBeNull();
  });
});

describe('Gate 6 — link kopunca komut anında reddedilir', () => {
  it('grant verildikten SONRA link DETACHED olursa authorize DENY döner', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    issueGuestMediaGrant();
    mockSnapshot.mockReturnValue(detachedSnapshot());
    expect(authorizeGuestMediaCommand('op-2').decision).not.toBe('ALLOW');
  });

  it('authorize ALLOW verdikten SONRA, execute\'ten HEMEN ÖNCE link koparsa canExecute false döner (TOCTOU)', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    issueGuestMediaGrant();
    const evidence = authorizeGuestMediaCommand('op-3');
    expect(evidence.decision).toBe('ALLOW');

    mockSnapshot.mockReturnValue(detachedSnapshot());
    expect(canExecuteGuestMediaCommand(evidence)).toBe(false);
  });

  it('dispatchGuestMusicCommand: authorize sonrası link koparsa mediaCommandGateway ÇAĞRILMAZ', async () => {
    // authorize() ve canExecute() aynı komut çağrısı içinde art arda çalışır;
    // burada grant'ın KENDİSİ geri alınarak "iptal tetikleyicisi" doğrulanır.
    mockSnapshot.mockReturnValue(activeSnapshot());
    const grant = issueGuestMediaGrant()!;
    revokeGuestGrant(grant.grantId);
    const result = await dispatchGuestMusicCommand('PLAY');
    expect(result.ok).toBe(false);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Komut yürütme — yalnız ACTIVE + geçerli grant ile', () => {
  it('ACTIVE + grant ile PLAY mediaCommandGateway.play\'i requester ile çağırır', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    issueGuestMediaGrant();
    const result = await dispatchGuestMusicCommand('PLAY');
    expect(result.ok).toBe(true);
    expect(mediaMocks.play).toHaveBeenCalledTimes(1);
    expect(mediaMocks.play).toHaveBeenCalledWith(undefined, 'phone_link_guest');
  });

  it('PAUSE/NEXT/PREVIOUS de aynı şekilde kanonik kapıya gider', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    issueGuestMediaGrant();
    await dispatchGuestMusicCommand('PAUSE');
    await dispatchGuestMusicCommand('NEXT');
    await dispatchGuestMusicCommand('PREVIOUS');
    expect(mediaMocks.pause).toHaveBeenCalledTimes(1);
    expect(mediaMocks.next).toHaveBeenCalledTimes(1);
    expect(mediaMocks.previous).toHaveBeenCalledTimes(1);
  });

  it('GET_NOW_PLAYING / GET_QUEUE komut için mediaCommandGateway HİÇ çağrılmaz (salt okuma)', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    issueGuestMediaGrant();
    await dispatchGuestMusicCommand('GET_NOW_PLAYING');
    await dispatchGuestMusicCommand('GET_QUEUE');
    expect(mediaMocks.play).not.toHaveBeenCalled();
    expect(mediaMocks.pause).not.toHaveBeenCalled();
  });

  it('GET_NOW_PLAYING native yoksa dürüst boş sonuç döner (sahte "çalıyor" ÜRETİLMEZ)', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    issueGuestMediaGrant();
    canonicalSnapshotMock.mockReturnValue({ authorityAvailable: false, activeSource: 'NONE', focusState: 'NONE', audioRoute: 'UNKNOWN', playing: false });
    const result = await dispatchGuestMusicCommand('GET_NOW_PLAYING');
    expect(result.ok).toBe(true);
    if (result.ok && result.command === 'GET_NOW_PLAYING') {
      expect(result.nowPlaying.playing).toBe(false);
      expect(result.nowPlaying.trackId).toBeNull();
    }
  });
});

describe('revokeAllGuestGrants — açık iptal', () => {
  it('revokeAllGuestGrants sonrası grant artık bulunamaz', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    issueGuestMediaGrant();
    revokeAllGuestGrants();
    expect(getActiveGuestGrant()).toBeNull();
  });
});

describe('Gate 11/12 — statik bağımlılık denetimi', () => {
  const PHONE_LINK_DIR = resolve(__dirname, '../platform/phoneLink');
  const files = [
    'phoneLinkAttachment.ts', 'phoneLinkCapabilityGrant.ts',
    'phoneLinkMusicRemoteAdapter.ts', 'phoneLinkGuestSession.ts',
    'phoneLinkQrContract.ts', 'phoneLinkPortalLifecycle.ts',
    /* F2 */
    'phoneLinkApplicationEnvelope.ts', 'phoneLinkApplicationIngress.ts',
  ];

  it('hiçbir Phone Link dosyası commandListener/remoteCommandService/vehicleIdentityService import etmez', () => {
    for (const file of files) {
      const src = readFileSync(resolve(PHONE_LINK_DIR, file), 'utf8');
      expect(src, file).not.toMatch(/commandListener|remoteCommandService|vehicleIdentityService/);
    }
  });

  it('adaptör yalnız 6 tanımlı medya komutunu tanır — destructive/vehicle komut yolu yok', () => {
    const src = readFileSync(resolve(PHONE_LINK_DIR, 'phoneLinkMusicRemoteAdapter.ts'), 'utf8');
    expect(src).not.toMatch(/lock|unlock|horn|alarm|clearDtc|CLEAR_DTC/i);
  });

  it('F2: hiçbir Phone Link dosyası Arabam Cebimde\'ye bağımlılık kurmaz', () => {
    for (const file of files) {
      const src = readFileSync(resolve(PHONE_LINK_DIR, file), 'utf8');
      expect(src, file).not.toMatch(/ArabamCebimde|arabam_cebimde|pairingService/);
    }
  });

  it('F2 Gate 19: ingress karar için yalnız dispatchGuestMusicCommand\'ı (F1 kanonik zinciri) çağırır', () => {
    const src = readFileSync(resolve(PHONE_LINK_DIR, 'phoneLinkApplicationIngress.ts'), 'utf8');
    expect(src).toContain('dispatchGuestMusicCommand');
    // authorize()/canExecute() DOĞRUDAN çağrılmaz — bu, F1'in phoneLinkCapabilityGrant'ının
    // işidir; ingress ikinci bir karar motoru KURMAZ.
    expect(src).not.toMatch(/\bauthorize\(|\bcanExecute\(/);
  });

  it('F2 Gate 14: zarf/ingress kodu ham anahtar/nonce/şifreleme materyali adı taşımaz', () => {
    for (const file of ['phoneLinkApplicationEnvelope.ts', 'phoneLinkApplicationIngress.ts']) {
      const src = readFileSync(resolve(PHONE_LINK_DIR, file), 'utf8');
      expect(src, file).not.toMatch(/sharedSecret|privateKey|SessionCrypto|nonce/i);
    }
  });
});
