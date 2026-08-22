# CarOS Pro — Teknik Devir Raporu

**Tarih:** 2026-08-22 · **Dal:** `feat/fleet-offline-final-local-completion` ·
**Yöntem:** kod okuma + üretim veritabanı ölçümü + test koşumu.

> **Bu raporun kuralı:** koddan ya da üretimden **doğrulanamayan** hiçbir şey
> olumlu yazılmadı. Doğrulanamayanlar **`DOĞRULANAMADI`** ile işaretlidir.
> README ile kod çeliştiğinde **kod esas alındı** ve çelişki raporlandı.
> Bu tur salt-okunurdur: kod değiştirilmedi, silinmedi, deploy edilmedi.

---

## 1. Executive Summary

CarOS Pro üç ayrı çalıştırılabilir üründen oluşan bir **mono-repo**dur:

| Ürün | Ne | Teknoloji |
|---|---|---|
| **Araç uygulaması** | Android head unit / araç içi bilgi-eğlence ve teşhis OS'u | React 19 + Vite 8 + Capacitor 8 (~159 bin satır TS/TSX) |
| **Website + PWA** | Pazarlama sayfaları, filo panosu, telefon kumandası | Next.js 14 + React 18 (~69 bin satır) |
| **Süper-admin SPA** | Operasyon/gözetim paneli | React Router 7, araç uygulamasının içinde ayrı giriş |
| **Sunucu** | Kimlik, filo, telemetri, zekâ katmanı | Supabase (PostgreSQL + RPC + RLS + pg_cron) |

**Olgunluk profili alışılmadık:** mühendislik disiplini çok yüksek
(13.139 birim testi, 12 gerçek PostgreSQL matrisi, 26 Java testi, 6 CI iş akışı,
tek `TODO`, sıfır `FIXME`), **ürün doğrulaması ise çok düşük** — saha doğrulama
kütüğündeki 638 maddenin yalnız **58'i (%9,1)** gerçek araçta doğrulanmış,
**537'si (%84)** hiç denenmemiş.

**Bir cümlede:** kod kalitesi ve mimari özdenetim üretim seviyesinde; ürünün
**gerçek dünyada kanıtı** ise henüz değil.

**Satışa hazırlık:** **SINIRLI BETA** (§30).

### En kritik üç bulgu

1. **`vehicles.api_key_hash` kolonu adına rağmen DÜZ METİN taşıyor.** Üretimdeki
   834 satırın **834'ü** UUID biçimli; SHA-256 biçimli **0**. Veritabanı
   sızarsa 834 aracın cihaz kimliği doğrudan kullanılabilir. (§20 · RISK-01)
2. **Üretimde 838 araç satırının 837'si sahipsiz** (ne şirket ne kullanıcı),
   822 tekil cihaz adı. Her biri bir bearer kimlik taşıyor. (§20 · RISK-02)
3. **Üç website rotası, asla eşleşemeyecek bir doğrulama yapıyor**
   (`sha256(anahtar)` ile düz metin kolonu karşılaştırılıyor). Bugün
   tüketicileri emekli olduğu için ürünü kırmıyor; yeniden açılırsa **sessizce
   401** üretir. (§23 · BUG-001)

---

## 2. Uygulama ne yapıyor?

**Koddan doğrulanan tanım:** CarOS Pro, aftermarket bir Android head unit'i
**araç zekâsı platformuna** çeviren bir işletim katmanıdır. Yalnız uygulama
başlatan bir launcher değildir; `SystemBoot` açılışta **55 alt sistem**
başlatır (§15).

**Ana yetenek kümeleri (hepsi kodda mevcut):**

- **OBD-II / CAN teşhis:** ELM327 BLE/SPP, çoklu-ECU tarama, UDS 0x19 + KWP 0x18
  DTC okuma, üretici DID/PID keşfi, kanıt tabanlı hüküm üretimi
  (`src/platform/obd/`, 62 dosya · `obdService.ts` tek başına 3.391 satır)
- **Çevrimdışı navigasyon:** kendi rota grafiği (`routing-graph.bin`, **7,65 MB**,
  238.252 düğüm) üzerinde ε-kabul edilebilir A*, kendi POI veritabanı
  (`poi.db`, **16,5 MB**, 84.911 POI), MapLibre vektör karo + LRU önbellek
- **Sesli asistan "Mavi":** Vosk çevrimdışı STT + hibrit bulut yönlendirme
  (Claude/OpenRouter/Gemini/Groq — **BYOK**), niyet ayrıştırma, korunan eylem kapısı
- **Filo yönetimi:** araç–sürücü ataması, yolculuk yükleme, Driver DNA, filo
  içgörüsü, uzak komut, coğrafi çit
- **Güvenlik/Guardian:** hız limiti (yol + araç sınıfı), radar/denetim noktası
  uyarısı, geri vites önceliği, tehlike bildirimi
- **CAROS LAB:** 62 araçlık, **salt-okunur** geliştirici tanılama merkezi
  (§4) — projenin en özgün yanı

**Hedef kullanıcı:** ikinci el/aftermarket head unit takan Türkiye pazarı sürücüsü
ve **küçük–orta filo işletmecisi**.

**Ayrışma ekseni (koddan görülen tasarım felsefesi):** Tesla gibi *kendi* aracını
tanıyan bir sistem değil; **bilinmeyen** marka/modeli öğrenmeye çalışan bir
sistem. Bu yüzden kod baştan sona **provenance** (bu değer nereden geldi) ve
**fail-closed** (kanıt yoksa hüküm yok) disipliniyle yazılmış. Bu disiplin
rapor boyunca defalarca görülecek ve projenin gerçek rekabet avantajıdır.

**Ücretlendirilebilir yüzeyler (kodda karşılığı olanlar):** filo panosu ·
zamanlanmış rapor · dış REST API (v1, §12) · Driver DNA/skor · çevrimdışı
harita+rota paketleri · AI Gateway (BYOK).

---

## 3. Technology Stack

### Araç uygulaması (`/`)

| Katman | Seçim | Sürüm |
|---|---|---|
| Dil | TypeScript (strict) | ~5.9.3 |
| UI | React | ^19.2.7 |
| Build | Vite (+ `@vitejs/plugin-legacy`) | ^8.1.3 |
| Stil | Tailwind CSS | ^4.2.2 |
| Durum | Zustand | ^5.0.14 |
| Harita | MapLibre GL | ^4.5.0 |
| Mobil kabuk | Capacitor Android | ^8.4.1 |
| Yerel DB | sql.js (WASM SQLite) | ^1.14.1 |
| i18n | i18next + react-i18next | ^26 / ^17 |
| Test | Vitest + Playwright | ^4.1.2 / ^1.61.1 |
| İkon | lucide-react | ^0.577.0 |

Build hedefi **ES2015** (eski WebView uyumu), `manualChunks` ile elle
parçalama, `legacy()` eklentisi ve ondan sonra çalışan bir düzeltme eklentisi
(`fixLegacyModernDetection`) var — eski head unit WebView'larıyla uğraşıldığı
buradan okunuyor.

### Website / PWA (`website/`)

Next.js **^14.2** (App Router) · React **^18.3** · Tailwind **^3.4** ·
Zustand **^4.5.7** · MapLibre **^5.24** · `msedge-tts` · `ws`.

> ⚠️ **Sürüm ayrışması:** kök React 19, website React 18; kök Tailwind 4,
> website Tailwind 3. Bu **bilinçli** (website'in kendi `vitest.config.ts`'i
> React'i kendi kopyasına alias'lıyor) ama iki ayrı `node_modules` demek —
> ortak kod paylaşımı yok.

### Sunucu

Supabase yönetilen PostgreSQL. **57 tablo**, **101 açık RPC**, **151 SECURITY
DEFINER** fonksiyon, `pg_cron` ile 3 zamanlanmış iş.

### Native (`android/`)

**111 Java + 12 Kotlin** dosya. `minSdk 24`, `targetSdk 36`, `compileSdk 36`.
Release build'de `minifyEnabled` + `shrinkResources` + ProGuard **açık**.
İmzalama `keyProperties` üzerinden dışarıdan okunuyor (repoda keystore yok).

**DOĞRULANAMADI:** Kotlin dosyalarının rolü ayrıca incelenmedi.

---

## 4. Architecture

### Katman modeli (araç uygulaması)

```
React bileşenleri  (src/components, 191 dosya)
        │  yalnız platform servisleri üzerinden
        ▼
Platform katmanı   (src/platform, 847 dosya / 50 alt alan)
        │
        ├── bridge.ts  ──►  demoBridge (tarayıcı)  |  nativeBridge (Capacitor)
        ▼
Native eklenti     (android/…/CarLauncherPlugin.java)
```

**Bağlayıcı kural (CLAUDE.md):** bileşenler Capacitor API'lerini **doğrudan
çağırmaz**; her yetenek `src/platform/` altındaki bir servisten geçer.

### Açılış orkestrasyonu

`src/platform/system/SystemBoot.ts` (1.304 satır) **55 alt sistemi** sırayla
ayağa kaldırır. Örnekler: `startVehicleDataLayer` · `startNavWorker` ·
`startGuardianRuntime` · `startPredictionRuntime` · `startTripUpload` ·
`startCompanionEngine` · `startBlackBox` · `startOfflineAutoCache` ·
`startWakeWordService` · `startBatteryProtection`.

Bu dosya **sistemin gerçek haritasıdır** — yeni gelen mühendis buradan başlamalı.

### Çalışma zamanı uyarlaması

`src/core/runtime/AdaptiveRuntimeManager.ts` (1.338 satır) cihaz sınıfına göre
mod seçer (`PERFORMANCE · BALANCED · BASIC_JS · POWER_SAVE · SAFE_MODE`) ve
tüm zamanlanmış görevleri tek bir 3 Hz ana tik üzerinden yürütür
(`scheduleTask({id, periodMs, criticality})`).

**Ölçülmüş gerçek:** mod tespiti **dört sıralı kapıdan** geçer —
`deviceTier` → `weakGpu` → `worker` → `SAB+crossOriginIsolated`. Referans
donanımda (K24 · Mali-400) **ikinci kapı** tetikler; SAB kapısına sıra gelmez.
Karar kaydı: `docs/adr/0005-sab-crossoriginisolation-runtime-ceiling.md`.

### Worker'lar

`VehicleCompute.worker.ts` (1.680 satır) · `NavigationCompute.worker.ts`
(590) · VisionCompute. `SharedArrayBuffer` **16 dosyada** geçiyor ama üretimde
`crossOriginIsolated=false` olduğu için hepsi `postMessage` yedeğine düşüyor —
**ölü değil, uykuda** (ADR 0005).

### Website mimarisi

Next.js App Router, rota grupları: `(public)` pazarlama · `(pwa)` telefon
kumandası · `dashboard/*` korumalı filo panosu · `api/*` sunucu uçları.
Koruma **`middleware.ts`** ile: yalnız `/dashboard/:path*` korunuyor.

---

## 5. Repository Map

