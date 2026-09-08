# CAROS PRO — RTG3 FINAL PRE-NATIONWIDE HARDENING REPORT

Tarih: 2026-09-08 · Kapsam: build-toolchain + via-way turn restriction + Türkiye build kapısı.
Nationwide build **BAŞLATILMADI**. `public/maps/routing-graph.bin` **DEĞİŞMEDİ**.

## Analysis

### Authority map (P0 — yeniden keşif yok, mevcut sahipler doğrulandı)

| SORUMLULUK | TEK SAHİP | BU TURDA |
|---|---|---|
| Streaming PBF builder | `scripts/build-pbf-streaming-rtg3.mjs` | preflight + via-way çözümü eklendi |
| Disk-destekli store | builder içindeki `node:sqlite` şeması | `via_way` → `via_ways` (sıralı JSON) |
| Drivable-road policy | `scripts/routingGraphPolicy.mjs` | DEĞİŞMEDİ |
| RTG3 **writer** | önce ÇİFT (iki builder'da `serialize()`) → şimdi `scripts/rtg3Codec.mjs` | tekilleştirildi (bayt paritesi kanıtlı) |
| RTG3 **reader** | `src/platform/navigation/map/graph/rtg2Reader.ts` | via-way ayrıştırma + otomat |
| Restriction semantiği | `turnIsAllowed` (via-node) + `viaWayStep` (via-way) | aynı dosyada, ikinci yorum yok |
| Kanonik edge-state A* | `NavigationCompute.worker.ts::routeRtg3EdgeState` | duruma bounded maske eklendi |
| Manifest / merge | `turkeyGraphManifest.ts` | zincir remap + içerik tekilleştirme |
| Residency / admission | `graphResidencyRuntime.ts` | LAB gözlem alanları eklendi |

Yeni router, yeni graph manager, ikinci route authority **KURULMADI**.

### node:sqlite riski — gizlenmedi, ölçüldü

`node:sqlite` v22.5.0'da `--experimental-sqlite` arkasında geldi, **v22.13.0'dan
itibaren bayraksızdır**. İki hedef ortamda `DatabaseSync` açılıp `CREATE/INSERT/
SELECT` gerçekten koşularak kanıtlandı: WSL Node 22.22.1 (build ortamı) ve
Windows Node 24.15.0 (geliştirici ortamı). Node 22'de yalnız `ExperimentalWarning`
basılır, çalışma davranışı değişmez. Bu nedenle **stabil bir SQLite bağımlılığına
geçilmedi** — mevcut çözüm minimum değişiklikle sağlamlaştırıldı: sürüm alt sınırı
`package.json#engines` ile pinlendi ve preflight yeteneği sürüm dizesine değil
**gerçek sorguya** bakarak doğruluyor.

### Via-way mimarisi

Gerçek OSM semantiği `from way → via way(lar) → to way`dır ve **tek kavşak kaydına
sıkıştırılamaz**: yasak olan tek bir dönüş değil, kenar DİZİSİNİN tamamlanmasıdır.

RTG3 kayıt boyu (16 B) ve başlık **değişmedi**. `type` baytı genişletildi:

```
type 1..7                    → klasik via-node kısıtı (BİT BİT AYNI)
type 0x80 | base             → via-way zincir halkası
type 0x80 | 0x40 | base      → zincirin SON halkası
byte13 = chainSeq (u8)   byte14..15 = chainId (u16)
```

Zincir `e0 (from) → e1..ek (via) → em (to)` kenar dizisini halkalara ayırır;
her halka kendi kavşak düğümünü taşır.

**Geriye uyum bilinçli olarak fail-closed'dır:** eski okuyucu `type` 1..7 dışını
`INVALID` sayıp grafı TÜMDEN reddeder → eski uygulama yeni artefaktı "kısıtı
görmeden" sürmez. Via-way içermeyen RTG3 bayt bayt aynıdır (14 bölgeden 12'si bu
turda **bayt bayt değişmedi**); RTG1/RTG2 hiç etkilenmez. Yeni sihirli sayı
gerekmedi.

