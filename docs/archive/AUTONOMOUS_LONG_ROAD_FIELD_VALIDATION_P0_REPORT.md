# OTOMATİK UZUN YOL SAHA DOĞRULAMA — P0 RAPORU

**Tarih:** 2026-08-02 · **Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Sürücünün dikkatini dağıtmayan, ürün davranışına dokunmayan, uzun yol
boyunca tamamen otomatik çalışan saha doğrulama sistemi (P0 temeli).

---

## 0 · NİHAİ GELİŞTİRME KARARI

```
AUTONOMOUS_FIELD_VALIDATION_P0_PARTIAL
```

**Neden PASS değil:** sistem yereldeki her ölçütü karşılıyor (116 yeni test,
`tsc -b` temiz, lint temiz, tüm mevcut CAROS LAB regresyonları yeşil), ancak
**gerçek araçta bir kez bile koşmadı**. CLAUDE.md §Saha Doğrulama Kütüğü gereği
test yeşilliği bir özelliği "başarılı" YAPMAZ. Ayrıca üç gözlem kanalı (AI
kanıt akışı · müzik · navigasyon) bilinçli olarak P0 dışında bırakıldı ve açık
borç olarak kaydedildi — bunlar `NOT_OBSERVED` döner, "çalışıyor" GÖRÜNMEZ.

### Ek kapılar

| Kapı | Değer | Dayanak |
|---|---|---|
| `productBehaviorVerdict` | **UNCHANGED** | §4'teki kanıt: yalnız 3 ürün dosyasına *toplayıcı* değişiklik; yasak-çağrı kilidi 9 dosyada testle sabitlendi. |
| `driverDistractionVerdict` | **SAFE_PASSIVE** | Gösterge popup/ses/odak üretmez, oturum aktif değilken `null` render eder; özet YALNIZ araç dururken açılabilir, hız bilinmiyorsa fail-closed kapalı. |
| `persistenceVerdict` | **PARTIAL** | Restore yolu testle kanıtlandı (aynı `sessionId`, artan `sessionVersion`), ama **gerçek cihazda process death yaşanmadı**. Kayıp penceresi ölçülü ve sınırlı: ≤ `LR_MAX_CHECKPOINT_LOSS_MS` (30 sn); kritik olaylar bu pencereyi beklemez. |
| `privacyVerdict` | **PASS** | İddia değil ÖLÇÜM: rapor gövdesi `auditPrivacy()` ile gerçekten taranıyor (VIN·koordinat·JWT·Bearer·e-posta·anahtar deseni) ve testte hem pozitif hem negatif yönde kilitli. |
| `realVehicleValidationVerdict` | **BLOCKED_REAL_VEHICLE** | `obdAdapter !== 'real'` veya geçerli hız örneği yoksa sistem KENDİSİ bu kararı verir ve raporun sonuna açık uyarı basar. |

---

## 1 · MEVCUT OBSERVABILITY KAYNAKLARI (yeniden kullanıldı, YENİSİ KURULMADI)

Bu tur **hiçbir paralel okuma katmanı, ikinci session engine veya yeni global
store kurmadı.** Tüm veri şu mevcut yüzeylerden okundu:

| Kaynak | Ne verdi |
|---|---|
| `devtools/sessionInspectorSources.readSessionRawSnapshot()` | OBD durumu · veri tazeliği · bağlantı yaşam döngüsü · taşıma istatistikleri · handshake (protokol, VIN varlığı, desteklenen PID) · KWP recovery · HAL · connectivity |
| `obdService.getOBDDataSnapshot()` | 7 sinyal (hız · RPM · motor sıcaklığı · gaz · emme · yakıt · 12V) |
| `location/locationEngineRuntime.readLocationEngineSnapshot()` | Konum durumu (LIVE/STALE/LAST_KNOWN/OFFLINE/UNKNOWN) · sağlayıcı · hassasiyet · geçiş/fallback sayaçları |
| `tripLogService.getTripSnapshot()` | Trip açık/kapalı · **mesafe otoritesi** (paralel mesafe entegrasyonu YAPILMADI) |
| `devtools/fleetConnectivitySources` | Eşleştirme otoritesi (VAR/YOK) · telemetri raporu varlığı |
| `system/SystemHealthMonitor.getGlobalHealthSnapshot()` | Termal seviye (0–3) · RAM baskı oranı · UI freeze · worker restart · uygulama sürümü |
| `core/runtime/AdaptiveRuntimeManager.getMode()` | Çalışma modu |
| `memoryWatchdog.onMemoryPressure()` | Bellek baskısı — **ürünün kendi otoritesi**, biz eşik üretmedik |
| `connectivityService.queueSize()` | Çevrimdışı kuyruk boyu (tek async okuma, yalnız snapshot anında) |
| `devtools/carosLabClipboard` | Rapor dışa aktarımı |

