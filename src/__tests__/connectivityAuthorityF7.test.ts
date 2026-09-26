/**
 * connectivityAuthorityF7.test.ts — CAROS F7 · KANONİK CONNECTIVITY AUTHORITY.
 *
 * §36'nin 40 kapisi test adlarindadir.
 *
 *   Authority        1-4    · tek gercek sahibi
 *   Truth            5-11   · validated/captive/unknown fail-closed
 *   Multiple sources 12-16  · oncelik, Phone Link, stale/weak
 *   Policy           17-21  · operasyon sinifi kararlari
 *   Migration        22-27  · tuketici davranisi korunmus
 *   Lifecycle        28-33  · boot, cold boot, idempotent, gecisler
 *   Security/perf    34-40  · radyo/ping/timer/identity/secret yok
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

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
  deriveConnectivitySnapshot, deriveStateFromFacts, evidenceFromFacts,
  evidenceFromBrowserHint, evidenceFromCapacitorNetwork, isEvidenceStale,
  deriveQuality, UNKNOWN_SNAPSHOT, EVIDENCE_CONFIDENCE,
  ONE_SHOT_EVIDENCE_MAX_AGE_MS,
  type ConnectivityEvidence, type ConnectivitySnapshot, type NetworkFacts,
} from '../platform/connectivity/connectivityEvidence';
import {
  canUseConnectivity, isConnectivityAllowed,
} from '../platform/connectivity/connectivityPolicy';
import {
  getConnectivitySnapshot, subscribeConnectivity, ingestConnectivityEvidence,
  dropConnectivityEvidence, ingestNetworkFactsRaw, subscribeNetworkFacts,
  getConnectivityTelemetry, startConnectivityAuthority,
  _resetConnectivityAuthorityForTest,
} from '../platform/connectivity/connectivityAuthority';
import { allowsConnectivity } from '../platform/connectivity/connectivityGate';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardimcilar
 * ════════════════════════════════════════════════════════════════════════ */