### Edge-sequence semantiği (bounded)

İkinci router yazılmadı. Kanonik A* durumu `(düğüm, önceki kenar)` iken
`(düğüm, önceki kenar, **maske**)` oldu. Maske, o kenar üzerindeki **en fazla 8**
zincir yuvasından hangilerinin izlenmekte olduğudur — sınırsız rota geçmişi
TUTULMAZ. Yuvası olmayan kenar için `viaWayStep` tek bir bitset okumasıyla `0`
döner; via-way kaydı olmayan grafta maske **daima 0** → durum anahtarı ve arama
davranışı önceki sürümle birebir aynıdır.

- `no_*`  : yalnız SON halka tamamlanmak üzereyken geçiş reddedilir. Ara
  kavşaklardaki alternatifler ve zincire GİRİLMEMİŞ geçişler serbesttir.
- `only_*`: zincire girildikten sonra yalnız izin verilen devam kabul edilir;
  zincire girilmemiş alakasız yollar bloklanmaz.

## Patch

- `scripts/rtg3Codec.mjs` (YENİ) — tek RTG3 yazma otoritesi + via-way bit sözleşmesi.
- `scripts/rtg3BuildPreflight.mjs` (YENİ) — `RTG3_TOOLCHAIN` sözleşmesi + fail-fast preflight.
- `scripts/rtg3-turkey-preflight.mjs` (YENİ) — Türkiye kaynak ölçümü, projeksiyon, kapı.
- `scripts/build-pbf-streaming-rtg3.mjs` — preflight, sıralı `via_ways`, via-way çözümü, sınıflandırma, ortak codec, `RTG3_REGION_PREFIX`/`RTG3_SOURCE_LABEL` parametreleri.
- `scripts/build-rtg3-bounded.mjs` — ortak codec'e taşındı (çıktı bayt bayt aynı, ölçüldü).
- `scripts/validate-rtg3-hardening.ts` — BEFORE/AFTER dönüşümlü ölçüm, via-way uçtan uca kanıt, pilot geçiş.
- `rtg2Reader.ts` — via-way ayrıştırma, `buildViaWayIndex`, `viaWayStep`, `turnIsAllowed` ayrımı, sıcak-yol bitset'i.
- `turkeyGraphManifest.ts` — çok bölgeli zincir remap + içerik tekilleştirme, tutarsız zincirde fail-closed `null`.
- `NavigationCompute.worker.ts` — A* durumuna bounded maske (algoritma ve sezgisel ağırlık DEĞİŞMEDİ).
- `graphResidencyRuntime.ts` + `navigationCoreModel.ts` — LAB · Navigasyon Çekirdeği'ne "Dönüş kısıtları" satırı (mevcut ekran GENİŞLETİLDİ, yeni ekran açılmadı).
- `package.json` — `engines.node >= 22.13.0`.

## 1. BUILD COMPONENT

| BUILD COMPONENT | VERSION | REQUIRED | VERIFIED | RESULT |
|---|---|---|---|---|
| Node.js (build ortamı, WSL) | 22.22.1 | `>=22.13.0` | preflight `node-runtime` | PASS |
| Node.js (geliştirici, Windows) | 24.15.0 | `>=22.13.0` | `rtg3BuildPreflight.test.ts` | PASS |
| `node:sqlite` | Node gömülü (bayraksız) | `DatabaseSync + prepare + iterate + WAL` | gerçek CREATE/INSERT/SELECT probe | PASS |
| osmium-tool | 1.19.0 | `>=1.14.0` | `osmium --version` ayrıştırması | PASS |
| libosmium | 2.23.0 | — | bilgi (osmium ile gelir) | — |
| `package.json#engines.node` | `>=22.13.0` | `RTG3_TOOLCHAIN.node.min` ile AYNI | kilit test (senkron) | PASS |
| Kaynak PBF imzası | BlobHeader 14 B + `OSMHeader` | okunabilir OSM PBF | preflight `source-pbf` | PASS |
| Temp/çıktı yazılabilirliği | probe dosyası yaz+sil | yazılabilir | preflight | PASS |
| Serbest disk (Türkiye) | 48 611 258 368 B | `>=16 126 536 350 B` | `statfs` | PASS |
| Bellek bütçesi | 512 MiB | `>=256 MiB` | preflight | PASS |