**Eşik üretmedik, ürünün hükmünü SAYDIK:** "veri bayat mı" kararı
`obdService`in `dataFresh` alanıdır; "konum canlı mı" kararı `locationConfidence`
ölçeğidir; "trip açıldı/kapandı" kararı `tripLogService`in durum makinesidir.

---

## 2 · YENİ DOSYALAR

| Dosya | Satır | Rol |
|---|---:|---|
| `src/platform/fieldValidation/longRoadModel.ts` | ~900 | **SAF** — oturum durum makinesi · senaryo kataloğu (30) · sinyal defteri · sayaç defteri · yol defteri · snapshot politikası (cooldown+dedupe+bütçe) · depolama baskısı budaması · gizlilik süzgeci · şema göçü |
| `src/platform/fieldValidation/longRoadDetect.ts` | ~420 | **SAF** — örnek sözleşmesi + kenar tabanlı senaryo algılama |
| `src/platform/fieldValidation/longRoadBlackBox.ts` | ~290 | **SAF** — bounded halka tamponu, olay penceresi (öncesi 60 sn / sonrası 120 sn) |
| `src/platform/fieldValidation/longRoadAcceptance.ts` | ~440 | **SAF** — kabul matrisi (17 madde) · nihai karar · P0–P4 bulgular · eşik kaynak beyanı |
| `src/platform/fieldValidation/longRoadReport.ts` | ~430 | **SAF** — Türkçe markdown + makine JSON + gizlilik denetimi |
| `src/platform/fieldValidation/longRoadSources.ts` | ~340 | Tek okuma katmanı (senkron, her getter try/catch) |
| `src/platform/fieldValidation/longRoadStore.ts` | ~180 | `safeStorage` üzerinden versiyonlu, bounded, fail-closed kalıcılık |
| `src/platform/fieldValidation/longRoadRecorder.ts` | ~560 | **Sistemin TEK zamanlayıcı sahibi** — 1 Hz gözlemci döngüsü |
| `src/components/devtools/screens/LongRoadFieldValidationScreen.tsx` | ~360 | CAROS LAB salt-okunur ekranı |
| `src/components/common/FieldTestBadge.tsx` | ~140 | Sürüş sırasındaki pasif gösterge |
| `src/__tests__/longRoadFieldValidation.test.ts` | ~950 | 92 kilit |
| `src/__tests__/longRoadFieldValidationRuntime.test.ts` | ~330 | 24 runtime kilidi |

## 3 · DEĞİŞTİRİLEN DOSYALAR (yalnız 3, hepsi TOPLAYICI)

| Dosya | Değişiklik |
|---|---|
| `src/platform/devtools/carosLabCatalog.ts` | `long-road-field-validation` aracı eklendi (union + katalog kaydı). Mevcut hiçbir kayıt değişmedi. |
| `src/components/devtools/carosLabScreenMap.tsx` | Yeni ekran için lazy kayıt + `case` satırı. |
| `src/components/layout/MainLayout.tsx` | `<FieldTestBadge />` mount + import. Bileşen oturum aktif değilken `null` döndürür. |

---

## 4 · ÜRÜN DAVRANIŞINA DOKUNULMADIĞINA DAİR KANIT

Bu, iddia değil **testle sabitlenmiş bir kilittir**
(`longRoadFieldValidation.test.ts` §1, 9 dosyanın tamamı taranır):

