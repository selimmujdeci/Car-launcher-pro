# CarOS Pro — ROADMAP

> Sıra değiştirilmez. Tamamlanan işler tekrar yazılmaz. Bağımlılık sırası korunur.
> Durum kaynağı: `git log` + `gh pr list` + `docs/DEVICE_VALIDATION_LEDGER.md`.

**Legend:** ✅ tamam · 🟡 devam · ⬜ bekliyor · 🔴 cihaz bekliyor · 🟢 cihazda doğrulandı

---

## Phase A — Platform Core

| # | Madde | Durum | PR | Commit | Ledger | CI | Device |
|---|-------|-------|----|--------|--------|----|--------|
| W2 | Vehicle HAL Wiring | ✅ | #65 | c4d6da3 | #49 | yeşil | 🔴 |
| W3 | Capability Registry Wiring | ✅ | #74 | 518a7cb | #58 | yeşil | 🔴 |
| W3 | Platform Event Bus Ownership | ✅ | #66 | 47adf17 | #50 | yeşil | 🟢 (boot tek bus) |
| W4 | Event Bus Wiring (Capability→bus) | ✅ | #75 | 6959fc5 | #59 | yeşil | 🔴 |
| W4A | HAL adapter batch ingest | ✅ | #67 | b76cf32 | #51 | yeşil | 🔴 |
| W4B | HAL kaynak-kaybı fail-closed | ✅ | #69 | 2e60f03 | #53 | yeşil | 🟢 (ingest 5→3) |
| W4C | HAL → Event Bus bridge | ✅ | #70 | 68d6ad9 | #54 | yeşil | 🟢 (publish/sn 0.37) |
| W4E | Platform runtime diagnostics | ✅ | #68 | 5d56775 | #52 | yeşil | 🟢 (rapor gövdesi) |

---

## Phase B — Deep Scan (W5) 🟡 AKTİF

| # | Madde | Durum | PR | Ledger | Device |
|---|-------|-------|----|--------|--------|
| W5-1 | Runtime Ownership | ✅ | #76 | #60 | 🔴 |
| W5-2 | Event Bus Bridge | 🟡 AÇIK | #77 | #61 | 🔴 |
| W5-3 | Offline-only Run | ⬜ SIRADA | — | — | — |
| W5-4 | Capability Evidence | ⬜ | — | — | — |
| W5-5 | Gated Active Discovery | ⬜ | — | — | — |

**W5 notu:** Foundation (Deep Scan #44–#47, Capability #48/#52, HAL #49/#51, Event Bus #50)
main'de PASİF idi. W5 serisi bunu adım adım aktive eder — her adım fail-closed + gated.
Aktif ECU/PID/DID sorgusu ancak W5-5'te (offline-only + capability evidence koşulları sağlanınca) açılır.

---

## Phase C — Driver Intelligence

| # | Madde | Durum |
|---|-------|-------|
| — | Driver DNA | ⬜ |
| — | Prediction Engine | ⬜ |
| — | Assistant Context | ⬜ (temel: Birleşik Asistan Bağlamı PR #43 MERGED, Ledger #28 🔴) |

---

## Phase D — Commercial Release

| # | Madde | Durum |
|---|-------|-------|
| — | Device Validation (araç kanıtı serisi) | ⬜ |
| — | Mali-400 optimizasyon | ⬜ |
| — | Vehicle Validation (Renault Trafic / T507 / K24) | ⬜ |
| — | Beta | ⬜ |
| — | Production | ⬜ |
| — | Gömülü AI anahtarı temizliği (SATIŞ BLOCKER, PR #73) | 🟡 AÇIK |
| — | Supabase anon-grant sıkılaştırma (SQL #32–34) | 🟡 AÇIK |

---

## Bir sonraki hedef

**W5-3 — Deep Scan Offline-only Run.** Önce yeni daldan salt-okunur analiz.
