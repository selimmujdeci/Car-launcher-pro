# OTOMATİK SAHA DOĞRULAMA — P0 BLOKLAYICI DÜZELTMELERİ D1–D3

**Tarih:** 2026-08-02 · **Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** YALNIZ D1 · D2 · D3. D4–D12 dürüstlük kusurlarına **DOKUNULMADI**
(§17 açık borç listesi).
**Kaynak denetim:** `docs/AUTONOMOUS_FIELD_VALIDATION_P0_INDEPENDENT_AUDIT.md`
(`FIELD_VALIDATION_AUDIT_BLOCKED`).
**Commit / push / deploy / production DB işlemi YAPILMADI.**

---

## 1 · YÖNETİCİ ÖZETİ

Bağımsız denetimin **ampirik olarak ölçtüğü** üç bloklayıcı kapatıldı:

| # | Bloklayıcı | Önceki ölçüm | Sonrası |
|---|---|---|---|
| **D1** | Restore sonrası olay kimlikleri çakışıyor → öz-denetim `CORRUPT` | `EV-2`,`EV-3`,`EV-4` ikinci kez yazılıyordu; `FIRST_VEHICLE_LINK` 1→2 | Çakışma **0** (3 ardışık restore dâhil); "ilk" senaryolar **1** kalıyor; öz-denetim `CORRUPT` **vermiyor** |
| **D2** | BlackBox blob'u her 30 sn'de TAMAMEN yeniden yazılıyor | 8 sa / 5 pencere ≈ **196 MB** (türetilmiş) | **1,18 MB** (ölçüldü) — %99,4 azalma. Kritik olay yoksa **0 bayt** |
| **D3** | Periyodik snapshot'lar kritik snapshot kotasını tüketiyor | 24 saatte periyodikler 64'ü doldurup `MEMORY_CRIT`/`OBD_DATA_LOSS` snapshot'ını reddedebiliyordu | İki **ayrık** kota (24 periyodik / 40 kritik); periyodik havuz dolu iken kritik snapshot **hâlâ alınıyor** (testle kilitli) |

### Kapılar

| Kapı | Değer | Tek cümlelik gerekçe |
|---|---|---|
| `eventIdentityVerdict` | **PASS** | 12 zorunlu senaryonun tamamı gerçek kalıcılık yolundan koşturuldu; kopya kimlik/sekans sayısı 0. |
| `blackBoxWriteAmplificationVerdict` | **PASS** | Kenar tetiklemeli yazım; hacim tahmin değil `readStoreWriteStats()` ile **sayıldı**. |
| `criticalSnapshotQuotaVerdict` | **PASS** | Ayrık kota + öncelikli tahliye + ayrı `droppedPeriodic`/`droppedCritical` sayaçları. |
| `selfValidationVerdict` | **PASS** | 6 yeni denetim eklendi; matristen bağımsızlık (`affectsAcceptanceVerdict:false`) korundu ve testle kilitli. |
| `passiveObserverRegressionVerdict` | **PASS** | Yeni `PRODUCT_MUTATION` YOK; çağrı grafiği + kaynak tarama testiyle kilitlendi. Mevcut 3 borç (§13) **açık kaldı**. |
| `persistenceVerdict` | **PARTIAL** | Gerçek `safeStorage` modülü kullanıldı, ancak altında jsdom `localStorage` var — Android native (`_fsCache`) yolu **hiç çalıştırılmadı**. |
| `privacyVerdict` | **PASS** | Yeni alanlar (kimlik defteri, kota sayaçları, yazım defteri) yalnız **sayı** taşır; gizlilik taraması PASS kilidi geçiyor. |
| `realVehicleValidationVerdict` | **NOT_RUN** | Gerçek araç, gerçek OBD, gerçek Android kanıtı **YOK**. |

### Nihai karar

```
FIELD_VALIDATION_BLOCKERS_D1_D3_COMPLETE_LOCAL
```

**"LOCAL" kelimesi bağlayıcıdır:** üç bloklayıcı yerelde kanıtla kapandı; bu
**saha doğrulaması DEĞİLDİR**. Bir sonraki adım kod yazmak değil, **bağımsız
denetimi yeniden koşturmaktır**.

---

## 2 · PREFLIGHT VE DIRTY WORKTREE KORUMASI

Önceki turda `git checkout --` ile üç commit edilmemiş dosya silinmişti. Bu turda:

| Kural | Uygulama |
|---|---|
| `git checkout --` · `git restore` · `git reset --hard` · `stash pop` · `clean` · branch checkout | **HİÇBİRİ ÇALIŞTIRILMADI.** |
| Baseline ölçümü | Yalnız salt-okunur: `git status --porcelain` (satır sayısı), `git rev-parse`, `git stash list`. |
| Başlangıç durumu | Dal `feat/fleet-offline-final-local-completion`, **538 kirli yol**, 4 stash girdisi — hiçbirine dokunulmadı. |
| Geçici dosya | Ölçüm probu `src/__tests__/_tmpWriteBudgetProbe.test.ts` olarak oluşturuldu ve koşum sonrası **silindi** (yalnız kendi ürettiğim dosya). |
| Paralel değişiklik | Tespit edilmedi. Sahiplenme/üzerine yazma yapılmadı. |

