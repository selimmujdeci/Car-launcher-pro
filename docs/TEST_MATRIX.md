# TEST MATRIX — CarOS Pro

> Senaryo bazlı test durumu. "Mevcut durum" `PROJECT_STATE.md` + `HANDOFF.md`'den
> alındı (güncelleme 2026-06-09); çoğu native/saha senaryosu **SAHA TESTİ BEKLİYOR**.
> Release öncesi `RELEASE_CHECKLIST.md` ile birlikte kullanılır.

| Senaryo | Kapsam | Nasıl test edilir | Mevcut durum | Not |
|---------|--------|-------------------|--------------|-----|
| **Telefon (debug)** | Uygulamanın telefonda debug APK ile açılması, temel UI | `gradlew assembleDebug` → telefona kur → boot/UI gez | Bekliyor | Companion/PERFORMANCE tier; en kolay smoke test |
| **K24 head unit (debug)** | Gerçek hedef cihazda debug APK; launcher, dokunma, donma | Debug APK'yı K24'e kur, varsayılan launcher seç, gez | Bekliyor | Asıl hedef cihaz (Mali-400, Android 15, root yok) |
| **K24 signed release** | Release/signed APK'nın K24'te çalışması; flag/mock kapalı | `RELEASE_CHECKLIST.md` adımları + signed APK kurulumu | Bekliyor | versionCode/Name (`app/build.gradle:19-20`) güncellenmeli |
| **BLE OBD** | BLE GATT transport ile ELM327 bağlantısı | K24 + BLE ELM327 adaptör + araç; bağlan, PID oku | Bekliyor | `BleObdManager.java`; commit 04d0ef2; cihazda doğrulanmadı |
| **Classic OBD** | RFCOMM/Classic ELM327 bağlantısı + protokol cycle | K24 + Classic ELM327; KWP2000 aracı (Fiat Doblo) dene | Bekliyor | `OBDManager.java`; `PROTOCOL_CYCLE` (obdService.ts:608) |
| **GPS-only (hız)** | OBD/CAN yokken GPS hızının HUD/gauge'a düşmesi | Adaptör bağlamadan sür; HUD hızı kanonik mi kontrol et | Bekliyor | `useUnifiedVehicleStore` kanonik (commit 99abf60); ADR 0001 |
| **CAN fallback** | K24CanBridge + McuEventSniffer ile CAN verisi, crash yok | K24'te sür, CAN sinyali gel; crash loop oluşmuyor mu | Bekliyor | McuEventSniffer crash fix commit ef20108; native `M` |
| **YouTube audio** | Piped üzerinden arama + audio/stream çalma | K24 ağında YouTube ara, parça çal | Bekliyor | Tek canlı instance private.coffee (pipedProvider.ts:22-23) — risk |
| **YouTube video** | Gömülü video oynatma | — | **Ertelendi** | Gömülü video REVERT (`_playYouTubeLight` yok); ADR 0004 |
| **YouTube video probe** | YT debug/probe flag ile video teşhisi | — | **Belirsiz** | `YT_DEBUG_PROBE`/iframe probe kodda YOK (grep boş) |
| **Low-end performans** | Faz 1 GPU patch sonrası dokunma gecikmesi ölçümü | K24'te dokunma gecikmesini ölç; `--rt-blur` guard etkin mi | Bekliyor | Faz 1 commit 2fbbd57; Faz 2 interval gating YAPILMADI |
| **Vosk STT (mikrofon)** | Offline Türkçe STT + AGC/NS/AEC + ducking | K24 internetsiz; sesli komut ver, müzik %12'ye iniyor mu | Bekliyor | CarLauncherPlugin.java; Java compile OK, cihazda doğrulanmadı |
| **8–24h Soak (uzun süre)** | RAM/PSS plato, BT/OBD reconnect, CAN sinyal, eMMC, termal, saat-sıçraması, ducking, media session | `docs/SOAK_MANUAL_K24_CHECKLIST.md` adımları (8–24h) + `tools/diag-restart.ps1` | Bekliyor | Mantık/sözleşme sanal kapsandı (T4); gerçek-donanım manuel |

## Otomatik test kapsamı (referans — bunlar geçiyor)

> CI/lokal otomatik testler; saha testinin yerini TUTMAZ ama regresyon yakalar.

| Katman | Komut | Son bilinen durum |
|--------|-------|-------------------|
| Unit + integration (vitest) | `npm test` | 635/635 OK (50 dosya; 2026-06-09) |
| Soak / endurance (sanal-saat, T4) | `npm test -- soak` | 49 test; 8–24h fake-timer; gerçek sleep yok |
| E2E (Playwright) | `npm run test:e2e` | CLAUDE.md E2E tablosu; release öncesi koş |
| Web build (tsc + vite) | `npm run build` | OK (`PROJECT_STATE.md`) |
| Type/lint | `npx tsc -b` · `npm run lint` | tsc -b + eslint temiz (2026-06-09) |

> **T1–T4 sanal test altyapısı** (`src/__tests__/sim/` + `soak.*.test.ts` + `cleanup.*.test.ts`):
> OBD/CAN simülatörü, leak harness, low-end/runtime simülatörü, sanal-saat soak motoru.
> safeStorage / OBD reconnect / runtime zombie-thermal / telemetry / connectivity /
> remoteCommand / cross-service 24h **mantığını** araçsız deterministik doğrular.
> Gerçek-donanım soak için → `docs/SOAK_MANUAL_K24_CHECKLIST.md`.
| Lint | `npm run lint` | Release öncesi koş |
| Native compile | `gradlew compileDebugJavaWithJavac` | OK (mic/ducking; `PROJECT_STATE.md`) |

## Durum lejantı

- **Geçti** — doğrulandı, regresyon yok.
- **Bekliyor** — kod hazır, gerçek cihaz/saha testi yapılmadı.
- **Belirsiz** — mekanizma/flag kodda doğrulanamadı veya kapsam netleşmedi.
- **Ertelendi** — bilinçli olarak kapsam dışı (örn. gömülü video).
