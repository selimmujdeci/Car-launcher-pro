# DORMANT CAPABILITY ACTIVATION P0 — COMPLETION RAPORU

**Tarih:** 2026-08-01 · **Branch:** `feat/fleet-offline-final-local-completion` · **HEAD:** `f89540c`
**Karar:** `DORMANT_CAPABILITY_ACTIVATION_P0_COMPLETE_LOCAL`
**Yapılmadı:** commit · push · deploy · production/staging DB · db push · Music Hub

---

## 1 · EXECUTIVE SUMMARY

PARTIAL raporunda kalan **beş dar açığın tamamı** kapatıldı. Yeni özellik yazılmadı;
var olan ama kullanıcıya ulaşmayan zincirler tamamlandı.

En önemli sonuç: **website production prerender kırığı çözüldü — 48/48 sayfa
üretiliyor, 0 hata.** Kök neden AccountCleanup güvenlik mantığında DEĞİL, onu çağıran
kancadaydı: `useAccountCleanupRuntime()` runtime'ı **render sırasında koşulsuz**
materyalleştiriyordu. Düzeltme tek dosyada; **hiçbir güvenlik kapısı gevşetilmedi** —
sunucu hâlâ `lockdownActive:true · bootStatus:'CHECKING'` fail-closed anlık görüntüsü
verir ve browser-only guard yerinde durur (test bunu ayrıca kilitler).

İkinci önemli sonuç: **"anahtar var" ile "hazır" artık gerçekten ayrı.** Sağlayıcı
hazırlığı iki durumdan **altı duruma** çıkarıldı ve boot'a bağlandı. `CONFIGURED`
bilinçle *hazır sayılmaz*: anahtarın varlığı erişilebilirlik kanıtı değildir.

Üç okuma ucu (trip kanıtı · insight zinciri · araç-kapsamlı izin) gerçek kullanıcı
yollarına — tıklamayla açılan yüzeylere — bağlandı ve gerçek PostgreSQL'de doğrulandı.

---

## 2 · PREFLIGHT (dosya/satır kanıtı)

| İddia | Kanıt | Sonuç |
|---|---|---|
| Prerender throw zinciri | `accountCleanupRuntime.ts:291` `throw ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY` | ✅ |
| Tetikleyen | `useAccountCleanupRuntime.ts:10` — render-time koşulsuz çağrı | ✅ **KÖK** |
| Kapsayan | `dashboard/layout.tsx:57` `<AccountCleanupBootGate>` | ✅ |
| SSR niyeti zaten vardı | `useSyncExternalStore(…, getAccountCleanupServerSnapshot)` | ✅ |
| Server snapshot fail-closed | `accountCleanupRuntime.ts:80` `lockdownActive:true · CHECKING` | ✅ |
| `subscribe`/`getSnapshot` bağlı | satır 139/143 — arrow property | ✅ |
| `setProviderReadiness` çağıranı | **YOK** (0 üretim referansı) | ✅ rapor doğru |
| Trip UI | `VehicleModal.tsx:120` `tripRows` + `buildTripsView` | ✅ |
| `TripView.tripId` | **YOKTU** — yalnız `tripKey` | ⚠️ eklendi |
| `get_subject_evidence(TRIP,…)` | migration 056 · imza uygun | ✅ |
| Fleet Intelligence kartı | `FleetIntelligenceCards` (bu turda mount edilmişti) | ✅ |
| Tekil insight okuma RPC'si | **YOKTU** — yalnız toplam sayaç | ⚠️ eklendi (062) |
| `get_evidence_chain(consumer, consumer_id)` | migration 055 | ✅ |
| Araç-kapsamlı izin RPC | `set_ai_gateway_access(bool, uuid, text)` | ✅ vardı |
| Şirket-geneli izin kartı | `AiGatewayAccessCard` | ✅ vardı |

