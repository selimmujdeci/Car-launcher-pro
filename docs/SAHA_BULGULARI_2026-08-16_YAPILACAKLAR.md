# 🔧 SAHA BULGULARI — 2026-08-16 · YAPILACAKLAR LİSTESİ

> **Bu dosya bir iş listesidir, rapor değil.** 2026-08-16 tarihli iki cihaz koşumunda
> ölçülen ve **henüz kapatılmamış** her madde burada. Kapatılan madde bu dosyadan
> SİLİNMEZ — durumu `✅ KAPANDI` yapılır ve kanıtı yazılır.
>
> Otorite sırası: `docs/DEVICE_VALIDATION_LEDGER.md` **#598** ve **#599** satırları bu
> dosyanın kaynağıdır. Çelişki olursa **kütük kazanır**.

## Ortam (tüm ölçümler burada yapıldı)

| | |
|---|---|
| Cihaz | Xiaomi **23090RA98I** — Android 13, fiziksel **2712×1220**, dpr 3, 8 çekirdek / 8 GB, Mali-G610, WebView Chrome 150 |
| APK | 16.08.2026 09:24 derlemesi (`C:\Temp\carlauncher\app\build\outputs\apk\debug\app-debug.apk`, 77,4 MB) → kuruldu `lastUpdateTime=2026-08-16 12:54:04` |
| Yöntem | CDP-over-adb (`Network` · `Runtime` domain) · `adb exec-out screencap` · `run-as` ile safeStorage okuması |
| 1. koşum | Araç **park**, OBD **yok** |
| 2. koşum | Araç **hareket** (94–122 km/h), OBD dongle **bağlı** |

---

## 🔴 P0 — ÜRÜNÜ KIRAN, AÇIK

### P0-0 · **YENİ (#602) — Düşen rota isteği "düz çizgi"ye düşüp AKTİF rehberlik gibi sunuluyor**

- **Üretme:** navigasyon ACTIVE iken `am force-stop` → yeniden başlat (ağ dalgalıysa rota isteği düşer).
- **Ölçülen:** `route.serverUsed = "straight-line"` · `steps = 1` · `geometryPts = 2` ·
  `req.failed = 1` · `req.committed = 0`. Haritada rota çizgisi **hiç yok**.
- **Ekran kanıtı:** manevra kartı **"Hedefe vardınız"** — aynı ekranda alt bar **113,9 km**.
  `steps=1` olduğu için tek adım "varış" manevrasıdır → HUD anında "vardınız" der.
- **İkinci kusur (daha ağır):** `match.state=**OFF_NETWORK**`, `match.lateralM=**4575 m**` iken
  `offRoute.state=**ON_ROUTE**`, `reasons=[ON_CORRIDOR]`, `evidence=0`.
  `stepOffRoute` sözleşmesi gereği `deviated` TRUE olmalıydı → **off-route katmanına giden
  `ev` kanıtı map-match'in ürettiğinden farklı** (hangi alan saptığı ölçülmedi).
  Sonuç: sistem 4,6 km sapmayı "rotadayız" sayıyor → **kendi kendini onaramıyor**.
- **YAPILACAK:** (a) rota alınamadıysa rehberlik AKTİF sunulmamalı — düz çizgi bir rota değildir;
  (b) iki otorite aynı soruya aynı cevabı vermeli.
- kütük **#602**

### P0-1 · Filo telemetrisi üretimde tamamen ölü (`push_vehicle_event` → HTTP 400)

