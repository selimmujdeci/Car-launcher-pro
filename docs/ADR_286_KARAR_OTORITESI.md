# ADR-286 — Karar Otoritesi Cihazdadır

**Durum:** KABUL EDİLDİ (vizyon onaylı, tartışmaya kapalı)
**Tarih:** 2026-08-09
**Kapattığı çatal:** kütük #286 — *"`buildVehicleVerdict` taşıma çatalı AÇIK: kanıt/karar
omurgası sunucuda, cihazda kanıt üreten ürün kodu yok, ama tanı verdisi çevrimdışı
çalışmak zorunda"*
**İlgili:** #280 · #283 · #285 · #287 · migration 055–060 · `docs/HANDOFF_2026-08-08_PROJE_DEVIR.md`

> Bu belge **tasarımdır**. Kod yazılmadı, migration koşulmadı, commit atılmadı.

---

## 1. Karar

1. **Karar otoritesi CİHAZDADIR.** İnternet olmadan da hüküm üretilebilir.
   Gerekçe: hüküm bir **güvenlik yeteneğidir** ve tam da ağın olmadığı yerde
   (tünel, dağ yolu, yol kenarı) gerekir. Ağ bağımlı hüküm, hüküm değildir.
2. **Bulut yardımcı roldedir, patron değil:** filo öğrenmesi, ağır analiz,
   geçmiş/arşiv. Ağ giderse hiçbir temel yetenek kaybolmaz — yalnız
   **zenginleşme** durur.
3. **Kural mantığı iki kere yazılmaz.** Kurallar **veri** olarak tutulur; onu
   yorumlayan **tek motorun iki koşum ortamı** olur (cihaz + sunucu).
4. **Parite testi zorunludur:** aynı girdi → aynı hüküm. Regresyon kasasına
   kilitlenir; ayrışma build'i kırar.

---

## 2. Bulgu: çatal sanıldığından farklı

Çatal *"kural nereye taşınsın"* diye açılmıştı. Kodu okuyunca durum şu çıktı:

> **Kural zaten iki kere yazılmış — ve TS kopyasının hiçbir ürün çağıranı yok.**

| Katman | Dosya | Satır | Ürün çağıranı |
|---|---|---|---|
| Sunucu | `20260801000057_mavi_reasoning_engine_p1.sql` | 1143 | ✅ canlı (`run_mavi_reasoning_queue` + cron) |
| Cihaz | `src/platform/reasoning/maviReasoningEngine.ts` | 751 | ❌ **YOK** — yalnız testler |

TS tarafındaki ayna **tamdır**: `resolveIntent · resolveEvidence · resolveConflicts ·
resolveDecision · resolveConfidence · reason() · recordReasoning · transitionReasoning ·
expireReasoning · buildReasoningChain`. SQL yorumları bunu açıkça kabul ediyor:
*"TS `intentForCategory` aynası"*, *"TS `resolveConflicts` ile birebir"*.

Bunun üç sonucu var:

- **İyi haber:** cihaz motoru sıfırdan yazılmayacak; **zaten var**.
- **Kötü haber:** bugün **iki bağımsız kopya** var ve aralarında **hiçbir parite
  testi yok**. Kural 3'ün ihlali şu an yürürlükte.
- **Asıl iş** motor yazmak değil: kopyaları **teke indirmek**, cihazda **kanıt
  üretmek** ve motoru ürüne **bağlamak**.

