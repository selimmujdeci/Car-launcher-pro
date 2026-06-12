# HANDOFF — CarOS Pro Devir Notları

> Yeni ajan/oturum buradan başlasın. Projeyi kaldığı yerden devralma rehberi.
> Son güncelleme: 2026-06-12. Branch: `main`. HEAD: `4ab262b`.

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

- **Telefon dock kompaktlaştırma (2026-06-12, `4ab262b`):** telefonda (w<600px)
  alt dock fazla yer kaplıyordu. `theme-layouts.css` `@media (max-width:600px)`
  bloğuna `--dock-h:64px !important` + `--dock-icon:24px` (portrait 70px'i ezer).
  Head unit ≥800px etkilenmez; dokunma hedefi 44px korundu. Task premisleri
  düzeltildi (gerçek değişken adları --dock-h/--dock-icon; 1.5rem padding yok;
  80px = HD head unit breakpoint, tema override değil). Detay: PROJECT_STATE
  "Telefon Dock". **Cihazda screenshot ile doğrulanacak.**
- **OBD persistence chain polish (2026-06-12, `b51e75a`):** WebView crash/boot
  sonrası snapshot'tan hydrate edilen OBD verisi UI'da görünmüyordu —
  `_buildPatch` `source` taşımıyordu → `_current.source` 'none' kalıp gösterge
  boşta takılıyordu. (1) `_buildPatch` geçerli alan kurtarınca `source: 'real'`
  ekler (tüm alanlar bayatsa BOŞ kalır). (2) init source otomatik 'real'. (3)
  async hydration guard'ı `_lastRealDataMs` (canlı veri) ile ayrıldı + computed
  yakıt alanları (`fuelRemainingL`/`estimatedRangeKm`) `computeFuelMetrics` ile
  recompute (sync yol setObdFuelConfig ile zaten çalışıyordu). +5 test →
  1229/1229. Detay: PROJECT_STATE "OBD Persistence Chain". **Cihazda doğrulanacak.**
- **Phase P — Deep Intelligence Co-Pilot (2026-06-12, `5abcd32`):** asistan
  "komut dağıtıcı"dan bağlam-farkında yardımcı pilota. (Madde 1 wake + madde 3
  SystemBoot `0348b9b`'de, 2.5s fallback `734d825`'te zaten tamamdı — redo yok.)
  Yeni: beyin prompt'u Contextual AI Partner çerçevesi (KOMUT ROBOTU DEĞİL /
  World View / YARDIMCI PİLOT; Single Brain kararı korundu) · World View
  enjeksiyonu yakıt+sıcaklık YANINDA **yolculuk süresi** (interpretTripDuration)
  · genel kelime ASR/niyet talimatı ("birez muzuk ac"→"biraz müzik aç") · park
  halinde derin/sürüşte kısa ton. `tripLogService.getTripSnapshot()` eklendi
  (onTripState immediate-emit canlı trip vermiyordu). +2 test → 1224/1224.
  Detay: PROJECT_STATE "Phase P". **Cihazda doğrulanacak.**
