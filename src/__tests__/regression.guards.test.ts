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
import proLayoutSrc from '../components/themes/ProLayout.tsx?raw';
import teslaLayoutSrc from '../components/themes/TeslaLayout.tsx?raw';
import volumeGestureLayerSrc from '../components/common/VolumeGestureLayer.tsx?raw';
import companionChatProviderSrc from '../platform/companion/companionChatProvider.ts?raw';
import vehicleResolverSrc from '../platform/vehicleDataLayer/VehicleSignalResolver.ts?raw';
import visionCoreSrc from '../platform/vision/visionCore.ts?raw';
import offlineRoutingSrc from '../platform/offlineRoutingService.ts?raw';
import deviceCapabilitiesSrc from '../platform/deviceCapabilities.ts?raw';
import pushServiceSrc from '../platform/pushService.ts?raw';
import commandListenerSrc from '../platform/commandListener.ts?raw';
import fcmServiceSrc from '../platform/fcmService.ts?raw';
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

  it('YAPISAL: _playMusicInAppOrFallback playByQuery ile arar, başarısızsa fallback() çağırır', () => {
    const src = read('src/platform/commandExecutor.ts');
    const i = src.indexOf('async function _playMusicInAppOrFallback');
    const fn = src.slice(i, i + 1000);
    expect(fn).toMatch(/playByQuery/);
    expect(fn).toMatch(/fallback\(\)/);
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
    const fn = src.slice(src.indexOf('export function startListening'),
                         src.indexOf('export function startListening') + 1300);
    expect(fn).toMatch(/ttsCancel\(\)/);
  });

  it('YAPISAL: _dispatchConversation sabit setTimeout(idle) İÇERMEZ; TTS bitişine bağlı', () => {
    const src = vs();
    const start = src.indexOf('function _dispatchConversation');
    const fn = src.slice(start, src.indexOf('\n}', start));
    expect(fn).not.toMatch(/setTimeout/);          // 3.5s sabit timer kaldırıldı
    expect(fn).toMatch(/_armConvIdleOnTtsEnd/);    // idle artık TTS-end yolundan
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
    expect(src).toMatch(/_looksLikeAiRequest/);
    expect(src).toMatch(/chain\.length === 0 && _looksLikeAiRequest/);  // koşul: zincirde HİÇ anahtar YOK
    expect(src).toMatch(/Gemini ya da Claude Haiku/);                   // her iki sağlayıcı önerilir
    expect(src).toMatch(/ai_key_missing_hint/);                         // tanı rotası
  });

  it('YAPISAL: yönlendirme AUTO-DISPATCH ve GEMINI FIRST\'ten ÖNCE (sahte komut öne geçmesin)', () => {
    const src = vs();
    const hintIdx = src.indexOf('_looksLikeAiRequest(trimmed)');
    const geminiFirstIdx = src.indexOf('2. GEMINI FIRST');
    const autoDispatchIdx = src.indexOf('Yüksek güven yerel komut');
    expect(hintIdx).toBeGreaterThan(0);
    expect(hintIdx).toBeLessThan(geminiFirstIdx);                       // beyin bloğundan önce
    expect(hintIdx).toBeLessThan(autoDispatchIdx);                     // yerel auto-dispatch'ten önce
  });

  it('YAPISAL: exact (1.0) gerçek komutlar korunur — yönlendirme yalnız <1.0\'da', () => {
    const src = vs();
    expect(src).toMatch(/_looksLikeAiRequest\(trimmed\) && \(result\.command\?\.confidence \?\? 0\) < 1\.0/);
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
    const block = brainSrc.match(/const BRAIN_INTENTS\s*=\s*new Set<[^>]*>\(\[([\s\S]*?)\]\)/);
    expect(block, 'BRAIN_INTENTS bloğu bulunamadı').toBeTruthy();
    const intents = [...block![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
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
    expect(fn![0], 'grounding hatası _groundingCooldownUntil kurmalı (Tavily yedeği)').toMatch(/_groundingCooldownUntil\s*=/);
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

  it('YAPISAL: cevap uzunluğu park halinde SABİT 300 karakter/220 token ile kesilmez', () => {
    // SAHA 2026-07-24 ("uzun anlatımlar yarıda kesiliyor"): İKİ ayrı tavan vardı.
    // (1) maxOutputTokens=220 → cihazda ÖLÇÜLDÜ: `finishReason=MAX_TOKENS`, metin
    //     "…5. İç Anadolu Bölgesi:" diye CÜMLE ORTASINDA bitiyor (bazen metin BOŞ);
    //     1200 token ile aynı soru `finishReason=STOP` + 970-1058 karakter TAM cevap.
    // (2) Metin ayrıca 300 karakterde kırpılıyordu (`flat.slice(0,297)+'...'`) →
    //     token açılsa bile cevap üçte birine iniyordu.
    // SÜRÜŞ tavanları KORUNUR (ISO 15008 dikkat bütçesi) — kilit yalnız PARK'ı savunur.
    expect(src, 'ANSWER_TOKENS tek kapısı kaldırılmış — token bütçeleri yine dağınık sabit').toMatch(/ANSWER_TOKENS/);
    expect(src, 'ANSWER_CHAR_LIMIT kaldırılmış — seslendirme tavanı yine sabit 300').toMatch(/ANSWER_CHAR_LIMIT/);
    // Sabit 300/297 kırpma deseni GERİ GELMEMELİ.
    expect(src, 'sabit 297 karakter kırpması geri gelmiş — park halinde uzun anlatım yine üçte birine iner').not.toMatch(/slice\(0,\s*297\)/);
    // Park bütçeleri sürüş bütçelerinden belirgin BÜYÜK olmalı.
    const tok = src.match(/const ANSWER_TOKENS = \{([\s\S]*?)\n\} as const;/);
    expect(tok, 'ANSWER_TOKENS tanımı bulunamadı').toBeTruthy();
    const pairs = [...tok![1].matchAll(/driving:\s*(\d+),\s*parked:\s*(\d+)/g)];
    expect(pairs.length, 'ANSWER_TOKENS içinde driving/parked çifti yok').toBeGreaterThanOrEqual(4);
    for (const p of pairs) {
      expect(Number(p[2]), `park token bütçesi (${p[2]}) uzun anlatıma yetmiyor — MAX_TOKENS ile yarıda keser`).toBeGreaterThanOrEqual(800);
      expect(Number(p[2])).toBeGreaterThan(Number(p[1]));
    }
    const chars = src.match(/const ANSWER_CHAR_LIMIT = \{ driving: (\d+), parked: (\d+) \}/);
    expect(chars, 'ANSWER_CHAR_LIMIT tanımı bulunamadı').toBeTruthy();
    expect(Number(chars![1]), 'sürüş karakter tavanı gevşetilmiş — dikkat bütçesi (ISO 15008) ihlali').toBeLessThanOrEqual(400);
    expect(Number(chars![2]), 'park karakter tavanı hâlâ düşük — uzun anlatım kırpılır').toBeGreaterThanOrEqual(1500);
    // Beyin JSON yolu da bağlama duyarlı tavanı KULLANMALI (en kritik yol).
    expect(src, 'parseBrainJson bağlam almıyor — beyin cevabı yine sabit tavanla kırpılır').toMatch(/function parseBrainJson\(raw: string, isDriving/);
    expect(src, 'beyin cevabı trimForSpeech\'ten geçmiyor').toMatch(/response: trimForSpeech\(obj\.say, isDriving\)/);
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
    const vs = read('src/platform/voiceService.ts');
    expect(vs, 'voiceService isTtsSpeaking\'i import etmiyor — emniyet zamanlayıcıları yine kör').toMatch(/isTtsSpeaking/);
    for (const [fn, label] of [
      ['_scheduleFollowUpFallback', 'takip dinlemesi'],
      ['_scheduleConvIdleFallback', 'sohbet-idle'],
    ] as const) {
      const body = vs.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
      expect(body, `${fn} bulunamadı`).toBeTruthy();
      expect(body![0], `${label} penceresi konuşma sürerken uzatmıyor → uzun cevap yine ortadan kesilir`).toMatch(/isTtsSpeaking\(\)/);
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
    const geminiAssigns = [...src.matchAll(/_rateLimitedUntil\s*=\s*_now\(\)\s*\+\s*([^;]+);/g)];
    expect(geminiAssigns.length, 'Gemini 429 ataması bulunamadı').toBeGreaterThanOrEqual(2);
    for (const m of geminiAssigns) {
      expect(m[1], 'Gemini 429 penceresi Google\'ın retryDelay\'ini kullanmalı (_cooldownFrom429) — sabit 60sn asistanı gereksiz uzun offline bırakır').toContain('_cooldownFrom429');
    }
    expect(src, 'Groq 429 kendi penceresini kurmalı (_groqRateLimitedUntil)').toMatch(/_groqRateLimitedUntil\s*=\s*_now\(\)/);
    expect(src, 'Haiku 429 kendi penceresini kurmalı (_haikuRateLimitedUntil)').toMatch(/_haikuRateLimitedUntil\s*=\s*_now\(\)/);
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
    expect(src).toMatch(/cand\.provider === 'gemini' && _now\(\) < _rateLimitedUntil\)\s*\{ skippedByCooldown = true; continue; \}/);
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

  it('YAPISAL: beyin AYAR komutlarını (SET_SETTING) üretebilir + sahte onay YASAK — "açıyorum" deyip iş yapmama önlemi', () => {
    const brain = read('src/platform/companion/companionChatProvider.ts');
    // SET_SETTING (parlaklık/wifi/bluetooth) + yaygın eylemler beyin sözlüğünde OLMALI —
    // yoksa beyin bu komutları sahte "açıyorum" ile geçiştiriyordu (SAHA 2026-07-03).
    expect(brain).toMatch(/'SET_SETTING'/);
    expect(brain).toMatch(/'OPEN_FAVORITES', 'ENABLE_DRIVING_MODE', 'TOGGLE_SLEEP_MODE'/);
    // parseBrainJson setting alanlarını taşımalı (yoksa parlaklık yönü kaybolur → no-op)
    expect(brain).toMatch(/settingKey:\s+typeof obj\.settingKey/);
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
    expect(s, 'seyahat satırı isNavigating + etaSeconds kapısını kaybetmiş').toMatch(/\{isNavigating && etaSeconds != null && etaSeconds > 0 && \(/);
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
    // TS tarafı: otorite bayrağı reconnect tetikleyen HER üç yolu da kapatmalı.
    expect(obdServiceSrc, '_nativeReconnectInFlight kaldırılmış — native reconnect sürerken TS karışabilir')
      .toMatch(/_nativeReconnectInFlight/);
    const guards = obdServiceSrc.match(/if\s*\(\s*_nativeReconnectInFlight\s*\)\s*return/g) ?? [];
    expect(guards.length, 'otorite guard\'ı 3 yolda da (status listener + stale watchdog + data gate) olmalı')
      .toBeGreaterThanOrEqual(3);
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
    // Üç okuma da kapıya bağlı olmalı — biri unutulursa tema yine bayat gösterir
    expect(src).toContain('obdLive && obdRpm');
    expect(src).toContain('obdLive && obdTemp');
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

  it('🔒 HUD şeridi ANLIK yakıtı "varışta" diye ETİKETLEMEZ', () => {
    // Değer `UnifiedVehicleStore.fuel` (anlık); varış tahmini hiç hesaplanmıyor.
    expect(navigationHudSrc).not.toContain('Varışta yakıt');
    expect(navigationHudSrc).toContain("{fuelPct != null ? `%${Math.round(fuelPct)}` : '—'}");
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

  it('🔒 dar ekranda şerit kartı ve "Sonra …" satırı GİZLENİR', () => {
    // İkisi birlikte ~138 px yiyordu; yön bilgisi üstteki ok döşemesinde duruyor.
    expect(navigationHudSrc).toContain('{!dense && <LaneGuidance step={step} />}');
    expect(navigationHudSrc).toContain('{!dense && continuation && nextStep && (');
  });

  it('🔒 `dense` GÜVENLİK modlarıyla KARIŞTIRILMAZ', () => {
    /* `compact` = CRITICAL/LIMP_HOME (bilişsel yük azaltma, güvenlik kararı),
       `dense` = yalnız yerleşim. Birleştirilirse dar ekran sessizce güvenlik
       modu sanılır ve alanlar gizlenir. Üçü de AYRI prop olarak taşınmalı. */
    expect(navigationHudSrc).toMatch(/compact\s*=\s*false,\s*limp\s*=\s*false,\s*\n\s*dense\s*=\s*false,/);
    expect(navigationHudSrc).toContain('dense={denseHud}');
    expect(navigationHudSrc).not.toContain('compact={denseHud}');
  });

  it('🔒 head unit ölçüleri DEĞİŞMEDİ (eşiğin üstünde eski değerler)', () => {
    // Dar-ekran değerleri eklenirken HU değerleri korunmalı — yoksa 7"/10"
    // ünitelerde HUD sebepsiz küçülür (okunabilirlik regresyonu).
    expect(navigationHudSrc).toContain('width: dense ? 208 : 288');
    expect(navigationHudSrc).toContain("padding: dense ? '9px 11px' : '14px 18px'");
    expect(navigationHudSrc).toContain('width: dense ? 32 : 46');
    expect(navigationHudSrc).toContain("fontSize: dense ? 23 : 'clamp(28px, 4.2vw, 42px)'");
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
    const relaxIdx  = src.indexOf('for (const variant of relaxQueryVariants(query))');
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
    expect(mapServiceSrc).toMatch(/filterNumberedStreetMismatch\([\s\S]{0,300}_gate\(onlineHits/);
    expect(mapServiceSrc).toContain('combined.push(...onlineGated)');
  });

  it('🔒 `searchPlaces` sonuç yoksa Overpass sokak aramasına düşer', () => {
    expect(mapServiceSrc).toContain('searchStreetByName');
    expect(mapServiceSrc).toMatch(/if \(combined\.length === 0\)[\s\S]{0,120}searchStreetByName\(query, userLat, userLng\)/);
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
    expect(navigationHudSrc).toContain("const digitColor = (overSpeed || isIntv) ? '#f87171'");
    expect(navigationHudSrc).toMatch(/isCaution \? '#fbbf24'\s*\n\s*: 'var\(--oem-ink/);
    // Sabit beyaza dönüş = regresyon
    expect(navigationHudSrc).not.toMatch(/isCaution \? '#fbbf24'\s*\n\s*: '#ffffff'/);
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
    expect(mapInteractionManagerSrc).toMatch(/if \(framed && oriented\) \{[\s\S]{0,400}?return;/);
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
    expect(src).toContain('const _zoomEff = _standstillFix ? map.getZoom()    : _zoom;');
    expect(src).toContain('const _pitchEff = _standstillFix ? map.getPitch()  : _pitch;');
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
  it('🔒 zoom kolonu dar ekranda hız panelinin ALTINA çapalanır', () => {
    /* Alttan çapa kısa ekranda yukarı taşıp hız panelinin üstüne biniyordu.
       Hız paneli: top = sat+80, yükseklik 66 → 12 px boşlukla 158. */
    expect(mapHudControlsSrc).toContain("? { top: 'calc(var(--sat, 0px) + 158px)' }");
    // Head unit yolu DEĞİŞMEMELİ — yüksek ekranda eski alttan çapa korunur
    expect(mapHudControlsSrc).toContain(": { bottom: 'calc(var(--lp-dock-h,68px) + 96px)' }");
  });

  it('🔒 dönüş kartı dar ekranda GPS rozeti/km çipini ÖRTMEZ', () => {
    // Çipin sağ kenarı 91 px → kart 96'dan başlar
    expect(navigationHudSrc).toContain("left: dense ? 'max(96px, var(--sal, 0px))'");
    // Head unit değeri korunur
    expect(navigationHudSrc).toContain(": 'max(16px, var(--sal, 0px))'");
  });

  it('🔒 yerleşim aritmetiği tutarlı: kart genişliği sığar', async () => {
    /* Dar ekran kart genişliği 208 px, sol kenar 96 → sağ kenar 304.
       Ortadaki yol tabelası 382'de başlıyor → çakışma yok. */
    expect(navigationHudSrc).toContain('width: dense ? 208 : 288');
    expect(96 + 208).toBeLessThan(382);
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

  it('🔒 hız aşılınca levha KIRMIZI olur, dar ekranda hızın SOLUNA geçer', () => {
    expect(speedLimitCardSrc).toContain("overSpeed ? '#dc2626' : '#ffffff'");
    expect(navigationHudSrc).toContain("dense ? 'flex-row-reverse' : 'flex-col'");
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
    expect(src).toMatch(/if \(framed && oriented\) \{[\s\S]{0,400}?return;/);
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
    // Kanıt yoksa panel HİÇ çıkmaz.
    expect(hud).toMatch(/if \(!lanes \|\| lanes\.length === 0\) return null;/);
  });

  it('🔒 DÖNEL KAVŞAK çıkışı yalnız KANITLIYSA söylenir', () => {
    const rs = read('src/platform/routingService.ts');
    expect(rs, 'maneuver.exit ayrıştırması kaldırılmış').toMatch(/maneuver\.exit/);
    // Sayı yoksa genel ifadeye düşülür — uydurulmaz.
    expect(rs).toContain("'Dönel kavşakta devam edin'");
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

  it('🔒 ilerleme motoru GÖRÜNÜMDE değil, boot servisindedir', () => {
    const boot = read('src/platform/system/SystemBoot.ts');
    expect(boot).toContain('this._reg(startNavigationSessionRuntime());');
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
      ['src/components/map/FullMapView.tsx',         'USER_MAP'],
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
    // Sabit `false`: native canlılık sinyali eklenmeden `true` OLAMAZ.
    expect(src).toMatch(/livenessMeasured:\s*false/);
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
    expect(geo).toMatch(/gate\(await premiumGeocode/);
    expect(geo).toContain('gate(firstOk)');
    expect(geo).toMatch(/gate\(ok\.map/);
    expect(geo).toMatch(/gate\(await searchStreetByName/);
    expect(geo).toMatch(/gate\(await _offlineFallback/);
  });

  it('🔒 kapı bir katmanı boşaltırsa MERDİVEN DURMAZ', () => {
    const geo = src('platform/geocodingService.ts');
    /* Yanlış şehirdeki bir Nominatim cevabı, gevşetme ve Overpass son şansını
       iptal ettiremez — aksi hâlde kapı zinciri KISALTMIŞ olurdu. */
    expect(geo).toMatch(/const firstGated = gate\(firstOk\);\s*\n\s*if \(firstGated\.length\)/);
    expect(geo).not.toMatch(/if \(firstOk\.length\) return done\(firstOk/);
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
