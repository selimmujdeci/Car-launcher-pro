# ROADMAP — CarOS Pro

> Yol haritası ve öncelik sırası. Detaylı anlık durum için `PROJECT_STATE.md`,
> mimari için `ARCHITECTURE.md`, devir notları için `HANDOFF.md`.
> Son güncelleme: 2026-06-24. Branch: `fix/k24-perf-webgl-bundle-rotation`.

---

## ✅ Tamamlanan İşler (kod tabanında doğrulandı)

- **Safety Assistant Faz 1–3A** (commit `9617664` `feat(safety): add vehicle safety overlay`):
  saf `SafetyRuleEngine` (10 kural) → durumlu `SafetyAlertQueue` (debounce/repeat/mute/öncelik) →
  izole `safetyStateMapper`+`useSafetyAlerts` → `SafetyOverlay` UI (K24 uyumlu). Standart:
  `SAFETY_ASSISTANT_STANDARD.md`. Test: engine 78/queue 24/bridge 31/tick 21/overlay 8 yeşil, guard 45.
  **VoiceSafetyAnnouncer ve CAN canlı bağlantı HENÜZ YOK** (Faz 3B + handshake).

- **Faz 1 GPU yükü azaltma** (commit 2fbbd57): `.up-blob` blur `--rt-blur` guard'ına
  bağlandı, ambient blob koşullu render (`blurEnabled`), MiniMap WebGL `homeFullyHidden`
  ile unmount. Salt görsel/koşullu-render, davranış aynı.
- **BLE GATT transport** (commit 04d0ef2): ELM327 BLE GATT üzerinden konuşuyor;
  transport persist + bonded DUAL cihaz fallback timeout mantığı.
- **OBD PROTOCOL_CYCLE** (obdService.ts:608): KWP2000/ISO9141/CAN araçlar için protokol
  döngüsü — CAN'a zorlama kaldırıldı.
- **Navigasyon kanonik hız** (commit 99abf60): HUD `useUnifiedVehicleStore` kanonik
  hızını kullanıyor.
- **McuEventSniffer crash loop fix** (commit ef20108): ölü executor
  RejectedExecutionException döngüsü kırıldı.
- **Vosk release keep** (commit ca0f345): Vosk + JNA sınıfları release build'de korunuyor.
- **Vosk mikrofon iyileştirmeleri KODLANDI**: AGC/NS/AEC + VOSK_GAIN + audio ducking
  (commit edilmemiş, cihazda doğrulanmamış).

---

## 🔄 Devam Eden / Yarım İşler

- **Bekleyen unstaged değişiklikler** (commit edilmeli): MainLayout.tsx safeStorage
  refactor + setTheme day/night eşlemesi; ayrıca tüm android native dosyaları `M`.
  → Önce `git diff` ile gözden geçir, sonra anlamlı parçalara böl ve commit et.
- **OBD/BLE saha testi:** Kod hazır, gerçek araç + adaptör testi bekliyor.
- **Vosk mikrofon cihaz testi:** Native compile OK, head unit'te STT kalitesi/ducking
  test edilmedi.

### 🔴 Açık saha testleri (kanıt bekleyen bug'lar — gerçek araç gerekli)

> Kök neden analizi yapıldı (kod okundu), HAM LOG gelmeden patch YOK. Prosedür dosyaları hazır.

- **ParkingBrake yanlış** (`PARKING_BRAKE_FIELD_TEST.md`): el freni inik ama app çekili
  gösteriyor. Aday: NWD CarInfo `mHandbrake != 0` testi (NwdCanClient.java:356) çok-durumlu
  byte'ı/polariteyi yanlış okuyor. El freni inik/çekili + kapı çapraz ham değer bekleniyor.
- **K24 head unit TTS sessiz** (`TTS_FIELD_TEST.md`): telefonda ses var, head unit'te yok
  (safety dahil). Aday: ROM'da TTS motoru yok → `ttsReady=false` → sessiz reject
  (CarLauncherPlugin.java:3064). `pm list packages | grep tts` + chime/TTS gözlemi bekleniyor.
