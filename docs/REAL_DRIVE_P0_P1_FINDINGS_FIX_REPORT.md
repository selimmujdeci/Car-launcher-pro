# CarOS Pro — Gerçek Sürüş P0/P1 Bulguları · Düzeltme Raporu

**Tarih:** 2026-08-03 · **Branch:** `feat/fleet-offline-final-local-completion` · **Commit/push/deploy YAPILMADI**

---

## 1. Yönetici Özeti

Gerçek araçta, araç **hareket hâlindeyken** (86 km/h · RPM 1792 · motor 92°C · protokol 7 ·
OBD kalite %100 · GPS canlı) alınan CAROS LAB kaydındaki üç ana bulgudan **ikisi bu turda
kökünden düzeltildi**, biri **henüz ele alınmadı**.

| # | Bulgu | Durum |
|---|---|---|
| 1 | Sürüşte zamansız tam ekran modal | ✅ Kök neden bulundu, düzeltildi |
| 2 | GPS heartbeat ile gerçek fix çelişkisi | ✅ Kök neden bulundu, düzeltildi |
| 3 | Poll Scheduler kanıt önbelleği bayatken "sağlıklı" | ❌ **YAPILMADI** |
| 4 | BlackBox mükerrer kareler | ❌ **YAPILMADI** |
| 5 | weather/fuel timeout sınıflandırması | ❌ **YAPILMADI** |
| 6 | Mod/sürüş chatter | ❌ **İNCELENMEDİ** |

**Bu rapor kısmi bir turu belgeler.** Yapılmayan maddeler "zararsız" veya "doğrulandı"
DEĞİL, sadece **ele alınmamış**tır.

---

## 2. Gerçek Sürüş Kanıtı

CAROS LAB kaydından, doğrulanmış ham olaylar:

```
modal açıldı ⚠ZAMANSIZ — div z9500 100% [sürüşte]
modal kapandı            — div z9500 100%        (arada ~15 ms)

No heartbeat for 20s [src=GPS clock=monotonic(performance.now)
                      age=20007ms threshold=20000ms
                      conn=connected dataFresh=true polling=true]
GPS heartbeat kaybı: 25 sn · 85 sn · 20 sn · 20 sn

snapshot: gpsAlive=true · GPS connected=true · confidence=0.7 · lastSignalAt güncel
snapshot: readAt=1785693968408 · lastPollAt=1785692102647  (~31 dk fark)
          cacheState=refreshed · evidenceComplete=true · decisionLabel=HAT SAĞLIKLI
```

---

## 3. Zamansız Modal — Kök Neden

**İddia doğrulandı: bu GERÇEK bir tam ekran modaldır, ölçüm artefaktı değildir.**

Sahibi DOM/React zinciriyle tespit edildi — yalnız z-index araması yapılmadı.
Projede z-9500 taşıyan **üç** yüzey var; hangisinin log'daki `desc`'i üreteceği
`uiActivityRecorder.classifySurface()`'ın `desc` biçiminden çözülür
(`tag#id.ilkSınıf zN alan%`):

| Aday | Dosya | className | Üreteceği desc | Eşleşme |
|---|---|---|---|---|
| `DiagnosticReportModal` | `components/common/DiagnosticReportModal.tsx:129` | yok (inline stil) | `div z9500 100%` | ✅ **birebir** |
| Adres nav kartı | `components/layout/MainLayout.tsx:436` | `fixed inset-x-0 …` | `div.fixed z9500 …%` | ❌ |
| VoiceAssistant pill | `components/modals/VoiceAssistant.tsx:373` | `fixed top-4 …` | `div.fixed z9500 …%` | ❌ |