- **Wake word entegrasyonu (2026-06-12, `0348b9b`):** "asistan uyanmıyor" iki
  kök neden. (1) Wake yalnız `useLayoutServices` React hook'undaydı (mount'a
  bağlı, churn'lü) → YENİ `startWakeWordService()` modül-düzeyi `useStore`
  aboneliği, SystemBoot `_wave4` + cleanup; eski hook KALDIRILDI (çift
  orkestratör = çift dinleme oturumu riski). (2) Grammar/polling Vosk modeli
  preload (boot+30s, 20-40s yüklenir) bitmeden başlayıp "model yok" hard-fail
  ediyordu → `notifyVoskModelReady()` kapısı: native start model hazır olana
  dek ertelenir; SystemBoot preload çözülünce (eski APK'da hemen) açılır,
  backstop 75s. Silent Handover + zero-leak korundu. +9 test → 1222/1222,
  tsc+lint+build temiz. Detay: PROJECT_STATE "Wake Word Entegrasyonu".
  **Cihazda doğrulanacak.**
- **Single Brain mimarisi tamamlandı (2026-06-12, `734d825`):** sesli asistan
  "Gemini-first tek beyin". voiceService refactor'u (kritik bypass →
  Gemini-first → graceful fallback) zaten yazılmıştı; eksikler tamamlandı:
  (1) `timeoutMs` ÖLÜ parametreydi — voiceService 2.5sn karar bütçesi
  gönderiyordu ama `CompanionChatOpts`'ta alan yoktu, `askCompanionBrain` 6sn
  sabit timeout kullanıyordu → "2.5sn'de timeout→fallback" fiilen çalışmıyordu;
  `timeoutMs?` eklendi + fetch signal'ına clamp'li bağlandı. (2) BRAIN_SYSTEM_
  PROMPT "TEK BEYİN + AKSİYON mu CHAT mi" açık vurgusu (No Dual Response).
  (3) `CRITICAL_VOICE_TYPES`=volume_up/down+stop_music yalnız 1.0'da yerelde,
  gerisi beyne. (4) `companionConversationLoop` testleri eski "yerel dispatch"
  mimarisinden Single Brain ACTION'a güncellendi (+`pause_music`→`stop_music`).
  No-Dead-Ends reask'a dokunulmadı (test-kilitli). Suite 1213/1213, tsc+build
  temiz. Detay: PROJECT_STATE "Single Brain". **Cihazda doğrulanacak.**
- **Navigasyon saha fix paketi (2026-06-12, `0fcac44`):** sürüş testi raporu
  üzerine — rota ilerlemesi mapStyleReady kapısından çıktı (donma kökü),
  kat edilen rota kırpma + kademeli sesli yönlendirme (500m/200m/şimdi)
  EKLENDİ, nav kamera watchdog'u, rAF bayat route closure fix (turnDist),
  hız levhası veri yoksa çizilmez. Suite 1213/1213. **Cihazda doğrulanacak.**
- **Head Unit "Latency Death" fix paketi (2026-06-12, `5687d9a`+`0cfd729`):**
  kullanıcının "her butona basınca 5 sn" şikayetine kök neden paketi.
  (1) thermalWatchdog motor suyu sıcaklığını cihaz ısısı sanıp KALICI L2/L3
  termal kısıt uyguluyordu → engineTemp zincirden çıktı. (2) Açılışta adres
  yokken otomatik BT INQUIRY kaldırıldı (ilk bağlantı modal'dan). (3) lite
  obdListenerDebounce 10s→1.5s, zombie PING 10s→30s, Vosk preload 8s→30s.
  (4) Kalıcı wake Vosk thread'leri THREAD_PRIORITY_BACKGROUND (UI ile
  yarışmaz). Suite 1213/1213 + Java compile temiz. **Cihazda doğrulanmadı —
  cihazdaki APK'da fix'ler YOK, yeni APK kullanıcı isteyince.**
