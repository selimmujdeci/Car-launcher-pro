# CAROS PRO — Proje Hakimiyet Raporu

> **Amaç:** Tüm gelecek geliştirmelerin ana referansı. Repo haritası + mimari harita +
> modül bağımlılık haritası + risk listesi + öncelik listesi.
> **Kural:** Tahmin yok — her yargı kod kanıtına dayanır. Mock/demo/placeholder ayrı işaretli.
> **Tarih:** 2026-07-08. **Kardeş belgeler:** `WEB_URUN_UYUM_BACKLOG.md`,
> `CAROS_15_YIL_VIZYON_YOL_HARITASI.md`, `DEVICE_VALIDATION_LEDGER.md`, `AI.md`.

---

## 0) BÜYÜK RESİM — 3 FRONTEND + NATIVE + BACKEND

Bu tek repo, **üç ayrı ürünü** barındırır:

| # | Ürün | Kaynak | Build | Dağıtım |
|---|---|---|---|---|
| 1 | **Araç Launcher OS** (head unit) | `src/` (main) | Vite `index.html` → APK (Capacitor) | Android head unit |
| 2 | **Superadmin/Filo SPA** | `src/admin/` | Vite `admin.html` | car-launcher-pro.vercel.app/admin |
| 3 | **Website + PWA + Dashboard** | `website/` (Next 14) | Next | carospro.com |

**Boyut (kod kanıtı):** `src/` 671 ts/tsx · `android/.../java` 47 java/kt · `website/src` 103 ·
supabase 28 migration · test 152 unit + 11 e2e.

**Kritik ayrım:** "Web panel" **iki ayrı yerde**: (a) `src/admin/` superadmin SPA (filo/
sistem sağlığı) ve (b) `website/src/app/dashboard` kullanıcı paneli. Karıştırma.

---

## 1) GENEL MİMARİ

**Katmanlar (aşağıdan yukarı):**
```
Native (Android/Java+Kotlin)  ── CarLauncherPlugin.java, can/*, obd/*, hal/*, NativeCryptoManager
        │  (Capacitor köprüsü)
Bridge  ── src/platform/bridge.ts  → demoBridge (web) | nativeBridge (android) → CarLauncher (nativePlugin.ts)
        │
Platform Servisleri (src/platform/*, ~150 dosya) ── obd/can/nav/ai/voice/security/offline...
        │
Core Runtime (src/core/*) ── AdaptiveRuntimeManager (DeviceTier bütçe), CorridorSyncEngine, CacheLRU, val/
        │
State (src/store/* Zustand, + bus'lar: errorBus/drawerBus/settingsFocusBus)
        │
UI (src/components/*, ~feature-bazlı) ── App.tsx → SystemBoot dalgalar halinde servis başlatır
```

