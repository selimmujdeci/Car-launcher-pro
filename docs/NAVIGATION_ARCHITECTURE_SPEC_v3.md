# CAROS NAVİGASYON MİMARİSİ — SPESİFİKASYON v3.0

**Belge kimliği:** `CAROS-NAV-ARCH-SPEC-3.0`
**Tarih:** 2026-09-04 · **Statü:** **F0 · F1 · F2 · F3 · F4 · F5 · F6 · F7 · F8 UYGULANDI**
> F0 = sözleşme omurgası (§0–§10) · F1 = L1 MapStore (§F1.0–F1.8) ·
> F2 = L2 Ego/Localization (§F2.0–F2.9) · F3 = L3 CEH (§F3.0–F3.8) ·
> F4 = graf/topoloji aktivasyonu (§F4.0–F4.10) · F5 = gölge otorite + cutover
> kapısı (**bu belgede bölümü YAZILMADI** — kayıtlı borç, bkz. §F5) ·
> F6 = sınırlı koridor + kenar-tabanlı denetim noktası (§F6.0–F6.11) ·
> F7 = L4 rota "neden bu rota?" hesap verebilirliği (§F7.0–F7.9) ·
> F8 = saha ölçüm hazırlığı / enstrümantasyon / replay kanıt paketi
> (§F8.0–F8.12). **Hiçbiri saha doğrulaması ALMADI** — kütük #1205–#1275
> 🔴 `UNKNOWN / DEVICE VALIDATION REQUIRED`.
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

---

# F5 — CEH TÜKETİCİ GÖÇÜ / GÖLGE OTORİTE (BELGE BORCU)

**Statü:** kod UYGULANDI (2026-09-03), **bu belgede bölümü YAZILMADI.**

F5 kodu ve kilitleri repoda mevcuttur — `horizon/cehConsumerContract.ts` ·
`shadow/cehShadowModel.ts` · `shadow/cehShadowRuntime.ts` ·
`shadow/cehGuardianShadowAdapter.ts` · `shadow/cehSuppressionContract.ts` ·
`shadow/cehCutoverGate.ts` + `navV3CehShadowF5.test.ts`. F5'in anlatımı
`docs/CAROS_PRO_VIZYONU.md` → **NAV-V3-F5** maddesindedir ve kütük maddeleri
**#1244–#1251**'dir.

