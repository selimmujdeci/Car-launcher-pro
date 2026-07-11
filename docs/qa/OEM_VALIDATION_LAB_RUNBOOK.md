# OEM Validation Lab — Runbook

Mimari: `docs/OEM_VALIDATION_LAB_ARCHITECTURE.md` · Kütük: `docs/DEVICE_VALIDATION_LEDGER.md`

---

## Koşu

```bash
npm run qa:oem:validate-profile   # profilleri şemaya karşı doğrula (hızlı)
npm run qa:oem:host               # host lane koşusu (cihaz GEREKMEZ)
npm run qa:oem:report             # son report.json'dan markdown'ları yeniden üret
```

**Tam kanıt için önce:**

```bash
npm run build       # → dist/  (web-dist + webview-compat kontrolleri buna bağlı)
npm run apk:safe    # → APK    (paket/imza/izin kontrolleri buna bağlı)
npm run qa:oem:host
```

`build`/`apk:safe` koşulmazsa Lab **çökmez**: ilgili kontroller `SKIPPED_NA` olur, faz
`PASS_WITH_WARNINGS` alır ve raporda **kanıt boşluğu** olarak görünür. Atlanan kontrol
asla "geçti" sayılmaz.

**Exit kodu:** verdict `REJECTED` → `1` (CI kapısı olarak kullanılabilir), aksi hâlde `0`.

---

## Çıktı

```
docs-local/qa-runs/<timestamp>/
  report.json        ← TEK GERÇEK KAYNAK
  QA_REPORT.md       ← mühendis: her faz, her kontrol, her bulgu
  OEM_REPORT.md      ← karar verici: verdict + "bu verdict ne DEMEK DEĞİL"
  BUILD_REPORT.md    ← sürüm sorumlusu: SHA-256, sürüm, imza, izin yüzeyi
  artifacts/         ← faz hata dökümleri
  raw/               ← ham komut çıktıları (aapt2, apksigner, compat) — REDAKTE
```

`docs-local/qa-runs/` **git'e girmez** (.gitignore). Kanıtı paylaşmak gerekirse
`report.json`'daki `runId` + ilgili ölçümü Ledger'a yaz.

---

## Sonucu okuma

**Verdict merdiveni:** `REJECTED` → `HOST_VERIFIED` → `OEM_READY` → `PRODUCTION_READY` → `FLAGSHIP_READY`

| Gördüğün | Anlamı | Ne yapmalı |
|----------|--------|------------|
| 🟡 `HOST_VERIFIED` skor 100 | Host tarafı kusursuz — **ama cihazda hiçbir şey kanıtlanmadı** | Normal. Cihaz lane'i (PR-3) gelene kadar tavan budur. |
| ⛔ `REJECTED` | blocker bulgu · safety-critical faz düştü · skor < 70 | `OEM_REPORT.md` → "Kapatılması gerekenler" |
| `SKIPPED_NA` kontrol | Araç/artefakt yok (Java, aapt2, APK…) | Aracı kur veya APK üret; **kontrol geçmiş sayılmaz** |
| `INCOMPLETE` faz/kontrol | Koşmalıydı, kanıt üretemedi (çöktü/zaman aşımı) | `artifacts/<faz>.error.txt` veya `raw/` |
| `MANUAL_PENDING` | Bu cihazda otomatik doğrulanamaz (ör. T507 — ADB yok) | Elle doğrula, sonucu Ledger'a yaz |

**Skor ≠ hazır.** Skor "yaptıklarının kalitesi", coverage "ne kadarını yaptığın".
Cihaz coverage 0 iken skor 100 olsa bile verdict `HOST_VERIFIED`'i **geçemez**.

---

## Sözleşmeyi güncelleme

`qa/config/manifest-expectations.json` — izin yüzeyi sözleşmesi.

Yeni bir izin **bilinçli** eklendiyse: `allowedPermissions`'a ekle (kaynak manifest) veya
`mergedPermissions`'a ekle (Gradle manifest-merge ile kütüphaneden geliyorsa — hangi
kütüphane olduğunu **doğrula**). Kontrolü zayıflatmak için ekleme yapma: `apk-permissions`
kontrolünün amacı, kimsenin fark etmeden APK'ya izin sızmasını engellemektir.

---

## Yeni faz ekleme

1. `qa/phases/NN-adim.mjs` → `definePhase({ id, name, order, weight, category, requires, safetyCritical, run })`
2. `qa/index.mjs` → `BUILT_IN_PHASES` listesine ekle
3. İlgili profilin `phases` listesine ekle
4. `src/__tests__/oemValidationLab.test.ts` → fazın PASS/FAIL/SKIP yollarını kilitle
5. `npm run qa:oem:validate-profile` → yeşil olmalı

Faz **cihaz** gerektiriyorsa `requires: [CAPABILITY.DEVICE_*]` yaz — host koşusunda
otomatik `SKIPPED_NA` olur ve device coverage'ı düşürür (istenen davranış).
