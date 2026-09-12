# CAROS PRO — NAVİGASYON ÇEKİRDEK MİMARİSİ (OEM ÜSTÜ)

> **⚠️ YERİNİ ALDI:** Bu belge artık **boşluk analizi** olarak geçerlidir.
> Bağlayıcı navigasyon sözleşmesi: `docs/NAVIGATION_ARCHITECTURE_SPEC_v2.md`
> (2026-08-28). Çelişki hâlinde **v2 kazanır**.


**Tarih:** 2026-08-28
**Kapsam:** Konum → harita verisi → ufuk → rota → rehberlik → güvenlik → gösterim zincirinin tamamı.
**Yöntem:** (a) repo taraması — gerçek dosya/satır kanıtı; (b) OEM ve büyük uygulama mimarilerinin
araştırılması (NDS.Live, ADASIS v3, Mapbox Navigation SDK v3, TomTom NavKit2, HERE, Valhalla,
OSRM, Google Maps/DeepMind, u-blox ADR, EU GSR/ISA); (c) ikisinin farkının yapısal teşhisi.
**Bu belgede kod yazılmadı.** Belge bir MİMARİ SÖZLEŞMESİDİR; uygulama fazları §17'dedir.

> **Kural:** Bu belgedeki hiçbir "OEM üstü" iddiası, karşılığı olan bir ÖLÇÜLEBİLİR KABUL
> ÖLÇÜTÜ olmadan yazılmadı. Ölçütü olmayan fikir mimariye girmez.

---

## 0. YÖNETİCİ ÖZETİ — TEK CÜMLELİK TEŞHİS

CAROS PRO'nun navigasyonu **katmanları olan ama OMURGASI OLMAYAN** bir sistemdir:
konum otoritesi tek, rota otoritesi tek, oturum otoritesi tek — bunlar doğru — ama
**"aracın önünde ne var" sorusunu cevaplayan ortak bir katman yoktur.** Guardian kuralları,
HUD, sesli rehberlik, hız limiti ve ETA bu soruyu **birbirinden habersiz, beş ayrı yerde,
beş farklı kaliteyle** cevaplar.

OEM navigasyonunda bu katmanın adı vardır: **Electronic Horizon** (ADASIS). Mapbox'ta
`Electronic Horizon`, TomTom NavKit2'de onboard horizon servisi, Elektrobit'te `EB robinos
Predictor`. Hepsi aynı şeyi yapar: haritadan **yalnız aracın önündeki ilgili veriyi** çıkarır,
tek bir ağaç (MPP + alternatif kenarlar) hâline getirir ve **tüm tüketicilere aynı gerçeği**
dağıtır.

**CAROS PRO'da bu katman YOKTUR** (`grep -r "horizon" src/` → yalnız tema adı `HorizonLayout`).
Bu belgenin merkezinde bu katmanın inşası vardır: **CEH — CarOS Electronic Horizon.**

Ve CAROS'un OEM'in üstüne çıkma imkânı tam da buradadır: OEM ufku **yalnız harita**dır.
CAROS'un ufku **harita × araç durumu**dur — çünkü CAROS, OEM'in aksine, aracın canlı
powertrain gerçeğini (OBD/CAN) okur. **Yolun 4 km sonrasındaki %8 rampayı bilmek OEM'dir;
o rampada bu aracın soğutma suyunun 108 °C'ye çıkacağını bilmek OEM üstüdür.**

---

## 1. ARAŞTIRMA — OEM VE BÜYÜK UYGULAMA MİMARİLERİ

### 1.1 NDS / NDS.Live — harita VERİSİNİN mimarisi

| Bulgu | Bizim için anlamı |
|-------|-------------------|
| Harita tek dosya değildir; **building block**'lara bölünür, her biri kendi deposunda | Bugün `routing-graph.bin` **tek monolitik 7.65 MB blob**tur. Türkiye ölçeğine çıkamaz, kısmi güncellenemez. |
| Building block'lar **kullanım amacına göre katmanlara** ayrılır (routing · guidance · truck) | Rota grafiği ile ADAS öznitelikleri (eğim/viraj/limit) AYNI dosyada olmamalı; farklı hızda tazelenirler. |
| NDS.Live **Smart Layer Service**: veri karo · nesne kimliği · YOL (path) ile sunulur | Ufuk katmanı veriyi "path" ile ister — tam olarak CEH'in ihtiyacı. |
| TomTom Orbis, tüm katmanları NDS.Live üstünden **tek teslim servisinden** verir | Bizde de tek `MapStore` cephesi olmalı; tüketici hangi katmanın nereden geldiğini BİLMEMELİ. |

**Alınan karar:** Harita verisi **karo kimliği (z/x/y) ile hizalanmış, bağımsız sürümlenmiş
KATMANLAR** hâline getirilir. Monolitik blob emekliye ayrılır.

### 1.2 ADASIS v3 — ufkun mimarisi (bu belgenin omurgası)

- **AHP (ADAS Horizon Provider):** haritadan ilgili veriyi çıkarır.
- **Protokol:** ufkun kodlanma/kod çözme sözleşmesi (araç veri yolu üstünden).
- **AHR (Horizon Reconstructor):** her tüketici uygulamanın kendi yeniden kurucusu.
- Taşınan içerik: **MPP (Most Preferred/Probable Path)**, araç konumu, **alternatif yollar**,
  ve **yol profilleri** (geometri, azami hız, kavşak bilgisi).
- v3 farkı: **olasılıklı çoklu konum hipotezi** ve **şerit seviyesinde geometri**.

**Alınan karar:** CEH tam olarak bu üçlüyü uygular — `HorizonProvider` (tek üretici) →
`HorizonSnapshot` (donmuş, immutable sözleşme) → `readHorizon()` (çok tüketici).
Guardian kuralları, HUD, ses, ETA ve Vehicle Brain **kendi veri toplamayı bırakır**,
hepsi bu tek ufuktan okur. v3'ün "çoklu hipotez" fikri bizde **`MapMatchState` +
`confidence` + aday listesi** olarak yaşar (§8).

### 1.3 Mapbox Navigation SDK v3 — hibrit-önce (bizim yol arkadaşımız)

| Bulgu | Bizim için anlamı |
|-------|-------------------|
| **Routing tiles cihazda durur** ve dört işi birden besler: map-matching · çevrimdışı rota · Electronic Horizon · gelişmiş konum | Bizde bu dört iş **dört ayrı veri kaynağından** besleniyor. Tek kaynağa indirilmeli. |
| **Hybrid-first:** çevrimiçi hızlıdır, ama kesilince kesintisiz onboard'a düşer | Bizde L0..L4 katmanı VAR ama düşüş "düz hat"a kadar iniyor — bu navigasyon değil. |
| **Free-drive** modu: rota yokken bile ufuk üretilir (en olası yol) | **Bizde tamamen yok.** Rota yokken hız limiti/viraj/kamera uyarısı üretmenin TEK dürüst yolu budur. |
| Konum motorunda **dead reckoning** gömülü | Bizde DR var ama kütükte "KONUM ÖLÜ HESABI YOK — tünel modu ölü özellik" 🔴 duruyor. |
| Veri, **ultra hafif vektör karo akışı** ile günlük tazelenir | Bizim `routing-graph.bin` sürümsüz; tazeleme yolu yok. |

### 1.4 TomTom NavKit2 — modülerlik sözleşmesi

- "Online first, ama bağlantı düşerse onboard harita + yazılıma geçer."
- **Her navigasyon işlevi (harita çizimi, rota planlama) olabildiğince kendi kendine yeter;**
  müşteri yalnız ihtiyacı olan işlevi alır.

**Alınan karar:** CAROS navigasyon katmanları **birbirini import etmeyen**, yalnız sözleşme
(tip) paylaşan servislerdir. `FullMapView` bugün 2 215 satır ve hem çizim hem karar taşıyor —
bu, NavKit2'nin tam tersi. §16'da parçalanma haritası var.

### 1.5 Valhalla — onboard rota motorunun referans mimarisi

| Bulgu | Bizim için anlamı |
|-------|-------------------|
| Grafik **karolara** bölünür → düşük bellek, hızlı arama, **çevrimdışı çalışma** | `NavigationCompute.worker` bugün TÜM grafiği belleğe açıyor. Karolu okuma şart. |
| **Hiyerarşi** (otoyol / arter / yerel) + kısayol kenarları | Bugün hiyerarşi yok → uzun rota A* pratikte imkânsız. |
| **Dinamik maliyetlendirme:** maliyet grafiğe PİŞİRİLMEZ, çalışma anında özniteliklerden üretilir | **Bu, OEM üstü mimarinin anahtarı.** Maliyet fonksiyonu araç durumuna abone olabilir (§10). |
| Modül ayrımı: Baldr(veri) · Sif(maliyet) · Thor(yol) · Odin(talimat) · Meili(eşleme) · Loki(bağlama) | Bizim hedef modül ayrımımız birebir bu disiplini izler. |

