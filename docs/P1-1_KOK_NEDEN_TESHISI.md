# P1-1 — Extended PID değer dolumu: kök neden teşhisi

**Tarih:** 2026-08-09
**Kapsam:** `obdDeep.extended.samples: []` — keşif çalışıyor (`discovered: true`,
`supportedCount: 15`) ama değer akmıyor.
**İlgili:** `docs/ADR_PID_PACK.md` §8.2/4 · kütük #518 · devir belgesi §4
**Not:** Bu belge **teşhistir**. Kod yazılmadı, commit atılmadı.

---

## Başlık bulgu

**P1-1 "bozuk boru" değil, ÖLÇÜLMEMİŞ boru.**

Elimizdeki tek `samples: []` ölçümü **2026-07-15** tarihli. Onu üreten boşluğu kapatan
kod **2026-07-17**'de girdi (`f1e0e7f`, madde 4 — `_watchAllSupportedPids`). O tarihten
sonra **hiç kimse yeniden ölçmedi** — ve düzeltmenin kendi commit mesajı bunu zaten
söylüyor:

> `f1e0e7f`: *"🔴 Gerçek araç doğrulaması BEKLİYOR (Doblo/Trafic) — saha kanıtı yok."*

2026-08-08 devir belgesi P1-1'i açık listeliyor ama dayandığı kanıt **düzeltmeden iki
gün önceye** ait; aynı satır zaten *"H1/H2/H3 hükmü gerçek araçta ölçülmedi"* diyor.
Taşınan şey ölçüm değil, **bayat ölçüm**.

---

## 1. Zincir — dosya dosya

### A. Keşif (keşfedilen PID nereye yazılıyor)

| # | Yer | Ne olur |
|---|---|---|
| 1 | `obdService.ts:2153` | `CarLauncher.performHandshake()` — bitmap blokları (00/20/40…) okunur |
| 2 | `obdService.ts:2156` | `buildHandshakeResult` → `result.supportedPids: Set<number>` · `result.readBlocks` |
| 3 | `obdService.ts:2202-2203` | `readBlocks.size > 0` ise → `seedExtendedSupported(result.supportedPids)` |
| 4 | `extendedPidService.ts:291` | `seedSupportedPids` → `_supported` Set'i doldurur (2 hane büyük-harf hex) |
| 5 | `diagnosticSections.ts:175-176` | `discovered = _supported !== null` · `supportedCount = _supported.size` → **rapordaki "15"** |

> ⚠️ **Kritik:** adım 3-4 izleyici olup olmadığından **tamamen bağımsızdır**.
> `discovered:true / 15` yalnız handshake'in kanıtıdır; hiçbir sorgunun gittiğini
> göstermez. Rapordaki yanıltıcı çift (`15` + `[]`) buradan doğar.

### B. Kim okuyor / kim yoklama listesine ekliyor

| # | Yer | Ne olur |
|---|---|---|
| 6 | `obdService.ts:2206` | `_watchAllSupportedPids(result.supportedPids)` — **arka plan tüketicisi** |
| 7 | `obdService.ts:452-463` | core PID'ler (`0D 0C 05 2F 11 0F 0B`) atlanır · blok bayrakları (`num % 0x20 === 0`) atlanır · `ELM_WATCH_CAP=16` tavanı · her biri için `watchPid(hex, noop)` |
| 8 | `extendedPidService.ts:210` | `watchPid` → `_ensureListener()` (:184 — `obdExtendedData` + `obdExtendedPidStatus` aboneliği) → `_ensureDiscovery()` (seed varsa no-op) → `_pushToNative()` |
| 9 | `extendedPidService.ts:107` | `_buildNativeList()` — **üç filtre**: `STANDARD_PID_MAP`'te olmalı · `core` olmamalı · `_supported` içinde olmalı |
| 10 | `extendedPidService.ts:121` | `CarLauncher.setObdExtendedPids({ pids })` |
| 11 | `CarLauncherPlugin.java:1591` | → `OBDManager.setExtendedPids` (:956) / `BleObdManager.setExtendedPids` (:427) |

### C. Sorgu gidiyor mu

