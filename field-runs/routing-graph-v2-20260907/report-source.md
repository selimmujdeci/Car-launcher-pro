# CAROS PRO ROUTING GRAPH v2 — FULL DRIVABLE NETWORK REPORT

## 1. AUTHORITY MAP

`scripts/build-routing-graph.mjs` tek graph üretim otoritesidir. RTG2 okuma
otoritesi `src/platform/navigation/map/graph/rtg2Reader.ts`; residency/loading
`graphResidencyRuntime.ts`; spatial candidate üretimi
`edgeSpatialIndex.ts`; route çözümü mevcut Navigation worker/A* zinciridir.
CEH ve guidance canonical route tüketmeye devam eder. Yeni router veya yeni
route truth eklenmedi.

## 2. OLD GRAPH BASELINE

`public/maps/routing-graph.bin`: RTG2, 238.252 node, 295.346 edge, 7.651.542
byte. Flags histogramı: motorway 8.013, trunk 73.099, primary 52.169,
secondary 111.639, link/other 50.426. Tertiary ve local sınıflar dosyada
yoktur. Builder’ın eski default’u yalnız motorway/trunk/primary/secondary idi.

## 3. DRIVABLE ROAD POLICY

Yeni `scripts/routingGraphPolicy.mjs` ile policy açıklaştırıldı:

| ROAD CLASS | OLD | NEW | ROUTABLE | ACCESS ROLE |
|---|---|---|---|---|
| motorway / trunk / primary / secondary | dahil | dahil | evet | ROUTABLE_PUBLIC |
| tertiary | hariç | varsayılan dahil | evet | ROUTABLE_PUBLIC |
| unclassified | hariç | varsayılan dahil | evet | ROUTABLE_PUBLIC |
| residential | hariç | varsayılan dahil | evet | ROUTABLE_PUBLIC |
| living_street | hariç | varsayılan dahil | evet | ROUTABLE_PUBLIC |
| service | hariç | yalnız açık güvenli türler | koşullu | public veya destination-only |
| footway/pedestrian/path/cycleway/steps/... | hariç | hariç | hayır | — |

## 4. ACCESS POLICY

`access`, `motor_vehicle`, `motorcar`, `vehicle` alanlarında `no`, `private`,
`agricultural`, `forestry`, `emergency`, `construction` değerleri reddedilir.
`yes`, `permissive`, `destination`, `customers`, `delivery` açık erişim
kanıtı sağlar. Belirsiz değerler fail-open yapılmaz.

## 5. SERVICE ROAD POLICY

`alley`/genel public service `ROUTABLE_PUBLIC` olabilir. `driveway`,
`parking_aisle`, `drive-through`, `yard`, `emergency_access` yalnız açık izin
varsa `DESTINATION_ACCESS_ONLY` olur; transit shortcut değildir.

Ancak mevcut RTG2 flags yalnız oneway + 3-bit road class taşır. Access role
taşınamadığı için destination-only edge’ler mevcut production binary’sine
otomatik yazılmadı.

## 6. TURN / ONEWAY SEMANTICS

- `oneway=yes/true/1`: ileri tek yön
- `oneway=-1/reverse`: ters tek yön
- motorway ve `_link` etiketsizse implied oneway korunur
- explicit `no/false/0`: çift yön

Turn restriction relation (`no_left_turn`, `only_*`, vb.) builder ve RTG2
formatında bulunmuyor. Bu nedenle turn restriction desteği bu turun açık
blocker’ıdır; uydurma dönüş kısıtı üretilmedi.

Bridge/tunnel/layer ve ara polyline metadata’sı RTG2 binary’de taşınmıyor.
Kesişen geometry’den otomatik junction üretilmemeli.

## 7. TOPOLOGY VALIDATION

RTG2 reader invalid node reference ve truncated binary’yi fail-closed reddeder.
Mevcut binary üzerinde doğrulanan yapısal sayaçlar geçerlidir. Ancak
component/dead-end/duplicate/self-loop/bridge-layer/turn-restriction kalite
ölçümü için kaynak OSM PBF + edge metadata gerekir; mevcut binary bunları
taşımadığı için bu alanlar `UNKNOWN`, sıfır değildir.

## 8. AOI BENCHMARK

Bu turda production graph swap veya bounded graph rebuild yapılmadı; aynı AOI
için yeni PBF graph artefact’ı yoktur. Bu nedenle ölçülmemiş değerler
uydurulmaz:

