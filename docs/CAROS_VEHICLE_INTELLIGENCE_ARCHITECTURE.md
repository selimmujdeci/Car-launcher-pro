# CarOS Pro — Vehicle Intelligence OS Mimarisi

> **Doküman türü:** Üretime yön veren mimari tasarım (kod değil).
> **Kapsam:** CarOS Pro'nun BUGÜN var olan araç zekâsı katmanının üstüne oturan,
> onunla uyumlu, genişleyebilir "Vehicle Intelligence OS" mimarisi.
> **Temel ilke:** Sıfırdan hayalî sistem değil — mevcut olgun altyapının
> (VehicleCompute.worker, VAL/SAB füzyonu, UnifiedVehicleStore, SystemOrchestrator,
> companion beyin zinciri) formelleştirilmesi ve eksik motorların bu çerçeveye
> yerleştirilmesi.
> **Son güncelleme kaynağı:** kod tabanı taraması (feat/obd-core-v2 dalı).

---

## ⭐ Kuzey Yıldızı — CarOS Pro Vizyon Sözleşmesi (bağlayıcı)

> **CarOS Pro bir launcher değildir. Aracın ikinci beynidir.**
> Referans **Tesla değildir.** Tesla yalnızca kendi araçlarını tanır; CarOS Pro
> yüzlerce **bilinmeyen** marka/modeli **öğrenmek** zorundadır. Bu yüzden bizim
> zekâmız Tesla'nınkinden **daha güçlü olmak zorunda** — çünkü biz garantili OEM
> verisiyle değil, güvenilmez aftermarket telemetriyle çalışıyoruz.

**Aftermarket paradoksu (mimarinin çıkış noktası):** OEM aracını *bilir*; biz
aracı *tahmin ederiz*. OEM sensörüne *güvenir*; biz **hiçbir sinyale peşinen
güvenmeyiz** (zero-trust telemetry). Bu kısıt bir zayıflık değil — sistemin en
ayırt edici gücüdür: güven, tahmin ve kendini-adapte etme katmanları bu
zorunluluktan doğar.

### Sinyal Karar Sözleşmesi — "8 Kapı"

> **Hiçbir veri yalnızca ekranda gösterilmek için okunmaz. Her sinyal bir kararın
> parçasıdır.** Bir PID eklemek başarı değildir; o PID'den **anlam** üretmek
> başarıdır. Sisteme giren her sinyal aşağıdaki 8 kapıdan geçer — her kapının
> sahibi bir motordur:

| # | Soru | Sahip motor | Değişmez kural |
|---|------|-------------|----------------|
| 1 | Bu veri gerçekten doğru mu? | **Confidence (K4)** + sanity (SignalNormalizer/worker) | Güvenilmeyen veri karara giremez |
| 2 | Bu veri önemli mi? | **Rule (3)** + Intelligence (2) | Önemsizse sessiz kalır (gürültü yasak) |
| 3 | Kullanıcı bunu bilmeli mi? | **Action (6)** + Notification (13) | Bilmesi gerekmiyorsa uyarı üretme |
| 4 | Yoksa sadece sistem mi bilmeli? | **Vehicle Digital Twin (K3)** / log | Arka plan sağlık, kullanıcıyı yorma |
| 5 | Başka hangi verilerle anlam kazanır? | **Fusion (1) + Context (5)** | Tek sinyal ≠ karar; birleşim şart |
| 6 | Bundan 5 dk sonra ne olacak? | **Prediction (K1)** | Eşik değil trend; sorun oluşmadan öngör |
| 7 | Kullanıcının yerine ne karar alabiliriz? | **Intent (K5) → Vehicle Brain (K6)** | Sahte onay yasak; gerçek aksiyon |
| 8 | Şu an en doğru aksiyon nedir? | **Vehicle Brain (K6) → Action (6)** | Confidence + öncelik arbitrajı |

Bu 8 kapı, dokümandaki 15 + 6 motorun **neden** var olduğunun tek cümlelik
gerekçesidir. Yeni her özellik bu zincire bir kapıdan katılır.

### Tasarım Testi (her PR için)

> **"Bu özellik Tesla'dan daha akıllı mı?"** — Değilse yeniden tasarla.
> "Akıllı" ölçütü: veriyi *gösteriyor* mu, yoksa *doğruluyor + yorumluyor +
> öngörüyor + karar veriyor* mu? Sadece gösteren her özellik yarım kalmıştır.

**Bağlayıcı mimari nitelikler:** self-learning · confidence-driven ·
prediction-driven · context-aware · event-driven · fail-soft · Vehicle Digital
Twin · Driver Digital Twin · zero-trust telemetry · multi-source fusion ·
AI-native decision engine. Bundan sonraki **her mimari karar bu 11 niteliği ve 8
kapıyı korumak/güçlendirmek zorundadır.**

---

## 0. Yönetici Özeti — Mevcut Durum vs Hedef

CarOS Pro'da "araç zekâsı" **zaten katmanlı bir mimari olarak fiilen mevcut**.
Ham sensör → normalize → füzyon → semantik olay → aksiyon zinciri kurulu ve
üretim kalitesinde (SAB/Seqlock, TMR odometre, histerezis, confidence füzyonu).
Bu doküman **yeni bir sistem dayatmaz**; var olanı 15 motorluk bir referans
modele oturtur, boşlukları işaretler ve büyüme kurallarını sabitler.

| Durum | Anlamı |
|-------|--------|
| ✅ MEVCUT | Kod tabanında üretim kalitesinde çalışıyor |
| 🟡 KISMEN | Çekirdek var ama dağınık / tek üretici eksik / UI'a bağlı değil |
| 🔴 EKSİK | Kavram var ama motor olarak yok |

---

## A. Katmanlı Zekâ Mimarisi (Çekirdek Felsefe)

### A.1 Değişmez İlke — "UI asla ham veri okumaz"

> **UI ve tüm tüketiciler yalnızca Vehicle State katmanını okur; hiçbir bileşen
> ECU / adaptör / ham CAN frame'ine dokunmaz.**

Bu ilke kodda zaten uygulanıyor:
- Bileşenler `useUnifiedVehicleStore` (tek "Veri Evi") okur — `UnifiedVehicleStore.ts:1-15`.
- Ham adaptör verisi yalnızca `VehicleSignalResolver` içinden worker'a akar; UI'a
  asla ulaşmaz — `VehicleSignalResolver.ts:137-168`.
- AI asistanına bile **ham OBD/CAN gitmez**; yalnızca yorumlanmış bağlam cümlesi
  gider — `companionChatProvider.ts:16-19, 265-335`.

Bu doküman bu ilkeyi mimarinin **1 numaralı invaryantı** olarak sabitler. Yeni
her motor bu kurala uymak zorundadır: veri yukarı akar (sensör→state), komut
aşağı akar (aksiyon→donanım), yatay kısa devre YASAK.

### A.2 Katman Diyagramı

```
┌──────────────────────────────────────────────────────────────────────────┐
│  KATMAN 7 — TÜKETİCİLER (UI / Animasyon / Ses / Asistan / Bildirim)        │
│  React bileşenleri · TeslaLayout/Horizon/Expedition · ttsService           │
│  companionChatProvider · notificationService · AdaptiveRuntimeManager      │
└──────────────────────────────────────────────────────────────────────────┘
                    ▲ okur (subscribe)          ▲ olay (onVehicleEvent)
┌───────────────────┴───────────────────────────┴──────────────────────────┐
│  KATMAN 6 — ACTION ENGINE (SystemOrchestrator)                            │
│  Semantik olay → UI kararı: alert ekle, TTS konuş, harita aç, reverse     │
│  suppress, trip özeti. Tek yetkili "beyin" — UI direkt olay dinlemez.     │
└──────────────────────────────────────────────────────────────────────────┘
                    ▲ karar girdisi
┌───────────────────┴───────────────────────────────────────────────────────┐
│  KATMAN 5 — RULE / DECISION (VehicleEventHub + CognitivePriorityEngine)    │
│  Histerezis kuralları (worker) → semantik olay · Bilişsel yük → 6 mod      │
└──────────────────────────────────────────────────────────────────────────┘
                    ▲ türetilmiş durum
┌───────────────────┴───────────────────────────────────────────────────────┐
│  KATMAN 4 — INTELLIGENCE / CONTEXT / PREDICTION                            │
│  useVehicleIntelligenceStore (güven, termal, sürüş karakteri)             │
│  contextEngine · smartDrivingEngine · maintenanceBrain · smartMarkov       │
└──────────────────────────────────────────────────────────────────────────┘
                    ▲ temiz araç durumu
┌───────────────────┴───────────────────────────────────────────────────────┐
│  KATMAN 3 — VEHICLE STATE ENGINE (VehicleCompute.worker → UnifiedStore)    │
│  Füzyon · sanity · odometre (TMR) · semantik olay üretimi · geofence       │
│  Tek yazar. UnifiedVehicleStore = Source of Truth.                         │
└──────────────────────────────────────────────────────────────────────────┘
                    ▲ NormalizedVehicleData (VEHICLE_DATA)
┌───────────────────┴───────────────────────────────────────────────────────┐
│  KATMAN 2 — SIGNAL NORMALIZATION (SignalNormalizer + VAL + SAB/Seqlock)    │
│  Birim standardizasyonu (km/h,%,°C,kPa,V) · confidence · zero-copy kanal   │
└──────────────────────────────────────────────────────────────────────────┘
                    ▲ ham adaptör verisi (onData)
┌───────────────────┴───────────────────────────────────────────────────────┐
│  KATMAN 1 — SENSOR INGESTION (Adaptörler)                                  │
│  CanAdapter · ObdAdapter · GpsAdapter · NativeHALAdapter                   │
│  obdService (ELM327/BLE/TCP) · canBus/* (Hiworld/NWD SDK) · gpsService     │
└──────────────────────────────────────────────────────────────────────────┘
```

### A.3 Veri Yönü Kuralı

```
YUKARI (telemetri):   Sensör → Normalize → State → Zekâ → Kural → Aksiyon → UI
AŞAĞI  (komut):       Asistan/UI → Action Engine → servis → adaptör → donanım
YASAK  (kısa devre):  UI ⇸ adaptör, bileşen ⇸ ECU, motor ⇸ ham frame
```

Aşağı yön mevcut: `remoteCommandService`, `commandExecutor`, `appLauncher`,
`cameraService.openRearCamera` (reverse aksiyonu) — hepsi Action Engine
üzerinden veya store aksiyonu üzerinden tetiklenir, hiçbiri UI'dan ham donanıma
gitmez.

---

## B. 15 Motor — Referans Model

Her motor: **Sorumluluk · Girdi · Ürettiği state/event · İlişki · Frekans ·
Kod karşılığı · Durum · Öncelik**.

> **Önemli tasarım notu:** "Motor" burada mutlaka bir sınıf demek değil. CarOS
> Pro'da motorlar üç biçimde yaşıyor: (a) worker içi saf fonksiyon grupları,
> (b) modül-düzeyi servis (start/stop + listener), (c) Zustand store + üretici.
> Bu doküman bu üç biçimi de "motor" sayar; hedef, **her motorun tek ve net bir
> sahibinin olması** ve kural/eşiklerinin dağınık olmaması.

---

### 1. Vehicle State Engine ✅ MEVCUT (mimarinin kalbi)

- **Sorumluluk:** Ham çok-kaynaklı sinyalden tek, temiz, güvenilir araç durumu
  üretmek. Füzyon, sanity reddi, odometre bütünlüğü, semantik olay tetikleme.
- **Girdi:** `VEHICLE_DATA` (NormalizedVehicleData, kaynak: HAL/CAN/OBD/GPS),
  geofence zonları, restore-odo.
- **Ürettiği:** SAB zero-copy kanalına speed/rpm/fuel/odometer/reverse; ana
  thread'e `STATE_UPDATE` / `ODO_UPDATE` / `VEHICLE_EVENT` / `GPS_FAILURE`.
  Nihai tüketici: `UnifiedVehicleStore`.
- **İlişki:** Tüm üst katmanların tek beslemesi. Rule Engine (VehicleEventHub)
  bunun içinde gömülü çalışır.
- **Frekans:** HOT-PATH. Speed 3Hz (`SPEED_INTERVAL_MS=300`), fuel 8s,
  watchdog 1s. SAB polling UI tarafında 16–100ms (moda göre).
- **Kod:** `vehicleDataLayer/VehicleCompute.worker.ts` (1261 satır),
  `VehicleSignalResolver.ts`, `UnifiedVehicleStore.ts`.
- **Öncelik:** 0 (temel — hepsi buna bağlı).

