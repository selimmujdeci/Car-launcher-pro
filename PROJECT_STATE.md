# PROJECT_STATE — CarOS Pro (CockpitOS)

> Bu dosya projenin **anlık gerçek durumunu** tutar. Ajan/oturum değişince
> "şu an neredeyiz?" sorusunun cevabı burada. İddialar kod tabanından doğrulandı.
> Son güncelleme: 2026-07-04.

---

## Aktif Branch

- **Aktif branch:** `feat/obd-core-v2` — **push EDİLMEDİ**. (Önceki: `feat/assistant-open-app`, hâlâ merge bekliyor.)

## ⭐ OBD CORE V2 — Patch 12A+B: UDS MODE 22 ALTYAPISI (2026-07-05)

Üretici-özel PID katmanının boru hattı (plan: `docs/OBD_PATCH12_PLAN.md`).
Tek commit (`c5b7bb5`), suite **2007 yeşil** (+34) + 31 Java testi (+17) + build OK:

- **12A** — `withEcuHeader` (ATSH/ATCRA atomik, restore her yolda,
  başarısızlık ASLA sessiz değil: HeaderRestoreException/addSuppressed);
  `readDid` (ISO-TP birleştirme paylaşılan yardımcıyla; 7F22-31/33 →
  desteklenmiyor, 0x78 pending → bekle-devam 10s üst sınır); OBDManager +
  BleObdManager aynası + plugin `readObdDid`.
- **12B** — `vehicleDidProfile` (şema doğrulayıcı + eval'sız decode tablosu +
  zorunlu `source`); `manufacturerPidService` (watchDid, izleyici yokken
  zamanlayıcı kurulmaz, 7F-31 kalıcı işaret); querySensor DID köprüsü
  (profil yüklüyse üretici verileri sesli cevaplanır; profilsiz davranış aynı).

