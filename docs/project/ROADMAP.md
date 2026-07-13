# CarOS Pro — ROADMAP

> Sıra değiştirilmez. Tamamlanan işler tekrar yazılmaz. Bağımlılık sırası korunur.
> Durum kaynağı: `git log` + `gh pr list` + `docs/DEVICE_VALIDATION_LEDGER.md`.

**Legend:** ✅ tamam · 🟡 devam · ⬜ bekliyor · 🔴 cihaz bekliyor · 🟢 cihazda doğrulandı

---

## Phase A — Platform Core

| # | Madde | Durum | PR | Commit | Ledger | CI | Device |
|---|-------|-------|----|--------|--------|----|--------|
| W2 | Vehicle HAL Wiring | ✅ | #65 | c4d6da3 | #49 | yeşil | 🔴 |
| W3 | Capability Registry Wiring | ✅ | #74 | 518a7cb | #58 | yeşil | 🔴 |
| W3 | Platform Event Bus Ownership | ✅ | #66 | 47adf17 | #50 | yeşil | 🟢 (boot tek bus) |
| W4 | Event Bus Wiring (Capability→bus) | ✅ | #75 | 6959fc5 | #59 | yeşil | 🔴 |
| W4A | HAL adapter batch ingest | ✅ | #67 | b76cf32 | #51 | yeşil | 🔴 |
| W4B | HAL kaynak-kaybı fail-closed | ✅ | #69 | 2e60f03 | #53 | yeşil | 🟢 (ingest 5→3) |
| W4C | HAL → Event Bus bridge | ✅ | #70 | 68d6ad9 | #54 | yeşil | 🟢 (publish/sn 0.37) |
| W4E | Platform runtime diagnostics | ✅ | #68 | 5d56775 | #52 | yeşil | 🟢 (rapor gövdesi) |

---

## Phase B — Deep Scan (W5) 🟡 AKTİF

| # | Madde | Durum | PR | Ledger | Device |
|---|-------|-------|----|--------|--------|
| W5-1 | Runtime Ownership | ✅ | #76 | #60 | 🔴 |
| W5-2 | Event Bus Bridge | 🟡 AÇIK | #77 | #61 | 🔴 |
| W5-3 | Offline-only Run | ⬜ SIRADA — **analiz TAMAM**, kod YOK | — | — | — |
| W5-4 | Capability Evidence | ⬜ | — | — | — |
| W5-5 | Gated Active Discovery | ⬜ | — | — | — |

