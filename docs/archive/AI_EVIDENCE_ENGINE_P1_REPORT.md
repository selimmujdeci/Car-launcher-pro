# CAROS PRO — AI EVIDENCE ENGINE P1 RAPORU

**Tarih:** 2026-08-01
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Tek otoriteli, kanıta dayalı, açıklanabilir AI Evidence Engine —
kanonik model · kaynak/kategori sözleşmesi · güven türetimi · birleştirme ·
süre · değişmezlik · kanıt zinciri · kapsam · CAROS LAB · Fleet Dashboard ·
gerçek PostgreSQL.
**AI cevabı üretildi mi:** **HAYIR** (bağlayıcı — bkz. §2)
**Driver DNA · Fleet Intelligence · Trip Engine · Deep Scan:** **DEĞİŞTİRİLMEDİ**
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `driverDNARegressionVerdict` | **`PRESERVED`** (25/25) |
| `fleetIntelligenceRegressionVerdict` | **`PRESERVED`** (31/31) |
| `tripRegressionVerdict` | **`PRESERVED`** (P0 54/54 · attribution zinciri değişmedi) |
| `evidenceEngineRegressionVerdict` | **`ESTABLISHED`** (38/38 PG + 46 TS + 14 website kilidi) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Kanıt omurgası gerçek araç verisiyle **hiç dolmadı**; tüm ölçümler elle
yazılmış kanıtlarla yapıldı. Kanıtsız `PASS` verilmedi.

---

## 2. "BU PAKET AI CEVABI ÜRETMEYECEK" — NASIL GARANTİ EDİLDİ

Beş kapıyla kilitlendi:

| # | Kapı | Nerede |
|---|------|--------|
| 1 | Katmanda `fetch` · `openrouter` · `gemini` · `anthropic` · `openai` · `llm` · `aiService` · `semanticAi` geçmesi **YASAK** | TS `I1` · website `C1` |
| 2 | **Kanıt bir CÜMLE DEĞİLDİR:** `title`/`message`/`explanation`/`summary`/`answer`/`text` alanı yok — DB'de bu kolonlar eklenirse migration **DÜŞER** | TS `A2` · 055 doğrulama (b) |
| 3 | Katman **saf**: I/O · `Date.now()` · timer · depolama · `supabase` YOK | TS `I2` · website `C3` |
| 4 | DNA · Fleet Intelligence · trip · deep scan modülleri **import edilmez** | TS `I3` |
| 5 | Website'te öneri/tavsiye alanı üretilmez | website `C2` |

Üretilen şey bir cevap değil, **izlenebilir kanıt omurgasıdır**. `AI_ANSWER`
bilinçli olarak zincirin tüketici listesindedir: **gelecekte Mavi'nin ürettiği
her cümle buraya bir bağ yazmak zorunda kalacak.** Kanıt bağı olmayan bir AI
çıktısı, sistemin açıklayamayacağı bir iddiadır.

---

## 3. BEŞ SÖZLEŞME KURALI VE KANITLARI

### 3.1 Kaynaksız kanıt `ACTIVE` olamaz

`SOURCE_UNKNOWN` listede vardır (sistemin kendi iç hatasını kaydedebilmek
için) ama **asla geçerli olamaz**: DB CHECK `ae_source_known_when_active`
reddeder, TS `canActivate` reddeder (TS `B1` · PG `F1`).

Aynı kapı **öznesiz** (`NO_SUBJECT`) ve **ölçümsüz** (`NO_MEASUREMENT`)
kayıtlar için de çalışır. Reddedilen kayıt **silinmez, saklanır** — "kanıt
üretmeyen modül" ile "kanıtı reddedilen modül" ayırt edilebilsin (TS `B4` ·
PG `F4`).

### 3.2 Güven kanıttan bağımsız yazılamaz

`EvidenceInput` sözleşmesinde **`confidence` alanı YOKTUR** (TS `C1`).
Güven daima üç tavanın en zayıfından türetilir:

