# CAROS NAVİGASYON MİMARİSİ — SPESİFİKASYON v3.0

**Belge kimliği:** `CAROS-NAV-ARCH-SPEC-3.0`
**Tarih:** 2026-09-03 · **Statü:** **F0 · F1 · F2 UYGULANDI** (F3 CEH sırada)
> F0 = sözleşme omurgası (§0–§10) · F1 = L1 MapStore (§F1.0–F1.8) ·
> F2 = L2 Ego/Localization (§F2.0–F2.9). Hiçbiri saha doğrulaması ALMADI —
> kütük #1205–#1219 🔴 `UNKNOWN / DEVICE VALIDATION REQUIRED`.
**Öncelik:** `AI.md` > `CLAUDE.md` > bu belge > `NAVIGATION_ARCHITECTURE_SPEC_v2.md`
> tüm diğer navigasyon belgeleri.

**v2 ile ilişki:** `NAVIGATION_ARCHITECTURE_SPEC_v2.md` **baseline/geçiş referansıdır** ve
algoritma seviyesindeki (EKF denklemleri, HMM emisyon/geçiş, karo formatları `GTL1`/`ADL1`,
maliyet modeli, FMEA) tanımların ayrıntı kaynağı olmaya devam eder. v3, v2'nin **F1 —
Sözleşme Omurgası** fazını **F0** olarak yeniden kapsamlar ve dört sözleşmeyi ekler:
katman bağımlılık yasası, `Evidenced<T>` kanıt sözleşmesi, kanonik bozulma matrisi,
`RealtimeEgoPose`/`MatchedRoadPose` semantik ayrımı, JS-güvenli `EdgeId`, monotonik zaman
kuralı, L8 CONTRACT'ı ve `VehicleEvidenceBus` sınırı.

---

## 0. F0 NE YAPAR / NE YAPMAZ

**Yapar:** navigasyonun v3 çekirdek sözleşmelerini TEK otoritede sabitler ve mimari
guard'ları aktive eder.

**YAPMAZ:** MapStore · EKF · HMM · CEH · routing algoritmalarını IMPLEMENT ETMEZ ·
mevcut çalışan navigasyon davranışını DEĞİŞTİRMEZ · ikinci bir ufuk/konum/rota/ETA
otoritesi KURMAZ · eski tipleri SİLMEZ · toplu refactor YAPMAZ · UI davranışına DOKUNMAZ.

**Kütük:** F0'ın test/tsc yeşili bir özelliği "tamam" YAPMAZ. Saha maddeleri
`docs/DEVICE_VALIDATION_LEDGER.md` #1205–#1207 · `UNKNOWN / DEVICE VALIDATION REQUIRED`.

---

## 1. KATMAN SINIRLARI VE BAĞIMLILIK YASASI

**Tek kaynak:** `src/platform/navigation/contracts/navLayers.ts`

