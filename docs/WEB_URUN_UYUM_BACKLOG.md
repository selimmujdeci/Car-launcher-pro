# Web Sitesi ↔ Araç Uygulaması Uyum Backlog'u

> **Amaç:** carospro.com'da verilen her vaadin araç uygulamasında **gerçek ve
> kanıtlanabilir** karşılığı olması. Hiçbir pazarlama metni ürünün önüne geçmemeli.
>
> **Kaynak:** 2026-07-08 kod-tabanlı uyum denetimi (tahmin yok, sadece kod).
> **Yöntem:** Her madde bitince `docs/DEVICE_VALIDATION_LEDGER.md` kütüğüne 🔴 olarak
> girilir, gerçek araçta/panelde ölçülünce 🟢'ya taşınır.
>
> Durum: 🔴 Eksik · 🟡 Kısmen · ✅ Tamam. Kutucuk işaretlenince madde bitmiş sayılır.

---

## P0 — DÜRÜSTLÜK (pazarlama ürünün önüne geçmiş — ÖNCE BUNLAR)

Bunlar yeni özellik değil; **metin↔ürün yalanını** kapatır. En hızlı yol: ya vaadi
gerçeğe indir, ya ürünü vaade çıkar.

- [x] 🟢 **"200+ DTC" → gerçek 212 (ÇÖZÜLDÜ 2026-07-09).** (b) yolu seçildi: DTC veritabanı
  gerçekten genişletildi. `dtcService.ts` hot-core (49) + `obd/data/dtcExtendedCatalog.ts`
  lazy standart katalog (163) = **212 gerçek SAE J2012 standart DTC**; hepsi Türkçe açıklamalı.
  Web metni "200+ standart OBD-II DTC" olarak kesinleştirildi (uydurma değil, gerçek sayı ≥ vaat).
  **Kabul:** test `dtcExtendedCatalog.test.ts` toplam ≥200'ü kilitler (PR-DTC-2, #18).
  Kanıt: `src/platform/obd/data/dtcExtendedCatalog.ts` + `src/__tests__/dtcExtendedCatalog.test.ts`

- [ ] 🔴 **TPMS görsel-only.** Web/3D lastik basıncını ima ediyor ama gerçek TPMS
  veri kaynağı yok (yalnız `Vehicle3DViewer.tsx` renk eşlemesi).
  **Karar:** (a) TPMS'i CAN/OBD'den gerçek besle **VEYA** (b) 3D'de "demo" etiketle +
  web'de TPMS vaadini kaldır. **Kabul:** TPMS değeri gerçek sinyalden geliyor ya da
  hiçbir yerde gerçekmiş gibi sunulmuyor. Kanıt: `src/components/camera/Vehicle3DViewer.tsx:14`

- [ ] 🔴 **Enterprise dikey senaryoları kodda yok.** `enterprise/page.tsx` filo/kamu/
  lojistik için var olmayan yetenekleri satıyor (bkz. P3). **Karar:** enterprise
  sayfasını mevcut gerçek yeteneklere hizala (yapılana kadar "yakında" işaretle).
  **Kabul:** enterprise sayfasındaki her madde ya çalışıyor ya "yol haritası" olarak
  ayrılmış. Kanıt: `website/src/app/(public)/enterprise/page.tsx`

---

## P1 — FİLO / KURUMSAL EKSİKLER (gerçek özellik, backend gerekli)

- [ ] 🔴 **Otomatik PDF raporlar.** Hiçbir PDF üretimi yok (jspdf/pdfkit yok).
  **Yap:** günlük/haftalık sürüş+araç raporu PDF üretimi (web panel).
  **Kabul:** panelden PDF indirilebiliyor, gerçek Supabase verisiyle. Kanıt: yok.

- [ ] 🔴 **Filo-seviyesi sürüş raporları (web panel).** Araç-app `tripLogService` local
  (son 100 trip) tutuyor; panelde filo raporu yok.
  **Yap:** trip verilerini Supabase'e sync + panelde sürücü/araç bazlı rapor sayfası.
  **Kabul:** panel `dashboard/reports` gerçek veriyle listeliyor. Kanıt: `src/platform/tripLogService.ts:10`

- [ ] 🔴 **90-gün araç geçmişi + retention.** Marketing-only; retention implementasyonu yok.
  **Yap:** Supabase'de 90-gün rota/olay saklama + panelde geçmiş görünümü.
  **Kabul:** 90 günlük geçmiş sorgulanabiliyor; eski veri otomatik temizleniyor.

- [ ] 🔴 **Sürücü puanlaması.** driverScore/puanlama kodu yok.
  **Yap:** hızlanma/frenleme/hız-aşımı bazlı skor (trip verisinden).
  **Kabul:** her sürücü için 0-100 skor + panelde gösterim.

- [ ] 🔴 **Yakıt maliyet analizi.** costPerKm/fuelCost yok.
  **Yap:** yakıt tüketimi × birim fiyat → maliyet/km, aylık maliyet.
  **Kabul:** panelde araç-bazlı yakıt maliyeti (kullanıcı fiyat girişi ile).

