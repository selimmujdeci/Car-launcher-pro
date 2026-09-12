# CarOS Pro — Türkiye MapData Source Exploration + Government/Municipal Benchmark

**Araştırma/ölçüm tarihi:** 2026-09-07
**Kapsam:** Tarsus, Mersin dense urban, Erdemli low-density sabit bounded AOI'leri
**Amaç:** Ticari belge henüz kapanmadı diye teknik değeri erken elemeden, OSM üstündeki gerçek veri katkısını ölçmek
**Karar düzeyi:** CODE/desktop evidence; DEVICE PASS veya FIELD PASS değildir
**Hukuk notu:** Lisans/izin değerlendirmesi teknik release gate girdisidir, hukuki danışmanlık değildir.

## 1. Sonuç — önce karar

Bu turda yasal ve resmî yoldan gerçek payload'ı alınabilen kaynaklar **OSM**, **Overture Maps 2026-08-19.0** ve **GeoNames TR günlük extract** oldu. Yenişehir açık veri paket metadatası erişilebildi ancak payload sunucusu tur sırasında hata verdi; Tarsus standart WFS isteği `401`, KGM ArcGIS dizini `403` döndürdü; Mersin/Erdemli için resmî public vector export bulunmadı; HGM ATLAS için hesap/API anahtarı oluşturulmadı. Erişim kontrolü aşılmadı, oturum yeniden kullanılmadı, private/undocumented endpoint tüketilmedi ve yasak bulk download yapılmadı.

**Kanıtlanmış OSM üstü production-truth artışı üç AOI'de tüm kategoriler için 0'dır.** Bu, aday olmadığı anlamına gelmez: Mersin dense AOI'de Overture Places, OSM exact-name/75 m eşleştirmesinden sonra **71 olası yeni POI**, bunun içinde temel kalite filtresini geçen **31 aday** verdi. Fakat bağımsız resmî/saha doğrulaması olmadığı için 31 sayısı “gerçek yeni POI” değil, bounded shadow inceleme kuyruğudur.

En büyük teknik fırsat **POI/place enrichment** tarafındadır. Bina tarafında önceki canonical hüküm değişmedi:

> **MICROSOFT ML GEOMETRY RESCUE FAIL → yalnız GAP EVIDENCE. OSM canonical building geometry baseline'dır.**

Overture Transportation'ın üç TomTom-only segmentinden her AOI'de yalnız biri geometrik “novel candidate” eşiğini geçti; hiçbirinin adı/sınıfı kullanılabilir değildi ve bağımsız doğrulama yapılmadı. Yol, yol adı, adres ve boundary için doğrulanmış ek kazanç **0** kaldı.

Bu nedenle yalnız **bounded Overture Places SourceAdapter/evidence seam** yapıldı. MapLibre, canonical MapStore, Navigation, Search veya CEH'ye hiçbir yeni kaynak bağlanmadı.

## 2. İki ayrı uygunluk ekseni

Bu turda uygunluk tek bir `commercial yes/no` alanına sıkıştırılmadı:

- **Development/evaluation:** `DEV_ALLOWED` veya `DEV_RESTRICTED`. Yalnız resmî erişim yolu, bounded kapsam, şart uyumu ve auth/kota koşullarına bakar. Commercial release belgesinin henüz kapanmamış olması tek başına benchmark'ı durdurmaz.
- **Commercial release:** `RELEASE_ALLOWED`, `ATTRIBUTION_REQUIRED`, `PERMISSION_REQUIRED`, `RELEASE_BLOCKED`, `UNKNOWN`. `PERMISSION_REQUIRED`, `RELEASE_BLOCKED` ve `UNKNOWN` release'e daima fail-closed'dur.
- **Technical role:** `CANONICAL_CANDIDATE`, `ENRICHMENT_CANDIDATE`, `GAP_EVIDENCE`, `REFERENCE_ONLY`, `QUALITY_REJECTED`.

Attribution yalnız bir yükümlülüktür; commercial use, redistribution, offline packaging veya ayrıca gerekli kamu izninin yerine geçmez.

## 3. Yöntem ve karşılaştırılabilir AOI'ler

Önceki bina shootout'uyla aynı kutular kullanıldı:

| AOI | BBOX `[west,south,east,north]` | Morfoloji |
|---|---|---|
| Tarsus | `[34.85985,36.9157,34.86435,36.9193]` | Bahçeli/müstakil doku |
| Mersin dense | `[34.6304,36.8093,34.6374,36.8149]` | Yoğun apartman/karma ticaret |
| Erdemli low-density | `[34.29,36.6318,34.298,36.6382]` | Düşük yoğunluk/çeper |

Erişim ve ölçüm:

