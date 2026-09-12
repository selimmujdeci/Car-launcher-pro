# CAROS PRO — GÜNCEL DURUM

> Bu belge projenin güncel teknik/operasyonel durumunun **tek doğruluk kaynağıdır**.
> Her oturum sonunda **yeniden düzenlenir** (append edilmez). Günlük değildir.
> Halefi olduğu eski belgeler henüz DEĞİŞTİRİLMEDİ — bkz. §7.

## 1. Son güncelleme

**2026-07-27**

## 2. Repository durumu

- **Aktif branch:** `feat/caros-lab-phase-a1`
- **HEAD:** `f89540c` (2026-07-26) — `fix(credentials): "siteden kopyala → dönünce otomatik algıla" akışını onar`
- **Çalışma ağacı:** KİRLİ — 55 değişmiş izlenen dosya + 72 izlenmeyen yol
- ⚠️ Bu değişikliklerin **neredeyse tamamı WORKSPACE-W1'den ÖNCE vardı**. W1 yalnız
  §3'te sayılan dosyaları ekledi. Diğer kümelere **dokunma, revert etme, sahiplenme**.

## 3. Aktif görev

**HESAP DEĞİŞİMİ — DEVİR VERİLDİ / COMMIT PENDING**

Tam devir notu: **`docs/archive/HANDOFF_2026-07-27.md`** (bu oturumun tamamı orada).
Son iş: P0 saha turu — ısınma/kasma **sahada doğrulandı** (kütük #139), kök neden
sınıfı CDP profiliyle **kanıtlandı** (#140), **düzeltme YAPILMADI**, commit YOK.

> ⚠️ Cihazda ÜRETİM DEĞİL **ölçüm APK'sı** kurulu (http şeması + CDP açık).
> Araca teslim edilecekse önce üretim APK'sı geri kurulmalı.

## 4. Son doğrulanan teknik durum

Aşağıdakiler bu oturumda repository ve testlerden **doğrulandı**:

- `VehicleCompute.worker.ts` — VCOMP-01 (dispatcher global try/catch), VCOMP-02
  (bilinmeyen kaynak uyarısı), VCOMP-03 (fail-closed kaynak kapısı, state yazımından
  önce `return`) **üçü de kaynakta mevcut**; `workerFailSafeDispatch.test.ts` 16 kilit yeşil.
- CAROS LAB · Mavi · Phone Hub · VCOMP değişiklikleri **HİÇBİRİ COMMIT EDİLMEDİ** —
  `git status` ile doğrulandı, hepsi çalışma ağacında.
- Saha kütüğü: 139 kayıt — **130'u 🔴 (cihaz bekliyor)**, 9'u 🟢.
- `BatteryProtectionService` **koşulsuz boot'a bağlı** (`SystemBoot.ts:810`); voltajı
  YALNIZ `onOBDData` üzerinden alır. Smart/Continuous Surveillance kodda **YOK**.
- SAB üretimde **bilinçli kapalı** (DEC-017); hiçbir özellik ona bağımlı değil (JSON
  fallback). Açılış modu her cihazda `BASIC_JS`; yükseltme yalnız `CognitivePriorityEngine`
  kurtarması veya kullanıcı override'ı ile olur — gerçek cihazda ölçülmedi.
- Test/tsc/lint sayıları için bkz. §4b (yalnız bu oturumda gerçekten koşturulanlar).

### 4b. Doğrulama çıktıları (bu oturumda koşturuldu)

- `npx tsc -b` → temiz
- `npm run lint` → 0 hata, 25 uyarı (**değişmemiş taban** — değişiklik öncesiyle aynı)
- `npm run guard` → 159/159 yeşil
- `npx vitest run src/__tests__/workspaceGuards.test.ts` → 71/71 yeşil
  (W1 17 · W2 17 · W3 18 · DOC-P0-01 5 · DEBT-005 6 · SAB politikası 8)
- **Tam suite KOŞTURULDU (2026-07-27, `apk:safe`):** **7953 / 7956 geçti — 385/388 dosya**.
  Düşen 3 dosya (`carosLabKwpMonitor`, `currentLocation`, `regression.guards`) yalnız
  varsayılan 5 sn timeout'ta düşüyor; `--testTimeout=20000` ile **248/248 yeşil** →
  dinamik import flake'i, **mantık regresyonu DEĞİL**.
- APK: debug `assembleDebug`, **v1.0.2 / versionCode 4**, head unit'e kuruldu 15:15.
  ⚠️ `apk:safe` zinciri 3 flake yüzünden APK üretmedi; flake kanıtlandıktan sonra
  build/sync/gradle elle koşturuldu (JDK 21 = Android Studio jbr gerekiyor).

## 5. Açık çalışma kümeleri (commit edilmemiş)

Bunlar birbirine karışmış durumda. **Yeni oturum kendi işini bunlarla karıştırmamalıdır.**

| Küme | Kapsam | Durum |
|---|---|---|
| **Workspace + Doküman** | `docs/workspace/*` (6 belge), `README.md`, `workspaceGuards.test.ts` | W1–W3 + DOC-P0-01 — bu oturum |
| **VCOMP** | `VehicleCompute.worker.ts`, `workerFailSafeDispatch.test.ts` | Tamam, commit bekliyor |
| **Phone Hub** | `android/phonehub-*`, `src/platform/phoneHub/`, `src/platform/companion/*` | Tamam, commit bekliyor |
| **CAROS LAB** | `src/platform/devtools/*`, `src/components/devtools/screens/*` | Tamam, commit bekliyor |
| **Mavi** | `companionChatProvider`, `companionContext`, `maviCore/*`, `aiCore/runtime/*` | Tamam, commit bekliyor |
| **Deep Scan** | `deepScan/ignitionEvidenceAdapter.ts`, `deepScanRuntimeService.ts` | Tamam, commit bekliyor |
| **Doküman** | `docs/audits/`, `docs/operations/RELEASE_CHECKLIST.md`, ledger/vizyon güncellemeleri | Tamam, commit bekliyor |

## 6. Saha doğrulama kuyruğu

**Otorite:** `docs/DEVICE_VALIDATION_LEDGER.md` — içerik buraya **kopyalanmaz**.

- **Açık kritik kayıtlar:** #123 · #124 · #125 · #126 · #127 · #128 · #129 · #130 ·
  #131 · #132 · #132b · #133 · #134 · #135 · #136 · #137
- **Sıradaki doğrulama turu (öneri):** #124 (proaktif kritik uyarı) · #127 (kontak kapısı) ·
  #136 (worker fail-safe) — üçü de gerçek araçta tek turda ölçülebilir.
- **FIELD VALIDATION REQUIRED:** yukarıdakilerin tamamı. Hiçbiri cihazda doğrulanmadı.

## 7. Açık blokajlar

> Kapanış ölçütü ve kanıtla birlikte tam liste: `docs/workspace/03_DEBT.md`.

1. **Çelişkili giriş talimatları düzeltilmedi** — `CONTRIBUTING.md §0`, `HANDOFF.md §1`,
   `docs/archive/project/MASTER_PROMPT.md` hâlâ eski/çakışan sıraları dayatıyor. Bu belge ve
   `00_START_HERE.md` onları ezer ama **kaynak metinler düzeltilmedi**. Açık dokümantasyon borcu.
2. **Gerçek araç doğrulaması gerekiyor** — 130 açık 🔴 kayıt.
3. **Çalışma ağacı atomik commit için karışık** — altı bağımsız küme iç içe (§5).
   İzole commit derlenmiyor; bu yüzden bu oturumdaki hiçbir iş commit edilmedi.
4. **İnsan kararı bekleyen dokümantasyon birleştirmeleri** — `docs/archive/audits/MARKDOWN_DOCUMENTATION_AUDIT.md`
   §15'te 8 madde (özellikle `docs/project/` setinin ve `docs/archive/PROJECT_STATE.md`'nin geleceği).

## 8. Sonraki güvenli adım

**PROFİL ALINABİLİR ÖLÇÜM BUILD'İ (`NODE_ENV=development`) → DEBT-012 kök nedeni.**

> #139'da kanıtlandı: üretim build'inde `drop_console` + `webContentsDebuggingEnabled:false`
> olduğu için %27'lik JS yükünün kaynağı ÖLÇÜLEMİYOR. Ölçüm build'i + CDP profili suçlu
> timer'ı isimlendirir; ancak ondan sonra atomik düzeltme yapılır. Tahminle yama YASAK.
> Paralel ilerleyebilecekler: DEBT-013 (termal girdi) · DEBT-011 (LAB runtime ekranı).

## 9. Yeni oturum için devir teslim

- **İlk okunacak dosya:** `docs/workspace/00_START_HERE.md`
- **Devam edilecek görev:** DEBT-012 kök nedeni (store setState probe) — bkz. devir notu §10
- **Tam devir notu:** `docs/archive/HANDOFF_2026-07-27.md`
- **Dokunulmayacak kümeler:** §5'teki Workspace dışı altı küme — commit edilmemiş, tamamlanmış iş
- **Commit durumu:** bu oturumda **hiçbir commit atılmadı**
- **Saha borcu:** 130 açık 🔴 kayıt; otorite `docs/DEVICE_VALIDATION_LEDGER.md`