**Preflight'ta çıkan iki şema gerçeği** (ilk tasarımımı düzeltti):
1. `fleet_insight_evidence` `ai_evidence`'a **FK ile bağlı değil** — kendi defteri
   (`kind · ref_id · metric · value · provenance`). AI Evidence bağı ayrı yoldan:
   `ai_evidence_chain(consumer='FLEET_INSIGHT')`.
2. `_fleet_insight_evidence_guard` `ACTIVE` içgörü için **en az 3 kanıt** ister.

---

## 3 · PRERENDER KÖK NEDENİ

```ts
// ÖNCE — useAccountCleanupRuntime.ts:10
const runtime = getAccountCleanupRuntime();   // SSR'da THROW
```

`getAccountCleanupRuntime()` `typeof window === 'undefined'` iken bilinçli olarak
fırlatır. Kanca bunu **render sırasında koşulsuz** çağırdığı için `BootGate` ile sarılı
**14 dashboard sayfasının tamamı** prerender'da düşüyordu. Derleme başarılıydı; bu
yüzden kırık uzun süre "build geçiyor" sanılıyordu.

---

## 4 · ACCOUNTCLEANUP SSR-SAFE DÜZELTMESİ

```ts
// SONRA
const isBrowser = typeof window !== 'undefined';
const runtime   = isBrowser ? getAccountCleanupRuntime() : null;   // SSR'da MATERYALLEŞMEZ
const snapshot  = useSyncExternalStore(
  runtime ? runtime.subscribe   : _serverSubscribe,
  runtime ? runtime.getSnapshot : getAccountCleanupServerSnapshot,
  getAccountCleanupServerSnapshot,
);
useEffect(() => { void getAccountCleanupRuntime().initialize(); }, []);  // yalnız tarayıcı
```

**Gevşetilmeyenler (test kilidi var):**
- Browser-only guard **kaldırılmadı** — sunucuda hâlâ fırlatır.
- Sunucuda **sahte runtime kurulmadı** (`null`).
- Sunucu anlık görüntüsü fail-closed: `initialized:false · lockdownActive:true · CHECKING`
  → BootGate güvenli ekran render eder, **dashboard içeriği SSR'da sızmaz**.
- `ssr:false` **kullanılmadı**, BootGate **kaldırılmadı**, hata **yutulmadı**.
- Dokunulan AccountCleanup dosyası: **1** (kanca) + BootGate'te `runtime === null` dalı.

**Sonuç:** `✓ Generating static pages (48/48)` · **0 prerender hatası**.

---

## 5 · PROVIDER READINESS BOOT WIRING

Hazırlık **6 duruma** çıkarıldı: `UNKNOWN · NOT_CONFIGURED · CONFIGURED · READY ·
DEGRADED · FAILED`. Bağlayıcı kural: **yalnız `READY` kullanılabilir sayılır**.

| Girdi | Sonuç |
|---|---|
| yapılandırma okunamadı | `UNKNOWN` |
| anahtar yok | `NOT_CONFIGURED` |
| anahtar var, sonda yok | `CONFIGURED` (**hazır DEĞİL**) |
| sonda OK / LIMITED | `READY` / `DEGRADED` |
| ulaşılamadı / red / zaman aşımı | `FAILED` + bounded sınıf |

- **Boot'a bağlandı:** `SystemBoot` Wave 4 — bir kez, **poll yok**.
- Boot'ta **config-only** ölçüm yapılır (sonda `null`): açılışta dış ağa **çıkılmaz**,
  kota harcanmaz. Durum `CONFIGURED`de kalır — **sahte `READY` üretilmez**.
- `remeasureProviderReadiness()` sağlayıcı değişimi için (olay tabanlı).
- Sonda için **bounded timeout** (6 sn); aşılırsa `FAILED/TIMEOUT` (fail-closed).
- **Yerel kaldıraç hazırlığı BYPASS EDEMEZ** — izin verebilir, hazır yapamaz (test kilidi).
- **Secret taşınmaz:** künye yalnız `state · source · measuredAt · lastFailure`.

