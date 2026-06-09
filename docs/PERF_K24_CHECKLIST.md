# K24 Manuel Performans Checklist — Etkileşim Başına FPS/RAM

> Sanal perf testlerinin (P1–P7, `perf.*.test.ts`) **doğrulayamadığı** gerçek
> Mali-400 GPU paint, WebGL context ve RAM davranışını **etkileşim başına** ölçen
> doldurulabilir saha checklist'i. `docs/PERF_AUDIT.md §4–§5` kabul kriterlerinin
> uygulanabilir hâli. Uzun-süre (8–24h) için → `docs/SOAK_MANUAL_K24_CHECKLIST.md §6`.
>
> Kod yok; production/bundle etkisi yok.

---

## 0. Ön koşul

```powershell
$env:VITE_ENABLE_INSPECTOR = "true"; npm run build; npx cap sync android
cd android; .\gradlew assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```
DevInspector şeridi: **FPS · RAM · Mode · Tier · Blur · WebGL · GPU renderer**
(`InspectorPanel.tsx`; FPS yalnız "fps" sekmesi açıkken örneklenir).

Mod hedefleri (`runtimeConfig.ts`): PERFORMANCE 60 · BALANCED 30 · BASIC_JS 20 ·
POWER_SAVE 15 · SAFE_MODE 15. **Kabul: ölçülen FPS ≥ hedefin %80'i.**

---

## 1. Sanal Kapsanan vs Burada Ölçülen

| Alan | Sanal (CI — geçiyor) | K24 manuel (bu doküman) |
|------|----------------------|--------------------------|
| Store notify disiplini | ✅ `perf.notify` (P2) | — |
| Gauge RAF 20Hz throttle / snap | ✅ `perf.gauge` (P3) | Gerçek ibre akıcılığı + GPU |
| Theme-switching guard timing | ✅ `perf.theme` (P4) | Gerçek reflow/repaint storm |
| Map ownership singleton | ✅ `perf.map` (P5) | **Gerçek WebGL context + jank** |
| Media blurOff matrisi | ✅ `perf.media-worker` (P6) | **Gerçek blur(64px) paint + iframe decode** |
| Worker/main-thread bütçe | ✅ `perf.media-worker` (P6) | Gerçek SoC CPU dengesi |
| FPS sayaç matematiği | ✅ `perf.cross` (P7) | Gerçek FPS değeri |

---

## 2. Etkileşim Checklist'i (her satır: ölç → doldur)

| # | Etkileşim | Aksiyon | Beklenen (kabul) | FPS | RAM(MB) | Mode | Blur | Sonuç |
|---|-----------|---------|------------------|-----|---------|------|------|-------|
| 1 | **Ana ekran idle** | Boot → bekle 30s | FPS ≥ hedef×0.8; RAM stabil | ___ | ___ | ___ | ___ | ☐ |
| 2 | **Gauge canlı** | OBD/mock hız+RPM akışı | İbre akıcı; FPS düşmez; sıçrama yok | ___ | ___ | ___ | ___ | ☐ |
| 3 | **OBD modal** | OBDConnectModal aç + tara | UI donmaz; FPS toparlar | ___ | ___ | ___ | ___ | ☐ |
| 4 | **MediaScreen (blur)** | Müzik çal + album art | low-end → **Blur=0**; FPS düşmez | ___ | ___ | ___ | ___ | ☐ |
| 5 | **YouTube iframe** | YT ara + parça çal | iframe RAM şişirmez; FPS kabul | ___ | ___ | ___ | ___ | ☐ |
| 6 | **MiniMap→FullMap** | Harita aç | Geçiş jank kabul; tek WebGL | ___ | ___ | ___ | ___ | ☐ |
| 7 | **FullMap→MiniMap** | Harita kapat | RAM geri döner (context-free) | ___ | ___ | ___ | ___ | ☐ |
| 8 | **Harita 10× döngü** | 6–7'yi 10 kez | **RAM tırmanmaz** (WebGL leak yok) | ___ | ___ | ___ | ___ | ☐ |
| 9 | **Theme switch 10×** | Gündüz↔gece 10 kez | Swap sonrası **storm/flicker yok** | ___ | ___ | ___ | ___ | ☐ |
| 10 | **Termal yük** | 45°C+ ısıt | Mode otomatik düşer; UI kullanılabilir | ___ | ___ | ___ | ___ | ☐ |

> İzleme (paralel terminal):
> ```powershell
> adb logcat | Select-String "Runtime|MAP_DESTROY|MAP_WEBGL|theme|blur"
> adb shell dumpsys meminfo com.cockpitos.pro | Select-String "TOTAL"
> ```

---

## 3. Kabul Kriterleri (PERF_AUDIT §5 ile birebir)

- [ ] **Low-end kullanılabilirlik:** BASIC_JS/POWER_SAVE/SAFE_MODE'da UI donmaz, dokunma çalışır.
- [ ] **FPS mod-tutarlı:** her ekranda FPS ≥ modun `uiFpsTarget`'ının %80'i.
- [ ] **RAM plato:** harita/tema/media döngülerinde PSS kalıcı tırmanmaz (madde 8 kritik).
- [ ] **Blur low-end'de kapalı:** `enableBlur=false` mod veya `isLowEndDevice` → `--rt-blur=0`, blur(64px) yok.
- [ ] **WebGL context leak yok:** 10× harita döngüsünde RAM sabit (context biriktirmez).
- [ ] **Theme storm yok:** swap sonrası `theme-switching` kalkar, flicker yok, FPS toparlar.

---

## 4. Çıktı

```
Tarih: 2026-__-__   Cihaz: K24 (________)   Android: ____   GPU: ________
APK hash: ________   RAM: ____ MB   Senaryo: internet[__] OBD[__]
Madde sonuçları: 1[ ] 2[ ] 3[ ] 4[ ] 5[ ] 6[ ] 7[ ] 8[ ] 9[ ] 10[ ]
Kabul kriterleri: tümü ☐ / eksik: ______________________________
SONUÇ: [ ] GEÇTİ  [ ] KOŞULLU: ______  [ ] KALDI: ______
Ekli log: meminfo-timeline.csv ☐  logcat ☐
```

> Loglar `tools\diag-output\` altına; uzun-süre PSS için `diag-restart.ps1` (SOAK §1.6).
