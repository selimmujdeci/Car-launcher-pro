# CAROS PRO — TURKEY NATIONWIDE RTG3 SHADOW BUILD REPORT

Tarih: 2026-09-08 · Kapsam: ülke çapı gölge RTG3 üretimi + kaynak zarfı + manifest bütünlüğü.
Production swap **YAPILMADI**. `public/maps/routing-graph.bin` **DEĞİŞMEDİ**.

## SONUÇ SINIFI

**`NATIONWIDE_SHADOW_BUILD_PASS`**

Ayrı ve bağlayıcı mimari bulgu:
**`COUNTRY_ROUTE_CORRIDOR = BLOCKED_RESIDENCY_BUDGET`**
(mevcut 3-bölge / 64 MiB residency politikası şehirler arası rotalara YETMİYOR;
bu tavan **sessizce yükseltilmedi**.)

## DÖRTLÜ — GERÇEK ÖLÇÜM

| | ÖLÇÜLEN |
|---|---|
| **REGION COUNT** | **402** |
| **TOTAL RTG3 SIZE** | **994 235 572 B (948,2 MiB)** |
| **PEAK PROCESS-TREE RSS** | **398,47 MiB** (bütçe 512 MiB) |
| **BUILD TIME** | **12 dk 01 s** (721 s) |

## Exact build command

```
NODE_OPTIONS=--max-old-space-size=310 \
RTG3_RUN_DIR=field-runs/turkey-rtg3-national-20260908 \
RTG3_TEMP_DIR=$HOME/rtg3-national-tmp \
RTG3_REGION_PREFIX=tr \
RTG3_SOURCE_LABEL='OpenStreetMap / Geofabrik Turkey extract turkey-260906.osm.pbf (nationwide)' \
RTG3_SOURCE_TIMESTAMP=2026-09-06T20:20:13Z \
RTG3_MEMORY_BUDGET_MIB=512 \
/usr/bin/time -v node scripts/build-pbf-streaming-rtg3.mjs \
  field-runs/pbf-streaming-rtg3-20260908/raw/turkey-260906.osm.pbf
```

## P0 — QA CLOSURE (build ÖNCESİ, bir kez)

| KAPI | SONUÇ |
|---|---|
| Full suite | **847/847 dosya · 19 027/19 027 test PASS** · 0 unhandled error · 639 s |
| Gerçekten koşan dosya | 851 − 4 `*.integration.test.ts` (config `exclude`) = **847** → eksik koşan YOK |
| `npm run guard` | 1008/1008 PASS (bu turdan sonra **1010/1010**) |
| TypeScript `tsc -b` | PASS |
| Production build | PASS · `built in 10m 43s` |
| `routing-graph.bin` | `e7713f75…f691da` MATCH |

İlk (kirli) koşuda düşen tek test `musicFieldBugfixYtMiniplayerVideo.test.ts` idi —
commit dışı medya işine ait, izole 15/15 PASS; temiz koşuda geçti. Timeout global
olarak BÜYÜTÜLMEDİ, hiçbir alakasız test değiştirilmedi.

## 1. SOURCE

| SOURCE | BYTES | SHA-256 | TIMESTAMP | RESULT |
|---|---:|---|---|---|
| `turkey-260906.osm.pbf` | 645 061 454 | `c841556847bd31ed511ca3f61b5086644664488f48b23d7ce2a4b7d6c36dd80f` | `2026-09-06T20:20:13Z` | **MATCH / PASS** |

PBF imzası: BlobHeader 14 B + `OSMHeader` → PASS.
Preflight 9/9 PASS (`v8-heap-limit 358 MiB` dâhil).

## 2. BUILD METRIC — PROJECTED vs MEASURED

