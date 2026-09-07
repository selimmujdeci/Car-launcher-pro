# MAPDATA SOURCE RESULT: GUARD PASS · GAP OBSERVATORY CODE PASS · NO VERIFIED OPEN CANONICAL BUILDING SOURCE FOUND · SHADOW BLOCKED

## 1. GUARD

**PASS.** `npm run guard`: **1004/1004**.

Kök neden repo testleri veya guard gevşekliği değildi. Vitest 4.1.10, Windows'ta göreli `setupFiles: ['src/__tests__/setup.ts']` değerini `/src/__tests__/setup.ts` olarak çözüyordu. `vitest.config.ts` yolu `fileURLToPath(new URL('./src/__tests__/setup.ts', import.meta.url))` ile config dosyasına bağlandı. Guard bypass edilmedi, test silinmedi.

## 2. GAP OBSERVATORY

Mevcut CAROS LAB → Araç → Harita Veri Platformu ekranı genişletildi. `BuildingGapDetector` çıktısı, yeni truth authority kurmadan yalnız projection olarak okunur. Gösterilen alanlar:

- toplam `PotentialBuildingGap`, source/source family, reason dağılımı ve `EvidenceGrade`;
- confidence bilinen/medyanı, dataset release ve freshness;
- canonical centroid mesafesi, overlap/containment ve medyan alan oranı;
- mevcut `mapDataLicense` offline eligibility dağılımı;
- yapısal `publishable = FALSE`.

Evidence akışı bağlı değilse toplam **0 yapılmaz**, `UNAVAILABLE` gösterilir. Ekran ve model MapStore'a yazamaz, resolver/renderer/routing/CEH sonucunu değiştiremez, ağ/timer/polling başlatamaz. Açık sınır: **GAP EVIDENCE ≠ MAP TRUTH**. Detector sonucu ekrana yalnız mevcut read-only prop üzerinden verilebilir; varsayılan CAROS LAB akışı bugün bağlı değildir.

## 3. SOURCES CHECKED