## 2. RESTRICTION CLASS (gerçek Mersin PBF — 9 899 746 B · SHA-256 `3548f3e8…`)

| RESTRICTION CLASS | OBSERVED | SUPPORTED | UNSUPPORTED | MALFORMED | UNRESOLVED |
|---|---:|---:|---:|---:|---:|
| via-node `no_*` / `only_*` | 117 | 110 | 0 | — | 7 |
| via-way `no_*` / `only_*` | 3 | 2 | 0 | — | 1 |
| vehicle-specific (`except`) | 4 | 0 | 4 | — | 0 |
| conditional (`restriction:conditional`) | 0 | 0 | 0 | — | 0 |
| kaynak üye yapısı hatalı | 23 | — | — | 23 | — |
| **TOPLAM** | **147** | **112** | **4** | **23** | **8** |

Sınıflandırma sözlüğü: `SUPPORTED_VIA_WAY · UNRESOLVED_TOPOLOGY ·
UNSUPPORTED_CAPACITY` (via-way) ve `VEHICLE_SPECIFIC_UNSUPPORTED ·
CONDITIONAL_UNSUPPORTED · MALFORMED · UNRESOLVED` (genel). Araç-özel `except`
ilişkileri **jenerik kısıta YÜKSELTİLMEDİ** — vitrinlik sayı üretilmedi.

**Via-node regresyon kapısı:** önceki tur temeli **110**, bu tur **110** — via-way
desteği via-node çözümünü azaltmadı (kilit test `supportedViaNode >= 110`).

## 3. VIA-WAY RELATION (gerçek OSM ilişkileri, fixture DEĞİL)

| OSM ID | TYPE | MEMBERS | RTG3 | CANONICAL A* | RESULT |
|---:|---|---|---|---|---|
| 10048813 | `no_u_turn` | from w725700801 · via w725695223 · to w725695257 | `tr-33-65-72` zincir 1 · 2 halka · kenar 30196→29996→29997 · düğüm 29465,16549 | dizi tamamlanması **reddedildi**; alakasız giriş ve ara alternatifler serbest; worker **meşru alternatif rota** döndürdü | **PASS** |
| 17574418 | `only_straight_on` | from w1280952499 · via w1280952494 · to w1280952456 | `tr-33-69-73` zincir 1 · 2 halka · kenar 149638→149633→149415 · düğüm 134299,134654 | zorunlu devam **kabul**, alternatif devam **reddedildi**; worker rotası otomatta **0 ihlal** | **PASS** |
| 10048814 | `no_u_turn` | from w291360267 · via w725695223 · to w725695258 | **YAZILMADI** | — | `UNRESOLVED_TOPOLOGY` |

`10048814` neden yazılmadı (kanıt): via yol `725695223` bir `trunk_link`tir
(policy gereği tek yön) ve düğüm dizisi `5481143515 → 3407259719`dur. Bu ilişkinin
`from` yolu (`291360267`) linkin **çıkış** ucuna (`3407259719`) değer; manevra
linki **ters yönde** sürmeyi gerektirir. Grafta sürülemeyen bir manevra
yasaklanamaz → kısıt uydurmak yerine dürüstçe çözülemedi olarak sınıflandırıldı.
Aynı via yolunun **sürülebilir** yönü olan `10048813` ise desteklendi.

Artefakt etkisi: 14 bölgeden **12'si bayt bayt DEĞİŞMEDİ**; yalnız
`tr-33-65-72` ve `tr-33-69-73` +32 B büyüdü (2 zincir × 2 halka × 16 B).
Toplam 27 232 796 B → **27 232 860 B** (+64 B, tam olarak beklenen fark).

## 4. ROUTE TYPE — BEFORE/AFTER (aynı kod · BEFORE = via-way KAYITSIZ `HEAD` artefaktı)