1. OSM ana API yalnız bu üç küçük BBOX için alındı; bu endpoint production bulk kaynağı olarak kullanılmadı. OSM'in [API kullanım politikası](https://operations.osmfoundation.org/policies/api/) korunur.
2. Overture'ın resmî `overturemaps-py 1.0.2` istemcisi, STAC bbox pushdown ve pinli `2026-08-19.0` release ile kullanıldı. Storage bbox false-positive'lerini elemek için geometri–AOI exact intersection uygulandı; GERS ID ile dedupe edildi. [Resmî istemci](https://docs.overturemaps.org/getting-data/overturemaps-py/) ve [release takvimi](https://docs.overturemaps.org/release-calendar/) kanıtıdır.
3. GeoNames resmî `TR.zip` günlük extract'i indirildi ve koordinatla aynı AOI'lere filtrelendi. [Export](https://www.geonames.org/export/) · [format/lisans notu](https://download.geonames.org/export/dump/readme.txt)
4. Bina sonuçları aynı gün üretilmiş önceki `mapdata-source-benchmark-20260907/shootout.json` artefaktından release/AOI değiştirilmeden taşındı.

Eşleştirme sınırları:

- Overture segment ile OSM way aynı segmentasyon birimi değildir; ham kayıt oranı kalite veya gain değildir.
- Road geometry agreement yalnız Overture kaydının taşıdığı OSM way provenance'ına göre ölçüldü.
- “Novel road candidate”: non-OSM kaynaklı, en az 20 m, OSM yol geometrilerine medyan uzaklığı 15 m'den fazla segment. Bu bir gerçeklik doğrulaması değildir.
- POI duplicate: normalize exact-name ≤75 m; ayrıca adı farklı en yakın OSM POI ≤20 m raporlandı. Bu yöntem yazım varyantlarını kaçırabileceği için 71, olası artış için üst sınıra yakın aday sayısıdır.
- POI “quality-qualified”: ad+kategori, confidence ≥0.70, kalıcı kapalı değil, aynı kaynakta yakın exact-name duplicate değil ve bariz telefon/URL/çok uzun ad kirliliği yok. Sağlayıcı confidence'ı canonical trust değildir.
- Bağımsız ortofoto, belediye kayıt onayı veya saha gözlemi olmadığı yerde gerçek dünya doğrulaması `UNKNOWN`; publishable gain `0` tutuldu.

## 4. Same-AOI shootout

### 4.1 Building footprints

| AOI | OSM footprint | Overture total `(OSM / ML / other)` | OSM-derived agreement | ML alan davranışı | Verified independent gain |
|---|---:|---:|---|---|---:|
| Tarsus | 11 | 123 `(11 / 112 / 0)` | 11/11 ID; median centroid 0 m; area ratio 0.999999; approx IoU 1.00 | OSM median 162.43 m², ML 73.56 m²; ML ~2.21× küçük | 0 |
| Mersin dense | 28 | 435 `(28 / 407 / 0)` | 28/28 ID; median centroid 0 m; area ratio 0.999999; approx IoU 1.00 | OSM 389.22 m², ML 135.48 m²; ML ~2.87× küçük | 0 |
| Erdemli | 1 | 113 `(1 / 112 / 0)` | 1/1 ID; centroid 0 m; area ratio 0.999999; approx IoU 1.00 | OSM 267.86 m², ML 98.11 m²; ML ~2.73× küçük; n=1 | 0 |

Overture OSM-derived geometrisi baseline'ın kimlikli aynasıdır; independent gain vermez. `otherFamilies=0`. ML count yüksek olsa da önceki kör rescue örneğindeki **4/189 = %2.12** sonuç ve sistematik küçük alan davranışı nedeniyle canonical kabul edilemez. Freshness veya çok kayıt, geometri doğruluğunun yerine geçmez.

### 4.2 Roads, class, topology ve navigation enrichment

| AOI | OSM ways | Overture road segments | Source rows | Non-OSM / novel candidate | Mapped geometry agreement | Class conflict | Verified real new road |
|---|---:|---:|---|---|---|---:|---:|
| Tarsus | 40 | 100 | OSM 97, TomTom 3 | 3 / 1; 77.24 m, median OSM distance 25.62 m | median 0 m; p95 <0.001 m | 0/97 | 0 |
| Mersin dense | 89 | 186 `(+2 non-road)` | OSM 183, TomTom 3 | 3 / 1; 126.08 m, median distance 29.12 m | median 0 m; p95 <0.001 m; max edge effect 137.53 m | 0/183 | 0 |
| Erdemli | 20 | 30 | OSM 29, TomTom 1 | 1 / 1; 129.31 m, median distance 72.31 m | median 0 m; p95 616.93 m; segmentation/AOI-edge mismatch | 4/28 | 0 |

Novel üç adayın tamamı adsız, `class=unknown` ve TomTom-only'dir. OSM'de gerçekten eksik yol olduklarını doğrulayacak ikinci otorite yoktur; `GAP_EVIDENCE` kalırlar.

Overture'ın [Transportation guide](https://docs.overturemaps.org/guides/transportation/) ve [segment schema](https://docs.overturemaps.org/schema/reference/transportation/segment/) alanları ile ölçülen navigation attributes:

| AOI | bridge | tunnel | link/ramp | speed-limit | access restriction | prohibited transition | surface | width | lane count |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Tarsus | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Schema alanı yok |
| Mersin | 0 | 0 | 1 | 14 | 29 | 0 | 12 | 0 | Schema alanı yok |
| Erdemli | 4 | 0 | 1 | 0 | 4 | 0 | 4 | 0 | Schema alanı yok |

Bu attribute sayıları OSM üstü gerçek gain değildir: Mersin/Erdemli kayıtlarının çoğu OSM-derived'dır ve bu turda alan-bazlı source-to-source ground-truth doğrulaması yapılmadı.

### 4.3 Street names

| AOI | OSM named ways / unique names | Overture named segments / unique names | OSM-mapped segmentte additional name | Conflict |
|---|---:|---:|---:|---|
| Tarsus | 8 / 7 | 25 / 7 | 0 | 0 |
| Mersin dense | 64 / 51 | 156 / 52 | 0 | 1: Overture `5353 Sokak`, mapped OSM `5326 Sokak` |
| Erdemli | 18 / 11 | 27 / 11 | 0 | 0 |

Mersin'deki 52'nci benzersiz ad güvenilir artış değildir; aynı provenance eşlemesinde çatışmadır. Erdemli Overture listesinde görülen `Köypınarı Caddesi`, mevcut AOI içi OSM way listesine yeni mapped-name olarak bağlanmadığı için artış sayılmadı.

### 4.4 Address / house number

| AOI | OSM address / housenumber | Overture Address | Complete street↔number | Garbage/phone-like | Verified gain |
|---|---:|---:|---:|---:|---:|
| Tarsus | 0 / 0 | 0 | 0 | 0 | 0 |
| Mersin dense | 1 / 1 | 0 | 0 Overture; OSM kaydı `44 A` ↔ `117. Cadde` | 0 | 0 |
| Erdemli | 0 / 0 | 0 | 0 | 0 | 0 |

Overture'ın [Addresses guide](https://docs.overturemaps.org/guides/addresses/) sayfasındaki mevcut ülke listesinde Türkiye yoktur; üç AOI'deki sıfır sonuç bununla uyumludur. Overture Place içindeki provider address yapıları **address truth** sayılmadı ve adaptör bunları canonical address alanlarına taşımadı.

### 4.5 POI / Place

| AOI | OSM POI `(named/categories)` | Overture Places | Exact-name duplicate | ≤20 m spatial/name-unmatched | Possible unique | Quality-qualified | Verified real gain |
|---|---:|---:|---:|---:|---:|---:|---:|
| Tarsus | 2 `(1/2)` | 0 | 0 | 0 | 0 | 0 | 0 |
| Mersin dense | 39 `(24/18)` | 75 | 4 | 8 | 71 | **31** | 0 |
| Erdemli | 1 `(1/1)` | 1 | 0 | 0 | 1 | 0 | 0 |

Mersin quality/freshness ayrıntısı:

- 75/75 ad taşıyor; 48 kategori; 75/75 provider address yapısı taşıyor.
- Within-source exact-name/25 m duplicate: 0.
- Confidence medyan 0.6903; p10 0.3800; p90 0.9606; `<0.50` kayıt 16.
- Şüpheli/temel kalite eksik kayıt 18; bağımsız doğrulama yapılmadan kalan 31 de publishable değildir.
- Upstream satır sayımları observation-level ve üst üste binebilir: `meta 70`, `Foursquare 3`, `Microsoft 1`, `AllThePlaces 1`, `Overture 75`.
- Kaynak update zamanı 2025-06-25—2026-08-14; dataset release 2026-08-19.0.

[Overture Places guide](https://docs.overturemaps.org/guides/places/) bu temanın point/name/category/address/confidence ve record-level source/license taşıdığını doğrular. Eski `categories` alanının planlı kaldırılmasına karşı adaptör `taxonomy.primary → basic_category → categories.primary` sırasını uygular.

### 4.6 Place ve boundary yardımcı kaynakları

- GeoNames: Tarsus 0, Mersin 1 (`Mithatpaşa`, `PPLX`, modification `2025-05-11`), Erdemli 0. OSM exact-name/100 m eşleşmesi yok; fakat bağımsız otoriter doğrulama da yok. Teknik rol `REFERENCE_ONLY`.
- Overture Divisions exact-intersect: Tarsus 7, Mersin 9, Erdemli 5. Her AOI'de OSM kaynak zinciri var; bazı üst düzey alanlarda Esri Community Maps + OSM birlikte. Independent boundary gain yok. [Divisions guide](https://docs.overturemaps.org/guides/divisions/)
- geoBoundaries `gbOpen/TUR/ADM2`: 2021, OSM/OSM Boundaries kökenli olduğu için baseline'dan bağımsız değil. [Resmî API kaydı](https://www.geoboundaries.org/api/current/gbOpen/TUR/ADM2/)
- geoBoundaries `gbHumanitarian/TUR/ADM2`: 2020, HGM/HDX kaynak notu ve “Other - Humanitarian” lisans etiketi; release için yeterli redistribution/offline kanıtı değil. [Resmî API kaydı](https://www.geoboundaries.org/api/current/gbHumanitarian/TUR/ADM2/)

## 5. Source discovery — erişim, kapsam, tarih ve haklar

### 5.1 Gerçek payload alınanlar

| Source/theme | Gerçek vector/veri | Bina | Yol / ad / nav | Address | POI/place | Boundary | Release/freshness | Resmî erişim | Attribution/lisans özeti |
|---|---|---|---|---|---|---|---|---|---|
| OSM | Evet; node/way/relation vector | Polygon | Evet; geometry, name, class ve tag bazlı nav | Evet | Evet | Evet | Sürekli düzenlenen DB; seçili kayıtlar 2011–2026 | Bounded Map API; production için planet/extract/replication | ODbL 1.0; attribution + share-alike. [Copyright](https://www.openstreetmap.org/copyright) |
| Overture Buildings | Evet; GeoParquet polygons | Evet | — | Yapı attrs olabilir | — | — | `2026-08-19.0`; aylık takvim | Resmî Python/STAC/cloud download | Distribution + record-level lisans birlikte izlenmeli. [Attribution](https://docs.overturemaps.org/attribution/) |
| Overture Transportation | Evet; segment/connectors | — | Evet; geometry/name/class, connector, bridge/tunnel/link, restriction/speed/surface | — | — | `2026-08-19.0`; source dates 2011–2026 | Resmî Python/STAC/cloud download | Çoğu yerel kayıt OSM/ODbL; TomTom enrichment record provenance ile taşınmalı |
| Overture Addresses | Evet; point | — | Street alanı | Evet | — | — | `2026-08-19.0`; Türkiye current coverage listesinde yok | Resmî Python/STAC/cloud download | Payload 0; teknik kullanım yok |
| Overture Places | Evet; point | — | — | Provider address struct | Evet | — | `2026-08-19.0`; local source dates 2025-06—2026-08 | Resmî Python/STAC/cloud download | CDLA-Permissive/Apache/diğer record lisansları; required attribution/NOTICE kayıt bazında korunmalı |
| Overture Divisions | Evet; polygons | — | — | — | Place names | Evet | `2026-08-19.0` | Resmî Python/STAC/cloud download | Yerel kayıtlar OSM ve Esri+OSM; independent gain yok |
| GeoNames TR | Koordinatlı point table | — | — | — | Place/toponym | Admin kodları, polygon değil | Günlük extract; Mersin satırı 2025-05-11 | Resmî ZIP download | CC BY 4.0 + GeoNames attribution |

### 5.2 Kamu/belediye — varlığı doğrulanan fakat payload benchmark'ı yapılamayanlar

| Source | Teknik veri kanıtı | Tarih/kadans | Resmî erişim sonucu | DEV | Release sonucu |
|---|---|---|---|---|---|
| TUCBS / ATLAS datasetleri | TUCBS WFS/WMS/WCS/WMTS ve açık veri mekanizmasını tanımlar; Bina, ulaşım vb. temalar mümkün, fakat kaynak ailesi tek dataset değildir | Dataset bazında | Mersin üç AOI için açık, lisans metadatası net, çalışan belirli vector WFS/download doğrulanamadı | `DEV_RESTRICTED`: yalnız datasetin resmî servis/şartları izin verirse | Genel kurallar redistribution/sale/derived financial use üzerinde kısıt taşır; açık dataset özel belgesi olmadan `PERMISSION_REQUIRED/RELEASE_BLOCKED`. [Usul ve esaslar](https://tucbs.gov.tr/cografi-veri-erisim-paylasim-ve-kullanimina-iliskin-usul-ve-esaslar-2/) · [izin yönetmeliği](https://tucbs.gov.tr/wp-content/uploads/2024/12/COGRAFI-VERI-IZINLERI-YONETMELIGI.pdf) |
| HGM TOPOVT | Gerçek ESRI GDB/MDB/SHP; 1:15k–1:25k, 365 feature type; yapı/ulaşım ve bridge/tunnel topografyası | Türkiye üretimi 2019 tamamlanmış; yılda 7–8/76 bölge, yol/köprü/tünel/altgeçit yaklaşık 2 yıllık çevrim | Ücretli ürün; sayfa alıcıyı kamu/yükseköğrenimle sınırlar | `DEV_RESTRICTED`; bu turda meşru temin yetkisi yok | `RELEASE_BLOCKED/PERMISSION_REQUIRED`; açık ticari offline hakkı yok. [Ürün](https://www.harita.gov.tr/urun/turkiye-topografik-veritabani-topovt-verisi/288) · [kullanım kısıtları](https://www.harita.gov.tr/sayisal-cografi-urun-ornekleri/sayfa/13) |
| HGM ATLAS API | Harita tile, arama, geocode ve route API; ham road/building vector export doğrulanmadı | Service-current; dataset cutoff bilinmiyor | Resmî hesap/API key ve kota gerekir; hesap açılmadı | `DEV_RESTRICTED` | Kurumsal sözleşme/izin ve offline redistribution belgesi gerekir. [API](https://api.harita.gov.tr/) · [ücret/kota](https://api.harita.gov.tr/atlasapidoc/ucret) |
| Mersin Büyükşehir CBS/MAKS | 2025 faaliyet raporu aylık MAKS CSBM/kapı numarası, imar yolu ve kırsal yol DB çalışmalarını doğrular; public export değil | Operasyonel süreçler aylık/2025 raporu; satır cutoff'u yok | Public WFS/vector download bulunamadı | `DEV_RESTRICTED` | `PERMISSION_REQUIRED`. [2025 faaliyet raporu](https://www.mersin.bel.tr/uploads/files/2025faaliyetraporucompressed73842334-797090.pdf) |
| Tarsus Kent Rehberi/KEOS | Viewer mevcut; cadde, adres, POI ve plan katmanları olası, fakat raw vector şeması alınamadı | Bilinmiyor | Resmî viewer açıldı; standart WFS GetCapabilities `401`, duruldu | `DEV_RESTRICTED` | `PERMISSION_REQUIRED` |
| Erdemli Bulut KBS | 2024 raporu Kent Rehberi, Numarataj, Altyapı, Önemli Yerler, Halihazır modüllerini doğrular | 2024 raporu; dataset cutoff/kadans bilinmiyor | Public vector API/download bulunamadı | `DEV_RESTRICTED` | `PERMISSION_REQUIRED`. [2024 faaliyet raporu](https://www.erdemli.bel.tr/tema/akdeniz/uploads/faaliyet_raporlari/dosya/ERDEMLY_BELEDYYESY_2024_YILI_FAALYYET_RAPORU_2024_EN_SON_HALY_MECLYSE_GYDEN.pdf) |
| Yenişehir Belediyesi Açık Veri | Cadde ve sokak isimleri SHP; ayrıca sınır/okul/park gibi vector paket sayfaları | Cadde dataset sayfası 2025-06-20 güncel | Metadata bulundu; portal payload host'u bu turda `502/timeout` verdi | Paket düzeyi resmî download döndüğünde `DEV_ALLOWED`; sokak resource lisans belirsizliği için `DEV_RESTRICTED` | Portal genel lisansı commercial use/distribution + attribution der; ancak specific street resource “No License Provided” ve Türkiye izin değerlendirmesi açık → `PERMISSION_REQUIRED`. [Lisans](https://acikveri.yenisehir.bel.tr/license) · [cadde dataset](https://acikveri.yenisehir.bel.tr/dataset/yenisehir-ilcesi-cadde-ve-sokak-isimleri) · [sokak resource](https://acikveri.yenisehir.bel.tr/dataset/yenisehir-ilcesi-sokak-isimleri/resource/26ded5d4-2c1c-4f6b-91b1-4727f41f1d5c) |
| KGM | 2026 PDF/raster karayolu haritaları ve public viewer; ham vector service doğrulanmadı | 2026 haritaları | Public sayfa erişilebilir; ArcGIS directory `403`, aşılmadı | `DEV_RESTRICTED/REFERENCE_ONLY` | `PERMISSION_REQUIRED`. [Haritalar](https://www.kgm.gov.tr/Sayfalar/KGM/SiteTr/Root/Haritalarr.aspx) |
| TKGM parcel viewer | Parsel/ada referansı; building footprint veya navigasyon/address bulk kaynağı değil | Bilinmiyor | Public viewer; resmî bulk vector API doğrulanmadı | `DEV_RESTRICTED/REFERENCE_ONLY` | `PERMISSION_REQUIRED` |

### 5.3 Diğer global/akademik kaynaklar

| Source | Değer | DEV | Release / teknik karar |
|---|---|---|---|
| Foursquare Open Source Places | Global POI point/vector, zengin kategori/attribute. Standalone erişim Places Portal hesabı/token veya ilan edilen PMTiles yoluyla; hesap oluşturulmadı. [Ürün](https://docs.foursquare.com/data-products/docs/fsq-places-open-source) · [erişim](https://docs.foursquare.com/data-products/docs/access-fsq-os-places) | `DEV_RESTRICTED` | Apache-2.0 NOTICE/attribution + Türkiye release izni kapanmalı; `ENRICHMENT_CANDIDATE`, unmeasured standalone |
| geoBoundaries | Gerçek boundary polygon/API | `DEV_ALLOWED` | `gbOpen` OSM-derived/redundant; humanitarian lisansı yetersiz → `REFERENCE_ONLY` / `PERMISSION_REQUIRED` |
| OpenAddresses | Kaynak-ağırlıklı address pipeline; current source tree'de `sources/tr` yok, Türkiye source'u doğrulanmadı. [Source tree](https://github.com/openaddresses/openaddresses/tree/master/sources) | `DEV_ALLOWED` | Türkiye coverage yok → `QUALITY_REJECTED` for current task |
| Natural Earth | Public-domain global vector roads/places/boundaries; 1:10m/1:50m/1:110m ölçek | `DEV_ALLOWED` | Commercial kullanılabilir fakat şehir navigasyonu için aşırı kaba → `QUALITY_REJECTED`, yalnız overview reference. [Terms](https://www.naturalearthdata.com/about/terms-of-use/) |
| Google Open Buildings | Polygon dataset, fakat resmî country coverage'da Türkiye yok; Temporal ürün footprint vector değil | `DEV_ALLOWED` where covered | Türkiye için `REFERENCE_ONLY/QUALITY_REJECTED`. [Open Buildings](https://sites.research.google/gr/open-buildings/) |
| OpenBuildingMap | OSM + Microsoft/Google aggregation; Türkiye'de bağımsız otoriter truth değil | `DEV_ALLOWED` | OSM/MS tekrarından incremental canonical kanıt üretmez → `QUALITY_REJECTED` |
| GlobalBuildingAtlas | OSM/MS alt kümesi; yeni bazı bölümler non-commercial | `DEV_RESTRICTED` | Bağımsız Turkey canonical gain kanıtı yok; NC bölüm commercial release'e `RELEASE_BLOCKED` |

## 6. Teknik sınıflandırma ve CarOS'a alınacaklar

1. **OSM — CANONICAL_CANDIDATE / mevcut baseline:** Geometri truth rolü değişmedi. Gerçek offline snapshot/release ID, ODbL attribution/share-alike ve Türkiye release dosyası kapanmadan commercial release eligible değildir.
2. **Overture Places — ENRICHMENT_CANDIDATE:** Bu turdaki tek anlamlı bounded aday. Mersin'deki 31 kalite-adayı ikinci kaynak/field doğrulamasına değer. Bounded adapter yapıldı; resolver/MapStore'a bağlı değil.
3. **Overture Transportation — GAP_EVIDENCE:** OSM source mapping'i çok iyi ve nav attribute araştırması yararlı; üç adsız TomTom candidate gerçek yol olarak doğrulanmadı. Canonical yol kaynağı yapılmadı.
4. **Overture OSM-derived Buildings — CANONICAL_CANDIDATE mirror:** OSM geometrisini bozmuyor fakat gain 0.
5. **Microsoft ML Buildings — GAP_EVIDENCE:** Count yüksek, geometri rescue başarısız; karar değişmedi.
6. **Yenişehir SHP — REFERENCE_ONLY bugün, en güçlü kamu benchmark hedefi:** Çalışan resmî payload alındığında road/name canonical-candidate ölçümüne girebilir; ölçülmeden truth değildir.
7. **TUCBS/HGM/belediye iç sistemleri — REFERENCE_ONLY bugün:** Teknik potansiyel yüksek ama erişilebilir dataset payload'ı veya izin zinciri yok.
8. **GeoNames — REFERENCE_ONLY:** Tek toponym candidate bağımsız doğrulanmadı.
9. **Natural Earth/OpenAddresses-current-Turkey/aggregated building setleri — QUALITY_REJECTED** bu şehir ölçeği görevi için.

## 7. Yapılan bounded implementation

Akışın otorite yönü korunarak şu parçalar eklendi:

```text
Official bounded snapshot (benchmark script only)
  → overturePlaceAdapter (pure SourceAdapter)
  → MapSourceObservation / provenance-preserving evidence
  → [NOT CONNECTED] entity matching / resolver / MapStore / Navigation / Renderer
```

Adapter şunları korur:

- `sourceId=OVERTURE`, GERS `sourceFeatureId`, pinli dataset release;
- her upstream dataset, record-level license ve en yeni source `update_time`;
- geometry quality taşıyıcıları, provider `sourceConfidence` ve freshness;
- tek canonical `EvidenceGrade` sözlüğünden `OBSERVED` veya kalıcı kapalıysa `UNAVAILABLE`;
- ad/kategori; freeform address ve telefon canonical alana geçirilmez;
- Eylül şema değişimine karşı yeni taxonomy alanı önceliği.

Aynı gerçek nesne gözlemleri overwrite edilmez. Provider confidence resolver güvenine dönüştürülmez. Adapter ağ/dosya/saat erişimi yapmaz; I/O benchmark scriptinde kalır.

## 8. Commercial Release Gate ve attribution seam

Yeni governance sözleşmesi iki kapıyı ayırır:

### Development benchmark gate

Geçmesi için resmî erişim, bounded istek, access-control uyumu, kullanım şartı uyumu ve varsa `DEV_RESTRICTED` koşullarının karşılanması gerekir. Release status'a bakmaz.

### Commercial/offline release gate

Aşağıdakilerin **tamamı** olumlu ve kayıtlı olmadan `eligible=false`:

- release classification yalnız `RELEASE_ALLOWED` veya `ATTRIBUTION_REQUIRED`;
- dataset ID ve pinli release ID eşleşmesi;
- source ID eşleşmesi;
- terms/license sürümü ve canonical terms URL;
- gerekli license/permission/NOTICE/attribution document ID'leri;
- record-level license audit;
- commercial use + redistribution + offline packaging hakları;
- gereken attribution metni, linkleri ve release uygulama kanıtı.

`UNKNOWN`, `PERMISSION_REQUIRED` ve `RELEASE_BLOCKED` doğrudan kapanır. Existing `effectiveLicensePolicy` tek hak otoritesi olarak kullanılır; ikinci lisans motoru kurulmadı.

Merkezi metadata registry/projection gelecekte **Ayarlar → Hakkında → Harita Verileri / Kaynaklar ve Lisanslar** ekranına şu alanları verir: provider, dataset, version/release, license, attribution text, required links, permission status. UI yapılmadı ve metadata farklı ekranlara hard-code edilmedi.

Bugünkü registry'de hem OSM baseline hem Overture Places `PERMISSION_REQUIRED` durumundadır: bu development/canonical teknik rolü bozmaz; satış paketine pinli snapshot, attribution/share-alike/NOTICE planı ve Türkiye coğrafi veri izin incelemesi kaydedilmeden girmelerini engeller.

## 9. Shadow ve production etkisi

- Bounded data comparison artefaktı üretildi; ham payload yerel cache'te, repo commit'inde yalnız deterministik script ve derived summary tutulur.
- Overture Places adapter shadow/evidence seam'i hazır; gerçek entity match + ikinci otorite validation olmadığı için publishable shadow tile üretilmedi.
- **Shadow sonucu:** Mersin'de 31 quality-qualified POI candidate; Tarsus 0; Erdemli 0. Verified/publishable gain 0.
- **Production bağlantısı:** YOK. MapLibre, MapStore, renderer, routing, Navigation, Search ve CEH değiştirilmedi.
- Building shadow hâlâ **BLOCKED**; ML geometry canonical değildir.

## 10. QA

- Targeted MapData suites: **7 dosya / 119 test PASS**
- New governance + Places adapter tests: **15/15 PASS**
- TypeScript project build (`tsc -b`): **PASS**
- Changed-file ESLint: **PASS, 0 error**
- `npm run guard`: **1004/1004 PASS**
- Full test suite (`npm run test`): **840 dosya / 18.980 test PASS**
- Production build (`npm run build`): **PASS, Vite built in 5m 43s**. Mevcut CSS/plugin chunk-size ve ineffective-dynamic-import uyarıları var; MapData hatası yok.
- Sonuç seviyesi: **CODE PASS adayı**; DEVICE PASS ve FIELD PASS iddiası yok.

## 11. Commitler

- Canonical ML geometry kararı: `8ed91a10`
- Önceki MapData implementation/guard: `2a7f3969`
- Önceki source benchmark report: `324a9c39`
- Bu turun implementation commit'i: `adb52615`

Unrelated media/native/navigation dirty dosyaları değiştirilmedi veya stage edilmedi.

## 12. Sonraki en yüksek değerli 3 iş

1. **Mersin Overture Places 31-aday adjudication:** Resmî belediye/işletme kaydı veya lisanslı ikinci POI kaynağıyla GERS/entity matching; exact-name dışı fuzzy/phone/address duplicate analizi; ilk gerçek precision/recall örneği. Verification olmadan renderer/search'e bağlama.
2. **Yenişehir SHP retry + aynı AOI road/name shootout:** Portal resmî download yeniden erişilebilir olduğunda package/resource license çelişkisini kurumdan yazılı kapat, dosya release/hash kaydet ve yalnız bounded adapter/evidence ingestion yap.
3. **Commercial Release dossier:** OSM/Overture record-license audit, pinli offline snapshot, ODbL share-alike/attribution, Apache NOTICE ve Türkiye coğrafi veri izin kapsamı için hukuk/kurum görüşünü document ID ile gate'e bağla.

## 13. Evidence/source ledger

| Claim | Evidence |
|---|---|
| OSM lisansı ve attribution/share-alike | [OSM Copyright](https://www.openstreetmap.org/copyright) |
| OSM main API yalnız bounded araştırma için kullanıldı | [OSMF API policy](https://operations.osmfoundation.org/policies/api/) |
| Overture release, resmî bbox istemcisi ve attribution | [Release calendar](https://docs.overturemaps.org/release-calendar/) · [Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/) · [Attribution](https://docs.overturemaps.org/attribution/) |
| Overture transport/place/address/division şemaları | [Transportation](https://docs.overturemaps.org/guides/transportation/) · [Segment schema](https://docs.overturemaps.org/schema/reference/transportation/segment/) · [Places](https://docs.overturemaps.org/guides/places/) · [Addresses](https://docs.overturemaps.org/guides/addresses/) · [Divisions](https://docs.overturemaps.org/guides/divisions/) |
| TUCBS erişim ve izin rejimi | [Erişim/paylaşım/kullanım usulleri](https://tucbs.gov.tr/cografi-veri-erisim-paylasim-ve-kullanimina-iliskin-usul-ve-esaslar-2/) · [Coğrafi Veri İzinleri Yönetmeliği PDF](https://tucbs.gov.tr/wp-content/uploads/2024/12/COGRAFI-VERI-IZINLERI-YONETMELIGI.pdf) · [Bakanlık SSS](https://cbs.csb.gov.tr/sss-detay/3088) |
| HGM TOPOVT ve ATLAS erişim kapsamı | [TOPOVT](https://www.harita.gov.tr/urun/turkiye-topografik-veritabani-topovt-verisi/288) · [ürün kısıtları](https://www.harita.gov.tr/sayisal-cografi-urun-ornekleri/sayfa/13) · [ATLAS API](https://api.harita.gov.tr/) · [ücret/kota](https://api.harita.gov.tr/atlasapidoc/ucret) |
| Belediye dataset varlığı | [Mersin 2025 raporu](https://www.mersin.bel.tr/uploads/files/2025faaliyetraporucompressed73842334-797090.pdf) · [Erdemli 2024 raporu](https://www.erdemli.bel.tr/tema/akdeniz/uploads/faaliyet_raporlari/dosya/ERDEMLY_BELEDYYESY_2024_YILI_FAALYYET_RAPORU_2024_EN_SON_HALY_MECLYSE_GYDEN.pdf) · [Yenişehir lisansı](https://acikveri.yenisehir.bel.tr/license) · [Yenişehir cadde dataset](https://acikveri.yenisehir.bel.tr/dataset/yenisehir-ilcesi-cadde-ve-sokak-isimleri) |
| Global yardımcı kaynaklar | [GeoNames export](https://www.geonames.org/export/) · [geoBoundaries API](https://www.geoboundaries.org/api.html) · [Foursquare OS Places](https://docs.foursquare.com/data-products/docs/fsq-places-open-source) · [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) · [OpenAddresses source tree](https://github.com/openaddresses/openaddresses/tree/master/sources) |
| Exact AOI measurements | `derived/benchmark.json`, `run_benchmark.py`, önceki `mapdata-source-benchmark-20260907/shootout.json` |

## Final source decision matrix

| SOURCE | DATA TYPE | OSM INCREMENTAL GAIN | QUALITY | DEV STATUS | RELEASE STATUS | CAROS ROLE |
|---|---|---|---|---|---|---|
| OSM | Building, road, name, address, POI, place, boundary vector | Baseline | En iyi doğrulanmış açık baseline; yerel eksikler var | DEV_ALLOWED | PERMISSION_REQUIRED until pinned package + release dossier; ODbL attribution/share-alike | CANONICAL_CANDIDATE / current baseline |
| Overture Buildings — OSM-derived | Building polygon | 0 verified | OSM ile 40/40 identity; independent değil | DEV_ALLOWED | PERMISSION_REQUIRED | CANONICAL_CANDIDATE mirror, no gain |
| Microsoft ML Buildings via Overture | Building polygon | +631 raw across AOIs; **0 verified/canonical** | Systematic small-area bias; rescue fail | DEV_ALLOWED | RELEASE_BLOCKED for CarOS canonical path | GAP_EVIDENCE |
| Overture Transportation | Road geometry/name/class/nav attrs | 3 geometric candidates; **0 verified real road**, 0 verified name | OSM-derived agreement high; non-OSM candidates unnamed/unknown; Erdemli class/edge conflicts | DEV_ALLOWED | PERMISSION_REQUIRED; record licenses/ODbL obligations | GAP_EVIDENCE |
| Overture Addresses | Address/housenumber point | 0 | Türkiye current coverage yok | DEV_ALLOWED | PERMISSION_REQUIRED if coverage arrives | REFERENCE_ONLY |
| Overture Places | POI/place point + category + provider address | Mersin 71 possible / 31 quality-qualified; **0 verified** | En yüksek teknik fırsat; mixed confidence, independent validation missing | DEV_ALLOWED | PERMISSION_REQUIRED | ENRICHMENT_CANDIDATE; bounded adapter only |
| Overture Divisions | Boundary polygon/place names | 0 independent | OSM/Esri+OSM derived | DEV_ALLOWED | PERMISSION_REQUIRED | REFERENCE_ONLY |
| GeoNames TR | Place/toponym point | Mersin 1 candidate; **0 verified** | Sparse in tiny AOIs; dated point evidence | DEV_ALLOWED | PERMISSION_REQUIRED; CC-BY attribution | REFERENCE_ONLY |
| Yenişehir Açık Veri SHP | Road/street names, boundary, park/school POI packages | Not measured; payload unavailable | Potentially high-value official vector, quality UNKNOWN | DEV_ALLOWED for licensed official download; street resource DEV_RESTRICTED | PERMISSION_REQUIRED | REFERENCE_ONLY → next canonical/enrichment benchmark target |
| TUCBS datasets | Potential building/road/address/boundary WFS/download, dataset-specific | Not measured | Dataset/access/license-specific; no local payload | DEV_RESTRICTED | PERMISSION_REQUIRED / RELEASE_BLOCKED until explicit dataset document | REFERENCE_ONLY |
| HGM TOPOVT | Topographic SHP/GDB: structures, roads, bridge/tunnel | Not measured | High technical potential; 2019 base + partial cadence | DEV_RESTRICTED | RELEASE_BLOCKED / PERMISSION_REQUIRED | REFERENCE_ONLY |
| HGM ATLAS API | Tiles, geocode, search, routing | Not measured | Service useful; raw distributable vector not verified | DEV_RESTRICTED | PERMISSION_REQUIRED / contract | REFERENCE_ONLY |
| Mersin Büyükşehir CBS/MAKS | Address/door, road/name/internal CBS | Not measured | Official internal evidence; no public vector export | DEV_RESTRICTED | PERMISSION_REQUIRED | REFERENCE_ONLY |
| Tarsus KEOS | Viewer; likely road/address/POI layers | Not measured | WFS unauthorized; schema/freshness UNKNOWN | DEV_RESTRICTED | PERMISSION_REQUIRED | REFERENCE_ONLY |
| Erdemli Bulut KBS | Numarataj, kent rehberi, önemli yerler, infrastructure | Not measured | Module existence verified; no public payload | DEV_RESTRICTED | PERMISSION_REQUIRED | REFERENCE_ONLY |
| KGM | National road PDF/viewer; vector unverified | Not measured | Navigation reference only at present | DEV_RESTRICTED | PERMISSION_REQUIRED | REFERENCE_ONLY |
| geoBoundaries | ADM polygons | 0 independent for gbOpen; humanitarian unverified | gbOpen OSM-derived; humanitarian license/source ambiguity | DEV_ALLOWED | ATTRIBUTION_REQUIRED for verified open records; otherwise PERMISSION_REQUIRED | REFERENCE_ONLY |
| Foursquare OS Places standalone | POI/place point/vector | Not measured standalone | High enrichment potential | DEV_RESTRICTED (account/token) | PERMISSION_REQUIRED + Apache NOTICE/attribution | ENRICHMENT_CANDIDATE |
| OpenAddresses current sources | Address | 0; Turkey source absent | No Turkey coverage | DEV_ALLOWED | UNKNOWN per source | QUALITY_REJECTED for Turkey now |
| Natural Earth | Small-scale roads/place/boundary vector | No city-scale meaningful gain | Too coarse for navigation | DEV_ALLOWED | RELEASE_ALLOWED (public domain) | QUALITY_REJECTED for local MapData |
| Google/OpenBuildingMap/GlobalBuildingAtlas | Building polygons/aggregations | 0 verified independent Turkey canonical gain | Coverage absent, redundant OSM/MS, or NC restriction | DEV_ALLOWED/DEV_RESTRICTED by dataset | RELEASE_BLOCKED where NC/rights incomplete | QUALITY_REJECTED or REFERENCE_ONLY |