**Boot akışı:** `App.tsx:86` → `systemBoot.start()` (`src/platform/system/SystemBoot.ts`) —
servisleri **dalgalar** halinde başlatır (kritik önce, ağır analiz idle'da).

**Runtime bütçe:** `AdaptiveRuntimeManager` DeviceTier'e göre her katmana bütçe verir
(CLAUDE.md "Performans-Uyarlanabilir Hibrit"). Güvenlik-kritik her tier'da açık; ağır
analiz (twin/prediction) hot-path'e girmez.

**Bridge deseni (ZORUNLU kural):** Capacitor API'leri asla component'te doğrudan
çağrılmaz → hep `bridge.ts` üzerinden. Değişiklikte bu sözleşmeyi koru.

---

## 2) KLASÖR YAPISI (özet harita)

```
src/
├─ core/            runtime(AdaptiveRuntimeManager), navigation(CorridorSync), storage(CacheLRU), val(OBDHandshake/SignalNormalizer/VehicleProfile)
├─ platform/        ~150 servis: obd*, canBus/, obd/, gps/, maps/, navigation/, companion/, security/, safety/, power/, vision/, media/, spotify/, roleSystem/, system/, native/, diagnostic/, expert/, superadmin/, test/
├─ components/      UI (feature-bazlı: obd, map, media, safety, trip, vehicle, settings, themes, camera, dashcam, phone, climate, sport, theater, vision, weather, admin, notifications)
├─ admin/          SUPERADMIN SPA (ayrı App.tsx/main.tsx → admin.html): pages/superadmin, components/superadmin, services, lib
├─ store/          Zustand: useStore, useSafetyStore, useVehicleIntelligenceStore, useLayoutStore, useSystemStore, useCognitiveStore...
├─ data/ types/ utils/
├─ App.tsx main.tsx serviceWorker.ts
android/app/src/main/java/com/cockpitos/pro/
├─ CarLauncherPlugin.java (ANA plugin), CarLauncherForegroundService.java, MainActivity, BootReceiver, CommandService/Broadcast
├─ can/   (22 dosya) CanBusManager, HiworldAdapter, K24CanBridge, NwdCanClient, SystemCanBroadcastAdapter, *SerialTransport, ElmRawCanMonitor, VehicleSignalMapper
├─ obd/   BleObdManager/Scanner, ElmProtocol, ElmCommandChannel/Queue, ElmInitSequencer
├─ hal/   VehicleHALManager/Plugin (Android Automotive VHAL denemesi)
├─ media/ MediaManager, NativeCryptoManager, core/VehicleNativeBridge.kt
website/src/
├─ app/(public)/   carospro.com marketing (page, features, enterprise, contact)
├─ app/(pwa)/      kumanda (Arabam Cebimde PWA), key-beam
├─ app/dashboard/  kullanıcı paneli (vehicles, map, diagnostic, notifications, settings)
├─ app/api/        iç uçlar (auth, pwa, vehicle, vehicles, tts)
├─ components/, lib/ (supabase*, realtimeEngine, geofenceEngine, commandCrypto...), store/, hooks/
supabase/migrations/  28 SQL (RLS/RPC/realtime/geofence/ota/key-beam...)
```

---

## 3–22) MODÜL MODÜL

> Format: **İşlev · Dosyalar · Hazırlık · Bağımlılık · Risk · Değişiklik-dikkat · Bağlantılı**

### 3. Araç Uygulaması (launcher OS) — **%68**
- **İşlev:** Head unit ana OS/launcher; tüm cockpit HMI + servis orkestrasyonu.
- **Dosyalar:** `src/App.tsx`, `main.tsx`, `platform/system/SystemBoot.ts`, `core/runtime/*`, `components/*`.
- **Bağımlılık:** Capacitor, native plugin, tüm platform servisleri.
- **Risk:** Boot sırası kırılganlığı; düşük-uç cihazda FPS (Mali-400 ~7fps, memory).
- **Dikkat:** SystemBoot dalga sırasını bozma; useEffect cleanup zorunlu (zero-leak).
- **Bağlantılı:** Hepsi.

### 4. Web Sitesi (carospro.com) — **%80** (yeni redesign)
- **İşlev:** Pazarlama + light/dark tema + PWA install.
- **Dosyalar:** `website/src/app/(public)/*`, bileşenler, `globals.css`, `tailwind.config.ts`.
- **Hazırlık:** Prod'da; Lighthouse 99/100/100/100. **⚠️ Metin↔ürün uyumsuzluğu** (bkz. backlog: "200+ DTC" vb.).
- **Risk:** Pazarlama ürünün önünde (hukuki/güven).
- **Dikkat:** Semantik token sistemi (`--st-*`); opacity-modifier var-renkte kırılır.
- **Bağlantılı:** PWA, dashboard.

### 5. PWA "Arabam Cebimde" (`/kumanda`) — **%63**
- **İşlev:** Telefondan araç uzaktan kumanda + eşleştirme + tanı + tema stüdyo.
- **Dosyalar:** `website/src/app/(pwa)/kumanda`, `key-beam`, `components/pwa/*`, `lib/pairingService`, `commandService`, `commandCrypto`.
- **Bağımlılık:** Supabase realtime, E2E crypto, araç-app command listener.
- **Risk:** Araç online değilse komut kuyruğu; SSO/pairing kenar durumları.
- **Dikkat:** `--pwa-*` tema katmanı ayrı; commandCrypto nonce/replay koru.
- **Bağlantılı:** Web panel, araç-app remoteCommand.

### 6. Web Panel (İKİ ADET) — **%50**
- **6a Kullanıcı paneli:** `website/src/app/dashboard/*` — Supabase-bağlı (vehicles/map/diagnostic/notifications). **settings placeholder (kaydetmez), reports YOK.**
- **6b Superadmin SPA:** `src/admin/*` — filo/sistem sağlığı (LiveEventStream, IncidentTimeline, FleetHealthRibbon, ChaosSimulator). Vite `admin.html`.
- **Risk:** İki panel karışıklığı; GeofenceAlertsPanel **mock fallback**.
- **Dikkat:** RLS/GRANT üçlüsü (CLAUDE.md kuralı); yeni tabloda anon-grant tuzağı.
- **Bağlantılı:** Supabase, realtime, RBAC.

### 7. OBD Sistemi — **%65** (gerçek, araç-bağımlı)
- **İşlev:** ELM327 üzerinden canlı telemetri (hız/RPM/ECT/DTC), adaptif polling, üretici PID/DID.
- **Dosyalar (TS):** `obdService.ts`, `obdBluetoothService.ts`, `obd/` (AdaptivePollingController, StandardPidRegistry, extendedPidService, manufacturerPidService, ObdHealthMonitor, didDiscoveryService, profiles/{renaultDacia,renaultZoePh2,universalUds}), `obdMockEngine.ts`, `obdSanitizer.ts`, `obdValidation.ts`, `obdPidConfig.ts`. **Native:** `android/.../obd/` (BleObdManager, ElmProtocol, ElmCommandQueue, ElmInitSequencer).
- **Hazırlık:** Cihazda okuyor (memory); MOCK env-gated (`VITE_ENABLE_OBD_MOCK`, prod kapalı). **0x2F fuel PID kaldırıldı.**
- **Risk:** Adaptör/araç fragmantasyonu; BT init döngüleri (geçmişte "Broken pipe").
- **Dikkat:** `ElmProtocol`'e log sokma (saf JVM); sanitizer/validation eşiklerini koru.
- **Bağlantılı:** CAN, DTC, AI (companion context), safety, trip.

### 8. CAN Sistemi — **%50** (gerçek, head-unit-özel)
- **İşlev:** Araç gövde sinyalleri (hız/reverse/kapı/far/el-freni/emniyet-kemeri) OEM CAN yolundan.
- **Dosyalar (TS):** `canBus/` (CanSignalValidator, boxProtocol/{BoxFrameParser,boxProtocols}, RawCanDecoder, VehicleConnectivityManager, VehicleHandshake, ProfileSignalGate, VehicleProfileService). **Native:** `android/.../can/` (CanBusManager, HiworldAdapter, HiworldProtocolParser, K24CanBridge, NwdCanClient, SystemCanBroadcastAdapter, {Bt,Usb,File}SerialTransport, ElmRawCanMonitor, VehicleSignalMapper, ReverseSignalGuard). **HAL:** `hal/VehicleHALManager.java`.
- **Risk:** Bit-düzeni bazı protokollerde "belirsiz" (boxProtocols.ts:66); head-unit'e özel (K24/Hiworld/NWD); "can_send_info" lever kapalı kalabilir (memory).
- **Dikkat:** Signal validator + ProfileSignalGate güvenlik-kritik; reverse overlay z-index 100000 kilidi.
- **Bağlantılı:** OBD, safety (reverse/hazard), vehicle3D.

### 9. Navigasyon — **%58**
- **İşlev:** MapLibre render, rota (OSRM), tünel/DR, trafik, POI, hız-limiti.
- **Dosyalar:** `navigationService.ts`, `routingService.ts`, `offlineRoutingService.ts`, `mapService.ts`, `mapSourceManager.ts`, `map/`, `gps/fusionCore.ts`, `speedFusion.ts`, `core/navigation/CorridorSyncEngine.ts`, `trafficService.ts`, `offlineSearchService.ts`, `geocodingService.ts`, `speedLimitService.ts`.
- **Hazırlık:** Render/tünel/DR gerçek; **offline routing verisi (`routing-graph.bin`) YOK** → online OSRM'e düşer. Trafik **BYOK** (HERE/TomTom).
- **Risk:** `public/maps` boş; kamera `isStyleLoaded` kapıları (geçmiş bug); DR doğruluğu sınırlı.
- **Dikkat:** Kamera setData sonrası stili kirletir → `setDrivingView` kilidi; regresyon kasası kilitleri.
- **Bağlantılı:** GPS, offline, traffic, safety.

### 10. AI Asistan — **%52** (BYOK)
- **İşlev:** Hibrit beyin (Gemini→Groq→Haiku), araç bağlamı (DTC/yakıt/menzil yorumu), app-kontrol intent'leri, grounding.
- **Dosyalar:** `companion/` (companionEngine, companionChatProvider, companionContext, companionIdentity), `aiVoiceService.ts`, `intentEngine.ts`, `commandParser.ts`, `aiHealth.ts`, `webSearchService.ts`, `offlineConversationEngine.ts`.
- **Hazırlık:** Gerçek ama **BYOK** (müşteri kendi anahtarı — CLAUDE.md merkezi anahtar YASAK). Bazı akışlar cihazda doğrulanmadı.
- **Risk:** Kesici 429/4xx yanlış "offline" sayabilir (geçmiş bug); Groq modeli 16/08/2026 kapanıyor.
- **Dikkat:** Sabit yönlendirme (Gemini birincil); Groq-birincil denemesi sahayı bozdu (geri alındı).
- **Bağlantılı:** Voice, OBD/DTC context, intent→commandExecutor.

### 11. Sesli Komut — **%60**
- **İşlev:** Offline STT (Vosk TR), wake-word, TTS hibrit, n-best repair.
- **Dosyalar:** `voiceService.ts`, `wakeWordService.ts`, `asrRepair.ts`, `speechSegment.ts`, `speechText.ts`, `ttsService.ts`, `edgeTtsService.ts`, `onlineTtsService.ts`, `voiceClips.ts`, `voiceDiagService.ts`. **Model:** `android/app/src/main/assets/vosk-model-tr/`.
- **Hazırlık:** Vosk cihazda 🟢 (boot preload). Wake-word default kapalı. Canlı tetik/barge-in bazı yerlerde doğrulanmadı.
- **Risk:** K24 neural TTS çöküyor → Piper klip bankası + eSpeak fallback.
- **Dikkat:** Native kuyruk (ilk basış takılması çözüldü); TTS lever durumu.
- **Bağlantılı:** AI asistan, intent, media.

### 12. Firebase / Supabase — **%60**
- **Firebase:** Yalnız **FCM push** (`fcmService.ts`, `pushService.ts`, `register_push_token` RPC). Başka Firebase servisi yok.
- **Supabase:** Ana backend. `supabaseClient.ts` (araç), `website/src/lib/supabase*.ts`, **28 migration** (RLS/RPC/realtime/geofence/ota/key-beam/sentry). RLS+GRANT disiplini CLAUDE.md'de zorunlu.
- **Risk:** Migration history boşlukları (025/026 yazılmamış — memory); anon-grant tuzağı; tek-vendor.
- **Dikkat:** Yeni tabloda GRANT+RLS+policy üçlüsü; realtime publication'a policy'siz tablo ekleme yasak.
- **Bağlantılı:** Web panel, PWA, realtime, RBAC, OTA.

### 13. Android Native Katman — **%60**
- **İşlev:** Capacitor plugin köprüsü, foreground service, CAN/OBD/HAL/media/crypto native.
- **Dosyalar:** `CarLauncherPlugin.java` (ana), `CarLauncherForegroundService.java`, `MainActivity`, `BootReceiver`, `CommandService`, `can/*`, `obd/*`, `hal/VehicleHALManager`, `media/MediaManager`, `NativeCryptoManager.java`, `core/VehicleNativeBridge.kt`.
- **Risk:** Head unit fragmantasyonu; native executor ölümü (McuEventSniffer restart loop — çözüldü); OEM rotasyon kilidi.
- **Dikkat:** `bridge.ts` sözleşmesi; foreground service ömrü; native restart mekanizmaları.
- **Bağlantılı:** OBD, CAN, media, security, command.

### 14. Güvenlik — **%72**
- **İşlev:** Uçtan-uca komut şifreleme, PIN, hassas anahtar saklama, zero-trust telemetri, gözetim modu.
- **Dosyalar:** `commandCrypto.ts` (HKDF→**AES-256-GCM**, **ECDH P-256 E2E**, PBKDF2 legacy), `keyBeamCrypto.ts`, `pinService.ts`, `sensitiveKeyStore.ts`, `security/` (blackBoxService, sentryEngine=gözetim, geofenceService). **Native:** `NativeCryptoManager.java`. Backend: RLS/policy.
- **Risk:** Native plaintext unlock (audit #0); debug adb/8899 bayrakları shippable'da; **sertifikasyon yok**.
- **Dikkat:** Nonce/replay koruması; RLS; anahtarı localStorage'a koyma.
- **Bağlantılı:** Command, PWA pairing, key-beam, Supabase.

### 15. Offline Destek — **%38**
- **İşlev:** İnternetsiz harita/arama/konuşma; tile indirme motoru.
- **Dosyalar:** `offlineMapService.ts`, `offlineTileServer.ts`, `offlineTileDownloader.ts`, `mapDownloadManager.ts`, `bootstrapOfflineTiles.ts`, `offlineDataService.ts`, `offlineConversationEngine.ts`, `offlineAutoCache.ts`, `offlineSearchService.ts`, `offlineRoutingService.ts`, `serviceWorkerManager.ts`.
- **Hazırlık:** İndirme motoru gerçek; **ön-paketli veri YOK** (`public/maps` boş); **offline routing verisi YOK**.
- **Risk:** İlk kurulumda internetsiz harita yok; graph üretim pipeline'ı ayrı tool.
- **Dikkat:** ODbL atıf zorunlu; SW cache stratejisi.
- **Bağlantılı:** Navigasyon, AI (offline conversation).

### 16. OTA — **%45**
- **İşlev:** Uzaktan APK güncelleme (ota_releases sorgu → indir → kur state machine).
- **Dosyalar:** `otaUpdateService.ts`, `remoteConfigService.ts`, migrations `..._ota_release_registry.sql`, `..._ota_storage_policies.sql`.
- **Hazırlık:** v1 gerçek. **Telemetri/ota_event YOK (Commit 7); managed-channel/Play Services yok** → sideload.
- **Risk:** Head unit'lerde Play Services yokluğu; güvenli dağıtım kanıtı yok.
- **Dikkat:** İmza doğrulama; RLS status='active' filtresi.
- **Bağlantılı:** Supabase storage, native install.

### 17. Testler — **%68**
- **İşlev:** Regresyon güvenliği + davranış kilitleri.
- **Dosyalar:** `src/__tests__/*` (**152 unit**), `e2e/*` (**11 Playwright**), `regression.guards.test.ts` (YASA kilitleri).
- **Hazırlık:** Güçlü. **e2e CI'da değil; APK build test yok; coverage bilinmiyor.**
- **Risk:** `?raw` import flake (çözüldü); test-yeşil ≠ cihazda çalışır.
- **Dikkat:** Regresyon kilitlerini ASLA zayıflatma; yeni bug→yeni kilit.
- **Bağlantılı:** CI, tüm modüller.

### 18. CI/CD — **%45**
- **İşlev:** lint → typecheck → test → build (fail-fast).
- **Dosyalar:** `.github/workflows/main.yml` (8.2KB).
- **Hazırlık:** Web/servis testleri koşuyor. **APK build YOK, e2e YOK, deploy otomasyonu YOK, Lighthouse YOK.**
- **Risk:** Sürüm otomasyonu yok → manuel `apk:safe` + `vercel --prod` (elle).
- **Dikkat:** `apk:safe` clean build; test geçmeden APK yok.
- **Bağlantılı:** Testler, Vercel, native build.

### 19. Mock / Demo / Placeholder Kodlar
- **Mock:** `obdMockEngine.ts` (env-gated, prod kapalı), `website/.../GeofenceAlertsPanel.tsx` (Supabase yoksa demo), `src/platform/test/*`.
- **Demo/görsel:** `website/.../MockDashboard.tsx` (pazarlama), `src/admin/ChaosSimulator.tsx` (superadmin sim), **TPMS `Vehicle3DViewer.tsx` (görsel-only, veri kaynağı yok)**.
- **Placeholder:** `website/.../dashboard/settings/page.tsx` (defaultValue, kaydetmez).

### 20. Production Riskleri — **Readiness %40**
- Debug bayraklar (adb-enable, port 8899) shippable'da → **satışa gitmemeli**.
- Migration history boşlukları (025/026).
- SAB prod'da pasif + entegrasyon yarım (audit #0).
- **3.taraf crash-reporting/APM yok** → sahada hataları göremezsin.
- OTA sideload; managed kanal yok.
- Cihaz-doğrulama açığı (ledger 🔴 bekleyenler).

### 21. Teknik Borçlar
- Fuel raw-CAN tamamlanmadı · CAN bit-düzeni belirsiz · i18n içerik ekstraksiyonu yapılmadı (i18next kurulu) · offline veri pipeline elle · 4 donanım-tespit birleştirmesi kısmi · placeholder/mock yerler · debug bayrak temizliği.

### 22. Eksik / Yarım Özellikler
`WEB_URUN_UYUM_BACKLOG.md`'de tam liste. Öne çıkan 🔴: PDF rapor, 90-gün geçmiş, REST API/SDK, sürücü skoru, yakıt maliyet, Android Auto/CarPlay, plugin/marketplace, bulut backup/sync, ADAS/DMS, fonksiyonel güvenlik.

---

## MODÜL BAĞIMLILIK HARİTASI

```
Native(CAN/OBD/HAL/Crypto) ─→ bridge.ts ─→ platform servisleri ─→ core/runtime ─→ store ─→ UI
   │                                            │
   └── CAN ──┬─→ safety(reverse/hazard) ────────┤
             ├─→ OBD ──┬─→ DTC ──┬─→ diagnostic/maintenance
             │         │         └─→ AI companion (context)
             │         └─→ trip ─→ (local) tripLog
             └─→ vehicle3D/profile
GPS ─→ fusionCore ─→ navigation ─┬─→ routing(OSRM/offline) ─→ traffic(BYOK)
                                 └─→ CorridorSync
Voice(Vosk) ─→ intent ─→ commandExecutor ─→ (native action)
AI companion ─→ intent (aynı hat)
PWA(kumanda) ─→ commandCrypto(E2E) ─→ Supabase realtime ─→ araç commandListener ─→ commandExecutor
Web dashboard ─→ Supabase(vehicleStore/realtime/RLS) ─→ (araç telemetri bridge)
FCM push ─→ push-to-wake ─→ araç-app
OTA ─→ Supabase storage ─→ native install
```

---

## RİSK LİSTESİ (öncelikli)

| # | Risk | Şiddet | Kanıt |
|---|---|---|---|
| R1 | Debug bayrak (adb/8899) satışa gidebilir | 🔴 Kritik | memory /enable-adb, port 8899 |
| R2 | Saha gözlemlenebilirliği yok (crash/APM) | 🔴 Kritik | 3.taraf reporter yok |
| R3 | Araç/head-unit fragmantasyonu (OBD/CAN) | 🔴 Yüksek | canBus profilleri, "belirsiz" bit |
| R4 | Cihaz-doğrulama açığı (test≠çalışır) | 🔴 Yüksek | DEVICE_VALIDATION_LEDGER 🔴'ler |
| R5 | Migration history boşluğu (025/026) | 🟡 Orta | memory |
| R6 | SAB pasif / entegrasyon yarım | 🟡 Orta | audit #0 |
| R7 | Pazarlama ürünün önünde | 🟡 Orta | WEB_URUN_UYUM_BACKLOG |
| R8 | Tek-vendor Supabase + RLS disiplini | 🟡 Orta | CLAUDE.md kuralları |
| R9 | OTA sideload (managed kanal yok) | 🟡 Orta | otaUpdateService |
| R10 | Düşük-uç performans (Mali-400 ~7fps) | 🟡 Orta | memory k24-perf |

---

## GELİŞTİRME ÖNCELİK LİSTESİ

1. **P0 — Production güvenliği:** debug bayrak temizliği (R1), migration history düzelt (R5), cihaz-doğrulama turu (R4).
2. **P1 — Gözlemlenebilirlik (R2):** self-host crash/APM + ürün analitiği + OTA telemetri.
3. **P2 — Dürüstlük:** `WEB_URUN_UYUM_BACKLOG` P0'ları (DTC sayısı, TPMS, enterprise metin).
4. **P3 — Fragmantasyon dayanıklılığı (R3):** CAN bit doğrulama, OBD profil genişletme, fail-soft kanıtı.
5. **P4 — Offline gerçek:** routing-graph pipeline + bölge paketleme.
6. **P5 — Enterprise gerçek:** rapor/PDF/skor/retention/API.

> **Değişiklik yaparken altın kurallar (CLAUDE.md/AI.md):** atomik/minimal patch · çoklu-
> sistem refactor yasak · regresyon kilitlerini bozma · zero-leak cleanup · bridge sözleşmesi ·
> RLS+GRANT üçlüsü · real-device doğrulama · "build yeşili başarı değildir".
```
```

---

## OLGUNLUK ÖZETİ (kod-temelli)

Araç App %68 · OBD %65 · CAN %50 · Navigasyon %58 · AI %52 · Voice %60 · Web %80 ·
PWA %63 · Panel %50 · Supabase %60 · Native %60 · Güvenlik %72 · Offline %38 · OTA %45 ·
Test %68 · CI/CD %45 · **Production Readiness %40** · **GENEL ~%55**.

**Tek cümle:** Güçlü, sofistike bir bireysel çekirdek + zengin native katman; **eksik olan
özellik değil, platform disiplini** (gözlemlenebilirlik, sertifikasyon, ekosistem, dağıtım).
