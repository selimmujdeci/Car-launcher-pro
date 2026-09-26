/**
 * phoneLinkAttachment.test.ts — PHONE LINK F1 · Attachment Snapshot kilitleri.
 *
 * Fikstür deseni `phoneHubLink.test.tsx`deki `established()` ile TUTARLIDIR
 * (aynı raw şekil). `classifyPhoneAttachment` SAF olduğundan native cache'e
 * hiç dokunmadan doğrudan test edilir.
 */

import { describe, it, expect } from 'vitest';
import { classifyPhoneAttachment } from '../platform/phoneLink/phoneLinkAttachment';
import type { PhoneHubLinkSnapshotRaw } from '../platform/phoneHub/phoneHubLink';

const ABSENT: PhoneHubLinkSnapshotRaw = { present: false };

function established(overrides: Partial<PhoneHubLinkSnapshotRaw> = {}): PhoneHubLinkSnapshotRaw {
  return {
    present: true,
    server: { state: 'CLIENT_CONNECTED', running: true, disposed: false, hasActiveSocket: true },
    preconditions: { ready: true, blockerCode: null, connectPermission: true },
    trust: { hasTrustedPeer: false, peerFingerprint: 'fp-guest-1', lastConnectedAtMs: 0, protocolVersion: 1, connectCount: 1 },
    session: {
      generation: 3, state: 'CONNECTED', handshakeStage: 'ESTABLISHED',
      awaitingUserConfirm: false, trustSkipped: true, disposed: false,
      lastInboundAgeMs: 100, protocolVersion: 1, peerFingerprint: 'fp-guest-1',
      grantedCapabilities: [], encryptionActive: true, trulyEstablished: true,
      lastErrorCode: null,
    },
    pairing: { awaitingConfirmation: false },
    lastErrorCode: null,
    ...overrides,
  };
}

describe('PhoneAttachmentState — merdiven katlaması', () => {
  it('native köprü hiç okunamadıysa DETACHED', () => {
    expect(classifyPhoneAttachment(ABSENT).state).toBe('DETACHED');
  });

  it('sunucu ayakta ama oturum yoksa DETACHED (WAITING_FOR_PHONE)', () => {
    const raw = established({ session: undefined, server: { running: true, disposed: false } });
    expect(classifyPhoneAttachment(raw).state).toBe('DETACHED');
  });

  it('kod onayı bekleniyorsa LINKED (henüz ACTIVE DEĞİL)', () => {
    const raw = established({ pairing: { awaitingConfirmation: true } });
    expect(classifyPhoneAttachment(raw).state).toBe('LINKED');
  });

  it('el sıkışma sürüyorsa (trulyEstablished:false) LINKED', () => {
    const raw = established({
      session: {
        generation: 1, state: 'CONNECTING', trulyEstablished: false,
        encryptionActive: false, disposed: false,
      },
    });
    expect(classifyPhoneAttachment(raw).state).toBe('LINKED');
  });

  it('oturum DEGRADED ise (WEAK) LINKED — ACTIVE DEĞİL', () => {
    const raw = established({ session: { ...established().session, state: 'DEGRADED', trulyEstablished: true } });
    expect(classifyPhoneAttachment(raw).state).toBe('LINKED');
  });

  it('KİLİT: trulyEstablished + CONNECTED ⇒ ACTIVE', () => {
    const snap = classifyPhoneAttachment(established());
    expect(snap.state).toBe('ACTIVE');
  });

  it('KİLİT: ACTIVE ≠ DRIVER — trust kaydı YOKSA rol GUEST kalır (ACTIVE olsa bile)', () => {
    const snap = classifyPhoneAttachment(established()); // trust.hasTrustedPeer: false
    expect(snap.state).toBe('ACTIVE');
    expect(snap.role).toBe('GUEST');
  });

  /* ── F3.0 OTORİTE DÜZELTMESİ ───────────────────────────────────────────
   * Bu test ESKİDEN `TRUSTED kayıt ⇒ PRIMARY` bekliyordu. O kural
   * KALDIRILDI: `deriveTrustLevel()` CİHAZ güveni söyler, KİŞİ kimliği
   * DEĞİL — TRUSTED DEVICE ≠ PRIMARY DRIVER. Deponun kendi kanonik
   * otoritesi de aynı şeyi yazıyor (`driverAuthentication.ts`:
   * "Eşleşmiş bir telefonun araçta olması, SAHİBİNİN araçta olduğunu
   * kanıtlamaz"). Yeni beklenti fail-closed GUEST'tir. */
  it('KİLİT (F3.0): kalıcı TRUSTED kayıt + kurulu oturum bile PRIMARY ÜRETMEZ', () => {
    const raw = established({
      trust: { hasTrustedPeer: true, peerFingerprint: 'fp-guest-1', lastConnectedAtMs: 0, protocolVersion: 1, connectCount: 5 },
    });
    const snap = classifyPhoneAttachment(raw);
    expect(snap.state).toBe('ACTIVE');
    expect(snap.role).toBe('GUEST');
    expect(snap.roleReason).toBe('no_driver_authentication');
  });

  it('disposed oturum ⇒ DETACHED (sunucu ayakta olsa bile üst basamak geçersiz)', () => {
    const raw = established({ session: { ...established().session, disposed: true } });
    expect(classifyPhoneAttachment(raw).state).toBe('DETACHED');
  });

  it('ACTIVE iken sessionEpoch ve deviceFingerprint dolu döner', () => {
    const snap = classifyPhoneAttachment(established());
    expect(snap.sessionEpoch).toBe(3);
    expect(snap.deviceFingerprint).toBe('fp-guest-1');
  });

  it('DETACHED iken sessionEpoch/deviceFingerprint DAİMA null (hayalet grant hedefi olmasın)', () => {
    expect(classifyPhoneAttachment(ABSENT).sessionEpoch).toBeNull();
    expect(classifyPhoneAttachment(ABSENT).deviceFingerprint).toBeNull();
  });
});
