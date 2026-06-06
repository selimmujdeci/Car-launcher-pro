# FEATURE FLAGS — CarOS Pro

> Kod tabanında **grep ile doğrulanmış** feature/debug flag'leri. İstenmiş ama
> bulunamayanlar **Belirsiz / kodda bulunamadı** işaretlidir. Flag adları İngilizce.
> Son doğrulama: 2026-06-06.

---

## 1. Build-time env flag'leri (`import.meta.env`)

| Flag | Tanım yeri | Varsayılan | Amaç |
|------|-----------|------------|------|
| `VITE_ENABLE_OBD_MOCK` | `obdService.ts:747` (`MOCK_ENABLED = import.meta.env['VITE_ENABLE_OBD_MOCK'] === 'true'`) | yok = mock kapalı | `'true'` ise web/non-native modda OBD mock'u açar. Production'da ayarlanmaz. ⚠ **Tutarsızlık:** `.env.example:25` `VITE_DISABLE_OBD_MOCK` yazıyor ama kod `VITE_ENABLE_OBD_MOCK` okuyor — `.env.example` yanıltıcı. |
| `VITE_ENABLE_DEBUG_PANEL` | `platform/debug/index.ts:2`, `platform/debug/debugStore.ts:200`, `core/storage/CacheLRUManager.ts:31` | yok = kapalı (DEV hariç) | `'true'` ya da DEV ise debug panel/LRU debug açık. Release'te ayarlanmaz. |
| `VITE_GEMINI_API_KEY` | `aiVoiceService.ts:257` | boş `''` | AI sesli asistan Gemini anahtarı (BYOK — CLAUDE.md). |
| `VITE_CLAUDE_API_KEY` | `aiVoiceService.ts:261` | boş `''` | AI sesli asistan Claude anahtarı (BYOK). |
| `VITE_SUPABASE_URL` | `commandListener.ts:187`, `fcmService.ts:104`, `remoteConfigService.ts:27`, admin servisleri | undefined | Supabase project URL; yoksa ilgili özellik no-op/devre dışı. |
| `VITE_SUPABASE_ANON_KEY` | `commandListener.ts:188`, `fcmService.ts:105`, `remoteConfigService.ts:28` | undefined | Supabase anon key (PostgREST/realtime erişimi). |
| `VITE_VECTOR_TILE_URL` | `mapStyleBuilders.ts:75`, `mapDownloadManager.ts:152` | boş `''` | Özel vektör tile sunucusu; boşsa varsayılan kaynak. |
| `VITE_ROUTING_SERVER` | `routingService.ts:136` | undefined | Özel OSRM/Valhalla/GraphHopper rota sunucusu; yoksa demo sunucu. |

## 2. Vite yerleşik DEV bayrağı (`import.meta.env.DEV`)

| Bayrak | Davranış | Amaç |
|--------|----------|------|
| `import.meta.env.DEV` | Production build'de `false` → Vite tree-shake | DEV-only kodu prod'dan eler: TestControlPanel (`components/debug/TestControlPanel.tsx:298`), devInspector (`DevInspector.tsx:56`, `IntelligenceInspector.tsx:14`, `HazardInspector.tsx:28`), GPS/OBD test override (`gpsService.ts:601`, `obdService.ts:931`), nav rota teşhis rozeti (`FullMapView.tsx:1612`), CAN debug log (`ProfileSignalGate.ts:441`, `CanSignalValidator.ts:369`). Production'da hepsi no-op. |

## 3. Test/diagnostic toggle (env + runtime)

| Flag | Tanım yeri | Varsayılan | Amaç |
|------|-----------|------------|------|
| `ENABLE_DEVICE_TEST` | `__tests__/patentTestLogger.ts:71` (env), `:75, :86, :88` (localStorage) | yok = kapalı | `process.env` veya `localStorage['ENABLE_DEVICE_TEST']='true'` ile cihaz test logger'ı açar (fs/localStorage'a yazar). Release'te kapalı. |
| `NODE_ENV === 'test'` | `__tests__/patentTestLogger.ts:70` | — | Vitest ortamında logger otomatik aktif. |

