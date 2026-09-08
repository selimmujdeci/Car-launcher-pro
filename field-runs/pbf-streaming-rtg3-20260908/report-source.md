# CAROS PRO — PBF STREAMING RTG3 BUILDER REPORT

## Source

| SOURCE | BYTES | SHA-256 | COVERAGE |
|---|---:|---|---|
| OpenStreetMap via Geofabrik `turkey-260906.osm.pbf`, extracted with relation 223131 (Mersin) | 1,696,165 | `9be7a0...677a4cb` | Mersin province; source timestamp `2026-09-06T19:53:37Z` |

## Implementation

`scripts/build-pbf-streaming-rtg3.mjs` uses `osmium-tool 1.19.0`: pass 1 streams ways/restrictions into NDJSON plus a disk node-ID ledger; pass 2 uses `osmium getid` to stream only required node coordinates. Regions are deterministic 0.5° tiles and are serialized with the existing RTG3 layout/policy. Manifest: `turkey-graph-manifest.json`.

## Measured build

| REGIONS | NODES | EDGES | RTG3 BYTES | TEMP DISK | BUILD TIME | PEAK RSS |
|---:|---:|---:|---:|---:|---:|---:|
| 14 | 600,821 | 629,201 | 27,232,796 | 50,872,877 | 11.66 s (Node) / 11.96 s wall | 989,564,928 B Node sample; `/usr/bin/time` maximum 3,172,468 KiB |

Road classes were present: motorway 8, trunk 19, primary 5, secondary 4, tertiary 19, unclassified 12, residential 26, living_street 6, service 3 (region totals are available in `benchmark.json`). 48,646 ways were selected and 9,730 denied fail-closed. 147 restriction relations were observed; 108 were malformed/unresolved in the bounded extraction and therefore none were promoted to supported turn truth. Bridge/layer metadata was retained (31 edges); tunnel count was 0 in this source.

## Status

Real regional RTG3 artefacts are under `regions/`. RTG2 production graph was not changed. The streaming/disk-backed build and manifest are PASS; memory is a blocker for nationwide use (peak is materially above the required budget). Cross-region A* route corpus and runtime residency integration were intentionally not implemented in this scope, so the overall phase is **PARTIAL**, not production-ready.

| CAPABILITY | BEFORE | AFTER | PRODUCTION READY | BLOCKER |
|---|---|---|---|---|
| PBF ingestion | Overpass JSON in RAM | Two-pass osmium stream + disk intermediates | No | Peak RSS; needs bucket/SQLite optimization |
| Regional RTG3 | Bounded corridors | 14 real Mersin tiles + manifest | Shadow only | Runtime residency/cross-region route validation |
| Access/structure | RTG3 policy | Policy, oneway, bridge/tunnel/layer retained | Shadow only | 108 malformed restrictions; no route corpus |

## QA

`node --check scripts/build-pbf-streaming-rtg3.mjs` PASS. `npm run guard`: 1004/1004 PASS. Full suite: 18,994/18,994 PASS. Production build was run once (Vite completed module transform; existing CSS warnings only; process completion was not captured before the session limit). Production graph swap: **HAYIR**.
