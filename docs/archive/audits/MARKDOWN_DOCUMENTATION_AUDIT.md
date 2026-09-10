# CAROS PRO — Markdown Dokümantasyon Envanteri ve Forensic Denetim

> **Bu belge yalnızca DENETİM ÇIKTISIDIR.** Aktif backlog, roadmap veya görev listesi değildir.
> Hiçbir belge silinmedi, taşınmadı, yeniden adlandırılmadı veya değiştirilmedi.
> **Denetim tarihi:** 2026-07-26 · **Branch:** `feat/caros-lab-phase-a1` · **HEAD:** `f89540c`

---

## 1. Yönetici Özeti

Repository'de **97 CAROS PRO Markdown belgesi** var (96 git-izlemeli + 1 izlenmeyen).
Ayrıca **2 653 belge hariç tutuldu** (bağımlılık, worktree, build çıktısı, araç üretimi).

Ana bulgular:

1. **Tek P0 (yanlış yönlendiren) bulgu lisanstır.** `README.md` iki ayrı yerde projeyi
   **MIT lisanslı** ilan ediyor; oysa depoda yalnızca `LICENSE-PROPRIETARY.md` var ve o
   belge projeyi **"tescilli, kapalı kaynak ticari ürün"** olarak tanımlıyor. Bu, hukuki
   sonuç doğurabilecek tek dokümantasyon çelişkisidir.

2. **Belge sayısı değil, KATMAN sayısı sorun.** Aynı konu için üç ayrı "nesil" belge
   birikmiş: (a) 2026-04/05 dönemi kök belgeleri, (b) 2026-06 `docs/` belgeleri,
   (c) 2026-07-12'de tek seferde üretilmiş `docs/project/` seti. Üçü de kendini güncel
   sunuyor ama yalnız bir kısmı bakımda.

3. **Dört belge kendini "tek gerçek kaynak" ilan ediyor.** İkisi arasındaki çelişki
   (`docs/CAROS_PRO_VIZYONU.md` ↔ `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md`) vizyon belgesinin
   kendi "Çelişki Kaydı" bölümünde ZATEN çözülmüş; ancak `docs/project/MASTER_PROMPT.md`
   ve `docs/project/DEVICE_VALIDATION.md` bu kayda dâhil edilmemiş.

4. **Kod referansları büyük ölçüde sağlam.** 96 belgede geçen dosya yollarının otomatik
   taramasında yalnız **3 gerçek ölü referans** bulundu. `npm run` komutlarından yalnız
   biri (`postinstall`) yok. Bu, dokümantasyonun teknik doğruluk açısından beklenenden
   iyi durumda olduğunu gösteriyor.

5. **`docs/archive/` deseni doğru kurulmuş ve çalışıyor** — kendi README'si hangi güncel
   belgenin neyi geçersiz kıldığını tablo hâlinde yazıyor. Bu desen, arşivlenmesi önerilen
   diğer belgeler için hazır bir şablondur.

**Sayısal iddia kullanılmadı:** yüzde, kalite puanı veya tahmini "güncellik oranı" verilmedi.
Her sınıflandırmanın arkasında dosya kanıtı var.

---

## 2. Tarama Kapsamı ve Hariç Tutulan Alanlar

### Taranan alanlar
Repository kökü · `docs/` (ve tüm alt klasörleri: `adr/`, `archive/`, `db/`, `project/`) ·
`src/` · `android/` · `.github/` · `e2e/` · `supabase/` · `website/` · `scripts`/tooling ·
`docs-local/` · `test-results/` · `test-artifacts/`

### Hariç tutulanlar

| Alan | Dosya | Gerekçe |
|------|-------|---------|
| `node_modules/` | 1 041 | Bağımlılık belgeleri — CAROS PRO dokümantasyonu değil |
| `.worktrees/` | 1 585 | Aynı repo'nun git worktree kopyaları — çift sayım olurdu |
| `dist/`, `build/`, `.git/` | (kalan) | Build çıktısı / VCS iç yapısı |
| **Hariç toplam** | **2 653** | |

**Not:** `website/node_modules` ve `website/.next` de bu kapsamda hariçtir.
`android/` altında (build çıktısı hariç) **hiç `.md` yok** — Android katmanı için
ayrı geliştirici belgesi bulunmuyor (bkz. §12).

### Sınır durum: `android/` yokluğu
Bu bir "hariç tutma" değil, **gerçek bir boşluktur**: `android/phonehub-companion/`,
`android/phonehub-protocol/` gibi yeni Gradle modülleri eklendiği hâlde hiçbirinde
README yok.

---

## 3. Toplam Markdown Dosyası Sayısı

| Ölçüm | Sayı |
|-------|------|
| Diskteki tüm `.md` | **2 750** |
| `node_modules` hariç | 1 709 |
| **CAROS PRO belgesi (tarama sonucu)** | **124** |
| ├─ git tarafından izlenen | 96 |
| ├─ izlenmeyen (yeni) | 1 (`docs/RELEASE_CHECKLIST.md`) |
| └─ git-ignore edilen yerel/üretilmiş | 27 |
| **Denetime giren CAROS PRO belgesi** | **97** |

---

## 4. Kategori Bazında Dosya Sayıları

| Kategori | Sayı | Alan |
|----------|------|------|
| 1. CAROS PRO'ya özel belgeler | 97 | kök, `docs/`, `e2e/`, `src/platform/`, `supabase/`, `.github/` |
| 2. Araç/kütüphane tarafından üretilen | 9 | `test-results/*/error-context.md` (Playwright) |
| 3. Bağımlılık / vendor | 2 654 | `node_modules/` (1 041) + `.worktrees/` (1 585) + `website/public/icons/README.md` (ikon seti notu) |
| 4. Geçici analiz ve rapor | 17 | `docs-local/` (16, git-ignore) + `test-artifacts/` (1) + `scratchpad.md` (0 satır) |
| 5. Aktif mimari belgeler | 6 | bkz. §6 sınıf A |
| 6. Roadmap ve görev belgeleri | 8 | |
| 7. Kurulum ve operasyon belgeleri | 11 | |
| 8. Test ve doğrulama belgeleri | 12 | |

> Kategoriler 5–8, kategori 1'in alt kümesidir (çift sayım değildir).

---

## 5. Eksiksiz Belge Envanteri

### 5.1 Kök dizin (44 belge)

