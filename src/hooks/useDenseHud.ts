/**
 * useDenseHud — dar (kısa) ekran yoğunluk kapısı. TEK KAYNAK.
 *
 * ── NEDEN (saha 2026-08-03) ────────────────────────────────────────────────
 * Navigasyon HUD'u head unit için SABİT px ölçülerle yazılmıştı. Telefon
 * yatayında CSS yüksekliği ~406 px'e düşünce kartlar hem haritayı kapatıyor
 * hem BİRBİRİNİ örtüyordu. Cihazda ölçülen çakışmalar (904×406):
 *   • hız paneli (814,81,76×66) ↔ zoom butonları (836,92,54×166) → 54×55 px
 *   • GPS rozeti + km çipi (15,15) ↔ dönüş kartı (36,9,208×55) → 47×20 px
 *
 * Ölçüt YÜKSEKLİKTİR, genişlik değil: 7" head unit (800×480) GENİŞtir ama
 * yüksekliği vardır ve tam HUD'a yer verir; telefon yatayında daralan boyut
 * yüksekliktir. Genişlik ölçütü head unit'i de yanlışlıkla küçültürdü.
 *
 * ⚠️ Bu eşik BİRDEN FAZLA bileşende kullanılır (NavigationHUD · MapHudControls).
 * Kopyalanırsa biri güncellenip diğeri unutulur ve yerleşim yeniden çakışır —
 * bu yüzden tanım BURADA tektir ve kilitle sabitlenmiştir.
 */

import { useScreenSense } from './useScreenSense';

/** Bu CSS yüksekliğinin ALTINDA HUD yoğun moda geçer (px). */
export const HUD_DENSE_MAX_H = 520;

export function useDenseHud(): boolean {
  const { height } = useScreenSense();
  return height > 0 && height < HUD_DENSE_MAX_H;
}

/* ══════════════════════════════════════════════════════════════════════════
   ÜST BANT ŞERİT BÜTÇESİ — dikey ekranın kapatılmamış ekseni
   ══════════════════════════════════════════════════════════════════════════

   ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
   Yukarıdaki kapı YÜKSEKLİĞE bakar ve bu YATAY için doğrudur (yorumdaki
   gerekçe geçerli). Ama tam ekran navigasyon dikey de açılabiliyor
   (`navigationOrientation.acquireFullNavigationOrientation`,
   `FullMapView.tsx:253`) ve dikeyde yükseklik 740–930 px olduğu için kapı
   HİÇ kapanmıyor → 360–430 px genişliğe TAM yerleşim çiziliyor.

   360 px viewport'ta ölçülen çakışma (hepsi bu dosyaların kendi sabitlerinden
   türer, tahmin değil):
     · `TurnPanel`      → left 16 + width 288  = **16..304**   (NavigationHUD.tsx:564,566)
     · `RoadSignsPanel` → merkez 180, dış genişlik ≈220 = **70..290** (:682,688)
     · ikisi de `top: --sat + 14` → **220 px yatay örtüşme, tam dikey örtüşme**
   Yani 2026-08-03'te telefon YATAYI için ölçülüp kapatılan kusurun (bkz.
   yukarıdaki gerekçe) birebir aynısı, DİKEYDE geri geliyor.

   ── NEDEN İKİNCİ BİR YERLEŞİM KOPYASI DEĞİL ──────────────────────────────
   `dense` varyantları yüksekliği GENİŞLİĞE takas eder (`SpeedPanel`
   `flex-col → flex-row-reverse`, zoom kolonu alt→üst çapa). Dikeyde kıt olan
   eksen genişlik olduğu için aynı varyantı yeniden kullanmak TERS yönde
   yanlış olurdu. Bu yüzden `dense` AYNEN yükseklik ölçütü kalır ve genişlik
   ayrı, kendi ölçütüyle ele alınır — tek hook, iki eksen, tek yerleşim ağacı.

   ── ŞERİT MODELİ ─────────────────────────────────────────────────────────
   Üst bantta üç şerit vardır ve bugün hiçbiri diğerinin yerini BİLMİYOR:
   sol (manevra kartı) · orta (yol tabelası) · sağ (hız paneli). Orta şerit
   merkez-çapalı olduğu için, kendisine kalan yeri ancak yan şeritlerin
   sınırlarından hesaplayabilir. Bu dosya o hesabın TEK kaynağıdır.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * SOL ŞERİDİN sağ kenarı (px) — manevra kartının kapladığı yer.
 * Değerler `NavigationHUD.TurnPanel`in KENDİ stil sabitlerinden gelir
 * (`left: dense ? 96 : 16` + `width: dense ? 208 : 288`); kilit testi ikisinin
 * ayrışmadığını denetler.
 */
export const HUD_TURN_LANE_RIGHT = { dense: 96 + 208, full: 16 + 288 } as const;

