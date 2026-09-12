# CAROS PRO RTG3 — REAL FULL-DRIVABLE GRAPH VALIDATION

## Analysis:

Durum: **BOUNDED CODE PASS / OVERALL PARTIAL**. Üç AOI gerçek OSM verisinden OLD ve FULL artefact üretti; local-road endpoint kazancı ölçüldü. Production swap yapılmadı. Gerçek AOI'lerde restriction, bridge/tunnel ve destination-only örneği bulunmadığından bu alanlar yalnız deterministic fixture ile doğrulandı; saha/cihaz ve ulusal ölçek hazır değildir.

Kaynak: OpenStreetMap, resmî Overpass API. Alım: `2026-09-07T20:20:57.087Z`; OSM base timestamp: `2026-09-07T20:11:10Z`. Build: `node scripts/build-rtg3-bounded.mjs`. Policy başlangıç sürümü: `2b4f5de8`.

| AOI | bbox | source SHA-256 |
|---|---|---|
| Tarsus | 34.85985,36.9157,34.86435,36.9193 | `157a0a39ad795aed7aa149ec0a54aeae3340465f002c0549cdbabe94686d86db` |
| Mersin dense | 34.6304,36.8093,34.6374,36.8149 | `54cf80683360d02e792b16c2373c0c4cddcd45c3855547493e19ea0bfb46f216` |
| Erdemli | 34.29,36.6318,34.298,36.6382 | `4418e38663d01002854136e2e95ddf7dd585f1c2a7a77cbe5c09bcf624dc3078` |

## Patch:

RTG3, RTG2'yi değiştirmeyen ayrı magic (`0x33475452`) kullanır. Header 16 byte (`magic/node/edge/restriction count`), node 16 byte, edge 28 byte, restriction 16 byte'tır. Edge; OSM way kimliği, road class, access role, direction, bridge/tunnel bitleri ve signed layer taşır. Restriction kaydı `fromEdge/toEdge/viaNode/type` taşır. Reader RTG1/2/3'ü tek authority içinde okur; kısa, bozuk, bilinmeyen enum ve aralık dışı referansı reddeder.

Worker RTG2 A* yolunu değiştirmez. RTG3'te aynı route authority `(node, previousEdge)` durumuna geçer; `no_*`/`only_*` kısıtlarını uygular ve `DESTINATION_ACCESS_ONLY` kenarı yalnız hedefe son giriş olarak kabul eder. Unknown RTG3 access role fail-closed'dur.

| METADATA | RTG2 | RTG3 | VERIFIED |
|---|---|---|---|
| road class | 3-bit, sınırlı | 1..9 | reader + gerçek artefact |
| access role | yok | public / destination-only | reader + fixture; gerçek count 0 destination-only |
| direction | flags bit0 | explicit | Mersin 97 one-way edge |
| bridge/tunnel/layer | yok | explicit | reader + fixture; gerçek AOI count 0 |
| source identity | yok | OSM way u64 | gerçek artefact |
| turn restriction | yok | edge-pair + via + type | reader/runtime + fixture; gerçek AOI count 0 |

| ROAD CLASS | OLD | NEW | ROUTABLE | ACCESS ROLE |
|---|---|---|---|---|
| motorway/trunk/primary/secondary | evet | evet | evet | public |
| tertiary | hayır | evet | evet | public |
| unclassified | hayır | evet | evet | public |
| residential | hayır | evet | evet | public |
| living_street | hayır | varsa | evet | public |
| service | hayır | koşullu | public veya destination-only | policy kararı |

## Test:

### Gerçek graph ölçümü

| AOI | OLD NODES | NEW NODES | OLD EDGES | NEW EDGES | RESIDENTIAL | UNCLASSIFIED | LIVING_STREET | SERVICE |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Tarsus | 0 | 249 | 0 | 275 | 165 | 0 | 0 | 0 |
| Mersin dense | 40 | 309 | 38 | 356 | 216 | 0 | 0 | 5 |
| Erdemli | 0 | 285 | 0 | 287 | 106 | 74 | 0 | 0 |

Tarsus ve Erdemli OLD artefact'larının 16 byte olması ölçüm hatası değildir: bu küçük bbox'larda eski major-only policy hiçbir uygun yol bulmadı. Bunlar benchmark container'ıdır, production graph değildir.

