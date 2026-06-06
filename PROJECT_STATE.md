# PROJECT_STATE — CarOS Pro (CockpitOS)

> Bu dosya projenin **anlık gerçek durumunu** tutar. Ajan/oturum değişince
> "şu an neredeyiz?" sorusunun cevabı burada. İddialar kod tabanından doğrulandı.
> Son güncelleme: 2026-06-06.

---

## Aktif Branch

- **Aktif branch:** `feature/ble-obd-support` (teyit: `.git/HEAD`)
- **CLAUDE.md "Primary branch: master" diyor**, ancak repoda hem `master` hem `main`
  ref'i var ve **aktif çalışma `feature/ble-obd-support` üzerinde**. Yani belge ile
  gerçek branch durumu uyuşmuyor — PR/merge hedefi netleşmeli (**Belirsiz**: hangi
  branch'e merge edilecek, master mı main mi).
- Diğer branch'ler: `main`, `master`, `fix/thermal-optimization`.

## Son Commit (HEAD)

- `2fbbd57` — **perf(ui): low-end head unit (Mali-400) GPU yükünü azalt — Faz 1**
  (teyit: `.git/logs/HEAD` son satır)
- Önceki ilgili commit'ler:
  - `99abf60` fix(nav): use canonical speed in navigation HUD
  - `ca0f345` fix(voice): keep Vosk and JNA classes in release builds
  - `04d0ef2` feat(obd): add BLE GATT transport support
  - `ef20108` fix(can): McuEventSniffer ölü executor crash loop'unu gider

## Çalışma Ağacı (commit DIŞI bekleyen değişiklikler)

`git status` snapshot'ı çok sayıda `M` (modified) dosya gösteriyor (android/* ve src/*).
Bunların hepsi HEAD'e commit EDİLMEMİŞ durumda.

- **src/components/layout/MainLayout.tsx içinde bekleyen değişiklikler**: safeStorage
  refactor (`safeGetRaw`/`safeSetRaw` import + write-debounce) ve `setTheme` day/night
  eşlemesi kodda **mevcut** (teyit: MainLayout.tsx:3, :56, :283). Bunlar ayrı bir
  commit'e ait bekleyen iş olarak değerlendirilmeli.
- **Android native değişiklikleri commit edilmemiş**: `BleObdManager.java`,
  `OBDManager.java`, `CarLauncherPlugin.java`, `K24CanBridge.java`,
  `McuEventSniffer.java`, `MediaListenerService.java` hepsi `M` durumda.
- **Faz 1 commit'i hunk-seçimli yapıldı (teyit: `git diff --cached` + `git show 2fbbd57`):**
  commit 2fbbd57 YALNIZCA performans hunk'larını içerir (theme.css tam + MainLayout'un
  3 GPU hunk'ı). `safeStorage` + `setTheme` değişiklikleri **bilinçli olarak commit DIŞI**
  bırakıldı, hâlâ unstaged (`M`) — ayrı bir commit bekliyor.
- **Çalışma ağacı çok kirli:** `git status` ~240 değişen/izlenmeyen dosya gösteriyor.
- **`android/app/src/main/assets/` = UNTRACKED (`??`)** → Vosk modeli + `uuid` dosyası
  **git'te yok** (versiyon kontrolü dışında). Commit/transfer öncesi dikkat.

---

## Build & Test Durumu

- **Web build:** `npm run build` (tsc + vite) **bu oturumda çalıştırıldı → OK** (~2m33s).
- **Test:** `npm run test` (vitest) **bu oturumda çalıştırıldı → 482/482 OK** (32 dosya).
  (jsdom canvas `getContext` uyarıları önceden var, hata değil.)
- **Native compile:** `gradlew compileDebugJavaWithJavac` mikrofon/ducking değişiklikleri
  için **OK** (bu oturumda; APK paketlenmedi).
- **Not:** build/test, Faz 1 commit'inden ÖNCE tam (kirli) çalışma ağacında çalıştı; commit
  edilen hunk'lar o yeşil ağacın bağımsız alt kümesi. Bekleyen `safeStorage`/`setTheme`
  ayrı commit'lenince yeniden doğrulanması iyi olur.

---

## Son Performans Patch (Mali-400 / K24 head unit)

**Problem:** K24 + Mali-400 head unit'te 2-3 sn dokunma gecikmesi.
**Kök neden:** GPU compositor doygunluğu (kontrol-dışı blur + her zaman canlı WebGL),
ikincil olarak koşulsuz ana-thread interval yığını.

### Faz 1 — TAMAMLANDI (commit 2fbbd57, salt görsel / koşullu-render)
- `theme.css` `.up-blob` blur 60px → `--rt-blur` guard'ına bağlandı
  (teyit: theme.css:175 `filter: blur(calc(var(--rt-blur, 1) * 60px))`).
- `MainLayout.tsx` ambient blob DOM'u `blurEnabled` koşuluna bağlı koşullu render
  (teyit: MainLayout.tsx:375 `{!isSafeMode && blurEnabled && (...)}`).
- MiniMap MapLibre WebGL anasayfa opak overlay'le kapanınca unmount: `homeFullyHidden`
  (teyit: MainLayout.tsx:349-351 = theater | split | rearCam | settings | climate),
  MiniMap'e `fullMapOpen={fullMapOpen || homeFullyHidden}` (teyit: MainLayout.tsx:431).
- `--rt-blur` 0/1 yazımı AdaptiveRuntimeManager'da (teyit: AdaptiveRuntimeManager.ts:325).

### Faz 2 — HENÜZ YAPILMADI (kullanıcı onayı bekliyor)
Interval gating hedefleri (frekanslar bu oturumda kodda doğrulandı):
| Hedef | Dosya | Mevcut | Planlanan |
|-------|-------|--------|-----------|
| VehicleSignalResolver | vehicleDataLayer/VehicleSignalResolver.ts:206-220 | 50ms / 20Hz | 10/5Hz |
| NativeHALAdapter | vehicleDataLayer/NativeHALAdapter.ts:43 (POLL_INTERVAL_MS=500) | 2Hz | 1Hz |
| CognitivePriorityEngine | system/CognitivePriorityEngine.ts:46 (POLL_INTERVAL_MS=1000) | 1Hz | 0.5Hz |
| vehicleIntelligenceService | vehicleIntelligenceService.ts:27 (TICK_MS=500) | 2Hz (durağanda) | 1Hz |

- **DOKUNULMAYACAK:** `blackBoxService.ts:54` `SAMPLE_INTERVAL=100` (10Hz, kaza kara
  kutusu — yüksek risk). Timer kurulumu blackBoxService.ts:415.
- **Düzeltme:** Önceki analizdeki "Safety 5Hz" iddiası kod kanıtında doğrulanamadı —
  `SafetyBrain` interval kullanmıyor (debounce tabanlı). Faz 2 kapsamına dahil DEĞİL.

---

## OBD / BLE Durumu

- **BLE GATT transport desteği eklendi** (commit 04d0ef2). `BleObdManager.java` GATT
  notify/write characteristic'leri üzerinden ELM327 konuşuyor (teyit: BleObdManager.java
  başlık + connectGatt TRANSPORT_LE, satır 151-164).
