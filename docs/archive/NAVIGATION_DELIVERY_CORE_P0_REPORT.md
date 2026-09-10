# NAVIGATION_DELIVERY_CORE_P0 — Teslim Çekirdeği

**Tarih:** 2026-08-04 · **Dal:** `feat/fleet-offline-final-local-completion`
**Kaynak analiz:** `docs/NAVIGATION_P0_CORE_OEM_GAP_ANALYSIS.md` (G1 · G2 · G3)
**Commit / push / deploy:** YAPILMADI · dirty worktree korundu ·
`git checkout/restore/reset/stash` KULLANILMADI.

**Kapsam:** yalnız **P0-1** (sesli yönlendirme + ölü hesaplama sahipliği) ve
**P0-2** (rota süre modeline dayalı ETA). Mini harita interpolasyonu, reroute
eşikleri, adres normalizasyonu ve çevrimdışı graf **kapsam dışı** tutuldu.

---

## 1. Yönetici Özeti

Analiz turunda bulunan iki yapısal kusur kapatıldı; ikisi de aynı sınıftandı:
**navigasyonun teslim katmanı bir React bileşenine bağlıydı.**

1. **Sesli yönlendirme ölüydü.** Kademeli anons `NavigationHUD.tsx`'teki bir
   `useEffect`'teydi ve `NavigationHUD` yalnız `FullMapView` içinde mount
   ediliyordu. Sürücü mini haritaya döndüğü an **hazırlık · yaklaşma · dönüş
   anonslarının hepsi susuyordu.** Üstelik `navigationSessionRuntime` başlığı
   bu arızanın çözüldüğünü *yazıyordu* — belge ile kod çelişiyordu.
   İkinci kusur: kademe maskesi bir bileşen ref'iydi → görünüm kapanıp açılınca
   aynı manevra **ikinci kez** seslendiriliyordu.

2. **Tünelde ilerleme ölüydü.** Ölü hesaplama (DR) beslemesi `FullMapView`'ın
   RAF döngüsündeydi → mini haritadayken tünelde **mesafe · ETA · adım sayacı**
   donuyordu.

3. **ETA rotanın kendi süre modelini kullanmıyordu.** `annotations=duration`
   OSRM'den **zaten isteniyordu** ama yanıt hiç ayrıştırılmıyordu; ETA
   `kalanMesafe / anlıkHız` ile yeniden türetiliyordu. O veri için harcanan bant
   genişliği çöpe gidiyordu.

Üçü de kapatıldı, **yeni algoritma yazılmadan**: eşikler, anons metinleri ve DR
sözleşmeleri birebir korundu; değişen yalnız **sahiplik** ve ETA'nın **gövdesi**.

**Karar: `NAVIGATION_DELIVERY_CORE_P0_COMPLETE_LOCAL`**
(`realVehicleValidationVerdict = PENDING_REAL_VEHICLE`).

---

## 2. Sesli Yönlendirme Sahipliği

### Önce (kanıt)
* `NavigationHUD.tsx:1870` — `useEffect` içinde üç kademe + `speakNavigation`.
* `NavigationHUD.tsx:1866` — `_spokenRef` **bileşen ref'i**.
* `NavigationHUD.tsx:1125` — `ReroutingBanner` mount'ta "Rota yeniden
  hesaplanıyor" diyordu (banner görünmezse ses de yok).
* Mount zinciri: `DrawerPanel.tsx:40` (lazy) → `FullMapView.tsx:2157` → HUD.

### Sonra
| Katman | Dosya | Sorumluluk |
|---|---|---|
| Karar (SAF) | `navigation/core/voiceGuidanceModel.ts` | kademe + metin; I/O yok |
| Sahip | `navigation/voiceGuidanceRuntime.ts` | maske, dedupe, TTS çağrısı |
| Besleyici | `navigation/navigationSessionRuntime.ts` | tick bağlamı (GPS **ve** DR) |
| Görünüm | `NavigationHUD.tsx` | **yalnız çizer** |

**Korunanlar (test kilitli):** `600 m` · `250 m` · son kademe
`min(150, max(35, hız_m/s × 4))` · 50 m yuvarlama · `Şimdi <talimat>` ve
`<N> metre sonra <talimat>` · yakın kademe uzaktakileri kapatır · mesafe kaynağı
`UNKNOWN` iken konuşulmaz.

**Kanonik kimlik:** `maneuverId = ${navigationSessionId}:${routeRevision}:${stepIndex}`
Kademe (`guidanceStage`) bit maskesiyle bu kimliğe bağlanır. Üç alan birden
gerekir: yalnız adım indeksi kullanmak reroute sonrası indeks 0'a dönünce
"zaten söylendi" yanlışını üretirdi.

