**CAROS PRO — Tarsus bina / yol adı / adres kapsam denetimi · 7 Eylül 2026**

**Gerçek cevap:** Tarsus’taki boşluğun ana kaynağı OSM’de eksik bina ve yol adı kapsamıdır; mevcut yerel adlar ayrıca z16 eşiği ve seyrek etiket yerleşimiyle saklanır, taşınan kapı numaralarını ise production style hiç çizmez; 4 Eylül eklemeleri de 30 Ağustos tile paketinde henüz yoktur.

1. **Test konumu ve kanıt sınırı**

   Canonical ölçüm noktası **36.9175 N, 34.8621 E**. `../nav-visual-device-20260907/01-fullscreen-open.png` altındaki koordinat dört ondalıkla okunuyor. Aynı klasördeki PROVENANCE ve cihaz kapanış kütüğü Tarsus/Bağlar, Gazipaşa Bulvarı rotası, 904×406 CSS px, DPR3, MapLibre 4.7.1, APK SHA-256 `600a061f…3b0b0b`, HEAD `dd7861e5` bağlamını doğruluyor.

   Daha hassas **7 Eylül raw GPS kaydı yok**. Önceki günün `../nav-device-20260906/sample-before.json` dosyasındaki 36.9175061 / 34.8621057 yalnız destekleyici kayıttır; sonraki günün exact fix’i diye kullanılmadı. Yeni rastgele konum seçilmedi.

   Merkez kaynak tile: **14/9778/6381**; bbox `[34.8486328125,36.91476428895592,34.87060546875,36.93233006150314]`. Yakın çevre incelemesi yaklaşık 400×400 m: `[34.85985,36.9157,34.86435,36.9193]`. Bunlar kamera viewport’u değildir.

   Canlı cihaz CDP `127.0.0.1:9222` erişilemedi. Güncel tile ölçümü, mevcut repo style’ı, eski cihaz görüntüleri ve host yerleşim deneyi ayrı kanıtlardır. Eski APK’nin indirdiği PBF hash’i kapanış klasöründe yok; güncel PBF’yi eski cihaz cache’iyle byte düzeyinde eşitlemiyoruz.

