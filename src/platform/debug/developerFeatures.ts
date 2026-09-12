/**
 * developerFeatures.ts — geliştirici yüzeylerinin TEK derleme-zamanı otoritesi.
 *
 * ── ÜRÜN GERÇEĞİ (2026-07-26) ───────────────────────────────────────────────
 * CAROS PRO henüz GELİŞTİRME ve AİLE İÇİ SAHA TESTİ aşamasındadır: uygulamayı
 * yalnız proje sahibi ve ağabeyleri kullanıyor, Play Store/genel dağıtım YOK.
 * Bu yüzden geliştirme/test APK'sını kuran HER cihazda CAROS LAB, Debug Panel ve
 * geliştirici menüleri OTOMATİK açık olmalıdır — rol atamasına, `canDebug`
 * iznine, localStorage'a veya gizli mühendislik girişine BAĞLI OLMADAN.
 *
 * ── NEDEN TEK YERDE ─────────────────────────────────────────────────────────
 * Aynı karar daha önce ÜÇ ayrı dosyada yeniden hesaplanıyordu
 * (`debug/index.ts` · `debug/debugStore.ts` · `core/storage/CacheLRUManager.ts`).
 * Birinin unutulması "yarı açık" bir build üretir. Artık TEK kaynak burasıdır;
 * diğerleri bu sabiti IMPORT eder, yeniden hesaplamaz.
 *
 * ── SATIŞ/PRODUCTION ────────────────────────────────────────────────────────
 * İfade DERLEME ZAMANINDA sabite katlanır: `vite build` (DEV=false) + env bayrağı
 * yokken değer `false` olur ve Vite tüm korumalı dalları ölü kod olarak eler.
 * VARSAYILAN KAPALIDIR: açmak için BİLİNÇLİ olarak `VITE_ENABLE_DEBUG_PANEL=true`
 * verilmesi gerekir. Yayın öncesi kontrol listesi: `docs/RELEASE_CHECKLIST.md`.
 *
 * DİKKAT: bu ifadeyi bir fonksiyona, değişkene veya runtime okumasına ÇEVİRME —
 * derleme-zamanı katlanabilirliği (ve dolayısıyla ölü kod eleme) kaybolur.
 */
export const DEVELOPER_FEATURES_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_PANEL === 'true';