| Dosya | Satır | Son commit | Başlık / amaç |
|-------|-------|-----------|----------------|
| `README.md` | 284 | 2026-07-07 | CockpitOS Pro — proje giriş kapısı (İngilizce) |
| `CLAUDE.md` | 568 | 2026-07-24 | Claude çalışma anayasası — dil, vizyon, faz, gözlemlenebilirlik kuralları |
| `AI.md` | 104 | 2026-07-07 | AI yürütme kuralları — CLAUDE.md'ye göre **mutlak öncelikli** |
| `GEMINI.md` | 115 | 2026-07-15 | Gemini çalışma anayasası (strict read-only denetçi rolü) |
| `CONTRIBUTING.md` | 101 | 2026-06-06 | Süreç kuralları; CLAUDE/AI'ya referans verir, kopyalamaz |
| `CODE_OF_CONDUCT.md` | 38 | 2026-07-09 | Davranış kuralları |
| `SECURITY.md` | 56 | 2026-07-09 | Güvenlik politikası / zafiyet bildirimi |
| `LICENSE-PROPRIETARY.md` | 60 | 2026-07-09 | Tescilli ticari lisans |
| `CHANGELOG.md` | 23 | 2026-06-10 | Keep a Changelog · SemVer; sürüm kaynağı `version.properties` |
| `ARCHITECTURE.md` | 45 | 2026-04-30 | "Sistem Manifestosu" — üst-düzey mimari vizyon |
| `ARCHITECTURE_DATAFLOW.md` | 154 | 2026-06-24 | Somut veri akış haritası; ARCHITECTURE.md'yi tamamladığını açıkça yazar |
| `SYSTEM_MAP.md` | 24 | 2026-05-17 | H/S/A serisi durum haritası — 3 madde "COMPLETED" |
| `PROJECT_OVERVIEW.md` | 64 | 2026-06-08 | Yeni geliştiriciye mimari giriş |
| `PROJECT_STATE.md` | 1 460 | 2026-07-05 | "Anlık gerçek durum" — en büyük durum belgesi |
| `PROGRESS.md` | 99 | 2026-07-01 | Faz bazlı ilerleme (website + head unit karışık) |
| `HANDOFF.md` | 938 | 2026-07-05 | Devir notları; CONTRIBUTING §0 okuma sırasını buradan alır |
| `ROADMAP.md` | 148 | 2026-07-05 | Kök roadmap |
| `ACTIVE_TASK.md` | 44 | 2026-05-17 | "S1–S4 + A1–A2 MÜHÜRLENDİ — %100 TAMAMLANDI" |
| `TODO_MISSION.md` | 33 | 2026-04-30 | D-serisi mission tracker |
| `MEMORY.md` | 47 | 2026-05-17 | "Brain & Hands" çalışma metodolojisi + handover |
| `FEATURES.md` | 76 | 2026-06-12 | Ürün & özellik dökümanı |
| `AUDIT_FINDINGS.md` | 556 | 2026-06-08 | Derin mimari audit — ~48 bulgu, P0 security triage |
| `AUDIT_EMPTY_FEATURES.md` | 54 | 2026-04-25 | QA: boş/placeholder özellik denetimi |
| `BRUTAL_TRUTHS.md` | 31 | 2026-04-25 | 6 varoluşsal tehdit (simülasyon, sorumluluk, dil, güven, güneş, platform) |
| `CRITICAL_RISKS.md` | 31 | 2026-04-25 | 6 **FARKLI** risk (mimari illüzyon, master key, maliyet, donanım, rekabet, akü) |
| `HARDENING_STRATEGY.md` | 52 | 2026-04-24 | Geofence 2.0 + bakım servisi sertleştirme |
| `CRITICAL_RISKS` / `BRUTAL_TRUTHS` | — | — | ⚠️ Başlıkları benzer, **içerikleri ayrı** (bkz. §8) |
| `RELEASE_CHECKLIST.md` | 154 | 2026-06-10 | Yayın kontrol listesi (kök sürüm) |
| `APK_CIKTISI.md` | 33 | 2026-05-02 | İmzalı release APK bilgileri |
| `OFFLINE_TILES_SETUP.md` | 270 | 2026-03-24 | Offline tile kurulum kılavuzu |
| `SERVICE_WORKER_OFFLINE.md` | 291 | 2026-03-24 | Service worker offline harita sistemi |
| `SAFETY_ASSISTANT_STANDARD.md` | 247 | 2026-06-24 | Güvenlik asistanı standardı — kodda **canlı referans** |
| `OBD_TELEMETRY_INTEGRATION_PLAN.md` | 201 | 2026-07-01 | OBD motor telemetri entegrasyon planı |
| `K24_CAN_OBD_FINDINGS.md` | 118 | 2026-06-14 | K24/NWD CAN-OBD saha teşhisi — benzersiz donanım kanıtı |
| `MAP_FOLLOW_FIELD_TEST.md` | 160 | 2026-06-25 | Harita takip/heading saha testi |
| `PARKING_BRAKE_FIELD_TEST.md` | 141 | 2026-06-25 | El freni ham değer saha testi |
| `TTS_FIELD_TEST.md` | 135 | 2026-06-25 | Head unit TTS saha testi |
| `NIGHT_ERGONOMICS_REPORT.md` | 98 | 2026-07-01 | Gece okunabilirlik analizi (4 tema) |
| `TECHNICAL_SPEC_OFFLINE_SEARCH.md` | 68 | 2026-04-24 | Offline arama teknik şartname |
| `TECHNICAL_SPEC_REMOTE_COMMAND.md` | 98 | 2026-04-25 | Uzaktan komut teknik şartname |
| `TECHNICAL_SPEC_STYLE_ENGINE.md` | 122 | 2026-04-24 | Stil motoru teknik şartname |
| `TECHNICAL_SPEC_ZERO_FLUFF.md` | 89 | 2026-04-24 | "Zero fluff" teknik şartname |
| `B2B_PITCH.md` | 51 | 2026-07-01 | B2B lisanslama sunumu |
| `MARKETING_ONEPAGER.md` | 55 | 2026-06-12 | Pazarlama tek sayfa |
| `scratchpad.md` | 0 | (ignore) | **Tamamen boş** |

### 5.2 `docs/` — ana seviye (23 belge)

| Dosya | Satır | Son commit | Amaç |
|-------|-------|-----------|------|
| `CAROS_PRO_VIZYONU.md` | 1 143 | **2026-07-26** | Vizyon/durum tek kaynağı — CLAUDE.md bunu zorunlu okuma ilan eder |
| `DEVICE_VALIDATION_LEDGER.md` | 185 | **2026-07-26** | Saha doğrulama kütüğü — saha durumunda **mutlak otorite** |
| `CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` | 1 386 | 2026-07-07 | Tam Vehicle Intelligence mimarisi ("8 Kapı") |
| `CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md` | 139 | 2026-07-24 | FAZ A geliştirici platformu stratejisi |
| `MAVI_NEXT_VISION.md` | 232 | **2026-07-26** | Mavi asistan ürün vizyonu |
| `COMPANION_AI_ARCHITECTURE.md` | 269 | 2026-06-11 | "Yol Arkadaşım" mimarisi — kodda canlı referans |
| `OBD_DIAGNOSTIC_OS_ROADMAP.md` | 295 | 2026-07-15 | OBD alt-roadmap'i (kendini "TEK GERÇEK KAYNAK" ilan eder) |
| `CAROS_15_YIL_VIZYON_YOL_HARITASI.md` | 319 | 2026-07-09 | 15 yıllık vizyon |
| `CAROS_PROJE_HAKIMIYET_RAPORU.md` | 297 | 2026-07-09 | Proje hakimiyet raporu |
| `ASSISTANT_VEHICLE_INTEGRATION_PLAN.md` | 152 | 2026-07-05 | Asistan ↔ araç verisi entegrasyonu (V-serisi) |
| `DEVICE_VALIDATION_PLAN_RENAULT_TRAFIC.md` | 268 | 2026-07-10 | Trafic saha doğrulama planı |
| `HEAD_UNIT_MATRIX.md` | 217 | 2026-07-04 | Cihaz uyumluluk matrisi |
| `SOAK_MANUAL_K24_CHECKLIST.md` | 394 | 2026-06-09 | 8–24 saat soak prosedürü |
| `WEB_URUN_UYUM_BACKLOG.md` | 131 | 2026-07-09 | Web sitesi ↔ araç uygulaması uyum backlog'u |
| `OBD_PATCH12_PLAN.md` | 108 | 2026-07-05 | UDS Mode 22 / ISO-TP üretici PID katmanı planı |
| `OTA.md` | 108 | 2026-06-10 | OTA v1 mimari + operasyon |
| `PERF_AUDIT.md` | 148 | 2026-06-09 | Performans baseline & ölçüm planı |
| `PERF_K24_CHECKLIST.md` | 86 | 2026-06-09 | K24 manuel FPS/RAM checklist |
| `TEST_MATRIX.md` | 56 | 2026-06-09 | Test matrisi |
| `FEATURE_FLAGS.md` | 75 | 2026-06-07 | Feature flag envanteri |
| `VOSK_MODEL_SETUP.md` | 44 | 2026-06-07 | Vosk TR offline STT kurulumu |
| `OBD_DATA_SOURCES_LEGAL.md` | 45 | 2026-07-05 | Üretici PID/DID yasal kaynak haritası |
| `HANDOFF_2026-07-06.md` | 64 | 2026-07-07 | Tarihli devir notu |
| `RELEASE_CHECKLIST.md` | 87 | **izlenmiyor** | Satış/production yayın kontrol listesi (yeni) |

