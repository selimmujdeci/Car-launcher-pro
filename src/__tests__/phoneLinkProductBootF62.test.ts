/**
 * phoneLinkProductBootF62.test.ts — PHONE LINK F6.2 · PRODUCT BOOT + F5 WIRING.
 *
 * F6.2 madde 22 (test gates) + madde 20/21 (security/performance) numaralari
 * test adlarindadir.
 *
 *   Boot          1-4    · urun acilisi, LAB bagimsizligi, idempotentlik
 *   Bluetooth     5-10   · radyo ACILMAZ, dormant, izin/pairing korunur
 *   Ordering      11-14  · listener > server, ilk olay kaybolmaz
 *   Replay        15-18  · native -> JS snapshot replay guvenligi
 *   F5            19-25  · gateway wiring + fail-closed korunmus
 *   F6            26-29  · ownership regresyonu
 *   Performance   30-32  · polling/timer/observer yok
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Kanonik native koprunun TS yuzeyi taklit edilir ────────────────────── */
const nativeMocks = vi.hoisted(() => ({
  startServer: vi.fn(),
  stopServer: vi.fn(),
  getSnapshot: vi.fn(),
  addListener: vi.fn(),
}));

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
  evaluateTransportReadiness, replayCurrentLinkState,
  startPhoneLinkProductBoot, getPhoneLinkProductBootTelemetry,
  evaluatePhoneLinkTransportReadiness,
  _resetPhoneLinkProductBootForTest,
} from '../platform/phoneLink/phoneLinkProductBoot';
import {
  ingestPhoneHubLinkStateEvent, getPhoneHubLinkState,
  _resetPhoneHubLinkStateForTest,
  type PhoneHubLinkSnapshotRaw,
} from '../platform/phoneHub/phoneHubLink';
import {
  activeRuntimeSessionCount, isSessionLive,
  _resetPhoneLinkSessionRegistryForTest,
} from '../platform/phoneLink/phoneLinkSessionRegistry';
import {
  applyPhoneLinkRevocationCascade, _resetPhoneLinkLifecycleForTest,
} from '../platform/phoneLink/phoneLinkLifecycle';
import {
  issuePhoneInternetGrant, getActiveGrantFor, _resetPhoneLinkGrantsForTest,
} from '../platform/phoneLink/phoneLinkCapabilityGrant';
import { _resetPhoneLinkGuestSessionsForTest } from '../platform/phoneLink/phoneLinkGuestSession';
import {
  getPhoneInternetEvidence, ingestNetworkFacts, getPhoneInternetTelemetry,
  _resetPhoneInternetGatewayForTest,
} from '../platform/phoneLink/phoneLinkInternetGateway';
import {
  getPhoneIntegrationPolicy, getDomainOwnership,
  _resetPhoneIntegrationOwnershipForTest,
} from '../platform/phoneLink/phoneIntegrationOwnership';
import { derivePhoneLinkRole } from '../platform/phoneLink/phoneLinkRole';
import { useStore } from '../store/useStore';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardimcilar
 * ════════════════════════════════════════════════════════════════════════ */

function codeOf(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}
function phoneLinkCode(file: string): string {
  return codeOf(resolve(__dirname, '../platform/phoneLink/', file));
}

/**
 * Mikro-gorev kuyrugunu bosaltir. F6.2'de iptal zinciri F5 gateway ve F6
 * ownership serbest birakicilarini da cagirdigi icin zincir F4'e gore DAHA
 * DERINDIR; sabit iki tick YETMEZ. Timer KULLANILMAZ — yalniz `Promise`
 * mikro-gorevleri (deterministik).
 */
async function flushAsync(ticks = 12): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

const FP = 'fp-alpha';
const EPOCH = 11;