15 örnek · rota başına 3 ısınma · bacaklar **rota bazında dönüşümlü** · ölçüm
öncesi bir **pilot geçiş** atıldı (V8 IC/tier geçişi ilk bacağı sistematik olarak
yavaş gösteriyordu — düzeltilmeden fark 3× görünüyordu).

| ROUTE TYPE | BEFORE P50/P95 (ms) | AFTER P50/P95 (ms) | RESULT PARITY | VERDICT |
|---|---:|---:|---|---|
| 2 bölge · arter → yerel | 199.78 / 210.81 | 210.51 / 257.31 | 70 407 m = 70 407 m | PASS |
| 2 bölge · yerel → yerel | 32.57 / 36.73 | 29.17 / 31.86 | 26 468 m = 26 468 m | PASS |
| 3 bölge · yerel → arter | 187.61 / 204.57 | 168.13 / 179.81 | 90 636 m = 90 636 m | PASS |
| via-node kısıt (`10048729 no_u_turn`) | doğrudan dönüş yasak | doğrudan dönüş yasak | değişmedi | PASS |
| via-way `no_*` (`10048813`) | kısıt YOK (kayıt yoktu) | yasak dizi reddedildi | meşru alternatif rota | PASS |
| via-way `only_*` (`17574418`) | kısıt YOK (kayıt yoktu) | zorunlu devam uygulandı | 0 otomat ihlali | PASS |

Yön karışık ve örneklem küçük: iki rota hızlandı, biri yavaşladı. **Ölçülebilir bir
gerileme yok**; üç rotanın da mesafesi birebir aynı. `state expansions` bu turda
**UNAVAILABLE**'dır — worker genişleme sayacını dışarı vermiyor ve yalnız ölçüm
için üretim mesajına telemetri alanı eklenmedi (kanıtsız sayı üretmektense
ölçülmedi denir).

## 5. TURKEY BUILD PREFLIGHT

Kaynak: `turkey-260906.osm.pbf` · **645 061 454 B** ·
SHA-256 `c841556847bd31ed511ca3f61b5086644664488f48b23d7ce2a4b7d6c36dd80f` ·
son OSM damgası `2026-09-06T20:20:13Z`.

| CHECK | MEASURED / PROJECTED | RESULT |
|---|---|---|
| Kaynak okunabilir + PBF imzası | MEASURED · 645 061 454 B · BlobHeader 14 B | PASS |
| Kaynak eleman sayıları | MEASURED · 102 010 697 node · 9 708 419 way · 78 691 relation | PASS |
| Builder araç zinciri | MEASURED · node 22.22.1 · osmium 1.19.0 · node:sqlite USABLE | PASS |
| Serbest disk | MEASURED · 48 611 258 368 B (gereken 16 126 536 350 B) | PASS |
| Temp alan ihtiyacı | PROJECTED · ~13 466 435 436 B (≈12.5 GiB) | PASS |
| Çıktı alan ihtiyacı | PROJECTED · ~2 391 396 511 B (≈2.2 GiB) | PASS |
| Bellek bütçesi | MEASURED · 512 MiB kapı geçerli; Mersin tepe 290.28 MiB | PASS |
| Partition stratejisi | MEASURED · deterministik 0.5° ızgara (`RTG3_REGION_PREFIX` parametrik) | PASS |
| Manifest stratejisi | MEASURED · schemaVersion 1 · reciprocal neighbors · SHA/size gate | PASS |
| Beklenen bölge sayısı | PROJECTED · yoğunluk tahmini ~394 · ızgara üst sınırı 1705 | UNKNOWN (aralık) |
| Build süresi | PROJECTED · ~9 982 712 ms (≈2 sa 46 dk) | PASS (bloklayıcı değil) |
| Tepe RSS (Türkiye) | **UNKNOWN** | fail-closed bütçe kapısıyla korunur |
| Rebuild/update stratejisi | MEASURED · kaynak SHA manifest'te; farklı SHA = yeni dataset | PASS |

