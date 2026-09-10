# RELEASE CHECKLIST — CarOS Pro (CockpitOS)

> APK / release öncesi zorunlu kontrol listesi. Her madde işaretlenmeden release
> alınmaz. Saha testi gereken maddeler için `docs/TEST_MATRIX.md`'ye bakın.
> Bu liste `PROJECT_STATE.md` + `HANDOFF.md` ile tutarlıdır.
> Komut/flag adları İngilizce kalır; açıklamalar Türkçe.

---

## 1. Web Build & Statik Kontroller

- [ ] **Web build geçiyor** — `npm run build`
  (tsc -b + vite build; `package.json` scripts:8). Hatasız tamamlanmalı.
- [ ] **Lint temiz** — `npm run lint`
  (eslint .; `package.json` scripts:9). `any`/kullanılmayan değişken hatası bırakma.
- [ ] **Unit + integration testler geçiyor** — `npm test`
  (vitest run; `package.json` scripts:14). Son bilinen durum: 482/482 OK
  (`PROJECT_STATE.md` Build & Test). Yeni regresyon olmamalı.
- [ ] **E2E testler geçiyor** — `npm run test:e2e`
  (Playwright; CLAUDE.md E2E bölümü). Kritik flow'lar (boot, OBD mock,
  reverse overlay z-index 100000, theme) kırılmamalı.

## 2. Native (Android) Compile

- [ ] **Java compile geçiyor** — `gradlew compileDebugJavaWithJavac`
  (android/ dizininde). Native değişiklik (OBD/CAN/Vosk) sonrası zorunlu;
  `PROJECT_STATE.md`'de bu oturumda OK raporlandı.
- [ ] **Debug APK derleniyor** — `gradlew assembleDebug`
  (android/ dizininde). APK paketlenmesi ek doğrulama; cap sync sonrası çalıştır.
- [ ] **cap sync yapıldı** — `npm run cap:sync` (build + npx cap sync).
  Web asset'leri native'e kopyalandı mı.

## 3. Sürüm & Konfigürasyon

- [ ] **versionCode / versionName artırıldı** — tek kaynak `version.properties`
  (repo kökü); `npm run release:bump [x.y.z]` ile artır (`scripts/bump-version.mjs`
  VERSION_CODE +1 + package.json senkronu). `build.gradle` bu dosyadan okur —
  gradle'a elle dokunma. Not: SDK seviyeleri `android/variables.gradle`'da
  (minSdk 24, target/compile 36).
- [ ] **CHANGELOG.md güncellendi** — `[Unreleased]` maddeleri yeni sürüm
  başlığına taşındı (boş release notu ile yayın YOK).
- [ ] **Git tag atıldı** — release commit'ine `git tag v<VERSION_NAME>` +
  `git push origin v<VERSION_NAME>`. Tag'siz APK/AAB dağıtılmaz (hangi APK
  hangi koddan üretildi izlenebilmeli).
- [ ] **Release paketi script ile üretildi** — `npm run release:apk` veya
  `npm run release:aab` (build + cap sync + gradle release; `package.json`
  scripts). Elle Android Studio export'u yerine bu yol kullanılır.
- [ ] **`.env` üretim değerleriyle ayarlı** — `.env.example`'a göre.
  Üretimde `VITE_ENABLE_OBD_MOCK` ayarlanmamış/`false` olmalı (mock kapalı —
  `obdService.ts:747`). **DİKKAT:** `.env.example:25` `VITE_DISABLE_OBD_MOCK`
  diyor ama kod `VITE_ENABLE_OBD_MOCK` okuyor — release'te doğru adı kullan
  (bkz. `docs/FEATURE_FLAGS.md`).
- [ ] **API anahtarları release'e gömülmemiş** — CLAUDE.md BYOK kuralı:
  merkezi/gömülü API anahtarı konmaz. `.env` içindeki Gemini/Claude/Supabase
  anahtarları müşteri tarafında olmalı.

## 4. Debug / Flag Kontrolü (release'te kapalı olmalı)

- [ ] **Debug paneli kapalı** — `VITE_ENABLE_DEBUG_PANEL` set edilmemiş
  (`platform/debug/index.ts:2`). DEV olmayan build'de zaten kapalı.
