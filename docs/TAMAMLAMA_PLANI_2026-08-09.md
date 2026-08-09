# Tamamlama Planı — Guardian AI · Trip Cost · 2026-08-09

> **Silme kararları İPTAL.** Guardian AI (32 dosya / 3 966 satır) ve Trip Cost
> (12 dosya / 2 111 satır) **tamamlanacak**. `SPEED_CAMERA_WARNING` kuralı da
> kalır — ama **veri gelmez**: boş yuva olarak tasarlanır.
>
> Bu belge **plan**dır; kod içermez ve hiçbir şeyin "bitti" olduğunu iddia etmez.
> Durum otoritesi `docs/DEVICE_VALIDATION_LEDGER.md`, vizyon otoritesi
> `docs/CAROS_PRO_VIZYONU.md`.

---

## 0. Bağlayıcı sıra kuralı

**Bir seferde BİR yarım iş tamamlanır ve gerçek araçta kanıtlanmadan sıradakine
geçilmez.** Bu projenin 384 kırmızı kütük satırı, paralel başlatmaktan doğdu:
her biri tek başına doğru yazılmış, hiçbiri sonuna kadar götürülmemiş.

**Öncelik sırası:**

```
#491 (ağsız hüküm)  →  GPS / G1  →  Trip Cost  →  Guardian AI
```

**Gerekçe:**
- **#491 önce** çünkü ADR-286 karar omurgasının çevrimdışı çalıştığı henüz
  cihazda gösterilmedi; omurga kanıtlanmadan üstüne yeni karar üreten katman
  eklemek, kanıtlanmamışın üstüne kanıtlanmamış yığmaktır.
- **GPS (G1) ikinci** çünkü Guardian'ın konum tabanlı kurallarının yarısı
  (viraj · yokuş · yol tehlikesi) GPS düzelmeden **matematiksel olarak**
  bitirilemez — p50 19,5 s bayat fix, 94 km/h'de ~509 m konum körlüğü demektir;
  "300 m sonra viraj" cümlesi bu körlükte yalandır.
- **Trip Cost üçüncü** çünkü filo müşterisine satılacak **ilk somut şey** odur:
  araç gerektirmez, veri kaynakları ticari olarak edinilebilir, çıktısı bir
  rakamdır ve müşteri onu kendi muhasebesiyle doğrulayabilir.
- **Guardian son** çünkü en pahalı kanıt onunki: gerçek araç + gerçek yol +
  gerçek hava + tekrarlanabilir senaryo ister.

---

## 1. Boş yuva deseni (SPEED_CAMERA_WARNING ve benzerleri)

`SPEED_CAMERA_WARNING` kuralı **kodda kalır, veri gelmez**. Veriyi üretici ya da
filo müşterisi **kendi lisansıyla** takar — `ADR_PID_PACK.md`'deki paket
deseninin birebir aynısı:

| PID Pack'te | Yuva deseninde |
|---|---|
| tanım + `sourceRef` + `license` + güven sınıfı | kamera kaydı + `sourceRef` + `license` + `confidence` |
| gömülü paket checksum'u doğrulanır, bozuk paket **reddedilir** | yuva manifesti doğrulanır, beyansız veri **reddedilir** |
| lisans saflığı kayıtta taşınır | lisans yuvanın manifestinde taşınır (GPL/NC veri **kabul edilmez**) |

**Boş yuva davranışı — pazarlıksız:** yuva boşken kural **hiç çalışmaz**.
Sessizce "risk yok" **demez**, `confidence: 0` ile olay **üretmez**, boş liste
dönüp "temiz yol" izlenimi **vermez**. LAB'da yuvanın durumu okunur:
`YUVA BOŞ — kamera verisi takılmadı` / `YUVA DOLU — N kayıt · kaynak · lisans`.
Bu ayrım #503'ün dersinin aynısıdır: **sessizliğin sebebi görünmeli**.

Aynı desen ileride `ROAD_HAZARD` (yol tehlike veri tabanı) ve
`WEATHER_RISK` (ticari hava sağlayıcısı) için de kullanılabilir.

