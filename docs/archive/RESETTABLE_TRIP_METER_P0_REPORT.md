# RESETLENEBİLİR YOL SAYACI — P0 RAPORU

**Tarih:** 2026-08-02
**Dal:** `feat/fleet-offline-final-local-completion`
**Commit / push / deploy:** YAPILMADI (görev gereği).

---

## 1 · Eski alanın GERÇEK kaynağı (ön analiz)

Ekrandaki `293 km MENZİL` + altındaki `0 km KİLOMETRE` kartı **tek bir panelde iki
ayrı okumadır** ve her temada ayrı ayrı yazılmıştır:

| Tema | Bileşen | Eski alt satır | Beslediği kaynak |
|------|---------|----------------|------------------|
| Expedition (**varsayılan**, `useCarTheme.ts:128`) | `RangePlate` | `<Label>Kilometre</Label>` | `useUnifiedVehicleStore(s => s.odometer)` |
| Horizon | `HzRangeCard` | `<HzLabel>Kilometre</HzLabel>` | aynı |
| Tesla | `FuelCard` | `KİLOMETRE` | aynı |
| Pro | `VehicleCard` (dar stat kolonu) | `label="Kilometre"` | aynı |

**Sabit 0 mıydı?** Hayır — sahte sabit değildi, `Math.round(odometer)` idi.
Ama `odometer` **kümülatif GPS odometresidir** ve temiz kurulumda 0'dan başlar,
**sıfırlanamaz**, kullanıcıya hiçbir karar vermez → pratikte kalıcı `0 km`
görünüyordu. Yani alan "çalışmıyor" değil, **anlamsızdı**.

**Trip Engine / `tripLogService` ile bağı:** YOKTU. Trip motoru kendi
`liveDistanceKm`'ini tutar (trip başına), odometre ise ayrı kümülatif sayaçtır.

**Mevcut güvenilir mesafe otoriteleri (envanter):**

| Otorite | Nerede | Kapsam |
|---------|--------|--------|
| `useUnifiedVehicleStore.odometer` | vehicleDataLayer | **kümülatif**, GPS haversine + OdometerGuard, monotonik, persist |
| `tripLogService` trip mesafesi | `platform/tripLogService.ts` | **trip başına**, trip bitince kapanır |
| `OdometryLedger` (`longRoadModel`) | `platform/fieldValidation/` | **saha testi oturumu başına** |

Seçilen: **`useUnifiedVehicleStore.odometer`** — tek kümülatif, sürekli,
monotonluk korumalı ve kalıcı olan tek kaynak. Diğer ikisi oturum/trip
sınırlarında sıfırlanır, kullanıcı sayacına taban olamaz.

---

## 2 · Kullanılan mesafe otoritesi

**Yeni mesafe motoru YAZILMADI.** Yol sayacı bir hesap değil bir **fark**tır:

```
distanceKm += max(0, odometer_now − odometer_last)
```

Paralel haversine / Euler entegrasyonu / OBD hız entegrasyonu **yoktur**.
Servis `odometer`e tek bir Zustand aboneliği kurar ve yalnız deltayı işler.

---

## 3 · Yeni dosyalar

| Dosya | Rol |
|-------|-----|
| `src/platform/trip/tripMeterModel.ts` | **SAF** model: `advanceTripMeter` · `resetTripMeter` · `parseTripMeter` · `canResetTripMeter` · `formatTripMeterKm` · `tripMeterGateSpeed`. I/O · timer · `Date.now()` · React importu YOK; zaman daima parametre. |
| `src/platform/trip/tripMeterService.ts` | Runtime: kalıcılık + TEK abonelik + reset otoritesi. |
| `src/hooks/useTripMeter.ts` | React köprüsü (snapshot → state, `mountedRef` + cleanup). |
| `src/components/trip/tripMeterUiState.ts` | **SAF** UI faz makinesi (`idle` ↔ `confirm`). |
| `src/components/trip/TripMeterRow.tsx` | Tema-agnostik satır; palet PROPS ile girer, renk GÖMÜLMEZ. |
| `src/__tests__/tripMeter.test.ts` | 34 kilit. |
| `docs/RESETTABLE_TRIP_METER_P0_REPORT.md` | bu rapor. |