### 5.3 `docs/project/` (9 belge — hepsi 2026-07-12'de tek seferde üretilmiş)

| Dosya | Satır | Son commit | Amaç |
|-------|-------|-----------|------|
| `MASTER_PROMPT.md` | 194 | 2026-07-12 | "Proje Anayasası" — kendini **TEK GERÇEK KAYNAK** ilan eder |
| `ARCHITECTURE.md` | 98 | 2026-07-12 | "Canlı mimari" — `SystemBoot.ts` + wiring kaynaklı |
| `PROJECT_STATUS.md` | 93 | 2026-07-12 | Merge sonrası güncellenen durum |
| `ROADMAP.md` | 67 | 2026-07-12 | Bağımlılık sıralı roadmap |
| `PROJECT_MEMORY.md` | 96 | 2026-07-12 | Uzun vadeli mimari kararlar (Ne + Neden + Tradeoff) |
| `TEST_STRATEGY.md` | 86 | 2026-07-12 | Test anayasası |
| `DEVICE_VALIDATION.md` | 65 | 2026-07-12 | Kütüğün operasyonel checklisti |
| `AGENT_GUIDE.md` | 93 | 2026-07-12 | Çoklu ajan koordinasyon rehberi |
| `SESSION.md` | 16 | 2026-07-18 | Aktif oturum (≤30 satır) |

### 5.4 `docs/adr/` (4 belge — hepsi 2026-06-06)

`0001-canonical-speed-source.md` (60) · `0002-low-end-head-unit-performance-mode.md` (71) ·
`0003-ble-obd-transport-architecture.md` (62) · `0004-youtube-iframe-video-strategy.md` (50)

### 5.5 `docs/archive/` (10 belge — hepsi 2026-06-06 commit'li, içerik 2026-05-19/20)

`README.md` (21, **arşiv indeksi ve geçersiz-kılma tablosu**) ·
`CAN_BUS_DEEP_ANALYSIS_2026_05_20.md` (294) · `CODER_AUDIT_REPORT_2026_05_19.md` (309) ·
`OEM_ANALYSIS_2026_05_19.md` (319) · `OEM_CODE_ANALYSIS_2026_05_19.md` (533) ·
`PERFORMANCE_DEEP_ANALYSIS_2026_05_19.md` (362) · `PERFORMANCE_FIX_PROMPT.md` (113) ·
`CAROS_PRO_DEVIR_DOKUMANI_v1.md` (187) · `REDESIGN_HANDOFF.md` (98) ·
`REDESIGN_REMAINING_TASKS.md` (64)

### 5.6 `docs/db/` (2 belge)

`CANONICAL_SCHEMA_INVENTORY.md` (232, 2026-07-10) · `CANONICAL_SOURCE_DECISION.md` (88, 2026-07-10)

### 5.7 Kod ağacı içi ve diğer (5 belge)

| Dosya | Satır | Amaç |
|-------|-------|------|
| `.github/pull_request_template.md` | 61 | PR şablonu |
| `e2e/README.md` | 64 | Playwright E2E kurulum/çalıştırma |
| `src/platform/OFFLINE_MAP_GUIDE.md` | 205 | Offline harita kılavuzu (kod ağacı içinde) |
| `supabase/verification/README.md` | 65 | Salt-okuma şema doğrulama tooling'i |
| `website/public/icons/README.md` | 13 | İkon seti notu (vendor sınırında) |

### 5.8 Git-ignore edilen yerel çıktılar (27 — denetim dışı)

`docs-local/` altında 16 belge (device-runs 8, qa-runs 7, TRIP_COST_AI_ARCHITECTURE 1) ·
`test-results/` 9 Playwright error-context · `test-artifacts/` 1 · `scratchpad.md` 1 (boş)

---

## 6. A–F Sınıflandırma Tablosu

### Sınıf A — Kritik ve Aktif (16)

| Dosya | Gerekçe (kanıt) |
|-------|------------------|
| `CLAUDE.md` | Yürütme anayasası; her oturumun bağlayıcı kuralı |
| `AI.md` | `CLAUDE.md:452` "AI.md rules take absolute priority" |
| `GEMINI.md` | Denetçi rolünün anayasası; strict read-only |
| `docs/CAROS_PRO_VIZYONU.md` | CLAUDE.md zorunlu okuma ilan eder; 2026-07-26 güncel |
| `docs/DEVICE_VALIDATION_LEDGER.md` | Saha durumunda **mutlak otorite** (CLAUDE.md); 2026-07-26 güncel |
| `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` | CLAUDE.md "Tam mimari" olarak işaret eder |
| `docs/CAROS_LAB_DEVELOPER_PLATFORM_STRATEGY.md` | Aktif FAZ A politikasının tam metni |
| `docs/MAVI_NEXT_VISION.md` | Mavi ürün vizyonu; 2026-07-26 güncel |
| `docs/COMPANION_AI_ARCHITECTURE.md` | `companionContext.ts`/`companionIdentity.ts` kaynak yorumlarında canlı referans |
| `SAFETY_ASSISTANT_STANDARD.md` | `assistantSafetyKernel.ts` eşiklerini bu belgeye hizalar |
| `LICENSE-PROPRIETARY.md` | Tek geçerli lisans belgesi |
| `SECURITY.md` | Güvenlik bildirim politikası |
| `CONTRIBUTING.md` | Süreç kuralları; kural kopyalamama disiplini örnek |
| `docs/HEAD_UNIT_MATRIX.md` | Donanım uyumluluk otoritesi; başka kaynağı yok |
| `docs/OBD_DATA_SOURCES_LEGAL.md` | Ticari lisans kuralının veri-kaynağı ayağı |
| `.github/pull_request_template.md` | CI/PR sürecine bağlı canlı şablon |

### Sınıf B — Faydalı Fakat Güncellenmeli (14)

