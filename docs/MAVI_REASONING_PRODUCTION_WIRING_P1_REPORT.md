# CAROS PRO — MAVI REASONING PRODUCTION WIRING P1 RAPORU

**Tarih:** 2026-08-01
**Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** 057'nin karar motorunu gerçek ürün akışına bağlama — 12 gerçek
olay · bounded dedupe · dispatcher · resolver'lar · hata yalıtımı · kuyruk ·
CAROS LAB · Fleet Dashboard · paralel karar otoritesi taraması.
**LLM çağrısı yapıldı mı:** **HAYIR**
**Evidence Engine · Driver DNA · Fleet Intelligence · Trip Engine:**
**DEĞİŞTİRİLMEDİ**
**Commit / push / deploy / db push:** **YAPILMADI**

---

## 1. NİHAİ KARAR

### **`COMPLETE_LOCAL`**

| Kapı | Karar |
|------|-------|
| **Ana karar** | **`COMPLETE_LOCAL`** |
| `productionWiringVerdict` | **`ESTABLISHED`** (47/47 PG + 40 TS + 12 website kilidi · uçtan uca kanıtlandı) |
| `reasoningEngineRegressionVerdict` | **`PRESERVED`** (057 doğrulaması temiz · 86 TS kilidi geçti · karar mantığı değişmedi) |
| `evidenceEngineRegressionVerdict` | **`PRESERVED`** (055 + 056 temiz · `_evidence_adapter_record` karar omurgasına bağlanmadı) |
| `driverDNARegressionVerdict` | **`PRESERVED`** (053 temiz · `_dna_status` eşiği çağrılarak sınandı) |
| `fleetRegressionVerdict` | **`PRESERVED`** (054 temiz · `_fleet_insight_confidence` kapısı sınandı) |
| `realVehicleValidationVerdict` | **`BLOCKED_REAL_VEHICLE`** |
| `productionValidationVerdict` | **`NOT_VALIDATED`** |

Üretim akışı **gerçek araç verisiyle hiç çalışmadı**; tüm ölçümler elle
yazılmış fixture'larla yapıldı. Kanıtsız `PASS` verilmedi.

---

## 2. HEDEF GERÇEKLEŞTİ Mİ — TEK CÜMLELİK CEVAP

**Evet, yerel PostgreSQL'de kanıtlandı:** karar üretimi artık elle çağrılan
bir fonksiyon değildir. Aşağıdaki koşum **hiçbir `mavi_reason` çağrısı
içermez**:

```sql
-- Sadece kanıt yaz ve yolculuk kapat:
PERFORM public._ai_evidence_record(ca,'TELEMETRY','TEMPERATURE','coolant.max_c',
  va,NULL,NULL,'CRITICAL','MEASURED',121,6);
INSERT INTO public.vehicle_trips (vehicle_id, trip_key, started_at, ended_at)
  VALUES (va,'smoke-trip', now()-interval '2 hours', now()-interval '1 hour');
```

Sonuç (elle hiçbir karar tetiklenmeden):

| event_type | intent | resolver | state | result |
|---|---|---|---|---|
| `TRIP_COMPLETED` | `TRIP_STATUS` | `TRIP` | `COMPLETED` | `RECORDED` |
| `EVIDENCE_ADDED` | `TEMPERATURE` | `VEHICLE` | `COMPLETED` | `RECORDED` |

| intent | decision | confidence | evidence_count |
|---|---|---|---|
| `TEMPERATURE` | **`UNSUPPORTED`** | `MEDIUM` | 1 |
| `TRIP_STATUS` | `INSUFFICIENT_EVIDENCE` | `UNKNOWN` | 0 |

İkinci satır da doğrudur ve önemlidir: o yolculuk için `TRIP` kategorisinde
kanıt yoktu, motor **"sorun yok" demedi** — "kanıt yetersiz" dedi.

---

## 3. BAĞLANAN 12 GERÇEK OLAY