- **Durum (2026-08-16 güncellemesi — kütük #603):** migration 066 **PROD'A UYGULANDI**
  ve **sunucu tarafı 🟢 doğrulandı**: dört kolon `is_nullable=YES`/defaultsuz;
  RPC gerçek INSERT senaryosunda (dongle'sız ilk olay) `event_id` döndürdü,
  telemetri satırı **oluştu**, `is_online=true`, dört sinyal de **dürüst NULL**;
  kanıt bloğu kasıtlı `RAISE` ile geri alındı → **kalıntı sıfır**.
  Etkilenen sınıf ölçüldü: **597 aracın 555'i** (filonun %93'ü) hiç telemetri
  satırı oluşturamamış. Ayrıca `tools/prod-apply-sql.ps1` **hatayı yutuyordu**
  (SQL düşse bile exit 0) — onarıldı.
- **🔴 KALAN:** **cihaz ucu** — aynı telefonda HTTP 200 + araç ÇEVRİMİÇİ **ölçülmedi**.
- **Aşağıdaki kök analizi tarihsel kayıt olarak korunur.**
- **Kanıt:** 40 sn'de 9/9 başarısız (önceki pencerede 19/19), `heartbeat` + `location_delta`:
  `{"code":"23502","message":"null value in column \"fuel\" of relation \"vehicle_telemetry\" violates not-null constraint"}`
- **Kök:** migration 042 gövdeden `coalesce(...,0)`'ı kaldırıp bilinmeyeni NULL yaptı (doğru),
  ama kolonlar baseline'dan beri `speed/fuel/rpm/temp real DEFAULT 0 NOT NULL`. 065'e kadar
  hiçbir migration dokunmamış (65 dosya tarandı, 0 eşleşme).
- **Neden kalıcı:** RPC `INSERT ... ON CONFLICT DO UPDATE`; UPDATE dalı `COALESCE` ile korunaklı
  ama oraya ulaşmak için satır ZATEN olmalı. Satır yoksa INSERT NOT NULL'a takılır → OBD'siz araç
  **ilk satırını asla oluşturamaz** → kalıcı 400 döngüsü → `is_online` hiç `true` olmaz →
  **araç filoda sonsuza dek çevrimdışı.**
- **YAPILACAK:** `supabase/migrations/20260816000066_telemetry_honest_null_columns.sql` prod'a uygula.
- **Kabul ölçütü:** aynı cihazda `push_vehicle_event` **HTTP 200** dönmeli; `vehicle_telemetry`'de
  o araca ait satır **`fuel IS NULL`** ile oluşmalı; filo ekranında araç **ÇEVRİMİÇİ** görünmeli.
- **Not:** mevcut satırlara dokunulmuyor (geçmiş 0'lardan "aslında bilinmiyordu" çıkarımı uydurma olurdu).
- Kilit: `prodBaselineSecurityGuards.test.ts` §7 (5 test) — kütük **#598 (A)**

### ✅ P0-2 · **KAPANDI — APK DERLENDİ, KURULDU, CİHAZDA DOĞRULANDI (#602)**

APK `BUILD SUCCESSFUL` 16.08 **15:56:11** → kuruldu `lastUpdateTime 15:57:59`. Sonuçlar:

| Ölçüt | Sonuç |
|---|---|
| #601 (A/B) `perf-low` false | ✅ **DOĞRULANDI** — 60 sn/120 örnek, hiç true olmadı; `data-compat-mode` null, önbellek `"0"` |
| #599 (2) `lowEndScreen` false | ✅ **DOĞRULANDI** — fiziksel 2712×1218@dpr3 artık `low` değil |
| #599 (1) OBD p50 ≤ 700 ms | ✅ **ÖLÇÜT KARŞILANDI** — **591 ms**, elle zorlanmadan (⚠️ p90 2822 ms kuyruk cihazın offline olduğu pencereye denk geliyor → artefakt şüphesi, temiz pencerede tekrar ölçülmeli) |
| #598 (D) SAFE_MODE | ✅ **bu koşumda görülmedi** — ama **kök hâlâ bilinmiyor**, madde açık kalır |
| #601 (C) kırpma ≤50 m | ❌ **ÖLÇÜLEMEDİ** — rota düz çizgiye düşmüştü, kırpılacak gerçek rota yoktu (bkz P0-0) |

**Kalan açık uçlar:** `BASIC_JS` iken `fastMs`in weak dala (1500 ms) girmemesi açıklanmalı —
beklenen ile ölçülen ayrışıyor.

---

### P0-2b · Head unit regresyonu HÂLÂ ÖLÇÜLMEDİ

| Düzeltme | Kütük | Belirti |
|---|---|---|
| `_lowEndScreen()` CSS px → fiziksel px | **#599** | OBD kadansı 2361 ms · harita takılması · perf modu `lite` |
| `applyCompatMode()` `perf-low` geri alma | **#601 (B)** | önbellek "1" kaldığı için #599 tek başına yetmezdi |
| `routeTrimGate` — mesafe tabanlı kırpma | **#601 (C)** | rota aracın arkasında 61 s'ye kadar kalıyordu |

**⚠️ EN ÖNEMLİ NOKTA:** #599 ve #601(B) **birlikte** uygulanmalı. Sadece #599 kurulursa
`cl_compatLowTier="1"` önbelleği yüzünden **ilk açılışta harita yine takılır** ve düzeltme
"işe yaramadı" sanılır.

**Kabul ölçütleri:**
- `obdData` kadansı **p50 ≤ 700 ms** — profil **elle zorlanmadan**.
- `getDeviceTier()` bu cihazda **`low` DEĞİL**; `classList.contains('perf-low')` **false**.
- Harita **ilk açılıştan** akıcı (kamera `easeTo`; `jumpTo`ya düşmemeli).
- Otoyolda 1 km'den uzun segment içinde rota başlangıcı araçtan **≤50 m** geride.
- Duran araçta GPS drift'i kırpma tetiklememeli.

**🔴 REGRESYON ÖLÇÜTÜ (ihmal edilmesin):** gerçek head unit'te (K24, 1024×600@dpr1) tier
**`low` KALMALI**, `perf-low` **KALMALI**, kamera `jumpTo`ya düşmeye **devam etmeli**.
Bu düzeltmeler düşük-uç bütçesini **AÇMAMALI**.

⚠️ Şu an cihazda `fastMs=250` **CDP ile canlı zorlandı** — kalıcı değil.

`src/platform/deviceCapabilities.ts` · `src/platform/headUnitCompat.ts` ·
`src/platform/map/routeTrimGate.ts` · `FullMapView.tsx` · `MiniMapWidget.tsx`
kilitler: `lowEndScreenPhysicalPx` · `compatModeCacheRevert` · `routeTrimGate`

---

## 🟠 P1 — ÖLÇÜLDÜ, KÖKÜ BİLİNMİYOR

### 🔴 P1-1 · Açılışta `SAFE_MODE` — **KÖK CİHAZDA CANLI YAKALANDI: `reason=failure:OBD`** (kütük #604)

> **ASIL KÖK — beklenen üç watchdog'un HİÇBİRİ değil.** Taze APK'da (16.08 19:27)
> açılış konsolu CDP ile dinlendi; log görünürlüğü düzeltmesi sayesinde
> **eski kodda hiç ulaşmayan** satırlar geldi:
>
> ```
> [Runtime] runtime_mode_changed: BASIC_JS → POWER_SAVE  | reason=failure:OBD
> [Runtime] runtime_mode_changed: POWER_SAVE → SAFE_MODE | reason=failure:OBD
> ```
>
> `obdService.ts:1864` her OBD kopmasında `reportFailure('OBD')` çağırır;
> `AdaptiveRuntimeManager.reportFailure` (`:581-594`) modu **histerezisi
> atlayarak bir kademe indirir** ve **yukarı çıkaran karşılığı YOKTUR**
> (`reportRecovery` diye bir şey yok) → **tek yönlü circir (ratchet)**.
> Dongle takılı DEĞİLSE mod ~40 sn'de `SAFE_MODE`'a iner ve bir daha çıkmaz.
>
> **Saha verisini birebir açıklıyor:** 1. koşum dongle YOK → SAFE_MODE görüldü;
> 2. koşum dongle BAĞLI → görülmedi. Çelişki sanılan gözlem tutarlıymış.
>
> **İki ek bulgu:** (a) kalıcı `rt-last-mode` kaydı **iki katmanda** durur
> (dosya + localStorage; `safeGetRaw` göç dalına düşer) → tek katmanı silmek
> cihazı SAFE_MODE'dan çıkarmaz. (b) `start()` crash-recovery dalı kaydı
> **yeniden yazar** ve hiçbir yer temizlemez → güvenlik ağı **hiç devreden
> çıkmıyor**; bir kez SAFE_MODE'da biten oturum sonraki her açılışı sabitler.
>
> **DURUM — 2026-08-16 ikinci tur (kütük #606):** politika kararı verildi, **1 ve 2
> KAPATILDI**, **3 açık kaldı**.
>
> 1. ✅ **KAPATILDI** — `_scheduleReconnect()` artık yalnız `_lastKnownAddress &&
>    _isAddressProven()` iken arıza bildirir: dongle **yokluğu** arıza değildir.
>    ⚠️ **Dürüstlük notu:** cihazdaki adres **kanıtlıydı** → bu tek başına saha
>    vakasını çözmezdi; asıl koruma (2)'dir.
> 2. ✅ **KAPATILDI** — `reportFailure` **bileşen başına tek kademe** iner (latch),
>    tabanı **`POWER_SAVE`** (biriken arıza SAFE_MODE'a indiremez) ve yukarı
>    karşılığı **`reportRecovery()`** eklendi: tüm arızalar geçince mod arıza öncesi
>    seviyeye 30 sn histerezisle geri çıkar. Kurtarma hedefi `_detectCapabilities()`
>    ile yeniden hesaplanmaz (`runtimeOverride`'ı ezmemek için, #601(B) dersi) ve
>    başka bir otorite modu devraldıysa hedef unutulur. OBD kurtarması bağlantı
>    başarısında, worker kurtarması canlı `registerWorker` referansında bildirilir.
>    **Kanıt:** 16 yeni kilit; latch+taban geçici geri alınınca 4 test düşüyor.
>    **Gözlem:** CAROS LAB → Performans ekranında aktif mod · tavan · arızalı bileşen
>    listesi · kurtarma hedefi (salt-okunur).
> 3. 🔴 **AÇIK** — crash-recovery **tek atımlık** olmalı (kaydı tüketmeli), her açılışı
>    sabitlememeli. Ayrı bir güvenlik-ağı politikası kararıdır; tahminle değiştirilmedi.
>    Circir kapandığı için kaydın *yeni* zehirlenmesi `failure:OBD` yolundan artık
>    gelemez, ama **hâlihazırda zehirli bir cihaz kendi kendini kurtaramaz**
>    (iki katman: dosya + localStorage).

**Aşağıdaki `onTrimMemory` kökü de GERÇEKTİR ve düzeltildi — ama bu koşumun
tetikleyicisi O DEĞİLDİ; arka-plana-alma senaryosu hâlâ cihazda ölçülmedi.**

- **Kanıt (saha):** soğuk açılıştan ~2 dk sonra `SAFE_MODE`; ~15 dk sonra `BALANCED`.
  `_detectInitialMode()` SAFE_MODE **döndüremez** → modu bir watchdog commit ediyordu,
  ama `[Runtime] runtime_mode_changed` satırı bir türlü yakalanamıyordu.
- **KÖK #1 — native `onTrimMemory` eşleştirmesi yanlıştı (iki dosyada birden):**
  şiddet testi `level >= TRIM_MEMORY_RUNNING_CRITICAL` (**>= 15**) idi. Ama
  `TRIM_MEMORY_*` **monoton bir ölçek değildir**: `UI_HIDDEN=20` · `BACKGROUND=40` ·
  `MODERATE=60` · `COMPLETE=80` **"arka plana düştün"** bildirimidir, baskı değil.
  Zincir ürün kodunda uçtan uca doğrulandı: `"CRITICAL"` → `memoryWatchdog:63`
  `setMode(SAFE_MODE)` → `_commit()` diske yazar → sonraki açılışta `start()`
  **SAFE_MODE'a sabitler**. Yani **Home tuşuna basmak** kalıcı SAFE_MODE üretiyordu.
  Ayrıca eski `else if (>= MODERATE=60)` dalı **erişilemezdi** → gerçek ön-plan
  uyarıları (5/10) hiç işlenmiyordu.
- **KÖK #2 — log kendi geçişinin kurbanıydı:** `_commit()` önce modu yazıp sonra
  logluyordu; `logGate` yürürlükteki modun seviyesini okur (`SAFE_MODE` → `silent`)
  → **geçişi duyuran satır susturuluyordu.** Yeni `rawConsole.ts` ile mod değişimi
  satırları kapıdan bağımsız yazılır (kapı asıl işini sürdürür).
- **Kilit:** `safeModeTriggerGuards.test.ts` (8 test).
- **🔴 CİHAZDA ÖLÇÜLMEDİ:** Home tuşu → SAFE_MODE OLMAMALI · logcat'te
  `onTrimMemory level=20 → arka plan sinyali` görülmeli · yeniden açılışta
  `rt-last-mode` SAFE_MODE yazmamalı. — kütük **#604**

### P1-2 · SAB/COI kapalı ama runtime `BALANCED` — çelişki

- **Kanıt:** cihazda `typeof SharedArrayBuffer === "undefined"`, `crossOriginIsolated === false`,
  buna rağmen `data-runtime="BALANCED"`.
- **Neden şüpheli:** `_detectInitialMode()` `!hasWorker || !hasSAB` durumunda **`BASIC_JS`** döndürmeli.
  BALANCED görünmesi ya sonradan bir `setMode(BALANCED)` çağrısının kapıyı atladığını ya da
  tespitin hiç çalışmadığını gösterir.
- **YAPILACAK:** hangi çağrının BALANCED'a taşıdığını bul; SAB yokken yükseltme mümkün olmamalı.
- **Uyarı:** bu **doğrulanmış kusur değil**, çelişkili gözlemdir. İlgili geçmiş: SAB/COI prod'da kapalı.

### P1-3 · Bir kez görülüp tekrarlanmayan bulut hataları

- `GET /rest/v1/vehicle_commands` → **401** (açılışta). Sonraki iki pencerede tekrarlamadı →
  **token tazeleme yarışı** şüphesi. **YAPILACAK:** tekrar üret ve gövdesini oku.
- ~~`GET /rest/v1/raw_community_events` → **404**~~ → **✅ YENİ BULGU DEĞİL.**
  `communityService.ts:398-413` bu durumu **zaten tanıyor**: şemada tablo yoksa senkronu o oturum
  için durduruyor ve açıkça logluyor; `regression.guards.test.ts:4625`'te kilidi de var.
  Yani bu **bilinen açık borç** (tablo prod şemasında yok), yeni kusur değil. Ayrı takip edilmeli.
- kütük **#598 (F)**

---

## ✅ P2 — GÖRSEL / YERLEŞİM · **KAPANDI (kütük #605)** — 2'si gerçek, 2'si artefakt

**Ölçüm yöntemi düzeltildi (asıl bulgu):** saha turu ham `getBoundingClientRect()`
kullanıyordu; o kutu ne `overflow` kabında **kaydırılmış** çocukları ne de
`opacity:0` katmanları bilir → "kesişiyor ama BOYANMIYOR" üretir. Bu tur
Playwright + gerçek Chromium ile **kırpma + görünürlük + örtülme** farkındalıklı
ölçüm kuruldu; **4 viewport × 3 ürün durumu** tarandı
(904×406@dpr3 · 406×904@dpr3 · 1024×600@dpr1 · 1280×480@dpr1.5).

| # | Bulgu | Sonuç |
|---|---|---|
| P2-1 | `SAHA TESTİ AKTİF` rozeti `CAROS` mührünü örtüyor | ✅ **GERÇEK → DÜZELTİLDİ.** 904×406: amblem %61 · `CAR` %64 · `OS` %67 · 1280×480: üçü de %51 · 1024×600: %24/%15. **Telefona özel değil** → genel düzeltme. Çapa 6 aday × 9 durum sınanarak seçildi; **yalnız "başlık altı + yatay orta" 9/9 temiz**. Sonrası: örtüşme **sıfır** |
| P2-2 | `YOL/HİBRİT/UYDU` düğmeleri birbirine biniyor | ❌ **ÇAKIŞMA YOK — artefakt.** Boşta üç düğme ayrık (361,9..385,7 · 435,3..475,5 · 524,9..558,9). Navigasyonda katman şeridi ve koordinat okuması `opacity:0` → **çizilmiyorlar**, yol adı çipi üstlerine binemez. Kod değişmedi |
| P2-3 | `ÖZEL KONUMLAR` üstünde sahipsiz yarı saydam kare | ✅ **GERÇEK → DÜZELTİLDİ.** Kare = **`Yol durumu bildir`** düğmesi (48×48, etiketsiz). Sol alt köşenin **iki sahibi** vardı (kart sütunu +10, düğme +18). %30/%15 · %28/%14 · %22/%11 → üç çözünürlükte de. Sütun düğmenin şeridinin üstüne alındı (76). Sonrası: **sıfır** |
| P2-4 | Alt bar etiketleri çakışıyor (`Bildirim`↔`Klima`) | ❌ **ÇAKIŞMA YOK — artefakt.** `Bildirim` · `Menü` · `Telefon` **dört viewport'ta da HİÇ BOYANMIYOR** (`DockScrollZone` içinde kaydırılmış/kırpılmış). Boyanmayan etiket çakışamaz. Kod değişmedi |

**Yan bulgu (aynı ölçümde yakalandı):** gerçek tarayıcıda uygulama **açılışta
çöküyordu** — `Cannot access 'MAP_BG_NIGHT' before initialization`
(`_mapState` ↔ `mapStyleBuilders` dairesel bağımlılığı; **#552'de kapatılan
döngünün ikinci yarısı**). Token'lar döngüsüz `_mapIds`e taşındı.

### 🔴 P2-5 · YENİ AÇIK BORÇ — harita köşelerinde **paylaşılan bütçe yok**

- `ONLINE` kaynak rozeti (`MapOverlay`, `top-8 right-8`) ile `KAPAT`/`ANA EKRAN`
  düğmesi **üç çözünürlükte de** çakışıyor: **%86/%65 · %70/%52 · %39/%29**.
- 7 aday konum sınandı — **6 durumun hepsinde temiz olan tek slot YOK.**
  Bu tek bir çipin yanlış yeri değil; `useDenseHud` şerit modelinin harita
  HUD'una da gerekmesidir.
- Ayrıca 1280×480 navigasyonda ikonlu bir düğme (66×44) `ANA EKRAN` ile **%63/%29**.
- **YAPILACAK:** tahminle taşıma YOK — önce köşe bütçesi sözleşmesi kararı.
- kütük **#605**

---

## 🔵 P1.5 — RADAR / DENETİM NOKTASI (3. koşumda ölçüldü — kütük #600)

### P1.5-1 · Şehirlerarası otoyolda denetim kapsamı pratikte YOK

- **Ölçüm:** paket sağlıklı (HTTP 200, `EGM_EDS_MAP`, **1503 nokta**, `fetchedAt 2026-08-13`).
  Tip: `UNKNOWN` 1400 · `AVERAGE_SPEED` 81 · `RED_LIGHT` 14 · `PARKING` 8.
- **Mevcut konumda:** 60 km yarıçapta 23 nokta var ama **önde (±60°) 0** — 23'ü de Gaziantep
  şehir içi, 24–27 km **geride**.
- **Gerçek rota geometrisiyle kesişim (276 km, OSRM):** rotaya 500 m içinde **yalnız 9 nokta**,
  ve **9'unun da rotaya uzaklığı 200–348 m** — hiçbiri yolun üstünde değil.
  9'unun **tamamı** `type=UNKNOWN`, `speedLimitKph=null`, `directionHint=null`.
- **Bu bir kod kusuru DEĞİL, kaynak kapsamı kusuru.** EGM EDS paketi şehir içi yoğun,
  şehirlerarası otoyolda boş.
- **YAPILACAK (karar gerekiyor):** şehirlerarası için ikinci kaynak mı, yoksa ürün açıkça
  **"bu yolda veri yok"** mu demeli? ⚠️ **Boş liste "denetim yok" diye sunulmamalı** —
  paket dokümanının kendi kuralı bu.

### P1.5-2 · Yol dışı noktalar için rota-göreli filtre yok → yanlış uyarı riski

- Uyarı kapısı: `RADIUS_M=700` + `AHEAD_HALF_ANGLE_DEG=±60`.
- Rotanın **200–348 m yanındaki** bu 9 nokta yaklaşırken **uyarı üretecek** — yani otoyolda
  hiç geçilmeyecek bir yan yol kamerası için uyarı. Kaynakta yön olmadığı için filtrelenemiyor.
- Paket dokümanı bunu *"mesafe kuş uçuşudur, rota boyunca DEĞİL"* diye **beyan ediyor** (DERIVED)
  → gizli kusur değil. Ama artık **ölçüldü**: bu rotadaki **9/9** nokta yol dışı.
- **YAPILACAK:** aktif rota varken noktanın **rotaya yanal uzaklığı** eşiği aşarsa uyarı
  bastırılmalı mı? Karar + ölçüm gerek.

### P1.5-3 · Uyarının fiilen tetiklendiği görülmedi

- Bu koşumda **önde nokta olmadığı için** tetiklenme ölçülemedi.
- **YAPILACAK:** gerçek bir denetim noktasına yaklaşırken uyarı cihazda **görülmeli**.

---

## ⚪ P3 — ÖLÇÜLEMEDİ (kusur değil, eksik ölçüm)

| # | Konu | Neden ölçülemedi | Ne zaman ölçülür |
|---|---|---|---|
| ~~P3-1~~ | ~~Navigasyon çekirdeği~~ | — | **✅ ÖLÇÜLDÜ, SAĞLAM** — aşağıdaki tabloya taşındı |
| P3-2 | **#596** kopma defteri kurtarma süresi | 1. koşumda dongle yoktu | dongle bağlıyken kopma üret |
| P3-3 | **#584/#585** sürüş güvenliği kapısı + araç içi hız uyarısı (araç-içi ucu) | 1. koşumda dongle yoktu | eşik aşımıyla |
| P3-4 | Görsel çakışmaların head unit'teki durumu | yalnız telefonda ölçüldü | K24 / gerçek HU |
| P3-5 | **Reroute davranışı** | 67 sn boyunca hiç rotadan çıkılmadı (0 reroute) | kasıtlı sapmayla |

---

## 🔍 P4 — GÖZLEM (kusur iddiası YOK, bakılacak)

- **safeStorage'da büyük dosyalar:** `cl_crash_log.json` **490 KB** · `caros.lab.longRoadBlackBox.v1.json` **495 KB**.
  Açılışta okunuyorlarsa bellek/IO tepesi yaratabilir — **P1-1 (SAFE_MODE) ile ilişkili olabilir**, bağ ölçülmedi.
- **5 adet `crash-log-*`** kaydı (2026-08-07 → 2026-08-16), `peakG` 6,4–7,0.
  Telefon elde taşınırken üretilmiş **yanlış pozitif** olabilir; gerçek çarpışma kanıtı olarak alınmamalı.
- **Bu araçta desteklenmeyen PID'ler:** `engineTemp` · `fuelLevel` · `throttle` · `intakeTemp` ·
  `boostPressure` **daima −1**. `speed` · `rpm` · `voltage` (13,3 V) geliyor.
  **Bu bir kusur DEĞİL** — aracın PID desteği. Ekranda `—` görünmesi doğrudur.

---

## ✅ BU KOŞUMDA DOĞRULANANLAR (kapandı)

| Kütük | Ne | Kanıt |
|---|---|---|
| **#592** | `theme_change` artık geçersiz tema kimliği yazmıyor | `dataset.theme = "expedition-day"` |
| **#597** | Araç içi tema editörü gerçekten söküldü | dağıtılan `dist/assets/`'te `EditPanel` · `editStyleEngine` · `useEditStore` · `car-edit-system-v4` **yok** |
| **#108** | Kadans kapısı sahte "OBD öldü" üretmiyor | tepe 5570 ms → eşik ≈11 s, yanlış alarm yok |
| — | **GPS bayat değil** (karşıtlık kanıtı) | 60 örnek: fix yaşı p50 **458 ms**, **1,06 Hz**, doğruluk 1,6–1,8 m |
| **#600** | **Navigasyon çekirdeği sağlam** — aktif rotayla, 101–115 km/h'te ölçüldü | rota kurulumu **625 ms** (11 adım, 2484 nokta, OSRM) · 67 sn / 158 örnek: `ACTIVE` **158/158**, `MATCHED` **158/158**, `ON_ROUTE` **158/158**, **reroute 0**, off-route yanlış pozitif **0** · güven p50 **0,941** · yanal sapma p50 **4,4 m** · yön farkı p50 **0,76°** · `distSource=ALONG_ROUTE` (kuş uçuşu değil) · kalan mesafe düşüşü GPS hızıyla tutarlı · yol sınırı **130** doğru |

---

## 🔍 Küçük dürüstlük notu (3. koşum)

- Kısayol **"Ev 253,3 km"** diyordu, rota **289,0 km** çıktı. Fark doğru (kuş uçuşu ↔ yol mesafesi)
  ama **etiket bunu ayırt etmiyor** — kullanıcı 253 km sanıp yola çıkar. Kısayoldaki km ya
  "kuş uçuşu" diye işaretlenmeli ya da rota mesafesi gösterilmeli.

---

## Sıradaki en kısa yol

1. **P0-1** → migration 066'yı prod'a uygula (filo telemetrisi tek hamlede geri gelir).
2. **P0-2** → APK derle + kur; OBD kadansını ve tier'ı doğrula; **head unit regresyonunu da ölç**.
3. **P1.5-1 / P1.5-2** → radar kaynağı ve yol dışı filtre kararı (ikisi de **ürün kararı**, kod değil).
4. **P1-1** → önce SAFE_MODE logunu görünür yap, sonra kökü ara.
5. **P2** → yol adı çipi ↔ katman düğmesi çakışması (kökü artık kesin biliniyor).