| Katman | Ad | Kanonik sahibi (repo) |
|--------|----|------------------------|
| **L1** | MapStore | *(F1'de)* `public/maps/*` + gelecekteki `map/store/**` |
| **L2** | Ego / Localization | *(F2'de)* `ego/**` · bugün `gpsService` + `navigation/core/mapMatchModel.ts` |
| **L3** | CEH (Ufuk) | *(F3'te)* `horizon/**` · bugün dağınık: `speedLimitService`/Overpass · `curveAdapter` · `roadProfileAdapter` · `enforcementPointsSource` |
| **L4** | Routing | `src/platform/routingService.ts` · `src/platform/navigationService.ts` |
| **L5** | Guidance | `src/platform/navigation/voiceGuidanceRuntime.ts` · `navigation/core/voiceGuidanceModel.ts` · `navigation/core/etaModel.ts` |
| **L6** | Arbitration | `src/platform/navigation/guardian/**` (saf motor: `guardian/guardianEngine.ts`) |
| **L7** | Presentation | `src/components/map/**` · `src/components/map/hud/**` |
| **L8** | Outcome / Accountability | *(SÖZLEŞME ONLY)* `contracts/navOutcomeContract.ts` |

### 1.1 Bağımlılık yasası (`NAV_LAYER_DEPENDENCY_LAW`)

```
L1 → (yok)
L2 → L1
L3 → L1, L2
L4 → L3              ← L1 YOK: yol gerçeği ufuktan (v2 P2 · ADR-N01)
L5 → L3, L4
L6 → L3, L4, L5
L7 → L2..L6          salt-okunur projeksiyon (v2 P3)
L8 → L2..L6          salt-gözlem; hiçbirine YAZMAZ
```

- **Döngüsüz** (kilit: `isDependencyLawAcyclic()`).
- **L4/L5/L6 ∌ L1** (kilit: `routingLayersIsolatedFromMapStore()`).

### 1.2 Aktif mimari guard'lar (F0)

| Guard | Nerede | Kapsam |
|-------|--------|--------|
| `contracts/**` SAF (I/O · timer · `Date.now`/`performance.now` · React · fetch · fs yok) | `navV3ContractsF0.test.ts` + `regression.guards.test.ts` | tüm sözleşme dosyaları, dosya-tabanlı tarama (elle liste yok) |
| `core/**` SAF | `regression.guards.test.ts` "🔒 SAF KATMAN" | mevcut çekirdek modeller |
| Kanonik sembol tek dosyada (ikinci authority yok) | her iki test | `Evidenced` · `NavDegradation` · `NAV_DEGRADATION_SUPPRESSION` · `EdgeId` · `NAV_LAYER_DEPENDENCY_LAW` · `RealtimeEgoPose` · `MatchedRoadPose` |
| L4 truth sahipleri ham kaynak import etmez | `navV3ContractsF0.test.ts` | `routingService.ts` · `navigationService.ts` → `gpsService`/`overpass`/`mapSource*` YASAK (`navGpsPowerBridge` bilinçli istisna — güç portu, truth değil) |
| Bağımlılık yasası döngüsüz + L4–L6 ∌ L1 | `navV3ContractsF0.test.ts` | katman kaydı |

### 1.3 F0'da BİLİNÇLİ ertelenen guard'lar (v2 ile hizalı)

| Guard | Neden ertelendi | Ne zaman |
|-------|-----------------|----------|
| Tam L4–L6 taraması (Guardian adaptörleri dâhil) `overpass`/`gpsService` import edemez | F0 refactor yapmaz; Guardian adaptörleri bugün kaynaklarını çağırır (v2 ADR-N01 F3 işi) | **F3** (`horizon/**` kurulunca) |
| `components/map/**` içinde timer/abonelik YASAK (P3) | `FullMapView.tsx` / `MiniMapWidget.tsx` bugün `setInterval` (FPS/resize pump) + `onGPSLocation` sahibi — F0 UI'a dokunmaz | **F5** (rehberlik/gösterim fazı) |

Bu ertelemeler **açık borçtur**; ilgili faz açıldığında guard eklenir. F0 guard'ları bugün
GERÇEKTEN yeşil geçen kilitlerdir (kör/boş küme guard yok — CLAUDE.md).

---

## 2. KANIT SÖZLEŞMESİ — `Evidenced<T>`

**Tek kaynak:** `src/platform/navigation/contracts/navEvidence.ts`

```ts
interface Evidenced<T> {
  value: T | null;               // grade === 'UNAVAILABLE' iken DAİMA null
  grade: EvidenceGrade;          // 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE'
  source: NavSignalSource;       // GNSS | DEAD_RECKONING | MAP_MATCH | MAP_PACKAGE
                                 //  | ADAS_TILE | ROUTE_PROVIDER | TRAFFIC_PROVIDER
                                 //  | VEHICLE_BUS | DERIVED | NONE
  reason: EvidenceReason;        // LIVE_SOURCE | DETERMINISTIC_DERIVATION | NO_SOURCE
                                 //  | STALE_TIMESTAMP | BELOW_QUALITY_GATE
                                 //  | VERSION_MISMATCH | COVERAGE_NONE | PROVIDER_ERROR
  confidence: number;            // [0,1]
  observedAtMonoMs: MonotonicMs | null;   // performance.now alanı; yoksa null
  freshnessBudgetMs: number | null;       // null → bayatlık HESAPLANMAZ
}
```

**Paralel tip DEĞİLDİR.** `EvidenceGrade` = `sessionInspectorModel.Observability` ile
**birebir aynı sözlük** (`OBSERVED · DERIVED · UNAVAILABLE · STALE`). Kilit test
(`navV3ContractsF0.test.ts` → "EvidenceGrade sözlüğü … BİREBİR AYNI") iki tanımın
senkron kaldığını denetler. Migrasyon yönü: `sessionInspectorModel` ileride bu dosyadan
re-export eder — tersi değil (v2 ADR-N08: `InspectorField` `Evidenced`'den TÜRETİLİR).

**`NavSignalSource` neden araç veri katmanından ayrı:** `valTypes.SignalSource`
(HAL/CAN/OBD/GPS/FUSED) araç sinyal bus'ıdır; navigasyon kaynakları (harita paketi, rota
sağlayıcı, eşleme, ufuk) aynı kümede değildir. `VEHICLE_BUS` girişi köprüdür — güven
orada YENİDEN HESAPLANMAZ.

### 2.1 Güven / tazelik kuralları (bağlayıcı — kilitli)

- `UNAVAILABLE` → `confidence ≤ 0.3` (`UNAVAILABLE_CONFIDENCE_CEIL`). Kurucu zorlar.
- `STALE` → `confidence ≤ 0.5` (`STALE_CONFIDENCE_CEIL`). Kurucu kırpar.
- `observedNav(null | undefined)` → `unavailableNav` (sahte değer yok).
- Bayatlık (`withStaleness`) YALNIZ **monotonik damga + tanımlı pozitif bütçe** varken
  hesaplanır. Eşik yoksa değer STALE'e YÜKSELTİLMEZ.
- `isDecisionGrade` yalnız `OBSERVED`/`DERIVED` + değeri olan kanıtta `true`.

---

## 3. KANONİK BOZULMA SÖZLEŞMESİ — `NavDegradation`

**Tek kaynak:** `src/platform/navigation/contracts/navDegradation.ts`

Seviye sırası (en hafiften en ağıra):
`FULL → NO_TRAFFIC → NO_NETWORK → STALE_MAP_DATA → NO_MAP_DATA → NO_POSITION → SAFE_STOP`

**Susturma matrisi (`NAV_DEGRADATION_SUPPRESSION`) — TEK OTORİTE.** Her seviye, O
SEVİYEDE ilk kez sustuduğu iddiaları listeler; `resolveSuppressedClaims()` kümülatif
birleştirir (ağır seviye hafifin susturduklarını da susturur).

| Seviye | O seviyede EKLENEN susturma | Kullanıcı mesajı |
|--------|-----------------------------|-------------------|
| `FULL` | — | — |
| `NO_TRAFFIC` | `LIVE_TRAFFIC` · `FIRM_ETA` | "Gerçek zamanlı trafik yok — varış tahmini yaklaşık." |
| `NO_NETWORK` | `ONLINE_SEARCH` · `ROUTE_OFFER` | "Çevrimdışı harita — canlı arama ve trafik kapalı." |
| `STALE_MAP_DATA` | `SPEED_LIMIT` · `CURVE_WARNING` · `ENFORCEMENT_WARNING` · `LANE_GUIDANCE` · `SLOPE_PROFILE` | "Harita paketi eski — hız limiti ve viraj uyarıları güvenilir değil." |
| `NO_MAP_DATA` | `ROUTE_GUIDANCE` · `MANEUVER_GUIDANCE` · `FREE_DRIVE_HORIZON` · `VEHICLE_PROJECTION` | "Bu bölge için harita paketi yok — rota ve manevra üretilemiyor." |
| `NO_POSITION` | `POSITION_ON_MAP` | "Konum yok — rehberlik durduruldu." |
| `SAFE_STOP` | *(tümü)* | "Güvenli bir yerde durun." |

- Her seviyenin bir susturma satırı ve bir mesajı VAR (kilit: "her bozulma seviyesinin
  bir susturma satırı VAR" — v2 P9).
- Susturulan iddiayı taşıyan sayı ekranda `—`/rozetle gösterilir; ASLA eski/uydurma
  değerle sunulmaz.
- v2 §9.1 matrisi ile eşleme: `NO_TRAFFIC`/`NO_NETWORK`/`NO_MAP_DATA`/`NO_POSITION` v2'nin
  aynı adlı satırlarıyla; `STALE_MAP_DATA` v2'nin "`adas` yok/uyumsuz" + "paket sürüm
  damgası" (F17) satırlarını birleştirir; `SAFE_STOP` yeni açık üst seviyedir.

---

## 4. EGO SEMANTİĞİ — `RealtimeEgoPose` vs `MatchedRoadPose`

**Tek kaynak:** `src/platform/navigation/contracts/navEgoPose.ts` (ALGORİTMA YOK)

| Tip | Katman | Anlam |
|-----|--------|-------|
| `RealtimeEgoPose` | L2 çıktısı | Aracın fiilen NEREDE olduğu. Hiçbir yola oturtulmamış. `mode` + `horizontalSigmaM` taşır. |
| `MatchedRoadPose` | L3 tarafı | Ego'nun yol grafiğine oturtulmuş TÜREVİ. `rawPose: RealtimeEgoPose` alanını **DAİMA** taşır (tip zorlar). |

**Map-lock koruması:** `MatchedRoadPose.rawPose` her zaman doludur — ham konum ASLA
kaybolmaz. Eşleşmiş konumu ham konummuş gibi tüketmek yanlış-yola-kilitlenmeyi gizler
(v2 FMEA F05). Kilit: `matchedPoseCarriesRaw()`.

**Mod varsayılamaz:** hiçbir tüketici `EgoFixMode`'u varsayamaz; her poz kendi modunu
taşır. `egoModeAllowsGuidance()` yalnız `GNSS`/`GNSS_DR`'de `true` (v2 §5.4 reroute
kapıları).

---

## 5. JS-GÜVENLİ KENAR KİMLİĞİ — `EdgeId`

**Tek kaynak:** `src/platform/navigation/contracts/navEdgeId.ts`

Alanlar: `tileId(32) | localIdx(23) | dir(1)` = **56 bit** → JS `number`'ın 53-bit güvenli
tam sayı sınırını AŞAR. Ayrıca hedef donanımda eski WebView'ler → `BigInt`'e GÜVENİLMEZ.

**Sözleşme:** `EdgeId = { hi: uint32, lo: uint32 }`. Ham `number` kenar kimliği v3
sözleşmelerinde YASAK.

Bit düzeni: `lo` = bit 0..31 · `hi` = bit 32..55 (`hi ≤ 0xFFFFFF`).
`makeEdgeId`/`splitEdgeId` round-trip yapar ve **hiçbir ara sayı 2^32'yi aşmaz**.
Aralık dışı girdi → `RangeError` (sessiz taşma yok). Metin gösterimi: `"hhhhhh:llllllll"`
(hex).

---

## 6. MONOTONİK ZAMAN KURALI

**Tek kaynak:** `src/platform/navigation/contracts/navMonotonicTime.ts` (SAAT OKUMAZ)

- Marka tipleri: `MonotonicMs` (`performance.now` alanı) · `WallClockMs` (`Date.now` alanı).
  Aritmetikte KARIŞTIRILAMAZ (derleyici tutar).
- Navigasyonun TÜM süre/yaş/tazelik hesapları `MonotonicMs` tabanlıdır. "Şu an" kenardan
  enjekte edilir.
- `core/**` ve `contracts/**`: hiçbir saat OKUNMAZ (kilit).
- `Date.now()` yalnız kullanıcıya gösterilen takvim anı + `safeStorage` damgası için
  (CLAUDE.md "Clock Jump Protection" · v2 ADR-N09).
- Mevcut izinli takvim/persistence kullanımları (`voiceGuidanceRuntime`,
  `enforcementPointsSource`, `guardianRuntime`, `destinationHandoff`) F0'da DOKUNULMADI —
  bunlar `core/**` dışıdır ve enjekte edilebilir varsayılan parametre desenindedir.

---

## 7. L8 — OUTCOME / ACCOUNTABILITY (YALNIZ SÖZLEŞME)

**Tek kaynak:** `src/platform/navigation/contracts/navOutcomeContract.ts`

Kavramlar (tip): `NavPrediction<T>` · `NavObservedOutcome<T>` · `NavTraversalRecord` ·
`NavOutcomeComparison<T>`. `compareOutcome()` YALNIZ fark hesaplar.

**HİÇBİR öğrenme / geri besleme / kalıcılık YOK** (kilit: L8 dosyasında `safeStorage` ·
`localStorage` · `subscribe(` · `train` · `gradient` · `.write(` izi yasak).

**Anayasa beyanı (`NAV_OUTCOME_CONTRACT`, makine-okur, kilitli):**
`canWriteAuthoritativeMap: false` · `canWriteHorizonTruth: false` · `canWriteEgoTruth:
false` · `canWriteRouteTruth: false` · `observationTarget: 'SEPARATE_BELIEF_LAYER'` ·
`learningImplemented: false`. Gözlem otoritatif harita gerçeğini DOĞRUDAN EZEMEZ.

---

## 8. `VehicleEvidenceBus` — SINIR / ARAYÜZ

**Tek kaynak:** `src/platform/navigation/contracts/vehicleEvidenceBus.ts`

- Yalnız ARAYÜZ: `VehicleEvidenceBus.read(signal) → VehicleEvidenceReading`.
- Sinyaller: `SPEED_MPS` · `WHEEL_SPEED_MPS` · `YAW_RATE_DPS` · `LONG_ACCEL_MPS2` ·
  `GEAR` · `PARK_BRAKE` · `ODOMETER_M`.
- Dönen `Evidenced<number>`'in `grade`'i bus'tan gelir; navigasyon tarafında
  acquisition confidence YENİDEN HESAPLANMAZ.
- **Fail-closed:** `UNAVAILABLE_VEHICLE_EVIDENCE_BUS` — acquisition authority bağlanana
  kadar her okuma `UNAVAILABLE` (kilit). "Sinyal yok" ≠ "sinyal 0".
- CAN mimarisi F0'da DEĞİŞTİRİLMEDİ. Gerçek adaptör (VDL/signalHub/canonicalVehicleSignal
  saran) ayrı fazda bu arayüzü uygular.

---

## 9. OLUŞTURULAN / DEĞİŞTİRİLEN DOSYALAR (F0)

**Yeni (`src/platform/navigation/contracts/`):**
`navMonotonicTime.ts` · `navEvidence.ts` · `navEdgeId.ts` · `navEgoPose.ts` ·
`navDegradation.ts` · `navLayers.ts` · `navOutcomeContract.ts` · `vehicleEvidenceBus.ts` ·
`index.ts`

**Yeni test:** `src/__tests__/navV3ContractsF0.test.ts` (34 kilit)

**Değiştirilen:** `src/__tests__/regression.guards.test.ts` (+2 kilit: contracts saflığı
+ kanonik otorite tekliği) · `docs/DEVICE_VALIDATION_LEDGER.md` (#1205–#1207) ·
`docs/CAROS_PRO_VIZYONU.md` (navigasyon durum notu) · bu belge.

**Üretim kodu davranışı:** DEĞİŞMEDİ. Yeni sözleşme dosyalarının HİÇBİRİ mevcut runtime
tarafından import EDİLMİYOR (yalnız `index.ts` barrel + testler).

---

## 10. F1'E GEÇMEDEN ÖNCE — GERÇEK BLOCKER

**Yok.** F0 sözleşmeleri kuruldu, guard'lar aktif, navigasyon davranışı değişmedi,
tsc/lint temiz. F1 (MapStore / L1) v2 §2 ve §12/F1 tablosundan devam edebilir; F1'in ilk
işi `map/store/tileGrid.ts` (saf karo matematiği) + `map/store/mapStore.ts` (mevcut
kaynakları SARAN cephe) ve `Evidenced<T>`'nin `srcMask` karşılığı (v2 §2.4).

**Açık borç (kayıtlı):** F3 tam L4–L6 ham-kaynak taraması · F5 presentation timer/abonelik
yasağı (§1.3).

---
---

# F1 — L1 MAPSTORE / MAP TRUTH AUTHORITY

**Statü:** F1 UYGULANDI (2026-09-03) · Kütük: 🔴 #1208–#1211
**Kapsam:** statik harita gerçeğini TEK L1 otoritesinde toplamak; mevcut harita/rota
altyapısını **adaptörle sarmak**. Algoritma yazılmadı, format değiştirilmedi.

---

## F1.0 ÖLÇÜLMÜŞ REPO GERÇEĞİ (kod okundu, önceki rapora güvenilmedi)

| Konu | Bulgu | Kanıt |
|------|-------|-------|
| Rota grafiği | **VAR** — `RTG2`, 238 252 düğüm, 295 346 kenar, 7 651 542 bayt | `public/maps/routing-graph.bin` doğrudan okundu |
| Graf okuyucusu | **Worker İÇİNDE** — ana iş parçacığından erişilemez | `NavigationCompute.worker.ts:33` `GRAPH_URL` · `:52` `_loadGraph()` |
| Graf yetenek otoritesi | `offlineRoutingStatus` (modül durumlu küçük defter) | `navigation/offlineRoutingStatus.ts:60-96` |
| ⚠️ Bayat docblock | `offlineRoutingStatus.ts:5-6` *"artefakt depoda YOKTUR"* diyor — **artık VAR** | dosya 2026-08-22'de eklenmiş |
| Karo kaynak durumu | `mapSourceStore` (zustand) + `mapSourceManager` (cephe) | `mapSourceStore.ts:9` · `mapSourceManager.ts:210` |
| ⚠️ Karo durumu ölçülmüyor | `initializeMapSources()` **üretimde çağrılmıyor**; `refreshMapSources()` yalnız Ayarlar düğmesinden | `MapCore.ts:44` bunu açıkça yazıyor · `SettingsPage.tsx:662` |
| POI | `poi.db` (16.4 MB) var; **yetenek/durum otoritesi YOK** (başarısızlıkta sessizce `[]`) | `poi/offlinePoiService.ts:50` |
| **Karo matematiği** | **ÜÇ AYRI UYGULAMA** ve davranışları AYNI DEĞİL | `mapTileProbe.ts:11` (kırpar) · `CorridorSyncEngine.ts:48` (`1 << z`) · `offlineTileDownloader.ts:82` |
| L4 ham kaynak | `routingService` · `navigationService` **temiz** | F0 kilidi hâlâ yeşil |
| L6 ham kaynak | Guardian ham kaynağı `providers/concrete/**` PORT'unun arkasında tutuyor; VDL'den okuyor | `guardian/providers/concrete/gpsServiceSource.ts:35` |
| Overpass çalışma-anı | `speedLimitService` → yalnız `useEffectiveSpeedLimit` (hook) ve LAB okur; **L4–L6 kullanmıyor** | `navigation/useEffectiveSpeedLimit.ts:23` |

---

## F1.1 `tileGrid.ts` — SLIPPY KARO MATEMATİĞİ (TEK KAYNAK)

**Tek kaynak:** `src/platform/navigation/map/store/tileGrid.ts`

**Kapatılan kusur:** aynı Web Mercator formülü üç yerde bağımsız yazılmıştı ve
**davranışları farklıydı** — biri sonucu `[0, n-1]`e kırpıyor, ikisi kırpmıyordu; biri
`1 << z` kullandığı için `z ≥ 31`de negatif `n` üretiyordu. Karo kimliği yanlışsa
"bu bölge önbellekte var" hükmü de yanlıştır.

**İki katman (kasıtlı):**
- `lngLatToTileRaw*` — **parite katmanı.** Üç eski çağıranın sayısal davranışını
  BİREBİR korur (kilit: eski gövdeler test içinde referans kâhin olarak tutulur).
- `toTile` · `tileBounds` · `tilesForBBox` · `parseTileKey` — **kanonik, FAIL-CLOSED**
  katman. Geçersiz girdi → `null` / `[]`. `tilesForBBox` `TILE_BBOX_MAX_RESULTS = 4096`
  ile sınırlı (sınırsız kuyruk YASAK — v2 §8.4).

**Yeni paralel karo sistemi ÜRETİLMEDİ:** düzen repoda ne ise odur (XYZ, `z/x/y`, KB çapa).

**Delege edilenler (davranış değişmedi):** `mapTileProbe.lngLatToTile` →
`lngLatToTileRawClamped` · `CorridorSyncEngine._tileXY` ve
`offlineTileDownloader.latLonToTileXY` → `lngLatToTileRawUnclamped`.

---

## F1.2 `MapStore` — KANONİK L1 CEPHESİ

**Tek kaynak:** `src/platform/navigation/map/store/mapStore.ts` (SAF fabrika) +
`mapStoreSources.ts` (okuma katmanı) + `index.ts` (`getMapStore()`).

**Cevapladığı sorular:**

| Soru | API |
|------|-----|
| Bu veri kümesi kullanılabilir mi / bayat / yok / bozuk mu? | `getDatasetStatus(dataset, nowMonoMs)` |
| Bu karo mevcut mu? | `hasTile(tile, nowMonoMs)` |
| Statik kenar bilgisi nedir? | `getEdgeMetadata(edgeId, nowMonoMs)` |
| Harita gerçeğinin kökeni nedir? | `MapDatasetStatus.provenance` (bitset) |
| Bütün resim? | `getSnapshot(nowMonoMs)` |

Hepsi `Evidenced<T>` döner (F0 sözleşmesi): grade · source · reason · confidence ·
`observedAtMonoMs` · `freshnessBudgetMs`.

**Port mimarisi:** `MapDataPorts` arayüzü gerçek kaynakları cepheden ayırır. Saf fabrika
(`createMapStore`) hiçbir servisi import etmez; üretim bağlaması `mapStoreSources.ts`tedir
ve **mevcut otoriteleri SARAR** (`offlineRoutingStatus` · `mapSourceStore`) — yeni harita
otoritesi KURULMADI, hiçbir kaynak başlatılmaz/tetiklenmez.

**Zaman:** `nowMonoMs` çağırandan gelir. MapStore saat OKUMAZ, timer KURMAZ.

---

## F1.3 EPİSTEMİK DURUM — `MapDataAvailability`

`AVAILABLE_FRESH` · `AVAILABLE_STALE` · `UNAVAILABLE` · `INVALID`

**Sınıflandırma sırası** (`classifyAvailability`, saf):
1. biçim bozuk → `INVALID` · 2. hiç ölçülmedi → **`null` (hüküm YOK)** ·
3. ölçüldü, yok → `UNAVAILABLE` · 4. ölçüldü, var + bayat → `AVAILABLE_STALE` ·
5. ölçüldü, var → `AVAILABLE_FRESH`

**Pazarlıksız üç kural:**
- **ÖLÇÜLMEDİ ≠ YOK.** Port `available: null` derse sonuç `UNAVAILABLE` **kanıtıdır**
  (`value === null`) — "harita yok" durumu İDDİA EDİLMEZ. (Bu, üretimde gerçekten
  oluşan bir hâldir: `mapSourceStore.sources` boş başlar.)
- **KÖKENSİZ KESİNLİK YASAK.** "Var" deniyor ama `provenance === MAP_SRC_NONE` ise
  kanıt `UNAVAILABLE`a düşürülür (`BELOW_QUALITY_GATE`).
- **Bayatlık yalnız TANIMLI eşikle.** `freshnessBudgetMs === null` → bayatlık
  HESAPLANMAZ (F0 kuralı; uydurma eşik YASAK).

**L1 kendi bozulma otoritesini KURMAZ.** `NavDegradation` eşlemesi çağıranın işidir;
L1 yalnız epistemik durumu üretir.

---

## F1.4 KÖKEN MASKESİ — `MapSourceMask` (kanıt sınıfı DEĞİL)

**Tek kaynak:** `src/platform/navigation/map/store/mapProvenance.ts`

`EvidenceGrade` "ne kadar güvenilir?" sorusunu; `MapSourceMask` "HANGİ fiziksel
kaynaklardan geldi?" sorusunu yanıtlar — ve bir değer aynı anda birden çok kaynaktan
beslenebilir, bu yüzden bitset'tir.

Bitler (değerleri DEĞİŞMEZ): `PACKAGED_GRAPH` · `PACKAGED_POI` · `PACKAGED_TILES` ·
`DEVICE_CACHE` · `ONLINE_TILES` · `ONLINE_ROUTE_PROVIDER` · `LOCAL_ROUTE_DAEMON` ·
`DERIVED_GEOMETRY`.

**İkinci kanıt sistemi DEĞİLDİR:** `EvidenceGrade` kopyalanmaz/sarılmaz; maske
`Evidenced<T>` ile **birlikte** taşınır. Kilit test `mapProvenance.ts` içinde
`'OBSERVED'`/`'DERIVED'`/`Evidenced` izi olmadığını denetler.

---

## F1.5 `EdgeId` GEÇİŞİ — PRECISION-SAFE ADAPTER

**Tek kaynak:** `src/platform/navigation/map/store/legacyEdgeIdAdapter.ts`

Bugünkü graf **karolu değildir**; kenar kimliği dosyadaki **sıra numarasıdır**.
Eşleme: `tileId = LEGACY_MONOLITH_TILE_ID (0xFFFFFFFF)` · `localIdx = kenar sırası` ·
`dir = 0|1`. Nöbetçi `0xFFFFFFFF` seçildi çünkü gerçek karo kimlikleri z9 ızgarasından
gelir (`2^18` karo) — çakışma yapısal olarak imkânsız.

**Precision sözleşmesi:** sessiz truncate YASAK · aralık dışı → `RangeError` ·
round-trip kayıpsız · karolu kimlik sessizce monolit sıra numarası gibi yorumlanamaz
(`toLegacyEdgeRef` ad alanı dışını reddeder).

**Kanıt:** ölçülen 295 346 kenar, 23-bit kimlik uzayının (`8 388 607`) **%3,5**'ini
kullanıyor — ~28× başlık. Kilit test gerçek `.bin` dosyasını okuyup doğrular.

**Binary format DEĞİŞTİRİLMEDİ · okuyucu TAŞINMADI · routing algoritması `number`
düğüm indeksleriyle çalışmaya devam ediyor.** Adapter yalnız MapStore sınırındadır.

---

## F1.6 EKLENEN MİMARİ KİLİTLER (F1)

`src/__tests__/navV3MapStoreF1.test.ts` (44 kilit) + `regression.guards.test.ts` (+3):

| # | Kilit | Yöntem |
|---|-------|--------|
| 1 | `map/store/**` timer · abonelik · scheduler · React · saat · fetch SAHİBİ değil | **klasör taraması** (elle liste yok) |
| 2 | Saf çekirdek yalnız `./` + `../../contracts/` import eder | import taraması |
| 3 | TEK L1 cephesi: `createMapStore` · `MapStore` · `MapDataPorts` birer kez | klasör taraması |
| 4 | **TEK slippy formülü**: `Math.log(Math.tan(` tüm `src/`de tek dosyada | özyinelemeli tarama |
| 5 | `EdgeId` · `EvidenceGrade` · `Evidenced<` tüm `src/`de birer kez | özyinelemeli tarama |
| 6 | Köken maskesi kanıt sınıfını kopyalamaz | kaynak taraması |
| 7 | Okuma katmanı kaynakları TETİKLEMEZ (`initialize`/`refresh`/`probe`/`setState`) | yorumlar sıyrılarak |
| 8 | L4–L6 ham harita/konum kaynağı import etmiyor | import taraması |
| 9 | Guardian ham kaynağı `providers/concrete/**` port'unun arkasında | klasör taraması |
| 10 | Üç eski karo uygulamasıyla **sayısal parite** | referans kâhin (oracle) karşılaştırması |
| 11 | Bozuk/ölçülmemiş veri başarı gibi sunulamaz | davranış testi |
| 12 | Kökensiz kesinlik üretilemez | davranış testi |

---

## F1.7 BİLİNÇLİ ERTELENEN BORÇLAR (F1'de kapanmadı — kayıtlı)

| # | Borç | Neden | Faz |
|---|------|-------|-----|
| B1 | **Karo-başına envanter yok** — `hasTile` üretimde daima `null` (bilinmiyor) | cihazda karo manifesti yok; `mapTileProbe` yalnız örnek yoklar | **F3** (karolu paket + manifest) |
| B2 | **Kenar metadatası okunamıyor** — `getEdgeMetadata` üretimde daima `UNAVAILABLE` | `RTG2` okuyucusu worker içinde; F1 format/okuyucu taşımaz | **F4** (onboard router) |
| B3 | **POI yetenek otoritesi yok** — `POI_DB` daima "ölçülmedi" | `offlinePoiService` durum yayınlamıyor | F3/F4 |
| B4 | **`offlineRoutingStatus` duvar saati taşıyor** (`Date.now`) → monotonik tazelik hesabı yapılamıyor | runtime davranışına dokunmamak için F1'de değiştirilmedi | F2 |
| B5 | **Karo kaynak durumu üretimde ölçülmüyor** — `initializeMapSources()` çağrılmıyor | ürün davranışı değişikliği olurdu; F1 kapsamı dışı | F3 |
| B6 | Harita paketi için **TANIMLI tazelik eşiği yok** → `AVAILABLE_STALE` üretimde erişilemez | uydurma eşik YASAK | F3 (pack TTL) |
| B7 | `offlineRoutingStatus.ts:5-6` docblock'u **bayat** ("artefakt depoda YOKTUR") | yalnız yorum; davranışa etkisi yok | F2 |
| B8 | Tam L4–L6 taraması · presentation timer yasağı | F0'dan devreden | F3 / F5 |

---

## F1.8 F1 ÇIKIŞ DURUMU

| Ölçüt | Durum |
|-------|-------|
| L1 MapStore tek authority | ✅ (kilit 3 + 4 + 5) |
| Mevcut altyapı adaptörle korunmuş | ✅ `offlineRoutingStatus` · `mapSourceStore` sarıldı, hiçbiri değişmedi |
| Runtime davranış değişikliği | ✅ yok (3 karo fonksiyonu sayısal olarak birebir delege) |
| Provenance taşınıyor | ✅ `MapSourceMask` + `Evidenced<T>` |
| stale/unavailable/corrupt ayrımı | ✅ + "ölçülmedi" beşinci hâl olarak ayrı |
| `EdgeId` precision-safe | ✅ gerçek `.bin` üzerinde doğrulandı |
| İkinci evidence/map authority | ✅ yok (kilit 5 + 6) |
| L4–L6 ham kaynak borcu | ✅ büyümedi (kilit 8 + 9) |

---
---

# F2 — L2 EGO / LOCALIZATION (EKF + HMM)

**Statü:** F2 UYGULANDI (2026-09-03) · Kütük: 🔴 #1212–#1219
**Kapsam:** monotonik zaman borcunun kapatılması · EKF ego füzyonu · HMM/Viterbi
yol eşleştirme · kanıtlı poz sözleşmeleri · DR süre + belirsizlik tavanları ·
tek L2 otoritesi. Mevcut çalışan navigasyon **migrate edilmedi**.

---

## F2.0 ÖLÇÜLMÜŞ REPO GERÇEĞİ (kod okundu)

| Konu | Bulgu | Kanıt |
|------|-------|-------|
| Konum kanıt otoritesi | **VAR ve zaten MONOTONİK** — `getLocationEvidence()` fix yaşını `performance.now()` farkından hesaplıyor | `gpsService.ts:1131` · `:1135-1136` · `_lastFixPerfMs` `:1049` |
| Konum tipi | `GPSLocation {latitude, longitude, accuracy, altitude?, heading?, speed?, timestamp}` | `vehicleDataLayer/types.ts:8` |
| Hız otoritesi | `UnifiedVehicleStore.speed` (km/h, füzyonlanmış, `null` = sensör yok) | `UnifiedVehicleStore.ts:128` |
| IMU kapısı | `orientationSensorGate` — ref-count'lu **abonelik** multiplexer'ı | `sensors/orientationSensorGate.ts:260-274` |
| Mevcut eşleştirici | `matchToRoute` — **rota-göreli**, tam yol-ağı DEĞİL; zaten SAF ve monotonik | `navigation/core/mapMatchModel.ts:161` · `:8-18` |
| Eşleştirici tüketicisi | tek: `routingService.ts:1394` | — |
| Tik sahibi | `navigationSessionRuntime` — tek `onGPSLocation` aboneliği + DR `setInterval` | `navigationSessionRuntime.ts:237` · `:368` |
| Mevcut DR tavanı | `DR_MAX_DT_SEC = 60` (ilerleme DR'si) — spec tavanının (90 sn) **ALTINDA** | `utils/interpolation.ts:53` |
| **Duvar-saati tazelik kusuru** | `ageFreshness(offline.lastAttemptAt, nowMs)` — `lastAttemptAt` `Date.now()` ile yazılıyor | `runtime/runtimeDomainAvailabilityAdapters.ts:16` · `:35` · yazan: `offlineRoutingService.ts:250/294/309` |
| **Bayat docblock** | `offlineRoutingStatus.ts` "artefakt depoda YOKTUR" — artefakt 2026-08-22'de eklendi | F1'de ölçüldü (B7) |

### F2 öncesi bulunan gerçek kusurlar

1. **K1 — duvar saatiyle navigasyon tazeliği.** `offlineRoutingStatus` yalnız
   `Date.now()` damgası taşıyordu; ARCH-01 runtime adaptörü bu damgayla yaş
   hesaplıyordu. Akü kesintisi/NTP düzeltmesinde bu hesap **sessizce yanlışlanır**
   (F0 ADR-N09 ihlali). → F2.0'da kapatıldı.
2. **K2 — bayat belge notu (F1/B7).** → F2.0'da düzeltildi.
3. **K3 — `RealtimeEgoPose`/`MatchedRoadPose` üreticisi YOKTU.** F0 sözleşmeleri
   tanımlıydı ama hiçbir üretici yoktu → L3+ için ego gerçeği erişilemezdi.

---

## F2.1 MONOTONİK ZAMAN OTORİTESİ

**Tek okuma noktası:** `src/platform/navigation/time/navClock.ts`
`readMonotonicNow(): MonotonicMs | null` · `isMonotonicClockAvailable()`

- F0 `navMonotonicTime.ts` zamanın **anlamını** sabitler (saf, saat okumaz);
  `navClock` onu **okur**. İkisi birlikte tek semantiktir.
- **Fail-closed:** `performance.now` yoksa sahte sayaç ÜRETİLMEZ → `null` döner,
  hiçbir yaş/tazelik hesaplanmaz, hiçbir poz yayınlanmaz.
- `Date.now()` bu dosyada ve tüm L2 ağacında **HİÇ** kullanılmaz (kilit).
- **Eski modüller zorla taşınmadı:** `gpsService` ve `navigationSessionRuntime`
  zaten `performance.now()` kullanıyor (doğru davranış). Onları taşımak
  davranış değiştirmeyen ama riskli bir toplu refactor olurdu.

**F1/B4 KAPANDI:** `offlineRoutingStatus` artık `lastAttemptAtMonoMs` (monotonik)
taşıyor; `lastAttemptAt` (duvar saati) yalnız gösterim/kayıt içindir ve
**tazelik hesabına sokulmaz**. `mapStoreSources` tazelik damgası olarak yalnız
monotonik alanı kullanıyor. Damga verilmezse `null` kalır → bayatlık
HESAPLANMAZ (uydurma yaş yerine yokluk beyanı).

---

## F2.2 EKF — DURUM VE ÖLÇÜM MODELİ

**Tek kaynak:** `src/platform/navigation/ego/egoKalman.ts` (SAF)

**Durum (v2 §3.1 ile birebir, 5 boyut):**
`x = [pE, pN, ψ, v, b_ω]ᵀ` — yerel ENU teğet düzleminde konum (m) · yön (rad,
0 = Kuzey) · boylamsal hız (m/s) · jiro sapması (rad/s).

**Süreç:** `ṗE = v·sin ψ` · `ṗN = v·cos ψ` · `ψ̇ = ω − b_ω` · `v̇ = a_long` · `ḃ_ω = 0`
Jakobiyen açıkça yazılı; `P' = F·P·Fᵀ + Q`; her adımda simetrikleştirme.

**Geodezi — ikinci otorite YOK:** teğet düzlem ölçeği `navigation/core/geo.ts`
ile **AYNI küresel yarıçapı** (R = 6 371 000 m) kullanır.

| Ölçüm | H | R (v2 §3.2) | Kapı |
|-------|---|-------------|------|
| GNSS konum (2B) | `[pE, pN]` | `max(acc, 3)²` | doğruluk > **50 m** → RED · Mahalanobis `d² > 9.21` → RED |
| GNSS hız | `[v]` | `(0.5 + 0.05·v)²` | — |
| Araç bus hızı | `[v]` | `(0.3)²` | — |
| ZUPT | `[v] = 0` | `(0.05)²` | bus hızı **tam 0** ve `abs(ω) < 2°/s` |
| Yön | `[ψ]` | hıza bağlı | hız `< 5 km/h` → **NOT_APPLICABLE** (durakta GNSS yönü gürültüdür) |

**Pazarlıksız davranışlar (kilitli):**
- **Reddedilen ölçüm başarı SAYILMAZ:** `accepted: false` iken **aynı durum
  nesnesi** geri döner (referans eşitliği test edilir) ve red sayacı artar.
- **Doğruluk BİLİNMİYORSA ölçüm kabul edilmez** (`null`/0/negatif → RED).
- **Belirsizlik büyümesi durumun parçasıdır:** tahmin adımı σ'yı büyütür;
  jiro yokken yön belirsizliği **daha hızlı** büyür (dürüst bilgisizlik).
- **Yeniden çapalama** (> 10 km) konumu korur, **kovaryansı taşır**.
- Yeni sensör UYDURULMADI; eksik sensör → o güncelleme atlanır, σ büyür.

**Ayar notu:** gürültü parametreleri v2 §3.2 **başlangıç** değerleridir,
**sahamızdan ölçülmemiştir** — kalibrasyon kütük maddesidir.

---

## F2.3 MOD MAKİNESİ — İKİ BAĞIMSIZ TAVAN

**Tek kaynak:** `src/platform/navigation/ego/egoModeModel.ts` (SAF)

| Mod | Koşul | Rehberlik |
|-----|-------|-----------|
| `NONE` | hiç fix yok | ✗ |
| `GNSS` | fix yaşı ≤ 3 sn ve üretici GPS | ✓ |
| `GNSS_DR` | fix bayat ama üretici hâlâ GPS, hız kaynağı var | ✓ |
| `DR_ONLY` | üretici ölü hesaplama **veya** σ karar eşiğini aştı | ✗ |
| `LAST_KNOWN` | süre tavanı · σ tavanı · yaş ölçülemedi · hız kaynağı yok | ✗ |

**① SÜRE TAVANI — `DR_TOTAL_MAX_MS = 90 000` (90 sn).** Aşılınca `LAST_KNOWN`.
Kilit hem sabiti hem kaynak metnini denetler: **90 sn AŞILAMAZ**.

**② BELİRSİZLİK TAVANI — 90 sn tek başına yeterli güven şartı DEĞİLDİR.**
Eşikler uydurulmadı, deponun mevcut sabitlerinden **türetildi**:

| Eşik | Değer | Türetme |
|------|:-----:|---------|
| `EGO_SIGMA_DEGRADE_M` | 50 m | `= GNSS_ACCURACY_REJECT_M` — füzyonun belirsizliği, REDDEDECEĞİMİZ bir ölçümden kötüyse karar kalitesinde değildir → **erken** `DR_ONLY` |
| `EGO_SIGMA_LAST_KNOWN_M` | 95 m | `= CORRIDOR_BASE_M(55) + CORRIDOR_ACC_CAP_M(40)` — eşleştirme koridoru tavanı; ötesinde harita eşleştirme de kurtaramaz → `LAST_KNOWN` |

**σ ölçülemezse kötümser:** `LAST_KNOWN` (kanıtsız kesinlik yok).

**Mod ayrımı takvime değil KANITA dayalı:** `GNSS_DR` ile `DR_ONLY` farkı uydurma
bir süre eşiği değil, deponun gerçek sinyali `LocationEvidence.source`
(`'GPS' | 'DEAD_RECKONING' | 'NONE'`).

**Güven:** `egoConfidenceFromSigma(σ) = clamp(1 − σ/95, 0, 1)`.
**"GPS var → güven 1" YAPISAL OLARAK ÜRETİLEMEZ** — güven yalnız ölçülen σ'dan
gelir; σ ölçülemezse 0.

---

## F2.4 HMM / VITERBI YOL EŞLEŞTİRME

**Tek kaynak:** `src/platform/navigation/matching/hmmMatchModel.ts` (SAF)

- **Emisyon:** `log p(z|c) = −½(d⊥/σ_z)²` + yön cezası `−½(Δθ/σ_θ)²`.
  Yön cezası **yalnız ikisi de biliniyorsa** uygulanır — bilinmeyen yön bir
  ceza değil, bir bilgisizliktir.
- **Geçiş:** `d_t = abs(büyükdaire(z_{t−1}, z_t) − ağMesafesi(c_i, c_j))`,
  `log p = −d_t/β`. **Ağ mesafesi bilinmiyorsa `null`** → geçiş terimi
  UYGULANMAZ (uydurma mesafe YASAK) ve katman `topologyEvidence: false`.
- **Viterbi:** pencere `W = 10` (sınırlı — sınırsız kuyruk YASAK), aday tavanı
  **8** (v2 §3.4), yayın gecikmesi `L = 2` → geriye düzeltme iç inanca
  uygulanır, **yayınlanmış akış değişmez** (v2 P8).

**Zorla snap YAPISAL OLARAK imkânsız — `candidate` YALNIZ `MATCHED` iken dolu:**

| Sonuç | Ne zaman | `candidate` |
|-------|----------|:-----------:|
| `MATCHED` | ayrışma yeterli + (metadata veya topoloji kanıtı var) | dolu |
| `AMBIGUOUS` | en iyi/ikinci farkı eşiğin altında (paralel yol · karşı şerit) | **null** |
| `INSUFFICIENT_METADATA` | metadata YOK ve topoloji kanıtı YOK · pencere ısınmadı | **null** |
| `NO_CANDIDATES` | hiç aday yok | **null** |

**Güven** ayrışma marjından (`1 − e^{−Δ}`) — "aday var → güven 1" YASAK.

**Aday üretimi yalnız L1 sınırından:** `matching/roadCandidateSource.ts`
`MapStore` · kanonik `EdgeId` · `StaticEdgeMetadata` dışında hiçbir şeye
dokunmaz. Arama yarıçapı v2 §3.4: `r = min(200, 3σ + 25)`.

**⚠️ ÜRETİMDEKİ DÜRÜST DURUM:** F1 borcu **B2** hâlâ açık — `RTG2` okuyucusu
`NavigationCompute.worker.ts` içindedir, ana iş parçacığından kenar envanteri
okunamaz. Bu yüzden `productionRoadCandidateSource` bugün **aday üretemez** →
HMM `NO_CANDIDATES` → `MatchedRoadPose.matchState = 'UNAVAILABLE'`,
`edgeId = null`. Bu bir gerileme değildir (bugün de ağ-göreli eşleştirme
yoktu); motor ve sınır kuruldu, aday akışı **F4**'te açılır.
**En yakın yola zorla snap etmek bu boşluğu kapatmaz — yalan söyler.**

---

## F2.5 KANIT / TAZELİK / FAIL-CLOSED SEMANTİĞİ

Her authoritative çıktı F0 `Evidenced<T>` taşır. **Dört kaynak AYRI:**

| Değer | `grade` | `source` | Gerekçe |
|-------|:-------:|:--------:|---------|
| Ham GNSS gözlemi | (port girdisi) | — | EKF'e girdi |
| Füzyon ego konumu (GNSS modu) | `DERIVED` | `GNSS` | EKF çıktısı deterministik türetmedir, ham ölçüm DEĞİL |
| Füzyon ego konumu (DR) | `DERIVED` | `DEAD_RECKONING` | üretici ölü hesaplama |
| Hız (araç bus varsa) | `OBSERVED` | `VEHICLE_BUS` | doğrudan bus kanıtı |
| Eşleşmiş yol pozu | `DERIVED` | `MAP_MATCH` | eşleştirme türevi |
| Eşleşme yoksa | `UNAVAILABLE` | `MAP_MATCH` | yokluk beyanı |

- **Tazelik bütçesi uydurulmadı:** `LOCATION_STALE_MS` — deponun TANIMLI eşiği.
- **`confidence` ile `provenance` karıştırılmaz:** güven σ'dan/ayrışmadan,
  köken `NavSignalSource`'tan gelir.
- **Map-lock koruması:** `MatchedRoadPose.rawPose` **daima** doludur (F0 tipi
  zorlar; kilit ayrıca doğrular).
- **"Bilmiyorum" ile "yol dışındasın" AYRI:** kaynak sağlam ama kapsam yoksa
  `OFF_NETWORK`; kaynak yok/ölçülmedi/bozuksa `UNAVAILABLE`.
- Monotonik saat yoksa hiçbir poz yayınlanmaz.
- Sensör port'u patlarsa fail-soft: poz üretilmez, otorite çökmez.

---

## F2.6 TEK OTORİTE KANITI

**Tek cephe:** `src/platform/navigation/ego/egoAuthority.ts`
`createEgoAuthority(deps)` (saf fabrika) + `getEgoAuthority()` (üretim tekili).

| İddia | Kanıt |
|-------|-------|
| `createEgoAuthority` · `EgoAuthority` · `EgoSensorPort` · `RoadCandidateSource` **birer kez** | klasör taraması (F2 testi + regresyon kasası) |
| `RealtimeEgoPose` · `MatchedRoadPose` · `EdgeId` · `EvidenceGrade` · `Evidenced<` `src/` genelinde **birer kez** | özyinelemeli ağaç taraması |
| **İkinci eşleştirme otoritesi YOK** | L2 ağacındaki hiçbir dosya `matchToRoute` içermiyor; `mapMatchModel` (rota-göreli, L4 besler) DEĞİŞTİRİLMEDİ |
| Tik sahipliği YOK | L2'de `setInterval`/`setTimeout`/`scheduleTask`/`new Worker` yok |

**Kontrollü entegrasyon:** `egoAuthority` üretimde **hiçbir yerden çağrılmıyor**;
`observe()` çağrısını tik sahibi olan katman yapacak. F2 yeni poll döngüsü
EKLEMEDİ ve mevcut ilerleme zincirini (`routingService.updateRouteProgress` →
`mapMatchModel`) **değiştirmedi**.

---

## F2.7 EKLENEN MİMARİ KİLİTLER (F2)

`src/__tests__/navV3EgoLocalizationF2.test.ts` (77 kilit) +
`regression.guards.test.ts` (+4):

| # | Kilit | Yöntem |
|---|-------|--------|
| K1 | L2 ham **harita** kaynağı import edemez (11 modül) | klasör taraması |
| K2 | L2 ham **GPS/native** sağlayıcı sahiplenemez (12 desen) | klasör taraması |
| K3 | EKF/HMM saf çekirdekleri timer/I/O/React/native içeremez + yalnız göreli import | dosya + import taraması |
| K4 | L2 ağacında timer/scheduler sahipliği yok | klasör taraması |
| K5 | Kanonik localization cephesi tek tanımlı | klasör taraması |
| K6 | `RealtimeEgoPose`/`MatchedRoadPose`/`EdgeId`/`Evidenced` `src/` genelinde tek | ağaç taraması |
| K7 | **DR tavanı ≤ 90 sn** (sabit + kaynak metni) | değer + regex |
| K8 | HMM aday yokluğunu başarılı eşleşme sunamaz | davranış |
| K9 | Bozuk/ölçülmemiş harita kanıtı kesin eşleşmeye dönüşemez | davranış (3 senaryo) |
| K10 | L4–L6 ham kaynak bağımlılığı büyümedi | import taraması |
| K11 | Okuma katmanı hiçbir sağlayıcıyı başlatmaz/durdurmaz | kaynak taraması + pozitif kanıt |
| K12 | Mevcut rota-göreli eşleştirici değiştirilmedi | kaynak taraması |

---

## F2.8 BİLİNÇLİ ERTELENEN BORÇLAR

| # | Borç | Neden | Faz |
|---|------|-------|-----|
| C1 | **Jiro beslenmiyor** — `yawRateRadPerSec` daima `null` | beslemek `orientationSensorGate` **aboneliğini sahiplenmeyi** gerektirir; F2 yeni abonelik/timer KURMAZ. EKF bunu dürüstçe "jiro yok" işler (yön σ'sı büyür) | F3 (tik sahibiyle) |
| C2 | **`observe()` üretimde çağrılmıyor** — L2 canlı akışta değil | tik sahipliği `navigationSessionRuntime`'da; bağlama ayrı, ölçülebilir bir tur | F3 |
| C3 | **Aday akışı yok** (F1/B2) → `MatchedRoadPose` üretimde `UNAVAILABLE` | `RTG2` okuyucusu worker içinde; F2 formatı/okuyucuyu taşımaz | F4 |
| C4 | **σ_z · β · gürültü parametreleri kalibre edilmedi** | saha kaydı gerekir; literatür değeri üretim değeri sayılmaz | F2 saha turu |
| C5 | ARCH-01 `runtimeDomainAvailabilityAdapters` hâlâ duvar saatiyle yaş gösteriyor | cross-domain ARCH-01 yüzeyi; navigasyon tarafı monotonik alana geçti, adaptör değişimi ayrı domain kararı | ayrı |
| C6 | F1 borçları B1 · B3 · B5 · B6 · B8 | devrediyor | F3/F4/F5 |

---

## F2.9 F2 ÇIKIŞ DURUMU

| Ölçüt | Durum |
|-------|-------|
| Monotonik zaman borcu (F1/B4) kapandı | ✅ |
| Duvar saati navigasyon tazelik otoritesi DEĞİL | ✅ (kilit) |
| EKF gerçek sensörlerle sınırlı, yeni sensör uydurulmadı | ✅ |
| Reddedilen ölçüm başarı sayılmıyor | ✅ (referans eşitliği) |
| Belirsizlik büyümesi durumun parçası | ✅ |
| DR ≤ 90 sn **ve** σ kapısıyla erken degrade | ✅ (kilit K7 + davranış) |
| HMM adayları yalnız L1 sınırından | ✅ (kilit K1) |
| Zorla nearest-road snap yok | ✅ (yapısal) |
| `Evidenced<T>` kopyalanmadı, dört kaynak ayrı | ✅ |
| Tek L2 otoritesi | ✅ (kilit K5 + K6 + K12) |
| Mevcut runtime davranışı değişmedi | ✅ (L2 üretimde çağrılmıyor) |

---
---

# F3 — L3 CEH / ELECTRONIC HORIZON (CANLI EGO + MPP / UFUK OTORİTESİ)

**Durum: `F3 CODE PASS` — saha doğrulaması YAPILMADI (kütük #1220–#1231).**

F3'ün işi tek cümleyle: **"önümde ne var?" sorusunun tek cevaplayıcısını kurmak**
ve F2'de kurulu ama üretimde HİÇ çalışmayan L2 çekirdeğini canlı akışa bağlamak.

---

## F3.0 ÖLÇÜLMÜŞ REPO GERÇEĞİ (kod okundu — önceki rapora güvenilmedi)

| Ölçüm | Bulgu (dosya:satır) |
|-------|---------------------|
| Tik sahipliği | `navigationSessionRuntime.ts:244` — `onGPSLocation` TEK navigasyon aboneliği; `:_drTick` 1 Hz DR zamanlayıcısı aynı dosyada (tek sahiplik) |
| F2 `EgoAuthority` | `ego/egoAuthority.ts:411` `getEgoAuthority()` — **üretimde HİÇ çağrılmıyordu** (C2 açık) |
| Jiro | `ego/egoSources.ts` — `yawRateRadPerSec: null` sabit (C1 açık); `sensors/orientationSensorGate.ts:274` `subscribeMotion` mevcut ve ref-count'lu |
| Aday akışı | `matching/roadCandidateSource.ts:110` — üretimde DAİMA `SOURCE_UNAVAILABLE` (F1/B2: `RTG2` okuyucusu `NavigationCompute.worker.ts:_loadGraph` içinde) |
| L1 sınırı | `map/store/mapStore.ts:158` — `MapStore` yalnız dataset durumu · karo varlığı · kenar metadatası verir. **Kenar geometrisi ve TOPOLOJİ (ardıl kenarlar) YOKTUR** |
| Rota-göreli eşleştirici | `core/mapMatchModel.ts:64` `MapMatchFix` — "aktif rotanın neresindeyim" sorusunu yanıtlar; L4 ilerlemesini besler |
| Rota niyeti kaynağı | `routingService.ts:1661` `getRouteState()` · `:283` `getNavigationCoreSnapshot().fix.alongRemainingM` · `:259` `REROUTE_THRESHOLD_M = 55` |
| Mevcut "ileride" cevaplayıcıları | `guardian/providers/concrete/enforcementMapSource.ts` (denetim noktası — TEK gerçek üretici, kendi koni sorgusuyla) · rota adımları (`maneuverAnchors`). Viraj/limit/eğim/tehlike dilimlerinin **ÜRETİCİSİ YOK** |
| Mevcut CEH | **YOK** — `horizon`/`ElectronicHorizon` adı yalnız F0 sözleşmelerinde geçiyordu |

### F3 öncesi bulunan gerçek kusurlar

1. **L2 üretimde ölüydü.** F2 EKF/HMM kuruluydu ama `observe()` hiçbir üretim
   yolundan çağrılmıyordu → kütükteki "ego" maddeleri sahada **ölçülemezdi**.
2. **Jiro borcu sessizdi.** `yawRateRadPerSec` sabit `null` olduğu için EKF her
   koşulda `ω = 0` varsayıyordu; bu bir hata değil ama **ölçülmemiş bir eksikti**.
3. **"Önümde ne var" sorusunun sahibi yoktu.** Denetim noktası uyarısı kendi
   koni/yarıçap kapısını, rota adımları kendi mesafesini üretiyordu; ikisi
   birbirinden habersizdi ve yeni bir tüketici üçüncü bir hesap kurabilirdi.

---

## F3.1 C2 — CANLI EGO ENTEGRASYONU (yeni sahiplik YOK)

`navEgoHorizonBridge.ts` bir **bileşim köküdür**, katman değildir. Tik sahibi
kendi mevcut kadansıyla çağırır:

```
GPS fix (gerçek)  → noteEgoHeadingFix(heading, speed)   ← jiro İŞARET kanıtı
                  → tickEgoHorizon()
DR tick (1 Hz)    → tickEgoHorizon()                     ← yön gözlemi İTİLMEZ
```

Sıra bilinçlidir: **ego → rota niyeti → ufuk**. Ters sırada ufuk bir tik eski
ego ile kurulurdu. DR tick'inde yön gözlemi itilmez çünkü **DR bir projeksiyondur,
gözlem değildir** — ondan işaret öğrenmek uydurma kanıt olurdu.

**Jiro aboneliği TALEP-GÜDÜMLÜDÜR:** uygulama ömrü boyunca değil, yalnız
navigasyon SÜRERKEN tutulur (`acquireEgoHorizonSession()` aktif tikte
idempotent; bırakma `_onNavigationInactive()` ve `stop()` yollarında). Aksi
hâlde navigasyon kapalıyken de 60 Hz sensör beslemesi açık kalırdı —
`compassDemand` ile aynı gerekçe.

**Kilit:** navigasyon ağacında `onGPSLocation(` **tam 1 dosyada**; köprüde
`setInterval/setTimeout/onGPSLocation` **yok** (kaynak taraması).

---

## F3.2 C1 — JİRO: EKSEN ÖLÇÜLÜR, İŞARET ÖĞRENİLİR

| Soru | F3'ün cevabı | Neden bu şekilde |
|------|--------------|------------------|
| Hangi eksen sapmadır? | ω vektörünün **yerçekimi birim eksenine izdüşümü** (ω·û) | Montaj açısı her araçta farklıdır; "alpha = sapma" varsayımı uydurmadır. İzdüşüm vektör cebiridir, varsayım değil |
| İşaret ne? | GNSS yön değişimiyle **korelasyondan ÖĞRENİLİR** | `accelerationIncludingGravity` işaret sözleşmesi platforma bağlıdır; sabit varsaymak **ters yön öğretme** riskidir |
| Kanıt gelene kadar? | `yawRateRadPerSec = null` (jiro yokmuş gibi) | Yanlış işaret, jirosuz çalışmaktan DAHA KÖTÜDÜR (fail-closed) |
| Açı farkı | `wrapPi` ile **±π sarmalı** | 350° → 10° geçişi `+20°`dir; sarmasız fark tek kuzey geçişinde işareti ters öğretir |
| Δt | yalnız monotonik fark, `YAW_SAMPLE_MAX_DT_MS = 250` üstü boşluk sayılır | Duvar saati L3/L2 karar zincirinde YASAK |

**Kilitlenme koşulu:** ≥15° GNSS dönüşü **VE** jiro integrali / yön değişimi oranı
`[0,5 · 2,0]` bandında **VE** 2 ardışık tutarlı karar. **Düşme:** 3 ardışık çelişki.

Abonelik **L2'de değil** runtime kenarındadır (`navOrientationFeed.ts`) — F2 kilidi
K2 (L2 ham sağlayıcı sahiplenemez) korunur. Oturum kapanınca abonelik düşer ve
**öğrenilen işaret sıfırlanır** (cihaz başka açıyla takılmış olabilir).

---

## F3.3 CEH SÖZLEŞMESİ (`contracts/navHorizon.ts`)

Ufuk üç ayrı gerçeği **karıştırmadan** taşır:

| Kavram | Tip | Anlamı |
|--------|-----|--------|
| Ego çapası | `RealtimeEgoPose` | araç fiilen nerede (L2, ham) |
| Yol çapası | `MatchedRoadPose` | araç hangi kenara oturuyor (L2, türev) |
| Rota niyeti | `RouteIntentSnapshot` | sürücü nereye gitmek istiyor (L4'ten **İTİLİR**) |

**Kol kökeni (`HorizonPathProvenance`)** — hangi kökenin "araç bu yolda" demeye
yettiği tipte sabittir: `MATCHED_ROAD_TOPOLOGY` ve `ROUTE_INTENT_CONFIRMED`
fizikseldir; **`ROUTE_INTENT` DEĞİLDİR**.

**Ufuk durumu (`CehHorizonState`)** dokuz ayrı hüküm taşır — tek bir "yok" kovası
YOKTUR: `HORIZON_AVAILABLE · HORIZON_PARTIAL · AMBIGUOUS_PATH · EGO_UNAVAILABLE ·
EGO_STALE · MAP_UNAVAILABLE · MATCH_UNAVAILABLE · INSUFFICIENT_METADATA ·
NO_HORIZON_SOURCE`. Her biri `degradationForHorizonState()` ile **kanonik**
`NavDegradation`a eşlenir — CEH kendi bozulma sözlüğünü KURMAZ.

**Nesne şekli sabittir** (V8 hidden-class): `distanceFromEgoM · label · magnitude`
her zaman vardır; bilinmeyen alan `UNAVAILABLE` kanıt taşır, silinmez.
`magnitude.value === null` bir **yokluk beyanıdır, sıfır değildir**.

---

## F3.4 MPP — NİYET İLE FİZİKSEL GERÇEK AYRI

```
fiziksel eşleşme? + rota niyeti?
├─ ikisi de var, ÇELİŞİYOR   → AMBIGUOUS_PATH · iki kol korunur · mppPathId = null
├─ ikisi de var, UYUŞUYOR    → MPP · ROUTE_INTENT_CONFIRMED · physicallyConfirmed
├─ yalnız rota niyeti        → MPP · ROUTE_INTENT · güven ≤ 0,6 · HORIZON_PARTIAL
├─ yalnız eşleşme            → MPP · MATCHED_ROAD_TOPOLOGY · uzunluk UNAVAILABLE
└─ hiçbiri                   → MAP_UNAVAILABLE / MATCH_UNAVAILABLE / NO_HORIZON_SOURCE
```

**Çelişki eşiği L3'te İCAT EDİLMEZ:** L4'ün kendi sapma eşiği (`REROUTE_THRESHOLD_M`)
niyetle birlikte itilir. Eşik veya rota geometrisi yoksa **ne doğrulama ne çelişki**
iddia edilir. Belirsizlikte `ambiguityContractHolds()` kilidi hiçbir kolun MPP
işaretli olmamasını garanti eder.

**Bugünkü üretim gerçeği:** yol-ağı eşleşmesi YOK (F1/B2) → ufuk en iyi ihtimalle
`HORIZON_PARTIAL`dır ve `physicallyConfirmed` DAİMA `false`tur. Bu bir eksiklik
değil, **dürüst raporlamadır**.

---

## F3.5 UFUK İÇERİĞİ VE "AHEAD TRUTH" SINIRI

| İçerik | F3 durumu | Gerekçe |
|--------|-----------|---------|
| Manevra/kavşak nesneleri | **ÜRETİLİYOR** (rota niyetinden, yol-boyu mesafeyle) | L4'ün kendi çapa hesabı taşınır; yeni ölçüm yok |
| Kol uzunluğu | rota kolunda ölçülür; eşleşme kolunda `UNAVAILABLE` | L1'de ardıl kenar (topoloji) YOK |
| Hız limiti / viraj / eğim / denetim | **PORT KURULDU, BAĞLANMADI** → `NOT_MEASURED` | Guardian'ın mevcut denetim-noktası hesabının yanına İKİNCİ bir hesap koymak paralel otorite olurdu (§CROSS-DOMAIN 1). Doğru sıra: önce sınır, sonra tüketicinin TEK hamlede taşınması |

`HorizonAttributeOutcome` **"tarandı ve yok" (`NO_OBJECTS_IN_RANGE`)** ile
**"hiç bakılmadı" (`NOT_MEASURED`)** ayrımını tipte tutar. Boş liste asla
"ileride tehlike yok" anlamına gelmez.

**Sınır kilidi:** `enforcementPointsSource` tüketicileri ölçülmüş bir allowlist'e
bağlandı; yeni bir L4+ tüketici eklenirse kilit düşer ve o kod CEH portundan
sormaya zorlanır.

---

## F3.6 EKLENEN MİMARİ KİLİTLER (F3)

`src/__tests__/navV3HorizonF3.test.ts` (66 kilit) + `regression.guards.test.ts` (+6):

| # | Kilit | Yöntem |
|---|-------|--------|
| K1 | L3 ham harita kaynağı import edemez (12 modül) | klasör taraması |
| K2 | L3 ham GPS/native sağlayıcı sahiplenemez (12 desen) | klasör taraması |
| K3 | CEH timer/scheduler sahibi değil | klasör taraması |
| K4 | CEH React/UI bağımlılığı içermez | klasör taraması |
| K5 | CEH duvar saatiyle tazelik hesaplayamaz (`Date.now` · `new Date`) | klasör taraması |
| K6 | Kanonik CEH cephesi tek tanımlı (6 sembol) | `src/` ağaç taraması |
| K7 | Sözleşme tipleri kopyalanamaz (9 tip, `src/` genelinde tek) | ağaç taraması |
| K8 | L3, L4 modüllerini import edemez (yasa yönlü) | import taraması |
| K9 | Navigasyon ağacında ikinci GPS aboneliği yok | ağaç taraması |
| K10 | Orientation ömrü tek sahiplikte | ağaç taraması |
| K11 | Oturum acquire/release dengeli | kaynak + davranış |
| K12 | Mevcut rota-göreli eşleştirici semantiği korundu | kaynak taraması |
| K13 | Köprü tik sahibi değil | kaynak taraması |
| K14 | Yeni ham "ileride" sağlayıcısı doğmadı | allowlist taraması |
| K15 | Üretim öznitelik portu dürüstçe `NOT_MEASURED` | davranış |
| K16 | Aktif rota fiziksel localization truth sayılamaz | davranış |

---

## F3.7 BİLİNÇLİ ERTELENEN BORÇLAR

| # | Borç | Neden | Faz |
|---|------|-------|-----|
| D1 | **Guardian denetim-noktası tüketicisi CEH'e taşınmadı** | taşımadan önce ikinci hesap kurmamak gerekiyordu; taşıma TEK hamlede yapılmalı | F5 |
| D2 | **Öznitelik portu üretimde bağlı değil** (limit · viraj · eğim · denetim) | kaynak yok / paralel otorite riski (D1) | F4/F5 |
| D3 | **Kol topolojisi yok** — ardıl kenar zinciri kurulamıyor | F1/B2: `RTG2` okuyucusu worker içinde | F4 |
| D4 | **CEH hiçbir ürün kararını beslemiyor** (gözlem fazı) | tüketici taşıma ayrı ve ölçülebilir bir tur olmalı | F5 |
| D5 | **Politika sayıları kalibre edilmedi** (ufuk bütçesi · güven tavanı · jiro kapıları) | saha kaydı gerekir | F3 saha turu (#1230) |
| D6 | F1 borçları B1 · B3 · B5 · B6 · B8 · F2 borçları C3 · C4 · C5 | devrediyor | F4/F5 |

---

## F3.8 F3 ÇIKIŞ DURUMU

| Ölçüt | Durum |
|-------|-------|
| F2/C2 (canlı ego) kapandı | ✅ (kilit K9 + K11 + kütük #1220) |
| F2/C1 (jiro) kapandı | ✅ kod · 🔴 **işaret sahada kanıtlanmalı** (#1221) |
| Yeni GPS/orientation aboneliği veya timer | ✅ yok (kilit K9 · K10 · K13) |
| CEH tek "önümde ne var" otoritesi | ✅ (kilit K6 + K14) |
| L3 → L4 ters bağımlılık | ✅ yok (kilit K8; niyet İTİLİR) |
| Duvar saati L3 karar zincirinde | ✅ yok (kilit K5) |
| Niyet ↔ fiziksel gerçek ayrımı | ✅ (kilit K16 + kütük #1224) |
| Zorla MPP / belirsizlik ezme | ✅ yok (yapısal + kilit) |
| UNKNOWN → NONE dönüşümü | ✅ yok (kilit K15) |
| Mevcut navigasyon davranışı değişti mi | ✅ hayır (11 navigasyon paketi + kasa yeşil) |
| Gözlem yüzeyi (LAB) | ✅ mevcut ekran genişletildi (kart 16) — yeni ekran AÇILMADI |
| **Saha doğrulaması** | 🔴 **YOK** — #1220–#1231 `UNKNOWN / DEVICE VALIDATION REQUIRED` |

**Hüküm: `F3 CODE PASS`.** `F3 PASS` yazılamaz — gerçek araç ölçümü yapılmadı.

### F4'e gerçek blocker

**Evet — tek blocker: F1/B2.** Yol-ağı eşleşmesi (`MatchedRoadPose`) üretimde
doğmadan CEH fiziksel doğrulama yapamaz, topoloji kolları kuramaz ve MPP
belirsizlik senaryosu **sahada tetiklenemez**. `RTG2` okuyucusunun
`NavigationCompute.worker` içinden `MapStore` sınırına taşınması F4'ün ilk işidir.

---
---

# F4 — L1/L2 TOPOLOJİ AKTİVASYONU (RTG2 OKUYUCU + CANLI YOL EŞLEŞMESİ)

**Durum: `F4 CODE PASS` — saha doğrulaması YAPILMADI (kütük #1232–#1243).**

F4'ün işi tek cümleyle: **"graf var" durumundan "graf gerçeği kullanılabilir"
durumuna geçmek** — yani F3'ün tek gerçek blocker'ı olan F1/B2'yi kapatmak.

---

## F4.0 ÖLÇÜLMÜŞ REPO GERÇEĞİ (kod + gerçek artefakt okundu)

| Ölçüm | Bulgu (dosya:satır) |
|-------|---------------------|
| `RTG2` ayrıştırma | `NavigationCompute.worker.ts:_loadGraph()` İÇİNDE — ana iş parçacığından erişilemez |
| Gerçek artefakt | `public/maps/routing-graph.bin` doğrudan okundu: **7 651 542 bayt · 238 252 düğüm · 295 346 kenar**; `8 + n×16 + 4 + e×13` ile **birebir** |
| İlk/son kenar | `(0→1, 406 m, tek yön, sınıf 3)` · `(225063→225047, 165 m, çift yön, sınıf 4)` |
| Tek yön oranı | **221 934 / 295 346** kenar tek yönlü (%75) |
| Sınıf dağılımı | 1→8 013 · 2→73 099 · 3→52 169 · 4→111 639 · 7→50 426 · **0/5/6 hiç yok** |
| Aralık dışı kenar | **0** — katı doğrulama parite-güvenlidir |
| Geometri | Kenar = iki düğüm arası **DÜZ segment**; ara poliline **YOK** |
| Metadata | Yalnız `costM` · `oneway` · `roadClass`. Hız limiti · ad · şerit · eğim **YOK** |
| L1 cephesi | `mapStoreSources.ts:_readEdgeMetadata()` daima `null` döndürüyordu |
| L2 aday akışı | `roadCandidateSource.ts:110` daima `SOURCE_UNAVAILABLE` |
| A* | `worker:_aStar` — `HEURISTIC_WEIGHT = 1.2` (ölçülmüş takas, §F2 öncesi tur) |

### F4 öncesi bulunan gerçek kusurlar

1. **Tek dosyalık kilit.** Ayrıştırıcının worker'da olması yalnız bir konum
   sorunu değildi: `MapStore` → aday → HMM → `MatchedRoadPose` → CEH fiziksel
   doğrulama zincirinin TAMAMI bu yüzden üretimde ölüydü.
2. **Sessiz çökme yolu.** Eski ayrıştırıcı kenarların düğüm indekslerini
   DOĞRULAMIYORDU; bozuk bir artefaktta hata A* içinde `nodes[to] === undefined`
   olarak ortaya çıkardı (rota hesabı sırasında, ayrıştırma sırasında değil).
3. **Sıra bağımlılığı görünmezdi.** A*'ın eşit maliyetli rotalar arasındaki
   seçimi komşu SIRASINA bağlıdır; bu, gösterim değiştirilirken sessizce
   bozulabilecek bir davranıştı ve hiçbir test bunu kilitlemiyordu.

---

## F4.1 KANONİK OKUYUCU (`map/graph/rtg2Reader.ts`)

SAF: I/O · `fetch` · timer · React · saat **YOK**. Bayt dizisi dışarıdan gelir.

**Beş sonuç ayrı tutulur** — hiçbiri "yarım graf" üretmez:
`OK · TRUNCATED · UNSUPPORTED_VERSION · INVALID · ID_SPACE_OVERFLOW` (+ `EMPTY`).

- `RTG` ailesinden tanınmayan sürüm (ör. `RTG3`) **v1 sanılmaz**, açıkça
  reddedilir. v1'in sihirli sayısı olmadığı için "magic tutmadı → bozuk" DENMEZ.
- Kenar sayısı 23-bit kimlik uzayını aşarsa `ID_SPACE_OVERFLOW` — sessiz kırpma
  yanlış kenara yanlış öznitelik demektir (F1 precision sözleşmesi).
- Çıktı tipli dizilerdir (`Float32Array`/`Uint32Array`/`Uint8Array`): eski
  nesne grafiği (238k `{lat,lon}` + `Map`) yerine bitişik bellek.

**Binary format DEĞİŞMEDİ:** yeni sürüm çıkarılmadı, artefakt yeniden
üretilmedi, `scripts/build-routing-graph.mjs` üreticisine DOKUNULMADI.

---

## F4.2 WORKER MİGRASYONU VE PARİTE

Worker artık **graf OKUMA sahibi değil, graf YÜRÜTME sahibidir**:
ayrıştırma kanonik okuyucuda, A* · sezgisel ağırlık · `MAX_CLOSED` · mesafe
toplama semantiği **aynen** worker'da.

**Sıra paritesi (pazarlıksız):** CSR komşuluk, eski `Map` gösteriminin ekleme
düzenini birebir korur — kenar `i` için önce `from`'a ileri kol, çift yönlüyse
`to`'ya geri kol. Bu yüzden eşit maliyetli rotalarda seçim de değişmez.

**Parite testi gerçek artefakt üzerinde koşar** (`navV3GraphTopologyF4.test.ts`):
eski gösterim testin içinde yeniden kurulur ve karşılaştırılır →
aynı düğüm/kenar sayısı · örnek düğümlerde aynı komşu sırası · üç O/D çiftinde
aynı düğüm dizisi · aynı mesafe · aynı ulaşılabilirlik · aynı koordinatlar.

---

## F4.3 GRAF SAKİNLİĞİ (`graphResidencyRuntime`)

`MapStore` senkron ve `fetch` sahibi olamaz; ama kenar gerçeğini verebilmesi
için grafın ana iş parçacığında çözülmüş olması gerekir. Bu boşluğu **ağ
çağrısı burada, saf okuma orada** ayrımıyla dolduran runtime katmanı:

- **Talep-güdümlü:** yalnız navigasyon oturumu sürerken alınır/bırakılır
  (jiro beslemesiyle aynı desen). Boşta ~12 MB taşınmaz.
- **Tembel türevler:** komşuluk · ters komşuluk · yakınlık indeksi yalnız
  SORULURSA kurulur.
- **`WeakRef` görünüm:** GC basınç altında geri alabilir; basınç yoksa ikinci
  oturum yeniden indirmez.
- **İkinci yetenek otoritesi YOK:** ölçüm sonucu mevcut `offlineRoutingStatus`
  otoritesine bildirilir (`AVAILABLE`/`GRAPH_MISSING`/`GRAPH_CORRUPT`).

---

## F4.4 L1 CEPHESİ GENİŞLEDİ

| Yeni yüzey | Ne verir | Fail-closed |
|-----------|----------|-------------|
| `getEdgeMetadata` | `lengthM` · `oneway` · `roadClass` | graf yok/bozuk → `UNAVAILABLE` |
| `getEdgeTopology` | giden/gelen kollar **yalnız `EdgeId` ile** | tek yönlünün ters kolu → `UNAVAILABLE` |
| `queryEdgesNear` | yarıçaptaki kenarlar + izdüşüm | `null` = ölçülmedi · `[]` = ölçüldü, yol yok |
| `networkDistanceM` | yol-boyu mesafe (aynı kenar / doğrudan bağlı) | kanıtlanamazsa `null` |

**Ham kimlik sızmaz:** düğüm indeksi ve kenar sıra numarası L1'in dışına
ÇIKMAZ; komşuluk kanonik `EdgeId` ile ifade edilir (kilit: L2/L3 ağacında
`edgeOrdinal` · `toLegacyEdgeRef` · `Uint32Array` yasak).

**Uydurma alan yok:** binary'de olmayan hız limiti/ad/şerit/eğim üretilmez;
`roadClass = 0` bir sınıf değil "BİLİNMİYOR"dur.

---

## F4.5 ADAY ÜRETİMİ VE GEOMETRİ DÜRÜSTLÜĞÜ

Sıcak yol bütçesi için düzgün ızgara indeksi (hücre `0,05°` ≈ 5,5 km):
295 346 kenarı taramak yerine ~9 hücre taranır.

- **Zorla snap yapısal olarak imkânsız:** yarıçap dışı kenar sonuca girmez.
- **Çift yönlü kenar iki yönlü aday üretir** (`dir 0` / `dir 1`, yön 180° ters):
  "paralel yol / ters şerit" ayrımının tek kanıtı segment yönüdür.
- **Poliline yok, öyle davranılmaz:** düz segment üzerindeki izdüşüm oranı
  kenarın GERÇEK uzunluğuna (`costM`) ölçeklenir; aksi hâlde kenar-boyu mesafe
  sistematik olarak eksik çıkardı.
- Antimeridyen · sıfır uzunluk · NaN → indekslenmez/izdüşürülmez (fail-closed).

---

## F4.6 CANLI EŞLEŞME VE CEH DOĞRULAMASI

F2 HMM/Viterbi ve F3 CEH **DEĞİŞTİRİLMEDİ**; yalnız gerçek aday akışı bağlandı.

- Aday yokken `MATCHED` üretilemez (yapısal: trellis ilerletilmez).
- Ağ mesafesi yalnız iki kanıtlı hâlde üretilir (aynı kenar / doğrudan bağlı);
  çok adımlı arama ufuk tik'inde **koşulmaz** ve bilinmeyen mesafe `null` kalır.
- CEH artık gerçekten iki şeyi karşılaştırabilir: rota **niyeti** ile
  **fiziksel** eşleşme → `ROUTE_INTENT_CONFIRMED` / `AMBIGUOUS_PATH` /
  `HORIZON_PARTIAL` / topoloji kolu. Çelişki eşiği hâlâ L4'ün kendi eşiğidir.

---

## F4.7 EKLENEN MİMARİ KİLİTLER (F4)

`src/__tests__/navV3GraphTopologyF4.test.ts` (69 kilit) +
`regression.guards.test.ts` (+6):

| # | Kilit | Yöntem |
|---|-------|--------|
| K1 | `RTG2` ayrıştırıcısı `src/` genelinde tek tanımlı | ağaç taraması |
| K2 | Worker'da ikinci binary ayrıştırma yok | kaynak taraması |
| K3 | L2/L3 ham okuyucu/residency/indeks import edemez | klasör taraması |
| K4 | L2/L3 ham graf belleğini (`ArrayBuffer`/typed array) göremez | klasör taraması |
| K5 | Kenar kimliği yalnız kanonik `EdgeId` | ağaç taraması |
| K6 | Graf içi kimlik (sıra no/düğüm indeksi) L1 dışına sızmaz | klasör taraması |
| K7 | Bozuk graf başarı gibi sunulamaz | davranış |
| K8 | Desteklenmeyen sürüm fail-closed | davranış |
| K9 | Bilinmeyen metadata varsayılana çevrilemez | davranış + kaynak |
| K10 | Aday tavanı F2 sınırını aşamaz | sabit + kaynak |
| K11 | Aday yokken `MATCHED` üretilemez | kaynak (yapısal) |
| K12 | CEH rota niyetini fiziksel gerçek sayamaz | kaynak |
| K13 | A* worker'da kaldı ve tek tanımlı | ağaç taraması |
| K14 | `MapStore` fetch/timer/native sahibi değil | kaynak taraması |
| K15 | Graf okuyucu/komşuluk/indeks saf | kaynak taraması |
| K16 | Binary format/üretici değişmedi | ağaç taraması + sabitler |
| K17 | L4–L6 yeni ham graf bağımlılığı oluşturmadı | kaynak taraması |
| K18 | F1/F2/F3 sözleşmeleri kopyalanmadı | ağaç taraması |
| K19 | Graf sakinliği ikinci yetenek otoritesi kurmaz | kaynak taraması |

---

## F4.8 KAPANAN BORÇLAR

| # | Borç | Durum |
|---|------|-------|
| **F1/B2** | Kenar metadatası okunamıyor (okuyucu worker içinde) | ✅ **KAPANDI** |
| **F2/C3** | Aday akışı yok → `MatchedRoadPose` üretimde `UNAVAILABLE` | ✅ **KAPANDI** (kod) |
| **F3/D3** | Kol topolojisi yok — ardıl kenar zinciri kurulamıyor | ✅ **KAPANDI** (kod) |

---

## F4.9 KALAN BİLİNÇLİ BORÇLAR

| # | Borç | Neden | Faz |
|---|------|-------|-----|
| E1 | **CEH hâlâ hiçbir ürün kararını beslemiyor** (F3/D4) | tüketici taşıma ayrı ve ölçülebilir bir tur olmalı | F5 |
| E2 | Guardian denetim-noktası tüketicisi CEH'e taşınmadı (F3/D1) | ikinci hesap kurmamak için tek hamlede taşınmalı | F5 |
| E3 | Ufuk öznitelik portu bağlı değil (F3/D2) | ADAS verisi bu binary'de YOK — ayrı paket gerekir | F5+ |
| E4 | Ara poliline geometrisi yok | format sınırı; artefakt yeniden üretilmeden aşılamaz | ayrı (format turu) |
| E5 | Çok adımlı ağ mesafesi yok | hot-path bütçesi; gerekirse worker'a sorulur | F5 |
| E6 | Izgara/yarıçap/bellek parametreleri kalibre edilmedi | saha kaydı gerekir | F4 saha turu (#1242) |
| E7 | F1 borçları B1 · B3 · B5 · B6 · B8 · F2/C4 · F2/C5 | devrediyor | F5 |

---

## F4.10 F4 ÇIKIŞ DURUMU

| Ölçüt | Durum |
|-------|-------|
| Tek `RTG2` ayrıştırma otoritesi | ✅ (K1 + K2) |
| Binary format/üretici değişmedi | ✅ (K16) |
| Worker routing paritesi (gerçek graf) | ✅ (3 O/D çifti · komşu sırası · mesafe) |
| `MapStore` kenar/topoloji gerçeği üretimde | ✅ (K14 + davranış) |
| Ham graf kimliği/belleği L1 dışına sızıyor mu | ✅ hayır (K3 · K4 · K6) |
| Aday akışı canlı, zorla snap yok | ✅ (K10 + yapısal yarıçap kapısı) |
| `MatchedRoadPose` üretimde doğabiliyor | ✅ kod · 🔴 saha |
| CEH fiziksel doğrulama yolu | ✅ kod · 🔴 saha |
| Bozuk/desteklenmeyen graf fail-closed | ✅ (K7 + K8) |
| Bilinmeyen metadata uydurulmuyor | ✅ (K9) |
| Mevcut navigasyon davranışı değişti mi | ✅ hayır (navigasyon paketleri + kasa yeşil) |
| Gözlem yüzeyi (LAB) | ✅ kart 16 genişletildi — yeni ekran AÇILMADI |
| **Saha doğrulaması** | 🔴 **YOK** — #1232–#1243 `UNKNOWN / DEVICE VALIDATION REQUIRED` |

**Hüküm: `F4 CODE PASS`.** `F4 PASS` yazılamaz — gerçek araç ölçümü yapılmadı.

### F5'e gerçek blocker

**Kod tarafında blocker YOK.** F5 (tüketici taşıma: Guardian denetim noktası ·
ufuk tüketicileri · ADAS öznitelikleri) teknik olarak başlayabilir.

⚠️ **Ama bir SAHA ön koşulu vardır:** F5 tüketicileri CEH'in *fiziksel*
hükmüne güvenecektir. Yol-ağı eşleşmesinin doğruluğu (#1237 · #1239 · #1240)
gerçek araçta ölçülmeden ürün kararlarını CEH'e bağlamak, ölçülmemiş bir
eşleşmeyi uyarı üretmekte yetkili kılmak demektir. **Sıra: önce saha turu,
sonra F5 tüketici taşıma.**
