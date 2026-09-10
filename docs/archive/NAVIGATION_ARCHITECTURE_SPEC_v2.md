# CAROS NAVİGASYON MİMARİSİ — SPESİFİKASYON v2.0

**Belge kimliği:** `CAROS-NAV-ARCH-SPEC-2.0`
**Tarih:** 2026-08-28 · **Statü:** TASLAK SPESİFİKASYON (uygulama başlamadı)
**Yerini aldığı belge:** `NAVIGATION_OEM_PLUS_ARCHITECTURE_2026-08-28.md` (v1) —
v1 artık **boşluk analizi** olarak geçerlidir; **bağlayıcı sözleşme bu belgedir.**
**Öncelik:** `AI.md` > `CLAUDE.md` > bu belge > tüm diğer navigasyon belgeleri.

---

## 0. BELGE YÖNETİMİ

### 0.1 Bu belge ne yapar, ne yapmaz

**Yapar:** veri formatlarını bayt seviyesinde, algoritmaları denklem seviyesinde,
bütçeleri milisaniye/megabayt seviyesinde, hata modlarını FMEA seviyesinde ve
doğrulamayı tekrar-edilebilir koşu seviyesinde SABİTLER.

**Yapmaz:** kod yazmaz, dosya oluşturmaz, mevcut davranışı değiştirmez.
Bir şeyi "yapıldı" saymaz — her madde `docs/DEVICE_VALIDATION_LEDGER.md`e
🔴 olarak girer ve gerçek araçta ölçülünce 🟢'ya taşınır.

### 0.2 Zorunluluk dili (RFC 2119 karşılığı — bağlayıcı)

| Terim | Anlam |
|-------|-------|
| **ZORUNLU** | İhlali mimari ihlalidir; PR reddedilir. Karşılığında bir kilit testi vardır. |
| **YASAK** | Aynı ağırlıkta, olumsuz yön. |
| **ÖNERİLİR** | Sapma serbesttir ama PR açıklamasında GEREKÇE yazılır. |
| **İSTEĞE BAĞLI** | Serbest. |

Bu belgede **ZORUNLU/YASAK** geçen her cümlenin ya bir kilit testi ya bir
kütük maddesi karşılığı vardır. Karşılığı olmayan zorunluluk yazılmaz.

### 0.3 Terimler (tek anlam — belge boyunca değişmez)

| Terim | Tanım |
|-------|-------|
| **Ego** | Aracın kendi konumu/yönü/hızı hakkındaki tek doğruluk kaynağı (L2 çıktısı). |
| **Ufuk (CEH)** | Aracın ÖNÜNDEKİ yolun, öznitelikleriyle birlikte, tek üretilmiş temsili (L3). |
| **MPP** | Most Probable Path — ufkun ana kolu. Rota varsa rota, yoksa tahmin. |
| **Dal (branch)** | MPP'den ayrılan, olasılığıyla birlikte taşınan alternatif kenar zinciri. |
| **Kenar (edge)** | Yol grafiğinde iki düğüm arası yönlü bağlantı. Rota bunların dizisidir. |
| **İstasyon (station)** | Ufuk profillerinin örneklendiği sabit aralıklı yol-boyu nokta (10 m). |
| **Yol-boyu (along)** | Mesafenin yol geometrisi üzerinden ölçümü. **Kuş uçuşu DEĞİL.** |
| **Kanıt sınıfı** | `OBSERVED · DERIVED · UNAVAILABLE · STALE` (mevcut sözleşme). |
| **Tier** | `HIGH · BALANCED · BASIC_JS · SAFE_MODE` (AdaptiveRuntimeManager). |
| **Kilit testi** | `regression.guards.test.ts` veya eşdeğeri — zayıflatılması YASAK. |

---

## 1. MİMARİ İLKELER VE KARAR KAYITLARI

### 1.1 Dokuz ilke — her birinin ihlal testi vardır

| # | İlke | İhlal nasıl yakalanır |
|---|------|------------------------|
| P1 | **Tek otorite.** Her gerçeğin (konum · rota · oturum · ufuk · ETA) tek üreticisi vardır. | Kilit test: aynı gerçeği yazan ikinci modül import grafiğinde yasaklı. |
| P2 | **Ufuk merkezlidir.** L4-L6 harita/yol verisini ufuktan alır, kendi toplamaz. | Kilit test: L4-L6 dosyaları `overpass`/`mapStore`/`gpsService` import EDEMEZ. |
| P3 | **Görünüm yapraktır.** L7 hesaplamaz, tick sahibi olmaz, abonelik sahibi olmaz. | Kilit test: `components/map/**` içinde `setInterval`/`scheduleTask`/`onGPSLocation` YASAK. |
| P4 | **Saf çekirdek.** Her karar `**/core/*.ts` içinde SAF modeldedir (I/O · timer · `Date.now` · global · React YOK). | Kilit test: `core/` dosyalarında yasaklı sembol taraması. |
| P5 | **Kanıtsız değer yayınlanmaz.** L2 üstünde her sayı `Evidenced<T>` taşır. | Kilit test: sözleşme tipleri; `number` dönen public nav getter YASAK. |
| P6 | **Monotonik zaman.** Süre/yaş hesabı `performance.now()` iledir; `Date.now()` yalnız kullanıcıya gösterilen takvim anı içindir. | Kilit test: nav ağacında `Date.now(` taraması (izinli liste dışında). |
| P7 | **Tek tick tekerleği.** `runtimeManager.scheduleTask()` dışında zamanlayıcı YASAK. | Mevcut kilit korunur + nav ağacına genişletilir. |
| P8 | **Yayınlanan geçmiş değişmez.** Geriye dönük düzeltme iç inanca uygulanır, yayınlanmış `EgoPose` akışına UYGULANMAZ. | Kilit test: replay'de çıktı akışı append-only. |
| P9 | **Bozulma isimlidir.** Her yetenek kaybının adı, susan iddiası ve kullanıcı mesajı vardır. | Kilit test: `NavDegradation` her değeri için matris satırı zorunlu. |

### 1.2 Karar kayıtları (ADR)

> Her ADR: **Karar · Neden · Reddedilen alternatif ve ret gerekçesi · Bedeli · Geri alma yolu.**

---

**ADR-N01 — Ufuk merkezli mimari**

**Karar:** "Önümde ne var?" sorusunun TEK cevaplayıcısı `HorizonProvider`dır (L3).
Guardian kuralları, HUD, ses, ETA ve rota maliyeti bu tek kaynaktan okur.

**Neden:** Bugün beş bağımsız cevaplayıcı var (`speedLimitService`/Overpass,
`curveAdapter`, `roadProfileAdapter`, `enforcementPointsSource`, `routingService.steps`);
farklı kadans, farklı güven, farklı kaynak → **tutarsızlık yapısal olarak kaçınılmaz**.
ADASIS'in AHP/AHR ayrımı ve Mapbox'ın Electronic Horizon'ı aynı sorunun kabul görmüş çözümüdür.

**Reddedilen:** *(a)* "her tüketici kendi verisini çeksin, önbellek paylaşsın" — önbellek
tutarlılığı sağlar ama **karar tutarlılığı sağlamaz**; iki tüketici aynı veriden farklı
sonuç çıkarmaya devam eder. *(b)* "Guardian tek tüketici olsun, HUD ondan okusun" —
Guardian'ı bir veri katmanına dönüştürür, saf motor disiplini bozulur.

**Bedeli:** L3 tek arıza noktasıdır. **Azaltma:** ufuk üretilemezse `coverage: NONE`
yayınlanır ve ufuk-türevli TÜM iddialar susar (§9.1); rota rehberliği ufka bağımlı DEĞİLDİR.

**Geri alma:** `HorizonProvider` devre dışı bırakılırsa adaptörler eski kaynaklarına
düşecek şekilde bir sürüm boyunca çift yol korunur (F3 çıkışında sökülür).

---

**ADR-N02 — Onboard-öncelikli hibrit (çevrimiçi "teklif eder", "değiştirmez")**

**Karar:** Cihazda kapsam varsa rota **önce onboard** hesaplanır ve **hemen** sunulur.
Çevrimiçi sonuç geldiğinde rota **sessizce değiştirilmez**; `routeProviderLedger`e
yazılır ve yalnız ölçülebilir şekilde daha iyiyse kullanıcıya **teklif** edilir.

**Neden:** TomTom NavKit2 "online-first" der; biz tersini seçiyoruz çünkü hedef
donanımımızda ağ güvenilmezdir ve **ölçülmüş** bir maliyet vardır: ölü L0 daemon
yoklaması her rotada 3 sn'ye kadar bekleyebiliyordu. Sürücü için 3 sn "bozuk ürün"dür.

**Reddedilen:** *(a)* online-first + onboard yedek — ağ kesintisinde ilk rota gecikir.
*(b)* Paralel yarış (ikisini birden başlat, ilk geleni al) — **rota kimliği belirsizleşir**,
`routeRequestLedger` iki sahip görür, reroute mantığı bozulur.

**Bedeli:** Trafiğe göre optimal olmayan bir rotayla yola çıkılabilir. **Azaltma:**
teklif mekanizması + ETA'nın trafik bileşeni (`EtaVerdict.parts.trafficDeltaS`) ayrı taşınır.

---

**ADR-N03 — Karolu, hiyerarşik, sürümlü harita verisi (monolit emekli)**

**Karar:** `graph` ve `adas` katmanları z9 karo ızgarasında, CSR düzeninde,
TypedArray ile **sıfır-kopya** okunacak biçimde paketlenir.

**Neden — ölçülmüş:** Bugünkü `routing-graph.bin` **238 252 düğüm · 295 346 kenar ·
7 651 542 bayt**, tek blob. Worker onu `Map<number, GraphEdge[]>` + nesne dizisine açar.
Kaba tahmin (ÖLÇÜLMEDİ, türetildi): ~370 000 kenar nesnesi × ~56 B + Map/dizi ek yükü
≈ **50–70 MB JS yığını**. 7.65 MB'lık dosya, bellekte ~8× büyür. Mali-400 sınıfı
head unit WebView yığını için bu kabul edilemez. CSR + TypedArray'de **dosya ≈ yığın**.

**Reddedilen:** *(a)* Monoliti sıkıştırıp bırakmak — bellek sorunu çözülmez, kısmi
güncelleme yine imkânsız. *(b)* SQLite (poi.db gibi) — rastgele erişim iyi ama
sıcak-yolda sorgu maliyeti ve WASM bağımlılığı ufuk kadansında ağır.

**Bedeli:** Yeni üretim hattı + format sürümlemesi. **Geri alma:** RTG2 okuyucu
bir sürüm boyunca korunur (`version === 2` yolu zaten var).

---

**ADR-N04 — Rota motoru: hiyerarşik, kenar-geçişli A\* + kabul edilebilir alt sınır**
**(CH/CCH ERTELENDİ)**

**Karar:** Onboard yönlendirici **yol sınıfı hiyerarşisi** üzerinde çalışan A\*'dır.
Sezgisel, **serbest akış süresi** alt sınırıdır: `h = d_gc / v_max_sınıf`.
**ZORUNLU INVARYANT:** araç-farkında maliyet değiştiricileri **çarpımsal ve ≥ 1.0**
olmak zorundadır.

**Neden bu invaryant mimarinin kalbidir:** A\*'ın doğru sonuç vermesi sezgiselin
**kabul edilebilir** (asla fazla tahmin etmeyen) olmasına bağlıdır. Tüm araç-farkında
çarpanlar ≥ 1.0 ise gerçek maliyet serbest akış süresinden ASLA küçük olamaz →
alt sınır geçerli kalır → **dinamik maliyet, aramanın doğruluğunu bozmaz.**
Bir çarpanı < 1.0 yapmak (ör. "sürücü otoyol seviyor → ×0.9") bu garantiyi kırar.
Bu yüzden tercih ifadeleri **rakibi cezalandırarak** modellenir, ödüllendirerek değil.