`maviReasoningEngine.ts` şu an **ölü koddur** — testleri yeşil, ürünü besleyen yok.
Bu, projede daha önce ölçülmüş *"mekanizma kodda var ≠ çalışıyor"* sınıfının aynısıdır
(#383 yakıt kalibrasyonu, #486 vektör karo kaynağı).

---

## 3. Görev 1 — `mavi_reason()`: saf kural / SQL'e özgü ayrımı

`mavi_reason()` yedi bölümdür. Ayrım kesindir ve tesadüfi değildir: **karar çekirdeği
zaten saf, kabuk SQL.**

### 3.1 SAF KURAL — cihazda birebir koşabilir

| Bölüm | SQL | Girdi | Çıktı | Not |
|---|---|---|---|---|
| Karar çözücü | `mavi_reason` §4 (satır 529–550) | sayaçlar | `decision` + `reason` | **Hiç I/O yok.** Tamamen saf |
| Kategori eşlemesi | `_reasoning_categories` | intent | `text[]` | `IMMUTABLE`, sabit tablo |
| Ters eşleme | `_reasoning_intent_for_category` | category | intent | `IMMUTABLE` |
| Durum makinesi | `_reasoning_can_transition` | from, to | bool | `IMMUTABLE` |
| Terminal durum | `_reasoning_state_for_decision` | decision | state | `IMMUTABLE` |
| Güven zinciri | `_reasoning_confidence` | decision, weakest, count, coverage | confidence | `IMMUTABLE` |
| Kapsam oranı | `mavi_reason` §3 sonu | present, beklenen | oran ‖ `NULL` | Aritmetik |
| Niyet türetme **kuralı** | `mavi_reason` §2 | aday kümesi | intent ‖ `UNKNOWN` | "tek aday varsa al" kısmı saf |

Karar çözücünün girdisi **dokuz skalerdir**: `intent`, `matchedCount`, `activeCount`,
`expiredCount`, `conflictCount`, `unknownConfidenceCount`, `negativeCount`,
`presentCategoryCount`, `expectedCategoryCount`. Bu, saf çekirdeğin sözleşmesidir.

### 3.2 SQL'E ÖZGÜ — cihazda **karşılığı farklı** olacak

| Bölüm | Neden taşınamaz | Cihazdaki karşılığı |
|---|---|---|
| §1 Özne kapısı (cross-tenant) | `vehicles`/`fleet_drivers`/`vehicle_trips` JOIN; **çok kiracılı** güvenlik | Cihazda **tek araç** var, kiracı yok → kapı *"özne var mı"*ya iner. ⚠️ Kapı **kaldırılmaz**, daraltılır |
| §3 Kanıt sorguları | `ai_evidence` tablosu, `WHERE company_id`, `expires_at > now()` | Yerel kanıt deposu (§4.3) |
| §5 Tekilleştirme | `mavi_reasoning` tablosuna imza sorgusu | Yerel karar defteri; imza kuralı **saf** |
| §6 Durum makinesi yürütme | `INSERT`/`UPDATE` + trigger | Yerel yazım; geçiş **kuralı** saf |
| §7 Zincir yazımı | `ai_evidence_chain`, `driver_dna` JOIN | Filo uçları cihazda **yok** → zincir kısalır (uydurulmaz) |
| `now()` | Zaman | Enjekte edilen saat (saf çekirdek `Date.now` çağırmaz) |
| İstatistik sayaçları | `mavi_reasoning_stat` upsert | Yerel sayaç |

### 3.3 Bugünkü sapma adayları (parite testinin **ilk** hedefi)

Bunlar iddia değil, **ölçülecek şüphelerdir**:

1. **Güven tavanı.** SQL `_evidence_confidence('BLACKBOX','MEASURED', n)` çağırıyor;
   TS `sampleConfidenceCeiling(n)` kullanıyor (1→`MEDIUM`, <5→`HIGH`, ≥5→`VERY_HIGH`).
   SQL'de kaynak/yöntem **sabit** geçiliyor — ikisi aynı sonucu veriyor mu, ölçülmedi.
2. **`REJECTED` gerekçesi.** TS `SUBJECT_MISMATCH` üretir; SQL erken `RETURN` yapar ve
   gerekçeyi **kaydetmez**. Karar aynı, **açıklaması farklı**.
3. **Kapsam `NULL` sırası.** SQL'de `coverage IS NULL` kontrolü başta, TS'te sonda.
   Sonuç bugün aynı görünüyor; sıra değişirse sessizce ayrışır.
4. **Niyet türetmede sıralama.** SQL `min(...)` ile tek adayı seçer; TS'in seçim kuralı
   ayrıca doğrulanmalı (aday **tekse** fark yok, ama çoklu adayda ikisi de `UNKNOWN`
   dönmeli).

`isNegative` ↔ `severity IN ('WARNING','CRITICAL')` **birebir aynı** (doğrulandı).

---

## 4. Görev 2 — Kural temsili tasarımı

### 4.1 İlke

Kural mantığı **kodda tek yerde**, kural **parametreleri veride** durur. İkisi ayrı
şeydir ve karıştırılmamalıdır:

- **Motor (kod):** karar sırası, fail-closed davranışı, güven zincirinin yönü.
  Bu **mantıktır** ve tek kopyası `maviReasoningEngine.ts`'tir.
- **Kural verisi:** kategori↔niyet eşlemeleri, geçiş tablosu, eşikler (kapsam 0.5/0.8,
  çelişki %10, örnek sayısı 1/5), TTL.

> **Neden mantık veriye indirgenmiyor?** Karar sırasını veriye çevirmek (mini kural
> dili) ikinci bir yorumlayıcı yazmak demektir — kural 3'ü *"iki motor"* olarak yeniden
> ihlal ederdi. Mantık tek kopya kalır; **ayrışma riski taşıyan sabitler** veriye iner.

### 4.2 Kural paketi (`RulePack`)

Kavramsal şekil — alan adları tasarım niyetini gösterir:

```
RulePack {
  packVersion      : "RP-2026.08.09"     // artan, kırılma olursa MAJOR
  schemaVersion    : 1                    // motorun anladığı şema
  intentCategories : { VEHICLE_HEALTH: [...], ... }
  categoryIntent   : { VEHICLE: "VEHICLE_HEALTH", ... }
  transitions      : { NEW: ["ANALYZING","REJECTED"], ... }
  thresholds       : { coverageLow: 0.5, coverageMed: 0.8,
                       conflictPct: 0.10, sampleHigh: 5, ttlHours: 24 }
  checksum         : "<sha256 of canonical JSON>"
}
```

**Dağıtım — gömülü VE senkron (ikisi birden):**

| Kanal | Rol | Zorunlu mu |
|---|---|---|
| **Gömülü** (APK içinde, derleme zamanı sabiti) | **Taban gerçek.** Ağ hiç olmasa da motor çalışır | ✅ Her zaman |
| **Senkron** (sunucudan indirilen paket) | Yalnız **aynı `schemaVersion`** içinde daha yeni `packVersion` | Opsiyonel |

Senkron kuralları:

- İndirilen paket **doğrulanmadan kullanılmaz**: `schemaVersion` motorunkiyle
  **eşit olmalı**, `checksum` tutmalı, tüm zorunlu alanlar dolu olmalı.
- Doğrulama düşerse **gömülü pakete dönülür** ve olay **sayılır** (sessiz düşüş yok).
- Senkron **hiçbir zaman** hüküm üretimini bloke etmez; asenkron ve en iyi çabadır.
- `schemaVersion` farklıysa paket **reddedilir** — yeni alan bekleyen motor, eski
  paketle yarım kural koşamaz.

### 4.3 Cihazda kanıt deposu

Motorun girdisi `AiEvidence` satırlarıdır. Cihazda bugün **yok** (#286'nın tespiti).
Gereken en küçük yüzey:

- Yerel kanıt kaydı: `category · source · severity · confidence · metric · value ·
  revision · observedAt · expiresAt · state`.
- **TTL cihazda da işler** — süresi dolan kanıt `EXPIRED` olur; yoksa cihaz "bayat
  kanıtla taze hüküm" üretir ki bu, sunucudaki `EXPIRED_EVIDENCE` kararının anlamını
  boşaltır.
- Depo **sınırlıdır** (halka tampon); taşma **sayılır**, sessizce düşürülmez.

### 4.4 Bilinmeyen girdide fail-closed garantisi

Dört katmanlı ve **hepsi kilitlenir**:

1. **Tip düzeyi:** bilinmeyen `category`/`intent`/`severity` değeri gelirse motor
   `UNKNOWN`'a düşer — `else` dalı **daima** en muhafazakâr sonucu verir
   (`_reasoning_categories` boş dizi döner; boş dizi *"hepsi"* kısayolu **değildir**).
2. **Karar düzeyi:** kanıt yoksa `INSUFFICIENT_EVIDENCE`; *"veri yok → sorun yok"*
   **karar değildir**.
3. **Güven düzeyi:** sonuçlandırıcı olmayan her karar → `UNKNOWN`.
   *"Kararsızım ama eminim"* olamaz.
4. **Paket düzeyi:** kural paketi doğrulanamazsa gömülü pakete dönülür; hiç paket
   yoksa motor **hüküm üretmeyi reddeder** (`REJECTED`/`UNKNOWN`), varsayılan
   uydurmaz.

---

## 5. Görev 3 — Parite testinin tasarımı

### 5.1 Ne karşılaştırılır

Karşılaştırma **saf çekirdek** üzerindedir; kabuk (tablo erişimi, tenant, zincir)
kapsam dışıdır — orası zaten ortamına göre farklıdır.

**Karşılaştırılan çıktı (hüküm dörtlüsü):**
`decision` · `confidenceReason` · `confidence` · `stateForDecision`

**Karşılaştırılmayan:** `reasoning_id`, zaman damgaları, zincir düğümleri, sayaçlar.

### 5.2 Ortak girdi seti — **ikisi birden**

| Küme | Kaynak | Amaç | Boyut |
|---|---|---|---|
| **A. Sentetik matris** | Dokuz skaler girdinin sınır değerleri (0/1/çok, eşik altı/üstü/tam eşik) | **Kapsam**: her karar dalı ve her eşik en az bir kez | ~120 vaka |
| **B. Gerçek gölge** | Üretimden **anonimleştirilmiş** `ai_evidence` türevleri | **Gerçeklik**: sentetiğin akla getirmediği kombinasyonlar | ~200 satır |

**B kümesi gizlilik kuralı:** VIN · plaka · konum · sürücü kimliği · şirket kimliği
**taşınmaz**. Yalnız karar çekirdeğinin gerçekten okuduğu alanlar alınır
(`category · severity · confidence · state · metric · value · revision` + göreli
zaman). Fikstür **depoya işlenir** ve üretimden canlı çekilmez — testin ağa
bağımlı olması, ağsız hüküm iddiasıyla çelişirdi.

Tam eşik değerleri **zorunlu** vakadır: `coverage = 0.5`, `coverage = 0.8`,
`sampleCount = 1`, `sampleCount = 5`, `conflict = %10`. Sapmalar tam eşikte doğar.

### 5.3 Nasıl karşılaştırılır

Ağa ve canlı veritabanına bağlı olmayan **iki aşamalı** kurulum:

- **Aşama 1 — altın dosya (CI'da her koşumda):**
  SQL çekirdeği `supabase/tests/` içinde girdi matrisi üzerinde koşturulur ve
  `docs/fixtures/reasoning_parity_golden.json` üretilir. TS testi **aynı matrisi**
  koşar ve altın dosyayla karşılaştırır. Ayrışma → **build kırılır**.
  Altın dosya **elle düzenlenemez**; yalnız SQL koşumu üretir.
- **Aşama 2 — canlı çapraz koşum (migration doğrulamasında):**
  Supabase test matrisi aynı girdileri gerçek `mavi_reason()` üzerinden geçirir.
  Aşama 1 mantığı, aşama 2 **bağlamı** doğrular.

**Kasaya kilitlenme:** `src/__tests__/regression.guards.test.ts` içine
*"parite fikstürü mevcut ve TS↔SQL hükümleri birebir"* kilidi eklenir. Fikstür
dosyası silinirse veya boşsa test **düşer** — sessiz kapatma yolu bırakılmaz.

### 5.4 Sürüm çapraz kontrolü

Parite testi `packVersion` + `schemaVersion` de karşılaştırır. Cihaz ve sunucu farklı
şema sürümündeyse test **atlanmaz, düşer**: farklı şema = farklı kural = ayrışma.

---

## 6. Görev 4 — Sekiz karar otoritesinin göç sırası

### 6.1 Ölçüm

| Otorite | Ürün dosyası | Test dosyası | Konum | Risk notu |
|---|---|---|---|---|
| `combineConfidence` | 1 | 1 | `diagnosticKnowledgeEngine.ts` | Primitif, testli |
| `predictionEngine` | 1 | 1 | `obd/predictionEngine.ts` | Dar yüzey |
| `buildVehicleVerdict` | 2 | 1 | `components/obd/DTCPanel.tsx` | **#286'nın asıl konusu** |
| `buildDiagnosticVerdict` | 3 | 2 | `aiCore/verdictEngine.ts` | Testli |
| `buildAiCoreVerdict` | 3 | 2 | `aiCore/aiOrchestrator.ts` | Testli |
| `smartCardEngine` | 3 | **0** | `ai/smartCardEngine.ts` | ⚠️ Testsiz |
| `maintenanceBrain` | 3 | **0** | `system/SystemBoot.ts` | ⚠️ Testsiz + boot yolunda |
| `fuelAdvisorService` | 6 | **0** | `ai/smartCardEngine.ts` | ⚠️ **En bağımlı + testsiz** |

### 6.2 Faz 0 — önkoşullar (hiçbir göç bundan önce başlamaz)

| # | İş | Neden önkoşul |
|---|---|---|
| 0.1 | Parite testi altyapısı (§5) | Ayrışmayı **ölçemeden** göç, ikizliği kalıcılaştırır |
| 0.2 | Bugünkü TS↔SQL sapmalarının kapatılması (§3.3) | Göçün taban çizgisi temiz olmalı |
| 0.3 | `RulePack` + gömülü paket (§4.2) | Eşikler iki yerde sabit kaldıkça kural 3 ihlal |
| 0.4 | Cihazda kanıt deposu (§4.3) | Motor var ama **girdisi yok** — bağlanacak bir şey yok |
| 0.5 | `maviReasoningEngine` ürüne bağlanır (bir tüketici) | Ölü kod göç hedefi olamaz |

### 6.3 Göç sırası — big-bang değil, tek tek

**Sıra ilkesi:** önce *ölçülebilir ve testli* olan, sonra *bağımlısı çok* olan.
Testsiz otoriteler göçten **önce** test kazanır — testsiz göç, sessiz davranış
değişikliğidir.

| Sıra | Otorite | Gerekçe | Ön koşul |
|---|---|---|---|
| 1 | `combineConfidence` | En dar yüzey, testli. Güven **primitifidir**; motorun güven zinciriyle doğal olarak birleşir | Faz 0 |
| 2 | `buildVehicleVerdict` | #286'nın açtığı çatalın kendisi; testli, 2 çağıran. **İlk gerçek kazanım** | 1 |
| 3 | `buildDiagnosticVerdict` | Testli; tanı verdisi çevrimdışı çalışmak zorunda (#286 gerekçesi) | 2 |
| 4 | `buildAiCoreVerdict` | Testli; 3 ve 4 aynı aileyi paylaşır | 3 |
| 5 | `predictionEngine` | Dar yüzey ama **öngörü** ayrı bir zaman ölçeği — sonraya bırakılır | 4 |
| 6 | `smartCardEngine` | Önce test kazanır, sonra göçer | 5 + testler |
| 7 | `maintenanceBrain` | Boot yolunda; göç **boot sırasını** değiştirmemeli | 6 + testler |
| 8 | `fuelAdvisorService` | En çok bağımlıya sahip + testsiz → **en son** | 7 + testler |

**Her göç adımının çıkış ölçütü** (hepsi sağlanmadan sıradakine geçilmez):
1. Parite testi yeşil (yeni otoritenin girdi/çıktısı matrise eklenmiş).
2. Otoritenin **eski** çağıranları davranış değiştirmemiş (mevcut testler yeşil).
3. Kütükte o adım için 🔴 madde açılmış ve **ölçülebilir** kabul ölçütü yazılmış.
4. LAB'da otoritenin hükmü ve **gerekçesi** okunabilir (gözlemlenebilirlik kuralı).

---

## 7. Görev 5 — #283 ile çelişki değerlendirmesi

**#283:** güvenlik-kritik kapılar (`SafetyRuleEngine`, `SafetyBrain`, `guardian/*`,
`aiCore/safetyGate`) reasoning omurgasına bağlanmadı; gerekçe *"sürüş anı hot-path,
ms mertebesi"*. Ayrıca `assistantSafetyKernel` ve `TrustEngine` **yetki** kararıdır,
araç hakkında hüküm değil.

**Değerlendirme: çelişki YOK — ama gerekçenin bir bacağı düştü, güncellenmeli.**

| #283'ün gerekçesi | ADR-286 sonrası |
|---|---|
| "Ağ gecikmesi hot-path'e giremez" | ❌ **DÜŞTÜ.** Karar cihaza indi, ağ yok |
| "ms mertebesi tepki gerekir" | ✅ **GEÇERLİ** — ve asıl gerekçe budur |
| "`TrustEngine` yetki kararıdır" | ✅ **GEÇERLİ** — farklı eksen, hüküm değil |

**Asıl ayrım zaman ölçeğidir, konum değil:**

- Reasoning omurgası **yavaş düşünmedir**: kanıt birikir, TTL'i **24 saattir**,
  kapsam ve çelişki hesaplanır. Bu, *"araç hakkında ne biliyoruz"* katmanıdır.
- Safety hot-path **refleksdir**: 3 Hz+ akışta ms mertebesinde tepki. Bu,
  *"şu anda ne oluyor"* katmanıdır.

Refleksi hükme bağlamak, frenlemeyi 24 saatlik kanıt TTL'ine bağlamak olurdu.
Cihaza inmek bu ölçek farkını **kapatmaz**.

**Yapılması gereken:** #283'ün gerekçe metni güncellenir — *"ağ"* bacağı silinir,
*"zaman ölçeği + yetki/hüküm ayrımı"* bacağı korunur. İstisna listesi olarak
kalması doğrudur; yeni dosya eklenirse gerekçesi yazılmalıdır (mevcut kural).

**Tek gerçek kesişim:** safety hot-path bir hükmü **okumak** isterse (ör. *"bu araçta
soğutma sistemi şüpheli"*), bunu **senkron hesaplayarak değil**, son hükmün
**önbelleğe alınmış** hâlinden okur. Hüküm üretimi asla hot-path'te koşmaz.
Bu kural ADR-286'nın parçasıdır ve kilitlenmelidir.

---

## 8. Görev 6 — Riskler

| # | Risk | Etki | Azaltma |
|---|---|---|---|
| R1 | **DeviceTier `low`'da kural maliyeti** | Kanıt sayısı × kategori taraması; K24/Mali-400 sınıfında hot-path'e girerse jank | Hüküm üretimi **hot-path dışıdır**: olay tetikli + idle. `AdaptiveRuntimeManager` bütçesine abone. Tavan: tek koşum **< 16 ms**, aşarsa **ölçülür ve düşürülür** (sessiz uzama yok) |
| R2 | **Kural senkron gecikmesi** | Cihaz eski `packVersion` ile koşar; filo yeni kuralla | Gömülü paket **taban gerçektir**; senkron en iyi çaba. Cihaz **hangi sürümle** hüküm ürettiğini hükümle birlikte yazar → sonradan yeniden yorumlanabilir |
| R3 | **Versiyon uyuşmazlığı (şema)** | Cihaz v1, sunucu v2 → **sessiz ayrışma** (en tehlikeli risk) | `schemaVersion` **eşit değilse paket reddedilir**. Parite testi sürüm karşılaştırır ve eşitsizlikte **düşer** (atlamaz). Hüküm kaydına `packVersion` gömülür |
| R4 | **SAB kapalı** (prod'da COEP kaldırıldı) | Worker'a taşınırsa `postMessage` kopyalama maliyeti; paylaşımlı bellek yok | Hüküm üretimi **ana iş parçacığında ve seyrek** koşar; SAB gerektiren tasarım **seçilmez**. Kanıt kümesi küçüktür (kategori başına birkaç satır) |
| R5 | **Cihaz kanıt deposu şişmesi** | Depolama + tarama maliyeti | Halka tampon + TTL. Taşma **sayılır**, sessizce düşürülmez |
| R6 | **İkizliğin kalıcılaşması** | Parite testi yazılır ama otoriteler göç etmezse iki kopya sonsuza kalır | Faz 0 çıktısı **tek başına yeterli sayılmaz**; ilk göç (sıra 1–2) aynı turda yapılır |
| R7 | **Cihaz hükmü ile sunucu hükmü çakışması** | Aynı özne için iki farklı hüküm | Cihaz hükmü **yereldir ve otoritedir**; sunucu hükmü **filo görüşüdür**. Çakışma **gizlenmez**, ikisi de saklanır ve LAB'da yan yana gösterilir |
| R8 | **Testsiz otoritelerin göçü** | `fuelAdvisorService` · `maintenanceBrain` · `smartCardEngine` sessizce davranış değiştirir | Göç **öncesi** test şartı (§6.3). Testsiz göç yasak |

---

## 9. Kabul ölçütleri

Bu ADR **uygulanmış** sayılmaz, aşağıdakiler ölçülene kadar:

1. **Ağsız hüküm:** uçak modunda, sunucuya hiç erişmeden, gerçek cihazda en az bir
   `SUPPORTED`/`UNSUPPORTED` hüküm üretilir ve LAB'da gerekçesiyle okunur.
2. **Parite:** ortak girdi matrisinde TS ve SQL hükümleri **birebir aynı**; ayrışma
   build'i kırar (kasada kilitli).
3. **Tek mantık:** eşik sabitleri (`0.5 · 0.8 · %10 · 1 · 5 · 24h`) **tek kaynaktan**
   okunur; ikinci bir yerde sabit yazılı **kalmaz** (kilit: kaynak taraması).
4. **Fail-closed:** bilinmeyen kategori/niyet/severity girdisinde hüküm `UNKNOWN`;
   *"veri yok → sorun yok"* hiçbir yolda üretilmez.
5. **Hot-path dokunulmazlığı:** hüküm üretimi sürüş hot-path'inde **hiç** koşmaz
   (kilit: çağrı yolu taraması); safety yalnız **önbelleğe alınmış** hükmü okur.
6. **Bütçe:** `low` tier'da tek hüküm koşumu **< 16 ms**; aşım **ölçülür ve
   raporlanır**.
7. **Gözlemlenebilirlik:** LAB'da hüküm · gerekçe · `packVersion` · kanıt sayısı ·
   kapsam oranı okunur; koordinat/VIN/sürücü kimliği **taşınmaz**.

---

## 10. Saha kütüğüne açılacak 🔴 satırlar (taslak)

Aşağıdakiler **taslaktır**; iş yapıldıkça kütüğe işlenir. Her biri ölçülebilir kabul
ölçütü taşır.

| # | Başlık | Ölçülebilir kabul ölçütü |
|---|---|---|
| **#488** | 🔴 **PARİTE · TS↔SQL karar çekirdeği ayrışması ÖLÇÜLMEDİ** | Ortak matris (≥120 sentetik + ≥200 gölge vaka) koşulur; **sıfır** ayrışma. Tam eşik vakaları (`coverage 0.5/0.8`, `sample 1/5`, `conflict %10`) matriste **bulunur**. Ayrışma bulunursa her biri ayrı satır olarak kütüğe düşer |
| **#489** | 🔴 **KURAL PAKETİ · eşikler iki yerde sabit yazılı** | Kaynak taraması: `0.5`/`0.8`/`0.10`/`24 hours` sabitleri **yalnız** `RulePack` tanımında geçer. Gömülü paket checksum'u doğrulanır; bozuk paket **reddedilir** ve sayaç artar |
| **#490** | 🔴 **CİHAZDA KANIT · yerel `ai_evidence` karşılığı yok** | Gerçek araçta OBD/GPS'ten en az 3 kategoride kanıt üretilir; TTL dolunca `EXPIRED` olur; halka tampon taşmasında **sayaç artar**, sessiz düşüş olmaz |
| **#491** | 🔴 **AĞSIZ HÜKÜM · uçak modunda karar üretilmedi** | Uçak modunda gerçek araçta hüküm üretilir; LAB'da `decision + confidenceReason + packVersion` okunur. Ağ açılınca hüküm **yeniden üretilmez** (tekilleştirme imzası tutar) |
| **#492** | 🔴 **GÖÇ-1 · `combineConfidence` motora bağlanmadı** | Eski çağıranların çıktısı değişmez (mevcut testler yeşil); parite matrisine güven vakaları eklenir |
| **#493** | 🔴 **GÖÇ-2 · `buildVehicleVerdict` motora bağlanmadı (#286'nın kendisi)** | Tanı verdisi **çevrimdışı** üretilir; DTCPanel'de gösterilen hüküm ile motorun hükmü **aynı**; LAB'da gerekçe okunur |
| **#494** | 🔴 **HOT-PATH · hüküm üretimi sürüş yolunda koşmamalı** | Çağrı yolu taraması: `SafetyRuleEngine`/`guardian/*` içinden hüküm üretimi çağrılmaz. `low` tier'da tek koşum **< 16 ms** ölçülür |
| **#495** | 🔴 **SÜRÜM · cihaz/sunucu şema uyuşmazlığı sessiz kalabilir** | Farklı `schemaVersion` ile paket **reddedilir**; parite testi eşitsizlikte **düşer**; hüküm kaydında `packVersion` bulunur |
| **#496** | 🔴 **TESTSİZ OTORİTELER · göç öncesi test borcu** | `fuelAdvisorService` · `maintenanceBrain` · `smartCardEngine` için davranış testleri yazılır; göç **ancak** ondan sonra başlar |
| **#283g** | 🔴 **GEREKÇE GÜNCELLEMESİ · #283'ün "ağ" bacağı düştü** | #283 metni güncellenir: gerekçe **zaman ölçeği + yetki/hüküm ayrımı**. İstisna listesi korunur |

---

## 11. Bu ADR'nin bilinçli olarak KARAR VERMEDİĞİ şeyler

Kapsamı dürüst tutmak için:

- **Kanıt üretiminin hangi sinyallerden başlayacağı** — hangi PID/olay hangi
  kategoriye kanıt yazacak, ayrı bir tasarım işidir.
- **Cihaz hükmünün buluta nasıl aktarılacağı** (kuyruk · çakışma · geri dolum).
- **Filo öğrenmesinin cihaza geri beslenip beslenmeyeceği** — beslenirse bu bir
  *kural* değişimi mi yoksa *kanıt* mı, ayrıca kararlaştırılmalı.
- **`predictionEngine`'in zaman ölçeği** — öngörü, hükümle aynı omurgada mı durmalı?
- **Kütüğün bölünmesi** (#4 numaralı açık soru, devir belgesi) — bu ADR'nin konusu
  değil.