| BUILD METRIC | PROJECTED | MEASURED | DELTA |
|---|---:|---:|---|
| Region count | 394 (yoğunluk tahmini) | **402** | **+%2,0** |
| RTG3 bytes | 2 391 396 511 | **994 235 572** | projeksiyon **2,40× fazla** |
| Graph nodes | 52 759 837 | **21 874 202** | 2,41× fazla |
| Graph edges | 55 251 967 | **23 004 155** | 2,40× fazla |
| Selected ways | 4 271 747 | **1 919 616** | 2,23× fazla |
| Required coordinates | 50 800 906 | **20 913 743** | 2,43× fazla |
| Peak temp disk | 13 466 435 436 B | **7 366 672 000 B (6,86 GiB)** | 1,83× fazla |
| Build duration | 9 982 712 ms (2 sa 46 dk) | **721 000 ms (12 dk 01 s)** | **13,8× hızlı** |
| Peak process-tree RSS | **UNKNOWN** (dürüstçe) | **417 824 768 B (398,47 MiB)** | ölçüldü |
| Peak Node RSS | — | 398,47 MiB | — |
| Peak osmium child RSS | — | 164,77 MiB | — |
| `/usr/bin/time` max RSS | — | 417 104 KiB (407,3 MiB) | — |
| CPU | — | user 530,44 s · sys 61,57 s · %82 | — |

Ölçek projeksiyonu (way oranı 87,81×) **fazla muhafazakârdı**: Türkiye genelinde
sürülebilir yol yoğunluğu Mersin'inkinden düşük. Süre farkı bu turdaki üç
düzeltmeden geliyor (aşağıda).

## 3. REGION STATS

| REGION STATS | COUNT | MIN | MEDIAN | P95 | MAX |
|---|---:|---:|---:|---:|---:|
| RTG3 bytes | 402 | 3 596 | 1 823 264 | 6 783 232 | **18 030 216** |

- **En büyük bölge `tr-57-82`** — bbox `28,5 / 41,0 / 29,0 / 41,5` (**İstanbul**) ·
  380 517 düğüm · 425 646 kenar · 18 030 216 B · SHA `5cb3384921f6…`
- En küçük bölge `tr-56-84` — 82 düğüm · 81 kenar
- Kenar sayısı < 1000 olan bölge: 9

## 4. COUNTRY GRAPH

| COUNTRY GRAPH | NODES | EDGES | BYTES | REGIONS |
|---|---:|---:|---:|---:|
| Türkiye RTG3 (gölge) | **21 874 202** | **23 004 155** | **994 235 572** | **402** |

Komşuluk bağı: **1 063** · Seçili yol 1 919 616 · Reddedilen yol 741 389 ·
Gerekli koordinat 20 913 743.

## 5. ROAD CLASS

| ROAD CLASS | COUNT |
|---|---:|
| residential | 8 884 972 |
| tertiary | 6 285 462 |
| unclassified | 3 685 568 |
| service / road | 1 409 002 |
| secondary | 1 084 007 |
| trunk | 706 915 |
| primary | 439 558 |
| living_street | 377 051 |
| motorway | 131 620 |
| **TOPLAM** | **23 004 155** |

Metadata: oneway 2 052 955 · destination-only 1 258 · bridge 60 322 ·
tunnel 12 726 · layered 85 189 · restriction kaydı 7 848 · via-way zinciri 698.

## 6. RESTRICTIONS

| RESTRICTIONS | OBSERVED | VIA-NODE | VIA-WAY | UNSUPPORTED | MALFORMED | UNRESOLVED |
|---|---:|---:|---:|---:|---:|---:|
| Türkiye geneli | **8 357** | **6 193** | **698** | **33** | **688** | **745** |

Geçerli 7 669 · desteklenen **6 891** (= 6 193 via-node + 698 via-way) ·
via-way gözlemi 845 · araç-özel (`except`) 7 · conditional 0 · desteklenmeyen tür 26.
Araç-özel ve conditional ilişkiler **jenerik kısıta yükseltilmedi**.

Mersin turunda 2 via-way ilişkisi desteklenmişti; ülke ölçeğinde **698 via-way
zinciri** gerçek OSM verisinden çözüldü — via-way desteği ölçekte çalışıyor.

## 7. TOPOLOGY

| TOPOLOGY METRIC | VALUE | VERDICT |
|---|---:|---|
| Self-loop kenar | **0** | PASS |
| Sıfır uzunluklu kenar | **0** | PASS |
| Yinelenen kenar | **0** | PASS |
| Geçersiz düğüm referansı | **0** | PASS |
| Çıkmaz uç (derece 1) | 564 054 | NORMAL (gerçek yol ağı) |
| Bölge-içi bileşen (toplam) | 11 564 (ort. 28,8/bölge) | AÇIKLANDI ↓ |
| Bölge-içi en büyük bileşen % (medyan) | **96,7** | PASS |
| … p05 / min | 62,2 / 29,6 | ANOMALİ SINIFLANDIRILDI ↓ |
| Bölge komşuluk grafı bileşeni | **2** (401 + 1) | AÇIKLANDI ↓ |
| İzole bölge | 1 (`tr-51-80`) | COĞRAFİ GERÇEKLİK |

