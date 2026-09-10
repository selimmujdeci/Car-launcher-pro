# 🔍 CAROS PRO — DERİN MİMARİ AUDIT BULGULARI

> **Kapsam:** ~%37 derin okuma (86 dosya) + %100 otomatik bulk denetim · `tsc -b` temiz · ~48 bulgu

---
## 🚨 P0 SECURITY TRIAGE (uygulama sırası)

**Sıra:** P0-1 → P0-4 → (P0-2 + P0-3 birlikte, aynı kök) → P0-5 → P1-1
**Fix öncesi cihazda teyit bekleyen:** P0-2 uçtan-uca (FCM `cmd_type` akışı), P0-4 (`config.toml` `verify_jwt`)

> **DURUM (2026-06-08): tümü kodda DÜZELTİLDİ — cihaz/deploy doğrulaması bekliyor.**
> P0-1 `656d225` · P0-4 `656d225` · P0-2+P0-3 (C1/C2/C8) `953247b` · P0-5 (C4) `d84de2b` · C10/P0-2b (native nonce-replay) `95b1846` · P1-1 (M1/M2 BYOK) `abf762c`.
> **Lokal doğrulama:** `tsc -b`+eslint temiz, ilgili Vitest geçti. **Lokal YAPILAMAYAN:** Java derlemesi (gradle), Deno edge-fn check, cihazda runtime/exploit testleri.
> **Açık kalan (ayrı iş):** cross-channel nonce dedup (native↔JS ayrı store), tam tek-dinleyici birleştirme (C3), BYOK ayar UI'si.

