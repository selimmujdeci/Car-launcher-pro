# CAROS PRO — FLEET INTELLIGENCE ENGINE P1 RAPORU

**Tarih:** 2026-08-01
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Kanıta dayalı Fleet Intelligence altyapısı — kanonik model ·
insight/kanıt motoru · güven · trend · filo sapması · filo sağlığı · kapsam ·
CAROS LAB · Fleet Dashboard · gerçek PostgreSQL.
**AI üretildi mi:** **HAYIR** (bağlayıcı — bkz. §2)
**Driver DNA · Trip Engine · Vehicle Identity · Driver Authentication:** **DEĞİŞTİRİLMEDİ**
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `driverDNARegressionVerdict` | **`PRESERVED`** (25/25) |
| `tripRegressionVerdict` | **`PRESERVED`** (P0 54/54 · attribution zinciri değişmedi) |
| `fleetRegressionVerdict` | **`PRESERVED`** (049 20/20 · 050 27/27 · 051 22/22 · 052 30/30) |
| `fleetIntelligenceRegressionVerdict` | **`ESTABLISHED`** (31/31 PG + 41 TS + 14 website kilidi) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Filo zekâsı gerçek araç yolculuklarıyla **hiç dolmadı**; tüm ölçümler elle
yazılmış kanıtlarla yapıldı. Kanıtsız `PASS` verilmedi.

---

## 2. "BU PAKET AI ÜRETMEYECEK" — NASIL GARANTİ EDİLDİ

Beş kapıyla kilitlendi:

| # | Kapı | Nerede |
|---|------|--------|
| 1 | Katmanda `fetch` · `openrouter` · `gemini` · `anthropic` · `openai` · `llm` · `aiService` · `semanticAi` geçmesi **YASAK** | TS `H1` · website `C1` |
| 2 | **Insight bir CÜMLE DEĞİLDİR:** `title`/`message`/`recommendation`/`summary`/`text` alanı yok — hem TS modelinde hem DB'de (migration doğrulaması bu kolonlar eklenirse **DÜŞER**) | TS `A3` · 054 doğrulama (b) |
| 3 | Katman **saf**: I/O · `Date.now()` · timer · depolama · `supabase` YOK | TS `H2` · website `C3` |
| 4 | DNA · trip · kimlik · doğrulama modülleri **import edilmez** | TS `H3` |
| 5 | Website'te öneri/tavsiye alanı üretilmez | website `C2` |

Üretilen şey bir model değil, **izlenebilir kanıt altyapısıdır**. Bir
insight'ın hangi araçlardan, sürücülerden, yolculuklardan ve metriklerden
oluştuğu satır satır saklanır (`fleet_insight_evidence`) ve LAB'da tek tek
görünür. Mavi ileride cümleyi **kendisi** kuracak; bu paket ona kanıt verir.

---

## 3. EN ÖNEMLİ İKİ DÜRÜSTLÜK KARARI

### 3.1 Kanıt kaynağı olmayan insight tipleri BEYAN EDİLDİ

İstenen 13 tipten **ikisi bugün üretilemez** ve bu gizlenmedi:

| Tip | Neden üretilemez | Sonuç |
|---|---|---|
| `BATTERY_TREND` | Akü voltajı/şarj döngüsü yolculuk kaydında **YOK** (Driver DNA'da da `BATTERY_CARE` aynı gerekçeyle `UNKNOWN`) | Kalıcı `NO_EVIDENCE_SOURCE` |
| `MAINTENANCE_TREND` | Bakım kaydı (servis tarihi, parça değişimi) bu pakette **YOK**. Sıcaklık/devirden "bakım gerekiyor" çıkarmak bir **TAHMİNDİR** ve bu paket tahmin üretmez | Kalıcı `NO_EVIDENCE_SOURCE` |

Bu tipler kanıt biriktirse bile **yayımlanmaz** — hem TS'te (`C3`) hem DB'de
(`_fleet_insight_recount`) kilitli.

### 3.2 Tek araçtan `HIGH` çıkmaz — pazarlıksız

Bir aracın yakıtı artmışsa bu **o araç hakkında** bir gözlemdir; *"filoda
yakıt artıyor"* iddiası için birden çok araçtan kanıt gerekir. Aksi hâlde
tek bir arızalı sensör tüm filo hakkında bir "içgörü" üretirdi.

- Tek araçlı içgörü **yayımlanır** ama `SINGLE_VEHICLE_ONLY` damgası taşır
  ve güveni `MEDIUM` tavanına takılır (TS `D1`/`D2` · PG `C2`).
- İkinci araç kanıtı gelince damga **kalkar** (PG `C3`).
- Tek araçlı trend **filo iddiası üretmez** (`SINGLE_VEHICLE`, PG `TR4`) ve
  filo sapmasına **girmez** (TS `F4`).

---

## 4. YAPILAN İŞLER

### 4.1 Kanonik model (`fleetIntelligence.ts`, saf)

```
FleetInsight { id · companyId · type · source · state · confidence
               createdAt · expiresAt
               evidenceCount · vehicleCount · driverCount · tripCount
               evidence[] · unknownReason · revision }

InsightEvidence { kind(VEHICLE|DRIVER|TRIP|METRIC) · refId · metric
                  value|null · provenance }
```

13 tip · 5 kaynak · 5 durum · 5 güven seviyesi · 6 trend metriği ·
6 sağlık boyutu — hepsi sözleşme olarak kilitli (TS `A1`/`A4`).
**Süresiz insight yoktur** (`expiresAt` zorunlu, varsayılan 7 gün).

### 4.2 Kanıt motoru — kanıtsız insight oluşmaz

- Aynı kanıt (`kind|refId|metric`) **iki kez eklenmez** → replay içgörüyü
  güçlendiremez (TS `B1` · PG `E2`).
- **Ölçülmemiş kanıt** (`value=null` + `provenance=UNKNOWN`) kabul edilmez —
  `0` gibi davranmaz (TS `B2` · PG `E4` · DB CHECK `fie_no_empty_evidence`).
- `ESTIMATED` kanıt kabul edilir ama güveni düşürür.
- Sayaçlar **kanıt defterinden türetilir**, elle yazılamaz (PG `E3`).
- **Son savunma:** `state='ACTIVE'` yapılmak istenen ama kanıtı 3'ten az olan
  içgörü DB trigger'ı tarafından **reddedilir** (PG `F1`).

### 4.3 Güven motoru

| Koşul | Güven |
|---|---|
| kanıt < 3 | `UNKNOWN` |
| araç < 2 | **tavan `MEDIUM`** (tek araç) |
| araç ≥ 5 + yolculuk ≥ 20 + ölçülmüş oran ≥ 0.8 | `VERY_HIGH` |
| yolculuk ≥ 20 + ölçülmüş oran ≥ 0.6 | `HIGH` |
| ölçülmüş oran < 0.4 | `LOW` |

Aynı eşikler PG'de de kilitli (`_fleet_insight_confidence`, 054 doğrulama (d)).

### 4.4 Trend motoru — minimum veri şartı

İki pencerede de **≥5 örnek** ve **≥2 araç** yoksa trend `UNKNOWN` kalır
(TS `E1`/`E2` · PG `TR1`/`TR4`). %10'un altındaki değişim `FLAT` sayılır —
gürültü trend olarak sunulmaz (TS `E4`).

### 4.5 Filo sapması — **araç bazında değil**

Filo düzeyinde %8+ göreli değişim `DRIFTING` üretir ve her kanıt **kaç
araçtan geldiğini taşır**. Sapma bir **suçlama değildir**: mevsim, güzergâh
veya iş hacmi de değişmiş olabilir — bu yüzden **yorum üretilmez**.

### 4.6 Filo sağlığı — **TEK PUAN YOK**

6 boyut ayrı durur; ölçülemeyen boyut `UNKNOWN` + endeks `null` kalır
("veri yok" ile "kötü" ASLA karıştırılmaz) ve **bir boyutun bilinmemesi
diğerlerini belirsizleştirmez** (TS `G4`).

- `fleetHealthSingleScore()` bilinçli olarak **`null` döner**.
- DB'de `overall_score`/`score`/`rating` kolonu eklenirse migration **DÜŞER**
  (054 doğrulama (c)).
- DB CHECK `fh_unknown_consistent`: `UNKNOWN` ile endeks **birlikte olamaz**
  ("bilinmiyor ama 0.4" bir çelişkidir).

### 4.7 Kapsam (coverage)

Araç yoksa **`null`** döner (0 DEĞİL — bölme yapılamaz). Kapsam bir başarı
ölçüsü değil, bir **bilgi ölçüsüdür**: düşük kapsam *"filo kötü"* değil,
**"bilmiyoruz"** demektir (TS `G5` · LAB ve pano metinlerinde yazılı).

### 4.8 PostgreSQL (migration 054)

`fleet_insight` · `fleet_insight_evidence` · `fleet_trend` · `fleet_health`
+ dedupe/replay kilitleri + güven kapısı + kanıt guard'ı + `get_fleet_intelligence()`
+ RLS (anon hiçbir şey, `authenticated` yalnız SELECT, yazma yalnız `service_role`).

**Cross-tenant:** kanıt başka şirketin aracına/sürücüsüne/yolculuğuna işaret
edemez — referans UUID ise sahibi doğrulanır (PG `X1`/`X2`); araç devredilince
yeni kanıt **reddedilir** (PG `T1`).

### 4.9 CAROS LAB — Fleet Intelligence ekranı

Insight Count · Evidence Count · Trend Count · Unknown Count · Confidence ·
Fleet Health (boyut boyut) · Learning Age · Drift (+kanıt) · Coverage.
Ayrıca her içgörünün **dayandığı kanıt satırları** tek tek görünür
(izlenebilirlik). Head unit'te filo zekâsı **üretilmez**; köprü yoksa ekran
`source = NONE` der.

### 4.10 Fleet Dashboard — 6 kart

Yeni İçgörüler · Trendler · Riskler · Öğrenme Durumu · Veri Kapsamı ·
**Bilinmeyenler**. Kanıt yoksa **boş pano değil, gerekçe** gösterilir.
Bilinmeyen değer `—` (asla `0`). Tek araçlı içgörü *"filo iddiası değil"*
olarak işaretlenir.

---

## 5. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Sonuç |
|---|---|
| PG — 054 Fleet Intelligence matrisi | **31/31 PASS** |
| PG — 053 DNA regresyonu | **25/25 PASS** |
| PG — 052 authentication regresyonu | **30/30 PASS** |
| PG — 051 · 050 · 049 presence zinciri | **22/22 · 27/27 · 20/20 PASS** |
| PG — 048 kimlik/atama (P0) regresyonu | **54/54 PASS** |
| PG — migration idempotens | 054 iki kez uygulandı, **temiz** |
| Vitest (kök) | **9490/9490 · 444 dosya** |
| Vitest (website) | **894/894 · 43 dosya** |
| TypeScript | **temiz** |
| Build | **başarılı (2 dk 10 sn)** |
| ESLint (değişen dosyalar) | **temiz** |

**054 matrisi (31 kontrol):** insight merge/dedupe (M1–M4) · kanıtsız içgörü
reddi (F1) · kanıt merge/replay/sayaç/boş-kanıt (E1–E4) · güven ve tek-araç
tavanı (C1–C3) · cross-tenant (X1–X2) · transfer (T1) · trend merge/min-veri/
tek-araç (TR1–TR4) · filo sapması (DR1) · sağlık merge/UNKNOWN/tek-puan-yok
(H1–H5) · kapsam (CV1) · mevcut katman regresyonu (R1–R3) · yetki (S1–S2).

Yeni kilitler: `fleetIntelligence.test.ts` **41 test** ·
`website/fleetIntelligenceView.test.ts` **14 test**.

### 5.1 Koşum sırasında bulunan ve düzeltilen bir kırılganlık

Tam suite koşumunda `maviOperator.test.ts` **"Test timed out in 5000ms"** ile
düştü (izole koşumda geçiyordu). Sebep ürün hatası değil: o blok her testte
ağır bir modül grafiğini `vi.doMock` + dinamik import ile yeniden yüklüyor ve
depo 444 test dosyasına çıkınca ilk import 5 sn'lik varsayılan sınırı aştı
(tam suitede import süresi ~172 sn). **Sınır bu blok için yükseltildi; iddia
aynen korundu** — kilit zayıflatılmadı. İki ardışık tam koşumda tekrarlandığı
için "flake" diye geçiştirilmedi, kaydedildi.

---

## 6. MEVCUT KATMANLARA DOKUNULMADI — KANIT

| # | Kapı | Nerede |
|---|------|--------|
| 1 | 054, `_trip_attribution_trigger` · `_resolve_*` · `_dna_*` fonksiyonlarını **yeniden tanımlamaz** | Migration gövdesi |
| 2 | Attribution gövdesinde `fleet_insight` geçerse migration **DÜŞER** | 054 doğrulama (e) |
| 3 | DNA birikimi fleet intelligence'a bağlanırsa migration **DÜŞER** | 054 doğrulama (e) |
| 4 | Presence · authentication otoriteleri ve DNA eşik kapısı **çağrılarak** sınandı | 054 doğrulama (e) · PG `R1`/`R2` |
| 5 | TS: DNA · trip · kimlik · doğrulama modülleri **import edilmez** | TS `H3` |
| 6 | 048–053 matrisleri 054 sonrası **yeniden koştu** | §5 |

---

## 7. BİLİNÇLİ OLARAK YAPILMAYANLAR

| Yapılmadı | Gerekçe |
|---|---|
| Akü ve bakım içgörüleri | **Kanıt kaynağı YOK** (§3.1). Sıcaklıktan bakım çıkarmak tahmindir. |
| Doğal dil / öneri / uyarı metni | **Görev gereği yasak.** Insight bir kanıt kümesidir; cümleyi Mavi kuracak. |
| Tek filo puanı | Altı ilgisiz gerçeği tek sayıya indirmek yanlış karar aldırır. |
| İçgörü ÜRETEN üretim işi (scheduler/worker) | Bu tur **altyapı** turudur: tablolar, kapılar ve kanıt sözleşmesi kuruldu; gerçek yolculukları tarayıp içgörü üreten periyodik iş **yazılmadı** (kanıt üretimi ayrı ve dikkatli tasarlanmalı). |
| Geriye dönük toplu içgörü üretimi | Geçmişi tek seferde "öğrenmiş" göstermek öğrenme yaşını yalan yapardı (DNA P1'deki aynı karar). |
| Kartların bir sayfaya yerleştirilmesi | Bileşen ve görünüm modeli hazır ve testli; yerleşim ürün kararıdır, mevcut sayfa düzenine dokunulmadı. |
| Head unit ↔ sunucu okuma köprüsü | Filo iddiası tek araçta üretilemez; köprü ayrı bir iştir (LAB dürüstçe `source=NONE` der). |

---

## 8. AÇIK BORÇLAR (kütüğe yazıldı)

| # | Borç | Kütük |
|---|------|-------|
| 1 | Filo zekâsı gerçek yolculuklarla hiç dolmadı | #257 |
| 2 | İçgörü üreten periyodik iş yok (tablolar boş kalır) | #258 |
| 3 | Akü/bakım tipleri için kanıt kaynağı yok (yapısal) | #259 |
| 4 | Dashboard kartları bir sayfaya yerleştirilmedi | #260 |
| 5 | Head unit ↔ sunucu okuma köprüsü yok | #261 |

---

## 9. DEĞİŞEN DOSYALAR

**Yeni**
- `supabase/migrations/20260801000054_fleet_intelligence_p1.sql`
- `supabase/verification/local_054_fleet_intelligence_p1.sql`
- `src/platform/fleet/fleetIntelligence.ts` · `fleetIntelligenceEngine.ts`
- `src/components/devtools/screens/FleetIntelligenceScreen.tsx`
- `src/__tests__/fleetIntelligence.test.ts`
- `website/src/lib/fleet/fleetIntelligenceView.ts`
- `website/src/components/dashboard/FleetIntelligenceCards.tsx`
- `website/src/__tests__/fleetIntelligenceView.test.ts`
- `docs/FLEET_INTELLIGENCE_ENGINE_P1_REPORT.md`

**Değişen**
- `src/platform/devtools/carosLabCatalog.ts` · `carosLabScreenMap.tsx` (yeni ekran)
- `src/__tests__/maviOperator.test.ts` (yalnız timeout sınırı — iddia korundu, §5.1)

---

## 10. SAHA DOĞRULAMA — NE GÖZLENMELİ

Gerçek filoda, gerçek yolculuklarla:

1. Tek araçtan gelen kanıtla üretilen içgörü **asla `HIGH`/`VERY_HIGH`
   olmamalı** ve `SINGLE_VEHICLE_ONLY` damgası taşımalı.
2. İkinci araç kanıtı eklenince damga **kalkmalı**.
3. Aynı yolculuk çevrimdışı kuyruktan tekrar yüklenince kanıt sayısı
   **artmamalı**.
4. Yakıt/rölanti filo genelinde artınca trend `RISING`, sapma `DRIFTING`
   olmalı ve kanıt kaç araçtan geldiğini **göstermeli**.
5. OBD kapsamı düşük filoda `unknownCount` **yüksek** kalmalı ve güven
   `LOW`'u aşmamalı.
6. Araç devredilince yeni kanıt eski şirkete **işlenmemeli**.
7. Akü ve bakım içgörüleri **hiç üretilmemeli** (kaynak yok).

Bu ölçütler gözlenene kadar `realVehicleValidationVerdict` =
**`BLOCKED_REAL_VEHICLE`**.
