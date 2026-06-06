# ARCHITECTURE — Veri Akışı Haritası (CarOS Pro)

> NOT: Bu repoda zaten `ARCHITECTURE.md` var (üst-düzey "Sistem Manifestosu" — vizyon
> ve standartlar). O dosyaya DOKUNULMADI. Bu dosya onu tamamlar: **somut veri akışları
> ve kod tabanından doğrulanmış referanslar**. Üst-düzey vizyon için `ARCHITECTURE.md`.
> Son güncelleme: 2026-06-06.

---

## 1. Hız / Araç Sinyali Veri Akışı (SAB tabanlı)

```
Native (CAN/OBD)
   │
   ▼
VehicleCompute.worker.ts          ← hesaplama worker'ı (tek yazar)
   │  (Seqlock yazımı, GEN +2/yazım)
   ▼
SharedArrayBuffer (sabChannel.ts) ← cache-line padded, 512 byte
   │  Float64[0]=speed, [8]=rpm, [16]=fuel, [24]=odo, [32]=reverse
   │  Int32[96]=generation counter (ayrı cache line)
   ▼
VehicleSignalResolver             ← SAB polling 50ms/20Hz + Seqlock double-check
   │  → useUnifiedVehicleStore (Zustand) yazar
   ▼
AKTİF gauge bileşenleri (SpeedCard vb.) ← useUnifiedVehicleStore / useOBDState
                                          (teyit: NewHomeLayout SpeedCard)
```

> **DÜZELTME (2026-06-06, ölü-kod analizi):** Önceki sürüm bu akışı `useSABDirectUpdate.ts`
> → gauge olarak gösteriyordu — bu **YANLIŞ**. Knip + Grep doğrulaması: `useSABDirectUpdate.ts`
> **ÖLÜ** (yalnızca ölü `PremiumSpeedometer.tsx` import ediyor; aktif `MiniMapWidget` onu sadece
> yorumda anıyor). Aktif hız/RPM akışı **Zustand** (`useUnifiedVehicleStore`) üzerinden yürüyor;
> `VehicleSignalResolver` SAB'ı okuyup store'a yazar, gauge'lar store'a abone olur. SAB altyapısı
> (worker, sabChannel, Seqlock) CANLI; ölü olan yalnızca `useSABDirectUpdate` tüketim hook'u.