| # | Olay | Kaynak (trigger) | Niyet | Resolver | Dispatch |
|---|---|---|---|---|---|
| 1 | `TRIP_COMPLETED` | `vehicle_trips` (`ended_at`, `revision`) | `TRIP_STATUS` | TRIP | senkron |
| 2 | `DRIVER_DNA_UPDATED` | `driver_dna` | `DRIVER` | DRIVER | senkron |
| 3 | `FLEET_INSIGHT_CREATED` | `fleet_insight` (`state=ACTIVE`) | `FLEET` | FLEET | senkron |
| 4 | `VEHICLE_IDENTITY_CHANGED` | `vehicle_identity` | `VEHICLE_HEALTH` | VEHICLE | senkron |
| 5 | `VEHICLE_CONNECTIVITY_CHANGED` | `vehicles.last_seen` | `CONNECTIVITY` | VEHICLE | **kuyruk** |
| 6 | `LOCATION_STATE_CHANGED` | `vehicle_locations` | `LOCATION` | TRIP | **kuyruk** |
| 7 | `DRIVER_AUTHENTICATION_CHANGED` | `vehicle_driver_authentication` | `DRIVER` | DRIVER | senkron |
| 8 | `DRIVER_PRESENCE_CHANGED` | `vehicle_driver_presence` | `DRIVER` | DRIVER | senkron |
| 9 | `HEALTH_SNAPSHOT_UPDATED` | `fleet_health` | `FLEET` | FLEET | senkron |
| 10 | `EVIDENCE_ADDED` | `ai_evidence` INSERT (`ACTIVE`) | kanıt kategorisinden | değişken | senkron |
| 11 | `EVIDENCE_EXPIRED` | `ai_evidence` → `EXPIRED` | kanıt kategorisinden | değişken | senkron |
| 12 | `EVIDENCE_RETRACTED` | `ai_evidence` → `SUPERSEDED`/`REJECTED` | kanıt kategorisinden | değişken | senkron |

### 3.1 Neden iki olay kuyruğa alınıp senkron işlenmiyor (§ HOT-PATH)

`last_seen` telemetriyle saniyede bir güncellenebilir; konum akışı da öyle.
**Bunların hepsini senkron karar üretimine bağlamak CLAUDE.md'nin performans
bütçesini ihlal ederdi** ("ağır analiz hot-path'e ASLA girmez"). İki koruma
uygulandı:

1. **Gerçek durum geçişi kapısı:** olay yalnız araç **10 dakika sessiz
   kaldıktan sonra** geri döndüğünde (ya da ilk konum geldiğinde) üretilir.
   Eşik sabittir ve çağıran gevşetemez. (PG `C6`: art arda gelen tazeleme
   yeni olay üretmedi.)
2. **`p_dispatch_now = false`:** olay gerçek ve otomatik olarak kuyruğa girer,
   işlenmesi koşucuya bırakılır — telemetri yolu karar beklemez.
   (PG `C7`: olay `PENDING` ve `started_at IS NULL`.)

---

## 4. BEŞ FAIL-CLOSED KURALI VE KANITLARI

### 4.1 Varsayılan resolver YOKTUR

`_reasoning_resolver_for_intent` eşlenmemiş niyet için **`NULL`** döner ve
`_reasoning_enqueue` onu **`REJECTED`** yapar — olay kuyruğa hiç giremez.
057'nin **12 niyetinin tamamı** eşlenmiştir ve bu hem migration doğrulaması
hem test tarafından çağrılarak sınanır (058 doğrulama (b) · PG `E1`–`E3` ·
TS `C1`–`C5`). Bilinmeyen bir niyet "en yakın" resolver'a **düşmez**
(PG `E2`).

Olay kümesi de kapalıdır: tanınmayan bir olay tipi CHECK ile reddedilir
(PG `H5b`, SQLSTATE 23514).

### 4.2 Bounded dedupe — aynı olay 20 kez gelirse tek reasoning

Anahtar = **şirket + niyet + özne**; kısmi tekil indeks yalnız açık işleri
(`PENDING`/`RUNNING`/`RETRY_PENDING`) kapsar. 20 tekrar tek iş açtı ve
`suppressed_count` 21'e çıktı (PG `D1`). Bastırma **sessizce yutulmaz**:
çağıran `DEDUPED` alır (PG `D2`) ve sayaç LAB'da görünür.

⚠️ **Olay tipi anahtara bilinçli olarak dâhil DEĞİLDİR** (TS `D2`): aynı
aracın sıcaklık sorusu hem `EVIDENCE_ADDED` hem `TRIP_COMPLETED` yolundan
gelebilir; olay tipini anahtara koysaydık aynı soru iki kez çalışırdı.

İş bitince pencere kapanır ve yeni olay yeni iş açar (PG `D3`); farklı niyet
ayrı iştir (PG `D4`).

