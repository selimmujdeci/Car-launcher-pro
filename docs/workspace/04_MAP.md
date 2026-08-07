# CAROS PRO — MODÜL DURUM HARİTASI

> Bu belge mimariyi **anlatmaz**; tek soruyu yanıtlar: *hangi sistem gerçekten bağlı,
> hangisi yalnız gölge, hangisi iskelet, hangisi kapalı, hangisi vizyon, hangisi ölü?*
>
> **Durumlar:** `ACTIVE` (gerçek karar/davranış üretir) · `WIRED` (bağlı ama her durumda
> ana otorite değil) · `SHADOW` (değerlendirir, aktif davranışı belirlemez) · `PARTIAL`
> (yalnız bir bölümü bağlı) · `SKELETON` (yapı var, yetenek yok) · `DISABLED` (bilinçli
> kapalı) · `DARK` (kod var, üretim akışına bağlı değil) · `DEAD` (terk edilmiş) ·
> `VISION` (yalnız hedef) · `UNKNOWN` (kanıt yetersiz).
>
> **Import edilmiş olmak `ACTIVE` yapmaz.** Kod ile belge çelişirse **kod esastır** ve
> çelişki `03_DEBT.md` adayıdır. `SystemBoot.ts` satır numaraları `_reg(...)` kaydıdır.

## A. Ana sistem

| Alan / Modül | Durum | Ana giriş noktası | Gerçek davranış | Kanıt | Sınır / açık borç |
|---|---|---|---|---|---|
| SystemBoot | ACTIVE | `platform/system/SystemBoot.ts` | Dalgalı boot; tüm servisleri `_reg()` ile kaydeder, LIFO kapatır | `SystemBoot.ts:623-951` | — |
| Adaptive Runtime / DeviceTier | ACTIVE | `core/runtime/AdaptiveRuntimeManager.ts` | Mod seçer, `--rt-blur`/`--rt-anim` sürer, histerezisli | `AdaptiveRuntimeManager.ts:238,325` · ADR 0002 · kütük #138 | AÇILIŞ modu daima `BASIC_JS`; K24'te ölçüldü ama cihaz LOW-tier olduğu için ayırt edici DEĞİL → DEBT-002 |
| Event Bus | ACTIVE | `system/platformCoreEventBusWiring.ts` | Tek sahipli singleton; Kernel DI ile publisher | `SystemBoot.ts:623` · `PROJECT_MEMORY.md` | — |
| Vehicle HAL (+ bridge) | ACTIVE | `platformCoreVehicleHalWiring.ts` | Store'dan HAL'e batch ingest + bus köprüsü | `SystemBoot.ts:734,745` | Saha kayıtları 🔴 |
| Capability Registry (+ bridge) | WIRED | `platformCoreCapabilityWiring.ts` | Yetenek kaydı ve bus köprüsü; karar otoritesi değil | `SystemBoot.ts:757,769` | — |
| System Orchestrator | ACTIVE | `system/SystemOrchestrator.ts` | Event-driven güvenlik/uyarı orkestrasyonu; **poll yok** | `SystemBoot.ts:789` | — |
| Battery Protection | ACTIVE | `platform/power/BatteryProtectionService.ts` | 4 seviye voltaj koruması + histerezis + hareketli ortalama; runtime tavanı düşürür | `SystemBoot.ts:810` (koşulsuz) · servis 288 satır | Voltaj YALNIZ OBD'den; gerçek araçta seviye geçişi ölçülmedi |
| Safety Brain | ACTIVE | `platform/safety/SafetyBrain.ts` | Arıza takibi + özellik devre dışı bırakma; boot'ta hidrasyon | `SystemBoot.ts:24` | — |
| Gözlemlenebilirlik (trail/perf/UI) | ACTIVE | `diagnosticTrail.ts` · `perfSeriesRecorder.ts` · `uiActivityRecorder.ts` | Olay izi + performans serisi + UI etkinliği kaydı | `SystemBoot.ts:631-635` | — |
| Runtime durumu gözlemi | DARK | — | Üretimde runtime modu/tier/SAB okunabilir bir yüzey YOK; `InspectorPanel.tsx:78` DEV-only | kütük #138 · `vite.config.ts:311` | DEC-012 ihlali → DEBT-011 |

## B. Mavi ve AI