> ⚠️ **Ölçülen yan etki ve düzeltmesi:** `openRouterKeyService`i SystemBoot'a **statik**
> import etmek, kimlik-bilgisi zincirini (`apiCredentialManager → credentialRegistry →
> aiVoiceService`) boot grafiğine sokup `aiVoiceService`i kısmi mock'layan **5 mevcut
> testi kırdı**. Stash ile birebir doğrulandı. Çözüm: import **dinamikleştirildi** —
> zincir yalnız ölçüm anında yüklenir. 5 test yeniden yeşil.

---

## 6 · TRIP DETAIL + EVIDENCE

**Yol:** Araç listesi → araç modalı → yolculuk satırı → **"Yolculuk kanıtı"** butonu →
`get_subject_evidence(TRIP, tripId)` → `SubjectEvidenceList`.

- `TripView`e `tripId` eklendi (sunucu kimliği); **ekrana basılmaz**, yalnız RPC parametresi.
- Sunucu kimliği yoksa `null` → *"Bu yolculuk sunucuda kimliklenmemiş — kanıt sorulamaz."*
- Mevcut trip satırı zaten metric provenance (`MEASURED`/`ESTIMATED`/`(tahmini)`),
  confidence, sürücü attribution ve *"Veri yok ≠ 0"* ayrımını taşıyor — **korundu**.
- Kanıt okunamazsa **"kanıt yok" DENMEZ**, ayrı hata gösterilir.
- Seçim tabanlı: açılışta toplu okuma yok.

---

## 7 · FLEET INSIGHT + EVIDENCE CHAIN

**Yeni okuma ucu (migration 062, salt-okunur, hesaplama YOK):**
`list_fleet_insights()` + `get_fleet_insight_chain(insight_id)`.

Zincir **üç yönlü** ve gerçek şemaya dayanır:

| direction | Kaynak |
|---|---|
| `LEDGER` | İçgörünün **kendi** kanıt defteri (`fleet_insight_evidence`) |
| `EVIDENCE` | Besleyen AI Evidence (`ai_evidence_chain` `consumer='FLEET_INSIGHT'`) |
| `CONSUMER` | **Ters yön** — beslediği MAVI kararları (`mavi_reasoning_chain`) |

- **Yeni insight motoru yok** — mevcut kayıtlar okunur.
- `SINGLE_VEHICLE_ONLY` etiketi **görünür** (tek araçtan çıkan gözlem "filo içgörüsü"
  sanılmasın).
- İçgörü yoksa: *"Henüz içgörü üretilmedi. Bu 'filo sağlıklı' demek değildir."*
- Kanıtı olmayan içgörüde **sahte zincir üretilmez** (PG B3).
- Ham UUID basılmaz — `ev:xxxxxxxx` kısaltması (test kilidi).

---

## 8 · VEHICLE-SCOPED AI ACCESS

`AiGatewayAccessCard` genişletildi: şirket geneli **+ araç seçici** ile kademeli açılış.

- **Araç izni şirket iznini globalleştirmez** — ayrı kayıt, ayrı sayaç (PG C1:
  `aracIzni=1 · sirketIzni=false · etkin=true`).
- Member **değiştiremez** (PG C2 `DENIED_ROLE`).
- A şirketi B'nin aracını **yönetemez** (PG C3 `DENIED_VEHICLE_SCOPE`).
- Geri alma **anında** etkili (PG C4).
- **Audit** oluşur, reddedilen deneme dahil (PG C5: 3 kayıt).
- Ana şalter kapanınca araç izni **etkisiz** (PG C6).
- Hata mesajları bounded + Türkçe; tanınmayan sunucu yanıtı `UNREADABLE`'a düşer.

---

## 9 · CAROS LAB