/** Native anlik goruntusu — gercek `PhoneHubLinkSnapshotRaw` sekliyle. */
function snapshot(overrides: Partial<PhoneHubLinkSnapshotRaw> = {}): PhoneHubLinkSnapshotRaw {
  return {
    present: true,
    server: { state: 'STOPPED', running: false },
    preconditions: { ready: true, blockerCode: null, connectPermission: true },
    ...overrides,
  } as PhoneHubLinkSnapshotRaw;
}

/** Kurulu (ESTABLISHED) bir oturum tasiyan anlik goruntu. */
function establishedSnapshot(
  epoch = EPOCH, fingerprint: string | null = FP,
): PhoneHubLinkSnapshotRaw {
  return snapshot({
    server: { state: 'LISTENING', running: true, hasActiveSocket: true },
    session: {
      generation: epoch, state: 'CONNECTED', trulyEstablished: true,
      disposed: false, peerFingerprint: fingerprint, encryptionActive: true,
      awaitingUserConfirm: false,
    },
    trust: { hasTrustedPeer: true, peerFingerprint: fingerprint },
  } as Partial<PhoneHubLinkSnapshotRaw>);
}

beforeEach(() => {
  _resetPhoneLinkProductBootForTest();
  _resetPhoneHubLinkStateForTest();
  _resetPhoneLinkLifecycleForTest();
  _resetPhoneLinkSessionRegistryForTest();
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkGuestSessionsForTest();
  _resetPhoneInternetGatewayForTest();
  _resetPhoneIntegrationOwnershipForTest();
  useStore.getState().updateSettings({ carosConnectionPriorityEnabled: false });
  nativeMocks.startServer.mockReset().mockResolvedValue({ started: true });
  nativeMocks.stopServer.mockReset().mockResolvedValue({ stopped: true });
});

