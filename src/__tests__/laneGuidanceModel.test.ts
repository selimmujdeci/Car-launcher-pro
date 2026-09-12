/**
 * laneGuidanceModel.test.ts — şerit rehberi SUNUM semantiği (Adım 4).
 *
 * İki ÖLÇÜLMÜŞ kusuru kilitler:
 *  1. `valid` + `active` iki ayrı gerçeği tek boolean'a çökme,
 *  2. `['uturn']` göstergesinin DÜZ ok olarak çizilmesi.
 *
 * Ayrıca "kanıt yoksa panel yok" sözleşmesini ve modelin SAFLIĞINI korur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  resolveLaneDirection, resolveLanePresentation, resolveLaneRow,
  type LaneEvidence,
} from '../platform/navigation/core/laneGuidanceModel';

const lane = (p: Partial<LaneEvidence>): LaneEvidence =>
  ({ valid: true, active: false, indications: [], ...p });

describe('1 · gösterge çözümü', () => {
  it('🔒 U DÖNÜŞÜ düz ok DEĞİLDİR (ölçülen kusur: `["uturn"] → straight`)', () => {
    const r = resolveLaneDirection(['uturn']);
    expect(r.dir).toBe('uturn');
    expect(r.dir).not.toBe('straight');
  });

  it('🔒 `slight` ve `sharp` ayrı açılardır — hepsi 90°ye çökmez', () => {
    expect(resolveLaneDirection(['slight left']).angleDeg).toBe(-45);
    expect(resolveLaneDirection(['left']).angleDeg).toBe(-90);
    expect(resolveLaneDirection(['sharp left']).angleDeg).toBe(-135);
    expect(resolveLaneDirection(['slight right']).angleDeg).toBe(45);
    expect(resolveLaneDirection(['right']).angleDeg).toBe(90);
    expect(resolveLaneDirection(['sharp right']).angleDeg).toBe(135);
    expect(resolveLaneDirection(['straight']).angleDeg).toBe(0);
    // hepsi FARKLI
    const acilar = ['slight left', 'left', 'sharp left', 'straight',
      'slight right', 'right', 'sharp right', 'uturn']
      .map((i) => resolveLaneDirection([i]).angleDeg);
    expect(new Set(acilar).size).toBe(acilar.length);
  });

  it('🔒 ÇOKLU göstergede en belirgin dönüş kazanır — eski sonuçlar DEĞİŞMEZ', () => {
    // eski `_laneDir` davranışıyla birebir aynı kalmalı
    expect(resolveLaneDirection(['straight', 'right']).dir).toBe('right');
    expect(resolveLaneDirection(['left', 'straight']).dir).toBe('left');
    // genelleştirme
    expect(resolveLaneDirection(['slight right', 'right']).dir).toBe('right');
    expect(resolveLaneDirection(['uturn', 'left']).dir).toBe('uturn');
  });

  it('🔒 tanınmayan gösterge DÜZ OK UYDURMAZ', () => {
    expect(resolveLaneDirection(['none']).dir).toBe('unknown');
    expect(resolveLaneDirection([]).dir).toBe('unknown');
    expect(resolveLaneDirection(['bilinmeyen']).dir).toBe('unknown');
    // ama listede tanınan bir gösterge varsa o kullanılır
    expect(resolveLaneDirection(['none', 'right']).dir).toBe('right');
  });

  it('🔒 büyük/küçük harf ve boşluk farkı sonucu değiştirmez', () => {
    expect(resolveLaneDirection([' Sharp Left ']).dir).toBe('sharp-left');
  });
});

describe('2 · vurgu semantiği — İKİ gerçek, ÜÇ durum', () => {
  it('🔒 `valid && active` → ROUTE_SELECTED', () => {
    expect(resolveLanePresentation(lane({ valid: true, active: true })).emphasis)
      .toBe('ROUTE_SELECTED');
  });

  it('🔒 `valid && !active` → ALLOWED (dönebilirsin ama önerilen değil)', () => {
    expect(resolveLanePresentation(lane({ valid: true, active: false })).emphasis)
      .toBe('ALLOWED');
  });

  it('🔒 `!valid` → NOT_ALLOWED — ALLOWED ile AYNI DEĞİL (ölçülen bilgi kaybı)', () => {
    const blocked = resolveLanePresentation(lane({ valid: false, active: false })).emphasis;
    const allowed = resolveLanePresentation(lane({ valid: true, active: false })).emphasis;
    expect(blocked).toBe('NOT_ALLOWED');
    expect(blocked).not.toBe(allowed);
  });

  it('🔒 `!valid && active` yine NOT_ALLOWED — geçersiz şerit önerilemez', () => {
    expect(resolveLanePresentation(lane({ valid: false, active: true })).emphasis)
      .toBe('NOT_ALLOWED');
  });

  it('🔒 üç durum GERÇEK veriden ayırt edilir — hiçbiri türetilmez', () => {
    const row = resolveLaneRow([
      lane({ valid: false, indications: ['left'] }),
      lane({ valid: true,  active: false, indications: ['straight'] }),
      lane({ valid: true,  active: true,  indications: ['right'] }),
    ]);
    expect(row?.map((l) => l.emphasis))
      .toEqual(['NOT_ALLOWED', 'ALLOWED', 'ROUTE_SELECTED']);
  });
});

describe('3 · kanıt yoksa panel yok (fail-closed)', () => {
  it('🔒 `null` / `undefined` / boş dizi → null', () => {
    expect(resolveLaneRow(null)).toBeNull();
    expect(resolveLaneRow(undefined)).toBeNull();
    expect(resolveLaneRow([])).toBeNull();
  });

  it('🔒 tek şerit bile olsa GERÇEK veri varsa satır döner', () => {
    expect(resolveLaneRow([lane({ indications: ['straight'] })])).toHaveLength(1);
  });
});

describe('4 · model SAF kalır', () => {
  const raw = readFileSync(
    resolve(process.cwd(), 'src/platform/navigation/core/laneGuidanceModel.ts'), 'utf8');
  /* Yorumlar soyulur: dosya kendi yasaklarını GEREKÇE olarak anlatıyor
     ("timer YOKTUR" gibi) — kilit KODA bakmalı, anlatıya değil. */
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('🔒 I/O · timer · global durum · React YOK', () => {
    for (const yasak of ['Date.now', 'setTimeout', 'setInterval', 'localStorage',
      'fetch(', 'from \'react\'', 'useState', 'window.']) {
      expect(src, `saf model içinde ${yasak} bulundu`).not.toContain(yasak);
    }
  });

  it('🔒 manevra tipinden şerit TÜRETİLMEZ (kanıtsız bilgi yasağı)', () => {
    expect(src).not.toContain('maneuverType');
    expect(src).not.toContain('maneuverModifier');
  });
});