### 1.6 OSRM — bugünkü çevrimiçi motorumuz

Kullanılan: `routing.openstreetmap.de`, `osrm.route.at`. `alternatives=3`, `bearings` (ters
şerit koruması), `intersections[].lanes` ve `maneuver.exit` artık **gerçekten ayrıştırılıyor**
(`routingService.ts:410-425`). Bu, 2026-08-03 denetimindeki iki ağır açığın kapandığını gösterir.
**Kalan yapısal sınır:** OSRM bize *bir rota* verir, *yol ağı* vermez → ufuk kurulamaz,
serbest sürüşte eşleme yapılamaz. Ufuk için cihazdaki grafik zorunludur.

### 1.7 Google Maps / DeepMind — ETA'nın mimarisi

- Yol ağı **Supersegment**lere bölünür (trafiği paylaşan komşu segment demetleri).
- ETA, **Graph Neural Network** ile tahmin edilir; bazı metropollerde doğruluk **%50'ye kadar**
  iyileşmiştir; üretimde MetaGradients ile kararlılaştırılmıştır.

**Dürüst sonuç:** Biz GNN eğitemeyiz (veri yok, bütçe yok, hedef donanım Mali-400).
**Alınan karar:** ETA'da rekabet **model karmaşıklığıyla değil, KAYNAK ÇEŞİTLİLİĞİYLE** kurulur:
rota süresi + gerçek trafik (HERE/TomTom BYOK — kodda VAR) + **sürücünün kendi geçmiş hız
profili** (bizde `smartMarkovEngine`/`vehicleLearningEngine` VAR, ETA'ya BAĞLI DEĞİL) +
durma tamponu. Ve her ETA **hangi kaynaklardan kurulduğunu taşır** (§11.3).

### 1.8 u-blox ADR — konumun mimarisi

- ADR = GNSS + IMU (3 eksen jiro + ivme) + **tekerlek tiki / araç hızı**.
- Tünel, kapalı otopark, kentsel kanyon: çok yollu (multipath) etkisini de bastırır.

**Bizim ayrıcalığımız:** ADR'nin en pahalı girdisi olan **gerçek araç hızı**, bizde OBD/CAN'den
BEDAVA gelir (`speedFusion.ts`, `speedSourcePolicy.ts`). Telefon navigasyonlarının hiçbirinde
bu yoktur. Bugün bu üstünlük kullanılmıyor: DR yalnız hız için kullanılıyor, **yön (heading)
için jiro entegrasyonu yok** → tünelde viraj varsa konum yanlış yöne gidiyor.

### 1.9 EU GSR / ISA — düzenleyici zemin (satış için bağlayıcı)

- Regülasyon (EU) 2019/2144: ISA, yeni tip onayları için 6 Temmuz 2022'den, **tüm yeni
  araçlar için 7 Temmuz 2024'ten** itibaren zorunlu.
- Her ISA sistemi bir **SLIF (Speed Limit Information Function)** içermek zorundadır.
- Kabul testi: **400 km gerçek yol** (şehir içi + şehirlerarası + otoyol), **en az %15 gece**;
  toplam mesafenin **≥ %90'ında** doğru limit, **her yol tipinde ≥ %80**.

**Alınan karar:** CAROS bir ISA sistemi DEĞİLDİR ve öyle sunulmaz — ama **hız limiti
katmanımızın kalite hedefi bu sayılardır** ve saha kütüğüne **ölçülebilir ISA-benzeri kabul
ölçütü** olarak girer (§17, F3). Bugün limit kaynağı Overpass'a canlı bağımlı; ölçümde 504
alınmış. Ufuk katmanı bunu cihaz-içi öznitelik katmanına taşır.

---

## 2. CAROS PRO'NUN BUGÜNKÜ GERÇEK MİMARİSİ (ölçülmüş)

### 2.1 Var olan omurga — DOĞRU kurulmuş kısım

```
Hedef (arama/POI/ev-iş/sesli/geo: URI)
        └─► navigationService.startNavigation()        [TEK giriş]
              └─► routingService.fetchRoute()          [TEK rota isteği]
                    └─► useRouteStore                  [TEK rota deposu]
                          ├─► MapLayerManager          (çizim)
                          ├─► navigationSessionRuntime (GÖRÜNÜMDEN BAĞIMSIZ tick)
                          │     ├─ updateRouteProgress()      (adım · sapma · reroute)
                          │     └─ updateNavigationProgress() (mesafe · ETA · varış)
                          └─► NavigationHUD            (manevra · ses tetikleyici)
gpsService ──► useGPSStore ──► UnifiedVehicleStore      [TEK konum otoritesi]
```

**Kanıtlanmış güçlü yanlar (mimariye AYNEN taşınır):**

| Güç | Kanıt |
|-----|-------|
| Paralel otorite yok (konum · rota · oturum · ETA tek) | `navigationService.ts` · `routingService.ts` · `gpsService.ts` |
| Tick sahipliği görünümden ayrık | `navigationSessionRuntime.ts` (kütük #377'nin kökü) |
| Zamanlayıcı tek tekerlekte | `runtimeManager.scheduleTask()` — Guardian kendi interval'ini KURMAZ |
| Saf çekirdek / kirli kenar ayrımı | `navigation/core/*.ts` — I/O yok · timer yok · `Date.now` yok · React yok |
| Dürüstlük etiketleri sözleşme seviyesinde | `distanceSource: ALONG_ROUTE\|STRAIGHT_LINE` · `ManeuverDistanceSource` · `SpeedLimitSource: osm\|inferred` · `MapMatchState/Reason` |
| Fail-closed güvenlik kapıları | `tripSummaryGate` · `__SAFETY_LOCK__` · `activateNavigation()` olmadan ARRIVED imkânsız |
| Kanıt defterleri | `routeProviderLedger` · `routeRequestLedger` · `etaJumpLedger` · `fixAgeLedger` · `routeProgressLedger` · `addressSearchLedger` |
| Gözlem yüzeyi | `NavigationCoreScreen` · `RouteLayerInspectorScreen` (CAROS LAB) |

**Bu liste küçümsenmemeli: birçok ticari navigasyon SDK'sında bu disiplinin YARISI yoktur.**
Sorun kalitede değil, **topolojidedir**.

### 2.2 Ölçülen envanter

| Varlık | Değer |
|--------|-------|
| `public/maps/routing-graph.bin` | **7 651 542 B** (v2 — oneway + roadClass) |
| `public/maps/poi.db` | **16 465 920 B** |
| Çevrimdışı **basemap karosu** | **YOK** — paket, canlı TileJSON sürüm damgasına bağlı (`vectorTileTemplate.ts`) |
| `navigationService.ts` / `routingService.ts` | 1 517 / 1 824 satır |
| `FullMapView.tsx` / `NavigationHUD.tsx` | **2 215 / 1 582 satır** |
| `gpsService.ts` | 1 204 satır |
| Guardian | 8 kural · 6 sağlayıcı · 8 adaptör · 1 Hz taban tick |
| Saha kütüğü | **801 🔴 / 217 🟢** |
| Trafik | HERE Flow v7 + TomTom Flow — **BYOK, anahtar yoksa `estimated`** |

---

## 3. YAPISAL TEŞHİS — 7 KÖK KUSUR

> Bunlar bug değildir. Hepsi tek tek düzeltilse bile mimari OEM altında kalır.

**K1 — ORTAK UFUK YOK (ana kök).**
"Önümde ne var?" sorusunun beş ayrı cevaplayıcısı var: `speedLimitService` (Overpass, canlı ağ),
`guardian/adapters/curveAdapter` (kendi hesabı), `roadProfileAdapter`, `enforcementPointsSource`,
`routingService.steps` (yalnız aktif rota). Hiçbiri diğerinin ne bildiğini bilmez; hepsi farklı
kadansta, farklı güvenle, farklı kaynaktan çalışır. **Tek kaynak yoksa "tutarlı ürün" yoktur.**

**K2 — YOL AĞI EŞLEMESİ YOK, YALNIZ ROTA EŞLEMESİ VAR.**
`mapMatchModel.ts` bunu dürüstçe yazıyor: rota koridoru dışında **"hangi yolda olduğumuzu
söyleyemeyiz"**. Sonuç: rota yokken (serbest sürüş) ürün yol hakkında HİÇBİR ŞEY bilemez →
hız limiti, viraj uyarısı, kamera uyarısı ya ağa bağımlıdır ya da yoktur.

**K3 — HARİTA VERİSİ MONOLİTİK VE SÜRÜMSÜZ.**
7.65 MB tek blob; karolu değil, hiyerarşisiz, kısmi güncellenemez, ADAS özniteliği (eğim,
viraj yarıçapı, limit, şerit sayısı) taşımıyor. Türkiye ölçeği ve tazeleme yolu kapalı.

**K4 — KONUM FÜZYONU EKSİK (yön boyutu yok).**
Hız füzyonu olgun (`speedFusion` · `speedSourcePolicy`), ama **jiro entegrasyonlu yön** yok.
Tünelde/kanyonda araç düz gitmiyorsa DR yanlış yöne yürür. Kütükte 🔴 olarak duruyor.

**K5 — GÖRÜNÜM KATMANI KARAR TAŞIYOR.**
`FullMapView` 2 215 satır, `NavigationHUD` 1 582 satır; sesli anons eşikleri hâlâ HUD'ın
içinde. Görünüm karar taşıdığı sürece "tam ekranı kapat = motoru dondur" sınıfı arıza
(kütük #377) **yapısal olarak geri gelebilir**.

**K6 — MALİYET SABİT, ARAÇ DURUMUNDAN HABERSİZ.**
Rota profili sabit `driving`. Ne yakıt/SoC, ne fren/soğutma sağlığı, ne yük, ne sürücü DNA'sı
rota maliyetine girer. **CAROS'un tek gerçek rekabet üstünlüğü tam olarak burada kullanılmıyor.**

**K7 — ÇEVRİMDIŞI ZİNCİR YARIM.**
Rota grafiği ✅ · POI ✅ · **basemap karosu ❌**. Uçak modunda rota hesaplanır ama harita boştur.
Üstelik karo paketi sağlayıcı sürüm damgasına bağlı olduğundan **paket sessizce ölebilir**
(`vectorTileTemplate.ts` bunu dürüstçe yazıyor).

---

## 4. HEDEF MİMARİ — "CAROS NAVIGATION CORE" (CNC)

### 4.1 Katman diyagramı

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  L7  GÖSTERİM — MapCore · MapLayerManager · HUD · Kamera Otoritesi           ║
║      (yalnız ÇİZER; karar taşımaz, veri toplamaz)                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  L6  ARBİTRAJ — Guardian · Ses · Bildirim · Dikkat kapısı                    ║
║      (ufuktan okur; sıralar, bütçeler, susturur)                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  L5  REHBERLİK — Manevra · Şerit · Kavşak · Ses metni · ETA                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  L4  ROTA — Hibrit yönlendirici (online ⇄ onboard) + DİNAMİK MALİYET         ║
║      ▲ maliyet fonksiyonu ARAÇ DURUMUNA abonedir  ◄── Vehicle Brain          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  L3  ★ CEH — CarOS Electronic Horizon  ★  (BU MİMARİNİN OMURGASI)           ║
║      MPP + alternatif kenarlar + öznitelik profilleri                        ║
║      + ARAÇ DURUMU PROJEKSİYONU (OEM'de YOK)                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  L2  EGO — Konum/Localization: GNSS ⊕ OBD hız ⊕ IMU ⊕ ağ-eşlemesi           ║
║      Çıktı: EgoPose {poz, kovaryans, güven, yaş, köken}                      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  L1  MAP STORE — karolu · katmanlı · sürümlü tek harita cephesi              ║
║      render │ graph │ adas │ poi │ enforcement │ dynamic(traffic)            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  L0  ÇEKİRDEK SÖZLEŞMELER — Provenance · Confidence · Freshness · Budget     ║
║      (her katman aynı dürüstlük tipini konuşur)                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
       ⇅ her katman KANIT yayar → CAROS LAB (salt-okunur gözlem)
```

### 4.2 Bağımlılık yasası (pazarlıksız)

1. **Aşağı doğru okunur, yukarı doğru YAYILIR.** L5 asla `gpsService`i import etmez; L2'nin
   yayınladığı `EgoPose`u okur. L6 asla Overpass çağırmaz; L3'ün ufkundan okur.
2. **Yan geçiş yasak.** Guardian adaptörleri artık kendi veri kaynaklarını çağırmaz.
3. **Görünüm yaprak katmandır.** L7 hiçbir şey hesaplamaz, hiçbir tick'e sahip olmaz.
4. **Tek tick tekerleği.** `runtimeManager.scheduleTask()` dışında zamanlayıcı yok.
5. **Saf çekirdek zorunlu.** Her katmanın kararı `**/core/*.ts` içinde SAF bir modelde
   yaşar (I/O · timer · `Date.now` · global durum · React YOK). Runtime yalnız bağlar.
6. **Kanıtsız değer yayınlanmaz.** `UNKNOWN` yayınlamak, tahmin yayınlamaktan üstündür.

### 4.3 Tek tick, tek akış (kadans sözleşmesi)

```
GPS fix (1–2 Hz, native)                    OBD hız (3 Hz)        IMU (20–50 Hz, ucuz)
      │                                            │                     │
      └───────────────┬────────────────────────────┴─────────────────────┘
                      ▼
              L2  EgoRuntime.onSample()      ← tek yazar; fix kadansında
                      ▼  EgoPose (immutable)
              L3  HorizonProvider.advance()  ← 1 Hz taban / 2 Hz sürüşte / 0.2 Hz durakta
                      ▼  HorizonSnapshot (immutable, revizyonlu)
        ┌─────────────┼──────────────┬───────────────┬──────────────┐
        ▼             ▼              ▼               ▼              ▼
  L4 reroute?    L5 manevra     L5 ETA        L6 Guardian     L6 ses tetiği
        │             │              │               │              │
        └─────────────┴──────────────┴───────────────┴──────────────┘
                      ▼
              L7 render (rAF, kendi bütçesinde)
```

**Yasa:** Ufuk tek yerde ilerletilir. Hiçbir tüketici ufku "kendi için yeniden hesaplamaz".
Ufuk revizyon numarası taşır; tüketiciler `revision` değişmedikçe yeniden hesaplamaz
(V8 monomorfizm + boş dönüş maliyeti sıfır).

---

## 5. L0 — ÇEKİRDEK SÖZLEŞMELER (her katmanın konuştuğu dil)

Bugün dürüstlük etiketleri var ama **her katman kendi etiketini icat ediyor**
(`distanceSource`, `SpeedLimitSource`, `MapMatchReason`, `sessionInspectorModel`).
Tek bir jenerik sözleşmeye indirgenir:

```ts
/** Bir değerin KANIT KİMLİĞİ. Navigasyon zincirindeki HER sayı bunu taşır. */
export interface Evidenced<T> {
  readonly value: T | null;
  /** OBSERVED = ölçüldü · DERIVED = kanıttan türetildi · UNAVAILABLE · STALE */
  readonly grade: 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE';
  /** Kaynağın kimliği — serbest metin YOK, sabit birlik. */
  readonly source: SignalSource;          // 'gnss' | 'obd' | 'can' | 'imu' | 'map' | 'osrm' | 'here' | 'tomtom' | 'overpass' | 'learned' | 'none'
  /** 0..1 — UNAVAILABLE/STALE'de ASLA > 0.3 */
  readonly confidence: number;
  /** Ölçümün yaşı (ms, monotonik). null = bilinmiyor → kötümser davran. */
  readonly ageMs: number | null;
  /** Sınırlı gerekçe kodu — LAB'da SAYILABİLİR olmalı. */
  readonly reason: EvidenceReason | null;
}
```

**Neden bu kadar önemli:** `sessionInspectorModel` sözleşmesi zaten `OBSERVED/DERIVED/
UNAVAILABLE/STALE` kullanıyor (CLAUDE.md bunu zorunlu kılıyor). Bu tip onu **gözlem
katmanından ÜRÜN katmanına** taşır: dürüstlük artık LAB'a özel bir süs değil, **veri
tipinin kendisidir**. `Evidenced<T>` taşımayan bir sayı L2 üstünde yayınlanamaz.

Yardımcı sözleşmeler:

```ts
/** Bütçe: her katman kendi tick'ini bu kapıdan alır. */
export interface LayerBudget {
  readonly hz: number;                 // izin verilen tick frekansı
  readonly maxCpuMsPerTick: number;    // aşılırsa katman KENDİNİ kısar (kapanmaz)
  readonly enabled: boolean;           // tier kararı — güvenlik-kritik katmanlar HER tier'da true
}

/** Bozulma seviyesi — ürünün DÜRÜST hâli (§13). */
export type NavDegradation =
  | 'FULL'            // her şey var
  | 'NO_TRAFFIC'      // trafik yok, ETA statik
  | 'NO_NETWORK'      // onboard grafik + onboard karo
  | 'NO_MAP_DATA'     // grafik/karo yok — rota YOK, yalnız pusula
  | 'NO_POSITION'     // fix yok, DR bitti — REHBERLİK DURDURULUR
  | 'SAFE_STOP';      // ürün rehberlik iddiasını GERİ ÇEKER
```

---

## 6. L1 — MAP STORE (karolu · katmanlı · sürümlü)

### 6.1 Sorun

Bugün altı ayrı harita gerçeği var ve hiçbiri diğerini tanımıyor:

| Bugünkü kaynak | Nerede | Sorun |
|----------------|--------|-------|
| Vektör basemap (OpenFreeMap vb.) | `vectorTileTemplate` → canlı TileJSON | Sürüm damgası değişince paket ölür |
| Raster yedek | `caros-tile://tile.openstreetmap.org` | **OSMF Tile Usage Policy → ticari satışta risk** |
| `routing-graph.bin` | tek blob | Karolu değil, hiyerarşisiz, ADAS özniteliği yok |
| `poi.db` | SQLite (16.5 MB) | Ayrı arama otoritesi |
| Hız limiti | Overpass (canlı ağ) | 504 ölçüldü; çevrimdışı çalışmaz |
| Denetim noktaları | `enforcementPointsPackage` | Ayrı paket, ayrı sürüm |

### 6.2 Hedef: tek cephe, altı katman, tek karo kimliği

```
MapStore  (tek cephe — tüketici sağlayıcıyı BİLMEZ)
 ├── render      : vektör .pbf karolar        (z0-14)   → L7
 ├── graph       : rota grafiği KAROLU        (z9 tile) → L3, L4
 ├── adas        : eğim · viraj yarıçapı · maxspeed · roadClass · şerit sayısı (z9) → L3
 ├── poi         : SQLite / karolu indeks               → arama, Guardian
 ├── enforcement : EGM EDS + sabit kamera noktaları     → L3, L6
 └── dynamic     : trafik akışı + olay (HERE/TomTom BYOK, TTL'li) → L3, L4, L5
```

**Sözleşme:**

```ts
export interface MapStore {
  /** Karo kimliği ile katman okuma — SENKRON önbellekten, ASYNC ağdan. */
  readTileSync<K extends MapLayerKind>(kind: K, z: number, x: number, y: number): LayerTile<K> | null;
  ensureTiles(kind: MapLayerKind, tiles: TileId[], priority: 0 | 1 | 2): Promise<void>;
  /** YOL ile okuma — NDS.Live Smart Layer'ın "path" sorgusunun karşılığı; CEH bunu kullanır. */
  readAlongPath<K extends MapLayerKind>(kind: K, path: LngLat[], aheadM: number): PathSlice<K>;
  /** Her katmanın BAĞIMSIZ sürümü — biri eskiyince diğerleri ölmez. */
  versions(): Readonly<Record<MapLayerKind, LayerVersion>>;
  coverage(kind: MapLayerKind, at: LngLat): 'PACKAGED' | 'CACHED' | 'ONLINE_ONLY' | 'NONE';
}
```

### 6.3 Kritik tasarım kararları

1. **Karo kimliği tek uzaydır (z/x/y).** Rota grafiği, ADAS öznitelikleri ve basemap **aynı
   karo ızgarasında** hizalanır. Böylece "İstanbul'u indir" tek işlemdir ve **kısmi indirme
   tutarlıdır** (harita var ama grafik yok ≠ sessiz arıza; `coverage()` bunu söyler).
2. **Grafik karolu + hiyerarşik olur** (Valhalla dersi): `z9` karoları, üç seviye
   (motorway/trunk · primary/secondary · residential/service) + kısayol kenarları.
   Uzun rota için üst seviye yeterlidir → bellek ve süre çöker.
3. **ADAS katmanı ayrı tazelenir.** `maxspeed` yılda birkaç kez değişir, basemap haftada bir.
   Ayrı sürüm = ayrı indirme = düşük bant genişliği (Mapbox'ın "ultra hafif akış" dersi).
4. **Sürüm damgası sorunu çözülür:** paketler `packVersion` ile mühürlenir, `MapStore`
   uyumsuzluğu **sessizce yutmaz** — `coverage()` `NONE` döner, ürün kullanıcıya söyler.
5. **Ticari lisans kapısı:** `render` katmanının varsayılan sağlayıcısı **OSMF karo sunucusu
   OLAMAZ**. Satış yapılandırmasında ya kendi karo sunucumuz ya da ticari sağlayıcı zorunludur.
   `MapStore` bu seçimi tek noktada tutar → satış öncesi tek satırlık denetim.

---

## 7. L2 — EGO (konum otoritesi, tek gerçek)

### 7.1 Çıktı sözleşmesi

```ts
export interface EgoPose {
  readonly lat: number; readonly lon: number;
  /** Konum belirsizliği elipsi — "accuracy" tek sayısı YETMEZ (boylamsal/enlemsel farklıdır). */
  readonly sigmaAlongM: number; readonly sigmaCrossM: number;
  readonly headingDeg: Evidenced<number>;
  readonly speedKmh:   Evidenced<number>;   // OBD > CAN > GNSS önceliği (mevcut speedSourcePolicy)
  readonly tsMonoMs:   number;
  /** Bu poz nasıl üretildi. */
  readonly mode: 'GNSS' | 'GNSS_DR' | 'DR_ONLY' | 'MAP_SNAPPED' | 'LAST_KNOWN' | 'NONE';
  readonly confidence: number;             // 0..1
  /** HAM fix ASLA kaybolmaz (mapMatchModel'in mevcut disiplini korunur). */
  readonly rawLat: number; readonly rawLon: number;
}
```

### 7.2 Füzyon zinciri (bugünkünün üstüne eklenecek)

```
GNSS fix ──► çöp-fix kapısı ──► jump guard ──► ┐
OBD/CAN hızı ─────────────────────────────────►├─► EKF-lite (5 durum: x,y,ψ,v,ω)
IMU jiro (ψ̇) + ivme ─────────────────────────►┘        │
                                                        ├─► GNSS yokken DR (yön DAHİL)
Yol ağı (L1.graph) ──► HMM eşleme ────────────────────►┘
                                                        ▼
                                                     EgoPose
```

**Bugüne göre üç ekleme:**

- **E1 — Jiro entegrasyonlu yön.** DR bugün yalnız hızı taşıyor. `ω` (dönüş hızı) cihaz
  jirosundan alınır, `ψ` entegre edilir → tünelde viraj varsa konum doğru yöne yürür.
  Bu, u-blox ADR'nin çekirdek fikri; **bizim maliyetimiz sıfırdır** (sensör zaten var,
  `SensorsHandlerT` zaten %9.3 CPU harcıyor — bu CPU'yu FAYDAYA çevirir).
- **E2 — Çöp-fix kapısı** (kütükte 🔴: doğruluk p95 **7 578 m**, yanal sapma **1 480 m**).
  `sigma > eşik` olan fix EKF'e **ölçüm** olarak girmez; yalnız zayıf düzeltme olur.
- **E3 — Ağ-seviyesi HMM eşleme** (Newson-Krumm / Valhalla-Meili dersi). Aday segmentler
  L1.graph'tan gelir; puan = yayılım olasılığı (dik mesafe) × geçiş olasılığı
  (yol-boyu mesafe / kuş uçuşu oranı). Bugünkü `mapMatchModel` üç kanıtı (dik mesafe · yön
  uyumu · ilerleme sürekliliği) zaten doğru seçmiş — **model korunur, aday havuzu rotadan
  YOL AĞINA genişletilir.** `OFF_NETWORK` durumu ancak grafik kapsamı yoksa üretilir.

### 7.3 "Hayalet hız" (kütük #362) — mimari çözüm

Park hâlindeki telefonda ardışık fix'ler 10-12 m atlıyor, düzlük oranı 0.089 ölçüldü.
Tek fix çiftinden bu 40 km/h sürüşten ayırt edilemez. **Ufuk mimarisi bunu bedavaya çözer:**
EKF, ölçümü OBD hızıyla birlikte değerlendirir (v ≈ 0 iken GNSS yer değiştirmesi gürültüdür),
ve harita eşlemesi düşük hızda **zorunlu olarak** aynı segmentte tutar. Yani hayalet hız
**ayrı bir filtreyle değil, füzyonun doğal sonucu olarak** ölür.

---

## 8. L3 — CEH: CarOS ELECTRONIC HORIZON ★

> **Bu mimarinin OEM'e yetiştiği yer §8.1-8.3'tür. OEM'i GEÇTİĞİ yer §8.4'tür.**

### 8.1 Ufkun tanımı

```ts
export interface HorizonSnapshot {
  readonly revision: number;             // monoton artan; değişmezse tüketici hesaplamaz
  readonly tsMonoMs: number;
  readonly ego: EgoPose;
  /** MPP — en olası yol. Rota VARSA rota; YOKSA serbest sürüş tahmini. */
  readonly mpp: HorizonPath;
  /** Sapma noktaları — MPP'den ayrılan kenarlar (kavşak sonrası olasılıklar). */
  readonly branches: readonly HorizonBranch[];
  /** Ufkun kapsamı ve NEDEN o kadar olduğu. */
  readonly aheadM: number;
  readonly coverage: 'PACKAGED' | 'CACHED' | 'ROUTE_ONLY' | 'NONE';
  readonly degradation: NavDegradation;
}

export interface HorizonPath {
  readonly points: readonly LngLat[];            // ego'dan ileri, yol-boyu sıralı
  /** Yol-boyu ofset (m) → öznitelik. Sürekli değil, DEĞİŞİM NOKTALARINDA örneklenir. */
  readonly profiles: {
    readonly speedLimit:   readonly ProfileEntry<number>[];      // Evidenced içerir
    readonly curvature:    readonly ProfileEntry<number>[];      // 1/R (m⁻¹)
    readonly slope:        readonly ProfileEntry<number>[];      // %
    readonly roadClass:    readonly ProfileEntry<RoadClass>[];
    readonly laneCount:    readonly ProfileEntry<number>[];
    readonly tunnel:       readonly ProfileEntry<boolean>[];
    readonly enforcement:  readonly ProfileEntry<EnforcementPoint>[];
    readonly traffic:      readonly ProfileEntry<TrafficLevel>[];
    readonly maneuver:     readonly ProfileEntry<ManeuverRef>[];  // rota varsa
  };
}
```

**Anahtar tasarım:** profiller **yol-boyu ofsetle (m)** indekslenir — kuş uçuşu ile değil.
Bugünkü `distanceSource: STRAIGHT_LINE` kusur sınıfı bu tasarımda **doğamaz**; ufkun tek
mesafe birimi yol-boyudur.

### 8.2 Ufuk nasıl üretilir

| Durum | MPP kaynağı | Ufuk uzunluğu |
|-------|-------------|---------------|
| Rehberlik aktif (ACTIVE/REROUTING) | Aktif rota geometrisi | `max(1500 m, hız × 90 s)` |
| Rota yok, **serbest sürüş** | L1.graph üstünde **en olası yol**: her kavşakta yol sınıfı + açı sürekliliği + öğrenilmiş sürücü tercihi | `max(800 m, hız × 45 s)` |
| Grafik kapsamı yok, rota var | Yalnız rota (`coverage: ROUTE_ONLY`) | rota kadarı |
| Grafik yok, rota yok | Ufuk **YOK** (`coverage: NONE`) — sahte ufuk üretilmez | 0 |

**Serbest sürüş ufku (free-drive) tek başına ürünün karakterini değiştirir:** kullanıcı hiç
rota başlatmadan da hız limiti, viraj uyarısı, kamera uyarısı, tünel ön-bildirimi ve yakıt
tahmini alır. Bu, bugün **hiç yapılamayan** şeydir ve Mapbox/TomTom'un ayırt edici özelliğidir.

### 8.3 Tüketiciler (hepsi kendi veri toplamayı BIRAKIR)

| Tüketici | Bugün nereden okuyor | CEH sonrası |
|----------|----------------------|-------------|
| `speedLimitAdapter` (Guardian) | Overpass canlı sorgu | `horizon.mpp.profiles.speedLimit[0]` |
| `curveAdapter` | kendi geometri hesabı | `profiles.curvature` |
| `roadProfileAdapter` | kendi hesabı | `profiles.slope` + `roadClass` |
| `speedCameraAdapter` | `enforcementPointsSource` | `profiles.enforcement` |
| `NavigationHUD` şerit rehberi | `steps[].lanes` (yalnız rota) | `profiles.laneCount` + `maneuver` |
| ETA (`etaModel`) | rota süresi + durma | + `profiles.traffic` + öğrenilmiş hız |
| Tünel gece modu (`tunnelNightRuntime`) | ayrı tespit | `profiles.tunnel` (ÖNCEDEN bilir) |
| Sesli rehberlik | HUD içi mesafe eşikleri | yol-boyu ofset + hız → **zaman tabanlı** tetik |

**Bu tablonun anlamı:** sekiz ayrı veri toplama yolu ölür, yerine bir tane gelir.
CPU düşer, tutarsızlık **yapısal olarak** imkânsızlaşır, ve gözlem tek ekrana sığar.

### 8.4 ★ OEM ÜSTÜ: ARAÇ DURUMU PROJEKSİYONU (VehicleHorizon)

ADASIS ufku **haritayı** taşır. CAROS ufku **haritayı ARACIN ÜSTÜNDEN GEÇİREREK** taşır:

```ts
/** OEM'de KARŞILIĞI YOK: ufkun her noktasında BU aracın öngörülen durumu. */
export interface VehicleProjection {
  readonly atOffsetM: number;
  readonly coolantC:     Evidenced<number>;   // rampada soğutma yükü
  readonly brakeLoad:    Evidenced<number>;   // uzun inişte fren termal yükü (0..1)
  readonly fuelOrSocPct: Evidenced<number>;   // tüketim modeli × eğim × hız profili
  readonly rangeRiskAt:  Evidenced<number | null>; // menzilin biteceği ofset (m) veya null
  readonly loadFactor:   Evidenced<number>;   // motor yük öngörüsü
}
```

Üretim zinciri (hepsinin parçaları **bugün repoda VAR**, bağlanmamış):

```
CEH profiles (eğim · viraj · limit · trafik)
        ×
UnifiedVehicleStore (canlı: soğutma suyu · motor yükü · yakıt · RPM · hız)
        ×
vehicleLearningEngine / manufacturerIntelligenceEngine (bu ARACIN öğrenilmiş davranışı)
        ×
driverDNA / smartMarkovEngine (bu SÜRÜCÜnün hız profili)
        ▼
VehicleProjection[]  →  Guardian (uyarı) · L4 (maliyet) · Mavi (açıklama) · HUD
```

**Somut, ölçülebilir ürün farkı (OEM'in yapamadığı üç şey):**

1. **"3.2 km sonra %8 rampa var; mevcut soğutma suyu 96 °C ve tırmanışta 108 °C'yi bulur —
   klimayı kısmanı öneririm."** OEM navigasyonu rampayı bilir, soğutma suyunu bilmez
   (nav ile powertrain aynı ECU'da değildir ve nav'a bu sinyal verilmez).
2. **"Bu inişte 6 km boyunca fren kullanacaksın; 3. viteste in."** Ufuk × fren termal modeli.
3. **"Seçtiğin rota 4 dk kısa ama 340 m tırmanış içeriyor; yakıtın buna yetmiyor.
   Alternatif rota 4 dk uzun, yakıt yeterli."** — §10'un maliyet fonksiyonu.

Bunların hiçbiri "AI" değildir; hepsi **ufuk × canlı telemetri** çarpımıdır ve
CAROS bu iki şeye **aynı anda** sahip olan nadir mimarilerden biridir.

---

## 9. L4 — ROTA (hibrit + dinamik maliyet)

### 9.1 Sağlayıcı merdiveni (mevcut yapı korunur, sağlamlaştırılır)

| # | Katman | Durum | Karar |
|---|--------|-------|-------|
| L0 | Yerel OSRM daemon (`localhost:5000`) | Android tarafında YOK | **KALDIR** (yoklama `routeProviderReadiness` ile zaten kapılı; ölü yol tamamen çıkar) |
| L1/L2 | Uzak OSRM | Çalışıyor | **KORU** — birincil çevrimiçi |
| L3 | Onboard yönlendirici (worker) | Grafik VAR, motor A*, hiyerarşisiz | **YENİDEN KUR:** karolu + hiyerarşik + dinamik maliyet |
| L4 | Düz hat | Dürüst etiketli | **KORU** ama `NO_MAP_DATA` bozulma seviyesiyle sunulur |

**Yeni yasa:** onboard yönlendirici artık "son çare" değildir. **Çevrimdışı çalışabilen
her senaryoda ÖNCE onboard denenir, çevrimiçi yalnız trafik/güncellik için üstüne biner**
(TomTom NavKit2'nin tersi bir tercih — nedeni: bizim hedef donanımımızda ağ güvenilmezdir
ve 3 sn'lik bir zaman aşımı bile sürücü için "bozuk ürün"dür). Çevrimiçi sonuç geldiğinde
rota **sessizce değiştirilmez**; `routeProviderLedger`e yazılır ve yalnız daha iyi ise
kullanıcıya "daha hızlı rota var" olarak **teklif edilir**.

### 9.2 ★ Dinamik maliyet — Sif'in CAROS sürümü

```ts
export interface CostContext {
  readonly profile: 'car' | 'van' | 'truck' | 'ev' | 'lpg';
  readonly avoid: { toll: boolean; highway: boolean; ferry: boolean; unpaved: boolean };
  /** ★ araç durumu — OEM maliyet fonksiyonlarında YOKTUR */
  readonly vehicle: {
    readonly fuelOrSocPct: Evidenced<number>;
    readonly rangeKm:      Evidenced<number>;
    readonly thermalRisk:  Evidenced<number>;   // 0..1 — soğutma/yağ/fren
    readonly healthFlags:  readonly VehicleHealthFlag[];  // 'BRAKE_WEAR' | 'COOLANT_LOW' | ...
    readonly loadKg:       Evidenced<number>;
  };
  /** ★ sürücü — öğrenilmiş, uydurulmamış */
  readonly driver: { readonly aggressiveness: Evidenced<number>; readonly prefersHighway: Evidenced<boolean> };
  readonly traffic: TrafficSlice | null;
}

export type EdgeCostFn = (edge: GraphEdge, ctx: CostContext) => number;
```

**Maliyete giren gerçek kurallar (her biri kapatılabilir ve gözlemlenebilir):**

| Kural | Girdi | Etki |
|-------|-------|------|
| Termal riskli araç uzun rampadan kaçınır | `thermalRisk > 0.6` + `slope > 6%` | kenar maliyeti × (1 + 2·risk) |
| Fren aşınması uzun inişten kaçınır | `BRAKE_WEAR` + `slope < -6%` uzunluk | × (1 + 1.5) |
| Menzil yetmiyorsa yakıt/şarj duraklı rota | `rangeKm < kalanMesafe` | zorunlu ara durak ekleme |
| Sürücü DNA'sı | `prefersHighway` | motorway maliyeti × 0.9 |
| Trafik | `dynamic` katmanı | kenar süresi gerçek akıştan |
| Bilinmeyen araç (öğrenme yok) | tüm `Evidenced.grade = UNAVAILABLE` | **kural DEVREYE GİRMEZ** — sabit maliyete düşer |

**Son satır kritik:** kanıt yoksa akıllılık DEVREYE GİRMEZ. Bu, "zero-trust telemetry"
ilkesinin maliyet fonksiyonundaki karşılığıdır ve mimariyi güvenli kılan şeydir.

### 9.3 Yeniden rota (reroute) — mevcut disiplin + ufuk

Bugünkü histerezis, hıza bağlı throttle (5/10/15 sn) ve doğruluk payı **korunur**.
Eklenen: reroute kararı artık `MapMatchState` **ve** `HorizonSnapshot.coverage` okur —
grafik kapsamı yokken `OFF_NETWORK` reroute tetiklemez (bugünkü en sinsi yanlış-pozitif kaynağı).

---

## 10. L5 — REHBERLİK

### 10.1 Manevra

- Mesafe **her zaman** yol-boyu (`ALONG_ROUTE`). `STRAIGHT_LINE` yalnız `UNKNOWN` yerine
  geçici olarak ve **görsel olarak farklı** sunulur (bugünkü `ManeuverDistanceSource`
  sözleşmesi korunur, ama ufuk sonrası `STRAIGHT_LINE` üretilmesi bir HATA olarak sayılır).
- Dönel kavşak çıkışı: `maneuver.exit` (VAR, bağlı).
- İkinci manevra yığını (50 m eşiği) korunur.

### 10.2 Şerit ve kavşak

- Şerit rehberi **yalnız** `intersections[].lanes` gerçek verisi varsa çizilir (bugünkü doğru
  karar). Ufuk sonrası ikinci kaynak eklenir: `adas.laneCount` — ama **"kaç şerit var"**
  bilgisi **"hangi şeritte olmalıyım"** yerine geçmez; ikisi ayrı gösterilir.
- Kavşak görünümü (junction view) Faz 5'e ertelenir; sahte 3D kavşak **üretilmez**.

### 10.3 ETA — çok kaynaklı ve kaynağını taşıyan

```ts
export interface EtaVerdict {
  readonly etaSeconds: Evidenced<number>;
  readonly parts: {
    readonly routeBaseS:    number;             // motor süresi
    readonly trafficDeltaS: Evidenced<number>;  // HERE/TomTom
    readonly learnedDeltaS: Evidenced<number>;  // bu sürücünün bu yol sınıfındaki hız profili
    readonly stopBufferS:   number;             // gözlenen durmalar
  };
  readonly state: 'FIRM' | 'SOFT' | 'UNKNOWN';
}
```

Bugünkü `etaJumpLedger` + histerezis + hız kapısı rampası **korunur** (kütük #530/#538'in
kökleri). Yeni olan: ETA'nın **hangi parçalardan** kurulduğunun taşınması → LAB'da
"ETA neden atladı?" sorusu **cevaplanabilir** hâle gelir.

### 10.4 Ses — zaman tabanlı, mesafe tabanlı değil

Bugün eşikler 600 m / 250 m / hıza bağlı son uyarı. Ufuk sonrası doğru form:
**"manevraya kalan SÜRE"** (t = yol-boyu mesafe / öngörülen hız), çünkü 600 m otoyolda
20 sn, şehirde 60 sn'dir. Kademeler: `T-60s` · `T-25s` · `T-8s`, hız düşükken mesafe tabanına
düşer. Tekrar koruması (adım başına bitmask) ve `__SAFETY_LOCK__` korunur.
**Sesin sahibi HUD değil, `voiceGuidanceRuntime`dır** (K5 kökünün kapanışı).

---

## 11. L6 — ARBİTRAJ (Guardian + dikkat bütçesi)

Guardian'ın saf motoru, dedupe/fail-closed severity kuralı ve tick politikası **doğru
tasarlanmış** — korunur. Değişen tek şey **girdi**: adaptörler artık kendi kaynaklarını
çağırmaz, `HorizonSnapshot` okur.

Eklenen yapı — **dikkat bütçesi (attention budget)**:

```ts
/** Sürücüye dakikada kaç kesinti düşebilir — OEM HMI disiplininin karşılığı. */
export interface AttentionBudget {
  readonly maxInterruptsPerMin: number;   // CRITICAL hariç
  readonly minGapMs: number;              // iki uyarı arası asgari boşluk
  readonly suppressWhileManeuvering: boolean;  // manevraya T-8s içinde kritik olmayan susar
}
```

**Neden mimaride:** bugün Guardian, sesli rehberlik, Mavi ve bildirim servisi **aynı sürücünün
aynı saniyesi için** yarışıyor ve tek hakem `__SAFETY_LOCK__`. Bütçe, hakemi **sayılabilir**
yapar ve LAB'da ölçülür ("son 10 dakikada 14 kesinti" gibi bir gerçek görünür hâle gelir).

---

## 12. L7 — GÖSTERİM

Kural tek: **hesap yok, abonelik sahipliği yok, karar yok.**

- `FullMapView` (2 215 satır) parçalanır: kamera → `cameraFollowAuthority` (VAR),
  rota çizimi → `useRouteDrawingLifecycle` (VAR), stil → `useMapStyleLifecycle` (VAR),
  geri kalan karar mantığı L2-L5'e taşınır. Hedef: **< 600 satır saf görünüm.**
- `NavigationHUD` (1 582 satır) → `hudPresentationModel` (VAR, saf) + ince görünüm.
  Ses tetikleyicisi HUD'dan **tamamen** çıkar.
- Kamera, gece/tünel, declutter, rota rengi/genişliği modelleri zaten saf ve doğru — korunur.

---

## 13. BOZULMA MATRİSİ (fail-soft sözleşmesi — ürünün DÜRÜSTLÜK ANAYASASI)

| Kayıp | Seviye | Çalışmaya devam eden | SUSAN / geri çekilen iddia | Kullanıcıya söylenen |
|-------|:------:|----------------------|-----------------------------|----------------------|
| Trafik API'si yok/anahtarsız | `NO_TRAFFIC` | Rota, ETA (statik), rehberlik | "gerçek zamanlı trafik" iddiası | ETA rozeti: *tahmini* |
| İnternet yok, paket VAR | `NO_NETWORK` | **Tam navigasyon** (onboard grafik + karo + ADAS) | Trafik, canlı arama | "çevrimdışı harita kullanılıyor" |
| İnternet yok, paket YOK | `NO_MAP_DATA` | Pusula + kayıtlı POI | **Rota, manevra, hız limiti** | "bu bölge için harita paketi yok" |
| GNSS yok, OBD hız VAR | `FULL` (DR) | Rehberlik (DR ile, ≤ 90 sn) | — | Konum rozeti: *ölü hesap* |
| GNSS yok, OBD hız YOK | `NO_POSITION` | Harita gösterimi | **Rehberlik DURUR** | "konum yok — rehberlik durduruldu" |
| Grafik kapsamı dışına çıkıldı | `ROUTE_ONLY` ufuk | Rota rehberliği | Serbest sürüş uyarıları, hız limiti | Sessiz (iddia zaten yoktu) |
| Ufuk üretilemedi | `coverage: NONE` | Rota varsa rehberlik | **Tüm ufuk-türevli uyarılar** | Guardian LAB'da `UNAVAILABLE` |

**Yasa:** her satırda "SUSAN iddia" sütunu **doldurulmuş olmak zorundadır.** Bir bozulma
seviyesi tanımlanırken neyin susacağı yazılmıyorsa, o seviye mimariye kabul edilmez.

---

## 14. PERFORMANS BÜTÇESİ (tier × katman)

Hedef donanım gerçeği: Mali-400 sınıfı head unit; ölçülmüş taban CPU %41 (park, nav aktif).

| Katman | HIGH | BALANCED | BASIC_JS | SAFE_MODE | Güvenlik-kritik mi |
|--------|:----:|:--------:|:--------:|:---------:|:------------------:|
| L2 Ego füzyon | fix kadansı | fix kadansı | fix kadansı | fix kadansı | **EVET — hiç kapanmaz** |
| L3 CEH ilerletme | 2 Hz | 1 Hz | 0.5 Hz | 0.2 Hz | **EVET** |
| L3 VehicleProjection | 1 Hz | 0.5 Hz | 0.2 Hz | **kapalı** | hayır |
| L4 onboard rota | tam hiyerarşi | tam | üst 2 seviye | üst seviye | hayır |
| L5 rehberlik | fix kadansı | fix kadansı | fix kadansı | fix kadansı | **EVET** |
| L6 Guardian | 2 Hz | 1 Hz | 1 Hz | 1 Hz | **EVET** |
| L6 dikkat bütçesi | tam | tam | tam | tam | **EVET** |
| L7 render | 60 fps | 30 fps | 30 fps | 20 fps | hayır |
| L7 3B/animasyon | tam | kısıtlı | kapalı | kapalı | hayır |

**CLAUDE.md hibrit kuralının birebir uygulanışı:** feda edilen zekâ değil, GÖSTERİMDİR.
`SAFE_MODE`'da bile hız limiti, viraj uyarısı, manevra ve ses ÇALIŞIR.

**Ufkun kendi maliyeti:** ufuk **artımlıdır** — her tick'te baştan kurulmaz; ego ilerledikçe
arkadan kırpılır, önden `ensureTiles` ile beslenir. Zero-allocation: `HorizonSnapshot`
önceden ayrılmış iki tampon arasında değiştirilir (çift tamponlama), profiller
`Float64Array`/`Int32Array` üstünde tutulur (V8 hidden class kararlılığı, GC baskısı yok).

---

## 15. GÖZLEMLENEBİLİRLİK (CAROS LAB — zorunlu, CLAUDE.md §Gözlemlenebilirlik)

| Yeni LAB ekranı | Gösterdiği (yalnız gerçek veri) |
|-----------------|--------------------------------|
| **Horizon Inspector** | `revision`, `aheadM`, `coverage`, MPP nokta sayısı, her profilin girdi sayısı + `grade` dağılımı, üretim süresi (ms) |
| **Ego / Localization** | `mode`, `sigmaAlong/Cross`, füzyon kaynakları, DR süresi, reddedilen fix sayısı + gerekçe kodu dağılımı |
| **Map Store** | katman × sürüm × kapsam (`PACKAGED/CACHED/ONLINE_ONLY/NONE`), karo isabet oranı, paket sürüm uyuşmazlığı sayacı |
| **Cost Inspector** | son rota isteğinde hangi maliyet kuralının devreye girdiği/girmediği + gerekçe (`UNAVAILABLE` ise NEDEN) |
| **Attention Budget** | son 10 dk kesinti sayısı, kaynak dağılımı (Guardian/ses/Mavi/bildirim), bastırılan uyarı sayısı |

Mevcut `NavigationCoreScreen` ve `RouteLayerInspectorScreen` korunur.
**Gizlilik kapısı:** LAB'a hedef adresi, VIN, ham koordinat **taşınmaz** — yalnız VAR/YOK,
ADET, sınıf ve gerekçe kodu (CLAUDE.md §6).

---

## 16. MODÜL HARİTASI — MEVCUT → HEDEF

### 16.1 Korunacak (mimariye doğrudan taşınır)

`navigationSessionRuntime` · `navigation/core/*` (23 saf model) · `guardian/*` (motor · ranker ·
tick politikası) · `routeProviderLedger` · `routeRequestLedger` · `etaJumpLedger` ·
`fixAgeLedger` · `speedFusion` · `speedSourcePolicy` · `UnifiedVehicleStore` ·
`AdaptiveRuntimeManager` · `MapCore` · `MapLayerManager` · `map/core/*` · `cameraFollowAuthority` ·
`CorridorSyncEngine` (ufkun ön-getirme motoru olur — mükemmel uyum).

### 16.2 Yeni (mimarinin eksik omurgası)

| Yeni modül | Sorumluluk | Saf mı |
|------------|------------|:------:|
| `platform/map/store/MapStore.ts` | Katmanlı karo cephesi | hayır (I/O) |
| `platform/map/store/tileGrid.ts` | Karo kimliği matematiği | **evet** |
| `platform/navigation/ego/egoFusionModel.ts` | EKF-lite (5 durum) | **evet** |
| `platform/navigation/ego/egoRuntime.ts` | Sensör bağlama + yayın | hayır |
| `platform/navigation/horizon/horizonModel.ts` | Ufuk kurma/ilerletme (saf) | **evet** |
| `platform/navigation/horizon/horizonProvider.ts` | MapStore + Ego bağlama, tick | hayır |
| `platform/navigation/horizon/mppModel.ts` | Serbest sürüşte en olası yol | **evet** |
| `platform/navigation/horizon/vehicleProjectionModel.ts` | ★ araç durumu projeksiyonu | **evet** |
| `platform/navigation/routing/costModel.ts` | ★ dinamik maliyet | **evet** |
| `platform/navigation/routing/onboardRouter.worker.ts` | Karolu hiyerarşik A*/CH | — |
| `platform/navigation/matching/hmmMatchModel.ts` | Ağ seviyesi eşleme | **evet** |
| `platform/navigation/attention/attentionBudgetModel.ts` | Dikkat bütçesi | **evet** |
| `scripts/build-map-pack.mjs` | Karolu graph + ADAS + POI paketi üretimi | — |

### 16.3 Kaldırılacak / dönüştürülecek

| Yapı | Karar |
|------|-------|
| `offlineRoutingService.tryLocalDaemon()` (L0) | **KALDIR** — Android tarafında daemon yok |
| `speedLimitService` canlı Overpass yolu | **DÖNÜŞTÜR** — ufkun `speedLimit` profiline; Overpass yalnız paket üretim zamanı |
| Guardian adaptörlerinin kendi veri çekimi | **DÖNÜŞTÜR** — ufuk okuru |
| `NavigationHUD` içindeki ses eşikleri | **TAŞI** → `voiceGuidanceRuntime` |
| `FullMapView` karar mantığı | **TAŞI** → L2-L5 |
| `routing-graph.bin` monolit | **DÖNÜŞTÜR** → karolu paket (geriye uyum bir sürüm boyunca) |
| Raster `tile.openstreetmap.org` varsayılanı | **DEĞİŞTİR** — ticari satış öncesi zorunlu (lisans) |

---

## 17. FAZ PLANI VE ÖLÇÜLEBİLİR KABUL ÖLÇÜTLERİ

> Her fazın kabulü **gerçek araçta ölçülür** ve `docs/DEVICE_VALIDATION_LEDGER.md`e
> önce 🔴 olarak girer. Test yeşilliği kabul DEĞİLDİR.

### F1 — SÖZLEŞME VE OMURGA (kod riski düşük, kazanç yapısal)
- `Evidenced<T>` çekirdek tipi + `NavDegradation` + bozulma matrisinin kod karşılığı.
- `MapStore` cephesi (mevcut kaynakları SARAR; yeni veri üretmez).
- **Kabul:** LAB'da her navigasyon sayısı `grade` + `source` + `ageMs` gösterir;
  hiçbir yüzeyde `grade` taşımayan sayı kalmaz (kilit test).

### F2 — EGO (konumun OEM'e yetişmesi)
- EKF-lite, jiro entegrasyonlu yön, çöp-fix kapısı, HMM eşleme (rota + ağ).
- **Kabul (gerçek araçta):** (1) **≥ 600 m tünelde** çıkışta yanal hata **< 25 m**;
  (2) park hâlinde 10 dk boyunca bildirilen hız **0 km/h** kalır (hayalet hız ölür);
  (3) bölünmüş bulvarda 30 dk sürüşte ters şeride eşleme **0 kez**.

### F3 — CEH (ufuk — mimarinin kalbi)
- Karolu graph + ADAS öznitelik katmanı üretimi (`build-map-pack.mjs`).
- `horizonProvider` + tüm Guardian adaptörlerinin ufka taşınması.
- Serbest sürüş (free-drive) ufku.
- **Kabul:** (1) **400 km karışık yol** (≥ %15 gece) sürüşünde hız limiti doğruluğu
  toplamda **≥ %90**, her yol tipinde **≥ %80** (ISA kabul testinin ölçütü);
  (2) rota YOKKEN viraj/kamera/limit uyarıları çalışır ve LAB'da `OBSERVED` gösterir;
  (3) uçak modunda ufuk `coverage: PACKAGED` kalır.

### F4 — ROTA (onboard motorun gerçekten ürün olması)
- Karolu hiyerarşik yönlendirici + dinamik maliyet + araç durumu kuralları.
- **Kabul:** (1) uçak modunda **50 km'lik** şehirlerarası rota **< 3 sn**'de hesaplanır;
  (2) `thermalRisk` yüksek simüle edildiğinde seçilen rota rampa toplamını **ölçülebilir
  şekilde** düşürür ve Cost Inspector hangi kuralın devreye girdiğini gösterir;
  (3) kanıt yokken (bilinmeyen araç) maliyet kuralları **devreye girmez** (kilit test).

### F5 — REHBERLİK + ARBİTRAJ + GÖSTERİM
- Zaman tabanlı ses, şerit/kavşak, dikkat bütçesi, `FullMapView`/`NavigationHUD` parçalanması.
- **Kabul:** (1) 30 dk şehir içi sürüşte kritik olmayan kesinti **≤ 3/dk**;
  (2) tam ekran kapalıyken tüm rehberlik (ses dâhil) **kesintisiz** sürer;
  (3) `SAFE_MODE`'da hız limiti + manevra + ses **çalışır**, 3B/animasyon kapalıdır.

---

## 18. RİSKLER VE AÇIK KARARLAR

| Risk | Etki | Azaltma |
|------|------|---------|
| **Harita karosu ticari lisansı** | Satış engeli (OSMF policy) | `MapStore.render` sağlayıcısı tek noktada; satış yapılandırmasında kendi sunucu/ticari sağlayıcı zorunlu |
| ADAS öznitelik verisi (eğim) OSM'de yok | Eğim profili boş kalabilir | SRTM/Copernicus DEM'den paket üretim zamanı türet (lisans permissive) → `grade: DERIVED` |
| Paket boyutu | Cihaz depolaması | Karolu + hiyerarşik: yalnız gerekli bölge + üst seviye; ölçülecek hedef **Türkiye < 900 MB** |
| Onboard motor CPU'su | Düşük uçta rota gecikmesi | Hiyerarşi + worker + tier bütçesi; kabul ölçütü F4/1 |
| `Evidenced<T>` migrasyonu geniş | Regresyon | Faz F1'de yalnız SARMALAMA; davranış değişmez, kilit testleri korunur |
| 801 🔴 saha borcu | Doğrulanmamış temel | F2/F3 kabulleri kütükteki nav maddelerinin bir kısmını topluca kapatacak şekilde yazıldı |

**Açık kararlar (kullanıcı onayı gerekir, mimari bunlara bağlı DEĞİL):**
1. Karo sağlayıcısı: kendi sunucumuz mu, ticari sağlayıcı mı (maliyet kararı).
2. Trafik: BYOK mu, ürün içi anahtar mı (BYOK CLAUDE.md gereği varsayılan).
3. EV profili Faz 4'te mi, sonra mı (hedef pazar kararı).

---

## 19. KAYNAKÇA

- Navigation Data Standard (NDS) — https://nds-association.org/ · https://en.wikipedia.org/wiki/Navigation_Data_Standard
- ADASIS Forum beyaz belgesi — https://adasis.org/wp-content/uploads/sites/10/2024/06/ADASIS-White-paper-Master-Final.pdf
- dSPACE ADASIS v3 Horizon Reconstructor — https://www.dspace.com/en/ltd/home/products/sw/impsw/adasis_v3_hr_blockset.cfm
- Elektrobit EB robinos Predictor (electronic horizon) — https://www.elektrobit.com/products/automated-driving/eb-robinos/predictor/
- Mapbox Electronic Horizon — https://docs.mapbox.com/android/navigation/v2/guides/advanced/electronic-horizon/
- Mapbox Navigation SDK for Automotive — https://www.mapbox.com/automotive
- TomTom NavKit2 — https://www.tomtom.com/newsroom/product-focus/cloud-native-navigation-navkit/
- Valhalla mimarisi ve dinamik maliyet — https://valhalla.github.io/valhalla/ · https://valhalla.github.io/valhalla/sif/dynamic-costing/
- ETA Prediction with Graph Neural Networks in Google Maps — https://arxiv.org/abs/2108.11482
- DeepMind trafik tahmini — https://deepmind.google/blog/traffic-prediction-with-advanced-graph-neural-networks/
- u-blox Automotive Dead Reckoning — https://www.u-blox.com/en/technologies/automotive-dead-reckoning-technology
- Regulation (EU) 2019/2144 (GSR) — https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=PI_COM%3AAres%282021%292243084
- Mapbox — EU ISA gereksinimleri — https://www.mapbox.com/blog/new-eu-intelligent-speed-assistance-requirements
- HERE — ISA 2024 — https://www.here.com/learn/blog/intelligent-speed-assistance-2024

**İç kaynaklar:** `docs/NAVIGATION_REALITY_AUDIT_AND_OEM_GAP_ANALYSIS.md` (2026-08-03) ·
`docs/NAVIGATION_P0_CORE_OEM_GAP_ANALYSIS.md` · `docs/ADR_OFFLINE_ROUTING.md` ·
`docs/DEVICE_VALIDATION_LEDGER.md` · `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md`

---

## 20. TEK PARAGRAFLIK KARAR

CAROS PRO'nun navigasyonu bugün **iyi disiplinli ama omurgasız**dır. OEM'e yetişmenin yolu
daha çok özellik değil, **tek bir katmanın inşasıdır: CEH — CarOS Electronic Horizon.**
Ufuk kurulduğunda beş ayrı veri toplama yolu ölür, tutarsızlık yapısal olarak imkânsızlaşır,
serbest sürüş zekâsı doğar ve çevrimdışı navigasyon gerçek olur. OEM'i GEÇMENİN yolu ise
ufkun içeriğidir: **OEM ufku haritayı taşır, CAROS ufku haritayı BU ARACIN ÜSTÜNDEN GEÇİREREK
taşır.** Rampayı bilmek OEM'dir; o rampada bu aracın ne yaşayacağını bilmek CAROS'tur.
Bu belge, o farkın mimari karşılığıdır; §17'deki beş fazın her biri gerçek araçta
ölçülmeden hiçbir seviye yükseltilmez.
