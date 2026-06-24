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

---

## ⏳ Başlanmamış İşler

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