| AOI | OLD SIZE | NEW SIZE | LOAD P50/P95 | ROUTE P50/P95 |
|---|---:|---:|---:|---:|
| Tarsus | 16 B | 11,700 B | 0.0048 / 0.0051 ms | 0.0019 / 0.0058 ms |
| Mersin dense | 1,720 B | 14,928 B | 0.0028 / 0.0042 ms | 0.0051 / 0.0165 ms |
| Erdemli | 16 B | 12,612 B | 0.0021 / 0.0023 ms | 0.0048 / 0.0128 ms |

Bu süreler masaüstü Node mikro-benchmark'ıdır; head-unit sonucu değildir. Corpus her AOI'de 7 gerçek OSM local edge hedefi içerir. Hedefler graph node'u olduğundan NEW error=0 sonucu rastgele adres koordinatına genellenemez.

| SCENARIO | OLD ENDPOINT ERROR | NEW ENDPOINT ERROR | OLD ROUTE | NEW ROUTE | ACCESS LEGAL | ONEWAY LEGAL |
|---|---:|---:|---|---|---|---|
| Tarsus 7 local target | graph yok | median/p90/worst 0 m | 0/7 | 7/7 | evet | evet |
| Mersin 7 local target | median 189.17 m; p90 236.69 m; worst 294.10 m | median/p90/worst 0 m | 6/7 | 7/7 | evet | evet |
| Erdemli 7 local target | graph yok | median/p90/worst 0 m | 0/7 | 7/7 | evet | evet |

İstenen A–G sınıflamasının tamamı gerçek AOI verisiyle kanıtlanamadı: corpus gerçek local-road geometry kullanır, fakat üç extract içinde gerçek restriction/bridge/tunnel/destination-only örneği yoktur. Bu yüzden FULL PASS verilmez.

### Topology

| AOI | components | largest | dead ends | zero/self/duplicate/invalid | one-way | destination-only | bridge/tunnel/layer | restrictions source/supported |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Tarsus | 2 | 69.48% | 22 | 0/0/0/0 | 0 | 0 | 0/0/0 | 0/0 |
| Mersin | 5 | 47.90% | 29 | 0/0/0/0 | 97 | 0 | 0/0/0 | 0/0 |
| Erdemli | 3 | 60.00% | 11 | 0/0/0/0 | 0 | 0 | 0/0/0 | 0/0 |

Component oranları bbox kesiminin sınırda yolları koparmasından etkilenir; ulusal kalite hükmü değildir. Geometrik kesişmeden node üretilmedi: topology yalnız OSM ortak node kimliğinden kurulduğu için üst/alt geçitte sahte junction yaratılmaz.

### Packaging kararı

Bu üç mikro-AOI, Türkiye tek-dosya RAM/load kararına güvenilir ekstrapolasyon sağlamaz. Mevcut 23-bit edge identity tavanı ve local-road büyümesi nedeniyle tercih **regional partition + versioned manifest** olmalıdır; ulusal extract ölçülmeden nihai değildir. Partition storage detayıdır, ikinci route authority değildir.

| CAPABILITY | BEFORE | AFTER | PRODUCTION READY | BLOCKER |
|---|---|---|---|---|
| RTG2 okuma | var | korundu | evet | yok |
| full local road graph | yok | 3 bounded gerçek artefact | hayır | ulusal build/partition |
| access-role routing | yok | RTG3 runtime | hayır | gerçek destination-only corpus |
| turn restrictions | yok | RTG3 model/runtime | hayır | gerçek relation corpus |
| bridge/tunnel/layer | yok | RTG3 metadata | hayır | gerçek AOI validation |
| endpoint yaklaşımı | major-only | bounded corpus'ta belirgin | hayır | arbitrary coordinate + device/field |
| production swap | RTG2 | RTG2 değişmedi | hayır | ayrı release gate |

QA: targeted RTG/policy/authority 77/77 PASS; ETA/RTG regression retry 19/19 PASS; `npm run guard` 1004/1004 PASS; full suite 18,991/18,991 PASS; production build PASS (Vite 3,406 module, 7m25s; mevcut CSS/chunk uyarıları sürüyor). `public/maps/routing-graph.bin` değiştirilmedi (SHA-256 `e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da`).

## Next:

1. Restriction ve grade-separated crossing içeren daha geniş gerçek Mersin/Tarsus corridor corpus'u kur; A–G'nin her sınıfını gerçek veriyle kapat.
2. Türkiye/region PBF üzerinden streaming builder ve `TurkeyGraphManifest` üret; boyut, RAM ve load'u gerçek head unit'te ölç.
3. Arbitrary hedef koordinatlarıyla nearest-drivable edge snap + destination-only son erişim saha corpus'unu çalıştır; ardından ayrı production swap gate'i değerlendir.
