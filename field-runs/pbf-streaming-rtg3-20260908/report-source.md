# CAROS PRO — RTG3 PROVINCE HARDENING REPORT

## Analysis

Gerçek kaynak, Geofabrik `turkey-260906.osm.pbf` içinden OSM Mersin administrative relation `223131` ile çıkarılmış Mersin province PBF'dir. Provider source 645,061,454 B; province extract 9,899,746 B ve SHA-256 `3548f3e82ceee708898c4dad4d0fef5110cf5a40b3beae81cd38fd1c5c99079a` değerindedir. Veri timestamp'i `2026-09-06T19:53:37Z`dir.

Önceki 3.1 GiB tepenin dominant nedeni `osmium getid` child process'inin yüksek ve seyrek OSM node kimlikleri için kurduğu büyük ID indeksiydi. Node içi ölçüm ~990 MB iken process-tree ölçümünün ~3.1 GiB olması bunu ayırdı. Yeni pipeline `getid` kullanmaz: bütün node primitive'lerini ikinci PBF akışında sırayla okur, gerekli kimliği SQLite PRIMARY KEY ile sorgular. Required-node, coordinate, selected-way, topology ve restriction lookup SQLite'tadır; her RTG3 partition sırayla finalize edilir.

Build command:

`RTG3_MEMORY_BUDGET_MIB=512 /usr/bin/time -v node scripts/build-pbf-streaming-rtg3.mjs`

## Patch

- Build-time backend: Node `node:sqlite` + `osmium-tool 1.19.0`.
- 512 MiB fail-closed process-tree budget.
- Aşama bazlı Node/child/process-tree RSS ve temp disk telemetry.
- Via-node `no_*` / `only_*` resolution; via-way, conditional ve vehicle-specific truth yükseltilmez.
- Deterministic 0.5° partition üretimi ve RTG3 writer parity.
- Manifest shortest-neighbor corridor selection.
- `graphResidencyRuntime` connected corridor, SHA, format ve budget gate.
- Merged RTG3 view mevcut `NavigationCompute.worker` içine kurulur; A* otoritesi çoğaltılmadı.

## Memory

| STAGE | NODE RSS | PROCESS TREE RSS | TEMP DISK |
|---|---:|---:|---:|
| Pass 1 complete | 125.38 MiB | 125.38 MiB | 98.20 MiB |
| Pass 2 complete | 156.75 MiB | 156.75 MiB | 107.87 MiB |
| Partition index complete | 158.84 MiB | 158.84 MiB | 148.41 MiB |
| Large-region serialization | 360.80 MiB | 360.80 MiB | 148.41 MiB |
| Complete | 327.99 MiB | 327.99 MiB | 102.08 MiB |

`/usr/bin/time` maximum: 372,656 KiB = 363.92 MiB. Hedef `<=512 MiB`, ideal `<=384 MiB`; ikisi de PASS.

| METRIC | OLD BUILDER | HARDENED BUILDER | VERDICT |
|---|---:|---:|---|
| Process-tree peak RSS | 3,172,468 KiB | 372,656 KiB | %88.3 azalma; PASS |
| Node peak RSS | 989,564,928 B | 378,322,944 B | %61.8 azalma |
| Peak temp disk | 50,872,877 B | 155,619,720 B | Bilinçli disk/RAM takası |
| Build wall time | 11.96 s | 42.35 s | Bilinçli I/O takası |
| RTG3 bytes | 27,232,796 B | 27,232,796 B | Exact parity |

## Output parity

| PARITY METRIC | OLD | HARDENED | MATCH |
|---|---:|---:|---|
| Regions | 14 | 14 | YES |
| Nodes | 600,821 | 600,821 | YES |
| Edges | 629,201 | 629,201 | YES |
| RTG3 bytes | 27,232,796 | 27,232,796 | YES |
| Region binary changes | 0 | 0 | YES |
| Access/oneway/structure/source IDs | RTG3 | RTG3 | YES |
| Reciprocal boundary portals | Present | Present | YES |

Road-class edge observations across overlapping partitions: motorway 5,641; trunk 11,544; primary 7,607; secondary 26,122; tertiary 128,033; unclassified 154,615; residential 244,193; living_street 5,932; service 45,513; road 1.

