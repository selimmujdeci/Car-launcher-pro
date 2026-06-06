# CAROS PRO DEVİR DOKÜMANI v1

> **Amaç:** Bu projeyi hiç bilmeyen yeni bir agent/oturumun, hiçbir bilgi kaybı olmadan ve tamamlanan işleri tekrar yapmadan devam edebilmesi.
> **Hazırlanma tarihi:** 2026-06-03
> **Aktif branch:** `feature/ble-obd-support`
> **App ID:** `com.cockpitos.pro` · **Ürün:** Ticari in-car infotainment OS (3. taraf head unit'lere satılıyor)

---

## 0. Hızlı Bağlam (önce bunu oku)

CarOS Pro = React 19 + TypeScript 5 + Vite + Capacitor 8 (Android) + Zustand 5 + MapLibre GL 4 tabanlı araç içi infotainment. Hedef donanım: **düşük güçlü ARM + Mali-400 GPU**, test head unit **K24 + Hiworld (root yok)**. Tüm yanıtlar **Türkçe** (CLAUDE.md zorunlu kuralı). **Onay isteme yok** — işlemler doğrudan yapılır (CLAUDE.md). Ticari satış nedeniyle **copyleft/NC lisans yasak** (CLAUDE.md lisans kuralı).

Mimari kalbi: **VehicleDataLayer** — Worker tabanlı hesaplama çekirdeği (`VehicleCompute.worker.ts`) + SharedArrayBuffer/Seqlock telemetri + RAF tabanlı gauge smoothing. **Kritik gerçek: head unit'te SAB DEVRE DIŞI (aşağıda Bölüm 3).**

---

## 1. Projenin Mevcut Durumu

- **Build / Test / Lint: YEŞİL.** `npm run build` (~48s), `vitest run` 30 dosya / 438 test geçiyor, `eslint` temiz.
- Aktif çalışma kolu: `feature/ble-obd-support`. Ana kol: `main` (CLAUDE.md'de `master` yazıyor ama git `main` kullanıyor — PR'larda dikkat).
- Son commit'ler: Vosk/JNA keep rule, BLE GATT OBD desteği, McuEventSniffer crash fix, Dead Reckoning testleri.
- Proje **stabilizasyon fazında** — yeni özellik değil, doğrulama ve performans sertleştirme yapılıyor.
- En son tamamlanan: **Performans Faz 3** — `useSABDirectUpdate.ts` fallback generation-guard (Bölüm 2.6).

---

## 2. Tamamlanan İşler (TEKRAR YAPTIRMA)

### 2.1 McuEventSniffer crash loop düzeltmesi
- **Sorun:** Ölü executor → `RejectedExecutionException` → `crashRecovery` döngüsü → 1-5 dk'da bir native restart.
- **Durum:** ÇÖZÜLDÜ, build OK. (Native Android tarafı.)

### 2.2 BLE GATT OBD desteği (Faz 0→3 + R1)
- **Kök neden:** Test adaptörü **BLE-only**; tarama BLE cihazını listeliyordu ama bağlantı yalnızca Classic RFCOMM yapıyordu — **GATT yolu hiç yazılmamıştı**.
- **Durum:** GATT transport eklendi (commit `04d0ef2`/`770be7f`). **Gerçek araçta DOĞRULANMADI** (Bölüm 5).

### 2.3 Responsive Faz 1
- Tamamlandı. (Layout responsive iyileştirmeleri.)

### 2.4 Vosk JNA / Proguard keep rule
- **Sorun:** Release build Vosk + JNA sınıflarını strip ediyordu → sesli asistan prod'da ölü.
- **Durum:** Keep rule eklendi (commit `ca0f345`). **Release APK'da DOĞRULANMADI** (Bölüm 5).

### 2.5 CAN bus köprüleme (K24/Hiworld)
- Root olmadığı için ham seri çalışmaz; tek yol **K24CanBridge** — wire edildi. `CanAdapter.ts` pre-allocated, zero-allocation, monomorphic — **darboğaz DEĞİL, dokunma.**

### 2.6 Performans Faz 3 — `useSABDirectUpdate.ts` fallback guard ⭐ (en son iş)
- **Ne yapıldı:** SAB devre dışı olduğundan tüm gauge'lar Zustand fallback yolundan geçiyor ve guard olmadığı için değer değişmese de her gauge 60fps DOM mutasyonu yapıyordu. SAB yolundaki generation-guard'ın **B+C eşdeğeri** fallback'e taşındı.
- **Tasarım (B+C):**
  - **B (sequence):** `useUnifiedVehicleStore.subscribe` callback'i `_fallbackSeq++` yapar (`useSABDirectUpdate.ts:89-92`). Tick, `_fallbackSeq === _lastFallbackSeq` ile "yeni veri var mı?" sorusunu O(1) cevaplar.
  - **C (donma önleme):** Guard **yalnızca iki koşul birden** sağlanınca durur: `seqUnchanged && Math.abs(raw - smoothed) < SNAP_EŞİK` (`:131-138`). Biri sağlanmazsa EMA çalışmaya devam → ibre donmaz.
- **SNAP eşikleri** (`:38-43`): SPEED `0.5` km/h (rafSmoother snap ile hizalı), RPM `3` (0-8000 ölçeği), FUEL/diğer `0.1`.
- **Değişen satır aralıkları:** `30-52` (sabitler + `_snapThreshold`), `82-94` (sequence + subscribe), `120-139` (guard mantığı). **SAB yolu (107-119) ve ortak işlem bloğu (142-145) DEĞİŞTİRİLMEDİ.**
- **İlk tick muafiyeti:** `_lastFallbackSeq=-1 ≠ _fallbackSeq=0` → ilk emit garantili; mount ilk karesi (`:96-100`) korundu.
- **Doğrulama:** build/test/lint temiz. **Cihazda ölçülmedi** (Bölüm 5).
- ⚠️ **ÖNEMLİ — yarım kalan kısım:** Guard, boştayken `onFrame`/DOM-write'ı atlıyor AMA RAF döngüsü hâlâ 60fps yeniden planlanıyor (`:136-137, 147`). Yani **60fps wakeup maliyeti sürüyor** — termal/baseline CPU sorununun gauge kısmı henüz açık. Bunun çözümü "Faz 3.5" (Bölüm 6.1).

---

## 3. Doğrulanmış Kök Nedenler (kanıtlı)

### 3.1 Head unit'te `crossOriginIsolated = false` → SAB tamamen devre dışı
**Bu projenin en önemli performans gerçeği.** Kanıt zinciri:

1. **SAB iki koşula bağlı (AND):** `VehicleSignalResolver.ts:99-101`
   ```
   const sabSupported =
     typeof SharedArrayBuffer !== 'undefined' &&
     self.crossOriginIsolated === true;
   ```
2. **COOP/COEP header'ları head unit'te YOK:**
   - `vite.config.ts:105` → `const _coopCoepHeaders = {};` (BİLEREK boşaltılmış — YouTube iframe COEP çakışması yüzünden, `:95-104` yorumunda belgeli).
   - `capacitor.config.ts:10` `webDir:'dist'`, `:20-22` androidScheme — header injection yok; APK `https://localhost`'tan serve eder.
   - `android/` Java tarafında `shouldInterceptRequest`/`addHeader` **hiç yok** (grep: no matches).
   - `vercel.json:8-16` COOP/COEP **VAR ama yalnızca web dağıtımı (carospro.com) için** — APK bunu kullanmaz.
   - `vite.config.ts:100-101` yorumu zaten itiraf ediyor: *"APK zaten COEP göndermiyor (orada crossOriginIsolated=false, SAB → fallback)."*
3. **Sonuç:** `sabSupported=false` → `INIT_FALLBACK` (`VehicleSignalResolver.ts:112`) → worker `_sabEnabled=false` (`VehicleCompute.worker.ts:1065`) → `sabChannel.f64/i32=null` → tüm gauge'lar `useSABDirectUpdate.ts` else dalından geçer.

**Yargı kod akışıyla kesin — cihaz log'una gerek yok.** İstenirse tek satır teyit: head unit WebView konsolunda `console.log(self.crossOriginIsolated)` → `false` bekleniyor.

### 3.2 Fallback generation-guard eksikliği → DÜZELTİLDİ (Faz 3, Bölüm 2.6)

### 3.3 Worker emit ↔ RAF frekans uyumsuzluğu
- `VehicleCompute.worker.ts:62` `SPEED_INTERVAL_MS=300` → hız/RPM **3.33 Hz**.
- `:63` `FUEL_INTERVAL_MS=8000` → yakıt **0.125 Hz**.
- RAF fallback **~60 Hz** → frame'lerin ~%94.5'i aynı değer üzerinde tekrar işliyordu (Faz 3 bunu kesti).

---

## 4. Açık Riskler

| Risk | Açıklama | Şiddet |
|------|----------|--------|
| Cihaz doğrulaması yok | Tamamlanan işlerin çoğu CI'da yeşil ama gerçek head unit'te test edilmedi | **Yüksek** |
| Faz 3 görsel regresyon | Guard yanlış eşikle ibreyi hedefe oturmadan dondurabilir — gözle teyit şart | Orta |
| RAF 60fps wakeup sürüyor | Faz 3 DOM-write'ı kesti, wakeup'ı kesmedi → termal sorun gauge'larda kısmen açık | Orta |
| Vosk release-only kırılma | Keep rule debug'da görünmez; yanlışsa yalnızca prod APK'da ses ölür | Orta-Yüksek |
| BLE OBD donanım belirsizliği | GATT yolu yazıldı ama BLE-only adaptörle gerçek araçta hiç bağlanmadı | Yüksek |
| Çoklu MapLibre WebGL context | Mali-400'de context destroy/create çok pahalı; layout geçişlerinde donma riski | Orta |
| 566 setInterval | Boşta baseline CPU wakeup → "parkta cihaz ısınıyor" şikayeti kaynağı olabilir | Orta |

---

## 5. Bekleyen Saha Testleri (cihaz/araç gerektirir)

1. **`crossOriginIsolated` cihaz teyidi** — 1 satır log, remote debug. Faz 1-3 zincirini kesinleştirir. (~dakikalar)
2. **Faz 3 performans cihaz testi** — Chrome remote debug → Performance tab. Park/rölantide DOM-write'ın ~60fps→~0 düştüğü ölçülmeli. (~30 dk)
3. **BLE OBD gerçek araç testi** — BLE-only adaptör + araç; GATT yolu telemetri akıtıyor mu? (~yarım gün)
4. **Vosk release APK testi** — imzalı APK build + sesli komut denemesi; keep rule prod'da çalışıyor mu? (~1-2 saat)
5. **Arabam Cebimde eşleşme testi** — entegrasyon/bağlanırlık doğrulaması. (~1 saat)

---

## 6. Bekleyen Teknik İşler (ROI sırasıyla)

### 6.1 Faz 3.5 — RAF idle-stop (EN YÜKSEK ROI dev işi, aynı dosya)
- **Ne:** `useSABDirectUpdate.ts` fallback'inde guard "settled" verince `cancelAnimationFrame` yap; subscribe callback'i (yeni veri) RAF'ı yeniden başlatsın.
- **Neden:** Faz 3'ün bıraktığı 60fps wakeup yarısını kapatır → Madde #9 termal sorununun gauge kısmını çözer.
- **Risk:** Düşük (tek dosya, event-driven SAB felsefesiyle uyumlu). **Efor:** ~2-3 saat.

### 6.2 Heading quantize (Madde #5 / #10)
- **Ne:** `gpsService.ts` `_blendHeading` çıktısını 2-5°'ye yuvarla.
- **Neden:** Heading mikro-değişimi `useGPSHeading` (`gpsService.ts:542`) tüketicilerini (MiniMap `MiniMapWidget.tsx:68`) gereksiz re-render ettiriyor; `MiniMapWidget.tsx:249-285` location/heading effect'i her fix'te `setDrivingView`→easeTo tetikliyor.
- **Risk:** Düşük. **Efor:** ~1-2 saat.

### 6.3 `useFusedSpeed` ikiye bölme (Madde #3)
- **Ne:** `speedFusion.ts:367,389` `setDisplaySpeed` her lerp frame'inde state günceller → tüketen her bileşen (PremiumSpeedometer, MiniMap, NavigationHUD) 60fps re-render. Metadata (`source/warning`) ile display-value'yu ayır.
- **Risk:** Orta. **Efor:** ~yarım gün.

### 6.4 MiniMap kamera coalesce (Madde #10)
- **Ne:** `MiniMapWidget.tsx` easeTo'yu rAF/eşikle topla; zombie guard interval'ini (`:210`, 30s) 60-120s'ye çıkar.
- **Risk:** Orta. **Efor:** ~3-4 saat.

### 6.5 Interval konsolidasyonu (Madde #9)
- **Ne:** 566 timer'ı tek master tick'te topla; park/idle'da UI watchdog'larını uzat/durdur.
- **Risk:** Orta-Yüksek. **Efor:** ~1 gün.

> **NOT — darboğaz OLMAYAN, dokunma:** `VehicleCompute.worker.ts` (zero-alloc, SAB seqlock, 3Hz emit), `safeStorage.ts`, store dirty-guard (`UnifiedVehicleStore.ts:176-205`), `CanAdapter.ts`. Bunlar örnek alınacak kalitede optimize.

---

## 7. Yapılmaması Gereken İşler (şimdilik)

1. **COOP/COEP açıp APK'da SAB etkinleştirme.** Cazip (kök fix) ama YouTube iframe çakışması yüzünden bilerek kapalı (`vite.config.ts:95-104`). Faz 3 fallback'i yeni teslim edildi — destabilize etme. Önce fallback'in cihazda yeterli olup olmadığını ÖLÇ.
2. **Merkezi RAF scheduler büyük refactor'ü (orijinal Madde #1).** Faz 3 + 3.5 en kötü maliyeti yakalar; çok-dosya scheduler refactor'ü AI.md "no multi-system refactor"a ters.
3. **Layout geniş-abonelik refactor'ü (Madde #6).** Çok dosya, riskli, ölçülmüş darboğaz değil — önce profiling kanıtı.
4. **Yeni özellik geliştirme.** Stabilizasyon fazı; yarım doğrulamalar varken yeni yüzey açma.
5. **SAB yoluna dokunma** (`useSABDirectUpdate.ts:107-119`). Cihazda `crossOriginIsolated=true` olursa o yol çalışır; regresyon riski.

---

## 8. Sonraki Agent'in İlk Yapacağı Görev

**Cihaz doğrulama oturumu (İş #5.1 + #5.2 + opsiyonel Faz 3.5 — tek remote-debug oturumu):**

1. Head unit WebView'ı Chrome remote debug'a bağla.
2. `self.crossOriginIsolated` değerini logla — `false` teyidi (Bölüm 3.1'i kesinleştirir).
3. Performance tab ile park/rölanti + sabit hız senaryolarında gauge DOM-write frekansını ölç — Faz 3 kazancını (60fps→~0) doğrula.
4. RAF wakece'ları hâlâ baskınsa, oturumdayken **Faz 3.5 idle-stop**'u (Bölüm 6.1) ekle ve tekrar ölç.

**Neden ilk:** Tüm Faz 1-3 çalışması bu ölçüm olmadan varsayım üzerine kurulu. Maliyeti ~sıfır, ya güveni kilitler ya da regresyonu yakalar.

---

## 9. Sonraki Agent'in Dikkat Etmesi Gereken Tuzaklar

1. **"SAB var" sanma.** Kod SAB mimarisi içeriyor ama head unit'te `crossOriginIsolated=false` olduğu için **hiç kurulmuyor**. Performansı fallback yolu (`useSABDirectUpdate.ts` else dalı) belirliyor.
2. **`master` vs `main`.** CLAUDE.md `master` diyor, git gerçekte `main` kullanıyor. PR base'ini doğrula.
3. **Faz 3'ü tekrar yapma.** Fallback guard zaten eklendi (Bölüm 2.6). Eksik olan yalnızca RAF idle-stop (Faz 3.5).
4. **SNAP eşikleri ölçek-duyarlı.** SPEED için 0.5 km/h uygun ama RPM (0-8000) için 0.5 anlamsız — RPM eşiği 3. Yeni gauge eklenirse `_snapThreshold` (`useSABDirectUpdate.ts:46-52`) güncellenmeli.
5. **Worker emit ham/display ayrımı.** Worker'da `_emitSpeed` GPS için EMA/debounce uygular ama odometre/event ham hızı kullanır (`VehicleCompute.worker.ts:868-913`). Gösterim ile mesafe/olay mantığını karıştırma.
6. **MapLibre singleton.** `MapCore.ts:142-146` tek instance'a zorlar; MiniMap↔FullMap geçişinde destroy/re-init pahalı (`_freeContext` `:40`). Layout geçişlerinde haritayı destroy etmeden taşımayı tercih et.
7. **Zustand selector tuzağı (React 19 #185).** Inline obje selector her render yeni ref döndürür → sonsuz re-render. `gpsService.ts:549` yorumunda bu hata belgeli — tek primitif seç veya `useShallow`.
8. **Onay isteme.** CLAUDE.md: hiçbir işlem için onay sorulmaz, doğrudan yapılır. Ama **outward-facing / geri alınamaz** işlemlerde (commit/push, dış servise veri) genel ilke geçerli.
9. **Lisans.** Yeni bağımlılık/model/font eklerken permissive (MIT/Apache/BSD/OFL) olmalı; GPL/AGPL/NC yasak (ticari satış).
10. **Türkçe yanıt zorunlu.**

---

## 10. Kısa Teknik Özet

> CarOS Pro head unit'inde **SharedArrayBuffer devre dışı** (`crossOriginIsolated=false`, çünkü COOP/COEP YouTube iframe uyumu için bilerek kapalı — `vite.config.ts:105`). Bu yüzden tüm gauge'lar `useSABDirectUpdate.ts` **Zustand fallback** yolundan geçer. Bu yol guard'sızdı ve değer değişmese de gauge başına **60fps DOM mutasyonu** yapıyordu. **Faz 3** bunu SAB'deki generation-guard'ın **B+C eşdeğeriyle** çözdü (sequence sayacı + EMA-settled şartı; `useSABDirectUpdate.ts:30-52, 82-94, 120-139`). Park/rölantide DOM-write ~%100, sabit hızda ~%97 düşmesi bekleniyor. **Eksik:** RAF döngüsü hâlâ 60fps uyanıyor → **Faz 3.5 idle-stop** (aynı dosya, düşük risk) sıradaki en yüksek ROI iş. SAB'i açma (COOP/COEP) ve büyük scheduler/layout refactor'leri **profiling kanıtı gelene kadar yapma**. İlk görev: **cihaz doğrulama oturumu** (crossOriginIsolated log + Faz 3 Perf ölçümü). Worker/store/CanAdapter optimize, dokunma. Build/Test/Lint yeşil; branch `feature/ble-obd-support`; PR base gerçekte `main`.

---

*Bu doküman statik kod analizine + bu oturumdaki doğrulamalara dayanır. Görsel/zamanlama davranışları (ibre akıcılığı, idle DOM-write) yalnızca cihaz-üstü ölçümle kesinleşir.*
