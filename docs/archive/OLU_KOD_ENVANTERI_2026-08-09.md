# Ölü Kod Envanteri — 2026-08-09

**Yöntem:** `src/` altındaki 1058 ürün dosyası (test hariç) üzerinde **erişilebilirlik
(reachability) analizi**. Kökler: `main.tsx` · `App.tsx` · `serviceWorker.ts` ·
`admin/main.tsx` (+ `new URL()` ile yüklenen worker'lar). Kural gereği **LAB düğümleri
ürün grafiğinde geçiş yapmaz** — yani bir modüle yalnız CAROS LAB'dan ulaşılıyorsa
"ürün çağıranı var" SAYILMAZ. Test dosyaları da ayrı sayılır.

**Bu belge SİLME YAPMAZ.** Yalnız envanterdir.

> **KARAR GÜNCELLEMESİ — 2026-08-09 (bu belgeden SONRA):**
> · **SİL kovası uygulandı** (16 dosya / 3 797 satır) — `versionProperties` hariç,
>   bkz. §1 uyarısı.
> · **BEKLET kovasındaki Guardian AI ve Trip Cost için silme kararı İPTAL:
>   ikisi de TAMAMLANACAK.** Parça bazlı plan: `docs/TAMAMLAMA_PLANI_2026-08-09.md`.
> · `SPEED_CAMERA_WARNING` kuralı kalır ama **veri gelmez** — boş yuva deseni.
> · §3.1'deki **"11 karar otoritesi" sayımı YANLIŞTI**: `guardianDecisionEngine`
>   karar otoritesi değil, **uyarı sıralayıcısıdır** (vizyon Ç-12). Doğru sayı **10**.
>   **Yeniden adlandırma UYGULANDI (2026-08-09):** modül artık
>   `guardianAlertRanker` · `rankGuardianAlerts` · `GuardianAlertPlan`.
> · Trip Cost için "vizyonda karşılığı yok" ifadesi de YANLIŞTI: §8.6'da
>   *"Maliyet tahmini"* satırı var, durumu **YOK** sanılıyordu → **İSKELET**'e
>   çekildi (vizyon Ç-11).

---

## 0. Başlık rakamı

| Sınıf | Dosya | Satır |
|---|---:|---:|
| **Üründen HİÇ ulaşılmıyor** (test bile yok) | 21 | **4 187** |
| **Yalnız TESTTEN ulaşılıyor** | 70 | **11 705** |
| **Yalnız LAB'dan ulaşılıyor** | 52 | **14 352** |
| **Toplam ürün yolu dışında** | **143** | **30 244** |
| Ürün grafiğinde (canlı) | 823 | — |

Yani repodaki TypeScript dosyalarının **%14,8'i** (143/966) ürün çalışma yoluna hiç
girmiyor. Bunun bir kısmı bilinçli (LAB gözlem katmanı — Faz A politikası), bir kısmı
borç, bir kısmı çöp.

---

## 1. Üç kova

### 🗑️ SİL — vizyonda karşılığı yok, taşımaya değmez

> **UYGULANDI 2026-08-09 — 16 dosya / 3 797 satır silindi.** Bir dosya listeden
> ÇIKTI: `versionProperties` (52 satır) **ölü değilmiş** — `vite.config.ts` onu
> derleme anında `import` edip `VITE_APP_VERSION`'ı enjekte ediyor. Envanterin
> erişilebilirlik kökleri (`main.tsx` · `App.tsx` · `serviceWorker.ts` ·
> `admin/main.tsx`) **derleme yapılandırmasını içermiyordu**; bu, yöntemin bilinen
> kör noktasıdır ve buraya kayda geçirilmiştir.
> Silme sonrası: `tsc --noEmit` temiz · 504 dosya / 11 466 test yeşil ·
> guard 393/393 · `npm run build` başarılı. `three` + `@types/three` kaldırıldı.

**17 dosya · 3 849 satır** (uygulanan: 16 · 3 797)

| Ne | Satır | Nerede | Çağıran | Yazıldı | Sonra dokunuldu mu | Vizyon |
|---|---:|---|---|---|---|---|
| **Harita indirme/tile ölü zinciri** | | | | | | |
| `mapDownloadManager` — bölgesel tile indirme kuyruğu | 601 | `platform/` | **hiç** | 2026-04-21 | 1 kez (2026-05-10), 3 ay sessiz | ✗ yok |
| `offlineTileServer` — tile yazma/okuma sunucusu | 482 | `platform/` | yalnız ölülerden | 2026-03-24 | 2026-05-14, sonra sessiz | ✗ yok |
| `MapManifestService` — CRC32 tile delta/bütünlük | 316 | `platform/maps/` | **hiç** | 2026-05-11 | 2026-05-14 | ✗ yok |
| `offlineMapService` — tile önbellek API'si | 257 | `platform/` | yalnız ölü `tileLoader`'dan | 2026-03-24 | 2026-04-19 | ✗ yok |
| `tileLoader` — bbox tile indirici | 218 | `platform/` | **hiç** | 2026-03-24 | 2026-05-11 | ✗ yok |
| `bootstrapOfflineTiles` — ilk açılış örnek tile | 190 | `platform/` | **hiç** | 2026-03-24 | 2026-05-11 | ✗ yok |
| **Yerini LAB'ın aldığı paneller** | | | | | | |
| `Vehicle3DViewer` — Three.js araç görselleştirme | 435 | `components/camera/` | **hiç** | 2026-04-21 | **hiç** (1 commit) | ✗ (CLAUDE.md "3D twin düşük-uçta feda edilir" der) |
| `CanDiagPanel` — CAN ID yapılandırma paneli | 433 | `components/settings/` | **hiç** | 2026-05-11 | 2026-06-12 | ✗ yok |
| `CandidateStatusPanel` | 200 | `components/debug/` | yalnız `CanDiagPanel`'den | 2026-05-20 | **hiç** | ✗ yok |
| `TestProtocolPanel` | 195 | `components/debug/` | yalnız `CanDiagPanel`'den | 2026-05-20 | **hiç** | ✗ yok |
| **Tekil artıklar** | | | | | | |
| `obdBluetoothService` — auto-pair JS katmanı | 146 | `platform/` | **hiç** | 2026-05-11 | **hiç** | ✗ (eşleştirme `obdService`'te) |
| `RuntimeHealthGrid` (admin) | 133 | `admin/components/superadmin/` | **hiç** | 2026-05-17 | 2026-06-12 | ✗ yok |
| `appNavigationService` — MAVİ DRIVE-1 composition root | 111 | `platform/` | **hiç** | 2026-07-20 | **hiç** | ✗ (aşağıda BEKLET'teki `maviCore` ile aynı ölü daldan) |
| `presenceVehicleBinding` | 65 | `platform/fleet/` | **hiç** | 2026-08-07 | **hiç** | ✗ |
| ~~`versionProperties`~~ **SİLİNMEDİ** | 52 | `utils/` | **`vite.config.ts` (derleme kökü)** | 2026-06-10 | **hiç** | ⚠️ ölü değil — envanter kör noktası |
| `EmptyState` (admin) | 24 | `admin/components/shared/` | **hiç** | 2026-04-21 | **hiç** | ✗ yok |
| `voiceTypes` — saf re-export shim | 8 | `platform/` | **hiç** | 2026-05-17 | **hiç** | ✗ (tipler `aiVoiceService`'te) |

**Gerekçe:** Harita zincirinin **canlı** karşılığı zaten var —
`offlineTileDownloader` (315 satır) → `OfflineDataPanel`. Yani offline harita vizyonda
var ama bu altı dosya onun *ikinci, ölü* uygulaması. `Vehicle3DViewer` tek başına
`three@0.185` + `@types/three` bağımlılığını ayakta tutuyor; başka hiçbir dosya
`three` import etmiyor → dosya silinirse bağımlılık da düşer. CAN/debug panelleri
CAROS LAB'ın (Raw Traffic · CAN Monitor · Adapter Diagnostics) öncesinden kalma; LAB
aynı işi gözlemlenebilirlik sözleşmesiyle yapıyor.

---

### 🔌 BAĞLA — vizyonda var, sadece bağlanmamış

**6 dosya · 1 449 satır** (hepsi *yalnız testten* erişiliyor)

| Ne | Satır | Nerede | Çağıran | Yazıldı | Sonra | Vizyon karşılığı |
|---|---:|---|---|---|---|---|
| `useAssistantContextStore` — birleşik asistan bağlamı | 868 | `store/` | yalnız test | 2026-07-10 | **hiç** (1 commit, 1 ay) | Dolaylı: 8 katmanın "her biri ayrı okuyor" sorunu vizyonda anlatılıyor |
| `predictionEngine` — trend öngörüsü (lineer regresyon) | 165 | `platform/obd/` | yalnız test | 2026-07-15 | **hiç** | ✅ **Anayasa 6. kapı**: *"5 dk sonra ne olacak?"* — vizyonda 2 kez |
| `fleetKb` — filo bilgi tabanı (araçtan öğren) | 142 | `platform/obd/` | yalnız test | 2026-07-15 | **hiç** | ✅ vizyonun "biz **öğreniriz**" tezi |
| `signalHub` — tek otoriter sinyal okuma yüzeyi | 123 | `platform/obd/` | yalnız test | 2026-07-15 | **hiç** | ✅ vizyonda geçiyor; **8 Kapı'nın 1. kapısının** (doğruluk/confidence) altyapısı |
| `adapterCapability` — klon ELM327 tespiti | 92 | `platform/obd/` | yalnız test | 2026-07-15 | **hiç** | ✅ zero-trust telemetri ilkesi |
| `kwpDtc` — KWP2000 servis 0x18 DTC çözücü | 65 | `platform/obd/` | yalnız test | 2026-07-15 | **hiç** | ✅ F1-2 (Trafic/KWP araç sınıfı) |

**Gerekçe:** Beşi de **2026-07-15'te tek bir günde** yazılmış ("OBD-OS F3/F4" serisi),
testleri var, sözleşmeleri temiz, o günden beri **tek satır dokunulmamış**. Bunlar çöp
değil — **bağlanmamış organ**. Özellikle `signalHub`: bugün araç verisi hâlâ üç ayrı
depodan (`obdService._current`, `extendedPidService._values`,
`manufacturerPidService._values`) ad-hoc okunuyor; `signalHub` tam olarak bunu
tekleştirmek için yazılmış ve hiçbir tüketici ona geçmemiş.

`useAssistantContextStore` aynı sınıf: saf çekirdek + fail-soft adaptör deseniyle
yazılmış, 868 satır, sıfır ürün tüketicisi.

---

### ⏸️ BEKLET — bağlanması başka bir şeye bağlı

**~9 500 satır** (yalnız testten erişilen büyük alt sistemler + barrel'lar)

| Alt sistem | Satır | Dosya | Yazıldı | Neye bağlı |
|---|---:|---:|---|---|
| **Guardian AI** (`navigation/guardian/`) — 8 risk kuralı + 9 adaptör + 7 sağlayıcı + karar motoru | 3 998 | 32 | 2026-07-21 (tek gün) | Kendi barrel'ı *"wiring katmanı bu sürümde YOK"* diyor. Kurallar hava · yol profili · kamera · yorgunluk verisi ister; bu kaynakların **hiçbiri** bugün beslenmiyor. **⚠️ Vizyon belgesinde karşılığı YOK** — belgedeki "Vehicle Guardian Mode" **başka bir şey** (park gözetimi, "Kodda karşılığı yok" yazıyor). İsim çakışması var. |
| **Trip Cost** (`trip/cost/`) — köprü/otopark/konaklama/yakıt maliyet sağlayıcıları | 2 123 | 12 | 2026-07-21 | Dört sağlayıcının hiçbirinin gerçek veri kaynağı yok (fiyat API'si · HGS tarifesi · otel fiyatı). Kod "NO_SOURCE" işaretleyecek kadar dürüst yazılmış ama kaynak gelmedi. Vizyonda karşılığı **yok**. |
| **Trip motorları** (`tripApplyEngine`/`Corridor`/`Preview`/`Recommendation` + wiring) | 1 173 | 8 | 2026-07-20 | TRIP-5B zincirinin devamı; ürün ucu `tripApplyComposition` yazılmış ama çağıranı yok. |
| **maviCore DRIVE** (`intentResolver` 524 · `navActions` 334 · `appSafeActions` · `discoveryActions` · barrel) | 1 205 | 5 | 2026-07-20/23 | `intentResolver` kendi başlığında yazıyor: *"Çözümü Execution Engine'e taşımak AYRI PR'dır (DRIVE-4)"*. DRIVE-4 yazılmadı. Ölü composition root `appNavigationService` (SİL kovasında) bu daldan artık. |
| `platformKernel` + `kernel/index` | 791 | 2 | 2026-07-11 | Kernel yaşam döngüsü; Vehicle HAL/Event Bus zinciri vizyonda "omurga" olarak var ama kernel'e giden ürün ucu bağlanmamış. |
| `serviceFunctions` — DPF rejenerasyonu / servis sıfırlama / adaptasyon yazma | 162 | 1 | 2026-07-15 | **Bilerek beklemeli.** Dosya *"burada ÇALIŞAN KOD YOK — yalnız KAPI var"* diyor. Araca **yazan** tek yol; gerçek araçta doğrulanmış güvenlik kapısı olmadan bağlanmamalı. |
| `themeDocument` — Tema Belgesi v1 şema+validator | 277 | 1 | 2026-07-07 | Kendi başlığı: *"Faz 0 … henüz kimse bu belgeden render etmez"*. Yerleşim Motoru (Faz 1) yazılmadı. |
| `manufacturerProfileBuilder` — profil adayı üretici | 235 | 1 | 2026-07-09 | Çıktısı **manuel onay** ister; onay akışı/ekranı yok. |
| `boxProtocol` (CAN kutu protokolü + frame parser + barrel) | 290 | 3 | 2026-07-04 | Belirli CAN kutusu donanımına bağlı; cihaz elde yok. |
| `phoneHubUserModel` | 216 | 1 | 2026-08-07 | Phone Hub P1-A cihazda hiç çalışmadı (kütük #122 🔴). |
| Boş barrel'lar: `guardian/index` 137 · `trip/cost/index` 102 · `aiCore/index` 58 · `ai/gateway/index` 43 | 340 | 4 | 07-20/21 | İçerikleri bağlanınca anlam kazanır; tek başlarına silinirse yukarıdakiler de gider. |

---

## 2. Yalnız LAB'dan erişilen katman (ayrı işaret — 52 dosya / 14 352 satır)

Bu **kural gereği ürün çağıranı sayılmaz**, ama Faz A politikası gereği **borç da
sayılmaz**: LAB'ın kendisi bugünkü üründür. Yine de "ürün yüzeyi yok" gerçeği kayda
geçmeli:

| Alt sistem | Satır | Durum |
|---|---:|---|
| `companion/` — AI Road Companion (16 dosya: oturum · protokol · transport · store) | 4 078 | Vizyon: **İSKELET / ÜRÜN HAZIR: HAYIR** — "ürün deneyimi yok" zaten yazıyor |
| `fleet/` — driverPresence · driverDna · driverAuthentication · fleetIntelligence (9 dosya) | 4 429 | Vizyonda Driver DNA var (5 kez); ürün ucu yok, yalnız LAB ekranı |
| `fieldValidation/longRoad*` — uzun yol öz-doğrulayıcı + rapor + kabul | 2 117 | Kütük #308/#309 🔴 — gözlemci gerçek araçta hiç koşmadı |
| `obd/discovery/` — PID/DID keşif koordinatörü (12 dosya) | 1 433 | LAB Deep Scan'e bağlı; ürün karar yoluna bağlı değil |
| `aiMechanic/` model+sources | 565 | LAB AI Mechanic ekranı |
| `media/authority/deviceValidation*` | 613 | LAB medya doğrulama |
| `phoneHub` probe'ları + `voiceMicDiagnosticsProbe` + deepScan adaptörü | 683 | LAB saha araçları |

---

## 3. AYRI LİSTE — aynı işi yapan iki (veya daha fazla) kod

### 3.1 Karar otoriteleri — **10 ayrı "hüküm veren" motor** *(düzeltildi: 11 değil)*

| Motor | Satır | Ürün tüketicisi | Alan |
|---|---:|---:|---|
| `smartEngine` | — | 8 | sürüş modu / öneri |
| `safety/SafetyBrain` | — | 7 | güvenlik |
| `obd/verdictEngine` | 291 | 5 | OBD sinyal hükmü |
| `aiCore/verdictEngine` | 86 | 5 | AI hüküm |
| `reasoning/maviReasoningEngine` | 751 | 3 (1'i LAB) | ADR-286 karar omurgası |
| `obd/dtcVerdict` | 116 | 3 | DTC hükmü |
| `reasoning/batteryVerdictService` | 200 | 2 (1'i LAB) | akü |
| `diagnostic/maintenanceBrain` | — | 2 | bakım |
| `safety/SafetyRuleEngine` | 341 | 1 | güvenlik kuralı |
| `validation/validationVerdict` | 278 | 1 | doğrulama |
| ~~`guardian/guardianAlertRanker`~~ **SAYIM DIŞI** | 200 | **0** | ⚠️ karar otoritesi DEĞİL — **uyarı sıralayıcı** (hüküm üretmez, severity hesaplamaz). Bkz. vizyon Ç-12 |

**Hayatta kalmalı: `maviReasoningEngine`.** Gerekçe: ADR-286'nın ilan ettiği tek karar
omurgası odur ve göç sırası zaten yazılı (`maintenanceBrain` · `fuelAdvisorService` ·
`smartCardEngine` göçün 6/7/8. adımları — regresyon kasasında *"henüz bağlı değil"*
kilidi var). Diğerleri iki sınıfa ayrılır:
- **Alan-özel çözücüler** (`dtcVerdict`, `batteryVerdictService`, `obd/verdictEngine`) —
  hüküm *üretici* değil, alan *çevirici*; omurganın altına girmeli, ayrı otorite olarak
  kalmamalı.
- **`aiCore/verdictEngine` (86 satır) `maviReasoningEngine` (751) ile aynı işi yapıyor** →
  ikisinden biri gitmeli, kalması gereken `maviReasoningEngine`.
- **`guardianAlertRanker` (eski adı `guardianDecisionEngine`) bu listeye HİÇ girmemeliydi** — hüküm üretmez, yalnız üretilmiş uyarıları sıralar. Adı yanıltıcı; **2026-08-09'da `guardianAlertRanker` olarak yeniden adlandırıldı** (plan §5 uygulandı).

### 3.2 Tile indirme — **iki paralel uygulama**

| Yol | Satır | Durum |
|---|---:|---|
| `offlineTileDownloader` → `OfflineDataPanel` | 315 | ✅ **canlı** |
| `mapDownloadManager` + `offlineTileServer` + `tileLoader` + `offlineMapService` + `bootstrapOfflineTiles` + `MapManifestService` | 2 064 | ❌ ölü |

Aynı fonksiyonlar iki yerde tanımlı: `getDownloadState`, `estimateTileCount`,
`getTileCacheStats`. **Hayatta kalmalı: `offlineTileDownloader`** — ürün yolunda olan
ve UI'ya bağlı olan tek yol. *(Ölü zincirin CRC32 bütünlük doğrulaması — `MapManifestService` —
teknik olarak daha iyi; korunacaksa bilinçli olarak canlı yola taşınmalı, öylece bırakılmamalı.)*

### 3.3 PID tanımı — **üç ayrı anahtar biçimi**

| Kaynak | Anahtar biçimi | Kayıt | İş |
|---|---|---:|---|
| `obd/StandardPidRegistry.ts` | `'2F'` (2 hane, büyük hex) | ~80 | decode formülü + ad/birim/kategori |
| `obdPidConfig.ts` | `'0x2F'` (0x önekli) | ~15 | araç tipine göre poll listesi |
| `data/pidHumanRegistry.json` | `'01-2F'` (mode-pid) | 18 | Türkçe kullanıcı açıklaması |
| `obd/StandardPidEnums.ts` | `'01'`/`'03'`/`'1C'` | 3 | bit/enum çözücü (ayrı sözleşme — meşru) |

**Hayatta kalmalı: `StandardPidRegistry` biçimi (`'2F'`).** Gerekçe: en geniş kapsam,
tek decode otoritesi, 18 dosya ondan besleniyor. `obdPidConfig`'in `'0x2F'` biçimi her
sınırda `parseInt(replace(/^0x/))` dönüşümü doğuruyor (`_pidToNumber` tam bunun için
var) — sessiz biçim kayması riski. `pidHumanRegistry.json`'un `'01-2F'` biçimi mode
bilgisi taşıdığı için Mode 22 genişlemesinde haklı, ama tek kayıt olarak
`StandardPidRegistry`'ye bağlanmalı; bugün 80 PID'in yalnız **18'inin** Türkçe
açıklaması var ve iki liste birbirinden habersiz.

### 3.4 Diğer ikizler (küçük ama gerçek)

| Sembol | Yer 1 | Yer 2 | Not |
|---|---|---|---|
| `SuperAdminShell` | `admin/layouts/` | `components/admin/` | iki ayrı kabuk bileşeni |
| `activateFleetLimpMode`, `getFeatureFlags`, `updateFeatureFlag` | `admin/services/superadmin.service.ts` | `platform/superadmin/superAdminService.ts` | **admin paneli ve araç ayrı servis kullanıyor** — bayrak semantiği ayrışabilir |
| `normalizeVin` | `vehicleFingerprintService` · `expert/TrustEngine` · `telemetry/vehicleIdentityReport` | — | üç ayrı VIN normalleştirme |
| `maskVin` | `telemetry/vehicleIdentityReport` · `validation/validationExport` · `vehicle/legalVehicleClass` | — | **üç ayrı VIN maskeleme** — gizlilik kapısı üç yerde ayrı, biri zayıflarsa sızıntı |
| `deriveConfidence` | `autoLearningEngine` | `location/locationConfidence` | iki güven ölçeği (vizyonda `percent_0_100` / `unit_0_1` ayrışması zaten kayıtlı) |
| `MAX_EVIDENCE` | 5 ayrı dosya | — | kanıt tavanı beş yerde ayrı sabit |

> `maskVin`'in üç kopyası en riskli olanı: VIN maskeleme bir **gizlilik kapısıdır** ve
> üç ayrı uygulamanın üçünün de aynı derinlikte maskelediği hiçbir yerde doğrulanmıyor.

---

## 4. "Bugün silinse hiçbir şey bozulmaz" tahmini

**≈ 3 800 satır** (17 dosya). → **GERÇEKLEŞEN: 3 797 satır / 16 dosya** (2026-08-09).

Hesap: üründen hiç ulaşılamayan 4 187 satırdan, ileride bağlanacak alt sistemlerin
barrel'ları (`guardian/index` 137 · `trip/cost/index` 102 · `aiCore/index` 58 ·
`ai/gateway/index` 43 · `kernel/index` 33 = 373) düşülür → **3 814**; buna yalnız
kendi testinden erişilen `versionProperties` (52, testiyle birlikte) eklenir.

Bu satırların **testi de yok** — yani silme tek yönlü ve temizdir: `tsc -b` ve
`npm run test` etkilenmez. Ek kazanç: `three` + `@types/three` bağımlılığı düşer
(`Vehicle3DViewer` tek kullanıcısı).

Karşılaştırma için diğer iki eşik:
- **+11 705 satır** daha silinebilir (yalnız testten erişilen 70 dosya) — ama bu, o
  modüllerin **testlerini de** silmek demektir ve **BAĞLA** kovasındaki 1 449 satır
  vizyonda açıkça karşılığı olan koddur. Bunlar silinmemeli, bağlanmalı.
- **14 352 satır** (yalnız LAB) silinemez — Faz A'da LAB üründür.

---

## 5. Kütüğe / vizyona etkisi

- **Guardian AI (3 998 satır) vizyon belgesinde YOK.** Belgedeki "Vehicle Guardian Mode"
  başka bir özelliktir ve *"Kodda karşılığı yok"* diyor. Ya vizyona bir satır girmeli
  ya da kova **SİL**'e geçmeli. Bugünkü hâli — 32 dosya, 8 kural, sıfır tüketici,
  vizyonda yer yok — envanterin en büyük tek belirsizliği.
- **Trip Cost (2 123 satır) vizyon belgesinde YOK.** Aynı karar gerekli.
- **`signalHub` bağlanmadıkça** "8 Kapı"nın 1. kapısı (Confidence) her tüketicide ayrı
  ayrı yeniden icat edilmeye devam eder — bu, envanterin en yüksek getirili tek
  bağlama işi.