- [ ] **DEV-only kod tree-shake oldu** — `import.meta.env.DEV` guard'lı bloklar
  (TestControlPanel, devInspector, GPS/OBD test override) release'te no-op.
  Production build'de `import.meta.env.DEV = false` (CLAUDE.md / kod yorumları).
- [ ] **Device test logger kapalı** — `ENABLE_DEVICE_TEST` env /
  localStorage toggle aktif değil (`__tests__/patentTestLogger.ts`).
- [ ] **YouTube indirme KAPALI (ZORUNLU — yasal)** — `VITE_ENABLE_YT_DOWNLOAD`
  release build'de **ASLA** set edilmez (YouTube ToS / telif; CLAUDE.md ticari
  lisans kuralı). Doğrula: bayrak vermeden `npm run build` sonrası `dist`'te
  indirme kodu OLMAMALI:
  `grep -rl "caros-yt\|yt-downloads\|ytDownloadService" dist/assets/*.js` → **boş**.
  (`media/ytDownloadService.ts`, `MediaScreen.tsx` `YT_DL`; bkz. docs/FEATURE_FLAGS.md.)
- [ ] **YouTube debug probe** — **Belirsiz / kodda bu adla yok.** `YT_DEBUG_PROBE`
  flag'i kod tabanında bulunamadı (grep boş). Gömülü YouTube video zaten REVERT
  edildi (`carosMediaLayer.ts`'te `_playYouTubeLight` yok). Kontrol edilecek ayrı
  bir YT probe flag'i yok.

## 4b. Güvenlik — Uzaktan Komut P0 Cihaz Doğrulaması (ZORUNLU, satış blocker)

> Fix'ler kodda kapalı + JS testleri geçiyor; **cihazda doğrulanmadı**.
> Detay senaryolar: §"Cihazda Doğrulanmamış Fix'ler" (güvenlik test planı).

- [ ] **Plaintext kritik komut reddi** — E2E'siz `unlock` her üç yolda CAN'e gitmez
  (commandListener.ts:92 · remoteCommandService.ts:297 · CommandService.java:108).
- [ ] **Same-channel replay reddi** — aynı E2E komut 2×: ilki icra, ikincisi
  `Replay Attack` (commandCrypto.ts:7b · NativeCryptoManager.java:150).
- [ ] **Cross-channel replay reddi (YENİ FIX)** — komut WebView aktifken işlenir,
  sonra ekran kapalı + aynı şifreli komut FCM ile → native reddeder. Köprü:
  `checkCommandNonce` (CarLauncherPlugin) → `NativeCryptoManager.checkAndMarkNonce`
  ortak `native_e2e_nonces` store. **Cihazda doğrulanmadı.**
- [ ] **push-notify auth (YENİ FIX)** — service_role'suz POST → 401
  (`auth.ts authorizePushRequest`; JS testi geçti). **Deploy'da doğrulanmadı.**
  NOT: araç-tarafı `triggerPushNotify` artık 401 alır (service_role taşıyamaz) →
  "komut tamamlandı" bildirimi server-side tetiğe taşınmalı (kalan iş; kritik
  komut akışı etkilenmez, fire-and-forget).
- [ ] **config.toml deploy davranışı** — `supabase/config.toml` YOK. Fonksiyon-içi
  auth defense-in-depth sağlıyor; yine de gateway `verify_jwt=true` deploy'da teyit.

## 4c. OTA v1 Doğrulaması (deploy + K24 saha — detay: docs/OTA.md §7)

> 7-commit OTA zinciri kodda tamam + 92 JS testi geçiyor; **deploy/cihazda doğrulanmadı.**

- [ ] **Migration deploy** — `supabase db push`: `20260610000018` + `20260610000019`;
  self-verifying DO blokları NOTICE ile PASS (GRANT/RLS/policy/bucket-private).
- [ ] **Publish** — `npm run ota:publish -- --apk <release.apk> --channel internal`
  → draft satır + Storage objesi; aynı sürüm ikinci publish → 409 reddi.
- [ ] **Download** — aktivasyon sonrası cihaz indiriyor (progress + `files/ota/*.apk`).
- [ ] **Hash verify** — sha256 kolonu bozularak negatif test: `ERR_HASH` + tmp silinmiş.
- [ ] **Install permission** — bilinmeyen-kaynak ayar ekranı K24 ROM'unda AÇILIYOR
  (en büyük ROM riski; açılmıyorsa OTA stratejisi daraltılıp belgelenir).
- [ ] **Install dialog** — sistem kurulum diyaloğu + kullanıcı onayı (sessiz kurulum yok).
- [ ] **Reboot** — kurulum sonrası launcher (HOME default) otomatik geri geliyor.
- [ ] **Version doğrulama** — `getAppVersionInfo` yeni versionCode raporluyor.
- [ ] **ota_success event** — `vehicle_events`'te `ota_event/ota_success` satırı;
  aynı sürüm için İKİNCİ event YOK (dedup); RolloutCenter health beslemesi görünür.

## 5. Saha Testi (K24 head unit — gerçek cihaz)

> `PROJECT_STATE.md` + `HANDOFF.md`: aşağıdakilerin çoğu **SAHA TESTİ BEKLİYOR**.
> Detaylı senaryo/durum için `docs/TEST_MATRIX.md`.

- [ ] **K24 head unit üzerinde çalışıyor** — uygulama açılıyor, donmuyor,
  varsayılan launcher seçilebiliyor (AndroidManifest MAIN+LAUNCHER+HOME+DEFAULT).
- [ ] **BLE OBD bağlantısı** — BLE GATT transport gerçek ELM327 ile bağlanıyor
  (`BleObdManager.java`). Durum: BEKLİYOR (cihazda doğrulanmadı).
- [ ] **Classic OBD bağlantısı** — RFCOMM/Classic ELM327 bağlanıyor
  (`OBDManager.java`). KWP2000/Fiat Doblo senaryosu (`PROTOCOL_CYCLE`,
  `obdService.ts:608`) dahil. Durum: BEKLİYOR.
- [ ] **GPS hız testi** — kanonik hız HUD'da doğru (`useUnifiedVehicleStore`;
  commit 99abf60). CAN→OBD→GPS füzyonu beklenen değeri veriyor. Durum: BEKLİYOR.