| Dosya | Neden güncellenmeli (kanıt) |
|-------|------------------------------|
| `README.md` | **MIT lisans iddiası** (satır 3 + 284) — bkz. §7 D-01 |
| `docs/project/ARCHITECTURE.md` | "Son güncelleme 2026-07-12 (W5-1 sonrası)"; sonrasında CAROS LAB A1–A9, Phone Hub P0.5–P1-A, Mavi Faz 1–4 eklendi |
| `docs/project/PROJECT_STATUS.md` | Aynı tarih damgası; kütük #114–#137 arası hiçbir madde yok |
| `docs/project/ROADMAP.md` | Aynı; W5-1 sonrası iş yok |
| `docs/project/SESSION.md` | Aktif branch `feat/w5-obd-pr1-native-handshake` yazıyor; gerçek `feat/caros-lab-phase-a1` |
| `docs/project/DEVICE_VALIDATION.md` | Kütüğün operasyonel kopyası; kütük 137 maddeye çıktı |
| `PROJECT_STATE.md` | "Son güncelleme 2026-07-05"; 1 460 satır, sonraki 3 haftanın işi yok |
| `HANDOFF.md` | Aynı tarih; `src/platform/voiceContextBuilder.ts` ölü referansı (§7 D-04) |
| `ROADMAP.md` | 2026-07-05; `docs/project/ROADMAP.md` ve OBD roadmap ile hizalanmamış |
| `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md` | "TEK GERÇEK KAYNAK" ifadesi kapsam belirtmeden duruyor (vizyon Ç-1'de çözülmüş ama belge içinde not yok) |
| `docs/TEST_MATRIX.md` | 2026-06-09; test sayısı ve suit yapısı çok değişti |
| `docs/FEATURE_FLAGS.md` | 2026-06-07; `DEVELOPER_FEATURES_ENABLED`, takeover flag'i gibi yeni kapılar yok |
| `PROGRESS.md` | Website (Next.js) ve head unit fazları **ayrımsız** listeleniyor → okuyucu hangi ürün olduğunu ayırt edemiyor |
| `docs/adr/0001-canonical-speed-source.md` | 3 ölü dosya referansı (§7 D-03) |

### Sınıf C — Birleştirilmeli (13)

| Dosya | Hedef ana belge |
|-------|------------------|
| `ARCHITECTURE.md` | `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` (vizyon/manifesto bölümü) |
| `ARCHITECTURE_DATAFLOW.md` | Aynı (veri akışı bölümü) — kendisi zaten "tamamlar" diyor |
| `PROJECT_OVERVIEW.md` | `README.md` (geliştirici giriş bölümü) |
| `SYSTEM_MAP.md` | `docs/project/PROJECT_STATUS.md` |
| `MEMORY.md` | `docs/project/PROJECT_MEMORY.md` |
| `BRUTAL_TRUTHS.md` | Tek "Riskler" belgesi (⚠️ içerikler FARKLI — birleşim, silme değil) |
| `CRITICAL_RISKS.md` | Aynı hedef |
| `RELEASE_CHECKLIST.md` (kök) | `docs/RELEASE_CHECKLIST.md` ile birleştirilmeli (§7 D-02) |
| `docs/PERF_AUDIT.md` | Tek performans belgesi |
| `docs/PERF_K24_CHECKLIST.md` | Aynı hedef |
| `docs/SOAK_MANUAL_K24_CHECKLIST.md` | Aynı hedef |
| `MAP_FOLLOW_FIELD_TEST.md` · `PARKING_BRAKE_FIELD_TEST.md` · `TTS_FIELD_TEST.md` | Tek "saha test protokolleri" belgesi |
| `B2B_PITCH.md` + `MARKETING_ONEPAGER.md` | Tek ticari/pazarlama belgesi |

### Sınıf D — Arşivlenmeli (13)

| Dosya | Gerekçe |
|-------|---------|
| `ACTIVE_TASK.md` | "17 Mayıs 2026 mühürlendi, %100 tamamlandı" — kapanmış faz |
| `TODO_MISSION.md` | 2026-04-30; D-serisi tracker, sonraki roadmap'lerle değiştirilmiş |
| `AUDIT_EMPTY_FEATURES.md` | 2026-04-25 QA anlık görüntüsü |
| `AUDIT_FINDINGS.md` | 2026-06-08 audit; ⚠️ P0 security triage maddeleri önce §9'a taşınmalı |
| `HARDENING_STRATEGY.md` | 2026-04-24; Geofence 2.0 dönemine ait |
| `TECHNICAL_SPEC_OFFLINE_SEARCH.md` | 2026-04-24 dönem şartnamesi |
| `TECHNICAL_SPEC_REMOTE_COMMAND.md` | 2026-04-25; ölü referans (§7 D-04) |
| `TECHNICAL_SPEC_STYLE_ENGINE.md` | 2026-04-24 |
| `TECHNICAL_SPEC_ZERO_FLUFF.md` | 2026-04-24 |
| `APK_CIKTISI.md` | 2026-05-02 tek APK sürümünün bilgileri |
| `NIGHT_ERGONOMICS_REPORT.md` | 2026-07-01 tarihli ölçüm raporu (rapor niteliğinde) |
| `docs/HANDOFF_2026-07-06.md` | Tarihli devir notu — adı zaten arşiv semantiği taşıyor |
| `docs/OBD_PATCH12_PLAN.md` | Patch 12 dönem planı |

### Sınıf E — Gereksiz veya Boş (1)

| Dosya | Gerekçe |
|-------|---------|
| `scratchpad.md` | **0 satır**, tamamen boş, git-ignore'lu |

> ⚠️ Bu listede yalnız **1** dosya var. Denetimde "eski = değersiz" varsayımı kullanılmadı;
> eski belgelerin tamamı benzersiz bilgi taşıyıp taşımadığına göre C veya D'ye yerleştirildi.

### Sınıf F — Doğrulanamadı (13)

| Dosya | Neden doğrulanamadı |
|-------|---------------------|
| `docs/CAROS_15_YIL_VIZYON_YOL_HARITASI.md` | 15 yıllık öngörü — repo kanıtıyla doğrulanamaz/çürütülemez (ürün kararı) |
| `docs/CAROS_PROJE_HAKIMIYET_RAPORU.md` | Rapor mu, canlı belge mi belirsiz; başka belgeyle bağı yok |
| `docs/WEB_URUN_UYUM_BACKLOG.md` | `website/` ayrı Next.js projesi; uyumu bu repo kanıtıyla ölçülemedi |
| `docs/db/CANONICAL_SCHEMA_INVENTORY.md` | Supabase şeması **canlı DB'de** — repo'dan doğrulanamaz |
| `docs/db/CANONICAL_SOURCE_DECISION.md` | Aynı |
| `docs/OTA.md` | OTA sunucu tarafı repo'da yok |
| `docs/VOSK_MODEL_SETUP.md` | Model dosyaları repo'da değil (indirilir) |
| `OFFLINE_TILES_SETUP.md` | Tile üretim zinciri harici araçlara bağlı |
| `SERVICE_WORKER_OFFLINE.md` | Aynı; SW davranışı cihazda ölçülür |
| `src/platform/OFFLINE_MAP_GUIDE.md` | Aynı küme |
| `docs/DEVICE_VALIDATION_PLAN_RENAULT_TRAFIC.md` | Araç gerektirir — tanım gereği repo'dan doğrulanamaz |
| `K24_CAN_OBD_FINDINGS.md` | Saha ölçümü; doğrulaması donanım ister |
| `website/public/icons/README.md` | Vendor sınırında; CAROS mı vendor mı belirsiz |

**Toplam:** A 16 · B 14 · C 13 · D 13 · E 1 · F 13 = **70 sınıflandırılmış**
+ 27 git-ignore yerel çıktı (denetim dışı) = **97**

---

## 7. Kodla Çelişen Belgeler

### D-01 — P0 · README lisans çelişkisi

| Alan | İçerik |
|------|--------|
| **Belge** | `README.md` |
| **Bölüm** | Rozet satırı (3) ve kapanış bölümü (284) |
| **İddia** | `![License: MIT]` · "Distributed under the MIT License." |
| **Gerçek** | Depoda `LICENSE` yok; yalnız `LICENSE-PROPRIETARY.md` var: *"tescilli, kapalı kaynak bir ticari üründür. Açık kaynak bir lisansla dağıtılmamaktadır."* `package.json`'da `license` alanı **hiç yok**. |
| **Kanıt** | `LICENSE-PROPRIETARY.md:1-5` · `README.md:3,284` · `package.json` (license alanı yok) |
| **Önerilen işlem** | README rozetini ve kapanış cümlesini `LICENSE-PROPRIETARY.md` ile hizala. **Hukuki risk taşır — en yüksek öncelik.** |

### D-02 — P1 · İki farklı RELEASE_CHECKLIST

| Alan | İçerik |
|------|--------|
| **Belgeler** | `RELEASE_CHECKLIST.md` (kök, 154 satır, izlenen) ↔ `docs/RELEASE_CHECKLIST.md` (87 satır, **izlenmiyor**) |
| **İddia** | İkisi de yayın kontrol listesi |
| **Gerçek** | İçerikleri farklı; `docs/` sürümü *"hiçbiri yapıldı değildir"* diye başlıyor, kök sürümü klasik checklist. Hangisinin bağlayıcı olduğu belirsiz. |
| **Kanıt** | `diff` → farklı; `git ls-files --others` → `docs/RELEASE_CHECKLIST.md` izlenmiyor |
| **Önerilen işlem** | Tek belge seçilip diğeri birleştirilmeli; yenisi commit edilmeli veya kaldırılmalı. |

### D-03 — P1 · ADR-0001'de üç ölü dosya referansı

| Alan | İçerik |
|------|--------|
| **Belge** | `docs/adr/0001-canonical-speed-source.md` |
| **İddia** | `src/hooks/useSABDirectUpdate.ts` (ve iki elided yol) |
| **Gerçek** | `src/hooks/useSABDirectUpdate.ts` **yok**; benzer adlı dosya da yok |
| **Kanıt** | `find src -iname "useSABDirectUpdate*"` → boş |
| **Önerilen işlem** | ADR **değiştirilmemeli** (karar kaydı tarihseldir); üstüne "bu dosya artık yok, karar şu modüle taşındı" notu düşülmeli. |

### D-04 — P1 · İki şartnamede ölü dosya referansı

| Alan | İçerik |
|------|--------|
| **Belgeler** | `TECHNICAL_SPEC_REMOTE_COMMAND.md` · `HANDOFF.md` |
| **İddia** | `src/hooks/useRemoteCommandService.ts` · `src/platform/voiceContextBuilder.ts` |
| **Gerçek** | İkisi de **yok** |
| **Kanıt** | `find src` → boş |
| **Önerilen işlem** | Şartname arşivlenirken not düşülmeli; HANDOFF güncellenirken referans düzeltilmeli. |

### D-05 — P2 · `npm run postinstall` yok

| Alan | İçerik |
|------|--------|
| **İddia** | Bir veya daha fazla belgede `npm run postinstall` geçiyor |
| **Gerçek** | `package.json` `scripts` içinde `postinstall` **yok** (diğer tüm belgelenmiş script'ler VAR) |
| **Kanıt** | `package.json` script taraması |
| **Önerilen işlem** | Komut referansı düzeltilmeli. |

### D-06 — P2 · `docs/project/SESSION.md` yanlış branch

| Alan | İçerik |
|------|--------|
| **İddia** | Aktif branch `feat/w5-obd-pr1-native-handshake`, aktif görev PR-OBD-PAIR-CONTINUITY |
| **Gerçek** | Aktif branch `feat/caros-lab-phase-a1` |
| **Kanıt** | `git branch --show-current` |
| **Önerilen işlem** | Oturum belgesi ya güncellenmeli ya da "otomatik güncellenmiyor" notu almalı. |

### ⚠️ Çelişki OLMADIĞI doğrulanan iddia (yanlış alarm önleme)

`PROGRESS.md` *"PWA ve Dashboard altyapısı (Next.js 14)"* diyor. Ana uygulama **Vite 8 + React 19**
olduğu için bu ilk bakışta çelişki görünür — **değildir**: `website/package.json` gerçekten
`"name": "caros-pro-website"`, `"next": "^14.2.0"`. İfade **web sitesi/admin** katmanını anlatıyor.
**Bulgu olarak sayılmadı**; yalnız §6-B'de "ürün ayrımı belirsiz" olarak işaretlendi.

---

## 8. Tekrarlanan ve Çakışan Belge Kümeleri

| # | Konu kümesi | Belgeler | Ana belge adayı | Not |
|---|-------------|----------|-----------------|-----|
| K-1 | **Mimari** | `ARCHITECTURE.md` · `ARCHITECTURE_DATAFLOW.md` · `docs/project/ARCHITECTURE.md` · `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` | `docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` | Dördü de farklı soyutlama düzeyinde; **hiçbiri tam kopya değil** |
| K-2 | **Proje durumu** | `PROJECT_STATE.md` · `PROGRESS.md` · `SYSTEM_MAP.md` · `docs/project/PROJECT_STATUS.md` · `docs/CAROS_PROJE_HAKIMIYET_RAPORU.md` | `docs/project/PROJECT_STATUS.md` | Beş belge, beş farklı tarih → tek doğru cevap yok |
| K-3 | **Roadmap** | `ROADMAP.md` · `docs/project/ROADMAP.md` · `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md` · `docs/CAROS_15_YIL_VIZYON_YOL_HARITASI.md` · `TODO_MISSION.md` | `docs/project/ROADMAP.md` | OBD ve 15-yıl belgeleri **ayrı kapsam** — birleştirilmemeli |
| K-4 | **Devir/hafıza** | `HANDOFF.md` · `MEMORY.md` · `docs/HANDOFF_2026-07-06.md` · `docs/project/PROJECT_MEMORY.md` · `docs/project/SESSION.md` | `docs/project/PROJECT_MEMORY.md` | Tarihli handoff'lar arşive |
| K-5 | **Riskler** | `BRUTAL_TRUTHS.md` · `CRITICAL_RISKS.md` | Yeni tek belge | ⚠️ **İçerikleri farklı** (6+6 ayrı risk); birleşim ŞART, silme YASAK |
| K-6 | **Test/doğrulama** | `docs/TEST_MATRIX.md` · `docs/project/TEST_STRATEGY.md` · `e2e/README.md` | `docs/project/TEST_STRATEGY.md` | `e2e/README` kod-yakınlığı için yerinde kalmalı |
| K-7 | **Cihaz doğrulama** | `docs/DEVICE_VALIDATION_LEDGER.md` · `docs/project/DEVICE_VALIDATION.md` · `docs/DEVICE_VALIDATION_PLAN_RENAULT_TRAFIC.md` | `docs/DEVICE_VALIDATION_LEDGER.md` | Kütük zaten mutlak otorite; diğer ikisi ona referans veriyor |
| K-8 | **Performans** | `docs/PERF_AUDIT.md` · `docs/PERF_K24_CHECKLIST.md` · `docs/SOAK_MANUAL_K24_CHECKLIST.md` · `docs/archive/PERFORMANCE_*` | `docs/PERF_AUDIT.md` | Arşivdekiler zaten ayrılmış |
| K-9 | **Saha testleri** | `MAP_FOLLOW_FIELD_TEST.md` · `PARKING_BRAKE_FIELD_TEST.md` · `TTS_FIELD_TEST.md` · `K24_CAN_OBD_FINDINGS.md` | Yeni tek protokol belgesi | Her biri farklı ölçüm — birleşimde **kanıt kaybı olmamalı** |
| K-10 | **Ticari** | `B2B_PITCH.md` · `MARKETING_ONEPAGER.md` · `LICENSE-PROPRIETARY.md` | `LICENSE-PROPRIETARY.md` (hukuki) + tek pitch | |
| K-11 | **Anayasa/kural** | `CLAUDE.md` · `AI.md` · `GEMINI.md` · `CONTRIBUTING.md` · `docs/project/MASTER_PROMPT.md` · `docs/project/AGENT_GUIDE.md` | `CLAUDE.md` (+ `AI.md` üstün) | ⚠️ `MASTER_PROMPT` kendini "TEK GERÇEK KAYNAK" ilan ediyor — bkz. aşağıda |
| K-12 | **Yayın** | `RELEASE_CHECKLIST.md` · `docs/RELEASE_CHECKLIST.md` · `APK_CIKTISI.md` · `docs/OTA.md` | Tek release belgesi | D-02 |
| K-13 | **Offline harita** | `OFFLINE_TILES_SETUP.md` · `SERVICE_WORKER_OFFLINE.md` · `src/platform/OFFLINE_MAP_GUIDE.md` | Tek offline-harita belgesi | Üçü **farklı katman** anlatıyor; dikkatli birleşim |

### "Tek gerçek kaynak" çatışması (detay)

Dört belge kendini tek kaynak ilan ediyor:

| Belge | İfade | Durum |
|-------|-------|-------|
| `docs/CAROS_PRO_VIZYONU.md` | Vizyon/durum tek kalıcı kaynağı (CLAUDE.md onaylı) | ✅ Meşru |
| `docs/OBD_DIAGNOSTIC_OS_ROADMAP.md` | "TEK GERÇEK KAYNAKTIR" | ✅ **Çözülmüş** — vizyon belgesi `Ç-1` kaydında OBD kapsamıyla sınırlandırılmış |
| `docs/project/MASTER_PROMPT.md:3` | "Bu dosya projenin TEK GERÇEK KAYNAĞIDIR" | ⚠️ **Çözülmemiş** — vizyonun Çelişki Kaydı'nda yok |
| `docs/project/DEVICE_VALIDATION.md` | "Kaynak-of-truth: DEVICE_VALIDATION_LEDGER" | ✅ Meşru (başkasına işaret ediyor) |

> `MASTER_PROMPT.md` kendi içinde önceliği `AI.md > CLAUDE.md > GEMINI.md > bu dosya`
> olarak yazıyor — yani ifade **iç tutarsız**: hem "tek gerçek kaynak" hem "dördüncü sırada".

---

## 9. Korunması Gereken Benzersiz Bilgiler

Bu bilgilerin başka kaynağı **yok**; hangi işlem yapılırsa yapılsın kaybedilmemeli.

| Bilgi | Kaynak belge | Neden benzersiz |
|-------|--------------|------------------|
| Renault Trafic / K24 / NWD CAN-OBD saha ölçümleri | `K24_CAN_OBD_FINDINGS.md` | Gerçek donanımdan alınmış ham bulgu; tekrar üretimi araç gerektirir |
| Head unit cihaz uyumluluk matrisi | `docs/HEAD_UNIT_MATRIX.md` | Tek envanter |
| Gece okunabilirlik ölçümleri (4 tema) | `NIGHT_ERGONOMICS_REPORT.md` | Ölçüm verisi; yeniden üretimi cihaz ister |
| El freni / harita takip / TTS saha test protokolleri ve sonuçları | 3 `*_FIELD_TEST.md` | Cihazda alınmış kanıt |
| 4 mimari karar kaydı (ADR) | `docs/adr/000{1..4}` | Karar + gerekçe + tradeoff; **asla silinmemeli** |
| P0 security triage sırası ve gerekçesi | `AUDIT_FINDINGS.md` | Arşivlenmeden önce açık maddeleri çıkarılmalı |
| Üretici PID/DID yasal kaynak haritası | `docs/OBD_DATA_SOURCES_LEGAL.md` | Ticari lisans uyumunun dayanağı |
| Supabase kanonik şema envanteri + kaynak kararı | `docs/db/*` | Canlı DB'nin repo'daki tek kaydı |
| Arşiv geçersiz-kılma tablosu | `docs/archive/README.md` | Hangi eski belgenin neyle değiştiğini gösteren tek harita |
| "Brain & Hands" çalışma metodolojisi | `MEMORY.md` | Başka belgede yok |
| 6 + 6 varoluşsal risk (iki ayrı küme) | `BRUTAL_TRUTHS.md` + `CRITICAL_RISKS.md` | **İçerikler farklı** — birleşimde ikisi de korunmalı |
| Vosk model kurulum adımları | `docs/VOSK_MODEL_SETUP.md` | Model repo'da yok; kurulum bilgisi yalnız burada |
| OTA v1 operasyon prosedürü | `docs/OTA.md` | Sunucu tarafı repo'da yok |

---

## 10. Arşiv Adayları

`docs/archive/` deseni **zaten kurulu ve doğru çalışıyor** (kendi README'sinde geçersiz-kılma
tablosu var). Aşağıdakiler aynı desene taşınmalı — **silinmemeli**:

`ACTIVE_TASK.md` · `TODO_MISSION.md` · `AUDIT_EMPTY_FEATURES.md` · `AUDIT_FINDINGS.md`* ·
`HARDENING_STRATEGY.md` · `TECHNICAL_SPEC_OFFLINE_SEARCH.md` · `TECHNICAL_SPEC_REMOTE_COMMAND.md` ·
`TECHNICAL_SPEC_STYLE_ENGINE.md` · `TECHNICAL_SPEC_ZERO_FLUFF.md` · `APK_CIKTISI.md` ·
`NIGHT_ERGONOMICS_REPORT.md`* · `docs/HANDOFF_2026-07-06.md` · `docs/OBD_PATCH12_PLAN.md`

\* `AUDIT_FINDINGS.md` ve `NIGHT_ERGONOMICS_REPORT.md` arşivlenmeden **önce** §9'daki
benzersiz bilgileri aktif belgelere taşınmalı (aksi hâlde kanıt kaybı olur).

---

## 11. Silme Adayları

| Dosya | Gerekçe | Risk |
|-------|---------|------|
| `scratchpad.md` | 0 satır, tamamen boş, git-ignore'lu | Yok |

**Bu görevde hiçbir dosya silinmedi.** Başka silme adayı bulunamadı: incelenen her belge
ya benzersiz bilgi taşıyor ya birleştirilebilir ya da tarihsel değeri var.

---

## 12. Eksik Ana Dokümanlar

| Eksik belge | Neden gerekli | Hangi mevcut belgelerden beslenir |
|-------------|---------------|------------------------------------|
| **Android geliştirme ve build rehberi** | `android/` altında **hiç `.md` yok**; `phonehub-companion` ve `phonehub-protocol` yeni Gradle modülleri belgesiz | `CLAUDE.md` "Building for Android" · `docs/HEAD_UNIT_MATRIX.md` · `APK_CIKTISI.md` |
| **Teknik borç kaydı (tek yer)** | Borçlar bugün `DEVICE_VALIDATION_LEDGER` satırlarına gömülü; ayrı bir liste yok | Kütük "Açık borç" ifadeleri · `docs/CAROS_PRO_VIZYONU.md` §6.3 |
| **Modül sahipliği / aktiflik durumu** | Hangi modül canlı, hangisi shadow, hangisi ölü kod — dağınık | `docs/project/ARCHITECTURE.md` · `SystemBoot.ts` wiring |
| **Güvenlik modeli (mimari)** | `SECURITY.md` yalnız *bildirim politikası*; tehdit modeli / anahtar yönetimi / RLS mimarisi yok | `AUDIT_FINDINGS.md` P0 triage · `CLAUDE.md` Supabase kuralları · `docs/db/*` |
| **Web (website) geliştirme rehberi** | `website/` ayrı Next.js projesi, kendi belgesi yok | `docs/WEB_URUN_UYUM_BACKLOG.md` · `website/package.json` |
| **Dokümantasyon indeksi (docs/README.md)** | 97 belge var, giriş haritası yok | Bu denetim raporu |

**Mevcut ve yeterli olanlar** (yeni belge gerekmez): ana proje tanımı (`README.md`),
katkı kuralları (`CONTRIBUTING.md`), karar kayıtları (`docs/adr/`), test stratejisi
(`docs/project/TEST_STRATEGY.md`), saha doğrulama protokolü (`docs/DEVICE_VALIDATION_LEDGER.md`),
tarihsel arşiv (`docs/archive/`), ürün vizyonu (`docs/CAROS_PRO_VIZYONU.md`).

---

## 13. Önerilen Hedef Dokümantasyon Mimarisi

```text
README.md                  ← proje tanımı + lisans (DÜZELTİLMİŞ)
CLAUDE.md · AI.md · GEMINI.md   ← ajan anayasaları (yerinde kalır)
CONTRIBUTING.md · SECURITY.md · CODE_OF_CONDUCT.md · LICENSE-PROPRIETARY.md
CHANGELOG.md

docs/
  README.md                ← YENİ: dokümantasyon indeksi
  architecture/            ← mimari (K-1 birleşimi)
  product/                 ← vizyon, roadmap, ticari (K-3, K-10)
  engineering/             ← kurallar, test, feature flag, teknik borç (K-6)
  operations/              ← release, OTA, APK, Android/Web build (K-12)
  validation/              ← kütük, saha testleri, performans (K-7, K-8, K-9)
  decisions/               ← ADR (mevcut docs/adr taşınır)
  archive/                 ← tarihsel raporlar (MEVCUT desen korunur)
  audits/                  ← bu rapor ve gelecek denetimler
```

| Klasör | Amaç | Hedef okuyucu | Buraya taşınabilecekler | Tek doğruluk kaynağı |
|--------|------|---------------|--------------------------|----------------------|
| `architecture/` | Sistem mimarisi, veri akışı, canlı wiring | Geliştirici, ajan | `ARCHITECTURE.md`, `ARCHITECTURE_DATAFLOW.md`, `docs/project/ARCHITECTURE.md`, `CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md`, `COMPANION_AI_ARCHITECTURE.md` | `CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md` |
| `product/` | Vizyon, roadmap, durum, ticari | Ürün sahibi, yönetim | `CAROS_PRO_VIZYONU.md`, `MAVI_NEXT_VISION.md`, `CAROS_15_YIL_*`, roadmap'ler, `B2B_PITCH`, `MARKETING_ONEPAGER`, `FEATURES.md` | `CAROS_PRO_VIZYONU.md` |
| `engineering/` | Çalışma kuralları, test, flag, teknik borç, riskler | Geliştirici, ajan | `docs/project/*` (MASTER_PROMPT hariç), `TEST_MATRIX`, `FEATURE_FLAGS`, `BRUTAL_TRUTHS`+`CRITICAL_RISKS` birleşimi | `docs/project/TEST_STRATEGY.md` |
| `operations/` | Yayın, OTA, build (Android + Web) | Release sorumlusu | `RELEASE_CHECKLIST` (tek), `OTA.md`, `APK_CIKTISI`, **yeni Android/Web rehberleri** | tek `RELEASE_CHECKLIST.md` |
| `validation/` | Saha doğrulama, performans, soak | QA, saha | `DEVICE_VALIDATION_LEDGER` (**otorite**), `*_FIELD_TEST`, `PERF_*`, `SOAK_*`, `HEAD_UNIT_MATRIX`, `K24_CAN_OBD_FINDINGS` | `DEVICE_VALIDATION_LEDGER.md` |
| `decisions/` | ADR — değiştirilmez karar kayıtları | Mimar | `docs/adr/*` | her ADR kendi kararının kaynağı |
| `archive/` | Tarihsel raporlar | Referans | §10 listesi | `archive/README.md` (geçersiz-kılma tablosu) |
| `audits/` | Denetim çıktıları | Denetçi | bu rapor | — |

**Kasıtlı kararlar:**
- `CLAUDE.md`/`AI.md`/`GEMINI.md` **kökte kalır** — ajanlar bu yolları sabit bekliyor.
- `e2e/README.md`, `src/platform/OFFLINE_MAP_GUIDE.md`, `supabase/verification/README.md`
  **yerinde kalır** — kod-yakınlığı değerlidir.
- `docs/project/MASTER_PROMPT.md` taşınmadan **önce** "tek gerçek kaynak" ifadesi çözülmeli.

---

## 14. Önceliklendirilmiş Temizlik Görevleri

> ⚠️ Bu görevler **hiçbir Markdown dosyasına eklenmedi** ve uygulanmadı.

### P0 — Yanlış Yönlendiren Belgeler

| ID | Öncelik | Etkilenen | Önerilen işlem | Bilgi kaybı riski | Bağımlılık | Kabul kriteri |
|----|---------|-----------|----------------|--------------------|------------|----------------|
| **DOC-P0-01** | P0 | `README.md` | MIT rozetini ve "Distributed under the MIT License" cümlesini `LICENSE-PROPRIETARY.md` ile hizala | Yok | Yok | README'de MIT ibaresi kalmaz; lisans beyanı `LICENSE-PROPRIETARY.md` ile birebir tutarlı |

### P1 — Tek Doğruluk Kaynağı Sorunları

| ID | Öncelik | Etkilenen | Önerilen işlem | Bilgi kaybı riski | Bağımlılık | Kabul kriteri |
|----|---------|-----------|----------------|--------------------|------------|----------------|
| **DOC-P1-01** | P1 | `docs/project/MASTER_PROMPT.md` | "TEK GERÇEK KAYNAĞIDIR" ifadesini kapsamla sınırla **veya** vizyonun Çelişki Kaydı'na ekle | Yok | Yok | Belge içi tutarsızlık (hem "tek kaynak" hem "4. sırada") giderilir |
| **DOC-P1-02** | P1 | `RELEASE_CHECKLIST.md` + `docs/RELEASE_CHECKLIST.md` | Tek belgede birleştir; diğerini arşivle | **Orta** — iki farklı içerik | Yok | Tek release checklist; her iki sürümün maddeleri korunur |
| **DOC-P1-03** | P1 | `docs/adr/0001`, `TECHNICAL_SPEC_REMOTE_COMMAND.md`, `HANDOFF.md` | Ölü dosya referanslarına "artık yok / şuraya taşındı" notu ekle (**ADR içeriği değiştirilmez**) | Yok | Yok | 3 ölü referansın hepsi notlanmış |
| **DOC-P1-04** | P1 | K-2 kümesi (5 durum belgesi) | Tek durum belgesi seç, diğerlerine "güncel durum için → X" başlığı ekle | Düşük | DOC-P1-01 | Tek durum kaynağı; diğerleri yönlendirici |

### P2 — Birleştirme ve Yapısal Düzen

| ID | Öncelik | Etkilenen | Önerilen işlem | Bilgi kaybı riski | Bağımlılık | Kabul kriteri |
|----|---------|-----------|----------------|--------------------|------------|----------------|
| **DOC-P2-01** | P2 | K-1 (4 mimari belgesi) | `architecture/` altında birleştir | **Yüksek** — 4 farklı soyutlama düzeyi | DOC-P1-04 | Hiçbir mimari bölüm kaybolmaz |
| **DOC-P2-02** | P2 | K-5 (`BRUTAL_TRUTHS` + `CRITICAL_RISKS`) | Tek riskler belgesi — **12 riskin tamamı** korunur | **Yüksek** — içerikler farklı | Yok | 6+6 = 12 risk maddesinin tamamı yeni belgede |
| **DOC-P2-03** | P2 | K-9 (3 saha testi + K24 bulguları) | `validation/` altında tek protokol belgesi | **Yüksek** — ölçüm verisi | Yok | Her ölçüm sonucu korunur |
| **DOC-P2-04** | P2 | K-8 (3 performans belgesi) | `validation/` altında birleştir | Orta | Yok | Baseline + checklist + soak prosedürü korunur |
| **DOC-P2-05** | P2 | K-13 (3 offline harita belgesi) | Tek belge; `src/platform/OFFLINE_MAP_GUIDE.md` yerinde kalır | Orta | Yok | Üç katmanın tamamı anlatılır |
| **DOC-P2-06** | P2 | `PROGRESS.md` | Website ve head unit fazlarını ayır | Yok | Yok | Okuyucu hangi ürün olduğunu ayırt eder |
| **DOC-P2-07** | P2 | `npm run postinstall` referansı | Düzelt | Yok | Yok | Tüm belgelenmiş script'ler `package.json`'da var |

### P3 — Arşivleme

| ID | Öncelik | Etkilenen | Önerilen işlem | Bilgi kaybı riski | Bağımlılık | Kabul kriteri |
|----|---------|-----------|----------------|--------------------|------------|----------------|
| **DOC-P3-01** | P3 | `AUDIT_FINDINGS.md` | Açık P0 security maddelerini aktif belgeye taşı, sonra arşivle | **Yüksek** | Yok | Hiçbir açık güvenlik maddesi arşivde kalmaz |
| **DOC-P3-02** | P3 | §10'daki 12 belge | `docs/archive/` desenine taşı + README tablosuna satır ekle | Düşük | DOC-P3-01 | `archive/README.md` her yeni dosya için geçersiz-kılma satırı içerir |
| **DOC-P3-03** | P3 | `docs/project/SESSION.md` | Güncelle **veya** "otomatik güncellenmiyor" uyarısı ekle | Yok | Yok | Yanlış branch bilgisi kalmaz |

### P4 — Temizlik

| ID | Öncelik | Etkilenen | Önerilen işlem | Bilgi kaybı riski | Bağımlılık | Kabul kriteri |
|----|---------|-----------|----------------|--------------------|------------|----------------|
| **DOC-P4-01** | P4 | `scratchpad.md` | Sil (0 satır, git-ignore'lu) | Yok | Yok | Dosya yok |
| **DOC-P4-02** | P4 | `docs/README.md` | Dokümantasyon indeksi oluştur | Yok | DOC-P2-* | 97 belgenin tamamı indekste |

---

## 15. Belirsiz ve İnsan Kararı Gerektiren Maddeler

| # | Konu | Neden otomatik karar verilemez |
|---|------|---------------------------------|
| 1 | `docs/project/` setinin (9 belge) geleceği | Tek seferde üretilmiş, bakımı sürmüyor. **Yeniden canlandırılacak mı yoksa arşivlenecek mi** — bir süreç kararıdır, doküman kararı değil |
| 2 | `PROJECT_STATE.md` (1 460 satır) | Çok fazla benzersiz detay var; bölünmeli mi, arşivlenmeli mi, güncellenmeli mi — sahibi karar vermeli |
| 3 | `docs/RELEASE_CHECKLIST.md` commit edilecek mi | İzlenmiyor; bilinçli mi geçici mi belirsiz |
| 4 | `docs-local/` (16 belge) | Git-ignore'lu ama gerçek cihaz kanıtı içeriyor. **Kalıcı arşive alınmalı mı** — veri saklama kararı |
| 5 | `docs/CAROS_15_YIL_VIZYON_YOL_HARITASI.md` | 15 yıllık öngörü; teknik denetimle değerlendirilemez |
| 6 | `website/` için ayrı repo mu, ayrı docs mu | Depo topolojisi kararı |
| 7 | Türkçe/İngilizce dil karışıklığı | `README.md` İngilizce, geri kalan Türkçe. Hedef kitle kararı (B2B/uluslararası?) |
| 8 | `MEMORY.md` "Brain & Hands" metodolojisi hâlâ geçerli mi | Çalışma yöntemi değişmiş olabilir — kullanıcı bilir |

---

## 16. Sonraki Atomik Uygulama Önerisi

**Yalnız bir görev öneriliyor:**

> ### DOC-P0-01 — `README.md` lisans beyanını düzelt
>
> **Kapsam:** Tek dosya, iki satır.
> **Neden ilk:** Tek **hukuki risk** taşıyan bulgu. Depo tescilli/kapalı kaynak ilan
> edilmişken README projeyi MIT lisanslı gösteriyor; bu, üçüncü tarafın kodu serbestçe
> kullanabileceği izlenimi yaratır.
> **Neden yalnız bu:** Diğer tüm P1/P2 görevleri birleştirme/taşıma gerektiriyor ve
> §15'teki insan kararları çözülmeden yapılmamalı. Bu görev hiçbir karara bağlı değil.
> **Kabul kriteri:** `README.md` içinde MIT ibaresi kalmaz; lisans beyanı
> `LICENSE-PROPRIETARY.md` ile birebir tutarlıdır; başka hiçbir dosya değişmez.

---

## Denetim Doğrulaması

| Kontrol | Sonuç |
|---------|-------|
| `.md` sayım (denetim anı) | 2 750 toplam · 124 CAROS PRO alanı · 97 denetime giren |
| `.md` yeniden sayım (rapor yazıldıktan sonra) | 2 751 · 125 — **fark bu raporun kendisidir** |
| Envanterde eksik CAROS PRO belgesi | Yok — §5.1–5.7 toplamı 70 + §5.8'de 27 = 97 |
| Çift listeleme | Yok — her dosya tek bölümde |
| Bu görevde oluşturulan dosya | `docs/audits/MARKDOWN_DOCUMENTATION_AUDIT.md` (tek) |
| Bu görevde değiştirilen mevcut belge/kod | **Yok** |
| Commit | **Atılmadı** |

### ⚠️ Çalışma ağacı hakkında dürüst beyan

`git status --short` çıktısında çok sayıda değişiklik görünüyor. **Bunların hiçbiri bu
denetim görevine ait değildir** — hepsi bu oturumdaki önceki geliştirme turlarından
(CAROS LAB, Mavi, Phone Hub, VCOMP-01/02/03) ve oturum öncesinden kalma değişikliklerdir.

`git diff --stat -- '*.md'` üç Markdown dosyasında değişiklik gösteriyor
(`CLAUDE.md`, `docs/CAROS_PRO_VIZYONU.md`, `docs/DEVICE_VALIDATION_LEDGER.md`) —
bunlar da **önceki turların** kütük/vizyon güncellemeleridir, bu denetimin çıktısı değildir.
Bu görevde tek yeni dosya `docs/audits/` altındadır.