| Girdi | Tavan |
|---|---|
| Kaynak | `BLACKBOX`/`DEEP_SCAN`/`VEHICLE_IDENTITY` → `VERY_HIGH` · `TELEMETRY`/`TRIP_ENGINE`/`DRIVER_DNA`/`FLEET_INTELLIGENCE` → `HIGH` · `HEALTH_MONITOR` → `MEDIUM` |
| Ölçüm kalitesi | `MEASURED` → `VERY_HIGH` · `DERIVED` → `HIGH` · `ESTIMATED` → `MEDIUM` · `UNKNOWN` → `UNKNOWN` |
| Örnek sayısı | 0 → `UNKNOWN` · **1 → `MEDIUM`** · 2–4 → `HIGH` · 5+ → `VERY_HIGH` |

**Tek gözlem `MEDIUM`u aşamaz** — bir kez görülen şey bir eğilim değildir
(TS `C3` · PG `C3`). Sunucuda ayrıca: istemci elle `VERY_HIGH` yazsa bile
trigger onu **yok sayar ve yeniden türetir** (PG `C2`).

### 3.3 Birleştirme — aynı kanıt ikinci kez açılmaz

Kimlik `(company, source, category, metric, vehicle, driver, trip)`;
**zaman kimliğe dâhil değildir** — aksi hâlde her tazeleme yeni bir "kanıt"
üretir ve sayılar şişerdi (TS `D4`).

- 5 tekrar → **1 kayıt**, `refreshCount = 5` (TS `D1` · PG `M3`/`M4`).
- **İlk kanıt zamanı korunur** (TS `D2` · PG `M5`).
- Reddedilen bir tekrar, mevcut geçerli kanıtı **bozmaz** (TS `D5`).

### 3.4 Süre dolumu — silmez

Süresi dolan kanıt `EXPIRED` olur ve **silinmez**: geçmiş bir iddianın
dayanağı yok edilirse o iddia açıklanamaz hâle gelir (TS `E1` · PG `E2`).
Expiry **idempotenttir** (TS `E2` · PG `E3`); yeni bir gözlem kanıtı
canlandırır ama **doğuş anı ve kimliği aynı kalır** (TS `E4` · PG `E4`).

### 3.5 Değişmezlik

Özne · kaynak · kategori · metrik · doğuş anı · şema sürümü **asla
değiştirilemez** (DB trigger + TS `validateEvidenceMutation`). Ayrıca
**kaynak modül kilidi**: bir modül **başkasının kanıtını değiştiremez**
(TS `F3`) — aksi hâlde kanıt zinciri anlamsızlaşır.

---

## 4. KANIT ZİNCİRİ VE KAPSAM

**Zincir:** `ai_evidence_chain (evidence_id, consumer, consumer_id)` —
birincil anahtar aynı zamanda idempotens kilididir. `get_evidence_chain()`
ile "tek tıkla" bir çıktının dayandığı kanıtlar okunur; ters yön
(`consumersOfEvidence`) bir kanıtın beslediği çıktıları verir (etki analizi).
**Var olmayan kanıta bağ kurulamaz** (TS `G3` · PG `CH3`) — bağ
kurulabiliyorsa kanıt gerçekten vardır.

**Kapsam:** şirket/araç/sürücü/yolculuk başına beklenen kategoriler sabittir
ve **gerçeğe göre aşağı çekilmez** ("zaten sıcaklık verimiz yok, beklemeyelim"
demek eksikliği görünmez yapardı — TS `H5`). Kanıt yoksa oran **`null`**
(0 DEĞİL) ve güven `UNKNOWN`; eksik kategoriler **tek tek listelenir**
(TS `H1`/`H2`).

---