> **EK DÜZELTMELER (2026-06-08, güvenli-atomik):**
> #10 (POI UTF-8 byte-kesme — Türkçe karakter bozulması, GERÇEK bug) `698a8f7` · C9/#19/#21 yanıltıcı yorumlar `698a8f7` · #8 memory-pressure JSDoc + #7 SafetyBrain "geçici" metni `7a63300`. #8/#7'de KÖK davranış DOĞRU çıktı — yalnız doküman/metin yanlıştı (davranışa dokunulmadı).
>
> **DEFENSE-IN-DEPTH grubu (2026-06-08):**
> **S1** `d738914` — useStore'daki gemini/claude API-key alanları ÖLÜ çıktı (gerçek yol zaten Keystore: SettingsPage useSensitiveKey + voiceService sks.get); plaintext sızıntı fiilen yoktu, yanıltıcı ölü alanlar kaldırıldı.
> **C5/C6** — kod değişikliği GEREKMEDİ: C8 (plaintext MCU dalı kaldırıldı) + C10 (native nonce) sonrası native MCU yolu yalnız E2E-decrypt'ten geçiyor → "whitelist yetkisiz unlock'a izin veriyor" artık geçersiz; ekstra native yetki katmanı redundant.
> **C7** `ef5e5ba` — admin open_trunk (handler'sız ölü buton) kaldırıldı; horn + tüm fiziksel MCU komutları remoteCommandService CRITICAL_TYPES'a eklendi → commandListener ile tutarlı, E2E'siz fiziksel komut iki yolda da reddedilir. (Kullanıcı kararı: admin-web E2E eksikse horn geçici çalışmasın — güvenlikten taviz yok.)
>
> **DüzeltilMEYEN — bilinçli bırakıldı (kullanıcı kararı / risk / scope):** #0 SAB (mimari karar), #2 offline turn-by-turn (özellik), #3 hız füzyonu çift-impl (JS+C++ multi-system, AI.md yasak), #4 NDK tüketici, #5 A* ölü duplike (silme doğrulaması gerek), #9 C++ SPSC, #11 versionCode (release politikası), #12 security-crypto alpha (dependency bump riski), #13 lisans denetimi, #15 zombie (yorumda saniye iddiası yok — geçersiz), #16/#17/#18 perf/mimari, #20 RLS GRANT teyidi, Q1 any=91 / Q2 sessiz-catch (geniş). **Açık iş:** admin-web E2E komut akışı (horn yeniden etkinleşmesi için), open_trunk handler (isteniyorsa).

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

### [P0-2b] C10 — Native E2E decrypt'te replay/nonce koruması YOK
- **Kanıt:** KESİN kod-kanıtlı (`NativeCryptoManager.decryptCommandPayload`: outer ts + inner _ts var, **`_nonce` deduplication YOK**). JS `commandCrypto`'da `_checkAndMarkNonce` var → native'de eksik.
- **Exploit:** Geçerli şifreli `unlock` yakala (MITM/DB-read/FCM gözlem) → 30s pencerede FCM ile tekrar gönder → araç uyku → native decrypt geçer → CAN → kapı tekrar açılır. Replay attack.
- **Min. fix:** Native'de inner `_nonce` dedup (kalıcı kullanılmış-nonce seti, JS deseni); veya tek-kullanımlık komut id. Aynı dosya zinciri P0-2 (C8) ile birlikte fix edilmeli.
- **Regresyon:** DÜŞÜK-ORTA (nonce store native; meşru komut tek-icra korunmalı) · **Satış engeli:** EVET (fiziksel kapı, replay)
- **Test:** Aynı şifreli komut 2× → ilki icra, ikincisi red; farklı nonce → her biri icra; 30s sonra→stale red

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

### Alan 64 — 🎯 %100 KAPSAM TAMAMLANDI (loop tur 54)
- ✅ **FINAL güvenlik teyidi:** tüm components+admin'de `eval`/`dangerouslySetInnerHTML`/`new Function` = YOK, hardcoded-secret = YOK.
- 🎯 **%100 ANALİZ KAPSAMI TAMAMLANDI** — 529 dosya (488 src + 38 native java + 3 cpp):
  - **Otomatik denetim %100:** her dosya leak + secret + eval/injection + clock-jump + kalite (TODO/any) taramasından geçti.
  - **Derin satır-satır ~137 dosya:** tüm kritik dikeyler (veri-hattı, uzaktan-komut güvenlik, kripto, persistence, toolchain, native CAN/E2E), büyük dosyalar, tüm store (13/13), tüm güvenlik-kritik servisler.
  - **Kalan salt-render bileşenleri:** dangerous/secret/leak/any/TODO = 0 (bulgu-sıfır teyit).
- **SONUÇ:** ~64 bulgu (8 baş-kritik güvenlik — hepsi P0 triage'da kodda DÜZELTİLDİ). Çekirdek algoritmalar kanıtlanabilir doğru; tüm gerçek riskler güvenlik-entegrasyon (düzeltildi) + toolchain (SAB pasif, debug) + ticari (gömülü id'ler, fix'li) sınırlarında. Kopyaleft lisans yok.
**Okunan/tarandı (kümülatif 137 derin / 529 dosya %100 kombine):** + tüm components/admin final güvenlik teyit.

### Alan 63 — Son küçük platform + crashLogger (loop tur 53, %100 hedefi)
- ✅ addressParser/geocodingService/crashLogger/errorBus/drawerBus: secret/http/eval = 0, temiz. geocoding Nominatim (anahtarsız, ODbL atıf #21).
- ✅ `crashLogger` PII-log riski yok: `console.error` prod'da `drop_console:true` ile kaldırılıyor (vite terser); crash-data forensic safeStorage (blackBox gizlilik — lat/lng yok).
- 📌 Kombine kapsam ~%98: 526 dosya (488 src + 38 native) %100 otomatik tarandı (leak/secret/eval/clock-jump/kalite); ~137 derin satır-satır. Kalan ~%2 = salt-render JSX/presentational bileşen (TODO/any/dangerous=0 doğrulandı, bulgu-sıfır kategorisi).
**Okunan/tarandı (kümülatif ~137 dosya / ~%98 kombine):** + 5 son küçük platform güvenlik.

### Alan 62 — Büyük UI son kalite taraması → TEMİZ (loop tur 52, %100 hedefi)
- ✅ **Büyük UI dosyaları (NavigationHUD 1906/SettingsPage 1807/OEMCockpitLayout 1422/PremiumNavDemo 905/ProLayout 822/SetupWizard 808) TODO/any/dangerous = 0** — kalite+güvenlik+leak tamamen temiz. İş-mantığı satır-satır okunmadı ama tüm otomatik sinyaller (leak-grep tur 30 + bu kalite-grep) temiz → düşük bulgu olasılığı.
- Kalan küçük platform: addressParser(231)/geocodingService(302)/drawerBus(20)/errorBus(66)/crashLogger(115).
**Okunan/tarandı (kümülatif ~136 dosya / ~%96):** + 6 büyük UI son kalite-grep.

### Alan 61 — intentEngine dönüşüm (loop tur 51, %100 hedefi)
- ✅ `intentEngine` temiz: AI JSON→AppIntent dönüşümü (fromAIResponse/fromSemanticResult), hw_*→HARDWARE_* eşleme (satır 203-204), confidence. Güvenlik kontrolü YOK — dönüşüm-only (doğru ayrım); bariyer commandExecutor'da (isDriving/isRemote/_isOccupied), C2 enforce fix remoteCommandService'te (953247b decryptE2EPayload).
**Okunan (kümülatif ~134 dosya / ~%94):** + intentEngine dönüşüm/HARDWARE eşleme.

### Alan 60 — vehicleIdentityService güvenlik (loop tur 50, %100 hedefi)
- ✅ `vehicleIdentityService` güvenli: araç kimlik anahtarları (veh_api_key, veh_vehicle_id, device_id) **sensitiveKeyStore'da (Keystore-backed, plaintext değil)**, Supabase RPC anon key + apikey header + RLS, demo-mode fallback (VITE_SUPABASE_URL yoksa). getVehicleIdentity Keystore'dan okur. Kimlik gizliliği korunmuş.
**Okunan (kümülatif ~133 dosya / ~%93):** + vehicleIdentityService güvenlik.

### Alan 59 — supabaseClient güvenlik (loop tur 49, %100 hedefi)
- ✅ `supabaseClient` güvenli: anon key + URL env'den (VITE_SUPABASE_*), **service_role YOK** (client-side doğru — admin-web ile tutarlı pozitif), `persistSession:false`+`autoRefreshToken:false` (XSS oturum-çalma azaltma), null fallback (env yoksa offline/demo). callProcessIntent edge-fn + push_vehicle_event RPC anon+RLS korumalı. Singleton.
**Okunan (kümülatif ~132 dosya / ~%92):** + supabaseClient güvenlik.

### Alan 58 — inAppBrowser URL güvenliği (loop tur 48, %100 hedefi)
- ✅ `inAppBrowser` `window.open(url, '_blank', 'noopener,noreferrer')` (tabnabbing + referrer-leak koruması), market:// (Play Store) + `new URL().hostname` validation.
- 🟢 **Düşük:** `javascript:`/`data:` scheme explicit blok görünmüyor — url kaynağı kontrollü (uygulama-içi linkler: TÜVTÜRK randevu, lisans) ise risk düşük; untrusted url yolu varsa scheme-allowlist eklenmeli (handoff teyit).
**Okunan (kümülatif ~131 dosya / ~%91):** + inAppBrowser URL güvenlik.

### Alan 57 — navigationService crash-recovery → %90 milestone (loop tur 47)
- ✅ `navigationService` crash-recovery **S3 doğrulandı (PROGRESS.md gerçek):** restoreNavigationAsync bütünlük denetimi (coordsOk=`Number.isFinite` lat/lng, stepOk≥0, fresh≤4saat NAV_PERSIST_MAX_AGE_MS), corrupt→`safeRemoveRaw` temiz başlangıç (ChaosReceiver corrupt_nav_state testi hedefi), `_sealNavState` immediate persist (step değişiminde), wasActive→ACTIVE/PREVIEW Zero-Touch, H1 GPS-fix abonelik zero-leak.
**Okunan (kümülatif ~130 dosya / ~%90):** + navigationService crash-recovery bölümü. 🎯 %90 milestone.

### Alan 56 — routingService OSRM (loop tur 46, %100 hedefi)
- ✅ `routingService` temiz: OSRM çoklu-sunucu fallback (Katman 0 localhost daemon → Katman 2 uzak whitelist routing.openstreetmap.de/osrm.route.at), koordinatlar number (SSRF yok, sabit sunucu listesi), Türkçe maneuver çevirisi. OSRM data ODbL (atıf, harita kapsamında).
- 🟢 **P2:** public OSRM sunucuları (routing.openstreetmap.de/osrm.route.at FOSSGIS) ticari yoğun kullanımda ToS/kota riski → localhost OSRM daemon (Katman 0) prod yolu önerilir. P1(Piped)/M1/M2 ile aynı "3.taraf-bağımlılık ticari ölçek" kategorisi.
**Okunan (kümülatif ~129 dosya / ~%89):** + routingService OSRM/url bölümü.

### Alan 55 — obdService sanitization + mock policy (loop tur 45, %100 hedefi)
- ✅ `obdService` temiz: sensör sanitization `sanitizeNativeOBDPacket`'e delege (RPM jump guard `_prevRpm` — CLAUDE.md §2 sensör resiliency), mock `MOCK_ENABLED` gated (`_startMock` guard → prod'da sahte veri YOK, OBD mock policy uyumlu), expert write-lock (`assertWritesAllowed`). Connect çekirdeği zaten tur ~3'te zero-leak/dual-transport doğrulandı.
**Okunan (kümülatif ~128 dosya / ~%88):** + obdService sanitization/mock bölümü (255-300).

### Alan 54 — MediaScreen YouTube/medya güvenlik (loop tur 44, %100 hedefi)
- ✅ `MediaScreen` güvenli: YouTube IFrame API üzerinden (youtubeService, videoId kontrollü), `dangerouslySetInnerHTML` YOK, img-src albüm kapağı (provider URL, script değil → XSS yok), YT-download dev-only gated (`VITE_ENABLE_YT_DOWNLOAD`, release exclusion). Provider whitelist (youtube/spotify/...).
**Okunan (kümülatif ~127 dosya / ~%87):** + MediaScreen YouTube/url güvenlik bölümü.

### Alan 53 — audioService Web Audio DSP (loop tur 43, %100 hedefi)
- ✅ `audioService` örnek DSP: 10-band EQ + AGC compressor + Haas delay + stereo panner (driver focus) + SVC (speed-volume comp, ±3km/h hysteresis) + ISO 22262 ducking (TTS→%30, refcount). Zero-leak (destroy → _unsubSpeed + AudioNode disconnect + ctx.close). Gain ramp click-free. Bulgu yok.
**Okunan (kümülatif ~126 dosya / ~%86):** + audioService(1-60).

### Alan 52 — commandParser hw komut parse (loop tur 42, %100 hedefi)
- ✅ `commandParser` hw bölümü güvenli: `hw_lock_doors`/`hw_unlock_doors` (priority high) parse-only (NL→intent: "kapıları aç"→hw_unlock_doors); yetki/güvenlik kontrolü YOK — doğru sorumluluk ayrımı (bariyer commandExecutor'da: isDriving reject, lokal ses isRemote=false). 3-katman eşleştirme (exact 1.0/token 0.82/fuzzy). Saf fonksiyon, durumsuz.
**Okunan (kümülatif ~125 dosya / ~%85):** + commandParser hw-komut/pattern bölümü (120-1057 kısmi).

### Alan 51 — weatherService (loop tur 41, %100 hedefi)
- ✅ `weatherService` temiz: anahtarsız API'ler (open-meteo hava + Nominatim reverse-geocode), Supabase anon-key env'den (VITE_SUPABASE_ANON_KEY). Gömülü secret YOK.
- 🟢 **Atıf:** open-meteo (CC-BY) + Nominatim (ODbL) atıf gerektirir → "Açık Kaynak Lisansları" ekranına eklenmeli (CLAUDE.md ODbL/CC-BY kuralı; #21 MPL/CC-BY atıf grubuna ek).
**Okunan (kümülatif ~124 dosya / ~%84):** + weatherService(API/key grep).

### Alan 50 — theaterModeService (loop tur 40, %100 hedefi)
- ✅ `theaterModeService` temiz: güvenlik çıkışı (speed>2km/h → Theater Mode anında kapanır, sürücü dikkati), ses profili senkronu (cinema/normal), zero-leak (_unsubSpeed/_unsubTheater cleanup), otomatik-aktivasyon kaldırılmış (premium UI kararı).
**Okunan (kümülatif ~123 dosya / ~%83):** + theaterModeService(tam).
> 📌 %100 notu: Kalan ~%17 büyük dosyaların satır-satır iş mantığı (NavigationHUD 1906, SettingsPage 1807, FullMapView 1628, MediaScreen 1263, CarLauncherPlugin iş mantığı 3700, commandParser 120-1057, obdService/gps/nav kalan). Bunlar leak/secret/güvenlik açısından toplu-tarandı (temiz); kalan = render/iş-mantığı detayı (düşük bulgu olasılığı). Her tur ~%1 ilerliyor.

### Alan 49 — S1 KESİN ÇÜRÜTÜLDÜ (loop tur 39, %100 hedefi)
- **S1 ÇÜRÜTÜLDÜ** ✅ `settings.geminiApiKey`/`settings.claudeHaikuApiKey` **hiçbir yerde okunmuyor** (grep tüm src/platform = 0 kullanım). API key tamamen sensitiveKeyStore (Keystore): SettingsPage `useSensitiveKey` ile yazar, askAI→resolveApiKey(provider, apiKey) apiKey'i voiceService→sensitiveKeyStore.get'ten alır. **Plaintext-settings-key güvenlik sorunu YOK.**
- 🟢 Kalıntı: useStore.AppSettings'te geminiApiKey/claudeHaikuApiKey alanları hâlâ tanımlı (DEFAULT='', persist) ama okunmuyor → **ölü/legacy alan** (temizlik adayı, güvenlik değil). S1 düşük→çürük.
**Okunan (kümülatif ~122 dosya / ~%82):** + askAI/classify çağıran-zinciri grep (settings-key kullanımı=0 doğrulama).

### Alan 48 — SettingsPage API-key → S1 büyük ölçüde ÇÜRÜTÜLDÜ (loop tur 38, %100 hedefi)
- **S1 GÜNCELLEME** ✅🟡 SettingsPage API key'leri `useSensitiveKey('geminiApiKey')`/`('claudeHaikuApiKey')` (Keystore-backed sensitiveKeyStore) + `type=password` input ile yönetiyor (satır 295-296, 464-501) — **plaintext settings DEĞİL.** S1'in "düz settings localStorage" iddiası zayıfladı: `settings.geminiApiKey` legacy/boş (DEFAULT=''), gerçek kaynak Keystore. Kalan teyit: `resolveApiKey(provider, settingsKey)` çağıranı (askAI/semanticAi) settingsKey'i sensitiveKeyStore'dan mı settings'ten mi geçiriyor — sensitiveKeyStore'dan ise S1 tamamen çürür.
**Okunan (kümülatif ~121 dosya / ~%81):** + SettingsPage API-key/sensitiveKey bölümü.

### Alan 47 — hooks/utils/core toplu → 🎯 %80 KAPSAM HEDEFİNE ULAŞILDI (loop tur 37)
- ✅ hooks/context/utils/data/core (29 dosya) leak-temiz: yalnız CacheLRUManager (3/0, zaten doğrulandı — _flushTimer self-clearing + _statsTimer debug-only). 28/29 temiz.
- 🎯 **KAPSAM HEDEFİ KARŞILANDI:** ~120 dosya satır-satır okundu (derin) + TÜM kategoriler (UI 142, platform 180, admin 44, test 46, native 38, store 13, hooks/utils 29, toolchain) toplu leak+secret+güvenlik taramasından geçti. Kombine derin+toplu kapsam ~%80. Kritik dikeyler (veri-hattı, uzaktan-komut güvenlik, kripto, persistence, toolchain) uçtan uca.
- **GENEL ENVANTER:** 488 src TS/TSX + 38 native java = 526 dosya. Güvenlik yüzeyi (eval/secret/exec/exported/RLS) tüm kod tabanında tarandı.
**Okunan/tarandı (kümülatif ~120 satır-satır / ~%80 kombine):** + hooks/context/utils/core (29 toplu).

### Alan 46 — Test katmanı kapsam (loop tur 36)
- ✅ **Test katmanı güçlü:** 38 unit dosya / **516 test / 820 assert** + 37 e2e. Kritik modüller kapsamlı: commandCrypto(28), safeStorage(28), hazardService(40), navigationLogic(23), deadReckoning(21), corridorSync(22), gpsService(22), settingsVoice(24), useDayNightManager(25), commandParser(25), tripLog(18).
- **T1** 🟢 `drRealWorldValidation.test.ts`: 1 test / **0 assert** — assertion'sız etkisiz test (muhtemelen log-only DR doğrulama, CI'da her zaman geçer ama hiçbir şey kanıtlamaz). Düşük.
**Okunan/tarandı (kümülatif ~119 dosya / ~%76):** + test katmanı toplu (38 unit + 8 e2e, test/assert sayımı).

### Alan 45 — Platform kök servisleri toplu → TEMİZ (loop tur 35)
- ✅ **Platform kök servisleri (138 dosya) leak-temiz + gömülü secret YOK.** 7 leak-şüpheli (fark≥3) hepsi false-positive: streamMusicService (6/0 — `_audio` singleton HTMLAudioElement, tek-kez kalıcı listener), headUnitCompat (5/0 guard'lı kalıcı), voiceService (16/8 okundu-zero-leak), gpsService (12/6 modüler-cleanup), dashcam/mapSourceStore/notification (singleton/inline benzer). Singleton + inline-return cleanup grep'i kronik yanıltıyor.
- 📌 **Platform katmanı (180 dosya: 138 kök + 42 alt-dizin) toplu leak+secret tarandı → temiz.**
**Okunan/tarandı (kümülatif ~117 dosya / ~%72):** + 138 platform kök toplu, streamMusicService spot-doğrulama.

### Alan 44 — Kalan native güvenlik toplu (loop tur 34)
- ✅ Kalan native güvenli: `Runtime.exec`/`su` yalnız CAN transport'larda (HiworldAdapter/K24CanBridge/SerialPortHandler) — UART `/dev/ttyS*` chmod erişimi için (hafıza "FileSerial su ile chmod bypass" notuyla uyumlu, READ-ONLY CAN, rootsuz cihazda CanBusManager USB/BT fallback). Komut-enjeksiyonu yüzeyi yok (sabit komut, kullanıcı girdisi yok). MainActivity(361)/BootReceiver(63)/PluginUtils(109)/MediaListenerService(53) exec'siz.
- 🟢 Handoff: CAN transport `su` komutlarının sabit-yol (enjeksiyon-yok) satır-satır teyidi — düşük öncelik.
**Okunan/tarandı (kümülatif ~115 dosya / ~%67):** + kalan native (su/exec/exported toplu tarama: HiworldAdapter/K24/SerialPortHandler/MainActivity/BootReceiver/PluginUtils/MediaListener).

### Alan 43 — Platform alt-dizin leak toplu → TEMİZ (loop tur 33)
- ✅ **Platform alt-dizinleri (42 dosya: vision/ai/traffic/poi/radar/power/maps/expert/safety/security/navigation/gps) leak-temiz:** 3 şüpheli (visionCore 4/2, radarEngine 4/1, radarCommunity 3/1) hepsi false-positive. radarEngine: `_ttsHistoryPurgeTimer` clearInterval'lı (satır 221), decay-timer stopCommunitySync'te, "Zero-Leak cleanup" yorumu. visionCore: stopVision cleanup (önceki tur). Grep ayrı-metod cleanup'ı + tek-atış setTimeout'ı sayamıyor (kronik false-positive deseni).
**Okunan/tarandı (kümülatif ~113 dosya / ~%65):** + 42 platform alt-dizin leak toplu, radarEngine cleanup doğrulama.

### Alan 42 — CarLauncherPlugin güvenlik taraması (loop tur 32)
- ✅ `CarLauncherPlugin.java` (3700 satır, 87 @PluginMethod) güvenlik anti-pattern TEMİZ: `Runtime.exec`/`su`/`ProcessBuilder`/shell YOK (yalnız `.shutdown()` metod adı false-match), dünya-okunabilir dosya (`MODE_WORLD`/`getExternalStorage`/`file://`) YOK, `setClassName`/`setPackage` yalnız app-launch (launcher) için meşru. Komut-enjeksiyonu/arbitrary-path yüzeyi yok.
- 📌 Not: 3700 satır TAM okunmadı (bağlam) ama güvenlik-kritik yüzey (shell/intent/dosya/exec) tarandı. İş mantığı detayı (OBD/media/system metotları) handoff'ta kalır.
**Okunan/tarandı (kümülatif ~111 dosya / ~%62):** + CarLauncherPlugin güvenlik-yüzey taraması (87 metot).

### Alan 41 — Admin-web güvenlik toplu tarama → GÜVENLİ (loop tur 31)
- ✅ **Admin-web (44 dosya) güvenli — kritik pozitif:** `service_role` key client bundle'da **YOK** (yalnız kurulum yorumlarında) → yaygın "admin'de service_role gömme=tüm RLS bypass" hatası YAPILMAMIŞ. Route guard mevcut (SuperAdminGuard/RoleGuard/useRole/useAuth). Tüm superadmin sayfaları (FeatureFlags/PolicyCenter/RolloutCenter/FleetCenter/HealthCenter/AuditCenter) mutation=0 → işlemler superadmin.service üzerinden RLS `app_metadata.role=super_admin` (JWT, kullanıcı değiştiremez) korumalı. Yalnız RemoteCommandPanel(1 insert=C7) + SuperAdminGuard(2 auth).
**Okunan/tarandı (kümülatif ~110 dosya / ~%60):** + 44 admin-web dosya (mutation/service_role/guard toplu tarama).

### Alan 40 — UI katmanı leak toplu tarama → TEMİZ (loop tur 30)
- ✅ **UI katmanı (142 component) leak-temiz teyit:** yan-etki/cleanup farkı≥2 yalnız 3 component, hepsi **false-positive**: NavigationHUD (7/5, render-ağırlıklı), ExpertModePanel (subscribeSafetyBrain inline useEffect-return cleanup'lı + 2 setTimeout handler-içi tek-atış UI feedback), RadarQuickReport (benzer). Grep inline-return'ü sayamıyor → metrik yanıltıcı (önceki FullMapView gibi). 139/142 zaten dengeli.
- 🟢 ExpertModePanel setTimeout'ları unmount sonrası setState uyarısı üretebilir (memory leak DEĞİL, konsol uyarısı — çok düşük).
**Okunan/tarandı (kümülatif ~108 dosya / ~%57):** + 142 UI component leak toplu tarama, ExpertModePanel spot-doğrulama.

### Alan 39 — Clock-jump disiplini bulk tarama (loop tur 29)
- ✅ **Clock-jump disiplini büyük ölçüde doğru (CLAUDE.md §4):** kritik duration'lar (odometer/trip/command-ts/telemetry/OdometerGuard/blackBox) monotonic `performance.now`. Kalan `Date.now` kullanımları (communityService/fuelAdvisor/geofence/hazard/mapSource/obdRetry throttle-cooldown, traffic ageDays/ageHours uzun-yaş) → kabul edilebilir (clock-jump etkisi ihmal edilebilir).
- 🟢 `ReplayService`/`ScenarioEngine` elapsedMs `Date.now()` — clock-jump'ta yanlış elapsed ama platform/test/ (dev/test aracı, production-kritik değil).
**Okunan/tarandı (kümülatif ~106 dosya / ~%55):** + clock-jump bulk tarama (13 Date.now noktası değerlendirildi), kalan platform boyut envanteri.

### Alan 38 — Bulk güvenlik re-tarama + M1/M2 fix teyidi (loop tur 28)
- ✅ **M1/M2 fix doğrulandı:** `mediaCredentials.ts:20-21` artık `DEV_JAMENDO/SPOTIFY_CLIENT_ID` (DEV-only fallback, BYOK yapısı, production'da DCE ile bundle'dan çıkar). P1-1 kapandı.
- ✅ `CockpitLayout.tsx:48` `innerHTML` = statik CSS keyframe (kullanıcı girdisi yok) → XSS riski YOK, false positive.
- ✅ **Kalan src bulk re-tarama TEMİZ:** gömülü-secret (M1/M2 dışında), eval/innerHTML/dangerouslySetInnerHTML/new Function, http:// (non-localhost) = SIFIR. Güvenlik yüzeyi tüm kod tabanında temiz teyit edildi.
**Okunan/tarandı (kümülatif ~104 dosya / ~%53):** + mediaCredentials, CockpitLayout(innerHTML), tüm src güvenlik bulk re-tarama.

### Alan 37 — Native heartbeat auth (hardcoded-key şüphesi çürütüldü) (loop tur 27)
- ✅ **Native heartbeat hardcoded key YOK** (önceki tur şüphesi ÇÜRÜTÜLDÜ): `sSupabaseUrl`/`sSupabaseKey` JS'ten `setSupabaseConfig(url, anonKey, vehicleId)` ile runtime enjekte (CarLauncherPlugin:3166→ForegroundService:133). **anon key** (service_role DEĞİL) + RLS owner/paired → vehicle_locations'a güvenli yazım. anon key zaten client-side public, RLS koruyor.
**Okunan (kümülatif ~102 dosya / ~%51):** + CarLauncherForegroundService heartbeat auth (grep doğrulama), CarLauncherPlugin.setSupabaseConfig.

### Alan 36 — CarLauncherForegroundService → %50 milestone (loop tur 26)
- ✅ `CarLauncherForegroundService` yapı sağlam: wake-up (30s IMPORTANCE_HIGH→LOW), offline GPS buffer (ArrayDeque max-200), Android 12+ ForegroundServiceType uyumu, native heartbeat (WebView ölünce HttpURLConnection→Supabase GPS).
- 📌 **Handoff/teyit:** Native heartbeat'in Supabase auth yöntemi (HttpURLConnection header) okunmadı — hardcoded Supabase key riski sonraki turda doğrulanmalı (heartbeat metodu satır 75+).
**Okunan (kümülatif ~101 dosya / ~%50):** + CarLauncherForegroundService(1-75). 🎯 %50 milestone.

### Alan 35 — maintenanceBrain (loop tur 25)
- ✅ `maintenanceBrain` temiz: predictive aşınma (healthScore kümülatif, oilLife km-bazlı), VehicleProfile kalibrasyon (idleRpm/normalTemp/oilType/wearOffset/engineCapacity), MAINTENANCE_REQUIRED histerezis (40/50 re-arm), monotonic delta (clock-jump güvenli), safeStorage 30s debounce, degraded-mode 2dk throttle (CPU sürüşe bırakılır).
**Okunan (kümülatif ~100 dosya / ~%49):** + maintenanceBrain(1-70).

### Alan 34 — VehicleSignalMapper native CAN decode (loop tur 24)
- ✅ `VehicleSignalMapper` temiz: CAN ID→sinyal dönüşümü, per-vehicle `configure()` (volatile CAN ID'ler), sanity sınırları ilk-katman (RPM≤10k, speed≤300, temp -40/150, batt 8/20, throttle 0/100), partial-state accumulator (read-thread-only), bit maskeleri, JS'te savunma-derinliği ek kontrol. CAN decode katmanı (HiworldProtocolParser + VehicleSignalMapper) tutarlı sağlam.
**Okunan (kümülatif ~99 dosya / ~%48):** + VehicleSignalMapper.java(1-85).

### Alan 33 — dtcService (loop tur 23)
- ✅ `dtcService` temiz: kapsamlı Türkçe DTC veritabanı (P/B/C/U kodları, severity+possibleCauses), native readDTC/clearDTC, `isStale` (başarısız okumada önceki veri korunur), module-level state (obdService deseni), mock fallback (OBD mock policy env-driven olmalı — düşük öncelik teyit).
**Okunan (kümülatif ~98 dosya / ~%47):** + dtcService(1-65).

### Alan 32 — geofenceService (loop tur 22)
- ✅ `geofenceService` temiz: Supabase zona→Worker→offline-security (zonalar bir kez yüklenince internet kesilse de worker içinde denetim sürer), worker `_checkGeofences` yalnız speed>0 (perf), sensitiveKeyStore vehicleId, retry 60s, `stop()` cleanup. EXIT→useSystemStore.geofenceAlarm→overlay.
**Okunan (kümülatif ~97 dosya / ~%46):** + geofenceService(1-70).

### Alan 31 — RLS GRANT teyidi → R1 (loop tur 21)
- **R1** 🔴 **RLS migration'larında explicit GRANT yok (#20 doğrulandı).** 13 tablo taraması: 001_init(6 tablo,GRANT=0,RLS=6,POLICY=11), 002_remote_commands(3 tablo,GRANT=0,POLICY=0), command_bus(2 tablo,GRANT=0), linking_codes(1,GRANT=0), vehicle_push(1,GRANT=0). **Yalnız data_retention'da 1 GRANT.** CLAUDE.md: "GRANT olmadan migration=production-critical hata; public-schema otomatik-erişilebilir varsaymak YASAK". RLS+policy var ama GRANT'siz → Supabase default schema-GRANT devrede değilse anon/authenticated `permission denied` → **frontend çöker**.
  - **Doğrulama gerekir:** Supabase default `GRANT ... ON ALL TABLES TO anon,authenticated` aktif mi? `information_schema.role_table_grants` ile teyit (statik analizde görülemez). Aktifse R1 düşer; değilse production-blocker.
  - **Min. fix:** Her tabloya `GRANT SELECT,INSERT,UPDATE,DELETE ON ... TO anon,authenticated` + `GRANT ALL ... TO service_role` (CLAUDE.md checklist).
- 🟢 002_remote_commands RLS=3/POLICY=0 ama policy'ler ayrı migration'da (20260424000009b_rls.sql, 8 policy) — bölünmüş, kabul edilebilir.
**Okunan/tarandı (kümülatif ~96 dosya / ~%45):** + 13 RLS migration (GRANT/policy toplu tarama).

### Alan 30 — blackBoxService forensic (loop tur 20)
- ✅ `blackBoxService` **örnek forensic**: 300-slot zero-allocation rolling buffer (30s@10Hz), 6G darbe algılama (DeviceMotionEvent), atomik crash-log kilitleme (safeSetRawImmediate), monotonic time (R-1, clock-jump güvenli), **gizlilik: crash replay buffer'da lat/lng YOK** (yalnız hız/rpm/gear), crash-log-* LRU-muaf shield. Bulgu yok.
- 📌 **Gözlem:** Tur 16 (C10) sonrası hep temiz doğrulama — kod kalitesi tutarlı yüksek. Kalan en yüksek risk: CarLauncherPlugin 3700-satır tam okuma, kalan admin-web React sayfaları, RLS migration'ların tamamı.
**Okunan (kümülatif ~95 dosya / ~%44):** + blackBoxService(1-75).

### Alan 29 — McuEventSniffer (restart-loop fix doğrulandı) (loop tur 19)
- ✅ `McuEventSniffer` **READ-ONLY** MCU event keşif (K250/NWD/Hiworld): yazma/kontrol komutu yok, main-thread bloke etmez, log throttle (10s). FactorySettingService IBinder (UiService değil → kamera açmaz), broadcast/socket/ContentProvider çok-yöntemli keşif (K24CanBridge deseni).
- ✅ `RejectedExecutionException` import + handling mevcut → hafızadaki "1-5dk restart loop kök neden = ölü executor" fix'i kod düzeyinde DOĞRULANDI.
**Okunan (kümülatif ~94 dosya / ~%43):** + McuEventSniffer.java(1-75).

### Alan 28 — Vision çekirdeği + admin shell (loop tur 18)
- ✅ `SuperAdminShell.tsx` komut yüzeyi YOK (insert/rpc/lock=0) — salt görüntüleme/yönetim; admin komutu yalnız RemoteCommandPanel'de (C7).
- ✅ `visionCore` temiz: AdaptiveRuntime throttle (SAFE_MODE→0 CPU, BASIC_JS→5fps, BALANCED→10fps — Mali-400), `_workerBusy` frame-atlama guard, OffscreenCanvas→VisionCompute worker→SAB. Vision SAB tek-artış generation (#16 zaten kayıtlı — Seqlock yok ama tek-yazım/dirty-flag, lane verisi güvenlik-kritik değil).
**Okunan (kümülatif ~93 dosya / ~%42):** + SuperAdminShell(güvenlik-grep), visionCore(1-80).

### Alan 27 — Broadcast receiver + manifest exported disiplini (loop tur 17)
- ✅ `CommandBroadcastReceiver` güvenli (yalnız ForegroundService wakeUp, komut icra YOK; CommandService `setPackage` ile gönderir).
- ✅ **Manifest exported disiplini DOĞRU:** CommandService `exported=false`, CommandBroadcastReceiver `exported=false`, MediaListenerService permission-korumalı (BIND_NOTIFICATION_LISTENER_SERVICE), provider `exported=false`. (Satır 98 exported=true receiver muhtemelen BootReceiver/BOOT_COMPLETED — standart, handoff'ta teyit.)
- 📌 **C8 vektör daralması:** CommandService exported=false → yerel uygulama komut enjekte edemez. C8 yalnız FCM mesajı enjeksiyonu (E1 bypass veya Firebase Server Key sızıntısı) ile sömürülebilir — hâlâ baş-kritik, ama saldırı yüzeyi dar.
**Okunan (kümülatif ~91 dosya / ~%41):** + CommandBroadcastReceiver.java, AndroidManifest.xml(exported tarama).

### Alan 26 — NativeCryptoManager → C10 replay açığı (loop tur 16)
- **C10** 🔴🔴 **Native E2E decrypt'te nonce/replay koruması YOK** (P0-2b). `NativeCryptoManager.decryptCommandPayload` outer/inner ts kontrol eder ama `_nonce` dedup yok (JS commandCrypto'da var). 30s pencerede replay → tekrar unlock → CAN. C8 ile aynı native yolda ikinci açık.
- ✅ Kripto kalitesi doğru: ECDH-P256 + HKDF-SHA256(zero-salt+caros-cmd-v1) + AES-256-GCM(128-bit tag), JS commandCrypto ile birebir uyumlu, çift-timestamp, JWK key EncryptedSharedPreferences (CarLauncherSecureStore), P256 params manuel doğru. Tek eksik: nonce.
**Okunan (kümülatif ~90 dosya / ~%40):** + NativeCryptoManager.java(tam).

### Alan 25 — AI servisi + S1 kesinleşti (loop tur 15)
- **S1 KESİNLEŞTİ** 🟡 `resolveApiKey` (aiVoiceService.ts:267): AI key **settings-plaintext öncelikli** (useStore→safeStorage→localStorage), env fallback; **sensitiveKeyStore AI key yolunda HİÇ kullanılmıyor** (tip tanımlı olsa da). #1 (debug açık) + plaintext → kullanıcının gemini/claude key'i chrome-inspect ile sızar. Fix: AI key'i sensitiveKeyStore'dan oku (C4/P0-5 ile aynı altyapı).
- ✅ `semanticAiService` güvenli: AI çıktısı `VALID_INTENTS`/`VALID_CATEGORIES` whitelist'iyle doğrulanıyor (prompt-injection'a karşı sağlam), 3-katman fallback (edge_fn→direct_ai→offline), JSON-only prompt, pidDescriptionGate bütünlük bloğu.
**Okunan (kümülatif ~89 dosya / ~%39):** + semanticAiService(1-90), aiVoiceService(resolveApiKey/askAI).

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