```
FORBIDDEN: connectOBD( · disconnectOBD( · reconnectOBD( · sendCommand(
           sendRawCommand( · writeObd( · startPolling( · stopPolling(
           setPollInterval( · startNavigation( · startRoute( · play()
           mediaService. · window.alert( · confirm( · speak( · ttsService.
           refreshKwpRecoveryEvidence( · refreshExtendedPollEvidence(
           getLiveDiscoveryCoordinator( · location.reload( · process.exit(
```

Ek yapısal kilitler:

- **Saf katmanlar** (`model` · `detect` · `blackBox` · `acceptance` · `report`)
  yorumları çıkarıldıktan sonra `Date.now(` · `Math.random(` · `setInterval(` ·
  `setTimeout(` · `localStorage` · React importu **içermez**.
- **Tek zamanlayıcı sahibi kaydedicidir** ve `clearInterval` +
  `removeEventListener` + cleanup thunk listesi zorunlu tutulur (Zero-Leak).
- **Okuma katmanında yalnız BİR `async function` vardır** (`readAsyncAugment`) ve
  test bunu sayarak kilitler — tick yolunda async okuma sızamaz.
- **LAB ekranı 1 Hz döngüye abone olmaz** (test `subscribeLongRoad` yokluğunu
  sınar) → 2026-07-27 ısınma bulgusundaki "1 Hz'de tüm ağaç render" tuzağı
  tekrarlanmaz.
- **Gösterge** `alert`/`Dialog`/`showModal` içermez ve oturum aktif değilken
  `if (!view.active) return null;` ile hiçbir şey render etmez.

**Bilinçli olarak ÇAĞRILMAYANLAR:** `refreshExtendedPollEvidence()` ve
`refreshKwpRecoveryEvidence()` async native PULL'dur (Tanı Gönder akışına aittir);
`getLiveDiscoveryCoordinator()` tekil nesneyi tembel oluşturarak üretim modül
durumunu değiştirir. Üçü de bu paketten dışlandı.

---

## 5 · VERİ BÜTÇELERİ (görev §17)

| Bütçe | Değer | Aşıldığında |
|---|---|---|
| Olay | 400 | En eski **INFO** düşer; tamamı CRITICAL ise yeni kayıt reddedilir. `droppedEvents` SAYILIR. |
| Snapshot indeksi | 64 | `SUPPRESSED_BUDGET` — yeni snapshot ÜRETİLMEZ. |
| Snapshot gövdesi (bellek) | son 8 | Dışa aktarım için; oturum kaydına gövde YAZILMAZ. |
| BlackBox penceresi | 24 (aynı anda açık 3) | `refusedWindows` SAYILIR. |
| BlackBox halkası | 200 kare (≥ 60+120 sn @1 Hz) | En eski kare düşer, `dropped` SAYILIR. |
| Pencere başına kare | 200 | `droppedRecords` SAYILIR. |
| Oturum gövdesi | 512 KB | Yazım REDDEDİLMEZ (kanıt kaybı daha kötü), `overBudget` ile budama tetiklenir. |
| Toplam depolama | 3 MB | `CRITICAL` baskı → INFO olaylar ve periyodik snapshot indekslerinin yarısı budanır. |
| Checkpoint | 30 sn'de bir | Kritik olay ve oturum başı/sonu BEKLEMEZ, anında yazılır. |
| Örnekleme | 1 Hz | `dt` ölçülür; beklenenin 10 katını aşan delta (uyku/askı) ölçüme SAYILMAZ. |

**Depolama kritik seviyeye gelirse:** sürüş sırasında **popup gösterilmez**;
CRITICAL olay kanıtları ve BlackBox pencereleri **korunur**; raporda
`STORAGE_PRESSURE` alanı belirtilir.

---

## 6 · GİZLİLİK

**Taşınmayanlar:** koordinat · TAM VIN · API anahtarı · JWT · e-posta ·
telefon · ham komut/transkript · tam rota dizisi.
**Taşınanlar:** VAR/YOK · ADET · DURUM ADI · SÜRE farkı.