**Bölge-içi bileşen sayısı bir kusur ölçüsü DEĞİLDİR:** 0,5°'lik karo yolları
keser, kesilen parçalar karo içinde ayrık görünür. Karolar arası süreklilik
sınır portallarıyla sağlanır ve ayrıca doğrulanır (aşağıda 12/12 PASS).
En düşük yüzdeler küçük kıyı/sınır karolarında toplanıyor
(`tr-53-84` 984 düğüm · `tr-88-73` 3 135 düğüm) — beklenen davranış.

**`tr-51-80` (bbox 25,5–26,0 / 40,0–40,5)** Geofabrik Türkiye extract'inin
tampon bölgesindeki **Ege adaları/sınır şeridi**dir; 9 089 düğüm · 9 530 kenar ve
karayoluyla anakaraya bağlı DEĞİLDİR. Bu bir build hatası değil, coğrafi
gerçekliktir (feribot bağlantısı grafta yoktur).

**KAPSAM SINIRI (dürüstlük):** ülke düzeyinde **düğüm bazlı** global union-find
YAPILMADI — ~21,9M düğüm üzerinde tek parça bağlantılılık ölçümü, ölçümün
kendisini bütçe dışına çıkarırdı. Ülke bağlantılılığı **bölge komşuluk grafı**
düzeyinde ölçülmüştür.

## 8. MANIFEST INTEGRITY

`turkey-graph-manifest.json` · 220 458 B ·
SHA-256 `8d215b4a0e7180db1253b7f7091850ba7c85d634ea2ab8a08606a93806871886` ·
`datasetId` `osm-tr-c841556847bd` · buildTimestamp `2026-09-08T08:46:58.015Z`

| CHECK | MEASURED | RESULT |
|---|---|---|
| region-ids-unique | 402/402 | PASS |
| graph-format | RTG3 | PASS |
| manifest-schema | 1 | PASS |
| source-hash-consistent | 1 farklı değer | PASS |
| all-region-files-exist | 402/402 | PASS |
| byte-sizes-match | 0 uyumsuz | PASS |
| sha256-match | 0 uyumsuz | PASS |
| all-regions-parse | 0 ayrıştırılamadı | PASS |
| no-dangling-neighbor | 0 | PASS |
| reciprocal-neighbors | 0 tek yönlü | PASS |
| no-self-neighbor | 0 | PASS |
| boundary-portal-identity | 12/12 çiftte ortak OSM düğümü | PASS |

**INTEGRITY = 12/12 PASS.**

## 9. ROUTE — ÜLKE ÇAPI KORPUS (kanonik zincir)

Akış: manifest → `selectRegionalRouteCorridor` → `graphResidencyRuntime` →
`NavigationCompute.worker` → kanonik edge-state A*. İkinci router yok.

| ROUTE | FROM | TO | REGIONS | DISTANCE | LOAD | SOLVE | RESULT |
|---|---|---|---:|---:|---:|---:|---|
| 1 | Mersin | Mersin-yerel | 1 | 3 252 m | 236,8 ms | 27,4 ms | **ROUTE_RESULT** (endpoint 15,3 m) |
| 2 | Mersin | Tarsus | 1 | 25 981 m | 238,3 ms | 12,6 ms | **ROUTE_RESULT** (endpoint 6,7 m) |
| 3 | Mersin | Adana | **2** | **66 847 m** | 366,4 ms | 40,1 ms | **ROUTE_RESULT** (endpoint 46,3 m) |
| 4 | Mersin | Ankara | gerçek koridor **7** | — | — | — | **BLOCKED_RESIDENCY_BUDGET** |
| 5 | Mersin | İstanbul | gerçek koridor **13** | — | — | — | **BLOCKED_RESIDENCY_BUDGET** |
| 6 | Mersin | Antalya | gerçek koridor **8** | — | — | — | **BLOCKED_RESIDENCY_BUDGET** |
| 7 | İstanbul | Ankara | gerçek koridor **9** | — | — | — | **BLOCKED_RESIDENCY_BUDGET** |