**Neden CH değil:** Contraction Hierarchies ön-işlemesi **metriğe gömülüdür**; maliyet
araç durumuna göre değişince kısayollar geçersizleşir. CCH (customizable CH) metrikten
bağımsız ön-işleme + hızlı özelleştirme sunar, ama özelleştirme fazı Türkiye ölçeğinde
hedef donanımda pahalıdır ve **her termal/yakıt durumu değişiminde** tekrarlanması gerekir.
Valhalla, kıta ölçeğinde çevrimdışı yönlendirmeyi CH'siz, hiyerarşi + dinamik maliyetle
yapabildiğini göstermiştir.

**Neden hiyerarşi ZORUNLU — ölçülmüş gerekçe:** Worker'ın RAM koruması düşük-uçta
`MAX_CLOSED = 30 000`. Bugünkü grafik 238 252 düğüm ve **düz** (hiyerarşisiz).
Kodun kendi yorumu 350 km'lik bir rotanın tek başına ~23 000 düğüm ettiğini yazıyor →
arama tavana **zaten** çarpıyor. Hiyerarşi olmadan uzun rota yapısal olarak imkânsızdır.

**Bedeli:** Hiyerarşi geçiş kuralları (yukarı/aşağı sızma) hata yapmaya açıktır.
**Azaltma:** altın koşu korpusunda uzun rota senaryoları zorunlu (§10.3).

**Geri alma / ileri yol:** CCH, F6 olarak açık bırakılır; tetikleyici eşik:
onboard rota p95 > 3 sn ölçülürse.

---

**ADR-N05 — Eşleme: kayan pencereli HMM/Viterbi (en yakın segment DEĞİL)**

**Karar:** Ağ seviyesi eşleme, Newson-Krumm sınıfı bir HMM'dir: Gauss emisyon +
üstel geçiş, kayan pencere (W = 10 örnek), yayın gecikmesi L = 2 örnek.

**Neden:** "En yakın segment" bölünmüş bulvarda karşı şeride yapışır (15-25 m ayrım,
±10 m GPS gürültüsü). Bugünkü `mapMatchModel` üç kanıtı (dik mesafe · yön · süreklilik)
**doğru** seçmiş ama aday havuzu yalnız aktif rotadır → rota yokken sistem kördür.
HMM aynı üç kanıtı olasılık cinsinden ifade eder ve **yol ağına** genişletir.

**Reddedilen:** *(a)* Parçacık filtresi — daha güçlü ama hedef donanımda pahalı ve
deterministik tekrar (§10.2) için tohum yönetimi gerektirir. *(b)* Sadece EKF +
en yakın segment — topolojiyi kullanmaz, kavşakta yanlış kola geçer.

**Bedeli:** L örnek gecikme (≈ 2 s @1 Hz). **Azaltma:** yayın gecikmesi YALNIZ
eşleme kararına uygulanır; ham konum ve HUD ego'su gecikmez (P8 ile uyumlu).

---

**ADR-N06 — Konum: hata-durumlu (error-state) EKF, 5 durum**

**Karar:** `x = [pE, pN, ψ, v, b_ω]`; jiro sapması (bias) durum olarak tahmin edilir.
Yerel teğet düzlem (ENU), her ~10 km'de bir yeniden çapalanır.

**Neden:** Jiro sapması tahmin edilmezse ölü hesap (DR) yönü dakikada onlarca derece
kayar; tünelde konum yanlış yöne yürür. Kütükte "KONUM ÖLÜ HESABI YOK — tünel modu
ölü özellik" 🔴 olarak duruyor. Hata-durumlu form, doğrusallaştırmayı sıfır hata
etrafında yaptığı için sayısal olarak daha kararlıdır ve otomotivde standarttır.

**Reddedilen:** *(a)* Tamamlayıcı filtre — ucuz ama kovaryans üretmez; `sigmaAlong/Cross`
ve Mahalanobis kapısı kurulamaz. *(b)* 15-durumlu tam INS — telefon/head unit IMU'suyla
gözlemlenebilir değil, aşırı mühendislik.

**Bedeli:** Ayar (tuning) yükü. **Azaltma:** tüm gürültü parametreleri tek dosyada
sabit, saha kayıtlarından kalibre edilir (§3.2, §10).

---

**ADR-N07 — Kenar kimliği ve konum referanslama**

**Karar:** İç kimlik `EdgeId = tileId(32) | localIdx(23) | dir(1)` (64-bit, harita
sürümüne BAĞLI). Harita sürümleri arası ve dış sağlayıcılarla (trafik) referanslama
için **OpenLR sınıfı** bir konum referansı (LRP zinciri) kullanılır.

**Neden:** Trafik verisi (HERE/TomTom) bizim kenar kimliğimizi bilmez. OpenLR
harita-bağımsızdır, konum başına 16-20 bayttır ve aynı sağlayıcı haritalarında
%98 üstü, çapraz sağlayıcıda %96 üstü başarı bildirilmiştir.

**Reddedilen:** *(a)* Koordinat eşleştirme ile trafik bindirme — kavşak yakınında
yanlış kola bindirir. *(b)* Kalıcı global kenar kimliği üretmek — harita her
tazelendiğinde kimlik kayması yönetilemez.

**Bedeli:** Kod eki. **Azaltma:** F4'e kadar trafik yalnız **rota-göreli** (kendi
geometrimiz üzerinde) uygulanır; OpenLR yolu F5'te açılır.

---

**ADR-N08 — `Evidenced<T>` ürün tipidir, gözlem süsü değildir**

**Karar:** L2 üstünde yayınlanan her sayı `Evidenced<T>` taşır. LAB alanı
(`InspectorField`) bundan **TÜRETİLİR**; ters yön YASAK.

**Neden:** CLAUDE.md "paralel gözlem sistemi kurulmaz" der. Bugün dürüstlük etiketleri
her katmanın kendi icadı (`distanceSource`, `SpeedLimitSource`, `MapMatchReason`).
Tek tip, hem tekrarları öldürür hem "kanıtsız değer yayınlanmaz" kuralını
**derleyici tarafından** zorlanabilir kılar.

**Reddedilen:** Alan başına özel enum'ları sürdürmek — çalışıyor ama her yeni
yüzeyde dürüstlük yeniden icat ediliyor; ölçülmüş sonuç: aynı ETA dört yüzeyde
farklı güven kuralıyla gösteriliyordu (kütük P0-NAV-14).

**Bedeli:** Geniş ama mekanik migrasyon. **Azaltma:** F1'de yalnız SARMALAMA —
davranış değişmez, mevcut kilitler aynen geçer.

---

**ADR-N09 — Zaman: monotonik zorunlu**

**Karar:** Tüm süre/yaş/eşik hesapları `performance.now()` tabanlıdır. `Date.now()`
yalnız kullanıcıya gösterilen takvim anı ve kalıcılık damgası içindir.

**Neden:** Araçta akü kesintisi ve NTP düzeltmesi sistem saatini geriye atar;
duvar saati farkı kullanan bir ETA/tazelik hesabı sessizce yanlışlanır.
CLAUDE.md bunu "Clock Jump Protection" olarak zaten zorunlu kılıyor.

---

**ADR-N10 — Geodezi ve sayısal temsil**

**Karar:** Depolama `int32 × 1e-7 derece`. Hesap, yerel teğet düzlemde `float64` metre.
Ufuk profilleri `TypedArray` (SoA).

**Neden — ölçülmüş sınır:** Bugünkü grafik düğümleri `float32`. 41° enlemde float32
adımı ≈ **0.54 m** (enlem) / ≈ **0.29 m** (boylam). Rota geometrisi için kabul
edilebilir, **şerit seviyesi (≤ 0.3 m) iş için değil**. `int32 × 1e-7` ≈ 1.1 cm →
şerit seviyesine gelecekte kapı açık kalır. Bu bir kusur düzeltmesi değil,
**bilinçli bir tavan yükseltmesidir**.

---

**ADR-N11 — İş parçacığı topolojisi: ufuk ANA İŞ PARÇACIĞINDA kalır (şimdilik)**

**Karar:** EKF + HMM + ufuk ilerletme **ana iş parçacığında** çalışır.
Yalnız **rota arama** worker'dadır (bugünkü gibi).

**Neden:** Bütçelenen maliyet 1-2 Hz'de toplam < 10 ms (§8.4). Worker'a taşımak
SAB + seqlock + çift durum yönetimi getirir; **ölçülmüş bir sorun olmadan
karmaşıklık eklemek mimari hatadır.**

**Tetikleyici eşik (ZORUNLU):** cihazda `long task > 50 ms` navigasyon kadansına
atfedilebilir şekilde ölçülürse, `nav-core.worker` F5'te açılır ve `EgoPose`
SAB seqlock ile taşınır (CLAUDE.md §SAB protokolü aynen uygulanır).

---

**ADR-N12 — Trafik: BYOK, TTL'li, rota-göreli**

**Karar:** Trafik sağlayıcısı BYOK'tur (HERE/TomTom — kodda zaten öyle). Anahtar
yoksa `source: 'estimated'` ve `NO_TRAFFIC` bozulma seviyesi yayınlanır.
Trafik verisi ufkun `traffic` profiline TTL ile yazılır; TTL dolunca `STALE`.

**Neden:** CLAUDE.md merkezi/gömülü API anahtarını yasaklıyor (fatura + ToS riski).
Ve "trafik verisi yok" ile "trafik akıcı" **asla** aynı görünmemelidir.

---

**ADR-N13 — Ses: zaman tabanlı tetik + dikkat bütçesi**

**Karar:** Anons kademeleri **süreye** göredir (`T-60s · T-25s · T-8s`), mesafeye göre
değil. Ses sahibi `voiceGuidanceRuntime`dır; HUD ses tetiklemez.

**Neden:** 600 m otoyolda ~20 sn, şehir içinde ~60 sn eder — aynı eşik iki ayrı
üründür. Ayrıca ses tetiği HUD'ın içindeyken tam ekran kapanınca anonslar susmuştu
(NAVIGATION_DELIVERY_CORE_P0). Sahiplik görünümden çıkmadıkça bu arıza sınıfı geri gelir.

---

**ADR-N14 — Doğrulama: deterministik tekrar (replay) mimarisi ZORUNLU**

**Karar:** L2-L6'nın tüm saf modelleri, kaydedilmiş bir sürüşten **bit-aynı** çıktı
üretecek şekilde tekrar oynatılabilir olmak ZORUNLUDUR. Altın koşu korpusu repoda
tutulur ve regresyon kasasına bağlanır.

**Neden:** Navigasyonun gerçek arızaları (tünel, bölünmüş yol, çöp fix, reroute
salınımı) **birim testle yakalanmaz**; sahada bir kez görülür, sonra kaybolur.
Kayıt + tekrar, o tek olayı **kalıcı bir kilide** dönüştürmenin tek yoludur.
Altyapının tohumu repoda var (`scripts/nav-field-record.mjs`, `nav-field-analyze.mjs`).

**Bedeli:** Saf model disiplini (zaman dışarıdan) her yerde ZORUNLU olur.
Bu zaten P4'tür — yani bedel sıfır, kazanç büyük.
---

## 2. L1 — VERİ MİMARİSİ (Map Store)

### 2.1 Bugünkü verinin ÖLÇÜLMÜŞ gerçeği

`public/maps/routing-graph.bin` doğrudan okunarak ölçüldü (2026-08-28):

| Ölçüm | Değer |
|-------|-------|
| Format | `RTG2` (magic `0x32475452`) |
| Düğüm | **238 252** (16 B/düğüm — `f32 lat · f32 lon` + 8 B ayrılmış) |
| Kenar | **295 346** (13 B/kenar — `u32 from · u32 to · u32 costM · u8 flags`) |
| Dosya | **7 651 542 B** (düğüm 3.64 MB + kenar 3.66 MB) |
| Kapsam (bbox) | enlem **35.821 – 42.060**, boylam **26.006 – 44.870** → **tüm Türkiye** |
| Yol sınıfı dağılımı | motorway **8 013** (%2.7) · trunk **73 099** (%24.8) · primary **52 169** (%17.7) · secondary **111 639** (%37.8) · link **50 426** (%17.1) |
| `tertiary` / `residential` / `service` | **0 kenar** |
| Tek yönlü kenar | **221 934** (%75.1) |
| Ortalama kenar uzunluğu | ≈ 220 m (Douglas–Peucker `--simplify 100` sonucu) |

**Bu ölçümün dört sonucu (hepsi mimariyi belirler):**