**W5 notu:** Foundation (Deep Scan #44–#47, Capability #48/#52, HAL #49/#51, Event Bus #50)
main'de PASİF idi. W5 serisi bunu adım adım aktive eder — her adım fail-closed + gated.
Aktif ECU/PID/DID sorgusu ancak W5-5'te (offline-only + capability evidence koşulları sağlanınca) açılır.

---

## Phase C — Driver Intelligence

| # | Madde | Durum |
|---|-------|-------|
| — | Driver DNA | ⬜ |
| — | Prediction Engine | ⬜ |
| — | Assistant Context | ⬜ (temel: Birleşik Asistan Bağlamı PR #43 MERGED, Ledger #28 🔴) |

---

## Phase D — Commercial Release

| # | Madde | Durum |
|---|-------|-------|
| — | Device Validation (araç kanıtı serisi) | ⬜ |
| — | Mali-400 optimizasyon | ⬜ |
| — | Vehicle Validation (Renault Trafic / T507 / K24) | ⬜ |
| — | Beta | ⬜ |
| — | Production | ⬜ |
| — | Gömülü AI anahtarı temizliği (SATIŞ BLOCKER, PR #73) | 🟡 AÇIK |
| — | Supabase anon-grant sıkılaştırma (SQL #32–34) | 🟡 AÇIK |

---

## Bir sonraki hedef

**W5-3 — Deep Scan Offline-only Run.** Salt-okunur analiz **TAMAMLANDI** (kod/branch/PR yazılmadı).

### Analiz sonucu — kod kanıtlı bulgular

1. **Sekans tuzağı DOĞRULANDI.** `DEEP_SCAN_PHASE_SEQUENCE` aktif faz (`vehicle_identity`) ile başlar.
   `deepScanOrchestrator.ts:402-408` — aktif fazda `ignitionConfirmed !== true` ise `_index`
   **artmadan** dönülür; `run()` (satır 465) ilerleme yoksa döngüyü kırar. `deepScanIgnitionSource`
   singleton'ında **hiç provider yok** → `getConfirmedValue()` daima `null`. Sonuç: bugün
   `run()` faz-0'da bloke olur, 6 offline faza **hiç ulaşılamaz**.

2. **🔴 PERSISTENCE ZEHİRLENME TUZAĞI (en kritik).** Offline fazlar mevcut sırayla sonuna kadar
   koşturulursa `_finalize()` (satır 504) → `runtime.completeScan()` → `persistence.completeScan()`
   çalışır. `deepScanPersistence.ts:430-436`: `isCompleteCall && status==='completed' && mode==='FULL_SCAN'`
   → **`hasCompletedFullScan = true`**. Yani **hiç ECU/PID/DID keşfedilmemiş boş bir tarama**
   "tam tarama yapıldı" diye kaydedilir; sonraki GERÇEK tarama `resolveMode()` ile
   **CHANGE_CHECK**'e düşer ve araç bir daha asla tam taranmaz. W5-3 bunu **yapmamalıdır**.

3. **🔴 AKTİF-KAYIT KAPISI TUZAĞI.** `_applyResult()` (`deepScanOrchestrator.ts:281-324`) handler
   sonucundaki `ecus/pids/dids/firmware` alanlarını **faz sınıfına bakmadan** runtime'ın aktif-kayıt
   API'lerine yollar. Runtime `_acceptActiveRecord()` (`deepScanRuntimeService.ts:349-353`) kontak
   `true` değilse `_requireIgnition()` çağırır → durum **`waiting_for_ignition`'a düşer** + uyarı +
   `ignition_required` olayı. Yani bir OFFLINE faz pasif olarak yakalanmış PID/DID döndürürse,
   **hiç aktif sorgu göndermeden** durum bozulur. Kontak-serbest tek yol: `recordChangeDetection()`
   (`deepScanRuntimeService.ts:401-410` — yalnız `_isMutable` ister).

4. **Aktif fazı "atlayarak ilerlet" çözümü YASAK** — 2 ve 3'e birden açılır, sessizce boş tarama üretir.

5. **State machine offline pass'e İZİN VERİYOR (doğrulandı).** `startScan` kontak `null` iken
   `waiting_for_ignition`'a girer (`deepScanRuntimeService.ts:262`) ama bu durum **mutable**
   (`_isMutable`: scanId var + terminal değil). `updatePhase(offline_faz)` → `canRunPhase` true →
   `analyzing`. Yani paylaşılan runtime üzerinden offline pass koşturmak **mümkün ve meşru**.

### Mimari karar (W5-3)

**Orchestrator'a tip-seviyesinde ayrılmış, SONLANDIRMAYAN `runOfflinePass()` yüzeyi.**
(Ayrı runtime örneği önerisi ELENDİ: iki Deep Scan state'i sessizce ayrışabilir; tek state machine
= tek doğruluk kaynağı, W5-2 köprüsü ve wiring status aynı yeri gözler.)

- Yalnız `OFFLINE_PHASES` üzerinde döner; `DEEP_SCAN_PHASE_SEQUENCE` index'ine dokunmaz →
  aktif faz **kümede yok** (atlanmıyor bile) → sekans tuzağı yapısal olarak yok olur.
- **`_finalize()` / `completeScan()` ASLA çağrılmaz** → `hasCompletedFullScan` dokunulmaz →
  mayın 2 etkisiz. Persistence yalnız `saveSnapshot()` checkpoint'i (isCompleteCall=false).
- **Keşif payload'ı runtime'a YOLLANMAZ** (`ecus/pids/dids/firmware` yok sayılır) → mayın 3 etkisiz.
  Açık kalan tek yol: `progress` + `changedFirmware/changedEcu` (kontak-serbest).
- **Pass sonunda `runtime.reset()` ZORUNLU** (`try/finally`): `startScan` yalnız `idle`'dan çalışır
  (`deepScanRuntimeService.ts:242`); runtime `analyzing`'de bırakılırsa kontak geldiğinde
  gerçek tarama **hiç başlayamaz**. Ek kilit: runtime `idle` değilse pass koşmayı REDDET.
- **Handler map tipi `Partial<Record<OfflinePhase, PhaseHandler>>`** → aktif faza handler bağlamak
  **derleme hatası**. Wiring tipi `OwnedOrchestrator` → `OfflineOnlyOrchestrator`; `start()/run()/
  runNextPhase()` hâlâ tipte YOK → W5-1'in "aktif tarama başlatamaz" garantisi korunur.
- **Tetikleyici:** boot wave DEĞİL. **Parmak izi hash'i hazır** olduğunda (hash yoksa persistence
  zaten sessiz no-op — `deepScanPersistence.ts:522-523`), hash başına **tek sefer**, single-flight,
  `requestIdleCallback` ile ötelenmiş. SystemBoot **Wave 3**, `startAutomaticVehicleFingerprint()`'ten
  SONRA (hash ancak o zaman var).
- **Bütçe:** 6 yerel faz, OBD I/O yok, tek atış; periyodik tick EKLENMEZ; hot-path'e (3Hz) girmez.
- **⚠️ Sahte progress:** `updatePhase` `PHASE_PROGRESS_FLOOR` uygular → `capability_analysis` = **%70**.
  Offline pass hiç iş yapmadan progress'i %70→%97'ye taşır. **UI'ya BAĞLANMAZ**; wiring status'ta
  `progressPercent` yerine `offlinePassPhaseCount` raporlanır.

### Atomik PR sırası

| Sıra | PR | Kapsam | Bağımlılık |
|------|----|--------|-----------|
| 1️⃣ | **W5-3a — Offline yürütme yüzeyi + koruma bandı** | `OfflinePhase` tipi, `OFFLINE_PHASE_SEQUENCE`, `runOfflinePass()`, offline-only handler map, `_finalize` çağrılmaz, payload gating, `reset()` in finally. **Hiçbir yerden ÇAĞRILMAZ → çalışma zamanı davranışı DEĞİŞMEZ.** | yok — **ilk uygulanacak PR** |
| 2️⃣ | W5-3b — Tetikleyici + wiring + teşhis | `OfflineOnlyOrchestrator`, hash-kapılı tek-sefer tetikleyici (SystemBoot Wave 3), `diagnosticSections.ts`'e deepScan bloğu (bugün YOK — sayaç-only) | **PR #77 (W5-2) merge** |
| 3️⃣ | W5-3c — İlk anlamlı offline handler (W5-4'e kayabilir) | yalnız `change_detection`: persistence kaydı ↔ pasif `discoveryCaptureService` gözlemleri → `recordChangeDetection` (kontak-serbest tek yol) | W5-3b |

**Regresyon kilidi:** `deepScanRuntimeService.test.ts:739-747` SystemBoot kaynak-metin kilidi
(`startScan`/`runNextPhase`/`deepScanOrchestrator` dizgeleri YASAK). W5-3b'de teknik olarak yeşil
kalır ama **niyeti değişir** → CLAUDE.md gereği kilit KALDIRILMAZ, GÜNCELLENİR: "SystemBoot offline
pass wiring'i içerir AMA `startScan`/`runNextPhase` içermez" + yeni kilit "offline pass
`hasCompletedFullScan`'i DEĞİŞTİRMEZ". `regression.guards.test.ts`'te Deep Scan kilidi yok.

**Ledger kabul ölçütleri (öneri):** W5-3a → cihazda davranış değişmemeli (boot sonrası `deep_scan.*`
olay sayısı 0). W5-3b → gerçek araçta "Tanı Gönder" raporunda `offlinePassCount === 1` (ikinci
bağlantıda hâlâ 1), `deep_scan.phase.completed` = 6, `scan.completed`/`report.ready` = **0**,
`hasCompletedFullScan` **false** kalır, OBD veri akışı etkilenmez.

**⚠️ Belirsiz kalan:** JS tarafında **OBD TX/komut sayacı yok** (`obdService.getTransportStats()`
yalnız transport/connected/reconnect verir) → "sıfır aktif sorgu" bir sayaçla runtime'da
KANITLANAMAZ; garanti tip + faz filtresi + handler-yokluğu üzerinden kurulur.

---

## Doküman altyapısı

| # | Madde | Durum | PR | Commit |
|---|-------|-------|----|--------|
| — | `docs/project/` çalışma altyapısı (9 doküman, kod YOK) | ✅ | #78 | 2ecf627 |
