# AI MECHANIC CORE P1 — RAPOR

**Tarih:** 2026-08-01 · **Branch:** `feat/fleet-offline-final-local-completion` · **HEAD:** `f89540c`
**Karar:** `COMPLETE_LOCAL`

---

## 1 · EN ÖNEMLİ MİMARİ KARAR: YENİ TABLO YOK, ANALİZ TÜRETİLİR

AI Mechanic **karar üretmez**. Bu ilke bir yorum satırıyla değil, **şemayla** zorlandı:

```
AI Evidence Engine  →  MAVI Reasoning Engine  →  AI Mechanic
    (kanıt)                  (KARAR)              (yorum)
```

Migration 060 **hiçbir tablo oluşturmaz**. Analiz kalıcı olsaydı ikinci bir gerçek
kaynağı olurdu: MAVI'de karar `EXPIRED`/`CONFLICTED` olunca saklanmış analiz eskir ve
iki otorite çelişirdi. Bu yüzden analiz **her okumada karardan türetilir**.

`analysisId` deterministiktir: `'mech:' || reasoning_id`. Replay yeni analiz üretmez.

Kilit: PG matrisi **K1** — `information_schema.tables` içinde `%mechanic%` tablo sayısı = 0.

---

## 2 · KANONİK MODEL (§1)

`src/platform/aiMechanic/aiMechanicModel.ts` — saf; I/O · timer · `Date.now()` · React · LLM yok.

| Alan | Kaynak |
|---|---|
| `analysisId` | `mech:<reasoningId>` (deterministik) |
| `vehicleId` · `driverId` · `tripId` | MAVI kararından |
| `reasoningId` | MAVI kararı — analizin **tek** dayanağı |
| `evidenceIds` | `mavi_reasoning_evidence` bağı (referans; kanıt kopyalanmaz) |
| `diagnosticCategory` | niyet + kanıt metriğinden çözülür |
| `severity` | **türetilmiş sunum** — karar değil |
| `confidence` | MAVI'den **AYNEN** taşınır |
| `confidenceReason` | MAVI bounded kodu |
| `state` | MAVI kararından |
| `createdAt` | MAVI kararından (ISO-8601) |

---

## 3 · KATEGORİLER (§2) VE KAPSAM DARALTMASI

`ENGINE · COOLING · BATTERY · FUEL · OBD · TEMPERATURE · CONNECTIVITY · UNKNOWN`

**Kapsam bilinçli olarak dardır.** `DRIVER` · `FLEET` · `TRIP_STATUS` · `LOCATION` niyetleri
mekanik teşhis değildir → `null` döner ve analiz **hiç üretilmez** (Driver Coach / Fleet
Advisor alanı). `null` ile `UNKNOWN` karıştırılmaz: `null` = "söyleyecek sözüm yok",
`UNKNOWN` = "mekanik ama çözülemedi".

**COOLING uydurulmaz.** Reasoning tarafında `COOLING` niyeti YOKTUR; soğutma
`TEMPERATURE` içinde yaşar. Ayrım **yalnız gerçek kanıt metriği**
(`coolant`/`radiator`/`thermostat`/`water_temp`/`fan`) varsa yapılır; yoksa `TEMPERATURE`
kalır. Olmayan bir alt sistemi suçlamak yasak.

> ⚠️ **Bilinen sınır:** head unit tarafı (`aiMechanicSources.ts`) kanıt **metrik adlarını
> görmez** (defter taşımıyor) → cihazda COOLING ayrımı YAPILAMAZ, `TEMPERATURE` kalır.
> Sunucu tarafı metriği görür ve ayırır. Bu bilinçli bir asimetridir: uydurulmuş bir
> COOLING teşhisi yerine daha genel ama **doğru** olan `TEMPERATURE` tercih edildi.

---

## 4 · KAYNAKLAR (§3)

`aiMechanicSources.ts` **yalnız** `readMaviReasoning()` okur. Başka hiçbir modül
(OBD · Trip · DNA · Fleet · HAL) doğrudan okunmaz — kararın arkasından ham sinyale
bakmak MAVI otoritesini delerdi.

---

## 5 · ANALİZ DURUMLARI (§4)

`SUPPORTED · UNSUPPORTED · UNKNOWN · INSUFFICIENT_EVIDENCE · CONFLICTED_EVIDENCE · EXPIRED_EVIDENCE`

Her biri MAVI `decision` kümesinden **bire bir** türer. İki farklı "yok" ayrılır:

- `REJECTED` → **analiz üretilmez** (girdi hatası, teşhis değil)
- **tanınmayan** karar kodu → `UNKNOWN` analizi (fail-closed). *Bu, geliştirme sırasında
  bulunan gerçek bir kusurdu:* ilk sürüm tanınmayan kararı sessizce gizliyordu, bu da
  AI Mechanic sayımının MAVI sayımından sessizce sapmasına yol açardı.

**Şiddet karar değildir.** `SUPPORTED`→`NONE`, `UNSUPPORTED`+yüksek güven→`CRITICAL`,
+orta/düşük→`WARNING`, güven `UNKNOWN`→`UNKNOWN`. **Çelişki bilinçle `WARNING` DEĞİL**:
çelişki arıza kanıtı değil bilgi eksikliğidir; onu uyarıya çevirmek MAVI'nin "çelişkide
karar üretilmez" kuralını arkadan dolanmak olurdu.

---

## 6 · ÖNERİ YOKTUR (§5)

Öneri · tamir tavsiyesi · parça · maliyet · aciliyet talimatı **yok**. Kilit test, analiz
nesnesinde `message`/`summary`/`text`/`recommendation`/`repair`/`part`/`cost`/`action`
alanlarının **bulunmadığını** ve alan kümesinin kanonik modelle **birebir** olduğunu
doğrular (sızıntı kilidi).

---

## 7 · MUHAKEME ZİNCİRİ (§6)

`get_ai_mechanic_chain('mech:<uuid>')` → `get_reasoning_chain()` delegasyonu.
**Yeni zincir depolanmaz**; zincirin tek gerçek kaynağı MAVI'de kalır. Tenant kapısı
`get_reasoning_chain` içindedir ve tekrarlanmaz (iki kapı = iki gerçek kaynağı).

---

## 8 · CAROS LAB (§7) VE FLEET DASHBOARD (§8)

- **CAROS LAB → AI · AI Mechanic** (`AiMechanicScreen.tsx`): analiz sayısı · kategori ·
  güven · reasoning · evidence · unknown · conflict · expired. Açılışta tek okuma +
  elle YENİLE; timer/abonelik/komut yok. Boş liste açıkça *"'sorun yok' DEĞİL"* der.
- **Fleet Dashboard → AI Mechanic** (`AiMechanicSummaryCard.tsx`, salt-okunur):
  `get_ai_mechanic_summary()` kartları. Bilinmeyen değer `—` (0 değil); analiz yoksa
  boş kart değil **gerekçe** gösterilir. Okuma bağımsızdır — düşerse karar panosu ve
  filo paneli çalışmaya devam eder.

---

## 9 · GERÇEK PostgreSQL DOĞRULAMASI (§9)

`supabase/tests/060_ai_mechanic_matrix.sql` · PostgreSQL **17.6** (`supabase_db_fleetval`)

**25 / 25 PASS**

| Grup | Kapsam |
|---|---|
| A1–A5 | TS↔SQL parite: kapsam dışı niyet · kategori eşleme · REJECTED · şiddet · COOLING |
| B1–B3b | Fail-closed: oturumsuz analiz/özet yok · bozuk `analysis_id` boş döner |
| C1–C4 | Evidence+Reasoning entegrasyonu: kanıtsız karar · kanıt referansı · güven aynen · COOLING |
| D1 | Kapsam dışı niyet (FLEET) analiz üretmez |
| E1 | Replay: aynı karar → tek analiz, aynı kimlik |
| F1–F3 | Cross-tenant: liste ve zincir kapalı |
| G1–G2 | Transfer: eski sahip geçmişini korur, yeni sahip **göremez** |
| H1 | Expiry: MAVI `EXPIRED` → analiz `EXPIRED`, kayıt silinmez |
| I1–I2 | Özet: boş kümede oran `NULL` (0 değil) · dolu kümede liste ile tutarlı |
| J1 | `anon` EXECUTE izni = 0 |
| K1 | `%mechanic%` tablo sayısı = 0 |

### Çürütülen iki test kurgusu (dürüstlük kaydı)

1. **Transfer:** kararın `company_id`'sini değiştirerek devir taklidi
   `_mavi_reasoning_immutable_guard` tarafından **reddedildi** — doğru motor davranışı.
   Test, gerçek riske çevrildi: *araç el değiştirince yeni sahip eski teşhisleri görüyor mu?*
2. **Expiry:** `expires_at`'i geçmişe çekmek `mr_expiry_valid` kısıtına takıldı
   (süre dolumu **sahtelenemiyor**). Kısa TTL denemesi de tutmadı → §11'deki anomali.
   Test motorun kendi yetkili API'sine (`mavi_reasoning_transition`) çevrildi.

---