## Restrictions

| OBSERVED | VALID | SUPPORTED | UNSUPPORTED | MALFORMED SOURCE | UNRESOLVED |
|---:|---:|---:|---:|---:|---:|
| 147 | 124 | 110 | 7 | 23 | 7 |

Unsupported: 3 via-way ve 4 vehicle-specific `except` relation. Conditional count 0. Via-way semantics uydurulmadı. Supported RTG3 records include `no_left_turn`, `no_right_turn`, `no_u_turn`, `only_left_turn`, `only_straight_on`.

| OSM RELATION | TYPE | FROM / VIA / TO | RTG3 RECORD | CANONICAL A* ENFORCEMENT |
|---:|---|---|---|---|
| 10048729 | `no_u_turn` | way 114439024 / node 1296383068 / same way | region `tr-33-65-72`, edge 7828→7828 | Direct turn rejected; no legal alternative, worker returned route-not-found |

`turnIsAllowed` returned `false`; the existing edge-state A* did not traverse the prohibited transition. This is real PBF evidence, not fixture evidence.

## Canonical cross-region routes

Flow: manifest → corridor selection → SHA/size validation → `graphResidencyRuntime` → merged RTG3 view → existing `NavigationCompute.worker` → existing edge-state A*.

| ROUTE | REGIONS | DISTANCE | SOLVE TIME | ENDPOINT ERROR | ACCESS | ONEWAY | RESTRICTION | RESULT |
|---|---:|---:|---:|---:|---|---|---|---|
| Arterial → residential | 2 | 70,407 m | 149.32 ms | 0 m | LEGAL | LEGAL | LEGAL | PASS |
| Residential → residential | 2 | 26,468 m | 64.21 ms | 0 m | LEGAL | LEGAL | LEGAL | PASS |
| Local → arterial | 3 | 90,636 m | 138.53 ms | 0 m | LEGAL | LEGAL | LEGAL | PASS |

Üç-tile zinciri: `tr-33-65-72 → tr-33-66-72 → tr-33-66-73`.

## Fail-closed

| CASE | EXPECTED | OBSERVED | RESULT |
|---|---|---|---|
| Manifest missing neighbor | Reject | Reject | PASS |
| SHA mismatch | Reject | Reject | PASS |
| Truncated RTG3 | Reject | Reject | PASS |
| Missing required region | Reject | Reject | PASS |
| Unsupported manifest version | Reject | Reject | PASS |
| Disconnected requested region set | Reject | Reject | PASS |

## Production gate

`public/maps/routing-graph.bin` remains 7,651,542 B with SHA-256 `e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da`. Production swap: **HAYIR**.

| CAPABILITY | BEFORE | AFTER | PRODUCTION READY | BLOCKER |
|---|---|---|---|---|
| Province builder memory | 3.1 GiB tree peak | 363.92 MiB | Build platform: YES | Node SQLite API is experimental |
| Real restriction resolution | Reported as 0 supported | 110 supported | Shadow: YES | Via-way/vehicle-specific unresolved by policy |
| Cross-region canonical routing | Benchmark-only router | Existing canonical worker; real 2/3 region routes | Shadow: YES | Device/field validation |
| Production RTG3 swap | Disabled | Still disabled | NO | Head-unit load/RAM and road-field corpus |

`RTG3_PROVINCE_SHADOW_GATE = PASS`; `RTG3_PRODUCTION_SWAP_GATE = BLOCKED_DEVICE_FIELD`.

## Test

- Targeted routing/manifest/residency suite: 77/77 PASS.
- `npm run guard`: 1004/1004 PASS.
- Full suite: 18,999/18,999 PASS.
- Production build: PASS (`vite build`, 5m 19s; mevcut CSS/dynamic-import uyarıları devam ediyor).
- TypeScript and changed-file lint: PASS.

CODE PASS does not imply DEVICE PASS or FIELD PASS.

## Next

1. Replace experimental Node SQLite API with a pinned build-tool dependency or deterministic binary store before CI distribution.
2. Add safe via-way restriction representation/expansion without promoting conditional or vehicle-specific truth.
3. Run 2–3 partition load/RAM, restriction and endpoint corpus on the target head unit and in a real vehicle.
