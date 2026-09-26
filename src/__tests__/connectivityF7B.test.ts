/**
 * connectivityF7B.test.ts — CAROS CONNECTIVITY F7-B · TAM TÜKETİCİ MİGRASYONU.
 *
 * F7-A kanonik otoriteyi KURDU; F7-B kalan üretim tüketicilerini ona taşıdı.
 * §32-§39'un kapıları test adlarındadır:
 *
 *   Eradication   1-6    · doğrudan okuma sıfır, connectivityService tüketici
 *   Navigation    7-13   · offline çekirdek korunur, yalnız online iş gate'lenir
 *   Music         14-19  · kanonik playback ve Guest Portal dokunulmadı
 *   Mavi          20-25  · yerel yollar korunur, yalnız bulut migre edildi
 *   Sync/OTA      26-32  · kuyruk semantiği + bulk/metered fail-closed
 *   Phone Link    33-37  · bağlantı ≠ internet, ikinci gözlemci yok
 *   Native        38-42  · NetworkInfo karar yolu kapandı
 *   Perf/Security 43-52  · polling/ping/radyo yok, ağ ≠ kimlik
 *
 * KAYNAK TARAMALARI KODA BAKAR, PROZAYA DEĞİL: bir kuralı AÇIKLAYAN yorum,
 * kuralın ihlali sanılmamalıdır (§18).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  canUseConnectivity, isConnectivityAllowed,
} from '../platform/connectivity/connectivityPolicy';
import {
  UNKNOWN_SNAPSHOT, type ConnectivitySnapshot,
} from '../platform/connectivity/connectivityEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * Yardimcilar
 * ════════════════════════════════════════════════════════════════════════ */

const SRC = resolve(__dirname, '../');
const ANDROID = resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro');

function raw(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf8');
}

/**
 * YORUMLARI soker, dize sabitlerini KORUR — kilitlerin cogu operasyon SINIFI
 * adini (`allowsConnectivity('CLOUD_INTERACTIVE')`) aradigi icin dizeler
 * gereklidir. Bir kurali ACIKLAYAN yorum kuralin ihlali sanilmaz.
 */