| Alan / Modül | Durum | Ana giriş noktası | Gerçek davranış | Kanıt | Sınır / açık borç |
|---|---|---|---|---|---|
| Mavi Voice wiring | SHADOW | `maviCore/wiring/maviWiring.ts` | Faz-2 coexistence: pilot handler'lar no-op; lifecycle/telemetri/güvenlik kapısı gölge çalışır | `SystemBoot.ts:920` + yorum "Model A: pilot handler'lar no-op" | Çifte yürütme YOK — bilinçli |
| Takeover policy | PARTIAL | `maviCore/wiring/takeoverPolicy.ts` | Devralma yalnız allowlist'te; bugün tek eylem | `takeoverPolicy.ts:22` `TAKEOVER_ELIGIBLE = {'media.next'}` | DEC-013 (PROVISIONAL) |
| Action Registry | WIRED | `maviCore/actionRegistry.ts` | Eylem sözleşmeleri + risk/geri alınabilirlik; yürütme SHADOW'da | 14 pilot eylem · kilit testi | Telefon eylemleri fail-soft red |
| Companion chat provider | ACTIVE | `companion/companionChatProvider.ts` | Gerçek sohbet + prompt funnel + proaktif kritik uyarı kapısı | `_buildPromptForTest`, `PROACTIVE_MIN_CONFIDENCE` | Kütük #124/#133/#134 🔴 |
| Active Topic (kısa bağlam) | PARTIAL | `companion/companionContext.ts` | Tur-tabanlı konu yazma/okuma prompt'a bağlı | `companionChatProvider.ts:448` | Ses hattı + LAB yüzeyi yok → DEBT-009 |
| `evaluateDemonstrativeRequest` | DARK | `companion/companionChatProvider.ts:464` | Üretimde **hiçbir çağıran yok**; yalnız test/senaryo | grep: üretim çağrısı 0 | DEBT-009 |
| AI Core runtime (AI Usta) | WIRED | `system/platformCoreAiRuntimeWiring.ts` | Edge-tetikli, salt-okuma teşhis; `ai.mechanic.report` yayınlar | `SystemBoot.ts:951` + yorum "İKİNCİ POLLING/OTORİTE YOK" | ECU yazma/kodlama bloke |
| Proaktif karar kayıt halkası | PARTIAL | `ai/aiOfflineReason.ts` | Sebep kodu + güven + kaynak kaydı | `:230` `ProactiveDecisionSource` | Yalnız `'rule'` üretiliyor → DEBT-008 |
| Assistant Safety Kernel | WIRED | `assistant/assistantSafetyKernel.ts` | Eylem öncesi güvenlik değerlendirmesi | capability provider + companion tüketimi | — |
| Wake word / Vosk STT | ACTIVE | `wakeWordService.ts` | Ayar-tabanlı pasif wake; Vosk hazır olunca dinleme | `SystemBoot.ts:911` + `notifyVoskModelReady` | — |
| Mavi Senaryo Koşucusu | WIRED | `devtools/maviScenarioRunner.ts` | 14 deterministik senaryo; **yan etkisiz simülasyon** | Kütük #135 | ⚠️ Cihaz doğrulaması **DEĞİLDİR** |

## C. OBD ve teşhis

| Alan / Modül | Durum | Ana giriş noktası | Gerçek davranış | Kanıt | Sınır / açık borç |
|---|---|---|---|---|---|
| obdService | ACTIVE | `platform/obdService.ts` | Bağlantı/oturum/veri hattı; mock yalnız `VITE_ENABLE_OBD_MOCK` ile | `FEATURE_FLAGS.md §1` | Prod'da mock kapalı |
| OBD transport (Classic + BLE) | ACTIVE | `obdService.ts:109-126` | Transport MAC ile persist; derleme-zamanı flag YOK | ADR 0003 · `FEATURE_FLAGS.md §5` | ADR: "saha testi bekliyor" |
| Oturum sağlığı kapıları | ACTIVE | `devtools/adapterDiagnosticsModel.ts` | `transportReady` · `sessionReady` · `dataFresh` (adaptif) · `isStale` (mutlak 4 sn) | `:99-131,261-300` | İkisi **birleştirilmez** |
| Auto DID keşfi | ACTIVE | `obd/autoDidDiscovery.ts` | Arka planda DID keşif izleyici | `SystemBoot.ts:725` | — |
| Deep Scan | PARTIAL | `system/platformCoreDeepScanWiring.ts` | Wiring kayıtlı; aktif fazlar kontak doğrulanana dek bloke | `SystemBoot.ts:782` · `:33` "waiting_for_ignition" | Fail-closed (DEC-009) — kusur değil |
| Ignition kanıt adaptörü | WIRED | `deepScan/ignitionEvidenceAdapter.ts` | RPM ≥ 400 + alternatör ≥ 13.2V iki-sinyal onayı | Kütük #127 | 🔴 cihazda ölçülmedi |
| Change Detection (offline pass) | WIRED | `deepScan/offlineChangeDetectionHandler.ts` | Soğuk-yolda değişim taraması | `platformCoreDeepScanWiring` | Deep Scan'e bağımlı |
| Vehicle Fingerprint | ACTIVE | `vehicleFingerprintBuilder.ts` | Otomatik araç parmak izi üretimi | `SystemBoot.ts:819` | — |
| Vehicle Intelligence Service | WIRED | `vehicleIntelligenceService.ts` | Sinyal yorumlama servisi | `SystemBoot.ts:814` | "8 Kapı"nın tamamı değil |
| Öğrenme hattı (auto/KB/evidence) | WIRED | `autoLearningEngine.ts` · `vehicleKnowledgeBase.ts` · `vehicleLearningEvidenceBridge.ts` | Yetenek/kanıt öğrenme zinciri | `SystemBoot.ts:824,829,835` | Saha kayıtları 🔴 |
| KWP monitörü | WIRED | `devtools/kwpMonitorModel.ts` | LAB'da KWP oturum/Data Gate gözlemi (salt-okunur) | `carosLabCatalog` | Gözlem — kurtarma değil |
| Digital Twin | UNKNOWN | — | `digitalTwin` adlı modül kodda **bulunamadı** | grep: 0 eşleşme · vizyon `:911` "İSKELET" | Belge-kod çelişkisi; kanıt yetersiz |

