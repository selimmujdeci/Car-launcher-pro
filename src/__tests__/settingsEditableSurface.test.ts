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
import { readFileSync, readdirSync } from 'node:fs';
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

/* ══════════════════════════════════════════════════════════════════════════
 * #629 — AYNI DESEN KALAN 8 ALT EKRANA UYGULANDI
 *
 * #628'de Ayarlar açıldı ama diğer ekranlar hâlâ TEK PARÇAYDI (1'er bileşen):
 * Teşhis · Bakım · Bildirimler · Hava · Güvenlik · Dashcam · Spor · Seyahat.
 * Kullanıcı sırayı onayladı ("olur yap"). Bu kilitler o borcun kapandığını ve
 * bir daha açılmayacağını korur.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Her düzenlenebilir kimliğin kaynakta gerçekten işaretli olup olmadığını tarar.
 *
 * İKİ DESEN de meşrudur ve ürün ikisini de kullanır (ölçüldü: 21 doğrudan,
 * 12 sarmalayıcı):
 *   · doğrudan öznitelik  →  `data-editable="horizon.topbar"`
 *   · sarmalayıcı prop    →  `<Panel editId="horizon.map">` (Panel içeride
 *     `data-editable={editId}` olarak DOM'a yazar)
 * Yalnız birincisini aramak YANLIŞ ALARM üretir — bu kilit ilk yazımında tam
 * olarak öyle düştü ve Horizon temasını hatalı biçimde "işaretsiz" saydı.
 */
function collectMarkedIds(): Set<string> {
  const roots = [join(ROOT, 'src', 'components')];
  const found = new Set<string>();
  const rx = /(?:data-editable|editId)=\{?["']([^"']+)["']\}?/g;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(rx)) found.add(m[1]);
    }
  };
  for (const r of roots) walk(r);
  return found;
}

describe('#629 — hiçbir ekran TEK PARÇA değil', () => {
  it('🔒 her yüzeyde en az 2 düzenlenebilir bileşen var', () => {
    const bySurface = new Map<string, number>();
    for (const c of THEME_COMPONENTS) {
      bySurface.set(c.surface, (bySurface.get(c.surface) ?? 0) + 1);
    }
    const lonely = [...bySurface.entries()].filter(([, n]) => n < 2).map(([s]) => s);
    expect(
      lonely,
      `tek parça kalan yüzey(ler): ${lonely.join(', ')} — o ekranda kullanıcı `
      + 'yalnız "tüm sayfa"yı seçebilir',
    ).toEqual([]);
  });

  it('🔒 sekiz alt ekranın HER BİRİNDE yapı taşı kimliği var', () => {
    for (const surface of ['diagnostics', 'maintenance', 'notifications', 'weather',
      'security', 'dashcam', 'sport', 'trip'] as const) {
      const inner = THEME_COMPONENTS.filter(
        (c) => c.surface === surface && c.id.includes('.'),
      );
      expect(inner.length, `${surface} yüzeyinde iç yapı kimliği yok`).toBeGreaterThanOrEqual(1);
    }
  });

  it('🔒 DÜRÜSTLÜK: defterdeki HER kimlik araç kaynağında işaretli', () => {
    /* Kayıt defterinin kendi kuralı: "bu defterde YALNIZ kodda GERÇEKTEN
       `data-editable` ile işaretlenmiş bileşenler bulunur." İşaretsiz kimlik
       Stüdyo'da ölçülemez → kutu çıkmaz, kullanıcı sebebini anlamaz. */
    const marked = collectMarkedIds();
    const missing = THEME_COMPONENTS.map((c) => c.id).filter((id) => !marked.has(id));
    expect(missing, `kaynakta işareti olmayan kimlik(ler): ${missing.join(', ')}`).toEqual([]);
  });

  it('🔒 araç ve PWA defterleri TÜM kimliklerde birebir aynı', () => {
    const pick = (src: string) =>
      [...src.matchAll(/id: '([^']+)'/g)].map((m) => m[1]).sort();
    const veh = pick(readFileSync(
      join(ROOT, 'src', 'platform', 'theme', 'themeComponentRegistry.ts'), 'utf8'));
    const pwa = pick(readFileSync(
      join(ROOT, 'website', 'src', 'lib', 'theme', 'themeComponentRegistry.ts'), 'utf8'));
    expect(veh.length).toBeGreaterThanOrEqual(60);
    expect(veh, 'iki defter ayrışmış → PWA görünmeyen bileşen sunar').toEqual(pwa);
  });
});
