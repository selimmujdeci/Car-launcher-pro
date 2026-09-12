/**
 * colorMath.test.ts — SINIRSIZ renk seçicinin matematik KİLİDİ
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Kullanıcı: *"renkler yeterli değil sınırsız renk lazım ve yazılarda da renk
 * az."* Ölçülen durum: renk alanları 16 hazır renk + native `<input
 * type="color">` sunuyordu. Native seçici **saydamlığı hiç vermez** ve
 * tarayıcıya göre değişir → kullanıcı pratikte 16 renge mahkûmdu.
 *
 * EN KRİTİK KİLİT: seçicinin ÜRETTİĞİ her değer manifest sözleşmesinden
 * (`isSafeColor`) geçmek zorundadır. Geçmezse renk sessizce DÜŞER — kullanıcı
 * rengi seçer, hiçbir hata görmez, ama araçta hiçbir şey değişmez. Bu, bu
 * projede daha önce yaşanmış sessiz-ölüm desenidir.
 *
 * Kilitler ZAYIFLATILMAZ/SİLİNMEZ; davranış bilinçli değişirse GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseColor, rgbaToHex, rgbToHsv, hsvToRgb, hsvToHex, parseToHsv,
  hslToRgba, normalizeAlpha, relativeLuminance, contrastRatio,
  NEUTRAL_TEXT_RAMP,
} from '@/lib/theme/colorMath';
import { isSafeColor } from '@/lib/theme/themeManifest';

describe('renk ayrıştırma — desteklenen HER yazım okunur', () => {
  it('🔒 #RGB · #RGBA · #RRGGBB · #RRGGBBAA', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#FF0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#00ff0080')?.g).toBe(255);
    expect(parseColor('#00ff0080')?.a).toBeCloseTo(0.502, 2);
    expect(parseColor('#0f08')?.a).toBeCloseTo(0.533, 2);
  });

  it('🔒 rgb() / rgba() / hsl() / hsla()', () => {
    expect(parseColor('rgb(18, 52, 86)')).toEqual({ r: 18, g: 52, b: 86, a: 1 });
    expect(parseColor('rgba(18,52,86,0.5)')?.a).toBe(0.5);
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('hsla(120, 100%, 50%, 0.25)')).toEqual({ r: 0, g: 255, b: 0, a: 0.25 });
  });

  it('🔒 tanınmayan girdi NULL — uydurma renk üretilmez', () => {
    for (const bad of ['', '   ', 'kırmızı', '#12345', '#gggggg', 'rgb(1,2)', 'javascript:alert(1)',
      'url(x)', 'rgb(1,2,3,4,5)', null, undefined, 42 as unknown as string]) {
      expect(parseColor(bad as string | null), `'${String(bad)}' kabul edildi`).toBeNull();
    }
  });

  it('🔒 büyük/küçük harf ve boşluk toleransı', () => {
    expect(parseColor('  #AbCdEf  ')).toEqual(parseColor('#abcdef'));
    expect(parseColor('RGB( 1 , 2 , 3 )')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });
});

describe('kanonik yazım — hex ÜRETİLİR', () => {
  it('🔒 alfa 1 ise 6 hane, alfa <1 ise 8 hane', () => {
    expect(rgbaToHex({ r: 255, g: 0, b: 0, a: 1 })).toBe('#ff0000');
    expect(rgbaToHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080');
  });

  it('🔒 kanal sınırları kırpılır (taşma yazıya sızmaz)', () => {
    expect(rgbaToHex({ r: 300, g: -20, b: 128.6, a: 5 })).toBe('#ff0081');
  });

  it('🔒 alfa 3 basamağa normalize edilir (kayan nokta gürültüsü yok)', () => {
    expect(normalizeAlpha(0.30000000000000004)).toBe(0.3);
    expect(normalizeAlpha(Number.NaN)).toBe(1);
    expect(normalizeAlpha(-3)).toBe(0);
    expect(normalizeAlpha(9)).toBe(1);
  });
});

describe('HSV ↔ RGB — seçicinin taşıyıcı matematiği', () => {
  it('🔒 saf tonlar doğru açıya düşer', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0, a: 1 }).h).toBeCloseTo(0, 3);
    expect(rgbToHsv({ r: 255, g: 255, b: 0, a: 1 }).h).toBeCloseTo(60, 3);
    expect(rgbToHsv({ r: 0, g: 255, b: 0, a: 1 }).h).toBeCloseTo(120, 3);
    expect(rgbToHsv({ r: 0, g: 255, b: 255, a: 1 }).h).toBeCloseTo(180, 3);
    expect(rgbToHsv({ r: 0, g: 0, b: 255, a: 1 }).h).toBeCloseTo(240, 3);
    expect(rgbToHsv({ r: 255, g: 0, b: 255, a: 1 }).h).toBeCloseTo(300, 3);
  });

  it('🔒 gri tonlarında doygunluk 0, ton 0 (NaN üretilmez)', () => {
    const g = rgbToHsv({ r: 128, g: 128, b: 128, a: 1 });
    expect(g.s).toBe(0);
    expect(Number.isFinite(g.h)).toBe(true);
    expect(rgbToHsv({ r: 0, g: 0, b: 0, a: 1 }).v).toBe(0);
  });

  it('🔒 gidiş-dönüş 256 renkte kayıpsız (±1 yuvarlama)', () => {
    let worst = 0;
    for (let i = 0; i < 256; i++) {
      const src = { r: (i * 7) % 256, g: (i * 13) % 256, b: (i * 29) % 256, a: 1 };
      const back = hsvToRgb(rgbToHsv(src));
      worst = Math.max(worst,
        Math.abs(back.r - src.r), Math.abs(back.g - src.g), Math.abs(back.b - src.b));
    }
    expect(worst, `gidiş-dönüş sapması ${worst}`).toBeLessThanOrEqual(1);
  });

  it('🔒 ton sarması negatif ve >360 girdide çalışır', () => {
    expect(hsvToHex({ h: -30, s: 1, v: 1, a: 1 })).toBe(hsvToHex({ h: 330, s: 1, v: 1, a: 1 }));
    expect(hsvToHex({ h: 400, s: 1, v: 1, a: 1 })).toBe(hsvToHex({ h: 40, s: 1, v: 1, a: 1 }));
  });

  it('🔒 saydamlık HSV yolundan geçerken KORUNUR', () => {
    expect(hsvToHex(parseToHsv('#3366cc80')!)).toBe('#3366cc80');
  });

  it('🔒 HSL yolu HSV ile aynı rengi verir', () => {
    expect(rgbaToHex(hslToRgba(210, 0.5, 0.4))).toBe(rgbaToHex(parseColor('hsl(210,50%,40%)')!));
  });
});

describe('SÖZLEŞME — üretilen her renk manifestten GEÇER', () => {
  it('🔒 tüm HSV uzayından üretilen hex `isSafeColor`dan geçer', () => {
    const bad: string[] = [];
    for (let h = 0; h < 360; h += 7) {
      for (let s = 0; s <= 1.0001; s += 0.25) {
        for (let v = 0; v <= 1.0001; v += 0.25) {
          for (const a of [0, 0.001, 0.5, 0.999, 1]) {
            const hex = hsvToHex({ h, s, v, a });
            if (!isSafeColor(hex)) bad.push(hex);
          }
        }
      }
    }
    expect(bad.slice(0, 5), `manifest reddetti: ${bad.slice(0, 5).join(', ')}`).toEqual([]);
  });

  it('🔒 hazır renklerin ve nötr rampanın HEPSİ ayrıştırılabilir + güvenli', () => {
    for (const c of NEUTRAL_TEXT_RAMP) {
      expect(parseColor(c), `${c} ayrıştırılamadı`).not.toBeNull();
      expect(isSafeColor(c), `${c} manifestten geçmedi`).toBe(true);
    }
  });
});

describe('yazı renkleri — nötr rampa gerçekten RAMPA', () => {
  it('🔒 parlaklık monotonik azalır (beyazdan siyaha)', () => {
    const lums = NEUTRAL_TEXT_RAMP.map((c) => relativeLuminance(parseColor(c)!));
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i], `${NEUTRAL_TEXT_RAMP[i - 1]} → ${NEUTRAL_TEXT_RAMP[i]} artmış`)
        .toBeLessThan(lums[i - 1]);
    }
    expect(lums[0]).toBeCloseTo(1, 3);
    expect(lums[lums.length - 1]).toBeCloseTo(0, 3);
  });

  it('🔒 rampa hem koyu hem açık zemine okunur seçenek sunar', () => {
    const dark = parseColor('#111a2b')!;
    const light = parseColor('#f3f5f9')!;
    const okOnDark = NEUTRAL_TEXT_RAMP.filter((c) => contrastRatio(parseColor(c)!, dark) >= 4.5);
    const okOnLight = NEUTRAL_TEXT_RAMP.filter((c) => contrastRatio(parseColor(c)!, light) >= 4.5);
    expect(okOnDark.length, 'koyu zeminde WCAG AA veren nötr ton yok').toBeGreaterThanOrEqual(4);
    expect(okOnLight.length, 'açık zeminde WCAG AA veren nötr ton yok').toBeGreaterThanOrEqual(4);
  });

  it('🔒 kontrast ölçümü doğru (beyaz↔siyah = 21)', () => {
    expect(contrastRatio(parseColor('#fff')!, parseColor('#000')!)).toBeCloseTo(21, 2);
    expect(contrastRatio(parseColor('#777')!, parseColor('#777')!)).toBeCloseTo(1, 6);
  });
});

describe('arayüz sözleşmesi — kaynak kilidi', () => {
  /** Yorumları soy — tarihsel açıklamalar kaynak kilitlerini düşürmesin.
   *  ("Native `<input type=color>` KALDIRILDI" yorumu, tam da o deseni arayan
   *   kilidi yanlışlıkla tetikliyordu.) */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const CTRL = stripComments(readFileSync(
    join(process.cwd(), 'src', 'components', 'pwa', 'theme', 'ThemeControls.tsx'), 'utf8'));
  const PICK = readFileSync(
    join(process.cwd(), 'src', 'components', 'pwa', 'theme', 'ColorPicker.tsx'), 'utf8');

  it('🔒 native `<input type="color">` GERİ GELMEZ (saydamlığı öldürür)', () => {
    /* Yorumdaki tarihsel açıklama kilidi düşürmesin — JSX deseni aranır. */
    expect(CTRL, 'native renk girdisi geri gelmiş — saydamlık kaybolur')
      .not.toMatch(/<input\s[^>]*type="color"/);
  });

  it('🔒 renk alanı sınırsız seçiciyi kullanır', () => {
    expect(CTRL).toContain('<ColorPicker');
    expect(CTRL).toContain('TEXT_SWATCHES');
  });

  it('🔒 seçici sürüklerken `onChange` selini rAF ile kısıtlar', () => {
    /* Her değişim iframe'e canlı manifest yayını tetikler; 60 Hz'de sel olur. */
    expect(PICK).toContain('requestAnimationFrame');
    expect(PICK, 'rAF iptali yok — unmount sonrası setState riski')
      .toContain('cancelAnimationFrame');
  });

  it('🔒 dokunmatik sürükleme alandan çıkınca kopmaz', () => {
    expect(PICK).toContain('setPointerCapture');
    expect(PICK).toContain("touchAction: 'none'");
  });

  it('🔒 ton ve saydamlık klavyeyle de değişir (erişilebilirlik)', () => {
    expect(PICK).toContain("role=\"slider\"");
    expect(PICK).toContain('ArrowLeft');
  });

  it('🔒 yazı alanları NÖTR RAMPAYI kısayol olarak sunar', () => {
    const ED = readFileSync(
      join(process.cwd(), 'src', 'components', 'pwa', 'theme', 'ThemeEditors.tsx'), 'utf8');
    const n = ED.split('swatches={TEXT_SWATCHES}').length - 1;
    expect(n, `yalnız ${n} yazı alanı rampayı kullanıyor`).toBeGreaterThanOrEqual(5);
  });
});