Rota 3 birleşik graf: 203 643 düğüm · 229 717 kenar.
Rota 4–7'de koridor **gerçekten hesaplandı** (sınırsız BFS) — ör. İstanbul→Ankara
`tr-57-82 → tr-58-82 → tr-59-82 → tr-60-81 → tr-61-80 → tr-62-79 → tr-63-79 →
tr-64-79 → tr-65-79`. Bölge grafı bağlı; engel **yalnız residency tavanı**.

## 10. RESIDENCY

| RESIDENCY | ROUTE | REQUIRED REGIONS | PEAK RESIDENT REGIONS | BYTES | RESULT |
|---|---|---:|---:|---:|---|
| Politika | — | — | **3 (tavan)** | **64 MiB (tavan)** | — |
| Mersin yerel | 1 | 1 | 1 | 6 608 868 | PASS |
| Mersin→Tarsus | 2 | 1 | 1 | 6 608 868 | PASS |
| Mersin→Adana | 3 | 2 | 2 | 9 744 212 | PASS |
| Mersin→Ankara | 4 | **7** | 3 | — | **BLOCKED_RESIDENCY_BUDGET** |
| Mersin→Antalya | 6 | **8** | 3 | — | **BLOCKED_RESIDENCY_BUDGET** |
| İstanbul→Ankara | 7 | **9** | 3 | — | **BLOCKED_RESIDENCY_BUDGET** |
| Mersin→İstanbul | 5 | **13** | 3 | — | **BLOCKED_RESIDENCY_BUDGET** |

**Bu turun en önemli mimari bulgusu.** Bayt bütçesi sorun DEĞİL: 13 bölgelik
İstanbul koridoru bile ~40–60 MiB civarındadır (medyan bölge 1,8 MiB, P95 6,8 MiB).
Asıl sınır **`REGIONAL_GRAPH_MAX_RESIDENT = 3`** sabitidir ve
`selectRegionalRouteCorridor(..., 3)` 3'ten uzun koridoru **fail-closed** reddeder.
Tavan **bu turda yükseltilmedi**: rezidans politikasını değiştirmek head-unit
RAM/yükleme davranışını değiştirir, ölçülmeden yapılamaz.

## 11. CAPABILITY

| CAPABILITY | BEFORE | AFTER | DEVICE SHADOW READY | BLOCKER |
|---|---|---|---|---|
| Ülke çapı RTG3 üretimi | YOK (yalnız projeksiyon) | **402 bölge · 948,2 MiB · 12 dk · 398,47 MiB tepe** | EVET (gölge) | cihaz doğrulaması |
| Build bellek zarfı | Türkiye'de ÖLÇÜLMEMİŞ | 512 MiB bütçe içinde **ölçüldü** | EVET | yok |
| Manifest bütünlüğü | 14 bölgede doğrulandı | **402 bölgede 12/12 PASS** | EVET | yok |
| Sınır portal kimliği | Mersin'de | 12/12 örneklenen komşu çiftte ortak OSM düğümü | EVET | tam örnekleme yapılmadı |
| Via-way kısıtı | 2 gerçek ilişki | **698 zincir** ülke genelinde | EVET | cihaz/saha |
| Bölge-içi rota | PASS | PASS (3,3 km · 27,4 ms) | EVET | cihaz |
| 2 bölgeli şehirler arası rota | PASS (Mersin içi) | **PASS (Mersin→Adana 66,8 km · 40,1 ms)** | EVET | cihaz |
| **Uzun şehirler arası rota** | bilinmiyordu | **BLOCKED** | **HAYIR** | **`REGIONAL_GRAPH_MAX_RESIDENT=3`** |
| Production RTG3 swap | kapalı | **kapalı** | HAYIR | residency + head-unit + saha |

## Bu turda yapılan üç ölçek düzeltmesi (hepsi ölçümle)

Nationwide build **iki kez fail-closed düştü**; hiçbirinde bütçe yükseltilmedi.

