# CAROS PRO — SIFIRDAN PROJE DEVİR RAPORU

> **Tarih:** 2026-08-08 · **Branch:** `feat/fleet-offline-final-local-completion`
> **HEAD:** `adca8c3` · **Toplam commit:** 1041 (ilk commit 2026-03-23)
> **Ölçülen durum:** `npx vitest run --testTimeout=30000` → **498 dosya / 11 279 test YEŞİL**;
> `npx tsc -b` → **temiz (exit 0)**. Çalışma ağacında commit edilmemiş 12 dosya var.
>
> Bu belge projeyi hiç bilmeyen birine anlatmak için yazıldı. Otorite sırası değişmedi:
> `CLAUDE.md` + `AI.md` (anayasa) → `docs/DEVICE_VALIDATION_LEDGER.md` (saha gerçeği) →
> `docs/CAROS_PRO_VIZYONU.md` (vizyon/durum). Çelişkide bu rapor DEĞİL, onlar kazanır.

---

## 1. PROJE NEDİR

### Tek cümlede
CAROS PRO (paket adı `com.cockpitos.pro`, npm adı `cockpitos`, sürüm 1.0.2), **aftermarket
Android head unit'ler için yazılmış bir "Vehicle Intelligence OS"** — yani bir uygulama
başlatıcı değil, aracın ikinci beyni olmayı hedefleyen bir araç işletim katmanı.

### Hangi problemi çözüyor
Tesla gibi OEM sistemler **yalnızca kendi araçlarını** tanır: veri şeması garantilidir,
sensör güvenilirdir. CAROS PRO ise **yüzlerce bilinmeyen marka/modeli**, ucuz ELM327
dongle'lardan gelen **güvenilmez** telemetriyle tanımak zorunda. Bu yüzden projenin
çekirdek felsefesi *zero-trust telemetry*: hiçbir sinyal doğrulanmadan kabul edilmez,
her değer bir güven skoru taşır, kanıt yoksa "temiz" denmez (fail-closed).

Anayasadaki "8 Kapı" sözleşmesi bunu somutlaştırır: bir PID okumak başarı değildir;
o sinyalin (1) doğru mu, (2) önemli mi, (3) kullanıcı bilmeli mi, (4) sadece sistem mi
bilmeli, (5) neyle birleşince anlam kazanır, (6) 5 dk sonra ne olacak, (7) yerine ne
karar alınabilir, (8) en doğru aksiyon ne — sorularından geçmesi gerekir.

### Kimin için
**Bugün:** son kullanıcı ürünü **değil**. Aktif politika `Faz A — Developer First`:
öncelik sırası *mimari → doğruluk → güvenlik → gözlemlenebilirlik → geliştirici araçları
→ performans → son kullanıcı deneyimi*. UX bilinçli olarak şu an öncelik değil.
Kullanıcı kitlesi: geliştiricinin kendisi + aile içi saha testleri. Play Store / genel
dağıtım **yok**.

**Hedef:** 3. taraf head unit üreticilerine gömülü olarak satılan ticari ürün (B2B).
Bu yüzden lisans disiplini serttir (bkz. §7).

### Sistem üç ayaklı
| Ayak | Ne | Nerede |
|---|---|---|
| Araç içi uygulama | React + Capacitor Android head unit yazılımı | `src/`, `android/` |
| Telefon/web ucu | "Arabam Cebimde" PWA (uzaktan kumanda) + Filo yönetim paneli | `website/` (Next.js 14) |
| Bulut | Supabase — kimlik, filo, araç olayları, kanıt/karar motorları | `supabase/` (63 migration) |

### Bir kullanıcı bugün açsa ne görür
- **4 tema yerleşimi** (Tesla · Pro · Horizon · Expedition), her biri gündüz/gece varyantlı;
  tema motoru `data-theme` ile OEM token'ları sürer.
- Alt **dock** ve çekmeceler: Harita/Navigasyon · Müzik · Telefon · Uygulamalar · Ayarlar ·
  Arıza kodları (DTC) · Canlı sensörler · Trafik · Hava · Klima · Dashcam · Yolculuk defteri ·
  Spor modu · Güvenlik · Eğlence · Bakım hatırlatma.
- **Navigasyon:** MapLibre offline-first harita, tam ekran turn-by-turn HUD, sesli yönlendirme,
  hız limiti levhası, tehlike uyarıları, trafiğe göre renklenen rota, gece/tünel örtüsü.
- **Araç verisi:** OBD-II (Bluetooth Classic + BLE) veya CAN üzerinden hız/devir/soğutma
  suyu/yakıt/voltaj; DTC okuma; çoklu-ECU keşfi.
- **Mavi** — Türkçe sesli asistan (wake word + STT + TTS + LLM; BYOK anahtarla).
- **Ters vites kamerası**, radar HUD, güvenlik uyarı katmanı.
- Geliştirici bayrağı açıksa **CAROS LAB**: 48 kayıtlı ekranın 37'si canlı (`AVAILABLE`),
  7'si placeholder, 2'si kapalı — salt-okunur tanılama laboratuvarı.

### En önemli tek gerçek
Vizyon belgesinin kendi sayımına göre **59 denetlenen özellikten "ÜRÜN HAZIR = EVET"
alan sadece 1 tane var** (Self Diagnostic / "Tanı Gönder"). Dağılım:
YOK 14 · İSKELET 24 · ENTEGRE 14 · DOĞRULANDI 6 · SAHADA DOĞRULANDI 1.

Saha doğrulama kütüğünde **384 satır 🔴 (cihazda test edilmedi)** · 31 🟡 (kısmi) ·
**21 🟢 (doğrulandı)** · 4 ❌ (denendi, düştü). Bu oran projenin en dürüst özetidir:
**kod ve test çok ilerde, gerçek araç kanıtı çok geride.**

