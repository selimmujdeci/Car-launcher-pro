# CAROS PRO — MAVI REASONING ENGINE P1 RAPORU

**Tarih:** 2026-08-01
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Tek karar otoritesi — kanonik model · intent/evidence/decision/
confidence/conflict/expiry resolver'ları · karar zinciri · tekilleştirme ·
durum makinesi · CAROS LAB · Fleet Dashboard · gerçek PostgreSQL.
**LLM çağrısı yapıldı mı:** **HAYIR** (bağlayıcı — bkz. §2)
**AI Evidence Engine · Driver DNA · Fleet Intelligence · Trip Engine:**
**DEĞİŞTİRİLMEDİ**
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`MAVI_REASONING_ENGINE_P1_COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`MAVI_REASONING_ENGINE_P1_COMPLETE_LOCAL`** |
| `reasoningEngineRegressionVerdict` | **`ESTABLISHED`** (56/56 PG + 86 TS + 28 website kilidi) |
| `evidenceEngineRegressionVerdict` | **`PRESERVED`** (055 + 056 yeniden uygulandı, doğrulama blokları temiz) |
| `driverDNARegressionVerdict` | **`PRESERVED`** (053 temiz · `_dna_status` eşiği çağrılarak sınandı) |
| `fleetIntelligenceRegressionVerdict` | **`PRESERVED`** (054 temiz · `_fleet_insight_confidence` kapısı sınandı) |
| `tripRegressionVerdict` | **`PRESERVED`** (047 temiz · attribution zinciri değişmedi — 046 notu §7.1) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Karar omurgası gerçek araç verisiyle **hiç dolmadı**; tüm ölçümler elle
yazılmış kanıtlarla yapıldı. Kanıtsız `PASS` verilmedi.

---

## 2. "LLM KARAR VERMEZ" — NASIL GARANTİ EDİLDİ

Bu paketin tek cümlelik iddiası şudur: **bir karar, LLM kapalıyken de bit bit
aynı çıkmak zorundadır.** Yedi kapıyla kilitlendi:

| # | Kapı | Nerede |
|---|------|--------|
| 1 | Katmanda `fetch` · `openrouter` · `gemini` · `anthropic` · `openai` · `aiService` · `semanticAi` · `maviCore` · `aiCore` geçmesi **YASAK** | TS `M1` · website `E3` |
| 2 | **Karar bir CÜMLE DEĞİLDİR:** `title`/`message`/`explanation`/`summary`/`answer`/`recommendation`/`advice` alanı yok — DB'de bu kolonlar eklenirse migration **DÜŞER** | TS `M4` · 057 doğrulama (b) · PG `I5` |
| 3 | Gerekçe **bounded KOD**tur (`CONFIDENCE_REASONS`), serbest metin değil — cümleyi Mavi kurar, motor kodu verir | TS `A2` |
| 4 | Katman **saf**: I/O · `Date.now()` · timer · depolama · `supabase` · React YOK | TS `M2` |
| 5 | **Determinizm çağrılarak sınandı:** aynı defter + aynı istek → `toEqual` ile bit bit aynı karar; kanıt sırası kararı değiştirmiyor | TS `K1` · `K2` |
| 6 | Karar üretim fonksiyonunda dış çağrı deseni geçerse migration **DÜŞER** | 057 doğrulama (g) · PG `I6` |
| 7 | Website kart katmanı karar **üretmez**, sabit eşleme kullanır; bilinmeyen kod için tahmin yapılmaz | website `E1` · `E2` |

Üretilen şey bir cevap değil, **izlenebilir bir karardır**. LLM'in rolü
sözleşmeyle daraltıldı: MAVI'nin verdiği kararı doğal dile çevirmek.

---

## 3. ALTI SÖZLEŞME KURALI VE KANITLARI

### 3.1 Karar kanıtsız üretilemez

**"Veri yok, o hâlde sorun yok" bir karar DEĞİLDİR.** Kanıtı olmayan istek
`INSUFFICIENT_EVIDENCE` döner ve `state = UNKNOWN` olur; DB'de
`mr_evidence_when_conclusive` CHECK'i kanıtsız bir `SUPPORTED`/`UNSUPPORTED`
satırını **reddeder** (TS `E3` · PG `A1`/`A2`).

Kanıt bağı bir metin listesi değil, **gerçek yabancı anahtardır**
(`mavi_reasoning_evidence` → `ai_evidence`): var olmayan kanıta dayanan karar
yazılamaz (PG `A5`).

### 3.2 Güven istemciden alınamaz — ve formül KOPYALANMAZ

`_reasoning_confidence` üç tavanın en zayıfını alır ve **055'in fonksiyonlarını
çağırır** (`_evidence_weakest`, `_evidence_confidence`); formül SQL'e
kopyalanmaz — kopyalanırsa migration doğrulaması **düşer** (057 doğrulama (d)).
TS tarafında da `weakestEvidenceConfidence` ve `sampleConfidenceCeiling`
`aiEvidence`ten **ithal edilir** (TS `M5`).

| Girdi | Tavan |
|---|---|
| Kanıtların en zayıf güveni | doğrudan bağlar |
| Karara giren kanıt sayısı | 1 → `MEDIUM` · 2–4 → `HIGH` · 5+ → `VERY_HIGH` |
| Kapsam (beklenen kategorilerin kaçı var) | <%50 → `LOW` · <%80 → `MEDIUM` |

**Tek kanıtlı karar `MEDIUM`u aşamaz** (TS `F2` · PG `B2` · 057 doğrulama (d)).
Hiçbir adım güveni **yükseltemez** (TS `F6`). Sunucuda ayrıca: istemci elle
`VERY_HIGH` yazsa bile trigger onu **yok sayar ve yeniden türetir** (PG `I7`).

Sonuçlandırıcı **olmayan** karar daima `UNKNOWN` güven taşır — *"kararsızım
ama eminim"* olamaz (TS `F1`).

### 3.3 Çelişkili kanıtta karar üretilmez

İki kaynağın çeliştiği yerde birini seçmek uydurmaktır. Çelişki varsa karar
`CONFLICTED_EVIDENCE` olur ve `mr_no_conclusion_on_conflict` CHECK'i çelişkili
bir satırın sonradan `SUPPORTED` yapılmasını **reddeder** (PG `C3`, SQLSTATE
23514).

İki çelişki türü tanımlıdır:

| Tür | Anlamı |
|---|---|
| `VALUE_DIVERGENCE` | **Farklı** kaynaklar aynı metriği %10'dan fazla farklı ölçmüş |
| `REVISION_DIVERGENCE` | **Aynı** kaynağın iki revizyonu birden aktif — hangisi geçerli belli değil |

Eşik **sabittir ve çağıran gevşetemez** (TS `M6`): gevşetilebilir bir eşik,
çelişkiyi gizlemenin yolu olurdu. Küçük fark çelişki değil, ölçüm gürültüsüdür
(TS `D2` · PG `C4`). Ölçümü olmayan kanıt çelişemez — `null` bir değer değil,
bir boşluktur (TS `D3`).

### 3.4 Süresi dolmuş kanıt karara katılmaz, ama zincirden silinmez

Tüm eşleşen kanıtların süresi dolmuşsa karar `EXPIRED_EVIDENCE` olur
(TS `E4` · PG `D1`); süresi dolan kanıt **silinmez**, `EXPIRED` olur (PG `D2`).
Süresi dolan **kararın** kendisi de silinmez ve kanıt bağı korunur
(PG `D3`/`D5` · TS `I1`/`I4`). Süre dolumu **idempotenttir** — ikinci koşum
`0` döner (PG `D4` · TS `I2`).

### 3.5 Aynı karar iki kez üretilmez

Kimlik = **özne + niyet + kanıt imzası**. Zaman kimliğe dâhil değildir:
replay yeni karar açmaz, yalnız `duplicate_count` artar (PG `E1`/`E2` ·
TS `G2`). Kanıt kümesi değişirse imza değişir → bu **artık başka bir
karardır**, çünkü dayanağı başkadır (PG `E3` · TS `G3`). Tekilleştirme DB
seviyesinde kilitlidir: elle çift kayıt `unique_violation` alır (PG `E4`).

Kanıt imzası **sıradan bağımsız ve tekrarsızdır** — aksi hâlde replay her
seferinde "yeni" karar üretirdi (TS `G1`).

### 3.6 UNKNOWN gerçek bir karardır (fail-closed)

Niyet kesin çözülemezse motor **kura çekmez**: kategoriler birden fazla niyete
işaret ediyorsa `UNKNOWN` döner (TS `B3` · PG `B5`). Kategorisi `UNKNOWN` olan
kanıt niyet üretmez — bilinmeyenden bilgi çıkmaz (TS `B5`). Özne yoksa veya
başka şirkete aitse karar `REJECTED` olur ve satır **hiç açılmaz**
(PG `H1`–`H3`).

---

## 4. KARAR ZİNCİRİ VE DURUM MAKİNESİ

### 4.1 Zincir

`DECISION → EVIDENCE → FLEET_INSIGHT · DRIVER_DNA → TRIP → VEHICLE`

Zincir **uydurulmaz**, çözülür:

| Uç | Nereden çözülür |
|---|---|
| `EVIDENCE` | `mavi_reasoning_evidence` (gerçek FK) |
| `FLEET_INSIGHT` | `ai_evidence_chain` (`consumer = FLEET_INSIGHT`) — 056'nın kurduğu gerçek bağ |
| `DRIVER_DNA` | Kanıt `DRIVER_DNA` kaynaklıysa sürücünün `driver_dna` kaydı |
| `TRIP` · `VEHICLE` | Kanıtın kendi özneleri |

**Çözülemeyen uç YAZILMAZ** (PG `F3`: DNA kaydı olmayan fixture'da DNA düğümü
üretilmedi) ve okunamayan kanıt düğümü **gizlenmez**, `resolved: false` ile
görünür kalır (TS `J5`) — sessizce atlamak, zincirde delik olduğunu gizlemek
olurdu.

### 4.2 Durum makinesi

`NEW → ANALYZING → {SUPPORTED · UNSUPPORTED · UNKNOWN · CONFLICTED · REJECTED}`
→ (yalnız sonuçlanmışlardan) `EXPIRED`

- **Analiz edilmeden karar olmaz:** `NEW → SUPPORTED` kestirmesi yoktur
  (TS `H1` · 057 doğrulama (c)). Sunucudaki `mavi_reason` bu yürüyüşü
  **gerçekten adım adım koşar**; her adım geçiş kapısından geçer.
- **Sonuçlanmış karar sessizce değiştirilemez** (PG `G1`).
- `REJECTED` ve `EXPIRED` **mutlak terminaldir**: reddedilmiş karar sonradan
  doğru olamaz, süresi dolmuş karar diriltilemez (PG `G2` · TS `H4`).
- Geçiş kapısı TS ve SQL'de **aynı kuralı** uygular; ikinci bir durum makinesi
  yoktur.

---

## 5. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Sonuç |
|---|---|
| **PG — 057 Reasoning Engine matrisi** | **56/56 PASS** (`supabase/tests/057_mavi_reasoning_matrix.sql` — depoda **kalıcı**, tekrar koşulabilir) |
| PG — 057 migration doğrulaması | **OK** · üç kez uygulandı, **idempotent** |
| PG — 055 Evidence Engine + 056 wiring regresyonu | **OK** (doğrulama blokları temiz) |
| PG — 054 Fleet Intelligence · 053 Driver DNA regresyonu | **OK** |
| PG — 052 · 051 · 050 · 049 · 048 · 047 regresyonu | **hata yok** |
| PG — 046 Trip Engine | **1 hata** — bu paketten bağımsız (§7.1) |
| Vitest (kök) | **9647/9649 · 445/447 dosya** (§7.2) |
| Vitest — `maviReasoning.test.ts` | **86/86 PASS** |
| Vitest (website) | **942/942 · 45 dosya** |
| Vitest — `reasoningView.test.ts` | **28/28 PASS** |
| TypeScript (kök · website) | **temiz** |
| Build (kök) | **başarılı (5 dk 19 sn)** |
| Build (website) | **14 sayfa prerender hatası** — bu paketten bağımsız (§7.3) |
| ESLint (değişen dosyalar) | **temiz** |

**057 matrisi (56 kontrol):** kanıt çözümü (A1–A6) · karar çözücü (B1–B8) ·
çelişki (C1–C4) · süre dolumu (D1–D5) · replay/tekilleştirme (E1–E4) ·
karar zinciri (F1–F5) · durum makinesi (G1–G4, G3b) · cross-tenant · sahiplik ·
devir (H1–H7) · fail-closed ve yetki (I1–I7) · mevcut katman regresyonu
(J1–J5).

### 5.1 Doğrulama sırasında bulunan GERÇEK kusur (test artefaktı değil)

İlk koşumda `G3` düştü ve bu **ürünün kendi kusuruydu**:

> `_mavi_reasoning_state_guard` geçersiz geçişte önce
> `invalid_transition_count` sayacını artırıyor, sonra `RAISE EXCEPTION`
> atıyordu. **Exception işlemi geri alır — sayaç artışı da geri alınır.**
> Yani "geçersiz geçiş sessizce yutulmaz, sayılır" iddiası **fiilen
> çalışmıyordu**: sayaç hiçbir zaman artamazdı.

*"Sayıyorum" demek ama saymamak, sessiz yutmanın en kötü türüdür.*

**Düzeltme:** sayaç trigger'dan çıkarıldı; geçişi bir alt-işlemde deneyen ve
reddedilirse hatayı **yakalayıp sayacı kalıcı olarak artıran**
`mavi_reasoning_transition(uuid, text)` sarmalayıcısı eklendi. Trigger yine de
doğrudan `UPDATE`'leri reddeder (savunma derinliği). `G3` artık sarmalayıcı
üzerinden sınanıyor, `G3b` ise geçerli bir geçişin sayacı **artırmadığını**
kanıtlıyor.

### 5.2 Doğrulama kapısının daraltılması (aşırı geniş kilit)

057'nin ilk hâlinde "tek veri kapısı" doğrulaması `vehicle_trips` ve
`driver_dna` okunmasını da yasaklıyordu ve migration düştü. Bu **kilit
yanlıştı**: karar **girdisi** ile özne **doğrulaması** aynı şey değildir.

Kapı doğru şeye odaklandı: `vehicles` · `fleet_drivers` · `vehicle_trips`
yalnız **cross-tenant** kapısında, `driver_dna` · `ai_evidence_chain` yalnız
**zincir ucu** çözümünde okunur. Yasak liste artık gerçek "paralel motor"
işaretleridir (`fleet_insight_evidence` · `driver_dna_trip` · `fleet_trend` ·
`fleet_health` · `deep_scan`) ve ayrıca karar, **başka bir karar otoritesine
devredemez** (`_dna_status` · `_fleet_insight_confidence` · `_resolve_driver_*`
çağrılamaz).

---

## 6. TENANT · SAHİPLİK · DEVİR

| Kontrol | Sonuç |
|---|---|
| Başka şirketin aracı/sürücüsü için karar | **REJECTED** (PG `H1`/`H2`) |
| Öznesiz istek | **REJECTED** (PG `H3`) |
| Reddedilen istek sayılıyor mu | **evet** (PG `H4`) — sessiz yutma yok |
| Araç devrinde devralan şirket eski kanıtı görüyor mu | **HAYIR** → `INSUFFICIENT_EVIDENCE` (PG `H5`) |
| Devirde eski şirketin kararı/kanıtı siliniyor mu | **HAYIR** (PG `H6`) — geçmiş açıklanabilir kalır |
| Devirden sonra eski şirket yeni karar üretebiliyor mu | **HAYIR** → REJECTED (PG `H7`) |
| `anon` karar tablolarını okuyabiliyor mu | **HAYIR** (PG `I1`) |
| `authenticated` karar yazabiliyor mu | **HAYIR** (PG `I2`) — yazılabilseydi karar olmaktan çıkardı |
| İstemci karar **tetikleyebiliyor** mu | **HAYIR** (PG `I3`) — `mavi_reason` yalnız `service_role` |
| Oturumsuz okuma | **BOŞ** (PG `I4`) — fail-closed |

---

## 7. BU PAKETTEN BAĞIMSIZ, ÖNCEDEN VAR OLAN BULGULAR

Bunlar bu turda **düzeltilmedi** (kapsam dışı) ama gizlenmedi de.

### 7.1 Migration 046 tek başına yeniden uygulanamıyor

`20260730000046_fleet_trip_engine_p1.sql` ikinci kez koşturulunca
`cannot change return type of existing function` verir. Sebep: **047**,
`list_vehicle_trips(uuid,integer)` fonksiyonunu `DROP` edip genişletiyor
(047:391). Yani 046'yı 047'den *sonra* tekrar koşmak her koşulda düşer.

057 bu fonksiyona **hiç dokunmuyor** (dosyada `list_vehicle_trips` geçmiyor —
0 eşleşme). İleri yönlü uygulamada (046 → 047) sorun yoktur. Kütük #274.

### 7.2 `regression.guards.test.ts` içinde bir kilit zaman aşımına uğruyor

`_hasAnyField` kilidi `await import('../platform/vehicleDataLayer/index')`
yapıyor ve bu ağır modülün ilk derlenmesi varsayılan **5 sn**'yi aşıyor.
`--testTimeout=30000` ile **163/163 PASS**. Bu paket `vehicleDataLayer`'ı ne
import ediyor ne de değiştiriyor; yeni modüller (`src/platform/reasoning/*`)
yalnız lazy LAB ekranından ve testten çağrılıyor. Kütük #275.

### 7.3 Website prod build'inde 14 dashboard sayfası prerender'da düşüyor

Hata: `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY`
(`website/src/security/accountCleanup/accountCleanupRuntime.ts:291`) — tarayıcı-
yalnız bir runtime SSR prerender sırasında çağrılıyor.

**Bu paketten bağımsız olduğunun kanıtı:** hiç dokunulmayan
`/dashboard/diagnostic` · `/dashboard/map` · `/dashboard/settings` ·
`/dashboard/vehicles` · `/dashboard` dâhil **13 sayfa aynı digest ile**
(`129092738`) düşüyor; ortak kök `dashboard/layout.tsx`'in paylaşıldığı
istemci ağacıdır. Kütük #276.

> ⚠️ Bu doğrulama için koşulan `next build`, `website/.next` dizinini prod
> çıktısıyla **ezdi**. Dev sunucusu çalıştırılacaksa `.next` yeniden
> üretilmelidir (bilinen tuzak).

### 7.4 Kanıt kartları hâlâ hiçbir sayfaya bağlı değil (055/056'dan kalan borç)

`EvidenceCoverageCards` ve `SubjectEvidenceList` bileşenleri yazıldı ama
**hiçbir sayfa onları import etmiyor** — yani kanıt omurgasının Fleet
Dashboard gözlem yüzeyi fiilen **yok**. Bu paket bu hatayı tekrarlamadı:
`ReasoningCards` `/dashboard/fleet/lab` sayfasına **gerçekten bağlandı** ve
bağlılık testle kilitlendi (website `E6`). Kütük #277.

---

## 8. GÖZLEMLENEBİLİRLİK (yedi şart)

| # | Şart | Durum |
|---|------|-------|
| 1 | Özellik uygulandı | ✅ `maviReasoning.ts` · `maviReasoningEngine.ts` · migration 057 |
| 2 | CAROS LAB salt-okunur ekran | ✅ `MaviReasoningEngineScreen` (AI kategorisi, `AVAILABLE`) |
| 3 | Gerçek veri kaynağı | ✅ `readMaviReasoning` — sabit/örnek veri YOK; köprü yoksa dürüstçe boş |
| 4 | LAB aktif komut göndermiyor | ✅ TS `M7` (timer · abonelik · `fetch` · karar üretimi yok) |
| 5 | Kanıtsız bilgi üretilmiyor | ✅ karar yoksa yaş `null`, kapsam `null` — sahte `0` YOK |
| 6 | Gizli veri taşınmıyor | ✅ ad · plaka · VIN · konum yok; yalnız `veh:xxxxxxxx` ve bounded kod (website `D4`) |
| 7 | Unit test + kütük maddesi | ✅ 86 + 28 test · kütük #272–#278 |

**Fleet Dashboard:** `ReasoningCards` — Son Kararlar · Karar Güveni · Kanıt
Durumu · Çakışmalar · Bilinmeyenler (beş kart, hepsi salt-okunur, aktif komut
yok — website `E5`).

---

## 9. BİLİNÇLİ OLARAK YAPILMAYANLAR

| # | Yapılmadı | Neden |
|---|---|---|
| 1 | Karar üretimini otomatik tetikleyen trigger/zamanlayıcı | Bu paket **karar sözleşmesini** kurar; hangi olayın karar tetikleyeceği ayrı bir wiring paketidir (056'nın adaptör deseniyle). |
| 2 | Head unit'te karar üretimi | Karar şirket geneli sorgulanır ve kanıt omurgasının yanında durmalıdır; cihaz belleğinde tutulamaz. Cihaz deposu **bilinçli olarak boştur** ve LAB bunu dürüstçe söyler. |
| 3 | Mevcut AI yüzeylerinin (Mavi konsolu, AI Mechanic…) bu motora bağlanması | Sözleşme kuruldu; **bağlama ayrı ve atomik** bir iştir. Şu an ikinci bir karar otoritesi *yasaklandı* ama mevcut yüzeyler henüz taşınmadı — bu **açık borçtur** (kütük #278). |
| 4 | Serbest metinden niyet çıkarma | Metinden niyet üretmek LLM işidir; bu katmanda LLM yoktur. Niyet ya açıkça verilir ya kanıt kategorisinden **tek aday** olarak türetilir. |
| 5 | `SUPPORTED`/`UNSUPPORTED` dışında aksiyon kararı | Aksiyon Vehicle Brain'in işidir. Bu motor "kanıt ne diyor" sorusunu cevaplar, "ne yapalım" sorusunu değil. |
| 6 | Gerçek araç doğrulaması | Cihaz/araç yok — `BLOCKED_REAL_VEHICLE`. |

---

## 10. EN ÖNEMLİ MİMARİ KURAL (bundan sonrası için)

> **CAROS PRO içinde hiçbir yeni AI özelliği kendi karar mantığını yazamaz.**

AI Mechanic · Driver Coach · Fleet Advisor · Predictive Maintenance ·
Trip Advisor · Diagnostic Advisor · Repair Advisor · Service Advisor ·
AI Negotiator · Vehicle Health Advisor — **tamamı** kararı MAVI Reasoning
Engine üzerinden üretmek zorundadır.

Bu kural şu an **üç yerde kilitli**: migration 057 doğrulaması (karar başka
otoriteye devredemez), TS import kilidi (`M3` — motor yalnız kanıt omurgasını
okur) ve website kilidi (`E2` — görünüm katmanı karar üretmez). Mevcut
yüzeylerin taşınması ayrı bir pakettir ve borç olarak yazıldı.

---

## 11. SONRAKİ ATOMİK PR ÖNERİSİ

**`PR-REASON-2 · REASONING PRODUCTION WIRING`** — 056'nın adaptör desenini
birebir izleyerek:

1. Kanıt yazıldığında/tazelendiğinde ilgili özne için karar üretimini
   tetikleyen **tek kanonik yol** (hata yalıtımı + sınırlı retry + adaptör
   durumu).
2. `expire_mavi_reasoning()` için zamanlanmış koşum.
3. Mevcut AI yüzeylerinden **birinin** (öneri: Vehicle Health Advisor) karar
   mantığının bu motora taşınması — ikinci otoritenin fiilen kaldırıldığının
   ilk kanıtı.
4. Gerçek araç/filo verisiyle ilk `SUPPORTED` kararın gözlenmesi →
   kütük #272'nin 🟢'ye taşınması.