- **Companion Faz 5 Native Refleksler / Grammar Wake (2026-06-11,
  `7c674dc`):** wake word native kalıcı grammar thread'ine
  taşındı (Vosk yalnız wake sözleri + [unk]; runVoskListening'e dokunulmadı).
  Partial sonuçla <200ms refleks (`wakeWord` event), pasif modda duck/audio-
  focus YOK (müzik tam kalite), half-duplex (TTS/aktif STT'de mikrofon
  bırakılır — kendini duymaz). wakeWordService: grammar→eski döngü fail-soft.
  +7 test → 1213/1213; Java compile OK. Detay: PROJECT_STATE "Faz 5".
  **Cihazda doğrulanmadı.**
- **Companion Faz 4 Proaktif Motor + Uyku Önleyici (2026-06-11, `2939055`):** YENİ `companionEngine.ts` (60 sn PromptScheduler) +
  SystemBoot Wave 4 named cleanup. Tetikler: yakıt <50 km (güvenlik, medyada
  bile) · gece+sessizlik uyku sorusu (açık uçlu) · boot selamlaması (1 kez) ·
  mola · 'sik' yolculuk yorumu. Gate: PROTECTION+/sesli oturum/voicePaused/
  sessiz kişilik → sus. Bütçe az=45dk/normal=20dk/sık=10dk. Proaktif konuşma
  Gemini'ye gitmez (şablon+yorumlayıcı). +21 test → 1206/1206. Detay:
  PROJECT_STATE "Faz 4". **Cihazda doğrulanmadı.**
- **Companion Faz 3 Şive Dostu Birleşik Beyin (2026-06-11, `33b61ec`):** kişilik beynin tepesinde (profesyonel=MAKAM ASİSTANI,
  samimi=MAHALLE ARKADAŞI); şive talimatı (birez/kurban/uşağum = karakter
  ipucu, niyet cımbızla çekilir); No Dead-Ends iki katman (prompt "ASLA
  ÇIKMAZ YOK" + kod backstop: online çöküş + offline eşleşme yok →
  kişiliğe uygun tekrar-rica; offline'da null korunur, eski zincir bozulmaz).
  Test +5 → 1185/1185, tsc temiz. Detay: PROJECT_STATE "Faz 3".
- **Companion Faz 2 Bağlamsal Zeka (2026-06-11, `a0a749d`):** `companionContext.ts` yorumlayıcıları proaktifleşti — yakıt
  menzili <100 km'de rota teklifi, gece+2saat yorgunlukta somut eylem
  teklifleri (cam/kahve/dinlenme yeri), soğuk motorda samimi uyarı.
  `companionChatProvider.ts`: bağlam "SÜRÜCÜNÜN MEVCUT DURUMU" başlığıyla
  + kritik durumda kendiliğinden dile getirme talimatıyla enjekte edilir.
  Hitap (kanka vb.) yorumlayıcılara gömülmedi — persona katmanının işi.
  Companion testleri 92/92, tsc temiz. Detay: PROJECT_STATE "Faz 2".
- **Wake uyanmama + müzik isteği saha fix (2026-06-11, `45facfa`):** Vosk
  "hey" tanımıyor → ey/hay/hei varyantları; sessizlikte 3sn sağır boşluk →
  250ms; paralel döngü bug'ı → jenerasyon token; pasif dinleme müzik duck'ı
  kapatıldı (native `duckWhileListening` opsiyonu); çekimli müzik fiilleri
  ("açar mısın/açsana/koy") + fiilsiz istekler ("X'ten müzik") artık
  play_music_query; companion müzik kapısı (sohbet biyografi anlatamaz);
  gain 2.5→3.0, wake 3.2/20s; lastHeard teşhisi. Detay: PROJECT_STATE
  "Wake Uyanmama + Müzik İsteği". **Cihazda doğrulanmadı.**
- **Asistan adı merkezli wake word (2026-06-11, `eb8ad25`):** kullanıcı
  asistana hangi adı verirse o adla uyanır (ad=Mavi → "Mavi"/"Hey Mavi");
  uyanma şekli seçici (name/hey_name/both/custom); ÜRÜN KARARI: varsayılan
  ad 'Mavi' (persist v15 migration); tetiklenince kısa selamlama → TTS
  bitince aktif dinleme; PROTECTION/CRITICAL'da tetik yutulur; pasif
  beklemede "Dinliyorum" UI yok; companion wake artık useLayoutServices'e
  WIRE EDİLDİ (eskiden ayar vardı, motor bağlı değildi). Detay:
  PROJECT_STATE "Asistan Adı Merkezli Wake Word". **Cihazda doğrulanmadı.**
- **Companion sürekli sohbet döngüsü (2026-06-11, `cffe182`):** P0 saha UX —
  cevap sonrası mikrofona tekrar basma zorunluluğu kalktı. Akış: dinle →
  transcript → (Gemini >800ms ise "düşünüyorum") → cevap TTS → TTS bitince
  KISA pencereyle (8s, `followUpListenMs`) otomatik yeniden dinleme.
  Döngü YALNIZ companion sohbet modunda; araç komutları döngü kurmaz;
  "tamam/sus/kapat/sonra konuşuruz" sessizce kapatır; PROTECTION/CRITICAL
  kapatır; sessizlikte idle (tekrar konuşma yok). Prompt doğallaştı
  ("8 kelime" kuralı kalktı; sürüşte 2-3 kısa cümle; token 100/160).
  15 yeni test (`companionConversationLoop.test.ts`). **Cihazda doğrulanmadı.**
- **Telemetri görünürlük (2026-06-11, `60d92e4`):** admin incidents boştu —
  eşlenmemiş cihazda pushVehicleEvent her event'i sessiz yutuyordu. Artık
  throttle'lı warn + sayaç + `not_paired` snapshot sonucu + UI yönlendirmesi.
  Kök neden: cihaz eşleme YALNIZ Ayarlar → Mobil Bağlantı'dan; **sahada önce
  eşleme yapılmalı**, sonra incidents akışı doğrulanmalı.
- **DTC tarama düzeltmesi (2026-06-11, `209046f`):** Arıza Teşhisi "OBD okuyucu
  yanıt vermiyor" — native `readDTC/clearDTC` hiç yoktu, her tarama reject'ti.
  ElmProtocol Mode 03/04 + elmLock (polling ile serileşme) + plugin metotları.
  Detay: PROJECT_STATE "DTC Tarama". **Cihazda doğrulanmadı.**
- **Companion AI-FIRST Commit 3 (2026-06-11, `03b7e83`):** kullanıcı onaylı yön
  değişikliği — keyword sohbet ana yol değil. Companion açıkken komut olmayan
  her cümle önce Gemini'ye (kişilikli sohbet prompt'u); offline'a yalnız net/key
  yok + hata/timeout + 429 (soğuma) durumlarında düşülür. Router voiceService'te
  (parser ≥0.7 → komut yolu aynen; companion kapalı → eski zincir bit değişmeden).
  Ham OBD prompt'a girmez — Commit 2 yorumlayıcıları girer (yapısal test).
  `voice_route` tanı aşaması eklendi. Detay: PROJECT_STATE "Companion AI" +
  doküman §9 revizyonu. **Cihazda doğrulanmadı.**
- **Parser hassasiyet düzeltmesi (2026-06-11, `d55f8e2`):** "nasılsın" →
  "Araç verisi alınamıyor" saha hatası. `commandParser.scorePattern` 5 ayrı
  gevşeklik tek seferde kapatıldı (kısa kalıp tam-kelime, ters yön startsWith/
  çok-kelimeli, Tier-2 prefix, fuzzy min 4, soru edatları filler). Detay:
  PROJECT_STATE "Parser Hassasiyet". 9 regresyon testi. **Cihazda doğrulanmadı.**

- **Companion AI "Yol Arkadaşım" V1 başladı (2026-06-11, `8cceab8`+`0c478e0`+
  `c07ac1a`):** mimari doküman (`docs/COMPANION_AI_ARCHITECTURE.md` — 7
  commit'lik plan) + Commit 1: ayar/kimlik modeli (`companionIdentity.ts`
  sanitize+fallback, useStore v14, Settings paneli, 40 test) + Commit 2:
  `companionContext.ts` saf yorumlayıcılar (yakıt/menzil/mola/yorgunluk/
  varış/sıcaklık; servis import'u SIFIR, imkânsız veri→null fail-soft,
  55 test). **Kurallar:** ayarlar yalnız `resolveCompanionIdentity`
  üzerinden okunur; Gemini prompt'una ham veri değil yorum girer.
  **Sırada:** Commit 3 — companionPersona (4 kişilik + şablonlar +
  tekrar-önleme).
- **Duster saha düzeltmeleri (2026-06-11, `901edf5`+`67d0a71`+`e191bb1`):** gerçek
  araç (Renault Duster, eski WebView Chrome 64-78) üç saha hatası:
  1. **Dashboard çöküşü + görünmeyen dock** — inline modern CSS (clamp/min/
     aspect-ratio/inset/dvh) eski WebView'de düşüyor → grid tek kolona çöküyor,
     kök 100dvh'siz auto yüksekliğe iniyordu. Çözüm: `src/utils/cssCompat.ts`
     (CSS.supports tespiti) + Expedition/Horizon fallback şablonları + harita
     minHeight:200 + MainLayout VIEWPORT_H. Snapshot'a `device` bloğu eklendi
     (webViewVersion vb. saha teşhisi). Gün/gece: boot'ta ilk 2 dk 5 sn'lik
     hızlı saat kontrolü (geç RTC senkronu).
  2. **YouTube araması boş** — Piped instance'larının 4/5'i öldü; Invidious
     yedek havuzu eklendi (arama + ses akışı), kapaklar i.ytimg.com'dan.
  3. **Mikrofon "Dinliyorum"da takılı** — ilk basışta Vosk unpack+load 20-40 sn
     (JS failsafe 14 sn'de pes ediyordu). Çözüm: boot+8sn'de `preloadVoskModel`
     (SystemBoot Wave 4) + native istek kuyruğu (reddetme yok). **Cihazda
     doğrulandı: mikrofon çalışıyor (kullanıcı teyidi).**
- **OTA v1 TAMAM (2026-06-10, 7 commit `3f9b456`…`fb4b51d`):** sürüm gerçeği →
  Supabase şema → publish script → native indirme/doğrulama → install gate →
  orkestrasyon servisi (SystemBoot Wave 4 + Settings kartı) → telemetri.
  Detay: PROJECT_STATE "OTA v1" bölümü + `docs/OTA.md`. **Saha/deploy bekliyor:**
  `supabase db push` + gerçek publish + K24 uçtan uca (CHECKLIST §4c).
- **Güvenlik P0 (2026-06-10, `7075813`):** cross-channel nonce replay kapandı
  (JS↔Native tek store, `checkCommandNonce` köprüsü) + push-notify fonksiyon-içi
  auth (service_role, fail-closed). Cihaz/deploy doğrulaması CHECKLIST §4b.

- **Test Altyapısı T1–T4 (2026-06-09, HEAD `b453cf9`):** araçsız/donanımsız deterministik
  test serisi. Hepsi YALNIZ `src/__tests__/` altında — production/native hot-path'e
  DOKUNULMADI, bundle'a sızmıyor (tree-shake teyitli). Suite: **635/635** (50 dosya;
  önceki 482).
  - **T1** OBD simülatörü (`sim/obdSimulator.ts`) `206b41a` · **T2** CAN frame senaryoları
    `52a04c4` · **T3** kaynak-sızıntı leak harness + cleanup testleri (`sim/leakHarness.ts`,
    `cleanup.*.test.ts`) `ca8024f`/`9a41c73` · **T7** low-end/runtime simülatörü
    (`sim/runtimeSimulator.ts`) `978aa2a`.
  - **T4 Soak (sanal-saat, 8–24h) — 8 commit:** `sim/soakHarness.ts` (fake timer+Date+
    performance, gerçek sleep YOK) `473893a`; safeStorage write-throttle `79d8b11`; OBD
    reconnect/backoff (real `obdRetryPolicy` modeli) `ac0295e`; runtime zombie/thermal
    (real `AdaptiveRuntimeManager`) `a6646e1`; telemetry+connectivity (real + in-memory
    IDB shim) `55ab621`; remoteCommand ACK-timeout/eviction (real `_awaitHardwareAck`)
    `57da3a9`; cross-service 24h aggregate leak `6b75e7f`; **manuel K24 saha prosedürü**
    `docs/SOAK_MANUAL_K24_CHECKLIST.md` (`e98bd23`, PSS sampler fix `b453cf9`).
  - Sanal testler MANTIK/sözleşmeyi kapsar; gerçek RAM-PSS/A2DP/eMMC-aşınma/SoC-ısı/
    saat-sıçraması **manuel checklist'e** ayrıldı (CHECKLIST §0 ayrım tablosu). ACTIVE_TASK
    P1 soak/eMMC/backoff maddeleri büyük ölçüde bu seriyle karşılandı.
- **Faz 1 GPU yükü azaltma** (commit 2fbbd57): blur guard + ambient blob koşullu
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

- **Branch belirsizliği ÇÖZÜLDÜ (2026-06-10):** CLAUDE.md `main` olarak düzeltildi
  (remote HEAD origin/main); merge hedefi `main`. Release disiplini kuruldu:
  `version.properties` tek kaynak + `release:bump`/`release:apk`/`release:aab`
  script'leri + CHANGELOG.md (detay: PROJECT_STATE.md "Release Disiplini").
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
