/**
 * phoneLinkInternetF5.test.ts — PHONE LINK F5 · INTERNET GATEWAY kapilari.
 *
 * F5.18 numaralari test adlarindadir.
 *
 *   Authority    1-5   · INTERNET_SHARE != identity/PRIMARY, session-bound
 *   Network      6-12  · validated / captive portal / metered dogruluk
 *   Lifecycle    13-16 · disconnect, cleanup, reconnect, OS agina dokunmama
 *   Isolation    17-20 · capability capraz gecis yok, RFCOMM tunnel yok
 *   Performance  21-25 · polling/timer/ping/speedtest/idle yok
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
vi.mock('../platform/media/authority/musicCanonicalSnapshot', () => ({
  getMusicCanonicalSnapshot: () => ({
    authorityAvailable: true, activeSource: 'LOCAL', focusState: 'GAIN',
    audioRoute: 'SPEAKER', playing: false, queueEntryIds: [], currentIndex: null,
  }),
  subscribeMusicCanonicalSnapshot: () => () => {},
}));
vi.mock('../platform/media/musicIndex', () => ({
  getMusicLibrarySnapshot: () => ({
    revision: 0, tracks: [], albums: [], artists: [], folders: [], availability: 'READY',
  }),
}));

import {
  derivePhoneInternetEvidence, deriveInternetSource, deriveInternetQuality,
  isBulkTransferCostSafe, isPhoneInternetUsable, NO_NETWORK_FACTS,
  type PhoneNetworkFacts,
} from '../platform/phoneLink/phoneLinkInternetPolicy';
import {
  ingestNetworkFacts, getPhoneInternetEvidence, getPhoneInternetTelemetry,
  parseNetworkFacts, subscribePhoneInternet,
  _resetPhoneInternetGatewayForTest,
} from '../platform/phoneLink/phoneLinkInternetGateway';
import {
  issuePhoneInternetGrant, issueGuestMediaGrant, getActiveGrantFor,
  getActiveGuestGrant, authorizePhoneInternetShare, authorizeGuestMediaCommand,
  revokeGuestGrantsFor, _resetPhoneLinkGrantsForTest,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';
import { derivePhoneLinkRole } from '../platform/phoneLink/phoneLinkRole';
import { dispatchGuestMusicCommand } from '../platform/phoneLink/phoneLinkMusicRemoteAdapter';
import { _resetPhoneLinkSessionRegistryForTest } from '../platform/phoneLink/phoneLinkSessionRegistry';
import { CAPABILITY_STATUS } from '../platform/security/enforcement';

/**
 * Kaynagi YORUMLARDAN arindirir.
 *
 * Bu dosyadaki yasak-desen kapilari KODU denetler, ACIKLAMAYI degil. Yorumda
 * "burada proxy YOKTUR" yazmasi ihlal degildir; asil risk kodun kendisidir.
 * Yorumlari ayiklamak ayni zamanda kapiyi GUCLENDIRIR: bir yorum satiri
 * yaziliyor diye guard yanlis yere dusmez, gercek cagri ise yakalanir.
 */