*Yetenek Kapıları* ekranı genişletildi: `globalAiSwitch` (ana şalter) · `companyAccess` ·
`vehicleAccess` (adet) · `providerReadiness` · **`providerReadinessAge`** ·
**`providerLastFailure`** · `effectiveAiReady` · sunucu okuma zamanı · çevrimdışı rota
`GRAPH_MISSING` durumu. **Salt-okunur** — hiçbir kapıyı çevirmez.

---

## 10 · GÜVENLİK

- AI Gateway **varsayılan kapalı**; ana şalter **tek başına açmaz** (çift kapı).
- Sağlayıcı hazır değilse `ready=false` — izin verilmiş olsa bile.
- Yerel kaldıraç sağlayıcı hazırlığını **bypass edemez**.
- Tenant izolasyonu: insight listesi/zinciri ve araç izni şirket sınırında (PG A3/B2/C3).
- `anon` tüm yeni RPC'lerde **EXECUTE 0**; tablolara doğrudan erişim yok.
- AccountCleanup lockdown/generation/fail-closed **gevşetilmedi**.
- **Secret taraması temiz** — künyeler bounded, ham hata/anahtar/endpoint taşınmıyor.

---

## 11 · TEST SONUÇLARI

| Kapı | Sonuç |
|---|---|
| **Website build + prerender** | ✅ **Compiled + 48/48 static pages · 0 hata** |
| PG · AI gateway güvenlik (061) | ✅ 16/16 |
| PG · insight + araç kapsamı (062) | ✅ **13/13** |
| PG · AI Mechanic (060) | ✅ 25/25 |
| Root unit | ✅ **454 dosya · 9.857 test** |
| Root integration | ✅ 4/4 · 30/30 |
| Regresyon kasası | ✅ 163/163 |
| Website unit | ✅ **47 dosya · 997 test** |
| Root / Website TypeScript | ✅ temiz |
| Root build | ✅ başarılı |
| ESLint (değişen dosyalar) | ✅ 0 hata |
| Music Hub değişiklik taraması | ✅ **dokunulmadı** (07-29 tarihli, benim turum 08-01 23:0x+) |
| Secret taraması | ✅ sızıntı yok |

**Güncellenen kilitler** (kaldırılmadı, yeni doğru davranışa taşındı):
`dormantCapabilityActivation.test.ts` — `CONFIGURED` artık hazır saymıyor; ayrıca
*"CONFIGURED tek başına HAZIR yapmaz"* kilidi eklendi.

---

## 12 · DEĞİŞEN DOSYALAR

| Dosya | Değişiklik |
|---|---|
| `website/src/security/accountCleanup/useAccountCleanupRuntime.ts` | **SSR-safe kanca (prerender kökü)** |
| `website/src/components/security/AccountCleanupBootGate.tsx` | `runtime === null` güvenli dalı |
| `src/platform/ai/gateway/aiGatewayAccess.ts` | 6 durumlu hazırlık + `isProviderUsable` |
| `src/platform/ai/gateway/aiGatewayAccessRuntime.ts` | hazırlık künyesi (kaynak/yaş/hata) |
| `src/platform/ai/gateway/aiProviderReadinessService.ts` | **YENİ** — ölçüm + bounded timeout |
| `src/platform/system/SystemBoot.ts` | boot wiring (**dinamik** import) |
| `src/components/devtools/screens/CapabilityGatesScreen.tsx` | LAB genişletmesi |
| `supabase/migrations/…062_fleet_insight_readback_p0.sql` | **YENİ** — 2 salt-okunur RPC |
| `supabase/tests/062_insight_and_vehicle_scope_matrix.sql` | **YENİ** — 13 kilit |
| `website/src/lib/lab/intelligenceLabSource.ts` | insight liste + zincir okuma |
| `website/src/components/dashboard/FleetInsightDetail.tsx` | **YENİ** — detay + zincir UI |
| `website/src/components/dashboard/AiGatewayAccessCard.tsx` | araç-kapsamlı izin yüzeyi |
| `website/src/components/dashboard/VehicleModal.tsx` | trip detay + kanıt |
| `website/src/lib/fleet/vehicleTripsView.ts` | `TripView.tripId` |
| `website/src/app/dashboard/fleet/lab/page.tsx` | insight detay + araç listesi |
| `src/__tests__/providerReadinessBoot.test.ts` | **YENİ** — 19 kilit |
| `website/src/__tests__/dormantCompletionWiring.test.tsx` | **YENİ** — 19 kilit |
| `src/__tests__/dormantCapabilityActivation.test.ts` | kilit güncellemesi |

