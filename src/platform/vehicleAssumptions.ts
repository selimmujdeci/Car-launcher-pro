/**
 * vehicleAssumptions — ARAÇ PROFİLİ YOKKEN kullanılan varsayımların TEK OTORİTESİ (SAF).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Denetim (docs/ENVANTER_BAGLANTI_DENETIMI_2026-08-12.md · E-05) aynı fiziksel
 * olgunun — "araç 100 km'de kaç litre yakar" — iki dosyada BAĞIMSIZ ve FARKLI
 * sabitlendiğini ölçtü:
 *   · `tripLogService.ts`  → 8.5 L/100km  (yolculuk kaydı)
 *   · `routingService.ts`  → 7.5 L/100km  (rota öncesi tahmin)
 * Sonuç kullanıcıya GÖRÜNÜYORDU: aynı 300 km için NavigationHUD "22,5 L" derken
 * yolculuk özeti "25,5 L" diyordu (%13 sapma). İki sayı da savunulabilir; sorun
 * ikisinin AYNI ANDA doğru sayılmasıydı.
 *
 * ── SEÇİLEN DEĞER ───────────────────────────────────────────────────────────
 * 8.5 L/100km — çünkü BEYAN EDİLMİŞ olan budur:
 *   · `tripCanonicalModel.ts` `'ESTIMATED'` açıklaması ("8.5 L/100km, 45 TL/L")
 *   · CAROS LAB Trip Engine katalog notu ("head unit yakıtı 8,5 L/100km sabiti…")
 * 7.5 hiçbir yerde beyan edilmemişti. Birleştirme rota tahminini ~%13 yükseltir;
 * bu bilinçli bir davranış değişikliğidir (kütük #558).
 *
 * ── BU BİR ÖLÇÜM DEĞİLDİR ───────────────────────────────────────────────────
 * Buradaki her sayı bir TAHMİN girdisidir. Araçtan gerçek tüketim okunabiliyorsa
 * bu sabitler KULLANILMAZ — tüketici, ölçülen değeri tercih etmek ve sonucu
 * `ESTIMATED` yerine `MEASURED` işaretlemekle yükümlüdür.
 *
 * SAF: hiçbir şey import etmez, yan etkisi yoktur.
 */

/**
 * Araç profili/gerçek tüketim yokken varsayılan yakıt tüketimi (L/100km).
 *
 * TÜKETİCİLER (ikisi de AYNI soruyu sorar → AYNI kaynaktan okur):
 *  · `tripLogService.ts`  → kapanan yolculuğun tahmini yakıtı
 *  · `routingService.ts`  → `computeFuelEstimate()` (NavigationHUD rota tahmini)
 */
export const DEFAULT_FUEL_L_PER_100KM = 8.5;