Güçlü yanlar (korunmalı): confidence×tazelik füzyonu (`worker:780-822`),
TMR median-of-3 odometre + self-healing (`worker:187-214`), Seqlock yazım
(`worker:295-296`), zero-allocation envelope'lar (`worker:304-338`).

---

### 2. Vehicle Intelligence Engine 🟡 KISMEN

- **Sorumluluk:** Temiz durumdan **türetilmiş sağlık/güven/karakter** metrikleri:
  telemetri güven skoru, bağlantı kalitesi (jitter/fidelity), termal borç,
  sürüş karakteri (agresiflik/pürüzsüzlük/ekonomi), plausibility raporu.
- **Girdi:** UnifiedVehicleStore sinyalleri, PID tazeliği, coolant trendi.
- **Ürettiği:** `useVehicleIntelligenceStore` alanları (healthState, trustScore,
  thermalStatus, drivingCharacter, stalePIDs).
- **İlişki:** CognitivePriorityEngine, maintenanceBrain, AI Assistant (bağlam),
  DiagnosticPanel bunu okur.
- **Frekans:** Throttle ~1Hz / sürüş karakteri kayan pencere.
- **Kod:** `store/useVehicleIntelligenceStore.ts` **var ve zengin** — ama
  **üretici (producer) dağınık/eksik**: store'u besleyen tek merkezi analyzer
  net değil. Bu, doldurulması gereken en önemli boşluk.
- **Öncelik:** 2. **Öneri:** `TelemetryIntelligence` adında tek üretici servis
  (worker veya main throttled) bu store'un tek yazarı olsun (State Engine'in
  `VehicleEventHub` yazması gibi).

---

### 3. Rule Engine 🟡 KISMEN (var ama gömülü)

- **Sorumluluk:** Durum eşiklerini **histerezisli** semantik olaya çevirmek:
  DRIVING_STARTED/STOPPED, LOW/CRITICAL_FUEL, REVERSE, GEOFENCE, MAINTENANCE,
  CRASH.
- **Girdi:** hız, yakıt, reverse, konum, healthScore, peakG.
- **Ürettiği:** `VehicleEvent` (severity: CRITICAL/WARNING/INFO).
- **İlişki:** Action Engine tek tüketici. Kurallar şu an **worker'a gömülü**
  (`worker:445-491` fuel/driving/reverse histerezisi) + harici dispatcher'lar
  (`VehicleEventHub.ts:74-103` maintenance/crash/geofence).
- **Frekans:** State Engine tick'lerine bağlı (event-driven).
- **Kod:** `VehicleEventHub.ts` (dağıtım) + worker histerezis fonksiyonları.
- **Öncelik:** 1. **Not:** Kural eşikleri şu an sabitler halinde worker içinde
  (`DRIVE_ON_KMH`, `LOW_FUEL_ON`...). Hedef: yeni kurallar (ENGINE_OVERHEAT,
  BATTERY_LOW, HARSH_BRAKING) aynı histerezis desenine eklensin — **yeni kural =
  yeni `VehicleEventType` + worker histerezis bloğu**, dağıtım otomatik.

**Genişletme boşluğu:** `smartCardEngine.ts:22-25` açıkça belirtiyor —
"ENGINE_OVERHEAT eventi eklendiğinde aşağıdaki aboneliğe eklemek yeterli".
Bu, Rule Engine'in genişleme deseninin zaten planlandığının kanıtı.

---

### 4. Action Engine ✅ MEVCUT

- **Sorumluluk:** Semantik olayı somut UI/ses/nav aksiyonuna çevirmek. Tek
  yetkili karar merkezi.
- **Girdi:** `onVehicleEvent`, `onTripState`, `onThermalLevelChange`.
- **Ürettiği:** `useSystemStore` mutasyonları (alert, reverse, driving,
  navOpenTrigger, tripSummary), `speakAlert`, `showToast`.
- **İlişki:** UI **yalnızca** useSystemStore okur — direkt olay dinlemez
  (`SystemOrchestrator.ts:1-19`). Reverse suppress mantığı burada (`:155-178`).
- **Frekans:** Event-driven (poll yok).
- **Kod:** `system/SystemOrchestrator.ts`.
- **Öncelik:** 1.

---

### 5. Context Engine ✅ MEVCUT

- **Sorumluluk:** GPS+zaman+OBD bağlamından öneri üretmek (işe git/eve git,
  yakıt/motor uyarısı, bakım). Tamamen yerel, ağsız.
- **Girdi:** konum, ev/iş konumu, saat, OBD snapshot (fuel/temp/connected),
  bakım bilgisi.
- **Ürettiği:** `CtxSuggestion[]` (priority sıralı) + locationCtx/timeCtx.
- **İlişki:** smartCardEngine, UI öneri kartları.
- **Frekans:** Konum/ayar/OBD-eşik değişiminde (React hook).
- **Kod:** `contextEngine.ts` (`useContextEngine`, `buildSuggestions:122-223`).
- **Öncelik:** 3.

---

### 6. Prediction Engine 🟡 KISMEN

- **Sorumluluk:** Geleceği tahmin: sonraki uygulama (Markov), arıza/bakım
  eğilimi, yakıt/menzil öngörüsü, alışkanlık.
- **Girdi:** uygulama açılış geçmişi, wear birikimi, coolant trend, trip geçmişi.
- **Ürettiği:** öneri olasılıkları, `MAINTENANCE_REQUIRED`, oilLife tahmini.
- **İlişki:** smartCardEngine, Action Engine.
- **Frekans:** düşük (throttle 8s / 2dk degraded).
- **Kod:** `smartMarkovEngine.ts`, `smartRecommendationEngine.ts`,
  `diagnostic/maintenanceBrain.ts` (predictive wear/oil), `smartEngine.ts`.
- **Öncelik:** 4. **Not:** parça parça mevcut; tek "tahmin" namespace'i altında
  toplanması ileride faydalı (opsiyonel).

---

### 7. Driver Profile Engine 🟡 KISMEN / DAĞINIK

- **Sorumluluk:** Sürücüyü/aracı tanıma: kişilik, hitap, sürüş karakteri, araç
  profili (VIN/tip/motor hacmi/yağ), kişisel hafıza.
- **Girdi:** ayarlar, sürüş karakteri metrikleri, companion etkileşim.
- **Ürettiği:** `CompanionIdentity`, `VehicleProfile`, `drivingCharacter`,
  companion memory fact'leri.
- **İlişki:** AI Assistant (prompt), maintenanceBrain (kalibrasyon),
  SafetyBrain (VIN başına profil).
- **Frekans:** yavaş değişen.
- **Kod:** `companion/companionIdentity.ts`, `store/useStore.ts` (vehicleProfiles),
  `companion/companionMemory.ts`, `useVehicleIntelligenceStore` (drivingCharacter).
- **Öncelik:** 5. **Not:** Dağınık; tek "kim sürüyor + hangi araç" görünümü
  yok. Konsolidasyon ileride (opsiyonel, düşük risk).

---

### 8. Safety Engine ✅ MEVCUT (dağınık ama güçlü)

- **Sorumluluk:** Güvenlik gözlem + preemption: fren mesafesi, eğri güvenli hız,
  hava/sürtünme, çarpışma, geri vites önceliği, tekrarlayan arıza → özellik
  kapatma.
- **Girdi:** hız, rota adımları, hava kodu, risk skoru, DAB, peakG, VIN.
- **Ürettiği:** `useSafetyStore` (safetyState, braking/reaction distance),
  `CRASH_DETECTED`, feature-disable kararı, sesli güvenlik uyarısı.
- **İlişki:** Action Engine (reverse suppress), CognitivePriorityEngine, UI
  overlay (reverse z-index 100000).
- **Frekans:** `safetyService` 200ms tick; SafetyBrain event-driven.
- **Kod:** `safetyService.ts`, `safety/SafetyBrain.ts`, `security/blackBoxService.ts`
  (crash), worker reverse mantığı.
- **Öncelik:** **EN YÜKSEK (preemptive).** Bkz. §F.

---

### 9. Energy Engine 🟡 KISMEN

- **Sorumluluk:** Enerji/yakıt/şarj yönetimi: 12V akü koruması, EV batarya
  seviyesi/şarj durumu, yakıt/menzil, tüketim.
- **Girdi:** batteryVolt (CAN), EV battery PID'leri, fuel, RuntimeMode.
- **Ürettiği:** POWER_SAVE mod tetiği, menzil bağlamı, düşük voltaj koruması.
- **İlişki:** AdaptiveRuntimeManager (POWER_SAVE), AI Assistant (menzil),
  Context Engine (yakıt uyarısı).
- **Frekans:** düşük.
- **Kod:** `power/BatteryProtectionService.ts`, EV PID'leri (`obdPidConfig.ts`,
  `StandardPidRegistry.ts` PID 5B hibrit batarya), companionContext menzil.
- **Öncelik:** 6. **Not:** ICE yakıt yolu olgun; EV enerji yolu (batarya SoC/
  şarj) OEM-specific PID'lere bağlı ve kısmen. Zoe profili (hafıza) buraya oturur.

---

### 10. Comfort Engine 🔴 EKSİK / PASİF

- **Sorumluluk:** Konfor: klima/ısı, koltuk, iç aydınlatma, ambiyans, mola
  hatırlatma.
- **Girdi:** ambientTemp, airCondition (CAN extras var), sürüş süresi.
- **Ürettiği:** konfor önerileri, mola uyarısı.
- **İlişki:** Context/Action Engine.
- **Frekans:** düşük.
- **Kod:** `breakReminderService.ts` (mola) var; iklim/koltuk **sinyal olarak
  UnifiedVehicleStore'da mevcut** (`canAirCondition`, `canAmbientTemp`) ama
  **karar üreten motor yok**.
- **Öncelik:** 9 (en düşük). CAN extras zaten akıyor → düşük maliyetle eklenebilir.

---

### 11. Maintenance Engine ✅ MEVCUT

- **Sorumluluk:** Kestirimci bakım: kümülatif aşınma (healthScore), yağ ömrü,
  bakım hatırlatma, araç-tipi/motor-hacmi kalibrasyonu.
