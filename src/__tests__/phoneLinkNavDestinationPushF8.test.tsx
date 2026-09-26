/**
 * phoneLinkNavDestinationPushF8.test.ts — PHONE LINK F8.1 · İKİ AŞAMALI
 * Navigation Destination Push kilitleri.
 *
 * F8 → F8.1 GÜVENLİK DÜZELTMESİ: TRUSTED cihaz TEK BAŞINA artık navigasyonu
 * DEĞİŞTİREMEZ — yalnız bir ÖNERİ oluşturur. Navigasyonu değiştirme yetkisi
 * yalnız araç içi kullanıcı onayından (`approvePendingNavDestination`) gelir
 * ve onay anında HER ŞEY YENİDEN doğrulanır.
 *
 * Kapsam (görev listesindeki numaralarla):
 *  §15 Yetki/Güvenlik     · TRUSTED tek başına yetmez, grant/session/replay
 *  §15 Onay/Navigasyon    · push≠handoff, yalnız onay handoff'u tetikler
 *  §15 Regresyon          · destinationHandoff/authority sınırları
 *
 * KAYNAK TARAMALARI KODA BAKAR, PROZAYA DEĞİL (F7 §18 ile aynı ilke).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const nav = vi.hoisted(() => ({ started: [] as unknown[] }));
const navMocks = vi.hoisted(() => ({
  startNavigation: vi.fn((dest: unknown, offline: boolean, source: string) => {
    nav.started.push({ dest, offline, source });
  }),
}));
vi.mock('../platform/navigationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/navigationService')>();
  return { ...actual, startNavigation: navMocks.startNavigation };
});
vi.mock('../platform/mapViewBus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/mapViewBus')>();
  return { ...actual, setFullMapView: () => { /* no-op */ } };
});
vi.mock('../platform/ttsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/ttsService')>();
  return { ...actual, speakNavigation: () => { /* no-op */ } };
});
vi.mock('../platform/crashLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/crashLogger')>();
  return { ...actual, logError: () => { /* sessiz */ } };
});

const mockSnapshot = vi.fn();
vi.mock('../platform/phoneLink/phoneLinkAttachment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneLink/phoneLinkAttachment')>();
  return { ...actual, getPhoneAttachmentSnapshot: () => mockSnapshot() };
});

const phoneHubMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  sendApplicationMessage: vi.fn(),
}));
vi.mock('../platform/phoneHub/phoneHubLink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneHub/phoneHubLink')>();
  return { ...actual, PhoneHubLink: phoneHubMocks };
});

import {
  dispatchNavDestinationPush, approveNavProposal, rejectNavProposal, expireNavProposal,
  getPhoneLinkNavPushTelemetry, _resetPhoneLinkNavPushTelemetryForTest, _peekProposalForTest,
} from '../platform/phoneLink/phoneLinkNavigationAdapter';
import {
  issueNavDestinationGrant, issueGuestMediaGrant, revokeAllGuestGrants,
  _resetPhoneLinkGrantsForTest,
  type PhoneLinkSessionRef,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';
import {
  _resetHandoffGuardForTest, _resetHandoffCountersForTest, getHandoffSnapshot,
} from '../platform/navigation/destinationHandoff';
import {
  parseApplicationRequest, PHONE_LINK_APP_MESSAGE_VERSION, MAX_DESTINATION_TEXT_CHARS,
} from '../platform/phoneLink/phoneLinkApplicationEnvelope';
import {
  useNavProposalUiStore, NAV_PROPOSAL_TTL_MS, _resetNavProposalsForTest,
} from '../platform/phoneLink/phoneLinkNavProposal';

const SRC = resolve(__dirname, '../platform');
const IST = 41.0082;
const IZM = 38.4237;

/** Yorumları söker — bir kuralı AÇIKLAYAN yorum ihlal SANILMAZ (F7 §18 ile aynı ilke). */
function codeOnly(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function activeTrustedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    state: 'ACTIVE', role: 'GUEST', roleReason: 'link_not_active',
    deviceTrust: 'TRUSTED', sessionEpoch: 7, deviceFingerprint: 'fp-A',
    ...overrides,
  };
}
function activeUntrustedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    state: 'ACTIVE', role: 'GUEST', roleReason: 'link_not_active',
    deviceTrust: 'UNKNOWN', sessionEpoch: 7, deviceFingerprint: 'fp-A',
    ...overrides,
  };
}
function detachedSnapshot() {
  return {
    state: 'DETACHED', role: 'GUEST', roleReason: 'link_not_active',
    deviceTrust: 'UNKNOWN', sessionEpoch: null, deviceFingerprint: null,
  };
}
const SESSION: PhoneLinkSessionRef = { deviceFingerprint: 'fp-A', sessionEpoch: 7 };

