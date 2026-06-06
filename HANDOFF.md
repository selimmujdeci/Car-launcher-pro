# HANDOFF — CarOS Pro Devir Notları

> Yeni ajan/oturum buradan başlasın. Projeyi kaldığı yerden devralma rehberi.
> Son güncelleme: 2026-06-06. Branch: `feature/ble-obd-support`.

---

## 1. Yeni Ajan İlk Ne Okumalı (sıra önemli)

1. **`CLAUDE.md`** — proje kuralları, dil kuralı (Türkçe zorunlu), onay isteme kuralı,
   automotive/V8 standartları, lisans kuralı. OVERRIDE eder.
2. **`AI.md`** — STABILIZATION MODE; "bir bug = bir fix", multi-system refactor YASAK,
   atomik patch, partial logic bırakma. Çakışmada `AI.md` mutlak öncelik.
3. **`PROJECT_STATE.md`** — şu an neredeyiz (branch, son commit, build/test, bekleyen iş).
4. **`ROADMAP.md`** — ne yapıldı / ne yapılacak / ne YAPILMAMALI + öncelik sırası.
5. **`ARCHITECTURE.md`** (manifesto) + **`ARCHITECTURE_DATAFLOW.md`** (somut veri akışı,
   kod referanslı).
6. Bu dosya (`HANDOFF.md`).

---

## 2. Son Yapılan Değişiklikler (özet)

- **Faz 1 GPU yükü azaltma** (commit 2fbbd57 = HEAD): blur guard + ambient blob koşullu
  render + MiniMap WebGL unmount. Salt görsel/koşullu render.
- **BLE GATT transport** (04d0ef2), **OBD protokol cycle**, **nav kanonik hız** (99abf60),
  **Vosk release keep** (ca0f345), **McuEventSniffer crash fix** (ef20108).
- **Commit edilmemiş:** MainLayout.tsx safeStorage + setTheme; tüm android native dosyaları
  (`M`). Detay PROJECT_STATE.md'de.