function codeOf(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

const NOW = 1_000_000;

function facts(overrides: Partial<NetworkFacts> = {}): NetworkFacts {
  return {
    present: true, transport: 'WIFI', hasInternetCapability: true,
    validated: true, captivePortal: false, metered: true,
    downstreamKbps: 8_000, upstreamKbps: 2_000,
    ...overrides,
  };
}

function androidEvidence(
  overrides: Partial<NetworkFacts> = {}, observedAt = NOW,
): ConnectivityEvidence {
  return evidenceFromFacts({
    source: 'ANDROID_NETWORK_CALLBACK', facts: facts(overrides),
    observedAt, continuous: true,
  });
}

function snap(overrides: Partial<ConnectivitySnapshot> = {}): ConnectivitySnapshot {
  return { ...UNKNOWN_SNAPSHOT, ...overrides };
}

beforeEach(() => {
  _resetConnectivityAuthorityForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * AUTHORITY (1-4)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7 Authority', () => {
  it('1. TEK kanonik gercek sahibi — hukum SAF katmanda uretilir', () => {
    /* Runtime katmani kendi state machine'ini YAZMAZ; SAF turetime delege eder. */
    const runtime = codeOf(resolve(__dirname, '../platform/connectivity/connectivityAuthority.ts'));
    expect(runtime).toMatch(/deriveConnectivitySnapshot\(/);
    /* Kendi ad-hoc karar zinciri YOK. */
    expect(runtime).not.toMatch(/state = 'ONLINE'/);
  });

  it('2. consumers authority-yi READ-ONLY kullanir (snapshot dondurulmus)', () => {
    ingestConnectivityEvidence(androidEvidence());
    const s = getConnectivitySnapshot();
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.state).toBe('ONLINE');
  });

  it('3. React/store IKINCI authority degildir', () => {
    const dir = resolve(__dirname, '../platform/connectivity/');
    for (const file of ['connectivityAuthority.ts', 'connectivityPolicy.ts', 'connectivityEvidence.ts']) {
      const src = codeOf(join(dir, file));
      expect(src, file).not.toMatch(/useStore|zustand|react|useState|useEffect/i);
    }
  });

  it('4. connectivityService (offline kuyruk) IKINCI truth degildir — yon tek', () => {
    /* Otorite kuyruk servisini import ETMEZ (dairesel bagimlilik YOK). */
    const runtime = codeOf(resolve(__dirname, '../platform/connectivity/connectivityAuthority.ts'));
    expect(runtime).not.toMatch(/connectivityService/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * TRUTH (5-11)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7 Truth', () => {
  it('5. ag yok → OFFLINE; hic kanit yok → UNKNOWN (ayrim korunur)', () => {
    expect(deriveConnectivitySnapshot([], NOW).state).toBe('UNKNOWN');
    expect(deriveStateFromFacts(facts({ present: false }))).toBe('OFFLINE');
  });

  it('6. Wi-Fi bagli ama UNVALIDATED → ONLINE DEGIL', () => {
    expect(deriveStateFromFacts(facts({ validated: false }))).toBe('DEGRADED');
    ingestConnectivityEvidence(androidEvidence({ validated: false }));
    expect(getConnectivitySnapshot().state).not.toBe('ONLINE');
  });

  it('7. validated → ONLINE', () => {
    ingestConnectivityEvidence(androidEvidence({ validated: true }));
    expect(getConnectivitySnapshot().state).toBe('ONLINE');
  });

  it('8. captive portal → ONLINE DEGIL (validated olsa BILE)', () => {
    expect(deriveStateFromFacts(facts({ captivePortal: true, validated: true })))
      .toBe('CAPTIVE');
    ingestConnectivityEvidence(androidEvidence({ captivePortal: true, validated: true }));
    expect(getConnectivitySnapshot().state).toBe('CAPTIVE');
  });

  it('9. validated null → ONLINE DEGIL', () => {
    expect(deriveStateFromFacts(facts({ validated: null }))).toBe('DEGRADED');
  });

  it('9b. INTERNET yetenegi yok → LOCAL_ONLY (yerel ag var, internet kaniti yok)', () => {
    expect(deriveStateFromFacts(facts({ hasInternetCapability: false }))).toBe('LOCAL_ONLY');
  });

  it('10. BAYAT tek-atislik kanit fail-closed (surekli kanit YASLANMAZ)', () => {
    const oneShot: ConnectivityEvidence = {
      ...androidEvidence(), continuous: false, observedAt: NOW,
    };
    expect(isEvidenceStale(oneShot, NOW + ONE_SHOT_EVIDENCE_MAX_AGE_MS)).toBe(true);
    expect(deriveConnectivitySnapshot([oneShot], NOW + ONE_SHOT_EVIDENCE_MAX_AGE_MS).state)
      .toBe('UNKNOWN');
    /* Callback tabanli kanit zamanla bayatlamaz — sabit agda olay gelmemesi normaldir. */
    const continuous = androidEvidence();
    expect(isEvidenceStale(continuous, NOW + 10 * ONE_SHOT_EVIDENCE_MAX_AGE_MS)).toBe(false);
  });

  it('11. gozlemci hatasi → ONLINE UYDURULMAZ', () => {
    /* Hic kanit gelmediyse hukum UNKNOWN kalir. */
    expect(getConnectivitySnapshot().state).toBe('UNKNOWN');
    /* Tarayici ipucu true olsa bile ONLINE URETMEZ. */
    ingestConnectivityEvidence(evidenceFromBrowserHint(true, NOW));
    expect(getConnectivitySnapshot().state).toBe('UNKNOWN');
    /* Capacitor "connected" bile en fazla DEGRADED uretir. */
    ingestConnectivityEvidence(evidenceFromCapacitorNetwork({
      connected: true, transport: 'WIFI', observedAt: NOW,
    }));
    expect(getConnectivitySnapshot().state).toBe('DEGRADED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * MULTIPLE SOURCES (12-16)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7 Coklu kaynak', () => {
  it('12. Phone Link CONNECTED TEK BASINA global ONLINE URETMEZ', () => {
    /* Phone Link kaniti dogrulanmamis bir yol bildiriyorsa ONLINE olmaz. */
    ingestConnectivityEvidence(evidenceFromFacts({
      source: 'PHONE_LINK_GATEWAY', facts: facts({ validated: null }),
      observedAt: NOW, continuous: true,
    }));
    expect(getConnectivitySnapshot().state).not.toBe('ONLINE');
  });

  it('13. Phone Link disconnect + validated Ethernet → ONLINE KALIR', () => {
    ingestConnectivityEvidence(androidEvidence({ transport: 'ETHERNET', validated: true }));
    ingestConnectivityEvidence(evidenceFromFacts({
      source: 'PHONE_LINK_GATEWAY', facts: facts({ validated: true }),
      observedAt: NOW, continuous: true,
    }));
    expect(getConnectivitySnapshot().state).toBe('ONLINE');

    /* Phone Link koptu → kaniti dustu. Ethernet hala dogrulanmis. */
    dropConnectivityEvidence('PHONE_LINK_GATEWAY', NOW + 1);
    expect(getConnectivitySnapshot().state).toBe('ONLINE');
    expect(getConnectivitySnapshot().transport).toBe('ETHERNET');
  });

  it('14. aktif yol dogrulanmisken zayif kaynak CAPTIVE iddiasi hukmu EZEMEZ', () => {
    ingestConnectivityEvidence(androidEvidence({ transport: 'ETHERNET', validated: true }));
    /* Daha dusuk guvenli bir kaynak captive dese bile aktif yol hukmu kazanir. */
    ingestConnectivityEvidence(evidenceFromCapacitorNetwork({
      connected: false, transport: 'WIFI', observedAt: NOW + 5,
    }));
    expect(getConnectivitySnapshot().state).toBe('ONLINE');
    expect(getConnectivitySnapshot().source).toBe('ANDROID_NETWORK_CALLBACK');
  });

  it('15. kaynak degisimi DETERMINISTIK — guven sirasi sabit', () => {
    expect(EVIDENCE_CONFIDENCE.ANDROID_NETWORK_CALLBACK)
      .toBeGreaterThan(EVIDENCE_CONFIDENCE.PHONE_LINK_GATEWAY);
    expect(EVIDENCE_CONFIDENCE.PHONE_LINK_GATEWAY)
      .toBeGreaterThan(EVIDENCE_CONFIDENCE.CAPACITOR_NETWORK);
    expect(EVIDENCE_CONFIDENCE.CAPACITOR_NETWORK)
      .toBeGreaterThan(EVIDENCE_CONFIDENCE.BROWSER_ONLINE_HINT);
  });

  it('16. BAYAT/ZAYIF kanit TAZE GUCLU kaniti EZMEZ', () => {
    const strongFresh = androidEvidence({ validated: true }, NOW + 100);
    const weakFresh = evidenceFromBrowserHint(false, NOW + 200);   // OFFLINE der
    expect(deriveConnectivitySnapshot([strongFresh, weakFresh], NOW + 300).state)
      .toBe('ONLINE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * POLICY (17-21)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7 Policy', () => {
  it('17. LOCAL_ONLY_OPERATION her durumda calisir (internet gerektirmez)', () => {
    for (const state of ['UNKNOWN', 'OFFLINE', 'LOCAL_ONLY', 'CAPTIVE', 'DEGRADED', 'ONLINE'] as const) {
      expect(isConnectivityAllowed('LOCAL_ONLY_OPERATION', snap({ state })), state).toBe(true);
    }
  });

  it('18. lightweight internet politikasi dogru', () => {
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', snap({ state: 'ONLINE' }))).toBe(true);
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', snap({ state: 'DEGRADED' }))).toBe(true);
    /* Belirsizlikte DENENIR (migrasyon guvenligi §37). */
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', snap({ state: 'UNKNOWN' }))).toBe(true);
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', snap({ state: 'OFFLINE' }))).toBe(false);
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', snap({ state: 'CAPTIVE' }))).toBe(false);
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', snap({ state: 'LOCAL_ONLY' }))).toBe(false);
  });

  it('19. bulk + metered true → BLOK', () => {
    const d = canUseConnectivity('BULK_TRANSFER', snap({ state: 'ONLINE', metered: true }));
    expect(d.allowed).toBe(false);
    expect(d.allowed === false && d.reason).toBe('metered_or_unknown_cost');
  });

  it('20. bulk + metered null → BLOK (UNKNOWN ucretsiz sayilmaz)', () => {
    expect(isConnectivityAllowed('BULK_TRANSFER', snap({ state: 'ONLINE', metered: null })))
      .toBe(false);
    /* Kanitsiz durumda da baslatilmaz. */
    expect(isConnectivityAllowed('BULK_TRANSFER', snap({ state: 'UNKNOWN' }))).toBe(false);
    expect(isConnectivityAllowed('BULK_TRANSFER', snap({ state: 'DEGRADED', metered: false })))
      .toBe(false);
  });

  it('21. bulk + metered false + ONLINE → IZIN', () => {
    expect(isConnectivityAllowed('BULK_TRANSFER', snap({ state: 'ONLINE', metered: false })))
      .toBe(true);
  });

  it('21b. REALTIME_STREAM kanitsiz/zayif yolda BASLATILMAZ', () => {
    expect(isConnectivityAllowed('REALTIME_STREAM', snap({ state: 'ONLINE' }))).toBe(true);
    expect(isConnectivityAllowed('REALTIME_STREAM', snap({ state: 'DEGRADED' }))).toBe(false);
    expect(isConnectivityAllowed('REALTIME_STREAM', snap({ state: 'UNKNOWN' }))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CONSUMER MIGRATION (22-27)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7 Consumer migration', () => {
  /** Migre EDILMIS tuketiciler — bunlarda dogrudan okuma KALMAMALI. */
  /* F7-A dalgasi (8 dosya). F7-B'nin TAM listesi ayri dosyadadir
     (connectivityF7B.test.ts) — bu kapi ikisini de kilitler. */
  const MIGRATED = [
    'platform/geo/cityAnchor.ts',
    'platform/geo/overpassCategorySearch.ts',
    'platform/edgeTtsService.ts',
    'platform/diagnostic/fuelAdvisorService.ts',
    'platform/communityService.ts',
    'platform/ai/semanticAiService.ts',
    'platform/aiVoiceService.ts',
    'platform/cloudSttService.ts',
  ];

  it('22. migre edilmis tuketicilerde DOGRUDAN navigator.onLine YOK', () => {
    for (const rel of MIGRATED) {
      const src = readFileSync(resolve(__dirname, '../', rel), 'utf8');
      expect(src, rel).not.toMatch(/navigator\.onLine/);
    }
  });

  it('22b. ERADICATION GUARD — production dogrudan okuma SIFIR', () => {
    /*
     * F7-B kapanisi: uretim kodunda dogrudan tarayici bayragi okuyan
     * AUTHORITY tuketicisi KALMADI. Yalnizca ACIKCA izin verilen iki sinir
     * kalabilir; baska her dosya HATA verir.
     */
    const srcRoot = resolve(__dirname, '../');
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry)) continue;
        /*
         * KOD okunur, PROZA degil (§18): yorum ve dize sabitleri yanlis pozitif
         * URETMEZ — aksi halde kurali ACIKLAYAN satir, kuralin ihlali sanilirdi.
         * Kapi "kim KARAR icin okuyor" sorusunu olcer, "kim bahsediyor"u degil.
         */
        const code = codeOf(full).replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
          .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
          .replace(/`(?:[^`\\]|\\.)*`/g, '``');
        if (code.includes('navigator.onLine')) {
          found.push(full.slice(srcRoot.length + 1).replace(/\\/g, '/'));
        }
      }
    };
    walk(srcRoot);

    /*
     * IZIN VERILEN SINIRLAR — sayi degil, ACIK LISTE (§18).
     *
     *  1. `connectivityAuthority.ts` — tarayici ipucunu KANITA ceviren TEK yer.
     *  2. `serviceWorker.ts`         — AYRI RUNTIME (§26): kendi basina
     *     derlenir (`build:sw`, lib=WebWorker) ve ServiceWorkerGlobalScope'ta
     *     kosar; uygulamanin TS singleton'ina ERISEMEZ. Zorla ayni otoriteye
     *     baglamak mumkun degildir — acik istisna olarak belgelenmistir.
     */
    const ALLOWED_BOUNDARIES = new Set([
      'platform/connectivity/connectivityAuthority.ts',
      'serviceWorker.ts',
    ]);

    /* MESRU sinir katmani GERCEKTEN duruyor (kapi bos tarama ile gecemez). */
    expect(found).toContain('platform/connectivity/connectivityAuthority.ts');

    /* Migre edilenlerin HICBIRI listede olamaz. */
    for (const rel of MIGRATED) expect(found, rel).not.toContain(rel);

    /* BUTCE SIFIR: izinli sinirlar disinda tek bir dosya bile kalamaz. */
    const unauthorized = found.filter((f) => !ALLOWED_BOUNDARIES.has(f));
    expect(unauthorized, `yetkisiz dogrudan okuma: ${unauthorized.join(', ')}`).toEqual([]);
  });

  it('23. bulut tuketicisi KANONIK policy kullaniyor', () => {
    for (const rel of ['platform/ai/semanticAiService.ts', 'platform/cloudSttService.ts',
      'platform/aiVoiceService.ts', 'platform/edgeTtsService.ts']) {
      const src = codeOf(resolve(__dirname, '../', rel));
      expect(src, rel).toMatch(/allowsConnectivity\('CLOUD_INTERACTIVE'\)/);
    }
  });

  it('24. OFFLINE navigasyon calismaya DEVAM eder', () => {
    /* F7 offline routing/map authority'sine DOKUNMADI. */
    const routing = readFileSync(resolve(__dirname, '../platform/offlineRoutingService.ts'), 'utf8');
    expect(routing).not.toMatch(/allowsConnectivity|connectivityAuthority/);
    /* Yerel is sinifi her durumda izinli. */
    expect(isConnectivityAllowed('LOCAL_ONLY_OPERATION', snap({ state: 'OFFLINE' }))).toBe(true);
  });

  it('25. local Mavi/deterministik komut offline CALISIR', () => {
    const offlineEngine = readFileSync(
      resolve(__dirname, '../platform/offlineConversationEngine.ts'), 'utf8');
    /* F7 bu yolu BLOKLAMADI (yerel deterministik motor). */
    expect(offlineEngine).not.toMatch(/allowsConnectivity\('CLOUD_INTERACTIVE'\)/);
  });

  it('26. Guest Music Portal global internet OLMADAN calisir', () => {
    /* Portal yerel ag yuzeyidir — internet gercegine BAGLI DEGILDIR. */
    for (const rel of ['platform/phoneLink/phoneLinkPortalHttp.ts',
      'platform/phoneLink/phoneLinkPortalRuntime.ts']) {
      const src = codeOf(resolve(__dirname, '../', rel));
      expect(src, rel).not.toMatch(/connectivityAuthority|allowsConnectivity/);
    }
    expect(isConnectivityAllowed('LOCAL_ONLY_OPERATION', snap({ state: 'OFFLINE' }))).toBe(true);
  });

  it('27. kanonik Music playback authority DEGISMEDI', () => {
    const gateway = readFileSync(
      resolve(__dirname, '../platform/media/authority/mediaCommandGateway.ts'), 'utf8');
    expect(gateway).not.toMatch(/connectivityAuthority|allowsConnectivity/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE (28-33)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7 Lifecycle', () => {
  it('28. SystemBoot KANONIK baslatici (LAB-gated DEGIL)', () => {
    const systemBoot = codeOf(resolve(__dirname, '../platform/system/SystemBoot.ts'));
    expect(systemBoot).toMatch(/startConnectivityAuthority\(\)/);
    /* F6.2 dersi: DINAMIK import (statik import mock'lu testleri kirardi). */
    expect(systemBoot).toMatch(/await import\('\.\.\/connectivity\/connectivityAuthority'\)/);
  });

  it('29. soguk acilis — mevcut ag anlik goruntusu tek atislik okunur (polling YOK)', () => {
    const runtime = codeOf(resolve(__dirname, '../platform/connectivity/connectivityAuthority.ts'));
    expect(runtime).toMatch(/getFacts\(\)/);
    expect(runtime).not.toMatch(/setInterval\(/);
  });

  it('30. duplicate init IDEMPOTENT', () => {
    const d1 = startConnectivityAuthority();
    const d2 = startConnectivityAuthority();
    expect(getConnectivityTelemetry().started).toBe(true);
    d2();
    expect(getConnectivityTelemetry().started).toBe(false);
    d1();   // cift sokme guvenli
    expect(getConnectivityTelemetry().started).toBe(false);
  });

  it('31. abonelik cleanup deterministik; patlayan abone digerlerini BOZMAZ', () => {
    const seen: string[] = [];
    const off = subscribeConnectivity((s) => { seen.push(s.state); });
    subscribeConnectivity(() => { throw new Error('abone patladi'); });
    const ok: string[] = [];
    subscribeConnectivity((s) => { ok.push(s.state); });

    ingestConnectivityEvidence(androidEvidence({ validated: true }));
    expect(seen).toEqual(['ONLINE']);
    expect(ok).toEqual(['ONLINE']);

    off();
    ingestConnectivityEvidence(androidEvidence({ validated: false }, NOW + 10));
    expect(seen).toEqual(['ONLINE']);            // sokulen abone CAGRILMADI
    expect(ok).toEqual(['ONLINE', 'DEGRADED']);
  });

  it('32/33. OFFLINE→ONLINE ve ONLINE→OFFLINE olaylari yayilir', () => {
    const states: string[] = [];
    subscribeConnectivity((s) => { states.push(s.state); });

    ingestConnectivityEvidence(androidEvidence({ present: false }, NOW));
    ingestConnectivityEvidence(androidEvidence({ validated: true }, NOW + 1));
    ingestConnectivityEvidence(androidEvidence({ captivePortal: true }, NOW + 2));
    ingestConnectivityEvidence(androidEvidence({ present: false }, NOW + 3));

    expect(states).toEqual(['OFFLINE', 'ONLINE', 'CAPTIVE', 'OFFLINE']);
  });

  it('33b. ag gercekleri F5 gibi tuketicilere TEK gozlemciden dagitilir', () => {
    const received: NetworkFacts[] = [];
    const off = subscribeNetworkFacts((f) => { received.push(f); });
    ingestNetworkFactsRaw({
      present: true, transport: 'WIFI', hasInternetCapability: true,
      validated: true, captivePortal: false, metered: false,
      downstreamKbps: 9_000, upstreamKbps: 1_000,
    }, NOW);
    expect(received).toHaveLength(1);
    expect(received[0].validated).toBe(true);
    expect(getConnectivitySnapshot().state).toBe('ONLINE');
    off();
    ingestNetworkFactsRaw({ present: false }, NOW + 1);
    expect(received).toHaveLength(1);           // sokulen tuketici CAGRILMADI
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SECURITY / PERFORMANCE (34-40)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7 Guvenlik ve performans', () => {
  const F7_FILES = [
    'connectivityAuthority.ts', 'connectivityPolicy.ts',
    'connectivityEvidence.ts', 'connectivityGate.ts',
  ];
  const f7Code = (file: string): string =>
    codeOf(resolve(__dirname, '../platform/connectivity/', file));

  it('34/35. radyo/hotspot enable YOK — authority network manager DEGILDIR', () => {
    for (const file of F7_FILES) {
      const src = f7Code(file);
      expect(src, file).not.toMatch(/setWifiEnabled|BluetoothAdapter|WifiManager|startTethering/);
      expect(src, file).not.toMatch(/setBluetooth|setWifi\(|enableNetwork|bindProcessToNetwork/);
      expect(src, file).not.toMatch(/VpnService|ProxyInfo|setNetworkPreference/);
    }
  });

  it('36. ping/speedtest/HTTP probe YOK', () => {
    for (const file of F7_FILES) {
      const src = f7Code(file);
      expect(src, file).not.toMatch(/fetch\(|XMLHttpRequest|speedtest|isReachable|dnsLookup/i);
    }
  });

  it('37/38. polling ve rogue timer YOK', () => {
    for (const file of F7_FILES) {
      const src = f7Code(file);
      expect(src, file).not.toMatch(/setInterval\(|setTimeout\(|requestAnimationFrame/);
    }
  });

  it('39. network ≠ identity/trust/role/capability', () => {
    for (const file of F7_FILES) {
      /* NOT: `hasInternetCapability`/`NET_CAPABILITY` AG yetenegidir ve
         yetkilendirme `Capability`siyle ILGISI YOKTUR — kapi yetkilendirme
         kavramlarini hedefler, benzer yazilan ag alanlarini degil. */
      const src = f7Code(file).replace(/hasInternetCapability|NET_CAPABILITY\w*/g, ' ');
      expect(src, file).not.toMatch(/(^|[^a-zA-Z])(identity|trust|PRIMARY|capability|grant)([^a-zA-Z]|$)|authorize\(/i);
      expect(src, file).not.toMatch(/driverAuthentication|driverPresence|deviceFingerprint/);
    }
    /* Dogrulanmis ag hicbir kimlik/rol alani URETMEZ. */
    ingestConnectivityEvidence(androidEvidence({ validated: true }));
    const keys = Object.keys(getConnectivitySnapshot());
    for (const forbidden of ['identity', 'trust', 'role', 'capability', 'fingerprint']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it('40. telemetri SSID/BSSID/IP/credential/token TASIMAZ', () => {
    ingestConnectivityEvidence(androidEvidence({ validated: true }));
    const telemetry = JSON.stringify(getConnectivityTelemetry());
    for (const secret of ['ssid', 'SSID', 'bssid', 'password', 'ipAddress', 'credential', 'token']) {
      expect(telemetry, secret).not.toContain(secret);
    }
    for (const file of F7_FILES) {
      expect(f7Code(file), file).not.toMatch(/getSSID|getBSSID|ipAddress|arabam|cebimde/i);
    }
  });

  it('40b. kalite YALNIZ OS tahmininden — olculmediyse UNKNOWN', () => {
    expect(deriveQuality(-1)).toBe('UNKNOWN');
    expect(deriveQuality(0)).toBe('UNKNOWN');
    expect(deriveQuality(500)).toBe('POOR');
    expect(deriveQuality(3_000)).toBe('USABLE');
    expect(deriveQuality(50_000)).toBe('GOOD');
  });

  it('40c. gate TEK BOOLEAN sunmaz — operasyon sinifi ZORUNLU', () => {
    const gate = f7Code('connectivityGate.ts');
    expect(gate).not.toMatch(/export function isOnline|export const isOnline/);
    /* Kapi kanonik snapshot + saf politikayi kullanir. */
    expect(gate).toMatch(/getConnectivitySnapshot\(\)/);
    expect(gate).toMatch(/canUseConnectivity\(/);
    expect(allowsConnectivity('LOCAL_ONLY_OPERATION')).toBe(true);
  });
});