Üç kapı:

1. **Yapısal** — BlackBox karesi yalnız sayısal/enum alan taşır; `latitude`
   gibi bir anahtar tipte YOKTUR (testle kilitli).
2. **Dışa aktarım** — `sanitizeForExport()` VIN'i son 6 haneye maskeler,
   metinleri kırpar.
3. **Ölçüm** — `auditPrivacy()` üretilen raporu **gerçekten tarar**. Bulgu
   bulunursa yalnız DESEN ADI bildirilir, eşleşen değer rapora GİRMEZ
   (sızıntıyı raporlarken sızdırmama kuralı — testle kilitli).

Başlangıç bölgesi (`startRegion`) alanı **boş bırakıldı**: şehir/bölge bilgisi
ters-coğrafi kodlama gerektirir, bu katman ise ağ çağrısı yapmaz. Koordinat
yazmaktansa `UNAVAILABLE` bırakıldı.

---

## 7 · KULLANICI GÜVENLİĞİ (görev §0 · §14)

Sistem sürüş sırasında: popup açmaz · kullanıcıdan işlem istemez · sesli komut
vermez · yapay arıza üretmez · OBD/GPS/Bluetooth'u bilerek bozmaz · sert manevra
istemez · ekran değiştirmez · polling'e dokunmaz · araç komutu göndermez.

Gösterge yalnız üç sayı gösterir (geçen süre · mesafe · kritik sorun) ve
**hareket hâlindeyken detay AÇILAMAZ**. Hız okunamıyorsa **hareket varsayılır**
(fail-closed) — bilinmezlikte dikkat dağıtmamak güvenlik tarafıdır. Kritik
sorunda bile dikkat dağıtıcı yüzey üretilmez.

---

## 8 · KABUL MATRİSİ VE EŞİKLERİN KAYNAĞI

17 madde; her biri `requirement` (PASS için asgari kanıt) ve `thresholdSource`
taşır. Eşikler iki sınıfa ayrılır ve **karıştırılmaz**:

- **PRODUCT_CONTRACT** — ürün kodunda zaten var olan hüküm (tazelik penceresi,
  konum durumu, trip durum makinesi, akla-yatkınlık kuralı).
- **SPEC** — bu tur için AÇIKÇA sabitlenen eşik. Raporun "Kanıt eksikleri"
  bölümünde ayrı tabloda listelenir → gizlice "ürün standardı" gibi sunulmaz.

| SPEC eşiği | Değer | Kaynak |
|---|---|---|
| `obdStabilityMs` | 60 dk | Görev §15 örneği; ürün kodunda karşılığı YOK |
| `obdFreshCoverage` | %90 | Tazelik hükmü ÜRÜNÜN, ORAN bu turun eşiği |
| `invalidSampleRatio` | %1 | Akla-yatkınlık kuralı CLAUDE.md §2, ORAN bu turun eşiği |
| `gpsLiveCoverage` | %80 | Durum hükmü ÜRÜNÜN, ORAN bu turun eşiği |
| `minRecordedMs` | 10 dk | Kısa oturum hüküm üretemez |

**Bu beş eşik ürün sahibinin onayını bekleyen açık borçtur** (§10).

Karar üretimi: tek `FAIL` → `FIELD_VALIDATION_FAILED`; asgari süre dolmadıysa
veya hiç `PASS` yoksa → `INSUFFICIENT_EVIDENCE`; her madde `PASS`/`BLOCKED` ise →
`PASS`; aksi hâlde → `PARTIAL`. **Gözlenmeyen senaryo FAIL değildir**
(`NOT_OBSERVED`); **backend yokluğu FAIL değildir** (`BLOCKED_BACKEND`).

---

## 9 · TESTLER

```
src/__tests__/longRoadFieldValidation.test.ts          92 kilit
src/__tests__/longRoadFieldValidationRuntime.test.ts   24 kilit
────────────────────────────────────────────────────────────────
npm run test → 455 dosya geçti / 9973 test (1 düşen: AŞAĞIYA BAK)
npx tsc -b   → temiz
npx eslint   → yeni dosyalarda 0 sorun
```

