# CAROS PRO — GERÇEK ÜRÜN DURUMU VE VİZYON UYUM ANALİZİ

**Tarih:** 2026-08-01 · **Branch:** `feat/fleet-offline-final-local-completion` · **HEAD:** `f89540c`
**Yöntem:** Yalnız kod. Vizyon belgeleri, roadmap ve önceki raporlar ürün gerçeği sayılmadı.
**Sınır:** Bu bir analiz görevidir — kod yazılmadı, refactor/migration/test eklenmedi, commit yok.

---

## 1 · YÖNETİCİ ÖZETİ

CAROS PRO bugün **iki farklı olgunlukta ürünün aynı depoda yaşadığı** bir kod tabanıdır:

1. **Çalışan bir head unit launcher + OBD teşhis cihazı + filo backend'i.** Eşleştirme,
   telemetri, trip yükleme, uzaktan komut, filo panosu, offline kuyruk, rol/transfer
   akışları gerçekten uçtan uca bağlı.
2. **Devasa ama ürüne bağlanmamış bir zekâ katmanı.** AI/Mavi yığını (~23.000 satır),
   Fleet Intelligence, Driver DNA, Evidence ve Reasoning motorları kod olarak var,
   testleri yeşil, SQL'leri yazılmış — **ama kullanıcı hiçbirine erişemiyor.**

En kritik tek bulgu: **AI yığınının tamamı varsayılan KAPALI bir bayrağın arkasında ve
o bayrağı açacak ne bir kullanıcı arayüzü ne de bir veri tohumu (seed) var.** Yani
yaklaşık 23 bin satırlık yatırım, bugün hiçbir cihazda **çalışmıyor**.

İkinci kritik bulgu: **filo zekâsının okuma ucu yok.** `get_driver_dna`,
`get_fleet_intelligence`, `get_evidence_coverage` SQL'de var, görünüm katmanları
yazılmış, kartları tasarlanmış — **ama hiçbir yer bu RPC'leri çağırmıyor ve kartların
hiçbiri mount edilmemiş.**

**Bugün bir kullanıcı uygulamayı açtığında gerçekten kazandığı şey:** araç içi launcher,
OBD canlı verisi + DTC okuma, harita/navigasyon, müzik, sesli komut, ve telefondan
araca bağlanıp uzaktan komut/konum görme. **Bir filo müşterisinin bugün satın aldığında
çözdüğü iş:** araç envanteri, kullanıcı/rol yönetimi, araç eşleştirme/devir, trip
geçmişi ve canlı konum.

**Vaat edilen ama kodda kullanıcıya ulaşmayan:** öngörülü bakım, sürücü DNA'sı, filo
zekâsı, kanıt/karar zinciri, AI usta teşhisi.

---

## 2 · İNCELENEN KOD ALANLARI

| Yüzey | Dosya | Satır |
|---|---:|---:|
| `src/` (head unit uygulaması + admin SPA) | 1.438 | 380.953 |
| `website/src/` (Next.js: public + dashboard + PWA + API) | 240 | 46.374 |
| `android/app/src/main/java/` (native) | 66 | 26.319 |
| `supabase/migrations/` | 60 migration | — |

**Alt sistem hacimleri (head unit):**

| Alt sistem | Satır | Ürün yüzeyi |
|---|---:|---|
| `platform/ai` | 11.308 | ❌ bayrak kapalı |
| `components/devtools` (CAROS LAB) | 9.803 | ❌ yalnız DEV |
| `platform/obd` | 8.050 | ✅ bağlı |
| `platform/maviCore` | 6.941 | ⚠️ kısmen gölge |
| `platform/fleet` | 5.379 | ❌ yalnız LAB |
| `platform/navigation` | 4.452 | ✅ bağlı |
| `platform/deepScan` | 4.159 | ⚠️ LAB + panel |
| `platform/aiCore` | 2.592 | ❌ bayrak kapalı |
| `platform/reasoning` | 1.811 | ❌ yalnız LAB |
| `platform/aiMechanic` | 563 | ❌ yalnız LAB |

---

## 3 · ARAÇ / HEAD UNIT ENVANTERİ

