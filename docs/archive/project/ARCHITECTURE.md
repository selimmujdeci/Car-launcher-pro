# CarOS Pro — ARCHITECTURE (canlı mimari)

> Her merge sonrası güncellenir. Kaynak: `src/platform/system/SystemBoot.ts` + wiring dosyaları.
> **Son güncelleme:** 2026-07-12 (main `86d6087`, W5-1 sonrası).

---

## Platform Core zinciri (kuzeyden güneye)

```mermaid
flowchart TD
    Boot[SystemBoot<br/>Wave orkestrasyonu + LIFO cleanup]

    subgraph W1["Wave 1 — Core"]
        RT[AdaptiveRuntimeManager]
        SS[safeStorage]
        NG[NativeGuardBridge]
        EB[Platform Event Bus<br/>appEventBus · tek sahip · PR #66]
    end

    subgraph W2["Wave 2 — Data Backbone"]
        VDL[VehicleDataLayer<br/>store]
        HALW[HAL Wiring<br/>store→provider→adapter→HAL · #65]
        HAL[Vehicle HAL<br/>#49 · tek arayüz]
        HALB[HAL→Bus Bridge · #70]
        CAPW[Capability Wiring<br/>providers→adapter→registry · #74]
        CAP[Capability Registry<br/>#48 · zero-trust]
        CAPB[Capability→Bus Bridge · #75]
        DSW[Deep Scan Wiring<br/>ownership only · #76 / W5-1]
        DS[Deep Scan Orchestrator<br/>PASİF · start/run çağrılmaz]
        ORC[SystemOrchestrator]
    end

    subgraph W3["Wave 3 — Sensors & Intelligence"]
        BB[BlackBox]
        GEO[Geofence]
        RAD[Radar]
        BAT[Battery Protection]
        MB[MaintenanceBrain]
        FA[FuelAdvisor]
    end

    subgraph W4["Wave 4 — UI Services"]
        THE[TheaterService]
        SCE[SmartCardEngine]
        PSH[PushService]
    end

    Boot --> W1 --> W2 --> W3 --> W4

    VDL --> HALW --> HAL --> HALB --> EB
    HAL --> CAPW
    CAPW --> CAP --> CAPB --> EB
    CAP --> DSW --> DS
    EB -. abonelik .-> UI[UI Katmanı<br/>React + Zustand + MapLibre]

    %% Gelecek zekâ katmanları (henüz aktif değil)
    DS -. W5-3+ .-> DDNA[Driver DNA ⬜]
    DDNA -.-> PRED[Prediction Engine ⬜]
    PRED -.-> ACTX[Assistant Context ⬜<br/>temel: PR #43]
    ACTX -.-> UI
```

---

## Katman durumları

| Katman | Durum | Not |
|--------|-------|-----|
| SystemBoot | LIVE | Wave 1–4, LIFO cleanup (Wave 4→1) |
| Platform Event Bus | LIVE | Tek sahip singleton, boot başına 1 bus |
| Vehicle HAL | LIVE | Store→provider→adapter→HAL ayna modu; fail-closed kaynak kaybı |
| Capability Registry | LIVE | Zero-trust; yan-etkisiz browser-API + deviceTier kanıtı |
| Deep Scan | **FOUNDATION ONLY** | W5-1 ownership bağlı; `start()/run()` YOK → tarama başlamaz |
| Driver DNA | NOT ACTIVE | Phase C |
| Prediction | NOT ACTIVE | Phase C |
| Assistant Context | NOT ACTIVE | Temel PR #43 MERGED (Ledger #28 🔴) |

---

## Kritik sözleşmeler

- **Ownership:** Wiring oluşturduğunu sahiplenir; paylaşılan singleton (runtime/persistence/ignition/bus) **dispose edilmez** (bkz. `PROJECT_MEMORY.md`).
- **Fail-closed:** Deep Scan `ignitionConfirmed = null` kaynak yokken; aktif fazlar `waiting_for_ignition`'da bloke.
- **Event akışı:** Değişiklik-only ingest (O(1)); batch ingest N→1 emit; transient event history'yi şişirmez.
- **Zero-leak:** Her `_reg(fn)` bir dispose garantisi; LIFO sırada çalışır.
- **Bridge yön:** Kaynak katman → Bus (tek yön); Bus, katmanları başlatmaz/durdurmaz (DI ile publisher tüketir).

---

## Boot Wave özeti (`SystemBoot.ts`)

| Wave | İçerik |
|------|--------|
| Wave 1 (Core) | runtimeManager · safeStorage · NativeGuardBridge · EventBus wiring · crash recovery |
| Wave 2 (Backbone) | VehicleDataLayer · HAL wiring · HAL bridge · Capability wiring · Capability bridge · Deep Scan wiring · SystemOrchestrator |
| Wave 3 (Intelligence) | MaintenanceBrain · FuelAdvisor · BlackBox · Geofence · Radar · Battery |
| Wave 4 (UI Services) | TheaterService · SmartCardEngine · PushService |
