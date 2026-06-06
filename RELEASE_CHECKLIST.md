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

- [ ] **versionCode / versionName güncel** — `android/app/build.gradle:19-20`
  (mevcut: `versionCode 1`, `versionName "1.0"`). Release öncesi bilinçli artır.
  Not: SDK seviyeleri `android/variables.gradle`'da (minSdk 24, target/compile 36).
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
- [ ] **YouTube debug probe** — **Belirsiz / kodda bu adla yok.** `YT_DEBUG_PROBE`
  flag'i kod tabanında bulunamadı (grep boş). Gömülü YouTube video zaten REVERT
  edildi (`carosMediaLayer.ts`'te `_playYouTubeLight` yok). Kontrol edilecek ayrı
  bir YT probe flag'i yok.

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