- **Girdi:** rpm, temp, throttle, odometer, VehicleProfile.
- **Ürettiği:** `BrainState` (healthScore/oilLife/wearRate), `MAINTENANCE_REQUIRED`.
- **İlişki:** Rule/Action Engine, Context Engine, DiagnosticPanel.
- **Frekans:** OBD tick (degraded'de 2dk throttle). Persist 30s debounce.
- **Kod:** `diagnostic/maintenanceBrain.ts`, `vehicleReminderService.ts`.
- **Öncelik:** 4.
- **Güç:** performance.now() delta (saat-jump bağımsız), histerezisli tek
  tetikleme (`:311-316`).

---

### 12. AI Assistant Engine ✅ MEVCUT (güçlü)

- **Sorumluluk:** Doğal dil sohbet + komut. Hibrit yönlendirme, offline Vosk,
  yorumlanmış araç bağlamı, güvenlik filtresi.
- **Girdi:** STT metni (n-best), yorumlanmış araç bağlamı, kimlik, isDriving.
- **Ürettiği:** TTS yanıtı + `SemanticResult` (ACTION/CHAT) → commandExecutor.
- **İlişki:** State katmanından **yorumlanmış** bağlam alır (ham veri YOK);
  Action Engine'e gerçek aksiyon üretir (sahte onay YASAK).
- **Frekans:** kullanıcı tetikli.
- **Kod:** `companion/companionChatProvider.ts` (beyin zinciri
  Gemini→Groq→Haiku, `:44,77`), `voiceService.ts`, `commandExecutor.ts`,
  `ai/semanticAiService.ts`, Vosk native.
- **Öncelik:** 3. Bkz. §G.

---

### 13. Notification Engine ✅ MEVCUT

- **Sorumluluk:** Telefon bildirim yansıtma + TTS okuma + sesli yanıt; sistem
  toast/alert.
- **Girdi:** Android NotificationListenerService, sistem uyarıları.
- **Ürettiği:** `NotificationState`, TTS okuma, `showToast`.
- **İlişki:** Action Engine (alert), TTS, Cognitive shedding.
- **Frekans:** event-driven.
- **Kod:** `notificationService.ts`, `errorBus.ts` (toast).
- **Öncelik:** 6.

---

### 14. Animation Engine ✅ MEVCUT

- **Sorumluluk:** Render bütçesi, FPS hedefi, animasyon/blur/gölge açma-kapama,
  canlı CSS custom-property sync.
- **Girdi:** RuntimeMode, thermal level, cognitive mode, device tier.
- **Ürettiği:** `RuntimeConfig` (uiFpsTarget 15/20/30/60, enableAnimations/
  Blur/Shadows), `--rt-anim` CSS değişkenleri, gauge smoothing.
- **İlişki:** CognitivePriorityEngine (`setMode BASIC_JS`), tüm UI.
- **Frekans:** mod değişiminde + rAF smoothing.
- **Kod:** `core/runtime/AdaptiveRuntimeManager.ts`, `liveStyleEngine.ts`,
  `rafSmoother.ts`.
- **Öncelik:** 5.

---

### 15. Theme Behavior Engine 🟡 KISMEN

- **Sorumluluk:** Tema seçimi + gün/gece + duruma-tepkili görsel davranış
  (sportif vurgu, sakin mod, golden-hour aksан).
- **Girdi:** dayNightMode, kullanıcı override, hız/sürüş modu, saat, ALS/OBD.
- **Ürettiği:** aktif tema (Tesla/Horizon/Expedition/Pro), palet, canlı aksan.
- **İlişki:** Animation Engine, CognitivePriorityEngine, Action Engine
  (userOverrideUntil).
- **Frekans:** düşük + saat/gün-gece.
- **Kod:** `store/useCarTheme.ts`, `hooks/useLivingThemeState.ts`,
  `hooks/useDayNightAttr.ts`, `liveStyleEngine.ts`, tema layout'ları.
- **Öncelik:** 7. **Not:** Gün/gece + tema seçimi olgun; **"araç durumuna
  tepkili tema davranışı"** (Action Matrix §E'deki sportif/sakin geçişler)
  kısmen — canlı aksan var, ama hız/RPM→tema vurgusu bağı zayıf.

---

### Motor İlişki Haritası (özet)

```
State Engine (1) ──┬──► Intelligence (2) ──► Cognitive (5) ──► Animation (14)/Theme (15)
                   ├──► Rule (3) ──► Action (6) ──► UI / TTS / Notification (13)
                   ├──► Context (5) ──► Prediction (6) ──► smartCard ──► Action
                   ├──► Maintenance (11) ──► Rule ──► Action
                   ├──► Safety (8) ══► PREEMPT ══► herkesi ezer
                   └──► Energy (9) ──► RuntimeManager (POWER_SAVE)
Driver Profile (7) ──► AI Assistant (12) ◄── yorumlanmış bağlam ── State Engine
Comfort (10) ──► Context/Action   (şu an pasif)
```

---

## C. OBD PID Analizi

CarOS Pro iki katmanda PID okur:

1. **Çekirdek poll (native, sürekli):** araç-tipine göre daraltılmış liste —
   `obdPidConfig.ts:14-30`. EV'de sadece `0x0D`; ICE'de `0x0D,0x0C,0x05,0x11,0x0F`;
   dizelde ek `0x0B`. **Gerekçe:** desteklenmeyen PID her sorguda ~200ms NO-DATA
   → RFCOMM bozulması (`obdPidConfig.ts:6-12`).
2. **Genişletilmiş katalog (talep-üzeri / panel):** SAE J1979 tam sayısal tablo
   ~63 PID — `StandardPidRegistry.ts:52-133`. `core:true` olanlar ana akıştan
   beslenir, EXTENDED grupta çift sorgulanmaz (`:143-145`).

> **Lisans notu (CLAUDE.md):** tablo yalnızca kamu standardı SAE J1979 Tablo B.1
> formüllerinden; hiçbir 3. taraf uygulamadan liste alınmadı (`StandardPidRegistry.ts:5-6`).

| PID | Ad | Ne işe yarar | Ne zaman kritik | UI'da? | Arka plan? | Tüketen motor | Animasyon | Sesli uyarı | AI önerisi |
|-----|----|--------------|-----------------|--------|-----------|---------------|-----------|-------------|------------|
| 0x0D | Araç hızı | Temel sürüş | Her zaman | ✅ gösterge | ✅ hot | State, Safety, Maintenance | Hız ibresi | — | "yavaşla" (Safety) |
| 0x0C | Motor devri | Yük/vites hissi | Yüksek RPM+düşük hız | ✅ gösterge | ✅ hot | State, Maintenance | Devir animasyonu | — | Sürüş verimi ipucu |
| 0x05 | Soğutma sıcaklığı | Termal sağlık | >105°C | ✅ | ✅ | Maintenance, Safety, Intelligence | Isı barı kırmızı | ✅ "motor ısındı" | "güvenli yere çek" |
| 0x2F | Yakıt seviyesi | Menzil | <%15 / <%5 | ✅ | ✅ | Rule (LOW/CRIT_FUEL), Context | Yakıt barı | ✅ kritik yakıt | "istasyona git" |
| 0x11 | Gaz kelebeği | Sürüş agresifliği | Ani tam gaz | 🟡 | ✅ | Maintenance (wear), Intelligence | — | — | Ekonomi önerisi |
| 0x0F | Emme havası sıc. | Motor verimi | Aşırı sıcak hava | 🟡 | ✅ | Maintenance | — | — | — |
| 0x0B | Manifold basınç (MAP) | Turbo/yük (dizel) | Boost anomalisi | 🟡 | ✅ (dizel) | Intelligence | — | — | — |
| 0x04 | Motor yükü | Yük stresi | Uzun yüksek yük | panel | talep | Maintenance | — | — | Verimlilik |
| 0x0A | Yakıt basıncı | Yakıt sistemi | Düşük basınç | panel | talep | Diagnostic | — | — | Arıza ipucu |
| 0x10 | MAF | Hava akışı/verim | Sensör sapması | panel | talep | Diagnostic | — | — | — |
| 0x06–0x09 | Yakıt trim (KT/UT B1/B2) | Karışım sağlığı | ±%10 dışı | panel | talep | Diagnostic | — | — | "karışım dengesiz" |
| 0x0E | Ateşleme avansı | Motor ayarı | — | panel | talep | Diagnostic | — | — | — |
| 0x14–0x1B | O2 voltajları | Emisyon/katalizör | Sabit/düz sinyal | panel | talep | Diagnostic | — | — | Katalizör ipucu |
| 0x24–0x2B | O2 lambda | Karışım hassas | λ sapması | panel | talep | Diagnostic | — | — | — |
| 0x2C–0x2E | EGR/EVAP | Emisyon | Arıza | panel | talep | Diagnostic | — | — | Emisyon uyarısı |
| 0x33 | Barometrik basınç | Rakım düzeltme | — | panel | talep | Diagnostic | — | — | — |
| 0x3C–0x3F | Katalizör sıcaklığı | Katalizör sağlığı | Aşırı ısı | panel | talep | Maintenance | — | — | "katalizör riski" (decode şüpheli, hafıza) |
| 0x42 | Kontrol ünitesi voltajı | Elektrik/akü | <12V | panel | talep | Energy | — | 🟡 | "akü zayıf" |
| 0x43 | Mutlak motor yükü | Yük | — | panel | talep | Maintenance | — | — | — |
| 0x46 | Ortam hava sıcaklığı | Konfor/hava | — | 🟡 | talep | Comfort, Safety (μ) | — | — | — |
| 0x5C | Motor yağı sıcaklığı | Yağ sağlığı | Aşırı ısı | 🟡 | talep | Maintenance | — | 🟡 | "yağ ısındı" |
| 0x5E | Yakıt tüketim hızı | Anlık tüketim | — | 🟡 | talep | Energy, Prediction | — | — | Ekonomi koçu |
| 0x5B | Hibrit batarya kalan ömür | EV/hibrit enerji | Düşük SoH | 🟡 | talep | Energy | Batarya barı | 🟡 | "batarya sağlığı" |
| 0x52 | Etanol oranı | Flex-fuel | — | panel | talep | Diagnostic | — | — | — |
| 0x61–0x63 | Tork (talep/gerçek/ref) | Performans | — | panel | talep | Intelligence | — | — | Performans içgörüsü |
| 0x1F/0x21/0x31/0x4D | Süre/mesafe sayaçları | Teşhis/emisyon | MIL yanık | panel | talep | Diagnostic | — | — | Arıza geçmişi |

**Boşluklar / eylem:**
- 🔴 **Motor sıcaklığı State Engine'e akmıyor:** `smartCardEngine.ts:22-25`
  ENGINE_OVERHEAT olayının henüz olmadığını doğruluyor. Katmanlı mimaride
  0x05'i çekirdek pola sokup `ENGINE_OVERHEAT` VehicleEvent'i eklemek en yüksek
  ROI'li iyileştirme.
- 🟡 **0x3C katalizör decode** sahada doğrulanmamış (hafıza notu) — AI önerisi
  üretmeden önce doğrulanmalı.
- 🟡 **EV enerji PID'leri** OEM-specific; StandardPidRegistry yalnız 0x5B
  standardını kapsar. Zoe/EV profilleri için OEM PID genişlemesi (§I).

---

## D. Olay Sistemi & State Machine'ler

### D.1 Event Bus Tasarımı

Mevcut event bus'lar (isim uzayına göre):

| Bus | Namespace | Öncelik modeli | Kod |
|-----|-----------|----------------|-----|
| VehicleEventHub | araç semantik | severity (CRITICAL/WARNING/INFO) | `VehicleEventHub.ts` |
| drawerBus / settingsFocusBus | UI navigasyon | — | `drawerBus.ts` |
| errorBus | toast/hata | type (error/warning/info) | `errorBus.ts` |
| onWeatherState / onTripState / onDTCState | servis akışları | son-değer yakalama | ilgili servisler |

**Zero-allocation ilkesi (CLAUDE.md V8/JIT) — mevcut ve korunmalı:**
- Pre-allocated envelope'lar: `worker:304-338`, `VehicleEventHub.ts:74-95`.
- Monomorphic dispatch: worker'da tip-daraltılmış handler'lar (`_handleEventSpeed/
  Fuel/Reverse`), megamorphic switch yerine.
- Listener uyarısı: olay nesnesi REFERANS ile gelir, worker sonraki olayda
  mutate eder → saklamak için shallow copy (`VehicleEventHub.ts:10-14`).

**Backpressure:** Şu an RAF-batching ile yapılıyor (`vehicleDataLayer/index.ts:95-136`):
STATE_UPDATE patch'leri pre-allocated `_pendingPatch`'te birikir, rAF'ta tek
flush; **reverse için anında flush istisnası** (kamera gecikmez, `:114-127`).
Bu desen mimarinin backpressure standardıdır — yeni yüksek-frekanslı olaylar
aynı RAF-batch + kritik-istisna modelini kullanmalı.

**Tasarım kuralı (yeni bus eklerken):**
1. Semantik araç olayı → **daima VehicleEventHub** (yeni `VehicleEventType`).
   Ayrı bus AÇMA.
2. Envelope pre-allocate et, `severity` ata.
3. Tüketici yalnızca Action Engine olsun (UI direkt dinlemesin — §B.4 ilkesi).

### D.2 Ana State Machine'ler

**(a) Sürüş Durumu** (park/şehir/otoban/trafik)
```
        speed<1                1≤speed<20              speed≥20
  ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
  │     idle     │◄──────►│    normal     │◄──────►│   driving     │
  │ (park/zengin │        │ (şehir/trafik │        │ (otoban/min.  │
  │  animasyon)  │        │  orta anim.)  │        │  UI, güvenlik)│
  └──────────────┘        └──────────────┘        └──────────────┘
  Histerezis: DRIVE_ON=5, DRIVE_OFF=3 km/h (worker:101-102)
  ISO 26262 "fail towards safety": herhangi kaynak >5 → kesinlikle hareket
  (smartDrivingEngine.ts:96-104, isDefinitelyMoving guard)
```

**(b) Bilişsel/Performans Modu** (6 seviye, `CognitivePriorityEngine.ts:61-73`)
```
IMMERSIVE ─► AWARE ─► FOCUSED ─► PROTECTION ─► CRITICAL ─► LIMP_HOME
   ▲                                                          │
   └──────── recovery 15s histerezis ◄────── eskalasyon anlık ┘
Girdi: thermalLevel + globalRiskScore + driverAttentionBudget
Shedding: PROTECTION/CRITICAL → community+voice PAUSE, anim BASIC_JS
```

**(c) Runtime/Performans Modu** (donanım/termal, `runtimeTypes.ts:26-33`)
```
PERFORMANCE ◄─► BALANCED ◄─► BASIC_JS ◄─► POWER_SAVE ◄─► SAFE_MODE
  60fps        30fps         20fps        (düşük V)      15fps/worker susar
Recovery 30s histerezis (AdaptiveRuntimeManager)
```

**(d) Güvenlik Durumu** (`safetyService.ts`, SafetyState)
```
CALM ─► ATTENTIVE ─► CAUTION ─► INTERVENTION
Histerezis: CAUTION_TRIGGER=0.90, RESET=0.78; INTV_TRIGGER=1.15, RESET=1.00
(safetyService.ts:47-51) — flicker önleme trigger≠reset bandı
```

**(e) Enerji/Güç Durumu** — 12V akü: `BatteryProtectionService` → POWER_SAVE
(11.8–12.0V, `runtimeTypes.ts:30-31`). EV SoC/şarj: OEM PID'e bağlı (kısmen).

**Histerezis kuralı (tüm makineler):** eskalasyon anlık, kurtarma gecikmeli;
trigger ve reset eşikleri **asla eşit değil** (dur-kalk trafiğinde titreme yok).

---

## E. Action Matrix

Durum × Aksiyon. UI davranışı + animasyon + ses + asistan + bildirim.

| Vehicle State / Event | UI davranışı | Animasyon | Ses | Asistan | Bildirim |
|-----------------------|--------------|-----------|-----|---------|----------|
| REVERSE_ENGAGED | Geri kamera overlay (z=100000), non-critical alert gizle | Kamera fade-in | — | Sus | Suppress |
| DRIVING_STARTED (oturum ilk) | Harita aç (navOpenTrigger) | idle→driving geçiş | — | — | — |
| driving (speed≥20) | Minimal UI, büyük tipografi | Animasyon azaltılır | — | Kısa yanıt modu | Sadece CRITICAL |
| Yüksek RPM + düşük hız | Sportif tema vurgusu | Devir animasyonu hızlanır | Sadece risk varsa | — | — |
| LOW_FUEL (<%15, histerezis) | Sarı yakıt uyarı kartı | Yakıt barı pulse | — | "yakıt azaldı, ~X km" | WARNING (8s) |
| CRITICAL_FUEL (<%5) | Kırmızı kart | Yakıt barı kırmızı | ✅ "yakıt kritik %X" | "istasyona git" | CRITICAL (12s) |
| ENGINE_OVERHEAT (>105°C)* | Kırmızı ısı barı + DTC drawer | Isı barı kırmızı pulse | ✅ "motor ısındı" | "güvenli yere çek" | CRITICAL |
| CRASH_DETECTED (peakG) | Kaza kartı + kayıt | — | ✅ "kaza tespit" | CRITICAL (12s) + blackbox |
| MAINTENANCE_REQUIRED (<40) | Bakım kartı | — | ✅ "bakım gerekli %X" | WARNING |
| GEOFENCE_EXIT/VIOLATION | Alarm | — | ✅ | — | CRITICAL |
| Safety INTERVENTION (eğri hız) | Güvenli hız uyarısı | — | ✅ "yavaşla" (15s soğuma) | — | — |
| Thermal L2/L3 | Termal toast, servis kes | Anim BASIC_JS | L3'te ✅ | Pause | warning/error toast |
| Cognitive PROTECTION/CRITICAL | UI sadeleşir | Blur/gölge kapanır | — | voice PAUSE | — |
| Gün → Gece | Palet koyulaşır | Golden-hour aksан → gece | — | — | — |
| POWER_SAVE (düşük V) | Sade UI | Anim min | — | — | 🟡 "akü zayıf" |

`*` ENGINE_OVERHEAT şu an EKSİK (§C boşluğu) — matriste hedef davranış olarak
gösterildi.

**Arbitraj kuralları (mevcut):**
- Reverse, non-critical her şeyi **suppress** eder (`SystemOrchestrator.ts:155-178`).
- Yakın dönüş (<50m) varsa güvenlik sesi atlanır — nav öncelikli
  (`safetyService.ts:174-179`).
- Aynı olayda CRITICAL_FUEL, LOW_FUEL'i aynı tick'te bastırır (`worker:465-472`).

---

## F. Güvenlik Öncelik Sistemi (Preemption)

> **İlke:** Safety Engine diğer her motoru ezebilir; hiçbir konfor/tema/asistan
> kararı bir güvenlik aksiyonunu geciktiremez veya bastıramaz.

### F.1 Öncelik Seviyeleri (yüksekten düşüğe)

```
P0  REVERSE / geri kamera        → overlay z-index 100000, her şeyi kapatır
P0  CRASH_DETECTED               → kayıt + sesli + kalıcı uyarı
P1  ENGINE_OVERHEAT / CRITICAL_FUEL → kırmızı, sesli, otomatik dismiss uzun
P1  Safety INTERVENTION (eğri/fren) → sesli "yavaşla"
P2  Thermal L3 (sistem tahliyesi) → LIMP_HOME, non-critical temizle
P2  GEOFENCE_VIOLATION            → alarm
P3  LOW_FUEL / MAINTENANCE (WARNING) → sarı kart
P4  Konfor / Context önerileri
P5  Tema / animasyon / golden-hour aksан
```

Kod kanıtı: reverse suppress (`SystemOrchestrator.ts:155-163`), Thermal L3
non-critical temizleme (`SystemOrchestrator.ts:104-121`), cognitive shedding
(`CognitivePriorityEngine.ts:87-103`).

### F.2 Fail-Soft (sensör ölürse UI çökmez)

- Kaynak stale → null bir kez emit, UI "sinyal yok" gösterir, çökmez
  (`worker:843-859`). Reverse: CAN+OBD ikisi de stale → overlay sıfırlanır
  (`worker:955-973`).
- Worker crash → fail-soft, gösterge boş kalır ama boot/UI ayakta
  (`VehicleSignalResolver.ts:99-105`).
- SAB yoksa (eski WebView / COOP+COEP yok) → postMessage fallback (Zero-Crash,
  `VehicleSignalResolver.ts:128-131`).
- Tekrarlayan arıza → o özellik VIN başına kalıcı devre dışı, sistem yaşamaya
  devam eder (`SafetyBrain.ts:158-177`).

### F.3 Sanitization Eşikleri (tasarıma dahil, mevcut)

| Kontrol | Eşik | Kod |
|---------|------|-----|
| Hız aralığı | 0 ≤ v ≤ 300 km/h | `worker:61,832` + store final gate `UnifiedVehicleStore.ts:190` |
| Anti-jitter | ~100ms'de >20 km/h sıçrama reddi | `worker:64,833` |
| RPM cross-check | OBD hız>10 ama rpm=0 → reddet (ICE imkânsız) | `worker:834` |
| Odometre monotonluk | geri gidiş reddi + 5km OBD jump guard | `worker:681-692`, store `:209-214` |
| GPS accuracy | >30m Haversine dışı; >100m 20s → GPS_FAILURE | `worker:78-82` |
| TMR bit-flip | median-of-3 + self-heal | `worker:196-214` |

**Genişleme kuralı:** yeni sensör eklendiğinde sanitization **normalize
katmanında** (SignalNormalizer / worker sanity) yapılır, UI'da değil. "İmkansız
veri UI'a ulaşmadan reddedilir" (obdSanitizer felsefesi, `StandardPidRegistry.ts:13`).

---

## G. AI Karar Katmanı

### G.1 Hibrit Yönlendirme

```
Kullanıcı konuşur (Vosk STT, n-best)
   │
   ▼ Güvenlik filtresi (voiceService._voiceCogPaused; PROTECTION/CRITICAL'da pause)
   ▼ Companion Router: net komut (≥0.7) → komut yolu; gerisi → beyin
   ▼ HİBRİT BEYİN ZİNCİRİ (SIRA SABİT): Gemini → Groq → Haiku
        (yalnız anahtarı girilmiş sağlayıcılar zincire girer)
   ▼ Sağlayıcı-bazlı 429 pencereleri (çapraz kirlenme YOK — companionChatProvider.ts:166-168)
   ▼ Web gerekiyorsa: Gemini google_search grounding → Tavily → dürüst fallback
   ▼ TTS (hibrit Piper klip bankası + eSpeak yedek)
```

Kod: `companionChatProvider.ts:1-25` (mimari), `:44,77` (route/chain),
`:339-343` (model), offline: `tryOfflineConversation`.

### G.2 State Katmanından Besleniş (invaryant: HAM VERİ YOK)

AI, State katmanından **yorumlanmış** bağlam alır — asla ham PID/CAN:
- Yakıt/menzil/motor ısısı → `interpretFuel/interpretEngineTempConcern`
  (`companionChatProvider.ts:265-335`).
- EV/hibrit yetenek notu → olmayan özellikten bahsetmeyi yapısal engeller
  (`:249-257`) — "EV'de RPM yok, uydurma".
- Gizlilik: konum/VIN/plaka prompt'a girmez, geçmiş yalnız RAM (`:20-24`).

### G.3 AI'ın Ürettiği Zekâ (state'ten beslenerek)

| Yetenek | Kaynak state | Durum |
|---------|--------------|-------|
| Sürücü tanıma | CompanionIdentity, drivingCharacter | 🟡 kısmen |
| Alışkanlık öğrenme | smartMarkov, companionMemory | 🟡 |
| Arıza tahmini | maintenanceBrain, DTC | ✅ (bakım) / 🟡 (arıza) |
| Bakım önerisi | BrainState (health/oil) | ✅ |
| Yakıt/menzil optimizasyonu | fuel, 0x5E tüketim, rota | 🟡 |
| Güvenlik risk öngörüsü | safetyState, hazard, hava | ✅ (gözlem) |

### G.4 Action Engine'e Öneri (sahte onay YASAK)

AI komut ürettiğinde **gerçek aksiyon** olur — `commandExecutor` üzerinden
uygulama açma / ekran / ayar. "İşlem tamamlandı" deyip hiçbir şey yapmama YASAK
(hafıza: assistant-app-control). Öneri ≠ uydurma onay.

### G.5 Offline / Online Ayrımı

- **Online + BYOK:** tam beyin zinciri + web grounding.
- **Offline (head unit internetsiz):** Vosk STT + `tryOfflineConversation` +
  yerel parser; hava gibi cihazda mevcut veriler AI'sız cevaplanır
  (`companionChatProvider.ts:556-600`).
- **BYOK zorunlu:** merkezi/gömülü API anahtarı YOK (CLAUDE.md ticari kural).

---

## H. Performans Mimarisi

### H.1 V8/JIT (CLAUDE.md uyumlu, mevcut)

- **Hidden class kararlılığı:** template literal nesneler, sabit property sırası;
  worker envelope'ları bunu uygular (`worker:304-338`).
- **Monomorphic call sites:** tip-daraltılmış handler'lar (megamorphic switch
  yerine), `worker:445-491`.
