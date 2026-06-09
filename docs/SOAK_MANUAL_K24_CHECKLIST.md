# K24 Manuel Soak (Uzun Süre) Test Prosedürü — 8–24 Saat

> **Amaç:** T4 sanal soak testlerinin (fake-timer) **doğrulayamadığı** gerçek
> donanım davranışlarını — gerçek RAM/PSS eğrisi, BT/OBD reconnect (A2DP glitch),
> eMMC fiziksel aşınma, SoC termal kısıtlama, kontak aç/kapa saat atlaması, mikrofon/
> audio ducking, media session — **gerçek K24 head unit** üzerinde 8–24 saat sahada
> doğrulamak.
>
> **Bu doküman koddur değil prosedürdür.** Production'a etkisi yoktur. Tüm komutlar
> **Windows + PowerShell + adb** uyumludur. Head unit'te **root gerekmez**.

---

## 0. Sanal Test Kapsamı vs Manuel Test Kapsamı (NET AYRIM)

T4 sanal soak testleri (`src/__tests__/soak.*.test.ts`) **mantığı/sözleşmeyi** araç
olmadan deterministik doğrular. Aşağıdaki manuel checklist yalnızca sanal olarak
**taklit edilemeyen** gerçek-donanım davranışını kapsar.

| Alan | Sanal test (CI — otomatik) | Manuel K24 (bu doküman) |
|------|----------------------------|--------------------------|
| safeStorage debounce/coalescing, eMMC **yazım sayısı** | ✅ `soak.safeStorage` | eMMC **fiziksel aşınma** + restart sonrası state (§5) |
| OBD reconnect/backoff dizisi, timer tekilliği | ✅ `soak.obd` (model) | Gerçek BT/RFCOMM/GATT reconnect + A2DP glitch (§3) |
| Runtime zombie/thermal **timer mantığı**, worker registry | ✅ `soak.runtime` | Gerçek SoC ısınması + Mali-400 FPS (§6) |
| telemetry heartbeat sürekliliği, monotonik Δ | ✅ `soak.telemetry-connectivity` | Gerçek kontak aç/kapa saat sıçraması (§7) |
| connectivity offline queue + backoff tavanı | ✅ `soak.telemetry-connectivity` | Gerçek ağ kesinti/dönüş (§3, §5) |
| remoteCommand ACK-timeout + retry queue eviction | ✅ `soak.remoteCommand` | — (kapsanır; manuel opsiyonel) |
| 24h cross-service timer/listener/worker bound | ✅ `soak.cross-service` | Gerçek RAM/PSS plato eğrisi (§2) |
| RAM/PSS gerçek büyüme, LMK, GC davranışı | ❌ (jsdom heap anlamsız) | ✅ **YALNIZ MANUEL** (§2) |
| CAN/MCU gerçek sinyal (reverse/gear/door…) | ❌ | ✅ **YALNIZ MANUEL** (§4) |
| Mikrofon/Vosk/audio ducking | ❌ | ✅ **YALNIZ MANUEL** (§8) |
| Media session (Spotify/YT/yerel) | ❌ | ✅ **YALNIZ MANUEL** (§9) |

> **Kural:** Sanal test geçti diye manuel madde atlanmaz. Manuel madde bir gerçek
> regresyon bulursa, mümkünse önce sanal teste indirgenir (deterministik), sonra düzeltilir.

---

## 1. Test Ön Hazırlığı

### 1.1 Inspector'lı APK derle ve kur

DevInspector overlay (FPS/RAM/Mode/Tier/Blur/GPU) yalnız `VITE_ENABLE_INSPECTOR=true`
build'inde görünür (satış build'inde DCE ile çıkarılır).

