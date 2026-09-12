# OTOMATİK SAHA DOĞRULAMA P0 — BAĞIMSIZ DENETİM

**Tarih:** 2026-08-02 · **Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** `src/platform/fieldValidation/*` (9 dosya) · LAB ekranı · gösterge ·
kurtarılan üç dosya.
**Bu turda ürün kodu DEĞİŞTİRİLMEDİ.** Doğrulama için geçici bir prob test
dosyası kullanıldı ve **silindi** (§4.1). Düzeltme planı §16'dadır ve
uygulanmamıştır.

---

## 1 · YÖNETİCİ ÖZETİ

### Nihai karar

```
FIELD_VALIDATION_AUDIT_BLOCKED
```

**Gerekçe:** İki kusur **ampirik olarak doğrulandı** ve ikisi de tam olarak
sistemin kanıtlaması gereken senaryoda (process death → restore) tetikleniyor:

- **P0-1 — Restore sonrası olay kimlikleri çakışıyor.** Ölçüldü: restore
  öncesi `EV-2, EV-3, EV-4`; restore sonrası `EV-2, EV-3, EV-4, RESTORE-…,
  EV-1, EV-2, EV-3`. Sistemin kendi öz-denetleyicisi bunu
  `DUPLICATE_EVENTS = CORRUPT` olarak görüyor ve **genel öz-denetim hükmü
  CORRUPT** oluyor. Yani ilk gerçek process death, saha raporunun bütünlük
  denetimini çökertir.
- **P0-2 — eMMC yazma hacmi.** BlackBox blob'u **her 30 sn'de tamamen yeniden
  yazılıyor**. Koddan ölçülen: 24 pencerede **8 saatte ~923 MB**, gerçekçi
  5 pencerede **~192 MB**. Buna oturum gövdesi (~71 MB/8 sa) ekleniyor.
  CLAUDE.md §3'ün eMMC koruması bu hacimle bağdaşmıyor.

Ayrıca **üç senaryo hiçbir zaman üretilemiyor**, **üç sayaç hiç yazılmıyor**
ve **bir eşik ilan edilip hiç hesaplanmıyor** — bunlar raporda "ölçülüyor" gibi
görünen ama ölçülmeyen alanlardır (dürüstlük kusuru).

### Kapılar

| Kapı | Değer | Tek cümlelik gerekçe |
|---|---|---|
| `wiringVerdict` | **PARTIAL** | 11 kaynak gerçek producer'a bağlı; **6 kaynak NOT_WIRED** (Fleet realtime · AI Evidence · MAVI Reasoning · AI Mechanic · Music · Navigation). |
| `passiveObserverVerdict` | **PARTIAL** | Araç/OBD/GPS/medya/navigasyon kontrol yolu **temiz**; ancak 3 gerçek `PRODUCT_MUTATION` var (IDB store oluşturma · AI gateway cache priming · eMMC sayaç kirlenmesi). |
| `decisionIntegrityVerdict` | **FAIL** | `failedReconnectCount` hiç artmıyor ama FAIL koşulu; `gpsLiveCoverage` ilan edilip hesaplanmıyor; `obdStabilityMs` "bağlı süre" diyor, ölçüm süresini ölçüyor. |
| `selfValidationVerdict` | **FAIL** | Doğrulayıcı doğru çalışıyor **ve** ilk restore'da CORRUPT veriyor — çünkü denetlediği veri gerçekten bozuluyor (P0-1). |
| `persistenceVerdict` | **PARTIAL** | Yazım/geri yükleme/bozuk-kayıt reddi doğrulandı; ancak kimlik çakışması + iki anahtarın atomik olmaması açık. |
| `blackBoxVerdict` | **PARTIAL** | Pencere mantığı doğru ve dürüst; ancak `refusedWindows` ve `droppedBlackBoxRecords` hiçbir çıktıda görünmüyor → "sessiz kayıp yok" kuralı ihlal. |
| `performanceVerdict` | **FAIL** | eMMC hacmi (P0-2) + her tick'te 200 elemanlı dizi kopyası + her tick'te ≤100 kayıtlık trip geçmişi kopyası. |
| `privacyVerdict` | **PASS** | Ham JSON gerçekten taranıyor; diskteki gövde de sınandı; frame tipi yapısal olarak PII taşıyamıyor. |
| `driverSafetyVerdict` | **PARTIAL** | Gösterge `SAFE_PASSIVE`; ancak **LAB ekranında sürüş kapısı YOK** — detay ekranı ve rapor düğmesi araç hareket hâlindeyken açılabiliyor. |
| `recoveredFilesVerdict` | **VERIFIED_WITH_RESIDUAL_RISK** | Katalog 44/44 × 6 alan birebir; screenMap 35/35; MainLayout sahipsiz string 0. Derleme-sonrası pencere kör. |
| `realVehicleEvidenceVerdict` | **NOT_VALIDATED** | Gerçek araç, gerçek Android, gerçek OBD/GPS kanıtı **yok**. |

---

## 2 · GERÇEK WIRING HARİTASI

> Kural: *"Testte sahte event verilmesi gerçek wiring kanıtı sayılmaz."*
> Aşağıdaki "Test moduna bağlı mı" sütunu **üretim çağrı zincirini** gösterir,
> test mock'unu değil.