## 10 · REGRESYON (§10)

| Kapı | Sonuç |
|---|---|
| Gerçek PostgreSQL (060 matrisi) | ✅ **25/25** |
| AI Mechanic birim testleri | ✅ **30/30** |
| Root unit (Reasoning · Evidence · Fleet · Driver DNA · Trip · Vehicle Identity dâhil) | ✅ **452 dosya · 9816 test** |
| Root integration | ✅ 4/4 · 30/30 |
| Regresyon kasası (`npm run guard`) | ✅ 163/163 |
| Website unit | ✅ 45 dosya · 965 test |
| Root TypeScript | ✅ temiz |
| Website TypeScript | ✅ temiz |
| Root build (`npm run build`) | ✅ başarılı |
| Root ESLint (yeni dosyalar) | ✅ 0 hata |
| Website ESLint | ⚠️ `src/**` **ignore** ediliyor — bilinen borç (kütük #287), bu paketten bağımsız |

---

## 11 · AÇIK BULGU — REASONING ENGINE TTL ANOMALİSİ

Bu pakette **düzeltilmedi** (kural: yeni/değişik karar motoru yasak). Kütük **#307**.

```
mavi_reason(..., p_ttl := interval '1 second')
  · KANITSIZ yol  → RECORDED  + gerçek 1 sn TTL      ✅
  · KANITLI  yol  → DUPLICATE + 24 saat VARSAYILAN   ❌
```

Yepyeni araç + yepyeni kanıt metriğiyle bile yeniden üretildi; `p_ttl` bu yolda
uygulanmıyor görünüyor. Kök neden **belirlenmedi** → ayrı PR'a bırakıldı.

---

## 12 · DEĞİŞEN / EKLENEN DOSYALAR

| Dosya | Tür |
|---|---|
| `supabase/migrations/20260801000060_ai_mechanic_core_p1.sql` | YENİ · salt-okunur SQL yüzeyi |
| `supabase/tests/060_ai_mechanic_matrix.sql` | YENİ · 25 kilit |
| `src/platform/aiMechanic/aiMechanicModel.ts` | YENİ · saf kanonik model |
| `src/platform/aiMechanic/aiMechanicSources.ts` | YENİ · tek okuma katmanı |
| `src/components/devtools/screens/AiMechanicScreen.tsx` | YENİ · CAROS LAB ekranı |
| `src/__tests__/aiMechanicCore.test.ts` | YENİ · 30 kilit |
| `website/src/lib/fleet/aiMechanicView.ts` | YENİ · saf görünüm |
| `website/src/lib/lab/aiMechanicLabSource.ts` | YENİ · okuma katmanı |
| `website/src/components/dashboard/AiMechanicSummaryCard.tsx` | YENİ · read-only kart |
| `src/platform/devtools/carosLabCatalog.ts` | DÜZENLENDİ · katalog kaydı |
| `src/components/devtools/carosLabScreenMap.tsx` | DÜZENLENDİ · lazy ekran |
| `website/src/app/dashboard/fleet/lab/page.tsx` | DÜZENLENDİ · kart bağlandı |
| `docs/DEVICE_VALIDATION_LEDGER.md` | DÜZENLENDİ · 🔴 #306 · #307 |

---

## 13 · KAPILAR

| Kapı | Karar |
|---|---|
| `reasoningEngineRegressionVerdict` | **PASS** — reasoning testleri ve 057/058/059 davranışı bozulmadı; TTL anomalisi **mevcut** ve bu paketle oluşmadı (#307) |
| `evidenceEngineRegressionVerdict` | **PASS** — evidence testleri yeşil; kanıt yalnız referansla okundu, yazma yok |
| `aiMechanicRegressionVerdict` | **PASS** — 25/25 PG + 30/30 birim |
| `realVehicleValidationVerdict` | **BLOCKED_REAL_VEHICLE** — gerçek araç kanıtından üretilmiş karar hiç gözlenmedi (#306) |
| `productionValidationVerdict` | **BLOCKED_REAL_VEHICLE** — migration 060 üretime **uygulanmadı**; yalnız yerel PostgreSQL |

---

## 14 · YAPILMAYANLAR

Commit yok · push yok · deploy yok · OTA yok · APK dağıtımı yok · production DB
değişikliği yok. Migration yalnız **yerel** `supabase_db_fleetval` üzerinde koşuldu.

İleride bu modülün üzerine kurulacak **Predictive Maintenance · Service Advisor ·
Repair Advisor** için P1 bilinçli olarak yalnız teşhis bıraktı: buraya sızacak tek bir
öneri, o katmanların dayanağını kirletirdi.