## 5. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Sonuç |
|---|---|
| PG — 055 Evidence Engine matrisi | **38/38 PASS** |
| PG — 054 Fleet Intelligence regresyonu | **31/31 PASS** |
| PG — 053 DNA regresyonu | **25/25 PASS** |
| PG — 052 · 051 · 050 · 049 presence/auth zinciri | **30/30 · 22/22 · 27/27 · 20/20 PASS** |
| PG — 048 kimlik/atama (P0) regresyonu | **54/54 PASS** |
| PG — migration idempotens | 055 iki kez uygulandı, **temiz** |
| Vitest (kök) | **9536/9536 · 445 dosya** |
| Vitest (website) | **908/908 · 44 dosya** |
| TypeScript | **temiz** |
| Build | **başarılı (2 dk 6 sn)** |
| ESLint (değişen dosyalar) | **temiz** |

**055 matrisi (38 kontrol):** merge/refresh/ilk-zaman (M1–M6) · güven
türetimi ve elle yazma reddi (C1–C3) · fail-closed kapılar (F1–F4) ·
değişmezlik (I1–I4) · cross-tenant (X1–X2) · transfer (T1) · zincir
(CH1–CH4, `AI_ANSWER` dâhil) · süre dolumu ve idempotens (E1–E4) · kapsam ve
bütünlük (CV1–CV4) · mevcut katman regresyonu (R1–R4) · yetki (S1–S2).

Yeni kilitler: `aiEvidence.test.ts` **46 test** ·
`website/evidenceCoverageView.test.ts` **14 test**.

### 5.1 Doğrulama sırasında bulunan üç test artefaktı (ürün hatası değil)

İlk koşumda üç kontrol düştü ve **hepsi testin kendi kusuruydu**; ürün
davranışı doğruydu:

1. **`last_seen` ilerlemedi** — PostgreSQL'de `now()` bir işlem içinde
   **sabittir**; donmuş saatle "ilerleme" ölçülemez. Test artık ilk kanıtı
   bilinçli olarak geçmiş bir gözlem anıyla yazıyor.
2. **`created_at` değiştirilebildi** — aynı işlemde `now()` = `created_at`
   olduğu için `NEW`/`OLD` eşitti, trigger haklı olarak ihlal görmedi. Test
   artık gerçekten farklı bir değer deniyor.
3. **`ae_expiry_valid` ihlali** — mevcut kaydın süresi geriye çekilemez
   (kısıt doğru). Test artık süre dolumu için 40 gün önce gözlenmiş, 1 gün
   ömürlü ayrı bir kanıt kullanıyor.

Ayrıca `get_evidence_coverage()` içinde OUT parametre adı (`company_id`)
tablo kolonuyla çakıştı; `#variable_conflict use_column` ile çözüldü.
Bunlar "flake" diye geçiştirilmedi, kaydedildi.

---

## 6. MEVCUT KATMANLARA DOKUNULMADI — KANIT

| # | Kapı | Nerede |
|---|------|--------|
| 1 | 055, `driver_dna*` · `fleet_insight*` · `_trip_attribution_trigger` · `_resolve_*` fonksiyonlarını **yeniden tanımlamaz** | Migration gövdesi |
| 2 | Attribution gövdesinde `ai_evidence` geçerse migration **DÜŞER** | 055 doğrulama (d) |
| 3 | DNA birikimi veya Fleet Intelligence kanıt omurgasına bağlanırsa migration **DÜŞER** | 055 doğrulama (d) |
| 4 | Presence resolver · DNA eşik kapısı · FI güven kapısı **çağrılarak** sınandı | 055 doğrulama (d) · PG `R1`–`R3` |
| 5 | TS: DNA · FI · trip · deep scan modülleri **import edilmez** | TS `I3` |
| 6 | 048–054 matrisleri 055 sonrası **yeniden koştu** | §5 |

---

## 7. BİLİNÇLİ OLARAK YAPILMAYANLAR

