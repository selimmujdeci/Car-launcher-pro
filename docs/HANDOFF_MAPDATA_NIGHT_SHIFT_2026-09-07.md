# DEVİR — MAP DATA PLATFORM GECE VARDİYASI · 7 Eylül 2026

> **NIGHT SHIFT RESULT:** MAPDATA F0–F6 tamamlandı — Tarsus'ta Overture'ın
> bina tarafında **dedup edilmiş +2290 footprint** (yakın 400×400 m alanda
> **11 → 123**) getirdiği ÖLÇÜLDÜ, yol adı ve adreste kazanç **olmadığı**
> ölçüldü; fail-closed lisans kapısı · çok kaynaklı gözlem sözleşmesi ·
> Overture/OSM bina adaptörleri · deterministik bina fusion MVP · adres/place
> ve canlı-koşul dikişleri · LAB gözlem ekranı uygulandı; üretim davranışında
> **tek** değişiklik karoda zaten var olan kapı numarasının artık çizilmesidir
> (🔴 cihazda doğrulanmadı).

Branch: `feat/fleet-offline-final-local-completion` · başlangıç HEAD `cc42cd87`.

---

## 1. Başlangıç repo authority map (F0 denetimi)

| Soru | Sahibi (değişmedi) |
|---|---|
| Çalışma zamanı statik harita gerçeği | `platform/navigation/map/store` (NAV v3 L1 `MapStore`) |
| Kanıt sınıfı sözlüğü | `navigation/contracts/navEvidence` → `EvidenceGrade` |
| Fiziksel köken maskesi | `navigation/map/store/mapProvenance` → `MapSourceMask` |
| Karo kaynağı seçimi | `mapSourceManager` + `mapSourceStore` |
| Stil / kartografi | `mapStyleBuilders` (tek stil otoritesi, gündüz+gece aynı katman listesi) |
| Etiket/gürültü bütçesi | `map/core/mapDeclutterModel` + `NAV_SUPPRESS_TIERS` |
| Rota | `routingService` · `offlineRoutingService` |
| Arama zinciri hükmü | `geo/searchChainModel` (+ `geocodingService`, `mapService.searchPlaces`, `offlinePoiService`) |
| Runtime bütçe | `core/runtime/AdaptiveRuntimeManager` |

**Bulunan boşluk:** veri ÜRETİM/normalizasyon katmanı yoktu. Lisans, köken,
tazelik ve çok kaynaklı çözüm hiçbir yerde tip olarak temsil edilmiyordu.
`Evidenced<T>` vardı ve YENİDEN İCAT EDİLMEDİ.

---

## 2. Tamamlanan fazlar

| Faz | Ne yapıldı | Commit |
|---|---|---|
| **F0** | `platform/mapdata` sözleşmeleri: kaynak sözlüğü · fail-closed lisans kapısı · gözlem/tazelik/kalite · alan düzeyi canonical çözüm | `6ead8b75` |
| **F1** | Tarsus çok kaynaklı ölçüm (OSM · OpenFreeMap · Overture 2026-08-19.0), dedup edilmiş gerçek artış | `6f93b3bb` |
| **F2** | Overture + OSM bina adaptörleri · kayıt düzeyi lisans kapısı · sınırlı gerçek fixture | `63adbd2f` |
| **F3** | Bina fusion MVP: saf geometri · deterministik kümeleme · metrik mutabakat · uydurma geometri yasağı | `78ed627a` |
| **F4** | `housenumber` stil tüketicisi (**üretim davranışı değişti**) + kütük #1318/#1319 | `3e96a598` |
| **F5/F6** | Adres/place index ve canlı yol koşulu PORT tanımları (sağlayıcı bağlı DEĞİL) | `0d8b0929` |
| **LAB** | CAROS LAB → Araç → Harita Veri Platformu (gözlemlenebilirlik borcu) + kütük #1320 | `4525f748` |

---

## 3. Tarsus ölçüm sonuçları (özet)

Alan: z14/9778/6381, bbox `[34.8486328125, 36.91476428895592, 34.87060546875, 36.93233006150314]`
— önceki denetimle birebir aynı. Detay: `field-runs/mapdata-shootout-20260907/REPORT.md`.

| | OSM | OpenFreeMap (üretim) | Overture | Dedup artış |
|---|---:|---:|---:|---|
| Bina | 340 way | 11 feature / 351 polygon | **2627** | **+2290** |
| Bina (yakın 400×400 m) | 11 | 11 polygon | **123** | **+112** |
| Yol (adlı ayrık) | 138 | 117 ad feature | 527 segment | **+3** (demiryolu/kavşak/tramvay) |
| Adres | 3 | 7 | **0** | **−7** |
| Place/POI | — | 120 | 337 | +217 |

