# 🔍 CAROS PRO — DERİN MİMARİ AUDIT BULGULARI

> **Kapsam:** ~%37 derin okuma (86 dosya) + %100 otomatik bulk denetim · `tsc -b` temiz · ~48 bulgu

---
## 🚨 P0 SECURITY TRIAGE (uygulama sırası)

**Sıra:** P0-1 → P0-4 → (P0-2 + P0-3 birlikte, aynı kök) → P0-5 → P1-1
**Fix öncesi cihazda teyit bekleyen:** P0-2 uçtan-uca (FCM `cmd_type` akışı), P0-4 (`config.toml` `verify_jwt`)

### [P0-1] `webContentsDebuggingEnabled` — satış APK'sında remote debug açık
- **Kanıt:** KESİN (`capacitor.config.ts:14` koşulsuz `true`)
- **Exploit:** Fiziksel/ADB → chrome://inspect → DOM/JS/localStorage (E2E key, oturum, API key)
- **Min. fix:** `webContentsDebuggingEnabled: isDev` · **Regresyon:** ÇOK DÜŞÜK
- **Test:** dev→inspect görünür; release→görünmez; smoke açılış · **Satış engeli:** EVET

### [P0-2] C8 — Native CommandService plaintext lock/unlock E2E'siz CAN'e
- **Kanıt:** Açık KESİN (`CommandService.java:106-117`); uçtan-uca ŞARTLI (push-notify `cmd_type` göndermiyor)
- **Exploit:** WebView uyku + FCM `{cmd_type:unlock, e2e_payload:""}` → E1 veya FCM key sızıntısı gerekir
- **Min. fix:** Native MCU yolunda E2E ZORUNLU; plaintext kritik komut → kuyruk+WebView uyandır, asla doğrudan CAN
- **Regresyon:** ORTA (uyku komut akışı; E2E yol korunmalı) · **Satış engeli:** EVET (fiziksel kapı)
- **Test:** plaintext unlock→CAN'e gitmez; geçerli E2E→CAN; bozuk E2E→red; WebView aktif→JS devreder

### [P0-3] C1/C2/C3 — Remote command E2E enforcement eksik + çift dinleyici
- **Kanıt:** KESİN (`commandListener.ts:85` plaintext-geçiş; `remoteCommandService.ts:290` format-only; çift başlatma)
- **Exploit:** Paired/owner DB-write + plaintext komut (C1) veya sahte `ecdh_v1` format + plaintext intent (C2)
- **Min. fix:** Tek dinleyici + kritik komutta `decryptE2EPayload` ZORUNLU (başarı=icra kapısı); plaintext kritik=red
- **Regresyon:** ORTA-YÜKSEK (komut dispatch mimarisi) · **Satış engeli:** EVET
- **Test:** plaintext unlock→red(iki servis); geçerli E2E→tek-icra; replay→red; route_send/theme çalışır

### [P0-4] E1 — push-notify auth bypass
- **Kanıt:** Fonksiyon-içi mantık KESİN (`push-notify/index.ts:29`); gateway `verify_jwt` config'i OKUNMADI
- **Exploit:** `verify_jwt` kapalı + vehicleId bilinir → yetkisiz push-to-wake (DoS/batarya) + C8/C2 yüzeyi
- **Min. fix:** `token !== SERVICE_ROLE_KEY → 401` (retention-manager deseni); `config.toml verify_jwt=true` teyit
- **Regresyon:** DÜŞÜK-ORTA · **Satış engeli:** Dolaylı (backend/filo)
- **Test:** Bearer fake→401; SERVICE_ROLE→200; meşru push akışı çalışır

### [P0-5] C4 — E2E private key localStorage'da düz JWK
- **Kanıt:** Zincir KESİN (commandCrypto+safeStorage double-lock+syncKeysToNative); fiili sızdırma denenmedi
- **Exploit:** P0-1 (debug) + fiziksel erişim → `localStorage['car-e2e-private-key']` → tüm E2E forge/decrypt
- **Min. fix:** P0-1 kapat (birincil); E2E key'i `sensitiveKeyStore`'a taşı (Keystore-backed, altyapı MEVCUT); localStorage double-lock'tan hariç tut
- **Regresyon:** ORTA (key persistence/migrasyon; mevcut eşleşmeler kopmamalı) · **Satış engeli:** EVET
- **Test:** localStorage E2E key içermez; native decrypt çalışır; eşleşmiş cihaz reconnect→decrypt OK

### [P1-1] M1/M2 — Gömülü Jamendo/Spotify client_id
- **Kanıt:** KESİN (`jamendoProvider.ts:16`='65c9241f'; `spotifyConfig.ts:21`='7ebfa30f...')
- **Exploit:** YOK (güvenlik değil) — ToS/quota/rate-limit; Spotify dev-mode 25-kullanıcı limiti
- **Min. fix:** BYOK — kullanıcı kendi client_id'sini ayardan girer; gömülü değer yalnız dev fallback
- **Regresyon:** ORTA (ayar UI + onboarding; boş id→graceful disable) · **Satış engeli:** EVET (işlevsel/ölçek)
- **Test:** boş id→sessiz disable; kullanıcı id→çalışır; dev fallback→dev build çalışır

---
## 🤝 HANDOFF (sonraki agent buradan devam etsin) — ~%37 derin kapsam

