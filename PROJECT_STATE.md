# PROJECT_STATE — CarOS Pro (CockpitOS)

> Bu dosya projenin **anlık gerçek durumunu** tutar. Ajan/oturum değişince
> "şu an neredeyiz?" sorusunun cevabı burada. İddialar kod tabanından doğrulandı.
> Son güncelleme: 2026-06-11.

---

## Aktif Branch

- **Aktif branch:** `main` (HEAD `cffe182`; 2026-06-11 companion sürekli sohbet döngüsü)

## Companion Sürekli Sohbet Döngüsü (2026-06-11, `cffe182` — P0 UX, CİHAZ DOĞRULAMASI BEKLİYOR)

Saha şikayetleri: cevap sonrası her seferinde mikrofona basmak gerekiyor ·
asistan geç cevap veriyor · cevaplar robotik/aşırı kısa. Çözüm (voiceService +
ttsService + voiceTuning + companionChatProvider, 8 dosya):

- **Döngü:** dinle → transcript → cevap TTS → `registerTtsEndListener` →
  350ms tampon → mikrofon OTOMATİK yeniden açılır (`followUpListenMs=8s`
  kısa pencere; wake word gerekmez). Sessizlik (boş transcript) → idle,
  tekrar tekrar konuşma YOK.
- **Kapsam kuralı:** döngü YALNIZ companion sohbet cevabında kurulur
  (`_dispatchConversation(armFollowUp=true)`). Araç komutları (dispatch/
  dispatchDriving/dispatchChain/semantic/askAI) `_endConvSession()` çağırır —
  komut sonrası mikrofon kendiliğinden AÇILMAZ. Onay sorusu ("Bunu mu demek
  istedin?") istisna: evet/hayır cevabı için dinleme açılır.
- **Kapatma sözleri:** `_isConversationEnd` — "tamam/sus/kapat/sonra
  konuşuruz/görüşürüz" (TAM söylem, TR-normalize) döngüyü SESSİZCE bitirir;
  "müziği kapat" gibi nesneli komutlar parser yolunda kalır.
- **Geç cevap:** "düşünüyorum" ara feedback'i 800ms EŞİKLİ timer'a alındı
  (`THINKING_FEEDBACK_DELAY_MS`) — hızlı cevapta ara konuşma yok; geç kalan
  ara konuşmayı cevap TTS'i QUEUE_FLUSH ile keser (`_speakSeq` yalnız son
  utterance bitişi sayılır).
- **Doğallık:** companion promptunda "8 kelime" kuralı kaldırıldı — sürüşte
  2-3 kısa cümle / parkta 3 doğal cümle; hitap her cümlede tekrarlanmaz;
  aynı kalıplar yasak; veri yokken smalltalk'ta teknik hata cevabı yerine
  doğal dil. `maxOutputTokens` 60/120→100/160; TTS kırpma 220→300 + cümle
  sınırında kesim.
- **Güvenlik:** PROTECTION/CRITICAL (`setVoicePaused`) hem arm'ı hem
  re-listen'ı engeller; TTS konuşurken STT başlamaz (bitiş event'i bekler).
- **Test:** `companionConversationLoop.test.ts` 15 yeni test (döngü, komut
  ayrımı, kapatma sözleri, pause kilidi, 800ms eşiği). voiceTuning/
  voiceCogPause mock'larına `registerTtsEndListener` eklendi (modül-init
  kırılması onarıldı). Suite **1119/1119** · build 1m31s · lint 0 hata.
- **Cihazda doğrulanacak:** Duster'da çok turlu sohbet ("Hey Mavi nasılsın"
  → cevap → tekrar basmadan konuşma), "tamam" ile kapanış, müzik çalarken
  duck/resume davranışı, K24'te kısa pencere süresi hissi.

## Telemetri Sessiz Yutma Düzeltmesi (2026-06-11, `60d92e4`)

