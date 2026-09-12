# ENVANTER — BAĞLANTI / EKSİKLİK DENETİMİ (2026-08-12)

> **Bu belge YALNIZ ENVANTERDİR.** Hiçbir dosya değiştirilmemiştir, hiçbir düzeltme
> yapılmamıştır. Amaç: Guardian'ın motorsuz olması · DR sinyalinin ölü olması ·
> VIN maskesinin dağılması · akünün dört otoritesi gibi bulguların **tekrar eden bir
> hastalık sınıfı** olup olmadığını ÖLÇMEK.

---

## 0. YÖNTEM (nasıl ölçüldü — tahmin değil)

| Kontrol | Ölçüm yöntemi |
|---------|----------------|
| **K1 — Kablo döşenmiş, uca bağlanmamış** | `src/**/*.ts(x)` içindeki tüm `export function/const/class` sembolleri çıkarıldı (5173 sembol), her sembolün **ürün yolunda** (test dosyaları hariç, **kendi dosyası hariç**) geçtiği dosya sayısı token indeksiyle sayıldı. Sıfır çıkanlar `grep` ile tek tek doğrulandı (yalnız tanım satırı dönüyorsa **teyitli yetim**). |
| **K2 — İkinci otorite** | Aynı fiziksel olguyu ölçen sabitler/fonksiyonlar desen taramasıyla toplandı (`*STALE*`, `*FRESH*`, `*MAX_AGE*`, `*TTL*`, `*TIMEOUT*`, `mask*`, `*L_PER_100KM*`), sonra **aynı olguyu farklı sayı/mantıkla** ölçenler eşleştirildi. |
| **K3 — Yarım özellik (AVAILABLE ama içi boş)** | Her LAB ekranının okuduğu kaynak modüller import grafiğinden çıkarıldı; **okuma ucu** ile **yazma ucu** ayrı ayrı sayıldı. Okuyan var + yazan yok = yapısal olarak sonsuza dek boş ekran. |
| **K4 — Belge-kod ayrışması** | Katalog `note` metinleri, dosya başlığı yorumları ve kütük iddiaları koddaki gerçek davranışla karşılaştırıldı (otomatik doğrulanabilir iddialar önce). |
| **K5 — Sessiz varsayılan** | `?? 0`, `\|\| 0`, `?? -1` desenleri ürün yolunda tarandı; uzunluk/indeks/matematik gürültüsü elendi; **ekrana çıkan veya karara giren** alanlar ayrıldı. |

**Ölçüm aracı:** `scratchpad/orphan-scan.mjs` (token indeksli export/kullanım sayacı).
**Kaba sonuç:** 5173 export sembolünden **1664'ünün ürün yolunda çağıranı yok.**
Bunların büyük çoğunluğu kendi dosyasında kullanılan enum/etiket sabitidir (gürültü);
aşağıda **yalnız teyit edilmiş, davranışı olan** yetimler raporlanmıştır.

---

## 0.1 ⚠️ DÜZELTME TURU (2026-08-13) — ALTI BULGU GERİ ÇEKİLDİ, İKİSİ DARALTILDI

Düzeltme çalışması başlarken bulgular **ikinci bir yöntemle** yeniden ölçüldü ve
ilk turun ölçüm yönteminde **sistematik bir zayıflık** bulundu:

> Sayaç "kendi dosyası hariç" saydığı için, bir sembol **aynı dosyadaki bir
> sarmalayıcı** üzerinden dışa açılıyorsa "yetim" görünüyordu. Sarmalayıcının
> kendi dış çağıranı varsa sembol aslında **canlıdır**.

Yeni yöntem her sembol için **iki sayı** üretir: `dis` (dış çağıran) ve `ic` (aynı
dosyadaki çağrı). `dis:0 ic:0` → **kesin yetim**. `dis:0 ic>0` → sarmalayıcı zinciri
**elle takip edilmeli**. Tüm E-serisi bu testten geçirildi.

### Geri çekilen bulgular (ölçüm hatası — kusur YOK)

| Bulgu | Neden yanlıştı | Gerçek durum |
|-------|----------------|--------------|
| ~~**E-08**~~ `getLocationContext` | `_registerLocationContextReader(getLocationContext)` ile kaydediliyor; o kaydın **3 dış çağıranı** var | **CANLI** |
| ~~**E-13**~~ `attachUserChoice` | Zincir: `MapSearchBar.tsx:18` + `addressNavigationEngine.ts:24` → `noteAddressSearchChoice` → `noteUserChoice` → `attachUserChoice` | **CANLI** — "kullanıcı seçti" kanıtı ÜRETİLİYOR |
| ~~**E-14**~~ `getGeocodeProvider` | `premiumGeocode` (`dis:2`) ve `getGeocodeProviderStatus` (`dis:3`) üzerinden; `geocodingService.ts:492` gerçekten çağırıyor | **CANLI** — BYOK premium katmanı bağlı |
| ~~**E-18**~~ Akü kanıt kaynağı | `startBatteryEvidenceSource()` **SystemBoot:840**, `startBatteryVerdictService()` **SystemBoot:846**; `ingestVoltageSample` OBD olayına biniyor | **CANLI** — akü kanıt zinciri çalışıyor |
| ~~**E-07**~~ Location Engine boş | `startLocationEngine` **dis:2** → motor başlatılıyor; `HEAD_UNIT_GPS` **yerleşiktir**. `registerLocationProvider` yalnız harici taşımalar içindir ve dosya bunu zaten yazıyor ("bu turda hiçbir yerden çağrılmıyor — arayüz gelecek taşıma için hazır") | **CANLI** — beyan edilmiş borç, kusur değil |
| ~~**E-23**~~ AI Core runtime | `platformCoreAiRuntimeWiring.ts:155` `new AiCoreRuntime({…})` — sınıf DOĞRUDAN kullanılıyor; ölü olan yalnız `createAiCoreRuntime` **fabrikası** | **CANLI** |
| **E-28** (daraltıldı) | `reason()` ana karar fonksiyonu `batteryVerdictService.ts:158`'den çağrılıyor ve `startBatteryVerdictService` **SystemBoot'ta canlı** → Reasoning Engine KARAR ÜRETİYOR | Karar üretimi **CANLI**; ölü olan **defter/kuyruk** katmanı (`recordReasoning` · `transitionReasoning` · `maviReasoningStore`) → LAB ekranı bu yüzden boş |
| **E-15** (daraltıldı) | `resolveDriverPresence` **5 dosyadan** çağrılıyor → attribution kararı canlı | Karar **CANLI**; ölü olan **defter yazımı** (`driverPresenceStore` · `normalizePresence` · `bindPresenceVehicle`) ve **DNA üretimi** (`buildDna` · `accumulateTrip`) |
| **E-35** (kısmen) | `addGeofenceZone` doğrudan çağrılmıyor ama `setGeofenceCenter` (`SecuritySuite.tsx:257`) → `addGeofenceZone`; `initGeofence()` **main.tsx:73** kalıcı zonları yüklüyor | Besleme ucu **CANLI**; "iki otorite" tespiti geçerli kalır |

**Ders:** statik "sıfır çağıran" sinyali tek başına kanıt değildir — sarmalayıcı
zinciri takip edilmeden bulgu ilan edilemez. (Aynı ders `feedback_audit-falsification-discipline`
kaydında zaten vardı: *"7 YÜKSEK bulgunun 3'ü yanlıştı."*)

**Ayakta kalan bulgular** aşağıda işaretlidir; hepsi `dis:0 ic:0` (kesin yetim) veya
sarmalayıcı zinciri de ölü olarak **ikinci yöntemle teyitlidir**.

---

## 0.2 ✅ İKİNCİ DÜZELTME TURU (2026-08-13, öğleden sonra) — KALAN SIRA KAPATILDI

Kalan sıra (`E-17/E-16/E-15 · E-25 · E-26 · E-20 · E-33 · E-29/E-31/E-32 ·
sahte-sıfır sınıfı · E-02/03/04`) tek tek ELE ALINDI. Sonuç ikiye ayrıldı:
**gerçek kusur** olanlar kapatıldı, **yanlış sınıflandırılmış** olanlar
düzeltildi. Kütük: **#562–#567**.

### (a) Geri çekilen / yeniden sınıflandırılan bulgular