- [ ] **CAN fallback** — K24CanBridge + McuEventSniffer çalışıyor, crash loop yok
  (commit ef20108). Durum: BEKLİYOR.
- [ ] **Performans (low-end) testi** — Faz 1 GPU patch (commit 2fbbd57) sonrası
  K24/Mali-400'de dokunma gecikmesi ölçülüp düştü mü. `--rt-blur` guard etkin mi.
  Durum: BEKLİYOR. (Faz 2 interval gating henüz YAPILMADI.)
- [ ] **YouTube audio/stream** — Piped üzerinden arama + çalma çalışıyor.
  **RİSK:** canlı doğrulanmış tek instance `api.piped.private.coffee`
  (`pipedProvider.ts:22-23`); düşerse YouTube çöker.
- [ ] **YouTube video** — **ertelendi.** Gömülü video REVERT edildi; şu an
  strateji audio/stream odaklı. Release'te video özelliği beklenmiyor.

## 6. Çalışma Ağacı & Git Hijyeni

- [ ] **Commit edilmemiş native değişiklikler gözden geçirildi** — `git diff` ile.
  `PROJECT_STATE.md`: android native dosyaları `M`, çalışma ağacı kirli (~240 dosya).
- [ ] **`android/app/src/main/assets/` durumu netleşti** — Vosk modeli + `uuid`
  UNTRACKED (`??`, git'te yok). Release APK'ya dahil edildiğinden emin ol
  (`PROJECT_STATE.md` Vosk bölümü).
- [ ] **Merge hedefi netleşti** — branch belirsizliği (CLAUDE.md "master",
  çalışma `feature/ble-obd-support`, hem main hem master ref var). **Belirsiz.**

---

> **Kural:** Build success alone is not proof (CLAUDE.md LOCAL SCOPE INTEGRITY §8).
> Saha testi maddeleri geçmeden "release hazır" denmez.