---

## 2. TEKNİK YAPI

### Diller ve çerçeveler
| Katman | Teknoloji |
|---|---|
| Araç UI | React 19.2, TypeScript 5.9 (strict), Vite 8 |
| Stil | Tailwind CSS 4 (utility-only; ham CSS/CSS-in-JS yasak) |
| Durum | Zustand 5 |
| Harita | MapLibre GL 4 (offline-first) |
| Mobil | Capacitor 8 (Android) |
| Yerel depo | sql.js (SQLite WASM), `safeStorage` sarmalayıcı |
| 3B | three.js 0.185 |
| i18n | i18next + react-i18next |
| Web/PWA | **Next.js 14 App Router, React 18**, Supabase SSR, Zustand 4, MapLibre 5 |
| Native | Java + Kotlin (67 dosya, ~27 000 satır) |
| Bulut | Supabase (PostgREST + RLS + pg_cron + Edge Functions) |
| Test | Vitest 4 (birim/entegrasyon), Playwright (E2E) |

> ⚠️ Araç uygulaması React 19 / Zustand 5 / Tailwind 4 iken website React 18 / Zustand 4 /
> Tailwind 3. **İki ayrı npm projesi**, bilinçli ayrım ama sürüm ayrışması bir borçtur.

### Ölçek
- `src/`: **1 566 dosya · ~426 600 satır**
- Testler: `src/__tests__/` altında **502 test dosyası · 11 279 test**
- `website/src/`: ~47 900 satır
- `android/app/src/main/java`: ~27 000 satır
- `supabase/migrations/`: 63 migration
- Kök dizinde 44 Markdown, `docs/` altında ~90 Markdown daha

### Klasör yapısı ve görevleri
```
src/
├── platform/        (762 dosya) Tüm iş mantığı ve native köprüler. Projenin kalbi.
│   ├── bridge.ts            Platform soyutlaması: demoBridge (web) / nativeBridge (Android)
│   ├── obd*.ts, obd/        OBD-II yığını: servis, parser, keşif, sanitizasyon, mock
│   ├── canBus/              CAN veri yolu
│   ├── vehicleHal/          Vehicle HAL — kaynak sağlığı, fail-closed kaynak sözleşmesi
│   ├── vehicleDataLayer/    VehicleCompute worker + sinyal çözücü (canonical araç verisi)
│   ├── navigation/          Rota oturumu, kamera otoritesi, sesli yönlendirme, hız limiti
│   ├── map/                 MapCore, MapLayerManager, tünel gece modu, rota gradyanı
│   ├── maviCore/            Mavi (sesli AI) — niyet çözümleme, eylem kaydı, güvenlik kapısı
│   ├── ai/, aiCore/, aiMechanic/  LLM gateway, kanıt motoru, mekanik teşhis
│   ├── reasoning/           MAVI Reasoning Engine istemcisi (karar otoritesi)
│   ├── fleet/               Filo zekâsı, sürücü DNA/varlık/kimlik doğrulama
│   ├── deepScan/            Derin ECU taraması (faz makinesi)
│   ├── devtools/            CAROS LAB gözlem katmanı (Sources/Model ayrımı)
│   ├── fieldValidation/     Uzun yol saha doğrulama gözlemcisi + öz-denetleyici
│   ├── safety/, security/   Güvenlik beyni, kara kutu, geofence, komut şifreleme
│   ├── phoneHub/            Telefon ↔ head unit RFCOMM bağlantısı (AES-GCM)
│   ├── system/SystemBoot.ts 4 dalgalı önyükleme orkestratörü (1 209 satır)
│   └── kernel/, eventBus/, capability/  Platform çekirdeği, olay veri yolu, yetenek kaydı
├── components/      (174) Özelliğe göre gruplu UI (map, obd, media, safety, themes, devtools…)
├── core/            (8)   Runtime çekirdeği: AdaptiveRuntimeManager, VAL, LRU cache
├── store/           (13)  Zustand dilimleri (tema, sistem, güvenlik, tehlike, uzman…)
├── hooks/           (21)  Ekran/hız/kamera/tema/OBD yaşam döngüsü hook'ları
├── admin/           (64)  Süper-admin paneli (ayrı SPA girişi)
├── __tests__/       (512) Birim + entegrasyon + regresyon kasası
android/             Capacitor Android projesi + 67 native dosya (OBD/CAN/media/OTA/HAL)
website/             Next.js 14 — PWA kumanda, filo paneli, pazarlama sayfaları, API rotaları
supabase/            63 migration + SQL testleri + doğrulama sorguları
docs/                Vizyon, kütük, mimari, saha raporları (~90 dosya)
```

### Mimari yaklaşım — bilmen gereken 6 kalıp

1. **Bridge Pattern.** Hiçbir bileşen Capacitor API'sini doğrudan çağırmaz.
   `platform/bridge.ts` runtime'da `Capacitor.isNativePlatform()` bakıp `nativeBridge`
   veya `demoBridge` verir.

2. **SystemBoot — 4 dalga.** `App.tsx` tek bir `systemBoot.start()` çağırır:
   - Wave 1 (Core): runtimeManager · safeStorage · NativeGuardBridge · crash recovery
   - Wave 2 (Backbone): VehicleDataLayer · SystemOrchestrator · HAL köprüleri
   - Wave 3 (Intelligence): MaintenanceBrain · FuelAdvisor · BlackBox · Geofence · Radar · Battery
   - Wave 4 (UI Services): TheaterService · SmartCardEngine · PushService
   Kapanış **LIFO** (Wave 4 → 1). Sıra bozulursa yaşam döngüsü sızdırır.

