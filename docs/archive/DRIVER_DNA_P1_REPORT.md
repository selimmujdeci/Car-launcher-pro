# CAROS PRO — DRIVER DNA P1 RAPORU

**Tarih:** 2026-08-01
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Gerçek Driver DNA altyapısı — kanonik model · bileşenler · güven ·
öğrenme · sapma · araç etkisi · LAB · Fleet UI · gerçek PostgreSQL.
**AI üretildi mi:** **HAYIR** (bağlayıcı — bkz. §2)
**Presence / Authentication / Trip Engine:** **DEĞİŞTİRİLMEDİ**
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `driverPresenceRegressionVerdict` | **`PRESERVED`** (20/20 + 27/27 + 22/22) |
| `driverAuthenticationRegressionVerdict` | **`PRESERVED`** (30/30) |
| `tripRegressionVerdict` | **`PRESERVED`** (P0 54/54 · attribution zinciri değişmedi) |
| `driverDNARegressionVerdict` | **`ESTABLISHED`** (25/25 PG + 41 TS + 14 website kilidi) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

DNA gerçek bir araçtan gelen gerçek yolculuklarla **hiç dolmadı**; tüm
ölçümler elle yazılmış yolculuk kayıtlarıyla yapıldı. Kanıtsız `PASS`
verilmedi.

---

## 2. "BU PAKET AI ÜRETMEYECEK" — NASIL GARANTİ EDİLDİ

Bu, paketin **en sıkı kısıtıydı**. Dört kapıyla kilitlendi:

| # | Kapı | Nerede |
|---|------|--------|
| 1 | DNA katmanında `fetch` · `openrouter` · `gemini` · `prompt` · `aiService` · `semanticAi` geçmesi **YASAK** | TS `G1` |
| 2 | Katman **saf**: I/O · `Date.now()` · timer · `supabase` · depolama YOK | TS `G2` |
| 3 | Tek bir **"sürücü puanı" alanı YOK** (`score`/`rating`/`grade` yasak) | TS `A6` · website `D2` |
| 4 | Sürücü **etiketlenmez**, sıralanmaz; çıktı yalnız metrik + kanıt sayacı | Model sözleşmesi |

Üretilen şey bir model değil, **kanıt altyapısıdır**: her metrik hangi
ölçümden geldiğini (`MEASURED`/`DERIVED`/`UNKNOWN`), kaç yolculuğa ve kaç
kilometreye dayandığını taşır. AI gelecekte bunu **girdi** olarak
kullanabilir; bugün kimse bir tahmin üretmiyor.

---

## 3. EN ÖNEMLİ DÜRÜSTLÜK KARARI — ÖLÇÜLEMEYENİ BEYAN ETMEK

Görevde 16 bileşen sayıldı. Bunlardan **ikisi bugün ÖLÇÜLEMEZ** ve bu
gizlenmedi:

| Bileşen | Neden ölçülemez | Sonuç |
|---|---|---|
| `CORNERING_STYLE` | Yanal ivme / gyro verisi yolculuk modelinde **YOK** | Kalıcı `UNKNOWN` + `NO_EVIDENCE_SOURCE` |
| `BATTERY_CARE` | Akü voltajı/şarj döngüsü trip kaydına **girmiyor** (native ATRV okunuyor ama saklanmıyor) | Kalıcı `UNKNOWN` + `NO_EVIDENCE_SOURCE` |

Hızdan "viraj stili" türetmek teknik olarak mümkündü ve kimse fark
etmezdi — **ama bu uydurma olurdu.** `DNA_COMPONENTS_WITHOUT_EVIDENCE`
listesi bir **eksiklik beyanıdır** ve testle kilitlidir (TS `A3`/`C1`):
bu bileşenler bir gün dolmaya başlarsa, kanıt kaynağının gerçekten
eklendiği kanıtlanmak zorundadır.

Ayrıca `CONFIDENCE` ve `LEARNING_PROGRESS` bilinçli olarak **bileşen
değil**, DNA'nın kendi alanlarıdır (`confidence`, `learningLevel`):
bunlar sürüş karakteri değil, karakterin ne kadar bilindiğinin ölçüsüdür.
Metrik listesine koymak, "ne bildiğimizi" bir karakter özelliği gibi
göstermek olurdu. Böylece 14 gerçek bileşen + 2 üst alan.

---

## 4. YAPILAN İŞLER

### 4.1 Kanonik model (`driverDna.ts`, saf)