### 2.1 ⚠️ BU TURDA KAYBEDİLEN KANIT (bildirim — gizlenmedi)

**Kurtarma denetiminin taban artefaktı yok oldu.**

| Alan | Değer |
|---|---|
| Kaybolan | `dist/assets/CarosLabShell-AQyy2DFS.js` (2026-08-01 23:55 derlemesi) |
| Ne zaman | 2026-08-02 **10:32** |
| Nasıl | Telefona kurulum için koşulan `npm run apk:safe` → `npm run build` adımı `dist/`i yeniden üretti; chunk hash'i `CarosLabShell-B6HgwQJj.js` oldu |
| Geri getirilebilir mi | **HAYIR** — `dist` `.gitignore` kapsamında (`.gitignore:16`), git'te izlenmiyor (`git ls-files dist` → 0 satır) |
| Ne zaman oldu | **D1–D3 çalışmasından ÖNCE**; bu turun kod değişiklikleriyle ilgisi yok |

`src/__tests__/_auditCatalogRecovery.test.ts` bu tabana **sabitlenmişti** ve iki
kilidi düştü. Yapılanlar:

- **Yeni bundle'a YÖNLENDİRİLMEDİ.** Yeni `dist/` kurtarılmış kaynaktan
  derlenmiştir; kataloğu kendi derlemesiyle karşılaştırmak **döngüseldir**,
  her zaman geçer ve hiçbir şey kanıtlamaz. Yeşil bir "kurtarma doğrulandı"
  satırı üretmek kanıtsız PASS olurdu.
- **Sessizce silinmedi.** Dosya, tabanın **yok olduğunu açıkça KAYDEDEN** bir
  kilide dönüştürüldü (`existsSync(BASELINE_DIST) === false`) — biri bu dosyaya
  bakıp "kurtarma doğrulandı" sanamaz. Taban bir gün geri gelirse kilit düşer.
- **Hâlâ geçerli olan kaynak-tabanlı kilitler KORUNDU:**
  `RuntimeSchedulingScreen` odak prop'ları · ölü case yok · uzun yol aracının
  katalog+screenMap varlığı · katalog kimlik benzersizliği.

Geçmiş denetimin **sonucu** (`44/44 alan birebir`, `screenMap 35/35`,
`VERIFIED_WITH_RESIDUAL_RISK`) `AUTONOMOUS_FIELD_VALIDATION_P0_INDEPENDENT_AUDIT.md`
§13'te kayıtlıdır ve geçerliliğini korur — ancak **artık yeniden üretilemez**.
`recoveredFilesVerdict` bu nedenle **`VERIFIED_HISTORICAL_NOT_REPRODUCIBLE`**
olarak işaretlenmelidir.

---

## 3 · D1 — KÖK NEDEN

`longRoadRecorder._nextId()` düz bir process-ömürlü sayaç kullanıyordu:

```ts
function _nextId(prefix: string): string {
  _state.seq += 1;              // ← yeni process'te 0'dan başlar
  return `${prefix}-${_state.seq}`;
}
```

`initLongRoadRecorder()` restore'da `_state.seq`'i **hiç tohumlamıyordu**.
Sonuç zinciri:

1. Process death → modül durumu uçar, `seq = 0`.
2. Disk oturumu geri yüklenir; defterde zaten `EV-1 … EV-n` vardır.
3. İlk yeni olay `EV-1` olarak yazılır → **kimlik çakışması**.
4. `longRoadSelfValidator._checkDuplicateEvents` bunu `DUPLICATE_EVENTS = CORRUPT`
   yapar → **genel öz-denetim hükmü CORRUPT** → yolun asıl kanıtı çöper.

İkinci kusur aynı kökten gelir: `_state.detect = emptyDetectState()` restore'da
`firstLinkSeen` / `firstHandshakeSeen` bayraklarını sıfırlıyordu → "İLK araç
bağlantısı" her açılışta yeniden sayılıyordu (denetim ölçümü: 1 → 2).

---

## 4 · D1 — YENİ DAVRANIŞ

### 4.1 İki bağımsız güvence

**Kimlik şeması değişti:** `EV-<seq>` → **`EV-v<sessionVersion>-<seq>`**
(`longRoadModel.formatRecordId`). Eski düz biçim **okunmaya devam eder**
(`parseRecordId` her ikisini çözer), üretimde artık yazılmaz.

| Güvence | Nasıl | Ne zaman kurtarır |
|---|---|---|
| **1 · Sekans tohumlaması** | `scanRecordIdentity(collectRecordIds(...))` defterdeki **tüm** kimlikleri gezer, en büyük sekansı bulur; sayaç ondan **büyük** başlar | Normal restore |
| **2 · Yüksek-su işareti** | `session.identity.idHighWater` her yazımda diske işlenir; tohumlama `max(taranan, highWater)` alır | Olay defteri **tamamen budanmışsa** |
| **3 · Sürüm öneki** | `sessionVersion` her restore'da monoton artar ve asla tekrarlamaz | Yukarıdaki ikisi de kaybolsa bile — çakışma **yapısal olarak imkânsız** |

