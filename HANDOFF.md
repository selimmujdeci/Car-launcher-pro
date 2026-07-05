# HANDOFF — CarOS Pro Devir Notları

> Yeni ajan/oturum buradan başlasın. Projeyi kaldığı yerden devralma rehberi.
> Son güncelleme: 2026-07-05. Branch: `feat/obd-core-v2`.

## ⭐ SON İŞ (2026-07-05 #20): "Online asistan offline'a düşüyor" KÖK NEDEN + anahtar cihaz-yedeği

Telefon (Xiaomi zircon) USB'de, CDP-over-adb canlı teşhis oturumu (`8d9c492` + `8e02596`):

**Kök neden zinciri (KANITLI — tahmin değil):** kullanıcı uygulamayı silip kurunca
anahtarı KAYBOLDU (secureStore boş — CDP ile cihazdan doğrulandı) → uygulama
`.env`'e gömülü VITE_GEMINI_API_KEY'e sessizce düştü (SettingsPage "● .env'den
otomatik" gösterip "anahtar girili" yanılgısı yarattı) → o gömülü anahtar GEÇERSİZ
(PC'den test: HTTP 400 API_KEY_INVALID) → her beyin çağrısı 400 → sağlayıcı zinciri
tükendi (Groq/Haiku girili değil) → her soru SESSİZCE offline motora. Eski recovery
katmanı (cockpitos_recovery + Google Auto Backup) hiç çalışmamıştı: `bmgr restore`
→ "No available restore sets" (Xiaomi'de Google yedeği hiç oluşmamış); head unit'te
Google zaten yok.

**Yapılan (iki commit, suite 2122 yeşil + tsc + Java derleme + guard 97):**
1. `8d9c492` — **cihaz-içi anahtar yedeği** (caros-coder ajanına delege edildi, ana
   oturumda doğrulandı+tamamlandı): native deviceKeyBackupWrite/Read/Status +
   requestAllFilesAccess (`/sdcard/CarOSPro/.cockpitos.keys`, AES-256-GCM, anahtar
   SSAID'den — dürüst not: Keystore seviyesi DEĞİL, uninstall-kalıcılığı ödünleşimi);
   sensitiveKeyStore 3. kurtarma basamağı (boot'ta 1 kez, tüm RECOVERY_KEYS geri
   dolar); remove() artık recovery+blob'u da temizler (ana oturum eki); SettingsPage
   yedek durum satırı + "İzin ver" (Android 11+ Tüm Dosyalara Erişim); 4 elle-giriş
   alanına trim. 10 kilit (`sensitiveKeyStore.deviceBackup.test.ts`).
2. `8e02596` — **dürüst "anahtar geçersiz" cevabı**: Gemini 400/403 gövdesi
   API_KEY_INVALID ise `companion_key_invalid` rotası ("...anahtarını kontrol etmen
   gerekiyor") — kota dürüstlüğüyle (companion_rate_limited) aynı ilke; 200'de işaret
   temizlenir; kesici beslenmez. 4 kilit (companionChat.test.ts §6).

**Devralan bilsin:** (a) ✅ CİHAZDA DOĞRULANDI (2026-07-05, Xiaomi telefon):
geçerli anahtar girildi → `/sdcard/CarOSPro/.cockpitos.keys` yazıldı → `adb
uninstall` → dosya kaldı → yeniden kurulum + boot → anahtar OTOMATİK geri geldi
(secureStoreGet 53 kars AQ.A…, Google'a canlı test HTTP 200). İzin adb'den
verildi (`appops set … MANAGE_EXTERNAL_STORAGE allow`) — normal kullanıcı
akışında Ayarlar'daki "İzin ver" butonu. ⚠️ Bilinen küçük UX boşluğu: izin İLK
boot'tan SONRA verilirse restore bir sonraki uygulama başlatmasında çalışır
(`_deviceRestoreTried` boot-başına-1 bayrağı) — head unit'lerde (Android 10,
izin gerekmez) etkisiz; istenirse "İzin ver" dönüşünde bayrak sıfırlama eklenir.
(b) `.env`
içindeki VITE_GEMINI_API_KEY ÖLÜ — ya yenilenmeli ya silinmeli (BYOK kuralına da
aykırı, teşhisi bulandırıyor; kullanıcının Google hesabı gerekli); (c) head unit
"10 denemede 1 anlama" (Vosk STT) AYRI açık iş — n-best+asrRepair bu dalda ama head
unit APK'sı eski, cihaz bağlanınca güncel APK + saha testi; (d) CDP izleme aracı:
scratchpad `cdp-assistant-monitor.mjs` (konsol+AI ağ trafiği+onLine, 4xx gövdesi
dahil) — gelecek saha teşhislerinde yeniden kullanılabilir desen.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #19): UÇUŞTA kapandı — Patch 13 (29-bit UDS) devralındı + V3 commit'li

Önceki "UÇUŞTA" bölümündeki iki ajanın akıbeti (ikisi de KAPANDI):

1. **V3 ajanı (asistan):** limit kopmadan KENDİ commit'ini atmış — `69a7c90`
   (commandParser araç-alanı kalıpları `vehicleIntents.ts`'e taşındı, davranış
   sıfır değişiklik). Ayrı iş kalmadı; tam suite doğrulaması aşağıdaki
   konsolide koşuda yapıldı.
2. **Patch 13 ajanı (OBD):** oturum limitinde ÖLDÜ, iş çalışma ağacında yarım
   kaldı → ana oturum devraldı, tamamlayıp `2d31393` olarak commit'ledi:
   - `ElmProtocol.withEcuHeader` dispatcher: 3 hane → 11-bit (Patch 12A
     BİREBİR), 8 hane → `withEcuHeader29Bit` (ATDPN protokol öğren → gerekirse
     ATSP7 → ATCP öncelik baytı → ATSH/ATCRA → restore HER durumda; yalnız
     gerçekten değiştirilen alanlar restore edilir, hatalar addSuppressed).
   - Klon dürüstlüğü: ATSP7/ATCP'ye "?" → action HİÇ çağrılmaz, null =
     "desteklenmiyor" (supported:false kanalı, 7F-31/33 ile aynı kalıcı işaret).
   - ATDPN ayrıştırması `ElmResponseParser.parseActiveProtocolDigit`'te
     paylaşıldı (ElmInitSequencer + 29-bit yolu, kopyalama yok).
   - Zoe Ph2 profiline EVC (18DADAF1/18DAF1DA) + LBC (18DADBF1/18DAF1DB) 9 DID:
     odometre/12V/dış sıcaklık/devir/SOC/SOH/batarya V-°C/enerji — OVMS3
     rz2_pids_EVC.cpp + rz2_pids_LBC.cpp (MIT dosya bazında teyitli) birebir;
     `rawFor`'a 3-bayt ABC (CAN_UINT24) eklendi; doğrulayıcı ECU adresi
     TAM 3|8 hane (4-7 belirsiz, reddedilir).
   - **Ajanın bıraktığı 2 kusur ana oturumda düzeltildi:** (a) `ElmProtocol`'e
     `android.util.Log` sokmuştu → JVM testleri "not mocked" ile patladı;
     log satırı KALDIRILDI (sınıf saf JVM kalır — FakeChannel testleri
     Android'siz koşar; bilgi kaybolmaz, supported:false + TS diag'ı taşıyor);
     (b) ATSH hard-fail testinin beklentisi `setEcuHeader`'ın gerçek davranışını
     (ATSH+ATCRA önce İKİSİ gönderilir sonra doğrulanır — Patch 12A) yansıtmıyordu
     → beklenti düzeltildi.
   - Eski "yalnız 11-bit ECU" kilidi SİLİNMEDİ, Patch 13 davranışına GÜNCELLENDİ
     + 9 yeni formül-sadakat kilidi (`obdProfiles.renaultZoePh2.test.ts`).

**Konsolide doğrulama (bu oturumda BİZZAT, V3+Patch 13 birlikte):** tsc temiz +
tam vitest suite **2108 yeşil** (134 dosya) + Java OBD testleri
(`testDebugUnitTest --tests com.cockpitos.pro.obd.*`) yeşil.
**CİHAZDA DOĞRULANMADI** — gerçek Zoe Ph2 + WiFi ELM327'de ATSP7/ATCP davranışı
ve EVC/LBC yanıtları sahada test edilmeli (ucuz klonda "?" → dürüst
"desteklenmiyor" BEKLENEN davranıştır, hata değil). Çalışma ağacındaki diğer
WIP'ler (Freeze/worker grubu + voice-wav + vite.config + navigasyon dosyaları)
yine BİLİNÇLİ commit dışı bırakıldı — karıştırma.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #18): Zoe Ph2 profili (OVMS3/MIT) + yasal kaynak haritası

Ana oturum işi, commit'li + doğrulanmış (hedefli 32/32 + o anki tam suite 2070):
- `69873fb` — `profiles/renaultZoePh2Profile.ts`: BCM (745/765) VIN + 4 lastik
  basıncı (raw16×0.75 kPa) + 4 lastik sıcaklığı (raw8−30) + HVAC (744/764) kabin
  sıcaklığı ((raw16−400)/10). Formüller OVMS3 kaynağından BİREBİR, lisans DOSYA
  BAZINDA MIT teyitli, atıf SettingsPage OSS_LICENSES'ta, 9 formül-sadakat kilidi
  (`obdProfiles.renaultZoePh2.test.ts`). EVC/BMS (SOC/odometre/RPM) 29-bit
  gerektirdiği için BİLİNÇLİ dışarıda → Patch 13'ün işi.
- `88f6bd9` — `docs/OBD_DATA_SOURCES_LEGAL.md`: veri kaynağı karar tablosu
  (OVMS3 MIT ✅ / opendbc MIT ama Renault yok / CanZE GPLv3 yalnız ipucu /
  AB 2018/858 RMI yasal hak / Car Scanner-DDT ASLA) + eylem planı.
- `3e96454` — ROADMAP boşluk (3): 29-bit UDS adresleme eksiği.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #17): Asistan ↔ Araç Entegrasyonu V2 — araç bağlamı beyne

`docs/ASSISTANT_VEHICLE_INTEGRATION_PLAN.md` V2 tamamlandı. V0 keşfi (plan
dosyasında commit'li) zaten `buildInterpretedVehicleContext()`'in yakıt/batarya/
motor sıcaklığı/yolculuk süresi/menzil-vs-rota yorumlarını TÜM beyin yollarına
(Gemini chat/brain, Groq, Haiku, grounded) verdiğini bulmuştu — V2 kapsamı yalnız
DTC sayısı ekleme + ölü kod temizliğiydi (bakım satırı BİLİNÇLİ atlandı, aşağıda).
tsc temiz + suite **2088 yeşil** (133 dosya, +17 yeni test) + eslint 0 hata.

**`src/platform/companion/companionContext.ts` — 2 yeni saf yorumlayıcı:**
`interpretDtcStatus(activeCount, pendingCount?)` (0 arıza → null; aksi hâlde
"Araçta N aktif arıza kaydı var." tek cümle) + `interpretMaintenanceDue(items)`
(bakım kalemlerinden EN ACİL olanı — critical > warning, eşitlikte kalan
süre/km'si en az olan — tek cümlede; negatif daysLeft/kmsLeft "süresi geçmiş"
sayılır, NaN/Infinity reddedilir).

**`companionChatProvider.buildInterpretedVehicleContext()`'e DTC bloğu:**
`dtcService.onDTCState` senkron son-değer yakalama (mevcut `onOBDData` deseniyle
AYNI) → yalnız SAYI (`codes.length`) `interpretDtcStatus`'a girer, ham kod listesi
prompt'a HİÇ gitmez. **Bakım satırı EKLENMEDİ (bilinçli):**
`vehicleMaintenanceService.getMaintenanceAssessment()`'in ucu `sensitiveKeyStore`
(async şifreli depolama) — bu fonksiyon senkron çalışır (await yok, her beyin
çağrısında); bakımı bağlamak async'e çevirip beyin isteğini geciktirirdi ("boşta
sıfır maliyet" + "beyin çağrısını asla geciktirme" ilkeleri). `interpretMaintenanceDue`
yine yazıldı + test edildi; V3/V4'te zaten async bir katman (companionEngine gibi)
tüketebilir.

**Ölü kod temizliği:** `src/platform/voiceContextBuilder.ts` SİLİNDİ (V0 bulgusu:
hiçbir üretim dosyası `buildEnrichedCtx`'i import etmiyordu). 4 test dosyasındaki
vestigial `vi.mock('../platform/voiceContextBuilder', ...)` satırı kaldırıldı
(`companionConversationLoop.test.ts`, `voiceCogPause.test.ts`, `voiceTuning.test.ts`
+ plan tahmininde olmayan 4.'sü: `assistantQuerySensorBypass.test.ts`).
`voiceTypes.VehicleContext` tipine DOKUNULMADI — başka dosyalarda (voiceService,
commandExecutor, semanticAiService, aiVoiceService) hâlâ kullanılıyor.

**"Bağlamdan sensör değeri söyleme" kuralı:** V1'de zaten eklenip kilitlenmişti
(`assistantQuerySensor.test.ts`) — V2 tekrar eklemedi, yalnız DTC bağlamının bu
kuralla çelişmediğini doğruladı (yalnız SAYI, kod/neden yok).

**Testler:** `companionContext.test.ts` +17 test (`interpretDtcStatus` 8,
`interpretMaintenanceDue` 9); `companionChat.test.ts`'e `DTC` hoisted mock +
2 entegrasyon testi ("0 arıza → satır yok" / "N arıza → yorum var, ham kod yok").

**Devralan bilsin:** CİHAZDA/CANLI SESLE DOĞRULANMADI (yalnız unit test
seviyesinde). Dokunulmayan iki WIP (Freeze/worker + navigasyon oturumu
dosyaları) bu commit'e karışmadı — yalnız kendi dosyaları `git add` edildi.
Sırada V3 (vehicleIntents.ts'e mevcut yerel kuralların taşınması, davranış
BİREBİR aynı) + V4 (teşhis derinliği sesli).

## ⭐ ÖNCEKİ İŞ (2026-07-05 #16): Asistan ↔ Araç Entegrasyonu V1 — QUERY_SENSOR uçtan uca

`docs/ASSISTANT_VEHICLE_INTEGRATION_PLAN.md` V1 maddesi tamamlandı: "yağ sıcaklığı
kaç", "turbo basıncı ne kadar" gibi commandParser'da karşılığı OLMAYAN sensör
sorularının artık `sensorQueryService.querySensor`'dan GERÇEK veriyle cevaplandığı
uçtan uca hat (yerel yol + beyin yolu). tsc temiz + suite **2061 yeşil** (132 dosya,
+22 yeni test) + `npm run build` OK.

**Yeni dosya:** `src/platform/vehicleIntents.ts` — "X kaç/ne kadar/nedir/söyle"
kalıbını yakalayan, adayı `resolveSensor` ile DOĞRULAYAN saf parser (alan-modülü
ayrıştırmasının V1 tohumu, ROADMAP kararı). Aç/kapat fiili içeren cümlelerde
tetiklenmez (negatif koruma).

**Değişen dosyalar:**
- `commandParser.ts` — yeni `query_sensor` tipi; `vehicleIntents` **YALNIZ best.score
  TAM EŞLEŞME (1.0) DEĞİLKEN** denenir (scored pattern'lerden SONRA, ama return'den
  önce). **Önemli tasarım notu:** ilk denemede "yalnız hiçbir kalıp eşleşmezse dene"
  (best.score < THRESHOLD) yeterli SANILDI ama YANLIŞ çıktı — vehicle_speed'in genel
  `'kac'` token'ı (Tier-2, 0.82) HER "... kaç" sorusunu yakalıyordu ("yağ sıcaklığı
  kaç" → yanlışlıkla vehicle_speed/hız kazanıyordu, testle YAKALANDI). Fix: eşik
  `best.score < EXACT_SCORE (1.0)` yapıldı — mevcut 5 informational pattern'in EXACT
  keyword eşleşmeleri (hız/yakıt/motor sıcaklığı/bakım/durum, hepsi confidence 1.0)
  BİREBİR korunur, ama Tier-2/3'ün BELİRSİZ tahminleri artık sensör sorgusuna öncelik
  verir (bu zaten "belirsiz" tahminlerdi — doğru sensöre yönlendirmek regresyon değil
  İYİLEŞTİRME).
- `voiceService.ts` — yeni bypass "1b2" (hava durumu bypass'ı 1b ile AYNI desen):
  `query_sensor` + confidence≥0.7 → beyne HİÇ gitmeden `_answerSensorQuery()` çağrılır:
  "Bakıyorum..." kısa onay → `await querySensor()` (EXTENDED/manufacturer 12s'e kadar
  sürebilir, bu yüzden durum 'processing'de tutulur, overlay kapanmaz) → gerçek cevap.
  VIN gibi >20 karakter string değer TTS'te OKUNMAZ → toast ile ekrana yönlendirilir.
- `intentEngine.ts` / `semanticAiService.ts` / `companionChatProvider.ts` /
  `commandExecutor.ts` — **beyin yolu**: yerel parser kaçırırsa (bilmediği/nadir bir
  sensör adı) Gemini `QUERY_SENSOR` + `sensorQuery` döner (şemada DEĞER alanı YOK —
  beyin sahte sayı uyduramaz, yapısal garanti); `fromSemanticResult`→AppIntent→
  `commandExecutor.dispatchIntent` case'i AYNI `querySensor` akışını çalıştırır.
- **`obd/sensorQueryService.ts` — kritik yan-etki fix'i:** `getOBDDataSnapshot`
  importu STATİK'ten `querySensor`'un 'core' dalı içinde TEMBEL (`await import`)
  hale getirildi. Sebep: `resolveSensor`'u (senkron, obdService'e ihtiyaç duymaz)
  `vehicleIntents.ts` üzerinden `commandParser.ts`'e bağlayınca, commandParser
  (dokümante "pure, no side effects" modülü — voice UI'da HER karakterde/komutta
  yükleniyor) obdService'in DEVASA modül grafiğini (AdaptiveRuntimeManager,
  SafetyBrain, import-anında `onPerformanceModeChange` aboneliği…) transitif olarak
  sürüklüyordu — iki test dosyası (`asrRepair.test.ts`, `voiceNbest.test.ts`, gerçek
  commandParser kullanıp performanceMode'u kısmi mock'luyorlardı) bu yüzden ÇÖKTÜ,
  ayrıca "boşta sıfır maliyet" ilkesini ihlal ediyordu. Fix build'de doğrulandı:
  `sensorQueryService` artık kendi ayrı chunk'ında (27kB), obdService'e sadece
  gerçekten sensör OKUNDUĞUNDA bağlanıyor.
- **Testler:** `src/__tests__/assistantQuerySensor.test.ts` (parser + yapısal kilitler)
  + `assistantQuerySensorBypass.test.ts` (voiceService bypass, mock'lu). **Bilinçli
  karar:** `regression.guards.test.ts`'e DOKUNULMADI (o dosya bu oturumda paralel bir
  WIP'in — Freeze/worker — parçası olarak zaten değişik durumda; kilitler kendi
  dosyalarında tutuldu, commit çakışma riski önlendi).

**Devralan bilsin:** CİHAZDA/CANLI SESLE DOĞRULANMADI (12s EXTENDED bekleme UX'i
özellikle sahada dinlenmeli — "bakıyorum" + sessizlik "ölü" hissi verebilir).
V2 (araç bağlamı beyne — DTC sayısı/bakım uyarısı satırları + "bağlamdan sensör
değeri söyleme" kuralı) ve V3 (mevcut vehicle_speed/fuel/temp/maintenance/status
yerel kurallarının vehicleIntents.ts'e taşınması, davranış DEĞİŞMEDEN) planda
sırada; kapsamı `docs/ASSISTANT_VEHICLE_INTEGRATION_PLAN.md`'de.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #15): Navigasyon denetimi + P0/P1 fix'leri

Kapsamlı nav denetimi (10 alan, bulgular: hafıza `project_nav-audit-2026-07-05.md`)
+ iki commit (`84a05df` + `6cd52d1`), suite 2037 yeşil (7 yeni kilit dahil) + tsc + build OK:

1. **TBT off-by-one (P0, `84a05df`):** TurnPanel + sesli anons + LimpHomeHUD
   `steps[currentStepIndex]`'i okuyordu = az önce GEÇİLMİŞ manevra (OSRM'de
   instruction adımın başındaki manevradır, index manevra geçilince ilerler,
   mesafe `steps[i+1]`'e sayar). Fix: `upcomingStep = steps[i+1]` her üç
   tüketicide; `followStep = steps[i+2]` "Sonra…" satırı (mesafe kaynağı
   `step.distance` oldu). RoadSignsPanel `currentStep.streetName`'de KALDI
   (üzerinde gidilen yol — bilinçli). Kilit: `navigationHud.turnStep.test.tsx`.
2. **Tünel sürekliliği (P1, `6cd52d1`):** GPS kesilince adım/anons/ETA donuyordu.
   FullMapView rAF DR dalı 1 Hz'de ilerleme hattını besler;
   `updateRouteProgress(..., {allowReroute:false})` yeni opsiyonel parametre —
   DR konumunda sapma tespiti ATLANIR (sahte reroute offline'da rotayı düz-çizgiyle
   ezerdi). Varsayılan davranış bit değişmeden korunur (test kilitli).

**Devralan bilsin:** (a) bu fix'ler CİHAZDA DOĞRULANMADI — sonraki saha oturumunda
gerçek sürüşte anons sırası ("X metre sonra <YAKLAŞAN dönüş>") gözlenmeli;
(b) test notu: `react-dom/client` bu repoda import EDİLEMEZ (setup.ts navigator
mock'u prototype getter'ları düşürüyor) → bileşen testleri `renderToStaticMarkup`
+ `?raw` yapısal kilit deseniyle yazılır (bkz. safetyContext.test.tsx);
(c) denetimin yapılmayan işleri: offline routing verisi (`public/maps/` HİÇ YOK —
kod hazır, tooling koşulmadı), gpsService ölü DR iskeleti temizliği, casual follow
watchdog (açık bug D — saha logu şart), K24 eSpeak nav-TTS doğrulaması.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #14): OBD Core v2 — Patch 12D TAMAMLANDI (profil bağlaması + UI + testler)

12C'nin bıraktığı 4 eksik kapandı (bkz. #13):

1. **Profil yükleme bağlaması** — `src/platform/obd/profiles/index.ts` (yeni):
   `MANUFACTURER_DID_PROFILES` registry + `syncManufacturerDidProfile(id)` (saf
   fonksiyon, React'siz). `useStore.ts`: yeni `settings.manufacturerDidProfileId`
   (`'none'|'universal-uds'|'renault-dacia'`, varsayılan `'universal-uds'` — Mali-400
   sıfır-maliyet sözleşmesi nedeniyle zararsız, marka-bağımsız). `useLayoutServices.ts`:
   yeni effect boot'ta VE ayar değişince `syncManufacturerDidProfile` çağırır.
2. **SensorPanel "Marka Verileri"** — `src/components/obd/SensorPanel.tsx`: profil
   yüklüyse görünür, `watchDid`+`active` disiplini, metin DID string, VIN çapraz
   doğrulama rozeti EDGE-TRIGGERED (F190 değişiminde, her render'da DEĞİL —
   `verifyVinAgainstMode09` her çağrıda `recordDiag` yazıyor, spam'i önlemek için).
3. **Keşif ekranı** — `src/components/settings/expert/ManufacturerDidInspector.tsx`
   (yeni), `ExpertModePanel`'e eklendi: profil seçici + tx/rx/from/to keşif aracı
   (ilerleme/iptal/JSON export/panoya kopyala — T507 adb'siz cihaz için).
4. **Testler** — `src/__tests__/obdCoreV2.patch12c.test.ts` (yeni, 23 test): ascii
   decode, verifyVinAgainstMode09 (4 dal), didDiscoveryService (tam tarama/abort
   ikisi/connection_lost/plugin_unavailable/export), iki gerçek profilin şema
   doğrulaması, profiles/index registry+sync. **Suite 2030 yeşil** (+23), tsc temiz,
   vite build OK. Native/Java'ya DOKUNULMADI (12A'nın readObdDid'i aynen kullanıldı).

**Devralan bilsin:** hâlâ CİHAZ DOĞRULAMASI YOK — varsayılan `universal-uds`
profilinin K24/T507'de 7E0/7E8 üzerinden gerçekten yanıt alıp almadığı sahada
bilinmiyor (loadProfile zararsız olsa da, ilk sahada test "F190 hiç okunamıyor"
çıkabilir — bu NORMAL, keşif aracıyla doğru tx/rx bulunur). Renault/Dacia profili
hâlâ yalnız evrensel DID'leri taşıyor — marka-özel DID keşif aracıyla BÜYÜTÜLECEK
(bilinçli, plan gereği). `useLayoutServices` effect'i React-render olarak test
edilmedi (proje renderHook kullanmıyor), yalnız sarmalanan saf fonksiyon test edildi.
Çalışma ağacında ilgisiz WIP'ler (Freeze/DrawerShell/voice-wav/vite.config/
gen-clips.mjs/cdp-longtask.mjs/supabase/.temp + yeni görülen
`navigationHud.turnStep.test.tsx` — başka bir navigasyon oturumunun WIP'i, mevcut
mock hoisting hatasıyla FAIL ediyor, OBD işine dahil edilmedi/dokunulmadı) bilinçli
olarak commit dışı bırakıldı.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #13): OBD Core v2 — Patch 12C KISMİ (ajan limitte kesildi)

`6c171ae` (caros-obd-canbus ajanı oturum limitinde öldü; ana oturum diskteki işi
doğrulayıp — tsc temiz + suite 2007/2007 + guard 97 — SADECE 12C çekirdeğini
commit'ledi): `ascii` decode yolu (VehicleDidValue = number|string, sayısal NaN
sözleşmesi değişmedi), `verifyVinAgainstMode09` (F190 ↔ Mode 09, karşılaştırılamazsa
dürüst matched:null), `didDiscoveryService` (22xx tarama, iptal/kısmi-sonuç, cihaz-üstü
JSON export — T507 adb'siz), `profiles/universalUdsProfile` (ISO 14229-1 Annex C.1) +
`profiles/renaultDaciaProfile` (Renault-özel doğrulanmış DID YOK — bilinçli, keşifle
büyüyecek). **Devralan bilsin — 12D EKSİK:** (1) profiller hiçbir yerden YÜKLENMİYOR
(loadProfile bağlaması yok → şu an ölü kod), (2) SensorPanel "Marka verileri" bölümü
yok, (3) keşif ekranı UI yok, (4) 12C için YENİ TEST YOK (suite sayısı 12A+B ile aynı;
ascii decode + VIN çapraz doğrulama + keşif servisi kilitleri eklenecek). Çalışma
ağacındaki Freeze/worker-iife/wav değişiklikleri BAŞKA işin WIP'i — karıştırma.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #12): OBD Core v2 — Patch 12A+B UDS altyapısı

`c5b7bb5` (caros-obd-canbus, ana oturumda doğrulandı): UDS Mode 22 boru hattı —
withEcuHeader (restore garantili, başarısızlık sessiz değil), readDid (7F
disiplini, 0x78 pending 10s), eval'sız profil formatı, manufacturerPidService
(boşta sıfır maliyet), querySensor DID köprüsü. Suite 2007 + 31 Java testi.
Plan: `docs/OBD_PATCH12_PLAN.md`. **Devralan bilsin:** 12C+D (kamu DID'leri +
Renault profili + keşif aracı + UI) sırada/aşama-2 ajanında; gerçek profil
henüz YOK; ATAR/ATCRA klon davranışı sahada test edilmeli.

## ⭐ ÖNCEKİ İŞ (2026-07-05 #11): OBD Core v2 — Patch 11 teşhis derinliği

`1d7b53e` (caros-obd-canbus ajanı, ana oturumda doğrulandı): Mode 07 bekleyen +
0A kalıcı DTC (tek parser 43/47/4A; 0A "desteklenmiyor" ≠ "kod yok" dürüst ayrımı)
+ Mode 02 freeze frame (formül TS registry'den, tekrar yok) + readiness/enum
PID'ler (`StandardPidEnums.ts`, benzin-dizel bit ayrımı) + DTCPanel bölümleri.
Suite 1973 + 15 Java testi. **Devralan bilsin:** OS entegrasyon dalgası sırada —
`readAllDTCs`/`readFreezeFrame`/`readDiagnosticStatus` API'leri bakım beyni +
sesli asistana bağlanacak (ROADMAP'te); Patch 12 planı `docs/OBD_PATCH12_PLAN.md`.

## ⭐ ÖNCEKİ İŞ (2026-07-04 #10): OBD Core v2 — Patch 10 WiFi ELM327 TCP transport

`4c02cbe` (caros-obd-canbus ajanına delege edildi, ana oturumda doğrulandı):
suite **1951 yeşil** + vite build + Java derlemesi OK. K24'te BT OEM-kilitli
olduğundan OBD'nin tek yolu buydu. Native `connectTcp` mevcut ELM hattını aynen
paylaşır (Patch 2 iptal + link_lost reconnect sözleşmeleri korundu); TS'te TCP
otomatik ble↔classic fallback'ine KATILMAZ (kullanıcının kesin seçimi); UI'da
OBDConnectModal'a IP:Port giriş bölümü. **Devralan bilsin:** cihaz doğrulaması
YOK — K24'e bağlanınca sıra: (1) can_send lever'ı geri aç, (2) WiFi ELM327
adaptörle gerçek bağlantı testi (timeout 8s/15s tahmini, sahada ayarlanabilir).

## ⭐ ÖNCEKİ İŞ (2026-07-04 #9): OBD Core v2 — Patch 9 UI + sesli sorgu (COMMIT'LENDİ)

Önceki oturum limitinde kesilmişti; bu oturumda tamamlandı. Suite **1938 yeşil**
(124 dosya) + vite build OK, iki atomik commit: **9A `a35de62`** (SensorPanel +
DTCPanel `active` + DrawerPanel + screenRegistry 'sensors') ve **9B `5423a82`**
(getOBDDataSnapshot + sensorQueryService + 15 kilit). Native değişiklik yok.
Çalışma ağacındaki DİĞER değişiklikler (DrawerShell/Freeze/voice-wav/vite.config/
VehicleSignalResolver/visionCore/regression.guards worker-compat) BAŞKA işin WIP'i —
bilinçli commit dışı bırakıldı, dokunma.

**9A tasarım notları:** SensorPanel abonelikleri `active` prop'una bağlı — DrawerShell
çocukları unmount ETMEZ (Freeze başka işin WIP'i, ona güvenilmedi); drawer kapanınca
watchPid abonelikleri bırakılır → native EXTENDED polling durur (Mali-400 sözleşmesi).
12 PID izlenir (5C/04/42/46/5E/10/06/07/0E/33/3C/2C); isPidSupported false satırı gizler;
başlıkta getObdHealth bağlantı kalitesi rozeti. Tailwind sınıfları TAM LİTERAL
(şablon-enterpolasyon Tailwind'de üretilmez — QUALITY_STYLES tablosu).

**9B tasarım notları:** `querySensor(soru)` → {name,value,unit,text} | null. CORE alanlar
getOBDDataSnapshot'tan senkron; EXTENDED: taze önbellek (≤30s) anında, desteklenmiyorsa
dürüst cevap, yoksa GEÇİCİ watchPid ile taze ilk değer beklenir (bayat önbellek yankısı
`updatedAt < startedAt` ile elenir; 12s timeout; abonelik HER yolda bırakılır).
SIRADA: intent/beyin katmanına bağlama (feat/assistant-open-app dalının araç-bağlamı
işiyle birleşir — orada VOICE tarafına `querySensor` çağrısı eklenecek; bu dalda
intentEngine'e bilinçli DOKUNULMADI, çapraz dal çakışması riski).

## ⭐ ÖNCEKİ İŞ (2026-07-04 #8): OBD Core v2 — Patch 8 standart PID tam kapsam

`df4f4cf..e7a3c21`: SAE J1979 Mode 01 ~60 sayısal PID (StandardPidRegistry, yalnız
kamu standardı formülleri) + native EXTENDED poll grubu (turda 1 PID round-robin,
liste boşken sıfır maliyet) + extendedPidService (talep-güdümlü izleme, bitmask keşif
zinciri 0100→0160, desteklenmeyen PID sorgulanmaz). Suite **1923 yeşil**, Java OK.
**Devralan bilsin:** UI/sesli asistan henüz bağlanmadı — tüketici `watchPid`/
`getPidValue` (src/platform/obd/extendedPidService.ts) kullanmalı; enum PID'ler +
Mode 22/ISO-TP (üretici-özel katman) sonraki faz; cihaz doğrulaması hâlâ yok.

## ⭐ ÖNCEKİ İŞ (2026-07-04 #7): OBD Core v2 — Patch 1-7 tamamlandı

`feat/obd-core-v2` dalında 7 atomik patch (`f3996a4..371c7c2`, push edilmedi). BC8
kararsız döngü kök nedenleri kapatıldı: obdStatus reason disiplini (P1), iptal
edilebilir connect (P2), doğrulamalı init + protokol öğrenme (P3), yanıt parser (P4),
öncelikli komut kuyruğu (P5), adaptif kademeli polling + yeni PID'ler
throttle/intake/boost/ATRV-voltaj (P6), sağlık skorları `getObdHealth()` (P7).
P6-P7'nin TS tarafı önceki oturum limitinde yarım kalmıştı — bu oturumda tamamlandı.
Doğrulama: vitest **1885 yeşil**, vite build OK, `compileDebugJavaWithJavac` OK.
Kilit testler: `obdCoreV2.patch6.test.ts` + `obdCoreV2.patch7.test.ts`.

**Devralan bilsin:** (1) cihaz doğrulaması YAPILMADI — K24'e bağlanınca İLK İŞ
`settings put system can_send_info_package_name com.cockpitos.pro` (TTS testi
lever'ı kapatmıştı); (2) K24 için sıradaki yol WiFi ELM327 TCP transport (native
`tcpSocket` ölü alan, `ObdTransport`'ta 'tcp' yok); (3) sağlık skorları + yeni
PID'ler UI'a bağlanmadı; (4) çalışma ağacındaki DrawerShell/Freeze/voice-wav
değişiklikleri BAŞKA işin WIP'i — OBD commit'lerine bilinçli dahil edilmedi.

## ⭐ SON İŞ (2026-07-04 #6): Duster "BAŞLATILAMADI / Unexpected token ." — plugin-legacy modernTargets

Duster T507 ilk kurulumda boot-guard'a düştü (fotoğraflı). Kanıt dist'te: modern
`main-*.js` 238 `?.` + 183 `??` taşıyordu — plugin-legacy `modernTargets` verilmeyince
`build.target: es2015`'i sessizce ezip modern chunk'ları **chrome>=105**'e derliyor;
modern-tespit script'i ise yalnız ~Chrome 64 özelliklerini yokluyor → Chrome 64-79
WebView tespiti geçip satır 1'de parse ölümü. K24 (101) şans eseri sağlamdı.
**Fix:** `modernTargets: 'chrome>=64, chromeAndroid>=64'` + `modernPolyfills: true`
(vite.config.ts). Acorn ES2018 taramasıyla boot zinciri doğrulandı; kilit eklendi
("Eski WebView modern paket sözdizimi kilidi"). Suite **1832 yeşil**.
⚠️ Açık iş: 3 Compute worker'ı hâlâ modern sözdizimli (worker pipeline'ı hedef
indirgemeden geçmiyor) — boot'u bloklamaz (module worker <80'de zaten yok, BASIC_JS
fallback bekleniyor) ama Duster'da worker-fallback davranışı sahada test edilmeli.
APK henüz derlenmedi — "apk ver" denince 733883f+bu fix birlikte gider.

## ⭐ ÖNCEKİ İŞ (2026-07-04 #5): Harita "sabit + dönmüyor" GERÇEK kök nedeni — isStyleLoaded kapıları

Saha şikayeti 4bd4ed5'ten SONRA da sürdü (hız 33 gösterirken mini harita kuzey-yukarı,
kamera sabit). Tarayıcıda Playwright + sahte watchPosition ile **Doppler-0 sürüş simülasyonu**
kuruldu → lokal repro + adım adım enstrümantasyon şunu kanıtladı: hareket tespiti DOĞRU
çalışıyor (isDriving=true, hdg=45), ama `setDrivingView` tepesindeki `!map.isStyleLoaded()`
guard'ı HER çağrıda erken dönüyor. İki tetik: (1) updateUserMarker'ın setData'sı stili aynı
senkron karede kirletir — MiniMap'te sıra hep marker→kamera olduğundan kamera %100 ölü;
(2) sürüşte tile yüklenirken isStyleLoaded zaten çoğunlukla false → FullMapView rAF tick'inin
kare-başı kapıları takip yolunu topluca yutuyor. 84237ff+4bd4ed5 semptom tedavisiydi.

**Fix:** setDrivingView/enterNavigationView guard'ı yalnız `!map` (kamera stil gerektirmez;
katman işleri zaten getLayer+try/catch'li); MiniMapWidget stil kapısı yalnız init yoluna;
FullMapView tick + auto-follow + drivingMode girişindeki kare-başı kapılar kaldırıldı.
Teşhis kancası: `window.__MAP_STORE__` (cihazda CDP ile `getState().mapInstance.getBearing()`).
Simülasyonda bearing 0→45° kilitlendi, merkez aracı izliyor. Suite **1831 yeşil** (+4 kilit:
"Sürüş kamerası stil-kapısı yasağı"). **Cihazda canlı doğrulanmadı** — APK istek üzerine.
⚠️ Çalışma ağacında BAŞKASININ WIP'i duruyor: DrawerShell+Freeze (drawer dondurma) ve
freeze.test.tsx commit'lenmemiş — bu işe dahil edilmedi, sahibi karar verecek.

## ✅ ÖNCEKİ İŞ (2026-07-04 #3): Harita "ters gidiyor + takip etmiyor" — hız-bağımsız hareket tespiti

`84237ff` — saha (telefon): araç ikonu doğru yönü gösteriyor ama harita ters akıyor,
konum takibi yok; hız fark etmiyor, tüm harita yüzeylerinde. Teşhis: kullanıcıya 3 soru
(ekran/ikon/hız) + kod analizi → **cihaz Doppler hızını 0'a saplıyor** (coords.heading
çalışıyor — ikon o yüzden doğru). Hıza-mahkûm üç kapı öldü: gpsService `??` fallback
(0 finite!), MiniMapWidget `isDriving=speedKmh>5` (kuzey-yukarı kilidi = "geriye
gidiyoruz" algısı), FullMapView rAF wake/isIdleNow. Fix: `pickRawSpeed` (Doppler>0.15m/s
değilse konum-delta hızı) + delta çapası ≥500ms + yer-değiştirme tabanlı hareket
tespiti (MiniMap histerezisli ~5.5m/2m, FullMap ≥8m). Suite **1824 yeşil**.
**Cihazda canlı doğrulanmadı** — 429 fix'iyle aynı APK'da sahada test bekliyor.
Detay: PROJECT_STATE.md.

## ✅ ÖNCEKİ İŞ (2026-07-04 #2): "İlk istek online, sonrakiler offline" — 429 kota fix paketi

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