2. **Source authority map**

   `.env:31` → `VITE_VECTOR_TILE_URL=https://tiles.openfreemap.org/planet` → `mapSourceManager` → `buildVectorStyle()` → `omv` → TileJSON’un sürümlü PBF adresi → MapLibre.

   Ölçülen sağlayıcı: **OpenFreeMap**, OSM türevi/OpenMapTiles şeması. [TileJSON](https://tiles.openfreemap.org/planet) adresi `20260830_080001_pt` paketini gösterdi. Source ve sağlayıcı maxzoom **14**; merkez PBF HTTP `Last-Modified: 30 Aug 2026 15:06:28 GMT`. `tilejson.json`, `summary.json` URL, başlık, zaman ve SHA-256 içerir.

   | Source → tile layer | Style layer | Runtime writer → screen |
   |---|---|---|
   | OpenFreeMap → `building` | `building` fill; `building-3d` extrusion | `applyMapDayNight`, `applyMapDeclutter`; 3B için `updateDrivingLayers` → MapLibre |
   | OpenFreeMap → `transportation` | `road-*`, tunnel/bridge aileleri | palet, NAV_SUPPRESS, declutter/mood → MapLibre |
   | OpenFreeMap → `transportation_name` | `road-label`, `road-label-major`, `road-shield` | style layout; runtime text-opacity → MapLibre yerleşimi |
   | OpenFreeMap → `place` | `place-city/town/village/suburb` | palet/declutter/mood → rank/class/zoom ve collision |
   | OpenFreeMap → `housenumber` | **Tüketici yok** | **Writer ve ekran çıktısı yok** |

   TileJSON’daki gerçek katmanlar: `aerodrome_label`, `aeroway`, `boundary`, `building`, `housenumber`, `landcover`, `landuse`, `mountain_peak`, `park`, `place`, `poi`, `transportation`, `transportation_name`, `water`, `water_name`, `waterway`. Dokuz tile’ın her birinde hepsinin bulunması beklenmez.

   Yerel PBF varsa builder önceliği `smart-tile://` olur; native Filesystem/APK varlıkları kontrol edilir. Bu checkout’un `public/maps/` klasöründe PBF yok, yalnız `poi.db` ve `routing-graph.bin` ile lisans dosyaları var. Bunlar bina footprint’i/etiket tile’ı üretmez. Native cihazın sonradan yüklenen depolaması bu turda okunamadı. Raster fallback ve SW/cache yolları ayrı; bunlar yeni bina veya adres üretmez.

   Uydu: `buildSatelliteStyle()` → Esri World_Imagery raster → `caros-tile://…/tile/{z}/{y}/{x}`, maxzoom17. `satellite-provenance.json` aynı konumun gerçek z17 tile adresini kaydeder. Uydu görüntüsü vektör footprint verisi değildir. Hibrit ayrıca OSM raster yol örtüsü kullanır.

3. **Tile sayımları**

   z15 coğrafi tile `19557/12763`, z16 `39114/25527`; ikisi de production’da **z14/9778/6381 atasıyla overzoom** olur. Z15/z16 için bağımsız, daha zengin production PBF varmış gibi sayım yapılmadı. Host ağ kaydı da z14 isteklerini içerir.

   Aşağıda B = building feature / dış polygon parçası; Y = transportation feature / geometri parçası; A = transportation_name feature; K = housenumber feature; P = place feature.

   | z14 tile x/y | B | Y | A | K | P |
   |---|---:|---:|---:|---:|---:|
   | 9777/6380 | 1 / 9 | 23 / 102 | 6 | 0 | 10 |
   | 9778/6380 | 8 / 255 | 77 / 275 | 30 | 2 | 21 |
   | 9779/6380 | 9 / 322 | 45 / 335 | 53 | 1 | 32 |
   | 9777/6381 | 1 / 3 | 32 / 95 | 8 | 0 | 10 |
   | **9778/6381** | **11 / 351** | **64 / 517** | **117** | **7** | **27** |
   | 9779/6381 | 13 / 497 | 113 / 718 | 272 | 13 | 42 |
   | 9777/6382 | 1 / 1 | 14 / 40 | 1 | 0 | 10 |
   | 9778/6382 | 1 / 27 | 42 / 180 | 87 | 0 | 23 |
   | 9779/6382 | 6 / 432 | 57 / 466 | 239 | 9 | 37 |

   **Feature ≠ bina/yol/adres sayısı.** Sağlayıcı aynı nitelikteki geometrileri birleştiriyor: merkezde bir `building` feature’i tek başına **323 polygon** içeriyor. Polygon iç halkası ikinci bina sayılmadı. Transportation parçalarına merkezdeki bir bridge polygon’u da dahil; 517 sayısı benzersiz sokak sayısı değildir. Tile buffer/sınır tekrarları nedeniyle dokuz tile toplamı benzersiz nesne toplamı değildir. Son komşudaki 9 house-number feature’i 10 geometri parçası içerir.

   Merkez yol sınıfları feature/parça: minor **2/382**, tertiary **31/56**, secondary **17/17**, motorway **8/8**, service **2/34**, path **2/17**, track **1/2**, bridge **1/1**. Her komşunun dağılımı `summary.json` içinde.

   Merkez building: 11/11 feature’da `render_height` var, değerleri **5,8,11,15,19,30,41,44,48,52,59**; `height` 0/11; `hide_3d` alanı yok, filtre **11/11 kabul**. Bu yüksekliklerin hepsi ölçülmüş fiziksel bina yüksekliği sayılamaz; örneğin upstream’de yalnız `building=yes` olanlar da tile’da 5 m taşıyor.

   Merkez ad sınıfları: minor101, tertiary11, secondary4, motorway1. Ad alanları: `name`, `name_int`, `name:latin`, `name_de`, `name_en`; bazı feature’larda `ref`. **100** tile feature’i sayıyla başlayan yol adı taşıyor. `name:tr` bu merkez tile’da yok. Production ad ifadesi mevcut alanlardan okuyup `Sokak→Sk.`, `Bulvarı→Bul.` kısaltıyor.

4. **Building gap**

   Ana OSM [map API](https://api.openstreetmap.org/api/0.6/map.json?bbox=34.8486328125,36.91476428895592,34.87060546875,36.93233006150314) yanıtı 340 building way + 1 building node içeriyor; building relation yok. Tile sınırının içinden seçilmiş kaynak-içi örnek noktası olan **334 polygon’un 331’i** production building polygon’u içinde eşleşti. Bu bir iç-nokta kapsama testidir, bütün köşelerin eşitliği değildir; buffer/kırpma nedeniyle 340 ile 351 doğrudan fark alınmaz.

   Eşleşmeyen üçü: way **1555045507**, **1555045508**, **1555049311**. OSM history hepsinin **version1, 4 Eylül 2026** eklemesi olduğunu doğruluyor. Production paketi **30 Ağustos**. Sonuç: **provider snapshot/güncellik pipeline farkı**; building katmanı unutulmuş değil.

   Merkezin 400×400 m çevresinde **11 kaynak footprint’i / 11 production polygon’u, 11/11 eşleşme** var. Aynı z17 uydu tile’ında görülen üç çatı örneği `(173,90)`, `(159,143)`, `(188,110)` pikselde seçildi. Coğrafi karşılıkları `feature-evidence.json` içinde; her birinde **OSM building bbox adayı0, production building bbox adayı0**. En yakın upstream building köşesi 111–128 m uzaklıkta. Bu örnekler **SOURCE COVERAGE GAP** kanıtıdır. Uydu genelindeki gerçek bina toplamını saymadık, kapsam yüzdesi uydurmadık.

   Style: 2B `building` minzoom14, filtre yok, visibility varsayılan visible, maxzoom yok. `building-3d` minzoom16, maxzoom yok, `hide_3d != true`; merkez feature’larının tamamı kabul ediliyor. Z16’da extrusion yüksekliği **0**, z16.4’te tam yükseklik: yok olan footprint değil, kademeli 3B yükselme. Pitch0 hacmi tepeden gösterir; var olmayan footprint üretmez. Kapanış görüntüleri de z16→16.4 yükselmeyi doğruluyor.

   Runtime: `mapDeclutterModel` 2B DAY FULL/BROWSE1, NAV0.85; NIGHT0.78/0.50; 3B DAY1/0.70, NIGHT0.72/0.40; MINI’de **ikisi0**. `updateDrivingLayers` hız>80 km/h’de yalnız 3B opacity’yi0 yapar; yavaşlayınca palet değerine döner. Yazarlar son yazıma göre birbirini etkileyebilir; bunlar canlı cihazda bu tur ölçülmedi. `mapLiteMode` gizleme listesinde bina yok. Termal/FPS mandalı kaynak modunu raster’a çevirebilir; güncel snapshot’ta gerçekleştiğine kanıt yok. Duran araç FULL ekranındaki geniş footprint boşluğunu hız/thermal diye açıklamak desteklenmiyor.

5. **Street-name gap ve feature kanıtları**

   Ana OSM yanıtındaki **564 highway way’in 138’i adlı, 426’sı adsız**. Residential433’ün **337’si adsız**. Highway taşıyan node’lar yol sayısına dahil edilmedi. Yakın 400×400 m alanda en az bir node’u bulunan **40 yol way’inin 8’i adlı, 32’si adsız**. Bu metrik yol uzunluğu veya şehir geneli kapsama yüzdesi değildir.

   | Upstream way | Upstream ad | Production geometry / ad | Style / sonuç |
   |---|---|---|---|
   | 216760925 | Yok, residential | minor geometri var; örnek noktaya0.104 m | Ad üretilemez → source gap |
   | 216760900 | Yok, residential | minor geometri var; örnek noktaya0.006 m | Ad üretilemez → source gap |
   | 216760935 | 0469. Sokak | geometry var; name feature2167609352, minor | Filtre kabul; z14/15 kapalı, z16 açık |
   | 216760862 | 0443. Sokak | geometry var; name feature2167608622, minor | Filtre kabul; z16 eşiği; örnek host z16 viewport’u dışında |
   | 114471408 vd. | Gazipaşa Bulvarı | Birleşik ad feature1144714080, secondary | major kabul, minzoom12; gerçek cihaz görüntüsünde görünür |
   | 216746881 | Kocatepe Caddesi | Güncel ad yok | OSM v1(2013) adsız, v2(4 Eylül) adlı; tile paketi daha eski |

   Mesafeler tek örnek noktası ile tile çizgisi arasındadır; tüm yol özdeşliği iddiası değildir. Birleştirilmiş minor geometry feature kimliği2061142270 birden fazla yol içerir. 138 adlı upstream way’in **135’inin adı** merkez tile’da eşleşir; eşleşmeyen üç way Kocatepe Caddesi’dir. Üçünün güncelleme zamanı4 Eylül; birinin geçmişi adın o gün eklendiğini ayrıca doğruladı.

   `road-label`: minor/tertiary/service kabul; junction red; minzoom16; sort tertiary1/minor2/service3; spacing460 CSS px, padding6, max-angle30. `road-label-major`: motorway/trunk/primary/secondary; junction red; minzoom12, spacing420, padding5. Merkez117 ad feature’inden **112 local + 3 major** filtreye giriyor; kalan2 junction. DAY/NIGHT filtre sonuçları aynı (`comparison.json`, gerçek MapLibre `featureFilter` çalıştırıldı).

   **Kontrollü host yerleşim deneyi:** aynı koordinat, 904×406, DPR1, pitch0, bearing0, gerçek DAY style, kaydedilmiş PBF’ler; NAV/runtime/rota/UI yok. Z14/15 local ad0; z16 **10 farklı ad**. Yalnız local `text-allow-overlap=true`: **10→10**. Yalnız local `symbol-spacing=100`: **10→16**. Ek adlar1951,1964,1965,1971,1975. Sokak ve Şamil Basayev Caddesi. **Spacing etkisi kanıtlı; bu deneyde ek collision kaybı kanıtlanmadı.** Aralık değişimi anchor adaylarını da etkiler; daha küçük spacing önerisini production’a uygulamadık.

   `render-results.json` sayıları `queryRenderedFeatures` yerleşim çıktısıdır. Host PNG yakalaması tutarsız/boş kaldı; PNG’ler **ekran/piksel kanıtı sayılmadı**. Bunlar cihazda aynı etiketlerin göründüğü iddiası değildir. Glyph/tile/MapLibre hatası kaydı0. Gerçek cihazda eksik her etiketin collision gerekçesi için canlı viewport/placement kaydı hâlâ gerekir.

   NAV/BROWSE layout eşiği ortak. Runtime opacity: NAV_SUPPRESS tier0/1/2 local1/0.70/0.55, mood en az0.60 (tier0), hız>80 local0.25; mini çarpanı0.35. Bunlar veriyi silmez; runtime’da hangi son yazının etkin olduğu ayrıca gözlenmelidir. Canonical authority dışında ikinci label yazarı eklenmedi.

6. **Numaralı sokak ve kapı numarası**

   `0469. Sokak` **road-name**. `No:17` **address**. Birbirinden türetilmedi.

   `housenumber` provider schema’da **var**, z14–14. Merkez PBF’de **7 feature**: `22/D,4,26,6,10,8,15`. Bunların4’ü buffer ile core tile sınırının dışından geliyor. Ortak core içinde **3** numara var ve upstream’deki3 kayıtla karşılaşıyor: node4393160590=`22/D`, way442622219=`26`, way440715795=`15`. **Bu mevcut adresler pipeline’da kaybolmuyor; style tüketmiyor.**

   Yakın 400×400 m çevrede numara0. Ana OSM map API alanında `addr:interpolation`0. Building way’lerinin11’inde çeşitli `addr:*` alanları var; bunları kapı numarası saymadık. Production building schema/feature’larında adres alanı yok; numara ayrı `housenumber` katmanında. Genel adres noktası/interpolasyon katmanı yok. Tam adresin cadde/mahalle/şehir bileşenleri render tile’ının bina katmanından geri kurulamaz. UI’da numara uydurulmadı.

7. **Data-loss matrix**

   | Veri | Upstream | Production Tile | Style | Screen | Sonuç |
   |---|---|---|---|---|---|
   | Building, yakın örnek | Seyrek:11; seçilen3 çatıda yok | Aynı11; seçilen çatılarda yok | 2B/3B kabul | Cihazda seyrek bina; tam feature/piksel eşlemesi yok | SOURCE COVERAGE GAP |
   | Building, yeni3 nesne | Var,4 Eylül v1 | Yok,30 Ağustos paket | Veri gelirse kabul | Bu kaynaktan çizilemez | PIPELINE GÜNCELLİK FARKI |
   | Street geometry | Var;564 way | Var;64 feature/517 parça | Sınıf/zoom’a göre kabul | Yol ağı cihazda var | Örneklerde kayıp gösterilmedi |
   | Street name | 138 adlı/426 adsız way | 117 ad feature;135/138 way adı eşleşir | local z16, major z12 | Z14/15 local kapalı; canlı collision ayrıntısı yok | SOURCE + STYLE EŞİĞİ/YERLEŞİM + yeni adlarda güncellik |
   | Numbered street name | Var | 100 sayıyla başlayan ad feature | Normal road-name filtresi | Host placement z16’da0469 var; z15’te yok | Ad mevcutsa style/spacing; adsızsa source |
   | House number | Core3, yakın alan0 | Core3 + buffer4 | **Katman yok** | Vektör stilde çizilemez | **STYLE ENTEGRASYON EKSİĞİ** + yerel source seyrekliği |

   Provider schema omission/genelleştirme nedeniyle eski binaların topluca kaybolduğu kanıtlanmadı. “Tile’da hiç housenumber yok” ve “binaları collision siliyor” hipotezleri ölçümle desteklenmiyor. Polygon katmanları symbol collision’a tabi değildir.

8. **Upstream ile provider ayrımı**

   Upstream ana kaynak `osm-api-map.json`; endpoint/HTTP başlıkları `osm-api-provenance.json`. Overpass alternatif yanıtı **6 Mayıs 2026** taban tarihli geldi; güncel yokluk hükmünde kullanılmadı. Overpass HTTP406/429 girişimleri kaydedildi; ana OSM API’ye geçildi. Bina/ad geçmişi `history-summary.json` ile raw history dosyalarında.

   Üretim tile’ının paket tarihi ve `Last-Modified` başlığı ile OSM nesne sürümleri karşılaştırıldı. Paketin tam OSM replication cut-off zamanı bilinmiyor. Buna rağmen 30 Ağustos’ta yayımlanmış dosyada4 Eylül version1 nesnesinin olmaması açık güncellik farkıdır; style düzeltmesi bunu gidermez.

9. **Google seviyesine yönelik veri stratejisi**

   Google verisi incelenmedi/kopyalanmadı; sayısal Google kıyası veya eşitlik iddiası yok. Bu Tarsus örneğinde ihtiyaçlar:

   - **Footprint completeness:** kaynağa bina geometrisi eklemek/enrichment; yalnız 3B yüksekliği veya paleti değiştirmek boş alanı doldurmaz.
   - **Yerel sokak adı:** geometri var ama çoğunlukla name yok; doğrulanmış yerel yol-adı kaynağı/index gerekir. Mevcut adlarda z16/spacing politikası ayrı sorun.
   - **House-number/address:** ayrı render tüketicisi eksik; bundan bağımsız olarak kaynak numara kapsamı çok seyrek. Tam adres için ayrı index gerekir.
   - **POI/adres arama:** merkez tile `poi`120 taşısa da style yalnız gas/hospital/police/parking circle ailelerini çiziyor; genel POI-name katmanı yok. Arama ayrı zincirdir: `mapService.searchPlaces` geçmiş/favoriler→yerel SQLite→Nominatim/Overpass yollarını kullanır; `geocodingService` ayrıca yapılandırılabilir provider/fallback zinciri taşır. POI tile sayısı arama recall’ı değildir. `public/maps/poi.license.txt` gömülü DB’nin yalnız node POI’lerden üretildiğini belirtir; polygon POI kapsamı ayrı borçtur. Bu tur gerçek arama sonuç recall testi yapmadı; Google seviyesine yeterlilik **ölçülmedi**.
   - **Zoom generalization:** z15/16 yeni veri getirmiyor. Z14 maxzoom’u tek başına kusur ilan etmek yanlış; kayıp kanıtı olan katman/nesne için retention ve güncelleme SLA’sı ölçülmeli. Local label minzoom16 client politikasıdır.

10. **En küçük doğru remediation sırası**

   1. Mevcut `housenumber` için tek, kontrollü style tüketicisi eklemek; minzoom/declutter politikası canonical label authority’de kalmalı. Olmayan adres uydurulmamalı.
   2. Var olan yerel adlarda BROWSE/NAV eşik ve spacing kararını canonical authority üzerinden ele almak; z15/16 cihaz kabul sahnesiyle atomik değişiklik. Host100 px değerini kör production varsayılanı yapmamak.
   3. Sağlayıcının güncelleme gecikmesini ölçmek; yeni4 Eylül nesnelerinin sonraki pakette korunmasını kontrol etmek. Gerekirse güncel regional overlay veya kontrollü OSM-derived tile pipeline; yalnız maxzoom sayısını artırmak çözüm değil.
   4. Asıl kalıcı kapsam için izinli bina/yol adı/adres enrichment ve daha zengin kaynak/provider; aynı seyrek OSM’yi yeniden paketlemek eksik binayı üretmez.
   5. Tam adres index’i ve node+way+relation POI kapsamı için ayrı arama audit’i; render tile’ını arama veri tabanı yerine kullanmamak.

   Büyük refactor, provider değişimi, production style değişikliği yapılmadı. Canlı cihaz collision/viewport ve cache hash eşlemesi açık ölçüm sınırıdır; kök nedenler bunu beklemeden kanıt seviyeleriyle ayrıldı.

11. **Kod, QA ve tekrar üretim**

   **Production CODE değişmedi.** Yalnız bu klasöre `audit.mjs`, `compare.mjs`, `render.mjs`, `audit.test.mjs`, raw kanıtlar ve rapor eklendi. Media/music/native mevcut dirty dosyalara dokunulmadı; commit/stage yok.

   Hedefli node testleri **4/4 PASS**; `tsc --noEmit` **PASS**; yalnız dört yeni `.mjs` dosyasında ESLint recommended **0 hata/0 uyarı**. MJS dosyaları tsc kapsamı değildir; parse/lint/node çalıştırmasıyla ayrıca doğrulandı. Full suite/build çalıştırılmadı.

   Sıra: `node field-runs/map-data-coverage-20260907/audit.mjs` → `node field-runs/map-data-coverage-20260907/compare.mjs` → `node field-runs/map-data-coverage-20260907/render.mjs` → `node --test field-runs/map-data-coverage-20260907/audit.test.mjs`. İlk komut ağdan yeni snapshot alır ve bu klasördeki kanıtları yeniler; mevcut kanıtı korumak gerekiyorsa önce klasörü ayrı kopyaya alın. Diğerleri kaydedilmiş tile/OSM’yi kullanır; render yalnız eksik glyph’i indirir.

   `summary.json` tile başına SHA-256 içerir. Snapshot’a bağlı test sayıları başka provider sürümünde değişebilir; bu fixture doğrulamasıdır, evrensel Tarsus sabiti değildir. **QA PASS gerçek cihaz kapanışı değildir.**

   Veri atfı: © OpenStreetMap katkıcıları / OpenMapTiles / OpenFreeMap; uydu © Esri. Ölçüm verileri production’a gömülmedi.