---

## 13 · DOKUNULMAYAN ALANLAR

**Music Hub** (`localMusicService` · `mediaService` · `streamMusicService` ·
`carosMediaLayer`) — mtime **2026-07-29**, benim turum **2026-08-01 23:0x+**.

**AccountCleanup** — yalnız prerender kökü kadar: **1 kanca dosyası** + BootGate'te bir
null dalı. Lockdown/coordinator/ledger/generation mantığına **dokunulmadı**.

Ayrıca dokunulmadı: AI Evidence · MAVI Reasoning motorları (tek otorite kaldı) ·
Trip motoru · Vehicle Identity · production/staging.

---

## 14 · AÇIK BORÇLAR

1. **Migration 061 ve 062 üretime uygulanmadı** — yalnız yerel `supabase_db_fleetval`.
2. **`mavi_ai_gateway` ana şalteri hiçbir ortamda açık değil** — bilinçli; operatör kararı.
3. **Erişilebilirlik sondası boot'ta çalıştırılmıyor** (config-only). Gerçek `READY`
   ölçümü için bir sonda adaptörü bağlanmalı; şu an durum dürüstçe `CONFIGURED`de kalır.
4. **Gerçek araç doğrulaması yok** — hiçbir yüzey gerçek araç verisiyle gözlenmedi;
   PG matrisleri elle kurulmuş fikstürlerle çalışır.
5. Website ESLint `src/**` ignore ediyor (kütük #287) — bu paketten bağımsız.

---

## 15 · NİHAİ KARAR

```
DORMANT_CAPABILITY_ACTIVATION_P0_COMPLETE_LOCAL
```

Kabul kriterlerinin 12'si de karşılandı: prerender **tamamen** geçiyor (48/48),
AccountCleanup SSR güvenliği korundu, hazırlık boot'ta gerçek durumla besleniyor,
erişim+hazırlık birlikte doğru efektif durumu üretiyor, trip ve insight kanıtı gerçek
tıklama yollarından okunuyor, araç-kapsamlı izin UI'ı çalışıyor, cross-tenant ve rol
izolasyonu PG'de kanıtlandı, secret/ham identifier sızıntısı yok, otoriteler değişmedi,
commit/push/deploy/db push yapılmadı.

| Kapı | Karar |
|---|---|
| `websitePrerenderVerdict` | **PASS** — 48/48 sayfa, 0 hata |
| `accountCleanupRegressionVerdict` | **PASS** — guard korundu, fail-closed snapshot kilitlendi, 997 website testi yeşil |
| `providerReadinessVerdict` | **PASS** — 6 durum, boot'a bağlı, bounded timeout, secret yok |
| `tripEvidenceReadbackVerdict` | **PASS** — gerçek tıklama yolu + RPC + durum ayrımı |
| `insightEvidenceChainVerdict` | **PASS** — 3 yönlü gerçek zincir, PG 13/13 |
| `vehicleScopedAiAccessVerdict` | **PASS** — PG C1–C6 |
| `productionValidationVerdict` | **BLOCKED** — 061/062 üretime uygulanmadı; ana şalter kapalı |
| `realVehicleValidationVerdict` | **BLOCKED_REAL_VEHICLE** — gerçek araç verisiyle hiçbir yüzey gözlenmedi |

---

*Elle yazılmış fikstürle çalışan hiçbir yüzey gerçek araç doğrulaması olarak
sunulmadı. Kanıtsız hiçbir kapıya PASS verilmedi.*
