/**
 * #657 — SÜTUN (bölge) GENİŞLİĞİ kilitleri.
 *
 * Kullanıcı isteği: "sütun genişliği". Raylar bugüne dek SABİT `clamp()`
 * değerleriyle çiziliyordu ve hiçbir tema ayarıyla değişmiyordu.
 *
 * TASARIM: mutlak piksel DEĞİL ÇARPAN. Ölçülmüş ders (kütük: "HU px/metre
 * ölçüleri telefonda ÇÖKÜYOR") — oran ile mutlak aynı formülde buluşunca
 * farklı ekran boyutlarında taşma/ezilme çıkıyor. Çarpan, temanın kendi
 * duyarlı `clamp` sınırlarını korur.
 */
import { describe, it, expect } from 'vitest';
import {
  coerceZoneWidths, createThemeManifest, parseIncomingManifest,
  SCALABLE_ZONES, ZONE_SCALE_MIN, ZONE_SCALE_MAX,
} from '../platform/theme/themeManifest';

describe('bölge genişliği — sözleşme', () => {
  it('KİLİT: yeni manifest boş başlar (mevcut ekran birebir korunur)', () => {
    const m = createThemeManifest('expedition');
    expect(m.zoneWidths).toEqual({});
  });

  it('KİLİT: aralık dışı değer SINIRA KIRPILIR (deponun ortak kuralı)', () => {
    /* `num()` bu depoda her sayısal alanda KIRPAR, reddetmez — ve bu doğrudur:
       reddetmek kullanıcının niyetini sessizce düşürürdü. Kilit, sınırların
       gerçekten uygulandığını (taşan değerin ekrana ULAŞMADIĞINI) korur. */
    const z = coerceZoneWidths({ 'left-rail': 99, 'right-rail': -3 });
    expect(z['left-rail'], 'üst sınır uygulanmamış — sütun ekranı taşırabilir').toBe(ZONE_SCALE_MAX);
    expect(z['right-rail'], 'alt sınır uygulanmamış — sütun yok olabilir').toBe(ZONE_SCALE_MIN);
  });

  it('KİLİT: sayı olmayan değer DÜŞER (zero-trust)', () => {
    const z = coerceZoneWidths({ 'left-rail': 'geniş', 'right-rail': null });
    expect(Object.keys(z)).toHaveLength(0);
  });

  it('KİLİT: geçerli değer korunur, sınırlar dâhil', () => {
    const z = coerceZoneWidths({ 'left-rail': ZONE_SCALE_MIN, 'right-rail': ZONE_SCALE_MAX });
    expect(z['left-rail']).toBe(ZONE_SCALE_MIN);
    expect(z['right-rail']).toBe(ZONE_SCALE_MAX);
  });

  it('KİLİT: orta sahne ölçeklenemez (esnek bölge — sahte alan yok)', () => {
    expect(SCALABLE_ZONES).not.toContain('center-stage');
    expect(SCALABLE_ZONES).not.toContain('dock');
    const z = coerceZoneWidths({ 'center-stage': 1.4 });
    expect(Object.keys(z)).toHaveLength(0);
  });

  it('KİLİT: bilinmeyen bölge adı sessizce düşer (zero-trust)', () => {
    const z = coerceZoneWidths({ 'sol-taraf': 1.2, 'left-rail': 1.2 });
    expect(Object.keys(z)).toEqual(['left-rail']);
  });

  it('KİLİT: alan eksik gelen ESKİ manifest reddedilmez (geri-uyum)', () => {
    /* Eski PWA sürümü `zoneWidths` göndermez. Şema sürümü BİLEREK
       yükseltilmediği için araç bu manifesti kabul etmeli ve alanı boş
       saymalıdır — aksi hâlde eski telefon aracın temasını komple kırardı. */
    const r = parseIncomingManifest({ schemaVersion: 3, themeId: 'pro' });
    expect(r.ok, 'eski manifest reddedildi — eski telefon aracın temasını kırar').toBe(true);
    if (r.ok) expect(r.manifest.zoneWidths).toEqual({});
  });
});

describe('bölge genişliği — kablolama (yapısal)', () => {
  const oku = (rel: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs') as typeof import('node:fs')).readFileSync(rel, 'utf8');

  it('KİLİT: manifest → store TEK kapıdan geçer', () => {
    const rt = oku('src/platform/theme/themeRuntime.ts');
    expect(rt, 'applyZoneWidths çağrılmıyor — ayar araca ULAŞMAZ')
      .toContain('applyZoneWidths(m.zoneWidths, m.themeId)');
  });

  it('KİLİT: iki solver teması da çarpanı OKUR (ölü ayar bırakılmaz)', () => {
    for (const t of ['ExpeditionLayout', 'ProLayout']) {
      const src = oku(`src/components/themes/${t}.tsx`);
      expect(src, `${t} useZoneWidths okumuyor — sütun genişliği ölü ayar olur`)
        .toContain('useZoneWidths(');
    }
  });

  it('KİLİT: sütun genişliği MUTLAK piksel olarak saklanmaz', () => {
    const mf = oku('src/platform/theme/themeManifest.ts');
    const i = mf.indexOf('export const ZONE_SCALE_MIN');
    expect(i, 'ölçek sınırları kaldırılmış').toBeGreaterThan(-1);
    expect(mf.slice(i, i + 200), 'sınırlar piksel gibi görünüyor — oran sözleşmesi bozulmuş')
      .toMatch(/ZONE_SCALE_MIN = 0\.\d/);
  });
});