**Kurallar ve nerede sağlandığı:**

| Kural | Uygulama |
|---|---|
| Görünüm ses sahibi olamaz | HUD/FullMapView/MiniMap'te `speakNavigation` yok (kilit) |
| Mini + tam ekran aynı runtime | Tek besleyici `navigationSessionRuntime` |
| Aynı manevra+kademe iki kez konuşulmaz | `_spoken` maskesi + `duplicateSuppressed` sayacı |
| Remount durumu kaybetmez | Durum MODÜL düzeyinde |
| Reroute'ta eski kuyruk temizlenir | `routeKey` değişince `_spoken = new Map()` |
| Navigasyon bitince temizlenir | `_onNavigationInactive` + `stopNavigationSessionRuntime` |
| Restore sonrası geçmiş anons oynatılmaz | Yakın kademe uzaktakileri kapatır |
| Navigasyon aktif değilse ses yok | `navActive` kapısı (iki katmanda) |
| Şerit/dönel veri uydurulmaz | Model yalnız `instruction` okur; boşsa `null` |

**Bounded:** izlenen manevra sayısı 64 ile sınırlı (bellek sızıntısı yok).

### ⚠️ Açık borç — bilinçli kapsam dışı
`NavigationHUD` içinde **tek bir** `speakNavigation` kaldı: LIMP_HOME
("Sistem koruma modu aktif"). Bu bir navigasyon yönlendirmesi değil, bilişsel/
termal durum bildirimidir ve sahibi `useCognitiveStore`dur. Taşınması bu turun
kapsamı dışında; **test o çağrının TEK ve YALNIZ o olduğunu kilitler** — yenisi
eklenemez.

---

## 3. Ölü Hesaplama Sahipliği

### Önce
`FullMapView.tsx:860-865` — RAF döngüsü içinde 1 Hz `updateRouteProgress` +
`updateNavigationProgress`. Bileşen unmount olunca besleme ölüyordu.

### Sonra
`navigationSessionRuntime` içinde **tek** `setInterval(_drTick, 1000)`.

| Kural | Uygulama |
|---|---|
| Tam ekran kapalıyken DR sürer | Timer runtime'da, görünümden bağımsız |
| Mevcut eşikler değişmedi | `GPS_STALE_MS=5000` · `DR_MAX_DT_SEC=60` · 1 Hz · `allowReroute:false` |
| Yeni DR motoru yazılmadı | `projectDeadReckon` / `resolveDrSpeed` aynen kullanıldı |
| GPS dönünce çift ilerleme yok | Fix geldiğinde `_lastFix.ts` tazelenir → DR tick erken döner |
| Aynı mesafe iki kez eklenmez | `updateRouteProgress` **mutlak** eşleştirme yapar; birikimli değil |
| Güven bitince ilerleme durur | `_drConfidence = 1 − yaş/60` ; `≤0` → `DR_EXPIRED`, tick iş yapmaz |
| Sahte ilerleme yok | Hız `< 1 km/sa` ise projeksiyon YAPILMAZ |
| Navigasyon bitince temizlenir | `_onNavigationInactive` + `stop…` (iki `clearInterval`) |
| Timer sahipliği tek yerde | Kilit: `setInterval` **tam olarak 1 kez**, `setTimeout` yasak |
| Duplicate runtime yok | `_ensureDrTimer` idempotent |

**Hız kaynağı:** `UnifiedVehicleStore.speed` — store sözleşmesine göre asıl
tazelik kapısı `obdService.getObdSpeedFresh()`tir, yani **bayat OBD hızı buraya
ulaşmaz**. `obdService` navigasyon runtime'ının import grafiğine sokulmadı.

`FullMapView` DR'yi hâlâ **çizer** (marker + kamera) — çizim ilerleme üretmez.

---

## 4. OSRM Süre Verisi

`navigation/core/routeDurationModel.ts` (SAF):

| Alan | Anlamı |
|---|---|
| `segmentDurations` | segment başına sn (uzunluk = nokta − 1) |
| `cumulativeDurations` | noktadan sona kalan sn (suffix-sum, son eleman 0) |
| `routeDurationSource` | `OSRM_ANNOTATION` · `ROUTE_TOTAL` · `STRAIGHT_LINE_ESTIMATE` · `NONE` |
| `durationIntegrityState` | `VALID` · `LENGTH_MISMATCH` · `INVALID_VALUES` · `MISSING` |
| `routeRevision` / `durationRevision` | monotonik; farklıysa ETA `STALE` |