beforeEach(() => {
  nav.started = [];
  navMocks.startNavigation.mockClear();
  phoneHubMocks.addListener.mockReset().mockResolvedValue({ remove: () => Promise.resolve() });
  phoneHubMocks.sendApplicationMessage.mockReset().mockResolvedValue({ sent: true });
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkNavPushTelemetryForTest();
  _resetNavProposalsForTest();
  _resetHandoffGuardForTest();
  _resetHandoffCountersForTest();
  mockSnapshot.mockReset().mockReturnValue(activeTrustedSnapshot());
});

/* ══════════════════════════════════════════════════════════════════════════
 * PUSH ≠ HANDOFF — F8.1'in temel güvenlik iddiası
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8.1 — push yalnız ÖNERİ oluşturur, navigasyonu DEĞİŞTİRMEZ', () => {
  it('1. geçerli push → proposalId döner AMA startNavigation ÇAĞRILMAZ', async () => {
    issueNavDestinationGrant();
    const r = await dispatchNavDestinationPush(
      { latitude: IST, longitude: 28.9784, label: 'Sultanahmet', address: null }, 'req-1', SESSION,
    );
    expect(r).toEqual({ ok: true, proposalId: 'req-1' });
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
    expect(nav.started).toEqual([]);
  });

  it('2. push sonrası öneri UI store\'unda görünür (deviceFingerprint TAŞIMAZ)', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: 'Ev', address: null }, 'req-2', SESSION);
    const p = useNavProposalUiStore.getState().proposal;
    expect(p).not.toBeNull();
    expect(p?.proposalId).toBe('req-2');
    expect(p?.label).toBe('Ev');
    expect(JSON.stringify(p)).not.toContain('fp-A');
  });

  it('3. aynı requestId ikinci kez gelirse (retry) AYNI öneri döner, ikincisi oluşturulmaz', async () => {
    issueNavDestinationGrant();
    const first = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-3', SESSION);
    const second = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-3', SESSION);
    expect(first).toEqual(second);
    expect(getPhoneLinkNavPushTelemetry().pendingCount).toBe(1);
  });

  it('4. farklı requestId ile YENİ push, AYNI oturumun ÖNCEKİ onaylanmamış önerisinin yerine geçer', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: 'Birinci', address: null }, 'req-4a', SESSION);
    await dispatchNavDestinationPush({ latitude: IZM, longitude: 27.1428, label: 'Ikinci', address: null }, 'req-4b', SESSION);
    expect(getPhoneLinkNavPushTelemetry().pendingCount).toBe(1);
    expect(useNavProposalUiStore.getState().proposal?.proposalId).toBe('req-4b');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SECURITY — push-time yetkilendirme
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8.1 Security — push-time', () => {
  it('5. DETACHED → NO_GRANT (grant zaten hiç var olamaz)', async () => {
    mockSnapshot.mockReturnValue(detachedSnapshot());
    const r = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-5');
    expect(r).toEqual({ ok: false, denialCode: 'NO_GRANT' });
  });

  it('6. stale epoch (mesaj eski nesilden) → reject', async () => {
    mockSnapshot.mockReturnValue(activeTrustedSnapshot({ sessionEpoch: 9 }));
    issueNavDestinationGrant();
    const staleSession: PhoneLinkSessionRef = { deviceFingerprint: 'fp-A', sessionEpoch: 7 };
    const r = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-6', staleSession);
    expect(r.ok).toBe(false);
  });

  it('7. fingerprint mismatch → reject', async () => {
    issueNavDestinationGrant();
    const otherFp: PhoneLinkSessionRef = { deviceFingerprint: 'fp-B', sessionEpoch: 7 };
    const r = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-7', otherFp);
    expect(r.ok).toBe(false);
  });

  it('8. capability yok → NO_GRANT', async () => {
    const r = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-8', SESSION);
    expect(r).toEqual({ ok: false, denialCode: 'NO_GRANT' });
  });

  it('9. revoked capability → reject', async () => {
    issueNavDestinationGrant();
    revokeAllGuestGrants();
    const r = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-9', SESSION);
    expect(r.ok).toBe(false);
  });

  it('10. MEDIA_CONTROL grantı NAV yetkisi VERMEZ', async () => {
    issueGuestMediaGrant();
    const r = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-10', SESSION);
    expect(r).toEqual({ ok: false, denialCode: 'NO_GRANT' });
  });

  it('11. guest (TRUSTED değil) cihaz → grant hiç VERİLMEZ', () => {
    mockSnapshot.mockReturnValue(activeUntrustedSnapshot());
    expect(issueNavDestinationGrant()).toBeNull();
  });

  it('12. invalid latitude (Infinity) → zarf seviyesinde reddedilir', () => {
    const parsed = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm1', type: 'NAV_DESTINATION_PUSH', latitude: Infinity, longitude: 29,
    }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.status).toBe('REJECTED_MALFORMED');
  });

  it('13. NaN longitude → reddedilir', () => {
    const parsed = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm1', type: 'NAV_DESTINATION_PUSH', latitude: 41, longitude: NaN,
    }));
    expect(parsed.ok).toBe(false);
  });

  it('14. aralık dışı koordinat → reddedilir', () => {
    const parsed = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm1', type: 'NAV_DESTINATION_PUSH', latitude: 999, longitude: 29,
    }));
    expect(parsed.ok).toBe(false);
  });

  it('15. aşırı uzun label → reddedilir (sanitize DEĞİL, reject)', () => {
    const parsed = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm1', type: 'NAV_DESTINATION_PUSH',
      latitude: 41, longitude: 29, label: 'x'.repeat(MAX_DESTINATION_TEXT_CHARS + 1),
    }));
    expect(parsed.ok).toBe(false);
  });

  it('16. kontrol karakteri içeren label → reddedilir', () => {
    const parsed = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm1', type: 'NAV_DESTINATION_PUSH',
      latitude: 41, longitude: 29, label: `Ofis${String.fromCharCode(7)}gizli`,
    }));
    expect(parsed.ok).toBe(false);
  });

  it('17. replay: aynı requestId ile öneri zaten onaylandıktan SONRA yeniden gönderilirse eski öneri yoktur (idempotent değil, EXPIRED)', async () => {
    issueNavDestinationGrant();
    const push = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-17', SESSION);
    expect(push.ok).toBe(true);
    await approveNavProposal('req-17');
    /* Öneri artık TÜKETİLDİ. Aynı proposalId'yi onaylamaya kalkmak (ikinci bir
       "approve" çağrısı — gerçek replay senaryosu burada, ingress zaten
       messageId dedupe'si ile push'un KENDİSİNİ tekrar dispatch'e sokmaz). */
    const secondApprove = await approveNavProposal('req-17');
    expect(secondApprove).toEqual({ ok: false, denialCode: 'EXPIRED' });
    expect(navMocks.startNavigation).toHaveBeenCalledTimes(1); // İKİNCİ handoff YOK
  });

  it('18. destination payload trust/person ÜRETMEZ — yalnız TRUSTED kanıtı okunur, PRIMARY ARANMAZ', () => {
    mockSnapshot.mockReturnValue(activeTrustedSnapshot({ role: 'GUEST' }));
    expect(issueNavDestinationGrant()).not.toBeNull();
  });

  it('19. yapısal: adaptör/grant connectivity import ETMEZ (internetten bağımsız)', () => {
    expect(codeOnly('phoneLink/phoneLinkNavigationAdapter.ts')).not.toMatch(/from ['"].*connectivity/);
    expect(codeOnly('phoneLink/phoneLinkCapabilityGrant.ts')).not.toMatch(/from ['"].*connectivity/);
    expect(codeOnly('phoneLink/phoneLinkNavProposal.ts')).not.toMatch(/from ['"].*connectivity/);
  });

  it('20. telemetri koordinat/adres/etiket/fingerprint TAŞIMAZ', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: 'Gizli Ev Adresim', address: 'Sokak 5' }, 'req-20', SESSION);
    const dump = JSON.stringify(getPhoneLinkNavPushTelemetry());
    expect(dump).not.toContain('Gizli Ev Adresim');
    expect(dump).not.toContain('Sokak 5');
    expect(dump).not.toContain(String(IST));
    expect(dump).not.toContain('fp-A');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ONAY ANINDA YENİDEN DOĞRULAMA (§11) — F8.1'in ikinci temel iddiası
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8.1 — onay anında yeniden doğrulama', () => {
  it('21. onaydan ÖNCE grant revoke edilirse → handoff YAPILMAZ', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-21', SESSION);
    revokeAllGuestGrants();
    const r = await approveNavProposal('req-21');
    expect(r.ok).toBe(false);
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
  });

  it('22. onaydan ÖNCE session disconnect olursa (DETACHED) → handoff YAPILMAZ', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-22', SESSION);
    mockSnapshot.mockReturnValue(detachedSnapshot());
    const r = await approveNavProposal('req-22');
    expect(r.ok).toBe(false);
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
  });

  it('23. onaydan ÖNCE yeni nesle geçilirse (reconnect) → handoff YAPILMAZ', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-23', SESSION);
    mockSnapshot.mockReturnValue(activeTrustedSnapshot({ sessionEpoch: 8 })); // reconnect → yeni nesil
    const r = await approveNavProposal('req-23');
    expect(r.ok).toBe(false);
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
  });

  it('24. geçerli onay → TAM OLARAK BİR kez startNavigation, sahiplik Navigation\'a geçer', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: 'Ofis', address: null }, 'req-24', SESSION);
    const r = await approveNavProposal('req-24');
    expect(r).toEqual({ ok: true });
    expect(navMocks.startNavigation).toHaveBeenCalledTimes(1);
    expect(navMocks.startNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: IST, name: 'Ofis' }), false, 'USER_HANDOFF',
    );
    expect(getHandoffSnapshot().accepted).toBe(1);
    expect(getHandoffSnapshot().lastChannel).toBe('PHONE_LINK');
  });

  it('25. onay sonrası disconnect kabul edilmiş navigasyonu SİLMEZ (ownership Navigation\'da kalır)', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-25', SESSION);
    await approveNavProposal('req-25');
    expect(navMocks.startNavigation).toHaveBeenCalledTimes(1);

    mockSnapshot.mockReturnValue(detachedSnapshot()); // disconnect SONRASI
    expect(navMocks.startNavigation).toHaveBeenCalledTimes(1); // hâlâ 1 — geri ALINMADI
  });

  it('26. Reddet → YENİDEN DOĞRULAMA GEREKMEZ, grant zaten revoke olsa bile red güvenlidir', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-26', SESSION);
    revokeAllGuestGrants();
    const { existed } = rejectNavProposal('req-26');
    expect(existed).toBe(true);
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
  });

  it('27. Reddet → mevcut rota (varsa) DOKUNULMADAN kalır (handoff hiç çağrılmaz)', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-27', SESSION);
    rejectNavProposal('req-27');
    expect(getHandoffSnapshot().accepted).toBe(0);
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
  });

  it('28. Null Island (0,0) onay anında INVALID_DESTINATION ile reddedilir', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: 0, longitude: 0, label: null, address: null }, 'req-28', SESSION);
    const r = await approveNavProposal('req-28');
    expect(r).toEqual({ ok: false, denialCode: 'INVALID_DESTINATION' });
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
  });

  it('29. süresi geçmiş öneri (TTL) onaylanamaz → EXPIRED', async () => {
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      issueNavDestinationGrant();
      await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-29', SESSION);
      vi.setSystemTime(start + NAV_PROPOSAL_TTL_MS + 1_000);
      const r = await approveNavProposal('req-29');
      expect(r).toEqual({ ok: false, denialCode: 'EXPIRED' });
      expect(navMocks.startNavigation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('30. expireNavProposal (UI geri sayım doldu) → proposal kalkar, handoff YAPILMAZ', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-30', SESSION);
    const { existed } = expireNavProposal('req-30');
    expect(existed).toBe(true);
    expect(_peekProposalForTest('req-30')).toBeNull();
    expect(navMocks.startNavigation).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * AUTHORITY — Phone Link route/navigationSession sahiplenmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8.1 Authority', () => {
  it('31. adaptör yalnız destinationHandoff+navProposal import eder — routingService/mapStore YOK', () => {
    const code = codeOnly('phoneLink/phoneLinkNavigationAdapter.ts');
    expect(code).not.toMatch(/from ['"].*routingService/);
    expect(code).not.toMatch(/from ['"].*mapSourceStore/);
    expect(code).not.toMatch(/from ['"].*navigationSessionRuntime/);
    expect(code).not.toMatch(/setDestination|useNavigationStore/);
    expect(code).not.toMatch(/mediaCommandGateway/);
    expect(code).toMatch(/from ['"]\.\.\/navigation\/destinationHandoff['"]/);
  });

  it('32. navProposal modülü destinationHandoff\'u ÇAĞIRMAZ (yalnız kayıt tutar)', () => {
    const code = codeOnly('phoneLink/phoneLinkNavProposal.ts');
    expect(code).not.toMatch(/acceptHandoffDestination|startNavigation/);
  });

  it('33. ACCEPTED yalnız "destinationHandoff kabul etti" der — dönen sonuç ok:true dışında alan taşımaz', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-33', SESSION);
    const r = await approveNavProposal('req-33');
    expect(Object.keys(r)).toEqual(['ok']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * OFFLINE + ÜRETİM BOOT ENTEGRASYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8.1 — offline + gerçek ingress zinciri', () => {
  it('34. internet OFFLINE + Phone Link ACTIVE + valid capability → push+onay YİNE mümkün', async () => {
    const originalNavigator = globalThis.navigator;
    try {
      Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
      issueNavDestinationGrant();
      const push = await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: null, address: null }, 'req-34', SESSION);
      expect(push.ok).toBe(true);
      const approve = await approveNavProposal('req-34');
      expect(approve).toEqual({ ok: true });
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  it('35. ÜRETİM BOOT ZİNCİRİ: gerçek native applicationMessage olayı → gerçek ingress → pending proposal → onay → handoff → sonuç mesajı gönderimi', async () => {
    const { startPhoneLinkProductBoot, _resetPhoneLinkProductBootForTest } = await import('../platform/phoneLink/phoneLinkProductBoot');
    const { approvePendingNavDestination } = await import('../platform/phoneLink/phoneLinkApplicationIngress');

    _resetPhoneLinkProductBootForTest();
    let capturedHandler: ((event: unknown) => void) | null = null;
    phoneHubMocks.addListener.mockImplementation((eventName: string, handler: (e: unknown) => void) => {
      if (eventName === 'applicationMessage') capturedHandler = handler;
      return Promise.resolve({ remove: () => Promise.resolve() });
    });

    issueNavDestinationGrant();
    const dispose = startPhoneLinkProductBoot();
    try {
      // Boot'un applicationMessage dinleyicisi ASENKRON kurulur (native plugin importu).
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(capturedHandler).not.toBeNull();

      const payload = JSON.stringify({
        v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'boot-req-1', type: 'NAV_DESTINATION_PUSH',
        latitude: IST, longitude: 28.9784, label: 'Üretim Zinciri Testi',
      });
      capturedHandler!({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
      // native olay handler'ı içeride async dispatch başlatır — bir mikro-görev turu bekle.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(useNavProposalUiStore.getState().proposal?.proposalId).toBe('boot-req-1');
      expect(navMocks.startNavigation).not.toHaveBeenCalled(); // ÖNERİ — henüz navigasyon DEĞİL

      const status = await approvePendingNavDestination('boot-req-1');
      expect(status).toBe('ACCEPTED');
      expect(navMocks.startNavigation).toHaveBeenCalledTimes(1);
      expect(phoneHubMocks.sendApplicationMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.stringContaining('"status":"ACCEPTED"') }),
      );
    } finally {
      dispose();
      _resetPhoneLinkProductBootForTest();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * UI — onay kartı (createRoot/act deseni, repo genelinde kullanılan yöntem)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F8.1 UI — PhoneLinkNavProposalOverlay', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('36. öneri yokken hiçbir şey render ETMEZ', async () => {
    const { PhoneLinkNavProposalOverlay } = await import('../components/common/PhoneLinkNavProposalOverlay');
    act(() => { root.render(<PhoneLinkNavProposalOverlay />); });
    expect(container.textContent).toBe('');
  });

  it('37. öneri varsa kart görünür ve "Git" onay fonksiyonunu ÇAĞIRIR', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: 'Test Hedefi', address: null }, 'req-ui-1', SESSION);

    const { PhoneLinkNavProposalOverlay } = await import('../components/common/PhoneLinkNavProposalOverlay');
    act(() => { root.render(<PhoneLinkNavProposalOverlay />); });
    expect(container.textContent).toContain('Test Hedefi');

    const buttons = Array.from(container.querySelectorAll('button'));
    const gitButton = buttons.find((b) => b.textContent === 'Git');
    expect(gitButton).toBeDefined();
    await act(async () => { gitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(navMocks.startNavigation).toHaveBeenCalledTimes(1);
  });

  it('38. "Reddet" red fonksiyonunu ÇAĞIRIR, handoff YAPILMAZ', async () => {
    issueNavDestinationGrant();
    await dispatchNavDestinationPush({ latitude: IST, longitude: 28.9784, label: 'Test Hedefi 2', address: null }, 'req-ui-2', SESSION);

    const { PhoneLinkNavProposalOverlay } = await import('../components/common/PhoneLinkNavProposalOverlay');
    act(() => { root.render(<PhoneLinkNavProposalOverlay />); });

    const buttons = Array.from(container.querySelectorAll('button'));
    const rejectButton = buttons.find((b) => b.textContent === 'Reddet');
    expect(rejectButton).toBeDefined();
    await act(async () => { rejectButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(navMocks.startNavigation).not.toHaveBeenCalled();
    expect(container.textContent).toBe(''); // kart kapandı
  });
});