3. **Worker merkezli hesap.** Ağır iş ana thread'den çıkar: `VehicleCompute.worker.ts`
   (1 645 satır), `NavigationCompute.worker.ts`, `VisionCompute`. Ana thread yalnız render.

4. **Adaptive Runtime.** `AdaptiveRuntimeManager` donanım/termal/voltajdan `DeviceTier`
   (low/mid/high) ve `RuntimeMode` (PERFORMANCE · BALANCED · **BASIC_JS** · POWER_SAVE ·
   SAFE_MODE) seçer; CSS değişkenleri (`--rt-blur`, `--rt-anim`) ile blur/animasyon kısar.
   Mali-400 GPU'lu ucuz head unit'ler `BASIC_JS`'e düşer.

5. **Gözlem katmanı deseni (zorunlu).** Her yeni alt sistem üç dosyaya ayrılır:
   `<x>Sources.ts` (tek okuma katmanı, senkron, her getter try/catch) →
   `<x>Model.ts` (**saf**: I/O yok, timer yok, `Date.now` yok, React yok) →
   `<X>Screen.tsx` (OEM token'ları, açılışta tek okuma + elle YENİLE, timer/abonelik yok).
   Sonra `carosLabCatalog` + `carosLabScreenMap`'e kaydedilir.

6. **Kanıt/karar omurgası (yeni, henüz üretimde ölü).** Supabase tarafında
   `ai_evidence` → `mavi_reason()` → `ai_mechanic` zinciri kuruldu; niyet "tek karar
   otoritesi". Bugün üretimde **hiç karar üretmiyor** (bkz. §4).

### Bilinmesi kritik bir mimari gerçek
README "SharedArrayBuffer + Atomics" mimarisini anlatır, ama **`vite.config.ts` COOP/COEP'i
bilinçli olarak kapatmıştır** (YouTube iframe'i COEP altında kırılıyordu). Sonuç:
`crossOriginIsolated === false` → **SAB yolu üretimde kapalı**, sistem `BASIC_JS`
yedeğinden çalışıyor. README bu noktada güncel değil.

---

## 3. TAMAMLANANLAR

> Bu bölümde iki farklı kanıt seviyesi var ve **karıştırılmamalı**:
> 🟢 = gerçek cihaz/araçta ölçüldü · ✅ = kod tamam + test yeşil ama saha kanıtı yok.

### 🟢 Gerçek cihazda kanıtlanmış (kütükte 21 satır)

| İş | Kanıt | Yaşadığı yer |
|---|---|---|
| **Tanı Gönder uçtan uca** (#3/#4/#5) — projenin TEK "ÜRÜN HAZIR" özelliği | Cihazda buton → `vehicle_events` satırı → `/admin/tani` panelinde listelendi | `GlobalDiagnosticButton` → `selfTestEngine` → `obdSanitizer` → `diagnosticDelivery` → Supabase RPC |
| **Öğrenilmiş protokol timeout'ta silinmiyor** (#67) | Doblo (CAN) + Redmi + BLE dongle, taze APK; `obd:lastProtocol` korundu | `src/platform/obdService.ts` |
| **VehicleCompute worker "require is not defined" ölümü** (#10) | Head unit'te worker ayakta kaldı | `vite.config.ts` es2015 transpile eklentisi |
| **Cloud geofence uçtan uca** (#14) | Sürücü bölge tanımladı → RPC → head unit okudu → worker denetledi | `geofenceService.ts` + migration |
| **`push_vehicle_event` `text = uuid` backend hatası** (#B) | Canlı Supabase'te doğrulandı | migration 026 |
| **Filo telefon doğrulaması — 14 senaryo PASS** (#190) | Xiaomi 23090RA98I, oturum `FPV-20260729-2A9EE0E3` | `website/` filo katmanı |
| **Araç sahiplik devri P11** (#192) | 3 bağımsız koşumda tekrarlandı | migration 040 + 041 |
| **Çevrimdışı kuyruk dürüstlüğü** (#194) | "okunamadı" artık "yok" gibi sunulmuyor | `website/src/lib/fleet/` |
| **Debug kancası prod paketine sızmıyor** (#191) | 55 istemci chunk tarandı, `__carosFleetDebug` bulunamadı | `next build` çıktısı |
| **Mavi sahte-offline kökleri** (#97/#98/#99a) | CDP-over-adb canlı iz: CORS TypeError artık ağ ölümü sayılmıyor; model zinciri failover çalıştı | `aiVoiceService.ts`, AI gateway |
| **Navigasyon oturum sürekliliği** (#377/#379) | Tam ekran kapalıyken ilerleme sürdü; 20 döngüde tek oturum | `navigationSessionRuntime.ts` |
| **KWP handshake tam çalıştı** (🟡 rapor `8edd61a6`) | Protokol 5, VIN okundu, 15 PID, %100 kalite, 6,2 sn | native `OBDManager` + `ElmInitSequencer` |

### ✅ Kod tamam + test yeşil (saha borcu açık)

- **OBD Diagnostic OS FAZ 0–4:** 26 maddenin 25'i kod olarak bitti (+1 gereksiz kapatıldı).
  Standart DTC (03/07/0A), freeze frame, readiness, UDS 0x19/0x22, KWP2000 acquisition,
  çoklu-ECU keşfi, protokol-farkında zamanlama, capability-güdümlü poll listesi, 29-bit
  VIN keşfi, yakıt kalibrasyonu (PID 0x2F). **Ama 25 maddeden yalnız 3'ü 🟢.**
- **Navigasyon çekirdeği:** rota oturumu sahipliği görünümden ayrıldı, kamera sönümlemesi
  çağrı temposundan bağımsızlaştı, rota kalınlığı/rengi tek hakeme bağlandı, gündüz paleti
  ölçülüp kilitlendi, katlı kavşak okunurluğu + yol numarası kalkanı, tünel gece modu.
- **CAROS LAB:** 48 ekran kayıtlı, 37'si canlı — Canlı Veri, Oturum Denetçisi, Runtime
  Scheduling, KWP Monitor, Poll Evidence, Medya Otoritesi, Wake Kararları, Uzun Yol Saha
  Doğrulama, Fleet Identity, Queue Scheduler, AI Mechanic… "TÜMÜNÜ KOPYALA" maskeli dışa aktarım.
- **Filo / web katmanı:** şirket üyeliği + rol modeli (individual/observer/member/admin),
  araç atama, sahiplik devri, çevrimdışı mutation kuyruğu + yeniden senkron, RLS/GRANT matrisi.
- **Mavi / AI:** wake word, Vosk offline STT, hibrit bulut STT, TTS (Piper/eSpeak/Edge),
  niyet çözümleme, korunan eylem kapısı (whole-input allowlist), model failover zinciri,
  BYOK anahtar aktarımı (QR "KeyBeam").
- **Medya:** tek playback otoritesi (native audio focus), yerel müzik/video, YouTube yönlendirme.
- **Güvenlik altyapısı:** ECDH P-256 + AES-256-GCM uzaktan komut, replay koruması,
  kara kutu, kaza algılama (hareket kanıtı şartlı), akü koruma (4 seviye + histerezis).
- **Regresyon kasası:** `src/__tests__/regression.guards.test.ts` — defalarca bozulup
  düzeltilmiş davranışların kalıcı kilitleri.

---

## 4. YARIM KALANLAR

| Konu | Nerede kaldı | Eksik olan |
|---|---|---|
| **Karar omurgası (Reasoning Engine)** | Migration 055–060: kanıt yazımı, `mavi_reason()`, kuyruk, pg_cron zamanlayıcı, AI Mechanic — hepsi yerel PostgreSQL'de kanıtlı (47/47 · 34/34 · 25/25) | Üretim Supabase'inde **migration 060 uygulanmadı**, **pg_cron açılmadı** → üretimde bugüne kadar **tek bir karar üretilmedi**. Gerçek araç olayından doğmuş karar YOK (#279/#285/#306) |
| **Tek karar otoritesi** | Kural yazıldı ve üç yerde kilitlendi | **8 paralel karar otoritesi hâlâ bypass ediyor** (#284): `buildVehicleVerdict`, `buildDiagnosticVerdict`, `buildAiCoreVerdict`, `diagnosticKnowledgeEngine.combineConfidence`, `maintenanceBrain`, `fuelAdvisorService`, `smartCardEngine`, `predictionEngine`. Hiçbiri taşınmadı |
| **Mimari çatal (#286)** | `buildVehicleVerdict` nereye taşınacak karara bağlanmadı | (A) sunucu otoritesi — ağsız araçta karar üretilemez · (B) saf `reason()` cihazda da koşar — TS↔SQL parite testi şart. **Karar bekliyor** |
| **Deep Vehicle Scan** | Boot'ta `runOfflinePass()` çağrılıyor; `change_detection` fazı gerçek handler'a bağlı ve karar üretiyor | Diğer **5 offline faz handler'sız → `skipped`**; **6 aktif faz (ECU/PID/DID/firmware sorgusu) hiç çalışmıyor** (`waiting_for_ignition`'da bloke). Gerçek ECU taraması hâlâ yok. UI yüzeyi yok — kullanıcı taramayı başlatamaz |
| **Prediction Engine** | İzole birim testi var | Production tüketicisi **yok**; çıktı hiçbir store/UI'ya bağlı değil. Besleyecek zaman-serisi (Vehicle Memory) de yok |
| **Digital Twin** | `UnifiedVehicleStore` var | Bu **twin değil, anlık sinyal aynası**. Kimlik, geçmiş, tahmin, **provenance**, yaşam döngüsü yok |
| **Event Bus** | Omurga yayın yapıyor | Tüketici neredeyse yok (`publishedCount 127 / activeListenerCount 0` ölçümü). Talep kapısı (PR-E1) eklendi ama sahada `deliveredCount > 0` gözlenmedi |
| **Extended PID değer dolumu** | Keşif çalışıyor (`discovered: true, supportedCount: 15`), burst modu BLE'ye de eklendi | `samples: []` — **değer dolumu yok**. H1/H2/H3 hükmü gerçek araçta ölçülmedi (P1-1) |
| **Konum ölü hesabı (tünel modu)** | `#472` ile projeksiyon ekseni rota geometrisine bağlandı | Kütük #451 hâlâ açık; `_startDeadReckoning()` uzun süre **boş fonksiyondu**. Tünelde konum sürekliliği sahada kanıtlanmadı |
| **AI Fabric** | Model fallback zinciri (Gemini→Groq→Haiku) çalışıyor | Bu **fabric değil**. Uzman agent router, evidence judge, cevap birleştirme yok |
| **Kanıt kartları (web)** | `EvidenceCoverageCards` + `SubjectEvidenceList` yazıldı | **Hiçbir sayfa import etmiyor** (#277) — bağlanmamış bileşen gözlem yüzeyi sayılmaz |
| **Website prod build** | Dev'de çalışıyor | `NODE_ENV=production next build` → `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY`, **13–14 dashboard sayfası prerender'da düşüyor** (#276 / F5) |
| **Website lint** | Kök projede lint temiz | `website/` ESLint yapılandırması `src/**` dosyalarını **ignore ediyor** → website tarafında lint fiilen koşmuyor (#287) |
| **Uzun yol saha gözlemcisi** | 116 birim/runtime testi + öz-denetleyici (8 denetim) + BlackBox v2 checksum | Gerçek araçta **hiç koşmadı** (#308–#321): sistem kendisi `BLOCKED_REAL_VEHICLE` diyor. Process death, eMMC yazma azalması, kota defteri — hepsi ölçülmedi |
| **Phone Hub (P1-A)** | RFCOMM + AES-GCM + Keystore ECDH kodu yazıldı | Cihazda **hiç çalışmadı** (#122) |
| **Yola boyanmış manevra oku** | Çalışma ağacında, commit edilmemiş: `paintedArrowModel.ts` (276 satır, saf) + erişim katmanı + 288 satır test + `MapLayerManager` entegrasyonu | Commit yok, cihazda görülmedi, kütük satırı açılmadı |

---

## 5. HİÇ BAŞLANMAYANLAR

Vizyon defteri §8'de **durumu YOK** olan her şey — koda hiç dokunulmamış, "vizyon rezervuarı".

**Vehicle Intelligence (~20 madde):** Vehicle DNA · Vehicle Timeline · Vehicle Black Box
(olay-anı kalıcılığı) · Ghost Replay · Life Story · Personality · Memory Graph ·
Reliability Score · Risk Radar · Health Forecast · Component Life · Stress Meter ·
Hidden Fault Hunter · Immune System · Missing Sensor Reconstruction · Future Failure Map ·
Digital Shadow · Vehicle MRI · Road Learning · Vehicle Evolution.

**AI Fabric (~17 madde):** AI Mechanic (gerçek anlamda) · AI Analyst · AI Historian ·
Cost Advisor · Trip Planner · **AI Evidence Judge (fabric'in kilit eksiği)** · AI Teacher ·
Fleet Brain · Negotiator · Mechanic Battle · Explainability · What If · Future Report ·
Repair Verification · AI Laboratory · Self-Healing Advisor · Failure/Maintenance Simulator ·
Cost Predictor.

**Bakım ve servis:** Repair Memory · servis öncesi kontrol listesi ·
**gereksiz parça değişimi uyarısı** (ürünün en güçlü vaatlerinden biri, kod yok) ·
maliyet tahmini · doğrulanmış bakım/tamir geçmişi.

**Güvenlik ve hayat koruma:** Emergency AI · Emergency Contact System · acil arama desteği ·
kaza sonrası rehberlik · Silent Emergency · **Vehicle Guardian Mode** (park algısı var ama
güç bütçesi sözleşmesi şart).

**Güç ve uyku yönetimi — grubun tamamı YOK:** Smart/Continuous Surveillance ·
Service Session · OBD/ECU Sleep Profile · öğrenilmiş Wake Policy · kontrollü kısa ECU
uyanışı · **akü düşükken wake reddi (bu grubun ilk yazılacak maddesi, fail-closed)** ·
araç uyurken geçmiş analizi · tekrar uykuya dönme doğrulaması.

**Ekosistem:** Digital Garage (bunun için **tek araç varsayımının sökülmesi** gerekir —
geniş dokunuş) · Family Sharing · Vehicle Marketplace · Digital Health Certificate.

**Navigasyonda ölçülmüş boşluklar:** **şerit rehberliği** (32 adımın 0'ında şerit verisi
vardı) · **canlı trafik** (ETA yapısal olarak gerçekçi olamıyor) · **çevrimdışı rota motoru**
(offline-first iddiası burada karşılıksız).

---

## 6. SORUNLAR VE BORÇLAR

### 6.1 En büyük borç: kanıt açığı
**384 açık 🔴 madde** var. Bu bir "bug listesi" değil — çoğu "kod yazıldı, test yeşil,
ama gerçek araçta hiç görülmedi" kaydı. Kütük dosyası 898 KB'a ulaştı ve büyümeye devam
ediyor. Sürdürülebilirliği bir karar konusu (bkz. §9).

### 6.2 Gerçek sürüşte ölçülmüş, hâlâ açık kusurlar
Konya→Tarsus (289 km, 399 örnek, 1 Hz) ve Adana→Şanlıurfa koşumlarından:

| Kod | Kusur | Ölçüm |
|---|---|---|
| **G1** | **GPS fix'i medyanda 19,5 saniye bayat** — en ağır kusur | p50 19 496 ms → 94 km/h'de **~509 m konum körlüğü**; p95 100 s; max 121 s; fix > 10 s olan örnek **%61,2**. Kök #450'de "kusur bizde değil, OS teslimatında" diye kanıtlandı ama **ürün tarafı çözülmedi** |
| **G2** | Off-route **%17,5 CONFIRMED** ama **reroute hiç istenmedi** | Yeniden rota sayısı 0 |
| **G3/G4** | ETA aynı yolculukta **1 sa 49 dk sıçradı**; ekran ile motor çelişiyor (iki ayrı ETA otoritesi) | — |
| **G5** | Kalan mesafenin **%38'i kuş uçuşu** hesaplanıyor | — |
| **G9/G11** | Kalan mesafe **69 kez arttı**; konum doğruluğu p95 **7 578 m** | — |
| **G12/G13** | `OFF_NETWORK` %38; hız örneklerinin %16'sı `null` | — |
| **T2** | Ekranda **"Hız 255 km/h"** — `0xFF` sentinel'i sanitizasyonu geçiyor | Test/doğrulama modu denetiminde |
| **#455** | `vehicleCtx.speedKmh` hız bilinmezken **sahte `0`** besliyor | `MainLayout.tsx:284` |

### 6.3 Yapısal / mimari borçlar
- **İki paralel hız sistemi (Ç-7):** `speedFusion.ts` plausibility + histerezis + kalibrasyon
  içeriyor ama yalnız MiniMap/telemetry'de; **ana gösterge yolu bunların hiçbirine sahip
  değil**. Çelişki kapısı (`931b41c`) ana yola konuldu, ama iki sistemin varlığı sürüyor.
- **8 paralel karar otoritesi** (§4) — "tek karar otoritesi" bugün yalnız yeni özellikler için bağlayıcı.
- **Test kırılganlığı (#484 / #275 / #312):** dinamik `import()` yapan kilitler soğuk Vite
  önbelleğinde 5 sn varsayılan timeout'a takılıyor. Bu raporun koşumu `--testTimeout=30000`
  ile **11 279/11 279 yeşil**; **bayraksız koşumda rastgele düşebilir**. `npm run apk:safe`
  bayraksız `npm run test` çağırdığı için **APK üretimi bu yüzden düşebilir**.
- **Migration disiplini:** 046 tek başına yeniden uygulanamıyor (#274); zincir **artan
  sırada** koşulmalı ve bu sıra **elle** korunuyor (#282); 025/026 history boşluğu (P1-5).
- **Kalıcı secret-scan harness'ı YOK** (#271) — gömülü AI anahtarı denetimi ad-hoc koşuldu.
- **Belge enflasyonu:** 44 kök + ~90 `docs/` Markdown. `ROADMAP.md` ve
  `CAROS_15_YIL_VIZYON_YOL_HARITASI.md` resmen "tarihsel/bayat" ilan edildi ama silinmedi.
  `HANDOFF.md` (72 KB) ve `PROJECT_STATE.md` (99 KB) da eski.
- **README ↔ kod çelişkisi:** README SharedArrayBuffer mimarisini anlatıyor; `vite.config.ts`
  COOP/COEP'i bilinçli kapatmış → SAB üretimde kapalı. Bu çelişki hiçbir yerde kayıtlı değil.
- **Repo hijyeni:** kökte commit'li **76 MB APK**, 1,8 MB `inventory.csv`, 4 ekran görüntüsü
  PNG, `undefined/` adlı kazara oluşmuş klasör, `test-results/`, `playwright-report/`.
- **Dev sunucusu bulunamadı riski:** `.env.production.local` bu makinede
  `VITE_ENABLE_DEBUG_PANEL` açıyor → **CAROS LAB + DebugPanel her kurulumda görünür**.
  Dosya `.gitignore`'da, yani satış build'inde kapalı kalır — ama **silinmesi
  `docs/RELEASE_CHECKLIST.md`'ye bağlı, otomatik guard yok**.

### 6.4 Bilinen ❌ (denendi, düştü) ve geri dönüş gerektirenler
- **F5 / #276:** website production build'i düşüyor (yukarıda).
- **F1–F4:** filo çevrimdışı kuyruk kusurları — dördü de **düzeltildi** ve #190/#194 ile
  yeniden doğrulandı, ama kütükte ❌ satırı olarak duruyor (tarihsel kayıt).
- **#307:** `mavi_reason(p_ttl := ...)` kanıtlı yolda TTL'i yutuyor → `DUPLICATE` +
  varsayılan 24 saatlik TTL. Görev kuralı gereği düzeltilmedi, açık.

---

## 7. ÖNEMLİ KARARLAR (yanlışlıkla bozulabilecek kurallar)

1. **Saha Doğrulama Kütüğü mutlak otoritedir.** Test yeşil + `tsc` temiz bir özelliği
   "başarılı" **yapmaz**. Her yeni özellik önce 🔴 olarak, *ölçülebilir bir kabul ölçütüyle*
   `docs/DEVICE_VALIDATION_LEDGER.md`'ye eklenir. Kütükte 🔴 bekleyen bir özelliği
   "tamam/çalışıyor" diye sunmak yasaktır.

2. **Zorunlu gözlemlenebilirlik — 7 şart.** "Gözlemlenemeyen özellik tamamlanmış değildir."
   Her önemli özellik aynı fazda CAROS LAB gözlem ekranıyla birlikte biter. LAB ekranı
   **salt-okunur**; **aktif komut GÖNDERMEZ**. Gizli veri (API anahtarı, VIN, konum, ham
   transkript) LAB'a **taşınmaz** — yalnız VAR/YOK ve ADET.

3. **Sahte veri yasağı (fail-closed).** Bilinmeyen alan `UNKNOWN`/`UNAVAILABLE` gösterilir.
   **Sahte 0, sahte tarih, sahte "sağlıklı" yasaktır.** Bu kural defalarca ihlal edildiği
   için kütükte ayrı maddeler var (#301, #455…). Sınıflandırma sözleşmesi
   `sessionInspectorModel`'dendir (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel
   sistem kurulmaz.

4. **Sources / Model / Screen ayrımı.** Model dosyaları **saf** olmak zorunda: I/O yok,
   timer yok, `Date.now` yok, global durum yok, React importu yok. Testler bu yüzden
   deterministik. Bu deseni bozmak tüm LAB disiplinini bozar.

5. **Regresyon kasası dokunulmazdır.** `src/__tests__/regression.guards.test.ts` kilitleri
   **asla zayıflatılmaz/silinmez**; davranış bilinçli değiştiyse kilit **güncellenir**.
   Yeni bug düzeltildiğinde karşılık gelen kilit **eklenir**. APK yalnız `npm run apk:safe`
   ile üretilir (`gradlew clean` ile — stale-APK tuzağı gerçek bir vakadır).

6. **Atomik patch / tek kök neden** (`AI.md`). Çoklu sistem refactor'ü yasak. Yarım mantık,
   eksik cleanup, derlenmeyen kod bırakılmaz. Her patch sonrası `npx tsc --noEmit`.

7. **Zero-leak bellek yönetimi.** Her `useEffect`/`setInterval`/`eventListener`'ın cleanup'ı
   olmak zorunda; MapLibre örnekleri ve WebGL bağlamları unmount'ta açıkça yok edilir.

8. **V8/JIT disiplini.** Template object literal'ler (boş `{}` + dinamik alan yasak),
   sabit property sırası, `delete` yasak, hot-path'te sıfır tahsis, SAB yazımında Seqlock
   + 64 bayt cache-line padding.

9. **COOP/COEP bilinçli olarak KAPALI** (`vite.config.ts`). Gerekçe: COEP, COEP başlığı
   göndermeyen çapraz-köken iframe'leri (YouTube) kırıyordu; APK zaten COEP göndermiyor.
   Sonuç: SAB yok, `BASIC_JS` yolu. **Bunu "düzeltmeye" kalkma** — bilinçli.

10. **Worker'lar classic IIFE + es2015'e transpile edilir.** Eski WebView'larda
    (Duster 64-79, 8227L 52-74) modül worker satır-1'de ölür. `vite.config.ts` içindeki
    `transpile-worker-to-es2015` eklentisi ve `assumptions.setPublicClassFields` bunu
    korur; `require is not defined` hatası bu korumanın çöktüğünün işaretidir.

11. **Bilinçli YAZILMAYANLAR (eksiklik değil, karar):**
    - **ISO-TP** yazılmadı — ELM327 donanımda yapıyor.
    - **Native UDS yazma (0x2E/0x31/0x27, F4-5)** yazılmadı — yalnız 7 kapılı KARAR modeli var.
      Kapı sahada kanıtlanmadan yazma kodu eklemek "araca zarar vermem" sözünü riske atardı.
    - **Güvenlik-kritik kapılar Reasoning Engine'e bağlanmadı** (#283): `SafetyRuleEngine`,
      `SafetyBrain`, `guardian/*`, `aiCore/safetyGate` sürüş anı hot-path'tir (ms mertebesi);
      `assistantSafetyKernel` ve `TrustEngine` **yetki** kararıdır, araç hakkında hüküm değil.
      Bu bir istisna listesidir; yeni dosya eklenirse gerekçesi yazılmalıdır.

12. **Ticari lisans kuralı.** Yalnız permissive lisans (MIT/Apache-2.0/BSD/ISC/Zlib/CC0/OFL).
    **GPL/AGPL/LGPL/SSPL/EUPL ve Non-Commercial varlıklar YASAK** — CI'da `license-check.yml`
    bunu zorlar, bulursa build kırılır. OSM tabanlı harita verisi için `© OpenStreetMap
    katkıcıları` atıfı zorunlu (ODbL). Ücretli AI API'leri **BYOK** — uygulamaya merkezi/gömülü
    API anahtarı konmaz. 3. taraf marka logosu gömülmez.

13. **Supabase kuralı.** `public` şemadaki her yeni tablo için **GRANT + RLS + POLICY üçlüsü
    zorunlu** ve migration sonunda `information_schema.role_table_grants` sorgusuyla
    doğrulanır. GRANT'siz migration "production-critical hata" sayılır. Ters yönde bir tuzak
    da var: **araç tablolarına gereksiz `anon` GRANT head unit'i kırar** (R4 kaydı).

14. **Faz A politikası.** UX/tasarım/sadeleştirme şu an öncelik değil. Teknik ekran, teknik
    isim (PID/DID/NRC/KWP/UDS), ham log ve ham hex gösterimi **serbesttir**.
    *"Kullanıcı bunu anlamaz" gerekçesiyle özellik kısıtlamak yasaktır.*

15. **Çalışma kuralları.** Tüm yanıtlar **Türkçe**. Onay istemek **yasak** — dosya yazma,
    build, git commit/push dahil doğrudan yapılır. Hedef branch **`main`** (`master` arşiv).
    **Kirli branch'e checkout yapılmaz.** Görev başında `docs/CAROS_PRO_VIZYONU.md` okunur,
    PR sonunda güncellenir.

---

## 8. SIRADAKİ ADIMLAR (önem sırasına göre)

### 1. GPS tazeliği (G1) — diğer navigasyon kusurlarının çoğu bunun türevi
94 km/h'de yarım kilometrelik konum körlüğüyle şerit rehberliği, doğru "şimdi dön" anı
ve dürüst kalan mesafe **matematiksel olarak imkânsız**. #450 kökü işletim sisteminin
konum teslimatına bağladı — ama bu bir **teşhis**, çözüm değil. Yapılacak: konum
otoritesini tek kapıya almak, `fixAgeMs`'i UI'da dürüstçe göstermek, ölü hesap köprüsünü
(#472 kısmi) tamamlamak, gerekirse native `LocationManager` hattını doğrudan sürmek.

### 2. Reroute kapısını kapat (G2)
Off-route **%17,5 CONFIRMED** iken reroute sayısı **0**. Bu, navigasyonun kullanıcıya en
görünür kaybı: yanlış yola sapıyorsun ve uygulama seni geri getirmiyor. Karar zinciri
(`CONFIRMED_OFF_ROUTE` → reroute isteği) sahada hiç tetiklenmedi — eşik/aksiyon ayrışması
zaten bu projenin tekrarlayan kök nedenlerinden biri.

### 3. Satış kapısı borçları (P0-3 / P0-4)
Bunlar **ürün gönderilmesini engelleyen** maddeler: kalıcı secret-scan harness'ı (#271),
release build'de geliştirici yüzeylerinin kapalı olduğunun **guard testiyle** kanıtlanması,
`/enable-adb` ve port 8899 gibi debug yüzeylerinin shippable build'de erişilemezliği.
Şu an bunların hiçbirinin otomatik koruması yok — insan hafızasına bağlı.

### 4. Test altyapısını sağlamlaştır (#484)
`apk:safe` bayraksız `npm run test` çağırıyor ve dinamik `import()` yapan kilitler soğuk
önbellekte 5 sn'ye takılıyor → **APK üretimi rastgele düşüyor**. Kökten çözüm: ilgili
modülleri statik import'a almak (timeout'u kör biçimde büyütmek **doğru yol değil**,
kütük bunu açıkça yazıyor). Bu, tüm doğrulama zincirinin güvenilirliğini belirliyor.

### 5. Kanıt borcunda hedefli bir saha turu
384 🔴'ün hepsi kapatılamaz. En yüksek riskli kümeyi seç ve gerçek araçta kapat:
**P0-5 (DTC'li araçta fail-closed verdi — ürünün ana güven vaadi)** ·
**#308–#321 (uzun yol gözlemcisi + process death + BlackBox penceresi)** ·
**P1-1 (extended PID değer dolumu)**. Bunlar kapanmadan "profesyonel teşhis" iddiası
kanıtsız kalır.

### 6. (İkincil) Website prod build'ini onar
F5 / #276: `ACCOUNT_CLEANUP_RUNTIME_BROWSER_ONLY` yüzünden **14 dashboard sayfası**
prerender'da düşüyor; filo paneli bugün üretime çıkarılamaz. Yön: runtime'ı SSR'da
çağırmamak (lazy/`useEffect`) veya ilgili sayfaları `dynamic = 'force-dynamic'` yapmak.
Aynı turda `website/` ESLint ignore sorunu (#287) da kapatılmalı.

---

## 9. BİLİNMEYENLER (karar bekleyen açık sorular)

1. **GPS teslimat kökü kabul mü ediliyor?** #450 "kusur bizde değil, OS'te" diyor.
   Bu bir kabul mü (o zaman ürün bu doğrulukla mı satılacak?), yoksa kendi konum hattımızı
   native tarafta mı kuracağız? Bu karar navigasyonun tavanını belirliyor.

2. **Reasoning Engine mimari çatalı (#286).** (A) Karar sunucuda üretilir — ağsız araçta
   verdi üretilemez · (B) Saf `reason()` cihazda da koşar — TS↔SQL parite testi şart ve
   055/057'nin yazılı kararı bilinçli olarak değişir. **Bu seçilmeden karar omurgası
   ilerleyemez.**

3. **Gerçek araç erişimi kimde, ne zaman?** Trafic (KWP) kullanıcıda değil; DTC'li araç,
   MIL yanan araç, freeze frame'li araç, ABS/airbag arızalı araç, üretici kodlu araç —
   bunların hiçbirine erişim yok. Bu araçlar olmadan FAZ 1–4'ün saha borcu **hiçbir zaman**
   kapanamaz. Uzaktan "Tanı Gönder" raporu tek yol mu, yoksa bir servis/atölye
   iş birliği mi kurulacak?

4. **384 açık 🔴 ne olacak?** Hepsi kapatılacak mı, yoksa bir kısmı "kabul edilen borç"
   olarak arşivlenecek mi? Kütük 898 KB — okunabilirliği ve tek-dosya yapısı sürdürülebilir
   mi, yoksa yıl/tur bazlı bölünmeli mi?

5. **Ticari model netleşti mi?** B2B head unit üreticisine gömülü satış mı, doğrudan
   tüketiciye aftermarket kurulum mu? Faz B (Servis/Expert Mode) ve Faz C (son kullanıcı)
   ne zaman başlıyor? Bu, UX borcunun ne zaman ödeneceğini belirler.

6. **BYOK satılabilir bir deneyim mi?** Son kullanıcıdan kendi Gemini/OpenRouter anahtarını
   istemek ticari üründe kabul edilebilir mi? Değilse merkezi anahtar yasağı (fatura + ToS
   riski) nasıl aşılacak — proxy servisi mi, sağlayıcı anlaşması mı?

7. **İki React sürümü birleşecek mi?** Araç (React 19 / Zustand 5 / Tailwind 4) ve
   website (React 18 / Zustand 4 / Tailwind 3) ayrı ilerliyor. Ortak `lib` ihtiyacı
   arttıkça bu ayrışma pahalıya patlar.

8. **OTA gerçek mi?** `otaUpdateService` durum makinesi ENTEGRE, `scripts/publish-ota.mjs`
   var — ama telemetri yok ve saha kanıtı yok. Gerçek bir OTA sunucusu ayakta mı?

9. **Repo hijyeni kararı.** Kökteki 76 MB APK, `inventory.csv`, ekran görüntüleri,
   `undefined/` klasörü, bayat 44 kök Markdown — temizlenecek mi, yoksa tarihsel kayıt
   olarak mı kalacak?

10. **`.env.production.local` satış kapısı.** Geliştirici yüzeylerini açan bu dosyanın
    silinmesi bugün insan hafızasına bağlı. Otomatik bir release guard yazılacak mı?

---

## EK: İlk gün için hızlı komut kartı

```bash
npm run test                      # tüm testler (⚠️ #484: bayraksız rastgele düşebilir)
npx vitest run --testTimeout=30000  # güvenilir tam koşum → 11 279 test yeşil
npm run guard                     # yalnız regresyon kasası
npx tsc -b                        # tip denetimi (composite)
npm run lint                      # ESLint (yalnız kök proje; website ignore ediyor)
npm run build                     # SW + tsc + vite build
npm run apk:safe                  # test → build → compat → sync → clean assembleDebug
npm run dev                       # tarayıcıda geliştirme (demoBridge)
```

**Göreve başlamadan mutlaka oku:** `CLAUDE.md` · `AI.md` ·
`docs/CAROS_PRO_VIZYONU.md` · `docs/DEVICE_VALIDATION_LEDGER.md`.