| # | Yer | Ne olur |
|---|---|---|
| 12 | `OBDManager.java:840-871` | `pollLoop` EXTENDED bloğu: normalde **tur başına 1 PID** round-robin, `POLL_SLOW`; burst'te tüm liste. `extNoData.shouldSkip()` demote edilmişi atlar |
| 13 | `OBDManager.java:983` | `recordAndEmitExtended` → `queuedExtendedClassified` → `ElmProtocol.readPidClassified` |
| 14 | `OBDManager.java:990-993` | `emit = kind==OK && dataHex dolu` → `listener.onExtendedPid(pid, dataHex)`. Her deneme `ExtendedPollEvidence`'a işlenir |
| 15 | `CarLauncherPlugin.java:993-1000` | → `notifyListeners("obdExtendedData", event)` |

BLE yolu birebir aynı: `BleObdManager.java:331-355` + `:453-464`.

### D. Değer nereye düşüyor

| # | Yer | Ne olur |
|---|---|---|
| 16 | `extendedPidService.ts:127` | `_onExtendedData` → keşif yanıtı mı bakar → `STANDARD_PID_MAP.get(pid)` → `decodeStandardPid` |
| 17 | `extendedPidService.ts:152` | `NaN` ise `_jsDecodeFailures++` ve **düşer** |
| 18 | `extendedPidService.ts:160-161` | `_values.set(pid, entry)` · `_jsValuesStored++` |
| 19 | `diagnosticSections.ts:125-142` | `getSupportedPids()` üzerinde döner, her biri için `getPidValue(pid)`; **değeri olan** ≤ `MAX_EXT_SAMPLES (8)` tanesi `samples`'a yazılır |

**`samples` dolması için gereken:** `_supported` dolu **VE** `_values` o PID'ler için
dolu. İkinci koşul yalnız adım 6-18 zinciri koştuysa sağlanır.

---

## 2. Zincir nerede kopuyor

### Asıl kopukluk (2026-07-15 raporunun sebebi) — ARTIK KAPALI

**Adım 6 YOKTU.** Düzeltmeden önce `watchPid`'in üründeki tek çağıranları:

- `SensorPanel.tsx:123` — panel `active` iken
- `ObdLiveTestPanel.tsx:162` — LAB Canlı Test ekranı açıkken
- `sensorQueryService.ts:260` — sesli sorguda **geçici** abonelik
- `standardPidDiscovery.ts` — keşif tetikleyicisi

Hepsi **UI tetiklemeli**. Panel kapalıyken `_watchers` boş → `_buildNativeList()` **boş
liste** döndürür → native EXTENDED grubu hiç sorgulanmaz → `_values` boş →
**`samples: []` yapısal olarak garanti**. Aynı anda `seedSupportedPids` handshake'ten
geldiği için `discovered:true / 15` görünür.

> Bu, gözlenen semptom çiftini **birebir** açıklar. Kopukluk **adım 6'daydı** — yani
> *"yoklama listesine hiç eklenmiyor"*. Sorgu gitmiyordu; ayrıştırma ve dolum
> katmanlarında sorun yoktu.

### Bugün kalan üç gerçek risk (öncelik sırasına göre)

#### S1 — Yeniden bağlanmada destek filtresi sessizce KAPANIYOR (en yüksek)

`obdService.ts:2138` her bağlantıda, handshake'ten **önce** `notifyExtendedPids()`
çağırır. `extendedPidService.ts:310`:

```
if (_watchers.size === 0) return;
_supported = null;                      // ← filtre devre dışı
_discoveryQueue = [DISCOVERY_PIDS[0]];
_ensureListener(); _pushToNative();
```

