# 🧠 CAROS PRO — HANDOVER MEMORY

## 🛠️ ÇALIŞMA METODOLOJİSİ
Bu proje **"Brain & Hands"** modeliyle yönetilmektedir:
- **Gemini (Beyin/Mimar):** Derin mimari analiz, otomotiv standartları denetimi (BRUTAL_AUDIT_MODE) ve Claude için cerrahi prompt hazırlama.
- **Claude (El/Uygulayıcı):** Gemini tarafından hazırlanan promptları hatasız uygulama, kod yazımı ve test geçirme.

## 📐 TEMEL PRENSİPLER
1. **Automotive Grade:** Kararlılık, düşük gecikme, hata toleransı ve sürücü psikolojisi önceliklidir.
2. **Surgical Updates:** Sadece hedeflenen dosyalar, minimum yan etkiyle güncellenir.
3. **Mali-400 Safe:** Düşük donanımlı cihazlar için GPU overdraw ve bellek yönetimi (Zero-GC, Throttling) kritiktir.
4. **Zero-Fluff:** Teknik odaklı, doğrudan ve kesin iletişim.

## 📂 KRİTİK DOSYALAR
- `GEMINI.md`: Proje anayasası ve kısıtlar.
- `SYSTEM_MAP.md`: Mevcut modüllerin mimari haritası.
- `ACTIVE_TASK.md`: Şu anki sprintin durumu ve bir sonraki adım.

---

## 🛡️ FLEET-GRADE RUNTIME KURALLARI (Phase S — Mühürlenmiş 17 Mayıs 2026)

### 12 Saatlik Vardiya Gereksinimleri
- **Soak Test:** `healthMonitor.enableSoakTest()` — her 1 saatte bir rastgele OPTIONAL servis `requestIdleCallback` ile restart edilir.
- **UI Thread Watchdog:** rAF tick + `setInterval(5100ms)` gap kontrolü → 5s donma = `HEARTBEAT_UI_FREEZE` sinyali + `logError` (SystemHealthMonitor).
- **eMMC Koruması:** Normal yazım 5s debounce. Kritik anahtarlar (`IMMEDIATE_WRITE_KEYS`) → sıfır debounce. Açılışta localStorage %80 (4 MB) doluluk → proaktif `safeLruEvict()`.
- **OBD Jitter:** Worker crash → 5s → 10s → 20s exponential backoff → 5dk cool-off. Cool-off sırasında ek crash sinyalleri yok sayılır.
- **Crash Recovery:** Navigasyon state `safeSetRawImmediate` ile her step değişiminde mühürlenir. Açılışta `restoreNavigationAsync` → PREVIEW → GPS fix → ACTIVE (Zero-Touch, TTS yok).

### SystemBoot Dalga Hiyerarşisi (Wave Order)
```
Wave 1 (Core):        runtimeManager · safeStorage · ExpertTrust · SafetyBrain
                      CommunityService · NativeGuardBridge · CrashRecovery
                      MemoryWatchdog · HealthMonitor
Wave 2 (Backbone):    VehicleDataLayer (SAB worker) · SystemOrchestrator
Wave 3 (Intelligence):MaintenanceBrain · FuelAdvisor · BlackBox · BatteryProtection
                      VehicleIntelligence · GeofenceService · RadarEngine
                      CognitivePriorityEngine + LIMP monitor
Wave 4 (UI Services): TheaterService · SmartCardEngine · PushService · VoiceService
Cleanup:              LIFO (Wave 4 → Wave 1) — bağımlılık zincirine saygı
```

### LIMP_HOME Process Killer Mantığı
- **Tetikleyici:** Termal L3 (SystemOrchestrator) veya `useCognitiveStore.setMode('LIMP_HOME')` (herhangi bir kaynak).
- **OPTIONAL (durdurulanlar):** RadarEngine · FuelAdvisor · MaintenanceBrain · CommunityService · VoiceService.
- **CRITICAL (korunanlar):** VehicleDataLayer · GPS · Navigation (asla durdurulmaz).
- **Çıkış:** `_exitLimp()` — 500ms settle → Wave sırasıyla yeniden başlatma.