Tohumlama `resumeSession()`'dan **önce** yapılır: aksi hâlde restore'un kendi
yazdığı `RESTORE-*` olayı taramaya dâhil olurdu.

### 4.2 Fail-closed bütünlük

`scanRecordIdentity` beş hüküm üretir:

| Hüküm | Koşul | Kaydedicinin tepkisi |
|---|---|---|
| `OK` | temiz | — |
| `DEGRADED_UNPARSABLE` | çözülemeyen kimlik var | Kimlik **yok sayılır** ama `IDENTITY_INTEGRITY` **WARN** olayı yazılır |
| `FAIL_DUPLICATE_SEQUENCE` | aynı sekans iki farklı kimlikte | `IDENTITY_INTEGRITY` **CRITICAL** olayı — sessiz devam YOK |
| `FAIL_DUPLICATE_ID` | aynı kimlik iki kez | Aynı şekilde CRITICAL |
| `NOT_SCANNED` | henüz restore yaşanmadı | — |

**Sekans boşluğu hata sayılmaz.** `EV` ve `SNAP` aynı sayacı paylaştığı için
boşluk normaldir; `identity.sequenceGaps` yalnız **görünür tanı bilgisidir**
ve hiçbir hükmü düşürmez. (Testle kilitli: `'EV-v1-1','EV-v1-9'` → `OK`, gap=7.)

### 4.3 "İLK" senaryoların tekilliği

`longRoadDetect.seedDetectState()` (SAF) eklendi. Kaynak olarak **olay defteri
değil senaryo defteri** kullanılır — senaryo kayıtları bütçe budamasında
silinmez, dolayısıyla budanmış oturumda bile "bu daha önce oldu mu" sorusu
güvenle cevaplanır.

### 4.4 Eski olayların replay edilmemesi

Restore hiçbir olayı yeniden üretmez; `resumeSession` yalnız tek bir `RESTORE`
olayı ekler. Kilit: *"KRİTİK olaydan sonra restore: eski olaylar YENİDEN
YAZILMAZ"* — `OBD_DATA_LOST` sayısı restore öncesi ve sonrası **1** kalıyor.

---

## 5 · D1 — DOĞRULAMA

Tümü **gerçek üretim kalıcılık yolundan** (`longRoadStore` → `safeStorage` →
`localStorage`) koştu. Depolama katmanı mock'lanmadı.

| # | Zorunlu senaryo | Sonuç | Kilit |
|---|---|---|---|
| 1 | Tek process death | Çakışma 0, `sessionId` aynı, sürüm 1→2 | ✅ |
| 2 | Art arda 3 restore | Sürüm 4, `restoreCount` 3, çakışma 0, `seedCount` 3 | ✅ |
| 3 | Bozuk `eventId` | Yok sayıldı + `DEGRADED_UNPARSABLE` + WARN olayı | ✅ |
| 4 | Duplicate sequence | `FAIL_DUPLICATE_SEQUENCE` + CRITICAL olayı | ✅ |
| 5 | Sequence gap | Hüküm `OK` kaldı, boşluk sayıldı | ✅ |
| 6 | Budanmış defter | Yüksek-su işaretinden tohumlandı, çakışma 0 | ✅ |
| 7 | Kritik event sonrası restore | Replay yok (`OBD_DATA_LOST` = 1) | ✅ |
| 8 | İlk bağlantı sonrası restore | `FIRST_VEHICLE_LINK` hits = **1** | ✅ |
| 9 | İlk handshake sonrası restore | `FIRST_HANDSHAKE_OK` hits = **1** | ✅ |
| 10 | Collision sayısı 0 | Tüm senaryolarda 0 | ✅ |
| 11 | `sessionId` aynı | ✅ | ✅ |
| 12 | `sessionVersion` artıyor | 1→2→3→4 | ✅ |

**Öz-denetleyici yeni düzeni ham defterden doğruluyor:** restore sonrası
`EVENT_ID_INTEGRITY`, `SEQUENCE_MONOTONICITY`, `FIRST_EVENT_UNIQUENESS`,
`DUPLICATE_EVENTS`, `RESTART_COUNTER_JUMP` = **VERIFIED**; genel hüküm artık
`CORRUPT` değil.

---

## 6 · D2 — KÖK NEDEN

```ts
const windows = [..._state.blackBox.closed, ..._state.blackBox.open];
if (immediate || windows.length > 0) saveBlackBox(s.sessionId, windows);
```

`_persist()` **her checkpoint'te** (30 sn) çağrılıyordu ve **bir tane bile
pencere varsa** blob'un TAMAMI yeniden yazılıyordu. Yani ilk kritik olaydan
sonra, yolculuğun geri kalanı boyunca 30 saniyede bir tam blob eMMC'ye
gidiyordu — pencere içeriği değişmese bile.

