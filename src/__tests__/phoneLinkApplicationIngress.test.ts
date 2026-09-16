/**
 * phoneLinkApplicationIngress.test.ts — PHONE LINK F2 · TEK ingress noktası kilitleri.
 *
 * Kilitlenen güvenlik kapıları (görev listesindeki numaralarla):
 *  1.  Raw bağlantı/LINKED tek başına komut yürütmez.
 *  3.  Native-taşınan fingerprint mesajın kendisiyle eşleşmezse reddedilir.
 *  4.  Native-taşınan sessionEpoch eşleşmezse reddedilir.
 *  5.  DETACHED iken reddedilir.
 *  6.  Mesaj geldikten SONRA link koparsa (ingress anında canlı kontrol) reddedilir.
 *  7.  Malformed zarf reddedilir, adaptöre ULAŞMAZ.
 *  8.  Bilinmeyen sürüm reddedilir.
 *  9.  Bilinmeyen komut reddedilir.
 *  10. Aşırı büyük yük reddedilir.
 *  12. PLAY canonical gateway'e TAM BİR KEZ ulaşır.
 *  13. Aynı messageId'nin tekrarı (duplicate delivery) ikinci kez YÜRÜTÜLMEZ.
 *  19. Bu katman kendi ALLOW kararı ÜRETMEZ — yalnız `dispatchGuestMusicCommand`i
 *      (F1 kanonik zinciri) çağırır.
 *  20. Bridge aboneliği söküldükten sonra olay işlenmez.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('../platform/media/musicIndex', () => ({
  getMusicLibrarySnapshot: () => ({ revision: 0, tracks: [], albums: [], artists: [], folders: [], availability: 'READY' }),
}));

const listenerMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  sendApplicationMessage: vi.fn(),
}));
vi.mock('../platform/phoneHub/phoneHubLink', () => ({
  PhoneHubLink: listenerMocks,
}));

import {
  handleApplicationMessageForTest, initPhoneLinkApplicationBridge,
  getPhoneLinkIngressTelemetry, _resetPhoneLinkIngressTelemetryForTest,
  _resetPhoneLinkDedupeForTest,
} from '../platform/phoneLink/phoneLinkApplicationIngress';
import { _resetPhoneLinkGrantsForTest, issueGuestMediaGrant } from '../platform/phoneLink/phoneLinkCapabilityGrant';
import { PHONE_LINK_APP_MESSAGE_VERSION } from '../platform/phoneLink/phoneLinkApplicationEnvelope';

function activeSnapshot(overrides: Record<string, unknown> = {}) {
  return { state: 'ACTIVE', role: 'GUEST', sessionEpoch: 7, deviceFingerprint: 'fp-A', ...overrides };
}
function linkedSnapshot() {
  return { state: 'LINKED', role: 'GUEST', sessionEpoch: 7, deviceFingerprint: 'fp-A' };
}
function detachedSnapshot() {
  return { state: 'DETACHED', role: 'GUEST', sessionEpoch: null, deviceFingerprint: null };
}

function evt(over: Record<string, unknown> = {}) {
  return {
    fingerprint: 'fp-A', sessionEpoch: 7,
    payload: JSON.stringify({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-1', type: 'MUSIC_COMMAND', command: 'PLAY' }),
    ...over,
  };
}

beforeEach(() => {
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkIngressTelemetryForTest();
  _resetPhoneLinkDedupeForTest();
  mockSnapshot.mockReset().mockReturnValue(activeSnapshot());
  mediaMocks.play.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.pause.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.next.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.previous.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  canonicalSnapshotMock.mockReset().mockReturnValue({ authorityAvailable: false, activeSource: 'NONE', focusState: 'NONE', audioRoute: 'UNKNOWN', playing: false });
  listenerMocks.addListener.mockReset();
  listenerMocks.sendApplicationMessage.mockReset().mockResolvedValue({ sent: true });
  issueGuestMediaGrant();
});

describe('Gate 5 — DETACHED iken mesaj işlenmez', () => {
  it('yanıt üretilmez, adaptör çağrılmaz', async () => {
    mockSnapshot.mockReturnValue(detachedSnapshot());
    const resp = await handleApplicationMessageForTest(evt());
    expect(resp).toBeNull();
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gate 1 — LINKED (yalnız bağlı, henüz ACTIVE değil) tek başına komut yürütmez', () => {
  it('yanıt üretilmez, adaptör çağrılmaz', async () => {
    mockSnapshot.mockReturnValue(linkedSnapshot());
    const resp = await handleApplicationMessageForTest(evt());
    expect(resp).toBeNull();
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gate 3 — native-taşınan fingerprint mesajla eşleşmezse reddedilir', () => {
  it('canlı attachment fp-A ama olay fp-B taşıyorsa (imkânsız ama savunma) reddedilir', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot({ deviceFingerprint: 'fp-A' }));
    const resp = await handleApplicationMessageForTest(evt({ fingerprint: 'fp-B' }));
    expect(resp).toBeNull();
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gate 4 — native-taşınan sessionEpoch eşleşmezse reddedilir', () => {
  it('telefon koptu/yeniden bağlandı (epoch 7 → 8), eski mesaj (epoch 7) artık geçersiz', async () => {
    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 8 })); // canlı = 8
    const resp = await handleApplicationMessageForTest(evt({ sessionEpoch: 7 })); // mesaj = 7 (eski)
    expect(resp).toBeNull();
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gate 6 — mesaj geldikten SONRA link koparsa reddedilir', () => {
  it('ingress anında canlı durum DETACHED ise (mesaj gönderildikten sonra kopmuş) reddedilir', async () => {
    mockSnapshot.mockReturnValue(detachedSnapshot());
    const resp = await handleApplicationMessageForTest(evt());
    expect(resp).toBeNull();
  });
});

describe('Gate 7 — malformed zarf adaptöre ulaşmaz', () => {
  it('bozuk JSON → null yanıt, adaptör çağrılmaz', async () => {
    const resp = await handleApplicationMessageForTest(evt({ payload: '{not json' }));
    expect(resp).toBeNull();
    expect(mediaMocks.play).not.toHaveBeenCalled();
    expect(getPhoneLinkIngressTelemetry().rejectedCount).toBe(1);
  });
});

describe('Gate 8 — bilinmeyen sürüm reddedilir, ama isteğin id\'si biliniyorsa ACK döner', () => {
  it('v=2 → REJECTED_UNSUPPORTED yanıtı üretilir (id okunabildiği için)', async () => {
    const resp = await handleApplicationMessageForTest(evt({
      payload: JSON.stringify({ v: 2, id: 'msg-2', type: 'MUSIC_COMMAND', command: 'PLAY' }),
    }));
    expect(resp).not.toBeNull();
    expect(JSON.parse(resp!)).toMatchObject({ id: 'msg-2', status: 'REJECTED_UNSUPPORTED' });
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gate 9 — bilinmeyen/destructive komut reddedilir', () => {
  it('"CLEAR_DTC" gibi ilgisiz bir komut asla adaptöre gitmez', async () => {
    const resp = await handleApplicationMessageForTest(evt({
      payload: JSON.stringify({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-3', type: 'MUSIC_COMMAND', command: 'CLEAR_DTC' }),
    }));
    expect(resp).not.toBeNull();
    expect(JSON.parse(resp!).status).toBe('REJECTED_UNSUPPORTED');
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gate 10 — aşırı büyük yük reddedilir', () => {
  it('2048 karakteri aşan yük → null (id okunamaz)', async () => {
    const resp = await handleApplicationMessageForTest(evt({ payload: 'x'.repeat(3000) }));
    expect(resp).toBeNull();
  });
});

describe('Gate 12 — PLAY canonical gateway\'e TAM BİR KEZ ulaşır', () => {
  it('ACCEPTED yanıtı üretir ve mediaCommandGateway.play tam 1 kez çağrılır', async () => {
    const resp = await handleApplicationMessageForTest(evt());
    expect(resp).not.toBeNull();
    expect(JSON.parse(resp!)).toMatchObject({ id: 'msg-1', status: 'ACCEPTED' });
    expect(mediaMocks.play).toHaveBeenCalledTimes(1);
  });

  it('gateway yürütmeyi reddederse (ok:false) dürüstçe FAILED döner — sahte ACCEPTED YOK', async () => {
    mediaMocks.play.mockResolvedValue({ outcome: 'FAILED', failureCode: 'play_rejected' });
    const resp = await handleApplicationMessageForTest(evt());
    expect(JSON.parse(resp!).status).toBe('FAILED');
  });
});

describe('Gate 13 — aynı messageId ikinci kez YÜRÜTÜLMEZ (duplicate delivery)', () => {
  it('NEXT iki ayrı geçerli çerçeve olarak (aynı id) gelirse yalnız İLKİ uygulanır', async () => {
    const nextEvt = evt({ payload: JSON.stringify({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-next', type: 'MUSIC_COMMAND', command: 'NEXT' }) });
    const first = await handleApplicationMessageForTest(nextEvt);
    const second = await handleApplicationMessageForTest(nextEvt);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // yinelenen sessizce yutulur, ikinci ACK YOK
    expect(mediaMocks.next).toHaveBeenCalledTimes(1);
  });

  it('farklı sessionEpoch\'ta AYNI id yeniden kullanılabilir (yeni oturum = yeni ad alanı)', async () => {
    const payload = JSON.stringify({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-x', type: 'MUSIC_COMMAND', command: 'PLAY' });
    await handleApplicationMessageForTest(evt({ payload, sessionEpoch: 7 }));

    // Telefon koptu/yeniden bağlandı → yeni oturum (epoch 8) için AYRICA
    // grant verilmesi gerekir (grantlar da epoch-scoped'tur, F1) — bu
    // testin konusu YALNIZ dedupe'ın epoch'a göre ayrıştığıdır.
    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 8 }));
    issueGuestMediaGrant();

    const resp = await handleApplicationMessageForTest(evt({ payload, sessionEpoch: 8 }));
    expect(resp).not.toBeNull();
    expect(JSON.parse(resp!).status).toBe('ACCEPTED');
    expect(mediaMocks.play).toHaveBeenCalledTimes(2);
  });
});

describe('Gate 19 — ingress kendi ALLOW kararı üretmez, yalnız F1 zincirine gider', () => {
  it('grant iptal edilmişse (yetkisiz) ingress ACCEPTED ÜRETEMEZ', async () => {
    _resetPhoneLinkGrantsForTest(); // grant yok — authorizeGuestMediaCommand DENY döner
    const resp = await handleApplicationMessageForTest(evt());
    expect(resp).not.toBeNull();
    expect(JSON.parse(resp!).status).toBe('REJECTED_UNAUTHORIZED');
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('salt-okuma komutları (GET_NOW_PLAYING/GET_QUEUE) — gateway hiç çağrılmaz', () => {
  it('GET_NOW_PLAYING dürüst boş sonuç döner', async () => {
    const resp = await handleApplicationMessageForTest(evt({
      payload: JSON.stringify({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-np', type: 'MUSIC_COMMAND', command: 'GET_NOW_PLAYING' }),
    }));
    const parsed = JSON.parse(resp!);
    expect(parsed.status).toBe('ACCEPTED');
    expect(parsed.result.playing).toBe(false);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });
});

describe('Gözlemlenebilirlik (§K) — bounded, payload TAŞIMAZ', () => {
  it('rx/accepted/rejected sayaçları doğru işler', async () => {
    await handleApplicationMessageForTest(evt());
    const t1 = getPhoneLinkIngressTelemetry();
    expect(t1.rxCount).toBe(1);
    expect(t1.acceptedCount).toBe(1);
    expect(t1.lastCommand).toBe('PLAY');

    mockSnapshot.mockReturnValue(detachedSnapshot());
    await handleApplicationMessageForTest(evt({ payload: JSON.stringify({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-2', type: 'MUSIC_COMMAND', command: 'NEXT' }) }));
    const t2 = getPhoneLinkIngressTelemetry();
    expect(t2.rxCount).toBe(2);
    expect(t2.rejectedCount).toBe(1);
  });

  it('telemetri payload/token/fingerprint TAŞIMAZ', async () => {
    await handleApplicationMessageForTest(evt());
    const text = JSON.stringify(getPhoneLinkIngressTelemetry());
    expect(text).not.toContain('fp-A');
    expect(text).not.toContain('msg-1');
  });
});

describe('Gate 20 — bridge aboneliği söküldükten sonra olay işlenmez', () => {
  it('initPhoneLinkApplicationBridge dönen fonksiyon addListener handle.remove()i çağırır', async () => {
    const removeMock = vi.fn().mockResolvedValue(undefined);
    listenerMocks.addListener.mockResolvedValue({ remove: removeMock });

    const stop = initPhoneLinkApplicationBridge();
    // addListener'ın async .then zinciri çözülsün diye mikro-task bekle.
    await Promise.resolve(); await Promise.resolve();

    stop();
    await Promise.resolve();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('native plugin yoksa (addListener reddederse) sessizce hiçbir şey patlamaz', async () => {
    listenerMocks.addListener.mockRejectedValue(new Error('no native bridge'));
    expect(() => initPhoneLinkApplicationBridge()).not.toThrow();
    await Promise.resolve(); await Promise.resolve();
  });
});
