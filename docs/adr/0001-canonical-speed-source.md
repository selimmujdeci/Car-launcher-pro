# ADR 0001 — Tek Kanonik Hız Kaynağı

## Status

Kabul edildi (commit `99abf60` — "fix(nav): use canonical speed in navigation HUD").

## Context

Araç hızı birden fazla sensörden gelebilir: CAN bus (K24CanBridge), OBD-II adaptör
(ELM327) ve GPS. Navigasyon HUD'u ile gauge bileşenleri farklı kaynaklardan farklı
hız okursa tutarsızlık (HUD ile gösterge farkı, ETA titremesi) oluşur. Tek bir
"kanonik" hız değeri gerekiyordu.

Ayrıca bu oturumda (2026-06-06, ölü-kod analizi) önemli bir mimari yanlış anlama
düzeltildi: hız akışının `useSABDirectUpdate.ts` üzerinden gauge'lara gittiği
sanılıyordu — bu **YANLIŞ**. Grep + knip doğrulaması: `useSABDirectUpdate.ts` **ÖLÜ**
(yalnızca ölü `PremiumSpeedometer.tsx` import ediyor; `MiniMapWidget` sadece yorumda
anıyor). Aktif akış **Zustand `useUnifiedVehicleStore`** üzerinden yürüyor.

## Decision

Tek kanonik hız kaynağı: **`useUnifiedVehicleStore`** (Zustand). Veri akışı
(`ARCHITECTURE_DATAFLOW.md` §1 — düzeltilmiş hali):

```
Native (CAN/OBD) → VehicleCompute.worker.ts (tek yazar, Seqlock)
  → SharedArrayBuffer (sabChannel.ts, cache-line padded)
  → VehicleSignalResolver (SAB polling 50ms/20Hz + Seqlock double-check)
  → useUnifiedVehicleStore (Zustand)
  → AKTİF gauge + NavigationHUD bileşenleri
```

- Navigasyon HUD araç hızını doğrudan `useUnifiedVehicleStore`'dan okur
  (`navigationService.ts:476-477, 536, 554`; commit 99abf60).
- ETA hysteresis: 30 sn rolling speed window + hysteresis → UI titreme engellenir
  (`navigationService.ts:335-342`).
- SAB altyapısı (worker, `sabChannel.ts` Seqlock + cache-line padding) **CANLI**;
  ölü olan yalnızca `useSABDirectUpdate` tüketim hook'u.

## Consequences

- (+) Tüm tüketiciler aynı kanonik hızı görür; HUD/gauge tutarsızlığı ve ETA
  titremesi giderildi.
- (+) Seqlock + cache-line padding ile çok çekirdekli okuma/yazma güvenli
  (CLAUDE.md SAB & Hardware Safety standardı).
- (−) `useSABDirectUpdate.ts` ölü kod olarak kaldı (silinmedi; ölü-kod temizliği
  ayrı iş — `PROJECT_STATE.md` Çöp Kod). Yeni gelen bu hook'u **kullanmamalı**.
- (!) `VehicleSignalResolver` SAB/Seqlock yapısına dokunulmaz (`HANDOFF.md` §3).
  Faz 2'de yalnızca polling frekansı düşürülecek (20→10/5Hz), yapı değişmeyecek.

## Links & affected files

- Commit: `99abf60`
- `src/store/` → `useUnifiedVehicleStore` (kanonik hız store'u)
- `src/platform/navigationService.ts:335-342, 476-477, 536, 554`
- `src/core/.../sabChannel.ts` (Seqlock + cache-line padding; SAB_BYTES=512)
- `src/.../VehicleSignalResolver.ts:206-220` (SAB polling 50ms/20Hz)
- `src/.../VehicleCompute.worker.ts` (tek yazar)
- `src/hooks/useSABDirectUpdate.ts` — **ÖLÜ**, kullanma
- `ARCHITECTURE_DATAFLOW.md` §1 (düzeltilmiş akış)
