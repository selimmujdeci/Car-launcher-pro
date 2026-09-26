/**
 * phoneLinkGuestSessionQrPortal.test.ts — PHONE LINK F1 · Guest Session / QR / Portal.
 *
 * Kilitlenen güvenlik kapıları:
 *  5.  Eski QR token yeni session'da (yeni sessionEpoch) çalışmaz.
 *  7.  GuestSession expiry sonrası komut reddedilir.
 *  10. Portal public interface'e bind OLAMAZ — bu fazda hiç HTTP sunucusu
 *      yoktur; kilit statik denetimle "hiçbir server/bind kodu eklenmedi"
 *      şeklinde doğrulanır.
 *
 * Ayrıca spec madde 8'in TAM dizisi uçtan uca doğrulanır:
 *   ACTIVE → grant → GuestSession → QR → portal RUNNING
 *   DETACHED → grant INVALID → GuestSession REVOKED → portal STOPPED
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockSnapshot = vi.fn();
vi.mock('../platform/phoneLink/phoneLinkAttachment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneLink/phoneLinkAttachment')>();
  return { ...actual, getPhoneAttachmentSnapshot: () => mockSnapshot() };
});

import {
  createGuestSession, validateGuestSessionToken, getGuestSession,
  hasActiveGuestSession, revokeAllGuestSessions, _resetPhoneLinkGuestSessionsForTest,
} from '../platform/phoneLink/phoneLinkGuestSession';
import {
  buildGuestQrPayload, buildGuestQrDisplayValue, isQrPayloadExpired,
} from '../platform/phoneLink/phoneLinkQrContract';
import {
  derivePortalDesiredState, isPortalTransition,
} from '../platform/phoneLink/phoneLinkPortalLifecycle';
import {
  issueGuestMediaGrant, getActiveGuestGrant, _resetPhoneLinkGrantsForTest,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';

function activeSnapshot(overrides: Record<string, unknown> = {}) {
  return { state: 'ACTIVE', role: 'GUEST', sessionEpoch: 7, deviceFingerprint: 'fp-A', ...overrides };
}
function detachedSnapshot() {
  return { state: 'DETACHED', role: 'GUEST', sessionEpoch: null, deviceFingerprint: null };
}

beforeEach(() => {
  _resetPhoneLinkGuestSessionsForTest();
  _resetPhoneLinkGrantsForTest();
  mockSnapshot.mockReset().mockReturnValue(detachedSnapshot());
});

describe('GuestSession — oluşturma fail-closed', () => {
  it('DETACHED iken guest session oluşturulamaz', () => {
    expect(createGuestSession()).toBeNull();
  });

  it('ACTIVE iken guest session oluşturulur, token geçerlidir', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const session = createGuestSession();
    expect(session).not.toBeNull();
    expect(validateGuestSessionToken(session!.token)).toBe(true);
  });
});

describe('Gate 5 — eski QR token yeni session\'da (yeni sessionEpoch) çalışmaz', () => {
  it('epoch=7 için üretilen token, epoch=8\'e reconnect sonrası GEÇERSİZ olur', () => {
    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 7 }));
    const session = createGuestSession()!;
    expect(validateGuestSessionToken(session.token)).toBe(true);

    mockSnapshot.mockReturnValue(activeSnapshot({ sessionEpoch: 8 }));
    expect(validateGuestSessionToken(session.token)).toBe(false);
  });

  it('aynı Phone Link oturumu için QR yeniden üretilince ÖNCEKİ token iptal olur', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const first = createGuestSession()!;
    const second = createGuestSession()!;
    expect(first.token).not.toBe(second.token);
    expect(validateGuestSessionToken(first.token)).toBe(false);
    expect(validateGuestSessionToken(second.token)).toBe(true);
  });
});

describe('Gate 7 — GuestSession expiry sonrası komut reddedilir', () => {
  it('expiresAt geçince token geçersiz olur', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const now = 1_000_000;
    const session = createGuestSession(now)!;
    expect(validateGuestSessionToken(session.token, now + 1000)).toBe(true);
    expect(validateGuestSessionToken(session.token, session.expiresAt + 1)).toBe(false);
  });

  it('getGuestSession süresi dolmuş token için null döner', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const now = 2_000_000;
    const session = createGuestSession(now)!;
    expect(getGuestSession(session.token, session.expiresAt + 1)).toBeNull();
  });
});

describe('QR sözleşmesi', () => {
  it('payload kalıcı credential TAŞIMAZ — yalnız kısa ömürlü token + expiry', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const session = createGuestSession()!;
    const payload = buildGuestQrPayload(session);
    expect(payload.oneTimeBootstrapToken).toBe(session.token);
    expect(payload.expiresAtMs).toBe(session.expiresAt);
    expect(isQrPayloadExpired(payload, session.expiresAt + 1)).toBe(true);
  });

  /* F3: endpoint artık verilebilir ama ZORUNLU DEĞİL — verilmediğinde F1
     davranışı (sahte URL üretme) AYNEN korunur. */
  it('endpoint verilmezse localEndpoint null kalır — sahte URL üretilmez', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const payload = buildGuestQrPayload(createGuestSession()!);
    expect(payload.localEndpoint).toBeNull();
    expect(buildGuestQrDisplayValue(payload)).toMatch(/^caros-phone-link:\/\/guest#/);
  });

  it('F3: endpoint verilirse QR düz http adresi taşır, token YINE fragmentte', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const payload = buildGuestQrPayload(createGuestSession()!, 'http://192.168.1.42:41337/p');
    const display = buildGuestQrDisplayValue(payload);
    expect(display.startsWith('http://192.168.1.42:41337/p#')).toBe(true);
    const [beforeHash, afterHash] = display.split('#');
    expect(afterHash).toContain(payload.oneTimeBootstrapToken);
    expect(beforeHash).not.toContain(payload.oneTimeBootstrapToken);
  });

  it('QR görüntü değeri token\'ı yalnız fragment\'ta taşır, query\'de DEĞİL', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const payload = buildGuestQrPayload(createGuestSession()!);
    const display = buildGuestQrDisplayValue(payload);
    const [beforeHash, afterHash] = display.split('#');
    expect(afterHash).toContain(payload.oneTimeBootstrapToken);
    expect(beforeHash).not.toContain(payload.oneTimeBootstrapToken);
  });
});