### ✅ OKUNAN DOSYALAR (tam=satır-satır, kısmi=belirtilen bölüm) — ~83 dosya
**Veri hattı çekirdeği (tam):** App.tsx · system/SystemBoot.ts · vehicleDataLayer/VehicleCompute.worker.ts · vehicleDataLayer/OdometerGuard.ts · core/val/SignalNormalizer.ts · sabChannel.ts · hooks/useSABDirectUpdate.ts · platform/obdBluetoothService.ts · platform/commandCrypto.ts
**Native (tam):** core/VehicleNativeBridge.kt · cpp/native-core.cpp · cpp/VehicleState.hpp · cpp/SignalBuffer.hpp · obd/BleObdManager.java · obd/ElmProtocol.java · obd/McuCommandFactory.java · can/HiworldProtocolParser.java · can/CanBusManager.java · CommandService.java · hal/VehicleHALManager.java · media/MediaManager.java(kısmi 1-70)
**Native (kısmi/grep):** CarLauncherPlugin.java(connectOBD/scan/nativeStream/getNativeHeartbeat blokları) · K24CanBridge.java(1-130) · 5 transport(write-grep: FileSerial/Usb/Bt/UsbSerialHandler/SerialPortHandler)
**Toolchain (tam):** vite.config.ts · android/build.gradle · cpp/CMakeLists.txt · proguard-rules.pro · capacitor.config.ts
**Runtime/sistem (tam):** core/runtime/AdaptiveRuntimeManager.ts · system/SystemHealthMonitor.ts · system/SystemOrchestrator.ts · system/CognitivePriorityEngine.ts · utils/safeStorage.ts · platform/safety/SafetyBrain.ts
**Komut zinciri (tam):** remoteCommandService.ts · commandListener.ts · commandExecutor.ts · nativeCommandBridge.ts · commandParser.ts(1-120 kısmi) · admin RemoteCommandPanel.tsx(kısmi)
**Navigasyon/harita (tam):** NavigationCompute.worker.ts · offlineRoutingService.ts · map/MapCore.ts · map/MapLayerManager.ts(cleanup kısmi) · mapService.ts · gpsService.ts(1-100 kısmi)
**Supabase (tam):** functions/push-notify · functions/retention-manager · migrations/20260424000009b_rls.sql · superadmin.service.ts(auth-grep)
**STORE %100 (13/13 tam):** useStore · useSystemStore · useHazardStore · useCognitiveStore · useSafetyStore · useExpertStore · usePersonalizationStore · useVehicleIntelligenceStore · useCommunityStore · useEditStore · useDragStore · useThemeStudio · useCarTheme
**Media (tam/grep):** spotifyService(kısmi) · spotifyConfig · pipedProvider(tam) · audius/jamendo/archive/radioBrowser(grep)
**UI (leak-grep doğrulama, tam-okuma DEĞİL):** FullMapView · NavigationHUD · MediaScreen · SettingsPage · OEMCockpitLayout · ProLayout · SetupWizard · PremiumNavDemoScreen · MediaHub · headUnitCompat(tam) · CacheLRUManager(tam)

