# CarOS Pro — PROJECT STATUS

> Her merge sonrası güncellenir. Kaynak veriler `git log` + `gh pr list` + Ledger.
> **Son güncelleme:** 2026-07-12

---

## Faz

**Platform Core Activation** → alt-faz **W5 Deep Scan Activation** (devam ediyor).

---

## Main

| Alan | Değer |
|------|-------|
| **Current main HEAD** | `86d6087` — Merge PR #76 (Deep Scan runtime ownership wiring, W5-1) |
| **Bir önceki** | `6959fc5` — Merge PR #75 (Capability → Event Bus bridge, W4) |
| **Branch (aktif çalışma ağacı)** | `main` |

---

## Merged PR listesi (platform core aktivasyon serisi)

| PR | Konu | Wave | Commit |
|----|------|------|--------|
| #76 | Deep Scan runtime ownership wiring | W5-1 | 86d6087 / e05a066 |
| #75 | Capability → Event Bus bridge wiring | W4 | 6959fc5 / f8db22c |
| #74 | Capability Registry runtime wiring | W3 | 518a7cb / 9337cf0 |
| #72 | Source health fail-closed consumption | — | 5095fe9 |
| #71 | Worker source health transport | — | 448e09d |
| #70 | Vehicle HAL → Event Bus bridge wiring | W4C | 68d6ad9 |
| #69 | HAL kaynak-kaybı fail-closed | W4B | 2e60f03 |
| #68 | Platform runtime diagnostics | W4E | 5d56775 |
| #67 | HAL adapter batch ingest | W4A | b76cf32 |
| #66 | Platform Event Bus runtime ownership | W3 | 47adf17 |
| #65 | Vehicle HAL runtime wiring | W2 | c4d6da3 |
| #64 | VisionOverlay idle loop gate | — | (merged) |

---

## Open PR listesi

| PR | Konu | Durum |
|----|------|-------|
| **#77** | **Deep Scan → Event Bus bridge (W5-2)** | AÇIK — Ledger #61 🔴, cihaz bekliyor |
| #73 | env secret-leak hardening (bracket→dot + scan guard) | AÇIK — satış blocker fix |
| #62 | GPS çift/üçlü abonelik tekilleştirme | AÇIK — cihaz bekliyor |
| #60 | OEM Validation Lab — Device Layer (PR-2) | AÇIK — stacked, coverage 0 |
| #59 | OEM Validation Lab — Host Foundation (PR-1) | AÇIK — host-verified |
| #23 | Discovery live capture (PR-DISC-2) | AÇIK |
| #20 | 500+ DTC kataloğu (PR-DTC-3) | AÇIK |
| #11 | diag support snapshot | AÇIK — OBD testi bekliyor |

---

## Roadmap özeti

- ✅ W2 Vehicle HAL Wiring
- ✅ W3 Capability Registry Wiring
- ✅ W4 Event Bus Wiring
- 🟡 **W5 Deep Scan Activation** — W5-1 ✅ (PR#76) · W5-2 🟡 AÇIK (PR#77) · W5-3/4/5 ⬜
- ⬜ Driver DNA · ⬜ Prediction Engine · ⬜ Assistant Context

Detay: `ROADMAP.md`.

---

## Son doğrulama / build / CI durumu

| Alan | Durum |
|------|-------|
| **Son cihaz doğrulaması** | 🟢 #56 (Xiaomi, background sahte-dead kapısı, ~20dk) — araç kanıtı hâlâ eksik |
| **Son host doğrulama** | W5-1 test suite 3677, tsc/lint/build temiz (PR#76 raporu) |
| **Son CI** | main yeşil (PR#76 merge sonrası) |
| **Son APK** | Bu oturumda üretilmedi (APK yalnız "apk ver" isteği üzerine) |

---

## Bilinen blockerlar

- **Araç doğrulaması yok:** Tüm W2–W5 platform core wiring'leri host-verified ama gerçek araçta/OBD ile kanıtlanmadı (Ledger #49–#61 🔴).
- **Gömülü AI anahtarı sızıntısı (SATIŞ BLOCKER):** `.env` VITE_GEMINI/CLAUDE anahtarları dist+APK'ya literal gömülü — fix PR #73 AÇIK, rotate + kaldır bekliyor.
- **Supabase anon FULL grant:** 19/21 tabloda `anon` full grant (SQL PR #32–34 AÇIK, canlıya uygulanmadı).

---

## Bilinen riskler

- SAB/COI prod'da KAPALI (YouTube/müzik COEP çatışması) — bilinçli, fail-soft kanıtlı. Kör COOP/COEP patch YASAK.
- Native `canStatus` transport-only; sessiz frame kaybı yalnız worker watchdog ile görülür (PR#71/#72 ile kapatıldı, araç kanıtı bekliyor).
- Deep Scan foundation main'de PASİF: W5-1 yalnız ownership, `start()/run()` çağrılmıyor → aktif ECU/PID/DID sorgusu YOK (bilinçli).
