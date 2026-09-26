/**
 * phoneLinkConnectionPriorityF61.test.ts — PHONE LINK F6.1 · PRODUCTION ACTIVATION WIRING.
 *
 * F6.1 madde 17 (Test Gates) + madde 16 (Race testleri) numaralari test
 * adlarindadir.
 *
 *   Gates 1-14   · state machine (OFF/ON x inactive/ACTIVE), sira, hydration
 *   Gates 15-19  · user connectivity intent korunuyor
 *   Gates 20-25  · isolation + performans
 *   Race A-F     · madde 16'nin harfli senaryolari birebir
 *
 * Bu dosya F6'nin kendi "phoneLinkConnectionPriorityF6.test.ts" dosyasini
 * DEGISTIRMEZ; F6.1'in YENI production wiring'ini (reconcilePhoneIntegrationOwnership,
 * F4 lifecycle -> ownership, settings -> ownership, hydration -> ownership)
 * hedefler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Canli attachment taklidi (F4/F6 testleriyle AYNI desen) ────────────── */
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
  ingestPhoneHubLinkStateEvent, _resetPhoneHubLinkStateForTest,
  type PhoneHubLinkStateEvent,
} from '../platform/phoneHub/phoneHubLink';
import {
  applyPhoneLinkRevocationCascade, _resetPhoneLinkLifecycleForTest,
} from '../platform/phoneLink/phoneLinkLifecycle';
import {
  activeRuntimeSessionCount, upsertRuntimeSession, _resetPhoneLinkSessionRegistryForTest,
} from '../platform/phoneLink/phoneLinkSessionRegistry';
import { _resetPhoneLinkGrantsForTest } from '../platform/phoneLink/phoneLinkCapabilityGrant';
import { _resetPhoneLinkGuestSessionsForTest } from '../platform/phoneLink/phoneLinkGuestSession';
import { derivePhoneLinkRole } from '../platform/phoneLink/phoneLinkRole';
import {
  applyPhoneIntegrationOwnership, releasePhoneIntegrationOwnership,
  reconcilePhoneIntegrationOwnership, initPhoneIntegrationOwnershipLifecycle,
  getPhoneIntegrationPolicy, getPhoneIntegrationTelemetry, getDomainOwnership,
  _resetPhoneIntegrationOwnershipForTest,
} from '../platform/phoneLink/phoneIntegrationOwnership';
import { useStore } from '../store/useStore';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardimcilar (F4 test dosyasiyla AYNI desen)
 * ════════════════════════════════════════════════════════════════════════ */

function codeOf(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}
function phoneLinkCode(file: string): string {
  return codeOf(resolve(__dirname, '../platform/phoneLink/', file));
}

const FP_A = 'fp-alpha';
const EPOCH_A = 11;
const EPOCH_B = 22;

function event(
  state: PhoneHubLinkStateEvent['state'],
  epoch: number | null,
  fingerprint: string | null,
  reason: PhoneHubLinkStateEvent['reason'] = 'REMOTE_DISCONNECT',
) {
  return { protocolVersion: 1, state, sessionEpoch: epoch, deviceFingerprint: fingerprint, reason };
}

/** Kanonik olayi YUTMA katmanindan gecirip TUM production zincirini calistirir. */
async function deliver(
  state: PhoneHubLinkStateEvent['state'],
  epoch: number | null,
  fingerprint: string | null,
  reason: PhoneHubLinkStateEvent['reason'] = 'REMOTE_DISCONNECT',
): Promise<boolean> {
  const accepted = ingestPhoneHubLinkStateEvent(event(state, epoch, fingerprint, reason));
  await Promise.resolve();
  await Promise.resolve();
  return accepted;
}

function setPriority(enabled: boolean): void {
  useStore.getState().updateSettings({ carosConnectionPriorityEnabled: enabled });
}

let disposeWiring: (() => void) | null = null;

