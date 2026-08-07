# NAVIGATION-P0-CORE — OEM Seviyesinde Navigasyon Temeli

**Tarih:** 2026-08-04 · **Tür:** ANALİZ + YOL HARİTASI (kod yazılmadı) ·
**Commit/push/deploy:** YOK

Bu belge kod okunarak üretildi. Her bulgu `dosya:satır` kanıtıyla verilmiştir.
Eski `NAVIGATION_REALITY_AUDIT_AND_OEM_GAP_ANALYSIS.md` (2026-08-01) belgesinin
20 açığından **5 tanesi NAV-CORE-P0 ile kapanmış**, bu turda yeniden doğrulandı ve
kapananlar listeden çıkarıldı — bayat bulgu tekrar edilmedi.

---

## 0. Kapandığı DOĞRULANAN eski açıklar (tekrar açılmayacak)

| Eski açık | Bugünkü kanıt | Durum |
|---|---|---|
| Manevra mesafesi kuş uçuşu | `routingService.ts:1130` `alongRouteDistanceToManeuver` + `distSource='ALONG_ROUTE'` | ✅ KAPANDI |
| Şerit rehberi sahte | `routingService.ts:299,326` gerçek `intersections[].lanes`; yoksa `null` | ✅ KAPANDI |
| Dönel kavşak çıkışı yok | `RouteStep.roundaboutExit` gerçek `maneuver.exit`'ten | ✅ KAPANDI |
| Navigasyon LAB ekranı yok | `NavigationCoreScreen` + 11 kart | ✅ KAPANDI |
| Rota koşulsuz kabul ediliyor | `routingService.ts:884` `pickBestRoute` + 12 denetim | ✅ KAPANDI |
| Adım ilerleme kuş uçuşu | `routingService.ts:1089` manevra çapaları | ✅ KAPANDI |
| Rota isteği görünüme bağlı | `claimRouteRequest` + `navigationSessionRuntime` | ✅ KAPANDI |

---

## 1. OEM GAP ANALİZİ

### G1 — 🔴 SESLİ YÖNLENDİRME HÂLÂ GÖRÜNÜME BAĞLI (en ağır açık)

**Neden yanlış.** Kademeli sesli anons `NavigationHUD.tsx:1870`'teki bir
`useEffect` içindedir. `NavigationHUD` yalnız `FullMapView.tsx:2157`'de mount
edilir; `FullMapView` ise `DrawerPanel.tsx:40`'ta **lazy** yüklenen bir
görünümdür. Yani tam ekran harita kapalıyken **turn-by-turn ses üreten hiçbir
kod çalışmaz**.

Daha ağırı: `navigationSessionRuntime.ts:10` başlığı bu arızanın
**"kademeli sesli yönlendirme"** dahil çözüldüğünü YAZIYOR. Motor gerçekte
yalnız `updateRouteProgress` + `updateNavigationProgress` çağırır
(`navigationSessionRuntime.ts:113-119`) — bunlar **store'u** günceller; sesi
tetikleyen efekt hâlâ bileşendedir. Belge ile kod çelişiyor.

İkinci kusur aynı yerde: `_spokenRef` bir **bileşen ref'idir**
(`NavigationHUD.tsx:1866`). Görünüm kapanıp açılınca kademe bitmask'i sıfırlanır
→ araç aynı manevraya yaklaşırken **"Şimdi sağa dönün" ikinci kez seslendirilir**.

**Sürüşte oluşturduğu sorun.** Sürücü mini haritaya döndüğü an sesli yönlendirme
susar. Bu, ürünün kapatmayı "iptal" ile eş tutmasına yol açan arızanın
**yarısının hâlâ açık olması** demektir: ilerleme devam eder ama sürücü duymaz,
ekrana bakmak zorunda kalır. Güvenlik açısından bu, kaçırılan manevradan daha
kötüdür.