```powershell
cd "C:\Users\selim\Desktop\caros pro"
$env:VITE_ENABLE_INSPECTOR = "true"
npm run build
npx cap sync android
cd android
.\gradlew assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

> Not: `app_id = com.cockpitos.pro`. Satış (release) build'inde **`VITE_ENABLE_INSPECTOR`
> ASLA set edilmez** — bu yalnız teşhis APK'sıdır.

### 1.2 APK commit hash'ini kaydet (şablon için)

```powershell
git rev-parse --short HEAD
```

### 1.3 logcat temizle (test başlangıcı)

```powershell
adb logcat -c
```

### 1.4 Şarj / akü durumu

```powershell
adb shell dumpsys battery
```
- **Önerilen:** Head unit kontaktan beslenmeli (kesintisiz). Akü voltajı 11.8V
  altına düşerse telemetri `deep_sleep` moduna girer (bu beklenen davranıştır, §7).
- 24h testte cihazın uyku/ekran-kapanma ayarlarını **kapat** (sürekli açık).

### 1.5 Senaryo matrisi (her test turu için seç)

| Değişken | Seçenekler |
|----------|------------|
| İnternet | açık · kapalı · arada kesilen |
| OBD cihaz | takılı · takılı değil · arada çıkarılan |
| Kontak | sürekli açık · arada kapatılan |

> En değerli soak turu: **internet kapalı (offline-first) + OBD takılı + 24h sürekli**.
> Bu, K24'ün gerçek müşteri senaryosudur (head unit çoğunlukla internetsiz).

### 1.6 Teşhis aracı (kök neden ayrımı)

Self-restart / leak şüphesinde `tools\diag-restart.ps1` PSS timeline + logcat + restart
teşhisi üretir (OOM/ANR/renderer-death/native-crash ayırır):

```powershell
cd "C:\Users\selim\Desktop\caros pro\tools"
.\diag-restart.ps1 -Minutes 480 -IntervalSec 300   # 8 saat, 5dk örnekleme
```
Çıktı: `tools\diag-output\events.txt` (ÖNCE BUNU OKU), `meminfo-timeline.csv`, `logcat-full.txt`.

---

## 2. RAM / PSS Uzun Süre Testi  *(YALNIZ MANUEL)*

**Hedef:** Bellek sürekli tırmanıyor mu yoksa plato yapıyor mu?

### 2.1 Tekil anlık ölçüm

```powershell
adb shell dumpsys meminfo com.cockpitos.pro | Select-String "TOTAL"
```

### 2.2 Otomatik PSS timeline (8–24h sampler)

`diag-restart.ps1` zaten `meminfo-timeline.csv` üretir. Daha uzun/özelleştirilmiş
için bağımsız sampler:

```powershell
$pkg = "com.cockpitos.pro"
$out = "C:\Users\selim\Desktop\caros pro\tools\diag-output\meminfo-timeline.csv"
"timestamp,total_pss_kb" | Out-File $out -Encoding utf8
while ($true) {
  $m = adb shell dumpsys meminfo $pkg 2>$null | Select-String "TOTAL"
  $pss = ($m.Line -split '\s+' | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1)
  "$(Get-Date -Format s),$pss" | Add-Content $out
  Start-Sleep -Seconds 300   # 5 dk
}
```

### 2.3 Ölçüm noktaları

| Süre | Beklenen |
|------|----------|
| 0 saat (boot sonrası) | baseline PSS kaydet |
| 1 saat | baseline ± normal dalgalanma |
| 4 saat | plato başlamış olmalı |
| 8 saat | platoda; baseline'a göre **kalıcı artış ≤ %15** |
| 24 saat | hâlâ platoda; LMK kill / restart **yok** |

### 2.4 Kabul Kriteri ✅

- PSS eğrisi **sürekli tırmanmıyor** (monoton artış yok); 4–8 saat sonra **plato**.
- `events.txt`'te **restart / OOM / LMK** kaydı yok.
- 24h sonunda PSS, 8h değerine yakın (±%10).

### 2.5 Başarısızlık işareti ❌

- PSS her ölçümde artıyor (lineer/üstel) → leak. → `events.txt` + `logcat-full.txt`
  topla, sanal teste indirgemeyi dene (T4 leakHarness).

---

## 3. BT / OBD Reconnect Testi  *(YALNIZ MANUEL — A2DP glitch sanal taklit edilemez)*

**Sanal kapsam:** backoff dizisi 2/4/8/16/32s + 30s/deep-loop + timer tekilliği →
`soak.obd` doğrular. **Manuel kapsam:** gerçek RFCOMM/GATT + A2DP/GPS etkileşimi.

### 3.1 Senaryolar (her birini en az 5 kez tekrarla)

1. **OBD cihazı çıkar → 10s bekle → tak.**
2. **Bluetooth kapat → 10s → aç** (`adb shell svc bluetooth disable` / `enable` — bazı
   K24'lerde çalışmazsa fiziksel ayar menüsünden).
3. **Kontak kapat → 1dk → aç** (araç başında).

### 3.2 Log izleme

```powershell
adb logcat -c
adb logcat | Select-String "OBD|RFCOMM|GATT|Reconnect|A2DP|Bluetooth"
```

### 3.3 Kabul Kriteri ✅

- Reconnect **kilitlenmez**; backoff sonrası bağlantı kendiliğinden geri gelir
  (deep-reconnect 5dk turu dahil — kontak saatler sonra açılsa bile bağlanır).
- Reconnect sırasında **müzik (A2DP) kesintisi minimum**, GPS jitter kabul edilebilir.
- DevInspector veya `meminfo-timeline.csv`'de reconnect başına **timer/listener birikimi yok**
  (PSS reconnect döngüsünde tırmanmaz).
- `connectionState` tutarlı geçer: `reconnecting → connected` veya `error` (takılı kalmaz).

---

## 4. CAN / MCU Gerçek Sinyal Soak  *(YALNIZ MANUEL)*

**Hedef:** Gerçek araç sinyalleri uzun sürede UI state'i kilitlemiyor mu?

### 4.1 Sinyaller (her birini 8h boyunca rastgele aralıklarla ≥20 kez tetikle)

| Sinyal | Test | UI beklentisi |
|--------|------|---------------|
| Reverse (geri vites) | vitese tak/çıkar | Geri görüş overlay (z-index 100000) açılır/kapanır |
| Door open (kapı) | kapı aç/kapat | Kapı uyarısı görünür/kaybolur |
| Gear (vites) | P/R/N/D | Vites göstergesi günceller |
| Headlights (far) | far aç/kapat | Tema gece/gündüz tepkisi |
| Parking brake (el freni) | çek/bırak | Gösterge günceller |
| Direksiyon tuşları | her tuş | İlgili aksiyon (ses/kanal vb.) |

### 4.2 Kabul Kriteri ✅

- Hiçbir sinyal **takılı kalmaz** (örn. reverse çıkınca overlay kapanır).
- 8h sonra sinyaller hâlâ **anında** yanıt verir (gecikme birikmez).
- UI state **kilitlenmez**; aynı sinyali ikinci kez tetiklemek bozulmaz.
- logcat'te CAN handler exception / `RejectedExecutionException` **yok**.

---

## 5. eMMC / safeStorage Davranışı  *(fiziksel aşınma yalnız manuel)*

**Sanal kapsam:** debounce/coalescing + yazım üst sınırı → `soak.safeStorage`.
**Manuel kapsam:** gerçek flash'a yazım baskısı + restart sonrası bütünlük.

### 5.1 Yazım baskısı izleme (8–24h)

```powershell
adb logcat | Select-String "safeStorage|ProactiveEvict|emmc|quota"
```
- Yüksek frekanslı yazma **spam'i olmamalı** (KM/GPS/RPM 5–10s'de bir, anlık değil).
- `ProactiveEvict` ara sıra çıkabilir (normal); **her saniye** çıkıyorsa anormal.

### 5.2 Restart sonrası bütünlük

8–24h kullanım sonrası uygulamayı yeniden başlat:
```powershell
adb shell am force-stop com.cockpitos.pro
adb shell monkey -p com.cockpitos.pro -c android.intent.category.LAUNCHER 1
```

### 5.3 Kabul Kriteri ✅

- Restart sonrası **state sağlam**: araç profili, ayarlar, son GPS, trip/KM korunur.
- localStorage/Filesystem **bozulma (corruption)** kaydı yok; `.tmp` kurtarma sessiz çalışır.
- eMMC yazım frekansı throttled (saniyede onlarca yazma **yok**).

---

## 6. Termal / Low-End Performans (Mali-400)  *(gerçek ısınma yalnız manuel)*

**Sanal kapsam:** mode/thermal **mantığı** → `soak.runtime`. **Manuel:** gerçek SoC ısısı + FPS.

### 6.1 DevInspector overlay değerleri (ekrandan oku, her ölçüm noktasında not al)

`FPS · RAM · Mode · Tier · Blur · GPU renderer`

### 6.2 Termal davranış

```powershell
adb shell dumpsys thermalservice   # bazı K24'lerde desteklenmeyebilir
```
- Cihaz ısınınca runtime mode otomatik düşmeli: `BALANCED → BASIC_JS → POWER_SAVE → SAFE_MODE`.
- Blur kapanmalı (`--rt-blur: 0`), animasyonlar kısılmalı, FPS hedefi düşmeli.

### 6.3 Kabul Kriteri ✅

- Isınma altında **UI kullanılabilir kalır** (donma/siyah ekran yok).
- Mode geçişleri **histerezis**li (stop-and-go trafikte flip-flop yok); downgrade anlık,
  upgrade 30s stabilite bekler.
- Mali-400'de blur kapalıyken aşırı kasma **yok**.
- 24h boyunca termal kaynaklı **crash yok**.

---

## 7. Saat Atlaması / Kontak Aç-Kapa  *(YALNIZ MANUEL)*

**Hedef:** Sistem saati ileri/geri sıçrayınca süre/delta hesapları bozuluyor mu?
(Telemetry `ts` = `performance.now` monotonik; trip/odometer monotonik-delta tabanlı.)

### 7.1 Senaryolar

1. **Kontak kapat → 30dk bekle → aç** (cihaz uyur/uyanır).
2. **Cihaz sleep/wake** (ekran kapat/aç).
3. **Tarih/saat manuel sıçrat** (mümkünse): ileri 1 gün, sonra geri.

### 7.2 İzleme

```powershell
adb logcat | Select-String "telemetry|odometer|trip|GPS|clock|monotonic"
```

### 7.3 Kabul Kriteri ✅

- Odometer/KM **negatif delta üretmez** (saat geri gitse bile mesafe azalmaz).
- GPS hız/trip süresi **negatif/taşma** üretmez.
- Telemetry heartbeat sürekliliği bozulmaz; `ts` monotonik kalır.
- Kontak döngüsünden sonra OBD reconnect ve state kurtarma normal (§3).

---

## 8. Vosk / Mikrofon / Audio Ducking  *(YALNIZ MANUEL)*

### 8.1 Senaryo

1. Müzik çal (yerel/stream).
2. Sesli komut başlat (wake word veya buton) → konuş.
3. Komut bitince müziği gözle.

### 8.2 İzleme

```powershell
adb logcat | Select-String "Vosk|mic|audioFocus|ducking|STT|wakeWord"
```

### 8.3 Kabul Kriteri ✅

- Mikrofon açılınca müzik **duck** olur (kısılır); komut bitince **restore** olur (geri gelir).
- Mikrofon komuttan sonra **açık kalmaz** (LED/izin göstergesi söner).
- Vosk offline çalışır (internet kapalıyken bile STT yanıt verir).
- 8h boyunca tekrarlı komutta audio focus **takılmaz** (müzik kalıcı kısılmaz).

---

## 9. Media Session  *(YALNIZ MANUEL)*

### 9.1 Senaryo

Yerel player + (varsa) Spotify/YT Music ile: play / pause / next / previous, metadata + album art.

### 9.2 İzleme

```powershell
adb shell dumpsys media_session | Select-String "com.cockpitos.pro|state|metadata"
adb logcat | Select-String "media|MediaSession|metadata|albumArt"
```

### 9.3 Kabul Kriteri ✅

- play/pause/next/previous callback'leri **takılmaz** (her zaman yanıt verir).
- Metadata (başlık/sanatçı/album art) doğru güncellenir.
- 8h boyunca album art **memory şişirmez** (PSS §2 eğrisinde sıçrama yapmaz).
- Kaynak değişiminde (yerel ↔ stream) eski session listener **birikmez**.

---

## 10. Test Çıktısı Şablonu

Her soak turu için doldur ve `tools\diag-output\` altındaki loglarla birlikte sakla.

```
═══════════════════════════════════════════════════════════
  K24 MANUEL SOAK TEST RAPORU
