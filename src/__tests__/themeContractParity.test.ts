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