function codeOf(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function phoneLinkCode(file: string): string {
  return codeOf(resolve(__dirname, '../platform/phoneLink/', file));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardimcilar
 * ════════════════════════════════════════════════════════════════════════ */

const FP = 'fp-alpha';
const EPOCH = 11;

function snap(overrides: Record<string, unknown> = {}) {
  return {
    state: 'ACTIVE', role: 'GUEST', roleReason: 'no_driver_authentication',
    deviceTrust: 'TRUSTED', sessionEpoch: EPOCH, deviceFingerprint: FP,
    ...overrides,
  };
}
function detached() {
  return {
    state: 'DETACHED', role: 'GUEST', roleReason: 'link_not_active',
    deviceTrust: 'UNKNOWN', sessionEpoch: null, deviceFingerprint: null,
  };
}

function facts(overrides: Partial<PhoneNetworkFacts> = {}): PhoneNetworkFacts {
  return {
    present: true, transport: 'WIFI', hasInternetCapability: true,
    validated: true, captivePortal: false, metered: true,
    downstreamKbps: 8_000, upstreamKbps: 2_000,
    ...overrides,
  };
}

/** Yetkili + dogrulanmis aga sahip kurulum. */
function bringUp(factOverrides: Partial<PhoneNetworkFacts> = {}) {
  mockSnapshot.mockReturnValue(snap());
  issuePhoneInternetGrant();
  ingestNetworkFacts(facts(factOverrides));
}

beforeEach(() => {
  _resetPhoneInternetGatewayForTest();
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkSessionRegistryForTest();
  mockSnapshot.mockReset().mockReturnValue(detached());
  mediaMocks.play.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
  mediaMocks.next.mockReset().mockResolvedValue({ outcome: 'VERIFIED' });
});

/* ══════════════════════════════════════════════════════════════════════════
 * AUTHORITY (1-5)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.15 Authority', () => {
  it('1. INTERNET_SHARE kimlik URETMEZ — ag baglantisi trust kanıtı degildir', () => {
    bringUp();
    const evidence = getPhoneInternetEvidence();
    expect(evidence.state).toBe('CONNECTED');
    /* Dogrulanmis internet varken bile rol GUEST kalir. */
    expect(derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP, nowMs: 1_000,
    }).role).toBe('GUEST');
  });

  it('2. hotspot/ag baglantisi PRIMARY URETMEZ', () => {
    bringUp({ transport: 'WIFI', validated: true });
    const role = derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP, nowMs: 1_000,
    });
    expect(role.role).toBe('GUEST');
    expect(role.reason).toBe('no_driver_authentication');
    /* Politika katmani rol/kimlik alanı URETMEZ. */
    expect(Object.keys(getPhoneInternetEvidence())).not.toContain('role');
  });

  it('3. grant session-bound — TRUSTED olmayan cihaza verilmez', () => {
    for (const trust of ['UNKNOWN', 'PAIRED_ONLY', 'VERIFIED']) {
      _resetPhoneLinkGrantsForTest();
      mockSnapshot.mockReturnValue(snap({ deviceTrust: trust }));
      expect(issuePhoneInternetGrant(), trust).toBeNull();
    }
    /* Alan hic yoksa da fail-closed. */
    _resetPhoneLinkGrantsForTest();
    mockSnapshot.mockReturnValue({
      state: 'ACTIVE', role: 'GUEST', sessionEpoch: EPOCH, deviceFingerprint: FP,
    });
    expect(issuePhoneInternetGrant()).toBeNull();
  });

  it('4. stale epoch internet capability KULLANAMAZ', () => {
    bringUp();
    expect(getPhoneInternetEvidence().policyAllowed).toBe(true);
    mockSnapshot.mockReturnValue(snap({ sessionEpoch: 99 }));
    const evidence = getPhoneInternetEvidence();
    expect(evidence.policyAllowed).toBe(false);
    expect(evidence.state).toBe('UNAVAILABLE');
    expect(evidence.reason).toBe('no_grant');
  });

  it('5. wrong fingerprint KULLANAMAZ', () => {
    bringUp();
    mockSnapshot.mockReturnValue(snap({ deviceFingerprint: 'fp-other' }));
    expect(getPhoneInternetEvidence().policyAllowed).toBe(false);
    /* Capraz cift de reddedilir. */
    expect(getActiveGrantFor('INTERNET_SHARE', Date.now(),
      { deviceFingerprint: 'fp-other', sessionEpoch: EPOCH })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * NETWORK (6-12)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.5/F5.12 Network', () => {
  it('6. network available event dogru duruma gider', () => {
    mockSnapshot.mockReturnValue(snap());
    issuePhoneInternetGrant();
    /* Once ag yok. */
    ingestNetworkFacts({ present: false });
    expect(getPhoneInternetEvidence().state).toBe('AVAILABLE');
    expect(getPhoneInternetEvidence().reason).toBe('no_network_path');
    /* Sonra ag geldi ve dogrulandi. */
    ingestNetworkFacts(facts());
    expect(getPhoneInternetEvidence().state).toBe('CONNECTED');
  });

  it('7. validated capability CONNECTED uretir', () => {
    bringUp({ validated: true, captivePortal: false });
    const evidence = getPhoneInternetEvidence();
    expect(evidence.state).toBe('CONNECTED');
    expect(evidence.reason).toBe('validated');
    expect(isPhoneInternetUsable(evidence)).toBe(true);
  });

  it('8. Wi-Fi bagli ama validated DEGIL → CONNECTED iddiasi YOK', () => {
    bringUp({ validated: false });
    const evidence = getPhoneInternetEvidence();
    expect(evidence.state).toBe('DEGRADED');
    expect(evidence.reason).toBe('not_validated');
    expect(isPhoneInternetUsable(evidence)).toBe(false);

    /* validated BILINMIYOR ise de CONNECTED denmez. */
    ingestNetworkFacts(facts({ validated: null }));
    const unknown = getPhoneInternetEvidence();
    expect(unknown.state).toBe('CONNECTING');
    expect(unknown.reason).toBe('validation_unknown');
    expect(isPhoneInternetUsable(unknown)).toBe(false);
  });

  it('9. captive portal → internet available iddiasi YOK', () => {
    bringUp({ captivePortal: true, validated: true });
    const evidence = getPhoneInternetEvidence();
    /* Captive portal validated'i EZER — giris sayfasi internet degildir. */
    expect(evidence.state).toBe('DEGRADED');
    expect(evidence.reason).toBe('captive_portal');
    expect(isPhoneInternetUsable(evidence)).toBe(false);
  });

  it('10. network lost → durum duser', () => {
    bringUp();
    expect(getPhoneInternetEvidence().state).toBe('CONNECTED');
    ingestNetworkFacts({ present: false });
    const evidence = getPhoneInternetEvidence();
    expect(evidence.state).toBe('AVAILABLE');
    expect(evidence.metered).toBeNull();
    expect(evidence.quality).toBe('UNKNOWN');
  });

  it('11. metered dogru tasinir', () => {
    bringUp({ metered: true });
    expect(getPhoneInternetEvidence().metered).toBe(true);
    ingestNetworkFacts(facts({ metered: false }));
    expect(getPhoneInternetEvidence().metered).toBe(false);
  });

  it('12. UNKNOWN metered UCRETSIZ SAYILMAZ', () => {
    bringUp({ metered: null });
    const evidence = getPhoneInternetEvidence();
    expect(evidence.metered).toBeNull();
    expect(isBulkTransferCostSafe(evidence.metered)).toBe(false);
    expect(isBulkTransferCostSafe(true)).toBe(false);
    expect(isBulkTransferCostSafe(false)).toBe(true);
    /* Bozuk native yuku de UNKNOWN olur — `false` VARSAYILMAZ. */
    expect(parseNetworkFacts({ present: true, metered: 'evet' }).metered).toBeNull();
    expect(parseNetworkFacts({ present: true, validated: 1 }).validated).toBeNull();
  });

  it('12b. Wi-Fi kaynagi PHONE_HOTSPOT diye ETIKETLENMEZ (F5.6)', () => {
    bringUp({ transport: 'WIFI' });
    expect(getPhoneInternetEvidence().source).toBe('SYSTEM_WIFI');
    expect(deriveInternetSource(facts({ transport: 'USB' }))).toBe('USB_TETHER');
    expect(deriveInternetSource(facts({ transport: 'BLUETOOTH' }))).toBe('BLUETOOTH_PAN');
    expect(deriveInternetSource(facts({ transport: 'ETHERNET' }))).toBe('ETHERNET');
    expect(deriveInternetSource(NO_NETWORK_FACTS)).toBe('UNKNOWN');
    /* PHONE_HOTSPOT kaniti olmadigi icin hicbir girdiden URETILEMEZ. */
    const transports: Array<PhoneNetworkFacts['transport']> =
      ['WIFI', 'ETHERNET', 'CELLULAR', 'BLUETOOTH', 'USB', 'VPN', 'UNKNOWN'];
    for (const t of transports) {
      expect(deriveInternetSource(facts({ transport: t })), t).not.toBe('PHONE_HOTSPOT');
    }
  });

  it('12c. kalite yalniz GERCEK tahminden gelir, olculmediyse UNKNOWN', () => {
    expect(deriveInternetQuality(facts({ downstreamKbps: -1 }))).toBe('UNKNOWN');
    expect(deriveInternetQuality(facts({ downstreamKbps: 0 }))).toBe('UNKNOWN');
    expect(deriveInternetQuality(facts({ downstreamKbps: 500 }))).toBe('POOR');
    expect(deriveInternetQuality(facts({ downstreamKbps: 3_000 }))).toBe('USABLE');
    expect(deriveInternetQuality(facts({ downstreamKbps: 50_000 }))).toBe('GOOD');
    expect(deriveInternetQuality(NO_NETWORK_FACTS)).toBe('UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE (13-16)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.10 Lifecycle', () => {
  it('13. Phone Link disconnect → grant gecersiz', () => {
    bringUp();
    expect(getPhoneInternetEvidence().policyAllowed).toBe(true);
    mockSnapshot.mockReturnValue(detached());
    const evidence = getPhoneInternetEvidence();
    expect(evidence.policyAllowed).toBe(false);
    expect(evidence.state).toBe('UNAVAILABLE');
  });

  it('13b. F4 iptal zinciri INTERNET_SHARE grant-ini da dusurur', () => {
    mockSnapshot.mockReturnValue(snap());
    issueGuestMediaGrant();
    issuePhoneInternetGrant();
    expect(getActiveGrantFor('INTERNET_SHARE')).not.toBeNull();
    /* Zincirin kullandigi oturum-bazli iptal, YETENEKTEN BAGIMSIZ calisir. */
    const removed = revokeGuestGrantsFor(FP, EPOCH);
    expect(removed).toBe(2);
    expect(getActiveGrantFor('INTERNET_SHARE')).toBeNull();
    expect(getActiveGuestGrant()).toBeNull();
  });

  it('14. network callback cleanup deterministik — abone sokulunce cagrilmaz', () => {
    const seen: string[] = [];
    const off = subscribePhoneInternet((e) => { seen.push(e.state); });
    bringUp();
    expect(seen.length).toBeGreaterThan(0);
    const count = seen.length;
    off();
    ingestNetworkFacts({ present: false });
    expect(seen.length).toBe(count);

    /* Patlayan abone digerlerini BOZMAZ. */
    const ok: string[] = [];
    subscribePhoneInternet(() => { throw new Error('abone patladi'); });
    subscribePhoneInternet((e) => { ok.push(e.state); });
    ingestNetworkFacts(facts());
    expect(ok).toHaveLength(1);
  });

  it('15. reconnect ESKI grant-i DIRILTMEZ', () => {
    bringUp();
    mockSnapshot.mockReturnValue(detached());
    expect(getPhoneInternetEvidence().policyAllowed).toBe(false);
    /* Ayni cihaz YENI nesille dondu: eski grant gecerli olmamali. */
    mockSnapshot.mockReturnValue(snap({ sessionEpoch: EPOCH + 1 }));
    expect(getActiveGrantFor('INTERNET_SHARE', Date.now(),
      { deviceFingerprint: FP, sessionEpoch: EPOCH + 1 })).toBeNull();
    expect(getPhoneInternetEvidence().policyAllowed).toBe(false);
  });

  it('16. ilgisiz sistem agi YANLISLIKLA kapatilmaz (F5.7/F5.10)', () => {
    for (const file of ['phoneLinkInternetGateway.ts', 'phoneLinkInternetPolicy.ts']) {
      const src = phoneLinkCode(file);
      /* Ag secme/degistirme/kapatma yolu HIC YOK. */
      expect(src, file).not.toMatch(/bindProcessToNetwork|setNetworkPreference|setProcessDefaultNetwork/);
      expect(src, file).not.toMatch(/setWifiEnabled|disconnect\(\)|removeNetwork|disableNetwork/);
    }
    const java = codeOf(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneInternetObserverPlugin.java'));
    expect(java).not.toMatch(/bindProcessToNetwork|setWifiEnabled|WifiManager|startTethering|requestNetwork\(/);
    /* YALNIZ gozlem: kayit + sokme. */
    expect(java).toMatch(/registerNetworkCallback/);
    expect(java).toMatch(/unregisterNetworkCallback/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ISOLATION (17-20)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.15 Isolation', () => {
  it('17. MEDIA_CONTROL grant INTERNET_SHARE ACMAZ', () => {
    mockSnapshot.mockReturnValue(snap());
    issueGuestMediaGrant();                       // yalniz medya
    expect(getActiveGuestGrant()).not.toBeNull();
    expect(getActiveGrantFor('INTERNET_SHARE')).toBeNull();
    expect(authorizePhoneInternetShare('op-1').decision).not.toBe('ALLOW');
    expect(getPhoneInternetEvidence().policyAllowed).toBe(false);
  });

  it('18. INTERNET_SHARE grant MEDIA_CONTROL ACMAZ', async () => {
    mockSnapshot.mockReturnValue(snap());
    issuePhoneInternetGrant();                    // yalniz internet
    expect(getActiveGrantFor('INTERNET_SHARE')).not.toBeNull();
    expect(getActiveGuestGrant()).toBeNull();
    expect(authorizeGuestMediaCommand('op-2').decision).not.toBe('ALLOW');

    const result = await dispatchGuestMusicCommand('PLAY');
    expect(result.ok).toBe(false);
    expect(mediaMocks.play).not.toHaveBeenCalled();
  });

  it('19. Arabam Cebimde bagimliligi YOK', () => {
    for (const file of ['phoneLinkInternetGateway.ts', 'phoneLinkInternetPolicy.ts']) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/arabam|Arabam|cebimde|Cebimde/);
    }
  });

  it('20. RFCOMM uzerinden internet TUNNEL EDILMEZ (F5.9)', () => {
    for (const file of ['phoneLinkInternetGateway.ts', 'phoneLinkInternetPolicy.ts']) {
      const src = phoneLinkCode(file);
      /* Kontrol duzlemine veri yuku GONDERILMEZ. */
      expect(src, file).not.toMatch(/sendApplicationMessage|PhoneHubLink\./);
      /* Veri duzlemi kodu YOK. */
      expect(src, file).not.toMatch(/VpnService|SOCKS|createServer|ServerSocket|net\.Socket/);
      expect(src, file).not.toMatch(/proxy|Proxy/);
    }
    const java = codeOf(resolve(
      __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneInternetObserverPlugin.java'));
    expect(java).not.toMatch(/VpnService|Socket|ProxyInfo|DatagramPacket|InetAddress/);
  });

  it('20b. INTERNET_SHARE kanonik yetki tablosunda tanimli ve gated', () => {
    expect(CAPABILITY_STATUS.INTERNET_SHARE).toBe('SUPPORTED_GATED');
    /* Karar motoru TEK: politika kanonik tabloda, gateway-de degil. */
    const gateway = phoneLinkCode('phoneLinkInternetGateway.ts');
    expect(gateway).not.toMatch(/decision\s*=\s*'ALLOW'/);
    expect(gateway).toMatch(/authorizePhoneInternetShare/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PERFORMANCE (21-25)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.16 Performans', () => {
  const TS_FILES = ['phoneLinkInternetGateway.ts', 'phoneLinkInternetPolicy.ts'];
  const JAVA = resolve(
    __dirname, '../../android/app/src/main/java/com/cockpitos/pro/phonelink/PhoneInternetObserverPlugin.java');

  it('21. polling YOK', () => {
    for (const file of TS_FILES) {
      expect(phoneLinkCode(file), file).not.toMatch(/setInterval\(/);
    }
    expect(codeOf(JAVA)).not.toMatch(/ScheduledExecutorService|postDelayed|new Timer\(/);
  });

  it('22. yeni recurring timer YOK', () => {
    for (const file of TS_FILES) {
      expect(phoneLinkCode(file), file).not.toMatch(/setTimeout\(/);
    }
  });

  it('23. ping loop YOK', () => {
    for (const file of TS_FILES) {
      expect(phoneLinkCode(file), file).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.onLine/);
    }
    expect(codeOf(JAVA)).not.toMatch(/HttpURLConnection|isReachable|InetAddress/);
  });

  it('24. speed test YOK', () => {
    for (const file of TS_FILES) {
      expect(phoneLinkCode(file), file).not.toMatch(/speedTest|speedtest|downloadTest|performance\.now/);
    }
    /* Kalite YALNIZ OS tahmininden turetilir. */
    expect(phoneLinkCode('phoneLinkInternetPolicy.ts')).toMatch(/downstreamKbps/);
  });

  it('25. telefon yokken durum UNAVAILABLE ve idle is YOK', () => {
    /* Hicbir kurulum yapilmadi: grant yok, ag yok. */
    const evidence = getPhoneInternetEvidence();
    expect(evidence.state).toBe('UNAVAILABLE');
    expect(evidence.policyAllowed).toBe(false);
    expect(evidence.source).toBe('UNKNOWN');
    expect(evidence.metered).toBeNull();

    const telemetry = getPhoneInternetTelemetry();
    expect(telemetry.observing).toBe(false);
    expect(telemetry.validated).toBeNull();

    /* Saf turetim: ayni girdi her cagrida ayni sonucu verir, yan etki yok. */
    const a = derivePhoneInternetEvidence({ policyAllowed: false, facts: NO_NETWORK_FACTS });
    const b = derivePhoneInternetEvidence({ policyAllowed: false, facts: NO_NETWORK_FACTS });
    expect(a).toEqual(b);
  });

  it('25b. LAB telemetrisi SSID/parola/IP/credential TASIMAZ', () => {
    bringUp();
    const telemetry = JSON.stringify(getPhoneInternetTelemetry());
    for (const secret of ['ssid', 'SSID', 'password', 'bssid', 'ipAddress', 'credential', FP]) {
      expect(telemetry, secret).not.toContain(secret);
    }
    /* Native zaten bunlarin hicbirini gondermiyor ve log cagirmiyor. */
    expect(codeOf(JAVA)).not.toMatch(/getSSID|getBSSID|getConnectionInfo|Log\.[dviwe]\(/);
  });
});
