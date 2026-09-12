# ML BUILDING RESULT: GEOMETRY RESCUE FAIL · GAP DETECTOR PASS · SHADOW TILE BLOCKED

## 1. ROOT CAUSE

Ölçülen 671 Overture kaydının tamamı `Polygon`dur (Tarsus 123, Mersin 435,
Erdemli 113). Ham GeoJSON koordinatları adaptörde ölçeklenmez, projekte edilmez,
basitleştirilmez veya kırpılmaz; canonical halka koordinatları birebir taşınır.
Alan hesabı yerel metre çerçevesindedir. Ölçülen 2,19× ve 3,16× küçülme
**pipeline bug'ı değil, kaynak ML footprint geometrisidir**.

Denetimde ayrı bir latent bug bulundu: gerçek `MultiPolygon` parçaları tek
`POLYGON` iç halkaları gibi temsil ediliyordu. Contract `MULTIPOLYGON` ile
düzeltildi. Benchmark havuzunda MultiPolygon sayısı **0** olduğu için bu kusur
mevcut alan bias'ını açıklamaz veya sonucu iyileştirmez.

## 2. THIRD REGION

**Erdemli kuzey çeperi — düşük yoğunluklu banliyö.** Sabit merkez:
34.2940/36.6350; release `2026-08-19.0`. **n=113: ML 112, OSM-derived 1.**
ML medyan alan 98,15 m², ortalama 105,74 m²; tek OSM-derived kayıt 267,86 m².
OSM referansı n=1 ve eşleşmiş çift n=0 olduğundan alan bias oranı, centroid,
IoU, shape mismatch, false positive ve missing building **UNKNOWN** bırakıldı.

## 3. RAW ML

Önceki kör hüküm korunur: ML false positive **4/189 = %2,12**, Wilson %95 GA
**[%0,83–%5,31]**. Tarsus medyanları ML 73,81 / OSM 162,43 m²; Mersin
medyanları ML 135,48 / OSM 425,82 m². Üçüncü bölgede doğruluk referansı
yetersizdir. OSM-derived ve ML-derived sonuçlar ayrı tutulmuştur.

## 4. RESCUE EXPERIMENT

Yalnız benchmark amacıyla iki yöntem denendi:

1. Bölge medyanını eşitleyen alan düzeltmesi Tarsus'ta **×2,19**, Mersin'de
   **×3,16** gerektiriyor. Tek global katsayı iki dokuda tutarlı değildir.
2. En yakın OSM centroid'i ≤20 m çiftlerinde centroid koruyan uniform ölçek:
   yalnız n=4+4 çift bulundu; gereken alan çarpanı Tarsus **×6,20**, Mersin
   **×2,02** çıktı. Aynı bina eşleşmesi doğrulanmadığından centroid ve yaklaşık
   raster IoU karar kalitesinde değildir ve **UNKNOWN** kabul edildi.

Modeller bina sınırını kanıtsız büyütür, bölgeler arasında taşınamaz ve komşu
yapıya taşma riskini kapatamaz. Correction geometrisi ürün çıktısına alınmadı.

## 5. VERDICT

- **GEOMETRY RESCUE: FAIL**
- **GAP DETECTOR: PASS (CODE PASS)**
- **SHADOW TILE: BLOCKED**

## 6. ARCHITECTURE

- Mevcut authority zinciri, `EvidenceGrade`, provenance ve license gate korundu.
- Kalite sınıfları: `OSM_DERIVED`, `ML_DERIVED_VERIFIED`,
  `ML_DERIVED_UNVERIFIED`, `UNKNOWN`.
- BuildingResolver doğrulanmamış ML geometrisini canonical/publishable yapmaz.
- Saf `BuildingGapDetector` yalnız `PotentialBuildingGap` üretir; MapStore,
  renderer, routing ve CEH importu/yazısı yoktur.
- Fleet seam yalnız varlık kanıtı taşır; canonical geometry alanı yoktur.

## 7. TESTS

- `npx tsc --noEmit`: **PASS**
- changed-file ESLint: **PASS**
- hedefli saf Vitest: **51/51 PASS** (3 dosya). Ana config ve `npm run guard`
  ayrıca setup yolunu yanlış `/src/__tests__/setup.ts` çözerek 0 testte kaldı.
- Full suite/build çalıştırılmadı.

## 8. COMMITS

Bu raporu taşıyan atomik commit — ML geometri kalite kapısı, Gap Detector ve
rescue benchmarkı.
Dirty medya/native dosyaları korunmuş ve stage edilmemiştir.

## 9. NEXT 3

1. Temiz QA oturumunda hedefli testleri ve `npm run guard`ı çalıştır.
2. Tarihli ≥0,2 m/px referansla ≥30 doğrulanmış eşleşmiş kırsal bina edin.
3. Gap adaylarını LAB'da salt okunur sayım/reason dağılımıyla gözlemle.

Ham ölçüm: `rescue-benchmark.json`; üçüncü bölge provenance ve kayıtları:
`region3/overture-run-r3.json`, `region3/overture-buildings-r3.json`.
