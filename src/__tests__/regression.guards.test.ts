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
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/* Kaynak-metin kilitleri için içeriği runtime `readFileSync` yerine Vite `?raw`
   ile TRANSFORM anında gömüyoruz. Sebep: full-suite paralel koşuda `read()`
   commandExecutor.ts'i nadiren eksik görüp "İki router ayrışması" kilidini
   yanlışlıkla düşürüyordu (izole hep geçiyordu). `?raw` içeriği build-time'da
   sabitler → runtime fs yarışına/mock'a/kısmi okumaya PROVABLY bağışık. */
import commandExecutorSrc from '../platform/commandExecutor.ts?raw';
import companionChatProviderSrc from '../platform/companion/companionChatProvider.ts?raw';
import vehicleResolverSrc from '../platform/vehicleDataLayer/VehicleSignalResolver.ts?raw';
import visionCoreSrc from '../platform/vision/visionCore.ts?raw';
import offlineRoutingSrc from '../platform/offlineRoutingService.ts?raw';
import deviceCapabilitiesSrc from '../platform/deviceCapabilities.ts?raw';
import pushServiceSrc from '../platform/pushService.ts?raw';
import fcmServiceSrc from '../platform/fcmService.ts?raw';
import obdServiceSrc from '../platform/obdService.ts?raw';
import mainLayoutSrc from '../components/layout/MainLayout.tsx?raw';
import vehicleComputeWorkerSrc from '../platform/vehicleDataLayer/VehicleCompute.worker.ts?raw';
import vehicleEventHubSrc from '../platform/vehicleDataLayer/VehicleEventHub.ts?raw';
import systemOrchestratorSrc from '../platform/system/SystemOrchestrator.ts?raw';
import healthMonitorSrc from '../platform/system/SystemHealthMonitor.ts?raw';
import orientationGateSrc from '../platform/sensors/orientationSensorGate.ts?raw';
import remoteLogServiceSrc from '../platform/remoteLogService.ts?raw';
import diagnosticTriageSrc from '../platform/diagnosticTriage.ts?raw';
import dtcServiceSrc from '../platform/dtcService.ts?raw';
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
    expect(src).toMatch(/registerTtsEndListener,\s*ttsCancel\s*\}/); // import edildi
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
    expect(src, 'sawNetFailure ayrımı kaldırılmış (sağlayıcı hatası yine ağ hatası sayılıyor olabilir)').toMatch(/if \(sawNetFailure\) recordAiNetFailure\(\)/);
    const assignments = [...src.matchAll(/sawNetFailure = true/g)];
    expect(assignments.length, 'sawNetFailure set eden yol yok — throw yolu kesiciye hiç sayılmıyor').toBeGreaterThanOrEqual(2);
    // Her set YALNIZ catch içinde olmalı (throw = gerçek ağ hatası)
    const inCatch = [...src.matchAll(/catch \{[^}]*sawNetFailure = true/g)];
    expect(inCatch.length, 'sawNetFailure = true catch DIŞINDA set ediliyor → HTTP-yanıtlı sağlayıcı hatası yine "internet yok" sayılır').toBe(assignments.length);
    // Eski isim geri gelmesin (null-yollarında sayan desen)
    expect(src, 'eski sawFailure deseni geri gelmiş').not.toMatch(/\bsawFailure\b/);
  });

  it('YAPISAL: repairMusicQuery catch BEYİN kesicisini BESLEMEZ (mikro-bütçe timeout ≠ ağ ölümü)', () => {
    // SAHA 2026-07-04 ("ilk istek online, sonrakiler offline"): 1.8sn mikro-bütçeli
    // OPSİYONEL onarım çağrısının timeout'u recordAiNetFailure'a sayılıyordu →
    // iki müzik komutu üst üste = FAIL_THRESHOLD(2) = breaker 90sn TÜM asistanı kapattı.
    const fn = src.match(/export async function repairMusicQuery\([\s\S]*?\n\}/);
    expect(fn, 'repairMusicQuery bulunamadı').toBeTruthy();
    expect(fn![0], 'repairMusicQuery hatası recordAiNetFailure() ile BEYİN kesicisine yazılıyor (iki müzik komutu → 90sn offline)').not.toMatch(/recordAiNetFailure\s*\(/);
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
  it('YAPISAL: sapma eşiği GPS hata payına duyarlı + ≥3 ardışık tick', () => {
    const src = read('src/platform/routingService.ts');
    expect(src).toMatch(/REROUTE_THRESHOLD_M\s*\+\s*Math\.min\(accuracy/);
    expect(src).toMatch(/_deviationCounter\s*>=\s*3/);
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
describe('K24 CAN-flood perf düzeltmesi — hot-path allocation kilidi', () => {
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
    expect(src, 'pickRawSpeed kaldırılmış — Doppler=0 saplanması geri gelir').toMatch(/pickRawSpeed\(gpsSpeed,\s*deltaSpeed\)/);
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
  it('DAVRANIŞ: setDrivingView isStyleLoaded()=false iken bile jumpTo uygular', async () => {
    const { setDrivingView } = await import('../platform/map/MapInteractionManager');
    const { resetCameraSmooth } = await import('../platform/cameraEngine');
    resetCameraSmooth(); // deterministik başlangıç (bearing=0)
    const jumps: Array<{ bearing: number }> = [];
    const mockMap = {
      isStyleLoaded: () => false,          // tile yükleniyor / setData sonrası kirli stil
      jumpTo: (o: { bearing: number }) => { jumps.push(o); },
      getZoom: () => 16,
      getLayer: () => undefined,
      setPaintProperty: () => {},
    } as unknown as import('maplibre-gl').Map;
    // 40 km/h, heading 45° (KD) — jitter filtresine takılmayacak gerçek sürüş girdisi
    setDrivingView(mockMap, 36.9146, 34.8973, 45, 40, 600);
    expect(jumps.length, 'stil-kapısı geri gelmiş: kamera tile yüklenirken ölür').toBe(1);
    expect(jumps[0].bearing, 'bearing 45° hedefe akmalı, kuzeye çivili kalmamalı').toBeGreaterThan(0);
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

  it('YAPISAL: pushService uzak komut WS fallback + durum getter', () => {
    expect(pushServiceSrc, '_startCommandFallback kaldırılmış — Play Services yoksa push-to-wake ölür, uzak komutlar hiç çalışmaz')
      .toMatch(/_startCommandFallback/);
    expect(pushServiceSrc, 'registrationError → fallback bağlantısı kopmuş — async FCM hatası uzak komutu WS\'e devretmiyor')
      .toMatch(/registrationError[\s\S]*_startCommandFallback/);
    expect(pushServiceSrc, 'getPushStatus export kaldırılmış — teşhis kartı Play Services durumunu okuyamaz')
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