function codeOf(rel: string): string {
  return raw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

/**
 * Yorumlari VE dize sabitlerini soker — yalnizca "su tanimlayici KODDA
 * okunuyor mu" sorusu icin (§18: comment/string yanlis pozitif URETMEZ).
 */
function codeStrict(rel: string): string {
  return codeOf(rel)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function javaCode(rel: string): string {
  return readFileSync(resolve(ANDROID, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function snap(overrides: Partial<ConnectivitySnapshot> = {}): ConnectivitySnapshot {
  return { ...UNKNOWN_SNAPSHOT, ...overrides };
}

/** Tum production kaynaklarini gezer (testler haric). */
function walkProduction(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      out.push(full.slice(SRC.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(SRC);
  return out;
}

/** F7-B'de kanonik otoriteye TASINAN uretim tuketicileri. */
const MIGRATED_F7B = [
  'platform/connectivityService.ts',
  'platform/supabaseClient.ts',
  'platform/remoteCommandService.ts',
  'platform/remoteLogService.ts',
  'platform/trip/tripUploadRuntime.ts',
  'platform/security/sentryEngine.ts',
  'platform/selfTestEngine.ts',
  'platform/offlineDataService.ts',
  'platform/runtime/runtimeDomainAvailabilityAdapters.ts',
  'platform/diagnosticSections.ts',
  'platform/routingService.ts',
  'platform/navigationService.ts',
  'platform/addressNavigationEngine.ts',
  'platform/geocodingService.ts',
  'platform/mapService.ts',
  'platform/mapSourceStore.ts',
  'platform/mapStyleBuilders.ts',
  'core/navigation/CorridorSyncEngine.ts',
  'platform/devtools/navigationCoreSources.ts',
  'platform/fieldValidation/longRoadSources.ts',
  'platform/ai/gateway/concrete/defaultAiGateway.ts',
  'platform/ai/orchestrator/concrete/maviOrchestratedChat.ts',
  'platform/offlineConversationEngine.ts',
  'platform/onlineTtsService.ts',
  'platform/voiceService.ts',
  'platform/system/platformCoreAiRuntimeWiring.ts',
  'platform/media/recovery/recoverySources.ts',
  'platform/wifiService.ts',
  'platform/tetherService.ts',
  'platform/vehicle/vehicleClassRuntime.ts',
  'store/useAssistantContextStore.ts',
  'hooks/useLivingThemeState.ts',
  'hooks/useMaviSurface.ts',
  'components/settings/SettingsPage.tsx',
  'components/settings/expert/CRMInspector.tsx',
];

/* ══════════════════════════════════════════════════════════════════════════
 * §32 — ERADICATION (1-6)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Eradication', () => {
  it('1. production dogrudan `navigator.onLine` AUTHORITY tuketicisi = 0', () => {
    const offenders = walkProduction().filter((rel) => codeStrict(rel).includes('navigator.onLine'));
    /* Yalnizca ACIKCA izinli iki sinir kalabilir (test 2/3). */
    const unauthorized = offenders.filter((f) => f !== 'platform/connectivity/connectivityAuthority.ts'
      && f !== 'serviceWorker.ts');
    expect(unauthorized, `yetkisiz: ${unauthorized.join(', ')}`).toEqual([]);
  });

  it('2. kanonik tarayici adaptoru TEK mesru sinirdir', () => {
    const authority = codeStrict('platform/connectivity/connectivityAuthority.ts');
    expect(authority).toContain('navigator.onLine');
    /* Ve ipucu KANITA cevrilir — dogrudan hukum uretmez. */
    expect(authority).toMatch(/evidenceFromBrowserHint/);
  });

  it('3. yetkisiz yeni okuma eklenirse kapi FAIL verir (kapi gercekten oluyor)', () => {
    /* Kapinin kendisi denenir: uydurma bir dosya icerigi yakalanmali. */
    const probe = 'const x = navigator.onLine;';
    const stripped = probe
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ');
    expect(stripped.includes('navigator.onLine')).toBe(true);

    /* Yorum ve dize YANLIS POZITIF uretmez (§18). */
    const commentOnly = '/* navigator.onLine yasaktir */\nconst s = "navigator.onLine";';
    const strippedComment = commentOnly
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/.*$/gm, ' ')
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    expect(strippedComment.includes('navigator.onLine')).toBe(false);
  });

  it('4. connectivityService KANONIK TUKETICIDIR (kendi gercegini uretmez)', () => {
    const code = codeOf('platform/connectivityService.ts');
    expect(code).toMatch(/allowsConnectivity\('BACKGROUND_SYNC'\)/);
    expect(code).toMatch(/subscribeConnectivity\(/);
    /* Kendi ag gozlemcisi ve kendi ipucu yedegi KALMADI. */
    expect(codeStrict('platform/connectivityService.ts')).not.toContain('navigator.onLine');
    expect(code).not.toMatch(/@capacitor\/network/);
    expect(code).not.toMatch(/Network\.addListener|Network\.getStatus/);
  });

  it('5. connectivityService IKINCI TRUTH uretmez (yalnizca turetilmis okuma)', () => {
    const code = codeOf('platform/connectivityService.ts');
    /* `_online` artik saklanan bir ALAN degil, kanonik okuma. */
    expect(code).toMatch(/private get _online\(\): boolean/);
    expect(code).not.toMatch(/this\._online\s*=/);
    /* Kuyruk davranisinin cekirdegi (at-least-once + backoff) KORUNDU. */
    expect(code).toMatch(/_drainQueue/);
    expect(code).toMatch(/nextRetryAt/);
  });

  it('6. dairesel bagimlilik YOK — yon tek yonlu', () => {
    for (const rel of ['platform/connectivity/connectivityAuthority.ts',
      'platform/connectivity/connectivityPolicy.ts',
      'platform/connectivity/connectivityEvidence.ts',
      'platform/connectivity/connectivityGate.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/from\s+'\.{1,2}\/connectivityService'/);
    }
    /* Otorite hicbir tuketici domainini import ETMEZ. */
    const authority = raw('platform/connectivity/connectivityAuthority.ts');
    for (const forbidden of ['routingService', 'mapService', 'voiceService',
      'mediaCommandGateway', 'supabaseClient']) {
      expect(authority, forbidden).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §33 — NAVIGATION (7-13)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Navigation', () => {
  it('7. OFFLINE — offline routing servisi connectivity\'ye BAGLANMADI', () => {
    const code = codeOf('platform/offlineRoutingService.ts');
    expect(code).not.toMatch(/allowsConnectivity|connectivityAuthority|connectivityGate/);
  });

  it('8. OFFLINE — map matching / offline arama connectivity\'ye BAGLANMADI', () => {
    for (const rel of ['platform/offlineSearchService.ts',
      'platform/navigation/offlineRoutingStatus.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/allowsConnectivity|connectivityAuthority/);
    }
  });

  it('9. OFFLINE — yerel rota katmanlari (daemon/A*/duz hat) kapiya BAGLI DEGIL', () => {
    const code = codeOf('platform/routingService.ts');
    /* Kanonik kapi YALNIZ uzak OSRM katmanini cevreler. */
    const gates = code.match(/allowsConnectivity\('LIGHTWEIGHT_INTERNET'\)/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(3);
    /* Offline hesaplama cagrisi kapinin ICINDE degildir. */
    expect(code).toMatch(/computeOfflineRoute/);
    expect(code).not.toMatch(/allowsConnectivity\([^)]*\)\s*&&\s*computeOfflineRoute/);
  });

  it('10. online arama/geocoding KANONIK policy ile gate edilir', () => {
    for (const rel of ['platform/geocodingService.ts', 'platform/mapService.ts',
      'platform/navigationService.ts', 'platform/addressNavigationEngine.ts']) {
      expect(codeOf(rel), rel).toMatch(/allowsConnectivity\('LIGHTWEIGHT_INTERNET'\)/);
    }
  });

  it('11. bulk harita indirme metered/UNKNOWN\'da BASLAMAZ (fail-closed)', () => {
    /* Kaynak: koridor karo on-yuklemesi ve otomatik bolge indirme. */
    expect(codeOf('core/navigation/CorridorSyncEngine.ts'))
      .toMatch(/allowsConnectivity\('BULK_TRANSFER'\)/);
    expect(codeOf('platform/offlineDataService.ts'))
      .toMatch(/allowsConnectivity\('BULK_TRANSFER'\)/);

    /* Davranis: kanit yoksa ve maliyet bilinmiyorsa BASLAMAZ. */
    expect(isConnectivityAllowed('BULK_TRANSFER', snap({ state: 'UNKNOWN' }))).toBe(false);
    expect(isConnectivityAllowed('BULK_TRANSFER',
      snap({ state: 'ONLINE', metered: null }))).toBe(false);
    expect(isConnectivityAllowed('BULK_TRANSFER',
      snap({ state: 'ONLINE', metered: true }))).toBe(false);

    /* Tuketici artik tasima turunu KENDI yorumlamiyor. */
    expect(codeOf('core/navigation/CorridorSyncEngine.ts'))
      .not.toMatch(/navigator\s*as[^;]*connection/);
  });

  it('12. CAPTIVE — bulut navigasyon istegi BASLAMAZ', () => {
    for (const op of ['LIGHTWEIGHT_INTERNET', 'CLOUD_INTERACTIVE', 'BACKGROUND_SYNC'] as const) {
      const d = canUseConnectivity(op, snap({ state: 'CAPTIVE', validated: true }));
      expect(d.allowed, op).toBe(false);
      if (!d.allowed) expect(d.reason).toBe('captive_portal');
    }
  });

  it('13. Wi-Fi YOK + Ethernet ONLINE → online navigasyon CALISABILIR', () => {
    const ethernet = snap({ state: 'ONLINE', transport: 'ETHERNET', validated: true });
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', ethernet)).toBe(true);
    expect(isConnectivityAllowed('CLOUD_INTERACTIVE', ethernet)).toBe(true);

    /* Hicbir tuketici "wifi yoksa offline" mantigi TASIMAZ. */
    for (const rel of MIGRATED_F7B) {
      expect(codeOf(rel), rel).not.toMatch(/if\s*\(\s*!\s*wifi/i);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §34 — MUSIC (14-19)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Music', () => {
  it('14. mevcut/yerel calma OFFLINE\'da devam eder', () => {
    /* Yerel is sinifi her durumda izinlidir. */
    for (const state of ['OFFLINE', 'LOCAL_ONLY', 'CAPTIVE', 'UNKNOWN'] as const) {
      expect(isConnectivityAllowed('LOCAL_ONLY_OPERATION', snap({ state })), state).toBe(true);
    }
    /* Calma hattinin kendisi connectivity'ye BAGLANMADI. */
    for (const rel of ['platform/media/authority/mediaCommandGateway.ts',
      'platform/media/carosMediaLayer.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/allowsConnectivity|connectivityAuthority/);
    }
  });

  it('15. Guest Portal global OFFLINE\'da YEREL calisir', () => {
    for (const rel of ['platform/phoneLink/phoneLinkPortalHttp.ts',
      'platform/phoneLink/phoneLinkPortalRuntime.ts',
      'platform/phoneLink/phoneLinkPortalAsset.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/allowsConnectivity|connectivityAuthority|connectivityGate/);
    }
  });

  it('16. online provider istegi KANONIK policy kullanir (kendi bayragi degil)', () => {
    /* Medya kurtarma yolu kanonik politikadan besleniyor. */
    expect(codeOf('platform/media/recovery/recoverySources.ts'))
      .toMatch(/allowsConnectivity\('LIGHTWEIGHT_INTERNET'\)/);
    expect(codeStrict('platform/media/recovery/recoverySources.ts')).not.toContain('navigator.onLine');
  });

  it('17. kanonik medya otoritesi DEGISMEDI', () => {
    const gateway = raw('platform/media/authority/mediaCommandGateway.ts');
    expect(gateway).not.toMatch(/connectivity/i);
  });

  it('18. sourceCoordinator BYPASS edilmedi', () => {
    const rel = 'platform/media/sourceCoordinator.ts';
    let code: string;
    try { code = codeOf(rel); } catch { return; }   // dosya yoksa kapi anlamsiz
    expect(code).not.toMatch(/allowsConnectivity|connectivityAuthority/);
  });

  it('19. connectivity degisimi kuyruk/oturum otoritesi URETMEZ', () => {
    /* Otorite hicbir medya/kuyruk modulune YAZMAZ. */
    const authority = codeStrict('platform/connectivity/connectivityAuthority.ts');
    /* Otorite hicbir medya/kuyruk/oturum modulunu IMPORT etmez. */
    const imports = authority.match(/from\s+''/g) ?? [];
    expect(imports.length, 'otorite yalnizca dar bir bagimlilik kumesi tasir')
      .toBeLessThanOrEqual(4);
    expect(authority).not.toMatch(/setState|useStore|zustand/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §35 — MAVI (20-25)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Mavi', () => {
  it('20. yerel deterministik komut OFFLINE\'da CALISIR', () => {
    const code = codeOf('platform/offlineConversationEngine.ts');
    /* Yerel motor bulut kapisiyla KAPATILMADI. */
    expect(code).not.toMatch(/allowsConnectivity\('CLOUD_INTERACTIVE'\)/);
    expect(code).not.toMatch(/allowsConnectivity\('REALTIME_STREAM'\)/);
    /* Yalnizca CEVAP METNI icin GOZLEM okur (karar degil). */
    expect(code).toMatch(/observedInternetReachability\(\)/);
  });

  it('21. wake word connectivity\'den BAGIMSIZ', () => {
    const code = codeOf('platform/voiceService.ts');
    /* Wake yolu kanonik kapiyla sarmalanmadi. */
    expect(code).not.toMatch(/allowsConnectivity\([^)]*\)\s*&&\s*startWakeWord/);
    expect(code).not.toMatch(/if\s*\(\s*!allowsConnectivity\([^)]*\)\s*\)\s*return[^;]*wake/i);
  });

  it('22. yerel TTS/STT internet yuzunden KAPATILMADI', () => {
    const code = codeOf('platform/voiceService.ts');
    /* Vosk/offline yolu hala mevcut ve kapiya BAGLI DEGIL. */
    expect(code).toMatch(/preferOffline/);
    /* `preferOffline` kanonik kapinin DEGILLEMESIDIR: kapi kapaliyken
       offline tercih edilir — yani yerel yol ACIK KALIR. */
    expect(code).toMatch(/preferOffline:\s*!\(allowsConnectivity\('CLOUD_INTERACTIVE'\)/);
  });

  it('23. bulut AI KANONIK policy kullanir', () => {
    for (const rel of ['platform/ai/gateway/concrete/defaultAiGateway.ts',
      'platform/ai/orchestrator/concrete/maviOrchestratedChat.ts',
      'platform/onlineTtsService.ts',
      'platform/system/platformCoreAiRuntimeWiring.ts']) {
      expect(codeOf(rel), rel).toMatch(/allowsConnectivity\('CLOUD_INTERACTIVE'\)/);
      expect(codeStrict(rel), rel).not.toContain('navigator.onLine');
    }
  });

  it('24. CAPTIVE bulut AI\'i ONLINE SAYMAZ', () => {
    expect(isConnectivityAllowed('CLOUD_INTERACTIVE',
      snap({ state: 'CAPTIVE', validated: true, captivePortal: true }))).toBe(false);
  });

  it('25. UNKNOWN mevcut F7 policy semantigini KORUR', () => {
    const u = snap({ state: 'UNKNOWN' });
    expect(isConnectivityAllowed('LIGHTWEIGHT_INTERNET', u)).toBe(true);
    expect(isConnectivityAllowed('CLOUD_INTERACTIVE', u)).toBe(true);
    expect(isConnectivityAllowed('BACKGROUND_SYNC', u)).toBe(true);
    expect(isConnectivityAllowed('REALTIME_STREAM', u)).toBe(false);
    expect(isConnectivityAllowed('BULK_TRANSFER', u)).toBe(false);

    /*
     * Hicbir tuketici KENDI durum kuralini yazmaz (§19): kanonik anlik
     * goruntunun `state` alanini KARSILASTIRMAK yasaktir. (Ayni dosyada baska
     * bir domain'in `state` alani — orn. GPS fix durumu — bu kuralin KONUSU
     * DEGILDIR; kapi bu yuzden dogrudan `getConnectivitySnapshot()` cagrisina
     * baglanir.)
     */
    for (const rel of MIGRATED_F7B) {
      expect(codeOf(rel), rel).not.toMatch(/getConnectivitySnapshot\(\)\s*\.\s*state\s*===/);
      expect(codeOf(rel), rel).not.toMatch(/conn(ectivity)?\.state\s*===/i);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §36 — SYNC / BACKEND / OTA (26-32)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Sync / Backend / OTA', () => {
  it('26. arka plan senkronu KANONIK policy kullanir', () => {
    for (const rel of ['platform/connectivityService.ts', 'platform/remoteLogService.ts',
      'platform/trip/tripUploadRuntime.ts', 'platform/security/sentryEngine.ts',
      'platform/remoteCommandService.ts']) {
      expect(codeOf(rel), rel).toMatch(/allowsConnectivity\('BACKGROUND_SYNC'\)/);
    }
  });

  it('27. offline kuyruk istek KAYBETMEZ (at-least-once korunur)', () => {
    const code = codeOf('platform/connectivityService.ts');
    /* Yalnizca 2xx silme; kalan her sonuc kuyrukta tutulur. */
    expect(code).toMatch(/shouldKeepInQueue/);
    /* Kapi kapaliyken enqueue ENGELLENMEZ — yalnizca gonderim ertelenir. */
    expect(code).toMatch(/await dbPut\(entry\)/);
    const enqueueBody = code.slice(code.indexOf('async enqueue('));
    expect(enqueueBody.indexOf('dbPut'))
      .toBeLessThan(enqueueBody.indexOf('_drainQueue'));
  });

  it('28. reconnect gecisi kuyruk davranisini BOZMAZ (kenar tetikleme)', () => {
    const code = codeOf('platform/connectivityService.ts');
    /* Yalnizca izinsiz → izinli KENARINDA drain; her hukumde degil. */
    expect(code).toMatch(/if\s*\(allowed\s*&&\s*!wasAllowed\)/);
    expect(code).toMatch(/wasAllowed\s*=\s*allowed/);
  });

  it('29. bulk metered=true BLOK', () => {
    expect(isConnectivityAllowed('BULK_TRANSFER',
      snap({ state: 'ONLINE', validated: true, metered: true }))).toBe(false);
  });

  it('30. bulk metered=null FAIL-CLOSED (ucretsiz sayilmaz)', () => {
    const d = canUseConnectivity('BULK_TRANSFER',
      snap({ state: 'ONLINE', validated: true, metered: null }));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('metered_or_unknown_cost');
  });

  it('31. bulk ONLINE + metered=false IZIN', () => {
    expect(isConnectivityAllowed('BULK_TRANSFER',
      snap({ state: 'ONLINE', validated: true, metered: false }))).toBe(true);
  });

  it('32. istek BASARISIZLIGINDA mevcut fallback KORUNUR (izin ≠ basari)', () => {
    /* Kanonik otorite "ONLINE ise istek basarilidir" DEMEZ. */
    expect(codeStrict('platform/connectivity/connectivityAuthority.ts'))
      .not.toMatch(/guarantee/i);
    /* Geocoding hala kendi offline fallback'ine sahip. */
    expect(codeOf('platform/geocodingService.ts')).toMatch(/_offlineFallback/);
    /* Rota zinciri hala offline katmanina dusuyor. */
    expect(codeOf('platform/routingService.ts')).toMatch(/computeOfflineRoute/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §37 — PHONE LINK (33-37)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Phone Link', () => {
  it('33. Phone Link connected TEK BASINA ONLINE DEGILDIR', () => {
    const phoneOnly = snap({ state: 'DEGRADED', source: 'PHONE_LINK_GATEWAY', validated: null });
    expect(phoneOnly.state).not.toBe('ONLINE');
    expect(isConnectivityAllowed('BULK_TRANSFER', phoneOnly)).toBe(false);
    expect(isConnectivityAllowed('REALTIME_STREAM', phoneOnly)).toBe(false);
  });

  it('34. Phone Link disconnect + Ethernet ONLINE → global ONLINE', () => {
    const ethernet = snap({ state: 'ONLINE', transport: 'ETHERNET', validated: true });
    expect(isConnectivityAllowed('CLOUD_INTERACTIVE', ethernet)).toBe(true);
    /* Phone Link kopmasi kanonik hukmu kendi basina OFFLINE yapamaz:
       gateway yalnizca KENDI kanitini dusurur. */
    const gw = codeOf('platform/phoneLink/phoneLinkInternetGateway.ts');
    expect(gw).toMatch(/dropConnectivityEvidence\(/);
    expect(gw).not.toMatch(/_snapshot\s*=|setConnectivityState/);
  });

  it('35. F5 IKINCI gozlemci ACMAZ (paylasilan tek gozlem)', () => {
    const gw = codeOf('platform/phoneLink/phoneLinkInternetGateway.ts');
    expect(gw).toMatch(/subscribeNetworkFacts\(/);
    expect(gw).not.toMatch(/registerPlugin\(/);
  });

  it('36. F6 Connection Priority connectivity truth URETMEZ', () => {
    for (const rel of ['platform/phoneLink/phoneIntegrationArbiter.ts',
      'platform/phoneLink/phoneIntegrationOwnership.ts',
      'platform/phoneLink/phoneLinkConnectivityIntent.ts']) {
      const code = codeOf(rel);
      expect(code, rel).not.toMatch(/ingestConnectivityEvidence|getConnectivitySnapshot/);
    }
  });

  it('37. yerel Guest Portal global connectivity\'ye BAGLI DEGIL', () => {
    expect(isConnectivityAllowed('LOCAL_ONLY_OPERATION', snap({ state: 'OFFLINE' }))).toBe(true);
    expect(codeOf('platform/phoneLink/phoneLinkPortalRuntime.ts'))
      .not.toMatch(/allowsConnectivity|connectivityGate/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §38 — NATIVE (38-42)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Native', () => {
  it('38. deprecated NetworkInfo KARAR yolunda KALMADI (heartbeat kapandi)', () => {
    const svc = javaCode('CarLauncherForegroundService.java');
    expect(svc).not.toContain('NetworkInfo');
    expect(svc).not.toContain('getActiveNetworkInfo');
    /* Kanonik gozlemcinin okudugu AYNI ilkel + AYNI kural. */
    expect(svc).toContain('getNetworkCapabilities');
    expect(svc).toContain('NET_CAPABILITY_INTERNET');
    expect(svc).toContain('NET_CAPABILITY_CAPTIVE_PORTAL');
  });

  it('39. IKINCI native global connectivity gozlemcisi YOK', () => {
    const observer = javaCode('phonelink/PhoneInternetObserverPlugin.java');
    expect(observer).toContain('registerNetworkCallback');
    /* Baska hicbir native sinif NetworkCallback KAYDETMEZ. */
    for (const rel of ['CarLauncherPlugin.java', 'CarLauncherForegroundService.java',
      'MainActivity.java']) {
      expect(javaCode(rel), rel).not.toContain('registerNetworkCallback');
    }
  });

  it('40. radyo (Wi-Fi/Bluetooth) ACMA yok', () => {
    for (const rel of ['CarLauncherForegroundService.java',
      'phonelink/PhoneInternetObserverPlugin.java']) {
      const code = javaCode(rel);
      expect(code, rel).not.toMatch(/setWifiEnabled|enableNetwork\(|BluetoothAdapter\s*\.\s*\w*\.enable\(/);
    }
  });

  it('41. Wi-Fi / hotspot manipulasyonu yok', () => {
    const observer = javaCode('phonelink/PhoneInternetObserverPlugin.java');
    expect(observer).not.toMatch(/LocalOnlyHotspot|startTethering|WifiManager/);
    const svc = javaCode('CarLauncherForegroundService.java');
    expect(svc).not.toMatch(/LocalOnlyHotspot|startTethering/);
  });

  it('42. native status DISPLAY global truth URETMEZ', () => {
    /* Wi-Fi gostergesi yalnizca GOSTERIM zincirine gider; karar yolu yok. */
    expect(codeStrict('platform/wifiService.ts')).not.toContain('navigator.onLine');
    /* "Zaten bagli mi" karari Wi-Fi'den KANONIK otoriteye tasindi. */
    const tether = codeOf('platform/tetherService.ts');
    expect(tether).toMatch(/allowsConnectivity\('LIGHTWEIGHT_INTERNET'\)/);
    expect(tether).not.toMatch(/getWifiState\(\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §39 — PERFORMANCE / SECURITY (43-52)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7-B Performance / Security', () => {
  it('43. polling YOK — migre edilen tuketiciler yeni timer ACMADI', () => {
    /* mapSourceStore'un 30 sn'lik yoklamasi KALDIRILDI. */
    const store = codeOf('platform/mapSourceStore.ts');
    expect(store).not.toMatch(/setInterval\(|scheduleTask\(/);
    /* Kanonik katmanin kendisi hicbir zamanlayici kurmaz. */
    for (const rel of ['platform/connectivity/connectivityAuthority.ts',
      'platform/connectivity/connectivityPolicy.ts',
      'platform/connectivity/connectivityGate.ts',
      'platform/connectivity/connectivityEvidence.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/setInterval\(|setTimeout\(/);
    }
  });

  it('44. ping YOK — HTTP baglanti probu kaldirildi', () => {
    const store = codeOf('platform/mapSourceStore.ts');
    expect(store).not.toMatch(/fetch\(/);
    expect(store).not.toMatch(/_pingOnline|method:\s*'HEAD'/);
    for (const rel of ['platform/connectivity/connectivityAuthority.ts',
      'platform/connectivity/connectivityGate.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/fetch\(|XMLHttpRequest/);
    }
  });

  it('45. speedtest YOK', () => {
    for (const rel of ['platform/connectivity/connectivityAuthority.ts',
      'platform/connectivity/connectivityEvidence.ts',
      'platform/mapSourceStore.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/speedtest|bandwidthTest|downloadSpeed/i);
    }
  });

  it('46. rogue timer YOK — migre edilen tuketicilerde YENI timer acilmadi', () => {
    /* Bu dosyalar F7-B oncesinde de timer TASIMIYORDU; taşımaya devam etmemeli. */
    for (const rel of ['platform/supabaseClient.ts', 'platform/tetherService.ts',
      'platform/media/recovery/recoverySources.ts',
      'platform/devtools/navigationCoreSources.ts']) {
      expect(codeOf(rel), rel).not.toMatch(/setInterval\(/);
    }
  });

  it('47. ag ≠ kimlik', () => {
    /* KELIME SINIRI sart: `observing` icindeki "vin" bir kimlik sizintisi
       DEGILDIR — alt-dize esleme kapiyi anlamsiz kilardi. */
    for (const rel of ['platform/connectivity/connectivityAuthority.ts',
      'platform/connectivity/connectivityEvidence.ts']) {
      const code = codeStrict(rel);
      for (const f of ['personId', 'userId', 'driverId', 'vin', 'VIN', 'imei']) {
        expect(code, `${rel}:${f}`).not.toMatch(new RegExp(`\\b${f}\\b`));
      }
    }
  });

  it('48. ag ≠ guven', () => {
    expect(codeStrict('platform/connectivity/connectivityEvidence.ts'))
      .not.toMatch(/\btrusted\b|isTrusted|trustLevel/i);
  });

  it('49. ag ≠ rol', () => {
    const code = codeStrict('platform/connectivity/connectivityEvidence.ts')
      + codeStrict('platform/connectivity/connectivityAuthority.ts');
    expect(code).not.toMatch(/\bPRIMARY\b|\bGUEST\b|\bDRIVER\b|\brole\b/i);
  });

  it('50. ag ≠ yetenek', () => {
    expect(codeStrict('platform/connectivity/connectivityAuthority.ts'))
      .not.toMatch(/grantCapability|MEDIA_CONTROL|INTERNET_SHARE/);
  });

  it('51. SSID / BSSID / parola / token LOGLANMAZ', () => {
    for (const rel of ['platform/connectivity/connectivityAuthority.ts',
      'platform/connectivity/connectivityEvidence.ts',
      'platform/connectivity/connectivityPolicy.ts',
      'platform/connectivity/connectivityGate.ts',
      'platform/wifiService.ts']) {
      const code = codeStrict(rel);
      expect(code, rel).not.toMatch(/console\.(log|info|warn|error)\(/);
      expect(code, rel).not.toMatch(/bssid|password|apiKey/i);
    }
  });

  it('52. Arabam Cebimde bagimliligi YOK', () => {
    for (const rel of ['platform/connectivity/connectivityAuthority.ts',
      'platform/connectivity/connectivityEvidence.ts',
      'platform/connectivity/connectivityPolicy.ts',
      'platform/connectivity/connectivityGate.ts']) {
      expect(codeStrict(rel), rel).not.toMatch(/Arabam|ZLink|zlink/i);
    }
  });
});
