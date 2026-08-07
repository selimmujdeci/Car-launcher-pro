# Saha Profilleme Araçları (CDP over adb)

> Gerçek head unit üzerinde **ölçüm** yapmak için. Bağımlılık YOK — Node 22+ yerleşik
> `WebSocket` kullanır. Hiçbiri araca/ECU'ya komut göndermez; yalnız WebView'i okur.
>
> **Neden var:** K24 sınıfı head unit'te `adb shell input tap` çekmece içindeki
> WebView'e ulaşmıyor ve üretim build'inde JS konsolu `drop_console` ile siliniyor.
> Bu araçlar olmadan cihazda hiçbir şey ölçülemiyor. 2026-07-27 saha turunda
> (kütük #139/#140) ısınma/kasma kök nedeni bunlarla bulundu.

---

## 0. Ön koşul: CDP açık bir build

CDP yalnız `NODE_ENV=development` ile **sync edilmiş** build'de açıktır
(`capacitor.config.ts` → `webContentsDebuggingEnabled: isDev`).

```bash
export NODE_ENV=development
npm run build
NODE_ENV=development npx cap sync android
JAVA_HOME="C:\Program Files\Android\Android Studio\jbr" node scripts/gradle-build.mjs assembleDebug
adb install -r C:/Temp/carlauncher/app/build/outputs/apk/debug/app-debug.apk
```

> ⚠️ Bu bir **ölçüm build'idir**, saha/üretim build'i DEĞİLDİR: `http://localhost`
> şeması, konsol açık, CDP açık, React **dev runtime** (`jsxDEV`) → mutlak ms
> değerleri üretimden yüksektir. **Oranlar ve yapı geçerlidir, mutlak süreler değil.**
> Araca teslim öncesi üretim APK'sı geri kurulmalıdır.

## 1. Bağlan

```bash
adb connect 10.192.243.216:5555
PID=$(adb shell "cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1" | tr -d '\r')
adb forward tcp:9222 localabstract:$PID
curl -s http://127.0.0.1:9222/json/list          # webSocketDebuggerUrl'i al
WS="ws://127.0.0.1:9222/devtools/page/<ID>"
```

> Sayfa yenilenince target ID **değişir** — `/json/list`'i tekrar çağır.

---

## 2. Araçlar

| Script | Ne ölçer | Kullanım |
|---|---|---|
| `cdpeval.mjs` | Sayfada tek seferlik JS çalıştırır (genel amaçlı) | `node cdpeval.mjs "$WS" "<ifade>"` |
| `cdpmetrics.mjs` | **Script ↔ Style ↔ Layout ↔ Task ayrıştırması** — ilk bakılacak | `node cdpmetrics.mjs "$WS" 20` |
| `cdpprof.mjs` | CPU sampling profili, self-time'a göre sıralı | `node cdpprof.mjs "$WS" 15` |
| `cdptree.mjs` | Aynı profil + **çağrı zinciri (inclusive)** ve React render tetikleyicileri | `node cdptree.mjs "$WS" 15` |
| `cdptimers.mjs` | Boot ÖNCESİ `setInterval`/rAF sarmalar → **ateşleme sayısı + gerçek CPU'su** | `node cdptimers.mjs "$WS" 30` |
| `cdpsched.mjs` | `setTimeout` / `MessagePort` / rAF scheduler trafiği | `node cdpsched.mjs "$WS" 30` |
| `cdpnative.mjs` | Builtin'ler native mi polyfill mi + mikro-benchmark | `node cdpnative.mjs "$WS"` |
| `cdprender.mjs` | React commit sayısı · DOM mutasyon · **long task** oranı | `node cdprender.mjs "$WS" 20` |
| `cdpcommit.mjs` | Her React commit'inde **fiber sayısı + yığın** | `node cdpcommit.mjs "$WS" 25` |
| `labdump4.mjs` | CAROS LAB **5 kategori** katalogunu döker | `node labdump4.mjs "$WS"` |
| `labscreens.mjs` | Belirli LAB **ekranlarını açar** ve içeriğini döker | `node labscreens.mjs "$WS"` |

`cdptimers`, `cdpsched`, `cdprender`, `cdpcommit` **sayfayı yeniler** (probe'u boot
öncesi kurmak zorundalar) — ölçüm boot'tan itibaren başlar.

---

## 3. Teşhis sırası (bu sırayla git, zaman kaybetme)

1. **`cdpmetrics`** — iş JS'te mi, stil/yerleşim/boyamada mı? (`Frames 0` + yüksek
   `ScriptDuration` = JS)
2. **`cdprender`** — React döngüde mi, yoksa az sayıda **pahalı** commit mi?
   (commit/sn düşük + long task yüksek = pahalı commit)
3. **`cdpcommit`** — commit başına **fiber sayısı**. ~900+ fiber = tüm ağaç render
   ediliyor demektir.
4. **`cdptimers` + `cdpsched`** — tetikleyici kanalı elemek için. **Dikkat:** callback
   gövdesi ucuz görünse bile tetiklediği render pahalı olabilir; bu ölçüm timer'ı
   **aklamaz**, yalnız "callback'in kendisi yakmıyor" der.
5. **`cdptree`** — hangi modül React'e giriyor.
6. **`cdpnative`** — polyfill şüphesi varsa (2026-07-27'de çürüdü, builtin'ler native).

---

## 4. UI gezinme tuzakları (acı çekerek öğrenildi)

- LAB/çekmece **overlay**'dir; `document.querySelectorAll` arkadaki ana ekranı da
  görür → seçiciyi **LAB köküne hapset** (`labdump4.mjs` içindeki `ROOT` deseni).
- Etiketler CSS `text-transform: uppercase` ile büyütülmüş → `textContent` **küçük
  harfli** gelir. **`innerText` kullan.**
- React delegasyonlu dinleyici kullanır → `el.click()` yerine
  `pointerdown → mousedown → mouseup → click` sırasıyla `bubbles:true` dispatch et.
- Tıklamayı **üst ata zincirine yayma** — üstteki kapsayıcı çoğu zaman paneli KAPATIR.
- Ekranlar lazy-load; yavaş cihazda **6–9 sn** bekle, yoksa "yükleniyor…" yakalarsın.
- `adb exec-out screencap -p > x.png` ile ekran görüntüsü al (dokunma gerekmez).
- adb ile dokunman **gerekirse** koordinat eşlemesi: `px = sy`, `py = 1280 − sx`.

## 5. Termal / CPU (adb, CDP gerekmez)

```bash
adb shell 'for i in 0 1 2; do cat /sys/class/thermal/thermal_zone$i/type; \
  cat /sys/class/thermal/thermal_zone$i/temp; done'     # 0=cpu 1=gpu 2=ddr (m°C)
adb shell "top -H -p <renderer-pid> -d 2 -n 2 -b -o TID,%CPU,CMD"
adb shell "dumpsys gfxinfo com.cockpitos.pro | head -20"
adb shell "dumpsys meminfo com.cockpitos.pro | head -22"
```

`dumpsys thermalservice` bu cihazda **ölü** (`HAL Ready: false`) — sysfs kullan.

## 6. `dumps/`

2026-07-27 saha turunun ham çıktıları: CAROS LAB tam dökümü (5 kategori + 10 ekran),
Senaryo A (uygulama kapalı referans) ve Senaryo B (ana ekran) termal serileri.