| Özellik | Giriş noktası | UI | Servis/Native | Kalıcılık | Gerçek veri | Erişilebilir | Durum | Kanıt |
|---|---|---|---|---|---|---|---|---|
| Launcher / ana ekran | Boot | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `App.tsx` · `MainLayout.tsx` · `NewHomeLayout.tsx` |
| OBD canlı veri | Dock → Araç | ✔ | ✔ native | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `obdService.ts` · `OBDManager.java` |
| DTC okuma | Dock → Arıza | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `DTCPanel.tsx` ← `DrawerPanel.tsx:89` |
| CAN bus | Boot (otomatik) | kısmi | ✔ 22 Java dosyası | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `CanAdapter.ts` ↔ `NativeToJsBridge.java` · Hiworld/NWD/K24/USB/BT taşımaları |
| GPS / konum | Boot | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `gpsService.ts` · `LocationEngine` |
| Navigasyon (online) | Dock → Navigasyon | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `navigationService.ts` |
| Navigasyon (offline rota) | — | ✔ | ✔ kod | ✖ **veri yok** | ✖ | ✖ | **KIRIK** | `offlineRoutingService.ts` `routing-graph.bin` bekliyor; `public/maps/*.bin` **yok** |
| Müzik Hub (yerel) | Dock → Müzik | ✔ | ✔ native | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `localMusicService.ts` |
| Spotify | Müzik | ✔ | ✔ auth+servis | ✔ | ✔ | ✔ | **KISMİ** | `platform/spotify/*` (App Remote yok) |
| Mavi (sesli asistan) | Ana ekran mikrofon | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `VoiceAssistant.tsx` ← `NewHomeLayout.tsx:506` |
| Mavi AI Gateway / Orchestrator | — | ✖ | ✔ | ✔ | — | ✖ | **ÇALIŞAN AMA GİZLİ** | `aiGatewayFlag.ts:49` varsayılan `false`; UI anahtarı **yok** |
| Mavi Mechanic / Memory / Tools / Planner / Operator | — | ✖ | ✔ | — | — | ✖ | **ÇALIŞAN AMA GİZLİ** | `aiGatewayFlag.ts` 11 bayrak, hepsi gateway'e bağlı fail-closed |
| Trip motoru + yükleme | Otomatik | kısmi | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `SystemBoot.ts:843 startTripUpload()` → `upload_vehicle_trip` |
| Trip özeti banner | Yolculuk sonu | ✔ | ✔ | — | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `TripSummaryBanner.tsx` ← `MainLayout.tsx` |
| BlackBox (kaza kaydı) | Boot | ✖ UI | ✔ | ✔ | ✔ | kısmi | **KISMİ** | `blackBoxService.ts` — kayıt var, **kullanıcıya gösteren ekran yok** (yalnız LAB kopyası) |
| Deep Scan | Ayarlar → PID/DID | ✔ | ✔ | ✔ | ✔ | ✔ | **KISMİ** | `PidDidDeepScanPanel.tsx`; LAB kataloğunda `PLACEHOLDER` |
| Vehicle Identity / eşleştirme kodu | Ayarlar → Mobil Bağlantı | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `MobileLinkWidget.tsx` ← `SettingsPage.tsx:1968` → `register_vehicle`/`refresh_linking_code` |
| Uzaktan komut (araç ucu) | Otomatik | — | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `commandListener.ts` ← `fcmService.ts` |
| Telemetri push | Otomatik | — | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `vehicleDataLayer/index.ts:247 telemetryService.start()` |
| Driver Presence / Authentication | — | ✖ | ✔ | ✔ | ✔ | ✖ | **DEBUG / LAB ONLY** | Yalnız `FleetDriverIdentityScreen` · `FleetPresenceHistoryScreen` |
| Driver DNA | — | ✖ | ✔ SQL | ✔ | — | ✖ | **YALNIZ BACKEND** | `src/`'te `driverDna` **0 üretim referansı** |
| Fleet Intelligence | — | ✖ | ✔ SQL | ✔ | — | ✖ | **YALNIZ BACKEND** | `src/`'te `fleetIntelligence` **0 üretim referansı** |
| AI Evidence / Reasoning | — | ✖ | ✔ SQL | ✔ | ✔ | ✖ | **DEBUG / LAB ONLY** | Yalnız LAB ekranları + `aiMechanicSources` |
| AI Mechanic | — | ✖ | ✔ SQL+TS | türetilmiş | ✔ | ✖ | **DEBUG / LAB ONLY** | `AiMechanicScreen.tsx` yalnız LAB; `get_ai_mechanic_analyses` **çağıran yok** |
| OTA | Otomatik | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `otaUpdateService.ts:402` boot + 
poll |
| Ayarlar | Dock → Ayarlar | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `SettingsPage.tsx` |
| Güvenlik (Sentry/Geofence/Reverse) | Otomatik | ✔ | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `App.tsx` overlay'ler |
| CAROS LAB | Dock → CAROS LAB | ✔ | ✔ | — | ✔ | **yalnız DEV** | **DEBUG / LAB ONLY** | `DEVELOPER_FEATURES_ENABLED = DEV \|\| VITE_ENABLE_DEBUG_PANEL` |
| Admin SPA | `admin.html` | ✔ | ✔ | ✔ | ✔ | belirsiz | **DOĞRULANAMADI** | `vite.config.ts:318` ayrı giriş; head unit'te ona giden link **bulunamadı** |

---

## 4 · PWA / FLEET ENVANTERİ