- [ ] 🔴 **Public REST API.** Yalnız iç Next uçları var; dökümante entegrasyon API'si yok.
  **Yap:** token'lı REST API (araç/konum/olay okuma) + döküman.
  **Kabul:** 3. taraf bir sistem API key ile veri çekebiliyor.

- [ ] 🟡 **Bakım hatırlatıcıyı web panele bağla.** Araç-app `vehicleMaintenanceService`
  gerçek; panelde görünmüyor. **Yap:** bakım durumunu Supabase'e yaz + panelde kart.
  **Kabul:** panelde araç bakım durumu (ok/warning/critical). Kanıt: `src/platform/vehicleMaintenanceService.ts`

- [ ] 🟡 **Alert sistemi mock fallback'i kaldır.** `GeofenceAlertsPanel` Supabase yoksa
  demo üretiyor. **Yap:** yalnız gerçek geofence olayları; hız-aşımı alert'i ekle.
  **Kabul:** panelde yalnız gerçek olaylar; mock yok. Kanıt: `website/src/components/dashboard/GeofenceAlertsPanel.tsx:10`

- [ ] 🟡 **dashboard/settings gerçek backend.** Şu an `defaultValue` placeholder, kaydetmiyor.
  **Yap:** ad/e-posta/şirket alanlarını Supabase profile'a bağla.
  **Kabul:** ayar kaydediliyor + tekrar yüklenince kalıyor. Kanıt: `website/src/app/dashboard/settings/page.tsx:9`

---

## P2 — YARIM ÖZELLİKLERİ TAMAMLA

- [ ] 🟡 **Offline routing verisi.** `offlineRoutingService` kodu hazır ama
  `routing-graph.bin` yok → offline rota çalışmıyor (online OSRM'e düşer).
  **Yap:** Türkiye grafiğini üret (osmium + exporter) + `public/maps`'e paketle/indir.
  **Kabul:** internet kapalıyken A→B rota çıkıyor. Kanıt: `src/platform/offlineRoutingService.ts`

- [ ] 🟡 **Offline harita ön-paketli/indirme UX.** `public/maps` boş; indirme motoru
  (`mapDownloadManager`) var ama akış kullanıcıya net değil.
  **Yap:** varsayılan bölge ön-paketle VEYA ilk-açılış "bölge indir" akışı.
  **Kabul:** yeni kurulumda internet olmadan harita görünüyor. Kanıt: `src/platform/mapDownloadManager.ts`

- [x] 🟢 **DTC_DB genişletme (37 → 212) — ÇÖZÜLDÜ 2026-07-09.** P0-1'in (b) yolu uygulandı:
  lazy `dtcExtendedCatalog` (bundle-güvenli) ile 163 standart kod eklendi; toplam 212, test kilitli.
  Kanıt: `src/platform/obd/data/dtcExtendedCatalog.ts` (PR-DTC-1 #17 iskele + PR-DTC-2 #18 veri)

- [ ] 🟡 **Yakıt seviyesi raw-CAN kapsamı.** OBD 0x2F kaldırılmış; yakıt raw-CAN'e bağlı,
  araç-bağımlı. **Yap:** desteklenen marka/model CAN yakıt DID'lerini genişlet + fallback.
  **Kabul:** en az X marka/modelde yakıt gösteriyor. Kanıt: `src/platform/obdPidConfig.ts:16`

- [ ] 🟡 **CAN sinyalleri bit-düzeni netleştir.** Bazı protokollerde kapı/vites/ışık bit
  düzeni "belirsiz". **Yap:** gerçek araçta doğrula + `CanSignalValidator` güncelle.
  **Kabul:** kapı/far/el-freni gerçek araçta doğrulandı (kütük 🟢). Kanıt: `src/platform/canBus/boxProtocol/boxProtocols.ts:66`

- [ ] 🟡 **Rota optimizasyonu trafik BYOK UX.** `trafficService` HERE/TomTom gerçek ama
  anahtar yoksa 'estimated'. **Yap:** ayarlarda BYOK anahtar girişi + durum rozeti.
  **Kabul:** kullanıcı anahtar girince gerçek trafik; yoksa dürüst "tahmini" etiketi.
  Kanıt: `src/platform/trafficService.ts:5`

---

## P3 — ENTERPRISE DİKEY SENARYOLAR (uzun vade — şu an kodda yok)

Bunlar `enterprise/page.tsx`'te satılıyor ama implementasyon yok. P0-3 kararına göre
ya "yol haritası" olarak ayrılacak ya sırayla yapılacak.

- [ ] 🔴 Vardiya yönetimi (shift)
- [ ] 🔴 AB mola-regülasyon takibi
- [ ] 🔴 Kargo doğrulama
- [ ] 🔴 Müşteri bildirim
- [ ] 🔴 Öncelikli rota planı (kamu/acil)
- [ ] 🔴 Merkezi komuta

---

## ✅ Zaten GERÇEK (dokunma — referans)

OBD-II okuma · DTC okuma · Tünel modu/DR · Sesli asistan (offline Vosk TR) · Mola
önerisi · Medya kontrolü · GPS takibi · Uzaktan komut (lock/unlock) · RBAC
(driver/admin/super_admin) · Realtime konum · FCM push · Bakım değerlendirme (araç-app) ·
Web panel çekirdeği (Supabase-bağlı vehicles/map/diagnostic/notifications).