```
DriverDna { driverId · companyId · status · learningLevel · confidence
            tripCount · totalDistanceKm · firstTripAtMs · lastTripAtMs
            metrics[] · driftState · driftEvidence[] · vehicleImpact[] · revision }

DnaMetric { component · value|null · unit · provenance · unknownReason
            sampleCount · sampleDistanceKm }
```

- **`UNKNOWN` metrik DAİMA `value: null`** taşır — sahte `0` yasak (TS `A4`).
- `ESTIMATED` bilinçli olarak **metrik provenance'ı DEĞİLDİR**; tahmin yalnız
  araç etkisi katmanındadır (TS `A1`).
- Birim her metrikte taşınır (`EVENTS_PER_100KM` · `RATIO` · `L_PER_100KM` ·
  `INDEX_0_1`) — sayının ne olduğu belirsiz bırakılmaz.

### 4.2 Güven motoru — yetersiz veride DNA YOK

```
DNA_MIN_TRIPS = 5      DNA_MIN_DISTANCE_KM = 50
```

Eşiğin altında `status = NO_DNA`, `confidence = UNKNOWN` ve **metrik listesi
BOŞ** döner (TS `D6`). Hem sayı hem mesafe istenir: *5 kez 300 metrelik park
manevrası bir karakter değildir.*

**En zayıf halka kuralı:** 200 yolculuk `HIGH` verirdi; ama metriklerin
yarısından çoğu bilinmiyorsa güven `LOW`'a kırpılır (TS `D5b`). Hiçbir
sinyal ölçülmemişse 200 yolculukla bile güven `UNKNOWN`'dır (TS `D5`) —
**"çok veri" ≠ "çok kanıt".**

### 4.3 Öğrenme motoru

| Yolculuk | Seviye |
|---|---|
| 0 | `NONE` |
| 1–9 | `NASCENT` |
| 10–99 | `DEVELOPING` |
| 100–999 | `ESTABLISHED` |
| 1000+ | `MATURE` |

Seviye **tek başına güven demek değildir** (§4.2). Aynı eşikler PG'de de
kilitli (`_dna_learning_level`, 053 doğrulama (c)).

### 4.4 Sapma (drift)

Taban penceresi ile son pencere karşılaştırılır; her iki pencerede de en az
5 örnek yoksa **karar verilmez** (`INSUFFICIENT`). %25'ten büyük göreli
değişim `DRIFTING` üretir ve **kanıt taşır**: hangi metrik, taban değeri,
son değer, delta, iki pencerenin örnek sayısı.

⚠️ Sapma bir **suçlama değildir**: sürücü değişmiş de olabilir, güzergâh
veya mevsim değişmiş de. Bu yüzden **yorum üretilmez** — yalnız kanıt.

### 4.5 Araç etkisi — TAHMİN olduğu kaldırılamaz

`VehicleImpactEstimate.estimated: true` **tip seviyesinde sabittir**
(literal type). Dört tahmin: balata · lastik · motor zorlanması · fazla
yakıt. Kanıt yoksa endeks `null` — bu **"etkisi yok" demek değildir**,
"bilinmiyor" demektir (TS `F2`). Etiketler bile "(tahmini)" içermek
zorundadır (TS `G4`).

### 4.6 PostgreSQL (migration 053)

- `driver_dna` — sürücü × şirket başına **tek** kayıt; her sinyalin **kendi
  sayacı ve kanıt mesafesi** var.
- `driver_dna_trip` — katkı defteri; `dna_trip_single_owner` unique index ile
  bir yolculuk **aynı anda tek DNA'ya** ait olabilir → replay kilidi.
- `_dna_apply_trip(dna, trip, ±1)` — ölçülmemiş alan **hiç dokunulmaz**
  (`0` gibi davranmaz); `-1` yönü sürücü değişiminde geri alır.
- `_dna_merge_trip` kapıları: yolculuk **ATTRIBUTED** olmalı · araç ve sürücü
  **aynı şirkette** olmalı · aynı yolculuk ikinci kez katkı veremez.
- **Sürücü değişimi dürüstlüğü:** katkı eski DNA'dan geri alınır, yenisine
  eklenir; ama pencere istatistikleri tam olarak eski hâline dönemez →
  `integrity_state='RETRACTED'` + `retracted_trip_count` ile **gizlenmez**.
- `get_driver_dna()` — RLS + şirket kapılı okuma.