/**
 * SAĞ ŞERİDİN genişliği (px) — hız paneli + sağ kenar boşluğu.
 *
 * Türetme (`NavigationHUD.SpeedPanel`, `:898-936`): kutunun `minWidth` tabanı
 * 76 px'tir ama ÜÇ HANELİ hızda içerik tabanı aşar: `fontSize: 38`,
 * `font-black`, `tabular-nums` → hane genişliği ≈ 0.62 em ≈ 23,6 px →
 * 3 × 23,6 ≈ 71 px metin + `px-4` (2 × 16 = 32) ≈ **103 px**. Buna `right-4`
 * (16 px) eklenir. Üstüne ~9 px görsel oluk bırakılır ki tabela hız paneline
 * DEĞMESİN → 128. `dense`te levha hızın SOLUNA alınır (`flex-row-reverse`,
 * gap 10 + levha çapı tavanı 56) → +66.
 *
 * Fazla pay güvenli yöndedir: şerit ne kadar geniş sayılırsa orta şerit o
 * kadar erken kapanır; eksik pay çakışma demektir.
 */
export const HUD_SPEED_LANE_W = { dense: 128 + 66, full: 128 } as const;

/**
 * Orta şerit bu genişliğin altına düşerse yol tabelası ÇİZİLMEZ.
 *
 * Uydurulmuş bir eşik DEĞİLDİR: tabelanın KENDİ bildirdiği asgari genişliktir
 * (`RoadSignsPanel` → `minWidth: 140`, `NavigationHUD.tsx:688`). Panel kendi
 * asgarisini karşılayamayacağı bir yere sıkıştırılmaz; sıkıştırılırsa
 * `minWidth` kazanır ve komşu şeritlerin ÜSTÜNE taşar — kusurun kendisi budur.
 */
export const HUD_SIGN_MIN_W = 140;

/**
 * Bu genişliğin ALTINDA alt bilgi çubuğu yoğun ölçülere geçer (px).
 *
 * Sabit DEĞİL, türetilmiştir: üst bandın tam yerleşimi ancak üç şeridin
 * hepsi sığdığında anlamlıdır → `sol şerit + tabela asgarisi + sağ şerit`.
 * Bunun altındaki genişlikte kompozisyon zaten bozulmuştur ve alt bardaki
 * 3 sütunlu şerit de sığmaz (360 px'te içerik talebi ≈ 339 px, mevcut 328 px
 * → `flex-1` çöker, sütunlar kırpılır).
 */
export const HUD_NARROW_MAX_W =
  HUD_TURN_LANE_RIGHT.full + HUD_SIGN_MIN_W + HUD_SPEED_LANE_W.full;   // = 572

export interface HudLayout {
  /** Dikey alan kıt (telefon YATAYI) — bugünkü `dense` ile BİREBİR aynı. */
  readonly short: boolean;
  /** Yatay alan kıt (telefon DİKEYİ) — üst bant üç şeridi taşıyamaz. */
  readonly narrow: boolean;
  /**
   * Orta şeride kalan genişlik (px). `null` = şerit kendi asgarisini
   * karşılayamıyor → yol tabelası çizilmemeli.
   *
   * Merkez-çapalı bir kutu için kullanılabilir genişlik, iki yandan
   * SİMETRİK olarak kısıtlıdır: kutu merkezde durduğundan dar olan yarı
   * belirleyicidir.
   */
  readonly signBudgetPx: number | null;
}

/**
 * Yerleşim kararının SAF çekirdeği — React'ten ve `window`dan bağımsız.
 *
 * Ayrı tutulmasının nedeni testtir: viewport matrisi (head unit · telefon
 * yatayı · telefon dikeyi · tablet dikeyi) ancak ölçüler DIŞARIDAN verilirse
 * deterministik sınanabilir. Hook bunu yalnız ölçümle besler; karar burada
 * TEK yerdedir → testin doğruladığı kod ile ürünün koştuğu kod AYNIDIR.
 */
export function computeHudLayout(width: number, height: number): HudLayout {
  const short = height > 0 && height < HUD_DENSE_MAX_H;

  if (!(width > 0)) {
    // Ölçemiyorsak DARALTMA: bilinmeyen ekranı dar saymak head unit'te
    // sebepsiz küçülme demektir (fail-soft, mevcut davranış).
    return { short, narrow: false, signBudgetPx: null };
  }

  const half       = width / 2;
  const laneLeft   = short ? HUD_TURN_LANE_RIGHT.dense : HUD_TURN_LANE_RIGHT.full;
  const laneRightW = short ? HUD_SPEED_LANE_W.dense    : HUD_SPEED_LANE_W.full;
  /* Merkez-çapalı kutu iki yandan SİMETRİK kısıtlıdır: dar olan yarı belirler. */
  const budget     = 2 * Math.min(half - laneLeft, half - laneRightW);

  return {
    short,
    narrow: width < HUD_NARROW_MAX_W,
    signBudgetPx: budget >= HUD_SIGN_MIN_W ? Math.floor(budget) : null,
  };
}

/**
 * Üst bant yerleşim ölçütlerinin TEK kaynağı.
 *
 * Kendi dinleyicisini KURMAZ — mevcut `useScreenSense` aboneliğini tüketir
 * (üründe zaten iki ekran gözlemcisi var; üçüncüsü kurulmaz).
 */
export function useHudLayout(): HudLayout {
  const { width, height } = useScreenSense();
  return computeHudLayout(width, height);
}
