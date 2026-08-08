/**
 * hudTopBandLanes.test.ts — navigasyon HUD üst bandı DİKEYDE çakışmaz.
 *
 * ── KİLİTLENEN KUSUR ────────────────────────────────────────────────────────
 * Yoğunluk kapısı TEK EKSENLİYDİ (`useDenseHud`: yükseklik < 520). Bu, telefon
 * YATAYI için doğrudur ve sahada 2026-08-03'te ölçülerek ayarlandı. Ama tam
 * ekran navigasyon DİKEY de açılabiliyor (`acquireFullNavigationOrientation`,
 * `FullMapView.tsx:253`) ve dikeyde yükseklik 740–930 px olduğu için kapı hiç
 * kapanmıyordu → 360–430 px genişliğe TAM yerleşim çiziliyordu.
 *
 * 360 px viewport'ta ölçülen çakışma (her sayı bileşenlerin KENDİ stil
 * sabitlerinden türer):
 *   · TurnPanel      left 16 + width 288 → **16..304**
 *   · RoadSignsPanel merkez 180, dış genişlik ≈220 → **70..290**
 *   · ikisi de `top: --sat + 14` → **220 px yatay, tam dikey örtüşme**
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  1. Yatayda (head unit · telefon yatayı) bütçe kutunun doğal genişliğinden
 *     BÜYÜKTÜR → görünür etki YOK, mevcut yerleşim korunur.
 *  2. Dikeyde orta şerit tabelanın KENDİ `minWidth`ini karşılayamaz → tabela
 *     çizilmez (sıkıştırılmaz: `minWidth` kazanıp komşuya taşardı).
 *  3. `dense` YALNIZ yükseklik ölçütü kalır — genişlik ekseni onu EZMEZ.
 */

import { describe, it, expect } from 'vitest';
import {
  HUD_DENSE_MAX_H,
  HUD_NARROW_MAX_W,
  HUD_SIGN_MIN_W,
  HUD_TURN_LANE_RIGHT,
  HUD_SPEED_LANE_W,
  computeHudLayout,
} from '../hooks/useDenseHud';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const hudSrc  = read('src/components/map/NavigationHUD.tsx');
const hookSrc = read('src/hooks/useDenseHud.ts');

/**
 * ÜRÜNÜN KOŞTUĞU kararın kendisi sınanır — testte ikinci bir kopya KURULMAZ.
 * (`useHudLayout` bu fonksiyonu `useScreenSense` ölçümüyle besler; karar tek
 * yerdedir, bu yüzden oracle/ürün ayrışması YAPISAL olarak imkânsızdır.)
 */
const laneBudget = (w: number, h: number) => computeHudLayout(w, h).signBudgetPx;

/** `RoadSignsPanel`in doğal (kısıtsız) dış genişliği — kutunun kendi stilinden. */
const SIGN_NATURAL_W = 180 /* span maxWidth */ + 40 /* padding 20+20 */;

