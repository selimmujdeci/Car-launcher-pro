/**
 * phoneLinkConnectionPriorityF6.test.ts — PHONE LINK F6 · USER INTENT + ARBITER.
 *
 * F6.19 numaralari test adlarindadir.
 *
 *   User Intent  1-5   · CarOS kullanicinin kapattigini ACMAZ
 *   Setting      6-11  · default OFF, kanonik persistence, aktivasyon kosulu
 *   Lifecycle    12-15 · disconnect/FAILED/cleanup/idempotent release
 *   Authority    16-19 · priority != trust/identity/PRIMARY/capability
 *   Competitors  20-24 · UNMANAGED durustlugu, sahte SUSPENDED yok
 *   Safety/perf  25-30 · hack yok, polling yok, idle scan yok
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
  deriveConnectivityIntent, deriveBluetoothIntent, deriveWifiIntent, deriveHotspotIntent,
  mayPhoneLinkEnableConnectivity, isPhoneLinkReconnectPermitted,
  UNOBSERVED_PRECONDITIONS,
  type ConnectivityTransport, type ConnectivityUserIntent,
} from '../platform/phoneLink/phoneLinkConnectivityIntent';
import {
  derivePhoneIntegrationPolicy, isDomainControllable, isIntegrationControllable,
  isOwnershipTransition, releasedPolicy, PHONE_INTEGRATION_DOMAINS,
} from '../platform/phoneLink/phoneIntegrationArbiter';
import {
  applyPhoneIntegrationOwnership, releasePhoneIntegrationOwnership,
  getPhoneIntegrationPolicy, getPhoneIntegrationTelemetry, getDomainOwnership,
  initPhoneIntegrationOwnershipLifecycle,
  _resetPhoneIntegrationOwnershipForTest,
} from '../platform/phoneLink/phoneIntegrationOwnership';
import {
  applyPhoneLinkRevocationCascade, _resetPhoneLinkLifecycleForTest,
} from '../platform/phoneLink/phoneLinkLifecycle';
import { _resetPhoneLinkSessionRegistryForTest } from '../platform/phoneLink/phoneLinkSessionRegistry';
import { _resetPhoneLinkGrantsForTest } from '../platform/phoneLink/phoneLinkCapabilityGrant';
import { _resetPhoneLinkGuestSessionsForTest } from '../platform/phoneLink/phoneLinkGuestSession';
import { derivePhoneLinkRole } from '../platform/phoneLink/phoneLinkRole';
import { useStore } from '../store/useStore';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardimcilar
 * ════════════════════════════════════════════════════════════════════════ */

/** Kaynagi YORUMLARDAN arindirir — kapilar KODU denetler, aciklamayi degil. */
function codeOf(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}
function phoneLinkCode(file: string): string {
  return codeOf(resolve(__dirname, '../platform/phoneLink/', file));
}

const F6_TS_FILES = [
  'phoneLinkConnectivityIntent.ts',
  'phoneIntegrationArbiter.ts',
  'phoneIntegrationOwnership.ts',
];

/** Phone Link domaininin TAMAMI — hicbir modulu radyo acmamali. */
const PHONE_LINK_ALL_FILES = [
  ...F6_TS_FILES,
  'phoneLinkAttachment.ts', 'phoneLinkRole.ts', 'phoneLinkCapabilityGrant.ts',
  'phoneLinkGuestSession.ts', 'phoneLinkLifecycle.ts', 'phoneLinkSessionRegistry.ts',
  'phoneLinkMusicRemoteAdapter.ts', 'phoneLinkApplicationIngress.ts',
  'phoneLinkPortalRuntime.ts', 'phoneLinkPortalHttp.ts',
  'phoneLinkInternetGateway.ts', 'phoneLinkInternetPolicy.ts',
];

const FP = 'fp-alpha';
const EPOCH = 11;

function activeSnapshot() {
  return {
    state: 'ACTIVE', role: 'GUEST', roleReason: 'no_driver_authentication',
    deviceTrust: 'TRUSTED', sessionEpoch: EPOCH, deviceFingerprint: FP,
  };
}
function detachedSnapshot() {
  return {
    state: 'DETACHED', role: 'GUEST', roleReason: 'link_not_active',
    deviceTrust: 'UNKNOWN', sessionEpoch: null, deviceFingerprint: null,
  };
}

const ALL_INTENTS: readonly ConnectivityUserIntent[] = ['ALLOWED', 'USER_DISABLED', 'UNKNOWN'];
const ALL_TRANSPORTS: readonly ConnectivityTransport[] = ['BLUETOOTH', 'WIFI', 'HOTSPOT'];

