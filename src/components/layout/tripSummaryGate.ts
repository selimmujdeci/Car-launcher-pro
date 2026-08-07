/**
 * tripSummaryGate.ts — T13: yolculuk özeti banner'ı için SAF sürüş kapısı.
 *
 * Neden ayrı dosya: `MainLayout.tsx` yalnız bileşen export etmelidir
 * (react-refresh/only-export-components). Saf karar mantığı burada durur;
 * hem bileşen hem kilit testleri buradan okur.
 *
 * SAHA GEREKÇESİ (snapshot 2026-08-01): `div.fixed z9980 %19` yüzeyi kullanıcı
 * dokunmadan açıldı ve ⚠ZAMANSIZ işaretlendi. z-[9980] TEK bileşene aittir:
 * TripSummaryBanner. O an araç park hâlindeydi (403700 "durdu/park"), yani
 * gösterim meşruydu ve yüzey blocking değil (role="status", alt şerit).
 *
 * Ama açılış yolunda HİÇBİR sürüş kapısı yoktu. Aynı snapshot sürüş/park
 * modunun 12.6 sn içinde 4 kez değiştiğini, bir "durdu" olayının OBD
 * timeout'una 67 ms mesafede olduğunu gösteriyor — sahte bir "yolculuk bitti"
 * sinyali bu banner'ı SÜRÜŞ SIRASINDA açabilirdi.
 */

/**
 * Yolculuk özetinin gösterilebileceği azami hız (km/h).
 * `uiActivityRecorder` "sürüşte" eşiğiyle (DRIVING_KMH = 5) hizalıdır — aynı
 * olayı bir katman ZAMANSIZ sayıp diğeri meşru saymasın.
 */
export const TRIP_SUMMARY_MAX_KMH = 5;

/**
 * Yolculuk özeti gösterilebilir mi — SAF, fail-closed karar.
 *
 * Hız BİLİNMİYORSA (null/undefined/NaN) gösterilmez: "duruyor" varsayımı
 * kanıtsızdır ve sürüş sırasında dikkat dağıtıcı bir yüzey açabilir.
 */
export function canShowTripSummary(speedKmh: number | null | undefined): boolean {
  return typeof speedKmh === 'number'
    && Number.isFinite(speedKmh)
    && speedKmh <= TRIP_SUMMARY_MAX_KMH;
}


/* ══════════════════════════════════════════════════════════════════════════
   KANONİK SÜRÜCÜ DİKKAT KAPISI (P0 — gerçek sürüş bulgusu 2026-08-03)

   SAHA KANITI: araç 86 km/h ile GİDERKEN CAROS LAB kaydına şu düştü:
     `modal açıldı ⚠ZAMANSIZ — div z9500 100% [sürüşte]`
     `modal kapandı — div z9500 100%`   (arada ~15 ms)
   `div z9500 100%` imzası TEK bileşene aittir: `DiagnosticReportModal`
   (inline `position:fixed; inset:0; zIndex:9500`, `role="dialog"`,
   `aria-modal="true"`). Sınıf adı taşımadığı için `uiActivityRecorder`
   desc'inde `.class` görünmez — diğer iki z-9500 yüzeyi (`MainLayout` adres
   kartı ve `VoiceAssistant` pill'i) `className="fixed …"` taşıdığından
   `div.fixed z9500 …%` üretirdi. Yani bu GERÇEK, tam ekran, bloklayan bir
   modaldır — render artefaktı değil.

   Açılış yolunda HİÇBİR sürüş kapısı yoktu: `GlobalDiagnosticButton`
   `setOpen(true)` diyor ve modal anında mount oluyordu.

   Bu kapı `TRIP_SUMMARY_MAX_KMH` ile AYNI eşiği kullanır ve `uiActivityRecorder`
   `DRIVING_KMH` ile hizalıdır — bir katmanın ZAMANSIZ saydığını diğeri meşru
   saymasın. YENİ bir otorite DEĞİLDİR: mevcut saf kapının genelleştirilmiş adı.
   ══════════════════════════════════════════════════════════════════════════ */

/** Dikkat dağıtıcı tam-ekran yüzeyin gösterilebileceği azami hız (km/h). */
export const DISTRACTING_SURFACE_MAX_KMH = TRIP_SUMMARY_MAX_KMH;

/**
 * Dikkat dağıtıcı (tam ekran / bloklayan) bir yüzey ŞU AN gösterilebilir mi?
 *
 * FAIL-CLOSED: hız BİLİNMİYORSA (null/undefined/NaN) `false`. "Duruyordur"
 * varsaymak kanıtsızdır ve 86 km/h'te tam ekran modal açmak sürücüyü kör eder.
 */
export function canShowDistractingSurface(speedKmh: number | null | undefined): boolean {
  return canShowTripSummary(speedKmh);
}