describe('Üst bant şerit bütçesi — viewport matrisi', () => {
  it('HEAD UNIT 1024×600: bütçe doğal genişlikten BÜYÜK → görünür etki YOK', () => {
    const b = laneBudget(1024, 600);
    expect(b, 'head unit\'te tabela sebepsiz gizlenmiş').not.toBeNull();
    expect(b as number, 'head unit yerleşimi daralmış — okunabilirlik regresyonu')
      .toBeGreaterThan(SIGN_NATURAL_W);
  });

  it('TELEFON YATAYI 904×406: yoğun modda da görünür etki YOK', () => {
    const b = laneBudget(904, 406);
    expect(b).not.toBeNull();
    expect(b as number, '2026-08-03\'te ayarlanan yatay yerleşim bozulmuş')
      .toBeGreaterThan(SIGN_NATURAL_W);
  });

  it('TELEFON DİKEYİ 360×740: orta şerit YOK → tabela çizilmez', () => {
    expect(laneBudget(360, 740), 'dikeyde tabela hâlâ çiziliyor — 220 px örtüşme geri geldi')
      .toBeNull();
  });

  it('BÜYÜK TELEFON DİKEYİ 430×930: yine yer yok', () => {
    expect(laneBudget(430, 930)).toBeNull();
  });

  it('TABLET DİKEYİ 800×1280: genişlik yeterli → tabela KALIR', () => {
    const b = laneBudget(800, 1280);
    expect(b, 'geniş dikey ekranda tabela gereksiz yere gizlenmiş').not.toBeNull();
    expect(b as number).toBeGreaterThanOrEqual(HUD_SIGN_MIN_W);
  });

  it('ÇAKIŞMA İMKÂNSIZ: bütçe verildiğinde kutu manevra kartına DEĞMEZ', () => {
    // Bütçe > 0 olan her genişlikte, merkez-çapalı kutunun sol kenarı sol
    // şeridin sağ kenarını GEÇEMEZ. Bu, bütçenin tanımının doğrudan sonucudur.
    for (const [w, h] of [[1024, 600], [904, 406], [800, 1280], [1280, 720], [572, 900]]) {
      const b = laneBudget(w, h);
      if (b === null) continue;
      const short = h < HUD_DENSE_MAX_H;
      const laneLeft = short ? HUD_TURN_LANE_RIGHT.dense : HUD_TURN_LANE_RIGHT.full;
      const boxLeft = w / 2 - b / 2;
      expect(boxLeft, `${w}×${h}: tabela manevra kartının üstüne biniyor`)
        .toBeGreaterThanOrEqual(laneLeft - 0.5);
    }
  });

  it('ÖLÇÜLEMEYEN GENİŞLİK: daraltma YAPILMAZ (fail-soft)', () => {
    expect(laneBudget(0, 600), 'ölçüm yokken ekran dar sayılmış').toBeNull();
  });
});