beforeEach(() => {
  _resetPhoneIntegrationOwnershipForTest();
  _resetPhoneLinkLifecycleForTest();
  _resetPhoneLinkSessionRegistryForTest();
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkGuestSessionsForTest();
  mockSnapshot.mockReset().mockReturnValue(detachedSnapshot());
  useStore.getState().updateSettings({ carosConnectionPriorityEnabled: false });
});

/* ══════════════════════════════════════════════════════════════════════════
 * USER INTENT (1-5)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.7 User connectivity intent', () => {
  it('1. Bluetooth USER_DISABLED → enable cagrisi YOK', () => {
    const evidence = deriveBluetoothIntent({ ready: false, blockerCode: 'BLUETOOTH_DISABLED' });
    expect(evidence.intent).toBe('USER_DISABLED');
    expect(mayPhoneLinkEnableConnectivity('BLUETOOTH', evidence.intent)).toBe(false);
    expect(isPhoneLinkReconnectPermitted(evidence.intent)).toBe(false);

    /* Izin vermemek de kullanici kararidir. */
    for (const code of ['BLUETOOTH_PERMISSION_REQUIRED', 'BLUETOOTH_PERMISSION_DENIED']) {
      const e = deriveBluetoothIntent({ ready: false, blockerCode: code });
      expect(e.intent, code).toBe('USER_DISABLED');
      expect(mayPhoneLinkEnableConnectivity('BLUETOOTH', e.intent), code).toBe(false);
    }
  });

  it('2. Wi-Fi USER_DISABLED/bilinmiyor → enable cagrisi YOK', () => {
    const evidence = deriveWifiIntent();
    /* Kanonik bir Wi-Fi gozlemi YOK — uydurulmaz, UNKNOWN kalir. */
    expect(evidence.intent).toBe('UNKNOWN');
    expect(mayPhoneLinkEnableConnectivity('WIFI', evidence.intent)).toBe(false);
    expect(isPhoneLinkReconnectPermitted(evidence.intent)).toBe(false);
  });

  it('3. hotspot USER_DISABLED/bilinmiyor → enable cagrisi YOK', () => {
    const evidence = deriveHotspotIntent();
    expect(evidence.intent).toBe('UNKNOWN');
    expect(mayPhoneLinkEnableConnectivity('HOTSPOT', evidence.intent)).toBe(false);
  });

  it('4. UNKNOWN intent ACMA IZNI degildir — hicbir kombinasyon enable veremez', () => {
    for (const transport of ALL_TRANSPORTS) {
      for (const intent of ALL_INTENTS) {
        expect(mayPhoneLinkEnableConnectivity(transport, intent), `${transport}/${intent}`)
          .toBe(false);
      }
    }
    /* Olcum hic yoksa da fail-closed. */
    expect(deriveConnectivityIntent('BLUETOOTH', UNOBSERVED_PRECONDITIONS).intent).toBe('UNKNOWN');
  });

  it('5. Bluetooth ON → normal reconnect ENGELLENMEZ (F6.8)', () => {
    const evidence = deriveBluetoothIntent({ ready: true, blockerCode: null });
    expect(evidence.intent).toBe('ALLOWED');
    expect(evidence.reason).toBe('preconditions_ready');
    expect(isPhoneLinkReconnectPermitted(evidence.intent)).toBe(true);
    /* Ama bu "Bluetooth'u otomatik acmak" DEGILDIR. */
    expect(mayPhoneLinkEnableConnectivity('BLUETOOTH', evidence.intent)).toBe(false);
  });

  it('5b. eslesme eksikligi kullanici karari SAYILMAZ — akis engellenmez', () => {
    for (const code of ['NO_BONDED_DEVICE', 'DEVICE_NOT_SELECTED', 'SERVER_LISTEN_FAILED']) {
      const e = deriveBluetoothIntent({ ready: false, blockerCode: code });
      expect(e.intent, code).toBe('UNKNOWN');
      expect(e.reason, code).toBe('blocked_for_other_reason');
    }
    /* Donanim yoksa "kullanici kapatti" denmez. */
    const noHw = deriveBluetoothIntent({ ready: false, blockerCode: 'BLUETOOTH_UNAVAILABLE' });
    expect(noHw.intent).toBe('UNKNOWN');
    expect(noHw.reason).toBe('transport_unavailable');
  });

  it('5c. Phone Link modullerinin HICBIRI radyo acma yolu CAGIRMAZ', () => {
    for (const file of PHONE_LINK_ALL_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/setBluetooth|setWifi\(|setWifiEnabled|startTethering|setWifiApEnabled/);
      expect(src, file).not.toMatch(/BluetoothAdapter|WifiManager|ACTION_REQUEST_ENABLE/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SETTING (6-11)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.9/F6.11 Ayar', () => {
  it('6. varsayilan KAPALI', () => {
    const src = readFileSync(resolve(__dirname, '../store/useStore.ts'), 'utf8');
    expect(src).toMatch(/carosConnectionPriorityEnabled: false/);
  });

  it('7. persistence KANONIK settings deposu uzerinden — ikinci sistem YOK', () => {
    useStore.getState().updateSettings({ carosConnectionPriorityEnabled: true });
    expect(useStore.getState().settings.carosConnectionPriorityEnabled).toBe(true);
    useStore.getState().updateSettings({ carosConnectionPriorityEnabled: false });
    expect(useStore.getState().settings.carosConnectionPriorityEnabled).toBe(false);

    /* F6 modulleri kendi kalicilik sistemini KURMAZ. */
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/localStorage|sessionStorage|indexedDB|Preferences|Filesystem/);
    }
  });

  it('8. OFF + Phone Link ACTIVE → suppression YOK', () => {
    const policy = applyPhoneIntegrationOwnership({
      priorityEnabled: false, phoneLinkActive: true,
    });
    expect(policy.exclusiveOwnershipHeld).toBe(false);
    expect(policy.reason).toBe('priority_disabled');
    expect(policy.ownership.AUDIO).toBe('AVAILABLE');
    expect(policy.ownership.MEDIA_CONTROL).toBe('AVAILABLE');
    expect(policy.suspendedIntegrations).toHaveLength(0);
  });

  it('9. ON + Phone Link inactive → suppression YOK', () => {
    const policy = applyPhoneIntegrationOwnership({
      priorityEnabled: true, phoneLinkActive: false,
    });
    expect(policy.exclusiveOwnershipHeld).toBe(false);
    expect(policy.reason).toBe('phone_link_inactive');
    expect(policy.ownership.AUDIO).toBe('AVAILABLE');
  });

  it('10. ON + Phone Link ACTIVE → kontrol EDILEBILIR alanlar CarOS sahipli', () => {
    const policy = applyPhoneIntegrationOwnership({
      priorityEnabled: true, phoneLinkActive: true,
    });
    expect(policy.exclusiveOwnershipHeld).toBe(true);
    expect(policy.reason).toBe('exclusive_ownership');
    expect(policy.ownership.AUDIO).toBe('ACTIVE_OWNER');
    expect(policy.ownership.MEDIA_CONTROL).toBe('ACTIVE_OWNER');
    /* Kontrol edilemeyenler DURUSTCE UNMANAGED kalir. */
    expect(policy.ownership.MICROPHONE).toBe('UNMANAGED');
    expect(policy.ownership.PROJECTION).toBe('UNMANAGED');
    expect(policy.ownership.USB_PHONE_INTEGRATION).toBe('UNMANAGED');
  });

  it('11. ON→OFF while ACTIVE → ANINDA release', () => {
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    const released = applyPhoneIntegrationOwnership({
      priorityEnabled: false, phoneLinkActive: true,
    });
    expect(released.exclusiveOwnershipHeld).toBe(false);
    expect(getDomainOwnership('AUDIO')).toBe('AVAILABLE');
    /* Phone Link baglantisini KOPARMAK gerekmez — bu katman onu bilmez bile. */
    expect(phoneLinkCode('phoneIntegrationOwnership.ts')).not.toMatch(/disconnect|stopServer/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE (12-15)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.13/F6.14 Lifecycle', () => {
  it('12. Phone Link disconnect → ANINDA release (olay disinda tetikleyici YOK)', async () => {
    initPhoneIntegrationOwnershipLifecycle();
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    /* TEK girdi: F4 iptal zinciri. HTTP/Music/UI olayi YOK. */
    await applyPhoneLinkRevocationCascade(FP, EPOCH, 'REMOTE_DISCONNECT');

    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getDomainOwnership('AUDIO')).toBe('AVAILABLE');
  });

  it('13. FAILED de release uretir', async () => {
    initPhoneIntegrationOwnershipLifecycle();
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    await applyPhoneLinkRevocationCascade(FP, EPOCH, 'AUTH_FAILED');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
  });

  it('14. process cleanup → sahiplik YAPISAL OLARAK kalkar (kalici durum YOK)', () => {
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    /* Process olumu = modul belleginin sifirlanmasi. */
    _resetPhoneIntegrationOwnershipForTest();
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);

    /* Sahiplik hicbir kalici duruma YAZILMAZ → kurtarma rutini gerekmez. */
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/localStorage|Preferences|writeFile|Settings\.System/);
    }
  });

  it('15. duplicate release idempotenttir', async () => {
    initPhoneIntegrationOwnershipLifecycle();
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    const firstCount = getPhoneIntegrationTelemetry().transitionCount;

    await applyPhoneLinkRevocationCascade(FP, EPOCH, 'REMOTE_DISCONNECT');
    const afterFirst = getPhoneIntegrationTelemetry().transitionCount;
    await applyPhoneLinkRevocationCascade(FP, EPOCH, 'REMOTE_DISCONNECT');
    const afterSecond = getPhoneIntegrationTelemetry().transitionCount;

    expect(afterFirst).toBe(firstCount + 1);
    expect(afterSecond).toBe(afterFirst);   // ikinci kopus GECIS SAYILMAZ

    releasePhoneIntegrationOwnership();
    expect(getPhoneIntegrationTelemetry().transitionCount).toBe(afterSecond);
    expect(isOwnershipTransition(releasedPolicy(), releasedPolicy())).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * AUTHORITY (16-19)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.16 Authority sinirlari', () => {
  it('16. priority != trust', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    /* Arbiter guven hesaplamaz ve guven okumaz. */
    for (const file of ['phoneIntegrationArbiter.ts', 'phoneIntegrationOwnership.ts']) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/deviceTrust|deriveTrustLevel|TRUSTED/);
    }
  });

  it('17. priority != person identity', () => {
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/driverAuthentication|driverPresence|personIdentity|driverId/);
    }
  });

  it('18. priority != PRIMARY — ownership vocabulary AYRI', () => {
    mockSnapshot.mockReturnValue(activeSnapshot());
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    expect(derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP, nowMs: 1_000,
    }).role).toBe('GUEST');
    /* Isim cakismasi YOK: arbiter 'PRIMARY' kelimesini hic kullanmaz. */
    for (const file of ['phoneIntegrationArbiter.ts', 'phoneIntegrationOwnership.ts']) {
      expect(phoneLinkCode(file), file).not.toMatch(/PRIMARY/);
    }
  });

  it('19. priority != capability — yeni grant URETMEZ', () => {
    /* NOT: `MEDIA_CONTROL` burada bir KAYNAK ALANI adidir (F6.5 boyle
       adlandiriyor) ve ayni adi tasiyan capability ile ILGISI YOKTUR.
       Onemli olan ad degil, YETKI URETIMININ olmamasidir. */
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/issueGuestMediaGrant|issuePhoneInternetGrant/);
      expect(src, file).not.toMatch(/authorize\(|canExecute\(|grantedCapabilities/);
      expect(src, file).not.toMatch(/phoneLinkCapabilityGrant|security\/authorization/);
    }
  });

  it('19b. Bluetooth/Wi-Fi/rakip varligi KIMLIK degildir', () => {
    /* Niyet modeli kimlik alani URETMEZ. */
    const evidence = deriveBluetoothIntent({ ready: true, blockerCode: null });
    expect(Object.keys(evidence).sort()).toEqual(['intent', 'reason', 'transport']);
    /* Politika da kimlik alani URETMEZ. */
    const policy = derivePhoneIntegrationPolicy({ priorityEnabled: true, phoneLinkActive: true });
    const keys = Object.keys(policy);
    for (const forbidden of ['role', 'driverId', 'identity', 'trust', 'fingerprint']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * COMPETITORS (20-24)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.1/F6.4 Rakip entegrasyonlar', () => {
  it('20. kontrol EDILEBILIR alanda sahiplik gercekten uretilir', () => {
    expect(isDomainControllable('AUDIO')).toBe(true);
    expect(isDomainControllable('MEDIA_CONTROL')).toBe(true);
    const policy = derivePhoneIntegrationPolicy({ priorityEnabled: true, phoneLinkActive: true });
    expect(policy.ownership.AUDIO).toBe('ACTIVE_OWNER');
  });

  it('21. UNKNOWN entegrasyon ASLA zorla susturulmaz', () => {
    expect(isIntegrationControllable('UNKNOWN')).toBe(false);
    const policy = derivePhoneIntegrationPolicy({ priorityEnabled: true, phoneLinkActive: true });
    expect(policy.suspendedIntegrations).toHaveLength(0);
  });

  it('22. kontrol EDILEMEYEN projeksiyon icin SAHTE SUSPENDED uretilmez', () => {
    expect(isDomainControllable('PROJECTION')).toBe(false);
    expect(isDomainControllable('USB_PHONE_INTEGRATION')).toBe(false);
    expect(isDomainControllable('MICROPHONE')).toBe(false);
    /* Ayar ACIK ve Phone Link ACTIVE olsa bile UNMANAGED. */
    const policy = derivePhoneIntegrationPolicy({ priorityEnabled: true, phoneLinkActive: true });
    for (const domain of ['MICROPHONE', 'PROJECTION', 'USB_PHONE_INTEGRATION'] as const) {
      expect(policy.ownership[domain], domain).toBe('UNMANAGED');
      expect(policy.ownership[domain], domain).not.toBe('SUSPENDED');
    }
  });

  it('22b. paket adi UYDURULMADI — repoda kanitlanmis rakip kimligi YOK', () => {
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/com\.[a-z]+\.[a-z]+/);
      expect(src, file).not.toMatch(/zlink|autokit|carbit|easyconnect|tlink/i);
    }
  });

  it('23. CarOS release sonrasi TUM kontrol edilebilir alanlar birakilir', () => {
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    releasePhoneIntegrationOwnership();
    for (const domain of PHONE_INTEGRATION_DOMAINS) {
      const owned = getDomainOwnership(domain);
      expect(owned === 'AVAILABLE' || owned === 'UNMANAGED', domain).toBe(true);
      expect(owned, domain).not.toBe('ACTIVE_OWNER');
    }
    /* Birakmak != zorla baslatmak: hicbir baslatma yolu YOK. */
    expect(phoneLinkCode('phoneIntegrationArbiter.ts')).not.toMatch(/startActivity|launchIntent|startService/);
  });

  it('24. last-connected-wins YOK — arbiter cihaz bazli playback authority uretmez', () => {
    for (const file of ['phoneIntegrationArbiter.ts', 'phoneIntegrationOwnership.ts']) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/lastConnected|deviceFingerprint|sessionEpoch/);
      expect(src, file).not.toMatch(/mediaCommandGateway|playbackTruth/);
    }
    /* Politika girdisi cihaz DEGIL, tek bir "Phone Link aktif mi" hukmudur. */
    const policy = derivePhoneIntegrationPolicy({ priorityEnabled: true, phoneLinkActive: true });
    expect(policy.exclusiveOwnershipHeld).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SAFETY / PERFORMANCE (25-30)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.17 Guvenlik ve performans', () => {
  it('25. kill -9 / root / shell hack YOK', () => {
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/kill|forceStop|force-stop|\bsu\b|Runtime\.getRuntime|exec\(/);
    }
  });

  it('26. hidden API YOK', () => {
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/reflect|getDeclaredMethod|setAccessible|IActivityManager/i);
    }
  });

  it('27. accessibility abuse YOK', () => {
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/Accessibility|performGlobalAction|dispatchGesture/i);
    }
  });

  it('28. polling YOK — paket/process taramasi yapilmaz', () => {
    for (const file of F6_TS_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/setInterval\(/);
      expect(src, file).not.toMatch(/getInstalledPackages|queryIntentServices|getRunningTasks|getRunningAppProcesses/);
    }
  });

  it('29. recurring timer YOK', () => {
    for (const file of F6_TS_FILES) {
      expect(phoneLinkCode(file), file).not.toMatch(/setTimeout\(|requestAnimationFrame/);
    }
  });

  it('30. idle is YOK — arbiter SAF, cagrilmadan hicbir sey calismaz', () => {
    /* Ayni girdi her zaman ayni ciktiyi verir; modul durumu degismez. */
    const a = derivePhoneIntegrationPolicy({ priorityEnabled: false, phoneLinkActive: false });
    const b = derivePhoneIntegrationPolicy({ priorityEnabled: false, phoneLinkActive: false });
    expect(a).toEqual(b);

    const before = getPhoneIntegrationTelemetry();
    for (let i = 0; i < 50; i += 1) derivePhoneIntegrationPolicy({ priorityEnabled: true, phoneLinkActive: true });
    expect(getPhoneIntegrationTelemetry()).toEqual(before);   // saf cagri durumu DEGISTIRMEZ

    /* Arbiter hicbir yan etki/IO icermez. */
    const src = phoneLinkCode('phoneIntegrationArbiter.ts');
    expect(src).not.toMatch(/registerPlugin|addListener|fetch\(|await /);
  });

  it('30b. LAB telemetrisi paket/credential/token/parmak izi TASIMAZ', () => {
    applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    const telemetry = JSON.stringify(getPhoneIntegrationTelemetry());
    for (const secret of ['token', 'credential', 'fingerprint', FP, 'com.']) {
      expect(telemetry, secret).not.toContain(secret);
    }
  });
});