**AÇIK BORÇ (F6'da KAPATILMADI, bilinçli):** bu belgeye F5 bölümünü geriye
dönük yazmak F6'nın kapsamı değildir ve F6 sınır belgesi *"scope'u sessizce
genişletme"* der. Borç burada KAYITLIDIR; F6 metni F5'e atıf yaparken
`CAROS_PRO_VIZYONU.md` → NAV-V3-F5 maddesini kaynak gösterir.

---

# F6 — SINIRLI TOPOLOJİ KORİDORU + KENAR-TABANLI DENETİM NOKTASI

> **Kapsam sözü (F6 sınır belgesi):** F6 şu kanonik zinciri tamamlar —
> `MatchedRoadPose` → *bounded topology corridor* → *edge-based enforcement
> match* → *along-network distance* → *CEH enforcement ahead object* →
> *F5 shadow comparison*. **CEH'i üretim otoritesi YAPMAZ.**

---

## F6.0 ÖLÇÜLMÜŞ GERÇEK (kod + gerçek artefakt okundu, rapora güvenilmedi)

| Ne | Ölçüm |
|----|-------|
| Yönlendirme grafı | `public/maps/routing-graph.bin` · **238 252 düğüm · 295 346 kenar · v2** |
| Graf tipli dizi belleği | **5,48 MB** (`nodeLat/nodeLon/edgeFrom/edgeTo/edgeCostM/edgeFlags`) |
| CSR komşuluk belleği | **4,07 MB** · **368 758 yarım-kenar** |
| Denetim noktası paketi | `public/data/enforcement-points.tr.json` · şema 1 · **1 503 nokta** · `EGM_EDS_MAP` |
| Paket tür dağılımı | `UNKNOWN 1400 · AVERAGE_SPEED 81 · RED_LIGHT 14 · PARKING 8` |
| Paketin TAŞIMADIĞI | yol kimliği · kenar kimliği · yön AÇISI · hız eşiği · şerit · carriageway |

**Sonuç:** bir denetim noktasının hangi kenara ait olduğu veride YAZMAZ; yalnız
GEOMETRİK olarak çıkarılabilir ve bu çıkarım **her zaman kesin değildir**. F6'nın
işi bu belirsizliği gizlemek değil, **sınıflandırmaktır**.

---

## F6.1 SINIRLI KORİDOR — `map/graph/boundedCorridor.ts` (SAF)

*"Aracın oturduğu kenardan başlayarak, önündeki en fazla X metre yol ağı hangi
kenarlardan oluşur ve her kenarın başı araçtan kaç metre ötededir?"*

Yeni bir routing motoru DEĞİLDİR: hedefi yoktur, maliyet fonksiyonu yoktur,
yeniden yol bulmaz. A* hâlâ yalnız `NavigationCompute.worker.ts` içindedir ve bu
dosya onu GÖRMEZ.

**Dört bağımsız tavan** (politika sayıları — sahadan kalibre EDİLMEMİŞTİR):

| Tavan | Değer | Sonuç | Anlamı |
|-------|-------|-------|--------|
| Mesafe bütçesi | çağıran verir, ≤ `CORRIDOR_HARD_MAX_BUDGET_M` = 5 000 m | `BUDGET_EXHAUSTED` | tasarım sınırı — **kesme DEĞİL** |
| Kenar | `CORRIDOR_MAX_EDGES` = 96 | `EDGE_LIMIT` | **KESİLDİ** (kısmi) |
| Düğüm genişletme | `CORRIDOR_MAX_NODE_EXPANSIONS` = 64 | `NODE_LIMIT` | **KESİLDİ** (kısmi) |
| Derinlik | `CORRIDOR_MAX_DEPTH` = 32 | `DEPTH_LIMIT` | **KESİLDİ** (kısmi) |

Ayrıca `INVALID_START` (yasak yön dâhil) ve `NO_TOPOLOGY` (komşuluk okunamadı —
*"yol yok" DEĞİL*). `corridorIsScanComplete()` yalnız `COMPLETE` ve
`BUDGET_EXHAUSTED` için `true`dur; **yalnız bu iki hâlde tüketici "ileride yok"
hükmü kurabilir.**

**Yapısal garantiler:**
- **Yasak yöne çıkılamaz** — `buildGraphAdjacency` tek yönlü kenarın ters kolunu
  HİÇ üretmez (ek kontrol değil, yapı).
- **Döngü koruması** — yönlü kenar anahtarı (`ordinal*2+dir`) `visited` kümesinde.
- **U dönüşü üretilmez** — F4 `_readEdgeTopology` ile birebir aynı kural.
- **Determinizm** — sıraya ekleme `(mesafe, ordinal, dir)` üçlüsüne göre; eşit
  mesafeli iki kolun sırası ASLA rastgele olamaz (aksi hâlde gölge
  karşılaştırması yorumlanamaz).
- **Kuş uçuşuna sessiz düşüş YOK** — topoloji okunamıyorsa `NO_TOPOLOGY`.
- **Ham kimlik L1'de kalır** — dosya graf sıra numarasıyla çalışır; kanonik
  `EdgeId` çevrimi L1 sınırındadır (F4 K6 kilidi korunur).

---

## F6.2 KENAR-TABANLI DENETİM NOKTASI EŞLEŞTİRİCİSİ — `enforcement/enforcementEdgeIndex.ts` (SAF)

**Beş ayrı hüküm — tek "eşleşmedi" kovası YOK:**

| Hüküm | Anlamı |
|-------|--------|
| `MATCHED_TO_EDGE` | tek bir yol açıkça en yakın → bağlandı |
| `AMBIGUOUS_EDGE` | iki AYRI yol ayırt edilemeyecek kadar yakın → **bağlanmadı** |
| `NO_EDGE_MATCH` | yakında yol VAR ama hiçbiri eşik içinde değil |
| `OUTSIDE_COVERAGE` | ölçüldü, bu yarıçapta yol YOK (**tek ölçülmüş yokluk**) |
| `NOT_MEASURED` | L1 hüküm vermedi — **"yok" DEĞİL** |

`matchIsMeasuredAbsence()` YALNIZ `OUTSIDE_COVERAGE` için `true`dur.

**Politika sayıları (kalibre edilmemiş):** dik mesafe tavanı 25 m · belirsizlik
marjı 8 m · sorgu yarıçapı 40 m.

**Yanlış carriageway'e kamera bindirmek yasak:** bölünmüş yolda iki carriageway
AYRI kenarlardır ve bir noktaya ikisi de yakındır. "En yakını seç" demek %50
ihtimalle karşı yöndeki sürücüye uyarı vermektir. Fark marjın altındaysa hüküm
`AMBIGUOUS_EDGE`tir ve nokta HİÇBİR kenara bağlanmaz. Aynı kenarın iki yönü TEK
yol sayılır (aksi hâlde her çift yönlü yol yapay olarak belirsiz görünürdü).

**Yön: kanıtsız iddia yok.** Kaynakta açı yoktur, `directionHint` serbest Türkçe
metindir ve dereceye ÇEVRİLMEZ. Yön uygulanabilirliği yalnız TOPOLOJİDEN:
tek yönlü kenar → `ONEWAY_IMPLIED` · çift yönlü kenar → `UNKNOWN_DIRECTION`.

---

## F6.3 L1 CEPHESİ GENİŞLEDİ — `map/store/mapStore.ts`

- `expandCorridor(start, budgetM, nowMonoMs): Evidenced<RoadCorridor>` — graf
  hükmü yoksa/bozuksa `UNAVAILABLE`; geçersiz bütçe `BELOW_QUALITY_GATE`.
- `alongCorridorDistanceM(corridor, edgeId, alongEdgeM): number | null` —
  **arama YOKTUR, koridor tablosu okunur.** Konum koridorda değilse `null`;
  düz çizgiye DÜŞÜLMEZ. Negatif sonuç MEŞRUDUR (nokta geride kalmıştır) —
  "önümde" hükmünü çağıran kurar.
- `corridorContainsEdge(corridor, edgeId): boolean`.
- `RoadCorridorOutcome` L1'in KENDİ sözlüğüdür (yapısal ayna) — saf çekirdek
  `map/graph/` içinden import ETMEZ; köprü `mapStoreSources.ts`tedir.
- L1 kimlik çevriminde kenar düşerse koridor da **KESİLMİŞ** sayılır
  (`truncated: raw.truncated || edges.length !== raw.edges.length`).

**Neden `networkDistanceM` genişletilmedi:** F4'ün `networkDistanceM`'i HMM
geçiş teriminin sıcak yolunda (aday × aday) çağrılır; oraya çok adımlı arama
koymak GPS kadansında kare karmaşıklık demektir. F6 tüketicisinin ihtiyacı
farklıdır: TEK koridor bir kez genişletilir, mesafe onun içinden OKUNUR
(F4/E5 borcu bu şekilde ve YALNIZ bounded koridor kapsamında kapandı).

---

## F6.4 ÖZNİTELİK PORTU — `enforcementHorizonPort.ts` (bileşim kökü)

**Zincir:** `MatchedRoadPose` (L2) → `MapStore.expandCorridor` (L1) →
`enforcementPointsSource` (ham paket) → `matchEnforcementPointToEdge` (SAF) →
`alongCorridorDistanceM` (yol-boyu mesafe) → `HorizonObject`.

- **Neden `horizon/` ağacında değil:** `horizon/**` L3 sınırıdır ve ham
  sağlayıcıyı DOĞRUDAN ithal edemez (F3 K1/K14). Bu dosya L3'ün DIŞINDA bir
  bileşim köküdür; `horizon/**` içindeki hiçbir dosya onu import ETMEZ (G17).
- **İkinci otorite yok:** graf L1'in, eşleştirme `enforcementEdgeIndex`'in,
  koridor `boundedCorridor`'un tekelidir; burada yalnız SIRALI BAĞLAMA vardır.
- **Yalnız `ENFORCEMENT`:** `boundDomains = ['ENFORCEMENT']`. Hız limiti/viraj/
  eğim kaynağı bu binary'de YOKTUR ve UYDURULMAZ.
- **Üretilen nesne:** kararlı kimlik (`enf:<pointId>:<edgeHi>:<edgeLo>`) ·
  `distanceFromEgoM` (**yol-boyu**, `Evidenced`) · makine-okur etiket
  (`enforcement:<tür>:<yön uygulanabilirliği>`; serbest metin TAŞINMAZ) ·
  `magnitude` = `UNAVAILABLE` (kaynakta hız eşiği YOK) · `edgeId`.
- **Fail-soft ama sessiz değil:** `readAhead` ASLA throw etmez; ama fail-soft
  `NOT_MEASURED`i `NO_OBJECTS_IN_RANGE` gibi SUNMAZ.

**Bağlama (F6.5):** `navEgoHorizonBridge` (bileşim kökü) portu üretir ve
`getCehAuthority().bindAttributePorts(port)` ile bağlar. `boundDomains` CANLI
yansır — `observe()` beklemez. Bozuk port SESSİZCE reddedilir ve üretim
varsayılanı (`UNAVAILABLE_HORIZON_ATTRIBUTE_PORTS`) korunur.

---

## F6.6 ÖLÇÜMÜN BULDUĞU İKİ GERÇEK KUSUR (2026-09-04)

> Bu iki kusur **testler yeşilken** vardı. Gerçek graf üzerinde ölçüm
> yapılmasaydı ikisi de görülmezdi — F6.7'nin varlık sebebi budur.

### Kusur 1 — KESİLMİŞ KORİDOR "İLERİDE YOK" DİYORDU (port seviyesi)

`boundedCorridor` sözleşmesi *"yalnız `COMPLETE`/`BUDGET_EXHAUSTED` hâlinde
tüketici 'ileride yok' hükmü kurabilir"* der ve `corridorIsScanComplete()` bu
amaçla yazılmıştı — **ama üretimde HİÇBİR YERDE ÇAĞRILMIYORDU** (yalnız
`map/store/index.ts` içinden re-export ediliyordu). `enforcementHorizonPort`,
koridor bir TAVANLA kesilmiş olsa bile boş sonucu `NO_OBJECTS_IN_RANGE`
(ölçülmüş yokluk) olarak döndürüyordu.

**Ne kadar sık:** gerçek grafta 2 000 m bütçeyle 300 örneğin **74'ü (%24,7)**
`NODE_LIMIT` ile kesiliyor (F6.7). Teorik kenar durum DEĞİL, olağan hâl.

**Düzeltme:** boş sonuç + `corridor.truncated` → `NOT_MEASURED` /
`BELOW_QUALITY_GATE`. **Bulunan nesneler etkilenmez:** gezinme mesafe sırasında
ilerler, bu yüzden kesme DAİMA uzak uçtadır — yakındaki nesne bulunduysa
gerçektir. `lastCorridorTruncated` LAB'a çıkarıldı (hükmün girdisi görünür).

### Kusur 2 — BOŞ NESNE LİSTESİ "ÖLÇÜLMÜŞ YOKLUK"A ÇEVRİLİYORDU (tüketici seviyesi)

`readCehAhead`, alan kaynağının bağlı olmasını (`domainMeasured`) ölçüm
YERİNE sayıyordu: kol boşsa doğrudan `NO_OBJECT_IN_HORIZON` (ölçülmüş yokluk)
dönüyordu. Port `NOT_MEASURED` dese bile (paket hazır değil · çapa yok · kesik
koridor) bu bilgi kola TAŞINMIYOR, tüketicide yokluk hükmüne dönüşüyordu —
`cehConsumerContract` §3'ün *"`NOT_MEASURED` → `NONE` dönüşümü YASAK"*
kuralının ta kendisi, bir katman yukarıdan ihlal ediliyordu.

**Düzeltme (sözleşme):** `HorizonPath` yeni alan taşır —

```ts
/** Bu kolda kaynağın GERÇEKTEN ölçüm ürettiği nesne türleri (F6). */
readonly measuredKinds: readonly HorizonObjectKind[];
```

- `horizonModel` doldurur: `OBJECTS` **ve** `NO_OBJECTS_IN_RANGE` birer
  ÖLÇÜMDÜR (port baktı); `NOT_MEASURED`/`SOURCE_UNAVAILABLE` DEĞİLDİR.
  Alan↔tür eşlemesi TEK yerde: `horizonAttributePorts.attributeDomainKinds()`.
  Rota niyeti okunan kollarda `MANEUVER` eklenir; rota YOKKEN eklenmez
  ("manevra yok" denemez — soru sorulmamıştır).
- `cehConsumerContract.pathMeasuresDomain()` — **fail-closed**: alan/şekil
  yoksa ölçülmemiş sayılır.
- `readCehAhead` boş kolda önce bunu sorar; ölçülmemişse `NOT_MEASURED`.

**Neden gölge için kritik:** laundering yapılan her yokluk, `compareAhead`
üzerinden `divergenceRatio`ya girer ve o oran **cutover kapısının girdisidir**.
Yani kusur, kapıyı sahte kanıtla besleyebilecek türdendi.

---

## F6.7 SICAK-YOL CPU / BELLEK ÖLÇÜMÜ (görev maddesi 20)

Ölçüm **gerçek artefakt** üzerinde yapılır (`navV3CorridorEnforcementF6.test.ts`
§F6.8), 300 deterministik başlangıç kenarı, ürünün EN BÜYÜK ufuk bütçesiyle
(`HORIZON_MAX_M` = 2 000 m).

| Ölçüm | Değer (host) |
|-------|--------------|
| Hüküm dağılımı | `BUDGET_EXHAUSTED 221 · NODE_LIMIT 74 · COMPLETE 5` |
| **Kesilme oranı** | **%24,7** (74/300) — hepsi düğüm tavanından |
| En çok kenar | 91 / 96 |
| En çok düğüm genişletme | **64 / 64** (tavan BAĞLIYOR) |
| En çok derinlik | 27 / 32 |
| Çok-kenarlı örnek | 296 / 300 (ölçüm KÖR değil) |
| Dallanan örnek | 206 / 300 |
| Genişletme süresi | p50 **0,008–0,020 ms** · p95 **0,041–0,089 ms** · max **0,052–0,231 ms** (iki koşu) |
| 300 çağrı toplam | 4,5–10,0 ms |
| Yığın farkı (1 800 genişletme) | −42,05 MB … +22,00 MB (GC hâkim; **sızıntı imzası YOK**) |

**⚠️ HOST ÖLÇÜMÜ CİHAZ ÖLÇÜMÜ DEĞİLDİR.** Bu süreler geliştirme makinesinin
V8'inde alınmıştır; head unit'in CPU'su, belleği ve termal davranışı BAŞKADIR.
Kütükteki cihaz maddeleri bu ölçümle 🟢 OLMAZ.

**Zaman eşiği bir kilit DEĞİLDİR** (makineye göre değişir → kırılgan guard
olurdu). Kilitlenen: yapısal tavanlar · determinizm · sızıntısızlık. Süre
ÖLÇÜLÜR ve RAPORLANIR.

**Ürün kararına dönen bulgu:** düğüm tavanı 2 000 m bütçede gerçekten bağlıyor
(%24,7). Bu bir kusur değil, **bütçe/tavan kalibrasyonu sorusudur** ve cevabı
sahadan gelir (kütük). F6 bunu gizlemek yerine hükme dönüştürdü: kesik koridor
yokluk iddiası üretemez.

---

## F6.8 EKLENEN MİMARİ KİLİTLER (F6)

`navV3CorridorEnforcementF6.test.ts` — **61 kilit** (8 bölüm):

| Bölüm | Kapsam |
|-------|--------|
| F6.1 | sınırlı gezinme: dört tavan · döngü · tek yön · determinizm · sert bütçe |
| F6.2 | eşleştirici: beş hüküm · belirsizlik marjı · yön uygulanabilirliği · sayaçlar |
| F6.3 | L1 fail-closed kapıları (port yok · graf ölçülmedi · geçersiz bütçe) |
| F6.4 | uçtan uca gerçek tekiller + **kesik koridor → `NOT_MEASURED`** (+ kör olmadığının kanıtı) |
| F6.5 | `bindAttributePorts` — canlı `boundDomains`, bozuk port reddi |
| F6.6 | kapı şartı DÖRT alanı ister, alan bazlı ölçüm TEKİ yeter |
| F6.7 | **G1–G18** mimari kilitler (aşağıda) |
| F6.8 | gerçek graf CPU/bellek ölçümü **M0–M5** |

| Kilit | Ne korur |
|-------|----------|
| G1 | `expandBoundedCorridor` TEK tanımlı (ikinci traversal yok) |
| G2 | Guardian ağacı `boundedCorridor`/`rtg2Reader`/`graphAdjacency` import EDEMEZ |
| G3 | koridor genişletme yalnız L1 + bileşim kökünden çağrılır |
| G4/G5 | dört tavan kaynakta sabit · `visited` olmadan genişleme yok |
| G6 | ham `ordinal` L1 DIŞINA sızmaz |
| G7 | düz çizgi mesafesi ASLA "along" alanına yazılmaz |
| G8 | `AMBIGUOUS_EDGE` kesin ahead-object ÜRETEMEZ |
| G9 | `NOT_MEASURED → ABSENT` dönüşümü YASAK |
| G10/G18 | port ses/uyarı/store/DOM API'si import ETMEZ |
| G11 | CEH production cutover HÂLÂ kapalı |
| G12/G13 | yeni timer YOK · duvar saati yalnız TANI amaçlı |
| G14 | saf çekirdek dosyalar I/O · timer · saat İÇERMEZ |
| G15 | legacy Guardian enforcement sağlayıcısı DEĞİŞMEDİ, hâlâ ÜRETİM sahibi |
| G16 | F5 gölge dürüstlük sözlüğü (9 hüküm) BOZULMADI |
| G17 | `horizon/**` bileşim kökünü/ham sağlayıcıyı import ETMEZ |

**GÜNCELLENEN kilitler (kaldırılmadı — yeni doğru davranışa bağlandı):**
`navV3CehShadowF5.test.ts` fixture'ı artık `measuredKinds` taşır ve **3 yeni
kilit** eklendi (ölçülmemiş alanda yokluk yasağı · kilidin kör olmadığının
kanıtı · `pathMeasuresDomain` fail-closed). `navV3HorizonF3.test.ts`'e **3 yeni
kilit** (port ölçüm üretmezse alan "ölçüldü" sayılmaz · `NO_OBJECTS_IN_RANGE`
ölçümdür · rota yokken `MANEUVER` ölçülmüş sayılmaz).

---

## F6.9 ÜRETİM OTORİTESİ — DEĞİŞMEDİ (pazarlıksız)

| Karar | Sahibi (F6 sonrası) |
|-------|---------------------|
| Denetim noktası uyarısı | **LEGACY** `guardianRuntime` → `enforcementMapSource` |
| Sesli yönlendirme | `voiceGuidanceRuntime` (`owner: 'NAV_SESSION_RUNTIME'`) |
| Manevra mesafesi | `routingService` |
| Hız limiti | `speedLimitService` / `useEffectiveSpeedLimit` |
| CEH denetim çıktısı | **GÖLGE** — `cehShadowRuntime`, yan etki sayısı yapısal **0** |

`CEH_CUTOVER_DEFAULT_OPEN === false` — kapı HİÇBİR girdiyle açılamaz.
`ATTRIBUTE_PORTS_BOUND` şartı DÖRT alanın DÖRDÜNÜ ister; F6 yalnız
`ENFORCEMENT` bağladı → şart hâlâ karşılanmıyor (kasıtlı).
`F4_FIELD_VALIDATION` şartını üreten bir çalışma-zamanı kaynağı YOKTUR (`null`
= ölçülmedi → fail-closed).

---

## F6.10 KALAN BİLİNÇLİ BORÇLAR

| # | Borç | Neden F6'da kapanmadı | Ne zaman |
|---|------|------------------------|----------|
| F1 | Hız limiti · viraj · eğim öznitelik portları BAĞLI DEĞİL | kaynak bu binary'de YOK (`RTG2` bu alanları taşımaz); uydurmak yasak | ADAS paketi geldiğinde |
| F2 | Koridor tavanları ve eşleştirme eşikleri **kalibre edilmedi** | politika sayıları; kalibrasyon saha ölçümüdür | saha turu |
| F3 | %24,7 kesilme oranı ürün için kabul edilebilir mi | host ölçümü karar veremez | saha turu |
| F4 | `guardianAlertRanker` hâlâ `validUntil` taşımıyor | F5'ten devrediyor; parite kanıtı yok | F7+ |
| F5 | Bu belgede **F5 bölümü yazılmadı** | F6 kapsamı değil (sınır belgesi) | ayrı belge turu |
| F6 | `MANEUVER` alanının "ölçüldü" tanımı rota varlığına bağlı | daha ince bir rota-niyeti kanıtı ayrı iştir | F7+ |
| F7 | F1–F4 borçları (B1 · B3 · B5 · B6 · B8 · C4 · C5 · E3 · E6) | devrediyor | F7+ |

---

## F6.11 F6 ÇIKIŞ DURUMU

| F6 sınır belgesi maddesi | Durum |
|--------------------------|-------|
| 1 · ileri yönlü bounded koridor | ✅ `expandBoundedCorridor` |
| 2 · tek yön/topoloji kuralları | ✅ yapısal (ters kol hiç üretilmez) |
| 3 · mesafe/kenar/dal/CPU sınırı | ✅ dört tavan + ölçüldü (F6.7) |
| 4 · döngü/graf patlaması bounded | ✅ `visited` + tavanlar + ölçüm |
| 5 · enforcement ↔ kanonik edge | ✅ `matchEnforcementPointToEdge` |
| 6 · belirsiz eşleşme kesin sayılmaz | ✅ `AMBIGUOUS_EDGE` (G8) |
| 7 · yanlış carriageway üretilemez | ✅ marj kuralı |
| 8 · along-network mesafe | ✅ `alongCorridorDistanceM` (kuş uçuşu YOK) |
| 9 · çok-edge mesafe yalnız koridorda | ✅ tablo okuması, arama yok |
| 10 · straight-line ile sessiz doldurma yok | ✅ (G7) |
| 11 · CEH enforcement ahead object | ✅ `HorizonObject` üretiliyor |
| 12 · provenance/evidence/confidence/reason | ✅ `Evidenced<T>` + kol provenance |
| 13 · ABSENT/NOT_MEASURED/AMBIGUOUS/OUTSIDE_COVERAGE ayrı | ✅ **iki kusur bulundu ve kapatıldı** (F6.6) |
| 14 · F5 gölge karşılaştırması | ✅ `ENFORCEMENT` alanı gölgede ölçülüyor |
| 15 · gölge yan etkisi yok | ✅ yapısal 0 (G10 · G18) |
| 16 · Guardian üretim otoritesi legacy'de | ✅ (G15) |
| 17 · cutover kapısı kapalı | ✅ (G11) |
| 18 · F0–F5 guard'ları bozulmadı | ✅ 981 kasa + F0–F5 paketleri PASS |
| 19 · hedefli testler + tsc + lint | ✅ (aşağıda) |
| 20 · CPU/bellek ölçülüp raporlandı | ✅ F6.7 |
| **Saha doğrulaması** | 🔴 **YOK** — kütük #1261–#1268 |

**Doğrulama (2026-09-04):** `tsc -b --force` PASS · değişen 9 dosyada lint PASS ·
F0–F6 nav paketleri **426 PASS** · LAB navigasyon paketleri **95 PASS** ·
Guardian/oturum paketleri **249 PASS** · regresyon kasası **981 PASS**.
Full suite · production build · native build **KOŞULMADI** (bkz. CLAUDE.md
§IMPLEMENTATION / QA AYRIMI).

**Hüküm: `F6 CODE PASS` — `IMPLEMENTATION COMPLETE / QA REQUIRED`.**
`F6 FIELD PASS` YAZILAMAZ: gerçek araç kullanılmadı.

### F7'ye gerçek blocker

**Kod tarafında blocker YOK.** Ama **saha ön koşulu vardır ve F5'ten
devretmektedir:** cutover kapısının `F4_FIELD_VALIDATION` şartı (kütük
#1232–#1243) gerçek araçta ölçülmeden hiçbir tüketici CEH'e taşınamaz. F6 bu
şartı DEĞİŞTİRMEDİ; yalnız kapıya bağlanacak zinciri kanıtlanabilir hâle
getirdi. **Sıra: önce saha turu, sonra tüketici taşıma.**

---

# F7 — L4 ROTA: "NEDEN BU ROTA?" HESAP VEREBİLİRLİĞİ

> **⚠️ ÖNCE BİR DÜZELTME (kanıtla):** bu belgede **v3-F7 diye TANIMLANMIŞ bir faz
> YOKTU.** F7 kelimesi yalnız borç tablolarında "F7+" olarak geçiyordu
> (§F1.7/B8 · §F6.10). Kanonik faz planı `NAVIGATION_ARCHITECTURE_SPEC_v2.md`
> **§12**'dedir ve **farklı numaralandırır**: v2/F1 = sözleşme omurgası (v3'te
> F0'a çekildi) · v2/F2 = EGO · v2/F3 = CEH · **v2/F4 = ROTA** · v2/F5 =
> REHBERLİK·ARBİTRAJ·GÖSTERİM · v2/F6 = İLERİ (tetikleyici eşikle).
>
> v3, v2/F3'ün (CEH) içeriğini **üç turda** karşıladı (F3 sözleşme · F4 graf/
> topoloji · F6 koridor+denetim) ve araya bir güvenlik fazı ekledi (F5 gölge).
> Dolayısıyla **katman planında sıradaki faz L4 — ROTA**'dır. F7 bu belgede
> ilk kez tanımlanıyor ve kapsamı v2 §5 (L4) ile sınırlıdır.

---

## F7.0 ÖLÇÜLMÜŞ GERÇEK (kod okundu — 2026-09-04)

| Ne | Ölçüm | Kanıt |
|----|-------|-------|
| L4 sahibi | `routingService.ts` (1 824 satır) + `navigationService.ts` (1 494) | v3 §1 katman tablosu |
| Maliyet modeli (v2 §5.2) | **YOK** — `costModel.ts` · `CostContext` · çarpan motoru repoda hiç yok | `grep costModel\|CostContext` → 0 sonuç |
| Onboard yönlendirici | A* var, **maliyet yok**: arama ham metre (`newG = curG + costM`) üzerinden | `NavigationCompute.worker.ts:213-214` |
| Yol sınıfı hızı | yalnız **süre TAHMİNİNDE** kullanılır, aramada DEĞİL | `NavigationCompute.worker.ts:246-263` |
| `RouteRationale` (v2 §5.5, **ZORUNLU**) | **YOK** | `grep RouteRationale` → 0 sonuç |
| Aday seçimi | **VAR ve çalışıyor**: `alternatives=3` istenir, hepsi doğrulanır, biri AKTİF ROTA olur | `routingService.ts:1105-1135` |
| Seçim anahtarı | `[failCount, warnCount, durationS]` sözlükbilimsel | `routeValidationModel.ts:288-310` |
| Seçimin kaydı | **YOK** — yalnız `picked.index !== 0` iken bir `console.warn` | `routingService.ts:1131` |

### F7 öncesi bulunan gerçek kusur

**Sistem sürücü adına bir takas yapıyor ve gerekçesi hiçbir yerde yok.**

Sıralama anahtarında **süre ÜÇÜNCÜ ölçüttür**: bir uyarısı daha az olan aday,
*yirmi dakika daha yavaş olsa bile* kazanır. Bu takas bugün ölçülmüyor,
kaydedilmiyor, LAB'da görünmüyor. v2 §5.5'in ifadesiyle: *"Cevabı olmayan zekâ,
kullanıcı için arızadır."*

Bu, bu deponun daha önce bir kez kapattığı kusur sınıfının aynısıdır
(`offRouteModel.ts:22-51` — "sistem, üzerine HAREKET EDEMEYECEĞİ bir karar
üretiyor, kütüğe yazıyor ve susuyordu").

---

## F7.1 KAPSAM SINIRI (bağlayıcı)

**F7 begins at:** `pickBestRoute` uzak sağlayıcının ≤4 doğrulanmış adayından
birini aktif rota yaptığı an — bugün yapısal hiçbir iz bırakmayan karar.

**F7 ends when:** kabul edilen her rota, makine-okur bir `RouteRationale`
taşır (adaylar · seçilen · belirleyici etken · **süre takası**), bu gerekçe
CAROS LAB'da **salt-okunur** görünür, ve kilitler gerekçenin **kararı yeniden
üretmediğini** ve **uydurmadığını** kanıtlar.

**Explicitly outside F7:**
maliyet modeli / `CostContext` / araç-farkında çarpanlar · hiyerarşik A* · CCH ·
yerel daemon'ın kaldırılması (ADR-N02) · sağlayıcı arbitraj sırasının
değiştirilmesi · reroute FSM davranışının değiştirilmesi · CEH cutover ·
Guardian otoritesinin taşınması · hız limiti · viraj · eğim · şerit ·
`guardianAlertRanker.validUntil` · eşik kalibrasyonu · UI/gösterim · harita
formatı · L8 tahmin/gözlem döngüsü.

### Neden maliyet modeli F7'de DEĞİL (gerekçeli ret)

v2 §5.2'nin maliyet modeli L4'ün kanonik omurgasıdır ve **kurulması teknik
olarak mümkündü**. Kapsam dışı bırakıldı çünkü:

1. **Tüketicisi yok.** A* bugün ham metre üzerinden arıyor. Maliyet modelini
   bağlamak **rota çıktısını değiştirir** — araç yokken doğrulanamaz bir ürün
   davranışı değişikliği olurdu (FIELD FIREWALL).
2. **Bağlamadan eklemek ölü kod olurdu.** Bu deponun kendi disiplini bunu
   reddediyor: F5, çok adımlı ağ mesafesini tam bu gerekçeyle ERTELEMİŞTİ
   (§F4.9/E5 — *"tüketici senaryosu yok, bütçesiz/kanıtsız özellik ekleme
   yasak"*).
3. **Çarpanların kanıt kaynağı yok.** `m_traffic` · `m_thermal` · `m_brake` ·
   `m_pref_hw` için `OBSERVED` kanıt üreten bir kaynak bu binary'de yoktur;
   v2 §5.2 zaten *"ilgili kanıt `UNAVAILABLE` ise çarpan 1.0"* der — yani bugün
   kurulacak model **her çarpanı 1.0** yapardı ve hiçbir şeyi değiştirmezdi.

`RouteRationale` ise **bugün gerçekten var olan bir kararı** açıklar; sözleşmesi
maliyet motoru geldiğinde genişler (etken sözlüğü büyür), yeniden yazılmaz.

---

## F7.2 SIRALAMA ANAHTARI TEK OTORİTEYE ÇIKARILDI

`routeValidationModel.routeRankKey(candidate, validation) → [fail, warn, durationS]`

Seçimi **YAPAN** (`pickBestRoute`) ile seçimi **AÇIKLAYAN**
(`routeRationaleModel`) aynı anahtarı okumak zorundadır. İki kopya olsaydı biri
değiştiğinde diğeri sessizce **yanlış gerekçe** üretirdi — açıklama, gerçeğin
ikinci bir otoritesine dönüşürdü. `pickBestRoute` davranışı **DEĞİŞMEDİ**
(anahtar birebir aynı; `navigationCoreModels.test.ts` mevcut kilitleriyle
doğrulandı).

---

## F7.3 GEREKÇE MODELİ — `navigation/core/routeRationaleModel.ts`

**Etken sözlüğü GERÇEK karar fonksiyonundan türetildi**, v2 §5.5'in araç-maliyet
sözlüğünden (`VEHICLE_THERMAL` · `VEHICLE_RANGE` · `DRIVER_PREF`) DEĞİL — o
değerler çarpan motoru gerektirir ve **kaynağı olmayan etken uydurulmaz**:

| Etken | Anlamı |
|-------|--------|
| `ONLY_OPTION` | kabul edilen tek aday — takas YAPILMADI |
| `VALIDATION_FAIL` | daha az ağır kusur belirledi |
| `VALIDATION_WARN` | kusur eşit, daha az uyarı belirledi |
| `DURATION` | kusur+uyarı eşit, daha kısa süre belirledi |
| `TIE_PROVIDER_ORDER` | üçü de eşit → sağlayıcı sırası (tercih DEĞİL) |
| `USER_SELECTED` | aktif rotayı **kullanıcı** seçti — sistem kararı değil |
| `NO_CANDIDATE` | hiçbir aday kabul edilmedi (rota YOK) |
| `UNKNOWN` | seçim anahtarla **açıklanamadı** — bir kusur bildirimi |

**F7'nin asıl sayısı — `durationPenaltyS`:** seçilen rota, KABUL EDİLEN en hızlı
adaydan kaç saniye daha uzun sürüyor. `0` = takas yok. Ölçülemezse `null`
(**sahte 0 yok**). Bu sayı olmadan *"doğrulama kapısı sürücüye ne ödetti?"*
sorusu cevaplanamaz.

**AÇIKLAYICI KARAR VERMEZ (pazarlıksız):**
- Rotayı `pickBestRoute` seçer ve öyle KALIR; buradan hiçbir değer karara
  geri BESLENMEZ.
- Seçim, anahtarın ima ettiğiyle çelişiyorsa hüküm **`UNKNOWN`**tır —
  uydurma açıklama üretilmez (fail-closed). Karar fonksiyonu değişip
  açıklayıcı ona bağlanmazsa bu, **sessiz yalan yerine görünür bir arıza**
  olarak çıkar.
- Reddedilmiş bir aday "seçilmiş" gösterilirse yine `UNKNOWN`.

**GİZLİLİK:** gerekçe **hiçbir koordinat/geometri/hedef/adres taşımaz** —
yalnız sayılar ve denetim kimlikleri. Kilitle yapısal olarak denetlenir.

**Defter:** bounded (`ROUTE_RATIONALE_MAX_RECORDS = 8`), `routeProviderLedger`
deseniyle birebir aynı; sayaçlar: toplam karar · sağlayıcının ilk rotasının
kaç kez reddedildiği · en büyük süre takası · etken dağılımı.

---

## F7.4 BAĞLAMA — dört karar noktası, hepsi SALT KAYIT

| Nokta | Kayıt | Not |
|-------|-------|-----|
| Uzak OSRM — seçim yapıldı | `buildRouteRationale(cands, picked.index, 'REMOTE_OSRM')` | tek gerçek seçim noktası |
| Uzak OSRM — tüm adaylar düştü | `buildRouteRationale(cands, null, …)` | "hiçbiri seçilmedi" de bir karardır |
| Yerel daemon | `buildSingleCandidateRationale(…, 'LOCAL_DAEMON')` | alternatif üretmez → `ONLY_OPTION` |
| Çevrimdışı graf | `buildSingleCandidateRationale(…, 'OFFLINE_GRAPH')` | aynı |
| Kullanıcı alternatif seçti | `asUserSelectedRationale(son, index)` | sistem kararı gibi SUNULMAZ |

Tüm kayıtlar `_noteRationale(() => …)` **fail-soft** sarmalayıcısındadır:
gerekçe kaydındaki bir hata rota akışını ASLA düşüremez.

---

## F7.5 CAROS LAB — YENİ EKRAN AÇILMADI

Mevcut **Navigation Core → 6 · Doğrulama** kartı dört satırla genişletildi:
`Neden bu rota` (etken + sağlayıcı + aday) · `Aday havuzu` (kabul/red) ·
`Süre takası` (**DERIVED**; ölçülemezse `ölçülemedi`, sıfırsa `takas yok`) ·
`Karar defteri` (toplam karar · ilk rota reddi · en büyük takas).

Hiç karar kaydedilmemişken satır **`ölçülmedi`** der — sahte "tek seçenek"
üretilmez. LAB **salt-okunur**dur: kaynak katmanı deftere YAZMAZ (kilit R8).

---

## F7.6 EKLENEN KİLİTLER

`navV3RouteRationaleF7.test.ts` — **30 kilit** (5 bölüm):

| Bölüm | Kapsam |
|-------|--------|
| F7.1 | saf açıklayıcı: 8 etkenin her biri · süre takası · sahte 0 yasağı · bozuk girdi · **gizlilik** (yapısal alan taraması) |
| F7.2 | **kararla tutarlılık**: 324 deterministik senaryoda `pickBestRoute` sonucu HİÇ `UNKNOWN` üretmez · anahtar tek kaynak |
| F7.3 | kullanıcı tercihi sistem kararı gibi sunulmaz · önceki gerekçe yoksa uydurma liste yok |
| F7.4 | bounded defter · ilk-rota-reddi sayacı · en büyük takas · sözlük ↔ etiket birebir |
| F7.5 | **R1–R8** mimari kilitler |

| Kilit | Ne korur |
|-------|----------|
| R1 | gerekçe modeli SAF (I/O · timer · saat · React · ağ yok) |
| R2 | `routeRankKey` TEK tanımlı; gerekçe kendi anahtarını KURMAZ |
| R3 | gerekçe üretim kararına GERİ BESLENMEZ (yalnız `_noteRationale` içinde; hiçbir `if` koşulunda okunmaz) |
| R4 | gerekçe için yeni timer/abonelik YOK |
| R5 | koordinat/hedef/adres gerekçeye SIZMAZ |
| R6 | LAB yeni EKRAN açmadı — alanlar mevcut Doğrulama kartında |
| R7 | üretim otoritesi DEĞİŞMEDİ: seçici hâlâ `pickBestRoute` |
| R8 | LAB salt-okunur — defteri kirletmez |

**Kilidin kör olmadığının kanıtı:** F7.2'deki 324 senaryonun hepsi gerçekten
üretilir; küme hem gerçek seçim (>200) hem "hiç aday kalmadı" hâlini içerir
(`failCount = 3` → `REJECTED`). Boş küme üzerinden "geçen" bir iddia yoktur.

---

## F7.7 KORUNAN ÜRETİM OTORİTELERİ

| Karar | Sahibi (F7 sonrası — DEĞİŞMEDİ) |
|-------|--------------------------------|
| Aday seçimi | `routeValidationModel.pickBestRoute` |
| Sağlayıcı merdiveni | `routingService` (yerel daemon **KALDIRILMADI**) |
| Rota doğrulama hükmü | `routeValidationModel.validateRoute` |
| Sapma/reroute | `offRouteModel` + `routingService` |
| Denetim uyarısı | **LEGACY** `guardianRuntime` (CEH hâlâ SHADOW) |
| Cutover kapısı | **KAPALI** (`CEH_CUTOVER_DEFAULT_OPEN === false`) |

---

## F7.8 KALAN BİLİNÇLİ BORÇLAR

| # | Borç | Neden F7'de kapanmadı | Ne zaman |
|---|------|------------------------|----------|
| G1 | Maliyet modeli / `CostContext` / araç-farkında çarpanlar | tüketicisi yok + rota çıktısını değiştirir (saha) | F8 (saha sonrası) |
| G2 | Hiyerarşik A* / CCH | v2 §12/F6: **tetikleyici eşikle** açılır (`p95 > 3 s` ölçülürse) — ölçüm saha işi | tetikleyici |
| G3 | Yerel daemon kaldırma (ADR-N02) | FIELD FIREWALL: legacy sağlayıcı kaldırma yasak | saha sonrası |
| G4 | v2 §5.3 "çevrimiçi sonuç aktif rotayı sessizce değiştiremez" kapısı | bugün otomatik değiştirme YOK gibi görünüyor ama **kanıtlanmadı**; kapsam dışı tutuldu | F8 (önce ölçüm) |
| G5 | v2 §5.4 kapsam/ego-mod reroute kapıları | v2'deki `OFF_NETWORK` **harita ağı**, repodaki **aktif rota koridoru** — semantik farklı; körlemesine uygulamak yanlış olurdu | F8 (önce semantik hizalama) |
| G6 | `guardianAlertRanker.validUntil` (F5/F4 borcu) | parite kanıtı yok; L6 işi | F8+ |
| G7 | Bu belgeye **F5 bölümü yazılmadı** (F6'dan devrediyor) | ayrı belge turu | ayrı |
| G8 | F1–F4 borçları (B1·B3·B5·B6·B8·C4·C5·E3·E6) | devrediyor | F8+ |

---

## F7.9 F7 ÇIKIŞ DURUMU

| Ölçüt | Durum |
|-------|-------|
| Her kabul edilen rota gerekçe taşıyor | ✅ dört karar noktası bağlı |
| Süre takası ölçülüyor | ✅ `durationPenaltyS` (sahte 0 yok) |
| Gerekçe kararı yeniden ÜRETMİYOR | ✅ R3 + `UNKNOWN` fail-closed |
| Sıralama anahtarı tek otorite | ✅ R2 |
| Kullanıcı tercihi ayrı işaretleniyor | ✅ `USER_SELECTED` |
| Gizlilik (koordinat/hedef sızmıyor) | ✅ R5 + yapısal alan taraması |
| Gözlem yüzeyi (LAB) | ✅ kart 6 genişletildi — **yeni ekran AÇILMADI** |
| Üretim otoritesi değişti mi | ✅ **hayır** (R7 · rota davranışı aynı) |
| **Saha doğrulaması** | 🔴 **YOK** — kütük #1269–#1272 |

**Doğrulama (2026-09-04):** `tsc -b --force` PASS · değişen 7 dosyada lint PASS ·
nav F0–F7 **456 PASS** · LAB/rota/oturum/Guardian paketleri **276 PASS** ·
regresyon kasası **981 PASS**. Full suite · production build · native build
**KOŞULMADI**.

**Hüküm: `F7 CODE PASS` — `IMPLEMENTATION COMPLETE / QA REQUIRED`.**
**`F7 FIELD = NOT EXECUTED`** — araç yoktu; hiçbir saha maddesi 🟢 yapılmadı.

### F8'e gerçek blocker

1. **F4/F5/F6 saha kampanyası (#1232–#1268)** — hâlâ tek gerçek blocker.
   CEH cutover, maliyet modeli bağlama ve daemon kaldırma bunun ARDINDAN gelir.
2. **G4/G5 önce ÖLÇÜLMELİ:** v2 §5.3/§5.4 kapıları repoya körlemesine
   uygulanamaz — `OFF_NETWORK` semantiği v2 ile repoda AYNI DEĞİL. Önce
   semantik hizalama kanıtı, sonra kapı.
3. **G2 tetikleyicisi ölçülmedi:** hiyerarşik yönlendirici ancak onboard rota
   `p95 > 3 s` **gerçek cihazda** ölçülürse açılır (v2 §12/F6).

---

# F8 — SAHA ÖLÇÜM HAZIRLIĞI: ENSTRÜMANTASYON + REPLAY KANIT PAKETİ

> **F8 bir ürün davranışı fazı DEĞİLDİR.** Amaç: *"Araç geldiğinde F4–F7
> zincirini tek sürüşte, sonradan tekrar analiz edilebilir ve kanıtlanabilir
> şekilde ölçebilecek canonical saha telemetry/replay paketini hazır
> etmek."* Hiçbir routing/CEH/Guardian kararı bu fazda DEĞİŞMEDİ.

---

## F8.0 ÖLÇÜLMÜŞ GERÇEK — MEVCUT ÖLÇÜM OTORİTESİ (kod okundu, ikinci framework kurulmadı)

Repoda navigasyon için **ZATEN** bir saha ölçüm hattı vardı — F8 onu KAPATTI,
YENİDEN İCAT ETMEDİ:

| Katman | Dosya:satır | Ne yapıyordu |
|--------|-------------|--------------|
| Salt-okunur köprü | `platform/devtools/navFieldBridge.ts` (211 satır, F8 öncesi) | mevcut senkron getter'ları `window.__CAROS_NAV_FIELD__`e açar |
| Dış örnekleyici | `scripts/nav-field-record.mjs` | CDP over adb, 1 Hz, JSONL'e yazar — **kendi zamanlayıcısı budur (host'ta, uygulama İÇİNDE değil)** |
| Analiz | `scripts/nav-field-analyze.mjs` | JSONL'den P0-1..P0-5 metrikleri çıkarır, `NOT_MEASURED` disiplinini korur |
| Kilit | `regression.guards.test.ts:5284-5391,6342` | salt-okunur · timer yok · dev-kapısı · LAB koordinat sınırı · fail-soft |

**Ölçülen boşluk:** bu hat F0–F2 döneminde yazılmıştı (`match`/`offRoute`/
`route`/`req`/`provider` alanları) ve **F3–F7'nin ürettiği hiçbir teşhis
yüzeyini (CEH · graf sakinliği · sınırlı koridor · denetim eşleştirme ·
gölge karşılaştırma · rota gerekçesi · sıcak-yol maliyeti) İÇERMİYORDU.**
Bu altı yüzey ZATEN salt-okunur getter olarak vardı (`cehAuthority.
getDiagnostics()` · `getGraphResidencySnapshot()` · `getEnforcementHorizon
PortSnapshot()` · `getCehShadowSnapshot()` · `getRouteRationaleLedger()` ·
`getNavTickCostSnapshot()`) — F8 bunları TEK zaman eksenine TAŞIDI, yeni
ölçüm otoritesi KURMADI.

**İncelenip REDDEDİLEN alternatif:** `platform/fieldValidation/longRoad*`
(6 154 satır, OBD/araç-sağlığı alanının **kendi** `setInterval`li black-box
sistemi). Navigasyon için yeniden kullanmak ya yabancı bir alanın özel
zamanlayıcısını/deposunu ithal etmek ya da navigasyona İKİNCİ bir zamanlayıcı
kurmak olurdu — ikisi de CLAUDE.md §CROSS-DOMAIN 8/15 ihlali. Tasarım DESENİ
(sınırlı halka, "dropped" dürüstlüğü) esinlenildi; kod PAYLAŞILMADI.

---

## F8.1 KAPSAM SINIRI (bağlayıcı)

**F8 begins at:** F4–F7 otoritelerinin ZATEN ürettiği, ama bugüne kadar TEK
BİR zaman ekseninde birlikte görülemeyen salt-okunur teşhis yüzeyleri.

**F8 ends when:** aynı monotonik zaman ekseninde, sınırlı, dışa aktarılabilir,
replay edilebilir bir `NavigationFieldTrace` gerçek saha kanıtını taşıyabilir
durumdadır — kayıt açık/kapalıyken ürün hükümleri birebir AYNI kalır.

**Explicitly outside F8:** routing davranışı değişikliği · maliyet modeli ·
CEH cutover · Guardian taşıma · eşik kalibrasyonu · yeni harita formatı · UI
yeniden tasarım · gerçek FIELD PASS.

---

## F8.2 CANONICAL `NavigationFieldTrace` — TEK ŞEMA

`FIELD_TRACE_SCHEMA = 'caros.nav.fieldtrace.v1'` — TEK tanımlı (kilit T11).

`NavFieldSample` (mevcut alanlar DEĞİŞMEDEN) **yedi yeni bölümle** genişledi;
her biri `_safe(() => …, null)` ile SARILI — bir bölümün getter'ı patlarsa
yalnız O bölüm `null` olur, örnek ÇÖKMEZ (kilit T6):

| Bölüm | Kaynak (salt-okunur, ZATEN vardı) | Alanlar |
|-------|-----------------------------------|---------|
| `ceh` | `cehAuthority.getDiagnostics()` | state · generation · ambiguous · physicallyConfirmed · mppPresent · pathCount · objectCount · horizonAgeMs · mapAvailable · boundDomains · errorCount |
| `graph` | `getGraphResidencySnapshot()` | state · holders · loadCount · nodeCount · edgeCount · version · parseMs · adjacencyBuilt |
| `roadCorridor` | `getEnforcementHorizonPortSnapshot()` | calls · lastOutcome · lastCorridorOutcome · lastCorridorEdgeCount · lastCorridorNodeExpansions · **lastCorridorTruncated** · lastCandidateCount · lastObjectCount · lastDurationMs |
| `enforcement` | aynı kaynak, `cumulativeMatch` | matchedToEdge · ambiguousEdge · noEdgeMatch · outsideCoverage · notMeasured · onewayImplied · unknownDirection · lastOutcome |
| `shadow` | `getCehShadowSnapshot()` | active · ticks · errorCount · comparable · divergent · divergenceRatio · cutoverState · cutoverUnmet · guardianWouldEmitCount · sideEffectCount |
| `rationale` | `getRouteRationaleLedger()` | decisions · overrodeProviderFirst · maxDurationPenaltyS · lastFactor · lastChosenIdx · lastDurationPenaltyS · lastAcceptedCount |
| `perf` | `getNavTickCostSnapshot()` | mapMatch p50/p95/max · progressTick p50/p95/max |

**Uyum:** `readonly EdgeId` gibi ham kimlikler HİÇBİR bölümde YOKTUR (F6 K6/
G6 kilidiyle AYNI sınır — `enforcementHorizonPort` snapshot'ı zaten koordinat/
ham-kimlik TAŞIMIYORDU, F8 bunu miras aldı).

---

## F8.3 SAMPLE / EVENT AYRIMI — YENİ ZAMANLAYICI YOK

**Sample:** mevcut `sample()` çıktısının TAMAMI, dış CDP koşumunun HER
çağrısında (hâlâ 1 Hz, hâlâ host'ta).

**Event:** `deriveFieldEvents(sample, prev, atSampleIndex)` — SAF, iki ardışık
örneği KARŞILAŞTIRIR (diff), modül-içi tek bir `_prevClass` nesnesiyle. Dokuz
tür (`NAV_FIELD_EVENT_KINDS`), hepsi GEÇİŞ-tabanlı (aynı durumda kalmak
TEKRAR üretmez — kilit F8.1'de 9/9 tür için doğrulandı):

`MATCH_STATE_CHANGED · CEH_STATE_CHANGED · CORRIDOR_TRUNCATED ·
ENFORCEMENT_ACQUIRED · ENFORCEMENT_LOST · SHADOW_DIVERGENCE ·
ROUTE_SELECTED · RATIONALE_UNKNOWN · GRAPH_RESIDENCY_CHANGED`

`RATIONALE_UNKNOWN` özel önemde: F7'nin *"açıklanamadı"* hükmüne GEÇİŞTE bir
kez tetiklenir — #1271'in kabul ölçütü (*sahada hiç görülmemeli*) doğrudan bu
olayın sayısıyla ölçülür.

**"İkinci zamanlayıcı yok" NASIL sağlandı:** `installNavFieldBridge`'in
döndürdüğü `sample` fonksiyonu artık şunu yapar: `_sample()` çağır → sonucu
DÖNDÜR (davranış AYNI) → kayıt açıksa aynı sonucu `_pushToTrace`e YAZ.
Örnekleme kadansı hâlâ dış CDP koşumunundur; app İÇİNDE `setInterval` YOKTUR
(kilit T1).

---

## F8.4 SINIRLI KAYIT — TAŞMA AÇIKÇA İŞARETLİ

| Sabit | Değer | Gerekçe |
|-------|-------|---------|
| `FIELD_TRACE_MAX_SAMPLES` | 3 600 | 1 Hz × 60 dk — tipik sürüş-günü penceresi |
| `FIELD_TRACE_MAX_EVENTS` | 512 | geçişler örneklerden çok daha seyrek |

**Politika (kasıtlı, gerekçeli):** tavan dolunca YENİ girdi REDDEDİLİR
(`overflowSamples++`/`overflowEvents++`), EN ESKİ veri KORUNUR. Bir hata
senaryosunun BAŞLANGICI genelde en değerli kısımdır; halka-tampon gibi eskiyi
sessizce ezmek bunu kaybettirirdi. `getFieldRecordingStatus()` ve
`exportFieldTrace()` **aynı** `overflow` nesnesini taşır (iki ayrı otorite
YOK) — taşma DAİMA `TRACE_TRUNCATED` anlamına gelen `samplesTruncated`/
`eventsTruncated` bayraklarıyla görünür, asla sessiz değil (kilit T4).

**Elle başlar, elle durur:** `startFieldRecording()`/`stopFieldRecording()`
DIŞARIDAN çağrılır; `installNavFieldBridge()` otomatik BAŞLATMAZ.

---

## F8.5 GİZLİLİK — VARSAYILAN EXPORT KOORDİNAT TAŞIMAZ

`startFieldRecording({ fieldDebug: true })` **açıkça** istenmedikçe
`exportFieldTrace()` çıktısında `veh.lat/lon` ve `match.snappedLat/snappedLon`
`null`e REDAKTE edilir (`coordinatesRedacted: true` alanı bunu BEYAN eder —
gizlilik bir varsayım değil, dosyanın kendisinde yazılı bir gerçektir).
Kayıt İÇİ hafızada koordinat durur (mevcut `navFieldBridge` sözleşmesiyle
AYNI — saha doğruluğu koordinatsız ölçülemez); yalnız **dışa aktarım**
budanır. Kullanıcı adı · telefon · VIN · API anahtarı · token · ses
transkripti hiçbir bölümde YAPISAL olarak YOKTUR (kilit: gizlilik alan
taraması, F8.4 test bölümü).

`provenance` bloğu şema sürümü · uygulama sürümü (`VITE_APP_VERSION`) · git
revizyonu (`VITE_GIT_REVISION` — `longRoadSources.ts` ile AYNI okuma deseni)
· kişisel OLMAYAN rastgele `sessionId` taşır; okunamayan alan `null`dır
(uydurulmaz).

---

## F8.6 REPLAY — `navFieldTraceReplay.ts` (SAF, ikinci runtime DEĞİL)

Saha kaydını F3–F7'nin **zaten kodda var olan** beş sözleşmesine karşı
DENETLER — GPS/Guardian/native sağlayıcı TAKLİT ETMEZ, yalnız kaydedilmiş
sayıları okur:

| İlke | Kaynak (dosya:satır atıflı, kodda) | Denetim |
|------|--------------------------------------|---------|
| `AMBIGUOUS_NOT_DEFINITE` | `horizonModel.ts` §conflict: `mppPathId = null` | `ceh.state==='AMBIGUOUS_PATH' ⟹ mppPresent===false` |
| `TRUNCATED_CORRIDOR_NOT_ABSENT` | F6 düzeltmesi (`enforcementHorizonPort.ts`) | `roadCorridor.lastCorridorTruncated===true` iken `lastOutcome !== 'NO_OBJECTS_IN_RANGE'` |
| `NOT_MEASURED_NOT_AGREEMENT` | `cehShadowModel.ts` | `shadow.divergent ≤ shadow.comparable`; oran sayaçla TUTARLI |
| `WRONG_DIRECTION_NOT_DEFINITE` | `enforcementEdgeIndex.ts` (ONEWAY_IMPLIED xor UNKNOWN_DIRECTION) | `matchedToEdge === onewayImplied + unknownDirection` |
| `RATIONALE_MATCHES_SELECTION` | `routeRationaleModel.ts` (F7) | `NO_CANDIDATE ⟺ chosenIdx===null`; belirlenmiş etken ⟹ seçim VAR |

**Kör olmadığının kanıtı:** her ilke için hem TEMİZ hem İHLALLİ fixture
test edilir (`navV3FieldTraceF8.test.ts` §F8.5, 12 kilit).

**Akış:** saha kaydı `exportTrace()` ile alınır → `replayFieldTrace(trace)`
(host, vitest) çağrılır → ihlal çıkarsa TAM örnek indeksi bilinir → sentetik
fixture'a çevrilip mevcut `navV3*.test.ts` desenlerine EKLENİR. Bu, "saha
bug'ını host testine çevirme" mekanizmasının ta kendisidir.

---

## F8.7 CLI ENTEGRASYONU — TEK KOMUT, İKİ ÇIKTI

`nav-field-record.mjs` **DEĞİŞMEDEN** çalışmaya devam eder (JSONL akışı,
mevcut davranış); köprü `version >= 2` ise EK olarak:

1. Koşum başında `startRecording({ label })` çağrılır (fail-soft — köprü
   desteklemiyorsa sessizce atlanır, JSONL akışı ETKİLENMEZ).
2. Koşum sonunda `stopRecording()` + `exportTrace()` çağrılır, sonuç
   `<label>-<zaman>.trace.json` dosyasına yazılır.

`nav-field-analyze.mjs` **DEĞİŞMEDEN** P0-1..P0-5 metriklerini basar; EK
olarak yeni bir "F3–F7 KANIT ÖZETİ" bölümü basar (yalnız GÖZLEM — eşik/PASS
İCAT ETMEZ; ilke denetimi `replayFieldTrace`e YÖNLENDİRİR, İKİNCİ kural
motoru KURMAZ).

**Doğrulandı (host, 2026-09-04):** hem F8-alanlı hem F8-öncesi (eski) JSONL
kayıtları `nav-field-analyze.mjs`den hatasız geçti; eski kayıtta yeni bölüm
dürüstçe `NOT_MEASURED` yazdı (geriye dönük uyum, kilitsiz ama elle
doğrulandı — bkz. F8.11).

---

## F8.8 LAB ENTEGRASYONU — BİLİNÇLİ OLARAK GÖRSEL LAB DEĞİL

Mevcut kilit (`regression.guards.test.ts` "LAB EKRANI koordinat sözleşmesini
KORUR") `navigationCoreSources.ts`nin `navFieldBridge` İÇERMESİNİ ve
`NavigationCoreScreen.tsx`nin `__CAROS_NAV_FIELD__` REFERANS VERMESİNİ
**pazarlıksız yasaklar** — çünkü köprü ham koordinat taşır, LAB taşımaz.

F8 görevinin kendi kaçış maddesini kullandı: *"eğer LAB'dan kontrol uygun
değilse canonical mevcut debug/export yolunu kullan."* Kontrol yüzeyi
**`window.__CAROS_NAV_FIELD__`** (zaten var olan kanal) — `startRecording`/
`stopRecording`/`recordingStatus`/`exportTrace` metotlarıyla. Bu, ikinci bir
kontrol yüzeyi İCAT ETMEK DEĞİL, MEVCUT tek kanalı genişletmektir (kilit T9).

---

## F8.9 KORUNAN ÜRETİM OTORİTELERİ (F8 hiçbirini değiştirmedi)

| Karar | Sahibi | F8 etkisi |
|-------|--------|-----------|
| CEH üretim otoritesi | **SHADOW** (`CEH_CUTOVER_DEFAULT_OPEN=false`) | dokunulmadı (kilit T10) |
| Denetim uyarısı | **LEGACY** `guardianRuntime` | dokunulmadı |
| Rota seçimi | `pickBestRoute` | dokunulmadı |
| Ego/eşleştirme | `mapMatchModel`/`egoAuthority` | dokunulmadı |
| Sıcak-yol ölçümü | `navTickCostModel` (P0-NAV-19) | F8 yalnız OKUR, ikinci ölçüm otoritesi KURMADI |

**Kayıt açık/kapalıyken davranış birebir aynı:** `_pushToTrace` yalnız
BİRİKTİRİR; hiçbir navigasyon/CEH/Guardian fonksiyonunu ÇAĞIRMAZ (kilit T2 —
`fetchRoute`/`bindAttributePorts`/`observe()`/… kaynak taramasıyla YASAK).

---

## F8.10 #1232–#1272 KANIT HARİTASI (F8 hiçbirini PASS YAPMAZ)

> Bu tablo *"hangi trace alanı/olayı kanıt sağlar · tek trace yeterli mi ·
> fiziksel gözlem de gerekir mi"* sorusuna cevaptır — hüküm DEĞİLDİR.

| Madde grubu | Sağlanan trace kanıtı | Tek trace yeterli mi | Fiziksel gözlem AYRICA gerekir mi |
|---|---|---|---|
| **F4/1–2** RTG2 okuyucu · routing paritesi | `graph.{nodeCount,edgeCount,version,parseMs}` | kısmen (rota geometrisi trace'de YOK — E4 borcu) | ✅ EVET — gerçek rota sonucu görsel/manuel karşılaştırma ister |
| **F4/3–5** graf sakinliği · kenar metadatası · topoloji | `graph.{state,holders,loadCount,adjacencyBuilt}` | ✅ EVET | hayır |
| **F4/6** aday üretimi / yarıçap kapısı | `match.{state,confidence,reasons}` (mevcut, F8 öncesi) | ✅ EVET | hayır |
| **F4/7** ara poliline yok (dürüstlük sınırı) | — | uygulanamaz | uygulanamaz (bilinen format sınırı, ölçülecek DAVRANIŞ yok) |
| **F4/8–9** canlı `MatchedRoadPose` · CEH fiziksel doğrulama | `ceh.physicallyConfirmed` + `match.state` | ✅ EVET | hayır |
| **F4/10** bozuk graf fail-closed | `graph.state==='CORRUPT'`/`'MISSING'` GEÇİŞİ | ✅ EVET (ama tetiklemek için BOZUK artefakt SAHNELENMELİ) | ✅ EVET — kasıtlı bozuk dosya testi saha DIŞI hazırlık ister |
| **F4/11** yakınlık/bellek kalibrasyonu | `perf.*`, `roadCorridor.lastDurationMs` | ✅ EVET (ham veri) | ✅ EVET — KARAR (eşik) insan analizi ister, trace yalnız GİRDİ verir |
| **F4/12** kod kapanışı ≠ saha hükmü | — | uygulanamaz | uygulanamaz (bu madde bir SÜREÇ beyanıdır) |
| **F5/1–2** gölge canlı · sunum yok | `shadow.{active,ticks,sideEffectCount}` | ✅ EVET | hayır (`sideEffectCount` yapısal 0 — kod kanıtı zaten yeterli, trace TEYİT eder) |
| **F5/3** manevra gölge farkı | `shadow.{comparable,divergent,divergenceRatio}` | ✅ EVET | hayır |
| **F5/4** denetim gölgesi "yalnız legacy" | `enforcement.*` + Guardian log KARŞILAŞTIRMASI | kısmen | ✅ EVET — legacy Guardian'ın KENDİ gözlemi trace'de YOK, ayrı okunmalı |
| **F5/5** Guardian otoritesi değişmedi | kod taraması (statik) | uygulanamaz | hayır — bu zaten kilitle kanıtlı, saha DOĞRULAMASI gerektirmez (yalnız ledger kaydı) |
| **F5/6** cutover kapalı görünmeli | `shadow.cutoverState==='CLOSED'` | ✅ EVET | hayır |
| **F5/7–8** "ölçülmedi"≠"yok" · belirsizlik kesin iddia üretmez | `RATIONALE_UNKNOWN`/`shadow` alanları + replay ①③ | ✅ EVET (replay ile) | hayır |
| **F6/1** bounded koridor çalışıyor | `roadCorridor.*` | ✅ EVET | hayır |
| **F6/2** kesilme oranı / tavan kalibrasyonu | `CORRIDOR_TRUNCATED` olay sayısı / toplam örnek | ✅ EVET (ham veri) | ✅ EVET — tavan DEĞİŞTİRME kararı insan analizi ister |
| **F6/3–4** kesik koridor / boş liste kusurları | replay ② (`TRUNCATED_CORRIDOR_NOT_ABSENT`) | ✅ EVET | hayır — replay TAM budur |
| **F6/5** eşleştirme dağılımı | `enforcement.*` (kümülatif) | ✅ EVET | hayır |
| **F6/6** yanlış carriageway (GÜVENLİK KRİTİK) | `enforcement.ambiguousEdge` + replay ④ | kısmen | ✅ EVET — **F8 sınır maddesi ile PAZARLIKSIZ**: bölünmüş yolda GERÇEK sürüş, iki carriageway'in FİZİKSEL olarak ayrı olduğunun insan GÖZLEMİYLE teyidi gerekir; telemetri TEK BAŞINA bu maddeyi ASLA PASS yapamaz |
| **F6/7** yol-boyu ≠ kuş uçuşu | `roadCorridor` mesafesi vs Guardian `CONE_RADIUS` KARŞILAŞTIRMASI | kısmen | ✅ EVET — legacy tarafın kendi mesafesi trace'de YOK |
| **F6/8** sıcak-yol CPU/bellek (cihaz) | `perf.*`, `roadCorridor.lastDurationMs` | ✅ EVET (ham veri) | ✅ EVET — "kabul edilebilir mi" kararı cihaz TERMAL/DeviceTier bağlamı ister |
| **F7/1** gerekçe kayıtlı | `rationale.*` | ✅ EVET | hayır |
| **F7/2** doğrulama kapısının ödettiği süre | `rationale.maxDurationPenaltyS` + `ROUTE_SELECTED` olayları | ✅ EVET (ham veri) | ✅ EVET — "kabul edilebilir mi" KALİBRASYON kararı |
| **F7/3** "açıklanamadı" sahada görülmemeli | `RATIONALE_UNKNOWN` olay SAYISI (hedef: 0) | ✅ EVET | hayır |
| **F7/4** kullanıcı tercihi ayrı işaretli | `rationale.lastFactor==='USER_SELECTED'` | ✅ EVET | hayır |

**Genel kural (F8 görev maddesi 10'un uyguladığı):** trace, *"veri neydi"*
sorusunu cevaplar; *"bu kabul edilebilir mi"* KALİBRASYON kararını ASLA
otomatik vermez — özellikle **#1266** (yanlış carriageway) gibi güvenlik
kritik maddelerde telemetri TEK BAŞINA hiçbir zaman yeterli kanıt SAYILMAZ.

---

## F8.11 EKLENEN MİMARİ KİLİTLER

`navV3FieldTraceF8.test.ts` — **41 kilit** (6 bölüm): F8.1 olay türetimi (9
tür + fail-soft + sözlük tamlığı) · F8.2 sınırlı kayıt · F8.3 taşma · F8.4
gizlilik · F8.5 replay (5 ilke × temiz+ihlalli + boş/eksik) · F8.6 **T1–T12**
mimari kilitler (yeni zamanlayıcı yok · üretim komutu çağrılmaz · saf
türetim · bounded · redaksiyon · fail-soft · dev-kapısı · ikinci runtime yok
· LAB sınırı · üretim otoritesi değişmedi · tek şema · ilkeler kaynak atıflı).

Mevcut köprü kilitleri (`regression.guards.test.ts`, 981 test) **DEĞİŞMEDEN**
yeşil kaldı — F8 onları BOZMADI, üzerine EKLEDİ.

`nav-field-record.mjs`/`nav-field-analyze.mjs` değişiklikleri host'ta
`node --check` ile sözdizimi doğrulandı ve sentetik JSONL kayıtlarıyla
(F8-alanlı + F8-öncesi) UÇTAN UCA çalıştırılıp doğrulandı — bu araçlar
`vitest` kapsamına GİRMEZ (host CLI script'i), bu yüzden ayrı bir kilit
YOKTUR; **açık borç** olarak F8.13'te kayıtlıdır.

---

## F8.12 F8 ÇIKIŞ DURUMU

| Ölçüt | Durum |
|-------|-------|
| Bounded, provenance taşıyan trace | ✅ `NavFieldTrace` |
| Sample+event ayrımı | ✅ 9 olay türü, geçiş-tabanlı |
| Taşma açıkça işaretli | ✅ `overflow.*`, sessiz kayıp yok |
| Gizlilik (varsayılan koordinatsız) | ✅ `coordinatesRedacted` |
| Deterministik replay | ✅ 5 ilke, SAF, ikinci runtime değil |
| İkinci zamanlayıcı yok | ✅ dış CDP kadansına piggyback |
| Üretim kararına geri beslenmez | ✅ (T2, T10) |
| LAB sınırı korunuyor | ✅ (T9) — kontrol yüzeyi `__CAROS_NAV_FIELD__` |
| CEH hâlâ SHADOW, Guardian hâlâ PRODUCTION | ✅ (T10) |
| Kayıt açık/kapalı — davranış birebir aynı | ✅ (T2 kaynak taraması) |
| **Saha kaydı** | 🔴 **YOK** — kütük #1273–#1275 |

**Doğrulama (2026-09-04):** `tsc -b --force` PASS · değişen dosyalarda lint
temiz · nav F0–F8 **497 PASS** (F8 dosyası 41 kilit) · regresyon kasası
**981 PASS** (F8 ÖNCESİ köprü kilitleri dâhil, bozulmadı). Full suite ·
production build · native build **KOŞULMADI**.

**Hüküm: `F8 CODE PASS`.**
**`F8 FIELD = NOT EXECUTED`** — araç yoktu; hiçbir gerçek kayıt alınmadı.

### Araç geldiğinde tek komut/akış

```
1) adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>
2) node scripts/nav-field-record.mjs <ETİKET>
   → JSONL (mevcut, değişmedi) + <ETİKET>-<zaman>.trace.json (YENİ, F8)
   Ctrl+C ile durdur.
3) node scripts/nav-field-analyze.mjs <dosya>.jsonl
   → P0-1..P0-5 (mevcut) + F3–F7 kanıt özeti (YENİ, F8)
4) (host) replayFieldTrace(JSON.parse(<dosya>.trace.json))
   → 5 ilkenin SAHA verisinde tutup tutmadığını denetler
```

### F9'a kalan gerçek blocker

1. **Gerçek saha kaydı (#1273–#1275)** — bu üç madde recorder'ın KENDİSİNİN
   cihazda çalıştığını doğrular; onlar 🟢 olmadan #1232–#1272'nin HİÇBİRİ
   bu altyapıyla PASS edilemez.
2. **#1266 (yanlış carriageway)** — F8 sınırı gereği, telemetri TEK BAŞINA
   bu maddeyi ASLA kapatamaz; bölünmüş yolda insan gözlemi ZORUNLU kalır.
3. **E4 borcu (ara poliline)** — trace rota GEOMETRİSİ taşımaz (gizlilik +
   format sınırı); F4/1–2'nin görsel doğrulaması bu yüzden trace'in DIŞINDA
   kalmaya devam eder.