**İKİ OTORİTE YASAĞI:** metrik formülleri SQL'e **kopyalanmadı**; migration
doğrulaması, RPC gövdesinde `MECHANICAL_SYMPATHY`/`AGGRESSIVENESS` geçerse
**düşer** (053 doğrulama (e)). Sunucu kanıt biriktirir, tek formül otoritesi
`driverDnaEngine.ts`'tir.

### 4.7 CAROS LAB — Driver DNA ekranı

Learning Level · Confidence · Last Update · DNA Age · Metric Count ·
Unknown Count · Trend (drift + kanıt listesi) · Evidence (metrik listesi,
her biri provenance çipiyle) · Vehicle Impact (TAHMİN rozetiyle).

Head unit'te DNA **üretilmez** (sunucuda birikir); köprü bağlı değilse ekran
`source = NONE` der ve **sahte metrik göstermez**.

### 4.8 Fleet UI — DNA kartı

`DriverDnaCard` (araç detayı + sürücü detayı için hazır bileşen) +
`driverDnaView.ts` (saf görünüm modeli). Eşik altında **boş kart değil,
gerekçe** gösterilir. Kanıtı olmayan oran `—` (asla `0`). Sürücü değişimi
`{n} yolculuk başka sürücüye taşındı` olarak görünür.

---

## 5. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Komut | Sonuç |
|---|---|---|
| PG — 053 DNA matrisi | `psql -f local_053_driver_dna_p1.sql` | **25/25 PASS** |
| PG — 052 authentication regresyonu | " | **30/30 PASS** |
| PG — 051 dayanıklılık regresyonu | " | **22/22 PASS** |
| PG — 050 defter regresyonu | " | **27/27 PASS** |
| PG — 049 presence regresyonu | " | **20/20 PASS** |
| PG — 048 kimlik/atama (P0) regresyonu | " | **54/54 PASS** |
| Vitest (kök) | `npx vitest run` | **9449/9449 · 443 dosya** |
| Vitest (website) | website dizininde | **880/880 · 42 dosya** |
| TypeScript | `npx tsc -b` | **temiz** |
| Build | `npm run build` | **başarılı (1 dk 15 sn)** |
| ESLint (değişen dosyalar) | `npx eslint …` | **temiz** |

**053 matrisi (25 kontrol):**

```
M1-M2  yolculuk DNA ya islendi · MEASURED provenance korundu        2/2
U1-U3  OLCULMEMIS yakit birikime GIRMEDI (0 sayilmadi) ·
       olculen alanlar birikmeye devam etti ·
       olculmeyen sinyalin sayaci ARTMADI                           3/3
R1-R2  10x REPLAY DNA yi SISIRMEDI · defterde TEK kayit             2/2
F1-F2  2 yolculuk/70 km -> DNA OLUSMADI · esik asilinca FORMING     2/2
L1-L3  12 yolculuk birikti · seviyeler ayrisiyor · pencereler doldu  3/3
D1     davranis DEGISIMI tespit edildi (DRIFTING)                    1/1
C1-C2  cross-tenant DNA OLUSMADI · baska tenant DNA si OKUNAMIYOR   2/2
X1-X4  surucu degisince geri alindi · gizlenmedi (RETRACTED) ·
       yeni DNA ya gecti · yolculuk tek DNA ya ait                  4/4
T1-T2  DEVIR sonrasi sizinti YOK · DNA sahipligi surucude kaldi     2/2
A1-A2  P0 atama modeli ETKILENMEDI · presence/auth KORUNDU          2/2
S1-S2  RLS cross-tenant kapali · DNA elle degistirilemez            2/2
```

Yeni kilitler: `driverDna.test.ts` **41 test** (sözleşme 6 · birikim 6 ·
metrik 7 · güven/öğrenme 8 · sapma 4 · araç etkisi 4 · AI-yok/saflık 6) +
`website/driverDnaView.test.ts` **14 test**.

---

## 6. MEVCUT KATMANLARA DOKUNULMADI — KANIT