| Bulgu | İlk iddia | ÖLÇÜM | Gerçek durum |
|-------|-----------|-------|--------------|
| ~~**E-17**~~ AI Evidence | "Kanıt omurgasına hiç yazılmıyor" | `aiEvidenceEngine.ts:386` kendi başlığında: *"Kanıt deposu — head unit'te **BİLİNÇLİ OLARAK BOŞTUR**. Kanıt omurgası sunucuda yaşar (migration 055) … bu depo yalnız gelecekte bir okuma köprüsü bağlandığında dolacak sözleşmeyi ve LAB'ın dürüst 'henüz yok' cevabını sağlar."* Ekran (`AiEvidenceEngineScreen`) `source: NONE` + `UNAVAILABLE` gösteriyor. | **BEYAN EDİLMİŞ BORÇ** (E-07 sınıfı) — kusur değil. Eksik olan **sunucu okuma köprüsü** (`setFromServer` çağıranı). |
| ~~**E-16**~~ Fleet Intelligence | aynı | `fleetIntelligenceEngine.ts:417` aynı beyanı taşıyor (migration 054); `FleetIntelligenceScreen` başlığı: *"köprü bağlı değilse **dürüstçe 'veri yok' der**"*. | **BEYAN EDİLMİŞ BORÇ** |
| ~~**E-15**~~ Driver DNA/Presence | aynı | `driverDnaEngine.ts:615` aynı beyan (migration 053); `driverPresence.ts` başlığı: *"**BU PAKETTE GERÇEK KAYNAK YOK** — NFC ve Bluetooth uygulanmadı."* | **BEYAN EDİLMİŞ BORÇ** |
| ~~**E-25**~~ Media `claimFor` | "Ana dürüstlük mekanizması ölü" | Zincir CANLI: `platformCoreMaviVoiceWiring.ts:144` → `claimOf: honestClaim` → `maviMediaAuthorityPort.describeOutcome`. Ölü olan yalnız `claimFor` **sarmalayıcısı** (gateway re-export'u). | **CANLI** — "istek ≠ ses çıkıyor" ayrımı üretiliyor. |
| **E-31 / E-32** | "Kapı hiç sorulmuyor" (K1) | `startLongRoadSession` kritik kapı listesini **elle kopyalamıştı**; `buildAcceptanceMatrix` senaryo hükmünü 3 satırda tekrar yazmıştı. | **SINIF DEĞİŞTİ: K1 → K2** (ikinci otorite). Tek otoriteye bağlandı (#565). |
| **E-29** | "Wiring sonraki PR'a bırakıldı" | Canlı Mavi köprüsü varsayılan **SHADOW** modda ve yalnız `PILOT_ACTION_IDS` için handler kurar; keşif **araca aktif sorgu** gönderir. | **Eksik olan wiring satırı değil, TAKEOVER POLİTİKASI kararı.** Borç açık, gerekçe dosya başlığına yazıldı. |
| **E-02 / E-03 / E-04** | "Ölü motor" | `tripApplyComposition` başlığı: *"UI/Voice action KAYDI YOK — tetikleme ayrı bir PR'ın işi."* | **BEYAN EDİLMİŞ SINIR.** Kök kapatılmadı; **KAPI kuruldu** (LAB'da "BAĞLANMADI" + kilit testi → sessiz bağlanma imkânsız). |

> **Ders (ikinci kez):** bir modülün "besleyeni yok" olması tek başına kusur
> değildir. **Dosyanın kendi başlığını okumak** ölçümün parçasıdır: beyan
> edilmiş borç ile sessiz boşluk aynı şey değildir. İlk turda 6, bu turda 4
> bulgu daha bu nedenle geri çekildi/yeniden sınıflandırıldı.

### (b) Kapatılan GERÇEK kusurlar

| Bulgu | Kusurun bedeli | Düzeltme | Kütük |
|-------|----------------|----------|-------|
| **E-26** Media kurtarma | Deneme sayacı hiç sıfırlanmıyordu → 3 açılış sonrası process-death kurtarması **kalıcı** ölüyordu | `runRecovery` başarıda `markRecoverySucceeded` + yeni `recoverySucceeded` sayacı | #562 |
| **E-20** Phone Hub onayı | El sıkışma "kullanıcı onayı" adımında kalıyordu → RFCOMM oturumu hiç kurulamıyordu (#122'nin kod ucu) | LAB'a onay/ret kapısı; kod yalnız anlık okunur, dışa aktarıma girmez; **kod görülmeden onay yok** (MITM kapısı) | #563 |
| **E-33** Kaza günlükleri | Yazılıyor ama **hiçbir yüzeyden okunamıyordu** → kaza sonrası adli kanıt ölüydü | `BlackBoxReplayView` → `CrashLogSection` (liste · sağlık · iki adımlı silme; **koordinat taşınmaz**) | #564 |
| **E-31/E-32** Uzun yol | Kapı kuralı iki yerde → ayrışma riski | `preflightBlocksSession` + `scenarioVerdict` tek otorite; `isLongRoadActive`/`getLongRoadCriticalCount` ekrana bağlandı | #565 |
| **E-19·E-21·E-22·E-10·E-11** Sahte sıfır | **Teşhis aracının kendisi** "ölçülmedi"yi "0 ölçüldü" diye sunuyordu | 5 kaynak + 5 model katmanında `null` taşıma; `null` sayaçtan gerekçe cümlesi kurulmaz | #566 |

**Doğrulama:** `tsc -b` temiz · tam kasa **11 981 test yeşil** (531 dosya) ·
yeni **30 kilit** (her blokta en az bir **KONTROL testi**: kilit körü körüne
geçmesin).

### (c) Bu turda AÇILAN borçlar (kapatılmadı, yazıldı)

1. **Fleet/AI sunucu köprüsü** (E-15/E-16/E-17): `setFromServer` çağıranı yok →
   dört LAB modülü dürüstçe boş. Köprü = Supabase okuma ucu + RLS kararı.
2. **`getPanicHandlerStatus()` için LAB yüzeyi** (#558'den devreden).
3. **`sessionInspectorSources` kalan sayaçları** (`halConf` · `canRetryCount` ·
   `listenerCount` · `obdDropped` · `capture.*`) — sahte-sıfır sınıfının aynısı,
   bu turda ele alınmadı.
4. **Keşif eylemleri için takeover politikası kararı** (E-29).
5. **TRIP AI motorlarının ürün tetikleyicisi** (E-02/03/04) — kapı kuruldu.

---

## 0.3 🔓 "GÜVENLİ ŞEKİLDE YAPILABİLİR Mİ?" — ÜÇÜNCÜ TUR (2026-08-13 akşam)

§0.2'de üç madde "yapılmadı" diye bırakılmıştı (E-02/E-03/E-04 · E-29). Soru
tekrar soruldu: **bunları güvenli şekilde yapamaz mıyız?** Cevap ölçüldü ve
ikiye ayrıldı.

### (a) YAPILABİLİR ÇIKTI → yapıldı (E-02 · E-03)

`computeCorridorCandidates` ve `generateRecommendations` **tamamen saf**:

| Ölçülen | Sonuç |
|---------|-------|
| Ağ çağrısı | **YOK** (import listesi: yalnız `routingService` geometri yardımcıları) |
| `async`/`await` | **YOK** — senkron saf hesap |
| Global durum / store yazma | **YOK** |
| Girdi mutasyonu | **YOK** (dosya başlıkları beyan ediyor, testleri de var) |
| POI kaynağı | Cihazın **yerel** deposu (IndexedDB `getRecentLocations`) |

Bu yüzden bağlandı: `tripAiSources` (tek okuma) + `tripAiModel` (saf zincir) +
LAB → Trip Engine'de **elle tetiklenen** hesap. Kilitlenen sınırlar: rota
YAZILMAZ · ağa ÇIKILMAZ · timer KURULMAZ · açılışta KOŞMAZ · kullanıcı verisi
(ad · adres · koordinat · kimlik) çıktıya **SIZMAZ**. Kütük **#567**.

> **Not:** ilk yaklaşım "kapı kur, durumu dondur" idi. Ölçüm bağlamanın güvenli
> olduğunu gösterince kapı kaldırıldı ve motor gerçekten bağlandı. Kapı kurmak
> bir *son çare*dir, ölçmemenin mazereti değil.

### (b) YAPILAMAZ ÇIKTI → gerekçe artık ölçülmüş (E-04 · E-29)

**E-04 — `tripApplyComposition`:** adapter'ları ölçüldü. `legRouterAdapter` →
`fetchRouteLeg` (**ağa çıkar**), `routeStoreAdapter` → `writeActiveRoute`
(**rotayı YAZAR**). Yani bu katmanı bağlamak "gözlem" değil, **rota değiştirme
yeteneğini açmak**tır → ürün kararı. Bağlanmadı; sessizce bağlanmasın diye
kilitle korunuyor.

**E-29 — keşif eylemleri:** burada mimari bir duvar var, zaman sorunu değil.
Beş eylemin tamamı `vehicle.discovery.*` ile başlıyor;
`takeoverPolicy.FORBIDDEN_PREFIXES` ise **`vehicle.`** içeriyor. Politika
modülünün kendi başlığı şunu yazıyor:

> *"ECU write/coding/adaptation/actuator ve TÜM araç eylemleri (`vehicle.*`)
> eligible DEĞİLDİR → **hiçbir config onları TAKEOVER'a alamaz**"*
> (`TAKEOVER_ELIGIBLE` bugün yalnız `media.next` içerir.)

Yani sesli "keşif başlat" eklemek bir wiring satırı değil, **güvenlik beyaz
listesini delme** kararıdır. Yapılmadı; gerekçe `discoveryActions.ts` başlığına
yazıldı ki bir dahaki denetimde yeniden "unutulmuş borç" sanılmasın.

**Doğrulama:** `tsc -b` temiz · tam kasa **11 997 test yeşil** (533 dosya) ·
bu turda **16 yeni kilit**.

> **Ders:** "yapmadım" ile "yapılmamalı" farklı şeylerdir ve ikisi de
> ÖLÇÜLEREK ayrılır. Üç maddeden biri güvenle yapılabilirmiş; ikisinin
> yapılmaması ise projenin kendi güvenlik mimarisinin gereğiymiş.

---

### Ölçümün bilinen sınırları
- `export * from` yeniden dışa aktarma, sembolü "kullanılıyor" gösterebilir → bu yönde
  **eksik bulgu** (false negative) üretir, uydurma bulgu üretmez.
- Yalnız statik çağrı ölçülür; runtime string ile çözülen dinamik çağrılar sayılmaz.
- Native (Java/Kotlin) taraf bu taramanın DIŞINDADIR.

---

## 1. BİLİNEN PLACEHOLDER / DISABLED — TEYİT (yeniden keşfedilmedi)

Katalogda zaten eksik işaretli; kod tarafında da ekran eşlemesi **yok** olduğu
`carosLabScreenMap.tsx` üzerinden teyit edildi (`renderAvailableTool` → `default: null`):

| Modül | Katalog durumu | Kod teyidi |
|-------|----------------|------------|
| `deep-scan` | PLACEHOLDER | Ekran eşlemesi yok ✔ (iki ayrı akış: `deepScanOrchestrator` + `platformCoreDeepScanWiring`) |
| `uds-explorer` | PLACEHOLDER | Ekran eşlemesi yok ✔ |
| `recovery-monitor` | PLACEHOLDER | Ekran eşlemesi yok ✔ |
| `tool-calling` | PLACEHOLDER | Ekran eşlemesi yok ✔ |
| `memory-explorer` | PLACEHOLDER | Ekran eşlemesi yok ✔ |
| `knowledge-explorer` | PLACEHOLDER | Ekran eşlemesi yok ✔ |
| `raw-command-console` | DISABLED | `resolveToolActivation` → `null` ✔ (işlem çalışmaz) |
| `benchmark` | PLACEHOLDER | Ekran eşlemesi yok ✔ |
| `stress-test` | DISABLED | `resolveToolActivation` → `null` ✔ |

**Not:** AVAILABLE işaretli 41 aracın **tamamının** `carosLabScreenMap` içinde gerçek bir
ekran eşlemesi vardır — katalog↔ekran ayrışması YOKTUR. Ayrışma bir katman aşağıda,
**ekran↔veri kaynağı** düzeyindedir (bkz. K3 bulguları).

---

## 2. KATEGORİ: VEHICLE (17 modül)

### 2.1 `live-data` — Canlı Veri

**E-01 · K2 · İkinci otorite: OBD tazelik eşiği 6 ayrı yerde, 5 farklı sayı**
- Dosya: `src/components/obd/ObdLiveTestPanel.tsx:27-28` (`FRESH_MS=5_000`, `STALE_MS=15_000`)
- Kanıt: Aynı fiziksel olgu ("OBD paketi hâlâ taze mi") ürün genelinde bağımsız olarak
  şu yerlerde ölçülüyor ve **birbirinden habersiz farklı eşikler** taşıyor:
  `platform/vehicleStatusModel.ts:25,34` (`OBD_FRESH_MS=3_000` / `OBD_STALE_MS=10_000`) ·
  `platform/obd/ObdHealthMonitor.ts:60` (`STALE_ABS_MS=4_000`) ·
  `platform/diagnosticTriage.ts:202` (`OBD_STALE_AGE_MS=4_000`) ·
  `platform/aiCore/runtime/diagnosticEvidence.ts:86` (`STALE_PACKET_MS=4_000`) ·
  `platform/obd/signalEnvelope.ts:46` (`SIGNAL_STALE_MS=3_000`) ·
  `platform/obdRetryPolicy.ts:16` (`STALE_THRESHOLD_MS=12_000`) ·
  `hooks/useLivingThemeState.ts:39` (`OBD_FRESH_MS=20_000`) ·
  `platform/canSnapshotService.ts:38` (`STALE_DYNAMIC_MS=30_000`).
  Sonuç: **3 sn ile 30 sn arasında 8 farklı "bayat" tanımı.** Aynı anda LAB "TAZE",
  tema motoru "TAZE", triage "BAYAT" diyebilir. `diagnosticEvidence.ts:86` yorumu
  *"ObdHealthMonitor STALE eşiğiyle hizalı"* diyerek hizalama **iddia ediyor** ama
  hizalama derleme zamanı değil **elle kopyalanmış bir sayı** (4_000) — biri değişirse
  diğeri sessizce ayrışır.
- Kodla çözülür mü: ✅ (tek `freshnessPolicy` otoritesi + ilgili yerlerin ondan okuması)
- Önem: **YÜKSEK** — "veri var mı / güvenilir mi" kararının tabanı; hız/RPM/sıcaklık
  gösteren her yüzeyi ve tüm tanı zincirini etkiler.

### 2.2 `pid-did-explorer` — PID/DID Gezgini
Teyitli yetim export bulunamadı; okuma ucu (`pidDidExplorerModel` + `nativePlugin`)
gerçek native kaynağa bağlı. **Bu turda bulgu yok.**

### 2.3 `fleet-connectivity` — Fleet Connectivity
`fleetConnectivitySources` → `telemetry/*` gerçek kaynaklara bağlı, VIN maskesi tek
otoriteden (`privacy/vinMask`) geliyor. **Bu turda bulgu yok** (VIN maske teyidi: §6.1).

### 2.4 `trip-engine` — Trip Engine

**E-02 · K1 · Yolculuk öneri motorunun ürün çağıranı yok**
- Dosya: `src/platform/trip/tripRecommendationEngine.ts:199` (`generateRecommendations`), `:297` (`compareRecommendations`)
- Kanıt: Ürün yolunda tek çağıran yok (yalnız tanım satırı + 1 test dosyası). Motor
  yazılmış, üreteceği öneriler hiçbir yüzeye ulaşmıyor.
- Kodla çözülür mü: ✅
- Önem: **ORTA** — özellik hiç görünmüyor; kullanıcı kaybı yok ama ölü bakım yükü var.

**E-03 · K1 · Trip koridor motorunun ürün çağıranı yok**
- Dosya: `src/platform/trip/tripCorridorEngine.ts:44` (`computeCorridorCandidates`)
- Kanıt: Ürün yolunda sıfır çağıran (yalnız test).
- Kodla çözülür mü: ✅
- Önem: **DÜŞÜK-ORTA**

**E-04 · K1 · Trip "apply" kompozisyonu kurulmuş, kuran yok**
- Dosya: `src/platform/trip/wiring/tripApplyComposition.ts:61,93` (`createTripApplyComposition`, `createTripApplyRuntime`)
- Kanıt: `wiring/` klasöründe olmasına rağmen ürün yolunda hiçbir yer bu fabrikaları
  çağırmıyor — yani "wiring" adı taşıyan katman **fiilen bağlanmamış**.
- Kodla çözülür mü: ✅
- Önem: **ORTA**

### 2.5 `trip-cost` — Trip Cost

**E-05 · K2+K5 · Yakıt tüketimi varsayımı İKİ otoritede, İKİ farklı sayı**
- Dosya: `src/platform/tripLogService.ts:181` (`FUEL_L_PER_100KM = 8.5`) **vs**
  `src/platform/routingService.ts:1603` (`L_PER_100KM = 7.5`)
- Kanıt: Aynı fiziksel olgu (aracın 100 km'de kaç litre yaktığı) iki bağımsız yerde
  sabit yazılmış ve **sayılar farklı (%13 sapma)**. Aynı 300 km'lik yolculuk için
  yolculuk kaydı 25,5 L, rota tahmini 22,5 L üretir. Katalog notu yalnız 8,5'i beyan
  ediyor ("head unit yakıtı 8,5 L/100km sabiti ile TAHMİN eder"), 7,5 hiçbir yerde
  beyan edilmemiş.
- Kodla çözülür mü: ✅
- Önem: **YÜKSEK** — kullanıcıya para birimiyle gösterilen bir sayı; iki ekran
  aynı yolculuk için çelişen maliyet verir.

**E-06 · K5 · `DEFAULT_FUEL_PRICE` sessiz varsayılanı katalog beyanıyla çelişiyor**
- Dosya: `src/platform/trip/tripCostModel.ts:64,93,105-106`
- Kanıt: Katalog notu *"kaynağı olmayan kalem 0 YAZMAZ, 'BİLİNMİYOR' der ve toplama
  girmez"* diyor; kod `unitPrice: DEFAULT_FUEL_PRICE.unitPrice` ile **sabit bir birim
  fiyatı** kaleme yazıyor. `tripCanonicalModel.ts:31` bunu `'ESTIMATED'` olarak
  etiketliyor (dürüstlük kısmen korunuyor) ama fiyat kaynağı bağlı değilken üretilen
  sayı **ölçüm gibi görünen bir varsayım**dır.
- Kodla çözülür mü: ✅ (kaynak yoksa `UNAVAILABLE_PRICE` yolunu zorunlu kılmak)
- Önem: **ORTA-YÜKSEK** — ekranda para birimli sayı; "tahmini" etiketi görülmezse
  ölçüm sanılır.

### 2.6 `location-engine` — Location Engine

**~~E-07~~ · GERİ ÇEKİLDİ (§0.1) — `startLocationEngine` canlı, `HEAD_UNIT_GPS` yerleşik.**
- Dosya: `src/platform/location/locationEngineRuntime.ts:291` (`registerLocationProvider`),
  `:266` (`locationEngine`), `:273` (`stopLocationEngine`)
- Kanıt: `registerLocationProvider` ürün yolunda **sıfır çağıran** (grep ile teyitli:
  yalnız tanım satırı). Motoru başlatan/durduran uçlar da çağrılmıyor. LAB ekranı
  (`LocationEngineScreen`) `locationEngineRuntime`'ı okuyor → ekran açıldığında
  "sağlayıcı yok, öncelik tablosu boş" gösterecek. Katalog notu bunu kısmen kabul
  ediyor ("kayıtlı değilse HAZIR görünmez") ama **hiç sağlayıcı yoksa motorun tamamı
  gösterimlik** olur: çok-kaynaklı konum tahkimi fiilen YOK.
- Kodla çözülür mü: ✅ (gpsService'i bir sağlayıcı olarak kaydetmek)
- Önem: **YÜKSEK** — "Location Engine" AVAILABLE görünüyor, gerçekte konum otoritesi
  hâlâ tek başına `gpsService`; fallback/geçiş zinciri yok.

**~~E-08~~ · GERİ ÇEKİLDİ (§0.1) — `getLocationContext` `_registerLocationContextReader` üzerinden CANLI.**
- Dosya: `src/platform/location/locationContextService.ts:125` (`getLocationContext`), `:183` (`isLocationContextRunning`)
- Kanıt: Her ikisi de ürün yolunda sıfır çağıran.
- Kodla çözülür mü: ✅
- Önem: **ORTA**

**E-09 · K2 · Konum tazeliği 5 ayrı otoritede, 3 sn ile 60 sn arası**
- Dosya: `src/platform/gps/gpsIntakeHealth.ts:34-35` (`FRESH_MAX_MS=3_000`, `STALE_MAX_MS=15_000`)
- Kanıt: Aynı olgu ("GPS fix'i hâlâ geçerli mi") şuralarda bağımsız ölçülüyor:
  `gpsService.ts:932` (`LOCATION_STALE_MS=5_000`) ·
  `location/currentLocationCore.ts:27,29` (`LOCATION_FRESH_MS=60_000`, `LOCATION_EXPIRY_MS=300_000`) ·
  `location/locationConfidence.ts:52` (`FRESHNESS_MS` tablosu) ·
  `navigation/navigationSessionRuntime.ts:82` (`GPS_STALE_MS=5_000`) ·
  `navigation/guardian/runtime/guardianRuntime.ts:77` (`GUARDIAN_GPS_MAX_AGE_MS=3_000`) ·
  `system/SystemHealthMonitor.ts:87` (`GPS_FIX_FRESH_WINDOW_MS=10_000`) ·
  `telemetryService.ts:102` (`GPS_FRESH_WINDOW_MS=300_000`) ·
  `vehicleStatusModel.ts:36` (`GPS_STALE_MS=30_000`).
  **60 sn'de "taze" sayılan bir fix, Guardian için 3 sn'de bayat.** Kütük #327'deki
  "GPS heartbeat DEĞİŞİM dinliyordu" bulgusunun kök sınıfı aynı: tek tazelik otoritesi yok.
- Kodla çözülür mü: ✅
- Önem: **YÜKSEK** — konum güveninin tabanı; navigasyon, Guardian ve telemetri
  aynı fix hakkında farklı hüküm verebiliyor.

### 2.7 `navigation-core` — Navigation Core

**E-10 · K5 · LAB'da hız bilinmiyorsa `0 km/h` yazılıyor (sahte sıfır)**
- Dosya: `src/platform/devtools/navigationCoreSources.ts:460`
  (`speedKmh: useUnifiedVehicleStore.getState().speed ?? 0`)
- Kanıt: Hız `null`/`undefined` iken LAB ekranına **0** taşınıyor. Gözlemlenebilirlik
  kuralı madde 5 ("sahte 0 YASAK") ve katalog notu ("Bilinmeyen alan UNAVAILABLE;
  sahte 0 üretilmez") ile doğrudan çelişiyor. Gözlemci "araç duruyor" sanır.
- Kodla çözülür mü: ✅
- Önem: **ORTA-YÜKSEK** (LAB'ın kendi dürüstlük sözleşmesini deliyor)

**E-11 · K5 · Koridor genişliği bilinmiyorsa `0 m` yazılıyor**
- Dosya: `src/platform/devtools/navigationCoreSources.ts:508` (`corridorM: core?.corridorM ?? 0`),
  ayrıca `:511-513` (off-route kanıt sayaçları `?? 0`), `:526` (`totalRouteDistanceM ?? 0`),
  `:596` (`routeRevision ?? 0`)
- Kanıt: `core` yokken (nav oturumu yokken) tüm bu alanlar 0 olur. "Koridor 0 m" ile
  "koridor bilinmiyor" ekranda **ayırt edilemez**; 0 m koridor okunduğunda araç her
  zaman koridor dışında sanılır. `:597` `durationRevision ?? -1` ise **-1 sentinel'i**
  kullanıyor — aynı dosya içinde iki farklı "bilinmiyor" dili.
- Kodla çözülür mü: ✅
- Önem: **ORTA-YÜKSEK**

**E-12 · K2 · Rota/eşleşme tazeliği ayrı sabitlerde tekrarlanıyor**
- Dosya: `src/platform/navigation/core/mapMatchModel.ts:88` (`MATCH_STALE_MS=5_000`),
  `markerMotionModel.ts:90` (`MOTION_STALE_MS=5_000`)
- Kanıt: İki dosyada aynı 5 sn eşiği bağımsız tanımlı; ortak kaynaktan okumuyorlar.
  Şu an değerleri **aynı**, bu yüzden bugün görünür bir kusur yok — ama biri
  ayarlandığında diğeri sessizce ayrışır (E-01/E-09 ile aynı hastalık, henüz patlamamış).
- Kodla çözülür mü: ✅
- Önem: **DÜŞÜK (bugün) / YÜKSEK (ayar anında)**

### 2.8 `address-search-evidence` — Adres Arama Kanıtı

**~~E-13~~ · GERİ ÇEKİLDİ (§0.1) — seçim zinciri `MapSearchBar` → `noteAddressSearchChoice` → `attachUserChoice` CANLI.**
- Dosya: `src/platform/geo/addressSearchLedger.ts:519` (`attachUserChoice`)
- Kanıt: Ürün yolunda sıfır çağıran (yalnız kendi dosyasındaki `:590` toplu sarmalayıcı).
  Katalog, deneme sonuçları arasında **"kullanıcı seçti"** sınıfını sayıyor ve
  *"'Sonuç döndü' ile 'aradığı yer bulundu' AYRI sayılır: kullanıcı seçmediyse deneme
  çözülmüş SAYILMAZ"* diyor. Seçim ucunu bağlayan çağrı olmadığı için **hiçbir deneme
  "çözülmüş" sayılamaz** → başarı oranı yapısal olarak ölçülemez.
- Kodla çözülür mü: ✅
- Önem: **YÜKSEK** — kütük #543-#545'te açılan teşhis yüzeyinin ölçüm ucu eksik;
  adres arama başarısı hâlâ ölçülemiyor.

**~~E-14~~ · GERİ ÇEKİLDİ (§0.1) — `premiumGeocode` `geocodingService.ts:492`'de CANLI.**
- Dosya: `src/platform/geocodingProviders.ts:47` (`GEOCODE_PROVIDERS`), `:67`
  (`invalidateGeocodeProviderCache`), `:73` (`getGeocodeProvider`)
- Kanıt: Üçü de ürün yolunda sıfır çağıran; `getGeocodeProvider` yalnız **kendi
  dosyası içinde** (`:93`, `:172`) kullanılıyor — yani modülün dış yüzeyi (bu iki
  iç kullanıcı hariç) hiçbir yerden tetiklenmiyor. Katalog "premium BYOK" katmanını
  cevabı üreten katmanlardan biri olarak sayıyor.
- Kodla çözülür mü: ⚠️ Kısmen — modülün iç fonksiyonlarının (`:93`, `:172`) dışa açık
  sarmalayıcılarının kim tarafından çağrıldığı ayrıca izlenmeli (bkz. §7 şüphe listesi).
- Önem: **ORTA-YÜKSEK** (memory: numaralı sokak boşluğunun çözümü bu katmandı)

### 2.9 `fleet-identity` — Fleet Identity
`telemetry/vehicleIdentity*` zinciri gerçek kaynaklara bağlı; `maskVin` tek otoriteye
delege ediyor (`vehicleIdentityReport.ts:56-58` → `privacy/vinMask`). **Bu turda bulgu yok.**

### 2.10–2.13 `fleet-driver-identity` · `fleet-presence-history` · `fleet-driver-authentication` · `fleet-driver-dna`

**E-15 · K1+K3 · Sürücü katmanının TAMAMI okuma ucu bağlı / yazma ucu bağlanmamış**
- Dosyalar (hepsi ürün yolunda **sıfır çağıran**, grep ile teyitli):
  - `src/platform/fleet/driverPresence.ts:165` `normalizePresence` · `:735` `driverPresenceStore` · `:770` `bindPresenceVehicle`
  - `src/platform/fleet/driverAuthentication.ts:274` `resolveDriverAuthentication` · `:381` `resolveDriverTrust` · `:669` `driverAuthenticationStore` · `:681` `bindAuthenticationVehicle`
  - `src/platform/fleet/driverDnaEngine.ts:161` `accumulateTrip` · `:266` `buildDnaMetrics` · `:578` `buildDna` · `:680` `driverDnaStore`
  - `src/platform/fleet/driverAssignmentSnapshot.ts:215` `driverSnapshotRuntime`
  - `src/platform/fleet/driverPresenceHistory.ts:226` `settlePresenceHistory` (yalnız kendi dosyasında)
- Kanıt: LAB ekranları (`FleetDriverIdentityScreen`, `FleetPresenceHistoryScreen`,
  `FleetDriverAuthenticationScreen`, `FleetDriverDnaScreen`) `read*()` fonksiyonlarıyla
  bu store'ları **okuyor**; store'lara **yazan tek bir ürün yolu yok**. Presence için
  katalog *"Araç bağı kurulmadan hiçbir gözlem deftere yazılamaz"* diyor ve
  `bindPresenceVehicle` hiç çağrılmıyor → defter **yapısal olarak sonsuza dek boş**.
  DNA için `accumulateTrip`/`buildDna` hiç çağrılmıyor → DNA hiç oluşmaz.
  Bu, "Guardian'ın motoru olmaması" hastalığının **dört modülde birden tekrarı**.
- Kodla çözülür mü: ⚠️ Kısmen — katalog notları üretimin **sunucuda** olduğunu beyan
  ediyor ("köprü bağlı değilse ekran dürüstçe boş görünür"). O hâlde asıl eksik
  **köprü**dir; head unit'teki motor kodu (accumulate/build/resolve) ise sunucuda zaten
  varsa **çift uygulama** demektir (K2 riski).
- Önem: **YÜKSEK** — dört LAB modülü HAZIR görünüp kalıcı olarak boş; kullanıcı için
  sürücü kimliği/DNA özelliği fiilen yok.

### 2.14 `fleet-intelligence` — Fleet Intelligence

**E-16 · K1+K3 · Filo zekâsı motoru hiç çalıştırılmıyor**
- Dosya: `src/platform/fleet/fleetIntelligenceEngine.ts:67` `addEvidence` · `:138` `buildInsight`
  · `:232` `computeTrend` · `:277` `detectFleetDrift` · `:327` `buildFleetHealth` · `:483` `fleetIntelligenceStore`
- Kanıt: Hepsi ürün yolunda sıfır çağıran. `FleetIntelligenceScreen` `readFleetIntelligence()`
  ile okuyor; yazan yok → içgörü/trend/drift/sağlık **hiç üretilmez**.
- Kodla çözülür mü: ⚠️ Kısmen (E-15 ile aynı köprü sorusu)
- Önem: **YÜKSEK**

### 2.15 `ai-evidence-engine` — AI Evidence Engine

**E-17 · K1+K3 · Kanıt omurgasına ürün yolundan HİÇ kanıt yazılmıyor**
- Dosya: `src/platform/fleet/aiEvidenceEngine.ts:96` `recordEvidence` · `:234` `linkEvidence`
  · `:244` `evidenceChainFor` · `:476` `aiEvidenceStore`
- Kanıt: `recordEvidence` ve `linkEvidence` ürün yolunda **sıfır çağıran** (grep ile
  teyitli: yalnız tanım satırı). Katalog bu katmanı *"Tüm AI sistemlerinin ortak kanıt
  omurgası"* diye tanımlıyor. Omurgaya kimse yazmıyorsa, ona dayanan her karar
  (`INSUFFICIENT_EVIDENCE`) yapısal olarak kanıtsız kalır.
- Kodla çözülür mü: ⚠️ Kısmen (köprü)
- Önem: **YÜKSEK** — "8 Kapı" mimarisinin 1. kapısı (Confidence) fiilen kapalı.

**~~E-18~~ · GERİ ÇEKİLDİ (§0.1) — `startBatteryEvidenceSource` SystemBoot:840, `startBatteryVerdictService` SystemBoot:846 → zincir CANLI.**
- Dosya: `src/platform/reasoning/batteryEvidenceSource.ts:139` (`ingestVoltageSample`),
  `src/platform/reasoning/batteryVerdictService.ts:142` (`produceBatteryVerdict`)
- Kanıt: İkisi de ürün yolunda sıfır çağıran. `AiEvidenceEngineScreen` bu iki modülü
  **import ediyor** ve okuyor; voltaj örneği besleyen hiçbir yol yok → akü kanıtı hiç
  oluşmaz. Bu, kullanıcının zaten bildiği **"akünün dört ayrı otoritesi"** ve
  `updateBatteryVoltage` bulgusuyla **aynı kökün ikinci ucu**: yalnız otoriteler
  çoğalmamış, kanıt üretecek olan uç da bağlanmamış.
- Kodla çözülür mü: ✅
- Önem: **YÜKSEK** — akü teşhisi (Guardian'ın gerçek koşan tek kuralına komşu alan)
  kanıtsız.

### 2.16 `deep-scan` — bilinen PLACEHOLDER (bkz. §1)

### 2.17 `vehicle-fingerprint` — Araç Parmak İzi
`vehicleFingerprintSources` kalıcı kayıtları okuyor, sorgu göndermiyor; yetim export
bulunamadı. **Bu turda bulgu yok.**

---

## 3. KATEGORİ: COMMUNICATION (9 modül)

### 3.1 `raw-obd-traffic` — Ham OBD Trafiği
`rawTrafficModel` + `rawTrafficExport` maskeleme otoritesini (`obdTrafficMask`) doğru
kullanıyor; yetim export bulunamadı. **Bulgu yok.**

### 3.2 `can-monitor` — CAN İzleyici
`CanRawView` + `useDevtoolsCapture` gerçek yakalama akışına bağlı. **Bulgu yok.**

### 3.3 `kwp-monitor` — KWP İzleyici

**E-19 · K5+K4 · Native alan yokken sayaçlar `0` basılıyor ve "ÖLÇÜLDÜ" rozeti alıyor**
- Dosya: `src/platform/devtools/kwpMonitorSources.ts:68-78`
  (`coreNoDataStreak`, `maxCoreNoDataStreak`, `recoveryCount`, `suppressedCount`,
  `atpcSendFailures`, `lastRecoveryAt`, `killedByDataGate`, `threshold`, `maxPerSession`
  — hepsi `Number(...) || 0`)
- Kanıt: Native tarafta alan **yoksa** (`undefined`) `Number(undefined) || 0` → `0`.
  Model katmanı (`kwpMonitorModel.ts:264-282`) bu değeri `observed(...)` ile basıyor →
  ekranda **"ATPC gönderim sayısı: 0 · ÖLÇÜLDÜ"** yazar. Oysa doğru cevap
  **"KAYNAK YOK"**tur. Katalog notu ise *"o alanlar KAYNAK YOK gösterilir"* diyor →
  **belge-kod ayrışması**. Sonuç: kurtarma merdiveni hiç çalışmamış gibi mi görünüyor,
  yoksa gerçekten 0 kez mi çalıştı — ayırt edilemiyor.
- Kodla çözülür mü: ✅ (`Number.isFinite` kontrolü + `null` taşıma; model zaten `null` →
  `UNAVAILABLE` yolunu destekliyor)
- Önem: **YÜKSEK** — KWP kurtarma teşhisi bu sayaçlara dayanıyor (kütük #71/#72 hattı).

### 3.4 `uds-explorer` — bilinen PLACEHOLDER (§1)

### 3.5 `session-inspector` — Oturum Denetçisi
Bu modül **doğru tarafta**: `Observability` sözleşmesi (`OBSERVED·DERIVED·UNAVAILABLE·STALE`)
burada tanımlı ve *"Sahte bayatlık hesabı YASAK"* kuralı kod düzeyinde uygulanmış.
E-19/E-20'deki kusur bu sözleşmenin **ihlali**, sözleşmenin kendisi sağlam. **Bulgu yok.**

### 3.6 `phone-hub-probe` — Phone Hub Hardware Probe
`getPhoneHubProbeCachedAt` ürün yolunda çağrılmıyor (küçük gözlem ucu). Diğer uçlar bağlı.
**Bulgu düzeyi: ihmal edilebilir.**

### 3.7 `phone-hub-field-validation` — Saha Doğrulama
Kaynak katmanı gerçek probe'lara bağlı; `companionFoundationSources` iç kullanımda.
**Bulgu yok.**

### 3.8 `phone-hub-link` — Canlı Bağlantı

**E-20 · K1 · Eşleştirme onay ucu bağlanmamış**
- Dosya: `src/platform/phoneHub/phoneHubLink.ts:273` (`confirmPhoneHubPairing`),
  `:290` (`getPhoneHubPairingCode`)
- Kanıt: İkisi de ürün yolunda **sıfır çağıran** (grep teyitli: yalnız tanım satırı).
  `PhoneHubLinkScreen` sunucu yaşam döngüsü düğmelerini taşıyor ama eşleştirme
  **onay/ret** kararını veren yüzey yok. Memory kaydı zaten *"P1-A … #122 🔴 cihazda
  HİÇ çalışmadı"* diyor — bu, **neden** çalışmadığının kod tarafındaki bir ucu:
  el sıkışma onay adımını tetikleyen çağrı hiç yazılmamış.
- Kodla çözülür mü: ✅
- Önem: **YÜKSEK** — RFCOMM bağlantısı bu onay olmadan tamamlanamaz.

### 3.9 `adapter-diagnostics` — Adaptör Tanılama

**E-21 · K5 · Aynı dosyada İKİ farklı "bilinmiyor" dili — sayaçlarda sahte 0**
- Dosya: `src/platform/devtools/adapterDiagnosticsSources.ts:70,101-104,120`
- Kanıt: Aynı dosya `lastEcuDataAgeMs` ve `connectionQuality` için **`-1` sentinel'ini
  bilinçle koruyor** (satır içi yorum: *"-1 sentinel AYNEN korunur — 'hiç paket yok' ile
  '0 ms' ayrımını model yapar"*) ve model bunu doğru şekilde `unavailable(...)`'a
  çeviriyor (`adapterDiagnosticsModel.ts:393,403,410`). **Ama aynı dosyada**
  `reconnectAttempts`, `resetRequestedCount`, `resetCompletedCount`,
  `disconnectCalledCount`, `reconnectRequestedCount`, `reconnectPressure` alanları
  `Number(...) || 0` ile sahte sıfıra düşürülüyor ve model onları `observed(...)` ile
  basıyor (`:359`, `:413`). Yani **disiplin dosya içinde tutarsız**: kritik iki alan
  korunmuş, altı sayaç korunmamış. Üstelik `:648-652` bu sahte sıfırlar üzerinden
  **gerekçe cümlesi üretiyor** (`reconnectAttempts > 0` → "Bu oturumda N reconnect
  denemesi oldu") — kaynak yokken cümle üretilmiyor ama "0 deneme oldu" hükmü de
  yanlış bir güven veriyor.
- Kodla çözülür mü: ✅
- Önem: **ORTA-YÜKSEK**

---

## 4. KATEGORİ: RUNTIME (8 modül)

### 4.1–4.2 `queue-monitor` · `poll-scheduler` (ortak ekran: RuntimeSchedulingScreen)

**E-22 · K5+K4 · Sahte-sıfır kapısı kurulmuş, kaynak katman kapıdan ÖNCE 0 üretiyor**
- Dosya: `src/platform/devtools/runtimeSchedulingSources.ts:87-90`
  (`eventsReceived`, `decodeFailures`, `valuesStored`, `valuesCached` — `Number(...) || 0`)
- Kanıt: Aynı dosyanın **14 satır yukarısındaki yorumu** (`:74-75`) aynen şöyle:
  *"T6: kanıt yoksa NULL taşınır — `|| 0` sahte sıfır üretiyordu"*. Bu düzeltme
  `transport`, `configuredPidCount`, `counters`, `lastPollAt` alanlarına **uygulanmış**
  ama hemen altındaki `js` bloğuna **uygulanmamış** → yarım düzeltme.
  Model katmanı ise (`runtimeSchedulingModel.ts:187`) açıkça
  *"null/undefined/'' → UNAVAILABLE (SAHTE 0 veya boş değer YOK)"* diyor — yani kapı
  doğru yerde duruyor, ama kaynak katman `null`'ı 0'a çevirerek **kapıyı devre dışı
  bırakıyor**. Kapı hiç tetiklenemez.
- Kodla çözülür mü: ✅ (üstteki alanlarla aynı desen)
- Önem: **ORTA-YÜKSEK** — "poll çalışıyor mu" sorusunun cevabı; 0 olay alındı ile
  ölçüm yapılmadı karışıyor.

### 4.3 `recovery-monitor` — bilinen PLACEHOLDER (§1)

### 4.4 `evidence-viewer` — Kanıt Görüntüleyici

**~~E-23~~ · GERİ ÇEKİLDİ (§0.1) — `new AiCoreRuntime(...)` `platformCoreAiRuntimeWiring.ts:155`'te canlı.**
- Dosya: `src/platform/aiCore/runtime/aiCoreRuntime.ts:300` (`createAiCoreRuntime`)
- Kanıt: Ürün yolunda **sıfır çağıran** (grep teyitli). `platformCoreAiRuntimeWiring.ts:38`
  bu modülden **tip/yardımcı import ediyor** ama fabrikayı çağırmıyor. `EvidenceViewerScreen`
  `platformCoreAiRuntimeWiring`'i okuyor → runtime örneği yoksa AI Core kanıt kaynağı
  boş kalır.
- Kodla çözülür mü: ⚠️ Kısmen — wiring'in hangi yolu kullandığı ayrıca izlenmeli (§9).
- Önem: **YÜKSEK**

### 4.5 `performance` — Performans
`PerformanceView` → `platform/debug` + `halStatusStore`, gerçek kaynaklara bağlı.
**Bulgu yok.**

### 4.6 `capability-gates` — Yetenek Kapıları

**E-24 · K1+K3+K4 · AI Gateway izni SUNUCUDAN HİÇ okunmuyor → kapı kalıcı fail-closed**
- Dosya: `src/platform/ai/gateway/aiGatewayAccessRuntime.ts:46` (`refreshGatewayAccess`)
- Kanıt: Ürün yolunda **sıfır çağıran** (test bile 0). Modülün kendi docstring'i
  *"Timer KURMAZ: **boot'ta bir kez** + elle tazeleme"* diyor — kod tarafında boot'ta
  çağıran yok, LAB ekranında da elle tazeleyen yok (`CapabilityGatesScreen:23-24`
  yalnız `getGatewayStatus`/`getGatewayAccessReadAt`/`getProviderReadinessInfo`
  **okuma** uçlarını import ediyor). Sonuç: `_snapshot` hep `null` → `UNREAD_ACCESS` →
  belgelenen fail-closed davranışı gereği **AI Gateway izni hiçbir zaman verilemez**.
  Katalogdaki *"Sunucu okunmadıysa kapı KAPALIDIR (fail-closed); okunmadı ile kapali
  AYRI etiketlenir"* cümlesi **teknik olarak doğru çalışıyor** ama pratik sonuç:
  kapsam izni özelliği **hiç etkinleşemez**; tek açılış yolu yerel geliştirici
  kaldıracı (`localStorage 'mavi.aiGateway.enabled'`) kalıyor.
- Kodla çözülür mü: ✅ (boot'ta bir kez + LAB'a "YENİLE" ucu)
- Önem: **YÜKSEK** — reklamı yapılan bir yeteneğin tek etkinleştirme yolu bağlanmamış.

### 4.7 `media-authority` — Medya Otoritesi

**E-25 · K1 · "Dürüst iddia" üreteci bağlanmamış (`claimFor`)**
- Dosya: `src/platform/media/authority/mediaCommandGateway.ts:507` (`claimFor`)
- Kanıt: Ürün yolunda **sıfır çağıran**. Katalog notunun temel dürüstlük vaadi:
  *"'Komut kabul edildi' ile 'ses çıkıyor' AYRI gösterilir: ses kanıtı (render + odak +
  seviye) yoksa sonuç YALNIZ İSTEK olarak yazılır."* `claimFor(truth)` tam bu ayrımı
  üreten fonksiyondur ve **hiç çağrılmıyor** → ayrımın üretim yolu yok.
- Kodla çözülür mü: ✅
- Önem: **YÜKSEK** — modülün ilan ettiği ana dürüstlük mekanizması ölü.

**E-26 · K1 · Kurtarma başarısı hiç işaretlenmiyor**
- Dosya: `src/platform/media/authority/mediaRecovery.ts:182` (`markRecoverySucceeded`)
- Kanıt: Ürün yolunda sıfır çağıran. Kurtarma denendiğinde başarı hiç kaydedilmiyorsa
  kalıcı kurtarma kaydı temizlenmez ve LAB'daki "kurtarma kararı" kartı başarıyı asla
  gösteremez.
- Kodla çözülür mü: ✅
- Önem: **ORTA-YÜKSEK**

**E-27 · K1 · `setMuted` ve `sourceClassToPackage` ürün yolunda çağrılmıyor**
- Dosya: `mediaCommandGateway.ts:443` · `mediaAuthorityRuntime.ts:68`
- Kodla çözülür mü: ✅ · Önem: **DÜŞÜK-ORTA**

### 4.8 `guardian-runtime` — Guardian Runtime *(BİLİNEN — kısa teyit)*
Kullanıcı tarafından zaten bilinen "Guardian'ın motoru yok / kalp atışı var, ses yok"
bulgusu **kod tarafında teyit edildi**: `guardianRuntime.ts:415` `getGuardianOutput`
ürün yolunda **sıfır çağıran** — yani Guardian'ın ürettiği çıktıyı okuyan hiçbir
tüketici yok. Katalog notu bunu zaten beyan ediyor ("bu tur Guardian'a KALP ATIŞI
verir, SES vermez"). **Yeniden keşif yapılmadı; teyit yeterli.**

---

## 5. KATEGORİ: AI (8 modül)

### 5.1 `mavi-console` — Mavi Konsolu
`maviConsoleSources` gerçek RAM durumunu okuyor. **Bulgu yok.**

### 5.2 `mavi-reasoning-engine` — MAVI Reasoning Engine

**E-28 · K1+K3 · DARALTILDI (§0.1): karar üretiliyor, DEFTER/KUYRUK tutulmuyor**
- Dosya: `src/platform/reasoning/maviReasoningEngine.ts:147` `resolveEvidence` · `:210`
  `resolveConflicts` · `:269` `resolveDecision` · `:322` `resolveConfidence` · `:478`
  `recordReasoning` · `:504` `transitionReasoning` · `:529` `expireReasoning` · `:552`
  `buildReasoningChain` · `:737` `maviReasoningStore`
  Ayrıca `maviReasoningQueue.ts:88` `resolverForIntent` · `:117` `intentForEvent` ·
  `:277` `summarizeQueue`.
- Kanıt: **Dokuz karar fonksiyonunun ve kuyruk çözücülerinin tamamı** ürün yolunda
  sıfır çağıran. `MaviReasoningEngineScreen` `maviReasoning*` modüllerini okuyor;
  yazan yok → "CANLI OLAY KUYRUĞU" ekranı kalıcı olarak boş. Katalog notu üretimin
  sunucuda olduğunu (migration 058, 12 gerçek olay) beyan ediyor — o hâlde head
  unit'teki bu 9 fonksiyon **ikinci bir uygulamadır** (bkz. E-33).
- Kodla çözülür mü: ⚠️ Kısmen (köprü/çift-uygulama kararı gerekiyor)
- Önem: **YÜKSEK** — "CAROS PRO'nun TEK KARAR OTORİTESİ" olarak ilan edilen katman.

### 5.3 `ai-mechanic` — AI Mechanic
Kaynak katmanı yalnız Reasoning + Evidence okuyor (sözleşmeye uygun). Kendi yetimi yok;
ama **girdisi boş** olduğu için (E-28 + E-17) ekran kalıcı olarak boş kalır.
**Türev bulgu — bağımsız kusur yok.**

### 5.4 `action-registry` — Eylem Otoritesi

**E-29 · K1 · Keşif eylemleri Mavi'ye HİÇ kaydedilmiyor (beyan edilmiş, kapanmamış borç)**
- Dosya: `src/platform/maviCore/discoveryActions.ts:93` (`registerDiscoveryActions`),
  `:40` `buildDiscoveryActionDefinitions`, `:66` `buildDiscoveryActionHandlers`,
  `:98` `buildLiveDiscoveryActionPort`
- Kanıt: Dördü de ürün yolunda sıfır çağıran. Dosyanın **kendi başlık yorumu** bunu
  itiraf ediyor: *"Registry/executionEngine'e KAYIT (wiring) BİLEREK YAPILMADI …
  gerçek wiring SONRAKİ PR'a bırakılmıştır (rapora yazılı)."* Sonraki PR gelmemiş.
  Sonuç: sesli "keşif başlat / durumu ne / sonuçları uygula" komutları yok.
- Kodla çözülür mü: ✅
- Önem: **ORTA-YÜKSEK** (beyan edilmiş borç ama kullanıcıya vaat edilen yüzey yok)

**E-30 · K1 · `getActionAuthorityRegistryIds` ve `isPendingActionFor` çağrılmıyor**
- Dosya: `platform/action/maviActionAuthority.ts:251` · `pendingActionConfirmation.ts:71`
- Önem: **DÜŞÜK** (gözlem/yardımcı uçlar)

### 5.5 `stt-mic` — Mavi STT / Mikrofon
`sttMicSources` + `voiceMicDiagnosticsProbe` gerçek native probe'a bağlı. **Bulgu yok.**

### 5.6–5.8 `tool-calling` · `memory-explorer` · `knowledge-explorer` — bilinen PLACEHOLDER (§1)

---

## 6. KATEGORİ: DEVELOPER (8 modül)

### 6.1 `long-road-field-validation` — Uzun Yol Saha Doğrulama

**E-31 · K1 · Oturum ön-kontrol kapısı hiç sorulmuyor**
- Dosya: `src/platform/fieldValidation/longRoadModel.ts:813` (`preflightBlocksSession`)
- Kanıt: Ürün yolunda sıfır çağıran. Ön koşullar (preflight) sağlanmasa da oturum
  başlatılabilir → "kanıtsız PASS üretilmez" vaadinin ön kapısı fiilen yok.
- Kodla çözülür mü: ✅ · Önem: **ORTA-YÜKSEK**

**E-32 · K1 · `scenarioVerdict` ve `isLongRoadActive` çağrılmıyor**
- Dosya: `longRoadModel.ts:243` (`scenarioVerdict`) · `longRoadRecorder.ts:168`
  (`isLongRoadActive`), `:181` (`getLongRoadCriticalCount`)
- Kanıt: Üçü de ürün yolunda sıfır çağıran. `scenarioVerdict` senaryo hükmünü üreten
  fonksiyondur; rapor katmanı (`longRoadReport.ts`) kendi hüküm fonksiyonlarını
  (`judgePersistence`, `judgeRealVehicle`) taşıyor → **hüküm mantığının ikinci bir
  yerde** yaşadığı şüphesi doğuyor (bkz. §9 — ölçülemedi).
- Kodla çözülür mü: ✅ · Önem: **ORTA**

### 6.2 `decoder-registry` — Çözücü Kayıtları
Statik katalog, gerçek registry'den okuyor. **Bulgu yok.**

### 6.3 `discovery-database` — Keşif Veritabanı
`DiscoveryDashboard` → `obd/discovery` + `vehicleLearningIntegrationService`, bağlı.
**Bulgu yok.**

### 6.4 `raw-command-console` — bilinen DISABLED (§1)

### 6.5 `replay-log` — Kayıt Oynatma

**E-33 · K1 · Kara kutu okuma/temizleme yüzeyi bağlanmamış**
- Dosya: `src/platform/security/blackBoxService.ts:624` `getBlackBoxSnapshot` · `:633`
  `listCrashLogKeys` (dış çağıran yok; yalnız kendi dosyasında `:426`, `:683`) · `:641`
  `readCrashLog` · `:653` `deleteCrashLog`
- Kanıt: `BlackBoxReplayView` yalnız `getReplayData`'yı kullanıyor. Kaza kayıtlarını
  **listeleyen/okuyan/silen** uçlar hiçbir yüzeye bağlı değil → kaydedilen kaza
  günlükleri **hiçbir zaman okunamıyor** (yalnız diskte birikiyor).
- Kodla çözülür mü: ✅ · Önem: **ORTA-YÜKSEK**

### 6.6 `pid-timing-experiment` — H-A Deneyi
Gerçek native deneye bağlı, model saf. **Bulgu yok.**

### 6.7–6.8 `benchmark` · `stress-test` — bilinen PLACEHOLDER / DISABLED (§1)

---

## 7. ÇAPRAZ KESEN BULGULAR (tek modüle ait değil)

**E-34 · K1 · Panik yakalayıcı HİÇ kurulmuyor — global JS hataları kayda geçmiyor**
- Dosya: `src/platform/system/SystemPanicHandler.ts:165` (`initPanicHandler`)
- Kanıt: Ürün yolunda **sıfır çağıran** (grep teyitli). Dosyanın kendi başlık yorumu
  *"1. `initPanicHandler()` → `window.onerror` / `unhandledrejection` hook'larına
  bağlanır"* diyor; fonksiyonun docstring'i *"@returns cleanup fonksiyonu — SystemBoot
  stop() içinde çağrılır"* diyor. `SystemBoot.ts` içinde `panic` geçen **tek satır yok**.
  Sonuç: (a) yakalanmayan global JS hataları panic snapshot ÜRETMİYOR, (b)
  `unhandledrejection` yakalanmıyor, (c) `onVehicleEvent` ring-buffer aboneliği
  kurulmadığı için **üretilen panic snapshot'ların olay geçmişi de boş**.
  `capturePanicSnapshot` yalnız `SystemHealthMonitor`'ün iki iç yolundan
  (`ui_freeze`, `watchdog_max_restarts`) çağrılıyor.
- Kodla çözülür mü: ✅ (SystemBoot start/stop'a tek satır)
- Önem: **ÇOK YÜKSEK** — sahada çöken bir APK'dan geriye tanı verisi kalmıyor;
  "gözlemlenemeyen özellik tamamlanmış değildir" kuralının en pahalı ihlali.

**E-35 · K2 · İKİ AYRI GEOFENCE İHLAL OTORİTESİ**
- Dosyalar: `src/platform/geofenceService.ts` (JS/Haversine, `checkGeofence`
  `gpsService.ts:5`'ten her fix'te çağrılıyor) **vs**
  `src/platform/security/geofenceService.ts` (Worker'a zon yükler, `GEOFENCE_EXIT`
  olayını dinler, `useSystemStore.geofenceAlarm` set eder)
- Kanıt: Aynı fiziksel olgu ("araç çitten çıktı mı") **iki bağımsız hesapta**: biri ana
  thread'de Haversine + `speakAlert` + bildirim, diğeri Worker'da + alarm overlay.
  **DÜZELTME (§0.1):** ilk turda "JS tarafının besleme ucu ölü" denmişti — YANLIŞ.
  `setGeofenceCenter` (`SecuritySuite.tsx:257`) → `addGeofenceZone` zinciri canlıdır ve
  `initGeofence()` (`main.tsx:73`) kalıcı zonları yükler. Yani **iki otorite de
  gerçekten çalışıyor** — bu, tespiti zayıflatmaz, AĞIRLAŞTIRIR: iki canlı hesap
  aynı olguya bakıyor.
  `App.tsx:120-121` yorumu iki otoritenin yarış sırasını elle ayarlamaya çalışıyor:
  *"dispatchGeofenceViolation, geofenceService'in setGeofenceAlarm'ından ÖNCE gelir"* —
  bu, iki otoritenin varlığının itirafıdır.
- Kodla çözülür mü: ✅
- Önem: **YÜKSEK** — güvenlik özelliği; hangi otoritenin karar verdiği belirsiz ve
  ana thread'de her fix'te ölü iş yapılıyor.

**E-36 · K2 · "Bayat mı?" sorusunun 8+ bağımsız cevabı (özet)**
E-01 (OBD) + E-09 (GPS) + E-12 (map match) birlikte tek bir yapısal boşluğa işaret
ediyor: **tazelik/yaş için merkezi bir politika otoritesi yok.** Ürün genelinde
`*_STALE_MS` / `*_FRESH_MS` / `*_MAX_AGE_MS` deseninde **40+ bağımsız sabit** ölçüldü,
üç fiziksel olguyu (OBD paketi · GPS fix · sinyal zarfı) 3 sn ile 60 sn arasında
farklı tanımlarla ölçüyorlar. Aynı anda iki ekranın aynı veri için "TAZE" ve "BAYAT"
demesi **yapısal olarak mümkün**.
- Kodla çözülür mü: ✅ (tek `freshnessPolicy` + tüketicilerin ondan okuması)
- Önem: **YÜKSEK**

**E-37 · K2 · Head unit ile sunucu arasında ÇİFT UYGULAMA riski (Fleet/AI katmanı)**
E-15 · E-16 · E-17 · E-28'in ortak kökü: `driverPresence` · `driverAuthentication` ·
`driverDnaEngine` · `fleetIntelligenceEngine` · `aiEvidenceEngine` · `maviReasoningEngine`
head unit'te **tam birer motor olarak yazılmış** (accumulate/build/resolve/record
fonksiyonlarıyla) ama hiçbiri ürün yolundan çağrılmıyor; katalog notları üretimin
**sunucuda** (migration 055/056/058) olduğunu beyan ediyor. Vizyon belgesi
(`CAROS_PRO_VIZYONU.md:2776`) ise *"DNA metrik FORMÜLLERİ SQL'e KOPYALANMADI (tek
otorite `driverDnaEngine.ts`)"* diyor. Bu iki ifade birlikte okunduğunda çelişki
çıkıyor: **tek otorite olduğu söylenen dosya head unit'te hiç koşmuyor**, üretim ise
sunucuda. Ya (a) formüller iki yerde yaşıyor (K2 — ikinci otorite), ya (b) head
unit'teki motor tamamen ölü koddur. **Hangisi olduğu bu taramayla ayırt edilemedi**
(Supabase/SQL tarafı kapsam dışı) → §9'a taşındı, ama **risk sınıfı kesindir**.
- Kodla çözülür mü: ⚠️ Karar gerektirir (silme mi, bağlama mı)
- Önem: **YÜKSEK** (bakım maliyeti + sessiz ayrışma riski)

**E-38 · K2 · VIN maskesi — BİLİNEN bulgunun teyidi: artık TEK otorite**
Kullanıcının bildiği "VIN maskesi 7 yerde ayrı yazılmıştı" sorunu **çözülmüş görünüyor**:
`src/platform/privacy/vinMask.ts` tek otorite olarak duruyor ve
`telemetry/vehicleIdentityReport.ts:56-58` `maskVin` yalnız ona delege eden ince bir
sarmalayıcı. `remoteLogService`, `longRoadModel`, `validation/*`, `vehicle/*` hepsi
bu otoriteden okuyor. **Yeni ikinci otorite bulunamadı — teyit edildi, kapalı.**

---

## 8. ÖNCELİK LİSTESİ (en riskli üstte)

| # | Bulgu | Kategori | Neden bu sırada |
|---|-------|----------|-----------------|
| 1 | **E-34** Panik yakalayıcı hiç kurulmuyor | K1 | Sahada çöken cihazdan **hiç tanı verisi kalmıyor**; tek satırlık düzeltme, en yüksek kanıt getirisi. Tüm kullanıcıları etkiler. |
| 2 | **E-36 / E-01 / E-09** Tazelik otoritesi yok (40+ sabit) | K2 | "Veri güvenilir mi" kararının tabanı; hız·RPM·konum·Guardian·telemetri hepsini etkiler. Sessiz, teşhisi zor kusur sınıfı. |
| 3 | **E-35** İki geofence otoritesi + ölü besleme ucu | K2+K1 | Güvenlik özelliği; hangi otoritenin karar verdiği belirsiz, ana thread'de her GPS fix'inde ölü iş. |
| 4 | **E-05** Yakıt tüketimi 8,5 vs 7,5 L/100km | K2 | Kullanıcıya **para birimiyle** gösterilen çelişkili sayı; iki ekran aynı yolculuk için farklı maliyet verir. |
| 5 | **E-24** AI Gateway izni sunucudan hiç okunmuyor | K1+K4 | İlan edilen bir yeteneğin **tek etkinleştirme yolu** bağlanmamış → özellik hiç açılamaz. |
| 7 | **E-25** Media `claimFor` bağlanmamış | K1 | Modülün ilan ettiği ana dürüstlük mekanizması ("istek ≠ ses çıkıyor") ölü. |
| 8 | **E-15/E-16/E-17/E-28** Fleet + AI motorları beslenmiyor | K1+K3 | **Altı LAB modülü** HAZIR görünüp kalıcı boş; ama katalog boşluğu beyan ettiği için dürüstlük korunuyor → risk "yalan" değil "yok olan özellik". |
| 9 | **E-19/E-21/E-22/E-10/E-11** LAB'da sahte 0 (5 dosya) | K5+K4 | Gözlemlenebilirlik kuralı madde 5'in doğrudan ihlali; **teşhis aracının kendisi yanlış bilgi veriyor** — hata avında yanlış yöne sürükler. |
| 10 | **E-20** Phone Hub eşleştirme onayı bağlanmamış | K1 | RFCOMM bağlantısı bu onay olmadan tamamlanamaz (#122'nin kod tarafındaki ucu). |
| 11 | **E-33** Kaza kayıtları hiç okunamıyor | K1 | Kayıt var, okuma yüzeyi yok → diskte birikiyor. |
| 13 | **E-31** Uzun yol ön-kontrol kapısı sorulmuyor | K1 | "Kanıtsız PASS üretilmez" vaadinin ön kapısı yok. |
| 14 | **E-26/E-29/E-02/E-03/E-04/E-32** Diğer teyitli yetimler | K1 | Kullanıcıya görünmeyen ama bakım yükü ve sessiz ayrışma riski taşıyan ölü uçlar. |
| — | ~~E-08 · E-13 · E-14 · E-18~~ | — | **§0.1'de GERİ ÇEKİLDİ** — ölçüm hatası, kusur yok. |
| 17 | **E-06** `DEFAULT_FUEL_PRICE` sessiz varsayılanı | K5 | "(tahmini)" etiketi var → dürüstlük kısmen korunuyor; yine de ölçüm sanılabilir. |
| 18 | **E-12/E-27/E-30** Bugün zararsız, ayar anında patlar | K2/K1 | Değerler şu an aynı; ilk ayarda sessizce ayrışır. |

---

## 9. ŞÜPHE AMA ÖLÇÜLEMEDİ (bulgu SAYILMAZ)

Aşağıdakiler işaret gördü ama bu taramanın araçlarıyla **kanıtlanamadı**. Bulgu
listesine alınmadı; ölçüm yolu birlikte yazıldı.

1. **Head unit ↔ sunucu çift uygulama (E-37'nin ayrımı).** `driverDnaEngine` ·
   `fleetIntelligenceEngine` · `aiEvidenceEngine` · `maviReasoningEngine` formüllerinin
   SQL tarafında (migration 055/056/058) **kopyası olup olmadığı** ölçülemedi — SQL
   dosyaları bu taramanın kapsamı dışındaydı.
   *Ölçüm yolu:* migration dosyalarında eşik/formül sabitlerini (`SINGLE_VEHICLE_CEILING`,
   DNA eşikleri, güven tavanları) arayıp TS karşılıklarıyla sayı sayı karşılaştırmak.

2. **`geocodingProviders` gerçekten ölü mü?** `getGeocodeProvider` dış çağıranı yok ama
   **kendi dosyası içinde** iki yerde (`:93`, `:172`) kullanılıyor; o iki sarmalayıcının
   dış çağıranı ayrıca izlenmedi. Modül tamamen ölü olabilir de, olmayabilir de.
   *Ölçüm yolu:* `geocodingProviders.ts`'in tüm export'ları için çağrı grafiğini iki
   seviye derinlikte çıkarmak.

3. **`scenarioVerdict` vs `longRoadReport` hüküm mantığı (E-32'nin ikinci yüzü).**
   `scenarioVerdict` çağrılmıyor ama rapor katmanında `judgePersistence` /
   `judgeRealVehicle` var — hüküm mantığının **ikinci bir yerde tekrarlanmış** olma
   şüphesi var. İki fonksiyonun gövdeleri karşılaştırılmadı.
   *Ölçüm yolu:* iki hüküm fonksiyonunun eşiklerini/karar tablosunu yan yana koymak.

4. **`platformCoreAiRuntimeWiring` hangi yolu kullanıyor?** `createAiCoreRuntime`
   çağrılmıyor ama wiring dosyası aynı modülden import ediyor. Wiring'in runtime'ı
   başka bir yoldan mı kurduğu, yoksa yalnız tip mi aldığı okunmadı.

5. **Native (Java/Kotlin) taraf tamamen ölçülmedi.** `android/` altındaki hiçbir sınıf
   bu taramaya girmedi. LAB'ın "native alan yok → 0" bulgularının (E-19, E-21, E-22)
   **native tarafta alan gerçekten var mı** sorusu cevapsız.
   *Ölçüm yolu:* native plugin'in döndürdüğü JSON şemasını gerçek cihazda `adb` ile
   yakalayıp JS'in beklediği alan adlarıyla karşılaştırmak.

6. **Dinamik/string ile çözülen çağrılar.** Ölçüm aracı yalnız statik identifier
   eşleşmesi yapar. Bir sembol `registry['recordEvidence']` gibi çağrılıyorsa
   "yetim" görünür. Bulguların hepsi grep ile ikinci kez doğrulandı ama **teorik
   olarak** bu boşluk duruyor.

7. **`admin/` ve `website` alt uygulamaları** bu denetimin kapsamına alınmadı (görev
   LAB kataloğu modüllerini istedi). Oralarda benzer örüntü olup olmadığı bilinmiyor.

---

## 10. DENETİMİN KENDİ HÜKMÜ

- **Hastalık gerçek ve sistematiktir** — ama ilk turda sanıldığından **daha dar**.
  Düzeltme turundan (§0.1) sonra "motor yazılmış, besleyen bağlanmamış" örüntüsü
  **16 ayrı yerde** teyitli kaldı (E-02·E-03·E-04·E-07·E-15·E-16·E-17·E-20·E-23·E-24·
  E-25·E-26·E-29·E-31·E-32·E-33 + düzeltilen E-34). Dört iddia ölçüm hatasıydı ve geri
  çekildi. Guardian tek örnek değildi, **en görünür örnekti**.
- **İkinci otorite hastalığı da gerçektir** ama farklı bir biçimde: tek bir kavramın
  iki uygulaması yerine, çoğunlukla **aynı eşiğin onlarca kopyası** (E-36) ve
  **iki ayrı karar zinciri** (E-35 geofence, E-37 head unit/sunucu) olarak görünüyor.
- **İyi haber:** dürüstlük sözleşmesi (`sessionInspectorModel`) sağlam ve VIN maskesi
  (E-38) tek otoriteye toplanmış. Kusurlar sözleşmenin kendisinde değil, **sözleşmeyi
  atlayan kaynak katmanlarında** (E-19·E-21·E-22).
- **Kataloğun dürüstlüğü korunmuş:** 41 AVAILABLE / 7 PLACEHOLDER / 2 DISABLED sayımı
  vizyon belgesindeki iddiayla **birebir uyuşuyor** ve AVAILABLE araçların tamamının
  gerçek bir ekran eşlemesi var. Ayrışma katalogda değil, **ekranın arkasındaki veri
  üretiminde**.