1. **Son kilometre yapısal olarak yoktur.** `tertiary` ve altı sıfır kenar. Çevrimdışı
   rota "şehirlerarası + ana arter"dir; "kapı önü" DEĞİLDİR. Ürün bunu böyle söylemek
   ZORUNDADIR (`coverage` sözleşmesi, §2.6).
2. **%75.1 tek yönlü** — Türkiye'nin bölünmüş yol ağıyla tutarlıdır, ama şunu doğurur:
   yanlış tarafa eşlenen bir araç için **geri dönüş kenarı yoktur** → çevrimdışı reroute
   çok uzun sapmalar üretebilir. Bu, ADR-N05'in (HMM) güvenlik gerekçesidir.
3. **100 m sadeleştirme**, geometriyi hem şekil hem arama uzayı olarak belirliyor.
   100 m çözünürlük **viraj yarıçapı ve şerit işi için yetersizdir**. Sonuç:
   **ADAS katmanı KENDİ geometrisini taşımak ZORUNDADIR** — rota grafiğinin
   geometrisine bindirilemez. (Mimari ayrımın veri kanıtı budur.)
4. **Hiyerarşi yok + 238 252 düğüm + `MAX_CLOSED = 30 000`** → uzun rota tavana çarpar.
   ADR-N04 bu ölçümün sonucudur, tercih değildir.

### 2.2 Karo ızgarası (z9) — hesaplanmış boyutlar

Web Mercator z9: 512×512 karo, boylamda **0.703°/karo**.
Türkiye bbox → boylamda **27 karo**, enlemde (y = 190…201) **12 karo** → **324 karo**
kutu içinde, karada roads bulunan ≈ **230 karo**.

**Karo başına ortalama:** 295 346 / 230 ≈ **1 284 kenar**, ≈ 1 036 düğüm.
Bu, karo başına ~30-40 KB'lık `graph` yükü demektir — sıcak-yolda tek karo yüklemek
**bir kare bütçesinin altında** kalır.

**ZORUNLU:** `graph`, `adas`, `poi` ve `enforcement` katmanları **aynı z9 karo kimliğini**
kullanır. `render` katmanı kendi z0-14 piramidindedir ama **z9 atası aynı kimliktir** →
"şu bölgeyi indir" tek işlem, kapsam raporu tek tablodur.

### 2.3 `graph` karo formatı — `GTL1` (CSR, sıfır-kopya)

```
offset  tip            alan
0       u32            magic 'GTL1' (0x314C5447 LE)
4       u8             formatVersion (=1)
5       u8             hierarchyLevel (0=core/motorway+trunk, 1=arterial, 2=local)
6       u16            flags   (bit0: hasTurnTable, bit1: hasExternalRefs)
8       u32            tileId  (z<<26 | x<<13 | y)
12      u32            dataVersion   (üretim damgası — katman bağımsız)
16      u32            nodeCount  N
20      u32            edgeCount  M
24      u32            geomPointCount G
28      u32            turnCount  T
32      u32            externalCount X
36      u32            crc32     (36. bayttan sonrasının CRC'si)
40      Int32Array[N]  nodeLatE7
        Int32Array[N]  nodeLonE7
        Uint32Array[N+1] edgeCsr        // düğüm → kenar aralığı (CSR)
        Uint32Array[M]   edgeTarget     // bit31=1 → externalRef indeksi
        Uint16Array[M]   edgeLenDm      // desimetre, max 6 553.5 m (uzun kenar bölünür)
        Uint8Array[M]    edgeAttr       // bit0 ileri · bit1 geri · bit2-4 sınıf
                                        // bit5 tünel · bit6 köprü · bit7 ücretli
        Uint32Array[M+1] geomCsr        // kenar → geometri aralığı
        Int16Array[2G]   geomDelta      // 1e-6 derece adım (≈0.11 m), ±3.6 km menzil
        Uint32Array[T]   turnTable      // fromEdgeLocal<<16 | toEdgeLocal, + ayrı maliyet dizisi
        Uint8Array[T]    turnCost       // 0=serbest · 255=YASAK · ara değer saniye
        Uint32Array[X]   externalRef    // komşu karo: tileIdx<<13 | localNodeIdx
```

**Tasarım gerekçeleri (her biri ölçüme veya kurala dayanır):**

- **CSR + TypedArray:** `ArrayBuffer` üstünde doğrudan görüntülenir; JS nesnesi
  üretilmez → **dosya boyutu ≈ yığın boyutu**. Bugünkü ~8× yığın patlamasını (§ADR-N03)
  yapısal olarak imkânsız kılar. V8 gizli sınıf kararlılığı da bedava gelir
  (CLAUDE.md §V8 — sıcak yolda nesne ayırma yok).
- **`edgeAttr` bit0/bit1 (ileri/geri erişim):** tek yönlülük artık "flag" değil
  **erişim maskesidir**. Reverse traversal (eşleme ve reroute için hayati) doğrudan
  okunur; worker'ın bugün yaptığı gibi ters kenarı **çalışma anında üretmek** gerekmez
  (bu üretim, bugünkü bellek patlamasının yarısıdır).
- **Ayrı `geomDelta`:** geometri ile topoloji ayrılır → arama sırasında geometri
  **hiç dokunulmaz** (cache dostu); yalnız rota kurulurken okunur.
- **`turnTable`:** dönüş kısıtları ve dönüş maliyetleri düğümde değerlendirilir.
  Kenar-genişletilmiş graf (2× bellek) gerekmez. **Bugün dönüş kısıtı hiç yoktur** —
  çevrimdışı rota yasak dönüşler üretebilir; bu, kütüğe girecek açık bir kusurdur.
- **`hierarchyLevel`:** seviye 0 (motorway+trunk, ölçülen 81 112 kenar ≈ %27) tek başına
  uzun mesafe araması için yeterlidir. `MAX_CLOSED = 30 000` tavanı seviye 0'da
  350 km'yi rahat taşır — ADR-N04'ün sayısal kanıtı budur.

### 2.4 `adas` karo formatı — `ADL1` (istasyon tabanlı)

Kenar başına, **10 m sabit aralıklı istasyonlar**:

```
kenar kaydı: u32 edgeLocalIdx · u16 stationCount
istasyon (5 B):
   i8  slopeDp        // %0.5 adım → ±%63.5   (DEM'den türetilir)
   u8  curvIdx        // log-ölçekli yarıçap kovası; 0 = düz, 255 = R<15 m
   u8  speedLimitHalf // km/h / 2 (0..254), 255 = BİLİNMİYOR
   u8  laneAndFlags   // bit0-3 şerit sayısı (0=bilinmiyor) · bit4 tünel
                      // bit5 köprü · bit6 yerleşim · bit7 denetim yakın
   u8  srcMask        // limit kaynağı(2b) · eğim kaynağı(2b) · şerit kaynağı(2b) · rsv(2b)
```

**`srcMask` neden ayrı bir bayt:** `Evidenced<T>`nin veri katmanındaki karşılığıdır.
Bir hız limiti **levhadan** mı (OSM `maxspeed`), **yol sınıfından çıkarım** mı,
yoksa **bilinmiyor** mu — bu, ekrana çıkan bilgiyle birlikte **veride** taşınır.
Kaynağı veride taşımayan bir öznitelik, ürün katmanında dürüst gösterilemez.

**Boyut hesabı:** Türkiye motorway+trunk+primary+secondary ≈ **65 000 km**.
10 m istasyon × 5 B = **500 B/km** → **≈ 32.5 MB**. Kabul edilebilir.

**Eğim kaynağı:** SRTM / Copernicus GLO-30 DEM, **üretim zamanında** örneklenir
(çalışma anında DEM YOKTUR). Lisans permissive → satışa uygun. Eğim `DERIVED`
sınıfıyla yayınlanır — ölçülmüş değildir, türetilmiştir.

### 2.5 Sürümleme, bütünlük, güncelleme

| Konu | Kural |
|------|-------|
| Sürüm | Her katmanın **bağımsız** `dataVersion`'ı vardır. `adas` tazelenirken `graph` sabit kalabilir. |
| Bütünlük | Karo başına `crc32` ZORUNLU. CRC tutmayan karo **yok sayılır**, `coverage` düşer — sessizce kullanılmaz. |
| İmza | Paket manifesti imzalanır (OTA hattı `scripts/publish-ota.mjs` üzerinden). İmzasız paket YÜKLENMEZ. |
| Delta | Karo bazlı: yalnız `dataVersion`'ı değişen karolar iner. |
| Geri alma | Bir önceki paket sürümü cihazda **bir sürüm** boyunca tutulur; yeni paket CRC/imza düşerse otomatik geri dönülür. |
| Uyumsuzluk | `graph.dataVersion` ile `adas.dataVersion` **eşleşmek zorunda değildir**, ama `adas` kenar kimliği `graph` sürümüne bağlıdır → uyumsuzsa `adas` **kullanılmaz** ve `coverage(adas) = NONE`. Sessiz yanlış hizalama YASAK. |

### 2.6 Kapsam (coverage) sözleşmesi — kısmi indirmenin dürüstlüğü

```ts
type Coverage = 'PACKAGED' | 'CACHED' | 'ONLINE_ONLY' | 'NONE';
coverage(kind: MapLayerKind, at: LngLat): Coverage;
```