- **Zero-allocation hot-path:** scratch primitifler (`_resolvedSpeed/_resolvedSrc`,
  `worker:770-771`), pre-allocated envelope, `for...in` erken dönüş allocation
  kaçınması (`vehicleDataLayer/index.ts:69-72`).

### H.2 SAB Seqlock + Cache-Line Padding

- 512-byte SAB; her 64-bit sinyal ayrı 64-byte cache line (False Sharing yok),
  GEN counter ayrı satırda (`VehicleSignalResolver.ts:33-43`, `worker:261-296`).
- Seqlock: `Atomics.add(GEN,1)` tek=yazılıyor / çift=bitti; okuyucu double-check
  guard (g1==g2, `VehicleSignalResolver.ts:244-263`).
- Fallback: crossOriginIsolated yoksa postMessage (Zero-Crash).

### H.3 Worker Mimarisi

- VehicleCompute **classic IIFE** worker (Chrome 52+ eski head unit WebView
  uyumu) — module worker (Chrome 80+) DEĞİL; dev'de module, prod'da Vite
  `worker.format:'iife'` zorlar (`VehicleSignalResolver.ts:74-88`). Head unit
  uyum kritik (hafıza: headunit-compat-worker-boot).

### H.4 Throttling

- Render: SAB polling moda göre 16–100ms (`VehicleSignalResolver.ts:233-238`);
  speed 3Hz, fuel 8s worker (`worker:62-63`).
- localStorage: odometre 4s debounce + kritik anlarda safeFlushKey; maintenance
  30s; safeStorage `_SAFETY_DEBOUNCE_KEYS` 1s taban.
- RAF-batch: Zustand güncellemeleri tek flush, reverse istisna
  (`vehicleDataLayer/index.ts:95-136`).

### H.5 Düşük-Uç Donanım Ölçekleme (DeviceTier → RuntimeMode)

| Mod | fps | blur | anim | gölge | worker | Hedef donanım |
|-----|-----|------|------|-------|--------|---------------|
| PERFORMANCE | 60 | ✅ | ✅ | ✅ | ✅ | yüksek-uç |
| BALANCED | 30 | ✅ | ✅ | ✅ | ✅ | orta |
| BASIC_JS | 20 | ❌ | ❌ | ❌ | ✅ | Mali-400 / K24 |
| POWER_SAVE | — | ❌ | min | ❌ | ✅ | düşük voltaj |
| SAFE_MODE | 15 | ❌ | ❌ | ❌ | ❌ susar | RAM krizi |