### ❌ OKUNMAYAN ALANLAR (~%65 — sonraki agent öncelikleri)
1. **UI dev katmanı ~110 component TAM-OKUMA** (yalnız 9'u leak-grep'lendi, iç mantık/güvenlik okunmadı) — settings alt-bileşenleri, themes, modals, security, entertainment, camera, debug
2. **Admin-web React sayfaları:** SuperAdminShell.tsx(1207), RolloutCenter, HealthCenter, FeatureFlags, PolicyCenter — yalnız superadmin.service auth-grep yapıldı
3. **Kalan platform servisleri ~180 dosya TAM:** dashcam, telemetry, ai/*, traffic/*, security/*, radar/*, weather, dtc, maintenance, theater, tripLog, connectivity, pushService, vision/* (visionEngine 2280 satır!), poi/*
4. **commandParser.ts 120-1057, obdService 700+, gpsService 100-800, navigationService/routingService tam mantık** (yalnız leak-grep yapıldı)
5. **Native kalan:** CarLauncherPlugin tam (3700 satır), CommandBroadcastReceiver, CarLauncherForegroundService, NativeCryptoManager, MediaListenerService, transport iç mantığı, CanFrameDecoder, VehicleSignalMapper, McuEventSniffer, HiworldAdapter
6. **RLS migration'ların tamamı + GRANT teyidi** (#20 — yalnız 1 dosya okundu)
7. **Test içerikleri** (38 unit + 8 e2e — yalnız sayıldı)

### 🔬 BULGU KANIT DURUMU (dürüst sınıflandırma)
- **KESİN KOD-KANITLI** (dosya+satır okundu, deterministik): #1, #2, #3, #4, C1, C2, C3, C8(açık var), C9, M1, M2, Q1, store/UI-leak temizlikleri, MapCore S1.1
- **KANITLI ama RUNTIME/CİHAZ doğrulaması YOK** (kod-mantık sağlam, fiilen çalıştırılmadı): **#0** (crossOriginIsolated APK'da false — vite yorumu+kod-zinciri kanıtı var, cihazda ölçülmedi) · **C4** (key sızıntısı — 3 kanıt zinciri birleşti, fiili chrome-inspect denenmedi) · **C8 uçtan-uca exploit** (açık kanıtlı AMA push-notify şu an cmd_type göndermiyor=tesadüfi koruma → exploit ŞARTLI) · **E1** (fonksiyon-içi auth mantığı kanıtlı, gateway verify_jwt config'i okunmadı)
- **MANTIKSAL ÇIKARIM** (senaryo test edilmedi): #6 (HiworldParser scale — gerçek firmware yok), #14 (ETA), #11/#12 (versionCode/alpha-crypto — kod görüldü, etki çıkarım)
- **ÇÜRÜTÜLDÜ:** #8 FullMapView leak (doğrulamayla temiz çıktı)
- **DOĞRULANMAMIŞ ŞÜPHE** (yalnız grep metriği, okuma YOK): radarEngine/geofenceService timer dengesizliği, SetupWizard 3/2/1
- **OTOMATİK BULK** (pattern-tarama, %100): güvenlik yüzeyi (eval/innerHTML/secret=0), any=91, TODO=4

---


**Tarih:** 2026-06-07
**Kapsam:** Sensör veri hattı dikey ekseni — UI → SAB → worker → C++ NDK → CAN decode → persistence → toolchain → tedarik zinciri
**Yöntem:** Statik kaynak analizi, 7 derinlik turu. `tsc -b` temiz (exit 0).
**Kapsam uyarısı:** ~529 dosyadan ~25'i okundu (%5-8). Bir DİKEY eksen dibe kadar; UI/state/voice/media/admin-web/native-komut YATAY alanları HENÜZ kapsanmadı.

---

## 🔴🔴 TEKİL EN KRİTİK

### #0 — SAB/Seqlock mimarisi APK'da tamamen PASİF
- **Zincir:** `capacitor.config.ts:21` https şeması + Capacitor local server COOP/COEP göndermiyor → `crossOriginIsolated=false` → `AdaptiveRuntimeManager._detectCapabilities():183` BASIC_JS → `VehicleSignalResolver` SAB oluşturmaz → worker `INIT_FALLBACK` (`_sabEnabled=false`) → tüm veri postMessage → `useSABDirectUpdate` Zustand fallback.
- **İtiraf:** `vite.config.ts:95-104` — "APK zaten COEP göndermiyor, SAB → BASIC_JS fallback... SAB yolu yine COEP'li bir web dağıtımında aktif olur; dev artık onu test etmez."
- **Etki:** ~2000+ satır SAB/Seqlock/cache-line padding/zero-copy kodu **head unit'te çalışmıyor**. CLAUDE.md "MISSION-CRITICAL V8/SAB" bölümünün tamamı üründe devre dışı. "Head unit öncelik" projesinde en büyük mühendislik yatırımı pasif.
- **Karar gerekli:** ya SAB'ı APK'da aktive et (COEP+iframe çözümü), ya BASIC_JS'i tek yol kabul edip ölü kodu temizle + PROGRESS.md düzelt.

---

## 🔴🔴 UZAKTAN-KOMUT GÜVENLİK ZİNCİRİ (2. dikey — eklendi 2026-06-07)

E2E kriptosu (`commandCrypto.ts`) kusursuz (ECDH-P256+PFS+çift-replay) AMA **iki tüketim noktasında da yanlış bağlanmış.** İKİ servis aynı `vehicle_commands` INSERT'ini koordinasyonsuz dinliyor:
- `remoteCommandService.startRemoteCommands()` → `vehicleDataLayer/index.ts:169` → **HER ZAMAN aktif**
- `commandListener.startCommandListener()` → `fcmService`/`pushService` push-to-wake → araç uykudayken (uzaktan açmanın ana senaryosu)

| # | Bulgu | Dosya |
|---|-------|-------|
| **C1** | **commandListener E2E ENFORCE ETMİYOR** — `if(isE2EPayload)` → şifresiz payload decrypt atlanıp `cmd.type='unlock'` ile doğrudan `executeMcuCommand` → CAN → kapı açılır. Plaintext kritik komut icra edilir. | `commandListener.ts:85` |
| **C2** | **remoteCommandService DECRYPT ETMİYOR** — kritik komutta sadece `isE2EPayload` FORMAT kontrolü; `decryptE2EPayload` çağrılmıyor, intent plaintext `row['intent']`'ten. Format-spoof (`{type:'ecdh_v1',data:'AA'...}` + `intent:'HARDWARE_UNLOCK'`) ile bypass. | `remoteCommandService.ts:290` |
| **C3** | **Çift dinleyici → çift icra + çelişkili güvenlik** — her komutta biri red diğeri icra; meşru komut 2× CAN'e gidebilir (ayrı dedup Map'leri). | iki servis |

> RLS (`is_paired OR owner`+`ttl>now()`) bariyer ama E2E'nin amacı (private key sadece araçta → DB-ele-geçiren komut veremez) **iki yolda da kırık.** Bedeli: fiziksel araç güvenliği.
> **Doğru çözüm:** tek dinleyici + kritik komutlarda `decryptE2EPayload` ZORUNLU (başarı=icra kapısı), plaintext kritik komut kategorik red.

---

## 🔬 SİSTEMATİK ALAN TARAMASI (eklendi 2026-06-07)

### Alan 1 — Native komut icra ucu
- ✅ `McuCommandFactory.java` **güvenli**: 7-komut whitelist + XOR CRC + parametresiz factory ("ham byte kabul edilmez").
- **C4** 🔴 `syncKeysToNative` E2E private key JWK'yı localStorage'a da yazıyor (`car-e2e-private-key`, kritik→double-lock). #1 (webContentsDebugging açık) ile birleşince: chrome://inspect → localStorage → **araç private key düz JWK sızar → tüm E2E çöker** (saldırgan tüm komutları forge/decrypt eder). `nativeCommandBridge.ts:172`
- **C5** 🟡 Native `McuCommandFactory`'de E2E/yetki doğrulaması YOK — JS katmanına güveniyor. Whitelist yalnızca "keyfi frame"i engelliyor, "yetkisiz unlock"u değil (unlock zaten whitelist'te). C1/C2 bypass → `executeMcuCommand('unlock')` → CAN. Defense-in-depth eksik.
- **C6** 🟡 ÜÇ ayrı komut decrypt yolu: commandListener (JS gerçek-decrypt) · remoteCommandService (JS format-only) · CommandService.java+NativeCryptoManager (native, FCM/WebView-yok). Tutarsızlık riski katmerli.

### Alan 2 — Supabase Edge Functions
- **E1** 🔴 `push-notify` AUTH BYPASS: `if (!auth.includes(SERVICE_ROLE_KEY) && !auth.startsWith('Bearer '))` → **herhangi bir `Bearer X` token 401'i atlatır**. Yetkisiz push-to-wake → DoS/batarya tüketimi + C1/C2 ile saldırı vektörü. (verify_jwt config'e bağımlı; fonksiyon-içi auth kusurlu.) `push-notify/index.ts:29`
- **E2** 🟢 `retention-manager` auth DOĞRU (`token !== SERVICE_ROLE_KEY` tam eşleşme) — push-notify ile tutarsız pattern.

### Alan 3 — VAL orta halka (SignalNormalizer)
- ✅ `SignalNormalizer` temiz: hidden-class kararlılığı (`_blankNormalized` tek şablon), zero-allocation, merkezi birim dönüşümü, GPS deadzone.
- 🟡 `CONF_HAL/CAN/OBD/GPS` sabitleri burada da → #3 füzyon çift-impl'inin parçası (güven sabitleri JS-SignalNormalizer + C++-kSourceConfidence = iki kaynak, elle senkron).

---

### Alan 4 — Orkestrasyon (SystemHealthMonitor)
- ✅ **En olgun dosyalardan biri, hata yok.** Watchdog escalation ladder (Step1 sessiz restart→Step2 CRITICAL mode→Step3 panic snapshot), startup grace (45s), cold-start koruması (`_neverBeaten`), pasif store izleme, UI-freeze watchdog (8s rAF-gap), `requestIdleCallback` restart (UI bloke yok), zero-leak `stop()`.
- 🟢 GPS + VehicleDataLayer "fresh location <30s → beat suppress" bloğu duplike (satır 376-401).

### Alan 5 — State (useStore)
- ✅ Negative Delta Guard (maintenance km geri gidemez), persist v13 migrate + merge (runtime state sıfırlama).
- **S1** 🟡 **Tutarsız sır yönetimi:** `geminiApiKey`/`claudeHaikuApiKey` düz `settings`'te (→ `car-launcher-storage` → localStorage **plaintext**) AMA `veh_api_key` `sensitiveKeyStore`'da. #1 (debug açık) + C4 ile birlikte: API anahtarları chrome://inspect ile sızar. Hassas veri sınıflandırması tutarsız. `useStore.ts:188`

---

### Alan 6 — Harita lifecycle (MapCore)
- ✅ **WebGL GPU leak yönetimi doğrulandı (PROGRESS.md S1.1 GERÇEK).** `_freeContext`: removeImage→ters-sıra removeLayer→removeSource→`map.remove()`→`WEBGL_lose_context.loseContext()`→2 rAF. + destroyLock mutex, initGen cancellation, 0×0 dimension guard, webglcontextlost/restored (5s permanent→reinit), checkAndHealMapContext zombi guard. Nadir belge-kod uyumu.
- 🟢 `(performance as any).memory` / `as any` (CLAUDE.md "no any") — tarayıcı API pragmatiği.

### Alan 7 — Voice & Media
- ✅ `voiceService` zero-leak: `cancelAnimationFrame` + `_stream.getTracks().stop()` + `_audioCtx.close()` (Voice Hard Kill).
- ✅ `mediaService` zero-leak: `_interpTimer`/`_hubTimer` clearInterval, `visibilitychange` add/remove eşleşmiş.

### Alan 8 — UI dev katmanı (spot-check)
- 🟡 **FullMapView.tsx: 38 `useEffect`, yalnızca 14 cleanup-return.** Kaba metrik (her effect cleanup gerektirmez) ama 1628-satır GPS/rota/timer-yoğun bileşende **yüksek-riskli — ayrı derin tarama gerektirir** (CLAUDE.md §1 Zero-Leak). NavigationHUD 7/4, OEMCockpitLayout 3/1. Kesin bulgu değil, doğrulanmamış şüphe.

### Alan 9 — Servis grubu (spot-check)
- ✅ thermalWatchdog (4 set/5 clear defensive), BatteryProtection/memoryWatchdog event-driven (timer yok).
- 🟡 radarEngine (4 set/1 clear) + geofenceService (2/1) timer-cleanup dengesizliği — kaba metrik, doğrulanmamış şüphe (setTimeout tek-atışlar olabilir); ayrı inceleme gerek.

---

## 📌 TARAMA KAPSAMI (2026-06-07 sonu)
**Kapsanan 9 alan:** native-komut-icra · edge-functions · VAL · orkestrasyon · state · MapCore · voice/media · UI(spot) · servis-grubu(spot).
**HENÜZ kapsanmayan (ayrı oturum):** UI dev katmanı TAM (142 component, özellikle FullMapView 38-effect derin inceleme) · admin-web React (RemoteCommandPanel, SuperAdminShell 1207) · her servisin satır-satır okuması · commandParser(1057) · SystemOrchestrator/CognitivePriorityEngine tam · RLS migration'larının tamamı + GRANT teyidi · test içerikleri.

---

### Alan 24 — connectivityService (loop tur 14)
- ✅ `connectivityService` **örnek dayanıklılık**: at-least-once delivery (2xx'e dek silinmez), priority queue (critical>high>normal), exponential backoff (1s→30s), IndexedDB kalıcı kuyruk, monotonic enqueuedAt (clock-jump güvenli). Komut-status/telemetri güvenilir teslim altyapısı.
- 📌 **Gözlem:** Tur 12-14 hep "temiz doğrulama" — servis/altyapı katmanı sağlam, yeni kritik bulgu çıkmıyor. Kalan yüksek-bulgu-potansiyeli: admin-web React sayfaları, vision/ai servisleri, UI iç mantığı (henüz okunmadı).
**Okunan (kümülatif ~87 dosya / ~%38):** + connectivityService(1-80).

### Alan 23 — sensitiveKeyStore (C4/S1 fix yolu netleşti) (loop tur 13)
- ✅ `sensitiveKeyStore` **örnek güvenlik**: zero-static-secret (APP_SECRET kaldırılmış), native Android Keystore (hardware-backed AES-256-GCM), web fallback **sessionStorage'da rastgele key** (localStorage değil → oturum sonu silinir), reinstall recovery store (gemini/claude Auto Backup). JS'te şifreleme anahtarı YOK.
- 🟡 **S1-nüans:** `SensitiveKey` tipi `geminiApiKey`/`claudeHaikuApiKey` **destekliyor** (Keystore) AMA useStore.settings'te de aynı anahtarlar plaintext → **çift saklama**; SettingsPage hangi yola yazıyor doğrulanmalı (settings yolu aktifse S1 geçerli, sensitiveKeyStore'a taşınmalı).
- 💡 **C4 fix yolu NET:** E2E private key (`car-e2e-private-key`) şu an safeStorage/localStorage'da düz JWK; **sensitiveKeyStore altyapısı zaten mevcut** → key buraya taşınmalı (Keystore-backed, localStorage'dan çıkar). Triage P0-5 ile uyumlu.
- 🟢 `nav_history` SensitiveKey listesinde — konum geçmişi hassas sayılmış (gizlilik +).
**Okunan (kümülatif ~86 dosya / ~%37):** + sensitiveKeyStore.

### Alan 22 — Telemetri + push servisi (loop tur 12)
- ✅ `telemetryService` **örnek akü-bilinçli**: adaptive heartbeat (driving 5s / parked 10dk / deep-sleep 1saat @ <11.8V), delta-based push (hız Δ>10km/h, konum Δ>50m), monotonic ts (clock-jump güvenli), fire-and-forget, `stop()` zero-leak. Telemetri lat/lng Supabase'e gider ama RLS owner/paired korumalı (beklenen).
- ✅ `pushService` temiz: FCM `register_push_token` RPC, wake-on-push, 30s idle-timer → CommandListener uyutma, `.remove()` cleanup, `_isWaking` guard.
**Okunan (kümülatif ~85 dosya / ~%36):** + telemetryService(1-90), pushService(1-70).

### Alan 21 — Native transport + gömülü kimlik taraması (loop tur 11)
- **M2** 🟡 `spotifyConfig.ts:21` **hardcoded `SPOTIFY_CLIENT_ID='7ebfa30f...'`** — M1 ile aynı sınıf (CLAUDE.md merkezi-anahtar yasağı). Tüm cihazlar tek Spotify app paylaşır → quota/rate-limit/dev-mode kullanıcı limiti → ölçeklenmez. BYOK gerekir. (Memory "Spotify Client ID sırada" notu = bilinçli ama satış-engelleyici.)
- ✅ Platform geneli `eval`/`innerHTML`/`new Function` = SIFIR (teyit).
- ✅ Native transport (FileSerial/Usb/Bt/SerialPortHandler) write yüzeyi mevcut — C9'u teyit (CAN yazma gerçek, CanBusManager "read-only" yorumu yanlış). MCU komut yazma yolu bu katmandan geçer.
**Okunan/tarandı (kümülatif ~83 dosya / ~%35):** + 5 native transport (write yüzeyi), spotifyConfig, platform-geneli güvenlik bulk.

### Alan 20 — Media providers + kalan UI (loop tur 10)
- **M1** 🟡 `jamendoProvider.ts:16` **hardcoded gömülü `JAMENDO_CLIENT_ID='65c9241f'`** — CLAUDE.md "merkezi/gömülü API anahtarı konmaz" ihlali. client_id public olsa da tüm satılan cihazlar tek kimlik paylaşır → Jamendo rate-limit/ToS/ban riski; **BYOK olmalı**. (Bulk secret taraması 8-char olduğu için kaçırdı → "hardcoded secret=0" iddiası bu noktada düzeltilmeli.)
- ✅ audius/archive/radioBrowser providers: https, az `any` (Q1), key gömülü yok.
- ✅ Kalan UI leak-temiz: ProLayout (4/4), PremiumNavDemoScreen (0 effect, saf render), MediaHub (3/0/1), SetupWizard (3/2/1 — düşük, izlenebilir).
**Okunan (kümülatif ~78 dosya / ~%33):** + audius/jamendo/archive/radioBrowser providers, ProLayout/SetupWizard/PremiumNavDemoScreen/MediaHub(leak metrik).

### Alan 19 — Admin yetki + media provider (loop tur 9)
- ✅ `superadmin.service` yetkisi RLS `(auth.jwt()->'app_metadata'->>'role')='super_admin'` — JWT-claim tabanlı (kullanıcı değiştiremez, service_role set eder). Doğru güvenlik; client-side explicit guard az ama RLS birincil koruma.
- ✅ `pipedProvider` (YouTube/Piped proxy): parallel instance-race, sticky instance, per-instance timeout, fail-soft. `any` (Q1).
- **P1** 🟢 pipedProvider kullanıcı arama terimleri 3. taraf public Piped instance'larına (private.coffee vb.) gidiyor → ticari satışta **gizlilik/ToS bildirimi** gerekebilir; ayrıca hardcoded 3. taraf sunucu bağımlılığı (instance'lar ölürse YouTube çalışmaz, offline-first ilkesiyle gerilim).
**Okunan (kümülatif ~72 dosya / ~%32):** + superadmin.service(auth grep), pipedProvider.

### Alan 18 — Native MediaManager + platform servis leak (loop tur 8)
- ✅ `MediaManager.java` temiz: singleton, LRU artCache (LinkedHashMap removeEldestEntry max-12), single-thread artLoaderExecutor, volatile controller/callback.
- ✅ Platform servisleri leak-temiz: navigationService (4/4 timer, any=0), routingService (4/4, any=0), mediaService (10/6 — setTimeout tek-atış, önceki zero-leak doğrulaması), obdService (12/10, önceki connect-çekirdeği zero-leak).
**Okunan (kümülatif ~70 dosya / ~%31):** + MediaManager.java, navigationService/routingService/mediaService/obdService (leak metrik doğrulama).

### Alan 17 — VehicleHAL + son store → STORE KATMANI TAMAM (loop tur 7)
- ✅ `VehicleHALManager.java` **örnek STRICT READ-ONLY**: AAOS VHAL reflection (yalnız getFloatProperty/getIntProperty, setProperty YOK), fail-soft AAOS_AVAILABLE guard, volatile snapshot. Yorum-kod tutarlı (CanBusManager C9'un aksine).
- ✅ `useCarTheme` temiz (tema enum + helper'lar).
- ✅ **STORE KATMANI %100 (13/13):** useStore, useSystemStore, useHazardStore, useCognitiveStore, useSafetyStore, useExpertStore, usePersonalizationStore, useVehicleIntelligenceStore, useCommunityStore, useEditStore, useDragStore, useThemeStudio, useCarTheme — **hepsi temiz** (clamp'li, tek-yazar, persist disiplinli, S1 hariç bulgu yok).
**Okunan (kümülatif ~68 dosya / ~%30):** + VehicleHALManager.java, useCarTheme. Store katmanı kapandı.

### Alan 16 — Native CAN yazma + theme studio (loop tur 6)
- **C9** 🟡 `CanBusManager.java` başlık yorumu *"hiçbir şekilde veri YAZAMAZ"* diyor ama `sendCommand():96` `transport.write(packet)` yapıyor (C8'in CAN yazma ucu). Yorum YANLIŞ/stale; K24CanBridge'in gerçek READ-ONLY'liğiyle tutarsız — güvenlik okuyucusunu yanıltır. Ayrıca `sendCommand` ham byte[] kabul eder, whitelist yalnız McuCommandFactory'de (C5 ile aynı).
- ✅ Hibrit transport (FileSerial/USB/BT), 5s reconnect, daemon thread, transport-lost callback, `stop()` temiz.
- 🟢 `useThemeStudio` (9 preset, token theming, slot max-6, persist+rehydrate) temiz; yalnız Google Fonts CDN injection (offline head unit'te yüklenmez ama FONT_MAP fallback var).
**Okunan (kümülatif ~66 dosya / ~%28):** + CanBusManager.java, useThemeStudio.

### Alan 15 — Büyük UI leak + intelligence/community store (loop tur 4)
- ✅ **MediaScreen (7 useEffect/7 cleanup), SettingsPage (9 yan-etki/11 cleanup), OEMCockpitLayout (3/3) — hepsi leak-temiz** (cleanup ≥ yan-etki). UI katmanı genelinde cleanup disiplini tutarlı.
- ✅ `useVehicleIntelligenceStore` (SPE trust/termal metrik, clamp'li, reset disiplinli) temiz.
- ✅ `useCommunityStore` **privacy-by-design örnek**: lat/lng ASLA tutulmaz, yalnız geohash L6 (~1.2km). CRM gizlilik garantisi kod düzeyinde.
**Okunan (kümülatif ~63 dosya / ~%26):** + MediaScreen/SettingsPage/OEMCockpitLayout (leak metrik), useVehicleIntelligenceStore, useCommunityStore.

### Alan 14 — NavigationHUD + expert/personalization store (loop tur 3)
- ✅ `NavigationHUD.tsx` (1906 satır) yalnız 18 effect/lifecycle pattern → render-ağırlıklı, az yan etki, leak riski düşük (FullMapView'ın aksine).
- ✅ `useExpertStore` **örnek güvenlik**: HMAC-mühürlü kalıcılık (expertTrustSeal), TrustEngine write-lock (güven<70 → yazım kilitli), `assertWritesAllowed` VIN guard, persist debounce + HMR cleanup tam.
- 🟢 `usePersonalizationStore` deprecated shim → useEditStore'a re-export (ölü kod temizliği adayı).
**Okunan (kümülatif ~58 dosya / ~%24):** + NavigationHUD(yapı/leak), useExpertStore, usePersonalizationStore.

### Alan 13 — FullMapView leak doğrulaması + store batch (loop tur 2)
- ✅ **FullMapView leak şüphesi ÇÜRÜTÜLDÜ (#8 kapandı).** Tüm map event'leri `.off()` ile ters-temizleniyor (drag/zoom/pitch/rotate/mousedown/touch/contextmenu), timer'lar `clearTimeout` (drWarn/interact/ctrl/autoFollow/resize), rAF `cancelAnimationFrame` (raf/settle/resize), `window`/DOM listener `removeEventListener` (map:reinit-needed, transitionend). Cleanup'sız useEffect'ler yalnızca imperatif (ref set, applyMapDayNight) — **leak yok, cleanup disiplini örnek.** Kaba 38/14 metriği yanlış alarmdı.
- ✅ `useEditStore` (undo/redo max-20, persist disiplinli — stack persist edilmez), `useDragStore` (oturum-içi) — temiz.
**Okunan (kümülatif ~55 dosya / ~%22):** + FullMapView(yapı+cleanup tam doğrulama), useEditStore, useDragStore.

### Alan 12 — Media auth + store batch (loop tur 1)
- ✅ `spotifyService` OAuth Bearer (token spotifyAuth/PKCE), market=TR; yalnız `any` (Q1).
- ✅ `useCognitiveStore` (6-mod + suppress mapping), `useSafetyStore` (fren state machine) — temiz, tek-yazar.
- 🟡 FullMapView.tsx: 92 effect/listener/timer/raf occurrence (38 useEffect) — leak şüphesi DEVAM, tam okuma bekliyor.
**Okunan (kümülatif ~52 dosya / ~%20):** + SystemOrchestrator, CognitivePriorityEngine, gpsService(kısmi), useHazardStore, useSystemStore, RemoteCommandPanel, commandParser(kısmi), headUnitCompat, CacheLRUManager, spotifyService, useCognitiveStore, useSafetyStore.

### Alan 11 — Orkestrasyon tam + GPS + Hazard
- ✅ `SystemOrchestrator` olgun: thermal action matrix (L0-L3), reverse suppress, alert auto-dismiss timer cleanup tam, trip summary. Zero-leak.
- 🟢 `startCognitiveEngine` **çift-sahiplik**: SystemBoot Wave3 + SystemOrchestrator ikisi de çağırıyor (`_running` guard → zararsız ama sahiplik belirsiz).
- ✅ `CognitivePriorityEngine` olgun: 6-mod karar matrisi, histerezis (eskalasyon anlık/recovery 15s), servis shedding, zero-leak.
- ✅ `gpsService` modüler (headingCore/speedCore/fusionCore alt-modül), termal-adaptif throttle (L2+→500ms), nav 2Hz taban, `declare global` (any yerine tip). `useHazardStore` clamp'li, temiz.

### Alan 10 — Admin-web güvenlik + store (kısmi)
- **C7** 🟡 `RemoteCommandPanel` (admin) `horn`/`open_trunk`'ı **E2E olmadan** insert ediyor → C1 gereği araç decrypt atlayıp CAN'e gönderir (`open_trunk` fiziksel bagaj). Ayrıca `open_trunk` araç tarafında handler'sız (CommandType'da yok → sessiz timeout). `RemoteCommandPanel.tsx:70`
- ✅ Admin lock/unlock göndermiyor (doğru); cleanup doğru (timer+channel unmount). useSystemStore temiz (tek-yazar Orchestrator deseni).

---

## 🔬 BULK STATİK TARAMA — TÜM KOD TABANI (%100 otomatik denetim)
Tüm `src` (~529 dosya) pattern bazında tarandı:
- ✅ **Güvenlik yüzeyi TEMİZ:** `eval` / `innerHTML` / `dangerouslySetInnerHTML` / `document.write` / `new Function` / `http://` (localhost hariç) = **SIFIR**. XSS/injection yüzeyi yok.
- ✅ **Hardcoded secret = SIFIR** (yalnız test dosyasında `test-api-key`).
- ✅ **TODO/FIXME/HACK = yalnız 4** (çok temiz).
- **Q1** 🟡 `any` / `as any` / `@ts-ignore` = **91 occurrence / 24 dosya** (CLAUDE.md "no-any" ihlali). En yoğun: MapLayerManager(20), youtubeService(7), voiceService(6), FullMapView(6), superAdminService(6).
- **Q2** 🟢 46 boş/sessiz `catch` (çoğu kasıtlı `/* ignore */`; bir kısmı hata gizleyebilir).
- **META** Grep leak-metriği bu kod tabanında **güvenilmez** (singleton+guard ağırlıklı). Doğrulanan örnekler: `headUnitCompat` (4/0 listener → guard'lı kalıcı module-level, cleanup gerekmez ✅), `CacheLRUManager` (flush timer self-clearing ✅, ama `_statsTimer` debug-only destroy'suz 🟢). Gerçek leak teyidi okuma ister.

---

## 🔴🔴 C8 — Native CommandService plaintext lock/unlock (loop tur 5)
`CommandService.java:106-117` (FCM, WebView-uyku yolu): `e2e_payload` boş + `cmd_type ∈ {lock,unlock,horn,...}` → `executeMcuCommandNative()` → `CanBusManager.sendCommand` → **CAN, E2E doğrulaması OLMADAN**. C1(JS)/C2(format-only)'nin **native + WebView-uyku** versiyonu — en tehlikelisi çünkü uzaktan-açmanın gerçek senaryosu (araç uykuda) tam bu yol.
- **Exploit zinciri:** E1 (push-notify `Bearer X` auth bypass) → FCM `{event:new_command, cmd_type:unlock, e2e_payload:""}` → CommandService → WebView uyku → plaintext MCU → **kapı açılır**. Kripto/auth/JS-bariyer hiçbiri devrede değil.
- **Kısmi tesadüfi koruma:** mevcut `push-notify` edge fn `cmd_type` alanını göndermiyor (yalnız event/vehicle_id/payload) → standart akışta tetiklenmez. Ama **tasarım açığı gerçek** (yorum "Evet + plaintext: doğrudan çalıştır" — kasıtlı) ve push-notify/FCM kaynağı değişirse aktifleşir.
- **Çözüm:** native tarafta da kritik komutlarda E2E ZORUNLU; plaintext lock/unlock kategorik red. (C1+C2+C8 = aynı sistemik E2E-enforcement eksikliği, 3 katmanda.)
**Okunan (kümülatif ~64 dosya / ~%27):** + CommandService.java.

## 🔴 YÜKSEK

| # | Bulgu | Dosya |
|---|-------|-------|
| 1 | `webContentsDebuggingEnabled: true` **koşulsuz** → satış APK'sında chrome://inspect açık (E2E key JWK, Supabase oturumu sızıntısı) | `capacitor.config.ts:14` |
| 2 | Offline-worker turn-by-turn üretmiyor (`steps: []`) → internetsiz+daemonsuz senaryoda dönüş talimatı YOK | `NavigationCompute.worker.ts:237` |
| 3 | Hız füzyonu JS worker + C++ `fuseSpeed` **çift implementasyon**, sabitler elle senkron (divergence riski) | `VehicleCompute.worker.ts:780` / `native-core.cpp:89` |
| 4 | Native NDK veri hattı (producer+consumer hazır) ama JS `nativeVehicleData` tüketicisi YOK → uykuda | `CarLauncherPlugin.java:3661` ↔ src (tüketici yok) |

> **SENTEZ:** #0 + #4 = SAB her iki katmanda da ölü. #2+#3+#4+#5 hepsi aynı desen: *"yeni yola taşındı, eskisi/yarısı kaldı."*

---

## 🟡 ORTA

| # | Bulgu | Dosya |
|---|-------|-------|
| 5 | A* + graph yükleyici ana-thread'de **ölü duplike** (worker kullanılıyor) | `offlineRoutingService.ts:278` |
| 6 | HiworldParser CMD_SPEED scale heuristiği → scaled firmware'de 30 km/h altı kayboluyor | `HiworldProtocolParser.java:160` |
| 7 | SafetyBrain UI "geçici kapatıldı" der ama feature disable **kalıcı** (zaman-recovery yok) | `SafetyBrain.ts:152` |
| 8 | `handleMemoryPressure` MODERATE==CRITICAL davranıyor, JSDoc farklı | `AdaptiveRuntimeManager.ts:552` |
| 9 | C++ SPSC `pop()` çağrılmıyor → ham sinyal kuyruğu drain edilmiyor (ölü kod) | `SignalBuffer.hpp` |
| 10 | POI `_writeStr` UTF-8'i byte sınırında kesiyor → Türkçe karakter (ç/ğ/ş) bozulur | `NavigationCompute.worker.ts:323` |
| 11 | `versionCode 1` sabit → sürüm yönetimi yok, A1 telemetri sürüm dağılımı anlamsız | `build.gradle:19` |
| 12 | `security-crypto:1.1.0-alpha06` → production'da alpha (deprecate) kripto kütüphanesi | `build.gradle:96` |
| 13 | Lisans: `Custom: jsonlint` (JSON.org "evil" maddesi) + `UNLICENSED ×1` → denetlenmeli | `license-checker` |

---

## 🟢 DÜŞÜK

| # | Bulgu |
|---|-------|
| 14 | Sabit-hız ETA (worker 30, straight-line 40 km/h; yol tipi yok) |
| 15 | Zombie tespiti ~40s (yorum 30s; off-by-one) `AdaptiveRuntimeManager.ts:590` |
| 16 | Vision SAB'da Seqlock yok (yalnız dirty-flag) `sabChannel.ts:105` |
| 17 | Gauge başına ayrı 60fps RAF döngüsü (tek orchestrator daha iyi) `useSABDirectUpdate.ts` |
| 18 | Native `localStorage` backup'ları LRU'dan muaf (şişebilir) `safeStorage.ts:153` |
| 19 | BleObdManager "wire edilmedi" yorumu stale (aslında wire'lı) `BleObdManager.java:37` |
| 20 | RLS GRANT ayrı dosyada — `role_table_grants` ile teyit gerek |
| 21 | `safeStorage` "4s debounce" yorumu (gerçek 5s); belge tarihleri 3 hafta eski; MPL-2.0×2+CC-BY atıf eklenmeli |

---

## ✅ DOĞRULANAN SAĞLAM ÇEKİRDEK (hata YOK)

3-katmanlı Seqlock (JS writer+reader + C++) · lock-free SPSC ring buffer · TMR odometer + self-heal (bit-flip) · OdometerGuard clock-jump (monotonic) · A* admissible haversine heuristik · ECDH-P256+PFS+çift-replay+nonce-persist kripto · atomic-write (tmp→rename→verify-read) + self-healing persistence · RLS owner/paired + TTL defense-in-depth · R8 JNI keep (release crash önlenmiş) · fast-math'siz FP determinizmi · ARM-only abiFilters · Kopyaleft lisans YOK (ticari satışa uygun).

---

## 🔭 KAPSANMAYAN ALANLAR (sonraki turlar)

UI katmanı (142 component; NavigationHUD/SettingsPage/FullMapView/OEMCockpitLayout/MediaScreen hiçbiri) · 13 Zustand store · VehicleSignalResolver+SignalNormalizer+UnifiedVehicleStore (VAL orta halka) · SystemOrchestrator · SystemHealthMonitor · CognitivePriorityEngine · MapCore `_freeContext` (WebGL leak kalbi) · voice/Vosk/semanticAI/commandParser(1057) · media servisleri · Admin web (Next.js 97 dosya + Supabase edge functions) · Native: CommandService/VehicleHAL/NativeCryptoManager/MediaManager/CanFrameDecoder/VehicleSignalMapper · geofence/radar/thermal/memory/battery servisleri · test içerikleri (38+8) · AndroidManifest · service worker.

**Yüksek-olasılıklı bulgu alanları:** UI dev dosyaları, native CommandService güvenliği (uzaktan komut→araç eylemi), admin-web Supabase tarafı.

---

## ⚖️ ÜST-ÖRÜNTÜLER (auditin özü)

1. **Çekirdek doğru, entegrasyon yarım** — en pahalı altyapı (SAB) üründe pasif; "taşındı ama eskisi kaldı" 4+ yerde.
2. **PROGRESS.md niyeti yansıtıyor, gerçeği değil** — "9.8/10 production-ready" iddiası #0 ve #1 ile çürüyor.
3. **Belge↔kod sapması yaygın** — #6,8,15,19,21 yorumlar gerçeği yansıtmıyor.