**OEM nasıl çözüyor.** Guidance engine bir **servistir**; TTS kuyruğu ve
"bu manevra için hangi kademeler söylendi" durumu oturum kapsamındadır, hiçbir
ekranla ilişkilendirilmez. Ekran yalnız aynı olayları görselleştirir.

**Bizim çözümümüz.** `voiceGuidanceRuntime` modülü: kademe seçimi
(`_finalTierM` hız-adaptif eşiği dahil) ve `spoken` bitmask'i modül düzeyine
taşınır, anahtar `(routeEpoch, stepIndex)` olur. `navigationSessionRuntime`
tick'inden beslenir. `NavigationHUD` yalnız görsel kalır. Yeni eşik/yeni metin
YOK — yalnız sahiplik taşınır (NAV-CORE-P0 deseninin birebir aynısı).

---

### G2 — 🔴 TÜNELDE İLERLEME DE GÖRÜNÜME BAĞLI

**Neden yanlış.** Ölü hesaplama (dead reckoning) ilerleme beslemesi
`FullMapView.tsx:860-865`'te, RAF döngüsünün içindedir. `navigationSessionRuntime.ts:25`
bunu bilinçli bir sınır olarak yazar ("yalnız tam ekran açıkken çalışan bir
görünüm-içi süreklilik yardımı").

**Sürüşte oluşturduğu sorun.** Mini haritadayken tünele girilirse GPS kesilir,
DR devreye giremez → mesafe/ETA/adım sayacı **donar**, tünel çıkışında ani
sıçrama olur. Şehir içi alt geçitler ve kapalı otoparklar bunu günlük hâle
getirir.

**OEM nasıl çözüyor.** Konum füzyonu (GPS + tekerlek hızı + jiroskop) sensör
katmanındadır; görünüm asla konum üretmez.

**Bizim çözümümüz.** DR projeksiyonu `navigationSessionRuntime`'a taşınır
(GPS fix yokken 1 Hz, `allowReroute:false` sözleşmesi aynen korunur). Görünüm
yalnız marker'ı çizer. G1 ile **aynı atomik PR'da** yapılmalı: ikisi de aynı
sahiplik hatasıdır.

---

### G3 — 🔴 ETA ROTANIN KENDİ SÜRE MODELİNİ KULLANMIYOR

**Neden yanlış.** ETA `navigationService.ts:724`'te şöyle hesaplanır:

```
movementEtaS = (kalanMesafe / effectiveKmh) × 3600
effectiveKmh = 0.60 × son 30 sn ortalama hız + 0.40 × MEVCUT adımın tasarım hızı
```

Yani **kalan rotanın süresi değil, şu anki hız** kullanılıyor. Oysa OSRM
isteğinde `annotations=duration,distance` **zaten isteniyor**
(`routingService.ts:451`) ve yanıt indiriliyor — ama `cumulativeDurations`
diye bir alan **yok**; süre anotasyonu hiç ayrıştırılmıyor. Bugün o veri için
bant genişliği harcanıp çöpe atılıyor.

**Sürüşte oluşturduğu sorun.** Şehir içinden başlayıp otoyola çıkan bir rotada
ETA başta çok kötümser, otoyolda çok iyimser olur; varış saati sürekli kayar.
Sürücünün ETA'ya güveni ilk 10 dakikada kırılır — "kötü ETA" şikâyetinin
doğrudan kaynağı budur. Trafik tamponu (`TRAFFIC_DELAY_RATIO = 0.35`) bunu
düzeltmez, çünkü sorun gecikme değil **model**dir.

**OEM nasıl çözüyor.** ETA = kalan segmentlerin **yol sınıfı bazlı süreleri**
toplamı; canlı hız yalnız bir **düzeltme çarpanı** üretir; trafik ayrı katman.

**Bizim çözümümüz.** `cumulativeDurations` (suffix-sum, `cumulativeDistances`
ile birebir aynı desen) eklenir. ETA = `cumulativeDurations[eşleşenIndeks]` ×
sınırlı düzeltme çarpanı (gözlenen/beklenen hız oranı, ör. 0.7–1.5 arası
kırpılmış) + mevcut durma tamponu. Veri zaten geliyor, yeni ağ isteği YOK.

---

### G4 — 🔴 MİNİ HARİTADA ARAÇ SIÇRIYOR (interpolasyon yok)

**Neden yanlış.** Tam ekran 60 FPS ara değer üretir
(`FullMapView.tsx:940` `interpolateNavPoint`). Mini harita ise marker'ı ve
kamerayı **doğrudan GPS geri çağrısında** günceller
(`MiniMapWidget.tsx:535,538`). GPS tavanı 2 Hz'dir
(`gpsService.ts:97` `GPS_NAV_MAX_INTERVAL_MS = 500`).

**Sürüşte oluşturduğu sorun.** Aynı üründe iki farklı akıcılık: tam ekran akar,
mini harita saniyede iki kez zıplar. Bu, kalite algısını doğrudan vuran ve
"amatör" hissi veren en görünür kusurdur.

**OEM nasıl çözüyor.** Konum kaynağı ne olursa olsun görselleştirme sabit
30–60 FPS ekstrapolasyonla yapılır.

**Bizim çözümümüz.** `interpolateNavPoint` + RAF pompası paylaşılan bir
`navMarkerInterpolator` haline getirilir; iki görünüm de onu kullanır.
Mini haritanın mevcut idle/termal kapıları korunur (boşta döngü uyumaya devam
eder — #61/#64 kazanımları geri verilmez).

---

### G5 — 🔴 ÇEVRİMDIŞI ROTA YOK; ÇEVRİMDIŞI SAPMADA REHBERLİK TAMAMEN ÖLÜYOR

**Neden yanlış.** `public/maps/` klasörü **hiç yok** (doğrulandı) →
`routing-graph.bin` yok → A* katmanı çalışamaz. Kalan tek yedek düz çizgidir.
Ve düz çizgi seçildiğinde sapma değerlendirmesi bilinçli olarak kapatılır
(`routingService.ts:1159`).

**Sürüşte oluşturduğu sorun.** Kapsama dışında bir kavşak kaçırıldığında:
gerçek rota yok, reroute yok, sapma uyarısı yok. Sürücü sessizce yanlış yolda
kalır. Bu, "geç reroute"tan daha kötüdür — **hiç reroute yoktur**.

**OEM nasıl çözüyor.** Yol ağı cihazda gömülüdür; internet yalnız trafik ve
arama içindir.

**Bizim çözümümüz.** İki adımda: **(a) P0 — dürüst fail-safe:** düz-hat moduna
düşüldüğünde sürücüye kalıcı ve açık bir "rehberlik yok, yalnız yön" göstergesi
+ sesli tek uyarı; sessiz bozulma bitirilir. **(b) P1 — koridor grafiği:** rota
çevresinde dar bir bant (ör. ±2 km) için yol ağı, rota alınırken indirilip
saklanır; tam Türkiye grafiği gerekmez, reroute'un %90'ı bu bantta gerçekleşir.

---

### G6 — 🔴 HEDEF GİREMEYEN SÜRÜCÜ İÇİN GERİSİ ANLAMSIZ (adres eşleştirme)

**Neden yanlış.** Varsayılan jeokodlayıcı Nominatim'dir; Türkiye'de numaralı
sokakları eşleştiremediği **ölçülerek** kaydedilmiştir (kütük #331–#336, 🔴 —
"yanlış sokağa götürüyordu"). BYOK sağlayıcı katmanı eklenmiştir
(`geocodingProviders.ts:41` HERE/Yandex) ama **kullanıcı anahtarı yoksa devrede
değildir**.

**Sürüşte oluşturduğu sorun.** Navigasyonun giriş kapısı kırıkken çekirdeğin
kalitesi görünmez. Üstelik yanlış eşleşme sürücüyü **yanlış sokağa** götürür —
kusurlu rehberlikten daha zararlıdır.

**OEM nasıl çözüyor.** Ülkeye özel adres indeksi + normalizasyon (kısaltma,
ek, sokak numarası biçimleri) + tam-eşleşme önceliği.

**Bizim çözümümüz.** TR adres normalizasyonu (`0455. Sokak` ↔ `455 Sk` ↔
`455. Sk.`) + Overpass tam-eşleşme sorgusu + sonuç **güven eşiği**: eşleşme
zayıfsa hedefi kabul etmek yerine kullanıcıya seçenek sun (fail-closed).

---

### G7 — 🟡 REROUTE GECİKMESİ YAPISAL OLARAK YÜKSEK (ölçülmedi)

**Neden yanlış (potansiyel).** Zincir: sapma kanıtı 2–5 örnek **ve** 0.8–2.5 sn
(`offRouteModel.ts:76-98`) → throttle 2.5–6 sn (`routingService.ts:1030`) →
OSRM başlık 2 sn + gövde 5 sn (`routingService.ts:168`) → ilk yeni talimat.
En kötü hâlde **10 sn üzeri**. Ledger'da bu zincir için ölçüm halkaları var
(`routeRequestLedger` 5 halka) ama **gerçek araçta hiç okunmadı**.

**Sürüşte oluşturduğu sorun.** Şehir içi kavşakta 10 sn = bir sonraki kavşağın
da kaçırılması.

**OEM nasıl çözüyor.** Reroute cihazdaki grafikte hesaplanır: 200–500 ms.

**Bizim çözümümüz.** Önce **ölç** (bu tur kod değil, sürüş görevi): LAB kart 5
zaten `detectToCommitMs` / `detectToFirstInstructionMs` veriyor. Ölçüm sonrası
iki ucuz kazanım: throttle'ı sapma **doğrulandıktan sonra** başlatmak (şu anda
istek atılmadan önce pencere yazılıyor) ve sapma anında OSRM beklenmeden
"Uygun yerden dönün" ara talimatı vermek.

---

### G8 — 🟡 TRAFİK VERİSİ YOK

Rota seçimi ve ETA gerçek yol koşulunu bilmiyor. `TRAFFIC_DELAY_RATIO` yalnız
**kendi durma süremizi** yansıtır — önümüzdeki tıkanıklığı değil.
**Çözüm:** BYOK trafik sağlayıcı (HERE/TomTom) → ETA çarpanı + reroute girdisi.
P0 değil (ölçülebilir sürüş hatası üretmiyor, yalnız optimallik kaybı).

---

### G9 — 🟡 ROTA TERCİHİ VE ARAÇ PROFİLİ YOK

`avoid toll / highway / ferry` seçeneği yok; ağır araç/EV profili yok.
Ücretli geçiş yalnız **sezgisel** işaretleniyor (`altHasToll`).
**Çözüm:** OSRM `exclude=` parametresi + Ayarlar'da tercih. P1.

---

### G10 — 🟡 KAVŞAK YAKINLAŞTIRMA GÖRÜNÜMÜ (junction view) YOK

Şerit verisi artık gerçek, ama karmaşık kavşakta OEM'lerin verdiği
yakınlaştırılmış görsel yok. P1 — görsel kazanım, doğruluk kaybı değil.

---

### G11 — ⚫ TİCARİ ENGEL: KARO KAYNAĞI

`mapSourceManager.ts:343` doğrudan `tile.openstreetmap.org`. OSM karo kullanım
politikası ticari ürüne uygun değildir; `public/maps` boş olduğu için çevrimdışı
karo da yok. **Sürüş kalitesi P0'ı değildir** ama satış öncesi kapanmalıdır.

---

### G12 — 🔴 EN ÖNEMLİ EKSİK: GERÇEK ARAÇ ÖLÇÜMÜ

Yukarıdaki her şey kod okumasıdır. Kütükte navigasyonla ilgili maddeler
🔴 beklemektedir; reroute gecikmesi, ETA sapması, tünel toparlanması ve
sesli anons zamanlaması **hiç ölçülmedi**. Ölçmeden yapılacak her optimizasyon
tahmindir.

---

## 2. OEM SEVİYE MATRİSİ (bugün)

| Başlık | Puan | Kanıt |
|---|:--:|---|
| Rota oluşturma (online) | 4 | OSRM + doğrulama kapısı + alternatif seçimi |
| Rota oluşturma (offline) | 0 | `public/maps` yok |
| Map matching | 4 | Üç kanıtlı `matchToRoute`, güven tavanı |
| Sapma algılama | 4 | Uyarlanabilir kanıt penceresi, tünel muaf |
| Reroute gecikmesi | 2 | Yapısal tavan yüksek, ölçülmedi |
| Manevra mesafesi | 4 | Yol-boyu, kaynak etiketli |
| Sesli yönlendirme | **1** | Görünüm kapanınca **susuyor** |
| ETA | **2** | Rota süre modeli kullanılmıyor |
| Kamera | 3 | Saha ile çok iterasyon; look-ahead + standstill fix |
| Marker akıcılığı | 2 | Tam ekran 60 FPS, mini harita 2 Hz |
| Tünel sürekliliği | **1** | DR yalnız tam ekranda |
| Şerit rehberi | 3 | Gerçek `lanes`, junction view yok |
| Hız limiti | 3 | Gerçek `maxspeed` + araç sınıfı tavanı (yeni) |
| Trafik | 0 | Yok |
| Adres arama | 2 | Nominatim TR boşluğu; BYOK anahtarsız |
| Gözlemlenebilirlik | 4 | Navigation Core 11 kart |
| Saha doğrulama | **0** | Hiçbir senaryo gerçek araçta ölçülmedi |

**Ortalama: 2.3 / 5** — çekirdek karar katmanı (matching/sapma/manevra) OEM'e
yakın, **teslim katmanı (ses/ETA/süreklilik) geride.**

---

## 3. P0 GÖREV LİSTESİ

Yalnız sürücüyü gerçekten etkileyenler. Her biri atomik, geriye uyumlu.

| # | Görev | Kapattığı açık | Dosyalar | Risk |
|---|---|---|---|---|
| **P0-1** | Sesli yönlendirme + DR sahipliğini görünümden al | G1, G2 | yeni `voiceGuidanceRuntime.ts` · `navigationSessionRuntime.ts` · `NavigationHUD.tsx` · `FullMapView.tsx` | Orta |
| **P0-2** | ETA'yı rotanın süre modeline bağla (`cumulativeDurations`) | G3 | `routingService.ts` · `navigationService.ts` | Düşük |
| **P0-3** | Çevrimdışı/düz-hat modunda dürüst rehberlik kaybı bildirimi | G5a | `routingService.ts` · `NavigationHUD.tsx` · `MiniMapWidget.tsx` | Düşük |
| **P0-4** | Mini haritaya paylaşılan interpolasyon | G4 | yeni `navMarkerInterpolator.ts` · iki görünüm | Düşük |
| **P0-5** | Reroute gecikme zincirini gerçek araçta ÖLÇ + throttle'ı doğrulama sonrasına al | G7 | ölçüm + `routingService.ts` | Düşük |
| **P0-6** | TR adres normalizasyonu + eşleşme güven eşiği (fail-closed) | G6 | `geocodingService.ts` · `addressNavigationEngine.ts` | Orta |
| **P0-7** | Gerçek araçta uçtan uca sürüş doğrulaması (ölçüm görevi) | G12 | — | — |

**P0 DIŞI (bilinçli):** trafik (G8), rota tercihleri (G9), junction view (G10),
karo lisansı (G11), çevrimdışı koridor grafiği (G5b). Bunlar P1'dir.

---

## 4. ÖNCELİK SIRASI

```
1. P0-1  Ses + DR sahipliği      ← sürücü DUYMUYOR; en ağır güvenlik açığı
2. P0-2  ETA süre modeli         ← güven kaybının tek büyük kaynağı, veri hazır
3. P0-7  Gerçek araç ölçümü      ← 1 ve 2'yi doğrular, 5'i mümkün kılar
4. P0-3  Çevrimdışı dürüstlük    ← sessiz bozulmayı bitirir, çok ucuz
5. P0-4  Mini harita akıcılığı   ← kalite algısı, düşük risk
6. P0-5  Reroute gecikmesi       ← ölçüm olmadan optimize edilemez (3'e bağlı)
7. P0-6  Adres eşleştirme        ← giriş kapısı; en yüksek çaba, ayrı uzmanlık
```

**Sıra gerekçesi:** 1 ve 2 ölçüm gerektirmeyen, kanıtı kodda olan kesin
kusurlardır — önce onlar. 3 numaraya kadar hiçbir tahmin-tabanlı iyileştirme
yapılmaz. 5 ve 6 ölçüm çıktısına bağlıdır.

---

## 5. TAHMİNİ GELİŞTİRME PLANI

### Faz 1 — Sahiplik ve dürüstlük (ölçüm gerektirmez)
| PR | İçerik | Kabul ölçütü (cihazda) |
|---|---|---|
| PR-1 | `voiceGuidanceRuntime` + DR taşınması | Tam ekran KAPALIYKEN manevra anonsu duyulmalı; görünüm açılıp kapanınca aynı manevra **ikinci kez** seslenmemeli; tünelde mini haritadayken mesafe azalmaya devam etmeli |
| PR-2 | `cumulativeDurations` + ETA modeli | Şehir→otoyol rotasında varış saati ilk 10 dk'da **±3 dk** içinde kalmalı (bugün ölçülüp karşılaştırılacak) |
| PR-3 | Düz-hat modunda açık rehberlik-yok göstergesi | Uçak modunda rota alınınca kart görünmeli + tek sesli uyarı; sapma sessiz kalmamalı |

### Faz 2 — Ölçüm turu (kod yok)
Gerçek araçta 45–60 dk sürüş; LAB Navigation Core'dan kayıt:
reroute 5 halkası · ETA sapması · sesli anons zamanlaması · tünel toparlanması ·
map match durumu dağılımı. Çıktı: kütüğe 🔴→🟢/❌ taşıma + PR-5 için gerçek hedef.

### Faz 3 — Ölçüme dayalı iyileştirme
| PR | İçerik | Bağımlılık |
|---|---|---|
| PR-4 | Paylaşılan marker interpolasyonu | — |
| PR-5 | Reroute gecikme kısaltma (throttle sırası + ara talimat) | Faz 2 ölçümü |
| PR-6 | TR adres normalizasyonu + güven eşiği | — |

### Faz 4 (P1 — bu görevin kapsamı dışında)
Koridor grafiği · trafik sağlayıcı (BYOK) · rota tercihleri · junction view ·
kendi karo altyapısı.

**Kapsam tahmini:** Faz 1 ≈ 3 atomik PR / ~8 dosya · Faz 2 ölçüm · Faz 3 ≈ 3 PR.
Faz 1+3 sonunda beklenen matris ortalaması **2.3 → 3.2**; OEM seviyesine
(≥4.0) çıkış Faz 4'e ve saha doğrulamasına bağlıdır.

---

## 6. NİHAİ DURUM

`NAVIGATION_LOCAL_BETA` — değişmedi. Yükseltmenin önündeki tek kapı hâlâ aynı:
**gerçek araçta hiçbir navigasyon senaryosu ölçülmedi.** Bu turda yeni kod
yazılmadı; yazılacak kodun sırası ve kabul ölçütleri belirlendi.