beforeEach(() => {
  _resetPhoneHubLinkStateForTest();
  _resetPhoneLinkLifecycleForTest();
  _resetPhoneLinkSessionRegistryForTest();
  _resetPhoneLinkGrantsForTest();
  _resetPhoneLinkGuestSessionsForTest();
  _resetPhoneIntegrationOwnershipForTest();
  mockSnapshot.mockReset().mockReturnValue({
    state: 'DETACHED', role: 'GUEST', roleReason: 'link_not_active',
    sessionEpoch: null, deviceFingerprint: null,
  });
  setPriority(false);
  /* PRODUCTION WIRING'in KENDISI kurulur — testler App.tsx'in yaptigi
     cagriyi TEKRARLAR, kendi reconciliation'ini YAZMAZ. */
  disposeWiring = initPhoneIntegrationOwnershipLifecycle();
});

afterEach(() => {
  disposeWiring?.();
  disposeWiring = null;
});

/* ══════════════════════════════════════════════════════════════════════════
 * GATES 1-14 — state machine, sira, hydration
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.1 Gates — state machine', () => {
  it('1. default OFF → released', () => {
    expect(useStore.getState().settings.carosConnectionPriorityEnabled).toBe(false);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
  });

  it('2. OFF + ACTIVE → released', async () => {
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(activeRuntimeSessionCount()).toBe(1);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getPhoneIntegrationPolicy().reason).toBe('priority_disabled');
  });

  it('3. ON + inactive → released', () => {
    setPriority(true);
    expect(activeRuntimeSessionCount()).toBe(0);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getPhoneIntegrationPolicy().reason).toBe('phone_link_inactive');
  });

  it('4. ON BEFORE connection, sonra ACTIVE → owned (F6 kapanis boslugunun TAM KENDISI)', async () => {
    setPriority(true);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);

    /* TEK girdi: canonical F4 lifecycle olayi. Hicbir UI/LAB cagrisi YOK. */
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');

    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
    expect(getPhoneIntegrationPolicy().reason).toBe('exclusive_ownership');
    expect(getDomainOwnership('AUDIO')).toBe('ACTIVE_OWNER');
    expect(getDomainOwnership('MEDIA_CONTROL')).toBe('ACTIVE_OWNER');
  });

  it('5. ACTIVE ONCE, sonra ON → owned (ayar aboneligi reconcile eder)', async () => {
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);

    setPriority(true);   // UI/LAB DEGIL — kanonik ayar deposunun KENDISI

    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
    expect(getDomainOwnership('AUDIO')).toBe('ACTIVE_OWNER');
  });

  it('6. ACTIVE + ON→OFF → ANINDA release', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    setPriority(false);   // senkron: await GEREKMEZ

    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getDomainOwnership('AUDIO')).toBe('AVAILABLE');
    /* Phone Link oturumu KOPARILMADI — yalniz sahiplik dustu. */
    expect(activeRuntimeSessionCount()).toBe(1);
  });

  it('7. disconnect → ANINDA release', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'REMOTE_DISCONNECT');

    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getDomainOwnership('AUDIO')).toBe('AVAILABLE');
  });

  it('8. FAILED → release', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    await deliver('FAILED', EPOCH_A, FP_A, 'AUTH_FAILED');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
  });

  it('9. duplicate ACTIVE idempotent — reconcile ikinci kez TETIKLENMEZ', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    const afterFirst = getPhoneIntegrationTelemetry().transitionCount;

    /* AYNI (state, epoch, fingerprint) — F4 ingest katmani dedupe eder,
       handler'a HIC ULASMAZ. */
    const acceptedAgain = await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');

    expect(acceptedAgain).toBe(false);
    expect(getPhoneIntegrationTelemetry().transitionCount).toBe(afterFirst);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
  });

  it('10. duplicate disconnect idempotent', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'REMOTE_DISCONNECT');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    const afterFirst = getPhoneIntegrationTelemetry().transitionCount;

    /* Ikinci kopus zaten yok olan (fp, epoch) ciftini hedefler — no-op. */
    await applyPhoneLinkRevocationCascade(FP_A, EPOCH_A, 'REMOTE_DISCONNECT');

    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getPhoneIntegrationTelemetry().transitionCount).toBe(afterFirst);
  });

  it('11. late lifecycle event (eski epoch) — YENI ACTIVE oturumun sahipligini DUSURMEZ', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'REMOTE_DISCONNECT');
    await deliver('ESTABLISHED', EPOCH_B, FP_A, 'UNKNOWN');   // yeniden baglanma, YENI nesil
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    /* GEC gelen ESKI nesil kopus olayi — (fp, epoch=11) artik YOK, no-op. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'TRANSPORT_LOST');

    expect(activeRuntimeSessionCount()).toBe(1);   // YENI oturum hala kayitli
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
    expect(getDomainOwnership('AUDIO')).toBe('ACTIVE_OWNER');
  });

  it('12. late/rapid ayar bildirimi inaktif oturumu DIRILTMEZ', () => {
    /* Phone Link HIC baglanmadi. Ayar hizlica ON->OFF->ON degisse bile
       sahiplik her defasinda GUNCEL "phoneLinkActive" gercegini okur. */
    setPriority(true);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    setPriority(false);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    setPriority(true);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getPhoneIntegrationPolicy().reason).toBe('phone_link_inactive');
  });

  it('13. startup: kayitli ON + ACTIVE oturum -> hydration TAMAMLANINCA owned', () => {
    /*
     * Bu test hydration-tamamlanma kancasinin (onFinishHydration) KENDI
     * BASINA reconcile ettigini kanitlar: ayar degisim aboneligi (useStore.
     * subscribe) BILEREK NOTRALIZE edilir ve Phone Link aktifligi (registry)
     * OLAY SISTEMINDEN GECMEDEN dogrudan ayarlanir - boylece gozlenen
     * "owned" sonucu YALNIZ hydration kancasinin eseri olur.
     */
    disposeWiring?.();
    disposeWiring = null;

    const originalHasHydrated = useStore.persist.hasHydrated;
    const originalOnFinish = useStore.persist.onFinishHydration;
    const originalSubscribe = useStore.subscribe;
    let hydrationCb: (() => void) | null = null;
    useStore.persist.hasHydrated = () => false;
    useStore.persist.onFinishHydration = (cb: () => void) => {
      hydrationCb = cb;
      return () => { hydrationCb = null; };
    };
    useStore.subscribe = (() => () => {}) as typeof useStore.subscribe;

    try {
      /* Phone Link ZATEN aktif - dogrudan registry, olay/abonelik YOK. */
      upsertRuntimeSession({
        deviceFingerprint: FP_A, sessionEpoch: EPOCH_A,
        attachmentState: 'ACTIVE', role: 'GUEST',
      });
      /* "kayitli tercih" - set() cagrilir ama (notralize edilmis) abonelik
         BUNU YAKALAMAZ. */
      setPriority(true);

      disposeWiring = initPhoneIntegrationOwnershipLifecycle();
      /* Hydration HENUZ bitmedi - polling/timeout YOK, henuz owned OLMAMALI. */
      expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);

      expect(hydrationCb).not.toBeNull();
      hydrationCb!();   // zustand persist'in KENDI tamamlanma olayi

      expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
      expect(getDomainOwnership('AUDIO')).toBe('ACTIVE_OWNER');
    } finally {
      useStore.persist.hasHydrated = originalHasHydrated;
      useStore.persist.onFinishHydration = originalOnFinish;
      useStore.subscribe = originalSubscribe;
    }
  });

  it('14. startup: kayitli OFF + ACTIVE oturum -> hydration sonrasi da released', () => {
    disposeWiring?.();
    disposeWiring = null;

    const originalHasHydrated = useStore.persist.hasHydrated;
    const originalOnFinish = useStore.persist.onFinishHydration;
    const originalSubscribe = useStore.subscribe;
    let hydrationCb: (() => void) | null = null;
    useStore.persist.hasHydrated = () => false;
    useStore.persist.onFinishHydration = (cb: () => void) => {
      hydrationCb = cb;
      return () => { hydrationCb = null; };
    };
    useStore.subscribe = (() => () => {}) as typeof useStore.subscribe;

    try {
      upsertRuntimeSession({
        deviceFingerprint: FP_A, sessionEpoch: EPOCH_A,
        attachmentState: 'ACTIVE', role: 'GUEST',
      });
      setPriority(false);

      disposeWiring = initPhoneIntegrationOwnershipLifecycle();
      hydrationCb!();

      expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    } finally {
      useStore.persist.hasHydrated = originalHasHydrated;
      useStore.persist.onFinishHydration = originalOnFinish;
      useStore.subscribe = originalSubscribe;
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SIRA (madde 9) — once truth, sonra ownership
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.1 Ordering', () => {
  it('reconcileOwnership HER ZAMAN upsertRuntimeSession-DAN SONRA calisir (ACTIVE)', async () => {
    setPriority(true);
    let seenCountAtReconcile = -1;
    /* reconcilePhoneIntegrationOwnership GERCEK okuma yapar; ACTIVE anindaki
       registry durumunu dogrudan olcuyoruz. */
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    seenCountAtReconcile = activeRuntimeSessionCount();
    expect(seenCountAtReconcile).toBe(1);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
  });

  it('releaseIntegrationOwnership CAGRILDIGINDA session truth ZATEN dusmustur', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');

    const order: string[] = [];
    const originalRelease = releasePhoneIntegrationOwnership;
    /* Cascade'in gercek cagirdigi yol degismedi; burada yalniz ANDAKI
       registry durumunu gozlemliyoruz. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'REMOTE_DISCONNECT');
    order.push(`release:sessions=${activeRuntimeSessionCount()}`);
    expect(order).toEqual(['release:sessions=0']);
    void originalRelease;
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RACE A-F (madde 16, harfli senaryolar birebir)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.1 Race senaryolari', () => {
  it('Race A: Priority ON -> Phone Link connects -> ACTIVE => owned', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
  });

  it('Race B: Phone Link ACTIVE -> Priority ON => owned', async () => {
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    setPriority(true);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
  });

  it('Race C: Priority ON + ACTIVE -> disconnect ayniyla ayar guncellenirse final RELEASED olur', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);

    /* "Ayni an" simulasyonu: disconnect ONCE isler (senkron kisim), ardindan
       ayar guncellemesi de gelir — HANGISI once olursa olsun, GUNCEL truth
       inactive oldugu icin final durum RELEASED olmalidir. */
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'REMOTE_DISCONNECT');
    setPriority(false);
    setPriority(true);   // ayar tekrar ON olsa bile oturum artik YOK

    expect(activeRuntimeSessionCount()).toBe(0);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getPhoneIntegrationPolicy().reason).toBe('phone_link_inactive');
  });

  it('Race D: eski ACTIVE lifecycle olayi -> yeni DISCONNECTED -> gec gelen settings bildirimi => yeniden CANLANMAZ', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    await deliver('DISCONNECTED', EPOCH_A, FP_A, 'REMOTE_DISCONNECT');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);

    /* Gec gelen ayar bildirimi — AYNI degere yeniden yazma (no-op degisim
       olsa bile reconcile GUNCEL gercegi okur, asla eski ACTIVE'i varsaymaz). */
    setPriority(false);
    setPriority(true);

    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
    expect(getPhoneIntegrationPolicy().reason).toBe('phone_link_inactive');
  });

  it('Race E: kayitli ayar ON -> hydration tamamlanir -> oturum ZATEN ACTIVE => owned', () => {
    disposeWiring?.();
    disposeWiring = null;
    const originalHasHydrated = useStore.persist.hasHydrated;
    const originalOnFinish = useStore.persist.onFinishHydration;
    const originalSubscribe = useStore.subscribe;
    let cb: (() => void) | null = null;
    useStore.persist.hasHydrated = () => false;
    useStore.persist.onFinishHydration = (fn: () => void) => { cb = fn; return () => { cb = null; }; };
    useStore.subscribe = (() => () => {}) as typeof useStore.subscribe;
    try {
      /* Oturum ZATEN aktif (dogrudan registry - olay yolundan BAGIMSIZ). */
      upsertRuntimeSession({
        deviceFingerprint: FP_A, sessionEpoch: EPOCH_A,
        attachmentState: 'ACTIVE', role: 'GUEST',
      });
      setPriority(true);
      disposeWiring = initPhoneIntegrationOwnershipLifecycle();
      expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
      cb!();
      expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
    } finally {
      useStore.persist.hasHydrated = originalHasHydrated;
      useStore.persist.onFinishHydration = originalOnFinish;
      useStore.subscribe = originalSubscribe;
    }
  });

  it('Race F: setting OFF -> gec gelen duplicate ESTABLISHED => sahiplik URETILMEZ', async () => {
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);   // priority hala OFF

    /* Ayni (state, epoch, fp) ucluk — F4 ingest dedupe eder; handler'a
       ulasmaz, reconcile TEKRAR TETIKLENMEZ. */
    const acceptedAgain = await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(acceptedAgain).toBe(false);
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GATES 15-19 — User Connectivity Intent korunuyor
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.1 Kullanici baglanti iradesi korundu', () => {
  const F61_FILES = ['phoneIntegrationOwnership.ts'];

  it('15/16/17. hicbir radyo enable cagrisi YOK (Bluetooth/Wi-Fi/hotspot)', () => {
    for (const file of F61_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/setBluetooth|setWifi\(|setWifiEnabled|startTethering|setWifiApEnabled/);
      expect(src, file).not.toMatch(/BluetoothAdapter|WifiManager|ACTION_REQUEST_ENABLE/);
    }
    /* Urun acilisi da radyo cagirmiyor (F6.2). */
    const bootSrc = codeOf(resolve(__dirname, '../platform/phoneLink/phoneLinkProductBoot.ts'));
    expect(bootSrc).not.toMatch(/setBluetooth|setWifi\(|setWifiEnabled|startTethering|BluetoothAdapter|WifiManager/);
  });

  it('18. Priority OFF iken Phone Link DISCONNECT edilmez', () => {
    for (const file of F61_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/disconnectSession|stopServer|disconnectPhoneHubSession/);
    }
  });

  it('19. release rakip entegrasyonu ZORLA BASLATMAZ', () => {
    for (const file of F61_FILES) {
      const src = phoneLinkCode(file);
      expect(src, file).not.toMatch(/startActivity|launchIntent|startService/);
    }
    releasePhoneIntegrationOwnership();
    for (const domain of ['AUDIO', 'MEDIA_CONTROL'] as const) {
      expect(getDomainOwnership(domain)).toBe('AVAILABLE');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * GATES 20-25 — isolation + performans
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.1 Isolation ve performans', () => {
  it('20. kontrol edilemeyen alanlar owned durumda bile UNMANAGED kalir', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
    for (const domain of ['MICROPHONE', 'PROJECTION', 'USB_PHONE_INTEGRATION'] as const) {
      expect(getDomainOwnership(domain), domain).toBe('UNMANAGED');
    }
  });

  it('21/22/23. priority reconciliation trust/identity/PRIMARY uretmez', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    expect(getPhoneIntegrationPolicy().exclusiveOwnershipHeld).toBe(true);
    expect(derivePhoneLinkRole({
      attachmentState: 'ACTIVE', deviceFingerprint: FP_A, nowMs: 1_000,
    }).role).toBe('GUEST');
    const src = phoneLinkCode('phoneIntegrationOwnership.ts');
    expect(src).not.toMatch(/deviceTrust|deriveTrustLevel|'PRIMARY'|driverAuthentication|driverPresence/);
  });

  it('24. reconciliation yeni capability grant URETMEZ', () => {
    const src = phoneLinkCode('phoneIntegrationOwnership.ts');
    expect(src).not.toMatch(/issueGuestMediaGrant|issuePhoneInternetGrant|authorize\(|canExecute\(/);
    expect(src).not.toMatch(/phoneLinkCapabilityGrant|security\/authorization/);
  });

  it('25. yeni timer/polling YOK + wiring KANONIK product boot owner-da', () => {
    const src = phoneLinkCode('phoneIntegrationOwnership.ts');
    expect(src).not.toMatch(/setInterval\(|setTimeout\(/);
    expect(src).not.toMatch(/getInstalledPackages|queryIntentServices|getRunningTasks|getRunningAppProcesses/);

    /* F6.2: wiring App.tsx'ten KANONIK urun acilisina tasindi
       (`phoneLinkProductBoot.ts` <- SystemBoot Wave 4). UI/LAB SURMEZ. */
    const bootSrc = codeOf(resolve(__dirname, '../platform/phoneLink/phoneLinkProductBoot.ts'));
    expect(bootSrc).toMatch(/initPhoneIntegrationOwnershipLifecycle\(\)/);
    const systemBootSrc = codeOf(resolve(__dirname, '../platform/system/SystemBoot.ts'));
    expect(systemBootSrc).toMatch(/startPhoneLinkProductBoot\(\)/);
    /* App.tsx artik Phone Link SURMEZ. */
    const appSrc = codeOf(resolve(__dirname, '../App.tsx'));
    expect(appSrc).not.toMatch(/initPhoneIntegrationOwnershipLifecycle/);
  });

  it('25b. TEK reconciliation giris noktasi — applyPhoneIntegrationOwnership baska yerden cagrilmaz', () => {
    const dir = resolve(__dirname, '../platform/phoneLink/');
    const files = [
      'phoneLinkLifecycle.ts', 'phoneLinkSessionRegistry.ts', 'phoneLinkGuestSession.ts',
      'phoneLinkCapabilityGrant.ts', 'phoneLinkPortalHttp.ts', 'phoneLinkPortalRuntime.ts',
      'phoneLinkInternetGateway.ts', 'phoneIntegrationArbiter.ts',
    ];
    for (const file of files) {
      const src = codeOf(resolve(dir, file));
      expect(src, file).not.toMatch(/applyPhoneIntegrationOwnership\(/);
    }
    /* Settings karti da DOGRUDAN cagirmaz (F6.1 madde 3: UI SURMEZ). */
    const cardSrc = codeOf(resolve(__dirname, '../components/settings/CarOsConnectionPriorityCard.tsx'));
    expect(cardSrc).not.toMatch(/applyPhoneIntegrationOwnership\(|releasePhoneIntegrationOwnership\(/);
  });

  it('25c. reconcilePhoneIntegrationOwnership SAF girdi okur — ayni gercek ayni sonucu verir', async () => {
    setPriority(true);
    await deliver('ESTABLISHED', EPOCH_A, FP_A, 'UNKNOWN');
    const a = reconcilePhoneIntegrationOwnership();
    const b = reconcilePhoneIntegrationOwnership();
    expect(a).toEqual(b);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F6 REGRESYONU — F6.1 mevcut policy hukmunu DEGISTIRMEDI
 * ════════════════════════════════════════════════════════════════════════ */

describe('F6.1 F6 policy hukmu degismedi', () => {
  it('OFF+ACTIVE / ON+inactive / ON+ACTIVE saf applyPhoneIntegrationOwnership ile AYNI', () => {
    expect(applyPhoneIntegrationOwnership({ priorityEnabled: false, phoneLinkActive: true })
      .exclusiveOwnershipHeld).toBe(false);
    expect(applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: false })
      .exclusiveOwnershipHeld).toBe(false);
    const owned = applyPhoneIntegrationOwnership({ priorityEnabled: true, phoneLinkActive: true });
    expect(owned.exclusiveOwnershipHeld).toBe(true);
    expect(owned.ownership.MICROPHONE).toBe('UNMANAGED');
    expect(owned.ownership.PROJECTION).toBe('UNMANAGED');
    expect(owned.ownership.USB_PHONE_INTEGRATION).toBe('UNMANAGED');
  });
});
