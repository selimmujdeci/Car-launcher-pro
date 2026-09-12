# TURKEY ADDRESS READINESS

## CURRENT ADDRESS COVERAGE

The bounded OSM API snapshots used for the canonical AOIs are the only
address ground truth available in this run. They contain 1 explicit
`addr:street` observation in the Mersin box and no `addr:housenumber` records
in Tarsus, Mersin or Erdemli. Therefore a claim such as “CarOS finds X of 100
real Turkish addresses” is not evidence-backed yet: the current validation
corpus is **1 address-labelled feature (OSM), not 100 independent addresses**.
On that corpus, exact house-number coverage is **0/1**. Tarsus and Erdemli are
**unmeasurable for exact addresses**, not zero in the real world.

Current runtime is not an offline national address index. `offlineSearchService`
searches history/favorites and `addressPlaceIndex` is `NULL_ADDRESS_INDEX`;
`streetSearchService` is an OSM/Overpass street fallback. This is a measured
architecture gap, not a provider-zero inference.

## CURRENT ROAD GRAPH COVERAGE

`public/maps/routing-graph.bin` parses as RTG2: 238,252 nodes, 295,346 edges.
The flags histogram is: motorway 8,013; trunk 73,099; primary 52,169;
secondary 111,639; link/other 50,426. Residential, service, unclassified and
living_street are absent from the shipped graph. The build script confirms its
default is only motorway/trunk/primary/secondary. Consequently the graph is
not door-to-door ready; it is major-road/urban-arterial ready.

## SOURCE SHOOTOUT

| SOURCE | ADDRESS GAIN | STREET GAIN | HOUSE-NO GAIN | DEV STATUS | RELEASE STATUS |
|---|---:|---:|---:|---|---|
| OSM | baseline: 1 labelled feature in the three AOIs | baseline road names measured | 0 in these AOIs | DEV_ALLOWED (bounded official API) | ATTRIBUTION_REQUIRED / ODbL obligations |
| Overture Addresses | 0 in Tarsus/Mersin/Erdemli benchmark | not an address substitute | 0 | DEV_ALLOWED for bounded evaluation via official data client | PERMISSION_REQUIRED until offline redistribution is verified |
| TUCBS / MAKS / UAVT | official themes and regulated access identified; payload not obtained in this run | UNKNOWN | UNKNOWN | DEV_RESTRICTED / permission-controlled | PERMISSION_REQUIRED |
| Municipal CBS (Mersin/Tarsus/Erdemli) | viewer/reports found; public vector payload not verified | UNKNOWN | UNKNOWN | DEV_RESTRICTED | PERMISSION_REQUIRED |
| Yenişehir open data street list | street-name reference, not door numbers | potential reference only | 0 | DEV_ALLOWED where published resource is reachable | PERMISSION_REQUIRED for commercial/offline packaging |
| GeoNames / geoBoundaries | place/admin reference only | 0 | 0 | DEV_ALLOWED | attribution/license review required |

OSM bounded road baseline: Tarsus 40 ways/7 unique names, Mersin 89/51,
Erdemli 20/11. The earlier transport shootout found zero verified independent
road gain from Overture in all three AOIs. Overture Addresses returned zero.

## SEARCH ACCURACY

No defensible 100-query exact/street/not-found percentage exists yet because
the product does not ship a canonical address corpus and the runtime address
index is unconnected. The existing ledger correctly records missing ground
truth rather than manufacturing a success rate. The bounded result that can
be stated is: **0/1 exact house-number matches** in the available OSM-labelled
AOI corpus; street fallback remains provider/network dependent.

## ADDRESS NORMALIZATION

Added pure `addressModel.ts` normalization for Turkish İ/ı, ş, ğ, ç, ö, ü and
Cad/Cd, Sok/Sk, Blv and Mah abbreviations. It is search-only; canonical source
values are untouched. No second search authority was introduced.

## ADDRESS → ROAD SNAP

Added a bounded fail-closed resolver helper that consumes existing
`EdgeProximityHit` observations. It rejects access-forbidden edges, rejects a
distant road-name conflict, and emits `NearestDrivablePoint` only with a
confidence value. It does not bypass existing topology/access authority and
is not connected to production routing.