Kapsanan (görev §20): durum makinesi · restart restore · olay dedupe ·
snapshot cooldown/dedupe/bütçe · bounded tamponlar · rapor üretimi · gizlilik
maskeleme + tarama · depolama baskısı · bozuk/geçersiz kalıcılık · eşzamanlı
olaylar · uzun simüle saat (8 saatlik yolculuk) · **ürün-kontrol çağrısı
yokluğu** · popup/ses yan etkisi yokluğu · OBD/GPS mutasyonu yokluğu · mevcut
CAROS LAB regresyonları · katalog↔ekran bütünlüğü · TypeScript · build · lint.

### Testlerin bulduğu üç GERÇEK kusur (düzeltildi)

1. `startLongRoadSession()` bayat gövde döndürüyordu → çağıran "snapshot
   alınmadı" görüyordu.
2. Restore'da checkpoint kaybı ölçülmemişti → sınır `LR_MAX_CHECKPOINT_LOSS_MS`
   olarak açıkça tanımlandı ve testle kilitlendi.
3. Kritik olaylar checkpoint aralığını bekliyordu → **tekrarlanamaz saha
   kanıtı** kaybolabilirdi. Artık kritik olayda anında yazılıyor.

### ⚠️ Bu paketten BAĞIMSIZ düşen test

`regression.guards.test.ts › K24 CAN-flood … _hasAnyField` **5 sn zaman aşımına
uğruyor**. Bu paket olmadan da (baseline koşumuyla doğrulandı) aynı şekilde
düşüyor — **önceden var olan kırık bir kilittir** ve bu turda düzeltilmedi.
Ledger #312 olarak kaydedildi.

---

## 10 · AÇIK BORÇLAR

| # | Borç | Neden bu turda kapatılmadı |
|---|---|---|
| 1 | **Gerçek araç doğrulaması YOK** | Araç erişimi gerekiyor. Sistem bunu kendisi `BLOCKED_REAL_VEHICLE` olarak raporluyor. |
| 2 | **AI kanıt/karar akışı pasif gözlemi bağlanmadı** | Kanal bağlanmadan `NOT_OBSERVED` döner; sahte "gözlendi" üretmemek için kapsam dışı bırakıldı. |
| 3 | **Müzik ve navigasyon gözlem kanalları bağlanmadı** | Aynı gerekçe. Sistem bu ikisini KENDİ BAŞLATMAZ (görev §0), yalnız pasif gözleyebilir. |
| 4 | **Sürücü zinciri `BLOCKED_HARDWARE`** | Gerçek NFC/telefon/Bluetooth sürücü kaynağı head unit'e bağlı değil. Elle üretilmiş doğrulama gerçek kaynak gibi gösterilmedi. |
| 5 | **5 SPEC eşiği ürün sözleşmesine bağlanmadı** | §8 tablosu. Ürün sahibi onayı gerekiyor. |
| 6 | **APK SHA-256 · git revizyonu · Android sürümü/API `UNAVAILABLE`** | Bu katmandan okunamaz (native/CI alanı). Uydurulmadı. |
| 7 | **Başlangıç bölgesi `UNAVAILABLE`** | Ters-coğrafi kodlama ağ çağrısı ister; koordinat yazmak yasak. |
| 8 | **Realtime kopma/toparlanma gözlemi sınırlı** | Head unit tarafında realtime otoritesinin gözlem yüzeyi dar. |
| 9 | **Claude canlı saha bağlantısı (görev §22) uygulanmadı** | Salt-okunur checkpoint dışa aktarımı RAPOR düğmesiyle karşılanıyor; ayrı bir bağlantı protokolü P0 kapsamına alınmadı. |

---

## 11 · GERÇEK ARAÇ DURUMU

```
realVehicleValidationVerdict = BLOCKED_REAL_VEHICLE
```

Bu sistem **hiç araca takılmadı**. Kütükte (#308–#311) dört madde
🔴 "cihazda test edilmedi" olarak bekliyor. Kabul ölçütleri karşılanmadan bu
paket "çalışıyor" diye sunulamaz.