## 4 · Değişen dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `src/components/themes/ExpeditionLayout.tsx` | `RangePlate`: "Kilometre" odometre satırı → `<TripMeterRow>` |
| `src/components/themes/HorizonLayout.tsx` | `HzRangeCard`: aynı |
| `src/components/themes/TeslaLayout.tsx` | `FuelCard`: aynı |
| `src/components/themes/ProLayout.tsx` | `VehicleCard`: dar kolondaki "Kilometre" stat'ı kaldırıldı, `<TripMeterRow>` toggles üstünde tam genişlikte |
| `src/hooks/useLayoutServices.ts` | `startTripMeter()` / `stopTripMeter()` (önceki oturumda eklenmişti) |
| `src/components/devtools/screens/TripEngineScreen.tsx` | LAB salt-okunur "User Trip Meter (resettable)" bölümü |
| `docs/DEVICE_VALIDATION_LEDGER.md` | 🔴 kütük maddesi #323 |
| `docs/CAROS_PRO_VIZYONU.md` | özellik durumu |

---

## 5 · Kalıcılık

- Anahtar `caros-trip-meter-v1`, `safeStorage` üzerinden (`safeGetRaw`/`safeSetRaw`/`safeFlushKey`).
- `persistenceVersion = 1`; sürüm uyuşmazsa kayıt **fail-closed** reddedilir.
- **Yazma throttle:** normal ilerlemede en fazla 10 sn'de bir (eMMC ömrü, CLAUDE.md §3).
  **Tam km sınırı geçilince** ve **reset'te** anında `safeFlushKey` ile mühürlenir.
- `stopTripMeter()` son değeri mühürler → uygulama kapanışında kayıp yok.
- **Restore güvenliği:** kayıt geri yüklendiğinde `baselineOdometerKm` `null`'dır;
  ilk geçerli odometre okuması yalnız **tohumlar**, `distanceKm`'i ARTIRMAZ.
  Bu, "restart sonrası eski mesafeyi tekrar ekleme" tuzağını yapısal olarak kapatır.
- **Bozuk kayıt:** `parseTripMeter` kısmi kurtarma YAPMAZ — boş sayaç + `CORRUPT`.
- **Reset atomiktir:** tek `resetTripMeter()` çağrısı yeni kaydı üretir, ardından
  tek `_persist(true)`. Ara durum diske yazılmaz.

---

## 6 · Güvenlik kapısı

`canResetTripMeter(speedKmh)` — **fail-closed**:

| Hız | Sonuç |
|-----|-------|
| `0` (kesin park) | `{ allowed: true, reason: 'PARKED' }` |
| `> 0` | `{ allowed: false, reason: 'MOVING' }` |
| `null` / `NaN` / sonsuz | `{ allowed: false, reason: 'SPEED_UNKNOWN' }` |

- Kapı **iki yerde** danışılır ama otorite TEKTİR: UI'da buton görünümü için,
  `requestTripMeterReset()` içinde ise **gerçek karar** için. UI atlansa bile
  servis reddeder ve **storage'a hiçbir şey yazmaz** (testle kilitli).
- Sürüş sırasında **popup/modal AÇILMAZ**. Buton pasif + pasif bilgi metni:
  *"Aracı durdurunca sıfırlayabilirsiniz."*
- Onay satırı açıkken araç hareket etmeye başlarsa satır **kendiliğinden kapanır**,
  reset YAPILMAZ.
- Dokunma alanı `minWidth/minHeight: 44px`; ikon tek başına değil, **"Sıfırla"**
  metniyle birlikte.

**Reset kapsamı (silinmeyenler):** `tripLogService` geçmişi · `odometer` store'u ·
long road oturumu · Fleet kayıtları. Test bunu `setState` / `clearAllTrips` /
`deleteTrip` spy'larıyla kanıtlar.

---

## 7 · UI yerleşimi

Mevcut kart korundu, **yeni panel açılmadı**:

```
  ⛽  293  km                     MENZİL
  ▓▓▓▓▓▓▓░░░
  ────────────────────────────────────────
  ⏱  128,4  km                YOL SAYACI
  [ ↻ Sıfırla ]
```

Onay (araç dururken, kart İÇİNDE satır içi):

```
  Yol sayacı sıfırlansın mı?     [ VAZGEÇ ] [ SIFIRLA ]
```