## D. Platform

| Alan / Modül | Durum | Ana giriş noktası | Gerçek davranış | Kanıt | Sınır / açık borç |
|---|---|---|---|---|---|
| CAROS LAB | ACTIVE | `devtools/carosLabGate.ts` | Developer kapısı kapalıysa ekran **render edilmez** (fail-closed route kapısı) | `:54-66` `shouldRenderCarosLab` | Salt-okunur (DEC-012) |
| Phone Hub | PARTIAL | `platform/phoneHub/*` | Yalnız CAROS LAB ekranlarından erişilir; `SystemBoot`'ta **kayıt YOK** | grep: `SystemBoot` içinde `phoneHub` yok | Cihazda hiç çalışmadı → DEBT-006 |
| VCOMP (VehicleCompute worker) | ACTIVE | `vehicleDataLayer/VehicleCompute.worker.ts` | Hız/odometre/geofence; global fail-safe + fail-closed kaynak kapısı + `_odoTMR` | `:245-269` · kütük #136/#137 | `FUSED` gönderen taraf → DEBT-007 |
| SAB / crossOriginIsolated | DISABLED | `vite.config.ts` (COEP kaldırıldı) | **Bilinçli ve kabul edilmiş politika**: üretim SAB'a bağımlı değil, her yol JSON fallback ile çalışır; kod korunuyor | DEC-014 · DEC-017 · `offlineRoutingService.ts:333` | SAB borç DEĞİLDİR; runtime bütçe seçimi AYRI değerlendiriliyor (DEBT-002). Kör COOP/COEP yaması YASAK |
| Offline haritalar | ACTIVE | `mapSourceManager.ts` · `public/maps/` | Online/offline/cached kaynak anahtarlama + SW önbelleği | `SERVICE_WORKER_OFFLINE.md` | OSM atıfı zorunlu (DEC-015) |
| Navigasyon | ACTIVE | `navigationService.ts` · `NavigationCompute.worker.ts` | Rota + rehberlik; AI.md navigasyon invaryantlarına tabi | `AI.md` NAVIGATION RULES | Offline routing sınırlı |
| Traffic provider | PARTIAL | `trafficService.ts:48` | HERE/TomTom yalnız `VITE_*_API_KEY` varsa; yoksa sağlayıcı yok | `:5-6,48` | Anahtar build'e inline olur (ölçülmedi) |
| OTA | WIRED | `otaUpdateService.ts` | Boot kontrolü + 6 saatlik poll | `SystemBoot.ts:927` | Sunucu tarafı repo'da yok |
| Remote log / self-pair | WIRED | `remoteLogService.ts` · `vehicleIdentityService.ts` | Sessiz cihaz kaydı + uzak log sink | `SystemBoot.ts:936,941` | Supabase env yoksa no-op |
| Black Box | WIRED | `security/blackBoxService.ts` | Olay kaydı | `SystemBoot.ts:806` | — |
| Native köprü (Capacitor) | ACTIVE | `platform/bridge.ts:226` | `Capacitor.isNativePlatform()` ile native/demo seçimi | `FEATURE_FLAGS.md §5` | Flag değil, runtime tespiti |

## E. Yalnız vizyon (bugün çalışan sistem DEĞİL)

| Alan | Durum | Kanıt | Not |
|---|---|---|---|
| Smart Surveillance · Continuous Surveillance | VISION | `docs/CAROS_PRO_VIZYONU.md:1059-1060` (`YOK`) · kodda karşılık yok | Güç bütçesi tanımlanmadan uygulanması **yasak**; Battery Protection bunları kapsamaz |
| Hidden Fault Hunter · Vehicle MRI · Scan Completeness | VISION | Vizyon `:926,931,990` | Deep Scan + UDS'e bağımlı |
| Mavi'nin tek karar otoritesine dönüşmesi | VISION | DEC-013 · `docs/MAVI_NEXT_VISION.md` | Bugün SHADOW + tek eylemlik takeover |
| Diğer uzun vadeli Vehicle OS zekâ yetenekleri | VISION | `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` | Tek tek listelenmez; otoriter belgeye bakılır |