**ZORUNLU:** Ürün, kapsamı **katman katman** söyler. "İstanbul indirildi" yetmez;
"İstanbul: harita ✅ · rota grafiği ✅ · ADAS ✅ · POI ✅" veya eksikse hangisinin eksik
olduğu görünür. Bugünkü en sinsi arıza sınıfı — indirilen paketin **hiç okunmaması**
(V-07'de ölçülmüştü) — ancak böyle engellenir.

### 2.7 Depolama bütçesi (Türkiye, hesaplanmış)

| Katman | Tahmin | Dayanak |
|--------|--------|---------|
| `graph` (3 seviye, turn table + geometri) | **≈ 12 MB** | 295k kenar × ~27 B + hiyerarşi + dönüş tabloları |
| `adas` | **≈ 33 MB** | 65 000 km × 500 B |
| `poi` | **16.5 MB** | ölçüldü |
| `enforcement` | **< 1 MB** | mevcut paket |
| `render` (vektör z0-14) | **600–800 MB** | sağlayıcıya bağlı — baskın kalem |
| **Toplam** | **≈ 660–860 MB** | v1'deki "< 900 MB" hedefi doğrulandı |

**Sonuç:** navigasyon zekâsının veri maliyeti (graph+adas+poi+enforcement ≈ **62 MB**)
basemap'in yanında **önemsizdir**. Yani "çevrimdışı zekâ" pahalı değil; pahalı olan
**resim**. Bu, ürün kararını netleştirir: **zekâ katmanları her zaman paketlenir**,
basemap kullanıcı seçimidir.

---

## 3. L2 — KONUM MİMARİSİ (Ego)

### 3.1 Durum ve süreç modeli

Nominal durum: `x = [pE, pN, ψ, v, b_ω]ᵀ` (yerel ENU teğet düzlem, metre).

```
ṗE = v · sin ψ
ṗN = v · cos ψ
ψ̇  = ω_meas − b_ω
v̇  = a_long
ḃ_ω = 0                (rastgele yürüyüş, Q ile beslenir)
```

**Yeniden çapalama:** teğet düzlem orijini araç orijinden **> 10 km** uzaklaşınca
yeniden kurulur; kovaryans taşınır, konum yeniden hesaplanır. (float64 hassasiyeti
10 km ölçeğinde mm mertebesindedir — sorun değil; çapalama sayısal değil,
**doğrusallaştırma** hatası içindir.)

### 3.2 Gürültü parametreleri (BAŞLANGIÇ değerleri — kalibre EDİLECEK)

> **Dürüstlük notu:** aşağıdaki sayılar literatür başlangıç değerleridir, **bizim
> sahamızdan ölçülmemiştir.** F2 kabulünün bir parçası, bunların kendi kayıtlarımızdan
> yeniden kestirilmesidir (§10). Kalibrasyon yapılmadan bu tablo "doğru" sayılmaz.

| Parametre | Başlangıç | Not |
|-----------|-----------|-----|
| `σ_a` (boylamsal ivme süreç gürültüsü) | 1.0 m/s² | sürüş; durakta 0.2 |
| `σ_ω` (jiro gürültüsü) | 0.5 °/s | telefon MEMS |
| `σ_bω` (sapma rastgele yürüyüşü) | 0.01 °/s/√s | |
| `R_gnss_pos` | `max(accuracy, 3 m)²` | bildirilen doğruluk ŞİŞİRİLİR |
| `R_gnss_speed` | `(0.5 + 0.05·v)²` | Doppler hızı |
| `R_obd_speed` | `(0.3 m/s)²` × ölçek düzeltmesi | ölçek `vehicleLearningEngine`den |
| `R_zupt` | `(0.05 m/s)²` | OBD hız = 0 iken |
| `R_nhc` (yanal hız ≈ 0) | `(0.10 m/s)²` | holonomik olmayan kısıt |
| `R_map_cross` | `(1.75 m)²` | şerit yarı genişliği; YALNIZ `MATCHED` + güven ≥ τ |

**OBD hız ölçeği — CAROS'a özel:** hız göstergeleri yasal olarak yukarı okur.
Gerçek ölçek faktörü GNSS ile OBD'nin uzun serbest akış pencerelerinde karşılaştırılıp
öğrenilir (`vehicleLearningEngine`). Öğrenilmemişse faktör **1.0 kabul edilir ve
`DERIVED` işaretlenir** — uydurulmaz.

### 3.3 Girdi kapıları (fail-closed)

| Kapı | Kural | Gerekçe (ölçüm) |
|------|-------|------------------|
| Doğruluk tavanı | `accuracy > 50 m` → ölçüm **reddedilir** (yalnız yaş güncellenir) | kütükte p95 doğruluk **7 578 m**, yanal sapma **1 480 m** ölçüldü |
| Mahalanobis | `d² > 9.21` (χ², 2 sdb, %99) → reddedilir, `JUMP_REJECTED` sayılır | tek çöp fix konumu koparmasın |
| Sıçrama | mevcut `isJumpInvalid` korunur | çalışıyor |
| ZUPT | `OBD v == 0` **ve** `|ω| < 2 °/s` → hız ölçümü 0 (yüksek ağırlık) | **hayalet hız** (düzlük oranı 0.089 ölçüldü) burada ölür |
| NHC | her tahmin adımında gövde çerçevesinde yanal hız ≈ 0 | DR yönünü stabilize eder |
| Harita geri beslemesi | `MATCHED` **ve** `confidence ≥ 0.7` **ve** kazanç ≤ 0.2 | **tehlike:** harita pozisyonu çekerse gerçek hata GİZLENİR |

**Harita geri beslemesi tehlikesi — açıkça yazılır:** eşleşmiş konumu filtreye
beslemek konumu "temiz" gösterir ama **hatayı görünmez kılar**; yanlış yola kilitlenme
(map-lock) klasik bir otomotiv arızasıdır. Bu yüzden: ham konum **ASLA kaybolmaz**
(bugünkü `rawLat/rawLon` disiplini korunur), kazanç sınırlıdır ve `MATCH_UNCERTAIN`
durumunda geri besleme **tamamen kapalıdır**.

### 3.4 Eşleme (HMM)

**Aday üretimi:** yarıçap `r = min(200 m, 3σ_h + 25 m)`, en fazla **8 aday**,
`graph` karolarından; adaylar dik mesafeye göre sıralanır.

**Emisyon:**
```
p(z_t | c_i) ∝ exp( − ½ · ( d⊥(z_t, c_i) / σ_z )² )
```

**Geçiş:**
```
d_t = |  ‖z_t − z_{t−1}‖_büyükdaire  −  routeDist(c_i, c_j)  |
p(c_j | c_i) ∝ (1/β) · exp( − d_t / β )
```

**Başlangıç parametreleri:** `σ_z ≈ 4–6 m`, `β` = `medyan(d_t) / ln 2`.
**ZORUNLU:** ikisi de saha kayıtlarından medyan-tabanlı dayanıklı kestiricilerle
yeniden hesaplanır (§10.4). Literatür değeri **üretim değeri sayılmaz.**

**Ek kanıt (bugünkü modelden korunur):** yön uyumu `headingDelta` bir **ceza terimi**
olarak emisyona çarpılır — bölünmüş bulvarda ters şerit ayrımının asıl kaynağı budur
ve HMM'e geçerken kaybedilmesi YASAK.

**Pencere ve yayın:** `W = 10` örnek Viterbi, yayın gecikmesi `L = 2` örnek.
**P8 gereği:** geri düzeltme iç inanca uygulanır; yayınlanmış `EgoPose` akışı
**append-only**dir. Geriye dönük bir değişiklik gerekirse `RELOCALIZED` olayı
yayınlanır — geçmiş yeniden yazılmaz, harita geriye ZIPLAMAZ.

**Kapsam dışı:** `graph` kapsamı yoksa eşleme **denenmez**; durum `OFF_NETWORK`
değil, `coverage: NONE` üzerinden `UNAVAILABLE` yayınlanır. "Yol dışındasın" demekle
"bilmiyorum" demek aynı şey değildir.

### 3.5 Ego mod durum makinesi

| Durum | Giriş koşulu | Çıkış | Yayın |
|-------|--------------|-------|-------|
| `NONE` | fix hiç yok | ilk geçerli fix → `GNSS` | konum yayınlanmaz |
| `GNSS` | geçerli fix ≤ 3 s | fix yaşı > 3 s → `GNSS_DR` | tam güven |
| `GNSS_DR` | fix bayat, hız kaynağı var | fix döner → `GNSS`; 90 s → `DR_ONLY` | `mode` görünür, güven düşer |
| `DR_ONLY` | fix yok, yalnız OBD+IMU | fix döner → `GNSS`; hız kaynağı da giderse → `LAST_KNOWN` | rozet: *ölü hesap* |
| `MAP_SNAPPED` | `GNSS`/`GNSS_DR` + `MATCHED` & güven ≥ 0.7 | eşleme düşerse alt duruma | ham konum ayrıca taşınır |
| `LAST_KNOWN` | hiçbir canlı kaynak yok | fix döner | **rehberlik DURDURULUR** (`NO_POSITION`) |

**ZORUNLU invaryantlar:**
- `DR_ONLY` süresi **90 s** ile sınırlıdır. Aşınca `LAST_KNOWN`. Sınırsız DR,
  sürücüye var olmayan bir konum göstermektir.
- `mode` her `EgoPose` ile yayınlanır; hiçbir tüketici modu **varsayamaz**.
- `confidence`, `LAST_KNOWN`/`NONE` durumlarında **> 0.3 olamaz**.

### 3.6 Ego gecikme bütçesi

| Aşama | Bütçe |
|-------|-------|
| Native fix → köprü | 20 ms |
| Köprü → `EgoRuntime` | 5 ms |
| Kapılar + EKF güncelleme | 3 ms |
| HMM pencere güncelleme (8 aday × 10 örnek) | 6 ms |
| **Fix → `EgoPose` yayını** | **≤ 34 ms** |

---

## 4. L3 — UFUK MİMARİSİ (CEH)

### 4.1 Bellek düzeni — dizi-yapısı (SoA), çift tamponlu

```
HorizonBuffers (önceden ayrılmış, ASLA yeniden ayrılmaz):
  Float64Array  stationOffsetM [S_MAX]   // ego'dan yol-boyu mesafe
  Float64Array  stationLat     [S_MAX]
  Float64Array  stationLon     [S_MAX]
  Int8Array     slopeDp        [S_MAX]
  Uint8Array    curvIdx        [S_MAX]
  Uint8Array    speedLimitHalf [S_MAX]
  Uint8Array    laneAndFlags   [S_MAX]
  Uint8Array    srcMask        [S_MAX]
  Uint16Array   trafficAndTtl  [S_MAX]
  Int16Array    projCoolantC   [S_MAX]   // ★ araç projeksiyonu
  Uint8Array    projBrakeLoad  [S_MAX]
  Int16Array    projFuelPctE1  [S_MAX]
```

`S_MAX = 2 000` istasyon (10 m × 2 000 = **20 km ufuk tavanı**).
Bayt: 2 000 × (8+8+8+1+1+1+1+1+2+2+1+2) ≈ **72 KB** × 2 tampon = **≈ 144 KB**.
İhmal edilebilir. **ZORUNLU:** tampon çalışma anında yeniden ayrılmaz (GC baskısı sıfır,
V8 gizli sınıf kararlı — CLAUDE.md §Zero-Allocation Hot-Paths).

### 4.2 Ufuk protokolü ve revizyon semantiği

```ts
interface HorizonSnapshot {
  readonly revision: number;      // monoton; SADECE içerik değişince artar
  readonly tsMonoMs: number;
  readonly ego: EgoPose;
  readonly stationCount: number;
  readonly aheadM: number;
  readonly coverage: 'PACKAGED' | 'CACHED' | 'ROUTE_ONLY' | 'NONE';
  readonly degradation: NavDegradation;
  readonly branches: readonly HorizonBranch[];   // en fazla 4
  readonly buffers: HorizonBuffers;              // salt-okunur görünüm
}
```

**Revizyon kuralları (ZORUNLU):**
- Ego ilerledi ama profiller aynı → revizyon **artar** (istasyon kayması gerçektir).
- Yalnız `tsMonoMs` değişti, içerik aynı → revizyon **artmaz**.
- Tüketici `revision` değişmedikçe **yeniden hesaplamaz**. Bu, ufkun sekiz tüketicisinin
  CPU maliyetini sabitleyen tek mekanizmadır.

**Sürümleme:** `HORIZON_PROTOCOL_VERSION` sabiti. Tüketiciler sürümü okur; uyumsuz
sürümde **kendilerini kapatır** (`UNAVAILABLE`), tahmin yürütmez.

### 4.3 MPP üretimi

**Rehberlik aktifken:** MPP = aktif rota geometrisi. Uzunluk `max(1 500 m, v · 90 s)`.
Dallar = kavşaklarda rotadan ayrılan kenarlar (sapma erken tespiti için).

**Serbest sürüşte (free-drive) — bugün HİÇ YOK:** her kavşakta bir sonraki kenar
olasılığı:

```
score(e) =  w_class · classContinuity(e_prev, e)
          + w_angle · (1 − |Δaçı| / 180°)
          + w_learn · driverPrior(e)          // öğrenilmişse; yoksa 0 ve DERIVED
p(e) = softmax(score)
```
MPP = en yüksek olasılıklı zincir; `p < 0.55` düşerse ufuk **orada kesilir**
(belirsiz kavşaktan sonrasını iddia etmeyiz). Uzunluk `max(800 m, v · 45 s)`.

**Serbest sürüş ufkunun ürün anlamı:** kullanıcı rota başlatmadan da hız limiti,
viraj uyarısı, denetim noktası uyarısı, tünel ön-bildirimi ve menzil tahmini alır.
Bu, bugün **yapılamayan** şeydir ve ürünün karakterini değiştirir.

### 4.4 Profil üretimi

**Viraj (curvature):** MPP 10 m'de yeniden örneklenir; Menger eğriliği
```
κ_i = 4·A(P_{i−1}, P_i, P_{i+1}) / (|P_{i−1}P_i| · |P_iP_{i+1}| · |P_{i−1}P_{i+1}|)
```
3-nokta medyan + 30 m hareketli ortalama ile yumuşatılır. `R = 1/κ`, `[15, 5 000] m`
aralığına kırpılır. **Kaynak `adas` katmanıdır**; `adas` yoksa MPP geometrisinden
`DERIVED` olarak türetilir ve **100 m sadeleştirme uyarısıyla** düşük güven taşır
(§2.1/3 — geometri çözünürlüğü sınırı).

**Güvenli viraj hızı (Guardian girdisi):**
```
v_safe = min( √(μ_eff · g · R) ,  √(a_lat_konfor · R) )
μ_eff : kuru 0.70 · ıslak 0.40 · buzlu 0.15   (weatherAdapter KANITINDAN; kanıt yoksa kural ÇALIŞMAZ)
a_lat_konfor = 2.0 m/s²
```

**Eğim:** `adas.slopeDp`. Yoksa profil `UNAVAILABLE` — **barometreden veya GNSS
yüksekliğinden türetilmez** (GNSS düşey hatası yatayın 2-3 katıdır; %8 rampa ile
%0 rampayı ayırt edemez → uydurma olur).

**Hız limiti:** `adas.speedLimitHalf` + `srcMask`. Overpass **çalışma anında
çağrılmaz** (ADR-N01). Overpass yalnız **paket üretim zamanı** kaynaktır.

**Trafik:** `dynamic` katmanı, TTL'li. TTL dolunca istasyon `STALE`.
Anahtar yoksa profil boş + `NO_TRAFFIC`.

### 4.5 ★ VehicleProjection — mimarinin OEM üstü kısmı

Her istasyonda, o noktaya varıldığında aracın öngörülen durumu:

**Termal projeksiyon (basitleştirilmiş, kanıt kapılı):**
```
P_motor(s) ≈ m·g·(sinθ(s) + c_rr·cosθ(s))·v(s) + ½·ρ·Cd·A·v(s)³
ΔT(s)      ≈ ∫ (P_motor(s)·(1−η) − Q_soğutma(T)) / C_termal  ds/v(s)
coolantC(s) = T_şimdi + ΔT(s)
```
**Kanıt kapısı (ZORUNLU):** `m` (kütle), `Cd·A`, `η` ve `C_termal` **bu araç için
bilinmiyorsa** projeksiyon **üretilmez** — `UNAVAILABLE` döner. Marka/model profilinden
gelen değerler `DERIVED`, öğrenilmiş değerler `OBSERVED` işaretlenir.
**Sınıf ortalamasıyla uydurma sayı üretmek YASAKTIR.**

**Fren termal yükü:** iniş boyunca hız sabit tutulacaksa fren gücü
`P_fren(s) = m·g·|sinθ(s)|·v − P_motor_freni`; kümülatif enerji fren kütlesine
bölünüp normalize edilir (0..1). Motor freni katkısı bilinmiyorsa **sıfır kabul
edilmez** — projeksiyon `UNAVAILABLE` olur (kötümser tarafa kaçmak, yanlış güven
vermekten iyidir; ama "kötümser" bile kanıtsız üretilmez).

**Yakıt / SoC:** tüketim modeli × eğim × hız profili; menzilin biteceği ofset
`rangeRiskAt`. Girdi `UnifiedVehicleStore` + `vehicleLearningEngine`.

**Bütçe:** projeksiyon **güvenlik-kritik DEĞİLDİR** → `SAFE_MODE`'da kapalıdır
(§8.5). Hesap yalnız her N. istasyonda (varsayılan her 10. = 100 m) yapılır ve
aradakiler doğrusal ara değerlenir.

### 4.6 Ufuk yaşam döngüsü ve geçersizleştirme

| Olay | Etki |
|------|------|
| Ego ilerledi (< 50 m) | **artımlı**: arkadan kırp, önden uzat |
| Ego atladı (> 50 m) veya `RELOCALIZED` | ufuk **tamamen** yeniden kurulur |
| Rota değişti / reroute uygulandı | MPP değişir → tam yeniden kurulum |
| Karo yüklendi | etkilenen istasyon aralığı yeniden doldurulur |
| Trafik TTL doldu | yalnız `traffic` profili `STALE` |
| Kapsam kaybı | `coverage` düşer, ufuk **kısalır** — sahte uzatma YASAK |

**ZORUNLU:** ufuk **hiçbir koşulda** kapsam dışını "düz devam eder" diye uzatmaz.
Bilinmeyen, kısa ufuktur; uzun ufuk değildir.

### 4.7 Ufuk bütçesi

| Tier | Tick | Bütçe/tick | Projeksiyon |
|------|------|-----------|-------------|
| HIGH | 2 Hz | 8 ms | 1 Hz |
| BALANCED | 1 Hz | 8 ms | 0.5 Hz |
| BASIC_JS | 0.5 Hz | 6 ms | 0.2 Hz |
| SAFE_MODE | 0.2 Hz | 4 ms | **kapalı** |

**ZORUNLU:** ufuk **güvenlik-kritiktir** — hiçbir tier'da tamamen kapanmaz.
Kapanan yalnız `VehicleProjection`dır.
---

## 5. L4 — ROTA MİMARİSİ

### 5.1 Onboard yönlendirici

**Algoritma:** hiyerarşik A\*, düğüm geçişlerinde dönüş maliyeti/kısıtı değerlendiren,
CSR grafiği üzerinde çalışan ikili min-yığın araması (bugünkü yığın korunur).

**Hiyerarşi kullanımı (yukarı-aşağı sızma):**
```
1. Başlangıç ve hedef, seviye 2 (yerel) üzerinde en yakın kenara bağlanır.
2. Arama seviye 2'de yalnız R_up = 3 km yarıçapında ilerler; sonra seviye 1'e çıkar.
3. Seviye 1'de R_up2 = 15 km; sonra seviye 0 (motorway+trunk).
4. Hedef tarafında ayna simetrik iniş.
5. Rota uzunluğu < 10 km ise hiyerarşi KULLANILMAZ (düz arama daha doğru).
```
**Ölçülmüş dayanak:** seviye 0'da bugün **81 112 kenar** vardır (motorway 8 013 +
trunk 73 099). `MAX_CLOSED = 30 000` tavanı bu seviyede 350 km'yi rahatlıkla taşır;
düz aramada 238 252 düğüm üzerinde taşımıyordu.