Projeksiyon yöntemi: muhafazakâr ölçek = `max(way oranı 87.81, bayt oranı 65.16)
= 87.81`. Türev projeksiyonlar: ~4 271 747 seçili yol · ~50 800 906 gerekli
koordinat · ~52 759 837 graf düğümü · ~55 251 967 graf kenarı.

**Tepe RSS neden UNKNOWN:** disk-destekli mimaride tepe, kaynak boyutuyla lineer
DEĞİLDİR. SQLite sayfa önbelleği sabittir (32 MiB) ve tepe, **en büyük tek
bölgenin** serileştirme anındaki ihtiyacıyla belirlenir. Mersin'in en büyük
bölgesi 155 702 kenardır; Türkiye'nin en yoğun 0.5° karosu (İstanbul) bundan
büyüktür ama **ne kadar büyük olduğu ölçülmedi**. Bu bir kapı değil, bilinen bir
bilinmezdir: aşımda `RTG3_MEMORY_BUDGET_EXCEEDED` build'i fail-closed düşürür.

**Bilinen kaynak inceliği:** Geofabrik Türkiye extract'inin bbox'ı
`18.36..45.37 lon · 31.21..46.35 lat` — ülke sınırından geniştir; 1705'lik ızgara
üst sınırı bu yüzden **gerçekçi değil**, yalnız üst sınırdır.

## 6. CAPABILITY

| CAPABILITY | BEFORE | AFTER | NATIONWIDE BUILD READY | BLOCKER |
|---|---|---|---|---|
| Build toolchain determinizmi | pinlenmemiş; `node:sqlite` "deneysel" notu | `engines` + `RTG3_TOOLCHAIN` + yetenek probe'u | **EVET** | yok |
| Builder preflight | YOK (build yarıda düşebilirdi) | 8 kontrol · fail-fast · yarım graf yok | **EVET** | yok |
| RTG3 yazma otoritesi | 2 kopya `serialize()` | tek `rtg3Codec.mjs` (bayt paritesi kanıtlı) | **EVET** | yok |
| via-node turn restriction | 110 çözüldü | 110 çözüldü (regresyon yok) | **EVET** | cihaz/saha |
| via-way turn restriction | 3 gözlendi · 0 desteklendi | 2 desteklendi · 1 dürüstçe çözülemedi | **EVET** | cihaz/saha |
| Vehicle-specific (`except`) | desteklenmiyor | desteklenmiyor (**yükseltilmiyor**) | EVET (kapsam dışı) | tam araç profili semantiği |
| Kanonik A* tekliği | tek otorite | tek otorite + bounded maske | **EVET** | U dönüşü cezası yok (bilinen borç) |
| Türkiye kaynak hazırlığı | ölçülmemiş | ölçüldü + projeksiyon + kapı | **EVET** | yok |
| Türkiye çapı graph | YOK | YOK (bu turda üretilmedi) | — | build henüz koşulmadı |
| Production RTG3 swap | kapalı | **kapalı** | HAYIR | head-unit yük/RAM + saha korpusu |

## TURKEY_RTG3_BUILD_GATE

| # | GATE ÖLÇÜTÜ | KANIT | SONUÇ |
|---:|---|---|---|
| 1 | reproducible/pinned builder toolchain | node>=22.13.0 · osmium>=1.14.0 · engines pinli | PASS |
| 2 | preflight PASS | 8/8 kontrol | PASS |
| 3 | streaming/disk-backed builder PASS | SQLite iki geçişli akış | PASS |
| 4 | Mersin `<=512 MiB` | 290.28 MiB (process-tree) | PASS |
| 5 | graph semantic parity | 600 821 düğüm · 629 201 kenar | PASS |
| 6 | via-node restrictions | 110 çözüldü (temel 110) | PASS |
| 7 | valid real via-way restrictions | 2 gerçek ilişki uçtan uca | PASS |
| 8 | manifest | 14 bölge · reciprocal · SHA gate | PASS |
| 9 | multi-region canonical A* | 2/2/3 bölge · access·oneway·restriction LEGAL | PASS |
| 10 | corruption fail-closed | 6/6 reddedildi | PASS |
| 11 | Türkiye build için yeterli disk | 48.6 GB serbest / 16.1 GB gerekli | PASS |
| 12 | production RTG2 untouched | SHA `e7713f75…` değişmedi | PASS |