`_clearExtraPidWatches()` **yalnız `stopOBD`'de** koşuyor (`obdService.ts:2493`) —
kopma/yeniden bağlanmada değil. Yani reconnect'te 16 izleyici hayatta kalır,
`_supported` null olur, `_buildNativeList`'in destek filtresi atlanır → **16 PID'in
tamamı filtresiz native'e gider**. Bu tam olarak `seedSupportedPids`'in önlemek için
yazıldığı NO-DATA fırtınasıdır (kendi docstring'i, `extendedPidService.ts:280-287`).

Ardından handshake düşerse veya `readBlocks.size === 0` dönerse `_supported` null kalır
ve `_watchAllSupportedPids` bir daha koşmaz → `extNoData` her şeyi demote eder →
`unavailable` dolar, `samples` boş kalır. **Semptom P1-1 ile aynı, sebebi farklı.**

#### S2 — Sağlam boruyu ölü gösteren gözlem tuzağı

`extendedPollEvidence.ts:89-107`: `getExtendedPollEvidence()` senkrondur ve yalnız
`_cached`i okur; onu dolduran tek şey async `refreshExtendedPollEvidence()`. LAB
"TÜMÜNÜ KOPYALA" yolu senkrondur ve bunu **çağırmaz**.

Telefonda ölçüldü (2026-08-01): temiz boot → `counters:null` → *"eski APK / poll
başlamadı"* etiketi; aynı cihazda native çağrı **43 ms**'de tam yanıt verdi.

> **Runtime Scheduling → YENİLE yapılmadan alınan hiçbir rapor P1-1 hakkında hüküm
> veremez.** Bu adım atlanırsa boru sağlam olsa bile `NO_NATIVE_EVIDENCE` çıkar ve
> teşhis yine yanlış yere gider.

#### S3 — Tek tetikleyici, yeniden deneme yok

Adım 6 yalnız `performHandshake().then` içinde ve yalnız `readBlocks.size > 0` ise
koşar. Handshake yoksa/düşerse arka plan izleyicisi **hiç** kurulmaz ve tekrar
denenmez. 15-PID'lik raporda `bitmapClass: ok` olduğu için o cihazda yol açıktı, ama
bu tek noktalı bir bağımlılık.

### İki "kopukluk değil, beklenti hatası"

**S4 — Huni dar.** 15 destekli PID'den 7 core + blok bayrakları + `STANDARD_PID_MAP`'te
olmayanlar düşünce geriye ~5-7 aday kalır; üstüne `MAX_EXT_SAMPLES = 8` tavanı.
*"15 keşfedildi → 15 örnek görmeliyim"* beklentisi **sağlıklı bir sistemi arızalı
gösterir**.

**S5 — Dolum gecikmesi.** Burst kapalıyken tur başına **1 PID**, `POLL_SLOW`. ~7 PID'in
ilk kez dolması 7 tur sürer. Bağlantıdan saniyeler sonra alınan rapor meşru biçimde
kısmi/boş görünebilir.

---

## 3. Tasarım mı, hata mı?

**Üçü birden: bilinçli tasarım + yarım kalmış bağlama + zamanında yapılmış ama
ölçülmemiş düzeltme.**

| Aşama | Commit | Ne oldu |
|---|---|---|
| Tasarım | `e7a3c21` (Patch 8C) | **Bilinçli.** `extendedPidService` başlığı: *"İzleyici YOKKEN native'e BOŞ liste gider → poll turu tek ek komut bile çalıştırmaz."* Mali-400 sıfır-maliyet sözleşmesi. Kendi şartlarında doğru bir karar |
| Yarım kalan | — | Hiç kimse **UI-dışı** bir tüketici bağlamadı. `HANDOFF.md:356`: *"UI/sesli asistan henüz bağlanmadı — tüketici `watchPid`/…"* |
| Semptomu yaratan | `1f85ffe` | handshake → `seedSupportedPids`. Keşfi görünür yaptı ama izleyiciden bağımsız olduğu için **yanıltıcı `15 + []` çiftini bu üretti** |
| Düzeltme | `f1e0e7f` madde 4 (2026-07-17) | `_watchAllSupportedPids`: *"yalnız Canlı Test paneli açıkken değil"*. Doğru katman, doğru filtreler, `stopOBD`'de zero-leak temizliği |
| Eksik | — | **Ölçüm.** Commit'in son satırı: *"🔴 Gerçek araç doğrulaması BEKLİYOR"* |

Yani *"önce keşif, dolum sonra"* diyen bilinçli bir tasarım vardı; dolumun ürün tarafı
yarım kaldı; sonra tamamlandı; **hüküm hâlâ verilmedi.**

#383 ve #486 ile aynı kusur sınıfı ama bir adım ötesinde: orada *"mekanizma kodda var ≠
çalışıyor"*, burada ***"düzeltme kodda var ≠ ölçüldü"***.

---

## 4. Ölçülebilir mi?

### Cihazsız doğrulanabilir (birim testi) — ve bu testler BUGÜN YOK

| Ne | Nasıl | Durum |
|---|---|---|
| **Adım 1-11 bağlaması** | Sahte handshake sonucu ver → `_buildNativeList()` çıktısının boş **olmadığını** ve tam olarak beklenen core-olmayan destekli PID'leri içerdiğini doğrula | ❌ **yok** — `obdService → extendedPidService` bağlamasını hiçbir test kapsamıyor (`signalHub.test.ts` yalnız `seedSupportedPids`'i doğrudan çağırıyor). **En yüksek değerli tek test bu** |
| **Adım 16-19 dolumu** | `_internals.onExtendedData` dışa açık → sahte olay besle → `_values` dolsun → `buildObdDeepSnapshot().extended.samples` boş **olmasın** | ❌ yok |
| **S1 reconnect regresyonu** | bağlan → seed → izle → `notifyObdConnected()` çağır → destek filtresinin **sessizce kapanmadığını** doğrula | ❌ yok — **regresyon kasası adayı** |
| **S2 önbellek tuzağı** | `cacheState: 'never_refreshed'` iken hükmün *"ölçmedik"* dediğini doğrula | ✅ var (`extendedPollEvidence.test.ts`) |
| **H1/H2/H3/H4 sınıflandırıcı** | `classifyExtendedPoll` saf fonksiyon | ✅ var (16 TS + 14 JVM) |

