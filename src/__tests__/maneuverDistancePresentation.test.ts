/**
 * maneuverDistancePresentation.test.ts — Adım 5 · manevra mesafesi SUNUMU.
 *
 * Kilitlenen sözleşme:
 *  · navigasyon GERÇEĞİ değişmez — burada yalnız sunum yuvarlaması vardır,
 *  · eşikler ve yuvarlama TEK kaynaktadır (`formatManeuverDistance` artık
 *    `splitManeuverDistance`ın ince sarmalayıcısıdır),
 *  · değer ve birim AYRI parçalardır ama tam metin (ekran okuyucu) korunur,
 *  · gereksiz ondalık basılmaz.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  formatManeuverDistance, splitManeuverDistance,
} from '../components/map/hud/formatManeuverDistance';

describe('1 · tarihsel eşikler BİREBİR korunur', () => {
  it('🔒 20 m altı "ŞİMDİ", birimsiz', () => {
    for (const m of [0, 5, 19.9]) {
      expect(splitManeuverDistance(m).value).toBe('ŞİMDİ');
      expect(splitManeuverDistance(m).unit).toBeNull();
    }
  });

  it('🔒 geçersiz/negatif girdi "—" (uydurma değer YOK)', () => {
    for (const m of [-1, NaN, Infinity]) {
      expect(splitManeuverDistance(m).value).toBe('—');
      expect(splitManeuverDistance(m).unit).toBeNull();
    }
  });

  it('🔒 100 m altı 10\'a, 1 km altı 50\'ye yuvarlanır', () => {
    expect(splitManeuverDistance(23)).toMatchObject({ value: '20', unit: 'm' });
    expect(splitManeuverDistance(97)).toMatchObject({ value: '100', unit: 'm' });
    expect(splitManeuverDistance(120)).toMatchObject({ value: '100', unit: 'm' });
    expect(splitManeuverDistance(130)).toMatchObject({ value: '150', unit: 'm' });
    expect(splitManeuverDistance(999)).toMatchObject({ value: '1000', unit: 'm' });
  });

  /* ── km yuvarlaması: eski `toFixed(1)` ile ÖLÇÜLMÜŞ fark ──────────────────
     Eski kod `(m/1000).toFixed(1)` kullanıyordu. `toFixed` ikilik taban
     kusuru taşır: `(2.05).toFixed(1) === "2.0"` (2,05 ikilikte 2,04999…).
     Yeni `Math.round(m/100)/10` matematiksel olarak DOĞRU yuvarlar → 2,1.
     ÖLÇÜLDÜ: 1–40 km arası 39.001 tam metrenin **156'sında (%0,40)** ayrışma
     var; hepsi tam `.5` sınırında ve yeni değer YUKARI yuvarlıyor. Sapma her
     zaman tek bir sunum basamağı (0,1 km) ile sınırlıdır.
     Bu bir TRUTH değişikliği DEĞİLDİR: `distanceToNextTurnMeters` aynen kalır,
     yalnız ekrandaki yuvarlama düzeltilmiştir. */
  it('🔒 km yuvarlaması eski davranıştan EN FAZLA bir sunum basamağı sapar', () => {
    let ayrisan = 0;
    for (let m = 1000; m <= 40000; m++) {
      const eski = Number((m / 1000).toFixed(1));
      const yeni = Number(splitManeuverDistance(m).value);
      const d = Math.abs(yeni - eski);
      expect(d, `m=${m} sapma bir basamağı aştı`).toBeLessThanOrEqual(0.1 + 1e-9);
      if (d > 1e-9) {
        ayrisan++;
        // ayrışma YALNIZ yukarı yönde ve yalnız `.5` sınırında olabilir
        expect(yeni, `m=${m} ayrışma aşağı yönde`).toBeGreaterThan(eski);
        expect(Math.abs((m / 100) % 1 - 0.5), `m=${m} .5 sınırında değil`).toBeLessThan(1e-9);
      }
    }
    // Ölçülen oran korunmalı: sessizce büyürse yuvarlama bozulmuş demektir.
    expect(ayrisan).toBe(156);
  });

  it('🔒 `.5` sınırında MATEMATİKSEL doğru yuvarlanır (`toFixed` float kusuru yok)', () => {
    expect((2.05).toFixed(1), 'float kusuru kaybolmuş — kilit artık kör').toBe('2.0');
    expect(splitManeuverDistance(2050).value).toBe('2.1');
  });
});