- **Harita takip / heading** (`MAP_FOLLOW_FIELD_TEST.md`): harita bazen sabit, bazen yön ters.
  Adaylar: **A** düşük hızda course-over-ground null (4m eşiği + birikmeyen prevPos) → heading
  donuyor; **B** MiniMap `isDriving` ham GPS hızına bağlı (fused değil); **D** FullMapView
  nav-dışı follow kilidi. **DR elendi.** 30s düz/10s duruş/dönüş/düz senaryosu logu bekleniyor.

---

## ⏳ Başlanmamış İşler

- **OBD Patch 12 — üretici-özel PID katmanı (UDS Mode 22/ISO-TP):** plan HAZIR →
  `docs/OBD_PATCH12_PLAN.md` (2026-07-05). ECU adresleme + readDid + 7F/0x78
  disiplini + profil formatı (eval'sız decode tablosu) + ISO 14229 kesin-kamu
  başlangıç DID'leri + saha DID keşif aracı. İki ajan aşaması; Patch 11 sonrası.
- **OBD entegrasyon dalgası (Patch 11-12 sonrası):** querySensor + readAllDTCs +
  freeze frame + readiness → bakım beyni kartları + sesli asistan araç bağlamı
  (feat/assistant-open-app işiyle birleşir) + BYOK AI teşhis sentezi (offline'da
  statik tabloya zarif düşüş; tespit deterministik kalır, AI yalnız yorumlar).
  **Aynı dalgada — asistan alan-modülü ayrıştırması (KARAR 2026-07-05):** ürün
  TEK asistan kalır (tek wake word — sürüşte "hangisine sesleneceğim" yükü
  olmaz, K24'te ikinci Vosk hattı taşınmaz); içeride intentEngine alan
  modüllerine bölünür: NavIntents / VehicleIntents / MediaIntents / AppControl —
  deterministik yerel hızlı yol, eşleşmezse beyin zinciri. Navigasyon offline +
  anında çalışmak ZORUNDA (rota sürerken beyin beklenmez) + **bağlam önceliği**:
  aktif rota varken nav-intent eşiği düşer ("vazgeç/ne kadar kaldı" navigasyona
  yapışır). Dosya-düzeyi ayrım = "nav parser'a dokundum, müzik bozulmadı"
  garantisi (offline hassasiyet dersinin devamı).
- **OBD hibrit kapsam ilkesi (İLKE 2026-07-05) + iki boşluk:** ürün GENEL —
  hiçbir özellik tek transporta/adaptöre göre tasarlanMAZ. Mevcut hibrit:
  classic BT (3-yol RFCOMM) + BLE GATT + WiFi TCP; otomatik BLE-önce/classic-
  fallback + transport persist; TCP yalnız açık seçim. Protokol döngüsü CAN'a
  zorlamaz (KWP/ISO9141 dahil); klon toleransları init'te. BOŞLUKLAR: (1) USB
  OTG seri ELM327 transportu yok (CH340/FTDI usb-serial; BT+WiFi'si sorunlu
  ünitelerde en sağlam yol olabilir — aday patch); (2) BLE GATT UUID çeşitliliği
  (üretici başına farklı servis; yaygın FFE0/FFF0 ailelerinin kapsamı saha
  testine muhtaç); (3) **KAPANDI (Patch 13, 2026-07-05)** — 29-bit UDS adresleme:
  withEcuHeader artık tx uzunluğuna göre dallanıyor (3 hane → 11-bit ATSH/ATCRA
  DEĞİŞMEDİ; 8 hane → ATSP7 gerekirse protokol geçişi + ATCP öncelik baytı +
  ATSH/ATCRA, HER durumda protokol+CP+header restore, klon "?" → dürüst
  desteklenmiyor null — bkz. ElmProtocol.withEcuHeader29Bit). Renault Zoe Ph2
  EVC/LBC DID'leri (odometre/12V akü/dış sıcaklık/motor devri + SOC/SOH/batarya
  voltajı-sıcaklığı/kullanılabilir enerji, OVMS3-MIT kaynaklı) profile eklendi
  (bkz. profiles/renaultZoePh2Profile.ts); CİHAZDA DOĞRULANMADI (yalnız JVM
  birim testleri + FakeChannel). Yeni OBD özellikleri her üç (ileride dört)
  transportta da çalışmak zorunda — BleObdManager'a API aynalama disiplini
  bunun için (withEcuHeader paylaşılan olduğundan bu patch otomatik aynalanır).
- **Filo Telemetrisi (VİZYON — B2B ürün, 2026-07-05):** OBD+GPS verisinin buluta
  akışı + web filo panosu. Filo değer önerisi: canlı konum/rota, yakıt takibi
  (hırsızlık tespiti), sürücü davranışı (ani fren/hızlanma/rölanti/aşırı hız),
  uzaktan arıza yönetimi (BEKLEYEN kod = lamba yanmadan servise çağır, readiness
  = muayene planlama). Mimari ilkeler: (1) araçta `telemetryService` — 30-60s
  özet paketler + olaylar (DTC/sert fren), ASLA ham 10Hz akış; offline kuyruk
  (safeStorage), internet değince toplu yükleme — "canlı", bağlantı varken
  canlıdır (head unit çoğu zaman WiFi-only; filo kurulumu SIM/hotspot varsayar).
  (2) Supabase: araç-başına RLS + GRANT üçlüsü (CLAUDE.md kuralları), multi-tenant
  (filo→araç→sürücü). (3) Web panosu AYRI ürün/repo — bu repo yalnız araç ucunu
  taşır. (4) KVKK/consent katmanı kurumsal sözleşme işi — sürücü konum takibi
  açık rıza ister. Gelir modeli: cihaz lisansı + filo aboneliği. ÖN KOŞUL:
  Patch 11-12 + saha doğrulaması (satılan verinin kendisi o patch'lerde üretiliyor).
- **Safety Assistant Faz 3B — VoiceSafetyAnnouncer:** sesli anons + chime + ducking + Sustur
  butonu (`useSafetyMute`). İzole `<SafetyAnnouncer />`, `voiceAnnouncementAlert`'i offline TTS'e
  yönlendirir. Ayrıca `signalsAvailable`'ı CAN handshake/profile'a bağla (gerçek araç canlı verisi).
  **VoiceSafetyAnnouncer + CAN canlı bağlantı henüz yapılmadı.**
- **Faz 2 — Interval gating** (onay bekliyor): VehicleSignalResolver 20→10/5Hz,
  NativeHALAdapter 2→1Hz, CognitivePriorityEngine 1→0.5Hz, vehicleIntelligenceService
  durağanda 2→1Hz. (Hedef dosya/satırlar PROJECT_STATE.md'de.)
- **Piped tek-instance riski giderme:** Tek canlı instance (private.coffee) düşerse
  YouTube çalışmaz. Alternatif kaynak / yerel proxy / graceful fallback stratejisi
  netleşmemiş. **Belirsiz**: hedeflenen çözüm yok.

---

## 🎯 Öncelik Sırası (önerilen)

1. **Bekleyen unstaged değişiklikleri gözden geçir + commit et** (çalışma ağacı kirli;
   yeni iş başlamadan temizlenmeli).
2. **OBD/BLE saha testi** — en yüksek değer; tüm OBD mimarisi cihazda doğrulanmamış.
3. **Vosk mikrofon cihaz testi** — head unit internetsiz, STT kritik.
4. **Faz 2 interval gating** — Faz 1'in CPU tamamlayıcısı; ama önce kullanıcı onayı +
   cihazda Faz 1 etkisinin ölçülmesi gerekir (gerçekten Faz 2'ye ihtiyaç var mı?).
5. Piped tek-instance riskine kalıcı çözüm.

---

## 🚫 ŞİMDİ YAPILMAMASI Gereken İşler

- **`blackBoxService.ts` 10Hz örnekleyiciyi (SAMPLE_INTERVAL=100) değiştirmek** — kaza
  kara kutusu, yüksek risk. Faz 2 kapsamı DIŞINDA.
- **Multi-system / büyük refactor** — `AI.md` STABILIZATION MODE aktif: yeni özellik yok,
  UI redesign yok, büyük refactor yok, "bir bug = bir fix". (Bkz. `AI.md`.)
- **Faz 3 görsel polish / tema redesign refactor'ları** — stabilizasyon önceliği var;
  performans + saha testi bitmeden başlanmamalı.
- **APK paketleme / release build** — kullanıcı açıkça istemeden yapılmaz.
- **Güvenlik servisleri (SafetyBrain, BlackBox) iş mantığına dokunmak** — yalnızca
  açık talep + risk analizi ile.
- **Yeni copyleft/NC lisanslı bağımlılık eklemek** — ticari satış engeli (bkz. CLAUDE.md
  lisans kuralı).