Saha: admin incidents tablosu tamamen boş. Kanıtlı kök neden:
`vehicleIdentityService.ts` — cihaz eşlenmemişse (`veh_api_key` yok;
`registerVehicle` YALNIZ MobileLinkWidget'tan tetikleniyor, boot'ta otomatik
kayıt YOK) `if (!apiKey) return;` tüm eventleri sessizce yutuyordu.
Düzeltme: throttle'lı `[VehicleEvent] missing veh_api_key` console.warn +
düşen event sayacı (`getVehicleEventPipelineStatus`) + `isDevicePaired()` +
snapshot'larda yalancı 'sent' yerine **'not_paired'** sonucu + Ayarlar/Dev
Inspector'da "Cihaz eşlenmemiş — Mobil Bağlantı'dan eşleştirin" mesajı.
Gönderim davranışı değişmedi (eşlenmemişken denenmiyor) — kayıp artık görünür.
**Sahada yapılacak:** cihazda Ayarlar → Mobil Bağlantı ile eşleme; sonrasında
voice_diag/system_health akışı admin'de doğrulanacak.

## DTC Tarama Düzeltmesi (2026-06-11, `209046f` — CİHAZ DOĞRULAMASI BEKLİYOR)

Saha hatası (foto): OBD bağlı + canlı veri akarken Arıza Teşhisi "OBD okuyucu
yanıt vermiyor". Kök neden: `CarLauncher.readDTC()/clearDTC()` native tarafta
HİÇ YOKTU (yalnız TS arayüzü) → her tarama "method not implemented" reject.
Düzeltme: ElmProtocol'e SAE J1979 Mode 03/04 (CAN sayaç baytı + K-line dolgu +
çok-ECU + ISO-TP segment parse; NO DATA=boş liste ≠ ERROR=exception);
OBDManager+BleObdManager'a `elmLock` (DTC ↔ 3sn PID polling aynı kanal,
serileşir) + `isConnected()`; CarLauncherPlugin'e `readDTC`/`clearDTC`
@PluginMethod (BLE öncelikli aktif transport, ayrı thread). dtcService artık
native hata nedenini gösteriyor. Gradle compile + 1090 test + lint OK.
**Cihazda doğrulanacak:** ELM327 + araçta gerçek Mode 03 (kod var/yok/çoklu).

## Sesli Komut Parser Hassasiyet Düzeltmesi (2026-06-11, `d55f8e2`)

Saha hatası: "nasılsın" → "Araç verisi alınamıyor". Kök neden zinciri —
hepsi `scorePattern` gevşekliği, tek commit'te kapatıldı:
'nasılsın' vehicle_status kalıbındaydı (kaldırıldı) · Tier-1 kısa kalıp
substring gaspı ('dur' ⊂ "araç DURumu" → durum sorusu MÜZİĞİ KAPATIYORDU;
≤4 harf artık tam-kelime) · ters yön düz substring ('durum' ⊂ 'hava DURUMu';
artık startsWith veya çok-kelimeli tam-kelime dizisi) · Tier-2 orta-kelime
eşleşme ('nasilSİLn'deki 'sil' → DTC silme 0.82 OTOMATİK eşik üstü; artık
exact/prefix) · Tier-3 fuzzy 3-harf gürültüsü ('iyi'~'isi'; min 4) ·
soru edatları ('mi/misin/musun') FILLERS'a eklendi ('misin'~'music' 0.6).
9 yeni regresyon testi; suite 1066/1066. **Cihaz doğrulaması bekliyor.**
- **Branch belirsizliği ÇÖZÜLDÜ (2026-06-10):** remote HEAD `origin/main` →
  CLAUDE.md "Primary branch" `main` olarak düzeltildi; `master` arşiv ref.
  PR/merge hedefi: `main`.
- Diğer branch'ler: `main`, `master`, `fix/thermal-optimization`.

## Release Disiplini (2026-06-10 — KURULDU)

