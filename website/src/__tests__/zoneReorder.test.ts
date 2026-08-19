/**
 * #658 — SÜRÜKLE-BIRAK sıralama kilitleri.
 *
 * Sıra bugüne dek yalnız bir SAYI alanıyla değiştirilebiliyordu. Sürükleme
 * eklenirken korunması gereken üç şey var:
 *  1. Tek sürükleme = TEK geri-al adımı (kart başına yama olsaydı N adım olurdu).
 *  2. Sıra değişmediyse HİÇ yazma (boş geri-al adımı + araca gereksiz manifest).
 *  3. Sürükleme dokunmatikte çalışmalı (Pointer Events + touch-action:none).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createStudioState, studioReducer } from '@/lib/theme/themeStudioState';
import type { StudioState } from '@/lib/theme/themeStudioState';

/** Aktif temanın manifesti — state şeklinden okunur (ayrı yardımcı yok). */
function man(s: StudioState) { return s.manifests[s.themeId]; }

/** Testler `pro` temasında koşar (solver kullanan tema). */
function proState(): StudioState {
  return studioReducer(createStudioState(), { type: 'select-theme', themeId: 'pro' });
}

function oku(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('bölge sıralama — durum makinesi', () => {
  it('KİLİT: reorder-zone tüm kartların ord değerini 0..n-1 yazar', () => {
    let s = proState();
    s = studioReducer(s, {
      type: 'reorder-zone', zone: 'left-rail',
      orderedCardIds: ['settings', 'clock', 'gauge'],
    });
    const m = man(s);
    expect(m.layoutOverrides.settings?.ord).toBe(0);
    expect(m.layoutOverrides.clock?.ord).toBe(1);
    expect(m.layoutOverrides.gauge?.ord).toBe(2);
  });

  it('KİLİT: tek sürükleme TEK geri-al adımıdır', () => {
    let s = proState();
    const oncekiAdim = s.past.length;
    s = studioReducer(s, {
      type: 'reorder-zone', zone: 'left-rail',
      orderedCardIds: ['settings', 'clock', 'gauge'],
    });
    expect(s.past.length - oncekiAdim,
      'üç kart yazıldı ama geçmişe bir adım girmeli — yoksa "geri al" tek seferde geri almaz')
      .toBe(1);
  });

  it('KİLİT: geri al TEK hamlede eski sırayı getirir', () => {
    let s = proState();
    s = studioReducer(s, {
      type: 'reorder-zone', zone: 'left-rail',
      orderedCardIds: ['settings', 'clock', 'gauge'],
    });
    s = studioReducer(s, { type: 'undo' });
    const m = man(s);
    expect(m.layoutOverrides.settings, 'geri al sırayı temizlemedi').toBeUndefined();
  });

  it('KİLİT: sıralama diğer yerleşim alanlarını EZMEZ', () => {
    let s = proState();
    s = studioReducer(s, { type: 'patch-layout', cardId: 'clock', patch: { grow: 2.5 } });
    s = studioReducer(s, {
      type: 'reorder-zone', zone: 'left-rail',
      orderedCardIds: ['clock', 'gauge', 'settings'],
    });
    const m = man(s);
    expect(m.layoutOverrides.clock?.grow, 'elle boyut sıralama sırasında silinmiş').toBe(2.5);
    expect(m.layoutOverrides.clock?.ord).toBe(0);
  });
});

describe('bölge sıralama — dokunmatik davranışı (yapısal)', () => {
  const src = oku('src/components/pwa/theme/ZoneReorder.tsx');

  it('KİLİT: Pointer Events kullanır (HTML5 drag API dokunmatikte güvenilmez)', () => {
    expect(src, 'onPointerDown yok — fare/dokunuş tek yoldan gitmiyor').toContain('onPointerDown');
    expect(src, 'setPointerCapture yok — parmak elemandan çıkınca sürükleme kopar')
      .toContain('setPointerCapture');
    expect(src, 'HTML5 dragstart kullanılmış — dokunmatikte güvenilmez')
      .not.toContain('onDragStart');
  });

  it('KİLİT: tutamaçta touchAction none (yoksa panel kayar, sürükleme çalışmaz)', () => {
    expect(src).toContain("touchAction: 'none'");
  });

  it('KİLİT: sıra değişmediyse yazma yapılmaz (boş geri-al adımı yok)', () => {
    expect(src, 'değişiklik karşılaştırması kaldırılmış — her dokunuş geçmişe adım yazar')
      .toMatch(/son\.some\(\(id, i\) => id !== onceki\[i\]\)/);
  });

  it('KİLİT: satır konumu GERÇEK kutulardan okunur (sabit yükseklik varsayılmaz)', () => {
    expect(src, 'sabit satır yüksekliği varsayılmış — sarmalı etiketlerde sıra yanlış hesaplanır')
      .toContain('getBoundingClientRect');
  });
});

describe('bölge genişliği — DAVRANIŞSAL (yapısal kilit yetmedi)', () => {
  /* ── BU TESTİN VAROLUŞ SEBEBİ ─────────────────────────────────────────
   * Sütun genişliği ilk yazıldığında `commit` hedefi UYDURMA bir kart
   * kimliğiydi (`{kind:'layout', cardId:'zone:left-rail'}`). `commit`
   * değişikliği hedefin DİLİMİNDEN okur; o kimliğin dilimi hem öncesinde hem
   * sonrasında `undefined` olduğu için mutasyon SESSİZCE ÇÖPE GİDİYORDU —
   * kullanıcı kaydırıcıyı çekiyor, hiçbir şey olmuyordu.
   *
   * O turda yalnız SÖZLEŞME (coerce) ve YAPISAL (dosyada şu satır var mı)
   * kilitleri yazılmıştı; ikisi de bu kusuru göremezdi. Ders: bir eylem
   * eklendiğinde reducer'ın GERÇEKTEN yazdığı DAVRANIŞSAL olarak sınanmalı. */

  it('KİLİT: patch-zone-width manifesti GERÇEKTEN değiştirir', () => {
    let s = proState();
    s = studioReducer(s, { type: 'patch-zone-width', zone: 'left-rail', scale: 1.35 });
    expect(man(s).zoneWidths['left-rail'],
      'kaydırıcı manifeste yazmadı — commit hedefi mutasyonu kapsamıyor olabilir')
      .toBe(1.35);
    expect(s.past.length, 'geri-al geçmişine adım girmedi').toBe(1);
  });

  it('KİLİT: null ile tema varsayılanına dönülür', () => {
    let s = proState();
    s = studioReducer(s, { type: 'patch-zone-width', zone: 'left-rail', scale: 1.35 });
    s = studioReducer(s, { type: 'patch-zone-width', zone: 'left-rail', scale: null });
    expect(man(s).zoneWidths['left-rail']).toBeUndefined();
  });

  it('KİLİT: geri al genişliği eski değerine döndürür', () => {
    let s = proState();
    s = studioReducer(s, { type: 'patch-zone-width', zone: 'left-rail', scale: 1.35 });
    s = studioReducer(s, { type: 'undo' });
    expect(man(s).zoneWidths['left-rail'],
      'geri al genişliği geri almadı — writeSlice dalı eksik olabilir')
      .toBeUndefined();
  });

  it('KİLİT: iki ray BİRBİRİNDEN bağımsızdır', () => {
    let s = proState();
    s = studioReducer(s, { type: 'patch-zone-width', zone: 'left-rail', scale: 1.2 });
    s = studioReducer(s, { type: 'patch-zone-width', zone: 'right-rail', scale: 0.8 });
    expect(man(s).zoneWidths['left-rail']).toBe(1.2);
    expect(man(s).zoneWidths['right-rail']).toBe(0.8);
  });
});
