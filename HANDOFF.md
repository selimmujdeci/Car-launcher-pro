# HANDOFF — CarOS Pro Devir Notları

> Yeni ajan/oturum buradan başlasın. Projeyi kaldığı yerden devralma rehberi.
> Son güncelleme: 2026-07-04. Branch: `feat/assistant-open-app` (HEAD `0f1d38a`).

## ✅ SON İŞ (2026-07-04 #2): "İlk istek online, sonrakiler offline" — 429 kota fix paketi

`0f1d38a` (branch `feat/assistant-open-app`) — saha şikayeti: asistan ilk isteği online
yanıtlıyor, sonrakiler "offline'a düşüyor". Uzak telemetri boştu (cihazdan voice_diag
hiç gelmemiş), teşhis kod analiziyle: **429 kota soğuma penceresi sahte offline yaşatıyordu.**
Dört kusur düzeltildi (`companionChatProvider.ts`):
1. **Çapraz kirlenme:** Groq/Haiku 429'u paylaşılan `_rateLimitedUntil`'ı kurup
   GEMINI'yi 60sn kilitliyordu → pencereler artık sağlayıcı-bazlı
   (`_groqRateLimitedUntil`, `_haikuRateLimitedUntil`).
2. **Sabit 60sn pencere:** Gemini 429 artık Google'ın `RetryInfo.retryDelay`'i kadar
   bekliyor (`_cooldownFrom429`, taban 5sn/tavan 60sn) — RPM kotasında 5-30sn'de toparlar.
3. **Sahte aptallaşma:** zincirdeki TÜM adaylar soğumadan atlanınca artık DÜRÜST kota
   cevabı: "Yapay zeka kotam şu an dolu…" (`companion_rate_limited` rotası — voice_diag'da
   görünür). Smalltalk yine offline motorda. Warmup soğumada atlanır (kota yakmaz).
4. **Kesici kirlenmesi:** `repairMusicQuery` (1.8sn mikro-bütçeli opsiyonel müzik-isim
   onarımı) timeout'u `recordAiNetFailure`'a sayılıyordu → iki müzik komutu üst üste =
   breaker 90sn TAM offline. Artık kesiciyi beslemez (fail-soft, komut ham sorguyla sürer).
Test: 5 yeni davranış testi + 3 yapısal regresyon kilidi; tam suite **1814 yeşil**, tsc temiz.
**Cihazda CANLI doğrulanmadı** — kullanıcının anahtarıyla saha testi gerek. Teşhis ipucu:
şikayet tekrarlarsa `companion_rate_limited` rotası artık gerçek nedeni söylüyor/logluyor;
kalıcıysa Gemini faturalandırma (billing) açtırmak kalıcı çözüm.

## ✅ ÖNCEKİ İŞ (2026-07-04): Offline ASR onarımı — Vosk karışıklık sözlüğü + lexicon snap

`2a333fa` (branch `feat/assistant-open-app`) — offline'da Gemini onarımı yokken bozuk
Vosk transcript'i artık parse öncesi onarılıyor. YENİ saf modül `src/platform/asrRepair.ts`:
(a) ~27 gerçekçi Vosk TR karışıklık çifti (`KNOWN_CONFUSIONS`), (b) muhafazakâr domain
lexicon snap (token ≥4 harf, mesafe ≤1/4-6 ≤2/≥7, lexicon'daki + çekimli (kök+ek)
kelimeye dokunmaz, ≤3 harf hedef alınmaz — "zayıf fiil aç" kuralı gevşemedi).
Entegrasyon TEK nokta: `voiceService._bestLocalParse` — her alternatifin onarılmış
varyantı aday havuzuna girer (tavan 8); onarım YALNIZ sıkı `>` confidence ile kazanır,
eşitlikte orijinal (fail-soft: mevcut davranış gerileyemez). Test: +14 (`asrRepair.test.ts`)
→ tam suite 1803 yeşil, guard 65/65, tsc temiz (ajan koştu + ana oturumda tsc/guard/asrRepair
bizzat tekrar doğrulandı). **Cihazda gerçek Vosk çıktısıyla DOĞRULANMADI.**

## ✅ ÖNCEKİ İŞ (2026-07-03): Settings stub sekmeleri gerçek verilere bağlandı

`548d3d4` — SettingsPage sahte verileri (Math.random CPU/TEMP, sabit "EvAg" Wi-Fi,
sahte OTA toggle, "Chromium 114/42°C/Certified") gerçek kaynaklara bağlandı; detay
PROJECT_STATE.md son bölümde. Yan bug fix: audioService kalıcı tercihler artık
AudioContext başlamadan da getter'larda doğru (reboot sonrası UI yanlış gösteriyordu).
Canlı Playwright ile doğrulandı; 1648 test + tsc yeşil. Cihazda APK testi YAPILMADI.

---

## 🔴 AÇIK SAHA BUG'LARI (2026-06-25 — gerçek araç testi, KANIT BEKLİYOR)

İki bağımsız bug saha testinde raporlandı. **Kök neden analizi yapıldı (kod okundu),
ama HAM LOG ALINMADAN düzeltme YOK** (araç o an yanımızda değildi). Saha test
prosedürleri hazır:

### 1. ParkingBrake yanlış (el freni inik ama app "çekili" gösteriyor) — ✅ ÇÖZÜLDÜ (2026-06-28, `5212c97`)
- **Durum:** ÇÖZÜLDÜ — cihazda kanıtlandı (araçta, canlı). Fix + APK kuruldu + screenshot doğrulandı.
- **GERÇEK kök neden (saha logcat ile kesin):** CarInfo `byte mHandbrake` bu araç için
  **0xFF (-1) = "veri yok"** sentinel'i geliyor (`elFreni=-1` diag'da görüldü). Eski
  `b.parkingBrake(mHandbrake != 0)` testi `-1 != 0 → TRUE` yapıp tell-tale'i kalıcı KIRMIZI
  kilitliyordu. Aynı sentinel `far` göstergesini de yanlış yeşil yakıyordu (`far=1`).
- **Saha doğrulaması:** Kapı sinyali (`can_door_show_state`) canlı 0↔1 oynadı (system-settings
  yolu sağlam), ama `hand_brake_state` el freni çekilince bile sabit 0 kaldı → bu araç el frenini
  HİÇBİR yoldan bildirmiyor. Tek kaynak CarInfo'nun bozuk -1 sentinel'iydi.
- **Fix:** `NwdCanClient.java` — `SENTINEL=(byte)0xFF` eklendi; tüm CarInfo boolean alanları
  (parkingBrake/doorOpen/seatbelt/headlights/wipers/esp/abs) `if (x != SENTINEL)` ile korundu →
  desteklenmeyen alan yazılmıyor, system-settings yolunu ezmiyor. Önce kırmızı EL FR + yeşil FAR,
  sonra ikisi de sönük (screenshot kanıtlı: tools/hbrake-app.png vs hbrake-fixed2.png).