**`TURKEY_RTG3_BUILD_GATE = READY_FOR_NATIONWIDE_SHADOW_BUILD`**

## Production safety

`public/maps/routing-graph.bin` **7 651 542 B** ·
SHA-256 `e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da` —
**DEĞİŞMEDİ**. Production graph changed? **HAYIR.**
Nationwide RTG3 production swap: **YAPILMADI.** RTG3 gölgede kalır.

## Observability (CAROS LAB)

Yeni ekran AÇILMADI (ekran enflasyonu yasağı). Mevcut **Navigasyon Çekirdeği**
kartına tek satır eklendi: `hz-graph-restrictions` — kanonik okuyucudan gelen
dönüş kısıtı kayıt sayısı ve via-way zincir sayısı. Graf çözülmemişse
`ölçülmedi` yazar (sahte 0 yok); satır kendi hükmünü üretmez, komut göndermez.
Alan denetim kaydına (`navigationCoreFieldAudit`) işlendi.

## Tests

| KAPSAM | SONUÇ |
|---|---|
| `rtg3ViaWayRestriction.test.ts` (YENİ) | 15/15 PASS |
| `rtg3BuildPreflight.test.ts` (YENİ) | 7/7 PASS |
| `rtg3ProvinceHardening` · `rtg3Reader` · `regionalRtg3` · `navV3GraphTopologyF4` · `navigationCoreFieldAudit` · `navV3CorridorEnforcementF6` | 186/186 PASS (yeni dosyalarla birlikte) |
| `npm run guard` (regresyon kasası) | 1008/1008 PASS (+4 yeni kilit) |
| `npx tsc -b` | PASS |
| Değişen dosyalarda ESLint | PASS |
| Full suite · production build | **KOŞULMADI** → QA REQUIRED |

**Durum: `IMPLEMENTATION COMPLETE — QA REQUIRED`.**
CODE PASS ≠ DEVICE PASS ≠ FIELD PASS. Kütük maddesi **#1209** 🔴'dır.

## Bilinen açık borçlar (gizlenmedi)

1. **U dönüşü cezası yok.** Kanonik A* U dönüşünü cezalandırmaz; via yolu çift
   yönlüyse sürücü via kenarında U dönüşü yapıp otomatı sıfırlayabilir
   (`0,1,2,1,2,3`). Bu kaçış **via-node kısıtlarında da bugün vardır** — via-way
   desteğinin getirdiği bir gerileme değildir. Ayrı ve ölçülmüş bir tur ister.
2. **Vehicle-specific / conditional semantiği yok.** 4 `except` ilişkisi
   desteklenmiyor olarak sınıflandırılır; tam araç profili bu turun kapsamı değil.
3. **`state expansions` ölçülmedi** (worker sayaç yayınlamıyor).
4. **Türkiye tepe RSS ve gerçek bölge sayısı UNKNOWN** — yalnız build ölçer.
5. `field-runs/routing-graph-v3-20260907/` altındaki commit'li `.rtg3`
   artefaktları **HEAD kodundan eski**dir (önceki tur politikayı değiştirip
   yeniden üretmemiş). Bu tur onları değiştirmedi; ayrıca yenilenmeli.

## Next

1. Türkiye çapı **gölge** RTG3 build'ini koş (`RTG3_REGION_PREFIX=tr`,
   `RTG3_SOURCE_LABEL`, `RTG3_RUN_DIR` ile); gerçek bölge sayısı, tepe RSS ve
   süreyi ÖLÇ, projeksiyonla karşılaştır.
2. Head unit'te 2–3 partition rezidansı + via-way kısıtlı gerçek kavşak
   yaklaşımını sür; kütük #1209 ölçütlerini 🟢/❌'ye taşı.
3. U dönüşü cezasını ayrı, ölçülmüş bir turda ele al (rota maliyet semantiğini
   değiştirir — atomik ve kanıtlı olmalı).