```
/
├── src/                       ARAÇ UYGULAMASI (~159k satır)
│   ├── platform/   847 dosya  Tüm iş mantığı + native köprü (50 alt alan)
│   ├── components/ 191        UI (29 özellik klasörü)
│   ├── __tests__/  616        Vitest (606 test dosyası)
│   ├── admin/       62        Süper-admin SPA (React Router)
│   ├── core/         8        AdaptiveRuntimeManager, CacheLRUManager
│   ├── hooks/       21        useOBDLifecycle, useRadarSystem, useTripMeter…
│   ├── store/       12        Zustand store'ları
│   ├── styles/      22        Tema/CSS token'ları
│   └── data/         3        Statik uygulama tanımları
│
├── website/                   NEXT.JS SİTE + PWA (~69k satır)
│   └── src/
│       ├── app/               34 sayfa · 22 API rotası
│       ├── components/        Panel, dashboard, pwa bileşenleri
│       ├── lib/               Servisler (console/, fleet/, theme/, api/, reports/)
│       ├── __tests__/  69     Vitest (1.418 test)
│       └── middleware.ts      /dashboard koruması
│
├── android/                   111 Java + 12 Kotlin · 26 birim testi
├── supabase/
│   ├── migrations/            Şema zinciri
│   └── tests/          12     Gerçek PostgreSQL matrisleri (057–067)
├── e2e/                 8     Playwright spec
├── scripts/            18     Veri üretimi + matris koşucuları
├── docs/              140     Kütük, vizyon, ADR, devir belgeleri
└── public/maps/               routing-graph.bin (7,65 MB) · poi.db (16,5 MB)
```

### `src/platform` alt alanları (en büyükler)

| Alan | Dosya | Rol |
|---|---|---|
| `devtools/` | 96 | CAROS LAB veri kaynakları + saf modeller |
| `ai/` | 75 | AI Gateway, kimlik bilgileri, mekanik, hafıza |
| `navigation/` | 75 | Rota, HUD, çevrimdışı graf, oturum |
| `obd/` | 62 | ECU keşfi, DTC, DID, tahmin motoru |
| `trip/` | 32 | Yolculuk yaşam döngüsü ve yükleme |
| `media/` | 28 | Müzik/oynatma otoritesi |
| `maviCore/` | 24 | Sesli asistan çekirdeği |
| `companion/` | 22 | Sohbet sağlayıcısı |
| `vehicleDataLayer/` | 19 | Birleşik araç durumu + provenance |
| `map/` | 18 | Katman yöneticisi, karo şablonu |

---

## 6. Screens

### 6.1 Araç uygulaması — navigasyon **router tabanlı DEĞİL**