- Etiket "Kilometre" → **"Yol Sayacı"** (dört temada da).
- Biçim tr-TR, **tam 1 ondalık**: `128,4 km` · `1.248,6 km`. `Intl` bulunmayan
  eski WebView'ler için manuel binlik-nokta/ondalık-virgül fallback'i var.
- Mesafe okunamıyorsa (`state !== READY`) **`— km`** — sahte 0 YOK.
- Palet her temadan `palette` prop'u ile girer; bileşende sabit renk yoktur.

---

## 8 · Test modu (Otomatik Saha Testi) ayrımı

- Saha testi yol sayacını **sahiplenmez** ve başlarken **sıfırlamaz**
  (`longRoadRecorder` içinde tek bir `tripMeter` importu/çağrısı yok — testle kilitli).
- Yol sayacı da saha testine yazmaz (`tripMeterService` import grafiğinde
  `longRoad`/`fieldValidation`/`tripLogService` YOK — testle kilitli).
- LAB'da **salt-okunur** karşılaştırma: `userTripMeterKm` · `fieldSessionDistanceKm`
  · `differenceKm`.
- **Fark otomatik hüküm üretmez.** İki ayrı otorite farklı anlarda başlar; hangisinin
  doğru olduğu ilan EDİLMEZ. İki taraftan biri okunamıyorsa fark `UNAVAILABLE`
  (sahte 0 türetilmez).

---

## 9 · CAROS LAB

**CAROS LAB → Vehicle → Trip Engine → `User Trip Meter (resettable) · read-only`**

Alanlar: `userTripMeterKm` · `meterState` · `distanceSource` · `confidence` ·
`startedAt` (yaş) · `lastUpdatedAt` (yaş) · `resetCount` · `lastPersistedAt` (yaş) ·
`restoreState` · `persistenceVersion` · `fieldSessionDistanceKm` · `differenceKm`.

Kurallar: **sıfırlama/başlatma butonu YOK** (testle kilitli) · açılışta tek okuma +
elle YENİLE (timer/abonelik yok) · her okuma ayrı `try/catch` · mutlak zaman damgası
yerine **yaş** · bilinmeyen alan `UNAVAILABLE`.

---

## 10 · Test sonuçları

`src/__tests__/tripMeter.test.ts` — **34/34 yeşil**:

| # | Senaryo | Durum |
|---|---------|-------|
| 1 | gerçek mesafe artışı (10 → 12,5 → 18 = 8,0 km) | ✅ |
| 2 | uygulama restartı → aynı `distanceKm` (3,4) | ✅ |
| 3 | process restore → ilk okuma yalnız tohumlar, artırmaz | ✅ |
| 4 | duplicate trip replay → mesafe iki katına çıkmaz | ✅ |
| 5 | GPS jump / odometre gerilemesi → negatif eklenmez, `confidence: MEDIUM` | ✅ |
| 6 | stale / `UNKNOWN` (`null`/`NaN`/negatif) → kayıt değişmez, 0 yazılmaz | ✅ |
| 7 | park hâlinde (delta 0) mesafe artmaz | ✅ |
| 8 | parked reset → `distanceKm=0`, `resetCount+1`, `meterId` aynı | ✅ |
| 9 | moving reset **engellenir** + storage'a yazılmaz | ✅ |
| 10 | unknown-speed reset **engellenir** (fail-closed) | ✅ |
| 11 | reset yalnız sayacı temizler — trip geçmişi/odometre/store dokunulmaz | ✅ |
| 12 | bozuk kayıt → `CORRUPT`, çökme yok, kısmi kurtarma yok | ✅ |
| 13 | sayı biçimi `128,4` / `1.248,6` / `—` | ✅ |
| 14 | `tripMeterGateSpeed` kapı hükmünü değiştirmez (render azaltma güvenli) | ✅ |
| 15 | UI faz: bas→onay, VAZGEÇ, SIFIRLA | ✅ |
| 16 | UI faz: hareket / hız bilinmiyor → onay AÇILMAZ | ✅ |
| 17 | UI faz: onay açıkken hareket başlarsa kendiliğinden kapanır | ✅ |
| 18 | **mount kanıtı:** 4 temada `TripMeterRow` import + JSX | ✅ |
| 19 | 4 temada eski "Kilometre" etiketi kalmadı | ✅ |
| 20 | servis boot'ta başlatılıyor + unmount'ta durduruluyor (zero-leak) | ✅ |
| 21 | bileşen ham `speed`e abone olmaz (render bütçesi) | ✅ |
| 22 | bileşen modal/popup/`window.confirm` kullanmaz | ✅ |
| 23 | saha testi kaydedicisi yol sayacına dokunmaz | ✅ |
| 24 | yol sayacı saha testine/trip geçmişine/odometre store'una yazmaz | ✅ |
| 25 | LAB ekranı salt-okunur (reset/başlat çağrısı yok) | ✅ |

