/**
 * #656 — GÖRSEL KART BİRLEŞTİRME kilitleri.
 *
 * Kullanıcı isteği: "iki kartı tek kart yapma". Yerleşim çözücüsü ardışık
 * birleşik kartları GRUPLARA toplar; çizim tarafı grubu tek kapsayıcıda,
 * aralarında boşluk bırakmadan çizer.
 *
 * Bu kilitler üç şeyi korur: (1) varsayılan davranış DEĞİŞMEZ, (2) gruplama
 * `items` ile tutarlı kalır (kart kaybolmaz/çoğalmaz), (3) sıralama otoritesi
 * ikiye bölünmez.
 */
import { describe, it, expect } from 'vitest';
import {
  solveLayout, defaultIntent, normalizeIntent,
  EXPEDITION_MANIFEST, PRO_MANIFEST, ZONES,
  type LayoutIntent,
} from '../platform/theme/layoutSolver';

function niyet(manifest = EXPEDITION_MANIFEST): LayoutIntent {
  return defaultIntent(manifest);
}

describe('kart birleştirme — çözücü', () => {
  it('KİLİT: varsayılanda HİÇBİR kart birleşik değil (mevcut ekran korunur)', () => {
    const c = solveLayout(niyet(), EXPEDITION_MANIFEST);
    for (const z of ZONES) {
      expect(c[z].groups.length, `${z}: varsayılanda grup sayısı kart sayısına eşit olmalı`)
        .toBe(c[z].items.length);
    }
  });

  it('KİLİT: gruplar `items` ile TUTARLI — kart kaybolmaz, çoğalmaz', () => {
    const i = niyet();
    const ids = Object.keys(i);
    // Her karta birleştirme işareti koy — en agresif durum.
    for (const id of ids) i[id] = { ...i[id], mergeNext: true };
    const c = solveLayout(i, EXPEDITION_MANIFEST);
    for (const z of ZONES) {
      const duz = c[z].groups.flat().map((x) => x.id);
      expect(duz, `${z}: gruplar düzleştirilince items ile aynı olmalı`)
        .toEqual(c[z].items.map((x) => x.id));
    }
  });

  it('KİLİT: bölgenin SON kartındaki işaret etkisizdir (uydurma grup yok)', () => {
    const i = niyet();
    const c0 = solveLayout(i, EXPEDITION_MANIFEST);
    const zone = ZONES.find((z) => c0[z].items.length >= 2)!;
    const sonId = c0[zone].items[c0[zone].items.length - 1].id;
    i[sonId] = { ...i[sonId], mergeNext: true };
    const c = solveLayout(i, EXPEDITION_MANIFEST);
    expect(c[zone].groups.length, 'son karttaki işaret grup sayısını değiştirmemeli')
      .toBe(c0[zone].groups.length);
  });

  it('KİLİT: iki ardışık kart birleşince grup sayısı BİR azalır', () => {
    const i = niyet();
    const c0 = solveLayout(i, EXPEDITION_MANIFEST);
    const zone = ZONES.find((z) => c0[z].items.length >= 2)!;
    const ilkId = c0[zone].items[0].id;
    i[ilkId] = { ...i[ilkId], mergeNext: true };
    const c = solveLayout(i, EXPEDITION_MANIFEST);
    expect(c[zone].groups.length).toBe(c0[zone].groups.length - 1);
    expect(c[zone].groups[0].map((x) => x.id))
      .toEqual([c0[zone].items[0].id, c0[zone].items[1].id]);
  });

  it('KİLİT: gizlenen kart araya girmez — birleşme GÖRÜNÜR kartlar arasındadır', () => {
    /* Manifest PRO seçildi: EXPEDITION'da hiçbir bölgede 3 görünür kart yok.
       Ayrıca gizlenecek kart KİLİTLİ OLMAMALI — kilitli kart zaten gizlenemez
       ve test yanlış şeyi ölçmüş olurdu. */
    const i = defaultIntent(PRO_MANIFEST);
    const c0 = solveLayout(i, PRO_MANIFEST);
    const kilitli = new Set(PRO_MANIFEST.filter((m) => m.locked).map((m) => m.id));
    let zone: (typeof ZONES)[number] | null = null;
    let k = -1;
    for (const z of ZONES) {
      const it = c0[z].items;
      for (let n = 0; n + 1 < it.length; n++) {
        if (!kilitli.has(it[n + 1].id)) { zone = z; k = n; break; }
      }
      if (zone) break;
    }
    expect(zone, 'uygun bölge bulunamadı — manifest değişmiş olabilir').not.toBeNull();
    const a = c0[zone!].items[k];
    const b = c0[zone!].items[k + 1];
    i[a.id] = { ...i[a.id], mergeNext: true };
    i[b.id] = { ...i[b.id], visible: false };
    const c = solveLayout(i, PRO_MANIFEST);
    const grup = c[zone!].groups.find((g) => g.some((x) => x.id === a.id))!;
    expect(grup, 'kart hiçbir gruba girmemiş').toBeTruthy();
    expect(grup.some((x) => x.id === b.id), 'gizli kart gruba girmiş').toBe(false);
  });

  it('KİLİT: normalizeIntent bozuk mergeNext değerini varsayılana düşürür', () => {
    const n = normalizeIntent({ clock: { mergeNext: 'evet' } }, PRO_MANIFEST);
    expect(n.clock.mergeNext, 'string kabul edilmiş — zero-trust ihlali').toBe(false);
    const n2 = normalizeIntent({ clock: { mergeNext: true } }, PRO_MANIFEST);
    expect(n2.clock.mergeNext).toBe(true);
  });
});

describe('kart birleştirme — çizim ve stil (yapısal)', () => {
  const oku = (rel: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs') as typeof import('node:fs')).readFileSync(rel, 'utf8');

  it('KİLİT: birleşme stili TEK dosyada (tema başına kopya yok)', () => {
    const ortak = oku('src/styles/card-merge.css');
    expect(ortak).toContain("data-merged");
    for (const t of ['ExpeditionLayout', 'ProLayout', 'TeslaLayout', 'HorizonLayout']) {
      const src = oku(`src/components/themes/${t}.tsx`);
      expect(src, `${t} kendi birleşme CSS'ini taşıyor — ikinci otorite`)
        .not.toContain('border-top-left-radius: 0 !important');
    }
  });

  it('KİLİT: iki solver teması da GRUPLARI çizer (items değil)', () => {
    for (const t of ['ExpeditionLayout', 'ProLayout']) {
      const src = oku(`src/components/themes/${t}.tsx`);
      expect(src, `${t} hâlâ items üzerinden çiziyor — birleştirme ekrana ULAŞMAZ`)
        .toContain('.groups.map(');
      expect(src, `${t} birleşik kapsayıcıyı işaretlemiyor — CSS hedefini bulamaz`)
        .toContain('data-merged="true"');
    }
  });
});