describe('Portal lifecycle — saf, race-condition-safe karar', () => {
  it('DETACHED ⇒ her zaman STOPPED (guest session var olsa bile)', () => {
    const status = derivePortalDesiredState({ attachmentState: 'DETACHED', hasActiveGuestSession: true });
    expect(status.state).toBe('STOPPED');
    expect(status.reason).toBe('link_detached');
  });

  it('ACTIVE ama guest session yoksa STOPPED', () => {
    const status = derivePortalDesiredState({ attachmentState: 'ACTIVE', hasActiveGuestSession: false });
    expect(status.state).toBe('STOPPED');
  });

  it('ACTIVE + guest session ⇒ RUNNING', () => {
    const status = derivePortalDesiredState({ attachmentState: 'ACTIVE', hasActiveGuestSession: true });
    expect(status.state).toBe('RUNNING');
  });

  it('RACE CONDITION: art arda hızlı ACTIVE→DETACHED→ACTIVE dizisinde her çağrı YALNIZ o ANKİ girdiye göre karar verir (bayat state YOK)', () => {
    const sequence: Array<{ attachmentState: 'DETACHED' | 'LINKED' | 'ACTIVE'; hasActiveGuestSession: boolean }> = [
      { attachmentState: 'ACTIVE', hasActiveGuestSession: true },
      { attachmentState: 'DETACHED', hasActiveGuestSession: true }, // link anında koptu
      { attachmentState: 'ACTIVE', hasActiveGuestSession: false },  // yeniden bağlandı ama guest session henüz yok
      { attachmentState: 'ACTIVE', hasActiveGuestSession: true },
    ];
    const results = sequence.map(derivePortalDesiredState);
    expect(results.map((r) => r.state)).toEqual(['RUNNING', 'STOPPED', 'STOPPED', 'RUNNING']);
    // İki ardışık STOPPED arasında (aynı state) transition YOK — idempotent.
    expect(isPortalTransition(results[1], results[2])).toBe(false);
    expect(isPortalTransition(results[0], results[1])).toBe(true);
  });
});