### 4.3 Resolver KARAR ÜRETMEZ

Bir resolver yalnız **öznesini doğrular** ve `mavi_reason`a yönlendirir.
Migration doğrulaması, resolver gövdesinde `ai_evidence` okuması,
`_reasoning_confidence`/`_reasoning_conflicts` çağrısı, `SUPPORTED`/
`CONFLICTED_EVIDENCE` sabiti veya dış çağrı görürse **DÜŞER**
(058 doğrulama (e) · PG `I6` · TS `G3`).

Özne yoksa karar **uydurulmaz**: `SKIPPED` + bounded gerekçe
(PG `E4`: `NO_DRIVER_SUBJECT`).

### 4.4 Hata yalıtımı — ana işlem bozulmaz, hata yutulmaz

`_reasoning_wire_safely` bir alt-işlemde çalışır; reasoning düşse bile trip
yükleme (PG `G1`), Evidence Engine (PG `G2`), Fleet Insight ve Driver DNA
çalışmaya devam eder. Hata **kaydedilir**: bounded durum kümesi
(`FAILED` · `RETRY_PENDING` · `REJECTED` · `SKIPPED` · `DEDUPED`) ve sınırlı
yeniden deneme (≤5, üstel bekleme).

### 4.5 Eşzamanlılık — aynı olay iki kez çalışamaz

`PENDING/RETRY_PENDING → RUNNING` geçişi atomiktir; ikinci işleyici
`ALREADY_RUNNING` alır (PG `F1`). Koşucu `FOR UPDATE SKIP LOCKED` kullanır ve
idempotenttir — bekleyen iş yoksa 0 işler (PG `F3`).

---

## 5. TEST SONUÇLARI (tamamı bu turda koşuldu)

| Kapı | Sonuç |
|---|---|
| **PG — 058 wiring matrisi** | **47/47 PASS** (`supabase/tests/058_reasoning_wiring_matrix.sql` — depoda kalıcı) |
| **PG — 057 karar matrisi (058 sonrası)** | **56/56 PASS** (üç kontrol 058 gerçeğine uyarlandı — §5.1b) |
| PG — 058 migration doğrulaması | **OK** · üç kez uygulandı, **idempotent** |
| PG — 057 · 056 · 055 · 054 · 053 regresyonu | **hata yok** (artan sırada) |
| PG — 052 · 049 · 048 · 047 · 043 regresyonu | **hata yok** |
| Vitest — `maviReasoningWiring.test.ts` | **40/40 PASS** |
| Vitest — `maviReasoning.test.ts` (057 kilitleri) | **86/86 PASS** |
| Vitest — `reasoningView.test.ts` (website) | **41/41 PASS** |
| TypeScript (kök · website) | **temiz** |
| ESLint (değişen dosyalar) | **temiz** |
| **Vitest (kök tam paket)** | **9689/9689 · 448/448 dosya** |
| **Vitest (website tam paket)** | **955/955 · 45/45 dosya** |
| Build (kök) | **başarılı (1 dk 16 sn)** |

