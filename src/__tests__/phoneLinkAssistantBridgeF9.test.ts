/**
 * phoneLinkAssistantBridgeF9.test.ts — PHONE LINK F9 · Mavi Assistant Bridge kilitleri.
 *
 * ── TASARIM KARARI (rapor + kod yorumlarıyla AYNI) ──────────────────────────
 * Bridge `processTextCommand`/`maviTurn`ı KULLANMAZ — Mavi'nin GERÇEK
 * "birleşik beyin" karar vericisini (`tryCompanionBrain`) ve çevrimdışı
 * sohbet motorunu (`tryOfflineConversation`) DOĞRUDAN çağırır, yalnız
 * `kind:'chat'` dalını kabul eder. Bu yüzden testler bu iki fonksiyonu
 * MOCK'lar (Mavi'nin KENDİ karar mantığı bu turun kapsamı DIŞINDADIR —
 * yalnız bridge'in o karara NE YAPTIĞI test edilir).
 *
 * Kapsam (görev listesindeki numaralarla):
 *  §21 Güvenlik      1-15  · session/capability/replay/private-data/log
 *  §21 Lifecycle      16-24 · RECEIVED≠SUCCESS, terminal, follow-up yok
 *  §21 İşlev          25-31 · Companion send, offline, F7 policy, boot zinciri
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const resolveKeysMock = vi.fn();
vi.mock('../platform/voiceService', () => ({ _resolveAiKeys: () => resolveKeysMock() }));

const tryCompanionBrainMock = vi.fn();
vi.mock('../platform/companion/companionChatProvider', () => ({
  tryCompanionBrain: (...args: unknown[]) => tryCompanionBrainMock(...args),
}));

const tryOfflineConversationMock = vi.fn();
vi.mock('../platform/offlineConversationEngine', () => ({
  tryOfflineConversation: (...args: unknown[]) => tryOfflineConversationMock(...args),
}));

const phoneHubMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  sendApplicationMessage: vi.fn(),
}));
vi.mock('../platform/phoneHub/phoneHubLink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneHub/phoneHubLink')>();
  return { ...actual, PhoneHubLink: phoneHubMocks };
});

const mockSnapshot = vi.fn();
vi.mock('../platform/phoneLink/phoneLinkAttachment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/phoneLink/phoneLinkAttachment')>();
  return { ...actual, getPhoneAttachmentSnapshot: () => mockSnapshot() };
});

import {
  authorizeAssistantBridgeRequest, processAssistantBridgeRequest,
  isAssistantBridgeResultDeliverable, getPhoneLinkAssistantBridgeTelemetry,
  _resetPhoneLinkAssistantBridgeTelemetryForTest,
} from '../platform/phoneLink/phoneLinkAssistantBridgeAdapter';
import {
  issueAssistantBridgeGrant, issueGuestMediaGrant, issueNavDestinationGrant,
  revokeAllGuestGrants, _resetPhoneLinkGrantsForTest,
  type PhoneLinkSessionRef,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';
import {
  parseApplicationRequest, PHONE_LINK_APP_MESSAGE_VERSION, MAX_ASSISTANT_TEXT_CHARS,
} from '../platform/phoneLink/phoneLinkApplicationEnvelope';
import {
  handleApplicationMessageForTest, _resetPhoneLinkIngressTelemetryForTest,
  _resetPhoneLinkDedupeForTest,
} from '../platform/phoneLink/phoneLinkApplicationIngress';

const SRC = resolve(__dirname, '../platform');

/**
 * Zincirdeki `await import(...)` sıçramaları SAF mikro-görev DEĞİLDİR (Vite/
 * Vitest modül çözümleyicisi bir makro-görev turu kullanır) — düz
 * `Promise.resolve()` zinciri YETERSİZ kalıyordu (kanıt: ölçüldü, izole
 * tekrar üretim). `vi.waitFor` koşul gerçek olana dek POLLING yapar.
 */
async function waitForCall(mock: { mock: { calls: unknown[][] } }): Promise<void> {
  await vi.waitFor(() => {
    if (mock.mock.calls.length === 0) throw new Error('henüz çağrılmadı');
  }, { timeout: 2000, interval: 5 });
}

