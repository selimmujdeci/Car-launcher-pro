# HARDENING STRATEGY: Geofence 2.0 & Maintenance Service

## 1. Geofence 2.0 İhlal Analizi (src/platform/geofenceService.ts)
Servis içindeki kritik ihlal noktaları ve tetikleyiciler belirlenmiştir:

*   **Geofence Exit (Çıkış İhlali):**
    *   **Konum:** `checkGeofence` fonksiyonu (Satır 118).
    *   **Kriter:** `if (isOut && wasIn)` — Araç, belirlenen `radiusKm` dışına çıktığı anda (Haversine formülü ile hesaplanan mesafe > yarıçap) tetiklenir.
    *   **Aksiyon:** `telemetryService.pushAlert('geofence_alert', ...)` çağrısı ile anlık veri iletimi başlatılır.

*   **Valet Speed (Vale Hız İhlali):**
    *   **Konum:** `checkGeofence` fonksiyonu (Satır 146).
    *   **Kriter:** `if (_state.valeModeActive && speedKmh > _state.valeSpeedLimit)` — Vale modu aktifken hız sınırı aşıldığında tetiklenir.
    *   **Aksiyon:** 5 saniyelik debounce (tekrarlama koruması) sonrası `telemetryService.pushAlert('valet_alert', ...)` çağrısı yapılır.

## 2. Telemetry Service Throttle Bypass Tasarımı (src/platform/telemetryService.ts)
`pushVehicleEvent` metodunun ihlalleri anlık (sıfır gecikme) kabul etmesi için mevcut mimari şu şekilde sertleştirilmelidir:

*   **Bypass Mekanizması:** `TelemetryService` sınıfındaki `pushAlert` metodu (Satır 206), normal delta-based (hız/konum değişimi) ve heartbeat (10s) throttling mekanizmalarını tamamen atlar.
*   **İşleyiş:** `pushAlert` -> `_push(event, metadata)` -> `pushVehicleEvent(type, payload)`.
*   **Veri Bütünlüğü:** `_push` metodu içerisinde `this._lastSent` snapshot'ı anlık olarak güncellenerek race-condition engellenmiş durumdadır.
*   **Öneri:** `vehicleIdentityService.ts` içindeki `pushVehicleEvent` metodu doğrudan RPC çağrısı yaptığı için herhangi bir ek internal throttle bulunmamaktadır. Bu hattın "Low Latency Priority" olarak işaretlenmesi yeterlidir.

## 3. AI Voice Service Entegrasyon Noktası (src/platform/aiVoiceService.ts)
`vehicleMaintenanceService.ts`'den gelecek `MaintenanceAssessment` verilerinin enjekte edileceği nokta:

*   **Fonksiyon:** `buildSystemPrompt(ctx?: VehicleContext)`
*   **Enjeksiyon Noktası:** Satır 142 (DTC teşhis kayıtları bloğunun hemen sonrası).
*   **Veri Yapısı:** `VehicleContext` interface'ine `maintenanceAssessments?: MaintenanceAssessment[]` alanı eklenmelidir.
*   **Prompt Mantığı:**
    ```typescript
    if (ctx.maintenanceAssessments && ctx.maintenanceAssessments.length > 0) {
      contextLines.push(`\n[BAKIM VE SERVİS DURUMU]`);
      for (const maint of ctx.maintenanceAssessments) {
        contextLines.push(`- ${maint.label}: ${maint.message} (Statü: ${maint.status})`);
      }
      contextLines.push(`KURAL: Kullanıcı araç bakımıyla ilgili soru sorarsa yukarıdaki verileri baz al.`);
    }
    ```

## 4. Maintenance Service & VehicleStore Entegrasyonu
`vehicleMaintenanceService.ts`'nin `currentKm` verisini alması için gereken teknik detaylar:

*   **Gereksinim:** `src/platform/vehicleDataLayer/types.ts` içindeki `VehicleState` interface'ine `currentKm: number;` (veya `odometer`) alanı eklenmelidir.
*   **Import Yolu (src/platform/vehicleMaintenanceService.ts içinden):**
    `import { useVehicleStore } from './vehicleDataLayer/VehicleStateStore';`
*   **Erişim Metodu:**
    `const currentKm = useVehicleStore.getState().speed !== undefined ? useVehicleStore.getState().currentKm : 0;`
    (Not: Mevcut `useStore.getState().settings.maintenance.currentKm` erişimi yerine bu metodun kullanılması, verinin "Source of Truth" olarak araç katmanından gelmesini sağlar.)

---
**Rapor Sonu — Senior Connected Car System Architect**
