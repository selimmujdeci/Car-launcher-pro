/**
 * freshnessPolicy — "BU VERİ HÂLÂ GEÇERLİ Mİ?" sorusunun TEK OTORİTESİ (SAF).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Denetim (docs/ENVANTER_BAGLANTI_DENETIMI_2026-08-12.md · E-01/E-09/E-36) ürün
 * genelinde `*_STALE_MS` / `*_FRESH_MS` / `*_MAX_AGE_MS` deseninde **40+ bağımsız
 * sabit** ölçtü. Bunların bir kısmı AYNI soruya AYNI cevabı veriyordu ama sayı
 * elle kopyalanmıştı — iki dosyanın yorumu bile "…ile hizalı" diyerek hizalamayı
 * İDDİA ediyordu. Elle hizalama bir sözleşme değildir: biri değişince diğeri
 * sessizce ayrışır ve aynı veri için bir ekran "TAZE", diğeri "BAYAT" der.
 *
 * ── NE YAPMAZ (bilinçli sınır) ──────────────────────────────────────────────
 * Bu dosya tüm tazelik eşiklerini TEK SAYIYA İNDİRMEZ. Farklı eşikler çoğu zaman
 * MEŞRUDUR: güvenlik-kritik bir katman için 3 sn'lik fix bayattır, uzun vadeli
 * trend için 5 dk taze sayılabilir. Kusur "farklı sayılar" değil, **aynı sorunun
 * birden çok yerde bağımsız cevaplanması**dır. Bu yüzden buradaki her sabit bir
 * SAYI değil, bir AMAÇ tanımlar ve amacı yazılıdır.
 *
 * ── KURAL ───────────────────────────────────────────────────────────────────
 * Yeni bir tazelik eşiği eklerken: aynı amaca hizmet eden bir sabit burada VARSA
 * onu kullan; yoksa buraya AMACIYLA BİRLİKTE ekle. Tüketici dosyada `const X =
 * 4_000` yazmak yasak değildir — ama o sayı başka bir dosyadaki bir sayıyla
 * "hizalı olmalı" ise, hizalama YORUMLA DEĞİL BU DOSYAYLA kurulur.
 *
 * SAF: hiçbir şey import etmez, yan etkisi yoktur, timer kurmaz.
 */

/* ── OBD ──────────────────────────────────────────────────────────────────── */

/**
 * **Gösterge dondu** eşiği (ms) — mutlak, poll yapılandırmasından BAĞIMSIZ.
 *
 * Sürücü için anlamı: hız/RPM göstergesi ~4 sn güncellenmemişse ekrandaki sayı
 * artık aracın o anki hâli DEĞİLDİR. Poll periyodu ne olursa olsun bu eşik
 * geçerlidir — yavaş poll "donmayı" meşrulaştırmaz.
 *
 * TÜKETİCİLER (bu üçü AYNI soruyu sorar, bu yüzden AYNI kaynaktan okur):
 *  · `obd/ObdHealthMonitor.ts`            → `isStale` hükmü
 *  · `diagnosticTriage.ts`                → eski APK'da `isStale` yoksa fallback
 *  · `aiCore/runtime/diagnosticEvidence.ts` → kanıt üretiminde paket bayatlığı
 */
export const OBD_FROZEN_ABS_MS = 4_000;

/* ── GPS / Konum ──────────────────────────────────────────────────────────── */

/**
 * **Navigasyon fix'i bayat** eşiği (ms).
 *
 * Anlamı: son GPS düzeltmesi bundan eskiyse aktif navigasyon kararlarında
 * (konum, sapma, manevra mesafesi) OTORİTE SAYILMAZ. Guardian gibi
 * güvenlik-kritik katmanlar bilinçli olarak DAHA SIKI bir eşik kullanır
 * (bkz. `guardianRuntime.GUARDIAN_GPS_MAX_AGE_MS`) — bu bir ayrışma değil,
 * yazılı bir tercihtir: güvenlik kararı daha taze kanıt ister.
 *
 * TÜKETİCİLER:
 *  · `gpsService.ts`                        → `LOCATION_STALE_MS`
 *  · `navigation/navigationSessionRuntime.ts` → `GPS_STALE_MS`
 */
export const GPS_FIX_STALE_MS = 5_000;
