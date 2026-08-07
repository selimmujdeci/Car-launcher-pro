# CAROS PRO — AÇIK TEKNİK BORÇ

> **Yalnız HÂLEN AÇIK** borçlar. Kapanan madde buradan **çıkarılır** (`DONE` durumu yoktur);
> kalıcı iz gerekiyorsa `02_DECISIONS.md` veya `docs/adr/` kullanılır. Tarihçe tutulmaz.
> Öncelik: `P0`–`P3` · Durum: `OPEN` · `BLOCKED` · `FIELD_VALIDATION_REQUIRED` ·
> `HUMAN_DECISION_REQUIRED`. Aktif görev ve roadmap **buraya yazılmaz**.
> Saha kütüğü içeriği kopyalanmaz — otorite `docs/DEVICE_VALIDATION_LEDGER.md`.
> Kimlikler **yeniden numaralandırılmaz**; kapanan kayıt silinir, boşluk normaldir.

## DEBT-002 — Runtime kapasite seçimi SAB varlığına gereksiz bağlanmış olabilir

- Alan: Runtime
- Öncelik: P2
- Durum: FIELD_VALIDATION_REQUIRED
- Kanıt: `_detectCapabilities()` (`AdaptiveRuntimeManager.ts:271-281`) `hasSAB` için `crossOriginIsolated === true` arıyor → DEC-017/DEC-014 gereği üretimde daima `false` → **açılış modu her cihazda `BASIC_JS`**, güçlü donanımda bile. Oysa `BALANCED_CONFIG` ile `BASIC_JS_CONFIG` farkı **tamamen SAB'dan bağımsız**: `gpsUpdateMs` 1000↔2000 · `obdPollingMs` 3000↔5000 · `uiFpsTarget` 30↔20 · blur/animasyon/gölge açık↔kapalı · `suspendWorkers` **ikisinde de false** (`runtimeConfig.ts:37-70`). Kapanı yumuşatan gerçek: `setMode()`'da kapasite tavanı YOK (yalnız güç tavanı, `:303-307`) ve `CognitivePriorityEngine` (`SystemBoot.ts:854`) IMMERSIVE/AWARE'de `setMode(BALANCED,'cognitive-recovery')` çağırıyor → BALANCED **erişilebilir**, ama 30 sn yükseltme histerezisiyle ve yalnız açılıştan SONRA.
- Risk: Yüksek-uçlu head unit açılışta 20 fps · blur/gölge kapalı · 2 sn GPS · 5 sn OBD ile başlıyor. Kurtarmanın gerçek araçta ne kadar sürdüğü — hatta tetiklenip tetiklenmediği — **ölçülmedi**.
- Saha denemesi: **2026-07-27 · DOĞRULANAMADI** (kütük #138). K24 SMART SERIES'te ölçüldü; cihazın kendi Cihaz Teşhisi kartı `Cihaz sınıfı: LOW` · `SAB: yok` gösterdi. LOW **beş** ölçütten tetikleniyor (`cores<=4` · `RAM<=3GB` · `Android<12` · `weakGpu` · `!dvh`) → kod 1. kapıda dönüyor, SAB kapısına hiç ulaşmıyor. Bu cihaz sınıfı hipotezi **ayırt edemez**.
- Kapanış ölçütü: **HIGH-tier** head unit gerekir — dördü BİRLİKTE: `cores > 6` · `RAM > 4 GB` · `Android ≥ 12` · `weakGpu = false` (ek olarak WebView ≥ 90 ve `dvh` desteği; yoksa tier yine LOW olur). Orada ölçülecek: (a) açılış modu, (b) BALANCED'a otomatik geçiş oluyor mu, (c) kaç saniyede, (d) tetikleyen bileşen, (e) 3 tekrarda tutarlılık. Kurtarma güvenilir+hızlıysa borç kapanır; değilse kapasite ekseni `DeviceTier`'a bağlanır (**SAB'ı açmak çözüm DEĞİLDİR**).
- Bağımlılık / blokaj: DEC-017 (SAB açılmayacak) · DEC-014 (kör COOP/COEP yaması YASAK) · **HIGH-tier cihaz erişimi** · **DEBT-011 gözlemlenebilirlik** — üretim APK'sında BALANCED yükseltmesi görünmüyor (`console.info` drop + DEV-only inspector + LAB'da runtime ekranı yok), yani ölçüm o eklemeden önce anlamsız.
- İlgili dosyalar: `src/core/runtime/AdaptiveRuntimeManager.ts`, `src/core/runtime/runtimeConfig.ts`, `src/platform/system/CognitivePriorityEngine.ts`

## DEBT-003 — Android/Java kaynakları CI'da derlenmiyor ve taranmıyor

- Alan: CI
- Öncelik: P1
- Durum: OPEN
- Kanıt: `.github/workflows/` altında `gradlew`/`assembleDebug` referansı **yok**; `codeql.yml:38` yalnız `languages: javascript-typescript`. `android/app/src/test/java/.../{obd,phonehub}` ve `android/phonehub-protocol/src/test` altında birim testler VAR ama hiçbir workflow bunları koşmuyor.
- Risk: Native tarafta derlenmeyen/kırık kod ancak elle APK alınırken fark edilir; Java güvenlik bulguları hiç taranmıyor. Phone Hub gibi ağırlıklı native işler kanıtsız ilerliyor.
- Kapanış ölçütü: CI'da bir Android job'ı `assembleDebug` + `test` koşar ve kırmızıda merge engellenir; CodeQL matrisine `java-kotlin` eklenir.
- Bağımlılık / blokaj: Yok (CI runner maliyeti dışında).
- İlgili dosyalar: `.github/workflows/main.yml`, `.github/workflows/codeql.yml`, `android/`

## DEBT-004 — Eski giriş talimatları yönlendiriciye dönüştürülmedi

- Alan: Documentation
- Öncelik: P1
- Durum: OPEN
- Kanıt: `CONTRIBUTING.md:10` "0. İşe Başlamadan Önce (zorunlu okuma sırası)" ve `:23` "`PROJECT_STATE.md` + `HANDOFF.md` mutlaka okunur"; `docs/project/MASTER_PROMPT.md:3` kendini "TEK GERÇEK KAYNAK" ilan ediyor (audit `DOC-P1-01`). DEC-004 bunları ezer ama kaynak metinler duruyor.
- Risk: Workspace'i bilmeyen bir oturum eski sıraya girip eskimiş durum belgelerini güncel sanır — Workspace'in tüm değeri buharlaşır.
- Kapanış ölçütü: Üç belgenin giriş bölümü `docs/workspace/00_START_HERE.md`'ye yönlendiren tek cümleye indirilir; hiçbiri kendi başına okuma sırası dayatmaz.
- Bağımlılık / blokaj: Yok.
- İlgili dosyalar: `CONTRIBUTING.md`, `HANDOFF.md`, `docs/project/MASTER_PROMPT.md`

## DEBT-006 — Saha doğrulama kuyruğu: açık 🔴 kayıtların tamamı

- Alan: Validation
- Öncelik: P1
- Durum: FIELD_VALIDATION_REQUIRED
- Kanıt: `docs/DEVICE_VALIDATION_LEDGER.md` — 139 kayıt satırı, büyük çoğunluğu 🔴. İçerik buraya **kopyalanmaz**; sayı ve durum için kütük okunur.
- Risk: Test yeşili + `tsc` temiz olan onlarca katman gerçek araçta hiç çalışmamış olabilir (DEC-006). Simülasyon koşucusunun PASS vermesi bu borcu **azaltmaz**.
- Kapanış ölçütü: Bir kayıt gerçek araçta kabul ölçütünü sağlayınca kütükte 🟢'ye taşınır. Bu borç, kütükte açık 🔴 kalmayınca kapanır.
- Bağımlılık / blokaj: **Gerçek araç + head unit erişimi.** Yazılımla kapatılamaz.
- İlgili dosyalar: `docs/DEVICE_VALIDATION_LEDGER.md`

## DEBT-007 — `FUSED` kaynağının GÖNDEREN tarafı ölçülmedi

- Alan: VCOMP
- Öncelik: P1
- Durum: FIELD_VALIDATION_REQUIRED
- Kanıt: `valTypes.ts:48` `SignalSource` `'FUSED'` içeriyor; `VehicleCompute.worker.ts:179` `FUSED` bir GİRDİ değil füzyonun ÇIKTISI diyor. VCOMP-03 kapısı worker'ı korur ama üretimde `source:'FUSED'` mesajı gerçekten gönderiliyor mu bilinmiyor (kütük #137 uyarısı).
- Risk: Gönderiliyorsa asıl kusur `SignalNormalizer` tarafındadır; worker kapısı yalnız semptomu susturur ve o sinyal sessizce düşer.
- Kapanış ölçütü: Gerçek araçta logcat'te `Unknown signal source` sayımı yapılır. Sıfırsa borç kapanır; sıfır değilse gönderen taraf ayrı atomik görevle düzeltilir.
- Bağımlılık / blokaj: DEBT-006 (araç erişimi).
- İlgili dosyalar: `src/platform/vehicleDataLayer/VehicleCompute.worker.ts`, `src/platform/vehicleDataLayer/valTypes.ts`

## DEBT-008 — Mavi karar zincirinde kaynaksız alanlar

- Alan: Mavi
- Öncelik: P2
- Durum: OPEN
- Kanıt: `aiOfflineReason.ts:230` `ProactiveDecisionSource = 'rule' | 'parser' | 'llm' | 'fallback'`; üretimde yalnız `'rule'` yazılıyor. `companionChatProvider.ts:704` yorumu: "fallbackReason: bu yolda KAYNAĞI YOK → yazılmaz."
- Risk: Tip dört kaynak vaat ediyor, gerçek bir tanesini üretiyor. LLM/parser kararları açıklanabilirlik zincirine hiç girmiyor → sahada "neden bu karar?" sorusu eksik yanıtlanıyor.
- Kapanış ölçütü: LLM ve parser yolları da `recordProactiveDecision`'a kendi kaynağıyla yazar **veya** üretilmeyen değerler tipten çıkarılır. Kaynaksız alan yazılmaz kuralı (DEC-016) korunur.
- Bağımlılık / blokaj: Yok.
- İlgili dosyalar: `src/platform/ai/aiOfflineReason.ts`, `src/platform/companion/companionChatProvider.ts`

## DEBT-009 — Active Topic katmanı: ses hattına bağlı değil ve LAB'da görünmüyor

- Alan: CAROS LAB
- Öncelik: P2
- Durum: OPEN
- Kanıt: `evaluateDemonstrativeRequest` (`companionChatProvider.ts:464`) export ediliyor ama üretimde **hiçbir çağıran yok** (yalnız testler + senaryo koşucusu). `getActiveTopicSnapshot` (`:448`) yalnız `devtools/maviScenarioRunner.ts` tarafından okunuyor — salt-okunur bir LAB gözlem ekranı yok.
- Risk: DEC-012'ye göre gözlem yüzeyi olmayan özellik tamamlanmış sayılmaz. Ayrıca belirsiz-zamir fail-closed kapısı gerçek ses hattında hiç devrede değil → koruma yalnız kâğıt üstünde.
- Kapanış ölçütü: (a) CAROS LAB Mavi Konsolu'nda aktif konu + tazelik salt-okunur gösterilir; (b) belirsiz ifade kapısı gerçek ses komut hattına bağlanır. İki iş **ayrı atomik görevdir**.
- Bağımlılık / blokaj: Yok.
- İlgili dosyalar: `src/platform/companion/companionChatProvider.ts`, `src/platform/devtools/maviConsoleModel.ts`

## DEBT-012 — HEAD UNIT THERMAL / PERFORMANCE: gerçek cihazda aşırı ısınma + kasma

- Alan: Runtime
- Öncelik: P0
- Durum: OPEN
- Kanıt: **SAHADA ÖLÇÜLDÜ 2026-07-27** (kütük #139), K24 LOW-tier. Kullanıcı bildirimi ısı sensörüyle doğrulandı: uygulama kapalı referans **CPU ~77–79 °C**; açıkken **85–93.7 °C**; öldürünce **32 sn'de 90.0 → 77.9 °C (−12.1 °C)**. Render: `gfxinfo` **janky %95.68** (9059/9468), p50 **57 ms**, p90 93 ms, p99 150 ms, `Slow issue draw commands` 7495 (%79), `Frame deadline missed` 7751. Thread bazında (ana ekran, boşta): **`CrRendererMain` %27.3** · `Chrome_InProcGpu` %11 · `Compositor` %9 · raster %0.6 · worker %0.6. **Arka planda (görünmezken) bile `CrRendererMain` %16.1** → iş render değil, sürekli JS. RAM: app PSS ~250 MB + renderer ~163 MB, `GL mtrack` 60.9 MB; cihazda 82 MB boş + 228 MB swap kullanımda.
- Risk: Düşük-tier head unit'te kullanılamaz deneyim (her 20 frame'in 19'u janky) + sürekli 85–90 °C. Termal koruma bu cihazda devrede DEĞİL (DEBT-013) → kendini sınırlama yok.
- Kapanış ölçütü: Aynı cihazda aynı senaryolarla önce/sonra ölçüm; janky oran ve `CrRendererMain` payı belirgin düşmeli, uygulama açıkken sürekli sıcaklık referansa yaklaşmalı, kullanıcı "ısınma ve kasma kabul edilebilir" demeli, OBD/kritik DTC/geri manevra/kontak kapısında regresyon olmamalı, `apk:safe` yeşil.
- Kök neden (CDP profili, kütük #140): ana thread %47 meşgul, **%42.5 JS**; stil/yerleşim/boyama ~0 (`Frames 0`). Timer'lar **elendi** (34 canlı interval toplam %0.7), polyfill hipotezi **çürütüldü** (builtin'ler native), render döngüsü **çürütüldü** (0.9 commit/sn). **ASIL:** saniyede ~1 commit, her biri **~913 fiber = tüm ağaç**, commit başına **~447 ms**; long task'lar 300–1206 ms, wall'ın **%46**'sı. Ek: YouTube embed JS'i medya kapalıyken bile çalışıyor (JS zamanının %4.3'ü).
- Bağımlılık / blokaj: ~1 Hz'de tüm ağacı render ettiren **state yazarı henüz isimlendirilemedi** (React batching → commit yığını scheduler'da bitiyor). Ölçülen adaylar: `vehicleDataLayer` rAF flush 1.3/sn · `HorizonClock` 1/sn · `debugStore.updatePerf` 1/sn. Elenen: `safetyService` 200 ms (histerezisli erken `return`), `HorizonClock` (memo + yerel state). Sonraki deney: store `setState` sarmalayıp commit korelasyonu.
- İlgili dosyalar: ölçüm aşaması — **hiçbir üretim dosyası değiştirilmedi**

## DEBT-013 — Termal koruma üretimde VERİ KAYNAĞINDAN YOKSUN

- Alan: Runtime
- Öncelik: P0
- Durum: OPEN
- Kanıt: `thermalWatchdog.injectDeviceTemp()` üretimde **hiç çağrılmıyor** — tek çağıranlar `ChaosSimulator`, `TestControlPanel`, `ScenarioEngine`, `SystemBoot` kaos alıcısı (hepsi DEV/kaos). `CarLauncherPlugin.java`'da termal listener **yok** (`thermalStatus`/`cpuTemp` grep boş). Cihazın Android termal HAL'i de ölü: `dumpsys thermalservice` → `HAL Ready: false`, `Thermal Status: -2147483648`. Buna karşılık **sysfs okunabiliyor**: `thermal_zone0=cpu`, `1=gpu`, `2=ddr`. Yani cihaz 90 °C'ye çıkarken `thermalWatchdog` `source:'unknown'` kalıyor ve L1/L2/L3 eşikleri hiç tetiklenmiyor.
- Risk: `AI.md`/ADR-0002'nin "termal bütçe" invaryantı bu cihaz sınıfında **kâğıt üstünde**. Aşırı ısınmada runtime kendini kısmıyor; DEBT-012'nin şiddetini doğrudan artırıyor.
- Kapanış ölçütü: Üretimde gerçek bir sıcaklık kaynağı bağlanır (native `CarLauncherPlugin` → sysfs `thermal_zone*` okuması → `injectDeviceTemp`), kaynak yoksa `source` dürüstçe `unknown`/`UNAVAILABLE` kalır (sahte sıcaklık ÜRETİLMEZ), ve gerçek cihazda sıcaklık yükselince runtime tavanının düştüğü + düşüş nedeninin görünür olduğu ölçülür.
- Bağımlılık / blokaj: DEBT-011 (düşüş nedeni bugün üretimde görülemiyor). Yeni termal algoritma YAZILMAZ — mevcut `thermalWatchdog` zaten var, eksik olan yalnız **girdi**.
- İlgili dosyalar: `src/platform/thermalWatchdog.ts` (yalnız OKUNDU), `android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java`

## DEBT-014 — OBD fonksiyonel adresleme trafiği İKİYE katlıyor

- Alan: OBD
- Öncelik: P2
- Durum: FIELD_VALIDATION_REQUIRED
- Kanıt: Duster saha dökümü (kütük #142). `ATSH7DF` **fonksiyonel yayın** adresi kullanıldığı için hattaki her ECU yanıtlıyor: `010D → 410D00410D00`, `0105 → 410559410559`, `0121 → 4121000041210000`. Kesin kanıt: `011F → 411F003E411F003D` — **iki FARKLI değer**, yani iki ayrı ECU. Handshake ECU'ları zaten keşfetmiş (`readBlocksCount: 5`).
- Risk: Her standart PID için gereksiz ikinci yanıt → OBD bant genişliği ~2 katı tüketiliyor, tazelik penceresi uzuyor. Zayıf adaptörlerde çoklu yanıt ayrıştırma hatası riski de var.
- Kapanış ölçütü: Handshake'in doğruladığı ECU için fiziksel adresleme (`ATSH7E0`) kullanılır, **başarısızlıkta fonksiyonele otomatik geri düşülür**; gerçek araçta (a) tek yanıt gelmeli, (b) tüm mevcut PID'ler okunmaya devam etmeli, (c) poll turu süresi ölçülebilir kısalmalı.
- Bağımlılık / blokaj: **Gerçek araç gerekir.** Cihazsız gönderilmesi yasak — yanlış fiziksel adres tüm PID akışını kesebilir (protokol davranışı değişikliği).
- İlgili dosyalar: `src/platform/obdService.ts`, `src/platform/obd/ecuDiscovery.ts`

## DEBT-011 — Runtime durumu üretimde GÖZLENEMİYOR (CAROS LAB ekranı yok)

- Alan: CAROS LAB
- Öncelik: P1
- Durum: OPEN
- Kanıt: Sahada ölçüldü (kütük #138): üretim APK'sında runtime modu hiçbir yüzeyden okunamıyor. `runtime_mode_changed` **yükseltme** logu `console.info` → `vite.config.ts:311` `drop_console` ile siliniyor (düşüş `console.warn` olduğu için kalıyor); tek `getMode()` gösterimi `InspectorPanel.tsx:78` `import.meta.env.DEV` kapılı → üretimde tree-shake; CAROS LAB'da runtime ekranı YOK; `NODE_ENV` development olmadığından `webContentsDebuggingEnabled:false` → CDP kapalı, logcat'te JS konsolu sıfır.
- Risk: DEC-012 ihlali — kendi durumu ve zamanlaması olan bir alt sistem gözlem yüzeyi olmadan çalışıyor. Doğrudan sonucu: **DEBT-002 ölçülemiyor** ve termal/güç tavanı kaynaklı kısıtlamalar sahada teşhis edilemiyor.
- Kapanış ölçütü: CAROS LAB'da **salt-okunur** Runtime Diagnostics bölümü; alanlar: mevcut runtime modu · DeviceTier · `hasSAB` · `crossOriginIsolated` · power ceiling · termal durum · son mod değişimi + nedeni + zaman damgası · bekleyen yükseltme/histerezis durumu. Bilinmeyen alan `UNAVAILABLE` gösterilir (sahte 0 yok); ekran komut GÖNDERMEZ; timer/abonelik kurmaz (A3–A8 deseni: `Sources` → saf `Model` → `Screen` + katalog + lazy map + kilit testleri).
- Bağımlılık / blokaj: Yok — üretim davranışı değişmez, yalnız mevcut durum görünür kılınır. ⚠️ Kodlama **henüz başlatılmadı** (kullanıcı kararı bekliyor).
- İlgili dosyalar: `src/platform/devtools/` (yeni `runtimeDiagnosticsSources/Model`), `src/components/devtools/screens/`, `src/core/runtime/AdaptiveRuntimeManager.ts` (yalnız OKUMA)

## DEBT-010 — Durum/yayın belgelerinde çözülmemiş çoklu otorite

- Alan: Documentation
- Öncelik: P2
- Durum: HUMAN_DECISION_REQUIRED
- Kanıt: Audit K-2 — beş proje durumu belgesi, beş farklı tarih; audit `D-02` — `RELEASE_CHECKLIST.md` (kök, 154 satır, izlenen) ↔ `docs/RELEASE_CHECKLIST.md` (87 satır, **izlenmiyor**), içerikleri farklı. Audit §15/1-3: `docs/project/` setinin ve `PROJECT_STATE.md`'nin geleceği süreç kararı.
- Risk: Yanlış belgeden okuyan biri eskimiş yayın adımlarını uygular; birleştirmede içerik kaybı riski **orta-yüksek**.
- Kapanış ölçütü: Sahibi hangi belgenin bağlayıcı olduğuna karar verir; diğerleri yönlendiriciye dönüşür veya arşivlenir ve hiçbir benzersiz madde kaybolmaz.
- Bağımlılık / blokaj: **İnsan kararı** — otomatik çözülemez (audit §15).
- İlgili dosyalar: `RELEASE_CHECKLIST.md`, `docs/RELEASE_CHECKLIST.md`, `docs/project/`, `PROJECT_STATE.md`
