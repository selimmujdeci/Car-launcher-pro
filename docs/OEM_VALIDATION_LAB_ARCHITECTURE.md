# OEM Validation Lab — Mimari

> **Durum:** PR-1 (Host Foundation) uygulandı. Cihaz/performans/sensör/araç katmanları
> sonraki PR'lardadır — bu dokümanda **tasarlanmış ama henüz yazılmamış** olarak işaretlidir.
> Kütük: `docs/DEVICE_VALIDATION_LEDGER.md` · Kullanım: `docs/qa/OEM_VALIDATION_LAB_RUNBOOK.md`

---

## 1. Tasarım anayasası

CarOS Pro bir head unit'e gömülüp **3. taraf üreticilere satılacak**. Bir OEM
"çalışıyor" demez; **kanıt** ister. Lab'in tek işi budur: bir yapının nereye kadar
kanıtlandığını **abartmadan** söylemek.

| # | İlke | Neden (ihlal edilirse ne olur) |
|---|------|-------------------------------|
| A1 | **Kanıt yoksa iddia yok** | Cihazda koşmamış bir testin "yeşil" sayılması, sahada patlayan yazılımı "OEM_READY" diye satmaktır. |
| A2 | **Atlanan test skoru şişirmez** | Klasik runner'lar atlananı paydadan düşürür → cihaz testleri hiç koşmadan %100 çıkar. Burada skor ve **coverage AYRI** iki sayıdır; verdict ikisini birden ister. |
| A3 | **"Koşamadı" ≠ "geçti" ≠ "düştü"** | Araç eksikliği (Java/aapt2 yok) `SKIPPED_NA`, ortam çöküşü `INCOMPLETE`, gerçek kusur `FAIL`. Üçünü karıştırmak yanlış alarm veya sahte güven üretir. |
| A4 | **Verdict yalnız AŞAĞI iner** | Skor kapısı, coverage tavanı ve profil tavanı bağımsızdır; hiçbiri verdict'i yükseltemez. Cihaz kanıtı 0 iken skor 100 olsa dahi tavan `HOST_VERIFIED`. |
| A5 | **Fail-soft, çökmez** | Bozuk tek faz tüm kanıtı yok edemez: faz izole edilir, kalanlar koşar. |
| A6 | **Tek gerçek kaynak** | `report.json`. Markdown raporlar ondan **render** edilir; ikinci bir hesap yeri yoktur (ayrışma imkânsız). |
| A7 | **Ham çıktı git'e girmez** | Cihaz logu/APK hash'i/yerel yol → `docs-local/qa-runs/` (gitignore). Rapora giden her metin **redaksiyondan** geçer. |
| A8 | **Ürün runtime'ına dokunmaz** | Lab `src/` altındaki uygulamayı import etmez, SystemBoot'a bağlanmaz. Gözlemci olmayan gözlemci yoktur — ama etkisi sıfıra yakın olmalıdır. |
| A9 | **Yeni ağır bağımlılık yok** | Yalnız Node built-in (`node:fs`, `node:child_process`, `node:crypto`, `node:path`). Ticari lisans riski ve tedarik zinciri yüzeyi büyümez (CLAUDE.md §Lisans). |

**Tasarım testi (her yeni faz için):** *"Bu faz bir OEM denetçisinin soracağı bir soruya
kanıtla cevap veriyor mu, yoksa sadece bir sayı mı üretiyor?"*

---

## 2. Klasör yapısı