> Not: önceki turda `regression.guards` içindeki bir kilit zaman aşımına
> uğramıştı (kütük #275). Bu turda **tek başına koşulduğunda geçti** —
> düşme, testin `npm run build` ile aynı anda koşmasından kaynaklanan kaynak
> açlığıydı. Kütük maddesi yine de açık bırakıldı: varsayılan timeout'la
> paralel koşumda kırılgan olması bir gerçektir.

**058 matrisi (47 kontrol):** trip completion (A1–A4) · kanıt olayları
(B1–B6) · DNA · presence · health · identity · connectivity hot-path
(C1–C7) · bounded dedupe (D1–D4) · dispatcher ve varsayılan-resolver yasağı
(E1–E4) · eşzamanlılık ve retry (F1–F4) · hata yalıtımı (G1–G3) ·
cross-tenant · transfer · unknown · fail-closed (H1–H8) · mevcut katman
regresyonu (I1–I6).

### 5.1 Doğrulama sırasında bulunan iki test kusuru (ürün hatası değil)

1. **`vehicle_driver_presence` fixture'ı** — testim `state`/`observed_at`
   kolonlarını varsaydı; gerçek şemada `source`/`confidence`/`detected_at`/
   `expires_at` var ve `source` bounded (`HEAD_UNIT`…). Fixture düzeltildi.
2. **`fleet_health.dimension`** — `'FUEL'` CHECK'e takıldı; geçerli küme
   `VEHICLE_HEALTH`/`DRIVER_HEALTH`/… Fixture düzeltildi.

Ayrıca ilk yazdığım `H5` testi bilinmeyen bir **olay tipi** enqueue etmeye
çalıştı ve CHECK reddetti — **bu doğru davranıştı**; test, Unknown Resolver'ı
gerçek yoldan (kategorisi bilinmeyen kanıt olayı) sınayacak biçimde
düzeltildi ve reddin kendisi `H5b` olarak kilitlendi.

### 5.1b 057 matrisinin üç kontrolü 058 sonrası geçersizleşti (ve düzeltildi)

058 uygulandıktan sonra **057 matrisi 53/56'ya düştü** (`C2` · `E3` · `F4`).
Sebep bir gerileme değil, **akışın doğru çalışmasıydı**: o testler *"kanıt
yaz, sonra elle `mavi_reason` çağır"* varsayımına dayanıyordu; artık kanıt
yazmak **tek başına** karar üretiyor, dolayısıyla elle çağrı `DUPLICATE`
dönüyor.

| Kontrol | Yeni ölçüm |
|---|---|
| `C2` (çelişkide güven yok) | Artık **çelişkili** kararı seçiyor (ilk kanıt tek başına geldiğinde çelişki henüz yoktu) |
| `E3` (kanıt değişirse yeni karar) | `result` yerine **karar sayısının arttığı** sınanıyor; elle çağrının `DUPLICATE` dönmesi otomatik akışın kanıtı |
| `F4` (içgörü zinciri) | Bağ kurulduktan **sonra** ikinci kanıt eklenip yeni kararın zinciri sınanıyor (ilk karar üretildiğinde bağ henüz yoktu) |

Matris dosyasının başına bu gerçeği açıklayan kalıcı bir not eklendi.
**Düzeltme sonrası 56/56 PASS**, 058 matrisi de 47/47 kaldı.

### 5.2 Regresyon koşumunda yaptığım hata (kendi hatam — ürün sağlam)

Migration zincirini önce **azalan sırada** koştum. 052 → 049 → 048 sırası
`_trip_attribution_trigger`'ı **geriye aldı** (o fonksiyon 048, 049 ve 052'de
ayrı ayrı tanımlanıyor) ve ardından 055'in "attribution zinciri bozuldu"
doğrulaması haklı olarak düştü.

