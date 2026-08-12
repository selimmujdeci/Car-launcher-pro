# Adres Arama — Başarısızlık Teşhisi (2026-08-11)

**Tur tipi:** ÖLÇÜM. Düzeltme yazılmadı (tek istisna: aşağıdaki §5 gözlemlenebilirlik
altyapısı — kullanıcı görevinde açıkça istendi).

**Bağlam:** kullanıcı sahada adreslerin ~%40'ının bulunmadığını/zor bulunduğunu
gözledi. Bu belge sebebi tahmin etmez, **sebep sınıflarını sayar**.

---

## 0 · Yönetici özeti (tek paragraf)

30 tipik Türkçe adres canlı Nominatim + Overpass üzerinde ürünün GERÇEK
fonksiyonlarıyla koşuldu: **8/30 (%27) başarısız**. Sebep dağılımı ikiye ayrıldı:
**6/8 ÜRÜN ZİNCİRİ** (aranan yol OSM'de **VAR**, ürün bulamıyor) ve **2/8 VERİ YOK**
(OSM boşluğu — hiçbir kod düzeltmesi çözemez). Ürün zincirindeki baskın kök tek ve
kesin: **`extractStreetQuery` adlı sokak sorgusunda şehir/mahalle önekini Overpass
regex'ine koyuyor**, bu yüzden #336'da "son şans" diye kurulan katman adlı yollarda
**yapısal olarak ölü** (3/3 yan yana ölçümle kanıtlandı). İkincil kökler: yazım/boşluk
toleransı yok (`Kuvayimilliye` ≠ OSM'deki `Kuvayi Milliye`), `_osmType('cd')` yol
tipini Sokak sanıyor, gevşetilmiş adaylarda mesafe kapısı yok (379 km ve 696 km
uzaktaki adaylar kullanıcıya sunuldu). **Diyakritik duyarlılığı ve mahalle/ilçe sırası
ölçümde kök neden ÇIKMADI** — ikisi de çalışıyor (§4'te çürütme kayıtları).

Teşhisin kendisi bir kusur ortaya çıkardı: **ürün hiçbir arama denemesini
kaydetmiyordu**; şikâyetin sebebi üründe iz bırakmıyordu. O boşluk bu turda kapatıldı
(§5).

---

## 1 · Adres arama nereden geliyor (haritalama)

**İki ayrı zincir, tek ortak kütüphane.** Ayrışma geçmişte saha kusuru olmuştu
(kütük #332) ve **hâlâ canlı** (§3.6).

| Zincir | Giriş | Katman sırası |
|---|---|---|
| **A · Mavi / adres kartı** | `addressNavigationEngine.resolveAndNavigate` | `premiumGeocode` (BYOK) → Nominatim (`countrycodes=tr` + ~80 km viewbox) → numara doğrulama filtresi → **gevşetme merdiveni** (max 2 varyant) → `searchStreetByName` (Overpass) → `_localSearch` (geçmiş + POI DB + geocode önbelleği) |
| **B · Harita arama çubuğu** | `mapService.searchPlaces` | geçmiş/favoriler (IndexedDB) → SQLite FTS5 POI → Nominatim (**`countrycodes` YOK, viewbox YOK**, `jsonv2`) → numara doğrulama filtresi → `searchStreetByName` |

Ölçülen yapısal farklar (B zincirinde **eksik** olanlar):
- **BYOK premium sağlayıcı hiç çağrılmıyor** — anahtar girilse bile harita çubuğu onu kullanmaz.
- **Kısaltma açılımı ve gevşetme merdiveni yok.**
- **Ülke/viewbox biasi yok** → dünya çapında sonuç dönebilir.

Sağlayıcılar: Nominatim (`nominatim.openstreetmap.org`), Overpass
(`overpass-api.de`, **tek uç, ayna yok**), opsiyonel BYOK (Google/HERE/Yandex),
cihaz-içi: IndexedDB geçmişi + SQLite FTS5 `poi.db` + `localStorage` geocode önbelleği.
Hepsi aynı OSM verisine dayanır (BYOK hariç).

---

## 2 · Kayıt/kanıt durumu — ÖLÇÜM: **YOKTU**

Aranan: "her arama denemesi (girilen metin → sonuç sayısı → seçildi mi) kaydediliyor mu?"

**Cevap: hayır.** `saveSearchQuery()` YALNIZ başarılı **ve kullanıcı tarafından
seçilmiş** sonucu yazıyordu. Kaydedilmeyen her şey:

- 0 sonuç dönen denemeler
- sonuç dönüp kullanıcının hiçbirini seçmediği denemeler
- fast-fail (2 s) aşımıyla çöpe giden doğru cevaplar
- hangi katmanın cevapladığı (premium / Nominatim / gevşetilmiş / Overpass / cihaz-içi)
- sağlayıcı gecikmesi
- doğrulama filtresinin kaç sonucu eledİĞİ

CAROS LAB kataloğunda adres aramaya ait **hiçbir araç yoktu** (`grep` → 0). Bu, vizyon
belgesinde 2026-08-03'ten beri **açık borç** olarak yazılıydı. Bu turda kapatıldı → §5.

---

## 3 · Ölçülen kusurlar (her biri kanıtlı)

### 3.1 · Overpass "son şansı" adlı sokaklarda YAPISAL OLARAK ÖLÜ ⭐ baskın kök

`extractStreetQuery` gövdeyi sorgunun **başından** yakalıyor → şehir ve mahalle adı
regex'e giriyor. Ürünün ürettiği desen ile öneksiz kontrol **yan yana** ölçüldü:

| Aranan yol | Ürünün ürettiği regex | Sonuç | Öneksiz kontrol |
|---|---|---|---|
| Kuvayi Milliye Caddesi @Mersin | `^Mersin Yenişehir Mahallesi Kuvayimilliye ?Cadde.*$` | **YOK** | **VAR** → `Kuvayi Milliye Caddesi` |
| Atatürk Bulvarı @Ankara | `^Ankara Kızılay Atatürk ?Bulvar.*$` | **YOK** | **VAR** → `Atatürk Bulvarı` |
| Gazi Mustafa Kemal Bulvarı @Mersin | `^Mersin Pozcu Gazi Mustafa Kemal ?Bulvar.*$` | **YOK** | **VAR** → `Gazi Mustafa Kemal Bulvarı` |

**Numaralı yollar ETKİLENMİYOR:** `^0*469\.? ?Sokak.*$` → **VAR** (`0469. Sokak`).
Kusur YALNIZ adlı yollarda ve Türk adres sırası (mahalle→sokak) yüzünden
**neredeyse her gerçek sorguda** tetikleniyor.

### 3.2 · Yazım/boşluk toleransı yok

OSM'deki ad **`Kuvayi Milliye Caddesi`** (ayrı), kullanıcı **`Kuvayimilliye`**
(birleşik) yazıyor. Nominatim bu farkta **0 sonuç** döndürüyor (4 farklı yazımda da
ölçüldü) ve Overpass yolu §3.1 yüzünden hiç eşleşemiyor. Tek bir sokak, dört
başarısız deneme.

### 3.3 · `_osmType('cd')` → `'Sokak'`

`cd` kısaltması Cadde'ye eşlenmiyor: `"Mersin Yenişehir mah. Kuvayimilliye cd."` →
`^Mersin Yenişehir mah\. Kuvayimilliye ?Sokak.*$` (hem önek hem **yanlış yol tipi**).

### 3.4 · Numara doğrulama koruması ekli biçimleri KAÇIRIYOR

`_NUM_STREET_RE = /(\d{2,5})\s*\.?\s*(sokak|sk|cadde|cd)\b/i`

| Biçim | Koruma | Neden |
|---|---|---|
| `78. Cadde` | ✅ var | tam eşleşme |
| `78. Caddesi` | ❌ **YOK** | `\b` "cadde"den sonra "si" yüzünden başarısız |
| `1204 Sokağı` | ❌ **YOK** | "sokak" ≠ "sokağı" |
| `1204 Bulvarı` | ❌ **YOK** | `bulvar` listede hiç yok |

Bu biçimlerde alakasız uzak sonuç **elenmiyor** — üç saha turunda öğrenilen
"3031 km ötedeki Özbekistan" hatası geri dönebilir. (`streetSearchService`'teki kardeş
regex bu biçimleri kapsıyor → **aynı kavram için iki ayrışmış regex**.)

### 3.5 · Gevşetilmiş adayda mesafe kapısı yok

| Sorgu | Ürünün sunduğu aday |
|---|---|
| `Mersin Akdeniz 5108 Sokak` | **379 km** uzakta (`relaxed`) |
| `Kuvayimilliye Caddesi Yenişehir Mersin` | **696 km** uzakta (`relaxed`) |

#334/#335 koruması **çalışıyor** (otomatik rotaya çevrilmiyor, onay listesi çıkıyor)
ama listedeki adayın mesafesi hiç sorgulanmıyor → sürücüye anlamsız seçenek.

### 3.6 · İki yüzey ayrışması HÂLÂ canlı — 8/30 (%27)

Aynı sorgu, iki yüzey, farklı sonuç:

- Adres zinciri buluyor, harita çubuğu **0**: 4 vaka (`N5`, `A5`, `K2`, `H3`, `S1`)
- Harita çubuğu **daha fazla** buluyor: 4 vaka (`A3` 2→4, `A4` 4→6, `H1` 2→4, `D3` 4→7)

Kök: §1'deki yapısal fark (bias + kısaltma + gevşetme + BYOK yalnız A zincirinde).

### 3.7 · Ayrıştırıcı sorguyu BOZUYOR (saf ölçüm, ağ yok)

Tetikleyicisiz yolda (kullanıcı sadece yer adı yazdığında) `tryParseNavAddress`
**yol tipi sözcüğünü değiştiriyor** — 3/22:

```
"Tarsus Bağlar Mahallesi 0455 Sokak"              → "Tarsus Bağlar Mahallesi 0455 Mahallesi"
"Mersin Yenişehir Mahallesi Kuvayimilliye Caddesi" → "... Kuvayimilliye Mahallesi"
```

Kök: `PLACE_SUFFIX_RE` eşleşmesi **çapasız** aranıyor → cümledeki İLK yer sözcüğünü
("Mahallesi") alıp sondaki gerçek eki ("Sokak") onunla değiştiriyor.

Tetikleyicili yolda ayrı bir kusur — **`İ` (U+0130) indeks kayması** 2/22:

```
"İstanbul Kadıköy Bağdat Caddesi git" → "İstanbul Kadıköy Bağdat Caddesi g"
```

Kök: `'İ'.toLowerCase()` **iki** kod birimi üretir (`i` + birleşen nokta). `lower`
üzerinden hesaplanan tetikleyici indeksi `raw`a uygulanınca kayıyor. Aynı `İ` sorunu
üçüncü bir yerde de ölçüldü: `_TR_CITY_HEAD` regexi ham `"İstanbul …"` ile
**eşleşmiyor** → şehir başı düşürme varyantı İstanbul sorgularında hiç üretilmiyor.

### 3.8 · Kapı numarası hiçbir katmanda yapılandırılmış aranmıyor

3/3 ölçülen vakada en iyi hâl **sokak düzeyi** oldu (`No 25`, `145`, `342` yok sayıldı).
Yapılandırılmış geocoding (`street=`/`housenumber=`) hiçbir zincirde kullanılmıyor.

### 3.9 · Overpass tek uca bağlı

`overpass-api.de` bu ağdan **tamamen erişilemez** (curl `http=000`, ayna
`z.overpass-api.de` çalışıyor). Ayna/yedek yok; uç düşünce son şans katmanı sessizce
ölüyor (fail-soft boş dizi) ve bunun sahada **hiçbir izi kalmıyordu** (§2).

---

## 4 · Çürütülenler (ölçüm hipotezi YIKTI)

Bunlar aranan kırılgan noktalardı ve **kök neden ÇIKMADILAR** — kayıt altına
alınıyor ki bir sonraki turda yeniden aranmasın:

| Hipotez | Ölçüm | Sonuç |
|---|---|---|
| **Türkçe diyakritik duyarlılığı** | `Konya Selcuklu Nalcaci Caddesi` → 4 sonuç · `Istanbul Kadikoy Bagdat Caddesi` → 4 sonuç | ❌ **kök DEĞİL** — diyakritiksiz yazım çalışıyor. `D1`'in başarısızlığı diyakritik değil §3.1/§3.2 kaynaklı (diyakritikli hâli de 0 döndü) |
| **Mahalle/ilçe sırası uyuşmazlığı** | `0469 Sokak Bağlar Mahallesi Tarsus` (ters sıra) → bulundu, 3 km | ❌ **kök DEĞİL** — ters sıra numaralı sokakta sorun değil |
| **Overpass Türkçe harflerde eşleşmiyor** | ürünün istek kurulumuyla `^Atatürk ?Bulvar.*$` → **VAR**, `^Kızılırmak ?Cadde.*$` → **VAR** | ❌ **yanlış alarm** — ilk curl denemesindeki hata kabuk kodlamasındandı, ürün kusuru değil (NFD ile eşleşmiyor ama ürün NFC üretiyor) |
| **Kısaltmalar aramayı öldürüyor** | `Konya Selçuklu Nalçacı cd` → 4 sonuç · `Tarsus Bağlar mh 0469 sk` → açılım varyantıyla bulundu | ⚠️ **kısmen** — #335'te eklenen açılım çalışıyor; kalan kusur §3.3 (`cd`→Sokak) |
| **"Siverek Ofis Parkı" hâlâ bulunmuyor** (2026-08-08 saha kusuru) | 1 sonuç, 1 km | ✅ **düzelmiş** — geç-yanıt önbelleği çalışıyor |

---

## 5 · Kurulan gözlemlenebilirlik (kullanıcı görevinin 2. adımı)

Kayıt yoktu → kuruldu. **Düzeltme değil, ölçüm yolu.**

| Dosya | Rol |
|---|---|
| `src/platform/geo/addressSearchLedger.ts` | SAF defter — sınıflandırma, özet, baskınlık. I/O·timer·`Date.now` YOK |
| `src/platform/geo/addressSearchLedgerStore.ts` | Bounded halka (40), RAM-only, her giriş `try/catch` |
| `src/platform/geocodingService.ts` | `GeocodeTrace` — hangi katman cevapladı + gecikme + elenen sayısı. **WeakMap** ile taşınır (dönüş tipi değişmedi, eşzamanlı arama yarışı yok) |
| `src/platform/mapService.ts` · `addressNavigationEngine.ts` · `MapSearchBar.tsx` | Kayıt + kullanıcı seçimi kanıtı |
| `src/platform/devtools/addressSearch{Sources,Model}.ts` | LAB okuma katmanı + saf görünüm modeli |
| `src/components/devtools/screens/AddressSearchEvidenceScreen.tsx` | LAB ekranı **Adres Arama Kanıtı** (salt-okunur) |

**Dürüstlük sözleşmesi (kilitlerle korunuyor):**
- **"Sonuç döndü" ≠ "aradığı yer bulundu"** — kullanıcı seçmediyse deneme çözülmüş sayılmaz.
- Karara bağlanmış deneme yoksa **oran ÜRETİLMEZ** (`—`, sahte %0 yok).
- Kanıt yetersizse sınıf **`UNKNOWN`** + `confidence` düşer; `UNKNOWN` baskın sebep yarışına girmez.
- Debounce'lu yazımda üretilen ara denemeler **`SUPERSEDED`** → orana girmez.
- **"Önce bunu ölç"**: en çok eksik olan kanıt ekranda gösterilir.

**Gizlilik:** sorgu **metni hiç saklanmıyor**. Defter yalnız `AddressQueryShape`
tutuyor (sözcük sayısı · numaralı yol · ekli tip · kısaltma · kapı no · `İ` harfi ·
yol tipi sınıfı). Store API'si `string` sorgu parametresi **kabul etmiyor** ve bu
regresyon kilidiyle korunuyor. Defter **diske yazılmıyor** — oturum bitince kanıt gider.

**Kabul: 27 birim testi + 12 regresyon kilidi.** `npm run test` 517 dosya yeşil,
`tsc -b` temiz.

---

## 6 · Sebep sınıfı sayımı (30 sorgu · 8 başarısızlık)

| Sınıf | Adet | Kodla çözülür mü |
|---|---|---|
| **ÜRÜN ZİNCİRİ** — veri OSM'de VAR, ürün bulamıyor | **6** | ✅ evet |
| ↳ §3.1 Overpass önek kusuru | 6/6 | ✅ |
| ↳ §3.2 yazım/boşluk toleransı | 4/6 | ✅ |
| ↳ §3.3 `cd`→Sokak | 1/6 | ✅ |
| **VERİ YOK** — OSM boşluğu | **2** | ❌ hayır (BYOK sağlayıcı veya kullanıcı kaydı gerekir) |

Başarısız vakalar: `A1` · `A5` · `K1` · `D1` · `H3` · `S1` (ürün) · `N1` · `N5` (veri).
`A1`/`D1`/`K1`/`S1` **aynı sokağın** dört yazımı; `A5`/`H3` **aynı bulvarın** ikisi →
**iki gerçek adres, altı başarısız deneme.**

Ayrıca başarısızlık sayılmayan ama kullanıcının çöp gördüğü kusurlar: §3.5 (379/696 km
adaylar, 2 vaka) · §3.6 (yüzey ayrışması, 8 vaka) · §3.7 (ayrıştırıcı bozulması,
5 vaka saf ölçümde) · §3.8 (kapı numarası, 3/3 vaka sokak düzeyinde kaldı).

---

## 7 · Sonraki görev önerisi (baskın sebebe göre)

Baskın sebep **tek ve kesin**: §3.1. Öncelik sırası:

1. **`extractStreetQuery` adlı yol gövdesini SONDAN yakala** (şehir/mahalle önekini
   regex'e koyma) + `_osmType('cd')` → `Cadde`. Bu tek düzeltme ölçülen 6 ürün
   başarısızlığının 6'sına dokunuyor. **Numaralı yol davranışı bozulmamalı**
   (0469 bulunmalı, 0455 bulunmamalı — uydurma yasağı).
2. **Boşluk/yazım toleransı** — `Kuvayimilliye` ↔ `Kuvayi Milliye`. Harf seviyesinde
   kesme YASAK (#334 dersi); yalnız boşluk normalizasyonu.
3. **`_NUM_STREET_RE` kapsamını `streetSearchService` kardeşiyle BİRLEŞTİR**
   (`Caddesi`/`Sokağı`/`Bulvarı`) — iki ayrışmış regex tek otoriteye insin.
4. ~~**Gevşetilmiş adaya mesafe kapısı** — 379/696 km listeye girmesin.~~
   ✅ **KAPATILDI (2026-08-12, kütük #547)** — ölçüm kusurun daha geniş olduğunu
   gösterdi: mesafe zincirin HİÇBİR yerinde karar değişkeni değildi (şehirsiz
   sorguda en yakın aday listenin üçüncüsü; şehir belirtilmiş sorguda yakınlık
   istenen şehri eziyordu). `geo/locationBiasGate` ile çözüldü: şehir yoksa
   EN YAKIN öncelikli, şehir varsa O ŞEHİR kesin. Cihazda doğrulanmadı.
5. **Ayrıştırıcı düzeltmesi** (§3.7): `PLACE_SUFFIX_RE` çapası + `İ` indeks kayması.
   `İ` kusuru **üç ayrı yerde** — tek otoriteye indirilmeli.
6. **İki yüzeyi tek zincire indir** (§3.6) — `searchPlaces` ile `geocodeAddress`
   ayrı kalacaksa en az bias/kısaltma/BYOK paritesi kurulmalı.
7. **Enstrümantasyon borcu:** `QUERY_INTEGRITY` (ayrıştırıcı bozulması üründe
   ölçülmüyor) ve `GROUND_TRUTH` (ürün "veri OSM'de var mı" sorusunu sormuyor) —
   LAB ekranı bu ikisini "önce bunu ölç" olarak gösteriyor.

---

## 8 · Ölçüm yönteminin sınırları (dürüstlük)

- Ölçüm **geliştirme makinesinden** yapıldı, cihazdan değil. Mobil veri gecikmesi ve
  head unit WebView davranışı DAHİL DEĞİL → §3.9'daki 2 s fast-fail etkisi sahada
  daha ağır olabilir.
- Cihaz-içi katmanlar (IndexedDB geçmişi, `poi.db` FTS5) test ortamında **yok** →
  ölçüm "POI DB indirilmemiş cihaz" durumunu temsil eder. İndirilmiş cihazda bazı
  başarısızlıklar cihaz-içi kaynaktan kapanabilir.
- İlk Overpass koşumunda `overpass-api.de` erişilemediği için tüm yer gerçeği
  sorguları düştü; ölçüm çalışan aynayla (`z.overpass-api.de`) tekrarlandı. Bir ara
  ayna (`overpass.osm.ch`) 200 dönüp **boş** sonuç verdi — yalnız İsviçre verisi
  tutuyor. Kontrol sorgusu (`Atatürk Bulvarı` OSM'de var mı) bu yanlış "veri yok"
  sonucunu yakaladı; kontrol olmasaydı rapor yanlış olurdu.
- Ölçüm seti 30 sorgudur ve **temsili**, istatistiksel değil. Kullanıcının gözlediği
  ~%40 ile ölçülen %27 aynı büyüklük mertebesinde; kesin oran ancak §5'teki defter
  gerçek cihazda dolduktan sonra söylenebilir.

---

## 9 · Kütük bağı

`docs/DEVICE_VALIDATION_LEDGER.md` → **#543** (defter + LAB yüzeyi) · **#544**
(Overpass önek kusuru) · **#545** (mesafe kapısı + koruma kapsamı + tek uç).
Üçü de 🔴 **cihazda test edilmedi**.