```
qa/
  core/
    result-types.mjs     # durum sözlüğü: PHASE_RESULT, VERDICT, SEVERITY, CAPABILITY
    registry.mjs         # faz defteri + definePhase() sözleşmesi
    context.mjs          # değişmez koşu bağlamı + host yetenek tespiti
    orchestrator.mjs     # deterministik, izole, fail-soft faz koşumu
    scoring.mjs          # coverage-aware ağırlıklı skor
    verdict.mjs          # skor + coverage + profil → tek karar
    artifact-store.mjs   # bounded + redakte artefakt deposu
    exec.mjs             # shell'siz, zaman-sınırlı alt-süreç
    redact.mjs           # sır + kişisel yol redaksiyonu (son kapı)
  phases/
    _phase.mjs           # faz yazarının tek import'u (plugin sözleşmesi)
    01-build-validation.mjs
  profiles/
    _schema.mjs          # profil doğrulama (yapısal kilitler dahil)
    host-only.json
  thresholds/
    global.json          # eşikler, ağırlık çarpanları, sınırlar
  config/
    manifest-expectations.json   # izin yüzeyi sözleşmesi
  reports/
    report-schema.mjs    # report.json şeması (v1) + doğrulama
    json-writer.mjs      # stream yazım
    markdown-writer.mjs  # SAF render (report → markdown)
  index.mjs              # runLab() + CLI (import yan etkisiz)

docs/qa/OEM_VALIDATION_LAB_RUNBOOK.md     # nasıl koşulur, çıktı nasıl okunur
docs-local/qa-runs/<timestamp>/           # koşu çıktıları — GIT'E GİRMEZ
src/__tests__/oemValidationLab.test.ts    # 62 sözleşme testi
```

**Neden `.mjs` ve neden `src/` dışında?** Lab bir **build/CI aracıdır**, ürünün parçası
değil. `src/` altına konsaydı `tsc -b` grafiğine ve Vite bundle'ına girerdi. `scripts/*.mjs`
(mevcut `verify-webview-compat.mjs`, `bump-version.mjs`) ile aynı konvansiyon.
**Testler** ise repo konvansiyonu gereği `src/__tests__/` altındadır (vitest `include`
oradan tarar) ve `.mjs` modüllerini doğrudan import eder — `tsconfig.app.json`
`src/__tests__`'i dışladığı için tip grafiğini kirletmez.

---

## 3. Faz-yetenek matrisi

Her faz, çalışabilmek için gereken **yetenekleri** (`requires`) beyan eder. Yetenek yoksa
faz **koşmaz** — ve bu bir başarı değil, bir **kanıt boşluğudur**.

| Faz | PR | Kategori | Ağırlık | Gerektirdiği yetenek | Safety-critical |
|-----|----|----|---|----------------------|-----------------|
| `build-validation` | **PR-1 ✅** | build | 3 | `host.repo` | hayır |
| `static-security` | PR-2 | security | 2 (×2) | `host.repo` | hayır |
| `device-transport` | PR-3 | general | 2 | `device.adb` | hayır |
| `install-boot` | PR-3 | general | 3 | `device.adb`, `device.app` | **evet** |
| `runtime-performance` | PR-4 | performance | 3 (×2) | `device.app`, `device.perf` | hayır |
| `sensor-integrity` | PR-5 | vehicle | 3 (×2) | `device.sensors` | **evet** |
| `obd-live` | PR-6 | vehicle | 3 (×2) | `vehicle.obd` | **evet** |
| `safety-overlay` | PR-6 | vehicle | 3 (×2) | `device.app`, `vehicle.can` | **evet** |

Yetenek uzayı (`CAPABILITY`): `host.{node,repo,dist,apk,aapt,apksigner,gradle,java}` ·
`device.{adb,app,sensors,perf}` · `vehicle.{obd,can}`.

**Yapısal kilit:** `detectHostCapabilities()` yalnız `host.*` döndürebilir — `device.*`
sızdırırsa **hata fırlatır**. Yani host lane'de cihaz yeteneği "kazara" doğru olamaz.

---

## 4. Profil sistemi

Profil = *"bu koşu neyi taahhüt ediyor?"*

```jsonc
{
  "id": "host-only",
  "lane": "host",                  // host | device | vehicle
  "maxVerdict": "HOST_VERIFIED",   // tavan
  "phases": ["build-validation"],  // koşulacak fazlar (allowlist)
  "phaseTimeoutMs": 600000,
  "build": { "variant": "debug", "buildIfMissing": false },
  "manualFallbacks": {}            // { fazId: "elle nasıl doğrulanır" }
}
```

