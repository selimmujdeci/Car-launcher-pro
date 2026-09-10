# CAROS PRO — NAVIGATION CORE RELIABILITY P0

**Tarih:** 2026-08-03
**Girdi:** `docs/NAVIGATION_REALITY_AUDIT_AND_OEM_GAP_ANALYSIS.md` + gerçek kod okuması.
**Kapsam:** temel sürüş görevi — doğru rota · doğru takip · doğru zamanda uyarı ·
hızlı sapma algılama · hızlı ve doğru yeniden rota · mantıksız yola yönlendirmeme.
**Bu turda YAPILMADI (kapsam dışı, bilinçli):** AI Route Intelligence · Driver Model ·
Predictive Navigation · Digital Twin · kamera · hazard community · trafik tahmini ·
rota kişiselleştirmesi · yeni görsel tasarım · offline graph üretimi · lane guidance
geliştirmesi.
**Commit / push / deploy / production işlemi YAPILMADI.** Dirty worktree korundu;
`git checkout · restore · reset · clean · stash pop` KULLANILMADI.

---

## 1. YÖNETİCİ ÖZETİ

İki saha şikâyetinin kökü bulundu ve ikisi de **tek bir yapısal eksikten** besleniyordu:
**ham GPS noktası doğrudan rota kararı olarak kabul ediliyordu.**

- *"Yeniden rota çok geç hesaplanıyor"* → gecikme üç ayrı kalemden birikiyordu:
  (a) sapma kanıtı toplanmadan ÖNCE dönen throttle kapısı, (b) uçuşta istek varken
  sapmanın sessizce düşürülmesi, (c) her rotada denenen ölü `localhost:5000` katmanı.
- *"Rota bazen yanlış ve mantıksız yollardan götürüyor"* → reroute isteği aracın
  **ham** GPS noktasından başlıyordu (gürültü paralel/servis yoluna düşünce OSRM oraya
  yapışıyor) ve sağlayıcının **ilk** rotası **koşulsuz** kabul ediliyordu.

Bu tur, karar zincirine üç yeni **saf** katman koydu — map matching, çok-kanıtlı sapma
durum makinesi, rota doğrulama kapısı — ve rota isteklerine bir **yaşam döngüsü**
(kimlik · iptal · bayat yanıt reddi · gecikme ölçümü) verdi. Ayrıca denetimin işaret
ettiği iki dürüstlük ihlali kapatıldı: kuş uçuşu manevra mesafesi ve kanıtsız şerit
rehberi.

Ek olarak, denetimde YER ALMAYAN ama zincirin içinde duran bir **birim hatası** bulundu:
`UnifiedVehicleStore.speed` zaten km/h iken `navigationService` üç yerde 3.6 ile
çarpıyordu. Bu, ETA'yı sistematik olarak kısa gösteriyor ve **varış tespitini
tetiklenemez hâle getiriyordu**.

**Nihai karar: `NAVIGATION_CORE_RELIABILITY_P0_COMPLETE_LOCAL`** (gerekçe §17).
**Gerçek araçta hiçbir senaryo koşulmadı** → `realVehicleValidationVerdict =
FIX_PENDING_REAL_VEHICLE_RETEST`.

---

## 2. ŞİKÂYETLERİN KÖK NEDENİ

Kod yazmadan önce çıkarılan preflight bulgu tablosu. Her satır dosya·satır kanıtına dayanır.

| # | Halka | Bulgu | Kanıt (değişiklik ÖNCESİ) |
|---|-------|-------|---------------------------|
| K1 | Hız birimi | `store.speed` **km/h**, `navigationService` 3 yerde **×3.6** | `UnifiedVehicleStore.ts:80` vs `navigationService.ts:477,537,555` |
| K2 | Reroute başlangıcı | `_triggerReroute` **ham GPS**'i origin veriyordu | `routingService.ts:965` |
| K3 | İstek kimliği | `fetchRoute`'ta request ID / iptal / stale reddi **YOK** | `routingService.ts:675-811` |
| K4 | Reroute gecikmesi | Throttle **kanıt toplamadan ÖNCE** `return`; `_isFetchingRoute` sessiz düşürme | `routingService.ts:922, 964, 977` |
| K5 | Ölü L0 katmanı | Native'de **her rotada** `localhost:5000`, 3 sn timeout | `offlineRoutingService.ts:78-87` |
| K6 | Manevra mesafesi | `hav()` **kuş uçuşu** → virajda erken anons | `routingService.ts:877` |
| K7 | Off-route kanıtı | Tek boyut (dik mesafe) + sabit 3 tick; heading/ilerleme yönü kullanılmıyor | `routingService.ts:958-969` |
| K8 | Rota kabulü | `routes[0]` **koşulsuz** (tek kontrol: origin < 2000 m) | `routingService.ts:398,417` |
| K9 | Şerit | `lanes` hiç ayrıştırılmıyor; ok **manevra tipinden** üretiliyordu | `NavigationHUD.tsx:475,636` |
| K10 | Ses | Tier bitmask yalnız `currentStepIndex`'e bağlı → reroute'ta step 0→0 ise **sessiz** | `NavigationHUD.tsx:1862` |