- **Seqlock:** GEN tek = yazım sürüyor, çift = bitti; okuyucu baş/son GEN karşılaştırıp
  Torn Read tespit eder (teyit: sabChannel.ts:18-19; aktif okuyucu VehicleSignalResolver.
  Not: `useSABDirectUpdate.ts:108` de aynı guard'a sahip ama o dosya ÖLÜ — yukarıdaki düzeltme).
- **Cache-line padding:** Her 64-bit değer ayrı 64-byte cache line'da → False Sharing yok
  (teyit: sabChannel.ts:7-16).
- **SAB index'leri:** `SAB_IDX = { SPEED:0, RPM:8, FUEL:16, ODO:24, REVERSE:32 }`
  (sabChannel.ts:22-28), GEN index 96 (sabChannel.ts:30), SAB_BYTES=512.
- **VehicleSignalResolver** SAB polling'i 50ms/20Hz throttle ile yapar
  (VehicleSignalResolver.ts:206-220) → Faz 2'de 10/5Hz hedefi.

---

## 2. OBD / BLE Mimarisi

- **İki transport, paylaşılan protokol:**
  - `OBDManager.java` — Classic Bluetooth (RFCOMM stream).
  - `BleObdManager.java` — BLE GATT (notify/write characteristic). RFCOMM stream'leri
    transport-agnostik kanala sarmalanır; protokol mantığı paylaşılır
    (BleObdManager.java başlık; OBDManager.java:176).
- **Transport seçimi (obdService.ts:109-126):** Son taşıma ('classic'|'ble') MAC ile
  persist. Bonded DUAL cihaz 'classic' görünebildiğinden seçim TAHMİN → fallback
  timeout buna göre (doğrulanmış yol kısa bekleme; tahmin tam timeout, yoksa BLE yolu
  açlığa uğrar).
- **GATT bağlantı:** `connectGatt(autoConnect=false, TRANSPORT_LE)`, GATT 133 için 2
  deneme retry (BleObdManager.java:151-164).
- **Protokol cycle (ELM327 ATSP):** `[undefined,'6','5','4','3','7']` = otomatik / CAN
  11-500 / KWP hızlı / KWP 5-baud / ISO9141-2 / CAN 29-500; reconnect denemesine göre
  döndürülür (obdService.ts:606-609).
- **Mock:** `MOCK_ENABLED = import.meta.env['VITE_ENABLE_OBD_MOCK'] === 'true'`
  (obdService.ts:747). Tek giriş `_merge()` (obdService.ts:183).

---

## 3. Navigasyon / Dead Reckoning Durumu

- **HUD kanonik hız:** NavigationHUD/navigationService araç hızını
  `useUnifiedVehicleStore`'dan alır (navigationService.ts:476-477, 536, 554; commit 99abf60).
- **ETA hysteresis:** 30 sn rolling speed window + hysteresis → UI titreme engellenir
  (navigationService.ts:335-342).
- **Dead Reckoning / tünel modu:** gpsService.ts + VehicleCompute.worker.ts içinde DR
  referansları var; DR saf matematik testi mevcut (commit 457777d). **Belirsiz:** tünel
  modu / DR'nin navigasyonla uçtan uca entegrasyonu bu oturumda izlenmedi — derinleşmeden
  önce gpsService.ts + VehicleCompute.worker.ts okunmalı.

---

## 4. Performans Mimarisi (Adaptive Runtime)

- **AdaptiveRuntimeManager.ts** runtime config'e göre CSS değişkeni yazar:
  `--rt-blur: 0|1` (Mali-400 GPU guard, satır 325), `--rt-anim`; cleanup'ta kaldırır
  (satır 649).
- **`--rt-blur` tüketicileri:** index.css:633, theme.css:175 (.up-blob 60px),
  volume-overlays.css, ultra-premium-global.css — hepsi `blur(calc(var(--rt-blur,1)*Npx))`.
- **DeviceTier / deviceCapabilities:** Donanım tespiti tek katmanda birleşik; zayıf GPU
  tespiti `detectWeakGpu.ts` (satır 9) → AdaptiveRuntimeManager fps/polling tavanı + blur
  guard'ını ayarlar.
- **DOM guard:** MainLayout ambient blob `blurEnabled` ile koşullu render → low-end'de 3
  kalıcı will-change compositor layer DOM'dan kalkar (MainLayout.tsx:375).

---

## 5. Launcher Mimarisi

- AndroidManifest MainActivity: `MAIN + LAUNCHER + HOME + DEFAULT`
  (AndroidManifest.xml:71-76); singleTask, sensorLandscape, immersive.
- `BootReceiver` (BOOT_COMPLETED + LOCKED_BOOT_COMPLETED + QUICKBOOT_POWERON, priority
  1000) açılışta başlatır (AndroidManifest.xml:98-110). Ek kod gerekmez.

---

## 6. YouTube / Medya Mimarisi (Piped)

- **pipedProvider.ts** YouTube proxy. INSTANCES'ta tek canlı instance:
  `https://api.piped.private.coffee` (satır 22-23); sticky instance mekanizması (43-44).
- **Mimari risk:** Tek nokta arıza — instance düşerse YouTube arama/stream çalışmaz.
- **YouTube gömülü oynatma REVERT:** carosMediaLayer.ts içinde `_playYouTubeLight` yok,
  yalnızca standart `playYouTube` (satır 32, 203). Müzik kaynakları: local + stream.

---

## Çapraz Kesen Standartlar

`CLAUDE.md` (V8 hidden-class, zero-allocation hot-path, sensor resiliency) ve
`ARCHITECTURE.md` (manifesto) içinde. Tekrar yazılmadı — oraya bakın.