| Özellik | Giriş | UI | Backend | Kalıcılık | Erişilebilir | Durum | Kanıt |
|---|---|---|---|---|---|---|---|
| Kayıt / giriş / şifre sıfırlama | `/login` `/register` | ✔ | ✔ Supabase | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `app/login` · `app/register` |
| Şirket oluşturma/güncelleme | `/dashboard/fleet` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `useFleet.ts:339` → `/api/company` |
| Üye / rol yönetimi | `/dashboard/fleet/members` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `/api/company/members` · `roles.ts` |
| Araç listesi / atama / çıkarma | `/dashboard/fleet/vehicles` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `list_company_vehicles` |
| Araç eşleştirme (6 hane) | PWA `/kumanda` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `PairingScreen.tsx` → `pair_vehicle_to_user` |
| Sahiplik devri | `/dashboard/fleet/transfer` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `ownershipTransfer.ts` · `accept/reject_vehicle_transfer` |
| Offline kuyruk + çakışma | `/dashboard/fleet` `/conflicts` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `useFleet.ts:320` replay · `ConflictBanner` |
| Realtime | Dashboard | ✔ | ✔ | — | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `useRealtime.ts` |
| Trip geçmişi | `/dashboard/vehicles` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `list_vehicle_trips` |
| Harita / konum | `/dashboard/map` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `app/dashboard/map` |
| Sürücü yönetimi + atama | `/dashboard/fleet/drivers` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `drivers.service.ts` (7 RPC) |
| Presence geçmişi | Araç detay | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `list_vehicle_presence_history` |
| Uzaktan komut (PWA) | `/kumanda` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `commandService.ts` → `/api/pwa/command` |
| Bildirimler | `/dashboard/notifications` | ✔ | ✔ | ✔ | ✔ | **KISMİ** | `PushNotificationWidget` |
| Reasoning kartları | `/dashboard/fleet/lab` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `reasoningLabSource.ts` (4 RPC) |
| AI Mechanic özeti | `/dashboard/fleet/lab` | ✔ | ✔ | türetilmiş | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `aiMechanicLabSource.ts` → `get_ai_mechanic_summary` |
| **Driver DNA kartı** | — | ✔ | ✔ SQL | ✔ | **✖** | **ÖLÜ KOD** | `DriverDnaCard.tsx` **0 import** · `get_driver_dna` **0 çağrı** |
| **Fleet Intelligence kartları** | — | ✔ | ✔ SQL | ✔ | **✖** | **ÖLÜ KOD** | `FleetIntelligenceCards.tsx` **0 import** · `get_fleet_intelligence` **0 çağrı** |
| **Evidence Coverage kartları** | — | ✔ | ✔ SQL | ✔ | **✖** | **ÖLÜ KOD** | `EvidenceCoverageCards.tsx` **0 import** · `get_evidence_coverage` **0 çağrı** |
| **Subject Evidence listesi** | — | ✔ | ✔ SQL | ✔ | **✖** | **ÖLÜ KOD** | `SubjectEvidenceList.tsx` **0 import** · `get_subject_evidence` **0 çağrı** |
| Key Beam (anahtar aktarımı) | `/key-beam` | ✔ | ✔ | ✔ | ✔ | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `submit_key_beam` |
| Diagnostics / Records / Theme Studio (PWA) | `/kumanda` sekmeler | ✔ | ✔ | ✔ | ✔ | **KISMİ** | lazy import edilmiş, gerçek |

---

## 5 · WEB SİTESİ / YÖNETİM ENVANTERİ

| Alan | Durum | Kanıt |
|---|---|---|
| Landing / features / enterprise / contact | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `app/(public)/*` |
| `/admin` | **YALNIZ UI** — sadece "giriş yapın" yönlendirme sayfası, gerçek panel değil | `app/admin/page.tsx` |
| Admin SPA (`src/admin`, 40+ dosya) | **DOĞRULANAMADI** — `admin.html` build girişi var, ürün içinden erişim yolu bulunamadı | `vite.config.ts:318` |
| Dashboard (ana) | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `app/dashboard/page.tsx` |
| Fleet Lab | **ÇALIŞAN VE ÜRÜNE BAĞLI** | `app/dashboard/fleet/lab/page.tsx` |
| Ayarlar / plan | **KISMİ** | `planService.ts` → `get_my_plan` |
| Dokümantasyon / destek | **YOK** | route bulunamadı |
| `StyleDesigner` | **ÖLÜ KOD** | 0 import |
| `layoutSolver` · `routeEngine` | **ÖLÜ KOD** | 0 import |

---

## 6 · GERÇEK KULLANICI AKIŞLARI

| Akış | Başlangıç → Bitiş | Tamamlanıyor mu | Kopma noktası |
|---|---|---|---|
| **Araç ilk açılış** | `App.tsx` → `systemBoot` (Wave 1-4) | ✅ Evet | — |
| **Araç kayıt + 6 haneli kod** | Ayarlar → `MobileLinkWidget` → `register_vehicle` → QR/kod | ✅ Evet | — |
| **Fleet'e araç bağlama** | PWA `/kumanda` → `PairingScreen` → `pair_vehicle_to_user` | ✅ Evet | — |
| **Telemetri gönderimi** | `telemetryService.start()` → Supabase | ✅ Evet | — |
| **Trip başlangıç/bitiş/yükleme** | Trip motoru → `startTripUpload` → `upload_vehicle_trip` | ✅ Evet | — |
| **Uzaktan komut** | PWA → `/api/pwa/command` → realtime → `commandListener` → araç | ✅ Evet | — |
| **Sürücü atama** | `/dashboard/fleet/drivers` → `create_vehicle_driver_assignment` | ✅ Evet | Head unit'te **görünmez** |
| **Driver Presence** | Araç → presence → SQL → PWA geçmişi | ✅ Evet | Head unit'te yalnız LAB |
| **Driver Authentication** | `driverAuthentication.ts` | ⚠️ Kısmi | **Hiçbir üründe UI yok** |
| **Driver DNA oluşumu** | SQL 053 → `get_driver_dna` | ❌ **Kopuk** | **Hiçbir yer RPC'yi çağırmıyor** |
| **Fleet Intelligence üretimi** | SQL 054 → `get_fleet_intelligence` | ❌ **Kopuk** | **Hiçbir yer RPC'yi çağırmıyor** |
| **Evidence üretimi** | SQL 055/056 tetikleyicileri | ✅ Sunucuda | Okuma ucu **yalnız** Reasoning kartlarında |
| **Reasoning üretimi** | SQL 057/058/059 | ✅ Sunucuda | LAB'da görünür |
| **AI Mechanic görünümü** | LAB ekranı + Fleet kartı | ⚠️ Kısmi | Head unit LAB dev-only; `get_ai_mechanic_analyses` **çağrılmıyor** |
| **Mavi kullanıcı sorusu** | Mikrofon → `voiceService` → `companionChatProvider` → gateway | ✅ Evet (eski yol) | Orchestrator/Mechanic dalı **kapalı** |
| **Offline kalıp tekrar bağlanma** | `useFleet` kuyruk + replay | ✅ Evet | — |
| **Araç devri** | `/dashboard/fleet/transfer` → accept/reject | ✅ Evet | — |
| **Logout / hesap değişimi** | `/api/auth/logout` · `revoke-session` | ✅ Evet | — |