| # | Kapı | Nerede |
|---|------|--------|
| 1 | 053 `_resolve_trip_driver` · `_resolve_driver_presence` · `_resolve_driver_authentication` · `_trip_attribution_trigger` fonksiyonlarını **yeniden tanımlamaz** | Migration gövdesi |
| 2 | Attribution gövdesinde `driver_dna` geçerse migration **DÜŞER** | 053 doğrulama (d) |
| 3 | Presence ve authentication otoriteleri **çağrılarak** sınandı | 053 doğrulama (d) |
| 4 | DNA modülleri `resolveDriverPresence`/`resolveDriverAuthentication`/`tripLogService` **import etmez** | TS `G3` |
| 5 | P0 atama modeli DNA birikimi sırasında **etkilenmedi** | PG `A1` |
| 6 | 048/049/050/051/052 matrisleri 053 sonrası **yeniden koştu** | §5 |

---

## 7. BİLİNÇLİ OLARAK YAPILMAYANLAR

| Yapılmadı | Gerekçe |
|---|---|
| Viraj stili ve akü bakımı metrikleri | **Kanıt kaynağı YOK.** Hızdan viraj türetmek uydurma olurdu (§3). |
| Tek "sürücü puanı" / sıralama | Görev gereği ve tasarım gereği: farklı sebeplerden gelen gerçekleri tek sayıya indirmek yalan üretir. |
| AI/öneri/doğal dil | **Görev gereği yasak.** Bu paket AI'nin girdisini hazırlar. |
| Head unit'te DNA hesaplama | Karakter uzun dönemli kanıttır; tek cihazın belleğinde yaşayamaz (cihaz değişince kaybolur). |
| `driver_dna` için geriye dönük toplu hesaplama | Mevcut yolculuklar için DNA **üretilmedi**: geçmişi tek seferde "öğrenmiş" göstermek, öğrenme eğrisini yalan yapardı. DNA bundan sonraki yolculuklarla birikir. |
| DNA kartının sayfalara yerleştirilmesi | Bileşen ve görünüm modeli hazır; hangi sayfada nereye konacağı ürün kararıdır ve mevcut sayfa düzenine dokunmamak için ertelendi. |

---

## 8. AÇIK BORÇLAR (kütüğe yazıldı)

| # | Borç | Kütük |
|---|------|-------|
| 1 | DNA gerçek araç yolculuklarıyla hiç dolmadı | #252 |
| 2 | Viraj/akü bileşenleri için kanıt kaynağı yok (yapısal) | #253 |
| 3 | Sürücü değişiminde pencere istatistikleri tam geri alınamıyor (`RETRACTED`) | #254 |
| 4 | DNA kartı henüz bir sayfaya yerleştirilmedi | #255 |
| 5 | Head unit ↔ sunucu DNA okuma köprüsü yok (LAB `source=NONE`) | #256 |

---

## 9. DEĞİŞEN DOSYALAR

**Yeni**
- `supabase/migrations/20260731000053_driver_dna_p1.sql`
- `supabase/verification/local_053_driver_dna_p1.sql`
- `src/platform/fleet/driverDna.ts` · `driverDnaEngine.ts`
- `src/components/devtools/screens/FleetDriverDnaScreen.tsx`
- `src/__tests__/driverDna.test.ts`
- `website/src/lib/fleet/driverDnaView.ts`
- `website/src/components/dashboard/DriverDnaCard.tsx`
- `website/src/__tests__/driverDnaView.test.ts`
- `docs/DRIVER_DNA_P1_REPORT.md`

**Değişen**
- `src/platform/devtools/carosLabCatalog.ts` · `carosLabScreenMap.tsx` (yeni ekran)

---

## 10. SAHA DOĞRULAMA — NE GÖZLENMELİ

Gerçek araçta, gerçek yolculuklarla:

1. İlk yolculuktan sonra DNA **oluşmamalı** (`NO_DNA`), sayaçlar artmalı.
2. 5 yolculuk + 50 km sonrası `FORMING`, 100 yolculuk sonrası `ESTABLISHED`.
3. OBD'siz (yalnız GPS) yolculuklarda `unknownCount` **yüksek** kalmalı ve
   güven `LOW`'u aşmamalı.
4. Aynı yolculuk çevrimdışı kuyruktan tekrar yüklenince `tripCount`
   **artmamalı**.
5. Sürüş sertleşince (şehir içi → agresif) `drift` **DRIFTING**'e geçmeli.
6. Trip başka sürücüye atanınca eski DNA'nın `tripCount`'u **azalmalı** ve
   kartta "başka sürücüye taşındı" görünmeli.
7. Viraj stili ve akü bakımı **her zaman UNKNOWN** kalmalı (kaynak yok).

Bu ölçütler gözlenene kadar `realVehicleValidationVerdict` =
**`BLOCKED_REAL_VEHICLE`**.
