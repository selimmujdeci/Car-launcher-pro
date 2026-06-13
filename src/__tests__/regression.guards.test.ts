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
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

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