- **Tek sürüm kaynağı:** repo kökünde `version.properties` (VERSION_CODE=2,
  VERSION_NAME=1.0.0). `android/app/build.gradle` buradan okur (fallback'li);
  `package.json` "version" senkron (1.0.0).
- **Bump akışı:** `npm run release:bump [x.y.z]` → `scripts/bump-version.mjs`
  (VERSION_CODE +1, VERSION_NAME set, package.json senkron, boş CHANGELOG uyarısı).
  Smoke-test edildi (2→3→geri alındı).
- **Paket script'leri:** `npm run release:apk` / `release:aab`
  (build + cap sync + gradle assembleRelease/bundleRelease).
- **CHANGELOG.md** eklendi (Keep-a-Changelog; [Unreleased] + [1.0.0] baseline).
  Kural: release'te tag `git tag v<VERSION_NAME>`; tag'siz APK/AAB dağıtılmaz.
- **RELEASE_CHECKLIST.md §3** güncellendi (stale "versionCode 1" düzeltildi;
  CHANGELOG/tag/script maddeleri eklendi).
- **eslint.config.js:** `.worktrees/` globalIgnores'a eklendi (10 sahte lint
  hatası worktree kopyasından geliyordu → lint artık exit 0).
- **.gitignore:** `*.pptx` (build_deck.cjs üretimi pazarlama binary'si).
- **Doğrulama (2026-06-10):** `npm run build` OK (1m02s) · `npm run lint` exit 0 ·
  `gradlew :app:assembleDebug` BUILD SUCCESSFUL (merged manifest'te
  versionCode=2 / versionName=1.0.0 teyitli — version.properties'ten geliyor).
  Not: gradle buildDir `C:/Temp/carlauncher/` (android/build.gradle:30);
  JAVA_HOME = Android Studio jbr gerekiyor (PATH'te java yok).

## Companion AI "Yol Arkadaşım" (2026-06-11 — V1, Commit 3/7 TAMAM, AI-FIRST)

- **MİMARİ REVİZYONU (kullanıcı onaylı):** keyword tabanlı sohbet ANA YOL DEĞİL.
  Companion açıkken komut olmayan/belirsiz her cümle ÖNCE Gemini'ye gider;
  offline'a yalnız 4 koşulda düşülür (net yok · key yok · hata/timeout · 429
  60sn soğuma). Doküman §9 revize edildi; §2.8 korundu (proaktif = şablon).
- **Commit 3 TAMAM (`03b7e83`):** `companionChatProvider.tryCompanionChat` —
  AI-first router ucu. Router voiceService'te: parser ≥0.7 → komut yolu AYNEN;
  gerisi sohbet hattı (belirsiz bant 0.5-0.7'den ÖNCE). Gemini sohbet: kişilik+
  ad+hitap system prompt, temp 0.7, sürüşte 60 token/8 kelime, RAM geçmişi 8 tur.
  **Ham OBD gitmez** — Commit 2 yorumlayıcı çıktısı prompt'a girer (yapısal test
  var). Offline fallback zinciri: offlineConversationEngine → kategori şablonu →
  null (zincir devam). `voice_route` tanı aşaması (companion_gemini/_offline/
  offline_chat). 24 test; suite 1090/1090. **Cihaz doğrulaması bekliyor**
  (Duster: "nasılsın" → Gemini cevabı; internetsiz K24: offline cevap).

- **Mimari:** `docs/COMPANION_AI_ARCHITECTURE.md` (`8cceab8`) — tam tasarım:
  mevcut altyapı analizi, güvenlik riskleri, wake word v2 planı, state machine,
  7 commit'lik atomik plan (§9), test planı (§10).
- **Commit 1 TAMAM (`0c478e0`):** ayar + güvenli kimlik modeli.
  - `src/platform/companion/companionIdentity.ts` — sanitize (24 char sınır,
    TTS-güvenli karakter seti, prompt injection sökme TR+EN), fallback zinciri
    (ad→"Yol Arkadaşım", wake→"Hey Mavi", hitap→boş), kısa wake phrase uyarısı,
    `resolveCompanionIdentity` (tüketiciler ayarları YALNIZ buradan okur).
  - `useStore` persist **v13→v14**: 7 yeni alan (`companionEnabled` ham anahtar
    her zaman false başlar — opt-in; eski `wakeWordEnabled`'dan devralınmaz).
  - SettingsPage "Yol Arkadaşım" paneli: ana anahtar, asistan adı, hitap,
    4 kişilik (sessiz/samimi/neseli/profesyonel), 3 sıklık (az/normal/sik),
    wake word toggle + cümle + yanlış tetikleme uyarısı; blur'da sanitize.
  - 40 yeni test (`companionIdentity.test.ts`) — suite 1002/1002, build+lint OK.
- **Commit 2 TAMAM (`c07ac1a`):** `companionContext.ts` — SAF yorumlayıcılar
  (servis import'u SIFIR; motor Commit 4'te ham değerleri besler).
  `interpretFuel/Range` (yakıt→menzil, approxRangeKm 143→150),
  `interpretTripDuration/BreakNeed` (mola kararı: eşik altı null=sus, Türkçe
  ek uyumu saattir/dakikadır), `interpretFatigue` (gece+süre),
  `interpretArrival` (TTS ondalık virgül "7,5"), `interpretEngineTempConcern`
  (yalnız konuşmaya değer durum), `interpretTimeOfDay` (geçersiz→gece fail-safe).
  İmkânsız sensör verisi → null (fail-soft sus). 55 test; suite 1057/1057.
- **Sırada (Commit 4):** bağlam enjeksiyonu genişletme — trip/rota/hava
  yorumlarının prompt bağlamına eklenmesi (OBD yakıt/sıcaklık 3'te girdi).
  Sonra: engine/PromptScheduler (proaktif=şablon) → wake word v2 (K24 ölçümü
  şart) → telemetri.

## Duster Saha Düzeltmeleri (2026-06-11 — 3 commit, CİHAZDA KISMEN DOĞRULANDI)

Gerçek araç testi (Renault Duster, aftermarket head unit, eski WebView
Chrome 64-78 bandı) üç saha hatası — kökleri ve çözümleri:

1. **`901edf5` fix(compat):** inline modern CSS (clamp/min/aspect-ratio/
   inset/100dvh) eski WebView'de sessizce düşüyor → Expedition/Horizon grid'i
   tek kolona çöküyor, harita 0px, kök auto-yükseklik → dock ekran dışı.
   Çözüm: `src/utils/cssCompat.ts` (CSS.supports, module-eval'de 1 kez) +
   minmax() fallback şablonları + inset→top/right/bottom/left + harita
   minHeight:200 + `VIEWPORT_H` (dvh→vh). Ek: gün/gece boot'ta 2 dk hızlı
   saat kontrolü (geç RTC senkronu); support snapshot'a `device` bloğu
   (webViewVersion/androidVersion/tier/cores/RAM/ekran).
2. **`67d0a71` fix(media):** YouTube araması boş — Piped instance'larının
   4/5'i kalıcı 502. Invidious yedek havuzu (arama+stream; iv.melmac.space
   doğrulandı), `_tryInstances(pool)` havuz-başına sticky, kapaklar
   i.ytimg.com, AbortController guard (Chrome <66).
3. **`e191bb1` fix(voice):** mikrofon "Dinliyorum"da takılıyordu — ilk
   basışta Vosk unpack+load 20-40 sn, JS failsafe 14 sn. Çözüm: SystemBoot
   Wave 4 boot+8sn `preloadVoskModel` + native `ensureVoskModel` kuyruk
   (yükleme sırasında istek reddedilmez). **✅ Cihazda doğrulandı (kullanıcı:
   "mikrofon çalışıyor").** Dashboard/dock/YouTube düzeltmeleri cihazda
   henüz ayrı ayrı teyit edilmedi.

Doğrulama: tsc temiz · ilgili testler geçti (41 day/night+inspector,
8 ytDownload) · build+cap sync+assembleDebug OK. APK dağıtımı: cloudflared
quick tunnel + `C:\Temp\apk-share\serve-apk.cjs` (Range destekli mini sunucu).

## OTA v1 (2026-06-10 — KOD TARAFI TAMAM, 7/7 commit)

Zincir: `3f9b456` version truth (VITE_APP_VERSION körlüğü fix + native
getAppVersionInfo) · `a04ff42` ota_releases+rollout_plans migration
(GRANT/RLS/policy + self-verifying DO) · `8a60066` publish script
(`npm run ota:publish`, draft+409-koruması) · `3b11e82` native downloader
(streaming SHA-256, .tmp→.apk, disk×2) · `6740d44` install gate
(paket/sürüm/imza ön-kontrol + REQUEST_INSTALL_PACKAGES + sistem diyaloğu)
· `ca97374` otaUpdateService (durum makinesi, 6h poll, park kapısı,
SystemBoot Wave 4, Settings kartı) · `fb4b51d` telemetri
(ota_success/ota_fail dedup → vehicle_events → getRolloutHealth).

- **Doküman:** `docs/OTA.md` (mimari/runbook/rollback/güvenlik/K24 listesi),
  RELEASE_CHECKLIST §4c.
- **BEKLEYEN (kod dışı):** `supabase db push` (2 migration) → gerçek publish
  → K24 uçtan uca saha doğrulaması (en büyük risk: ROM'da bilinmeyen-kaynak
  ayar ekranı). Test: 788/788. Aynı gün güvenlik commit'i: `7075813`
  (cross-channel replay + push auth).

## Son Commit (HEAD)

- `b453cf9` — **docs(soak): fix PSS sampler multi-match in K24 checklist**
  (teyit: `git rev-parse HEAD`)
- **Test altyapısı T1–T4 arc'ı (2026-06-09)** — hepsi `src/__tests__/` altında,
  production'a dokunmaz:
  - `e98bd23` docs(soak): K24 manuel soak checklist
  - `6b75e7f` test(soak): cross-service 24h aggregate leak invariant
  - `57da3a9` test(soak): remoteCommand ack-timeout + queue eviction
  - `55ab621` test(soak): telemetry + connectivity endurance
  - `a6646e1` test(soak): runtime zombie + thermal stability
  - `ac0295e` test(soak): obd reconnect/backoff long-run leak
  - `79d8b11` test(soak): safeStorage write-throttle 8h endurance
  - `473893a` test(soak): virtual-clock soak harness (T4 başlangıcı)
  - `9a41c73`/`ca8024f`/`978aa2a`/`52a04c4`/`206b41a` — T3/T7/T2/T1 (leak harness,
    low-end, CAN, OBD simülatörleri)
- Önceki ilgili commit'ler:
  - `2fbbd57` perf(ui): low-end head unit (Mali-400) GPU yükünü azalt — Faz 1
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

- **Web build:** `npm run build` (tsc + vite) **bu oturumda (2026-06-09) çalıştırıldı → OK** (~1m17s).
- **Test:** `npm run test` (vitest) **bu oturumda çalıştırıldı → 635/635 OK** (50 dosya).
  T1–T4 test altyapısıyla 482 → 635'e çıktı. `tsc -b` ve `eslint` de temiz.
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
- **Piped (YouTube proxy) mimari sorunu:** `pipedProvider.ts:22-28` **5 aday instance**
  içeriyor (paralel yarışır), ama 2026-06 testinde yalnızca `https://api.piped.private.coffee`
  canlı doğrulandı; diğerleri 502/aday. Pratikte **tek nokta arıza riski** — o instance
  düşerse YouTube arama/stream çalışmaz. (Düzeltme 2026-06-06: önceki "tek instance" ifadesi
  yanlıştı; liste 5 elemanlı, 1 canlı.)
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

## Ölü Kod Temizliği — Commit 1 UYGULANDI (2026-06-10)

İzole tekiller silindi (9 dosya, hepsi 0-importer kanıtlı; testler/e2e dahil):
usePersonalizationStore (deprecated shim) · themeTransitionService · dropZoneRegistry ·
arProjectionService ×2 (platform/ + platform/navigation/ çift kopya) · deviceDetection +
PerformanceModeSuggestion (birlikte) · obdAlerts · useDragScroll. Ayrıca `puppeteer`
devDep kaldırıldı (e2e Playwright kullanıyor). **useSABDirectUpdate Commit 2'ye ertelendi**
(importer'ı PremiumSpeedometer henüz duruyor — birlikte silinecek).
Doğrulama: build + lint 0 hata + vitest 671/671 + e2e app.spec 6/6 (chromium).

**Commit 2 UYGULANDI:** eski layout zinciri + uyduları, 44 dosya
(HomeScreen→LayoutSwitcher→layout/layouts/* 8 + home/layouts/* 5 → PremiumSpeedometer/
DriveHUD/HeaderBar/OEMCockpitLayout/LayoutWidgets/DraggableWidget/WidgetEditPanel +
uydular: MediaHub/SmartCardStack/SetupWizard/OBDPanel/DigitalCluster/TPMSWidget/
SleepScreen/SmartContextBanner/MaintenanceWidget/RadarQuickReport/VehicleReminderWidget/
LayoutPreview/ThemeStudio/ThemeSwitcher/TelemetryView/QuickControlsOverlay/
PremiumNavDemoScreen/OEMMapVignette/NeuralVisualizer + hooks: useSABDirectUpdate/
useVehicleProfile + store: useDragStore/useThemeStudio). Kritik ayrım:
`themes/CockpitLayout` CANLI (NewHomeLayout.tsx:29) — silinen `layout/layouts/CockpitLayout`.
Doğrulama: build 42s + lint 0 + vitest geçti + e2e 6/6.
**Commit 3 UYGULANDI:** traffic/ adası (9 dosya — yarım migrasyon; aktif yol
trafficService.ts KORUNDU) + diagnostic/ adası (components/diagnostic 4 +
diagnosticStore; aktif DTC obd/DTCPanel KORUNDU). Doğrulama: build 38s + lint 0 +
vitest 671/671 + e2e 6/6.

**3 commit toplamı: ~67 dosya, ~14.000 satır ölü kod kaldırıldı.** Build süresi
1m02s → 38s. DOKUNULMAYANLAR (bilinçli): serviceWorker.ts (drift kararı bekliyor),
offline harita kümesi 6 dosya, obdBluetoothService (BLE saha testi), 
car-dashboard-theme.html (kullanıcı kararı).

## Ölü Kod Denetimi v2 (2026-06-10 — rapor-only, silme YOK)

Knip (geçici config: entry main.tsx+admin/main.tsx) + import-graph grep + dist
literal doğrulaması. **~76 dosya erişilemez** (knip tam listesi o oturum çıktısında).
2026-06-06 raporunu DOĞRULAR ve genişletir:

- **Bundle temiz teyit:** ölü dosyalar dist'e GİRMİYOR (OEMCockpitLayout benzersiz
  literal'leri dist'te 0; obdSimulator/soakHarness/leakHarness/patentTestLogger/
  ytDownloadService dist'te 0). Tree-shake çalışıyor.
- **Aktif zincir:** index.html → main.tsx → App.tsx:4 → MainLayout → NewHomeLayout
  (MainLayout.tsx:34,424); temalar NewHomeLayout üzerinden CANLI.
- **✅ ServiceWorker drift ÇÖZÜLDÜ (2026-06-10):** `src/serviceWorker.ts` artık
  TEK KAYNAK; `public/serviceWorker.js` AUTO-GENERATED (`npm run build:sw`,
  build zincirinde). Drift iki yönlüydü: TS'teki tüketicisiz SVC_SPEED_UPDATE
  rölesi KALDIRILDI (istemci tarafı hiç yazılmamıştı); canlı JS'teki push +
  notificationclick handler'ları TS'e tipli taşındı; canlı JS'in güvenli
  fire-and-forget cache yazımı (`cacheTileData().catch()`) korundu (TS'teki
  `await` regresyonu düzeltildi). Kanıt: md5(public)==md5(dist), handler
  envanteri 5=5. Not: `declare const self` WebWorker lib ile çakışır (TS2451)
  → `const sw = self as unknown as ServiceWorkerGlobalScope` alias deseni.
- **Knip false-positive'leri (CANLI, silme):** serviceWorker.ts (string-register
  zinciri mapSourceManager→serviceWorkerManager aktif — ama yukarıdaki drift
  nedeniyle fiilen gölge kopya).
- **depcheck:** gerçek aday yalnız `puppeteer` (e2e Playwright kullanıyor);
  @capacitor/android (cap sync), tailwindcss (@tailwindcss/vite), 
  @vitest/coverage-v8 (test:coverage CLI) false-positive.
- **.worktrees/:** 28MB, git-ignored (gitignore:79), tracked=0, tsc/vite kapsamı
  dışında (tsconfig include=["src"]); lint'e 2026-06-10'da ignore eklendi →
  artık hiçbir süreci etkilemiyor; tek etkisi disk + IDE/grep gürültüsü.

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