### Gerçek araç şart

- **Hangi hipotezin gerçekleştiği.** H1/H2/H3/H4 ayrımı ECU davranışına bakar; taklit
  edilemez.
- **Aracın Mode 01 extended sorgulara yanıt verip vermediği.** Trafic'in 39/39 NO_DATA
  vakası bunun kanıtı — bu bir **araç özelliği**, kod kusuru değil.
- ELM327 NO-DATA maliyeti, round-robin dolum gecikmesi, `extNoData` demote eşiğinin
  gerçekte tetiklenip tetiklenmediği.

---

## 5. Kapatmanın maliyeti

**Ne "küçük bir bağlantı işi" ne de "eksik bir katman".** Bütün katmanlar mevcut ve
enstrümanlı. Maliyet üç kovaya ayrılıyor:

### (a) Ölçüm — kod yok, ~1 saha oturumu. ÖNCE BU.

Gerçek araca bağlan → **Runtime Scheduling → YENİLE** (S2 yüzünden zorunlu) →
`extendedPollEvidence.decision` oku. **Sıfır satır kod.** Aşağıdaki her şey bu hükmün
hangisi çıktığına bağlı.

### (b) Sertleştirme — küçük, 1 atomik PR

S1'i kapat (reconnect'te destek filtresi fail-closed olsun; `_supported = null`
sıfırlaması ya izleyicileri de bıraksın ya da filtreyi kapatmasın), S3'e yeniden deneme
yolu ver, yukarıdaki üç eksik testi yaz. **Bu gerçekten "küçük bir bağlantı işi"** —
tahminen 1 ürün dosyası + 1 test dosyası.

### (c) Saha hükmü H2 çıkarsa — kod maliyeti sıfır, ama varsayım düşer

`H2_ECU_SILENT` bir bağlama kusuru **değildir**; hiçbir TS çalışması düzeltmez. Dürüst
karşılık zaten kodda var (`getPidStatus` → `no_data`, `unavailable` listesi). Ama bu
durumda **o araç sınıfı için** PID Pack'in *"Mode 01 ile genişle"* varsayımı
geçersizdir ve ilk kategoriler başka bir araçta doğrulanmalıdır.

---

## 6. PID Pack'e (ADR) etkisi

`ADR_PID_PACK.md` §8.2/4'teki sıralama kararı — *"P1-1 kapanmadan ikinci kategori sevk
edilmez"* — **geçerliliğini koruyor**, ama gerekçesi değişti:

| Önce | Sonra |
|---|---|
| "boru bozuk" | **"borunun durumu bilinmiyor"** |

Bu daha iyi bir haber ve daha ucuz bir borç — ama kapatılana kadar kataloğu genişletmek
yine aynı riski taşır (R6: dolu katalog + boş kanıt defteri).

**Kütük #518 bu teşhisle güncellendi.** Kabul ölçütü artık *"samples dolar"* değil:

> Gerçek araçta **önce Runtime Scheduling → YENİLE**, sonra
> `extendedPollEvidence.decision` okunur ve **H1/H2/H3/H4'ten biri** kayda geçer.
> `H4_HEALTHY` çıkarsa P1-1 zaten kapalıdır ve #518 **kapanır**; diğer üç hüküm ayrı
> kütük satırı doğurur.

---

## 7. Önerilen sonraki adım (tek cümle)

Kod yazmadan önce **bir saha oturumu**: araca bağlan, Runtime Scheduling → YENİLE,
`extendedPollEvidence` hükmünü kütüğe yaz. Teşhis konuldu; eksik olan tek şey **ölçüm**.