═══════════════════════════════════════════════════════════
Test tarihi          : 2026-__-__  __:__
Test süresi          : [ ] 8h   [ ] 24h   diğer: ____
Cihaz modeli         : K24 (____________________)
Android sürümü       : __________  (adb shell getprop ro.build.version.release)
GPU renderer         : __________  (DevInspector → GPU)
RAM (toplam)         : ______ MB
APK commit hash      : __________  (git rev-parse --short HEAD)
OBD cihaz modeli     : __________  (veya: takılı değil)
Araç modeli          : __________
Senaryo              : internet [açık/kapalı] · OBD [takılı/yok] · kontak [sürekli/döngü]

── Madde Sonuçları (✅ geçti / ❌ kaldı / ➖ uygulanmadı) ──
[ ] §2  RAM/PSS plato                 sonuç: ___   baseline:__MB  8h:__MB  24h:__MB
[ ] §3  BT/OBD reconnect              sonuç: ___
[ ] §4  CAN/MCU sinyal soak           sonuç: ___
[ ] §5  eMMC/safeStorage + restart    sonuç: ___
[ ] §6  Termal/low-end (Mali-400)     sonuç: ___
[ ] §7  Saat atlaması/kontak          sonuç: ___
[ ] §8  Vosk/mikrofon/ducking         sonuç: ___
[ ] §9  Media session                 sonuç: ___