**Regresyon:**

| Kontrol | Sonuç |
|---------|-------|
| Tam birim/entegrasyon suite (`npm run test`) | **10126 / 10127 yeşil** (461 dosya) |
| `regression.guards.test.ts` | 162/163 — düşen tek test **ÖNCEDEN VARDI** (aşağıya bak) |
| `tripEngine.test.ts` · `carosLabTripEngine.test.ts` · `longRoadFieldValidation.test.ts` | ✅ |
| `tsc -b` | ✅ temiz |
| `eslint` (dokunulan tüm dosyalar) | ✅ 0 hata / 0 uyarı |

**Dürüstlük notu — düşen tek test bu turun değildir.** `regression.guards.test.ts >
K24 CAN-flood > _hasAnyField` testi 5000 ms'de zaman aşımına uğruyor
(`await import('../platform/vehicleDataLayer/...')` satırında). Bu turun **tüm
dosyaları `git stash` ile geri alınıp aynı test yeniden koşuldu → AYNI ŞEKİLDE
DÜŞTÜ** (162/163). Yani hata mevcut/önceden var olan bir sorundur, bu çalışmanın
sonucu değildir. Sahiplenilmedi, dokunulmadı — **açık borç olarak kaydedildi**.

---

## 11 · Açık borçlar

1. **🔴 Saha doğrulaması yapılmadı.** Kütük maddesi **#323**, 13 ölçülebilir kabul
   ölçütüyle (a–m) eklendi. **Bu özellik "çalışıyor" olarak sunulamaz.**
2. **`regression.guards` K24 `_hasAnyField` timeout'u** — bu turun dışında,
   önceden var, sahibi belirsiz. Kapatılması ayrı bir atomik iş.
3. **ProLayout yerleşim kararı gözle doğrulanmadı:** dar 88px stat kolonuna sıfırla
   butonu sığmadığı için satır kartın alt kısmına, toggles üstüne tam genişlikte
   alındı. Gerçek cihazda dikey sığma (özellikle küçük/uzun ekranlarda)
   **ölçülmedi** — kabul ölçütü (m) bunu kapsıyor.
4. **Ham odometre artık ana ekranda hiçbir temada görünmüyor.** Bilinçli karar
   (kullanıcı bu alanı "anlamsız" olarak tanımladı); ham kümülatif değere ihtiyaç
   olursa CAROS LAB üzerinden ayrı bir salt-okunur alan açılmalı — bugün yok.
5. **E2E (Playwright) senaryosu yazılmadı.** Reset onay akışı yalnız saf faz
   makinesi düzeyinde kilitli; gerçek DOM etkileşimi test edilmedi (bu proje
   `@testing-library/react` kullanmıyor, jsdom'da `createRoot` çalışmıyor).

---

## 12 · NİHAİ KARAR

### `RESETTABLE_TRIP_METER_P0_COMPLETE_LOCAL`

Görevin 10 bölümünün tamamı yerel olarak uygulandı ve kanıtlandı: gerçek mesafe
otoritesi kullanıldı (yeni motor yok), kalıcılık ve fail-closed reset kapısı
testlerle kilitlendi, bileşen dört temada da **gerçekten mount edildi**, LAB
gözlem yüzeyi salt-okunur açıldı, test modu ayrımı korundu, `tsc`/lint/suite
temiz.

**"COMPLETE_LOCAL" — "SAHADA DOĞRULANDI" DEĞİLDİR.** Kütük #323 🔴'dir; gerçek
araçta (b), (c), (g) ve (j) ölçütleri gözlenmeden bu özellik tamamlanmış
sayılmaz.
