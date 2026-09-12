# OTOMATİK SAHA DOĞRULAMA — YOL ÖNCESİ GÜVENLİK KAPISI RAPORU

**Tarih:** 2026-08-02 · **Dal:** `feat/fleet-offline-final-local-completion`
**Kapsam:** Uzun yol öncesinde (a) yanlışlıkla geri alınan üç dosyanın kurtarma
denetimi, (b) saha testinin kendi kayıtlarını denetleyen ikinci otorite,
(c) yerel preflight, (d) gerçek araç başlangıç kapısı.
**Yapılmayanlar:** yeni özellik yok · kapsam büyütme yok · commit/push/deploy yok.

---

## 0 · NİHAİ KARAR

```
PRE_ROAD_GATE_PARTIAL
```

**Neden PASS değil:** yerel kapıların tamamı kanıtlandı, ancak (1) gerçek araç
hiç bağlanmadı, (2) kurtarma yöntemi 2026-08-01 23:55 sonrasındaki bir düzenleme
penceresine **yapısal olarak kördür** ve bu boşluk kanıtla kapatılamaz —
yalnız kullanıcı teyidiyle kapanır (kütük #314).

**Neden BLOCKED/REJECTED değil:** kanıt saklama yolu (kalıcılık · tampon ·
kritik-olay persistence · bozuk kayıt reddi) uçtan uca ölçüldü ve çalışıyor;
kurtarılan dosyalar alan alan derlenmiş bundle ile karşılaştırılıp doğrulandı.

### Kapılar

| Kapı | Değer | Dayanak |
|---|---|---|
| `recoveredFilesVerdict` | **VERIFIED_WITH_RESIDUAL_RISK** | Katalog 44/44 araç × 6 alan **birebir**; screenMap 35/35 case aynı ekrana (iki `focus` prop'u dahil); MainLayout'ta sahipsiz string **0**. Artık risk: derleme-sonrası pencere (kütük #314). |
| `selfValidationVerdict` | **NOT_CHECKED** (simüle koşumda 6/8 VERIFIED) | 2 saatlik simüle koşumda 6 denetim `VERIFIED`, 2 denetim dürüstçe `NOT_CHECKED` (kritik olay ve restore yaşanmadı). Genel hüküm **en kötü satırdır** → `NOT_CHECKED`. Gerçek veriyle hiç koşmadı (kütük #313). |
| `persistenceVerdict` | **PASS (yerel)** | Process death → aynı `sessionId`, `sessionVersion` 1→2, defter korunuyor, kayıp ≤ 30 sn; **kritik olay checkpoint beklemeden** yazılıyor (ölçüldü). Gerçek cihazda denenmedi (kütük #310). |
| `privacyVerdict` | **PASS** | Rapor gerçekten taranıyor: `violations=[]`. Ayrıca **diskteki gövde** de sınandı: 17 haneli VIN deseni ve `latitude/longitude` anahtarı YOK. |
| `driverDistractionVerdict` | **SAFE_PASSIVE** | Gösterge mount'u geri kondu **ve kilitlendi**; oturum yokken `null` render; hareket hâlinde özet açılamaz; hız bilinmiyorsa fail-closed kapalı. |
| `realVehicleReadinessVerdict` | **NOT_RUN** | Gerçek araç bağlı değil. Sistem bunu kendisi `BLOCKED_REAL_VEHICLE` olarak raporluyor. |

---

## 1 · KURTARILAN DOSYALARIN DENETİMİ

> Görev kuralı: *"Sadece testle yetinme. Git diff, import grafiği ve çağrı
> zinciriyle incele. Kanıt olmadan 'tam kurtarıldı' deme."*

### 1.1 Yöntem ve kanıt

| Kontrol | Yöntem | Sonuç |
|---|---|---|
| Araç kimlikleri korunmuş mu | Derlenmiş bundle'daki katalog dizisi çıkarılıp **alan alan** karşılaştırıldı | ✅ 44/44 araç · `category·name·desc·status·layer·note` **birebir** |
| AVAILABLE araçlar gerçek ekrana bağlı mı | `renderAvailableTool()` her AVAILABLE id için çağrıldı | ✅ 36/36 non-null (ayrıca mevcut `carosLab.test.tsx` KİLİT 5 de doğruluyor) |
| Lazy import yolları doğru mu | `tsc -b` (yol + **named export** doğrulaması) | ✅ temiz — nitekim `MediaAuthorityScreen` için yanlış default-import bu yolla YAKALANDI ve düzeltildi |
| switch/mapping kaybı var mı | Bundle'daki `case"<id>":→<chunk>` eşlemesi çıkarılıp kaynakla karşılaştırıldı | ✅ 35/35 case **aynı ekrana**; kaynakta fazladan tek case = bu turda eklenen uzun yol aracı |
| `focus` prop davranışı korunmuş mu | Bundle'dan prop metni çıkarıldı + mevcut `carosLabRuntimeFocus.test.tsx` | ✅ `queue-monitor→focus="queue-monitor"`, `poll-scheduler→focus="poll-scheduler"` |
| Sürüş kapısı korunmuş mu | Bundle'daki derlenmiş koşul okundu, kaynağa birebir kondu, **kilit yazıldı** | ✅ `!tripSummaryBlocked` koşulu geri konuldu; `canShowTripSummary(useUnifiedVehicleStore(s→s.speed))` |
| Paralel Fleet/Music/AI kaybı var mı | 7 Fleet + 1 Media + 5 AI aracının katalog kaydı, ekran dosyası, screenMap eşlemesi ve kendi test dosyaları | ✅ hepsi mevcut ve yeşil |
| Ekran dosyası kaybı | `screens/*.tsx` ↔ screenMap referans taraması | ✅ eşleşmeyen 3 dosya var ve **hepsi meşru**: `SttConditionSummary`/`SttMeasurementSection` (SttMicScreen alt bileşenleri), `ToolInfoScreen` (host'un fallback ekranı) |
| dist'ten **eski** kod taşınmış olabilir mi | Derleme zamanı (23:55) ile tüm LAB kaynaklarının mtime'ı karşılaştırıldı | ⚠️ Tüm ekran dosyaları derlemeden ESKİ → derleme o an güncel. **Ama 23:55–08:30 penceresi kanıtlanamaz** (§1.3) |

Kanıt testi: `src/__tests__/_auditCatalogRecovery.test.ts` (7 iddia, hepsi geçiyor).

### 1.2 Denetimin BULDUĞU gerçek kusur

**`<FieldTestBadge />` mount'u kurtarma sırasında düşmüş ve yeniden eklenmemişti.**

- `tsc -b` temizdi. **Tüm suite yeşildi.** Hiçbir test bunu yakalamadı.
- Yani sürüş göstergesi ürüne bağlı olmadığı hâlde özellik "tamam" görünüyordu.
- Denetimde bulundu → geri kondu → **import + JSX mount kilidi** yazıldı.
- Aynı turda T13 sürüş kapısı için de kilit eklendi.

> **Ders (kütük #315):** *"Tüm testler yeşil" bir mount'un varlığını KANITLAMAZ.*
> Bu bulgu tek başına denetimin gerekliliğini gösteriyor.

### 1.3 Kapatılamayan artık risk (dürüst kayıt)

Kurtarma **derlenmiş bir yapıya** dayanır (2026-08-01 23:55). Bu yöntem, üç
kaynak dosyanın o saatten sonra düzenlenmiş olma ihtimaline **yapısal olarak
kördür**. Azaltıcı kanıtlar:

- Tüm CAROS LAB ekran dosyalarının mtime'ı derlemeden **eski**.
- Katalog içeriğini `status`/`note` **metniyle** sınayan 26 mevcut test yeşil
  (ör. `/BAŞLATMAZ/`, `/GÖSTERİLMEZ/`, `/EKRANA BASILMAZ/`).
- Oturum başında okuduğum `CarosLabToolId` union'ı bundle ile **birebir** aynıydı.

Buna rağmen **"kayıp yok" KESİN olarak söylenemez** → kütük **#314**, kapanışı
kullanıcı teyidine bağlı. Teyit gelince `_auditCatalogRecovery.test.ts`
silinmelidir (eski bundle'a bağımlıdır).

---

## 2 · TEST MODU SELF-VALIDATION

Yeni, **salt-okunur, saf** ikinci otorite: `longRoadSelfValidator.ts`.

### 2.1 Otorite ayrımı (en kritik kural)

Kabul matrisi *"ölçüm ne diyor"*, öz-denetim *"o ölçüme güvenilebilir mi"*
sorusunu yanıtlar. İkisi **birbirine dokunmaz** ve bu yapısal olarak kilitlidir:

- `affectsAcceptanceVerdict: false` alanı tipte `false` literalidir.
- Doğrulayıcı `longRoadAcceptance`'ı **import dahi etmez** (testle sınanıyor).
- `finalVerdict` doğrulayıcıdan ÖNCE hesaplanır; bozuk öz-denetimle matrisin
  **değişmediği** testle kanıtlandı.
- JSON raporda `selfValidation`, `verdicts` bloğunun **dışındadır**.
- Doğrulayıcı oturum nesnesini mutasyona uğratmaz (JSON eşitlik testi).

### 2.2 Sekiz denetim

| # | Denetim | Ne yapar |
|---|---|---|
| 1 | `RAW_EVENT_PRESENT` | Gözlendiği iddia edilen her senaryonun ham olay defterinde karşılığı var mı |
| 2 | `TIME_RANGE` | Damgalar oturum penceresinde mi; ölçüm süresi duvar saatini aşıyor mu; ters sıra var mı |
| 3 | `COUNTER_RECOMPUTE` | Kararın kullandığı 3 sayaç ham olay adedinden **yeniden hesaplanıyor mu** |
| 4 | `NULL_NOT_VERDICT` | Okunamayan alan sessizce bir sayıya/hükme dönüşmüş mü |
| 5 | `DUPLICATE_EVENTS` | Aynı kimlik / aynı tip+damga iki kez yazılmış mı |
| 6 | `DROPPED_IMPACT` | Düşen kayıt yeniden hesabı KESİNSİZ kılıyor mu |
| 7 | `CHECKPOINT_RING` | Pencere ham olaya bağlı mı; `preWindowComplete=TAM` iddiası halka geçmişiyle destekli mi |
| 8 | `RESTART_COUNTER_JUMP` | `sessionVersion` = `restoreCount+1` mi; restore sonrası defter sıfırlanmış/şişmiş mi |

Sonuç kümesi: `VERIFIED · MISMATCH · INSUFFICIENT_RAW_EVIDENCE · CORRUPT · NOT_CHECKED`.
Genel hüküm **en kötü satırdır** — 6 doğrulama "tam doğrulandı" demek değildir.

### 2.3 Kritik tasarım kararı

**Düşen kayıt `MISMATCH` SAYILMAZ.** Bütçe budaması zaten farkı açıklar; aksi
hâlde bütçe davranışı sahte bir "veri bozuk" alarmına dönüşürdü. Bu yollarda
sonuç `INSUFFICIENT_RAW_EVIDENCE`'tır. Bu kural yazılırken bir gerçek boşluk
bulundu ve düzeltildi: defterin **tamamı** budandığında (olay dizisi boş) ilk
uygulama yine de `MISMATCH` diyordu.

### 2.4 Ölçülen sonuç (2 saatlik simüle koşum)

```
RAW_EVENT_PRESENT     = VERIFIED
TIME_RANGE            = VERIFIED
COUNTER_RECOMPUTE     = VERIFIED
NULL_NOT_VERDICT      = VERIFIED
DUPLICATE_EVENTS      = VERIFIED
DROPPED_IMPACT        = VERIFIED
CHECKPOINT_RING       = NOT_CHECKED   ← kritik olay yaşanmadı, pencere yok
RESTART_COUNTER_JUMP  = NOT_CHECKED   ← restore yaşanmadı
──────────────────────────────────────
verdict = NOT_CHECKED · verified 6/8 · problem 0
```

Bu tablo testte **birebir kilitlidir** — zayıf "hata yok" iddiası yerine
gerçek gözlem sabitlendi.

---

## 3 · PRE-ROAD PREFLIGHT (yerel, araçsız)

`src/__tests__/longRoadPreRoadGate.test.ts` — 19 iddia, hepsi geçiyor.

| # | Madde | Ölçülen |
|---|---|---|
| 1 | Session başlat/durdur | `ACTIVE` → `COMPLETED`, bitiş damgası + `SESSION_END` snapshot'ı |
| 2 | Process restore | Aynı `sessionId`, sürüm 1→2, öz-denetim `RESTART_COUNTER_JUMP=VERIFIED` |
| 3 | Storage bütçesi | `OK/CRITICAL` sınıflandırması; **ölçülemeyen durum `WARN`** (iyimser değil) |
| 4 | Snapshot cooldown | 15 kez tazelik gidip geldi → `OBD_DATA_LOSS` snapshot'ı **≤1**, bastırılan >0 |
| 5 | BlackBox kapanışı | 120 sn sonra pencere kapandı, `postWindowComplete=true` |
| 6 | Kritik olay persistence | Kritik olay + process death → olay ve sayaç **korunmuş** |
| 7 | Rapor üretimi | Markdown + geçerli JSON + 8 satırlık öz-denetim |
| 8 | Maskelenmiş export | `privacy=PASS`, `violations=[]`; **diskteki gövdede** VIN/koordinat deseni YOK |
| 9 | Bozuk kayıt reddi | `loadSession()=CORRUPT`, oturum `CORRUPT`, öz-denetim `verifiedCount=0` |
| 10 | Storage pressure | KRİTİK baskıda CRITICAL olaylar **korundu**, INFO budandı |
| 11 | Uzun saat simülasyonu | 7 200 tick (2 saat): süre invaryantı tuttu, snapshot ≤64, öz-denetim 6/8 VERIFIED |

---

## 4 · GERÇEK ARAÇ BAŞLANGIÇ KAPISI

Altı kapı oturuma yazılıyor: `OBD_ACCESS · GPS_ACCESS · STORAGE ·
SESSION_PERSISTENCE · BLACKBOX_BUFFER · SNAPSHOT_EXPORTER`.

Bu turda iki kapı **gerçek otoriteye** bağlandı:

- **GPS izni** artık ürünün kendi durumundan okunuyor
  (`gpsService.getGPSState()` → `unavailable && error==='GPS permission denied'`)
  → `BLOCKED_POLICY`. **İzin İSTENMEZ**, yalnız mevcut durum okunur.
- **Storage** artık yalnız yazılabilirlik değil, **bütçe payı** da bildiriyor.
  İşletim sistemi boş alanı senkron okunamadığı için **"yeterli" VARSAYILMIYOR**;
  bu sınır metinde açıkça yazılı.

**Engelleme kuralı (testle kilitli):**

| Düşen kapı | Davranış |
|---|---|
| `OBD_ACCESS` | ✅ Test **devam eder**, alan `BLOCKED_HARDWARE` |
| `GPS_ACCESS` (izin reddi) | ✅ Test **devam eder**, alan `BLOCKED_POLICY` |
| `SNAPSHOT_EXPORTER` | ✅ Test **devam eder**, alan `DEGRADED` |
| `SESSION_PERSISTENCE` | ⛔ Oturum **başlamaz** (`FAILED`) |
| `BLACKBOX_BUFFER` | ⛔ Oturum **başlamaz** (`FAILED`) |

Son ikisi tek meşru engeldir: kanıt saklanamıyorsa ölçmenin anlamı yoktur.
BLOCKED kapılar rapora **açıkça** yazılır, gizlenmez.

---

## 5 · KOŞUM SONUÇLARI

```
npm run test → 459 dosya · 10043 test · TAMAMI YEŞİL
npx tsc -b   → temiz
npx eslint   → yeni/değişen dosyalarda 0 sorun
```

Bu turda eklenen: **+70 test** (42 öz-denetim · 19 pre-road · 7 kurtarma
denetimi · 2 mount/sürüş-kapısı kilidi).

### Önceki turdaki "kırık kilit" tespiti DÜZELTİLDİ

Önceki raporda `regression.guards › _hasAnyField` **kırık** olarak
bildirilmişti. Yeni ölçüm bunu **çürüttü**: Vite transform önbelleği ısındıktan
sonra izole **3/3 koşumda 163/163** geçti ve tam suite tamamen yeşil çıktı.
Kilit kırık değil, **kararsız** — soğuk önbellekte dinamik import 5 sn'lik
varsayılan `testTimeout`a sığmıyor. Kütük **#312** buna göre 🔴'dan 🟡'ye
taşındı ve yanlış teşhis kayda geçirildi.

---

## 6 · AÇIK BORÇLAR (bu turdan sonra)

| Kütük | Borç |
|---|---|
| **#308–#311** | Gözlemci gerçek araçta hiç koşmadı; ürün davranışı cihazda ölçülmedi; gerçek process death denenmedi; BlackBox penceresi gerçek kesintide dolmadı |
| **#312** | Kararsız regresyon kilidi (soğuk önbellek) — timeout'u kör büyütmeden çözülmeli |
| **#313** | Öz-denetleyici gerçek veriyle hiç koşmadı (`CHECKPOINT_RING` ve `RESTART_COUNTER_JUMP` gerçek olay ister) |
| **#314** | Kurtarmanın derleme-sonrası kör penceresi — **kullanıcı teyidi** gerekiyor |
| **#315** | Gösterge rozetinin cihazda görünürlüğü doğrulanmadı |

Ayrıca önceki turdan devam eden borçlar geçerlidir: AI kanıt akışı · müzik ·
navigasyon gözlem kanalları bağlanmadı; sürücü zinciri `BLOCKED_HARDWARE`;
5 SPEC eşiği ürün sözleşmesine bağlanmadı.

---

## 7 · YOLA ÇIKMADAN ÖNCE ÖNERİLEN İKİ ADIM

1. **Kütük #314 için:** `git diff` ile `carosLabCatalog.ts`,
   `carosLabScreenMap.tsx` ve `MainLayout.tsx` gözden geçirilsin — 2026-08-01
   23:55'ten sonra yapılmış bir düzenleme hatırlanıyorsa eksik olup olmadığı
   teyit edilsin. Bu, kanıtla kapatamadığım tek boşluktur.
2. **Yolda:** CAROS LAB → Geliştirici → *Uzun Yol Saha Doğrulama* → **BAŞLAT**.
   Sonrasında hiçbir işlem gerekmez. Dönüşte **SAHA RAPORUNU OLUŞTUR**.
   Raporda kabul matrisi ile **kayıt öz-denetimi ayrı ayrı** okunmalı: matris
   `PASS` derken öz-denetim `MISMATCH` diyorsa **matrise güvenilmemelidir**.