## DOOR-TO-DOOR ROUTING

No production route authority changed. The existing chain remains
Search → destination handoff → canonical route. The missing production seam is
an indexed, versioned address source plus a graph rebuilt with approved local
road classes and access semantics.

## OFFLINE READINESS

POI SQLite is offline-capable; address search is not. `NULL_ADDRESS_INDEX` and
history/favorites are the only offline address paths. A single national JSON
must not be used. The next implementation should add tile/region-partitioned
AddressIndex records with source/release/evidence/license metadata and an
incremental manifest.

## DEV SOURCE STATUS / COMMERCIAL RELEASE STATUS

Development evaluation is allowed only through official/public bounded
accesses. No authentication bypass, private endpoint, scraping prohibition
evasion, rate-limit bypass or prohibited bulk extraction was used. Unknown
commercial permission is fail-closed: it is recorded as PERMISSION_REQUIRED,
not silently promoted to release.

## BLOCKERS

1. No verified nationwide door-number dataset is connected to CarOS.
2. Shipped graph excludes residential/service/local roads.
3. No 100-address independent validation corpus exists yet.
4. Municipal/TUCBS access and offline redistribution permissions remain
   unresolved.

## TEST RESULTS

- Targeted: `addressModel.test.ts`, `addressSearchLedger.test.ts`,
  `destinationHandoff.test.ts` — 51/51 pass.
- TypeScript and final guard/full-suite/build are recorded in the handoff
  ledger after the closing run.
- Code PASS ≠ DEVICE PASS ≠ FIELD PASS; no device/field claim is made.

## COMMITS

This phase adds the address model seam and tests in a dedicated commit after
the closing QA run. No renderer, MapStore canonical data, or route authority
was changed.

## NEXT 3

1. Obtain a legally permitted bounded MAKS/TUCBS or municipal vector sample
   and build a 100+ address validation corpus with independent provenance.
2. Produce a versioned regional graph including residential/unclassified/
   living_street and approved service roads, preserving access semantics.
3. Connect one AddressIndex adapter to the existing Search authority in shadow
   mode, then measure exact/fallback/not-found and address-to-edge snap rates.

## CAPABILITY MATRIX

| CAPABILITY | CURRENT | AFTER THIS PHASE | TARGET | BLOCKER |
|---|---|---|---|---|
| Province/district/neighbourhood search | online provider-dependent | contract seam documented | offline nationwide | licensed indexed source |
| Street search | OSM/Overpass fallback | unchanged authority + normalized input | offline indexed streets | regional index |
| House number | 0/1 in bounded corpus | model + evidence seam only | verified exact address | MAKS/TUCBS/municipal payload |
| Drivable local roads | absent in shipped graph | measured absent | regional graph coverage | graph rebuild/storage budget |
| Address→road snap | no canonical address source | guarded helper in shadow | topology/access-aware destination | address coordinate + local graph |
| Offline door-to-door | not ready | production unchanged | indexed address + local-road graph | both blockers above |

## SOURCE / ROLE TABLE

| SOURCE | DATA TYPE | OSM INCREMENTAL GAIN | QUALITY | DEV STATUS | RELEASE STATUS | CAROS ROLE |
|---|---|---:|---|---|---|---|
| OSM | roads, partial addr tags, names | baseline | usable but incomplete for doors | DEV_ALLOWED | ATTRIBUTION_REQUIRED | current baseline / evidence |
| Overture Addresses | addresses | 0 in three AOIs | no observed coverage | DEV_ALLOWED | PERMISSION_REQUIRED | benchmark candidate |
| TUCBS / MAKS / UAVT | authoritative address themes | not measured | unknown until payload | DEV_RESTRICTED | PERMISSION_REQUIRED | highest-value candidate |
| Municipal CBS | numarataj/street datasets | not measured | unknown until vector access | DEV_RESTRICTED | PERMISSION_REQUIRED | bounded candidate |
| Overture Transport | road segments | verified gain 0 | enrichment/reference | DEV_ALLOWED | PERMISSION_REQUIRED | reference only |