- **Transport seçimi/persist:** Son kullanılan taşıma ('classic' | 'ble') MAC ile
  persist ediliyor; eşli (bonded) DUAL cihazlar 'classic' görünebildiğinden seçim
  yalnızca TAHMİN, fallback timeout'u buna göre ayarlı (teyit: obdService.ts:109-126).
- **Protokol cycle:** Fiat/Doblo gibi eski araçlar KWP2000; uygulama eskiden CAN'a
  zorluyordu → ECU init sonsuza dek başarısız. `PROTOCOL_CYCLE = [undefined,'6','5','4','3','7']`
  reconnect denemesine göre döndürülüyor (teyit: obdService.ts:608-609).
- **Durum: SAHA TESTİ BEKLİYOR.** Cihazda tam doğrulanmadı. Car Scanner bağlanıp
  bizimkinin bağlanmaması bu protokol zorlamasından kaynaklanıyordu (hipotez, cihazda
  teyit edilmeli).

---

## Vosk (Offline STT) Durumu

- vosk-android, Türkçe model. Head unit internetsiz → offline Vosk şart.
- **Mikrofon kalite iyileştirmeleri KODLANDI** (CarLauncherPlugin.java): özel
  AudioRecord döngüsü + AGC + NoiseSuppressor + AEC + yazılım kazancı
  `VOSK_GAIN=2.0f` (teyit: CarLauncherPlugin.java:1240, 1452-1509).
- **Audio ducking:** Dinlerken müzik `VOSK_DUCK_RATIO=0.12` (%12) ile kısılır, bitince
  restore (teyit: CarLauncherPlugin.java:1250, 1467).
- **Durum:** Java compile OK (bu oturumda `compileDebugJavaWithJavac`). **CİHAZDA TAM
  DOĞRULANMADI.** Native değişiklikler commit EDİLMEMİŞ (CarLauncherPlugin.java `M`).