**Doğrulama fail-closed:** uzunluk geometriyle birebir eşleşmeli; `NaN`/
`Infinity`/negatif/24 saati aşan tek bir değer bile diziyi **TÜMDEN** reddeder.
Yarı doğru bir süre modeliyle "kesin" ETA üretmek, hiç üretmemekten kötüdür.

**Atomik devralma:** revizyon + geometri + mesafe dizisi + süre dizisi **tek
`setState`** içinde yazılır → hiçbir okuyucu yeni geometriyle eski süreyi bir
arada göremez. Alternatif rota seçimi de bir rota değişimidir: o adayın **kendi**
süre dizisi devralınır (`_StoredRoute.annotationDurations`).

**Düz hat:** `STRAIGHT_LINE_ESTIMATE` + `MISSING` → `ROUTE_MODEL` durumunu
**yapısal olarak üretemez**.

---

## 5. ETA Hesabı

`navigation/core/etaModel.ts` (SAF).

```
ETA = kalanRotaSüresi × düzeltmeÇarpanı + durmaTamponu
düzeltmeÇarpanı = clamp(modelHızı / gözlenenHız, 0.8, 1.5)
```

* Düzeltme **yalnız** gözlenen hız `≥ 8 km/sa` iken uygulanır → araç durunca
  ETA şişmez, sonsuza gitmez.
* Çarpan kırpılıdır → anlık hız sıçraması ETA'yı zıplatamaz ve rota modelini
  **ezemez**.
* Alt sınırın (0.8) üst sınırdan (1.5) dar olması bilinçlidir: "erken
  varacaksın" demek, geç kalmaktan daha zararlı bir yanlıştır.
* Kalan süre her tick'te **mutlak** okunur → geçilen segmentlerin süresi
  yeniden eklenmez.
* Kalan süre yalnız eşleşme `MATCHED`/`MATCH_UNCERTAIN` iken üretilir.

**Durumlar:** `ROUTE_MODEL` · `DEGRADED_FALLBACK` · `INSUFFICIENT_ROUTE_DATA` ·
`STALE` · `UNKNOWN`. Mevcut 5 sn / 2 sn histerezisi ve ">5 sn değişimde yaz"
kuralı korundu → mini ve tam ekran **aynı store'dan** okuduğu için aynı değeri
gösterir.

### ⚠️ Açık borç
Hesap `STALE`/`INSUFFICIENT_ROUTE_DATA` verdiğinde store'a **dokunulmaz**;
ekranda bir önceki geçerli ETA kalır. Bu bilinçli bir seçimdir (sürüş ortasında
ETA'yı boşaltmak rahatsız edicidir) ama teorik olarak kısa bir süre eski değer
görünebilir. Durum LAB'da `etaState` ile **açıkça** görünür. Kalıcı çözüm ayrı
bir "ETA belirsiz" görsel durumudur — bu turun kapsamı dışında.

---

## 6. Görünüm Regresyonu

| Senaryo | Sonuç | Nasıl doğrulandı |
|---|---|---|
| FullMapView açık → ses | ✅ | runtime besler |
| FullMapView kapalı → ses devam | ✅ | ses görünüme bağlı değil (kilit) |
| Mini harita aktif → ses devam | ✅ | aynı runtime |
| Tam ekran tekrar açılır → anons tekrarlanmaz | ✅ | modül düzeyi maske (test) |
| Navigasyondan çıkılır → mini harita sürer | ✅ | oturum motoru (mevcut) |
| Sonlandırılır → runtime temizlenir | ✅ | `_onNavigationInactive` + `stop…` |
| Tam ekran = mini harita ilerleme/ETA | ✅ | tek store, tek otorite |
| UI runtime başlatıp durdurmaz | ✅ | kilit: görünümlerde `start/stop…` yok |

---

## 7. CAROS LAB

**Navigation Core → Kart 12 "Teslim Çekirdeği (Ses · Ölü Hesaplama · ETA)"**
— salt-okunur, 22 alan:

`voiceRuntimeState` · `voiceOwner` · `lastSpokenManeuverId` · `lastSpokenStage` ·
anons sayısı · `voiceDuplicateSuppressed` · izlenen manevra ·
`drRuntimeState` · `drOwner` · DR timer durumu · DR tick sayısı ·
`drDistanceMeters` · `drConfidence` ·
`routeDurationSource` · `durationIntegrityState` · `totalRouteDurationSeconds` ·
`remainingRouteDurationSeconds` · `routeRevision`/`durationRevision` ·
`etaState` · ETA · düzeltmesiz model süresi · düzeltme çarpanı · ETA gerekçesi

Tüm alanlar `navigationCoreFieldAudit` kaydına eklendi (kaynak + tazelik
sözleşmesi kilitli). LAB hiçbir runtime'ı **başlatamaz/durduramaz/değiştiremez**.

---

## 8. Testler

**Yeni:** `src/__tests__/navigationDeliveryCore.test.ts` — **62 kilit**
(A ses modeli + runtime · B DR sahipliği · C süre ayrıştırma · D ETA ·
E görünüm regresyonu + saflık · F runtime entegrasyonu).

**Taşınan kilitler** (kaldırılmadı — yeni sahibine taşındı, gerekçesi yazıldı):
* `realDriveFindings` — hız-adaptif eşik → `voiceGuidanceModel.finalTierMetres`
* `regression.guards` — rota değişince kademe sıfırlama → `voiceGuidanceRuntime`
  (+ **yeni kilit:** sahiplik görünümde değil)
* `navigationSessionContinuity` — "motor timer kurmaz" → **"yalnız DR için TEK
  timer"** (davranış bilinçli değişti; `setTimeout` hâlâ yasak, çift
  `clearInterval` şartı eklendi)
