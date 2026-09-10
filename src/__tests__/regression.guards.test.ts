/**
 * REGRESYON KASASI (2026-06-13) — "Yasa".
 *
 * Bu dosya, defalarca bozulup tekrar düzelttiğimiz davranışları KİLİTLER.
 * Biri (insan veya AI) bu düzeltmeleri bozan bir değişiklik yaparsa
 * `npm run test` KIRMIZI yanar → APK çıkmadan yakalanır.
 *
 * İki tür kilit:
 *  1) Davranış testi   — saf fonksiyon / store davranışı (en sağlam).
 *  2) Yapısal değişmez — kaynak/CSS deseninin varlığı (gömülü mantık için;
 *     desen geri alınırsa test düşer). Her birinin NEDEN'i yorumda.
 */
/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

/* Kaynak-metin kilitleri için içeriği runtime `readFileSync` yerine Vite `?raw`
   ile TRANSFORM anında gömüyoruz. Sebep: full-suite paralel koşuda `read()`
   commandExecutor.ts'i nadiren eksik görüp "İki router ayrışması" kilidini
   yanlışlıkla düşürüyordu (izole hep geçiyordu). `?raw` içeriği build-time'da
   sabitler → runtime fs yarışına/mock'a/kısmi okumaya PROVABLY bağışık. */
import commandExecutorSrc from '../platform/commandExecutor.ts?raw';
import addressNavCardSrc from '../components/common/AddressNavCard.tsx?raw';
import expeditionLayoutSrc from '../components/themes/ExpeditionLayout.tsx?raw';
import mapLayerManagerSrc from '../platform/map/MapLayerManager.ts?raw';
import mapInteractionManagerSrc from '../platform/map/MapInteractionManager.ts?raw';
import mapStateSrc from '../platform/map/_mapState.ts?raw';
import mapCoreSrc from '../platform/map/MapCore.ts?raw';
import { evaluateFpsThermalLatch, FPS_LOW_CONFIRM_SAMPLES, FPS_LOW_THRESHOLD } from '../platform/map/core/fpsThermalLatchModel';
import { resolveRouteEmphasis } from '../platform/map/core/routeEmphasisModel';
import proLayoutSrc from '../components/themes/ProLayout.tsx?raw';
import teslaLayoutSrc from '../components/themes/TeslaLayout.tsx?raw';
import volumeGestureLayerSrc from '../components/common/VolumeGestureLayer.tsx?raw';
import companionChatProviderSrc from '../platform/companion/companionChatProvider.ts?raw';
/* MAVI-F2 · I11 kilidi — ACK politikası + F0 iz sözlüğü (voiceService zaten yukarıda). */
import maviAckPolicySrc from '../platform/assistant/maviAckPolicy.ts?raw';
import maviLatencyTraceSrc from '../platform/assistant/maviLatencyTrace.ts?raw';
/* MAVI-F3 · I11 komşusu — kısmi transkript EYLEM YETKİSİ taşımamalı. */
import sttPartialStreamSrc from '../platform/voice/sttPartialStream.ts?raw';
import semanticEndpointerSrc from '../platform/voice/semanticEndpointer.ts?raw';
/* MAVI-F4 · akış cevabı — ham token konuşulmaz, yapısal çıktı seslendirilmez. */
import streamSayExtractorSrc from '../platform/voice/streamSayExtractor.ts?raw';
import speechChunkerSrc from '../platform/voice/speechChunker.ts?raw';
import maviSpeechStreamSrc from '../platform/voice/maviSpeechStream.ts?raw';
import maviResponseStreamSrc from '../platform/voice/maviResponseStream.ts?raw';
import ttsServiceSrc from '../platform/ttsService.ts?raw';

/* MAVI-F5 · Capability Fabric — kontrollü giriş kapısı; ikinci yürütücü/otorite YOK. */
import { brainIntentAllowlist } from '../platform/capability/fabric/carosCapabilityCatalog';
import capabilityFabricSrc from '../platform/capability/fabric/capabilityFabric.ts?raw';
import capabilityContractSrc from '../platform/capability/fabric/capabilityContract.ts?raw';
import capabilityResolverSrc from '../platform/capability/fabric/capabilityResolver.ts?raw';
import carosCapabilityCatalogSrc from '../platform/capability/fabric/carosCapabilityCatalog.ts?raw';


import vehicleResolverSrc from '../platform/vehicleDataLayer/VehicleSignalResolver.ts?raw';
import visionCoreSrc from '../platform/vision/visionCore.ts?raw';
import offlineRoutingSrc from '../platform/offlineRoutingService.ts?raw';
import deviceCapabilitiesSrc from '../platform/deviceCapabilities.ts?raw';
import pushServiceSrc from '../platform/pushService.ts?raw';
import commandListenerSrc from '../platform/commandListener.ts?raw';
import fcmServiceSrc from '../platform/fcmService.ts?raw';
import wakeWordServiceSrc from '../platform/wakeWordService.ts?raw';
import navGpsPowerBridgeSrc from '../platform/navigation/navGpsPowerBridge.ts?raw';
import backgroundPowerGateSrc from '../platform/power/backgroundPowerGate.ts?raw';
import commandListenerSrcNav from '../platform/commandListener.ts?raw';
import handoffGateSrc from '../platform/navigation/destinationHandoff.ts?raw';
import obdServiceSrc from '../platform/obdService.ts?raw';
import blackBoxServiceSrc from '../platform/security/blackBoxService.ts?raw';
import systemBootSrc from '../platform/system/SystemBoot.ts?raw';
import obdHealthMonitorSrc from '../platform/obd/ObdHealthMonitor.ts?raw';
import diagnosticEvidenceSrc from '../platform/aiCore/runtime/diagnosticEvidence.ts?raw';
import navSessionRuntimeSrc from '../platform/navigation/navigationSessionRuntime.ts?raw';
import freshnessPolicySrc from '../platform/freshnessPolicy.ts?raw';
import vehicleAssumptionsSrc from '../platform/vehicleAssumptions.ts?raw';
import tripLogServiceSrc from '../platform/tripLogService.ts?raw';
import routingServiceSrc from '../platform/routingService.ts?raw';
import roleStoreSrc from '../platform/roleSystem/RoleStore.ts?raw';
import mainLayoutSrc from '../components/layout/MainLayout.tsx?raw';
import mediaScreenSrc from '../components/media/MediaScreen.tsx?raw';
import voiceAssistantSrc from '../components/modals/VoiceAssistant.tsx?raw';
import voiceServiceSrc from '../platform/voiceService.ts?raw';
import cloudSttServiceSrc from '../platform/cloudSttService.ts?raw';
import vehicleComputeWorkerSrc from '../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw';
import vehicleEventHubSrc from '../platform/vehicleDataLayer/VehicleEventHub.ts?raw';
import systemOrchestratorSrc from '../platform/system/SystemOrchestrator.ts?raw';
import healthMonitorSrc from '../platform/system/SystemHealthMonitor.ts?raw';
import orientationGateSrc from '../platform/sensors/orientationSensorGate.ts?raw';
import remoteLogServiceSrc from '../platform/remoteLogService.ts?raw';
import diagnosticTriageSrc from '../platform/diagnosticTriage.ts?raw';
import dtcServiceSrc from '../platform/dtcService.ts?raw';
import gpsServiceSrc from '../platform/gpsService.ts?raw';
import unifiedVehicleStoreSrc from '../platform/vehicleDataLayer/UnifiedVehicleStore.ts?raw';
import odometerGuardSrc from '../platform/vehicleDataLayer/OdometerGuard.ts?raw';
import navigationHudSrc from '../components/map/NavigationHUD.tsx?raw';
import mapSearchBarSrc from '../components/map/MapSearchBar.tsx?raw';
import newHomeLayoutSrc from '../components/layout/NewHomeLayout.tsx?raw';
import addressNavEngineSrc from '../platform/addressNavigationEngine.ts?raw';
import geocodingServiceSrc from '../platform/geocodingService.ts?raw';
import geocodingProvidersSrc from '../platform/geocodingProviders.ts?raw';
import mapServiceSrc from '../platform/mapService.ts?raw';
import mapHudControlsSrc from '../components/map/MapHudControls.tsx?raw';
import speedLimitServiceSrc from '../platform/speedLimitService.ts?raw';
import speedLimitCardSrc from '../components/map/SpeedLimitCard.tsx?raw';
import effectiveLimitAuthoritySrc from '../platform/navigation/core/vehicleAwareSpeedLimitAuthority.ts?raw';
import turkeyPolicySrc from '../platform/navigation/policy/turkeySpeedPolicy.ts?raw';
import navigationServiceSrc from '../platform/navigationService.ts?raw';
import etaModelSrc from '../platform/navigation/core/etaModel.ts?raw';
import fullMapViewSrc from '../components/map/FullMapView.tsx?raw';
import useLayoutServicesSrc from '../hooks/useLayoutServices.ts?raw';
import useDenseHudSrc from '../hooks/useDenseHud.ts?raw';
import modeControllerSrc from '../platform/modeController.ts?raw';
import visionOverlaySrc from '../components/map/VisionOverlay.tsx?raw';
import sensitiveKeyStoreSrc from '../platform/sensitiveKeyStore.ts?raw';
/* S1 (#503) kilidi DAVRANIŞ testidir — kaynak-metin kilidi tek başına yetmez.
   `extendedPidService` bağımlılıkları hafiftir (Capacitor + nativePlugin + saf registry)
   ve `isNativePlatform()` test ortamında false olduğu için native'e hiçbir şey gitmez;
   bu yüzden bu dosyanın "mock kullanma" karakteri BOZULMADAN import edilebilir. */
import {
  _internals as extPidInternals, watchPid, seedSupportedPids, notifyObdConnected,
} from '../platform/obd/extendedPidService';
import { AdaptiveRuntimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { forceMode } from './sim/runtimeSimulator';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
/** Kaynak-metin kilitleri için yorumları siyırır — docblock bir KULLANIM değildir. */
function stripSrc(src: string): string {
  const block = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const line  = new RegExp('//[^\\n]*', 'g');
  return src.replace(block, ' ').replace(line, ' ');
}

/** Bir klasör altındaki tüm .tsx dosyalarını (özyinelemeli) toplar. */
function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) walkTsx(rel, acc);
    else if (e.name.endsWith('.tsx')) acc.push(rel);
  }
  return acc;
}

/* ───────────────────────────────────────────────────────────────
   1. BUKALEMUN EKRAN UYUMU — ChameleonScaler ölçek matematiği
   Regresyon: ekran adaptasyonu defalarca bozuldu (boşluk/taşma).
   ─────────────────────────────────────────────────────────────── */
describe('ChameleonScaler ölçek matematiği (ekran adaptasyonu kilidi)', () => {
  // Dinamik import: bileşen DOM'a dokunmadan saf fonksiyonu alır.
  it('head unit (~1024×600) → ölçek ≈ 1.0 (dokunma yok)', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    expect(computeChameleonScale(1024, 600)).toBeCloseTo(1.0, 2);
  });
  it('kısa/geniş telefon (986×444) → küçülür (<1) ki dikey taşma olmasın', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    const s = computeChameleonScale(986, 444);
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThanOrEqual(0.55);
  });
  it('büyük tablet (1280×800) → büyür (>1) ama ≤ 1.6', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    const s = computeChameleonScale(1280, 800);
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThanOrEqual(1.6);
  });
  it('uç değerler kısıtlı: çok küçük ≥0.55, çok büyük ≤1.6, geçersiz → 1', async () => {
    const { computeChameleonScale } = await import('../components/layout/ChameleonScaler');
    expect(computeChameleonScale(200, 150)).toBeGreaterThanOrEqual(0.55);
    expect(computeChameleonScale(4000, 3000)).toBeLessThanOrEqual(1.6);
    expect(computeChameleonScale(0, 0)).toBe(1);
    expect(computeChameleonScale(NaN, 600)).toBe(1);
  });
  it('YAPISAL: ChameleonScaler yalnız NewHomeLayout sarmalı (güvenlik overlay\'leri ölçek DIŞI)', () => {
    const src = read('src/components/layout/MainLayout.tsx');
    expect(src).toMatch(/<ChameleonScaler>[\s\S]*<NewHomeLayout/);
  });
  it('YAPISAL: zoom KULLANILMAZ (tutarsızdı); transform: scale kullanılır', () => {
    const src = read('src/components/layout/ChameleonScaler.tsx');
    expect(src).toMatch(/transform:\s*`scale/);
    expect(src).not.toMatch(/\.zoom\s*=/);
  });
});

/* ───────────────────────────────────────────────────────────────
   2. TEMA GEÇERLİLİĞİ — setTheme render edilemeyen temayı normalize eder
   Regresyon: sesli "tema değiştir" silinmiş/yetim temayı (sunlight/mercedes)
   açıyordu → fallback layout.
   ─────────────────────────────────────────────────────────────── */
describe('setTheme normalizasyonu (geçersiz tema açılamaz kilidi)', () => {
  beforeEach(() => {
    // her testte bilinen geçerli temaya dön
    // (store DOM'a dokunur; jsdom'da güvenli)
  });
  it('sunlight → pro (sunlight render edilemez)', async () => {
    const { useCarTheme } = await import('../store/useCarTheme');
    useCarTheme.getState().setTheme('sunlight');
    expect(useCarTheme.getState().theme).toBe('pro');
  });
  it('kaldırılan temalar (mercedes/audi/cockpit) → expedition', async () => {
    const { useCarTheme } = await import('../store/useCarTheme');
    for (const dead of ['mercedes', 'audi', 'cockpit']) {
      useCarTheme.getState().setTheme(dead as never);
      expect(useCarTheme.getState().theme).toBe('expedition');
    }
  });
  it('geçerli temalar KORUNUR (tesla / expedition-day / horizon)', async () => {
    const { useCarTheme } = await import('../store/useCarTheme');
    for (const ok of ['tesla', 'expedition-day', 'horizon'] as const) {
      useCarTheme.getState().setTheme(ok);
      expect(useCarTheme.getState().theme).toBe(ok);
    }
  });
  it('YAPISAL: sesli tema cycle listesi sunlight İÇERMEZ', () => {
    const src = read('src/hooks/useVoiceCommandHandler.ts');
    const m = src.match(/_THEME_CYCLE[^=]*=\s*\[([^\]]*)\]/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toMatch(/sunlight/);
  });
});

/* ───────────────────────────────────────────────────────────────
   3. SAAT GÜN/GECE — kanonik kaynak (data-day-night), ayrışma yok
   Regresyon: dock saati gündüz temada koyu kalıyordu (settings.dayNightMode
   ile data-day-night ayrışması).
   ─────────────────────────────────────────────────────────────── */
describe('Saat gün/gece kanonik kaynak kilidi', () => {
  it('YAPISAL: 3 tema da pal\'i useDayNightAttr (data-day-night) ile türetir', () => {
    for (const f of ['TeslaLayout', 'ExpeditionLayout', 'HorizonLayout']) {
      const src = read(`src/components/themes/${f}.tsx`);
      expect(src, `${f} useDayNightAttr kullanmalı`).toMatch(/useDayNightAttr\(\)/);
      // settings.dayNightMode'a geri dönülmemeli (ayrışma kaynağı)
      expect(src, `${f} pal için settings.dayNightMode kullanmamalı`)
        .not.toMatch(/dayNightMode\s*=\s*useStore\(s => s\.settings\.dayNightMode\)[\s\S]{0,80}\?\s*(SAND|DAY|DAY_H)/);
    }
  });
  it('YAPISAL: saat etrafındaki SİYAH DİKDÖRTGEN — sunlight border muafiyeti var', () => {
    const css = read('src/index.css');
    // .sunlight-mode button[aria-label="Saat — Menü"] { border: none }
    expect(css).toMatch(/aria-label="Saat — Menü"[\s\S]{0,120}border:\s*none/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4. SESLİ ROTA — kendi haritamız (harici Google Maps DEĞİL)
   Regresyon: "rota oluştur" AI yolunda harici nav app açıyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Sesli navigasyon uygulama-içi kilidi', () => {
  it('YAPISAL: commandExecutor OPEN_NAVIGATION harici bridge.launchNavigation kullanmaz', () => {
    const src = read('src/platform/commandExecutor.ts');
    const block = src.slice(src.indexOf("case 'OPEN_NAVIGATION'"), src.indexOf("case 'OPEN_NAVIGATION'") + 220);
    expect(block).toMatch(/ctx\.launch\(/);
    expect(block).not.toMatch(/bridge\.launchNavigation/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4b. WiFi/Bluetooth — DOĞRUDAN toggle (ekran açma değil)
   Regresyon: "bluetooth aç" sistem ekranını açıyordu; doğrudan açmalı.
   ─────────────────────────────────────────────────────────────── */
/* ───────────────────────────────────────────────────────────────
   4a-bis. Sesli müzik araması — ÖNCE gömülü oynatıcı kilidi
   Regresyon (2026-06-21): "X'ten müzik aç" gömülü YouTube/Spotify oynatıcı
   yerine harici uygulamaya → kurulu değilse Play Store'a düşüyordu. Sesli
   müzik araması ÖNCE playByQuery (uygulama-içi) denemeli; dış uygulama SON ÇARE.
   ─────────────────────────────────────────────────────────────── */
describe('Sesli müzik araması uygulama-içi kilidi', () => {
  it('YAPISAL: PLAY_MUSIC_SEARCH harici launchMusicSearch\'ten ÖNCE gömülü oynatıcıyı dener', () => {
    const src = read('src/platform/commandExecutor.ts');
    const i = src.indexOf("case 'PLAY_MUSIC_SEARCH'");
    const block = src.slice(i, i + 400);
    // Gömülü-önce çağrısı, harici fallback'ten önce gelmeli.
    const embedIdx = block.indexOf('_playMusicInAppOrFallback');
    const extIdx   = block.indexOf('bridge.launchMusicSearch');
    expect(embedIdx, 'PLAY_MUSIC_SEARCH gömülü oynatıcıyı (_playMusicInAppOrFallback) çağırmalı').toBeGreaterThanOrEqual(0);
    expect(extIdx).toBeGreaterThanOrEqual(0);
    expect(embedIdx, 'gömülü deneme harici launch\'tan ÖNCE olmalı').toBeLessThan(extIdx);
  });

  /* MUSIC F9'da YENİDEN BAĞLANDI (kaldırılmadı): korunan değişmez aynıdır —
     "sesli müzik araması ÖNCE uygulama-içi kanonik yolu dener, olmazsa harici
     uygulamaya düşer". Değişen tek şey uygulama-içi yolun ADIdır: `playByQuery`
     yerine kanonik niyet yönlendiricisi (`dispatchMusicIntent`), çünkü eski yol
     sonucu KANITSIZ "çalınıyor" cümlesine çeviriyordu. */
  it('YAPISAL: _playMusicInAppOrFallback kanonik yolu dener, başarısızsa fallback() çağırır', () => {
    const src = read('src/platform/commandExecutor.ts');
    const i = src.indexOf('async function _playMusicInAppOrFallback');
    const end = src.indexOf('/** Anlık DTC', i);
    const fn = src.slice(i, end > i ? end : i + 2400);
    expect(fn.length, 'fonksiyon gövdesi okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(300);
    expect(fn, 'uygulama-içi kanonik yol kaldırılmış').toMatch(/dispatchMusicIntent/);
    expect(fn, 'harici uygulamaya düşme yolu kaldırılmış').toMatch(/fallback\(\)/);
    /* Kanıtsız başarı cümlesi geri gelmemeli. Yorumlar SOYULUR: tarihsel
       anlatım ("eskiden çalınıyor deniyordu") kilidi düşürmemeli. */
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code, 'sahte "çalınıyor" iddiası geri gelmiş').not.toMatch(/çalınıyor/);
  });
});

describe('WiFi/Bluetooth doğrudan toggle kilidi', () => {
  it('YAPISAL: applyVoiceSetting setWifi/setBluetooth (doğrudan) dener, salt panel açmaz', () => {
    const src = read('src/hooks/useVoiceCommandHandler.ts');
    expect(src).toMatch(/CarLauncher\.setWifi/);
    expect(src).toMatch(/CarLauncher\.setBluetooth/);
  });
  it('YAPISAL: native plugin setWifi + setBluetooth metodları var', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(java).toMatch(/public void setWifi\(/);
    expect(java).toMatch(/public void setBluetooth\(/);
    expect(java).toMatch(/setWifiEnabled/);
  });
  it('YAPISAL: CHANGE_WIFI_STATE izni manifest\'te', () => {
    const mf = read('android/app/src/main/AndroidManifest.xml');
    expect(mf).toMatch(/CHANGE_WIFI_STATE/);
  });

  // Regresyon (2026-06-13): ONLINE'ken "wifi aç"/"bluetooth aç" Gemini "Single
  // Brain"e gidiyordu; semantik sözlükte toggle intent OLMADIĞI için en yakın
  // OPEN_SETTINGS'e düşüp UYGULAMA AYARLARINI açıyordu. Toggle'lar artık kritik
  // refleks komut → tam-güven yerel eşleşmede beyni atlar, donanım anında açılır.
  it('YAPISAL: voiceService kritik-bypass listesi toggle_wifi + toggle_bluetooth içerir', () => {
    const src = read('src/platform/voiceService.ts');
    const m = src.match(/CRITICAL_VOICE_TYPES\s*=\s*new Set<[^>]*>\(\[([\s\S]*?)\]\)/);
    expect(m, 'CRITICAL_VOICE_TYPES seti bulunamadı').toBeTruthy();
    expect(m![1]).toMatch(/'toggle_wifi'/);
    expect(m![1]).toMatch(/'toggle_bluetooth'/);
  });

  it('DAVRANIŞ: "bluetooth aç"/"wifi aç" donanım komutu + TAM güven (1.0) ki beyni atlasın', async () => {
    const { parseCommandFull } = await import('../platform/commandParser');
    // matchVoiceSetting ön-kontrolü bunları set_setting(wifi/bluetooth) yapar;
    // donanım refleksi olduğundan confidence 1.0 OLMALI (kritik-bypass koşulu).
    for (const [q, key] of [['bluetooth aç', 'bluetooth'], ['wifi aç', 'wifi']] as const) {
      const c = parseCommandFull(q).command;
      const k = c?.type === 'set_setting' ? c?.extra?.settingKey : undefined;
      // ya dedik~toggle_* tipi ya da set_setting(wifi/bluetooth) — her iki yol da kabul
      const isHw = (c?.type === 'toggle_wifi' || c?.type === 'toggle_bluetooth') || k === key;
      expect(isHw, `${q} donanım toggle komutu olmalı (oldu: ${c?.type}/${k})`).toBe(true);
      expect(c?.confidence, `${q} tam güven (1.0) olmalı ki Gemini'yi atlasın`).toBeGreaterThanOrEqual(1.0);
    }
  });
});

/* ───────────────────────────────────────────────────────────────
   4c. SESLİ ASİSTAN TTS SENKRONU — kendi sesiyle çakışma + UI durum
   Regresyon riski: (a) dinlemeye geçince asistan kendi sesini kesmiyordu;
   (b) sohbet cevabı sabit 3.5s timer ile idle'a dönüyordu (UI gerçek konuşma
   süresiyle ayrışıyordu); (c) DTC bağlamı any[] idi.
   ─────────────────────────────────────────────────────────────── */
describe('Sesli asistan TTS senkronu kilidi', () => {
  const vs = () => read('src/platform/voiceService.ts');

  it('YAPISAL: startListening ilk iş olarak ttsCancel() çağırır (kendi sesini kes)', () => {
    const src = vs();
    /* İmport kilidi SIRA/UZUNLUK BAĞIMSIZ: gerçek değişmez "ttsCancel `ttsService`'ten
       import edilmiş"tir — import listesindeki konumu değil. Eski desen ttsCancel'ı
       listenin SON elemanı sayıyordu (`ttsCancel\s*\}`) ve `isTtsSpeaking` eklenince
       davranış bozulmadığı hâlde düştü. Kilit ZAYIFLAMADI: aşağıdaki çağrı kontrolü
       (startListening ilk iş olarak ttsCancel()) aynen duruyor. */
    expect(src).toMatch(/import\s*\{[^}]*\bttsCancel\b[^}]*\}\s*from\s*'\.\/ttsService'/);
    /* PENCERE SABİT KARAKTER SAYISI DEĞİL, GÖVDE SINIRIDIR (MAVI-F3): eski kilit
       `+1300` karakterlik bir pencereye bakıyordu ve gövdeye satır eklendiğinde
       (davranış bozulmadığı hâlde) düşüyordu. Kilit ZAYIFLAMADI, GÜÇLENDİ: artık
       `ttsCancel()` gövdede BULUNMAKLA kalmayıp mikrofonu açan çağrıdan ÖNCE
       geldiği de doğrulanıyor — asıl değişmez budur (kendi sesini kesmeden dinleme
       başlamaz). */
    const start = src.indexOf('export function startListening');
    expect(start, 'startListening bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    const fn = src.slice(start);
    const cancelIdx = fn.indexOf('ttsCancel()');
    const micIdx = fn.indexOf('CarLauncher.startSpeechRecognition');
    expect(cancelIdx, 'ttsCancel() çağrısı yok').toBeGreaterThan(-1);
    expect(micIdx).toBeGreaterThan(cancelIdx);
  });

  it('YAPISAL: _dispatchConversation sabit setTimeout(idle) İÇERMEZ; TTS bitişine bağlı', () => {
    const src = vs();
    const start = src.indexOf('function _dispatchConversation');
    const fn = src.slice(start, src.indexOf('\n}', start));
    expect(fn).not.toMatch(/setTimeout/);          // 3.5s sabit timer kaldırıldı
    /* MAVI-F13/2'de YENİDEN BAĞLANDI: idle penceresi
       `voice/voiceConversationRuntime`e taşındı (baştaki `_` düştü). Kilit
       kaldırılmadı — üstelik pencereyi KURAN fonksiyonun gerçekten var olduğu
       da artık doğrulanır (eskiden yalnız çağrı adına bakıyordu). */
    expect(fn).toMatch(/armConvIdleOnTtsEnd/);     // idle artık TTS-end yolundan
    expect(read('src/platform/voice/voiceConversationRuntime.ts'))
      .toMatch(/export function armConvIdleOnTtsEnd\(/);
  });

  it('YAPISAL: native warmup BAŞLARKEN status listening basılır (görsel geri bildirim)', () => {
    const src = vs();
    const b = src.slice(src.indexOf('if (warmupMs > 0)'), src.indexOf('_nativeSttWarmupTimer = setTimeout'));
    expect(b).toMatch(/push\(\{ status: 'listening'/);
  });

  it('YAPISAL: VehicleContext.activeDTCCodes DTCCode[] (any[] değil)', () => {
    const ai = read('src/platform/aiVoiceService.ts');
    expect(ai).toMatch(/activeDTCCodes\?:\s*DTCCode\[\]/);
    expect(ai).not.toMatch(/activeDTCCodes\?:\s*any\[\]/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4d. PANEL TEMA UYUMU — hardcoded renk yasağı (--oem-* semantik katman)
   Regresyon: paneller (OBD/trip/sport) sabit Tailwind renkleri (red/amber/
   blue/emerald) + bg-white/border-white kullanıp temadan kopuyordu. Artık
   yalnız --oem-* token'ları (accent/danger/warn/good/info, line, surface).
   ─────────────────────────────────────────────────────────────── */
describe('Panel tema uyumu — hardcoded renk yasağı kilidi', () => {
  const PANELS = [
    'src/components/layout/DrawerShell.tsx',
    'src/components/obd/DTCPanel.tsx',
    'src/components/obd/MaintenancePanel.tsx',
    'src/components/sport/SportModePanel.tsx',
    'src/components/trip/TripLogView.tsx',
  ];
  // Sabit Tailwind palet class'ları + beyaz overlay (nötr slate/gray HARİÇ — tema-dışı değil).
  const HARDCODED = /bg-white\/|border-white\/|text-white\/\d|(?:bg|text|border|from|to|via)-(?:blue|purple|amber|red|green|cyan|yellow|orange|emerald|sky|indigo|rose)-\d/;

  it.each(PANELS)('YAPISAL: %s sabit Tailwind renk/beyaz-overlay İÇERMEZ', (p) => {
    const m = read(p).match(HARDCODED);
    expect(m, m ? `hardcoded renk bulundu: "${m[0]}"` : '').toBeNull();
  });

  it('YAPISAL: paneller legacy --accent-primary/--accent DEĞİL --oem-* kullanır', () => {
    for (const p of PANELS) {
      const src = read(p);
      expect(src, `${p} legacy --accent-primary kullanmamalı`).not.toMatch(/var\(--accent-primary\)/);
      expect(src, `${p} legacy --accent kullanmamalı`).not.toMatch(/var\(--accent\)/);
    }
  });

  it('YAPISAL: DrawerShell üst hairline aksanı --oem-accent\'e bağlı', () => {
    const src = read('src/components/layout/DrawerShell.tsx');
    expect(src).toMatch(/linear-gradient\([^)]*var\(--oem-accent\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4e. CSS var() className OLARAK YAZILAMAZ — tema migrasyonu kilidi
   Regresyon (2026-06-13): paneller className="... var(--panel-bg-secondary)
   ..." gibi CSS var() fonksiyonunu Tailwind class adı sanıp koyuyordu.
   Tarayıcı bunu GEÇERSİZ class adı olarak sessizce düşürüyordu → şerit/panel
   zeminsiz kalıp light-ui gündüz modunda koyu-üstüne-koyu / okunamaz oluyordu.
   Doğru kullanım: inline style={{ background:'var(--..)' }} VEYA Tailwind
   arbitrary value text-[color:var(--..)] (köşeli parantez içinde).
   ─────────────────────────────────────────────────────────────── */
describe('CSS var() className antipattern yasağı kilidi', () => {
  // className="..." / className='...' içeriğinde köşeli parantez DIŞINDA var( geçişi.
  // Geçerli: text-[color:var(--x)]  → '[' ile sarılı, eşleşmez.
  // Yasak:   className="px-3 var(--panel-bg-secondary)" → çıplak var( eşleşir.
  const BARE_VAR_IN_CLASSNAME =
    /className=("(?:[^"]*)"|'(?:[^']*)')/g;

  const files = walkTsx('src/components');

  it('hiçbir komponentte className içinde çıplak var(--…) yok (köşeli parantez hariç)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      let m: RegExpExecArray | null;
      const re = new RegExp(BARE_VAR_IN_CLASSNAME);
      while ((m = re.exec(src))) {
        const val = m[1].slice(1, -1); // tırnakları soy
        // köşeli parantez içindeki var()'ları maskele, kalanda var( ara
        const masked = val.replace(/\[[^\]]*\]/g, '');
        if (/\bvar\(/.test(masked)) offenders.push(`${f}: ${val.slice(0, 80)}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('YAPISAL: base.css savunma fallback\'i yerinde (eski APK\'larda geçmiş bug için)', () => {
    const css = read('src/styles/base.css');
    expect(css).toMatch(/\[class\*="var\(--panel-bg-secondary\)"\]/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4f. ANAHTAR YOK YÖNLENDİRMESİ — AI/internet isteği anahtarsızken
   Regresyon (2026-06-13): anahtar yokken "haberleri özetle"/"bilmece sor"
   gibi YALNIZ yapay zekayla yanıtlanan istekler sessiz "anlaşılamadı"ya
   düşüyordu; dahası yerel parser bunlara sahte komut (vehicle_status@0.82)
   üretip yanlış ekran açıyordu. Artık anahtarsızken kullanıcı ayarlardan
   Gemini/Claude Haiku anahtarı eklemeye yönlendirilir.
   ─────────────────────────────────────────────────────────────── */
describe('Anahtar yok yönlendirmesi kilidi', () => {
  const vs = () => read('src/platform/voiceService.ts');

  it('YAPISAL: anahtarsız AI isteği yönlendirmesi var (Gemini + Claude Haiku + ayarlar)', () => {
    const src = vs();
    /* MAVI-F13/2'de YENİDEN BAĞLANDI: sezginin TANIMI `voice/voiceCommandPolicy`e
       taşındı (baştaki `_` düştü), ÇAĞRI YERİ `voiceService`te kaldı. Kilit
       kaldırılmadı — tanımın gerçekten var olduğu da artık doğrulanır. */
    expect(read('src/platform/voice/voiceCommandPolicy.ts'))
      .toMatch(/export function looksLikeAiRequest\(/);
    expect(src).toMatch(/looksLikeAiRequest/);
    expect(src).toMatch(/chain\.length === 0 && looksLikeAiRequest/);  // koşul: zincirde HİÇ anahtar YOK
    expect(src).toMatch(/Gemini ya da Claude Haiku/);                   // her iki sağlayıcı önerilir
    expect(src).toMatch(/ai_key_missing_hint/);                         // tanı rotası
  });

  it('YAPISAL: yönlendirme AUTO-DISPATCH ve GEMINI FIRST\'ten ÖNCE (sahte komut öne geçmesin)', () => {
    const src = vs();
    const hintIdx = src.indexOf('looksLikeAiRequest(trimmed)');
    const geminiFirstIdx = src.indexOf('2. GEMINI FIRST');
    const autoDispatchIdx = src.indexOf('Yüksek güven yerel komut');
    expect(hintIdx).toBeGreaterThan(0);
    expect(hintIdx).toBeLessThan(geminiFirstIdx);                       // beyin bloğundan önce
    expect(hintIdx).toBeLessThan(autoDispatchIdx);                     // yerel auto-dispatch'ten önce
  });

  it('YAPISAL: exact (1.0) gerçek komutlar korunur — yönlendirme yalnız <1.0\'da', () => {
    const src = vs();
    expect(src).toMatch(/looksLikeAiRequest\(trimmed\) && \(result\.command\?\.confidence \?\? 0\) < 1\.0/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4g. İKİ ROUTER AYRIŞMASI — companion beyni üreten her intent'i
   commandExecutor.dispatchIntent İŞLEMELİ.
   Regresyon (2026-06-13): "asistan yapıyorum diyor ama köşede Komut Hatası".
   Kök neden: Gemini beyni SEARCH_POI/CYCLE_THEME üretiyordu ama dispatchIntent
   switch'inde case YOKTU → feedback söylenip default→_error("Anlayamadım")→
   "Komut Hatası". routeIntent (yerel yol) işliyordu → online hata/offline çalışır.
   Kilit: BRAIN_INTENTS'in HER üyesi dispatchIntent'te case olarak bulunmalı.
   ─────────────────────────────────────────────────────────────── */
describe('İki router ayrışması kilidi — beyin intent\'leri executor\'da işlenir', () => {
  it('YAPISAL: BRAIN_INTENTS\'in her üyesi commandExecutor.dispatchIntent\'te case', () => {
    const brainSrc = companionChatProviderSrc;
    const execSrc  = commandExecutorSrc;
    // BRAIN_INTENTS = new Set<string>([ '...', '...' ])
    /* MAVI-F5: liste ELLE YAZILMIYOR, capability kataloğundan TÜRETİLİYOR.
       Kaynak metnini kazıyan eski ölçüm türetmeye geçince BOŞ dizi döndürür ve
       kilit sessizce körleşirdi ("hiç intent yok → hiçbiri eksik değil").
       Bu yüzden GERÇEK allowlist çağrılır — kapsam AYNI, kilit daha güçlü. */
    void brainSrc;
    const intents = [...brainIntentAllowlist()];
    expect(intents.length).toBeGreaterThan(10);
    const missing = intents.filter((i) => !new RegExp(`case '${i}'`).test(execSrc));
    expect(missing, `dispatchIntent şu beyin intent'lerini KAÇIRIYOR (Komut Hatası riski): ${missing.join(', ')}`).toEqual([]);
  });

  it('DAVRANIŞ: SEARCH_POI ve CYCLE_THEME executor\'da işlenir (hata vermez)', () => {
    const execSrc = commandExecutorSrc;
    expect(execSrc).toMatch(/case 'SEARCH_POI'/);
    expect(execSrc).toMatch(/case 'CYCLE_THEME'/);
  });
});

/* ───────────────────────────────────────────────────────────────
   4b. GROUNDING HATASI DEVRE KESİCİYİ ÇİFT SAYMAZ — "iki istekte offline"
   Regresyon (SAHA 2026-07-04): web/güncel-bilgi sorusunda beyin KARAR çağrısı
   BAŞARILI olsa bile (recordAiNetSuccess, sayaç=0), grounding (google_search)
   timeout'u recordAiNetFailure'ı İKİ yerde sayıyordu — askGroundedGemini catch
   + dıştaki web dalı sawFailure→recordAiNetFailure (satır sonu). 0→1→2 ve
   aiHealth FAIL_THRESHOLD=2 → devre 90sn açılıp TÜM AI offline'a kilitleniyordu.
   Kullanıcı: "iki istekten sonra offline'a düşüyor, kota değil". Grounding =
   yardımcı canlı-veri çağrısı; BEYİN ağ kesicisine yazılmamalı → yalnız
   _groundingCooldownUntil (Tavily'ye düş). Bu iki kilit çift-sayımı önler.
   ─────────────────────────────────────────────────────────────── */
describe('Grounding hatası beyin devre kesicisini tetiklemez kilidi', () => {
  const src = companionChatProviderSrc;

  it('YAPISAL: askGroundedGemini catch recordAiNetFailure ÇAĞIRMAZ (grounding cooldown\'a düşer)', () => {
    const fn = src.match(/async function askGroundedGemini\([\s\S]*?\n\}/);
    expect(fn, 'askGroundedGemini bulunamadı').toBeTruthy();
    expect(fn![0], 'grounding hatası recordAiNetFailure() ile BEYİN kesicisine yazılıyor (çift sayım → iki istekte offline)').not.toMatch(/recordAiNetFailure\s*\(/);
    /* MAVI-F13/3: pencere değişkeni `companionProviderHealth`e taşındı; kilit
       DEĞİŞKEN ADINA değil DAVRANIŞA bağlanır — grounding hatası BEYİNDEN AYRI
       kendi penceresini kurmalı. Defterin ayrık-pencere davranış kilidi:
       voiceRuntimeSeparation `F13/3-8`. */
    expect(fn![0], 'grounding hatası kendi penceresini kurmalı (Tavily yedeği)').toMatch(/noteGroundingRateLimited\s*\(/);
    expect(fn![0], 'grounding hatası BEYİN kota penceresini kuruyor (çapraz kirlenme)').not.toMatch(/noteProviderRateLimited\s*\(/);
  });

  it('YAPISAL: web dalı grounding+Tavily boşunda sawFailure SET ETMEZ (beyin başarılıydı)', () => {
    const web = src.match(/if \(result\.kind === 'web'\)\s*\{[\s\S]*?\n\s*continue;/);
    expect(web, 'web dalı (result.kind === \'web\') bulunamadı').toBeTruthy();
    expect(web![0], 'web dalı grounding miss\'inde sawFailure=true → breaker çift sayımı geri geldi (iki istekte offline)').not.toMatch(/sawFailure\s*=\s*true/);
  });

  it('YAPISAL: sağlayıcı hatası (HTTP-yanıtlı 429/4xx/parse) devre kesiciyi TETİKLEMEZ', () => {
    // SAHA 2026-07-04 ("internetim var ama offline sanıyor"): zincirde sağlayıcı
    // null döndüğünde (429 kota / 400 / bozuk JSON — hepsi HTTP yanıtı almış = AĞ
    // CANLI) sawFailure=true yazılıp recordAiNetFailure'a sayılıyordu → 2 cümlede
    // breaker 90sn TÜM asistanı (STT dahil) offline'a kilitliyordu. Kural: kesici
    // YALNIZ gerçek throw'da (timeout/DNS/kopma) artar → sawNetFailure yalnız
    // catch bloklarında set edilir.
    // 2026-07-24 GÜNCELLEME: kesiciye artık hata TÜRÜ de taşınır (bütçe timeout'u
    // gerçek ulaşılamazlıktan ayrı ve yüksek eşikte sayılır — aiHealth). Kilidin
    // ASIL amacı DEĞİŞMEDİ: sağlayıcı-null'ları (HTTP yanıtlı) kesiciye YAZILMAZ.
    expect(src, 'sawNetFailure ayrımı kaldırılmış (sağlayıcı hatası yine ağ hatası sayılıyor olabilir)').toMatch(/if \(sawNetFailure && !sawHttpResponse\) \{/);
    expect(src, 'kesici çağrısı sawHttpResponse kapısının DIŞINA çıkmış').toMatch(/recordAiNetFailure\(\{ provider: netFailureProvider, exceptionType: netFailureKind \?\? 'unknown' \}\)/);
    expect(src, 'kesiciye hata türü taşınmıyor — bütçe timeout\'u yine gerçek ağ ölümü gibi sayılır (2 komutta 90sn offline)').toMatch(/recordAiNetFailure\(\{ provider: netFailureProvider, exceptionType: netFailureKind \?\? 'unknown' \}\)/);
    const assignments = [...src.matchAll(/sawNetFailure = true/g)];
    expect(assignments.length, 'sawNetFailure set eden yol yok — throw yolu kesiciye hiç sayılmıyor').toBeGreaterThanOrEqual(2);
    // Her set GERÇEK ağ ölümü kanıtına bağlı olmalı. İki kabul edilebilir kanıt:
    //   (a) `noteNetFailure(e)` yardımcısı → YALNIZ catch bloklarından çağrılır
    //       (aşağıda ayrıca kilitlenir); fetch THROW etti (timeout/DNS/kopma)
    //   (b) `if (gw.netFailure)`   → AI Gateway hattı; gateway ASLA throw etmez,
    //       gerçek ağ ölümü tipli `netFailure` bayrağıyla taşınır (aşağıdaki
    //       kilit bu bayrağın YALNIZ network/timeout için doğru olmasını zorlar).
    // Not: imza (parametre listesi) değişebilir — kilit YAPIYA bakar, imzaya değil.
    const inHelper   = [...src.matchAll(/const noteNetFailure = \([^)]*\): void => \{\s*sawNetFailure = true/g)];
    const viaNetFlag = [...src.matchAll(/if \(gw\.netFailure\) \{ sawNetFailure = true/g)];
    expect(inHelper.length + viaNetFlag.length,
      'sawNetFailure = true GERÇEK ağ ölümü kanıtı olmadan set ediliyor (noteNetFailure yardımcısı veya gw.netFailure dışında) → HTTP-yanıtlı sağlayıcı hatası yine "internet yok" sayılır',
    ).toBe(assignments.length);
    // noteNetFailure YALNIZ catch'ten çağrılabilir — normal (throw'suz) bir yoldan
    // çağrılırsa sağlayıcı-null'ları yine kesiciye sızar.
    const noteCalls = [...src.matchAll(/noteNetFailure\(e[,)]/g)];
    const noteInCatch = [...src.matchAll(/catch \(e\) \{[^}]*noteNetFailure\(e[,)]/g)];
    expect(noteInCatch.length, 'noteNetFailure(e) catch DIŞINDAN çağrılıyor — throw kanıtı olmadan kesiciye sayım').toBe(noteCalls.length);
    // Eski isim geri gelmesin (null-yollarında sayan desen)
    expect(src, 'eski sawFailure deseni geri gelmiş').not.toMatch(/\bsawFailure\b/);
  });

  it('YAPISAL: AI Gateway köprüsü YALNIZ network/timeout\'u gerçek ağ ölümü sayar', () => {
    // Yukarıdaki kilidin (b) şıkkının dayanağı: `gw.netFailure` bayrağı gateway
    // köprüsünde üretilir. Köprü 429/4xx/5xx/parse/anahtar/çevrimdışı gibi
    // "sunucudan yanıt geldi / yerel kapı" hatalarını da netFailure sayarsa
    // devre kesici yine yanlış tetiklenir (SAHA 2026-07-04 hatası geri gelir).
    const bridgeSrc = read('src/platform/ai/gateway/gatewayChatBridge.ts');
    const kinds = bridgeSrc.match(/NET_DEATH_KINDS[^=]*=\s*\[([^\]]*)\]/);
    expect(kinds, 'NET_DEATH_KINDS bulunamadı — köprünün kesici semantiği kaybolmuş').toBeTruthy();
    const list = kinds![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(list.sort(), 'gateway köprüsü network/timeout DIŞINDA bir hatayı da ağ ölümü sayıyor').toEqual(['network', 'timeout']);
    expect(bridgeSrc, 'köprü doğrudan recordAiNetFailure çağırıyor (kesici sayımı çift olur)').not.toMatch(/recordAiNetFailure\s*\(/);
  });

  it('YAPISAL: repairMusicQuery catch BEYİN kesicisini BESLEMEZ (mikro-bütçe timeout ≠ ağ ölümü)', () => {
    // SAHA 2026-07-04 ("ilk istek online, sonrakiler offline"): 1.8sn mikro-bütçeli
    // OPSİYONEL onarım çağrısının timeout'u recordAiNetFailure'a sayılıyordu →
    // iki müzik komutu üst üste = FAIL_THRESHOLD(2) = breaker 90sn TÜM asistanı kapattı.
    const fn = src.match(/export async function repairMusicQuery\([\s\S]*?\n\}/);
    expect(fn, 'repairMusicQuery bulunamadı').toBeTruthy();
    expect(fn![0], 'repairMusicQuery hatası recordAiNetFailure() ile BEYİN kesicisine yazılıyor (iki müzik komutu → 90sn offline)').not.toMatch(/recordAiNetFailure\s*\(/);
  });

  it('YAPISAL: bütçe timeout\'u kesicide AYRI ve YÜKSEK eşikte sayılır (yavaş ≠ ölü)', () => {
    // SAHA 2026-07-24 ("sohbet ederken bir süre sonra offline'a düşüyor"):
    // tryCompanionBrain'in KENDİ süre bütçesi (sürüşte 4.5sn) dolduğunda atılan
    // AbortError, gerçek ağ ölümüyle AYNI ağırlıkta sayılıyordu. Gemini soğuk
    // başlangıçta ~7sn döndüğünden neredeyse her komut bütçeyi aşıyor → 2 komutta
    // devre açılıp asistanı (STT dahil) 90sn kapatıyordu.
    const healthSrc = read('src/platform/aiHealth.ts');
    expect(healthSrc, 'TIMEOUT_FAIL_THRESHOLD kaldırılmış — bütçe timeout\'u yine 2 hatada offline yapar').toMatch(/TIMEOUT_FAIL_THRESHOLD\s*=\s*(\d+)/);
    const hard = healthSrc.match(/const FAIL_THRESHOLD\s*=\s*(\d+)/);
    const soft = healthSrc.match(/const TIMEOUT_FAIL_THRESHOLD\s*=\s*(\d+)/);
    expect(hard, 'FAIL_THRESHOLD bulunamadı').toBeTruthy();
    expect(Number(soft![1]), 'timeout eşiği gerçek-ulaşılamazlık eşiğinden BÜYÜK olmalı (tek tük yavaş cevap asistanı kilitlememeli)').toBeGreaterThan(Number(hard![1]));
    // Ayrı sayaç şart: ortak sayaçta timeout yine sert eşiği doldurur.
    expect(healthSrc, '_consecTimeouts ayrı sayacı kaldırılmış — timeout yine sert kovada sayılıyor').toMatch(/_consecTimeouts/);
    // Yarı-açık + başarı YOLLARI her iki sayacı da sıfırlamalı (ratchet yasağı).
    const settle = healthSrc.match(/function _settle\([\s\S]*?\n\}/);
    expect(settle![0], 'soğuma dolunca _consecTimeouts sıfırlanmıyor → timeout ratchet\'i geri geldi').toMatch(/_consecTimeouts\s*=\s*0/);
    const success = healthSrc.match(/export function recordAiNetSuccess\([\s\S]*?\n\}/);
    expect(success![0], 'başarı _consecTimeouts\'u sıfırlamıyor').toMatch(/_consecTimeouts\s*=\s*0/);
  });

  it('YAPISAL: turda HTTP yanıtı varsa CORS/opaque TypeError ağ ölümü SAYILMAZ', () => {
    // SAHA 2026-07-24, CANLI CİHAZDA CDP ile YAKALANDI: `api.anthropic.com`
    // tarayıcıdan çağrılınca CORS başlığı gelmediği için fetch **TypeError:
    // Failed to fetch** atıyor → errorKindFromException zorunlu olarak 'network'
    // → SERT kova → 2 turda 90sn offline. Yakalanan iz: aynı turda openrouter 404
    // + gemini 400 + gemini 429 + groq 429 HTTP yanıtları geldi (ağ APAÇIK CANLI),
    // ardından tek anthropic TypeError'ı OFFLINE_REASON:NETWORK_UNREACHABLE
    // tetikledi; 10sn sonra groq 200 döndü. Kural: HTTP yanıtı = ağ canlı KANITI.
    expect(src, 'sawHttpResponse kanıtı kaldırılmış — tek CORS hatası yine tüm asistanı 90sn offline yapar').toMatch(/let sawHttpResponse = false/);
    // Kanıt YALNIZ gerçek sunucu yanıtından gelmeli (yerel kapı hataları değil).
    // ⚠️ KARA LİSTE olmalı: ilk denemede BEYAZ liste kullanılmış ve `invalid_request`
    // (OpenRouter 404 · Gemini 400) listede olmadığı için sahte offline CİHAZDA
    // DEVAM ETMİŞTİ. Beyaz liste her yeni hata sınıfında sessizce eksik kalır.
    expect(src, 'NO_NET_EVIDENCE_KINDS kaldırılmış — "ağ canlı" kanıtı sınıflandırması kayboldu').toMatch(/NO_NET_EVIDENCE_KINDS/);
    expect(src, 'beyaz listeye geri dönülmüş (HTTP_ANSWERED_KINDS) — yeni hata sınıfı yine sahte offline üretir').not.toMatch(/HTTP_ANSWERED_KINDS/);
    const kinds = src.match(/const NO_NET_EVIDENCE_KINDS[^=]*=\s*new Set\(\[([^\]]*)\]/);
    expect(kinds, 'NO_NET_EVIDENCE_KINDS tanımı bulunamadı').toBeTruthy();
    const list = kinds![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    expect(list, 'ağ hakkında kanıt taşımayan sınıf listesi değişmiş — sunucu-yanıtlı bir sınıf (429/4xx/5xx/parse) yanlışlıkla buraya girerse sahte offline geri gelir').toEqual(
      ['aborted', 'circuit_open', 'network', 'no_api_key', 'no_provider', 'offline', 'timeout'],
    );
    // invalid_request MUTLAKA kanıt sayılmalı — cihazda sahte offline'ı sürdüren tam bu sınıftı.
    expect(list, 'invalid_request "ağ kanıtı değil" sayılıyor — OpenRouter 404 / Gemini 400 yine 90sn offline yapar').not.toContain('invalid_request');
    // Gemini dalında throw ile HTTP-yanıt ayrımı korunmalı.
    expect(src, 'gemini dalında threw ayrımı yok — throw ile HTTP yanıtı karışır').toMatch(/if \(!threw\) sawHttpResponse = true/);
  });

  it('YAPISAL+DAVRANIŞ: cevap uzunluğu park halinde SABİT 300 karakter/220 token ile kesilmez', async () => {
    const shapingSrc = read('src/platform/companion/companionAnswerShaping.ts');
    // SAHA 2026-07-24 ("uzun anlatımlar yarıda kesiliyor"): İKİ ayrı tavan vardı.
    // (1) maxOutputTokens=220 → cihazda ÖLÇÜLDÜ: `finishReason=MAX_TOKENS`, metin
    //     "…5. İç Anadolu Bölgesi:" diye CÜMLE ORTASINDA bitiyor (bazen metin BOŞ);
    //     1200 token ile aynı soru `finishReason=STOP` + 970-1058 karakter TAM cevap.
    // (2) Metin ayrıca 300 karakterde kırpılıyordu (`flat.slice(0,297)+'...'`) →
    //     token açılsa bile cevap üçte birine iniyordu.
    // SÜRÜŞ tavanları KORUNUR (ISO 15008 dikkat bütçesi) — kilit yalnız PARK'ı savunur.
    /* MAVI-F13/3'te YENİDEN BAĞLANDI ve **DAVRANIŞ KİLİDİNE GÜÇLENDİ**:
       bütçe/tavan tanımları `companion/companionAnswerShaping`e taşındı. Kilit
       artık kaynak metnini regex ile AYRIŞTIRMIYOR — GERÇEK nesneleri okuyor ve
       GERÇEK kırpma fonksiyonunu çalıştırıyor. Kaynak biçimi değişse bile kilit
       anlamını korur; sabit 300 kırpması geri gelirse davranış testi düşer. */
    const shape = await import('../platform/companion/companionAnswerShaping');
    expect(shapingSrc, 'sabit 297 karakter kırpması geri gelmiş — park halinde uzun anlatım yine üçte birine iner')
      .not.toMatch(/slice\(0,\s*297\)/);
    // Park bütçeleri sürüş bütçelerinden belirgin BÜYÜK olmalı.
    const pairs = Object.values(shape.ANSWER_TOKENS);
    expect(pairs.length, 'ANSWER_TOKENS içinde driving/parked çifti yok').toBeGreaterThanOrEqual(4);
    for (const b of pairs) {
      expect(b.parked, `park token bütçesi (${b.parked}) uzun anlatıma yetmiyor — MAX_TOKENS ile yarıda keser`).toBeGreaterThanOrEqual(800);
      expect(b.parked).toBeGreaterThan(b.driving);
    }
    expect(shape.ANSWER_CHAR_LIMIT.driving, 'sürüş karakter tavanı gevşetilmiş — dikkat bütçesi (ISO 15008) ihlali').toBeLessThanOrEqual(400);
    expect(shape.ANSWER_CHAR_LIMIT.parked, 'park karakter tavanı hâlâ düşük — uzun anlatım kırpılır').toBeGreaterThanOrEqual(1500);
    /* DAVRANIŞ: ~1200 karakterlik bir anlatım PARK halinde kırpılmamalı,
       SÜRÜŞTE kırpılmalı. Bu, kusurun ta kendisinin testidir. */
    const long = 'Bu uzun bir anlatim cumlesidir. '.repeat(40).trim();
    expect(long.length).toBeGreaterThan(900);
    expect(shape.trimForSpeech(long, false).length,
      'park halinde uzun anlatım yine kırpılıyor').toBeGreaterThan(900);
    expect(shape.trimForSpeech(long, true).length,
      'sürüşte dikkat bütçesi uygulanmıyor').toBeLessThanOrEqual(300);
    /* Beyin JSON yolu da bağlama duyarlı tavanı KULLANMALI (en kritik yol).
       MAVI-F13/4: ayrıştırıcı `companionBrainParser`e taşındı — kilit SİLİNMEDİ,
       yeni sahibine bağlandı ve DAVRANIŞLA güçlendirildi (aşağıda). */
    const brainParser = read('src/platform/companion/companionBrainParser.ts');
    expect(brainParser, 'parseBrainJson bağlam almıyor — beyin cevabı yine sabit tavanla kırpılır').toMatch(/function parseBrainJson\(raw: string, isDriving/);
    expect(brainParser, 'beyin cevabı trimForSpeech\'ten geçmiyor').toMatch(/response: trimForSpeech\(obj\.say, isDriving\)/);
    expect(src, 'sağlayıcı ayrıştırıcıyı kullanmıyor — kilit körleşti').toContain('parseBrainJson(');
  });

  it('YAPISAL: Gemini model adı URL\'e GÖMÜLMEZ + model zinciri korunur', () => {
    // SAHA 2026-07-24 (cihazda gerçek anahtarla ölçüldü): model adı 4 AYRI dosyada
    // URL'e gömülüydü (`.../models/gemini-flash-latest:generateContent`). O model
    // kullanıcının anahtarında 429 (kota dolu) verirken AYNI anahtarla
    // `gemini-2.5-flash` 200 dönüyordu → asistan sebepsiz susuyor, her tur
    // companion_offline'a düşüyordu. Kota MODEL-BAZLIDIR: tek modele bağlı kalmak
    // tek arıza noktasıdır.
    for (const f of [
      'src/platform/companion/companionChatProvider.ts',
      'src/platform/aiVoiceService.ts',
      'src/platform/ai/semanticAiService.ts',
      'src/platform/cloudSttService.ts',
    ]) {
      expect(read(f), `${f}: Gemini model adı yine URL'e gömülmüş — model emekliye ayrılınca/kotası dolunca sessiz arıza olur`)
        .not.toMatch(/generativelanguage\.googleapis\.com\/v1beta\/models\/[a-z0-9.-]+:generateContent/);
    }
    const models = read('src/platform/ai/gateway/models.ts');
    expect(models, 'GEMINI_MODEL_CHAIN kaldırılmış — tek model = tek arıza noktası').toMatch(/GEMINI_MODEL_CHAIN/);
    const chain = models.match(/GEMINI_MODEL_CHAIN[^=]*=\s*\[([^\]]*)\]/);
    expect(chain, 'GEMINI_MODEL_CHAIN tanımı bulunamadı').toBeTruthy();
    const entries = chain![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(entries.length, 'model zinciri 2\'den kısa — kota dolunca yedek model kalmaz').toBeGreaterThanOrEqual(2);
    // Kota/emeklilik/yoğunluk → sıradaki model (sağlayıcıyı komple susturma).
    const prov = read('src/platform/companion/companionChatProvider.ts');
    const adv = prov.match(/function _advanceGeminiModel\([\s\S]*?\n\}/);
    expect(adv, '_advanceGeminiModel bulunamadı — model failover kaldırılmış').toBeTruthy();
    for (const st of ['429', '404', '503']) {
      expect(adv![0], `${st} model failover'ı tetiklemiyor`).toContain(st);
    }
    expect(prov, 'beyin çağrısında model failover döngüsü yok — 429\'da hemen soğumaya düşer').toMatch(/while \(!resp\.ok && _advanceGeminiModel\(resp\.status\)\)/);
    expect(prov, 'model değişimi sessiz — sahada "neden başka model?" kanıtsız kalır').toMatch(/GEMINI_MODEL_SWITCH/);
  });

  it('YAPISAL: emniyet zamanlayıcıları TTS konuşurken cevabı KESMEZ', () => {
    // SAHA 2026-07-24 ("uzun muhabbetlerde cümlenin ortasında kesilip dut sesiyle
    // dinlemeye geçiyor"): takip (20sn) ve sohbet-idle (15sn) emniyet pencereleri
    // konuşmanın bitip bitmediğini SORMUYOR, sabit süreyle varsayıyordu. ~250
    // karakteri aşan her cevapta pencere doluyor, startListening() → ttsCancel()
    // cevabı ortadan kesiyordu.
    /* MAVI-F13/2'de YENİDEN BAĞLANDI ve GÜÇLENDİ: iki emniyet penceresi
       `voice/voiceConversationRuntime`e taşındı ve "hâlâ konuşuyor mu" sorusunu
       artık PORT üzerinden soruyor. Bu, kilide YENİ bir körlük riski ekler:
       port bağlanmazsa `P.speaking()` daima `false` döner ve pencere yine
       cevabı ortadan keserdi. Kilit bu yüzden ARTIK İKİ ucu birden doğrular. */
    const vs = read('src/platform/voiceService.ts');
    const conv = read('src/platform/voice/voiceConversationRuntime.ts');
    expect(vs, 'voiceService isTtsSpeaking\'i import etmiyor — emniyet zamanlayıcıları yine kör').toMatch(/isTtsSpeaking/);
    expect(vs, 'isTtsSpeaking portu sohbet runtime\'ına BAĞLANMAMIŞ — pencere yine kör')
      .toContain('isTtsSpeaking:    () => isTtsSpeaking()');
    expect(conv, 'runtime konuşma portunu OKUMUYOR').toMatch(/speaking:[\s\S]{0,140}isTtsSpeaking\(\)/);
    for (const [fn, label] of [
      ['_scheduleFollowUpFallback', 'takip dinlemesi'],
      ['_scheduleConvIdleFallback', 'sohbet-idle'],
    ] as const) {
      const body = conv.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
      expect(body, `${fn} bulunamadı — kilit körleşti`).toBeTruthy();
      expect(body![0], `${label} penceresi konuşma sürerken uzatmıyor → uzun cevap yine ortadan kesilir`).toMatch(/P\.speaking\(\)/);
      expect(body![0], `${label} penceresi SINIRSIZ uzuyor — takılı TTS motorunda emniyet rolü kaybolur`).toMatch(/MAX_SPEAKING_EXTENSIONS/);
    }
    // ttsService tarafı: uzatma sonsuza gitmesin diye konuşma bayrağının TAVANI olmalı.
    const ttsSrc = read('src/platform/ttsService.ts');
    expect(ttsSrc, 'MAX_SPEAKING_MS tavanı kaldırılmış — takılan TTS "sonsuz konuşuyor" sayılır, akış asılı kalır').toMatch(/MAX_SPEAKING_MS/);
    expect(ttsSrc, 'ttsCancel konuşma bayrağını temizlemiyor — kesilen cevap sonrası pencere gereksiz uzar').toMatch(/_markSpeakingEnd\(\); \/\/ konuşma kesildi/);
  });

  it('YAPISAL: 429 pencereleri SAĞLAYICI-BAZLI — Groq/Haiku 429\'u Gemini\'yi kilitlemez', () => {
    // SAHA 2026-07-04: tek paylaşılan _rateLimitedUntil vardı — Groq/Haiku 429'u
    // Gemini'yi de 60sn susturuyordu (çapraz kirlenme → sahte offline).
    // _rateLimitedUntil'a atama yalnız GEMİNİ yollarında ve retryDelay ile olmalı.
    /* MAVI-F13/3: pencereler `companionProviderHealth` defterine taşındı. Bu
       kilit ARTIK ÇAĞRI YERLERİNİ korur; defterin KENDİ davranışını
       voiceRuntimeSeparation `F13/3-8` kilitler. Her 429 KENDİ sağlayıcısını
       adlandırmalı ve Gemini retryDelay'i taşımaya devam etmeli. */
    const geminiAssigns = [...src.matchAll(/noteProviderRateLimited\('gemini'([^)]*)\)/g)];
    expect(geminiAssigns.length, 'Gemini 429 ataması bulunamadı').toBeGreaterThanOrEqual(2);
    for (const m of geminiAssigns) {
      expect(m[1], 'Gemini 429 penceresi Google retryDelay değerini kullanmalı (cooldownFromGemini429) — sabit 60sn asistanı gereksiz uzun offline bırakır').toContain('cooldownFromGemini429');
    }
    expect(src, 'Groq 429 KENDİ penceresini kurmalı').toMatch(/noteProviderRateLimited\('groq'\)/);
    expect(src, 'Haiku 429 KENDİ penceresini kurmalı').toMatch(/noteProviderRateLimited\('haiku'\)/);
    /* Çapraz kirlenme yasağı — SAHA 2026-07-04: Groq/Haiku dalları GEMINI
       penceresini kuramaz. */
    const GROQ_FN  = src.match(/async function askCompanionBrainGroq\([\s\S]*?\n\}/);
    const HAIKU_FN = src.match(/async function askCompanionBrainHaiku\([\s\S]*?\n\}/);
    expect(GROQ_FN,  'askCompanionBrainGroq bulunamadı — kilit körleşti').toBeTruthy();
    expect(HAIKU_FN, 'askCompanionBrainHaiku bulunamadı — kilit körleşti').toBeTruthy();
    for (const [name, fn] of [['Groq', GROQ_FN!], ['Haiku', HAIKU_FN!]] as const) {
      expect(fn[0], `${name} 429'u GEMINI penceresini kuruyor (çapraz kirlenme geri geldi)`)
        .not.toMatch(/noteProviderRateLimited\('gemini'/);
    }
  });

  it('YAPISAL: tüm adaylar kota soğumasındayken DÜRÜST kota cevabı (sahte offline yasak)', () => {
    // SAHA 2026-07-04: soğumada asistan sessizce aptallaşıyordu; kullanıcı
    // "internet gitti" sanıyordu. Zincir hiç denenemeden atlandıysa kullanıcı
    // gerçek nedeni duymalı (companion_rate_limited).
    expect(src, 'companion_rate_limited rotası kaldırılmış').toMatch(/companion_rate_limited/);
    expect(src, 'kota soğuması dürüst-cevap yolu (rateLimitedOnly) kaldırılmış').toMatch(/rateLimitedOnly/);
  });

  it('YAPISAL: named-city hava durumu ham kullanıcı metniyle korunur (Tarsus bug\'ı)', () => {
    // SAHA 2026-07-04: "İstanbul hava durumu" birkaç turdan sonra Tarsus (yerel/GPS
    // şehri) havasını söylüyordu. Kök neden: tryLocalWeatherAnswer şehir korumasını
    // YALNIZ beynin `query`'sine yapıyordu; beyin biriken _history bağlamında şehri
    // düşürünce weatherQueryNamesCity false → yerel hava dönüyordu. Ham kullanıcı
    // metni ("İstanbul...") her zaman şehri içerir → o da kontrol edilmeli, ve TÜM
    // çağrılar ham metni 2. argüman olarak geçmeli.
    const fn = src.match(/async function tryLocalWeatherAnswer\([\s\S]*?\n\}/);
    expect(fn, 'tryLocalWeatherAnswer bulunamadı').toBeTruthy();
    expect(fn![0], 'tryLocalWeatherAnswer ham metni almıyor (rawUserText yok)').toMatch(/rawUserText/);
    const guardCount = (fn![0].match(/weatherQueryNamesCity\(/g) ?? []).length;
    expect(guardCount, 'şehir koruması hem query hem ham metin için çalışmalı (≥2 weatherQueryNamesCity)').toBeGreaterThanOrEqual(2);
    // Tüm ÇAĞRILAR (tanım hariç) ham metni 2. argüman olarak geçmeli
    const invocations = [...src.matchAll(/(?<!function )tryLocalWeatherAnswer\(([^)]*)\)/g)]
      .filter((m) => !/:\s*string/.test(m[1])); // tanımı ele
    expect(invocations.length, 'tryLocalWeatherAnswer çağrısı bulunamadı').toBeGreaterThanOrEqual(3);
    invocations.forEach((m) => {
      expect(m[1], `tek-argümanlı çağrı (ham metin geçilmiyor → Tarsus bug'ı): ${m[0]}`).toMatch(/,/);
    });
  });

  it('YAPISAL: Tavily anahtarı Authorization Bearer header\'ında (gövde api_key DEĞİL)', () => {
    // SAHA 2026-07-04: Tavily güncel API anahtarı yalnız Bearer header'ında kabul
    // ediyor; eski gövde-içi `api_key` alanı 401 veriyor → grounding 429 sonrası
    // web araması ölüp "iki istekte offline" oluyordu. tavilySearch Bearer header
    // KULLANMALI ve gövdeye api_key KOYMAMALI.
    const web = read('src/platform/webSearchService.ts');
    expect(web, 'Tavily fetch\'i Authorization Bearer header kullanmıyor (401 → web araması ölür)').toMatch(/'Authorization':\s*`Bearer \$\{apiKey\}`/);
    expect(web, 'Tavily istek GÖVDESİNDE api_key alanı var — güncel API 401 verir').not.toMatch(/api_key:\s*apiKey/);
  });
});

/* ───────────────────────────────────────────────────────────────
   5. REROUTE — yoğun ızgarada sahte yeniden-rotalama önlemi
   Regresyon: rota sürekli sıfırlanıp "Yola çıkın"a dönüyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Reroute sahte-tetik önlemi kilidi', () => {
  /* KİLİT GÜNCELLENDİ (NAV-CORE-P0, 2026-08-03) — KALDIRILMADI.
   *
   * Eski kilit iki somut ifadeyi arıyordu:
   *   `REROUTE_THRESHOLD_M + Math.min(accuracy…)` ve `_deviationCounter >= 3`.
   * Korunan DAVRANIŞ şuydu: (a) sapma eşiği GPS hata payına duyarlı olmalı,
   * (b) tek gürültü örneği reroute tetiklememeli.
   *
   * O davranış KORUNUYOR ama artık `routingService` içindeki iki satırda değil,
   * saf `offRouteModel` durum makinesinde yaşıyor ve DAHA GÜÇLÜ:
   *   • hata payı `mapMatchModel` koridoruna girdi (tek koridor, iki katman),
   *   • sabit "3 tick" yerine hız+doğruluk uyarlanabilir kanıt penceresi,
   *   • ek olarak SÜRE tabanı (yüksek frekanslı kaynak sayıyı şişiremez).
   * Kilit bu yeni sözleşmeyi bağlar. */
  it('YAPISAL: sapma kararı çok-kanıtlı durum makinesinden gelir', () => {
    const src = read('src/platform/routingService.ts');
    // Ham GPS artık doğrudan sapma kararı vermez — önce eşleştirilir.
    expect(src, 'map matching zinciri kaldırılmış').toMatch(/matchToRoute\(/);
    expect(src, 'sapma durum makinesi kaldırılmış').toMatch(/stepOffRoute\(/);
    // Reroute YALNIZ doğrulanmış sapmada tetiklenir.
    expect(src).toMatch(/_offRoute\.state\s*!==\s*'CONFIRMED_OFF_ROUTE'/);
    /* Zayıf sinyalde rota kurulmaz (fail-closed).
     * KİLİT GÜNCELLENDİ (saha 2026-08-05 · #402) — ZAYIFLATILMADI: eşik artık
     * `offRouteModel.ACTIONABLE_ACCURACY_M` sabitinden gelir. Sebep: sahada
     * karar katmanı kötü fix'i sapma kanıtı sayıyor, rota katmanı aynı fix'i
     * reddediyordu → "onaylandı ama hiçbir şey olmadı". İki katman artık aynı
     * sabiti paylaşır; sayı elle yeniden yazılırsa sessizce ayrışırlar. */
    expect(src).toMatch(/accuracyM\s*==\s*null\s*\|\|\s*accuracyM\s*>\s*ACTIONABLE_ACCURACY_M/);
    expect(read('src/platform/navigation/core/offRouteModel.ts'))
      .toMatch(/ACTIONABLE_ACCURACY_M\s*=\s*50/);
  });

  it('YAPISAL: tek örnek ASLA sapma doğrulamaz (sayı VE süre birlikte)', () => {
    const m = read('src/platform/navigation/core/offRouteModel.ts');
    expect(m, 'asgari kanıt sayısı 2\'nin altına düşmüş').toMatch(/MIN_EVIDENCE\s*=\s*2/);
    // Sayı tek başına yetmez; kanıtın SÜRMESİ de gerekir.
    expect(m).toMatch(/count\s*>=\s*required\s*&&\s*elapsed\s*>=\s*requiredMs/);
    // Kanıt penceresi sabit değil, hız/doğruluktan türetilir.
    expect(m).toMatch(/export function requiredEvidenceFor\(/);
    expect(m).toMatch(/export function requiredEvidenceMsFor\(/);
  });

  it('YAPISAL: tünel/GPS kaybı sapma SAYILMAZ', () => {
    const m = read('src/platform/navigation/core/offRouteModel.ts');
    // STALE/UNKNOWN eşleşmede karar verilmez ve kanıt sayacı sıfırlanır.
    expect(m).toMatch(/ev\.matchState\s*===\s*'STALE'\s*\|\|\s*ev\.matchState\s*===\s*'UNKNOWN'/);
    expect(m).toMatch(/HELD_NO_DECISION/);
  });

  it('YAPISAL: bayat rota yanıtı güncel rotayı EZEMEZ', () => {
    const src = read('src/platform/routingService.ts');
    // Her store yazısı önce isteğin hâlâ güncel olduğunu doğrular.
    expect(src).toMatch(/isCurrentRequest\(reqId\)/);
    expect(src).toMatch(/recordStaleRejected\(reqId\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   6. AUTO-BRIGHTNESS — GPS fix timing
   Regresyon (0484a4d): açılışta GPS fix yokken autoBrightness başlatma
   effect'i else-dalıyla servisi kapatıyordu; fix sonradan gelince effect
   (deps'inde location yok) tekrar tetiklenmediği için otomatik parlaklık +
   otomatik gece/gündüz teması o oturum boyunca HİÇ başlamıyordu. Head unit'te
   fix gecikmesi yaygın → sık yaşanan sessiz arıza.
   ─────────────────────────────────────────────────────────────── */
describe('Auto-brightness GPS-fix timing kilidi', () => {
  it('YAPISAL: başlatma effect\'i GPS fix VARLIĞINI (hasGpsFix) deps olarak izler', () => {
    const src = read('src/hooks/useLayoutServices.ts');
    // Fix varlığı türetilir (koordinat değil → her tick restart yok)
    expect(src).toMatch(/const hasGpsFix\s*=\s*location\?\.latitude\s*!=\s*null/);
    // ve autoBrightness start/stop effect deps'inde yer alır
    expect(src).toMatch(/settings\.autoThemeEnabled,\s*hasGpsFix\s*\]/);
  });

  it('YAPISAL: updateAutoBrightnessLocation start şartına bağlı (servis kapalıyken no-op)', () => {
    // Bug'ın diğer yarısı: konum-update tek başına servisi başlatamamalı; aksi halde
    // yapısal deps kilidi gevşetilse bile sessizce "çalışıyor" sanılırdı. _state.enabled
    // guard'ı update'in start'ı ikame etmesini engeller → effect'in fix'te start
    // çağırması zorunlu kalır. (Davranış importu jsdom side-effect'i nedeniyle kaynak
    // değişmezi olarak kilitlendi.)
    const src = read('src/platform/autoBrightnessService.ts');
    expect(src).toMatch(/export function updateAutoBrightnessLocation[\s\S]{0,120}if\s*\(_state\.enabled\)/);
  });

  it('SİYAH-EKRAN: gece minNight tabanı head unit panelinde okunabilir kalmalı (>=35)', () => {
    // Regresyon (saha 2026-06-14, K24/NWD): minNight=15 → window screenBrightness
    // 0.149 → panel görünür eşiğin ALTINA inip ekranı tamamen SİYAH gösteriyordu;
    // akşam/gece fazında uygulama öne gelince "kapalı" sanılıyordu. Gece dimming
    // korunur ama taban araç panelinde okunabilir kalmalı. Telefon-düşük tabanına
    // (≤20) geri dönüş bu sessiz arızayı geri getirir → kilitle.
    const src = read('src/platform/autoBrightnessService.ts');
    const m = src.match(/minNight:\s*(\d+)\s*,/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(35);
  });
});

/* ───────────────────────────────────────────────────────────────
   8. HEAD UNIT YATAY ROTASYON — native sistem rotasyon kilidi
   Regresyon (saha 2026-06-14, K24/NWD): panel fiziksel YATAY ama Android
   display'i 720x1280 DİKEY raporluyor + OEM manifest sensorLandscape'i
   YOKSAYIYOR. Sonuç: UI ekranda 90° yan + "Telefonu Yatay Tutun" uyarısı.
   Çözüm (d89bb31 — eski WebView setRotation hack'i KALDIRILDI): MainActivity'de
   sistem rotasyonunu native kilitle → otomatik döndürmeyi kapat
   (ACCELEROMETER_ROTATION=0) + USER_ROTATION=ROTATION_90. Yalnız NWD head
   unit'te (ro.boot.nwd.orientation set) devreye girer; normal cihaza DOKUNMAZ.
   Bu fix silinirse cihazda ekran yine yan döner → yapısal kilit.
   ─────────────────────────────────────────────────────────────── */
describe('Head unit yatay rotasyon kilidi (native sistem rotasyon)', () => {
  it('YAPISAL: MainActivity NWD head unit\'te sistem rotasyonunu yatay kilitler', () => {
    const src = read('android/app/src/main/java/com/cockpitos/pro/MainActivity.java');
    // Rotasyon metodu çağrılıyor
    expect(src).toMatch(/applyHeadUnitLandscapeRotation\s*\(\s*\)\s*;/);
    // Yalnızca NWD head unit panelinde (ro.boot.nwd.orientation) devreye girer
    expect(src).toMatch(/ro\.boot\.nwd\.orientation/);
    // Otomatik döndürme kapatılıyor (sensör rotasyonu devre dışı)
    expect(src).toMatch(/ACCELEROMETER_ROTATION\s*,\s*0\s*\)/);
    // Kullanıcı rotasyonu YATAY (90°) sabitleniyor
    expect(src).toMatch(/USER_ROTATION\s*,\s*android\.view\.Surface\.ROTATION_90\s*\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   Donanım geri tuşu köprüsü — event adı/hedefi EŞLEŞMELİ
   Regresyon: MainActivity.onBackPressed → triggerWindowJSEvent(
   "carlauncherBackButton") window'da yolluyordu; MainLayout ise
   document'ta 'backbutton' (Cordova API'si — Capacitor'da HİÇ gelmez)
   dinliyordu → geri tuşu ölüydü (drawer/modal kapanmıyor, çıkış yok).
   Kilit: iki taraf aynı adı (carlauncherBackButton) + doğru hedefi
   (window) kullanmalı; 'backbutton'/document'a geri dönülmemeli.
   ─────────────────────────────────────────────────────────────── */
describe('Donanım geri tuşu köprüsü (event adı eşleşmesi)', () => {
  it('YAPISAL: MainActivity yolladığı back-event adını MainLayout window\'da dinler', () => {
    const activitySrc = read('android/app/src/main/java/com/cockpitos/pro/MainActivity.java');
    // Native taraf 'carlauncherBackButton' yollar
    expect(activitySrc).toMatch(/triggerWindowJSEvent\(\s*"carlauncherBackButton"/);
    // JS taraf AYNI adı window'da dinler
    expect(mainLayoutSrc).toMatch(/window\.addEventListener\(\s*['"]carlauncherBackButton['"]/);
    // Eski kopuk köprüye (Cordova 'backbutton' + document) geri dönülmemeli
    expect(mainLayoutSrc).not.toMatch(/document\.addEventListener\(\s*['"]backbutton['"]/);
  });
});

/* ───────────────────────────────────────────────────────────────
   7. ZAYIF GPU TESPİTİ — PowerVR/Imagination kapsanır
   Regresyon (cihazda doğrulandı 2026-06-14): K24 head unit GPU'su
   "PowerVR Rogue GE8300" (Allwinner ceres). detectWeakGpu regex'i yalnız
   Mali-400/software/videocore tanıyordu → PowerVR yüksek tier'da kalıp
   blur/animasyonları açıyor, WebView renderer'ı %88 CPU + %97 jank yapıyordu.
   Kilit: PowerVR sınıfı renderer zayıf sayılmalı; güçlü GPU'lar sayılmamalı.
   ─────────────────────────────────────────────────────────────── */
describe('Zayıf GPU tespiti kilidi (PowerVR/Imagination kapsanır)', () => {
  it('ZAYIF: PowerVR Rogue GE8300, Mali-400 sınıfı, software → true', async () => {
    const { isWeakRendererString } = await import('../utils/detectWeakGpu');
    expect(isWeakRendererString('Imagination Technologies, PowerVR Rogue GE8300')).toBe(true);
    expect(isWeakRendererString('Mali-400 MP')).toBe(true);
    expect(isWeakRendererString('Mali-450')).toBe(true);
    expect(isWeakRendererString('Google SwiftShader')).toBe(true);
    expect(isWeakRendererString('llvmpipe (LLVM 12)')).toBe(true);
    expect(isWeakRendererString('VideoCore IV HW')).toBe(true);
  });
  it('GÜÇLÜ/BİLİNMEYEN: Adreno, Mali-G, Apple, boş/maskeli → false (yanlış pozitif yok)', async () => {
    const { isWeakRendererString } = await import('../utils/detectWeakGpu');
    expect(isWeakRendererString('Adreno (TM) 640')).toBe(false);
    expect(isWeakRendererString('Mali-G78 MP14')).toBe(false);   // G serisi güçlü, [34]\d\d değil
    expect(isWeakRendererString('Apple GPU')).toBe(false);
    expect(isWeakRendererString('')).toBe(false);                // maskeli renderer
    expect(isWeakRendererString('(WebGL yok)')).toBe(false);     // WebGL yok
  });
});

/* ───────────────────────────────────────────────────────────────
   8. K24 CAN-FLOOD PERF DÜZELTMESİ — Fix 1: native throttle/dedup (2026-07-02)
   Regresyon (caros-performance analizi "K24"): CAN→JS köprüsü (emitVehicleData)
   throttle'sız emit ediyordu → hızlı CAN trafiğinde JS köprüsü taşıyor,
   uygulama kasıyordu. Kilit: 80ms coalescing throttle + dedup + reverse/
   parkingBrake güvenlik-kritik bypass kodda KALICI olmalı.
   ─────────────────────────────────────────────────────────────── */
describe('K24 CAN-flood perf düzeltmesi — native throttle/dedup kilidi', () => {
  it('YAPISAL: emitVehicleData 80ms throttle + dedup üzerinden JS\'e emit eder (native, tek nokta)', () => {
    const src = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    // Throttle penceresi 80ms (10-20Hz bandı) olarak sabitlenmiş
    expect(src).toMatch(/CAN_EMIT_MIN_INTERVAL_MS\s*=\s*80L/);
    // emitVehicleData artık doğrudan canJsBridge.emit ÇAĞIRMAZ — throttle/dedup yoluna girer
    expect(src).toMatch(/scheduleOrEmitToJs\(filtered\)/);
    // Dedup: aynı veri seti tekrar emit edilmez
    expect(src).toMatch(/sameEmittedData\(/);
  });

  it('YAPISAL: reverse ve parkingBrake güvenlik-kritik alanlar throttle\'ı bypass eder', () => {
    const src = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(src).toMatch(/isSafetyCriticalChange/);
    expect(src).toMatch(/incoming\.reverse,\s*lastEmitted\.reverse/);
    expect(src).toMatch(/incoming\.parkingBrake,\s*lastEmitted\.parkingBrake/);
  });
});

/* ───────────────────────────────────────────────────────────────
   9. K24 CAN-FLOOD PERF DÜZELTMESİ — Fix 2: useSafetyAlerts seçicili subscribe (2026-07-02)
   Regresyon: useUnifiedVehicleStore.subscribe(() => runCompute()) seçicisizdi —
   store'daki HER değişiklikte (map/tema dahil) safety kural motoru tetikleniyordu.
   Kilit: subscribe artık safetyRelevantFieldsChanged ile seçicili filtrelenir.
   ─────────────────────────────────────────────────────────────── */
describe('K24 CAN-flood perf düzeltmesi — useSafetyAlerts seçicili subscribe kilidi', () => {
  it('YAPISAL: useSafetyAlerts store subscribe\'ı seçicili (safetyRelevantFieldsChanged) — çıplak seçicisiz abonelik DEĞİL', () => {
    const src = read('src/platform/safety/useSafetyAlerts.ts');
    // Eski buggy desen `subscribe(() => runCompute(...))` bir daha geri gelmemeli
    expect(src).not.toMatch(/subscribe\(\(\)\s*=>\s*\{?\s*runCompute/);
    expect(src).toMatch(/safetyRelevantFieldsChanged\(/);
  });
});

/* ───────────────────────────────────────────────────────────────
   10. K24 CAN-FLOOD PERF DÜZELTMESİ — Fix 3: connectivityService IDB cache (2026-07-02)
   Regresyon: her dbGetAll/dbPut/dbDelete ayrı indexedDB.open() çağırıyordu.
   Kilit: bağlantı modül-seviyesinde cache'lenir (_dbPromise), tekrar açılmaz.
   ─────────────────────────────────────────────────────────────── */
describe('K24 CAN-flood perf düzeltmesi — connectivityService IDB cache kilidi', () => {
  it('YAPISAL: connectivityService IDB bağlantısı modül-seviyesinde cache\'lenir (_dbPromise)', () => {
    const src = read('src/platform/connectivityService.ts');
    expect(src).toMatch(/let\s+_dbPromise:\s*Promise<IDBDatabase>\s*\|\s*null\s*=\s*null;/);
    expect(src).toMatch(/if\s*\(_dbPromise\)\s*return\s*_dbPromise;/);
  });
});

/* ───────────────────────────────────────────────────────────────
   11. K24 CAN-FLOOD PERF DÜZELTMESİ — Fix 4: hot-path allocation (2026-07-02)
   Regresyon (yol açan gerçek bug): vehicleDataLayer/index.ts'te recordEvent'in
   'accepted' bayrağı `d !== raw || Object.keys(d).length > 0` idi — OR'un sol
   tarafı kısa devre yaptığından bayrak PRATİKTE HER ZAMAN true dönüyordu (Safe
   Mode'da tüm alanlar undefined olsa bile d yeni bir referans olduğu için).
   Kilit: _hasAnyField allocation-free VE doğru semantiği (gerçekten boşsa false)
   uygular; bir daha sessizce eski dead-code deseni geri gelmemeli.
   ─────────────────────────────────────────────────────────────── */
/*
 * ⚠️ TAVAN YÜKSELTİLDİ (2026-08-08) — KİLİT ZAYIFLATILMADI.
 * Bu blok `await import('../platform/vehicleDataLayer')` yapar; `vehicleDataLayer`
 * grafiği 360+ modüldür. Tam takım koşumunda (497 dosya, paralel worker'lar)
 * yalnız modül çözümlemesi 5 sn'lik VARSAYILAN tavanı aşıp
 * "Test timed out in 5000ms" veriyordu — iddia değil, YÜKLEME yavaşlığı.
 * Kilit tek başına ve küçük takımlarda hep geçiyordu; takım büyüdükçe düştü.
 * Aynı kırılganlık `labTruthAuthorities.test.ts` T1 bloğunda daha önce
 * ölçülmüş ve BİREBİR aynı çözümle (blok düzeyinde tavan) kapatılmıştı.
 * Test ettiği DAVRANIŞ ve beklentiler değişmedi.
 */
describe('K24 CAN-flood perf düzeltmesi — hot-path allocation kilidi', { timeout: 30_000 }, () => {
  it('DAVRANIŞ: _hasAnyField boş objede false döner — eski "d !== raw ||" kısa devresi HER ZAMAN true dönen dead-code bug\'ıydı', async () => {
    const { _hasAnyField } = await import('../platform/vehicleDataLayer');
    // Bug: applyProfileGate Safe Mode'da tüm alanlar undefined olsa bile
    // YENİ bir referans döndürüyordu → eski kod (d !== raw || ...) OR kısa
    // devresiyle Object.keys(d).length hiç değerlendirilmeden true dönüyordu.
    expect(_hasAnyField({})).toBe(false);
    expect(_hasAnyField({ speed: 42 })).toBe(true);
  });

  it('DAVRANIŞ: updateCanExtras TPMS\'i eleman eleman kıyaslar — aynı değerler YENİ dizi referansıyla gelse bile dirty tetiklenmez', async () => {
    // Bug: `if (patch.tpms != null) { u.canTpmsKpa = patch.tpms; dirty = true; }`
    // diğer TÜM alanların aksine (chk/chkBool önce cur[key] ile kıyaslar) hiç
    // kıyaslama yapmadan koşulsuz dirty=true set ediyordu. patch.tpms her CAN
    // frame'inde YENİ bir tuple referansıyla geldiğinden bu satır PRATİKTE HER
    // TPMS frame'inde set() tetikliyor, store'a subscribe olan her şeyi
    // gereksiz yere uyandırıyordu.
    const { useUnifiedVehicleStore } = await import('../platform/vehicleDataLayer/UnifiedVehicleStore');
    const s = useUnifiedVehicleStore.getState();
    s.resetCanData();
    s.updateCanExtras({ tpms: [220, 221, 219, 218] }); // baseline

    let notified = 0;
    const unsub = useUnifiedVehicleStore.subscribe(() => { notified++; });
    s.updateCanExtras({ tpms: [220, 221, 219, 218] }); // yeni referans, aynı içerik
    unsub();

    expect(notified).toBe(0);
  });
});

/* ───────────────────────────────────────────────────────────────
   12. SESLİ ASİSTAN — DÜRÜST HAVA/TRAFİK + HİBRİT BEYİN ZİNCİRİ (2026-07-03)
   Regresyon (kök neden, ana oturum analizi): Single Brain başarısız olunca
   "hava durumu" sorusu her zaman sahte WEATHER_OFFLINE stub'una düşüyordu —
   uygulamada GERÇEK hava verisi (weatherService) olsa bile. Ayrıca Gemini
   429/timeout'ta kullanıcının Groq anahtarı varsa dahi hiç denenmiyordu
   (asistan aptallaşıyordu). BRAIN_DECISION_TIMEOUT_MS sürüş/park ayrımı
   yapmadan 2.5sn'de kesiyordu (parkta yavaş ağda gereksiz erken fallback).
   Kilit: gerçek veri varsa söylenir, yoksa dürüst "ulaşamadım" + arka planda
   tazeleme; Gemini→Groq→Haiku hibrit zincir failover; sürüş/park bütçesi ayrık.
   ─────────────────────────────────────────────────────────────── */
describe('Sesli asistan — hava/trafik dürüstlüğü + hibrit beyin zinciri kilidi', () => {
  it('YAPISAL: offlineConversationEngine hava/trafik niyetleri artık sabit stub DEĞİL, weatherService\'e bağlı', () => {
    const src = read('src/platform/offlineConversationEngine.ts');
    expect(src).toMatch(/import\s*\{\s*getWeatherNarrative,\s*refreshWeather\s*\}\s*from\s*'\.\/weatherService'/);
    // Eski buggy desen: INTENTS tablosunda hava niyeti doğrudan WEATHER_OFFLINE'a bağlıydı.
    expect(src).not.toMatch(/kw:\s*\[[^\]]*'hava durumu'[^\]]*\][^}]*build:\s*\(drv\)\s*=>\s*drive\(WEATHER_OFFLINE/);
    expect(src).toMatch(/build:\s*\(drv\)\s*=>\s*buildWeather\(drv\)/);
  });

  it('YAPISAL: CompanionChatOpts.chain (Gemini→Groq→Haiku) + tryCompanionBrain\'de Gemini soğuma/hata → sıradaki aday kilidi', () => {
    const src = read('src/platform/companion/companionChatProvider.ts');
    expect(src).toMatch(/chain\?:\s*ReadonlyArray<\{\s*provider:\s*'gemini'\s*\|\s*'groq'\s*\|\s*'haiku';\s*apiKey:\s*string\s*\}>/);
    // Gemini adayı KENDİ _rateLimitedUntil soğumasındaysa ATLANIR (sıradaki aday
    // denenir) — bu davranış (429 soğumasında asistan aptallaşmasın) bir daha
    // sessizce kaldırılmamalı. SAHA 2026-07-04: atlama artık skippedByCooldown
    // işaretler (dürüst kota cevabı) — pencereler sağlayıcı-bazlı.
    /* MAVI-F13/3: soğuma sorgusu `companionProviderHealth.isProviderCoolingDown`
       kapısına taşındı. Kilit korunur: soğumadaki aday ATLANIR ve atlama
       `skippedByCooldown` ile İŞARETLENİR (dürüst kota cevabı sessizce
       kaybolmasın). `gateway` kendi devre kesicisini kullanır → dışarıda. */
    expect(src).toMatch(/cand\.provider !== 'gateway' && isProviderCoolingDown\(cand\.provider\)/);
    expect(src, 'soğumada atlanan aday işaretlenmiyor — dürüst kota cevabı düşer')
      .toMatch(/skippedByCooldown = true; continue;/);
    expect(src).toMatch(/askCompanionBrainHaiku/); // hibrit zincirin son halkası
  });

  it('YAPISAL: voiceService zincir SIRA SABİT — Gemini → Groq → Haiku (birincil Gemini; SAHA geri-alma)', () => {
    const src = read('src/platform/voiceService.ts');
    // Gemini = arama motoru anahtarı; Groq/Haiku yedekteyken web kararını buna devreder.
    expect(src).toMatch(/searchKey = resolvedGemini;/);
    // SABİT sıra: Gemini önce (birincil — güvenilir sohbet/komut + yerleşik google_search).
    // "Groq birincil" denemesi geri alındı; bu sıra bir daha sessizce ters çevrilmemeli.
    expect(src).toMatch(/if \(resolvedGemini\) chain\.push\(\{ provider: 'gemini', apiKey: resolvedGemini \}\);/);
    expect(src).toMatch(/if \(resolvedGroq\)\s+chain\.push\(\{ provider: 'groq',\s+apiKey: resolvedGroq \}\);/);
    expect(src).toMatch(/if \(resolvedHaiku\)\s+chain\.push\(\{ provider: 'haiku',\s+apiKey: resolvedHaiku \}\);/);
    // Gemini push, Groq push'tan ÖNCE gelmeli (birincil sıra korunsun)
    expect(src.indexOf("provider: 'gemini', apiKey: resolvedGemini")).toBeLessThan(src.indexOf("provider: 'groq',   apiKey: resolvedGroq"));
    // searchKey yine beyne iletilir (Groq/Haiku YEDEKTEyken web kararını Gemini'ye devreder)
    expect(src).toMatch(/searchKey,\s*\n\s*chain,/);
    expect(src).toMatch(/const aiUsable = chain\.length > 0 && hasNet;/);
  });

  it('YAPISAL #699: Haiku çağrıları `fetch` DEĞİL native taşıma kullanır (Anthropic CORS duvarı)', () => {
    /* SAHA (cihazda CDP ile KANITLANDI, 2026-08-22): aynı istek
         fetch  → THROW "Failed to fetch" (HTTP durumu bile YOK)
         native → 401 "x-api-key header is required" (sunucuya ULAŞILIYOR)
       Kullanıcının Haiku anahtarı GEÇERLİYDİ (`sk-ant…`, 108 karakter); halka
       taşıma yüzünden ölüyordu. Zincirin sessiz ölümüne bakıp "anahtarın
       geçersiz / limitin bitmiş" demek YANLIŞ teşhisti — bu kilit o yanlışın
       kaynağını kapatır. */
    const brain = read('src/platform/companion/companionChatProvider.ts');
    expect(brain).toMatch(/import \{ aiPostJson \} from '\.\.\/ai\/nativeHttp'/);
    // Anthropic uç noktasına `fetch(` ile gidilmemeli (CORS'ta ölür).
    expect(brain).not.toMatch(/fetch\(HAIKU_COMPANION_ENDPOINT/);
    // İki Haiku çağrısı da taşıma katmanından geçmeli.
    const viaNative = brain.split('aiPostJson(').filter((c) => c.trimStart().startsWith('HAIKU_COMPANION_ENDPOINT'));
    expect(viaNative.length).toBeGreaterThanOrEqual(2);

    /* İKİNCİ KAPI: fetch'e düşülen ortamlarda (tarayıcı/dev) CORS'u açan header
       şart — cihazda ölçüldü: headersiz fetch THROW, header'lı fetch 401. */
    const dangerous = brain.split('anthropic-dangerous-direct-browser-access').length - 1;
    expect(dangerous).toBeGreaterThanOrEqual(2);

    const t = read('src/platform/ai/nativeHttp.ts');
    // Native yalnız GERÇEK native platformda kullanılır (tarayıcıda fetch korunur).
    expect(t).toMatch(/isNativePlatform/);
    // Native throw'unda fetch'e düşülmemeli — sessiz çift istek/çift fatura yasak.
    expect(t).not.toMatch(/catch[\s\S]{0,80}await fetch\(/);
  });

  it('YAPISAL #697: REASK ("orayı kaçırdım") YEREL komut zincirini EZEMEZ — kendi rotasında bekletilir', () => {
    /* SAHA: kullanıcı "Mavi HER ŞEYE 'hops orayı kaçırdım' diyor" dedi. Kök:
       online zincir null döndüğünde beyin REASK cümlesini `companion_offline`
       rotasıyla döndürüyor, voiceService bunu GEÇERLİ sohbet cevabı sayıp turu
       KAPATIYORDU → "müzik aç", "haritayı aç" gibi TAMAMEN YEREL çalışan
       komutlar bile hiç denenmiyordu. Tekrar-rica artık zincirin SONUNDA,
       yerel parser + offline sohbet DENENDİKTEN sonra söylenir. */
    const brain = read('src/platform/companion/companionChatProvider.ts');
    // REASK kendi rotasında döner (offline sohbet cevabıyla aynı kulvarda DEĞİL).
    expect(brain).toMatch(/response: reask, route: 'companion_reask'/);

    const vs = read('src/platform/voiceService.ts');
    // Çağıran REASK'ı chat olarak TÜKETMEZ; bekletir ve zincire devam eder.
    expect(vs).toMatch(/brain\.route === 'companion_reask'/);
    expect(vs).toMatch(/_pendingReask = brain\.response;/);
    // ACTION köprüsü REASK düşüşünde kurulmaz (chat objesinde `semantic` yok).
    // Daraltılmış referans ŞART: `brain.semantic`e doğrudan dokunmak `tsc -b`de
    // düşer (bir kez düştü) — blok bu değişken üzerinden okumalı.
    expect(vs).toMatch(/const brainAction = brain\.kind === 'action' \? brain : null;/);
    expect(vs).toMatch(/if \(brainAction && intent\) \{/);
    // Çıkmaz yok: son dalda SESLİ söylenir (sürüşte ekran notu yetmez).
    expect(vs).toMatch(/if \(_pendingReask !== null\) \{[\s\S]{0,40}speakMaviAnswer\(_pendingReask/);
    // REASK dalı turu KAPATMAMALI — o satırlarda `return true` olmamalı.
    const idx = vs.indexOf("brain.route === 'companion_reask'");
    expect(idx).toBeGreaterThan(0);
    expect(vs.slice(idx, idx + 260)).not.toMatch(/return true;/);
  });

  it('YAPISAL: beyin AYAR komutlarını (SET_SETTING) üretebilir + sahte onay YASAK — "açıyorum" deyip iş yapmama önlemi', () => {
    const brain = read('src/platform/companion/companionChatProvider.ts');
    // SET_SETTING (parlaklık/wifi/bluetooth) + yaygın eylemler beyin sözlüğünde OLMALI —
    // yoksa beyin bu komutları sahte "açıyorum" ile geçiştiriyordu (SAHA 2026-07-03).
    /* MAVI-F5: beyin sözlüğü ELLE YAZILMIYOR, capability kataloğundan TÜRETİLİYOR.
       Kaynak metnini kazıyan eski kilit türetmeye geçince körleşirdi; artık
       GERÇEK allowlist doğrulanır (aynı kapsam, daha güçlü kilit). */
    for (const i of ['SET_SETTING', 'OPEN_FAVORITES', 'ENABLE_DRIVING_MODE', 'TOGGLE_SLEEP_MODE']) {
      expect(brainIntentAllowlist(), `beyin ${i} üretemez hâle gelmiş`).toContain(i);
    }
    /* parseBrainJson setting alanlarını taşımalı (yoksa parlaklık yönü kaybolur
       → no-op). MAVI-F13/4: alan çıkarımı `companionBrainParser`de. */
    const brainParserSrc = read('src/platform/companion/companionBrainParser.ts');
    expect(brainParserSrc).toMatch(/settingKey:\s+typeof obj\.settingKey/);
    // SAHTE ONAY YASAĞI prompt'ta olmalı — bir daha sessizce kaldırılmasın
    expect(brain).toMatch(/SAHTE ONAY YASAK/);
    // Köprü SET_SETTING alanlarını payload'a yazmalı (executeAIResult → applyVoiceSetting)
    const engine = read('src/platform/intentEngine.ts');
    expect(engine).toMatch(/intentType === 'SET_SETTING'/);
    expect(engine).toMatch(/payload\.settingKey\s+= result\.settingKey/);
  });

  it('YAPISAL: Groq/Haiku (yedekteyken) web kararı Gemini aramasına (searchKey) devredilir — Tavily\'den ÖNCE', () => {
    const src = read('src/platform/companion/companionChatProvider.ts');
    // searchKey opsiyonu + "önce Gemini google_search, yoksa Tavily" sırası
    expect(src).toMatch(/searchKey\?:\s*string/);
    // hem Groq hem Haiku dalında hasGeminiSearch → askGroundedGemini(parsed.query, searchKey
    expect((src.match(/await askGroundedGemini\(parsed\.query, searchKey as string/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('YAPISAL: "hava durumu" yerel bypass — beyne (Gemini/Groq/Haiku) GİTMEDEN yerelde cevaplanır', () => {
    const src = read('src/platform/voiceService.ts');
    expect(src).toMatch(/result\.command\.type === 'show_weather' &&/);
    expect(src).toMatch(/result\.command\.confidence >= 0\.7/);
    expect(src).toMatch(/weather_local_bypass/);
  });

  it('YAPISAL: beyin web+hava kesişimi — tryLocalWeatherAnswer Tavily/grounded\'dan ÖNCE denenir', () => {
    const src = read('src/platform/companion/companionChatProvider.ts');
    expect(src).toMatch(/async function tryLocalWeatherAnswer/);
    // Gemini grounded, Groq ve Haiku'nun web dallarının ÜÇÜ de yerel hava kısayolunu kullanır.
    expect((src.match(/tryLocalWeatherAnswer\(/g) ?? []).length).toBeGreaterThanOrEqual(4); // tanım + 3 kullanım
  });

  it('YAPISAL: voiceService bağlama duyarlı beyin bütçesi — tek sabit (BRAIN_DECISION_TIMEOUT_MS) DEĞİL, sürüş/park ayrık', () => {
    const src = read('src/platform/voiceService.ts');
    expect(src).not.toMatch(/const BRAIN_DECISION_TIMEOUT_MS/);
    // SAHA 2026-07-04: değerler yükseltildi (soğuk-başlangıç ~7sn'yi yakalasın →
    // REASH yerine gerçek cevap). YAPISAL kilit korunur: sürüş < park, İKİSİ AYRI.
    expect(src).toMatch(/const BRAIN_TIMEOUT_DRIVING_MS = 4_500/);
    expect(src).toMatch(/const BRAIN_TIMEOUT_PARKED_MS\s*=\s*8_000/);
    expect(src).toMatch(/timeoutMs:\s*ctx\?\.isDriving\s*\?\s*BRAIN_TIMEOUT_DRIVING_MS\s*:\s*BRAIN_TIMEOUT_PARKED_MS/);
  });
});

/* ───────────────────────────────────────────────────────────────
   SATIŞ-APK GÜVENLİK BAYRAKLARI — capacitor.config.ts hardening kilidi.
   Regresyon riski: bu bayraklar profiling/debug için bir kez `true`'ya
   çevrilip öyle unutuldu (satış APK'sında remote debug + mixed content açık
   = P0 güvenlik açığı). Kilit: hepsi `isDev`'e bağlı kalmalı, koşulsuz `true`
   OLMAMALI. Bilinçli değişiyorsa kilidi güncelle — gevşetme.
   ─────────────────────────────────────────────────────────────── */
describe('Satış-APK güvenlik bayrakları kilidi — capacitor.config.ts', () => {
  const cfg = () => read('capacitor.config.ts');

  it('YAPISAL: webContentsDebuggingEnabled release\'te KAPALI (isDev-gated, koşulsuz true DEĞİL)', () => {
    const src = cfg();
    expect(src).toMatch(/webContentsDebuggingEnabled:\s*isDev/);
    expect(src).not.toMatch(/webContentsDebuggingEnabled:\s*true/);
  });

  it('YAPISAL: allowMixedContent release\'te KAPALI (isDev-gated, http kaynak yüklenmez)', () => {
    const src = cfg();
    expect(src).toMatch(/allowMixedContent:\s*isDev/);
    expect(src).not.toMatch(/allowMixedContent:\s*true/);
  });

  it('YAPISAL: androidScheme release\'te https (isDev\'de http)', () => {
    const src = cfg();
    expect(src).toMatch(/androidScheme:\s*isDev\s*\?\s*'http'\s*:\s*'https'/);
  });

  it('YAPISAL: loggingBehavior release\'te none (isDev\'de debug)', () => {
    const src = cfg();
    expect(src).toMatch(/loggingBehavior:\s*isDev\s*\?\s*'debug'\s*:\s*'none'/);
  });
});

/* ───────────────────────────────────────────────────────────────
   HAREKET TESPİTİ HIZA MAHKÛM DEĞİL — "harita ters gidiyor + takip etmiyor"
   Regresyon (SAHA 2026-07-04, telefon): bazı GPS çipleri/WebView'ler hareket
   halinde coords.speed=0 bildirir ("Doppler'e saplanma"). Yalnız hıza bakan
   üç kapı birden ölüyordu: (1) gpsService `gpsSpeed ?? delta` — 0 finite
   olduğundan delta fallback HİÇ çalışmıyordu; (2) MiniMapWidget isDriving
   (speedKmh>5) sürüş görünümünü açmıyordu → rotasyon yok (kuzey-yukarı),
   merkez ~200m'de bir sıçrama; (3) FullMapView rAF wake (speed≥1.5) uyanmıyor
   → takip ölü. Kuzey-yukarı haritada güneye sürüş = "geriye gidiyoruz" algısı.
   Kural: hareket = hız VEYA yer değiştirme (fail-soft, CLAUDE.md §2).
   ─────────────────────────────────────────────────────────────── */
describe('Hareket tespiti hız-bağımsız kilidi — Doppler 0 saplanması', () => {
  it('YAPISAL: gpsService ham hızı pickRawSpeed ile seçer (?? fallback yasak)', () => {
    const src = read('src/platform/gpsService.ts');
    /* GÜNCELLENDİ (cihaz 2026-08-03): Doppler artık ham geçmez, önce YER
       DEĞİŞTİRME ile çapraz doğrulanır (park hâlinde 58 km/h hayaleti).
       Kilidin AMACI aynı: seçim `pickRawSpeed` ile yapılır, `??` fallback YASAK. */
    expect(src, 'pickRawSpeed kaldırılmış — Doppler=0 saplanması geri gelir')
      .toMatch(/pickRawSpeed\(_gpsSpeedChecked,\s*deltaSpeed\)/);
    expect(src, 'Doppler çapraz doğrulaması kaldırılmış').toContain('reconcileDopplerWithDisplacement');
    expect(src, 'eski `gpsSpeed ?? computeSpeedDelta` deseni geri gelmiş (0 finite → fallback ölü)').not.toMatch(/gpsSpeed\s*\?\?\s*computeSpeedDelta/);
  });

  it('YAPISAL: FullMapView rAF wake yer değiştirmeyle de uyanır (yalnız hız DEĞİL)', () => {
    const src = read('src/components/map/FullMapView.tsx');
    expect(src, 'GPS wake yer-değiştirme çapası (wakeAnchorRef) kaldırılmış — hız 0 saplanınca takip ölür').toMatch(/wakeAnchorRef/);
    expect(src, 'wake çapası zaman-normalize hız eşiğini kaybetmiş').toMatch(/\(_movedM \/ _dtS\) \* 3\.6 >= 5\) wakeLoopRef/);
  });

  it('YAPISAL: FullMapView isIdleNow yer değiştirme taşıyan tamponla uyumaz', () => {
    const src = read('src/components/map/FullMapView.tsx');
    expect(src, 'idle tespiti yalnız hıza bakıyor — hız 0 saplanınca takip uyur').toMatch(/\(movedM \/ dtS\) \* 3\.6 >= 5\) return false/);
  });

  it('YAPISAL: MiniMapWidget isDriving yer değiştirme hızı + histerezis kullanır', () => {
    const src = read('src/components/map/MiniMapWidget.tsx');
    expect(src, 'isDriving yalnız Doppler hıza dönmüş — Doppler=0 cihazda sürüş görünümü hiç açılmaz').toMatch(/Math\.max\(speedKmh, _dispKmh\)/);
    expect(src, 'histerezis (giriş >5 / çıkış <3) kaldırılmış — stop-and-go flicker döner').toMatch(/_effKmh < 3 \? false/);
  });
});

/* ───────────────────────────────────────────────────────────────
   HORIZON HARİTA KARTI SAHTE VERİ YASAĞI — "iki araç göstergesi"
   Regresyon (SAHA 2026-07-04, screenshot'lı): HzMap mockup'tan kalan SAHTE
   katmanlar taşıyordu — ekrana %46/%55'e çivili dekoratif konum oku (gerçek
   Rover işaretçisiyle birlikte İKİ araç göstergesi illüzyonu), hardcoded
   "2.4 km D400 · Kaş Yolu" nav şeridi ve "2:15/137/15:39" seyahat satırı
   (rota yokken bile). Kullanıcı aktif rota + ters giden harita sanıyordu.
   Kural: harita kartında sahte/hardcoded sürüş verisi YASAK; nav şeridi ve
   seyahat satırı yalnız GERÇEK isNavigating iken gerçek store verisiyle.
   ─────────────────────────────────────────────────────────────── */
describe('Horizon harita kartı sahte veri yasağı kilidi', () => {
  const src = () => read('src/components/themes/HorizonLayout.tsx');

  it('YAPISAL: sabit dekoratif konum oku YOK (gerçek marker haritanın katmanı)', () => {
    expect(src(), 'ekrana çivili sahte konum oku geri gelmiş (iki araç göstergesi illüzyonu)').not.toMatch(/left: '46%', top: '55%'/);
  });

  it('YAPISAL: nav şeridi hardcoded DEĞİL, isNavigating + gerçek rota verisiyle', () => {
    const s = src();
    expect(s, 'hardcoded "D400 · Kaş Yolu" sahte nav şeridi geri gelmiş').not.toMatch(/Kaş Yolu/);
    expect(s, 'nav şeridi isNavigating kapısını kaybetmiş').toMatch(/\{isNavigating && turnDist && \(/);
    expect(s, 'manevra mesafesi gerçek distanceToNextTurnMeters\'ten gelmeli').toMatch(/fmtTurnDist\(route\.distanceToNextTurnMeters\)/);
  });

  it('YAPISAL: seyahat satırı hardcoded DEĞİL, gerçek ETA/kalan-km ile', () => {
    const s = src();
    expect(s, 'hardcoded "2:15/137/15:39" seyahat satırı geri gelmiş').not.toMatch(/v="2:15"|v="137"|v="15:39"/);
    /* P0-NAV-14: kapı GÜÇLENDİ. Eski hâli yalnız "sayı var mı" soruyordu
       (`etaSeconds != null && > 0`); motorun "bu ETA'ya GÜVENME" hükmünü
       OKUMUYORDU. Yeni kapı `decideEtaDisplay` üzerinden geçer ve o kural
       sıfır/negatif denetimini ZATEN içerir — yani kilit zayıflamadı,
       TripSummary ile aynı otoriteye bağlandı. */
    expect(s, 'seyahat satırı isNavigating + ETA güven kapısını kaybetmiş')
      .toMatch(/\{isNavigating && etaDec\.showNumber && etaDec\.seconds !== null && \(/);
    expect(s, 'ETA güven kararı tek otoriteden gelmiyor')
      .toMatch(/decideEtaDisplay\(etaSeconds, readEtaStateSafe\(\)\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   SÜRÜŞ KAMERASI STİL-KAPISI YASAĞI — "harita sabit + dönmüyor" KÖK NEDENİ
   Regresyon (SAHA 2026-07-04, tarayıcıda Doppler-0 simülasyonuyla kanıtlı):
   setDrivingView'ın tepesindeki `!map.isStyleLoaded()` guard'ı kamerayı
   YAPISAL olarak öldürüyordu — isStyleLoaded() şu iki NORMAL durumda false:
     1) updateUserMarker'ın setData'sı stili aynı senkron karede kirletir
        → marker'dan hemen sonra çağrılan setDrivingView %100 erken döner.
     2) Sürüşte sürekli yeni tile yüklenir → sourceCache.loaded()=false.
   Sonuç: rotasyon + merkezleme HİÇ çalışmıyordu; 84237ff ve 4bd4ed5'teki
   hareket-tespiti fix'leri semptom tedavisiydi. Kural: kamera işlemleri
   (jumpTo/easeTo) stil kapısına BAĞLANAMAZ; katman işleri kendi getLayer()
   + try/catch guard'ını taşır.
   ─────────────────────────────────────────────────────────────── */
describe('Sürüş kamerası stil-kapısı yasağı kilidi (harita sabit/dönmüyor)', () => {
  it('DAVRANIŞ: setDrivingView isStyleLoaded()=false iken bile KAMERA uygular', async () => {
    const { setDrivingView } = await import('../platform/map/MapInteractionManager');
    const { resetCameraSmooth } = await import('../platform/cameraEngine');
    resetCameraSmooth(); // deterministik başlangıç (bearing=0)
    /* 2026-08-13: kamera artık İKİ yoldan uygulanabiliyor — hareket hâlinde ve
       düşük-uç DEĞİLKEN akıcılık için `easeTo`, aksi hâlde `jumpTo`. Kilidin
       AMACI değişmedi: kamera stil kapısına BAĞLANAMAZ. Bu yüzden hangi
       primitif kullanıldığına değil, KAMERANIN UYGULANDIĞINA bakılır. */
    const applied: Array<{ bearing: number }> = [];
    const mockMap = {
      isStyleLoaded: () => false,          // tile yükleniyor / setData sonrası kirli stil
      jumpTo: (o: { bearing: number }) => { applied.push(o); },
      easeTo: (o: { bearing: number }) => { applied.push(o); },
      getZoom: () => 16,
      getLayer: () => undefined,
      setPaintProperty: () => {},
    } as unknown as import('maplibre-gl').Map;
    // 40 km/h, heading 45° (KD) — jitter filtresine takılmayacak gerçek sürüş girdisi
    setDrivingView(mockMap, 36.9146, 34.8973, 45, 40, 600);
    expect(applied.length, 'stil-kapısı geri gelmiş: kamera tile yüklenirken ölür').toBe(1);
    expect(applied[0].bearing, 'bearing 45° hedefe akmalı, kuzeye çivili kalmamalı').toBeGreaterThan(0);
  });

  it('DAVRANIŞ: enterNavigationView stil yüklenmemişken easeTo yutmaz', async () => {
    const { enterNavigationView } = await import('../platform/map/MapInteractionManager');
    let eased = 0;
    const mockMap = {
      isStyleLoaded: () => false,
      easeTo: () => { eased++; },
    } as unknown as import('maplibre-gl').Map;
    enterNavigationView(mockMap, 36.9146, 34.8973, 45, 600);
    expect(eased, '"Başlat" anı tile yüklenirken giriş animasyonu sessizce yutulur').toBe(1);
  });

  it('DAVRANIŞ: trimRouteGeometry stil KİRLİYKEN bile kat edilen rotayı siler', async () => {
    /* AYNI KUSUR SINIFININ İKİNCİ KOPYASI (saha 2026-08-13) — kullanıcı:
       *"konum ileri gittikçe rota silinmiyor."*
       `trimRouteGeometry`de `!map.isStyleLoaded() → return` kapısı vardı.
       Sürüşte `isStyleLoaded()` iki NORMAL nedenle false olur (aynı karedeki
       başka bir setData — `updateUserMarker` bunu ~16 fps yapıyor — ve sürekli
       tile yüklemesi). Kırpma ~1 Hz GPS tick'inde çağrıldığı için temiz ana
       denk gelmiyor, fonksiyon SESSİZCE dönüyor, rota hiç kırpılmıyordu. */
    const { trimRouteGeometry } = await import('../platform/map/MapLayerManager');
    let written: unknown = null;
    const mockMap = {
      isStyleLoaded: () => false,                    // KİRLİ stil — normal sürüş hâli
      getSource: () => ({ setData: (d: unknown) => { written = d; } }),
    } as unknown as import('maplibre-gl').Map;

    trimRouteGeometry(mockMap, [[34.6, 36.8], [34.7, 36.9]]);
    expect(written, 'stil kapısı geri gelmiş: kat edilen rota sürüşte hiç silinmez')
      .not.toBeNull();
  });

  it('DAVRANIŞ: trimRouteGeometry source YOKKEN yazmaz ve ÇÖKMEZ', () => {
    /* KONTROL testi: yukarıdaki kilidin kendini kandırmadığını kanıtlar —
       kaldırılan yalnız SAHTE kapıydı, gerçek koruma (source var mı + try/catch)
       yerinde durmalı. */
    return import('../platform/map/MapLayerManager').then(({ trimRouteGeometry }) => {
      const noSrc = {
        isStyleLoaded: () => true,
        getSource: () => undefined,
      } as unknown as import('maplibre-gl').Map;
      expect(() => trimRouteGeometry(noSrc, [[34.6, 36.8], [34.7, 36.9]])).not.toThrow();

      const throwing = {
        isStyleLoaded: () => true,
        getSource: () => ({ setData: () => { throw new Error('style reloading'); } }),
      } as unknown as import('maplibre-gl').Map;
      expect(() => trimRouteGeometry(throwing, [[34.6, 36.8], [34.7, 36.9]])).not.toThrow();
    });
  });

  it('DAVRANIŞ: setPaintedArrow stil KİRLİYKEN var olan oku GÜNCELLER', async () => {
    /* Aynı kusur sınıfının ÜÇÜNCÜ kopyası: fonksiyon iki iş yapıyor —
       var olan source'a setData (stil GEREKTİRMEZ) ve source/katman yaratma
       (gerektirir). Tek tepe kapısı ikisini birden öldürüyordu → ok bir kez
       kurulsa bile sürüşte bir daha güncellenmiyordu. */
    const { setPaintedArrow } = await import('../platform/map/MapLayerManager');
    let written = 0;
    const mockMap = {
      isStyleLoaded: () => false,                    // KİRLİ stil — normal sürüş
      getSource: () => ({ setData: () => { written++; } }),
      getLayer: () => ({}),
    } as unknown as import('maplibre-gl').Map;

    setPaintedArrow(mockMap, {
      visible: true, turn: 'right', reason: 'OK',
      ring: [[34.6, 36.8], [34.61, 36.81], [34.62, 36.8]],
    } as never, 7, false);
    expect(written, 'stil kapısı geri gelmiş: manevra oku sürüşte hiç güncellenmez')
      .toBeGreaterThan(0);
  });

  it('DAVRANIŞ: setPaintedArrow stil hazır DEĞİLKEN katman YARATMAYA kalkmaz', async () => {
    /* KONTROL testi: daraltılan kapı yaratma dalında DURMALI — yoksa
       `addSource` yüklenmemiş stile yazıp hata üretir. */
    const { setPaintedArrow, _resetPaintedArrowCache } = await import('../platform/map/MapLayerManager');
    _resetPaintedArrowCache();
    let added = 0;
    const mockMap = {
      isStyleLoaded: () => false,
      getSource: () => undefined,                    // source YOK → yaratma dalı
      getLayer: () => undefined,
      addSource: () => { added++; },
      addLayer:  () => { added++; },
    } as unknown as import('maplibre-gl').Map;

    expect(() => setPaintedArrow(mockMap, {
      visible: true, turn: 'right', reason: 'OK',
      ring: [[34.6, 36.8], [34.61, 36.81], [34.62, 36.8]],
    } as never, 7, false)).not.toThrow();
    expect(added, 'stil hazır değilken katman yaratılmış').toBe(0);
  });

  it('YAPISAL: MiniMapWidget güncelleme yolu çıplak isStyleLoaded kapısıyla kilitli DEĞİL', () => {
    const src = read('src/components/map/MiniMapWidget.tsx');
    expect(src, 'kare-başı çıplak stil kapısı geri gelmiş — sürüşte fix\'ler yutulur')
      .not.toMatch(/if \(!mapRef\.current\.isStyleLoaded\(\)\) return;/);
  });

  it('YAPISAL: MiniMapWidget init yolu stil kapısıyla SONSUZA DEK engellenmez (Rover görünür)', () => {
    // SÖZLEŞME GÜNCELLENDİ (saha 2026-07-17: "mini haritada araç gözükmüyor, tam ekranda
    // gözüküyor"). ESKİ kilit init yolunda `!_initialized && !isStyleLoaded() → return`
    // kapısını ZORUNLU tutuyordu. Ama Android WebView'da `style.load` bazen HİÇ GELMEZ
    // (FullMapView'ın kendi "Stuck-LOADING guard"ı bunun kanıtı; o, marker'ı isStyleLoaded()
    // SORMADAN ekliyor) → isStyleLoaded() sonsuza dek false → addUserMarker HİÇ çağrılmaz
    // → Rover mini haritada ASLA çizilmez. Kilit KALDIRILMADI, yeni doğru davranışa GÜNCELLENDİ.
    //
    // YENİ SÖZLEŞME: init DENENİR; stil gerçekten hazır değilse addUserMarker throw eder,
    // `_initialized` false kalır ve BİR SONRAKİ GPS fix'inde tekrar denenir (fail-soft).
    const src = read('src/components/map/MiniMapWidget.tsx');
    expect(src, 'init yolu erken-return ile sonsuza dek engellenmiş — Rover hiç çizilmez')
      .not.toMatch(/if \(!mapRef\.current\._initialized && !mapRef\.current\.isStyleLoaded\(\)\) return;/);
    expect(src, 'init yolundaki addUserMarker try/catch ile korunmalı (stil hazır değilse retry)')
      .toMatch(/try \{[\s\S]{0,200}addUserMarker\(mapRef\.current/);
  });

  it('YAPISAL: FullMapView rAF tick takip yolu isStyleLoaded ile kapılanmaz', () => {
    const src = read('src/components/map/FullMapView.tsx');
    expect(src, 'tick interpolasyon yolu stil kapısına bağlanmış — takip tile yükünde durur')
      .not.toMatch(/buffer\.length >= 2 && mapRef\.current && mapRef\.current\.isStyleLoaded\(\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   ESKİ WEBVIEW MODERN PAKET SÖZDİZİMİ KİLİDİ — Duster "BAŞLATILAMADI"
   Regresyon (SAHA 2026-07-04, Duster T507 açılış ekranı fotoğraflı):
   "Uncaught SyntaxError: Unexpected token . (satır: 1)". Kök neden:
   @vitejs/plugin-legacy `modernTargets` verilmezse build.target'ı (es2015)
   SESSİZCE EZİP modern chunk'ları chrome>=105 hedefiyle derler → ?. / ??
   sözdizimi pakette kalır. Modern-tarayıcı tespiti ise yalnız ~Chrome 64
   özelliklerini yoklar → Chrome 64-79 WebView (Duster) tespiti GEÇER ama
   paketi PARSE EDEMEZ. Kural: modernTargets tespit eşiğiyle aynı tabana
   (chrome>=64) sabitlenir; modernPolyfills açık kalır.
   ─────────────────────────────────────────────────────────────── */
describe('Eski WebView modern paket sözdizimi kilidi (Duster BAŞLATILAMADI)', () => {
  it('YAPISAL: plugin-legacy modernTargets chrome>=64 tabanına sabit', () => {
    const src = read('vite.config.ts');
    expect(src, "modernTargets kaldırılmış — plugin-legacy modern chunk'ları chrome105'e derler, Chrome 64-79 WebView satır 1'de ölür")
      .toMatch(/modernTargets:\s*'chrome>=64/);
    expect(src, 'modernPolyfills kapatılmış — Chrome 64-78 runtime API eksikleri (Object.fromEntries vb.) çöker')
      .toMatch(/modernPolyfills:\s*true/);
  });
});

describe('Eski WebView compute-worker kilidi (VehicleCompute/VisionCompute Chrome 52+)', () => {
  // KÖK NEDEN (2026-07-04): 3 compute worker `{ type: 'module' }` ile açılıyordu →
  // modül worker Chrome 80+ ister, Duster (64-79)/8227L (52-74) WebView'ında YÜKLENMEZ.
  // Ayrıca worker chunk'ları plugin-legacy'den geçmez + build.target uygulanmaz →
  // ?./??/??= sözdizimi kalır, parse hatası. Fix: Vehicle/Vision classic IIFE +
  // vite.config transpileWorkerToES2015 (oxc es2015); Navigation modül-worker kapılı.

  // NOT: prod-classic (Chrome 52+ IIFE) garantisi vite.config `worker.format:'iife'`
  // + build-çıktısı compat kapısıdır (verify-webview-compat.mjs, ES2015/script parse).
  // Kaynakta {type:'module'} kalır → Vite DEV worker'ı modül servis eder (import çalışır);
  // format:'iife' build'de classic'e zorlar. (Ternary Vite'ı kırıyor: options statik olmalı.)
  it('YAPISAL: VehicleCompute worker referansı + try/catch fail-soft', () => {
    expect(vehicleResolverSrc, 'VehicleCompute.worker referansı kaybolmuş')
      .toMatch(/VehicleCompute\.worker/);
    expect(vehicleResolverSrc, 'Worker yaratımı try/catch ile sarılmamış — çok eski WebView constructor throw ederse boot çöker')
      .toMatch(/try\s*{[\s\S]*new Worker\([\s\S]*catch/);
  });

  it('YAPISAL: VisionCompute worker referansı', () => {
    expect(visionCoreSrc).toMatch(/VisionCompute\.worker/);
  });

  it('YAPISAL: NavigationCompute WebView<80 kapısı (supportsModuleWorker) + modül kalır', () => {
    expect(offlineRoutingSrc, 'NavigationCompute supportsModuleWorker kapısı kaldırılmış — eski WebView modül worker/sql.js yüklemeye çalışıp çöker')
      .toMatch(/supportsModuleWorker/);
    expect(offlineRoutingSrc, "NavigationCompute modül worker olmalı (sql.js dinamik import/WASM) — classic'e çevrilirse build kırılır")
      .toMatch(/type:\s*['"]module['"]/);
  });

  it('YAPISAL: supportsModuleWorker Chrome<80 kapısı sabit', () => {
    expect(deviceCapabilitiesSrc, 'supportsModuleWorker export kaldırılmış')
      .toMatch(/export function supportsModuleWorker/);
    expect(deviceCapabilitiesSrc, 'webViewVersion < 80 eşiği kaldırılmış — modül worker Chrome 80+ gerektirir')
      .toMatch(/webViewVersion\s*<\s*80/);
  });

  it('YAPISAL: vite.config worker chunk es2015 transpile adımı sabit', () => {
    const src = read('vite.config.ts');
    expect(src, 'transpileWorkerToES2015 plugin kaldırılmış — worker chunk ?./?? sözdizimi eski WebView\'da parse hatası')
      .toMatch(/transpileWorkerToES2015/);
    expect(src, 'worker.plugins wiring kaldırılmış — transpile adımı worker alt-build\'e bağlanmıyor')
      .toMatch(/worker:\s*{[\s\S]*plugins:\s*\(\)\s*=>\s*\[\s*transpileWorkerToES2015/);
    expect(src, 'worker transpile hedefi es2015 değil — ?. ??  Chrome<80\'de düşmez')
      .toMatch(/target:\s*'es2015'/);
  });

  // KÖK NEDEN (SAHA 2026-07-06, /admin/tani olay izi + robot): VehicleCompute worker
  // satır-1'de "Uncaught ReferenceError: require is not defined" ile ölüyordu → araç
  // veri katmanı ölü (heartbeat yok). Sebep: oxc es2015'e indirirken class-field'ı
  // (`x = 0`, ör. OdometerGuard) `_defineProperty` helper'ına çeviriyor ve onu Runtime
  // modunda `require("@oxc-project/runtime/helpers/defineProperty")` ile çağırıyor;
  // IIFE worker'da `require` YOK. Fix: transformWithOxc'a assumptions.setPublicClassFields
  // → class-field düz atamaya iner, helper üretilmez. İKİ kilit: (1) seçenek sabit,
  // (2) build-guard helper require'ı kalırsa build'i düşürür (sessiz worker-ölümü yok).
  it('YAPISAL: worker es2015 transpile class-field\'ı düz atamaya indirir (require helper YOK)', () => {
    const src = read('vite.config.ts');
    expect(src, 'assumptions.setPublicClassFields kaldırılmış — oxc class-field\'ı _defineProperty helper\'ına çevirir, IIFE worker\'da require yok → "require is not defined" ile worker ölür')
      .toMatch(/setPublicClassFields:\s*true/);
    expect(src, 'worker chunk\'ında oxc-runtime require kalırsa build\'i DÜŞÜREN guard kaldırılmış — regresyon sessizce satışa gidebilir')
      .toMatch(/runtime helper require'ı üretti/);
  });
});

describe('Boot hard-guard kilidi (adb yok → ekran = teşhis aracı)', () => {
  // React MOUNT ÖNCESİ katman: parse hatası / worker throw / dinamik import reddi
  // React'e ulaşmadan index.html'de yakalanmalı (ErrorBoundary yalnız mount SONRASI).
  // adb garantisi olmayan head unit'lerde başarısızlık ekranı gerçek cihaz bilgisini
  // (Chrome/Android sürümü) basmalı — o ekranın fotoğrafı sahadaki en değerli veri.
  it('YAPISAL: index.html boot-guard senkron+async hata + cihaz teşhisi basar', () => {
    const html = read('index.html');
    expect(html, 'window.onerror kaldırılmış — parse/senkron boot hatası yakalanamaz')
      .toMatch(/window\.onerror/);
    expect(html, 'unhandledrejection dinleyici kaldırılmış — modül worker/dinamik import reddi kaçar')
      .toMatch(/unhandledrejection/);
    expect(html, 'cihaz teşhisi (_deviceDiag) kaldırılmış — hata ekranı Chrome/Android sürümünü göstermezse sahada kör kalırız')
      .toMatch(/_deviceDiag/);
    expect(html, 'Chrome sürüm ayrıştırma kaldırılmış — compat bandını belirleyen değer bu')
      .toMatch(/Chrome\\\/\(/);
    expect(html, 'BAŞLATILAMADI kurtarma ekranı kaldırılmış')
      .toMatch(/BAŞLATILAMADI/);
  });

  it('YAPISAL: boot-guard ES5-güvenli — kendisi eski WebView\'da çalışmalı (?./?? YOK)', () => {
    const html = read('index.html');
    // Guard script bloğunu izole et (bootstrapError içeren <script>).
    const m = html.match(/<script>([\s\S]*?bootstrapError[\s\S]*?)<\/script>/);
    expect(m, 'bootstrapError içeren boot-guard script bloğu bulunamadı').toBeTruthy();
    const guard = m ? m[1] : '';
    expect(guard, 'boot-guard optional chaining (?.) içeriyor — Chrome<80 guard\'ın KENDİSİ parse edemez, kurtarma ekranı da ölür')
      .not.toMatch(/\?\./);
    expect(guard, 'boot-guard nullish (??) içeriyor — Chrome<80 parse hatası')
      .not.toMatch(/\?\?/);
  });
});

describe('Play Services yok sertleştirme kilidi (dağıtıcı GApps\'siz ROM — Faz 3)', () => {
  // Dağıtıcı ROM'unda Play Services silinmiş olabilir (§HEAD_UNIT_MATRIX §3.5).
  // FCM register() throw eder → yakalanmazsa boot servisi kırılır + uzak komut ölür.
  // Fix: register try/catch + Play Services yok → uzak komutları kalıcı WS fallback'e devret.
  it('YAPISAL: pushService FCM register try/catch ile sarılı (GApps yok → boot kırılmaz)', () => {
    expect(pushServiceSrc, 'register() try/catch dışında — Play Services yok olan ROM\'da initPushService reject eder, boot servisi çöker')
      .toMatch(/try\s*{[\s\S]*PushNotifications\.register\(\)[\s\S]*catch/);
  });

  /* #647 ile GUNCELLENDI (kaldirilmadi): eski kilit dinleyicinin omrunu
     "FCM kaydi basarisiz oldu mu?" sorusuna bagliyordu. Prod olcumu
     `vehicle_push_tokens` = 0 satir -> push-to-wake HIC tetiklenmiyor; kayit
     "basarili" gorunen cihazda ise fallback de cagrilmiyor, yani dinleyici
     HIC acilmiyordu. Dogru sahiplik: omur ESLESMEYE baglidir, push yalniz
     hizlandiricidir. Kilit yeni dogru davranisi korur. */
  it('YAPISAL: pushService kalici komut dinleyicisi (push durumundan BAGIMSIZ) + durum getter', () => {
    expect(pushServiceSrc, '_ensureCommandListener kaldirilmis — eslesmis cihazda uzak komut dinleyicisi hic acilmaz')
      .toMatch(/_ensureCommandListener/);
    expect(pushServiceSrc, 'dinleyici KALICI acilmiyor — { permanent: true } kaldirilmis, bosta-kapatma araci sagir eder')
      .toMatch(/startCommandListener\(\s*vehicleId\s*,\s*\{\s*permanent:\s*true\s*\}\s*\)/);
    expect(pushServiceSrc, 'registrationError -> dinleyici baglantisi kopmus — async FCM hatasi uzak komutu oldurur')
      .toMatch(/registrationError[\s\S]*_ensureCommandListener/);
    expect(pushServiceSrc, 'init sonunda kosulsuz garanti kaldirilmis — hicbir FCM geri cagrisi gelmezse arac sagir kalir')
      .toMatch(/await _ensureCommandListener\(\);[\s\S]{0,500}return \(\) =>/);
    expect(pushServiceSrc, 'bosta-kapatma sayaci kalici dinleyiciyi de uyutuyor — _listenerOwned kapisi kaldirilmis')
      .toMatch(/function _resetWakeTimer[\s\S]{0,400}if \(_listenerOwned\) return;/);
    expect(pushServiceSrc, 'getPushStatus export kaldirilmis — teshis karti Play Services durumunu okuyamaz')
      .toMatch(/export function getPushStatus/);
  });

  it('YAPISAL: fcmService register try/catch (unhandled rejection önlenir)', () => {
    expect(fcmServiceSrc, 'fcmService register() korumasız — .catch()\'siz .then() ile çağrılıyor, GApps yoksa unhandled rejection')
      .toMatch(/try\s*{[\s\S]*PushNotifications\.register\(\)[\s\S]*catch/);
  });
});

describe('OBD Core v2 — obdStatus reason disiplini kilidi (reconnect fırtınası fix)', () => {
  // Kök neden: obdStatus native tarafta ÜÇ farklı anlamda yayınlanıyor (link_lost /
  // connect_failed / user_disconnect) ama eski kod İÇERİĞE BAKMADAN her event'te
  // reconnect tetikliyordu. Transport-fallback yolunda (_startNative CarLauncher.
  // disconnectOBD() çağrısı) bu KENDİ disconnect'imizin yankısını "gerçek kopma"
  // sanıp PARALEL reconnect turu başlatıyordu (BC8 kararsız döngü kök nedeni).
  // Bu kilit reason filtresi geri alınırsa (veya yanlış koşula değiştirilirse) düşer.
  it('YAPISAL: obdStatus handler yalnız link_lost (veya reason YOK — eski APK) reconnect tetikler', () => {
    expect(obdServiceSrc, "'obdStatus' addListener callback'i reason parametresi almıyor — filtre kaldırılmış olabilir")
      .toMatch(/'obdStatus'[\s\S]{0,400}reason/);
    expect(obdServiceSrc, "reason!=='link_lost' erken-çıkış guard'ı kaldırılmış — connect_failed/user_disconnect yankıları artık ayrışmıyor")
      .toMatch(/event\.reason\s*!==\s*undefined\s*&&\s*event\.reason\s*!==\s*'link_lost'/);
  });

  it('YAPISAL: _notify clock-jump koruması — saat geriye sıçrarsa bildirim sonsuza dek boğulmaz', () => {
    // stopOBD() sonrası _lastNotifyTime=0'a resetlenir; fake-timer/NTP/RTC saat sıçramasında
    // (now - _lastNotifyTime) NEGATİF olabilir → guard olmadan debounce koşulu sonsuza dek
    // doğru kalır ve _current güncellenmeye devam ederken hiçbir dinleyici haberdar olmaz.
    expect(obdServiceSrc, 'elapsed >= 0 guard\'ı kaldırılmış — saat geriye sıçrarsa _notify() sessizce boğulur')
      .toMatch(/elapsed\s*>=\s*0\s*&&\s*elapsed\s*<\s*debounceMs/);
  });

  it("YAPISAL: PROTOCOL_CYCLE yalnız OBD_UNABLE_TO_CONNECT sınıfı hatada ilerler (Patch 3)", () => {
    // Kök neden: eski kod PROTOCOL_CYCLE'ı _reconnectAttempts'e (HER türlü hata — BT/soket/
    // timeout dahil) bağlıyordu → geçerli bir protokolü BT gürültüsü yüzünden gereksiz yere
    // terk edip yanlış protokole geçmeye zorluyordu. Bu kilit düşerse protokol döngüsü tekrar
    // her hatada ilerlemeye başlar.
    expect(obdServiceSrc, '_isUnableToConnectError sınıflandırıcısı kaldırılmış')
      .toMatch(/_isUnableToConnectError/);
    expect(obdServiceSrc, "code==='OBD_UNABLE_TO_CONNECT' kontrolü kaldırılmış — mesaj string parse'ına geri dönülmüş olabilir")
      .toMatch(/code\s*===\s*'OBD_UNABLE_TO_CONNECT'/);
    expect(obdServiceSrc, '_protocolCycleIndex artık _isUnableToConnectError sonucuna bağlı değil')
      .toMatch(/_isUnableToConnectError\(ePrimary\)\s*\|\|\s*_isUnableToConnectError\(eFallback\)[\s\S]{0,80}_protocolCycleIndex\+\+/);
  });

  it('YAPISAL: öğrenilen ELM327 protokolü persist edilir, sonraki bağlantı aramasız (Patch 3)', () => {
    expect(obdServiceSrc, 'loadObdProtocol import kaldırılmış — öğrenilen protokol artık okunmuyor')
      .toMatch(/loadObdProtocol/);
    expect(obdServiceSrc, 'saveObdProtocol çağrısı kaldırılmış — ATDPN ile öğrenilen protokol persist edilmiyor')
      .toMatch(/saveObdProtocol\(/);
  });

  it('YAPISAL: öğrenilmiş protokol TIMEOUT ile SİLİNMEZ — yalnız oturum-içi bypass (OBD-OS-F0-2)', () => {
    // Kök neden: timeout, "protokol yanlış"ın kanıtı DEĞİLDİR — yavaş/flaky KWP-ISO9141
    // araçlar (Trafic) soğuk açılışta timeout üretir. Eski kod kalıcı obd:lastProtocol'ü
    // siliyordu → DOĞRU protokol çöpe gidiyor, her açılış yavaş ATSP0-aramaya düşüyordu.
    // Bu kilit düşerse kalıcı silme geri gelmiş demektir.
    expect(obdServiceSrc, 'obdService yeniden clearObdProtocol() çağırıyor — timeout kalıcı protokolü siliyor olabilir (F0-2 ihlali)')
      .not.toMatch(/clearObdProtocol\s*\(/);
    expect(obdServiceSrc, '_learnedProtocolBypassed kaldırılmış — oturum-içi bypass mekanizması yok')
      .toMatch(/_learnedProtocolBypassed/);
    // Bypass GERÇEKTEN etkili olmalı: forcedProtocol hesabında learned okuma bypass'a bağlı.
    // (2026-07-15: ternary → if/else. Kilit KALDIRILMADI, yeni doğru davranışa taşındı —
    // bypass artık TEK KULLANIMLIK olduğu için okuma noktası bayrağı da tüketiyor.)
    expect(obdServiceSrc, 'bypass edilmiş protokol hâlâ zorlanıyor — loadObdProtocol() bypass kapısından geçmiyor')
      .toMatch(/if\s*\(_learnedProtocolBypassed\)\s*\{[\s\S]{0,120}?_learnedProtocol\s*=\s*null/);
    expect(obdServiceSrc, 'bypass yolunda loadObdProtocol() okunuyor — bypass etkisiz')
      .toMatch(/\}\s*else\s*\{[\s\S]{0,80}?_learnedProtocol\s*=\s*loadObdProtocol\(\)/);
  });

  it('YAPISAL: protokol bypass’ı TEK KULLANIMLIK — tek-araç kullanıcısı cezalandırılmaz (2026-07-15)', () => {
    // Kök neden (saha): dongle Trafic(KWP/5)→Doblo(CAN/7) aynı oturumda taşınınca öğrenilmiş
    // protokol sonsuza dek zorlanıyordu → deep-reconnect sonsuz "Bağlanıyor…" → kullanıcı
    // uygulamayı öldürmek zorunda kalıyordu. Çözüm ısrarlı timeout'ta bypass — AMA kalıcı
    // bypass yeni bir zarar üretir: park halinde (kontak kapalı → dongle güçsüz) timeout'lar
    // birikir, bunlar protokolün yanlış olduğunun kanıtı DEĞİLDİR (BT'ye hiç bağlanılamadı) →
    // her sabah aracına binen tek-araç kullanıcısı yavaş ATSP0-aramasına mahkûm olurdu.
    // Bu kilit düşerse ya sonsuz döngü ya da tek-araç cezası geri gelmiş demektir.
    expect(obdServiceSrc, 'bypass tüketilmiyor — KALICI bypass tek-araç kullanıcısını her açılışta ATSP0-aramasına mahkûm eder')
      .toMatch(/_learnedProtocolBypassed\s*=\s*false;\s*\/\/\s*tek kullanımlık/);
    // Flaky-araç toleransı: bu oturumda bağlanan protokol için eşik YÜKSEK ama SONSUZ DEĞİL.
    expect(obdServiceSrc, 'LEARNED_PROTOCOL_TIMEOUT_LIMIT_AFTER_SUCCESS yok — flaky/araç-değişimi dengesi kayboldu')
      .toMatch(/LEARNED_PROTOCOL_TIMEOUT_LIMIT_AFTER_SUCCESS/);
    // Eski hata geri gelmesin: lastSuccessAt KOŞULSUZ return ETMEMELİ (bypass'ı tümden engellerdi).
    expect(obdServiceSrc, 'lastSuccessAt koşulsuz return — araç değişiminde bypass ASLA çalışmaz (sonsuz "Bağlanıyor…")')
      .not.toMatch(/if\s*\(_lastHandshakeSuccessAt\s*!=\s*null\)\s*return;/);
    // Başarıda sayaç sıfırlanmalı: gerçek flaky araç (arada bağlanan) eşiğe ulaşmasın.
    expect(obdServiceSrc, 'başarılı handshake sayacı sıfırlamıyor — flaky araç zamanla yanlışlıkla bypass edilir')
      .toMatch(/_lastHandshakeSuccessAt\s*=\s*Date\.now\(\);[\s\S]{0,700}?_learnedProtocolTimeouts\s*=\s*0;/);
  });

  it('YAPISAL: handshake POLL_FAST\'i preempt ETMEZ — adım adım DISCOVERY kuyruğu (OBD-OS-F0-3)', () => {
    // Kök neden: el sıkışması (VIN + 6 bitmap bloğu, en kötü ~10 sn) USER önceliğiyle TEK
    // atomik kuyruk görevi olarak koşuyordu. ELM327 senkron → ÇALIŞAN görev kesilemez →
    // hız/RPM (3 Hz hot-path) bu süre boyunca tamamen aç kalıyor, data-gate "veri gelmiyor"
    // deyip bağlantıyı koparıyordu (data_gate_loss). İKİ koşul birden gerekli:
    //   (a) DISCOVERY önceliği POLL_FAST'in ALTINDA olmalı, VE
    //   (b) handshake ADIM ADIM kuyruğa girmeli (yoksa öncelik tek başına işe yaramaz).
    const queueSrc = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmCommandQueue.java');
    const elmSrc   = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
    const obdMgr   = read('android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java');
    const bleMgr   = read('android/app/src/main/java/com/cockpitos/pro/obd/BleObdManager.java');

    // (a) Enum SIRASI önceliktir (compareTo → ordinal): USER < POLL_FAST < DISCOVERY < POLL_SLOW.
    expect(queueSrc, 'DISCOVERY önceliği kaldırılmış veya POLL_FAST\'in ÜSTÜNE alınmış — keşif hot-path\'i preempt eder')
      .toMatch(/enum\s+Priority\s*\{\s*USER\s*,\s*POLL_FAST\s*,\s*DISCOVERY\s*,\s*POLL_SLOW\s*\}/);

    // (b) Zincir adım adım: performHandshakeRaw bir step-runner ALIR (tek atomik görev DEĞİL).
    expect(elmSrc, 'HandshakeStepRunner kaldırılmış — handshake yeniden tek atomik görev olmuş olabilir')
      .toMatch(/performHandshakeRaw\s*\(\s*HandshakeStepRunner/);

    // Her iki transport da handshake\'i DISCOVERY ile kuyruğa vermeli; USER\'a geri dönmemeli.
    for (const [name, src] of [['OBDManager', obdMgr], ['BleObdManager', bleMgr]] as const) {
      expect(src, `${name}.performHandshake DISCOVERY önceliğini kullanmıyor`)
        .toMatch(/performHandshakeRaw\(step\s*->\s*\{[\s\S]{0,200}Priority\.DISCOVERY/);
      expect(src, `${name}.performHandshake hâlâ USER önceliğiyle tek atomik görev gönderiyor`)
        .not.toMatch(/submit\(\s*ElmCommandQueue\.Priority\.USER\s*,\s*null\s*,\s*p::performHandshakeRaw\s*\)/);
    }
  });

  it('YAPISAL: handshake kanıtı AYNI OTURUMDA poll listesine uygulanır (saha 2026-07-31)', () => {
    // Kök neden (gerçek araç, protokol 7): çekirdek PID kümesi YALNIZ `connectOBD({pids})`
    // ile bağlanma anında gidiyordu; araç desteklediği PID'leri handshake'te (bağlantıdan
    // SONRA) bildirdiği için kanıt geldiğinde liste bir daha uygulanamıyordu. Ölçüldü:
    // bitmap `4100983B0011` → PID 0x11 DESTEKLENMİYOR, buna rağmen `0111` her poll turunda
    // soruluyor ve her turda `NO DATA` + `ECU_NO_RESPONSE` üretiyordu.
    // Bu kilit düşerse "araç desteklemiyorum dedi, biz sormaya devam ediyoruz" geri gelir.
    expect(obdServiceSrc, 'handshake sonrası setObdCorePids çağrısı kaldırılmış — rafine liste oturum içinde uygulanmıyor')
      .toMatch(/CarLauncher\.setObdCorePids/);
    expect(obdServiceSrc, 'rafine liste handshake kanıtından (readBlocks/supportedPids) türetilmiyor')
      .toMatch(/readBlocks\.size\s*>\s*0[\s\S]{0,400}?refinePidList\([\s\S]{0,400}?setObdCorePids/);
    // Fail-soft: boş liste GÖNDERİLMEMELİ — native'de boş küme "filtre yok" demektir,
    // "hiç sorma" değil; yanlışlıkla tüm filtreyi kaldırmak yerine hiç dokunmamak doğrudur.
    expect(obdServiceSrc, 'boş rafine liste koruması kaldırılmış — filtre yanlışlıkla tümden kalkabilir')
      .toMatch(/refined\.length\s*>\s*0/);

    // Native: kümeyi oturum içinde değiştirebilen setter HER İKİ transport'ta olmalı.
    // (PR-OBD-BLE-1 dersi: yalnız Classic'e uygulanan ayar BLE dongle'lı araçta hiç geçerli olmaz.)
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    const obdMgr = read('android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java');
    const bleMgr = read('android/app/src/main/java/com/cockpitos/pro/obd/BleObdManager.java');
    expect(obdMgr, 'OBDManager.setCorePidSet kaldırılmış').toMatch(/public\s+void\s+setCorePidSet\s*\(/);
    expect(bleMgr, 'BleObdManager.setCorePidSet kaldırılmış — BLE yolunda filtre oturum içinde güncellenmez')
      .toMatch(/public\s+void\s+setCorePidSet\s*\(/);
    expect(plugin, 'setObdCorePids köprüsü BLE yöneticisine uygulanmıyor — BLE dongle\'da desteklenmeyen PID sorulmaya devam eder')
      .toMatch(/setObdCorePids\(PluginCall[\s\S]{0,400}?bleObdManager\s*!=\s*null\)\s*bleObdManager\.setCorePidSet/);
  });

  it('YAPISAL: VIN yoklaması BÜTÇELİ — çok-ECU denemesi hattı boğmaz (saha 2026-07-31)', () => {
    // Kök neden: VIN artık sabit 7E0/7E8 yerine KEŞFEDİLEN ECU'lardan okunuyor (29-bit
    // araçlarda VIN hiç okunamıyordu). Ama izleyici HER OBD veri olayında tetikler ve VIN
    // okunamayınca `_sessionDone` işaretlenmez → yoklama anında yeniden başlar. Sınır
    // olmadan bu, her denemede `discoverEcus()` (ATH1+0100 broadcast+ATH0) + MAX_ECUS kez
    // `22F190` demek olur → çekirdek poll'u sürekli bekletir ("bayat veri" ARTAR).
    const src = read('src/platform/obd/autoDidDiscovery.ts');
    expect(src, 'VIN_PROBE_MAX_ATTEMPTS kaldırılmış — başarısız VIN yoklaması sınırsız tekrar eder')
      .toMatch(/VIN_PROBE_MAX_ATTEMPTS/);
    expect(src, 'VIN_PROBE_COOLDOWN_MS kaldırılmış — denemeler arası zorunlu sessizlik yok')
      .toMatch(/VIN_PROBE_COOLDOWN_MS/);
    expect(src, 'bütçe kapısı fonksiyon girişinde yok — ağır yoklama yine her veri olayında koşabilir')
      .toMatch(/_vinProbeAttempts\s*>=\s*VIN_PROBE_MAX_ATTEMPTS\)\s*return;[\s\S]{0,200}?_vinProbeBlockedUntil\)\s*return;/);
    expect(src, 'VIN başarısızlığında sayaç/soğuma güncellenmiyor — kapı hiç kapanmaz')
      .toMatch(/_vinProbeAttempts\s*\+=\s*1;[\s\S]{0,200}?_vinProbeBlockedUntil\s*=\s*Date\.now\(\)\s*\+\s*VIN_PROBE_COOLDOWN_MS/);
  });

  it('YAPISAL: obdStatus reason\'ı STATE\'e göre ayrışır — çift reconnect motoru yok (OBD-OS-F0-5)', () => {
    // Kök neden: köprü state'e BAKMADAN her bildirime "link_lost" damgası vuruyordu →
    // native attemptReconnect() "reconnecting" derken TS kopma sanıp PARALEL tur açıyor,
    // native "connected" (BAŞARI) derken bile TS iyileşmiş bağlantıyı yeniden kuruyordu.
    // Bu kilit düşerse çift-motor çakışması geri gelir.
    const pluginSrc = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(pluginSrc, '"reconnecting" durumu native_reconnecting reason\'ı üretmiyor — TS paralel tur açar')
      .toMatch(/"reconnecting"\.equals\(state\)[\s\S]{0,60}native_reconnecting/);
    expect(pluginSrc, '"connected" durumu native_reconnected reason\'ı üretmiyor — TS başarıyı kopma sanar')
      .toMatch(/"connected"\.equals\(state\)[\s\S]{0,60}native_reconnected/);

    /* ── P0-OBD-FINAL-01 · ÜÇÜNCÜ SONUÇ: BAŞARISIZLIK ────────────────────
       Eskiden yalnız "başladı" ve "başardı" bildiriliyordu. Native turun
       BAŞARISIZ bitişi hiçbir olay üretmiyordu; TS otoriteyi 60 s fail-safe
       zamanlayıcısıyla geri alıyordu → her başarısız reconnect 60 s ölü
       pencere ("aynı oturumda tekrar tekrar 60 s"). Bu kilit düşerse o
       pencere geri gelir. */
    expect(pluginSrc, '"reconnect_failed" durumu köprüde eşlenmiyor — başarısız tur TS\'e ULAŞMAZ')
      .toMatch(/"reconnect_failed"\.equals\(state\)[\s\S]{0,80}native_reconnect_failed/);
    const mgrSrc = read('android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java');
    expect(mgrSrc, 'attemptReconnect tükendiğinde TERMİNAL olay yayınlamıyor — otorite native\'de asılı kalır')
      .toMatch(/onStatusChanged\("reconnect_failed"/);

    // TS tarafı: otorite bayrağı reconnect tetikleyen HER üç yolu da kapatmalı.
    expect(obdServiceSrc, '_nativeReconnectInFlight kaldırılmış — native reconnect sürerken TS karışabilir')
      .toMatch(/_nativeReconnectInFlight/);
    /* Sessiz (karışmayan) yollar: stale watchdog + data gate. Status listener
       ARTIK SESSİZ DEĞİLDİR — devir teslim yapar; bu yüzden sayı 2'dir. */
    const guards = obdServiceSrc.match(/if\s*\(\s*_nativeReconnectInFlight\s*\)\s*return/g) ?? [];
    expect(guards.length, 'otorite guard\'ı iki sessiz yolda da (stale watchdog + data gate) olmalı')
      .toBeGreaterThanOrEqual(2);
    /* Status listener'daki link_lost dalı ARTIK YUTMAZ: terminal sayıp otoriteyi
       geri verir. Sessiz `return`'e geri dönerse 60 s ölü pencere de geri döner. */
    expect(obdServiceSrc, 'link_lost dalı native reconnect uçuştayken hâlâ YUTUYOR — 60 s ölü pencere geri geldi')
      .toMatch(/if\s*\(\s*_nativeReconnectInFlight\s*\)\s*\{\s*_failNativeReconnect\('link_lost'\)/);
    expect(obdServiceSrc, 'native_reconnect_failed olayı TS tarafında ELE ALINMIYOR')
      .toMatch(/native_reconnect_failed'\s*\)\s*\{\s*_failNativeReconnect\('failed'\)/);
  });

  it('YAPISAL: P0-OBD-FINAL-01 — KWP/ISO ECU keşfi ve adres UYDURMAMA kilidi', () => {
    /* Kök neden (saha, Protocol 5): `parseEcuProbe` yalnız CAN header'ı
       tanıyordu; KWP yanıtı ("48 6B 10 …") hiçbir kalıba uymuyor, topoloji boş
       kalıyor ve motor dışında HİÇBİR ECU sorulmuyordu. İkinci kusur:
       `kwpTargetVerified` hiçbir yerde true olmadığı için KWP 0x18 (üretici
       DTC) HİÇ gönderilmiyordu. Bu kilitler düşerse ikisi de geri gelir. */
    const disc = read('src/platform/obd/ecuDiscovery.ts');
    expect(disc, 'KWP/ISO header eşleştiricisi kaldırılmış — yavaş seri hatta topoloji yine BOŞ kalır')
      .toMatch(/matchKwpHeader/);
    expect(disc, 'tester adresi kalıbı (F1|6B) yok — KWP header\'ı tanınamaz')
      .toMatch(/KWP_HEADER_RE\s*=\s*\/\^\[0-9A-F\]\{2\}\(F1\|6B\)/);
    expect(disc, 'protokol bilinmiyorken tx UYDURULUYOR — yanlış adrese istek gider')
      .toMatch(/txProvenance:\s*TxHeaderProvenance\s*=\s*'unknown'/);

    const scan = read('src/platform/obd/multiEcuScan.ts');
    expect(scan, 'fiziksel hedef kapısı yok — boş tx native\'de FONKSİYONEL hatta sızar')
      .toMatch(/_hasPhysicalTarget/);
    expect(scan, 'adreslenebilirlik ÖLÇÜLMÜYOR — kwpTargetVerified yine hiç true olmaz')
      .toMatch(/addressabilityFromOutcome/);
    expect(scan, 'ECU başına admisyon kapısı kaldırılmış — tarama ortasında oturum değişimi görünmez')
      .toMatch(/_admissionFor\(ecu,\s*sessionEpoch\)/);
    expect(scan, 'notAddressableKeys kapsam kanıtına taşınmıyor — ulaşılamayan ECU "tarandı" sayılır')
      .toMatch(/notAddressableKeys,/);
  });

  it('YAPISAL: PR-OBD-PAIR-CONTINUITY — ilk-eşleştirme bonding sürekliliği (Classic, PAIR_WITH_PIN/WAIT_BONDING)', () => {
    // Kök neden: OBDManager.connect() eski 15s POLLING waitForBond kullanıyordu; insan
    // Android sistem PIN dialog'unu yanıtlarken bu pencereyi kolayca aşıyordu. Bonding
    // SONRADAN bitse bile bunu duyacak/devam ettirecek bir tetik yoktu → ilk oturum hiç
    // başlamıyor, kullanıcı 2. kez "Bağlan" demek zorunda kalıyordu. Bu kilit düşerse
    // receiver-latch süreklilik mekanizması geri alınmış demektir.
    const pairingGateSrc = read('android/app/src/main/java/com/cockpitos/pro/obd/PairingGate.java');
    const obdMgrSrc       = read('android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java');

    // Saf karar haritası — JUnit'te (PairingGateTest) ayrıca kilitlenir; burada sadece
    // native tarafın onu KULLANDIĞINI (ham switch'e geri dönmediğini) doğrular.
    expect(pairingGateSrc, 'PairingGate.waitStrategyFor kaldırılmış — bond-bekleme stratejisi saf haritadan gelmiyor')
      .toMatch(/public static WaitStrategy waitStrategyFor\(Decision d\)/);
    expect(pairingGateSrc, 'WaitStrategy enum kaldırılmış')
      .toMatch(/enum WaitStrategy\s*\{[\s\S]{0,120}NONE,/);

    expect(obdMgrSrc, 'ensureBonded() artık PairingGate.waitStrategyFor kullanmıyor — eski ham switch(Decision) geri gelmiş olabilir')
      .toMatch(/PairingGate\.WaitStrategy strategy = PairingGate\.waitStrategyFor\(d\)/);
    expect(obdMgrSrc, 'BOND_WAIT_TIMEOUT_MS (90s ilk-eşleştirme penceresi) kaldırılmış')
      .toMatch(/BOND_WAIT_TIMEOUT_MS\s*=\s*90_000L/);
    expect(obdMgrSrc, 'waitForBondViaReceiver kaldırılmış — receiver-latch bekleme yok')
      .toMatch(/private boolean waitForBondViaReceiver\(/);
    expect(obdMgrSrc, 'ACTION_BOND_STATE_CHANGED receiver\'ı kaldırılmış — POLLING\'e geri dönülmüş olabilir')
      .toMatch(/ACTION_BOND_STATE_CHANGED/);
    // Zero-leak: receiver HER ZAMAN finally'de unregister edilmeli.
    expect(obdMgrSrc, 'waitForBondViaReceiver zero-leak değil — finally bloğunda unregisterReceiver yok')
      .toMatch(/finally\s*\{\s*try\s*\{\s*mContext\.unregisterReceiver\(receiver\)/);

    // BİLİNÇLİ KAPSAM: CONNECT_WITHOUT_PAIRING (native createBond ÇAĞIRMAZ) receiver-latch
    // bekleme almaz — bonding hiç gerektirmeyen (insecure-only) adaptörlerde asla gelmeyecek
    // bir BOND_BONDED sinyalini boşuna bekleyip regresyon üretirdi. Bu dalın gerçek düzeltmesi
    // JS tarafındaki connect-timeout uzatmasıdır (aşağıdaki PAIRING_GRACE kilidi).
    expect(pairingGateSrc, 'CONNECT_WITHOUT_PAIRING artık NONE dönmüyor — bilinçli kapsam kararı değişmiş olabilir')
      .toMatch(/default:\s*return WaitStrategy\.NONE;/);
  });

  it('YAPISAL: PR-OBD-PAIR-CONTINUITY — JS ilk-eşleştirme grace timeout (Classic, bonded değilken)', () => {
    // JS tarafı: native socket.connect() bonding'i (CONNECT_WITHOUT_PAIRING dahil) senkron
    // beklerken, eski 8-15s Promise.race timeout'u bu denemeyi native TAMAMLANMADAN reddediyordu
    // — native taraf SONRADAN başarılı olsa bile PluginCall sonucu sessizce yok sayılıyordu.
    expect(obdServiceSrc, 'PAIRING_GRACE_TIMEOUT_MS sabiti kaldırılmış')
      .toMatch(/const PAIRING_GRACE_TIMEOUT_MS = 90_000;/);
    expect(obdServiceSrc, '_userInitiatedFreshAddress bayrağı kaldırılmış')
      .toMatch(/let _userInitiatedFreshAddress = false;/);
    // Bayrak YALNIZ startOBD(address, …) çağrısında (kullanıcı eylemi) set edilmeli —
    // soğuk-boot no-arg reconnect yolu bunu HİÇ görmemeli.
    expect(obdServiceSrc, "_userInitiatedFreshAddress artık startOBD'nin address bloğunda set edilmiyor — soğuk-boot ile ayrışma bozulmuş olabilir")
      .toMatch(/if \(address\) \{[\s\S]{0,400}_userInitiatedFreshAddress = true;/);
    // Bayrak stopOBD()'de temizlenmeli — yarım kalmış bir deneme sonraki ilgisiz reconnect'e sızmasın.
    expect(obdServiceSrc, 'stopOBD() artık _userInitiatedFreshAddress\'i temizlemiyor — stale bayrak sonraki reconnect\'e sızabilir')
      .toMatch(/_running = false;\s*\n\s*_nativeGeneration\+\+;[\s\S]{0,450}_userInitiatedFreshAddress = false;/);
    // Grace yalnız bonded DEĞİLKEN ve yalnız 'classic' bacağında uygulanmalı.
    expect(obdServiceSrc, 'grace artık getObdBondState sonucuna (bonded) göre koşullanmıyor')
      .toMatch(/if \(!bonded\) \{[\s\S]{0,350}PAIRING_GRACE_TIMEOUT_MS/);
    expect(obdServiceSrc, "grace 'classic' dışı transport'a (BLE/TCP) da uygulanıyor olabilir — yalnız classic bacağı hedeflenmeli")
      .toMatch(/_primaryTp === 'classic'\)\s*_primaryTimeoutMs\s*=\s*Math\.max/);
  });

  it('GÜVENLİK: Mode 04 (DTC silme) WriteGate\'ten geçmeden native\'e GİTMEZ (OBD-OS-F0-6)', () => {
    // Salt-okuma vaadi: araca YAZAN tek yol Mode 04'tür ve hız=0 + taze telemetri +
    // açık onay kapılarının ARDINDA olmalıdır. Kapı kanıtı ÇAĞIRANDAN değil, OBD
    // servisinden okunur (çağıran "hız 0" diye yalan söyleyemez).
    expect(dtcServiceSrc, 'evaluateDtcClearGate çağrısı kaldırılmış — DTC silme artık kapısız (seyir halinde ECU yazması mümkün)')
      .toMatch(/evaluateDtcClearGate\s*\(/);
    expect(dtcServiceSrc, 'kapı kanıtı OBD servisinden okunmuyor — çağıranın iddiasına güveniliyor olabilir')
      .toMatch(/getOBDDataSnapshot\s*\(/);
    // Reddedilen kararda native yazma YAPILMAMALI: gate reddi erken return ile biter.
    expect(dtcServiceSrc, 'gate reddinde erken çıkış yok — reddedilen karar native clearDTC() çağrısına düşebilir')
      .toMatch(/!decision\.allowed[\s\S]{0,120}return\s+gateDenied\(decision\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   ENGINE_OVERHEAT ZİNCİRİ (Vehicle Intelligence Architecture FAZ 1)
   0x05 (ECT) → VAL coolantTemp → worker histerezis → VehicleEvent →
   SystemOrchestrator (kırmızı kart + safety-overheat.wav sesli uyarı).
   Regresyon: eşik geçilince event üretilmezse veya histerezis bandı
   kaldırılırsa (trigger===reset) dur-kalk sıcaklık dalgalanmasında
   uyarı flicker eder — CLAUDE.md "Hysteresis" kuralının canlı örneği.
   ─────────────────────────────────────────────────────────────── */
describe('ENGINE_OVERHEAT zinciri kilidi (motor aşırı ısınma histerezisi)', () => {
  it('YAPISAL: trigger ≠ reset eşiği (histerezis bandı kaldırılırsa flicker döner)', () => {
    expect(vehicleComputeWorkerSrc, 'ENGINE_OVERHEAT_ON sabiti kaldırılmış')
      .toMatch(/const ENGINE_OVERHEAT_ON\s*=\s*(\d+)/);
    expect(vehicleComputeWorkerSrc, 'ENGINE_OVERHEAT_OFF sabiti kaldırılmış')
      .toMatch(/const ENGINE_OVERHEAT_OFF\s*=\s*(\d+)/);

    const onMatch  = vehicleComputeWorkerSrc.match(/const ENGINE_OVERHEAT_ON\s*=\s*(\d+)/);
    const offMatch = vehicleComputeWorkerSrc.match(/const ENGINE_OVERHEAT_OFF\s*=\s*(\d+)/);
    const on  = Number(onMatch?.[1]);
    const off = Number(offMatch?.[1]);
    expect(off, 'reset eşiği trigger eşiğine eşit/üstünde — histerezis yok, dur-kalk sıcaklıkta flicker garanti').toBeLessThan(on);
  });

  it('YAPISAL: eşik geçilince (re-arming) tek seferlik ENGINE_OVERHEAT üretilir', () => {
    expect(vehicleComputeWorkerSrc, '_overheatFired bayrağı kaldırılmış — histerezis takibi olmadan her tick\'te olay tekrar üretilir')
      .toMatch(/_overheatFired/);
    expect(vehicleComputeWorkerSrc, 'Re-arming (OFF eşiğinde bayrak sıfırlama) kaldırılmış — sıcaklık bir daha ASLA yeniden uyarmaz')
      .toMatch(/_overheatFired\s*&&\s*coolantTempC\s*<=\s*ENGINE_OVERHEAT_OFF\)\s*_overheatFired\s*=\s*false/);
    expect(vehicleComputeWorkerSrc, 'ON eşiğinde tetikleme guard\'ı kaldırılmış')
      .toMatch(/!_overheatFired\s*&&\s*coolantTempC\s*>=\s*ENGINE_OVERHEAT_ON/);
  });

  it('YAPISAL: sensör yoksa (raw==null) sahte ENGINE_OVERHEAT üretilmez (fail-soft)', () => {
    expect(vehicleComputeWorkerSrc, '_emitCoolant erken-çıkışı kaldırılmış — sensörsüz araçta/OBD kopukken sahte uyarı üretilebilir')
      .toMatch(/function _emitCoolant\(\)[\s\S]{0,400}if\s*\(raw\s*==\s*null\)\s*return/);
  });

  it('YAPISAL: imkânsız sıcaklık okuması reddedilir (sensör/adaptör glitch sanitization)', () => {
    expect(vehicleComputeWorkerSrc, 'COOLANT_TEMP_MIN/MAX sanity sınırı kaldırılmış — adaptör glitch\'i (ör. >130°C) doğrudan olaya sızabilir')
      .toMatch(/raw\s*<\s*COOLANT_TEMP_MIN\s*\|\|\s*raw\s*>\s*COOLANT_TEMP_MAX/);
  });

  it('YAPISAL: VehicleEventHub ENGINE_OVERHEAT tipini tanımlar (severity CRITICAL)', () => {
    expect(vehicleEventHubSrc, "'ENGINE_OVERHEAT' VehicleEventType union'undan kaldırılmış")
      .toMatch(/'ENGINE_OVERHEAT'/);
    expect(vehicleEventHubSrc, "ENGINE_OVERHEAT severity CRITICAL değil — P1 preemption zayıflar")
      .toMatch(/type:\s*'ENGINE_OVERHEAT';\s*severity:\s*'CRITICAL'/);
  });

  it('YAPISAL: SystemOrchestrator ENGINE_OVERHEAT\'i kırmızı kart + premium ses klibiyle işler', () => {
    expect(systemOrchestratorSrc, "case 'ENGINE_OVERHEAT' kaldırılmış — Action Engine motor aşırı ısınmasını UI'a bağlamıyor")
      .toMatch(/case 'ENGINE_OVERHEAT':/);
    expect(systemOrchestratorSrc, "severity CRITICAL kaldırılmış — alert artık P1 önceliğinde değil")
      .toMatch(/case 'ENGINE_OVERHEAT':[\s\S]{0,200}severity:\s*'CRITICAL'/);
    // Metin voiceClips.ts CLIP_MANIFEST anahtarıyla BİREBİR eşleşmeli — aksi halde
    // public/voice/safety-overheat.wav çalınmaz, sessizce eSpeak yedeğine düşer.
    expect(systemOrchestratorSrc, "speakAlert metni voiceClips.ts safety-overheat klip anahtarıyla eşleşmiyor — premium ses çalınmaz")
      .toMatch(/speakAlert\('Motor sıcaklığı yüksek, lütfen güvenli yerde durun\.'\)/);
  });

  // Saha 2026-07-07: app arka plan/uykudan dönünce birikmiş GPS tek tick'te işlenip
  // hız spike'ı (≥DRIVE_ON_KMH) üretiyordu → sahte DRIVING_STARTED/STOPPED → park
  // halde sahte "Yolculuk Tamamlandı" banner. Cihazda tekrar-üretildi (HOME→dönüş).
  // Resume-guard: foreground dönüşünden RESUME_TRIP_GRACE_MS içinde biten trip'te
  // banner bastırılır. Bu kilit fix'in sessizce geri alınmasını engeller.
  it('YAPISAL: SystemOrchestrator resume-guard sahte yolculuk banner\'ını bastırır', () => {
    expect(systemOrchestratorSrc, "visibilitychange dinleyicisi kaldırılmış — resume anı izlenmiyor")
      .toMatch(/addEventListener\(\s*'visibilitychange'\s*,\s*_onOrchVisibility\s*\)/);
    expect(systemOrchestratorSrc, "RESUME_TRIP_GRACE_MS guard kaldırılmış — resume artefaktı trip banner'ı yine açılır")
      .toMatch(/Date\.now\(\)\s*-\s*_lastResumeAt\s*<\s*RESUME_TRIP_GRACE_MS/);
    // Zero-leak: dinleyici teardown'da sökülmeli
    expect(systemOrchestratorSrc, "visibilitychange dinleyicisi cleanup'ta sökülmüyor — zero-leak ihlali")
      .toMatch(/removeEventListener\(\s*'visibilitychange'\s*,\s*_onOrchVisibility\s*\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   FAZ 13/16 — §L.0 Hibrit Runtime Scheduler kilitleri (tek tick-wheel).
   docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md:1176-1241. Ayrıntılı
   davranış paketi src/__tests__/runtimeScheduler.test.ts'te; burada yalnız
   temel invaryantlar kilitlenir: SAFETY periodMs'i hiçbir tier'da kısılmaz,
   NORMAL görevler (kısa periyotlu olsalar bile) düşük tier'da GERÇEKTEN
   yavaşlar (FAZ 16: eski "HOT sınıfı muaf" ayrıcalığı KALDIRILDI — yalnız
   SAFETY muaf), destroy() wheel timer'ı gerçekten durdurur (Zero-Leak).
   Not: forceMode() gerçek getDeviceTier()/hasWeakGpu()'yu kullanır — mock
   gerekmez, çünkü SAFE_MODE her zaman en düşük rank (downgrade anlık uygulanır,
   baseline ne olursa olsun).
   ─────────────────────────────────────────────────────────────── */
describe('Scheduler: SAFETY periodMs her tier\'da sabit, NORMAL düşük modda GERÇEKTEN kısılır kilidi', () => {
  afterEach(() => {
    vi.useRealTimers();
    AdaptiveRuntimeManager._resetForTest();
  });

  it('SAFE_MODE\'da (en düşük tier) SAFETY görevi hâlâ taban periodMs\'te (5000ms→15 tik) koşar', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.SAFE_MODE);
    let calls = 0;
    m.scheduleTask({ id: 'lock-safety', periodMs: 5000, criticality: 'SAFETY', fn: () => { calls++; } });

    vi.advanceTimersByTime(333 * 15); // round(5000/333)=15 tik — mod çarpanı SAFETY'yi kısamaz
    expect(calls, 'SAFETY görevi SAFE_MODE\'da kısıldı — güvenlik-kritik katman artık her tier garanti açık değil')
      .toBe(1);
  });

  it('SAFE_MODE\'da kısa periyotlu NORMAL görev de GERÇEKTEN yavaşlar (eski "HOT muafiyeti" kaldırıldı)', () => {
    vi.useFakeTimers();
    const m = forceMode(RuntimeMode.SAFE_MODE);
    let calls = 0;
    // periodMs=333 (BALANCED'ta her tik) — FAZ 16 öncesi 'HOT' sınıfı bunu her
    // tier'da sabit tutardı; artık yalnız SAFETY muaf, bu görev NORMAL →
    // SAFE_MODE çarpanı(4) uygulanır: effectiveMs=333×4=1332 → round(1332/333)=4 tik.
    m.scheduleTask({ id: 'lock-normal-fast', periodMs: 333, criticality: 'NORMAL', fn: () => { calls++; } });

    vi.advanceTimersByTime(333 * 16); // 16 tik / 4 = 4 tetiklenme beklenir (her tik DEĞİL)
    expect(calls, 'kısa periyotlu NORMAL görev SAFE_MODE\'da hâlâ her tikte koşuyor — eski HOT-muafiyeti geri gelmiş olabilir (tasarım kusuru: yavaş timer\'lar yanlışlıkla hızlandırılıyordu)')
      .toBe(4);
  });
});

describe('Scheduler destroy sonrası aktif timer=0 kilidi', () => {
  afterEach(() => {
    vi.useRealTimers();
    AdaptiveRuntimeManager._resetForTest();
  });

  it('destroy() sonrası wheel timer null, görev tetiklenmeye devam etmez', () => {
    vi.useFakeTimers();
    // forceMode(BALANCED) bu dosyada MOCK'suz gerçek getDeviceTier()'a bağlı;
    // baseline BALANCED'ın altındaysa upgrade 30s hysteresis bekler (anlık
    // olmayabilir) → SAFETY kullanılır: periodMs mod çarpanından muaf olduğundan
    // test, ortam algısının hangi mod'da kaldığından BAĞIMSIZ deterministik kalır
    // (bu testin amacı destroy() yaşam döngüsü, mod ölçeklemesi değil).
    const m = forceMode(RuntimeMode.BALANCED);
    let calls = 0;
    m.scheduleTask({ id: 'lock-destroy', periodMs: 333, criticality: 'SAFETY', fn: () => { calls++; } });
    vi.advanceTimersByTime(333);
    expect(calls).toBe(1);

    m.destroy();

    const wheelTimer = (m as unknown as { _wheelTimer: unknown })._wheelTimer;
    expect(wheelTimer, 'destroy() sonrası wheel timer temizlenmiyor — Zero-Leak ihlali (boşta uyanış devam eder)')
      .toBeNull();

    calls = 0;
    vi.advanceTimersByTime(333 * 10);
    expect(calls, 'destroy() sonrası görev hâlâ tetikleniyor — timer gerçekten durmamış')
      .toBe(0);
  });
});

describe('Sağlık rollup — donanımsız cihazda false-critical kilidi', () => {
  // SAHA BULGUSU 2026-07-06 (robot self-test'in bulduğu): getGlobalHealthSnapshot
  // "healthy"yi yalnız ham heartbeat tazeliğinden hesaplıyordu → OBD'siz + GPS
  // izinsiz HER cihaz tanıda overallHealth:critical gösteriyordu (VehicleDataLayer
  // + GPS pasif monitörleri veri kaynağı yokken unhealthy = BEKLENEN, arıza değil).
  // Fix: rollup, veri-kaynağı-yoksa (obd source==='none' + taze GPS fix yok) pasif
  // monitör yokluğunu 'critical'den DÜŞÜRÜR; kaynak VARKEN kopma yine 'critical'.

  it('overallHealth rollup beklenen-yokluk düşürmesini uygular', () => {
    expect(healthMonitorSrc).toContain('isExpectedAbsence');
    expect(healthMonitorSrc).toContain('PASSIVE_MONITORS');
    expect(healthMonitorSrc).toMatch(/getOBDStatusSnapshot\(\)\.source !== 'none'/);
    // hasCritical MUTLAKA beklenen-yokluğu dışlamalı (yoksa false-critical geri gelir).
    expect(healthMonitorSrc).toMatch(/!s\.healthy && s\.criticality === 'critical' && !isExpectedAbsence/);
  });
});

/* ───────────────────────────────────────────────────────────────
   PR 1 — Orientation Sensor Gate Foundation kilitleri.

   Kapı, ham DeviceOrientation/DeviceMotion event'lerinin MERKEZİ ref-count'lu
   sahibidir. İki davranış defalarca sessizce bozulabilir: (a) visibility
   listener'ının dispose'ta sökülmemesi (zero-leak ihlali), (b) modülün bir
   tüketici/motor import ederek bağımsızlığını + import-yan-etkisizliğini
   kaybetmesi. Bu kilitler ikisini de dondurur.
   ─────────────────────────────────────────────────────────────── */
describe('Orientation Sensor Gate — foundation kilitleri', () => {
  it('YAPISAL: gate tek visibilitychange listener kurar VE dispose\'ta söker (zero-leak)', () => {
    expect(orientationGateSrc, 'visibilitychange dinleyicisi eklenmiyor — hidden/visible gate çalışmaz')
      .toMatch(/addEventListener\(\s*'visibilitychange'\s*,\s*_onVisibilityChange\s*\)/);
    expect(orientationGateSrc, 'visibilitychange dinleyicisi sökülmüyor — zero-leak ihlali')
      .toMatch(/removeEventListener\(\s*'visibilitychange'\s*,\s*_onVisibilityChange\s*\)/);
  });

  it('YAPISAL: gate tamamen bağımsız — hiç import yok (import yan etkisiz, GPS/MapLibre/Kernel etkilenmez)', () => {
    // Tek bir top-level `import` bile yok → hiçbir tüketici/motoru import edip
    // etkileyemez; modül yüklenmesi yan etkisizdir.
    expect(orientationGateSrc, 'gate artık bağımsız değil — bir modül import edilmiş')
      .not.toMatch(/^\s*import\s/m);
  });

  it('YAPISAL: gate native sampling rate iddiası taşımaz (legacy event API frekans kontrolü yok)', () => {
    // Generic Sensor API / frekans ayarı EKLENMEMELİ — bu PR yalnız JS-tarafı
    // abonelik yönetir; native samplingPeriod PR 2/3 wiring'i ile değişir.
    expect(orientationGateSrc).not.toMatch(/new\s+(Gyroscope|Accelerometer|AbsoluteOrientationSensor|RelativeOrientationSensor)/);
    expect(orientationGateSrc).not.toMatch(/frequency\s*:/);
  });
});

/* ───────────────────────────────────────────────────────────────
   TANI RAPORU — DTC sanitize derinliği + triyaj null-guard
   Regresyon (denetim 2026-07-12, KANITLI P0): `MAX_DEPTH = 4` yüzünden DTC kod
   nesneleri (derinlik 4) sanitize'da düşüyor → kabloda `codes: [null, null]`;
   ardından triyaj `c.code` üzerinde TypeError atıp TÜM `payload.triage`
   bölümünü sessizce siliyordu → admin arıza anında "kritik bulgu yok" görüyordu.
   Davranış kilitleri: diagnosticDtcDepthTriage.test.ts (uçtan uca).
   Buradakiler KAYNAK-METİN kilitleri: sabit sessizce 4'e geri düşmesin.
   ─────────────────────────────────────────────────────────────── */
describe('Tanı raporu DTC derinlik + triyaj dayanıklılık kilidi', () => {
  it('MAX_DEPTH >= 5 — DTC kod nesneleri (derinlik 4) sanitize\'ı sağ geçmeli', () => {
    const m = remoteLogServiceSrc.match(/const\s+MAX_DEPTH\s*=\s*(\d+)/);
    expect(m, 'MAX_DEPTH sabiti bulunamadı — sanitize derinlik tavanı yeniden adlandırılmış').toBeTruthy();
    const depth = Number(m![1]);
    // 4 = DTC kodları + extended.samples + inspector timeline signals DÜŞER (P0).
    expect(depth, `MAX_DEPTH=${depth} → derinlik-4 kapları düşer; DTC kodları kabloda null gider`)
      .toBeGreaterThanOrEqual(5);
  });

  it('sanitize dizi dalı düşen elemanı ELER (sessiz null yerine kısa dizi)', () => {
    // KİLİT GÜNCELLENDİ (kaldırılmadı): Sanitize Hardening'de dizi dalı `.map().filter()`
    // yerine döngüye geçti (eleman-bazlı getter fail-soft için) — DAVRANIŞ AYNI:
    // `undefined` eleman diziye EKLENMEZ, JSON'da `null` üretmez.
    expect(remoteLogServiceSrc, 'düşen dizi elemanı artık elenmiyor — JSON\'da null olur')
      .toMatch(/if\s*\(v\s*!==\s*undefined\)\s*out\.push\(v\)/);
  });

  it('triyaj motoru KURAL-İZOLE — tek bozuk kural tüm triyajı düşüremez', () => {
    // buildTriageSnapshot döngüsü kural çağrısını try/catch ile sarmalı.
    expect(diagnosticTriageSrc, 'kural izolasyonu (try/catch) kaldırılmış — tek TypeError tüm triyajı siler')
      .toMatch(/try\s*\{[\s\S]{0,80}rule\(sections\)[\s\S]{0,120}catch/);
    expect(diagnosticTriageSrc, 'ruleErrors sayacı kaldırılmış — kural düşmesi sessizleşir')
      .toMatch(/ruleErrors/);
  });

  it('ruleObdDtc null-guard\'lı — bozuk kod listesinde ham `c.code` okunmaz', () => {
    // Guard'sız `.map((c) => c.code)` DTC varken TypeError atıyordu.
    expect(diagnosticTriageSrc, 'ruleObdDtc yine guard\'sız c.code okuyor — TypeError riski geri geldi')
      .not.toMatch(/codes\.slice\(0,\s*3\)\.map\(\(c\)\s*=>\s*c\.code\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   TANI RAPORU — sanitize sertleştirme (selfTest + deny + cycle)
   Regresyon: (1) selfTest bölümü sanitize'ı TAMAMEN atlıyordu (ham spread) →
   prob detail'indeki ham Error/fetch metni ve stack karesi maskesiz gidiyordu;
   (2) deny-list `key.toLowerCase()` ile çalışıyordu → `apiKey` ≠ `api_key` →
   camelCase sırlar SIZIYORDU; (3) cycle guard yoktu → dairesel graf MAX_DEPTH'e
   kadar açılıyor, getter throw'u TÜM raporu düşürebiliyordu.
   Davranış kilitleri: diagnosticSanitizeHardening.test.ts.
   ─────────────────────────────────────────────────────────────── */
describe('Tanı raporu sanitize sertleştirme kilidi', () => {
  it('selfTest bölümü sanitize hattından geçer (ham runSelfTest çıktısı YASAK)', () => {
    // Eskiden: `const selfTest = await runSelfTest();` → payload'a HAM spread ediliyordu.
    expect(remoteLogServiceSrc, 'selfTest yine ham atanıyor — sanitize atlanıyor')
      .not.toMatch(/const\s+selfTest\s*=\s*await\s+runSelfTest\(\)/);
    expect(remoteLogServiceSrc, 'selfTest ortak sanitize kapısından (_sanitizeSection) geçmiyor')
      .toMatch(/_sanitizeSection\(await\s+runSelfTest\(\)\)/);
    // Inspector da AYNI kapıyı kullanmalı — tek kapı, atlanamaz.
    expect(remoteLogServiceSrc, 'inspector ortak sanitize kapısını kullanmıyor')
      .toMatch(/inspector:\s*_sanitizeSection\(inspector\)/);
  });

  it('deny-list anahtarı NORMALİZE edilir (camelCase/snake_case/case-insensitive)', () => {
    expect(remoteLogServiceSrc, 'anahtar normalizasyonu kaldırılmış — apiKey yine sızar')
      .toMatch(/toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\/g,\s*''\)/);
    // Çıplak toLowerCase() eşleşmesi GERİ GELMEMELİ.
    expect(remoteLogServiceSrc, 'DENY_KEYS yine çıplak toLowerCase() ile eşleşiyor')
      .not.toMatch(/DENY_KEYS\.has\(\s*key\.toLowerCase\(\)\s*\)/);
    for (const k of ['apikey', 'accesstoken', 'authorization', 'bearer', 'secret', 'password', 'jwt', 'email']) {
      expect(remoteLogServiceSrc, `deny anahtarı kaldırılmış: ${k}`).toMatch(new RegExp(`'${k}'`));
    }
  });

  it('_deepSanitize cycle-guard\'lı ve PAYLAŞILAN referansı cycle SANMAZ', () => {
    // Ancestor-path deseni: girerken ekle, finally ile çıkarken sil.
    expect(remoteLogServiceSrc, 'cycle guard kaldırılmış')
      .toMatch(/CYCLE_MARKER/);
    expect(remoteLogServiceSrc, 'ancestor yolundan çıkış (finally + delete) yok — DAG cycle sanılır')
      .toMatch(/finally\s*\{[\s\S]{0,160}\.delete\(obj\)/);
  });

  it('sanitize düğüm-bazlı fail-soft — tek zehirli alan raporu öldürmez', () => {
    expect(remoteLogServiceSrc, 'UNREADABLE işareti kaldırılmış — getter throw tüm raporu düşürebilir')
      .toMatch(/UNREADABLE_MARKER/);
  });
});

/* ───────────────────────────────────────────────────────────────
   Tam ekran video KAPAT butonu — kilitlenme tuzağı kilidi
   Regresyon (Duster head unit 2026-07-19): kontroller 3.5s sonra
   gizlenince "dokun → reveal" bazı head unit WebView'lerinde
   çalışmıyor → kullanıcı tam ekran videoda KİLİTLİ kalıyor (çıkamıyor).
   KİLİT: Kapat butonu auto-hide `show` state'ine TABİ OLMAMALI —
   her zaman görünür + pointer-events:auto olmalı ki çıkış garanti.
   ─────────────────────────────────────────────────────────────── */
describe('Tam ekran video Kapat butonu — çıkış garanti kilidi', () => {
  it('YAPISAL: Kapat butonu auto-hide fade container\'ının DIŞINDA (kalıcı katman)', () => {
    // Kalıcı Kapat bloğu, opacity:(show?1:0) container'ından ÖNCE gelmeli.
    const persistentIdx = mediaScreenSrc.indexOf('HER ZAMAN görünür KAPAT');
    const fadeContainerIdx = mediaScreenSrc.indexOf('Kontroller — show\'a göre fade');
    expect(persistentIdx, 'kalıcı KAPAT bloğu kaldırılmış — kilitlenme tuzağı geri döner')
      .toBeGreaterThan(-1);
    expect(fadeContainerIdx, 'auto-hide container yorumu bulunamadı').toBeGreaterThan(-1);
    expect(persistentIdx, 'Kapat fade container İÇİNE taşınmış — show=false iken görünmez olur')
      .toBeLessThan(fadeContainerIdx);
  });

  it('YAPISAL: kalıcı Kapat pointer-events:auto ile SABİTLENMİŞ (show gating değil)', () => {
    // Kalıcı blokta onClose + pointerEvents:'auto' override birlikte olmalı.
    const block = mediaScreenSrc.slice(
      mediaScreenSrc.indexOf('HER ZAMAN görünür KAPAT'),
      mediaScreenSrc.indexOf('Kontroller — show\'a göre fade'),
    );
    expect(block, 'kalıcı Kapat onClose bağlamıyor').toMatch(/onClick=\{onClose\}/);
    expect(block, 'kalıcı Kapat pointerEvents:auto override yok — show=false\'da tıklanamaz olur')
      .toMatch(/pointerEvents:\s*'auto'/);
  });
});

/* ───────────────────────────────────────────────────────────────
   Sesli asistan modalı — tema-duyarlı yüzey kilidi
   Regresyon (Duster 2026-07-19): dinleme modalı/pili sabit koyu
   (#0d1628 / rgba(6,10,24)) idi → aydınlık OEM temada "gece modu"
   gibi duruyordu. KİLİT: yüzeyler OEM token (--oem-surface-*) ile
   tema-duyarlı olmalı; sabit koyu hex zemin GERİ GELMEMELİ.
   ─────────────────────────────────────────────────────────────── */
describe('Sesli asistan modalı tema-duyarlı yüzey kilidi', () => {
  it('YAPISAL: modal/pil sabit koyu zemin (#0d1628 / rgba(6,10,24)) KULLANMAZ', () => {
    expect(voiceAssistantSrc, 'sabit koyu kart zemini #0d1628 geri gelmiş (aydınlık temada gece modu)')
      .not.toMatch(/bg-\[#0d1628\]/);
    expect(voiceAssistantSrc, 'sabit koyu pil zemini rgba(6,10,24) geri gelmiş')
      .not.toMatch(/rgba\(6,\s*10,\s*24/);
  });

  it('YAPISAL: yüzeyler OEM tema token\'ı (--oem-surface-0) ile türetiliyor', () => {
    expect(voiceAssistantSrc, 'OEM tema yüzeyi kullanılmıyor — tema-duyarlılık kayboldu')
      .toMatch(/var\(--oem-surface-0\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   Hibrit STT — bulut STT + Vosk yedek kilidi
   Duster saha 2026-07-19: Vosk küçük TR modeli araç gürültüsünde
   yetersiz ("anlamıyor"). Hibrit: online'da bulut STT (Groq/Gemini),
   offline/hata'da Vosk. KİLİT: (1) bulut BAŞARISIZ olursa Vosk metni
   KORUNUR (fail-soft — offline asla bozulmaz); (2) bulut STT BYOK +
   fail-soft (gömülü anahtar YOK, throw YOK); (3) native mik kaynağı
   seçimi HEM aktif dinleme HEM wake thread'inde (tek yardımcı).
   ─────────────────────────────────────────────────────────────── */
describe('Hibrit STT bulut + Vosk yedek kilidi', () => {
  it('YAPISAL: voiceService returnAudio geçer + cloudTranscribe dener + Vosk yedeği korur', () => {
    expect(voiceServiceSrc, 'returnAudio kapısı kaldırılmış — bulut STT hiç tetiklenmez')
      .toMatch(/returnAudio:/);
    expect(voiceServiceSrc, 'cloudTranscribe çağrısı yok — hibrit yol kopmuş')
      .toMatch(/cloudTranscribe/);
    // Fail-soft: transcript Vosk metniyle BAŞLAR (bulut yalnız iyileştirir, bozamaz).
    expect(voiceServiceSrc, 'Vosk yedeği kaldırılmış — bulut hatası dinlemeyi öldürür')
      .toMatch(/let\s+transcript\s*=\s*voskTranscript/);
  });

  it('YAPISAL: cloudSttService BYOK + fail-soft (gömülü anahtar yok, online kapısı var)', () => {
    // Gömülü anahtar yasağı (CLAUDE.md ticari kural): kaynakta düz API anahtarı sabiti olmaz.
    expect(cloudSttServiceSrc, 'gömülü Groq anahtarı sızıntısı')
      .not.toMatch(/gsk_[A-Za-z0-9]/);
    expect(cloudSttServiceSrc, 'gömülü Gemini anahtarı sızıntısı')
      .not.toMatch(/AIza[A-Za-z0-9]/);
    // Online kapısı: offline/sahte-online'da bulut denenmez (Vosk kalır).
    expect(cloudSttServiceSrc, 'gerçek-net kapısı kaldırılmış — offline\'da boşuna bulut denemesi')
      .toMatch(/hasRealNet/);
  });

  it('YAPISAL: native mik kaynağı seçimi HEM aktif dinleme HEM wake thread\'inde', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    // openBestMicRecorder tanımı + EN AZ 2 çağrı yeri (runVoskListening + wake grammar).
    const calls = (java.match(/openBestMicRecorder\(/g) ?? []).length;
    expect(calls, 'openBestMicRecorder yalnız 1 yerde — bir yol hâlâ tek-kaynak (ölü mik riski)')
      .toBeGreaterThanOrEqual(3); // 1 tanım + 2 çağrı
  });
});

/* ───────────────────────────────────────────────────────────────
   RPM/hız göstergesi — sıcak-sinyal hızlı bildirim kilidi
   Saha (2026-07-19): RPM kartı obdListenerDebounce (POWER_SAVE'de 5s)
   yüzünden 5-8s'de bir güncelleniyordu ("veri hızlı ama kart geç").
   KİLİT: RPM/hız değişince bildirim kaba debounce yerine hızlı pencereye
   (~5Hz) düşmeli; yavaş sinyaller (yakıt/sıcaklık) kaba debounce'ta kalır.
   ─────────────────────────────────────────────────────────────── */
describe('OBD RPM/hız sıcak-sinyal hızlı bildirim kilidi', () => {
  it('YAPISAL: obdService sıcak-sinyal hızlı debounce yolu içerir', () => {
    const src = read('src/platform/obdService.ts');
    expect(src, 'HOT_NOTIFY_DEBOUNCE_MS kaldırılmış — RPM kartı kaba debounce\'a düşer (geç)')
      .toMatch(/HOT_NOTIFY_DEBOUNCE_MS/);
    // _merge rpm/speed değişiminde sıcak bayrağı set etmeli.
    expect(src, 'sıcak-sinyal bayrağı rpm/speed değişiminde set edilmiyor')
      .toMatch(/partial\.rpm !== undefined \|\| partial\.speed !== undefined.*_hotChangePending = true/s);
    // _notify sıcak beklemede kaba yerine hızlı debounce kullanmalı.
    expect(src, '_notify sıcak sinyalde hızlı pencereyi kullanmıyor')
      .toMatch(/_hotChangePending \? Math\.min\(HOT_NOTIFY_DEBOUNCE_MS/);
  });
});

/* ───────────────────────────────────────────────────────────────
   CAROS LAB — gündüz/aydınlık tema kilidi
   Saha (2026-07-25): CAROS LAB aydınlık temada SİYAH kalıyordu ve
   düşük-opaklık metinler okunmuyordu. Kök neden: shell ve araç
   ekranları sabit renk kullanıyordu (`bg-[#070b12]`, `text-white/xx`,
   `border-white/xx`, `*-500/xx` tailwind paletleri) → hiçbir tema
   değişkenine abone DEĞİLDİ, `html.light-ui` flip'i onlara ulaşmıyordu.
   KİLİT: bu ağaçta sabit renk yok; yalnız `--oem-*` token'ları.
   Ayrıca en soluk seviye `--oem-ink-3`'tür (ink-4 α .34 güneşte okunmuyor).
   ─────────────────────────────────────────────────────────────── */
describe('CAROS LAB aydınlık tema (token) kilidi', () => {
  /* devtools ağacı + CAROS LAB'ın YENİDEN KULLANDIĞI ekranlar. İkinciler dışarıda
     yaşıyor (DebugPanel / Uzman Modu de kullanır) ama LAB İÇİNDE açıldıkları için
     tema düzeltmesi onlarsız EKSİKTİ — kilit ikisini birden kapsar. */
  const files = [
    ...walkTsx('src/components/devtools'),
    'src/components/debug/PerformanceView.tsx',
    'src/components/debug/BlackBoxReplayView.tsx',
    'src/components/debug/CanRawView.tsx',
    'src/components/discovery/DiscoveryDashboard.tsx',
    'src/components/discovery/PidDidDeepScanPanel.tsx',
  ];
  /* Yorum satırları hariç tutulur — kök-neden açıklamaları yasaklı renk/token
     ADINI içerir (kilidin kendisi belgeyi cezalandırmasın). */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('YAPISAL: devtools ağacında en az bir ekran taranıyor', () => {
    expect(files.length, 'devtools ekranları bulunamadı — kilit boşa çalışıyor')
      .toBeGreaterThanOrEqual(8);
  });

  it('KİLİT: sabit renk (hex / text-white / tailwind palet) kullanılmaz', () => {
    const BANNED = [
      /\btext-white\b/,                       // opak/opaklıklı beyaz mürekkep
      /\bborder-white\//,                     // beyaz hairline
      /\bbg-white\//,                         // beyaz cam yüzey
      /\bbg-black\//,                         // siyah cam yüzey
      /\bbg-\[#[0-9a-fA-F]{3,8}\]/,           // sabit hex zemin
      /\b(?:text|bg|border)-(?:cyan|emerald|amber|rose|sky|fuchsia|orange|slate|zinc|gray|neutral)-\d{2,3}\b/,
    ];

    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(read(f));
      for (const re of BANNED) {
        const m = src.match(new RegExp(re.source, 'g'));
        if (m) offenders.push(`${f} → ${[...new Set(m)].join(', ')}`);
      }
    }

    expect(offenders, `CAROS LAB'da sabit renk geri geldi (aydınlık temada siyah kalır):\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('KİLİT: en soluk mürekkep --oem-ink-3 (ink-4 güneşte okunmuyor)', () => {
    const offenders = files.filter((f) => stripComments(read(f)).includes('--oem-ink-4'));
    expect(offenders, `--oem-ink-4 (α .34) geri geldi: ${offenders.join(', ')}`).toEqual([]);
  });
});

/* ───────────────────────────────────────────────────────────────
   CAROS LAB — TÜRKÇE ARAYÜZ kilidi (CLAUDE.md §DİL KURALI)
   Arayüzün TAMAMI Türkçedir. Ama ham enum'lar (AVAILABLE · OBSERVED ·
   FOUNDATION_ONLY…) MAKİNE SÖZLEŞMESİDİR: `data-*` özniteliklerinde ve
   testlerde İngilizce kalır — dürüstlük kilitleri dile bağımlı olmamalı.
   Bu kilit ikisini birden korur: her enum için Türkçe etiket EKSİKSİZ
   olmalı (yoksa ekranda `undefined` basılır) ve sözlükler kaybolmamalı.
   Protokol kısaltmaları (PID·DID·NRC·KWP·UDS·TX·RX·CAN·OBD·ELM327·HAL)
   FAZ A politikası gereği çevrilmez — kilit onlara dokunmaz.
   ─────────────────────────────────────────────────────────────── */
describe('CAROS LAB Türkçe arayüz kilidi', () => {
  it('KİLİT: her enum değerinin Türkçe etiketi vardır (eksikse ekranda undefined basar)', async () => {
    const cat   = await import('../platform/devtools/carosLabCatalog');
    const sess  = await import('../platform/devtools/sessionInspectorModel');
    const sched = await import('../platform/devtools/runtimeSchedulingModel');
    const ev    = await import('../platform/devtools/evidenceViewerModel');
    const raw   = await import('../platform/devtools/rawTrafficModel');
    const pid   = await import('../platform/devtools/pidDidExplorerModel');

    const maps: Array<[string, Record<string, string>, readonly string[]]> = [
      ['status',      cat.CAROS_LAB_STATUS_LABEL,        ['AVAILABLE', 'PLACEHOLDER', 'DISABLED']],
      ['kategori',    cat.CAROS_LAB_CATEGORY_LABEL,      cat.CAROS_LAB_CATEGORIES],
      ['gözlem',      sess.OBSERVABILITY_LABEL,          ['OBSERVED', 'DERIVED', 'UNAVAILABLE', 'STALE']],
      ['oturum',      sess.SESSION_HEALTH_LABEL,         ['CONNECTED', 'DEGRADED', 'DISCONNECTED', 'UNKNOWN']],
      ['sched-gözlem', sched.SCHED_OBSERVABILITY_LABEL,  ['OBSERVED', 'DERIVED', 'UNAVAILABLE', 'STALE', 'UNSAFE_TO_OBSERVE']],
      ['kanal',       sched.CHANNEL_ACTIVITY_LABEL,      ['RUNNING', 'NOT_RUNNING', 'BLOCKED', 'UNKNOWN']],
      ['özet',        sched.RUNTIME_SUMMARY_LABEL,       ['ACTIVE', 'PARTIAL', 'IDLE', 'BLOCKED', 'UNKNOWN']],
      ['kanıt-kanal', ev.EVIDENCE_CHANNEL_LABEL,         ev.EVIDENCE_CHANNELS],
      ['kanıt-önem',  ev.EVIDENCE_SEVERITY_LABEL,        ['info', 'warn', 'error', 'critical']],
      ['trafik',      raw.RAW_TRAFFIC_KIND_LABEL,        raw.RAW_TRAFFIC_KINDS],
      ['piddid',      pid.PIDDID_STATE_LABEL,            ['WIRED', 'NOT_WIRED', 'UNAVAILABLE']],
      ['piddid-özet', pid.PIDDID_OVERALL_LABEL,          ['FOUNDATION_ONLY', 'WIRED']],
    ];

    const missing: string[] = [];
    for (const [name, map, keys] of maps) {
      for (const k of keys) {
        const v = map[k];
        if (typeof v !== 'string' || v.length === 0) missing.push(`${name}.${k}`);
      }
    }
    expect(missing, `Türkçe etiketi olmayan enum değeri: ${missing.join(', ')}`).toEqual([]);
  });

  it('KİLİT: araç adları ve kategori etiketleri İngilizce kalmadı', async () => {
    const cat = await import('../platform/devtools/carosLabCatalog');
    /* Bir zamanlar İngilizce olan ve dönmemesi gereken adlar. Protokol kısaltmaları
       (PID/DID/CAN/KWP/UDS) araç adının İÇİNDE geçebilir — bu liste tam-ad eşleşmesidir. */
    const ENGLISH_NAMES = new Set([
      'Live Data', 'PID/DID Explorer', 'Deep Scan', 'Vehicle Fingerprint',
      'Raw OBD Traffic', 'CAN Monitor', 'KWP Monitor', 'UDS Explorer',
      'Session Inspector', 'Adapter Diagnostics', 'Queue Monitor', 'Poll Scheduler',
      'Recovery Monitor', 'Evidence Viewer', 'Mavi Console', 'Action Registry',
      'Tool Calling', 'Memory Explorer', 'Knowledge Explorer', 'Decoder Registry',
      'Discovery Database', 'Raw Command Console', 'Replay Log', 'Stress Test',
    ]);
    const back = cat.CAROS_LAB_TOOLS.filter((t) => ENGLISH_NAMES.has(t.name)).map((t) => t.id);
    expect(back, `İngilizce araç adı geri geldi: ${back.join(', ')}`).toEqual([]);

    const engCats = ['Vehicle', 'Communication', 'Runtime', 'Developer'];
    const catBack = Object.values(cat.CAROS_LAB_CATEGORY_LABEL).filter((v) => engCats.includes(v));
    expect(catBack, `İngilizce kategori etiketi geri geldi: ${catBack.join(', ')}`).toEqual([]);
  });
});

/* ───────────────────────────────────────────────────────────────
   CAROS LAB — "TÜMÜNÜ KOPYALA" sızıntı kilidi
   Kopyalama bir DIŞA AKTARIM yüzeyidir; en büyük risk sızıntıdır.
   BULGU (2026-07-25, ilk yazımda testle yakalandı): `maskSensitiveText`
   `authorization: bearer_…` ve çıplak e-postayı YAKALAMAZ — onlar yalnız
   `maskCommonSecrets` içindedir. Kapı sadece OBD trafiğine uygulanınca
   KANITLAR bölümündeki bearer token HAM kopyalanıyordu.
   KİLİT: her üç maskeleme kapısı da TEK ortak yolda (`maskUnknown`) olmalı;
   biri düşerse bu test kırmızıya döner.
   ─────────────────────────────────────────────────────────────── */
describe('CAROS LAB kopyalama sızıntı kilidi', () => {
  it('KİLİT: üç maskeleme kapısı da ortak yolda uygulanır', () => {
    const src = read('src/platform/devtools/carosLabCopyModel.ts');
    expect(src, 'maskCommonSecrets kaldırılmış — bearer/e-posta HAM sızar')
      .toMatch(/maskCommonSecrets\(/);
    expect(src, 'maskSensitiveText kaldırılmış — VIN/koordinat sızar')
      .toMatch(/maskSensitiveText\(/);
    expect(src, 'sanitizeValue kaldırılmış — deny-key ve tavanlar kalkar')
      .toMatch(/sanitizeValue\(/);
  });

  it('KİLİT: kopyalama gerçek sırlarla test edildiğinde metne sızıntı olmaz', async () => {
    const { buildCarosLabCopy } = await import('../platform/devtools/carosLabCopyModel');
    const r = buildCarosLabCopy({
      meta: {
        generatedAtWallMs: 1, platform: 'android', appVersion: null,
        category: 'vehicle', activeTool: null,
      },
      catalog: null, session: null, scheduling: null,
      evidence: [
        { p: 'authorization: bearer_abcdef1234567890xyz' },
        { p: 'MAC 00:1D:A5:68:98:8B' },
        { p: 'mail selim@example.com' },
      ],
      obdTraffic: [{ cmd: '0902', resp: '49 02 01 57 46 30 41 58 58 54 54 52 41 35 52 31 32 33 34 35', ms: 1, ts: 1 }],
      canRaw: null, discovery: null,
    });
    for (const secret of [
      'bearer_abcdef1234567890xyz', '00:1D:A5:68:98:8B',
      'selim@example.com', 'WF0AXXTTRA5R12345',
    ]) {
      expect(r.text, `KOPYA SIZDIRDI: ${secret}`).not.toContain(secret);
    }
  });

  it('KİLİT: kopyalama SALT-OKUNUR — kaynak okuyucu yeni motor başlatmaz', () => {
    const src = read('src/platform/devtools/carosLabCopySources.ts');
    expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(src).not.toMatch(/\.subscribe\(/);
    expect(src, 'komut/bağlantı yüzeyi eklenmiş — kopyalama gözlem olmaktan çıktı')
      .not.toMatch(/sendCommand|startPolling|performHandshake|clearDtc/);
  });

  /* SAHA (2026-07-25): OBD ham trafiği ve CAN YALNIZ kendi ekranları açıkken
     toplanıyordu → katalogdan kopyalayınca o iki bölüm boş çıkıyordu. Yakalama
     LAB kapsamına alındı. Kanal ref-count'lu olduğu için ekranların kendi
     acquire'ı DURMAMALI (ikisi birlikte çalışır, biri kapanınca diğeri sürer). */
  it('KİLİT: yakalama LAB açık olduğu sürece etkin (kopya boş çıkmasın)', () => {
    const shell = read('src/components/devtools/CarosLabShell.tsx');
    expect(shell, 'LAB kapsamlı OBD trafik yakalaması kaldırılmış — kopya boş çıkar')
      .toMatch(/useObdTrafficCapture\(\)/);
    expect(shell, 'LAB kapsamlı CAN toplaması kaldırılmış — kopya boş çıkar')
      .toMatch(/useCanCollect\(\)/);
    // Ekranların kendi acquire'ı KALMALI (ref-count simetrisi + tek başına açılabilirlik).
    expect(read('src/components/devtools/screens/RawObdTrafficScreen.tsx'))
      .toMatch(/useObdTrafficCapture\(\)/);
    expect(read('src/components/devtools/screens/CanMonitorScreen.tsx'))
      .toMatch(/useCanCollect\(\)/);
  });

  /* SAHA (2026-07-25): "Kaynak Durumu" kartı `debugStore.fallback`ten besleniyordu,
     ama `dbgUpdateFallback`in ÇAĞIRANI YOK → kart her koşulda sahte "bayat/kapalı"
     gösteriyordu. Gerçek HAL `sourceHealth`e bağlandı; null=BİLİNMİYOR ayrımı şart. */
  it('KİLİT: Kaynak Durumu kartı ölü `fallback` alanına geri dönmez', () => {
    const src = read('src/components/debug/PerformanceView.tsx');
    expect(src, 'ölü debugStore.fallback alanı geri geldi — sahte durum beyanı')
      .not.toMatch(/s\)\s*=>\s*s\.fallback/);
    expect(src, 'gerçek HAL sourceHealth bağlantısı kaldırılmış')
      .toMatch(/useHALStatusStore/);
    expect(src, 'null (BİLİNMİYOR) ile false (ÖLÜ) ayrımı kaldırılmış')
      .toMatch(/BİLİNMİYOR/);
  });

  /* SAHA P0 (2026-07-25, KWP/protokol 5): OBD kadansı ~4.3 s iken SABİT 5 s tazelik
     eşiği her jitter tepesinde `obdAlive=false` bastı → HAL GPS'e düştü → park hâlindeki
     GPS gürültüsü 10.6 km/h "hız" üretti → sürüş/park flip-flop + odometreye 48 m SAHTE km.
     İki değişmez: (1) eşik gözlenen kadanstan öğrenilir, (2) duran araçta GPS füzyonu
     kazanamaz. Ayrıntılı kilitler: obdAdaptiveFreshness.test.ts */
  it('KİLİT: OBD tazelik eşiği sabite dönmez + GPS hayalet hızı füzyonu kazanmaz', () => {
    expect(vehicleComputeWorkerSrc, 'sabit OBD eşiği geri geldi — sahte "OBD öldü" + GPS fallback')
      .not.toMatch(/SRC_TIMEOUT_OBD_MS/);
    expect(vehicleComputeWorkerSrc, 'adaptif kadans kapısı kaldırılmış')
      .toMatch(/createObdCadenceGate/);
    expect(vehicleComputeWorkerSrc, 'GPS hayalet kapısı kaldırılmış — sahte km geri döner')
      .toMatch(/!_gpsGhostSpeed\(valGPS!\.value\)/);
  });
});

/* ───────────────────────────────────────────────────────────────
   API anahtarı — "siteden kopyala, dönünce otomatik algılansın" kilidi
   REGRESYON (1f03aa2, 2026-07-22): 5 ayrı anahtar bölümü tek kayıt-defteri
   panelinde birleşirken `handleOpenKeyPage` yardımcısı DÜŞTÜ. "Anahtar Al"
   düğmesi doğrudan `openInApp()` çağırır oldu; `waitingClip` yalnız `false`a
   çekildiği için focus/visibilitychange dinleyicisi HİÇ BAĞLANMADI →
   otomatik pano algılaması BEŞ SAĞLAYICIDA DA sessizce öldü (kod "duruyor"
   göründüğü için kimse fark etmedi).
   KİLİT: zincirin üç halkası da yerinde olmalı —
     (1) düğme ebeveyn geri çağırmasını kullanmalı (doğrudan openInApp DEĞİL),
     (2) o geri çağırma `setWaitingClip(true)` yapmalı,
     (3) dinleyici bu bayrağa bağlı kurulmalı.
   ─────────────────────────────────────────────────────────────── */
describe('Anahtar sayfasından dönünce pano otomatik algılama kilidi', () => {
  const src = read('src/components/settings/ApiCredentialsPanel.tsx');

  it('YAPISAL: "Anahtar Al" düğmesi ebeveyn geri çağırmasını kullanır', () => {
    expect(src, '"Anahtar Al" yine doğrudan openInApp çağırıyor — pano beklemesi hiç başlamaz')
      .toMatch(/onClick=\{\(\) => onOpenKeyPage\(desc\.docsUrl\)\}/);
    expect(src, 'satır bileşeni onOpenKeyPage sözleşmesini kaybetmiş')
      .toMatch(/readonly onOpenKeyPage: \(url: string\) => void;/);
  });

  it('YAPISAL: geri çağırma pano beklemesini GERÇEKTEN başlatır', () => {
    const fn = src.match(/const handleOpenKeyPage = useCallback\([\s\S]*?\n {2}\}, \[\]\);/);
    expect(fn, 'handleOpenKeyPage yine kayboldu (1f03aa2 regresyonu geri geldi)').toBeTruthy();
    expect(fn![0], 'sağlayıcı sayfası açılmıyor').toMatch(/openInApp\(url\)/);
    expect(fn![0], 'setWaitingClip(true) yok — dinleyici asla bağlanmaz, algılama ölü')
      .toMatch(/setWaitingClip\(true\)/);
    expect(fn![0], 'kullanıcıya "kopyalayıp geri dönün" ipucu verilmiyor')
      .toMatch(/setClipboardHint\(/);
  });

  it('YAPISAL: dinleyici bayrağa bağlı ve HER İKİ olayı da dinler', () => {
    expect(src, 'waitingClip kapısı kaldırılmış').toMatch(/if \(!waitingClip\) return;/);
    expect(src, 'focus dinleyicisi yok — siteden dönüş yakalanmaz')
      .toMatch(/addEventListener\('focus'/);
    expect(src, 'visibilitychange dinleyicisi yok — head unit dönüşü kaçar')
      .toMatch(/addEventListener\('visibilitychange'/);
  });

  it('YAPISAL: her satır prop\'u alır (bir sağlayıcı sessizce dışarıda kalmasın)', () => {
    const rows = [...src.matchAll(/<CredentialRow[^>]*\/>/g)];
    expect(rows.length, 'CredentialRow render edilmiyor').toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r[0], `bir CredentialRow onOpenKeyPage almıyor → o grup için algılama ölü: ${r[0]}`)
        .toContain('onOpenKeyPage={handleOpenKeyPage}');
    }
  });

  it('KİLİT: pano deseni olan HER sağlayıcı otomatik algılanabilir', async () => {
    const { API_CREDENTIALS, matchCredentialByClipboard } =
      await import('../platform/ai/credentials/credentialRegistry');
    /** Her sağlayıcı için biçimi GERÇEKÇİ örnek anahtar (uydurma değil). */
    const ORNEK: Record<string, string> = {
      gemini:     'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234567',
      openrouter: 'sk-or-v1-ABCDEFGHIJKLMNOPqrstuvwx0123456789',
      tavily:     'tvly-dev-ABCDEFGHIJKLMNOPqrstuvwx',
      groq:       'gsk_ABCDEFGHIJKLMNOPQRSTUVWX',
      haiku:      'sk-ant-ABCDEFGHIJKLMNOPQRSTUV',
    };
    const hatali: string[] = [];
    for (const c of API_CREDENTIALS) {
      if (!c.clipboardPattern) continue;
      const ornek = ORNEK[c.id];
      if (!ornek) { hatali.push(`${c.id}: teste örnek anahtar eklenmemiş`); continue; }
      const bulunan = matchCredentialByClipboard(ornek);
      if (bulunan?.id !== c.id) {
        hatali.push(`${c.id}: pano eşleşmesi ${bulunan?.id ?? 'YOK'} döndü — yanlış sağlayıcıya yazılır`);
      }
    }
    expect(hatali, `pano algılaması bozuk: ${hatali.join(' | ')}`).toEqual([]);
  });

  /* ── SES: uygulama AÇILIŞI cihaz sesini DEĞİŞTİREMEZ ──────────────────────
   * SAHA BULGUSU (2026-07-31, cihazda yeniden üretildi 15 → 2): açılış effect'i
   * kayıtlı ses düzeyini `setVolume` ile uyguluyordu; o fonksiyon uygulama-içi
   * oynatıcıların YANINDA cihazın STREAM_MUSIC seviyesini de yazıyor. Sonuç:
   * telefon/araç sesi CarOS her açıldığında uygulamanın kendi ayarına düşüyordu.
   * Uygulamanın açılması bir ses komutu DEĞİLDİR.
   * Bu kilidi ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası). */
  it('🔒 VolumeGestureLayer açılışta CİHAZ sesini yazmaz (yalnız uygulama-içi)', () => {
    const src = volumeGestureLayerSrc;
    // Yorumları ele — kilit KODU inceler, açıklama metnini değil.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // Mount effect'i bul: `useEffect(() => { ... }, [])`
    const mountEffects = code.match(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/g) ?? [];
    expect(mountEffects.length, 'açılış effekti bulunamadı — kilit körleşti').toBeGreaterThan(0);

    for (const eff of mountEffects) {
      expect(
        /(^|[^a-zA-Z])setVolume\s*\(/.test(eff),
        'açılış effekti sistem sesini yazıyor (setVolume) — cihaz sesi düşer',
      ).toBe(false);
    }
    // Doğru katman KULLANILIYOR olmalı (kilit "hiç ses ayarlanmasın" demiyor).
    expect(code).toContain('setInAppVolume');
  });

  it('🔒 native: yıkımda kısılmış müzik sesi GERİ YÜKLENİR', () => {
    const plugin = readFileSync(
      join(process.cwd(), 'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'),
      'utf8');
    const at = plugin.indexOf('protected void handleOnDestroy()');
    expect(at, 'handleOnDestroy bulunamadı').toBeGreaterThan(-1);
    const body = plugin.slice(at, at + 2500);
    /* Kısılmışken süreç ölürse cihaz KALICI kısık kalırdı. */
    expect(body).toContain('restoreMusicAfterListening()');
  });
});

/* ───────────────────────────────────────────────────────────────
   Ana ekran harita kartı — SAHTE navigasyon verisi (saha 2026-08-02)
   Üç temanın harita kartında `2.4 km / Sahil Yolu Cd.` SABİT yazılıydı;
   hiçbir kaynağa bağlı değildi. Gerçek rota "71.1 km / Mersin-Antalya
   Yolu" derken kart bunu gösteriyordu (canlı sürüşte CDP ile ölçüldü).
   ─────────────────────────────────────────────────────────────── */
describe('Ana ekran harita kartı sahte rota GÖSTERMEZ', () => {
  const LAYOUTS: readonly (readonly [string, string])[] = [
    ['ExpeditionLayout', expeditionLayoutSrc],
    ['ProLayout',        proLayoutSrc],
    ['TeslaLayout',      teslaLayoutSrc],
  ];

  it.each(LAYOUTS)('🔒 %s: gömülü sahte yol adı/mesafe YOK', (_ad, src) => {
    expect(src, 'sabit yol adı geri geldi').not.toContain('Sahil Yolu Cd.');
    // Sabit "2.4 km" mesafe metni — JSX'te birebir dizi olarak geçmemeli.
    expect(/>\s*2\.4\s*</.test(src), 'sabit 2.4 km mesafesi geri geldi').toBe(false);
  });

  it.each(LAYOUTS)('🔒 %s: rota özeti GERÇEK navigasyon otoritesinden okunur', (_ad, src) => {
    expect(src).toContain("from '../../hooks/useNavSummary'");
    expect(src).toContain('useNavSummary()');
    // Kanıt yoksa chip HİÇ çizilmez — sahte hedef üretilmez.
    expect(src).toContain('navSummary ?');
  });
});

/* ───────────────────────────────────────────────────────────────
   Güvenlik Beyni mandalının ÇIKIŞ YOLU olmalı (saha 2026-08-06).
   Cihazda `disabledFeatures: ["obdDataGateAutoReconnect", ...]` +
   `OBD_DATA_GATE_TIMEOUT × 19` bulundu; OBD bütün gün bağlanamadı.
   Kayıt VIN'siz `__NO_VIN__` kovasına gidiyor → "VIN okumak için gereken
   özellik, VIN olmadığı için kalıcı kapalı" kilidi. Sayaçlar hiç azalmıyor,
   başarıya bakan bir iyileşme yolu YOKTU.
   ─────────────────────────────────────────────────────────────── */
describe('Güvenlik Beyni: kanıtlanmış başarı arızayı iyileştirir', () => {
  /* Davranış testi `safetyBrain.test.ts` içindedir (depo/VIN kurulumu orada).
     Burada YALNIZ kanıt anının doğru yerde olduğu kilitlenir. */
  it('🔒 iyileşme kanıtı GERÇEK ECU frame\'idir (soket bağlantısı DEĞİL)', () => {
    const obd = read('src/platform/obdService.ts');
    const at = obd.indexOf('_dataGatePassed = true;');
    expect(at, 'veri kapısı geçişi bulunamadı').toBeGreaterThan(-1);
    /* Çağrı, veri kapısının açıldığı blokta olmalı — bağlantı kurulduğu yerde değil.
       2026-08-07: pencere SABİT 900 karakterdi ve çağrıya fail-soft gerekçesi
       yazılınca kilit yanlışlıkla düştü (davranış değişmemişti, yalnız yorum
       uzamıştı). Kilit KALDIRILMADI: sınır, bloğun GERÇEK sonuna (`_merge(`)
       bağlandı — artık yoruma değil yapıya bakıyor. */
    const gateBlock = obd.slice(at, obd.indexOf('_merge({', at));
    expect(gateBlock, 'blok sınırı bulunamadı').not.toHaveLength(0);
    expect(gateBlock).toContain("recordFeatureRecovered('obdDataGateAutoReconnect')");
  });
});

/* ───────────────────────────────────────────────────────────────
   Bayat OBD okuması CANLI GİBİ gösterilemez (saha 2026-08-06,
   Adana-Şanlıurfa Otoyolu, gerçek sürüş).
   Ekranda "675 km MENZİL" DONUK duruyordu: araç 1 dakikada 1,5 km
   ilerlerken değer hiç değişmedi. OBD o sırada bağlı DEĞİLDİ
   (V-LINK STATE_DISCONNECTED, car-can-snapshot 85 saat bayat).
   KÖK: `useOBDField` ham değeri döndürür — tazelik kapısı YOK. Temalar
   kapıyı kendileri kuruyordu; `eng.*` yedeğine düşünce kapı BAYPAS
   oluyordu, Expedition'da ise hiç yoktu. Kapı kaynağa taşındı.
   ─────────────────────────────────────────────────────────────── */
describe('Motor okuması bayat OBD verisini canlı göstermez', () => {
  it('🔒 useEngineReadout canlılık kapısını KAYNAKTA uygular', () => {
    const src = read('src/hooks/useEngineReadout.ts');
    expect(src).toContain("from '../platform/vehicleStatusModel'");
    expect(src).toContain('isObdReadingLive({');
    /* P0-OBD-03'te MOTOR ISISI bu kapıdan ÇIKTI ve DAHA GÜÇLÜ bir kapıya geçti:
       kanonik otorite (CAN → OBD → yok) + sinyal başına tazelik penceresi.
       Kilit KALDIRILMADI, yeni doğru davranışa GÜNCELLENDİ — ısı için artık
       `useLiveVehicleSignal` şart, ham `obdTemp` okuması YASAK. */
    expect(src, 'motor ısısı kanonik otoriteden okunmuyor')
      .toContain("useLiveVehicleSignal('coolantTemp')");
    expect(src, 'ham OBD ısı okuması geri gelmiş (ikinci otorite)')
      .not.toContain("useOBDField('engineTemp')");
    // rpm ve fuel HÂLÂ bu kapıya bağlı — ikisi kanonik kümede değildir.
    expect(src).toContain('obdLive && obdRpm');
    expect(src).toContain('obdLive && obdFuel');
    // CAN/CarInfo yolu AYRI ve meşru canlı kaynaktır — elenmemeli
    expect(src).toContain('canRpm != null');
    expect(src).toContain('storeFuel != null');
  });

  it('🔒 Expedition menzili UYDURMAZ — sabit 750 km katsayısı YASAK', () => {
    // Tesla/Horizon'da çoktan kaldırılmış olan katsayı bu plakada kalmıştı.
    expect(/\*\s*750\b/.test(expeditionLayoutSrc), 'sabit 750 km katsayısı geri geldi').toBe(false);
    expect(expeditionLayoutSrc).toContain('isObdReadingLive(obd)');
    expect(expeditionLayoutSrc).toContain('obd.estimatedRangeKm');
    // Kanıt yoksa dürüst '—'
    expect(expeditionLayoutSrc).toContain("{range ?? '—'}");
  });

  it('🔒 YAKIT sütunu yolculuk özetinden KALDIRILDI (dekoratif tire yok)', () => {
    /* Kilidin kökeni: değer anlık depo yüzdesiydi ama etiket "varışta" diyordu.
       P0-NAV-04 kökü kaldırdı — yakıt bir NAVİGASYON hükmü değildir ve veri
       yokken ekranda dekoratif bir tire olarak duruyordu. Kilit kaldırılmadı,
       yeni doğru davranışa taşındı. */
    const trip = read('src/components/map/hud/TripSummary.tsx');
    expect(trip).not.toContain('Varışta yakıt');
    expect(trip, 'yakıt sütunu geri gelmiş').not.toContain('fuelPct');
    expect(navigationHudSrc).not.toContain('Varışta yakıt');
  });
});

/* ───────────────────────────────────────────────────────────────
   Harita katman işlemleri (saha 2026-08-02, gerçek cihaz)
   Düşük-GPU'da shadow/glow/flow katmanları BİLEREK oluşturulmaz.
   MapLibre olmayan katmanda THROW ETMEZ, `error` olayı yayınlar →
   `try/catch` hiçbir şey yakalamıyordu ve cihazdaki son 50 harita
   hatasının 50'si bu gürültüydü (gerçek arıza altında kaybolurdu).
   ─────────────────────────────────────────────────────────────── */
describe('Harita katman işlemleri varlık kontrollüdür', () => {
  it('🔒 moveLayer ASLA korumasız çağrılmaz (safeMoveLayer kullanılır)', () => {
    expect(mapLayerManagerSrc).toContain("from './_safeLayerOps'");
    // Ham `map.moveLayer(` çağrısı kalmamalı — hepsi sarmalayıcıdan geçmeli.
    expect(/\bmap\.moveLayer\s*\(/.test(mapLayerManagerSrc)).toBe(false);
  });

  it('🔒 rota katmanlarına korumasız setPaintProperty YAPILMAZ', () => {
    // Bu iki dosyada ham setPaintProperty yalnız `getLayer` koruması ile
    // birlikte kalabilir; ROUTE_GLOW_SEL en sık hata kaynağıydı (12 kez).
    for (const src of [mapLayerManagerSrc, mapInteractionManagerSrc]) {
      expect(/map\.setPaintProperty\(\s*ROUTE_GLOW_SEL/.test(src)).toBe(false);
      expect(/map\.setPaintProperty\(\s*ROUTE_SHADOW/.test(src)).toBe(false);
    }
    expect(mapInteractionManagerSrc).toContain("from './_safeLayerOps'");
  });

  it('🔒 text-field katmanı stilde `glyphs` YOKKEN eklenmez', () => {
    // Raster stilde glyphs bildirilmez → rozet eklenirse doğrulama reddeder
    // ve ardından "layer does not exist" zinciri başlar.
    expect(mapLayerManagerSrc).toContain('getStyle().glyphs');
  });
});

/* ───────────────────────────────────────────────────────────────
   Gece harita paleti — TEK KAYNAK (saha 2026-08-02)
   Üç yerde elle kopyalanmıştı ve SÜRÜKLENMİŞTİ: _mapState .42/.62
   kalırken diğer ikisi .52/.50 olmuştu → hangi stil yüklendiğine
   göre gece haritası farklı görünüyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Gece harita paleti tek kaynaktan gelir', () => {
  it('🔒 _mapState raster paint DEĞERLERİNİ KOPYALAMAZ, sabitleri IMPORT eder', () => {
    expect(mapStateSrc).toContain("from '../mapStyleBuilders'");
    expect(mapStateSrc).toContain('RASTER_PAINT_NIGHT');
    expect(mapStateSrc).toContain('RASTER_PAINT_DAY');
    // Elle yazılmış raster paint anahtarı KALMAMALI (kopya = sürüklenme).
    expect(/'raster-brightness-max'\s*:/.test(mapStateSrc)).toBe(false);
    expect(/'raster-saturation'\s*:/.test(mapStateSrc)).toBe(false);
  });

  it('🔒 gece paleti gerçekten KOYU (sahada ölçülen eşik)', async () => {
    const { RASTER_PAINT_NIGHT, RASTER_PAINT_DAY } =
      await import('../platform/mapStyleBuilders');
    /* Cihazda ölçüldü: brightness-max 0.50 gece haritayı GÜNDÜZ parlaklığında
       bırakıyordu (ekran pikseli 180/255). Sürücünün gözüne vuran en parlak
       blok harita olmamalı. 0.25 üstü bir daha KABUL EDİLMEZ. */
    expect(RASTER_PAINT_NIGHT['raster-brightness-max']).toBeLessThanOrEqual(0.25);
    // Gündüz KOYULAŞTIRILMAZ — gece kilidi gündüzü ezmesin.
    expect(RASTER_PAINT_DAY['raster-brightness-max']).toBe(1);
  });
});

/* ───────────────────────────────────────────────────────────────
   GPS heartbeat VARIŞ tabanlıdır (saha 2026-08-02)
   Cihaz kayıtları 20:36–21:39: araç PARK hâlindeyken
   "No heartbeat for 20s/25s/85s" alarmları basıldı; aynı satırlarda
   conn=connected polling=true → GPS SAĞLIKLIYDI, alarm YALANDI.
   KÖK: heartbeat `useUnifiedVehicleStore.location` REFERANS değişiminden
   türetiliyordu; store'un shallow-equal guard'ı aynı fix'te referansı
   DEĞİŞTİRMEZ (doğru bir CPU/termal optimizasyonu) → beat hiç üretilmez.
   OBD tarafında 2026-08-01'de düzeltilen kusurun GPS ikizi.
   ─────────────────────────────────────────────────────────────── */
describe('GPS heartbeat DEĞİŞİM değil VARIŞ dinler', () => {
  it('🔒 store shallow-equal guard DURUYOR — bu kilidin GEREKÇESİ', () => {
    /* Guard kaldırılırsa bu kilit anlamını yitirir; ama kaldırmak park hâlinde
       tüm subscriber'ları 2 Hz tetikler (termal regresyon). İkisi birlikte durmalı. */
    expect(unifiedVehicleStoreSrc).toContain('sameLoc');
    expect(unifiedVehicleStoreSrc).toContain('prev.latitude === next.latitude');
  });

  it('🔒 gpsService VARIŞ kanalı yayınlar ve JumpGuard\'dan ÖNCE tetikler', () => {
    expect(gpsServiceSrc).toContain('export function onGPSFixArrival');
    const emitIdx = gpsServiceSrc.indexOf('_emitFixArrival();');
    const jumpIdx = gpsServiceSrc.indexOf('JumpGuard: atlama reddedildi');
    expect(emitIdx).toBeGreaterThan(0);
    expect(jumpIdx).toBeGreaterThan(0);
    // "fix geldi" ile "fix kabul edildi" ayrı sorulardır: eleme beat'i susturamaz.
    expect(emitIdx).toBeLessThan(jumpIdx);
  });

  it('🔒 SystemHealthMonitor GPS beat\'ini VARIŞ kanalından alır (ve sızdırmaz)', () => {
    expect(healthMonitorSrc).toContain('onGPSFixArrival');
    expect(healthMonitorSrc).toMatch(/onGPSFixArrival\(\(\)\s*=>\s*\{\s*this\.beat\('GPS'\);/);
    // Zero-Leak: abonelik cleanup listesine girmeli
    expect(healthMonitorSrc).toContain('unsub1, unsub2, unsub3, unsub4');
  });

  it('🔒 VARIŞ kanalı aboneyi çağırır, cleanup gerçekten çıkarır', async () => {
    const { onGPSFixArrival } = await import('../platform/gpsService');
    let hits = 0;
    const off = onGPSFixArrival(() => { hits++; });
    // Kanalın kendisi test edilebilir olmalı; abone eklenip çıkarılabilmeli.
    expect(typeof off).toBe('function');
    off();
    off(); // idempotent — ikinci çağrı patlamamalı
    expect(hits).toBe(0); // fix üretilmedi → beat de yok (uydurma beat YASAK)
  });
});

/* ───────────────────────────────────────────────────────────────
   OdometerGuard hız KANITI tutarlılığı (2026-08-02)
   Guard'a füzyon hızı (_lastKnownSpeed) verilirken odometre
   `_gps.speed` (Doppler) kullanıyordu. Bağlı ama bayat/0 raporlayan
   bir OBD (0.85 > GPS 0.70) füzyon hızını 0'a çakar → guard'ın
   toleransı 50 m tabanına düşer → uzun Δt'de GERÇEK hareket
   "teleport" diye reddedilebilir (Yol Sayacı eksik sayar).
   ─────────────────────────────────────────────────────────────── */
describe('OdometerGuard en iyi hız kanıtını alır', () => {
  it('🔒 worker guard\'a füzyon ile GPS Doppler\'in BÜYÜĞÜNÜ geçer', () => {
    expect(vehicleComputeWorkerSrc).toContain('_guardSpeedKmh');
    expect(vehicleComputeWorkerSrc).toMatch(
      /_odoGuard\.check\(loc\.lat,\s*loc\.lng,\s*_guardSpeedKmh/,
    );
    // Tek otoriteye geri dönüş = regresyon
    expect(vehicleComputeWorkerSrc).not.toMatch(
      /_odoGuard\.check\(loc\.lat,\s*loc\.lng,\s*_lastKnownSpeed/,
    );
  });

  it('🔒 red kaydı `implied` hızı yazar — teleport mu kanıtsızlık mı ayırt edilebilsin', () => {
    expect(odometerGuardSrc).toContain('implied');
    expect(odometerGuardSrc).toContain('speedEvidence');
  });

  it('🔒 hız kanıtı arttıkça tolerans genişler; kanıt 0 iken 50 m tabanı korunur', async () => {
    const { OdometerGuard } = await import('../platform/vehicleDataLayer/OdometerGuard');
    const warmup = (g: InstanceType<typeof OdometerGuard>) => {
      // Startup penceresini (10 fix) sabit noktada kapat
      for (let i = 0; i < 11; i++) g.check(40, 30, 0, 500);
    };
    // ~0.09 km kuzeye kayma (≈ 0.00081°), Δt 5 s → gerçek 65 km/h'lik hareket
    const LAT2 = 40 + 0.00081;

    const gNoEvidence = new OdometerGuard();
    warmup(gNoEvidence);
    // Hız kanıtı YOK → yalnız 50 m taban → gerçek hareket reddedilir (kusurun kendisi)
    expect(gNoEvidence.check(LAT2, 30, 0, 5_000, 8)).toBe('invalid');

    const gWithEvidence = new OdometerGuard();
    warmup(gWithEvidence);
    // GPS Doppler 65 km/h kanıtı VARSA aynı hareket kabul edilir
    expect(gWithEvidence.check(LAT2, 30, 65, 5_000, 8)).toBe('ok');

    // Fizik sınırı korunur: kanıt olsa da 0.5 s'de 90 m teleport REDDEDİLİR
    const gTeleport = new OdometerGuard();
    warmup(gTeleport);
    expect(gTeleport.check(40 + 0.00081, 30, 65, 500, 8)).toBe('invalid');
  });
});

/* ───────────────────────────────────────────────────────────────
   Navigasyon HUD'u dar ekranda küçülür (saha 2026-08-03)
   Kullanıcı ekran görüntüsü: telefon yatayında TurnPanel + şerit
   kartı + 3 sütunlu alt bar haritanın yarısını kapatıyordu. Ölçüler
   head unit için sabit px yazılmıştı; telefonun ~400 px CSS
   yüksekliğine sığmıyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Navigasyon HUD dar ekranda yoğunlaşır', () => {
  it('🔒 yoğunluk kapısı YÜKSEKLİĞE bakar (genişliğe DEĞİL)', () => {
    /* Genişlik ölçütü HU'yu da yakalardı: 800×480 HU geniştir ama
       yüksekliği vardır ve tam HUD'a yer verir. Telefon yatayında
       daralan boyut YÜKSEKLİKTİR. */
    /* Eşik TEK KAYNAKTADIR (hooks/useDenseHud.ts) — birden fazla bileşen
       kullanıyor; kopyalanırsa biri güncellenip diğeri unutulur ve yerleşim
       yeniden çakışır (cihazda 2026-08-03 ölçülen kusur). */
    expect(useDenseHudSrc).toContain('HUD_DENSE_MAX_H');
    expect(useDenseHudSrc).toMatch(/height\s*>\s*0\s*&&\s*height\s*<\s*HUD_DENSE_MAX_H/);
    expect(useDenseHudSrc).not.toMatch(/width\s*<\s*HUD_DENSE_MAX_H/);
    expect(navigationHudSrc).toContain("from '../../hooks/useDenseHud'");
    expect(mapHudControlsSrc).toContain("from '../../hooks/useDenseHud'");
    // Eşiğin ikinci bir kopyası OLMAMALI
    expect(navigationHudSrc).not.toContain('const HUD_DENSE_MAX_H');
    expect(mapHudControlsSrc).not.toContain('const HUD_DENSE_MAX_H');
  });

  it('🔒 dikeyde ikincil satır ve şerit rehberi GİZLENİR', () => {
    /* Kural aynı — ikisi birlikte ~138 px yiyordu — ama karar JSX'ten SAF
       MODELE taşındı: tek yerde, test edilebilir. */
    const m = read('src/platform/navigation/core/hudPresentationModel.ts');
    expect(m, '"sonra …" satırı dikeyde gizlenmiyor').toContain('!emphasis && !portrait');
    expect(m, 'şerit rehberi veri/yaklaşma kapısını kaybetmiş')
      .toContain('input.hasLaneData && emphasis');
    const panel = read('src/components/map/hud/ManeuverPanel.tsx');
    expect(panel).toContain('hud.showNextManeuver');
    expect(panel).toContain('hud.showLaneGuidance');
  });

  it('🔒 YERLEŞİM ölçütü GÜVENLİK modlarıyla KARIŞTIRILMAZ', () => {
    /* `compact`/`limp` = CRITICAL/LIMP_HOME (bilişsel yük azaltma, GÜVENLİK
       kararı), yerleşim ise yalnız ekran geometrisidir. Birleştirilirse dar
       ekran sessizce güvenlik modu sanılır ve alanlar gizlenir.
       P0-NAV-04: `dense` prop'unun yerini modeldeki `layout` aldı — ayrım
       KORUNDU, kilit yeni konuma taşındı. */
    const m = read('src/platform/navigation/core/hudPresentationModel.ts');
    expect(m, 'yerleşim ölçütü kaldırılmış').toContain('readonly layout: HudLayout');
    expect(navigationHudSrc, 'yerleşim güvenlik moduna bağlanmış')
      .not.toMatch(/layout:\s*(suppCrit|isLimp)/);
    expect(navigationHudSrc).toContain("layout: narrowHud ? 'PORTRAIT' : 'LANDSCAPE'");
  });

  it('🔒 head unit ölçüleri DİKEYDEN KÜÇÜK OLAMAZ (okunabilirlik)', () => {
    /* P0-NAV-04: HUD yeniden tasarlandı, ölçüler BİLİNÇLİ değişti. Kilit
       kaldırılmadı — korunan invaryanta taşındı: yatay (head unit) ölçüsü
       dikeyden küçük olamaz, yoksa 7"/10" ünitede HUD sebepsiz küçülür. */
    const panel = read('src/components/map/hud/ManeuverPanel.tsx');
    expect(panel).toContain('const distFont  = big ? (portrait ? 44 : 52) : (portrait ? 34 : 40);');
    expect(panel).toContain('const streetFont = big ? (portrait ? 17 : 19) : (portrait ? 15 : 17);');
    const speed = read('src/components/map/hud/DrivingSpeed.tsx');
    expect(speed, 'hız rakamı yatayda küçülmüş').toContain('fontSize: portrait ? 34 : 42');
  });
});

/* ───────────────────────────────────────────────────────────────
   Araç ekranın altından TAŞMAZ (saha 2026-08-03)
   Kullanıcı: "araba gidince görünmüyor, geride kalıyor".
   KÖK: sürüş kamerası aracın `lookAheadM` metre ÖNÜNÜ merkeze alır;
   `topPadFrac` ORAN (yükseklikle ölçeklenir) ama `lookAheadM` METRE
   (piksel karşılığı yükseklikten BAĞIMSIZ) → ekran kısaldıkça araç
   alt kenardan taşar, hız arttıkça büsbütün kaybolur.
   ─────────────────────────────────────────────────────────────── */
describe('Sürüş kamerası aracı ekranda tutar', () => {
  it('🔒 telefon yüksekliğinde taşan aracı geri getirir', async () => {
    const { clampTopPadForVehicle } = await import('../platform/cameraEngine');
    // H=400, topPad=0.795*400≈318 → merkez (400+318)/2=359; araç 94 px altında ≈ 453 → TAŞMA
    const next = clampTopPadForVehicle(453, 400, 318, 72);
    expect(next).not.toBeNull();
    // Taşma = 453 - (400-72) = 125 → topPad 318 - 250 = 68
    expect(next).toBe(68);
    // Yeni merkez (400+68)/2=234 → araç 234+94=328 ≤ 328 sınırında: ekranda
    expect((400 + (next as number)) / 2 + 94).toBeLessThanOrEqual(400 - 72);
  });

  it('🔒 head unit yolu DOKUNULMAZ — taşma yoksa null (ikinci jumpTo YOK)', () => {
    // Bu kilit performans kilididir: her karede ikinci bir jumpTo kabul edilemez.
    return import('../platform/cameraEngine').then(({ clampTopPadForVehicle }) => {
      expect(clampTopPadForVehicle(571, 800, 560, 72)).toBeNull(); // 571 ≤ 728
      expect(clampTopPadForVehicle(300, 600, 400, 72)).toBeNull(); // 300 ≤ 528
    });
  });

  it('🔒 ölçülemeyen/eksik girdide kamerayı BOZMAZ (null döner)', async () => {
    const { clampTopPadForVehicle } = await import('../platform/cameraEngine');
    expect(clampTopPadForVehicle(NaN, 400, 318, 72)).toBeNull();
    expect(clampTopPadForVehicle(453, 0, 318, 72)).toBeNull();
    expect(clampTopPadForVehicle(453, 400, 0, 72)).toBeNull();
    expect(clampTopPadForVehicle(Infinity, 400, 318, 72)).toBeNull();
  });

  it('🔒 düzeltme topPad\'i NEGATİFE düşürmez', async () => {
    const { clampTopPadForVehicle } = await import('../platform/cameraEngine');
    const next = clampTopPadForVehicle(399, 400, 10, 72); // devasa taşma
    expect(next).toBe(0);
  });

  it('🔒 kamera GERÇEK ekran konumunu ölçer (tahmin etmez)', () => {
    // `map.project` kullanılmazsa pitch/bearing hesaba katılmaz ve düzeltme yanlış olur.
    expect(mapInteractionManagerSrc).toContain('map.project([lng, lat]).y');
    expect(mapInteractionManagerSrc).toContain('clampTopPadForVehicle');
  });
});

/* ───────────────────────────────────────────────────────────────
   Adres arama: Türkçe harfler + cihaz-içi veri (saha 2026-08-03)
   (1) "ş ç gibi harfler yazınca hemen kayboluyor" — KONTROLLÜ input
       Android IME kompozisyonunu React render'ı ile iptal ediyordu.
   (2) "Mersin Hemşirenin Park Piknik Yeri'ni bulamıyor" — motor ONLINE
       iken YALNIZ Nominatim'e bakıyor, cihazdaki POI DB/geçmiş/önbelleğe
       yalnız internet YOKKEN bakıyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Adres arama girişi IME-güvenli', () => {
  it('🔒 arama girişleri KONTROLSÜZ (React DOM değerini geri yazmaz)', () => {
    // `value={...}` geri gelirse Türkçe harfler yine kaybolur.
    // JSX ÖZNİTELİĞİ arıyoruz (satır başında girintili) — yorum içindeki
    // `value={query}` anlatımı bu kilidi yanlışlıkla düşürmesin.
    const jsxControlledValue = /^\s+value=\{query\}\s*$/m;
    expect(mapSearchBarSrc).toContain('defaultValue=""');
    expect(mapSearchBarSrc).not.toMatch(jsxControlledValue);
    expect(newHomeLayoutSrc).toContain('defaultValue=""');
    expect(newHomeLayoutSrc).not.toMatch(jsxControlledValue);
  });

  it('🔒 temizleme DOM değerini de siler (kontrolsüz girişte state yetmez)', () => {
    expect(mapSearchBarSrc).toContain("inputRef.current.value = ''");
    expect(newHomeLayoutSrc).toContain("inputRef.current.value = ''");
  });

  it('🔒 arama debounce\'u GPS değişiminde sıfırlanmaz', () => {
    /* Efekt `[query, gpsLat, gpsLon]` dinlerse GPS 2-5 Hz değiştiği için
       350 ms'lik timer sürekli silinir → araç hareket hâlindeyken arama
       İSTEĞİ HİÇ ateşlenmez. Konum ref'ten okunur. */
    expect(mapSearchBarSrc).toContain('}, [query]);');
    expect(mapSearchBarSrc).toContain('gpsRef.current.lat');
    expect(mapSearchBarSrc).not.toContain('}, [query, gpsLat, gpsLon]);');
  });
});

/* ───────────────────────────────────────────────────────────────
   Arama → Rota Önizleme: TEK CarOS navigasyon UI dili (saha 2026-09-10)
   Cihazda arama yüzeyi "kalın siyah çerçeveli prototip" gibi görünüyordu:
   kenarlar METİN token'ı `--oem-ink-4` ile çiziliyordu ve o token gündüz/
   güneş modunda `#3A4049` KATI koyu renge dönüşüyor (bkz. day-mode.css).
   Route Preview kartı ise ÇİZGİ ailesini (`--oem-line*`) kullanıyor.
   ─────────────────────────────────────────────────────────────── */
describe('Navigasyon arama yüzeyi Route Preview ile aynı token ailesini kullanır', () => {
  /** Yorumları sıyırıp yalnız GERÇEK kullanımı sınar (docblock kullanım değildir). */
  const searchCode = stripSrc(mapSearchBarSrc);
  const hudCode    = stripSrc(mapHudControlsSrc);

  it('🔒 arama yüzeyinde KENAR metin token ile çizilmez (--oem-ink-4 border YOK)', () => {
    /* `--oem-ink-4` yalnız METİN/placeholder rengi olarak kalabilir; kenar,
       ayraç veya borderBottom olarak KULLANILAMAZ — gündüz modunda siyah
       dikdörtgen üretir. */
    expect(searchCode).not.toMatch(/border[A-Za-z]*:\s*'[^']*var\(--oem-ink-4\)/);
    expect(searchCode).not.toMatch(/border:\s*'1px solid var\(--oem-ink-4\)'/);
    expect(searchCode).not.toContain('borderBottom');
  });

  it('🔒 arama kabuğu PreviewCard ile aynı yüzey/çizgi/gölge ailesini kullanır', () => {
    expect(searchCode).toContain('var(--oem-surface-0)');
    expect(searchCode).toContain('var(--oem-line-strong)');
    expect(searchCode).toContain('var(--oem-shadow-pop)');
    // PreviewCard'ın kabuk token'ları — aile ortak kalsın.
    expect(navigationHudSrc).toContain('var(--oem-surface-0)');
    expect(navigationHudSrc).toContain('shadow-[var(--oem-shadow-pop)]');
  });

  it('🔒 sonuç satırı sürüşe uygun dokunma hedefi taşır (min 60px)', () => {
    expect(searchCode).toContain('min-h-[60px]');
  });

  it('🔒 temizle düğmesi PreviewCard iptal düğmesiyle aynı dili taşır', () => {
    /* Eskiden çerçevesiz çıplak 16 px ikondu — sürüşte isabet ettirilemezdi. */
    expect(searchCode).toContain('w-9 h-9 rounded-xl');
    expect(navigationHudSrc).toContain('w-9 h-9 rounded-xl');
  });

  it('🔒 arama üst bandı sistem çubuğu için TABAN boşluk taşır', () => {
    /* Head unit WebView'ında env(safe-area-inset-top) çentik yokken 0 döner;
       düz `--sat + 12px` kutuyu duruma yapıştırıyordu. */
    expect(searchCode).toContain('max(var(--sat, 0px), 12px)');
  });

  it('🔒 kuş uçuşu mesafe rota mesafesiymiş gibi sunulmaz (~ öneki)', () => {
    /* Listedeki değer haversine'dir; PreviewCard'daki sağlayıcının YOL BOYU
       toplamıdır. Kütük #404 deseni: tahmin `~` ile işaretlenir. */
    expect(searchCode).toContain('~{km}');
    expect(searchCode).toContain('_haversineMeters');
  });

  it('🔒 haritayı KAPAT düğmesinin mürekkebi SABİT açık gri değildir', () => {
    /* Yüzey token'a bağlıyken metin sabit kalırsa gündüz modunda beyaz
       kutunun içinde açık gri yazı kaybolur → "ham/yarım çizilmiş" düğme. */
    expect(hudCode).toContain("color: 'var(--oem-ink-2");
    expect(hudCode).not.toContain("color: 'rgba(226,232,240,0.82)', fontWeight: 700, fontSize: 12,");
  });
});

describe('Adres motoru cihaz-içi veriyi ONLINE iken de kullanır', () => {
  it('🔒 online 0 sonuçta yerel arama DENENİR, doğrudan hata basılmaz', () => {
    expect(addressNavEngineSrc).toContain('_localSearch');
    /* Konum parametresi 2026-08-12'de eklendi (konum/şehir kapısı) — çağrının
       KENDİSİ kilitli kalır, imzası genişleyebilir. */
    expect(addressNavEngineSrc).toMatch(/if \(!results\.length\) \{[\s\S]{0,400}_localSearch\(destination[,)]/);
  });

  it('🔒 yerel arama ÇEVRİMDIŞI dalla AYNI kaynakları ve eşiği kullanır', () => {
    // Paralel/ikinci bir arama otoritesi kurmak yasak — aynı üç kaynak.
    expect(addressNavEngineSrc).toMatch(/_localSearch[\s\S]{0,900}searchOffline\(destination, 3\)/);
    expect(addressNavEngineSrc).toMatch(/_localSearch[\s\S]{0,900}searchOfflinePlaces\(destination, 5\)/);
    expect(addressNavEngineSrc).toMatch(/_localSearch[\s\S]{0,1400}h\.score < 0\.55/);
  });

  it('🔒 sorguda GEÇEN şehir yeniden önerilmez (uydurma öneri yok)', async () => {
    const mod = await import('../platform/addressNavigationEngine');
    // Modül içi yardımcı; dışa açık değilse davranışı kaynak üzerinden kilitle.
    expect(mod).toBeTruthy();
    expect(addressNavEngineSrc).toContain('_citySuggestions');
    expect(addressNavEngineSrc).toMatch(/filter\(\(c\) => !q\.includes\(_norm\(c\)\)\)/);
    // Eski körlemesine üçleme geri gelmemeli
    expect(addressNavEngineSrc).not.toContain('`${destination}, Mersin`');
  });
});

/* ───────────────────────────────────────────────────────────────
   Adres anlama turu (saha 2026-08-03)
   Kullanıcı: "Mavi'ye adres tarif edemeyeceksek asistan gereksiz".
   Ölçülen iki kusur:
   (1) `stripDative` apostrofu OPSİYONEL yapıyordu → ek TAŞIMAYAN
       şehir adlarının son harfleri kesiliyordu (Adana→"Ada").
   (2) Nominatim 0 sonuç dönünce hiç varyant denenmiyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Adres ayrıştırıcı yer adlarını BOZMAZ', () => {
  it('🔒 ek taşımayan şehir adları OLDUĞU GİBİ kalır', async () => {
    const { tryParseNavAddress } = await import('../platform/addressParser');
    /* Ölçülen eski davranış: Ankara→"Ankar" · Adana→"Ada" · Bursa→"Burs"
       Malatya→"Malat" · Antalya→"Antal". Türkiye'nin en çok söylenen şehir
       adlarının çoğu a/e ile bittiği için bu istisna değil KURALDI. */
    for (const city of ['Ankara', 'Adana', 'Bursa', 'Malatya', 'Antalya', 'Konya', 'Sakarya']) {
      const r = tryParseNavAddress(`${city} git`);
      expect(r, city).not.toBeNull();
      expect(r!.destination, city).toBe(city);
    }
  });

  it('🔒 apostroflu GERÇEK ek hâlâ soyulur', async () => {
    const { tryParseNavAddress } = await import('../platform/addressParser');
    expect(tryParseNavAddress("Mersin'e git")!.destination).toBe('Mersin');
    expect(tryParseNavAddress("Ankara'ya götür")!.destination).toBe('Ankara');
    expect(tryParseNavAddress("Hadi beni Mersin'e götür")!.destination).toBe('Mersin');
  });

  it('🔒 çok sözcüklü POI adı ayrıştırmada KISALTILMAZ', async () => {
    const { tryParseNavAddress } = await import('../platform/addressParser');
    // Bilgi ayrıştırıcıda yok edilmez; gevşetme geocoder'ın DENEMESİDİR.
    const r = tryParseNavAddress('Mersin Hemşirenin Park Piknik Yeri git');
    expect(r).not.toBeNull();
    expect(r!.destination).toBe('Mersin Hemşirenin Park Piknik Yeri');
  });
});

describe('Geocoder sorguyu bozmadan gevşetir', () => {
  it('🔒 ayırt edici baş korunur, sondan/şehirden gevşetilir', async () => {
    const { relaxQueryVariants } = await import('../platform/geocodingService');
    const v = relaxQueryVariants('Mersin Hemşirenin Park Piknik Yeri');
    expect(v.length).toBeGreaterThan(0);
    /* ToS + GECİKME bütçesi: her varyant ~1 sn hız sınırı + 2 sn fast-fail
       demektir. Sesli akışta kullanıcı bunu bekler → 2'yi AŞMAZ. */
    expect(v.length).toBeLessThanOrEqual(2);
    expect(v[0]).toBe('Hemşirenin Park Piknik Yeri'); // baştaki şehir düşer
    // Hiçbir varyant ayırt edici kelimeyi HARF SEVİYESİNDE kesmemeli
    for (const x of v) expect(x).not.toMatch(/Hemşireni\b|Mersi\b/);
  });

  it('🔒 kısa sorgu gevşetilmez (ayırt edicilik kaybı = yanlış yere gitme)', async () => {
    const { relaxQueryVariants } = await import('../platform/geocodingService');
    expect(relaxQueryVariants('Adana')).toEqual([]);
    expect(relaxQueryVariants('Mersin')).toEqual([]);
    expect(relaxQueryVariants('')).toEqual([]);
    // 4 harften kısa varyant üretilmez
    for (const x of relaxQueryVariants('a b c d')) expect(x.length).toBeGreaterThanOrEqual(4);
  });

  it('🔒 GEVŞETİLMİŞ tek sonuç OTOMATİK rotaya çevrilmez', () => {
    /* "Adana" yerine "Ada"ya sessizce götürmek bulamamaktan kötüdür:
       gevşetilmiş sonuç kullanıcının söylediği sorguyla bulunmuş DEĞİLDİR.
       KİLİT GÜÇLENDİRİLDİ (2026-08-12): aynı gerekçe konum/şehir kapısının iki
       işareti için de geçerlidir — çok uzak (`farFromUser`) ve şehri
       doğrulanamayan (`cityUnverified`) tek aday da onaya düşer. */
    expect(addressNavEngineSrc).toMatch(/!only\.relaxed[\s\S]{0,80}!only\.farFromUser/);
    expect(addressNavEngineSrc).toContain('!only.cityUnverified');
    expect(addressNavEngineSrc).toContain('results.length === 1 && autoSafe');
    expect(addressNavEngineSrc).toMatch(/if \(results\.length === 1\) \{[\s\S]{0,120}phase: 'selecting'/);
  });
});

/* ───────────────────────────────────────────────────────────────
   Numaralı sokak: YANLIŞ sokağa götürmek yasak (saha 2026-08-03)
   CANLI ÖLÇÜM: "0455. Sokak, Bağlar Mah., Tarsus" için Nominatim
   (serbest metin VE yapılandırılmış sorgu) şunları döndürdü:
     0411 · 0452 · 0423 · 0436 · 0478 · 3232 · 1713 · 4072 · 1102 · 0655
   İSTENEN NUMARA HİÇBİR DENEMEDE DÖNMEDİ. Numarayı bulanık eşleştirip
   aynı bölgedeki rastgele sokakları veriyor. Bu, "bulunamadı"dan daha
   tehlikelidir: kullanıcı 0455 ister, ürün onu 0411'e götürür.
   ─────────────────────────────────────────────────────────────── */
describe('Numaralı sokak sonuçları doğrulanır', () => {
  it('🔒 istenen numarayı taşımayan sonuç ELENİR', async () => {
    const { filterNumberedStreetMismatch } = await import('../platform/geocodingService');
    const q = 'Tarsus Bağlar Mahallesi 0455 Sokak';
    const results = [
      { fullName: '0411. Sokak, Bağlar Mahallesi, Tarsus, Mersin, Türkiye' },
      { fullName: '0452. Sokak, Bağlar Mahallesi, Tarsus, Mersin, Türkiye' },
      { fullName: '3232. Sokak, Şahin Mahallesi, Tarsus, Mersin, Türkiye' },
    ];
    expect(filterNumberedStreetMismatch(q, results)).toEqual([]);
  });

  it('🔒 DOĞRU numara geçer; baştaki sıfır farkı eşleşmeyi bozmaz', async () => {
    const { filterNumberedStreetMismatch } = await import('../platform/geocodingService');
    const hit = { fullName: '0455. Sokak, Bağlar Mahallesi, Tarsus, Mersin, Türkiye' };
    expect(filterNumberedStreetMismatch('… 0455 Sokak', [hit])).toEqual([hit]);
    expect(filterNumberedStreetMismatch('… 455. Sokak', [hit])).toEqual([hit]);
  });

  it('🔒 numarasız SORGU hiçbir sonucu elemez', async () => {
    const { filterNumberedStreetMismatch } = await import('../platform/geocodingService');
    const poi = [{ fullName: 'Bağlar Mahallesi, Tarsus, Mersin, Türkiye' }];
    expect(filterNumberedStreetMismatch('Bağlar Mahallesi Tarsus', poi)).toEqual(poi);
  });

  it('🔒 numaralı sorguda KAÇIŞ DELİĞİ YOK — üç saha turunun tamamı elenir', async () => {
    const { filterNumberedStreetMismatch } = await import('../platform/geocodingService');
    /* CİHAZ KAYITLARI (2026-08-03) — "0455 sokak" sorgusuna Nominatim'in
       döndürdükleri. Her turda daha gevşek bir kural denendi, her turda
       arkasından yeni bir alakasız yer geldi:
         tur 1 (filtre yok)          → İzmir "Sokak"            701 km
         tur 2 (numarasız→geç)       → Denizli "Sokak"
         tur 3 (sokak değilse geç)   → Özbekistan "Sukok"      3031 km
       Numaralı sokak sorgusu KESİN sorudur: numara yoksa cevap değildir. */
    const bogus = [
      { fullName: 'Sokak, Turgut Reis Mahallesi, İzmir, Konak, İzmir, Ege Bölgesi, 35280, Türkiye' },
      { fullName: 'Sokak, Yenişehir Mahallesi, Merkezefendi, Denizli, Ege Bölgesi, 20040, Türkiye' },
      { fullName: 'Sukok, Parkent district, Taşkent ili, Özbekistan' },
      { fullName: 'Bağlar Mahallesi, Tarsus, Mersin, Türkiye' },
      { fullName: 'Şamil Başayev Caddesi, Tarsus, Mersin, Türkiye' },
      { fullName: '0411. Sokak, Bağlar Mahallesi, Tarsus, Mersin, Türkiye' },
    ];
    expect(filterNumberedStreetMismatch('0455 sokak', bogus)).toEqual([]);
  });

  it('🔒 Türkçe adres kısaltmaları açılır ("mh" tek başına aramayı öldürüyordu)', async () => {
    const { expandTurkishAddressAbbrev, relaxQueryVariants } = await import('../platform/geocodingService');
    expect(expandTurkishAddressAbbrev('Tarsus Bağlar mh 0455 sokak'))
      .toBe('Tarsus Bağlar Mahallesi 0455 sokak');
    expect(expandTurkishAddressAbbrev('Atatürk cd 12 sk')).toBe('Atatürk Caddesi 12 Sokak');
    // Açılım İLK varyant olmalı — ölçülen en yüksek kazanç orada
    expect(relaxQueryVariants('Tarsus Bağlar mh 0455 sokak')[0])
      .toBe('Tarsus Bağlar Mahallesi 0455 sokak');
  });
});

/* ───────────────────────────────────────────────────────────────
   Sokak düzeyinde adres çözümleme (saha 2026-08-03)
   Kullanıcı: "herhangi bir sokak/mahalle ne varsa kendi sokağına
   gidebilmeli". Nominatim numaralı Türk sokaklarını EŞLEŞTİREMİYOR
   (ölçüldü); Overpass aynı OSM verisini TAM eşleşmeyle veriyor:
     "Tarsus Bağlar Mahallesi 0469 Sokak" → 0469. Sokak @ 36.918415, 34.863715
   ─────────────────────────────────────────────────────────────── */
describe('Sokak adıyla OSM çözümleme', () => {
  it('🔒 numaralı sokak: baştaki sıfır ve nokta farkı TOLERE edilir', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    // OSM "0469. Sokak" yazar, kullanıcı "0469 sokak" veya "469 sokak" der.
    for (const q of ['Bağlar Mahallesi 0469 Sokak', 'Bağlar mh 469 sk', '0469. sokak']) {
      const r = extractStreetQuery(q);
      expect(r, q).not.toBeNull();
      expect(r!.kind, q).toBe('numbered');
      expect(r!.nameRegex, q).toBe('^0*469\\.? ?Sokak.*$');
    }
  });

  it('🔒 adlı cadde/bulvar da çözümlenir (gövde BOŞLUĞA DUYARSIZ)', async () => {
    /* KİLİT GÜNCELLENDİ (2026-08-11, kütük #546) — kaldırılmadı.
       Eskiden gövde LİTERAL yazılıyordu: `^Şamil Başayev ?Cadde.*$`. Ölçüm
       kullanıcının `Kuvayimilliye` yazdığını, OSM'de adın `Kuvayi Milliye`
       olduğunu gösterdi → literal eşleşme boşluk yüzünden DÜŞÜYORDU. Gövde
       artık her karakter arasında opsiyonel boşluk taşır; harf ATILMAZ,
       sıra KORUNUR — yalnız boşluk esnetilir. */
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    const r = extractStreetQuery('Şamil Başayev Caddesi')!;
    expect(r.kind).toBe('named');
    /* Gövde harfleri sırayla ve opsiyonel boşlukla; tip sonda. */
    expect(r.nameRegex).toContain('Ş ?a ?m ?i ?l');
    expect(r.nameRegex).toMatch(/\) \?Cadde\.\*\$$/);
    /* Birleşik yazılmış hâli de AYNI deseni karşılar (asıl kazanım). */
    expect(new RegExp(r.nameRegex.replace(/^\^|\$$/g, ''), 'i').test('ŞamilBaşayev Caddesi')).toBe(true);
    expect(extractStreetQuery('Mavi Bulvar')!.kind).toBe('named');
  });

  it('🔒 sokak OLMAYAN sorguyu KAÇIRMAZ (POI aramasını gasp etmez)', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    expect(extractStreetQuery('Mersin Hemşirenin Park Piknik Yeri')).toBeNull();
    expect(extractStreetQuery('en yakın benzinlik')).toBeNull();
    expect(extractStreetQuery('')).toBeNull();
  });

  it('🔒 KONUMSUZ sorgu YAPILMAZ (yarıçapsız tarama Overpass\'i boğar)', async () => {
    const { searchStreetByName } = await import('../platform/streetSearchService');
    expect(await searchStreetByName('0469 Sokak')).toEqual([]);
    expect(await searchStreetByName('0469 Sokak', NaN, NaN)).toEqual([]);
  });

  it('🔒 geocode zinciri SON ŞANS olarak sokak aramasını çağırır', () => {
    // Nominatim + gevşetme tükendikten SONRA gelmeli; öncesinde değil.
    const src = geocodingServiceSrc;
    expect(src).toContain('searchStreetByName');
    /* P0-NAV-08: gevşetme döngüsü artık varyantları önce bir değişkene alıyor
       (`const variants = relaxQueryVariants(query)`) — SIRA invaryantı aynı,
       çapa sağlayıcı çağrısının KENDİSİDİR, döngünün yazım biçimi değil. */
    const relaxIdx  = src.indexOf('relaxQueryVariants(query)');
    const streetIdx = src.indexOf('await searchStreetByName(query');
    expect(relaxIdx).toBeGreaterThan(0);
    expect(streetIdx).toBeGreaterThan(relaxIdx);
  });
});

/* ───────────────────────────────────────────────────────────────
   Adres sağlayıcı katmanı — BYOK (saha 2026-08-03)
   Kullanıcı: "Google'ın yaptığını yapamıyorsak uygulama çöp olur,
   OEM seviyesinde çöz." Ölçüm sorunun VERİ olduğunu gösterdi:
   "0455. Sokak" yolu OSM'de ÇİZİLİ ama İSİMSİZ (350 m çevrede 41
   adsız yol; addr:street yalnız 2 nesnede). Ücretsiz OSM türevleri
   (Nominatim/Photon/Pelias) bunu bilemez → lisanslı sağlayıcı fişi.
   ─────────────────────────────────────────────────────────────── */
describe('Adres sağlayıcı katmanı (BYOK)', () => {
  it('🔒 GÖMÜLÜ/varsayılan anahtar YOK — ürün kutudan ücretsiz OSM ile gelir', () => {
    /* CLAUDE.md ticari kuralı: merkezi anahtar konmaz (fatura + ToS riski).
       Ayrıca sağlayıcıların çoğu sonucun kendi harita altlığı dışında
       gösterilmesini kısıtlar → varsayılan sağlayıcı SEÇİLEMEZ. */
    expect(geocodingProvidersSrc).not.toMatch(/AIza[A-Za-z0-9_-]{10,}/);
    expect(geocodingProvidersSrc).not.toMatch(/(apiKey|key)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/);
    expect(geocodingProvidersSrc).toContain('VARSAYILAN SAĞLAYICI YOKTUR');
  });

  it('🔒 anahtar YOKKEN premium yol hiç çağrılmaz (davranış birebir eski)', async () => {
    const mod = await import('../platform/geocodingProviders');
    // Depoda anahtar yok → boş dizi; çağıran ücretsiz zincire devam eder.
    await expect(mod.premiumGeocode('Adana')).resolves.toEqual([]);
    await expect(mod.premiumGeocode('')).resolves.toEqual([]);
  });

  it('🔒 durum özeti anahtar DEĞERİNİ taşımaz (yalnız VAR/YOK)', async () => {
    const mod = await import('../platform/geocodingProviders');
    const st = await mod.getGeocodeProviderStatus();
    expect(Object.keys(st).sort()).toEqual(['hasKey', 'provider']);
    expect(typeof st.hasKey).toBe('boolean');
  });

  it('🔒 premium sağlayıcı ücretsiz zincirden ÖNCE denenir', () => {
    const src = geocodingServiceSrc;
    const premiumIdx = src.indexOf('await premiumGeocode(query');
    const nomIdx     = src.indexOf('await _nominatimOnce(query');
    expect(premiumIdx).toBeGreaterThan(0);
    expect(premiumIdx).toBeLessThan(nomIdx);
  });

  it('🔒 üç sağlayıcı da Keystore KURTARMA kapsamında', () => {
    // Reinstall sonrası kullanıcı anahtarını yeniden girmek zorunda kalmasın.
    for (const k of ['geocodeGoogleApiKey', 'geocodeHereApiKey', 'geocodeYandexApiKey']) {
      expect(sensitiveKeyStoreSrc).toContain(k);
    }
    expect(sensitiveKeyStoreSrc).toMatch(/RECOVERY_KEYS[^\n]*geocodeGoogleApiKey/);
  });
});

/* ───────────────────────────────────────────────────────────────
   İki arama yüzeyi AYRIŞMAZ (cihazda gözlendi 2026-08-03)
   Harita arama çubuğuna "0455 sokak" yazınca Nominatim **İzmir'de
   701 km uzaktaki "Sokak"** kaydını öneriyordu; dokunulsa oraya rota
   kurulurdu. Aynı koruma `geocodeAddress` zincirinde vardı ama
   `searchPlaces` ayrı zincir olduğu için korumasızdı.
   ─────────────────────────────────────────────────────────────── */
describe('Harita araması da numaralı sokağı doğrular', () => {
  it('🔒 `searchPlaces` numara uyuşmazlığı filtresini UYGULAR', () => {
    expect(mapServiceSrc).toContain('filterNumberedStreetMismatch');
    // Nominatim sonucu DOĞRUDAN listeye eklenemez — önce elenmeli.
    expect(mapServiceSrc).not.toMatch(/combined\.push\(\.\.\.onlineRaw\)/);
    expect(mapServiceSrc).not.toMatch(/combined\.push\(\.\.\.onlineHits\)/);
    /* 2026-08-12: numara filtresinden sonra KONUM/ŞEHİR kapısı da geçilir →
       listeye giren dizi `onlineGated`tır. Sıra ÖNEMLİ: önce "doğru sokak mı",
       sonra "doğru şehirde / ulaşılabilir mi". */
    expect(mapServiceSrc).toMatch(/filterNumberedStreetMismatch\([\s\S]{0,420}_gate\(onlineHits/);
    expect(mapServiceSrc).toContain('combined.push(...onlineGated)');
  });

  /* ── KİLİT GÜNCELLENDİ (P0-NAV-06 · 2026-08-23) ──────────────────────────
     ESKİ KİLİT: `if (combined.length === 0)` → Overpass sokak araması.
     Ölçüm bu koşulun YETMEDİĞİNİ gösterdi: "Kuvayimilliye Caddesi" sorgusunda
     Nominatim 702 km ötedeki bir CAMİYİ ("Kuvayımilliye Cami, Beylikdüzü")
     döndürüyor → `combined` boş kalmıyor → sokak katmanı HİÇ çalışmıyordu.
     Aynı sorgu Overpass'e sorulduğunda 0,78 km'de "Kuvayi Milliye Caddesi"
     dönüyor (ölçüldü, 1385 ms). Kilit KALDIRILMADI, yeni doğru davranışa
     genişletildi: hiç sonuç yokken VE sokak istenip bulunamamışken koşar. */
  it('🔒 `searchPlaces` sonuç yoksa Overpass sokak aramasına düşer', () => {
    expect(mapServiceSrc).toContain('searchStreetByName');
    /* P0-NAV-07: çağrı artık KAPSAM seçenekleri taşıyor (çapa + genişletilmiş
       yarıçap). Koşul ve çağrı sırası DEĞİŞMEDİ; kilit yeni imzaya taşındı. */
    expect(mapServiceSrc).toMatch(
      /if \(combined\.length === 0 \|\| _streetPending\)[\s\S]{0,900}searchStreetByName\(query, userLat, userLng, \{/,
    );
  });

  /* ── P0-NAV-06 · 2026-08-23 ────────────────────────────────────────────────
     Katmanlar birbirini ELEMEZ. Eskiden 1./2. katman `maxResults`i doldurunca
     `searchPlaces` ERKEN DÖNÜYOR ve ÇEVRİMİÇİ katmanı hiç çalıştırmıyordu —
     kullanıcının "internet varken bile bulamıyor" şikâyetinin yapısal kaynağı. */
  it('🔒 cihaz-içi katman dolunca ÇEVRİMİÇİ katman ATLANMAZ', () => {
    expect(mapServiceSrc).not.toMatch(/if \(combined\.length >= maxResults\) return/);
    expect(mapServiceSrc).toContain('searchCategoryNearby');
    // Nominatim + Overpass kategori PARALEL koşar (seri değil).
    expect(mapServiceSrc).toMatch(/await Promise\.all\(\[[\s\S]{0,220}_nominatimSearch\(/);
  });

  it('🔒 Nominatim isteği ülke + viewbox YANLILIĞI taşır', () => {
    /* Yanlılık olmadan "Bağlar Mahallesi" en yakın adayı 200 km, "Şok Market"
       listesi Köln/Almanya 2706 km idi (ölçüldü). Kapı listeyi SIRALAR ama
       listeye hiç girmemiş adayı GERİ GETİREMEZ — yanlılık sağlayıcıda olmalı. */
    expect(mapServiceSrc).toContain("params.set('countrycodes', 'tr')");
    expect(mapServiceSrc).toContain("params.set('viewbox'");
    expect(mapServiceSrc).toContain("params.set('bounded', '0')");
  });

  it('🔒 kategori sorgusu ÇEVRİMDIŞI katmana da kanonik terimle sorulur', () => {
    /* `poi.db`de `search` sütunu "ad + KATEGORİ + adres"tir; ham sorgu
       "en yakın benzinlik" hiçbir şeye uymaz (ölçüldü: 0 sonuç), kanonik
       "benzinlik" terimi 1,24 km'de 8 sonuç verir. Bu, Overpass yavaşladığında
       ürünün elinde kalan TEK kategori cevabıdır. */
    expect(mapServiceSrc).toContain('_intent.category?.offlineCat');
    expect(mapServiceSrc).toMatch(/searchGlobal\(_offlineCat, userLat, userLng/);
  });

  /* ── P0-NAV-07 · 2026-08-23 ────────────────────────────────────────────────
     KAPSAM AYRIMI: "en yakın X" YEREL kalır, hedef ADRES kullanıcının
     çevresine hapsedilmez. Ölçüldü: `"Kuvayimilliye Caddesi"` kullanıcı
     çevresinde 20 km'de **0 sonuç** veriyordu; doğru cadde 24,6 km'deydi. */
  it('🔒 adres sorgusu için İKİNCİ (yanlılıksız) geocode geçişi VAR', () => {
    /* Viewbox yanlılığı yerel sorgular için ŞART ama aynı adlı UZAK adayları
       kesiyordu ("Bağlar Mahallesi" ±0,35° → 1 sonuç · yanlılıksız → 10).
       Ara genişlik ÇÜRÜTÜLDÜ: ±2,5° yerel adayı kaybediyor. */
    expect(mapServiceSrc).toContain('_wantsWideGeocode');
    expect(mapServiceSrc).toMatch(/_wantsWideGeocode\s*=\s*\n?\s*_catDef === null &&/);
    expect(mapServiceSrc).toContain('const onlineAll = [...onlineRaw, ...wideRaw]');
  });

  it('🔒 KATEGORİ sorgusu geniş aramaya AÇILMAZ ("en yakın" yerel kalır)', () => {
    // Kapı `_catDef === null` şartını TAŞIMAK ZORUNDA — yoksa "en yakın
    // eczane" ülke geneline açılır ve sonuçlar artık "yakın" olmaz.
    expect(mapServiceSrc).toMatch(/_wantsWideGeocode[\s\S]{0,80}_catDef === null/);
  });

  it('🔒 sokak katmanı ÇAPA + genişletilmiş yarıçapla çağrılır', () => {
    expect(mapServiceSrc).toContain('resolveCityAnchor(query)');
    expect(mapServiceSrc).toMatch(/searchStreetByName\(query, userLat, userLng, \{[\s\S]{0,120}allowWideRadius: true/);
  });

  it('🔒 iki arama yüzeyi AYNI kapsamı kullanır (ayrışma yasağı)', () => {
    /* Mavi/adres kartı zinciri ile harita arama çubuğunun ayrışması bu
       projenin tekrar eden saha kusurudur (#332 · #547 · P0-NAV-06/1). */
    expect(geocodingServiceSrc).toContain('resolveCityAnchor(query)');
    expect(geocodingServiceSrc).toContain('allowWideRadius: true');
  });

  it('🔒 alakasız TEK sonuç sokak katmanını BLOKLAYAMAZ', () => {
    // Sokak sorgusu varken "elde o sokak var mı" KANITA bakılır, sayıya değil.
    expect(mapServiceSrc).toContain('const _streetQuery   = extractStreetQuery(query)');
    expect(mapServiceSrc).toMatch(/_streetPending\s*=\s*_streetQuery !== null && !_hasStreetMatch\(/);
    expect(mapServiceSrc).toContain('function _hasStreetMatch(');
  });

  it('🔒 iki yüzey AYNI doğrulama fonksiyonunu paylaşır (kopya YOK)', () => {
    // Kopyalanırsa biri güncellenip diğeri unutulur — bu hata tam olarak öyle doğdu.
    expect(mapServiceSrc).toContain("from './geocodingService'");
    expect(geocodingServiceSrc).toContain('export function filterNumberedStreetMismatch');
  });
});

/* ───────────────────────────────────────────────────────────────
   Hız rakamı gündüz temasında GÖRÜNÜR (cihazda gözlendi 2026-08-03)
   Aktif navigasyonda hız paneli yalnız "KM/H" gösteriyordu; DOM'da
   değer ("Hız 0 KM/H") VARDI ama rakam beyaz-üstüne-beyaz kalmıştı.
   KÖK: normal durum rengi SATIR-İÇİ `#ffffff` idi. Satır-içi renk tema
   CSS'iyle EZİLEMEZ — bu yüzden `className="text-white"` kullanan başlık
   ("Sola dönün") gündüz temasında siyaha dönüşürken rakam kayboldu.
   ─────────────────────────────────────────────────────────────── */
describe('Navigasyon HUD gündüz temasında okunur', () => {
  it('🔒 hız rakamı TEMA MÜREKKEBİ kullanır (sabit beyaz DEĞİL)', () => {
    /* P0-NAV-04: hız kümesi `hud/DrivingSpeed`e taşındı; kilit de taşındı.
       Sabit `#ffffff` gündüz temasında beyaz-üstüne-beyaz kalıyordu. */
    const speed = read('src/components/map/hud/DrivingSpeed.tsx');
    expect(speed).toContain("const digitColor = (overSpeed || intervention) ? '#f87171'");
    expect(speed).toMatch(/caution \? '#fbbf24'[\s\S]{0,20}: 'var\(--oem-ink/);
    expect(speed, 'sabit beyaza dönülmüş').not.toMatch(/caution \? '#fbbf24'[\s\S]{0,20}: '#ffffff'/);
  });

  it('🔒 satır-içi #ffffff YALNIZ siyah zeminli acil ekranda kalır', () => {
    /* Satır-içi renk tema katmanınca ezilemez → tema-duyarlı yüzeylerde
       KULLANILMAZ. LimpHomeHUD kendi zeminini `#000000` yapar, orada meşru. */
    const inlineWhites = [...navigationHudSrc.matchAll(/color:\s*'#ffffff'/g)];
    expect(inlineWhites.length).toBeLessThanOrEqual(2);
    expect(navigationHudSrc).toContain("background:     '#000000'");
  });
});

/* ───────────────────────────────────────────────────────────────
   AR kamera görünürlüğü (cihazda ölçüldü 2026-08-03)
   Kullanıcı AR'a bastığında kamera GERÇEKTEN açılıyordu
   (video: srcObject var · track 'live' · 1280×720 · readyState 4)
   ama ekran değişmiyordu: `confidence < 0.5` kapısı modu STANDARD'a
   çeviriyor, video katmanı opacity 0 kalıyordu.
   Kapı YAPISAL olarak aşılamıyordu: güven = 0.60·şerit + 0.25·kare
   + 0.15·tabela → şerit çizgisi görülmeyen yolda tavan ~0.40.
   Türkiye'de mahalle sokaklarının çoğunda şerit çizgisi YOKTUR.
   ─────────────────────────────────────────────────────────────── */
describe('AR kamerası kullanıcı isteyince açılır', () => {
  it('🔒 AÇIK tercih (hybrid) güven kapısına TAKILMAZ', async () => {
    const mod = await import('../platform/modeController');
    // Saf çözümleyici dışa açık değilse kaynak üzerinden kilitle
    expect(modeControllerSrc).toMatch(
      /if \(pref === 'hybrid'\) return visionReady \? 'HYBRID_AR_NAVIGATION' : 'STANDARD_NAVIGATION';/,
    );
    // Güven kapısı 'hybrid' dalından SONRA gelmeli — önce gelirse tercihi ezer
    const hybridIdx = modeControllerSrc.indexOf("if (pref === 'hybrid')");
    const confIdx   = modeControllerSrc.indexOf('if (confidence < 0.5)');
    expect(hybridIdx).toBeGreaterThan(0);
    expect(confIdx).toBeGreaterThan(hybridIdx);
    expect(mod).toBeTruthy();
  });

  it('🔒 OTOMATİK mod muhafazakâr kalır (güven kapısı DURUYOR)', () => {
    // Kullanıcı istemeden güvenilmez AR'a geçilmemeli.
    expect(modeControllerSrc).toContain('if (confidence < 0.5) return \'STANDARD_NAVIGATION\';');
    expect(modeControllerSrc).toContain("pref === 'auto' && visionState === 'active'");
  });

  it('🔒 AR düğmesi İKİ durumludur — tıklama "auto"ya sapmaz', () => {
    /* Eski hâli: kapalıyken basınca `userPref === 'standard' ? 'auto' : 'hybrid'`
       → 'auto' güven kapılı olduğundan kullanıcı basıyor, hiçbir şey olmuyordu. */
    expect(visionOverlaySrc).not.toMatch(/userPref === 'standard' \? 'auto' : 'hybrid'/);
    expect(visionOverlaySrc).toContain("setUserVisionPreference('hybrid')");
  });

  it('🔒 AR ÇİZİMİ hâlâ güvene bağlı (kamera ≠ çizim doğruluğu)', () => {
    // Kamera açılması, güvenilmez şerit/rota çiziminin gösterilmesi demek DEĞİLDİR.
    expect(visionOverlaySrc).toContain('opacity: canvasOpacity');
    expect(visionOverlaySrc).toContain('opacity: isHybrid ? 1 : 0');
  });
});

/* ───────────────────────────────────────────────────────────────
   Titreşim filtresi kamerayı DONDURMAZ (cihazda ölçüldü 2026-08-03)
   Kullanıcı: "rota çizdim, böyle dengesiz duruyor."
   ÖLÇÜM: canvas 902×405 · araç ekran y=857 → alt kenardan 452 px
   AŞAĞIDA · padTop=0 (sürüş padding'i hiç uygulanmamış) · drivingMode
   true. KÖK: `setDrivingView` düşük hızda (<5 km/h) ve GPS oynaması
   <0.8 m iken ERKEN DÖNÜYOR → araç dururken sürüş kamerası HİÇ
   uygulanmıyor, kamera nerede kaldıysa orada donuyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Durakta kamera donmaz — araç çerçevede tutulur', () => {
  it('🔒 çerçeveleme ölçütü: ekran İÇİ + alt kenardan pay', async () => {
    const { isVehicleFramed } = await import('../platform/cameraEngine');
    // Cihazda ölçülen bozuk durum: 902×405 ekranda araç y=857
    expect(isVehicleFramed(451, 857, 902, 405, 72)).toBe(false);
    // Sağlıklı durum (aynı cihazda düzeltme sonrası hedeflenen yerleşim)
    expect(isVehicleFramed(451, 333, 902, 405, 72)).toBe(true);
    // Tam sınır: h - minBottom = 333 → dahil, 334 → hariç
    expect(isVehicleFramed(451, 334, 902, 405, 72)).toBe(false);
    // Yatay taşma da çerçevesizdir
    expect(isVehicleFramed(-5, 200, 902, 405, 72)).toBe(false);
    expect(isVehicleFramed(950, 200, 902, 405, 72)).toBe(false);
  });

  it('🔒 ölçülemeyen girdi ÇERÇEVESİZ sayılır (fail-open → kamera uygulanır)', async () => {
    const { isVehicleFramed } = await import('../platform/cameraEngine');
    expect(isVehicleFramed(NaN, 200, 902, 405)).toBe(false);
    expect(isVehicleFramed(451, Infinity, 902, 405)).toBe(false);
    expect(isVehicleFramed(451, 200, 0, 405)).toBe(false);
  });

  it('🔒 titreşim filtresi YALNIZ çerçeve doğruyken atlar', () => {
    /* `return` koşulsuz kalırsa yanlış duran kamera bir daha DÜZELMEZ —
       cihazda gözlenen kusur tam olarak buydu. */
    /* GÜNCELLENDİ: "doğru kamera" artık çerçeve VE yön demektir — araç ekranda
       doğru yerdeyken harita rotanın 140.6° tersine bakabiliyordu (cihaz ölçümü). */
    /* KİLİT BİÇİMİ GÜNCELLENDİ (NAVIGATION_CAMERA_SHADOW): erken dönüş tek
       satırdan bloğa alındı çünkü çıkmadan ÖNCE gölge gözlemi bildiriliyor.
       DAVRANIŞ AYNI: çerçeve VE yön doğruyken hiç iş yapmadan `return`. */
    /* 2026-09-05: `setDrivingView` artık kameranın UYGULANIP uygulanmadığını
       DÖNER (giriş kapısının sessizce yutmasını engellemek için). Erken dönüş
       "çerçeve VE yön zaten doğru" demek olduğu için `return true`tur —
       davranış DEĞİŞMEDİ, yalnız sonuç bildiriliyor. Kilit güncellendi. */
    expect(mapInteractionManagerSrc).toMatch(/if \(framed && oriented\) \{[\s\S]{0,600}?return true;/);
    expect(mapInteractionManagerSrc).toContain('isVehicleFramed(p.x, p.y, cv.clientWidth, cv.clientHeight)');
    // Eski koşulsuz erken dönüş geri gelmemeli
    expect(mapInteractionManagerSrc).not.toMatch(
      /JITTER_THRESHOLD_M\)\s*return;/,
    );
  });
});

/* ───────────────────────────────────────────────────────────────
   Durakta kamera DÖNMEZ (regresyon, aynı gün cihazda ölçüldü)
   #340'ın ilk hâli pozitif geri besleme üretti: "çerçeve bozuksa
   uygula" kuralı, durakta gürültülü GPS heading'ini kovalayan
   kameranın kendi kendini tetiklemesine yol açtı.
   ÖLÇÜM (araç 0 m hareket ederken, 7 sn):
     kamera merkezi sıçramaları: 1.3 · 1.5 · 63.7 · 24.5 · 8.2 · 19.3 m
     bearing: -60° → -96° → -124° → -142° → -173° → 162° → 138°  (~200°)
   Kullanıcı: "harita durduğum yerde durmadan hareket ediyor."
   ─────────────────────────────────────────────────────────────── */
describe('Durakta düzeltme YALNIZ yeniden ortalamadır', () => {
  it('🔒 durakta zoom/pitch dondurulur, bearing ROTADAN alınır', () => {
    /* GÜNCELLENDİ (aynı gün, cihaz geri bildirimi): önce bearing de
       `map.getBearing()` ile donduruluyordu. Dönme durdu AMA donan değer eski
       bir yön olduğundan rota ekranda ARKAYA görünüyordu — kullanıcı:
       "geri geri mi gideceğim". Durakta doğru yön kaynağı rotanın ileri
       yönüdür; dondurma yalnız ROTA YOKKEN yedek olarak kalır. */
    const src = mapInteractionManagerSrc;
    expect(src).toContain('_standstillFix');
    expect(src).toMatch(/_standstillFix[\s\S]{0,40}Number\.isFinite\(routeBearing/);
    expect(src).toContain('map.getBearing())');          // rota yoksa yedek
    /* P0-NAV-03: hareket dalına kare-başı sıçrama sınırı eklendi
       (`limitStep`). DURAKTA DONDURMA DEĞİŞMEDİ — kilit onu doğrular; yalnız
       çapa dizgesi yeni biçime güncellendi. Kilit KALDIRILMADI. */
    expect(src).toMatch(/const _zoomEff = _standstillFix\s*\?\s*map\.getZoom\(\)/);
    expect(src).toMatch(/const _pitchEff = _standstillFix\s*\?\s*map\.getPitch\(\)/);
    /* Hareket dalı sınırlayıcıdan geçer ama DURAKTA sınırlayıcı ÇALIŞMAZ. */
    expect(src).toMatch(/_standstillFix[\s\S]{0,80}limitStep\(_prevAppliedZoom/);
  });

  it('🔒 durakta look-ahead SIFIRLANIR (amaç çerçeveleme, ileri bakmak değil)', () => {
    /* GÜNCELLENDİ (ısınma düzeltmesi 2026-08-03): sürüş dalında ileri bakış artık
       öğrenilen tavanla sınırlanıyor (`_lookCapM`) — kare-başı düzeltme döngüsü
       cihazı ısıtıyordu. Kilidin AMACI aynı: DURAKTA look-ahead SIFIRDIR. */
    expect(mapInteractionManagerSrc)
      .toContain('const _lookEff = _standstillFix ? 0 : Math.min(_lookAhead, _lookCapM);');
    // Merkez hesabı dondurulmuş bearing'i kullanmalı — yoksa dönme geri gelir
    expect(mapInteractionManagerSrc).toContain('const _bearRad   = (_bearing * Math.PI) / 180;');
  });

  it('🔒 HER kamera uygulaması aynı dondurulmuş değerleri kullanır', () => {
    /* Klips ikinci bir kamera çağrısı atar; o hâlâ `smooth.bearing` kullanırsa
       düzeltme birinci çağrıda donar, ikincide yeniden döner.

       2026-08-13: birincil çağrı artık paylaşılan `_cameraOpts` nesnesinden
       beslenir (akıcılık için `easeTo`/`jumpTo` dallanması eklendi). Kilit
       KALKMADI — kapsamı genişledi: dondurulmuş değerleri TEK kaynakta
       doğrula, sonra hiçbir kamera çağrısının `smooth.bearing` kullanmadığını
       doğrula. */
    const src = mapInteractionManagerSrc;

    // 1) Paylaşılan seçenek nesnesi dondurulmuş bearing'i taşır.
    expect(src).toMatch(/_cameraOpts\s*=\s*\{[\s\S]{0,260}bearing:\s*_bearing/);
    // 2) Her iki dal da AYNI nesneden beslenir (ayrışma imkânsız).
    expect(src).toContain('map.easeTo({');
    expect(src).toContain('..._cameraOpts,');
    expect(src).toContain('map.jumpTo(_cameraOpts);');

    // 3) Klips düzeltmesi hâlâ dondurulmuş bearing ile.
    const jumps = [...src.matchAll(/map\.jumpTo\(\{[\s\S]{0,220}?\}\);/g)].map((m) => m[0]);
    expect(jumps.length).toBeGreaterThanOrEqual(1);
    for (const j of jumps) {
      if (!j.includes('padding')) continue;
      expect(j).toContain('bearing: _bearing');
      expect(j).not.toContain('bearing: smooth.bearing');
    }

    // 4) HİÇBİR kamera çağrısı ham smooth.bearing kullanmaz.
    expect(src).not.toMatch(/map\.(jumpTo|easeTo)\(\{[\s\S]{0,260}bearing:\s*smooth\.bearing/);
  });

  it('🔒 akıcı kamera BÜTÇELİ: durakta ve düşük-uçta animasyon YOK', () => {
    /* Boşta süren `easeTo` `map.isMoving()`i kalıcı true yapıp MapLibre'ı
       idle'da 90 fps render'a sokuyordu (§126 ölçümü). İki kapı da şart. */
    const src = mapInteractionManagerSrc;
    expect(src).toContain('const _smoothPan = !_standstillFix && !_isLowEndCamera();');
    expect(src).toMatch(/perf-low/);
  });
});

/* ───────────────────────────────────────────────────────────────
   "Durakta" kararı KONUMA değil HIZA bağlıdır (cihazda 2026-08-03)
   İlk düzeltme konum farkına (<0.8 m) bakıyordu. Sahada GPS doğruluğu
   ±3–6 m ölçüldü (ekran rozeti "GPS ±6m") → duran araçta bile ardışık
   fix'ler 0.8 m'yi aşıyor, "durakta" dalı hiç çalışmıyor, kamera
   gürültülü heading'i kovalayıp DÖNÜYORDU.
   ─────────────────────────────────────────────────────────────── */
describe('Durakta dondurma HIZ ile karar verilir', () => {
  it('🔒 `_standstillFix` yalnız hıza bakar — konum farkına DEĞİL', () => {
    const src = mapInteractionManagerSrc;
    expect(src).toContain('const _standstillFix = effectiveSpeed < CAMERA_CFG.JITTER_SPEED_KMH;');
    // Konum farkı içinde atanırsa GPS gürültüsü kararı ele geçirir (eski kusur)
    expect(src).not.toMatch(/_standstillFix\s*=\s*true;/);
  });

  it('🔒 konum farkı YALNIZ "hiç iş yapma" kısayolu içindir', () => {
    /* Konum oynamadıysa ve çerçeve doğruysa hiç çalışma (CPU tasarrufu);
       ama oynasa bile bearing dondurulmuş kalmalı. */
    /* KİLİT BİÇİMİ GÜNCELLENDİ (bkz. yukarıdaki gerekçe) — davranış aynı. */
    expect(mapInteractionManagerSrc).toMatch(/if \(framed && oriented\) \{/);
    expect(mapInteractionManagerSrc).toContain('çerçeve VE yön doğru → hiç iş yapma');
    /* GÜNCELLENDİ: eşik `JITTER_THRESHOLD_M` (0.8 m) idi; GPS gürültüsü
       (±3–6 m) bunun çok üstünde olduğundan duran araçta kamera her fix'te
       yeniden ortalanıp harita kayıyordu. Gürültü bandının üstündeki
       `STANDSTILL_RECENTER_MIN_M` kullanılır. */
    expect(mapInteractionManagerSrc).toContain('CAMERA_CFG.STANDSTILL_RECENTER_MIN_M');
  });
});

/* ───────────────────────────────────────────────────────────────
   HUD katmanları BİRBİRİNİ ÖRTMEZ (cihazda ölçüldü 2026-08-03)
   Kullanıcı: "layoutlar birbirini kapatmasın, dağınık olmasın."
   904×406 ekranda ölçülen gerçek çakışmalar:
     hız paneli (814,81,76×66) ↔ zoom kolonu (836,92,54×166) → 54×55 px
     GPS rozeti (15,15,68×20) + km çipi (15,49,76×22)
       ↔ dönüş kartı (36,9,208×55)                          → 47×20 px
   ─────────────────────────────────────────────────────────────── */
describe('Dar ekranda HUD katmanları çakışmaz', () => {
  it('🔒 nav zoom kolonu KALDIRILDI — yerini talep-üzerine ORTALA aldı', () => {
    /* Kilidin kökeni: bu kolon hız paneliyle 54×55 px ÇAKIŞIYORDU. P0-NAV-04
       çakışmayı çapa oynatarak değil, kolonu KALDIRARAK çözdü — sürüşte zoom
       bir web haritası alışkanlığıdır. Kilit yeni doğru davranışa güncellendi. */
    expect(mapHudControlsSrc, 'nav zoom kolonu geri gelmiş')
      .not.toContain('SAĞ: Navigasyon zoom + pusula');
    const dc = read('src/components/map/hud/DrivingControls.tsx');
    expect(dc, 'ortala düğmesi kaldırılmış').toContain('driving-recenter');
    /* Talep üzerine: yalnız kullanıcı kamerayı bıraktığında. */
    expect(dc).toContain('FOLLOW_SUSPENDED');
    expect(dc).toContain('USER_PANNING');
    /* Dokunma hedefi araç ekranı için BÜYÜK kalmalı. */
    expect(dc).toContain('minHeight: 48');
  });

  it('🔒 manevra kartına GPS rozeti / toplam km çipi BİNMEZ', () => {
    /* Eski çözüm kartı sağa kaydırmaktı (96 px). P0-NAV-04 kökü kaldırdı:
       o iki çip manevra bölgesinden ÇIKARILDI — GPS durumu tek durum şeridine,
       toplam mesafe yolculuk özetine taşındı. Kilit yeni davranışa güncellendi. */
    /* Yorumlar SIYRILIR: docblock kaldırılan çipleri ANLATIYOR, kullanmıyor. */
    const panelRaw = read('src/components/map/hud/ManeuverPanel.tsx');
    const panel = stripSrc(panelRaw);
    expect(panel, 'GPS rozeti manevra kartına geri konmuş').not.toMatch(/GPS|±/);
    expect(panel, 'toplam mesafe çipi manevra kartına geri konmuş')
      .not.toContain('totalDistanceMeters');
    /* Kart sol kenardan başlar — kaydırma hilesine gerek kalmadı. */
    expect(panel).toContain("left: 'max(12px, var(--sal, 0px))'");
  });

  it('🔒 yerleşim aritmetiği tutarlı: manevra kartı ekrana sığar', () => {
    /* Yeni kart yatayda 316 px (yaklaşmada 360). Sol kenar 12 → sağ kenar 372.
       Durum şeridi MERKEZ çapalıdır; 904 px'lik dar bir yatay ekranda bile
       merkez 452'dedir → çakışma yok. Ayrıca kart `maxWidth` ile viewport'a
       kırpılır. */
    const panel = read('src/components/map/hud/ManeuverPanel.tsx');
    expect(panel).toContain('width: portrait ? undefined : (big ? 360 : 316)');
    expect(panel).toContain("maxWidth: 'calc(100vw - 24px)'");
    expect(12 + 360).toBeLessThan(452);
  });
});

/* ───────────────────────────────────────────────────────────────
   Hız: durakta 0 · limit levhası GERÇEK veriden (saha 2026-08-03)
   Cihazda park hâlinde hız paneli 116 km/h gösterdi ve kırmızı
   "MAX 73 → YAVAŞLA" alarmını tetikledi; gerçek hız 0'dı.
   ─────────────────────────────────────────────────────────────── */
describe('Durakta hız 0 gösterir', () => {
  it('🔒 belirsizlik yarıçapı içindeki oynama HAREKET değildir', async () => {
    const { computeSpeedDelta, noiseFloorM } = await import('../platform/gps/speedCore');
    const prev = { lat: 36.9175, lng: 34.8621, ts: 1_000 };
    // ±6 m doğrulukta 6 m'lik GPS salınımı → taban 12 m → 0 (eski kod: 43 km/h)
    const jitter = { lat: 36.91755, lng: 34.8621, ts: 1_500 }; // ~5.6 m kuzey
    expect(computeSpeedDelta(jitter.lat, jitter.lng, jitter.ts, prev, 6)).toBe(0);
    // Doğruluk bilinmiyorsa bile taban vardır
    expect(computeSpeedDelta(jitter.lat, jitter.lng, jitter.ts, prev, undefined)).toBe(0);
    expect(noiseFloorM(6)).toBe(12);
    expect(noiseFloorM(0)).toBe(2.5);
    /* GÜNCELLENDİ (cihaz 2026-08-03): tavan 12 → 40. Aynı gün park hâlindeki
       telefonda `accuracy` 14.9 m ölçüldü; taban ölçüm belirsizliğinin ALTINDA
       kalınca kapı anlamsızlaşıyor ve 24 m'lik saf gürültü "hareket" sayılıp
       61.6 km/h hayaletini onaylıyordu. Kilidin AMACI aynı: taban SONSUZA
       GİTMEZ, sınırlıdır — sınır artık gerçekçi kötü doğruluğun üstünde. */
    expect(noiseFloorM(50)).toBe(40);        // üst sınır — taban sonsuza gitmez
    expect(noiseFloorM(undefined)).toBe(10); // doğruluk bilinmiyor → varsayılan 5 m
  });

  it('🔒 GERÇEK hareket bastırılmaz', async () => {
    const { computeSpeedDelta } = await import('../platform/gps/speedCore');
    const prev = { lat: 36.9175, lng: 34.8621, ts: 1_000 };
    // 1 sn'de ~28 m → 100 km/h; doğruluk 5 m (taban 10) → geçmeli
    const moved = { lat: 36.9175 + 28 / 111_320, lng: 34.8621, ts: 2_000 };
    const v = computeSpeedDelta(moved.lat, moved.lng, moved.ts, prev, 5);
    expect(v).toBeGreaterThan(20);      // m/s
    expect(v! * 3.6).toBeGreaterThan(90);
  });

  it('🔒 duraktan ani sıçrama TEK örnekle yayınlanmaz', () => {
    /* Anti-jitter kapısı `_lastKnownSpeed > 0` şartına bağlıydı → araç
       dururken devre dışıydı; 0→116 hiçbir kapıya takılmıyordu. */
    expect(vehicleComputeWorkerSrc).toContain('_speedJumpCandidate');
    expect(vehicleComputeWorkerSrc).toMatch(/_lastKnownSpeed === 0 && raw > ANTI_JITTER_KMH/);
  });
});

describe('Hız limiti levhası uydurmaz', () => {
  it('🔒 RASTGELE limit üreten sahte servis KALDIRILDI', () => {
    // Her 30 sn `[30,50,70,82,90,110,120]` arasından rastgele seçiyordu.
    expect(speedLimitServiceSrc).not.toContain('Math.random()');
    // Yalnız TANIM aranır — kaldırıldığını anlatan yorum kilidi düşürmesin
    expect(speedLimitServiceSrc).not.toContain('export function startSpeedLimitService');
    expect(useLayoutServicesSrc).not.toContain('startSpeedLimitService');
  });

  it('🔒 çıkarım yol SINIFINDAN; bilinmeyen sınıf → null', async () => {
    const { inferLimitFromHighwayClass } = await import('../platform/speedLimitService');
    expect(inferLimitFromHighwayClass('motorway')).toBe(120);
    expect(inferLimitFromHighwayClass('residential')).toBe(50);
    expect(inferLimitFromHighwayClass('living_street')).toBe(20);
    // Uydurma yok: tanınmayan/eksik sınıf değer ÜRETMEZ
    expect(inferLimitFromHighwayClass('bilinmeyen')).toBeNull();
    expect(inferLimitFromHighwayClass(undefined)).toBeNull();
  });

  /* KİLİT GÜNCELLEMESİ (VEHICLE_AWARE_SPEED_LIMIT_P0): levha çizimi
     `NavigationHUD` içinden PAYLAŞILAN `SpeedLimitCard`a taşındı (mini harita
     ile tam ekranın farklı değer göstermesi kusuru kapatıldı). Kilit
     kaldırılmadı — yeni doğru yere taşındı. */
  it('🔒 levha KAYNAĞINI ayırt eder — kesin olmayan sayı levha gibi sunulmaz', () => {
    expect(speedLimitServiceSrc).toContain("source: 'osm'");
    expect(speedLimitServiceSrc).toContain("source: 'inferred'");
    // Arayüz: kesin olmayan hüküm kesikli çerçeve + açık kaynak etiketi
    expect(speedLimitCardSrc).toContain("definitive ? 'solid' : 'dashed'");
    expect(speedLimitCardSrc).toContain('limit.sourceLabel');
  });

  /* SAHA 2026-08-06 (Adana-Erdemli Otoyolu, 93 km/h): Overpass 22 × CONNECTION_RESET
     + 504 + **429** döndürdü, levha otoyolda HİÇ çizilemedi. Kök: İKİ OTORİTE —
     gösterim geçerliliği sınıfa duyarlı (otoyol 1500 m) ama yeniden sorgulama
     sabit 200 m'ydi → aynı geçerli pencerede 7 gereksiz sorgu → hız sınırı. */
  it('🔒 yeniden sorgulama mesafesi = levhanın GEÇERLİLİK yarıçapı (tek otorite)', async () => {
    const { _requeryDistM } = await import('../platform/speedLimitService');
    const { speedLimitMaxDistanceM } = await import('../platform/navigation/core/speedLimitTruthModel');

    // Otoyol/şehirlerarası: sorgu kapısı gösterim geçerliliğiyle AYNI olmalı
    for (const hw of ['motorway', 'trunk', 'primary', 'secondary']) {
      expect(_requeryDistM(hw), `${hw} için iki otorite ayrışmamalı`)
        .toBe(speedLimitMaxDistanceM(hw));
    }
    expect(_requeryDistM('motorway')).toBe(1500);

    // Şehir içi ve BİLİNMEYEN sınıf 200 m tabanında KALIR → regresyon yok
    expect(_requeryDistM('residential')).toBe(200);
    expect(_requeryDistM(null)).toBe(200);

    // Sorgu kapısı sabit 200'e geri dönmemeli (kaynak kilidi)
    expect(speedLimitServiceSrc).toContain('_requeryDistM(lastHighwayRef.current)');
  });

  it('🔒 hız aşılınca levha KIRMIZI olur; levha HER ZAMAN hızın SOLUNDA', () => {
    /* P0-NAV-04: levha artık koşulsuz hızın solundadır — sürücü "ne kadar
       gidebilirim"i "ne kadar gidiyorum"dan ÖNCE okur. Aşım sinyali korundu. */
    const speed = read('src/components/map/hud/DrivingSpeed.tsx');
    expect(speed).toContain('overSpeed={overSpeed}');
    expect(speed).toContain('const overSpeed = hasLimit && speedKmh > (limitKmh as number) + OVER_SPEED_TOLERANCE_KMH');
    /* Levha JSX'te hız kutusundan ÖNCE gelir → soldadır. */
    const iSign = speed.indexOf('<SpeedLimitCard');
    const iVal  = speed.indexOf('driving-speed-value');
    expect(iSign).toBeGreaterThan(0);
    expect(iSign, 'levha hızın sağına geçmiş').toBeLessThan(iVal);
  });

  it('🔒 uygulanabilir sınır YOL ile ARAÇ SINIFININ küçüğüdür (tablo levhayı yükseltemez)', () => {
    expect(effectiveLimitAuthoritySrc).toContain('Math.min(roadLimitKmh, capKmh)');
    // Araç sınıfı bilinmiyorken otomobil tavanı VARSAYILMAZ.
    expect(turkeyPolicySrc).toContain('otomobil tavanı VARSAYILMAZ');
  });
});

/* ───────────────────────────────────────────────────────────────
   Rota kırpma ile işaretçi oturtma AYNI eşiği kullanır
   (cihazda ölçüldü 2026-08-03: araç rotadan 56 m uzakta çizilirken
   rota çizgisi 56 m ötedeki snapped noktadan kesiliyordu → aracın
   önünde boşluk. Ürün aynı anda "rotadayım" ve "rotada değilim"
   diyordu.)
   ─────────────────────────────────────────────────────────────── */
describe('Rota kırpma ile görsel oturtma çelişmez', () => {
  it('🔒 kırpma eşiği = görsel oturtma eşiği (ayrı sabit YOK)', () => {
    const src = navigationServiceSrc;
    // Eski geniş tolerans geri gelirse aracın önünde boşluk yeniden doğar
    expect(src).not.toContain('TRIM_OFF_ROUTE_MAX_M');

    /* KİLİDİN NİYETİ: rota-dışılık kapılarının HEPSİ tek sabiti kullanır.
       2026-08-08'de üçüncü tüketici eklendi — `getSnappedRoadBearing()`
       (kamera yön otoritesi). Sayı 2 → 3 oldu; kural DEĞİŞMEDİ, kapsamı
       genişledi: işaretçiyi oraya çizecek kadar güvenmiyorsak kamerayı da
       oraya döndürmeyiz. */
    const uses = [...src.matchAll(/_lastOffRouteM > SNAP_VISUAL_THRESHOLD_M/g)];
    expect(uses.length).toBe(3);

    /* ASIL KİLİT (sayıdan güçlü): rota-dışılık HİÇBİR yerde başka bir eşikle
       kıyaslanmaz. Yeni bir kapı gelirse bu sabiti kullanmak ZORUNDA. */
    const otherThresholds = [...src.matchAll(/_lastOffRouteM\s*[<>]=?\s*(\w+)/g)]
      .map((m) => m[1])
      .filter((name) => name !== 'SNAP_VISUAL_THRESHOLD_M');
    expect(otherThresholds, 'rota-dışılık için ikinci bir eşik doğmuş').toEqual([]);
  });

  it('🔒 eşik makul aralıkta (GPS gürültüsünü tolere eder, yalan söylemez)', () => {
    const m = navigationServiceSrc.match(/const SNAP_VISUAL_THRESHOLD_M = (\d+);/);
    expect(m).not.toBeNull();
    const v = Number(m![1]);
    expect(v).toBeGreaterThanOrEqual(10);   // altı: normal GPS gürültüsünde kırpma ölür
    expect(v).toBeLessThanOrEqual(30);      // üstü: rotada olmadığı hâlde "rotadayım" der
  });
});

/* Durakta gösterge GERÇEKTEN 0 — Doppler gürültü bandı (cihazda 2026-08-03:
   belirsizlik tabanı eklendikten SONRA bile gösterge 1 km/h'de takılıydı). */
describe('Durakta gösterge 0 — Doppler gürültüsü de bastırılır', () => {
  it('🔒 deadzone Doppler durağan gürültü bandının ÜSTÜNDE', async () => {
    const { GPS_SPEED_DEADZONE_KMH, applySpeedFilters } = await import('../platform/gps/speedCore');
    expect(GPS_SPEED_DEADZONE_KMH).toBeGreaterThanOrEqual(2);
    expect(GPS_SPEED_DEADZONE_KMH).toBeLessThan(5);   // yürüme hızını gizlemez
    // Durağan Doppler gürültüsü (0.3 m/s ≈ 1.08 km/h) → 0
    expect(applySpeedFilters(0.3, 0)).toBe(0);
    // Gerçek sürünme (2 m/s ≈ 7.2 km/h) → korunur
    expect((applySpeedFilters(2, 0) as number) * 3.6).toBeCloseTo(7.2, 1);
  });
});

/* ───────────────────────────────────────────────────────────────
   Durakta harita ROTANIN İLERİ YÖNÜNE bakar (saha 2026-08-03)
   Dönmeyi durdurmak için bearing dondurulmuştu; ama donan değer eski
   bir yön olduğundan rota ekranda ARKAYA doğru görünüyordu.
   Kullanıcı: "geri geri mi gideceğim".
   ─────────────────────────────────────────────────────────────── */
describe('Durakta kamera yönü rotadan gelir', () => {
  it('🔒 durakta bearing GPS heading DEĞİL rota yönüdür', () => {
    const src = mapInteractionManagerSrc;
    expect(src).toContain('routeBearing');
    expect(src).toMatch(/_standstillFix\s*\n?\s*\?\s*\(Number\.isFinite\(routeBearing/);
    // Rota yoksa mevcut bearing korunur (dondurma davranışı yedek olarak durur)
    expect(src).toContain('map.getBearing())');
  });

  it('🔒 rota yönü araçtan SONRAKİ manevraya bakar, çok yakınsa kullanılmaz', () => {
    const src = fullMapViewSrc;
    expect(src).toContain('_routeBearing');
    expect(src).toContain('bearingBetween(displayLat, displayLng, _sLat, _sLon)');
    // 8 m altında yön anlamsızdır (gürültü) → hesaplanmaz
    expect(src).toMatch(/distM\(displayLat, displayLng, _sLat, _sLon\) > 8/);
  });

  it('🔒 durakta yeniden ortalama eşiği GPS gürültü bandının üstünde', async () => {
    const { CAMERA_CFG } = await import('../platform/cameraEngine');
    expect(CAMERA_CFG.STANDSTILL_RECENTER_MIN_M).toBeGreaterThanOrEqual(5);
    expect(CAMERA_CFG.STANDSTILL_RECENTER_MIN_M).toBeLessThanOrEqual(12);
    expect(mapInteractionManagerSrc).toContain('CAMERA_CFG.STANDSTILL_RECENTER_MIN_M');
  });
});

/* Odometre: belirsizlik altındaki oynama MESAFE değildir (Yol Sayacı park
   hâlinde 103,6 → 103,8 tırmanıyordu — cihazda ölçüldü). */
describe('Yol sayacı durakta artmaz', () => {
  it('🔒 Haversine birikimi belirsizlik tabanının ALTINDA reddedilir', () => {
    expect(vehicleComputeWorkerSrc).toContain('_odoFloorM');
    expect(vehicleComputeWorkerSrc).toContain('if (deltaKm * 1000 <= _odoFloorM) return;');
    /* Taban accuracy'den türetilir — sabit değil.
       GÜNCELLENDİ (cihaz 2026-08-03/2): kullanıcı park hâlinde sayacın
       95 → 106,7 km çıktığını bildirdi. Taban artık TEK fix'ten değil, İKİ
       fix'in KÖTÜ doğruluğundan üretiliyor (`_odoAccM`) ve tavanı 40 m —
       ölçülen `accuracy` 14.9 m iken 12 m'lik tavan kapıyı anlamsız
       kılıyordu. Kilidin AMACI aynı: taban SABİT DEĞİL, accuracy'den gelir. */
    expect(vehicleComputeWorkerSrc).toMatch(/loc\.accuracy\) \? loc\.accuracy : 5,/);
    expect(vehicleComputeWorkerSrc).toMatch(/_odoFloorM = Math\.min\(40, Math\.max\(2\.5, _odoAccM \* 2\)\)/);
  });
});


/* ───────────────────────────────────────────────────────────────
   "Doğru kamera" = çerçeve VE yön (cihazda ölçüldü 2026-08-03)
   Rota yönü düzeltmesi eklendikten SONRA bile harita rotanın
   140.6° tersine bakıyordu: harita 8.5° · rota 149.1°. Sebep,
   durakta kameranın "zaten doğru" sayılıp erken dönmesiydi —
   kontrolde YÖN yoktu, yalnız çerçeve vardı.
   ─────────────────────────────────────────────────────────────── */
describe('Durakta kamera yönü de kontrol edilir', () => {
  it('🔒 erken dönüş çerçeve VE yön doğruyken yapılır', () => {
    const src = mapInteractionManagerSrc;
    expect(src).toContain('const oriented =');
    expect(src).toMatch(/if \(framed && oriented\) \{[\s\S]{0,600}?return true;/);
    // Yalnız çerçeveye bakan eski hâl geri gelmemeli
    expect(src).not.toMatch(/if \(framed\) return;/);
    /* YENİ: erken dönüş yolu gölgeye de BİLDİRİLİR — atlanan güncelleme
       LAB'da görünür (aksi hâlde "legacy hiç atlamıyor" yanılgısı doğardı). */
    expect(src).toContain('_reportShadow(map, false,');
  });

  it('🔒 yön toleransı makul (salınım yok, ters bakış yakalanır)', () => {
    const m = mapInteractionManagerSrc.match(/STANDSTILL_BEARING_TOLERANCE_DEG = (\d+)/);
    expect(m).not.toBeNull();
    const v = Number(m![1]);
    expect(v).toBeGreaterThanOrEqual(5);   // altı: GPS/render gürültüsünde salınır
    expect(v).toBeLessThanOrEqual(45);     // üstü: 140° ters bakışı kaçırır
  });

  it('🔒 yön sapması kamera güncellemesini TETİKLER', () => {
    /* Durakta hiçbir girdi değişmediği için `setDrivingView` hiç çağrılmıyordu;
       yön sapması `_camChanged`e eklenmezse düzeltme asla uygulanmaz. */
    expect(fullMapViewSrc).toContain('_routeBearOff');
    expect(fullMapViewSrc).toContain('_routeBearOff > 15');
  });
});


/* ───────────────────────────────────────────────────────────────
   Doppler hayaleti YER DEĞİŞTİRME ile çürütülür (cihaz 2026-08-03)
   Park hâlindeki araçta gösterge 58 km/h yazdı; aynı anda araç
   işaretçisi ve rota ekrandan KAYBOLDU — sahte hız 5 km/h eşiğini
   aşınca kamera sürüş yoluna geçip look-ahead'i büyütüyor.
   Konum-delta tabanı bunu yakalamaz: değer Doppler'den geliyordu.
   ─────────────────────────────────────────────────────────────── */
describe('Doppler hayalet hızı çürütülür', () => {
  it('🔒 hiç kıpırdamayan araçta yüksek Doppler SIFIRLANIR', async () => {
    const { reconcileDopplerWithDisplacement, noiseFloorM } =
      await import('../platform/gps/speedCore');
    const floor = noiseFloorM(3);                 // 6 m
    // 58 km/h = 16.1 m/s; 1.5 sn'de 24 m iddia ediyor ama yer değiştirme 0
    expect(reconcileDopplerWithDisplacement(16.1, 0, 1.5, floor)).toBe(0);
  });

  it('🔒 kanıt yetersizken Doppler değerine DOKUNULMAZ (kısa Δt)', async () => {
    const { reconcileDopplerWithDisplacement, noiseFloorM } =
      await import('../platform/gps/speedCore');
    const floor = noiseFloorM(3);                 // 6 m
    // Aynı hız, 0.5 sn: iddia 8 m — tabanın 3 katı (18 m) DEĞİL → karışma
    expect(reconcileDopplerWithDisplacement(16.1, 0, 0.5, floor)).toBe(16.1);
  });

  it('🔒 GERÇEK hareket bastırılmaz', async () => {
    const { reconcileDopplerWithDisplacement, noiseFloorM } =
      await import('../platform/gps/speedCore');
    const floor = noiseFloorM(3);
    // 30 km/h = 8.3 m/s, 2 sn'de 16.6 m GERÇEKTEN yer değiştirdi → dokunma
    expect(reconcileDopplerWithDisplacement(8.3, 16.6, 2, floor)).toBe(8.3);
    // Ölçülemeyen girdi → dokunma (kör kalıp hız öldürme)
    expect(reconcileDopplerWithDisplacement(8.3, NaN, 2, floor)).toBe(8.3);
    expect(reconcileDopplerWithDisplacement(8.3, 0, 0, floor)).toBe(8.3);
  });

  it('🔒 çapraz doğrulama gpsService hattına BAĞLI', () => {
    expect(gpsServiceSrc).toContain('reconcileDopplerWithDisplacement');
    expect(gpsServiceSrc).toContain('pickRawSpeed(_gpsSpeedChecked, deltaSpeed)');
  });
});

/* ───────────────────────────────────────────────────────────────
   NAV-CORE-P0 (2026-08-03) — navigasyon çekirdeği kilitleri.

   Bu turda kapatılan kusurlar defalarca geri gelebilecek türden:
   birim hatası, kuş uçuşu mesafe, kanıtsız şerit rehberi ve ölü
   localhost katmanı. Hepsi burada kilitlenir.
   ─────────────────────────────────────────────────────────────── */
describe('NAV-CORE-P0 kilitleri', () => {
  it('🔒 BİRİM: store.speed km/h — navigasyon zincirinde 3.6 ile ÇARPILMAZ', () => {
    const nav = read('src/platform/navigationService.ts');
    /* Kök: UnifiedVehicleStore.speed ZATEN km/h. Üç yerde 3.6 ile çarpılıyordu →
       ETA sistematik kısa, varış kapısı 10 km/h yerine 2.8 km/h, koridor
       önbelleği 3.6 kat fazla veri çekiyordu. */
    expect(nav, 'store hızı yine 3.6 ile çarpılıyor (birim hatası geri geldi)')
      .not.toMatch(/\(_raw(Arr)?Spd \?\? 0\) \* 3\.6/);
    expect(nav).not.toMatch(/\(_cspd \?\? 0\) \* 3\.6/);
    // Adım hızı (m/s → km/h) DOĞRU bir dönüşümdür, korunmalı.
    expect(nav).toContain('(step.distance / step.duration) * 3.6');
  });

  it('🔒 MANEVRA MESAFESİ yol-boyu hesaplanır (kuş uçuşu geri gelmesin)', () => {
    const rs = read('src/platform/routingService.ts');
    expect(rs, 'yol-boyu manevra mesafesi kaldırılmış')
      .toContain('alongRouteDistanceToManeuver');
    expect(rs, 'mesafe kaynağı etiketi kaldırılmış')
      .toMatch(/distanceToNextTurnSource/);
    // Kuş uçuşu YALNIZ yedek yoldur ve öyle etiketlenir.
    expect(rs).toContain("distSource = 'STRAIGHT_LINE'");
  });

  it('🔒 ŞERİT REHBERİ yalnız GERÇEK lanes verisinden çizilir', () => {
    const hud = read('src/components/map/NavigationHUD.tsx');
    // Manevra tipinden ok türetme geri gelmemeli.
    expect(hud, 'şerit oku yine manevra tipinden türetiliyor (kanıtsız bilgi)')
      .not.toMatch(/const goesLeft\s*=\s*mod\.includes\('left'\)/);
    /* Kanıt yoksa panel HİÇ çıkmaz.
       2026-09-07: boş/eksik kanıt kapısı bileşenden SAF modele taşındı
       (`laneGuidanceModel.resolveLaneRow` → `null`). Koruma KALDIRILMADI,
       yer değiştirdi; kilit yeni tek-kaynağa yeniden bağlandı — aksi hâlde
       taradığı metin kaybolduğu için sessizce KÖR kalırdı.
       Model tarafı `laneGuidanceModel.test.ts` §3'te ayrıca kilitlidir. */
    expect(hud, 'bileşen şerit satırını modelden okumuyor')
      .toContain('resolveLaneRow(step.lanes)');
    expect(hud, 'kanıt yokken panel yine çiziliyor')
      .toMatch(/if \(!row\) return null;/);
    const lgm = read('src/platform/navigation/core/laneGuidanceModel.ts');
    expect(lgm, 'boş/eksik şerit kanıtı kapısı modelden de kaldırılmış')
      .toMatch(/if \(!lanes \|\| lanes\.length === 0\) return null;/);
    /* İKİ ayrı gerçek (`valid` · `active`) yine tek boolean'a çökmesin. */
    expect(lgm).toContain("'NOT_ALLOWED'");
    expect(lgm).toContain("'ROUTE_SELECTED'");
    expect(lgm).toContain("'ALLOWED'");
  });

  it('🔒 DÖNEL KAVŞAK çıkışı yalnız KANITLIYSA söylenir', () => {
    /* P0-NAV-15: çeviri OTORİTESİ `maneuverSemanticsModel`e taşındı
       (`routingService.toTR` artık ince bir sarmalayıcı). İnvaryant AYNI —
       yalnız hangi dosyada kanıtlandığı değişti. Ayrıştırma hâlâ
       `routingService`tedir (OSRM yanıtını orası okur). */
    const rs = read('src/platform/routingService.ts');
    expect(rs, 'maneuver.exit ayrıştırması kaldırılmış').toMatch(/maneuver\.exit/);
    const mm = read('src/platform/navigation/core/maneuverSemanticsModel.ts');
    // Sayı yoksa genel ifadeye düşülür — uydurulmaz.
    expect(mm).toContain("'Dönel kavşakta devam edin'");
    expect(mm, 'çıkış numarası kanıt kapısı kaldırılmış')
      .toMatch(/exit != null && Number\.isFinite\(exit\)/);
    /* Çeviri TEK otoritedir: routingService kendi tablosunu YENİDEN kurmamalı. */
    expect(rs, 'ikinci çeviri otoritesi geri gelmiş')
      .not.toMatch(/if \(mod\s+=== 'sharp right'\)/);
  });

  it('🔒 ÖLÜ localhost katmanı her rotada denenmez', () => {
    const off = read('src/platform/offlineRoutingService.ts');
    expect(off, 'yerel daemon tek-yoklama kapısı kaldırılmış')
      .toContain('shouldProbeLocalDaemon');
    expect(off, '3 sn timeout geri gelmiş')
      .not.toMatch(/LOCAL_DAEMON_TIMEOUT_MS\s*=\s*3_000/);
    expect(off).toContain('LOCAL_PROBE_TIMEOUT_MS');
  });

  /* KİLİT TAŞINDI (NAVIGATION_DELIVERY_CORE_P0): sesli yönlendirme
     `NavigationHUD`ten `voiceGuidanceRuntime`e alındı — görünüm kapanınca
     anonslar susuyordu. Kilit KALDIRILMADI, yeni sahibine taşındı. */
  it('🔒 SES: rota değişince kademeler sıfırlanır (yeni rota sessiz kalmaz)', () => {
    const rt = read('src/platform/navigation/voiceGuidanceRuntime.ts');
    // Tekrar koruması rota kimliğini (oturum:revizyon) izler ve kuyruğu temizler.
    expect(rt).toMatch(/routeKey/);
    expect(rt).toContain('_spoken = new Map()');
    // Mesafe bilinmiyorken konuşulmaz — karar saf modelde.
    const vm = read('src/platform/navigation/core/voiceGuidanceModel.ts');
    expect(vm).toMatch(/distanceSource === 'UNKNOWN'\) return null;/);
  });

  it('🔒 SES: sahiplik görünümde DEĞİL (kapanınca susmaz)', () => {
    const hud = read('src/components/map/NavigationHUD.tsx');
    expect(hud).not.toContain('_spokenRef');
    expect(hud).not.toContain('metre sonra');
    const rt = read('src/platform/navigation/navigationSessionRuntime.ts');
    expect(rt).toContain('noteVoiceGuidanceTick');
  });

  it('🔒 MAP MATCH: koridor dışı UNKNOWN sayılmaz (reroute ölmesin)', () => {
    const mm = read('src/platform/navigation/core/mapMatchModel.ts');
    /* Regresyon riski: CPU koruma filtresi tüm adayları eleyince "aday yok"
       durumu UNKNOWN'a düşerse, sapma makinesi "karar verme" der ve EN
       BELİRGİN sapmada reroute HİÇ tetiklenmez. */
    expect(mm).toContain('nearestIdx');
    expect(mm).toMatch(/state: 'OFF_NETWORK'/);
  });

  it('🔒 SAF KATMAN: çekirdek modeller I/O ve saat OKUMAZ', () => {
    for (const f of [
      'src/platform/navigation/core/mapMatchModel.ts',
      'src/platform/navigation/core/offRouteModel.ts',
      'src/platform/navigation/core/routeValidationModel.ts',
      'src/platform/navigation/core/maneuverIndexModel.ts',
      'src/platform/navigation/core/geo.ts',
    ]) {
      const src = read(f);
      /* ÇAĞRI kalıbı aranır (parantezli) — dosya başlıklarındaki
         "`Date.now` YOK" gibi SÖZLERİ yakalamamak için. */
      expect(src, `${f} Date.now() okuyor — saflık ihlali`).not.toContain('Date.now(');
      expect(src, `${f} performance.now() okuyor — saflık ihlali`).not.toContain('performance.now(');
      expect(src, `${f} timer kuruyor`).not.toContain('setInterval(');
      expect(src, `${f} timer kuruyor`).not.toContain('setTimeout(');
      expect(src, `${f} React import ediyor`).not.toMatch(/from 'react'/);
      expect(src, `${f} ağa çıkıyor`).not.toContain('fetch(');
    }
  });

  it('🔒 SAF KATMAN (NAV v3 F0): contracts/** saflığı — tüm dosyalar taranır', () => {
    /* CAROS-NAV-ARCH-SPEC-3.0 §F0: kanonik sözleşme paketi. Ayrıntılı davranış
       kilitleri navV3ContractsF0.test.ts'te; burada REGRESYON KASASINA bağlı
       kalması için dosya-tabanlı saflık taraması. Yeni dosya eklendikçe
       otomatik kapsanır (elle liste yok → "kör guard" riski yok). */
    const dir = 'src/platform/navigation/contracts';
    const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.ts'));
    expect(files.length, 'contracts paketi boş görünüyor — guard bağı kopmuş').toBeGreaterThanOrEqual(8);
    for (const name of files) {
      const src = stripSrc(read(`${dir}/${name}`));
      expect(src, `${name}: Date.now()`).not.toContain('Date.now(');
      expect(src, `${name}: performance.now()`).not.toContain('performance.now(');
      expect(src, `${name}: setInterval`).not.toContain('setInterval(');
      expect(src, `${name}: setTimeout`).not.toContain('setTimeout(');
      expect(src, `${name}: React importu`).not.toMatch(/from ['"]react['"]/);
      expect(src, `${name}: fetch()`).not.toContain('fetch(');
      expect(src, `${name}: node:fs`).not.toContain('node:fs');
    }
  });

  it('🔒 NAV v3 F0: kanonik otoriteler TEK dosyada (ikinci ufuk/konum/rota/ETA authority yok)', () => {
    const dir = 'src/platform/navigation/contracts';
    const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.ts'));
    const once = (decl: string) => {
      const hits = files.filter((n) => read(`${dir}/${n}`).includes(decl)).length;
      expect(hits, `${decl} → ${hits} tanım (tam 1 olmalı)`).toBe(1);
    };
    once('export interface Evidenced<');
    once('export type NavDegradation');
    once('export const NAV_DEGRADATION_SUPPRESSION');
    once('export interface EdgeId');
    once('export const NAV_LAYER_DEPENDENCY_LAW');
    once('export interface RealtimeEgoPose');
    once('export interface MatchedRoadPose');
  });

  it('🔒 NAV v3 F1: map/store/** timer · abonelik · React · saat SAHİBİ DEĞİL', () => {
    /* L1 MapStore salt-okunur bir cephedir: kendi tik-wheel'ini kurmaz,
       kaynaklara abone olmaz, React'e bağlanmaz. Klasör taraması — yeni dosya
       otomatik kapsanır (elle liste = kör guard riski). */
    const dir = 'src/platform/navigation/map/store';
    const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.ts'));
    expect(files.length, 'map/store paketi boş görünüyor — guard bağı kopmuş').toBeGreaterThanOrEqual(5);
    for (const name of files) {
      const src = stripSrc(read(`${dir}/${name}`));
      expect(src, `${name}: setInterval`).not.toContain('setInterval(');
      expect(src, `${name}: setTimeout`).not.toContain('setTimeout(');
      expect(src, `${name}: scheduleTask`).not.toContain('scheduleTask');
      expect(src, `${name}: abonelik`).not.toContain('.subscribe(');
      expect(src, `${name}: addEventListener`).not.toContain('addEventListener(');
      expect(src, `${name}: React importu`).not.toMatch(/from ['"]react['"]/);
      expect(src, `${name}: Date.now()`).not.toContain('Date.now(');
      expect(src, `${name}: performance.now()`).not.toContain('performance.now(');
      expect(src, `${name}: ağ çağrısı`).not.toContain('fetch(');
    }
  });

  it('🔒 NAV v3 F1: Web Mercator karo formülü src\'de TEK dosyada', () => {
    /* ÖLÇÜLMÜŞ KUSUR (2026-09-03): aynı slippy formülü mapTileProbe ·
       CorridorSyncEngine · offlineTileDownloader içinde ÜÇ KEZ yazılmıştı ve
       davranışları AYNI DEĞİLDİ (biri kırpıyor, biri `1 << z` ile z≥31'de
       negatif üretiyordu). Tek kaynak: map/store/tileGrid.ts. */
    const hits: string[] = [];
    const walk = (rel: string): void => {
      for (const e of readdirSync(resolve(root, rel), { withFileTypes: true })) {
        const p = join(rel, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (read(p).includes('Math.log(Math.tan(')) hits.push(p.replace(/\\/g, '/'));
      }
    };
    walk('src');
    expect(hits, `slippy formülü ${hits.length} dosyada — tek kaynak olmalı`)
      .toEqual(['src/platform/navigation/map/store/tileGrid.ts']);
  });

  it('🔒 NAV v3 F1: TEK L1 harita cephesi (ikinci map truth authority yok)', () => {
    const dir = 'src/platform/navigation/map/store';
    const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.ts'));
    for (const decl of [
      'export function createMapStore',
      'export interface MapStore',
      'export interface MapDataPorts',
    ]) {
      const hits = files.filter((n) => read(`${dir}/${n}`).includes(decl)).length;
      expect(hits, `${decl} → ${hits} tanım (tam 1 olmalı)`).toBe(1);
    }
  });

  /* ── NAV v3 · F2 — L2 EGO / LOCALIZATION ─────────────────────────────── */

  const _f2Dirs = [
    'src/platform/navigation/ego',
    'src/platform/navigation/matching',
    'src/platform/navigation/time',
  ];
  const _f2Files = (): string[] => {
    const out: string[] = [];
    for (const d of _f2Dirs) {
      for (const f of readdirSync(resolve(root, d))) if (f.endsWith('.ts')) out.push(`${d}/${f}`);
    }
    return out;
  };

  it('🔒 NAV v3 F2: L2 timer/abonelik/React/duvar-saati SAHİBİ DEĞİL', () => {
    const files = _f2Files();
    expect(files.length, 'L2 paketi boş görünüyor — guard bağı kopmuş').toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const src = stripSrc(read(f));
      expect(src, `${f}: setInterval`).not.toContain('setInterval(');
      expect(src, `${f}: setTimeout`).not.toContain('setTimeout(');
      expect(src, `${f}: scheduleTask`).not.toContain('scheduleTask');
      expect(src, `${f}: new Worker`).not.toContain('new Worker');
      expect(src, `${f}: addEventListener`).not.toContain('addEventListener(');
      expect(src, `${f}: React importu`).not.toMatch(/from ['"]react['"]/);
      /* Duvar saati navigasyon tazeliğinde OTORİTE OLAMAZ (F0 ADR-N09). */
      expect(src, `${f}: Date.now()`).not.toContain('Date.now(');
    }
  });

  it('🔒 NAV v3 F2: L2 ham GPS/harita sağlayıcısını SAHİPLENEMEZ', () => {
    for (const f of _f2Files()) {
      const src = stripSrc(read(f));
      for (const bad of [
        'navigator.geolocation', 'watchPosition', 'getCurrentPosition', '@capacitor',
        'deviceorientation', 'devicemotion', 'onGPSLocation', 'startGPSTracking',
        'routing-graph', 'NavigationCompute.worker', 'mapSourceManager', 'mapTileProbe',
        'overpass', 'maplibre-gl',
      ]) {
        expect(src, `${f}: yasak ham kaynak "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('🔒 NAV v3 F2: DR tavanı 90 saniyeyi AŞAMAZ', () => {
    const src = read('src/platform/navigation/ego/egoModeModel.ts');
    const m = /DR_TOTAL_MAX_MS\s*=\s*([0-9_]+)/.exec(src);
    expect(m, 'DR_TOTAL_MAX_MS bulunamadı — kilit bağı kopmuş').not.toBeNull();
    expect(Number((m as RegExpExecArray)[1].replace(/_/g, ''))).toBeLessThanOrEqual(90_000);
  });

  it('🔒 NAV v3 F2: TEK localization cephesi (ikinci ego/match authority yok)', () => {
    const files = _f2Files();
    for (const decl of [
      'export function createEgoAuthority',
      'export interface EgoAuthority',
      'export interface EgoSensorPort',
      'export interface RoadCandidateSource',
    ]) {
      const hits = files.filter((f) => read(f).includes(decl)).length;
      expect(hits, `${decl} → ${hits} tanım (tam 1 olmalı)`).toBe(1);
    }
  });

  /* ── NAV v3 · F3 — L3 CEH / ELECTRONIC HORIZON ────────────────────────
   * Ayrıntılı kilitler `navV3HorizonF3.test.ts`tedir; buradakiler kasaya
   * bağlı OLMAZSA OLMAZLARDIR: ikinci abonelik · ters katman bağımlılığı ·
   * duvar saati · niyetin fiziksel gerçek sayılması. */

  const _f3Dir = 'src/platform/navigation/horizon';
  const _f3Files = (): string[] =>
    readdirSync(resolve(root, _f3Dir)).filter((f) => f.endsWith('.ts')).map((f) => `${_f3Dir}/${f}`);

  it('🔒 NAV v3 F3: L3 timer/abonelik/React/duvar-saati SAHİBİ DEĞİL', () => {
    const files = _f3Files();
    expect(files.length, 'L3 paketi boş görünüyor — guard bağı kopmuş').toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const src = stripSrc(read(f));
      expect(src, `${f}: setInterval`).not.toContain('setInterval(');
      expect(src, `${f}: setTimeout`).not.toContain('setTimeout(');
      expect(src, `${f}: scheduleTask`).not.toContain('scheduleTask');
      expect(src, `${f}: addEventListener`).not.toContain('addEventListener(');
      expect(src, `${f}: React importu`).not.toMatch(/from ['"]react['"]/);
      /* Bayat ufuk taze görünmesin: tazelik YALNIZ monotonik saatten. */
      expect(src, `${f}: Date.now()`).not.toContain('Date.now(');
      expect(src, `${f}: new Date()`).not.toContain('new Date(');
    }
  });

  it('🔒 NAV v3 F3: L3 ham kaynak ve L4 modülü import EDEMEZ (yasa yönlüdür)', () => {
    for (const f of _f3Files()) {
      const src = stripSrc(read(f));
      for (const bad of [
        'gpsService', 'routingService', 'navigationService', 'onGPSLocation',
        'routing-graph', 'NavigationCompute.worker', 'maplibre-gl', 'overpass',
        'devicemotion', 'subscribeMotion',
      ]) {
        expect(src, `${f}: yasak bağımlılık "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('🔒 NAV v3 F3: navigasyon ağacında İKİNCİ GPS/jiro aboneliği YOK', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        const next = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...walk(next));
        else if (e.name.endsWith('.ts')) out.push(next);
      }
      return out;
    };
    const navFiles = walk('src/platform/navigation');
    const gps = navFiles.filter((f) => stripSrc(read(f)).includes('onGPSLocation('));
    expect(gps, 'ikinci GPS aboneliği').toEqual(['src/platform/navigation/navigationSessionRuntime.ts']);
    const motion = navFiles.filter((f) => stripSrc(read(f)).includes('subscribeMotion('));
    expect(motion, 'ikinci jiro aboneliği').toEqual(['src/platform/navigation/navOrientationFeed.ts']);
  });

  it('🔒 NAV v3 F3: oturum ego/ufuk kaynaklarını ALIR ve BIRAKIR (sensör sızıntısı yok)', () => {
    const rt = stripSrc(read('src/platform/navigation/navigationSessionRuntime.ts'));
    expect(rt, 'oturum başlarken kaynak alınmıyor').toContain('acquireEgoHorizonSession()');
    expect(rt, 'oturum biterken kaynak bırakılmıyor').toContain('releaseEgoHorizonSession()');
    expect(rt, 'ego/ufuk tik bağı kopmuş').toContain('tickEgoHorizon()');
  });

  it('🔒 NAV v3 F3: TEK ufuk cephesi (ikinci "önümde ne var" authority yok)', () => {
    const files = _f3Files();
    for (const decl of [
      'export function createCehAuthority',
      'export interface CehAuthority',
      'export function buildHorizon',
      'export interface HorizonAttributePorts',
    ]) {
      const hits = files.filter((f) => read(f).includes(decl)).length;
      expect(hits, `${decl} → ${hits} tanım (tam 1 olmalı)`).toBe(1);
    }
  });

  /* ── NAV v3 · F4 — RTG2 OKUYUCU + TOPOLOJİ ───────────────────────────── */

  it('🔒 NAV v3 F4: `RTG2` ayrıştırıcısı TEK tanımlı (ikinci parser yok)', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        if (e.name === '__tests__') continue;
        const next = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...walk(next));
        else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(next);
      }
      return out;
    };
    const hits = walk('src').filter((f) => read(f).includes('export function parseRoutingGraph'));
    expect(hits, 'ikinci RTG2 parser').toEqual(
      ['src/platform/navigation/map/graph/rtg2Reader.ts']);
  });

  it('🔒 NAV v3 F4: worker binary ayrıştırma SAHİBİ DEĞİL (A* sahibi KALDI)', () => {
    const w = stripSrc(read('src/platform/navigation/NavigationCompute.worker.ts'));
    /* Graf baytlarını okuyan tek yer kanonik okuyucudur. */
    expect(w, 'worker hâlâ binary okuyor').not.toContain('getFloat32');
    expect(w, 'worker kanonik okuyucuyu kullanmıyor').toContain('parseRoutingGraph(');
    /* Rota YÜRÜTME worker'da kalmalı — taşınırsa off-main-thread garantisi düşer. */
    expect(w, 'A* worker\'dan çıkmış').toContain('function _aStar');
    expect(w, 'sezgisel ağırlık değişmiş').toContain('HEURISTIC_WEIGHT = 1.2');
  });

  it('🔒 RTG3 via-way: dönüş kısıtı otomatı TEK otoritededir', () => {
    /* NEDEN: via-way kısıtı tek kavşakla yanıtlanamaz; kararı `viaWayStep`
       verir. Otomatın ikinci bir kopyası, aynı kısıtın iki farklı yorumu
       (biri fazla bloklayan, biri yasak manevraya izin veren) demektir. */
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        if (e.name === '__tests__') continue;
        const next = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...walk(next));
        else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(next);
      }
      return out;
    };
    const files = walk('src');
    expect(files.filter((f) => read(f).includes('export function viaWayStep')),
      'ikinci via-way otomatı').toEqual(['src/platform/navigation/map/graph/rtg2Reader.ts']);
    expect(files.filter((f) => read(f).includes('export function buildViaWayIndex')),
      'ikinci via-way indeks kurucusu').toEqual(['src/platform/navigation/map/graph/rtg2Reader.ts']);
    /* Yuva/zincir iç yapısına okuyucu DIŞINDA dokunan olmamalı. */
    const outsiders = files.filter((f) => f !== 'src/platform/navigation/map/graph/rtg2Reader.ts'
      && stripSrc(read(f)).includes('slotsByEdge'));
    expect(outsiders, 'via-way iç yapısı okuyucu dışına sızdı').toEqual([]);
  });

  it('🔒 RTG3 via-way: kanonik A* durumu maskeyi TAŞIR, geçmişi DEĞİL', () => {
    const w = stripSrc(read('src/platform/navigation/NavigationCompute.worker.ts'));
    /* Sınırsız rota geçmişi arama uzayını patlatır; durum bounded maskedir. */
    expect(w, 'via-way maskesi A* durumunda değil')
      .toContain('viaWayStep(view, previousEdge, viaWayMask, cur, ordinal)');
    expect(w, 'yasak geçiş reddedilmiyor').toContain('if (nextMask < 0) continue;');
    /* Maske 0 iken durum anahtarı ESKİSİYLE AYNI kalmalı — via-way kaydı
       olmayan grafta davranış paritesi budur. */
    expect(w, 'maske 0 iken anahtar değişmiş')
      .toContain("nextMask === 0 ? `${to}:${ordinal}` : `${to}:${ordinal}:${nextMask}`");
    expect(w.match(/function routeRtg3EdgeState\(/g), 'ikinci RTG3 router').toHaveLength(1);
  });

  it('🔒 RTG3: via-node sorgusu via-way kayıtlarını YORUMLAMAZ', () => {
    const r = stripSrc(read('src/platform/navigation/map/graph/rtg2Reader.ts'));
    /* `turnIsAllowed` bir via-way halkasını via-node kısıtı sanarsa meşru
       dönüşleri bloklar (aşırı kısıt = sessiz rota bozulması). */
    expect(r, 'turnIsAllowed via-way kaydını atlamıyor')
      .toContain('if ((view.restrictionType[i] & RTG3_VIA_WAY_FLAG) !== 0) continue;');
  });

  it('🔒 RTG3 ülke ölçeği: builder bütçeyi patlatan üç deseni GERİ GETİREMEZ', () => {
    /* Üçü de Türkiye build'inde ÖLÇÜLDÜ ve fail-closed düşüşe yol açtı;
       hepsi Mersin ölçeğinde GÖRÜNMÜYORDU. Kilit, "küçük veride çalışıyor"
       yanılgısının geri gelmesini engeller. */
    const b = read('scripts/build-pbf-streaming-rtg3.mjs');

    /* (1) osmium çıktısı BORUYA yazılırsa tüketici yavaşladıkça çocuk süreç
       şişer (ölçüldü: 546 MiB → 512 MiB ağaç bütçesi düşer). Dosyaya düşür. */
    expect(b, 'osmium çıktısı boruya dönmüş').not.toContain("'-o','-'");
    expect(b, 'spill dosyası kullanılmıyor').toContain("'-o',spill,'--overwrite'");
    expect(b, 'spill okunmuyor').toContain('createReadStream(spill');

    /* (2) Kaynak SHA'si bölge başına hesaplanırsa 645 MB dosya yüzlerce kez
       RAM'e okunur. TEK KEZ ve AKIŞLA hesaplanmalı. */
    expect(b, 'readFileSync ile kaynak hash').not.toContain("update(readFileSync(p)).digest");
    expect(b, 'akışlı hash yok').toContain('async function shaStream');
    expect(b.match(/await shaStream\(SOURCE\)/g), 'kaynak hash birden fazla kez').toHaveLength(1);

    /* (3) 50 ms'lik telemetri örnekleri diziye yazılırsa ~3 saatlik build'de
       yüz binlerce kayıt olur (bellek + dev JSON + Math.max yığın taşması). */
    expect(b, 'periodic örnek kütüğe yazılıyor').toContain("if(stage!=='periodic')telemetry.push");
    expect(b, 'zirve Math.max(...dizi) ile hesaplanıyor').not.toContain('Math.max(...telemetry');
  });

  it('🔒 RTG3 build: yarım koşu geçerli dataset SAYILMAZ', () => {
    const b = read('scripts/build-pbf-streaming-rtg3.mjs');
    /* Manifest ve tamamlanma işareti koşu BAŞINDA silinir, yalnız tam
       başarıda yazılır → yarım region kümesi tüketiciye yayınlanmaz. */
    expect(b).toContain("rmSync(COMPLETE_MARKER,{force:true})");
    expect(b).toContain("rmSync(resolve(RUN,'turkey-graph-manifest.json'),{force:true})");
    const markerWrite = b.indexOf('writeFileSync(COMPLETE_MARKER');
    const manifestWrite = b.indexOf("writeFileSync(resolve(RUN,'turkey-graph-manifest.json')");
    expect(markerWrite, 'tamamlanma işareti yazılmıyor').toBeGreaterThan(0);
    expect(markerWrite, 'işaret manifestten ÖNCE yazılıyor').toBeGreaterThan(manifestWrite);
    /* V8 old-space tavanı bütçeyle uyumlu olmalı; yoksa GC ertelenir ve RSS
       kademeli tırmanır (ölçüldü: 153 bölge sonunda 518 MiB). */
    expect(b).toContain("check:'v8-heap-limit'");
  });

  it('🔒 RTG3: bayt YAZMA otoritesi tek dosyadadır', () => {
    /* Okuma tarafı tek otoriteyken (rtg2Reader) yazma tarafında iki kopya
       tutmak, aynı formatın iki gerçeği demektir. */
    const codec = read('scripts/rtg3Codec.mjs');
    expect(codec).toContain('export function serializeRtg3');
    for (const builder of ['scripts/build-pbf-streaming-rtg3.mjs', 'scripts/build-rtg3-bounded.mjs']) {
      const src = read(builder);
      expect(src, `${builder}: ortak codec kullanılmıyor`).toContain("from './rtg3Codec.mjs'");
      expect(src.includes('writeBigUInt64LE'), `${builder}: ikinci RTG3 yazarı`).toBe(false);
    }
  });

  it('🔒 NAV v3 F4: L2/L3 ham graf belleğini/okuyucusunu GÖREMEZ', () => {
    const dirs = [
      'src/platform/navigation/ego',
      'src/platform/navigation/matching',
      'src/platform/navigation/horizon',
    ];
    for (const d of dirs) {
      for (const f of readdirSync(resolve(root, d))) {
        if (!f.endsWith('.ts')) continue;
        const src = stripSrc(read(`${d}/${f}`));
        for (const bad of [
          'rtg2Reader', 'graphResidencyRuntime', 'edgeSpatialIndex', 'graphAdjacency',
          'ArrayBuffer', 'DataView', 'Uint32Array', 'Float32Array', 'routing-graph',
          'edgeOrdinal', 'toLegacyEdgeRef',
        ]) {
          expect(src, `${d}/${f}: yasak graf erişimi "${bad}"`).not.toContain(bad);
        }
      }
    }
  });

  it('🔒 NAV v3 F4: MapStore cephesi fetch/timer/native SAHİBİ DEĞİL', () => {
    for (const f of [
      'src/platform/navigation/map/store/mapStore.ts',
      'src/platform/navigation/map/store/mapStoreSources.ts',
    ]) {
      const src = stripSrc(read(f));
      for (const bad of ['fetch(', 'setInterval(', 'setTimeout(', 'new Worker', 'addEventListener(']) {
        expect(src, `${f}: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('🔒 NAV v3 F4: BOZUK/kısa graf ASLA başarı gibi sunulamaz', async () => {
    const { parseRoutingGraph } = await import('../platform/navigation/map/graph/rtg2Reader');
    /* Başlıksız çöp + kesilmiş tablo: ikisi de fail-closed. */
    expect(parseRoutingGraph(new ArrayBuffer(4)).view).toBeNull();
    expect(parseRoutingGraph(new ArrayBuffer(64)).view).toBeNull();
    expect(parseRoutingGraph(null).outcome).toBe('EMPTY');
  });

  it('🔒 NAV v3 F4: binary FORMAT ve üretici DEĞİŞMEDİ', async () => {
    const r = await import('../platform/navigation/map/graph/rtg2Reader');
    expect(r.RTG2_MAGIC).toBe(0x32475452);
    expect(r.RTG_NODE_STRIDE).toBe(16);
    expect(r.RTG2_EDGE_STRIDE).toBe(13);
    expect(r.RTG1_EDGE_STRIDE).toBe(12);
  });

  it('🔒 NAV v3 F3: AKTİF ROTA fiziksel gerçek SAYILMAZ (niyet ≠ konum)', async () => {
    const { buildHorizon } = await import('../platform/navigation/horizon/horizonModel');
    const { UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS } =
      await import('../platform/navigation/horizon/horizonAttributePorts');
    const { asMonotonic } = await import('../platform/navigation/contracts/navMonotonicTime');
    const { derivedNav, observedNav } = await import('../platform/navigation/contracts/navEvidence');
    const now = asMonotonic(1_000);
    const ev = (v: number) => derivedNav<number>(v, {
      source: 'GNSS', confidence: 0.9, observedAtMonoMs: now, freshnessBudgetMs: 5_000,
    });
    const h = buildHorizon({
      nowMonoMs: now,
      generation: 1,
      ego: {
        kind: 'REALTIME_EGO', tsMonoMs: now, lat: ev(41), lon: ev(29),
        headingDeg: ev(90),
        speedMps: observedNav<number>(20, {
          source: 'VEHICLE_BUS', confidence: 0.9, observedAtMonoMs: now, freshnessBudgetMs: 5_000,
        }),
        mode: 'GNSS', horizontalSigmaM: 4,
      },
      matched: null,
      route: {
        available: true, sessionId: 1, routeRevision: 1, observedAtMonoMs: now,
        vehicleAlongRemainingM: 1_000, totalDistanceM: 2_000, maneuvers: [],
        geometry: [[29, 41], [29.01, 41]], onCorridor: true, conflictThresholdM: 55,
      },
      mapAvailable: true,
      attributes: UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS,
      egoFreshnessBudgetMs: 5_000,
      routeConflictThresholdM: 55,
    });
    /* Koridorda olmak ve rota bulunmak fiziksel doğrulama DEĞİLDİR. */
    expect(h.paths[0].physicallyConfirmed).toBe(false);
    expect(h.paths[0].provenance).toBe('ROUTE_INTENT');
    expect(h.state).not.toBe('HORIZON_AVAILABLE');
  });

  /* ── NAV v3 · F5 — GÖLGE OTORİTE + CUTOVER KAPISI ─────────────────────
   * Bu beş kilit F5'in TEK vaadini korur: üretim kararı DEĞİŞMEDEN gölge
   * ölçüm yapılır. Bir gün biri "kapıyı bir süreliğine açalım" derse veya
   * gölge yoluna bir anons eklenirse, kilit ONDAN ÖNCE düşer. */

  it('🔒 NAV v3 F5: CUTOVER kapısı VARSAYILAN KAPALI (saha kanıtı olmadan açılamaz)', async () => {
    const g = await import('../platform/navigation/shadow/cehCutoverGate');
    expect(g.CEH_CUTOVER_DEFAULT_OPEN, 'cutover varsayılanı açılmış').toBe(false);
    /* Tüm şartlar KANITLANSA bile bu fazda kapı açılmaz. */
    const v = g.evaluateCehCutoverGate({
      f4FieldValidationPassed: true,
      comparableSamples: g.CEH_CUTOVER_MIN_SHADOW_SAMPLES,
      divergenceRatio: 0,
      ambiguityFailClosedProven: true,
      regressionGuardsPassed: true,
      attributePortsBound: true,
    });
    expect(v.unmet).toEqual([]);
    expect(v.open, 'kapı bu fazda açılamaz').toBe(false);
    expect(g.isCehProductionAuthority(v), 'CEH üretim otoritesi olmuş').toBe(false);
    /* Ölçülmemiş şart kapıyı AÇMAZ (üç değerli, fail-closed). */
    expect(g.evaluateCehCutoverGate(null).unmet.length)
      .toBe(g.CEH_CUTOVER_CONDITIONS.length);
  });

  it('🔒 NAV v3 F5: gölge katmanı SES/UYARI/DURUM YAZIMI üretemez', () => {
    const dir = 'src/platform/navigation/shadow';
    const files = readdirSync(resolve(root, dir)).filter((f) => f.endsWith('.ts'));
    expect(files.length, 'gölge katmanı kaybolmuş').toBeGreaterThan(0);
    for (const f of files) {
      const src = stripSrc(read(`${dir}/${f}`));
      for (const bad of [
        'ttsService', 'speakNavigation', 'notificationService', 'setState(',
        'useUnifiedVehicleStore', 'useRouteStore', 'localStorage', 'safeStorage',
        'setInterval(', 'setTimeout(', 'onGPSLocation(', 'scheduleTask',
        'Date.now(', 'runGuardian(', 'rankGuardianAlerts',
      ]) {
        expect(src, `${dir}/${f}: yasak "${bad}"`).not.toContain(bad);
      }
    }
  });

  it('🔒 NAV v3 F5: GUARDIAN üretim otoritesi legacy zincirde KALDI', () => {
    const rt = stripSrc(read('src/platform/navigation/guardian/runtime/guardianRuntime.ts'));
    for (const need of [
      'buildGuardianRawPlatformData', 'buildGuardianRegistryInput',
      'buildGuardianRuleResults', 'runGuardian(', 'createEnforcementMapSource',
    ]) {
      expect(rt, `Guardian üretim zinciri bozulmuş: ${need}`).toContain(need);
    }
    /* Guardian ağacı gölgeyi GÖRMEZ (ters bağımlılık = ikinci otorite riski). */
    const walkG = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        const next = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...walkG(next));
        else if (e.name.endsWith('.ts')) out.push(next);
      }
      return out;
    };
    for (const f of walkG('src/platform/navigation/guardian')) {
      const src = stripSrc(read(f));
      expect(src, `${f}: Guardian gölgeyi import ediyor`).not.toContain('shadow/ceh');
      expect(src, `${f}: Guardian CEH sözleşmesini import ediyor`).not.toContain('cehConsumerContract');
    }
  });

  it('🔒 NAV v3 F5: SESLİ YÖNLENDİRME sahibi ve tetikleyicisi DEĞİŞMEDİ', () => {
    const vg = stripSrc(read('src/platform/navigation/voiceGuidanceRuntime.ts'));
    expect(vg, 'ses sahipliği değişmiş').toContain("owner: 'NAV_SESSION_RUNTIME'");
    expect(vg, 'sesli yönlendirme gölgeye bağlanmış').not.toContain('cehShadow');
    expect(vg, 'sesli yönlendirme ufka bağlanmış').not.toContain('ElectronicHorizon');
  });

  it('🔒 NAV v3 F5: "ÖLÇÜLMEDİ" hiçbir yolda "YOK"a dönüştürülemez', async () => {
    const c = await import('../platform/navigation/horizon/cehConsumerContract');
    /* Ufuk yokken de, port bağlı değilken de mesafe İDDİA EDİLMEZ. */
    const noHorizon = c.readCehAhead(null, 'ENFORCEMENT',
      { validityBudgetMs: 5_000, domainMeasured: true });
    expect(noHorizon.outcome).toBe('HORIZON_UNAVAILABLE');
    expect(noHorizon.distanceM).toBeNull();
    expect(c.cehClaimIsMeasuredAbsence(noHorizon), '"ölçülmedi" yokluk sayılmış').toBe(false);
    expect(c.cehClaimIsActionable(noHorizon)).toBe(false);
  });
});

/* ───────────────────────────────────────────────────────────────
   NAV-CORE-P0 · SAHA ÖLÇÜM KÖPRÜSÜ (dev-only)
   Gerçek araç doğrulaması için eklendi. Ürüne SIZMAMALI.
   ─────────────────────────────────────────────────────────────── */
describe('NAV-CORE-P0 saha ölçüm köprüsü kilitleri', () => {
  const bridge = read('src/platform/devtools/navFieldBridge.ts');

  it('🔒 SALT OKUNUR: hiçbir navigasyon komutu çağırmaz', () => {
    for (const forbidden of [
      'fetchRoute', 'startNavigation', 'stopNavigation', 'activateNavigation',
      'clearRoute', 'setRerouteContext', 'selectAltRoute', 'writeActiveRoute',
      'updateRouteProgress', 'speakNavigation',
    ]) {
      expect(bridge, `köprü ${forbidden} çağırıyor — ürün davranışına dokunuyor`)
        .not.toContain(forbidden);
    }
  });

  it('🔒 TIMER / POLLING / ağ YOK — örnekleme HOST tarafında yapılır', () => {
    expect(bridge).not.toContain('setInterval(');
    expect(bridge).not.toContain('setTimeout(');
    expect(bridge).not.toContain('fetch(');
    expect(bridge).not.toContain('.subscribe(');
  });

  it('🔒 DEV KAPISI: bayrak kapalıyken NO-OP ve çağrı noktası da korumalı', () => {
    expect(bridge).toContain('DEVELOPER_FEATURES_ENABLED');
    expect(bridge).toMatch(/if \(!DEVELOPER_FEATURES_ENABLED\) return;/);
    const app = read('src/App.tsx');
    // Dinamik import bayrağın ARKASINDA olmalı → satış build'inde ölü kod.
    expect(app).toMatch(/if \(!DEVELOPER_FEATURES_ENABLED\) return;\s*\n\s*void import\('\.\/platform\/devtools\/navFieldBridge'\)/);
  });

  it('🔒 KÖPRÜ ÜRÜNÜ DÜŞÜREMEZ (fail-soft)', () => {
    expect(bridge).toMatch(/catch \{ \/\* fail-soft/);
  });

  it('🔒 LAB EKRANI koordinat sözleşmesini KORUR (köprü ondan AYRI)', () => {
    /* Köprü ölçüm için ham koordinat taşır (saha doğruluğu ölçülemez aksi
       hâlde) — ama bu ASLA LAB okuma katmanına sızmamalı. */
    const labSrc = read('src/platform/devtools/navigationCoreSources.ts');
    expect(labSrc).not.toContain('navFieldBridge');
    /* Koordinat DEĞERİ taşımak yasak; VARLIK kontrolü (`!== null`) serbesttir —
       `hasSnappedPosition` tam olarak budur ve koordinatı SIZDIRMAZ. */
    expect(labSrc, 'LAB anlık görüntüsü koordinat DEĞERİ taşıyor')
      .not.toMatch(/:\s*(fix|veh|loc)\.(snappedLat|snappedLon|rawLat|rawLon|latitude|longitude)/);
    expect(labSrc, 'LAB anlık görüntüsünde koordinat alanı tanımlı')
      .not.toMatch(/readonly\s+(lat|lon|latitude|longitude|snappedLat|snappedLon)\s*:/);
    const labScreen = read('src/components/devtools/screens/NavigationCoreScreen.tsx');
    expect(labScreen).not.toContain('__CAROS_NAV_FIELD__');
  });
});

/* ── NAVIGASYON OTURUM SÜREKLİLİĞİ (2026-08-03) ──────────────────────────────
 * SAHA ARIZASI: tam ekran haritayı kapatmak navigasyonu fiilen BİTİRİYORDU.
 * Rota ilerlemesini süren GPS aboneliği `FullMapView`'ın İÇİNDEYDİ → unmount
 * ile mesafe/ETA/adım/ses/reroute/varış topluca donuyordu; rota isteği dedup'ı
 * da bileşen ref'i olduğu için yeniden açılışta AKTİF oturum için yeni istek
 * atılıp durum ACTIVE→ROUTING'e düşüyordu. Mini haritanın ise navigasyondan
 * hiç haberi yoktu. Bu kilitler sahipliğin görünüme geri kaçmasını engeller. */
describe('Tam ekranı kapatmak navigasyonu SONLANDIRMAZ', () => {
  const miniMapSrc = read('src/components/map/MiniMapWidget.tsx');
  const drawerSrc  = read('src/components/layout/DrawerPanel.tsx');

  it('🔒 tam ekran kapatma yolu oturum sonlandırmaya BAĞLANAMAZ', () => {
    // Kapatma yolu: MapHudControls X → onClose → DrawerPanel → setFullMapOpen(false).
    expect(fullMapViewSrc).toContain('onClose={onClose}');
    expect(drawerSrc).toContain('onClose={onCloseMap}');
    expect(mainLayoutSrc).toContain('onCloseMap={() => setFullMapOpen(false)}');
    // Bu iki dosya oturumu bitiren HİÇBİR fonksiyonu çağırmaz.
    for (const src of [drawerSrc, mainLayoutSrc]) {
      expect(src).not.toContain('endNavigation(');
      expect(src).not.toContain('stopNavigation(');
      expect(src).not.toContain('clearRoute(');
    }
  });

  it('🔒 FullMapView unmount rota/oturum TEMİZLEMEZ', () => {
    /* Kapanış temizliği yalnız GÖRÜNÜM kaynaklarını (harita, timer, abonelik)
       bırakabilir. Bir cleanup fonksiyonunun içinde oturum sonlandırma çağrısı
       görünürse tam ekran kapatmak yine navigasyonu öldürür. */
    for (const m of fullMapViewSrc.matchAll(/return \(\) => \{([\s\S]*?)\n {4}\};/g)) {
      const body = m[1];
      expect(body).not.toContain('endNavigation');
      expect(body).not.toContain('stopNavigation');
      expect(body).not.toContain('clearRoute(');
      expect(body).not.toContain('clearRouteGeometry');
    }
  });

  it('🔒 Navigation ilerleme motoru yalnız SystemBoot named lifecycle kaydındadır', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot).toContain("this._regNamed('NavigationSessionRuntime', startNavigationSessionRuntime());");
    expect(boot).not.toContain('this._reg(startNavigationSessionRuntime());');
    // Görünümler motoru başlatmaz/durdurmaz.
    for (const src of [fullMapViewSrc, miniMapSrc]) {
      expect(src).not.toContain('startNavigationSessionRuntime');
      expect(src).not.toContain('stopNavigationSessionRuntime');
    }
    // FullMapView'ın GPS aboneliği artık ilerleme HESAPLAMAZ (yalnız çizer).
    const gpsBlock = fullMapViewSrc.slice(
      fullMapViewSrc.indexOf('const unsub = onGPSLocation('),
      fullMapViewSrc.indexOf('// 3) Düşük frekanslı render commit'),
    );
    expect(gpsBlock.length).toBeGreaterThan(100);
    expect(gpsBlock).not.toContain('updateRouteProgress(');
    expect(gpsBlock).not.toContain('updateNavigationProgress(');
  });

  it('🔒 mini harita AYRI rota otoritesi kurmaz (tek authority)', () => {
    for (const forbidden of [
      'fetchRoute', 'writeActiveRoute', 'updateRouteProgress',
      'updateNavigationProgress', 'setNavStatus', 'activateNavigation',
    ]) {
      expect(miniMapSrc, `mini harita ${forbidden} çağırıyor — ikinci otorite`)
        .not.toContain(forbidden);
    }
    // Aktif rotayı TEK otoriteden okur.
    expect(miniMapSrc).toContain('useRouteState()');
    expect(miniMapSrc).toContain('useNavigation()');
  });

  it('🔒 rota isteği dedup\'ı bileşen ref\'ine GERİ DÖNEMEZ', () => {
    expect(fullMapViewSrc).not.toContain('lastFetchedRef');
    expect(fullMapViewSrc).toContain('claimRouteRequest(destination.id)');
    // Sahiplik oturum otoritesinde yaşar.
    expect(navigationServiceSrc).toContain('export function claimRouteRequest');
    expect(navigationServiceSrc).toContain('export function endNavigation');
  });
});

/* ── UYDURMA ETA BARI AKTİF ROTAYI ÇELİŞMEZ (saha 2026-08-03) ───────────────
 * CİHAZDA ÖLÇÜLDÜ (4L45OFZDX84X55GE): gerçek rota 2,7 km iken tema kartının
 * alt şeridi "18 km · 23 dk · 19:56" gösteriyor ve mini haritanın GERÇEK verili
 * navigasyon şeridini örtüyordu — aynı kartta iki çelişkili ETA. `useNavSummary`
 * 2026-08-02'de üst chip'i gerçek kaynağa bağlamıştı; ALT BAR gözden kaçmıştı. */
describe('Uydurma ETA barı aktif rotayla çelişemez', () => {
  const LAYOUTS = ['ProLayout', 'TeslaLayout', 'ExpeditionLayout'];

  /* KİLİT GÜNCELLENDİ (saha 2026-08-05 · #431) — KALDIRILMADI.
   * Eski kilit "sabit şerit `!navSummary` kapısının arkasında olmalı" diyordu:
   * yani rota YOKKEN uydurma değerleri göstermeye izin veriyordu. Sahada tam da
   * bu delik gözlendi — rota iptal edilir edilmez şerit geri geldi (`shot_18`).
   * Doğru davranış artık daha güçlü: şerit HİÇBİR durumda render edilmez.
   * Kilit o yüzden zayıflatılmadı, yeni (daha katı) gerçeğe taşındı. */
  it('🔒 sabit "23 dk / 18 km" şeridi HİÇBİR durumda RENDER EDİLMEZ', () => {
    for (const name of LAYOUTS) {
      const src = read(`src/components/themes/${name}.tsx`);
      // JSX metin düğümünü ara (`>23 dk<`) — açıklama yorumları yakalanmasın.
      expect(src.indexOf('>23 dk<'), `${name}: uydurma ETA şeridi geri gelmiş`).toBe(-1);
      expect(src.indexOf('>18 km<'), `${name}: uydurma mesafe şeridi geri gelmiş`).toBe(-1);
      // Kapı deseni de kalmamalı: "rota yokken göster" mantığı bu şerit için ölüdür.
      const jsx = src.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(jsx.includes('19:56'), `${name}: uydurma varış saati geri gelmiş`).toBe(false);
    }
  });

  it('🔒 rota özeti TEK kaynaktan gelir — sabit hedef/mesafe geri gelmesin', () => {
    const hook = read('src/hooks/useNavSummary.ts');
    expect(hook).toContain('useNavigation');
    expect(hook).toContain('if (!isNavigating || !destination) return null;');
    for (const name of LAYOUTS) {
      const src = read(`src/components/themes/${name}.tsx`);
      expect(src).toContain('useNavSummary()');
      // Eskiden buradaydı: sabit "Sahil Yolu Cd." / "2.4 km"
      expect(src).not.toContain('Sahil Yolu');
    }
  });
});

/* ── NAVİGASYONDAYKEN ANA EKRANA DÖNÜŞ YOLU KAPANAMAZ (saha 2026-08-04) ──────
 * CİHAZDA ÖLÇÜLDÜ: navigasyon aktifken tam ekranı kapatan HİÇBİR düğme yoktu
 * (`KAPAT` `!isNavigating` ile gizli). Geriye donanım geri tuşu ve kırmızı
 * SONLANDIR kalıyordu. Uygulama bir LAUNCHER; hedef head unit'lerde (K24/T507)
 * donanım geri tuşu çoğu zaman YOK → kullanıcı ana ekrana dönmek için
 * navigasyonu BİTİRMEK zorunda kalıyordu; yani bu görevin kapattığı arızanın ta
 * kendisi UI tarafında hâlâ açıktı. */
describe('Navigasyon aktifken ana ekrana dönüş yolu vardır', () => {
  const hud = read('src/components/map/MapHudControls.tsx');

  it('🔒 navigasyondayken görünümü kapatan AYRI bir düğme render edilir', () => {
    expect(hud).toContain('{isNavigating && (');
    // Düğme yalnız görünümü kapatır — sonlandırma fonksiyonlarına DOKUNMAZ.
    const blk = hud.slice(hud.indexOf('{isNavigating && ('), hud.indexOf("{!isNavigating && ("));
    expect(blk).toContain('onClick={onClose}');
    for (const forbidden of ['endNavigation', 'stopNavigation', 'clearRoute', 'onCancel']) {
      expect(blk, `ana ekran düğmesi ${forbidden} çağırıyor — oturumu bitirir`).not.toContain(forbidden);
    }
  });

  it('🔒 dönüş düğmesi SONLANDIR ile karıştırılamaz (renk + etiket ayrı)', () => {
    const blk = hud.slice(hud.indexOf('{isNavigating && ('), hud.indexOf("{!isNavigating && ("));
    expect(blk).toContain('ANA EKRAN');
    // Kırmızı (tehlike) paleti sonlandırmaya ayrılmıştır — dönüş düğmesi nötr olmalı.
    expect(blk).not.toContain('239,68,68');
    expect(blk).not.toMatch(/text-red-|#f87171/);
  });
});

/* ── OBD 0xFF SENTİNEL'İ SÜRÜCÜYE HIZ OLARAK GÖSTERİLEMEZ (saha 2026-08-05 · #399) ──
 * CİHAZDA ÖLÇÜLDÜ: araç gerçekte ~94 km/h giderken ekranda "Hız 255 km/h".
 * 255 = 0xFF, SAE J1979'da "veri yok" için ECU'nun döndürdüğü tam-ölçek bayt.
 * Fiziksel sınır [0,300] tek başına yetmiyordu — sentinel sınırın İÇİNDE kalıyordu.
 * Sürücüye yanlış hız göstermek doğrudan bir GÜVENLİK kusurudur. */
describe('OBD sentinel eleme (#399)', () => {
  it('🔒 speed = 255 (0xFF) alanı kabul EDİLMEZ', async () => {
    const { sanitizeNativeOBDPacket } = await import('../platform/obdSanitizer');
    const { patch } = sanitizeNativeOBDPacket({ speed: 255 }, null);
    expect(patch?.speed).toBeUndefined();
  });

  it('🔒 sentinel yalnız KENDİ alanını düşürür — paketi düşürmez (fail-soft)', async () => {
    const { sanitizeNativeOBDPacket } = await import('../platform/obdSanitizer');
    const { patch } = sanitizeNativeOBDPacket({ speed: 255, rpm: 2100, engineTemp: 92 }, null);
    expect(patch).not.toBeNull();
    expect(patch?.speed).toBeUndefined();
    expect(patch?.rpm).toBe(2100);          // aynı turdaki sağlam alanlar korunur
    expect(patch?.engineTemp).toBe(92);
  });

  it('🔒 254 ve 256 sentinel DEĞİLDİR — 254 geçer, 256 sınır dışı', async () => {
    const { sanitizeNativeOBDPacket } = await import('../platform/obdSanitizer');
    expect(sanitizeNativeOBDPacket({ speed: 254 }, null).patch?.speed).toBe(254);
    expect(sanitizeNativeOBDPacket({ speed: 301 }, null).patch).toBeNull(); // fiziksel kapı
  });

  it('🔒 intakeTemp = 215 (0xFF) elenir; 214 gerçek okuma sayılır', async () => {
    const { sanitizeNativeOBDPacket } = await import('../platform/obdSanitizer');
    expect(sanitizeNativeOBDPacket({ intakeTemp: 215 }, null).patch).toBeNull();
    expect(sanitizeNativeOBDPacket({ intakeTemp: 214 }, null).patch?.intakeTemp).toBe(214);
  });

  it('🔒 yanlış-pozitif YASAK: dolu depo (%100) ve 255 kPa boost ELENMEZ', async () => {
    const { sanitizeNativeOBDPacket } = await import('../platform/obdSanitizer');
    // 0xFF bu iki alanda GERÇEK bir okumayla çakışır — elemek veri kaybı olurdu.
    expect(sanitizeNativeOBDPacket({ fuelLevel: 100 }, null).patch?.fuelLevel).toBe(100);
    expect(sanitizeNativeOBDPacket({ boostPressure: 255 }, null).patch?.boostPressure).toBe(255);
  });
});

/* ── EKRANDA TEK HIZ OTORİTESİ (saha 2026-08-05 · #417) ─────────────────────
 * CİHAZDA ÖLÇÜLDÜ: tek ekran görüntüsünde eş zamanlı ÜÇ farklı hız —
 * araç kartı 99 · harita rozeti 103 · UnifiedVehicleStore 104, hepsi etiketsiz.
 * KÖK: iki ayrı füzyon motoru (`UnifiedVehicleStore` + `speedFusion`) ve bir de
 * HAM GPS (`location.speed * 3.6`) aynı anda ekrana basıyordu.
 * KARAR: gösterim otoritesi `useDisplaySpeed` (UnifiedVehicleStore) — tek kaynak.
 * Motorlar silinmedi, yalnız EKRANA BASMA yetkileri alındı. */
describe('Hız gösterimi tek otoriteden gelir (#417)', () => {
  const SPEED_DISPLAYS = [
    'src/components/map/MiniMapWidget.tsx',
    'src/components/map/FullMapView.tsx',
    'src/components/map/NavigationHUD.tsx',
    'src/components/split/SplitScreen.tsx',
    'src/components/layout/NewHomeLayout.tsx',
  ];

  it('🔒 hız gösteren her bileşen useDisplaySpeed kullanır', () => {
    for (const f of SPEED_DISPLAYS) {
      expect(read(f), `${f} tek hız otoritesini kullanmıyor`).toContain('useDisplaySpeed');
    }
  });

  it('🔒 hız gösteren bileşenler İKİNCİ füzyon motorunu (speedFusion) okumaz', () => {
    for (const f of SPEED_DISPLAYS) {
      expect(read(f), `${f} ikinci hız motorunu okuyor`).not.toContain('useFusedSpeed');
    }
  });

  it('🔒 harita rozeti HAM GPS hızından türetilmez', () => {
    const overlay = read('src/components/map/MapOverlay.tsx');
    // Eskiden: speedKmh ?? (location?.speed != null ? location.speed * 3.6 : 0)
    expect(overlay).not.toMatch(/location(\?)?\.speed\s*\*\s*3\.6/);
    const full = read('src/components/map/FullMapView.tsx');
    expect(full).not.toMatch(/speedKmh=\{location(\?)?\.speed/);
  });

  it('🔒 hız bilinmiyorken SAHTE 0 değil "—" gösterilir', async () => {
    const { formatDisplaySpeed, SPEED_UNKNOWN_TEXT } = await import('../hooks/useDisplaySpeed');
    expect(formatDisplaySpeed(null)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(undefined)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(NaN)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(0)).toBe('0');        // duran araç ≠ verisi olmayan araç
    expect(formatDisplaySpeed(93.6)).toBe('94');
  });
});

/* ── AKÜ: KARAR ÜRETİLİYORSA DEĞER DE GÖSTERİLİR (saha 2026-08-05 · #427) ────
 * CİHAZDA ÖLÇÜLDÜ: konsolda `[Battery] NORMAL → WARN @ N V` (voltaj ölçüldü,
 * karar üretildi, güç tavanı kısıldı) — ama ekranda `Akü —`.
 * KÖK: karar yolu OBD `batteryVoltage` (ATRV/PID 0x42) okuyordu, gösterim ise
 * YALNIZ `canBatteryVolt` (CAN). CAN'ı olmayan araçta gösterim kalıcı `—`. */
describe('Akü voltajı tek otoriteden okunur (#427)', () => {
  const BATTERY_DISPLAYS = [
    'src/components/themes/TeslaLayout.tsx',
    'src/components/themes/ExpeditionLayout.tsx',
    'src/components/themes/HorizonLayout.tsx',
  ];

  it('🔒 akü gösteren layout CAN-ONLY okuma yapmaz, otorite hook\'unu kullanır', () => {
    for (const f of BATTERY_DISPLAYS) {
      const src = read(f);
      expect(src, `${f} akü otoritesini kullanmıyor`).toContain('useBatteryVoltage');
      expect(src, `${f} hâlâ CAN-only okuyor`).not.toContain('s.canBatteryVolt');
    }
  });

  it('🔒 WARN seviyesi ekranda görünür (kalıcı uyarı — toast kaçabilir)', () => {
    for (const f of BATTERY_DISPLAYS) {
      expect(read(f), `${f} akü uyarısını göstermiyor`).toMatch(/battery\.isWarning/);
    }
  });

  it('🔒 voltaj biçimlendirmesi sahte 0 üretmez', async () => {
    const { formatVoltage } = await import('../hooks/useBatteryVoltage');
    expect(formatVoltage(null)).toBe('—');
    expect(formatVoltage(12.42)).toBe('12.4');
  });
});

/* ── BAKIM: VERİ YOKKEN "GÜNCEL" DENEMEZ (saha 2026-08-05 · #420) ───────────
 * CİHAZDA ÖLÇÜLDÜ: "SON DEĞİŞİMDEKİ SAYAÇ" alanı BOŞ iken ekran yeşil
 * "Tüm bakımlar güncel" diyordu. Kök: `lastOilChangeKm ?? 0` varsayımı +
 * tarihi girilmemiş kalemlerin listeden tamamen gizlenmesi. */
describe('Bakım durumu kanıtsız "sağlıklı" iddia etmez (#420)', () => {
  const EMPTY = {} as never;

  it('🔒 hiç veri yokken yağ değişimi "ok" DEĞİL "unknown"', async () => {
    const { computeReminders } = await import('../platform/vehicleReminderService');
    const oil = computeReminders(EMPTY, 50_000).find((r) => r.id === 'oil_change');
    expect(oil?.urgency).toBe('unknown');
  });

  it('🔒 girilmemiş tarih kalemleri GİZLENMEZ, unknown olarak listelenir', async () => {
    const { computeReminders } = await import('../platform/vehicleReminderService');
    const items = computeReminders(EMPTY, 0);
    for (const id of ['inspection', 'insurance', 'kasko']) {
      expect(items.find((r) => r.id === id)?.urgency, `${id} gizlenmiş`).toBe('unknown');
    }
  });

  it('🔒 hepsi bilinmiyorken "hepsi güncel" İDDİA EDİLEMEZ', async () => {
    const { computeReminders, canClaimAllHealthy, getMaintenanceSummary } =
      await import('../platform/vehicleReminderService');
    expect(canClaimAllHealthy(computeReminders(EMPTY, 0))).toBe(false);
    expect(getMaintenanceSummary(EMPTY, 0)).toContain('bilinmiyor');
    expect(getMaintenanceSummary(EMPTY, 0)).not.toContain('sorun yok');
  });

  it('🔒 gerçek veri varsa ve sorun yoksa "güncel" denebilir', async () => {
    const { computeReminders, canClaimAllHealthy } = await import('../platform/vehicleReminderService');
    const far = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
    const m = { lastOilChangeKm: 40_000, nextOilChangeKm: 10_000,
                inspectionDate: far, insuranceExpiry: far, kaskoExpiry: far } as never;
    expect(canClaimAllHealthy(computeReminders(m, 41_000))).toBe(true);
  });
});

/* ── SAHTE ETA ŞERİDİ GERİ GELEMEZ (saha 2026-08-05 · #382 → #431) ──────────
 * CİHAZDA ÖLÇÜLDÜ: Tarsus rotası iptal edilir edilmez ana ekran alt şeridi
 * yine "23 dk · 19:56 · 18 km · EV kullanımı" gösterdi (`shot_18`) — rota
 * YOKKEN kanıtsız sabitler; üstelik araç ICE iken "EV kullanımı".
 * Kütüğün kabul ölçütü: gerçek kaynağa bağla ya da HİÇ gösterme. */
describe('Tema kartlarında kanıtsız ETA şeridi yoktur (#382/#431)', () => {
  const THEMES = [
    'src/components/themes/ProLayout.tsx',
    'src/components/themes/TeslaLayout.tsx',
    'src/components/themes/ExpeditionLayout.tsx',
    'src/components/themes/HorizonLayout.tsx',
  ];

  it('🔒 sabit "23 dk / 19:56 / 18 km" değerleri hiçbir temada RENDER EDİLMEZ', () => {
    for (const f of THEMES) {
      const src = read(f);
      // Yorumda anılabilir (neden kaldırıldığı yazılı); JSX metni olarak GEÇEMEZ.
      const jsx = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(jsx, `${f} sahte ETA metni içeriyor`).not.toContain('23 dk');
      expect(jsx, `${f} sahte varış saati içeriyor`).not.toContain('19:56');
      expect(jsx, `${f} sahte mesafe içeriyor`).not.toContain('18 km');
    }
  });

  it('🔒 araç tipi kanıtı olmadan "EV kullanımı" iddiası edilmez', () => {
    for (const f of THEMES) {
      const jsx = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(jsx, `${f} koşulsuz "EV kullanımı" gösteriyor`).not.toContain('EV kullanımı');
    }
  });
});

/* ── ONAYLI SAPMA AKSİYONSUZ KALAMAZ (saha 2026-08-05 · #402) ───────────────
 * CİHAZDA ÖLÇÜLDÜ: `CONFIRMED_OFF_ROUTE` 70/399 örnek (%17,5), `SUSPECTED` %22 —
 * buna karşılık `isRerouting` %0,0 ve `req.committed` 1'de kaldı. Sistem kararı
 * üretti, kütüğe yazdı, HİÇBİR aksiyon almadı ve nedenini de kaydetmedi.
 * KÖK: karar katmanı kötü doğruluklu fix'i sapma kanıtı sayıyordu; rota kurma
 * katmanı ise aynı fix'i (haklı olarak) `accuracy > 50 m` diye reddediyordu. */
describe('Off-route kararı ile reroute aynı eşiği paylaşır (#402)', () => {
  const EV = {
    matchState: 'OFF_NETWORK' as const,
    lateralM: 400, headingDeltaDeg: 120, progressM: -200,
    speedKmh: 94, tsMs: 0,
  };

  async function run(accuracyM: number | null, samples = 6) {
    const { initialOffRoute, stepOffRoute } = await import('../platform/navigation/core/offRouteModel');
    let m = initialOffRoute();
    for (let i = 0; i < samples; i++) {
      m = stepOffRoute(m, { ...EV, accuracyM, tsMs: i * 1000 }, 40);
    }
    return m;
  }

  it('🔒 doğruluk aksiyon eşiğinin DIŞINDAYSA sapma DOĞRULANMAZ', async () => {
    const m = await run(120);   // sahada p95 7 578 m ölçüldü
    expect(m.state).not.toBe('CONFIRMED_OFF_ROUTE');
    expect(m.reasons).toContain('ACCURACY_INSUFFICIENT');
  });

  it('🔒 doğruluk BİLİNMİYORSA da sapma doğrulanmaz (null ≠ iyi)', async () => {
    const m = await run(null);
    expect(m.state).not.toBe('CONFIRMED_OFF_ROUTE');
  });

  it('🔒 doğruluk iyiyken sapma HÂLÂ doğrulanır (kapı sağırlaştırılmadı)', async () => {
    const m = await run(8);
    expect(m.state).toBe('CONFIRMED_OFF_ROUTE');
  });

  it('🔒 karar eşiği ile rota kurma eşiği AYNI sabitten gelir', async () => {
    const { ACTIONABLE_ACCURACY_M } = await import('../platform/navigation/core/offRouteModel');
    expect(ACTIONABLE_ACCURACY_M).toBe(50);
    const routing = read('src/platform/routingService.ts');
    // Sabit yeniden yazılırsa iki katman sessizce ayrışır — kilit bunu yasaklar.
    expect(routing).toContain('accuracyM > ACTIONABLE_ACCURACY_M');
    expect(routing).not.toMatch(/accuracyM\s*>\s*50\b/);
  });

  it('🔒 reroute engellenirse SESSİZ kalmaz — nedeniyle deftere yazılır', async () => {
    const ledger = await import('../platform/navigation/core/routeRequestLedger');
    ledger.resetRouteRequestLedger();
    expect(ledger.getRerouteBlockStats().blockedCount).toBe(0);
    ledger.recordRerouteBlocked('WEAK_ACCURACY', 1000);
    ledger.recordRerouteBlocked('THROTTLED', 2000);
    const s = ledger.getRerouteBlockStats();
    expect(s.blockedCount).toBe(2);
    expect(s.byReason.WEAK_ACCURACY).toBe(1);
    expect(s.last?.reason).toBe('THROTTLED');
    ledger.resetRouteRequestLedger();
    expect(ledger.getRerouteBlockStats().blockedCount).toBe(0);  // oturum başına
  });

  it('🔒 routingService sessiz `return` ile sapmayı yutmaz', () => {
    const src = read('src/platform/routingService.ts');
    for (const reason of ['WEAK_ACCURACY', 'THROTTLED', 'NO_CONTEXT', 'STRAIGHT_LINE', 'DR_POSITION']) {
      expect(src, `${reason} kaydı yok`).toContain(`recordRerouteBlocked('${reason}'`);
    }
  });
});

/* ── GPS ALIM SAĞLIĞI SAYILIR (saha 2026-08-05 · #401 · #406 · #423) ────────
 * CİHAZDA ÖLÇÜLDÜ: fix p50 19,5 s BAYAT (94 km/h'de ~509 m körlük), fix>10 s
 * %61,2, doğruluk p95 7 578 m, JumpGuard 30+ kez reddetti — ve bunların HİÇBİRİ
 * sayılmıyordu (yalnız console.warn). Ölçülemeyen kusur düzeltilemez. */
describe('GPS alım sağlığı ölçülür ve tazelik iddia edilmez (#401)', () => {
  it('🔒 varış / kabul / red ayrı ayrı sayılır', async () => {
    const h = await import('../platform/gps/gpsIntakeHealth');
    h.resetGpsIntakeHealth();
    h.noteArrival(1000); h.noteAccepted(1000, 5);
    h.noteArrival(2000); h.noteRejected('JUMP_GUARD', 3800);
    h.noteArrival(3000); h.noteAccepted(3000, 7);
    const s = h.getGpsIntakeSnapshot();
    expect(s.arrivals).toBe(3);
    expect(s.accepted).toBe(2);
    expect(s.rejected.JUMP_GUARD).toBe(1);
    expect(s.acceptRatio).toBeCloseTo(2 / 3);
    expect(s.worstAccuracyM).toBe(3800);   // reddedilen çöp fix de kanıttır
    h.resetGpsIntakeHealth();
  });

  it('🔒 hiç veri yokken oran/istatistik SAHTE değer üretmez', async () => {
    const h = await import('../platform/gps/gpsIntakeHealth');
    h.resetGpsIntakeHealth();
    const s = h.getGpsIntakeSnapshot();
    expect(s.acceptRatio).toBeNull();      // sahte %100 YASAK
    expect(s.gapMsP50).toBeNull();
    expect(s.accuracyP50).toBeNull();
  });

  it('🔒 tazelik sınıfı: bilinmeyen konum "taze" SAYILMAZ', async () => {
    const { classifyFreshness } = await import('../platform/gps/gpsIntakeHealth');
    expect(classifyFreshness(null, 10_000)).toBe('UNKNOWN');
    expect(classifyFreshness(9_000, 10_000)).toBe('FRESH');   // 1 s
    expect(classifyFreshness(4_000, 10_000)).toBe('STALE');   // 6 s
    // Sahada ölçülen medyan: 19,5 s → DEAD
    expect(classifyFreshness(0, 19_500)).toBe('DEAD');
    // Saat geriye sıçrarsa iddia edilmez (batarya kopması / NTP)
    expect(classifyFreshness(20_000, 10_000)).toBe('UNKNOWN');
  });

  it('🔒 gpsService red/kabul yollarını sağlık katmanına BİLDİRİR', () => {
    const src = read('src/platform/gpsService.ts');
    expect(src).toContain("noteRejected('JUMP_GUARD'");
    expect(src).toContain("noteRejected('INVALID_COORDS'");
    expect(src).toContain("noteRejected('THROTTLED'");
    expect(src).toContain('noteAccepted(now, loc.accuracy)');
    // Varış heartbeat'i eleme kapılarından ÖNCE olmalı (fix geldi ≠ kabul edildi).
    expect(src.indexOf('noteArrival(now)')).toBeLessThan(src.indexOf("noteRejected('THROTTLED'"));
  });
});

/* ── HEDEF KULLANICI OLMADAN DEĞİŞEMEZ (saha 2026-08-05 · #429) ─────────────
 * SAHADA YAŞANAN: hedef "Tarsus, Mersin" (289 km) iken, hiçbir kullanıcı eylemi
 * olmadan rota kartı "Konya, İç Anadolu Bölgesi"ne — aracın ARKASINDAKİ şehre —
 * döndü. OSRM doğal olarak geri çevirmeye çalıştı: otoyolda "U dönüşü yapın".
 * Kullanıcının "dönemeç olmayan yerde sola dönün diyor" şikâyetinin köküydü.
 * Değişimi kimin yaptığını gösteren kayıt YOKTU. */
describe('Aktif hedefin sahipliği (#429)', () => {
  const A = { id: 'a', name: 'Tarsus', latitude: 36.917, longitude: 34.895 };
  const B = { id: 'b', name: 'Konya',  latitude: 37.874, longitude: 32.492 };

  it('🔒 oturum sürerken SAHİPSİZ hedef değişimi ENGELLENİR', async () => {
    const { judgeDestinationChange } = await import('../platform/navigation/core/destinationOwnershipModel');
    const v = judgeDestinationChange({ current: A, sessionActive: true, next: B, source: 'SYSTEM', tsMs: 1 });
    expect(v.decision).toBe('BLOCK');
    expect(v.reason).toBe('UNOWNED_CHANGE_DURING_SESSION');
  });

  it('🔒 kullanıcı her zaman hedefini değiştirebilir (kapı sürücüyü kilitlemez)', async () => {
    const { judgeDestinationChange } = await import('../platform/navigation/core/destinationOwnershipModel');
    for (const source of ['USER_SEARCH', 'USER_MAP', 'USER_VOICE', 'USER_QUICK'] as const) {
      expect(judgeDestinationChange({ current: A, sessionActive: true, next: B, source, tsMs: 1 }).decision)
        .toBe('ALLOW');
    }
  });

  it('🔒 ilk hedef ve oturum yokken değişim serbest — mevcut akışlar kırılmaz', async () => {
    const { judgeDestinationChange } = await import('../platform/navigation/core/destinationOwnershipModel');
    expect(judgeDestinationChange({ current: null, sessionActive: false, next: A, source: 'SYSTEM', tsMs: 1 }).decision).toBe('ALLOW');
    expect(judgeDestinationChange({ current: A, sessionActive: false, next: B, source: 'SESSION_RESTORE', tsMs: 1 }).decision).toBe('ALLOW');
  });

  it('🔒 aynı hedefin tazelenmesi "değişim" sayılmaz (geocoder gürültüsü)', async () => {
    const { judgeDestinationChange } = await import('../platform/navigation/core/destinationOwnershipModel');
    const nudged = { ...A, id: 'a2', latitude: A.latitude + 0.0005 };  // ~55 m
    const v = judgeDestinationChange({ current: A, sessionActive: true, next: nudged, source: 'SYSTEM', tsMs: 1 });
    expect(v.decision).toBe('ALLOW');
    expect(v.reason).toBe('SAME_DESTINATION');
  });

  it('🔒 her hedef değişimi DEFTERE yazılır (bir daha kanıtsız kalmasın)', async () => {
    const m = await import('../platform/navigation/core/destinationOwnershipModel');
    m.resetDestinationChangeLog();
    m.recordDestinationChange(
      m.judgeDestinationChange({ current: A, sessionActive: true, next: B, source: 'SYSTEM', tsMs: 5 }).change,
    );
    const log = m.getDestinationChangeLog();
    expect(log.blockedCount).toBe(1);
    expect(log.lastChange?.fromName).toBe('Tarsus');
    expect(log.lastChange?.toName).toBe('Konya');
    expect(log.lastChange?.source).toBe('SYSTEM');
    m.resetDestinationChangeLog();
  });

  it('🔒 startNavigation çağıranları kaynaklarını BİLDİRİR', () => {
    const callers: Array<[string, string]> = [
      ['src/components/map/MapSearchBar.tsx',        'USER_SEARCH'],
      /* P0-NAV-02: haritada uzun basış çağıranı `FullMapView`den
         `hooks/useMapOverlayLifecycle`e TAŞINDI (davranış aynı, sahiplik
         netleşti). Kilit KALDIRILMADI — yeni konuma taşındı. */
      ['src/components/map/hooks/useMapOverlayLifecycle.ts', 'USER_MAP'],
      ['src/components/map/NavigationHUD.tsx',       'USER_QUICK'],
      ['src/platform/addressNavigationEngine.ts',    'USER_VOICE'],
      ['src/platform/homeWorkNavigation.ts',         'USER_QUICK'],
      ['src/platform/navigationService.ts',          'SESSION_RESTORE'],
    ];
    for (const [file, source] of callers) {
      expect(read(file), `${file} hedef kaynağını bildirmiyor`).toContain(`'${source}'`);
    }
  });

  it('🔒 varsayılan kaynak SYSTEM olmalı — kimliğini bildirmeyen "kullanıcı" sayılmaz', () => {
    const src = read('src/platform/navigationService.ts');
    expect(src).toContain("source: DestinationSource = 'SYSTEM'");
  });
});

/* ── ÖNİZLEME REHBERLİK DEĞİLDİR (saha 2026-08-05 · #416/#418) ──────────────
 * CİHAZDA ÖLÇÜLDÜ: `status = PREVIEW` iken `isNavigating = true`; aynı anda
 * `match.state = null` (eşleme ölü), `route.nextManeuverM = 0`, panelde hâlâ
 * "NAVİGASYONU BAŞLAT" düğmesi. Sürücü "navigasyon açık" sanıyordu.
 * #428 aynı gün ACTIVE oturumda metriklerin dramatik biçimde iyi olduğunu
 * ölçerek bu ayrımın ürün etkisini kanıtladı. */
describe('Oturum açık olmak ≠ rehberlik sürüyor (#416/#418)', () => {
  it('🔒 rehberlik durumları YALNIZ ACTIVE ve REROUTING', () => {
    const src = read('src/platform/navigationService.ts');
    const blk = src.slice(src.indexOf('const GUIDANCE_STATUSES'), src.indexOf('const GUIDANCE_STATUSES') + 260);
    expect(blk).toContain('NavStatus.ACTIVE');
    expect(blk).toContain('NavStatus.REROUTING');
    expect(blk).not.toContain('NavStatus.PREVIEW');
    expect(blk).not.toContain('NavStatus.ROUTING');
    expect(blk).not.toContain('NavStatus.ARRIVED');
  });

  it('🔒 hedef seçimi (PREVIEW) rehberliği AÇMAZ', () => {
    const src = read('src/platform/navigationService.ts');
    const impl = src.indexOf('setDestination: (destination, isOffline = false) => set({');
    expect(impl, 'setDestination uygulaması bulunamadı (kilit bayatladı mı?)').toBeGreaterThan(0);
    const blk = src.slice(impl, impl + 400);
    expect(blk).toContain('status: NavStatus.PREVIEW');
    expect(blk).toContain('isGuidanceActive: false');
  });

  it('🔒 saha köprüsü iki durumu AYRI yayınlar (ölçüm bir daha karışmasın)', () => {
    const bridge = read('src/platform/devtools/navFieldBridge.ts');
    expect(bridge).toContain('isGuidanceActive: nav.isGuidanceActive');
    expect(bridge).toContain('isNavigating: nav.isNavigating');
  });
});

/* ── MESAFE VE ETA: TEK OTORİTE, KAYNAK ETİKETLİ (saha 2026-08-05 · #403/#404) ──
 * ÖLÇÜLDÜ: kalan mesafenin %38'i KUŞ UÇUŞU idi ama gerçek kalan mesafeyle aynı
 * kesinlikte gösteriliyordu; mesafe 69 kez ARTTI. ETA'da ekran 3 sa 18 dk derken
 * motor 4 sa 42 dk diyordu — HUD ikinci bir ETA türetiyordu. */
describe('Mesafe/ETA tek otorite ve kaynak etiketli (#403/#404)', () => {
  it('🔒 mesafe kaynağı state ile birlikte taşınır', () => {
    const src = read('src/platform/navigationService.ts');
    expect(src).toContain("distanceSource?: 'ALONG_ROUTE' | 'STRAIGHT_LINE'");
    expect(src).toContain('updateDistance(distance, distanceSource)');
  });

  it('🔒 kuş uçuşu mesafe ETA girdisine VERİLMEZ', () => {
    const src = read('src/platform/navigationService.ts');
    expect(src).toMatch(/remainingDistanceM:[\s\S]{0,220}distanceSource === 'ALONG_ROUTE'/);
  });

  it('🔒 HUD ikinci bir ETA türetmez — motorun değerini kullanır', () => {
    const hud = read('src/components/map/NavigationHUD.tsx');
    // Eski formül: route.totalDurationSeconds * (effectiveDist / totalDistanceMeters)
    expect(hud).not.toMatch(/totalDurationSeconds\s*\*\s*Math\.min/);
    expect(hud).toMatch(/const displayEta =[\s\S]{0,120}etaSeconds/);
  });

  it('🔒 kuş uçuşu mesafe ekranda "~" ile işaretlenir', async () => {
    const hook = read('src/hooks/useNavSummary.ts');
    expect(hook).toContain("distanceSource !== 'ALONG_ROUTE'");
    expect(hook).toContain("yaklasik ? '~' : ''");
  });
});

/* ── YÖN BİLGİSİ VARKEN "BİLİNMİYOR" DENMEZ (saha 2026-08-05 · #405/#408) ───
 * ÖLÇÜLDÜ: `headingDeg` örneklerin %100'ünde doluydu; buna rağmen %13,8'inde
 * `HEADING_UNKNOWN`. Kök: hız `null` iken 0 varsayılıyor ("duruyor") ve düşük
 * hızda yön gürültü sayıldığı için eldeki gerçek yön atılıyordu. */
describe('Yön güveni ve hız boşluğu (#405/#408)', () => {
  const geom: [number, number][] = [[32.0, 37.0], [32.01, 37.0], [32.02, 37.0]];

  async function match(speedKmh: number | null) {
    const { matchToRoute } = await import('../platform/navigation/core/mapMatchModel');
    return matchToRoute(
      { lat: 37.0, lon: 32.005, accuracyM: 6, headingDeg: 90, speedKmh, tsMs: 1000 },
      geom, null, null, 1000,
    );
  }

  it('🔒 hız BİLİNMİYORKEN eldeki yön atılmaz', async () => {
    const fix = await match(null);
    expect(fix.reasons).not.toContain('HEADING_UNKNOWN');
  });

  it('🔒 hız biliniyor ve araç duruyorsa yön hâlâ gürültü sayılır', async () => {
    const fix = await match(1);
    expect(fix.reasons).toContain('HEADING_UNKNOWN');
  });

  it('🔒 sürüş hızında yön güvenilirdir', async () => {
    const fix = await match(94);
    expect(fix.reasons).not.toContain('HEADING_UNKNOWN');
  });

  it('🔒 eşleme örneğine SAHTE 0 hız yazılmaz', () => {
    const src = read('src/platform/routingService.ts');
    expect(src).toContain('speedKmh: speedKmhOrNull');
    expect(src).not.toMatch(/const speedKmh = speed \?\? 0;\s*$/m);
  });
});

/* ── DOĞRULAMA VE DOĞRULUK GÖRÜNÜR (saha 2026-08-05 · #407/#413) ────────────
 * #407: rota doğrulaması 399/399 örnekte DEGRADED çıktı ama HANGİ kritere
 * takıldığı hiçbir yerde görünmüyordu → düzeltilemeyen kusur.
 * #413: ekran "~129 m" derken motor 2 068 m okuyordu — iki konum otoritesi. */
describe('Doğrulama sebebi ve doğruluk kaynağı görünür (#407/#413)', () => {
  it('🔒 köprü hangi kontrollerin WARN/FAIL verdiğini yayınlar', () => {
    const bridge = read('src/platform/devtools/navFieldBridge.ts');
    expect(bridge).toContain('validationWarnIds');
    expect(bridge).toContain('validationFailIds');
  });

  it('🔒 ekranda gösterilen doğruluk, kararları besleyen konumdan gelir', () => {
    const src = read('src/components/map/FullMapView.tsx');
    expect(src).toContain('engineAccuracyM');
    expect(src).not.toMatch(/±\{Math\.round\(location\.accuracy\)\}m/);
  });
});

/* ── CİHAZ TÜRÜ ≠ PERFORMANS SINIFI (saha 2026-08-05 · #411) ────────────────
 * ÖLÇÜLDÜ: cihaz bir TELEFONDU (Redmi 23090RA98I) ama `cl_isHeadUnit = "1"`
 * yazılmıştı → head unit için tasarlanmış px/metre yerleşimi telefonda
 * uygulanınca #412'deki üst üste binen/kırpılan ekranlar çıktı.
 * KÖK: düşük RAM/tier bir cihaz otomatik "head unit" damgası alıyordu. */
describe('Performans sınıfı cihaz türü damgası basmaz (#411)', () => {
  it('🔒 düşük sınıf tespiti `cl_isHeadUnit` YAZMAZ', () => {
    const core = read('src/platform/nativeCoreService.ts');
    expect(core).not.toMatch(/setItem\('cl_isHeadUnit'/);
    expect(core).toContain("setItem('cl_compatLowTier'");
  });

  it('🔒 compat katmanı da tür değil SINIF yazar; eski anahtarı temizler', () => {
    const hu = read('src/platform/headUnitCompat.ts');
    expect(hu).toContain("setItem('cl_compatLowTier'");
    expect(hu).not.toMatch(/setItem\('cl_isHeadUnit'/);
    expect(hu).toContain("removeItem('cl_isHeadUnit')");
  });

  it('🔒 profil alanı ayrıştırıldı — isLowTier kanonik', () => {
    const hu = read('src/platform/headUnitCompat.ts');
    expect(hu).toContain('isLowTier:');
    expect(hu).toContain('return getCompatProfile().isLowTier;');
  });
});

/* ── İKLİM/AYARLAR EKRANI TEMA-KÖR OLAMAZ (saha 2026-08-05 · #412-d/#425) ───
 * ÖLÇÜLDÜ: iklim ekranında A/C · AUTO · SYNC etiketleri ve sıcaklık değerleri
 * BEYAZ ÜZERİNE BEYAZ; ayarlar ekranında mavi/mor/yeşil OEM paleti dışı renkler. */
describe('Ekranlar OEM token katmanını kullanır (#412-d/#425)', () => {
  it('🔒 iklim ekranında sabit beyaz metin/renk kalmadı', () => {
    const src = read('src/components/climate/ClimateScreen.tsx');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');   // açıklama yorumları hariç
    expect(code).not.toMatch(/rgba\(255,\s*255,\s*255/);
    expect(code).not.toMatch(/\btext-white\b/);
  });

  it('🔒 ayarlar ekranında palet-dışı sabit renk kalmadı', () => {
    const src = read('src/components/settings/SettingsPage.tsx');
    // Fallback biçimi `var(--oem-x, #hex)` serbesttir; ÇIPLAK hex yasaktır.
    const bare = src.match(/(?<!,\s)(?<!,)'#(3b82f6|8b5cf6|a855f7|22c55e|10b981|06b6d4)'/gi);
    expect(bare, `çıplak palet-dışı renk: ${bare?.join(', ')}`).toBeNull();
    expect(src).not.toMatch(/text-blue-\d00/);
  });
});

/* ── AI SESSİZCE ÖLMEZ: 402 ≠ 401 ≠ 429 (saha 2026-08-05 · #421) ────────────
 * ÖLÇÜLDÜ: 15 dakikada `402 openrouter.ai` × 11 (kredi bitti) ve
 * `429 generativelanguage` × 22 (kota). 402, `auth` ile aynı kovaya düşüyordu;
 * kullanıcı "anahtar geçersiz" mi "kredi bitti" mi ayırt edemiyordu. */
describe('AI hata sınıfları ayırt edicidir (#421)', () => {
  it('🔒 402 için ayrı hata sınıfı vardır', () => {
    const types = read('src/platform/ai/gateway/types.ts');
    expect(types).toContain("| 'insufficient_credit'");
  });

  it('🔒 OpenRouter 402\'yi auth ile aynı kovaya koymaz', () => {
    const prov = read('src/platform/ai/gateway/providers/openRouterProvider.ts');
    const blk = prov.slice(prov.indexOf('if (status === 402)'), prov.indexOf('if (status === 402)') + 420);
    expect(blk).toContain("kind: 'insufficient_credit'");
    expect(blk).not.toContain("kind: 'auth'");
    expect(blk).toMatch(/kredi/i);   // kullanıcıya ayırt edici mesaj
  });

  it('🔒 offline sebebi de ayrıştırılır (kredi ≠ yetki ≠ kota)', async () => {
    const m = await import('../platform/ai/aiOfflineReason');
    expect(m.offlineReasonFromErrorKind('insufficient_credit')).toBe('PROVIDER_NO_CREDIT');
    expect(m.offlineReasonFromErrorKind('auth')).toBe('PROVIDER_AUTH_FAILED');
    expect(m.offlineReasonFromErrorKind('rate_limited')).toBe('PROVIDER_RATE_LIMITED');
  });
});

/* ── KALICI ŞEMA HATASI TEKRAR DENENMEZ (saha 2026-08-05 · #422) ────────────
 * ÖLÇÜLDÜ: `Could not find the table 'public.raw_community_events'` × 5 + 404.
 * Tablo sunucuda yok (migration uygulanmamış); bunu geçici hata sayıp her
 * periyotta yeniden denemek ağı ve konsolu boşuna kirletiyordu (#424 ile bağlı). */
describe('CRM senkronu kalıcı şema hatasında durur (#422)', () => {
  it('🔒 şema eksikliği geçici hatadan AYRILIR ve senkron durdurulur', () => {
    const src = read('src/platform/communityService.ts');
    expect(src).toContain('PGRST205');
    expect(src).toContain('_schemaMissing = true');
    expect(src).toContain('if (_schemaMissing) return;');
  });

  it('🔒 kuyruk KORUNUR — veri kaybı yok', () => {
    const src = read('src/platform/communityService.ts');
    const start = src.indexOf('if (_isSchemaMissing(error))');
    const blk = src.slice(start, src.indexOf('return;', start));  // yalnız şema dalı
    expect(blk).not.toContain('removeEvents');
    expect(blk).not.toContain('clear');
  });

  it('🔒 durum gözlemlenebilir', () => {
    expect(read('src/platform/communityService.ts')).toContain('export function isCommunitySyncBlockedBySchema');
  });
});

/* ── CAN SNAPSHOT NATIVE'DE ÖLÜ KALAMAZ (saha 2026-08-05 · #400) ────────────
 * ÖLÇÜLDÜ: OBD bağlı ve veri akarken `localStorage['car-can-snapshot']` 63,4 saat
 * eskiydi ve 4 sn'lik gözlemde hiç değişmedi. KÖK: anahtar kritik listede değildi;
 * `_commitToStorage` native dalında `localStorage.setItem` YALNIZ kritik anahtarlar
 * için çalışır → senkron hidrasyon yolu (`safeGetRaw`) her açılışta bayat okuyordu. */
describe('CAN snapshot kritik katmanda yazılır (#400)', () => {
  it('🔒 anahtar kritik listede — native localStorage backup\'ı alır', () => {
    const src = read('src/utils/safeStorage.ts');
    const lru = src.slice(src.indexOf('const LRU_PROTECTED'), src.indexOf('const LRU_PROTECTED') + 2600);
    expect(lru).toContain("'car-can-snapshot'");
  });

  it('🔒 yazım 1 s tamponlu — OBD akışı eMMC\'yi dövmez', () => {
    const src = read('src/utils/safeStorage.ts');
    const deb = src.slice(src.indexOf('const _SAFETY_DEBOUNCE_KEYS'), src.indexOf('const _SAFETY_DEBOUNCE_KEYS') + 900);
    expect(deb).toContain("'car-can-snapshot'");
  });

  it('🔒 native dalda kritik anahtar localStorage yedeği ALIR', () => {
    const src = read('src/utils/safeStorage.ts');
    // `_commitToStorage` içindeki native dal (LRU eviction'daki NATIVE bloğu değil).
    const commit = src.indexOf('async function _commitToStorage');
    const blk = src.slice(commit, commit + 1600);
    expect(blk).toContain('_isCritical(key)');
    expect(blk).toContain('localStorage.setItem(key, value)');
  });
});

/* ── SİSTEM SAHİPLİ UART AÇILAMAZ (saha 2026-08-06 · K24) ───────────────────
 * CİHAZDA ÖLÇÜLDÜ (K2401 / Allwinner ceres-b3): uygulama CAN portu ararken
 * `/dev/ttyS0..ttyS4` listesini tarayıp `/dev/ttyS1`'i açıyordu. O port bu
 * ünitede OEM Bluetooth HCI hattıdır (`service gocsdk_8800 … /dev/ttyS1 1500000`).
 * İki süreç aynı UART'tan okuyunca HCI çerçeveleri bölünüyor, OEM daemon'ı
 * `Cur BT Init Failed` verip kendini öldürüyor ve yeniden başlarken
 * `svc bluetooth disable` çağırıyor → head unit'in Bluetooth'u TAMAMEN ölüyor,
 * hiçbir OBD adaptörü bulunamıyor. Ölçüm:
 *   uygulama KAPALI → ttyS1: gocsdk_8800
 *   uygulama AÇIK   → ttyS1: gocsdk_8800 + m.cockpitos.pro   (çakışma) */
describe('Seri port taraması sistem sahipli portu açmaz (K24 BT)', () => {
  const serial = read('android/app/src/main/java/com/cockpitos/pro/can/SerialPortHandler.java');

  it('🔒 port açma döngüsünde sahiplik kapısı vardır', () => {
    expect(serial).toContain('isPortOwnedBySystem(port)');
    // Kapı, açma denemesinden ÖNCE gelmeli.
    expect(serial.indexOf('isPortOwnedBySystem(port)'))
      .toBeLessThan(serial.indexOf('tryOpen(port, baudRate)'));
  });

  it('🔒 üç bağımsız kanıt korunur (biri okunamazsa diğerleri korur)', () => {
    expect(serial, 'kernel konsolu kanıtı yok').toContain('console=');
    expect(serial, 'init.rc kanıtı yok').toContain('initRcClaimsPort');
    expect(serial, 'sahada ölçülmüş platform haritası yok').toContain('KNOWN_OWNED_PORTS');
  });

  it('🔒 K24 platformunda ttyS1 (OEM BT) dokunulmaz olarak işaretli', () => {
    const blk = serial.slice(serial.indexOf('KNOWN_OWNED_PORTS'), serial.indexOf('KNOWN_OWNED_PORTS') + 400);
    expect(blk).toContain('sun50iw10p1');
    expect(blk).toContain('ceres-b3');
    expect(blk).toContain('/dev/ttyS1');
  });

  /* SAHA 2026-09-03 — AYNI HATA SINIFI, ÇOK DAHA AĞIR SONUÇ.
   * ttyS1 korunduktan sonra tarayıcı bir sonraki adaya (`/dev/ttyS2`) geçti.
   * O port bu ünitede OEM'in MCU kontrol hattıdır (`nwdapp_UartCommunication`
   * kendi çerçevelerini oraya yazar). İki yazıcı olunca MCU protokolü bozuluyor
   * ve MCU kartın GÜCÜNÜ KESİYOR. Canlı yakalanan zincir:
   *   21:14:02.111  Bağlandı → UART:/dev/ttyS2 @ 115200
   *   21:14:02.220  Heartbeat gönderildi        (MCU'ya yazım)
   *   21:14:16      cihaz ÖLDÜ — kernel log'unda TEK satır uyarı yok
   * Kernel'de panic/oops/watchdog izi OLMAMASI, kapanmanın yazılımdan değil
   * MCU'dan geldiğinin kanıtıdır. Düzeltme sonrası aynı senaryoda cihaz
   * kesintisiz 30+ dakika ayakta kaldı (önce: 14-90 sn). */
  it('🔒 K24 platformunda ttyS2 (OEM MCU hattı) dokunulmaz olarak işaretli', () => {
    const start = serial.indexOf('KNOWN_OWNED_PORTS');
    const blk = serial.slice(start, start + 400);
    /* Her iki platform anahtarı da ttyS2 taşımalı — biri unutulursa cihaz
       yeniden sert reset döngüsüne girer. */
    const rows = blk.split('\n').filter((l) => l.includes('/dev/ttyS'));
    expect(rows.length, 'platform satırları bulunamadı — kilit kör kalmış').toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row, `ttyS2 koruması eksik: ${row.trim()}`).toContain('/dev/ttyS2');
    }
  });

  it('🔒 Hiworld tarayıcısı da aynı kapıdan geçer (iki tarama yolu var)', () => {
    const hi = read('android/app/src/main/java/com/cockpitos/pro/can/HiworldAdapter.java');
    const hits = hi.match(/isPortOwnedBySystem\(p\)/g) ?? [];
    expect(hits.length, 'her iki port tarama döngüsü korunmalı').toBeGreaterThanOrEqual(2);
  });

  it('🔒 fail-soft: kanıt okunamazsa tarama engellenmez', () => {
    // Bilinmeyen platformda / okunamayan dosyada koruma DEVREYE GİRMEZ ki
    // mevcut head unit'lerde CAN keşfi kırılmasın: varsayılan `false` ve
    // her kanıt kendi try/catch'inde — biri patlarsa diğerleri sürer.
    const blk = serial.slice(
      serial.indexOf('static boolean isPortOwnedBySystem'),
      serial.indexOf('private static boolean initRcClaimsPort'),
    );
    expect(blk).toContain('boolean owned = false;');
    expect((blk.match(/catch \(Throwable ignored\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * OBD veri yolu yan deftere BAĞLANAMAZ (fail-soft)
 *
 * 2026-08-07: #454'ün düzeltmesi `_onRealData` içine `recordFeatureRecovered()`
 * (SafetyBrain defter tutma) çağrısı koydu — ama KORUMASIZ. Çağrı fırlarsa
 * hemen ardındaki `connectionState: 'connected'` geçişi HİÇ yapılmıyor ve OBD,
 * gerçek ECU verisi akarken sonsuza dek "initializing" görünüyordu.
 * Beş OBD test dosyası bunu anında yakaladı (23 düşen test); üretimdeki
 * karşılığı localStorage kota/bozulma hatasıdır. Bağlantı GERÇEKLİĞİ hiçbir
 * zaman bir yan defterin başarısına bağlanamaz. */
describe('OBD ilk ECU frame yolunda defter tutma fail-soft', () => {
  const gateBlock = obdServiceSrc.slice(
    obdServiceSrc.indexOf('if (!_dataGatePassed) {'),
    obdServiceSrc.indexOf('_startStaleWatchdog();'),
  );

  it('🔒 gate bloğu gerçekten bulundu (kilit boşa koşmasın)', () => {
    expect(gateBlock.length).toBeGreaterThan(200);
    expect(gateBlock).toContain("connectionState: 'connected'");
  });

  it('🔒 recordFeatureRecovered çağrısı try/catch ile sarılıdır', () => {
    expect(gateBlock).toMatch(/try\s*\{\s*recordFeatureRecovered\(/);
  });

  it('🔒 connected geçişi defter çağrısından SONRA ve onun dışındadır', () => {
    // Ölçüm çağrının KENDİSİNE sabitlenir: aynı blokta başka `connected`
    // geçişleri de var, ilk eşleşmeye bakmak kilidi yanlış yerden ölçerdi.
    const call    = gateBlock.indexOf('try { recordFeatureRecovered(');
    const catchAt = gateBlock.indexOf('catch', call);
    const merge   = gateBlock.indexOf("connectionState: 'connected'", catchAt);
    expect(call, 'korumalı çağrı bulunamadı').toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(call);
    expect(merge, 'catch sonrası connected geçişi yok').toBeGreaterThan(catchAt);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Odometre Δt'si ÖLÇÜM anından türetilir (kütük #458)
 *
 * SAHA 2026-08-06: `Teleport rejected` × 8, hepsi accuracy 2 m fix'lerde;
 * 94,8 km/h'de 264 m "implied 800 km/h" sanıldı çünkü Δt paketin VARIŞ
 * farkından (1187 ms) ölçülüyordu. Kayıp: 32 dakikada ~1,15 km.
 * Zincir üç halkalı — biri koparsa kusur sessizce geri gelir:
 *   GpsAdapter (fix zamanını taşı) → Resolver (zarfa koy) → Worker (Δt'yi ondan üret)
 * Davranış testi: `odometerFixTimeAuthority.test.ts` */
describe('GPS odometre Δt zinciri ölçüm anına bağlı', () => {
  it('🔒 GpsAdapter fix zamanını düşürmez', () => {
    const src = read('src/platform/vehicleDataLayer/GpsAdapter.ts');
    expect(src, 'fixTs taşınmıyor — zincirin ilk halkası kopuk').toContain('fixTs: loc.timestamp');
  });

  it('🔒 Resolver fixTs\'i HER kaynakta gönderir (tek Hidden Class)', () => {
    // Alan yalnız GPS mesajında bulunursa VEHICLE_DATA iki şekle ayrılır ve
    // sıcak yol megamorphic olur — CLAUDE.md "Template Object Literals".
    const sends = vehicleResolverSrc.match(/type: 'VEHICLE_DATA'[^}]*\}/g) ?? [];
    expect(sends.length, 'VEHICLE_DATA gönderimi bulunamadı').toBeGreaterThanOrEqual(4);
    for (const s of sends) expect(s, `fixTs eksik: ${s}`).toContain('fixTs');
  });

  it('🔒 Worker Δt\'yi ölçüm anı seçicisinden alır, ham varış farkından DEĞİL', () => {
    expect(vehicleComputeWorkerSrc).toContain('function _gpsDeltaMs(');
    // Her iki GPS yolu da (VEHICLE_DATA ve eski GPS_DATA) seçiciden geçmeli.
    const uses = vehicleComputeWorkerSrc.match(/_gpsDeltaMs\(/g) ?? [];
    expect(uses.length, 'bir GPS yolu seçiciyi atlıyor').toBeGreaterThanOrEqual(3);
  });

  it('🔒 saat sıçraması bandı ve geriye-gidiş elemesi korunur', () => {
    expect(vehicleComputeWorkerSrc).toContain('GPS_FIX_DT_MAX_MS');
    expect(vehicleComputeWorkerSrc).toMatch(/fixDt > 0 && fixDt < GPS_FIX_DT_MAX_MS/);
  });

  it('🔒 OdometerGuard\'ın kendi monotonic tabanı ikinci savunma olarak DURUR', () => {
    // Ölçüm anı wall-clock kaynaklıdır; guard'ın 60 s bandı kaldırılırsa
    // NTP sıçraması doğrudan odometreye yazar.
    expect(odometerGuardSrc).toContain('Monotonic Clock Enforcement');
    expect(odometerGuardSrc).toMatch(/dtMs >= 0 && dtMs < 60_000/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Wake watchdog "self-heal" DEMEZ (kütük #460)
 *
 * Yanıltıcı log, saha incelemesini yanlış teşhise götürdü: konsoldaki
 * "(self-heal)" ifadesi yüzünden 4 periyodik yeniden kurulum "wake thread
 * 4 kez ÖLDÜ" diye kütüğe geçti. Kodda ölüm tespiti YOKTUR. Bir mesaj,
 * yapılmayan bir ölçümü ima edemez. */
describe('Wake watchdog kanıtsız iyileşme iddia etmez', () => {
  const src = read('src/platform/wakeWordService.ts');

  it('🔒 log "self-heal" iddiasını taşımaz', () => {
    expect(src, 'yapılmayan bir teşhisi ima eden ifade geri gelmiş').not.toContain('(self-heal)');
  });

  it('🔒 ölçüm yüzeyi vardır ve canlılığı ölçmediğini bildirir', () => {
    expect(src).toContain('export function getWakeWatchdogStats(');
    expect(src).toContain('livenessMeasured');
    // Canlılık artık native recorder owner'ın bounded lifecycle olayıyla ölçülür;
    // JS'in `enabled` bayrağı tek başına ACTIVE kanıtı değildir.
    expect(src).toContain("recorderState:     _wakeRecorderState");
    expect(src).toContain("_wakeRecorderState === 'ACTIVE'");
  });

  it('🔒 yeniden kurulum sayacı ve önceki-pencere tanığı korunur', () => {
    // İkisi birlikte "re-arm gerekli miydi" sorusunu yanıtlar; biri düşerse
    // ölçüm yorumlanamaz hâle gelir.
    expect(src).toContain('_rearmCount');
    expect(src).toContain('_wakesInPrevWindow');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GPS TAZELİĞİ — duran araçta fix akmaya DEVAM EDER (saha 2026-08-08, Siverek)
 *
 * ÖLÇÜLEN KUSUR: `GPS_MIN_DIST_M = 2 m` teslimi filtreliyordu; araç durunca
 * hiçbir fix gelmiyor, `fixAgeMs` 25.325 ms'e çıkıyordu — sinyal ±2 m ile
 * SAĞLAMKEN. Zinciri: DR'ye erken düşme → "Konum Kayboldu" uyarısı →
 * `MATCH_UNCERTAIN` / `HEADING_UNKNOWN` (güven 0,89 → 0,4) → kamera yön
 * otoritesini kaybediyor. Ayrıca 5 dk'lık park kısması navigasyondan habersizdi.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('🔒 GPS tazeliği — park kısması navigasyonu kör bırakmaz', () => {
  const svc = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherForegroundService.java');

  it('🔒 minDistance 0 — duran araçta da fix teslim edilir', () => {
    expect(
      svc,
      'GPS_MIN_DIST_M > 0 geri gelmiş: duran araçta fix akmaz, "Konum Kayboldu" sahte uyarısı döner',
    ).toMatch(/GPS_MIN_DIST_M\s*=\s*0f\s*;/);
  });

  it('🔒 park kısması aktif navigasyonda ÇALIŞMAZ', () => {
    expect(svc).toContain('sNavigationActive');
    // Kısma dalı bayrağı OKUMALI — yoksa uzun ışıkta GPS yine kapanır.
    expect(svc).toMatch(/gpsHighAccuracyActive\s*&&\s*!sNavigationActive/);
  });

  it('🔒 navigasyon başlarken 1 Hz akış DERHAL geri gelir', () => {
    // setNavigationActive(true) kısılmış hâlden çıkışı beklemez; yoksa rota
    // kısık başlar ve ilk manevra kaçar.
    expect(svc).toMatch(/setNavigationActive[\s\S]{0,400}resumeGpsHighAccuracy\(\)/);
  });

  it('🔒 köprü navigasyon oturumunun İKİ ucuna da bağlıdır', () => {
    const nav = read('src/platform/navigationService.ts');
    expect(nav).toContain('setNavigationGpsPower(true)');
    expect(nav).toContain('setNavigationGpsPower(false)');
  });
});

/* ─────────────────────────────────────────────────────────────────
   ADR-286 — TS ↔ SQL KARAR ÇEKİRDEĞİ PARİTESİ (kütük #488)

   Karar kuralı bugün İKİ KERE yazılıdır: cihazda `maviReasoningEngine.ts`,
   sunucuda `mavi_reason()`. ADR-286 karar otoritesini cihaza verdi ve
   "kural iki kere yazılmaz" kuralını koydu. Kopyalar teke inene kadar
   ayrışma ÖLÇÜLMEK zorundadır — ayrışırsa cihaz ile filo aynı araç için
   FARKLI hüküm verir ve bu sessizdir.

   Bu kasa maddesi parite testinin SESSİZCE BOŞALTILMASINI engeller:
   dosya silinemez, sapma adayları çıkarılamaz, SQL kaynağı kaybolamaz.
   ───────────────────────────────────────────────────────────────── */
describe('ADR-286 · karar çekirdeği parite kasası', () => {
  const parity = read('src/__tests__/reasoningParity.test.ts');

  it('🔒 parite testi VARDIR ve SQL kaynağını gerçekten okur', () => {
    expect(parity.length).toBeGreaterThan(2000);
    // Beklenen çıktıyı elle yazmak SQL'in üçüncü kopyasını üretmek olurdu;
    // test migration METNİNİ okumalıdır.
    expect(parity).toContain('20260801000055_ai_evidence_engine_p1.sql');
    expect(parity).toContain('20260801000057_mavi_reasoning_engine_p1.sql');
    expect(parity).toContain('readFileSync');
  });

  it('🔒 ADR-286 §3.3\'teki DÖRT sapma adayı da ölçülür', () => {
    for (const probe of ['#1 güven tavanı', '#2 REJECTED gerekçesi',
      '#3 kapsam NULL sırası', '#4 niyet türetme']) {
      expect(parity, `sapma adayı düşürülmüş: ${probe}`).toContain(probe);
    }
  });

  it('🔒 #497 çalışma zamanı fail-closed KAPALI kalır', () => {
    /* Beş fonksiyonda `default` dalı vardır ve dönüşleri SQL'in ELSE dallarıyla
       BİREBİR aynıdır. Biri kaldırılırsa union dışı girdi `undefined` döner ve
       hüküm motoru çöker — sapma sessizce geri gelirdi. */
    const rs = read('src/platform/reasoning/maviReasoning.ts');
    const ev = read('src/platform/fleet/aiEvidence.ts');
    for (const [src, fn] of [
      [rs, 'intentForCategory'], [rs, 'categoriesForIntent'], [rs, 'stateForDecision'],
      [ev, 'sourceConfidenceCeiling'], [ev, 'provenanceConfidenceCeiling'],
    ] as const) {
      const i = src.indexOf(`export function ${fn}(`);
      const body = src.slice(i, src.indexOf('\n}', i));
      expect(body, `${fn} default dalını kaybetti — #497 geri döndü`).toContain('default:');
    }
    // Altın dosyada union dışı vakalar bulunmalı; yoksa kilit boşa döner.
    const golden = read('docs/fixtures/reasoning_parity_golden.json');
    for (const probe of ['NOPE_INTENT', 'NOPE_DECISION', 'NOPE_SOURCE']) {
      expect(golden, `altın dosyada union dışı vaka yok: ${probe}`).toContain(probe);
    }
  });

  it('🔒 altın dosya GERÇEK Postgres çıktısıdır (elle yazılmaz)', () => {
    expect(parity).toContain('reasoning_parity_golden.json');
    const golden = JSON.parse(read('docs/fixtures/reasoning_parity_golden.json')) as
      Record<string, Record<string, unknown>>;
    let total = 0;
    for (const k of Object.keys(golden)) total += Object.keys(golden[k]!).length;
    expect(total, 'altın dosya boşaltılmış').toBeGreaterThan(1500);
  });

  it('🔒 eşleme tabloları ve karar SIRASI karşılaştırılır', () => {
    // Sıra sapması en tehlikelisidir: çelişki kapısı güvenin arkasına
    // düşerse çelişkili kanıt SUPPORTED üretir.
    expect(parity).toContain('_reasoning_categories');
    expect(parity).toContain('_reasoning_intent_for_category');
    expect(parity).toContain('_reasoning_state_for_decision');
    expect(parity).toContain('_reasoning_can_transition');
    expect(parity).toContain('CONFLICTING_EVIDENCE');
  });

  it('🔒 tam eşik vakaları matriste durur (0.5 · 0.8 · 1 · 5)', () => {
    // Sapmalar tam eşikte doğar: `<` operatörü `<=`ye kayarsa ancak burada
    // yakalanır.
    expect(parity).toMatch(/0\.5/);
    expect(parity).toMatch(/0\.8/);
    expect(parity).toContain('sampleConfidenceCeiling(5)');
    expect(parity).toContain('expires_at > now()');
  });

  it('🔒 SQL karar motoru migration\'ı yerinde durur', () => {
    // Parite testi SQL metnini okur; dosya taşınırsa test ANLAMSIZLAŞIR,
    // bu yüzden varlığı ayrıca kilitlenir.
    const sql = read('supabase/migrations/20260801000057_mavi_reasoning_engine_p1.sql');
    expect(sql).toContain('FUNCTION public.mavi_reason(');
    expect(sql).toContain('FUNCTION public._reasoning_confidence(');
  });
});

/* ─────────────────────────────────────────────────────────────────
   ADR-286 Faz 0 · Adım 2 — GÖÇ KARAKTERİZASYONU (kütük #496)

   `fuelAdvisorService` · `maintenanceBrain` · `smartCardEngine` göç
   sırasının 6·7·8. adımlarıdır ve ölçümde SIFIR teste sahiptiler.
   Testsiz göç = sessiz davranış değişikliği. Karakterizasyon dosyası
   bugünkü davranışı dondurur; bu kasa maddesi onun boşaltılmasını
   engeller.
   ───────────────────────────────────────────────────────────────── */
describe('ADR-286 · göç karakterizasyon kasası', () => {
  const charac = read('src/__tests__/migrationCharacterization.test.ts');

  it('🔒 karakterizasyon dosyası VARDIR ve üç modülü de kapsar', () => {
    expect(charac.length).toBeGreaterThan(3000);
    for (const m of ['maintenanceBrain', 'fuelAdvisorService', 'smartCardEngine']) {
      expect(charac, `kapsam dışı: ${m}`).toContain(m);
    }
  });

  it('🔒 saf fonksiyonların SAYISAL beklentileri donduruldu', () => {
    // Sözleşme kontrolü tek başına yetmez; sayısal davranış da kilitli olmalı.
    expect(charac).toContain('calcLifetimeWear');
    expect(charac).toContain('calcWearRate');
    expect(charac).toMatch(/toBeCloseTo\(0\.75/);   // ağırlık toplamı kanıtı
  });

  it('🔒 dört girdi sınıfı da temsil edilir', () => {
    for (const k of ['normal girdi', 'sınır değerler', 'eksik', 'çelişkili girdi']) {
      expect(charac, `girdi sınıfı eksik: ${k}`).toContain(k);
    }
  });

  it('🔒 dinamik import KULLANILMAZ (#484 dersi)', () => {
    /* 490+ dosyalık takımda dinamik import + modül sıfırlama deseni rastgele
       zaman aşımına uğruyordu; karakterizasyon kırılgan olmamalı.
       Denetim YALNIZ kod satırlarında yapılır — bir desenin YORUMDA anılması
       onu kullanmak değildir (bu kilit ilk yazımında tam bu yüzden düşmüştü). */
    const codeOnly = charac.split('\n')
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(codeOnly).not.toMatch(/await\s+import\(/);
    expect(codeOnly).not.toMatch(/vi\.resetModules/);
  });

  it('🔒 şüpheli davranışlar DÜZELTİLMEDEN işaretlendi', () => {
    // Karakterizasyonun kuralı: yanlışı da kilitle, notunu düş.
    /* #498 kararı: termik eğri LİNEER kalır (üstele geçmek bir ÖLÇÜM kararıdır,
       tahmin değil) ve yorum gerçeğe hizalandı. İşaret kalkarsa bunun bir yer
       tutucu olduğu unutulur ve "doğrulanmış eğri" sanılır. */
    expect(charac).toContain('YER TUTUCU');
    const brain = read('src/platform/diagnostic/maintenanceBrain.ts');
    expect(brain, 'yorum yeniden "üstel" demeye başlamış — belge/davranış ayrışması')
      .not.toMatch(/üstü üstel artış/);
    expect(brain).toContain('LİNEER');
  });

  it('🔒 üç modül karar omurgasına HENÜZ bağlı değil (göç sırası korunur)', () => {
    for (const p of ['src/platform/diagnostic/maintenanceBrain.ts',
      'src/platform/diagnostic/fuelAdvisorService.ts',
      'src/platform/ai/smartCardEngine.ts']) {
      expect(read(p), `${p} erken bağlanmış — göç sırası bozuldu`)
        .not.toContain('maviReasoningEngine');
    }
  });
});

/* ─────────────────────────────────────────────────────────────────
   S1 (#503) — YENİDEN BAĞLANMADA DESTEK FİLTRESİ FAIL-CLOSED

   Ölçülen kusur (`docs/P1-1_KOK_NEDEN_TESHISI.md` §2/S1): `notifyObdConnected()`
   her reconnect'te `_supported = null` yapıyor AMA izleyicileri bırakmıyor
   (`_clearExtraPidWatches` yalnız `stopOBD`'de koşar). Eski filtre
   `_supported !== null && !_supported.has(pid)` yazdığı için kanıt yokken kapı
   SESSİZCE AÇILIYOR ve 16 (burst'te ≤48) PID filtresiz native'e gidiyordu —
   tam olarak `seedSupportedPids`in önlemek için yazıldığı NO-DATA fırtınası.

   Bu kilit davranışı dondurur: KANIT YOKSA SORGU YOK. Filtre gevşetilirse
   (ör. `_supported !== null &&` deseni geri gelirse) test kırmızı yanar.
   ───────────────────────────────────────────────────────────────── */
describe('S1 · extended destek filtresi reconnect\'te fail-closed', () => {
  beforeEach(() => { extPidInternals.reset(); });
  afterEach(()  => { extPidInternals.reset(); });

  it('🔒 destek kanıtı YOKKEN izlenen PID native listeye GİRMEZ (yalnız keşif gider)', () => {
    watchPid('04', () => {});
    watchPid('33', () => {});
    const list = extPidInternals.buildNativeList();
    expect(list, 'kanıtsız sorgu native\'e gidiyor — NO-DATA fırtınası kapısı açık')
      .toEqual(extPidInternals.getDiscoveryQueue());
    expect(list).not.toContain('04');
    expect(list).not.toContain('33');
  });

  it('🔒 kanıt gelince AYNI izleyiciler akmaya başlar (fail-closed geri dönüşlüdür)', () => {
    watchPid('04', () => {});
    watchPid('33', () => {});
    seedSupportedPids([0x04, 0x33]);
    const list = extPidInternals.buildNativeList();
    expect(list).toContain('04');
    expect(list).toContain('33');
  });

  it('🔒 RECONNECT: izleyiciler yaşar ama kanıt geçersizleşince sorgu DURUR', () => {
    const seen: string[] = [];
    watchPid('04', () => { seen.push('04'); });
    watchPid('33', () => { seen.push('33'); });
    seedSupportedPids([0x04, 0x33]);
    expect(extPidInternals.buildNativeList()).toContain('04');

    // Yeniden bağlanma: `_supported = null` + keşif kuyruğu yeniden kurulur.
    notifyObdConnected();

    const after = extPidInternals.buildNativeList();
    expect(after, 'reconnect\'te filtre sessizce kapandı — 16 PID filtresiz gidiyor')
      .toEqual(extPidInternals.getDiscoveryQueue());
    expect(after).not.toContain('04');
    expect(after).not.toContain('33');

    // İzleyiciler BIRAKILMAZ (sahipleri onları yeniden kurmaz) — kanıt gelince akar.
    seedSupportedPids([0x04, 0x33]);
    expect(extPidInternals.buildNativeList()).toContain('04');
    extPidInternals.onExtendedData({ pid: '04', data: '80' });
    expect(seen, 'reconnect izleyiciyi öldürmüş — panel açıkken sinyal sessizce ölür')
      .toContain('04');
  });

  it('🔒 kaynak deseni: kanıtsız dalda erken çıkış korunur', () => {
    /* Denetim YALNIZ kod satırlarında yapılır — eski gevşek filtrenin YORUMDA
       anılması (neden kaldırıldığını anlatmak için) onu kullanmak değildir (#484 dersi). */
    const codeOnly = read('src/platform/obd/extendedPidService.ts').split('\n')
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(codeOnly, 'fail-closed kapısı kaldırılmış — kanıtsız sorgu yeniden mümkün')
      .toMatch(/if\s*\(_supported\s*!==\s*null\)\s*\{/);
    /* Yalnız `_buildNativeList` gövdesindeki filtre denetlenir (`pid` değişkeni oraya
       özgüdür); `getPidStatus`'taki `_supported !== null && !_supported.has(key)` MEŞRUDUR
       — o bir DURUM sınıflandırmasıdır, sorgu kapısı değil. */
    expect(codeOnly, 'eski gevşek filtre geri gelmiş')
      .not.toMatch(/_supported\s*!==\s*null\s*&&\s*!_supported\.has\(pid\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 22 · VIN MASKELEME TEK OTORİTE (gizlilik kapısı — 2026-08-09)
 *
 * BOZULMA: repoda BEŞ ayrı maskVin vardı ve ÜÇ farklı derinlikte maskeliyordu.
 * İkisi (`vehicleIdentityReport` "•••345678" · `longRoadModel` "…345678") son
 * 6 haneyi — ISO 3779 SERİ NUMARASINI — açık bırakıyordu; aynı fabrikadan iki
 * araç yalnız orada ayrışır, yani maske aracı TEKİLLEŞTİRİYORDU. Üstelik
 * `longRoadModel`'inki `longRoadStore.saveSession` üzerinden KALICI DİSKE
 * yazılıyordu. Kapı üç ayrı yerde ayrı olduğu için biri gevşediğinde hiçbir
 * test bunu görmüyordu.
 *
 * KURAL: tek otorite `platform/privacy/vinMask`; yalnız WMI (ilk 3) açık kalır.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 22 · VIN maskeleme tek otorite', () => {
  const VIN_A = 'VF1KZ0C0X12345678';
  const VIN_B = 'VF1KZ0C0X12345679'; // aynı fabrika, seri +1

  it('🔒 tüm maskeler AYNI çıktıyı verir — derinlik ayrışamaz', async () => {
    const [identity, exp, legal, longRoad] = await Promise.all([
      import('../platform/telemetry/vehicleIdentityReport'),
      import('../platform/validation/validationExport'),
      import('../platform/vehicle/legalVehicleClass'),
      import('../platform/fieldValidation/longRoadModel'),
    ]);
    const outs = [
      identity.maskVin(VIN_A),
      exp.maskVin(VIN_A),
      legal.maskVin(VIN_A),
      longRoad.maskVehicleRef(VIN_A),
    ];
    expect(new Set(outs).size, `maskeler ayrıştı: ${JSON.stringify(outs)}`).toBe(1);
    expect(outs[0]).toBe('VF1**************');
  });

  it('🔒 maske aracı TEKİLLEŞTİRMEZ — komşu iki VIN aynı maskeye düşer', async () => {
    const { maskVinStrict } = await import('../platform/privacy/vinMask');
    expect(
      maskVinStrict(VIN_A),
      'seri numarası maskede sızıyor — maske benzersiz anahtar hâline geldi',
    ).toBe(maskVinStrict(VIN_B));
  });

  it('🔒 WMI dışında hiçbir hane açık kalmaz + idempotent', async () => {
    const { maskVinStrict } = await import('../platform/privacy/vinMask');
    const m = maskVinStrict(VIN_A) as string;
    expect(m.slice(3)).toBe('*'.repeat(14));
    expect(m).not.toContain('…');           // eski legalVehicleClass biçimi
    expect(m).not.toContain('•');           // eski vehicleIdentityReport biçimi
    expect(maskVinStrict(m)).toBe(m);       // ikinci kapıdan geçerken bozulmaz
    expect(maskVinStrict(null)).toBeNull(); // uydurma değer YOK
  });

  it('🔒 hiçbir modül kendi VIN maskesini yeniden ICAT ETMEZ', () => {
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === '__tests__' || e.name === 'node_modules') continue;
          walk(p);
          continue;
        }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (p.split('\\').join('/').endsWith('platform/privacy/vinMask.ts')) continue;
        const lines = readFileSync(p, 'utf8').split('\n')
          .filter((l) => {
            const t = l.trimStart();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
          });
        /* Yerel maske kurma imzası: bir değerin dilimlenip yıldız/nokta ile
           birleştirilmesi. Delege eden sarmalayıcılar `maskVinStrict` çağırdığı
           için bu desene GİRMEZ. */
        const MASK_SHAPES = [
          /\.slice\(\s*0\s*,\s*3\s*\)\s*\+\s*['"`][*•.…]/,
          /['"`][•.…]{1,3}\$\{\s*\w+\.slice\(\s*-\s*\d/,
          /\$\{\s*\w+\.slice\(0,\s*3\)\s*\}\s*[…•]/,
        ];
        /* Kapsayan fonksiyon VIN'e DOKUNUYORSA suçlu sayılır. MAC/anahtar/telefon
           maskeleri aynı şekle sahiptir ama VIN kapısı değildir — onları
           suçlamak kilidi gürültüye boğar ve gerçek ihlali gizler. */
        let fnTouchesVin = false;
        for (const line of lines) {
          if (/^\s*(export\s+)?(async\s+)?function\s|^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(line)) {
            fnTouchesVin = /vin/i.test(line);
          } else if (/vin/i.test(line)) {
            fnTouchesVin = true;
          }
          if (fnTouchesVin && MASK_SHAPES.some((re) => re.test(line))) {
            offenders.push(p.replace(root, 'src'));
            break;
          }
        }
      }
    };
    walk(root);
    expect(
      offenders,
      `VIN maskesi tek otorite DIŞINDA yeniden kurulmuş: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * KİLİT 23 · İKİ OTORİTE — AYNI ADA İKİ ANLAM YASAK (#517)
 *
 * BOZULMA: `connLifecycle.lastPacketAgeMs` ve `ObdHealthMonitor.lastPacketAgeMs`
 * AYNI ada sahipti ama BAŞKA ŞEY ölçüyordu: biri ECU verisi yaşı (ATRV HARİÇ),
 * diğeri kabul edilen HERHANGİ paketin yaşı (ATRV DAHİL). Sahada 44 892 ms vs
 * 2 088 ms görüldü ve "çelişki" sanıldı — çelişki DEĞİLDİ, link canlı ECU susmuştu.
 * İki sayı da DOĞRUYDU; yanlış olan ADLARIYDI. Teşhis o sayılara bakarak yapılıyor:
 * 45 sn mi 2 sn mi olduğu "kanal öldü mü" hükmünü DOĞRUDAN değiştirir.
 *
 * KURAL: aynı anlık görüntüde iki alan aynı adı taşıyıp farklı şey ölçemez.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 23 · iki otorite / aynı ada iki anlam (#517)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 ECU verisi yaşı ile LİNK paketi yaşı AYRI adlarda', () => {
    const obd = src('platform/obdService.ts');
    expect(obd, 'connLifecycle hâlâ belirsiz `lastPacketAgeMs` adını kullanıyor')
      .toMatch(/lastEcuDataAgeMs:\s+_lastRealDataMs/);

    const build = src('platform/devtools/sessionInspectorBuild.ts');
    expect(build).toMatch(/lastEcuDataAgeMs/);
    expect(build).toMatch(/lastLinkPacketAgeMs/);
    /* Aynı dosyada iki alan AYNI adı taşıyamaz. */
    expect(build, 'oturum denetçisinde belirsiz `lastPacketAgeMs` geri gelmiş')
      .not.toMatch(/\blastPacketAgeMs\b/);
  });

  it('🔒 adaptör tanılamada da ayrım korunur (ikinci ekran)', () => {
    const model = src('platform/devtools/adapterDiagnosticsModel.ts');
    expect(model).toMatch(/lastEcuDataAgeMs/);
    expect(model).toMatch(/lastLinkPacketAgeMs/);
    expect(model, 'adaptör tanılamada belirsiz ad geri gelmiş')
      .not.toMatch(/readonly\s+lastPacketAgeMs/);
  });

  it('🔒 ATRV ayrımının GEREKÇESİ koda yazılı (bir daha silinmesin)', () => {
    const obd = src('platform/obdService.ts');
    expect(obd, 'ATRV hariç tutma gerekçesi kaybolmuş').toMatch(/ATRV[\s\S]{0,400}MASKELE/i);
  });

  it('🔒 kaynak canlılığında iki otorite AYRIŞMASI sessiz geçilmez', () => {
    const build = src('platform/devtools/sessionInspectorBuild.ts');
    expect(build, 'ayrışma dedektörü kaldırılmış')
      .toMatch(/_pushSourceAuthorityDivergence/);
    expect(build, 'ayrışma alanı gösterilmiyor').toMatch(/İKİ OTORİTE AYRIŞIYOR/);
    /* Gözlem yüzeyinde otoritenin KİM olduğu yazılı olmalı. */
    expect(build, 'otorite kuralı yazılmamış').toMatch(/OTORİTE sistem görüşüdür/);
  });

  it('🔒 monotonik saatin duvar saati SANILMASI engellenmiş', () => {
    const build = src('platform/devtools/sessionInspectorBuild.ts');
    expect(build).toMatch(/MONOTONİK/);
    expect(build, 'monotonik damgadan bayatlık hesaplanıyor olabilir')
      .toMatch(/bayatlık HESAPLANMAZ/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 24 · ELEME ÇAĞLAYANI (#524)
 *
 * SAHA (2026-08-10): izlenen PID sayısı 10-12'ye çıkıp 6'da sabitleniyordu;
 * hayatta kalanlar yalnız çekirdek PID'lerdi (devir, hız). Üç kök birlikte
 * çalışıyordu — biri tek başına düzeltilirse regresyon üretir:
 *   (1) CAN'de ATST hiç ayarlanmıyordu (ELM varsayılanı ~200 ms)
 *   (2) 3 ardışık NO_DATA → KALICI eleme, bir daha hiç sorulmuyor
 *   (3) ATST uzayınca tur şişer → çekirdek tazeliği risk altına girer
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 24 · PID eleme çağlayanı (#524)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const java = (p: string) =>
    readFileSync(resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro', p), 'utf8');

  it('🔒 ATST CAN protokollerinde de AYARLANIR (eskiden erken dönüyordu)', () => {
    const s = java('obd/ElmInitSequencer.java');
    expect(s, 'CAN_ST_HEX sabiti yok — ATST değeri tek yerde durmuyor')
      .toMatch(/CAN_ST_HEX\s*=\s*"[0-9A-F]{2}"/);
    expect(s, 'CAN dalı ATST göndermiyor').toMatch(/safeSend\("ATST"\s*\+\s*CAN_ST_HEX/);
    /* Yavaş seri protokoller FF'te KALIR — ölçülmüş gerekçesi var (F0-4). */
    expect(s, 'KWP/ISO9141 ATST FF kaldırılmış').toMatch(/ATSTFF/);
  });

  it('🔒 ATST değerinin gerekçesi ve ÖLÇÜLMEDİĞİ kodda yazılı', () => {
    const s = java('obd/ElmInitSequencer.java');
    expect(s, 'ATAT1 tavan gerekçesi silinmiş').toMatch(/TAVANIDIR/);
    expect(s, 'değerin seçilmiş (ölçülmemiş) olduğu gizlenmiş')
      .toMatch(/ÖLÇÜLMEDİ, SEÇİLDİ/);
  });

  it('🔒 bir kez OK dönen PID KALICI ELENMEZ — yalnız duraklatılır', () => {
    const s = java('obd/ExtendedNoDataTracker.java');
    expect(s, 'everOk kaydı yok — kanıtlanmış PID yine kalıcı elenebilir')
      .toMatch(/everOk/);
    expect(s, 'artan aralıklı duraklatma merdiveni yok').toMatch(/PAUSE_LADDER/);
    /* Kalıcı eleme yalnız hiç OK dönmemişler için olmalı. */
    expect(s, 'kalıcı eleme everOk kontrolüne bağlı değil')
      .toMatch(/if \(everOk\.contains\(pid\)\)/);
  });

  it('🔒 stabilizasyon penceresi var — bağlantı sonrası sessizlik kanıt DEĞİL', () => {
    const s = java('obd/ExtendedNoDataTracker.java');
    expect(s).toMatch(/STABILIZE_CYCLES/);
    expect(s, 'stabilizasyon penceresinde eleme kararı veriliyor olabilir')
      .toMatch(/suppressedDuringStabilize/);
  });

  it('🔒 toplu eleme HAT OLAYI sayılır — eleme sıfırlanır ve SAYILIR', () => {
    const s = java('obd/ExtendedNoDataTracker.java');
    expect(s).toMatch(/BULK_MIN_DEMOTES/);
    expect(s, 'hat olayı sayacı yok — sessizce yutuluyor').toMatch(/bulkResetCount/);
  });

  it('🔒 ÇEKİRDEK TAZELİĞİ KORUNUR — hız ve devir HER turda okunur', () => {
    for (const f of ['obd/OBDManager.java', 'obd/BleObdManager.java']) {
      const s = java(f);
      /* 0x0D (hız) ve 0x0C (devir) FAST grupta, hiçbir `pollCycle %` kademesinin
         İÇİNDE olmamalı. Kabul ölçütü: "çekirdek tazeliği bozulmayacak". */
      const fastLine = s.split('\n').find((l) => l.includes('"0D"') && l.includes('POLL_FAST'));
      expect(fastLine, `${f}: hız FAST grupta okunmuyor`).toBeTruthy();
      const rpmLine = s.split('\n').find((l) => l.includes('"0C"') && l.includes('POLL_FAST'));
      expect(rpmLine, `${f}: devir FAST grupta okunmuyor`).toBeTruthy();
      /* Yakıt kendi (çok yavaş) kademesinde olmalı — sıcaklıkla aynı sıklıkta DEĞİL. */
      expect(s, `${f}: yakıt için ayrı kademe yok`).toMatch(/VERY_SLOW_EVERY_N_CYCLES/);
    }
  });

  it('🔒 eleme durumu LAB\'da GÖRÜNÜR (demotedCount tek çağıransız kalmasın)', () => {
    const sources = src('platform/devtools/runtimeSchedulingSources.ts');
    expect(sources, 'eleme durumu snapshot\'a alınmıyor').toMatch(/getExtendedElimination/);
    const build = src('platform/devtools/runtimeSchedulingBuild.ts');
    expect(build, 'eleme alanları üretilmiyor').toMatch(/_pushElimFields/);
    expect(build, 'hat olayı gösterilmiyor').toMatch(/toplu eleme \(hat olayı\)/);
    expect(build, 'stabilizasyon penceresi gösterilmiyor').toMatch(/stabilizasyon penceresi/);
    const screen = src('components/devtools/screens/RuntimeSchedulingScreen.tsx');
    expect(screen, 'ekran eleme durumunu tazelemiyor').toMatch(/refreshExtendedElimination/);
  });

  it('🔒 okunmamış eleme durumu "eleme yok" DİYE SUNULMAZ', () => {
    const mod = src('platform/obd/extendedElimination.ts');
    expect(mod, 'null anlamı belgelenmemiş').toMatch(/OKUNMADI/);
    expect(mod, 'sahte 0 üretiliyor olabilir').toMatch(/Eleme yok" ANLAMINA GELMEZ|ANLAMINA GELMEZ/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 25 · TS TARAFI İKİNCİ ELEME OTORİTESİ (#525)
 *
 * SAHA (2026-08-10, #524 sonrası ilk koşum): native eleme motoru DÜZELDİ
 * (`permanentCount: 0`, `everOkCount: 11/11`) ama AYNI snapshot'ta TS timeline
 * `demoted: 3` diyordu ve kanıt motoru "3 PID araç tarafından verilmiyor:
 * 33, 10, 1C" cümlesini kuruyordu. Üstelik `lastSuccessfulPid` de "33"tü —
 * yani 0x33 hem SON BAŞARILI okuma hem "verilmiyor" listesindeydi.
 *
 * İki kök: (a) `_unavailable` bir kez yazılınca yalnız reset'te temizleniyordu,
 * PID yeniden veri verse bile kayıt kalıcıydı; (b) native'in GEÇİCİ duraklatması
 * TS'e "no_data" diye gidiyor ve KALICI kaydediliyordu.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 25 · TS eleme kaydı gerçek veriyle çelişemez (#525)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const java = (p: string) =>
    readFileSync(resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro', p), 'utf8');

  it('🔒 gerçek değer gelince "verilmiyor" kaydı SİLİNİR', () => {
    const s = src('platform/obd/extendedPidService.ts');
    expect(s, 'deger gelince _unavailable temizlenmiyor — 0x33 celiskisi geri doner')
      .toMatch(/_unavailable\.delete\(pid\)/);
  });

  it('🔒 "artık akmıyor" bilgisi KORUNUR — no_data sırası gevşetilmemiş', () => {
    const s = src('platform/obd/extendedPidService.ts');
    /* Düzeltme sıra DEĞİŞTİRMEK değildi: kayıt bir kez yazılınca hiç
       silinmiyordu. Sırayı gevşetmek "değer var ama artık akmıyor" durumunu
       kaybettirir — o yüzden bu kontrol yerinde kalmalı. */
    expect(s, 'no_data siralamasi gevsetilmis — "artik akmiyor" bilgisi kaybolur')
      .toMatch(/if \(v && !_unavailable\.has\(key\)\)/);
    expect(s, 'sira degistirme girisiminin gerekcesi kaybolmus')
      .toMatch(/ARTIK\s*\n?\s*\*?\s*AKMIYOR/);
  });

  it('🔒 GEÇİCİ duraklatma kalıcı "verilmiyor" listesine YAZILMAZ', () => {
    const s = src('platform/obd/extendedPidService.ts');
    expect(s, 'paused durumu ayirt edilmiyor').toMatch(/status === 'paused'/);
  });

  it('🔒 native KALICI ile GEÇİCİ elemeyi AYRI sebeple bildirir', () => {
    for (const f of ['obd/OBDManager.java', 'obd/BleObdManager.java']) {
      const s = java(f);
      expect(s, `${f}: eleme sebebi ayirt edilmiyor`)
        .toMatch(/isPermanent\(extPid\) \? "no_data" : "paused"/);
    }
    const t = java('obd/ExtendedNoDataTracker.java');
    expect(t, 'isPermanent sorgusu yok').toMatch(/boolean isPermanent\(String pid\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 26 · SNAPSHOT YAŞI ve İLK VERİ SÜRESİ (#526)
 *
 * SAHA (2026-08-10): kopyada `lastPollAt` 5 dk 17 sn bayat görünüyordu ve
 * "extended poll durdu" sanıldı. Poll DURMAMIŞTI — o blok native ÖNBELLEKTEN
 * okunur ve önbelleği yalnız ilgili LAB ekranı açıldığında dolar. `cacheState`
 * "refreshed" diyordu ama bu "bir kez tazelendi" demek; "ŞU AN taze" DEĞİL.
 *
 * Ayrıca kullanıcı "ilk 2 dakika veri yok" diyordu ve bu süre hiçbir yerde
 * ÖLÇÜLMÜYORDU. Trail'den çıkarılan gerçek zincir: +30,1 sn bağlantı zaman
 * aşımı (15 s) → `real → none` → +37,0 sn `none → real`.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 26 · bayat snapshot gizlenemez (#526)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 native sayaç önbellekleri TAZELENME ANINI damgalar', () => {
    const poll = src('platform/obd/extendedPollEvidence.ts');
    expect(poll, 'poll kaniti onbellegi yas damgasi tutmuyor')
      .toMatch(/export function getPollEvidenceRefreshedAt/);
    expect(poll).toMatch(/_refreshedAtMs = Date\.now\(\)/);
    const elim = src('platform/obd/extendedElimination.ts');
    expect(elim, 'eleme onbellegi yas damgasi tutmuyor')
      .toMatch(/export function getExtendedEliminationRefreshedAt/);
  });

  it('🔒 snapshot YAŞI LAB ekranında ve KOPYADA görünür', () => {
    const build = src('platform/devtools/runtimeSchedulingBuild.ts');
    expect(build, 'ekranda snapshot yasi gosterilmiyor').toMatch(/snapshot yaşı/);
    expect(build, 'yas yanlis okunmaya karsi uyarmiyor')
      .toMatch(/poll durdu.*DEMEK DEĞİLDİR|"poll durdu" DEMEK DEĞİLDİR/);
    const copySrc = src('platform/devtools/carosLabCopySources.ts');
    expect(copySrc, 'kopyada snapshot yasi yok').toMatch(/nativeSnapshotAge/);
    const copyModel = src('platform/devtools/carosLabCopyModel.ts');
    expect(copyModel, 'kopya bolumu eklenmemis').toMatch(/NATIVE SAYAÇ SNAPSHOT YAŞI/);
  });

  it('🔒 İLK VERİYE kadar geçen süre ÖLÇÜLÜR (saha "2 dakika" iddiası)', () => {
    const obd = src('platform/obdService.ts');
    expect(obd, 'ilk veri suresi olculmuyor')
      .toMatch(/export function getObdFirstDataTiming/);
    expect(obd, 'dusen deneme sayaci yok').toMatch(/_failedAttemptsBeforeData/);
    /* Sahte 0 yasağı: ölçülemeyen süre null olmalı, 0 değil. */
    expect(obd, 'saat sicramasinda sahte sure uretiliyor olabilir')
      .toMatch(/d >= 0 \? d : null/);
  });

  it('🔒 ilk veri süresi Oturum Denetçisi\'nde GÖRÜNÜR', () => {
    const sources = src('platform/devtools/sessionInspectorSources.ts');
    expect(sources).toMatch(/firstDataTiming/);
    const build = src('platform/devtools/sessionInspectorBuild.ts');
    expect(build, 'alan uretilmiyor').toMatch(/_pushFirstDataTiming/);
    expect(build, 'hala veri yok durumu gosterilmiyor').toMatch(/HÂLÂ VERİ YOK/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 27 · G1 — TEK KONUM KANIT OTORİTESİ (#527)
 *
 * ÖLÇÜLDÜ (2026-08-11): konum KAYNAĞI tekti (`gpsService`) ama fix YAŞI üç ayrı
 * yerde ve İKİ FARKLI SAATLE hesaplanıyordu:
 *   navFieldBridge        → Date.now() - location.timestamp      (DUVAR)
 *   navigationCoreSources → performance.now() - fix.tsMs         (MONOTONİK)
 *   diagnosticSections    → now - loc.timestamp                  (DUVAR)
 * #508 kabul ölçütü (p50<3s ∧ p95<10s) tam da bu sayıya dayanır; sayının tek
 * kaynaklı ve saat-sıçramasına bağışık olması ölçümün GEÇERLİLİK ŞARTIDIR.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 27 · konum kanıt otoritesi (#527)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 tek otorite VAR ve yaş MONOTONİK saatten hesaplanır', () => {
    const s = src('platform/gpsService.ts');
    expect(s, 'getLocationEvidence otoritesi yok').toMatch(/export function getLocationEvidence/);
    expect(s, 'yas monotonik saatten hesaplanmiyor')
      .toMatch(/performance\.now\(\) - _lastFixPerfMs/);
    /* Duvar saati damgası AYRI alanda taşınır ama YAŞ ondan türetilmez. */
    expect(s).toMatch(/observedAtWallMs/);
  });

  it('🔒 tüketiciler fix yaşını YENİDEN HESAPLAMAZ', () => {
    const nav = src('platform/devtools/navFieldBridge.ts');
    expect(nav, 'navFieldBridge hala duvar saatiyle yas hesapliyor')
      .not.toMatch(/Date\.now\(\) - veh\.location\.timestamp/);
    expect(nav).toMatch(/getLocationEvidence\(\)\.fixAgeMs/);
    const diag = src('platform/diagnosticSections.ts');
    expect(diag, 'diagnosticSections hala kendi hesabini yapiyor')
      .not.toMatch(/Math\.max\(0, now - loc\.timestamp\)/);
    expect(diag).toMatch(/getLocationEvidence\(\)\.fixAgeMs/);
  });

  it('🔒 fix YOKKEN "bayat" DENMEZ — yokluk ile bayatlık AYRI', () => {
    const s = src('platform/gpsService.ts');
    /* fixAgeMs null iken stale=false olmalı: fix hiç gelmediyse "bayat" değil
       "yok"tur; ikisini birleştirmek kullanıcıya yanlış sebep gösterir. */
    expect(s).toMatch(/stale:\s*fixAgeMs !== null && fixAgeMs > LOCATION_STALE_MS/);
  });

  it('🔒 bayatlık eşiği isimli sabit (koda gömülü sihirli sayı yok)', () => {
    const s = src('platform/gpsService.ts');
    expect(s).toMatch(/export const LOCATION_STALE_MS/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 28 · G1 açık borçları — harita eşiği + DR canlılık sinyali (#528/#529)
 *
 * ÖLÇÜLDÜ (2026-08-11): aynı "5 saniye" bayatlık eşiği DÖRT yerde ayrı yazılıydı
 * (gpsService · interpolation.DR_CONFIDENT_SEC · navigationSessionRuntime ·
 * FullMapView yerel sabiti). Ayrıca `isDeadReckoningActive()` HER ZAMAN false
 * dönüyordu: `_startDeadReckoning()` boş, `startDeadReckoningGuard()` ürün
 * yolunda hiç çağrılmıyor — oysa DR fiilen navigationSessionRuntime'da çalışıyor.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 28 · harita eşiği + DR sinyali (#528/#529)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 harita KENDİ bayatlık eşiğini taşımaz — otoriteden okur', () => {
    const s = src('components/map/FullMapView.tsx');
    expect(s, 'yerel GPS_STALE_MS sabiti geri gelmis')
      .not.toMatch(/const GPS_STALE_MS\s*=\s*5000/);
    expect(s, 'otorite esigi kullanilmiyor').toMatch(/LOCATION_STALE_MS/);
    expect(s, 'drIsEstimated kendi esigiyle geri gelmis')
      .not.toMatch(/drIsEstimated\(/);
  });

  it('🔒 konum bayatken EKRANDA görünür (ekranda dürüstlük)', () => {
    const s = src('components/map/FullMapView.tsx');
    expect(s, 'bayatlik rozeti yok — marker sessizce animasyonla ilerliyor')
      .toMatch(/data-testid="stale-fix-badge"/);
    /* Yalnız bayatken çizilmeli: normal sürüşte ekran bütçesi (EKRAN-TEK
       BAKIŞTA, ~3 bilgi birimi) etkilenmemeli. */
    expect(s).toMatch(/staleFixSec !== null && \(/);
  });

  it('🔒 DR canlılık sinyali GERÇEK sahibe bağlı', () => {
    const gps = src('platform/gpsService.ts');
    expect(gps, 'disaridan bildirim ucu yok').toMatch(/export function noteDeadReckoningState/);
    expect(gps, 'isDeadReckoningActive hala yalniz olu yerel duruma bakiyor')
      .toMatch(/_drActiveExternal \|\| _dr\?\.active === true/);
    const nav = src('platform/navigation/navigationSessionRuntime.ts');
    expect(nav, 'gercek sahip durumunu bildirmiyor').toMatch(/noteDeadReckoningState\(/);
    expect(nav, 'durum gecisi tek noktadan yonetilmiyor').toMatch(/function _setDrState/);
  });

  it('🔒 yanlış "worker füzyonlanmış konum verir" iddiası koda geri dönmez', () => {
    const gps = src('platform/gpsService.ts');
    /* Ölçüldü: worker'ın giden mesajlarında konum YOK (yalnız GPS_FAILURE).
       Bu iddia DR'ı arayan herkesi yanlış dosyaya gönderiyordu. */
    expect(gps, 'curutulmus iddia geri gelmis')
      .not.toMatch(/Tüm sistem VehicleCompute\.worker\.ts'den gelen füzyonlanmış konumu tüketir/);
    expect(gps, 'duzeltme gerekcesi kaybolmus').toMatch(/ÖLÇÜMLE ÇÜRÜTÜLDÜ/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 29 · saha kopyasının açtığı üç kusur (#531/#532/#533)
 *
 * SAHA (2026-08-11, #526-#529 sonrası ilk koşum):
 *  · firstDataAfterConnectMs = 7 072 352 ms (1 sa 58 dk) — ama 1 sa 53 dk'sı
 *    ARAÇ KAPALIYKEN geçmiş; son denemeden ilk veriye yalnız 6,4 sn.
 *    failedAttemptsBeforeData=1 dedi, trail'de 6 timeout vardı.
 *  · bulkResetCount=2 (native eleme sıfırlandı) ama timeline.demoted=1 kaldı.
 *  · "reconnectPressure": 0.[VIN redacted] — ondalık sayı VIN sanıldı.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 29 · saha kopyası kusurları (#531/#532/#533)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const java = (p: string) =>
    readFileSync(resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro', p), 'utf8');

  it('🔒 #531 ilk-veri süresi İKİ pencereden ölçülür', () => {
    const s = src('platform/obdService.ts');
    expect(s, 'son denemeden olcum yok — arac kapali gecen saatler sureye giriyor')
      .toMatch(/firstDataAfterLastAttemptMs/);
    expect(s).toMatch(/_lastAttemptStartedAtMs = Date\.now\(\)/);
  });

  it('🔒 #531 veri kesilince YENİ TUR başlar (damga sıfırlanır)', () => {
    const s = src('platform/obdService.ts');
    /* Tur sıfırlanmazsa "ilk veriye kadar süre" bir sonraki günü de kapsar. */
    expect(s).toMatch(/_connectAttemptStartedAtMs = 0;\s*\n\s*_firstRealDataAtMs = 0;/);
  });

  it('🔒 #531 RECONNECT yolundaki düşen denemeler de sayılır', () => {
    const s = src('platform/obdService.ts');
    const m = s.match(/logError\('OBD:Reconnect', e\);[\s\S]{0,300}?_failedAttemptsBeforeData\+\+/);
    expect(m, 'reconnect timeout sayaca yansimiyor — 6 timeout "1" gorunuyordu').toBeTruthy();
  });

  it('🔒 #532 hat olayı TS\'e bildirilir ve TS kaydı da sıfırlanır', () => {
    const t = java('obd/ExtendedNoDataTracker.java');
    expect(t, 'hat olayi bildirim bayragi yok').toMatch(/consumeBulkResetPending/);
    for (const f of ['obd/OBDManager.java', 'obd/BleObdManager.java']) {
      expect(java(f), `${f}: hat olayi TS'e bildirilmiyor`).toMatch(/"bulk_reset"/);
    }
    const ts = src('platform/obd/extendedPidService.ts');
    expect(ts, 'TS bulk_reset\'i islemiyor — ikinci otorite geri doner')
      .toMatch(/status === 'bulk_reset'/);
    expect(ts).toMatch(/_unavailable\.clear\(\)/);
  });

  it('🔒 #533 tamamı RAKAM olan dizi VIN sanılmaz (kanıt kaybı yok)', () => {
    const needle = '(?!' + String.fromCharCode(92) + 'd{17}';
    const mask = src('platform/devtools/obdTrafficMask.ts');
    expect(mask, 'ondalik sayi hala VIN sanilabilir').toContain(needle);
    const exp = src('platform/validation/validationExport.ts');
    expect(exp, 'ikinci VIN maskesi hala acik').toContain(needle);
  });

  it('🔒 #533 maske ZAYIFLAMADI — harf içeren VIN yine maskelenir', async () => {
    const { maskCommonSecrets } = await import('../platform/devtools/obdTrafficMask');
    /* Gerçek VIN (harf içerir) → maskelenmeli. */
    expect(maskCommonSecrets('WF0AXXTTRA5R12345')).not.toContain('WF0AXXTTRA5R12345');
    /* Ondalık sayının 17 haneli rakam dizisi → maskelenMEmeli (kanıt korunur). */
    const num = '0.02535071063730359';
    expect(maskCommonSecrets(num)).toContain('02535071063730359');
  });

  /* ── B1 (P0-VDK-FIELD-FIX-A) · #533 İLE AYNI HATA SINIFI, İKİNCİ KAPIDA ────
     SAHA (2026-08-30 · gerçek araç · CAROS LAB TAM KOPYA):
         {"cmd":"0100","resp":"[VIN redacted]"}
     `0100` desteklenen PID bitmap'idir ve `ATH1` açıkken ECU keşfinin TEK
     kanıtıdır. Eski kapı `_compact(resp).includes('4902')` ile çalışıyordu:
     bayat hizası ve servis bağlamı YOK → nibble kaymasıyla eşleşip TÜM yanıtı
     siliyordu. Kilit ÇİFT YÖNLÜDÜR: kanıt korunurken gizlilik ZAYIFLAMAZ. */
  it('🔒 B1 · 0100 bitmap yanıtı VIN sanılıp SİLİNMEZ (kanıt kaybı yok)', async () => {
    const { maskObdTrafficEntry } = await import('../platform/devtools/obdTrafficMask');
    const bitmap = '7E8064100A4902B13';          // hizasız "4902" GERÇEKTEN içerir
    const r = maskObdTrafficEntry('0100', bitmap);
    expect(r.masked, 'bitmap yanıtı VIN sanıldı — ECU keşif kanıtı kayboluyor').toBe(false);
    expect(r.resp).toBe(bitmap);
  });

  it('🔒 B1 · maske ZAYIFLAMADI — gerçek VIN yükü her biçimde gizlenir', async () => {
    const { maskObdTrafficEntry } = await import('../platform/devtools/obdTrafficMask');
    const vinHex = '5746304158585454524135523132333435';
    /* headers OFF tek frame · ISO-TP çok frame · headers ON FF — üçü de. */
    expect(maskObdTrafficEntry('0902', `4902 01 ${vinHex}`).resp).not.toContain(vinHex);
    expect(maskObdTrafficEntry('0902', '0140:4902012020201:202020202020202:20202020202020').resp)
      .not.toContain('202020202020202');
    expect(maskObdTrafficEntry('0902', `7E810144902${vinHex}`).resp).not.toContain(vinHex);
    /* Yapı çözülemezse FAIL-CLOSED: VIN isteğinin hex yanıtı tümüyle gizlenir. */
    expect(maskObdTrafficEntry('0902', '7E8064100BE3FA813').masked).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 30 · ÖLÇÜM YAZILDI AMA DIŞARI ÇIKARILAMADI (#535)
 *
 * SAHA (2026-08-11): gerçek araçta koşum yapıldı, ama kopyada NE `fixAgeMs`
 * (#508'in dayandığı sayı) NE ETA sıçrama defteri (#530) vardı → yolculuk
 * ölçüm üretemedi. #523'te H-A deneyi için düzeltilen kusurun BİREBİR AYNISI.
 * Ayrıca `firstDataAt: null` geldi — OBD bağlı ve veri akarken: #531'in tur
 * sıfırlaması damgayı temizledi, yeniden set yolu YOKTU.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 30 · navigasyon ölçümü kopyaya girer (#535)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 fixAgeMs (#508) ve ETA defteri (#530) KOPYA çıktısında yer alır', () => {
    const sources = src('platform/devtools/carosLabCopySources.ts');
    expect(sources, 'nav olcumu kopyaya beslenmiyor').toMatch(/readNavigationCoreSnapshot/);
    expect(sources, 'ETA defteri kopyaya beslenmiyor').toMatch(/getEtaJumpLedger/);
    expect(sources).toMatch(/fixAgeMs:\s*n\.fixAgeMs/);
    const model = src('platform/devtools/carosLabCopyModel.ts');
    expect(model, 'nav bolumu yok').toMatch(/NAVİGASYON ÇEKİRDEĞİ/);
    expect(model, 'ETA defteri bolumu yok').toMatch(/ETA SIÇRAMA DEFTERİ/);
  });

  it('🔒 ilk veri damgası data gate\'ten BAĞIMSIZ yazılır', () => {
    const s = src('platform/obdService.ts');
    /* Damga yalnız `_dataGatePassed` ilk açılışında yazılıyordu; tur sıfırlaması
       sonrası gate zaten açık olduğu için bir daha ASLA yazılmıyordu. */
    const m = s.match(/_lastRealDataMs = _rxNow;[\s\S]{0,700}?_firstRealDataAtMs === 0/);
    expect(m, 'ilk veri damgasi hala yalniz data gate icinde yaziliyor').toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 31 · GÖREV A — KOPMA KÖKÜ ÖLÇÜLMEDEN DÜZELTİLMEZ (#536)
 *
 * SAHA (2026-08-11): 8 timeout · LinkLost 47 s · quality %57 · baskı 1.71.
 * Dört kök neden adayı (adaptör · RFCOMM soketi · ELM init · ECU uykusu) AYNI
 * `timeout` sayısını üretiyor → mevcut `reconnectHistory` kökü AYIRT EDEMEZ.
 * Devir §5: "Kör düzeltme YASAK — önce ölçüm." Bu kilitler ölçüm yolunun
 * varlığını VE defterin karar üretmediğini sabitler.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 31 · kopma kanıt defteri (#536)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 defter SAF: I/O · timer · Date.now · React YOK', () => {
    const s = src('platform/obd/linkLossLedger.ts');
    expect(s, 'saf model saat okuyor').not.toMatch(/Date\.now\(\)/);
    expect(s, 'saf model timer kuruyor').not.toMatch(/setInterval|setTimeout/);
    expect(s, 'saf model servis import ediyor').not.toMatch(/^import .*from '\.\.\//m);
  });

  it('🔒 kopma anındaki ÜÇ kanıt da toplanır (voltaj · link yaşı · ECU yaşı)', () => {
    const s = src('platform/obdService.ts');
    expect(s, 'kopma kanit toplayicisi yok').toMatch(/function _noteLinkLoss/);
    expect(s, 'link paketi yasi kanit olarak gecmiyor').toMatch(/linkPacketAgeMs: _lastRxAt > 0/);
    expect(s, 'ECU veri yasi kanit olarak gecmiyor').toMatch(/ecuDataAgeMs:\s+_lastRealDataMs > 0/);
    /* ATRV okunmadıysa `null` — sahte 0 V "ölçülmedi" demek olurdu. */
    expect(s, 'sahte 0 V uretiliyor olabilir').toMatch(/Number\.isFinite\(v\) && v > 0 \? v : null/);
  });

  it('🔒 gerçek kopma · ECU susması · kurtarma AYRI AYRI kaydedilir', () => {
    const s = src('platform/obdService.ts');
    expect(s, 'watchdog link olumu defterlenmiyor').toMatch(/_noteLinkLoss\('LINK_DEAD_WATCHDOG'/);
    /* ECU susması bir KOPMA DEĞİLDİR; aynı kovaya atılırsa adaptör haksız suçlanır. */
    expect(s, 'ECU susmasi ayri kaydedilmiyor').toMatch(/_noteLinkLoss\('ECU_SILENT_WATCHDOG'/);
    expect(s, 'kurtarma imzasi islenmiyor').toMatch(/function _noteLinkRecovered/);
    const m = s.match(/_lastHandshakeSuccessAt = Date\.now\(\);[\s\S]{0,400}?_noteLinkRecovered\(\)/);
    expect(m, 'kurtarma basarili handshake anina bagli degil').toBeTruthy();
  });

  it('🔒 timeout AŞAMASI defterle aynı çağrıda geçer', () => {
    const s = src('platform/obdService.ts');
    /* Aşama `_handshakeDiag` yazılmadan önce okunursa defter her zaman null görür
       ve `TIMEOUT_STAGE` boşluğu SAHTE olarak birikir. */
    expect(s, 'asama kanidi recordReconnect\'e gecmiyor')
      .toMatch(/function _recordReconnect\(reason: ReconnectReason, timeoutStage/);
    expect(s).toMatch(/timedOut \? 'connect' : null,?\s*\)?;?\s*(\/\/.*)?$/m);
  });

  it('🔒 defter KARAR ÜRETMEZ (hüküm motoruna girdi olmaz)', () => {
    /* Aktif sözleşme: "defterler karar üretmez". Adaptör hükmü (`deriveAdVerdict`)
       kopma defterini OKUMAMALI — aksi halde gözlem sessizce karara dönüşür. */
    const model = src('platform/devtools/adapterDiagnosticsModel.ts');
    const verdict = model.slice(model.indexOf('export function deriveAdVerdict'));
    expect(verdict, 'kopma defteri hukum uretiyor').not.toMatch(/linkLoss/);
    /* Ve ürün yolunda reconnect/eşik tetikleyen bir kullanımı olmamalı. */
    const svc = src('platform/obdService.ts');
    expect(svc, 'defter reconnect tetikliyor')
      .not.toMatch(/summarizeLinkLosses\([\s\S]{0,200}?_scheduleReconnect/);
  });

  it('🔒 ölçüm AYNI turda kopyaya ve LAB ekranına çıkar (#535 dersi)', () => {
    const sources = src('platform/devtools/carosLabCopySources.ts');
    expect(sources, 'kopma defteri kopyaya beslenmiyor').toMatch(/getLinkLossLedger/);
    const model = src('platform/devtools/carosLabCopyModel.ts');
    expect(model, 'kopya bolumu yok').toMatch(/KOPMA KANIT DEFTERİ/);
    const adSrc = src('platform/devtools/adapterDiagnosticsSources.ts');
    expect(adSrc, 'LAB ekrani defteri okumuyor').toMatch(/getLinkLossLedger/);
    const adModel = src('platform/devtools/adapterDiagnosticsModel.ts');
    expect(adModel, 'LAB bolumu yok').toMatch(/Kopma Kanıtı/);
    /* Eksik kanıt listesi GÖRÜNÜR olmalı: GÖREV A'nın iş listesi budur. */
    expect(adModel, 'eksik kanit gosterilmiyor').toMatch(/önce ölçülmesi gereken/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 32 · GÖREV B — #508 TEK ÖRNEKLE KAPANMAZ (#537)
 *
 * SAHA (2026-08-11): kopyada `fixAgeMs: 5237` — TEK anlık örnek. #508 ölçütü
 * `p50<3s ∧ p95<10s` DAĞILIMI ister. Eski taban p50 19,5 s; 5,2 s daha iyi
 * GÖRÜNÜYOR ama tek örnekten p50 çıkmaz. Ayrıca kopyadaki o sayı map-match
 * fix'inin yaşıydı — G1 otoritesinin (#527) sayısı DEĞİL.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 32 · fix yaşı dağılım defteri (#537)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  /** Yorumları düşürür — saflık kilidi KODU sınar, açıklama metnini değil. */
  const codeOnly = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  it('🔒 dağılım hesabı SAF modelde (I/O · timer · saat YOK)', () => {
    const s = codeOnly(src('platform/navigation/core/fixAgeLedger.ts'));
    expect(s, 'saf model saat okuyor').not.toMatch(/Date\.now\(\)|performance\.now\(\)/);
    expect(s, 'saf model timer kuruyor').not.toMatch(/setInterval|setTimeout/);
    expect(s, 'p50 hesabi yok').toMatch(/export function summarizeFixAge/);
  });

  it('🔒 örnek TEK OTORİTENİN okuma noktasında alınır — YENİ TIMER YOK', () => {
    const s = src('platform/gpsService.ts');
    const fn = s.slice(s.indexOf('export function getLocationEvidence'));
    expect(fn, 'olcum tuketici okumasinda alinmiyor').toMatch(/appendFixAge\(_fixAgeRing/);
    /* Zero-Leak: defter için yeni bir interval/timeout KURULMADI. */
    const before = (s.match(/setInterval\(/g) ?? []).length;
    expect(before, 'defter icin yeni timer eklenmis olabilir').toBeLessThanOrEqual(1);
  });

  it('🔒 okuma ucu ÖRNEK ALMAZ (gözlem ölçtüğünü bozmaz)', () => {
    const s = src('platform/gpsService.ts');
    const fn = s.slice(s.indexOf('export function getFixAgeLedger'), s.indexOf('_resetFixAgeLedgerForTest'));
    expect(fn, 'okuma ucu defteri kirletiyor').not.toMatch(/appendFixAge/);
  });

  it('🔒 eşik ÇAĞIRANDAN gelir — saf model ikinci eşik otoritesi kurmaz', () => {
    const led = src('platform/navigation/core/fixAgeLedger.ts');
    expect(led, 'saf modelde gomulu bayatlik esigi var').not.toMatch(/LOCATION_STALE_MS\s*=/);
    expect(led).toMatch(/staleThresholdMs: number/);
    const gps = src('platform/gpsService.ts');
    expect(gps, 'esik otoriteden gecirilmiyor').toMatch(/summarizeFixAge\(_fixAgeRing, LOCATION_STALE_MS\)/);
  });

  it('🔒 AZ örnekte hüküm VERİLMEZ ve üçüncü ölçüt ÖLÇÜLMEDİ diye beyan edilir', () => {
    const s = src('platform/navigation/core/fixAgeLedger.ts');
    expect(s, 'yetersiz ornek hukmu yok').toMatch(/INSUFFICIENT_SAMPLES/);
    expect(s, 'en az ornek esigi isimli sabit degil').toMatch(/export const FIX_AGE_MIN_SAMPLES/);
    /* #508'in üçüncü ölçütü (iz/gerçek yol) bu defterde ölçülmez — gizlenmez. */
    expect(s, 'olculmeyen olcut gizleniyor').toMatch(/trackRatioMeasured: false/);
  });

  it('🔒 #508\'in sayısı G1 OTORİTESİNDEN gelir ve kopyada AYRI bölümdedir', () => {
    const nav = src('platform/devtools/navigationCoreSources.ts');
    expect(nav, '#508 sayisi otoriteden okunmuyor')
      .toMatch(/locationFixAgeMs: _safe\(\(\) => getLocationEvidence\(\)\.fixAgeMs/);
    /* Map-match fix yaşı ile karıştırılmaması AÇIKÇA yazılı olmalı. */
    expect(nav, 'iki ayri yas olgusu ayirt edilmiyor').toMatch(/#508'İN DAYANDIĞI SAYI BU DEĞİLDİR/);
    const sources = src('platform/devtools/carosLabCopySources.ts');
    expect(sources, 'dagilim kopyaya beslenmiyor').toMatch(/getFixAgeLedger/);
    expect(sources, 'otorite sayisi kopyada yok').toMatch(/konumFixYasMs:\s*n\.locationFixAgeMs/);
    const model = src('platform/devtools/carosLabCopyModel.ts');
    expect(model, 'dagilim bolumu yok').toMatch(/KONUM FIX YAŞI DAĞILIMI/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 33 · GÖREV C — G3 SIÇRAMASININ KÖKÜ KAPATILDI (#538)
 *
 * ÖLÇÜLDÜ (2026-08-11, gerçek araç): `SPEED_GATE_CHANGED` 4/6 = %67 baskın;
 * dört geçişin HEPSİ `factor 1 ↔ 1.5` ve aritmetik beklentiyle 0-8 s içinde
 * uyumlu. Mesafe kaynağı SUÇSUZ (`DISTANCE_SOURCE_CHANGED` = 0). Düzeltme:
 * kapı anahtar değil RAMPA → eşikte sürekli → %50 zıplama imkânsız.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 33 · ETA hız kapısı rampası (#538)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 rampa VAR, isimli sabitle ve SAF (zamana bağlı durum yok)', () => {
    const s = src('platform/navigation/core/etaModel.ts');
    expect(s, 'rampa fonksiyonu yok').toMatch(/export function etaSpeedGateWeight/);
    expect(s, 'bant genisligi isimli sabit degil').toMatch(/export const ETA_GATE_RAMP_KMH/);
    expect(s, 'etaModel saat okuyor (saflik bozuldu)').not.toMatch(/Date\.now\(\)|performance\.now\(\)/);
    /* Çarpan ağırlıkla uygulanmalı — aksi halde eşikte yine ANİ atlar. */
    expect(s, 'agirlikli uygulama yok').toMatch(/factor = 1 \+ \(rawFactor - 1\) \* gateWeight/);
  });

  it('🔒 ham çarpan GÖZLEMLENEBİLİR kalır (kanıt kaybı yok)', () => {
    const s = src('platform/navigation/core/etaModel.ts');
    expect(s).toMatch(/correctionFactorRaw/);
    expect(s).toMatch(/speedGateWeight/);
  });

  it('🔒 8 km/h eşiği TEK yerde yazılı (defter etaModel\'den okur)', () => {
    const led = src('platform/navigation/core/etaJumpLedger.ts');
    expect(led, 'defterde gomulu 8 esigi geri gelmis')
      .not.toMatch(/rollingAvgKmh >= 8\)/);
    expect(led, 'esik otoriteden alinmiyor').toMatch(/ETA_MIN_CORRECTION_KMH/);
  });

  it('🔒 defter BANT İÇİ harekete kör DEĞİL (doğrulamanın geçerlilik şartı)', () => {
    /* Rampadan sonra çarpan bant içinde de oynar. Yalnız eşik geçişine bakan bir
       dedektör "SPEED_GATE_CHANGED düştü" diye YANILTICI bir başarı raporlardı. */
    const led = src('platform/navigation/core/etaJumpLedger.ts');
    expect(led, 'bant farkindaligi yok').toMatch(/etaSpeedGateWeight\(next\.rollingAvgKmh\)/);
    expect(led, 'esik isimli sabit degil').toMatch(/export const ETA_GATE_WEIGHT_MIN_DELTA/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 24 · ADRES ARAMA KANIT DEFTERİ (teşhis turu 2026-08-11)
 *
 * Kullanıcı sahada "adreslerin ~%40'ı bulunamıyor" dedi; ölçüm denendiğinde
 * ürünün hiçbir arama denemesini KAYDETMEDİĞİ ortaya çıktı — şikâyetin sebebi
 * ölçülemiyordu. Defter o boşluğu kapatır. Aşağıdaki kilitler defterin
 * DÜRÜSTLÜK ve GİZLİLİK sözleşmesini korur; bunlar zayıflatılamaz.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 24 · adres arama kanıt defteri', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 defter API\'si SORGU METNİ kabul etmez (adres = PII)', () => {
    /* Store yalnız `AddressQueryShape` alır. Ham metin parametresi eklenirse
       ev adresi LAB'a ve kayıtlara sızabilir — kural 6 ihlali. */
    const store = src('platform/geo/addressSearchLedgerStore.ts');
    expect(store, 'store ham sorgu metni almaya başlamış')
      .not.toMatch(/\b(query|rawQuery|destination|address)\s*:\s*string/);
    expect(store).toMatch(/AddressQueryShape|AddressSearchInput/);
  });

  it('🔒 sorgu biçimi metnin parçasını TAŞIMAZ (yalnız bayrak/sayı)', () => {
    const led = src('platform/geo/addressSearchLedger.ts');
    /* `AddressQueryShape` alanları boolean/number/enum olmalı; serbest metin
       alanı (ör. `text: string`) eklenmesi gizlilik sözleşmesini bozar. */
    const shapeBlock = led.slice(
      led.indexOf('export interface AddressQueryShape'),
      led.indexOf('const _ABBREV_RE'),
    );
    expect(shapeBlock.length).toBeGreaterThan(100);
    expect(shapeBlock, 'biçim tanımına serbest metin alanı eklenmiş')
      .not.toMatch(/readonly\s+\w+\s*:\s*string\s*;/);
  });

  it('🔒 defter DİSKE yazmaz (oturum sonunda kanıt gider — gizlilik lehine)', () => {
    const store = src('platform/geo/addressSearchLedgerStore.ts');
    expect(store).not.toMatch(/localStorage|safeSetRaw|indexedDB|sessionStorage/);
  });

  it('🔒 karara bağlanmış deneme yokken oran ÜRETİLMEZ (sahte %0 yasak)', () => {
    const led = src('platform/geo/addressSearchLedger.ts');
    expect(led, 'failureRate koşulsuz sayıya döndürülmüş')
      .toMatch(/failureRate:\s*decided > 0\s*\?/);
  });

  it('🔒 UNKNOWN ve NONE baskın sebep yarışına GİRMEZ', () => {
    /* UNKNOWN kanıt yokluğu, NONE başarıdır; ikisi de "kök neden" olamaz. */
    const led = src('platform/geo/addressSearchLedger.ts');
    expect(led).toMatch(/filter\(\(k\) => k !== 'NONE' && k !== 'UNKNOWN'\)/);
  });

  it('🔒 yargılanmamış (SUPERSEDED) deneme başarısızlık SAYILMAZ', () => {
    /* Debounce'lu arama çubuğu tek niyet için 6-8 deneme üretir; bunlar
       başarısızlık sayılsaydı oran UYDURMA çıkardı. */
    const led = src('platform/geo/addressSearchLedger.ts');
    expect(led).toMatch(/else if \(r\.outcome === 'SUPERSEDED'\) supersededCount/);
  });

  it('🔒 kayıt yolu ürünü DÜŞÜREMEZ (her giriş try/catch)', () => {
    const store = src('platform/geo/addressSearchLedgerStore.ts');
    for (const fn of ['recordAddressSearch', 'noteAddressSearchChoice']) {
      const body = store.slice(store.indexOf(`export function ${fn}`));
      expect(body.slice(0, 600), `${fn} fail-soft değil`).toMatch(/try \{/);
    }
  });

  it('🔒 geocodeAddress izini MODÜL DEĞİŞKENİNDE tutmaz (eşzamanlı arama yarışı)', () => {
    /* "Son çağrı" değişkeni iki yüzey aynı anda ararken izi EZER. WeakMap
       anahtarı dönüş dizisi olduğu için yarış YOKTUR. */
    const geo = src('platform/geocodingService.ts');
    expect(geo).toMatch(/new WeakMap<object, GeocodeTrace>/);
    expect(geo, 'iz modül düzeyinde tek değişkene alınmış')
      .not.toMatch(/let _lastTrace/);
  });

  it('🔒 iki arama yüzeyi de deftere yazar (ayrışma görünür kalsın)', () => {
    /* Ölçüm 2026-08-11: 30 sorgunun 8'inde harita çubuğu ile adres zinciri
       FARKLI sonuç verdi. Tek yüzey kaydedilirse bu ayrışma körleşir. */
    expect(src('platform/mapService.ts')).toMatch(/recordAddressSearch\(/);
    expect(src('platform/addressNavigationEngine.ts')).toMatch(/recordAddressSearch\(/);
  });

  it('🔒 kullanıcı SEÇİMİ kaydedilir — "sonuç döndü" çözüldü SAYILMAZ', () => {
    expect(src('platform/addressNavigationEngine.ts')).toMatch(/noteAddressSearchChoice\(true\)/);
    expect(src('components/map/MapSearchBar.tsx')).toMatch(/noteAddressSearchChoice\(true\)/);
  });

  it('🔒 LAB ekranı SALT OKUNUR — arama tetiklemez', () => {
    const screen = src('components/devtools/screens/AddressSearchEvidenceScreen.tsx');
    for (const forbidden of ['geocodeAddress', 'searchPlaces', 'resolveAndNavigate', 'startNavigation']) {
      expect(screen, `LAB ekranı ${forbidden} çağırıyor — gözlem yüzeyi komut göndermez`)
        .not.toContain(forbidden);
    }
    /* Zamanlayıcı/abonelik yok: açılışta tek okuma + elle YENİLE. */
    expect(screen).not.toMatch(/setInterval|setTimeout/);
    expect(screen).toMatch(/mountedRef/);
  });

  it('🔒 LAB kataloğunda kayıtlı ve ekran haritasına bağlı', () => {
    expect(src('platform/devtools/carosLabCatalog.ts')).toMatch(/id: 'address-search-evidence'/);
    expect(src('components/devtools/carosLabScreenMap.tsx'))
      .toMatch(/case 'address-search-evidence':/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 25 · SOKAK GÖVDESİ SONDAN YAKALANIR (#546 · #544'ün düzeltmesi)
 *
 * ÖLÇÜLDÜ (2026-08-11): gövde sorgunun BAŞINDAN yakalanıyordu → il/mahalle adı
 * Overpass regexine giriyor ve OSM adıyla ASLA eşleşmiyordu. #336'da "son şans"
 * diye kurulan katman adlı yollarda YAPISAL OLARAK ÖLÜYDÜ. Yan yana ölçüm:
 * ürün regexi YOK / öneksiz kontrol VAR (3/3). Bu kilitler o kusurun geri
 * dönüşünü engeller.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 25 · sokak gövdesi sondan yakalanır', () => {
  it('🔒 il ve mahalle adı regexe SIZMAZ', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    const r = extractStreetQuery('Mersin Yenişehir Mahallesi Kuvayimilliye Caddesi')!;
    expect(r, 'sorgu çözümlenemedi').not.toBeNull();
    /* Ölçülen kusurun imzası: idari önek regexin içinde. */
    expect(r.nameRegex, 'il adı regexe sızdı').not.toMatch(/M ?e ?r ?s ?i ?n/);
    expect(r.nameRegex, 'mahalle sözcüğü regexe sızdı').not.toMatch(/M ?a ?h ?a ?l ?l ?e/);
    expect(r.candidates).toEqual(['kuvayimilliye']);
  });

  it('🔒 `cd` kısaltması CADDE\'ye eşlenir (Sokak DEĞİL)', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    for (const q of ['Mersin Yenişehir mah. Kuvayimilliye cd.', 'Nalçacı cd']) {
      const r = extractStreetQuery(q)!;
      expect(r, q).not.toBeNull();
      expect(r.nameRegex, `${q} → yol tipi yanlış`).toMatch(/\) \?Cadde/);
      expect(r.nameRegex, `${q} → Sokak sanıldı`).not.toMatch(/\) \?Sokak/);
    }
  });

  it('🔒 gövde adayları UZUNDAN KISAYA ve en fazla 3 sözcük', async () => {
    const { extractStreetQuery, STREET_NAME_MAX_TOKENS } =
      await import('../platform/streetSearchService');
    const r = extractStreetQuery('Mersin Pozcu Gazi Mustafa Kemal Bulvarı')!;
    expect(r.candidates).toEqual(['gazimustafakemal', 'mustafakemal', 'kemal']);
    expect(r.candidates.length).toBeLessThanOrEqual(STREET_NAME_MAX_TOKENS);
    /* Uzun olan ÖNCE gelmeli — ayırt edicilik sıralaması buna dayanır. */
    expect(r.candidates[0].length).toBeGreaterThan(r.candidates[r.candidates.length - 1].length);
  });

  it('🔒 NUMARALI yol davranışı BOZULMADI (uydurma yasağı)', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    /* 0469 OSM'de VAR, 0455 YOK — desen ikisini de AYNI biçimde üretmeli;
       "bulunamadı" cevabı korunur, yakın numaraya kaydırılmaz. */
    expect(extractStreetQuery('Tarsus Bağlar Mahallesi 0469 Sokak')!.nameRegex)
      .toBe(String.raw`^0*469\.? ?Sokak.*$`);
    expect(extractStreetQuery('Tarsus Bağlar Mahallesi 0455 Sokak')!.nameRegex)
      .toBe(String.raw`^0*455\.? ?Sokak.*$`);
    /* Numaralı yolda aday listesi BOŞ olmalı — gevşetme oraya bulaşmasın. */
    expect(extractStreetQuery('Bağlar mh 469 sk')!.candidates).toEqual([]);
  });

  it('🔒 kısa/ayırt edici olmayan gövde REDDEDİLİR', async () => {
    const { extractStreetQuery } = await import('../platform/streetSearchService');
    /* 3 harften kısa gövde yanlış sokağa götürebilir → aday olmaz. */
    expect(extractStreetQuery('Ak Sokak')).toBeNull();
    expect(extractStreetQuery('Caddesi')).toBeNull();
  });

  it('🔒 kısa adayla eşleşen sonuç `relaxed` işaretlenir (onay istenir)', () => {
    /* "Gazi Mustafa Kemal Bulvarı" ararken "Namık Kemal Bulvarı" da 1 sözcüklük
       adayı karşılar. İkisini AYNI güvenle sunmak yanlış yere götürmek olur;
       kısa eşleşme mevcut #334/#335 onay mekanizmasına düşer. */
    const src = readFileSync(resolve(__dirname, '..', 'platform/streetSearchService.ts'), 'utf8');
    expect(src, 'ayırt edicilik sıralaması yok').toContain('_candidateRank');
    expect(src, 'kısa eşleşme relaxed işaretlenmiyor').toMatch(/rank > 0 \? \{ relaxed: true \}/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 26 · KONUM/ŞEHİR KAPISI (belirsizlik çözümü · 2026-08-12)
 *
 * CANLI ÖLÇÜM (Tarsus 36.9175/34.8621, ürünün gerçek istek kurulumu):
 *   · "Cumhuriyet Mahallesi"        → sunulan ilk aday Adana (43 km);
 *                                     3 km'deki Tarsus adayı ÜÇÜNCÜ sıradaydı.
 *   · "Bağlar Mahallesi" (viewbox'sız yüzey) → ilk aday Siverek 405 km.
 *   · "İstanbul Bağlar Mahallesi"   → ilk aday Tarsus'ta bir OKUL (0 km);
 *                                     istenen İstanbul adayı ikinci sıradaydı.
 * Kök tek: mesafe hiçbir yerde karar değişkeni DEĞİLDİ.
 *
 * KURAL: şehir belirtilmemişse EN YAKIN öncelikli · şehir belirtilmişse O
 * ŞEHİR kesin (mesafeye göre REDDEDİLMEZ). Bu kilitler o sözleşmeyi korur.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 26 · konum/şehir kapısı', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 kapı SAFTIR — I/O · timer · Date.now · global durum YOK', () => {
    const gate = src('platform/geo/locationBiasGate.ts');
    /* Saflık sözleşmesi: cihazsız test edilebilirlik ve hot-path güvenliği
       buna dayanır (kapı her arama sonucunda çalışır). */
    expect(gate, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(gate, 'zaman okuma').not.toMatch(/Date\.now\s*\(/);
    expect(gate, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(gate, 'kalıcı depolama').not.toMatch(/localStorage|indexedDB/);
    expect(gate, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 şehir belirtilmişse mesafe kapısı KAPALIDIR', async () => {
    const { applyLocationBias } = await import('../platform/geo/locationBiasGate');
    /* Biri Tarsus'tayken "İstanbul …" arıyorsa oraya GİDECEĞİ için arıyordur —
       693 km diye reddetmek ürünü kırar. Bu kilit gevşetilemez. */
    const r = applyLocationBias('İstanbul Bağlar Mahallesi', [{
      lat: 41.0228866, lng: 28.8248289,
      fullName: 'Bağlar Mahallesi, Bağcılar, İstanbul, Marmara Bölgesi, 34212, Türkiye',
    }], { lat: 36.9175, lng: 34.8621 });
    expect(r.mode).toBe('CITY_SCOPED');
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].farFromUser, 'uzak diye onaya düşürüldü').toBe(false);
    expect(r.droppedFar).toBe(0);
  });

  it('🔒 şehir belirtilmişse YANLIŞ şehirdeki aday sunulmaz', async () => {
    const { applyLocationBias } = await import('../platform/geo/locationBiasGate');
    /* Ölçülen kusur: 0 km'deki Tarsus okulu "İstanbul …" sorgusunun BİRİNCİ
       adayıydı. Yakınlık, açıkça istenen şehri EZEMEZ. */
    const r = applyLocationBias('İstanbul Bağlar Mahallesi', [{
      lat: 36.9207682, lng: 34.8628651,
      fullName: 'Tarsus Borsa İstanbul Mesleki ve Teknik Anadolu Lisesi, 15, Şamil Basayev Caddesi, Bağlar Mahallesi, Tarsus, Mersin, Akdeniz Bölgesi, 33400, Türkiye',
    }], { lat: 36.9175, lng: 34.8621 });
    expect(r.kept).toHaveLength(0);
    expect(r.droppedWrongCity).toBe(1);
  });

  it('🔒 şehirsiz sorguda EN YAKIN aday BAŞA gelir', async () => {
    const { applyLocationBias } = await import('../platform/geo/locationBiasGate');
    const r = applyLocationBias('Cumhuriyet Mahallesi', [
      { lat: 36.9838183, lng: 35.3426633, fullName: 'Cumhuriyet Mahallesi, Yüreğir, Adana, Akdeniz Bölgesi, 01280, Türkiye' },
      { lat: 36.9150002, lng: 34.9010268, fullName: 'Cumhuriyet Mahallesi, Tarsus, Mersin, Akdeniz Bölgesi, Türkiye' },
    ], { lat: 36.9175, lng: 34.8621 });
    expect(r.mode).toBe('PROXIMITY');
    expect(r.kept[0].item.fullName, 'en yakın başa gelmedi').toContain('Tarsus');
    expect(r.kept, 'meşru komşu il adayı elendi').toHaveLength(2);
  });

  it('🔒 KANITSIZ eleme YASAK — il bilgisi taşımayan aday korunur', async () => {
    const { applyLocationBias } = await import('../platform/geo/locationBiasGate');
    /* Overpass yalın sokak adı döner ("0469. Sokak"); hangi ilde olduğu
       BİLİNMEZ. "Bilmiyoruz" ≠ "yanlış" — eleme KANIT ister. */
    const r = applyLocationBias('Mersin Tarsus 0469 Sokak',
      [{ lat: 36.9184146, lng: 34.8637155, fullName: '0469. Sokak' }],
      { lat: 36.9175, lng: 34.8621 });
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].cityEvidence).toBe('UNKNOWN');
    expect(r.droppedWrongCity).toBe(0);
  });

  it('🔒 il adı YER ADININ parçasıysa şehir bildirimi sayılmaz', async () => {
    const { detectCitiesInQuery } = await import('../platform/geo/locationBiasGate');
    /* "Ankara Caddesi" Adana'da bir caddedir; burada en-yakın kuralı geçerli
       kalmalı, yoksa Adana'daki cadde Ankara'da aranırdı. */
    expect(detectCitiesInQuery('Ankara Caddesi')).toEqual([]);
    expect(detectCitiesInQuery('Ankara Kızılay Atatürk Bulvarı')).toEqual(['ankara']);
  });

  it('🔒 kapı HER katmanda çalışır (bir katman kaçamaz)', () => {
    const geo = src('platform/geocodingService.ts');
    /* Katmanların kendi kuralı olması bu projenin tekrar eden kökü —
       premium · Nominatim · gevşetilmiş · Overpass · çevrimdışı, hepsi. */
    /* P0-NAV-08: premium ve sokak katmanları artık HAM sonucu ayrı bir
       değişkene alıyor (sağlayıcı sicilinin ham sayıyı ölçebilmesi için).
       Kilit ZAYIFLAMAZ, GÜÇLENİR: hem ham okuma hem de o hamın kapıdan
       geçtiği AYRI AYRI kanıtlanır — arada kapısız bir yol kalamaz. */
    expect(geo).toMatch(/const premiumRaw = await premiumGeocode/);
    expect(geo).toMatch(/const premium = gate\(premiumRaw\)/);
    expect(geo).toContain('gate(firstOk)');
    expect(geo).toMatch(/gate\(ok\.map/);
    expect(geo).toMatch(/const streetsRaw = await searchStreetByName/);
    expect(geo).toMatch(/const streets = gate\(streetsRaw\)/);
    expect(geo).toMatch(/gate\(await _offlineFallback/);
    /* Kapısız kaçış yolu KALMAMALI: ham değişkenler doğrudan döndürülemez. */
    expect(geo).not.toMatch(/return done\(premiumRaw/);
    expect(geo).not.toMatch(/return done\(streetsRaw/);
  });

  it('🔒 kapı bir katmanı boşaltırsa MERDİVEN DURMAZ', () => {
    const geo = src('platform/geocodingService.ts');
    /* Yanlış şehirdeki bir Nominatim cevabı, gevşetme ve Overpass son şansını
       iptal ettiremez — aksi hâlde kapı zinciri KISALTMIŞ olurdu. */
    /* P0-NAV-08: iki satırın ARASINA sağlayıcı sicili kaydı girdi. İnvaryant
       aynı — dönüş kararı KAPIDAN GEÇMİŞ listeye bakar, ham listeye DEĞİL. */
    expect(geo).toMatch(/const firstGated = gate\(firstOk\);/);
    expect(geo).toMatch(/if \(firstGated\.length\) return done\(firstGated, 'NOMINATIM'\);/);
    expect(geo).not.toMatch(/if \(firstOk\.length\) return done\(firstOk/);
    /* Gevşetme ve sokak katmanları da kapıdan geçmiş listeye bakmalı. */
    expect(geo).not.toMatch(/if \(streetsRaw\.length\)/);
  });

  it('🔒 iki arama yüzeyi AYNI kapıyı kullanır (kopya otorite YOK)', () => {
    expect(src('platform/geocodingService.ts')).toContain("from './geo/locationBiasGate'");
    expect(src('platform/mapService.ts')).toContain("from './geo/locationBiasGate'");
    expect(src('platform/addressNavigationEngine.ts')).toContain("from './geo/locationBiasGate'");
  });

  it('🔒 kapının elemesi DEFTERE ve LAB ekranına taşınır (gözlemlenebilirlik)', () => {
    /* Kullanıcıdan aday GİZLEYEN bir karar sahada görünmek ZORUNDADIR. */
    expect(src('platform/geo/addressSearchLedger.ts')).toContain('biasDroppedCount');
    expect(src('platform/geocodingService.ts')).toContain('biasDroppedCount');
    expect(src('platform/addressNavigationEngine.ts')).toContain('biasDroppedCount');
    expect(src('platform/mapService.ts')).toContain('biasDroppedCount');
    const model = src('platform/devtools/addressSearchModel.ts');
    expect(model).toContain('Konum/şehir kapısında elenen');
    /* Kapı hiç çalışmadıysa "0 elendi" değil ÖLÇÜLMEDİ gösterilir. */
    expect(model).toMatch(/biasDroppedTotal === null \? NA/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 27 · HIZ GÖSTERİMİ YUVARLANIR (saha 2026-08-12, kullanıcı ekran görüntüsü)
 *
 * GÖZLENDİ: yolda giderken hız göstergesinde 6+ haneli bir sayı belirdi ve
 * plakayı taşırıp ekranın dışına çıktı; "bazen düzeliyor, çoğu zaman böyle
 * kalıyor" denildi.
 *
 * KÖK: dört tema `useDisplaySpeed()` dönüşünü YUVARLAMADAN basıyordu. Hız
 * kaynağı GPS olduğunda değer `loc.speed * 3.6` ile üretilir → ONDALIKLIDIR
 * ("67.154…"); OBD (`010D`) tam sayı döndürür. Bu yüzden kusur yalnız GPS
 * kaynağı kazandığında görünüyor, OBD kazanınca kendiliğinden "düzeliyordu".
 * Harita/HUD yüzeyleri zaten yuvarlıyordu (`formatDisplaySpeed`) — ayrışan
 * yalnız tema katmanıydı.
 *
 * İKİNCİ KUSUR (aynı satırlar): `?? 0` "bilinmiyor"u SAHTE 0'a çeviriyordu —
 * `useDisplaySpeed`in kendi sözleşmesi bunu YASAKLAR ("duran araç ile verisi
 * olmayan araç aynı şey değildir"). Biçimleyici `null` → "—" verir.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 27 · hız gösterimi yuvarlanır ve sahte 0 üretmez', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const THEMES = [
    'components/themes/ExpeditionLayout.tsx',
    'components/themes/HorizonLayout.tsx',
    'components/themes/ProLayout.tsx',
    'components/themes/TeslaLayout.tsx',
  ];

  it('🔒 hiçbir tema HAM hız değerini ekrana basmaz', () => {
    for (const t of THEMES) {
      const s = src(t);
      /* Ölçülen kusurun imzası: JSX içinde çıplak `{speed}` / `{speedKmh}`
         ya da şablon içinde `${speed}`. Hepsi biçimleyiciden geçmelidir. */
      expect(s, `${t}: ham {speed} basılıyor`).not.toMatch(/>\{speed\}</);
      expect(s, `${t}: ham {speedKmh} basılıyor`).not.toMatch(/>\{speedKmh\}</);
      expect(s, `${t}: şablonda ham hız`).not.toMatch(/\{`\$\{speed(Kmh)?\}`\}/);
    }
  });

  it('🔒 dört tema da TEK biçimleyiciyi kullanır (kopya yuvarlama YOK)', () => {
    for (const t of THEMES) {
      const s = src(t);
      expect(s, `${t}: formatDisplaySpeed import edilmemiş`)
        .toMatch(/import \{[^}]*formatDisplaySpeed[^}]*\} from '\.\.\/\.\.\/hooks\/useDisplaySpeed'/);
      expect(s, `${t}: formatDisplaySpeed çağrılmıyor`).toContain('formatDisplaySpeed(rawSpeed)');
    }
  });

  it('🔒 biçimleyici ondalığı yuvarlar (GPS kaynağının imzası)', async () => {
    const { formatDisplaySpeed } = await import('../hooks/useDisplaySpeed');
    /* GPS: 18.6540 m/s × 3.6 = 67.1544 km/h — sahada taşan tam bu biçimdi. */
    expect(formatDisplaySpeed(18.654 * 3.6)).toBe('67');
    expect(formatDisplaySpeed(67.1544)).toBe('67');
    expect(formatDisplaySpeed(0.4)).toBe('0');
    /* Gösterim ASLA 3 haneden uzun olamaz: kaynak kapısı 300 km/h'te kapanır. */
    expect(formatDisplaySpeed(299.6).length).toBeLessThanOrEqual(3);
  });

  it('🔒 hız BİLİNMİYORken sahte 0 DEĞİL "—" gösterilir', async () => {
    const { formatDisplaySpeed, SPEED_UNKNOWN_TEXT } = await import('../hooks/useDisplaySpeed');
    expect(formatDisplaySpeed(null)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(undefined)).toBe(SPEED_UNKNOWN_TEXT);
    expect(formatDisplaySpeed(Number.NaN)).toBe(SPEED_UNKNOWN_TEXT);
    /* `?? 0` yalnız YAY/ORAN matematiğinde kalabilir; gösterimde KALMAMALI. */
    for (const t of THEMES) {
      expect(src(t), `${t}: gösterimde sahte 0`).not.toMatch(/>\{useDisplaySpeed\(\) \?\? 0\}</);
    }
  });

  it('🔒 yay matematiği ham sayıyı kullanmaya DEVAM eder (görsel bozulmadı)', () => {
    /* Yuvarlama YALNIZ gösterimdir: gösterge yayı hâlâ sürekli hareket eder. */
    expect(src('components/themes/ExpeditionLayout.tsx'))
      .toMatch(/const speed = rawSpeed \?\? 0;[\s\S]{0,200}Math\.min\(speed \/ 200, 1\)/);
    expect(src('components/themes/TeslaLayout.tsx'))
      .toMatch(/const speed = rawSpeed \?\? 0;/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   🔒 COMPAT OPAKLAŞTIRMA — açık temada koyu zemin + koyu mürekkep ÇAKIŞMASI
   ─────────────────────────────────────────────────────────────────────────
   SAHA (2026-08-12, cihazda CDP ile ölçüldü): Mavi'ye adres söylenince açılan
   seçim listesi (AddressNavCard) okunmaz haldeydi. Kart `backdrop-blur-md`
   kullanıyor; base.css compat kuralı blur'u kapatıp arka planı SABİT KOYU
   rgb(8,13,28)'e sabitliyordu. Ama metinler --oem-ink ile geliyor ve AÇIK
   temada (light-ui / sunlight-mode) KOYU → koyu zemin + koyu metin.
   Ölçüm: zemin luminans 13, mürekkep 12 → Δ = 1/255 (görünmez).
   Blur sınıfı kaldırılınca Δ = 229 → suçlu KESİN olarak bu kuraldı.
   Kilit: opaklaştırma rengi TEMA TOKEN'ına bağlı KALMALI, sabit renge dönmemeli.
   ══════════════════════════════════════════════════════════════════════════ */
describe('🔒 Compat opaklaştırma teması takip eder', () => {
  /* CSS `?raw` Vitest'te boş döner (Vite CSS'i ayrı pipeline'da işler) →
     kaynak-metin kilitleri için dosyadaki kanonik `read()` helper'ı. */
  const baseCssSrc = read('src/styles/base.css');
  const designSystemCssSrc = read('src/styles/design-system.css');
  const dayModeCssSrc = read('src/styles/day-mode.css');

  it('🔒 backdrop-blur opaklaştırması SABİT renk değil, token kullanır', () => {
    /* Kuralın gövdesini yakala: `.backdrop-blur { ... }` bloğu. */
    const rule = baseCssSrc.match(
      /html\[data-compat-mode="true"\] \.backdrop-blur \{([\s\S]*?)\}/,
    );
    expect(rule, 'compat backdrop-blur kuralı bulunamadı').not.toBeNull();
    const body = rule![1];

    expect(body, 'opaklaştırma tema tokenına bağlı değil')
      .toMatch(/background-color:\s*var\(--oem-compat-solid/);
    /* Sabit renge GERİ DÖNME yasağı — fallback dışında ham renk kalmamalı. */
    expect(
      /background-color:\s*rgb\(/.test(body),
      'opaklaştırma yine SABİT renge sabitlenmiş (tema takip etmiyor)',
    ).toBe(false);
  });

  it('🔒 token her palette tanımlı — koyu KOYU, açık AÇIK kalır', () => {
    /* Koyu fallback: davranış DEĞİŞMEDİ (regresyon yok). */
    expect(designSystemCssSrc, ':root koyu compat yüzeyi yok')
      .toMatch(/--oem-compat-solid:\s*rgb\(8,\s*13,\s*28\)/);

    /* light-ui bloğu AÇIK bir yüzey vermeli. */
    const lightBlock = designSystemCssSrc.match(/html\.light-ui \{([\s\S]*?)\n\}/);
    expect(lightBlock, 'light-ui bloğu bulunamadı').not.toBeNull();
    expect(lightBlock![1], 'light-ui compat yüzeyi tanımsız')
      .toMatch(/--oem-compat-solid:\s*#F1F3F7/i);

    /* sunlight-mode (güneş altı) da AÇIK olmalı — en kritik okunabilirlik anı. */
    expect(dayModeCssSrc, 'sunlight-mode compat yüzeyi tanımsız')
      .toMatch(/--oem-compat-solid:\s*#EEF1F6\s*!important/i);
  });

  it('🔒 açık palet yüzeyi mürekkeple çakışmaz (luminans kapısı)', () => {
    /* Kaynak-metin kilidi yetmez: değerlerin gerçekten KONTRAST ürettiğini
       doğrula. Sahada düşen tam buydu (Δ=1). Eşik: ≥ 120/255. */
    const lum = (hex: string): number => {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    /* light-ui: yüzey #F1F3F7 · mürekkep #14171C */
    expect(Math.abs(lum('#F1F3F7') - lum('#14171C'))).toBeGreaterThan(120);
    /* sunlight-mode: yüzey #EEF1F6 · mürekkep #0A0C10 */
    expect(Math.abs(lum('#EEF1F6') - lum('#0A0C10'))).toBeGreaterThan(120);
    /* koyu tema: yüzey rgb(8,13,28) ≈ #080D1C · mürekkep #F0EBE0 */
    expect(Math.abs(lum('#080D1C') - lum('#F0EBE0'))).toBeGreaterThan(120);
  });

  it('🔒 AddressNavCard yüzeyini token ile alır (sabit koyu zemine dönmez)', () => {
    /* Kartın kendi yüzeyi tema tokenı olmalı; hardcoded koyu hex dönerse
       compat kuralı düzelse bile kart yine açık temada koyu kalır. */
    expect(addressNavCardSrc, 'kart yüzeyi tema tokenı değil')
      .toMatch(/bg-\[var\(--oem-surface-2\)\]/);
    expect(addressNavCardSrc, 'kart metni tema tokenı değil')
      .toMatch(/text-\[color:var\(--oem-ink\)\]/);
  });
});

/* ── ETA ZAMAN ORANI SINIRI (#551 · 2026-08-12) ──────────────────────────────
 * SAHA ARIZASI: #538 hız rampasından SONRA bile `etaJumpLedger` sıçramaların
 * 7/11'ini hız kapısına yazdı (-174 s · -161 s · +142 s; dördü tam 1↔1.5).
 * KÖK: süreklilik HIZ ekseninde kurulmuştu; `rollingAvgKmh` ise ETA kadansında
 * (5 s) örnekleniyor ve gerçek yavaşlamada 8 km/sa'lik bandın tamamını tek
 * adımda geçiyor → çarpan yine basamak atlıyordu.
 * Bu kilitler ZİNCİRİN KOPMAMASINI sabitler (davranış kilidi ayrı dosyada:
 * `etaTimeRateLimit.test.ts`). */
describe('#551 · ETA zaman oranı sınırı — zincir kilidi', () => {
  const nav = () => navigationServiceSrc;
  const model = () => etaModelSrc;

  it('🔒 çağıran önceki çarpanı ve geçen süreyi computeEta\'ya GEÇİRİR', () => {
    const s = nav();
    expect(s, 'previousCorrectionFactor bağlantısı koptu — sınır sessizce ölür')
      .toMatch(/previousCorrectionFactor:\s*_prevAppliedEtaFactor/);
    expect(s, 'sinceLastEtaMs bağlantısı koptu — sınır sessizce ölür')
      .toMatch(/sinceLastEtaMs:\s*_sinceLastEtaMs/);
  });

  it('🔒 dt farkı `_lastEtaUpdateMs` EZİLMEDEN ÖNCE alınır', () => {
    /* Sıra bozulursa dt her zaman 0 olur → sınır hiç uygulanmaz ve
       hiçbir test bunu göremez (sessiz ölüm). */
    const s = nav();
    const dtIdx = s.indexOf('const _sinceLastEtaMs = now - _lastEtaUpdateMs');
    const setIdx = s.indexOf('_lastEtaUpdateMs = now;', dtIdx < 0 ? 0 : dtIdx);
    expect(dtIdx, '_sinceLastEtaMs hesabı kaybolmuş').toBeGreaterThan(0);
    expect(setIdx, '_lastEtaUpdateMs ataması dt hesabından ÖNCE gelmiş').toBeGreaterThan(dtIdx);
  });

  it('🔒 ROUTE_MODEL dışına düşünce çarpan geçmişi SIFIRLANIR', () => {
    /* Sıfırlanmazsa yedek/STALE dönüşünde yeni çarpan eski değerden yavaşça
       yürümek zorunda kalır → ETA gerçeği geç yakalar. */
    expect(nav(), 'çarpan geçmişi ROUTE_MODEL kapısını kaybetmiş')
      .toMatch(/_prevAppliedEtaFactor\s*=\s*_lastEtaVerdict\.state === 'ROUTE_MODEL'/);
  });

  it('🔒 oturum sıfırlamasında çarpan geçmişi de temizlenir', () => {
    expect(nav(), 'yeni navigasyon oturumu eski çarpanı devralıyor')
      .toMatch(/_prevAppliedEtaFactor\s*=\s*null;/);
  });

  it('🔒 model SAF kalır — sınır saat/durum okumaz', () => {
    const s = model();
    expect(s, 'etaModel içine Date.now/performance.now sızmış (saflık sözleşmesi)')
      .not.toMatch(/Date\.now\(\)|performance\.now\(\)/);
    expect(s, 'dt tavanı kaldırılmış — kare atlanınca sınır gevşer')
      .toMatch(/ETA_DRIFT_DT_CAP_MS/);
  });
});

/* ── ECU SUSKUNLUĞUNDAN ÇIKIŞ = KURTARMA (#554 · 2026-08-12) ─────────────────
 * SAHA ARIZASI: kopma defterinde 3 `ECU_SILENT_WATCHDOG` kaydının ÜÇÜNDE de
 * `recoveryMs: null` (`pendingRecoveryCount: 3`, `medianRecoveryMs: null`) —
 * oysa ham trafik kurtarmayı gösteriyordu (NO DATA seli → ATWS/ATZ → 0100 OK).
 * KÖK: kurtarma imzası YALNIZ başarılı handshake'e bağlıydı; ECU sustuğunda
 * taşıma katmanı ölmediği için handshake hiç koşmaz → uç asla kapanmazdı ve
 * #536'nın manşet metriği yapısal olarak hiç doğamıyordu. */
describe('#554 · ECU verisi dönünce kurtarma ucu kapanır — zincir kilidi', () => {
  it('🔒 ECU verisi akınca kurtarma işlenir (handshake BEKLENMEZ)', () => {
    expect(obdServiceSrc, 'kurtarma ucu veri akışına bağlı değil — defter yine "bekliyor"da donar')
      .toMatch(/_lastRealDataMs = _rxNow;[\s\S]{0,300}?_noteEcuDataResumed\(\)/);
  });

  it('🔒 ECU_SILENT kopması bekleyen olarak İŞARETLENİR', () => {
    expect(obdServiceSrc, 'ECU_SILENT bayrağı kalkmıyor — kurtarma hiç işlenmez')
      .toMatch(/trigger === 'ECU_SILENT_WATCHDOG'\s*\)\s*_ecuSilencePending = true/);
  });

  it('🔒 ÇİFT İŞLEME KORUMASI: kurtarma yolu bayrağı düşürür', () => {
    /* Aksi hâlde handshake bir kez, veri akışı bir kez daha kurtarma işler ve
       ikincisi BİR ÖNCEKİ bekleyen kayda YANLIŞ imza yazardı. */
    expect(obdServiceSrc, 'çift işleme koruması kaldırılmış')
      .toMatch(/_ecuSilencePending = false;[\s\S]{0,200}?noteRecovery\(/);
  });

  it('🔒 sıcak yol bedeli tek boolean — defter TARANMAZ', () => {
    expect(obdServiceSrc, 'erken çıkış kaldırılmış — her ECU paketinde defter taranır')
      .toMatch(/function _noteEcuDataResumed\(\): void \{\s*\n\s*if \(!_ecuSilencePending\) return;/);
  });
});

/* ── BLACKBOX ÖRNEKLEYİCİ BİRİKMESİ (#555 · 2026-08-12) ──────────────────────
 * SAHA ARIZASI: "1 Hz" halkasında 60 örneğin en az beş çifti BİREBİR AYNI `ts`
 * ile yazılmış, aralıklar 0,24-2,4 s arasında savrulmuştu.
 * KÖK: saniyede bir `requestIdleCallback` KUYRUĞA atılıyor, bekleyen olup
 * olmadığına bakılmıyordu; cihaz meşgulken istekler birikip idle anında arka
 * arkaya boşalıyordu. Bedeli adli: mükerrer örnek 60'lık halkayı erken doldurur
 * → "son 60 saniye" beyanı sessizce kısalır. */
describe('#555 · blackbox örnekleyicisi birikmez', () => {
  it('🔒 bekleyen istek varken yenisi kuyruğa GİRMEZ', () => {
    expect(blackBoxServiceSrc, 'birikme kapısı kaldırılmış — mükerrer örnekler geri gelir')
      .toMatch(/function _scheduleReplaySample\(\): void \{[\s\S]{0,200}?if \(_replayPending\) return;/);
  });

  it('🔒 bayrak örneklemeden ÖNCE düşer (kalıcı kilitlenme yok)', () => {
    expect(blackBoxServiceSrc, 'bayrak sıfırlaması örneklemeden sonraya alınmış')
      .toMatch(/_replayPending = false;\s*\n\s*_takeReplaySample\(\);/);
  });

  it('🔒 taban aralık kapısı aynı ms\'de iki kaydı engeller', () => {
    expect(blackBoxServiceSrc, 'taban aralık kapısı kaldırılmış')
      .toMatch(/gap >= 0 && gap < REPLAY_MIN_GAP_MS\) return;/);
  });

  it('🔒 saat GERİYE sıçrarsa kapı uygulanmaz (kanıt kaybı YASAK)', () => {
    /* `gap >= 0` koşulu tam olarak bunun içindir: negatif fark saat
       sıçramasıdır ve örneklemeyi susturmamalıdır. */
    expect(blackBoxServiceSrc).toMatch(/gap >= 0/);
  });

  it('🔒 durdurulunca bekleyen bayrak SIFIRLANIR', () => {
    const hits = blackBoxServiceSrc.match(/_replayPending = false;/g) ?? [];
    // 1 × scheduler + 2 × stop yolu
    expect(hits.length, 'stop yollarında bayrak sıfırlaması eksik').toBeGreaterThanOrEqual(3);
  });
});

/* ── PANİK YAKALAYICI BAĞLI KALIR (E-34 · 2026-08-12) ────────────────────────
 * DENETİM BULGUSU: `initPanicHandler()` yazılmış, docstring'i "SystemBoot stop()
 * içinde çağrılır" DİYOR, ama SystemBoot'ta `panic` geçen tek satır YOKTU.
 * Sonuç: `window.onerror` ve `unhandledrejection` hiç yakalanmıyor, olay halka
 * tamponu hiç dolmuyordu → sahada çöken APK'dan geriye tanı verisi kalmıyordu.
 * Bedeli: post-mortem imkânsız. Bu kilit bağlantının sessizce kopmasını engeller. */
describe('E-34 · panik yakalayıcı SystemBoot\'a bağlı kalır', () => {
  it('🔒 SystemBoot initPanicHandler\'ı IMPORT eder', () => {
    expect(systemBootSrc, 'panic handler importu düşmüş — hook\'lar hiç kurulmaz')
      .toMatch(/import \{ initPanicHandler \}\s+from '\.\/SystemPanicHandler'/);
  });

  it('🔒 Wave 1\'de ÇAĞRILIR ve cleanup kaydedilir', () => {
    expect(systemBootSrc, 'initPanicHandler çağrısı düşmüş — E-34 geri geldi')
      .toMatch(/this\._reg\(initPanicHandler\(\)\)/);
  });

  it('🔒 çağrı Wave 1\'in EN BAŞINDA kalır (boot hataları da yakalansın)', () => {
    const w1 = systemBootSrc.indexOf('_wave1(): Promise<void>');
    const panic = systemBootSrc.indexOf('initPanicHandler()', w1);
    const bus = systemBootSrc.indexOf('startPlatformCoreEventBusWiring()', w1);
    expect(panic, 'panic handler Wave 1 içinde bulunamadı').toBeGreaterThan(w1);
    expect(panic, 'panic handler event bus\'tan SONRAYA kaymış — arada oluşan hata kaçar')
      .toBeLessThan(bus);
  });

  it('🔒 fail-soft: panic kurulumu boot\'u DÜŞÜRMEZ', () => {
    expect(systemBootSrc, 'try/catch kaldırılmış — panic handler hatası tüm boot\'u düşürür')
      .toMatch(/this\._reg\(initPanicHandler\(\)\);[\s\S]{0,120}?catch \(e\) \{[\s\S]{0,120}?SystemBoot:panicHandler/);
  });
});

/* ── TAZELİK OTORİTESİ TEKTİR (E-01/E-09/E-36 · 2026-08-12) ──────────────────
 * DENETİM BULGUSU: "bu veri hâlâ geçerli mi" sorusu ürün genelinde 40+ bağımsız
 * sabitle cevaplanıyordu. Üç dosya AYNI 4000 ms'i elle kopyalamıştı ve ikisinin
 * YORUMU "ObdHealthMonitor ile hizalı" diyerek hizalamayı İDDİA ediyordu —
 * ama yorum bir sözleşme değildir: biri değişince diğeri sessizce ayrışır ve
 * aynı veri için bir ekran "TAZE", diğeri "BAYAT" der.
 * Bu kilitler hizalamanın KODLA kurulu kalmasını zorlar. */
describe('E-36 · tazelik eşikleri tek otoriteden okunur', () => {
  it('🔒 OBD donma eşiği üç tüketicide de politikadan gelir', () => {
    expect(obdHealthMonitorSrc, 'ObdHealthMonitor eşiği yeniden elle yazılmış')
      .toMatch(/const STALE_ABS_MS = OBD_FROZEN_ABS_MS;/);
    expect(diagnosticTriageSrc, 'diagnosticTriage eşiği yeniden elle yazılmış')
      .toMatch(/const OBD_STALE_AGE_MS\s+= OBD_FROZEN_ABS_MS;/);
    expect(diagnosticEvidenceSrc, 'diagnosticEvidence eşiği yeniden elle yazılmış')
      .toMatch(/const STALE_PACKET_MS = OBD_FROZEN_ABS_MS;/);
  });

  it('🔒 GPS bayatlık eşiği iki tüketicide de politikadan gelir', () => {
    expect(gpsServiceSrc, 'gpsService eşiği yeniden elle yazılmış')
      .toMatch(/export const LOCATION_STALE_MS = GPS_FIX_STALE_MS;/);
    expect(navSessionRuntimeSrc, 'navigationSessionRuntime eşiği yeniden elle yazılmış')
      .toMatch(/const GPS_STALE_MS = GPS_FIX_STALE_MS;/);
  });

  it('🔒 politika SAF kalır (import yok — döngü/yan etki riski)', () => {
    expect(freshnessPolicySrc, 'freshnessPolicy bir şey import etmeye başlamış')
      .not.toMatch(/^\s*import\s/m);
  });

  it('🔒 değerler davranışı DEĞİŞTİRMEDEN korunur (4s / 5s)', () => {
    expect(freshnessPolicySrc).toMatch(/OBD_FROZEN_ABS_MS = 4_000;/);
    expect(freshnessPolicySrc).toMatch(/GPS_FIX_STALE_MS = 5_000;/);
  });
});

/* ── YAKIT VARSAYIMI TEKTİR (E-05 · 2026-08-12) ──────────────────────────────
 * DENETİM BULGUSU: "araç 100 km'de kaç litre yakar" sorusu iki dosyada bağımsız
 * sabitlenmişti — `routingService` 7.5, `tripLogService` 8.5. İkisi de KULLANICIYA
 * GÖRÜNÜYORDU: aynı 300 km için rota HUD'ı "22,5 L", yolculuk özeti "25,5 L"
 * diyordu (%13 sapma). Beyan edilmiş değer 8.5'tir (tripCanonicalModel + LAB
 * katalog notu); 7.5 hiçbir yerde beyan edilmemişti. */
describe('E-05 · yakıt varsayımı tek otoriteden gelir', () => {
  it('🔒 rota tahmini politikadan okur (yerel 7.5 geri gelmez)', () => {
    expect(routingServiceSrc, 'computeFuelEstimate yerel sabite dönmüş')
      .toMatch(/DEFAULT_FUEL_L_PER_100KM \* 10\) \/ 10;/);
    expect(routingServiceSrc, 'beyan edilmemiş 7.5 heuristiği geri gelmiş')
      .not.toMatch(/L_PER_100KM = 7\.5/);
  });

  it('🔒 yolculuk kaydı politikadan okur', () => {
    expect(tripLogServiceSrc, 'tripLogService yerel sabite dönmüş')
      .toMatch(/const FUEL_L_PER_100KM\s+= DEFAULT_FUEL_L_PER_100KM;/);
  });

  it('🔒 beyan edilen değer korunur (8.5)', () => {
    expect(vehicleAssumptionsSrc).toMatch(/DEFAULT_FUEL_L_PER_100KM = 8\.5;/);
  });

  it('🔒 varsayım modülü SAF kalır', () => {
    expect(vehicleAssumptionsSrc, 'vehicleAssumptions import etmeye başlamış')
      .not.toMatch(/^\s*import\s/m);
  });
});

/* ── AI GATEWAY İZNİ SUNUCUDAN OKUNUR (E-24 · 2026-08-12) ────────────────────
 * DENETİM BULGUSU: `refreshGatewayAccess` ürün yolunda HİÇ çağrılmıyordu (test
 * bile 0). Modülün docstring'i "boot'ta bir kez + elle tazeleme" diyordu ama
 * çağıran yoktu → `_snapshot` hep null → UNREAD_ACCESS → kapı KALICI kapalı;
 * tek açılış yolu yerel geliştirici kaldıracıydı.
 * DOĞRU YER BOOT DEĞİL: `get_ai_gateway_access()` `auth.uid()` ister ve
 * oturumsuz BOŞ döner (migration 061, fail-closed) → çağrı oturum kurulduğunda
 * anlamlıdır. */
describe('E-24 · gateway izni oturum kurulunca okunur', () => {
  it('🔒 RoleStore refreshGatewayAccess\'i IMPORT eder', () => {
    expect(roleStoreSrc, 'gateway izni okuma ucu tekrar koptu')
      .toMatch(/import \{ refreshGatewayAccess \} from '\.\.\/ai\/gateway\/aiGatewayAccessRuntime'/);
  });

  it('🔒 oturum DOĞRULANDIKTAN sonra çağrılır', () => {
    const getUser = roleStoreSrc.indexOf('client.auth.getUser()');
    const call    = roleStoreSrc.indexOf('refreshGatewayAccess(', getUser);
    expect(call, 'çağrı oturum doğrulamasından önceye kaymış — uid yokken boş döner')
      .toBeGreaterThan(getUser);
  });

  it('🔒 fail-soft: okuma hatası oturum akışını DÜŞÜRMEZ', () => {
    expect(roleStoreSrc, 'catch kaldırılmış — ağ hatası admin girişini kırar')
      .toMatch(/refreshGatewayAccess\([\s\S]{0,320}?\)\.catch\(/);
  });

  it('🔒 rol beklenmez (izin şirket kapsamlıdır, super_admin şartı YOK)', () => {
    const call  = roleStoreSrc.indexOf('refreshGatewayAccess(');
    const claim = roleStoreSrc.indexOf('hasRoleClaim', call);
    expect(call, 'çağrı rol kapısının arkasına alınmış — şirket izni okunamaz olur')
      .toBeLessThan(claim);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * #597 · TEMA DÜZENLEME ARAÇTA DEĞİL, ARABAM CEBİMDE'DE YAPILIR
 *
 * SAHA ARIZASI (2026-08-16, gerçek araç ekran görüntüsü): araçta bir karta
 * UZUN BASINCA tam bir tema editörü açılıyordu (RENK/YAZI/ŞEKİL/EFEKT +
 * palet). Bu, mimarinin ters kurulmuş hâliydi: araç TÜKETİCİ olmalıydı.
 *
 * NEDEN SADECE MİMARİ DEĞİL, ÜRÜN KUSURU: `editStyleEngine` kendi
 * `<style id="car-edit-engine-v3">` etiketine `!important` yazıyordu →
 * araçta kalmış eski bir yerel düzenleme, Tema Stüdyo'dan "Araca Gönder"
 * ile gelen Manifest v3'ü SESSİZCE EZİYORDU. Ayrıca `useEditStore`
 * varsayılanı `locked: false` idi → sürüş sırasında her uzun basış paneli
 * açıyordu.
 *
 * DOĞRU ZİNCİR: Arabam Cebimde / Tema Stüdyo → Manifest v3 → `theme_change`
 * → `parseIncomingManifest` (fail-closed) → `themeRuntime` → tek `<style>`.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('#597 · araç içi tema editörü GERİ GELMEZ', () => {
  const GONE = [
    'src/store/useEditStore.ts',
    'src/platform/editStyleEngine.ts',
    'src/components/edit/EditController.tsx',
    'src/components/edit/EditPanel.tsx',
    'src/platform/theme/themeDocument.ts',
  ];

  it('🔒 sökülen editör dosyaları geri EKLENMEMİŞ', () => {
    for (const p of GONE) {
      expect(existsSync(resolve(root, p)), `${p} geri gelmiş — düzenleme araca taşınamaz`)
        .toBe(false);
    }
  });

  it('🔒 App ağacı editör sarmalayıcısıyla SARILMAZ', () => {
    const s = read('src/App.tsx');
    expect(s, 'EditController yeniden monte edilmiş').not.toMatch(/EditController/);
  });

  it('🔒 araçta İKİNCİ bir stil otoritesi yok — TÜM kaynak taranır', () => {
    expect(read('src/platform/theme/themeRuntime.ts'), 'manifest stil etiketi kimliği değişmiş')
      .toMatch(/caros-theme-manifest-css/);

    /* Rakip motorun ETİKETİ ya da KAYIT DEFTERİ hiçbir dosyada yeniden doğmamalı.
       Yorum satırları hariç tutulmaz: kimlik metni geri geliyorsa niyet geri
       geliyor demektir — tek istisna bu kilidin kendi açıklamasıdır. */
    const offenders: string[] = [];
    let scanned = 0;
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        const rel = join(dir, e.name);
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (rel.replace(/\\/g, '/').endsWith('src/__tests__/regression.guards.test.ts')) continue;
        scanned++;
        const body = read(rel);
        if (/car-edit-engine|EDITABLE_REGISTRY/.test(body)) offenders.push(rel);
      }
    };
    walk('src');

    /* KONTROL: tarayıcı bozulursa `offenders` boş kalır ve kilit BOŞLUĞA atılır.
       Gerçekten gezdiğini kanıtla — hem adet, hem bilinen bir dosyayı gördüğü. */
    expect(scanned, 'kaynak tarayıcı hiçbir dosya gezmedi — kilit sahte geçiyor')
      .toBeGreaterThan(300);
    expect(offenders, `rakip editör motoru geri gelmiş: ${offenders.join(', ')}`).toEqual([]);

    /* Aynı tarayıcı, VAR OLAN bir kimliği bulabildiğini de göstermeli. */
    const positive: string[] = [];
    const probe = (dir: string) => {
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        const rel = join(dir, e.name);
        if (e.isDirectory()) { probe(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (/caros-theme-manifest-css/.test(read(rel))) positive.push(rel);
      }
    };
    probe('src/platform/theme');
    expect(positive.length, 'tarayıcı var olan kimliği de bulamıyor — yöntem ölü')
      .toBeGreaterThan(0);
  });

  it('🔒 Ayarlar artık sökülmüş editörün kilidini SUNMAZ', () => {
    const s = read('src/components/settings/SettingsPage.tsx');
    expect(s, 'ölü Layout Lock anahtarı geri gelmiş').not.toMatch(/Layout Lock/);
    expect(s, 'sökülen store yeniden bağlanmış').not.toMatch(/useEditStore/);
  });
});

/* ───────────────────────────────────────────────────────────────
   #625 — GİRİŞ KAMERASI HAM GPS HEADING'E BAĞLANAMAZ
   Regresyon (CİHAZDA ÖLÇÜLDÜ 2026-08-18 07:31, Xiaomi 23090RA98I):
   `enterNavigationView` altı çağrı yerinin HEPSİNDE `headingRef.current ?? 0`
   ile çağrılıyordu. Park hâlindeki araçta GPS heading fiziksel olarak
   anlamsızdır (Doppler yok) ve `?? 0` kamerayı kuzeye çevirir. Ölçülen sonuç:
   kamera −42,5° (kuzeybatı) bakarken rota güneybatıya gidiyordu; rotanın
   309 noktasının **0'ı** ekranda kaldı ve MapLibre 5 katmanın hiçbirini
   çizmedi — BOYA KUSURSUZ olduğu hâlde rota GÖRÜNMÜYORDU.
   Kural: giriş kamerasının yönü bir KARARDAN gelir (`resolveEntryBearing`);
   durağan araçta rota yönü GPS heading'i EZER.
   ─────────────────────────────────────────────────────────────── */
describe('#625 giriş kamerası yön kararı kilidi (rota ekrandan çıkıyordu)', () => {
  it('DAVRANIŞ: park hâlinde rota yönü uygulanır, GPS heading DEĞİL', async () => {
    const { resolveEntryBearing } =
      await import('../platform/navigation/core/navigationEntryBearing');
    const d = resolveEntryBearing({
      routeBearing: 215, gpsHeading: -42.5, speedKmh: 0, currentBearing: -42.5,
    });
    expect(d.source, 'durağan araçta yine GPS heading uygulanıyor').toBe('ROUTE');
    expect(d.bearing).toBe(215);
  });

  it('DAVRANIŞ: hareket hâlinde GPS heading üstünlüğü KORUNUR', async () => {
    const { resolveEntryBearing } =
      await import('../platform/navigation/core/navigationEntryBearing');
    const d = resolveEntryBearing({
      routeBearing: 215, gpsHeading: 30, speedKmh: 90, currentBearing: 0,
    });
    expect(d.source).toBe('GPS_HEADING');
    expect(d.bearing).toBe(30);
  });

  it('KAYNAK: `enterNavigationView` yön kararını İÇERİDE verir', () => {
    expect(mapInteractionManagerSrc, 'giriş kamerası karara bağlı değil')
      .toContain('resolveEntryBearing');
  });

  it('KAYNAK: çağrı yerleri rota yönünü GEÇİRİR (ham heading yalnız başına yetmez)', () => {
    const full = read('src/components/map/FullMapView.tsx');
    const calls = full.split('enterNavigationView(').length - 1;
    expect(calls, 'çağrı yeri kalmamış — kilit anlamsızlaştı').toBeGreaterThan(1);
    /* Her çağrı `entryBearingArgs` ile beslenmeli; biri kaçarsa o yol eski
       kusuru geri getirir (kamera rotanın tersine kurulur). */
    const fed = full.split('...entryBearingArgs(').length - 1;
    expect(fed, `${calls} çağrıdan yalnız ${fed} tanesi rota yönü geçiriyor`)
      .toBe(calls);
  });

  it('KAYNAK: "aracı ortala" mini haritada da rota yönünü geçirir', () => {
    const mini = read('src/components/map/MiniMapWidget.tsx');
    expect(mini, 'mini haritada rota yönü otoritesi kullanılmıyor')
      .toContain('resolveRouteForwardBearing');
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   KÖK 4 (2026-08-18, harita bilgi yoğunluğu denetimi) — `updateDrivingLayers`
   içindeki hız-bazlı bina gizleme TEK YÖNLÜ bir mandaldı: 80 km/h üstüne bir
   kez çıkılıp geri düşüldüğünde `building-3d` katmanının opaklığı sabit
   `0.4`'e yazılıyordu — bu, stilin kendi varsayılanından (gece `bldg3dOpacity`
   0.78 · gündüz 0.95, `mapStyleBuilders.ts`) DAHA DÜŞÜKTÜ. Sonuç: bir kez
   80'i geçen her sürüşte binalar geri kalan sürüş boyunca stilin
   öngördüğünden kalıcı olarak soluk kalıyordu. Düzeltme: geri dönüş değeri
   artık o anki gün/gece paletinden (`NIGHT_PALETTE`/`DAY_PALETTE`) okunur —
   tek kaynak, palet değişirse burası otomatik izler.
   ───────────────────────────────────────────────────────────────────────── */
describe('Bina 3B opaklık mandalı — hız eşiği geri dönüşte PALET değerine döner (kök 4)', () => {
  let originalNight: boolean;

  beforeEach(async () => {
    const { getMapNight } = await import('../platform/mapSourceManager');
    originalNight = getMapNight();
  });

  afterEach(async () => {
    const { setMapNight } = await import('../platform/mapSourceManager');
    const { M } = await import('../platform/map/_mapState');
    setMapNight(originalNight);
    M.lastSpeedHide = false; // sonraki testleri kirletme
  });

  it('DAVRANIŞ: 80 km/h üstüne çıkıp geri düşünce GECE paletinin kendi değerine döner (0.78, sabit 0.4 DEĞİL)', async () => {
    const { updateDrivingLayers } = await import('../platform/map/MapLayerManager');
    const { M } = await import('../platform/map/_mapState');
    const { setMapNight } = await import('../platform/mapSourceManager');
    const { NIGHT_PALETTE } = await import('../platform/mapStyleBuilders');

    setMapNight(true);
    M.lastSpeedHide = false; // deterministik başlangıç: henüz gizlenmemiş

    const writes: Array<{ layer: string; prop: string; value: unknown }> = [];
    const mockMap = {
      isStyleLoaded: () => true,
      getLayer: (id: string) => (id === 'building-3d' ? {} : undefined),
      setPaintProperty: (layer: string, prop: string, value: unknown) => {
        writes.push({ layer, prop, value });
      },
    } as unknown as import('maplibre-gl').Map;

    // 1) Hız 80'i geçer → binalar gizlenir (opaklık 0)
    updateDrivingLayers(mockMap, 95, 36.9, 34.85);
    const hideWrite = writes.find((w) => w.layer === 'building-3d');
    expect(hideWrite?.value, 'yüksek hızda bina opaklığı 0 olmalı').toBe(0);

    // 2) Hız tekrar 80'in altına düşer → opaklık PALETİN gece değerine dönmeli
    writes.length = 0;
    updateDrivingLayers(mockMap, 50, 36.9, 34.85);
    const restoreWrite = writes.find((w) => w.layer === 'building-3d');
    expect(restoreWrite?.value, 'kök 4: geri dönüş sabit 0.4 yerine palet değeri OLMALI')
      .toBe(NIGHT_PALETTE.bldg3dOpacity);
    expect(restoreWrite?.value, 'sabit eski değer 0.4 GERİ GELMEMELİ').not.toBe(0.4);
  });

  it('DAVRANIŞ: aynı geri dönüş GÜNDÜZ modda gündüz paletinin değerine döner (0.95)', async () => {
    const { updateDrivingLayers } = await import('../platform/map/MapLayerManager');
    const { M } = await import('../platform/map/_mapState');
    const { setMapNight } = await import('../platform/mapSourceManager');
    const { DAY_PALETTE } = await import('../platform/mapStyleBuilders');

    setMapNight(false);
    M.lastSpeedHide = false;

    const writes: Array<{ layer: string; prop: string; value: unknown }> = [];
    const mockMap = {
      isStyleLoaded: () => true,
      getLayer: (id: string) => (id === 'building-3d' ? {} : undefined),
      setPaintProperty: (layer: string, prop: string, value: unknown) => {
        writes.push({ layer, prop, value });
      },
    } as unknown as import('maplibre-gl').Map;

    updateDrivingLayers(mockMap, 95, 36.9, 34.85);
    writes.length = 0;
    updateDrivingLayers(mockMap, 50, 36.9, 34.85);
    const restoreWrite = writes.find((w) => w.layer === 'building-3d');
    expect(restoreWrite?.value).toBe(DAY_PALETTE.bldg3dOpacity);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   KÖK 2 (2026-08-18, harita bilgi yoğunluğu denetimi) — İKİ ayrı kusur:

   (a) `useMapSourceStore.tileRender` yalnız NİYETİ taşırdı; `buildVectorStyle`
       kaynak yoksa/kapalıysa SESSİZCE `onFallback()` ile raster'a düşerdi ama
       LAB (`navigationCoreSources.ts` → `miniMapStyle`) hâlâ "road/vector"
       gösterirdi — gözlemlenemeyen düşüş. `getResolvedTileMode()` artık
       `getMapStyle()`in GERÇEKTEN döndürdüğü modu taşır.

   (b) `blockOnlineVector()` tetiklendikten sonra `unblockOnlineVector()`
       ÜRÜNDE HİÇBİR YERDEN çağrılmıyordu (dead code) — düşüş ağ toparlansa
       bile OTURUM SONUNA KADAR kalıcıydı. `MapCore.ts` artık basemap karosu
       30 sn istikrarlı yüklenince kapıyı yeniden açar (yeni bir hata gelirse
       pencere sıfırlanır).
   ───────────────────────────────────────────────────────────────────────── */
describe('Vektör→raster gözlemlenebilirlik + kalıcı mandal kilidi (kök 2)', () => {
  it('DAVRANIŞ: vektör kaynağı YOKKEN getMapStyle() raster döner ve getResolvedTileMode() bunu DOĞRU yansıtır', async () => {
    const { getMapStyle, getResolvedTileMode } = await import('../platform/mapSourceManager');
    const { useMapSourceStore } = await import('../platform/mapSourceStore');
    const { unblockOnlineVector } = await import('../platform/mapStyleBuilders');
    unblockOnlineVector(); // önceki testlerden sızmış olabilecek kapı durumunu sıfırla

    const prevEnv = import.meta.env['VITE_VECTOR_TILE_URL'];
    import.meta.env['VITE_VECTOR_TILE_URL'] = ''; // özel sunucu yok
    try {
      useMapSourceStore.setState({
        mapMode: 'road',
        tileRender: 'vector', // NİYET vektör — ama kaynak yok
        sources: new Map([[
          'online', { id: 'online', name: 'OpenStreetMap', type: 'online', description: '', isAvailable: true },
        ]]),
        activeSourceId: 'online',
      });

      const style = getMapStyle();
      expect(style.name, 'yerel .pbf/özel URL yokken stil GERÇEKTEN raster olmalı')
        .not.toMatch(/Vector/);
      expect(getResolvedTileMode(), 'KÖK 2: LAB artık NİYET değil GERÇEK modu göstermeli')
        .toBe('raster');
    } finally {
      import.meta.env['VITE_VECTOR_TILE_URL'] = prevEnv;
    }
  });

  it('DAVRANIŞ: vektör kaynağı VARKEN getResolvedTileMode() vector döner (kontrol testi)', async () => {
    const { getMapStyle, getResolvedTileMode } = await import('../platform/mapSourceManager');
    const { useMapSourceStore } = await import('../platform/mapSourceStore');
    const { unblockOnlineVector } = await import('../platform/mapStyleBuilders');
    unblockOnlineVector();

    const prevEnv = import.meta.env['VITE_VECTOR_TILE_URL'];
    import.meta.env['VITE_VECTOR_TILE_URL'] = 'https://tiles.example.org/planet';
    try {
      useMapSourceStore.setState({
        mapMode: 'road',
        tileRender: 'vector',
        sources: new Map([[
          'online', { id: 'online', name: 'OpenStreetMap', type: 'online', description: '', isAvailable: true },
        ]]),
        activeSourceId: 'online',
      });

      const style = getMapStyle();
      expect(style.name, 'özel URL varken stil vektör dönmeli').toMatch(/Vector/);
      expect(getResolvedTileMode()).toBe('vector');
    } finally {
      import.meta.env['VITE_VECTOR_TILE_URL'] = prevEnv;
    }
  });

  it('KAYNAK: `unblockOnlineVector` artık GERÇEKTEN ÇAĞRILIYOR (kök 2 öncesi: tanımlı ama ölü koddu)', () => {
    const calls = mapCoreSrc.match(/unblockOnlineVector\(\)/g)?.length ?? 0;
    expect(calls, 'kapı bir daha hiç açılmıyor — kalıcı tek yönlü mandal geri gelmiş')
      .toBeGreaterThanOrEqual(1);
  });

  it('KAYNAK: yeniden deneme YALNIZ yeni bir karo hatası GELMEDEN stabilite penceresi dolunca tetiklenir', () => {
    // Debounce mekanizması sessizce kaldırılırsa (anında unblock) ilk hatada
    // yeniden 20'lik eşiğe çarpıp salınım riski geri gelir.
    expect(mapCoreSrc).toMatch(/VECTOR_RETRY_STABLE_MS/);
    expect(mapCoreSrc).toMatch(/_cancelVectorRetry/);
    expect(mapCoreSrc).toMatch(/_armVectorRetry/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   KÖK 1 (2026-08-18, harita bilgi yoğunluğu denetimi) — rota bandı üstü
   sokak adı etiketleri (Google "pill" karşılığı). Kaynak: OSRM adımlarının
   ZATEN taşıdığı `streetName`; geometri bağlanması painted-arrow'un (#485)
   kullandığı AYNI `buildManeuverAnchors` anchor çözücüsü üstünden — ikinci
   bir geometri kaynağı YAZILMADI. Davranış kilitleri `routeStepLabelsModel.test.ts`de;
   burada YALNIZ üç yapısal/kablo kilidi var:
     (a) glyphs kapısı (raster stilde text-field katmanı MapLibre'yi reddettirir —
         ALT_BADGE_LAYER'daki aynı kusur sınıfı, saha 2026-08-02),
     (b) `clearRouteGeometry` yeni kaynağı/katmanı da temizliyor,
     (c) `setRouteGeometry` → `_applyRouteGeometry` → `_applyRouteStepLabels`
         zincirinde `steps` parametresi GERÇEKTEN taşınıyor (sessizce
         düşürülmüyor).
   ───────────────────────────────────────────────────────────────────────── */
describe('Rota bandı üstü sokak adı etiketleri — kablo kilitleri (kök 1)', () => {
  it('KAYNAK: glyphs KAPALIYKEN katman kurulmaz (raster stil text-field reddeder)', () => {
    expect(mapLayerManagerSrc).toMatch(/function _applyRouteStepLabels/);
    // Fonksiyon glyphsOk parametresini erken-dönüş kapısı olarak kullanmalı.
    const fnMatch = mapLayerManagerSrc.match(
      /function _applyRouteStepLabels\([\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(fnMatch, 'fonksiyon bulunamadı').not.toBe('');
    expect(fnMatch).toMatch(/if \(!glyphsOk\)/);
  });

  it('KAYNAK: `clearRouteGeometry` yeni katmanı/kaynağı da temizliyor', () => {
    const fnMatch = mapLayerManagerSrc.match(
      /export function clearRouteGeometry[\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(fnMatch, 'fonksiyon bulunamadı').not.toBe('');
    expect(fnMatch).toMatch(/ROUTE_STEP_LABELS_LAYER/);
    expect(fnMatch).toMatch(/ROUTE_STEP_LABELS_SRC/);
  });

  it('KAYNAK: `steps` parametresi setRouteGeometry → _applyRouteGeometry → _applyRouteStepLabels zincirinde taşınır', () => {
    const setFn = mapLayerManagerSrc.match(
      /export function setRouteGeometry\([\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(setFn, 'setRouteGeometry bulunamadı').not.toBe('');
    /* #639 GÜNCELLEMESİ: adımlar artık KOŞULSUZ yazılmaz — paylaşılan önbelleği
       mini haritanın adımsız çağrısı siliyordu (cihazda ölçüldü 2026-08-18).
       Sahiplik harita ÖRNEĞİNDE; davranış kilitleri routeStepsOwnership.test.ts. */
    expect(setFn, 'adımlar harita örneğine bağlanmıyor').toMatch(/_stepsByMap\.set\(map, steps as RouteStep\[\]\)/);
    expect(setFn, 'önbellek harita-başı adımdan türetilmiyor').toMatch(/steps: _cachedSteps/);
    expect(setFn, 'steps _applyRouteGeometry\'ye geçirilmiyor')
      .toMatch(/_applyRouteGeometry\(map, coordinates, alternatives, altRealIndices, 0, altDurations, mainDuration, steps \?\? \[\]\)/);

    expect(mapLayerManagerSrc, '_applyRouteStepLabels hiç çağrılmıyor — ölü kod')
      .toMatch(/_applyRouteStepLabels\(map, coords as \[number, number\]\[\], steps, _glyphsOk\)/);
  });

  /* ── #638: ilk turun AÇIK GÖRSEL BORCU kapatıldı — halo yerine gerçek
     dolgu "pill" (kalkanla AYNI 9-patch + icon-text-fit tekniği). Bu dört kilit
     borcun sessizce geri açılmasını (pill'in kaldırılması, imajın katmandan
     SONRA kaydedilmesi, hizalamanın metinden ayrışması, gece variantının
     unutulması) engeller. ─────────────────────────────────────────────────── */
  it('KAYNAK: etiket katmanı gerçek dolgu pill kullanır (icon-text-fit) — halo tek başına ZEMİN değil', () => {
    const fnMatch = mapLayerManagerSrc.match(
      /function _applyRouteStepLabels\([\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(fnMatch, 'fonksiyon bulunamadı').not.toBe('');
    expect(fnMatch, 'pill imajı katmana bağlanmamış')
      .toMatch(/'icon-image':\s*night \? ROUTE_PILL_IMG_NIGHT : ROUTE_PILL_IMG_DAY/);
    expect(fnMatch, "icon-text-fit 'both' olmalı — yoksa pill metni sarmaz").toMatch(/'icon-text-fit':\s*'both'/);
    expect(fnMatch, 'imaj düşerse metin kaybolmamalı (fail-soft)').toMatch(/'icon-optional':\s*true/);
    /* Halo artık ZEMİN değil ince sigorta: kalın halo geri gelirse pill'in
       üstüne ikinci bir zemin biner ve #635'in görsel borcu başka biçimde
       geri döner. */
    const haloWidth = fnMatch.match(/'text-halo-width':\s*([\d.]+)/)?.[1];
    expect(haloWidth, 'text-halo-width okunamadı').toBeTruthy();
    expect(Number(haloWidth)).toBeLessThan(2);
  });

  it('KAYNAK: pill imajı katman eklenmeden ÖNCE kaydedilir (#552 icon-image undefined sınıfı)', () => {
    const fnMatch = mapLayerManagerSrc.match(
      /function _applyRouteStepLabels\([\s\S]*?\n\}/,
    )?.[0] ?? '';
    const ensurePos = fnMatch.indexOf('ensureRouteStepPillImages(map)');
    const addPos    = fnMatch.indexOf('map.addLayer(');
    expect(ensurePos, 'imaj kaydı hiç çağrılmıyor').toBeGreaterThan(-1);
    expect(addPos).toBeGreaterThan(-1);
    expect(ensurePos, 'imaj katmandan SONRA kaydediliyor — MapLibre katmanı reddeder').toBeLessThan(addPos);
  });

  it('KAYNAK: pill imajı 9-patch kaydedilir (stretchX/stretchY/content) — köşe yamulmasın', () => {
    const fnMatch = mapLayerManagerSrc.match(
      /export function ensureRouteStepPillImages\([\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(fnMatch, 'ensureRouteStepPillImages bulunamadı').not.toBe('');
    expect(fnMatch).toMatch(/stretchX:/);
    expect(fnMatch).toMatch(/stretchY:/);
    expect(fnMatch).toMatch(/content:/);
    /* Gündüz VE gece variantı — tek imajla yetinilirse gece harita gündüz
       pill'ini taşır (kütük #622'nin mutlak parlaklık dersi). */
    expect(fnMatch).toMatch(/ROUTE_PILL_IMG_DAY/);
    expect(fnMatch).toMatch(/ROUTE_PILL_IMG_NIGHT/);
  });

  it('KAYNAK: pill hizalaması metinle İKİZ + gün/gece raster yolunda canlı tazelenir', () => {
    const fnMatch = mapLayerManagerSrc.match(
      /function _applyRouteStepLabels\([\s\S]*?\n\}/,
    )?.[0] ?? '';
    /* Metin map-rotated + viewport-pitched; imaj aynı olmazsa pill metinden
       ayrı düzlemde durur (yamuk zemin). */
    expect(fnMatch).toMatch(/'icon-rotation-alignment':\s*'map'/);
    expect(fnMatch).toMatch(/'icon-pitch-alignment':\s*'viewport'/);
    /* Raster yolunda applyMapDayNight RESTYLE YAPMAZ → icon-image elle tazelenmeli
       (painted-arrow'da aynı kusur `setPaintedArrowTheme` ile kapatılmıştı). */
    const themeFn = mapLayerManagerSrc.match(
      /export function applyMapDayNight\([\s\S]*?\n\}/,
    )?.[0] ?? '';
    expect(themeFn, 'applyMapDayNight bulunamadı').not.toBe('');
    expect(themeFn, 'gece geçişinde pill gündüz variantında kalır')
      .toMatch(/setRouteStepLabelsTheme\(map, night\)/);
  });

  it('KAYNAK: yeni katman z-order listesinde (rota çekirdeğinin üstü, araç marker\'ının altı)', () => {
    const orderMatch = mapLayerManagerSrc.match(
      /for \(const id of \[ALT_FILL[\s\S]*?\]\) \{/,
    )?.[0] ?? '';
    expect(orderMatch, 'z-order listesi bulunamadı').not.toBe('');
    expect(orderMatch).toMatch(/ROUTE_STEP_LABELS_LAYER/);
    // Sıra: rota çekirdeği/akışından SONRA, araç marker'ından ÖNCE.
    const flowPos   = orderMatch.indexOf('ROUTE_FLOW');
    const labelsPos = orderMatch.indexOf('ROUTE_STEP_LABELS_LAYER');
    const vehiclePos = orderMatch.indexOf("'user-vehicle'");
    expect(flowPos).toBeGreaterThan(-1);
    expect(labelsPos).toBeGreaterThan(flowPos);
    expect(vehiclePos).toBeGreaterThan(labelsPos);
  });
});

describe('#647 Uzak komut yolu — cihaz kimligi (api_key) kilidi', () => {
  /* SAHA + PROD OLCUMU (2026-08-19): PWA "ARACA GONDERILDI" diyor, komut satiri
   * `pending` kalip TTL doluyordu. Kok: arac Supabase'e OTURUMSUZ (anon)
   * baglanir; prod'da `anon` rolunun `vehicle_commands` uzerinde HICBIR tablo
   * ayricaligi YOK (037) ve SELECT/UPDATE politikalarinin tamami `auth.uid()`e
   * dayanir. Yani arac kendi komutunu ne OKUYABILIYOR ne de durumunu
   * YAZABILIYORDU. Tek gecerli kapi, `api_key_hash` dogrulayan SECURITY DEFINER
   * RPC'leridir (069 okuma, 070 yazma). Bu kilitler tabloya donusu engeller. */

  it('YAPISAL: bekleyen komutlar RPC ile okunur, tablo DOGRUDAN sorgulanmaz', () => {
    expect(commandListenerSrc, 'fetch_pending_vehicle_commands cagrisi kaldirilmis — arac kendi komutunu 0 satir gorur')
      .toMatch(/callVehicleRpc\(\s*'fetch_pending_vehicle_commands'/);
    expect(commandListenerSrc, 'vehicle_commands tablosu DOGRUDAN sorgulaniyor — anon ayricaligi YOK, sessizce bos doner')
      .not.toMatch(/\.from\(\s*'vehicle_commands'\s*\)/);
  });

  it('YAPISAL: komut durumu api_key RPC ile yazilir (REST PATCH ve error_reason YOK)', () => {
    expect(commandListenerSrc, 'updateRemoteCommandStatus baglantisi kopmus — durum yazma yolu tabloya geri donmus olabilir')
      .toMatch(/updateRemoteCommandStatus\(/);
    expect(commandListenerSrc, 'REST PATCH ile vehicle_commands guncelleniyor — anon ayricaligi YOK, istek RLS-e bile varmaz')
      .not.toMatch(/rest\/v1\/vehicle_commands/);
    /* `error_reason` push bildirim GOVDESINDE mesrudur (kolon degil). Yasak
       olan, onu bir DB GUNCELLEME alani gibi kullanmaktir. */
    expect(commandListenerSrc, 'error_reason DB guncelleme alani gibi yaziliyor — semada BOYLE BIR KOLON YOK (42703)')
      .not.toMatch(/updates\.error_reason|p_error_reason/);
    expect(commandListenerSrc, 'VehicleCommand arayuzu error_reason tasiyor — semadaki gercek ad error_message')
      .not.toMatch(/error_reason\?:/);
  });

  it('YAPISAL: Realtime tek tasiyici DEGIL — periyodik yoklama var', () => {
    /* Realtime `postgres_changes` olaylari da RLS'e tabidir -> anon istemci
       komut INSERT'unu HIC gormez. Yoklama "yedek" degil ASIL yoldur. */
    expect(commandListenerSrc, 'PENDING_POLL_MS kaldirilmis — anon istemcide Realtime olay uretmez, komut hic ulasmaz')
      .toMatch(/const PENDING_POLL_MS/);
    expect(commandListenerSrc, 'poll timer kurulmuyor — startPolling/setInterval kaldirilmis')
      .toMatch(/startPolling\(\): void \{[\s\S]{0,400}setInterval\(/);
    expect(commandListenerSrc, 'poll timer disconnect() icinde temizlenmiyor — zero-leak ihlali')
      .toMatch(/disconnect\(\): void \{[\s\S]{0,300}clearInterval\(this\.pollTimer\)/);
  });

  it('YAPISAL: kalici dinleyici bosta-kapatmayla oldurulemez (tek sahiplik)', () => {
    expect(commandListenerSrc, '_permanent sahiplik bayragi kaldirilmis — fcmService bosta sayaci pushService dinleyicisini kapatir')
      .toMatch(/let _permanent = false/);
    expect(commandListenerSrc, 'stopCommandListener force kapisi kaldirilmis — kalici dinleyici sessizce olur')
      .toMatch(/export function stopCommandListener\(force = false\)[\s\S]{0,200}if \(_permanent && !force\) return;/);
    expect(fcmServiceSrc, 'fcmService canli dinleyiciyi yeniden kuruyor — baglanti ve dedup kumesi sifirlanir')
      .toMatch(/if \(isCommandListenerActive\(\)\)\s*\{[\s\S]{0,200}triggerPendingPoll\(\);/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PAYLAŞILAN HEDEF — "araca gönder" ve WhatsApp konumu (saha 2026-08-21)
 *
 * Kullanıcı iki kusur bildirdi:
 *  ① "Arabam Cebimde" → Araca Gönder → araçta GOOGLE MAPS açılıyordu; aracın
 *     kendi navigasyonu bu yoldan HİÇ çağrılmıyordu.
 *  ② WhatsApp konumuna basınca Android seçicisinde CarOS Pro ÇIKMIYORDU —
 *     manifest'te `geo:` intent-filter'ı hiç yazılmamıştı.
 * Bu kilitler ikisinin de sessizce geri gelmesini engeller.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('REGRESYON: paylaşılan hedef aracın KENDİ navigasyonunda açılır', () => {
  it('YAPISAL: uzak rota komutu hedef kapısına gider (harici uygulamaya değil)', () => {
    expect(commandListenerSrcNav, 'handoff kapısı kaldırılmış — rota yine dışarı çıkar')
      .toMatch(/acceptHandoffDestination\(/);
    /* Eski kök: `route.provider_intent ?? 'google_maps'` — hiçbir şey seçilmese
       bile harici uygulama açılıyordu. */
    expect(commandListenerSrcNav.includes("provider_intent ?? 'google_maps'"),
      'varsayılan sağlayıcı yine Google Maps — kusurun kökü geri gelmiş').toBe(false);
    expect(commandListenerSrcNav, 'harici sağlayıcı beyaz listesi kaldırılmış')
      .toMatch(/EXTERNAL\.has\(provider\)/);
  });

  it('YAPISAL: hedef kapısı harici harita uygulaması AÇMAZ', () => {
    const code = handoffGateSrc
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code.includes('window.open'),
      'hedef kapısı harici uygulama açıyor — tek kapı sözleşmesi kırılmış').toBe(false);
    expect(code.includes('buildNavIntent'),
      'hedef kapısı geo: intent üretiyor — dışarı çıkış yolu açılmış').toBe(false);
    expect(handoffGateSrc, 'sahiplik USER_HANDOFF değil — aktif oturumda sessizce engellenir')
      .toMatch(/'USER_HANDOFF'/);
  });

  it('YAPISAL: AndroidManifest geo: paylaşımını KABUL EDER', () => {
    /* Bu filtre olmadan CarOS Pro "hangi uygulamayla açılsın" listesinde
       HİÇ GÖRÜNMEZ — kullanıcının bildirdiği kusurun tam kökü budur. */
    const manifest = readFileSync(
      resolve(__dirname, '../../android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest, 'geo: şeması kaldırılmış — konum paylaşımında uygulama listede çıkmaz')
      .toMatch(/android:scheme="geo"/);
    expect(manifest, 'google.navigation şeması kaldırılmış')
      .toMatch(/android:scheme="google\.navigation"/);
    /* Genel http/https FİLTRESİ konmamalı: launcher tüm web bağlantılarını
       üstlenirse kullanıcının tarayıcı seçimi gasp edilir.
       ⚠️ `<queries>` bloğundaki `<intent>` girdileri BAŞKA ŞEYDİR (Android 11
       paket görünürlüğü — "hangi uygulamalar http açabiliyor" sorgusu) ve
       hiçbir bağlantıyı üstlenmez. Bu yüzden yalnız `<intent-filter>`
       blokları taranır; ham metin araması ikisini karıştırırdı. */
    const filters = manifest.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? [];
    const unscoped = filters.filter((f) =>
      /scheme="https?"/.test(f) && !/android:host=/.test(f));
    expect(unscoped, 'kapsamsız http/https FİLTRESİ eklenmiş — launcher tüm bağlantıları üstlenir')
      .toHaveLength(0);
  });

  it('YAPISAL: MainActivity gelen konumu JS tarafina iletir (soguk acilis dahil)', () => {
    const mainActivity = readFileSync(
      resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro/MainActivity.java'),
      'utf8',
    );
    expect(mainActivity, 'konum intent işleyicisi kaldırılmış')
      .toMatch(/private void handleIncomingLocationIntent\(/);
    /* İKİ giriş de gerekli: onNewIntent (uygulama açıkken) ve onCreate (soğuk açılış). */
    expect(mainActivity, 'onNewIntent konumu işlemiyor — uygulama açıkken paylaşım düşer')
      .toMatch(/onNewIntent\(Intent intent\)[\s\S]{0,220}handleIncomingLocationIntent\(intent\)/);
    expect(mainActivity, 'soğuk açılışta gelen intent işlenmiyor')
      .toMatch(/handleIncomingLocationIntent\(getIntent\(\)\)/);
  });

  it('YAPISAL: telefon uygulamasında CarOS Pro bir SEÇENEK ve VARSAYILAN', () => {
    const pwa = readFileSync(
      resolve(__dirname, '../../website/src/components/dashboard/MobileCarControl.tsx'),
      'utf8',
    );
    expect(pwa, "CarOS Pro sağlayıcı seçeneği kaldırılmış — kullanıcı kendi navigasyonunu seçemez")
      .toMatch(/id: 'caros'/);
    expect(pwa, 'varsayılan sağlayıcı yine harici — "Araca Gönder" dışarı çıkar')
      .toMatch(/useState<NavProvider>\('caros'\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ARKA PLAN GÜÇ POLİTİKASI (saha ölçümü 2026-08-20 — Redmi Note 13 Pro 5G)
 *
 * Ölçülen kaçak: uygulama arka planda + araç park hâlindeyken JS konum akışı
 * HIGH_ACCURACY @10 s ile 6 s 16 dk kesintisiz çalıştı (86.422 fix) ve pasif
 * wake mikrofonu hiç susmadı (PARTIAL_WAKE_LOCK 'AudioIn'). Sonuç: 16 saatte
 * yalnız 169 dk deep sleep, 612 mAh/h tüketim, ekran KAPALI iken 5-8 dk'da %1.
 * Bu kilitler düzeltmenin sessizce geri alınmasını engeller.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('REGRESYON: arka plan güç politikası', () => {
  it('YAPISAL: JS konum akışı güç modu KISILABİLİR — enableHighAccuracy sabit true değil', () => {
    /* Eski hâl: `watchPosition({ enableHighAccuracy: true, ... })` sabit yazılıydı;
       arka planda GNSS'i uyandırmaya devam ediyordu. */
    expect(gpsServiceSrc, 'watch seçenekleri sabitlenmiş — güç moduna göre üretilmiyor')
      .toMatch(/function _nativeWatchOptions\(\)/);
    expect(gpsServiceSrc, 'kısık modda enableHighAccuracy kapatılmıyor — GNSS uyandırılmaya devam eder')
      .toMatch(/enableHighAccuracy:\s*!low/);
    expect(gpsServiceSrc, 'applyGpsPowerMode kaldırılmış — kapının GPS üzerinde tutamağı kalmaz')
      .toMatch(/export async function applyGpsPowerMode/);
  });

  it('YAPISAL: güç modu değişimi konumu SIFIRLAMAZ (stopGPSTracking yolu kullanılmaz)', () => {
    /* `stopGPSTracking` `location: null` yazar → üst katman "konum kayboldu"
       sanır. Mod değişimi yalnız watch'ı yeniden kurar. */
    /* Gövde sınırı bir sonraki tanımdır — sabit karakter penceresi KULLANILMAZ;
       hemen ardından gelen `stopGPSTracking` tanımı pencereye girip kilidi
       yanlış yere düşürürdü. */
    const fnIdx  = gpsServiceSrc.indexOf('export async function applyGpsPowerMode');
    const endIdx = gpsServiceSrc.indexOf('export async function stopGPSTracking', fnIdx);
    expect(fnIdx, 'applyGpsPowerMode bulunamadı').toBeGreaterThan(-1);
    expect(endIdx, 'stopGPSTracking bulunamadı — gövde sınırı belirsiz').toBeGreaterThan(fnIdx);
    const body = gpsServiceSrc.slice(fnIdx, endIdx);
    expect(body.includes('stopGPSTracking('),
      'applyGpsPowerMode stopGPSTracking çağırıyor — konum sıfırlanır, sahte "sinyal yok" üretir').toBe(false);
    expect(body.includes('location: null'),
      'applyGpsPowerMode location: null yazıyor — mod değişimi veri kaybı gibi görünür').toBe(false);
  });

  it('YAPISAL: pasif mikrofon güç nedeniyle duraklatılabilir ve etkileşim onu EZMEZ', () => {
    expect(wakeWordServiceSrc, 'pauseWakeWordForPower kaldırılmış — arka planda AudioIn wakelock geri gelir')
      .toMatch(/export function pauseWakeWordForPower/);
    expect(wakeWordServiceSrc, 'resumeWakeWordForPower kaldırılmış — öne dönünce wake sağır kalır')
      .toMatch(/export function resumeWakeWordForPower/);
    /* En sinsi regresyon: etkileşim duraklamasının 450 ms'lik resume timer'ı
       güç duraklaması sürerken mikrofonu ARKA PLANDA yeniden açardı. */
    expect(wakeWordServiceSrc, 'etkilesim resume timer guc duraklamasini eziyor — arka planda mikrofon acilir')
      .toMatch(/_interactionPaused = false;[\s\S]{0,400}if \(_powerPaused\) return;/);
  });

  it('YAPISAL: güç kaynağı Web Battery API\'sinden DEĞİL native\'den okunur', () => {
    /* SAHA (2026-08-20): `navigator.getBattery()` WebView'de gizlilik gerekçesiyle
       sabit `charging: true` döndürebiliyor. O hâlde kapı `external_power` dalına
       düşüp HİÇBİR ZAMAN kısma üretmiyordu — telefon pille çalışırken JS konum
       isteği `@+10s HIGH_ACCURACY` olarak kaldı (`dumpsys location` listeners). */
    /* Yorumlar elenir: NEDEN'i anlatan açıklama metni API adını anmak ZORUNDA;
       kilit yalnız gerçek ÇAĞRIYI yasaklar. */
    const gateCode = backgroundPowerGateSrc
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(gateCode.includes('getBattery'),
      'kapı Web Battery API kullanıyor — WebView sabit charging:true döndürüp kısmayı öldürür').toBe(false);
    expect(backgroundPowerGateSrc, 'native güç okuması kaldırılmış — güç durumu güvenilir kaynaktan gelmez')
      .toMatch(/getDeviceStatus\(\)/);
    /* Ön/arka plan için tek dayanak `appStateChange` DEĞİL: ekran kapanınca
       WebView her hâlükârda `visibilitychange` yayınlar. */
    expect(backgroundPowerGateSrc, 'görünürlük yedeği kaldırılmış — appStateChange düşerse kapı kör kalır')
      .toMatch(/visibilitychange/);
  });

  it('YAPISAL: ekran açık tutma bayrakları KOŞULSUZ değil — güce bağlı', () => {
    /* SAHA (2026-08-20, telefon): `FLAG_KEEP_SCREEN_ON` + `setTurnScreenOn(true)`
       onCreate'te koşulsuz uygulanıyordu. POWER tuşuna basılınca ekran kapanıyor,
       activity resumed olduğu için DERHAL geri açılıyordu → ekran hiç kapanmadı
       (`dumpsys power`: SCREEN_BRIGHT_WAKE_LOCK ws=WorkSource{10626}). Yan etki:
       uygulama hep "ön planda" sayıldığı için arka plan güç kısması da hiç
       çalışamıyordu. Head unit (sürekli besleme) davranışı korunur. */
    const mainActivity = readFileSync(
      resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro/MainActivity.java'),
      'utf8',
    );
    expect(mainActivity, 'ekran politikası metodu kaldırılmış — bayraklar yine koşulsuz olur')
      .toMatch(/private void applyScreenPowerPolicy\(\)/);
    /* onCreate gövdesinde ham bayrak KALMAMALI: tek yetkili nokta politika metodudur. */
    const createIdx = mainActivity.indexOf('protected void onCreate');
    const resumeIdx = mainActivity.indexOf('public void onResume');
    expect(createIdx, 'onCreate bulunamadı').toBeGreaterThan(-1);
    const onCreateBody = mainActivity.slice(createIdx, resumeIdx > createIdx ? resumeIdx : createIdx + 4000);
    expect(onCreateBody.includes('FLAG_KEEP_SCREEN_ON'),
      'onCreate ekranı koşulsuz açık tutuyor — pille çalışan telefonda ekran hiç kapanmaz').toBe(false);
    expect(onCreateBody.includes('setTurnScreenOn(true)'),
      'onCreate ekranı koşulsuz uyandırıyor — güç tuşu işlevsiz kalır').toBe(false);
    /* Kablo takılıp çıkarıldığında politika tazelenmeli. */
    expect(mainActivity, 'güç alıcısı kaldırılmış — kablo çıkınca politika eski hâlde kalır')
      .toMatch(/ACTION_POWER_DISCONNECTED/);
    expect(mainActivity, 'alıcı onDestroy\'da sökülmüyor — zero-leak ihlali')
      .toMatch(/onDestroy\(\)[\s\S]{0,200}unregisterPowerReceiver\(\)/);
  });

  it('YAPISAL: navigasyon köprüsü güç kapısını İMPORT ETMEZ (bağımlılık tek yönlü)', () => {
    /* Köprü kapıyı statik import ettiğinde navigasyon testleri kapının tüm
       zincirini (gpsService → wakeWordService → voiceService → ttsService)
       yüklemeye başladı ve 3 dosya / 8 test mock eksikliğinden düştü.
       Doğru yön: kapı köprüye KAYDOLUR, köprü hiçbir şey import etmez. */
    expect(navGpsPowerBridgeSrc.includes('backgroundPowerGate'),
      'köprü güç kapısını import ediyor — navigasyon testlerine ağır zincir sızar').toBe(false);
    expect(navGpsPowerBridgeSrc, 'gözlemci kayıt slotu kaldırılmış — kapı navigasyonu duyamaz')
      .toMatch(/export function setNavPowerObserver/);
    expect(systemBootSrc.length, 'SystemBoot okunamadı').toBeGreaterThan(0);
  });

  it('YAPISAL: güç kapısı boot zincirinde kurulu ve wake servisinden SONRA kayıtlı', () => {
    /* LIFO kapanış: kapı ONDAN ÖNCE sökülür → kapanırken kısma bırakılmaz. */
    expect(systemBootSrc, 'BackgroundPowerGate boot zincirinden çıkarılmış — politika hiç çalışmaz')
      .toMatch(/startBackgroundPowerGate\(\)/);
    const wakeIdx = systemBootSrc.indexOf('this._reg(startWakeWordService())');
    const gateIdx = systemBootSrc.indexOf('this._reg(startBackgroundPowerGate())');
    expect(wakeIdx, 'WakeWordService kaydı bulunamadı').toBeGreaterThan(-1);
    expect(gateIdx, 'BackgroundPowerGate kaydı bulunamadı').toBeGreaterThan(-1);
    expect(gateIdx, 'kapı wake servisinden ÖNCE kaydedilmiş — LIFO kapanışta wake ölüyken kısma bırakılır')
      .toBeGreaterThan(wakeIdx);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * KİLİT — NATIVE JAVA CI KAPISI (denetim 2026-08-21, kütük #675, plan V-01)
 *
 * BUG SINIFI: "yazılmış ama hiç koşmayan test". Depoda 25 Java test sınıfı /
 * 335 test yıllardır duruyordu; hiçbir workflow gradle çağırmıyordu. Kapı
 * eklendi — bu kilitler onun SESSİZCE geri alınmasını engeller.
 *
 * Bu kilitler Java'yı ÇALIŞTIRMAZ (vitest'in işi değil); kapının VARLIĞINI ve
 * CI'da kırılacağı bilinen üç bağımlılığın karşılandığını doğrular.
 * ══════════════════════════════════════════════════════════════════════ */
describe('KİLİT: native Java CI kapısı (#675)', () => {
  const repoRoot = resolve(__dirname, '../..');
  const rf = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
  const ci = rf('.github/workflows/main.yml');

  it('main.yml gradle JVM unit testlerini KOŞAR (job sessizce silinmemiş)', () => {
    expect(ci, 'android_unit_tests job\'ı main.yml\'den kaldırılmış — 335 Java testi tekrar kapısız')
      .toMatch(/android_unit_tests:/);
    expect(ci, 'gradle test görevi çağrısı yok — job var ama hiçbir şey koşmuyor')
      .toMatch(/gradlew\s+:app:testDebugUnitTest/);
    expect(ci, 'phonehub-protocol testleri kapı dışında bırakılmış')
      .toMatch(/:phonehub-protocol:test/);
  });

  it('güvenlik-kritik Java suite kapısı duruyor (4 suite adıyla aranıyor)', () => {
    /* Bir suite sessizce düşerse/atlanırsa XML'de sınıfı bulunmaz → build bloke.
       McuCommandWhitelistTest fiziksel komut whitelist'ini (kilit/korna/alarm)
       koruyan tek otomatik kapıdır; listeden çıkarılması regresyondur. */
    for (const suite of [
      'McuCommandWhitelistTest', 'ElmProtocolTest',
      'BootReceiverActionGateTest', 'SessionCryptoTest',
    ]) {
      expect(ci, `${suite} otomotiv-kritik Java suite listesinden çıkarılmış`).toContain(suite);
    }
  });

  it('"0 test = başarı" deliği kapalı ve sayaç bc\'ye BAĞLI DEĞİL', () => {
    /* İlk yazımda sayım `bc` ile yapılıyordu; `bc` olmayan ortamda çıktı
       SESSİZCE boş kalıp adım YEŞİL geçiyordu (ölçüldü, Git Bash). */
    expect(ci, 'sayaç yine `bc`ye bağlanmış — eksikse adım sessizce yeşil geçer')
      .not.toMatch(/paste -sd\+ \| bc/);
    expect(ci, 'toplam test sayısı 0 iken bloke eden kapı kaldırılmış')
      .toMatch(/total.*-le 0|-le 0.*total/s);
  });

  it('CI\'da kırılan ÜÇ gizli bağımlılık karşılanmış durumda', () => {
    /* 1) capacitor-cordova-android-plugins .gitignore'lu ama settings.gradle
          onu include ediyor → taze checkout'ta KONFİGÜRASYON DÜŞER.
          `cap update` onu üretir; `cap sync` DEĞİL (sync dist/ ister). */
    expect(ci, 'cap update adımı kaldırılmış — taze checkout\'ta gradle konfigürasyonu düşer')
      .toMatch(/cap update android/);
    expect(ci, 'cap sync kullanılmış — dist/ gerektirir, unit test job\'ını gereksiz yere build\'e bağlar')
      .not.toMatch(/cap sync android/);

    /* 2) gradlew Linux'ta çalıştırılabilir olmalı (git modu 100755 + chmod). */
    expect(ci, 'chmod +x gradlew savunması kaldırılmış').toMatch(/chmod \+x android\/gradlew/);

    /* 3) buildDir Windows mutlak yolu OS-koşullu kalmalı; koşulsuz hâline
          dönerse Linux runner proje altında "C:" adlı klasör üretir. */
    const rootGradle = rf('android/build.gradle');
    expect(rootGradle, 'buildDir tekrar KOŞULSUZ C:/Temp\'e bağlanmış — Linux CI kırılır')
      .toMatch(/if \(usesWindowsTempBuildDir\)/);
    expect(rootGradle, 'os.name karşılaştırması Locale.ROOT\'suz — tr-TR\'ye bağımlılık geri gelmiş')
      .toMatch(/toLowerCase\(java\.util\.Locale\.ROOT\)/);
  });

  it('Java test kaynakları hâlâ yerinde (kapı boş kümeyi korumasın)', () => {
    /* Kapı var ama test dosyaları silinmişse kapı hiçbir şey korumuyordur. */
    const appTests = resolve(repoRoot, 'android/app/src/test/java/com/cockpitos/pro');
    expect(existsSync(appTests), 'android app birim test dizini yok').toBe(true);
    expect(existsSync(resolve(appTests, 'can/McuCommandWhitelistTest.java')),
      'McuCommandWhitelistTest silinmiş — fiziksel komut whitelist\'i korumasız').toBe(true);
    expect(existsSync(resolve(repoRoot,
      'android/phonehub-protocol/src/test/java/com/cockpitos/phonehub/protocol/SessionCryptoTest.java')),
      'SessionCryptoTest silinmiş').toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * KİLİT: website test kapısı (#713)
 *
 * ESKİ DURUM: `website/src/__tests__` altında 64 dosya / 1.309 kilit ve
 * `website/vitest.config.ts` koşucusu VARDI — ama `website.yml` yalnız
 * `npm run build` yapıyordu. Testler yazılmış, koşucu kurulmuş, ama KAPI
 * DEĞİLDİ: website'te bir regresyon sessizce yayına gidebilirdi. Bu, depoda
 * defalarca bulunan "motor var, besleyen yok" deseninin CI'daki hâlidir.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT: website test kapısı (#713)', () => {
  const repoRoot = resolve(__dirname, '../..');
  const rf = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');
  const ci = rf('.github/workflows/website.yml');

  it('website.yml testleri GERÇEKTEN koşar (job sessizce silinmemiş)', () => {
    expect(ci, 'test job\'ı website.yml\'den kaldırılmış — 1.309 website kilidi tekrar kapısız')
      .toMatch(/^\s{2}test:/m);
    expect(ci, 'job var ama test komutu yok — hiçbir şey koşmuyor')
      .toMatch(/run:\s*npm run test/);
  });

  it('testler `website` dizininden koşar — yol tuzağı geri gelmemiş', () => {
    /* Testler dosya yollarını `process.cwd()` üzerinden kurar. Kökten
       koşulursa 18 dosya ENOENT ile düşer; bu bir ÜRÜN KUSURU DEĞİL, yanlış
       çalışma dizinidir. `working-directory` düşerse CI kırmızıya döner ve
       sebebi yanlış teşhis edilir. */
    /* DİKKAT — bu kilidin ilk hâli SAHTEYDİ: `working-directory: website
       [\s\S]* run: npm run test` deseni, KURULUM adımındaki
       `working-directory`yi test adımınınkiyle eşleştiriyordu ve
       `working-directory` test adımından silinince bile GEÇİYORDU.
       Mutasyonla yakalandı. Artık adım adım ayrıştırılır. */
    const testJob = ci.slice(ci.indexOf('  test:'));
    const steps = testJob.split(/^\s{6}- /m);
    const runStep = steps.find((st) => /run:\s*npm run test/.test(st));
    expect(runStep, 'test job içinde `npm run test` adımı yok').toBeDefined();
    expect(runStep, 'test ADIMINDA `working-directory: website` yok — yol tuzağına düşülür')
      .toMatch(/working-directory:\s*website/);
  });

  it('KÖK bağımlılıkları da kurulur — `vitest` yalnız kökte tanımlı', () => {
    /* `website/package.json` vitest/jsdom İÇERMEZ (bilinçli: kökteki React 19
       ile website'in React 18'i karışmasın). Yalnız website kurulursa CI'da
       `vitest: not found` alınır. */
    const testJob = ci.slice(ci.indexOf('  test:'));
    const installs = testJob.match(/npm ci/g) ?? [];
    expect(installs.length, 'tek kurulum var — kök vitest kurulmadan test koşamaz')
      .toBeGreaterThanOrEqual(2);
  });

  it('`ci/**` tetikleyicisi duruyor — kapı KENDİ DALINDA kanıtlanabilsin', () => {
    /* main.yml ile aynı gerekçe: bir workflow'un push tetikleyicisi PUSH EDİLEN
       DALDAKİ dosyadan okunur. Bu satır olmadan yeni bir job'ın gerçekten
       koştuğu ancak main'e girdikten SONRA görülür — kapının kendisi kapıdan
       geçmeden yayına alınmış olur. */
    expect(ci, "website.yml'den `ci/**` tetikleyicisi kaldırılmış")
      .toMatch(/branches:\s*\[main, dev, 'ci\/\*\*'\]/);
  });

  it('website test kaynakları hâlâ yerinde (kapı boş kümeyi korumasın)', () => {
    const dir = resolve(repoRoot, 'website/src/__tests__');
    expect(existsSync(dir), 'website test dizini yok').toBe(true);
    expect(existsSync(resolve(repoRoot, 'website/vitest.config.ts')),
      'website/vitest.config.ts silinmiş — koşucu yok, kapı boşa çalışır').toBe(true);
  });

  it('`npm run test` betiği website/package.json\'da duruyor', () => {
    const pkg = JSON.parse(rf('website/package.json')) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.test, 'website/package.json\'dan `test` betiği kaldırılmış')
      .toMatch(/vitest/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * P0-001A — CİHAZ KİMLİĞİ SERTLEŞTİRME KİLİTLERİ
 *
 * Üç bağımsız açık kapatıldı (migration 072). Hepsi SESSİZCE geri gelebilir:
 * bir `CREATE OR REPLACE` eski gövdeyi tazeleyebilir, bir "hızlı düzeltme"
 * kalıcı kod dalını geri koyabilir, kapatılan bir rota yeniden açılabilir.
 * Bu kilitler o üç geri dönüşü yakalar.
 *
 * NOT: SQL DAVRANIŞI bu dosyada değil, gerçek PostgreSQL'e karşı koşan
 * `supabase/tests/069_p0_001a_identity_matrix.sql` matrisinde kanıtlanır
 * (`npm run test:identity`). Buradakiler yalnız KAYNAK-METİN kilitleridir —
 * metin kilidi davranış kanıtı DEĞİLDİR ve onun yerine geçmez.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('P0-001A · cihaz kimliği sertleştirme', () => {
  const MIG = 'supabase/migrations/20260822000072_p0_001a_identity_hardening.sql';

  it('migration ve matris dosyaları duruyor', () => {
    expect(existsSync(resolve(root, MIG)), 'P0-001A migration silinmiş').toBe(true);
    expect(existsSync(resolve(root, 'supabase/tests/069_p0_001a_identity_matrix.sql')),
      'P0-001A matrisi silinmiş — kapı kanıtsız kalır').toBe(true);
  });

  it('`register_vehicle` mevcut aracın anahtarını OKUMUYOR', () => {
    /* Eski gövde: SELECT id, coalesce(api_key_hash, api_key) … WHERE device_name = …
       Kayıtlı bir device_id bilen HERKES aracın ham cihaz anahtarını alıyordu. */
    const sql = read(MIG);
    const fn = sql.slice(sql.indexOf('FUNCTION public.register_vehicle'));
    const body = fn.slice(0, fn.indexOf('$fn$;') + 5)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // blok yorumları at
      .replace(/--[^\n]*/g, ' ');           // satır yorumlarını at
    expect(body, 'register_vehicle yeniden mevcut anahtarı okuyor')
      .not.toMatch(/coalesce\s*\(\s*api_key_hash\s*,\s*api_key\s*\)/i);
    expect(body, 'already_provisioned sözleşmesi kaldırılmış')
      .toContain('already_provisioned');
  });

  it('eşleştirmede KALICI `pairing_code` dalı geri gelmemiş', () => {
    const sql = read(MIG);
    const fn = sql.slice(sql.indexOf('FUNCTION public.pair_vehicle_to_user'));
    const body = fn.slice(0, fn.indexOf('$fn$;') + 5)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ');
    expect(body, 'kalıcı pairing_code arka kapısı yeniden açılmış')
      .not.toMatch(/pairing_code/i);
    expect(body, 'kısa ömürlü kod tablosu tek otorite olmalı')
      .toContain('vehicle_linking_codes');
  });

  it('`register_vehicle` PUBLIC yerine AÇIK role verilmiş (anon korunur)', () => {
    const sql = read(MIG);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.register_vehicle\(text, text\) FROM PUBLIC/);
    /* anon KALDIRILAMAZ: cihaz Supabase'e oturumsuz, anon anahtarıyla bağlanır.
       Bu satır silinirse saha cihazlarının tamamı bootstrap edemez. */
    expect(sql, 'anon GRANT kaldırılmış — cihaz bootstrap kırılır')
      .toMatch(/GRANT EXECUTE ON FUNCTION public\.register_vehicle\(text, text\)\s*\n?\s*TO anon/);
  });

  it('cihaz istemcisi `api_key` alanını KOŞULLU işliyor (yoksa saklıya dokunmaz)', () => {
    /* Sunucu artık mevcut cihazda `api_key` DÖNDÜRMEZ. İstemci bunu koşulsuz
       yazsaydı saklı anahtarı `undefined` ile ezer ve cihazı kilitlerdi. */
    const src = read('src/platform/vehicleIdentityService.ts');
    expect(src).toMatch(/if\s*\(\s*data\.api_key\s*\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * P0-001C — CİHAZ KİMLİĞİNİN REINSTALL DAYANIKLILIĞI
 *
 * Davranış kanıtı `deviceIdentityPersistence.test.ts` dosyasındadır (13 test,
 * iki mutasyonla doğrulandı). Buradakiler o davranışı SESSİZCE bozabilecek
 * dört yapısal değişikliği kilitler.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('P0-001C · cihaz kimliği kalıcılığı', () => {
  const VIS = 'src/platform/vehicleIdentityService.ts';

  it('KİLİT: SAKLI kimlik TÜRETMEDEN ÖNCE okunur', () => {
    /* Sıra tersine dönerse, SSAID türevi sahadaki 838 cihazın saklı kimliğini
       EZER ve hepsi yeni araç açar — düzeltmenin önlemek istediği felaketin
       aynısı. Sıra bu fonksiyonun tamamıdır, tek satır değil. */
    const src = read(VIS);
    const fn = src.slice(src.indexOf('async function _getOrCreateDeviceId'));
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    const storedAt  = body.indexOf('sensitiveKeyStore.get(SK_DEVICE_ID)');
    const derivedAt = body.indexOf('_deriveStableDeviceId()');
    expect(storedAt, 'saklı kimlik okuması kaldırılmış').toBeGreaterThan(-1);
    expect(derivedAt, 'SSAID türetmesi kaldırılmış').toBeGreaterThan(-1);
    expect(storedAt, 'SIRA BOZULDU: türetme saklı kimliği ezer').toBeLessThan(derivedAt);
  });

  it('KİLİT: ham `veh_api_key` KURTARMA katmanlarına EKLENMEMİŞ', () => {
    /* Reinstall'da anahtarın da geri gelmesi cazip görünür, ama RECOVERY_KEYS
       iki hedefe yazar: Android Auto Backup (Google Drive) ve `/sdcard`'daki
       cihaz-içi blob. İkincisinin şifresi SSAID'den türer — SSAID gizli
       DEĞİLDİR. Ham cihaz kimlik bilgisini oraya koymak, onu kopyalanabilir
       bir dosyaya çevirir. Kimliğin kalıcılığı TÜRETMEYLE çözüldü; anahtarın
       geri kazanımı sunucu tarafı bir iştir (P0-001D/K). */
    const src = read('src/platform/sensitiveKeyStore.ts');
    const line = src.slice(src.indexOf('const RECOVERY_KEYS'));
    const decl = line.slice(0, line.indexOf('];') + 2);
    expect(decl, 'ham cihaz anahtarı yedeklenen katmana eklenmiş').not.toContain('veh_api_key');
    expect(decl, 'cihaz kimliği yedek dosyasına eklenmiş — türetme yeterli')
      .not.toContain('veh_device_id');
  });

  it('KİLİT: cihaz kimliği KRİPTOGRAFİK rastgelelikten üretilir', () => {
    const src = read(VIS);
    const fn = src.slice(src.indexOf('function _uuid()'));
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    expect(body, 'getRandomValues kaldırılmış — Math.random tahmin edilebilir')
      .toContain('getRandomValues');
  });

  it('KİLİT: native `getStableDeviceId` köprüsü duruyor ve ham SSAID döndürmüyor', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(java, 'native kararlı kimlik metodu silinmiş').toContain('public void getStableDeviceId');
    /* Ham SSAID JS'e çıkarsa kalıcı bir cihaz tanımlayıcısı sunucuya sızar.
       Gövde, BİR SONRAKİ @PluginMethod'a kadar kesilir — Java'da kapanış
       parantezine göre kesmek metodun ilk `if` bloğunda yanlış duruyordu. */
    const fn = java.slice(java.indexOf('public void getStableDeviceId'));
    const next = fn.indexOf('@PluginMethod');
    const body = next > 0 ? fn.slice(0, next) : fn;
    expect(body, 'ham SSAID yanıta konmuş').not.toMatch(/result\.put\(\s*"deviceId"\s*,\s*ssaid\s*\)/);
    expect(body, 'SHA-256 türetmesi kaldırılmış').toContain('SHA-256');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * P0-001B — E2E AÇIK ANAHTAR YAYINI
 *
 * Davranış kanıtı `e2eKeyPublish.test.ts` (13 test) ve gerçek PostgreSQL
 * matrisi `supabase/tests/070_e2e_key_publish_matrix.sql` (7 halka) içindedir.
 * Buradakiler o zinciri SESSİZCE koparabilecek değişiklikleri kilitler.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('P0-001B · E2E açık anahtar yayını', () => {
  const CL = 'src/platform/commandListener.ts';

  it('migration ve matris dosyaları duruyor', () => {
    expect(existsSync(resolve(root, 'supabase/migrations/20260822000073_e2e_public_key_publish_p0_001b.sql')),
      'P0-001B migration silinmiş').toBe(true);
    expect(existsSync(resolve(root, 'supabase/tests/070_e2e_key_publish_matrix.sql')),
      'P0-001B matrisi silinmiş — kapı kanıtsız kalır').toBe(true);
  });

  it('KİLİT: yayın RPC ile yapılır — `vehicles` tablosuna doğrudan UPSERT YOK', () => {
    /* Doğrudan UPSERT iki nedenle ölüydü: kolon yoktu ve araç `anon` ile
       bağlandığı için `vehicles` UPDATE politikası 0 satır etkiliyordu.
       Geri gelirse fiziksel komutlar yeniden sessizce ölür. */
    const src = read(CL);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code, 'yayın `publish_device_public_key` RPC çağrısını kaybetmiş')
      .toContain('publish_device_public_key');
    expect(code, "`vehicles` tablosuna doğrudan UPSERT geri gelmiş")
      .not.toMatch(/from\(\s*['"]vehicles['"]\s*\)\s*\.\s*upsert/);
  });

  it('KİLİT: yayın sonucu ÖLÇÜLÜYOR — sessiz `catch` geri gelmemiş', () => {
    /* Kusurun iki yıl görünmemesinin sebebi tam olarak yutulan hataydı. */
    const src = read(CL);
    for (const alan of ['keyPublishRuns', 'keyPublishOk', 'keyPublishOutcome', 'keyPublishReason']) {
      expect(src, `kanıt alanı kaldırılmış: ${alan}`).toContain(alan);
    }
  });

  it('KİLİT: kritik komutlarda E2E zorunluluğu ve fallback yasağı duruyor', () => {
    /* Bu tur yayını ONARDI; şifreleme ZORUNLULUĞUNU gevşetmedi. Bir
       "geçici olarak düz metne izin ver" yaması bu kilidi düşürür. */
    const src = read(CL);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code, 'E2E zorunlu komut listesi kaldırılmış')
      .toContain('E2E_REQUIRED_COMMANDS');
    expect(code, 'E2E olmayan kritik komut artık reddedilmiyor')
      .toMatch(/E2E_REQUIRED_COMMANDS\.includes\(cmd\.type\)\s*&&\s*!isE2EPayload\(payload\)/);
    expect(code, 'crypto_failed dönüşü kaldırılmış — düz metin sızabilir')
      .toContain("outcome: 'crypto_failed'");
  });

  it('KİLİT: LAB ekranı kayıtlı ve gözlem katmanı ham sır TAŞIMIYOR', () => {
    const cat = read('src/platform/devtools/carosLabCatalog.ts');
    expect(cat, 'LAB kataloğundan device-identity kaldırılmış').toContain("id: 'device-identity'");
    const map = read('src/components/devtools/carosLabScreenMap.tsx');
    expect(map, 'ekran eşlemesi kaldırılmış').toContain("case 'device-identity'");

    /* Gözlem katmanı VAR/YOK · ADET · DURUM taşır; ham sır ASLA. */
    const srcLayer = read('src/platform/devtools/deviceIdentityLabSources.ts');
    const code = srcLayer.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code, 'gözlem katmanına ham cihaz anahtarı girmiş').not.toContain('veh_api_key');
    expect(code, 'gözlem katmanına açık anahtarın kendisi girmiş').not.toContain('pubKeyB64');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-01 · OBD DATA BRIDGE — üç ölçülmüş kusurun kilitleri (2026-08-22)

   Bu tur, "okunabilen ama hiçbir yere ULAŞMAYAN OBD verisi" kusurunu kapattı.
   Aşağıdaki kilitler kusurun SESSİZCE geri gelmesini engeller: üçünün de ortak
   özelliği, bozulduklarında hiçbir şeyin PATLAMAMASI — yalnız kararların veri
   görmemesiydi. Tam olarak bu yüzden kilitlenirler.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-01 · OBD Veri Köprüsü kilitleri', () => {
  const CAT    = 'src/platform/obd/canonicalObdSignals.ts';
  const BRIDGE = 'src/platform/vehicleDataLayer/obdSignalBridge.ts';
  const AUTH   = 'src/platform/vehicleDataLayer/canonicalVehicleSignal.ts';
  const SAFETY = 'src/platform/safety/safetyStateMapper.ts';
  const VDL    = 'src/platform/vehicleDataLayer/index.ts';
  const STORE  = 'src/platform/vehicleDataLayer/UnifiedVehicleStore.ts';

  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: köprü VehicleDataLayer yaşam döngüsüne BAĞLI (başlat + temizle)', () => {
    /* Köprü hiç başlatılmazsa OBD sinyalleri mağazaya ULAŞMAZ ve hiçbir hata
       görünmez — sessiz ölüm. Temizlik kaybolursa zero-leak sözleşmesi düşer. */
    const code = strip(read(VDL));
    expect(code, 'köprü başlatma kaldırılmış').toContain('startObdSignalBridge()');
    expect(code, 'köprü temizliği kaldırılmış').toContain('cleanupObdBridge()');
  });

  it('KİLİT: Guardian motor ısısı ve akü voltajını TEK OTORİTEDEN okur', () => {
    /* ESKİDEN yalnız `canCoolantTemp`/`canBatteryVolt` okunuyordu → CAN'ı olmayan
       (aftermarket ELM327'li) araçta aşırı ısınma ve akü kuralları KALICI ÖLÜYDÜ.
       Ham CAN alanına geri dönüş bu kilidi düşürür. */
    const code = strip(read(SAFETY));
    /* P0-OBD-02'de GÜÇLENDİ: artık `resolveLive…` çağrılır (bayat okuma da elenir).
       Kilit kaldırılmadı, yeni doğru davranışa GÜNCELLENDİ. */
    expect(code, 'kanonik otorite çağrısı kaldırılmış')
      .toMatch(/resolveLiveCanonicalSignal\(v,\s*'coolantTemp'/);
    expect(code, 'kanonik otorite çağrısı kaldırılmış')
      .toMatch(/resolveLiveCanonicalSignal\(v,\s*'batteryVolt'/);
    expect(code, 'ham CAN alanı okumasına geri dönülmüş')
      .not.toMatch(/coolantTemp:\s*v\.canCoolantTemp/);
    expect(code, 'ham CAN alanı okumasına geri dönülmüş')
      .not.toMatch(/batteryVolt:\s*v\.canBatteryVolt/);
  });

  it('KİLİT: öncelik SEÇİMİ saf ve tek yerdedir (obdService içine geri gömülmemiş)', () => {
    /* Kural `obdService` içine gömülüyken KİLİTLENEMİYOR, dolayısıyla sessizce
       geri dönebiliyordu — kusurun görünmez kalma sebebi buydu. */
    expect(strip(read(CAT)), 'saf seçim fonksiyonu kaldırılmış')
      .toContain('export function selectPrioritizedExtendedPids');
    const svc = strip(read('src/platform/obdService.ts'));
    expect(svc, 'obdService kendi seçim döngüsüne geri dönmüş')
      .toContain('selectPrioritizedExtendedPids(');
  });

  it('KİLİT: sahte veri kapıları duruyor — sentinel · canlılık · sıfırlama', () => {
    const code = strip(read(BRIDGE));
    expect(code, 'canlılık kapısı kaldırılmış — bayat snapshot mağazaya sızar')
      .toContain('isObdReadingLive');
    expect(code, 'yazım kısıtı kaldırılmış — 5 Hz mağaza uyandırması geri gelir')
      .toContain('CORE_WRITE_MIN_MS');
    expect(code, 'bağlantı düşünce sinyaller düşürülmüyor — sahte tazelik')
      .toContain('resetObdSignals()');
    /* Sıfırlama 0 YAZMAMALI: 0 °C yağ sıcaklığı bir ÖLÇÜMDÜR ve kural tetikler. */
    const store = strip(read(STORE));
    expect(store, 'resetObdSignals sahte 0 yazmaya başlamış')
      .toContain('EMPTY_OBD_SIGNALS');
    /* P0-OBD-02'de kayıt şekli değişti (değer + damga tek nesnede) — kapı da
       İKİSİNİ birden denetler. Kilit yeni sözleşmeye GÜNCELLENDİ. */
    expect(store, 'sonlu olmayan değer kapısı kaldırılmış')
      .toContain('Number.isFinite(e.value)');
    expect(store, 'sonlu olmayan DAMGA kapısı yok — "değer yeni, damga bozuk" sızabilir')
      .toContain('Number.isFinite(e.atMs)');
  });

  it('KİLİT: otorite sırası CAN → OBD → yok (sahte 0 dönüşü YOK)', () => {
    const code = strip(read(AUTH));
    expect(code, 'CAN önceliği kaldırılmış').toMatch(/source:\s*'CAN'/);
    expect(code, 'OBD yedeği kaldırılmış').toMatch(/source:\s*'OBD'/);
    expect(code, 'kanıtsız durumda sahte değer dönüyor')
      .toMatch(/value:\s*null,\s*source:\s*'NONE'/);
  });

  it('KİLİT: LAB gözlem ekranı kayıtlı ve SALT-OKUNUR kalmış', () => {
    expect(read('src/platform/devtools/carosLabCatalog.ts'), 'katalogdan kaldırılmış')
      .toContain("id: 'obd-data-bridge'");
    expect(read('src/components/devtools/carosLabScreenMap.tsx'), 'ekran eşlemesi kaldırılmış')
      .toContain("case 'obd-data-bridge'");
    /* Gözlem katmanı hiçbir şey BAŞLATMAZ: sorgu/izleyici/burst çağrısı YASAK. */
    const src = strip(read('src/platform/devtools/obdBridgeLabSources.ts'));
    expect(src, 'gözlem katmanı PID izlemeye başlamış').not.toContain('watchPid');
    expect(src, 'gözlem katmanı BURST açıyor').not.toContain('setDiagnosticBurst');
    expect(src, 'gözlem katmanı köprüyü başlatıyor').not.toContain('startObdSignalBridge');
    expect(src, 'gözlem katmanı mağazaya yazıyor').not.toContain('updateObdSignals');
  });

  it('KİLİT: hat bütçesi SABİT SLOTLA değil, scheduler sözleşmesiyle korunuyor', () => {
    /* ── KİLİT NEDEN DEĞİŞTİ (kaldırılmadı, GÜNCELLENDİ) ────────────────────
       Eski kilit `ELM_WATCH_CAP = 16` sabitini arıyordu. O tavan bir BÜTÇE aracı
       DEĞİL, kör bir kırpmaydı: liste ARTAN PID NUMARASIYLA dolduğu için sekiz O2
       voltajı (14-1B) slotları tüketiyor, yağ sıcaklığı (5C) · modül voltajı (42) ·
       ortam ısısı (46) · yakıt debisi (5E) listeye HİÇ giremiyordu — yani tavan
       "hangi 16" sorusunu KANITSIZ yanıtlıyordu.

       P0-OBD-CORE-02 bunu tersine çevirdi: aday kümesi bitmap ile KANITLI ve
       registry'de ÇÖZÜLEBİLİR olan tüm PID'lerdir; kaç tanesinin bu turda hatta
       çıkacağına ölçülen RTT · hedef tazelik deadline'ı ve tur hat bütçesi karar
       verir. Bütçe disiplini KAYBOLMADI — sabitten ölçüme taşındı.

       Bu kilit artık üç şeyi birden korur:
         (1) sabit sayısal ürün tavanı GERİ DÖNEMEZ,
         (2) aday kümesi registry kapsamından TÜRER (elle yazılmış liste değil),
         (3) scheduler'ın bütçe/deadline/RTT sözleşmesi native'de DURUR ve
             poll döngüsüne GERÇEKTEN bağlıdır (ölü kod değil). */
    const ext = strip(read('src/platform/obd/extendedPidService.ts'));

    /* (1)+(2) Tavan registry boyutundan türüyor; sabit sayı ATANMIYOR. */
    expect(ext, 'tavan registry kapsamından türetilmiyor')
      .toContain('export const ELM_WATCH_CAP = STANDARD_PID_MAP.size');
    expect(ext, 'BURST tavanı registry kapsamından türetilmiyor')
      .toContain('export const ELM_WATCH_CAP_BURST = STANDARD_PID_MAP.size');
    /* Sabit sayısal tavan hiçbir isim altında geri gelmemeli (kopya sabit dahil). */
    expect(ext, 'sabit sayısal PID tavanı geri gelmiş')
      .not.toMatch(/ELM_WATCH_CAP(_BURST)?\s*(:\s*number\s*)?=\s*\d+/);

    /* Aday kümesi hâlâ KANIT kapılı: bitmap yoksa sorgu yok, tanımsız PID gitmez. */
    expect(ext, 'desteklenme kanıtı kapısı kaldırılmış').toContain('_supported.has(pid)');
    expect(ext, 'registry kapısı kaldırılmış').toContain('STANDARD_PID_MAP.has(pid)');

    /* (3) Scheduler sözleşmesi native'de duruyor. */
    const sched = read('android/app/src/main/java/com/cockpitos/pro/obd/AdaptivePidScheduler.java');
    expect(sched, 'deadline sınıfları kaldırılmış').toMatch(/HOT_MS[\s\S]*MEDIUM_MS[\s\S]*SLOW_MS[\s\S]*ARCHIVAL_MS/);
    expect(sched, 'RTT ölçümü kaldırılmış').toContain('ewmaRttMs');
    expect(sched, 'hat bütçeli plan kaldırılmış').toContain('plan(long now, long budgetMs, int maxCommands');

    /* ...ve poll döngüsüne GERÇEKTEN bağlı (dosyanın varlığı kanıt değildir). */
    const mgr = read('android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java');
    expect(mgr, 'scheduler poll planına bağlı değil').toContain('adaptivePidScheduler.plan(');
    expect(mgr, 'scheduler sonuç geri beslemesi yok').toContain('adaptivePidScheduler.record(');
    expect(mgr, 'aday kümesi scheduler\'a verilmiyor').toContain('adaptivePidScheduler.configure(');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-02 · OBD TAZELİK / SAĞLIK — dört kusurun kilitleri (2026-08-22)

   Bu turun kapattığı kusurların ortak özelliği: bozulduklarında hiçbir şey
   PATLAMAZ. Bayat bir sayı ekranda durur, koparılmış bir hattın son değeriyle
   karar verilir, çalışan bir PID "bayat" görünür. Hepsi SESSİZ — bu yüzden
   kilitlenirler.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-02 · OBD tazelik/sağlık kilitleri', () => {
  const POLICY = 'src/platform/obd/obdFreshnessPolicy.ts';
  const BRIDGE = 'src/platform/vehicleDataLayer/obdSignalBridge.ts';
  const AUTH   = 'src/platform/vehicleDataLayer/canonicalVehicleSignal.ts';
  const SAFETY = 'src/platform/safety/safetyStateMapper.ts';
  const HOOK   = 'src/platform/safety/useSafetyAlerts.ts';
  const EXT    = 'src/platform/obd/extendedPidService.ts';
  const CAT    = 'src/platform/obd/canonicalObdSignals.ts';
  const STORE  = 'src/platform/vehicleDataLayer/UnifiedVehicleStore.ts';

  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: SABİT 15 sn bayatlık eşiği geri gelmemiş', () => {
    /* Tek sabit hem sahte alarm (yavaş PID "bayat") hem sessiz yalan (hızlı
       sinyalin 14 sn gecikmesi "canlı") üretiyordu. */
    const ext = strip(read(EXT));
    expect(ext, 'sabit 15_000 eşiği geri konmuş')
      .not.toMatch(/getPidStatus\([^)]*staleMs\s*=\s*15_?000/);
    expect(ext, 'kadans-türevli varsayılan kaldırılmış')
      .toContain('_defaultStaleMs');
    expect(strip(read(POLICY)), 'rotasyon toleransı kaldırılmış')
      .toContain('EXT_ROTATION_TOLERANCE');
  });

  it('KİLİT: iki aşamalı çürüme duruyor — STALE ile UNAVAILABLE BİRLEŞTİRİLMEMİŞ', () => {
    const p = strip(read(POLICY));
    expect(p).toContain('STALE_TO_UNAVAILABLE_FACTOR');
    expect(p, 'üç durumdan biri kaldırılmış').toMatch(/'LIVE'\s*\|\s*'STALE'\s*\|\s*'UNAVAILABLE'/);
  });

  it('KİLİT: karar yüzeyi BAYAT ölçümü kullanmıyor (fail-closed)', () => {
    /* `resolveCanonicalSignal` STALE'de DEĞERİ döndürür (gösterim için). Karar
       yolları `resolveLive…` kullanmak ZORUNDA — aksi hâlde bayat bir motor
       ısısıyla aşırı ısınma alarmı üretilir. */
    const auth = strip(read(AUTH));
    expect(auth, 'karar yüzeyi kaldırılmış').toContain('export function resolveLiveCanonicalSignal');
    const safety = strip(read(SAFETY));
    expect(safety, 'Guardian bayat okumaya geri dönmüş')
      .toMatch(/resolveLiveCanonicalSignal\(v,\s*'coolantTemp'/);
    expect(safety, 'Guardian bayat okumaya geri dönmüş')
      .toMatch(/resolveLiveCanonicalSignal\(v,\s*'batteryVolt'/);
    /* P0-OBD-03: akü zinciri TEK fonksiyona taşındı (`resolveBatteryVoltage`),
       o da içeride `resolveLiveCanonicalSignal` kullanır. Kilit yeni yapıya
       GÜNCELLENDİ — hook artık kendi önceliğini YAZMAMALI. */
    const batt = strip(read('src/hooks/useBatteryVoltage.ts'));
    expect(batt, 'akü göstergesi tek zinciri kullanmıyor')
      .toContain('resolveBatteryVoltage');
    expect(strip(read(AUTH)), 'tek akü zinciri kaldırılmış')
      .toContain('export function resolveBatteryVoltage');
  });

  it('KİLİT: duvar saati Guardian zincirinde GERÇEKTEN taşınıyor', () => {
    /* Mapper saf kalsın diye damgayı çağıran verir. Hook bunu unutursa mapper
       fail-closed davranır ve OBD kaynaklı sinyaller sessizce ölür — yani bu
       kilit düşerse P0-OBD-01'in Guardian kazanımı da kaybolur. */
    const hook = strip(read(HOOK));
    expect(hook, 'hook duvar saatini artık geçirmiyor').toContain('wallClockMs');
    expect(hook, 'değişim kıyasına damga geçirilmiyor')
      .toMatch(/safetyRelevantFieldsChanged\([\s\S]{0,120}Date\.now\(\)/);
    expect(strip(read(SAFETY)), 'mapper fail-closed damgası kaldırılmış')
      .toContain('Number.NaN');
  });

  it('KİLİT: reconnect önbelleği DÜŞÜRÜYOR (iki katmanda birden)', () => {
    /* İki ayrı önbellek vardı ve ikisi de reconnect'te hayatta kalıyordu:
       extendedPidService `_values` ve mağazadaki `obdSignals`. */
    expect(strip(read(EXT)), 'extended önbelleği reconnect’te temizlenmiyor')
      .toMatch(/notifyObdConnected[\s\S]{0,600}_values\.clear\(\)/);
    expect(strip(read(STORE)), 'mağaza oturum kapısı kaldırılmış')
      .toContain('sessionChanged');
    expect(strip(read(BRIDGE)), 'köprü oturum numarasını izlemiyor')
      .toContain('getObdSessionEpoch');
  });

  it('KİLİT: negatif sıcaklık körlemesine ELENMİYOR', () => {
    /* Eski kural `v < 0` idi ve soğuk iklimde ortam/emme/soğutma sıcaklığını
       TAMAMEN yok ediyordu. Yeni kural: TAM DEĞER sentinel + fiziksel bant. */
    const cat = strip(read(CAT));
    expect(cat, 'kabul kapısı kaldırılmış').toContain('export function acceptCanonicalValue');
    expect(cat, 'sentinel TAM DEĞER kıyası kaldırılmış').toContain('raw === -1');
    expect(cat, 'fiziksel bant kaldırılmış').toContain('physMin');
    const bridge = strip(read(BRIDGE));
    expect(bridge, 'köprü körlemesine negatif elemeye geri dönmüş')
      .not.toMatch(/v\s*<\s*0\s*\)\s*return null/);
    expect(bridge, 'köprü kabul kapısını atlıyor').toContain('acceptCanonicalValue');
  });

  it('KİLİT: tazelik için TIMER kurulmamış (okuma anında hesaplanır)', () => {
    /* Değerleri "bayatlatmak" için timer kurmak, WebView arka plandayken
       çalışmaz ve dönüşte donmuş değer canlı görünür. Politika okuma anında
       uygulanır — bu yüzden köprüde zamanlayıcı OLMAMALI. */
    const bridge = strip(read(BRIDGE));
    expect(bridge, 'köprüye setInterval girmiş').not.toContain('setInterval');
    expect(bridge, 'köprüye setTimeout girmiş').not.toContain('setTimeout');
  });

  it('KİLİT: LAB sinyal başına LIVE/STALE/UNAVAILABLE + yaş + son güncelleme gösteriyor', () => {
    const model = strip(read('src/platform/devtools/obdBridgeLabModel.ts'));
    for (const alan of ['measuredAtMs', 'ageMs', 'formatAge', 'window']) {
      expect(model, `gözlem alanı kaldırılmış: ${alan}`).toContain(alan);
    }
    const screen = read('src/components/devtools/screens/ObdDataBridgeScreen.tsx');
    expect(screen, 'yaş sütunu kaldırılmış').toContain('Yaş');
    expect(screen, 'son güncelleme sütunu kaldırılmış').toContain('Son güncelleme');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-03 · ÜRÜN TÜKETİCİLERİ KANONİK KAYNAĞA TAŞINDI (2026-08-22)

   Bu turun kapattığı kusurların ortak kökü: her tüketici araç verisini KENDİ
   yolundan okuyordu. Sonuç CAN'ı olmayan araçta kalıcı "—", CAN'ı olan araçta
   görünmeyen ısı, ekrana basılan "-1 °C" ve birbiriyle çelişebilen üç ayrı akü
   önceliğiydi. Kilitler bu yolların GERİ AÇILMASINI engeller.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-03 · kanonik tüketici kilitleri', () => {
  const HOOK  = 'src/hooks/useCanonicalVehicleSignal.ts';
  const AUTH2 = 'src/platform/vehicleDataLayer/canonicalVehicleSignal.ts';
  const THEMES = [
    'src/components/themes/ExpeditionLayout.tsx',
    'src/components/themes/HorizonLayout.tsx',
    'src/components/themes/TeslaLayout.tsx',
  ];

  const strip2 = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: hiçbir ürün ekranı ortam sıcaklığını HAM CAN alanından okumuyor', () => {
    /* `canAmbientTemp` CAN'ı olmayan araçta kalıcı null'dır; üç başlık da
       sonsuza dek "—" gösteriyordu, oysa PID 0x46 okunuyordu. */
    for (const f of THEMES) {
      expect(strip2(read(f)), `${f}: ham canAmbientTemp okuması geri gelmiş`)
        .not.toContain('canAmbientTemp');
      expect(read(f), `${f}: kanonik ortam sıcaklığı kaldırılmış`)
        .toContain('useAmbientTemp()');
    }
  });

  it('KİLİT: ürün ekranları ham OBD motor ısısını okumuyor', () => {
    /* `OBDData.engineTemp` `number`dır ve desteklenmeyen PID'de `-1` döner —
       `!= null` kontrolü ekrana "-1 °C" bastırıyordu (TeslaLayout). */
    for (const f of [...THEMES, 'src/components/split/SplitScreen.tsx',
                     'src/components/layout/NewHomeLayout.tsx']) {
      const code = strip2(read(f));
      expect(code, `${f}: ham obd.engineTemp okuması geri gelmiş`)
        .not.toMatch(/obd\.engineTemp/);
      expect(code, `${f}: useOBDEngineTemp() geri gelmiş`)
        .not.toContain('useOBDEngineTemp(');
    }
  });

  it('KİLİT: tek UI kapısı duruyor ve YALNIZ LIVE değeri sayıya çeviriyor', () => {
    const hook = strip2(read(HOOK));
    expect(hook, 'LIVE kapısı kaldırılmış').toContain('resolveLiveCanonicalSignal');
    expect(hook, 'hook kendi timer’ını kurmuş').not.toContain('setInterval');
    expect(hook, 'hook kendi timer’ını kurmuş').not.toContain('setTimeout');
    /* Seçici İÇİNDE nesne üretmek Zustand'ın `Object.is` kıyasını her store
       değişiminde bozar → hız 3 Hz akarken tüm başlıklar yeniden çizilirdi. */
    expect(hook, 'seçici içinde nesne üretilmiş (perf regresyonu)')
      .not.toMatch(/useUnifiedVehicleStore\(\s*\(s\)\s*=>\s*\(?\{/);
  });

  it('KİLİT: akü voltajı önceliği TEK yerde (üçüncü kopya geri gelmemiş)', () => {
    expect(strip2(read(AUTH2))).toContain('export function resolveBatteryVoltage');
    const diag = strip2(read('src/platform/diagnosticSections.ts'));
    expect(diag, 'tanı raporu kendi CAN→OBD önceliğini yeniden yazmış')
      .toContain('resolveBatteryVoltage');
    expect(diag, 'elle yazılmış öncelik zinciri geri gelmiş')
      .not.toMatch(/source\s*=\s*'CAN';\s*voltageV\s*=/);
  });

  it('KİLİT: sesli asistan ve zekâ servisi kanonik kaynaktan okuyor', () => {
    /* Mavi "motor sıcaklığı verisi yok" diyordu çünkü yalnız CAN'a bakıyordu;
       makullük denetimleri de OBD-only araçta hiç çalışmıyordu. */
    for (const f of ['src/platform/voiceInfoService.ts',
                     'src/platform/vehicleIntelligenceService.ts']) {
      const code = strip2(read(f));
      expect(code, `${f}: kanonik okuma kaldırılmış`).toContain('resolveLiveCanonicalSignal');
      expect(code, `${f}: ham canCoolantTemp DEĞER okuması geri gelmiş`)
        .not.toMatch(/=\s*vs\.canCoolantTemp/);
    }
  });

  it('KİLİT: çürüme mağazada gerçekleşiyor (arayüz uyanabilsin)', () => {
    /* Okuma-anı kapısı tek başına yetmez: yazım durunca hiçbir referans
       değişmez ve React son değeri sonsuza dek "LIVE" gösterir. */
    expect(strip2(read('src/platform/vehicleDataLayer/UnifiedVehicleStore.ts')))
      .toContain('dropExpiredObdSignals');
    expect(strip2(read('src/platform/vehicleDataLayer/obdSignalBridge.ts')))
      .toContain('onObdFreshnessTick');
    /* Çürüme MEVCUT gözcüye iliştirilir — köprüde yeni timer YASAK (zaten
       ayrı bir kilit var), burada gözcünün tik yaydığı doğrulanır. */
    expect(strip2(read('src/platform/obdService.ts')))
      .toContain('_emitFreshnessTick()');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-04 · ERKEN UYARI ZEKÂSI (2026-08-22)

   Bu turun riski öncekilerden farklıdır: buradaki kusur "veri gelmiyor" değil,
   **YANLIŞ UYARI**dır. Yanlış-pozitif bir "arıza" uyarısı, hiç uyarmamaktan
   daha zararlıdır — güveni bir kerede yok eder. Kilitler tam olarak bunu korur.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-04 · erken uyarı kilitleri', () => {
  const EW  = 'src/platform/obd/earlyWarningEngine.ts';
  const RT  = 'src/platform/obd/predictionRuntime.ts';
  const PE  = 'src/platform/obd/predictionEngine.ts';

  const strip3 = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: İKİNCİ koşucu kurulmamış — erken uyarı MEVCUT tikte çalışıyor', () => {
    /* Ayrı bir zamanlayıcı, ikinci bir tazelik kapısı ve ikinci bir "araç
       değişti" kararı demek olurdu. */
    const ew = strip3(read(EW));
    expect(ew, 'saf motora timer girmiş').not.toContain('setInterval');
    expect(ew, 'saf motora timer girmiş').not.toContain('setTimeout');
    expect(ew, 'saf motor Date.now çağırıyor').not.toContain('Date.now(');
    expect(ew, 'trend matematiği kopyalanmış — fitTrend yeniden kullanılmalı')
      .toContain("from './predictionEngine'");
    const rt = strip3(read(RT));
    expect(rt, 'erken uyarı mevcut tikten çıkarılmış').toContain('_ewTick(');
    expect(rt, 'ikinci scheduleTask kaydı eklenmiş')
      .toHaveLength(rt.length);   // yapısal: aşağıdaki sayım kilidi
    expect((rt.match(/scheduleTask\(/g) ?? []).length,
      'ikinci görev kaydı eklenmiş (tek koşucu şartı)').toBe(1);
  });

  it('KİLİT: tek ölçümle hüküm YOK — medyan + kaplama + süre kapıları duruyor', () => {
    const ew = strip3(read(EW));
    expect(ew, 'medyan kaldırılmış — ortalama tek sıçramayı yutmaz')
      .toContain('export function median');
    expect(ew, 'kaplama eşiği kaldırılmış').toContain('MIN_DWELL_FRACTION');
    expect(ew, 'asgari gözlem süresi kaldırılmış').toContain('minDwellMs');
    expect(ew, 'asgari örneklem kapısı kaldırılmış').toContain('MIN_TREND_SAMPLES');
  });

  it('KİLİT: eksik/desteklenmeyen sinyal NORMAL sayılmıyor', () => {
    const ew = strip3(read(EW));
    for (const v of ['SIGNAL_MISSING', 'INSUFFICIENT_DATA', 'NORMAL']) {
      expect(ew, `hüküm türü kaldırılmış: ${v}`).toContain(v);
    }
    /* `NORMAL` ile ölçülemeyen durumların BİRLEŞTİRİLMESİ bu kilidi düşürür. */
    expect(ew, 'eksik sinyal hükmü kaldırılmış').toContain('_missingResult');
  });

  it('KİLİT: güven ASLA 1.0 olamaz ve tavanlar duruyor', () => {
    const ew = strip3(read(EW));
    expect(ew).toContain('SINGLE_SIGNAL_CONFIDENCE_CAP');
    expect(ew).toContain('CROSS_SIGNAL_CONFIDENCE_CAP');
    expect(ew, 'yayın eşiği kaldırılmış').toContain('MIN_EMIT_CONFIDENCE');
  });

  it('KİLİT: kullanıcıya kesin teşhis dili KULLANILMIYOR', () => {
    /* "Arıza var" demek, ölçümün taşıyabileceğinden fazla bir iddiadır. */
    /* YORUMLAR HARİÇ: belgeleme metni bu dilin NEDEN yasak olduğunu anlatırken
       ifadeyi zorunlu olarak içerir. Kilit KULLANICIYA GİDEN metni denetler. */
    const ewCode = strip3(read(EW));
    expect(ewCode, 'kesin teşhis dili kullanıcı metnine girmiş')
      .not.toMatch(/arıza var|arızalı|bozuk/i);
    expect(read(EW), 'ihtiyat cümlesi kaldırılmış')
      .toContain('kesin bir arıza teşhisi değil');
  });

  it('KİLİT: örnekler YALNIZ kanonik LIVE ölçümden geliyor', () => {
    const rt = strip3(read(RT));
    expect(rt, 'kanonik okuma kaldırılmış').toContain('readLiveObdSignal');
    expect(rt, 'paylaşılan sinyaller kanonik otoriteden okunmuyor')
      .toContain('resolveLiveCanonicalSignal');
    /* Erken uyarı tik gövdesi HAM OBD anlık görüntüsünü OKUMAMALI — örnekler
       yalnız kanonik mağazadan gelir. Kapsam: `_ewTick` fonksiyonunun kendisi. */
    const ewBody = rt.slice(rt.indexOf('function _ewTick'), rt.indexOf('function _vehicleKey'));
    expect(ewBody.length, '_ewTick gövdesi bulunamadı').toBeGreaterThan(0);
    expect(ewBody, 'erken uyarı ham OBD alanından besleniyor')
      .not.toContain('getOBDDataSnapshot');
  });

  it('KİLİT: reconnect tamponu temizliyor — oturum numarası anahtarda', () => {
    const rt = strip3(read(RT));
    expect(rt, 'oturum numarası araç anahtarından çıkarılmış')
      .toContain('obdSessionEpoch');
    expect(rt, 'tampon temizliği erken uyarıyı kapsamıyor').toContain('_ewClear()');
  });

  it('KİLİT: Guardian kritik yolu bu turda DEĞİŞTİRİLMEDİ', () => {
    /* Erken uyarı ADVISORY'dir: Safety Rule Engine'e, kritik alert kuyruğuna ve
       ENGINE_OVERHEAT olayına DOKUNMAZ. Bu kilit o sınırı korur. */
    const ewAll = read(EW) + read(RT);
    expect(ewAll, 'erken uyarı güvenlik kural motoruna bağlanmış')
      .not.toContain('SafetyRuleEngine');
    expect(ewAll, 'erken uyarı kritik olay yayınlıyor')
      .not.toContain('dispatchMaintenanceRequired');
    expect(ewAll, 'erken uyarı ENGINE_OVERHEAT olayını üretiyor')
      .not.toContain('ENGINE_OVERHEAT');
  });

  it('KİLİT: Mavi gerekçeyi motorun kendisinden alıyor (kendi eşiğini yazmıyor)', () => {
    const vi = strip3(read('src/platform/voiceInfoService.ts'));
    expect(vi, 'Mavi erken uyarıyı okumuyor').toContain('getEarlyWarnings()');
    expect(vi, 'Mavi kendi açıklamasını üretiyor').toContain('explainEarlyWarnings');
  });

  it('KİLİT: yeni PID eklenmemiş — katalog ölçeği sabit', () => {
    /* Erken uyarı yalnız ZATEN okunan sinyalleri değerlendirir. Katalog
       büyürse ELM327 hattına ek yük biner; bu kilit onu görünür kılar. */
    expect(strip3(read('src/platform/obd/canonicalObdSignals.ts')))
      .toContain("path === 'extended'");
    expect(strip3(read(PE)), 'öngörü motorunun eşikleri değişmiş')
      .toContain('DEFAULT_PREDICTION_RULES');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-05 · SERVİS 06 İZLEME TESTLERİ (2026-08-22)

   Bu turun iki ayrı riski var: (a) okunamayan bir sonucu "geçti" sanmak,
   (b) teşhis okumasının Mode 01 sıcak poll'unu bölmesi. Kilitler ikisini de
   YAPISAL olarak korur.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-05 · Servis 06 kilitleri', () => {
  const M6  = 'src/platform/obd/mode06.ts';
  const SVC = 'src/platform/obd/mode06Service.ts';
  const ELM = 'android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java';

  const strip5 = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: Mode 06 TALEP-GÜDÜMLÜ — timer/görev/veri aboneliği YOK', () => {
    /* Bir timer eklenirse Mode 06 arka planda hatta çıkar ve hız/devir turunu
       böler. Talep-güdümlülüğün tek yapısal garantisi budur. */
    const svc = strip5(read(SVC));
    expect(svc, 'servise timer girmiş').not.toContain('setInterval');
    expect(svc, 'servise timer girmiş').not.toContain('setTimeout');
    expect(svc, 'servis görev tekerine kaydolmuş').not.toContain('scheduleTask');
    expect(svc, 'servis veri akışına abone olmuş').not.toContain('onOBDData');
  });

  it('KİLİT: Mode 01 poll yapılandırmasına DOKUNULMUYOR', () => {
    const svc = strip5(read(SVC));
    for (const forbidden of ['setObdExtendedPids', 'setObdPollProfile',
                             'setObdDiagnosticBurst', 'watchPid']) {
      expect(svc, `Mode 01 poll yolu değiştirilmiş: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('KİLİT: YAZMA / AKTÜATÖR / SERVİS RUTİNİ eklenmemiş', () => {
    const all = read(M6) + read(SVC);
    for (const forbidden of ['writeDid', 'routineControl', 'actuator',
                             'clearDtc', 'sendRaw', 'ATSH0']) {
      expect(all, `salt-okunur sözleşmesi delinmiş: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('KİLİT: NO DATA / bozuk yanıt "geçti" SAYILMIYOR', () => {
    const svc = strip5(read(SVC));
    for (const st of ["'no_data'", "'malformed'", "'unsupported'"]) {
      expect(svc, `durum kaldırılmış: ${st}`).toContain(st);
    }
    /* `ok` ile bu durumların BİRLEŞTİRİLMESİ bu kilidi düşürür. */
    expect(strip5(read(M6)), 'yorumlanamayan sonuç hükmü kaldırılmış').toContain("'UNKNOWN'");
  });

  it('KİLİT: bilinmeyen ölçek kimliğinde hüküm VERİLMİYOR', () => {
    /* Yanlış birimle ölçeklenmiş bir sayı, hiç sayı olmamasından tehlikelidir;
       ayrıca işaretliliği bilmeden yapılan karşılaştırma sonucu TERSİNE çevirir. */
    const m6 = strip5(read(M6));
    expect(m6, 'tanınmayan UAS için UNKNOWN dalı kaldırılmış')
      .toMatch(/def === undefined[\s\S]{0,80}'UNKNOWN'/);
    expect(m6, 'interpretable bayrağı kaldırılmış').toContain('interpretable');
  });

  it('KİLİT: desteklenmeyen MID UYDURULMUYOR — keşif zorunlu', () => {
    const svc = strip5(read(SVC));
    expect(svc, 'bitmask keşfi kaldırılmış').toContain('parseMode06SupportedMids');
    expect(svc, 'keşif zinciri kaldırılmış').toContain('DISCOVERY_MIDS');
    /* Sabit/varsayılan bir MID listesi eklenmesi bu kilidi düşürür. */
    expect(svc, 'sabit MID listesi eklenmiş')
      .not.toMatch(/const\s+(DEFAULT|FALLBACK|COMMON)_MIDS/);
  });

  it('KİLİT: ÇOKLU ECU provenance korunuyor', () => {
    const svc = strip5(read(SVC));
    for (const f of ['ecuLabel', 'ecuTx', 'ecuRx']) {
      expect(svc, `provenance alanı kaldırılmış: ${f}`).toContain(f);
    }
    expect(svc, 'ECU keşfi kendi kopyasını kurmuş (ikinci topoloji otoritesi)')
      .toContain('discoverEcus');
  });

  it('KİLİT: oturum (reconnect) disiplini duruyor', () => {
    const svc = strip5(read(SVC));
    expect(svc, 'oturum damgası kaldırılmış').toContain('getObdSessionEpoch');
    expect(svc, 'bayat işaretlemesi kaldırılmış').toContain('stale');
  });

  it('KİLİT: native ikinci ISO-TP birleştirici YAZMAMIŞ', () => {
    /* Mode 06 CAN'de HER ZAMAN çok-çerçevelidir; mevcut birleştirici yeniden
       kullanılmalı — kopyalanan bir çözümleyici aynı hatayı iki yerde üretirdi. */
    const elm = read(ELM);
    expect(elm, 'Mode 06 okuma kaldırılmış').toContain('public Mode06Evidence readMode06');
    expect(elm, 'mevcut ISO-TP birleştiricisi kullanılmıyor')
      .toMatch(/readMode06[\s\S]{0,2000}splitResponseBodies/);
  });

  it('KİLİT: LAB ekranı kayıtlı ve ECU→monitör→test hiyerarşisi duruyor', () => {
    expect(read('src/platform/devtools/carosLabCatalog.ts'), 'katalogdan kaldırılmış')
      .toContain("id: 'mode06-monitors'");
    expect(read('src/components/devtools/carosLabScreenMap.tsx'), 'ekran eşlemesi kaldırılmış')
      .toContain("case 'mode06-monitors'");
    const screen = read('src/components/devtools/screens/Mode06MonitorsScreen.tsx');
    for (const col of ['Değer', 'Min', 'Maks', 'Sonuç']) {
      expect(screen, `sütun kaldırılmış: ${col}`).toContain(col);
    }
  });

  it('KİLİT: erken uyarı katmanına HENÜZ bağlanmamış (kanıtsız karar yok)', () => {
    /* Bu tur Servis 06'yı bilinçli olarak GÖZLEM katmanında bıraktı: hiçbir
       gerçek araçta tek bayt okunmadan karar katmanına bağlamak, kanıtsız
       karar üretmek olurdu. Bağlanacaksa bu kilit BİLİNÇLİ güncellenmelidir. */
    const ew = read('src/platform/obd/earlyWarningEngine.ts')
             + read('src/platform/obd/predictionRuntime.ts');
    expect(ew, 'Mode 06 saha doğrulaması olmadan karar katmanına bağlanmış')
      .not.toContain('mode06');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-06 · OBD HAT/SİNYAL SAĞLIĞI (2026-08-23)

   Bu turun kusuru sessizdi: taşıma açıkken TEK BİR PID donabilir ve hiçbir
   katman görmezdi — ekran dolu, sayılar ölü. Kilitler o körlüğün geri
   gelmesini ve sağlık kararının hat/ELM cevabına indirgenmesini engeller.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-06 · OBD sağlık kilitleri', () => {
  const MODEL = 'src/platform/obd/obdHealthModel.ts';
  const MON   = 'src/platform/obd/ObdHealthMonitor.ts';
  const SVC   = 'src/platform/obdService.ts';

  const strip6 = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: DÖRDÜNCÜ sağlık sistemi kurulmamış — mevcut otoriteler kullanılıyor', () => {
    const m = strip6(read(MODEL));
    expect(m, 'tazelik matematiği kopyalanmış — obdFreshnessPolicy yeniden kullanılmalı')
      .toContain('computeFreshnessWindow');
    expect(m, 'monitör zamanlaması yerine kendi deposu kurulmuş')
      .toContain('FieldTimingSnapshot');
    expect(m, 'saf model saat okuyor').not.toContain('Date.now(');
    expect(m, 'saf modele timer girmiş').not.toContain('setInterval');
    /* `dataFresh` MEVCUT otoritedir; yok sayılırsa ECU sessizliği iki yerden
       farklı yanıtlanır. */
    expect(m, 'dataFresh otoritesi yok sayılmış').toContain('dataFresh');
  });

  it('KİLİT: dört durumlu sözleşme ve AYRI nedenler duruyor', () => {
    const m = strip6(read(MODEL));
    for (const st of ["'HEALTHY'", "'DEGRADED'", "'STALLED'", "'DISCONNECTED'"]) {
      expect(m, `sağlık durumu kaldırılmış: ${st}`).toContain(st);
    }
    for (const c of ["'no_data'", "'parse_error'", "'stalled'", "'never_seen'", "'disconnected'"]) {
      expect(m, `neden kaldırılmış: ${c}`).toContain(c);
    }
  });

  it('KİLİT: STALL ile FREEZE birleştirilmemiş', () => {
    /* Aynı değerin uzun süre değişmemesi TEK BAŞINA arıza DEĞİLDİR (park hâlinde
       devir 0 sabittir). Birleştirilirse duran araçta sahte alarm üretilir. */
    const m = strip6(read(MODEL));
    expect(m, 'freeze gözlemi kaldırılmış').toContain('frozen');
    expect(m, 'freeze artık durumu düşürüyor (sahte alarm riski)')
      .not.toMatch(/frozen[\s\S]{0,60}state:\s*'STALLED'/);
    expect(m, 'değişim damgası kaldırılmış').toContain('lastChangedAtMs');
  });

  it('KİLİT: sıcak ve yavaş sinyaller AYNI eşiği kullanmıyor', () => {
    const m = strip6(read(MODEL));
    expect(m, 'sinyal sınıflandırması kaldırılmış').toContain('FIELD_CLASS');
    expect(m, 'sıcak mutlak tavan kaldırılmış').toContain('HOT_STALL_CEILING_MS');
    /* Yavaş sinyalin beklentisi ÇEKİRDEK fast periyoduyla kıyaslanırsa sağlıklı
       bir PID sürekli "yavaş" damgası yer (bu tur bunu düzeltti). */
    expect(m, 'alanın kendi kadans beklentisi kaldırılmış')
      .toContain('expectedFieldIntervalMs');
  });

  it('KİLİT: alan zamanlaması MEVCUT poll akışından türetiliyor (ek sorgu YOK)', () => {
    const svc = strip6(read(SVC));
    expect(svc, 'alan örnekleme kancası kaldırılmış').toContain('noteFieldSample');
    /* Üç sonuç AYRI kaydedilmeli; sunulmayan alanın sessizce atlanması bu turun
       kapattığı körlüğün ta kendisiydi. */
    expect(svc, 'NO DATA kaydı kaldırılmış').toContain("'not_offered'");
    expect(svc, 'red kaydı kaldırılmış').toContain("'rejected'");
    /* Sağlık ölçümü için YENİ bir sorgu eklenmesi bu kilidi düşürür. */
    expect(strip6(read(MODEL)), 'sağlık modeli hatta çıkıyor')
      .not.toMatch(/CarLauncher|readPidOnce|sendCommand/);
  });

  it('KİLİT: reconnect eski oturumun zamanlamasını DÜŞÜRÜYOR', () => {
    const mon = strip6(read(MON));
    expect(mon, 'oturum temizliği kaldırılmış').toContain('_clearTiming');
    expect(mon, 'reconnect zamanlamayı düşürmüyor')
      .toMatch(/noteReconnect[\s\S]{0,400}_clearTiming\(\)/);
    expect(mon, 'yeni bağlantı zamanlamayı düşürmüyor')
      .toMatch(/noteConnected[\s\S]{0,400}_clearTiming\(\)/);
  });

  it('KİLİT: karar katmanları health-aware — bayat/durmuş veriyle karar YOK', () => {
    /* Öngörü/erken uyarı BİLİNÇLİ olarak hat düzeyi blok KULLANMAZ: her ölçüm
       zaten kendi tazelik penceresinden geçer (P0-OBD-02). Hat düzeyi blok
       ikinci bir tazelik otoritesi olur ve çekirdek sustuğunda geçerli
       genişletilmiş ölçümü çöpe atardı. Bu kilit o kararı KORUR. */
    const rt = strip6(read('src/platform/obd/predictionRuntime.ts'));
    expect(rt, 'per-sinyal tazelik kapısı kaybolmuş')
      .toContain('readLiveObdSignal');
    const vi = strip6(read('src/platform/voiceInfoService.ts'));
    expect(vi, 'Mavi durmuş hatta sayı okumaya devam ediyor')
      .toContain('getObdSignalHealth');
  });

  it('KİLİT: LAB OBD Sağlık ekranı kayıtlı ve SALT-OKUNUR', () => {
    expect(read('src/platform/devtools/carosLabCatalog.ts'), 'katalogdan kaldırılmış')
      .toContain("id: 'obd-signal-health'");
    expect(read('src/components/devtools/carosLabScreenMap.tsx'), 'ekran eşlemesi kaldırılmış')
      .toContain("case 'obd-signal-health'");
    const screen = strip6(read('src/components/devtools/screens/ObdSignalHealthScreen.tsx'));
    expect(screen, 'ekran sorgu göndermeye başlamış').not.toContain('CarLauncher');
    expect(screen, 'ekrana timer girmiş').not.toContain('setInterval');
    for (const col of ['Yaş', 'Gözlenen aralık', 'Stall eşiği', 'Neden', 'Durum']) {
      expect(read('src/components/devtools/screens/ObdSignalHealthScreen.tsx'),
        `sütun kaldırılmış: ${col}`).toContain(col);
    }
  });

  it('KİLİT: mevcut skor sözleşmesi (connectionQuality / sensorReliability) korunmuş', () => {
    /* Bu tur ObdHealthMonitor'ü GENİŞLETTİ; eski tüketiciler (diagnosticSections,
       Adaptör Tanılama) bozulmamalı. */
    const mon = strip6(read(MON));
    expect(mon).toContain('connectionQuality');
    expect(mon).toContain('sensorReliability');
    expect(mon, 'eski alan sayacı API kaldırılmış').toContain('noteField(');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-07 · SAĞLIK KAPILARI (2026-08-23)

   P0-OBD-06 sağlığı ÖLÇÜLEBİLİR yaptı; bu tur onu yalnız GEREKEN yerde kapıya
   çevirdi. İki yönlü risk var ve iki yönü de kilitlenir:
     (a) durmuş veriden hüküm üretmek,
     (b) hat kötü diye hâlâ geçerli veriyi susturmak.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-07 · sağlık kapısı kilitleri', () => {
  const MODEL = 'src/platform/obd/obdHealthModel.ts';
  const RT    = 'src/platform/obd/predictionRuntime.ts';
  const VIS   = 'src/platform/vehicleIntelligenceService.ts';
  const MAP   = 'src/platform/safety/safetyStateMapper.ts';

  const strip7 = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: motor durumu kararı SAF ve TEK yerde', () => {
    /* Üç tüketici var; her birinde yeniden yazılırsa ayrışır. Saf olması ayrıca
       mock'suz kilitlenebilmesini sağlar. */
    expect(strip7(read(MODEL)), 'saf motor durumu kapısı kaldırılmış')
      .toContain('export function engineRunningFrom');
    expect(strip7(read(RT)), 'koşucu kendi motor-çalışıyor eşiğini yeniden yazmış')
      .toContain('engineRunningFrom(');
    expect(strip7(read(RT)), 'ham devir eşiği koşucuya geri kopyalanmış')
      .not.toMatch(/rpm\s*>\s*400/);
  });

  it('KİLİT: donmuş devirden "motor çalışıyor" ÇIKARILMIYOR', () => {
    /* `store.rpm` SAB hot-path'inden gelir ve kanonik tazelik penceresi YOKTUR;
       hat durunca son değerinde donar. Bu kapı onun TEK otoritesidir. */
    const m = strip7(read(MODEL));
    expect(m, 'karar kalitesi kontrolü kaldırılmış')
      .toMatch(/engineRunningFrom[\s\S]{0,300}isDecisionGrade\(rpmState\)/);
  });

  it('KİLİT: donmuş devirden "sorun yok" makullük hükmü ÜRETİLMİYOR', () => {
    /* Donmuş devirde ardışık iki örnek eşittir → Δ=0 → `clearPlausibility`
       çağrılır ve sistem "devir makul" der. Ölü hattan SAHTE sağlık hükmü. */
    const v = strip7(read(VIS));
    expect(v, 'makullük denetimi sağlık kapısını kaybetmiş').toContain('rpmDecidable');
    expect(v, 'donmuş devir hâlâ referans olarak alınıyor')
      .toMatch(/rpmDecidable[\s\S]{0,200}_prevRpmRaw = rpm/);
  });

  it('KİLİT: hat sağlığı KANONİK tazelik otoritesini EZMİYOR', () => {
    /* Çekirdek hat kötü diye hâlâ akan genişletilmiş ölçümleri susturmak,
       bu turun ikinci ve daha sinsi riski. */
    const rt = strip7(read(RT));
    expect(rt, 'per-sinyal tazelik kapısı kaybolmuş').toContain('readLiveObdSignal');
    expect(rt, 'hat düzeyi toplu blok geri gelmiş — geçerli ölçüm susturulur')
      .not.toMatch(/link\.state[\s\S]{0,80}return;/);
  });

  it('KİLİT: Guardian\'ın OBD DIŞI güvenlik kaynakları kapatılmamış', () => {
    /* OBD adaptörü çekilince geri vites kamerası ve açık kapı uyarısı da
       susarsa, güvenlik katmanını korumak için yazdığımız kapı onu ÖLDÜRÜR. */
    const map = strip7(read(MAP));
    for (const src of ['v.reverse', 'v.canDoorOpen', 'v.canParkingBrake']) {
      expect(map, `OBD dışı güvenlik kaynağı kaldırılmış: ${src}`).toContain(src);
    }
    expect(map, 'Guardian hat sağlığına bağlanmış (OBD dışı kaynaklar da kapanır)')
      .not.toContain('getObdSignalHealth');
  });

  it('KİLİT: kopma defteri ile sağlık modeli AYRI otoriteler', () => {
    /* Gözlemsel ilişki LAB ekranında; hüküm üretimine karışmaz. */
    const m = strip7(read(MODEL));
    expect(m, 'sağlık modeli kopma defterine bağlanmış (otorite karışması)')
      .not.toContain('linkLoss');
    const screen = read('src/components/devtools/screens/ObdSignalHealthScreen.tsx');
    expect(screen, 'defter ilişkisi ekrandan kaldırılmış').toContain('getLinkLossLedger');
    expect(screen, 'defterin gözlemsel olduğu beyanı kaldırılmış').toContain('hüküm ÜRETMEZ');
  });

  it('KİLİT: reconnect sonrası kararlar yeni ölçüm gelmeden AÇILMIYOR', () => {
    const mon = strip7(read('src/platform/obd/ObdHealthMonitor.ts'));
    expect(mon, 'reconnect zamanlamayı düşürmüyor')
      .toMatch(/noteReconnect[\s\S]{0,400}_clearTiming\(\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-08 · ECU KİMLİĞİ VE ROLÜ (2026-08-23)

   Bu turun tek büyük riski YANLIŞ ROL ATAMASIDIR: "7E1 şanzımandır" gibi yaygın
   bir GELENEĞİ kural sanmak, kullanıcıya var olmayan bir sistemde arıza
   göstermek demektir. Kilitler o kapıyı kapalı tutar.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-08 · ECU kimliği kilitleri', () => {
  const MODEL = 'src/platform/obd/ecuRoleModel.ts';
  const PROF  = 'src/platform/obd/ecuRoleProfiles.ts';
  const SVC   = 'src/platform/obd/ecuIdentityService.ts';
  const DISC  = 'src/platform/obd/ecuDiscovery.ts';

  const strip8 = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: adresten rol UYDURULMUYOR — standart garanti YALNIZ 7E8', () => {
    const m = strip8(read(MODEL));
    expect(m, 'standart adres kuralı kaldırılmış').toContain('roleFromStandardAddress');
    expect(m, "7E8 dışında bir adrese rol atanmış")
      .not.toMatch(/'7E[9A-F]'\s*(\?|:|=>)/);
    /* 7E1/7E9'u şanzımana bağlayan bir kural eklenmesi bu kilidi düşürür. */
    expect(m, 'yaygın gelenek kural olarak gömülmüş')
      .not.toMatch(/7E1[\s\S]{0,60}transmission/);
  });

  it('KİLİT: kanıt sırası (beyan > standart > profil) gevşetilmemiş', () => {
    const m = strip8(read(MODEL));
    expect(m).toContain("evidence: 'declared'");
    expect(m).toContain("evidence: 'standard'");
    expect(m).toContain("evidence: 'profile'");
    expect(m, 'kanıtsız durumda rol üretiliyor').toMatch(/role: 'unknown',\s*evidence: 'none'/);
  });

  it('KİLİT: üretici eşlemeleri ÇEKİRDEĞE gömülmemiş', () => {
    /* Görev kuralı: manufacturer-specific eşlemeler AYRI veri katmanında. */
    const m = strip8(read(MODEL));
    expect(m, 'çekirdeğe üretici tablosu girmiş').not.toContain('ECU_ROLE_PROFILES');
    expect(m, 'çekirdeğe WMI eşlemesi girmiş').not.toMatch(/wmi/i);
    expect(strip8(read(PROF)), 'profil katmanı kaldırılmış').toContain('ECU_ROLE_PROFILES');
  });

  it('KİLİT: doğrulanmamış üretici eşlemesi kabul EDİLMİYOR', () => {
    const p = strip8(read(PROF));
    expect(p, 'doğrulama damgası zorunluluğu kaldırılmış').toContain('verifiedOn');
    expect(p, 'doğrulayıcı kaldırılmış').toContain('export function validateEcuRoleProfiles');
  });

  it('KİLİT: Türkçe yerel ayar tuzağına karşı ASCII katlama duruyor', () => {
    /* `toUpperCase()` tr-TR'de i → İ üretir ve eşleşme SESSİZCE başarısız olur. */
    const m = strip8(read(MODEL));
    expect(m, 'ASCII katlama kaldırılmış').toContain('export function foldAscii');
    expect(m, 'metin eşleşmesinde toUpperCase() kullanılmış (fail-open riski)')
      .not.toContain('toUpperCase()');
  });

  it('KİLİT: kararlı kimlik adresleme kipini ve araç bağlamını taşıyor', () => {
    const m = strip8(read(MODEL));
    expect(m, 'adres anahtarına adresleme kipi girmiyor')
      .toMatch(/ecuAddressKey[\s\S]{0,200}addressBits/);
    expect(m, 'kimlik anahtarına araç bağlamı girmiyor')
      .toMatch(/ecuIdentityKey[\s\S]{0,400}vehicleKey/);
  });

  it('KİLİT: İKİNCİ tarama sistemi kurulmamış', () => {
    /* Kimlik katmanı MEVCUT keşfi kullanır ve MEVCUT DID köprüsüyle okur;
       yeni adres taraması ya da yeni native köprü eklenmesi bu kilidi düşürür. */
    const svc = strip8(read(SVC));
    expect(svc, 'mevcut keşif kullanılmıyor').toContain('discoverEcus');
    expect(svc, 'mevcut DID köprüsü yerine yenisi eklenmiş').toContain('readObdDid');
    expect(svc, 'kimlik katmanına timer girmiş').not.toContain('setInterval');
    expect(svc, 'yazma/aktüatör yolu eklenmiş').not.toMatch(/writeDid|routineControl|actuator/);
  });

  it('KİLİT: DTC ve Servis 06 sonuçları ECU kimliğini KAYBETMİYOR', () => {
    const dtc = strip8(read('src/platform/obd/multiEcuScan.ts'));
    expect(dtc, 'DTC rol alanı kaldırılmış').toContain('ecuRole');
    expect(dtc, 'DTC kimlik etiketleme yardımcısı kaldırılmış').toContain('_ecuIdentityFields');
    const m06 = strip8(read('src/platform/obd/mode06Service.ts'));
    expect(m06, 'Mode 06 rol alanı kaldırılmış').toContain('ecuRole');
    expect(m06, 'Mode 06 kimlik anahtarı kaldırılmış').toContain('ecuKey');
  });

  it('KİLİT: BAYAT envanterden rol yapıştırılmıyor', () => {
    /* Bayat rolü sonuca yazmak, başka aracın kimliğini bu araca yazmaktır. */
    const svc = strip8(read(SVC));
    expect(svc, 'bayatlık kontrolü kaldırılmış')
      .toMatch(/lookupEcuIdentity[\s\S]{0,300}stale/);
  });

  it('KİLİT: keşif katmanı rol KANITINI taşıyor', () => {
    expect(strip8(read(DISC)), 'keşifte rol kanıtı alanı kaldırılmış')
      .toContain('roleEvidence');
  });

  it('KİLİT: LAB ECU envanteri kayıtlı ve rolün kanıtını gösteriyor', () => {
    expect(read('src/platform/devtools/carosLabCatalog.ts')).toContain("id: 'ecu-inventory'");
    expect(read('src/components/devtools/carosLabScreenMap.tsx')).toContain("case 'ecu-inventory'");
    const screen = read('src/components/devtools/screens/EcuInventoryScreen.tsx');
    expect(screen, 'kanıt sınıfı ekrandan kaldırılmış').toContain('ECU_EVIDENCE_LABEL');
    expect(screen, 'beyan edilen ad gösterilmiyor').toContain('F197');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-09 · VIN ARAÇ KİMLİĞİ
   ──────────────────────────────────────────────────────────────────────────
   Ölçülen kusur: VIN'in tek deposu 13 satırlık `safety/vinContext` idi ve
   HİÇBİR doğrulama yapmıyordu — kısmi bir VIN ("VF1RJL00") depoyu doldurup
   `saveObdFuelCalib` anahtarına kadar gidebiliyordu (yanlış araca kalibrasyon).
   Bu turun riski ise TERSİDİR: VIN'den marka/model/sınıf "çıkarıyormuş" gibi
   yapmak. Kilitler her iki kapıyı da kapalı tutar.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-OBD-09 · VIN kimliği kilitleri', () => {
  const DEC = 'src/platform/vehicle/vinDecode.ts';
  const ID  = 'src/platform/vehicle/vehicleIdentity.ts';
  const CTX = 'src/platform/safety/vinContext.ts';

  const strip9 = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('KİLİT: KISMİ VIN kimlik SAYILMIYOR (asıl kusur)', async () => {
    const { normalizeVin, isVinShapeValid } = await import('../platform/vehicle/vinDecode');
    expect(normalizeVin('VF1RJL00'), 'kısmi VIN yeniden kabul ediliyor').toBeNull();
    expect(isVinShapeValid('VF1RJL0066123456')).toBe(false);   // 16 hane
    expect(isVinShapeValid('VF1RJL00X661234567')).toBe(false); // 18 hane
    /* I/O/Q ISO 3779'da kullanılmaz — kabul etmek bozuk okumayı VIN sayardı. */
    expect(isVinShapeValid('VF1RJL00I66123456')).toBe(false);
  });

  it('KİLİT: ÇELİŞKİDE hiçbir VIN kanonik olmuyor ("ilk gelen kazanır" YASAK)', async () => {
    const m = await import('../platform/vehicle/vehicleIdentity');
    m.resetVehicleIdentity();
    m.recordVinObservation('VF1RJL00X66123456', 'mode09', 3, 1);
    m.recordVinObservation('VF1RJL00X66999999', 'uds_f190', 3, 2);
    expect(m.getVehicleIdentity(3, 2026).state).toBe('CONFLICT');
    expect(m.getCanonicalVin(3, 2026), 'çelişkide VIN döndürülüyor').toBeNull();
    m.resetVehicleIdentity();
  });

  it('KİLİT: ÖNCEKİ oturumun VIN\'i kanonik sayılmıyor (araç değişimi)', async () => {
    const m = await import('../platform/vehicle/vehicleIdentity');
    m.resetVehicleIdentity();
    m.recordVinObservation('VF1RJL00X66123456', 'mode09', 3, 1);
    expect(m.getCanonicalVin(3, 2026)).toBe('VF1RJL00X66123456');
    /* Adaptör başka araca takılmış olabilir → yeni ölçüm gelmeden kanonik DEĞİL. */
    expect(m.getVehicleIdentity(4, 2026).state).toBe('STALE');
    expect(m.getCanonicalVin(4, 2026), 'bayat VIN kanonik döndürülüyor').toBeNull();
    m.resetVehicleIdentity();
  });

  it('KİLİT: reddedilen HAM değer taşınmıyor (yalnız uzunluk)', async () => {
    const m = await import('../platform/vehicle/vehicleIdentity');
    m.resetVehicleIdentity();
    m.recordVinObservation('KISMIVINDEGERI', 'mode09', 1, 1);
    const s = m.getVehicleIdentity(1, 2026);
    expect(s.rejections).toHaveLength(1);
    expect(JSON.stringify(s.rejections), 'ham reddedilen değer sızıyor').not.toContain('KISMI');
    expect(s.rejections[0]!.length).toBe(14);
    m.resetVehicleIdentity();
  });

  it('KİLİT: model yılı BELİRSİZKEN tek yıl uydurulmuyor', async () => {
    const { decodeVin } = await import('../platform/vehicle/vinDecode');
    /* 10. hane '9' → 2009 VEYA 2039; her ikisi de mümkünse yıl BELİRSİZDİR. */
    const f = decodeVin('1HGBH41JX9N109186', 2050);
    expect(f.modelYearCandidates.length).toBeGreaterThan(1);
    expect(f.modelYear, 'belirsiz yılda tek yıl uyduruluyor').toBeNull();
  });

  it('KİLİT: kontrol hanesi Kuzey Amerika DIŞINDA uygulanmıyor', async () => {
    const { vinCheckDigit } = await import('../platform/vehicle/vinDecode');
    /* Avrupa'da 9. hane kontrol hanesi DEĞİLDİR; doğrulamak geçerli bir VIN'i
       "bozuk" gösterirdi — sahte başarısızlık. */
    expect(vinCheckDigit('VF1RJL00X66123456')).toBe('not_applicable');
    expect(vinCheckDigit('1HGBH41JXMN109186')).toBe('valid');
  });

  it('KİLİT: VIN\'den marka/model/SINIF ÜRETİLMİYOR', () => {
    const d = strip9(read(DEC));
    expect(d, 'çözümleyiciye marka/model tablosu gömülmüş')
      .not.toMatch(/brand|makeName|modelName|bodyType/i);
    expect(d, 'çözümleyici araç sınıfı üretiyor')
      .not.toMatch(/legalVehicleCategory|'N1'|'M1'/);
    /* Ne çıkarılamadığı EKRANDA yazılır — eksiklik "sistem beceremedi" değil,
       "standart vermiyor" diye okunmalı. */
    expect(d, 'çıkarılamayanlar listesi kaldırılmış').toContain('notDerivable');
    const id = strip9(read(ID));
    expect(id, 'kimlik katmanı sınıf üretmeye başlamış')
      .not.toMatch(/legalVehicleCategory\s*[:=]/);
  });

  it('KİLİT: vinContext İKİNCİ depo değil — kanonik katmana devrediyor', () => {
    const c = strip9(read(CTX));
    expect(c, 'vinContext yeniden kendi deposunu tutuyor')
      .not.toMatch(/let\s+_handshakeVin/);
    expect(c, 'kanonik katmana devir kaldırılmış').toContain('recordVinObservation');
    expect(c, 'kanonik okuma kaldırılmış').toContain('getCanonicalVin');
  });

  it('KİLİT: VIN çözümleyicisi SAF kalıyor (saat/I/O yok)', () => {
    const d = strip9(read(DEC));
    for (const bad of ['Date.now', 'setTimeout', 'setInterval', 'localStorage', 'fetch(']) {
      expect(d, `çözümleyiciye ${bad} girmiş`).not.toContain(bad);
    }
  });

  it('KİLİT: VIN katmanı obdService modülünü İTHAL ETMİYOR (grafik kirlenmesi)', () => {
    /* ÖLÇÜLDÜ: `vinContext`/`manufacturerPidService` içine konan
       `import { getObdSessionEpoch } from '../obdService'` kenarı, tüm OBD
       çekirdeğini sensör-sorgusu ve komut-ayrıştırıcısı grafiğine soktu →
       3 test dosyası `obdService` modül gövdesinde düştü. Oturum numarası
       İTİLİR (`setVinEpochProvider`), ÇEKİLMEZ. */
    for (const f of [ID, CTX, 'src/platform/obd/manufacturerPidService.ts']) {
      expect(strip9(read(f)), `${f} obdService'i ithal ediyor`)
        .not.toMatch(/from\s+'\.\.?\/obdService'/);
    }
    expect(strip9(read(ID)), 'oturum sağlayıcısı kaldırılmış')
      .toContain('export function setVinEpochProvider');
    expect(strip9(read('src/platform/obdService.ts')), 'sağlayıcı kaydı kaldırılmış')
      .toContain('setVinEpochProvider(getObdSessionEpoch)');
  });

  it('KİLİT: LAB VIN ekranı kayıtlı ve HAM VIN göstermiyor', () => {
    expect(read('src/platform/devtools/carosLabCatalog.ts')).toContain("id: 'vehicle-identity-vin'");
    expect(read('src/components/devtools/carosLabScreenMap.tsx')).toContain("case 'vehicle-identity-vin'");
    const s = strip9(read('src/components/devtools/screens/VehicleIdentityVinScreen.tsx'));
    expect(s, 'maskesiz VIN alanı ekranda kullanılmış').not.toMatch(/\bid\.vin\b|\{\s*facts\.vin\s*\}/);
    expect(s, 'maskeli biçim kaldırılmış').toContain('maskedVin');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-NAV-02 · NAVIGATION FOUNDATION
   ──────────────────────────────────────────────────────────────────────────
   Üç kapı kilitlenir:
    ① Sürüş yüzeyi motorun dürüstlük hükümlerini GÖSTERİR (ve uydurma varış
      saati YAZMAZ). Ölçülen kusur: ev widget'ı sürüş ekranından daha dürüsttü.
    ② Harita katman sırası TEK sözleşmededir; güvenlik overlay'i her zaman
      üstte kalır. Ham `z-[…]` geri gelirse bu kilit düşer.
    ③ `FullMapView`den çıkarılan üç yaşam döngüsü hook'u DAVRANIŞ TAŞIMAZ:
      korunan otoritelere dokunmadıkları kanıtlanır.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-NAV-02 · navigasyon temeli kilitleri', () => {
  const HUD   = 'src/components/map/NavigationHUD.tsx';
  const MODEL = 'src/platform/navigation/core/navigationHonestyModel.ts';
  const HOOK  = 'src/hooks/useNavigationHonesty.ts';
  const MAPD  = 'src/components/map';

  const stripN = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  /* ── ① DÜRÜSTLÜK ──────────────────────────────────────────────────────── */

  it('KİLİT: tam ekran HUD dürüstlük hükmünü OKUR', () => {
    const h = stripN(read(HUD));
    expect(h, 'HUD dürüstlük hükmünü okumayı bırakmış').toContain('useNavigationHonesty()');
    expect(h, 'yolculuk özetine hüküm geçirilmiyor').toContain('honesty={honesty}');
    /* P0-NAV-04: şerit `hud/TripSummary` içine taşındı (sakin, tek satır). */
    const trip = stripN(read('src/components/map/hud/TripSummary.tsx'));
    expect(trip, 'dürüstlük şeridi kaldırılmış').toContain('nav-honesty-strip');
  });

  it('KİLİT: UYDURMA VARIŞ SAATİ yazılmıyor', () => {
    /* Eskiden varış saati KOŞULSUZ `Date.now() + etaSeconds` idi; ETA motoru
       sayı üretmediğinde ekran pratikte "şu an varış" yazıyordu.
       P0-NAV-04: kapı `hud/TripSummary`ye taşındı — kilit de taşındı. */
    const trip = stripN(read('src/components/map/hud/TripSummary.tsx'));
    expect(trip, 'varış saati koşulsuz hesaplanıyor (fail-closed kapısı düşmüş)')
      .toContain('honesty.etaTrustworthy && etaSeconds > 0');
  });

  it('KİLİT: yaklaşık mesafe İŞARETLENİYOR', () => {
    const trip = stripN(read('src/components/map/hud/TripSummary.tsx'));
    expect(trip, 'yaklaşık işareti kaldırılmış').toContain('honesty.distanceApproximate');
    expect(trip, 'yaklaşık ETA işareti kaldırılmış').toContain('honesty.etaApproximate');
  });

  it('KİLİT: dürüstlük modeli SAF ve YENİ SAYI üretmiyor', () => {
    const m = stripN(read(MODEL));
    for (const bad of ['Date.now', 'setTimeout', 'setInterval', 'fetch(', 'localStorage', 'react']) {
      expect(m, `dürüstlük modeline ${bad} girmiş`).not.toContain(bad);
    }
    /* Sayı üretmek = mesafe/süre aritmetiği. Model yalnız hüküm sınıflandırır. */
    expect(m, 'modele aritmetik girmiş').not.toMatch(/Math\.(round|floor|max|min|abs)\s*\(/);
  });

  it('KİLİT: hüküm hook\u0027u İKİNCİ OTORİTE kurmuyor', () => {
    const h = stripN(read(HOOK));
    expect(h, 'hook kendi timer\u0027ını kurmuş').not.toMatch(/setInterval|setTimeout/);
    expect(h, 'hook ağa çıkmış').not.toContain('fetch(');
    /* Üç MEVCUT otoriteyi okur; dördüncüsünü YARATMAZ. */
    expect(h).toContain('getEtaVerdict');
    expect(h).toContain('useNavigation');
    expect(h).toContain('useRouteState');
  });

  /* ── ② KATMAN SÖZLEŞMESİ ──────────────────────────────────────────────── */

  it('KİLİT: harita bileşenlerinde HAM z-index kalmadı', () => {
    for (const f of readdirSync(resolve(root, MAPD)).filter((n) => n.endsWith('.tsx'))) {
      const src = stripN(read(join(MAPD, f)));
      expect(src, `${f} içinde ham Tailwind z sınıfı var`)
        .not.toMatch(/className=(?:"|'|`)[^"'`]*(?:^|\s)z-(?:\[[0-9]+\]|[0-9]+)(?:\s|"|'|`)/);
      expect(src, `${f} içinde ham zIndex sayısı var`).not.toMatch(/zIndex:\s*[0-9]+/);
    }
  });

  it('KİLİT: katman sözleşmesi TEK yerde tanımlı', () => {
    const css = read('src/styles/base.css');
    for (const t of ['--z-map-surface', '--z-map-hud', '--z-map-honesty', '--z-map-alert', '--z-map-sheet']) {
      expect(css, `${t} sözleşmeden kaldırılmış`).toContain(t);
    }
  });

  it('KİLİT: GÜVENLİK overlay\u0027i harita katmanlarının ÜSTÜNDE', () => {
    /* Harita yüzeyi kendi yığın bağlamıdır (kök `--z-map-surface`); geri vites
       overlay'i uygulama düzeyinde 100000'dedir → harita içindeki EN YÜKSEK
       değer bile onun altında kalır. İki taraf da kilitlenir. */
    const css = read('src/styles/base.css');
    const surface = Number(/--z-map-surface:\s*([0-9]+)/.exec(css)?.[1] ?? NaN);
    expect(Number.isFinite(surface), 'harita kökü sözleşmede yok').toBe(true);
    const app = read('src/App.tsx');
    expect(app, 'geri vites overlay z değeri düşürülmüş').toContain('z-[100000]');
    expect(surface, 'harita kökü güvenlik katmanına yaklaşmış').toBeLessThan(1000);
    /* Harita kökü `position:fixed` + z-index taşımalı: yığın bağlamı bundan doğar. */
    expect(read('src/components/map/FullMapView.tsx'))
      .toContain('fixed inset-0 glass-card border-none !shadow-none z-[var(--z-map-surface)]');
  });

  /* ── ③ AYRIŞTIRMA DAVRANIŞ TAŞIMIYOR ──────────────────────────────────── */

  it('KİLİT: ayrıştırılan hook\u0027lar KORUNAN otoritelere dokunmuyor', () => {
    const files = [
      'src/components/map/hooks/useMapOverlayLifecycle.ts',
      'src/components/map/hooks/useRouteDrawingLifecycle.ts',
      'src/components/map/hooks/useMapStyleLifecycle.ts',
    ];
    /* Kamera/takip ve oturum sahipliği bu turda ELLENMEDİ — görev şartı. */
    const forbidden = [
      'cameraFollowAuthority', 'navigationSessionRuntime', 'voiceGuidanceRuntime',
      'useEffectiveSpeedLimit', 'vehicleClassRuntime',
      'initializeMap', 'destroyMap', 'setDrivingView', 'enterNavigationView',
    ];
    for (const f of files) {
      const src = stripN(read(f));
      for (const bad of forbidden) {
        expect(src, `${f} korunan otoriteye dokunuyor: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('KİLİT: ayrıştırma sırasında EŞİKLER değişmedi', () => {
    const d = stripN(read('src/components/map/hooks/useRouteDrawingLifecycle.ts'));
    expect(d, 'deadlock eşiği değişmiş').toContain('>= 1200');
    expect(d, 'failsafe tarama periyodu değişmiş').toContain('}, 400)');
    expect(d, 'dönüş odağı eşiği değişmiş').toContain('dist < 200');
    expect(d, 'başlangıç parlaması süresi değişmiş').toContain('700');
  });

  it('KİLİT: paylaşılan yardımcı TEK tanımlı (çift dedup anahtarı yok)', () => {
    const fmv = stripN(read('src/components/map/FullMapView.tsx'));
    expect(fmv, 'FullMapView içinde ikinci bir _routeHash tanımı var')
      .not.toMatch(/function\s+_routeHash/);
    expect(read('src/components/map/hooks/_mapSurfaceInternals.ts'))
      .toContain('export function routeHash');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-NAV-03 · OEM+ SÜRÜŞ HARİTASI
   ──────────────────────────────────────────────────────────────────────────
   Bu turun üç riski kilitlenir:
    ① Görsel politikanın SAF modelden kaçıp bileşene/manager'a sızması.
    ② Yol katmanlarında İKİNCİ bir otorite doğması (NAV_SUPPRESS_TIERS vs
      declutter) — hangi değerin kazandığı çağrı sırasına kalırdı.
    ③ Kamera kompozisyonunun `cameraFollowAuthority`yi bypass etmesi ya da
      ikinci bir kamera otoritesi kurulması.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-NAV-03 · OEM+ sürüş haritası kilitleri', () => {
  const DECL = 'src/platform/map/core/mapDeclutterModel.ts';
  const EMPH = 'src/platform/map/core/routeEmphasisModel.ts';
  const COMP = 'src/platform/map/core/cameraCompositionModel.ts';
  const MIM  = 'src/platform/map/MapInteractionManager.ts';
  const MLM  = 'src/platform/map/MapLayerManager.ts';

  const stripV = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  /* ── ① SAFLIK ─────────────────────────────────────────────────────────── */

  it('KİLİT: üç görsel model de SAF kalıyor', () => {
    for (const f of [DECL, EMPH, COMP]) {
      const src = stripV(read(f));
      for (const bad of ['Date.now', 'setTimeout', 'setInterval', 'fetch(',
                         'localStorage', 'maplibre', 'react']) {
        expect(src, `${f} içine ${bad} girmiş`).not.toContain(bad);
      }
      expect(src, `${f} MapLibre nesnesi alıyor`).not.toMatch(/\bmap\s*:\s*MapLibreMap/);
    }
  });

  it('KİLİT: rota vurgusu RENK ve GENİŞLİK üretmiyor', () => {
    /* Renk `routeColorModel`in, genişlik `routeWidthModel`in. */
    const src = stripV(read(EMPH));
    expect(src, 'vurgu modeline renk gömülmüş').not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(src, 'vurgu modeline genişlik girmiş').not.toMatch(/line-width|routeWidthExpression/);
  });

  /* ── ② TEK OTORİTE ────────────────────────────────────────────────────── */

  it('KİLİT: declutter yol katmanlarını YENİDEN TANIMLAMIYOR', () => {
    const src = stripV(read(DECL));
    /* Model, yol tablosunu İTHAL ETMEZ — dışarıdan parametre alır. Ederse
       kendi yol değerini üretmeye bir adım kalmış demektir. */
    expect(src, 'declutter modeli yol tablosunu ithal ediyor')
      .not.toContain('NAV_SUPPRESS_TIERS');
    /* Yol kimlikleri gürültü tablosuna sızmamalı. */
    for (const road of ['road-primary', 'road-secondary', 'road-minor', 'road-label', 'place-town']) {
      expect(src, `${road} declutter tablosuna girmiş (iki otorite)`)
        .not.toContain("id: '" + road + "'");
    }
  });

  it('KİLİT: uygulayıcılar KARAR ÜRETMİYOR (eşik manager\u0027a sızmıyor)', () => {
    const src = read(MLM);
    const block = src.slice(src.indexOf('P0-NAV-03 · GÖRSEL SÖZLEŞMELERİN UYGULANMASI'));
    expect(block.length, 'uygulayıcı bölümü kaldırılmış').toBeGreaterThan(200);
    const body = stripV(block);
    /* Bölümde çıplak opaklık sabiti OLMAMALI: değerler modelden gelir. */
    expect(body, 'uygulayıcıya opaklık sabiti gömülmüş')
      .not.toMatch(/'line-opacity',\s*0?\.[0-9]/);
  });

  /* ── ③ KAMERA ─────────────────────────────────────────────────────────── */

  it('KİLİT: kamera kompozisyonu TEK politikadan geliyor', () => {
    const src = stripV(read(MIM));
    /* Aracın yeri artık `cameraPolicyModel`den; eski paralel eğri KULLANILMAZ. */
    expect(src, 'politika anchorı sürücüye bağlanmamış').toContain('resolveSpeedBand');
    expect(src, 'anchor→padding çevirisi kaldırılmış').toContain('resolveTopPadForAnchor');
    expect(src, 'eski paralel kompozisyon eğrisi geri gelmiş')
      .not.toContain('target.topPadFrac');
  });

  it('KİLİT: kamera SAHİPLİĞİ otoritesi bypass edilmiyor', () => {
    /* `cameraFollowAuthority` "kim sürüyor"un tek sahibidir; kompozisyon modeli
       ona DOKUNMAZ ve ikinci bir takip durumu tanımlamaz. */
    const src = stripV(read(COMP));
    for (const bad of ['cameraFollowAuthority', 'FOLLOW_SUSPENDED', 'USER_PANNING',
                       'notifyUserPan', 'beginRecenter']) {
      expect(src, `kompozisyon modeli takip otoritesine dokunuyor: ${bad}`)
        .not.toContain(bad);
    }
  });

  it('KİLİT: SIÇRAMA sınırlayıcıları duruyor', () => {
    const src = stripV(read(MIM));
    expect(src, 'anchor sıçrama sınırı kaldırılmış').toContain('ANCHOR_MAX_STEP');
    expect(src, 'zoom sıçrama sınırı kaldırılmış').toContain('ZOOM_MAX_STEP');
    expect(src, 'pitch sıçrama sınırı kaldırılmış').toContain('PITCH_MAX_STEP_DEG');
    expect(src, 'bearing sıçrama sınırı kaldırılmış').toContain('BEARING_MAX_STEP_DEG');
  });

  it('KİLİT: ileri bakış payı TAHMİN değil ÖLÇÜM', () => {
    /* Analitik Mercator tahmini pitch'i saymaz ve hatayı aracı ekran DIŞINA
       iten yönde yapar; bu yüzden `map.project` ölçümü geri beslenir. */
    const src = stripV(read(MIM));
    expect(src, 'ölçülen geri besleme kaldırılmış').toContain('updateAnchorBias');
    expect(src, 'analitik metre→piksel tahmini geri gelmiş')
      .not.toMatch(/156543|metersPerPixel/);
  });

  it('KİLİT: geri besleme YAKINSAR — kazanç 1\u0027in altında', () => {
    const src = read(COMP);
    const gain = Number(/ANCHOR_BIAS_GAIN\s*=\s*([0-9.]+)/.exec(src)?.[1] ?? NaN);
    expect(Number.isFinite(gain), 'kazanç sabiti kaldırılmış').toBe(true);
    /* ≥1 kazanç aşım (overshoot) ve salınım üretir — kamera sallanır. */
    expect(gain, 'kazanç 1 veya üstü — döngü salınır').toBeLessThan(1);
    expect(gain).toBeGreaterThan(0);
  });

  /* ── ④ MİNİ HARİTA ────────────────────────────────────────────────────── */

  it('KİLİT: mini harita tam ekranın KOPYASI değil', () => {
    const mini = stripV(read('src/components/map/MiniMapWidget.tsx'));
    expect(mini, 'mini harita sadeleştirme sözleşmesini uygulamıyor')
      .toContain("applyMapDeclutter(map, 'MINI'");
    const full = stripV(read('src/components/map/hooks/useMapStyleLifecycle.ts'));
    expect(full, 'tam ekran profili uygulanmıyor')
      .toContain("applyMapDeclutter(map, 'FULL'");
  });

  it('KİLİT: FullMapView\u0027a yeni BÜYÜK efekt bloğu doldurulmadı', () => {
    /* Görev şartı: bu tur SAF modeller ve mevcut hook'lar üzerinden
       çalıştı — efekt sayısı ARTMAMALI.

       TAVAN ÖLÇÜLEREK DÜZELTİLDİ (P0-NAV TEST GATE): kilit ilk yazımında 29
       diyordu, ama bu dosyada 29 HİÇ ölçülmedi — `git show HEAD` ile sayım
       **40**, ayrıştırma sonrası çalışma ağacında **32**. Yani kilit yazıldığı
       günden beri kırmızıydı ve koruduğu invaryantı hiç ölçmüyordu.
       Tavan gerçek ölçüme (32) çekildi: HEAD'e göre 8 efekt DAHA AZ, yani
       cırcır (ratchet) gevşetilmedi, ilk kez GERÇEK bir değere oturtuldu.
       Efekt sayısını körlemesine 29'a indirmek için çalışan navigasyon
       kodunu parçalamak bilinçli olarak REDDEDİLDİ (spekülatif refactor). */
    const n = (read('src/components/map/FullMapView.tsx').match(/useEffect\(/g) ?? []).length;
    expect(n, 'FullMapView yeniden şişmiş').toBeLessThanOrEqual(32);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-NAV-04 · OEM+ SÜRÜŞ HUD'U
   ──────────────────────────────────────────────────────────────────────────
   Bu turun riski: yeniden tasarımın otoriteleri JSX'e sızdırması ya da
   dürüstlük kapılarının "temiz görünsün" diye gevşetilmesi.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-NAV-04 · sürüş HUD kilitleri', () => {
  const MODEL = 'src/platform/navigation/core/hudPresentationModel.ts';
  const HUDDIR = 'src/components/map/hud';

  it('KİLİT: sunum modeli SAF ve YENİ OTORİTE değil', () => {
    const m = stripSrc(read(MODEL));
    for (const bad of ['Date.now', 'setTimeout', 'setInterval', 'fetch(', 'react', 'useState']) {
      expect(m, `sunum modeline ${bad} girmiş`).not.toContain(bad);
    }
    /* Eşikler İCAT EDİLMEZ: mevcut karar otoritelerinden gelir. */
    expect(m, 'manevra bandı kendi eşiğini yazmış').toContain('MANEUVER_BANDS');
    expect(m, 'doğruluk eşiği kendi sayısını yazmış').toContain('ACTIONABLE_ACCURACY_M');
    /* Mesafe/süre/hız HESAPLAMAZ. */
    expect(m, 'modele mesafe/süre aritmetiği girmiş')
      .not.toMatch(/etaSeconds\s*[*/+-]|remainingMeters\s*[*/+-]/);
  });

  it('KİLİT: HUD alt bileşenleri KORUNAN otoriteleri bypass etmiyor', () => {
    const forbidden = [
      'navigationSessionRuntime', 'voiceGuidanceRuntime', 'speakNavigation',
      'vehicleClassRuntime', 'useSpeedLimitByLocation',
      'beginRecenter', 'notifyUserPan', 'setCameraNavActive',
    ];
    for (const f of ['ManeuverPanel.tsx', 'DrivingSpeed.tsx', 'TripSummary.tsx',
                     'NavigationStatus.tsx', 'DrivingControls.tsx']) {
      const src = stripSrc(read(`${HUDDIR}/${f}`));
      for (const bad of forbidden) {
        expect(src, `${f} korunan otoriteye dokunuyor: ${bad}`).not.toContain(bad);
      }
    }
    /* Takip durumu OKUNUR ama YAZILMAZ. */
    const dc = stripSrc(read(`${HUDDIR}/DrivingControls.tsx`));
    expect(dc).toContain('subscribeCameraFollow');
    expect(dc, 'kontrol kamerayı kendisi sürüyor').not.toContain('map.');
  });

  it('KİLİT: hız kümesi GPS/OBD yeniden HESAPLAMIYOR', () => {
    const s = stripSrc(read(`${HUDDIR}/DrivingSpeed.tsx`));
    for (const bad of ['gpsService', 'obdService', 'useGPSLocation', 'speedFusion', 'pickRawSpeed']) {
      expect(s, `hız kümesi kaynağı yeniden hesaplıyor: ${bad}`).not.toContain(bad);
    }
    /* Limit tek otoriteden gelir ve YOKSA sayı UYDURULMAZ. */
    expect(s).toContain('isEffectiveLimitDisplayable');
  });

  it('KİLİT: manevra kartı SADE — birincil üç bilgi', () => {
    const p = stripSrc(read(`${HUDDIR}/ManeuverPanel.tsx`));
    expect(p, 'manevra ok grafiği kaldırılmış').toContain('ManeuverArrow');
    expect(p, 'mesafe kaldırılmış').toContain('maneuver-distance');
    expect(p, 'girilecek yol kaldırılmış').toContain('maneuver-road');
    /* Karta durum/ağ/toplam bilgisi YIĞILMAZ (görev şartı). */
    for (const bad of ['ONLINE', 'çevrimdışı', 'Çevrimdışı', 'totalDistanceMeters', 'accuracy']) {
      expect(p, `manevra kartına ${bad} yığılmış`).not.toContain(bad);
    }
  });

  it('KİLİT: durum ŞERİDİ tek — alarm dili yalnız GPS için', () => {
    const m = stripSrc(read(MODEL));
    /* Rota kusuru ve yeniden rota SAKİN tondadır; yalnız konum bozukluğu ALERT. */
    expect(m).toMatch(/REROUTING:\s*'NOTICE'/);
    expect(m).toMatch(/ROUTE_DEGRADED:\s*'NOTICE'/);
    expect(m).toMatch(/GPS_DEGRADED:\s*'ALERT'/);
    /* Manevra vurgusu sırasında durum şeridi susar (ekran bütçesi). */
    expect(m).toContain("HUD_TONE_OF[state] !== 'NEUTRAL' && !emphasis");
  });

  it('KİLİT: yeniden rota sırasında GEÇERSİZ manevra gösterilmiyor', () => {
    const m = stripSrc(read(MODEL));
    expect(m, 'geçersiz manevra kapısı kaldırılmış')
      .toContain("const showManeuver = state !== 'REROUTING'");
  });

  it('KİLİT: aktif rehberlikte ZOOM kolonu çizilmiyor', () => {
    const m = stripSrc(read(MODEL));
    expect(m, 'zoom kolonu sürüşe geri gelmiş').toContain('showZoomControls: false');
  });

  it('KİLİT: NavigationHUD şişmesi geri gelmedi', () => {
    /* Tur öncesi 2.198 satır / 20 bileşen tek dosyadaydı. */
    const src = read('src/components/map/NavigationHUD.tsx');
    const lines = src.split('\n').length;
    expect(lines, 'NavigationHUD yeniden şişmiş').toBeLessThanOrEqual(1700);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   P0-NAV-05 · HUD GÖRSEL KABUL — ÇAKIŞMA KÖKLERİ
   ──────────────────────────────────────────────────────────────────────────
   Bu kilitler bir ÖZÜR kaydıdır: P0-NAV-04 raporu GPS rozeti ve toplam-mesafe
   çipinin "kaldırıldığını" söylüyordu — YANLIŞTI. İkisi de manevra kartının
   İÇİNDE değil `FullMapView`de yaşıyordu ve kart 96 px kaydırmadan vazgeçince
   tam üstlerine düştü. Kilitler kökün geri gelmesini engeller.
   ══════════════════════════════════════════════════════════════════════════ */
describe('P0-NAV-05 · HUD çakışma kökleri kapalı', () => {
  const FMV = 'src/components/map/FullMapView.tsx';
  const HUDDIR = 'src/components/map/hud';

  it('KİLİT: GPS rozeti REHBERLİK sırasında çizilmiyor', () => {
    const src = stripSrc(read(FMV));
    /* Rozet idle haritada kalır; rehberlikte konum durumunun tek sahibi
       `NavigationStatus`tır (GPS_DEGRADED). */
    expect(src, 'GPS rozeti rehberlik kapısını kaybetmiş')
      .toContain("mapStatus === 'READY' && !isNavigating");
  });

  it('KİLİT: kalan mesafe İKİ yerde gösterilmiyor', () => {
    const src = stripSrc(read(FMV));
    expect(src, 'KM sayacı çipi geri gelmiş — mesafe iki otoriteden çiziliyor')
      .not.toContain('KM Sayacı');
    /* Tek sahip: yolculuk özeti. */
    expect(stripSrc(read(`${HUDDIR}/TripSummary.tsx`))).toContain('trip-remaining-dist');
  });

  it('KİLİT: hız birimi km/h (km/s DEĞİL)', () => {
    /* Yorumlar SIYRILIR: docblock yanlış birimi ANLATIYOR, kullanmıyor. */
    const s = stripSrc(read(`${HUDDIR}/DrivingSpeed.tsx`));
    expect(s, 'yanlış birim geri gelmiş').not.toMatch(/>\s*km\/s\s*</);
    expect(s, 'birim kaldırılmış').toMatch(/>\s*km\/h\s*</);
    /* Büyük harf `KM/H` birimin bozulmuş hâlidir. */
    expect(s).not.toContain('KM/H');
  });

  it('KİLİT: ORTALA görünürlüğü OTORİTENİN kendi cevabından', () => {
    const dc = stripSrc(read(`${HUDDIR}/DrivingControls.tsx`));
    expect(dc, 'kanonik yardımcı kullanılmıyor').toContain('isRecenterAvailable()');
    /* İkinci kural yazılırsa otoritenin saydığı bir hâl (UNKNOWN) atlanır. */
    expect(dc, 'görünürlük kuralı bileşende YENİDEN yazılmış')
      .not.toMatch(/state === CameraFollowState\.(FOLLOW_SUSPENDED|USER_PANNING)/);
  });

  it('KİLİT: yolculuk kartı global tanı düğmesini ÖRTMÜYOR', () => {
    /* `GlobalDiagnosticButton`: fixed · left 8 · 34 px genişlik → sağ kenar 42.
       Kartın sol kenarı bunu geçmeli. */
    const diag = read('src/components/common/GlobalDiagnosticButton.tsx');
    expect(diag).toContain('left: 8');
    expect(diag).toContain('width: 34');
    const trip = read(`${HUDDIR}/TripSummary.tsx`);
    expect(trip, 'kart tanı düğmesinin üstüne dönmüş')
      .toContain("left: 'max(56px, calc(var(--sal, 0px) + 44px))'");
    expect(56).toBeGreaterThan(8 + 34);
  });

  it('KİLİT: sonlandır düğmesi BİLGİ alanının dışında', () => {
    const trip = stripSrc(read(`${HUDDIR}/TripSummary.tsx`));
    /* Üç sütun kendi kabında esnek pay alır; düğme AYRI bölmede → rakamları ezemez.
       ── KİLİT SABİT SINIF METNİNE DEĞİL YAPIYA BAĞLI (2026-09-09) ──────────
       Eskiden `flex flex-1 flex-col min-w-0` metni aranıyordu. Cihazda ölçüldü
       (kütük #1220): EŞİT `flex-1` payı portre kartta mesafeyi kırpıyordu
       ("55…"). Pay artık içeriğe orantılı verilir (`style={{ flex: … }}`), ama
       kilidin KORUDUĞU şey değişmedi: hücreler daralabilir (`min-w-0`) ve
       sonlandır düğmesi bilgi kabının DIŞINDA kalır. */
    expect(trip).toContain('flex flex-1 min-w-0 items-center');
    expect(trip, 'hücre daralamaz hâle gelmiş (min-w-0 kayboldu)')
      .toContain('flex flex-col min-w-0');
    /* `flex-basis` `auto` OLMALI: kart shrink-to-fit'tir, `0%` tabanla hücreler
       kartın doğal genişliğine katkı vermez ve kart tavanına hiç açılmaz
       (cihazda ölçüldü: ~303 CSS px) → metin yine kırpılır. */
    expect(trip, 'hücre payı esnek değil veya flex-basis 0% (kart açılmaz)')
      .toMatch(/style=\{\{ flex: `\$\{grow\} 1 auto` \}\}/);
    expect(trip, 'düğme bilgi kabının içine dönmüş')
      .not.toMatch(/trip-remaining-dist[\s\S]{0,200}trip-stop/);
  });

  it('KİLİT: ANA EKRAN görsel ağırlığı düşük ama dokunma hedefi BÜYÜK', () => {
    const m = read('src/components/map/MapHudControls.tsx');
    expect(m, 'dokunma hedefi küçülmüş').toContain('minWidth: 44, minHeight: 44');
    expect(m, 'ağır gölge geri gelmiş').not.toContain("boxShadow: '0 8px 28px rgba(0,0,0,0.45)'");
    expect(m, 'parlak kalın kenar geri gelmiş').not.toContain("border: '1.5px solid rgba(255,255,255,0.22)'");
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-08 — SAĞLAYICI DÜZEYİ ARAMA KANITI

   ÖLÇÜLEN KUSUR (2026-08-24): defter yalnız CEVAPLAYAN katmanı
   yazıyordu. Nominatim'in zaman aşımına uğraması, 0 döndürmesi ve
   bozuk JSON vermesi ÜÇÜ DE `stage: 'NONE'` olarak görünüyordu —
   oysa üçünün sonraki adımı FARKLI (eşik/ağ · veri lisansı · KOD).
   Bu kilit, ayrımın kaybolmasını engeller.
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-08 sağlayıcı kanıtı', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 hüküm katmanı TEK ve SAFTIR (paralel otorite YOK)', () => {
    const m = rd('platform/geo/searchChainModel.ts');
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'zaman okuma').not.toMatch(/Date\.now\s*\(/);
    expect(m, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'kalıcı depolama').not.toMatch(/localStorage|indexedDB/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 zaman aşımı / hata / çözümleme hatası "gerçek 0"dan ÖNCE gelir', () => {
    const m = rd('platform/geo/searchChainModel.ts');
    const iParse   = m.indexOf("return verdict(\n      'PARSE_FAILURE'");
    const iTimeout = m.indexOf("if (has('TIMEOUT'))");
    const iError   = m.indexOf("if (has('ERROR'))");
    const iZero    = m.indexOf("'TRUE_ZERO',");
    for (const [name, i] of [['parse', iParse], ['timeout', iTimeout], ['error', iError]] as const) {
      expect(i, `${name} dalı bulunamadı`).toBeGreaterThan(0);
      expect(i, `${name} dalı TRUE_ZERO'dan SONRA — "veri yok" yanlış iddia edilir`)
        .toBeLessThan(iZero);
    }
  });

  it('🔒 TRUE_ZERO yalnız ULAŞILAN sağlayıcı varken iddia edilir', () => {
    const m = rd('platform/geo/searchChainModel.ts');
    expect(m).toMatch(/if \(reached\.length > 0 && totalRaw === 0\)/);
  });

  it('🔒 İKİ arama yüzeyi de sağlayıcı denemesi BİLDİRİR', () => {
    /* Yüzeylerin ayrışması bu projenin tekrar eden saha kusurudur (#332,
       #547, P0-NAV-06/1). Kanıt katmanı tek yüzeyde kalırsa ayrışma yine
       görünmez olur. */
    expect(rd('platform/mapService.ts'), 'harita çubuğu bildirmiyor')
      .toMatch(/providerAttempts:\s*_attempts/);
    expect(rd('platform/addressNavigationEngine.ts'), 'Mavi/adres kartı bildirmiyor')
      .toMatch(/providerAttempts:\s*trace\?\.attempts/);
  });

  it('🔒 zaman aşımı ile ağ hatası KAYITTA ayrışır (tek kovaya düşmez)', () => {
    for (const f of ['platform/mapService.ts', 'platform/geocodingService.ts']) {
      const src = rd(f);
      expect(src, `${f}: AbortError ayrımı yok`).toMatch(/AbortError/);
      expect(src, `${f}: çözümleme hatası sınıfı yok`).toMatch(/'PARSE_ERROR'/);
    }
  });

  it('🔒 "denenmedi" ile "0 döndü" AYNI DEĞİLDİR', () => {
    const m = rd('platform/geo/searchChainModel.ts');
    /* `NOT_ATTEMPTED` bir deneme SAYILMAZ — yoksa hiç çağrılmamış katman
       "sağlayıcıya ulaşıldı, veri yok" kanıtı gibi okunur. */
    expect(m).toMatch(/attempts\.filter\(\(a\) => a\.outcome !== 'NOT_ATTEMPTED'\)/);
    expect(rd('platform/geo/addressSearchLedger.ts'))
      .toMatch(/if \(a\.outcome === 'NOT_ATTEMPTED'\) continue;/);
  });

  it('🔒 sıralama puanı BİLEŞENLERİYLE taşınır (neden birinci ölçülebilir)', () => {
    const pq = rd('platform/geo/placeQueryModel.ts');
    expect(pq).toMatch(/readonly breakdown: SearchScoreEvidence;/);
    expect(pq).toMatch(/layerBonus:\s*_r3\(layerBonus\)/);
  });

  it('🔒 tekilleştirme SESSİZ değildir (kaç aday birleşti ölçülür)', () => {
    expect(rd('platform/geo/placeQueryModel.ts')).toContain('dedupePlacesWithEvidence');
    expect(rd('platform/mapService.ts')).toMatch(/_dedupe = _deduped\.evidence/);
  });

  it('🔒 kanıt LAB ekranına taşınır (gözlemlenemeyen özellik tamamlanmamıştır)', () => {
    const model = rd('platform/devtools/addressSearchModel.ts');
    expect(model, 'sağlayıcı sicili kartı yok').toContain('7 · Sağlayıcı Sicili');
    expect(model, 'zincir hükmü kartı yok').toContain('8 · Zincir Hükmü');
    /* Ölçülmeyen alan sahte 0 DEĞİL, UNAVAILABLE gösterilir. */
    expect(model).toMatch(/s\.dedupeMergedTotal === null \? NA/);
    expect(model).toMatch(/s\.chainVerdictSampleCount === 0/);
  });

  it('🔒 LAB kanıtı PII TAŞIMAZ — yalnız sınıf, adet ve süre', () => {
    const m = rd('platform/geo/searchChainModel.ts');
    /* Sorgu metni / koordinat bu modüle GİRMEZ: kanonik sonuç tipi dışında
       hiçbir fonksiyon `query` almaz. */
    expect(m).not.toMatch(/function \w+\([^)]*\bquery\b/);
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-09 — HEDEF OTORİTESİ FAIL-CLOSED

   ÖLÇÜLEN KUSUR (2026-08-24): koordinat kapısı `isValidDestination`
   üründe VARDI ama YALNIZ Ev/İş yolunda çağrılıyordu. Tüm hedeflerin
   geçtiği `startNavigation` sahipliği sorguluyor ama GEÇERLİLİĞİ
   sormuyordu → NaN/0,0/aralık dışı hedef sessizce mühürlenip rota
   motoruna gidebiliyordu ("motor var, besleyen yok" kusuru).
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-09 hedef bütünlüğü', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 bütünlük modeli SAFTIR (cihazsız test edilebilirlik)', () => {
    const m = rd('platform/navigation/core/destinationIntegrityModel.ts');
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'zaman okuma — saat DIŞARIDAN gelmeli').not.toMatch(/Date\.now\s*\(/);
    expect(m, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'kalıcı depolama').not.toMatch(/localStorage|indexedDB/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 kapı SAHİPLİK kapısından ÖNCE çalışır', () => {
    /* Tersi olsaydı kullanıcı kaynaklı bir NaN hedefi sahiplik kapısından
       ALLOW alır ve `_sealNavState` ile diske mühürlenirdi. */
    const nav = rd('platform/navigationService.ts');
    const iIntegrity = nav.indexOf('judgeDestinationIntegrity(');
    const iOwnership = nav.indexOf('judgeDestinationChange({');
    expect(iIntegrity, 'bütünlük kapısı çağrılmıyor').toBeGreaterThan(0);
    expect(iOwnership).toBeGreaterThan(0);
    expect(iIntegrity, 'bütünlük kapısı sahiplikten SONRA — sıra ters').toBeLessThan(iOwnership);
  });

  it('🔒 FAIL-CLOSED: geçersiz hedefte startNavigation ERKEN DÖNER', () => {
    const nav = rd('platform/navigationService.ts');
    expect(nav).toMatch(/if \(!integrity\.ok\)[\s\S]{0,400}?return;/);
    /* Mühürleme (diske yazma) kapıdan SONRA olmalı. */
    const iGate = nav.indexOf('if (!integrity.ok)');
    const iSeal = nav.indexOf('_sealNavState(destination, 0, false)');
    expect(iSeal).toBeGreaterThan(iGate);
  });

  it('🔒 hedef ADI red logunda GEÇMEZ (PII)', () => {
    const nav = rd('platform/navigationService.ts');
    const warn = nav.match(/Hedef REDDEDİLDİ[\s\S]{0,320}?\);/);
    expect(warn, 'red logu bulunamadı').not.toBeNull();
    expect((warn as RegExpMatchArray)[0], 'hedef adı loglanıyor')
      .not.toMatch(/destination\.name|integrity\.identity\?\.displayName/);
  });

  it('🔒 takas ŞÜPHESİ koordinatı ASLA düzeltmez', () => {
    const m = rd('platform/navigation/core/destinationIntegrityModel.ts');
    /* Sessiz düzeltme = kanıtsız yere sürmek. Künye HER ZAMAN verilen
       koordinatı taşır; takas edilmiş değerler yalnız ÖLÇÜMDE kullanılır. */
    expect(m).toMatch(/latitude:\s+lat as number/);
    expect(m).toMatch(/longitude:\s+lng as number/);
    expect(m, 'künyeye takas edilmiş koordinat yazılıyor')
      .not.toMatch(/latitude:\s+lng|longitude:\s+lat/);
  });

  it('🔒 künye alanları OPSİYONELDİR — bildirmeyen çağıran cezalandırılmaz', () => {
    const addr = rd('platform/addressBookService.ts');
    expect(addr).toMatch(/provider\?: string;/);
    expect(addr).toMatch(/resolvedAtMs\?: number;/);
    expect(addr).toMatch(/precision\?: 'ROOFTOP' \| 'STREET' \| 'AREA' \| 'UNKNOWN';/);
    /* Bayatlık YALNIZ iki uç da ölçüldüğünde iddia edilir. */
    const m = rd('platform/navigation/core/destinationIntegrityModel.ts');
    expect(m).toMatch(/resolvedAtMs !== null && ctx\.nowMs !== null/);
  });

  it('🔒 arama yüzeyleri künyeyi DOLDURUR (zincir gerçekten izlenebilir)', () => {
    expect(rd('platform/addressNavigationEngine.ts'), 'Mavi/adres kartı künye yazmıyor')
      .toMatch(/resolvedAtMs: Date\.now\(\)/);
    expect(rd('components/map/MapSearchBar.tsx'), 'harita çubuğu künye yazmıyor')
      .toMatch(/resolvedAtMs: Date\.now\(\)/);
  });

  it('🔒 kanıt LAB ekranına taşınır ve PII TAŞIMAZ', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model, 'hedef bütünlüğü kartı yok').toContain('14 · Hedef Bütünlüğü');
    const sources = rd('platform/devtools/navigationCoreSources.ts');
    /* Kimlik MASKELİ taşınır; hedef adı ve koordinat HİÇ taşınmaz. */
    expect(sources).toMatch(/_maskId\(/);
    expect(sources, 'hedef adı LAB anlık görüntüsüne sızıyor')
      .not.toMatch(/destinationName|committed\?\.displayName/);
    expect(sources, 'hedef koordinatı LAB anlık görüntüsüne sızıyor')
      .not.toMatch(/destinationLat|committed\?\.latitude/);
  });

  it('🔒 zincir hükmü tek eksende "tutarlı" DEMEZ', () => {
    /* Yalnız kimlik ya da yalnız koordinat ölçülebildiyse hüküm UNKNOWN'dır —
       yarım kanıtla tam hüküm vermek bu deponun tekrar eden kusurudur. */
    const m = rd('platform/navigation/core/destinationIntegrityModel.ts');
    expect(m).toMatch(/if \(!idsKnown \|\| !coordsKnown\) \{[\s\S]{0,200}?'UNKNOWN'/);
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-10 — ROTA SAĞLAYICI GERÇEĞİ

   ÖLÇÜLEN KUSUR (2026-08-24): `_tryServer` zengin hata sınıfları
   üretiyordu ama `fetchRoute` hepsini `catch { recordRemoteFailure(); }`
   ile TEK sayaca indiriyordu. "Hangi sunucu, neden düştü" ölçülemiyordu.
   İkinci kusur: yedek katman kurtardığında zincir "sağlıklı" okunuyordu —
   oysa bu GİZLİ DEGRADASYONdur.
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-10 sağlayıcı sicili', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 sicil SAFTIR (zaman DIŞARIDAN, ağ YOK)', () => {
    const m = rd('platform/navigation/core/routeProviderLedger.ts');
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'kalıcı depolama').not.toMatch(/localStorage|indexedDB/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 DÖRT katmanın HEPSİ denemesini bildirir', () => {
    const r = rd('platform/routingService.ts');
    for (const p of ['LOCAL_DAEMON', 'REMOTE_OSRM', 'OFFLINE_GRAPH', 'STRAIGHT_LINE']) {
      /* Düz metin araması: regex kaçışı bu bağlamda gereksiz kırılganlık. */
      expect(r, `${p} katmanı deneme bildirmiyor`).toContain(`_note('${p}'`);
    }
  });

  it('🔒 hata sebebi SINIFLANDIRILIR — tek sayaca indirilmez', () => {
    const r = rd('platform/routingService.ts');
    /* Eski davranış: `catch { recordRemoteFailure(); }` ve BAŞKA HİÇBİR ŞEY.
       Sayaç KORUNUR (mevcut LAB alanı ona bağlı) ama YANINDA sınıf yazılmalı. */
    expect(r).toMatch(/recordRemoteFailure\(\);[\s\S]{0,400}?_note\('REMOTE_OSRM', classifyRouteError\(/);
  });

  it('🔒 DÜZ HAT bir sağlayıcı DEĞİLDİR — asla SUCCESS yazılmaz', () => {
    const r = rd('platform/routingService.ts');
    expect(r, 'düz hat başarı olarak kaydediliyor')
      .not.toMatch(/_note\('STRAIGHT_LINE', 'SUCCESS'/);
    const m = rd('platform/navigation/core/routeProviderLedger.ts');
    /* Hüküm katmanı da düz hattı kazanan saymamalı. */
    expect(m).toMatch(/outcome: 'DEGRADED_STRAIGHT_LINE'/);
    expect(m).toMatch(/winner: null, winnerLabel: null/);
  });

  it('🔒 ATLANMIŞ katman degradasyon SAYILMAZ (uçak modunda yanlış alarm yok)', () => {
    const m = rd('platform/navigation/core/routeProviderLedger.ts');
    expect(m).toMatch(
      /a\.outcome !== 'SKIPPED_OFFLINE' && a\.outcome !== 'UNAVAILABLE'/,
    );
  });

  it('🔒 BAYAT yanıt zincirde BAŞARI sayılmaz', () => {
    const m = rd('platform/navigation/core/routeProviderLedger.ts');
    /* Kazanan YALNIZ `SUCCESS` olabilir; `STALE` uygulanmamış yanıttır. */
    expect(m).toMatch(/findIndex\(\(a\) => a\.outcome === 'SUCCESS'\)/);
    const r = rd('platform/routingService.ts');
    /* `_commitRoute` false döndüğünde (bayat) SUCCESS DEĞİL STALE yazılır. */
    expect(r).toMatch(/ok \? 'SUCCESS' : 'STALE'/);
  });

  it('🔒 sicil PII TAŞIMAZ — koordinat ve tam URL girmez', () => {
    const m = rd('platform/navigation/core/routeProviderLedger.ts');
    expect(m, 'koordinat alanı sicile sızmış').not.toMatch(/\b(lat|lon|lng)\s*:/);
    expect(m, 'tam URL alanı sicile sızmış').not.toMatch(/\burl\s*:/);
  });

  it('🔒 halka taşsa bile TOPLAM sayaç korunur', () => {
    /* Uzun bir sürüşte kronik zaman aşımı, halka taştığı için görünmez
       olmamalı — bu tam olarak sahada kaçırdığımız sınıftır. */
    const m = rd('platform/navigation/core/routeProviderLedger.ts');
    expect(m).toMatch(/_counts\.set\(key, \(_counts\.get\(key\) \?\? 0\) \+ 1\)/);
  });

  it('🔒 kanıt LAB ekranına taşınır', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model).toContain("id: 'pv-chain'");
    expect(model).toContain("id: 'pv-fallback-reason'");
    expect(model).toContain("id: 'pv-outcomes'");
    /* Ölçüm yoksa sahte 0 DEĞİL, UNAVAILABLE. `?? {}` model SAF bir okuyucu
       olduğu için vardır: alan hiç gelmezse çökmek yerine "ölçüm yok" der. */
    expect(model).toMatch(/Object\.keys\(s\.routeAttemptCounts \?\? \{\}\)\.length > 0/);
    /* Sicil hiç okunamadıysa da sahte "sağlıklı" ÜRETİLMEZ. */
    expect(model).toMatch(/const _chain = s\.routeChain \?\? null;/);
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-11 — GEOMETRİ BÜTÜNLÜĞÜ

   ÖLÇÜLEN BOŞLUKLAR (2026-08-24): yinelenen noktalar hiç ölçülmüyordu;
   ölçülen poliline uzunluğu sağlayıcının bildirdiği mesafeyle
   karşılaştırılmıyordu; REDDEDİLEN adayın kanıtı yalnız bir sayaca
   iniyordu (`console.warn` dışında iz kalmıyordu).
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-11 geometri bütünlüğü', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 geometri modeli SAFTIR', () => {
    const m = rd('platform/navigation/core/routeGeometryModel.ts');
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'kalıcı depolama').not.toMatch(/localStorage|indexedDB/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 geometri modeli rotayı REDDETMEZ (tek reddetme otoritesi korunur)', () => {
    /* Reddetme yetkisi `routeValidationModel.validateRoute`tedir. İkinci bir
       reddedici, bu deponun tekrar eden "ikinci otorite" kusurudur. */
    const m = rd('platform/navigation/core/routeGeometryModel.ts');
    expect(m, 'geometri modeli REJECTED üretiyor').not.toContain("'REJECTED'");
    expect(m).toMatch(/reddetme yetkisi TEK yerdedir/i);
  });

  it('🔒 REDDEDİLEN adayın kanıtı SİLİNMEZ', () => {
    const r = rd('platform/routingService.ts');
    /* Üç katmanın da reddi kanıt bırakmalı — yalnız sayaç artırmak yetmez. */
    expect(r).toMatch(/_noteRejected\('localhost:5000'/);
    expect(r).toMatch(/_noteRejected\(server, ci/);
    expect(r).toMatch(/_noteRejected\(offlineResult\.source/);
    /* Kanıt, düşen DENETİM KİMLİKLERİNİ de taşımalı (hangi iş olduğu belli olsun). */
    expect(r).toMatch(/checks\.filter\(\(c\) => c\.status === 'FAIL'\)\.map\(\(c\) => c\.id\)/);
  });

  it('🔒 geometri kanıtı KOORDİNAT TAŞIMAZ (gizlilik şartı #6)', () => {
    const m = rd('platform/navigation/core/routeGeometryModel.ts');
    /* bbox yalnız DERECE GENİŞLİĞİ olarak taşınır; köşe noktaları DEĞİL. */
    expect(m).toMatch(/bboxWidthDeg/);
    expect(m, 'bbox köşe koordinatı dışa açılmış')
      .not.toMatch(/readonly\s+(minLat|maxLat|minLon|maxLon)\s*:/);
  });

  it('🔒 bildirilen mesafe YOKSA uyuşmazlık İDDİA EDİLMEZ', () => {
    const m = rd('platform/navigation/core/routeGeometryModel.ts');
    expect(m).toMatch(/claimedDistanceM !== null && Number\.isFinite\(claimedDistanceM\) && claimedDistanceM > 0/);
  });

  it('🔒 yinelenen nokta uzunluğa KATILMAZ (sıfır segment matematiği bozar)', () => {
    const m = rd('platform/navigation/core/routeGeometryModel.ts');
    expect(m).toMatch(/if \(d <= DUPLICATE_POINT_M\) \{\s*\n\s*duplicates\+\+;/);
  });

  it('🔒 kanıt kaydı rota uygulamasını DÜŞÜREMEZ', () => {
    const r = rd('platform/routingService.ts');
    /* `_commitRoute` içindeki ölçüm try/catch ile sarılı olmalı — bir teşhis
       aracı ürünü düşüremez (fail-soft invaryantı). */
    expect(r).toMatch(/recordCommittedGeometry\(\{[\s\S]{0,700}?\}\);\s*\n\s*\} catch/);
  });

  it('🔒 kanıt LAB ekranına taşınır', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    for (const id of ['gm-integrity', 'gm-points', 'gm-ends', 'gm-extent', 'gm-rejected']) {
      expect(model, `${id} alanı yok`).toContain(`id: '${id}'`);
    }
    /* Rota hiç uygulanmadıysa sahte künye DEĞİL, UNAVAILABLE. */
    expect(model).toMatch(/const _cg = s\.committedGeometry \?\? null;/);
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-12 — İLERLEME DÜRÜSTLÜĞÜ (KIRPMA YOK)

   ÖLÇÜLEN BOŞLUK (2026-08-24): `routingService` her fix'te `progressM`i
   HESAPLIYOR ama yalnız adım ilerletmede kullanıp ATIYORDU. ETA
   sıçramalarının defteri VARDI (`etaJumpLedger`); onu BESLEYEN
   ilerlemenin defteri YOKTU.
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-12 ilerleme dürüstlüğü', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 ilerleme defteri SAFTIR', () => {
    const m = rd('platform/navigation/core/routeProgressLedger.ts');
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'zaman okuma — saat DIŞARIDAN gelmeli').not.toMatch(/Date\.now\s*\(/);
    expect(m, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 KÖR CLAMP YOK — hiçbir ilerleme değeri kırpılmaz', () => {
    /* NAV-12'nin açık kuralı: gerçek U dönüşü rotada GERİYE gitmektir ve
       meşrudur. Kırpmak onu görünmez kılıp sürücüyü yanlış yönlendirirdi. */
    const m = rd('platform/navigation/core/routeProgressLedger.ts');
    expect(m, 'delta kırpılıyor').not.toMatch(/deltaM\s*=\s*Math\.max\(0/);
    expect(m, 'delta clamp ediliyor').not.toMatch(/Math\.min\([^)]*deltaM/);
    /* Gerçek geri dönüş AYRI bir sınıf olarak var olmalı. */
    expect(m).toContain("'REAL_BACKTRACK'");
  });

  it('🔒 geri gidişi MEŞRU kılan tek kanıt YÖNDÜR', () => {
    const m = rd('platform/navigation/core/routeProgressLedger.ts');
    expect(m).toMatch(/s\.headingDeltaDeg >= PROGRESS_REVERSE_DEG/);
    /* Yön bilinmiyorsa "gerçek geri dönüş" İDDİA EDİLEMEZ. */
    expect(m).toMatch(/s\.headingDeltaDeg !== null/);
  });

  it('🔒 ters yön eşiği map-match ile AYNI otoriteden gelir', () => {
    const m = rd('platform/navigation/core/routeProgressLedger.ts');
    expect(m, 'ikinci bir ters-yön tanımı kurulmuş')
      .toMatch(/REVERSE_DELTA_DEG.*AYNI sayı|AYNI sayı.*REVERSE_DELTA_DEG/s);
  });

  it('🔒 eşleşme güvenilir DEĞİLSE ilerleme yargılanmaz', () => {
    /* Düşük güvenli bir fix'ten "ilerleme saçmaladı" sonucu çıkarmak,
       GPS gürültüsünü ürün kusuru sanmaktır. */
    const m = rd('platform/navigation/core/routeProgressLedger.ts');
    expect(m).toMatch(/if \(s\.matchState !== 'MATCHED'\)[\s\S]{0,200}?'UNKNOWN'/);
  });

  it('🔒 rota DEĞİŞİMİ sıçrama SAYILMAZ (her reroute sahte alarm üretmez)', () => {
    const m = rd('platform/navigation/core/routeProgressLedger.ts');
    expect(m).toMatch(/s\.prevRouteRevision !== s\.routeRevision/);
    expect(m).toContain("'ROUTE_CHANGED'");
  });

  it('🔒 hız BİLİNMİYORSA bütçe sabit payla sınırlıdır', () => {
    /* Bilinmeyen hızdan büyük bir bütçe türetmek, sıçramayı meşrulaştırmaktır. */
    const m = rd('platform/navigation/core/routeProgressLedger.ts');
    expect(m).toMatch(/const kmh = \(s\.speedKmh !== null && Number\.isFinite\(s\.speedKmh\) && s\.speedKmh > 0\)\s*\n?\s*\? s\.speedKmh : 0;/);
  });

  it('🔒 tick içindeki yargı ürünü DÜŞÜREMEZ (fail-soft)', () => {
    const r = rd('platform/routingService.ts');
    expect(r).toMatch(/judgeProgress\(\{[\s\S]{0,2400}?\} catch \{ \/\* teşhis kaydı navigasyon tick'ini/);
  });

  it('🔒 yeni oturum ilerleme geçmişini TAŞIMAZ', () => {
    const r = rd('platform/routingService.ts');
    /* `setRerouteContext` ve `clearRerouteContext` ikisi de sıfırlamalı. */
    const occurrences = r.match(/resetProgressLedger\(\);/g) ?? [];
    expect(occurrences.length, 'oturum sıfırlaması eksik').toBeGreaterThanOrEqual(2);
  });

  it('🔒 kanıt LAB ekranına taşınır', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model).toContain('15 · İlerleme Dürüstlüğü');
    for (const id of ['pr-verdict', 'pr-backtrack', 'pr-forward', 'pr-extremes']) {
      expect(model, `${id} alanı yok`).toContain(`id: '${id}'`);
    }
    /* Hiç örnek yoksa sahte "normal" DEĞİL, UNAVAILABLE. */
    expect(model).toMatch(/_pg === null \|\| _pg\.totalSamples === 0/);
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-13 — REROUTE ENGELLERİ GÖRÜNÜR OLMALI

   ÖLÇÜLEN KUSUR (2026-08-24): `getRerouteBlockStats()` ÜRÜNÜN HİÇBİR
   YERİNDEN OKUNMUYORDU — tek çağıranı bir testti. `routingService`
   içindeki yorum "Kapı artık nedeniyle DEFTERE yazılıyor (LAB'da
   görünür)" diyordu; ölçüm bunu ÇÜRÜTTÜ. Kütük #402'nin kapatmayı
   amaçladığı boşluk GÖZLEM tarafında açık kalmıştı.
   İKİNCİ KUSUR: kalıcı engelde sürücü rota dışındayken sonsuza kadar
   yeni rota alamıyordu ve bu SESSİZDİ.
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-13 reroute görünürlüğü', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 engel istatistiği ÜRÜNDE okunur (yalnız testte değil)', () => {
    /* Bu kilit, "yazılıyor ama hiçbir yerden okunmuyor" sınıfını kapatır —
       bu deponun tekrar eden "motor var, besleyen yok" kusuru. */
    const src = rd('platform/devtools/navigationCoreSources.ts');
    expect(src, 'LAB engel istatistiğini okumuyor').toContain('getRerouteBlockStats');
  });

  it('🔒 engel SEBEPLERİ ekranda ayrışır', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model).toContain("id: 'rq-blocked'");
    expect(model).toContain("id: 'rq-blocked-why'");
    /* Zayıf doğruluk ≠ throttle ≠ düz hat — üçü FARKLI işi işaret eder. */
    expect(model).toMatch(/Zayıf doğruluk ≠ throttle ≠ düz hat/);
  });

  it('🔒 AÇLIK görünür — sürücü sessizce eski talimatla bırakılmaz', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model).toContain("id: 'rq-health'");
    expect(model).toContain("id: 'rq-starve'");
    const m = rd('platform/navigation/core/rerouteStarvationModel.ts');
    expect(m).toContain("'STARVED'");
  });

  it('🔒 açlık modeli SAFTIR ve YENİ TIMER KURMAZ', () => {
    /* NAV-13'ün açık kuralı: "polling/timer artırarak problemi çözme". */
    const m = rd('platform/navigation/core/rerouteStarvationModel.ts');
    expect(m, 'timer kurulmuş').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'zaman okuma — saat DIŞARIDAN gelmeli').not.toMatch(/Date\.now\s*\(/);
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 açlık hükmü REROUTE TETİKLEMEZ — doğruluk kapısı EZİLMEZ', () => {
    /* Zayıf sinyalde rota kurmak yanlış yere rota kurmaktır (fail-closed).
       Model yalnız açlığı GÖRÜNÜR kılar; eşik gevşetmez. */
    const m = rd('platform/navigation/core/rerouteStarvationModel.ts');
    expect(m, 'model rota isteği tetikliyor').not.toMatch(/fetchRoute|_triggerReroute/);
    expect(m, 'model doğruluk eşiğini değiştiriyor').not.toMatch(/ACTIONABLE_ACCURACY_M\s*=/);
  });

  it('🔒 SAAT BİRLİĞİ: açlık monotonik saatle ölçülür', () => {
    /* `offRoute.confirmedAtMs` ve `committedAtMs` ikisi de `performance.now()`
       mertebesindedir. Duvar saatiyle karıştırmak süreyi saçmalatırdı. */
    const src = rd('platform/devtools/navigationCoreSources.ts');
    expect(src).toMatch(/nowMs: nowPerf/);
  });

  it('🔒 tek GPS gürültüsü reroute BAŞLATAMAZ (mevcut kilit korunur)', () => {
    const m = rd('platform/navigation/core/offRouteModel.ts');
    expect(m).toMatch(/MIN_EVIDENCE\s*=\s*2/);
    /* Sayı kanıtının YANINDA süre kanıtı da şarttır. */
    expect(m).toContain('requiredEvidenceMsFor');
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-15 — MANEVRA ANLAMI (UYDURMA DÖNÜŞ YASAĞI)

   ÖLÇÜLEN KUSUR (2026-08-24): `toTR`in tip listesi eksikti ve
   tanınmayan her tip sessizce DEĞİŞTİRİCİYE düşüyordu. `merge`,
   `fork`, `on ramp`, `off ramp` ürün kodunun hiçbir yerinde
   geçmiyordu; OSRM bunları üretir ve sonuç "Sağa dönün" oluyordu.
   120 km/h'te var olmayan bir kavşak aratmak TEHLİKELİDİR.
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-15 manevra anlamı', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 manevra modeli SAFTIR', () => {
    const m = rd('platform/navigation/core/maneuverSemanticsModel.ts');
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'zaman okuma').not.toMatch(/Date\.now\s*\(/);
    expect(m, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'React sızıntısı').not.toMatch(/from 'react'/);
  });

  it('🔒 merge · fork · rampa tipleri TANINIR', () => {
    /* Bunlar OSRM'in GERÇEKTEN ürettiği tiplerdir; tanınmazlarsa dönüş
       cümlesine düşerler. */
    const m = rd('platform/navigation/core/maneuverSemanticsModel.ts');
    for (const t of ['merge', 'fork', 'on ramp', 'off ramp']) {
      expect(m, `${t} tipi sözlükte yok`).toContain(`'${t}':`);
    }
  });

  it('🔒 bu sınıfların cümlelerinde "dönün" GEÇMEZ', () => {
    const m = rd('platform/navigation/core/maneuverSemanticsModel.ts');
    /* Cümle üreticisinin merge/fork/rampa dalları dönüş sözcüğü kullanamaz. */
    const merge = m.match(/case 'MERGE':[\s\S]{0,320}?\}/)?.[0] ?? '';
    const fork  = m.match(/case 'FORK':[\s\S]{0,320}?\}/)?.[0] ?? '';
    const rampOff = m.match(/case 'RAMP_OFF':[\s\S]{0,320}?\}/)?.[0] ?? '';
    expect(merge.length, 'MERGE dalı bulunamadı').toBeGreaterThan(0);
    expect(merge, 'merge dönüş cümlesi üretiyor').not.toContain('dönün');
    expect(fork, 'fork dönüş cümlesi üretiyor').not.toContain('dönün');
    expect(rampOff, 'rampa dönüş cümlesi üretiyor').not.toContain('dönün');
  });

  it('🔒 TANINMAYAN tip bir yöne çevrilmez', () => {
    const m = rd('platform/navigation/core/maneuverSemanticsModel.ts');
    /* Fallback `UNKNOWN` sınıfı olmalı ve `recognized: false` taşımalı. */
    expect(m).toMatch(/kind: 'UNKNOWN',[\s\S]{0,140}?recognized: false/);
    expect(m).toMatch(/UYDURMA DÖNÜŞ YASAĞI/);
  });

  it('🔒 çeviri TEK otoritedir (routingService kopya tablo tutmaz)', () => {
    const rs = rd('platform/routingService.ts');
    expect(rs).toContain('maneuverToTr');
    /* Eski satır-içi tablo geri gelmiş olmamalı. */
    expect(rs, 'ikinci çeviri tablosu geri gelmiş')
      .not.toMatch(/return `Hafif sağa dönün\$\{s\}`/);
  });

  it('🔒 U dönüşü tip üstünde önceliklidir', () => {
    const m = rd('platform/navigation/core/maneuverSemanticsModel.ts');
    /* `uturn` denetimi tip sözlüğü aramasından ÖNCE gelmeli. */
    const iU = m.indexOf("if (m === 'uturn')");
    const iK = m.indexOf('const known = _KIND_BY_TYPE[t]');
    expect(iU).toBeGreaterThan(0);
    expect(iU, 'uturn denetimi tip aramasından sonra kalmış').toBeLessThan(iK);
  });
});

/* ───────────────────────────────────────────────────────────────
   🔒 KİLİT · P0-NAV-16 — SÖYLENMEYEN VE GEÇ SÖYLENEN ÖLÇÜLÜR

   ÖLÇÜLEN BOŞLUK (2026-08-24): runtime yalnız SÖYLENENİ sayıyordu.
   NAV-16'nın dört sorusundan (çok erken · çok geç · iki kez · HİÇ)
   yalnız "iki kez" ölçülebiliyordu (`_duplicateSuppressed`).
   Sürücünün gerçekten yaşadığı kusur ötekiler.
   ─────────────────────────────────────────────────────────────── */
describe('🔒 KİLİT · P0-NAV-16 anons denetimi', () => {
  const rd = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 denetim modeli SAFTIR', () => {
    const m = rd('platform/navigation/core/voiceGuidanceAudit.ts');
    expect(m, 'ağ çağrısı').not.toMatch(/\bfetch\s*\(/);
    expect(m, 'zaman okuma — saat DIŞARIDAN gelmeli').not.toMatch(/Date\.now\s*\(/);
    expect(m, 'timer').not.toMatch(/set(Timeout|Interval)\s*\(/);
    expect(m, 'TTS sızıntısı').not.toMatch(/speakNavigation|ttsService/);
  });

  it('🔒 SESSİZLİK her zaman kusur SAYILMAZ', () => {
    /* `distanceSource === 'UNKNOWN'` iken konuşmamak ürünün fail-closed
       tasarımıdır; kusur saymak doğru davranışı arıza gibi göstermek olurdu. */
    const m = rd('platform/navigation/core/voiceGuidanceAudit.ts');
    expect(m).toContain("'SILENCE_JUSTIFIED'");
    expect(m).toMatch(/if \(i\.wasRerouting \|\| !i\.hadUsableDistance\) return 'SILENCE_JUSTIFIED';/);
  });

  it('🔒 son kademe eşiği HIZA bağlı ölçülür (sabit metre DEĞİL)', () => {
    const r = rd('platform/navigation/voiceGuidanceRuntime.ts');
    expect(r).toMatch(/decision\.stage === 'IMMINENT' \? finalTierMetres\(input\.speedKmh\)/);
  });

  it('🔒 geçilen manevra yargılanır (kaçırma görünür olur)', () => {
    const r = rd('platform/navigation/voiceGuidanceRuntime.ts');
    expect(r).toContain('_closeWatchedManeuver');
    expect(r).toContain('recordMissedGuidance');
  });

  it('🔒 yeni oturum eski anons kusurlarını TAŞIMAZ', () => {
    const r = rd('platform/navigation/voiceGuidanceRuntime.ts');
    expect(r).toMatch(/resetGuidanceAudit\(\);/);
    /* Oturum bitince yarım kalan manevra "kaçırıldı" SAYILMAMALI. */
    expect(r).toMatch(/_watchedId = null;/);
  });

  it('🔒 mevcut planlayıcı kilitleri KORUNUYOR', () => {
    const m = rd('platform/navigation/core/voiceGuidanceModel.ts');
    /* Deterministik kimlik: yalnız adım indeksi reroute sonrası yanlış üretir. */
    expect(m).toMatch(/return `\$\{sessionId\}:\$\{routeRevision\}:\$\{stepIndex\}`/);
    /* Mesafe kaynağı bilinmiyorken KONUŞULMAZ. */
    expect(m).toMatch(/if \(distanceSource === 'UNKNOWN'\) return null;/);
    /* Reroute sırasında manevra anonsu yapılmaz. */
    expect(m).toMatch(/if \(!navActive \|\| isRerouting\) return null;/);
  });

  it('🔒 denetim kanıtı LAB ekranına taşınır ve METİN TAŞIMAZ', () => {
    const model = rd('platform/devtools/navigationCoreModel.ts');
    expect(model).toContain("id: 'vg-audit'");
    expect(model).toContain("id: 'vg-missed'");
    const m = rd('platform/navigation/core/voiceGuidanceAudit.ts');
    /* Talimat metni PII sayılmasa da gereksizdir; kanıt yalnız sınıf/sayı taşır. */
    expect(m, 'anons METNİ deftere sızmış').not.toMatch(/readonly text\s*:/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT 34 · P0-OBD-CORE-05 — TANI ADMİSYON KAPISI + firstDataAfterLastAttemptMs
 *
 * SAHA: KWP recovery/reconnect sürerken DTC/freeze-frame/ECU-probe sorguları
 * hatta çıkıyor, `ReadAll_03_Failed` gibi KALICI hata izlenimi bırakıyordu —
 * oysa recovery bitince AYNI sorgu normal cevapladı. AYRICA `firstDataAfterLastAttemptMs`
 * ölçümü, ECU-sessizliği turunda `_lastAttemptStartedAtMs`i SIFIRLAMADIĞI için
 * YENİ `firstDataAt`ı ESKİ bir transport denemesiyle kıyaslıyor, anlamsızca
 * büyük bir süre (ör. 223691 ms) üretiyordu.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT 34 · admisyon kapısı + firstDataAfterLastAttemptMs (#P0-OBD-CORE-05)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('🔒 ECU-sessizliği turu YENİ BAŞLARKEN `_lastAttemptStartedAtMs` de sıfırlanır', () => {
    const s = src('platform/obdService.ts');
    /* Sıfırlanmazsa "son denemeden ilk veriye" ölçümü ESKİ bir turu YENİ
       veriyle kıyaslar → LAB'da anlamsızca büyük bir süre üretir. */
    expect(s, 'firstDataAfterLastAttemptMs artık stale bir denemeyle kıyaslanabilir')
      .toMatch(/_connectAttemptStartedAtMs = 0;\s*\n\s*_firstRealDataAtMs = 0;\s*\n\s*_lastAttemptStartedAtMs = 0;/);
  });

  it('🔒 DTC/freeze-frame okumaları admisyon kapısından GEÇMEDEN ECU\'ya sorgu göndermez', () => {
    const s = src('platform/dtcService.ts');
    expect(s, 'readAllDTCs admisyon kapısını çağırmıyor').toMatch(/await getDiagnosticAdmission\(\)/);
    expect(s, 'admisyon reddi TX göndermeden dönmüyor').toMatch(/_deferredReadAllDTCsResult/);
    /* WAIT durumunda DTC_READ_FAILED ÜRETİLMEZ — ayrı bir sonuç sınıfı vardır. */
    expect(s).toMatch(/'deferred'/);
  });

  it('🔒 ECU keşfi (probeEcus) de AYNI admisyon kapısından geçer', () => {
    /* ── P0-VDK-F1A: KİLİT ZİNCİRE GENİŞLETİLDİ ─────────────────────────────
       Kapı KALKMADI, DOLAYLILAŞTI: `discoverEcus` artık kanonik tanı işlemini
       hazırlıyor ve admisyonu `prepareTransaction` çağırıyor. Eski kilit
       `multiEcuScan` içinde METİN arıyordu ve bu dolaylılaşmada, davranış
       hiç bozulmadığı hâlde kırıldı.

       Kilit artık İKİ HALKAYI birden zorunlu kılar — böylece kapı ya da
       omurga birinden biri sessizce kaldırılırsa test DÜŞER:
         ① `discoverEcus` işlemi hazırlar ve REDDEDİLİRSE boş topoloji döner
         ② `prepareTransaction` GERÇEKTEN `getDiagnosticAdmission()` çağırır
            ve READY olmayan her sonuçta işlemi FAILED yapar */
    const s = src('platform/obd/multiEcuScan.ts');
    expect(s, 'discoverEcus işlemi hazırlamıyor').toMatch(/await prepareTransaction\(txn\)/);
    expect(s, 'admisyon reddi boş topoloji döndürmüyor').toMatch(/if \(!prepared\.ok\) return emptyTopology\(\)/);

    const t = src('platform/obd/diagnosticTransaction.ts');
    expect(t, 'işlem admisyon kapısını ÇAĞIRMIYOR').toMatch(/await getDiagnosticAdmission\(\)/);
    expect(t, 'READY olmayan admisyonda işlem FAILED olmuyor')
      .toMatch(/admission !== 'READY'[\s\S]{0,120}transitionTransaction\(txn, 'FAILED'\)/);
    /* İKİNCİ KAPI KURULMADI: karar hâlâ `diagnosticAdmission` tekelinde. */
    expect(t, 'işlem kendi admisyon kuralını kopyalamış')
      .not.toMatch(/connectionState|RECOVERY_ACTIVE|TRANSPORT_DOWN/);
  });

  it('🔒 admisyon kapısı ikinci bir reconnect/recovery otoritesi KURMAZ — mevcut sinyalleri OKUR', () => {
    const s = src('platform/obd/diagnosticAdmission.ts');
    /* Kararı üreten SAF çekirdek yalnız var olan otoritelerden (obdService +
       kwpRecoveryEvidence) okur; yeni bir sayaç/timer/queue KURMAZ. */
    expect(s).toMatch(/getObdSessionHealth, getEcuRecoveryLadder/);
    expect(s).not.toMatch(/setInterval|setTimeout/);
  });

  it('🔒 gate UNKNOWN durumunda fail-closed olur (READY DEĞİLDİR)', () => {
    const s = src('platform/obd/diagnosticAdmission.ts');
    expect(s).toMatch(/admission: 'UNKNOWN'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT · MAVI-F2 — YAPAY ARA SÖZ (FILLER) YASAĞI · I11
 *
 * Mavi gecikmeyi "Bakıyorum… / Düşünüyorum… / Bir saniye… / Kontrol ediyorum…"
 * diyerek örtüyordu. Bu bir UX tercihi DEĞİL, ölçülmüş bir kusurdu: cümle hiçbir
 * bilgi taşımıyordu, tipik tur 1500 ms eşiğini aştığı için neredeyse HER TURDA
 * duyuluyordu ve geç ateşlediğinde BAŞLAMIŞ cevabı KESİYORDU.
 *
 * F2 mekanizmayı KAYNAKTAN kaldırdı; bu kilitler geri gelmesini engeller.
 * SEMANTİK ACK ("Araç sistemleri taranıyor") bu yasağın DIŞINDADIR ve ayrıca
 * `maviFillerAbolition.test.ts` içinde kilitlidir.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT · MAVI-F2 yapay ara söz yasağı (I11)', () => {
  /** Yorumlar hariç GERÇEK kod — F2 notları eski adları anlatım için içerir. */
  const codeOf = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('🔒 voiceService: gecikme filler timer\'ı ve ifade listesi GERİ GELMEDİ', () => {
    const code = codeOf(voiceServiceSrc);
    expect(code).not.toContain('THINKING_PHRASES');
    expect(code).not.toContain('_speakThinking');
    expect(code).not.toContain('THINKING_FEEDBACK_DELAY_MS');
    expect(code).not.toContain('_thinkingTimer');
  });

  it('🔒 LLM prompt\'undaki `feedback` örnekleri filler ÖĞRETMİYOR', () => {
    const fbs = [...companionChatProviderSrc.matchAll(/"feedback":"([^"]+)"/g)].map((m) => m[1]);
    expect(fbs.length, 'prompt örneği bulunamadı — kilit körleşti').toBeGreaterThan(5);
    for (const fb of fbs) {
      expect(fb, `prompt örneği filler öğretiyor: ${fb}`)
        .not.toMatch(/^(Bakıyorum|Bakayım|Düşünüyorum|Kontrol ediyorum|Bir saniye)\.*$/i);
    }
    // Gecikme örtme yasağı prompt'ta AÇIKÇA durur; sahte onay yasağını EZMEZ.
    expect(companionChatProviderSrc).toContain('GECİKME ÖRTME YASAK');
    expect(companionChatProviderSrc).toContain('SAHTE ONAY YASAK');
  });

  it('🔒 ACK politikası SAF kalır ve kalıplar ÇAPALI', () => {
    const code = codeOf(maviAckPolicySrc);
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
    expect(code).not.toMatch(/^\s*let\s/m);
    /* Çapa (`^…$`) kuralın GÜVENLİK özelliğidir: kalkarsa kalıp bir cümlenin
       İÇİNDE eşleşir ve semantik ACK'i de yutar ("Hava durumuna bakıyorum"). */
    const anchored = code.match(/\/\^[^\n]*\$\//g) ?? [];
    expect(anchored.length, 'çapalı filler kalıbı bulunamadı — kilit körleşti').toBeGreaterThan(4);
  });

  it('🔒 F0 telemetrisi KORUNDU: `filler_trigger` metriği kaldırılmadı', () => {
    /* F2 metriği SİLMEZ — sıfırlar. Damga artık ara sözün SESLENDİRİLDİĞİ değil,
       YAKALANIP DÜŞÜRÜLDÜĞÜ anda basılır → üretimde beklenen değer 0, sıfırdan
       büyük her değer bir regresyon kanıtıdır ve LAB'da görünür kalmalıdır. */
    expect(maviLatencyTraceSrc).toContain("'filler_trigger'");
    expect(maviLatencyTraceSrc).toContain("'ack_emitted'");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT · MAVI-F3 — KISMİ TRANSKRİPT EYLEM YETKİSİ TAŞIMAZ (spec K5/I4)
 *
 * Streaming ASR'ın en tehlikeli tarafı hız değil YETKİDİR: kullanıcı daha
 * cümlesini bitirmeden "Ankara'ya" duyulup rota açılırsa, kendini düzelten
 * kullanıcı ("… yok Mersin'e") YANLIŞ eylemi geri almak zorunda kalır. Bu
 * yüzden kısmi sonuç yalnız KANIT üretir; eylem YALNIZ kanonik nihai
 * transkriptten doğar. Aşağıdaki kilitler bu sınırı KAYNAK düzeyinde korur.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT · MAVI-F3 kısmi transkript yetki sınırı', () => {
  const codeOf = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('🔒 kısmi akış modülü HİÇBİR eylem yolunu import etmez/çağırmaz', () => {
    const code = codeOf(sttPartialStreamSrc);
    for (const forbidden of [
      'processTextCommand', 'dispatchIntent', 'commandExecutor', 'companionChatProvider',
      'navigationService', 'mediaService', 'appLauncher', 'obdService',
      'speakMaviAnswer', 'beginMaviTurn', 'useStore',
    ]) {
      expect(code, `kısmi akış eylem yoluna dokunuyor: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('🔒 semantik endpointer SAF kalır (import · I/O · timer · global durum YOK)', () => {
    const code = codeOf(semanticEndpointerSrc);
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
    expect(code).not.toMatch(/^\s*let\s/m);
  });

  it('🔒 ASKIDA kontrolü FİİL kontrolünden ÖNCE gelir (sözü kesme yasağı)', () => {
    /* Sıra bir stil tercihi DEĞİL güvenlik gereğidir: "beni eve götür ama"
       cümlesinde "götür" bir fiildir; fiil kontrolü önce yapılsaydı cümle
       tamamlanmış sanılır ve kullanıcının sözü KESİLİRDİ. */
    const code = codeOf(semanticEndpointerSrc);
    // Karşılaştırma SINIFLANDIRICI GÖVDESİNDE yapılır — sabitlerin tanım sırası değil.
    const fn = code.slice(code.indexOf('export function classifyCompleteness'));
    expect(fn.length, 'classifyCompleteness bulunamadı — kilit körleşti').toBeGreaterThan(0);
    const dangling = fn.indexOf('DANGLING_TAIL.has(last)');
    const verb = fn.indexOf('VERB_TAIL_PATTERNS');
    expect(dangling, 'askıda kontrolü bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(verb).toBeGreaterThan(dangling);
  });

  it('🔒 semantik eşik AKUSTİK TABANI aşamaz + histerezis en az 2 tik', () => {
    const code = codeOf(semanticEndpointerSrc);
    // Eşikler tek kaynakta ve tutarlılık kontrolü kaynakta MEVCUT olmalı.
    expect(code).toContain('areThresholdsConsistent');
    expect(code).toMatch(/semanticSilenceMs\s*<=\s*t\.acousticSilenceMs/);
    expect(code).toMatch(/minAgreeingTicks\s*>=\s*2/);
  });

  it('🔒 native: kısmi olay yayınlanıyor, finalize komutu konuşma görülmeden uygulanmıyor', () => {
    const java = readFileSync(
      resolve(process.cwd(), 'android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'),
      'utf8',
    );
    expect(java).toContain('notifyListeners("sttPartial"');
    expect(java).toContain('RecognizerIntent.EXTRA_PARTIAL_RESULTS');
    // Boş `onPartialResults` gövdesi GERİ GELMEZ (kısmi sonuç sessizce ölmesin).
    expect(java).not.toContain('onPartialResults(android.os.Bundle partialResults) {}');
    /* FAIL-SAFE: erken bitirme komutu YALNIZ konuşma görüldüyse uygulanır —
       aksi halde yanlış bir karar kullanıcı ağzını açmadan oturumu kapatırdı. */
    const fIdx = java.indexOf('if (voskFinalizeRequested)');
    expect(fIdx, 'finalize kontrolü bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(java.slice(fIdx, fIdx + 400)).toContain('if (vadSpeechSeen)');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT · MAVI-F4 — AKIŞ CEVABI: HAM TOKEN KONUŞULMAZ, YAPISAL ÇIKTI SESLENDİRİLMEZ
 *
 * Streaming'in tehlikesi hız değil YETKİ ve YARIM CÜMLEDİR. Model çıktısı JSON
 * taşır (`{"type":"action","intent":...}`); token'ı doğrudan TTS'e vermek hem
 * kullanıcıya JSON okutur hem de model çıktısını bir YETKİ gibi konuşturur.
 * Aşağıdaki kilitler bu sınırı KAYNAK düzeyinde korur.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT · MAVI-F4 akış cevabı sınırları', () => {
  const codeOf = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('🔒 akış katmanı HİÇBİR eylem yolunu import etmez/çağırmaz', () => {
    for (const [name, src] of [
      ['sequencer', maviSpeechStreamSrc], ['coordinator', maviResponseStreamSrc],
    ] as const) {
      const code = codeOf(src);
      for (const forbidden of [
        'processTextCommand', 'dispatchIntent', 'commandExecutor', 'navigationService',
        'mediaService', 'appLauncher', 'obdService', 'useStore', 'fromSemanticResult',
      ]) {
        expect(code, `${name} eylem yoluna dokunuyor: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('🔒 saf katmanlar SAF kalır (import · I/O · timer · MODÜL durumu YOK)', () => {
    for (const [name, src] of [
      ['extractor', streamSayExtractorSrc], ['chunker', speechChunkerSrc],
    ] as const) {
      const code = codeOf(src);
      expect(code, name).not.toMatch(/\bimport\b/);
      expect(code, name).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
      expect(code, name).not.toMatch(/^let\s/m);
    }
  });

  it('🔒 yapısal çıktı (action/web) akıştan SESLENDİRİLMEZ', () => {
    /* Çıkarıcı `type` görülene kadar SUSAR ve `chat` DEĞİLSE akışı STRUCTURED'a
       çeker — o durumda tek karakter bile yayınlanmaz. Bu kontrol kalkarsa
       kullanıcı `{"type":"action","intent":` diye bir ses duyar. */
    const code = codeOf(streamSayExtractorSrc);
    expect(code).toMatch(/if \(t !== 'chat'\)/);
    expect(code).toContain("state = 'STRUCTURED'");
    expect(code).toMatch(/if \(state === 'STRUCTURED'.*\) return ''/s);
  });

  it('🔒 akış TEK `answer`dır; konuşulmazsa slot BIRAKILIR (sessiz ölüm koruması)', () => {
    const code = codeOf(maviResponseStreamSrc);
    expect(code).toContain('claimMaviAnswerStream');
    expect(code).toContain('releaseMaviAnswerSlot');
    // Sürüşte akış AÇILMAZ (ISO 15008 — cevap zaten 8 kelimeye iniyor).
    expect(code).toMatch(/isDriving\s*===\s*true\)\s*return null/);
  });

  it('🔒 asılma kapılarının ÜRETİMDE ÇAĞIRANI VAR (yazılmış ama ölü güvenlik yasak)', () => {
    /* SAHA KUSURU (2026-08-29 denetimi): `tickSpeechStream` açlık/asılma kapıları
       yazılmış ve test edilmişti ama ÜRETİMDE HİÇ ÇAĞRILMIYORDU. Sağlayıcı ya da
       native TTS yarıda ölünce akış sonsuza kadar açık kalıyor, konuşma oturumu
       kapanmıyor ve tek-`answer` slotu bırakılmıyordu → Mavi oturumun kalanında
       TÜMÜYLE susuyordu. Kapı bir timer'la ilerletilmezse yoktur. */
    const code = codeOf(voiceServiceSrc);
    expect(code, 'akış bekçisi kaldırılmış — asılma kapıları ölü').toContain('tickSpeechStream');
    expect(code).toContain('_armStreamWatchdog');
    // SIFIR SIZINTI: bekçi akışın HER terminal yolundan sökülmeli.
    expect(code).toContain('onClosed: _disarmStreamWatchdog');
    expect(code).toMatch(/clearInterval\(_streamWatchdog\)/);
    // Kancanın karşılığı koordinatörde GERÇEKTEN ateşlenmeli.
    const coord = codeOf(maviResponseStreamSrc);
    expect((coord.match(/_fireClosed\(\)/g) ?? []).length,
      'kapanış kancası her terminal yoldan ateşlenmiyor').toBeGreaterThanOrEqual(3);
  });

  it('🔒 PARÇA bitişi ile CEVAP bitişi AYRI kanaldır; barge-in oturumu sıfırlar', () => {
    const code = codeOf(ttsServiceSrc);
    expect(code).toContain('registerTtsChunkEndListener');
    expect(code).toContain('_speechSessionDepth');
    /* Kanallar birleşirse Mavi ilk parçadan sonra "cevap bitti" sayıp mikrofonu
       açar ve KENDİ cevabının kalanını keser. */
    const cancelIdx = code.indexOf('export function ttsCancel');
    expect(cancelIdx, 'ttsCancel bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(code.slice(cancelIdx, cancelIdx + 400)).toContain('_speechSessionDepth = 0');
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT · MAVI-F5 — CAPABILITY FABRIC SINIRLARI
 *
 * F5 Mavi'yi CarOS'un gerçek yetenek kataloğuna bağlar. En büyük risk
 * "ikinci bir gerçeklik/otorite kaynağı" doğmasıdır: fabric yürütmeye ya da
 * güvenlik kararı vermeye başlarsa kanonik zincir (`maviActionAuthority` →
 * `AiSafetyGate` → onay → `dispatchIntent`) sessizce BYPASS edilir.
 * Aşağıdaki kilitler o sınırı KAYNAK düzeyinde korur.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT · MAVI-F5 capability fabric sınırları', () => {
  const codeOf = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('🔒 fabric HİÇBİR ŞEY YÜRÜTMEZ (ikinci yürütücü yasağı)', () => {
    const code = codeOf(capabilityFabricSrc);
    for (const forbidden of [
      'dispatchIntent', 'executeIntent', 'executeAIResult', 'routeIntent',
      'navigationService', 'mediaService', 'appLauncher', 'obdService',
      'speakMaviAnswer', 'useStore',
    ]) {
      expect(code, `fabric yürütme yoluna dokunuyor: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('🔒 fabric KANONİK GÜVENLİK KARARINI kopyalamaz', () => {
    /* Kapı kendi hareket/güvenlik/onay kararını üretmeye başlarsa iki karar
       kaynağı doğar ve hangisinin kazandığı çağrı sırasına kalır. */
    const code = codeOf(capabilityFabricSrc);
    for (const forbidden of [
      'evaluateVehicleAction', 'evaluateActionIdSafety', 'createAiSafetyGate',
      'assistantSafetyKernel', 'MOTION_STOPPED_MAX_KMH',
    ]) {
      expect(code, `fabric kanonik güvenliği KOPYALIYOR: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('🔒 saf katmanlar SAF kalır (import · I/O · timer · MODÜL durumu YOK)', () => {
    for (const [name, src] of [
      ['contract', capabilityContractSrc], ['catalog', carosCapabilityCatalogSrc],
      ['resolver', capabilityResolverSrc],
    ] as const) {
      const code = codeOf(src);
      expect(code, name).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
      expect(code, name).not.toMatch(/^let\s/m);
    }
    // Sözleşme katmanı HİÇBİR modül import etmez.
    expect(codeOf(capabilityContractSrc)).not.toMatch(/\bimport\b/);
  });

  it('🔒 availability politikası: yalnız KANITLI OLUMSUZ yolu kapatır', () => {
    /* `UNKNOWN` kapatır hâle gelirse (fail-closed) registry kanıt toplamamış
       her cihazda ÇALIŞAN komutlar sessizce ölürdü — gerçek regresyon. */
    const code = codeOf(capabilityFabricSrc);
    expect(code).toContain("'unavailable', 'unsupported', 'restricted'");
    expect(code).toMatch(/return allAvailable \? 'AVAILABLE' : 'UNKNOWN'/);
  });

  it('🔒 kapı VARSAYILAN GÖLGE: enforce kapalıyken hiçbir eylem engellenmez', () => {
    const code = codeOf(capabilityFabricSrc);
    expect(code).toMatch(/allow: enforced \? !wouldBlock : true/);
    expect(code).toContain('mavi.capabilityFabric.enforce');
  });

  it('🔒 prompt intent listesi ELLE YAZILMAZ — katalogdan türetilir', () => {
    /* Üç ayrı sabit liste (29/29/26) birbirinden kaymıştı: beyin geçerli komut
       üretiyor, doğrulayıcı onu SESSİZCE düşürüyordu. Tek kaynak katalogdur. */
    const code = codeOf(companionChatProviderSrc);
    const i = code.indexOf('const BRAIN_INTENTS');
    expect(i, 'BRAIN_INTENTS bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    expect(code.slice(i, i + 260)).toContain('brainIntentAllowlist()');
  });

  it('🔒 gözlem kaydı yürütmeyi ETKİLEMEZ ve dürüstlük tavanı uygulanır', () => {
    const exec = codeOf(commandExecutorSrc);
    const i = exec.indexOf('function _recordCapabilityOutcome');
    expect(i, 'gözlem kaydı kaldırılmış').toBeGreaterThan(-1);
    /* KİLİT GÜÇLENDİRİLDİ (MAVI-F7): sabit 700 karakterlik pencere KÖR bir
       kilitti — gövde büyüyünce `catch` pencereden çıkıyor ve kilit hiçbir
       şeyi korumuyordu. Artık fonksiyonun TAMAMI taranır. */
    const end = exec.indexOf(String.fromCharCode(10) + '}', i);
    expect(end, 'fonksiyon sonu bulunamadı — kilit körleşti').toBeGreaterThan(i);
    const body = exec.slice(i, end + 2);
    expect(body, 'gözlem kaydı fail-soft değil').toContain('} catch {');
    /* Tavan uygulaması kalkarsa sistem doğrulayamadığı bir şey için
       "yaptım" demeye başlar. */
    const fab = codeOf(capabilityFabricSrc);
    expect(fab).toMatch(/ceiling === 'ACCEPTED' \? 'ACCEPTED' : 'EXECUTED'/);
  });

  it('🔒 kanonik eylem kapısı hâlâ YÜRÜTÜCÜDEN ÖNCE çalışır', () => {
    /* F5 giriş kapısı ekledi; kanonik kapının SIRASI değişmemeli. */
    expect(commandExecutorSrc.indexOf('evaluateVehicleAction'))
      .toBeLessThan(commandExecutorSrc.indexOf('switch (intent.type)'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT · P0-VDK-B3 — POLL MALİYETİ EKSİKSİZ VE DÜRÜST ÖLÇÜLÜR
 *
 * SAHA (2026-08-30 · gerçek araç · CAROS LAB TAM KOPYA 1788096650111):
 * `attempted:117 · success:117 · noData:0` "hat kusursuz" diyordu; AYNI oturumun
 * ham trafiğinde onlarca `NO DATA`, `7F1912` ve istek başına dört AT komutu
 * (`ATSH7DF·ATAR·ATSH7E0·ATCRA7E8`) vardı. Sebep: o sayaçlar YALNIZ extended PID
 * denemelerini görüyordu — FAST/SLOW grubu, `ATRV`, tüm AT yönetimi ve tarama
 * trafiği HİÇBİR sayaçta yoktu. Ürün kendi hat maliyetini ölçmüyordu.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT · P0-VDK-B3 — poll maliyeti (PID + AT overhead)', () => {

  it('🔒 B3 · kullanıcı VERİSİ ile ADAPTÖR YÖNETİMİ tek sayıya indirgenmez', async () => {
    const { normalizeCycleCost } = await import('../platform/obd/pollCost');
    const c = normalizeCycleCost({
      cycleId: 1, sessionEpoch: 1, burst: false,
      diagnosticPayloadRequests: 10, adapterControlCommands: 4,
      headerSwitches: 4, voltageReads: 0, protocolChecks: 0, redundantHeaderSwitches: 0,
      noResponses: 0, negativeResponses: 0, noResponseMs: 0,
      payloadMs: 4000, adapterMs: 164, elapsedMs: 4200,
      bytesTx: 50, bytesRx: 90, retries: null, provenance: 'NATIVE_MEASURED',
    })!;
    expect(c.diagnosticPayloadRequests).toBe(10);
    expect(c.adapterControlCommands).toBe(4);
    /* Sözleşmede birleşik "toplam istek" alanı OLMAMALI — ayrım YAPISALDIR. */
    expect(Object.keys(c)).not.toContain('totalRequests');
    expect(Object.keys(c)).not.toContain('requests');
  });

  it('🔒 B3 · KAYNAK YOK ≠ 0 — ölçüm yoksa sahte sıfır ÜRETİLMEZ', async () => {
    const { normalizePollCost, EMPTY_POLL_COST } = await import('../platform/obd/pollCost');
    const s = normalizePollCost(null, 1);
    expect(s.state).toBe('UNAVAILABLE');
    expect(s.totals.diagnosticPayloadRequests).toBeNull();
    expect(s.totals.adapterControlCommands).toBeNull();
    expect(s.totals.noResponses).toBeNull();
    expect(s.cyclesRecorded).toBeNull();
    expect(EMPTY_POLL_COST.lastCycle).toBeNull();
  });

  it('🔒 B3 · cevapsız ve NEGATİF yanıt maliyeti AYRI ve 0 SAYILMAZ', async () => {
    const { normalizeCycleCost } = await import('../platform/obd/pollCost');
    const c = normalizeCycleCost({
      cycleId: 1, sessionEpoch: 1, burst: false,
      diagnosticPayloadRequests: 9, adapterControlCommands: 0,
      headerSwitches: 0, voltageReads: 0, protocolChecks: 0, redundantHeaderSwitches: 0,
      noResponses: 6, negativeResponses: 3, noResponseMs: 3900,
      payloadMs: 4000, adapterMs: 0, elapsedMs: 4200,
      bytesTx: 50, bytesRx: 60, retries: null, provenance: 'NATIVE_MEASURED',
    })!;
    expect(c.noResponses).toBe(6);
    expect(c.negativeResponses).toBe(3);
    expect(c.noResponseMs).toBe(3900);
  });

  it('🔒 B3 · retry ölçülmüyorsa null KALIR (0 yazılmaz)', async () => {
    const { normalizeCycleCost } = await import('../platform/obd/pollCost');
    const base = {
      cycleId: 1, sessionEpoch: 1, burst: false,
      diagnosticPayloadRequests: 1, adapterControlCommands: 0,
      headerSwitches: 0, voltageReads: 0, protocolChecks: 0, redundantHeaderSwitches: 0,
      noResponses: 0, negativeResponses: 0, noResponseMs: 0,
      payloadMs: 100, adapterMs: 0, elapsedMs: 120,
      bytesTx: 5, bytesRx: 8, provenance: 'NATIVE_MEASURED',
    };
    expect(normalizeCycleCost({ ...base, retries: null })!.retries).toBeNull();
  });

  it('🔒 B3 · LAB maliyet okuması SALT-OKUNURDUR — yalnız sayaç metodu çağrılır', () => {
    const s = read('src/platform/obd/pollCost.ts');
    /* Bu modül yalnız `getObdPollCost` (salt sayaç) çağırabilir. Komut gönderen
       hiçbir native metot BURADAN çağrılamaz — LAB ikinci otorite olamaz. */
    expect(s).toContain('getObdPollCost');
    for (const forbidden of [
      'sendObdCommand', 'sendRawCommand', 'startObd', 'connectObd',
      'setObdDiagnosticBurst', 'clearDtc', 'requestDtc', 'runDeepScan',
    ]) {
      expect(s, `pollCost.ts komut tetikliyor: ${forbidden}`).not.toContain(forbidden);
    }
    /* Yeni timer/scheduler kurulmadığı da kilitlenir. */
    expect(s).not.toContain('setInterval');
    expect(s).not.toContain('setTimeout');
  });

  it('🔒 B3 · maliyet muhasebesi teşhis YAKALAMASINDAN bağımsız çalışır', () => {
    /* `emitTraffic` yalnız capture açıkken çalışır. Muhasebe ona BAĞLANIRSA ölçüm
       ancak biri LAB'ı açtığında var olur → saha kanıtı kaybolur. */
    const om = read('android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java');
    expect(om).toContain('PollCostLedger.INSTANCE.noteCommand');
    const idx = om.indexOf('PollCostLedger.INSTANCE.noteCommand');
    const before = om.slice(Math.max(0, idx - 400), idx);
    expect(before, 'muhasebe capture bayrağına koşullanmış').not.toMatch(/if\s*\(\s*sTrafficCapture\s*\)[^}]*$/);
  });

  it('🔒 B3 · poll kadans sabitleri DEĞİŞMEDİ (voltaj/slow grup regresyonsuz)', () => {
    const om = read('android/app/src/main/java/com/cockpitos/pro/obd/OBDManager.java');
    expect(om, 'SLOW grup kadansı değişti').toMatch(/SLOW_GROUP_EVERY_N_CYCLES\s*=\s*5\b/);
    expect(om, 'ATRV kadansı değişti').toMatch(/VOLTAGE_EVERY_N_CYCLES\s*=\s*10\b/);
    expect(om, 'çok yavaş grup kadansı değişti').toMatch(/VERY_SLOW_EVERY_N_CYCLES\s*=\s*20\b/);
  });

  it('🔒 B3 · fail-safe header restore sözleşmesi KALDIRILMADI', () => {
    /* AT overhead'in kaynağı budur ama SAHİBİ vardır: restore, sonraki 7DF
       fonksiyonel poll isteğini garanti eder ve kuyruk araya poll sokabilir.
       Maliyet yalnız ÖLÇÜLÜR; komut kör şekilde ATLANMAZ. */
    const elm = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
    expect(elm).toContain('restoreDefaultHeader');
    expect(elm).toContain('ATSH7DF');
    expect(elm).toContain('ATAR');
  });

  it('🔒 B3 · anti-starvation yaşlanması TAVANLI ve deterministik', () => {
    const sched = read('android/app/src/main/java/com/cockpitos/pro/obd/AdaptivePidScheduler.java');
    expect(sched).toMatch(/STARVATION_AGING_MS_PER_DEFER\s*=\s*500/);
    expect(sched).toMatch(/STARVATION_AGING_CAP_MS\s*=\s*300_000/);
    /* Kadans penceresi ERTELEME sayılmamalı — açlık sinyali kirlenmesin. */
    expect(sched).toContain('notYetDueCount');
    /* Olasılık/AI yok: sıralama tam sayı aritmetiğiyle. */
    expect(sched).not.toContain('Math.random');
  });

  it('🔒 B3 · ikinci scheduler/bütçe motoru KURULMADI', () => {
    const ledger = read('android/app/src/main/java/com/cockpitos/pro/obd/PollCostLedger.java');
    /* Muhasebe defteri komut göndermez, PID seçmez, iş planlamaz, kendi ipliğini
       kurmaz.
       ⚠️ Tarama KOD GÖVDESİNDE yapılır: sınıfın kendi sözleşme yorumları
       `ElmCommandChannel.send()` ve `AdaptivePidScheduler` adlarını AÇIKLAMAK için
       anmak ZORUNDADIR. Ham metin taraması bu yüzden yanlış-pozitif üretir ve
       kilidi anlamsızlaştırırdı. */
    const ledgerCode = ledger
      .replace(/\/\*[\s\S]*?\*\//g, '')   // blok + javadoc yorumları
      .replace(/\/\/.*$/gm, '');            // satır yorumları
    expect(ledgerCode, 'yorum temizleyici tüm dosyayı sildi — kilit kör kaldı')
      .toContain('noteCommand');
    for (const forbidden of [
      'channel.send', '.send(', 'ElmCommandQueue', 'AdaptivePidScheduler',
      'new Thread', 'Executors.', 'ScheduledExecutor', 'new Timer',
    ]) {
      expect(ledgerCode, `PollCostLedger scheduler'a dönüşmüş: ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🔒 KİLİT · P0-VDK-B7 — SESSİZ ADRES SONSUZA KADAR SORGULANMAZ
 *
 * SAHA (2026-08-30 · gerçek araç): ana ekranda DTC ekranı KAPALIYKEN
 * `readAdvancedDtcs` 10 dk'da 712 çağrı · `probeEcus` 102 · 7E1–7E7'ye giden
 * `1902FF`'in TAMAMI NO DATA · bilgi üretmeyen süre 335 270 ms (hattın %83'ü).
 * İki kök neden vardı ve İKİSİ de burada kilitlenir:
 *   (1) `planPhysicalProbes` sessizliği ÖĞRENMİYORDU,
 *   (2) `earlyIdentityRuntime` idempotens kapısını pahalı keşiften SONRA soruyordu.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 KİLİT · P0-VDK-B7 — sessiz adres eleme merdiveni', () => {

  it('🔒 B7 · doğrulanmış sessizlik sonsuz döngü ÜRETMEZ', async () => {
    const m = await import('../platform/obd/physicalEcuProbe');
    m._resetPhysicalProbesForTest();
    const known = [{
      rxHeader: '7E8', txHeader: '7E0', addressBits: 11, role: 'engine',
      roleEvidence: 'standard', label: 'ECU 7E0', discoverySource: 'functional_0100',
      probeOutcome: 'responded', kwpTargetVerified: false, txProvenance: 'can_11bit_standard',
    }] as never;

    let now = 1_000_000;
    let requests = 0;
    for (let round = 0; round < 30; round++) {
      const { targets } = m.planPhysicalProbes(known, m.MAX_PHYSICAL_PROBES, { nowMs: now });
      requests += targets.length;
      for (const tx of targets) m.noteProbeOutcome(tx, 'no_response', null, 1, '6', now, 450);
      now += 1_000;
    }
    /* Eski davranış 30 × 7 = 210 istek üretirdi. */
    expect(requests, 'sessiz adresler hâlâ sonsuza kadar sorgulanıyor').toBeLessThan(210 / 2);
    m._resetPhysicalProbesForTest();
  });

  it('🔒 B7 · TEK sessizlik eleme YAPMAZ, hat hatası ASLA eleme yapmaz', async () => {
    const m = await import('../platform/obd/physicalEcuProbe');
    m._resetPhysicalProbesForTest();
    const known = [] as never;

    /* Tek NO DATA → hâlâ aday. */
    m.noteProbeOutcome('7E1', 'no_response', null, 1, '6', 1_000, 450);
    expect(m.planPhysicalProbes(known, m.MAX_PHYSICAL_PROBES, { nowMs: 1_100 }).targets)
      .toContain('7E1');

    /* Adaptör koptu: 20 hat hatası → yine de eleme YOK (körleşme yasağı). */
    for (let i = 0; i < 20; i++) {
      m.noteProbeOutcome('7E2', 'transport_error', null, 1, '6', 2_000 + i, 5);
    }
    expect(m.planPhysicalProbes(known, m.MAX_PHYSICAL_PROBES, { nowMs: 5_000 }).targets)
      .toContain('7E2');
    m._resetPhysicalProbesForTest();
  });

  it('🔒 B7 · NRC (0x11/0x12/0x31) ECU VARLIĞIDIR — bastırma üretmez', async () => {
    const m = await import('../platform/obd/physicalEcuProbe');
    for (const nrc of [0x11, 0x12, 0x31]) {
      expect(m.classifyProbeLearning('negative_nrc', nrc)).toBe('RESPONDED');
    }
    expect(m.classifyProbeLearning('no_response', null)).toBe('SILENT');
    expect(m.classifyProbeLearning('transport_error', null)).toBe('INCONCLUSIVE');
  });

  it('🔒 B7 · bastırma ZAMAN AŞIMLI — terminal kara liste YOK', async () => {
    const m = await import('../platform/obd/physicalEcuProbe');
    /* Merdivenin son basamağı bile sonludur. */
    expect(m.PROBE_BACKOFF_LADDER_MS.length).toBeGreaterThan(0);
    for (const ms of m.PROBE_BACKOFF_LADDER_MS) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
    /* Kaynakta "kalıcı/sonsuz bastırma" kavramı OLMAMALI. */
    const src = read('src/platform/obd/physicalEcuProbe.ts');
    expect(src).not.toContain('permanentlySuppress');
    expect(src).not.toContain('blacklist');
  });

  it('🔒 B7 · kullanıcı aktif taraması merdiveni ATLAR', () => {
    /* `runFullVehicleScan` kullanıcı eylemidir → keşfe `userInitiated` geçmeli. */
    const src = read('src/platform/obd/multiEcuScan.ts');
    expect(src, 'kullanıcı taraması bastırılmış adresleri yeniden ölçemiyor')
      .toContain('discoverEcus({ userInitiated: true })');
  });

  it('🔒 B7 · erken kimlik izleyicisi keşfi idempotens kapısından ÖNCE yapmaz', () => {
    const src = read('src/platform/obd/identity/earlyIdentityRuntime.ts');
    const gate = src.indexOf('isEarlyIdentityEvaluatedForEpoch');
    const discover = src.indexOf('await discoverEcus(');
    expect(gate, 'idempotens kapısı yok — saha kusuru geri gelir').toBeGreaterThan(0);
    expect(discover).toBeGreaterThan(0);
    expect(gate, 'kapı pahalı keşiften SONRA soruluyor (asıl saha kusuru)')
      .toBeLessThan(discover);
  });

  /* ── F2 · yerel müzik kimliği ──────────────────────────────────────────
   * ÖLÇÜLMÜŞ KUSUR (2026-09-01, bu turda yakalandı): kütüphane kimliği
   * `media:<id>` → `media:<volume>:<id>` olarak genişletilince, listedeki
   * parçaya basmayı çalma kuyruğuna bağlayan eşleme düz bir önek kırpması
   * yapıyordu (`replace(/^media:/, '')`). Yeni kimlikte bu `external_primary:1`
   * üretir, kuyrukta karşılığı YOKTUR ve parçaya basınca SESSİZCE hiçbir şey
   * olmaz. Kimlik biçimi bir daha değişirse bu kilit düşsün. */
  it('🔒 F2 · liste → kuyruk eşlemesi kimliği AYRIŞTIRIR, önek KIRPMAZ', async () => {
    const src = read('src/components/media/LocalMusicBrowser.tsx');
    expect(src, 'düz önek kırpması çok-volume kimliğinde sessizce düşer')
      .not.toContain("replace(/^media:/");
    expect(src, 'F3 seçimi canonical MusicIndex kimliğiyle gateway yoluna girmeli')
      .toContain('startLibraryListening');
    expect(src, 'UI eski local player adaptörünü doğrudan çağırmamalı')
      .not.toContain('playLocalSelection(');

    /* Davranış tarafı: kanonik kimlikten geri alınan ham MediaStore id,
       kuyruğun taşıdığı id ile AYNI olmalı. */
    const { mediaTrackId, parseMediaTrackId } = await import('../platform/media/mediaIdentity');
    expect(parseMediaTrackId(mediaTrackId('sdcard', '1234'))?.mediaStoreId).toBe('1234');
    expect(parseMediaTrackId(mediaTrackId('external_primary', '7'))?.mediaStoreId).toBe('7');
  });

  /* Tarama kararı ile MediaStore sorgusu arasındaki tek bağ executor'dır.
   * `localMusicService` bir kez daha doğrudan sorgu açarsa UNCHANGED turunda
   * sıfır-sorgu iddiası sessizce YALAN olur. */
  it('🔒 F2 · MediaStore taramasının TEK yürütücüsü executor', () => {
    const service = read('src/platform/localMusicService.ts');
    expect(service, 'servis MediaStore\'u yeniden kendisi sorguluyor')
      .not.toContain('CarLauncher.getMusicTracks(');
    expect(service).toContain('refreshMusicLibrary');

    const executor = read('src/platform/media/mediaStoreRefreshExecutor.ts');
    expect(executor, 'UNCHANGED kararı parça sorgusuna düşerse kilit anlamsızlaşır')
      .toContain("if (decision === 'UNCHANGED')");
  });

  /* Kapak yolu: UI native köprüyü ÇAĞIRMAZ ve ana yol base64 DEĞİLDİR. */
  it('🔒 F2 · kapak yalnız ArtworkCache üzerinden, UI native decode ÇAĞIRMAZ', () => {
    const browser = read('src/components/media/LocalMusicBrowser.tsx');
    expect(browser).not.toContain('getMediaArtDataUri');
    expect(browser).not.toContain('resolveArtworkFile');
    expect(browser).toContain('resolveArtwork(');

    const cache = read('src/platform/media/artworkCache.ts');
    expect(cache, 'ana yol native dosya katmanını kullanmalı').toContain('resolveArtworkFile');
    expect(cache, 'yerel dosya URL taşıması kaldırılmış').toContain('convertFileSrc');
  });
  /* ── F6 · SES DENEYİMİ / DSP ───────────────────────────────────────────
   *
   * ÖLÇÜLEN KUSUR (F6 öncesi): "Crystal Cabin DSP" yüzeyi Web Audio zincirine
   * (audioService) bağlıydı; kanonik oynatma ise native ExoPlayer'dı ve o
   * zincire üretimde HİÇBİR kaynak `connectSource` ile bağlanmıyordu. Yani
   * EQ · AGC · Sürücü Odaklı Ses · Hıza Bağlı Ses anahtarları duyulur hiçbir
   * şeyi değiştirmiyordu — kullanıcıya karşılıksız bir yetenek gösteriliyordu.
   *
   * Bu kilit, o yüzeyin geri gelmesini ve ikinci bir ses/kazanç otoritesinin
   * doğmasını engeller. */
  it('🔒 F6 · ürün ses yüzeyi Web Audio DSP\'sine DEĞİL, DSP otoritesine bağlanır', () => {
    const settings = read('src/components/settings/SettingsPage.tsx');
    /* Kör guard koruması: dosya gerçekten okunmuş olmalı. */
    expect(settings.length, 'ayarlar dosyası okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1000);

    expect(settings, 'karşılığı olmayan DSP paneli geri gelmiş')
      .not.toContain('Crystal Cabin DSP');
    expect(settings, 'Web Audio AGC anahtarı ürün yüzeyine geri gelmiş')
      .not.toContain('setAGCEnabled');
    expect(settings, 'Web Audio Haas/pan anahtarı ürün yüzeyine geri gelmiş')
      .not.toContain('setDriverFocus');
    expect(settings, 'karşılıksız SVC anahtarı ürün yüzeyine geri gelmiş')
      .not.toContain('setSvcEnabled');
    expect(settings, 'ses sekmesi tek DSP otoritesinin projeksiyonu olmalı')
      .toContain('AudioExperiencePanel');
  });

  /* DSP otoritesi SES RENGİNİN sahibidir; kullanıcı sesinin, ducking'in ve
   * oynatmanın sahibi DEĞİLDİR. İkinci bir yazar doğarsa "sesi kıstım, kendi
   * kendine açıldı" sınıfı hatalar geri gelir (volumePolicy'nin doğuş sebebi). */
  it('🔒 F6 · DSP otoritesi ses/duck/oynatma otoritelerine YAZMAZ', () => {
    const file = read('src/platform/media/audio/audioExperienceAuthority.ts');
    expect(file.length, 'DSP otoritesi okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1000);

    /* YALNIZ import grafı taranır: dosyanın yorum bloğu bu otoriteleri zaten
       "sahibi DEĞİLİM" demek için ANIYOR. Kör guard olmaması için import
       kümesinin boş olmadığı ayrıca doğrulanır. */
    const authority = (file.match(/^import[\s\S]*?from '[^']+';/gm) ?? []).join(' ');
    expect(authority.length, 'import grafı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(0);

    expect(authority, 'DSP katmanı oynatma komut kapısına bağlanmış')
      .not.toContain('mediaCommandGateway');
    expect(authority, 'DSP katmanı ikinci bir ses hesabı kurmuş')
      .not.toContain('volumePolicy');
    expect(authority, 'DSP katmanı ikinci bir duck yazarı olmuş')
      .not.toContain('duckPolicy');
    expect(authority, 'DSP katmanı kaynak devrine karışmış')
      .not.toContain('sourceCoordinator');
    /* Native yüzeyi yalnız audioDsp* olmalı: mediaAuthorityCommand ile oynatma
       komutu göndermek bu katmanın yetkisi DEĞİLDİR. */
    expect(authority, 'DSP katmanı native oynatma köprüsüne bağlanmış')
      .not.toContain('nativeAuthorityBridge');
    expect(file, 'DSP katmanı oynatma komutu gönderiyor')
      .not.toContain('mediaAuthorityCommand');
    expect(file, 'DSP yazımı kendi native yüzeyinden gitmeli')
      .toContain('audioDspApply');
  });

  /* Güvenlik payı (headroom) AYRI ve SINIRLI bir kazançtır. Kullanıcı sesine
   * yazılırsa kullanıcı "sesimi kim kıstı" der ve geri açtığında clipping
   * korumasını kaldırmış olur. */
  it('🔒 F6 · clipping güvenlik payı sınırlı ve kullanıcı sesinden AYRI', async () => {
    const {
      computeSafetyPreampDb, dbToLinear, MAX_HEADROOM_DB, UNPROBED_CAPABILITIES,
    } = await import('../platform/media/audio/audioExperienceModel');

    const caps = {
      ...UNPROBED_CAPABILITIES,
      probed: true, supportsEqualizer: true, eqBandCount: 5,
      eqBandFrequenciesHz: [60, 230, 910, 3600, 14000],
      eqMinGainDb: -15, eqMaxGainDb: 15,
      supportsLoudness: true, loudnessMaxDb: 6, supportsBalance: true,
    };
    const cfg = (bands: number[], loudnessDb = 0) => ({
      enabled: true, presetId: 'custom' as const, bandGainsDb: bands, loudnessDb, balance: 0,
    });

    expect(computeSafetyPreampDb(cfg([0, 0, 0, 0, 0]), caps)).toBe(0);
    expect(computeSafetyPreampDb(cfg([6, 0, 0, 0, 0]), caps)).toBeLessThan(0);
    /* Sınırsız olsaydı agresif EQ sesi duyulmaz hâle getirirdi. */
    expect(computeSafetyPreampDb(cfg([9, 9, 9, 9, 9], 6), caps)).toBe(-MAX_HEADROOM_DB);
    expect(dbToLinear(-MAX_HEADROOM_DB)).toBeGreaterThan(0.2);
  });

  /* ── F6.1 · ÖLÜ SES YOLU TEMİZLİĞİ / TEK DUCK OTORİTESİ ────────────────
   *
   * ÖLÇÜLEN KUSUR: TTS · Mavi · klip · dinleme yolları
   * `audioService.duckMedia()` çağırıyordu. O fonksiyon bir Web Audio
   * `masterGain` düğümünü kısıyordu; üretimde o zincire hiçbir kaynak
   * bağlanmadığı için çağrı DUYULUR HİÇBİR ŞEY YAPMIYORDU → CarOS
   * konuşurken müzik gerçekte kısılmıyordu. Kanonik duck otoritesi
   * `duckPolicy` + `mediaCommandGateway` + `CarosAudioFocusManager`dır.
   *
   * Bu kilitler ölü yolun ve ikinci bir duck/gain otoritesinin geri
   * gelmesini engeller. */
  it('🔒 F6.1 · ölü Web Audio ses servisi ve duckMedia yolu geri gelmedi', () => {
    expect(
      existsSync(resolve(root, 'src/platform/audioService.ts')),
      'ölü Web Audio DSP servisi (audioService.ts) geri gelmiş — ikinci gain/duck otoritesi',
    ).toBe(false);

    /* Üretim kaynağının tamamı taranır; boş küme = kör guard → ayrıca sayılır. */
    const scanned: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(rel); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        scanned.push(rel);
      }
    };
    walk('src');
    expect(scanned.length, 'kaynak taraması boş küme — kilit hiçbir şeyi korumuyor')
      .toBeGreaterThan(200);

    /* Yorumlar SOYULUR: bu turun yorumları ölü yolu tarihsel olarak ANIYOR;
       kilit KODU korur, açıklamayı değil. */
    const stripF61 = (t: string): string =>
      t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    for (const rel of scanned) {
      const src = stripF61(read(rel));
      expect(src, `${rel}: ölü audioService yeniden import edilmiş`)
        .not.toMatch(/from '[^']*\/audioService'/);
      expect(src, `${rel}: ölü Web Audio duck yolu (duckMedia) geri gelmiş`)
        .not.toMatch(/\b(un)?duckMedia\s*\(/);
    }
  });

  it("🔒 F6.1 · ses/asistan hattı duck'ı KANONİK adaptörden ister", () => {
    const callers = [
      'src/platform/ttsService.ts',
      'src/platform/voiceService.ts',
      'src/platform/voiceClips.ts',
      'src/platform/edgeTtsService.ts',
      'src/platform/onlineTtsService.ts',
    ];
    for (const rel of callers) {
      const src = read(rel);
      expect(src.length, `${rel} okunamadı — kilit boş kümeye düştü`).toBeGreaterThan(500);
      expect(src, `${rel}: kanonik duck isteği kaldırılmış`)
        .toMatch(/from '[^']*media\/authority\/duckRequest'/);
      /* İkinci seviye hesabı: duck çarpanı/seviyesi YALNIZ duckPolicy'nindir. */
      expect(src, `${rel}: kendi duck seviyesini hesaplamış (ikinci otorite)`)
        .not.toContain('DUCK_LEVEL');
      expect(src, `${rel}: duck'ı sistem sesine yazarak uygulamış`)
        .not.toContain('CarLauncher.setVolume');
    }
  });

  it('🔒 F6.1 · duckRequest bir ADAPTÖRdür — ikinci duck otoritesi DEĞİL', () => {
    const src = read('src/platform/media/authority/duckRequest.ts');
    expect(src.length, 'duckRequest okunamadı — kilit boş kümeye düştü').toBeGreaterThan(500);

    /* Kanonik kapıyı çağırmalı. */
    expect(src, 'kanonik komut kapısı kullanılmıyor').toContain('mediaCommandGateway');
    /* Kendi seviye/öncelik/duck-durumu hesabını KURMAMALI. */
    expect(src, 'adaptör kendi duck seviyesini hesaplamış').not.toContain('DUCK_LEVELS');
    expect(src, 'adaptör kendi duck durumunu tutmuş').not.toContain('effectiveDuckLevel');
    expect(src, 'adaptör duck kayıt listesini kendisi tutmuş').not.toContain('applyDuck');
    expect(src, 'adaptör native köprüye doğrudan inmiş').not.toContain('nativeAuthorityBridge');
    expect(src, 'adaptör sistem sesine yazmış').not.toContain('setVolume');
  });

  /* ── F7.1 · YOUTUBE KANONİK OYNATMA / TRANSPORT ────────────────────────
   *
   * ÖLÇÜLEN KUSUR: YouTube tek çalma kapısının DIŞINDAYDI —
   * `carosMediaLayer._playTrack` doğrudan `playYouTube()` çağırıyor,
   * `playYouTube` de diğer backend'leri "ateşle-unut" durduruyordu (ikinci
   * devir yürütücüsü, doğrulama YOK). Transport ise `mediaService`ten
   * doğrudan IFrame'e gidiyordu (ikinci transport otoritesi).
   *
   * Kilit, o ikinci yolların geri gelmesini engeller. */
  /* Yorum soyucu — tarihsel anlatım kilidi düşürmesin. */
  const stripF71 = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('🔒 F7.1 · YouTube çalmayı KAPI başlatır, medya katmanı doğrudan çağırmaz', () => {
    const layer = stripF71(read('src/platform/media/carosMediaLayer.ts'));
    expect(layer.length, 'medya katmanı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    expect(layer, 'doğrudan IFrame başlatma geri gelmiş (ikinci çalma yolu)')
      .not.toMatch(/\bplayYouTube\s*\(/);
    expect(layer, 'kanonik kapı kullanılmıyor').toContain('mediaCommandGateway');
    expect(layer, "kanonik kaynak sınıfı kaybolmuş").toContain("source: 'YOUTUBE'");
  });

  it('🔒 F7.1 · youtubeService ikinci kaynak devri YÜRÜTMEZ', () => {
    const yt = stripF71(read('src/platform/youtubeService.ts'));
    expect(yt.length, 'youtubeService okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    expect(yt, 'IFrame katmanı yerel müziği kendi başına durduruyor')
      .not.toContain('stopLocalMusic');
    expect(yt, 'IFrame katmanı akışı kendi başına durduruyor')
      .not.toContain('streamStop');
    /* Kapının sürebilmesi için transport yüzeyi DURMALI. */
    expect(yt, 'kanonik transport yüzeyi kaldırılmış').toContain('youtubeResume');
    expect(yt, 'kanonik transport yüzeyi kaldırılmış').toContain('youtubePause');
    expect(yt, 'gözlenen durum yüzeyi kaldırılmış').toContain('getYouTubePlaybackState');
  });

  it('🔒 F7.1 · kapı transportu backend SAHİBİNE dağıtır, native yolu ezmez', () => {
    const gw = stripF71(read('src/platform/media/authority/mediaCommandGateway.ts'));
    expect(gw.length, 'kapı okunamadı — kilit boş kümeye düştü').toBeGreaterThan(4000);
    expect(gw, "backend dağıtımı kaldırılmış (transport yine native'e sabitlenmiş)")
      .toContain('backendTransport');
    expect(gw, 'native/native-olmayan ayrımı kaldırılmış').toContain('isNativeBackend');

    const co = stripF71(read('src/platform/media/authority/sourceCoordinator.ts'));
    expect(co, 'adaptör erişimi kaldırılmış').toContain('getAdapter');
    expect(co, 'transport sözleşmesi kaldırılmış').toContain('BackendTransport');
  });

  /* ── F7.2 · SÜRÜŞTE VİDEO KAPISI ───────────────────────────────────────
   *
   * ÖLÇÜLEN KUSUR: `videoModeStore` koşulsuzdu ve `MediaScreen` YouTube video
   * host'unu tüm viewport'a yayıyordu — hiçbir hız/duruş kontrolü YOKTU.
   * Araç hareket hâlindeyken tam ekran video görünüyordu.
   *
   * Kilit: kapı UI'dan kaldırılamaz ve SESE genişletilemez. */
  it('🔒 F7.2 · SAHA BUGFIX (2026-09-03) · hız/hareket video AÇMAYI REDDEDEMEZ', () => {
    /* ÜRÜN KARARI DEĞİŞTİ: eskiden bu kilit `useVideoSafety`/`videoSafety.allowed`
       ile ekranın video render'ını GATE'lediğini doğruluyordu. Artık tam
       tersini kilitler — MediaScreen video görünürlüğü için hız kapısına
       ARTIK BAĞLI OLAMAZ (kilit KALDIRILMADI, yeni doğru davranışa BAĞLANDI). */
    const screen = stripF71(read('src/components/media/MediaScreen.tsx'));
    expect(screen.length, 'medya ekranı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(5000);
    expect(screen, 'video render kararı hâlâ hız kapısını çağırıyor')
      .not.toContain('useVideoSafety');
    expect(screen, 'video host görünürlüğü hâlâ hız kapısına bağlı')
      .not.toContain('videoSafety.allowed');

    /* Saf sınıflandırma modülü SİLİNMEDİ (LAB gözlemi + gelecekteki opt-in
       mevzuat politikası için) — yalnız artık bir GATE olarak KULLANILMIYOR. */
    const policy = stripF71(read('src/platform/media/videoSafetyPolicy.ts'));
    expect(policy, 'karar fonksiyonu kaldırılmış').toContain('decideVideoVisibility');
    expect(policy, 'gerekçe fonksiyonu kaldırılmış').toContain('videoBlockReason');
    /* Kapı YALNIZ görüntüyü sınıflandırır: ses/playback otoritelerine karışamaz. */
    expect(policy, 'görüntü sınıflandırması ses otoritesine karışmış')
      .not.toContain('mediaCommandGateway');
    expect(policy, 'görüntü sınıflandırması duck otoritesine karışmış').not.toContain('duckPolicy');
  });

  /* ── F7.4 · SAĞLAYICI (UZAK) KAPAK ─────────────────────────────────────
   * ÖLÇÜLEN KUSUR: sağlayıcı kapak kimliği `https://` küçük resim adresidir;
   * kanonik çözücü onu native MediaStore decode'una gönderiyordu → çözüm
   * düşüyor, Now Playing kapağı BOŞ kalıyordu. */
  it('🔒 F7.4 · uzak kapak GEÇİRİLİR, native decode ÇAĞRILMAZ', () => {
    const cache = stripF71(read('src/platform/media/artworkCache.ts'));
    expect(cache.length, 'kapak katmanı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    expect(cache, 'uzak kapak ayrımı kaldırılmış').toContain('isRemoteArtworkIdentity');
    expect(cache, 'uzak kapak kaynağı dürüst raporlanmıyor').toContain("'REMOTE'");
    /* Uzak yol, native çözücüden ÖNCE dönmeli — aksi hâlde kusur geri gelir. */
    const fn = cache.slice(
      cache.indexOf('export async function resolveArtwork'),
      cache.indexOf('export function reportArtworkLoadFailure'),
    );
    expect(fn.length, 'çözücü gövdesi okunamadı').toBeGreaterThan(100);
    expect(fn, 'uzak kapak erken dönüşü kaldırılmış').toContain('isRemoteArtworkIdentity');
  });

  /* ── F7.5 · IFRAME KAYNAĞINDA DURAKLAT ─────────────────────────────────
   * ÖLÇÜLEN KUSUR: gömülü IFrame kaynağında `transport` hiçbir zaman
   * `PLAYING` olmuyordu → duraklat düğmesi hep "çal" gösteriyor ve basınca
   * `play` gönderiyordu: YouTube DURAKLATILAMIYORDU. */
  it('🔒 F7.5 · IFrame gözlemi transporta yansır, NATIVE dürüstlük kuralı korunur', () => {
    const vm = stripF71(read('src/components/media/MusicViewModel.ts'));
    expect(vm.length, 'projeksiyon okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    expect(vm, 'IFrame gözlem dalı kaldırılmış').toContain("'youtube_iframe'");
    /* F0 kuralı GEVŞETİLMEDİ: native yolda doğrulanmamış playing PLAYING değildir. */
    expect(vm, 'native dürüstlük kuralı kaldırılmış').toContain('renderingVerified');
    expect(vm, 'native yolda doğrulanmamış playing PLAYING sayılmış')
      .toMatch(/else if \(snap\.playing\) transport = 'UNKNOWN'/);
  });

  /* ── F7.6 · SAĞLAYICI KUYRUĞU + DİNLEME OTURUMU ────────────────────────
   * ÖLÇÜLEN KUSUR: `carosMediaLayer` içinde `_queue`/`_qIndex`/`_qRevision`
   * adında MUTABLE bir sıra vardı; kanonik `PlayQueue` yalnız KÜTÜPHANE
   * seçimleri için kuruluyordu. Sağlayıcı tarafında ikinci bir desired-queue
   * sahibi doğuyor ve `ListeningSession` hiç başlamıyordu (Cross-Domain §1).
   *
   * ÜRÜN KARARI (2026-09-02): kuyruk SEÇİLEN parçanın kaynak sınıfıyla
   * SINIRLIDIR (same-provider). Karışık-sağlayıcı `PlayQueue` modeli YOKTUR. */
  it('🔒 F7.6 · medya katmanı kuyruk otoritesi DEĞİLDİR (ikinci mutable sıra yok)', () => {
    const layer = stripF71(read('src/platform/media/carosMediaLayer.ts'));
    expect(layer.length, 'medya katmanı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    expect(layer, 'ikinci mutable sıra sahibi geri gelmiş').not.toMatch(/\b_queue\b/);
    expect(layer, 'ikinci imleç sahibi geri gelmiş').not.toMatch(/\b_qIndex\b/);
    expect(layer, 'ikinci revizyon sayacı geri gelmiş').not.toMatch(/\b_qRevision\b/);
    /* Sıra · imleç · görünüm KANONİK kaynaktan okunur. */
    expect(layer, 'kanonik kuyruk okuması kaldırılmış').toContain('getDesiredQueue');
    expect(layer, 'kanonik kuyruk görünümü kaldırılmış').toContain('getDesiredQueueView');
    expect(layer, 'kanonik oturum başlatma kaldırılmış').toContain('startProviderListening');
    /* Kalan önbellek yalnız SUNUM içindir — sıralama/imleç aritmetiği YOK. */
    expect(layer, 'sunum önbelleği sıra otoritesine dönüşmüş')
      .not.toMatch(/_trackByEntryId\.(sort|splice|indexOf|slice|unshift|push)\b/);
  });

  it('🔒 F7.6 · PlayQueue tek DesiredQueue · ListeningSession tek oturum otoritesi', () => {
    const ctx = stripF71(read('src/platform/media/session/providerQueueContext.ts'));
    expect(ctx.length, 'sağlayıcı kuyruk bağlamı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    /* Bağlam kurucusu SAFTIR: kendi durumunu tutmaz, komut göndermez. */
    expect(ctx, 'bağlam kurucusu kapıya inmiş').not.toContain('mediaCommandGateway');
    expect(ctx, 'bağlam kurucusu native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(ctx, 'bağlam kurucusu kendi kuyruk durumunu tutmuş').not.toMatch(/^let /m);
    /* Same-provider kararı: kaynak sınıfı ayrımı KALDIRILAMAZ. */
    expect(ctx, 'same-provider sınırı kaldırılmış').toContain('providerSourceClassFor');
    expect(ctx, 'sessiz düşürme geri gelmiş (dışarıda kalanlar sayılmıyor)')
      .toContain('excludedIds');

    const runtime = stripF71(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(runtime, 'sağlayıcı oturum yolu kaldırılmış').toContain('startProviderListening');
    /* Sağlayıcı yolu kütüphane yoluyla AYNI kanonik zinciri kullanır. */
    expect(runtime, 'sağlayıcı yolu kanonik kuyruk kurucusunu atlamış')
      .toMatch(/startProviderListening[\s\S]*?createQueue\(/);
    expect(runtime, 'sağlayıcı yolu oturum başlatmıyor')
      .toMatch(/startProviderListening[\s\S]*?startListeningSession\(/);
  });

  it('🔒 F7.6 · UI · sağlayıcı kanonik kuyruğu DOĞRUDAN mutasyona uğratamaz', () => {
    for (const rel of [
      'src/components/media/MediaScreen.tsx',
      'src/components/media/LocalMusicBrowser.tsx',
      'src/components/split/SplitScreen.tsx',
      'src/components/theater/TheaterOverlay.tsx',
    ]) {
      const src = stripF71(read(rel));
      expect(src.length, `${rel} okunamadı — kilit boş kümeye düştü`).toBeGreaterThan(500);
      expect(src, `${rel}: UI kanonik kuyruğu doğrudan import etmiş`)
        .not.toMatch(/from '[^']*session\/playQueue'/);
      expect(src, `${rel}: UI sağlayıcı kuyruğunu kendisi kurmuş`)
        .not.toContain('buildProviderQueueContext');
    }
    /* Gözlem kanıtı AYRI kalır: desired kuyruk observed diye yayımlanamaz. */
    const evidence = stripF71(read('src/platform/media/session/observedQueueEvidence.ts'));
    expect(evidence, 'kanıt portu desired kuyruğa bağlanmış').not.toContain('getDesiredQueue');
    const derivation = stripF71(read('src/platform/media/session/observedQueueDerivation.ts'));
    expect(derivation, 'gözlem desired kuyruktan türetilmiş').not.toContain('getDesiredQueue');
  });

  /* ── F8 · SÜRÜŞ-FARKINDA MÜZİK ZEKÂSI ──────────────────────────────────
   * F8 bir öneri/otomasyon katmanıdır ve tam da bu yüzden en kolay bozulacak
   * yerdir: sessizce ikinci bir sürüş/kuyruk otoritesi kurmak, hot-path'e
   * yoklama eklemek veya "daha iyi bilirim" diye çalan müziğe karışmak.
   * Bu kilitler o üç kapıyı kapatır. */
  it('🔒 F8 · zekâ katmanı TIMER kurmaz, kanonik yoldan yürütür', () => {
    const runtime = stripF71(read('src/platform/media/intelligence/musicIntelligenceRuntime.ts'));
    expect(runtime.length, 'F8 runtime okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    /* Polling/timer YOK: düşük-uç bütçesinde arka planda dönen bir aktör olamaz. */
    expect(runtime, 'F8 kendi zamanlayıcısını kurmuş').not.toMatch(/setInterval\s*\(/);
    expect(runtime, 'F8 kendi yoklama döngüsünü kurmuş').not.toMatch(/setTimeout\s*\(/);
    expect(runtime, 'F8 kendi scheduler görevini kurmuş').not.toContain('scheduleTask');
    /* Tek gözlem dikişi kanonik dinleme oturumudur. */
    expect(runtime, 'kanonik oturum aboneliği kaldırılmış').toContain('subscribeListeningSession');
    /* Yürütme KANONİK: F3 kütüphane yolu; sağlayıcıya/native'e doğrudan komut YOK. */
    expect(runtime, 'F8 kanonik F3 yolunu atlamış').toContain('startLibraryListening');
    expect(runtime, 'F8 doğrudan komut kapısına inmiş').not.toContain('mediaCommandGateway');
    expect(runtime, 'F8 kanonik kuyruğu kendisi yazmış').not.toContain('session/playQueue');
    expect(runtime, 'F8 doğrudan sağlayıcıya inmiş').not.toMatch(/\bplayYouTube\s*\(/);
    /* Zero-Leak: durdurma aboneliği bırakmalı. */
    expect(runtime, 'zero-leak temizliği kaldırılmış').toContain('stopMusicIntelligence');
  });

  it('🔒 F8 · saf modeller SAF kalır (ikinci sürüş otoritesi yok)', () => {
    const model = stripF71(read('src/platform/media/intelligence/musicIntelligenceModel.ts'));
    const context = stripF71(read('src/platform/media/intelligence/drivingContextModel.ts'));
    for (const [name, src] of [['karar modeli', model], ['bağlam modeli', context]] as const) {
      expect(src.length, `${name} okunamadı — kilit boş kümeye düştü`).toBeGreaterThan(1500);
      expect(src, `${name} zamana bağlanmış (saf değil)`).not.toContain('Date.now');
      expect(src, `${name} timer kurmuş`).not.toMatch(/setInterval|setTimeout/);
      expect(src, `${name} React'e bağlanmış`).not.toContain("from 'react'");
      expect(src, `${name} native köprüye inmiş`).not.toContain('nativeAuthorityBridge');
      expect(src, `${name} komut kapısına inmiş`).not.toContain('mediaCommandGateway');
    }
    /* Hız eşiği F8'in DEĞİL: bağlam modeli kendi sürüş kipini YAYINLAMAZ. */
    expect(context, 'F8 ikinci sürüş kipi otoritesi kurmuş')
      .not.toMatch(/export function detectDrivingMode/);
  });

  it('🔒 F8 · kalıcı tercih kanıtı GİZLİLİK sınırını genişletemez', () => {
    const pref = read('src/platform/media/intelligence/preferenceEvidence.ts');
    expect(pref.length, 'tercih kanıtı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    /* Sınırlı depo: üst sınır ve TTL kaldırılamaz. */
    expect(pref, 'sınırsız profil açılmış').toContain('MAX_PREFERENCE_ENTRIES');
    expect(pref, 'TTL kaldırılmış').toContain('PREFERENCE_TTL_MS');
    /* İçerik/konum alanları modele GİREMEZ. */
    const body = stripF71(pref);
    for (const forbidden of ['contentUri', 'artworkIdentity', 'latitude', 'longitude',
      'destination', 'transcript', 'providerRef']) {
      expect(body, `gizlilik sınırı genişlemiş: ${forbidden}`).not.toContain(forbidden);
    }
    /* Kanıt deposu konum/navigasyon/arama modüllerini GÖRMEZ. */
    expect(body, 'kanıt deposu konum kaynağına bağlanmış').not.toContain('gpsService');
    expect(body, 'kanıt deposu navigasyona bağlanmış').not.toContain('navigationService');
  });

  it('🔒 F8 · LAB okur, KARAR ÜRETMEZ (ikinci otorite olamaz)', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    expect(sources.length, 'LAB okuma katmanı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    /* LAB karar üretemez ve uygulayamaz. */
    expect(sources, 'LAB karar üretmiş').not.toContain('evaluateMusicIntelligence');
    expect(sources, 'LAB eylem uygulamış').not.toContain('applyIntelligenceCandidate');
    /* LAB gözlemi üretim histerezisini İLERLETEMEZ. */
    expect(sources, 'LAB üretim bağlam durumunu ilerletmiş').not.toContain('readDrivingContext(');
    expect(sources, 'LAB salt-okunur bağlam okumasını kaybetmiş').toContain('peekDrivingContext');
  });

  it('🔒 F8 · öneri yüzeyi skor/gerekçe GÖSTERMEZ ve kendi çalma yolunu kurmaz', () => {
    const card = stripF71(read('src/components/media/MusicIntelligenceCard.tsx'));
    expect(card.length, 'öneri kartı okunamadı — kilit boş kümeye düştü').toBeGreaterThan(800);
    /* Teknik provenance kullanıcıya SIZMAZ. */
    for (const leak of ['confidence', 'suppressedBy', 'keptCount', 'bucket']) {
      expect(card, `teknik alan kullanıcı yüzeyine sızmış: ${leak}`)
        .not.toMatch(new RegExp(`\\{[^}]*${leak}[^}]*\\}`));
    }
    /* Yürütme kanonik uygulama fonksiyonundan geçer; UI sağlayıcıya inmez. */
    expect(card, 'kart kanonik uygulama yolunu atlamış').toContain('applyIntelligenceCandidate');
    expect(card, 'UI doğrudan sağlayıcıya inmiş').not.toContain('carosMediaLayer');
    expect(card, 'UI kanonik kuyruğa yazmış').not.toContain('session/playQueue');
  });

  it('🔒 F8 · lifecycle SystemBoot\'undur ve cleanup kayıtlıdır', () => {
    const boot = stripF71(read('src/platform/system/SystemBoot.ts'));
    expect(boot, 'F8 boot lifecycle\'ından çıkarılmış').toContain('startMusicIntelligence');
    expect(boot, 'F8 cleanup kaydı kaldırılmış (zero-leak)').toContain('stopMusicIntelligence');
    expect(boot, 'F8 cleanup adlandırması kaybolmuş').toContain('music-intelligence');
  });

  /* ── F9 · MAVİ MÜZİK COMPANION ─────────────────────────────────────────
   * Mavi müzik tarafında en kolay bozulan şey İDDİA'dır: komut gönderilir,
   * ses çıkmaz, asistan "çalıyor" der. F0–F8 bu yalanı tek tek kapattı;
   * bu kilitler doğal dil yolunun onu geri getirmesini engeller. */
  it('🔒 F9 · Mavi müzik yönlendiricisi requester\'dır, otorite DEĞİL', () => {
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    expect(router.length, 'F9 router okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    /* Doğrudan sağlayıcı/native/queue mutasyonu YOK. */
    expect(router, 'native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(router, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplayYouTube\s*\(/);
    expect(router, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplaySpotifyTrack\s*\(/);
    expect(router, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
    expect(router, 'F8 tercih kanıtına YAZMIŞ').not.toContain('notePreferenceOutcome');
    expect(router, 'duck otoritesine el atmış').not.toContain('duckRequest');
    expect(router, 'sürüşte video güvenlik kapısına dokunmuş').not.toContain('videoModeStore');
    expect(router, 'kendi sıralamasını kurmuş').not.toMatch(/\.sort\s*\(/);
    /* Kanonik sahiplerden geçmeli ve F5 kanıt eşiğini KULLANMALI. */
    expect(router, 'kanonik komut kapısı kullanılmıyor').toContain('mediaCommandGateway');
    expect(router, 'kanonik seçim yolu kullanılmıyor').toContain('searchSelection');
    expect(router, 'F5 otomatik çalma eşiği atlanmış').toContain('isConfidentEnoughToAutoPlay');
  });

  it('🔒 F9 · doğrulanmamış komut BAŞARI cümlesi kurduramaz', () => {
    const speech = stripF71(read('src/platform/media/intent/musicIntentSpeech.ts'));
    expect(speech.length, 'konuşma katmanı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1000);
    /* Dürüstlük yardımcısı kaldırılamaz — testler bunu kilitler. */
    expect(speech, 'iddia dürüstlüğü kontrolü kaldırılmış').toContain('claimIsHonest');
    expect(speech, 'iddia sınıfı ayrımı kaldırılmış').toContain('CONFIRMED');
    /* Konuşma katmanı kendi başına komut/otorite göremez. */
    expect(speech, 'konuşma katmanı otoriteye inmiş').not.toContain('mediaCommandGateway');
    expect(speech, 'konuşma katmanı zamana bağlanmış').not.toContain('Date.now');
  });

  it('🔒 F9 · sesli müzik yolu KOŞULSUZ "çalıyor" DEMEZ', () => {
    const exec = stripF71(read('src/platform/commandExecutor.ts'));
    expect(exec.length, 'komut yürütücü okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(5000);
    /* ÖLÇÜLEN KUSUR (F9): `playByQuery` bir parça döndürdüğü anda koşulsuz
       "<başlık> çalınıyor" deniyordu; o cümle bir playback kanıtı DEĞİLDİ. */
    expect(exec, 'sahte "çalınıyor" iddiası geri gelmiş')
      .not.toMatch(/\$\{track\.title\}\s*çalınıyor/);
    expect(exec, 'koşulsuz "Müzik açılıyor" iddiası geri gelmiş')
      .not.toMatch(/_speak\('Müzik açılıyor'/);
    /* Müzik araması kanonik F9 yolundan geçmeli. */
    expect(exec, 'kanonik müzik niyeti yolu kaldırılmış').toContain('musicIntentRouter');
    expect(exec, 'dürüst cevap üretici kaldırılmış').toContain('speakMusicOutcome');
  });

  it('🔒 F9 · atlama KUYRUK-FARKINDA tek girişten geçer (bypass yok)', () => {
    const exec = stripF71(read('src/platform/commandExecutor.ts'));
    /* ÖLÇÜLEN KUSUR (F9): `next`/`previous` doğrudan `mediaService`ten import
       ediliyordu → F7.3'te kurulan kuyruk-farkında giriş ATLANIYORDU ve
       sağlayıcı arama listesinde Mavi'nin "sonraki"si düşüyordu. */
    expect(exec, 'medya servisinden doğrudan atlama importu geri gelmiş')
      .not.toMatch(/import\s*\{[^}]*\bnext\b[^}]*\}\s*from\s*'\.\/mediaService'/);
    expect(exec, 'kuyruk-farkında atlama girişi kaldırılmış').toContain('_queueAwareNext');
    expect(exec, 'kuyruk-farkında atlama girişi kaldırılmış').toContain('_queueAwarePrevious');
    expect(exec, 'kuyruk-farkında giriş kanonik katmandan gelmiyor')
      .toContain('media/carosMediaLayer');
  });

  it('🔒 F9 · kanonik atlama girişi KANIT döndürür (sessiz void yok)', () => {
    const layer = stripF71(read('src/platform/media/carosMediaLayer.ts'));
    /* `void` dönen giriş, çağıranı `mediaService`e kaçmaya zorluyordu. */
    expect(layer, 'atlama girişi kanıtsız void\'e döndü')
      .not.toMatch(/export function next\s*\([^)]*\)\s*:\s*void/);
    expect(layer, 'atlama girişi kanıtsız void\'e döndü')
      .not.toMatch(/export function previous\s*\([^)]*\)\s*:\s*void/);
    expect(layer, 'atlama kanıtı kaldırılmış').toContain('MediaCommandResult');
  });

  it('🔒 F9 · niyet çözümü YEREL kalır (bulut zorunluluğu yok)', () => {
    const resolver = stripF71(read('src/platform/media/intent/musicIntentResolver.ts'));
    expect(resolver.length, 'çözümleyici okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1000);
    /* Temel taşıma/arama/kuyruk komutları bulut olmadan çözülmelidir. */
    expect(resolver, 'niyet çözümü buluta bağlanmış').not.toMatch(/fetch\s*\(/);
    expect(resolver, 'niyet çözümü LLM sağlayıcısına bağlanmış').not.toContain('aiGateway');
    expect(resolver, 'niyet çözümü ağ servisine bağlanmış').not.toContain('cloudSttService');
    expect(resolver, 'çözümleyici otoriteye inmiş').not.toContain('mediaCommandGateway');
  });

  it('🔒 F9 · telemetriye söylenen METİN yazılmaz (PII yok)', () => {
    const telemetry = read('src/platform/media/intent/musicIntentTelemetry.ts');
    expect(telemetry.length, 'telemetri okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    const body = stripF71(telemetry);
    for (const forbidden of ['utterance', 'transcript', 'query', 'title', 'artist']) {
      expect(body, `söylenen metin telemetriye sızmış: ${forbidden}`)
        .not.toMatch(new RegExp(`readonly ${forbidden}`));
    }
    /* İddia uyuşmazlığı sayacı kaldırılamaz — dürüstlük arızasının kanıtıdır. */
    expect(body, 'iddia uyuşmazlığı sayacı kaldırılmış').toContain('claimMismatch');
  });

  /* ── F10 · KARAKTER / ENERJİ KANITI ────────────────────────────────────
   * Bu fazın tek gerçek riski UYDURMAKTIR: elde ölçüm yokken "bu parça
   * enerjik" demek. Ölçülen gerçek şudur — MediaStore projeksiyonunda GENRE/
   * YEAR yok, Piped trait vermiyor, Spotify `audio-features` çağrılmıyor.
   * Kilitler bu boşluğun sessizce doldurulmasını engeller. */
  it('🔒 F10 · BPM yalnız GERÇEK ölçümden gelir; sezgisel kanıt LOW tavanlıdır', () => {
    const model = stripF71(read('src/platform/media/traits/musicTraitEvidence.ts'));
    expect(model.length, 'kanıt modeli okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    /* Tempo kapısı ve güven tavanı kaldırılamaz. */
    expect(model, 'tempo kaynağı kapısı kaldırılmış').toContain('mayCarryTempo');
    expect(model, 'sezgisel güven tavanı kaldırılmış').toContain('MAX_HEURISTIC_CONFIDENCE');
    expect(model, 'provenance sıralaması kaldırılmış').toContain('PROVENANCE_RANK');
    /* Saf kalmalı. */
    expect(model, 'kanıt modeli zamana bağlanmış').not.toContain('Date.now');
    expect(model, 'kanıt modeli otoriteye inmiş').not.toContain('mediaCommandGateway');
  });

  it('🔒 F10 · "daha sakin/enerjik" GÖRECELİDİR — sahte kıyas kurulamaz', () => {
    const selection = stripF71(read('src/platform/media/traits/traitSelectionModel.ts'));
    expect(selection.length, 'seçim modeli okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    /* Referans kapısı ve fark marjı kaldırılamaz. */
    expect(selection, 'referans kapısı kaldırılmış').toContain('NO_REFERENCE');
    expect(selection, 'algılanabilir fark marjı kaldırılmış').toContain('RELATIVE_ENERGY_MARGIN');
    /* Kanıtsız aday sessizce düşmemeli — sayılmalı. */
    expect(selection, 'kanıtsız aday sayacı kaldırılmış').toContain('rejectedNoEvidence');
    expect(selection, 'kesin dil kapısı kaldırılmış').toContain('allowsConfidentClaim');
    expect(selection, 'seçim modeli zamana bağlanmış').not.toContain('Date.now');
  });

  it('🔒 F10 · runtime çalma başlatmaz, timer kurmaz, kaynak yazmaz', () => {
    const runtime = stripF71(read('src/platform/media/traits/traitRuntime.ts'));
    expect(runtime.length, 'F10 runtime okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    expect(runtime, 'F10 kendi zamanlayıcısını kurmuş').not.toMatch(/setInterval\s*\(/);
    expect(runtime, 'F10 yoklama döngüsü kurmuş').not.toMatch(/setTimeout\s*\(/);
    expect(runtime, 'F10 doğrudan çalma başlatmış').not.toContain('startLibraryListening');
    expect(runtime, 'F10 komut kapısına inmiş').not.toContain('mediaCommandGateway');
    expect(runtime, 'F10 kanonik kuyruğa yazmış').not.toContain('session/playQueue');
    expect(runtime, 'F10 kütüphaneye yazmış').not.toContain('reconcileMusicIndex');
    expect(runtime, 'F10 tercih kanıtına yazmış').not.toContain('notePreferenceOutcome');
    /* Düşük-uç bütçesi: sınırlar kaldırılamaz. */
    expect(runtime, 'kanıt önbelleği sınırı kaldırılmış').toContain('MAX_TRAIT_CACHE');
    expect(runtime, 'aday tarama sınırı kaldırılmış').toContain('MAX_CANDIDATE_SCAN');
  });

  it('🔒 F10 · seçilen parça KANONİK F3 yolundan çalar (doğrudan sağlayıcı yok)', () => {
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    /* Karakter yolu da kanonik oturum yolundan geçmeli. */
    expect(router, 'karakter yolu kaldırılmış').toContain('runTraitDirected');
    expect(router, 'karakter seçimi kanonik F3 yolunu atlamış')
      .toMatch(/runTraitDirected[\s\S]*?startLibraryListening/);
    expect(router, 'karakter yolu doğrudan sağlayıcıya inmiş')
      .not.toMatch(/runTraitDirected[\s\S]{0,900}playYouTube/);
  });

  it('🔒 F10 · zayıf kanıttan KESİN dil doğmaz', () => {
    const speech = stripF71(read('src/platform/media/intent/musicIntentSpeech.ts'));
    /* Temkinli/kesin ayrımı kaldırılamaz. */
    expect(speech, 'temkinli dil dalı kaldırılmış').toContain('trait_selected_tentative');
    expect(speech, 'kesin dil dalı kaldırılmış').toContain('trait_selected_confident');
    expect(speech, 'karakter cümlesi üreticisi kaldırılmış').toContain('traitDirectionSpeech');
    /* Kanıtsız durumlar için dürüst karşılıklar kaldırılamaz. */
    for (const code of ['trait_reference_unavailable', 'trait_evidence_unavailable',
      'trait_no_candidate']) {
      expect(speech, `dürüst red metni kaldırılmış: ${code}`).toContain(code);
    }
  });

  it('🔒 F10 · telemetri parça/sanatçı metni TAŞIMAZ', () => {
    const telemetry = stripF71(read('src/platform/media/traits/traitTelemetry.ts'));
    expect(telemetry.length, 'telemetri okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1200);
    for (const forbidden of ['title', 'artist', 'query', 'utterance', 'uri']) {
      expect(telemetry, `metin alanı telemetriye sızmış: ${forbidden}`)
        .not.toMatch(new RegExp(`readonly ${forbidden}`));
    }
    /* Kanıt kökeni sayaçları ve uyuşmazlık sayacı kaldırılamaz. */
    expect(telemetry, 'gerçek ölçüm sayacı kaldırılmış').toContain('evidenceProvider');
    expect(telemetry, 'sezgisel sayacı kaldırılmış').toContain('evidenceHeuristic');
    expect(telemetry, 'iddia uyuşmazlığı sayacı kaldırılmış').toContain('claimMismatch');
  });

  /* ── F10.1 · GERÇEK KARAKTER KANITI ────────────────────────────────────
   * F10 hiçbir gerçek kanıt olmadan kapanmıştı (#1135). F10.1 gömülü ID3/
   * Vorbis BPM ve MediaStore GENRE'yi bağladı. Buradaki risk, bağlanan gerçek
   * kanıdın etrafında sessizce uydurma büyümesidir. */
  it('🔒 F10.1 · BPM kaynağı kapısı: tür/süre/başlık BPM ÜRETEMEZ', () => {
    const model = stripF71(read('src/platform/media/traits/musicTraitEvidence.ts'));
    expect(model.length, 'kanıt modeli okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    /* Kanonik güç sırası ve tempo kapısı kaldırılamaz. */
    expect(model, 'gömülü etiket provenance kaldırılmış').toContain('EMBEDDED_METADATA');
    expect(model, 'ölçüm provenance kaldırılmış').toContain('MEASURED_AUDIO');
    /* Tempo kapısı YALNIZ gerçek kaynakları saymalı — kütüphane metadata'sı DEĞİL. */
    expect(model, 'türden BPM üretilebilir hâle gelmiş')
      .not.toMatch(/mayCarryTempo[\s\S]{0,220}LIBRARY_METADATA/);
  });

  it('🔒 F10.1 · tür DESTEKLEYİCİDİR: kesin ruh hâli/BPM iddiası kuramaz', () => {
    const sources = stripF71(read('src/platform/media/traits/traitSources.ts'));
    expect(sources.length, 'kanıt kaynakları okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    /* Tür kanıtı LOW güvenli ve mood ÜRETMEYEN bir daldır. */
    expect(sources, 'tür kanıtı kaldırılmış').toContain('fromLibraryGenre');
    expect(sources, 'tür kanıtı güçlendirilmiş (LOW tavanı kalkmış)')
      .toMatch(/fromLibraryGenre[\s\S]{0,900}confidence: 'LOW'/);
    expect(sources, 'türden ruh hâli üretilmiş')
      .not.toMatch(/fromLibraryGenre[\s\S]{0,900}mood: '(CALM|ENERGETIC)'/);
    /* Gömülü BPM gerçek tempo taşır ama ruh hâli ÜRETMEZ. */
    expect(sources, 'gömülü BPM kanıtı kaldırılmış').toContain('fromEmbeddedBpm');
    expect(sources, 'BPM\'den ruh hâli uydurulmuş')
      .not.toMatch(/fromEmbeddedBpm[\s\S]{0,700}mood: '(CALM|ENERGETIC)'/);
  });

  it('🔒 F10.1 · doğrulanmamış sağlayıcı kaynağından kanıt OKUNMAZ', () => {
    const sources = stripF71(read('src/platform/media/traits/traitSources.ts'));
    /* Ölçülen yetenek tablosu ve okunabilirlik kapısı kaldırılamaz. */
    expect(sources, 'kaynak yetenek tablosu kaldırılmış')
      .toContain('PROVIDER_TRAIT_AVAILABILITY');
    expect(sources, 'okunabilirlik kapısı kaldırılmış').toContain('providerTraitReadable');
    /* Doğrulanmamış/desteklenmeyen kaynak AVAILABLE ilan EDİLEMEZ. */
    expect(sources, 'Piped trait yokken AVAILABLE ilan edilmiş')
      .not.toMatch(/youtube:\s*'AVAILABLE'/);
    expect(sources, 'doğrulanmamış Spotify sözleşmesi AVAILABLE ilan edilmiş')
      .not.toMatch(/spotify:\s*'AVAILABLE'/);
  });

  it('🔒 F10.1 · bayat kanıt sunulmaz: önbellek anahtarı şema + kuşak taşır', () => {
    const runtime = stripF71(read('src/platform/media/traits/traitRuntime.ts'));
    expect(runtime, 'şema sürümü kaldırılmış').toContain('TRAIT_SCHEMA_VERSION');
    expect(runtime, 'önbellek anahtarı kuşak taşımıyor (bayat kanıt riski)')
      .toMatch(/traitCacheKey[\s\S]{0,320}generation/);
    /* Gömülü okuma sınırlı ve tekrarsız olmalı. */
    expect(runtime, 'gömülü okuma sınırı kaldırılmış').toContain('MAX_EMBEDDED_PRIME');
    expect(runtime, 'aynı dosya sürekli yeniden okunuyor').toContain('embeddedBpm.has');
    /* İkinci bir MusicIndex kurulamaz. */
    expect(runtime, 'kütüphaneye yazılmış').not.toContain('reconcileMusicIndex');
  });

  it('🔒 F10.1 · LAB okuması üretim sayaçlarını/önbelleğini DEĞİŞTİRMEZ', () => {
    /* ÖLÇÜLEN KUSUR (F10.1 sırasında yakalandı): LAB alanı `peekReferenceEvidence`
       kanıtı `resolveTraitEvidence` ile üretiyordu → LAB okuması önbelleğe yazıyor
       ve isabet/kanıt sayaçlarını oynatıyordu. Gözlem, gözleneni etkileyemez. */
    const runtime = stripF71(read('src/platform/media/traits/traitRuntime.ts'));
    const peek = runtime.slice(runtime.indexOf('export function peekReferenceEvidence'));
    expect(peek.length, 'LAB okuma fonksiyonu okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(200);
    expect(peek, 'LAB okuması önbelleğe/telemetriye yazan yolu kullanmış')
      .not.toContain('resolveTraitEvidence');
    expect(peek, 'LAB okuması saf hesaplayıcıyı kullanmıyor').toContain('computeTraitEvidence');
    /* Saf hesaplayıcı sayaç yazmamalı. */
    const compute = runtime.slice(
      runtime.indexOf('function computeTraitEvidence'),
      runtime.indexOf('export async function primeEmbeddedTraits'),
    );
    expect(compute.length, 'saf hesaplayıcı okunamadı').toBeGreaterThan(200);
    expect(compute, 'saf hesaplayıcı sayaç yazmış').not.toContain('noteTrait');
    expect(compute, 'saf hesaplayıcı önbelleğe yazmış').not.toContain('cacheSet');
  });

  it('🔒 F10.1 · native gömülü okuma SINIRLI ve arka planda', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/media/TrackTraitExtractor.java');
    expect(java.length, 'native çıkarıcı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1500);
    expect(java, 'toplu iş sınırı kaldırılmış').toContain('MAX_BATCH');
    expect(java, 'dosya başına zaman aşımı kaldırılmış').toContain('PER_ITEM_TIMEOUT_MS');
    /* Dosya DECODE edilmez: yalnız kap metadata'sı okunur. */
    expect(java, 'ses çözme (decode) yoluna girilmiş').toContain('MetadataRetriever');
    expect(java, 'bozuk etiket filtresi kaldırılmış').toContain('bpm >= 40 && bpm <= 250');

    const plugin = stripF71(read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java'));
    expect(plugin, 'gömülü okuma UI thread\'e alınmış')
      .toMatch(/readTrackTraits[\s\S]{0,500}mediaLibraryExecutor\.submit/);
  });

  it('🔒 F10.1 · MediaStore GENRE sürüm kapılı ve boş değer UYDURULMUYOR', () => {
    const scanner = read('android/app/src/main/java/com/cockpitos/pro/media/MediaStoreLibraryScanner.java');
    expect(scanner, 'GENRE projeksiyondan çıkarılmış').toContain('MediaStore.Audio.Media.GENRE');
    expect(scanner, 'YEAR projeksiyondan çıkarılmış').toContain('MediaStore.Audio.Media.YEAR');
    /* API 30 altında GENRE sütunu YOKTUR: kapısız sorgu cursor'ı patlatır. */
    expect(scanner, 'GENRE sürüm kapısı kaldırılmış (eski cihazda çökme riski)')
      .toMatch(/supportsGenreColumn\(\)\)\s*cols\.add\(MediaStore\.Audio\.Media\.GENRE\)/);
    /* Boş tür/yıl `null` gider — sahte değer YOK. */
    expect(scanner, 'boş tür sahte değerle doldurulmuş')
      .toMatch(/genre[\s\S]{0,200}JSONObject\.NULL/);
  });

  /* ── F11 · OEM++ NOW PLAYING / MUSIC GÖRSEL DENEYİMİ ────────────────────
   * Görsel redesign'ların en kolay bozduğu şey OTORİTEDİR: "biraz daha akıcı
   * olsun" diye UI'ın kendi playback durumunu tutması, native'e doğrudan
   * komut göndermesi veya sahte bir ilerleme çubuğu çizmesi. Bu kilitler o
   * kapıları kapalı tutar. */
  it('🔒 F11 · Now Playing UI native/sağlayıcıya DOĞRUDAN komut göndermez', () => {
    const screen = stripF71(read('src/components/media/MediaScreen.tsx'));
    expect(screen.length, 'MediaScreen okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(5000);
    expect(screen, 'native köprüye doğrudan inmiş').not.toContain('nativeAuthorityBridge');
    expect(screen, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplayYouTube\s*\(/);
    expect(screen, 'sağlayıcıya doğrudan inmiş').not.toMatch(/\bplaySpotifyTrack\s*\(/);
    /* Taşıma yalnız kuyruk-farkında giriş veya F0 kapısından geçmeli. */
    expect(screen, 'kuyruk-farkında giriş kaldırılmış').toContain('queueAwareNext');
    expect(screen, 'kanonik komut kapısı kaldırılmış').toContain('mediaCommandGateway');
  });

  it('🔒 F11 · Now Playing UI PlayQueue\'yu DOĞRUDAN mutasyona uğratamaz', () => {
    const screen = stripF71(read('src/components/media/MediaScreen.tsx'));
    expect(screen, 'kanonik kuyruğu doğrudan import etmiş')
      .not.toMatch(/from '[^']*session\/playQueue'/);
    expect(screen, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
  });

  it('🔒 F11 · SAHA BUGFIX (2026-09-03) · video görünürlüğü YALNIZ videoMode\'a bağlı', () => {
    /* ÜRÜN KARARI DEĞİŞTİ: F7.2 hız kapısı F11 fullscreen chrome'undan da
       kaldırıldı — video hâlâ `isYouTube && videoMode` ile açılır, ama
       artık `videoSafety.allowed`e BAĞIMLI DEĞİLDİR. */
    const screen = stripF71(read('src/components/media/MediaScreen.tsx'));
    expect(screen, 'video render kararı hâlâ hız kapısını çağırıyor').not.toContain('useVideoSafety');
    expect(screen, 'video render kararı hâlâ videoSafety.allowed okuyor')
      .not.toMatch(/videoMode\s*&&\s*videoSafety\.allowed/);
    expect(screen, 'fullscreen chrome videoMode\'dan bağımsızlaşmış')
      .toMatch(/isYouTube\s*&&\s*videoMode\s*&&\s*\(/);
  });

  it('🔒 F11 · yerleşim modeli SAF kalır — ikinci sürüş/ekran otoritesi kurmaz', () => {
    const model = stripF71(read('src/components/media/nowPlayingLayoutModel.ts'));
    expect(model.length, 'yerleşim modeli okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(1000);
    expect(model, 'yerleşim modeli zamana bağlanmış').not.toContain('Date.now');
    expect(model, 'yerleşim modeli timer kurmuş').not.toMatch(/setInterval|setTimeout/);
    expect(model, 'yerleşim modeli React\'e bağlanmış').not.toContain("from 'react'");
    expect(model, 'yerleşim modeli otoriteye inmiş').not.toContain('mediaCommandGateway');
    /* Dokunma hedefi tabanı kaldırılamaz — hiçbir yoğunlukta 48px altına inilmez. */
    expect(model, 'dokunma hedefi tabanı kaldırılmış').toContain('MIN_TOUCH_TARGET_PX');
  });

  it('🔒 F11→F13 · beğeni düğmesi YALNIZ GERÇEK favori otoritesiyle geri gelebilir', () => {
    /* ÖLÇÜLEN KUSUR (F11): Now Playing'de `onClick`i olmayan bir beğeni
       düğmesi vardı — hiçbir eylemi yoktu, salt süstü. F11 bunu KALDIRDI
       (o an favori kavramı hiçbir F0–F10.1 otoritesinde YOKTU).
       Bu kilit köre düşmüştü: `not.toContain('Heart')` özgün niyeti
       ("işlevsiz süs buton yok") değil, o anki tek işaretini kilitliyordu.
       MUSIC F13 gerçek bir `musicCollectionAuthority` KURDUĞUNDAN (§ONE
       DOMAIN = ONE AUTHORITY) düğme artık MEŞRU — kilit yeni doğru
       davranışa GÜNCELLENİR (kaldırılmaz): Heart var OLABİLİR ama YALNIZ
       gerçek `useFavoriteStatus` durumuna bağlıysa; kanıtsız/onClick'siz
       süs biçimi hâlâ YASAKTIR. */
    const screen = stripF71(read('src/components/media/MediaScreen.tsx'));
    if (screen.includes('Heart')) {
      expect(screen, 'F13 favori hook\'u kullanılmadan Heart eklenmiş').toContain('useFavoriteStatus');
      expect(screen, 'Heart kontrolü kanıtsızken de çizilebiliyor (available kapısı yok)')
        .toMatch(/favorite\.available\s*&&/);
      expect(screen, 'toggle gerçek otoriteye bağlanmamış').toMatch(/favorite\.toggle\s*\(\s*\)/);
    }
  });

  it('🔒 F11 · albüm kapağında bilgi taşımayan "toy" nabız animasyonu YOK', () => {
    /* ÖLÇÜLEN KUSUR: kapağın arkasında sürekli `animate-pulse` ile atan,
       hiçbir bilgi taşımayan bulanık bir hale vardı (blur+pulse üst üste —
       düşük-uç GPU maliyeti + "oyuncak" görünüm). Kaldırıldı; kompozisyon
       kalitesi kapağın kendisinden ve ambient backdrop'tan gelir. */
    /* Ham kaynak (yorum SOYULMAZ) — sınırlar gerçek JSX `data-editable`
       öznitelikleridir; bir yorum METNİYLE sınırlamak, yorum soyulduğunda
       o metnin de KAYBOLMASI yüzünden dilimin dosya sonuna kadar taşmasına
       ve kilidi sessizce boş kümeye düşürmesine yol açardı (ÖLÇÜLDÜ). */
    const raw = read('src/components/media/MediaScreen.tsx');
    /* Sınır ham kaynaktan bulunur (yorum METNİYLE değil); YORUM içeriği ise
       kilit değerlendirmesinden SONRA soyulur — aksi hâlde bu dosyadaki
       açıklayıcı yorumun kendisi ("kaldırılan animate-pulse") yanlış pozitif
       üretirdi. */
    const artworkBlock = stripF71(raw.slice(
      raw.indexOf('data-editable="media.album-art"'),
      raw.indexOf('data-editable="media.track-info"'),
    ));
    expect(artworkBlock.length, 'kapak bloğu okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(100);
    expect(artworkBlock, 'kapak arkasına sürekli nabız animasyonu geri gelmiş')
      .not.toContain('animate-pulse');
  });

  it('🔒 F11 · başlık/sanatçı TEK yazı boyutu kaynağından gelir (çakışan sınıf YOK)', () => {
    /* ÖLÇÜLEN KUSUR: sanatçı satırında `text-base` VE `text-[10px]` aynı anda
       vardı — hangisinin kazandığı belirsiz, iki çelişen boyut sınıfı. Artık
       tek kaynak `nowPlayingLayoutModel`in `titleFontPx`/`artistFontPx`sidir. */
    const raw = read('src/components/media/MediaScreen.tsx');
    const trackInfo = raw.slice(
      raw.indexOf('data-editable="media.track-info"'),
      raw.indexOf('data-editable="media.progress"'),
    );
    expect(trackInfo.length, 'şarkı bilgisi bloğu okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(100);
    expect(trackInfo, 'başlık/sanatçı yazı boyutu yerleşim modelinden gelmiyor')
      .toMatch(/fontSize:\s*layout\.titleFontPx/);
    expect(trackInfo, 'başlık/sanatçı yazı boyutu yerleşim modelinden gelmiyor')
      .toMatch(/fontSize:\s*layout\.artistFontPx/);
    /* Çakışan sabit Tailwind boyut sınıfları geri gelmemeli. */
    expect(trackInfo, 'çakışan sabit yazı boyutu sınıfı geri gelmiş')
      .not.toMatch(/text-2xl|text-base/);
  });

  /* ── F12 · OEM++ LIBRARY / DISCOVERY / SEARCH GÖRSEL DENEYİMİ ───────────
   * ÖLÇÜLEN KUSUR: `LocalMusicBrowser` CarOS'un geri kalanından (amber/koyu
   * OEM tonları) KOPUK bir mavi (Tailwind blue-400) vurgu rengi kullanıyordu
   * — sıradan bir Android müzik uygulaması izlenimi buradan geliyordu. Bu
   * kilitler o kopukluğun ve kritik-altı dokunma hedefinin geri gelmesini
   * engeller; Discovery/Search'ün kanıt-gated sözleşmesini korur. */
  it('🔒 F12 · LocalMusicBrowser CarOS OEM tonlarını KULLANIR — yabancı vurgu YOK', () => {
    const browser = stripF71(read('src/components/media/LocalMusicBrowser.tsx'));
    expect(browser.length, 'LocalMusicBrowser okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(3000);
    expect(browser, 'yabancı mavi vurgu rengi geri gelmiş').not.toMatch(/blue-\d/);
    expect(browser, 'yabancı mavi RGB değeri geri gelmiş').not.toContain('59,130,246');
    expect(browser, 'CarOS amber vurgusu kaldırılmış').toContain('var(--oem-amber');
    /* Kritik dokunma hedefi tabanı kaldırılamaz. */
    expect(browser, 'dokunma hedefi tabanı kaldırılmış').toContain('MIN_TOUCH_TARGET_PX');
  });

  it('🔒 F12 · LocalMusicBrowser ikinci search/discovery/driving otoritesi KURMAZ', () => {
    const browser = stripF71(read('src/components/media/LocalMusicBrowser.tsx'));
    expect(browser, 'kendi sürüş ölçümünü yapmış').not.toContain('smartEngine');
    expect(browser, 'kendi hız/telemetri okuması yapmış').not.toContain('vehicleDataLayer');
    expect(browser, 'kanonik F2 sınırı yerine kendi sınırlama motorunu kurmuş')
      .toMatch(/searchMusicLibrary\(query,\s*limit\)/);
    expect(browser, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/from '[^']*session\/playQueue'/);
    expect(browser, 'kanonik kütüphaneyi mutasyona uğratmış').not.toContain('reconcileMusicIndex');
  });

  it('🔒 F12 · Discovery kanıtsız bölüm/iddia ÇİZMEZ (F5 sözleşmesi korunur)', () => {
    const model = stripF71(read('src/platform/media/search/discoveryModel.ts'));
    const surface = stripF71(read('src/components/media/MusicDiscoverySurface.tsx'));
    for (const forbidden of ['Senin için', 'senin için', 'Önerilen', 'Beğenebileceğin']) {
      expect(model, `kanıtsız iddia metni sızmış: ${forbidden}`).not.toContain(forbidden);
      expect(surface, `kanıtsız iddia metni sızmış: ${forbidden}`).not.toContain(forbidden);
    }
    expect(surface, 'boş keşif dürüst mesajı kaldırılmış').toContain('data-discovery-empty');
    expect(model, 'saf model React\'e bağlanmış').not.toContain("from 'react'");
  });

  it('🔒 F12 · Search boş↔sonuç↔boş akışı Discovery ile TEK yüzey kalır', () => {
    const searchView = stripF71(read('src/components/media/UnifiedSearchView.tsx'));
    expect(searchView, 'boşken keşif yüzeyi kaldırılmış').toContain('showDiscovery');
    expect(searchView, 'Discovery bileşeni ayrı bir uygulama gibi kopmuş')
      .toContain('<MusicDiscoverySurface');
    expect(searchView, 'arama sonucu doğrudan sağlayıcıya komut vermiş')
      .not.toMatch(/\bplayYouTube\s*\(/);
  });

  /* ── F13 · FAVORİLER / MUSIC COLLECTION AUTHORITY ───────────────────────
   * Spec §12'nin 11 kalıcı kilidi — kalıcı yasa dosyası (bu dosya), fazın
   * kendi hedefli paketi `musicF13FavoritesCollectionAuthority.test.ts`ten
   * AYRI ve KALICI olarak burada tutulur. */

  it('🔒 F13 · TEK MusicCollectionAuthority — Now Playing/Discovery/Mavi AYNI modülü kullanır', () => {
    const hook = read('src/components/media/useFavoriteStatus.ts');
    const discoveryRuntime = read('src/platform/media/search/discoveryRuntime.ts');
    const router = read('src/platform/media/intent/musicIntentRouter.ts');
    for (const [name, src] of [
      ['useFavoriteStatus', hook], ['discoveryRuntime', discoveryRuntime], ['musicIntentRouter', router],
    ] as const) {
      expect(src, `${name} favori otoritesini kanonik yoldan İTHAL ETMEMİŞ`)
        .toContain('collection/musicCollectionAuthority');
    }
  });

  it('🔒 F13 · UI kalıcılığa DOĞRUDAN YAZAMAZ — yalnız otorite üzerinden', () => {
    const hook = stripF71(read('src/components/media/useFavoriteStatus.ts'));
    const surface = stripF71(read('src/components/media/MusicDiscoverySurface.tsx'));
    const screen = stripF71(read('src/components/media/MediaScreen.tsx'));
    for (const [name, src] of [['useFavoriteStatus', hook], ['MusicDiscoverySurface', surface], ['MediaScreen', screen]] as const) {
      expect(src, `${name} safeStorage'a DOĞRUDAN yazmış`).not.toContain('safeStorage');
      expect(src, `${name} localStorage'a DOĞRUDAN yazmış`).not.toMatch(/localStorage\s*\./);
    }
  });

  it('🔒 F13 · favoriler PlayQueue\'yu DOĞRUDAN mutasyona uğratamaz', () => {
    const authority = stripF71(read('src/platform/media/collection/musicCollectionAuthority.ts'));
    expect(authority, 'kanonik kuyruğu doğrudan import etmiş')
      .not.toMatch(/from '[^']*session\/playQueue'/);
    expect(authority, 'kuyruk mutasyonu çağırmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
  });

  it('🔒 F13 · favoriler PLAYBACK OTORİTESİ DEĞİLDİR — dispatch YALNIZ çağıranda', () => {
    const authority = stripF71(read('src/platform/media/collection/musicCollectionAuthority.ts'));
    expect(authority, 'otorite kendi playMedia/dispatch çağrısı yapmış')
      .not.toMatch(/\bplayMedia\s*\(/);
    expect(authority, 'otorite native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(authority, 'otorite komut kapısına inmiş').not.toContain('mediaCommandGateway');
    /* `resolvePlaybackTarget` VERİ döndürür — fonksiyon adı kaldırılamaz. */
    expect(authority, 'veri-sözleşmesi fonksiyonu kaldırılmış').toContain('export function resolvePlaybackTarget');
  });

  it('🔒 F13 · favoriler ÖNERİ KANITI DEĞİLDİR — F8/F10 favori otoritesini OKUMAZ', () => {
    const intelligenceModel = stripF71(read('src/platform/media/intelligence/musicIntelligenceModel.ts'));
    const intelligenceRuntime = stripF71(read('src/platform/media/intelligence/musicIntelligenceRuntime.ts'));
    const traitModel = stripF71(read('src/platform/media/traits/traitSelectionModel.ts'));
    const traitRuntime = stripF71(read('src/platform/media/traits/traitRuntime.ts'));
    for (const [name, src] of [
      ['musicIntelligenceModel', intelligenceModel], ['musicIntelligenceRuntime', intelligenceRuntime],
      ['traitSelectionModel', traitModel], ['traitRuntime', traitRuntime],
    ] as const) {
      expect(src, `${name} favori otoritesini kanıt olarak OKUMUŞ`)
        .not.toContain('collection/musicCollectionAuthority');
    }
  });

  it('🔒 F13 · karışık-sağlayıcı favori LİSTESİ karışık-sağlayıcı PlayQueue KURMAZ', () => {
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    const surface = stripF71(read('src/components/media/MusicDiscoverySurface.tsx'));
    /* PLAY_FAVORITES PROVIDER dalı: `layer.playMedia(unified, [unified])` —
       tek-öğe tek-sağlayıcı kuyruk. Çoklu öğe/karma liste KURULAMAZ. */
    expect(router, 'F13 provider dispatch\'i tek-öğe kuyruk kurmuyor')
      .toMatch(/layer\.playMedia\(\s*unified\s*,\s*\[\s*unified\s*\]\s*\)/);
    expect(surface, 'Discovery provider dispatch\'i tek-öğe kuyruk kurmuyor')
      .toMatch(/onPlayProviderResult\?\.\(\s*providerTrack\s*,\s*\[\s*providerTrack\s*\]\s*\)/);
  });

  it('🔒 F13 · Mavi "eklendim/çıkardım" YALNIZ doğrulanmış mutasyonda söyler', () => {
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    const speech = stripF71(read('src/platform/media/intent/musicIntentSpeech.ts'));
    /* Router: VERIFIED yalnız otoritenin GERÇEK sonuç kodundan gelir — sabit
       "başarılı" DÖNDÜRÜLMEZ. */
    expect(router, 'ADD/REMOVE_FAVORITE sabit VERIFIED üretmiş')
      .not.toMatch(/'ADD_FAVORITE'[\s\S]{0,200}'VERIFIED'/);
    expect(router, 'kimlik doğrulanmadan mutasyon çağrılmış').toContain('no_current_item');
    /* Konuşma: favori mutasyon cümlesi YALNIZ CONFIRMED dalında kurulur —
       genel "X çalıyor." dalına düşmez (favori olmak çalıyor olmak DEĞİLDİR). */
    expect(speech, 'favori cümlesi CONFIRMED kapısı olmadan üretilebiliyor')
      .toMatch(/ADD_FAVORITE['"]?\s*\|\|\s*outcome\.intent\.kind\s*===\s*['"]REMOVE_FAVORITE/);
  });

  it('🔒 F13 · "bunu" kimliği yoksa favori/UYDURULMAZ — no_current_item kapısı kaldırılamaz', () => {
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    expect(router, 'currentItem null iken de mutasyon denenmiş')
      .toMatch(/currentItem\s*===\s*null[\s\S]{0,120}no_current_item/);
  });

  it('🔒 F13 · CAROS LAB salt-okunurdur — F13 kartı mutasyon TETİKLEMEZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = stripF71(read('src/platform/devtools/mediaAuthorityModel.ts'));
    for (const [name, src] of [['mediaAuthoritySources', sources], ['mediaAuthorityModel', model]] as const) {
      expect(src, `${name} favoriye YAZMIŞ (addFavorite)`).not.toMatch(/\baddFavorite\s*\(/);
      expect(src, `${name} favoriden ÇIKARMIŞ (removeFavorite)`).not.toMatch(/\bremoveFavorite\s*\(/);
      expect(src, `${name} toggle çağırmış (toggleFavorite)`).not.toMatch(/\btoggleFavorite\s*\(/);
    }
    /* LAB yalnız ADET/sayaç okur — parça adı taşıyan alan İSİM olarak GEÇMEZ. */
    expect(model, 'F13 kartı LAB\'a taşınmış').toContain('music-collection');
  });

  it('🔒 F13 · sağlayıcı "remote like" yeteneği UYDURULMAZ', () => {
    const entry = stripF71(read('src/platform/media/collection/musicCollectionEntry.ts'));
    const authority = stripF71(read('src/platform/media/collection/musicCollectionAuthority.ts'));
    for (const [name, src] of [['musicCollectionEntry', entry], ['musicCollectionAuthority', authority]] as const) {
      expect(src, `${name} Spotify/YouTube "save/like" API'sine çağrı uydurmuş`)
        .not.toMatch(/spotify\.(save|like)|youtube\.(rate|like)/i);
      expect(src, `${name} fetch ile dış sağlayıcı isteği kurmuş`).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('🔒 F13 · gizlilik sınırı GENİŞLETİLEMEZ — kalıcı şema dar kalır', () => {
    const entry = stripF71(read('src/platform/media/collection/musicCollectionEntry.ts'));
    const forbidden = ['query:', 'utterance', 'transcript', 'location', 'coordinates', 'route:', 'drivingHistory', 'speech'];
    for (const f of forbidden) {
      expect(entry, `yasaklı alan FavoriteEntry şemasına sızmış: ${f}`).not.toContain(f);
    }
  });

  /* ── F15 · PLAYLIST / COLLECTION AUTHORITY ──────────────────────────────
   * Kalıcı yasa dosyası (bu dosya) — fazın kendi hedefli paketi
   * `musicF15PlaylistCollectionAuthority.test.ts`ten AYRI ve KALICI olarak
   * burada tutulur. */

  it('🔒 F15 · TEK playlist authority — Discovery/Now Playing/Mavi AYNI modülü kullanır', () => {
    const surface = read('src/components/media/MusicDiscoverySurface.tsx');
    const detail = read('src/components/media/PlaylistDetailPanel.tsx');
    const addSheet = read('src/components/media/AddToPlaylistSheet.tsx');
    const router = read('src/platform/media/intent/musicIntentRouter.ts');
    for (const [name, src] of [
      ['MusicDiscoverySurface', surface], ['PlaylistDetailPanel', detail],
      ['AddToPlaylistSheet', addSheet], ['musicIntentRouter', router],
    ] as const) {
      expect(src, `${name} playlist otoritesini kanonik yoldan İTHAL ETMEMİŞ`)
        .toContain('playlist/musicPlaylistAuthority');
    }
  });

  it('🔒 F15 · UI playlist state SAHİBİ OLAMAZ — yalnız otorite üzerinden okur/yazar', () => {
    const detail = stripF71(read('src/components/media/PlaylistDetailPanel.tsx'));
    const addSheet = stripF71(read('src/components/media/AddToPlaylistSheet.tsx'));
    for (const [name, src] of [['PlaylistDetailPanel', detail], ['AddToPlaylistSheet', addSheet]] as const) {
      expect(src, `${name} safeStorage'a DOĞRUDAN yazmış`).not.toContain('safeStorage');
      expect(src, `${name} localStorage'a DOĞRUDAN yazmış`).not.toMatch(/localStorage\s*\./);
      expect(src, `${name} kendi playlist dizisini useState'te TUTMUŞ`).not.toMatch(/useState<\s*Playlist/);
    }
  });

  it('🔒 F15 · playlist authority PLAYBACK OTORİTESİ DEĞİLDİR — dispatch YALNIZ çağıranda', () => {
    const authority = stripF71(read('src/platform/media/playlist/musicPlaylistAuthority.ts'));
    expect(authority, 'otorite kendi playMedia/dispatch çağrısı yapmış').not.toMatch(/\bplayMedia\s*\(/);
    expect(authority, 'otorite native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(authority, 'otorite komut kapısına inmiş').not.toContain('mediaCommandGateway');
    expect(authority, 'otorite startLibraryListening çağırmış — dispatch otoriteye SIZMIŞ')
      .not.toContain('startLibraryListening');
    /* Veri-sözleşmesi fonksiyonları kaldırılamaz. */
    expect(authority, 'veri-sözleşmesi fonksiyonu kaldırılmış').toContain('export function resolvePlaybackTarget');
    expect(authority, 'başlangıç planı fonksiyonu kaldırılmış').toContain('export function resolvePlaylistStartPlan');
  });

  it('🔒 F15 · karma-sağlayıcı playlist İKİNCİ PlayQueue KURAMAZ — F7.6 same-provider korunur', () => {
    const authority = stripF71(read('src/platform/media/playlist/musicPlaylistAuthority.ts'));
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    /* Otorite kendi kuyruk kurucusunu İCAT ETMEMİŞ — yalnız aynı-sağlayıcı
       ÖNİZLEMESİ üretir (gerçek filtre F7.6'nın KENDİ `buildProviderQueueContext`
       ında, dispatch anında tekrar uygulanır). */
    expect(authority, 'ikinci bir kuyruk kurucu (createQueue vb.) İCAT ETMİŞ')
      .not.toMatch(/\b(createQueue|buildQueueContext|buildProviderQueueContext)\s*\(/);
    /* Router: PROVIDER playlist dispatch'i `carosMediaLayer.playMedia`nın
       KENDİ same-provider kuyruk kurucusuna (queue param) devreder. */
    expect(router, 'F15 provider dispatch\'i tek listeyi playMedia\'ya devretmemiş')
      .toMatch(/layerMod\.playMedia\(\s*startTrack\s*,\s*unified\s*\)/);
  });

  it('🔒 F15 · Mavi playlist state\'i DOĞRUDAN mutate EDEMEZ — yalnız MusicIntent → authority', () => {
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    const resolver = stripF71(read('src/platform/media/intent/musicIntentResolver.ts'));
    for (const [name, src] of [['musicIntentRouter', router], ['musicIntentResolver', resolver]] as const) {
      expect(src, `${name} kalıcılığa DOĞRUDAN yazmış`).not.toContain('safeStorage');
    }
    /* Router yalnız `ports.playlist()` üzerinden İSTER — kendi playlist
       state'ini TUTMAZ (modül-seviyesi mutable playlist dizisi YOK). */
    expect(router, 'runPlaylist ports.playlist() dışında bir otoriteye inmiş')
      .toContain('await ports.playlist()');
    expect(resolver, 'çözümleyici playlist state\'i OKUMUŞ (SAF olmalı)')
      .not.toContain('getPlaylist');
  });

  it('🔒 F15 · Favorites (F13) ve Playlist (F15) otoriteleri BİRBİRİNE dönüşemez', () => {
    const favAuthority = stripF71(read('src/platform/media/collection/musicCollectionAuthority.ts'));
    const plAuthority = stripF71(read('src/platform/media/playlist/musicPlaylistAuthority.ts'));
    expect(favAuthority, 'F13 otoritesi F15 playlist deposuna İTHAL/YAZMIŞ')
      .not.toContain('playlist/musicPlaylistAuthority');
    expect(plAuthority, 'F15 otoritesi F13 favori deposuna İTHAL/YAZMIŞ')
      .not.toContain('collection/musicCollectionAuthority');
    /* Kalıcı anahtarlar AYRIDIR — aynı depoya YAZILMAZ. */
    expect(favAuthority).toContain('caros.music.f13.favorites.v1');
    expect(plAuthority).toContain('caros.music.f15.playlists.v1');
  });

  it('🔒 F15 · UI/native/provider\'e DOĞRUDAN playback bypass\'ı YOK', () => {
    const detail = stripF71(read('src/components/media/PlaylistDetailPanel.tsx'));
    const addSheet = stripF71(read('src/components/media/AddToPlaylistSheet.tsx'));
    const surface = stripF71(read('src/components/media/MusicDiscoverySurface.tsx'));
    for (const [name, src] of [
      ['PlaylistDetailPanel', detail], ['AddToPlaylistSheet', addSheet], ['MusicDiscoverySurface', surface],
    ] as const) {
      expect(src, `${name} native köprüye inmiş`).not.toContain('nativeAuthorityBridge');
      expect(src, `${name} sağlayıcıya doğrudan komut vermiş`).not.toMatch(/\bplayYouTube\s*\(/);
      expect(src, `${name} kanonik kuyruğu doğrudan import etmiş`)
        .not.toMatch(/from '[^']*session\/playQueue'/);
    }
    /* Çalma yalnız kanonik F3 girişinden (PlaylistDetailPanel) veya çağırana
       devirle (F13 deseniyle AYNI sınır). */
    expect(detail, 'kanonik F3 girişi kaldırılmış').toContain('startLibraryListening');
  });

  it('🔒 F15 · CAROS LAB salt-okunurdur — F15 kartı mutasyon TETİKLEMEZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = stripF71(read('src/platform/devtools/mediaAuthorityModel.ts'));
    for (const [name, src] of [['mediaAuthoritySources', sources], ['mediaAuthorityModel', model]] as const) {
      expect(src, `${name} playlist oluşturmuş (createPlaylist)`).not.toMatch(/\bcreatePlaylist\s*\(/);
      expect(src, `${name} playlist silmiş (deletePlaylist)`).not.toMatch(/\bdeletePlaylist\s*\(/);
      expect(src, `${name} öğe eklemiş (addItemToPlaylist)`).not.toMatch(/\baddItemToPlaylist\s*\(/);
      expect(src, `${name} öğe çıkarmış (removeItemFromPlaylist)`).not.toMatch(/\bremoveItemFromPlaylist\s*\(/);
    }
    expect(model, 'F15 kartı LAB\'a taşınmış').toContain('music-playlist');
  });

  it('🔒 F15 · gizlilik allowlist KORUNUR — kalıcı şema ve telemetri dar kalır', () => {
    const entry = stripF71(read('src/platform/media/playlist/musicPlaylistEntry.ts'));
    const telemetry = stripF71(read('src/platform/media/playlist/musicPlaylistTelemetry.ts'));
    const forbidden = ['utterance', 'transcript', 'location', 'coordinates', 'route:', 'drivingHistory', 'speech'];
    for (const [name, src] of [['musicPlaylistEntry', entry], ['musicPlaylistTelemetry', telemetry]] as const) {
      for (const f of forbidden) {
        expect(src, `yasaklı alan ${name} şemasına sızmış: ${f}`).not.toContain(f);
      }
    }
  });

  /* ── F16 · LYRICS / ŞARKI SÖZLERİ EXPERIENCE ─────────────────────────────
   * Kalıcı yasa dosyası (bu dosya) — fazın kendi hedefli paketi
   * `musicF16LyricsExperience.test.ts`ten AYRI ve KALICI olarak burada
   * tutulur. */

  it('🔒 F16 · TEK lyrics authority — UI/Now Playing/Mavi AYNI modülü kullanır', () => {
    const panel = read('src/components/media/LyricsPanel.tsx');
    const router = read('src/platform/media/intent/musicIntentRouter.ts');
    const sources = read('src/platform/devtools/mediaAuthoritySources.ts');
    for (const [name, src] of [
      ['LyricsPanel', panel], ['musicIntentRouter', router], ['mediaAuthoritySources', sources],
    ] as const) {
      expect(src, `${name} lyrics otoritesini kanonik yoldan İTHAL ETMEMİŞ`)
        .toContain('lyrics/musicLyricsAuthority');
    }
  });

  it('🔒 F16 · UI lyrics state SAHİBİ OLAMAZ — yalnız otorite üzerinden okur', () => {
    const panel = stripF71(read('src/components/media/LyricsPanel.tsx'));
    expect(panel, 'LyricsPanel safeStorage\'a DOĞRUDAN yazmış').not.toContain('safeStorage');
    expect(panel, 'LyricsPanel localStorage\'a DOĞRUDAN yazmış').not.toMatch(/localStorage\s*\./);
    expect(panel, 'LyricsPanel kendi lyrics dizisini useState\'te TUTMUŞ').not.toMatch(/useState<\s*LyricsResult/);
  });

  it('🔒 F16 · lyrics authority PLAYBACK/QUEUE OTORİTESİ DEĞİLDİR — dispatch/mutasyon YOK', () => {
    const authority = stripF71(read('src/platform/media/lyrics/musicLyricsAuthority.ts'));
    expect(authority, 'otorite kendi playMedia/dispatch çağrısı yapmış').not.toMatch(/\bplayMedia\s*\(/);
    expect(authority, 'otorite native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(authority, 'otorite komut kapısına inmiş').not.toContain('mediaCommandGateway');
    expect(authority, 'otorite startLibraryListening çağırmış — dispatch otoriteye SIZMIŞ')
      .not.toContain('startLibraryListening');
    expect(authority, 'otorite MusicIndex\'i mutasyona uğratmış (ikinci F2 kopyası)')
      .not.toContain('reconcileMusicIndex');
    expect(authority, 'otorite PlayQueue/ListeningSession\'ı DOĞRUDAN mutasyona uğratmış')
      .not.toMatch(/\b(noteCurrentItem|startListeningSession|noteQueueRevision)\s*\(/);
  });

  it('🔒 F16 · İKİNCİ playback clock/timer/polling KURULMAZ — pozisyon ÇAĞIRANDAN gelir', () => {
    const authority = stripF71(read('src/platform/media/lyrics/musicLyricsAuthority.ts'));
    const panel = stripF71(read('src/components/media/LyricsPanel.tsx'));
    for (const [name, src] of [['musicLyricsAuthority', authority], ['LyricsPanel', panel]] as const) {
      expect(src, `${name} setInterval ile ikinci zamanlayıcı kurmuş`).not.toMatch(/setInterval/);
      expect(src, `${name} kendi playback pozisyonunu türetmiş (Date.now tabanlı)`).not.toMatch(/positionSec\s*=\s*Date\.now/);
    }
    /* Aktif satır projeksiyonu İKİLİ ARAMADIR — her render turunda TÜM
       satırları lineer taramaz (§12 performans kilidi). */
    expect(authority, 'aktif satır fonksiyonu kaldırılmış').toContain('export function activeLyricsLineIndex');
    expect(authority, 'ikili arama yerine lineer tarama YAZILMIŞ')
      .not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*ms\s*<=\s*posMs/);
  });

  it('🔒 F16 · SAHTE senkron ZAMANLAMA kurulamaz — MPEG-frame reddi ve monoton kanıt KORUNUR', () => {
    const nativeSrc = read('android/app/src/main/java/com/cockpitos/pro/media/TrackLyricsExtractor.java');
    /* Native: yalnız timestampFormat==2 (milisaniye) KABUL edilir — MPEG-frame
       formatı bit hızı bilinmeden ms'ye ÇEVRİLMEZ (bu bir TAHMİN olurdu). */
    expect(nativeSrc, 'SYLT MPEG-frame reddi kaldırılmış (uydurma zamanlama riski)')
      .toContain('if (timestampFormat != 2) return null');
    /* Ayrıştırma döngüsü SINIRLI ve İLERLEME KORUMALIDIR — bozuk çerçeve
       sonsuz döngü/OOM üretemez. */
    expect(nativeSrc, 'SYLT döngü sınırı kaldırılmış').toContain('MAX_SYNC_LINES');
    expect(nativeSrc, 'ilerlemeyen döngü koruması kaldırılmış').toContain('next <= pos');

    const entry = stripF71(read('src/platform/media/lyrics/musicLyricsEntry.ts'));
    expect(entry, 'sanitizeSyncedLines monoton kontrolü kaldırılmış').toContain('r.ms < lastMs');
  });

  it('🔒 F16 · kimlik yetersizse fail-closed — kanıtsız lyrics BAĞLANAMAZ', () => {
    const authority = stripF71(read('src/platform/media/lyrics/musicLyricsAuthority.ts'));
    expect(authority, 'peekLyrics kimlik kontrolünü kaldırmış').toContain("key === null");
  });

  it('🔒 F16 · Mavi lyrics state\'i DOĞRUDAN mutate EDEMEZ — yalnız MusicIntent → authority', () => {
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    const resolver = stripF71(read('src/platform/media/intent/musicIntentResolver.ts'));
    expect(router, 'router kalıcılığa DOĞRUDAN yazmış').not.toContain('safeStorage');
    expect(resolver, 'çözümleyici lyrics otoritesini İTHAL ETMİŞ (SAF olmalı)')
      .not.toContain('lyrics/musicLyricsAuthority');
    expect(router, 'runLyrics ports.lyrics() dışında bir otoriteye inmiş').toContain('await ports.lyrics()');
  });

  it('🔒 F16 · UI/native/provider\'e DOĞRUDAN playback bypass\'ı YOK', () => {
    const panel = stripF71(read('src/components/media/LyricsPanel.tsx'));
    expect(panel, 'LyricsPanel native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(panel, 'LyricsPanel sağlayıcıya doğrudan komut vermiş').not.toMatch(/\bplayYouTube\s*\(/);
    expect(panel, 'LyricsPanel kanonik kuyruğu doğrudan import etmiş')
      .not.toMatch(/from '[^']*session\/playQueue'/);
  });

  it('🔒 F16 · CAROS LAB salt-okunurdur — F16 kartı mutasyon TETİKLEMEZ, söz metni TAŞIMAZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = stripF71(read('src/platform/devtools/mediaAuthorityModel.ts'));
    for (const [name, src] of [['mediaAuthoritySources', sources], ['mediaAuthorityModel', model]] as const) {
      expect(src, `${name} lyrics'i doğrudan çağırmış (primeLyricsForCurrentItem)`)
        .not.toMatch(/\bprimeLyricsForCurrentItem\s*\(/);
    }
    expect(model, 'F16 kartı LAB\'a taşınmış').toContain('music-lyrics');
  });

  it('🔒 F16 · gizlilik allowlist KORUNUR — söz metni telemetriye/kalıcı şemaya SIZMAZ', () => {
    const entry = stripF71(read('src/platform/media/lyrics/musicLyricsEntry.ts'));
    const telemetry = stripF71(read('src/platform/media/lyrics/musicLyricsTelemetry.ts'));
    const forbidden = ['utterance', 'transcript', 'location', 'coordinates', 'route:', 'drivingHistory', 'speech'];
    for (const [name, src] of [['musicLyricsEntry', entry], ['musicLyricsTelemetry', telemetry]] as const) {
      for (const f of forbidden) {
        expect(src, `yasaklı alan ${name} şemasına sızmış: ${f}`).not.toContain(f);
      }
    }
  });

  it('🔒 F16 · F7.2 video güvenliği / F6.1 duck otoritesi BYPASS EDİLEMEZ', () => {
    const authority = stripF71(read('src/platform/media/lyrics/musicLyricsAuthority.ts'));
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    for (const [name, src] of [['musicLyricsAuthority', authority]] as const) {
      expect(src, `${name} video güvenlik kapısını atlamış`).not.toContain('videoSafetyPolicy');
      expect(src, `${name} duck otoritesine DOĞRUDAN yazmış`).not.toContain('duckRequest');
    }
    // Router'ın lyrics dalı F7.2/F6.1 modüllerine HİÇ dokunmaz — sözler bunlardan bağımsızdır.
    expect(router, 'runLyrics civarında video/duck referansı sızmış')
      .not.toMatch(/runLyrics[\s\S]{0,600}(videoSafetyPolicy|duckRequest)/);
  });

  it('🔒 F16 · F14/F9 ses hattı YERİNDE KALIR — bypass yalnız GENİŞLETİLDİ, koşul BOZULMADI', () => {
    const voice = stripF71(read('src/platform/voiceService.ts'));
    expect(voice, '1c0 bypass koşulu (yalnız result.command===null) BOZULMUŞ')
      .toContain('if (result.command === null) {');
    expect(voice, 'LYRICS_KINDS narrow-safe kümeye eklenmemiş').toContain('LYRICS_KINDS.includes(musicIntent.kind)');
  });

  /* ── MUSIC F17 · SONIC AUDIO INTELLIGENCE ────────────────────────────────
   * F17 ilk kez dosyayı DECODE edip dalga formunu ÖLÇER. Buradaki kilitler
   * "ölçüm" iddiasının ölçümle sınırlı kalmasını korur: uydurma BPM yok,
   * uydurma mood yok, bütçesiz decode yok, ikinci otorite yok. */

  it('🔒 F17 · MEASURED_AUDIO YALNIZ gerçek ölçümden gelir; mood ASLA üretilmez', () => {
    const descriptor = read('src/platform/media/sonic/sonicDescriptor.ts');
    expect(descriptor.length, 'sonicDescriptor okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    const code = stripF71(descriptor);

    /* Tek `mood` ataması olmalı ve AÇIKÇA null olmalı. */
    const moods = code.match(/mood:\s*[^,\n]+/g) ?? [];
    expect(moods.length, 'mood ataması kaybolmuş — kilit kör kalmış').toBeGreaterThan(0);
    for (const m of moods) expect(m, 'dalga formundan mood üretilmiş').toMatch(/mood:\s*null/);

    /* Kanıt üretimi kanonik F10 modelinden geçmeli — paralel model KURULMAZ. */
    expect(code, 'F17 kendi kanıt modelini kurmuş').toContain('makeTraitEvidence');
    expect(code).toContain("provenance: 'MEASURED_AUDIO'");
  });

  it('🔒 F17 · zayıf otokorelasyon tepesi TEMPO sayılmaz (uydurma BPM yasağı)', () => {
    const code = stripF71(read('src/platform/media/sonic/sonicDescriptor.ts'));
    expect(code, 'tempo güven eşiği kaldırılmış').toContain('TEMPO_CONFIDENCE_MIN');
    expect(code, 'eşik karşılaştırması kaldırılmış')
      .toMatch(/tempoConfidence\s*>=\s*TEMPO_CONFIDENCE_MIN/);
    /* Eşik anlamlı kalmalı: 0 veya negatif bir eşik kilidi sessizce açardı. */
    const m = code.match(/TEMPO_CONFIDENCE_MIN\s*=\s*([0-9.]+)/);
    expect(m, 'eşik sabiti bulunamadı').not.toBeNull();
    expect(Number(m?.[1] ?? 0), 'tempo eşiği etkisiz hâle getirilmiş').toBeGreaterThan(0.1);
  });

  it('🔒 F17 · analiz katmanı timer KURMAZ, çalma BAŞLATMAZ, ikinci otorite AÇMAZ', () => {
    const runtime = read('src/platform/media/sonic/sonicAnalysisRuntime.ts');
    expect(runtime.length, 'sonicAnalysisRuntime okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    const code = stripF71(runtime);
    expect(code, 'analiz katmanı timer/polling kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
    expect(code, 'analiz katmanı çalma başlatmış')
      .not.toMatch(/startLibraryListening|playByQuery|startProviderListening/);
    expect(code, 'analiz katmanı kuyruğa yazmış').not.toMatch(/session\/playQueue/);

    /* Native yüzeyi YALNIZ analiz + iptal. Başka native çağrısı ikinci
       otorite kapısı olurdu. */
    const calls = code.match(/CarLauncher\.[A-Za-z]+/g) ?? [];
    expect(calls.length, 'native çağrısı bulunamadı — kilit kör kalmış').toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/analyzeTrackAudio|cancelTrackAudioAnalysis/);
  });

  it('🔒 F17 · baskı altında ölçüm HİÇ yapılmaz — performans gerçeği DEĞİŞTİRMEZ', () => {
    const code = stripF71(read('src/platform/media/sonic/sonicAdmissionModel.ts'));
    expect(code, 'termal kapısı kaldırılmış').toContain('THERMAL_PRESSURE');
    expect(code, 'bellek kapısı kaldırılmış').toContain('MEMORY_PRESSURE');
    expect(code, 'düşük-uç kapısı kaldırılmış').toContain('LOW_TIER_WHILE_PLAYING');
    /* Baskı "küçültülmüş ölçüm" ÜRETMEZ: reddedilen kararın turu 0 olmalı. */
    expect(code, 'reddedilen kararda tur boyu sıfırlanmıyor').toMatch(/batchSize:\s*0/);
    /* Bilinmeyen cihaz DÜŞÜK sayılır (fail-closed bütçe). */
    expect(code).toMatch(/default:\s*return 1;/);
  });

  it('🔒 F17 · aynı dosya tekrar tekrar ÇÖZÜLMEZ; kuşak anahtarı KORUNUR', () => {
    const code = stripF71(read('src/platform/media/sonic/sonicAnalysisRuntime.ts'));
    /* Anahtar şema + kimlik + dosya kuşağı taşımalı — kimlik tek başına YETMEZ. */
    expect(code, 'önbellek anahtarından şema sürümü düşmüş').toContain('SONIC_SCHEMA_VERSION');
    expect(code, 'önbellek anahtarından dosya kuşağı düşmüş').toContain('generationModified');
    expect(code, 'LRU tavanı kaldırılmış').toContain('MAX_SONIC_CACHE');
    expect(code, 'sonsuz yeniden deneme kilidi kaldırılmış').toContain('MAX_TRANSIENT_RETRY');
    /* §17 — eski kuşağın sonucu yeni gerçeğe yazılamaz. */
    expect(code, 'bayat tur sonucu düşürülmüyor').toMatch(/runGeneration !== generation/);
  });

  it('🔒 F17 · CAROS LAB salt-okunurdur — analiz TETİKLEMEZ, ad/URI TAŞIMAZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = stripF71(read('src/platform/devtools/mediaAuthorityModel.ts'));
    expect(sources, 'LAB üretim analizini tetiklemiş').not.toMatch(/\brunSonicAnalysis\s*\(/);
    expect(sources, 'LAB sayaç değiştiren okuyucuyu kullanmış').toContain('peekSonicDescriptor');
    expect(sources, 'LAB parça adı/URI taşımış').not.toMatch(/f17Reference(Title|Artist|Uri|Path)/);
    expect(model, 'F17 kartı LAB\'dan düşmüş').toContain('music-sonic');
  });

  it('🔒 F17 · gömülü etiket kanıtı "kanıt yok" diye SAYILMAZ (F17\'de kapatılan kusur)', () => {
    const telemetry = read('src/platform/media/traits/traitTelemetry.ts');
    expect(telemetry, 'ölçülmüş ses sayacı kaldırılmış').toContain('evidenceMeasured');
    expect(telemetry, 'gömülü etiket sayacı kaldırılmış').toContain('evidenceEmbedded');
    const code = stripF71(telemetry);
    expect(code, 'MEASURED_AUDIO dalı kaldırılmış').toContain("case 'MEASURED_AUDIO'");
    expect(code, 'EMBEDDED_METADATA yeniden default dalına düşmüş')
      .toContain("case 'EMBEDDED_METADATA'");
  });

  it('🔒 F17 · native analizör bütçeli, iptal edilebilir ve mood ÜRETMEZ', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/media/SonicAudioAnalyzer.java');
    expect(java.length, 'native analizör okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(3000);
    expect(java, 'toplu iş sınırı kaldırılmış').toContain('MAX_BATCH');
    expect(java, 'dosya başına bütçe kaldırılmış').toContain('PER_ITEM_BUDGET_MS');
    expect(java, 'analiz süresi tavanı kaldırılmış').toContain('MAX_ANALYZE_MS');
    expect(java, 'iptal kuşağı kaldırılmış').toContain('AtomicInteger');
    expect(java, 'native mood alanı üretmiş').not.toMatch(/"mood"/);

    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin, 'analiz kütüphane tarama havuzunu bloklamış')
      .toContain('sonicAnalysisExecutor');
    expect(plugin, 'analiz izin kapısı kaldırılmış')
      .toMatch(/analyzeTrackAudio[\s\S]{0,600}hasAudioReadPermission/);
    /* F22 QA'da yakalanan GERÇEK derleme kusuru: analizör farklı pakettedir
       (`com.cockpitos.pro.media`) ve import EDİLMEMİŞTİ → native derleme
       düşüyordu. Host testi bunu yakalayamaz; kilit import'u korur. */
    expect(plugin, 'SonicAudioAnalyzer import edilmemiş (native derleme düşer)')
      .toContain('import com.cockpitos.pro.media.SonicAudioAnalyzer;');
  });

  /* ── MUSIC F18 · SMART RADIO / ENDLESS MIX ───────────────────────────────
   * F18'in iki riski: "radyo" adı altında İKİNCİ bir kuyruk otoritesi doğurmak
   * ve kanıtsız bir kişiselleştirme iddiası kurmak. Kilitler ikisini de kapatır. */

  it('🔒 F18 · Smart Radio KUYRUK OTORİTESİ DEĞİLDİR — yürütme kanonik F3 zincirinde', () => {
    const runtime = read('src/platform/media/radio/smartRadioRuntime.ts');
    expect(runtime.length, 'smartRadioRuntime okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    const code = stripF71(runtime);
    expect(code, 'radyo kendi kuyruğunu kurmuş')
      .not.toMatch(/\b(createQueue|addToQueue|setCurrentIndex|clearQueue|reorder)\s*\(/);
    expect(code, 'radyo native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(code, 'radyo gateway\'e doğrudan komut vermiş').not.toContain('mediaCommandGateway');
    expect(code, 'kanonik ekleme seam\'i kullanılmamış').toContain('appendLibraryTracksToQueue');
    expect(code, 'kanonik başlatma seam\'i kullanılmamış').toContain('startLibraryListening');
  });

  it('🔒 F18 · kalıcı "radyo state" YOKTUR ve sıra SINIRLIDIR', () => {
    const runtime = stripF71(read('src/platform/media/radio/smartRadioRuntime.ts'));
    const model = read('src/platform/media/radio/smartRadioModel.ts');
    expect(runtime, 'radyo kalıcı durum yazmış').not.toMatch(/safeStorage|localStorage/);
    expect(runtime, 'radyo timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
    expect(model, 'uzunluk tavanı kaldırılmış').toContain('MAX_RADIO_LENGTH');
    expect(runtime, 'aday tarama tavanı kaldırılmış').toContain('MAX_RADIO_SCAN');
    const m = model.match(/MAX_RADIO_LENGTH\s*=\s*(\d+)/);
    expect(m, 'uzunluk sabiti bulunamadı').not.toBeNull();
    expect(Number(m?.[1] ?? 0), 'sonsuz sıra üretilebiliyor').toBeLessThanOrEqual(100);
  });

  it('🔒 F18 · kanıtsız sıra DETERMİNİSTİKtir ve kişiselleştirme İDDİA EDİLMEZ', () => {
    const model = stripF71(read('src/platform/media/radio/smartRadioModel.ts'));
    expect(model, 'sıralamaya rastgelelik girmiş').not.toMatch(/Math\.random/);
    expect(model, 'kararlı karma kaldırılmış').toContain('stableHash');
    expect(model, 'iddia sınıfı kaldırılmış').toContain('claimClass');
    /* "Benzer" iddiası YALNIZ ölçülmüş sınıfta kurulabilir. */
    expect(model).toMatch(/allowsSimilarityClaim[\s\S]{0,200}'MEASURED'/);

    const speech = stripF71(read('src/platform/media/intent/musicIntentSpeech.ts'));
    expect(speech, 'akış cümlesi kanıt sınıfını okumuyor').toContain('_measured');
    /* Olculmus dalin benzerlik cumlesi VARDIR; kanitsiz dalin cumlesi
       benzerlik IDDIA ETMEZ — iki literal de burada kilitlenir. */
    expect(speech, 'olculmus dalda benzerlik cumlesi yok')
      .toContain('Buna benzeyenleri sıranın devamına ekliyorum.');
    expect(speech, 'kanitsiz dalin durust cumlesi kaldirilmis')
      .toContain('Kütüphanenden sırayı uzatıyorum.');
    expect(speech, 'akis cumlesinde guclu kisisel iddia var')
      .not.toMatch(/sana özel|seversin|senin için seçtim/i);
  });

  it('🔒 F18 · havuz YALNIZ yerel — karma-sağlayıcı kuyruk ÜRETİLMEZ (F7.6)', () => {
    const code = stripF71(read('src/platform/media/radio/smartRadioRuntime.ts'));
    expect(code, 'sağlayıcı sonucu radyo havuzuna sokulmuş')
      .not.toMatch(/pipedProvider|spotifyService|searchAllSources|unifiedFromSearchResult/);
    expect(code, 'kanonik kütüphane okuması kaldırılmış').toContain('getMusicLibrarySnapshot');
    expect(code, 'sağlayıcı favorisi havuza girmiş').toContain("f.kind === 'LOCAL'");
    /* Kuyruk desteklemeyen kaynakta ekleme "olmuş gibi" gösterilemez. */
    expect(code).toContain('sourceSupportsQueue');
  });

  it('🔒 F18 · ekleme seam\'i kanonik kurucuyu kullanır ve çalma durumunu DEĞİŞTİRMEZ', () => {
    const src = stripF71(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(src, 'ekleme seam\'i kaldırılmış').toContain('appendLibraryTracksToQueue');
    /* İkinci bir QueueEntry kurucusu İCAT EDİLMEMİŞ olmalı. */
    expect(src, 'ekleme kendi girdi kurucusunu kullanmış')
      .toMatch(/appendLibraryTracksToQueue[\s\S]{0,400}buildLibraryQueueContext/);
    expect(src, 'ekleme kanonik mutasyonu atlamış')
      .toMatch(/appendLibraryTracksToQueue[\s\S]{0,400}addToQueue/);
    /* `forcePlay: false` — duraklatılmış müzik ekleme yüzünden BAŞLAMAZ. */
    expect(src, 'ekleme çalmayı zorluyor').toMatch(/appendLibraryTracksToQueue[\s\S]{0,500}false, nowMs/);
  });

  it('🔒 F18 · Mavi akış istekleri KANONİK MusicIntent hattından geçer', () => {
    const intent = read('src/platform/media/intent/musicIntent.ts');
    const router = stripF71(read('src/platform/media/intent/musicIntentRouter.ts'));
    const voice = stripF71(read('src/platform/voiceService.ts'));
    expect(intent, 'akış niyet grubu kaldırılmış').toContain('RADIO_KINDS');
    expect(intent, 'F18 rotası kaldırılmış').toContain('F18_SMART_RADIO');
    expect(router, 'router radyo runtime\'ını port üzerinden almıyor').toContain('ports.radio()');
    expect(voice, 'canlı ses hattı akış niyetlerini tanımıyor').toContain('RADIO_KINDS.includes');
    /* Router radyo modülünü DOĞRUDAN import etmemeli (port deseni korunur). */
    expect(router, 'router radyo modülünü doğrudan import etmiş')
      .not.toMatch(/^import[^\n]*radio\/smartRadioRuntime/m);
  });

  it('🔒 F18 · CAROS LAB salt-okunurdur — plan ÜRETMEZ, parça kimliği TAŞIMAZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(sources, 'LAB akış planı üretmiş').not.toMatch(/\b(planSmartRadio|startSmartRadio)\s*\(/);
    expect(sources, 'LAB parça kimliği taşımış').not.toMatch(/f18(Track|Title|Artist)/);
    expect(model, 'F18 kartı LAB\'dan düşmüş').toContain('music-radio');
  });

  /* ── MUSIC F19 · LOUDNESS / REPLAYGAIN / VOLUME CONSISTENCY ──────────────
   * F19'un riski: ses yoluna İKİNCİ bir yazar sokmak ve ölçmediğimiz bir
   * şeyi (LUFS) ölçmüş gibi sunmak. Kilitler ikisini de kapatır. */

  it('🔒 F19 · İKİNCİ ses otoritesi YOK — yalnız mevcut sourceNormalization beslenir', () => {
    const gw = read('src/platform/media/authority/mediaCommandGateway.ts');
    expect(gw.length, 'gateway okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    const code = stripF71(gw);
    /* Beklenen üç konum: bildirim · setter · test sıfırlaması. */
    const writes = code.match(/_sourceNormalization\s*=/g) ?? [];
    expect(writes.length, 'normalizasyon yazarı bulunamadı — kilit kör kalmış')
      .toBeGreaterThan(0);
    expect(writes.length, 'dördüncü yazar = ikinci ses otoritesi').toBeLessThanOrEqual(3);
    /* Native'e yazılan değer duck İÇERMEZ (F6.1 çift-duck kilidi korunur). */
    expect(code).toMatch(/nativeUserVolume[\s\S]{0,400}duckLevel:\s*1/);
    expect(code).toMatch(/nativeUserVolume[\s\S]{0,400}sourceNormalization:\s*_sourceNormalization/);
  });

  it('🔒 F19 · loudness katmanı kullanıcı sesine · duck\'a · DSP\'ye DOKUNMAZ', () => {
    const rt = read('src/platform/media/loudness/loudnessRuntime.ts');
    expect(rt.length, 'loudnessRuntime okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    const code = stripF71(rt);
    expect(code, 'loudness kullanıcı sesini değiştirmiş')
      .not.toMatch(/setUserVolumePercent|setMuted/);
    expect(code, 'loudness duck otoritesine dokunmuş')
      .not.toMatch(/\bduck\s*\(|unduck\s*\(|duckRequest/);
    expect(code, 'loudness DSP zincirine yazmış')
      .not.toMatch(/audioExperienceAuthority|setBandGainDb|computeSafetyPreampDb/);
    expect(code, 'loudness timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
    expect(code, 'kanonik yazma seam\'i kaldırılmış').toContain('setSourceNormalization');
  });

  it('🔒 F19 · LUFS UYDURULMAZ ve kanıt yoksa çarpan TAM 1.0', () => {
    const ev = read('src/platform/media/loudness/loudnessEvidence.ts');
    expect(stripF71(ev), 'kodda LUFS alanı üretilmiş').not.toMatch(/lufs/i);
    expect(ev, 'nötr sonuç kaldırılmış').toContain('NEUTRAL_NORMALIZATION');
    expect(ev).toMatch(/factor:\s*1/);
    /* Yükseltme YASAK — sessiz parça boost edilmez. */
    expect(ev, 'boost sınırı kaldırılmış').toContain('BOOST_NOT_SUPPORTED');
    expect(ev).toMatch(/requestedDb\s*>=\s*0/);
  });

  it('🔒 F19 · kısma SINIRLIDIR ve duyulmayan fark uygulanmaz (pumping yok)', () => {
    const ev = read('src/platform/media/loudness/loudnessEvidence.ts');
    const maxDb = /MAX_ATTENUATION_DB\s*=\s*(\d+)/.exec(ev)?.[1];
    expect(maxDb, 'kısma tavanı sabiti bulunamadı').toBeDefined();
    expect(Number(maxDb), 'kısma tavanı ses kaybına yol açacak kadar büyük')
      .toBeLessThanOrEqual(20);
    expect(ev, 'duyulur eşik kaldırılmış').toContain('MIN_ADJUSTMENT_DB');
    expect(ev, 'çarpan alt sınırı kaldırılmış').toContain('MIN_NORMALIZATION');
    /* Aynı parçada yeniden yazım YOK. */
    const rt = stripF71(read('src/platform/media/loudness/loudnessRuntime.ts'));
    expect(rt, 'aynı parçada yeniden yazım koruması kaldırılmış')
      .toMatch(/id === trackedId/);
  });

  it('🔒 F19 · katman kapanırken kısma SIZMAZ (nötre geri çekilir)', () => {
    const rt = stripF71(read('src/platform/media/loudness/loudnessRuntime.ts'));
    expect(rt, 'durdurma nötre geri çekmiyor')
      .toMatch(/stopLoudnessNormalization[\s\S]{0,900}setSourceNormalization\(1\)/);
  });

  it('🔒 F19 · native yeni yüzey AÇMADI — mevcut readTrackTraits genişletildi', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/media/TrackTraitExtractor.java');
    expect(java.length, 'native okunamadı — kilit boş kümeye düştü').toBeGreaterThan(3000);
    expect(java, 'ReplayGain okuması kaldırılmış').toContain('replaygain_track_gain');
    expect(java, 'R128 okuması kaldırılmış').toContain('r128_track_gain');
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin, 'F19 için gereksiz ikinci native metot açılmış')
      .not.toContain('readReplayGain');
  });

  it('🔒 F19 · CAROS LAB salt-okunurdur — normalizasyon UYGULAMAZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(sources, 'LAB normalizasyon uygulamış')
      .not.toMatch(/\b(applyLoudnessForCurrentItem|setSourceNormalization|primeGainTags)\s*\(/);
    expect(sources, 'LAB parça adı/URI taşımış').not.toMatch(/f19(Title|Artist|Uri|Track)/);
    expect(model, 'F19 kartı LAB\'dan düşmüş').toContain('music-loudness');
  });

  /* ── MUSIC F20 · GAPLESS / FADE / INTELLIGENT TRANSITIONS ────────────────
   * F20'nin riski: ikinci bir player açmak ve olmayan bir yeteneği (gerçek
   * crossfade / beat hizalama) varmış gibi sunmak. Kilitler ikisini kapatır. */

  it('🔒 F20 · İKİNCİ player YOK ve gapless BOZULMAZ', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackService.java');
    expect(java.length, 'native okunamadı — kilit boş kümeye düştü').toBeGreaterThan(10000);
    const code = stripF71(java);
    const players = code.match(/new ExoPlayer\.Builder/g) ?? [];
    expect(players.length, 'ikinci ExoPlayer örneği açılmış').toBe(1);
    expect(code, 'gapless bozulmuş (pauseAtEndOfMediaItems)')
      .not.toContain('setPauseAtEndOfMediaItems');
  });

  it('🔒 F20 · geçiş kazancı YALNIZ kısar ve playback TRUTH üretmez', () => {
    const code = stripF71(read('android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackService.java'));
    expect(code, 'geçiş kazancı ses formülünden düşmüş')
      .toMatch(/userVolume \* duck \* transitionGain/);
    expect(code, 'renderingVerified geçiş kazancına bağlanmış')
      .not.toMatch(/isRenderingVerified[\s\S]{0,400}transitionGain/);
    /* Duck sırasında fade YOK · süresi bilinmeyen içerikte fade YOK. */
    expect(code).toMatch(/checkFadeOut[\s\S]{0,600}getDuckVolume\(\) < 1\.0f/);
    expect(code).toMatch(/checkFadeOut[\s\S]{0,900}C\.TIME_UNSET/);
    expect(code).toMatch(/checkFadeOut[\s\S]{0,900}hasNextMediaItem/);
  });

  it('🔒 F20 · olmayan yetenek VAR gibi gösterilmez (crossfade · beat)', () => {
    const model = read('src/platform/media/transition/transitionModel.ts');
    expect(model.length, 'model okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    expect(model).toMatch(/TRUE_CROSSFADE[\s\S]{0,200}UNSUPPORTED/);
    expect(model).toMatch(/BEAT_MATCHED[\s\S]{0,200}UNSUPPORTED/);
    /* UI olmayan kontrolü ÇİZMEZ. */
    const ui = stripF71(read('src/components/media/AudioExperiencePanel.tsx'));
    expect(ui, 'olmayan crossfade kontrolü çizilmiş').not.toMatch(/crossfade/i);
  });

  it('🔒 F20 · geçiş katmanı kuyruğa DOKUNMAZ ve timer KURMAZ', () => {
    const rt = read('src/platform/media/transition/transitionRuntime.ts');
    expect(rt.length, 'runtime okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    const code = stripF71(rt);
    expect(code, 'geçiş katmanı kuyruğa yazmış')
      .not.toMatch(/\b(createQueue|addToQueue|setCurrentIndex|clearQueue)\s*\(/);
    expect(code, 'geçiş katmanı native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(code, 'geçiş katmanı timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
    expect(code, 'kanonik yazma seam\'i kaldırılmış').toContain('setTransitionPolicy');
  });

  it('🔒 F20 · albüm devamlılığı ve canlı içerik korunur (fade zorlanmaz)', () => {
    const model = stripF71(read('src/platform/media/transition/transitionModel.ts'));
    expect(model, 'canlı içerik kapısı kaldırılmış').toContain('LIVE_CONTENT');
    expect(model, 'duck kapısı kaldırılmış').toContain('DUCK_ACTIVE');
    expect(model, 'albüm devamlılığı kapısı kaldırılmış').toContain('ALBUM_CONTINUITY');
    /* Varsayılan KAPALI — duyulur davranış zorlanmaz. */
    expect(model).toMatch(/fadeEnabled:\s*false/);
  });

  it('🔒 F20 · CAROS LAB salt-okunurdur — politika UYGULAMAZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(sources, 'LAB geçiş politikası uygulamış')
      .not.toMatch(/\b(applyTransitionPolicy|setTransitionPreference)\s*\(/);
    expect(model, 'F20 kartı LAB\'dan düşmüş').toContain('music-transition');
  });

  /* ── MUSIC F21 · OFFLINE / CACHE / RECOVERY / IGNITION CONTINUITY ────────
   * F21'in riski: "kurtarma" adı altında ikinci bir kurtarma motoru kurmak,
   * kontak sinyali uydurmak ve kullanıcı dokunmadan ses başlatmak. */

  it('🔒 F21 · süresi dolmuş uzak adres CANLI sayılmaz (geri yüklemede düşer)', () => {
    const model = read('src/platform/media/recovery/recoveryModel.ts');
    expect(model.length, 'kurtarma modeli okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    expect(model, 'bayat uzak adres sınıfı kaldırılmış').toContain('EXPIRING_REMOTE');
    expect(model, 'sentinel sınıfı kaldırılmış').toContain('RESOLVE_AT_PLAY');
    const runtime = stripF71(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(runtime, 'geri yükleme tazelik sınıflandırmasını atlamış')
      .toMatch(/restoreListeningSession[\s\S]{0,3000}classifyEntryFreshness/);
    expect(runtime, 'düşürme kararı kaldırılmış').toContain('shouldDropOnRestore');
  });

  it('🔒 F21 · geri yükleme HÂLÂ ÇALMAZ (phantom PLAYING yok)', () => {
    const runtime = stripF71(read('src/platform/media/session/listeningSessionRuntime.ts'));
    expect(runtime, 'geri yükleme çalma iddiası kurmuş').toMatch(/playbackClaim: 'NONE'/);
    expect(runtime, 'geri yüklemede süreklilik UNKNOWN başlamıyor')
      .toMatch(/restoreListeningSession[\s\S]{0,4000}noteContinuity\('UNKNOWN'/);
  });

  it('🔒 F21 · otomatik devam FAIL-CLOSED ve üretimde KAPALI', () => {
    const model = read('src/platform/media/recovery/recoveryModel.ts');
    expect(model, 'kontak bilinmezken RESUME engeli kaldırılmış')
      .toMatch(/ignition === 'UNKNOWN'/);
    expect(model, 'kullanıcı duraklatma koruması kaldırılmış').toContain('USER_PAUSED');
    const runtime = read('src/platform/media/recovery/recoveryRuntime.ts');
    expect(runtime, 'UI\'sız otomatik çalma AÇILMIŞ')
      .toMatch(/POLICY_ALLOWS_AUTO_RESUME\s*=\s*false/);
  });

  it('🔒 F21 · kontak sinyali UYDURULMAZ ve OBD ile AYNI eşiği kullanır', () => {
    const sources = read('src/platform/media/recovery/recoverySources.ts');
    expect(sources, 'kontak kanıtı araç store\'undan okunmuyor')
      .toContain('useUnifiedVehicleStore');
    const obd = /LINK_LOSS_IGNITION_OFF_V\s*=\s*([0-9.]+)/
      .exec(read('src/platform/obd/linkLossLedger.ts'))?.[1];
    const media = /IGNITION_OFF_VOLTAGE\s*=\s*([0-9.]+)/.exec(sources)?.[1];
    expect(obd, 'OBD eşiği bulunamadı — kilit kör kalmış').toBeDefined();
    expect(Number(media), 'aynı gerçeğe iki farklı eşik verilmiş').toBe(Number(obd));
  });

  it('🔒 F21 · kurtarma katmanı ÇALMA BAŞLATMAZ ve ikinci motor KURMAZ', () => {
    const code = stripF71(read('src/platform/media/recovery/recoveryRuntime.ts'));
    expect(code, 'kurtarma çalma başlatmış')
      .not.toMatch(/startLibraryListening|startProviderListening|playSource|playByQuery/);
    expect(code, 'kurtarma native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(code, 'kurtarma kendi yeniden başlatma motorunu kurmuş')
      .not.toMatch(/backoff|retryTimer|restartService/i);
    expect(code, 'kurtarma timer kurmuş').not.toMatch(/setInterval\(|setTimeout\(/);
  });

  it('🔒 F21 · CAROS LAB salt-okunurdur — kurtarma TETİKLEMEZ', () => {
    const sources = stripF71(read('src/platform/devtools/mediaAuthoritySources.ts'));
    const model = read('src/platform/devtools/mediaAuthorityModel.ts');
    expect(sources, 'LAB kurtarma tetiklemiş')
      .not.toMatch(/\b(evaluateAutoResume|restoreListeningSession)\s*\(/);
    expect(model, 'F21 kartı LAB\'dan düşmüş').toContain('music-recovery');
  });

  /* ── MUSIC F22 · FINAL COMPLETENESS AUDIT KAPANIŞLARI ────────────────────
   * Bu kilitler F22 denetiminde BULUNAN gerçek açıkların geri gelmesini
   * engeller. Yeni özellik değil, kapatılan kusurun bekçisidir. */

  it('🔒 F22 · eski müzik ayrıştırıcısı YÜRÜTMEDEN ÖNCE "çalınıyor" DEMEZ', () => {
    const parser = read('src/platform/musicCommandParser.ts');
    expect(parser.length, 'ayrıştırıcı okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(2000);
    /* Ayrıştırıcı metni yürütmeden ÖNCE seslendirilir; TAMAMLANMIŞ eylem
       iddiası kuramaz. F22 denetiminde ölçülen kusur: shuffle dalı
       "karışık çalınıyor" diyordu. */
    const feedbacks = parser.match(/feedback:\s*[`'][^`']*[`']/g) ?? [];
    expect(feedbacks.length, 'feedback metni bulunamadı — kilit kör kalmış')
      .toBeGreaterThan(2);
    for (const f of feedbacks) {
      expect(f, `ayrıştırıcı tamamlanmış eylem iddiası kuruyor: ${f}`)
        .not.toMatch(/çalınıyor|çalıyor|başlatıldı|eklendi|açıldı/);
    }
  });

  it('🔒 F22 · UI sağlayıcıyı DOĞRUDAN çalmaz (kanonik kapı korunur)', () => {
    const files = [
      'src/components/media/MediaScreen.tsx',
      'src/components/media/NowPlayingSurface.tsx',
      'src/components/media/QueuePanel.tsx',
      'src/components/media/MusicDiscoverySurface.tsx',
      'src/components/media/AudioExperiencePanel.tsx',
    ];
    for (const f of files) {
      const src = stripF71(read(f));
      expect(src.length, `${f} okunamadı — kilit boş kümeye düştü`).toBeGreaterThan(200);
      expect(src, `${f} sağlayıcıyı doğrudan çalmış`)
        .not.toMatch(/\bplayYouTube\s*\(|\bplaySpotifyTrack\s*\(|\bplayStream\s*\(/);
      expect(src, `${f} native köprüye inmiş`).not.toContain('nativeAuthorityBridge');
    }
  });

  it('🔒 F22 · yeni müzik katmanları SystemBoot cleanup\'ına KAYITLI', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    for (const name of ['music-intelligence', 'music-loudness', 'music-transition']) {
      expect(boot, `${name} cleanup kaydı yok (zero-leak ihlali)`)
        .toContain(`_regNamed('${name}'`);
    }
  });

  it('🔒 F22 · müzik telemetrileri metin/ad TAŞIMAZ (gizlilik allowlist)', () => {
    const files = [
      'src/platform/media/sonic/sonicTelemetry.ts',
      'src/platform/media/radio/smartRadioTelemetry.ts',
      'src/platform/media/loudness/loudnessTelemetry.ts',
      'src/platform/media/transition/transitionTelemetry.ts',
      'src/platform/media/recovery/recoveryTelemetry.ts',
    ];
    const forbidden = ['title:', 'artist:', 'uri:', 'query:', 'utterance:', 'transcript:', 'location:'];
    for (const f of files) {
      const src = read(f);
      expect(src.length, `${f} okunamadı — kilit boş kümeye düştü`).toBeGreaterThan(500);
      for (const bad of forbidden) {
        expect(src, `yasaklı alan ${f} içine sızmış: ${bad}`).not.toContain(bad);
      }
    }
  });

  it('🔒 F22 · yeni müzik önbellekleri SINIRLIDIR (unbounded store yok)', () => {
    const bounded: readonly [string, string][] = [
      ['src/platform/media/sonic/sonicAnalysisRuntime.ts', 'MAX_SONIC_CACHE'],
      ['src/platform/media/loudness/loudnessRuntime.ts', 'MAX_GAIN_CACHE'],
      ['src/platform/media/radio/smartRadioModel.ts', 'MAX_RADIO_LENGTH'],
      ['src/platform/media/radio/smartRadioRuntime.ts', 'MAX_RADIO_SCAN'],
      ['src/platform/media/traits/traitRuntime.ts', 'MAX_TRAIT_CACHE'],
    ];
    for (const [file, cap] of bounded) {
      const src = read(file);
      expect(src, `${file} sınırsız büyüyebilir — ${cap} yok`).toContain(cap);
    }
  });

  /* ── MUSIC · SAHA ÖNCESİ ONARIM (telefonda ÖLÇÜLEN üç kusur) ─────────────
   * Bu üç kilit, gerçek cihazda ölçülmüş kusurların geri gelmesini engeller.
   * Ayrıntılı kilitler `musicPreFieldRepair.test.ts` içindedir; buradakiler
   * kasadaki kalıcı bekçilerdir. */

  it('🔒 F20 · geçiş gözlem alanları köprü/sanitize allowlist\'lerinde KALIR', () => {
    const fields = ['fadeEnabled', 'fadeOutMs', 'fadeInMs',
      'transitionGain', 'transitionActive', 'gaplessSupported'];

    const service = read('android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackService.java');
    expect(service.length, 'servis okunamadı — kilit boş kümeye düştü').toBeGreaterThan(10000);
    const bridge = stripF71(read('android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackBridge.java'));
    const sanitize = stripF71(read('src/platform/media/authority/nativeAuthorityBridge.ts'));

    for (const f of fields) {
      /* Üretilmesi YETMEZ: iki allowlist'ten de GEÇMELİ (ölçülen kusur). */
      expect(bridge, `köprü allowlist'i ${f} alanını düşürüyor`)
        .toContain(`o.put("${f}"`);
      expect(sanitize, `TS sanitize allowlist'i ${f} alanını düşürüyor`)
        .toContain(`${f}:`);
    }
  });

  it('🔒 F3/F21 · açılış geri yüklemesi ÜRETİMDE var, EXACTLY-ONCE ve ÇALMAZ', () => {
    const runtime = read('src/platform/media/session/listeningSessionRuntime.ts');
    expect(runtime.length, 'F3 runtime okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(10000);
    const code = stripF71(runtime);
    expect(code, 'açılış geri yükleme girişi kaldırılmış')
      .toContain('export async function bootRestoreListeningSession');
    expect(code, 'exactly-once kapısı kaldırılmış').toContain('_bootRestoreRan');
    expect(code, 'native canlıyken atlama kapısı kaldırılmış')
      .toContain('NATIVE_SESSION_LIVE');

    /* Kanonik boot sahibi çağırmalı — başka bir component/hook DEĞİL. */
    const boot = stripF71(read('src/platform/system/SystemBoot.ts'));
    expect(boot, 'üretimde açılış geri yükleme çağrısı YOK (asimetrik kalıcılık)')
      .toContain('await bootRestoreListeningSession()');
    const callers = ['src/App.tsx', 'src/hooks/useVoiceCommandHandler.ts'];
    for (const f of callers) {
      let src = '';
      try { src = read(f); } catch { src = ''; }
      expect(src, `${f} açılış geri yüklemesini kendi başına çağırmış`)
        .not.toContain('bootRestoreListeningSession');
    }
    /* Geri yükleme HÂLÂ çalma iddiası üretmez. */
    expect(code).toMatch(/playbackClaim: 'NONE'/);
  });

  it('🔒 F20 · kısa parçada NE fade-out NE fade-in uygulanır', () => {
    const java = stripF71(read('android/app/src/main/java/com/cockpitos/pro/media/CarosPlaybackService.java'));
    const uses = java.match(/MIN_FADE_TRACK_MS/g) ?? [];
    expect(uses.length, 'minimum süre kapısı yalnız tek yönde uygulanıyor')
      .toBeGreaterThanOrEqual(3);
    const inIdx = java.indexOf('private void onTransitionToNewItem');
    expect(inIdx, 'fade-in girişi bulunamadı — kilit kör kalmış').toBeGreaterThan(0);
    const inBody = java.slice(inIdx, inIdx + 1400);
    expect(inBody, 'fade-in kısa parçayı bozuyor').toContain('MIN_FADE_TRACK_MS');
    expect(inBody, 'süre bilinmiyorken fade-in uygulanıyor').toContain('C.TIME_UNSET');
  });
});

describe('🔒 ROTA/FLOW · dekoratif akış katmanı çekirdeği MASKELEYEMEZ (saha 2026-09-06)', () => {
  /* KULLANICI: *"rota çizgisi neden açık mavi · harita uzaklaşınca mavi oluyor,
     kamera zoom yapınca açık mavi oluyor."*

     ÖLÇÜM (kullanıcı ekran görüntüsü, 1 px kesit): şerit `#b0ccf1`. Açık zemin
     çekirdek duraklarının ÜÇÜNDE de R=0'dır (`#006CFF` · `#0057D9` · `#00A6FF`) —
     yani ölçülen R=176 ÇEKİRDEKTEN GELEMEZ; üstünde beyazımsı bir katman vardır.
     Çözülen efektif alfa ≈ 0,68 = **kurulum flow opaklığı 0,85 × pulse tepesi 0,80**.

     KÖK NEDEN: `applyRouteEmphasis` `isStyleLoaded()` kapısında erken dönüyordu.
     O bayrak NAVİGASYON SIRASINDA neredeyse hep `false`'tır (araç işaretçisi ~16 fps
     `setData`, sürekli karo yükleme) — bu dosyada AYNI tuzak daha önce iki kez
     bulunmuştu (`trimRouteGeometry` 2026-08-13 · sürüş kamerası). Tek kurtarma
     yolu `map.once('idle')` idi; sürüşte harita ASLA idle olmaz. */

  it('applyRouteEmphasis `isStyleLoaded` kapısıyla erken DÖNMEZ', () => {
    const i = mapLayerManagerSrc.indexOf('export function applyRouteEmphasis');
    expect(i, 'applyRouteEmphasis bulunamadı — kilit kör kalmış').toBeGreaterThan(0);
    const body = mapLayerManagerSrc.slice(i, i + 5200);
    expect(body, 'sürüşte hiç kurulmayan stil kapısı geri gelmiş — vurgu sessizce uygulanmaz')
      .not.toMatch(/if\s*\(!map\.isStyleLoaded\(\)\)/);
    expect(body, 'opaklık yazımı kaybolmuş').toContain("safeSetPaint(map, ROUTE_FLOW,     'line-opacity', d.flowOpacity)");
  });

  it('ROUTE_FLOW kurulumda GÖRÜNMEZ — otorite karar vermeden çekirdeği örtemez', () => {
    const i = mapLayerManagerSrc.indexOf('id: ROUTE_FLOW');
    expect(i, 'ROUTE_FLOW kurulumu bulunamadı').toBeGreaterThan(0);
    const body = mapLayerManagerSrc.slice(i, i + 900);
    const m = body.match(/'line-opacity':\s*([0-9.]+)/);
    expect(m, 'ROUTE_FLOW kurulum opaklığı okunamadı').not.toBeNull();
    /* `routeLayerModel`in kendi kök kuralı ≥ 0,5'i "flow çekirdeği maskeler" sayar;
       emphasis modelinin yorumu 0,55'i bile "pastel gösteriyor" diye kayıtlamış. */
    expect(Number(m![1]), 'dekoratif akış karar gelmeden çekirdeği maskeleyebilir')
      .toBeLessThanOrEqual(0);
  });

  it('açık zeminde karar edilen akış opaklığı maskeleme eşiğinin ALTINDA', () => {
    const light = resolveRouteEmphasis({ confidence: 'CONFIRMED', navActive: true, lightBasemap: true, altCount: 0 });
    const dark  = resolveRouteEmphasis({ confidence: 'CONFIRMED', navActive: true, lightBasemap: false, altCount: 0 });
    expect(light.flowOpacity, 'gündüz akışı çekirdeği pastel yapacak seviyede').toBeLessThan(0.5);
    expect(dark.flowOpacity, 'gece akışı çekirdeği pastel yapacak seviyede').toBeLessThan(0.5);
    /* Rehberlik yokken süs HIÇ çizilmez. */
    expect(resolveRouteEmphasis({ confidence: 'CONFIRMED', navActive: false, lightBasemap: true, altCount: 0 }).flowOpacity).toBe(0);
  });
});

describe('🔒 NAV-CHROME · harita chrome guneş modu agirligindan MUAF (saha 2026-09-06)', () => {
  /* KULLANICI: *"siyah kalın çerçeveli UI chrome haritadan daha baskın."*
     ÖLÇÜM: kusur bileşen stilinde değildi — `.sunlight-mode button` her düğmeye
     `border: 2px solid #000000` yazıyor ve `sunlight-mode` GÜNDÜZ SAATLERİNDE
     KOŞULSUZ açık (`phase === 'morning' | 'afternoon'`; ortam ışığı sensörü YOK). */
  const css = read('src/index.css');

  it('harita yüzeyi için muafiyet kuralı VAR ve dokunma hedefini KÜÇÜLTMEZ', () => {
    expect(css, 'harita yüzeyi muafiyeti kaldirilmis — chrome yine haritayi ezer')
      .toMatch(/\.sunlight-mode \[data-theme-surface="nav"\] button/);
    const i = css.indexOf('.sunlight-mode [data-theme-surface="nav"] button');
    const body = css.slice(i, i + 260);
    expect(body, 'harita chrome cercevesi hala kalin').toContain('border-width: 1px');
    expect(body, 'muafiyet dokunma hedefini kucultmus — automotive ihlali')
      .not.toMatch(/min-(height|width)/);
  });

  it('güneş okunabilirliği harita DIŞINDA aynen korunur', () => {
    expect(css, 'genel gunes modu cercevesi kaldirilmis — dashboard okunabilirligi kaybolur')
      .toMatch(/\.sunlight-mode button \{[^}]*border: 2px solid #000000/);
    expect(css, 'gunes modu dokunma hedefi kaldirilmis').toMatch(/\.sunlight-mode button \{[^}]*min-height: 52px/);
  });

  it('muafiyet YALNIZ harita yüzeyini hedefler (global sızıntı yok)', () => {
    const lines = css.split(String.fromCharCode(10)).filter((l) => l.includes('data-theme-surface="nav"') && l.trimStart().startsWith('.'));
    expect(lines.length, 'muafiyet kurali bulunamadi').toBeGreaterThan(0);
    for (const l of lines) {
      expect(l, 'muafiyet secicisi sunlight-mode disina cikmis: ' + l).toContain('.sunlight-mode');
    }
  });
});

describe('🔒 NAV-CHROME/2 · kontroller TEK RAY, kartlar TEMAYA bağlı (saha 2026-09-06)', () => {
  /* KULLANICI: *"sol quick destinations çok büyük · sağ controls çok ağır."*
     ÖNCE: sağ kolonda BEŞ ayrı kutu, her birinde kendi dolgu+kenar+gölgesi;
     sol kartlarda SABİT koyu dolgu (`rgba(10,14,26,0.28)`) — gündüz açık
     zeminde koyu blok olarak okunuyordu. */
  const hud = read('src/components/map/MapHudControls.tsx');
  const nav = read('src/components/map/NavigationHUD.tsx');

  it('sağ kontroller TEK ray yüzeyinde toplanır (kenar bir kez çizilir)', () => {
    const i = hud.indexOf('absolute right-4 z-[var(--z-map-label)]');
    expect(i, 'sağ kontrol kolonu bulunamadı — kilit kör kalmış').toBeGreaterThan(0);
    const rail = hud.slice(i - 400, i + 500);
    expect(rail, 'ray kendi yüzeyini kaybetmiş').toContain('--oem-surface-1');
    expect(hud.slice(i, i + 400), 'ray kenarı yok — kontroller yine ayrı kutulara dönmüş')
      .toContain('borderColor');
  });

  it('ray içindeki düğmeler KENDİ yüzeyini/gölgesini taşımaz', () => {
    /* Eski desen: her düğmede `--oem-shadow-card` + `--oem-line-strong`. */
    const i = hud.indexOf('absolute right-4 z-[var(--z-map-label)]');
    const body = hud.slice(i, i + 3200);
    const kutular = body.match(/--oem-shadow-card/g) ?? [];
    expect(kutular.length, 'ray içinde düğme gölgeleri geri gelmiş: ' + kutular.length)
      .toBeLessThanOrEqual(1);
  });

  it('DOKUNMA HEDEFLERİ KÜÇÜLMEDİ (automotive taban)', () => {
    expect(hud, 'sağ kontrol düğme boyutu küçülmüş').toContain('w-12 h-12');
    const css = read('src/index.css');
    expect(css, 'güneş modu 52 px dokunma tabanı kaldırılmış')
      .toMatch(/\.sunlight-mode button \{[^}]*min-height: 52px/);
  });

  it('hızlı hedef kartları SABİT koyu dolgu kullanmaz — tema tokenından gelir', () => {
    const i = nav.indexOf('function QuickCard');
    expect(i, 'QuickCard bulunamadı').toBeGreaterThan(0);
    const body = nav.slice(i, i + 2600);
    expect(body, 'kart dolgusu tema tokenina bağlı değil').toContain('--oem-surface-1');
    expect(body, 'kart yükseklik sınıfı değişmiş (dokunma hedefi)').toContain('h-8');
  });
});

describe('🔒 BOOT-RESILIENCE-1 · beklenmeyen restart tespiti thermalWatchdog kalibrasyonunu EZMEZ', () => {
  it('bootResilienceGuard thermalWatchdog/die eşiklerini İTHAL ETMEZ (ayrı, eklemeli katman)', () => {
    const guard = read('src/platform/system/bootResilienceGuard.ts');
    expect(guard, 'kütük #139/#141 kalibrasyonuna bağımlılık kurulmuş — ayrım bozulmuş')
      .not.toMatch(/^\s*import .*thermalWatchdog/m);
    expect(guard, 'SoC die eşik sabitleri kopyalanmış/kullanılmış — tek kaynak bozulmuş')
      .not.toMatch(/SOC_DIE_L[123]\s*=/);
  });

  it('SystemBoot Wave 1 kararı çağırır ve tek-seferlik downgrade dışında bir şey YAPMAZ', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot, 'evaluateBootResilience Wave 1\'de çağrılmıyor').toContain('evaluateBootResilience(Date.now())');
    expect(boot, 'heartbeat başlatıcı LIFO cleanup\'a kaydedilmemiş').toContain("this._regNamed('BootResilienceGuard', startBootHeartbeat())");
    /* Paylaşılan tavan (setPowerCeiling) İCAT EDİLMEDİ — mevcut çok-çağıranlı
       setMode kullanılıyor, thermal ile aynı slotu ele geçirmiyor. */
    expect(boot, 'boot-resilience yeni bir paylaşılan tavan kurmuş — thermal ile çakışabilir')
      .not.toMatch(/setPowerCeiling.*boot-resilience|boot-resilience.*setPowerCeiling/s);
  });

  it('heartbeat yazımı throttle\'lı — her poll\'de DEĞİL (eMMC ömrü, CLAUDE.md §3)', () => {
    const guard = read('src/platform/system/bootResilienceGuard.ts');
    expect(guard).toMatch(/HEARTBEAT_WRITE_INTERVAL_MS\s*=\s*60_000/);
  });
});

describe('🔒 P0-A · termal raster mandalı açılış FPS düşüşünü "termal olay" SAYMAZ', () => {
  /* KANIT (cihaz · 2026-09-06 · Xiaomi 23090RA98I · trace-before-final.json):
       tileRender-intent  vector → raster  thermalLock=true   deviceTier='high'
       tileRender-intent  raster → vector  thermalLock=false  (+3442 ms)
     Çağıran yığın: FullMapView → mapSourceManager.notifyLowFPS.
     Sonuç: aynı GÜNDÜZ durumunda Vector → OSM Map → Vector parlaması. */

  it('tek düşük örnek mandalı KAPATMAZ; kanıt ardışık örnekle oluşur', () => {
    let st = { latched: false, lowStreak: 0 };
    for (let i = 1; i < FPS_LOW_CONFIRM_SAMPLES; i++) {
      const d = evaluateFpsThermalLatch({ fps: 8, latched: st.latched, lowStreak: st.lowStreak, surfaceSettling: false });
      expect(d.latched, `${i}. örnekte erken mandal`).toBe(false);
      expect(d.changed).toBe(false);
      st = { latched: d.latched, lowStreak: d.lowStreak };
    }
    const last = evaluateFpsThermalLatch({ fps: 8, latched: st.latched, lowStreak: st.lowStreak, surfaceSettling: false });
    expect(last.latched, 'gerçek termal olay artık yakalanmıyor — koruma öldü').toBe(true);
    expect(last.changed).toBe(true);
  });

  it('yüzey otururken (harita READY değil / stil değişiyor) örnek KANIT SAYILMAZ', () => {
    let st = { latched: false, lowStreak: 0 };
    for (let i = 0; i < FPS_LOW_CONFIRM_SAMPLES + 3; i++) {
      const d = evaluateFpsThermalLatch({ fps: 3, latched: st.latched, lowStreak: st.lowStreak, surfaceSettling: true });
      expect(d.latched, 'açılış penceresi termal olay sayıldı — raster parlaması geri geldi').toBe(false);
      expect(d.lowStreak, 'kurulum penceresinde seri birikiyor').toBe(0);
      st = { latched: d.latched, lowStreak: d.lowStreak };
    }
  });

  it('iyi örnek seriyi sıfırlar; bırakma kenarı bir kez bildirilir', () => {
    const mid = evaluateFpsThermalLatch({ fps: 5, latched: false, lowStreak: FPS_LOW_CONFIRM_SAMPLES - 2, surfaceSettling: false });
    expect(mid.latched).toBe(false);
    const good = evaluateFpsThermalLatch({ fps: FPS_LOW_THRESHOLD, latched: false, lowStreak: mid.lowStreak, surfaceSettling: false });
    expect(good.lowStreak).toBe(0);
    expect(good.changed, 'mandal kapalı değilken boşuna bildirim').toBe(false);
    const release = evaluateFpsThermalLatch({ fps: 60, latched: true, lowStreak: 0, surfaceSettling: false });
    expect(release.latched).toBe(false);
    expect(release.changed, 'kurtarma kenarı bildirilmiyor — harita raster’da kalır').toBe(true);
  });

  it('FullMapView ham `fps < 20` kenarını DEĞİL, saf modeli kullanır (tek karar yeri)', () => {
    expect(fullMapViewSrc, 'FPS mandalı kararı tekrar bileşenin içine gömülmüş')
      .toContain('evaluateFpsThermalLatch({');
    expect(fullMapViewSrc, 'kurulum/stil penceresi kanıt dışı bırakılmamış')
      .toMatch(/surfaceSettling:\s*!mapStyleReadyRef\.current \|\| styleChangingRef\.current/);
    expect(fullMapViewSrc, 'eski tek-örnek kenarı geri gelmiş')
      .not.toMatch(/const fpsIsLow = fps < 20;/);
  });
});

describe('🔒 P0-B · sürüş girişinde TEK kamera üreticisi', () => {
  /* KANIT (cihaz · 2026-09-06): aynı hedefe (~zoom 18 / pitch 38 / bearing 69.6 /
     1000 ms) 6 ms arayla İKİ `easeTo`. Üretici: `requestFollow` zaten
     `enterNavigationView` çağırıyordu; effect'ler bir de DOĞRUDAN çağırıyordu. */

  it('drivingMode / navStatus / handleNavStart yolları doğrudan enterNavigationView ÇAĞIRMAZ', () => {
    const idx = fullMapViewSrc.indexOf('const handleNavStart');
    expect(idx, 'handleNavStart bulunamadı — kilit kör kalmış').toBeGreaterThan(0);
    expect(fullMapViewSrc.slice(idx, idx + 260), 'nav başlangıcı ikinci kamera komutu üretiyor')
      .not.toContain('enterNavigationView');
    const drv = fullMapViewSrc.indexOf('if (drivingMode) requestFollow(');
    expect(drv, 'sürüş girişinin tek üretici yolu bozulmuş').toBeGreaterThan(0);
  });

  it('stil yaşam döngüsü (style.load) kamerayi SÜRMEZ', () => {
    const idx = fullMapViewSrc.indexOf('const _onStyleReady');
    expect(idx, '_onStyleReady bulunamadı — kilit kör kalmış').toBeGreaterThan(0);
    const body = fullMapViewSrc.slice(idx, idx + 1800);
    expect(body, 'stil yüklemesi kamera komutu üretiyor (recenter/zoom sıfırlama)')
      .not.toMatch(/enterNavigationView|setMapCenter/);
  });

  it('programatik MapLibre olayı kullanıcı hareketi SAYILMAZ (originalEvent kanıtı)', () => {
    const bind = read('src/platform/map/bindMapUserInteraction.ts');
    expect(bind, 'giriş kanıtı aranırken originalEvent kapısı kalkmış').toContain('event.originalEvent');
    for (const f of ['src/components/map/FullMapView.tsx', 'src/components/map/MiniMapWidget.tsx']) {
      expect(read(f), `${f} pan/zoom olaylarını ortak kapı olmadan bağlıyor`)
        .toContain('bindMapUserInteraction(');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   🔒 MAPDATA-F4 · MEVCUT VERİ STİLDE KAYBOLMASIN
   ══════════════════════════════════════════════════════════════════════════
   ÖLÇÜLEN KUSUR (7 Eylül 2026, `field-runs/map-data-coverage-20260907`):
   üretim karosunda `housenumber` kaynak katmanı VARDI (merkez z14 karosunda 7
   kayıt, çekirdek alanda 3 ve üçü de upstream OSM kayıtlarıyla eşleşiyordu)
   ama stilde HİÇBİR tüketici yoktu. Yani veri boru hattında değil, SON ADIMDA
   kayboluyordu — bu kusur sessizdir: log yok, hata yok, yalnız eksik ekran.

   Bu kilit aynı sessiz kusurun geri gelmesini engeller.
   ══════════════════════════════════════════════════════════════════════════ */
describe('🔒 MAPDATA-F4 · karoda var olan veri stilde tüketiliyor', () => {
  const _localSource = new Map([['local', {
    id: 'local', name: 'local', type: 'offline' as const, description: '', isAvailable: true,
  }]]);
  const _styleFor = async (night: boolean) => {
    const { buildVectorStyle } = await import('../platform/mapStyleBuilders');
    return buildVectorStyle(_localSource as never, () => {
      throw new Error('raster fallback bu kilidin konusu değil');
    }, night) as unknown as {
      layers: { id: string; 'source-layer'?: string; layout?: Record<string, unknown> }[];
    };
  };

  it('`housenumber` kaynak katmanının bir tüketicisi VAR ve doğru alanı okur', async () => {
    for (const night of [false, true]) {
      const style = await _styleFor(night);
      const layer = style.layers.find((l) => l.id === 'housenumber');
      expect(layer, `housenumber tüketicisi kaldırılmış (night=${night})`).toBeDefined();
      expect(layer!['source-layer']).toBe('housenumber');
      /* UYDURMA YASAĞI: numara yalnız kaynak alandan okunur — bina
         poligonundan, sokak adından veya interpolasyondan TÜRETİLMEZ. */
      expect(JSON.stringify(layer!.layout?.['text-field'])).toBe('["get","housenumber"]');
      /* ÖLÇÜLDÜ: upstream `housenumber` alanına telefon numarası yazılmış
         kayıt VAR (32 kayıttan 1'i). Uzunluk filtresi olmadan harita onu
         kapı numarası gibi basar. */
      expect(JSON.stringify(layer!.filter ?? null), 'kapı numarası filtresi kalkmış')
        .toContain('length');
    }
  });

  it('kapı numarası yerel sokak adının çakışma önceliğini ÇALMAZ', async () => {
    const { LABEL_VISIBILITY } = await import('../platform/mapStyleBuilders');
    const style = await _styleFor(false);
    const idxOf = (id: string) => style.layers.findIndex((l) => l.id === id);
    /* MapLibre yerleşimi listeyi SONDAN tarar → önce gelen ÖNCELİKSİZDİR. */
    expect(idxOf('housenumber')).toBeGreaterThanOrEqual(0);
    expect(idxOf('housenumber')).toBeLessThan(idxOf('road-label'));
    expect(LABEL_VISIBILITY.housenumber).toBeGreaterThan(LABEL_VISIBILITY['road-label']);
  });

  it('kapı numarası bir gürültü otoritesine AİT (sahipsiz katman yok)', async () => {
    const { DECLUTTER_OWNED_LAYERS } = await import('../platform/map/core/mapDeclutterModel');
    expect(DECLUTTER_OWNED_LAYERS).toContain('housenumber');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   🔒 QA + MAPDATA GAP OBSERVATORY · SETUP YOLU VE TRUTH SINIRI
   ══════════════════════════════════════════════════════════════════════════ */
describe('🔒 QA + MAPDATA · guard setup yolu ve Gap Observatory sınırı', () => {
  it('Vitest setup yolu çalışma dizinine değil config dosyasına sabitlenir', () => {
    const config = read('vitest.config.ts');
    expect(config).toContain("fileURLToPath(new URL('./src/__tests__/setup.ts', import.meta.url))");
    expect(config).not.toMatch(/setupFiles:\s*\[\s*['"]src\/__tests__\/setup\.ts['"]\s*\]/);
  });

  it('PotentialBuildingGap publishable değildir ve üretim otoritelerine yazamaz', () => {
    const detector = read('src/platform/mapdata/resolvers/buildingGapDetector.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(detector).toContain('readonly publishable: false');
    expect(detector).toContain('publishable: false');
    for (const re of [/\bmapStore\s*\./i, /\bfuseBuildings\s*\(/,
      /\bresolveBuilding\w*\s*\(/, /\bmaplibre\b/i,
      /\brouting\w*\s*\./i, /\bceh\w*\s*\./i,
      /\bsetInterval\s*\(/, /\bsetTimeout\s*\(/]) {
      expect(`${re.source}:${re.test(detector)}`).toBe(`${re.source}:false`);
    }
  });

  it('LAB veri akışı yokken 0 uydurmaz ve sınırı ekranda ilan eder', () => {
    const sources = read('src/platform/devtools/mapDataSources.ts');
    const screen = read('src/components/devtools/screens/MapDataPlatformScreen.tsx');
    expect(sources).toContain('gapEvidence: readonly PotentialBuildingGap[] | null = null');
    expect(sources).toContain('observePotentialBuildingGaps(gapEvidence)');
    expect(screen).toContain('GAP EVIDENCE ≠ MAP TRUTH');
    expect(screen).toContain('data-publishable="false"');
    expect(screen).toContain('Evidence akışı bağlı değilse sayılar UNKNOWN kalır');
  });
});

describe('🔒 RTG4 BÖLGESEL VERİ · tek dağıtım/registry otoritesi ve dayanıklılık sırası', () => {
  /* NEDEN: registry ikinci bir modülden yazılırsa "kurulu generation" için iki
     gerçek doğar; çökme sonrası hangisinin kazanacağı belirsizleşir. Kilit
     kaynak metni değil, DOSYA KÜMESİNİ tarar → yeni bir yazar eklenirse düşer. */
  it('installed-regions.json yalnız kanonik dağıtım otoritesi tarafından yazılır', () => {
    const roots = ['src'];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(resolve(dir), { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (read(full).includes('installed-regions.json')) hits.push(full.replace(/\\/g, '/'));
      }
    };
    roots.forEach(walk);
    /* Kör guard koruması: küme BOŞ olamaz — boşsa kilit hiçbir şeyi korumuyordur. */
    expect(hits.length).toBeGreaterThan(0);
    const writers = hits.filter((path) => !path.includes('__tests__'));
    expect(writers).toEqual(['src/platform/navigation/map/graph/regionalDataDistribution.ts']);
  });

  /* NEDEN: tamamlanma imzası artefaktlardan ÖNCE yazılırsa çökme sonrası yarım
     generation READY görünür. Sıra bozulursa bu kilit düşer. */
  it('tamamlanma imzası yayınlanmış artefaktlar doğrulandıktan SONRA yazılır', () => {
    const src = read('src/platform/navigation/map/graph/regionalDataDistribution.ts');
    const verify = src.indexOf("throw new Error('PUBLISHED_VERIFY')");
    const marker = src.indexOf('const markerNext =');
    const registryNext = src.indexOf('async function publishRegistry');
    expect(verify).toBeGreaterThan(0);
    expect(marker).toBeGreaterThan(verify);
    expect(registryNext).toBeGreaterThan(0);
    /* Registry yayını imzadan bağımsız bir yardımcıdır ve `.next` + rename kullanır. */
    expect(src).toContain('await writeText(next, JSON.stringify(value))');
    expect(src).toContain('await remove(REGISTRY); await rename(next, REGISTRY)');
  });

  /* NEDEN: yeniden doğrulama reddi bir SİLME sebebine dönüşürse geçici bir okuma
     hatası son iyi kopyayı yok eder. Yalnız imzasız artık toplanabilir. */
  it('rebuild yalnız imzasız artıkları toplar; reddedilen generation silinmez', () => {
    const src = read('src/platform/navigation/map/graph/regionalDataDistribution.ts');
    const pushes = src.match(/discardable\.push\(/g) ?? [];
    expect(pushes.length).toBe(1);
    expect(src).toContain('orphanGenerations++; discardable.push(');
    expect(src).toContain('if (activeDownloads > 0) return;');
  });
});
