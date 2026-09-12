# CAROS PRO — TURKEY REGIONAL RTG3 PLATFORM REPORT

## Analysis:

Durum: **REGIONAL SHADOW CODE PASS / OVERALL PARTIAL**. İki gerçek komşu RTG3 partition, manifest, SHA doğrulamalı residency load ve gerçek sınır-aşan route üretildi. Ancak builder gerçek corridor build'inde Overpass JSON'u bütünüyle RAM'e alıyor; PBF streaming yolu ve production worker'ın manifest/corridor seçimi tamamlanmadı. Bu yüzden PASS gate'in tamamı kapanmadı ve production-ready değildir.

Kaynak: OpenStreetMap, resmî Overpass API; bbox `34.62,36.79,34.68,36.83`; 1,387,071 byte; OSM timestamp `2026-06-01T08:52:28Z`; SHA-256 `7639c70628458ee57351bee64045e762aaf0d20c1128dc66d9c50c04056c9a94`.

## Patch:

Region stratejisi deterministic fixed geographic tile + 0.002° (~178 m) overlap'tır. Overlap'taki node'lar RTG3 node kaydının rezerve 8 baytında OSM node ID taşır. Residency merge aynı stable ID'yi tek node'a indirir; edge duplication OSM way/from/to/direction anahtarıyla kaldırılır. Manifest reciprocal neighbor zorunluluğu taşır.

Manifest: `schemaVersion/datasetId/country/source/sourceTimestamp/buildTimestamp/policyVersion/graphFormat/regions[]`; region: `regionId/bbox/graphFile/sha256/byteSize/nodeCount/edgeCount/neighbors/sourceHash`.

Mevcut `graphResidencyRuntime` genişletildi: en çok 3 region ve 64 MiB explicit bütçe, manifest doğrulama, boyut+SHA-256 doğrulama, kanonik RTG3 parser, stable-node merge. Missing/corrupt/hash mismatch/broken neighbor/unsupported format birleşik graph yayınlamaz.

## Test:

| REGION | NODES | EDGES | SIZE | NEIGHBORS | HASH |
|---|---:|---:|---:|---|---|
| tr-mersin-34e-west | 6,584 | 8,437 | 341,612 B | tr-mersin-34e-east | `194a36c…52ec0d` |
| tr-mersin-34e-east | 2,575 | 3,051 | 126,660 B | tr-mersin-34e-west | `a78b250c…1d142c` |

Portal count: **746 shared OSM nodes**.

| ROAD CLASS | COUNT (partition toplamı; overlap dahil) |
|---|---:|
| motorway | 92 |
| trunk | 508 |
| primary | 529 |
| secondary | 892 |
| tertiary | 1,959 |
| unclassified | 196 |
| residential | 6,534 |
| living_street | 127 |
| service | 651 |

Gerçek metadata: west 39 bridge, 2 tunnel, 46 layered; east 107 bridge, 0 tunnel, 107 layered. Restriction: west source 3 / supported 1 / malformed 2; east source 1 / supported 1 / malformed 0.

| ROUTE | REGIONS | DISTANCE | SOLVE P50/P95 | LEGAL | RESULT |
|---|---|---:|---:|---|---|
| west → east cross-region | west + east | 6,007 m | 52.45 / 62.83 ms | access/oneway/restriction EVET | PASS |
| arterial → residential | merged regions | 1,865 m | 1.22 / 1.53 ms | EVET | PASS |
| residential → residential | merged regions | 4,097 m | 34.36 / 35.70 ms | EVET | PASS |
| local → arterial | merged regions | 0 m | 0.001 / 0.013 ms | EVET | **QUALITY REJECTED: aynı node seçildi** |

Son satır gerçek local→arterial regression kanıtı değildir; bu nedenle overall FULL PASS verilmez.

| PERFORMANCE | MEASURED | PROJECTED TURKEY | CONFIDENCE |
|---|---:|---:|---|
| source | 1.387 MB | UNKNOWN | düşük |
| output | 468,272 B | UNKNOWN | düşük |
| build, cached source | 10.82 s | UNKNOWN | düşük |
| peak process RSS | 308 MB | UNKNOWN | düşük |
| west load P50/P95 | 0.0129 / 0.0401 ms | UNKNOWN | düşük |
| east load P50/P95 | 0.0156 / 0.0349 ms | UNKNOWN | düşük |
| cross route P50/P95 | 52.45 / 62.83 ms | UNKNOWN | düşük |
| resident region count | 2 | corridor-dependent | orta |

Süre ve RAM ölçümleri desktop Node ölçümüdür, head-unit sonucu değildir. Source'un küçük olmasına karşın yüksek RSS, mevcut gerçek builder'ın henüz streaming olmadığını ayrıca kanıtlar. Türkiye projection bu örnekten güvenilir değildir; UNKNOWN bırakıldı.

| CAPABILITY | BEFORE | AFTER | PRODUCTION READY | BLOCKER |
|---|---|---|---|---|
| regional RTG3 artefact | yok | 2 gerçek partition | hayır | geniş corridor/device |
| TurkeyGraphManifest | yok | canonical schema + validator | hayır | update/signing policy |
| integrity gate | yok | SHA+size fail-closed | hayır | device storage path |
| boundary topology | yok | overlap + stable OSM portals | hayır | çoklu tile stress |
| residency | tek graph | 3 region/64 MiB budget + merge | hayır | corridor selection wiring |
| cross-region route | yok | gerçek 6.007 km PASS | hayır | production worker manifest handoff |
| streaming PBF build | yok | yok | hayır | disk-backed/two-pass PBF pipeline |
| nationwide build | yok | yapılmadı | hayır | streaming önce tamamlanmalı |
| production graph | RTG2 | RTG2 untouched | evet, eski davranış | RTG3 swap ayrı gate |

Nationwide build yapılmadı: P0–P10 içindeki streaming PBF şartı karşılanmadı ve küçük corridor build'inin RSS değeri ulusal build'i güvenli kılmıyor. `public/maps/routing-graph.bin` değiştirilmedi.

QA: targeted regional/manifest/residency/RTG/authority 94/94 PASS; `npm run guard` 1004/1004 PASS; full suite 18,994/18,994 PASS; strict `tsc -b` PASS; production build PASS (Vite 3,407 module, 5m16s; mevcut CSS/chunk uyarıları sürüyor).

## Next:

1. PBF için disk-backed iki-geçişli streaming node/way/restriction bucket writer geliştir; RSS bütçesini gerçek province PBF ile ölç.
2. `computeOfflineRoute` worker protokolüne manifest region/corridor seçimini ekleyip aynı kanonik worker A* üzerinde route çalıştır.
3. Pozitif mesafeli local→arterial, üç-tile boundary ve eksik-neighbor failure corpus'unu gerçek veride kapat; head-unit RAM/load testi yap.