- **Çöp kod analizi** (2026-06-06, rapor-only, silme YOK): knip ile ölü-kod/paket taraması.
  Gerçek adaylar (eski layout sistemi, traffic/*, diagnostic/*) ve false-positive kümeleri
  PROJECT_STATE.md'de. **Yan bulgu:** `useSABDirectUpdate` ÖLÜ → `ARCHITECTURE_DATAFLOW.md`
  §1 düzeltildi (aktif hız akışı Zustand üzerinden).
- **Mühendislik süreç sistemi** (2026-06-06): `RELEASE_CHECKLIST.md`, `CONTRIBUTING.md`,
  `docs/adr/0001-0004`, `.github/pull_request_template.md`, `docs/TEST_MATRIX.md`,
  `docs/FEATURE_FLAGS.md` eklendi. Release öncesi RELEASE_CHECKLIST'i, yeni iş öncesi
  CONTRIBUTING'i izle.

---

## 3. DOKUNULMAMASI Gereken Dosyalar / Alanlar

- **`src/platform/security/blackBoxService.ts`** — 10Hz örnekleyici (SAMPLE_INTERVAL=100,
  satır 54). Kaza kara kutusu, yüksek risk. Faz 2 kapsamı DIŞINDA.
- **Güvenlik servisleri** — `SafetyBrain` (fault tracking/feature disable), blackBox.
  İş mantığına yalnızca açık talep + risk analizi ile.
- **`src/components/map/FullMapView.tsx`** — navigasyon/harita zırhı (map mutex, route
  survive). `AI.md` MAP/NAVIGATION kuralları geçerli; dikkatli ol.
- **`VehicleSignalResolver` SAB/Seqlock mantığı** — Faz 2'de SADECE polling frekansı
  (20Hz→10/5Hz) düşürülecek; Seqlock/cache-line yapısına dokunma.
- **İş mantığı katmanları:** OBD, BLE, GPS, Vosk, Supabase — bunlar saha/entegrasyon
  bağımlı; "düzelttim" demeden önce cihazda doğrula.

---

## 4. Bir Sonraki Önerilen İş

İki aday (öncelik kullanıcıya bağlı):
- **A) Cihaz saha testi** (önerilen ilk adım): OBD/BLE bağlantısı + Vosk mikrofon +
  müzik ducking gerçek K24 head unit'te. Tüm bu mimari kodda hazır ama CİHAZDA
  DOĞRULANMADI.
- **B) Faz 2 interval gating** (kullanıcı onayı bekliyor): VehicleSignalResolver 20→10/5Hz,
  NativeHALAdapter 2→1Hz, CognitivePriorityEngine 1→0.5Hz, vehicleIntelligenceService
  durağanda 2→1Hz. blackBox 10Hz DEĞİŞMEZ.

- **C) Ölü-kod temizliği** (rapor hazır, PROJECT_STATE.md). En düşük riskten başla: izole
  tekiller → eski layout zinciri → diagnostic → traffic/*. Her adımda build+test+e2e+screenshot.
  AI.md atomik-patch; offline harita + BLE-ilişkili dosyalara DOKUNMA (GÜVENLİ DEĞİL).

> Not: B'ye başlamadan önce Faz 1'in cihazdaki etkisini ölçmek mantıklı — belki yeterli.
> Ayrıca çalışma ağacı kirli; yeni iş öncesi bekleyen değişiklikleri commit etmek iyi olur.

---

## 5. Test Bekleyen İşler (saha)

- **OBD cihaz testi** — BLE GATT + protokol cycle gerçek araçta (Fiat Doblo 1.4 8v =
  KWP2000 senaryosu dahil). Car Scanner bağlanıp bizimkinin bağlanmama sorununun
  çözüldüğü doğrulanmalı.
- **Vosk mikrofon cihaz testi** — AGC/NS/AEC + VOSK_GAIN ile STT kalitesi; head unit
  internetsiz.
- **Müzik ducking testi** — dinlerken müzik %12'ye iniyor mu, bitince restore oluyor mu.
- **Faz 1 GPU testi** — K24'te dokunma gecikmesi gerçekten düştü mü (ölçüm).

---

## 6. Bilinen Riskler

- **Branch belirsizliği:** CLAUDE.md "master" diyor, çalışma `feature/ble-obd-support`'ta;
  hem main hem master ref var. Merge hedefi netleşmeli.
- **Piped tek-nokta riski:** `pipedProvider.ts:22-28` 5 aday içerir ama yalnızca
  `api.piped.private.coffee` canlı doğrulanmış; o düşerse YouTube arama/stream çöker.
- **Commit edilmemiş native değişiklikler:** Android dosyaları `M` ve
  `android/app/src/main/assets/` UNTRACKED (`??` — Vosk modeli/`uuid` git'te yok);
  commit/transfer öncesi `git diff` ile gözden geçirilmeli. (~240 dosyalık kirli ağaç.)
- **Cihazda doğrulanmamış native iş yığını:** OBD/BLE + Vosk büyük oranda saha testi
  bekliyor — "tamamlandı" sayma.
- **OBD mock env adı tutarsızlığı:** Kod `VITE_ENABLE_OBD_MOCK` okuyor (obdService.ts:747,
  opt-in) ama `.env.example:25` + `.github/workflows/main.yml:32` okunmayan
  `VITE_DISABLE_OBD_MOCK`'u kullanıyor → o CI satırı **etkisiz**. Üretim varsayılanı güvenli
  (mock kapalı) ama doküman/CI yanıltıcı. Düzeltme ayrı küçük iş (kod/CI dokunuşu gerektirir).
- **STABILIZATION MODE:** AI.md gereği yeni özellik/büyük refactor yasak; tek-bug-tek-fix.

---

## 7. Çalışma Kuralı Hatırlatması

- Tüm yanıtlar **Türkçe**.
- **Onay isteme yok** — CLAUDE.md gereği işlemler doğrudan yapılır (ama AI.md stabilizasyon
  sınırları korunur).
- Kök neden bulunmadan fix önerme; semptom ≠ kök neden.
- Dosya/fonksiyon/satır iddialarını **yazmadan önce kod tabanından doğrula** (bu dosyalar
  da öyle yazıldı).