| Kaynak | Gerçek producer | Test moduna bağlı | Ham/Türetilmiş | Bağlantı | Risk |
|---|---|---|---|---|---|
| OBD lifecycle | `obdService` (native köprü) | ✅ `readSessionRawSnapshot().connLifecycle` | Türetilmiş sayaç | **WIRED** | Düşük |
| Handshake | `obdService.getHandshakeDiagnostics()` | ✅ | Türetilmiş | **WIRED** | Düşük |
| Polling | `obdService` iç zamanlayıcı | ⚠️ yalnız `dataFresh`/`lastPacketAge` üzerinden | Türetilmiş | **WIRED (dolaylı)** | Poll kadansı gözlenmiyor |
| KWP recovery | `kwpRecoveryEvidence` | ✅ | Türetilmiş sayaç | **WIRED** | Düşük |
| CAN / HAL | `halStatusStore` · `VehicleConnectivityManager` | ✅ `hal.canRetryCount` · `activeSource` | Türetilmiş | **WIRED** | Yalnız 2 alan okunuyor |
| GPS | `gpsService` (UnifiedVehicleStore) | ✅ izin durumu preflight'ta | Ham + türetilmiş | **WIRED** | Düşük |
| Location Engine | `locationEngineRuntime.getSnapshot()` | ✅ durum/sağlayıcı/sayaçlar | Türetilmiş | **WIRED** | LIVE kapsaması hesaplanmıyor (§6) |
| Trip Engine | `tripLogService.getTripSnapshot()` | ✅ mesafe otoritesi | Türetilmiş | **WIRED** | Tick başına 100 kayıtlık kopya (§10) |
| Fleet realtime | — | ❌ | — | **NOT_WIRED** | `REALTIME_DROP_RECOVER` **hiç üretilemez** |
| Offline Queue | `connectivityService.queueSize()` | ⚠️ yalnız snapshot anında | Türetilmiş sayı | **WIRED (seyrek)** | IDB store **oluşturuyor** (§3) |
| Android lifecycle | `document.visibilitychange` | ✅ | Ham | **WIRED** | `IGNITION_OR_APP_SHUTDOWN` üretilemez |
| Memory / thermal | `memoryWatchdog` · `SystemHealthMonitor.thermalLevel` | ✅ | Türetilmiş | **WIRED** | Düşük |
| BlackBox | Kendi halkası (`longRoadBlackBox`) | ✅ | Ham kare | **WIRED** | Kayıp sayaçları görünmez (§9) |
| CAROS LAB snapshot exporter | `readSessionRawSnapshot()` | ✅ | Ham | **WIRED** | Ana thread'de stringify |
| AI Evidence | `aiEvidenceEngine` | ❌ hiç import edilmiyor | — | **NOT_WIRED** | `AI_EVIDENCE` maddesi hep `NOT_OBSERVED` |
| MAVI Reasoning | `maviReasoning*` | ❌ | — | **NOT_WIRED** | Aynı |
| AI Mechanic | `aiMechanic` | ❌ | — | **NOT_WIRED** | Aynı |
| Music Hub | `mediaService` | ❌ (bilinçli) | — | **NOT_WIRED** | `MEDIA_PASSIVE` hep `NOT_OBSERVED` |
| Navigasyon | `navigationService` | ❌ (bilinçli) | — | **NOT_WIRED** | `NAV_PASSIVE` hep `NOT_OBSERVED` |

**Sonuç:** 13 kaynak WIRED · **6 kaynak NOT_WIRED**. Bunların 4'ü raporda
"açık borç" olarak zaten yazılı; ancak **Fleet realtime ve
IGNITION_OR_APP_SHUTDOWN katalogda varmış gibi duruyor** (§4.2).

---

## 3 · PASİF GÖZLEMCİ DENETİMİ (çağrı grafiği)

Her dış çağrı, çağrılan fonksiyonun **gövdesi okunarak** sınıflandırıldı.

| Çağrı | Ne yapıyor | Sınıf |
|---|---|---|
| `readSessionRawSnapshot()` | 13 senkron getter, hepsi try/catch, yalnız okuma | SAFE_OBSERVABILITY |
| `getOBDDataSnapshot()` | `{ ..._current }` kopya | SAFE_OBSERVABILITY |
| `readLocationEngineSnapshot()` | `locationEngine.getSnapshot()` — okuma | SAFE_OBSERVABILITY |
| `getGPSState()` | store okuması | SAFE_OBSERVABILITY |
| `getTripSnapshot()` | `_computeSnapshot()` — saf, ama **≤100 kayıtlık dizi kopyalar** | SAFE_OBSERVABILITY (perf notu §10) |
| `getGlobalHealthSnapshot()` | registry/store okuması, **atama yok** (doğrulandı) | SAFE_OBSERVABILITY |
| `runtimeManager.getMode()` | alan okuması | SAFE_OBSERVABILITY |
| `readPairingAuthority()` | `localStorage.getItem` ×2, değer okunmuyor | SAFE_OBSERVABILITY |
| `readTelemetryPushObservation()` | `getLastBuildReport()` okuması | SAFE_OBSERVABILITY |
| `onMemoryPressure(cb)` | Ürün modülünün `Set`'ine dinleyici **ekler**; cleanup'ta sökülür | TEST_INTERNAL_STATE |
| `document.addEventListener('visibilitychange')` | sökülüyor | TEST_INTERNAL_STATE |
| `safeSetRaw/safeGetRaw/safeRemoveRaw` (`caros.lab.*`) | Kendi ad alanı | TEST_INTERNAL_STATE |
| **`isAiGatewayEnabled()`** | İlk çağrıda `_cached`'i **doldurur** (memoization). Geçersizleme yolu var (`applyScopedGatewayAccess` cache'i sıfırlar) ama karar erkene alınmış olur | **PRODUCT_MUTATION** (düşük) |
| **`connectivityService.queueSize()`** | `openDB()` → `onupgradeneeded` → **`createObjectStore`**. Kuyruğu hiç kullanmamış cihazda **kalıcı IndexedDB veritabanı oluşturur** | **PRODUCT_MUTATION** (orta) |
| **`safeSetRaw(..., immediate)`** | `_commitToStorage` **`_emmcWriteCount++`** yapar; bu sayaç `SystemHealthMonitor` tarafından ürün sağlık metriği olarak raporlanır → **gözlemci ölçtüğü metriği kirletiyor** | **PRODUCT_MUTATION** (orta) |