Overture bina kaynak ayrışması: **Microsoft ML Buildings 2290 · OpenStreetMap 337**
(337'sinin tamamı bizim OSM kümemizle eşleşti → çift sayım yok).

Uydu çatı örnekleri: en yakın bina köşesi **111–128 m → 6.3 / 14.7 / 8.0 m**;
30 m çevrede 4–9 Overture binası.

`Kocatepe Caddesi` yalnız OSM'de: adı 4 Eylül'de eklendi, Overture'ın OSM
anlık görüntüsü 2026-08-02 → **Overture güncellik gecikmesini ÇÖZMÜYOR.**

---

## 4. Overture/kamu kaynaklarının gerçek incremental gain'i

- **Bina: YÜKSEK ve kanıtlı.** Cihazda görülen footprint boşluğunun gerçek
  doldurucusu budur. Ama ML footprint **algoritma çıktısıdır**, yer gerçeği
  değildir; adaptör bunları `grade: DERIVED` + `sourceVerified: false` ile
  işaretler. Yükseklik YOKTUR (0/2627) → 3B için kaynak değildir.
- **Yol adı: PRATİKTE SIFIR.** 426 adsız OSM way'i Overture'da da adsız.
- **Adres: NEGATİF.** Overture bu bbox'ta 0 kayıt.
- **Place: VAR ve permissive** (337 kayıt; meta 309 · AllThePlaces 18 ·
  Foursquare 6 · Microsoft 4) — ama arama zinciri ayrı domain, bağlanmadı.
- **TUCBS / belediye:** bu turda **ingest EDİLMEDİ**. Redistribution hakkı
  kanıtlanmadığı için lisans kaydı bilerek `UNKNOWN` bırakıldı ve kapı onları
  offline pakette REDDEDER (fail-closed).

---

## 5. Yeni canonical mimari

```
Kaynak → SourceAdapter (SAF) → LİSANS KAPISI (fail-closed)
      → CandidateMapFeature (gözlemler YAN YANA · üst üste YAZILMAZ)
      → Resolver (alan alan) → CanonicalMapFeature (+ puan dökümü)
```

Bağlayıcı kurallar (kilitli):
- **İkinci harita gerçeği otoritesi YOK** — çalışma zamanı truth `MapStore`ta.
- **İkinci kanıt sistemi YOK** — `EvidenceGrade` yalnız `navEvidence`ten.
- **Sabit öncelik listesi YOK** — dört eksen eşit ağırlıklı (tazelik ·
  mutabakat · kalite · yetki önseli); yetki tek başına karar vermez.
- **Lisans elemedir, puan değildir** — hak yoksa gözlem çözüme girmez.
- **UNKNOWN > uydurma** — çözülemeyen alan gerekçesiyle boş kalır.
- **Uydurma geometri yasak** — canonical geometri daima gerçek bir kayıt.
- **Kayıt düzeyi lisans üstündür** — F1 ölçümü F0 kaydını düzeltti.
- `mapdata/**` **SAF**: I/O · ağ · timer · saat · React yok (kilit tarar).

Dosyalar: `src/platform/mapdata/{mapDataSource,mapDataLicense,mapDataObservation,
mapDataResolution,index}.ts` · `adapters/{adapterContract,overtureBuildingAdapter,
osmBuildingAdapter}.ts` · `resolvers/{buildingGeometry,buildingResolver}.ts` ·
`indexes/addressPlaceIndex.ts` · `live/liveRoadConditions.ts` ·
LAB: `platform/devtools/{mapDataSources,mapDataLabModel}.ts` +
`components/devtools/screens/MapDataPlatformScreen.tsx`.

---

## 6. Üretim davranışında ne değişti

**TEK değişiklik (F4):** `housenumber` kaynak katmanı artık çiziliyor.
- Eşik **z17** (yerel sokak adının 16'sının üstünde).
- Çakışma önceliğinde **en altta** → hiçbir kapı numarası sokak adını elemez.
- Opaklık `mapDeclutterModel` sahipliğinde (gündüz 1.00/nav 0.75 · gece
  0.85/nav 0.60 · **mini 0**).
- `text-field` doğrudan `['get','housenumber']` — türetme/interpolasyon YOK.
- **Kaynak seyrek:** yakın 400×400 m alanda 0 numara var; bazı sahnelerde hiç
  numara görünmemesi DOĞRU davranıştır.

**KANIT (cihaz değil, GERÇEK KARO):** `field-runs/mapdata-shootout-20260907/
housenumber-check.mjs` üretim stilini kaynaktan derleyip kaydedilmiş gerçek
karoya (`14/9778/6381.pbf`) uyguladı:

```
katman var mı   : true · source-layer: housenumber
minzoom         : 17 · text-field: ["get","housenumber"]
karo housenumber: 7 · z17 kabul: 7
değerler        : ["22/D","4","26","6","10","8","15"]
çakışma sırası  : housenumber 37 < road-label 39 → sokak adı ÖNCELİKLİ
```

Yani denetimin bulduğu 7 gerçek numaranın tamamı artık çizilebilir durumda.
**Bu bir CİHAZ kanıtı DEĞİLDİR** — yerleşim (collision) ve okunabilirlik hâlâ
#1318 ile ölçülecek.

**Bilinçli olarak DEĞİŞTİRİLMEYEN:** yerel sokak adı `minzoom` 16 ve
`symbol-spacing` 460 (bkz. #1319 — cihaz deneyi tanımlandı).

Diğer tüm fazlar üretim davranışına DOKUNMADI (renderer'a bağlanmadı).

---

## 7. Test/QA sonuçları

Hedefli (implementation döngüsü):
- `mapDataContractsF0` 34/34 · `mapDataIngestionF2` 25/25 ·
  `mapDataBuildingFusionF3` 21/21 · `mapDataSeamsF5F6` 17/17 ·
  `carosLabMapDataPlatform` 17/17
- `cartographyAuthority` 60/60 (+2 yeni kilit) · `carosLab` 42/42 ·
  `oemDrivingMap` · `navSuppressionContrast` PASS
- `npm run guard` **1001/1001** (+3 yeni kilit)
- `tsc --noEmit` PASS · `eslint` (değişen dosyalar) 0 hata

**AĞIR DOĞRULAMA (bir kez, kod final durumdayken):**
- `npm run test` (full suite): **837 dosya · 18952 test · 18952 PASS · 0 FAIL**
  (290 sn). Düşen yok, atlanan yok.
- `npm run build` (production): **✓ built in 5m 20s**. Yeni hata/uyarı
  ÜRETİLMEDİ; çıktıdaki `INEFFECTIVE_DYNAMIC_IMPORT` uyarıları ÖNCEDEN VAR
  ve media/nav modüllerine aittir (bu turda o dosyalara dokunulmadı).
- `tsc --noEmit -p tsconfig.app.json`: temiz.
- `npx eslint` (bu turda değişen tüm dosyalar): 0 hata / 0 uyarı.

Kanıt–diff bağı: bu ağır doğrulama `4525f748` HEAD'inde koştu. Sonrasında
YALNIZ doküman (`CAROS_PRO_VIZYONU.md`, bu belge) ve bir ölçüm betiği
(`housenumber-check.mjs`) eklendi — üretim kodu DEĞİŞMEDİ, dolayısıyla kanıt
geçerliliğini korur.

> **CODE PASS ≠ DEVICE PASS ≠ FIELD PASS.** Gerçek araç/cihaz ölçümü YAPILMADI.

---

## 8. Commit SHA'ları

```
6ead8b75  feat(mapdata): F0 — sözleşmeler + lisans güvenlik duvarı
6f93b3bb  measure(mapdata): F1 — Tarsus çok kaynaklı shootout
63adbd2f  feat(mapdata): F2 — Overture/OSM bina adaptörleri + kayıt düzeyi lisans
78ed627a  feat(mapdata): F3 — bina fusion MVP
3e96a598  feat(mapdata): F4 — kapı numarası stilde tüketiliyor  ← ÜRETİM DEĞİŞTİ
0d8b0929  feat(mapdata): F5/F6 — adres/place ve canlı koşul dikişleri
4525f748  feat(lab): Harita Veri Platformu gözlem ekranı
```

Worktree güvenliği: her commit **explicit dosya listesiyle** yapıldı;
`git add .` · `reset --hard` · `clean` KULLANILMADI. Diğer oturumların dirty
dosyalarına (media/music/native/package.json/version.properties) DOKUNULMADI.
`field-runs/map-data-coverage-20260907/` untracked hâlde korundu.

---

## 9. DEVICE/FIELD pending

| # | Konu | Neden pending |
|---|---|---|
| **1318** | Kapı numarası z17'de çiziliyor mu · sokak adını eliyor mu | Üretim davranışı değişti, cihazda görülmedi |
| **1319** | Yerel sokak adı aralığı deneyi (460 · 340 · 240) | Host deneyi DPR1/pitch0; kaybolan ad ölçülmedi |
| **1320** | LAB ekranı 800×480'de taşma · lazy chunk yükleniyor mu | Cihazda açılmadı |

Ayrıca **ML footprint doğruluğu yer gerçeğiyle ölçülmedi** — bu bir ledger
maddesi değil, veri kalitesi borcudur.

---

## 10. Açık riskler

1. **ODbL share-alike (ürün riski).** Overture bina/yol kayıtları ODbL'dir.
   Footprint'leri cihaza paketleyen bir veri paketi üretilirse o paket ODbL
   yükümlülüğü taşır. Uygulama kodu etkilenmez ama **veri paketi kararı
   hukuki denetim ister.** Kapı bunu bugün doğru raporluyor.
2. **ML footprint yanlış pozitifi.** 2290 bina algoritma çıktısıdır; yanlış
   bina çizmek eksik bina çizmekten daha kötü olabilir (sürücü güveni).
   Renderer'a bağlamadan önce örneklem doğruluk ölçümü gerekir.
3. **Renderer entegrasyonu yok.** Bina kazancı bugün ekranda GÖRÜNMÜYOR.
   Görünmesi için ayrı tile üretim hattı gerekir — bu gece bilinçli olarak
   YAPILMADI (YAGNI + lisans kararı bekliyor).
4. **Adres ve yerel yol adı için kaynak yok.** Overture çözmüyor; kamu/belediye
   verisinin redistribution hakkı kanıtlanmadı.
5. **Overture güncellik gecikmesi** OpenFreeMap'inkinden farklı değil
   (OSM snapshot 2026-08-02).
6. `entityKey` **kalıcı kimlik değildir**; eşleştirme politikası değişirse
   anahtar değişir. Kalıcı kimlik gerekirse ayrı bir tasarım gerekir.

---

## 11. Sabah yapılacak EN YÜKSEK DEĞERLİ 3 iş

1. **#1318'i cihazda kapat.** Tarsus merkez çekirdeğinde (kapı numarası OLDUĞU
   bilinen nokta) z17+ gündüz/gece: numara görünüyor mu · z16'da görünmüyor mu ·
   sokak adı sayısı numara katmanı kapalıyken ölçülenle AYNI mı. Bu, gecenin
   üretime dokunan tek maddesidir; kapanmadan MAPDATA "çalışıyor" denemez.

2. **ML footprint doğruluk örneklemi.** Yakın 400×400 m alandaki 112 OSM-dışı
   footprint'ten rastgele 20'sini z17 uydu üzerinde tek tek doğrula
   (VAR / YOK / KAYIK). Yanlış pozitif oranı %10'un üstündeyse renderer
   entegrasyonu **askıya alınır** — bu ölçüm olmadan bina kazancı ürün kararına
   giremez.

3. **#1319 aralık deneyini cihazda koş.** 460 · 340 · 240 ile aynı sahne;
   kazanılan farklı ad, kaybolan ad ve `road-label-major` elenmesi kaydedilsin.
   Kazanç varsa `cartographyAuthority` kilidi yeni ölçülmüş değere GÜNCELLENİR
   (kaldırılmaz). Bu, adsız sokak sorununun kaynak tarafı çözülemeden
   alınabilecek TEK gerçek kazanımdır.

---

## Ek — tekrar üretim

```bash
# Overture çekimi (ağ + DuckDB gerektirir; venv scratchpad'de kuruldu)
python field-runs/mapdata-shootout-20260907/overture_extract.py
node   field-runs/mapdata-shootout-20260907/analyze.mjs        # -> shootout.json
node   field-runs/mapdata-shootout-20260907/make-fixture.mjs   # -> test fixture

# Doğrulama
npx vitest run src/__tests__/mapData src/__tests__/carosLabMapDataPlatform.test.tsx
npm run guard
npx tsc --noEmit -p tsconfig.app.json
```

Veri atfı: © OpenStreetMap katkıcıları (ODbL) · © Overture Maps Foundation ·
Microsoft ML Buildings (ODbL-1.0) · OpenMapTiles / OpenFreeMap · uydu © Esri.
Ölçüm verisi üretime gömülmedi.