describe('2 · sunum iyileştirmesi', () => {
  it('🔒 gereksiz ondalık BASILMAZ (1.0 km → "1 km")', () => {
    expect(splitManeuverDistance(1000)).toMatchObject({ value: '1', unit: 'km' });
    expect(formatManeuverDistance(1000)).toBe('1 km');
    expect(splitManeuverDistance(2000).value).toBe('2');
    // ama gerçek ondalık KORUNUR
    expect(splitManeuverDistance(1234).value).toBe('1.2');
  });

  it('🔒 değer ve birim AYRI parçalardır', () => {
    const p = splitManeuverDistance(120);
    expect(p.value).toBe('100');
    expect(p.unit).toBe('m');
    expect(p.value).not.toContain('m');
  });

  it('🔒 tam metin (ekran okuyucu) korunur', () => {
    expect(splitManeuverDistance(120).fullText).toBe('100 m');
    expect(splitManeuverDistance(1000).fullText).toBe('1 km');
    expect(splitManeuverDistance(10).fullText).toBe('ŞİMDİ');
  });
});

describe('3 · TEK kaynak — ikinci mesafe otoritesi yok', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/components/map/hud/formatManeuverDistance.ts'), 'utf8');

  it('🔒 `formatManeuverDistance` parçalayıcının SARMALAYICISIDIR', () => {
    for (const m of [0, 15, 23, 97, 340, 999, 1000, 1234, 25000, -5, NaN]) {
      expect(formatManeuverDistance(m)).toBe(splitManeuverDistance(m).fullText);
    }
  });

  it('🔒 eşik sayıları YALNIZ bir kez yazılır (kopya tablo yok)', () => {
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect((kod.match(/m <\s*20\b/g) ?? []).length).toBe(1);
    expect((kod.match(/m <\s*100\b/g) ?? []).length).toBe(1);
    expect((kod.match(/m <\s*1000\b/g) ?? []).length).toBe(1);
  });

  it('🔒 model SAF — I/O · timer · React yok', () => {
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const yasak of ['Date.now', 'setTimeout', 'localStorage', 'from \'react\'', 'window.']) {
      expect(kod, `saf model içinde ${yasak}`).not.toContain(yasak);
    }
  });
});

describe('4 · kart sözleşmesi', () => {
  const panel = readFileSync(
    resolve(process.cwd(), 'src/components/map/hud/ManeuverPanel.tsx'), 'utf8');

  it('🔒 kart parçalayıcıyı KULLANIR — kendi eşiğini kurmaz', () => {
    expect(panel).toContain('splitManeuverDistance(distToTurnM)');
    expect(panel, 'kart kendi mesafe eşiğini kurmuş').not.toMatch(/m <\s*1000/);
  });

  it('🔒 birim DEĞERDEN küçüktür — birim değerin önüne geçmez', () => {
    expect(panel).toMatch(/fontSize: Math\.round\(distFont \* 0\.(?:[1-9])\d?\)/);
    const oran = Number(/distFont \* (0\.\d+)\)/.exec(panel)?.[1]);
    expect(oran).toBeGreaterThan(0);
    expect(oran, 'birim değer kadar ya da daha büyük basılıyor').toBeLessThan(1);
  });

  it('🔒 ekran okuyucu tam metni görür', () => {
    expect(panel).toContain('aria-label={dist.fullText}');
    expect(panel, 'birim ekran okuyucuya ikinci kez okunuyor').toContain('aria-hidden');
  });

  it('🔒 uzun yol adı mesafeyi İTEMEZ', () => {
    /* ⚠️ Bu kilit önce KÖRDÜ: `flexShrink: 0` tüm dosyada aranıyordu ve
       manevra OKUNUN span'ında da geçtiği için mesafeden kaldırılsa bile
       geçiyordu (mutasyonla ölçüldü). Artık YALNIZ mesafe span'ına bakar. */
    const i = panel.indexOf('data-testid="maneuver-distance"');
    expect(i, 'mesafe span bloku bulunamadi — kilit kor kalmis').toBeGreaterThan(0);
    const distSpan = panel.slice(i, panel.indexOf('</span>', i));
    expect(distSpan, 'mesafe span buzulme korumasini kaybetti')
      .toContain('flexShrink: 0');
    expect(panel, 'yol adı satırı taşma koruması kaybetmiş').toContain('truncate');
  });
});