| Source | Vector / building footprint | Freshness | License / redistribution | Verdict |
|---|---|---|---|---|
| Upstream OSM | Vector building ways/relations; küçük bounded ölçüm yapıldı. Üretim bulk adapterı API map endpoint'ini kullanmaz; planet/extract/Overpass gerekir. | API retrieval 2026-09-07; feature edit damgaları bölgeye göre eski; fiziksel güncellik UNKNOWN. | ODbL-1.0, attribution + share-alike; ticari/offline kullanım koşullu uyumlu. [OSM copyright](https://www.openstreetmap.org/copyright) · [OSM API policy](https://operations.osmfoundation.org/policies/api/) | **A — CANONICAL_GEOMETRY_CANDIDATE / mevcut baseline** |
| Overture OSM-derived | GeoParquet/vector; OSM source id'leri korunuyor. | Release `2026-08-19.0`; veri cutoff kayıt bazında UNKNOWN. | Overture Buildings teması ODbL; OSM-derived kayıt yükümlülüğü sürer. [Buildings guide](https://docs.overturemaps.org/guides/buildings/) · [Attribution](https://docs.overturemaps.org/attribution/) | **A — baseline aynası; incremental 0** |
| Overture non-OSM/non-ML families | Vector family sözleşmesi var (Esri/authoritative dahil), fakat üç AOI'de kayıt yok. | Release biliniyor, yerel kayıt yok. | Kaynak kaydı/lisansı gözlem başına taşınmalı; local evidence yok. | **B — ENRICHMENT seam, adapter yok** |
| OpenFreeMap | Vector tiles ve haftalık planet indirmeleri; footprint kaynağı OSM'dir. | Haftalık provider dağıtımı ilanı; provider offline hakları bu ürün için doğrulanmadı. | OSM ODbL; kamu servisinden otomatik toplama ToS ile yasak. [OpenFreeMap](https://openfreemap.org/) · [ToS](https://openfreemap.org/tos/) | **D — ONLINE_REFERENCE_ONLY; canonical yeni kaynak değil** |
| TUCBS | Bina polygon şeması ve açık veri portalı mevcut; Tarsus/Mersin/Erdemli için belirli açık download/WFS doğrulanmadı. | Dataset bazında UNKNOWN. | Paylaşım matrisi/izin dataset bazında; ticari offline redistribution kanıtı yok → fail-closed. [TUCBS portal](https://basic.atlas.gov.tr/?_appToken=&metadataId=%2Feski) | **E — LICENSE_BLOCKED / unverified** |
| Mersin/Tarsus/Erdemli belediye CBS | Envanter ve web görüntüleyicileri var; açık vector download/API sözleşmesi doğrulanmadı. | İç sistem veya portal; UNKNOWN. | Açık ticari/offline redistribution hakkı yok → fail-closed. | **D/E — reference veya license blocked** |
| HGM TOPOVT | Gerçek SHP/GDB/MDB vector topographic database. | Üretim 2019, kısmi güncelleme. | Ücretli; erişim kamu/yükseköğrenim alımıyla sınırlı, ürün hakları ticari offline kullanım için açık değil. [TOPOVT](https://www.harita.gov.tr/urun/turkiye-topografik-veritabani-topovt-verisi/288) | **E — LICENSE_BLOCKED** |
| Google Open Buildings V3 | Vector polygons ancak resmi ülke listesinde Türkiye yok. 2.5D Temporal ürün raster presence/count/height'tır, footprint vector değildir. | V3 2023; temporal 2016–2023. | CC BY 4.0/ODbL seçenekleri; Türkiye coverage yok. [Open Buildings](https://sites.research.google/gr/open-buildings/) · [Temporal](https://sites.research.google/gr/open-buildings/temporal/) | **C/D — local gap evidence veya reference; canonical değil** |
| OpenBuildingMap | GeoPackage vector; yalnız OSM (2024-07-01), Google ve Microsoft kaynaklarını birleştirir. | 2024 snapshot; baseline'dan eski. | ODbL, fakat Türkiye'de bağımsız yeni footprint ground truth yok. [Dataset](https://www.openbuildingmap.org/) | **F — QUALITY_REJECTED as canonical** |
| GlobalBuildingAtlas | ODbL polygon alt kümesi OSM/MS; yeni polygon ve yükseklik bölümü CC BY-NC. | Dataset release metadata; local comparison yapılmadı. | CC BY-NC bölüm ticari ürüne giremez; ODbL bölüm bağımsız source değildir. [Repository](https://github.com/zhu-xlab/GlobalBuildingAtlas) | **E/F — license blocked or redundant** |
| EUBUCCO | Parquet/GPKG/SHP vector; kapsam EU27 + Norveç/İsviçre/UK, Türkiye yok. | v0.2 release. | Açık bilim dataset'i; AOI coverage yok. [Docs](https://docs.eubucco.com/) | **D — ONLINE_REFERENCE_ONLY** |
| CSB ortofoto WMS | Raster WMS; footprint vector değil. Uydu/ortofotodan yeni bina üretimi bu turda yapılmadı. | Servis tazeliği UNKNOWN. | WMS görüntüleme; vector/offline redistribution kanıtı yok. [Ortofoto WMS](https://cbs.csb.gov.tr/ortofoto-web-servisleri-i-86198) | **D — ONLINE_REFERENCE_ONLY** |

## 4. REGIONAL SHOOTOUT

Ölçüm artefaktı `shootout.json` ve `derived/osm-*.json` içindedir. Medyan, çift sayıda değerde iki orta değerin ortalamasıdır. IoU, yalnız OSM source-id eşleşmiş kayıtlar için 100×100 raster yaklaşımıdır; bağımsız ground truth değildir.

| AOI / morphology | OSM footprints | Overture total (OSM / ML / other) | Verified alternative / unique incremental | OSM ID agreement / internal duplicate | OSM-vs-Overture geometry |
|---|---:|---:|---:|---:|---|
| Tarsus bounded canonical sample · bahçeli/müstakil | 11 | 123 (11 / 112 / 0) | 0 / 0 | 11/11; %0 | n=11, median area ratio 1.0000, centroid 0 m, approx IoU 1.00, gross mismatch 0 |
| Mersin dense urban sample · apartman | 28 | 435 (28 / 407 / 0) | 0 / 0 | 28/28; %0 | n=28, median area ratio 1.0000, centroid 0 m, approx IoU 1.00, gross mismatch 0 |
| Erdemli low-density sample · banliyö | 1 | 113 (1 / 112 / 0) | 0 / 0 | 1/1; %0 | n=1, median area ratio 1.0000, centroid 0 m, approx IoU 1.00, gross mismatch 0; quality inference UNKNOWN |

Area composition: Tarsus OSM median **162.43 m²**, ML median **73.56 m²** (~2.21× smaller); Mersin **389.22 / 135.48 m²** (~2.87× smaller); Erdemli **267.86 / 98.11 m²** (~2.73× smaller, OSM n=1 olduğu için UNKNOWN). Prior rescue benchmarkindeki matched/reference hükmü olan yaklaşık **2.19× / 3.16×** küçülme değişmedi; bu shootout tam AOI medyanıdır ve aynı eşleşmiş örnek tanımı değildir.

OSM missing-building ve OSM false-positive oranı bağımsız otoriter referans olmadığından **UNKNOWN**. Önceki ML kör sonuç korunur: **4/189 = %2,12**, Wilson %95 üst sınır **%5,31**; bu ML geometry acceptance kanıtı değildir.

## 5. BEST SOURCE

Bugün doğrulanmış en iyi geometri kaynağı upstream **OSM** ve onun Overture OSM-derived karşılığıdır. Overture karşılığı 40/40 source-id eşleşmesiyle geometrinin bozulmadığını gösterir, fakat yeni bina kazancı sağlamaz. Üç bölgede lisanslı ve bağımsız artımlı footprint sağlayan kaynak ölçülmedi.

Sonuç: **No verified open canonical building source found.**

## 6. CLASSIFICATION

- **A — CANONICAL_GEOMETRY_CANDIDATE:** upstream OSM; Overture OSM-derived (baseline mirror, incremental 0).
- **B — ENRICHMENT_CANDIDATE:** Overture non-OSM/non-ML source-family seam; yalnız kayıt, kalite, freshness ve record-license kanıtı geldiğinde.
- **C — GAP_EVIDENCE_ONLY:** Microsoft ML; gelecekte Türkiye kapsamı doğrulanırsa Google/diğer ML vector kayıtları da aynı sınıfta başlar.
- **D — ONLINE_REFERENCE_ONLY:** OpenFreeMap public service, CSB ortofoto WMS, belediye web/CBS görüntüleyicileri, EUBUCCO ve raster-only Google temporal/GlobalBuildingMap.
- **E — LICENSE_BLOCKED:** belirli TUCBS/belediye datasetleri, HGM TOPOVT ve GlobalBuildingAtlas CC BY-NC polygon bölümü.
- **F — QUALITY_REJECTED:** OpenBuildingMap ve GlobalBuildingAtlas ODbL alt kümesi canonical footprint adayı olarak; bağımsız incremental geometry kanıtı yok.

Karar static priority ile verilmedi; kalite + freshness + provenance + agreement + completeness + license eligibility birlikte değerlendirildi.

## 7. SHADOW

**BLOCKED.** Yeni A sınıfı kaynak yok, verified unique incremental gain **0**, ML geometry sistematik alan bias'ı taşıyor, kamu/yerel kaynaklarda dataset-level redistribution hakları doğrulanmadı. Adapter, fused canonical bounded dataset ve shadow vector tile üretilmedi; production renderer, routing ve CEH etkilenmedi.

## 8. TESTS

- `npm run guard`: **1004/1004 PASS**.
- Targeted MapData/LAB suite: **124/124 PASS**.
- `npm run test`: **838 dosya, 18.965 test PASS, 0 FAIL**.
- `npx tsc --noEmit`: **PASS**.
- Changed-file ESLint: **0 hata / 0 uyarı**.
- `npm run build`: önceki üretim build’i **PASS** (`✓ built in 5m 17s`); son tekrar çağrısı kullanıcı tarafından kesildi, bu nedenle bu rapor son çağrı için yeni build PASS iddiası taşımaz.
- Host/device/field ayrımı korunur: CODE PASS ≠ DEVICE PASS ≠ FIELD PASS. LAB ekranı cihazda henüz doğrulanmadı.

## 9. COMMITS

- Base canonical ML hükmü: `8ed91a10`.
- Bu turun implementation, QA guard, LAB observatory ve bounded benchmark değişiklikleri: `2a7f3969`.
- Bu rapor: takip eden explicit rapor commit’i. Unrelated dirty medya/native dosyalarına dokunulmadı ve stage edilmedi.

## 10. NEXT 3

1. Cihazda CAROS LAB ekranını 800×480 ve 904×406 gündüz/gece doğrula; `GAP EVIDENCE ≠ MAP TRUTH`, `UNKNOWN` ve `Publishable building: FALSE` görünürlüğünü kaydet.
2. OSM eksikliği için bağımsız lisanslı/otoriter bounded referans edinilmeden false-positive veya missing oranı hesaplama; yeni kaynak gelirse aynı üç AOI ve sourceFeatureId/provenance/license zinciriyle ölç.
3. Yeni source family gerçekten vector + açık lisans + artımlı kalite kanıtı getirirse yalnız bounded `SourceAdapter → License Gate → CandidateMapFeature → Evidence Store → BuildingResolver` shadow adayı aç; aksi hâlde ML yalnız Gap Detector evidence olarak kalsın.