## 4. Runtime mod / tier (build-time flag DEĞİL — donanıma göre seçilir)

> Bunlar env flag'i değil; `AdaptiveRuntimeManager` donanım/termal/voltaja göre seçer.
> Ayar override'ı `RuntimeOverride = 'AUTO' | RuntimeMode` (`runtimeTypes.ts:108`).

| Sabit | Tanım yeri | Değerler | Amaç |
|-------|-----------|----------|------|
| `RuntimeMode` | `core/runtime/runtimeTypes.ts:26-33` | `PERFORMANCE`, `BALANCED`, `BASIC_JS`, `POWER_SAVE`, `SAFE_MODE` | Çalışma modu. `BASIC_JS` = Mali-400/giriş HU; `SAFE_MODE` = kritik kurtarma; `POWER_SAVE` = düşük voltaj akü koruma. |
| `DeviceTier` | `platform/deviceCapabilities.ts:21` | `'low' \| 'mid' \| 'high'` | Ham donanım sınıfı; runtime mode bundan beslenir (`getDeviceTier()` :163). |
| `--rt-blur` (CSS) | `AdaptiveRuntimeManager.ts:325` (yazım), `:649` (cleanup) | `0 \| 1` | `config.enableBlur`'a göre yazılır; Mali-400 backdrop-blur GPU guard. Tüketici: `index.css`, `theme.css:175`, `volume-overlays.css`, `ultra-premium-global.css`. |
| `--rt-anim` (CSS) | `AdaptiveRuntimeManager.ts:326` | `0 \| 1` | `config.enableAnimations`'a göre; animasyon kapatma. |
| `enableBlur` (config) | `runtimeTypes.ts:80` (RuntimeConfig) | bool | Mod başına blur açık/kapalı (`--rt-blur`'u sürer). |

## 5. Platform bridge (runtime — flag DEĞİL)

| Mekanizma | Tanım yeri | Amaç |
|-----------|-----------|------|
| `nativeBridge` / `demoBridge` | `platform/bridge.ts:226` (`Capacitor.isNativePlatform() ? nativeBridge : demoBridge`) | Build-time flag değil; runtime platform tespiti. `isNative`/`isDemo` türetilir (:229-230). Web = demo, Android = native. |
| OBD transport seçimi | `obdService.ts:109-126` (`_lastKnownTransport`) | BLE OBD için ayrı feature flag YOK; transport (`'classic'\|'ble'`) runtime'da MAC ile persist edilir, derleme-zamanı toggle değil (bkz. ADR 0003). |

## 6. Belirsiz / kodda bulunamayan (istenmiş ama yok)

| İstenen flag | Durum | Not |
|--------------|-------|-----|
| `YT_DEBUG_PROBE` | **Belirsiz / kodda bu adla yok** | grep boş (`src/` + native). YouTube debug/probe/iframe video mekanizması yok; gömülü video REVERT edildi (`_playYouTubeLight` yok — ADR 0004). |
| BLE OBD feature flag | **Yok (kasıtlı)** | Transport runtime'da seçilir; derleme-zamanı flag değil. |

---

## Doğrulama özeti

- **Doğrulanan flag/sabit:** 19
  (env: `VITE_ENABLE_OBD_MOCK`, `VITE_ENABLE_DEBUG_PANEL`, `VITE_GEMINI_API_KEY`,
  `VITE_CLAUDE_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_VECTOR_TILE_URL`, `VITE_ROUTING_SERVER` = 8;
  `import.meta.env.DEV` = 1; `ENABLE_DEVICE_TEST`, `NODE_ENV==='test'` = 2;
  `RuntimeMode`, `DeviceTier`, `--rt-blur`, `--rt-anim`, `enableBlur` = 5;
  bridge native/demo + OBD transport = 2; **toplam 18 doğrulanmış flag/sabit +
  1 tutarsızlık notu (`VITE_DISABLE_OBD_MOCK`)**).
- **Belirsiz / bulunamayan:** 2 (`YT_DEBUG_PROBE`; ayrı BLE OBD flag'i).