| Yapılmadı | Gerekçe |
|---|---|
| Kanıt ÜRETEN entegrasyon (DNA/FI/trip → evidence) | Bu tur **omurga** turudur. Üretimi bağlamak, her kaynağın hangi metriği hangi provenance ile sunacağının ayrı ayrı tasarlanmasını gerektirir; yanlış kanıt üreten bir bağlantı tüm omurgayı yalancı yapar. |
| AI cevabı / doğal dil | **Görev gereği yasak.** Cümleyi Mavi kuracak; omurga ona kanıt verir. |
| Geriye dönük toplu kanıt üretimi | Geçmişi tek seferde "kanıtlanmış" göstermek, kanıt yaşını ve güvenini yalan yapardı. |
| Kartların bir sayfaya yerleştirilmesi | Bileşen ve görünüm modeli hazır ve testli; yerleşim ürün kararıdır. |
| Head unit ↔ sunucu okuma köprüsü | Kanıt şirket geneli sorgulanır; köprü ayrı bir iştir (LAB dürüstçe `source=NONE` der). |
| Periyodik `expire_ai_evidence()` çağrısı | Fonksiyon hazır ve idempotent; zamanlayıcı **yazılmadı** (#243'teki aynı borç deseni). |

---

## 8. AÇIK BORÇLAR (kütüğe yazıldı)

| # | Borç | Kütük |
|---|------|-------|
| 1 | Kanıt omurgası gerçek veriyle hiç dolmadı | #262 |
| 2 | Kanıt üreten entegrasyon yok (tablolar elle doluyor) | #263 |
| 3 | `expire_ai_evidence()` çağıran zamanlayıcı yok | #264 |
| 4 | Kanıt kartları bir sayfaya yerleştirilmedi | #265 |
| 5 | Head unit ↔ sunucu okuma köprüsü yok | #266 |

---

## 9. DEĞİŞEN DOSYALAR

**Yeni**
- `supabase/migrations/20260801000055_ai_evidence_engine_p1.sql`
- `supabase/verification/local_055_ai_evidence_engine_p1.sql`
- `src/platform/fleet/aiEvidence.ts` · `aiEvidenceEngine.ts`
- `src/components/devtools/screens/AiEvidenceEngineScreen.tsx`
- `src/__tests__/aiEvidence.test.ts`
- `website/src/lib/fleet/evidenceCoverageView.ts`
- `website/src/components/dashboard/EvidenceCoverageCards.tsx`
- `website/src/__tests__/evidenceCoverageView.test.ts`
- `docs/AI_EVIDENCE_ENGINE_P1_REPORT.md`

**Değişen**
- `src/platform/devtools/carosLabCatalog.ts` · `carosLabScreenMap.tsx` (yeni ekran)

---

## 10. SAHA DOĞRULAMA — NE GÖZLENMELİ

Gerçek araç ve gerçek filo verisiyle:

1. Aynı kanıt tekrar geldiğinde **yeni kayıt açılmamalı**; `refreshCount`
   artmalı ve **ilk kanıt zamanı değişmemeli**.
2. `HEALTH_MONITOR` kaynaklı kanıt **asla `HIGH`/`VERY_HIGH` olmamalı**.
3. Tek gözleme dayanan kanıt **`MEDIUM`u aşmamalı**.
4. Kaynağı bilinmeyen kayıt **`ACTIVE` olmamalı** ve gerekçesiyle görünmeli.
5. Süresi dolan kanıt **silinmemeli**, `EXPIRED` olmalı; sonra gelen yeni
   gözlem onu canlandırmalı ama doğuş anı değişmemeli.
6. Bir içgörü/DNA kaydı için **zincir okunduğunda** dayandığı kanıtlar tek
   tek görünmeli.
7. Araç devredilince eski şirkete **yeni kanıt yazılamamalı**.
8. Kanıtı olmayan araç sayısı Fleet Dashboard'da **görünmeli** (gizlenmemeli).

Bu ölçütler gözlenene kadar `realVehicleValidationVerdict` =
**`BLOCKED_REAL_VEHICLE`**.