1. **Boru geri basıncı → dosyaya düşürme.** `osmium tags-filter` boruya yazarken
   tüketici yavaşladıkça blokta şişiyor: tepe **546 MiB** (`OSMIUM_POOL_THREADS=1`
   + `OSMIUM_MAX_QUEUE_SIZE=1` tabanı 468 MiB'nin altına indirmedi). Dosyaya
   yazınca **216 MiB / 27 MiB** ve çocuk süreç Node ayrıştırmaya başlamadan
   bitiyor → ağaç tepesi `max()`, toplam değil.
2. **V8 old-space kademeli tırmanması.** Bölge döngüsü tur başına yüzlerce MB
   kısa ömürlü nesne üretiyor; varsayılan ~4 GB tavan altında GC erteleniyor →
   153 bölge sonunda **518 MiB**. Çözüm bütçeyi büyütmek değil, V8'e bütçeyle
   uyumlu tavan vermek: yeni **`v8-heap-limit` preflight kontrolü** (tavan
   bütçenin %70'i) eksik ayarda build'i eyleme dönük mesajla başlatmıyor.
3. **Kaynak SHA'si bölge başına hesaplanıyordu** (`readFileSync` ile 645 MB) →
   TEK KEZ ve akışla. Ayrıca **telemetri sınırlandı** (50 ms örnekleri kütüğe
   yazılmıyor; zirveler her örnekte güncelleniyor) ve **OPL metadata kapatıldı**
   (`add_metadata=false`; Mersin'de 124 808 974 B → 64 049 519 B, %48,7 azalma).

**Her düzeltmeden sonra Mersin bit-paritesi doğrulandı: 14/14 bölge bayt bayt
aynı · 600 821 düğüm · 629 201 kenar · 27 232 860 B.**

## P12 — BUILD FAILURE SAFETY

- Koşu başında `build-complete.json` **ve** `turkey-graph-manifest.json` silinir.
- Manifest zaten en sonda yazılır → yarım koşu tüketiciye **manifestsiz** görünür
  ve `validateTurkeyGraphManifest` girdiyi bulamaz (fail-closed).
- `build-complete.json` **en son** adımda yazılır; iki düşen koşuda YAZILMADI.
- Geçici artefaktlar shadow temp'te kaldı; production RTG2'ye dokunulmadı.
- `RTG3_REUSE_DB=1` yalnız **aynı kaynak SHA'sı** ve tamamlanmış indeks aşaması
  varsa DB'yi yeniden kullanır; bayat DB sessizce kabul edilmez.

## P13 — PRODUCTION SAFETY

`public/maps/routing-graph.bin` · 7 651 542 B ·
SHA-256 `e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da`
Build **öncesi ve sonrası** karşılaştırıldı → **DEĞİŞMEDİ**.
**Production graph changed? HAYIR.** Production swap **YAPILMADI**.

## Tests

| KAPSAM | SONUÇ |
|---|---|
| Full suite (build öncesi QA) | 847/847 dosya · 19 027/19 027 PASS |
| Production build | PASS (10 dk 43 s) |
| `npm run guard` (yeni 2 ölçek kilidiyle) | **1010/1010 PASS** |
| Hedefli RTG3 + nav kasası | 106/106 PASS |
| `tsc -b` · değişen dosya ESLint | PASS |

CODE PASS ≠ DEVICE PASS ≠ FIELD PASS. Cihaz/saha doğrulaması **YAPILMADI**.

## NEXT 3

1. **Residency mimarisi** — uzun koridor sorununu ölç ve çöz: 13 bölgelik
   İstanbul koridorunun gerçek bayt/RAM maliyetini head-unit'te ölç; ya
   `REGIONAL_GRAPH_MAX_RESIDENT`'ı kanıtla yükselt ya da koridor-akışlı (kayan
   pencere) bir yükleme tasarla. **Ölçmeden tavan değiştirilmeyecek.**
2. **Head unit gölge doğrulaması** — 402 bölgelik dataset'ten 1–3 bölge yükleme
   süresi/RAM'i, gerçek kavşakta via-way kısıtı davranışı, endpoint hatası ve
   guidance sürekliliği (kütük #1210).
3. **Sınır portalı tam örneklemesi** — 12 çift yerine 1 063 komşuluk bağının
   tamamında ortak OSM düğümü doğrulaması (bellek-bilinçli akışla).