/** Yorumları söker — bir kuralı AÇIKLAYAN yorum ihlal SANILMAZ. */
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
function activeUntrustedSnapshot() {
  return {
    state: 'ACTIVE', role: 'GUEST', roleReason: 'link_not_active',
    deviceTrust: 'UNKNOWN', sessionEpoch: 7, deviceFingerprint: 'fp-A',
  };
}
function detachedSnapshot() {
  return {
    state: 'DETACHED', role: 'GUEST', roleReason: 'link_not_active',
    deviceTrust: 'UNKNOWN', sessionEpoch: null, deviceFingerprint: null,
  };
}
const SESSION: PhoneLinkSessionRef = { deviceFingerprint: 'fp-A', sessionEpoch: 7 };

function aiUsableKeys() {
  return { provider: 'gemini', apiKey: 'k', hasNet: true, tavilyKey: '', searchKey: '', chain: [{ provider: 'gemini', apiKey: 'k' }] };
}
function aiOfflineKeys() {
  return { provider: 'none', apiKey: '', hasNet: false, tavilyKey: '', searchKey: '', chain: [] };
}

beforeEach(() => {
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkAssistantBridgeTelemetryForTest();
  _resetPhoneLinkIngressTelemetryForTest();
  _resetPhoneLinkDedupeForTest();
  mockSnapshot.mockReset().mockReturnValue(activeTrustedSnapshot());
  resolveKeysMock.mockReset().mockResolvedValue(aiUsableKeys());
  tryCompanionBrainMock.mockReset().mockResolvedValue({ kind: 'chat', response: 'Cevap metni', route: 'companion_gemini' });
  tryOfflineConversationMock.mockReset().mockReturnValue({ handled: false, response: '' });
  phoneHubMocks.addListener.mockReset().mockResolvedValue({ remove: () => Promise.resolve() });
  phoneHubMocks.sendApplicationMessage.mockReset().mockResolvedValue({ sent: true });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §21 SECURITY (1-15)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 Security', () => {
  it('1. encrypted session yok (DETACHED) → reject', () => {
    mockSnapshot.mockReturnValue(detachedSnapshot());
    const r = authorizeAssistantBridgeRequest('req-1');
    expect(r.ok).toBe(false);
  });

  it('2. stale epoch → reject', () => {
    mockSnapshot.mockReturnValue(activeTrustedSnapshot({ sessionEpoch: 9 }));
    issueAssistantBridgeGrant();
    const stale: PhoneLinkSessionRef = { deviceFingerprint: 'fp-A', sessionEpoch: 7 };
    const r = authorizeAssistantBridgeRequest('req-2', stale);
    expect(r.ok).toBe(false);
  });

  it('3. fingerprint mismatch → reject', () => {
    issueAssistantBridgeGrant();
    const other: PhoneLinkSessionRef = { deviceFingerprint: 'fp-B', sessionEpoch: 7 };
    const r = authorizeAssistantBridgeRequest('req-3', other);
    expect(r.ok).toBe(false);
  });

  it('4. capability yok/revoked → reject', () => {
    /* `ASSISTANT_BRIDGE` `requiresAttachedSession:true` taşır (`INTERNET_SHARE`
       ile AYNI, `NAVIGATION_CONTROL`dan daha sıkı) — grant hiç yoksa `attached`
       hesaplanamaz ve kanonik motor `NOT_ATTACHED` döner (`NO_GRANT` yalnız
       `attached:true` AMA `grantedCapabilities` boşken üretilir — burada asla). */
    const r1 = authorizeAssistantBridgeRequest('req-4a', SESSION);
    expect(r1).toEqual({ ok: false, denialCode: 'NOT_ATTACHED' });

    issueAssistantBridgeGrant();
    revokeAllGuestGrants();
    const r2 = authorizeAssistantBridgeRequest('req-4b', SESSION);
    expect(r2.ok).toBe(false);
  });

  it('5. MEDIA_CONTROL, ASSISTANT_BRIDGE VERMEZ', () => {
    issueGuestMediaGrant();
    const r = authorizeAssistantBridgeRequest('req-5', SESSION);
    expect(r).toEqual({ ok: false, denialCode: 'NOT_ATTACHED' });
  });

  it('6. NAV grant, ASSISTANT_BRIDGE VERMEZ', () => {
    issueNavDestinationGrant();
    const r = authorizeAssistantBridgeRequest('req-6', SESSION);
    expect(r).toEqual({ ok: false, denialCode: 'NOT_ATTACHED' });
  });

  it('7. guest (TRUSTED değil) bağlantı → grant hiç VERİLMEZ (driver identity üretmez)', () => {
    mockSnapshot.mockReturnValue(activeUntrustedSnapshot());
    expect(issueAssistantBridgeGrant()).toBeNull();
  });

  it('8. destructive/donanım komutu → Mavi "action" derse ÇALIŞTIRILMAZ', async () => {
    tryCompanionBrainMock.mockResolvedValue({ kind: 'action', semantic: {}, semantics: [] });
    const r = await processAssistantBridgeRequest('kapıları kilitle');
    expect(r).toEqual({ ok: false, denialCode: 'ACTION_NOT_PERMITTED' });
  });

  it('9. radyo/BT/WiFi manipülasyonu → aynı "action" reddi yoluyla engellenir', async () => {
    tryCompanionBrainMock.mockResolvedValue({ kind: 'action', semantic: {}, semantics: [] });
    const r = await processAssistantBridgeRequest('bluetooth aç');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.denialCode).toBe('ACTION_NOT_PERMITTED');
  });

  it('10. özel veri erişimi → yapısal: adaptör kişi/rehber/mesaj servisini import ETMEZ', () => {
    const code = codeOnly('phoneLink/phoneLinkAssistantBridgeAdapter.ts');
    expect(code).not.toMatch(/contactsService|messagingService|addressBookService/);
  });

  it('11. malformed/oversized metin → zarf seviyesinde reddedilir', () => {
    const empty = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm1', type: 'ASSISTANT_BRIDGE_REQUEST', text: '   ',
    }));
    expect(empty.ok).toBe(false);

    const oversized = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm2', type: 'ASSISTANT_BRIDGE_REQUEST',
      text: 'x'.repeat(MAX_ASSISTANT_TEXT_CHARS + 1),
    }));
    expect(oversized.ok).toBe(false);

    const controlChar = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'm3', type: 'ASSISTANT_BRIDGE_REQUEST',
      text: `merhaba${String.fromCharCode(7)}mavi`,
    }));
    expect(controlChar.ok).toBe(false);
  });

  it('12. duplicate requestId → tek Mavi turu (ikinci mesaj sessizce yutulur)', async () => {
    issueAssistantBridgeGrant();
    const payload = JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'dup-1', type: 'ASSISTANT_BRIDGE_REQUEST', text: 'merhaba',
    });
    const first = await handleApplicationMessageForTest({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
    expect(first).not.toBeNull();
    const second = await handleApplicationMessageForTest({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
    expect(second).toBeNull(); // dedupe: ikinci teslimat sessizce yutulur
    await waitForCall(tryCompanionBrainMock);
    expect(tryCompanionBrainMock).toHaveBeenCalledTimes(1);
  });

  it('13. disconnect sonrası sonuç SIZMAZ (deliverable=false)', () => {
    issueAssistantBridgeGrant();
    mockSnapshot.mockReturnValue(detachedSnapshot());
    expect(isAssistantBridgeResultDeliverable('fp-A', 7)).toBe(false);
  });

  it('14. eski session sonucu YENİ session\'a gitmez (epoch ilerledi)', () => {
    mockSnapshot.mockReturnValue(activeTrustedSnapshot({ sessionEpoch: 8 })); // reconnect
    issueAssistantBridgeGrant();
    expect(isAssistantBridgeResultDeliverable('fp-A', 7)).toBe(false); // eski epoch
  });

  it('15. prompt/cevap/fingerprint telemetriye YAZILMAZ', async () => {
    issueAssistantBridgeGrant();
    tryCompanionBrainMock.mockResolvedValue({ kind: 'chat', response: 'Gizli kişisel bilgi burada', route: 'companion_gemini' });
    await processAssistantBridgeRequest('çok gizli sorum var');
    const dump = JSON.stringify(getPhoneLinkAssistantBridgeTelemetry());
    expect(dump).not.toContain('Gizli kişisel bilgi');
    expect(dump).not.toContain('çok gizli sorum');
    expect(dump).not.toContain('fp-A');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §21 LIFECYCLE (16-24)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 Lifecycle', () => {
  it('16. RECEIVED ≠ SUCCESS: yalnız BAŞARILI ACK istek yetkilendirildi der, cevap içermez', async () => {
    issueAssistantBridgeGrant();
    const payload = JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'lc-1', type: 'ASSISTANT_BRIDGE_REQUEST', text: 'merhaba',
    });
    const resp = await handleApplicationMessageForTest({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
    const parsed = JSON.parse(resp!);
    expect(parsed.status).toBe('RECEIVED');
    expect(parsed.result).toBeUndefined();
  });

  it('17. Mavi terminal SUCCESS → doğru result (chat metni)', async () => {
    tryCompanionBrainMock.mockResolvedValue({ kind: 'chat', response: 'Yakında 3 benzin istasyonu var.', route: 'companion_gemini' });
    const r = await processAssistantBridgeRequest('yakında benzinlik var mı');
    expect(r).toEqual({ ok: true, response: 'Yakında 3 benzin istasyonu var.' });
  });

  it('18. Mavi terminal ERROR (null) + offline de cevapsız → doğru FAILURE (NO_ANSWER)', async () => {
    tryCompanionBrainMock.mockResolvedValue(null);
    tryOfflineConversationMock.mockReturnValue({ handled: false, response: '' });
    const r = await processAssistantBridgeRequest('anlaşılmaz bir şey');
    expect(r).toEqual({ ok: false, denialCode: 'NO_ANSWER' });
  });

  it('19. BUSY yerine bağımsız işlem: araç içi Mavi turuna DOKUNMAZ (yapısal)', () => {
    const code = codeOnly('phoneLink/phoneLinkAssistantBridgeAdapter.ts');
    expect(code).not.toMatch(/maviTurn|beginMaviTurn|processTextCommand/);
  });

  it('20. follow-up deadlock oluşmaz: adaptör follow-up/deferred-response modülü İÇERMEZ', () => {
    const code = codeOnly('phoneLink/phoneLinkAssistantBridgeAdapter.ts');
    expect(code).not.toMatch(/deferredResponse|maviWorkload|clearDeferredResponse/);
  });

  it('21. terminal event tek kez işlenir — bir istek için processAssistantBridgeRequest bir kez çağrılır', async () => {
    issueAssistantBridgeGrant();
    const payload = JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'lc-21', type: 'ASSISTANT_BRIDGE_REQUEST', text: 'merhaba',
    });
    await handleApplicationMessageForTest({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
    await waitForCall(tryCompanionBrainMock);
    expect(tryCompanionBrainMock).toHaveBeenCalledTimes(1);
  });

  it('22. revoke pending isteği terminalize eder — sonuç kimseye SIZMAZ', async () => {
    issueAssistantBridgeGrant();
    // authorize BAŞARILI (grant o an geçerli), sonra revoke — gönderim anında düşer.
    const accept = authorizeAssistantBridgeRequest('lc-22', SESSION);
    expect(accept.ok).toBe(true);
    revokeAllGuestGrants();
    expect(isAssistantBridgeResultDeliverable('fp-A', 7)).toBe(false);
  });

  it('23. disconnect orphan bridge request BIRAKMAZ — yeni istek reddedilir, eski sonuç sızmaz', async () => {
    issueAssistantBridgeGrant();
    const accept = authorizeAssistantBridgeRequest('lc-23', SESSION);
    expect(accept.ok).toBe(true);
    mockSnapshot.mockReturnValue(detachedSnapshot());
    const second = authorizeAssistantBridgeRequest('lc-23b', SESSION);
    expect(second.ok).toBe(false);
    expect(isAssistantBridgeResultDeliverable('fp-A', 7)).toBe(false);
  });

  it('24. Mavi hatası (throw) Phone Link session\'ı DÜŞÜRMEZ — bounded ACK döner', async () => {
    tryCompanionBrainMock.mockRejectedValue(new Error('boom'));
    const r = await processAssistantBridgeRequest('bir şey sor');
    expect(r).toEqual({ ok: false, denialCode: 'INTERNAL_ERROR' });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §21 İŞLEV (25-31)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F9 Functional', () => {
  it('25. valid metin gönderimi → RECEIVED, sonra ACCEPTED sonuç mesajı gönderilir', async () => {
    issueAssistantBridgeGrant();
    const payload = JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'fn-25', type: 'ASSISTANT_BRIDGE_REQUEST', text: 'hava nasıl',
    });
    const resp = await handleApplicationMessageForTest({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
    expect(JSON.parse(resp!).status).toBe('RECEIVED');
    await waitForCall(phoneHubMocks.sendApplicationMessage);
    expect(phoneHubMocks.sendApplicationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.stringContaining('"status":"ACCEPTED"') }),
    );
  });

  it('26. invalid metin (boş) → zarf seviyesinde reddedilir, Mavi\'ye HİÇ gitmez', async () => {
    const parsed = parseApplicationRequest(JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'fn-26', type: 'ASSISTANT_BRIDGE_REQUEST', text: '',
    }));
    expect(parsed.ok).toBe(false);
    expect(tryCompanionBrainMock).not.toHaveBeenCalled();
  });

  it('27. ACK doğru request\'e bağlanır (id round-trip)', async () => {
    issueAssistantBridgeGrant();
    const payload = JSON.stringify({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'fn-27-unique', type: 'ASSISTANT_BRIDGE_REQUEST', text: 'selam',
    });
    const resp = await handleApplicationMessageForTest({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
    expect(JSON.parse(resp!).id).toBe('fn-27-unique');
  });

  it('28. offline local istek çalışır (aiUsable=false → tryOfflineConversation kullanılır)', async () => {
    resolveKeysMock.mockResolvedValue(aiOfflineKeys());
    tryOfflineConversationMock.mockReturnValue({ handled: true, response: 'Yakıt seviyesi %62.' });
    const r = await processAssistantBridgeRequest('yakıt seviyesi ne kadar');
    expect(r).toEqual({ ok: true, response: 'Yakıt seviyesi %62.' });
    expect(tryCompanionBrainMock).not.toHaveBeenCalled();
  });

  it('29. cloud istek F7 policy\'ye uyar — yapısal: adaptör bağımsız connectivity kararı ÜRETMEZ, _resolveAiKeys\'in F7 kararını KULLANIR', () => {
    const code = codeOnly('phoneLink/phoneLinkAssistantBridgeAdapter.ts');
    expect(code).not.toMatch(/allowsConnectivity|ConnectivityAuthority|navigator\.onLine/);
    expect(code).toMatch(/_resolveAiKeys/);
  });

  it('30. üretim boot zinciri: gerçek native applicationMessage olayı → gerçek ingress → ASSISTANT_BRIDGE yetkilendirme → Mavi adaptör → terminal → şifreli sonuç', async () => {
    const { startPhoneLinkProductBoot, _resetPhoneLinkProductBootForTest } = await import('../platform/phoneLink/phoneLinkProductBoot');
    _resetPhoneLinkProductBootForTest();
    let capturedHandler: ((event: unknown) => void) | null = null;
    phoneHubMocks.addListener.mockImplementation((eventName: string, handler: (e: unknown) => void) => {
      if (eventName === 'applicationMessage') capturedHandler = handler;
      return Promise.resolve({ remove: () => Promise.resolve() });
    });

    issueAssistantBridgeGrant();
    tryCompanionBrainMock.mockResolvedValue({ kind: 'chat', response: 'Üretim zinciri cevabı.', route: 'companion_gemini' });
    const dispose = startPhoneLinkProductBoot();
    try {
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(capturedHandler).not.toBeNull();

      const payload = JSON.stringify({
        v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'boot-assist-1', type: 'ASSISTANT_BRIDGE_REQUEST', text: 'merhaba mavi',
      });
      capturedHandler!({ fingerprint: 'fp-A', sessionEpoch: 7, payload });
      await vi.waitFor(() => {
        if (phoneHubMocks.sendApplicationMessage.mock.calls.length < 2) {
          throw new Error('henüz iki mesaj da gönderilmedi (RECEIVED + terminal)');
        }
      }, { timeout: 2000, interval: 5 });

      expect(phoneHubMocks.sendApplicationMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.stringContaining('"id":"boot-assist-1"') }),
      );
      expect(phoneHubMocks.sendApplicationMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.stringContaining('Üretim zinciri cevabı.') }),
      );
    } finally {
      dispose();
      _resetPhoneLinkProductBootForTest();
    }
  });

  it('31. Mavi\'nin kanonik router\'ı bypass edilmez — yapısal: ikinci provider seçimi/gateway YOK, tryCompanionBrain/tryOfflineConversation dışında AI çağrısı yok', () => {
    const code = codeOnly('phoneLink/phoneLinkAssistantBridgeAdapter.ts');
    expect(code).not.toMatch(/fetch\(|createAiGateway|new.*Provider\(/);
    expect(code).toMatch(/tryCompanionBrain/);
    expect(code).toMatch(/tryOfflineConversation/);
  });

  it('32. Music/navigation authority etkilenmez — yapısal: adaptör mediaCommandGateway/destinationHandoff import ETMEZ', () => {
    const code = codeOnly('phoneLink/phoneLinkAssistantBridgeAdapter.ts');
    expect(code).not.toMatch(/mediaCommandGateway|destinationHandoff/);
  });
});