**Sezgisel:** `h(n) = d_büyükdaire(n, hedef) / v_max`, `v_max = 130 km/h` (motorway).
**ZORUNLU:** `v_max` gerçekte ulaşılabilir azami hızdan **büyük veya eşit** olmalıdır;
küçük seçilirse sezgisel fazla tahmin eder ve A\* **yanlış rota** verir.

**Dönüş kısıtları:** `turnTable` + `turnCost`. `turnCost = 255` → geçiş yasak.
**Bugün dönüş kısıtı YOKTUR** → çevrimdışı rota yasak dönüş üretebilir.
Bu, kütüğe girecek **açık ve bilinen** bir kusurdur (§12, F4-K3).

### 5.2 Maliyet modeli

```
cost(e) = t_serbest(e) · Π mᵢ ,   t_serbest(e) = len(e) / v_sınıf(e)
```

**ZORUNLU INVARYANT (ADR-N04):** her `mᵢ ≥ 1.0`. Tercih "ödül" ile değil,
**rakibi cezalandırarak** ifade edilir. Bu invaryant A\* kabul edilebilirliğini korur.

| Çarpan | Koşul | Değer | Kanıt gereksinimi |
|--------|-------|-------|-------------------|
| `m_traffic` | trafik dilimi var | `t_gerçek / t_serbest` (≥ 1) | `dynamic` katmanı `OBSERVED` |
| `m_thermal` | `thermalRisk > 0.6` ∧ eğim > %6 | `1 + 2·risk` | soğutma sinyali `OBSERVED` |
| `m_brake` | `BRAKE_WEAR` ∧ eğim < −%6 | `1 + 1.5` | aşınma kanıtı `OBSERVED`/`DERIVED` |
| `m_pref_hw` | sürücü otoyol sevmiyor | otoyol dışına DEĞİL, **otoyola** `×1.15` uygulanmaz — sevmediğinde otoyol `×1.15` | `driverDNA` `OBSERVED` |
| `m_avoid` | kullanıcı "ücretli/feribot/otoyol kaçın" dedi | `×4.0` (yumuşak kaçınma) veya erişim kapalı (sert) | kullanıcı tercihi |
| `m_unpaved` | yüzey kanıtı var ve araç profili uygun değil | `×2.0` | `adas` yüzey biti |

**ZORUNLU:** ilgili kanıt `UNAVAILABLE` ise çarpan **1.0'dır** (kural devreye girmez).
Bu, "zero-trust telemetry" ilkesinin maliyet fonksiyonundaki karşılığıdır ve
**kilit testiyle** korunur: bilinmeyen araçta çıkan rota, sabit maliyetli rotayla
**birebir aynı** olmak zorundadır.

**Determinizm:** `CostContext` bir **anlık görüntüdür**; arama süresince değişmez.
Aynı `(grafikSürümü, başlangıç, hedef, CostContext)` üçlüsü **her zaman aynı rotayı**
üretir. Bu, replay testinin (§10.2) ön koşuludur.

### 5.3 Sağlayıcı arbitrajı

```
İSTEK
 ├─ coverage(graph) ∈ {PACKAGED, CACHED} ?
 │     EVET → onboard hesapla → SUN (hedef p50 < 800 ms)
 │             └─ paralel: çevrimiçi iste (varsa) → TEKLİF olarak sakla
 │     HAYIR → çevrimiçi iste
 │             ├─ başarı → SUN
 │             └─ hata/ağ yok → NO_MAP_DATA → düz hat (etiketli) 
 └─ L0 yerel daemon yolu: KALDIRILDI (ADR-N02)
```

**ZORUNLU:** çevrimiçi sonuç aktif rotayı **sessizce değiştiremez**.
Yalnız şu koşulda teklif edilir: `Δsüre ≥ max(120 s, %8)` **ve** rehberlik
manevraya `T-20s`den uzak **ve** dikkat bütçesi müsait.

### 5.4 Reroute durum makinesi

| Durum | Giriş | Çıkış | Koruma |
|-------|-------|-------|--------|
| `ON_ROUTE` | eşleşme `MATCHED`, sapma < eşik | sapma kanıtı birikince → `SUSPECT` | — |
| `SUSPECT` | dik mesafe > `55 m` **veya** yön ters | kanıt penceresi dolarsa → `REROUTING`; düzelirse → `ON_ROUTE` | **tek örnek reroute tetikleyemez** |
| `REROUTING` | istek gönderildi | yanıt uygulandı → `ON_ROUTE`; zaman aşımı → `STARVED` | hıza bağlı throttle 5/10/15 s korunur |
| `STARVED` | ardışık başarısız istek | başarı → `ON_ROUTE` | kullanıcıya söylenir; sessiz kalmaz |

**ZORUNLU yeni kapılar:**
- `coverage(graph) = NONE` iken `OFF_NETWORK` **reroute tetiklemez** (bugünkü en sinsi
  yanlış-pozitif kaynağı: kapsam dışında olmayı yoldan çıkmak sanmak).
- `MATCH_UNCERTAIN` iken reroute **tetiklenmez**; belirsizlikten karar üretilmez.
- `EgoPose.mode ∈ {DR_ONLY, LAST_KNOWN}` iken reroute **tetiklenmez**.

### 5.5 "Neden bu rota?" sözleşmesi

