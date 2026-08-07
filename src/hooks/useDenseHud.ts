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