**Önemli mimari gerçek:** araç uygulaması `react-router` **kullanmaz**
(router yalnız `src/admin` SPA'sında var). Ekranlar `MainLayout` içinde
**durum anahtarıyla** açılan çekmecelerdir:

```ts
// src/components/layout/DockBar.tsx:15
type DrawerType =
  | 'none' | 'apps' | 'settings' | 'dashcam' | 'triplog' | 'dtc'
  | 'notifications' | 'weather' | 'sport' | 'security' | 'entertainment'
  | 'traffic' | 'music' | 'phone' | 'vehicle-reminder' | 'climate'
  | 'super-admin' | 'caros-lab';
```

Bunun üstünde **tam ekran modlar** (`MainLayout.tsx:88-96`):
`fullMapOpen` · `splitOpen` · `rearCamOpen` · `passengerOpen` ve
**öncelikli kaplamalar**: `ReversePriorityOverlay` · `SafetyOverlay` ·
`RadarAlertHUD` · `GeofenceAlarmOverlay` · `SentryOverlay` · `SleepOverlay`.

| Çekmece | Bileşen | Amaç | Yükleme |
|---|---|---|---|
| `apps` | `AppGrid` | Uygulama başlatıcı | eager |
| `settings` | `SettingsPage` (2.199 satır) | Tüm ayarlar | lazy |
| `dtc` | `DTCPanel` | Arıza kodları + çoklu-ECU tarama | eager, `active` prop |
| `triplog` | Yolculuk günlüğü | Geçmiş yolculuklar | lazy |
| `notifications` | Bildirim listesi | — | lazy |
| `weather` · `traffic` · `sport` · `climate` · `music` · `phone` | ilgili panel | — | lazy |
| `security` | `SecuritySuite` | Sentry/geofence/PIN | lazy |
| `entertainment` | `EntertainmentPortal` | Medya + mola uyarısı | lazy |
| `dashcam` | `DashcamView` | Kamera kaydı | lazy |
| `super-admin` | `SuperAdminShell` | Operasyon paneli | lazy |
| `caros-lab` | `CarosLabShell` | **62 araçlık tanılama merkezi** | lazy |

> **Fail-closed kapı:** `super-admin` ve `caros-lab` çekmeceleri
> `DEVELOPER_FEATURES_ENABLED` arkasında; satış build'inde **render edilmez**.
> `caros-lab` ayrıca sesle açılamaz (`screenRegistry`'de yok).

**Ekran başına tam matris (loading/empty/error/permission) tek tek
çıkarılmadı — `DOĞRULANAMADI`.** 191 bileşen ve 62 LAB ekranı için bu, bu
turun bütçesini aşıyordu. §18'de örneklem üzerinden değerlendirme var.

### 6.2 CAROS LAB — 62 araç

`src/platform/devtools/carosLabCatalog.ts`: **62 kayıt · 58 AVAILABLE ·
2 PLACEHOLDER**. Beş kategori: `vehicle · communication · runtime · ai ·
developer`. Ekran dosyaları: `src/components/devtools/screens/` (58 dosya).

**Bağlayıcı LAB sözleşmesi (CLAUDE.md):** her ekran **salt-okunur**, aktif
komut göndermez, kanıtsız bilgi üretmez (`UNKNOWN`/`UNAVAILABLE` gösterir),
gizli veri taşımaz (yalnız VAR/YOK ve ADET), timer kurmaz (açılışta tek okuma
+ elle YENİLE).

### 6.3 Website — 34 sayfa

| Grup | Rota | Koruma |
|---|---|---|
| Kök | `/` | açık |
| `(public)` | `/features` `/enterprise` `/contact` | açık |
| Kimlik | `/login` `/register` `/forgot-password` `/reset-password` `/auth/hash-callback` | açık |
| `(pwa)` | `/kumanda` `/key-beam` | açık (cihaz eşleşmesi) |
| Panel | `/dashboard` `/dashboard/map` `/dashboard/vehicles` `/dashboard/settings` `/dashboard/notifications` `/dashboard/diagnostic` | **korumalı** |
| Filo | `/dashboard/fleet` + 13 alt sayfa (`vehicles`, `vehicles/[id]`, `drivers`, `manage`, `members`, `company`, `company-vehicles`, `alerts`, `conflicts`, `pending`, `records`, `reports`, `settings`, `transfer`, `lab`) | **korumalı** |
| Admin | `/admin` | `DOĞRULANAMADI` (koruma middleware kapsamı dışında) |

> ⚠️ **`/admin` middleware kapsamında DEĞİL** — `matcher: ['/dashboard/:path*']`.
> Sayfanın kendi içinde koruma var mı **DOĞRULANAMADI**; §20'de risk olarak işaretli.

### 6.4 Süper-admin SPA (araç içi)

`src/admin/App.tsx` React Router ile: `/login` · `sa` · `health` · `fleet` ·
`flags` · `policies` · `rollout` · `audit` · `diagnostics` · `incidents` ·
`users` · `vehicles` · `tani` · `settings` · `superadmin` · `chaos`.
`SuperAdminGuard` bileşeni mevcut.

---

## 7. User Flows

### 7.1 Araç açılışı

```
Capacitor WebView
 → main.tsx → App.tsx
 → i18n dil senkronu · portrait uyarısı (tam ekran nav'da bastırılır)
 → MainLayout: BootSplash → 'show' fazı
 → SystemBoot: 55 alt sistem (worker'lar, OBD, GPS, Guardian, tema…)
 → AdaptiveRuntimeManager mod tespiti (4 kapı) → CSS token'ları
 → Ana ekran (NewHomeLayout) + DockBar
```

### 7.2 Araç ↔ hesap eşleştirme (**kanonik yol**)

```
Head unit: register_vehicle(device_id)
        → vehicles satırı + 6 haneli kod (5 dk geçerli)
        → cihaz api_key'i saklar (sensitiveKeyStore)
Kullanıcı: Filo panosu → "Araç Ekle" → 6 haneli kodu gir
        → POST /api/vehicle/link → pair_vehicle_to_user
        → vehicle_pairings satırı
```

> **Emekliye ayrılan yollar (bilinçli):** `/api/pwa/pair` **410 Gone** döner;
> `/api/vehicle/register` ve `/api/vehicle/code` `deprecatedPairingRoutes.ts`
> içinde kayıtlı. Gerekçe kodda yazılı: eski yol araca ait **ham `api_key`'i
> tarayıcıya döndürüyordu**.

### 7.3 Yolculuk → bulut → Driver DNA

```
Araç: tripLifecycle → tripUploadRuntime
 → upload_vehicle_trip(p_api_key, metrikler, provenance)
 → vehicle_trips satırı
 → _trip_attribution_trigger  (aktif atamadan sürücüyü belirler)
 → trg_driver_dna → _dna_apply_trip  (DNA birikir)
```

**Zincir 6 halkada uçtan uca kanıtlandı** (`supabase/tests/064`), ama
**üretimde hiç sürücü atanmamış** olduğu için 0 DNA satırı var (§11).

### 7.4 Uzak komut

```
Panel/PWA → sendCommand (oturumlu yol)
 → vehicle_commands satırı (nonce + TTL 5 dk + E2E şifreleme)
Araç: commandListener → fetch_pending_vehicle_commands (ÇEKME)
 → yürüt → update_command_status
```

**Kritik komutlarda** `verify_and_send_critical_command` + PIN
(`fn_enforce_critical_pin`) devrede. Ama üretimde
**`critical_pin_hash` dolu satır sayısı = 0** → PIN korumalı komut yolu hiç
kullanılmamış (§20 · RISK-05).

### 7.5 Çevrimdışı davranış

- **Harita:** MapLibre + `CacheLRUManager` (Cache Storage `caros-tiles-v1`),
  koridor koruması, `warmUrls`/`hasTile`
- **Rota:** `offlineRoutingService` → `routing-graph.bin` üzerinde A*
- **POI arama:** `offlineSearchService` → `poi.db` (sql.js, FTS5 **yok** →
  düz `LIKE` + mesafe sıralaması)
- **Yolculuk:** çevrimdışı kuyruk, ağ gelince yükleme (idempotans kanıtlı)
- **Servis worker:** `public/serviceWorker.js` (9,2 KB)

**Hesap silme / veri dışa aktarma akışları:** `accountCleanup` modülü mevcut
(website `src/security/accountCleanup/`), ama uçtan uca akış bu turda
**DOĞRULANAMADI**.

---

## 8. Navigation

### Araç uygulaması (durum makinesi — router yok)

```
App
└── LayoutProvider · SafetyProvider · ErrorBoundary
    └── MainLayout
        ├── NewHomeLayout            (ana ekran)
        ├── DockBar                  → setDrawer(DrawerType)
        ├── DrawerPanel              → 18 çekmeceden biri (lazy)
        ├── Tam ekran modlar         fullMap · split · rearCam · passenger
        └── Öncelikli kaplamalar     (z-index sırasıyla)
            ├── ReversePriorityOverlay   (geri vites — en üst)
            ├── SafetyOverlay / SafetyAnnouncer
            ├── RadarAlertHUD
            ├── GeofenceAlarmOverlay
            ├── SentryOverlay
            └── SleepOverlay
```

**Deep link:** `DOĞRULANAMADI` — Android manifest'te intent-filter incelenmedi.

### Website

```
middleware.ts  ── matcher: /dashboard/:path*
     │  oturum yoksa → /login?redirect=<yol>
     │  cleanup çerezi varsa → /login?security=cleanup
     ▼
(public)  /  /features  /enterprise  /contact          açık
(pwa)     /kumanda  /key-beam                          açık
auth      /login /register /forgot-password /reset-password /auth/hash-callback
dashboard /  map  vehicles  settings  notifications  diagnostic   [korumalı]
  └── fleet/  vehicles · vehicles/[id] · drivers · manage · members
              company · company-vehicles · alerts · conflicts · pending
              records · reports · settings · transfer · lab          [korumalı]
/admin                                                  [koruma DOĞRULANAMADI]
```

---

## 9. Components

**191 bileşen dosyası, 29 özellik klasörü.** Ortak/yeniden kullanılabilir
katman `src/components/common/` (16 dosya) ve website'te
`components/console/primitives` (`Panel`, `PanelHead`, `StatTile`,
`EmptyState`, `EvidenceBadge`, `TOKEN_COLOR`).

### Refactor adayları (satır sayısına göre)

| Dosya | Satır | Not |
|---|---|---|
| `platform/obdService.ts` | **3.391** | Servis; durum makinesi + poll + mock tek dosyada |
| `platform/companion/companionChatProvider.ts` | 2.876 | Sağlayıcı yönlendirme |
| `components/map/FullMapView.tsx` | **2.377** | Ekran bileşeni — en büyük UI dosyası |
| `platform/voiceService.ts` | 2.333 | |
| `components/settings/SettingsPage.tsx` | **2.199** | Tek dosyada tüm ayarlar |
| `components/map/NavigationHUD.tsx` | 2.120 | |
| `platform/map/MapLayerManager.ts` | 2.094 | |
| `website/lib/theme/themeManifest.ts` | 1.343 | |
| `website/components/pwa/RecordsPanel.tsx` | 1.049 | |

**Değerlendirme:** UI tarafında üç dosya (FullMapView, SettingsPage,
NavigationHUD) 2.000+ satır — bunlar bölünmeye en uygun adaylar. Ancak
**bölme riski yüksek**: FullMapView, kütükte kayıtlı çok sayıda saha
düzeltmesinin (kamera, gece haritası, rota kırpma) taşıyıcısı.

---

## 10. State Management

**12 Zustand store** (`src/store/`):

| Store | Sorumluluk |
|---|---|
| `useStore` | Ana ayarlar (dil, tema, hotspot, birim…) — **persist** |
| `useSystemStore` | Sistem durumu (geri vites, boot fazı) |
| `useCarTheme` | Aktif tema |
| `useLayoutStore` | Yerleşim profili |
| `useSafetyStore` | Güvenlik uyarı durumu |
| `useHazardStore` | Tehlike bildirimleri |
| `useCognitiveStore` | Bilişsel yük/öncelik |
| `useCommunityStore` | Topluluk olayları |
| `useExpertStore` | Uzman modu |
| `useVehicleIntelligenceStore` | Araç zekâsı |
| `useVidStore` | VID/tanı |
| `useAssistantContextStore` | Asistan bağlamı |

**Store DIŞI durum otoriteleri (önemli):**

- `UnifiedVehicleStore` (`platform/vehicleDataLayer/`) — canlı sinyal aynası;
  Zustand **değil**, modül durumu. Yanında **provenance defteri**
  (`vehicleProvenance.ts`) her sinyalin kaynağını ve yaşını tutar.
- `AdaptiveRuntimeManager` — çalışma zamanı modu ve görev zamanlaması.
- `signalHub` — tek otoriter sinyal okuma yüzeyi (`SignalEnvelope`).
- `sensitiveKeyStore` — cihaz API anahtarı (§17).

**Website:** Zustand ^4.5.7 (`store/vehicleStore` vb.) + Supabase istemcisi
sunucu durumu için. Ayrı bir server-state kütüphanesi (React Query vb.) **yok**.

---

## 11. Database / Data Model

**Üretimde 57 tablo · hepsinde RLS AÇIK.** Aşağıdaki sayılar üretim
veritabanından okunmuştur (2026-08-22).

### Çekirdek varlıklar

```
companies (id, name, created_at)
   └── profiles (id=auth.users.id, company_id, full_name, role, avatar_url)
   └── vehicles (28 kolon)
         ├── vehicle_pairings      (kullanıcı ↔ araç)
         ├── vehicle_users         (rol bazlı erişim)
         ├── vehicle_trips         (70 kolon — metrik + provenance)
         │     └── trip_driver_attribution_revisions
         ├── vehicle_locations     (rota noktaları)
         ├── vehicle_telemetry     (anlık durum)
         ├── vehicle_commands      (uzak komut, nonce+TTL)
         ├── vehicle_events
         ├── vehicle_identity      (VIN/parmak izi)
         ├── vehicle_geofences
         ├── vehicle_fuel_logs · vehicle_service_records
         ├── vehicle_ownership_transfers
         ├── vehicle_linking_codes (6 haneli, 5 dk)
         └── vehicle_push_tokens
   └── fleet_drivers
         ├── vehicle_driver_assignments  (vardiya = zamanlanmış atama)
         ├── vehicle_driver_presence (+ _history)
         ├── vehicle_driver_authentication
         ├── driver_dna (42 kolon) · driver_dna_trip
         └── fleet_driver_audit
   └── fleet_health · fleet_insight (+_evidence) · fleet_trend
   └── notifications · audit_logs · telemetry_events · command_logs
   └── company_api_keys · company_api_usage      (dış REST API, v1)
   └── report_schedules                          (zamanlanmış rapor)
```

**Yatay sistemler:** `ai_evidence` (+`_chain`, `_retry`, `_adapter_state`) ·
`mavi_reasoning` (+4 tablo) · `ai_gateway_access` / `_audit` ·
`feature_flags` · `runtime_policies` · `rollout_plans` · `ota_releases` ·
`retention_policy` · `key_beams` · `support_reader_secret`.

### Üretim veri hacmi (2026-08-22)

| Varlık | Satır |
|---|---|
| Kullanıcı (`profiles`) | **2** |
| Şirket | **1** |
| Araç | **838** |
| Yolculuk | 34 |
| Konum | 1.905 |
| Komut | 17 |
| Eşleşme | 1 |
| Sürücü | **0** |
| Bildirim | **0** |
| Driver DNA | **0** |

### ⚠️ Veri modeli borçları (ölçülmüş)

1. **837/838 araç sahipsiz** — `company_id` NULL **ve** `owner_id` NULL.
   822 tekil `device_name`. `register_vehicle` her cihaz kaydında satır açıyor
   ve **hiçbir temizlik yok**.
2. **`last_seen` hiçbir satırda dolu değil** (838/838 NULL) — 7 SQL fonksiyonu
   bu kolona yazıyor ama üretimde tetiklenmemiş. Panelde "son görülme"
   gösteren her yer boş kalır.
3. **Kolon ikizleri:** `plate`(1 dolu) ↔ `license_plate`(0);
   `odometer_km`(838) ↔ `current_km`(838). Hangisinin otorite olduğu
   **DOĞRULANAMADI**.
4. **`vin` 0 satırda dolu** — VIN tabanlı özellikler üretimde hiç beslenmemiş.
5. **`critical_pin_hash` 0 satırda dolu** — PIN korumalı komut yolu hiç
   kullanılmamış.

---

## 12. Backend / API

### 12.1 Next.js API rotaları (22)

| Metot | Uç | Amaç | Kimlik | Kullanan |
|---|---|---|---|---|
| POST | `/api/auth/logout` | Oturum kapat | çerez | Panel |
| POST | `/api/auth/revoke-session` | Oturum iptali | çerez | Güvenlik akışı |
| GET/POST/PATCH/DELETE | `/api/company` | Şirket CRUD | çerez | Filo ayarları |
| GET/POST | `/api/company/members` | Üye listesi/ekleme | çerez | `fleet/members` |
| PATCH/DELETE | `/api/company/members/[userId]` | Rol/çıkarma | çerez | `fleet/members` |
| GET | `/api/company/vehicles` | Şirket araçları | çerez | `fleet/company-vehicles` |
| POST | `/api/company/vehicles/assign` · `/remove` | Araç–şirket bağı | çerez | aynı |
| GET | `/api/vehicles` · PATCH/DELETE `/api/vehicles/[id]` | Araç CRUD | çerez | Panel |
| POST | `/api/vehicle/link` | **6 haneli kodla eşleştirme (kanonik)** | çerez | "Araç Ekle" |
| GET/POST/PATCH/DELETE | `/api/vehicle/transfer` | Sahiplik devri | çerez | `fleet/transfer` |
| POST | `/api/vehicle/class-lookup` | Araç sınıfı sorgusu | çerez + dış anahtar | Araç sınıfı ayarı |
| POST | `/api/vehicle/update` | Araç güncelle | **api_key (KIRIK — §23)** | referans yok |
| POST | `/api/vehicle/register` · `/api/vehicle/code` | **EMEKLİ** | — | `deprecatedPairingRoutes` |
| POST/GET | `/api/pwa/pair` | **410 Gone** | — | — |
| POST | `/api/pwa/command` | Oturumsuz komut | **api_key (KIRIK)** | çağıranı yok |
| GET | `/api/pwa/dtc-result` | DTC sonucu | **api_key (KIRIK)** | `DiagnosticsPanel` |
| POST | `/api/tts` | Edge Neural TTS vekili | — | Araç `edgeTtsService` |
| GET | **`/api/v1/vehicles`** | Dış müşteri API | **Bearer + kapsam + hız sınırı** | müşteri sistemi |
| GET | **`/api/v1/trips`** | Dış müşteri API | aynı | müşteri sistemi |

### 12.2 Supabase RPC yüzeyi

**101 açık RPC · 151 SECURITY DEFINER fonksiyon.** Öne çıkanlar:

- **Cihaz (api_key ile):** `upload_vehicle_trip` · `fetch_pending_vehicle_commands`
  · `update_command_status` · `get_active_driver_assignment` · `push_vehicle_event`
  · `get_geofence_zones` · `register_vehicle` · `refresh_linking_code`
- **Kullanıcı (JWT ile):** `pair_vehicle_to_user` · `list_vehicle_trips` ·
  `list_company_vehicles` · `create_fleet_driver` ·
  `create_vehicle_driver_assignment` · `get_driver_dna` · `get_fleet_intelligence`
  · `start_vehicle_transfer` · `set_vehicle_pin` · `verify_and_send_critical_command`
- **Zamanlanmış (service_role):** `cleanup_old_telemetry` ·
  `run_report_schedules` · `run_mavi_reasoning_scheduler` · `expire_stale_commands`

### 12.3 pg_cron işleri (üretimde aktif)

| Zamanlama | Komut |
|---|---|
| `0 3 * * *` | `cleanup_old_telemetry()` — saklama politikası |
| `* * * * *` | `run_mavi_reasoning_scheduler(100,'CRON')` |
| `0 * * * *` | `run_report_schedules()` — zamanlanmış rapor |

### 12.4 RPC sözleşmesinin sinsi yanı

**Filo RPC'leri hata FIRLATMAZ; `{state:'REJECTED', reason:…}` DÖNER.**
Dönüş okunmazsa çağrı başarılı sanılır ve veri hiç yazılmaz. Sözleşme baştan
sona **camelCase**: `driverId` · `assignmentId` · `distanceKm` ·
`harshBrakeCount`. Atama tipi **BÜYÜK HARF** (`PRIMARY`/`TEMPORARY`/`MANUAL`).
Kabul durumları `CREATED`/`UPDATED`.

---

## 13. Authentication & Authorization

### İki ayrı kimlik dünyası

| | **Kullanıcı** | **Cihaz (araç)** |
|---|---|---|
| Mekanizma | Supabase Auth (JWT, çerez) | `p_api_key` gövde parametresi |
| Saklama | httpOnly çerez (SSR istemcisi) | `sensitiveKeyStore` (cihazda) |
| Koruma | `middleware.ts` → `/dashboard/*` | RPC içinde satır eşleşmesi |
| Yetki | `profiles.role` + RLS + `auth_company_id()` | araç satırının kendisi |

### Kullanıcı akışı

`/register` → Supabase signUp → `handle_new_user` tetikleyicisi `profiles`
satırı açar → `/login` → çerez → `middleware` korumalı rotaları açar →
`/api/auth/logout`.

**Roller (`profiles.role` CHECK):** `individual · member · observer · admin ·
super_admin`. **`owner` GEÇERLİ BİR ROL DEĞİLDİR** — araç sahipliği ayrı
kavramdır (`vehicles.owner_id`). Üretimde 2 profil, ikisi de `admin`.

### Cihaz akışı ve **doğrulama mantığı**

```sql
-- upload_vehicle_trip
SELECT id INTO v_vehicle_id FROM vehicles
 WHERE coalesce(api_key_hash, api_key) = p_api_key;
```

Yani cihaz **sakladığı değerin aynısını** gönderir ve sunucu onu **düz
karşılaştırır**. `register_vehicle` bu değeri şöyle üretir:

```sql
v_api_key := gen_random_uuid()::text;
INSERT INTO vehicles (name, device_name, api_key_hash) VALUES (…, v_api_key);
RETURN jsonb_build_object(…, 'api_key', v_api_key, …);
```

→ **`api_key_hash` kolonu bir hash TUTMAZ; düz metin bearer secret tutar.**
Ölçüm bunu doğruladı: 834 satırın **834'ü UUID biçimli, 0'ı SHA-256 biçimli**.

### RLS durumu

57 tablonun **57'sinde RLS açık**. Üretimde `anon` rolüne açık `USING(true)`
policy'si yalnız **3 tabloda**: `feature_flags` · `runtime_policies` ·
`ota_releases` (cihazın açılışta okuması gerekenler). Diğer tüm `{public}`
policy'leri kimliğe bağlı (`auth.uid()` / `auth_company_id()`).

**Ölçülmüş kanıt:** üretimde gerçek `anon` rolüyle koşulan probe →
**izinsiz maruziyet = 0**. Satırı olan ve kanıtlanmış şekilde kapalı 8 tablo:
`vehicles` · `vehicle_locations` · `vehicle_telemetry` · `vehicle_commands` ·
`vehicle_events` · `vehicle_pairings` · `vehicle_linking_codes` · `audit_logs`.
(`npm run test:rls:prod`)

> **Ama dikkat:** 9–10 tablo üretimde **BOŞ** olduğu için korumaları
> **kanıtlanamadı** — probe bunları `kanitlanamadi` olarak ayrı sayar,
> "geçti" saymaz.

---

## 14. Vehicle Features

Aşağıdaki özelliklerin **hepsi kodda mevcuttur** ve dosya karşılığı verilmiştir.
"Var" demek "üretimde doğrulandı" demek **değildir** — doğrulama durumu §22'de.

| Özellik | Kod karşılığı | Not |
|---|---|---|
| Araç ekleme / eşleştirme | `register_vehicle` → `/api/vehicle/link` | 6 haneli kod, 5 dk |
| Marka / model / yıl | `vehicles.brand/model/year` | üretimde seyrek dolu |
| Plaka | `vehicles.plate` | üretimde **1** satır dolu |
| VIN | `vehicles.vin` · `vehicle_identity` | üretimde **0** dolu |
| Kilometre | `odometer_km` + `current_km` | **iki kolon**, otorite belirsiz |
| Yakıt | `fuelAdvisorService.ts` (354) · `vehicle_fuel_logs` | tüketim ÖLÇÜLMÜYOR (ESTIMATED) |
| Bakım / servis | `maintenanceBrain.ts` (398) · `vehicle_service_records` | |
| Arıza (DTC) | `platform/obd/` · `DTCPanel` | UDS 0x19 + KWP 0x18 |
| OBD canlı veri | `obdService.ts` (3.391) | ELM327 BLE/SPP |
| Çoklu-ECU tarama | `platform/obd/multiEcuScan.ts` | ABS/airbag/şanzıman dahil |
| Harcamalar / maliyet | `trip/cost/` · `fuelCostModel.ts` | fiyat **DEFAULT_FALLBACK** |
| Hatırlatıcılar | `vehicle-reminder` çekmecesi | |
| Lokasyon / rota | `gpsService` · `vehicle_locations` | 30 gün saklama |
| Yolculuk | `trip/` (32 dosya) · `vehicle_trips` (70 kolon) | 90 gün saklama |
| AI araç analizi | `platform/ai/mechanic/` · `ai_evidence` | |
| Coğrafi çit | `security/geofenceService.ts` · `vehicle_geofences` | |
| Uzak komut | `commandListener.ts` · `vehicle_commands` | ÇEKME modeli |
| Sürücü kimliği | `vehicle_driver_authentication` · `_presence` | |
| Driver DNA | `driver_dna` (42 kolon) · `get_driver_dna` | üretimde **0 satır** |
| Vardiya | `vehicle_driver_assignments` + `shiftView.ts` | vardiya = zamanlanmış atama |
| Sahiplik devri | `vehicle_ownership_transfers` + 5 RPC | |
| Fotoğraf / belge saklama | **BULUNAMADI** | — |
| Araç değeri | **BULUNAMADI** | — |
| Sigorta / kasko / muayene / vergi | yalnız `vehicles.ins_expiry` | tam modül **YOK** |
| Lastik | **BULUNAMADI** | — |

> **Not:** "Fotoğraf, belge, araç değeri, lastik, kasko" gibi klasik
> araç-defteri özellikleri bu üründe **yoktur**. Ürün defter değil,
> **teşhis + filo** yönündedir.

---

## 15. Business Logic

### 15.1 Yolculuk kanonik modeli — `trip/tripCanonicalModel.ts`

Her metrik bir **`Metric`** nesnesidir: `{value, source}`; `MetricSource`
`MEASURED | DERIVED | ESTIMATED | UNAVAILABLE` olabilir.
`deriveTripConfidence()` yolculuk güvenini **en zayıf girdiden** türetir.
`buildTripKey()` idempotans anahtarını üretir — çevrimdışı kuyruk aynı
yolculuğu yeniden gönderdiğinde satır **çoğalmaz** (064 matrisi kanıtlıyor).

### 15.2 Driver DNA — sunucuda birikir

`_dna_apply_trip(dna_id, trip, dir)` her yolculukta toplamları günceller;
`_dna_learning_level(trip_count)` ve `_dna_status(trip_count, distance)`
öğrenme olgunluğunu verir. **Eşik altında DNA üretilmez.**
`brake_measured_only` gibi bayraklar hangi toplamın ölçüme dayandığını taşır.

**Kural:** DNA **cihazda hesaplanmaz** — `accumulateTrip()`/`buildDna()`
head unit'te çağrılmaz. İkinci hesap ikinci otorite olurdu.

### 15.3 Sürücü skoru — `website/src/lib/fleet/driverScore.ts`

Girdi `DriverDnaView` (ham satır değil). Bileşenler ve **açık eşikler**:

| Bileşen | İyi ≤ | Kötü ≥ | Ağırlık |
|---|---|---|---|
| Sert fren | 0,5 /100 km | 8 | %35 |
| Sert hızlanma | 0,5 /100 km | 8 | %35 |
| Rölanti payı | 0,05 | 0,40 | %30 |

**Kenar durumlar (kilitli):** kanıt yoksa skor **üretilmez**
(`NO_DNA · LEARNING · NO_MEASURES · RETRACTED`); eksik bileşen **0 da ortalama
da sayılmaz** — ağırlıklar elde olanlar üzerinden normalize edilir; `NaN`
**0 puan** alır (aksi hâlde ölçülemeyen sürücü tam puan alırdı).

### 15.4 Yakıt maliyeti — `website/src/lib/console/fuelCostModel.ts`

Kural: **toplam, en zayıf girdisi kadar güçlüdür.** Varsayılan fiyat, ölçülmüş
tüketimi bile aşağı çeker. Mesafe yoksa **veya 0 ise** 100 km oranı üretilmez
(`Infinity` de `0` da yalan olurdu).

**Üretim gerçeği:** 34 yolculuğun **34'ünde** `fuel_source = ESTIMATED` ve
`price_source = DEFAULT_FALLBACK` (45,00 TL/L). Yani bugünkü her tutar
"ölçülmüş mesafe × tahmini tüketim × varsayılan fiyat"tır ve ekranda
**VARSAYILAN FİYAT** rozetiyle gösterilir.

### 15.5 Saklama politikası — `retention_policy` tablosu

| Tablo | Gün | Gerekçe |
|---|---|---|
| `vehicle_trips` | **90** | Enterprise vaadi; yolculuk başına ~4 kB |
| `vehicle_locations` | **30** | ölçülen ~0,27 MB/gün/araç → 90 gün 100 araçta ~2,4 GB |
| `telemetry_events` | 90 | |
| `vehicle_commands` · `command_logs` | 14 | yalnız TERMİNAL durumlar silinir |
| `company_api_usage` | 30 | |

**SÜREN yolculuk (`ended_at IS NULL`) asla silinmez.** Silme güvenliği önce
ölçüldü: `vehicle_trips` üzerindeki dört tetikleyicinin hepsi
`AFTER INSERT OR UPDATE` — DELETE'te tetiklenmiyor, yani eski yolculuk silmek
Driver DNA'yı geri almaz.

### 15.6 Zamanlanmış rapor idempotansı

pg_cron **saatte bir** koşar. Vade **dönem sınırına** göre hesaplanır
(`_report_schedule_due`); aksi hâlde günlük rapor 06:00 sonrası **her saat**
gönderilirdi (günde ~18 bildirim). Teslim yolu yoksa `last_run_at`
**ilerletilmez** — teslim edilmemiş rapor "gönderildi" sayılmaz.

### 15.7 Çalışma zamanı mod kapıları

`firstBlockingModeGate()` **kısa devre** yapar (üretim);
`traceModeGates()` **tümünü** değerlendirir (LAB).
`softwareFixWouldUnlock()` ancak **donanım engeli kalmadıysa** `true` döner —
"bir kapıyı düzeltirsek açılır" yanılsamasının panzehiri.

---

## 16. External Services

| Servis | Amaç | Dosya | Anahtar | Risk |
|---|---|---|---|---|
| **Supabase** | Auth + DB + RPC + Realtime | 8 | `anon` + `service_role` | `service_role` sızarsa **tam erişim** |
| **OpenStreetMap / Nominatim** | Karo, jeokodlama | 23 / 14 | yok | **ODbL atıfı zorunlu** |
| **Overpass** | POI / radar sorgusu | 10 | yok | kamu sunucusu, hız sınırı |
| **OpenRouter** | AI yönlendirme | 37 | **BYOK** | kullanıcı anahtarı |
| **Anthropic (Claude)** | AI | 28 | **BYOK** | |
| **Google Gemini** | AI | 7 | **BYOK** | |
| **Groq** | AI | 6 | **BYOK** | |
| **Vosk** | Çevrimdışı STT | 11 | yok | Apache-2.0 ✅ |
| **Edge Neural TTS** | TR seslendirme | 1 + `/api/tts` vekili | yok | `carospro.com` vekiline bağımlı |
| **Spotify** | Müzik | 54 | `DOĞRULANAMADI` | |
| **YouTube** | Medya | 40 | — | COEP açılırsa **kırılır** (ADR 0005) |
| **HERE / TomTom** | Trafik / harita | 1 / 2 | `VITE_HERE_API_KEY`, `VITE_TOMTOM_API_KEY` | **istemci paketinde görünür** |
| **open-meteo** | Hava durumu | 1 | yok | |

> ⚠️ `VITE_*` ile başlayan her değer istemci paketine gömülür.
> `VITE_HERE_API_KEY` ve `VITE_TOMTOM_API_KEY` bu yüzden APK'dan
> **çıkarılabilir** (§20 · RISK-04).

**Lisans:** `license-check.yml` hem kök hem website için CI'da koşuyor.
Vosk Apache-2.0 · MapLibre BSD · Capacitor/React/Zustand/Tailwind/Lucide MIT —
hepsi ticari satışa uygun. Çevrimdışı veri paketlerinin yanında
`public/maps/*.license.txt` mevcut.

---

## 17. Environment & Secrets

### Araç uygulaması (`import.meta.env`)

`VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` · `VITE_APP_VERSION` ·
`VITE_APP_VERSION_CODE` · `VITE_GIT_REVISION` · `VITE_EDGE_TTS_URL` ·
`VITE_KEY_BEAM_URL` · `VITE_HERE_API_KEY` · `VITE_TOMTOM_API_KEY` ·
`VITE_ENABLE_DEBUG_PANEL` · `VITE_ENABLE_INSPECTOR` · `VITE_ENABLE_YT_DOWNLOAD`

### Website (`process.env`)

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` ·
`NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_ADMIN_PANEL_ORIGIN` ·
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` · `NEXT_PUBLIC_APP_VERSION` ·
**`SUPABASE_SERVICE_ROLE_KEY`** (sunucu) ·
`VEHICLE_CLASS_LOOKUP_URL` / `_KEY` (sunucu)

### Hijyen değerlendirmesi

- ✅ **Repoda commit edilmiş secret YOK.** `git ls-files | grep .env` yalnız
  `.env.example` ve `website/.env.local.example` döndürüyor.
- ✅ **Kodda gömülü sağlayıcı anahtarı YOK** — `sk-ant…`, `AIza…` desenleri
  yalnız **doğrulama regex'i** ve **placeholder** (`credentialRegistry.ts`,
  `keyBeamCrypto.ts`).
- ✅ **BYOK**: AI sağlayıcı anahtarları kullanıcıdan alınır, gömülmez.
- ⚠️ `VITE_HERE_API_KEY` / `VITE_TOMTOM_API_KEY` istemci paketine gömülür —
  korunma **sağlayıcı tarafında** olmalı.
- ⚠️ Cihaz API anahtarı `sensitiveKeyStore` ile saklanıyor; şifreleme seviyesi
  (Android Keystore mi, düz depolama mı) **DOĞRULANAMADI**.

---

## 18. Error / Offline Handling

### Ölçülen desen

| Gösterge | Değer |
|---|---|
| `catch` bloğu (`src`) | **2.502** |
| Yorumsuz boş `catch {}` | **1** |
| `ErrorBoundary` kullanan dosya | 4 |
| `useEffect` | 333 |
| `return () => …` (temizlik) | 203 |
| `mountedRef` kullanan dosya | 76 |

**Değerlendirme:** hata yakalama yoğun ve **sessiz yutma neredeyse yok**.
Zero-leak disiplini 76 dosyada uygulanmış.

### Üç ayrı "yok" ayrımı — projenin imza deseni

Kod boyunca tekrarlanan kural: **"okunamadı" ≠ "veri yok" ≠ "ölçülemedi"**.

- `fuelCostModel`: `UNREADABLE · NO_TRIPS · NO_COST_INPUT`
- `shiftView`: `UNREADABLE · NO_SHIFTS · OK` + `unassignedTripCount: null`
- `provenanceModel`: `AKIYOR · BAYAT · HİÇ YAZILMADI`
- RLS probe: `DENIED · EXPOSED · **UNPROVEN**` (boş tablo "geçti" sayılmaz)

### Çevrimdışı

- **Harita:** `CacheLRUManager` (Cache Storage `caros-tiles-v1`), koridor koruması
- **Rota:** `routing-graph.bin` üzerinde A* — ağ gerekmez
- **POI:** `poi.db` (sql.js) — **FTS5 yok**, düz `LIKE` + mesafe sıralaması
- **Yolculuk:** çevrimdışı kuyruk + idempotan yükleme
- **Servis worker:** `public/serviceWorker.js` (9,2 KB)

**Eksik:** website panelinde çevrimdışı çalışma yok (SSR + korumalı rotalar).
PWA (`/kumanda`) kısmen çalışır — `DOĞRULANAMADI`.

---

## 19. Performance

| # | Risk | Seviye | Kanıt |
|---|---|---|---|
| P-1 | `obdService.ts` **3.391 satır** — durum makinesi + poll + mock tek dosyada | **YÜKSEK** | ölçüldü |
| P-2 | `FullMapView.tsx` **2.377 satır** — WebGL + rota + HUD tek bileşende | **YÜKSEK** | ölçüldü |
| P-3 | Vardiya panosu araç **başına bir** trip çağrısı (N+1) | ORTA | tavan 25; kapsam eksikliği ekranda yazılı |
| P-4 | `/api/v1/trips` önce araçları çekip `.in(...)` uyguluyor | ORTA | büyük filoda `IN` listesi şişer |
| P-5 | `vehicle_locations` araç başına ~476 satır/gün | ORTA | ölçüldü; 30 gün ≈ 8 MB/araç |
| P-6 | Paket boyutu / `manualChunks` etkisi | **DOĞRULANAMADI** | build çıktısı ölçülmedi |
| P-7 | Zamana duyarlı testler paralel yükte düşüyor | DÜŞÜK | `testTimeout` 5→20 sn; bütçe testi bilinçli hassas |

**Olumlu:** `AdaptiveRuntimeManager` tüm periyodik işi **tek 3 Hz tik**
üzerinden yürütür; her görev `periodMs` + `criticality` bildirir. Bu, "her
modül kendi `setInterval`'ini kurar" hatasını sistematik olarak engeller.
V8 disiplini (hidden-class kararlılığı, tahsissiz hot-path) `vehicleProvenance.ts`
gibi dosyalarda uygulanmış ve **testle kilitli**.

---

## 20. Security Audit

### RISK-01 — `api_key_hash` düz metin taşıyor

- **SEVİYE:** 🔴 **KRİTİK**
- **DOSYA:** `register_vehicle` (SQL) · `vehicles.api_key_hash`
- **PROBLEM:** Kolon adı "hash" ama içerik `gen_random_uuid()::text` —
  **düz metin bearer secret**. Ölçüm: **834/834 satır UUID biçimli, SHA-256
  biçimli 0**. Doğrulama `coalesce(api_key_hash, api_key) = p_api_key` ile
  **düz karşılaştırma**.
- **SALDIRI SENARYOSU:** Veritabanı yedeği, `service_role` sızıntısı ya da
  yanlış kapsamlı bir policy → saldırgan 834 aracın cihaz kimliğini
  **doğrudan** ele geçirir: sahte telemetri yazabilir, komut kuyruğunu
  okuyabilir, atama bilgisini çekebilir.
- **ÇÖZÜM:** Cihaz ham anahtarı saklasın, sunucu **yalnız SHA-256** saklasın,
  doğrulama `encode(sha256(p_api_key::bytea),'hex') = api_key_hash` olsun.
  Geçiş için **çift-okuma penceresi** + zorunlu yeniden kayıt.

### RISK-02 — 837 sahipsiz araç satırı, her biri kimlik taşıyor

- **SEVİYE:** 🔴 **YÜKSEK**
- **PROBLEM:** 838 satırın 837'sinde `company_id` **ve** `owner_id` NULL;
  822 tekil `device_name`. `register_vehicle` her çağrıda satır açıyor,
  **temizlik yok**. Saldırı yüzeyi ve gürültü birlikte büyüyor.
- **ÇÖZÜM:** Eşleşmemiş ve N gündür telemetri göndermemiş kayıtları
  `retention_policy`'ye bağla; `register_vehicle`'a hız sınırı ekle.

### RISK-03 — `/admin` middleware kapsamı dışında

- **SEVİYE:** 🟠 ORTA (`DOĞRULANAMADI` — sayfa içi koruma olabilir)
- **DOSYA:** `website/src/middleware.ts` → `matcher: ['/dashboard/:path*']`
- **ÇÖZÜM:** `/admin`'i matcher'a ekle ya da sayfa içi korumayı doğrula ve belgele.

### RISK-04 — İstemciye gömülü harita/trafik anahtarları

- **SEVİYE:** 🟠 ORTA
- **PROBLEM:** `VITE_HERE_API_KEY` · `VITE_TOMTOM_API_KEY` APK'dan çıkarılabilir.
- **ÇÖZÜM:** Sağlayıcı panelinde alan/paket kısıtı + kota alarmı; ya da sunucu
  vekili (`/api/tts` deseni).

### RISK-05 — Kritik komut PIN'i hiç kullanılmamış

- **SEVİYE:** 🟠 ORTA
- **PROBLEM:** `critical_pin_hash` üretimde **0 satırda** dolu. `set_vehicle_pin`
  ve `verify_and_send_critical_command` mevcut ama devrede değil.
- **DOĞRULANAMADI:** PIN yokken kritik komutun reddedilip reddedilmediği ölçülmedi.
- **ÇÖZÜM:** PIN yokken kritik komutu **fail-closed** reddet; kuruluma PIN adımı ekle.

### RISK-06 — `service_role` anahtarının yüzeyi

- **SEVİYE:** 🟠 ORTA
- **PROBLEM:** `SUPABASE_SERVICE_ROLE_KEY` çok sayıda API rotasında
  `createClient(...)` ile kullanılıyor. Tek bir kapsam hatası → RLS'i
  **tamamen** atlayan erişim.
- **ÇÖZÜM:** Rota başına en dar sorgu; mümkün olanı `SECURITY DEFINER` RPC'ye
  taşı (v1 API'de bu desen zaten uygulanmış).

### Olumlu bulgular (kanıtlı)

- ✅ **57/57 tabloda RLS açık**; üretimde `anon` maruziyeti **ölçülerek 0**.
- ✅ Repoda commit edilmiş secret **yok**; kodda gömülü sağlayıcı anahtarı **yok**.
- ✅ Dış REST API (v1): anahtar **hash'lenerek** saklanır, ham değer **bir kez**
  döner, geçersiz ile iptal edilmiş anahtar **aynı** cevabı alır (varlık
  oracle'ı yok), hız sınırı **atomik**, kapsam **beyaz liste**, yazma kapsamı yok.
- ✅ Uzak komut **ÇEKME** modeli (araç dışarıdan bağlantı kabul etmez),
  nonce + TTL + E2E şifreleme.
- ✅ Release build'de ProGuard + `shrinkResources`;
  `webContentsDebuggingEnabled` yalnız dev'de.
- ✅ CodeQL statik güvenlik taraması CI'da.

---

## 21. Privacy & Store Compliance

### Toplanan veri (koddan doğrulanan)

| Veri | Nerede | Hassasiyet |
|---|---|---|
| E-posta, ad | `auth.users`, `profiles` | kişisel |
| **Konum (arka plan dahil)** | `vehicle_locations` · `ACCESS_BACKGROUND_LOCATION` | **yüksek** |
| Araç kimliği (VIN, plaka) | `vehicles`, `vehicle_identity` | kişisel sayılabilir |
| Sürüş davranışı | `vehicle_trips`, `driver_dna` | **yüksek** |
| Ses | `RECORD_AUDIO` + Vosk | **yüksek** |
| Kamera / dashcam | `CAMERA` | **yüksek** |
| Rehber | `READ_CONTACTS` | kişisel |
| Cihaz kimliği | `vehicles.device_name/device_id` | |
| Bildirim jetonu | `vehicle_push_tokens` | |

### Değerlendirme

- **Gizlilik politikası:** `src/components/settings/PrivacyPolicy.tsx` **var**.
- **Hesap silme:** `accountCleanup` modülü **var**; uçtan uca akış `DOĞRULANAMADI`.
- **Veri dışa aktarma (taşınabilirlik):** **BULUNAMADI** — kullanıcının kendi
  verisini indirebileceği bir uç yok. (Filo raporu *yönetici* aracıdır.)
- **Arka plan konumu:** Google Play için **ayrı gerekçe formu + video** zorunlu;
  en yüksek riskli izin budur.
- **`MANAGE_EXTERNAL_STORAGE`:** Play'de özel izin gerektirir, çoğu başvuruda
  reddedilir. Gerçekten gerekli mi sorgulanmalı.
- **`REQUEST_INSTALL_PACKAGES`:** OTA için olabilir; Play politikası açısından
  yüksek riskli.
- **Sürüş skoru** çalışan performansını etkileyebilir → KVKK açısından
  **açık rıza + şeffaflık** gerekir. Kodun "eşikler açık, skor asla yalnız
  gösterilmez" tasarımı bu açıdan **doğru yönde**.

> Bu bölüm hukuki görüş değildir; teknik uyumluluk değerlendirmesidir.

---

## 22. Testing

| Katman | Kapsam | Sonuç |
|---|---|---|
| Kök (Vitest) | **606 dosya** | **13.139 test — YEŞİL** |
| Website (Vitest) | **69 dosya** | **1.418 test — YEŞİL** |
| Gerçek PostgreSQL matrisi | **12 dosya** (057–067) | koşulan 5'i **YEŞİL** |
| Java birim (Gradle) | **26 dosya** | CI kapısı (`main.yml`) |
| E2E (Playwright) | **8 spec** | yalnız **tarayıcı demo modu** |
| Lint + `tsc -b` | tüm depo | **temiz** |

### SQL matrisleri

| Komut | Kapsam |
|---|---|
| `npm run test:rls` | RLS maruziyeti — 4 kapı |
| `npm run test:rls:prod` | **üretimde** anon maruziyeti |
| `npm run test:dna` | Driver DNA zinciri — 6 halka |
| `npm run test:retention` | Saklama politikası — 4 halka |
| `npm run test:apikey` | Şirket API anahtarı — 6 halka |
| `npm run test:schedule` | Zamanlanmış rapor — 7 halka |

### Boşluklar

- ❌ **E2E gerçek APK'ya karşı koşmuyor** — `playwright.config.ts` `npm run dev`
  ve `localhost:5173` kullanıyor; native köprünün olmadığı bir dünyayı test ediyor.
- ❌ **Gerçek araç doğrulaması:** kütükte **537 madde 🔴**.
- ⚠️ Duvar-saati bütçe testleri yük altında düşebilir (bilinçli hassas).

### RELEASE QA CHECKLIST (manuel, gerçek araçta)

1. Açılış → 55 alt sistem hatasız mı (`adb logcat`)
2. OBD dongle → hız/devir/coolant akıyor mu; **tarama sonrası akış kesilmiyor mu**
3. DTC → çoklu-ECU listesi geliyor mu; KWP aracında `1800FF00` görülüyor mu
4. Navigasyon → **ağı kapat**, rota hâlâ hesaplanıyor mu
5. POI arama → ağsız Türkçe arama (`ı/İ/ş/ğ`) sonuç veriyor mu
6. Geri vites → kaplama **her şeyin üstünde** açılıyor mu
7. Yolculuk → buluta gitti mi; **uçak modunda tekrar gönder, satır ÇOĞALMIYOR mu**
8. Sürücü ata → yeni yolculukta `driver_attribution_status ≠ UNKNOWN` mu
9. Uzak komut → yürüyor mu; **PIN'li komut PIN'siz reddediliyor mu**
10. Gece modu → gerçek ekranda okunabilir mi (`adb screencap` ile doğrula)
11. Sesli komut → Vosk çevrimdışı tanıyor mu; korunan eylem kapısı çalışıyor mu
12. CAROS LAB → **Mod Kapıları** hangi kapının engellediğini doğru söylüyor mu

---

## 23. Bugs

### BUG-001 — Üç rota asla eşleşemeyecek doğrulama yapıyor

- **Önem:** **Yüksek** (bugün gizli; yeniden açılırsa sessiz kırılma)
- **Dosya:** `api/pwa/command/route.ts:56` · `api/pwa/dtc-result/route.ts:79` ·
  `api/vehicle/update/route.ts:38`
- **Problem:** `verifyApiKey(rawKey, api_key_hash)` = `sha256(rawKey)` ile
  karşılaştırıyor; kolon **düz UUID** tutuyor → **hiçbir zaman eşleşmez**.
- **Etkisi:** Bu yollar **401** döner.
- **Neden bugün ürünü kırmıyor:** `/api/pwa/pair` **410 Gone**;
  `getStoredApiKey()` kanonik akışta anahtar döndürmüyor
  (`pairingService.ts:100` yorumu açıkça söylüyor) → `DiagnosticsPanel`
  isteği `Authorization` başlığı olmadan gider ve **400** alır.
  `sendCommandWithApiKey`'in **çağıranı yok**.
- **Nasıl tetiklenir:** Oturumsuz PWA yolu yeniden açılırsa **anında sessiz 401**.
- **Çözüm:** RISK-01 ile **birlikte** çözülmeli. İki otoriteyi bir arada bırakma.

### BUG-002 — `last_seen` hiçbir satırda yazılmıyor

- **Önem:** Orta · **Problem:** 838/838 NULL; 7 SQL fonksiyonu bu kolona
  yazıyor ama üretimde tetiklenmemiş. **Etkisi:** panelde "son görülme" boş.
- **DOĞRULANAMADI:** Hangi yazma yolunun tetiklenmediği izlenmedi.

### BUG-003 — Kolon ikizleri veri bütünlüğünü belirsizleştiriyor

- **Önem:** Orta · `plate`(1) ↔ `license_plate`(0);
  `odometer_km`(838) ↔ `current_km`(838). Otorite belirsiz.

### BUG-004 — Website testleri CI'da koşmuyordu → **DÜZELTİLDİ**

- `website.yml`'ye `Vitest (website)` işi eklendi; gerçek runner'da
  yeşil → mutasyonda kırmızı → düzeltmede yeşil kanıtlandı (kütük #713).

---

## 24. Technical Debt

| # | Borç | Etki |
|---|---|---|
| TD-1 | **İki migration zinciri** — `telemetry_events`, `command_logs`, `notifications`, `route_commands` prod'da var **yerelde yok**; `vehicle_commands.updated_at` yerelde yok | Yerelde geçen test prod'da farklı davranır; SQL fonksiyonları savunmalı yazılmak zorunda |
| TD-2 | `obdService.ts` 3.391 · `FullMapView.tsx` 2.377 · `SettingsPage.tsx` 2.199 satır | Değişiklik riski yüksek |
| TD-3 | Kök React 19 / website React 18; Tailwind 4 / 3 | Kod paylaşımı imkânsız |
| TD-4 | E2E yalnız tarayıcı demo modunu test ediyor | Native köprü kapsamsız |
| TD-5 | 62 LAB aracının 2'si `PLACEHOLDER` | Katalog gerçeği tam yansıtmıyor |
| TD-6 | `poi.db` FTS5 **yok** → `LIKE` taraması | Büyük veri kümesinde yavaşlar |
| TD-7 | Website'te server-state kütüphanesi yok | Önbellek/yeniden doğrulama elle |
| TD-8 | `docs/` altında **140 belge** | Güncellik ancak kütükten anlaşılıyor |

---

## 25. Incomplete Features

> Bu depoda "yarım bırakılmış" işaretler **çok azdır**: **1 `TODO`,
> 0 `FIXME`, 0 `HACK`**. Eksikler `docs/DEVICE_VALIDATION_LEDGER.md`
> kütüğünde **açık borç** olarak yazılıdır. Bu, projenin en olgun yanlarından biri.

| Eksik | Durum |
|---|---|
| Tek `TODO` | `nativeCommandBridge.ts:5` — MCU komut dispatch |
| E-posta ile rapor gönderimi | **Bilinçli dışarıda** — sağlayıcı seçimi ürün sahibinin kararı (maliyet + KVKK) |
| API anahtarı / zamanlama **panel ekranı** | Yok; bugün yalnız RPC ile |
| Vardiya **planlama/düzenleme** | Pano salt-okunur; yazma mevcut RPC'lerde |
| Driver DNA üretim verisi | 0 satır — sürücü hiç atanmamış |
| 90 günlük **ham rota** | Sunulmuyor (maliyet kararı); 90 gün **yolculuk özetleri** |
| Enterprise sayfası metni | **V-03 ertelendi** — özellikler yapıldı, metin hizalanmadı |

---

## 26. Dead Code

| Aday | Kanıt | Kesinlik |
|---|---|---|
| `/api/pwa/pair` | 410 Gone | **kesin** (bilinçli) |
| `/api/vehicle/register` · `/api/vehicle/code` | `deprecatedPairingRoutes.ts` | **kesin** (bilinçli) |
| `sendCommandWithApiKey` | çağıranı yok | **MUHTEMEL DEAD CODE** |
| `/api/vehicle/update` | referansı yok | **MUHTEMEL DEAD CODE** |
| `vehicles.api_key` (60 satır) | hiçbir fonksiyon/policy okumuyor | **MUHTEMEL** — eski kalıntı |
| `vehicles.license_plate` · `vin` | 0 satır dolu | **MUHTEMEL** |
| SAB kod yolları (16 dosya) | üretimde `crossOriginIsolated=false` | **ölü DEĞİL, uykuda** (ADR 0005) |
| `src/admin/services/mock.data.ts` | admin SPA mock verisi | **MUHTEMEL** — `DOĞRULANAMADI` |

---

## 27. Code Quality Score

| Ölçüt | Puan | Gerekçe |
|---|---|---|
| Separation of concerns | **9/10** | Bileşen → platform → native köprü katmanı tutarlı |
| SOLID | 7/10 | Saf model + kaynak katmanı ayrımı çok iyi; birkaç dev servis tek sorumluluğu aşıyor |
| DRY | **8/10** | "İkinci otorite kurma" kuralı testle kilitli |
| Naming | 7/10 | Genelde çok açık; ama **`api_key_hash` adı yalan söylüyor**, kolon ikizleri var |
| Folder structure | **9/10** | 50 alt alan net; `SystemBoot` haritayı veriyor |
| Error handling | **9/10** | 2.502 catch, **1** yorumsuz boş catch |
| Type safety | **9/10** | strict TS; `numeric→string` gibi gerçek kusuru tip sistemi yakaladı |
| Reusability | 7/10 | Ortak primitives var; bazı ekranlar monolitik |
| Maintainability | 7/10 | Yorumlar **neden**i anlatıyor; ama 2.000+ satırlık dosyalar risk |
| Testability | **9/10** | Saf model + yapısal girdi → mock'suz test |
| Scalability | 6/10 | Tek Supabase projesi, N+1, `IN` listesi genişlemesi |

**Öne çıkan kalite göstergesi:** yorumlar **ne** yaptığını değil **neden öyle**
yapıldığını ve **alternatifin neden yanlış olduğunu** anlatıyor:

> *"Hiç yazılmamışsa yaş HESAPLANMAZ: `nowMs - 0` 56 yıllık sahte bir yaş
> üretirdi ve 'çok bayat' gibi okunurdu."*

Bu tür yorumlar bu depoda **istisna değil kural** — devralan mühendis için
en değerli varlık budur.

---

## 28. Architecture Score

| Alan | Puan |
|---|---|
| Genel mimari | **9/10** |
| Frontend (araç) | 8/10 |
| Frontend (website) | 7/10 |
| Backend (Supabase/RPC) | 8/10 |
| Database | 6/10 — RLS mükemmel, **veri hijyeni zayıf** |
| Security | 6/10 — çerçeve güçlü, **RISK-01 ciddi** |
| Performance | 7/10 |
| UX altyapısı | 8/10 |
| Maintainability | 7/10 |
| Scalability | 6/10 |
| Test coverage (host) | **9/10** |
| Test coverage (saha) | **2/10** — %9,1 |
| Production readiness | 6/10 |

### GENEL TEKNİK PUAN: **7,3 / 10**

> Mühendislik disiplini 9, saha kanıtı 2. **Bu iki sayının arası, projenin
> bugünkü tek gerçek riskidir.**

---

## 29. Production Readiness

| Kriter | Durum |
|---|---|
| Derleniyor, testler yeşil | ✅ |
| CI kapıları (6 iş akışı) | ✅ |
| CodeQL statik güvenlik | ✅ |
| Lisans denetimi CI'da | ✅ |
| RLS + kiracı izolasyonu | ✅ (ölçülerek) |
| Secret hijyeni | ✅ |
| Release imzalama + ProGuard | ✅ |
| **Cihaz kimliği güvenliği** | ❌ RISK-01 |
| **Veri hijyeni** | ❌ 837 sahipsiz satır |
| **Gerçek araç doğrulaması** | ❌ %9,1 |
| **APK'ya karşı E2E** | ❌ yok |
| Hesap silme / veri dışa aktarma | ⚠️ kısmi |
| Play Store izin gerekçeleri | ⚠️ arka plan konumu + `MANAGE_EXTERNAL_STORAGE` |
| Crash reporting / analytics | ❌ **BULUNAMADI** |

> **`DOĞRULANAMADI`:** Sentry/Crashlytics benzeri crash reporting bulunamadı.
> `startRemoteLogService` var ama kapsamı ölçülmedi. Üretimde çöken bir
> cihazdan haberdar olma yolu **belirsiz**.

---

## 30. Sales Readiness

### Şu anda satışa çıkabilir mi? → **SINIRLI BETA**

**Neden "EVET" değil:**

1. **RISK-01** — bir veritabanı sızıntısı 834 aracın cihaz kimliğini verir.
2. **Saha doğrulaması %9,1** — 537 özellik gerçek araçta hiç denenmedi;
   ilk müşteride ne kırılacağı **bilinmiyor**.
3. **Crash reporting yok** — sahada çöken cihazdan haberiniz olmaz.
4. **Enterprise sayfası gerçeğe hizalanmadı** (V-03 ertelenmiş) — yanıltıcı
   reklam riski.

**Neden "HAYIR" da değil:** çekirdek mimari, güvenlik çerçevesi, test disiplini
ve kiracı izolasyonu üretim seviyesinde. Kontrollü bir pilot (tanıdık filo,
5–10 araç, yakın gözetim) bugün **yapılabilir** ve en hızlı öğrenme yolu budur.

### SATIŞTAN ÖNCE MUTLAKA

- RISK-01 (cihaz anahtarı gerçekten hash'lensin) + BUG-001 **birlikte**
- RISK-02 (sahipsiz satır temizliği + kayıt hız sınırı)
- Crash reporting + uzak log
- Enterprise sayfası metni ↔ gerçek (V-03)
- Play Store izin gerekçeleri
- Hesap silme + veri dışa aktarma akışının uçtan uca doğrulanması

### YAKIN ZAMANDA

APK'ya karşı E2E · saha sprint'i (🟢 58 → 150+) · RISK-03/04/05 ·
`last_seen` ve kolon ikizleri · anahtar/zamanlama panel ekranları

### SONRA

Büyük dosyaların bölünmesi · `poi.db` FTS5 · e-posta taşıması ·
90 günlük ham rota · website server-state

---

## 31. Prioritized Roadmap

### P0 — Kritik

| Görev | Dosyalar | Neden | Risk |
|---|---|---|---|
| **P0-1** Cihaz anahtarını gerçekten hash'le | `register_vehicle`, `upload_vehicle_trip` ve `api_key_hash` okuyan 12 SQL fonksiyonu; `vehicleIdentityService.ts` | RISK-01 | **Yüksek** — çift-okuma penceresi ŞART |
| **P0-2** Üç rotayı tek doğrulama otoritesine bağla | `api/pwa/command`, `api/pwa/dtc-result`, `api/vehicle/update`, `lib/crypto.ts` | BUG-001 | Orta |
| **P0-3** Sahipsiz araç temizliği + kayıt hız sınırı | `register_vehicle`, `retention_policy` | RISK-02 | Orta — **silme geri alınamaz**, önce raporla |
| **P0-4** Crash reporting + uzak log | yeni; `startRemoteLogService` genişletilir | Sahada körlük | Düşük |
| **P0-5** Enterprise sayfası ↔ gerçek | `website/src/app/(public)/enterprise/page.tsx` | Yanıltıcı reklam | Düşük |

### P1 — Yüksek

| Görev | Dosyalar |
|---|---|
| P1-1 APK'ya karşı E2E (ADB + `adb screencap`) | yeni `e2e-native/`, `playwright.config.ts` |
| P1-2 Saha doğrulama sprint'i (🟢 58 → 150+) | `docs/DEVICE_VALIDATION_LEDGER.md` |
| P1-3 `/admin` korumasını doğrula/ekle | `website/src/middleware.ts` |
| P1-4 Kritik komut PIN'ini fail-closed yap | `verify_and_send_critical_command`, `fn_enforce_critical_pin` |
| P1-5 `last_seen` yazma yolunu onar | 7 SQL fonksiyonu + panel |
| P1-6 Kolon ikizlerini tekilleştir | `vehicles` migration + okuyucular |
| P1-7 Harita/trafik anahtarlarını kısıtla | sağlayıcı paneli + `.env` |
| P1-8 Anahtar/zamanlama panel ekranları | `dashboard/fleet/settings` |

### P2 — Orta

`poi.db` FTS5 · `/api/v1/trips` tek sorguya indirgeme · website server-state ·
LAB'daki 2 `PLACEHOLDER` · iki migration zincirinin birleştirilmesi ·
`docs/` envanterinin sadeleştirilmesi

### P3 — İyileştirme

`obdService.ts` / `FullMapView.tsx` / `SettingsPage.tsx` bölünmesi ·
React/Tailwind sürüm hizalaması · e-posta taşıması · 90 günlük ham rota

---

## 32. File-Level Change Map

### P0-1 — Cihaz anahtarını hash'le

```
DEĞİŞECEK (SQL) — supabase/migrations/<yeni>_device_key_hashing_p1.sql
  · register_vehicle              ham anahtar üret → YALNIZ sha256 sakla → ham değeri BİR KEZ döndür
  · upload_vehicle_trip           coalesce(...) yerine encode(sha256(p_api_key::bytea),'hex')
  · fetch_pending_vehicle_commands · update_command_status
  · get_active_driver_assignment  · push_vehicle_event
  · get_geofence_zones            · refresh_linking_code      (api_key_hash okuyan 12 fonksiyon)

DEĞİŞECEK (araç)
  src/platform/vehicleIdentityService.ts    ham anahtarı sakla (davranış aynı)

YENİ
  supabase/tests/068_device_key_hashing_matrix.sql
    · eski anahtar geçiş penceresinde ÇALIŞMALI
    · pencere kapandıktan sonra ÇALIŞMAMALI
    · yeni kayıt YALNIZ hash saklamalı

GERİ ALMA: çift-okuma penceresi en az bir sürüm boyu açık kalır
```

### P0-2 — Doğrulama otoritesini tekilleştir

```
DEĞİŞECEK
  website/src/app/api/pwa/command/route.ts       → tek yardımcıyı çağır
  website/src/app/api/pwa/dtc-result/route.ts    → aynı
  website/src/app/api/vehicle/update/route.ts    → aynı
YENİ
  website/src/lib/api/deviceKeyAuth.ts           → TEK doğrulama kapısı
  website/src/__tests__/deviceKeyAuth.test.ts    → "her uç tek kapıdan geçer" kilidi
```

### P0-3 — Sahipsiz araç temizliği

```
DEĞİŞECEK
  supabase/migrations/<yeni>_orphan_vehicle_retention.sql
    · retention_policy'ye 'vehicles_orphan' satırı
    · cleanup_old_telemetry: company_id IS NULL AND owner_id IS NULL
      AND created_at < now() - N gün AND telemetri YOK
  supabase/tests/065_retention_policy_matrix.sql   → sınırın İKİ TARAFI
ÖNCE: kaç satır silineceğini RAPORLA, sonra uygula
```

### P1-1 — Native E2E

```
YENİ
  e2e-native/playwright.native.config.ts    → CDP-over-adb
  e2e-native/{boot,obd,nav,voice,command}.spec.ts
  scripts/run-native-e2e.mjs                → fail-closed (cihaz yoksa SIFIR DÖNMEZ)
NOT: görsel doğrulama YALNIZ `adb screencap` — CDP ekran görüntüsü WebGL'i yakalamaz
```

---

## 33. PROJECT MASTER CONTEXT

> Bu bölüm, tüm depoyu yeniden okumadan projeyi anlaması gereken bir mühendis
> ya da yapay zekâ içindir.

### Amaç

CarOS Pro, aftermarket Android head unit'leri **araç zekâsı platformuna**
çeviren bir işletim katmanıdır. Yalnız gösterge göstermez; **doğrular,
yorumlar, öngörür ve karar verir**. Referans Tesla değildir: Tesla kendi
aracını tanır, CarOS Pro **bilinmeyen** marka/modeli öğrenmek zorundadır —
bu yüzden **zero-trust telemetri** ve **provenance** temel tasarım ilkeleridir.

### Stack

React 19 + TS 5.9 + Vite 8 + Capacitor 8 (Android, minSdk 24 / targetSdk 36) ·
Tailwind 4 · Zustand 5 · MapLibre 4 · sql.js · i18next.
Website: Next.js 14 + React 18 + Tailwind 3.
Sunucu: Supabase (PostgreSQL + RPC + RLS + pg_cron).
Test: Vitest (13.139 + 1.418) · Playwright (8) · Gradle (26) · 12 SQL matrisi.

### Mimari

```
Bileşen → platform servisi → bridge.ts → nativeBridge → CarLauncherPlugin.java
                                      ↘ demoBridge (tarayıcı)

SystemBoot                 55 alt sistem
AdaptiveRuntimeManager     tek 3 Hz tik · 5 mod · 4 tespit kapısı
UnifiedVehicleStore        canlı sinyal aynası
vehicleProvenance          her sinyalin kaynağı + yaşı (yan kanal defteri)
signalHub                  tek otoriter okuma yüzeyi (SignalEnvelope)
```

### Kritik dosyalar — buradan başla

| Dosya | Neden |
|---|---|
| `src/platform/system/SystemBoot.ts` | **Sistemin haritası** — 55 alt sistem |
| `src/core/runtime/AdaptiveRuntimeManager.ts` | Mod + zamanlama otoritesi |
| `src/platform/bridge.ts` | Native soyutlama |
| `src/platform/obdService.ts` | OBD çekirdeği (3.391 satır) |
| `src/platform/vehicleDataLayer/UnifiedVehicleStore.ts` | Canlı araç durumu |
| `src/platform/devtools/carosLabCatalog.ts` | 62 tanılama aracının kaydı |
| `docs/DEVICE_VALIDATION_LEDGER.md` | **Saha gerçeğinin MUTLAK OTORİTESİ** |
| `docs/CAROS_PRO_VIZYONU.md` | Ürün vizyonunun tek kaynağı |
| `CLAUDE.md` + `AI.md` | Bağlayıcı çalışma kuralları |

### Veri modeli özeti

`companies → profiles → vehicles → {trips, locations, telemetry, commands,
events, identity, geofences, fuel_logs, service_records, transfers,
linking_codes, push_tokens}` · `fleet_drivers → {assignments, presence,
authentication, driver_dna}`. Yatay: `ai_evidence*` · `mavi_reasoning*` ·
`ai_gateway_*` · `feature_flags` · `runtime_policies` · `ota_releases` ·
`retention_policy` · `company_api_keys` · `report_schedules`.

### Kimlik

İki dünya: **kullanıcı** (Supabase JWT + çerez + `middleware.ts`) ve **cihaz**
(`p_api_key` gövde parametresi). Roller: `individual · member · observer ·
admin · super_admin` (**`owner` yoktur** — araç sahipliği `vehicles.owner_id`).
57/57 tabloda RLS açık.

### Bilinen kritik sorunlar

1. `vehicles.api_key_hash` **düz metin** taşıyor (834 satır) — RISK-01
2. 837 sahipsiz araç satırı — RISK-02
3. Üç rota asla eşleşemeyecek doğrulama yapıyor — BUG-001
4. `last_seen` hiç yazılmıyor — BUG-002
5. Saha doğrulaması %9,1 (537 madde 🔴)
6. Crash reporting **bulunamadı**

### Üretim durumu (2026-08-22)

2 kullanıcı · 1 şirket · 838 araç (837 sahipsiz) · 34 yolculuk · 1.905 konum ·
0 sürücü · 0 DNA · 0 bildirim. **Ürün henüz gerçek kullanımda değil.**

### Korunması gereken mimari kurallar

1. **Tek otorite** — aynı gerçeği iki yerde hesaplama. Kart ↔ skor,
   ekran ↔ PDF, üretim yolu ↔ LAB izi hep aynı kaynaktan beslenir.
2. **Fail-closed** — kanıt yoksa hüküm yok. "Emin değilim, geçir" yasak.
3. **Sahte veri yasağı** — bilinmeyen `UNKNOWN`/`—` yazılır; **sahte 0,
   sahte tarih, sahte "sağlıklı" YASAK**.
4. **Üç ayrı "yok"** — okunamadı ≠ veri yok ≠ ölçülemedi.
5. **Provenance** — her değer kaynağını taşır; toplam **en zayıf girdisi
   kadar** güçlüdür.
6. **Zero-leak** — her `useEffect`/`setInterval`/listener'ın temizliği var.
7. **Hot-path disiplini** — 3 Hz yolunda tahsis yok, hidden-class kararlı,
   `Date.now()` yama başına bir kez.
8. **Atomik patch** — çok-sistemli refactor yasak.
9. **LAB mandate** — her önemli alt sistemin **salt-okunur** gözlem ekranı olur.
10. **Kütük otoritedir** — `DEVICE_VALIDATION_LEDGER.md` ile çelişen hiçbir
    "çalışıyor" iddiası kabul edilmez.
11. **BYOK** — uygulamaya merkezi AI anahtarı gömülmez.
12. **Lisans** — yalnız permissive (MIT/Apache/BSD/ISC/OFL);
    GPL/AGPL/LGPL/SSPL/NC **yasak**. OSM verisi için ODbL atıfı zorunlu.

---

## 34. FUTURE AI DEVELOPMENT RULES

Bu projede çalışan her yapay zekâ:

1. Değişiklik yapmadan önce ilgili mevcut kodu **okumalı**.
2. Var olan mimariye uymalı; yeni desen icat etmeden önce mevcudu aramalı.
3. **Aynı işi yapan ikinci bir sistem oluşturmamalı.**
4. Mevcut component/service/helper varsa **yeniden kullanmalı**.
5. Bir problemi düzeltirken çalışan başka özellikleri **bozmamalı**.
6. Database değişikliğinin **geriye dönük** etkisini kontrol etmeli.
7. API contract değişikliğinde frontend/backend **birlikte** değerlendirilmeli.
8. Authentication ve authorization kontrollerini **atlamamalı**.
9. Secret/API key **hardcode edilmemeli**.
10. Production ve development ortamları **karıştırılmamalı**.
11. Değişiklikten sonra etkilenen akışlar **test edilmeli**.
12. Büyük refactor öncesinde **neden gerekli olduğu açıklanmalı**.
13. Silme öncesinde **kullanım referansları** kontrol edilmeli.
14. Kullanıcı verisini bozabilecek migration'lardan **kaçınılmalı**.
15. Geçici çözüm yapılıyorsa **açıkça belirtilmeli**.
16. Tahmin ederek **dosya/fonksiyon uydurulmamalı**.
17. Emin olunmayan noktalar **doğrulanmalı** — yoksa `DOĞRULANAMADI` yazılmalı.
18. Her değişiklik **production seviyesinde** düşünülmeli.

### Bu projeye özgü ek kurallar (kütükten öğrenilenler)

19. **Ekranı değil BESLEYENİ ölç.** `AVAILABLE` de `PLACEHOLDER` de yalan söyleyebilir.
20. **"Flaky" bir HİPOTEZDİR** — artefaktı indir, stack trace oku, izole koş,
    düşen kümenin değişip değişmediğine bak.
21. **Boru hattından sonra `echo $?`** son komutun değil borunun son halkasının
    durumunu verir. Çıktıyı dosyaya yönlendir, `$?`yi hemen oku.
22. **`tsc --noEmit` yetmez** — build `tsc -b` kullanır ve daha fazlasını yakalar.
23. **`git add -A` KULLANMA** — depoda başka bir oturum çalışıyor olabilir;
    açık dosya yollarıyla stage'le.
24. **Filo RPC'leri hata FIRLATMAZ, `REJECTED` DÖNER.** Dönüş değerini oku.
25. **Yeşil bir test, sandığın şeyi sınadığını kanıtlamaz.** Ara adımın
    gerçekten gerçekleştiğini ayrıca doğrula.
26. **Yapısal test görsel kusuru görmez.** PDF/harita gibi çıktıları
    **görüntüye çevirip gözle** doğrula.
27. **Kilidi mutasyonla sına** — mutasyon **testi** değil **ürünü** bozmalı.
28. **Yerel yeşil ≠ prod yeşil.** İki migration zinciri var; prod'un GRANT ve
    şeması yerelden farklı.

---

### Rapor sonu

**Kanıt tabanı:** üretim veritabanı (Supabase `Carospro`) canlı sorguları ·
kaynak kod okuma · `npm run test` (13.139) · website (1.418) · 5 SQL matrisi ·
`tsc -b` · `lint`. **Ölçüm tarihi: 2026-08-22.**
