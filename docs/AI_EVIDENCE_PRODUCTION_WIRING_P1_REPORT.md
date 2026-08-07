# CAROS PRO — AI EVIDENCE PRODUCTION WIRING P1 RAPORU

**Tarih:** 2026-08-01
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** AI Evidence Engine omurgasının **üç gerçek üretim kaynağına**
bağlanması — Trip Metrics P2 · Driver DNA P1 · Fleet Intelligence P1.
**Kapsam dışı (bilinçli):** Deep Scan · BlackBox · DTC · bakım tahmini · LLM.
**Evidence Engine modeli:** **GENİŞLETİLDİ, BOZULMADI** (bkz. §3)
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`AI_EVIDENCE_PRODUCTION_WIRING_P1_COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `evidenceEngineRegressionVerdict` | **`PRESERVED`** (38/38) |
| `tripEvidenceVerdict` | **`WIRED`** (gerçek trip kapanışı → kanıt; 12 kontrol) |
| `driverDNAEvidenceVerdict` | **`WIRED`** (eşik · RETRACTED · kaynaksız metrik; 6 kontrol) |
| `fleetIntelligenceEvidenceVerdict` | **`WIRED`** (mevcut kanıt satırları → zincir; 6 kontrol) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

⚠️ **`WIRED` ≠ saha doğrulaması.** Zincir gerçek PostgreSQL'de gerçek
trigger'larla koştu, ama besleyen veriler **elle yazılmış yolculuklardır**.
Gerçek araçtan gelen tek bir kanıt yoktur.

---

## 2. NE YAPILDI — ÜÇ KANONİK ADAPTÖR

| Adaptör | Kaynak | Tetikleyici | Kural |
|---|---|---|---|
| `TRIP_METRICS_ADAPTER` | `TRIP_ENGINE` | `vehicle_trips` AFTER INSERT/UPDATE | yalnız **kapanmış** yolculuk |
| `DRIVER_DNA_ADAPTER` | `DRIVER_DNA` | `driver_dna` AFTER INSERT/UPDATE | yalnız **öğrenme eşiği aşılınca** |
| `FLEET_INTELLIGENCE_ADAPTER` | `FLEET_INTELLIGENCE` | `fleet_insight` AFTER INSERT/UPDATE | yalnız **`ACTIVE`** içgörü |

**Kaynak modüller doğrudan kanıt yazmaz:** tek yol
`_evidence_adapter_record` kapısıdır ve **kaynak sahipliği** orada uygulanır —
bir adaptör başka kaynağın kanıtını yazmaya kalkarsa `FOREIGN_SOURCE` döner
(PG `SO1`/`SO2` · TS `B1`). Tanınmayan adaptör de yazamaz.

### 2.1 Trip Metrics Adapter

İstenen 12 metriğin tamamı eşlendi (`distance` · `duration` · `moving` ·
`idle` · `unknown time` · `harsh brake/accel` · `max rpm` · `max engine temp` ·
`fuel` · `cost` · `confidence`).

- **Açık yolculuk kanıt üretmez** — devam eden ölçüm kanıt değildir (PG `T1`).
- **`UNAVAILABLE` alan kanıt üretmez** — `0` sayılmaz (PG `T3`).
- **`ESTIMATED` ölçülmüş gibi işaretlenmez:** kaynak alanı olduğu gibi
  taşınır ve güven tavanı `MEDIUM`da kalır (PG `T4`).
- **10× replay tek kanıt** — `refreshCount` artar (PG `RP1`/`RP2`).
- **Revizyon:** trip güncellenirse **eski kanıt DEĞİŞMEZ**, `SUPERSEDED`
  olur ve yeni revizyon açılır (PG `RV1`–`RV3`).

### 2.2 Driver DNA Adapter

- **Eşik altında kanıt YOK** (PG `D1`), eşik aşılınca kanıt var (PG `D2`).
- **Viraj/akü kanıtı ASLA üretilmez** — kaynak yok (PG `D3`).
- **Tek genel sürücü puanı üretilmez** (PG `D4`).
- **`RETRACTED` DNA aktif güvenilir kanıt gibi kullanılmaz:** mevcut kanıtlar
  `SUPERSEDED`e düşer ama **silinmez** (PG `D5`/`D6`).
- Her kanıt bağlamını taşır: `dna_trip_count` · `dna_distance_km` ·
  `dna_learning_level` + tanımsal oranlar (fren/hızlanma/yakıt/rölanti),
  provenance `*_measured_only`den türetilir, `subject_revision` = DNA revizyonu.

⚠️ **Paralel motor kurulmadı:** DNA karakter formülleri SQL'e kopyalanmadı
(TS `C1` + migration kendi doğrulamasında bunu zorluyor). Adaptör yalnız
PG'nin zaten sahip olduğu **tanımsal** oranları kanıta çevirir.

### 2.3 Fleet Intelligence Adapter

- **Mevcut `fleet_insight_evidence` satırları tek gerçek kaynak** (TS `C2`).
- **Kanıt <3 → ACTIVE zincir yok** (PG `FI1`), eşik aşılınca zincir kurulur
  (PG `FI2`).
- **Replay duplicate zincir üretmez** (PG `FI3`).
- **`SINGLE_VEHICLE_ONLY` etiketi korunur** — ayrı kanıt olarak taşınır (PG `FI4`).
- **`BATTERY_TREND` / `MAINTENANCE_TREND` kanıt üretmez** (PG `FI5`).

---

## 3. EVIDENCE ENGINE MODELİ: GENİŞLETİLDİ, BOZULMADI

Trip revizyonu kuralı (*"eski kanıt değiştirilmez, yeni revizyon oluştur"*)
055'in birleştirme kimliğiyle çelişiyordu: aynı özne+metrik tek kayıttı ve
tazeleme değeri güncelliyordu. Çözüm **model kırmadan genişletme**:

- `ai_evidence.subject_revision` (varsayılan `0`) + `superseded_by`
- birleştirme unique index'i revizyonu da içerir

Varsayılan `0` olduğu için **mevcut satırların davranışı değişmez**; 055'in
tüm fail-closed kısıtları, güven türetimi ve değişmezlik trigger'ı yerinde
(PG `IM1`, migration doğrulama (c), TS `G2`).

---

## 4. HATA YALITIMI

`_evidence_wire_safely` her adaptörü `EXCEPTION` bloğunda çalıştırır:

- **Ana işlem bozulmaz** — trip yükleme / DNA güncellemesi / insight sayımı
  rollback olmaz (PG `FI6`).
- **Hata sessizce yutulmaz** — sonuç bounded bir DURUM olarak döner ve
  adaptör durumuna yazılır (PG `FI7`):
  `REPORTED · DEDUPED · REJECTED · DEGRADED · RETRY_PENDING`.
- **Sınırlı yeniden deneme:** `attempts <= 5` CHECK + **üstel bekleme**
  (`2^n` dakika). Tükenen kayıt `DEGRADED` kalır — sessizce kaybolmaz
  (TS `E3`/`E4`). Sonsuz/hızlı retry **yapısal olarak imkânsız**.
- Aynı özne için kuyrukta **tek** bekleyen kayıt (`aer_subject_unique`).

---

## 5. GÖZLEM YÜZEYLERİ

**CAROS LAB · AI Evidence Engine** ekranına eklendi: `Source Adapters`
bölümü (her adaptörün son olayı · son sonucu · reported/deduped/rejected/
degraded/retry sayaçları · kanıt sayısı · öksüz zincir) + `sourceCoverage`
(kaç adaptör gerçekten kanıt üretmiş; **adaptör verisi yoksa `null`**, 0 değil)
+ toplam öksüz zincir ve bekleyen retry.

**Fleet UI:** `SubjectEvidenceList` (salt-okunur) — "Bu yolculuğun kanıtları" ·
"Bu profilin dayandığı kanıtlar" · "Bu içgörünün kanıtları". Buton/aksiyon
YOK; ölçümü olmayan kanıt `—` (0 değil); `SUPERSEDED`/`EXPIRED` gizlenmez ama
aktif gibi sunulmaz. Ham yük · tam UUID · VIN · konum **gösterilmez**.

---

## 6. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Sonuç |
|---|---|
| PG — 056 wiring matrisi | **40/40 PASS** |
| PG — 055 Evidence Engine regresyonu | **38/38 PASS** |
| PG — 054 Fleet Intelligence · 053 DNA | **31/31 · 25/25 PASS** |
| PG — 052 · 051 · 050 · 049 · 048 | **30/30 · 22/22 · 27/27 · 20/20 · 54/54 PASS** |
| PG — migration idempotens | 056 iki kez uygulandı, **temiz** |
| Vitest (kök) | **9563/9563 · 446 dosya** |
| Vitest (website) | **914/914 · 44 dosya** |
| TypeScript (kök `tsc -b`) | **temiz** |
| TypeScript (website `tsc --noEmit`) | **temiz** |
| Build | **başarılı (2 dk 2 sn)** |
| ESLint (değişen dosyalar) | **temiz** |
| Music Hub testleri | **157/157 PASS** |
| AccountCleanup / attribution testleri | **174/174 PASS** (website, 8 dosya) |
| Secret scan (ad-hoc, değişen dosyalar) | **temiz** — bulgu yok |

**056 matrisi (40 kontrol):** trip→evidence (T1–T5) · replay (RP1–RP2) ·
revizyon/immutable (RV1–RV3) · DNA eşik/kaynaksız/puan/RETRACTED (D1–D6) ·
FI zincir/replay/etiket/kaynaksız tip (FI1–FI5) · kaynak sahipliği (SO1–SO2) ·
cross-tenant + devir (X1–X2) · değişmezlik (IM1) · adaptör durumu (AD1–AD3) ·
hata yalıtımı (FI6–FI7) · zincir ileri/geri + özne listeleri (CH1–CH4) ·
regresyon (R1–R3) · yetki (S1–S2).

Yeni kilit: `aiEvidenceWiring.test.ts` **27 test** (adaptör sözleşmesi) +
website `evidenceCoverageView.test.ts`'e **6 test** (özne kanıt listesi).

### 6.1 Dürüstlük notu — istenen iki regresyon aracı repoda YOK

- **Secret scan:** depoda böyle bir harness (script/test) **bulunmuyor**.
  Bu turda **ad-hoc** bir tarama koştum (değişen dosyalarda `api_key`,
  `secret`, `password`, `bearer`, `sk-…`, `eyJ…`, `-----BEGIN` desenleri) —
  **bulgu yok**. Bunu "mevcut secret scan geçti" diye sunmuyorum; kalıcı bir
  harness kurulması ayrı iş (kütük #271).
- **Music Hub changed-file scan:** böyle adlandırılmış bir araç da yok.
  Yerine iki şey yaptım: (a) bu turda değişen dosyaların listesini `mtime` ile
  çıkardım — **hiçbir media/music dosyası bu turda değişmedi** (branch'te
  önceki turlardan kalan `M` işaretleri var, bu tura ait değil), (b) Music Hub
  test dosyalarını koştum (157/157).

### 6.2 Doğrulama sırasında düzeltilen bir test artefaktı

İlk koşumda `S1` (RLS) düştü: test "B admini **hiç** kanıt görmemeli" diyordu,
oysa aynı testte **B'nin kendi aracına ait** bir yolculuk da kanıt üretmişti.
Doğru soru "B hiç kanıt görüyor mu" değil, **"B, A'nın kanıtlarını görüyor
mu"**dur. Assertion düzeltildi — RLS'te sorun yoktu, testin sorusu yanlıştı.

---

## 7. BİLİNÇLİ OLARAK YAPILMAYANLAR

| Yapılmadı | Gerekçe |
|---|---|
| Deep Scan · BlackBox · DTC · bakım · LLM adaptörleri | **Görev gereği kapsam dışı.** `EVIDENCE_ADAPTERS` üç kaynakla sınırlı ve testle kilitli (TS `A2`). |
| Kartların sayfalara yerleştirilmesi | Bileşenler hazır ve testli; yerleşim ürün kararıdır — mevcut sayfa düzenine dokunulmadı. |
| Geriye dönük toplu kanıt üretimi | Geçmiş yolculuklar için kanıt üretmek, kanıt yaşını ve öğrenme eğrisini yalan yapardı. |
| `run_ai_evidence_retry()` için zamanlayıcı | Fonksiyon hazır, idempotent ve `SKIP LOCKED`; periyodik çağıran cron **yazılmadı** (#264 borcunun devamı). |
| Head unit ↔ sunucu köprüsü | Kanıt şirket geneli sorgulanır; köprü ayrı iştir (LAB `source=NONE` der). |

---

## 8. AÇIK BORÇLAR (kütüğe yazıldı)

| # | Borç | Kütük |
|---|------|-------|
| 1 | Zincir gerçek araç verisiyle hiç beslenmedi | #267 |
| 2 | Retry kuyruğunu çalıştıran zamanlayıcı yok | #268 |
| 3 | Kanıt kartları/listesi sayfalara bağlanmadı | #269 |
| 4 | Kapsam dışı kaynaklar (Deep Scan/BlackBox/DTC) bağlanmadı | #270 |
| 5 | Kalıcı secret-scan harness'ı yok (bu turda ad-hoc koşuldu) | #271 |

---

## 9. DEĞİŞEN DOSYALAR (bu tur)

**Yeni**
- `supabase/migrations/20260801000056_ai_evidence_production_wiring_p1.sql`
- `supabase/verification/local_056_ai_evidence_wiring_p1.sql`
- `src/__tests__/aiEvidenceWiring.test.ts`
- `website/src/components/dashboard/SubjectEvidenceList.tsx`
- `docs/AI_EVIDENCE_PRODUCTION_WIRING_P1_REPORT.md`

**Değişen**
- `src/platform/fleet/aiEvidenceEngine.ts` (adaptör sözleşmesi + LAB alanları)
- `src/components/devtools/screens/AiEvidenceEngineScreen.tsx` (Source Adapters)
- `website/src/lib/fleet/evidenceCoverageView.ts` (özne kanıt listesi)
- `website/src/__tests__/{evidenceCoverageView,driverDnaView,fleetIntelligenceView}.test.ts`
  (kanıt listesi testleri + tip dönüşümü düzeltmesi)

---

## 10. SAHA DOĞRULAMA — NE GÖZLENMELİ

Gerçek araç ve gerçek filo verisiyle:

1. Gerçek bir yolculuk kapandığında **ölçülen her alan** için kanıt oluşmalı;
   `UNAVAILABLE` alanlar için **oluşmamalı**.
2. Yakıt `ESTIMATED` geldiğinde kanıt güveni **`MEDIUM`u aşmamalı**.
3. Çevrimdışı kuyruk aynı yolculuğu tekrar yüklediğinde kanıt sayısı
   **artmamalı**, `refreshCount` artmalı.
4. Trip revizyonu arttığında eski kanıt **değişmemeli** ve `SUPERSEDED` olmalı.
5. DNA eşiği geçilene kadar sürücü kanıtı **oluşmamalı**.
6. Trip başka sürücüye atanınca DNA `RETRACTED` olmalı ve o sürücünün DNA
   kanıtları **aktif kalmamalı**.
7. Bir insight için Fleet UI'da **"Bu içgörünün kanıtları"** listesi
   dolmalı ve kanıt sayısı sunucudakiyle eşleşmeli.
8. Adaptör hatası (ör. geçici kilit) trip yüklemesini **bozmamalı**; LAB'da
   `RETRY_PENDING` görünmeli ve retry koşumundan sonra düşmeli.

Bu ölçütler gözlenene kadar `realVehicleValidationVerdict` =
**`BLOCKED_REAL_VEHICLE`**.