describe('5 · bileşen sözleşmesi', () => {
  const hud = readFileSync(
    resolve(process.cwd(), 'src/components/map/NavigationHUD.tsx'), 'utf8');
  const laneBlock = hud.slice(hud.indexOf('function LaneArrowGlyph'),
                              hud.indexOf('function LaneGuidance'));

  it('🔒 şerit kutusunda GLOW ve GRADIENT yok (automotive görsel dil)', () => {
    expect(laneBlock, 'şerit kutusunda gradient geri geldi').not.toContain('linear-gradient');
    expect(laneBlock, 'şerit kutusunda glow geri geldi').not.toMatch(/box[Ss]hadow/);
  });

  it('🔒 vurgu bileşende YENİDEN HESAPLANMAZ — modelden okunur', () => {
    expect(laneBlock).toContain("lane.emphasis === 'ROUTE_SELECTED'");
    expect(laneBlock, 'bileşen iki gerçeği yine tek boolean\'a çöküyor')
      .not.toContain('active && ');
  });

  it('🔒 şerit satırı sarar — çok şeritli kavşak 800×480\'de taşmaz', () => {
    const guidance = hud.slice(hud.indexOf('function LaneGuidance'),
                               hud.indexOf('function LaneGuidance') + 1600);
    expect(guidance).toContain('flex-wrap');
  });
});