| AOI | OLD EDGES | NEW EDGES | LOCAL ROAD GAIN | ENDPOINT IMPROVEMENT | ROUTE LATENCY |
|---|---:|---:|---:|---:|---:|
| Tarsus | UNKNOWN AOI subset | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| Mersin dense | UNKNOWN AOI subset | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| Erdemli | UNKNOWN AOI subset | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |

Global shipped baseline kesin olarak local-road sınıflarını içermiyor.

## 9. ROUTE CORPUS

Koordinat tabanlı gerçek route corpus ve yeni graph artefact’ı bulunmadığından
old/new route sonuçları ölçülmedi.

| SCENARIO | OLD RESULT | NEW RESULT | ACCESS LEGAL | ONEWAY LEGAL | VERDICT |
|---|---|---|---|---|---|
| arterial → residential | NOT MEASURED | NOT RUN | UNKNOWN | UNKNOWN | açık benchmark borcu |
| residential → residential | NOT MEASURED | NOT RUN | UNKNOWN | UNKNOWN | açık benchmark borcu |
| dead-end destination | NOT MEASURED | NOT RUN | UNKNOWN | UNKNOWN | açık benchmark borcu |
| service-access destination | NOT MEASURED | NOT RUN | UNKNOWN | UNKNOWN | role encoding blocker |
| one-way street | NOT MEASURED | NOT RUN | UNKNOWN | UNKNOWN | turn/edge corpus gerekli |

## 10. NEAREST DRIVABLE POINT

Turkey Address Readiness turundaki helper mevcut edge proximity hit’lerini
tüketir; access-rejected edge, uzak isim çelişkisi ve düşük confidence reddedilir.
Bu turda graph runtime’a bağlanmadı. Motorway rear-side, opposite carriageway
ve bridge/tunnel level koruması için edge metadata genişletmesi gereklidir.

## 11. PERFORMANCE / SIZE

Yeni graph üretilmediği için node/edge/file/RAM/load/solve değişimi ölçülmedi.
Eski binary boyutu 7,65 MB’tır. Nationwide büyüklük için bounded PBF rebuild
gereklidir; tahmin verilmedi.

## 12. NATIONAL PACKAGING STRATEGY

Tek graph truth korunarak storage/loading partition önerisi:

`Turkey manifest → region graph partitions → hash/license metadata →
incremental update → router residency loader`.

Partition route authority değil, yalnız depolama ve yükleme ayrıntısıdır.
Graph v2 role/turn metadata kararı verilmeden nationwide paketleme yapılmamalı.

## 13. SHADOW RESULT

Policy shadow sonucu: 6 deterministic test PASS. Production graph shadow veya
route comparison çalıştırılmadı. Production default değişmedi.

## 14. BLOCKERS

1. Yeni local-road PBF artefact’ı ve üç AOI old/new benchmarkı yok.
2. RTG2 access role (public vs destination-only) taşımıyor.
3. Turn restriction relation desteği yok.
4. Bridge/tunnel/layer metadata yok.
5. Full-route endpoint ve latency ölçümü yapılmadı.

## 15. TESTS

- `routingGraphPolicy.test.ts` + address/snap regression: 6/6 PASS
- TypeScript: PASS
- changed-file ESLint: exit 0 (ortamın Import-Clixml uyarıları dışında)
- Guard: 1004/1004 PASS; full suite: 842 dosya / 18.986 test PASS; production
  build: PASS (5m30s; mevcut CSS/chunk uyarıları).
- Device/field: PENDING

## 16. COMMITS

Bu rapor ve policy değişiklikleri, yalnız explicit graph-v2 dosyaları stage
edilerek ayrı commit yapılacaktır. Unrelated dirty dosyalara dokunulmadı.

## 17. NEXT 3

1. Tarsus/Mersin/Erdemli PBF bounded rebuild: full local classes + topology
   counters + old/new route corpus.
2. RTG3 veya sidecar edge metadata ile access role, bridge/tunnel/layer ve
   turn restrictions için format kararı.
3. Shadow benchmark sonrası regional graph packaging ve measured performance
   budget.

## CAPABILITY

| CAPABILITY | BEFORE | AFTER | TARGET | BLOCKER |
|---|---|---|---|---|
| Residential graph policy | excluded | default policy included | production graph | rebuild |
| Unclassified/living_street | excluded | default policy included | production graph | rebuild |
| Public service roads | excluded | conditional policy | safe local access | RTG2 role |
| Private roads | not represented | fail-closed policy | never transit | source tags + rebuild |
| Oneway | supported | preserved/tested | full graph | benchmark |
| Turn restrictions | unsupported | unchanged | supported | format/worker |
| Door-to-door endpoint | unavailable | helper remains shadow | offline endpoint | local graph + metadata |