afterEach(() => {
  _resetPhoneLinkProductBootForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * BOOT (1-4)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.2 Product boot', () => {
  it('1. normal boot → Phone Link lifecycle initialized', () => {
    const dispose = startPhoneLinkProductBoot();
    const t = getPhoneLinkProductBootTelemetry();
    expect(t.listenersAttached).toBe(true);
    expect(t.gatewayLifecycleRegistered).toBe(true);
    expect(t.ownershipLifecycleRegistered).toBe(true);
    expect(t.state).not.toBe('NOT_STARTED');
    dispose();
  });

  it('2. LAB HIC acilmadan initialization gerceklesir — LAB production authority DEGIL', () => {
    /* Urun acilisi LAB ekranina hic referans VERMEZ. */
    const bootSrc = phoneLinkCode('phoneLinkProductBoot.ts');
    expect(bootSrc).not.toMatch(/PhoneHubLinkScreen|devtools|carosLab/i);

    /* Kanonik boot sahibi SystemBoot'tur, LAB komponenti DEGIL. */
    const systemBootSrc = codeOf(resolve(__dirname, '../platform/system/SystemBoot.ts'));
    expect(systemBootSrc).toMatch(/startPhoneLinkProductBoot\(\)/);

    const dispose = startPhoneLinkProductBoot();
    expect(getPhoneLinkProductBootTelemetry().listenersAttached).toBe(true);
    dispose();
  });

  it('2b. SystemBoot Phone Link grafigini DINAMIK import eder (statik import REGRESYONU)', () => {
    /*
     * KANIT: statik `import { startPhoneLinkProductBoot } from ...` eklendiginde
     * Phone Link modul grafigi (`registerPlugin` cagrilari dahil) SystemBoot'u
     * ice aktaran HER tuketiciye tasindi ve `@capacitor/core` KISMI mock
     * kullanan ~14 mevcut test dosyasi import asamasinda coktu
     * ("No registerPlugin export is defined on the @capacitor/core mock").
     * Bu kapi o regresyonun geri gelmesini engeller.
     */
    const systemBootSrc = codeOf(resolve(__dirname, '../platform/system/SystemBoot.ts'));
    expect(systemBootSrc).toMatch(/await import\('\.\.\/phoneLink\/phoneLinkProductBoot'\)/);
    /* Statik import OLMAMALI. */
    expect(systemBootSrc).not.toMatch(/^import .*phoneLinkProductBoot/m);
  });

  it('3. initialization IDEMPOTENT — ikinci cagri coklama URETMEZ', () => {
    const d1 = startPhoneLinkProductBoot();
    const d2 = startPhoneLinkProductBoot();
    const t = getPhoneLinkProductBootTelemetry();
    expect(t.listenersAttached).toBe(true);
    /* Ikinci cagri onceki kayitlari SOKER; durum tek ve tutarlidir. */
    expect(t.gatewayLifecycleRegistered).toBe(true);
    d2();
    expect(getPhoneLinkProductBootTelemetry().listenersAttached).toBe(false);
    d1();   // cift sokme guvenli (idempotent)
    expect(getPhoneLinkProductBootTelemetry().state).toBe('NOT_STARTED');
  });

  it('4. Activity recreation duplicate controller/server URETMEZ', () => {
    /* Sunucu ZATEN dinliyorsa karar "baslatma" DEGILDIR. */
    const decision = evaluateTransportReadiness(establishedSnapshot());
    expect(decision.shouldStartServer).toBe(false);
    expect(decision.state).toBe('READY');
    expect(decision.reason).toBe('server_already_listening');

    /* Art arda iki boot yalnizca TEK aktif kayit birakir. */
    const d1 = startPhoneLinkProductBoot();
    const d2 = startPhoneLinkProductBoot();
    d1();
    d2();
    expect(getPhoneLinkProductBootTelemetry().state).toBe('NOT_STARTED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BLUETOOTH / USER INTENT (5-10)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.2 Bluetooth ve kullanici iradesi', () => {
  it('5. BT OFF boot → radyo enable cagrisi YOK (kaynak kilidi)', () => {
    const bootSrc = phoneLinkCode('phoneLinkProductBoot.ts');
    expect(bootSrc).not.toMatch(/BluetoothAdapter|WifiManager|setBluetooth|setWifi\(/);
    expect(bootSrc).not.toMatch(/setWifiEnabled|startTethering|ACTION_REQUEST_ENABLE/);
    /* Izin diyalogu da ACTIRILMAZ. */
    expect(bootSrc).not.toMatch(/requestPermission|requestPermissionForAlias/);
  });

  it('6. BT OFF → server activation BLOCKED/DORMANT', () => {
    const decision = evaluateTransportReadiness(snapshot({
      preconditions: { ready: false, blockerCode: 'BLUETOOTH_DISABLED', connectPermission: true },
    }));
    expect(decision.shouldStartServer).toBe(false);
    expect(decision.state).toBe('WAITING_FOR_USER_CONNECTIVITY');
    expect(decision.reason).toBe('bluetooth_disabled');
  });

  it('6b. izin verilmemisse de DORMANT — acilista diyalog ACILMAZ', () => {
    for (const code of ['BLUETOOTH_PERMISSION_REQUIRED', 'BLUETOOTH_PERMISSION_DENIED']) {
      const d = evaluateTransportReadiness(snapshot({
        preconditions: { ready: false, blockerCode: code, connectPermission: false },
      }));
      expect(d.shouldStartServer, code).toBe(false);
      expect(d.state, code).toBe('WAITING_FOR_USER_CONNECTIVITY');
    }
    /* Engel yok ama izin OLCULMEMIS → yine baslatilmaz (fail-closed). */
    const unknownPerm = evaluateTransportReadiness(snapshot({
      preconditions: { ready: true, blockerCode: null },
    }));
    expect(unknownPerm.shouldStartServer).toBe(false);
    expect(unknownPerm.reason).toBe('bluetooth_permission_withheld');
  });

  it('7. kullanici sonradan BT acinca → OLAY tabanli yeniden degerlendirme (polling YOK)', () => {
    const bootSrc = phoneLinkCode('phoneLinkProductBoot.ts');
    /* Tek tetikleyici Capacitor appStateChange olayidir. */
    expect(bootSrc).toMatch(/appStateChange/);
    expect(bootSrc).not.toMatch(/setInterval\(|setTimeout\(/);
    /* Bluetooth durumu YOKLANMAZ. */
    expect(bootSrc).not.toMatch(/isEnabled\(\)|pollBluetooth|checkBluetoothLoop/);
  });

  it('8. BT ON boot → server product readiness (LAB gerekmez)', () => {
    const decision = evaluateTransportReadiness(snapshot());
    expect(decision.shouldStartServer).toBe(true);
    expect(decision.state).toBe('READY');
  });

  it('8b. native kopru yokken SAHTE hazirlik IDDIA EDILMEZ (fail-closed)', async () => {
    /* Tarayici/test ortaminda `PhoneHubLink` plugin'i yoktur: kanonik
       `refreshPhoneHubLink()` `present:false` dondurur. Bu durumda sunucu
       BASLATILMAZ ve "READY" IDDIASI YAPILMAZ. */
    const decision = await evaluatePhoneLinkTransportReadiness();
    expect(decision.shouldStartServer).toBe(false);
    expect(decision.reason).toBe('native_bridge_absent');
    expect(getPhoneLinkProductBootTelemetry().state).toBe('INITIALIZED');
    expect(getPhoneLinkProductBootTelemetry().readinessEvaluations).toBeGreaterThan(0);
  });

  it('9. donanim yoksa TRANSPORT_UNAVAILABLE — "kullanici kapatti" denmez', () => {
    const d = evaluateTransportReadiness(snapshot({
      preconditions: { ready: false, blockerCode: 'BLUETOOTH_UNAVAILABLE', connectPermission: true },
    }));
    expect(d.state).toBe('TRANSPORT_UNAVAILABLE');
    expect(d.shouldStartServer).toBe(false);
  });

  it('10. pairing guvenligi BYPASS EDILMEZ — boot trust/onay URETMEZ', () => {
    const bootSrc = phoneLinkCode('phoneLinkProductBoot.ts');
    expect(bootSrc).not.toMatch(/confirmPairing|trustPeer|forgetTrustedPhone|getPairingCode/);
    /* Bekleyen onay varken de sunucu "hazir" diye trust uretmez. */
    const awaiting = evaluateTransportReadiness(snapshot({
      server: { state: 'LISTENING', running: true },
    }));
    expect(awaiting.state).toBe('READY');
    expect(derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP, nowMs: 1_000,
    }).role).toBe('GUEST');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ORDERING (11-14)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.2 Olay sirasi', () => {
  it('11. listener SUNUCU AKTIVASYONUNDAN ONCE hazir', () => {
    const src = phoneLinkCode('phoneLinkProductBoot.ts');
    /* Tanim konumu degil, `startPhoneLinkProductBoot` GOVDESINDEKI cagri
       sirasi olculur — asil garanti budur. */
    const bodyStart = src.indexOf('export function startPhoneLinkProductBoot');
    expect(bodyStart).toBeGreaterThan(-1);
    const body = src.slice(bodyStart);

    const listenerIdx = body.indexOf('initPhoneHubLinkStateBridge()');
    const lifecycleIdx = body.indexOf('initPhoneLinkLifecycle()');
    const readinessIdx = body.indexOf('evaluatePhoneLinkTransportReadiness()');

    expect(listenerIdx).toBeGreaterThan(-1);
    expect(lifecycleIdx).toBeGreaterThan(listenerIdx);
    /* Hazirlik degerlendirmesi (ve sunucu baslatma) EN SONDA. */
    expect(readinessIdx).toBeGreaterThan(lifecycleIdx);
  });

  it('12. ilk ESTABLISHED olayi KAYBOLMAZ', async () => {
    const dispose = startPhoneLinkProductBoot();
    /* Boot sirasinda gelen ilk olay dinleyicilere ULASIR. */
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(isSessionLive(FP, EPOCH)).toBe(true);
    expect(activeRuntimeSessionCount()).toBe(1);
    dispose();
  });

  it('13. duplicate ESTABLISHED idempotent', async () => {
    const dispose = startPhoneLinkProductBoot();
    const first = ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    const second = ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(first).toBe(true);
    expect(second).toBe(false);          // yutma katmani dedupe etti
    expect(activeRuntimeSessionCount()).toBe(1);
    dispose();
  });

  it('14. disconnect cleanup deterministik', async () => {
    const dispose = startPhoneLinkProductBoot();
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(activeRuntimeSessionCount()).toBe(1);

    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'DISCONNECTED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'REMOTE_DISCONNECT',
    });
    await flushAsync();
    expect(activeRuntimeSessionCount()).toBe(0);
    dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * REPLAY (15-18)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.2 Native → JS replay', () => {
  it('15. kurulu native oturum + JS reattach → GUVENLI replay', async () => {
    const dispose = startPhoneLinkProductBoot();
    const outcome = replayCurrentLinkState(establishedSnapshot());
    await flushAsync();
    expect(outcome).toBe('replayed');
    expect(isSessionLive(FP, EPOCH)).toBe(true);
    /* Nesil ve parmak izi NATIVE gercekten gelir — uydurulmaz. */
    expect(getPhoneHubLinkState()?.sessionEpoch).toBe(EPOCH);
    expect(getPhoneHubLinkState()?.deviceFingerprint).toBe(FP);
    dispose();
  });

  it('16. bayat nesil replay REDDEDILIR — yeni oturumu olduremez', async () => {
    const dispose = startPhoneLinkProductBoot();
    /* Once YENI nesil kurulur. */
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: 22,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(isSessionLive(FP, 22)).toBe(true);

    /* Gec gelen ESKI nesilli snapshot replay'i: yeni oturum ETKILENMEZ. */
    replayCurrentLinkState(establishedSnapshot(11, FP));
    await flushAsync();
    expect(isSessionLive(FP, 22)).toBe(true);
    expect(getPhoneHubLinkState()?.sessionEpoch).toBe(22);
    dispose();
  });

  it('17. kopmus/kurulmamis durum ACTIVE URETMEZ (fail-closed)', () => {
    /* trulyEstablished=false → replay YOK. */
    expect(replayCurrentLinkState(snapshot({
      session: { generation: EPOCH, state: 'HANDSHAKING', trulyEstablished: false,
        peerFingerprint: FP } as PhoneHubLinkSnapshotRaw['session'],
    }))).toBe('not_established');
    /* disposed oturum → replay YOK. */
    expect(replayCurrentLinkState(snapshot({
      session: { generation: EPOCH, state: 'CONNECTED', trulyEstablished: true,
        disposed: true, peerFingerprint: FP } as PhoneHubLinkSnapshotRaw['session'],
    }))).toBe('not_established');
    /* parmak izi yoksa → replay YOK (kimliksiz oturum tasinmaz). */
    expect(replayCurrentLinkState(establishedSnapshot(EPOCH, null))).toBe('not_established');
    /* Native kopru yoksa → replay YOK. */
    expect(replayCurrentLinkState({ present: false } as PhoneHubLinkSnapshotRaw))
      .toBe('no_snapshot');
    expect(activeRuntimeSessionCount()).toBe(0);
  });

  it('18. replay yeni identity/trust/grant URETMEZ', async () => {
    const dispose = startPhoneLinkProductBoot();
    replayCurrentLinkState(establishedSnapshot());
    await flushAsync();

    /* Rol hala GUEST — TRUSTED cihaz bile PRIMARY uretmez (F3.0 korunur). */
    expect(derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP, nowMs: 1_000,
    }).role).toBe('GUEST');
    /* Replay hicbir yetenek vermez. */
    expect(getActiveGrantFor('INTERNET_SHARE')).toBeNull();
    expect(getActiveGrantFor('MEDIA_CONTROL')).toBeNull();
    /* Replay kodu yetki/guven uretim yoluna DOKUNMAZ. */
    const src = phoneLinkCode('phoneLinkProductBoot.ts');
    expect(src).not.toMatch(/issueGuestMediaGrant|issuePhoneInternetGrant|trustPeer|authorize\(/);
    dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F5 INTERNET GATEWAY (19-25)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.2 F5 Internet Gateway wiring', () => {
  it('19. Internet Gateway lifecycle PRODUCTION-da kayitli (F6.1 boslugu kapandi)', () => {
    const dispose = startPhoneLinkProductBoot();
    expect(getPhoneLinkProductBootTelemetry().gatewayLifecycleRegistered).toBe(true);
    const bootSrc = phoneLinkCode('phoneLinkProductBoot.ts');
    expect(bootSrc).toMatch(/initPhoneInternetGatewayLifecycle\(\)/);
    dispose();
  });

  it('20. grant YOK → NetworkCallback observer YOK', () => {
    const dispose = startPhoneLinkProductBoot();
    const telemetry = getPhoneInternetTelemetry();
    expect(telemetry.observing).toBe(false);
    expect(telemetry.policyAllowed).toBe(false);
    expect(getPhoneInternetEvidence().state).toBe('UNAVAILABLE');
    dispose();
  });

  it('21. INTERNET_SHARE grant yalniz TRUSTED cihazda verilir (F5 politikasi korunur)', () => {
    /* Anlik goruntu TRUSTED degil → grant YOK → observer uygun degil. */
    expect(issuePhoneInternetGrant()).toBeNull();
    expect(getPhoneInternetEvidence().policyAllowed).toBe(false);
  });

  it('22. disconnect → association cleanup (F4 zinciri gateway-i birakir)', async () => {
    const dispose = startPhoneLinkProductBoot();
    await applyPhoneLinkRevocationCascade(FP, EPOCH, 'REMOTE_DISCONNECT');
    expect(getPhoneInternetTelemetry().observing).toBe(false);
    expect(getPhoneInternetEvidence().state).toBe('UNAVAILABLE');
    dispose();
  });

  it('23. cleanup Android Wi-Fi-yi KAPATMAZ', () => {
    for (const file of ['phoneLinkProductBoot.ts', 'phoneLinkInternetGateway.ts']) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/setWifiEnabled|disableNetwork|removeNetwork|bindProcessToNetwork/);
    }
  });

  it('24. captive portal hala DEGRADED', () => {
    ingestNetworkFacts({
      present: true, transport: 'WIFI', hasInternetCapability: true,
      validated: true, captivePortal: true, metered: true,
      downstreamKbps: 8000, upstreamKbps: 2000,
    });
    /* Politika izin vermese de kaynak/kalite dogru okunur; captive portal
       hicbir kosulda CONNECTED URETMEZ. */
    const evidence = getPhoneInternetEvidence();
    expect(evidence.state).not.toBe('CONNECTED');
  });

  it('25. validated null → CONNECTED DEGILDIR', () => {
    ingestNetworkFacts({
      present: true, transport: 'WIFI', hasInternetCapability: true,
      validated: null, captivePortal: false, metered: null,
      downstreamKbps: -1, upstreamKbps: -1,
    });
    expect(getPhoneInternetEvidence().state).not.toBe('CONNECTED');
    /* UNKNOWN metered UCRETSIZ sayilmaz. */
    expect(getPhoneInternetEvidence().metered).not.toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F6 OWNERSHIP REGRESYONU (26-29)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.2 F6/F6.1 ownership regresyonu', () => {
  it('26. Priority ON + ACTIVE → ownership reconcile (product boot altinda)', async () => {
    const dispose = startPhoneLinkProductBoot();
    useStore.getState().updateSettings({ carosConnectionPriorityEnabled: true });
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
    expect(getDomainOwnership('AUDIO')).toBe('ACTIVE_OWNER');
    dispose();
  });

  it('27. Priority OFF → released', async () => {
    const dispose = startPhoneLinkProductBoot();
    useStore.getState().updateSettings({ carosConnectionPriorityEnabled: true });
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    useStore.getState().updateSettings({ carosConnectionPriorityEnabled: false });
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    dispose();
  });

  it('28. disconnect → released', async () => {
    const dispose = startPhoneLinkProductBoot();
    useStore.getState().updateSettings({ carosConnectionPriorityEnabled: true });
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'DISCONNECTED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'REMOTE_DISCONNECT',
    });
    await flushAsync();
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    dispose();
  });

  it('29. kontrol edilemeyen alanlar UNMANAGED kalir', async () => {
    const dispose = startPhoneLinkProductBoot();
    useStore.getState().updateSettings({ carosConnectionPriorityEnabled: true });
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    for (const domain of ['MICROPHONE', 'PROJECTION', 'USB_PHONE_INTEGRATION'] as const) {
      expect(getDomainOwnership(domain), domain).toBe('UNMANAGED');
    }
    dispose();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PERFORMANS + GUVENLIK (30-32 + madde 20)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.2 Performans ve guvenlik', () => {
  it('30. telefon yokken polling/timer YOK', () => {
    const src = phoneLinkCode('phoneLinkProductBoot.ts');
    expect(src).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame/);
    expect(src).not.toMatch(/getInstalledPackages|getRunningTasks|getRunningAppProcesses/);
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|ping|speedtest/i);

    const dispose = startPhoneLinkProductBoot();
    /* Bos durumda hicbir gozlem/observer acilmaz. */
    expect(getPhoneInternetTelemetry().observing).toBe(false);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    dispose();
  });

  it('31. Priority OFF → gereksiz arbitration YOK', async () => {
    const dispose = startPhoneLinkProductBoot();
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getPhoneIntegrationPolicy().reason).toBe('priority_disabled');
    dispose();
  });

  it('32. gateway grant yok → observer yok (boot sonrasi da)', async () => {
    const dispose = startPhoneLinkProductBoot();
    ingestPhoneHubLinkStateEvent({
      protocolVersion: 1, state: 'ESTABLISHED', sessionEpoch: EPOCH,
      deviceFingerprint: FP, reason: 'UNKNOWN',
    });
    await flushAsync();
    expect(getPhoneInternetTelemetry().observing).toBe(false);
    dispose();
  });

  it('madde 20 — product boot trust/identity/PRIMARY/capability URETMEZ', async () => {
    const dispose = startPhoneLinkProductBoot();
    replayCurrentLinkState(establishedSnapshot());
    await flushAsync();

    expect(derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP, nowMs: 1_000,
    }).role).toBe('GUEST');
    expect(getActiveGrantFor('MEDIA_CONTROL')).toBeNull();
    expect(getActiveGrantFor('INTERNET_SHARE')).toBeNull();

    const src = phoneLinkCode('phoneLinkProductBoot.ts');
    expect(src).not.toMatch(/driverAuthentication|driverPresence|personIdentity|'PRIMARY'/);
    expect(src).not.toMatch(/arabam|cebimde/i);
    /* hidden API / root / accessibility / shell YOK. */
    expect(src).not.toMatch(/Runtime\.getRuntime|exec\(|\bsu\b|Accessibility|setAccessible/i);
    dispose();
  });

  it('madde 21 — kanonik sunucu API-si YENIDEN YAZILMADI (ikinci transport yok)', () => {
    const src = phoneLinkCode('phoneLinkProductBoot.ts');
    /* Kanonik cagri kullanilir. */
    expect(src).toMatch(/startPhoneHubServer\(\)/);
    /* Yeni soket/transport/controller kurulmaz. */
    expect(src).not.toMatch(/ServerSocket|BluetoothServerSocket|createRfcomm|new LinkSession/);
  });
});