**Sessiz başarısızlık riski:** `remoteConfigService._fetchAndApply()` ağ hatasında
sessizce `return` eder (satır 99) → bayraklar varsayılanda kalır ve kullanıcıya hiçbir
belirti verilmez. AI yığını bu yüzden "sessizce yok" durumundadır.

---

## 7 · ÇALIŞAN ÖZELLİKLER (özet)

Launcher · OBD canlı veri · DTC · CAN · GPS · online navigasyon · yerel müzik · Mavi
(temel yol) · trip motoru + yükleme · araç kimliği/eşleştirme · telemetri · uzaktan
komut · OTA · ayarlar · güvenlik overlay'leri · **tüm filo panosu** (şirket, üye, rol,
araç, atama, devir, çakışma, offline kuyruk, realtime, trip geçmişi, harita, sürücü
yönetimi) · Reasoning kartları · Key Beam.

---

## 8 · KISMİ ÖZELLİKLER

| Özellik | Eksik olan |
|---|---|
| BlackBox | Kayıt çalışıyor, **kullanıcıya gösteren ekran yok** |
| Deep Scan | Panel var ama LAB kataloğunda `PLACEHOLDER`; keşif sonucu ürün akışına dönmüyor |
| Spotify | Auth + servis var, App Remote entegrasyonu yok |
| Bildirimler | Widget var, uçtan uca senaryo doğrulanmadı |
| AI Mechanic | LAB + Fleet özeti var; **analiz listesi ve zincir RPC'lerinin tüketicisi yok** |
| Plan / üyelik | `get_my_plan` var, ödeme/limit uygulaması yok |

---

## 9 · KIRIK VE ÖLÜ ÖZELLİKLER

### Kırık

| Özellik | Kanıt | Kullanıcıya sonucu | Risk |
|---|---|---|---|
| **Offline rota** | `offlineRoutingService.ts` `routing-graph.bin` bekliyor; `public/maps/*.bin` **yok** | Şebekesiz alanda rota **üretilemez** | **YÜKSEK** — offline-first vaadinin merkezinde |

### Ölü kod (0 üretim referansı)

**Head unit (~1.962 satır):**
`obd/predictionEngine.ts` (164) · `obd/signalHub.ts` (122) · `obd/serviceFunctions.ts` (161) ·
`obd/kwpDtc.ts` (64) · `maviCore/intentResolver.ts` (523) · `manufacturerProfileBuilder.ts` (234) ·
`camera/Vehicle3DViewer.tsx` (434) · `nativeCoreService.ts` (119) · `settings/CanDiagPanel.tsx` ·
`appNavigationService.ts` · `bootstrapOfflineTiles.ts` · `mapDownloadManager.ts` ·
`tileLoader.ts` · `themePreviewBridge.ts` · `theme/themeDocument.ts` · `voiceTypes.ts` ·
`obdBluetoothService.ts` · `phoneHub/phoneHubUserModel.ts` · `system/logGate.ts` ·
`maviCore/discoveryActions.ts` · `trip/wiring/tripApplyComposition.ts` ·
`obd/adapterCapability.ts` · `navigation/guardian/.../obdServiceHealthPort.ts`

**Website (7 modül):**
`DriverDnaCard` · `EvidenceCoverageCards` · `FleetIntelligenceCards` · `SubjectEvidenceList` ·
`StyleDesigner` · `lib/layoutSolver.ts` · `lib/routeEngine.ts`