**12C KISMİ (`6c171ae`, 2026-07-05):** ajan oturum limitinde kesildi; çekirdek
tamam ve doğrulandı (tsc + 2007 suite): `ascii` decode (metin DID'leri),
`verifyVinAgainstMode09` (F190↔Mode09 çapraz doğrulama), `didDiscoveryService`
(22xx tarama + cihaz-üstü JSON export), universal + Renault/Dacia profilleri
(yalnız kaynaklı ISO DID'ler — Renault-özel doğrulanmış DID bilinçli olarak YOK).

**Açık (12D):** profil yükleme bağlaması (profiller şu an ölü kod), SensorPanel
"Marka verileri" bölümü, keşif ekranı UI, 12C birim testleri/kilitleri; cihaz
doğrulaması yok (ATAR/ATCRA klon davranışı + 0x78 zinciri sahada).

## ⭐ OBD CORE V2 — Patch 11: TEŞHİS DERİNLİĞİ (2026-07-05)

Car Scanner makası — teşhis tarafı kapandı. Tek commit (`1d7b53e`), suite
**1973 yeşil** (+22 kilit) + 15 Java unit testi + vite build + Java derleme OK:

- **11A** — Bekleyen (Mode 07) + kalıcı (Mode 0A) DTC; 43/47/4A TEK parser
  (Mode 03 bit-birebir korundu); 0A dürüst ayrım: 7F0A/"?" → null
  (desteklenmiyor) ≠ NO DATA → boş liste (kod yok).
- **11B** — Mode 02 freeze frame: native ham bayt, formül TS'te
  StandardPidRegistry.decode (tekrar yok); readFreezeFrame() DTC + arıza anı.
- **11C** — `StandardPidEnums.ts`: PID 01 (MIL/DTC sayısı/readiness,
  benzin-dizel ayrımı), 03 (yakıt çevrimi), 1C (OBD standardı);
  `readDiagnosticStatus()` fail-soft + allReady muayene özeti.
- **11D** — DTCPanel bölümleri + muayene rozeti; tek buton tümünü okur.

**Açık:** cihaz doğrulaması yok (0A sessiz-NO-DATA klon riski); readPidOnce
throttle'sız (sık çağıran tüketici gelirse eklenmeli); bakım beyni/sesli
asistan entegrasyonu sıradaki dalga (API'ler hazır).

## ⭐ OBD CORE V2 — Patch 10: WiFi ELM327 TCP TRANSPORT (2026-07-04)

K24'te standart BT OEM-kilitli → OBD'nin TEK yolu WiFi ELM327. Tek commit
(`4c02cbe`), suite **1951 yeşil** (13 yeni kilit: `obdCoreV2.patch10.tcp.test.ts`)
+ vite build + `compileDebugJavaWithJavac` OK:

- **Native** — `OBDManager.connectTcp()` ("ip:port"); `pendingTcpSocket` Patch 2
  iptal sözleşmesiyle birebir; bağlantı sonrası mevcut ELM init/kuyruk/poll hattı
  AYNEN paylaşılır (RfcommChannel transport'a kör); `pollLoop` transport-agnostik;
  kopma → `link_lost` → aynı reconnect zinciri. Plugin `transport='tcp'` dispatch'i
  BT izin/adapter kontrollerini bilinçli atlar (WiFi'de BT kapalı olabilir).
- **TS** — `ObdTransport += 'tcp'`; **TCP otomatik ble↔classic fallback'ine
  KATILMAZ** (tek deneme → reconnect; yanlış IP'de BT taramasına düşmez, BT
  başarısızken TCP'ye sıçranmaz); `isValidTcpAddress` erken doğrulama (geçersiz
  adres native'e gitmez); protokol öğrenme TCP'de aynen.
- **UI** — OBDConnectModal "WiFi Adaptör (IP:Port)" manuel giriş; adres+transport
  kullanıcının kesin seçimi olarak hemen persist.

**Açık:** CİHAZDA DOĞRULANMADI — gerçek WiFi ELM327 adaptörüyle hiç test edilmedi;
`TCP_CONNECT_TIMEOUT_MS=8s` / `TCP_SO_TIMEOUT_MS=15s` tahmini, sahada ayar
gerekebilir; WiFi bağlantısına özel görsel durum ayrımı yok (genel connecting/error).

## ⭐ OBD CORE V2 — Patch 9: SENSÖR UI + SESLİ VERİ SORGUSU (2026-07-04)

Patch 8'in tüketici katmanı. İki commit (`a35de62` + `5423a82`), suite **1938 yeşil**
(15 yeni kilit: `obdCoreV2.patch9.query.test.ts`) + vite build OK:

- **9A `SensorPanel.tsx`** — DTC drawer'ında canlı sensör bölümü; 12 EXTENDED PID
  watchPid ile izlenir, `active` prop'una bağlı abonelik (DrawerShell unmount etmez;
  drawer kapanınca watchPid bırakılır → native EXTENDED polling durur, boşta sıfır
  maliyet). isPidSupported=false satırı gizler; getObdHealth kalite rozeti.
  screenRegistry 'sensors' girişi: "canlı sensörler / motor verileri" sesle açar.
- **9B `sensorQueryService.ts`** — `querySensor(soru)` sesli asistan veri API'si.
  Türkçe alias eşleştirme (spesifik kazanır); CORE senkron (getOBDDataSnapshot),
  geçersiz değer → dürüst "okunamıyor"; EXTENDED taze önbellek ≤30s anında,
  desteklenmiyorsa dürüst, yoksa geçici watchPid ile taze ilk değer (12s timeout,
  abonelik her yolda bırakılır). Eşleşmeyen soru → null, sahte cevap yok.

**Açık:** intent/beyin bağlanması `feat/assistant-open-app` dalının araç-bağlamı
işine bırakıldı (bu dalda intentEngine'e bilinçli dokunulmadı); cihaz doğrulaması yok.

## ⭐ OBD CORE V2 — Patch 8: STANDART PID TAM KAPSAM (2026-07-04)

Hedef: Car Scanner'dan bağımsız, onun kadar geniş standart kapsam + OS entegrasyonu.
Üç commit (`df4f4cf..e7a3c21`), suite **1923 yeşil** + Java derlemesi OK:

- **8A `StandardPidRegistry.ts`** — SAE J1979 Mode 01'in formülü tanımlı ~60 sayısal
  PID'i (yakıt trim, MAF, O2, katalizör/yağ sıcaklığı, tork, EGR/EVAP, tüketim…).
  Yalnız kamu standardı — üçüncü taraf liste/formül YOK. Enum/bitfield PID'ler v2'ye.
- **8B native EXTENDED grubu** — `readPidRaw` jenerik okuma; turda EN FAZLA 1 PID
  round-robin POLL_SLOW; liste boşken sıfır maliyet; `setObdExtendedPids` +
  `obdExtendedData` olayı (obdData hızlı yol paketi DEĞİŞMEDİ).
- **8C `extendedPidService.ts`** — talep-güdümlü: `watchPid` ilk izleyicide keşfi
  (0100→0120→0140→0160 zinciri, aynı kanaldan) başlatır; desteklenmeyen PID native'e
  gitmez; izleyici kalmayınca sıfır maliyete döner. API: watchPid/getPidValue/
  isPidSupported/getSupportedPids — dashboard/teşhis/sesli asistan buradan okur.

**Açık:** UI widget bağlantısı yok; sesli asistan bağlanmadı; enum PID'ler +
Mode 22/ISO-TP (üretici-özel) sonraki faz; cihaz doğrulaması yok.

## ⭐ OBD CORE V2 — Patch 1-7 TAMAM (2026-07-04)

BC8 kararsız bağlantı döngüsü + ELM327 güvenilirlik yükseltmesi. 7 atomik patch,
hepsi commit'li (`f3996a4..371c7c2`), suite **1885 yeşil** + `compileDebugJavaWithJavac` OK:

1. **obdStatus reason disiplini** — reconnect fırtınası kök nedeni: dinleyici içeriğe
   bakmadan her event'te reconnect tetikliyordu; artık yalnız `link_lost` (veya eski
   APK geri-uyum: reason yok) tetikler.
2. **İptal edilebilir native connect** — bloklu `socket.connect()` disconnect ile kesilebilir.
3. **Doğrulamalı ELM init + protokol öğrenme** — ElmInitSequencer yanıtları doğrular
   (SEARCHING/klon toleransı), ATDPN ile öğrenilen protokol persist → sonraki bağlantı aramasız.
4. **ElmResponseParser** — yapılandırılmış yanıt sınıflandırması (OK/NO_DATA/ERROR/…).
5. **ElmCommandQueue** — öncelik sıralı tek-komut kuyruğu; DTC (USER) poll komutlarının arasına girer.
6. **AdaptivePollingController + kademeli PID grupları** — FAST (hız/RPM, 250-1000ms
   tier'a göre; weak head unit ≥5s modda moda uyar) / SLOW (temp/fuel/throttle/intake/boost,
   5 turda bir) / ATRV voltaj (10 turda bir). `setObdPollProfile` köprüsü fail-soft (eski APK'da
   native 3s varsayılanı). Yeni PID'ler 0x11/0x0F/0x0B + ATRV artık GERÇEKTEN okunuyor
   (obdPidConfig iletiyordu, native hiç sorgulamıyordu). Sanitizer SAE sınırları + ATRV→batteryVoltage.
7. **ObdHealthMonitor** — `getObdHealth()`: connectionQuality 0-100 (sönümlü reconnect
   baskısı + aktif periyoda göreli bayatlık), sensorReliability alan→0-100 (sanitizer
   kabul/red, yarı-ömür 5dk). `src/platform/obd/`.

**Açık işler:** (a) cihazda canlı doğrulama YOK (K24: `settings put system
can_send_info_package_name com.cockpitos.pro` İLK İŞ — TTS lever kapalı kalmıştı);
(b) WiFi ELM327 TCP transport hâlâ yok (`OBDManager.tcpSocket` ölü alan, `ObdTransport`
tipinde 'tcp' yok) — K24 için sıradaki yol; (c) sağlık skorları + yeni PID'lerin UI
widget bağlantısı yapılmadı; (d) sesli komut entegrasyonu (MVP #16) yapılmadı.

## ⭐ DUSTER "BAŞLATILAMADI / Unexpected token ." — plugin-legacy modernTargets (2026-07-04)

Duster T507 açılışta boot-guard ekranı: `Uncaught SyntaxError: Unexpected token .
(satır: 1)`. Teşhis dist üzerinde kanıtlı: modern giriş paketi `main-*.js` içinde
238 `?.` + 183 `??` vardı — `build.target: 'es2015'` hiç uygulanmıyordu çünkü
**plugin-legacy, `modernTargets` verilmediğinde build.target'ı sessizce ezip modern
chunk'ları chrome>=105 hedefiyle derliyor** (dist/index.js:213-218, uyarısı build
logunda). Modern-tarayıcı tespiti ise yalnız ~Chrome 64 özelliklerini yoklar →
Chrome 64-79 WebView (Duster) tespiti geçip parse'ta ölüyordu; K24 (Chrome 101)
şans eseri çalışıyordu (?. Chrome 80+).

**Fix (vite.config.ts):** `modernTargets: 'chrome>=64, chromeAndroid>=64'` (tespit
eşiğiyle aynı taban) + `modernPolyfills: true` (Chrome 64-78 runtime API eksikleri).
Doğrulama: acorn ES2018 parse taraması — boot zincirindeki tüm modern chunk'lar
temiz (kalan "ES2020" bayrakları dynamic import/import.meta = Chrome 63-64 natif).
Kilit: "Eski WebView modern paket sözdizimi kilidi". Suite 1832 yeşil.

⚠️ Bilinen açık (ayrı iş): 3 Compute worker'ı (Navigation/Vehicle/Vision) hedef
indirgemeden geçmiyor (`||=`, class field, `?.` içeriyor) — boot'u bloklamaz ve
`type:"module"` worker zaten Chrome <80'de yok (BASIC_JS fallback devrede olmalı);
Duster'da worker fallback davranışı sahada doğrulanmalı.

## ⭐ HARİTA "SABİT + DÖNMÜYOR" GERÇEK KÖK NEDENİ: isStyleLoaded KAPILARI (2026-07-04)

4bd4ed5 sonrası saha şikayeti sürdü ("harita sabit kalıyor, gitme yönüne dönmüyor",
hız 33 gösterirken). Tarayıcıda Doppler-0 sürüş simülasyonuyla (Playwright, sahte
watchPosition) **lokal repro alındı** ve adım adım enstrümantasyonla kanıtlandı:

- `setDrivingView`'ın tepe guard'ı `!map.isStyleLoaded()` **her çağrıda** erken
  dönüyordu. isStyleLoaded() şu iki NORMAL durumda false verir:
  1. `updateUserMarker` → GeoJSON `setData` stili aynı senkron karede "kirli"
     işaretler → hemen ardından çağrılan setDrivingView %100 ölür (MiniMap'te
     sıra hep marker→kamera olduğundan mini haritada kamera HİÇ çalışmıyordu).
  2. Sürüşte sürekli yeni tile yüklenir → sourceCache.loaded()=false → FullMapView
     rAF tick'inin kare-başı isStyleLoaded kapıları takip yolunu topluca yutuyordu.
- 84237ff + 4bd4ed5'teki hareket-tespiti fix'leri **semptom tedavisiydi**; sürüş
  tespiti doğru çalışsa bile kamera bu kapılara takılıyordu.

**Fix:** kamera işlemleri (jumpTo/easeTo) stil gerektirmez → `setDrivingView` ve
`enterNavigationView` guard'ı yalnız `!map`; MiniMapWidget'ta stil kapısı yalnız
init yoluna (`!_initialized && !isStyleLoaded`); FullMapView tick + auto-follow +
drivingMode giriş yollarından kare-başı isStyleLoaded kapıları kaldırıldı (katman
işleri zaten getLayer+try/catch korumalı). Teşhis için `window.__MAP_STORE__`
kancası eklendi (_mapState.ts — cihazda CDP-over-adb ile canlı bearing okumak için).

**Doğrulama:** simülasyonda bearing 0→45° kilitlendi, pitch ~30, merkez her fix'te
aracı izliyor. Suite 1831 yeşil (+4 kilit: "Sürüş kamerası stil-kapısı yasağı").
Cihazda canlı doğrulama bekliyor — APK istek üzerine derlenecek.

## Horizon Sahte Katmanlar + Kadans-Bağımsız Hareket (2026-07-04, `4bd4ed5`)

Screenshot teşhisi: HzMap mockup süsleri taşıyordu — ekrana çivili sahte konum oku
("iki araç göstergesi" illüzyonu), hardcoded "2.4 km D400" nav şeridi, sabit
"2:15/137/15:39" seyahat satırı (rota yokken bile). Kaldırıldı; nav şeridi +
seyahat satırı yalnız GERÇEK isNavigating iken gerçek store verisiyle; N/+/−/
crosshair butonları paylaşılan haritaya gerçek komut gönderir. Ayrıca 84237ff'in
metre/fix eşikleri fix kadansına duyarlıydı → zaman-normalize km/h'ye çevrildi
(MiniMap ts-çapalı dispKmh >5/<3 histerezis; FullMapView ≥1.2s pencereli wake
çapası ≥5 km/h + ≥3m). Kilitler: "Horizon harita kartı sahte veri yasağı" (3) +
hareket kilitleri güncellendi. Suite 1827 yeşil. Cihazda doğrulama bekliyor.
- `main` HEAD: `648fb84` (autoBrightness guard).

## Harita "Ters Gidiyor + Takip Etmiyor" Fix (2026-07-04, `84237ff`)

Saha (telefon): araç ikonu doğru ama harita ters akıyor + konum takibi yok, tüm
hızlarda. Kök neden: cihaz Doppler hızını 0'a saplıyor (heading çalışıyor) ve
üç kapı YALNIZ hıza bakıyordu:
- `gpsService`: `gpsSpeed ?? delta` — 0 finite → delta fallback ölü. Fix:
  `pickRawSpeed` (Doppler yalnız >0.15 m/s ise güvenilir) + delta çapası ≥500ms
  (5Hz fix'te dt<0.5s guard'ı delta+course üretimini öldürüyordu).
- `MiniMapWidget.isDriving` (speedKmh>5): sürüş görünümü hiç açılmıyordu →
  kuzey-yukarı + ~200m'de bir merkez sıçraması ("geriye gidiyoruz" algısı).
  Fix: yer değiştirme eşiği + histerezis (giriş ~5.5m / çıkış ~2m).
- `FullMapView` rAF wake + isIdleNow: hız 0 → takip döngüsü uyuyordu. Fix:
  son iki fix arası ≥8m yer değiştirme hareket sayılır.
Suite **1824 yeşil** + 4 yapısal kilit + 6 pickRawSpeed birim testi.
**Cihazda canlı doğrulanmadı** — 429 kota fix'iyle aynı APK'da sahaya verildi.

## Asistan 429 Kota Fix Paketi (2026-07-04, `0f1d38a`)

Saha: "ilk istek online, sonrakiler offline". Kök neden: 429 kota soğuması sahte
offline yaşatıyordu. `companionChatProvider.ts` dört düzeltme:
- 429 pencereleri **sağlayıcı-bazlı** (Groq/Haiku 429'u Gemini'yi kilitlemez).
- Gemini 429 → **`RetryInfo.retryDelay`** kadar soğuma (5-60sn; sabit 60sn yerine).
- Tüm adaylar soğumadaysa **dürüst kota cevabı** (`companion_rate_limited` rotası);
  warmup soğumada atlanır.
- `repairMusicQuery` timeout'u artık **beyin devre kesicisini beslemez** (eskiden
  iki müzik komutu = 90sn tam offline kilidi).
Suite 1814 yeşil + 3 yapısal kilit. **Cihazda canlı doğrulanmadı.** Kalıcı çözüm
notu: kota şikayeti sürerse Gemini billing.

## Offline ASR Onarımı (2026-07-04, `2a333fa`)

Offline'da (Gemini onarımı yokken) bozuk Vosk transcript'i parse ÖNCESİ onarılıyor.
- **YENİ `src/platform/asrRepair.ts`** (saf, servis import'u sıfır): (a) `KNOWN_CONFUSIONS`
  ~27 gerçekçi Vosk TR fonetik hata çifti; (b) `domainLexiconSnap` — çekirdek komut
  kelimelerine muhafazakâr snap (≥4 harf, mesafe ≤1/4-6 ≤2/≥7; lexicon'daki, çekimli
  (kök+ek) ve ≤3 harf kelimeye DOKUNMAZ — offline "zayıf fiil aç" hassasiyeti gevşemedi).
- **Entegrasyon tek nokta:** `voiceService._bestLocalParse` — onarılmış varyantlar aday
  havuzuna girer (tavan 8), YALNIZ sıkı `>` confidence ile kazanır; eşitlikte orijinal
  (fail-soft: mevcut davranış gerileyemez). Wake word / beyin promptu / müzik query
  onarımı akışlarına DOKUNULMADI.
- Test +14 (`asrRepair.test.ts`) → suite **1803/1803** · guard 65/65 · tsc temiz
  (caros-coder yazdı; ana oturumda tsc + guard + asrRepair bizzat tekrar koşuldu).
  **Cihazda gerçek Vosk çıktısıyla doğrulanmadı.**

## 🛡️ Safety Assistant — Faz 1–3A Tamamlandı (2026-06-24, `9617664`)

CAN/araç sinyallerini sürücü güvenlik uyarılarına çeviren **izole** katman eklendi.
Commit: **`feat(safety): add vehicle safety overlay`** (14 dosya, +3797; push EDİLMEDİ).
Ürün+mimari standardı: `SAFETY_ASSISTANT_STANDARD.md`. Kod: `src/platform/safety/*` +
`src/components/safety/SafetyOverlay.tsx`.

- **Faz 1 — SafetyRuleEngine** (`SafetyRuleEngine.ts`): saf/durumsuz
  `evaluateSafetyRules(state, now, updatedAt?)`, 10 kural (reverse.active, door.open.moving,
  parking_brake.moving, engine.overheat, seatbelt.unfastened.moving, hood_or_trunk.open.moving,
  headlights.off.dark, low_fuel, battery_or_oil.warning, park.door.open). Hız histerezisi
  (moving>5, stopped<3), stale guard (>2s; overheat 10s istisna), priority sıralı çıktı.
- **Faz 2 — SafetyAlertQueue** (durumlu): debounce, repeat/maxRepeats, mute (tek olay;
  critical oturumluk susturulamaz), critical>warning>info önceliği, condition-clear.
- **Faz 2.5 — Bridge:** `safetyStateMapper` (saf store→SafetyVehicleState; seatbelt/headlights
  yanlış-alarm gating; speed stale `_vehicleSpeedTs`) + `useSafetyAlerts` hook.
- **Faz 2.6 — Risk kapatma:** `safetyOutputsEqual` (ts hariç derin kıyas → anons kaçmaz) +
  `safetyTicker` (aktif alert varken 500ms tick; idle'da timer yok).
- **Faz 3A — SafetyOverlay UI**: K24/Chrome 64-78 uyumlu (inset-0/blur/animasyon yok),
  tam-genişlik critical + ince warning banner + ikon şeridi; App.tsx'e mount. Reverse tamamen
  mevcut `ReversePriorityOverlay`'e bırakıldı.

**Test (ana oturumda bizzat doğrulandı):** engine 78 · queue 24 · bridge 31 · tick 21 ·
overlay 8 — tümü yeşil; guard 45 korunur; tsc temiz; build OK.

**HENÜZ YAPILMADI:**
- **VoiceSafetyAnnouncer YOK** — sesli anons / chime / ducking yazılmadı.
- **CAN adapter / native canlı bağlantı YOK** — `signalsAvailable` profile/handshake'e
  bağlanmadı; sinyal yokken seatbelt/headlights kuralları sönük (yanlış alarm yok). Gerçek araç
  CAN akışı ayrı açık iş (bkz. HANDOFF OBD/CAN devir notu).
- **Faz 3B sıradaki iş:** VoiceSafetyAnnouncer + ducking + mute (Sustur butonu + `useSafetyMute`).

## 🔴 K24 Cihaz Saha Oturumu — Perf/Bundle/Rotasyon (2026-06-14, `44c6372`)

Gerçek K24 head unit'te (PowerVR GE8300, Chrome 101 WebView) **Chrome DevTools CDP profili** ile kasma kök nedeni bulundu ve çözüldü. **Tam devir kaydı: `HANDOFF.md` §2 (2026-06-14 girişi).** Hafıza: `project_k24-perf-rootcause.md`, `project_k24-adb-network.md`.

- **Dominant fix:** `DrawerShell` çocukları kapalıyken de mount → `TrafficPanel`'in canlı MapLibre haritası 2. WebGL context tutuyordu → PowerVR thrash. `DrawerPanel.tsx`'te TrafficPanel yalnız açıkken mount. **mapCount 2→1, fps ~7→~15, JS idle %0→%22 (cihazda ölçüldü).**
- **Bundle:** Vite8/plugin-legacy `import.meta.resolve` (Chrome 105+) → Chrome 101'de modern bundle çöküp legacy ES5'e düşüyordu (9.7sn freeze). `vite.config.ts` `fixLegacyModernDetection` + `modulePreload:false` → modern bundle native çalışır.
- Ek: `freeOrphanMapContext` (MapCore), `detectWeakGpu` PowerVR + regresyon kilidi (41/41), `K24CanBridge` provider blacklist, dock büyütme (bukalemun korundu).
- **Açık (HANDOFF §2): (1)** rotasyon ROM her açılışta sıfırlıyor → app native `WRITE_SETTINGS` ile kilitlemeli; **(2)** ~15→30fps için MiniMap render-on-demand; **(3)** CAN veri akışı motor çalışırken doğrulanmalı.
- `capacitor.config.ts` debug bayrakları teşhis sonrası `isDev`'e geri alındı. tsc/build OK, guard 41/41.

## Cockpit Teması Silindi (2026-06-12, `7bc1b07`)

Mercedes/Audi ile AYNI desen — kullanıcı isteği üzerine cockpit de kaldırıldı.
**Silinen:** `themes/CockpitLayout.tsx`.
- **useCarTheme.ts:** `LegacyTheme`'den 'cockpit' çıktı ('oled' kaldı); VALID'ten
  cockpit/cockpit-day çıktı; persist `version 2→3`; migrate regex
  `/^(mercedes|audi|cockpit)(-day)?$/→expedition` (gerçek alan `theme`, string-cast).
  İki güvenlik ağı (migrate + VALID) → beyaz ekran yok.
- **NewHomeLayout:** import + if-bloğu kaldırıldı. **SettingsPage:** THEME_OPTIONS
  -cockpit. **website ThemeStudio:** PRESETS -COCKPIT.
- **KAPSAM DIŞI (false match / ayrı sistem):** `themeLayoutEngine` LayoutVariant
  'cockpit' (ThemePack/bmw); `MagicCardVariant` 'cockpit' (iç preset, zararsız ölü);
  `[data-theme="cockpit"]` CSS + base.css yorumu (erişilmez); `K24CanBridge.java`
  `p.contains("cockpit")` (paket adı `com.cockpitos.pro` — ALAKASIZ).
Doğrulama: `tsc` EXIT 0 · **1231/1231** · build OK. Aktif tema seçenekleri artık:
expedition (day/night) · horizon · tesla · pro · sunlight. **Cihazda doğrulanacak:**
cockpit kullanıcısı boot'ta expedition'a düşmeli.

## Mercedes + Audi Temaları Silindi (2026-06-12, `f37c160`)

Hedef: mercedes/audi temalarını tüm referanslarıyla kaldır, mevcut kullanıcıyı
güvenli temaya (expedition) taşı. **Silinen:** `themes/{Audi,Mercedes}Layout.tsx`.
- **useCarTheme.ts:** `CoreTheme`'den 'mercedes', `LegacyTheme`'den 'audi'
  kaldırıldı; `CORE_THEMES` + `onRehydrateStorage VALID`'ten çıktı. persist
  `version 1→2`; `migrate`'e `mercedes/audi(+-day)→expedition`. **KRİTİK:** gerçek
  persist alanı `theme` (task'ın `themeId`'si YANLIŞ olurdu → beyaz ekran);
  kaldırılan literal'ler union'da olmadığından **string-cast** ile karşılaştırıldı.
  İki güvenlik ağı: migrate (version bump) + VALID (her yüklemede) → beyaz ekran yok.
- **NewHomeLayout.tsx:** Audi/Mercedes import + renderTheme if-blokları kaldırıldı
  (eşleşmezse fallback layout'a düşer). **useVoiceCommandHandler:** `_THEME_CYCLE`
  -'mercedes'. **perf.theme.test:** `setTheme('mercedes')`→'horizon'.
  **SettingsPage:** THEME_OPTIONS -mercedes/audi. **website ThemeStudio:** PRESETS
  -MERCEDES/AUDI. **FEATURES.md + MARKETING_ONEPAGER.md:** tema listesinden Mercedes
  ("Audius" müzik servisine DOKUNULMADI — Audi değil).
- **KAPSAM DIŞI (bilinçli, ayrı sistemler):** `ThemePack`/`themeLayoutEngine`
  (`Record<ThemePack>` ayrı sistem, 'bmw' bile içerir → dokunmak Record'u kırardı);
  `MagicCardVariant`/`VARIANT_STYLES` (iç kart preset'leri, zararsız ölü kod);
  `[data-theme="mercedes/audi"]` CSS (data-theme artık o değerlere ayarlanmaz →
  erişilmez/zararsız).
Doğrulama: `tsc --noEmit` EXIT 0 (module-not-found YOK) · **1231/1231** · lint 0 ·
build OK. **Cihazda doğrulanacak:** mercedes/audi temasında olan kullanıcı boot'ta
expedition'a düşmeli (beyaz ekran yok).

## Araç-Tipi Farkındalıklı UI + AI (2026-06-12, `d6b8fdb`)

Hedef: UI ve AI'yı bağlı aracın tipine göre uyarla. `useOBDState` reaktif +
`useStore.ts:433` (profil değişince `setObdVehicleType`) → **anında, reload yok**
(kısıt karşılandı).
- **SpeedCard data row (NewHomeLayout):** `vehicleType==='ev'` → RPM/SICAKLIK/
  YAKIT chip'leri GİZLENİR, yerine MOTOR(kW)/AKÜ ISI/ŞARJ(%) gelir
  (`motorPower`/`batteryTemp`/`batteryLevel`). Zero Redundancy: EV'de "RPM --"
  yerine özelliği komple değiştir. `flex-1` + 3-için-3 takas → "tam dolu" görünüm
  korunur (instruction 3 ekstra grid gerektirmedi).
- **Header Menzil pill:** EV'de ⛽ yakıt menzili yerine ⚡ + `obd.range` (araç-
  bildirimli batarya menzili); ICE'de eski yakıt-türevli.
- **companionChatProvider:** `vehicleCapabilityNote` — EV'ye "TAM ELEKTRİKLİ,
  RPM/motor sıcaklığı/yakıt YOK, ASLA bahsetme/uydurma"; hibrit/phev "mevcut
  olandan bahset". ICE'de not boş (gürültü yok). Turbo notu EKLENMEDİ
  (boostPressure<0 "turbo yok" demek değil — yanlış iddia).

**KAPSAM DIŞI (kod tabanında yok, uydurulmadı):** `transmission`/`GearPosition`
(veri modelinde transmission alanı + gear widget'ı YOK); `BoostPressure` widget'ı
(NewHomeLayout'ta boost chip'i yok). Task premisleri gerçek bileşen yapısıyla
uyuşmuyordu; gerçekte var olan EV ayrımına odaklandım. Test: companionChat +2
(EV notu girer/ICE'de girmez) → **1231/1231** · tsc+lint+build temiz. **Cihazda
doğrulanacak (screenshot):** profil EV seçilince dashboard'un batarya chip'lerine
ANINDA geçişi.

## Telefon Dock Kompaktlaştırma (2026-06-12, `4ab262b`)

Saha: telefonda (w<600px) alt dock fazla yer kaplıyordu. `theme-layouts.css`
mevcut `@media (max-width:600px)` bloğu `--dock-h`/`--dock-icon` set etmiyordu;
telefon `--dock-h`'yi portrait bloğundan (70px) alıyordu. Fix: o bloğa
`--dock-h: 64px !important` (portrait 70px'i ezer) + `--dock-icon: 24px` (emoji
ikonlar; Lucide zaten 24px). **Head unit (≥800px landscape) bu bloğa GİRMEZ →
etkilenmez** (kısıt). Dokunma hedefi korundu: DockBar Btn = `var(--dock-icon)+20px`
= 44px (NHTSA/ISO 15005 ≥44px). Task premisleri düzeltildi: (1) gerçek değişken
adları `--dock-h`/`--dock-icon` (proje `--dock-height`/`--dock-icon-size`
kullanmaz). (2) DockBar'da 1.5rem padding YOK — outer fixed div zaten
`paddingTop:4` + `paddingBottom:env(safe-area-inset-bottom)` (istenen safe-area
deseni mevcut; değişiklik yok). (3) "Expedition/Horizon 80px tema override"
GERÇEKTE YOK — 80px = 1280×720 HD head unit breakpoint'i; bu temalar kendi
head-unit dock'larını kullanır (126px / 94-122px clamp), `--dock-h` ile değil.
Build OK, dist CSS doğrulandı, lint 0. **Cihazda doğrulanacak (screenshot):**
telefonda dock yüksekliği + ikon boyutu; deploy+screenshot istek üzerine.

## OBD Persistence Chain — Snapshot Kurtarma Devamlılığı (2026-06-12, `b51e75a`)

Sorun: WebView crash / boot sonrası snapshot'tan hydrate edilen OBD verisi UI'da
gösterilmiyordu — `_buildPatch` `source` taşımadığından `_current.source` 'none'
kalıyor, geçerli tarihsel veri (yakıt/menzil) varken bile gösterge 'none/idle'
boşta takılıyordu.
1. **`canSnapshotService._buildPatch`:** en az bir GEÇERLİ (bayat olmayan) alan
   kurtarıldıysa `source: 'real'` ekler (snapshot YALNIZ source='real' için
   yazılır → persist edilmiş veri gerçektir). Tüm alanlar bayatsa patch BOŞ kalır,
   source EKLENMEZ (çağıranların `Object.keys(patch).length` kontrolü korunur).
2. **`obdService._current` init:** `_buildPatch` sayesinde source='real' otomatik
   gelir → boot'ta son bilinen değerler ANINDA görünür (belge + doğrulama).
3. **Async hydration (instruction 3 audit):**
   - Guard `source !== 'none'` YETERSİZDİ (sync hydration artık source='real'
     yapıyor) → CANLI veri sinyali `_lastRealDataMs` ile ayrıldı (yalnız gerçek
     bağlantı set eder; snapshot etmez). Taze Filesystem verisi sync sonrası da
     uygulanabilir kaldı.
   - Computed yakıt alanları (`fuelRemainingL`/`estimatedRangeKm`) snapshot'ta YOK
     ve hydration `_merge`'i bypass eder → async patch'te `fuelLevel` varsa
     `computeFuelMetrics` ile yeniden hesaplanır. **Sync yolda** `setObdFuelConfig`
     (araç profili yüklenince) zaten `_current.fuelLevel`'den recompute ediyor
     (audit: bu yol çalışıyordu, async yol açıktı — kapatıldı).
Yan etki notu: `_notify` (193) source='real' iken `scheduleCanSnapshot` çağırır
ama hydration yolları `_notify` çağırmaz (sync init no-op, async yalnız store
listener) → hydration kendisi re-persist tetiklemez. Test: canSnapshotService +5
→ **1229/1229** · tsc + build temiz. **Cihazda doğrulanacak:** WebView öldürülüp
yeniden açıldığında göstergenin son yakıt/menzil değerini anında göstermesi.

## Phase P — Deep Intelligence Co-Pilot (2026-06-12, `5abcd32`)

Kullanıcı isteği: asistanı "komut dağıtıcı"dan bağlam-farkında yardımcı pilota
çevir. Üç maddenin 1 ve 3'ü ZATEN tamamdı (wake `startWakeWordService` +
Vosk re-trigger `0348b9b`; SystemBoot Wave 4 wiring `0348b9b`; 2.5s
zero-latency fallback `734d825`) — redo edilmedi, doğrulandı. Yeni iş madde 2
(`companionChatProvider.ts` + `tripLogService.ts`):
- **Contextual AI Partner:** beyin prompt'una "KOMUT ROBOTU DEĞİL, aracın ve
  yolculuğun o anki durumunu (DÜNYA GÖRÜŞÜN / World View) bilen YARDIMCI PİLOT"
  çerçevesi. Single Brain ACTION/CHAT kararı korundu.
- **Full Context Injection (World View):** `buildInterpretedVehicleContext`
  artık yakıt + motor sıcaklığı YANINDA **yolculuk süresini** de enjekte ediyor
  (`interpretTripDuration`). Her isteğe girer (askCompanionBrain + Gemini chat).
- **Dialect & Intent Awareness:** özel isimlere ek olarak GENEL kelime ASR
  hatası talimatı ("birez muzuk ac" → "biraz müzik aç"; harf/ses hatasına
  takılma, niyeti yakala).
- **Otomotiv:** sürüşte kısa ("2-3 kısa cümle" + "dikkatini dağıtma"), park
  halinde derin/sohbet odaklı.
- **`tripLogService.getTripSnapshot()`** eklendi: `onTripState` immediate-emit'i
  `current: null` gönderdiğinden tek-atış subscribe canlı trip vermiyordu; bu
  getter hesaplı (performance.now) `current` döndürür. `_notify` ile
  `_computeSnapshot` paylaşıldı (davranış korundu).
Test: companionChat +2 (World View trip enjeksiyonu + yeni prompt çerçevesi),
kontrollü tripLogService mock → **1224/1224** · tsc + build temiz. **Cihazda
doğrulanacak:** gerçek yolculukta süre bağlamının doğal dile girmesi, bozuk ASR
genel kelimelerde niyet yakalama, park/sürüş ton farkı.

## Wake Word Entegrasyonu — Boot Orkestratörü + Vosk Kapısı (2026-06-12, `0348b9b`)

Kullanıcı isteği: "asistan uyanmıyor" düzelt. İki kök neden bulundu:
1. **Orkestrasyon kırılgan:** wake YALNIZ `useLayoutServices` React hook'unda
   wire'lıydı (layout mount'una bağlı, dependency değişiminde disable→enable
   churn). YENİ `startWakeWordService()` (wakeWordService.ts): modül-düzeyi
   `useStore.subscribe` — companion/legacy wake ayarına göre enable/disable,
   ad/mod değişiminde yeniden kurar, `_wakeKey` ile ilgisiz ayar churn'ü yok.
   SystemBoot `_wave4`'te çağrılır + `_cleanups`'a girer. **Eski
   useLayoutServices wake effect'i KALDIRILDI** — iki orkestratör aynı anda
   enable/disable çağırınca çift dinleme oturumu (karşılıklı STT iptali =
   sağırlık) riski vardı. `_loopGen` korunur.
2. **Erken start sağır:** grammar/polling, Vosk modeli unpack+load (boot+30s,
   20-40s) bitmeden başlıyordu → `startWakeWordListening` "model yok" hard-fail,
   ilk tetikler sağır. YENİ `notifyVoskModelReady()` kapısı: native start model
   hazır olana dek ERTELENİR (`_pendingNativeGen`); SystemBoot preloadVoskModel
   çözülünce (veya eski APK'da preload metodu yoksa hemen) kapı açılır. Backstop
   75s: sinyal hiç gelmezse yine başlar (sonsuz sağırlık yok).
Zero-leak: backstop timer + store aboneliği + ertelenmiş start cleanup'ta ve
HMR dispose'da temizlenir. Silent Handover korundu (pasif beklemede status
'idle', UI pill yok). Test: companionWake +9 (orkestrasyon 6 + kapı 3) →
**1222/1222** · tsc + lint + build temiz. **Cihazda doğrulanacak:** gerçek
boot'ta wake'in Vosk preload SONRASI kurulması (ilk dakikada erken sağırlık
yok), ayar açıp-kapama + ad değişiminde tek oturum (çift dinleme yok).

## Single Brain Mimarisi Tamamlandı (2026-06-12, `734d825`)

Kullanıcı isteği: sesli asistanı "Gemini-first tek beyin" mimarisine indir.
Refactor'un büyük kısmı (`voiceService.processTextCommand`: kritik bypass →
Gemini-first → graceful fallback) çalışma ağacında ZATEN yazılmıştı; eksik/
yarım kalan parçalar tamamlandı (klasik niyet≠gerçek):
1. **`timeoutMs` ÖLÜ parametreydi (asıl kusur):** voiceService beyne 2.5sn
   karar bütçesi (`BRAIN_DECISION_TIMEOUT_MS`) gönderiyordu ama
   `CompanionChatOpts`'ta alan YOKTU ve `askCompanionBrain` sabit
   `GEMINI_TIMEOUT_MS=6000` kullanıyordu → task'ın "2.5sn'de timeout→yerel
   fallback" şartı FİİLEN ÇALIŞMIYORDU (6sn blokluyordu). `timeoutMs?` alanı
   eklendi + fetch signal'ına clamp'li (≤6sn tavan) bağlandı.
2. **BRAIN_SYSTEM_PROMPT açık vurgu:** "Sen bu aracın TEK BEYNİSİN (Single
   Brain) — arkanda parser/ikinci asistan YOK" + "TEK KARAR: AKSİYON mu CHAT
   mi, yalnız birini döndür" (No Dual Response prompt katmanında).
3. **Kritik refleks bypass:** `CRITICAL_VOICE_TYPES` = volume_up/down +
   stop_music (= MEDIA_PAUSE/STOP). YALNIZ bunlar 1.0 güvende Gemini
   beklenmeden yerelde çalışır; diğer her girdi (1.0 olsa bile) önce beyne.
4. **Testler eski mimariye göreydi (3 fail → düzeltildi):**
   `companionConversationLoop` "net komut yerelde dispatch" beklentisindeydi;
   Single Brain'de komut beyin ACTION kararıyla gelir (`actionResult` helper).
   "müziği kapat" testi var olmayan `pause_music` yerine gerçek `stop_music`
   (kritik bypass) tipini kullanıyor.
**No-Dead-Ends reask'a DOKUNULMADI** (test-kilitli `companionChat.test.ts`:
online çöküş+offline yok → kişiliğe uygun tekrar-rica; task'la çelişmiyor).
Doğrulama: tsc temiz · **1213/1213 test** · production build OK. **Cihazda
doğrulanacak:** internetli ortamda gerçek Gemini karar gecikmesi (2.5sn
bütçe içinde mi), yavaş ağda yerel fallback'e zamanında düşme.

## Asistan Sağırlığı Fix Paketi 2 (2026-06-12, `be63735`)

Saha raporu 2 (asistanfix APK öncesi): "hey mavi" hiç uyanmıyor, cevaptan
sonra dinlemede kalmıyor, "anladım deyip sonra anlayamadım" diyor:
1. **TTS yield emniyeti (native):** bazı head unit TTS motorları onDone'u
   çağırmıyor → `nativeTtsSpeaking` takılı → half-duplex wake mikrofonu
   SONSUZA DEK kapalı (boot selamlaması sonrası asistan sağır). 30 sn üst
   sınır eklendi (`TTS_YIELD_MAX_MS`).
2. **Wake thread nice +2** (BACKGROUND→2): bg cpuset harita render'ında
   decode'u açlığa düşürebiliyordu.
3. **Takip dinlemesi fallback'i:** TTS bitiş eventi gelmezse 20 sn sonra
   mikrofon best-effort açılır (eskiden sessizce vazgeçiyordu).
4. **Ara mesaj:** "Anlıyorum/Tabii bakayım" çıktı; eşik 800→1500 ms.
NOT: `be63735` bekleyen admin/CAN-sniffer working-tree değişikliklerini de
içerdi (git add -A süpürmesi — dosyalar tüm yeşil koşuların parçasıydı).
NOT 2: Grammar wake özel isimlerde Vosk sözlüğü dışındaysa YAPISAL çalışmaz
([unk]'a düşer) — kullanıcıya Türkçe kelime isim önerilecek.
**Cihazda doğrulanacak:** boot selamlaması sonrası "hey mavi", sohbet döngüsü.

## Asistan Sağırlığı Fix Paketi (2026-06-12, `ab756e1`)

Saha raporu: asistan yalnız "İnternet yavaş, şunu mu demek istediniz" diyor,
istenen müzik yerine farklı parça açılıyor. İki kök neden:
1. **`AbortSignal.timeout()` Chrome 103+ API'si — head unit WebView (64-78)
   TANIMAZ** → TypeError, fetch ağa hiç çıkamadan ölüyordu. Cihazda Gemini /
   hava / trafik / Overpass / remote-config çağrılarının TAMAMI anında
   başarısızdı. → `utils/abortCompat.ts signalWithTimeout()` (native →
   AbortController fallback → timeout'suz); 14 ham kullanım değiştirildi.
   **KURAL: src/ altında ham `AbortSignal.timeout` kullanmak yasak.**
2. **Yavaş hotspot**: onLine=true ama her cümle 3 ardışık AI timeout'u
   (6+5+3 sn) bekliyordu. → `platform/aiHealth.ts` devre kesici: 2 ardışık
   AĞ hatası → 90 sn tüm AI yolları atlanır (yerel zincir anında cevap);
   başarılı cevap devreyi kapatır. `_resolveAiKeys.hasNet`'e bağlandı.
3. UX: `PLAY_MUSIC_QUERY` artık duyduğu sorguyu söyler ("X aranıyor").
Suite 1213/1213 · tsc/lint temiz. **Cihazda doğrulanacak:** Gemini sohbet
gerçekten çalışıyor mu (ilk kez ağa çıkabilecek), müzik aramada duyulan ad.

## Navigasyon Saha Fix Paketi (2026-06-12, `0fcac44`)

Saha raporu (Tarsus sürüşü, latencyfix APK): harita sabit + rota çizgisi
silinmiyor + sesli yönlendirme yok + hız levhası 50'de sabit. Düzeltmeler:
1. **Rota ilerlemesi stil kapısından çıktı** (FullMapView GPS callback):
   `mapStyleReadyRef` takılırsa adım sayacı/mesafe/ses/kırpma topluca
   donuyordu — ilerleme artık her geçerli fix'te çalışır.
2. **Kat edilen rota kırpma EKLENDİ** (özellik hiç yoktu):
   `getRouteProgressPoint()` (navigationService) + `trimRouteGeometry()`
   (MapLayerManager) — snapped noktadan ileriye kalan geometri; yalnız
   segIdx/geometri değişince setData; stil değişiminde self-healing.
3. **Kademeli sesli yönlendirme EKLENDİ** (NavigationHUD): ~500m/~200m/şimdi;
   eskiden yalnız adım değişince (dönüşün üstünden geçerken) konuşuyordu.
4. **Nav kamera watchdog** (rAF): ACTIVE'de 8 sn kamera güncellenmezse
   follow/interacting bayrakları kendiliğinden toparlanır.
5. **rAF bayat `route` closure fix**: turnDist hep undefined'dı — dönüş
   yaklaşım zoom'u/anticipation hiç çalışmıyordu.
6. **Hız levhası dürüstlüğü**: `useSpeedLimitByLocation` 50 → null başlar;
   gerçek Overpass verisi gelmeden levha çizilmez.
**Cihazda doğrulanacak:** sürüşte kamera takibi + kırpma + üç kademeli anons;
levha yalnız gerçek veriyle görünmeli. Suite 1213/1213 · tsc/lint temiz.

## Head Unit "Latency Death" Fix Paketi (2026-06-12, `5687d9a` + `0cfd729`)

Kullanıcı şikayeti: "her butona basınca en az 5 sn bekliyorum". İki commit:
- **`5687d9a` (önceki oturumun working tree'de KALMIŞ perf fix'leri commit'lendi
  + testler uyarlandı):**
  - thermalWatchdog: OBD **engineTemp cihaz ısısı kaynağı DEĞİL** — sağlıklı
    motor suyu (90-105°C) 45°C L1 eşiğini sürekli aşıp head unit'i KALICI
    L2/L3 termal kısıtlamaya sokuyordu (en olası kök neden).
  - obdService: kayıtlı adres yokken otomatik scanOBD kaldırıldı (BT INQUIRY
    10-30 sn → GPS jitter + A2DP glitch + Bridge tıkanması). İlk bağlantı
    HER ZAMAN OBDConnectModal → `startOBD(address)`.
  - performanceMode lite: obdListenerDebounce 10s→1.5s · ARM zombie PING
    10s→30s · SystemBoot Vosk preload 8s→30s.
  - Testler yeni sözleşmeye uyarlandı (obdDiagEvents/obdService: adresle
    direct-connect, `scanOBD` çağrılmadığı assert edilir). Suite 1213/1213.
- **`0cfd729` (yeni):** kalıcı wake grammar thread'i (Faz 5) + pasif wake
  polling oturumları (duck:false) `THREAD_PRIORITY_BACKGROUND`'a alındı —
  default öncelikli sürekli Vosk decode WebView ana thread'iyle yarışıyordu.
  Aktif asistan oturumu (duck:true, kısa) default öncelikte kalır.
  Java compile temiz.
**Cihazda doğrulanacak:** dokunma gecikmesi (termal kısıt kalkınca), wake
isabeti (BACKGROUND öncelikte decode yetişiyor mu), OBD ilk bağlantı akışı
(modal'dan adres seçimi → persist → sonraki boot direct-reconnect).
**NOT:** Cihazdaki APK'da bu fix'lerin HİÇBİRİ yok — yeni APK gerekecek
(kullanıcı isteyince).

## Companion Faz 5 — Native Refleksler / Grammar Wake (2026-06-11, `7c674dc`)

Wake word algılama JS polling döngüsünden NATIVE, kalıcı, grammar-kısıtlı Vosk
thread'ine taşındı (mevcut `runVoskListening`'e DOKUNULMADI — mimari §6):
- **CarLauncherPlugin.java:** yeni `startWakeWordListening`/`stopWakeWordListening`
  + `runVoskGrammar()` thread'i. Vosk TAM SÖZLÜK DEĞİL yalnız wake sözleri +
  `[unk]` grammar'ıyla çalışır (`new Recognizer(model, rate, grammarJson)`) —
  hız + yapısal az yanlış pozitif ("maviş" [unk]'a düşer).
- **REFLEKS (<200ms):** ~100ms ses penceresi + PARTIAL sonuç kontrolü — endpoint
  sessizliği BEKLENMEZ; "mavi" dendiği an `wakeWord` event'i JS'e düşer. JS
  tarafında ttsService modülü grammar başlatılırken ISITILIR (soğuk import yok).
- **NO DUCKING:** pasif thread'de requestAudioFocus/duckMusicForListening YOK —
  müzik tam kalitede çalmaya devam eder.
- **HALF-DUPLEX:** `nativeTtsSpeaking` (speak() kuyrukladığında set, son
  utterance çözülünce clear) + `voskCapturing` + `savedSpeechCall != null`
  (volatile yapıldı) → wake thread mikrofonu BIRAKIR; asistan kendi
  selamlamasını duymaz, AudioRecord çakışmaz. Tetik sonrası 600ms bekleme.
- **wakeWordService.ts:** önce grammar modu denenir (`startGrammarMode`);
  metot yok (eski APK) / model hatası → ESKİ startSpeechRecognition döngüsü
  aynen (fail-soft, jenerasyon token'ı async yarışları kapatır). Event'te
  defense-in-depth `_matches` (kelime sınırı) + lastHeard teşhisi korunur.
- **nativePlugin.ts:** `WakeWordListeningOptions`/`WakeWordEvent` + opsiyonel
  metot tipleri + `wakeWord` addListener overload'u. (`duckWhileListening`
  zaten Faz öncesi hem JS hem native'de bağlıydı — değişiklik gerekmedi.)
- handleOnDestroy → stopWakeWordThread (mikrofon sızıntısı yok).
Test +7 (`companionWake.test.ts` FAZ 5 bloğu) → suite **1213/1213** · tsc +
lint + `gradlew compileDebugJavaWithJavac` temiz.
**Cihazda doğrulanacak:** grammar modunda TR modelin "mavi/hey mavi" tanıma
isabeti, refleks gecikmesi (<200ms hedef), müzik çalarken pasif dinlemenin
müziği hiç kısmaması, TTS sırasında kendini tetiklememe.

## Companion Faz 4 — Proaktif Motor + Uyku Önleyici (2026-06-11, `2939055`)

YENİ `companionEngine.ts` (PromptScheduler, mimari §5) + SystemBoot Wave 4 kaydı
(`CompanionEngine` named cleanup, VoiceService'ten sonra):
- **60 sn tick döngüsü**, tetik önceliği: (1) yakıt menzili <50 km [GÜVENLİK,
  medya çalarken bile, 15 dk cooldown] → (2) uyku önleme [gece + sürüş ≥30 dk +
  ≥20 dk sessizlik → AÇIK UÇLU soru, deterministik rotasyon, 25 dk cooldown] →
  (3) kontak/boot selamlaması [oturumda 1, ilk 5 dk penceresi, saat dilimine göre]
  → (4) mola önerisi [interpretBreakNeed, 45 dk tekrar aralığı] → (5) yolculuk
  yorumu [yalnız 'sik'].
- **Frequency budget (mimari §5.2):** az=45dk · normal=20dk · sık=10dk; 'az' =
  yalnız güvenlik tetikleri (+ tek seferlik selamlama — ürün kararı); güvenlik
  tetikleri bütçeden bağımsız ama kendi cooldown'lu.
- **Interaction Gate:** companionEnabled · personality≠'sessiz' (proaktif 0) ·
  CognitiveMode<PROTECTION · !isVoicePaused · sesli oturum yok (status/followUp) ·
  kendi TTS uçuşta değil · medya prominent ise yalnız tetik #1.
- **Sessizlik tanımı:** tick örneklemesi (voice/media) + registerCommandHandler +
  registerTtsEndListener anlık sıfırlar; tüm süreler performance.now monotonik.
- **Proaktif konuşma Gemini'ye GİTMEZ** (mimari §2.8) — şablon + companionContext
  yorumlayıcıları. Zero-leak: interval+abonelik+emniyet zamanlayıcısı cleanup'ta.
Test +21 (`companionEngine.test.ts`) → suite **1206/1206** · tsc + lint temiz.
**Cihazda doğrulanacak:** boot selamlaması zamanlaması (Vosk preload/boot TTS ile
çakışma), gece uzun sürüşte uyku sorusu, müzik çalarken yalnız yakıt uyarısı.

## Companion Faz 3 — Şive Dostu Birleşik Beyin (2026-06-11, `33b61ec`)

`companionChatProvider.ts` beyin katmanı (tryCompanionBrain + buildBrainSystemPrompt):
- **Persona Integration:** kişilik beynin EN TEPESİNDE (`BRAIN_PERSONA_ROLE`) —
  profesyonel=MAKAM ASİSTANI, samimi=MAHALLE ARKADAŞI, neseli/sessiz eşdeğerleri;
  hem chat "say" hem action "feedback" tonunu belirler.
- **Dialect Robustness:** prompt'a şive talimatı ("birez/kurban/uşağum/gardaş"
  engel değil KARAKTER İPUCU; niyet şive katmanının altından cımbızla çekilir)
  + şiveli komut örneği ("uşağum şuralarda bi benzinlik bulsana" → FIND_NEARBY_GAS).
- **No Dead-Ends (iki katman):** (1) prompt: "ASLA ÇIKMAZ YOK" — anlaşılmayan
  metinde bile chat tekrar-rica; (2) kod backstop: ONLINE deneme çöktü + offline
  eşleşme yok → `REASK_BY_PERSONALITY` (kişiliğe uygun deterministik tekrar-rica,
  route companion_offline → takip dinlemesi açılır). Gemini HİÇ denenmediyse
  (offline) null KORUNUR — eski dürüst zincir (öneriler + offline müzik kapısı)
  bozulmaz (bilinçli tasarım: voiceService null'da zincire devam eder).
Test +5 → suite **1185/1185** · tsc temiz. Mevcut sözleşmeler korundu
('birez kıs kurban' örneği, geçersiz intent→offline, companion kapalı→null).

## Companion Faz 2 — Bağlamsal Zeka (2026-06-11, `a0a749d`)

`companionContext.ts` yorumlayıcıları proaktif/öngörülü hale getirildi:
- **interpretFuel:** menzil < 100 km ise yüzde okumakla yetinmez, benzinliği
  ROTAYA EKLEME teklif eder ("istersen rotanın üzerindeki en yakın benzinliğe
  yönlendireyim") — 3 kademe (kritik/az/normal-ama-düşük-menzil).
- **interpretFatigue:** gece + ≥2 saat → can yoldaşı derinliği: somut eylem
  teklifleri (camı arala, kahve molası, en yakın dinlenme yeri). Diğer dallar
  da empatik dile çekildi.
- **interpretEngineTempConcern:** soğuk motorda samimi uyarı ("hadi biraz
  ısınsın, öyle basarız"); ısınmada ciddiyet + birliktelik ("ben de
  göstergeleri izliyorum").
- **MİMARİ KARAR:** "kanka/aslanım" hitapları yorumlayıcılara GÖMÜLMEDİ —
  ton/hitap persona katmanının (Gemini) işi; profesyonel kişiliğe argo
  sızmama test garantisi korunur (`companionChat.test.ts` persona testi).
- **Context injection güçlendi (`companionChatProvider.ts`):** araç bağlamı
  artık "SÜRÜCÜNÜN MEVCUT DURUMU" başlığıyla girer; kritik durum (az yakıt,
  ısınan motor) Gemini'ye KENDİLİĞİNDEN dile getirme talimatıyla verilir;
  "yalnız konuyla ilgiliyse" kuralı (test sözleşmesi) korundu.
Companion testleri 92/92 · `tsc --noEmit` temiz. Modül saflığı korundu
(companionContext import'suz saf fonksiyon — kaynak sözleşme testi geçiyor).

## Companion Faz 1 — Ruh ve Kimlik (2026-06-11, `51aa03a`)

`buildCompanionSystemPrompt` yeniden tasarlandı (sohbet + beyin aynı persona
katmanı): şive duyarlılığı (kelimeye değil NİYETE odak; "anlamadım" yasak) ·
robotik kalıp yasağı ("Tamam, hallettim." doğal tepkiler) · sürüşte kısa-öz-
samimi · tehlikeli istekler DOST TAVSİYESİYLE reddedilir · kişilik tonu
kullanıcı seçimine saygılı (profesyonelde argo yok). BRAIN_INTENTS +=
CYCLE_THEME/ENABLE_NIGHT_MODE (ASR bozuk "tema değiştir" beyin devralır).
Injection guard değişmedi (yalnız ad/hitap alanına uygulanır — doğrulandı).
Test +3 → **1181/1181**. Saha notu: "tema değiştir" temiz transcript'te
zaten exact theme_cycle (1.0) — saha hatası ASR bozulmasıydı; artık beyin
yedeği var.

## Siri Mantığı — Birleşik Asistan Beyni (2026-06-11, `3a25bbd` — CİHAZ DOĞRULAMASI BEKLİYOR)

Kullanıcı isteği: "Siri mantığında yap". Yeni akış: yerel parser yalnız NET
komutlar (≥0.7) için hız katmanı; gerisi `tryCompanionBrain` — TEK Gemini
çağrısı komut/sohbet kararını verir (JSON: action|chat), bozuk ASR özel
isimlerini düzeltir ("leyla türk"→"Leyla Göktürk").
- ACTION → `fromSemanticResult` → AI handler zinciri (sohbet döngüsü yok);
  CHAT → TTS + takip dinlemesi. Aksiyon turları RAM geçmişine girer
  ("onu da çal" bağlamı). Offline: eski fallback zinciri aynen; müzik kapısı
  yalnız offline'da (online'da beyin müziği yapısal ACTION yapar).
- `repairMusicQuery`: yerel yakalanan play_music_query online'ken ≤1.8s
  Gemini isim onarımından geçer (fail-soft; searchUri+feedback güncellenir).
- **BUG FIX** `intentEngine.fromSemanticResult`: PLAY_MUSIC_SEARCH query
  payload'a hiç yazılmıyordu → semantic müzik araması yalnız uygulama
  açıyordu; `searchQuery` artık köprüleniyor.
Test +9 → suite **1178/1178** · build 58s · lint 0.
**Cihazda doğrulanacak:** internetli ortamda "Leyla Göktürk'ten müzik çal"
(bozuk ASR ile bile doğru isme onarım), serbest cümle komutları ("canım X
dinlemek istiyor"), sohbet sürekliliği; Gemini gecikme hissi (800ms feedback).

## Yakın Mikrofon Clipping Fix (2026-06-11, `63c558b` — CİHAZ DOĞRULAMASI BEKLİYOR)

Saha: kullanıcı mikrofonun dibinde konuşuyor, Vosk özel isimleri tanıyamıyor
("Leyla Göktürk"→"Leyla Türk" / isim komple düşüyor → generic "müzik açılıyor").
Kök neden: yüksek giriş × 3.0 yazılım kazancı naif clamp ile TEPEDEN
KESİLİYORDU (kare dalga distorsiyonu) → Vosk'a bozuk ses gidiyordu.
Fix (CarLauncherPlugin.runVoskListening): pencere tepesi ölçülür; peak×gain
headroom'u (`VOSK_CLIP_HEADROOM=29000`, ~%88 FS) aşacaksa kazanç o pencere
için otomatik düşer (min 1.0). Yakın konuşma temiz, uzak/alçak ses tam
kazançlı; wake döngüsü aynı yoldan geçtiği için o da düzelir. Sözleşme testi
voiceTuning.test.ts'te. Suite 1169/1169 · Java compile OK.

## Wake Uyanmama + Müzik İsteği Saha Fix (2026-06-11, `45facfa` — CİHAZ DOĞRULAMASI BEKLİYOR)

Saha: (1) "hey mavi / özel ad diyorum uyanmıyor" · (2) "İbrahim Tatlıses'ten
müzik aç → Gemini sanatçının hayatını anlatıyor".

**Wake kök nedenleri ve fix'ler (wakeWordService + companionIdentity + Java):**
- Vosk TR modeli "hey"i güvenilir tanımaz → "hey {ad}" Vosk eşdeğerleriyle
  genişler (ey/hay/hei); custom "hey ..." cümleleri de.
- Sessizlik rejection'ı hata sayılıp 3sn bekleniyordu (döngünün ~%25'i SAĞIR)
  → 250ms; tur arası 500→300ms; pencere 9s→20s (wakeListenMs).
- Ayar değişiminde eski döngü instance'ı ölmüyordu → PARALEL STT (karşılıklı
  iptal = tam sağırlık). Jenerasyon token'ı eklendi.
- Pasif döngü her turda müziği %12'ye kısıyordu → native yeni opsiyon
  `duckWhileListening:false` (CarLauncherPlugin; varsayılan true, aktif
  dinleme değişmez). Wake kazancı ayrı: `wakeGainX=3.2`.
- Teşhis: `WakeWordState.lastHeard` (son 5 transcript) + console.warn eşleşme
  sonucu; 5 ardışık gerçek hata → görünür 'error' (sessiz sonsuz döngü yok).

**Müzik kök nedeni:** musicCommandParser çekimli fiil tanımıyordu ("açar
mısın"/"açsana"/"açıver"/"koy") → cümle <0.7 → companion AI-first sohbete
düşüyordu. Fix: VERB_FORMS (kök+çekim+soru eki tüm ünlü uyumları+nezaket
kuyruğu) + fiilsiz net istekler ("X'ten müzik", "tarkan şarkıları"; soru
cümleleri hariç) → play_music_query 0.93, sorgu sade sanatçı adı. Ek sigorta:
voiceService companion kapısı — `looksLikeMusicActionRequest` true ise sohbet
ATLANIR, zincir semantic NLP'ye (PLAY_MUSIC_SEARCH) devam eder.

**Genel hassasiyet:** nativeGainX 2.5→3.0 (saha isteği; tavan 4.0, yanlış
tetikleme artarsa geri alınır).

Test: +21 → suite **1168/1168** · build OK · lint 0 · Java compile OK.
**Cihazda doğrulanacak:** "Mavi"/"Hey Mavi"/özel ad uyanma oranı (lastHeard
chrome inspect'te), müzik çalarken duck yokluğu, "X'ten müzik açar mısın" →
arama, yanlış tetikleme oranı (gain 3.0/3.2 yüksekse düşürülecek).

## Asistan Adı Merkezli Wake Word (2026-06-11, `eb8ad25` — CİHAZ DOĞRULAMASI BEKLİYOR)

Ürün davranışı: wake phrase sabit marka kelimesi DEĞİL — kullanıcı asistana
hangi adı verirse asistan o adla uyanır (ad=Mavi → "Mavi"/"Hey Mavi").

- **ÜRÜN KARARI:** varsayılan asistan adı **'Mavi'** ("Hey Yol Arkadaşım" wake
  olarak kullanılamaz; "Yol Arkadaşım" özelliğin adı olarak kalır). Persist
  **v14→v15**: eski varsayılan ad 'Yol Arkadaşım' kişiselleştirilmemiş sayılıp
  'Mavi' yapılır; kullanıcının özel adları aynen korunur.
- **Model:** `companionWakeMode` = name / hey_name / **both (varsayılan)** /
  custom. `companionWakePhrase` artık YALNIZ custom modda kullanılır.
  `resolveWakeWords` ad-merkezli türetir: <3 harf ad tek başına tetiklemez
  (yalnız "hey {ad}" kalır); boş liste asla dönmez (fallback "hey mavi").
- **Eşleşme:** `normalizeWakeText` (TR küçük harf İ dahil, aksan sadeleştirme,
  noktalama) + `matchesWakeTranscript` (kelime-sınırlı ardışık eşleşme:
  "mavi" ⊄ "maviş"). Legacy "hey car" sistemi bit değişmeden korundu
  (substring davranışı dahil).
- **Wake UX:** tetiklenince kısa selamlama ("Buradayım."/"Dinliyorum."
  rotasyon) → TTS bitince aktif dinleme (selamlama mikrofona karışmaz).
  Pasif beklemede status 'idle' — sürekli "Dinliyorum" UI YOK; görünür durum
  yalnız aktif dinlemede. Follow-up (8s sohbet penceresi) sistemiyle uyumlu.
- **Güvenlik:** PROTECTION/CRITICAL'da (`isVoicePaused` yeni export) tetik
  sessizce yutulur — selamlama/dinleme/sohbet başlamaz. Ad/cümle
  sanitizer'dan geçer (injection/özel karakter/boş → fallback).
- **Çakışma fix:** voiceService meşgulken (listening/processing) pasif döngü
  mikrofon AÇMAZ (`getVoiceSnapshot`) — wake döngüsünün aktif dinlemenin
  cevabını yutması engellendi.
- **UI:** Ayarlar → Yol Arkadaşım: "Uyanma Şekli" 4'lü seçici, ad değişince
  öneri/önizleme otomatik ("Şu sözlerle uyanır: …"), özel cümle girişi yalnız
  custom modda, kısa isim yanlış tetikleme uyarısı.
- **Test:** `companionWake.test.ts` 28 yeni (türetme/normalize/eşleşme/
  güvenlik/servis akışı). Suite **1147/1147** · build 57s · lint 0 hata.
- **Cihazda doğrulanacak:** K24/Duster'da gerçek Vosk transcript'iyle
  "Mavi"/"Hey Mavi" tetikleme oranı + yanlış tetikleme (yol gürültüsü, radyo);
  selamlama → dinleme geçiş hissi; PROTECTION modda sessiz kalma.

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

---

## ⚙️ Settings sahte-veri temizliği (2026-07-03, `548d3d4`, branch `fix/k24-can-flood-perf`)

Ayarlar sayfasındaki tüm stub/sahte içerik gerçek kaynaklara bağlandı (canlı Playwright doğrulaması + 1648 test yeşil):

- **Header LiveStatsRow:** Math.random CPU/TEMP silindi → YÜK (PerformanceObserver longtask, rAF YOK — K24 boşta-çizim yasağı), BAT (`useDeviceStatus`), RAM (`performance.memory`), NET (`navigator.onLine`+`connection.rtt`).
- **Donanım Analizi paneli:** sabit "Android Auto / Chromium 114 / 42°C / Certified" → gerçek `isNative`, UA Chromium sürümü, `getDeviceTier()` sınıfı, `navigator.deviceMemory`.
- **Ses sekmesi:** AGC / Sürücü Odaklı / Hıza Bağlı toggle'ları `audioService` gerçek API'lerine bağlı (kalıcı). Genel sekmedeki ikiz AGC/Focus toggle'ları sekme dönüşünde senkronlanır.
- **Bağlantı sekmesi:** Wi-Fi/BT `useDeviceStatus`'tan gerçek durum; native'de dokunma `openWifiSettings`/`openBluetoothSettings` açar; sahte OTA toggle yerine gerçek `OtaUpdateCard`.
- **Bonus bug fix (`audioService.ts`):** `_loadPersistedState` yalnız AudioContext init'inde çağrılıyordu → kaydedilen AGC/SVC/Focus tercihi reboot sonrası UI'da varsayılan görünüyordu. Getter'larda tek seferlik lazy load yapıldı.
