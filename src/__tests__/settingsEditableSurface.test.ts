/**
 * settingsEditableSurface.test.ts — AYARLAR EKRANI DÜZENLENEBİLİRLİK KİLİDİ
 *
 * ── NEDEN VAR (kullanıcı + kaynak ölçümü, 2026-08-18) ───────────────────────
 * Kullanıcı: *"ayarlarda istediğim yeri düzenleyemiyorum."* Ölçüm kayıt
 * defterinden yapıldı ve şikâyeti birebir doğruladı:
 *
 *     home     → 33 düzenlenebilir bileşen
 *     settings →  1 (`settings-page`, TÜM SAYFA tek panel)
 *
 * Yani Tema Stüdyo'da Ayarlar ekranında dokunulacak tek şey vardı: sayfanın
 * kendisi. Üst bar, kategori menüsü, bölüm başlıkları, ayar kartları,
 * anahtarlar ve kaydırıcılar Stüdyo için GÖRÜNMEZDİ.
 *
 * İKİNCİ KÖK — ölçüm de tek örnekle sınırlıydı: `probeEditableGeometry`
 * `querySelector` kullanıyordu, yani bir kimliğin ekrandaki İLK düğümü dışında
 * hiçbir örneği dokunulabilir değildi. Ayarlar sayfasında aynı kart türünden
 * 10 tane varsa 9'u ölü alandı.
 *
 * KİLİTLENEN SÖZLEŞMELER:
 *   1. Ayarlar yüzeyi tek parça DEĞİLDİR (en az 8 bileşen).
 *   2. Kayıt defterindeki her `settings.*` kimliği kaynakta GERÇEKTEN
 *      `data-editable` ile işaretlidir (defter kod gerçeğidir, dilek listesi değil).
 *   3. Ölçüm TÜM örnekleri bildirir (`querySelectorAll`) ve sınırlıdır.
 *   4. Araç ve PWA kayıt defterleri aynı `settings.*` kimliklerini taşır.
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_COMPONENTS } from '../platform/theme/themeComponentRegistry';

const ROOT = process.cwd();
const SETTINGS_SRC = readFileSync(
  join(ROOT, 'src', 'components', 'settings', 'SettingsPage.tsx'), 'utf8');
const BRIDGE_SRC = readFileSync(
  join(ROOT, 'src', 'platform', 'themePreviewBridge.ts'), 'utf8');

const settingsComponents = THEME_COMPONENTS.filter((c) => c.surface === 'settings');

describe('#628 — Ayarlar ekranı artık TEK PARÇA değil', () => {
  it('🔒 ayarlar yüzeyinde en az 8 düzenlenebilir bileşen var', () => {
    expect(
      settingsComponents.length,
      `ayarlar yüzeyi ${settingsComponents.length} bileşene düştü — kullanıcı yine `
      + '"istediğim yeri düzenleyemiyorum" durumuna geri döner',
    ).toBeGreaterThanOrEqual(8);
  });

  it('🔒 sayfanın GERÇEK yapı taşları defterde var', () => {
    const ids = new Set(settingsComponents.map((c) => c.id));
    for (const need of [
      'settings.header',        // üst bar (Geri + başlık)
      'settings.nav-item',      // kategori menüsü öğeleri
      'settings.section-title', // bölüm başlıkları
      'settings.panel',         // kart kabı
      'settings.tile',          // ayar kartları
      'settings.toggle',        // aç/kapa anahtarları
      'settings.slider',        // kaydırıcılar
    ]) {
      expect(ids.has(need), `'${need}' defterde yok`).toBe(true);
    }
  });

  it('🔒 DÜRÜSTLÜK: her `settings.*` kimliği kaynakta GERÇEKTEN işaretli', () => {
    /* Defter kod gerçeğidir; "ileride yaparız" girdisi YOKTUR. İşaretlenmemiş
       bir kimlik Stüdyo'da ölçülemez → ekranda hiç kutu çıkmaz, kullanıcı
       sebebini anlamaz. */
    const missing = settingsComponents
      .filter((c) => c.id !== 'settings-page')
      .filter((c) => !SETTINGS_SRC.includes(`data-editable="${c.id}"`))
      .map((c) => c.id);
    expect(missing, `kaynakta işareti olmayan kimlik(ler): ${missing.join(', ')}`).toEqual([]);
  });

  it('🔒 tüm sayfayı kapsayan kimlik KORUNUR (toptan düzenleme yolu kapanmasın)', () => {
    expect(SETTINGS_SRC).toContain('data-editable="settings-page"');
  });

  it('🔒 "(tümü)" etiketi, tek kuralın çok öğeye indiği kimliklerde YAZILI', () => {
    /* Etiket kozmetik değil SÖZLEŞMEDİR: düzenleyici bu metne bakıp
       "bu ayar aynı türdeki TÜM öğelere uygulanır" uyarısını gösterir. */
    for (const id of ['settings.nav-item', 'settings.section-title',
      'settings.panel', 'settings.tile', 'settings.toggle', 'settings.slider']) {
      const c = settingsComponents.find((x) => x.id === id)!;
      expect(c.label, `${id} etiketi "(tümü)" demiyor → uyarı gösterilmez`)
        .toContain('(tümü)');
    }
  });
});

describe('#628 — ölçüm TÜM örnekleri bildirir', () => {
  it('🔒 `querySelectorAll` kullanılır — ilk örnek dışındakiler ölü alan değildir', () => {
    expect(BRIDGE_SRC, 'ölçüm yine tek örnekle sınırlı')
      .toContain('querySelectorAll');
  });

  it('🔒 kimlik başına kutu sayısı SINIRLI (güvenilmez DOM overlay\'i kilitlemesin)', () => {
    expect(BRIDGE_SRC).toContain('MAX_BOXES_PER_ID');
  });

  it('🔒 her kutu kaçıncı örnek olduğunu taşır (React anahtarı çakışmasın)', () => {
    expect(BRIDGE_SRC).toContain('index: n');
  });

  it('🔒 sıfır boyutlu düğüm hâlâ ELENİR (hayalet dokunma alanı yok)', () => {
    expect(BRIDGE_SRC).toContain('r.width > 0');
    expect(BRIDGE_SRC).toContain('r.height > 0');
  });
});

describe('#628 — iki kayıt defteri aynı kimlikleri taşır', () => {
  it('🔒 araç ve PWA defterlerinde `settings.*` kimlikleri BİREBİR aynı', () => {
    const pwa = readFileSync(
      join(ROOT, 'website', 'src', 'lib', 'theme', 'themeComponentRegistry.ts'), 'utf8');
    const veh = readFileSync(
      join(ROOT, 'src', 'platform', 'theme', 'themeComponentRegistry.ts'), 'utf8');
    const pick = (src: string) =>
      [...src.matchAll(/id: '(settings[.-][a-z-]+)'/g)].map((m) => m[1]).sort();
    const a = pick(veh);
    const b = pick(pwa);
    expect(a.length, 'araç defterinde settings kimliği yok — tarama deseni ölmüş')
      .toBeGreaterThanOrEqual(8);
    expect(a, 'iki defter ayrışmış → PWA görünmeyen bileşen sunar').toEqual(b);
  });
});
