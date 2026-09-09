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

  it('AYRI TABELA KALDIRILDI — çakışmanın KÖKÜ yok edildi', () => {
    /* P0-NAV-04: üst-orta "bulunulan sokak" tabelası sürüş ekranından
       ÇIKARILDI. Bu dosyanın kilitlediği çakışma (manevra kartı × tabela)
       artık YAPISAL OLARAK imkânsızdır: ortada bir kutu yok.
       Kilit KALDIRILMADI — kökün geri gelmediğini doğrular. */
    expect(hudSrc, 'ayrı sokak tabelası geri gelmiş').not.toContain('RoadSignsPanel');
    /* Eşik sabiti korunur: `useHudLayout` hâlâ bütçeyi hesaplar ve ileride
       merkez-çapalı bir öğe eklenirse aynı kapı kullanılacaktır. */
    expect(HUD_SIGN_MIN_W).toBe(140);
  });

  it('manevra kartı ölçüleri şerit sabitleriyle TUTARLI', () => {
    /* Kart yeniden tasarlandı: yatayda 316 px (yaklaşmada 360), sol kenar 12.
       Şerit sabitleri EN GENİŞ kart varyantını kapsamalı. */
    const panel = read('src/components/map/hud/ManeuverPanel.tsx');
    expect(panel).toContain('width: portrait ? undefined : (big ? 360 : 316)');
    expect(panel).toContain("left: 'max(12px, var(--sal, 0px))'");
    /* Yeni kartın en sağ kenarı (12+360=372) eski şerit sınırından (16+288=304)
       BÜYÜKTÜR — kart bilinçli olarak genişledi. Kilit, kartın viewport'a
       kırpıldığını ve merkez şeridi işgal ETMEDİĞİNİ doğrular. */
    expect(12 + 360).toBeGreaterThan(HUD_TURN_LANE_RIGHT.full);
    expect(panel).toContain("maxWidth: 'calc(100vw - 24px)'");
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
    expect(hookSrc, 'yükseklik eşiği genişliğe uygulanmış')
      .not.toMatch(/width\s*<\s*HUD_DENSE_MAX_H/);
    /* P0-NAV-04: HUD artık `dense` prop'u yerine SAF modeldeki `layout`
       ölçütünü kullanıyor; eksen ayrımı KORUNDU. */
    expect(hudSrc, 'yerleşim güvenlik moduna bağlanmış')
      .not.toMatch(/layout:\s*(suppCrit|isLimp)/);
    expect(hudSrc).toContain("layout: narrowHud ? 'PORTRAIT' : 'LANDSCAPE'");
  });

  it('🔒 yolculuk özeti DİKEYDE yeniden akar (sıkıştırılmış kopya değil)', () => {
    /* Eski 3 sütunlu şerit dikeyde taşıyordu ve çözüm "yoğun ölçüler"di.
       P0-NAV-04: özet yerleşimini `hud.layout`tan okur ve dikeyde ölçüleri
       ayrıca küçültür — yatayın sıkıştırılmışı DEĞİL. */
    const trip = read('src/components/map/hud/TripSummary.tsx');
    expect(trip).toContain("const portrait = hud.layout === 'PORTRAIT';");
    expect(trip).toContain('fontSize: portrait ? 22 : 26');
    /* ── KİLİT SABİT SAYIYA DEĞİL DAVRANIŞA BAĞLI (2026-09-09) ─────────────
       Eskiden tam metin `… : 460` aranıyordu. 460 px kart üç eşit hücreye
       bölününce mesafe değeri kırpılıyordu ("34…" saha kusuru, kütük #1220) ve
       genişlik 520'ye çıkarıldı — kilidin KORUDUĞU davranış (dikeyde viewport
       göreli yeniden akış · yatayda ekranın tamamını KAPLAMAMA) bozulmadığı
       hâlde kilit yalnız sayı değiştiği için düşüyordu. Artık ölçüt ölçülür:
       dikey viewport-göreli, yatay SABİT ve makul bir tavanla sınırlı. */
    const m = trip.match(/maxWidth: portrait \? 'calc\(100vw - 24px\)' : (\d+)/);
    expect(m, 'özet yerleşimi yerleşimden okunmuyor').not.toBeNull();
    const landscapeMax = Number(m![1]);
    expect(landscapeMax, 'özet tüm genişliği kaplamaya dönmüş')
      .toBeLessThanOrEqual(560);
    /* En uzun mesafe biçimi ("9999 km" · 8 karakter) 26 px tabular rakamla
       üç eşit hücrenin birine sığmalı — aksi hâlde `truncate` yine kırpar. */
    expect(landscapeMax, 'kart mesafe hücresini kırpacak kadar dar')
      .toBeGreaterThanOrEqual(500);
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

  it('🔒 HER İKİ manevra dalı da AYNI karta gider (dal unutulmaz)', () => {
    /* Eski kusur: iki `RoadSignsPanel` çağrısından biri bütçesiz kalırsa
       çakışma yalnız o dalda geri gelirdi. Aynı risk yeni kartta da var. */
    const calls = hudSrc.match(/<ManeuverPanel/g) ?? [];
    expect(calls.length, 'manevra kartı çağrısı yok').toBeGreaterThanOrEqual(2);
    const withHud = hudSrc.match(/hud=\{hud\}/g) ?? [];
    expect(withHud.length, 'bir dal sunum hükmü olmadan çiziliyor')
      .toBeGreaterThanOrEqual(calls.length);
  });

  it('🔒 kart SIKIŞTIRILMAZ, viewporta KIRPILIR', () => {
    /* Eski kural "yer yoksa çizme"ydi. Yeni kartta karşılığı: dikeyde tam
       genişliğe yayılır, yatayda `maxWidth` ile viewport'a kırpılır. */
    const panel = read('src/components/map/hud/ManeuverPanel.tsx');
    expect(panel).toContain("maxWidth: 'calc(100vw - 24px)'");
    expect(panel).toContain("right: portrait ? 'max(12px, var(--sar, 0px))' : undefined");
  });
});