Her rota, karşılaştırılabilir bir gerekçe taşır (LAB'da ve gerekirse kullanıcıya):

```ts
interface RouteRationale {
  readonly chosenIdx: number;
  readonly candidates: readonly {
    distanceM: number; durationS: number;
    climbM: number; tollLikely: boolean;
    appliedMultipliers: readonly { id: string; value: number; evidence: EvidenceGrade }[];
  }[];
  readonly decidingFactor: 'DURATION' | 'VEHICLE_THERMAL' | 'VEHICLE_RANGE'
                         | 'USER_AVOID' | 'DRIVER_PREF' | 'ONLY_OPTION';
}
```
**Neden ZORUNLU:** araç-farkında maliyet, kullanıcıya "neden uzun rota seçtin?"
sorusunu doğurur. Cevabı olmayan zekâ, kullanıcı için arızadır.

---

## 6. L5 — REHBERLİK

### 6.1 Manevra mesafesi

**ZORUNLU:** mesafe daima yol-boyu. Ufuk sonrası `STRAIGHT_LINE` üretimi **kusur
sayılır** (bugün dürüst bir etiket; F3 sonrası bir hata). Kilit test: ufuk `PACKAGED`
iken `ManeuverDistanceSource === 'ALONG_ROUTE'`.

### 6.2 Ses zamanlaması

```
T(s) = alongDistToManeuver / v_pred ,  v_pred = clamp(EMA(v), 3 m/s, v_limit)
kademeler: T-60s · T-25s · T-8s
alt sınır : d_min = v · 2 s + 15 m   (tepki mesafesi — bundan yakında YENİ anons YOK)
```
Kademe başına tek anons (bitmask korunur). Ducking + `__SAFETY_LOCK__` korunur.
Düşük hızda (v < 3 m/s) mesafe tabanına düşülür (200 m / 80 m / 25 m).

### 6.3 Şerit ve kavşak

- Gerçek şerit (`intersections[].lanes`) varsa **şerit oku** çizilir.
- `adas.laneCount` yalnız **şerit sayısı**dır; "hangi şeritte olmalıyım" DEĞİLDİR.
  İkisi **ayrı** gösterilir; birleştirilerek "gerçek şerit rehberi" izlenimi
  verilmesi YASAKTIR.
- Kavşak görünümü (junction view): **F5+**, gerçek veri olmadan üretilmez.

### 6.4 ETA bileşimi

```ts
etaSeconds = routeBaseS + trafficDeltaS + learnedDeltaS + stopBufferS
```
Her bileşen `Evidenced`. Durum: `FIRM` (trafik `OBSERVED`) · `SOFT` (yalnız statik)
· `UNKNOWN` (rota süresi güvenilmez). Mevcut `etaJumpLedger` + histerezis +
hız kapısı rampası **korunur**; yeni olan yalnız **bileşen ayrıştırması**.

**Neden ayrıştırma:** kütükte "ETA tek yerde hesaplanıyor ama dört yüzeyde farklı
güven kuralıyla gösteriliyordu" (P0-NAV-14) ve "G3 ETA sıçraması" maddeleri var.
Bileşen taşınmadan "ETA neden atladı?" sorusu **cevaplanamaz**.

---

## 7. L6 — ARBİTRAJ VE HMI GÜVENLİĞİ

### 7.1 Guardian girdisi değişir, motoru değişmez

Saf motor, dedupe (en yüksek severity kazanır), sıralama ve tick politikası **korunur**.
Tek değişiklik: adaptörler `HorizonSnapshot` okur, kendi kaynaklarını çağırmaz (ADR-N01).

### 7.2 Dikkat bütçesi

**Zemin:** NHTSA görsel-manuel kılavuzu — tek bakış ≤ **2 s**, toplam görev ≤ **12 s**.
Bu bir navigasyon standardı değildir ama **ölçülebilir bir tavan** verir ve
"sürücüyü ne kadar meşgul edebiliriz" sorusunun tek nesnel cevabıdır.

```ts
interface AttentionBudget {
  maxInterruptsPerMin: 3;       // CRITICAL hariç
  minGapMs: 8_000;
  suppressWithinManeuverMs: 8_000;   // T-8s içinde kritik olmayan susar
  suppressWhileRerouting: true;
}
```

**Sürüşte görünen yüzey kuralı (ZORUNLU):** tek bakışta okunması gereken yüzey
**en fazla 3 bilgi öbeği** taşır (ör. manevra oku + mesafe + sokak adı).
Dördüncü öbek eklemek, 2 s bakış bütçesini aşma riskidir ve PR'da gerekçe ister.

### 7.3 Öncelik matrisi (tek hakem)

| Sınıf | Örnek | Bastırılabilir mi |
|-------|-------|-------------------|
| `CRITICAL_SAFETY` | aşırı ısınma, yağ basıncı, çarpışma riski | **HAYIR** — her zaman geçer |
| `GUIDANCE` | manevra anonsu | yalnız `CRITICAL_SAFETY` tarafından |
| `ADVISORY` | viraj, hız limiti, denetim noktası | evet (bütçe + manevra penceresi) |
| `INFORMATIONAL` | Mavi açıklaması, öneri | evet, en önce feda edilir |

**ZORUNLU:** bu matris **tek yerde** yaşar ve ses, bildirim, Guardian ve Mavi
onu kullanır. Bugün tek hakem `__SAFETY_LOCK__`tir ve **sayılabilir değildir**.

---

## 8. EŞZAMANLILIK, GECİKME VE BELLEK

### 8.1 İş parçacığı sahipliği

| İş parçacığı | Sahip olduğu | Sahip OLMADIĞI |
|--------------|--------------|----------------|
| **Ana** | React, MapLibre çizimi, `EgoRuntime`, `HorizonProvider`, rehberlik, Guardian | ağır rota araması, ağır binary ayrıştırma |
| `nav-route.worker` | onboard A\*, `graph` karo ayrıştırma | hiçbir ürün durumu — yalnız istek/yanıt |
| `VehicleCompute.worker` | mevcut araç sinyal işleme | değişmez |
| `nav-core.worker` | **ERTELENDİ** (ADR-N11) | tetikleyici: long task > 50 ms |

**Sıcak-yol kuralları (CLAUDE.md §V8 aynen):** önceden ayrılmış zarf nesneleri,
şablon literal (dinamik alan ekleme yok), `delete` yasak, tip değiştirme yasak.

### 8.2 Uçtan uca gecikme bütçesi

| Aşama | Bütçe | Kaynak |
|-------|-------|--------|
| Native fix → köprü | 20 ms | platform |
| Köprü → `EgoRuntime` | 5 ms | |
| Kapılar + EKF | 3 ms | §3.6 |
| HMM pencere | 6 ms | §3.6 |
| Ufuk artımlı ilerletme | 8 ms | §4.7 |
| Rehberlik + ETA | 2 ms | |
| Guardian | 4 ms | mevcut 1 Hz bütçesi |
| Store yayını → React commit | 16 ms | 1 kare |
| Harita boyama | 33 ms | 30 fps |
| **Fix → piksel** | **≤ 97 ms** (sert tavan **150 ms**) | |
| Ufuk → TTS başlangıcı | **≤ 250 ms** | |
| Onboard rota (50 km) | **p50 < 800 ms · p95 < 3 s** | F4 kabulü |
| Çevrimiçi rota | p50 < 1.2 s | mevcut ölçüm |

### 8.3 Bellek bütçesi

| Kalem | Bütçe | Not |
|-------|-------|-----|
| Yerleşik `graph` karoları (aktif koridor ~12 karo) | **≤ 6 MB** | karo başına ~40 KB × 12 + hiyerarşi |
| Yerleşik `adas` karoları | **≤ 4 MB** | |
| Ufuk tamponları (çift) | **≈ 0.15 MB** | §4.1 |
| Aktif rota geometrisi + adımlar | ≤ 2 MB | |
| `nav-route.worker` yığını | ≤ 24 MB (`SAFE_MODE` ≤ 12 MB) | |
| **Navigasyon toplam (render hariç)** | **≤ 36 MB** | |
| Bugünkü monolit (TÜRETİLDİ, ölçülmedi) | **≈ 50–70 MB** | §ADR-N03 |

**Karo tahliyesi:** LRU, ego'dan uzaklığa göre; aktif rota koridorundaki karolar
**kilitlidir** (tahliye edilmez) — rota ortasında grafik kaybı YASAK.

### 8.4 Geri basınç (backpressure)

| Durum | Davranış |
|-------|----------|
| Ufuk tick'i bütçeyi aştı | bir sonraki tick **atlanır**, sayaç LAB'a yazılır — kuyruk BÜYÜTÜLMEZ |
| Karo isteği kuyruğu > 32 | en uzak istekler düşürülür, `coverage` düşer |
| Rota worker meşgul | yeni istek **eskiyi iptal eder** (tek aktif istek — mevcut `routeRequestLedger` kuralı) |
| GPS fix kadansı bütçeden hızlı | fix'ler **birleştirilir** (son fix kazanır), sıraya alınmaz |

**ZORUNLU:** hiçbir navigasyon kuyruğu sınırsız büyümez. Sınırsız kuyruk,
düşük-uç donanımda gecikmeyi saatlere taşır ve "geçmişten gelen konum" gösterir.
---

## 9. BOZULMA, FMEA VE GÜVENLİK

### 9.1 Bozulma matrisi (bağlayıcı — her satırın "susan iddia" sütunu ZORUNLU)

| Kayıp | Seviye | Çalışan | **SUSAN iddia** | Kullanıcıya |
|-------|:------:|---------|------------------|-------------|
| Trafik anahtarı yok | `NO_TRAFFIC` | rota · ETA(statik) · rehberlik | "gerçek zamanlı trafik", `FIRM` ETA | ETA rozeti *tahmini* |
| İnternet yok, paket VAR | `NO_NETWORK` | **tam navigasyon** + ufuk | trafik · canlı arama · rota teklifi | "çevrimdışı harita" |
| İnternet yok, paket YOK | `NO_MAP_DATA` | pusula · kayıtlı POI | **rota · manevra · hız limiti · viraj** | "bu bölge için paket yok" |
| `graph` var, `adas` yok/uyumsuz | `FULL` ama `adas: NONE` | rota · manevra | **hız limiti · viraj · eğim · şerit sayısı** | sessiz (iddia zaten yok) |
| GNSS yok, hız kaynağı VAR | `FULL` (DR) | rehberlik ≤ 90 s | — | rozet *ölü hesap* |
| GNSS yok, hız kaynağı YOK | `NO_POSITION` | harita gösterimi | **rehberlik DURUR** | "konum yok — rehberlik durduruldu" |
| Kapsam dışına çıkıldı | ufuk `ROUTE_ONLY` | rota rehberliği | serbest sürüş uyarıları | sessiz |
| Ufuk üretilemedi | `coverage: NONE` | rota varsa rehberlik | **tüm ufuk-türevli uyarılar** | LAB `UNAVAILABLE` |
| Araç profili bilinmiyor | `FULL` | rota (sabit maliyet) | **araç-farkında rota gerekçesi** | "araç profili öğrenilmedi" |
| Ufuk protokol sürümü uyumsuz | — | rota · ego | **tüm ufuk tüketicileri kapanır** | LAB `UNAVAILABLE` |

### 9.2 FMEA — navigasyon hata modu ve etki analizi

| # | Bileşen | Hata modu | Etki | Tespit | Azaltma | Şiddet |
|---|---------|-----------|------|--------|---------|:------:|
| F01 | GNSS | Çöp fix (doğruluk 7.5 km — ÖLÇÜLDÜ) | Konum kopar, sahte reroute | doğruluk kapısı + Mahalanobis | ölçüm reddi, `JUMP_REJECTED` sayacı | **Yüksek** |
| F02 | GNSS | Durakta hayalet hız (düzlük 0.089 — ÖLÇÜLDÜ) | Sahte hareket, sahte sapma | ZUPT + OBD hız çapraz kontrolü | ZUPT ölçümü, hız otoritesi OBD | **Yüksek** |
| F03 | IMU | Jiro sapma sürüklenmesi | Tünelde yön kayar, konum yanlış yöne | sapma durumu kovaryansı | EKF'te `b_ω` durumu, DR 90 s tavanı | **Yüksek** |
| F04 | Eşleme | Ters şeride kilitlenme | Yanlış yol tarifi | yön ceza terimi + `headingDelta` | HMM + `MATCH_UNCERTAIN` fail-closed | **Kritik** |
| F05 | Eşleme | Harita geri beslemesi hatayı gizler (map-lock) | Yanlış konumda "yüksek güven" | ham vs eşleşmiş ayrımı, LAB'da dik mesafe | kazanç ≤ 0.2, belirsizde kapalı, ham korunur | **Yüksek** |
| F06 | Ufuk | Kapsam dışını "düz devam" sanmak | Var olmayan yol için uyarı | `coverage` denetimi | ufuk kısalır, uzatma YASAK | Orta |
| F07 | Ufuk | Protokol sürüm uyumsuzluğu | Tüketiciler çöp okur | sürüm alanı | tüketici kendini kapatır | Orta |
| F08 | `adas` | `graph` ile sürüm uyumsuzluğu → kenar kimliği kayması | **Yanlış yola yanlış hız limiti** | sürüm çapraz denetimi | `adas` kullanılmaz, `coverage: NONE` | **Kritik** |
| F09 | Rota | Dönüş kısıtı yok (BUGÜN GEÇERLİ) | Yasak dönüş içeren rota | — (bugün tespit YOK) | `turnTable` (F4); o zamana kadar kütükte açık kusur | **Yüksek** |
| F10 | Rota | Sezgisel fazla tahmin (çarpan < 1.0) | A\* yanlış rota döner | kilit test: tüm çarpanlar ≥ 1.0 | invaryant + test | **Yüksek** |
| F11 | Rota | Uzun rotada `MAX_CLOSED` tavanı | Rota HİÇ üretilmez | worker `null` döner | hiyerarşi (F4) | **Yüksek** |
| F12 | Rota | Çevrimiçi sonucun sessiz devralması | Sürücü rota değişimini anlamaz | `routeProviderLedger` | teklif mekanizması, sessiz değişim YASAK | Orta |
| F13 | Trafik | Bayat trafikle `FIRM` ETA | Yanlış güvenle geç kalma | TTL | TTL dolunca `STALE`, `SOFT`'a düşer | Orta |
| F14 | Projeksiyon | Kanıtsız termal tahmin | Yanlış öneri, güven kaybı | kanıt kapısı | parametre yoksa `UNAVAILABLE` | **Yüksek** |
| F15 | Ses | Anons sahibinin görünümde olması | Tam ekran kapanınca ses susar | mevcut kütük #377/DELIVERY_CORE | sahiplik `voiceGuidanceRuntime` | **Yüksek** |
| F16 | Arbitraj | Uyarı yağmuru | Sürücü dikkati dağılır, uyarıları yok sayar | dikkat bütçesi sayacı | ≤ 3/dk, 8 s boşluk | **Yüksek** |
| F17 | Depolama | Paket sürüm damgası değişimi (V-07) | İndirilen karo hiç okunmaz | `coverage` + manifest denetimi | `packVersion` mührü, kullanıcıya bildirim | Orta |
| F18 | Depolama | Bozuk karo | Rastgele yanlış geometri | `crc32` | karo yok sayılır | Orta |
| F19 | Runtime | Kuyruk büyümesi | "Geçmişten gelen" konum | tick atlama sayacı | geri basınç (§8.4) | Orta |
| F20 | Lisans | OSM karo sunucusundan ticari kullanım | **Satış engeli** | satış öncesi denetim | `MapStore.render` tek nokta | **Kritik (ticari)** |

### 9.3 Güvenlik ve gizlilik

**Tehdit modeli — navigasyona özgü varlıklar:**

| Varlık | Sınıf | Kural |
|--------|-------|-------|
| Hedef adresi | **PII (ev adresi)** | Cihazda kalır. LAB'a **TAŞINMAZ**. Loglara yazılmaz. |
| Ham koordinat izi | **PII (hareket profili)** | LAB'a taşınmaz; yalnız yaş/doğruluk/dik mesafe. Saha kaydı ayrı rejimdedir (§10.1). |
| VIN | **PII** | Navigasyon zincirinde hiç bulunmaz. |
| BYOK anahtarları | Sır | `sensitiveKeyStore`; LAB'da yalnız VAR/YOK. |
| Rota geometrisi | Türev PII | LAB'a taşınmaz; ekranda çizilir. |

**Dışarı çıkan veri envanteri (ZORUNLU — tam liste):**
1. Rota isteği koordinatları → OSRM sunucusu (çevrimiçi yolda). *Azaltma:* onboard-öncelik
   (ADR-N02) bu isteği kapsam varsa **hiç yapmaz**.
2. Trafik sorgusu konumu → HERE/TomTom (BYOK). *Azaltma:* ızgaraya yuvarlama.
3. Geocoding sorgusu → Nominatim/BYOK sağlayıcı. *Azaltma:* cihaz-içi POI önce.
4. Karo istekleri → karo sağlayıcısı.

**Başka hiçbir navigasyon verisi cihazı terk etmez.** Bu liste büyürse belge güncellenir;
listelenmemiş bir dış çağrı eklemek **mimari ihlalidir**.

---

## 10. DOĞRULAMA MİMARİSİ (bu bölüm mimarinin yarısıdır)

> **İlke:** Navigasyonun gerçek arızaları birim testle yakalanmaz. Sahada bir kez
> görülür, sonra kaybolur. Kayıt + deterministik tekrar, o tek olayı **kalıcı bir
> kilide** dönüştürmenin tek yoludur.

### 10.1 İz (trace) formatı — iki rejim

**Rejim A — `raw` (yalnız cihazda, repoya ASLA girmez):**
JSONL, örnek başına: monotonik damga · ham GNSS (enlem/boylam/doğruluk/hız/yön) ·
IMU (ω, a) · OBD hız · rota kimliği + revizyon · ufuk revizyonu · yayılan kararlar.
Mevcut `scripts/nav-field-record.mjs` bu rejimdedir ve başlığında **"çıktı HAM
KOORDİNAT içerir, kişisel veridir"** uyarısı zaten vardır.

**Rejim B — `derived` (repoda tutulan altın koşular):**
Koordinatlar, **koşuya özel rastgele bir orijine** göre yerel teğet düzlem
ofsetlerine (metre) çevrilir. Geometri, hız, yön, eğrilik **birebir korunur**;
dünya üzerindeki yer **yok edilir**. `graph` kenar kimlikleri, sahte bir yerel
grafiğe yeniden eşlenir.

**ZORUNLU:** repoda `raw` iz bulunması YASAKTIR (`.gitignore` + kilit test:
`field-runs/` dizini commit'te olamaz).

### 10.2 Deterministik tekrar motoru

**Sözleşme:** L2-L6'nın tüm saf modelleri `(girdi, nowMs) → çıktı` biçimindedir.
Tekrar motoru izi sırayla besler ve çıktı akışını toplar.

**ZORUNLU garanti:** aynı iz + aynı kod → **bit-aynı çıktı akışı**.
Bu garantiyi kıran her şey mimari ihlalidir:
- `Date.now()` kullanımı (ADR-N09 zaten yasaklıyor)
- `Math.random()` (tohumsuz)
- `Map`/`Set` yineleme sırasına bağlı karar
- kayan nokta toplamının platforma bağlı sırası (toplamalar sabit sırada yapılır)

**Ne test edilir (çıktı akışı):** `EgoPose` dizisi · `MapMatchState/Reason` geçişleri ·
`HorizonSnapshot.revision` + profil özetleri · reroute FSM geçişleri · anons olayları ·
Guardian olayları · ETA bileşenleri.

### 10.3 Altın koşu korpusu

| Koşu | Ne kanıtlar | Kabul |
|------|-------------|-------|
| `G01-tunnel` | ≥ 600 m tünel, GNSS kesik | çıkışta yanal hata < 25 m; `DR_ONLY` süresi < 90 s |
| `G02-dual-carriageway` | Bölünmüş bulvar, karşı şerit 20 m | ters şerit eşleme **0** |
| `G03-parked-noise` | Park, 10 dk, çöp fix | bildirilen hız **0**; reroute **0** |
| `G04-roundabout` | Dönel kavşak, çok çıkışlı | doğru çıkış anonsu; sahte sapma yok |
| `G05-reroute` | Kasıtlı sapma | `SUSPECT→REROUTING→ON_ROUTE`; salınım yok |
| `G06-no-coverage` | Kapsam dışına çıkış | `ROUTE_ONLY`; sahte uyarı yok; reroute yok |
| `G07-airplane` | Uçak modu, paket var | onboard rota üretilir; ufuk `PACKAGED` |
| `G08-garbage-fix` | p95 7.5 km doğruluk enjeksiyonu | konum kopmaz; `JUMP_REJECTED` artar |
| `G09-long-route` | 350 km şehirlerarası | rota üretilir (bugün tavana çarpıyor) |
| `G10-thermal` | Rampalı rota + yüksek termal risk | `m_thermal` uygulanır; gerekçe LAB'da görünür |

**ZORUNLU:** her yeni saha arızası, kapatılmadan önce korpusa bir koşu olarak eklenir.
Bu, `regression.guards.test.ts` yasasının navigasyondaki karşılığıdır.

### 10.4 Parametre kalibrasyon protokolü

`σ_z`, `β`, EKF `Q/R` değerleri **üretim sabiti değildir**; saha kayıtlarından
medyan-tabanlı dayanıklı kestiricilerle yeniden hesaplanır:
- `σ_z` ← eşleşmiş segmente dik mesafelerin **medyan mutlak sapması** × 1.4826
- `β`  ← `medyan(d_t) / ln 2`
- `R_obd_speed` ölçek faktörü ← uzun serbest akış pencerelerinde GNSS/OBD oranı medyanı

**ZORUNLU:** kalibrasyon çıktısı tek bir sabit dosyasına yazılır, tarih ve kaynak
koşu kimliğiyle birlikte. "Nereden geldiği bilinmeyen sabit" YASAK.

### 10.5 Saha kabul protokolü

Her faz için: senaryo listesi + ölçüm aracı + eşik (§12'de faz faz).
Ölçüm aracı: `nav-field-record.mjs` → `nav-field-analyze.mjs` → LAB ekranları.
**Ölçülemeyen metrik `NOT_MEASURED` döner** (analiz script'inin mevcut ilkesi) —
varsayılan değer üretilmez.

---

## 11. "8 KAPI" İZLENEBİLİRLİK MATRİSİ (vizyon anayasası)

Her navigasyon sinyali sekiz kapıdan geçer; geçmeyen sinyal üründe **gösterilmez**.

| Sinyal | 1 Doğru mu (Confidence) | 2 Önemli mi (Rule) | 3 Kullanıcı bilmeli mi (Action) | 4 Sistem mi (Twin) | 5 Neyle anlam kazanır (Fusion) | 6 5 dk sonra (Prediction) | 7 Alternatif karar (Intent) | 8 En doğru aksiyon |
|--------|---|---|---|---|---|---|---|---|
| Ham GNSS fix | doğruluk + Mahalanobis | tek başına değil | **hayır** | evet | OBD hız + IMU | — | — | `EgoPose` |
| `EgoPose` | kovaryans + mod | evet | kısmen (rozet) | evet | eşleme | DR projeksiyonu | — | ufuk çapası |
| Hız limiti | `srcMask` (levha/çıkarım) | evet | **evet** | evet | araç sınıfı + yol sınıfı | önümüzdeki değişim | — | ISA-benzeri uyarı |
| Viraj yarıçapı | geometri çözünürlüğü | evet | yalnız riskliyse | evet | hava (μ) + hız | `v_safe` aşımı | yavaşlama önerisi | Guardian uyarısı |
| Eğim | DEM `DERIVED` | evet | **hayır (tek başına)** | evet | araç kütlesi + termal | soğutma projeksiyonu | rota maliyeti | öneri / rota |
| Trafik | sağlayıcı + TTL | evet | evet (ETA) | evet | rota süresi | varış saati | alternatif rota | ETA + teklif |
| Denetim noktası | paket + kapı sayaçları | evet | **evet** | evet | hız + yön + konum belirsizliği | yaklaşma süresi | — | uyarı |
| Soğutma suyu | OBD `OBSERVED` | evet | riskliyse | evet | **ufuk eğimi** | `coolantC(s)` | rota maliyeti | öneri / rota |
| Yakıt / SoC | OBD + öğrenme | evet | evet | evet | **ufuk profili** | `rangeRiskAt` | ara durak | rota + öneri |
| Manevra | rota motoru | evet | **evet** | evet | hız (zamanlama) | `T-60/25/8` | — | anons + HUD |

**Bu tablonun işlevi:** yeni bir sinyal eklemek isteyen her PR, bu tabloya bir satır
eklemek ZORUNDADIR. Satırı doldurulamayan sinyal, "ekrana bir sayı daha koymak"tır
ve vizyon anayasasına aykırıdır.

---

## 12. YOL HARİTASI VE İŞ KIRILIMI

> Her faz: **girdi · üretilecek sözleşme · dokunulacak dosya · kilit test · kütük maddesi
> · çıkış ölçütü · geri alma.** Faz çıkışı **gerçek araçta** ölçülmeden bir sonraki faz
> başlamaz.

### F1 — SÖZLEŞME OMURGASI (davranış değişmez)

| | |
|---|---|
| **Üretilir** | `navigation/core/evidence.ts` (`Evidenced<T>`, kurucular, yaşlandırma) · `navigation/core/degradationModel.ts` (`NavDegradation` + matris) · `map/store/tileGrid.ts` (saf karo matematiği) · `map/store/mapStore.ts` (mevcut kaynakları SARAN cephe) |
| **Dokunulur** | Yalnız SARMALAMA: `speedLimitService`, `offlineRoutingStatus`, `enforcementPointsSource`, `trafficService` okuma yüzeyleri |
| **Kilit test** | (1) `Evidenced` kurucuları `UNAVAILABLE`da `confidence ≤ 0.3` zorlar · (2) her `NavDegradation` değerinin matris satırı var · (3) `InspectorField`, `Evidenced`den türetilir (ters yön derlenmez) · (4) `tileGrid` round-trip |
| **Kütük** | 🔴 F1-1 "LAB'daki her navigasyon sayısı kaynak+sınıf+yaş gösteriyor mu" |
| **Çıkış** | LAB'da `grade` taşımayan navigasyon sayısı **kalmadı**; davranış regresyonu **0** (mevcut kilitler yeşil) |
| **Geri alma** | Saf ek; eski tipler bir sürüm boyunca korunur |

### F2 — EGO (konum)

| | |
|---|---|
| **Üretilir** | `ego/egoFusionModel.ts` (5 durumlu hata-durumlu EKF, SAF) · `ego/egoRuntime.ts` (bağlama) · `matching/hmmMatchModel.ts` (SAF) |
| **Dokunulur** | `gpsService` (kapılar + IMU aboneliği) · `mapMatchModel` (aday havuzu genişler; üç kanıt KORUNUR) |
| **Kilit test** | ZUPT'ta hız tam 0 · doğruluk > 50 m ölçüm reddi · `DR_ONLY` 90 s tavanı · yayınlanmış akış append-only (P8) · harita geri beslemesi `MATCH_UNCERTAIN`da kapalı |
| **Kütük** | 🔴 F2-1 tünel (< 25 m) · 🔴 F2-2 park 10 dk hız 0 · 🔴 F2-3 bölünmüş yol ters şerit 0 · 🔴 F2-4 `σ_z`/`β` kendi kaydımızdan kalibre edildi |
| **Çıkış** | G01/G02/G03/G08 altın koşuları yeşil **ve** gerçek araçta üç ölçüt tutuyor |
| **Geri alma** | `egoRuntime` bayrakla kapatılınca eski `gpsService` yolu aynen çalışır |

### F3 — CEH (ufuk) — mimarinin kalbi

| | |
|---|---|
| **Üretilir** | `horizon/horizonModel.ts` · `horizon/mppModel.ts` · `horizon/horizonProvider.ts` · `horizon/vehicleProjectionModel.ts` · `scripts/build-map-pack.mjs` (`GTL1` + `ADL1` üretimi) |
| **Dokunulur** | 8 Guardian adaptörü ufuk okuruna çevrilir · `speedLimitService` çalışma-anı Overpass yolu **kapatılır** · `tunnelNightRuntime` ufuktan beslenir |
| **Kilit test** | Guardian adaptörleri `overpass`/`gpsService` **import edemez** (P2) · ufuk kapsam dışını uzatmaz · `adas` sürüm uyumsuzluğunda `coverage: NONE` · projeksiyon parametresi yoksa `UNAVAILABLE` |
| **Kütük** | 🔴 F3-1 **400 km** karışık yol (≥ %15 gece): limit doğruluğu ≥ %90 toplam, ≥ %80 her yol tipinde · 🔴 F3-2 rota YOKKEN viraj/kamera/limit uyarısı çalışıyor · 🔴 F3-3 uçak modunda `coverage: PACKAGED` |
| **Çıkış** | Üç kütük maddesi 🟢 + G06/G07 yeşil |
| **Geri alma** | Adaptörler bir sürüm boyunca çift yollu (ufuk yoksa eski kaynak) |

### F4 — ROTA

| | |
|---|---|
| **Üretilir** | `routing/costModel.ts` (SAF) · `routing/onboardRouter.worker.ts` (hiyerarşik A\*, `turnTable`) · `RouteRationale` |
| **Dokunulur** | `offlineRoutingService` (L0 daemon **kaldırılır**) · `routingService` sağlayıcı arbitrajı · reroute FSM kapıları |
| **Kilit test** | **tüm maliyet çarpanları ≥ 1.0** · kanıt yoksa çarpan 1.0 (bilinmeyen araçta rota sabit-maliyetle **birebir aynı**) · aynı `CostContext` → aynı rota (determinizm) · yasak dönüş üretilmez |
| **Kütük** | 🔴 F4-1 uçak modunda 50 km rota p95 < 3 s · 🔴 F4-2 350 km rota üretiliyor (bugün tavana çarpıyor) · 🔴 F4-3 termal kural rampa toplamını ölçülebilir düşürüyor · 🔴 F4-4 çevrimdışı rota yasak dönüş içermiyor |
| **Çıkış** | Dört madde 🟢 + G09/G10 yeşil |
| **Geri alma** | Onboard yönlendirici bayrakla kapatılır → mevcut OSRM yolu |

### F5 — REHBERLİK · ARBİTRAJ · GÖSTERİM

| | |
|---|---|
| **Üretilir** | `attention/attentionBudgetModel.ts` · zaman tabanlı ses tetiği · öncelik matrisi tek kaynağı |
| **Dokunulur** | `NavigationHUD` (ses tetiği **çıkar**, < 700 satır) · `FullMapView` (karar mantığı çıkar, hedef < 600 satır) · `voiceGuidanceRuntime` |
| **Kilit test** | `components/map/**` içinde timer/abonelik YASAK (P3) · anons kademe başına tek · `T-8s` içinde kritik olmayan bastırılır |
| **Kütük** | 🔴 F5-1 30 dk şehir içi: kritik olmayan kesinti ≤ 3/dk · 🔴 F5-2 tam ekran kapalıyken ses kesilmiyor · 🔴 F5-3 `SAFE_MODE`'da limit+manevra+ses çalışıyor |
| **Çıkış** | Üç madde 🟢 |

### F6 — İLERİ (tetikleyici eşikle açılır, takvimle DEĞİL)

| Kalem | Tetikleyici |
|-------|-------------|
| CCH / özelleştirilebilir hiyerarşi | onboard rota p95 > 3 s ölçülürse |
| `nav-core.worker` (SAB seqlock) | nav kadansına atfedilebilir long task > 50 ms |
| OpenLR konum referanslama | çapraz-harita trafik veya kullanıcı verisi taşınacaksa |
| Şerit seviyesi / kavşak görünümü | gerçek şerit verisi kaynağı sağlanırsa |
| EV profili + şarj duraklı rota | hedef pazar kararı |

---

## 13. UYUM VE TİCARİ KAPILAR (satış öncesi denetim listesi)

| # | Kapı | Durum | Kural |
|---|------|:-----:|-------|
| C1 | Karo sağlayıcısı ticari kullanıma uygun | ❌ **AÇIK** | OSMF karo sunucusu varsayılan olamaz. `MapStore.render` tek nokta. |
| C2 | OSM türevi veriler için ODbL atfı | ✅ | `routing-graph.license.txt` · `poi.license.txt` mevcut; uygulama içinde de görünmeli |
| C3 | DEM lisansı (eğim) | ⚠️ F3'te | SRTM / Copernicus — permissive olan seçilir |
| C4 | Trafik BYOK | ✅ | Gömülü anahtar YOK |
| C5 | Bağımlılık lisans taraması | ⚠️ | `npx license-checker --summary` lansman öncesi |
| C6 | ISA benzeri hız limiti kalitesi | ❌ F3 kabulü | 400 km / ≥ %90 / ≥ %80 (§1.9, F3-1) |
| C7 | Sürücü dikkati | ❌ F5 kabulü | ≤ 3 kesinti/dk, 3 bilgi öbeği kuralı |
| C8 | PII sınırı | ✅ tasarımda | §9.3; `raw` iz repoda YASAK |

**ZORUNLU:** C1 kapatılmadan ürün 3. taraf head unit üreticisine **satılamaz**.
Bu bir kod kusuru değil, bir **ürün kapısıdır** ve mimarinin dışında çözülür.

---

## 14. KAYNAKÇA

**Standartlar / OEM**
- Navigation Data Standard (NDS) — https://nds-association.org/
- ADASIS Forum beyaz belgesi — https://adasis.org/wp-content/uploads/sites/10/2024/06/ADASIS-White-paper-Master-Final.pdf
- dSPACE ADASIS v3 Horizon Reconstructor — https://www.dspace.com/en/ltd/home/products/sw/impsw/adasis_v3_hr_blockset.cfm
- Elektrobit EB robinos Predictor — https://www.elektrobit.com/products/automated-driving/eb-robinos/predictor/
- Regulation (EU) 2019/2144 (GSR / ISA) — https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=PI_COM%3AAres%282021%292243084
- HERE — ISA 2024 — https://www.here.com/learn/blog/intelligent-speed-assistance-2024
- Mapbox — EU ISA gereksinimleri — https://www.mapbox.com/blog/new-eu-intelligent-speed-assistance-requirements
- NHTSA görsel-manuel sürücü dikkati kılavuzu — https://www.federalregister.gov/documents/2013/04/26/2013-09883/visual-manual-nhtsa-driver-distraction-guidelines-for-in-vehicle-electronic-devices

**Ürün mimarileri**
- Mapbox Electronic Horizon — https://docs.mapbox.com/android/navigation/v2/guides/advanced/electronic-horizon/
- Mapbox Navigation SDK for Automotive — https://www.mapbox.com/automotive
- TomTom NavKit2 — https://www.tomtom.com/newsroom/product-focus/cloud-native-navigation-navkit/
- Valhalla — https://valhalla.github.io/valhalla/ · dinamik maliyet: https://valhalla.github.io/valhalla/sif/dynamic-costing/

**Algoritma**
- Newson & Krumm, *Hidden Markov Map Matching Through Noise and Sparseness* — https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/map-matching-ACM-GIS-camera-ready.pdf
- Contraction Hierarchies — https://en.wikipedia.org/wiki/Contraction_hierarchies · CCH derlemesi: https://arxiv.org/pdf/2502.10519
- ALT (A\*, Landmarks, Triangle inequality) — http://www.fabianfuchs.com/fabianfuchs_ALT.pdf
- ETA Prediction with GNNs in Google Maps — https://arxiv.org/abs/2108.11482
- OpenLR konum referanslama — https://www.openlr.org/location-referencing/
- u-blox Automotive Dead Reckoning — https://www.u-blox.com/en/technologies/automotive-dead-reckoning-technology

**İç kaynaklar (ölçüm ve kanıt)**
`docs/NAVIGATION_OEM_PLUS_ARCHITECTURE_2026-08-28.md` (v1, boşluk analizi) ·
`docs/NAVIGATION_REALITY_AUDIT_AND_OEM_GAP_ANALYSIS.md` ·
`docs/NAVIGATION_CORE_RELIABILITY_P0_REPORT.md` · `docs/ADR_OFFLINE_ROUTING.md` ·
`docs/DEVICE_VALIDATION_LEDGER.md` · `scripts/build-routing-graph.mjs` ·
`scripts/nav-field-record.mjs` · `scripts/nav-field-analyze.mjs`

---

## 15. KARAR

Bu spesifikasyon üç şeyi sabitler:

1. **Omurga:** "önümde ne var?" sorusunun tek cevaplayıcısı **CEH**'tir. Beş ayrı
   cevaplayıcı ölür; tutarsızlık yapısal olarak imkânsızlaşır; serbest sürüş zekâsı doğar.
2. **Ölçek:** veri karolu, hiyerarşik, sürümlü ve **sıfır-kopya** olur. Ölçülen
   238 252 düğüm / 295 346 kenar / 7.65 MB'lık monolit, bellekte ~8× büyüyen ve uzun
   rotada `MAX_CLOSED` tavanına çarpan bir yapıydı; bu artık tercih değil, **kapatılmış
   bir kusurdur**.
3. **Fark:** OEM ufku haritayı taşır; **CAROS ufku haritayı BU ARACIN ÜSTÜNDEN
   GEÇİREREK taşır** — ve bunu ancak kanıt varsa yapar. Kanıt yoksa zekâ devreye
   girmez; ürün susar. Bu, "daha akıllı" olmanın tek dürüst biçimidir.

**Ve bir şeyi sabitlemez:** hiçbir fazın "tamamlandığını". Her faz çıkışı
`docs/DEVICE_VALIDATION_LEDGER.md` üzerinden **gerçek araçta** ölçülür.
Test yeşilliği ve tsc temizliği bu belgede **kabul sayılmaz.**