**Sahip:** `DiagnosticReportModal`
- **z kaynağı:** inline `position:'fixed', inset:0, zIndex:9500`
- **mount koşulu:** `if (!open) return null` — yani gerçekten mount olmuştur
- **açılış producer'ı:** `GlobalDiagnosticButton` → `setOpen(true)` (stetoskop butonu)
- **kapanış producer'ı:** kök `div`'in `onClick={onClose}` backdrop'u
- **kullanıcı dokunuşu:** var (log'da `kullanıcı-dokunmadan` gerekçesi yok, yalnız `[sürüşte]`)
- **gerçek modal mı:** **EVET** — `role="dialog"`, `aria-modal="true"`, `inset:0`,
  görünür alan %100, `pointer-events` bloklayan, yarı saydam koyu backdrop

**~15 ms neden:** aynı dokunuş jestinde modal mount oluyor ve tazece basılan tam ekran
backdrop aynı jestin `click`'ini yiyerek `onClose` tetikliyor (klasik click-through).
Bu, olayı zararsız YAPMAZ: 86 km/h'te tam ekran bloklayan yüzey basılmıştır.

**Asıl kusur:** açılış yolunda **hiçbir sürüş kapısı yoktu.**

---

## 4. Modal Güvenlik Düzeltmesi

**Yeni otorite kurulmadı.** Mevcut saf kapı (`tripSummaryGate.canShowTripSummary`)
genelleştirildi:

- `DISTRACTING_SURFACE_MAX_KMH` = `TRIP_SUMMARY_MAX_KMH` = **5 km/h**
  (`uiActivityRecorder.DRIVING_KMH` ile HİZALI — bir katman ZAMANSIZ sayıp diğeri
  meşru saymasın)
- `canShowDistractingSurface(speedKmh)` — **fail-closed**: hız `null`/`undefined`/`NaN`
  ise `false`. "Duruyordur" varsaymak kanıtsızdır.

`GlobalDiagnosticButton`:
- Tetik `requestOpen()` üzerinden geçer; doğrudan `setOpen(true)` kaldırıldı (kilitle yasak).
- **Mount koşulunda da kapı var** (`open={open && canShow}`) → sürüş başlarsa açık modal kapanır.
- **Olay KAYBOLMAZ:** sürüşte istenirse `deferred` olarak saklanır, araç güvenli şekilde
  durunca kendiliğinden açılır.
- **Sürüşte popup/toast/TTS ÜRETİLMEZ** — sessiz bekleme (kilitle sabit).

### Gözlemci sınıflandırması (yanlış pozitif daraltma)

`uiActivityRecorder` artık kanıta dayalı dört sınıf üretir; **z-index tek başına hüküm vermez**:

| Sınıf | Ölçüt |
|---|---|
| `REAL_DISTRACTING_MODAL` | bloklayan (`pointer-events` var) + (`role=dialog` & alan ≥ %40) veya (`fixed` & z ≥ 900 & alan ≥ %60) |
| `HIDDEN_OVERLAY` | `inert` · `aria-hidden="true"` · `pointer-events:none` · `opacity<0.05` · `display:none` · `visibility:hidden` |
| `TRANSIENT_RENDER_ARTIFACT` | bloklayan görünüyor AMA `< TRANSIENT_SURFACE_MS (34 ms)` yaşadı → çizildiği **kanıtlanamaz** |
| `UNKNOWN` | ölçülemedi — **başarı sayılmaz** |

`TRANSIENT_RENDER_ARTIFACT` "zararsız" demek DEĞİLDİR; ayrı sayılır ki gerçek modalın
sayımını şişirmesin ve kaybolmasın.

---

## 5. GPS Heartbeat / Fix — Kök Neden

**İki ayrı bulgu çıktı.**

### 5.1 Alarm kanıtı YANLIŞ alt sistemden dolduruluyordu

Kayıttaki `conn=connected dataFresh=true` ifadesi **GPS'e ait değil, OBD'ye aitti**:
`SystemHealthMonitor` alarm satırını **her servis için** `getOBDStatusSnapshot()` +
`getObdSessionHealth()` ile zenginleştiriyordu. GPS alarmının yanına OBD tazeliği
yazılınca ürün kendi kendisiyle çelişiyor göründü — oysa iki farklı ölçümdü.

### 5.2 Heartbeat DEĞİŞİM tabanlıydı (kütük #327 — bu turdan önce düzeltildi)

GPS beat'i `useUnifiedVehicleStore.location` **referans değişiminden** üretiliyordu;
`updateGPSState` ise bilinçli bir shallow-equal guard taşır (park hâlinde aynı fix
tekrar gelince referans değişmez) → beat üretilmiyor, alarm yalan çalıyordu.
Düzeltme: `gpsService.onGPSFixArrival` — **VARIŞ** tabanlı beat.

---

## 6. GPS Sağlık Uzlaştırması

**Yeni sağlık motoru kurulmadı.** Saf, I/O'suz `platform/gps/gpsHealthReconcile.ts`
iki MEVCUT otoritenin çıktısını tek sınıfa indirger:

`GPS_FIX_STALE` · `GPS_HEARTBEAT_STALE` · `GPS_PROVIDER_DISCONNECTED` ·
`GPS_BACKGROUND_SUSPENDED` · `GPS_RECOVERED` · `GPS_HEALTH_CONFLICT` · `GPS_UNKNOWN`

Sözleşme:
- `dataFresh=true` iken heartbeat bayatsa **doğrudan GPS_LOST/FAIL ÜRETİLMEZ** →
  `GPS_HEALTH_CONFLICT` (çelişki bir arıza değil, ölçüm tutarsızlığıdır)
- gerçek fix defteriyle çapraz doğrulanır (`fixAgeMs` kanıtı olayla birlikte taşınır)
- **arka plan askısı** gerçek sinyal kaybından ayrılır (85 sn'lik kesinti bu ayrımla
  raporlanır)
- `GPS_RECOVERED` yalnız **bayatlıktan sonra** üretilir
- ölçülemeyen girdi `GPS_UNKNOWN` — **başarı sayılmaz**
- sebep bilinmiyorsa **"tünel" DENMEZ** (modülde o kelime hiç geçmez — kilitli)

GPS alarmı artık GPS kanıtıyla anlatılır: `cls=… fixAge=…ms tracking=… — <gerekçe>`.

---

## 7. Poll Cache Yaşı

**YAPILMADI.** `readAt − lastPollAt ≈ 31 dk` iken `cacheState=refreshed`,
`evidenceComplete=true`, `decisionLabel=HAT SAĞLIKLI` üretilmesi **doğrulanmış bir
kusurdur** ve bu turda ele alınmamıştır. Talep edilen durumlar
(`NATIVE_EVIDENCE_FRESH/STALE/NEVER_REFRESHED/UNAVAILABLE`, `JS_ONLY_ACTIVE`,
`CONFLICTED_EVIDENCE`), yaş görünürlüğü ve TTL sözleşmesi **açık borçtur**.

> TTL mevcut ürün sözleşmesinden çıkarılmadı → **NEEDS_SPEC**.

---

## 8. BlackBox Duplicate Analizi

**YAPILMADI.** Örnekler (`1785693957075/…076` aynı payload; `1785693960963` aynı
timestamp+payload iki kez) kök nedene bağlanmadı. **"Zararsız" DENMEZ.**

---

## 9. External Service Timeout

**YAPILMADI.** `weatherService:fetchFuel — signal timed out · recoverable:false`
kaydının gerçekten dış servis mi yoksa araç yakıt telemetrisiyle karışma mı olduğu
doğrulanmadı; `recoverable:false` sınıflandırması sorgulanmadı. **Açık borç.**

---

## 10. Motion Chatter

**İNCELENMEDİ.** "durdu/park ↔ sürüşe geçildi" geçişlerinin gerçek dur-kalk mı yoksa
eşik chatter'ı mı olduğu BlackBox hız çizgisiyle doğrulanmadı. Kural gereği
**doğrulanmadan düzeltme yapılmadı.**

---

## 11. Testler

Yeni: `src/__tests__/realDriveFindings.test.ts` — **13 kilit**, tamamı gerçek cihaz
değerlerine dayalı (86 km/h; `age=20007ms threshold=20000ms`).

- **A. Modal:** fail-closed kapı · 86 km/h'te engel · parkta normal · eşik hizası ·
  erteleme (olay kaybolmuyor) · sürüşte popup/TTS yok · kapı atlatılamıyor
- **B. Sınıflandırma:** dört sınıf · hidden overlay yanlış pozitif değil · gerçek modal
  kaçırılmıyor · transient ayrı sınıf
- **C. GPS:** `dataFresh=true` + bayat heartbeat → CONFLICT · provider loss ≠ background
  suspension · 85 sn senaryosu · RECOVERED yalnız bayatlıktan sonra · UNKNOWN başarı değil ·
  "tünel" yok · alarm GPS kanıtıyla anlatılıyor

Güncellenen kilit: `globalDiagnosticButton.test.ts` — tetik artık `requestOpen`
(kilit silinmedi, amacı korunarak yeni davranışa taşındı ve `setOpen(true)`'ya dönüş yasaklandı).

Host: `tsc -b` temiz · lint 0 hata · tam suite koşuldu.

---

## 12. Değişen Dosyalar

```
src/components/layout/tripSummaryGate.ts          (kanonik dikkat kapısı genelleştirildi)
src/components/common/GlobalDiagnosticButton.tsx  (kapı + erteleme)
src/platform/uiActivityRecorder.ts                (kanıta dayalı sınıflandırma)
src/platform/gps/gpsHealthReconcile.ts            (YENİ — saf uzlaştırıcı)
src/platform/system/SystemHealthMonitor.ts        (GPS alarmı GPS kanıtıyla)
src/__tests__/realDriveFindings.test.ts           (YENİ — 13 kilit)
src/__tests__/globalDiagnosticButton.test.ts      (kilit güncellendi)
```

## 13. Dokunulmayan Alanlar

Music Hub · AccountCleanup · Supabase/production DB · commit/push/deploy ·
sürüş güvenliği kapılarının gevşetilmesi (yalnız SIKILAŞTIRILDI).

## 14. Açık Borçlar

1. Poll evidence tazeliği (**NEEDS_SPEC** — TTL sözleşmesi yok)
2. BlackBox duplicate kök nedeni + `duplicateDropped` sayacı
3. weather/fuel timeout sınıflandırması (`EXTERNAL_SERVICE_DEGRADED` ayrımı)
4. Motion chatter doğrulaması
5. `getHeartbeatEvidence()` hâlâ hiçbir LAB ekranına bağlı değil (önceki tur borcu)
6. `reconcileGpsHealth` CAROS LAB ve saha test moduna henüz **bağlanmadı** — şu an
   yalnız alarm kanıt satırını besliyor

## 15. Gerçek Araç Sonucu

**Düzeltme sonrası gerçek araçta yeniden ölçüm YAPILMADI.** Telefon bu tur boyunca
bağlı değildi. Kod/test düzeltmesi saha doğrulaması yerine geçmez.

## 16. Nihai Karar

### `REAL_DRIVE_FINDINGS_FIX_PARTIAL`

| Kapı | Karar |
|---|---|
| `driverDistractionVerdict` | **PASS_LOCAL** — kök neden kanıtlandı, kapı fail-closed, olay ertelenir, sınıflandırma kanıta dayalı |
| `gpsHealthConsistencyVerdict` | **PASS_LOCAL** — tek kanonik sınıflandırıcı; CONFLICT üretiliyor, FAIL değil |
| `pollEvidenceFreshnessVerdict` | **NOT_ADDRESSED** (NEEDS_SPEC) |
| `blackBoxIntegrityVerdict` | **NOT_ADDRESSED** |
| `externalServiceIsolationVerdict` | **NOT_ADDRESSED** |
| `motionAuthorityVerdict` | **NOT_ADDRESSED** |
| `realVehicleValidationVerdict` | **FIX_PENDING_REAL_VEHICLE_RETEST** |

**Kabul kriterleri karşılanma durumu:**

- ✅ Sürüş sırasında gerçek tam ekran modal açılmıyor (kod + kilit; saha testi bekliyor)
- ✅ GPS fix ve heartbeat aynı kanonik zincirde tutarlı
- ❌ Eski native poll cache ile güncel sağlık hükmü **hâlâ verilebiliyor**
- ❌ External servis timeout'u sınıflandırması **değişmedi**
- ❌ BlackBox mükerrer kayıt davranışı **değişmedi**