- **NOT (regresyon):** Java parse katmanında olduğu için vitest kapsamı dışında; cihaz screenshot'ı
  kanıt. İdeal kilit bir Java unit test ister (mevcut infra'da yok).

### 2. K24 head unit TTS sessiz (telefonda ses var, head unit'te yok — safety dahil)
- **Durum:** AÇIK — TTS motor envanteri + chime/TTS gözlemi bekliyor.
- **Kök neden adayı (en güçlü):** Head unit ROM'unda **çalışan TTS motoru yok** →
  `ttsReady` hiç true olmuyor (CarLauncherPlugin.java:238-256) → `speak()` "TTS_NOT_READY"
  ile **sessizce reject** (CarLauncherPlugin.java:3064; JS catch yutuyor ttsService.ts:155).
- **Teşhis anahtarı:** Chime = Web Audio (safetyChime.ts), TTS = native Android TTS
  (CarLauncherPlugin.java:3060). **Chime çalıp TTS susuyorsa** → native TTS motoru/stream
  sorunu (en olası). İkisi de susuyorsa → genel ses çıkışı kısık.
- **İkincil aday:** `speak(text, QUEUE_FLUSH, null, …)` params null → varsayılan stream;
  bazı ROM'larda TTS stream'i kısık/route dışı.
- **▶ Prosedür:** `TTS_FIELD_TEST.md` — `pm list packages | grep tts`,
  `settings get secure tts_default_synth/locale`, logcat'te `TTS_NOT_READY`, chime/TTS gözlemi.
- **Kural:** TTS motoru yoksa kodla zorlama; stream'i logla kanıtlamadan değiştirme.

### 3. K24 harita takip / heading bug (harita sabit kalıyor + yön ters algılanıyor)
- **Durum:** AÇIK — araç logu bekleniyor. **Henüz patch YAPILMADI.**
- **Belirti:** Araç hareket ederken harita bazen sabit kalıyor (takip etmiyor), bazen
  yön ters algılanıyor (ileri giderken ikon/harita geri gidiyor gibi). İki ayrı kök.
- **Kök neden adayları:**
  - **A (ters yön):** Düşük hızda course-over-ground null kalıyor — `computeCourseDelta`
    4m eşiği (speedCore.ts:82) + `_prevForSpeed` her fix'te güncellenip yer değişimi
    BİRİKMİYOR (gpsService.ts:428) → ~14-29 km/h altında heading her tick null → donuyor
    (dönüş sonrası eski yön).
  - **B (sabit harita):** MiniMap `isDriving` HAM GPS hızına bağlı (`location.speed`,
    MiniMapWidget.tsx:293,297), fused speed (CAN/OBD) DEĞİL → head unit GPS hız vermeyince
    park dalına düşüyor, ~200m'de bir recenter (MiniMapWidget.tsx:325,333).
  - **D (tam ekran):** FullMapView nav-dışı follow kilidi — toparlama watchdog'u sadece
    nav ACTIVE/REROUTING'te (FullMapView.tsx:665-671); casual sürüşte follow kapalı kalabilir.
  - **C:** Park dalı bearing'siz recenter + heading null→0 kuzey → ters algıyı pekiştirir.
- **F (ELENDİ):** Dead Reckoning neden DEĞİL — yerel DR projeksiyonu NO-OP
  (`_startDeadReckoning` boş, gpsService.ts:714-719), `isDeadReckoningActive()` daima false.
  Marker/harita çift-rotasyonu da elendi (marker map-align + harita bearing=heading doğru).
- **▶ Prosedür:** `MAP_FOLLOW_FIELD_TEST.md` — 30s düz / 10s duruş / sağ-sol dönüş / tekrar
  düz senaryosu; coords.heading-speed null mı, effectiveCourse null mı, isDriving, isFollowing
  logları. Karar tablosu + minimal patch planı dosyada.
- **Kural:** log gelmeden DR/heading kapatma yok, follow zorla-açık yok, Safety/OBD/CAN'e dokunma yok.

> Üç dosyada da ("Raporlanacak sonuç") saha sonucunu doldur, sonra karar tablosuna göre izole patch.

---

## ⚡ EN GÜNCEL DEVİR (2026-06-24 — Safety Assistant Faz 1–3A, `9617664`)

**Safety Assistant** (CAN→sürücü güvenlik uyarısı) **izole** katmanı eklendi. Commit
`feat(safety): add vehicle safety overlay` (push EDİLMEDİ). Standart: `SAFETY_ASSISTANT_STANDARD.md`.
Kod: `src/platform/safety/*` + `src/components/safety/SafetyOverlay.tsx`.

**BİTEN (commit'li; ana oturumda tsc/test/build BİZZAT doğrulandı — ajan rapor sayılarına güvenilmedi):**
- Faz 1 `SafetyRuleEngine` (saf/durumsuz, 10 kural) · Faz 2 `SafetyAlertQueue` (debounce/repeat/mute/öncelik)
- Faz 2.5 bridge (`safetyStateMapper` + `useSafetyAlerts`) · Faz 2.6 `safetyOutputsEqual` + `safetyTicker`
- Faz 3A `SafetyOverlay` UI (App.tsx mount; K24/Chrome 64-78 uyumlu; reverse → `ReversePriorityOverlay`)
- Test: engine 78 / queue 24 / bridge 31 / tick 21 / overlay 8 yeşil; guard 45 korunur.

**HENÜZ YOK / SIRADAKİ:**
- ▶ **Faz 3B — VoiceSafetyAnnouncer + ducking + mute** (Sustur butonu + `useSafetyMute` hook).
  `SafetyQueueOutput.voiceAnnouncementAlert` zaten hazır; izole `<SafetyAnnouncer />` bağlanacak.
- **CAN/native canlı bağlantı YOK:** `signalsAvailable` profile/handshake'e bağlanmalı; gerçek araç
  CAN akışı hâlâ açık iş (bkz. aşağıda OBD/CAN devir notu). Sinyal yokken kurallar sönük (yanlış alarm yok).
- Voice katmanında Faz 2.6 `safetyOutputsEqual` varsayımı (her ses öncesi null tick) cihazda test edilmeli.

---

## 0. ⚡ EN GÜNCEL DEVİR (2026-06-14 akşam — canlı cihaz oturumu, agent değişimi)

**Cihaz:** K24/NWD (K2401, ceres_b3), araç içinde, ADB AĞ üzerinden bağlanıyor.
- adb yolu: `C:\Users\selim\AppData\Local\Android\Sdk\platform-tools\adb.exe`
- Bağlan: `adb connect 10.185.22.216:5555` (aynı WiFi; cihaz uyursa/ACC düşerse düşer, tekrar bağlan).
- IP değişebilir → cihazda Ayarlar > Cihaz hakkında > IP. WiFi MAC 88:00:33:77:d1:d5.
- Gerçek Android 10 (ekranda "15" maskeli). ABI armeabi-v7a (32-bit).
- **APK build:** `gradlew` PATH'te yok + JAVA_HOME yok. Şöyle derle:
  `$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; $env:PATH="$env:JAVA_HOME\bin;$env:PATH"; cd android; .\gradlew.bat assembleDebug`
  APK çıktısı: `C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk` (buildDir C:\Temp'e yönlü, path-uzunluğu için).
  Kur: `adb -s 10.185.22.216:5555 install -r <apk>`. (Native-only değişiklikte cap sync gerekmez; web değişirse `npm run build && npx cap sync android` önce.)

**Bu oturumda BİTEN (commit'li):**
1. ✅ **Siyah ekran (parlaklık)** `2720346` — `autoBrightnessService.ts` `minNight` 15→40. Cihazda doğrulandı (sbrt 0.149→0.4). Regresyon kilidi var.
2. ✅ **OBD/CAN bağlantısı** `57fbe77` + teşhis `03c5627` — `NwdCanClient.java` yazıldı, CarLauncherPlugin'e wire (startCanBus/setCanSnifferEnabled). NWD resmî outer CAN SDK'ya BAĞLANIYOR: bind ACTION_CAN_SERVICE → initSdkCfg("nwdthirdapp","d39df3d908cf7136227987e37d5b2c7d",(byte)0,...) → addCarInfoCallBack(tx17)+addCanCarInfoCallBack(tx27)+addCallBack4Outerface(tx3). HEPSİ BAŞARILI.

**OBD'de KALDIĞIMIZ NOKTA (açık iş #1 — devam):**
- `onDistributeCarInfo` (callback kod 2) **kayıt anında 1 KEZ** tetiklendi (snapshot): `hız=0 devir=-1 yakıt=-1 soğutma=0 vites=0 kapı=0 acc=0 elFreni=-1 far=1`. Yani link + initSucess + parse ÇALIŞIYOR.
- **AMA canlı güncelleme YOK:** kapı/far/gaz uyaranlarıyla 14-20sn boyunca ne yeni CarInfo ne ham veri geldi → `distribution([B])` (protokol yöneticisi ham CAN beslemesi) bu araç protokolü için çağrılmıyor.
- Snapshot değerleri şüpheli (acc=0 motor açıkken; çoğu -1) → ya bayat snapshot ya bu protokol o sinyalleri decode etmiyor ya parcel hizalama kayması (kapı aç/kapa ile `kapı=` değişmeli — TEST EDİLEMEDİ, kullanıcı yapamadı).
- **▶ KULLANICIYA SORULACAK (kaldığımız tam soru):** OEM kendi ekranında (CanSetting `com.nwd.can.setting` MainActivity / MyCar) CANLI veri var mı + araç modeli SEÇİLİ mi?
  - OEM canlı gösteriyorsa → protokol aktif ama ROM dış-SDK'ya akıtmıyor → DENE: (a) periyodik unregister+register ile snapshot poll (mCarInfo cache taze mi?); (b) `distribution([B])` çağıranlarını incele (tools/can-re), bu aracın protokol yöneticisi besliyor mu.
  - OEM de boş / araç seçili değil → önce CanSetting'den doğru araç (FIAT Doblo) seçtir → sonra tekrar dene.
- **Teşhis logları GEÇİCİ** (NwdCanClient'ta `_lastCbLogMs`, `_outerCb` ham probe, parseCarInfo CarInfo logu) — çözülünce KALDIR.
- Tam teknik referans: `K24_CAN_OBD_FINDINGS.md` (transaction kodları, CarInfo 142-alan parcel sırası, kimlik, descriptor'lar). RE artefaktları `tools/can-re/` (gitignore'da; CanAllInOne.apk + dexdump çıktıları + carinfo_parcel_order.txt).

**ROTASYON (açık iş #2 — yarım):**
- `8e2f84b` — MainActivity'de WebView native 90° rotasyon (sh>sw iken landscape boyut + setRotation(90)). Layout LANDSCAPE oldu AMA hâlâ 90° YAN duruyor (kullanıcı "yatay oldu düzelt" dedi).
- Donanım framebuffer'ı panele 90° basıyor; setRotation(90) yön YANLIŞ olabilir. **▶ DENE: setRotation(90)→setRotation(270)** (MainActivity.applyHeadUnitLandscapeRotation), derle/kur, ekrana bak. 270 de yanlışsa 180/0 dene. Android nav bar fiziksel SOLDA görünüyor (framebuffer-bottom→sol). Gözle iterasyon şart (screencap yanıltıcı — framebuffer'ı verir).

**Küçük not:** `capacitor.config.ts` `webContentsDebuggingEnabled:true`+`loggingBehavior:'debug'` teşhis için açık → paylaşım/prod APK öncesi isDev'e al.

---

## 1. Yeni Ajan İlk Ne Okumalı (sıra önemli)

1. **`CLAUDE.md`** — proje kuralları, dil kuralı (Türkçe zorunlu), onay isteme kuralı,
   automotive/V8 standartları, lisans kuralı. OVERRIDE eder.
2. **`AI.md`** — STABILIZATION MODE; "bir bug = bir fix", multi-system refactor YASAK,
   atomik patch, partial logic bırakma. Çakışmada `AI.md` mutlak öncelik.
3. **`PROJECT_STATE.md`** — şu an neredeyiz (branch, son commit, build/test, bekleyen iş).
4. **`ROADMAP.md`** — ne yapıldı / ne yapılacak / ne YAPILMAMALI + öncelik sırası.
5. **`ARCHITECTURE.md`** (manifesto) + **`ARCHITECTURE_DATAFLOW.md`** (somut veri akışı,
   kod referanslı).
6. Bu dosya (`HANDOFF.md`).

---

## 2. Son Yapılan Değişiklikler (özet)

### 🔴 2026-06-14 — K24 CİHAZ SAHA OTURUMU (DevTools profili) — branch `fix/k24-perf-webgl-bundle-rotation` `44c6372`

> **Bu oturum gerçek K24 head unit'te canlı yapıldı (ADB + Chrome DevTools).**
> Branch henüz `main`'e MERGE/PUSH EDİLMEDİ. Cihazda şu an bu branch'in temiz APK'sı kurulu.

**Cihaz/bağlantı gerçekleri (sonraki ajan bunları kullansın):**
- Cihaz: **K24** (model `K2401`, `ceres_b3`, Android 15, 6GB/64GB), GPU **PowerVR Rogue GE8300** (Allwinner sun50iw10p1, 32-bit armeabi-v7a), WebView **Chrome 101**.
- **USB-ADB ÇALIŞMAZ** (host portu). Yol: aynı WiFi + `adb connect <ip>:5555` (port açık). IP DHCP (Ayarlar→About car device→IP); bu oturumda 10.185.22.216, PC 10.185.22.209.
- `adb`: `C:\Users\selim\AppData\Local\Android\Sdk\platform-tools\adb.exe`. JDK (gradle): `C:\Program Files\Android\Android Studio\jbr` (gradlew JAVA_HOME ister). APK build çıktısı **`C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk`** (yol kısaltma redirect). `gradlew.bat -p <android>` ile, root'tan `gradlew` PATH'te yok.
- Detay: hafıza `project_k24-adb-network.md`, `project_k24-perf-rootcause.md`.

**ÇÖZÜLEN + CİHAZDA DOĞRULANAN (hepsi commit'li):**
- **perf(map) — EN BÜYÜK KAZANIM:** `DrawerShell` çocuklarını KAPALIYKEN de mount tutuyor (sadece translateY/opacity). `TrafficPanel` canlı MiniMapWidget (MapLibre WebGL) içerdiğinden, traffic drawer kapalıyken bile 2. WebGL context ekran-dışında (y=1333) yaşıyordu → PowerVR render-target (8) dolup context lost/restore thrash → ~7fps, %100 jank. FIX: `DrawerPanel.tsx` TrafficPanel'i yalnız `drawer==='traffic'` iken mount eder. **Ölçüm: mapCount 2→1, fps ~7→~15, JS thread idle %0→%22, WebGL thrash profilden gitti.**
- **fix(build):** Vite8 + `@vitejs/plugin-legacy@8` modern bundle'a **`import.meta.resolve`** (Chrome 105+) gömüyordu (hem HTML tespit script'i hem entry chunk guard'ı) → Chrome 101'de Bootstrap Crash → ağır legacy ES5/SystemJS'e düşüş (9.7sn UI freeze→SAFE_MODE). FIX: `vite.config.ts` `fixLegacyModernDetection()` (transformIndexHtml post + chunk generateBundle ile probe sil) + `build.modulePreload:false`. Doğrulandı: modern bundle Chrome 101'de native çalışıyor.
- **perf(map):** MiniMap↔FullMap devir-tesliminde orphan WebGL context serbest bırakılmıyordu → `freeOrphanMapContext` (MapCore.ts) + MiniMapWidget cleanup düzeltmesi.
- **perf(map):** `detectWeakGpu` PowerVR/Imagination tanır (`isWeakRendererString` saf fn) + regresyon kilidi.
- **perf(can):** `K24CanBridge` var-olmayan ContentProvider'ı kalıcı kara listeye alır (234 başarısız sorgu/3sn + "Failed to find provider info" seli bitti).
- **feat(ui):** Alt dock büyütüldü — lucide ikonları `--dock-icon`'a bağlandı (`dock-premium.css` `.dock-chip svg`), taban+breakpoint ölçüleri (`index.css`, `theme-layouts.css`). **Bukalemun (ChameleonScaler) korundu** — ona DOKUNMA.

**AÇIK İŞLER (sonraki ajan — öncelik sırası):**
1. **Rotasyon kalıcı değil (P1):** Bu ROM uygulamanın manifest yön talebini (`sensorLandscape`) YOK SAYIYOR; ekran her açılışta dikey (ROTATION_0) başlıyor, panel native portrait (720×1280, ro.boot.nwd.orientation=90). Tek çözüm sistem kilidi `settings put system accelerometer_rotation 0` + `user_rotation 1` (yatay=90) + app taze başlat — AMA ROM her açılışta auto-rotate'i sıfırlıyor → manuel adb her seferinde gerekiyor. **Kalıcı fix: app açılışta `WRITE_SETTINGS` ile (izni var) rotasyonu kendisi kilitlesin** (CarLauncherPlugin/MainActivity native). Şu an cihaz manuel kilitli (yatay).
2. **~15fps → 30+fps (P2):** Tek MiniMap statikken bile sürekli GPU'da çiziliyor (webview renderer meşgul, maplibre draw/coveringTiles). Render-on-demand (statikte repaint durdur) + home kapatıldığında MiniMap context-free (MainLayout'ta line ~344 niyet var ama tetiklenmiyor) + dönen marker güncellemesini kıs. PowerVR GE8300 alt segment — tavan var.
3. **CAN verisi akışı (P3):** Köprü bağlanıyor (UART /dev/ttyS1 + CanService bind) ama seansda decoded sinyal (hız/devir) dispatch'i GÖRÜLMEDİ — araç PARK halindeydi (motor kapalı→canlı veri yok normal). **Motor çalışırken doğrulanmalı.** OBD ayrı: BLE ELM327 dongle gerekir, takılı değildi.

**DOĞRULAMA YÖNTEMİ (DevTools CDP — sonraki ajan tekrar kullanabilir):**
`webContentsDebuggingEnabled` GEREKİR (şimdi prod'da `isDev`→KAPALI; teşhis için geçici `true` yap, SONRA geri al). Yol: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` → `http://localhost:9333/json/list` → Node (global WebSocket) ile CDP `Runtime.evaluate`/`Profiler.start/stop`. Geçici scriptler `%TEMP%\cdp.cjs`, `profile.cjs`, `expr*.js`. CPU profili + `document.querySelectorAll('.maplibregl-map').length` (mapCount) + gfxinfo jank en faydalı sinyaller.

⚠️ **`capacitor.config.ts` debug bayrakları bu oturumun sonunda `isDev`'e GERİ ALINDI** (devtools/log prod'da kapalı). Yeniden teşhis için geçici açıp tekrar kapat.

- **Cockpit teması silindi (2026-06-12, `7bc1b07`):** Mercedes/Audi ile aynı desen.
  CockpitLayout.tsx silindi; useCarTheme LegacyTheme/VALID/migrate (v2→v3,
  cockpit→expedition) + NewHomeLayout/SettingsPage/website ThemeStudio temizlendi.
  Kapsam dışı: themeLayoutEngine/MagicCardVariant/dead CSS/K24 paket-adı. tsc EXIT 0,
  1231/1231. Aktif temalar: expedition·horizon·tesla·pro·sunlight. **Cihazda
  doğrulanacak.**
- **Mercedes/Audi temaları silindi (2026-06-12, `f37c160`):** 2 layout dosyası
  + tüm TS referansları kaldırıldı; persist v1→v2 migration mercedes/audi→
  expedition (gerçek alan `theme`, string-cast; + onRehydrateStorage VALID ikinci
  ağ → beyaz ekran yok). Voice cycle/perf test/SettingsPage/website ThemeStudio/
  FEATURES+MARKETING temizlendi. Kapsam dışı (ayrı sistem): ThemePack/
  themeLayoutEngine, MagicCardVariant, dead CSS. tsc EXIT 0, 1231/1231. Detay:
  PROJECT_STATE "Mercedes + Audi". **Cihazda doğrulanacak (mercedes/audi
  kullanıcısı boot'ta expedition'a düşmeli).**
- **Araç-tipi farkındalıklı UI+AI (2026-06-12, `d6b8fdb`):** EV'de dashboard
  RPM/SICAKLIK/YAKIT → MOTOR/AKÜ ISI/ŞARJ (NewHomeLayout SpeedCard; useOBDState
  reaktif, profil değişince anında). Header Menzil ⛽→⚡ + obd.range. Companion
  prompt'a araç-tipi yetenek notu (EV: "RPM/yakıt YOK, uydurma"). Kapsam dışı
  (kodda yok): transmission/GearPosition, BoostPressure widget'ı. +2 test →
  1231/1231. Detay: PROJECT_STATE "Araç-Tipi Farkındalıklı UI". **Cihazda
  screenshot ile doğrulanacak.**
- **Telefon dock kompaktlaştırma (2026-06-12, `4ab262b`):** telefonda (w<600px)
  alt dock fazla yer kaplıyordu. `theme-layouts.css` `@media (max-width:600px)`
  bloğuna `--dock-h:64px !important` + `--dock-icon:24px` (portrait 70px'i ezer).
  Head unit ≥800px etkilenmez; dokunma hedefi 44px korundu. Task premisleri
  düzeltildi (gerçek değişken adları --dock-h/--dock-icon; 1.5rem padding yok;
  80px = HD head unit breakpoint, tema override değil). Detay: PROJECT_STATE
  "Telefon Dock". **Cihazda screenshot ile doğrulanacak.**
- **OBD persistence chain polish (2026-06-12, `b51e75a`):** WebView crash/boot
  sonrası snapshot'tan hydrate edilen OBD verisi UI'da görünmüyordu —
  `_buildPatch` `source` taşımıyordu → `_current.source` 'none' kalıp gösterge
  boşta takılıyordu. (1) `_buildPatch` geçerli alan kurtarınca `source: 'real'`
  ekler (tüm alanlar bayatsa BOŞ kalır). (2) init source otomatik 'real'. (3)
  async hydration guard'ı `_lastRealDataMs` (canlı veri) ile ayrıldı + computed
  yakıt alanları (`fuelRemainingL`/`estimatedRangeKm`) `computeFuelMetrics` ile
  recompute (sync yol setObdFuelConfig ile zaten çalışıyordu). +5 test →
  1229/1229. Detay: PROJECT_STATE "OBD Persistence Chain". **Cihazda doğrulanacak.**
- **Phase P — Deep Intelligence Co-Pilot (2026-06-12, `5abcd32`):** asistan
  "komut dağıtıcı"dan bağlam-farkında yardımcı pilota. (Madde 1 wake + madde 3
  SystemBoot `0348b9b`'de, 2.5s fallback `734d825`'te zaten tamamdı — redo yok.)
  Yeni: beyin prompt'u Contextual AI Partner çerçevesi (KOMUT ROBOTU DEĞİL /
  World View / YARDIMCI PİLOT; Single Brain kararı korundu) · World View
  enjeksiyonu yakıt+sıcaklık YANINDA **yolculuk süresi** (interpretTripDuration)
  · genel kelime ASR/niyet talimatı ("birez muzuk ac"→"biraz müzik aç") · park
  halinde derin/sürüşte kısa ton. `tripLogService.getTripSnapshot()` eklendi
  (onTripState immediate-emit canlı trip vermiyordu). +2 test → 1224/1224.
  Detay: PROJECT_STATE "Phase P". **Cihazda doğrulanacak.**
- **Wake word entegrasyonu (2026-06-12, `0348b9b`):** "asistan uyanmıyor" iki
  kök neden. (1) Wake yalnız `useLayoutServices` React hook'undaydı (mount'a
  bağlı, churn'lü) → YENİ `startWakeWordService()` modül-düzeyi `useStore`
  aboneliği, SystemBoot `_wave4` + cleanup; eski hook KALDIRILDI (çift
  orkestratör = çift dinleme oturumu riski). (2) Grammar/polling Vosk modeli
  preload (boot+30s, 20-40s yüklenir) bitmeden başlayıp "model yok" hard-fail
  ediyordu → `notifyVoskModelReady()` kapısı: native start model hazır olana
  dek ertelenir; SystemBoot preload çözülünce (eski APK'da hemen) açılır,
  backstop 75s. Silent Handover + zero-leak korundu. +9 test → 1222/1222,
  tsc+lint+build temiz. Detay: PROJECT_STATE "Wake Word Entegrasyonu".
  **Cihazda doğrulanacak.**
- **Single Brain mimarisi tamamlandı (2026-06-12, `734d825`):** sesli asistan
  "Gemini-first tek beyin". voiceService refactor'u (kritik bypass →
  Gemini-first → graceful fallback) zaten yazılmıştı; eksikler tamamlandı:
  (1) `timeoutMs` ÖLÜ parametreydi — voiceService 2.5sn karar bütçesi
  gönderiyordu ama `CompanionChatOpts`'ta alan yoktu, `askCompanionBrain` 6sn
  sabit timeout kullanıyordu → "2.5sn'de timeout→fallback" fiilen çalışmıyordu;
  `timeoutMs?` eklendi + fetch signal'ına clamp'li bağlandı. (2) BRAIN_SYSTEM_
  PROMPT "TEK BEYİN + AKSİYON mu CHAT mi" açık vurgusu (No Dual Response).
  (3) `CRITICAL_VOICE_TYPES`=volume_up/down+stop_music yalnız 1.0'da yerelde,
  gerisi beyne. (4) `companionConversationLoop` testleri eski "yerel dispatch"
  mimarisinden Single Brain ACTION'a güncellendi (+`pause_music`→`stop_music`).
  No-Dead-Ends reask'a dokunulmadı (test-kilitli). Suite 1213/1213, tsc+build
  temiz. Detay: PROJECT_STATE "Single Brain". **Cihazda doğrulanacak.**
- **Navigasyon saha fix paketi (2026-06-12, `0fcac44`):** sürüş testi raporu
  üzerine — rota ilerlemesi mapStyleReady kapısından çıktı (donma kökü),
  kat edilen rota kırpma + kademeli sesli yönlendirme (500m/200m/şimdi)
  EKLENDİ, nav kamera watchdog'u, rAF bayat route closure fix (turnDist),
  hız levhası veri yoksa çizilmez. Suite 1213/1213. **Cihazda doğrulanacak.**
- **Head Unit "Latency Death" fix paketi (2026-06-12, `5687d9a`+`0cfd729`):**
  kullanıcının "her butona basınca 5 sn" şikayetine kök neden paketi.
  (1) thermalWatchdog motor suyu sıcaklığını cihaz ısısı sanıp KALICI L2/L3
  termal kısıt uyguluyordu → engineTemp zincirden çıktı. (2) Açılışta adres
  yokken otomatik BT INQUIRY kaldırıldı (ilk bağlantı modal'dan). (3) lite
  obdListenerDebounce 10s→1.5s, zombie PING 10s→30s, Vosk preload 8s→30s.
  (4) Kalıcı wake Vosk thread'leri THREAD_PRIORITY_BACKGROUND (UI ile
  yarışmaz). Suite 1213/1213 + Java compile temiz. **Cihazda doğrulanmadı —
  cihazdaki APK'da fix'ler YOK, yeni APK kullanıcı isteyince.**
- **Companion Faz 5 Native Refleksler / Grammar Wake (2026-06-11,
  `7c674dc`):** wake word native kalıcı grammar thread'ine
  taşındı (Vosk yalnız wake sözleri + [unk]; runVoskListening'e dokunulmadı).
  Partial sonuçla <200ms refleks (`wakeWord` event), pasif modda duck/audio-
  focus YOK (müzik tam kalite), half-duplex (TTS/aktif STT'de mikrofon
  bırakılır — kendini duymaz). wakeWordService: grammar→eski döngü fail-soft.
  +7 test → 1213/1213; Java compile OK. Detay: PROJECT_STATE "Faz 5".
  **Cihazda doğrulanmadı.**
- **Companion Faz 4 Proaktif Motor + Uyku Önleyici (2026-06-11, `2939055`):** YENİ `companionEngine.ts` (60 sn PromptScheduler) +
  SystemBoot Wave 4 named cleanup. Tetikler: yakıt <50 km (güvenlik, medyada
  bile) · gece+sessizlik uyku sorusu (açık uçlu) · boot selamlaması (1 kez) ·
  mola · 'sik' yolculuk yorumu. Gate: PROTECTION+/sesli oturum/voicePaused/
  sessiz kişilik → sus. Bütçe az=45dk/normal=20dk/sık=10dk. Proaktif konuşma
  Gemini'ye gitmez (şablon+yorumlayıcı). +21 test → 1206/1206. Detay:
  PROJECT_STATE "Faz 4". **Cihazda doğrulanmadı.**
- **Companion Faz 3 Şive Dostu Birleşik Beyin (2026-06-11, `33b61ec`):** kişilik beynin tepesinde (profesyonel=MAKAM ASİSTANI,
  samimi=MAHALLE ARKADAŞI); şive talimatı (birez/kurban/uşağum = karakter
  ipucu, niyet cımbızla çekilir); No Dead-Ends iki katman (prompt "ASLA
  ÇIKMAZ YOK" + kod backstop: online çöküş + offline eşleşme yok →
  kişiliğe uygun tekrar-rica; offline'da null korunur, eski zincir bozulmaz).
  Test +5 → 1185/1185, tsc temiz. Detay: PROJECT_STATE "Faz 3".
- **Companion Faz 2 Bağlamsal Zeka (2026-06-11, `a0a749d`):** `companionContext.ts` yorumlayıcıları proaktifleşti — yakıt
  menzili <100 km'de rota teklifi, gece+2saat yorgunlukta somut eylem
  teklifleri (cam/kahve/dinlenme yeri), soğuk motorda samimi uyarı.
  `companionChatProvider.ts`: bağlam "SÜRÜCÜNÜN MEVCUT DURUMU" başlığıyla
  + kritik durumda kendiliğinden dile getirme talimatıyla enjekte edilir.
  Hitap (kanka vb.) yorumlayıcılara gömülmedi — persona katmanının işi.
  Companion testleri 92/92, tsc temiz. Detay: PROJECT_STATE "Faz 2".
- **Wake uyanmama + müzik isteği saha fix (2026-06-11, `45facfa`):** Vosk
  "hey" tanımıyor → ey/hay/hei varyantları; sessizlikte 3sn sağır boşluk →
  250ms; paralel döngü bug'ı → jenerasyon token; pasif dinleme müzik duck'ı
  kapatıldı (native `duckWhileListening` opsiyonu); çekimli müzik fiilleri
  ("açar mısın/açsana/koy") + fiilsiz istekler ("X'ten müzik") artık
  play_music_query; companion müzik kapısı (sohbet biyografi anlatamaz);
  gain 2.5→3.0, wake 3.2/20s; lastHeard teşhisi. Detay: PROJECT_STATE
  "Wake Uyanmama + Müzik İsteği". **Cihazda doğrulanmadı.**
- **Asistan adı merkezli wake word (2026-06-11, `eb8ad25`):** kullanıcı
  asistana hangi adı verirse o adla uyanır (ad=Mavi → "Mavi"/"Hey Mavi");
  uyanma şekli seçici (name/hey_name/both/custom); ÜRÜN KARARI: varsayılan
  ad 'Mavi' (persist v15 migration); tetiklenince kısa selamlama → TTS
  bitince aktif dinleme; PROTECTION/CRITICAL'da tetik yutulur; pasif
  beklemede "Dinliyorum" UI yok; companion wake artık useLayoutServices'e
  WIRE EDİLDİ (eskiden ayar vardı, motor bağlı değildi). Detay:
  PROJECT_STATE "Asistan Adı Merkezli Wake Word". **Cihazda doğrulanmadı.**
- **Companion sürekli sohbet döngüsü (2026-06-11, `cffe182`):** P0 saha UX —
  cevap sonrası mikrofona tekrar basma zorunluluğu kalktı. Akış: dinle →
  transcript → (Gemini >800ms ise "düşünüyorum") → cevap TTS → TTS bitince
  KISA pencereyle (8s, `followUpListenMs`) otomatik yeniden dinleme.
  Döngü YALNIZ companion sohbet modunda; araç komutları döngü kurmaz;
  "tamam/sus/kapat/sonra konuşuruz" sessizce kapatır; PROTECTION/CRITICAL
  kapatır; sessizlikte idle (tekrar konuşma yok). Prompt doğallaştı
  ("8 kelime" kuralı kalktı; sürüşte 2-3 kısa cümle; token 100/160).
  15 yeni test (`companionConversationLoop.test.ts`). **Cihazda doğrulanmadı.**
- **Telemetri görünürlük (2026-06-11, `60d92e4`):** admin incidents boştu —
  eşlenmemiş cihazda pushVehicleEvent her event'i sessiz yutuyordu. Artık
  throttle'lı warn + sayaç + `not_paired` snapshot sonucu + UI yönlendirmesi.
  Kök neden: cihaz eşleme YALNIZ Ayarlar → Mobil Bağlantı'dan; **sahada önce
  eşleme yapılmalı**, sonra incidents akışı doğrulanmalı.
- **DTC tarama düzeltmesi (2026-06-11, `209046f`):** Arıza Teşhisi "OBD okuyucu
  yanıt vermiyor" — native `readDTC/clearDTC` hiç yoktu, her tarama reject'ti.
  ElmProtocol Mode 03/04 + elmLock (polling ile serileşme) + plugin metotları.
  Detay: PROJECT_STATE "DTC Tarama". **Cihazda doğrulanmadı.**
- **Companion AI-FIRST Commit 3 (2026-06-11, `03b7e83`):** kullanıcı onaylı yön
  değişikliği — keyword sohbet ana yol değil. Companion açıkken komut olmayan
  her cümle önce Gemini'ye (kişilikli sohbet prompt'u); offline'a yalnız net/key
  yok + hata/timeout + 429 (soğuma) durumlarında düşülür. Router voiceService'te
  (parser ≥0.7 → komut yolu aynen; companion kapalı → eski zincir bit değişmeden).
  Ham OBD prompt'a girmez — Commit 2 yorumlayıcıları girer (yapısal test).
  `voice_route` tanı aşaması eklendi. Detay: PROJECT_STATE "Companion AI" +
  doküman §9 revizyonu. **Cihazda doğrulanmadı.**
- **Parser hassasiyet düzeltmesi (2026-06-11, `d55f8e2`):** "nasılsın" →
  "Araç verisi alınamıyor" saha hatası. `commandParser.scorePattern` 5 ayrı
  gevşeklik tek seferde kapatıldı (kısa kalıp tam-kelime, ters yön startsWith/
  çok-kelimeli, Tier-2 prefix, fuzzy min 4, soru edatları filler). Detay:
  PROJECT_STATE "Parser Hassasiyet". 9 regresyon testi. **Cihazda doğrulanmadı.**

- **Companion AI "Yol Arkadaşım" V1 başladı (2026-06-11, `8cceab8`+`0c478e0`+
  `c07ac1a`):** mimari doküman (`docs/COMPANION_AI_ARCHITECTURE.md` — 7
  commit'lik plan) + Commit 1: ayar/kimlik modeli (`companionIdentity.ts`
  sanitize+fallback, useStore v14, Settings paneli, 40 test) + Commit 2:
  `companionContext.ts` saf yorumlayıcılar (yakıt/menzil/mola/yorgunluk/
  varış/sıcaklık; servis import'u SIFIR, imkânsız veri→null fail-soft,
  55 test). **Kurallar:** ayarlar yalnız `resolveCompanionIdentity`
  üzerinden okunur; Gemini prompt'una ham veri değil yorum girer.
  **Sırada:** Commit 3 — companionPersona (4 kişilik + şablonlar +
  tekrar-önleme).
- **Duster saha düzeltmeleri (2026-06-11, `901edf5`+`67d0a71`+`e191bb1`):** gerçek
  araç (Renault Duster, eski WebView Chrome 64-78) üç saha hatası:
  1. **Dashboard çöküşü + görünmeyen dock** — inline modern CSS (clamp/min/
     aspect-ratio/inset/dvh) eski WebView'de düşüyor → grid tek kolona çöküyor,
     kök 100dvh'siz auto yüksekliğe iniyordu. Çözüm: `src/utils/cssCompat.ts`
     (CSS.supports tespiti) + Expedition/Horizon fallback şablonları + harita
     minHeight:200 + MainLayout VIEWPORT_H. Snapshot'a `device` bloğu eklendi
     (webViewVersion vb. saha teşhisi). Gün/gece: boot'ta ilk 2 dk 5 sn'lik
     hızlı saat kontrolü (geç RTC senkronu).
  2. **YouTube araması boş** — Piped instance'larının 4/5'i öldü; Invidious
     yedek havuzu eklendi (arama + ses akışı), kapaklar i.ytimg.com'dan.
  3. **Mikrofon "Dinliyorum"da takılı** — ilk basışta Vosk unpack+load 20-40 sn
     (JS failsafe 14 sn'de pes ediyordu). Çözüm: boot+8sn'de `preloadVoskModel`
     (SystemBoot Wave 4) + native istek kuyruğu (reddetme yok). **Cihazda
     doğrulandı: mikrofon çalışıyor (kullanıcı teyidi).**
- **OTA v1 TAMAM (2026-06-10, 7 commit `3f9b456`…`fb4b51d`):** sürüm gerçeği →
  Supabase şema → publish script → native indirme/doğrulama → install gate →
  orkestrasyon servisi (SystemBoot Wave 4 + Settings kartı) → telemetri.
  Detay: PROJECT_STATE "OTA v1" bölümü + `docs/OTA.md`. **Saha/deploy bekliyor:**
  `supabase db push` + gerçek publish + K24 uçtan uca (CHECKLIST §4c).
- **Güvenlik P0 (2026-06-10, `7075813`):** cross-channel nonce replay kapandı
  (JS↔Native tek store, `checkCommandNonce` köprüsü) + push-notify fonksiyon-içi
  auth (service_role, fail-closed). Cihaz/deploy doğrulaması CHECKLIST §4b.

- **Test Altyapısı T1–T4 (2026-06-09, HEAD `b453cf9`):** araçsız/donanımsız deterministik
  test serisi. Hepsi YALNIZ `src/__tests__/` altında — production/native hot-path'e
  DOKUNULMADI, bundle'a sızmıyor (tree-shake teyitli). Suite: **635/635** (50 dosya;
  önceki 482).
  - **T1** OBD simülatörü (`sim/obdSimulator.ts`) `206b41a` · **T2** CAN frame senaryoları
    `52a04c4` · **T3** kaynak-sızıntı leak harness + cleanup testleri (`sim/leakHarness.ts`,
    `cleanup.*.test.ts`) `ca8024f`/`9a41c73` · **T7** low-end/runtime simülatörü
    (`sim/runtimeSimulator.ts`) `978aa2a`.
  - **T4 Soak (sanal-saat, 8–24h) — 8 commit:** `sim/soakHarness.ts` (fake timer+Date+
    performance, gerçek sleep YOK) `473893a`; safeStorage write-throttle `79d8b11`; OBD
    reconnect/backoff (real `obdRetryPolicy` modeli) `ac0295e`; runtime zombie/thermal
    (real `AdaptiveRuntimeManager`) `a6646e1`; telemetry+connectivity (real + in-memory
    IDB shim) `55ab621`; remoteCommand ACK-timeout/eviction (real `_awaitHardwareAck`)
    `57da3a9`; cross-service 24h aggregate leak `6b75e7f`; **manuel K24 saha prosedürü**
    `docs/SOAK_MANUAL_K24_CHECKLIST.md` (`e98bd23`, PSS sampler fix `b453cf9`).
  - Sanal testler MANTIK/sözleşmeyi kapsar; gerçek RAM-PSS/A2DP/eMMC-aşınma/SoC-ısı/
    saat-sıçraması **manuel checklist'e** ayrıldı (CHECKLIST §0 ayrım tablosu). ACTIVE_TASK
    P1 soak/eMMC/backoff maddeleri büyük ölçüde bu seriyle karşılandı.
- **Faz 1 GPU yükü azaltma** (commit 2fbbd57): blur guard + ambient blob koşullu
  render + MiniMap WebGL unmount. Salt görsel/koşullu render.
- **BLE GATT transport** (04d0ef2), **OBD protokol cycle**, **nav kanonik hız** (99abf60),
  **Vosk release keep** (ca0f345), **McuEventSniffer crash fix** (ef20108).
- **Commit edilmemiş:** MainLayout.tsx safeStorage + setTheme; tüm android native dosyaları
  (`M`). Detay PROJECT_STATE.md'de.
- **Çöp kod analizi** (2026-06-06, rapor-only, silme YOK): knip ile ölü-kod/paket taraması.
  Gerçek adaylar (eski layout sistemi, traffic/*, diagnostic/*) ve false-positive kümeleri
  PROJECT_STATE.md'de. **Yan bulgu:** `useSABDirectUpdate` ÖLÜ → `ARCHITECTURE_DATAFLOW.md`
  §1 düzeltildi (aktif hız akışı Zustand üzerinden).
- **Mühendislik süreç sistemi** (2026-06-06): `RELEASE_CHECKLIST.md`, `CONTRIBUTING.md`,
  `docs/adr/0001-0004`, `.github/pull_request_template.md`, `docs/TEST_MATRIX.md`,
  `docs/FEATURE_FLAGS.md` eklendi. Release öncesi RELEASE_CHECKLIST'i, yeni iş öncesi
  CONTRIBUTING'i izle.

---

## 3. DOKUNULMAMASI Gereken Dosyalar / Alanlar

- **`src/platform/security/blackBoxService.ts`** — 10Hz örnekleyici (SAMPLE_INTERVAL=100,
  satır 54). Kaza kara kutusu, yüksek risk. Faz 2 kapsamı DIŞINDA.
- **Güvenlik servisleri** — `SafetyBrain` (fault tracking/feature disable), blackBox.
  İş mantığına yalnızca açık talep + risk analizi ile.
- **`src/components/map/FullMapView.tsx`** — navigasyon/harita zırhı (map mutex, route
  survive). `AI.md` MAP/NAVIGATION kuralları geçerli; dikkatli ol.
- **`VehicleSignalResolver` SAB/Seqlock mantığı** — Faz 2'de SADECE polling frekansı
  (20Hz→10/5Hz) düşürülecek; Seqlock/cache-line yapısına dokunma.
- **İş mantığı katmanları:** OBD, BLE, GPS, Vosk, Supabase — bunlar saha/entegrasyon
  bağımlı; "düzelttim" demeden önce cihazda doğrula.

---

## 4. Bir Sonraki Önerilen İş

İki aday (öncelik kullanıcıya bağlı):
- **A) Cihaz saha testi** (önerilen ilk adım): OBD/BLE bağlantısı + Vosk mikrofon +
  müzik ducking gerçek K24 head unit'te. Tüm bu mimari kodda hazır ama CİHAZDA
  DOĞRULANMADI.
- **B) Faz 2 interval gating** (kullanıcı onayı bekliyor): VehicleSignalResolver 20→10/5Hz,
  NativeHALAdapter 2→1Hz, CognitivePriorityEngine 1→0.5Hz, vehicleIntelligenceService
  durağanda 2→1Hz. blackBox 10Hz DEĞİŞMEZ.

- **C) Ölü-kod temizliği** (rapor hazır, PROJECT_STATE.md). En düşük riskten başla: izole
  tekiller → eski layout zinciri → diagnostic → traffic/*. Her adımda build+test+e2e+screenshot.
  AI.md atomik-patch; offline harita + BLE-ilişkili dosyalara DOKUNMA (GÜVENLİ DEĞİL).

> Not: B'ye başlamadan önce Faz 1'in cihazdaki etkisini ölçmek mantıklı — belki yeterli.
> Ayrıca çalışma ağacı kirli; yeni iş öncesi bekleyen değişiklikleri commit etmek iyi olur.

---

## 5. Test Bekleyen İşler (saha)

- **OBD cihaz testi** — BLE GATT + protokol cycle gerçek araçta (Fiat Doblo 1.4 8v =
  KWP2000 senaryosu dahil). Car Scanner bağlanıp bizimkinin bağlanmama sorununun
  çözüldüğü doğrulanmalı.
- **Vosk mikrofon cihaz testi** — AGC/NS/AEC + VOSK_GAIN ile STT kalitesi; head unit
  internetsiz.
- **Müzik ducking testi** — dinlerken müzik %12'ye iniyor mu, bitince restore oluyor mu.
- **Faz 1 GPU testi** — K24'te dokunma gecikmesi gerçekten düştü mü (ölçüm).

---

## 6. Bilinen Riskler

- **Branch belirsizliği ÇÖZÜLDÜ (2026-06-10):** CLAUDE.md `main` olarak düzeltildi
  (remote HEAD origin/main); merge hedefi `main`. Release disiplini kuruldu:
  `version.properties` tek kaynak + `release:bump`/`release:apk`/`release:aab`
  script'leri + CHANGELOG.md (detay: PROJECT_STATE.md "Release Disiplini").
- **Piped tek-nokta riski:** `pipedProvider.ts:22-28` 5 aday içerir ama yalnızca
  `api.piped.private.coffee` canlı doğrulanmış; o düşerse YouTube arama/stream çöker.
- **Commit edilmemiş native değişiklikler:** Android dosyaları `M` ve
  `android/app/src/main/assets/` UNTRACKED (`??` — Vosk modeli/`uuid` git'te yok);
  commit/transfer öncesi `git diff` ile gözden geçirilmeli. (~240 dosyalık kirli ağaç.)
- **Cihazda doğrulanmamış native iş yığını:** OBD/BLE + Vosk büyük oranda saha testi
  bekliyor — "tamamlandı" sayma.
- **OBD mock env adı tutarsızlığı:** Kod `VITE_ENABLE_OBD_MOCK` okuyor (obdService.ts:747,
  opt-in) ama `.env.example:25` + `.github/workflows/main.yml:32` okunmayan
  `VITE_DISABLE_OBD_MOCK`'u kullanıyor → o CI satırı **etkisiz**. Üretim varsayılanı güvenli
  (mock kapalı) ama doküman/CI yanıltıcı. Düzeltme ayrı küçük iş (kod/CI dokunuşu gerektirir).
- **STABILIZATION MODE:** AI.md gereği yeni özellik/büyük refactor yasak; tek-bug-tek-fix.

---

## 7. Çalışma Kuralı Hatırlatması

- Tüm yanıtlar **Türkçe**.
- **Onay isteme yok** — CLAUDE.md gereği işlemler doğrudan yapılır (ama AI.md stabilizasyon
  sınırları korunur).
- Kök neden bulunmadan fix önerme; semptom ≠ kök neden.
- Dosya/fonksiyon/satır iddialarını **yazmadan önce kod tabanından doğrula** (bu dosyalar
  da öyle yazıldı).