**Temiz bulunanlar (hiçbir çağrı yok, çağrı grafiğiyle doğrulandı):** OBD komutu ·
connect/disconnect/reset · polling başlatma-durdurma · GPS start/stop ·
navigasyon başlatma · medya komutu · remote command · Evidence/Reasoning yazımı ·
Fleet queue mutation (enqueue/drain) · popup/toast/ses/TTS · ekran yönlendirmesi ·
foreground service davranışı. Ürün store'larına **hiçbir yazma yok**.

> **PRODUCT_MUTATION mevcut olduğu için bu kapı PASS OLAMAZ.** Üçü de düşük/orta
> şiddettedir ve düzeltilebilir (§16), ancak "hiçbir şeye dokunmuyor" iddiası
> bugün **doğru değildir**.

---

## 4 · HAM VERİ → OLAY → KARAR ZİNCİRİ

### 4.1 Doğrulama yöntemi

Zincir, geçici bir prob test dosyasıyla **gerçek kaydedici üzerinden** sürüldü
(mock'lanan yalnız okuma katmanı). Prob doğrulama sonrası **silindi**; ürün kodu
değiştirilmedi. Aşağıdaki "ölçülen" değerler o koşumdan gelmektedir.

### 4.2 Zincirler

| Olay | Ham giriş | Koşul | Event | Dedupe | Persistence | BlackBox/Snapshot | Rapor kararı |
|---|---|---|---|---|---|---|---|
| `OBD_DATA_LOSS` | `obdData.dataFresh` + `transportConnected` | `fresh===false && conn===true` (kenar) | `OBD_DATA_LOST` CRITICAL | `obdGapStartMono` null değilse tekrar üretmez | **anında** (kritik yol) | pencere + `OBD_DATA_LOSS` snapshot (cooldown 120 sn) | `OBD_RECOVERY`, `OBD_LONG_STABILITY` |
| `OBD_RECONNECTED` | `connLifecycle.reconnectRequestedCount` ↑ | sayaç artışı | `OBD_RECONNECT` WARN | sayaç kenarı | checkpoint | pencere | `OBD_RECOVERY` |
| `GPS_LOST` | `arbiter.state` | `OFFLINE\|LAST_KNOWN\|UNKNOWN` (kenar) | `GPS_LOST` WARN | `gpsLossStartMono` | checkpoint | pencere | `GPS_CONTINUITY` |
| `GPS_RECOVERED` | `arbiter.state === 'LIVE'` | kayıp açıkken | `GPS_RESTORED` INFO | — | checkpoint | — | `GPS_CONTINUITY` |
| `INTERNET_LOST` | `navigator.onLine` | `false` (kenar) | `INTERNET_LOST` WARN | `internetLossStartMono` | checkpoint | pencere | `FLEET_OFFLINE_REPLAY` |
| `REALTIME_RESYNC` | — | — | ❌ **ÜRETİLEMEZ** | — | — | — | `FLEET_REALTIME` **hep NOT_OBSERVED** |
| `TRIP_STARTED` | `tripState.active` | `false→true` | `TRIP_START` INFO | kenar | checkpoint | — | `TRIP_LIFECYCLE` |
| `TRIP_COMPLETED` | `tripState.active` | `true→false` | `TRIP_CLOSE_AFTER_STOP` | kenar | checkpoint | `TRIP_CLOSE` snapshot | `TRIP_LIFECYCLE` |
| `MEMORY_CRIT` | `memoryWatchdog` olayı | seviye değişimi | `MEMORY_PRESSURE` | seviye kenarı | **anında** (CRITICAL ise) | pencere + `MEMORY_CRIT` snapshot | `ANDROID_RESOURCE` |
| `THERMAL_CRITICAL` | `thermalJournal` seviyesi 0–3 | `↑ && ≥2` | `THERMAL_PRESSURE` | seviye kenarı | ≥3 ise anında | `THERMAL_CRIT` snapshot | `ANDROID_RESOURCE` |
| `PROCESS_RESTORED` | disk oturumu | `isRecordingState` | `RESTORE` WARN (tip: `RESTORE`) | — | anında | `PROCESS_RESTORE` snapshot | `ANDROID_PERSISTENCE` |

### 4.3 Kanıtsız üretilebilen / hiç üretilemeyen olaylar

**Hiçbir zaman üretilemeyen 3 senaryo** (kod taramasıyla doğrulandı — katalogda
30, `detect()` yalnız 27'sini üretebiliyor):

| Senaryo | Sonuç |
|---|---|
| `REALTIME_DROP_RECOVER` | `FLEET_REALTIME` maddesi **yapısal olarak PASS olamaz**; ayrıca BlackBox tetikleyici listesinde boş yere duruyor |
| `IGNITION_OR_APP_SHUTDOWN` | BlackBox tetikleyici listesinde, ama üretilemez |
| `RESTART` | Restore `RESTORE` tipinde olay yazıyor; `RESTART` senaryosu hep 0 kalıyor |

Bu üçü raporun "Senaryo kapsaması" tablosunda `NOT_OBSERVED` görünür ve
**"yolda yaşanmadı" gibi okunur** — oysa gerçek neden **üreteç yokluğudur**.
Bu bir dürüstlük kusurudur.

---

## 5 · YANLIŞ POZİTİF / YANLIŞ NEGATİF RİSKLERİ

| # | Risk | Karar | Dayanak |
|---|---|---|---|
| 1 | Tek gecikmiş callback `GPS_LOST` üretir mi | **PREVENTED** | Durum ürünün hakeminden gelir; `DEMOTE_GRACE_MS`/`MIN_DWELL` histerezisi hakemin içinde. Gözlemci kendi eşiğini koymaz. |
| 2 | Background'da OBD kaybı sanılır mı | **POSSIBLE** | `dataFresh` native beslemeye bağlı olduğundan foreground service ayaktayken güvenli; ancak WebView timer throttling'de tick seyrekleşir ve `dtValid` (10× kural) ile örneğin **zamanı sessizce sayılmaz**. Gerçek Android'de doğrulanmadı. |
| 3 | Kullanıcı aracı kapatınca reconnect hatası sayılır mı | **PREVENTED** | `OBD_RECONNECT` yalnız WARN; hiçbir FAIL yoluna girmez. |
| 4 | Backend yokluğu ürün FAIL'i olur mu | **PREVENTED** | `BLOCKED_BACKEND` üretilir (testle kilitli). |
| 5 | Desteklenmeyen PID invalid sayılır mı | **PREVENTED** | `-1`/`undefined` → `isSignalSupported=false`; `invalidSamples` artmaz. |
| 6 | Stale değer yeni örnek sayılır mı | **PREVENTED** | `staleSamples` ayrı; `coveredMs` artmaz. |
| 7 | Restore sonrası eski olay yeniden üretilir mi | **CONFIRMED_BUG** | Ölçüldü: `FIRST_VEHICLE_LINK` 1→**2**, `FIRST_HANDSHAKE_OK` 1→**2**. `detect` durumu sıfırlanıyor, `firstLinkSeen` kalıcı değil. "İLK" adlı senaryo her restore'da tekrar sayılıyor. |
| 8 | Event fırtınası BlackBox/snapshot çoğaltır mı | **PREVENTED** | Aynı tip için ikinci pencere açılmaz; tetik başına cooldown + global 15 sn (testle kilitli). |
| 9 | Android saat değişimi süreleri bozar mı | **POSSIBLE** | Süreler monoton; **ancak snapshot cooldown'ı duvar saatiyle** karar veriyor (`_requestSnapshot(..., wall)`). Geriye saat sıçramasında `now-last<cd` → snapshot'lar süresiz bastırılır. |
| 10 | Aynı timestamp kayıtları ezilir mi | **PREVENTED** | Olaylar diziye eklenir, anahtarla eşlenmez. |
| 11 | Bilinmeyen hız "araç duruyor" sayılır mı | **PREVENTED** | `unknownMs`'e yazılır; göstergede bilinmezlik "hareket" varsayılır (fail-closed). |
| 12 | Null termal durum normal sayılır mı | **PREVENTED** | Her iki örnek de non-null olmadan olay üretilmez. |
| 13 | Recorder drop ettiği hâlde PASS verebilir mi | **CONFIRMED_BUG** | `OBSERVER_INTEGRITY` DEGRADED olur ve nihai karar PARTIAL'a düşer; **ancak tekil maddeler (ör. `OBD_LONG_STABILITY`) drop varken PASS verebilir.** Ayrıca `droppedSamples` hiç artırılmadığı için örnek kaybı zaten görünmez. |
| 14 | GPS `STALE`'de kalırsa kayıp süresi şişer mi | **POSSIBLE** | `gpsLost` tanımı `STALE`'i içermez; `OFFLINE→STALE` geçişinde kayıp sayacı temizlenmez, `longestGpsLossMs` büyümeye devam eder. |

---

## 6 · ACCEPTANCE MOTORUNUN DENETİMİ

Kararlar tek yerde üretiliyor: `longRoadAcceptance.buildAcceptanceMatrix()` →
`finalVerdict()`. Bu iyi bir tasarım (tek otorite). Ancak üç ciddi kusur var.

### 6.1 Madde bazında ölçüm doğruluğu

| Madde | Gerekli asgari kanıt | Formül | Kusur |
|---|---|---|---|
| `OBD_LINK` | ≥1 bağlantı gözlemi | `hits>0` | — |
| `OBD_HANDSHAKE` | handshake `ok` | `hits>0`, link varsa yoksa FAIL | — |
| `OBD_LONG_STABILITY` | 60 dk **bağlı** süre · %90 tazelik · 0 başarısız reconnect | `recordedMs≥60dk && coverage≥0.9 && failed===0` | ❗ **`recordedMs` "bağlı süre" DEĞİL, toplam ölçüm süresidir.** ❗ `failedReconnectCount` **hiç artırılmıyor** → FAIL dalı ölü. |
| `OBD_SIGNAL_INTEGRITY` | invalid oran ≤ %1 | oran + `enoughTime` | — |
| `OBD_RECOVERY` | kayıp/reconnect varsa toparlanma | `failed>0→FAIL` | ❗ Aynı ölü sayaç → **FAIL asla üretilemez** |
| `GPS_CONTINUITY` | **"LIVE kapsaması ≥ %80"** + geri dönüş | yalnız `lost/restored` sayısı | ❗ **Kapsama HİÇ HESAPLANMIYOR.** İlan edilen şart uygulanmıyor. |
| `GPS_TUNNEL` | tünel olayı | `hits>0` | — |
| `TRIP_LIFECYCLE` | açılış+kapanış | kenar sayıları | — |
| `TRIP_TIME_INVARIANT` | süre invaryantı | ±2 ms | — |
| `DRIVER_CHAIN` | gerçek sürücü kaynağı | sabit `BLOCKED_HARDWARE` | Dürüst |
| `FLEET_OFFLINE_REPLAY` | kuyruk büyüme+boşalma | backend yoksa BLOCKED | — |
| `FLEET_REALTIME` | realtime olayı | `hits>0` | ❗ **Üreteç yok → PASS imkânsız** |
| `AI_EVIDENCE` | AI akışı | sabit NOT_OBSERVED/BLOCKED_POLICY | Dürüst (borç yazılı) |
| `ANDROID_PERSISTENCE` | restore | `restoreCount>0 && version>1` | — |
| `ANDROID_RESOURCE` | baskı olayı | `hits>0` | — |
| `MEDIA_PASSIVE` / `NAV_PASSIVE` | — | sabit NOT_OBSERVED | Dürüst (borç yazılı) |
| `OBSERVER_INTEGRITY` | drop yok | `dropped===0` | ❗ `droppedSamples`/`droppedBlackBoxRecords` hiç yazılmadığı için **yalnız `droppedEvents`i görebilir** |

### 6.2 Yasak listesi kontrolü

| Yasak | Durum |
|---|---|
| Keyfî eşik | ✅ Her madde `thresholdSource` taşıyor, `SPEC`/`PRODUCT_CONTRACT` ayrımı var |
| Yorum satırına dayalı eşik | ✅ Yok — eşikler `LR_THRESHOLDS` sabitinde |
| Kanıt eksikken PASS | ✅ `minRecordedMs` + `NOT_OBSERVED` varsayılanı |
| `droppedRecords > 0` iken kesin PASS | ❌ **İHLAL** — tekil maddeler drop'tan bağımsız PASS verebiliyor |
| `NOT_OBSERVED`'ın PASS sayılması | ✅ Ayrı sayılıyor, `unresolved`a giriyor |
| `BLOCKED_BACKEND`'in FAIL sayılması | ✅ Ayrı kategori |
| `UNKNOWN`'ın 0'a çevrilmesi | ✅ `counterDelta` null döner, `-1` sentinel'i korunur |

### 6.3 Beş SPEC eşiği

| Eşik | Değer | Karar | Gerekçe |
|---|---|---|---|
| `obdStabilityMs` | 60 dk | **UNSAFE** | Metin "bağlı süre" diyor, kod ölçüm süresini ölçüyor → yanlış PASS üretebilir |
| `obdFreshCoverage` | %90 | **NEEDS_SPEC** | Kullanılıyor ve anlamlı; ancak `speed` sinyalinin kapsaması OBD tazeliğine **vekil**. EV/hız desteklemeyen araçta yanıltır |
| `invalidSampleRatio` | %1 | **NEEDS_SPEC** | Kullanılıyor, mantıklı; ürün sahibi onayı gerekli |
| `gpsLiveCoverage` | %80 | **UNUSED** | İlan ediliyor, **hiç hesaplanmıyor** |
| `minRecordedMs` | 10 dk | **VALID_PRODUCT_CONTRACT** | Kanıt-yetersizliği kapısı olarak doğru kullanılıyor |

---

## 7 · SELF-VALIDATION

İkinci, salt-okunur yol **VAR**: `longRoadSelfValidator.ts` (8 denetim).
Otorite ayrımı yapısal olarak sağlam (kabul matrisini import etmiyor,
`affectsAcceptanceVerdict:false`, JSON'da ayrı blok, mutasyon yok).

| Sorulması gereken | Cevaplanabiliyor mu |
|---|---|
| Rapordaki sayaç ham eventlerden yeniden hesaplanabiliyor mu | ✅ `COUNTER_RECOMPUTE` (3 sayaç) |
| PASS/FAIL dayanakları tekrar üretilebiliyor mu | ⚠️ **Kısmen** — yalnız 3 sayaç; kapsama/süre/eşik yeniden üretilmiyor |
| Event ↔ snapshot/BlackBox referansı gerçekten var mı | ⚠️ BlackBox↔event ✅ (`CHECKPOINT_RING`); **snapshot↔event referansı YOK** |
| Checksum doğru mu | ❌ **Checksum yok** — ne oturumda ne BlackBox zarfında |
| Persistence ile memory state eşleşiyor mu | ❌ **Denetlenmiyor** — diskteki gövde ile bellekteki karşılaştırılmıyor |
| Drop olmuş veri kararı etkiliyor mu | ✅ `DROPPED_IMPACT` → `INSUFFICIENT_RAW_EVIDENCE` |

**Kritik gözlem:** Doğrulayıcı **doğru çalışıyor** ve P0-1'i yakalıyor
(`DUPLICATE_EVENTS = CORRUPT`). Yani `selfValidationVerdict=FAIL` doğrulayıcının
değil, **denetlediği verinin** kusurudur. Bu, doğrulayıcının değerini kanıtlar.

---

## 8 · PERSISTENCE / RESTORE

| Kontrol | Bulgu |
|---|---|
| Write ordering | Oturum önce, BlackBox sonra; **iki ayrı anahtar** |
| Atomicity | ❌ **İki anahtar arasında atomiklik YOK** — oturum yazılıp BlackBox yazılmadan ölüm mümkün |
| Yarım kayıt | `JSON.parse` hatası → `CORRUPT` (fail-closed, doğrulandı) |
| `sessionId` korunması | ✅ ölçüldü |
| `sessionVersion` artışı | ✅ 1→2 ölçüldü |
| Duplicate replay | ❌ **P0-1: olay kimlikleri çakışıyor** (`EV-2`,`EV-3` tekrar) |
| Bozuk kaydın reddi | ✅ `loadSession()=CORRUPT` |
| Eski şema migration | ✅ gelecek şema reddi + eksik defter tamamlama |
| Storage doluluğu | ✅ `classifyStoragePressure`, ölçülemezse `WARN` (iyimser değil) |
| Concurrent write | Tek iş parçacığı; `augmentInFlight` guard'ı var |
| Kritik event immediate persistence | ✅ ölçüldü |
| Rapor sırasında aktif kayıt | ⚠️ Rapor senkron üretiliyor; tick araya giremez (tek thread) — ama `_state.bodies` referansı paylaşılıyor |

**Restart testleri gerçek üretim storage adapter'ını kullanıyor mu:**
**KISMEN.** Gerçek `safeStorage` modülü kullanılıyor (mock değil), ancak
altında **jsdom `localStorage`** var — Android WebView `_fsCache`/native yolu
(`NATIVE` dalı) **hiç çalıştırılmadı**. Kanıt seviyesi:
`INTEGRATION_SIMULATION + REAL_STORAGE_MODULE`, **REAL_ANDROID değil**.

---

## 9 · BLACKBOX / SNAPSHOT

### BlackBox

| Soru | Bulgu |
|---|---|
| 60 sn pre-window gerçekten mümkün mü | ✅ Halka 200 kare @1 Hz ≥ 180 sn. Tick seyrekleşirse halka daha az **süre** tutar; `preWindowComplete` bunu dürüstçe `false` yapar |
| 120 sn post-window nasıl kapanıyor | Kare geldikçe `advanceWindow`; kare gelmezse `closeIfElapsed` |
| Process ölürse post-window | Açık pencereler de diske yazılıyor; restore'da `closed`'a alınıp `postWindowComplete:false` kalıyor → **dürüst** |
| Ring monotonic mi | ✅ `t` = `performance.now()`, monoton |
| Duplicate event aynı pencereyi çoğaltır mı | ✅ Aynı tip açıkken ikinci pencere açılmaz |
| `droppedRecords` görünür mü | ⚠️ **Pencere içinde var, oturum defterine taşınmıyor**; `refusedWindows` **hiçbir çıktıda yok** |
| Maskeleme ham payload'a uygulanıyor mu | ✅ Kare tipi yalnız sayı/enum taşır; PII yapısal olarak giremez |

### Snapshot

| Soru | Bulgu |
|---|---|
| 30 dk / 100 km | ✅ 30 dk monoton, 100 km trip otoritesi |
| Kritik olay | ✅ tetikleyiciler tanımlı |
| Cooldown / dedupe | ✅ tetik başına + global 15 sn (testle kilitli) |
| Ana thread etkisi | ❗ `readSessionRawSnapshot()` + `JSON.stringify` **ana thread'de** |
| Snapshot başarısızlığı | `raw=null` ile devam eder, `bytes=0` |
| Exporter gerçekten bağlı mı | ✅ gerçek LAB okuyucusu |
| **Bütçe önceliği** | ❗ **YOK.** `decideSnapshot` bütçeyi **ilk** kontrol eder; 24 saatte periyodik snapshot'lar 58/64'e ulaşır ve sonrasında **MEMORY_CRIT/THERMAL_CRIT/OBD_DATA_LOSS snapshot'ları reddedilir** |

---

## 10 · PERFORMANS VE KAYNAK BÜTÇESİ (koddan türetildi)

**Zamanlayıcı:** 1 adet (`setInterval` 1000 ms). **Dinleyici:** 3
(memory-pressure · visibilitychange · badge aboneliği).

**Tick başına (1 Hz) tahsis** — kod okunarak:

| Kaynak | Maliyet |
|---|---|
| `readSessionRawSnapshot()` | ~13 alt nesne |
| `getTripSnapshot()` | ❗ **`history: [..._state.history]` → ≤100 kayıtlık dizi kopyası, saniyede bir** |
| `_advanceLedgers` | 7 sinyal satırı + odometry + 11 sayaç çifti |
| `detect()` | çok sayıda `{...st}` spread + hits dizisi |
| `ringPush` | ❗ **`[...frames.slice(1), frame]` → 200 elemanlı dizi kopyası, saniyede bir** |
| `markScenario` (olay başına) | 30 senaryonun tamamı `map` ile yeniden üretilir |

**Disk yazma (ölçülen sabitlerden):**

| Kalem | Hacim |
|---|---|
| 1 BlackBox karesi | **210 bayt** |
| 1 pencere (200 kare) | **41 KB** |
| 24 pencere | **0,96 MB** (tavan 3 MB — ✅ sığıyor) |
| **Her 30 sn'de BlackBox blob'unun TAMAMI yeniden yazılıyor** | 24 pencerede **984 KB / checkpoint** |
| → 8 saat | ❗ **~923 MB eMMC yazımı** |
| → 24 saat | ❗ **~2 769 MB** |
| Gerçekçi 5 pencere senaryosu / 8 saat | ❗ **~192 MB** |
| Oturum gövdesi (400 olay dolduğunda) | ~76 KB → 8 saatte **~71 MB** |

**Veri boyutu tahmini:** 8 sa ≈ 76 KB oturum + ≤1 MB BlackBox · 24 sa aynı
(tavanlar devrede). Bellek: halka ~42 KB + pencereler ≤1 MB + 8 snapshot gövdesi.

**Mali-400 / K24 değerlendirmesi:** 1 Hz'lik tahsis yükü ürünün 3 Hz hot-path'i
yanında **kabul edilebilir**; asıl risk **eMMC yazma hacmi** ve 30 sn'de bir
ana thread'de yapılan `JSON.stringify`'dır (≤1 MB blob → düşük-uçta kare atlaması
olası). CLAUDE.md §3 yazma sıklığını 5–10 sn ile sınırlar; **sıklık uygun,
hacim değil**.

---

## 11 · GİZLİLİK

Gerçek dışa aktarım yolu izlendi: LAB *RAPOR* düğmesi → `buildLongRoadReport()`
→ markdown + **JSON (snapshotBodies dahil)** → panoya kopyalanır.

| Kontrol | Sonuç |
|---|---|
| Tam VIN | ✅ `maskVehicleRef` son 6 hane; `auditPrivacy` 17 haneli deseni tarar; **diskteki ham gövde de sınandı** |
| API key / token / JWT | ✅ Taranıyor; okuma katmanı değer taşımıyor (yalnız VAR/YOK) |
| E-posta | ✅ Taranıyor |
| Kullanıcı kimliği | ✅ Taşınmıyor |
| Tam konum geçmişi | ✅ Frame tipinde `lat/lng` alanı **yok**; koordinat anahtarı taranıyor |
| Ham Bluetooth kimliği | ✅ Taşınmıyor |
| Session secret | ✅ Taşınmıyor |
| Maskeleme yalnız UI'da mı | ✅ **Hayır** — JSON ve diskteki gövde ayrıca sınanıyor |

⚠️ Not (ihlal değil, kayıt): `env.deviceModel` = `navigator.userAgent` ilk 120
karakter — cihaz parmak izi niteliğinde, yasak listesinde değil.

**`privacyVerdict = PASS`.**

---

## 12 · SÜRÜCÜ GÜVENLİĞİ

| Kontrol | Bulgu |
|---|---|
| Aktif gösterge pasif mi | ✅ Oturum yokken `null` render |
| Sürüş sırasında detay | ⚠️ Gösterge özeti kapalı; **ancak LAB ekranında hız kapısı YOK** |
| Popup / toast | ✅ Yok |
| Ses / TTS | ✅ Yok |
| Hız bilinmiyorsa özet | ✅ Fail-closed kapalı |
| **Araç hareketliyken rapor üretilebiliyor mu** | ❗ **EVET** — `onReport` hiçbir hız kapısına tabi değil |
| Otomatik ekran yönlendirmesi | ✅ Yok |
| Dokunma hedefleri | Gösterge tek küçük kutu; LAB ekranı yoğun ama geliştirici yüzeyi |

**Sonuç: `SAFE_PASSIVE` (gösterge) + `UNKNOWN` (LAB ekranı) → kapı PARTIAL.**
LAB `isCarosLabAllowedFromEnv()` ile kapalı olduğu için satış build'inde risk
düşüktür; ancak geliştirici cihazında sürüş sırasında açılabilir.

---

## 13 · KURTARILAN ÜÇ DOSYA

Kanıt: `src/__tests__/_auditCatalogRecovery.test.ts` (7 iddia, geçiyor).

| Kontrol | Sonuç |
|---|---|
| Tüm tool ID'leri | ✅ **44/44**, `category·name·desc·status·layer·note` **birebir** |
| Ekran map'i | ✅ **35/35** case aynı ekrana; fazladan tek case = yeni uzun yol aracı |
| `focus` prop | ✅ `queue-monitor` / `poll-scheduler` korunmuş |
| Sürüş kapısı | ✅ `!tripSummaryBlocked` + `canShowTripSummary(...)` geri konuldu, **kilit yazıldı** |
| Import grafiği | ✅ `tsc -b` temiz; ekran dosyası ↔ screenMap taraması: eşleşmeyen 3 dosya meşru (2 alt bileşen + 1 fallback ekranı) |
| MainLayout | ✅ Derlenmiş çıktının 90 string'i tarandı; **sahipsiz string 0** (34'ünün sahibi `useOBDLifecycle`/`useVoiceCommandHandler` çıktı) |
| Dist güncel kaynak mı | ⚠️ Derleme **2026-08-01 23:55**; tüm LAB ekran dosyalarının mtime'ı bundan **eski** → o an güncel. **23:55 sonrası düzenleme penceresi KÖR** |

**Denetimin bulduğu gerçek kayıp:** `<FieldTestBadge />` mount'u kurtarma
sırasında düşmüştü; `tsc` temiz ve **tüm suite yeşildi**, hiçbir test yakalamadı.
Geri kondu ve mount kilidi yazıldı (kütük #315). *"Tüm testler yeşil" bir mount'un
varlığını kanıtlamaz.*

---

## 14 · TEST KANIT SEVİYELERİ

| İddia | Kanıt seviyesi |
|---|---|
| Durum makinesi · senaryo algılama · sinyal defteri · kabul matrisi · öz-denetim | **UNIT_SIMULATION** |
| Kaydedici yaşam döngüsü · restore · snapshot politikası · BlackBox kapanışı | **INTEGRATION_SIMULATION** (okuma katmanı mock) |
| Kalıcılık | **REAL_STORAGE (modül)** — gerçek `safeStorage`, ama **jsdom localStorage**; Android native yolu çalışmadı |
| Katalog/screenMap kurtarması | **BUILD_ARTIFACT_DIFF** (derlenmiş bundle karşılaştırması) |
| eMMC/performans rakamları | **STATIC_CODE_BUDGET** (sabitlerden hesap, ölçüm değil) |
| Android dayanıklılığı | **REAL_ANDROID: YOK** |
| OBD / GPS / araç | **REAL_OBD · REAL_GPS · REAL_VEHICLE: YOK** |

**Hiçbir iddia saha doğrulaması olarak sunulmamaktadır.**

---

## 15 · BULGULAR (P0–P4)

| # | Öncelik | Bulgu | Durum |
|---|---|---|---|
| 1 | **P0** | Restore sonrası **olay kimlikleri çakışıyor** (`_state.seq` sıfırlanıyor, oturumdan tohumlanmıyor) → öz-denetim **CORRUPT** | CONFIRMED_BUG (ölçüldü) |
| 2 | **P0** | **BlackBox blob'u her 30 sn'de tamamen yeniden yazılıyor** → 8 saatte ~192–923 MB eMMC | CONFIRMED_BUG (sabitlerden hesaplandı) |
| 3 | **P1** | `failedReconnectCount` **hiç artırılmıyor** ama `OBD_LONG_STABILITY`/`OBD_RECOVERY` FAIL koşulu → FAIL dalı ölü | CONFIRMED_BUG |
| 4 | **P1** | `gpsLiveCoverage` eşiği **ilan edilip hesaplanmıyor** → rapor uygulanmayan bir şart yazıyor | CONFIRMED_BUG |
| 5 | **P1** | `obdStabilityMs` "bağlı süre" diyor, **ölçüm süresini** ölçüyor | CONFIRMED_BUG |
| 6 | **P1** | 3 senaryo (`REALTIME_DROP_RECOVER`, `IGNITION_OR_APP_SHUTDOWN`, `RESTART`) **hiç üretilemiyor**; `FLEET_REALTIME` yapısal olarak PASS olamıyor | CONFIRMED_BUG |
| 7 | **P1** | Restore sonrası `FIRST_VEHICLE_LINK` / `FIRST_HANDSHAKE_OK` **tekrar sayılıyor** (1→2 ölçüldü) | CONFIRMED_BUG |
| 8 | **P2** | `connectivityService.queueSize()` **IndexedDB store oluşturuyor** (ürün mutasyonu) | CONFIRMED |
| 9 | **P2** | Snapshot bütçesinde **kritik önceliği yok**; 24 saatte periyodikler bütçeyi doldurup kritik snapshot'ları engelleyebilir | CONFIRMED |
| 10 | **P2** | `droppedSamples` · `droppedBlackBoxRecords` · `refusedWindows` **hiç yazılmıyor/görünmüyor** → "sessiz kayıp yok" ihlali | CONFIRMED_BUG |
| 11 | **P2** | Snapshot cooldown'ı **duvar saatiyle**; geriye saat sıçramasında snapshot'lar bastırılır | POSSIBLE |
| 12 | **P2** | **LAB ekranında sürüş kapısı yok** — detay ve rapor araç hareketliyken açılabiliyor | CONFIRMED |
| 13 | **P3** | Tekil kabul maddeleri `dropped>0` iken PASS verebiliyor | CONFIRMED |
| 14 | **P3** | `getTripSnapshot()` tick başına ≤100 kayıtlık dizi kopyalıyor; `ringPush` 200 elemanlı dizi kopyalıyor | CONFIRMED |
| 15 | **P3** | `isAiGatewayEnabled()` cache'i erken donduruyor (ürün mutasyonu, geçersizleme yolu var) | CONFIRMED |
| 16 | **P3** | `safeSetRaw` ile `_emmcWriteCount` kirleniyor — gözlemci ölçtüğü metriği etkiliyor | CONFIRMED |
| 17 | **P3** | `blackBoxIds` alanı tanımlı ama **hiç yazılmıyor** (ölü alan) | CONFIRMED |
| 18 | **P3** | Öz-denetimde **checksum yok**, **disk↔bellek karşılaştırması yok**, **snapshot↔event referansı yok** | CONFIRMED |
| 19 | **P4** | `OFFLINE→STALE` geçişinde GPS kayıp süresi şişebilir | POSSIBLE |
| 20 | **P4** | Kurtarmanın 23:55 sonrası kör penceresi | INSUFFICIENT_EVIDENCE |

---

## 16 · YOLA ÇIKMADAN ÖNCE ZORUNLU DÜZELTMELER (öneri — UYGULANMADI)

> Aşağıdakiler **plan**dır. Onayın olmadan ürün kodu değiştirilmeyecektir.

### Yola çıkmadan ÖNCE (bloklayıcı)

| # | Düzeltme | Neden bloklayıcı | Tahmini dokunuş |
|---|---|---|---|
| **D1** | `initLongRoadRecorder`'da `_state.seq`'i restore edilen oturumun mevcut `EV-*`/`SNAP-*` kimliklerinin **maksimumundan tohumla** (veya kimliğe `sessionVersion` öneki ekle) | İlk gerçek process death raporun bütünlük denetimini CORRUPT yapar — yolun asıl kanıtı çöper | `longRoadRecorder.ts` tek fonksiyon |
| **D2** | BlackBox'ı **her checkpoint'te tam yeniden yazma**; yalnız pencere kümesi **değiştiğinde** yaz (kapanış/açılış kenarı) | 8 saatte yüzlerce MB eMMC yazımı — donanım ömrü | `longRoadRecorder._persist` |
| **D3** | Snapshot bütçesine **kritik önceliği** ekle (kritik tetikler için ayrılmış kota) | 24 saatlik yolda kritik anın snapshot'ı reddedilebilir | `longRoadModel.decideSnapshot` |

### Yola çıkmadan önce YAPILMASI iyi olur (dürüstlük)

| # | Düzeltme |
|---|---|
| **D4** | `failedReconnectCount`'u ya gerçekten üret (ör. `reconnectRequested` artıp `dataFresh` N sn içinde dönmezse) ya da **maddeden ve rapordan kaldır** |
| **D5** | `gpsLiveCoverage`'ı ya hesapla (LIVE örnek oranı) ya da requirement metninden **çıkar** |
| **D6** | `obdStabilityMs`'i gerçek **bağlı süre** üzerinden ölç (`transportConnected` doğruyken geçen dt) veya metni "ölçüm süresi" diye düzelt |
| **D7** | Üretilemeyen 3 senaryoyu ya üreteçle bağla ya da katalogdan **çıkar**; en azından raporda `NO_PRODUCER` diye ayır |
| **D8** | `firstLinkSeen`/`firstHandshakeSeen`'i oturumla birlikte **kalıcı** yap |
| **D9** | `droppedSamples` · `droppedBlackBoxRecords` · `refusedWindows`'u gerçekten yaz ve rapora taşı |
| **D10** | Snapshot cooldown'ını **monoton saate** çevir |
| **D11** | LAB ekranına **sürüş kapısı** ekle (hareket hâlindeyken salt-özet, rapor düğmesi pasif) |
| **D12** | `queueSize()` çağrısını **kuyruk zaten kullanılıyorsa** yap (IDB oluşturmayı önle) |

### Sonraki tura bırakılabilir

D13 `blackBoxIds` ya doldur ya kaldır · D14 öz-denetime checksum + disk↔bellek
karşılaştırması · D15 `dropped>0` iken tekil maddelerin PASS'ini kısıtla ·
D16 tick başına trip geçmişi kopyasını azalt.

---

## 17 · NİHAİ KARAR

```
FIELD_VALIDATION_AUDIT_BLOCKED
```

Sistem **mimari olarak sağlam** ve dürüstlük ilkeleri (NOT_OBSERVED ≠ FAIL,
BLOCKED_BACKEND ≠ FAIL, UNKNOWN ≠ 0, ikinci doğrulama otoritesi, gizlilik
ölçümü) gerçekten uygulanmış. Ancak:

- **D1 ve D2 düzeltilmeden yola çıkmak, yolun kanıtını riske atar:**
  ilk process death'te bütünlük denetimi CORRUPT olur ve eMMC'ye yüzlerce MB
  yazılır.
- **decisionIntegrity** kapısı üç ölçüm hatasıyla FAIL'dir; bu hâliyle
  rapordaki bazı PASS/FAIL'ler **ölçmediği şeyi iddia eder**.

`realVehicleEvidenceVerdict = NOT_VALIDATED` — bu denetimdeki hiçbir bulgu
gerçek araç kanıtı yerine geçmez.

**Onay verirsen D1–D3'ü (bloklayıcılar) ayrı ve atomik yamalar hâlinde
uygularım; D4–D12 ikinci turda.**