describe('Eşikler TÜRETİLMİŞTİR — serbest sabit değil', () => {
  it('dar-ekran eşiği üç şeridin toplamıdır', () => {
    expect(HUD_NARROW_MAX_W).toBe(
      HUD_TURN_LANE_RIGHT.full + HUD_SIGN_MIN_W + HUD_SPEED_LANE_W.full,
    );
  });

  it('tabela asgarisi, panelin KENDİ bildirdiği minWidth\'tir', () => {
    // Eşik uydurulursa panel kendi minWidth'ini karşılayamayan bir yere
    // sıkıştırılır ve komşu şeride taşar — kusurun kendisi budur.
    expect(HUD_SIGN_MIN_W).toBe(140);
    expect(hudSrc, 'RoadSignsPanel minWidth değişmiş — eşik artık yanlış')
      .toContain('minWidth: 140');
  });

  it('şerit sabitleri TurnPanel\'in gerçek ölçüleriyle uyumlu', () => {
    // Ayrışırsa bütçe yanlış hesaplanır ve çakışma sessizce geri gelir.
    expect(hudSrc).toContain('width: dense ? 208 : 288');
    expect(hudSrc).toMatch(/left: dense \? 'max\(96px/);
    expect(HUD_TURN_LANE_RIGHT.full).toBe(16 + 288);
    expect(HUD_TURN_LANE_RIGHT.dense).toBe(96 + 208);
  });

  it('telefon yatayı ve head unit dar SAYILMAZ', () => {
    expect(904).toBeGreaterThanOrEqual(HUD_NARROW_MAX_W);
    expect(1024).toBeGreaterThanOrEqual(HUD_NARROW_MAX_W);
    expect(360).toBeLessThan(HUD_NARROW_MAX_W);
    expect(430).toBeLessThan(HUD_NARROW_MAX_W);
    expect(800, 'tablet dikeyi gereksiz yere daraltılmış').toBeGreaterThanOrEqual(HUD_NARROW_MAX_W);
  });
});

describe('YAPISAL kilitler — eksenler karışmaz, ikinci gözlemci doğmaz', () => {
  it('🔒 `dense` YALNIZ yükseklik ölçütü kalır', () => {
    expect(hookSrc).toMatch(/height\s*>\s*0\s*&&\s*height\s*<\s*HUD_DENSE_MAX_H/);
    expect(hookSrc, 'yükseklik eşiği genişliğe uygulanmış').not.toMatch(/width\s*<\s*HUD_DENSE_MAX_H/);
    // Üstteki paneller genişlik eksenini ALMAZ: yoğun varyantları yüksekliği
    // GENİŞLİĞE takas eder, dikeyde ters yönde yanlış olur.
    expect(hudSrc).toContain('dense={denseHud}');
    expect(hudSrc, 'TurnPanel/SpeedPanel genişlik eksenine bağlanmış')
      .not.toContain('dense={denseHud || narrowHud}\n                dense');
  });

  it('🔒 alt bar İKİ eksene de duyarlıdır (3 sütunlu şerit dikeyde taşıyordu)', () => {
    expect(hudSrc).toContain('dense={denseHud || narrowHud}');
  });

  it('🔒 `narrow` GÜVENLİK modlarıyla KARIŞTIRILMAZ', () => {
    // `compact` = CRITICAL, `limp` = LIMP_HOME → bilişsel yük azaltma kararı.
    // `narrow` yalnız yerleşimdir; birleşirse dar ekran sessizce güvenlik modu
    // sanılır ve alanlar gizlenir.
    expect(hudSrc).not.toContain('compact={narrowHud}');
    expect(hudSrc).not.toContain('limp={narrowHud}');
    expect(hudSrc).not.toContain('compact={denseHud || narrowHud}');
  });

  it('🔒 `narrow` ekseni de ÜRÜNÜN kararından okunur (ikinci eşik yok)', () => {
    expect(computeHudLayout(360, 740).narrow, 'telefon dikeyi dar sayılmıyor').toBe(true);
    expect(computeHudLayout(904, 406).narrow, 'telefon yatayı yanlışlıkla dar sayılmış').toBe(false);
    expect(computeHudLayout(1024, 600).narrow, 'head unit yanlışlıkla dar sayılmış').toBe(false);
    // `short` bugünkü `dense` ile BİREBİR aynı kalmalı — yükseklik ekseni kaymadı.
    expect(computeHudLayout(904, 406).short).toBe(true);
    expect(computeHudLayout(1024, 600).short).toBe(false);
    expect(computeHudLayout(360, 740).short, 'dikey ekran yanlışlıkla kısa sayılmış').toBe(false);
  });

  it('🔒 ÜÇÜNCÜ ekran gözlemcisi kurulmaz', () => {
    // Üründe zaten iki tane var (LayoutContext resize + useScreenSense RO).
    expect(hookSrc).toContain("from './useScreenSense'");
    expect(hookSrc, 'hook kendi dinleyicisini kurmuş').not.toMatch(/addEventListener|ResizeObserver|setInterval|setTimeout/);
  });

  it('🔒 bütçe HER İKİ çağrı yerine de geçirilir', () => {
    // İkinci `RoadSignsPanel` (steps boş → yedek panel) unutulursa çakışma
    // yalnız o dalda geri gelir ve fark edilmez.
    const calls = hudSrc.match(/<RoadSignsPanel/g) ?? [];
    const budgets = hudSrc.match(/budgetPx=\{signBudgetPx\}/g) ?? [];
    expect(calls.length, 'RoadSignsPanel çağrısı yok').toBeGreaterThan(0);
    expect(budgets.length, 'bir RoadSignsPanel bütçesiz kalmış').toBe(calls.length);
  });

  it('🔒 tabela sıkıştırılmaz, GİZLENİR', () => {
    expect(hudSrc).toContain('if (budgetPx === null) return null;');
  });
});