- **uuid düzeltmesi TEYİT EDİLDİ (bu oturumda okundu):** `android/app/src/main/assets/
  vosk-model-tr/uuid` mevcut, içerik `caros-vosk-model-tr-0.3-20260605b`. StorageService.unpack
  bu dosya olmadan patlıyordu. **Ancak** asset klasörü git'te UNTRACKED (`??`) — versiyon
  kontrolünde değil.

---

## YouTube / Medya Durumu

- **YouTube gömülü oynatma denendi sonra REVERT edildi.** `carosMediaLayer.ts` içinde
  `_playYouTubeLight` artık YOK (teyit: grep boş, yalnızca standart `playYouTube` var —
  carosMediaLayer.ts:32, :203). Eski haline döndürüldü.
- **Piped (YouTube proxy) mimari sorunu:** Çoğu public instance ölü; kodda tek canlı
  instance bırakılmış: `https://api.piped.private.coffee` (teyit: pipedProvider.ts:22-23).
  Bu **tek nokta arıza riski** — instance düşerse YouTube arama/stream çalışmaz.
- Müzik kaynak mimarisi: local + stream mevcut.

---

## CANBUS Durumu

- **Test head unit:** K24 SMART SERIES + Hiworld CANBOX, Android 15, 6GB RAM, **root YOK**.
- Ham seri çalışmaz; tek yol `K24CanBridge` (wire edilmiş). `K24CanBridge.java` +
  `McuEventSniffer.java`.
- **McuEventSniffer ölü executor crash loop'u ÇÖZÜLDÜ** (commit ef20108):
  RejectedExecutionException → crashRecovery loop kırıldı.
- Her iki dosya da şu an `M` (commit edilmemiş ek değişiklikler var).

---

## Launcher Durumu

- CarOS Pro **zaten launcher**. AndroidManifest.xml MainActivity intent-filter:
  MAIN + LAUNCHER + HOME + DEFAULT (teyit: AndroidManifest.xml:71-76). Ek BootReceiver
  (satır 98-110) açılışta başlatıyor.
- **Kod gerekmiyor.** K24'te tek iş: cihazda varsayılan launcher olarak seçmek.

---

## Çöp Kod / Ölü Dosya Analizi (2026-06-06)

Knip ile analiz yapıldı (rapor-only, **hiçbir şey silinmedi**). Knip kurulu değildi → `npx`
ile geçici config'le koşuldu, config silindi. Ham çıktı: `C:\Temp\knip\{files,exports,deps}.txt`.

**False-positive kümeleri (silme):** `.worktrees/**` (worktree kopyası), `website/**` (ayrı
Next.js projesi), `supabase/functions/**` (Deno edge), `src/admin/**` (admin.html ayrı Vite
hedefi), `regenerator-runtime` (vite.config.ts:132 polyfill), test helper/fixture export'ları.

**Gerçek ölü-kod adayları (doğrulandı, SİLİNMEDİ — silmeden önce build+test+e2e şart):**
- Eski layout sistemi zinciri (~20 dosya): `HomeScreen → LayoutSwitcher → layout/layouts/* →
  PremiumSpeedometer, DriveHUD, HeaderBar, OEMCockpitLayout, LayoutWidgets`. Aktif kök `MainLayout`.
- Trafik motoru `platform/traffic/*` (8 dosya) — yarım kalmış migrasyon; aktif `trafficService.ts`.
- Diagnostic UI `components/diagnostic/*` (5) — aktif DTC `obd/DTCPanel`'de.
- İzole tekiller: `themeTransitionService`, `dropZoneRegistry`, çift `arProjectionService`,
  `useSABDirectUpdate`, `useVehicleProfile`, `deviceDetection`.
- `puppeteer` (devDep) — aday; `clsx`/`react-router-dom`/`tailwind-merge` false-positive (admin).

**GÜVENLİ DEĞİL:** offline harita kümesi (pre-launch wire bekliyor olabilir — CLAUDE.md
offline-first çekirdek), `obdAlerts`/`obdBluetoothService` (BLE branch geri bağlıyor olabilir).

**Yan bulgu:** `useSABDirectUpdate.ts` ÖLÜ doğrulandı → `ARCHITECTURE_DATAFLOW.md` §1 düzeltildi
(aktif hız akışı Zustand `useUnifiedVehicleStore` üzerinden; SAB altyapısı canlı, tüketim hook'u ölü).