── Eklenen Loglar ──
[ ] tools\diag-output\events.txt
[ ] tools\diag-output\meminfo-timeline.csv
[ ] tools\diag-output\logcat-full.txt
[ ] ek notlar: ____________________________________________

── SONUÇ KARARI ──
[ ] GEÇTİ — sevkiyata uygun
[ ] KOŞULLU — şu maddeler düzeltilmeli: ____________________
[ ] KALDI — bloklayıcı: ____________________________________
═══════════════════════════════════════════════════════════
```

---

## Ek: Faydalı adb komutları (Windows / PowerShell)

```powershell
adb devices                                              # bağlı cihazları listele
adb shell getprop ro.build.version.release               # Android sürümü
adb shell dumpsys meminfo com.cockpitos.pro | Select-String "TOTAL"
adb shell dumpsys battery                                # akü/voltaj
adb logcat -c                                            # log temizle
adb logcat -d > tools\diag-output\snapshot.txt           # anlık dump al
adb shell am force-stop com.cockpitos.pro                # uygulamayı durdur
```

> **Hatırlatma:** Bu doküman yalnız manuel saha prosedürüdür; production koduna ve
> bundle'a etkisi yoktur. Otomatik/deterministik kapsam için `src/__tests__/soak.*.test.ts`
> (T4) çalıştırılır: `npm run test`.