**Yazma sıklığı CLAUDE.md §3'e uygundu (30 sn > 5–10 sn); ihlal edilen şey
HACİMDİ.**

---

## 7 · ESKİ / YENİ eMMC YAZMA BÜTÇESİ

### 7.1 Ölçüm yöntemi

`longRoadStore` içine kendi yazım defteri eklendi: `readStoreWriteStats()`
(`sessionWrites`/`sessionBytes`/`blackBoxWrites`/`blackBoxBytes`). Bu defter
**ürünün `_emmcWriteCount` metriğini okumaz ve onun yerine geçmez**; yalnız
gözlemcinin kendi bütçesini sayar. Aşağıdaki "YENİ" sütunu bu sayaçtan gelen
**gerçek ölçümdür**, tahmin değildir.

Ölçülen taban: **tek pencere blob'u = 41 966 bayt** (~41 KB), oturum gövdesi
olay sayısına göre 6,5 KB – 51 KB arasında.

### 7.2 Karşılaştırma

| Senaryo | ESKİ BlackBox yazımı | YENİ BlackBox yazımı | Azalma |
|---|---|---|---|
| 8 sa · kritik olay YOK | ~0 (pencere yok) | **0 yazım / 0 bayt** (ölçüldü) | — |
| 8 sa · 1 kritik pencere | ~959 yazım × 41 KB ≈ **39,3 MB** (türetilmiş) | **2 yazım / 67 477 bayt** (ölçüldü) | **%99,8** |
| 8 sa · 5 kritik pencere | ~933 yazım × 210 KB ≈ **196 MB** (türetilmiş; denetimin ~192 MB'ı ile uyumlu) | **10 yazım / 1 178 247 bayt** (ölçüldü) | **%99,4** |
| 24 sa · 5 kritik pencere | ≈ **588 MB** (türetilmiş) | **10 yazım / 1 178 247 bayt** (ölçüldü) | **%99,8** |
| 8 sa · olay fırtınası (500 tazelik salınımı) | ≥196 MB | **18 yazım / 3 634 946 bayt** (ölçüldü) | **%98** |
| 24 pencere tavanı · 8 sa | ~960 × 1,0 MB ≈ **960 MB** (denetim: ~923 MB) | 49 yazım × ort. ~0,5 MB ≈ **24 MB** (türetilmiş) | **%97,5** |

> "Türetilmiş" satırlar eski kodun çağrı sayısı × ölçülen blob boyutundan
> hesaplanmıştır. Eski kod çalıştırılmadığı için **ölçüm değildir** ve öyle
> sunulmaz.

### 7.3 Storage pressure altında

`applyStoragePressure` **yalnız PERIODIC sınıfı** snapshot indeksini budar;
kritik sınıf hiçbir baskı seviyesinde budanmaz (testle kilitli). Budama
periyodik kotayı da serbest bırakır — aksi hâlde disk boşalır ama kota dolu
kalırdı.

### 7.4 ⚠️ ÖLÇÜMÜN ORTAYA ÇIKARDIĞI YENİ AÇIK BORÇ

BlackBox çözüldükten sonra **toplam eMMC hacmini artık oturum gövdesi
belirliyor** (30 sn'de bir tam gövde yazımı — D2 kapsamı DIŞINDA):

| Senaryo | Oturum gövdesi yazımı (ölçüldü) |
|---|---|
| 8 sa · kritik olay yok | 960 yazım / **6,78 MB** |
| 8 sa · 5 pencere | 967 yazım / **8,33 MB** |
| 24 sa · 5 pencere | 2 887 yazım / **27,8 MB** |
| 8 sa · olay fırtınası (400 olay dolu defter) | 1 341 yazım / **84,4 MB** ❗ |

Gerçekçi Kuga senaryosunda (8–24 sa, birkaç kritik olay) toplam **9–29 MB**
— kabul edilebilir. Ancak **olay defteri dolduğunda (400 olay) 8 saatte
84 MB**'a çıkıyor. Bu **yeni bir bulgudur**, D1–D3 kapsamında değildir ve
§17'ye **D13** olarak yazılmıştır.

### 7.5 ⚠️ Ölçümün sınırı (dürüstlük kaydı)

`readStoreWriteStats()` **çağrı anındaki niyeti** sayar. Altındaki
`safeStorage._commitToStorage`, 50 KB üzeri gövdeler için diske gitmeden önce
bir **idle yield** uygular. Sahte saatli testte bu callback tetiklenmediği için
`localStorage`'daki gövde ölçüm anında bayat kalabilir. Yani sayılan şey
"eMMC'ye gönderilen bayt", "eMMC'ye **inen** bayt" değildir. Gerçek Android'de
`requestIdleCallback` hızla tetiklenir; **bu ayrım ancak gerçek cihazda
kapanır.**

---

## 8 · D2 — PROCESS-DEATH DAVRANIŞI

### 8.1 Yeni yazım kuralı — kenar tetiklemeli

`_state.blackBoxRev` yalnız şu **kenarlarda** artar:

| Kenar | Neden yazılır |
|---|---|
| **Pencere açılışı** | Olay öncesi 60 sn'lik `pre` kareler o anda **dondurulur** ve bir daha üretilemez |
| **Pencere kapanışı** | `post` tamamlandı → final bounded kayıt |
| **Finalizasyon** | Oturum durdurulurken açık pencereler kapatılır |
| **Kontrollü güvenlik noktası** | `visibilitychange` → arka plan (Android'in süreci öldürmeye en yakın olduğu an) |

Pencere **AÇIKKEN** biriken post-kareler diske akmaz. `_persistBlackBoxIfDirty()`
yalnız `blackBoxRev !== blackBoxPersistedRev` ise yazar; yazım başarısızsa
revizyon ilerletilmez → bir sonraki kenarda **yeniden dener** (sessizce
"yazıldı" sayılmaz).

### 8.2 Ölüm anlarının dürüst raporlanması

| Ölüm anı | Geri yüklenen durum | Kilit |
|---|---|---|
| **PRE-window sırasında** | Pencere açılışta yazıldığı için `preFrames` **korunur**; `postWindowComplete=false` | ✅ |
| **POST-window sırasında** | `postWindowComplete=false` — eksik pencere **TAM gibi sunulmaz** | ✅ |
| **Finalizasyon sırasında** | Kapatılmış pencere diskten okunur, `postWindowComplete=true`, `checksumOk=true` | ✅ |

### 8.3 Format, checksum, yarım yazım

| Kontrol | Davranış |
|---|---|
| Zarf sürümü | `schemaVersion: 2` + `frameCount` + `checksum` |
| Checksum | FNV-1a 32-bit (`blackBoxChecksum`) — kriptografik değil, **öyle de sunulmuyor**; amacı yarım/bozuk yazımı yakalamak |
| Checksum tutmuyor | `CORRUPT` / `CHECKSUM_MISMATCH` → **`windows: []`** (kısmi veri KULLANILMAZ) |
| Kesilmiş JSON | `CORRUPT` / `PARSE` — sessizce boş liste DEĞİL |
| Legacy v1 | `LEGACY_MIGRATED`, `checksumOk: null` → **"doğrulandı" DENMEZ** |
| Gelecek sürüm | `UNSUPPORTED_FORMAT`, pencereler reddedilir |
| Şekli bozuk pencere | Atılır ve `rejectedWindows` ile **sayılır** |

---

## 9 · D2 — DOĞRULAMA

| Zorunlu | Sonuç |
|---|---|
| Write-byte instrumentation | `readStoreWriteStats()` — 6 senaryoda ölçüldü (§7.2) |
| 8 / 12 / 24 saat simülasyonu | Kritik olay yoksa BlackBox yazımı **0** (üçünde de) |
| Process death | 3 senaryo (pre / post / finalize) kilitli |
| Checksum | Yazımda üretiliyor, okumada sınanıyor |
| Partial write | `CHECKSUM_MISMATCH` ve `PARSE` fail-closed |
| Event storm | 40 salınım → ≤4 yazım; 500 salınım → 18 yazım |
| Storage pressure | Kritik snapshot korunuyor |

---

## 10 · D3 — KOTA MODELİ

### 10.1 Ayrık kotalar

```
LR_MAX_SNAPSHOTS            = 64   (genel tavan — DEĞİŞMEDİ)
LR_SNAPSHOT_PERIODIC_QUOTA  = 24
LR_SNAPSHOT_CRITICAL_QUOTA  = 40   (= 64 − 24, rezerve)
```

`PERIODIC` sınıfı **yalnız** `PERIODIC_TIME` ve `PERIODIC_DISTANCE` içerir;
diğer her tetik kanıt-kritiktir (tekrarlanamaz saha anı) ve rezerve kotayı
kullanır. Havuzlar **ayrıktır**: periyodik havuz dolduğunda kritik havuza
taşmaz, kritik havuza dokunamaz.

### 10.2 Öncelik ve kontrollü tahliye

| Öncelik | Tetikler | Gerekçe |
|---|---|---|
| 5 | `MEMORY_CRIT` · `THERMAL_CRIT` · `OBD_DATA_LOSS` · `CRASH_RECOVERY` | Bir daha yakalanamaz |
| 4 | `SESSION_START` · `SESSION_END` · `PROCESS_RESTORE` | Oturum sınırları |
| 3 | `RECONNECT_FAILED` · `FIRST_HANDSHAKE` | Tekrarlanabilir ama seyrek |
| 2 | `GPS_LOSS` · `REALTIME_RESYNC` | Yolda tekrarlanır |
| 1 | `INTERNET_RESTORED` · `TRIP_CLOSE` | Defalarca tekrarlanır |

Kritik kota dolduğunda `chooseCriticalEvictionVictim()` **en düşük öncelikli,
eşitlikte en eski** kaydı seçer. Gelen kayıt saklananların hepsinden **zayıf
veya eşitse tahliye YAPILMAZ** → `SUPPRESSED_CRITICAL_BUDGET`, sayaç artar.

### 10.3 Duplicate ve fırtına koruması

Mevcut tetik-başına cooldown (`OBD_DATA_LOSS` 120 sn, `MEMORY_CRIT`/`THERMAL_CRIT`
300 sn) + global 15 sn aralık korunmuştur; aynı olay fırtınasında ikinci kritik
snapshot üretilmez (mevcut kilitler geçiyor).

### 10.4 Ayrı sayaçlar

`DroppedLedger` iki yeni alan aldı:

| Sayaç | Anlamı |
|---|---|
| `droppedPeriodicSnapshots` | Bütçe davranışı — hükmü düşürmez |
| `droppedCriticalSnapshots` | **Kanıt kaybı** — `OBSERVER_INTEGRITY`'yi `DEGRADED` yapar ve raporda kalın yazılır |

Cooldown/global-gap bastırmaları **kayıp sayılmaz** (`classifySnapshotDrop`
`null` döner) — politika kararıdır.

---

## 11 · D3 — REFERANS BÜTÜNLÜĞÜ

| Kural | Uygulama |
|---|---|
| Tahliye edilen snapshot indeksten düşer | `retained.filter(id !== victim.id)` |
| **Gövdesi de düşer** | `_state.bodies = _state.bodies.filter(b => b.id !== victim.id)` — sarkan referans yasağı |
| Restore sonrası kota korunur | `_migrateSnapshotPolicy` sınıf sayaçlarını saklanan indeksten **yeniden türetir** ve `max(kayıtlı, türetilen)` alır (kota sahte biçimde boşaltılamaz) |
| Denetim | `SNAPSHOT_REFERENCE` — bellekteki her gövdenin indekste karşılığı olmalı |

---

## 12 · ÖZ-DENETLEYİCİ

Altı yeni denetim eklendi (8 → **14**). Otorite ayrımı **korundu**:
`affectsAcceptanceVerdict: false` hâlâ yapısal olarak `false` ve testle kilitli;
`buildLongRoadReport` içinde `finalVerdict` **önce** hesaplanır, öz-denetim
sonucuna hiç bakmaz.

| Denetim | Ne ölçüyor | Sonuç kümesi |
|---|---|---|
| `EVENT_ID_INTEGRITY` | Ham kimlik listesinden **baştan** tarama; kaydedicinin defteriyle karşılaştırma | `VERIFIED` · `MISMATCH` · `CORRUPT` · `INSUFFICIENT_RAW_EVIDENCE` · `NOT_CHECKED` |
| `SEQUENCE_MONOTONICITY` | Sekans artıyor mu, sürüm geriliyor mu, boşluk kaç | aynı |
| `FIRST_EVENT_UNIQUENESS` | "İlk" senaryolar birden çok kez sayılmış mı | aynı |
| `BLACKBOX_INTEGRITY` | Checksum hükmü + `preWindowComplete` iddiaları | aynı |
| `SNAPSHOT_REFERENCE` | Sarkan gövde / öksüz pencere / kopya indeks | aynı |
| `SNAPSHOT_QUOTA` | Sınıf sayaçları indeksten yeniden üretilebiliyor mu; kritik kayıp var mı | aynı |

Checksum hükmü öz-denetleyicide **hesaplanmaz** (gövde orada yok);
kaydediciden gelen ölçüm SONUCU denetlenir. Ölçüm verilmezse `NOT_CHECKED`
kalır — sessizce "doğrulandı" sayılmaz.

**Matris PASS + öz-denetim MISMATCH durumunda** rapor §16'daki açık güven
uyarısı korunmuştur:
> ⚠️ Öz-denetim ham kayıtla hüküm arasında tutarsızlık buldu. Kabul matrisi
> sonucu bu oturum için **güvenilir sayılmamalıdır**.

---

## 13 · PASİF GÖZLEMCİ REGRESYONU

### 13.1 Eklenmeyenler

D1–D3 boyunca **hiçbiri** eklenmedi: OBD komutu · bağlantı başlatma/kesme ·
polling değişimi · GPS kontrolü · navigation/media kontrolü · Evidence/Reasoning
ürünü yazımı · kullanıcı popup/toast/TTS · ekran yönlendirmesi · ağ çağrısı.

### 13.2 Çağrı grafiği doğrulaması

Yeni test `pasif gözlemci regresyonu` bloğu **kaynak metnini tarar** ve dokuz
yasak deseni `longRoadRecorder.ts` · `longRoadStore.ts` · `longRoadModel.ts`
üzerinde sıfır eşleşmeyle kilitler. Ayrıca:

- **Import grafiği kilitlendi:** kaydedicinin dış bağımlılıkları tam olarak 7
  modüldür ve D1–D3'te **yeni bağımlılık eklenmedi**.
- **Ad alanı kilitlendi:** tüm depolama anahtarları `caros.lab.*`.
- **Oturum yokken yazım yok:** `initLongRoadRecorder` + `checkpointLongRoad`
  → `sessionWrites = 0`, `blackBoxWrites = 0`.

### 13.3 Yeni yazımların sınıflandırması

| Yeni çağrı | Sınıf |
|---|---|
| `readStoreWriteStats()` / `_resetStoreWriteStatsForTest()` | `TEST_INTERNAL_STATE` — modülün kendi sayacı, ürün metriği okumaz |
| `visibilitychange` → `_persist()` | `TEST_INTERNAL_STATE` — yalnız `caros.lab.*` anahtarlarına yazar |
| `loadBlackBoxOutcome()` | `SAFE_OBSERVABILITY` — salt okuma |

### 13.4 Düzeltilmeyen üç pasiflik borcu (bilinçli — kapsam dışı)

| Borç | Durum |
|---|---|
| `connectivityService.queueSize()` IndexedDB store oluşturuyor | **AÇIK** (D12) |
| `isAiGatewayEnabled()` cache'i erken donduruyor | **AÇIK** (denetim P3 #15) |
| `safeSetRaw` ürünün `_emmcWriteCount` metriğini kirletiyor | **AÇIK** (denetim P3 #16) — bu turda yazım sayısı **azaldığı** için kirlenme de azaldı, ama **kalktı denemez** |

---

## 14 · TEST SONUÇLARI

| Kasa | Sonuç |
|---|---|
| `longRoadBlockerFixesD1D3.test.ts` (**yeni**) | **51 / 51 geçti** |
| `longRoadFieldValidation.test.ts` | geçti |
| `longRoadFieldValidationRuntime.test.ts` | geçti |
| `longRoadSelfValidation.test.ts` | geçti |
| `longRoadPreRoadGate.test.ts` | geçti (2 kilit **güncellendi**, silinmedi) |
| Uzun yol kasaları toplamı | **230 / 230** |
| `npm run guard` (regresyon kasası) | **163 / 163** |
| `npx tsc -b` | **temiz** |
| `npx eslint` (değişen dosyalar) | **temiz** |
| `npm run test` (tüm suite) | *§14.1* |

### 14.1 Güncellenen kilitler (kaldırılmadı — YENİ doğru davranışa taşındı)

| Kilit | Eski | Yeni | Gerekçe |
|---|---|---|---|
| `longRoadPreRoadGate.test.ts:279` | `rows.length === 8` | `=== 14` | Öz-denetime 6 denetim eklendi |
| `longRoadPreRoadGate.test.ts:350` | 8 satırlık öz-denetim tablosu | 14 satır, `verifiedCount 6 → 10` | Aynı |

### 14.2 Kanıt seviyeleri

| İddia | Seviye |
|---|---|
| Kimlik modeli · kota modeli · tahliye seçimi · checksum | **UNIT_SIMULATION** |
| Restore · yazma bütçesi · process death · format göçü | **INTEGRATION + REAL_STORAGE_MODULE** (gerçek `safeStorage`, jsdom `localStorage`) |
| eMMC hacmi | **MEASURED** (yeni) — eski hacim **DERIVED** |
| Android native kalıcılık yolu (`_fsCache`) | **YOK** |
| Gerçek araç / OBD / GPS | **YOK** |

---

## 15 · DEĞİŞEN DOSYALAR

| Dosya | Değişiklik |
|---|---|
| `src/platform/fieldValidation/longRoadModel.ts` | Kimlik şeması + tarama + `IdentityLedger`; snapshot sınıf/öncelik/kota; `DroppedLedger` 2 yeni alan; `migrateSession` sanitizasyonu; `applyStoragePressure` sınıf-duyarlı budama |
| `src/platform/fieldValidation/longRoadDetect.ts` | `seedDetectState()` (SAF) |
| `src/platform/fieldValidation/longRoadStore.ts` | v2 zarf + checksum + `loadBlackBoxOutcome` + yazım defteri |
| `src/platform/fieldValidation/longRoadRecorder.ts` | Sekans tohumlama · detect tohumlama · `IDENTITY_INTEGRITY` olayı · kenar tetiklemeli BlackBox yazımı · snapshot tahliyesi · görünürlük güvenlik noktası |
| `src/platform/fieldValidation/longRoadSelfValidator.ts` | 6 yeni denetim + `SelfValidationEvidence` |
| `src/platform/fieldValidation/longRoadReport.ts` | `selfEvidence`/`writeStats` girdisi; §14.1–14.3 markdown bölümleri; JSON'a `identity`/`snapshotPolicy`/`writeStats`/`blackBoxLoad` |
| `src/platform/fieldValidation/longRoadAcceptance.ts` | `OBSERVER_INTEGRITY` kritik snapshot kaybını görüyor + kanıt satırları |
| `src/components/devtools/screens/LongRoadFieldValidationScreen.tsx` | 3 yeni **salt-okunur** gözlem bölümü; per-getter try/catch |
| `src/__tests__/longRoadBlockerFixesD1D3.test.ts` | **YENİ** — 51 kilit |
| `src/__tests__/longRoadPreRoadGate.test.ts` | 2 kilit güncellendi |
| `docs/AUTONOMOUS_FIELD_VALIDATION_P0_BLOCKER_FIXES_D1_D3_REPORT.md` | **YENİ** — bu belge |

---

## 16 · DOKUNULMAYAN ALANLAR

`longRoadSources.ts` · `longRoadBlackBox.ts` (saf halka/pencere mantığı) ·
`FieldTestBadge.tsx` · `carosLabCatalog` · `carosLabScreenMap` ·
`MainLayout.tsx` · kabul matrisinin **madde formülleri** (yalnız
`OBSERVER_INTEGRITY` kanıt/kapsam genişletildi) · eşik sabitleri
(`LR_THRESHOLDS`) · gizlilik süzgeci · preflight · ürün servislerinin
**hiçbiri**.

---

## 17 · D4–D12 AÇIK BORÇLARI (BU TURDA DÜZELTİLMEDİ)

| # | Borç | Durum |
|---|---|---|
| D4 | `failedReconnectCount` hiç artırılmıyor ama FAIL koşulu | **AÇIK** |
| D5 | `gpsLiveCoverage` ilan edilip hesaplanmıyor | **AÇIK** |
| D6 | `obdStabilityMs` "bağlı süre" diyor, ölçüm süresini ölçüyor | **AÇIK** |
| D7 | `REALTIME_DROP_RECOVER` · `IGNITION_OR_APP_SHUTDOWN` · `RESTART` üretilemiyor | **AÇIK** |
| D8 | `firstLinkSeen`/`firstHandshakeSeen` kalıcılığı | **KISMEN KAPANDI** — senaryo defterinden türetiliyor (D1); ayrı kalıcı alan hâlâ yok |
| D9 | `droppedSamples` · `droppedBlackBoxRecords` · `refusedWindows` yazılmıyor/görünmüyor | **AÇIK** (yeni iki snapshot sayacı eklendi, bu üçü değil) |
| D10 | Snapshot cooldown'ı duvar saatiyle | **AÇIK** |
| D11 | LAB ekranında sürüş kapısı yok | **AÇIK** |
| D12 | `queueSize()` IndexedDB store oluşturuyor | **AÇIK** |
| **D13** | **YENİ:** oturum gövdesi 30 sn'de bir tam yazılıyor → dolu defterde 8 sa'te **84 MB** (§7.4) | **AÇIK — ölçüldü** |
| **D14** | **YENİ:** `readStoreWriteStats()` "gönderilen" baytı sayar, "inen"i değil (`safeStorage` idle yield — §7.5) | **AÇIK** |

Ayrıca sonraki tura bırakılan: `blackBoxIds` ölü alanı · disk↔bellek
karşılaştırması · `dropped>0` iken tekil maddelerin PASS'i · tick başına trip
geçmişi kopyası · 5 eşiğin `NEEDS_SPEC` durumu.

---

## 18 · GERÇEK ARAÇ DURUMU

```
realVehicleValidationVerdict = NOT_RUN
```

Gerçek araç **bağlı değildi**. Bu turda:

- gerçek OBD kanıtı **YOK**,
- gerçek GPS kanıtı **YOK**,
- gerçek Android kalıcılık yolu (`_fsCache`/Filesystem) **hiç çalıştırılmadı**,
- gerçek eMMC yazma ölçümü **YOK** (§7.5).

`docs/DEVICE_VALIDATION_LEDGER.md` bu turun maddeleri için **🔴 cihazda test
edilmedi** olarak güncellenmelidir; bu rapordaki hiçbir PASS **saha
doğrulaması yerine geçmez**.

---

## 19 · NİHAİ KARAR

```
FIELD_VALIDATION_BLOCKERS_D1_D3_COMPLETE_LOCAL
```

Üç bloklayıcının **üçü de kanıtla** kapandı:

- **D1** — 12 zorunlu senaryo, gerçek kalıcılık yolu, çakışma 0, öz-denetim
  artık `CORRUPT` vermiyor.
- **D2** — kenar tetiklemeli yazım; hacim **sayıldı**, %98–99,8 azaldı;
  process-death'in üç anı dürüstçe raporlanıyor; format sürümlü + checksum'lı,
  yarım yazım fail-closed reddediliyor.
- **D3** — ayrık kotalar, öncelikli tahliye, ayrı düşürme sayaçları, sarkan
  referans yok, restore'da kota korunuyor.

**BU BİR SAHA DOĞRULAMASI DEĞİLDİR.** Sıradaki adım:

1. **Kod yazmayı durdur.**
2. Bağımsız denetimi **yeniden çalıştır**.
3. Denetim geçmeden: uzun yol saha testi "çalışıyor" **ilan edilmez**, "Kuga
   uzun yol testine hazır" **denmez**, D4–D12'ye **geçilmez**.