**Zincir artan sırada yeniden koşuldu ve 053–058 tamamen temiz çıktı.**
Ders: migration regresyonu **her zaman artan sırada** koşulmalıdır; bu
rapora ve kütüğe yazıldı (#282).

### 5.3 Önceden var olan idempotens kusurları (bu paketten bağımsız)

| Migration | Hata | Sebep |
|---|---|---|
| `20260421000000_initial_schema` | `type "membership_role" already exists` | En eski şema, idempotens beklentisi yok |
| `042` | `cannot change return type` (`list_company_vehicle_identity`) | **043** aynı fonksiyonu genişletiyor |
| `046` | `cannot change return type` (`list_vehicle_trips`) | **047** aynı fonksiyonu genişletiyor |
| 20260421–20260427 arası 9 migration | çeşitli `already exists` | Erken dönem, idempotens beklentisi yok |

İleri yönlü uygulamada (artan sıra) sorun yoktur. 058 bu fonksiyonların
hiçbirine dokunmaz.

---

## 6. MADDE 11 — PARALEL KARAR OTORİTESİ TARAMASI

Kod tabanı tarandı. **Hiçbiri değiştirilmedi** — yalnız görünür kılındı.

### 6.1 Reasoning Engine'i BYPASS eden gerçek karar otoriteleri (taşınmalı)

| # | Dosya | Fonksiyon | Karar tipi | Çakışan intent | Karar |
|---|---|---|---|---|---|
| 1 | `src/platform/obd/verdictEngine.ts` | `buildVehicleVerdict` | Araç sağlık verdisi (`critical`/`attention`/`inconclusive`/`clean`) **+ kendi güven hesabı** | `VEHICLE_HEALTH` | **TAŞINMALI (öncelik 1)** |
| 2 | `src/platform/diagnosticTriage.ts` | `buildDiagnosticVerdict` · `buildRootCauseSnapshot` | Kök-neden hipotezi + severity sıralaması | `DIAGNOSTIC` | **TAŞINMALI (öncelik 2)** |
| 3 | `src/platform/aiCore/verdictEngine.ts` | `buildAiCoreVerdict` | Aciliyet (urgency) + **genel güven zarfı** | `DIAGNOSTIC` · `VEHICLE_HEALTH` | **TAŞINMALI** — dosya "ikinci motor kurmaz" diyor ama kendi güven zarfını ekliyor |
| 4 | `src/platform/diagnosticKnowledgeEngine.ts` | `combineConfidence` · `buildDiagnosticInsight` | **Ağırlıklı kendi güven formülü** (`0.5·severity + 0.2 + 0.2 + 0.1`) | tüm tanısal niyetler | **TAŞINMALI** — 057'nin "en zayıf halka" ilkesiyle doğrudan çelişiyor |
| 5 | `src/platform/diagnostic/maintenanceBrain.ts` | `calcLifetimeWear` · `getBrainState` | `healthScore` + bakım öngörüsü | `VEHICLE_HEALTH` | **TAŞINMALI** (Predictive Maintenance) |
| 6 | `src/platform/diagnostic/fuelAdvisorService.ts` | `startFuelAdvisor` | Düşük yakıt tavsiyesi | `FUEL` | **TAŞINMALI** |
| 7 | `src/platform/ai/smartCardEngine.ts` | `startSmartCardEngine` | Proaktif kart gösterme kararı | değişken | **TAŞINMALI** |
| 8 | `src/platform/obd/predictionEngine.ts` | `predict` | Trend öngörüsü ("5 dk sonra") | `ENGINE` · `TEMPERATURE` | **SONRAYA** — hot-path (3Hz); taşınırsa kuyruk üzerinden olmalı |

### 6.2 Taşınmaması gereken kapılar (bilinçli — gerekçeli)

| # | Dosya | Neden taşınmaz |
|---|---|---|
| 9 | `src/platform/safety/SafetyRuleEngine.ts` | **Güvenlik-kritik hot-path** (ms mertebesi, sürüş anı). Sunucu kararına bağlamak araç sürerken ağ beklemek olurdu. CLAUDE.md: güvenlik-kritik katmanlar her tier'da garanti açık. |
| 10 | `src/platform/safety/SafetyBrain.ts` | Yerel dayanıklılık (aynı fault 3× → özellik devre dışı). Cihaz-yerel fail-soft davranışı; karar değil **korunma**. |
| 11 | `src/platform/navigation/guardian/*` (`guardianDecisionEngine`, `curveRiskRule`, `vehicleHealthRule`, `weatherRiskRule`) | Sürüş anı risk sunumu — hot-path + güvenlik. |
| 12 | `src/platform/aiCore/safetyGate.ts` | **Yetki** kararı ("bu eylem yapılabilir mi"), araç hakkında **hüküm** değil. |
| 13 | `src/platform/assistant/assistantSafetyKernel.ts` | Pre-gate / yanıt doğrulama — güvenlik kapısı, hüküm değil. |
| 14 | `src/platform/expert/TrustEngine.ts` | Yazma kilidi politikası (`WRITE_LOCK_THRESHOLD`) — yetki kararı. |

### 6.3 Karar değil, kanıt/atıf üreten katmanlar (doğru yerdeler)

`fleet/aiEvidenceEngine.ts` · `fleet/driverDnaEngine.ts` ·
`fleet/fleetIntelligenceEngine.ts` — kanıt üretir, 056 adaptörleriyle
omurgaya yazar. Sunucu tarafında `_resolve_trip_driver` ·
`_resolve_driver_presence` · `_resolve_driver_authentication` **atıf**
kararlarıdır (kim sürüyordu) ve reasoning'in **girdisi** olan kanıtı
üretirler; `_dna_status` ve `_fleet_insight_confidence` sınıflandırma
eşikleridir.

> ⚠️ **Bu tablo bir denetim sonucudur, bir uygulama planı değildir.**
> Hiçbir dosya bu turda değiştirilmedi. Taşıma işi dosya başına ayrı ve
> atomik PR'lar gerektirir; sıralama §9'da.

---

## 7. GÖZLEMLENEBİLİRLİK (yedi şart)

| # | Şart | Durum |
|---|------|-------|
| 1 | Özellik uygulandı | ✅ migration 058 · `maviReasoningQueue.ts` |
| 2 | CAROS LAB salt-okunur ekran | ✅ `MaviReasoningEngineScreen` → **Live Event Queue** bölümü |
| 3 | Gerçek veri kaynağı | ✅ `get_reasoning_queue()` · `get_recent_reasoning_events()` |
| 4 | LAB aktif komut göndermiyor | ✅ TS `G8` (kuyruk işletme/dispatch çağrısı yok) |
| 5 | Kanıtsız bilgi üretilmiyor | ✅ ölçülmeyen süre `null` — sahte `0` YOK (TS `E1`–`E5` · website `F5`) |
| 6 | Gizli veri taşınmıyor | ✅ yalnız kimlik referansı ve bounded kod |
| 7 | Unit test + kütük maddesi | ✅ 40 + 12 test · kütük #279–#284 |

**Fleet Dashboard:** `ReasoningCards` → **Karar kuyruğu · Karar gecikmesi ·
Bastırılan tekrar · Düşen olay** kartları; `/dashboard/fleet/lab` sayfasına
bağlı (website `F11`/`F12`).

⚠️ **Kuyruk bölümü karar yokken bile gösterilir** (website `F12`): *"hiç karar
yok"* ile *"olaylar geliyor ama karara bağlanamıyor"* farklı arızalardır.
Ve **hiç olay olmaması bir başarı sayılmaz** — kart yerine gerekçe yazılır
(website `F2`).

---

## 8. BİLİNÇLİ OLARAK YAPILMAYANLAR

| # | Yapılmadı | Neden |
|---|---|---|
| 1 | Kuyruk koşucusu için zamanlayıcı | `run_mavi_reasoning_queue()` `service_role`a açıktır ama onu **periyodik çağıran bir zamanlayıcı YOK**. Normal akışta olaylar tetiklendikleri anda işlenir; yalnız iki hot-path olayı ve düşmüş işler koşucu bekler. Bu **açık borçtur** (kütük #280). |
| 2 | Eski karar yollarının taşınması | §6 tarandı ve listelendi; **hiçbiri değiştirilmedi** (görev gereği). Her biri ayrı PR. |
| 3 | Kanıt üretmeyen olayların kendi kanıtını yazması | Ör. `VEHICLE_CONNECTIVITY_CHANGED` bir karar tetikler ama `CONNECTIVITY` kategorisinde kanıt üreten bir adaptör YOK (056 kapsamı üç kaynakla sınırlı) → karar `INSUFFICIENT_EVIDENCE` çıkar. Bu **dürüst** bir sonuçtur ama kapsam borcudur (kütük #281). |
| 4 | Head unit'te olay üretimi | Kuyruk sunucuda yaşar; cihaz yalnız okur (köprü henüz yok). |
| 5 | Gerçek araç doğrulaması | Cihaz/araç yok — `BLOCKED_REAL_VEHICLE`. |

---

## 9. SONRAKİ ATOMİK PR ÖNERİSİ

Sıra, **çakışma şiddetine** göre:

1. **`PR-REASON-3 · VEHICLE VERDICT MIGRATION`** — `obd/verdictEngine.ts`'in
   `buildVehicleVerdict`'i `mavi_reason(VEHICLE_HEALTH)` sonucunu tüketecek
   biçimde taşınır; kendi `level`/`confidence` hesabı **silinir**. İkinci
   otoritenin fiilen kaldırıldığının ilk kanıtı.
2. **`PR-REASON-4 · CONFIDENCE AUTHORITY UNIFICATION`** —
   `diagnosticKnowledgeEngine.combineConfidence` kaldırılır; güven yalnız
   kanıt omurgasından türetilir.
3. **`PR-REASON-5 · QUEUE SCHEDULER`** — `run_mavi_reasoning_queue()` için
   zamanlanmış koşum + `expire_mavi_reasoning()` zamanlayıcısı.
4. **`PR-REASON-6 · CONNECTIVITY/LOCATION EVIDENCE ADAPTERS`** — kanıtı
   olmayan olayların kanıt kaynağı (056 desenine ek iki adaptör).
5. Gerçek araç/filo verisiyle ilk otomatik `SUPPORTED` kararın gözlenmesi →
   kütük #279'un 🟢'ye taşınması.