`runtimeTypes.ts:26-107`. Mali-400: donanımsal blur yok → software render GPU
stall (hafıza: mali400-blur-lag).

---

## I. Genişleme Stratejisi

> **İlke:** Yeni PID/ECU/EV/hibrit/ADAS, mevcut motorları **değiştirmeden**
> eklenir. Genişleme noktaları zaten kodda tanımlı.

### I.1 Yeni Sinyal (PID/CAN alanı)
1. Normalize katmanına ekle: `NormalizedVehicleData` yeni alan (`valTypes.ts:52-96`)
   + `SignalNormalizer` üretir.
2. Sanity eşiği worker/StandardPidRegistry'de tanımla.
3. UnifiedVehicleStore'a alan + `chk`/`chkBool` guard (`UnifiedVehicleStore.ts:289-354`).
4. Tüketen motor abone olur. **UI'a doğrudan ham veri sokma.**

### I.2 Yeni Kural / Olay
- Yeni `VehicleEventType` (`VehicleEventHub.ts:18-44`) + worker histerezis bloğu
  + Action Engine `switch` case. Dağıtım otomatik. Örnek hazır: ENGINE_OVERHEAT
  (`smartCardEngine.ts:22-25`).

### I.3 Yeni Motor (plug-in)
- Lifecycle deseni: `start...() → () => cleanup` (CognitiveEngine/Orchestrator/
  MaintenanceBrain hepsi böyle). Zero-Leak: cleanup tüm listener/timer iptal
  eder (CLAUDE.md §1). Registry: App.tsx boot'ta start çağrısı.

### I.4 Araç Profili Sistemi (Zoe/Duster/K24…)
- `VehicleProfile` (tip/motor/yağ/VIN/idleRpm/normalTemp) maintenanceBrain'i
  kalibre eder (`maintenanceBrain.ts:126-178`); `getPidListForVehicle` PID setini
  araç-tipine göre daraltır (`obdPidConfig.ts:21-30`).
- **OEM-specific PID genişleme:** EV batarya (Zoe EVC/LBC DID'leri, hafıza:
  obd-core-v2 P13) profil-bazlı ek katalog olarak; StandardPidRegistry standart
  çekirdek kalır, OEM tablo profile bağlı yüklenir.
- Transport soyutlaması: ObdAdapter BLE/classic-BT/TCP (K24 için TCP) — profil
  transport'u seçer, üst katman değişmez.

### I.5 ADAS / Vision (ileride)
- `visionCore` + `modeController` (STANDARD/HYBRID_AR_NAVIGATION) zaten soyut;
  ADAS olayları yeni VehicleEventType olarak Rule Engine'e girer, Safety
  preemption'a P0/P1 seviyesinde eklenir.

### I.6 Registry Deseni (öneri, opsiyonel)
Şu an motorlar App.tsx'te elle start ediliyor. Ölçek büyüyünce hafif bir
`EngineRegistry` (id + start/stop + öncelik + bağımlılık) boot sırasını ve
teardown'ı formelleştirebilir. **Zorunlu değil** — mevcut elle-start yeterli,
erken soyutlama riski (CLAUDE.md: gereksiz refactor yok).

---

## J. Yol Haritası / Öncelik

Mevcut durumdan hedef mimariye fazlar. Her faz bağımsız değer üretir, geri alınabilir.

### FAZ 0 — Formelleştirme (kod yok, düşük risk)
- Bu doküman referans. 15 motorun sahibini ve invaryantları ekip diline sok.
- **Bağımlılık:** yok. **Kilometre taşı:** doküman onayı.