Geçersiz profil **sessizce varsayılana düşmez, REDDEDİLİR** (sessiz fallback = kimsenin
fark etmediği eksik kanıt). Ayrıca **yapısal kilit**: `lane: "host"` olan bir profil
`maxVerdict: "OEM_READY"` **isteyemez** — şema reddeder.

Planlanan profiller: `host-only` (✅), `host-full` (PR-2, +statik güvenlik),
`device-bench` (PR-3/4, USB/ADB), `vehicle-live` (PR-6, gerçek araç),
`t507-manual` (ADB'siz head unit — desteklenmeyen fazlar `MANUAL_PENDING`).

---

## 5. Threshold sistemi

`qa/thresholds/global.json` — tek yer, versiyonlanabilir:

| Anahtar | Anlamı |
|---------|--------|
| `minScore` | Her verdict için asgari skor (HOST_VERIFIED 70 · OEM_READY 85 · PRODUCTION 92 · FLAGSHIP 97) |
| `minDeviceCoverage` | OEM_READY 0.6 · PRODUCTION 0.8 · FLAGSHIP 0.95 |
| `minVehicleCoverage` | OEM_READY 0 · PRODUCTION 0.5 · FLAGSHIP 0.9 |
| `categoryMultipliers` | security/performance/vehicle **×2**, diğerleri ×1 |
| `resultScores` | PASS 1.0 · PASS_WITH_WARNINGS 0.75 · FAIL 0 · INCOMPLETE 0 |
| `artifacts` | maxFiles 200 · maxBytesPerFile 512 KB |
| `exec` | defaultTimeoutMs 120 s |

Bir eşiği **düşürmek kanıt standardını düşürmektir** — PR'da gerekçelendirilir.

---

## 6. Coverage-aware skor ve verdict modeli

**İki bağımsız sayı:**

- **Skor** = *yaptıklarının kalitesi.* `Σ(effectiveWeight × resultScore) / Σ(effectiveWeight)`
  — yalnız **skorlanan** fazlar üzerinden (PASS, PASS_WITH_WARNINGS, FAIL, INCOMPLETE).
- **Coverage** = *ne kadarını yaptığın.* Alan başına `kanıt üreten faz / planlanan faz`.
  `SKIPPED_NA` ve `MANUAL_PENDING` skora **girmez**, coverage'ı **düşürür**.

**Kritik ayrıntı — boş küme "tam" sayılmaz:** hiç device fazı planlanmadıysa
`deviceCoverage = 0` (1 değil). Host-only koşunun OEM_READY üretememesi tam olarak bu
satırdan gelir; "vacuous truth" reddedilir.

**Verdict = min(skor kapısı, coverage tavanı, profil tavanı)**, önce sert redler:

```
KAPI 1 (sert red):  blocker bulgu  ·  safety-critical FAIL/INCOMPLETE  ·  skor < 70   → REJECTED
KAPI 2 (coverage):  deviceCoverage == 0 → tavan HOST_VERIFIED
                    deviceCoverage/vehicleCoverage eşikleri → OEM/PRODUCTION/FLAGSHIP tavanı
KAPI 3 (profil):    profile.maxVerdict
```

Örnek (gerçek PR-1 koşusu): 9/9 kontrol geçti → **skor 100** → ama device coverage 0 →
**verdict HOST_VERIFIED**. Skor asla verdict'i yükseltemez.

---

## 7. `report.json` şeması (v1)

```jsonc
{
  "schemaVersion": 1,
  "runId": "2026-07-11T14-52-28Z",
  "startedAt": "...", "finishedAt": "...", "durationMs": 0,
  "profile":     { "id", "name", "lane", "maxVerdict", "phases" },
  "environment": { "platform", "nodeVersion", "ci" },
  "capabilities": {
    "detected": ["host.node", "host.repo", "..."],
    "deviceLayerImplemented": false        // PR-1'de DAİMA false — tüketici bunu görsün
  },
  "verdict":  { "value", "reasons": [], "caps": { "score", "coverage", "profile" } },
  "score":    { "value", "weighted": { "earned", "possible" }, "counts": { ... } },
  "coverage": { "host": {planned, executed, skipped, manual, ratio}, "device": {...}, "vehicle": {...} },
  "phases": [{
    "id", "name", "order", "category", "weight", "effectiveWeight", "requires",
    "safetyCritical", "result", "scored", "durationMs",
    "findings":  [{ "id", "severity", "title", "detail", "evidence", "remediation" }],
    "artifacts": [{ "path", "bytes", "truncated", "dropped" }],
    "metrics":   { ... },
    "skippedReason", "manualFallback"
  }],
  "thresholds": { ... },   // koşunun hangi eşiklerle yargılandığı (tekrarlanabilirlik)
  "logs": [ ... ]
}
```

Yazılmadan önce `validateReport()` kapısından geçer — bozuk rapor **diske yazılmaz**.

---

## 8. Markdown raporları

| Dosya | Okuyucu | İçerik |
|-------|---------|--------|
| `QA_REPORT.md` | mühendis | Her faz, her kontrol, her bulgu, artefakt referansları |
| `OEM_REPORT.md` | karar verici | Verdict, gerekçe, coverage, **"bu verdict ne DEMEK DEĞİL"**, kanıt boşlukları |
| `BUILD_REPORT.md` | sürüm sorumlusu | Paket kimliği: SHA-256, paket adı, sürüm, imza, izin yüzeyi |

Üçü de **saf fonksiyonla** (`report → string`) üretilir: dosya okumaz, komut çalıştırmaz,
yeniden hesaplamaz. `npm run qa:oem:report` bunları mevcut `report.json`'dan yeniden üretir.

---

## 9. Plugin / faz sözleşmesi

```js
import { definePhase, phaseOutcome, check, finding, rollupChecks,
         PHASE_RESULT, PHASE_CATEGORY, SEVERITY, CAPABILITY } from './_phase.mjs';

export default definePhase({
  id: 'runtime-performance',
  name: 'Runtime Performance — FPS, bellek, termal',
  order: 40,
  weight: 3,
  category: PHASE_CATEGORY.PERFORMANCE,   // → ağırlık ×2
  requires: [CAPABILITY.DEVICE_APP, CAPABILITY.DEVICE_PERF],
  safetyCritical: false,
  async run(context) {
    // context: immutable — repoRoot, profile, thresholds, capabilities, paths,
    //          exec(), artifacts, log(), has(), missing(), safePath()
    return phaseOutcome({ result: PHASE_RESULT.PASS, findings: [], metrics: {}, artifacts: [] });
  },
});
```

**Faz ASLA:** `process.exit` çağırmaz · global state yazmaz · context'i mutasyona uğratmaz ·
kendi verdict'ini belirlemez · uygulama runtime'ını import etmez.

**Faz hata fırlatırsa:** orchestrator yakalar → faz `INCOMPLETE`, hata `artifacts/<id>.error.txt`,
**kalan fazlar koşar**. Safety-critical bir faz patlarsa bulgu `blocker` olur → `REJECTED`.

Faz zaman-sınırlıdır (`phaseTimeoutMs`); asılı kalan faz koşuyu kilitleyemez.

---

## 10. ADB ve null-transport modeli

PR-1'de **gerçek cihaz transport'u YOKTUR** ve bu **yapısal olarak** garanti altındadır:

1. `context.exec()` — `lane: 'host'` profilinde `adb` / `fastboot` / `scrcpy` çağrısını
   **reddeder** (throw).
2. `detectHostCapabilities()` — `device.*` yeteneği **üretemez** (üretirse hata fırlatır).
3. Test #37 — `qa/` kaynaklarında `exec('adb'…)` / `spawn('adb'…)` deseni **aranır ve
   bulunmadığı doğrulanır**.

**Null-transport:** cihaz gerektiren faz, cihaz yokken **koşmaz** — sessizce "geçti"
demez, `SKIPPED_NA` (veya profil manuel karşılık tanımlıyorsa `MANUAL_PENDING`) olur.
**T507 gibi ADB'si olmayan head unit'ler** için doğru araç budur: fazlar `MANUAL_PENDING`
olur, coverage düşer, verdict tavanı düşük kalır — ve bu **dürüst** sonuçtur.

PR-3 transport arayüzü (tasarlandı, yazılmadı): `createTransport(profile)` →
`{ shell(), push(), pull(), install(), logcat(), isAlive() }`; `null-transport` implementasyonu
her çağrıda `SKIPPED_NA` üretir.

---

## 11. npm komutları

| Komut | Ne yapar |
|-------|----------|
| `npm run qa:oem:host` | Host lane koşusu (cihazsız). Verdict `REJECTED` ise **exit 1** (CI kapısı). |
| `npm run qa:oem:report` | Son koşunun `report.json`'undan markdown'ları yeniden üretir |
| `npm run qa:oem:validate-profile` | Tüm profilleri şemaya karşı doğrular (+ bilinmeyen faz kontrolü) |
| `npm run qa:oem:device-info` | **(PR-2)** Cihazı yoklar → `device.json`. ADB yoksa `SKIPPED_NA` yazar ve **exit 0** (cihazsız makinede de koşar; cihaz yokluğu hata değil, kanıt boşluğudur). Cihaz seçimi: `CAROS_QA_DEVICE=<seri>`. |

Planlanan: `qa:oem:device` (PR-3, cihaz lane fazları) · `qa:oem:vehicle` (PR-6) · `qa:oem:full`.

---

## 12. Host CI lane

`qa:oem:host` **Node built-in'lerden başka hiçbir şeye ihtiyaç duymaz**; APK/aapt2/Java
yoksa ilgili kontroller `SKIPPED_NA` olur ve koşu yine tamamlanır (fail-soft).

Ubuntu CI runner'ında bugün: `dist/` derlenir → `web-dist` + `webview-compat` PASS;
APK yoksa APK kontrolleri `SKIPPED_NA` → faz `PASS_WITH_WARNINGS` (skor 75 ≥ 70) →
`HOST_VERIFIED`. **PR-1'de CI'a bağlanmadı** — mevcut `main.yml` üç işini (lint/test/build)
korur; QA lane'i ayrı bir PR'da eklenecek (kırmızı CI riski almadan).

---

## 13. Device lane

**Faz 1: mühendis bilgisayarı + USB/ADB.** Self-hosted GitHub device runner **sonraki faz**.

### 13.1 Transport katmanı (PR-2 ✅ uygulandı)

```
qa/device/
  interfaces/transport.mjs        # TEK GİRİŞ: createTransport() → 'adb' | 'none'
  transport/adb.mjs               # ADB transport (bounded, retry≤1, broken-pipe fail-soft)
  transport/capability-probe.mjs  # TEK SEFER yoklama (memoize): hangi servis var/yok
  transport/device-info.mjs       # kimlik: model/CPU/GPU/RAM/ekran/ABI/batarya/termal
  types/device-types.mjs          # durum sözlüğü + SAF parser'lar (cihazsız test edilir)
  index.mjs                       # scanDevice() + device.json (qa:oem:device-info)
```

**Sözleşme:**
- **Public API ASLA throw etmez** → her şey `OpResult { ok, status, reason }`.
  Durumlar: `ok` · `failed` (cihaz "hayır" dedi) · `skipped_na` (koşulamadı) · `timeout` · `broken`.
- **ADB yoksa → null transport:** her çağrı `SKIPPED_NA`. Hiçbir faz çökmez, hiçbir
  eksik kanıt "geçti" sayılmaz. **T507 gibi ADB'si olmayan head unit'lerin doğru yanıtı budur.**
- **Retry en fazla 1**, yalnız geçici transport hatasında (broken pipe / device offline /
  protocol fault). **Timeout retry EDİLMEZ** — zaman bütçesi iki katına çıkmasın.
- Israrlı kopma → `BROKEN`, transport ölü işaretlenir, sonraki çağrılar `SKIPPED_NA`.
- **Ham seri no rapora girmez** (`4L45****`; ağ seri no → `<REDACTED_IP>:5555`).

**Çıktı: yalnız `device.json`** — `scope` bayrakları kapsamı açıkça söyler:
`transportOnly: true`, `performanceMeasured: false`, `sensorsAnalyzed: false`,
`vehicleHalVerified: false`. Bu PR uygulamaya **dokunmaz** (install / `am start` yok —
testler kaynak taramasıyla kilitler).

**Mevcut araçların yeniden kullanımı:** adb arama sırası `tools/diag-restart.ps1`'in aday
listesinden; root ölçütü (`uid=0`) `tools/hu-probe.sh`'ten. `tools/hu-probe.ps1`'in
**sabit mutlak adb yolu bilinçli olarak taşınmadı** (makineye özgü, taşınabilir değil).
`hu-probe.sh` derin CAN/UART/BT sınıflandırması için **hâlâ doğru araçtır** — Lab onu
değiştirmez, ileride bir fazın artefaktı olarak push edip çalıştırabilir.

### 13.2 Sonraki adımlar (yazılmadı)

```
PR-3  install-boot   : adb install -r → am start → logcat ANR/FATAL taraması → temizlik
PR-4  performance    : dumpsys gfxinfo (jank), meminfo (PSS), thermalservice
PR-5  sensor         : sensorservice, GPS fix, orientation gate
PR-6  vehicle        : OBD canlı, CAN, güvenlik overlay
```

Cihaz coverage > 0 olduğunda verdict merdiveni **açılır** (test #38b bunu şimdiden kilitler).
**PR-2 hiçbir faz kaydetmez** → device coverage hâlâ 0, verdict tavanı hâlâ `HOST_VERIFIED`.
İlk cihaz **fazı** PR-3'te gelir; merdiveni açan odur, transport değil.

---

## 14. Ledger otomasyonu (tasarlandı)

Bugün `DEVICE_VALIDATION_LEDGER.md` **elle** yazılıyor. Hedef: koşu bittiğinde
`report.json` → Ledger satırı önerisi üret (`qa:oem:ledger --propose`):

- Verdict `HOST_VERIFIED` → 🔴 satırı **korunur** (cihaz kanıtı yok).
- Cihaz fazları PASS → ilgili 🔴 satırı için 🟢 önerisi + kanıt (`runId`, ölçüm).
- Cihazda FAIL → ❌ satırı önerisi + gözlemlenen hata.

**Otomatik yazma YOK** — öneri üretir, insan onaylar (kütüğün değeri dürüstlüğünde).

---

## 15. Gelecek genişlemeler

Statik güvenlik taraması · APK boyut bütçesi (regresyon) · i18n eksik-anahtar taraması ·
erişilebilirlik (dokunma hedefi ≥ 48dp) · offline harita bütünlüğü · lisans denetimi
(`license-checker` — kopyaleft kapısı, CLAUDE.md §Lisans) · Supabase RLS/grant denetimi.

---

## 16. Atomik PR yol haritası

| PR | Kapsam | Cihaz gerekli? |
|----|--------|----------------|
| **PR-1 ✅** | Çekirdek + Faz 1 Build Validation + host-only profil + raporlar + 62 test | hayır |
| PR-2 | Statik güvenlik fazı (sır taraması, izin gerekçesi, CSP/cleartext) + `host-full` profil | hayır |
| PR-3 | **Device transport** (adb) + install/boot fazı + `device-bench` profil | evet |
| PR-4 | Runtime performance (FPS/jank/PSS/termal) + Mali-400 bütçeleri | evet |
| PR-5 | Sensör bütünlüğü (GPS fix, orientation gate, sensör sanitizasyonu) | evet |
| PR-6 | Araç lane: OBD canlı + CAN + güvenlik overlay (reverse) | evet + araç |
| PR-7 | Scenario Engine + burn-in + OTA regresyon | evet |
| PR-8 | CI entegrasyonu (host lane) + self-hosted device runner | kısmen |

Her PR: **additive**, mevcut fazları bozmaz, kendi testlerini getirir, Ledger'a 🔴 satır ekler.

---

## 17. Araç Scenario Engine (tasarlandı)

Tek tek PID okumak "zekâ" değildir (CLAUDE.md §8 Kapı). Scenario Engine, **senaryo**
düzeyinde doğrular:

```jsonc
{
  "id": "cold-start-city",
  "steps": [
    { "given": "ignition=off, coolant<40°C" },
    { "when":  "ignition=on" },
    { "then":  "soğuk-yol uyarısı 5 sn içinde görünür" },
    { "then":  "Digital Twin hot-path'e GİRMEZ (3Hz bütçesi korunur)" }
  ],
  "requires": ["vehicle.obd"],
  "safetyCritical": true
}
```

Senaryolar kayıttan (trip replay) veya canlı araçtan beslenir. **Reverse overlay**,
**aşırı ısınma**, **düşük yağ basıncı** senaryoları `safetyCritical: true` → düşerse
verdict doğrudan `REJECTED`.

---

## 18. Burn-in testleri (tasarlandı)

Head unit **saatlerce açık kalır** — 5 dakikalık test bunu kanıtlamaz.
`burn-in` fazı: N saat boyunca periyodik örnekleme → **bellek büyümesi** (PSS eğimi),
**FPS düşüşü**, **termal kısma**, **zombi timer/listener** (zero-leak invaryantı),
**localStorage yazım sıklığı** (I/O throttling invaryantı). Kabul: PSS eğimi ≈ 0,
FPS son çeyrekte ilk çeyreğin %90'ından düşük değil.

---

## 19. OTA regresyon (tasarlandı)

`ota:publish` ile yayınlanan sürüm, **bir önceki sürümün kanıt setini** düşürmemeli:
eski `report.json` + yeni `report.json` → **regresyon karşılaştırması** (skor düşüşü,
yeni blocker, coverage kaybı, APK boyut artışı). Kural: **coverage düşüren OTA yayınlanmaz.**

---

## 20. Plugin certification (tasarlandı)

3. taraf üretici kendi fazını ekleyebilmeli. Sertifikasyon kapısı: faz `definePhase`
sözleşmesine uyar · yan etkisiz import · bounded çalışma · `context` mutasyonu yok ·
uygulama runtime'ını import etmez · kendi testlerini getirir. Doğrulayıcı:
`qa:oem:certify <phase>` (statik + davranışsal kontrol).

---

## 21. AI validation (tasarlandı)

Asistan/Vehicle Brain katmanı **deterministik değildir** → klasik assert yetmez.
Yaklaşım: **altın senaryo seti** (sabit girdi → beklenen *aksiyon sınıfı*, tam metin değil) ·
güvenlik kapısı testleri (kritik durumda online AI **devre dışı** — Companion Safety Kernel
PRE/POST gate) · halüsinasyon kapısı (araç verisi olmadan araç iddiası üretmemeli) ·
gecikme bütçesi. Skorlama: aksiyon-doğruluğu oranı; **safety gate düşerse → REJECTED**.

---

## 22. Enerji profilleri (tasarlandı)

Head unit aracın aküsünden beslenir; kontak kapalıyken tüketim **sızıntıdır**.
`energy` fazı: kontak kapalı → CPU/wakelock/ağ tüketimi ≈ 0 · GPS/sensör abonelikleri
serbest bırakılmış (Orientation Sensor Gate — PR #56/57/58) · foreground service yalnız
gerekliyken açık. Ölçüm: `dumpsys batterystats` + wakelock sayacı.

---

## Bilinen sınırlar (PR-1)

- **Cihaz katmanı yok** — device/vehicle coverage yapısal olarak 0.
- **CI'a bağlı değil** — `qa:oem:host` elle koşuluyor (PR-8).
- **Gradle build tetiklenmiyor** — Lab mevcut APK'yı doğrular, üretmez (`buildIfMissing: false`).
- **Gradle `buildDir` override'ı makineye özgü** (`android/build.gradle` → `C:/Temp/...`):
  APK repo dışında; Lab bunu okur ama rapora **redakte** (`<ABS>/…`) yazar.
- **Redaksiyon savunma katmanıdır, kanıt değil** — bu yüzden `docs-local/qa-runs/` ayrıca
  gitignore'dadır.