describe('Spec madde 8 — uçtan uca yaşam döngüsü', () => {
  it('ACTIVE → grant → GuestSession → QR → portal RUNNING; DETACHED → hepsi geçersiz/STOPPED', () => {
    // 1) Link ACTIVE
    mockSnapshot.mockReturnValue(activeSnapshot());
    // 2) Guest MEDIA_CONTROL grant
    const grant = issueGuestMediaGrant();
    expect(grant).not.toBeNull();
    // 3) GuestSession oluşturulabilir
    const session = createGuestSession();
    expect(session).not.toBeNull();
    // 4) QR üretilebilir
    const payload = buildGuestQrPayload(session!);
    expect(isQrPayloadExpired(payload)).toBe(false);
    // 5) Portal erişilebilir (RUNNING kararı)
    const runningStatus = derivePortalDesiredState({
      attachmentState: 'ACTIVE', hasActiveGuestSession: hasActiveGuestSession(),
    });
    expect(runningStatus.state).toBe('RUNNING');

    // ── Link DETACHED ──
    mockSnapshot.mockReturnValue(detachedSnapshot());

    // grant INVALID
    expect(getActiveGuestGrant()).toBeNull();
    // GuestSession token artık geçersiz (401/403 eşdeğeri: doğrulama false)
    expect(validateGuestSessionToken(session!.token)).toBe(false);
    // local endpoint STOP kararı
    const stoppedStatus = derivePortalDesiredState({
      attachmentState: 'DETACHED', hasActiveGuestSession: hasActiveGuestSession(),
    });
    expect(stoppedStatus.state).toBe('STOPPED');
  });
});

describe('Gate 10 (F3) — portal WILDCARD arayuze bind OLAMAZ', () => {
  /* F1'de bu kapı "hiç server yok" diye kilitliydi. F3'te gerçek bir yerel
     dinleyici VAR; bu yüzden kilit "sunucu yok"tan "sunucu ASLA wildcard'a
     bind etmez + TS katmanı kendi soketini açmaz"a TAŞINDI. */
  it('TS Phone Link modüllerinin HİÇBİRİ kendi soketini/sunucusunu açmaz', () => {
    const dir = resolve(__dirname, '../platform/phoneLink');
    const files = [
      'phoneLinkAttachment.ts', 'phoneLinkCapabilityGrant.ts',
      'phoneLinkMusicRemoteAdapter.ts', 'phoneLinkGuestSession.ts',
      'phoneLinkQrContract.ts', 'phoneLinkPortalLifecycle.ts',
      'phoneLinkPortalHttp.ts', 'phoneLinkPortalRuntime.ts', 'phoneLinkRole.ts',
    ];
    for (const file of files) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      expect(src, file).not.toMatch(/createServer|WebSocketServer|\.listen\(|express\(/);
    }
  });

  it('native portal sunucusu 0.0.0.0 wildcard adrese bind ETMEZ, loopback SECMEZ', () => {
    const javaPath = resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneLinkPortalServer.java');
    const src = readFileSync(javaPath, 'utf8');
    /* Bind edilen adres DAİMA seçilen arayüzdür (3 argümanlı ServerSocket). */
    expect(src).toMatch(/new ServerSocket\(0, \d+, bindAddr\)/);
    /* Wildcard adres ASLA kullanılmaz. */
    expect(src).not.toMatch(/"0\.0\.0\.0"/);
    /* Loopback ve any-local adresler aday listesinden DIŞLANIR. */
    expect(src).toMatch(/isLoopbackAddress\(\) \|\| addr\.isAnyLocalAddress\(\)/);
  });

  it('native portal sunucusu token/parmak izi LOGLAMAZ', () => {
    const dir = resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink');
    for (const file of ['PhoneLinkPortalServer.java', 'PhoneLinkPortalPlugin.java']) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      expect(src, file).not.toMatch(/Log\.[dviwe]\(/);
    }
  });
});

describe('revokeAllGuestSessions — açık iptal', () => {
  it('revokeAllGuestSessions sonrası hiçbir token geçerli değil', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    const session = createGuestSession()!;
    revokeAllGuestSessions();
    expect(validateGuestSessionToken(session.token)).toBe(false);
    expect(hasActiveGuestSession()).toBe(false);
  });
});