### FAZ 1 — En Yüksek ROI: Motor Termal Zinciri 🔴→✅
- 0x05 soğutma sıcaklığını çekirdek pola al → UnifiedVehicleStore'a `coolantTemp`
  (CAN'da zaten var, OBD yolu eksik) → `ENGINE_OVERHEAT` VehicleEvent (histerezis)
  → Action Engine (kırmızı + sesli) → smartCard/Context.
- **Bağımlılık:** State + Rule + Action (hepsi mevcut). **Ölçüt:** >105°C'de
  sesli+görsel uyarı cihazda gözlemlenir.

### FAZ 2 — Intelligence Engine Üreticisi 🟡→✅
- `useVehicleIntelligenceStore`'un tek yazarı `TelemetryIntelligence` servisini
  netleştir (trust/thermal/drivingCharacter). Store zaten hazır.
- **Bağımlılık:** State Engine. **Ölçüt:** healthState/drivingCharacter canlı akar.

### FAZ 3 — Energy Engine Konsolidasyonu 🟡→✅
- 12V (BatteryProtection→POWER_SAVE zaten var) + EV SoC/şarj + 0x5E tüketim tek
  Energy görünümünde. Zoe profili OEM PID ile.
- **Bağımlılık:** araç profili + transport. **Ölçüt:** EV'de batarya/menzil UI.

### FAZ 4 — Theme Behavior "canlı" bağı 🟡→✅
- Hız/RPM/sürüş-modu → tema vurgusu (sportif/sakin). useLivingThemeState'i
  vehicle state'e bağla. **Bağımlılık:** State + Animation. Düşük risk.

### FAZ 5 — Comfort Engine 🔴→🟡
- CAN extras (airCondition/ambientTemp) + breakReminder → konfor önerileri.
  **En düşük öncelik** — sinyaller mevcut, karar motoru yeni.

### FAZ 6 — Driver Profile konsolidasyonu (opsiyonel)
- Kimlik + karakter + araç profili + hafıza tek görünüm. Düşük aciliyet.

**Bağımlılık grafiği:**
```
FAZ 0 ─► FAZ 1 (Termal) ─► FAZ 2 (Intelligence) ─► FAZ 4 (Theme canlı)
              └─► FAZ 3 (Energy, profil'e bağlı)
                       └─► FAZ 5 (Comfort) ─► FAZ 6 (Profile)
```

---

## §K — İkinci Nesil Zekâ Katmanları / Vehicle Brain (Aftermarket Vizyonu)

> **Vizyon:** "Aftermarket pazarının Tesla'sı" — tek araca bağlı DEĞİL. Yüzlerce
> marka/modele takılan, OBD/CAN'i **akıllıca yorumlayıp** OEM-seviyesi deneyim
> veren bir zekâ. Bu, mimariye tek bir zorunluluk ekler: **veriye asla körü
> körüne güvenme.** OEM kendi aracını bilir; biz bilmeyen bir aracın belirsiz
> verisini yorumlarız → **Confidence her kararın önkoşuludur.**

### K.0 Aftermarket Bağlamı — Neden Bu 6 Katman?

OEM head unit, aracın kesin ECU haritasını, kalibrasyonunu ve sensör
toleranslarını bilir. Aftermarket bir cihaz **bilmez**: aynı `0x05` PID'i bir
Fiat'ta doğru, bir klon ELM327'de 200ms gecikmeli, bir EV'de anlamsız gelir.
Bu yüzden ikinci nesil zekâ, ham değeri değil **yorumlanmış + güven-etiketli**
değeri temel alır. 6 katmanın ortak paydası: **çok-marka belirsizliğini
mühendislikle sağlam karara çevirmek.**

> **Önemli düzeltme (§B'ye göre):** İlk taramada "Intelligence Engine üreticisi
> eksik" denmişti. Daha derin inceleme bunu düzeltir: **`vehicleIntelligenceService.ts`
> (T1–T4) tam bir üreticidir** — plausibility, trust 2.0, termal bellek (dT/dt,
> soak borcu, soğuma verimi) ve sürüş karakteri (DCE 2.0) üretir ve
> `useVehicleIntelligenceStore`'a yazar. Bu, aşağıdaki 6 katmanın **çoğunun
> temel altyapısının zaten var olduğu** anlamına gelir — eksik olan
> **projeksiyon, kalıcılık, bileşen ayrıştırma ve tek arbitraj katmanıdır.**

---

### K.1 Prediction Engine (Trend Projeksiyonu) 🟡 KISMEN

- **İstenen:** Eşik aşımını beklemeden TREND'le birkaç dk sonrasını öngör.
  Motor sıc. + yağ sıc. + akü V + yakıt tüketimi + turbo yükü BİRLİKTE →
  "Motor birkaç dakika içinde kritik sıcaklığa ulaşabilir."
- **Mevcut karşılık (dosya:satır):**
  - Termal türev altyapısı **VAR**: `vehicleIntelligenceService.ts:210-222`
    (dT/dt dairesel tampon), `:415` (`maxCoolantTrend`), `:514`
    (`coolantTrendDtDt`), HEAT_SOAK/OVERHEAT_RISK durumları `:231-244`.
  - Kestirimci aşınma: `maintenanceBrain.ts` (birikim, oil life) — ama zamana
    yayılı skor, **anlık projeksiyon değil**.
  - App tahmini: `smartMarkovEngine.ts` — araç fiziği değil.
- **Durum:** 🟡 — **türev (dT/dt) hesaplanıyor ama İLERİ PROJEKSİYON yok.**
  Sistem "şu an ısınıyor" (HEAT_SOAK) diyebiliyor; "3 dakika sonra 110°C'yi
  geçer" DİYEMİYOR. Çok-değişkenli birleşik projeksiyon (yağ+akü+yakıt+turbo)
  hiç yok.
- **Aftermarket'te neden kritik:** OEM aracı ısıtan yükü bilir; biz bilmeyiz.
  Erken uyarı (motor durmadan önce) aftermarket'in en görünür "OEM-üstü"
  değeridir — çekişte/yokuşta motoru koruyan öngörü.
- **Somut öneri:** `vehicleIntelligenceService`'e **`ThermalProjection`** alt-modülü
  ekle (yeni servis DEĞİL — mevcut tick içinde). dT/dt zaten var; basit doğrusal
  ekstrapolasyon: `t_to_critical = (COOLANT_OVERHEAT − coolant) / dTdt` (dTdt>0).
  Çok-değişken: her metrik için ayrı dT/dt tamponu (yağ 0x5C, akü 0x42, tüketim
  0x5E), ağırlıklı risk skoru. Sonuç → yeni `VehicleEventType: 'OVERHEAT_PREDICTED'`
  (histerezisli, §D.1 deseni) → Action Engine "önleyici" uyarı. **İnvaryant:**
  tek yazar (Intelligence servisi), histerezis, zero-alloc (Float32 tampon zaten
  öyle).
- **Risk:** Yanlış-pozitif projeksiyon güveni yıpratır. Azaltma: **yalnızca
  Confidence yüksekken projeksiyon yayınla** (K.4'e bağımlı); dT/dt gürültülüyse
  (düşük fidelity) sus. Doğrusal ekstrapolasyon kısa ufukta (≤3dk) tutulmalı.

---

### K.2 Driver DNA 🟡 KISMEN (canlı var, kalıcı yok)

- **İstenen:** Sürücüyü zamanla öğren — agresif/ekonomik, şehir/uzun yol, gece
  sürüşü, ani fren, gaz karakteri → kalıcı profil + önerileri buna uyarla.
- **Mevcut karşılık:**
  - Canlı karakter **VAR**: `vehicleIntelligenceService.ts:295-314` (DCE 2.0 —
    aggression/economy/smoothness EMA), sert fren/çukur tespiti `:456-492`.
  - `drivingCharacter` store'da `useVehicleIntelligenceStore.ts:55,124`.
- **Durum:** 🟡 — **anlık karakter üretiliyor ama KALICI DEĞİL.** Store persist
  edilmiyor (plain `create`, `useVehicleIntelligenceStore.ts:95`); `stop()` her
  şeyi sıfırlıyor (`vehicleIntelligenceService.ts:550-570`). Segmentasyon yok
  (şehir/uzun yol/gece ayrımı), uzun-dönem profil yok, önerilere besleme zayıf.
- **Aftermarket'te neden kritik:** Marka-bağımsız kişiselleştirme = OEM'in
  yapamadığı. Aynı cihaz her sürücüye/araca uyum sağlar; "senin sürüşüne göre"
  öneri, aftermarket'in kişisel değer vaadi.
- **Somut öneri:** Yeni **kalıcı** `useDriverDnaStore` (persist + `safeStorage`,
  eMMC throttle — CLAUDE.md §3). vehicleIntelligenceService canlı karakteri
  buraya **kayan uzun-dönem EMA** ile besler (dakikalar değil günler ölçeği).
  Segment etiketleri: `contextEngine.getTimeCtx` (gece) + hız profili
  (şehir<50 / uzun yol) + trip geçmişi. DNA → AI Assistant prompt (§G.2 bağlam)
  + Context/Theme önerileri. **İnvaryant:** tek yazar, persist throttle, AI'a
  yorumlanmış (ham değil). **Kimlik bağı:** VIN/profil başına DNA (Driver Profile
  Engine §B.7 ile birleşir).
- **Risk:** Gizlilik (sürücü davranış profili hassas veri) — cihazda kalmalı,
  cloud'a gitmemeli (CLAUDE.md gizlilik). Çok-sürücü tek araç → profil karışması;
  VIN başına + opsiyonel manuel sürücü seçimi.

---

### K.3 Vehicle Digital Twin 🔴 EKSİK (en büyük yeni parça)

- **İstenen:** Arka planda sürekli yaşayan dijital araç modeli. **Bileşen-bazlı**
  sağlık: motor, şanzıman, soğutma, fren, lastik, akü, turbo, DPF/katalizör,
  yakıt sistemi — her biri için sağlık puanı + uzun vadeli yıpranma.
- **Mevcut karşılık:**
  - Tek `healthScore` (motor aşınması): `maintenanceBrain.ts:224-226`.
  - Tek `healthState` (mekanik sağlık): `vehicleIntelligenceService.ts:435-451`.
  - Termal alt-sistem sağlığı fiilen var (soğutma): thermal debt/efficiency.
  - Fren/lastik sinyalleri UnifiedVehicleStore'da (`canTpmsKpa`, brake distance
    safetyService) ama **bileşen sağlığına bağlanmamış**.
- **Durum:** 🔴 — **bileşen ayrıştırması yok.** Sistem "araç %78 sağlıklı" diyor;
  "şanzıman %90, soğutma %60, DPF %40" DİYEMİYOR. Twin kavramı (sürekli yaşayan
  model, kalıcı yıpranma) yok.
- **Aftermarket'te neden kritik:** Bileşen-bazlı sağlık = servis öncesi teşhis,
  ikinci-el değer, "OEM bakım ekranı" hissi. Aftermarket'in en satılabilir
  premium özelliği. Çok-marka: her bileşen standart PID kümesine map'lenir
  (motor=0x04/0x0C/0x05, DPF=0x3C+diesel, yakıt=trim 0x06-09, akü=0x42).
- **Somut öneri:** Yeni **`vehicleDigitalTwinService`** (mevcut Intelligence/
  Maintenance'ın ÜSTÜNE değil, YANINA — ikisini tüketici). Kalıcı
  `useDigitalTwinStore`: her bileşen `{ health, wearTrend, lastUpdated,
  confidence }`. Bileşen→PID eşlemesi **profil-bazlı registry** (§I.4 deseni):
  `ComponentHealthMap[vehicleType]`. Her bileşen kendi türev/aşınma modelini
  kullanır (soğutma = mevcut thermal debt; motor = maintenanceBrain wear; fren =
  brake distance trend + sert-fren sıklığı; lastik = TPMS sapma; DPF = katalizör
  sıc. + diesel). **İnvaryant:** tek yazar, persist throttle, Confidence her
  bileşende (düşük güvende "bilinmiyor" göster, uydurma). **Fazlama:** önce 3
  bileşen (motor/soğutma/akü — verisi zaten akıyor), sonra genişlet.
- **Risk:** En büyük yeni yüzey → over-engineering riski. Azaltma: bileşenleri
  **kademeli** ekle; verisi olmayan bileşeni "veri yok" göster (uydurma YASAK).
  Bileşen sağlığı ≠ kesin teşhis — hukuki/güven açısından "tahmini gösterge"
  dili şart (yanlış "fren arızalı" iddiası sorumluluk yaratır).

---

### K.4 Confidence Engine 🟡 KISMEN (çekirdek güçlü, yayın eksik) — **AFTERMARKET'İN KİLİDİ**

- **İstenen:** OBD güvenilirliği sabit değil; her sensör için güven skoru üret;
  karar motoru değere DEĞİL güven skoruna GÖRE de karar versin.
- **Mevcut karşılık (beklenenden GÜÇLÜ):**
  - Füzyon-içi confidence×tazelik: `VehicleCompute.worker.ts:780-822`, VAL
    `valTypes.ts:27-44,107-113` (HAL 0.98 / CAN 0.92 / OBD 0.85 / GPS 0.70).
  - **Per-sinyal plausibility + trust 2.0 VAR:** `vehicleIntelligenceService.ts:404-410`
    (plausComp × fidelity × jitter), per-PID stale/jump/mismatch raporu
    (`plausibilityReport`), aktif kaynak yayını `halStatusStore.ts:51`.
  - **Karar bastırma KISMEN var:** trust<0.4 → sağlık max STRESSED
    (`vehicleIntelligenceService.ts:131-143`, `_applyTrustCaps`),
    `isDiagnosticDegraded` `:454`.
- **Durum:** 🟡 — **çekirdek fiilen var**, ama (a) güven **global/sağlık-odaklı**,
  per-sensör güven skoru **karar/UI/AI'a açık yayınlanmıyor**; (b) "düşük
  güvende KARARI bastır" politikası yalnız sağlık durumuna uygulanıyor, diğer
  motorlara (Prediction/Twin/Action/AI) sistematik değil.
- **Aftermarket'te neden HAYATİ:** OEM sensör toleransını bilir; biz bilmeyiz.
  Yanlış PID'e (klon ELM327, desteklenmeyen PID'in çöp yanıtı, EV'de ICE PID)
  güvenip "motor arızalı" demek → güven kaybı + iade. Confidence, çok-marka
  belirsizliğini **dürüstçe** yöneten katmandır: "%40 güven — teyit gerek" demek,
  yanlış kesin iddiadan iyidir. **Bu, OEM-olmayan veride ürünü ayakta tutan tek
  şeydir.**
- **Somut öneri:** Mevcut `plausibilityReport` + trust'ı **per-sinyal confidence
  API'sine** terfi et: `getSignalConfidence(signal): 0..1` (füzyon güveni ×
  plausibility × tazelik). UnifiedVehicleStore'a her kritik sinyal için opsiyonel
  `*_conf` alanı VEYA ayrı `useConfidenceStore`. **Politika (yeni invaryant):**
  her karar motoru eşiğini tanımlar — Prediction conf<0.6 → projeksiyon susar;
  Twin conf<0.5 → "bilinmiyor"; AI bağlamı düşük güvenli veriyi "kesin değil" diye
  aktarır; UI düşük güvende soluk/uyarı gösterir. **İnvaryant:** tek üretici
  (Intelligence servisi), zero-alloc.
- **Risk:** Aşırı-muhafazakâr güven → sistem sürekli "emin değilim" der,
  kullanıllamaz olur. Kalibrasyon şart: güven eşikleri profil-bazlı ayarlanabilir;
  yüksek-güvenli kaynak (native HAL/CAN) yüksek taban alır.

---

### K.5 Intent Engine 🟡 KISMEN (parçalar var, birleşik katman yok)

- **İstenen:** Kullanıcının ne yapmak istediğini tahmin et: saat + konum + BT +
  telefon + takvim + son rotalar + hız + araç durumu → "İşe gidiyor / Market
  dönüşü / Uzun yol başladı."
- **Mevcut karşılık:**
  - Konum+zaman bağlamı: `contextEngine.ts:81-110` (locationCtx/timeCtx,
    ev/iş), rota önerisi `:161-197`.
  - App/rutin tahmini: `smartMarkovEngine.ts`, `smartEngine.ts`.
  - BT+şarj sinyali: `smartDrivingEngine.ts:91-136` (device.btConnected/charging
    → sürüş modu sezgisi).
- **Durum:** 🟡 — parçalar dağınık; **"intent" olarak isimlendirilmiş birleşik
  katman YOK.** **Takvim entegrasyonu YOK** (grep: hiçbir calendar okuma API'si
  yok). Telefon/BT intent'e sistematik beslenmiyor (yalnız sürüş moduna).
- **Aftermarket'te neden kritik:** Proaktif OEM-üstü deneyim — sürücü istemeden
  doğru ekranı/rotayı/müziği sunmak. Marka-bağımsız: intent sinyalleri (saat/
  konum/BT) her araçta aynı.
- **Somut öneri:** Yeni **`intentEngine`** (isim mevcut `intentEngine.ts` AI
  komut parse için kullanılıyor — çakışma; **`driverIntentEngine`** adı öner).
  Girdi füzyonu: contextEngine (konum/zaman) + smartMarkov (rutin) + Driver DNA
  (K.2) + araç durumu (park→sürüş geçişi) → `DriverIntent` enum ('COMMUTE_TO_WORK'
  /'RETURN_HOME'/'ERRAND'/'LONG_TRIP_STARTED'/'UNKNOWN') + confidence. Takvim:
  opsiyonel Capacitor calendar (izin-bazlı, permissive lisans kontrolü — CLAUDE.md).
  Çıktı → smartCardEngine + Action Engine + Theme. **İnvaryant:** yerel (ağsız,
  contextEngine gibi), gizlilik (takvim/telefon cihazda kalır).
- **Risk:** Yanlış intent → rahatsız edici proaktiflik ("neden bana iş rotası
  açtın?"). Azaltma: intent yalnız **öneri** üretir, otomatik aksiyon değil
  (öneri kartı, sessiz); confidence düşükse hiç gösterme. Takvim izni gizlilik
  hassas — opt-in.

---

### K.6 Vehicle Brain 🟡 KISMEN (Orchestrator var — terfi mi, üst katman mı?)

- **İstenen:** TÜM sistemlerin üstünde tek karar katmanı. Zincir: Sensors →
  Fusion → State → Prediction → Context → Intent → Decision → **Vehicle Brain**
  → Action → UI/Voice/Notif. Hiçbir UI doğrudan OBD kullanmasın.
- **Mevcut karşılık:** `SystemOrchestrator.ts:1-19` **zaten "tek yetkili Action
  Engine"** — UI direkt olay dinlemez, tüm semantik olay buradan UI'a çevrilir;
  reverse suppress/arbitraj burada (`:155-178`). "UI ham OBD okumaz" invaryantı
  zaten yürürlükte (§A.1).
- **Durum:** 🟡 — Orchestrator **aksiyon arbitrajı** yapıyor ama **çok-motor
  karar füzyonu** (Prediction + Intent + Twin + Confidence'ı birlikte tartıp tek
  karara varmak) yapmıyor; olayları tek tek işliyor.
- **MİMARİ KARAR (net):** **Vehicle Brain = SystemOrchestrator'ın ince bir
  "Arbitration/Policy" katmanına TERFİSİ — yeni monolitik merkez DEĞİL.**
  Gerekçe:
  - CarOS Pro **event-driven** ve bu güçlü yanı (zero-alloc, gevşek bağlı,
    fail-soft). Tüm kararı senkron tek fonksiyona toplamak (megamorphic karar
    ağacı) **§H V8/JIT ilkelerini ve fail-soft'u bozar** — bir motor çökerse
    Brain çöker.
  - Doğru desen: Brain, motorların çıktısını (Prediction event, Intent, Twin
    sağlık, Confidence) **okuyan + öncelik/çakışma çözen İNCE politika katmanı**.
    Kararı kendisi hesaplamaz; motorların üretimini **arbitre eder** (hangi
    uyarı önce, hangi öneri bastırılır, düşük güvende ne susar).
  - Somut: `SystemOrchestrator`'a **arbitration policy** ekle (öncelik tablosu
    §F.1'i kod olarak formelleştir) — reverse zaten böyle çalışıyor, genelleştir.
    Yeni motorlar (Prediction/Intent/Twin) olaylarını yayar; Brain tek noktadan
    önceliklendirir → Action.
- **Aftermarket'te neden kritik:** Tutarlı OEM-hissi = tek beyin. Çakışan
  uyarılar (aynı anda yakıt+ısı+intent) tek elden yönetilmeli.
- **Somut öneri:** (1) §F.1 öncelik tablosunu `SystemOrchestrator`'da veri-güdümlü
  arbitration'a çevir. (2) Yeni motor olaylarını (OVERHEAT_PREDICTED, intent
  önerisi, twin uyarısı) VehicleEventHub üstünden bağla — Brain tek tüketici.
  (3) Confidence gate'i Brain'e koy: düşük güvenli olay downgrade/suppress.
- **Risk (KRİTİK): Aşırı-merkezileştirme.** Brain'i "her şeyi bilen tek
  fonksiyon" yaparsan mevcut gevşek-bağlı, fail-soft, test-edilebilir mimariyi
  kaybedersin. **Kural:** Brain **ince arbitraj** kalır; iş mantığı motorlarda
  durur. Brain çökse bile motorlar+State ayakta (fail-soft korunur).

---

### K.7 Güncellenmiş Veri Akışı (İkinci Nesil)

```
┌─ Katman 1-3 (MEVCUT, değişmez) ────────────────────────────────────────────┐
│ Sensors → Fusion(VAL/SAB) → Vehicle State (worker → UnifiedVehicleStore)    │
└───────────────────────────────┬────────────────────────────────────────────┘
                                 │ temiz araç durumu + per-sinyal confidence
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ CONFIDENCE(K4)│◄─────│ INTELLIGENCE      │─────►│ DIGITAL TWIN (K3) │
│ per-sinyal    │ trust│ (vehicleIntel svc)│health│ bileşen sağlıkları│
│ güven yayını  │      │ trend/karakter    │      │ (motor/soğutma/…) │
└───────┬───────┘      └────────┬──────────┘      └─────────┬────────┘
        │ güven gate            │ dT/dt, DNA               │ bileşen trend
        ▼                       ▼                          ▼
┌───────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ PREDICTION(K1)│      │ DRIVER DNA (K2)   │      │ INTENT (K5)       │
│ ileri projek. │      │ kalıcı profil     │      │ sürücü niyeti     │
│ OVERHEAT_PRED │      │ (persist)         │      │ COMMUTE/ERRAND/…  │
└───────┬───────┘      └────────┬──────────┘      └─────────┬────────┘
        │ event                 │ bağlam                    │ öneri
        └───────────────────────┼───────────────────────────┘
                                 ▼   (hepsi VehicleEventHub / store üstünden)
                    ┌──────────────────────────────┐
                    │  VEHICLE BRAIN (K6)           │
                    │  = SystemOrchestrator + ince  │
                    │    ARBITRATION/POLICY katmanı │
                    │  öncelik (§F.1) + confidence   │
                    │  gate + çakışma çözümü         │
                    └──────────────┬───────────────┘
                                   ▼
             ┌─────────────────────────────────────────┐
             │  ACTION → UI · Voice(TTS) · Notification │
             │  · Theme · Animation                     │
             └─────────────────────────────────────────┘

İNVARYANT (korunur): UI hiçbir katmanda ham OBD okumaz · her motor kendi işini
yapar (fail-soft) · Brain yalnız ARBITRE eder, iş mantığı motorlarda kalır ·
düşük confidence → Brain downgrade/suppress · zero-alloc hot-path korunur.
```

### K.8 Yol Haritası (FAZ 7–12 — mevcut FAZ 1-6'nın devamı)

Bağımlılık: FAZ 1 (ENGINE_OVERHEAT olayı) ve FAZ 2 (Intelligence üretici — **zaten
var, netleştirme**) bu fazların önkoşulu.

- **FAZ 7 — Confidence yayını (K4) [ÖNCE — hepsinin kilidi]:** mevcut trust/
  plausibility'yi per-sinyal API + karar gate'ine terfi et. Düşük risk (çekirdek
  var), en yüksek stratejik değer. **Ölçüt:** her kritik sinyalde 0..1 güven,
  UI'da görünür; düşük güvende Prediction susar.
- **FAZ 8 — Prediction projeksiyonu (K1):** dT/dt → ileri ekstrapolasyon +
  çok-değişken; `OVERHEAT_PREDICTED` olayı. **Bağımlılık:** FAZ 7 (güven gate).
  **Ölçüt:** güvenli senaryoda "X dk sonra kritik" öngörüsü, yanlış-poz düşük.
- **FAZ 9 — Digital Twin çekirdek (K3):** 3 bileşen (motor/soğutma/akü — verisi
  akıyor), kalıcı store, confidence'lı. **Bağımlılık:** FAZ 7. **Ölçüt:** bileşen
  sağlık ekranı, "veri yok" dürüstlüğü.
- **FAZ 10 — Driver DNA kalıcılığı (K2):** persist store + segment + AI/Theme
  besleme. **Bağımlılık:** Driver Profile (VIN bağı). **Ölçüt:** oturumlar arası
  korunan profil, kişiselleşen öneri.
- **FAZ 11 — Intent Engine (K5):** driverIntentEngine, sinyal füzyonu (takvim
  opsiyonel/opt-in). **Bağımlılık:** DNA + Context. **Ölçüt:** doğru intent
  önerisi, otomatik aksiyon YOK.
- **FAZ 12 — Vehicle Brain arbitraj (K6):** §F.1 öncelik tablosunu Orchestrator'da
  veri-güdümlü arbitration'a çevir; tüm yeni olayları tek noktadan önceliklendir +
  confidence gate. **Bağımlılık:** FAZ 7-11. **Ölçüt:** çakışan uyarılar tutarlı
  önceliklenir; Brain çökse motorlar ayakta (fail-soft testi).
- **Twin genişleme (sürekli):** şanzıman/fren/lastik/turbo/DPF bileşenleri
  kademeli, verisi geldikçe.

### K.9 Aftermarket Özel Notlar (çok-marka/model)

- **Profil-bazlı kalibrasyon:** her yeni katman eşiklerini `VehicleProfile`'dan
  okumalı (idleRpm/normalTemp/vehicleType — `maintenanceBrain.ts:191-220` deseni).
  Sabit eşik = tek-marka tuzağı.
- **Registry deseni (§I.4):** bileşen→PID, intent-sinyal, güven-taban haritaları
  profil-bazlı registry olmalı → yeni marka = yeni kayıt, kod değişmez.
- **Confidence = OEM-olmayan verinin sigortası:** her katman düşük güvende
  "bilinmiyor/tahmini" der, asla kesin OEM-iddiası taklit etmez (hem güven hem
  hukuki koruma).
- **Gizlilik (DNA/Intent/takvim):** cihazda kalır, cloud'a gitmez (CLAUDE.md).

---

## §L — Uygulama Mimarisi / Performans-Uyarlanabilir Hibrit Runtime

> **Vizyon:** §K "her sinyalden anlam üret" der; §L "o anlamı üretirken düşük-uçta
> aracı yakma" der. CLAUDE.md **Performans-Uyarlanabilir Hibrit** anayasası:
> tüm zekâ katmanları AÇIK kalır ama her biri **DeviceTier bütçesine abone**;
> güvenlik-kritik olan HER tier'da garanti, ağır analiz soğuk-yolda. Bugün bu
> aboneliği fiilen sağlayan **tek merkez yok** — §L onu, mevcut
> `AdaptiveRuntimeManager`'ı **genişleterek** (yeni paralel sistem DEĞİL) kurar.

### L.0 Hibrit Runtime Scheduler (merkez boşluk) 🔴 EKSİK — **§L'nin kilidi**

- **İstenen:** Ana-thread periyodik işlerin TEK, tier-duyarlı bir zamanlayıcı
  üstünden koşması; aktif `RuntimeMode` düşünce zekâ/analiz frekansı kendiliğinden
  düşsün, güvenlik-kritik iş sabit kalsın.
- **Mevcut karşılık (dosya:satır):**
  - `AdaptiveRuntimeManager.ts` mod/tier + worker + CSS yönetiyor: histerezis
    (`:216-244`, downgrade anlık / upgrade 30s), `subscribe()` mod dinleyici
    (`:478-481`, cleanup thunk), termal tavan (`:397-415`), worker registry +
    zombie ping (`:508-641`), `destroy()` (`:650-681`) — **ama periyodik GÖREV
    zamanlaması YOK.** Şu an yalnız "hangi modtayız + hangi worker yaşıyor"ı bilir.
  - Her servis kendi `setInterval`'ıyla, moddan **bağımsız** dönüyor:
    `vehicleIntelligenceService.ts:541` → `_timer = setInterval(_tick, TICK_MS)`,
    `TICK_MS = 500` (`:27`) → **sabit 2Hz**, BASIC_JS'te bile 500ms.
  - Platform katmanı taban örüntüsü: `grep setInterval src/platform` = **49 dosyada
    135 çağrı** (I/O poll + periyodik analiz karışık); bunların ~27'si (autoBrightness,
    breakReminder, `smartCardEngine.ts`, hazard, companionEngine, ota, obdService,
    dashcam, media …) **ana-thread periyodik analiz** ve hiçbiri `runtimeManager`'a
    abone değil → tier düşünce frekansları düşmüyor.
- **Durum:** 🔴 — **ortak tier-duyarlı zamanlayıcı yok.** RuntimeConfig zaten
  `gpsUpdateMs`/`obdPollingMs`'i mod-başına ölçekliyor (`runtimeConfig.ts:26-105`) —
  yani "frekansı moda göre ölçekle" deseni sistemde **var ama sadece 2 I/O sinyaline**
  uygulanıyor; periyodik analiz görevleri bu bütçenin dışında.
- **Neden kritik (düşük-uç):** BASIC_JS Mali-400 head unit'te sabit 2Hz analiz +
  27 bağımsız timer = boşta bile sürekli uyanış/CPU/ısı (bkz `perf-low-smil-gap`,
  `idle-map-render-heat` saha bulguları). Zombie-ping'i 10s→30s'e çekme gerekçesi
  (`:45-50`, "her uyanış postMessage round-trip'i") aynen buraya uygular: **az
  uyanış = az ısı.**
- **Uygulanan çözüm — `scheduleTask` katmanı (AdaptiveRuntimeManager içine, FAZ 13/16):**
  Her periyodik görev **kendi gerçek `periodMs`'ini** bildirerek kaydolur; scheduler
  **tek "tick wheel"** (tek zamanlayıcı) üstünden, aktif moda göre bu periyodu
  ölçekler; SAFETY görevleri her tier'da periodMs'i sabit korur.
  ```ts
  type TaskCriticality = 'SAFETY' | 'NORMAL';
  interface ScheduledTask {
    id:          string;          // benzersiz — çift kayıt öncekini GÜNCELLER (idempotent)
    periodMs:    number;          // istenen taban periyot — BALANCED/PERFORMANCE'ta AYNEN uygulanır
    criticality: TaskCriticality; // SAFETY → periodMs her tier'da sabit, ASLA kısılmaz
    fn:          () => void;      // saf + zero-alloc gövde (module-scope scratch)
    deferIdle?:  boolean;         // true → requestIdleCallback'e ötelenir (varsa), yoksa senkron
  }
  scheduleTask(task: ScheduledTask): () => void;   // cleanup thunk (subscribe deseni)
  ```
  - **⚠️ NEDEN `FrequencyClass` (HOT/WARM/COOL/IDLE) DEĞİL, `periodMs`?** İlk tasarım
    (FAZ 13) 4 sabit "frekans sınıfı" öneriyordu (taban tik sayısı önceden
    sabitlenmiş: HOT≈333ms, WARM≈666ms, COOL≈5s, IDLE≈15s). FAZ 16'da bu tüketicilere
    (`vehicleIntelligenceService`, `smartCardEngine`, `autoBrightnessService`,
    `breakReminderService`, `communityService`, `hazardService`) uygulanınca ortaya
    çıktı: sınıf modeli **>15s'lik gerçek periyotları temsil edemiyordu** —
    `communityService` 5 dakikalık senkronu COOL'un ~5s tabanına yuvarlanıp orta/
    yüksek-tier'da **20× daha sık** çalışmaya başladı (CPU/ısı kazancı yerine KAYIP,
    tam tersi etki). Çözüm: görev kendi ham `periodMs`'ini verir, yüksek-tier'da
    (mod çarpanı=1) **birebir korunur**; mod çarpanı yalnız düşük-tier'da bunu
    yavaşlatır — hiçbir sınıf tablosuna zorla sığdırılmaz.
  - **Tek tick-wheel mi, görev-başı interval mi?** → **Tek tick-wheel korunur.**
    Tek master timer `MASTER_TICK_MS=333`'te döner; her görevin efektif periyodu
    `effectiveMs = criticality==='SAFETY' ? periodMs : periodMs × MODE_MULTIPLIER[mode]`
    formülüyle hesaplanır, `Math.round(effectiveMs / 333)` ile en yakın tike
    yuvarlanır (min 1 tik). Gerekçe: (a) N ayrı interval = N uyanış; tek wheel = 1
    uyanış → zayıf HU'da termal/pil kazancı (zombie-ping gerekçesiyle aynı ilke);
    (b) faz hizası deterministik; (c) mod ölçeklemesi **tek yerde** uygulanır.
    Bedeli: uzun bir görev kısa-periyotlu bir SAFETY görevini geciktirebilir → bu
    yüzden **her tikte önce SAFETY görevler senkron koşar**, ardından NORMAL
    (eşitlikte kısa periodMs önce); `deferIdle:true` görevler `requestIdleCallback`'e
    ötelenir (safety preemption, #5).
  - **Mod ölçeklemesi:** `_commit()` içinde mod değişince tüm NORMAL görevlerin
    efektif tik sayısı `periodMs`'ten YENİDEN hesaplanır (önceki yuvarlanmış
    değerden DEĞİL — mod geçişleri arasında rounding drift birikmemesi için).
    **SAFETY her tier'da sabit** (ucuz + garanti — CLAUDE.md "güvenlik-kritik HER
    tier açık").
  - **Yuvarlama sapması (dürüst not):** `periodMs`, `MASTER_TICK_MS`e (333ms) yakın
    küçük bir değerse (ör. `vehicleIntelligenceService`'in periodMs=500'ü) mod
    çarpanının gerçek etkisi tam katsayı olmayabilir (500ms→BALANCED'ta 2 tik/666ms,
    BASIC_JS'te round(1000/333)=3 tik/999ms → gözlenen oran ~1.5×, naif beklenen 2×
    değil). Bu sapma yalnız `MASTER_TICK_MS`e yakın periyotlarda anlamlı; FAZ 16'da
    taşınan diğer 5 tüketicinin periyotları (8s/10s/30s/60s/5dk) çok daha büyük
    olduğundan orada oran tam 2.0'dır.
  - **İnvaryant uyumu:** tek yazar (scheduler = runtimeManager'ın parçası, ikinci
    zamanlayıcı otoritesi doğmaz); zero-alloc (wheel önceden tahsisli görev dizisi +
    monomorfik dispatch, tik başına obje yok — #6); Zero-Leak (`scheduleTask` cleanup
    thunk döner, `destroy()` wheel timer'ını ve görev kaydını temizler — #10).
- **Risk:** Tek wheel'e ağır bir görev konursa kısa-periyotlu SAFETY görevlerinde
  jitter. Azaltma: uzun/ağır gövdeler **kısa + bölünebilir** olmalı; uzun analiz
  worker'a (VehicleCompute) veya `deferIdle:true` ile `requestIdleCallback`'e.
  İkinci risk: migrasyon yarım kalırsa iki zamanlayıcı rejimi bir arada → §L.2
  sıralı/atomik migrasyonla önlenir (FAZ 16 grup-1: `communityService`'teki
  `_pullTimer` bilinçli olarak henüz taşınmadı — bkz. §L.2 durumu).

---

### L.1 Görev Sınıflandırma & Bütçe (hot / warm / cool / idle)

- **İlke:** Bir görevin frekans sınıfı **kararın aciliyetine** göre belirlenir,
  gösterim güzelliğine değil (8 Kapı §Kuzey Yıldızı). Güvenlik ucuzdur → her tier'da
  açık; ağır analiz pahalıdır → soğuk-yolda.
- **Sınıf → katman eşlemesi (§B 15 motor + §K 6 ikinci-nesil):**
  - **HOT / SAFETY (≈3Hz, her tier sabit):** overheat eşiği, düşük yağ basıncı,
    reverse/park geçişi, hız/RPM tüketen güvenlik uyarıları. CLAUDE.md: "overheat,
    düşük yağ basıncı, reverse HER tier'da garanti açık — ucuzdurlar."
  - **WARM (≈1-2Hz, mod ile ölçekli):** `vehicleIntelligenceService` tick (plausibility,
    trust 2.0, dT/dt, DCE karakter), smartCardEngine öneri değerlendirme, telemetri
    aggregasyon. Düşük-uçta yarı frekansa iner, susmaz.
  - **COOL (≈0.1-0.2Hz, cold-path):** Digital Twin bileşen sağlığı (§K.3), Prediction
    ileri projeksiyon (§K.1), Driver DNA uzun-dönem EMA (§K.2). CLAUDE.md: "Digital
    Twin, Prediction, Driver DNA soğuk-yolda / düşük frekansta / idle'da; hot-path'e
    (3Hz hız/RPM) ASLA girmez."
  - **IDLE (`requestIdleCallback` / boşta):** kalıcılık flush (persist throttle),
    segment etiketleme, bakım birikim skoru, DNA disk yazımı.
- **Bütçe kuralı:** Bir görevi bir üst sınıfa (daha sık) taşımak **gerekçe + saha
  kanıtı** ister (CLAUDE.md "bütçesiz/kanıtsız özellik ekleme yasak"). Varsayılan
  aşağı çeker: emin değilsen COOL. **Süslü görsel** (3D twin, ağır animasyon) düşük-uçta
  feda edilir (`enableAnimations`/`enableBlur` zaten CSS ile) — feda edilen zekâ değil,
  yalnızca gösterim.

---

### L.2 Migrasyon Stratejisi (27 setInterval → tek scheduler)

- **Kısıt (AI.md):** "multi-system refactor YASAK", atomik patch, kısmi mantık
  bırakma. → **Big-bang dönüşüm YOK.** Scheduler eklenir, tüketiciler **tek tek**
  taşınır; her adım kendi başına yeşil + geri-uyumlu.
- **Sıra (riskten değere):**
  1. **Scheduler iskeleti** (§L.4 FAZ 13) — hiçbir tüketici taşınmadan `scheduleTask`
     + wheel eklenir; mevcut 27 `setInterval` yerinde durur (paralel, zararsız).
  2. **İlk migrasyon = `vehicleIntelligenceService`** — en somut kazanç: `_timer`
     (`:541`) yerine `scheduleTask({ id:'vehicle-intel', freqClass:'WARM',
     criticality:'NORMAL', fn:_tick })`. `_tick` gövdesi **değişmez** (delta-time
     zaten `_lastTickMs`/`nowMs` ile hesaplanıyor, `:336` — mod ile periyot değişse
     de doğru kalır). `start()/stop()` (`:541`/`:547`) cleanup thunk'a sarılır.
  3. **Cold-path motorları** (Twin/Prediction/DNA — §K'da henüz yeni) doğrudan COOL/IDLE
     ile **doğar** (eski setInterval hiç yazılmaz).
  4. **Konfor/ikincil timer'lar** (autoBrightness, breakReminder, ota, hazard, media…)
     kademeli WARM/COOL/IDLE'a taşınır. Saf I/O poll (obdService, gpsService) scheduler'a
     **girmez** — onlar zaten RuntimeConfig `obdPollingMs`/`gpsUpdateMs` ile mod-duyarlı.
- **Geriye-dönük uyum:** `scheduleTask` cleanup thunk imzası `subscribe()` (`:478`)
  ile aynı → çağıran taraf deseni tanır. Taşınmamış servis eskisi gibi çalışır;
  rejim karışması yalnız aynı görevi iki yere koymakla olur (kod incelemesiyle önlenir).

---

### L.3 Yaşam Döngüsü & Zero-Leak

- **Kayıt/iptal:** `scheduleTask()` → cleanup thunk (Zero-Leak, #10 · `:478-481`
  deseni). Aynı `id` ikinci kez kaydolursa önceki kayıt **değiştirilir** (registerWorker
  `:508-525`'in idempotent yeniden-kayıt deseni), sızıntı doğmaz.
- **destroy() entegrasyonu:** wheel master timer'ı `destroy()`'da (`:650-681`)
  `_cancelUpgrade`/`_stopZombieDetection` yanına eklenir; görev kaydı `.clear()`
  edilir. Böylece "her listener/timer/worker cleanup'ta iptal" garantisi (dosya başlığı
  §1) scheduler'ı da kapsar.
- **Test edilebilirlik:** `_resetForTest()` (`:111-114`) zaten singleton'ı `destroy()`
  ile sıfırlıyor → scheduler otomatik dahil olur. Wheel'e sahte zaman (fake timers)
  enjekte edilebilmesi için tik `setInterval` handle'ı tek noktada tutulmalı.
- **Mevcut kaseyle uyum:** `soak.runtime.test.ts` + `soak.cross-service.test.ts` uzun
  koşuda timer sızıntısı arıyor; `cleanup.runtime.test.ts` teardown'da handle sıfırını
  doğruluyor — scheduler bu kasalara **yeni assert eklemeden** girmeli (aynı Zero-Leak
  sözleşmesi). Yeni bir kilit: "scheduler destroy sonrası aktif timer=0".

---

### L.4 Yol Haritası (FAZ 13–16 — §K'nın FAZ 7-12'sinin devamı)

Bağımlılık: bu fazlar §K motorlarından **bağımsız** ilerleyebilir (altyapı katmanı);
ancak Twin/Prediction/DNA (FAZ 8-10) COOL/IDLE sınıfını **tüketeceği** için FAZ 13
onların da zeminidir. Her faz cihazda kanıtlanana kadar `docs/DEVICE_VALIDATION_LEDGER.md`'de
🔴 kalır (build/test yeşili "başarılı" saymaz).

- **FAZ 13 — Scheduler iskeleti (L.0) [ÖNCE — hepsinin zemini]:** `scheduleTask` +
  tek tick-wheel + mod ölçekleme (`subscribe` kablosu) + `destroy` entegrasyonu.
  Tüketici taşınmaz. Düşük risk (yeni yüzey, eski timer'lar duruyor). **Ölçüt:** tek
  zamanlayıcı; mod BASIC_JS'e düşünce WARM periyodu ölçeklenir (birim test);
  `soak.runtime.test.ts` sızıntısız; destroy sonrası aktif timer=0.
- **FAZ 14 — İlk hot/warm migrasyon (L.2):** `vehicleIntelligenceService._timer`
  → `scheduleTask(WARM)`. `_tick` gövdesi ve hız/RPM path'i **dokunulmaz**. **Ölçüt:**
  BASIC_JS'te Intelligence tick periyodu 500→1000ms **gözlemlenir** (adb log/CDP);
  güvenlik uyarı gecikmesi değişmez; delta-time doğruluğu korunur.
- **FAZ 15 — Cold-path yerleşimi (L.1):** yeni Twin/Prediction/DNA COOL/IDLE ile
  doğar; ağır analiz hot-path'e girmez. **Ölçüt:** K24 boşta CPU idle payı **artar**
  (mevcut ana-thread ~%67 idle taban çizgisinden — `idle-map-render-heat` profili);
  hız/RPM 3Hz jitter'ı bozulmaz.
- **FAZ 16 — Konfor/ikincil timer toplu migrasyonu (L.2):** autoBrightness,
  breakReminder, ota, hazard, media vb. WARM/COOL/IDLE'a taşınır (saf I/O poll hariç).
  **Ölçüt:** `runtimeManager`'a abone olmayan **periyodik analiz** setInterval'ı
  platformda kalmaz (grep denetimi, safety hot-path + I/O poll istisna); düşük-uçta
  boşta uyanış sayısı düşer.

**Saha kütüğü bağı:** FAZ 13-16 her biri kütüğe önce 🔴 "cihazda test edilmedi" +
ölçülebilir kabul ölçütüyle girer; K24/Duster'da idle CPU / termal / tik periyodu
**ölçülünce** 🟢'ya taşınır. Ana kabul sinyali: **düşük-uçta boşta CPU/ısı ölçülebilir
düşer, güvenlik-kritik yol her tier'da sabit kalır.**

---

## Ek: Değişmez İnvaryantlar (özet — her PR bunları korumalı)

1. **UI asla ham veri okumaz** — yalnızca Vehicle State (UnifiedVehicleStore).
2. **Tek yazar** — her store/state'in tek üretici sahibi olur.
3. **Histerezis** — her mod geçişinde trigger ≠ reset (flicker yasak).
4. **Fail-soft** — sensör ölürse UI çöker değil, "sinyal yok" gösterir.
5. **Safety preemption** — güvenlik her şeyi ezer; hiçbir konfor onu geciktirmez.
6. **Zero-allocation hot-path** — pre-allocated envelope + monomorphic dispatch.
7. **AI'a ham veri gitmez** — yalnızca yorumlanmış bağlam; sahte onay yasak.
8. **BYOK / permissive lisans** — gömülü anahtar yok, copyleft/NC varlık yok.
9. **Head unit öncelik** — eski WebView (Chrome 52+) uyumu bozulmaz.
10. **Zero-Leak** — her listener/timer/worker cleanup'ta iptal edilir.
11. **Confidence gate (K.4)** — düşük güvenli veri kesin karar üretemez; her
    ikinci-nesil motor güven eşiği tanımlar, Vehicle Brain düşük güvende
    downgrade/suppress eder ("bilinmiyor" > yanlış kesinlik). Aftermarket
    çok-marka belirsizliğinin sigortası.
12. **Brain ince kalır (K.6)** — Vehicle Brain yalnız arbitraj/politika; iş
    mantığı motorlarda durur. Brain çökse State+motorlar ayakta (fail-soft).
```