### 2.1 "Yeniden rota çok geç" — gecikme bütçesi

| Kalem | Önce | Sonra |
|-------|:----:|:-----:|
| Sapma kanıtı toplanmadan dönen throttle | 5/10/15 sn boyunca sayaç **hiç ilerlemiyordu** | throttle yalnız **tekrar isteği** bastırır; kanıt her tick birikir |
| Kanıt penceresi | sabit 3 tick (hız/doğruluk körü) | **uyarlanabilir**: 2–5 örnek + 0.8–2.5 sn; kaba sapmada kısalır |
| Uçuşta istek varken sapma | **sessizce düşülüyordu** ve throttle zaten yazılmıştı → bir tam pencere daha kayıp | yeni istek **başlar**, eskisi SUPERSEDED |
| Ölü L0 katmanı | **her** rotada, 3 sn'ye kadar | oturumda **tek** yoklama, 700 ms tavan |
| Tekrar bastırma penceresi | 5 / 10 / 15 sn | 2.5 / 4 / 6 sn |

### 2.2 "Saçma yoldan götürüyor" — üç ayrı kök

1. **Reroute origin ham GPS'ti.** Sapma anında ham nokta çoğu kez paralel/servis
   yolunun üstüne düşer; OSRM oraya yapışır. Artık araç rotadaysa **oturtulmuş**
   konum, gerçekten çıkmışsa ham konum kullanılır — ama her iki durumda da konum
   **çoklu kanıtla doğrulanmıştır** (tek gürültü örneği reroute'a kadar gelemez).
2. **Sağlayıcının ilk rotası koşulsuz kabul ediliyordu.** `alternatives=3` zaten
   isteniyordu ama yalnız UI'a sunuluyordu. Artık **hepsi doğrulanır** ve en az
   kusurlu olan aktif rota olur.
3. **Bayat yanıt güncel rotayı ezebiliyordu.** İstek kimliği yoktu.

---

## 3. ESKİ NAVİGASYON AKIŞI (değişiklik öncesi)

```
GPS fix ──► FullMapView tick ──► updateRouteProgress(lat, lon)
                                   │
                                   ├─ adım ilerleme: hav(araç, manevra) < 30 m + dot-product
                                   ├─ distanceToNextTurn = hav(araç, manevra)      ← KUŞ UÇUŞU
                                   └─ sapma:
                                        throttle geçmediyse ► RETURN (sayaç DONAR)
                                        speed < 3 / acc > 50 ► RETURN
                                        minSegDist > 55 + acc ► sayaç++
                                        sayaç >= 3 ► _triggerReroute(HAM lat, lon)
                                                       │
                                                       └─ _isFetchingRoute ► RETURN (sessiz)
                                                          fetchRoute(...)            ← KİMLİKSİZ
                                                            L0 localhost:5000 (3 sn) ← ÖLÜ
                                                            L1/L2 OSRM → routes[0]   ← KOŞULSUZ
                                                            store.setState(...)      ← YARIŞ
```

Zincirin omurgası doğruydu (tek otorite, dürüst hata bildirimi) — eksik olan
**karar kalitesiydi**.

---

## 4. MAP MATCHING

**Yeni saf modül:** `src/platform/navigation/core/mapMatchModel.ts`

Aday puanı **üç bağımsız kanıttan** gelir; "en yakın yol" seçimi TEK BAŞINA kullanılmaz:

| Kanıt | Ağırlık (önceki eşleşme varken) | Neden |
|-------|:-------------------------------:|-------|
| Dik mesafe | 0.45 | temel yakınlık |
| **Yön uyumu** | 0.35 | bölünmüş bulvarda karşı şeridi eleyen **tek** sinyal |
| **İlerleme sürekliliği** | 0.20 | ani sıçrama ve geriye kaymayı cezalandırır |

Ayrıca: GPS doğruluğu, hız, önceki eşleşen segment, aktif rota segmentleri ve
hareket yönü girdi olarak kullanılır.

**Durumlar:** `MATCHED · MATCH_UNCERTAIN · OFF_NETWORK · STALE · UNKNOWN`
Her eşleşme `confidence` taşır; **`MATCHED` dışındaki hiçbir durumda güven 0.40'ı
aşamaz** (fail-closed). Ham GPS **kaybolmaz** — `rawLat/rawLon` alanında tanı için durur.

**Eşikler (hepsi gerekçeli):** koridor `55 m + min(accuracy, 40)`; bayat fix `> 5 sn`;
belirsiz doğruluk `> 35 m`; ters yön `≥ 120°`; yön uyumsuzluğu `> 80°`;
sıçrama tavanı `hız × Δt × 3 + 60 m`.

### 4.1 DÜRÜST KAPSAM SINIRI (pazarlıksız)

Bu bir **rota-göreli** eşleştiricidir, **tam yol-ağı eşleştiricisi DEĞİLDİR.**
Cihazda yol ağı grafiği yoktur (`routing-graph.bin` paketlenmemiş — denetim §4.1).
Elimizdeki tek gerçek yol geometrisi aktif rotadır. Dolayısıyla `OFF_NETWORK`
"araç aktif rota koridorunun dışında" demektir; **hangi yolda olduğunu SÖYLEYEMEYİZ**
— o veri cihazda yok. Kanıtsız "servis yolundasınız" iddiası üretilmez.
Bu, §15'te **açık borç** olarak kayıtlıdır.

### 4.2 Bu turda bulunup düzeltilen kendi kusurum

İlk uygulamada CPU koruma filtresi (koridorun 3 katından uzak adayları puanlama)
**tüm** adayları elediğinde sonuç `UNKNOWN` dönüyordu. `UNKNOWN` sapma makinesinde
"karar verme, bekle" demektir — yani **en belirgin sapmada reroute HİÇ
tetiklenmezdi.** Artık en yakın segment her hâlükârda kaydedilir ve durum dürüstçe
`OFF_NETWORK` döner. Kilit: `regression.guards` → *"koridor dışı UNKNOWN sayılmaz"*.

---

## 5. OFF-ROUTE STATE MACHINE

**Yeni saf modül:** `src/platform/navigation/core/offRouteModel.ts`

```
UNKNOWN ──► ON_ROUTE ──► SUSPECTED_OFF_ROUTE ──► CONFIRMED_OFF_ROUTE ──► REROUTING
                ▲                │                        │                   │
                └──── REJOINED ◄─┴────────────────────────┴───────────────────┘
```

**Kurallar:**
- **Tek örnek ASLA doğrulamaz** — hem SAYI hem SÜRE koşulu sağlanmalı.
- **Sabit keyfî gecikme yok.** Gereken kanıt hızdan ve doğruluktan türetilir:

| Koşul | Gereken örnek | Gereken süre |
|-------|:-------------:|:------------:|
| > 70 km/h | 2 | 800 ms |
| 15–70 km/h | 3 | 1 500 ms |
| < 15 km/h | 4 | 2 500 ms |
| doğruluk > 25 m (veya bilinmiyor) | +1 | — |
| kaba sapma (koridor × 3) | −1 | ≤ 1 200 ms |

  Sınırlar: 2 ≤ n ≤ 5.
- **GPS bilinmiyorsa karar YOK.** `STALE`/`UNKNOWN` eşleşmede mevcut durum korunur,
  kanıt sayacı sıfırlanır → **tünel/sinyal kaybı sapma sayılmaz.**
- **`MATCH_UNCERTAIN` tek başına sapma kanıtı değildir** — belirsizlik, sapma
  olduğunu değil *bilmediğimizi* söyler.
- **Reroute sürerken** eski rotaya göre sapma yeniden değerlendirilmez.
- `confirmedAtMs` **T0'dır** ve sonraki örneklerde kaymaz (gecikme ölçümü bozulmaz).

---

## 6. REROUTE

**Yeni modül:** `src/platform/navigation/core/routeRequestLedger.ts` (timer yok, saat enjekte).

- Her istek **kimlik** alır; `beginRouteRequest` uçuşta kalanı `SUPERSEDED` işaretler.
- **Her store yazısından önce** `isCurrentRequest(reqId)` doğrulanır → **bayat yanıt
  güncel rotayı EZEMEZ** (sayaç: `staleRejectedCount`).
- Doğrulanmış sapmada: eski talimatlar susar (`REROUTING`), istek **güncel** konumdan
  ve **aracın yönüyle** gider, hedef ve kullanıcı tercihleri korunur.
- Aynı sapma için tekrar istek bastırılır ve **sayılır** (`suppressedDuplicateCount`)
  — sessiz düşürme yok.
- Reroute başarısız olursa düz hat **açıkça** `STRAIGHT_LINE_GUIDANCE` olarak
  etiketlenir; eski yanlış yönlendirmeye devam edilmez.

**Ölçülen gecikme zinciri:**
`offRouteDetectedAt → requestStartedAt → responseReceivedAt → routeCommittedAt →
firstNewInstructionAt` (+ türetilmiş `detectToCommit`, `detectToFirstInstruction`,
`requestToResponse`). Hepsi CAROS LAB'da görünür.

### 6.1 Reroute başlangıç noktası — kritik ayrım

| Durum | Origin | Neden |
|-------|--------|-------|
| `MATCHED` | **oturtulmuş** konum | ham nokta paralel yola düşerse OSRM oraya yapışır |
| `OFF_NETWORK` | **ham** konum | eski rotaya oturtmak aracı BULUNMADIĞI yere koymak olurdu |

Her iki durumda da `accuracy > 50 m` ise reroute **yapılmaz** (fail-closed).

---

## 7. ROUTE VALIDATION

**Yeni saf modül:** `src/platform/navigation/core/routeValidationModel.ts`

Sağlayıcının ilk rotası artık koşulsuz kabul edilmez. Tüm adaylar (ana + alternatifler)
doğrulanır, `pickBestRoute` **en az kusurlu** olanı seçer, `REJECTED` rota
navigation state'e **hiç uygulanmaz**.

| Denetim | Eşik | Sonuç |
|---------|------|-------|
| `STALE_REQUEST` | — | FAIL (diğerlerine bakılmaz) |
| `GEOMETRY` | ≥2 nokta, sonlu koordinat, nokta aralığı ≤ 5 km | FAIL / WARN |
| `ORIGIN_PROXIMITY` | > 200 m WARN, > 1 000 m FAIL | ters şeride yapışma işareti |
| `START_HEADING` | > 90° WARN, > 150° FAIL | **sahte U dönüşü sınıfının doğrudan ölçüsü** |
| `REACHES_DESTINATION` | > 120 m WARN, > 500 m FAIL | rota hedefe varmıyor |
| `METRICS_SANE` | ima edilen ortalama 3–200 km/h | WARN |
| `DETOUR_RATIO` | > 3× WARN, > 6× FAIL | "kısa yol dururken absürt uzun rota" |
| `EARLY_UTURN` | ilk 150 m içinde U dönüşü | WARN |
| `UTURN_COUNT` | > 2 | WARN |
| `SHARP_TURN_BURST` | < 40 m arayla ardışık keskin dönüş | WARN |
| `INITIAL_BACKTRACK` | ilk 300 m'de hedeften > 150 m uzaklaşma | WARN |
| `ROAD_CLASS_MIX` | — | **UNKNOWN** — kanıt yok, uydurulmaz |

Hüküm: FAIL ⇒ `REJECTED` · WARN ⇒ `DEGRADED` (uygulanır, işaretli) · aksi `VALID`.

**Düz hat doğrulanmaz.** O bir rota adayı değil, açıkça etiketlenmiş son çaredir;
ona "GEÇERLİ" demek tam olarak kaçındığımız yalandır.

---

## 8. YOL-BOYU MANEVRA MESAFESİ

**Yeni saf modül:** `src/platform/navigation/core/maneuverIndexModel.ts`

Denetim §7.1 haklıydı: düzeltme **ucuzdu**. `cumulativeDistances` (suffix-sum) zaten
vardı; eksik olan tek şey manevra noktasının **geometri indeksiydi**.

- **KESİN yöntem:** OSRM adım geometrileri uç uca eklenir (adım *i*'nin bitişi
  adım *i+1*'in başlangıcıdır → indeks ilerlemesi `len(i) − 1`). Hata payı ≤ 25 m.
- **Yedek:** en yakın nokta araması (≤ 60 m).
- **Bağlanamazsa** `UNRESOLVED` → mesafe `null`. **`null` "0 m" DEĞİLDİR**;
  çağıran kesin komut üretmez.

Sonuç: `distanceToNextTurnMeters` artık **rota üzerinde** ölçülür ve store
`distanceToNextTurnSource` (`ALONG_ROUTE · STRAIGHT_LINE · UNKNOWN`) ile hangi
yöntemin kullanıldığını **dürüstçe** taşır. Adım ilerleme de yol-boyu ilerlemeye
dayanır; eşleşme geriye kaysa bile adım **geri gitmez** (aynı manevra tekrar
seslendirilmez).

---

## 9. SESLİ YÖNLENDİRME

- Üç kademe korundu (600 m / 250 m / hıza bağlı son uyarı `clamp(hız×4 sn, 35, 150)`).
- **Rota değişince kademeler sıfırlanır.** Eski tekrar koruması yalnız
  `currentStepIndex`e bakıyordu; reroute sonrası indeks 0'a döner ve araç zaten
  0. adımdaysa **yeni rotanın ilk manevrası hiç seslendirilmiyordu.** Artık rota
  kimliği (geometri referansı) de izlenir.
- **Mesafe bilinmiyorsa (`UNKNOWN`) konuşulmaz** — "300 metre sonra sağa dönün"
  demek uydurmaktır.
- **Dönel kavşak:** `maneuver.exit` artık ayrıştırılır. Sayı VARSA
  *"Dönel kavşakta ikinci çıkıştan ayrılın"*, YOKSA eski genel ifade — **uydurulmaz.**
- İlk yeni talimat anı `markFirstNewInstruction` ile damgalanır (gecikme zincirinin
  son halkası).

---

## 10. LANE GUIDANCE DÜRÜSTLÜĞÜ

`NavigationHUD.LaneGuidance` şerit oklarını **manevra tipinden türetiyordu**
("sağa dön" → sağ ok yanar). Bu, sürücüye kavşakta gerçek şerit bilgisi varmış
izlenimi verir ve **ürünün kendi "kanıtsız bilgi üretme yasağının" doğrudan
ihlaliydi.**

- OSRM `intersections[].lanes` artık ayrıştırılır (`RouteStep.lanes`).
- Gerçek veri varsa **o veriden** çizilir (`valid` + `active` bayrakları).
- **Veri yoksa panel HİÇ ÇIKMAZ.** `UNKNOWN` şerit düz oklarla DOLDURULMAZ.
- Bu turda **tam lane guidance geliştirilmedi** (kapsam dışı) — yalnız yanlış bilgi
  üretimi kapatıldı.

CAROS LAB'da sayaç: *"GERÇEK şerit verisi olan adım: N / M"*.

---

## 11. PROVIDER SEÇİMİ

Denetim §4.2: Android'de `localhost:5000` daemon'u **yoktur**, buna rağmen
**her rotada** oraya istek atılıyor ve 3 sn'ye kadar bekleniyordu — sapma anında
doğrudan reroute gecikmesi.

**Yeni modül:** `routeProviderReadiness.ts`

| Durum | Anlamı |
|-------|--------|
| `UNKNOWN` | henüz ölçülmedi |
| `LOCAL_OSRM_AVAILABLE` | yerel daemon yanıt verdi |
| `LOCAL_OSRM_UNAVAILABLE` | yok — **bir daha DENENMEZ** |
| `REMOTE_PROVIDER_AVAILABLE` | uzak sağlayıcı kullanılabilir |
| `NO_ROUTE_PROVIDER` | gerçek rota sağlayıcısı yok |

- Yoklama oturumda **BİR KEZ** ve **700 ms** tavanla yapılır.
- Atlanan istek sayısı **sayılır** (`localSkippedCount`) — sessiz gizleme değil,
  ölçülebilir tasarruf.
- Kaynak sınıfı ayrıdır: `LOCAL_DAEMON · REMOTE_OSRM · OFFLINE_GRAPH ·
  STRAIGHT_LINE_GUIDANCE · NONE`. **Düz hat navigation route SAYILMAZ.**

---

## 12. CAROS LAB

**Yeni ekran:** `Araç › Navigation Core` (`navigation-core`, AVAILABLE).
Dosyalar: `navigationCoreSources.ts` (tek senkron okuma) → `navigationCoreModel.ts`
(saf) → `NavigationCoreScreen.tsx` (OEM token · açılışta tek okuma + elle YENİLE ·
timer yok · `mountedRef` + cleanup) → katalog → `carosLabScreenMap` (lazy).

**8 kart:** Navigasyon Durumu · Rota Sağlayıcı · Map Matching · Sapma Algılama ·
Yeniden Rota (istek + gecikme) · Rota Doğrulama Kapısı · Manevra Mesafesi ·
Dürüstlük Sayaçları.

Görev §10'daki tüm alanlar karşılandı; iki tanesi **gizlilik kuralı gereği
dönüştürüldü**:

> **Görev "raw GPS" ve "matched position" göstermeyi istiyor. Koordinat
> GÖSTERİLMEDİ.** CLAUDE.md gözlemlenebilirlik kuralı 6 konumu hassas veri sayar ve
> `LocationEngineScreen` aynı kararı zaten uygulamıştır. Tanı ihtiyacı koordinat
> SIZDIRMADAN karşılandı: ham fix **VAR/YOK + yaş**, oturtulmuş konum
> **VAR/YOK + rotaya dik mesafe**. Hedef adı, adres ve rota geometrisi taşınmaz.
> Bu bilinçli bir sapmadır ve burada kayda geçirilmiştir.

LAB **hiçbir şey başlatmaz**: navigasyon başlatma/durdurma, hedef seçme, rota isteği,
reroute zorlama, sağlayıcı değiştirme ve ağ çağrısı YOK (kilitle doğrulanmıştır).

---

## 13. TEST SONUÇLARI

| Paket | Sonuç |
|-------|-------|
| **Tüm birim/entegrasyon** | **466 dosya · 10 389 test · TAMAMI GEÇTİ** |
| `tsc --noEmit -p tsconfig.app.json` | **temiz (0 hata)** |
| `npm run lint` | değiştirdiğim/eklediğim dosyalarda **0 hata, 0 uyarı** (4 hata repoda ÖNCEDEN vardı: `test-parser.ts`, `maviActionAuthority.test.ts`, `tripMetricsP2.test.ts` — bu turda dokunulmadı) |
| `npm run build` | **başarılı (1 dk 13 sn)** |

### 13.1 Yeni testler

| Dosya | Kapsam | Adet |
|-------|--------|:----:|
| `navigationCoreModels.test.ts` | A · B · D · E | 48 |
| `navigationRerouteLifecycle.test.ts` | C + §9 provider + eşzamanlılık | 18 |
| `carosLabNavigationCore.test.tsx` | F (LAB · salt-okunur · gizlilik · dürüstlük) | 28 |
| `regression.guards.test.ts` (eklenen) | NAV-CORE-P0 kalıcı kilitleri | 9 |

**A. Map matching (12):** doğru segment · ham GPS korunuyor · ters yön · paralel yol ·
düşük doğruluk · doğruluk bilinmiyor · bayat fix · durakta yön · koridor dışı ·
süreklilik monotonluğu · ani sıçrama · geçersiz girdi.

**B. Off-route (14):** tek kötü fix · gürültü sonrası dönüş · doğrulanmış sapma ·
T0 kaymaz · tünel · GPS bilinmiyor · hızlı araç · kötü doğruluk · kaba sapma ·
yavaş araç · sayı yeter süre yetmez · rotaya dönüş · reroute sırasında sayma ·
commit temizliği.

**C. Reroute (18):** yalnız güncel istek uygulanır · SUPERSEDED · bayat reddi ·
doğrulama reddi · tekrar bastırma · sağlayıcı hatası · gecikme ayrıştırması ·
ilk talimat damgası · commit yokken damga yok · defter temizliği · yerel yoklama
sınırı · tek yoklama · daemon var · sağlayıcı yok · düz hat ayrı sınıf ·
**eşzamanlı yarışta eski yanıt store'u ezemiyor** · düz hat doğrulanmıyor ·
commit'te çapalar kuruluyor.

**D. Route validation (12):** geçerli · bayat istek · geçersiz geometri · NaN
koordinat · hedefe ulaşmıyor · ters başlangıç · yön bilinmiyor → UNKNOWN ·
erken U dönüşü · absürt uzun rota · yol sınıfı UNKNOWN · reddedilen seçilmez ·
hepsi reddedilirse null · en az kusurlu kazanır.

**E. Maneuver (7):** uç uca kesin çapa · en yakın yedeği · bağlanamayan UNRESOLVED ·
**yol-boyu > kuş uçuşu (L rotasında)** · geçilen manevra · konum yoksa null ·
negatife düşmez.

**F. Regresyon:** Navigation · Location Engine · GPS · Trip · Mavi voice ·
Media audio focus · CAROS LAB · Autonomous Field Validation — tamamı yeşil.

### 13.2 Bu turda güncellenen (KALDIRILMAYAN) kilitler

CLAUDE.md kuralı gereği bilinçli davranış değişiminde kilit **güncellenir**:

1. `regression.guards` → *"sapma eşiği GPS hata payına duyarlı + ≥3 ardışık tick"*.
   Korunan davranış (hata payı duyarlılığı + tek gürültü reroute etmez) **aynen
   korunuyor** ama artık `routingService`'in iki satırında değil `offRouteModel`
   durum makinesinde yaşıyor ve daha güçlü. Kilit **4 yeni kilide genişletildi**.
2. `realDriveFindings` → H3 son uyarı eşiği. Deps dizisine `_routeKey` eklendi;
   kilit konum yerine **varlığa** bakacak şekilde güncellendi (`speedKmh` deps'te
   kalmalı koşulu korundu).

### 13.3 Testlerin yakaladığı GERÇEK kusurlar (bu turda benim eklediklerim)

1. **Map matching koridor dışını `UNKNOWN` sayıyordu** → reroute tamamen ölürdü (§4.2).
2. **`recordFailure` kendi güncellik kapımı bozuyordu** → düz-hat yolunda store'a
   hiç yazılmıyordu, rota tamamen kayboluyordu. (`navigationLogic.test.ts` yakaladı.)

Her ikisi de düzeltildi ve kilitlendi.

---

## 14. DEĞİŞEN DOSYALAR

**Yeni (saf çekirdek) — `src/platform/navigation/core/`**
- `geo.ts` — geometri primitifleri (routingService'ten taşındı, oradan yeniden ihraç
  edildi; 5 mevcut tüketici kırılmadı, yeni matematik yazılmadı)
- `mapMatchModel.ts` · `offRouteModel.ts` · `routeValidationModel.ts` ·
  `maneuverIndexModel.ts` · `routeRequestLedger.ts` · `routeProviderReadiness.ts`

**Yeni (CAROS LAB)**
- `src/platform/devtools/navigationCoreSources.ts`
- `src/platform/devtools/navigationCoreModel.ts`
- `src/components/devtools/screens/NavigationCoreScreen.tsx`

**Değişen**
- `src/platform/routingService.ts` — istek yaşam döngüsü · doğrulama kapısı ·
  map-matched reroute origin · yol-boyu manevra mesafesi · `maneuver.exit` + `lanes`
  ayrıştırma · `_storeAllRoutes` kaldırıldı · throttle yeniden gerekçelendirildi
- `src/platform/offlineRoutingService.ts` — L0 sınırlı tek yoklama · exit/lanes
- `src/platform/navigationService.ts` — **3 adet 3.6× birim hatası** düzeltildi
- `src/components/map/NavigationHUD.tsx` — gerçek şerit verisi · ses kuyruğu sıfırlama
  · mesafe kaynağı kapısı · ilk talimat damgası
- `src/platform/devtools/carosLabCatalog.ts` · `src/components/devtools/carosLabScreenMap.tsx`
- `src/__tests__/regression.guards.test.ts` · `src/__tests__/realDriveFindings.test.ts`

**Yeni testler:** `navigationCoreModels.test.ts` · `navigationRerouteLifecycle.test.ts`
· `carosLabNavigationCore.test.tsx`

**Dokümanlar:** bu rapor · `DEVICE_VALIDATION_LEDGER.md` · `CAROS_PRO_VIZYONU.md`

---

## 15. AÇIK BORÇLAR

| # | Borç | Neden bu turda kapatılmadı |
|---|------|----------------------------|
| 1 | **Tam yol-ağı map matching** — `OFF_NETWORK`'te aracın hangi yolda olduğu bilinmiyor | `routing-graph.bin` cihazda YOK; offline graph üretimi görev kapsamı dışı |
| 2 | **Çevrimdışı gerçek rota** — internet yoksa hâlâ düz hat | aynı artefakt; kapsam dışı |
| 3 | **Tam lane guidance** — gerçek `lanes` gösteriliyor ama şerit sayısı/eşleme derinleştirilmedi | kapsam dışı (yalnız yanlış bilgi kapatıldı) |
| 4 | **`ROAD_CLASS_MIX` denetimi UNKNOWN** — servis yolu/ara sokak oranı ölçülemiyor | OSRM segment-başı sınıf eşlemesi bağlanmadı |
| 5 | **Trafik verisi yok** — ETA gerçek yol koşulunu bilmiyor | kapsam dışı |
| 6 | **Hayalet GPS hızı (#362)** — düzlük oranı filtresi hâlâ uygulanmadı | hız otoritesi güvenlik katmanlarını besler; ayrı tur |
| 7 | **`navigateToAddress` ölü kod** (0 çağrı) | temel güvenilirlik dışı; ayrı atomik PR |
| 8 | **OSM tile policy ticari riski** | ürün/hukuk kararı, kod kusuru değil |
| 9 | **Gerçek araç doğrulaması** | §16 |

---

## 16. GERÇEK ARAÇ KABUL PLANI (Kuga)

Yerel test **saha kanıtı değildir.** Aşağıdaki 10 senaryo gerçek araçta ölçülecek;
her biri `docs/DEVICE_VALIDATION_LEDGER.md` içine 🔴 olarak eklendi.

| # | Senaryo | Ölçülebilir kabul ölçütü |
|---|---------|--------------------------|
| 1 | Normal rota başlatma | Rota `VALID`; ilk manevra ilk 10 sn içinde; `START_HEADING` PASS |
| 2 | Doğru yolda 10 km | `MATCHED` oranı ≥ %95; `distanceToNextTurnSource = ALONG_ROUTE` ≥ %95 |
| 3 | Bilerek güvenli dönüş kaçırma | `CONFIRMED_OFF_ROUTE` **≤ 4 sn**; `detectToFirstInstructionMs` **≤ 12 sn** |
| 4 | Paralel servis yolu | Servis yolunda `MATCHED` OLMAMALI (heading farkı ile ayrışmalı); sahte reroute 0 |
| 5 | Döner kavşak | `roundaboutWithExitCount > 0` ise anonsta çıkış numarası duyulmalı; yoksa genel ifade |
| 6 | Şehir içi sık dönüş | Aynı manevra iki kez seslendirilmemeli; adım indeksi geri gitmemeli |
| 7 | GPS doğruluğu düşüşü | `accuracy > 50` iken reroute 0; `MATCH_UNCERTAIN`'e düşmeli |
| 8 | İnternet kısa kesintisi | `STRAIGHT_LINE_GUIDANCE` etiketi görünmeli; "çevrimdışı rota" DENMEMELİ |
| 9 | Rota sırasında arka plan | Dönüşte `staleRejectedCount` artmamalı; rota aynı kalmalı |
| 10 | Process restart sonrası restore | Rota geri yüklenmeli; çapalar yeniden kurulmalı (`anchorUnresolvedCount = 0`) |

Ek ölçüm (birim hatası düzeltmesinin kanıtı):
**ETA ilk 5 dk'da gerçek varış saatiyle ±%15 içinde olmalı** ve
**hedefe yanaşırken `ARRIVED` durumu tetiklenmeli** (eski hâlde tetiklenmiyordu).

Ölçüm yüzeyi hazır: **CAROS LAB › Araç › Navigation Core**.

---

## 17. NİHAİ KARAR

# `NAVIGATION_CORE_RELIABILITY_P0_COMPLETE_LOCAL`

**Neden `COMPLETE_LOCAL`:** görevin 1–12. bölümlerinin tamamı uygulandı, 10 389 test
yeşil, tsc temiz, build başarılı, gözlem yüzeyi kuruldu ve iki saha şikâyetinin de
kök nedeni koddan çıkarılıp kapatıldı.

**Neden `PARTIAL` değil:** kapsam dışı bırakılan hiçbir madde görevin içinde
değildi; §15'teki borçların tamamı ya görev metninde açıkça kapsam dışı bırakılmış
ya da cihazda bulunmayan bir artefakta (offline graph) bağlıdır — ikisi de bu turun
teslim edilebilirini daraltmaz.

**Neden `COMPLETE` (kayıtsız) DEĞİL:** gerçek araçta **hiçbir** senaryo koşulmadı.

### Kapılar

| Kapı | Hüküm | Kanıt |
|------|-------|-------|
| `mapMatchingVerdict` | **PASS (LOCAL)** | 12 test; 3 kanıtlı puanlama; kapsam sınırı yazılı |
| `offRouteDetectionVerdict` | **PASS (LOCAL)** | 14 test; uyarlanabilir pencere; tünel korumalı |
| `rerouteVerdict` | **PASS (LOCAL)** | 18 test; eşzamanlı yarış kilidi; gecikme ölçülüyor |
| `routeValidationVerdict` | **PASS (LOCAL)** | 12 test; REJECTED uygulanmıyor; en az kusurlu seçiliyor |
| `maneuverDistanceVerdict` | **PASS (LOCAL)** | 7 test; yol-boyu bağlandı; kaynak etiketli |
| `voiceGuidanceVerdict` | **PASS (LOCAL)** | rota değişiminde sıfırlama + UNKNOWN'da susma kilitli |
| `laneTruthVerdict` | **PASS (LOCAL)** | kanıtsız panel kapatıldı; gerçek `lanes` bağlandı; kilitli |
| `providerSelectionVerdict` | **PASS (LOCAL)** | ölü L0 tek yoklamaya indi; sıralama ölçülebilir |
| `navigationLabVerdict` | **PASS (LOCAL)** | 28 kilit; salt-okunur + gizlilik doğrulandı |
| `realVehicleValidationVerdict` | **`FIX_PENDING_REAL_VEHICLE_RETEST`** | gerçek araçta hiçbir senaryo koşulmadı |

> **Bu karar, §16'daki 10 senaryo gerçek araçta ölçülene kadar YÜKSELTİLEMEZ.**
> Test yeşilliği ve haritada rota çizilmesi bu ölçütlerin yerine geçmez.
> Başarı ölçütü tektir: *kullanıcı doğru yolda doğru şekilde izleniyor, doğru
> zamanda yönlendiriliyor ve sapınca gecikmeden güvenilir yeni rotaya geçiriliyor.*