**Native (10/131 metot JS'siz):**
`startCanBusUpdates` · `stopCanBusUpdates` (→ `startCanBus`/`stopCanBus` ile **çift API**) ·
`enqueueOfflineData` · `drainOfflineBuffer` · `getNativeHeartbeat` · `setNativeOdometer` ·
`setSupabaseConfig` · `startNativeStream` · `stopNativeStream` · `wakeUpService`

**SQL (tüketicisi olmayan okuma RPC'leri):**
`get_driver_dna` · `get_fleet_intelligence` · `get_evidence_coverage` ·
`get_subject_evidence` · `get_evidence_chain` · `get_evidence_adapter_status` ·
`get_reasoning_chain` (yalnız `get_ai_mechanic_chain` delege ediyor, o da çağrılmıyor) ·
`get_ai_mechanic_analyses` · `get_ai_mechanic_chain` · `get_recent_reasoning_events` ·
`get_active_driver_assignment` · `get_support_reports`

---

## 10 · PLACEHOLDER VE DEBUG ALANLARI

- **CAROS LAB:** 33 ekran, 9.803 satır, 34 `AVAILABLE` / 7 `PLACEHOLDER` / 2 `DISABLED`.
  Tamamı `DEVELOPER_FEATURES_ENABLED` arkasında → **satış build'inde görünmez.**
- **Admin SPA:** `src/admin` 40+ dosya, ayrı `admin.html` girişi, ürün içinden link yok.
- **PLACEHOLDER modüller:** Deep Scan · UDS Explorer · Recovery Monitor · Tool Calling ·
  Memory Explorer · Knowledge Explorer · Benchmark.
- **Sahte sıfır riski:** `remoteConfigService` sessiz `return`; `debugStore.listenerCount`
  hiç yazılmıyor (bu tur UNAVAILABLE'a çevrildi).

---

## 11 · TEKRARLANAN OTORİTELER

| Konu | Paralel otoriteler | Karar |
|---|---|---|
| **Karar üretimi** | `obd/verdictEngine` · `diagnosticTriage` · `aiCore/verdictEngine` · `diagnosticKnowledgeEngine.combineConfidence` · `maintenanceBrain` · `fuelAdvisorService` · `smartCardEngine` · `predictionEngine` (ölü) — MAVI Reasoning'i **bypass ediyorlar** | **REWORK** — kütük #284 |
| **CAN başlatma** | `startCanBus`/`stopCanBus` (canlı) ↔ `startCanBusUpdates`/`stopCanBusUpdates` (ölü) | **REMOVE** ölü çift |
| **Offline tampon** | JS kuyruğu (canlı) ↔ native `enqueueOfflineData`/`drainOfflineBuffer` (ölü) | **REMOVE** veya **REWORK** |
| **Hata kanalı** | `crashLogger` (canonical) ↔ `debugStore.errorLog` (bu tur otoriteye bağlandı) | ✅ çözüldü |
| **Odometre** | ECU odometresi ↔ GPS/DR türevi (bu tur `trip_distance`e ayrıldı) | ✅ çözüldü |
| **Eşleştirme yolu** | `/api/vehicle/code` (deprecated) ↔ `refresh_linking_code` (canonical) | ✅ işaretlenmiş |
| **AI Mechanic** | Eski `aiCore/agents/aiMechanic.ts` ↔ yeni `platform/aiMechanic/*` | **MERGE** — ikisi farklı şey ama isim çakışıyor |

---

## 12 · AMAÇ DIŞI / DÜŞÜK DEĞERLİ

| Özellik | Karar | Gerekçe |
|---|---|---|
| `Vehicle3DViewer` (434 satır) | **REMOVE** | Ölü; düşük-uçta zaten feda edilecek görsel |
| `StyleDesigner` · `ThemeStudio` · `themeDocument` · `themePreviewBridge` | **MERGE/LAB_ONLY** | Tema tasarımcısı ürün farklılaştırıcısı değil, bakım yükü yüksek |
| `layoutSolver` · `routeEngine` (website) | **REMOVE** | Ölü; sunucuda rota motoru ürün kapsamı dışı |
| `intentResolver` (523 satır) | **REMOVE** | Ölü; Mavi'nin canlı yolu farklı |
| `predictionEngine` · `signalHub` · `serviceFunctions` · `kwpDtc` · `manufacturerProfileBuilder` | **REMOVE** | Ölü; ~745 satır bakım yükü |
| Admin SPA | **LAB_ONLY** veya **DEPRECATE** | Erişim yolu yok; filo panosu aynı işi yapıyor |
| CAROS LAB 33 ekran | **KEEP (LAB_ONLY)** | Faz A politikası gereği meşru, ama ürün değeri sıfır — hacmi dondurulmalı |

---

## 13 · ÜRÜN SEVİYE TABLOSU

| Alan | Seviye | Gerekçe (kod kanıtı) |
|---|:--:|---|
| Araç bağlantısı | **4** | `OBDManager.java` + BLE + classic + reconnect + handshake kanıtı |
| Telemetri | **3** | `telemetryService.start()` bağlı; saha doğrulaması yok |
| Konum | **4** | `gpsService` + `LocationEngine` + DR + presence |
| Trip | **3** | Motor + yükleme + geçmiş bağlı; metrik doğruluğu sahada ölçülmedi |
| Sürücü kimliği | **2** | SQL + servis var, **head unit UI yok**, yalnız PWA |
| Filo yönetimi | **4** | Şirket/üye/rol/araç/devir/çakışma/offline kuyruk uçtan uca |
| Offline | **3** | Fleet kuyruğu güçlü; **offline rota verisi yok** |
| Realtime | **3** | `useRealtime` + `commandListener` çalışıyor |
| Güvenlik | **3** | RLS matrisi + fail-closed RPC'ler; `anon` GRANT disiplini var |
| AI Evidence | **2** | SQL güçlü, okuma ucu **yok** |
| Reasoning | **3** | SQL + kuyruk + zamanlayıcı + Fleet kartları bağlı |
| AI Mechanic | **1** | Yalnız LAB + özet kartı; analiz/zincir RPC'leri tüketicisiz |
| Predictive Maintenance | **0** | `predictionEngine` ölü; başka uygulama yok |
| Driver DNA | **1** | SQL var, **hiçbir yüzeyde okunmuyor** |
| Fleet Intelligence | **1** | SQL var, **hiçbir yüzeyde okunmuyor** |
| Mavi | **3** | Sesli asistan çalışıyor; zekâ katmanları bayrak arkasında |
| Deep Scan | **2** | Panel var, sonuç ürün akışına dönmüyor |
| CAN | **3** | 22 Java dosyası, çoklu taşıma, JS köprüsü bağlı |
| BlackBox | **2** | Kayıt var, **görüntüleme yok** |
| Navigasyon | **3** | Online tam; offline rota kırık |
| Müzik | **3** | Yerel tam, Spotify kısmi |
| Ürün UX | **2** | Faz A gereği bilinçli; son kullanıcı yüzeyi ikincil |
| Gözlemlenebilirlik | **4** | CAROS LAB + kanıt/karar zinciri + kütük disiplini |
| Production readiness | **2** | Migration'lar üretime uygulanmamış; bayraklar kapalı |
| Gerçek saha doğrulaması | **1** | Kütükte 🔴 maddeler baskın; 🟢 sayısı çok az |

---

## 14 · KODUN GERÇEKTE OLUŞTURDUĞU ÜRÜN

Kod bugün CAROS PRO'yu şu üçlünün **birleşimi** yapıyor:

> **Head unit launcher** + **OBD teşhis cihazı** + **filo yönetim sistemi**

"Otomotiv işletim sistemi" ve "AI araç asistanı" iddialarının **altyapısı** yazılmış ama
**ürün yüzeyi bağlanmamıştır.**

- **En fazla geliştirme:** AI/Mavi yığını (~23k satır) + CAROS LAB (~9.8k satır) — yani
  en büyük iki yatırım, **kullanıcıya hiç ulaşmayan** iki alan.
- **En fazla kullanıcı değeri:** filo panosu + OBD/DTC + launcher.
- **Boşa giden en büyük teknik yatırım:** AI gateway arkasındaki 11 alt sistem ve
  Driver DNA / Fleet Intelligence okuma uçları.
- **Çok altyapı, az ürün yüzeyi sorunu:** **Evet, keskin biçimde.** `platform/` altında
  60+ servis var; kullanıcı bunların belki 15'ini görüyor.

**Bugün kullanıcı ne kazanır?** Araçta modern bir launcher, gerçek OBD verisi ve arıza
kodu okuma, harita, müzik, sesli komut; telefonundan aracını görme ve komut gönderme.

**Şirket bugün satın alsa hangi işini çözer?** Araç envanteri, kullanıcı/rol yönetimi,
araç eşleştirme ve devri, trip geçmişi, canlı konum, offline dayanıklı filo panosu.

**Henüz kodda karşılığı olmayan vaatler:** öngörülü bakım, sürücü davranış skoru,
filo zekâsı, "aracın ikinci beyni", kanıta dayalı AI teşhisi.

---

## 15 · EN BÜYÜK 10 ÜRÜN AÇIĞI

1. **AI yığını hiçbir cihazda çalışmıyor** — bayrak varsayılan kapalı, seed/UI yok.
2. **Driver DNA'nın okuma ucu yok** — SQL üretiyor, kimse okumuyor.
3. **Fleet Intelligence'ın okuma ucu yok** — aynı.
4. **Offline rota verisi paketlenmemiş** — offline-first vaadinin merkezinde boşluk.
5. **BlackBox kullanıcıya gösterilmiyor** — kaza kaydı var, erişim yok.
6. **Head unit'te sürücü kimliği yüzeyi yok** — kim sürüyor sorusu araçta sorulamıyor.
7. **Deep Scan sonucu ürüne dönmüyor** — keşif yapılıyor, karar üretilmiyor.
8. **Predictive Maintenance sıfır** — `maintenanceBrain` var ama tahmin motoru ölü.
9. **Plan/limit uygulaması yok** — `get_my_plan` okunuyor, hiçbir şeyi kısıtlamıyor.
10. **Migration'lar üretime uygulanmamış** — 060'a kadar yalnız yerelde.

---

## 16 · EN BÜYÜK 10 TEKNİK BORÇ

1. **8 paralel karar otoritesi** MAVI Reasoning'i bypass ediyor (kütük #284).
2. **~2.000 satır ölü head unit kodu** + 7 ölü website modülü.
3. **12 tüketicisiz SQL okuma RPC'si** — bakım yükü, yanlış "hazır" algısı.
4. **`obdService` dairesel import kırılganlığı** (TDZ; kütük bu turda kaydedildi).
5. **Reasoning TTL anomalisi** (kütük #307).
6. **Website ESLint `src/**` ignore ediyor** — lint fiilen koşmuyor (kütük #287).
7. **Native `startCanBusUpdates` çift API'si** — kafa karıştırıcı ölü yol.
8. **Admin SPA erişim yolu belirsiz** — build ediliyor ama ulaşılamıyor.
9. **`remoteConfigService` sessiz başarısızlık** — bayrak çekilemezse belirti yok.
10. **CAROS LAB hacmi (9.8k satır) dondurulmamış** — her yeni özellik LAB borcu üretiyor.

---

## 17 · EŞSİZ YAPACAK EN DEĞERLİ 10 ÖZELLİK

Mevcut güçlü temeller: **gerçek OBD/CAN çokluk-taşıma katmanı**, **kanıt→karar
omurgası (055–060)**, **offline-dayanıklı filo kuyruğu**, **CAROS LAB gözlem disiplini**,
**Trip + Presence + Identity zinciri**.

### A · HEMEN YAPILMALI

**1. AI Yığınını Açan Tek Anahtar**
*Altyapı:* `aiGatewayFlag` + `feature_flags` tablosu · *Fayda:* 23k satır yatırım anında
ürüne dönüşür · *Fark:* rakiplerde bu derinlikte kanıt/karar zinciri yok · *Eksik:* seed
satırı + Ayarlar'da anahtar + kademeli açılış · *Zorluk:* düşük · *Değer:* çok yüksek ·
*Sürüm:* bir sonraki · *Neden şimdi:* en yüksek getiri/maliyet oranı.

**2. Vehicle Health Card — kanıta dayalı tek ekran**
*Altyapı:* `get_ai_mechanic_summary` + `get_ai_mechanic_analyses` (zaten yazılı, tüketicisiz) ·
*Fayda:* sürücü "aracım iyi mi" sorusunun **kanıtlı** cevabını görür · *Fark:* Tesla
gösterir, biz **neden**ini ve **güven**ini gösteririz · *Eksik:* yalnız bir ekran ·
*Zorluk:* düşük · *Değer:* çok yüksek.

**3. Driver DNA Panosu**
*Altyapı:* SQL 053 + `driverDnaView.ts` + `DriverDnaCard.tsx` (hepsi hazır, mount yok) ·
*Fayda:* filo müşterisi sürücü davranışını görür · *Fark:* trip'ten değil **kanıttan**
türetilmiş · *Eksik:* 1 fetch + 1 mount · *Zorluk:* çok düşük · *Değer:* yüksek.

**4. Fleet Intelligence Panosu** — aynı durum, aynı maliyet, filo geneli görünüm.

### B · TEMEL TAMAMLANINCA

**5. Kaza Kara Kutusu Raporu**
*Altyapı:* `blackBoxService` 10Hz + 1Hz tamponlar, `crashLogger` · *Fayda:* kaza sonrası
adli rapor (hız/RPM/fren/G) · *Fark:* aftermarket'te neredeyse yok · *Eksik:* görüntüleme
ekranı + PDF/paylaşım · *Değer:* çok yüksek (sigorta/filo).

**6. Offline Rota Paketi**
*Altyapı:* `offlineRoutingService` + worker · *Eksik:* `routing-graph.bin` üretim
hattı · *Fark:* şebekesiz bölgede çalışan gerçek navigasyon · *Zorluk:* orta.

**7. Araçta Sürücü Kimliği**
*Altyapı:* `driverAuthentication` + `driverPresence` + Key Beam · *Fayda:* "kim
sürüyor" araçta çözülür; DNA ve atama gerçek olur · *Eksik:* güvenli araç-içi kimlik
yüzeyi · *Zorluk:* orta-yüksek (güvenlik kritik).

**8. Deep Scan → Kalıcı Araç Profili**
*Altyapı:* Deep Scan + `vehicleKnowledgeBase` + Evidence · *Fayda:* bilinmeyen araç bir
kez taranır, sonsuza dek tanınır · *Fark:* **asıl farklılaştırıcı** — Tesla kendi
aracını bilir, biz **öğreniriz**.

### C · UZUN VADELİ FARKLILAŞTIRICI

**9. Öngörülü Bakım (kanıt tabanlı)**
*Altyapı:* Evidence + Reasoning + Trip + DNA · *Eksik:* zaman serisi kanıt + eşik
öğrenimi · *Fark:* kural değil **kanıt** tabanlı tahmin.

**10. Filo Sağlık Skoru + Servis Planlayıcı**
*Altyapı:* Fleet Intelligence + AI Mechanic + Trip · *Fayda:* filo yöneticisi hangi
aracı ne zaman servise sokacağını görür · *Değer:* doğrudan ticari.

---

## 18 · SEKTÖREL UYARLAMA

| Sektör | Bugün hazır | Eksik | En değerli 3 özellik | Zorluk |
|---|---|---|---|---|
| **Lojistik** | Filo panosu · trip · konum · offline kuyruk | Yük/sefer modeli, ETA | Sefer takibi · yakıt/km raporu · sürücü skoru | Orta |
| **Taksi** | Konum · trip · sürücü atama | Vardiya, hakediş | Vardiya raporu · sürücü skoru · araç sağlık kartı | Orta |
| **Servis taşımacılığı** | Konum · presence · geofence | Güzergâh/yolcu | Geofence bildirimi · güzergâh uyumu · sürücü kimliği | Orta |
| **İnşaat** | OBD · offline · BlackBox | Motor saati, ekipman | Motor saati bakım · kara kutu · offline dayanıklılık | Düşük-orta |
| **Tarım** | Offline · konum · OBD | Alan/parsel | Offline harita · motor saati · yakıt takibi | Orta |
| **Kurumsal filo** | **Neredeyse tamamı** | Plan/limit, raporlama | Sürücü DNA · araç sağlık kartı · maliyet raporu | **Düşük** |
| **Kiralama** | Devir · kimlik · trip | Sözleşme, hasar | Devir + kara kutu · teslim/iade raporu · geofence | Orta |
| **Belediye** | Konum · offline · filo | Görev/rota | Görev takibi · araç sağlığı · yakıt | Orta-yüksek |
| **Acil servis** | Realtime · konum · komut | Öncelik/görev | Anlık konum · araç hazırlık durumu · kara kutu | Yüksek |

**En hazır sektör: kurumsal araç filosu** — mevcut kodla bugün satılabilir seviyeye en
yakın olan bu. **CAROS PRO'nun farklılaşma noktası:** bilinmeyen aracı öğrenen
kanıt/karar omurgası — hiçbir rakip aftermarket üründe bu derinlikte yok.

---

## 19 · NE DURDURULMALI

- CAROS LAB'a yeni ekran eklemek (hacim dondurulmalı).
- AI yığınına yeni alt sistem eklemek (mevcutlar açılmadan).
- Admin SPA geliştirmesi (erişim yolu netleşmeden).
- Tema/tasarım araçları (`StyleDesigner`, `ThemeStudio`, `themeDocument`).
- Yeni paralel karar otoritesi üreten her PR.

## 20 · NE TAMAMLANMALI

- AI gateway açılışı (seed + UI + kademeli).
- Driver DNA / Fleet Intelligence / Evidence okuma uçları (fetch + mount).
- AI Mechanic analiz listesi tüketicisi.
- Offline rota verisi.
- BlackBox görüntüleme.
- Migration'ların üretime uygulanması.

## 21 · NE YENİ BAŞLATILMALI

- **Vehicle Health Card** (tek ekran, en yüksek getiri).
- **Deep Scan → kalıcı araç profili** zinciri.
- Ölü kod temizliği (~2.000 satır head unit + 7 website modülü).

---

## 22 · 3 AŞAMALI YOL HARİTASI

**Aşama 1 — "Var olanı görünür yap" (en yüksek getiri):**
AI gateway anahtarı · Driver DNA + Fleet Intelligence mount · AI Mechanic analiz
listesi · Vehicle Health Card · ölü kod temizliği.

**Aşama 2 — "Boşlukları kapat":**
Offline rota paketi · BlackBox raporu · araçta sürücü kimliği · Deep Scan → profil ·
migration'ların üretime alınması · paralel karar otoritelerinin MAVI'ye taşınması.

**Aşama 3 — "Farklılaş":**
Öngörülü bakım · filo sağlık skoru + servis planlayıcı · sektör paketleri
(önce kurumsal filo).

---

## 23 · NİHAİ ÜRÜN SEVİYESİ KARARI

```
CURRENT_PRODUCT_LEVEL: INTEGRATED_BETA
```

**Gerekçe:** Ana akışlar (eşleştirme · telemetri · trip · komut · filo yönetimi · devir ·
offline) uçtan uca **gerçekten** bağlı ve çalışıyor — bu `LOCAL_PLATFORM`'un üstüdür.
Ancak saha doğrulaması yok, migration'lar üretime uygulanmamış, en büyük iki yatırım
(AI ve LAB) kullanıcıya kapalı — bu da `FIELD_BETA`nın altındadır.

| Kapı | Karar |
|---|---|
| `vehicleAppVerdict` | **INTEGRATED_BETA** — launcher + OBD/DTC/CAN/GPS/nav/müzik/Mavi bağlı; BlackBox ve sürücü kimliği yüzeysiz, offline rota kırık |
| `pwaFleetVerdict` | **FIELD_BETA** — en olgun yüzey; filo akışlarının tamamı bağlı ve telefonda 15/15 senaryo geçmiş (kütük #195) |
| `websiteVerdict` | **INTEGRATED_BETA** — public site + dashboard gerçek; admin yüzeyi ve dokümantasyon yok |
| `aiPlatformVerdict` | **PROTOTYPE** — omurga güçlü ama **hiçbir kullanıcı erişemiyor**; bayrak kapalı, okuma uçları bağlanmamış |
| `productionReadinessVerdict` | **BLOCKED** — migration'lar (055–060) üretime uygulanmadı; bayraklar kapalı; plan/limit uygulanmıyor |
| `fieldValidationVerdict` | **BLOCKED_REAL_VEHICLE** — kütükte 🔴 maddeler baskın; araçla doğrulanmış özellik sayısı çok düşük |

---

*Bu rapor yalnız kod okunarak üretildi. Her olumlu karar bir dosya/satır kanıtına
bağlandı; kanıt bulunamayan hiçbir alan "hazır" sayılmadı.*
