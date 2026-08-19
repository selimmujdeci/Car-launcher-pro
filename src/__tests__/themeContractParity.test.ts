/**
 * Tema sözleşmesi PARİTE + KİMLİK KABLOLAMA kilitleri.
 *
 * 1) PARİTE: `themeManifest.ts` ve `themeComponentRegistry.ts` iki pakette birden
 *    yaşar (araç Vite / PWA Next). Sessiz ayrışma = PWA'nın gönderdiği paketi
 *    aracın reddetmesi demektir. Bu test ilk yorum bloğu DIŞINDAKİ her karakterin
 *    birebir aynı olmasını zorlar. (Senkron: `node scripts/sync-theme-contract.mjs`)
 *
 * 2) KABLOLAMA: kayıt defterindeki HER componentId, kaynak kodda gerçekten
 *    `data-editable="<id>"` (veya paylaşılan sarmalayıcıya verilen `editId="<id>"`)
 *    olarak işaretlenmiş olmalı. "Motor var, besleyen yok" deseni (defterde duran
 *    ama DOM'da hiç olmayan kimlik) bu testle YASAKLANIR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { THEME_COMPONENTS, THEME_SURFACES } from '../platform/theme/themeComponentRegistry';

const MARK = '---8<--- PARITY-START --->8---';

/** Vitest kökü depo köküdür (vitest.config.ts proje kökünde). */
function readRepo(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function body(src: string): string {
  const i = src.indexOf(MARK);
  expect(i).toBeGreaterThan(-1);
  return src.slice(i + MARK.length);
}

describe('tema sözleşmesi — araç ↔ PWA paritesi', () => {
  it('themeManifest.ts iki pakette BİREBİR aynıdır', () => {
    const car = body(readRepo('src/platform/theme/themeManifest.ts'));
    const pwa = body(readRepo('website/src/lib/theme/themeManifest.ts'));
    expect(pwa).toBe(car);
  });

  it('themeComponentRegistry.ts iki pakette BİREBİR aynıdır', () => {
    const car = body(readRepo('src/platform/theme/themeComponentRegistry.ts'));
    const pwa = body(readRepo('website/src/lib/theme/themeComponentRegistry.ts'));
    expect(pwa).toBe(car);
  });
});

/* ── Kablolama ────────────────────────────────────────────────────── */

const WIRED_SOURCES = [
  'src/components/themes/ExpeditionLayout.tsx',
  'src/components/themes/HorizonLayout.tsx',
  'src/components/themes/TeslaLayout.tsx',
  'src/components/themes/ProLayout.tsx',
  'src/components/settings/SettingsPage.tsx',
  'src/components/obd/DTCPanel.tsx',
  'src/components/obd/MaintenancePanel.tsx',
  'src/components/notifications/NotificationCenter.tsx',
  'src/components/weather/WeatherWidget.tsx',
  'src/components/security/SecuritySuite.tsx',
  'src/components/dashcam/DashcamView.tsx',
  'src/components/sport/SportModePanel.tsx',
  'src/components/trip/TripLogView.tsx',
  // PR-2a — kapsam genişletmesi (bu ekranlarda önce SIFIR düzenlenebilir nokta vardı)
  'src/components/climate/ClimateScreen.tsx',
  'src/components/phone/PhoneScreen.tsx',
  'src/components/apps/AppGrid.tsx',
  // PR-2b
  'src/components/media/MediaScreen.tsx',
  'src/components/map/FullMapView.tsx',
  'src/components/map/NavigationHUD.tsx',
  // PR-2c
  'src/components/traffic/TrafficPanel.tsx',
  'src/components/entertainment/EntertainmentPortal.tsx',
  'src/components/vehicle/VehicleTellTales.tsx',
  'src/components/camera/RearViewCamera.tsx',
  'src/components/split/SplitScreen.tsx',
  'src/components/theater/TheaterOverlay.tsx',
];

const ALL_SOURCE = WIRED_SOURCES.map(readRepo).join('\n');

describe('tema kayıt defteri — her kimlik GERÇEKTEN kablolanmış', () => {
  it('defterde hayalet kimlik yok', () => {
    const missing = THEME_COMPONENTS.filter((c) =>
      !ALL_SOURCE.includes(`data-editable="${c.id}"`) && !ALL_SOURCE.includes(`editId="${c.id}"`),
    ).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('her yüzey (surface) en az bir data-theme-surface kökü ile kablolanmış', () => {
    const missing = THEME_SURFACES.filter((s) => !ALL_SOURCE.includes(`data-theme-surface="${s.id}"`))
      .map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('kimlikler benzersiz', () => {
    const ids = THEME_COMPONENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('her bileşenin yüzeyi kayıtlı bir yüzeydir', () => {
    const surfaceIds = new Set(THEME_SURFACES.map((s) => s.id));
    for (const c of THEME_COMPONENTS) expect(surfaceIds.has(c.surface)).toBe(true);
  });

  it('4 temanın her birinin ana ekranında düzenlenebilir bileşen vardır', () => {
    for (const t of ['expedition', 'horizon', 'tesla', 'pro'] as const) {
      const n = THEME_COMPONENTS.filter((c) => c.surface === 'home' && c.themes?.includes(t)).length;
      expect(n).toBeGreaterThan(0);
    }
  });

  it('kilitli bileşenler gizlenemez (visible yeteneği düşer)', async () => {
    const { propsForComponent } = await import('../platform/theme/themeComponentRegistry');
    for (const c of THEME_COMPONENTS) {
      if (c.locked) expect(propsForComponent(c)).not.toContain('visible');
    }
  });
});

/* ── Önizleme gezinmesi (PR-2a) ───────────────────────────────────── */

describe('Stüdyo önizlemesi seçilen EKRANA gider', () => {
  /* KAPATILAN BOŞLUK: ekran seçilince önizleme ana ekranda kalıyordu →
   * kullanıcı Ayarlar/Bildirim/İklim düzenlerken sonucu GÖREMİYOR, körlemesine
   * renk seçiyordu. Yeni ekranlara özgü değildi; mevcut on çekmece ekranı da
   * aynı durumdaydı. Bu kilitler boşluğun geri gelmesini engeller. */

  const bridge = readRepo('src/platform/themePreviewBridge.ts');
  const studio = readRepo('website/src/components/pwa/ThemeStudio.tsx');

  it('araç köprüsü `caros-preview-surface` mesajını işler', () => {
    expect(bridge, 'köprü ekran gezinme mesajını artık işlemiyor — önizleme ana ekranda takılı kalır')
      .toMatch(/case 'caros-preview-surface'/);
  });

  it('Stüdyo ekran değişiminde hedefi yollar', () => {
    expect(studio, "Stüdyo 'caros-preview-surface' yollamıyor — seçim önizlemeye ulaşmaz")
      .toMatch(/type:\s*'caros-preview-surface'/);
  });

  it('KİLİT: HER kayıtlı yüzeyin gezinme hedefi vardır (sessiz körlük yok)', () => {
    /* Yeni bir yüzey eklenip eşlemeye yazılmazsa o ekran SESSİZCE
     * düzenlenemez hâle gelir — kullanıcı fark etmez, çünkü önizleme yine
     * bir şey gösterir (yanlış ekranı). Bu kilit tam onu yakalar. */
    const basi = bridge.indexOf('const SURFACE_DRAWER');
    expect(basi, 'SURFACE_DRAWER eşlemesi kaldırılmış — hiçbir ekrana gidilemez').toBeGreaterThan(-1);
    const govde = bridge.slice(basi);
    const kesit = govde.slice(0, govde.indexOf('};'));
    /* Kaçış karakteri KULLANILMAZ: düz `includes` araması. Bu turda bir kez
       kaçış hatası kilidi fail-open bıraktı — desen tekrarlanmasın. */
    const eksik = THEME_SURFACES.filter((s) => !kesit.includes(s.id + ':')).map((s) => s.id);
    expect(eksik, 'bu yüzeyler SURFACE_DRAWER eşlemesinde YOK — seçilince önizleme yanlış ekranda kalır').toEqual([]);
  });

  it('KİLİT: eşleme tablosu TEK yerdedir (PWA ikinci kopya tutmaz)', () => {
    /* PWA yalnız kayıt defterindeki YÜZEY kimliğini yollar; hangi çekmecenin
       açılacağı ARAÇ bilgisidir. İkinci tablo sessiz ayrışma üretir. Arama
       yalnız çekmeceye özgü (yüzey adlarıyla çakışmayan) kimlikler üzerinden. */
    for (const cekmece of ['triplog', 'dtc', 'vehicle-reminder', 'super-admin']) {
      expect(studio, 'PWA çekmece kimliği taşıyor — eşleme ikiye bölünmüş: ' + cekmece)
        .not.toContain("'" + cekmece + "'");
    }
  });
});

/* ── Güvenlik sınırı (PR-2b) ──────────────────────────────────────── */

describe('tema güvenlik-kritik navigasyon yüzeylerini GİZLEYEMEZ', () => {
  /* Vizyon anayasası: güvenlik-kritik katmanlar HER tier'da garanti açıktır.
   * Tema bir görünüm katmanıdır — rengi/köşeyi değiştirebilir, ama sürücünün
   * manevra talimatını, hız limitini veya tehlike uyarısını EKRANDAN
   * KALDIRAMAZ. `locked` işareti `propsForComponent`ten `visible` yeteneğini
   * düşürür; bu kilit işaretin sessizce kalkmasını engeller. */
  const KORUNAN = ['nav.maneuver', 'nav.speed-cluster', 'nav.hazard', 'nav.screen'] as const;

  it('KİLİT: korunan navigasyon bileşenleri `locked` işaretlidir', async () => {
    const { getThemeComponent, propsForComponent } =
      await import('../platform/theme/themeComponentRegistry');
    for (const id of KORUNAN) {
      const info = getThemeComponent(id);
      expect(info, `kayıt defterinde yok: ${id}`).not.toBeNull();
      expect(info!.locked, `${id} artık locked DEĞİL — tema ile gizlenebilir hâle geldi`).toBe(true);
      expect(propsForComponent(info!), `${id} için 'visible' yeteneği açılmış`).not.toContain('visible');
    }
  });
});

describe('harita yüzeyi önizlemede GERÇEKTEN açılır (#652)', () => {
  /* Harita bir çekmece değildir; `drawerBus` onu açamaz. Bu yol olmasaydı
   * "Navigasyon / Harita" seçilince önizleme ana ekranda kalır ve kullanıcı
   * manevra kartını KÖRLEMESİNE düzenlerdi — kapattığımız kusurun aynısı. */
  const bridge = readRepo('src/platform/themePreviewBridge.ts');
  const layout = readRepo('src/components/layout/MainLayout.tsx');

  it('köprü harita görünümünü açar/kapatır', () => {
    expect(bridge, 'setFullMapView çağrısı yok — nav yüzeyi seçilince harita açılmaz')
      .toContain('setFullMapView(');
  });

  it("KİLİT: nav DIŞINDAKİ yüzeye geçilince harita KAPATILIR", () => {
    /* Açık kalırsa harita üstte durur, seçilen ekranı örter ve ölçüm yanlış
       kutuları bildirir (kullanıcı görünmeyen bir şeyi düzenler). */
    expect(bridge, 'harita koşulsuz açılıyor — başka ekrana geçince kapanmaz')
      .toContain("setFullMapView(sid === 'nav')");
  });

  it('MainLayout veri yoluna kendini kaydeder (sahipsiz yol değil)', () => {
    expect(layout, 'registerMapViewHandler çağrılmıyor — veri yolu sahipsiz, çağrı sessizce düşer')
      .toContain('registerMapViewHandler(setFullMapOpen)');
    expect(layout, 'unregisterMapViewHandler yok — zero-leak ihlali (zombi handler)')
      .toContain('unregisterMapViewHandler()');
  });
});

describe('önizlenemeyen ekran KULLANICIYA söylenir (#653)', () => {
  /* Bazı yüzeyler önizlemede AÇILAMAZ (geri görüş kamerası vitese, Sinema /
   * Bölünmüş ekran kullanıcı eylemine bağlıdır) — onları Stüdyo'dan taklit
   * etmek bir güvenlik yüzeyini YALANLAMAK olurdu. O hâlde kullanıcı ana
   * ekranı görür ve KÖRLEMESİNE düzenler. Uyarı SABİT LİSTEDEN değil
   * ÖLÇÜMDEN türetilir: sabit liste bayatlar, ölçüm bayatlamaz. */
  const studio = readRepo('website/src/components/pwa/ThemeStudio.tsx');

  it('gösterilebilirlik ÖLÇÜMDEN türetilir (sabit liste değil)', () => {
    expect(studio, 'surfaceShown türetimi kaldırılmış — önizlenemeyen ekran sessizce ana ekranı gösterir')
      .toContain('const surfaceShown');
    expect(studio, 'türetme ölçüme (probe) bağlı değil — sabit liste bayatlar')
      .toMatch(/surfaceShown[\s\S]{0,900}probe\.map/);
  });

  it('ölçüm yokken HİÇBİR ŞEY iddia edilmez (fail-closed, sahte güven yok)', () => {
    expect(studio, 'probe null iken false dönüyor olabilir — "gösterilemiyor" yalanı üretilir')
      .toMatch(/if \(probe === null\) return null;/);
  });

  it('uyarı metni kullanıcıya GÖRÜNÜR', () => {
    expect(studio, 'uyarı bloğu kaldırılmış')
      .toContain('surfaceShown === false');
    expect(studio, 'uyarı metni yok — kullanıcı neden göremediğini bilemez')
      .toContain('önizlemede gösterilemiyor');
  });
});