---

## 2. Özet tablo

| # | Parça | Önkoşul var mı | Tahmini iş | Kanıt için gereken | Satış kanalı |
|---|---|---|---:|---|---|
| P1 | ~~**Rota → TripPlan wiring**~~ ✅ **BİTTİ** (#510 🔴 cihaz gözlemi bekliyor) | yok — emekle biter | 2–3 gün | araç gerekmez | Filo · aftermarket |
| P2 | **Yakıt fiyatı** | gömülü **aylık tablo** (kendi derlememiz) | 3–4 gün | tablo doldurma ayrı veri işi | **Filo** (birincil) |
| P3 | **HGS tarifesi** | gömülü **tarife** (km bazlı yaklaşık yeterli) | 2–3 gün | gerçek geçişle karşılaştırma | **Filo** (TR'ye özgü) |
| P4 | **Otopark** | **hesaba GİRMEZ** — yalnız kullanıcı beyanı | 1 gün | beyanın hatırlandığı gösterilir | Aftermarket · filo |
| P5 | **Konaklama** | **il taban tablosu + TÜİK endeksi** | 3–4 gün | endeks doğru uygulanıyor + kullanıcıya görünmüyor | Filo (uzun yol) |
| P5b | **Kamp · plaj · feribot · müze** | **hesaba GİRMEZ** — yalnız kullanıcı beyanı | paket şemasına dahil | rota yakınlığı kalem ÜRETMEZ | Aftermarket · filo |
| P6 | **Hız kamerası yuvası** | yok (veri MÜŞTERİDEN) | 3–4 gün | yuva manifesti + LAB | **OEM · filo** |
| P7 | **Hava** | **veri + lisans (BYOK)** | 3–4 gün | hava API + gerçek yol | Aftermarket · filo |
| P8 | **Viraj geometrisi** | **G1 (GPS)** | 5–7 gün | **gerçek araç + viraj** | Aftermarket · OEM |
| P9 | **Yokuş** | **G1 (GPS)** | 3–5 gün | **gerçek araç + eğim** | Filo (fren/yakıt) |
| P10 | **Yol tehlikesi** | **G1 + veri kaynağı** | 4–6 gün | tehlike veri tabanı | **Filo** (kendi filosu üretir) |
| P11 | **Yorgunluk** | **sinyal YOK** | 2 gün (zayıf) | mevzuat danışması | **Filo** (AETR/takograf) |

> Tahminler **gün cinsinden geliştirici işidir**, saha doğrulama süresi hariç.
> "Önkoşul" sütunundaki kalın yazı, o parçanın **emekle bitmeyeceğini** söyler.
>
> **2026-08-09 güncellemesi:** Trip Cost fiyat kaynağı modeli **karara bağlandı**
> (§3.0). Önceki sürümde P2–P5 "BYOK / ticari API / lisans kararı bekliyor"
> diyordu; artık **hiçbiri dış API'ye bağlı değil** — gömülü tablo + resmî
> endeks + kullanıcı beyanı. Bu, dış lisans/ToS riskini de sıfırlar.

---

## 3. Trip Cost parçaları

### 3.0 · FİYAT KAYNAĞI MODELİ — KARARA BAĞLANDI (2026-08-09)

> **TEMEL İLKE — pazarlıksız: ürün HİÇ kullanıcı girdisi olmadan da çalışır.**
>
> *"Fiyatları sen gir"* demek, özelliği kullanıcıya tamamlatmaktır. Çoğu kişi
> girmez; gömülü satışta (head unit'e önyüklü gelen üründe) özellik **ölü doğar**
> ve müşteri onu hiç görmemiş gibi olur. Bu yüzden kullanıcı girdisi bir
> **ZORUNLULUK değil, İYİLEŞTİRMEDİR**. Kutudan çıktığı hâliyle her kalem ya
> dolu gelir ya hiç doğmaz — kullanıcıya soru sorularak boşluk kapatılmaz.

**Varsayılan kaynaklar (kullanıcı hiçbir şey yapmazsa çalışan hâl):**

| Kalem | Varsayılan kaynak | İlk sürüm hassasiyeti |
|---|---|---|
| **Yakıt** | Gömülü **aylık tablo** | İl bazında sapma tahminde önemsiz — tek tablo yeterli |
| **HGS** | Gömülü **tarife** | **km bazlı yaklaşık YETERLİ**; tam gişe-çifti eşleşmesi sonraki tur |
| **Otel** | Elle derlenmiş **il taban tablosu** + **TÜİK konaklama fiyat endeksiyle içeride güncelleme** | İl bazında taban gece fiyatı |
| **Otopark · kamp · plaj · feribot · müze** | **YOK — hesaba HİÇ GİRMEZ** | Sistem sormaz, tahmin etmez, uydurmaz |

**Neden elle derlenmiş kendi tablomuz:** araştırma sonucu Türkiye'de **il bazında
açık/resmî TL otel fiyatı verisi YOKTUR.** TÜİK yalnız fiyat **ENDEKSİ** (yüzde
değişim) yayınlar; Bakanlık verisi **doluluk**tur, fiyat değil; TÜROB/STR ADR'si
lisanslıdır ve yalnız İstanbul/Antalya/Ankara/Anadolu kovalarındadır. Tek dürüst
yol: **kendi taban tablomuzu bir kereye mahsus elle derlemek** (kaynağı ve tarihi
beyanlı) ve **ücretsiz + resmî + beyan edilebilir** olan TÜİK endeksiyle içeride
güncellemek. Aynı yöntem otopark için de geçerlidir.

**VERİ TOPLAMA YASAĞI (pazarlıksız):** rezervasyon/fiyat sitelerinden **otomatik
veri çekilmez** (ToS + lisans + kırılganlık). İzin verilen **üç** yol:
1. **Resmî kaynak** (TÜİK endeksi, KGM/HGS tarifesi),
2. **Elle derlenmiş kendi tablomuz** (kaynağı + tarihi beyanlı),
3. **Kullanıcı beyanı**.

**SUNUM KURALI (pazarlıksız):** kullanıcıya **YALNIZ güncellenmiş TL rakamı**
gösterilir — *"Mersin 1 gece ~2.800 TL, tahmini"*. **Endeks, yüzde ve hesap arka
planda kalır ve kullanıcıya ASLA görünmez.** Kullanıcı "TÜİK endeksi %14 arttı"
cümlesini görmez; gördüğü şey güncellenmiş rakamdır. Ara adımların görünmesi
güveni artırmaz, kalabalık yapar. *(Bu bir GİZLEME değil sadeleştirmedir: hesabın
kendisi LAB'da geliştiriciye açık kalır.)*

**DÜRÜSTLÜK ETİKETİ:** tablo kaynaklı her kalem **"tahmin"** olarak işaretlenir,
**"ölçüm" DENMEZ.** Mevcut `CostItemSource` ayrımına bağlanır — bugün `live`
(gerçek zamanlı) · `cached` · `osm` · `user` · `calculated` · `unknown` değerleri
var; tablo tahmini bunların hiçbirine dürüstçe oturmuyor (`live` değil; `cached`
de değil — hiç canlı OLMADI ki önbelleğe düşsün). Bu yüzden **yeni bir
`'estimate'` kaynak değeri** eklenecek ve LAB'da gözlemlenebilirlik sözleşmesine
`DERIVED` olarak eşlenecek (`OBSERVED` **değil**).

**KULLANICI GİRDİSİ = İYİLEŞTİRME:** isteyen **düzeltir** (yakıt, otel) veya
**ekler** (kamp, plaj, feribot, müze). Girilen değer **HATIRLANIR** ve
`source: 'user'` ile tablo tahmininden **DAHA YÜKSEK güven** alır. Girmeyende
hiçbir şey bozulmaz — varsayılan yoluna devam eder.

**KRİTİK KURAL — sistem kalemi KENDİLİĞİNDEN EKLEMEZ:** rota plajın yanından
geçiyor diye plaj ücreti eklenmez; müzenin yanından geçmek müze bileti doğurmaz.
**Ya kullanıcı söyler, ya kalem hiç doğmaz.** Bu, B3'te kurulan "kategori hiç
açılmaz" kapısının aynısıdır ve niyet okuma (rota yakınlığından ihtiyaç türetme)
kesinlikle YASAKTIR.

**KALEMLER VERİ OLACAK, KOD DEĞİL:** yeni bir kalem eklemek (kamp · feribot ·
müze) **kod değişikliği gerektirmemelidir** — `ADR_PID_PACK` / RulePack deseni:
kalem tanımı bir **pakette veri** olarak yaşar, kaynağı ve lisansı beyanlıdır,
checksum'ı doğrulanır, beyansız paket **reddedilir**. Bugünkü `category: string`
alanı zaten serbest metin olduğu için model bu yöne açık; eksik olan **paket
şeması + doğrulayıcı + sürüm/tazelik defteri**.

**GÜNCELLEME SIKLIĞI ve ÇEVRİMDIŞI:** benzin **canlı** (ağ varsa tazelenir);
HGS · otel · otopark tabloları **paket hâlinde cihazda** durur ve **ayda bir**
tazelenir. **İnternetsiz çalışır** — paket cihazda olduğu için ağ yokluğu kalemi
ÖLDÜRMEZ; yalnız tazelik damgası eskir (`stale` işaretlenir, uydurma YAPILMAZ).

---


### P1 · Rota → TripPlan wiring — **UYGULANDI 2026-08-09** (kütük #510 🔴)
- **Ne eksik:** `tripCostRouteAdapter` (B2) dönüşümü yazmış ve dönüşümün
  **kayıplı/tek yönlü** olduğunu belgelemiş; ama ürün ucunda bu adaptörü
  çağıran yok. `TripPlanMetadata` (origin/destination/gece sayısı/yolcu/araç
  profili) rota modelinde **hiç yok** — dışarıdan zorunlu verilmeli.
- **Emekle mi biter:** **Evet.** Veri kaynağı, lisans veya araç gerekmez;
  eksik olan yalnızca composition. Trip Cost'un tek "saf emek" parçası budur.
- **Tahmini iş:** 2–3 gün (adaptör çağıranı + metadata giriş yüzeyi + LAB ekranı
  + kilit testleri).
- **Kanıt:** araç gerekmez. Gerçek bir rota hesaplanır, `CostReport` üretilir ve
  LAB'da `lowerBound` + `missingItems` + `weightedConfidence` okunur. Bütün
  kalemler `unknown` olsa bile rapor **üretilmelidir** — bu, dürüstlük
  sözleşmesinin çalıştığının kanıtıdır.
- **Satış kanalı:** Filo · aftermarket. Diğer on parçanın hepsi buna bağlanır;
  bu bitmeden hiçbir fiyat kaynağının değeri görünmez.
- **Not:** Bu parça sıradaki **ilk iş**tir (#491 ve G1'den sonra).
- **SONUÇ (2026-08-09):** `tripCostComposition` (SAF) yazıldı; beyan kapısı
  fail-closed, kategori kapıları iki farklı "yok"u ayırıyor, LAB ekranı
  (Trip Cost) bağlandı. Fiyat kaynağı olmadan plan üretiliyor: mesafe/süre
  okunuyor, yakıt kalemi doğuyor, tutar `null` kalıyor. 29 kilit testi ·
  tsc temiz · 506 dosya / 11 495 test · guard 393/393. Cihaz gözlemi: **#510**.
- **Ek bulgu:** hiçbir cost provider `plan.nights` · `plan.travellers` ·
  `plan.vehicleProfile` OKUMUYOR (ölçüldü) — bu alanlar bugün yalnız tanımlayıcı.
  Beyan edilmediklerinde bir maliyet üretemezler; yine de LAB "0 gece" değil
  **"beyan edilmedi"** gösteriyor.

### P2 · Yakıt fiyatı
- **Ne eksik:** `computeFuelCost` formülü hazır; eksik olan **gömülü aylık fiyat
  tablosu** + tazelik/`stale` politikası + "OBD gerçek tüketim > araç profili >
  sınıf varsayılanı" önceliği (bilinçli olarak wiring'e bırakılmıştı).
- **Emekle mi biter:** **Kısmen.** Tablo şeması ve paket mekaniği emekle biter;
  tablonun **doldurulması** ayrı bir veri işidir (bir kereye mahsus + aylık
  tazeleme). Ağ varsa canlı tazeleme opsiyoneldir, **şart DEĞİLDİR**.
- **Tahmini iş:** 3–4 gün (paket şeması + `estimate` kaynak değeri + tüketim
  önceliği + LAB tazelik göstergesi). Tablo doldurma hariç.
- **Kanıt:** Araç gerekmez (tablo yolu için). **OBD gerçek tüketim** bacağı için
  gerçek araçta bir yolculuk gerekir. Lisans: tablo kendi derlememiz → temiz.
- **Satış kanalı:** **Filo — birincil.** Filo maliyet muhasebesinin temel kalemi;
  aftermarket'te "ilginç", filoda **satın alma gerekçesi**.

### P3 · HGS tarifesi
- **Ne eksik:** `computeTollCost` üç durumu doğru ayırıyor; eksik olan **gömülü
  tarife paketi**. `routingService.detectToll` bugün yalnız boolean sezgiseldir
  ve B3 bu yüzden `ROTA_UCRETLI_AMA_SEGMENT_YOK` diyor.
- **İlk sürüm kararı:** **km bazlı yaklaşık YETERLİ.** Tam gişe-çifti eşleşmesi
  **sonraki tur**. Yaklaşık değer `estimate` olarak işaretlenir; "kesin tutar"
  iddiası EDİLMEZ.
- **Emekle mi biter:** Şema + km-bazlı hesap emekle biter; **tarife tablosu**
  resmî kaynaktan derlenir (kamuya açık ama makine-okunur değil).
- **Tahmini iş:** 2–3 gün (paket şeması + km bazlı hesap + sürüm/tarih beyanı +
  LAB). Tablo doldurma hariç.
- **Kanıt:** Bilinen bir güzergâhta (ör. Konya→Tarsus) hesaplanan tutarın gerçek
  HGS kesintisiyle karşılaştırılması — **gerçek geçiş** gerekir, araç değil.
- **Satış kanalı:** **Filo — Türkiye'ye özgü güçlü argüman.** Yabancı hiçbir
  navigasyon ürünü HGS'yi kalem bazında vermiyor.

### P4 · Otopark
- **KARAR: varsayılan olarak hesaba HİÇ GİRMEZ.** Sistem otopark ücreti sormaz,
  tahmin etmez, uydurmaz. Rota şehir merkezinden geçiyor diye otopark kalemi
  **DOĞMAZ**.
- **Ne eksik:** Yalnız **kullanıcı beyanı** yolu — isteyen ekler, eklemeyende
  kalem hiç doğmaz (B3'teki `OTOPARK_KAYDI_YOK` kapısı bu davranışı zaten verir).
  İleride il taban tablosu + TÜİK endeksi yöntemi otele **birebir aynı şekilde**
  uygulanabilir; bu tur kapsamı DEĞİL.
- **Tahmini iş:** 1 gün (yalnız kullanıcı beyanı yolu; tablo yapılmıyor).
- **Kanıt:** Kullanıcı beyanının HATIRLANDIĞI ve `source:'user'` ile tablo
  tahmininden daha yüksek güven aldığı gösterilir.
- **Satış kanalı:** Aftermarket · filo (şehir içi). Düşük öncelik.

### P5 · Konaklama
- **Ne eksik:** **İl taban tablosu** (elle derlenmiş, kaynağı beyanlı) + **TÜİK
  konaklama fiyat endeksiyle içeride güncelleme** + sunum kuralı.
- **Neden bu yol:** il bazında açık/resmî TL otel fiyatı verisi **YOK** (§3.0).
  TÜİK yalnız endeks verir → tabanı biz koyarız, endeks onu taşır.
- **Emekle mi biter:** Mekanik emekle biter; **taban tablonun derlenmesi** bir
  kereye mahsus veri işidir. Endeks ücretsiz ve resmîdir.
- **Tahmini iş:** 3–4 gün (taban tablo şeması + endeks uygulama + `estimate`
  etiketi + sunum kuralı + LAB). Tablo doldurma hariç.
- **Kanıt:** Endeksin doğru uygulandığı (taban × endeks = gösterilen TL) **ve
  kullanıcıya endeks/yüzde/hesabın HİÇ görünmediği** doğrulanır. Lisans: TÜİK
  resmî + kendi tablomuz → temiz; rezervasyon sitesi kazıma **YOK**.
- **Satış kanalı:** Filo (uzun yol/lojistik) · aftermarket (tatil rotası).

### P5b · Kamp · plaj · feribot · müze — YALNIZ kullanıcı beyanı
- **KARAR: hesaba HİÇ GİRMEZ.** Sistem bunları sormaz, tahmin etmez, uydurmaz ve
  **rota yakınlığından TÜRETMEZ**. Kullanıcı eklerse kalem doğar, eklemezse yok.
- **Ne eksik:** Bunların kalem olarak eklenebilmesi — yani **kalem tanımının veri
  olması** (paket şeması). Kod değişikliği gerektirmeden yeni kalem tipi
  eklenebilmeli.
- **Tahmini iş:** paket şeması işine dahil (§3.0), ayrı maliyet yok.
- **Kanıt:** Kullanıcı eklemediğinde kalemin HİÇ doğmadığı; rota yakınlığının
  kalem üretmediği (niyet okuma yasağı) test edilir.
- **Satış kanalı:** Aftermarket (tatil) · filo (personel taşıma feribotu).


## 4. Guardian AI parçaları

> **Ortak önkoşul:** Guardian'ın **tick sahibi yok**. Motoru kimin, kaç Hz'de,
> hangi DeviceTier bütçesiyle süreceği kararı hiçbir parçaya ait değildir ve
> **hepsinden önce** verilmelidir. Kütük #494 taslağı zaten "hüküm üretimi
> `guardian/*` içinden sürüş yolunda koşmamalı · `low` tier'da tek koşum
> < 16 ms" diyor — Guardian ısınma/kasma geçmişi olan bir üründe hot-path'e
> giremez. Bu karar ~1 gün, ama sıraya **P8'den önce** girer.

### P7 · Hava
- **Ne eksik:** `weatherSource` **yalnız interface** — "GERÇEK IO YOK" diye
  yazıyor. `RawWeatherData` yüzey durumu + görüş mesafesi + güven istiyor.
- **Önce başka şey gerekiyor:** **Veri + lisans (BYOK).** Open-Meteo ticari
  kullanıma açık ve atıf ister; yüzey durumu (`ıslak/buzlu`) doğrudan gelmez,
  sıcaklık+yağıştan **türetilir** → türetilen değerin güveni dürüstçe düşük
  işaretlenmeli, "buzlu yol tespit edildi" **denmemeli**.
- **Tahmini iş:** 3–4 gün (HTTP portu + çevrimdışı/bayat politikası + türetme
  güveni + LAB + atıf ekranı).
- **Kanıt:** Gerçek yolda, bilinen hava koşulunda uyarının çıkması **ve**
  koşul yokken çıkmaması. Ağsız durumda `unknown` kalması.
- **Satış kanalı:** Aftermarket · filo. OEM'de düşük (çoğu OEM yağmur/dış
  sıcaklık sensörünü zaten veriyor).

### P8 · Viraj geometrisi
- **Ne eksik:** `RawCurveData` yarıçap · tavsiye hızı · yön · mesafe istiyor.
  Bunların **hiçbiri** bugün üretilmiyor; rota geometrisi var ama ondan yarıçap
  çıkaran hesap yok.
- **Önce başka şey gerekiyor:** **G1 (GPS tazeliği) — ŞARTLI KİLİT.** 509 m
  konum körlüğüyle "300 m sonra viraj" cümlesi kurulamaz. Ayrıca yol geometrisi
  kaynağı gerekir (rota polyline'ından türetme mümkün — Overpass'a gerek yok).
- **Tahmini iş:** 5–7 gün (polyline→yarıçap hesabı + hız/yarıçap eşiği +
  tavsiye hızı türetme + LAB). Hesabın kendisi zor değil; **doğrulanması**
  pahalı.
- **Kanıt:** **Gerçek araç + gerçek viraj.** Bilinen keskin bir virajda,
  bilinen hızla, uyarının doğru mesafede çıkması; düz yolda çıkmaması.
- **Satış kanalı:** Aftermarket · OEM (ADAS'ı olmayan araçlar). Guardian'ın
  en gösterişli parçası, ama en pahalı kanıtı olan da bu.

### P9 · Yokuş
- **Ne eksik:** `RawRoadProfileData` iniş eğim yüzdesi istiyor; üretilmiyor.
- **Önce başka şey gerekiyor:** **G1.** Eğim ya yükseklik profilinden (rota
  servisinden gelebilir) ya GPS irtifasından türetilir; GPS irtifası zaten yatay
  konumdan daha gürültülüdür — bayat fix'le türetilen eğim çöptür.
- **Tahmini iş:** 3–5 gün.
- **Kanıt:** **Gerçek araç + bilinen eğimli yol** (ör. Toroslar inişi).
- **Satış kanalı:** **Filo** — uzun inişte fren aşınması ve yakıt tüketimi
  filonun somut maliyet kalemidir. Aftermarket'te ilgi çekici ama satış
  gerekçesi değil.

### P10 · Yol tehlikesi
- **Ne eksik:** `RawRoadHazardData` tehlike tipi + mesafe + güven + kaynak
  istiyor; **kaynak yok**.
- **Önce başka şey gerekiyor:** **G1 + veri kaynağı.** Tehlike verisi ya
  crowd-source ya resmî kaynaktır; ikisi de bugün yok.
- **Tahmini iş:** 4–6 gün (yuva deseniyle — P6 ile aynı altyapı).
- **Kanıt:** Tehlike veri tabanı + gerçek yolda konum eşleşmesi.
- **Satış kanalı:** **Filo — en güçlü argüman burada.** Bir filo kendi
  araçlarının geçtiği yolları kendisi işaretleyebilir; veri müşterinin
  kendisinden gelir, lisans sorunu doğmaz. Aftermarket'te tek kullanıcı veri
  üretemez.

### P11 · Yorgunluk
- **Ne eksik:** `RawDriverFatigueData` iki farklı sınıf alan istiyor ve bu ayrım
  zaten koda yazılmış:
  - **zaman tabanlı:** `continuousDrivingMinutes`, `minutesSinceLastMeaningfulBreak`,
    `tripDurationMinutes`, `localHour` → **bunlar bugün üretilebilir**;
  - **sensör tabanlı:** `lowAttentionSignal`, `repeatedLaneCorrectionSignal`,
    `microsleepSuspectedSignal` → **bugün hiçbir sinyal yok** (kamera yok,
    şerit takibi yok, direksiyon açısı yok).
- **Önce başka şey gerekiyor:** Zaman tabanlı bacak için **hayır, emekle biter**.
  Sensör bacağı için **donanım** gerekir.
- **ŞARTLI KİLİT:** Zaman tabanlı zayıf tahmin yapılacaksa güveni **dürüst**
  işaretlenir ve **"tespit" denmez**. Kabul edilebilir cümle: *"3 saattir
  molasız sürüyorsunuz"* (ölçüm). Yasak cümle: *"yorgunsunuz"* / *"dikkatiniz
  dağıldı"* (tespit iddiası — dayanağı yok).
- **Tahmini iş:** 2 gün (zayıf/zaman tabanlı bacak). Sensör bacağı **kapsam
  dışı**.
- **Kanıt:** Mevzuat danışması (AETR/takograf sürüş-mola kuralları) + gerçek
  yolculukta sayaçların doğruluğu.
- **Satış kanalı:** **Filo — birincil ve mevzuat destekli.** Aftermarket'te
  yanlış-pozitif riski itibar kaybı; filoda sürüş-mola takibi zaten yasal
  yükümlülük.

### P6 · Hız kamerası yuvası
- **Ne eksik:** `RawSpeedCameraData` kayıt id · tip · mesafe · güven · kaynak
  istiyor. **Veri gelmeyecek** — eksik olan **yuvanın kendisi**.
- **Önce başka şey gerekiyor:** **Hayır — emekle biter.** Bu parçanın tamamı
  kendi kontrolümüzde: manifest şeması, lisans beyanı zorunluluğu, doğrulama,
  boş-yuva davranışı, LAB gözlemi.
- **Tahmini iş:** 3–4 gün.
- **Kanıt:** Veri kaynağı **gerekmez** — kanıt, yuva boşken kuralın hiç
  çalışmadığı ve LAB'ın `YUVA BOŞ` dediğidir. Sahte kamera paketiyle dolu-yuva
  yolu da doğrulanır.
- **Satış kanalı:** **OEM · filo.** Kamera verisi ülkeye göre lisanslıdır ve
  bazı ülkelerde gösterimi yasaktır; yuva deseni **hukuki riski müşteriye
  devreder** — üretici kendi lisansını takar, biz veri dağıtmayız. Bu, satışı
  kolaylaştıran bir tasarım kararıdır, teknik bir eksiklik değil.

---

## 5. `guardianDecisionEngine` → `guardianAlertRanker` (UYGULANDI 2026-08-09)

**Karar:** Bu modül bir **karar otoritesi değildir**; risk olaylarını önceliğe
göre sıralayan ve hangisinin sesli/ekranda sunulacağını seçen bir **uyarı
sıralayıcısıdır**. Kendi başlığı da bunu söylüyor: *"Bu motor KARAR-SUNUMU
yapar, RİSK ANALİZİ DEĞİL — event ÜRETMEZ, severity HESAPLAMAZ."*

Ölü kod envanterinde onu "11. karar otoritesi" diye listelemek **yanlıştı**;
ADR-286'nın tekleştirmek istediği şey *hüküm üretenler*dir, sıralayıcılar değil.
Bu düzeltme envanter ve vizyon belgelerine **bugün** işlendi.

**Yeniden adlandırma UYGULANDI (2026-08-09, tek atomik PR — davranış değişmedi):**

| Eski | Yeni |
|---|---|
| `guardianDecisionEngine.ts` | `guardianAlertRanker.ts` |
| `evaluateGuardianDecision()` | `rankGuardianAlerts()` |
| `GuardianDecision` | `GuardianAlertPlan` |
| `GUARDIAN_DECISION_ID` | `GUARDIAN_ALERT_RANKER_ID` |

Saf yeniden adlandırma: davranış değişmedi, ürün tüketicisi zaten yoktu.
`GUARDIAN_DECISION_ID` sabitinin değeri de (`'guardian-decision'` →
`'guardian-alert-ranker'`) güncellendi — sabitin hiçbir okuyucusu olmadığı
ölçülerek doğrulandı. Modül başlığına rolün **ne OLMADIĞI** yazıldı, çünkü bu
yanılgıyı üreten şey adın kendisiydi.

Doğrulama: `tsc --noEmit` temiz · `guardianAlertRanker.test.ts` 26/26 ·
guard 393/393.

---

## 6. Bu planın kendine koyduğu sınır

- Buradaki hiçbir satır bir özelliği "tamamlandı" saymaz. Tamamlanma ölçütü
  `DEVICE_VALIDATION_LEDGER.md`'de 🟢'dir.
- Gün tahminleri **tahmindir**, taahhüt değil; saha doğrulama süresi hariçtir.
- Bir parça sırası geldiğinde önkoşulu hâlâ yoksa **başlatılmaz**, sıradaki
  parçaya geçilmez — sıra kuralı budur.
