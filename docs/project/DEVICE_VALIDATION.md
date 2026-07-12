# CarOS Pro — DEVICE VALIDATION (cihaz checklisti)

> **Kaynak-of-truth:** `docs/DEVICE_VALIDATION_LEDGER.md` (bu dosya onun operasyonel checklisti).
> **Kural:** 🔴 = cihaz bekliyor · 🟢 = cihazda doğrulandı · ❌ = denendi/düştü.
> Build başarısı kanıt değildir. Tahmin yok, varsayım yok — yalnız kanıt.

---

## Her PR için ölçüm şablonu

| Metrik | Araç | Beklenen / eşik |
|--------|------|-----------------|
| **CPU (idle)** | CDP Performance / Perfetto | Katman-özel bütçe; idle runaway YOK |
| **CPU (hot-path)** | CDP | 3Hz hız/RPM'de deopt/allocation YOK |
| **RAM** | CDP heap snapshot | Sızıntı YOK (unmount sonrası düşüş) |
| **FPS** | Perfetto / gfxinfo | Low-end (Mali-400) kabul eşiği üstünde |
| **Battery** | dumpsys batterystats | Background drain artışı YOK |
| **Thermal** | dumpsys thermalservice | Sürekli yük altında throttle sınırı |
| **Event/publish oranı** | Diagnostics rapor (#68) | Beklenen aralık (ör. HAL bridge ~0.37/sn) |
| **Ledger #** | — | İlgili ledger kaydı numarası |

---

## Araç/ölçüm kanalları

| Kanal | Nasıl | Cihaz |
|-------|-------|-------|
| **ADB** | `adb connect <ip>:5555` + `install -r` | K24 (ağ), Xiaomi |
| **CDP** | CDP-over-adb (uzaktan) | Xiaomi |
| **Perfetto** | trace capture | FPS/CPU derin analiz |
| **Diagnostics rapor** | "Tanı Gönder" (#68, whitelist, PII yok) | Tüm cihazlar |
| **CAN broadcast** | SystemCanBroadcastAdapter / onDistributeCarInfo | T507 Dacia, K24 |

> **T507 Dacia:** PC-adb imkansız → ölçüm CAN broadcast + on-device rapor ile.
> **K24:** BT OEM kilitli → 3.taraf OBD-BT imkansız; root var → UART CAN sniff.

---

## Aktif 🔴 bekleyenler (özet — tam liste ledger'da)

| # | Özellik | Kabul ölçütü (cihazda ne gözlemlenmeli) |
|---|---------|------------------------------------------|
| 61 | Deep Scan → Event Bus bridge (W5-2) | scan yürüyünce beklenen 8 event map; scan yokken 0 event |
| 60 | Deep Scan Runtime Ownership (W5-1) | boot'ta orchestrator sahiplenilir; `start/run` çağrılmaz → aktif sorgu YOK |
| 59 | Capability → Event Bus bridge (W4) | record.registered/changed/removed + snapshot.changed; ikinci bus YOK |
| 58 | Capability Registry wiring (W3) | providers→adapter→registry ayna; probe-tabanlı unknown kalır |
| 56 | Background sahte-dead kapısı | 🟢 Xiaomi ~20dk background sonrası `lastChangeAt` DEĞİŞMEDİ |
| 53 | HAL kaynak-kaybı fail-closed | 🟢 ingestedSignalCount 5→3 gözlendi (araç kanıtı hâlâ eksik) |
| 54 | HAL → Event Bus bridge | 🟢 publish/sn 0.37, dropped=0, tek abonelik |

---

## Araç doğrulama planı (referans)

- `docs/DEVICE_VALIDATION_PLAN_RENAULT_TRAFIC.md` — Renault Trafic senaryosu.
- `docs/SOAK_MANUAL_K24_CHECKLIST.md` — K24 soak testi.
- `docs/HEAD_UNIT_MATRIX.md` — cihaz uyumluluk matrisi.

---

## Kural hatırlatması

- Platform Core W2–W5 wiring'leri **host-verified** ama **araç kanıtı YOK** → hepsi 🔴.
- 🟢'ye ancak gerçek araçta/cihazda kabul ölçütü gözlemlenince taşınır.
- Cihazda düşerse ❌ + geri dönüş (revert/fix) zorunlu.