* `navigationHud.turnStep` — off-by-one anons kilidi → runtime
* `navigationCoreFieldAudit` — ilk-talimat damgası monotonikliği → runtime

| Kapı | Sonuç |
|---|---|
| `npx tsc -b --force` | ✅ temiz |
| `npm run lint` | ✅ yeni dosyalarda 0 sorun (4 hata **önceden vardı**, dokunulmayan dosyalarda) |
| `npx vitest run` | ✅ **475 dosya / 10684 test — hepsi geçti** |

---

## 9. Değişen Dosyalar

**Yeni:**
`navigation/core/voiceGuidanceModel.ts` · `navigation/voiceGuidanceRuntime.ts` ·
`navigation/core/routeDurationModel.ts` · `navigation/core/etaModel.ts` ·
`__tests__/navigationDeliveryCore.test.ts`

**Değişen:**
`navigation/navigationSessionRuntime.ts` (ses beslemesi + DR timer + snapshot) ·
`routingService.ts` (annotation ayrıştırma, süre alanları, revizyon) ·
`navigationService.ts` (ETA modeli + `getEtaVerdict`) ·
`NavigationHUD.tsx` (ses kaldırıldı) · `FullMapView.tsx` (DR beslemesi
kaldırıldı) · `devtools/navigationCoreSources.ts` + `navigationCoreModel.ts`
(kart 12) · 5 test dosyası (kilit taşıma)

---

## 10. Kapılar ve Nihai Karar

| Kapı | Hüküm | Gerekçe |
|---|---|---|
| `voiceOwnershipVerdict` | **PASS** | Ses görünümden alındı; HUD/FullMap/MiniMap'te üretim yok (kilit). Tek istisna LIMP_HOME, kapsam dışı ve kilitli. |
| `voiceDedupVerdict` | **PASS** | `(oturum, revizyon, adım)` maskesi modül düzeyinde; remount/reroute/restore senaryoları test edildi |
| `deadReckoningOwnershipVerdict` | **PASS** | Tek timer runtime'da; çift ilerleme mutlak eşleştirmeyle yapısal olarak imkânsız; güven bitince durur |
| `routeDurationParsingVerdict` | **PASS** | Uzunluk + değer doğrulaması fail-closed; atomik revizyon devralma; düz hat ayrı etiketli |
| `etaModelVerdict` | **PASS** | Gövde rota süre modeli; düzeltme kırpılı; durma/sıçrama/bayatlık senaryoları kilitli. Kısmi borç: hesap üretilemediğinde eski değer ekranda kalır (§5) |
| `miniMapContinuityVerdict` | **PASS** | Tek store, tek otorite; ses ve DR görünümden bağımsız |
| `realVehicleValidationVerdict` | **PENDING_REAL_VEHICLE** | Gerçek araçta hiçbir senaryo ölçülmedi |

### `NAVIGATION_DELIVERY_CORE_P0_COMPLETE_LOCAL`

Yerel kapıların tamamı geçti; **saha kanıtı YOKTUR.** Kütüğe üç madde
🔴 olarak eklendi (#391–#393). Bu tur, analiz belgesindeki **G1 · G2 · G3**
açıklarını kapatır; matris beklentisi ses `1 → 4`, tünel sürekliliği `1 → 4`,
ETA `2 → 4` — ancak bu yükselmeler **gerçek araçta ölçülene kadar iddiadır.**
