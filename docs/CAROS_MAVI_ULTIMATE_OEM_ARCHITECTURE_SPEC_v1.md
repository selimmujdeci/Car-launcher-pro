# CAROS PRO — MAVİ ULTIMATE OEM++ MİMARİ SPESİFİKASYONU v1

> **Belge türü:** Kanonik mimari sözleşmesi (tasarım turu — **kod yazılmadı**)
> **Tarih:** 2026-08-29
> **Kapsam:** Mavi = *Real-Time Road Companion + Universal CarOS Copilot* (TEK asistan)
> **Kaynak otoritesi:** Bu belgedeki "MEVCUT" iddialarının tamamı gerçek koddan
> `dosya:satır` ile çıkarılmıştır. Ölçülmemiş hiçbir şey "var" diye yazılmamıştır.
> **Bağlayıcı üst belgeler:** `CLAUDE.md` · `AI.md` · `docs/CAROS_PRO_VIZYONU.md` ·
> `docs/DEVICE_VALIDATION_LEDGER.md` (saha otoritesi) · `docs/MAVI_NEXT_VISION.md` (ürün yönü)

---

## 0. BU BELGENİN OKUNMA SÖZLEŞMESİ

| İşaret | Anlamı |
|--------|--------|
| **[ÖLÇÜLDÜ]** | Kodda okundu, `dosya:satır` verildi |
| **[TÜRETİLDİ]** | Koddaki sabitlerden hesaplandı — saha ölçümü DEĞİL |
| **[TASARIM]** | Bu belgenin önerisi — henüz kod değil |
| **[BORÇ]** | Açık teknik / gözlemlenebilirlik borcu |

**Uyarı:** Bu belgedeki hiçbir gecikme rakamı **saha ölçümü değildir**. Kod
sabitlerinden türetilmiş üst/alt sınırlardır. Gerçek `speech-end → first audio`
değeri cihazda ölçülene kadar `UNKNOWN`'dır (bkz. §26, §30).

---

## 1. YÖNETİCİ HÜKMÜ (EXECUTIVE VERDICT)

### 1.1 Tek cümlelik teşhis

> **CarOS Pro'da bir değil ÜÇ Mavi vardır: canlı çalışan olgun-ama-monolitik
> "voiceService hattı", tamamen yazılmış ama SHADOW'da dondurulmuş "maviCore",
> ve varsayılan KAPALI on bir bayrağın arkasında bekleyen modern "ai/gateway
> orkestrasyonu". Mavi'nin sorunu eksik özellik değil, ÜÇ paralel mimarinin
> hiçbirinin tek otorite olmamasıdır.**

### 1.2 Hüküm tablosu

| Boyut | Bugünkü gerçek | Hedef | Fark |
|-------|----------------|-------|------|
| Konuşma gerçek-zamanlılığı | Tamamen **seri, non-streaming**, filler ile örtülmüş | Streaming full-duplex | **KÖKTEN EKSİK** |
| Eylem otoritesi | Var ve güçlü (`maviActionAuthority`) ama **yalnız araç etkili** intent'leri kapsıyor | Tüm CarOS yüzeyi | **KISMİ** |
| Capability sözleşmesi | `capabilityRegistry` var ama **Mavi'ye bağlı değil** | Universal Capability Fabric | **BAĞLANMAMIŞ** |
| Plan ≠ yürütme ≠ gözlem | **Medyada mükemmel** (`playbackTruth`), diğer alanlarda yok | Her domain'de | **KISMİ** |
| Yol Arkadaşı | **Capability kısıtlama şalteri** (kapalıyken beyin ölü) | Yalnız presence davranışı | **ANAYASAYA AYKIRI** |
| Bağlam zekâsı | 3 ayrı bağlam sistemi paralel | Tek Context Intelligence | **PARÇALI** |
| Hafıza | 3 ayrı hafıza + Trip Memory yok | Turn / Trip / Long-term | **PARÇALI** |
| Compound command | Yok — tur başına tek intent | Plan (çok adım) | **YOK** |
| Gözlemlenebilirlik | **Güçlü** (LAB + STT telemetri + action trace) | Genişletilecek | **KORUNACAK** |
| Güvenlik otoritesi | **Çok güçlü** (hard-forbidden + PRE/POST gate) | Aynen korunur | **KORUNACAK** |
| Ses hakemliği | **OEM seviyesinde** (nested duck, token) | Aynen korunur | **KORUNACAK** |

### 1.3 Nihai karar

**Rewrite YAPILMAYACAK.** Repoda zaten OEM üstü kalitede **beş omurga** var (§3).
Yapılacak iş üç maddedir:

1. Bu omurgaları **tek Mavi çekirdeği** altında birleştirmek (üç hattı bire indirmek).
2. Seri pipeline'ı **streaming**'e çevirmek (filler'ı yara bandı olmaktan çıkarmak).
3. Yol Arkadaşı'nı capability şalteri olmaktan çıkarıp **presence policy**'ye indirgemek.

**Mimari skor:** Bugün **6.1 / 10** · Hedef **9.2 / 10** (gerekçe §33).

---

## 2. MEVCUT DURUM — REPO DENETİMİ (ÖLÇÜLDÜ)

### 2.1 Mavi'nin mevcut mimarisi — ÜÇ PARALEL HAT

#### HAT-1 · CANLI HAT (production'da çalışan tek hat)

```
kullanıcı sesi
  → wakeWordService (Vosk grammar thread, native)      src/platform/wakeWordService.ts
  → voiceService.startListening()                      src/platform/voiceService.ts:1985+
  → CarLauncher.startSpeechRecognition (Vosk | Google) CarLauncherPlugin.java:3349
  → [opsiyonel] cloudSttService.cloudTranscribe(WAV)   src/platform/cloudSttService.ts
  → voiceService.processTextCommand()                  src/platform/voiceService.ts
  → commandParser.parseCommandFull()   (yerel, ≥0.7)   src/platform/commandParser.ts
  → companionChatProvider.tryCompanionBrain()  (LLM)   src/platform/companion/companionChatProvider.ts:2667
  → intentEngine.fromSemanticResult()                  src/platform/intentEngine.ts
  → maviActionAuthority (araç etkiliyse)               src/platform/action/maviActionAuthority.ts
  → commandExecutor.executeIntent / routeIntent        src/platform/commandExecutor.ts
  → maviSpeech.speakMaviAnswer → ttsService            src/platform/assistant/maviSpeech.ts:129
```

**Ölçüm:** `voiceService.ts` **2333** satır · `companionChatProvider.ts` **2876** ·
`commandParser.ts` **1416** · `commandExecutor.ts` **1018** ·
`useVoiceCommandHandler.ts` **679** · `intentEngine.ts` **709**.
Canlı hat toplamı ≈ **9000 satır**.

#### HAT-2 · SHADOW HAT (`maviCore` — yazılmış, dondurulmuş)

`src/platform/maviCore/` = **6958 satır**, tamamı test edilmiş, **üretimde no-op**.

| Modül | Satır | İçerik |
|-------|-------|--------|
| `maviLifecycle.ts` | 343 | Tam state machine (idle → waking → listening → understanding → planning → executing → speaking) |
| `intentResolver.ts` | 523 | Deterministik TR niyet çözücü (alias + confidence + ambiguous reddi) |
| `executionEngine.ts` | 402 | Çok adımlı plan · partial success · rollback · dedupe · stale reddi |
| `actionRegistry.ts` | 310 | Typed AppAction defteri (risk / reversible / timeout / resultContract) |
| `maviOrchestrator.ts` | 271 | Turu birleştiren orkestratör |
| `latencyTelemetry.ts` | 215 | Segment bazlı gecikme ölçümü |
| `contextStore.ts` | 210 | Kısa süreli bağlam + referans çözümleme |
| `wiring/*` | ~3600 | Takeover arbiter / policy · evidence · ownership · media authority port |

**Kanıt (dondurulmuş):** `maviActionAuthority.ts:26` — *"`maviCore` SHADOW/FROZEN
kalır (M1 karar matrisi)"*. `platformCoreMaviVoiceWiring.ts:66-84` — takeover bayrağı
`mavi.mediaNextTakeover.enabled` **varsayılan kapalı**; açılsa bile
**yalnız `media.next`** gerçek handler'a bağlanır (`maviWiring.ts:22-36`).

> **Sonuç:** dokuz pilot eylemin sekizi ve tüm `vehicle.*` eylemleri hiçbir config
> ile bu hattan geçemez. `maviCore` bugün **sıfır kullanıcı etkisi** üretiyor.

#### HAT-3 · MODERN AI STACK (`ai/` — yazılmış, bayrakla kapalı)

`src/platform/ai/` = **12234 satır**. `companionChatProvider` üzerinden erişilebilir,
ama **on bir bayrağın hepsi varsayılan `false`** (`ai/gateway/aiGatewayFlag.ts`):

| Bayrak | Satır | Açtığı yetenek |
|--------|-------|----------------|
| `mavi_ai_gateway` | 22 | Sağlayıcı bağımsız gateway |
| `mavi_ai_orchestrator` | 116 | Görev sınıflandırma + model seçimi |
| `mavi_ai_context` | 159 | Context Engine |
| `mavi_ai_memory` | 226 | Memory Engine |
| `mavi_ai_tools` | 287 | Tool calling |
| `mavi_ai_planner` | 348 | Planner |
| `mavi_ai_mechanic` (+2) | 385 / 422 / 460 | Mekanik uzman katmanları |
| `mavi_ai_operator` (+1) | 499 / 538 | Operatör modu |

**Toplam:** repoda **~27.500 satır Mavi kodu** var; kullanıcıya ulaşan **~%30'u**.

### 2.2 Voice pipeline (ÖLÇÜLDÜ)

| Aşama | Uygulama | Streaming? |
|-------|----------|-----------|
| Wake | Native Vosk grammar thread, partial bazlı (<200 ms hedef) `CarLauncherPlugin.java:4548` | **EVET** (tek streaming nokta) |
| ASR (offline) | Vosk + özel `AudioRecord` döngüsü, AGC / NS / AEC + gain 3.0 | **HAYIR** — `PluginCall` sonda resolve |
| ASR (online) | Android `SpeechRecognizer` — `onPartialResults` **BOŞ GÖVDE** `CarLauncherPlugin.java:3452` | **HAYIR** |
| ASR (bulut) | `cloudSttService` — WAV base64 round-trip, 6 s timeout | **HAYIR** ve üstelik **SERİ** |
| NLU / LLM | `companionChatProvider` — tek atımlık JSON | **HAYIR** |
| TTS | klip → Edge → Gemini TTS → native → web `ttsService.ts:422-470` | **HAYIR** — tam cümle sentezi |

**Kritik yapısal bulgu:** Zincirin **hiçbir halkası** bir sonrakine kısmi sonuç
vermiyor. Her halka bir öncekinin **tamamlanmasını** bekliyor.

### 2.3 ASR / TTS envanteri

- **ASR:** Vosk TR (Apache-2.0 ✅) · Android SpeechRecognizer · Groq Whisper / Gemini bulut.
- **Bulut STT kapısı:** `voiceService.ts:2004` — `returnAudio: navigator.onLine`.
  Native tek yakalama yapar, WAV'ı JS'e verir; **modül çakışması yok** (iyi tasarım).
- **TTS zinciri:** `voiceClips` (önceden kaydedilmiş premium klip) → `edgeTtsService`
  (proxy `carospro.com/api/tts`, 12 s timeout, 40 girişli LRU) → `onlineTtsService`
  (Gemini) → native `speak()` → `speechSynthesis`.
- **[BORÇ B12]** Edge TTS **birinci taraf sunucuya** bağımlı; offline'da tamamen düşer
  ve ses erkek eSpeak'e iner (tutarsız kişilik).

### 2.4 AI / provider katmanı

- `aiGateway` (385) + `geminiProvider` (314) + `openRouterProvider` (512).
- **`openRouterProvider.ts:440-470`: SSE streaming + `onToken` callback UYGULANMIŞ,
  ama hiçbir canlı çağıran `stream:true` istemiyor** — hazır streaming yeteneği
  kullanılmadan duruyor.
- `geminiProvider.ts:17,255` — açıkça NON-STREAMING.
- BYOK disiplini doğru: `apiCredentialManager` + `sensitiveKeyStore`, gömülü anahtar yok ✅
  (CLAUDE.md ticari lisans kuralına uygun).
- Devre kesici: `aiHealth.isAiNetHealthy()` (global) + `providerHealthStore` (sağlayıcı bazlı).
- Sessiz offline yasağı: `aiOfflineReason.ts` + `NO_NET_EVIDENCE_KINDS` kara listesi
  (`companionChatProvider.ts:60-72`) — **kanıtsız "offline" iddiası yapısal olarak engelli**.

### 2.5 Asistan state machine — İKİ TANE VAR

1. **Canlı:** `VoiceStatus = idle | listening | processing | success | error | throttled`
   (`voiceService.ts:66-73`) — 6 durum, **UI merkezli**; plan / eylem / onay durumu yok.
2. **Shadow:** `MaviState` (`maviLifecycle.ts`) — 9+ durum, kuşak (generation),
   geri kazanılabilirlik, geçiş tablosu. **Kullanılmıyor.**

### 2.6 Gecikme kaynakları (ÖLÇÜLDÜ — sabitler)

| Kaynak | Sabit | Dosya |
|--------|-------|-------|
| Mikrofon ısınma | 120 / 300 / 500 ms | `voiceTuning.ts:70-80` |
| Aktif dinleme tavanı | 12 000 ms | `voiceTuning.ts:73` |
| Takip dinleme penceresi | 8 000 ms | `voiceTuning.ts:74` |
| **VAD sessizlik endpoint** | **1 100 ms** | `CarLauncherPlugin.java:3301` |
| JS failsafe | 14 000 ms | `voiceTuning.ts:79` |
| UI güvenlik kapanışı | 16 000 ms | `voiceTuning.ts:80` |
| Bulut STT timeout | 6 000 ms | `cloudSttService.ts:20` |
| Beyin (sürüş) | 4 500 ms | `voiceService.ts:1147` |
| Beyin (park) | 8 000 ms | `voiceService.ts:1148` |
| Gateway beyin | 6 000 ms | `companionChatProvider.ts:1475` |
| Gemini | 9 000 ms | `companionChatProvider.ts:1100` |
| Groq | 6 000 ms | `companionChatProvider.ts:1253` |
| Haiku | 6 000 ms | `companionChatProvider.ts:1619` |
| Grounded arama | 8 000 ms | `companionChatProvider.ts:2230` |
| **Filler eşiği** | **1 500 ms** | `voiceService.ts:1062` |
| Edge TTS timeout | 12 000 ms | `edgeTtsService.ts:18` |
| Edge TTS soğuma | 60 000 ms | `edgeTtsService.ts:26` |

### 2.7 Filler (yapay ara söz) kaynakları — TAM ENVANTER

| # | Metin | Konum | Tetik |
|---|-------|-------|-------|
> **🟡 GÜNCEL DURUM (2026-08-29):** Aşağıdaki envanter **F2 ÖNCESİ** ölçümdür ve
> tarihsel kayıt olarak korunur. **Altı kaynağın altısı da kapatıldı** (bkz. §29 F2);
> ek olarak `maviSpeech` `progress` katmanına yapısal bir I11 kapısı kondu.
>
| 1 | `Bakıyorum hemen...` / `Bir saniye...` / `Kontrol ediyorum...` | `voiceService.ts:1068-1070` | Beyin > 1500 ms |
| 2 | `Bakıyorum...` | `voiceService.ts:867` | Sensör sorgusu başlangıcı |
| 3 | `Bakıyorum` | `commandExecutor.ts:810` | Sensör okuma |
| 4 | `Hava durumuna bakıyorum.` | `voiceInfoService.ts:83` | Hava sorgusu |
| 5 | `Bir saniye` / `Bakıyorum` | `maviFeedback.ts:50-51` | maviCore aşama geri bildirimi (shadow) |
| 6 | `feedback:"Bakıyorum"` | `companionChatProvider.ts:2047-2048` | **LLM prompt örneğinde** — model bunu üretmeye teşvik ediliyor |

**Kök neden:** Filler bir UX tercihi değil, **seri pipeline'ın gecikmesini örten bir
yara bandıdır.** Streaming geldiğinde 1–5 gereksiz kalır; 6 prompt'tan çıkarılmalıdır.

**Yan hasar (kodda belgelenmiş):** `voiceService.ts:1691-1695` — geç ateşleyen filler
başlamış cevap TTS'ini **kesiyordu**; düzeltmek için erken `clearTimeout` eklendi.
Filler mekanizması kendisi bir hata kaynağı olmuş.

### 2.8 Konuşma hafızası — ÜÇ AYRI SİSTEM

| Sistem | Kapsam | Kalıcılık | Durum |
|--------|--------|-----------|-------|
| `companionChatProvider._history` | Tur içi diyalog | **RAM** | CANLI |
| `companionMemory.ts` (144) | Kullanıcının AÇIKÇA istediği fact (max 15 × 120 char) | `safeStorage` | CANLI |
| `ai/memory/memoryEngine.ts` (184) | Görev bazlı allowlist + bütçe + hassas veri kapısı | DI | **BAYRAK KAPALI** |
| `maviCore/contextStore.ts` (210) | Son eylem / ekran + tur halkası | RAM | **SHADOW** |

**[BORÇ B7a]** *Trip Memory* (yolculuk boyu hafıza) **hiçbir yerde yok**.
**[BORÇ B7b]** Explicit ↔ inferred preference ayrımı **yok**; inferred için
confidence / evidence / decay / correction mekanizması **yok**.

### 2.9 Context kaynakları (ÖLÇÜLDÜ)

| Kaynak | Modül | Mavi'ye ulaşıyor mu |
|--------|-------|---------------------|
| Araç (OBD) | `assistant/maviVehicleContext.ts` — komut başına tek dondurulmuş snapshot | ✅ CANLI |
| Yakıt / menzil / ısı / DTC yorumu | `companion/companionContext.ts` (865) | ✅ CANLI |
| Konum | `location/locationContextAccess` (ince kapı) | ✅ CANLI |
| Navigasyon | `getNavigationState()` | ✅ CANLI |
| Trip | `tripLogService` + `trip/tripSessionAccess` | ✅ CANLI |
| Medya | `getMediaState()` | ✅ CANLI |
| Hava | `weatherService` | ✅ CANLI |
| Sürücü stili | `classifyDriverStyle` | ✅ CANLI |
| Kanıt omurgası | `fleet/aiEvidence*` → `maviReasoningEngine` | ⚠️ AYRI HAT |
| Context Engine | `ai/context/contextCollector` (246) | ❌ BAYRAK KAPALI |

**Güçlü nokta [ÖLÇÜLDÜ]:** `voiceService.ts:1681-1683` — hız `null` ise prompt'a
**alan hiç taşınmıyor**: *"sahte 0 km/h bağlamı = sahte 'araç duruyor' iddiası"*.
Bu zaten zero-trust telemetri disiplinidir.

**[BORÇ B10]** Hiçbir context datum'u tekil, tiplenmiş bir zarfa
(source / timestamp / freshness / confidence / provenance / scope / availability)
sarılmıyor. Tazelik kararı her tüketicide ayrı ve ad-hoc.

### 2.10 Capability / tool sistemi

- **`capabilityRegistry.ts` (762) — OEM seviyesinde:** domain · status
  (`available | unavailable | unknown | degraded | restricted | unsupported`) ·
  quality · confidence · source · provider · version · limitations · stale ·
  `deviceTierMinimum` · `safetyCritical` · `writable` · `experimental`.
  Zero-trust + fail-closed karar ilkesi modül başlığında yazılı.
  **Ama** `capability/index.ts:4`: *"SystemBoot / Assistant / UI WIRING yapmaz"* →
  **Mavi bunu hiç okumuyor.**
- **`ai/tools/`** (`toolRouter` 224 + `maviTools` 217 + `toolLoop` 169): 7 kapılı
  fail-closed router; Faz-1'de yalnız `read` / `navigate` etkisi.
  Allowlist **5 araç**. **Bayrak kapalı.**
- **`maviCore/actionRegistry`** (310): typed action defteri — **shadow**.
- **`maviActionAuthority`** (canlı): **13 araç etkili eylem** —
  `vehicle.doors.lock/unlock` · `vehicle.horn.sound` · `vehicle.lights.flash/off` ·
  `vehicle.alarm.on/off` · `vehicle.camera.rear` · `vehicle.screen.off` ·
  `vehicle.dtc.clear` · `vehicle.health.read` · `vehicle.sensor.read` · `phone.call.start`.
  **Media / navigation / settings / climate BU DEFTERDE YOK** — onlar `intentEngine`
  ve `commandExecutor` içinde dağınık.

### 2.11 Navigation bağlantısı

- `navigationService.ts` kanonik otorite: `claimRouteRequest` / `releaseRouteRequest`
  (satır 275 / 283) ile **tek rota talebi sahipliği**, `getNavSessionId()` kuşağı,
  destination integrity snapshot'ı, `getEtaVerdict()`.
- Mavi bağlantısı: `platformCoreMaviVoiceWiring.ts:26-27` → `resolveAndNavigate`,
  `stopNavigation` (shadow) + canlı hatta `intentEngine` üzerinden.
- `navigation/enforcement`, `navigation/policy`, `navigation/guardian` alt klasörleri
  ayrı bir arbitraj/dikkat otoritesi barındırıyor (bkz. `NAVIGATION_OEM_PLUS_ARCHITECTURE`).

### 2.12 Music / Media bağlantısı — **PROJENİN EN GÜÇLÜ PARÇASI**

`media/authority/playbackTruth.ts`:
- `TruthStage` **14 aşama**: `command_received` · `intent_resolved` · `source_resolved` ·
  `playback_requested` · `transport_acknowledged` · `player_preparing` ·
  `playback_started` · `playback_observed` · `audible_verification_supported` ·
  `audible_verified` · `playback_failed` · `timed_out` · `cancelled` · `superseded`
- `VerificationLevel` **5 kademe**:
  `NONE < TRANSPORT_ACK < REMOTE_STATE_OBSERVED < OBSERVED_STARTED < RENDERING_VERIFIED`
- Modül başlığı birebir: *"Kullanıcı sessizlik duyarken uygulama 'çalıyor' diyordu —
  ve Mavi de aynı yalanı sesli tekrarlıyordu."*
- Mavi bağlantısı: `maviMediaAuthorityPort.ts` (263) + `honestClaim()` +
  `isUncertainOutcome()` (`platformCoreMaviVoiceWiring.ts:44-47`).

> **Bu tam olarak §6'daki `desired ≠ executed ≠ observed` sözleşmesidir — ve
> yalnız medyada uygulanmıştır. Hedef mimari bunu bütün domainlere genelleştirir.**

### 2.13 Vehicle / OBD / CAN bağlantısı

- `aiCore/safetyGate.ts` — `HARD_FORBIDDEN_SCOPES = { ecu_write, coding, adaptation,
  actuator }`; **hiçbir config açamaz** (savunma derinliği, satır 47-50).
- `obd/dtcAuthority.evaluateVehicleDtcVerdict()` — **dört değerli hüküm**:
  `issues · clean · unproven · not_scanned`. *"0 kod ≠ temiz"* kilidi; dört ayrı
  tüketicinin (`commandExecutor._buildDTCSpeech` · `platformCoreMaviVoiceWiring` ·
  `maviTools.read_dtc` · `useAssistantContextStore`) aynı yalanı söylemesi kapatılmış.
- `maviReasoningEngine.ts` (751) — **LLM'siz** karar otoritesi: kanıt → süresi dolan
  ayıklama → çelişki → karar → **türetilmiş** confidence. Tek veri kapısı `fleet/aiEvidence*`.
- `aiCore/`: `verdictEngine` · `evidenceStore` · `vehicleMemory` · `halAdapter` · `diagnosticEvidence`.

### 2.14 Settings bağlantısı

`SET_SETTING` intent'i **13 boolean anahtarı** destekliyor (`companionChatProvider.ts:1991`):
`performanceMode` · `offlineMap` · `autoThemeEnabled` · `autoBrightnessEnabled` ·
`breakReminderEnabled` · `dockAutoHide` · `smartContextEnabled` · `obdAutoSleep` ·
`autoNavOnStart` · `companionEnabled` · `companionWakeWordEnabled` · `use24Hour` · `showSeconds`.

**[BORÇ B9]** Bu liste **LLM prompt'una gömülü tek bir string**. Yeni ayar eklendiğinde
prompt elle güncellenmeli — capability sözleşmesi yok.
**[BORÇ B9b · fail-closed ihlali]** `companionEnabled` listede: **Mavi kendi beynini
sesle kapatabiliyor** ve kapandıktan sonra kendini geri açacak beyin yok.

### 2.15 Phone / connectivity

- `phone.call.start` — `risk: 'high'`, **`requiresConfirmation: false`**
  (`maviActionAuthority.ts:208`). Koruma dolaylı: `pendingActionConfirmation` +
  `sequenceConfirmationPolicy`.
- `phoneHub/` + `companion/` (8877 satır) = **telefon eşleştirme altyapısı**;
  transport'ların tamamı sözleşme, **yalnız `MOCK` uygulanmış**
  (`companionDomain.ts:38-45`, statik tarama ile kilitli).

> ⚠️ **İSİM ÇAKIŞMASI (kritik):** Repoda `companion/` = **telefon companion (Phone Hub)**.
> Ürün dilinde "Yol Arkadaşı" da companion. Bu belge **`roadCompanion/`** adını zorunlu
> kılar (§15); `companion/` telefon içindir ve **yeniden adlandırılmaz** (risk).

### 2.16 UI

- `VoiceAssistant.tsx` (677) — overlay: waveform · güven çubuğu · geçmiş · hızlı komut ızgarası.
- `livingThemeState.ts` — `CompanionStatus = idle | listening | processing | speaking` (4 durum).
- `voiceOverlayShouldAutoClose(followUp)` — takip dinlemesinde pencere kapanmaz kilidi
  (saha bug'ı 2026-07-03'ün kilidi).
- **[BORÇ B11]** `ambient` · `action` · `confirmation` · `proactive` · `degraded` durumları yok.
- **[BORÇ B11b]** Compact (sürüş) / expanded (park) yüzey ayrımı yok.

### 2.17 Audio arbitration — **OEM SEVİYESİ, DEĞİŞTİRİLMEYECEK**

`android/app/src/main/java/com/cockpitos/pro/media/CarosAudioFocusManager.java`:

```
EMERGENCY > SAFETY > NAVIGATION > PHONE > MAVI > MEDIA
```

- Nested duck + **token bazlı restore** — bayat token sesi yükseltemez
- En agresif (en düşük) çarpan kazanır
- ExoPlayer'ın kendi focus'u **kapalı**; otorite tek
- "Kullanıcı mı duraklattı, focus mu duraklattı" ayrımı korunuyor
- `audioService.ts`: `DUCK_LEVEL 0.30` (ISO 22262) · duck 0.10 s / unduck 0.40 s rampa ·
  referans sayaçlı (`_duckCount`) · SVC (hız-ses telafisi) Schmidt trigger'lı

### 2.18 Mevcut authority / truth sistemleri — TAM LİSTE

| # | Otorite | Modül | Alan |
|---|---------|-------|------|
| 1 | `AiSafetyGate` | `aiCore/safetyGate.ts` | Araç erişim kapsamı (hard-forbidden) |
| 2 | `assistantSafetyKernel` | `assistant/assistantSafetyKernel.ts` | PRE / POST gate — kritik durumda online'ı kapatır |
| 3 | `maviActionAuthority` | `action/maviActionAuthority.ts` | Araç etkili eylem kapısı (4 kapı sırası) |
| 4 | `maviTurn` | `assistant/maviTurn.ts` | Tur kimliği — stale cevap eylem/konuşma yetkisi alamaz |
| 5 | `maviSpeech` | `assistant/maviSpeech.ts` | Tur başına **tek** `answer` seslendirme |
| 6 | `MediaCommandGateway` + `playbackTruth` | `media/authority/*` | Oynatma gerçeği |
| 7 | `dtcAuthority` | `obd/dtcAuthority.ts` | DTC hükmü (4 değerli) |
| 8 | `navigationService` claim | `navigationService.ts:275` | Rota talebi sahipliği |
| 9 | `CarosAudioFocusManager` | native | Ses / duck |
| 10 | `takeoverArbiter` | `maviCore/wiring/takeoverArbiter.ts` | Hangi hat yürütür (fail-open) |
| 11 | `maviReasoningEngine` | `reasoning/maviReasoningEngine.ts` | Kanıt → karar (LLM'siz) |
| 12 | `capabilityRegistry` | `capability/capabilityRegistry.ts` | Yetenek gerçeği (**Mavi'ye bağlı değil**) |
| 13 | `CognitivePriorityEngine` | `system/CognitivePriorityEngine.ts` | Kognitif mod (`useCognitiveStore`) |

**Değerlendirme:** Bu, çoğu OEM'de bulunmayan bir otorite disiplinidir.
**Sorun otorite eksikliği değil, otoritelerin Mavi'ye tek yüzeyden bağlanmamasıdır.**

### 2.19 Teknik borç envanteri

| # | Borç | Kanıt | Şiddet |
|---|------|-------|--------|
| B1 | Üç paralel Mavi hattı | §2.1 | **KRİTİK** |
| B2 | Streaming yok (ASR / LLM / TTS) | §2.2; `openRouterProvider:440` kullanılmıyor | **KRİTİK** |
| B3 | `companionEnabled=false` beyni tamamen öldürüyor | `companionChatProvider.ts:2358, 2672, 2785, 2851` | **KRİTİK** |
| B4 | Filler 6 ayrı kaynakta (biri LLM prompt'unda) | §2.7 | YÜKSEK |
| B5 | Capability Registry Mavi'ye bağlı değil | `capability/index.ts:4` | YÜKSEK |
| B6 | Compound command yok (tur başına tek intent) | `intentEngine.ts` tek `IntentType` | YÜKSEK |
| B7 | Trip Memory yok · inferred preference yok | §2.8 | YÜKSEK |
| B8 | `phone.call.start` `requiresConfirmation:false` | `maviActionAuthority.ts:208` | YÜKSEK |
| B9 | Ayar allowlist'i prompt string'i · `companionEnabled` sesle kapatılabiliyor | `companionChatProvider.ts:1991` | ORTA |
| B10 | Context datum'ları zarfsız (freshness / provenance dağınık) | §2.9 | ORTA |
| B11 | UI'da yalnız 4 durum · compact/expanded yok | §2.16 | ORTA |
| B12 | Edge TTS birinci taraf sunucu bağımlılığı | `edgeTtsService.ts:15` | ORTA |
| B13 | 11 bayrak varsayılan kapalı → ölü kod riski | `aiGatewayFlag.ts` | ORTA |
| B14 | Prompt injection savunması yalnız memory katmanında | `sensitiveMemoryGuard.ts` | ORTA |
| B15 | `latencyTelemetry` shadow'da → canlı hatta segment ölçümü yok | `maviCore/latencyTelemetry.ts` | ORTA |

### 2.20 Korunması gereken güçlü parçalar

→ **§3 KEEP LİSTESİ**
---

## 3. KEEP — KORUNACAK MİMARİ (PAZARLIKSIZ)

Aşağıdaki on iki parça **rewrite edilmeyecek, yerine yenisi yazılmayacak,
paralel sistemi kurulmayacaktır.** Hedef mimari bunların ÜSTÜNE inşa edilir.

| # | Parça | Neden korunuyor | Dokunma kuralı |
|---|-------|-----------------|----------------|
| K1 | `CarosAudioFocusManager` (native) | Nested duck + token restore + öncelik zinciri — OEM seviyesi | Mavi **abone**dir, otorite değil |
| K2 | `playbackTruth` + `MediaCommandGateway` | `desired ≠ executed ≠ observed`'ın çalışan referans uygulaması | **Genelleştirilecek**, değiştirilmeyecek |
| K3 | `AiSafetyGate` + `HARD_FORBIDDEN_SCOPES` | ECU write / coding / adaptation / actuator daimî yasak | Hiçbir faz bunu gevşetemez |
| K4 | `assistantSafetyKernel` PRE/POST gate | Kritik araç durumunda online'ı kapatan yerel deterministik kapı | Streaming'de de **her iki gate korunur** |
| K5 | `maviTurn` tur kimliği | Stale cevabın eylem/konuşma yetkisini kesen anayasa | Streaming turu bunun ÜSTÜNE kurulur |
| K6 | `maviSpeech` tek-`answer` otoritesi | Tur başına tek nihai cevap → çift TTS yapısal olarak imkânsız | Streaming'de "tek answer akışı" olur |
| K7 | `dtcAuthority` 4 değerli hüküm | "0 kod ≠ temiz" — dürüstlük kilidi | Aynen |
| K8 | `maviReasoningEngine` | LLM'siz, kanıttan türetilmiş confidence'lı karar otoritesi | LLM bu kararı **EZEMEZ** |
| K9 | `capabilityRegistry` | Zero-trust yetenek gerçeği · `unknown ≠ available` | **Genişletilecek**, yeniden yazılmayacak |
| K10 | `maviCore` saf kütüphaneleri (`lifecycle` · `actionRegistry` · `executionEngine` · `intentResolver` · `latencyTelemetry`) | Zaten doğru tasarlanmış, test edilmiş | **SHADOW'dan çıkarılıp canlı hale getirilecek** |
| K11 | `navigationService` claim/session/verdict | Tek rota talebi sahipliği + ETA hükmü | Mavi **claim eder**, yeni truth kurmaz |
| K12 | `voiceTuning` zaman hiyerarşisi kilidi | `warmup + maxListen < listenFailsafe < uiSafetyClose` | Streaming'de yeni hiyerarşi de **test ile kilitlenecek** |

**Ek KEEP (davranış kilitleri):**
- `voiceService.ts:1681-1683` — bilinmeyen sensör alanının prompt'a hiç girmemesi.
- `NO_NET_EVIDENCE_KINDS` kara listesi — sessiz sahte offline yasağı.
- `sensitiveMemoryGuard` — hafızadan AI'ya taşımada hassas veri kapısı.
- `takeoverArbiter` fail-open sözleşmesi — hakem hiçbir koşulda eski hattı susturamaz.
- `regression.guards.test.ts` — kilitler zayıflatılmaz, yalnız güncellenir.

---

## 4. MEVCUT KRİTİK BOŞLUKLAR (CURRENT CRITICAL GAPS)

### G1 — Konuşma **seri**; hiçbir aşama kısmi sonuç vermiyor · **KRİTİK**
Wake dışında tüm zincir "tamamlanmayı bekle" modelinde. Sonuç: kullanıcı 3–6 saniye
sessizlik duyuyor, bu sessizlik filler ile örtülüyor, filler kendisi cevabı kesiyor.

### G2 — **Yol Arkadaşı = beyin şalteri** · **KRİTİK · ANAYASA İHLALİ**
`companionEnabled !== true` → `tryCompanionBrain` / `tryCompanionChat` **null**.
Kapalıyken Mavi tam yetenekli CarOS asistanı **değil**, yalnız yerel regex parser'dır.
Kullanıcının ürün tanımı bunun tam tersini şart koşuyor.

### G3 — **Üç Mavi** · **KRİTİK**
Aynı işi yapan üç kod tabanı; ikisi ölü. Her yeni özellik "hangi hatta?" sorusunu
doğuruyor; testler üç kez yazılıyor; borç üç katına çıkıyor.

### G4 — **Capability Fabric yok** · YÜKSEK
Mavi'nin CarOS'u kullanma yolu: prompt'a gömülü ayar listesi + `intentEngine`'de
50 sabit intent + `commandExecutor`'da `switch`. Yeni CarOS modülü eklendiğinde
**Mavi core'u değişmek zorunda.**

### G5 — **Compound command yok** · YÜKSEK
"Eve rota aç, müziği kıs, annemi ara" → bugün tek intent'e düşer, ikisi kaybolur.
`executionEngine` (çok adımlı, rollback'li) shadow'da bekliyor.

### G6 — **Plan ≠ yürütme ≠ gözlem yalnız medyada** · YÜKSEK
Navigation, settings, phone, climate, vehicle için "yaptım" iddiası hâlâ
**iyimser**. `intentExecutionResult` bir adım atmış ama `VerificationLevel` yok.

### G7 — **Trip Memory ve inferred preference yok** · YÜKSEK
Uzun yolda "az önce konuştuğumuz konu" ve "bu kullanıcı hakkında öğrendiğim şey"
kavramları mimaride yok.

### G8 — **Driver workload sinyali arıza-güdümlü, sürüş-güdümlü değil** · YÜKSEK
`CognitiveMode` yalnız `SystemHealthMonitor` / `SystemOrchestrator` / performans
tarafından set ediliyor (`CognitivePriorityEngine.ts:124,144`). **Karmaşık kavşak,
şerit değiştirme, yoğun trafik gibi SÜRÜŞ yükü Mavi'nin konuşkanlığını
etkilemiyor.** Navigation'da `guardian` var ama Mavi'ye bağlı değil.

### G9 — **Proaktiflik tek bir motorda ve şablon tabanlı** · ORTA
`companionEngine` 60 s tick + 5 tetik + chattiness bütçesi. İyi tasarlanmış ama:
merkezi bir **Proactive Policy Engine** değil; navigation/vehicle/fleet tarafındaki
proaktif ihtiyaçlar buraya bağlanamıyor.

### G10 — **UI durum modeli yetersiz** · ORTA
4 durum; `action` / `confirmation` / `proactive` / `degraded` gösterilemiyor.

### G11 — **Gözlemlenebilirlik canlı hatta segment düzeyinde değil** · ORTA
`sttLatencyTelemetry` mükemmel (native faz enstrümantasyonu) ama **STT'de bitiyor**.
`speech-end → first audio` uçtan uca ölçülmüyor.

### G12 — **Prompt injection savunması dar** · ORTA
Yalnız hafıza bloğu "VERİdir, TALİMAT DEĞİLDİR" etiketli. Araç/POI/medya metadata,
kişi adları, arama sonuçları aynı korumaya sahip değil.

---

## 5. ÜRÜN İNVARYANTLARI (PRODUCT INVARIANTS — DEĞİŞMEZ)

Bu on iki madde her PR'da doğrulanır; ihlal eden PR **reddedilir**.

| # | İnvaryant |
|---|-----------|
| **I1** | **TEK MAVİ.** Sohbet Mavi'si ve kontrol Mavi'si diye iki varlık yoktur; tek conversation context, tek turn, tek cevap otoritesi. |
| **I2** | **Yol Arkadaşı bir capability kısıtlaması DEĞİLDİR.** Kapalıyken Mavi tam yetenekli CarOS asistanıdır; yalnız *proaktif konuşma / sohbet sürdürme / trip companionship* susar. |
| **I3** | **Mavi UI'ya tıklamaz.** CarOS'u yalnız typed Capability Fabric üzerinden kullanır. UI otomasyonu / synthetic tap YASAK. |
| **I4** | **LLM otorite değildir.** Model önerir; kapı karar verir. Tool çağırabilmek yetki kazandırmaz. |
| **I5** | **plan ≠ execution ≠ observed.** Mavi gözlemlenmemiş sonucu "yaptım" diye söyleyemez; `ACCEPTED_UNVERIFIED` ayrı bir dildir. |
| **I6** | **Normal konuşma ağır reasoning'e mahkûm edilmez.** Fast path zorunludur. |
| **I7** | **Internal reasoning kullanıcıya okunmaz.** Model düşüncesi, ara plan, tool adı, hata gövdesi seslendirilmez. |
| **I8** | **Mavi yeni truth sistemi kurmaz.** Navigation / Media / Vehicle / DTC / Audio kanonik otoriteleri tektir. |
| **I9** | **Cloud yokken Mavi yaşar.** Wake · deterministic komut · kritik capability · cached context · offline cevap çalışmaya devam eder. |
| **I10** | **AI hiçbir zaman safety-critical vehicle authority olamaz.** Direksiyon / fren / gaz / ECU write / coding / adaptation / actuator — fail-closed, config ile açılamaz. |
| **I11** | **Yapay filler yasaktır.** "Bakayım / düşünüyorum / bir saniye" sınıfı ara söz üretilmez; gerçek bilgi taşıyan kısa ack (§9.6) serbesttir. |
| **I12** | **Bilinmeyen `UNKNOWN`'dır.** Sahte 0, sahte tarih, sahte "sağlıklı", sahte "çalıyor" yasak. |

---

## 6. HEDEF MİMARİ — **MAVI CORE v2 (MCX)**

### 6.1 Tek cümlelik hedef

> Mavi = **tek turn otoritesi** altında çalışan, **streaming** algılayan,
> **üç yollu** (fast / deterministic / deep) yönlendirilen, CarOS'u **typed
> capability fabric** üzerinden kullanan, **gözlemlenmiş sonuç** konuşan,
> **presence policy** ile ne zaman konuşacağına karar veren bir Automotive
> Intelligence Platform.

### 6.2 Katman haritası

```
L0  SÖZLEŞMELER          MaviTurn · CapabilityContract · ContextDatum · Plan · Observation
L1  ALGI (PERCEPTION)    Wake · Streaming ASR · Endpointer · BargeIn · AudioIn
L2  ANLAMA               IncrementalUnderstanding · IntentResolver · ContextResolution
L3  YÖNLENDİRME          MaviRouter → FAST | DETERMINISTIC | DEEP
L4  PLANLAMA             Planner (compound · dependency · ordering)
L5  POLİTİKA / GÜVENLİK  SafetyKernel · ActionAuthority · AiSafetyGate · WorkloadPolicy
L6  YETENEK              Universal Capability Fabric (registry + adapters)
L7  YÜRÜTME              ExecutionEngine (timeout · rollback · partial · dedupe · stale)
L8  GÖZLEM               ObservationBus → VerificationLevel · Reconciliation
L9  DİL / SES            ResponseComposer → StreamingTTS → AudioArbitration
L10 PRESENCE             RoadCompanionEngine · ProactivePolicyEngine
L11 HAFIZA               TurnMemory · TripMemory · LongTermMemory
L12 GÖZLEMLENEBİLİRLİK   MaviTelemetry → CAROS LAB
```

### 6.3 Kritik tasarım kararları

1. **`maviCore` SHADOW'dan çıkar, MCX olur.** Yeni state machine yazılmaz;
   `maviLifecycle` genişletilir (`ambient` · `confirming` · `proactive` · `degraded`).
2. **`voiceService` "algı sürücüsü"ne indirgenir.** Bugünkü 2333 satırın
   karar/route/TTS kısımları MCX'e taşınır; mikrofon/native/STT sürücüsü kalır.
3. **`companionChatProvider` "DEEP path sağlayıcısı"na indirgenir.** Router,
   safety pre/post gate, memory, context enjeksiyonu MCX'e taşınır.
4. **Capability Fabric = `capabilityRegistry` + `CapabilityContract` katmanı.**
   Yeni registry kurulmaz; `capabilityRegistry` kaydına **operations** eklenir.
5. **Her domain kendi `*AuthorityPort`unu yazar** (`maviMediaAuthorityPort` deseni).
   MCX porta konuşur, servise değil.

---

## 7. BİLEŞEN / VERİ AKIŞI

### 7.1 Ana akış (tek tur)

```
 ┌─────────── SES GİRİŞİ (full-duplex) ────────────────────────────────────┐
 │ mic ──► WakeDetector ──► StreamingASR ──► SemanticEndpointer            │
 │           (partial)        (partial)         (turn-end tahmini)         │
 └───┬──────────────────────────┬───────────────────────────┬─────────────┘
     │ wake                     │ partial transcript        │ final
     ▼                          ▼                           ▼
  ┌───────────────────────── MAVI TURN (tek otorite) ──────────────────────┐
  │ turnId · generation · sessionId · startedAt · authority                │
  └───┬────────────────────────────────────────────────────────────────────┘
      ▼
  IncrementalUnderstanding ──► ContextResolution ──► MaviRouter
      │  (partial intent)         (referans/deixis)      │
      │                                                  ├─► FAST PATH
      │                                                  ├─► DETERMINISTIC PATH
      │                                                  └─► DEEP PATH
      ▼
  ┌──────────── PLANNER ─────────────┐
  │ Plan { steps[] · deps · order }  │
  └───┬──────────────────────────────┘
      ▼
  ┌──────────── POLICY / SAFETY GATE ────────────────────────────────────┐
  │ 1. WorkloadPolicy  2. SafetyKernel PRE  3. ActionAuthority           │
  │ 4. AiSafetyGate    5. Confirmation      6. Capability availability   │
  └───┬──────────────────────────────────────────────────────────────────┘
      ▼
  ┌──────────── CAPABILITY FABRIC ───────────────────────────────────────┐
  │ nav.* │ media.* │ phone.* │ vehicle.* │ settings.* │ climate.* │ …   │
  │   └── her biri: operations · availability · state · executionContract │
  └───┬──────────────────────────────────────────────────────────────────┘
      ▼
  ExecutionEngine ──► kanonik servis/otorite ──► ObservationBus
      │                                              │
      │                                              ▼
      │                                        Reconciliation
      │                                  (desired vs executed vs observed)
      ▼                                              │
  ResponseComposer ◄───────────────────────────────┘
      │  (yalnız GÖZLEMLENMİŞ sonuçtan cümle kurar)
      ▼
  StreamingTTS ──► AudioArbitration (K1) ──► hoparlör
      │
      └──► BargeIn dinleyicisi AÇIK (konuşurken bile mikrofon aktif)
```

### 7.2 Yan akışlar

```
ContextIntelligence ──► (ContextDatum zarfı) ──► ContextResolution / DEEP prompt
   ▲   OBD · CAN · GPS · Route · Traffic · Trip · Media · Phone · Net · Time · Weather

RoadCompanionEngine ──► ProactivePolicyEngine ──► (izin verilirse) MaviTurn(proactive)
   ▲   WorkloadPolicy · cooldown · relevance · confidence · user preference

MaviTelemetry ──► CAROS LAB (salt-okunur, komut göndermez)
```

---

## 8. AUTHORITY MAP (YETKİ HARİTASI)

### 8.1 Kim neye karar verir

| Karar | **TEK** otorite | Mavi'nin rolü |
|-------|-----------------|---------------|
| Araç ECU erişim kapsamı | `AiSafetyGate` | Sorar, uyar |
| Kritik araç durumu / online kesme | `assistantSafetyKernel` | Uyar |
| Araç etkili eylem izni | `maviActionAuthority` (genişletilmiş) | Sorar |
| Oynatma gerçeği | `playbackTruth` / `MediaCommandGateway` | Okur, **iddia etmez** |
| DTC hükmü | `dtcAuthority` | Okur |
| Rota talebi sahipliği | `navigationService.claimRouteRequest` | Claim eder |
| Ses focus / duck | `CarosAudioFocusManager` | **Abone**, sebep bildirir (`REASON_MAVI`) |
| Kanıt → karar | `maviReasoningEngine` | Okur; LLM **ezemez** |
| Yetenek var mı | `capabilityRegistry` | Okur |
| Kognitif mod | `CognitivePriorityEngine` | Okur |
| Sürüş yükü | **`DriverWorkloadPolicy`** [TASARIM] | Okur |
| Tur güncelliği | `maviTurn` | **Sahibi** |
| Nihai cevap seslendirme | `maviSpeech` | **Sahibi** |
| Konuşma sırası (turn-taking) | **`TurnArbiter`** [TASARIM] | **Sahibi** |
| Proaktif konuşma izni | **`ProactivePolicyEngine`** [TASARIM] | **Sahibi** |

### 8.2 Mavi'nin **SAHİP OLDUĞU** dört şey

1. `MaviTurn` — tur kimliği ve güncellik.
2. `maviSpeech` — tur başına tek nihai cevap.
3. `TurnArbiter` — kim konuşuyor / kim dinliyor.
4. `ProactivePolicyEngine` — konuşmaya değer mi.

**Bunların dışında Mavi hiçbir gerçeğin sahibi değildir.**

### 8.3 Eylem yetki sınıfları (§14 ile birlikte okunur)

```
READ            → gözlem; onay yok; her tier · her hız
SUGGEST         → yalnız öneri; yürütme yok
SAFE_DIRECT     → geri alınabilir, düşük risk (tema, ses, ekran)
PREPARE         → hazırla ama uygulama (rota hesapla, sıraya al)
CONFIRM_THEN_ACT→ açık kullanıcı onayı zorunlu (arama, kilit, DTC sil)
RESTRICTED      → yalnız park + capability kanıtı + onay
PROHIBITED      → daimî yasak (steering/brake/throttle/ECU write/coding/adaptation/actuator)
```
---

## 9. GERÇEK ZAMANLI KONUŞMA MİMARİSİ

### 9.1 Temel dönüşüm

| Bugün | Hedef |
|-------|-------|
| `capture → tam metin → tam karar → tam cümle → tam sentez → ses` | `partial → partial → erken taahhüt → akan cümle → akan ses` |
| Tek yönlü (half-duplex) | **Full-duplex** — Mavi konuşurken mikrofon açık |
| Gecikme filler ile örtülür | Gecikme **yapısal olarak** azaltılır |

### 9.2 Streaming ASR

**[TASARIM]** Native tarafta iki değişiklik:

1. **Vosk döngüsü partial yayınlar.** `runVoskListening` içinde her pencerede
   `getPartialResult()` zaten okunuyor (wake yolunda, `CarLauncherPlugin.java:4551`).
   Aktif dinleme yolunda da `notifyListeners("sttPartial", {text, stableLen, tMs})`
   emitlenir. **Yeni ses yakalama açılmaz** — aynı döngü, ek event.
2. **Android `SpeechRecognizer.onPartialResults` doldurulur**
   (`CarLauncherPlugin.java:3452` — bugün boş gövde).

JS tarafında: `voiceService` `onSttPartial` aboneliği açar; partial **hiçbir eylem
tetiklemez**, yalnız L2'ye akar.

> **İnvaryant:** Partial transcript **asla** eylem yetkisi vermez. Yetki yalnız
> `final` + `MaviTurn.active` ile doğar (K5 korunur).

### 9.3 Semantic endpointing

Bugün endpoint tamamen akustiktir: RMS-VAD, `VOSK_VAD_SILENCE_MS = 1100`.
Bu, kullanıcı cümle ortasında düşünürken erken kesmemek için **bilinçli olarak
900'den 1100'e çıkarılmış** (`CarLauncherPlugin.java:3301`).

**[TASARIM] Hibrit endpointer:**

```
turnEndConfidence = w1·acousticSilence + w2·syntacticCompleteness
                  + w3·intentCompleteness + w4·prosodyFall
```

| Durum | Sessizlik eşiği |
|-------|-----------------|
| Intent tamam + sözdizimi tamam ("müziği durdur") | **350 ms** |
| Intent tamam, entity eksik ("… rota aç") | 700 ms |
| Belirsiz / serbest sohbet | 1100 ms (bugünkü değer korunur) |
| Kullanıcı sayı/adres sayıyor | 1600 ms (uzatma) |

**Kazanç [TÜRETİLDİ]:** deterministik komutlarda endpoint gecikmesinden **~750 ms**.

### 9.4 Streaming LLM

`openRouterProvider` SSE + `onToken` **zaten var** (`:440-470`). Yapılacak:

1. `AiGenerateRequest.stream = true` + `onToken` MCX'ten geçirilir.
2. Gemini için `streamGenerateContent` alt-sürümü eklenir (bugün NON-STREAMING).
3. **Cümle sınırı flush'ı:** `speechSegment.ts` (174 satır, mevcut) ilk cümleyi
   tespit ettiği anda TTS'e verilir.
4. **Çift token yasağı korunur** — `openRouterProvider` akış ortasında koparsa
   gateway **retry etmez** (`:463-465`); bu davranış aynen kalır.

### 9.5 Streaming TTS

**Katman sırası (değişmez), akış eklenir:**

| Katman | Streaming stratejisi |
|--------|----------------------|
| `voiceClips` | Zaten anında (önceden sentezlenmiş) — **ilk sesi bu verir** |
| Edge TTS | **Cümle bazlı chunk** — 1. cümle sentezlenirken 2. cümle istenir |
| Gemini TTS | Aynı chunk stratejisi |
| Native `speak()` | `QUEUE_ADD` ile ardışık cümle (mevcut `speak` zaten queue destekli, `CarLauncherPlugin.java:5825`) |
| Web `speechSynthesis` | Segment bazlı (mevcut `segmentSpeech` kullanılır) |

**[BORÇ B12 çözümü]** Offline'da Edge/Gemini yok → native/eSpeak erkek sese düşüyor.
**[TASARIM]** `voiceClips` sözlüğü **genişletilir**: en sık 200 ifade (onay, ret,
navigasyon ackleri, sayılar 0-99, sık kullanılan cümle başları) offline premium
kadın klip olarak paketlenir → offline tutarlı kişilik + sıfır sentez gecikmesi.

### 9.6 Ack politikası — filler ile ack farkı

**YASAK (I11):** İçeriksiz zaman doldurma — *"Bakayım", "Düşünüyorum", "Bir saniye"*.

**SERBEST:** **Semantik olarak faydalı**, kısa, gerçek bilgi taşıyan ack:

| Durum | İzin | Örnek |
|-------|------|-------|
| Uzun sürecek gerçek iş başladı ve kullanıcı bunu bilmeli | ✅ | *"Ev adresini arıyorum."* |
| Belirsizlik giderme | ✅ | *"Annen mi, kayınvaliden mi?"* |
| Yetenek yok | ✅ | *"Klima kontrolü bu araçta yok."* |
| Sadece gecikmeyi örtmek | ❌ | *"Bir saniye..."* |
| Model düşünüyor | ❌ | *"Düşünüyorum..."* |

**Kural:** Bir ack ancak **kullanıcının davranışını değiştirebiliyorsa** meşrudur.

### 9.7 Barge-in / kesme

**Mevcut altyapı [ÖLÇÜLDÜ]:** `ttsCancel()` + `interruptAndListen()` + `maviTurn`
supersede + `_assistantGen` nesil koruması + `_speakSeq` — **kesme mekaniği zaten var.**
**Eksik:** Mavi konuşurken **mikrofon kapalı** (half-duplex; native
`wakeMicMustYield()` TTS sırasında mikrofonu bırakıyor).

**[TASARIM] Full-duplex:**

1. TTS sırasında mikrofon **açık kalır**; AEC (`AcousticEchoCanceler`, kodda zaten
   kullanılıyor) + referans sinyali ile kendi sesini bastırır.
2. Wake grammar thread yerine **hafif VAD + wake grammar** koşar.
3. Kullanıcı konuşmaya başladığı an → `BargeInEvent` → `ttsCancel()` (**< 120 ms hedef**)
   → `MaviTurn.supersede()` → yeni tur.
4. **Fail-soft:** AEC yeterli değilse (ölçüm ile kanıtlanır) half-duplex'e döner —
   davranış bugünküyle **birebir aynı** olur. Bu bir tier kararıdır, `DeviceTier`'a bağlanır.

### 9.8 Turn-taking · overlap · self-correction

| Olay | Davranış |
|------|----------|
| Kullanıcı Mavi'nin sözünü kesti | Mavi **anında susar**, "affedersin" demez, yeni turu işler |
| Kullanıcı kendini düzeltti ("Ankara'ya… yok, İzmir'e") | IncrementalUnderstanding **son geçerli entity**'yi alır; iki plan üretilmez |
| Kullanıcı ve Mavi aynı anda başladı | **Kullanıcı kazanır** (daima) |
| Kullanıcı yarım bıraktı, 2 s sessiz | Mavi **sormaz**, bekler; 6 s'de turu sessizce kapatır |
| Mavi soru sordu, kullanıcı cevap vermedi | Tek tekrar yok; tur kapanır (bugünkü `followUp` kilidi korunur) |

### 9.9 Erken taahhüt (early commit) — deterministik yol

Partial transcript deterministik bir komuta **≥0.95 güvenle** ve **tek adaylı**
eşleşirse (`intentResolver` ambiguous reddi ile), final beklenmeden:
- **Yalnız `READ` ve `SAFE_DIRECT` sınıfı** eylem hazırlanır (yürütülmez),
- final gelince yürütülür.

> Erken taahhüt **asla** `CONFIRM_THEN_ACT` veya `RESTRICTED` sınıfına uygulanmaz.

---

## 10. FAST / DETERMINISTIC / DEEP YOLLAR

### 10.1 Üç yol

| Yol | Ne için | Nerede çalışır | Hedef gecikme (speech-end → first audio) |
|-----|---------|----------------|------------------------------------------|
| **DETERMINISTIC** | "sesi kıs", "müziği durdur", "eve git", "far kapat" | **%100 yerel** | **≤ 350 ms** |
| **FAST** | Günlük sohbet, kısa soru, basit CarOS işlemi | Yerel niyet + küçük/hızlı model (streaming) | **≤ 900 ms** |
| **DEEP** | Araç analizi, uzun bilgi, web, çok adımlı plan | Büyük model + tool + planner | **≤ 2500 ms ilk ses** (akış sürer) |

### 10.2 Router kararı

```
MaviRouter(partialOrFinal, context) →
  1. SAFETY OVERRIDE      → assistantSafetyKernel aktif kritik durum? → DETERMINISTIC(safety template)
  2. DETERMINISTIC MATCH  → intentResolver.confidence ≥ 0.90 ve ambiguous değil? → DETERMINISTIC
  3. CAPABILITY MISS      → istenen capability unavailable? → DETERMINISTIC(honest refusal)
  4. OFFLINE              → cloud yok? → DETERMINISTIC → FAST(local) → offline conversation
  5. SHORT CONVERSATION   → küçük dilbilgisi + kısa cevap sınıfı? → FAST
  6. else                 → DEEP
```

**Kritik kural:** Router kararı **partial** üzerinde başlar, **final**'de doğrulanır.
Karar değişirse: DETERMINISTIC → DEEP yükseltmesi serbest; DEEP → DETERMINISTIC
düşürmesi **yalnız hiçbir yan etki başlamadıysa**.

### 10.3 Kullanıcı hiçbir zaman yolları görmez

- Aynı ses, aynı kişilik, aynı UI durumu.
- Yol adı, model adı, "hızlı mod" ibaresi **hiçbir yerde gösterilmez/söylenmez** (I7).
- Yol yalnız **CAROS LAB telemetrisinde** görünür.

### 10.4 Yol geçişi (escalation)

DEEP'e yükseltme kullanıcıya **sessizce** olur. Eğer DEEP > 1200 ms sürecekse ve
söylenecek **gerçek** bir şey varsa §9.6 ack kuralı uygulanır; yoksa **sessizlik**
tercih edilir — çünkü sessizlik yalandan iyidir.

---

## 11. UNIVERSAL CAROS CAPABILITY FABRIC

### 11.1 Tasarım ilkesi

> Yeni bir CarOS modülü eklendiğinde **Mavi core'unun tek satırı değişmez.**
> Modül kendi `CapabilityContract`ını **kaydeder**; Mavi onu keşfeder.

### 11.2 `CapabilityContract` sözleşmesi [TASARIM]

```ts
interface CapabilityContract {
  readonly id: string;                       // 'navigation.route' — kararlı, nokta ayrık
  readonly domain: CapabilityDomain;         // capabilityRegistry ile AYNI enum
  readonly title: string;
  readonly operations: readonly CapabilityOperation[];
  readonly availability: () => AvailabilityVerdict;   // registry + runtime kanıt
  readonly state:        () => CapabilityStateSnapshot | UNAVAILABLE;
  readonly permissions:  readonly PermissionRequirement[];
  readonly provenance:   CapabilityProvenance;        // kim kaydetti, hangi sürüm
}

interface CapabilityOperation {
  readonly op: string;                       // 'start' | 'stop' | 'setVolume'
  readonly parameters: ParamSchema;          // bilinmeyen alan REDDEDİLİR
  readonly safetyClass: SafetyClass;         // §8.3
  readonly confirmationPolicy: ConfirmationPolicy;
  readonly motionPolicy: 'any' | 'requires_stopped';
  readonly executionContract: {
    readonly timeoutMs: number;
    readonly cancellable: boolean;
    readonly reversible: boolean;
    readonly idempotent: boolean;
    readonly maxVerification: VerificationLevel;   // bu op EN FAZLA neyi kanıtlayabilir
  };
  readonly resultContract: 'ack' | 'value';
}

interface Observation {
  readonly requested: OperationRequest;      // DESIRED
  readonly dispatched: boolean;              // EXECUTED (komut gitti mi)
  readonly verification: VerificationLevel;  // OBSERVED (ne kanıtlandı)
  readonly value?: unknown;
  readonly failureReason?: FailureReason;    // bounded enum — serbest metin YOK
  readonly provenance: ObservationProvenance;
  readonly observedAtMs: number;
}
```

**Not:** `VerificationLevel` **yeni tip değildir** — `media/authority/playbackTruth.ts`
zaten tanımlıyor. O tip **ortak katmana yükseltilir**, medya onu kullanmaya devam eder.

### 11.3 Kapsam — kaydedilecek capability'ler

| Domain | Örnek capability'ler | Bağlanacağı kanonik otorite |
|--------|----------------------|------------------------------|
| `navigation` | `route.start` · `route.stop` · `route.preview` · `eta.read` · `reroute` | `navigationService` (claim) |
| `map` | `map.open` · `map.center` · `map.layer` | `mapSourceManager` |
| `media` | `play` · `pause` · `next` · `prev` · `volume` · `source` · `search` | `MediaCommandGateway` |
| `phone` | `call.start` · `call.end` · `contacts.resolve` | native + `addressBookService` |
| `vehicle` | `health.read` · `sensor.read` · `dtc.read` · `dtc.clear` · `doors.*` · `lights.*` · `horn` · `alarm.*` | `maviActionAuthority` (mevcut 13 eylem) |
| `diagnostics` | `scan.status` · `verdict.read` · `evidence.read` | `dtcAuthority` · `maviReasoningEngine` |
| `trip` | `session.read` · `summary.read` | `tripSessionAccess` |
| `settings` | `bool.set` · `enum.set` · `read` | `useStore` + `systemSettingsService` |
| `display` | `theme.set` · `brightness.set` · `screen.off` | `useCarTheme` · native |
| `climate` | `read` · `set` | **UNAVAILABLE** (araçta yoksa dürüstçe söyler) |
| `notifications` | `read` · `dismiss` | `errorBus` / notification store |
| `connectivity` | `wifi.set` · `bluetooth.set` · `status.read` | native |

### 11.4 Availability ve dürüstlük

```
capabilityRegistry.status        →  Fabric availability
  available   → op çağrılabilir
  degraded    → çağrılabilir, cevapta sınır belirtilir
  unknown     → ÇAĞRILMAZ; Mavi "bilmiyorum, kontrol edeyim mi?" der
  unavailable → ÇAĞRILMAZ; Mavi "bu araçta yok" der
  restricted  → ÇAĞRILMAZ; Mavi neden kısıtlı olduğunu söyler
  unsupported → ÇAĞRILMAZ; kapsam kaybı DEĞİL, ölçülmüş gerçek
```

> **`unknown` ≠ `unavailable`.** Bu ayrım `capabilityRegistry`nin mevcut karar
> ilkesidir ve Fabric'e **aynen taşınır** — bu, Mavi'nin "yapamam" ile "bilmiyorum"u
> ayırt etmesini sağlayan tek şeydir.

### 11.5 Genişletilebilirlik sözleşmesi

Yeni CarOS modülü şunu yapar (Mavi core'a **dokunmadan**):

```
1. <modul>CapabilityContract.ts  yazar         (saf, I/O yok)
2. SystemBoot wave'inde register(contract)      (idempotent, cleanup döner)
3. CAROS LAB'da salt-okunur ekranını açar       (CLAUDE.md gözlemlenebilirlik kuralı)
4. Kilit testi ekler: contract şeması + safetyClass + confirmationPolicy
```

**Guard testi [TASARIM]:** Fabric'e `safetyClass: 'PROHIBITED'` dışında
`ecu_write | coding | adaptation | actuator` kapsamı isteyen bir operation
kaydedilemez — kayıt anında `Error`.

---

## 12. INTENT → PLAN → ACTION

### 12.1 Kanonik boru hattı

```
UserSpeech
 → StreamingUnderstanding      (partial intent + entity)
 → ContextResolution           (deixis: "orası", "onu", "aynısı")
 → Intent                      (intentResolver — deterministik; DEEP'te LLM önerir)
 → Plan                        (compound · dependency · ordering)
 → Policy/Safety Gate          (§14)
 → Capability Resolution       (Fabric availability + op çözümü)
 → Execution                   (executionEngine — timeout/rollback/partial/dedupe/stale)
 → Observation                 (ObservationBus + VerificationLevel)
 → Reconciliation              (desired vs executed vs observed)
 → NaturalResponse             (yalnız gözlemlenmiş gerçekten cümle)
```

### 12.2 LLM'in yeri

LLM **yalnız** şu üç noktada konuşur:
1. **Intent önerisi** (DEEP path) — öneri, karar değil.
2. **Plan taslağı** — Planner doğrular, reddedebilir.
3. **Cümle kurma** — *yalnız* Reconciliation çıktısı üzerinden.

LLM **hiçbir zaman**: capability çağırmaz, servis çağırmaz, onay atlamaz,
`VerificationLevel` üretmez, güven skoru **beyan etmez** (confidence türetilir).

### 12.3 Reconciliation — "yaptım" ne zaman söylenir

| desired | executed | observed | Mavi ne der |
|---------|----------|----------|-------------|
| ✔ | ✔ | `RENDERING_VERIFIED` / `OBSERVED_STARTED` | *"Açtım."* |
| ✔ | ✔ | `REMOTE_STATE_OBSERVED` | *"Açtım — Spotify öyle diyor."* |
| ✔ | ✔ | `TRANSPORT_ACK` | *"Komutu gönderdim, başladığını göremiyorum."* |
| ✔ | ✔ | `NONE` | *"Gönderdim ama doğrulayamıyorum."* |
| ✔ | ✘ (timeout) | — | *"Yapamadım, cevap gelmedi."* |
| ✔ | ✘ (unsupported) | — | *"Bu araçta yok."* |
| ✔ | ✘ (needs_confirmation) | — | *"Onaylıyor musun?"* |
| kısmi | 2/3 | karışık | *"Rotayı açtım, sesi kıstım; aramayı yapamadım."* |

> **"Yaptım" kelimesi yalnız ilk iki satırda geçebilir.** Bu bir dil kuralı değil,
> `ResponseComposer`'da **kodla zorlanan** bir kısıttır.

### 12.4 COMPOUND COMMANDS (çok işli tek cümle)

> *"Eve rota aç, müziği biraz kıs, annemi ara."*

**Plan çıktısı:**

```
Plan {
  planId, turnId, generation,
  mode: 'sequential' | 'parallel' | 'mixed',
  steps: [
    { id:'s1', capability:'navigation.route', op:'start',   params:{dest:'home'},   deps:[] },
    { id:'s2', capability:'media',            op:'volume',  params:{delta:-20},     deps:[] },
    { id:'s3', capability:'phone',            op:'call.start', params:{contact:'anne'}, deps:['s2'] }
  ],
  rollbackOnFailure: false,
  atomic: false
}
```

**Bağımlılık kuralları [TASARIM]:**

| Kural | Gerekçe |
|-------|---------|
| Ses değişikliği **her zaman** çağrıdan önce gelir (`s3.deps = [s2]`) | Aksi halde çağrı sırasında ses ayarı çakışır (audio focus) |
| `navigation.route.start` **paralel** koşabilir (bloklamaz) | Rota hesabı uzun; kullanıcı beklemez |
| Aynı capability'ye iki op → **sıralı** | Yarış koşulu yasağı |
| `CONFIRM_THEN_ACT` adımı → **plan durur**, onay istenir, kalan adımlar bekler | Sessiz kısmi yürütme yasak |

**Kısmi başarısızlık (partial failure) semantiği:**

1. **Varsayılan: `rollbackOnFailure = false`** — bir adımın düşmesi diğerlerini iptal etmez
   (mevcut `executionEngine` sözleşmesi, KEEP).
2. Her adım **ayrı `Observation`** üretir; hiçbiri diğerinin sonucunu **ezemez**.
3. Cevap **her adımı tek tek** raporlar: *"Rotayı açtım, sesi kıstım; aramayı yapamadım — rehberde 'anne' yok."*
4. `atomic: true` yalnız kullanıcı açıkça isterse ("ya hepsi ya hiçbiri") — o zaman
   `reversible` adımlar **ters sırada** geri alınır (mevcut rollback mekanizması, KEEP).

**İptal (cancellation):**

- Kullanıcı plan ortasında konuşursa → `MaviTurn.supersede()` → **başlamamış adımlar iptal**,
  **başlamış adımlar `AbortSignal` ile kesilir**, tamamlananlar **geri alınmaz** (dürüstlük).
- Cevap: *"Rotayı açmıştım, gerisini bıraktım."* — sessiz iptal yasak.

**Sıralama garantisi:** `executionEngine` planı **turun kuşağıyla damgalar**; kuşak
değişmişse plan **tümüyle `rejected`** olur (mevcut stale koruması, KEEP).

### 12.5 Onay akışı (confirmation)

```
Plan → CONFIRM_THEN_ACT adımı bulundu
  → Mavi tek cümlede sorar (parametreleri TEKRARLAYARAK): "Annen 0532… — arayayım mı?"
  → pendingActionConfirmation (mevcut saf depo, KEEP) → TTL 15 s
  → 'evet' → yalnız O adım yürütülür (yeniden plan yapılmaz)
  → 'hayır' / TTL → adım 'cancelled', plan kalanı devam eder
```

**Çoklu onay:** Bir planda **birden fazla** `CONFIRM_THEN_ACT` varsa
`sequenceConfirmationPolicy` (mevcut, KEEP) devreye girer ve **tek seferde toplu
onay reddedilir** — her riskli adım ayrı onay ister.

### 12.6 Rollback semantiği

| Eylem | reversible | Rollback |
|-------|-----------|----------|
| `settings.bool.set` | ✔ | eski değere dön |
| `display.theme.set` | ✔ | eski temaya dön |
| `media.volume` | ✔ | eski seviyeye dön |
| `navigation.route.start` | ✔ | `stopNavigation()` |
| `media.next` | ✘ | geri alınamaz (tek yön) |
| `phone.call.start` | ✘ | **asla otomatik kapatılmaz** |
| `vehicle.dtc.clear` | ✘ | **geri alınamaz — bu yüzden RESTRICTED + onay** |

**Kural:** `reversible: false` bir adım plana girdiği anda `atomic: true` **reddedilir**
— geri alınamayan bir adım içeren plan atomik olduğunu iddia edemez.

---

## 13. CONTEXT INTELLIGENCE

### 13.1 `ContextDatum` zarfı [TASARIM]

Her context değeri **istisnasız** bu zarfla taşınır:

```ts
interface ContextDatum<T> {
  readonly key: string;                 // 'vehicle.speedKph'
  readonly value: T | null;             // null = bilinmiyor (SAHTE DEĞER YOK)
  readonly source: ContextSource;       // 'obd' | 'can' | 'gps' | 'route' | 'media' | …
  readonly observedAtMs: number;        // monotonik
  readonly freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  readonly confidence: number;          // 0..1 — TÜRETİLİR, beyan edilmez
  readonly provenance: 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE';
  readonly scope: 'instant' | 'trip' | 'vehicle' | 'user';
  readonly availability: 'available' | 'unavailable' | 'unknown';
}
```

> `provenance` enum'ı **yeni değildir** — `sessionInspectorModel` sözleşmesiyle
> **birebir aynıdır** (CLAUDE.md gözlemlenebilirlik kuralı: paralel sistem kurulmaz).

### 13.2 Tazelik politikası (kaynak bazlı)

| Kaynak | fresh | aging | stale |
|--------|-------|-------|-------|
| OBD hız / RPM | < 1.5 s | < 5 s | ≥ 5 s |
| OBD yakıt / sıcaklık | < 10 s | < 60 s | ≥ 60 s |
| GPS konum | < 3 s | < 15 s | ≥ 15 s |
| Rota / ETA | < 10 s | < 60 s | ≥ 60 s |
| Trafik | < 120 s | < 600 s | ≥ 600 s |
| Hava | < 900 s | < 3600 s | ≥ 3600 s |
| DTC taraması | oturum içi | — | oturum değişti |

### 13.3 Kullanım kuralları (pazarlıksız)

1. **`stale` datum kesin gerçek gibi kullanılmaz.** Prompt'a girerse yaşıyla girer
   (*"12 dakika önceki ölçüme göre"*), karar kapısına **hiç girmez**.
2. **`null` değer prompt'a alan olarak taşınmaz** — bugünkü `maviVehicleContext`
   davranışı (`voiceService.ts:1681`) **tüm kaynaklara genelleştirilir**.
3. **Çelişkili kaynak → `unknown`.** (`capabilityRegistry`'nin mevcut ilkesi.)
4. **Tur başına tek dondurulmuş snapshot.** Bir tur ortasında ikinci okuma yapılmaz
   (mevcut M2 disiplini korunur ve genişletilir).
5. **Context bütçesi:** DEEP prompt'a en fazla N datum (tier bazlı; ör. `LOW: 12`,
   `MID: 20`, `HIGH: 32`), öncelik: safety > navigation > vehicle > trip > ambient.

### 13.4 Context kaynak matrisi

| Kaynak | Mevcut modül | Fabric'e nasıl bağlanır |
|--------|--------------|-------------------------|
| Vehicle state | `maviVehicleContext` | Doğrudan (KEEP) |
| CAN | `canBus/` | `ContextDatum` adaptörü |
| OBD | `obdService` + `dtcAuthority` | Mevcut kapı üzerinden |
| GPS | `gpsService` | `location/currentLocationService` |
| Map / Route | `navigationService` | `getNavigationState()` |
| Traffic | `traffic/` bileşenleri | **[BORÇ]** servis kapısı yok — eklenecek |
| Trip | `tripSessionAccess` | Mevcut ince kapı (KEEP) |
| Music | `getMediaState` + `playbackTruth` | Authority port |
| Phone | `phoneHub` | Yalnız VAR/YOK + adet (gizlilik) |
| Connectivity | `aiHealth` + `navigator.onLine` | Mevcut |
| Time | sistem | Monotonik + duvar saati ayrı |
| Weather | `weatherService` | Mevcut |
| Conversation | `TurnMemory` | §14 |
| User prefs | `useStore.settings` + `LongTermMemory` | §14 |
| Historical patterns | `Driver DNA` / `fleet/aiEvidence` | Yalnız `DERIVED` provenance ile |

---

## 14. HAFIZA (MEMORY)

### 14.1 Üç katman

| Katman | Kapsam | Ömür | Kalıcılık | Mevcut karşılık |
|--------|--------|------|-----------|-----------------|
| **TurnMemory** | Mevcut konuşma (son N tur) | Oturum | RAM | `companionChatProvider._history` + `maviCore/contextStore` → **BİRLEŞTİRİLİR** |
| **TripMemory** | Bu yolculukta konuşulanlar + yapılanlar + gözlemler | Yolculuk | RAM + yolculuk sonunda özet | **YOK — YENİ** |
| **LongTermMemory** | Kalıcı tercih ve izinli öğrenilmiş davranış | Kalıcı | `safeStorage` | `companionMemory` (explicit) → **genişletilir** |

### 14.2 Explicit ↔ Inferred ayrımı (pazarlıksız)

```ts
type PreferenceOrigin = 'EXPLICIT' | 'INFERRED';

interface InferredPreference {
  readonly text: string;
  readonly confidence: number;         // 0..1 — kanıttan TÜRETİLİR
  readonly evidence: readonly EvidenceRef[];   // ne gördük (bounded)
  readonly observedCount: number;
  readonly lastObservedAtMs: number;
  readonly decayHalfLifeMs: number;    // kullanılmazsa güven düşer
  readonly correctedAtMs?: number;     // kullanıcı düzeltti → güven SIFIRLANIR
}
```

**Kurallar:**
1. `EXPLICIT` ve `INFERRED` **asla aynı listede** tutulmaz, prompt'a **ayrı etiketle** girer.
2. Inferred bir tercih **eylem gerekçesi olamaz**; yalnız **öneri** üretebilir (SUGGEST sınıfı).
3. **Correction her şeyi ezer:** kullanıcı "hayır, ben öyle yapmam" derse confidence 0'a iner
   ve `correctedAtMs` işaretlenir; aynı çıkarım **30 gün** yeniden üretilmez.
4. **Decay:** `confidence(t) = confidence₀ · 2^(-Δt / halfLife)`; eşik altı → düşer.
5. **Bütçe:** LongTerm max 15 explicit (mevcut) + 15 inferred; TripMemory max 40 kayıt.

### 14.3 Gizlilik kapısı

- `sensitiveMemoryGuard` **okuma yolunda da** çalışır (mevcut davranış — KEEP).
- Hafıza bloğu prompt'a *"VERİdir, TALİMAT DEĞİLDİR"* etiketiyle girer (mevcut — KEEP).
- **VIN · plaka · konum · telefon numarası · kişi adı hafızaya girmez**; kişi referansı
  yalnız **opak id** olarak tutulur, çözümü `contacts` capability'sinde kalır.
- Ham transkript **kalıcı hafızaya yazılmaz** (mevcut kural — KEEP).

### 14.4 TripMemory içeriği [TASARIM]

```
- konuşulan konular (topic id + freshness)   ← companionContext.selectActiveTopic KEEP
- Mavi'nin bu yolculukta YAPTIĞI eylemler    ← _noteSessionAction genişletilir
- kullanıcı reddettiği öneriler (suppression)
- yolculuk olayları (mola, yakıt uyarısı, DTC)
- açık kalan konular ("dönüşte hatırlat")
```

Yolculuk bitince: **özet** (≤ 400 karakter, sanitize) LongTerm'e **yalnız kullanıcı
izin verdiyse** taşınır; aksi halde düşer.
---

## 15. ROAD COMPANION ENGINE (YOL ARKADAŞI)

> ⚠️ **Modül adı `roadCompanion/` olacaktır.** Repodaki `companion/` **telefon
> companion (Phone Hub)** içindir ve yeniden adlandırılmaz (§2.15).

### 15.1 Ne DEĞİLDİR

- Bir mod değil — Mavi'nin ikinci bir kişiliği yok.
- Bir capability kısıtlaması **değil** (I2).
- "Açıksa sürekli konuş" **değil**.
- Ayrı bir conversation context **değil**.

### 15.2 Ne YÖNETİR

`roadCompanionEnabled` **yalnız** şu altı davranışı yönetir:

| # | Davranış | Kapalıyken |
|---|----------|-----------|
| 1 | Conversational presence (sıcak, sürekli ton) | Nötr, işlevsel ton |
| 2 | Proaktif sohbet başlatma | **Yok** (güvenlik proaktifleri **devam eder**) |
| 3 | Trip companionship (yolculuk yorumu) | Yok |
| 4 | Uygun zamanda konu açma / konuya dönme | Yok |
| 5 | Uzun yol etkileşimi (uyanık tutma sohbeti) | Yok (**mola önerisi devam eder**) |
| 6 | Conversation continuity (takip dinlemesi eğilimi) | Yalnız açık soru sonrası |

**Kapalıyken Mavi'nin YAPMAYA DEVAM ETTİKLERİ (I2 kanıtı):**
tam LLM sohbeti · tüm capability'ler · compound command · araç analizi · web bilgisi ·
hafıza · context · tool calling · güvenlik uyarıları · kritik proaktif uyarılar.

### 15.3 Ayar taşıma planı (mevcut → hedef)

| Mevcut | Hedef | Not |
|--------|-------|-----|
| `settings.companionEnabled` | `settings.roadCompanionEnabled` | **Anlamı değişir**: beyin şalteri → presence şalteri |
| `settings.companionPersonality` | `settings.maviPersonality` | Kişilik her durumda geçerli |
| `settings.companionChattiness` | `settings.roadCompanionChattiness` | Yalnız proaktiflik bütçesi |
| `settings.companionAssistantName` | `settings.maviName` | Wake word kaynağı — presence'tan bağımsız |
| `settings.companionWakeWordEnabled` | `settings.maviWakeWordEnabled` | **Presence'tan bağımsız** |

**Migration (v-next store):** `companionEnabled` **presence**'a map edilir;
**beyin kapısı KALDIRILIR** (`companionChatProvider.ts:2358, 2672, 2785, 2851`
dört guard'ı yerine `roadCompanionPresence` yalnız ton/proaktiflik parametresi olur).

### 15.4 Konuşma sürdürme yetenekleri

| Yetenek | Uygulama |
|---------|----------|
| Konuyu sürdürme | `selectActiveTopic` + `topicFreshness` (mevcut, KEEP) → TripMemory'ye bağlanır |
| Konu değiştirme | Yeni topic id; eski topic `parked` işaretlenir |
| Önceki konuya dönme | `TripMemory.openTopics` — kullanıcı "neyse, o konuya dönelim" derse |
| Doğal follow-up | Yalnız **açık uçlu** cevaptan sonra; kapalı cevapta follow-up yok |
| Sessizliği anlama | `silenceMs` + `WorkloadPolicy` → yüksek yükte sessizlik **normaldir**, sorulmaz |
| Gereksiz konuşmama | `ProactivePolicyEngine` (§17) |
| Sessiz kalabilme | **Varsayılan davranış** — konuşma bir istisnadır, kural değil |

### 15.5 Presence tonu — kişilikle ilişki

`roadCompanionEnabled` **kişiliği değiştirmez**, yalnız **konuşma yoğunluğunu**
ve **cümle sıcaklığını** ayarlar:

```
tone = f(personality, presenceOn, workload, timeOfDay, tripDuration)
```

Ama **hiçbir koşulda**: doğruluk · güvenlik · confidence · authority kurallarını esnetemez (§16).

---

## 16. DRIVER WORKLOAD POLICY

### 16.1 Bugünkü durum [ÖLÇÜLDÜ]

`CognitiveMode` (`IMMERSIVE → AWARE → FOCUSED → PROTECTION → CRITICAL → LIMP_HOME`)
**yalnız sistem sağlığı ve performans** tarafından set ediliyor
(`CognitivePriorityEngine.ts:124,144` · `SystemHealthMonitor.ts:691` ·
`SystemOrchestrator.ts:121`). **Sürüş yükü bu sinyalde yok.**

### 16.2 `DriverWorkloadPolicy` [TASARIM]

**Yeni store kurulmaz** — `useCognitiveStore` **okunur**, yanına **ayrı bir eksen** eklenir:

```ts
type DrivingWorkload = 'PARKED' | 'LIGHT' | 'MODERATE' | 'HIGH' | 'CRITICAL';
```

**Girdiler (hepsi mevcut kaynaklardan, yeni sensör YOK):**

| Sinyal | Kaynak | Katkı |
|--------|--------|-------|
| Hız | OBD / GPS | 0 km/h → PARKED |
| Yaklaşan manevra mesafesi | `navigationService` progress | < 300 m → +1 |
| Manevra karmaşıklığı | route step tipi (kavşak/dönel/çıkış) | karmaşık → +1 |
| Şerit değişimi / ani direksiyon | CAN varsa · yoksa GPS heading Δ | +1 |
| Fren yoğunluğu | OBD | +1 |
| Hız limiti değişimi / okul bölgesi | `vehicleAwareSpeedLimitAuthority` | +1 |
| Yağış / görüş | `weatherService` | +1 |
| Gece + tanınmayan yol | `livingThemeState.tod` + rota | +1 |
| Geri vites | mevcut reverse overlay sinyali | → **CRITICAL** |
| Kognitif mod ≥ PROTECTION | `useCognitiveStore` | → en az HIGH |

### 16.3 Davranış matrisi

| Workload | Mavi'nin konuşma davranışı |
|----------|---------------------------|
| `PARKED` | Tam ayrıntı · uzun cevap (2400 karaktere kadar — mevcut park limiti) · expanded UI |
| `LIGHT` | Doğal sohbet · proaktif serbest (bütçe dahilinde) |
| `MODERATE` | Kısa cevap (≤ 300 karakter — mevcut sürüş limiti) · proaktif yalnız yüksek değerli |
| `HIGH` | **Yalnız yanıt**; proaktif YOK; cevap tek cümle; onay soruları ertelenir |
| `CRITICAL` | **Sessiz** — yalnız güvenlik şablonu (`assistantSafetyKernel`) konuşur |

**Pazarlıksız:** Workload **hiçbir zaman** güvenlik uyarısını susturamaz.
`assistantSafetyKernel` şablonları ve `speakSafetyAlert` bu politikanın **üstündedir**
(mevcut `__SAFETY_LOCK__` bypass'ı korunur).

### 16.4 Dikkat dağıtmama sözleşmesi

- `HIGH`/`CRITICAL`'da **hiçbir onay diyaloğu** açılmaz; onay gerektiren plan
  **`PREPARE` sınıfına düşer**: hazırlanır, *"müsait olunca sorarım"* denir.
- Ekranda hareketli/parlak Mavi görseli `HIGH`'da **durur** (`livingThemeState.level` disiplini).
- Cevap uzunluğu **kod ile** kısıtlanır (bugünkü `ANSWER_CHAR_LIMIT` deseni genişletilir).

---

## 17. PROAKTİF ZEKÂ (PROACTIVE INTELLIGENCE)

### 17.1 Bugünkü durum [ÖLÇÜLDÜ]

`companionEngine.ts` (376 satır): 60 s tick (runtimeManager scheduler görevi),
5 tetik (kritik yakıt · uyku önleme · selamlama · mola · yolculuk yorumu),
`chattiness` bütçesi (az 45 dk · normal 20 dk · sık 10 dk), interaction gate
(presence · personality ≠ sessiz · CognitiveMode < PROTECTION · voice idle ·
TTS uçuşta değil · medya prominent değil). **İyi tasarlanmış ama tek motorlu.**

### 17.2 `ProactivePolicyEngine` [TASARIM]

**Tek merkezi kapı.** Her proaktif kaynak (navigation, vehicle, fleet, trip,
roadCompanion, maintenance, connectivity) buraya **teklif** verir; motor **karar** verir.

```ts
interface ProactiveProposal {
  readonly sourceId: string;                  // 'vehicle.fuel' | 'nav.reroute' | …
  readonly kind: 'safety' | 'operational' | 'informational' | 'social';
  readonly relevance: number;                 // 0..1
  readonly confidence: number;                // 0..1 — kanıttan TÜRETİLİR
  readonly decayAtMs: number;                 // ne zaman anlamsızlaşır
  readonly minWorkload: DrivingWorkload;      // hangi yüke kadar konuşulabilir
  readonly cooldownKey: string;               // aynı konu tekrar bastırma anahtarı
  readonly deliver: 'voice' | 'visual' | 'both';
  readonly text: () => string;                // ŞABLON — LLM'e gitmez (maliyet + offline)
}
```

### 17.3 Karar fonksiyonu

```
score = relevance × confidence × timeliness(decayAt) × workloadFit(minWorkload)
        × userAcceptanceRate(sourceId)      ← öğrenilen: kullanıcı bu kaynağı kabul ediyor mu
        × presenceFactor(kind, roadCompanionEnabled)

konuş  ⟺  score ≥ threshold(kind)
      ∧  cooldown(cooldownKey) geçti
      ∧  suppression(sourceId) aktif değil
      ∧  frequencyBudget(kind) müsait
      ∧  TurnArbiter boşta
```

### 17.4 Sınıf bazlı kurallar

| kind | roadCompanion kapalıyken | Workload tavanı | Bütçeye tabi mi | Cooldown |
|------|--------------------------|-----------------|-----------------|----------|
| `safety` | **ÇALIŞIR** | `CRITICAL` dahil | **HAYIR** | kendi (15–30 dk) |
| `operational` (yakıt, rota problemi, bağlantı) | **ÇALIŞIR** | `HIGH` | Hayır | 15 dk |
| `informational` (bakım, öneri) | Yalnız görsel | `MODERATE` | Evet | 60 dk |
| `social` (sohbet başlatma) | **YOK** | `LIGHT` | Evet | chattiness bütçesi |

### 17.5 Spam'in yapısal engeli

1. **Global frekans tavanı:** saatte en fazla `N` sesli proaktif (`safety` hariç).
2. **Kaynak bazlı öğrenme:** kullanıcı bir kaynağın önerisini **3 kez** reddederse
   `userAcceptanceRate` düşer → o kaynak fiilen susar (inferred preference, decay'li).
3. **Suppression:** *"bunu bir daha söyleme"* → kalıcı `sourceId` bastırma
   (ayarlardan geri açılabilir).
4. **Tek konu kuralı:** aynı tick'te en yüksek skorlu **tek** teklif konuşur; diğerleri
   düşer (kuyruğa alınmaz — bayat proaktif konuşma yasak).

---

## 18. ARAÇ ZEKÂSI (VEHICLE INTELLIGENCE)

### 18.1 Mavi'nin araç zekâsıyla ilişkisi

```
OBD/CAN ──► signal layer ──► fleet/aiEvidence* (kanıt omurgası)
                                     │
                                     ▼
                          maviReasoningEngine  (LLM'siz karar otoritesi)
                                     │  MaviReasoning { decision, confidence, chain }
                                     ▼
                       ┌─────────────────────────────┐
                       │  Mavi ResponseComposer      │  ← okur, EZEMEZ
                       │  ProactivePolicyEngine      │  ← teklif kaynağı
                       │  Capability: diagnostics.*  │  ← salt-okunur op
                       └─────────────────────────────┘
```

**Pazarlıksız kural:** LLM `maviReasoningEngine`'in kararını **değiştiremez,
yükseltemez, yumuşatamaz**. LLM yalnız o kararı **açıklayabilir**
(`maviDecisionExplainability` testinin kilitlediği davranış).

### 18.2 Dürüstlük zinciri (mevcut, KEEP + genişlet)

| Soru | Otorite | Mavi'nin diyebilecekleri |
|------|---------|--------------------------|
| Arıza var mı? | `dtcAuthority` 4 değerli hüküm | `issues` → say · `clean` → "tarandı, temiz" · `unproven` → "tam tarayamadım" · `not_scanned` → **"henüz taramadım"** |
| Motor sıcak mı? | `ContextDatum` freshness | `stale` → "12 dk önceki ölçüme göre…" |
| Yakıt yeter mi? | `interpretRangeVsRoute` | menzil **tahmin**tir → "yaklaşık" |
| Bu ne demek? | `diagnosticKnowledgeEngine` + `mechanicMapper` | kaynak belirtilir |
| Ne yapmalıyım? | `assistantSafetyKernel` şablonu | **serbest metin üretilmez** |

### 18.3 Mavi'nin araç üzerinde YAPAMAYACAKLARI (daimî)

`ecu_write` · `coding` · `adaptation` · `actuator` · steering · brake · throttle ·
ADAS parametresi · airbag · immobilizer. **`HARD_FORBIDDEN_SCOPES` (K3) config ile açılamaz.**

---

## 19. LOCAL + CLOUD HİBRİT

### 19.1 Yetenek matrisi

| Yetenek | LOCAL | CLOUD | Degraded (cloud yok) |
|---------|-------|-------|----------------------|
| Wake word | ✅ Vosk grammar (native) | — | **Tam çalışır** |
| ASR | ✅ Vosk TR (Apache-2.0) | Groq Whisper / Gemini (daha doğru) | **Vosk'a düşer** — mevcut davranış |
| Deterministic komut | ✅ `intentResolver` + `commandParser` | — | **Tam çalışır** |
| Capability yürütme | ✅ Fabric tamamen yerel | — | **Tam çalışır** |
| Context | ✅ Tümü yerel | — | **Tam çalışır** |
| DTC / reasoning | ✅ `maviReasoningEngine` yerel | — | **Tam çalışır** |
| Serbest sohbet | ⚠️ `offlineConversationEngine` (kural tabanlı, 438 satır) | ✅ LLM | **Sınırlı ama YAŞAR** |
| Geniş bilgi / web | ❌ | ✅ | **Dürüst ret**: "İnternet yok, bunu bilemem." |
| TTS | ✅ `voiceClips` + native/eSpeak | Edge / Gemini (premium kadın) | **Klip sözlüğü genişletilerek** tutarlı kalır (§9.5) |

### 19.2 Degraded mode sözleşmesi

**Cloud kaybolduğunda Mavi:**
1. **Sessizce düşmez** — `aiOfflineReason` ile **sebep kodu** üretir (mevcut disiplin, KEEP).
2. Kullanıcıya **bir kez** söyler, her cümlede tekrarlamaz (`_AI_KEY_HINT_COOLDOWN_MS` deseni).
3. UI'da `degraded` durumu gösterir (§21) — bugün gösterilmiyor **[BORÇ B11]**.
4. **Sahte offline yasağı:** `NO_NET_EVIDENCE_KINDS` kara listesi (KEEP) — sunucuyla
   temas kurulduysa "internet yok" **denmez**.

### 19.3 Session recovery (cloud geri gelince)

```
1. providerHealthStore + aiHealth breaker kapanır
2. TripMemory + TurnMemory ZATEN yereldir → kayıp yok
3. Yarım kalan DEEP isteği YENİDEN DENENMEZ (bayat) — kullanıcı sormadıysa cevap gelmez
4. Mavi kendiliğinden "internet geldi" DEMEZ (spam) — yalnız LAB'da görünür
5. Kullanıcı offline'da reddedilen bir şeyi tekrar sorarsa artık cevaplanır
```

### 19.4 Gelecek: yerel model

`capabilityRegistry` **zaten** `LocalModelEvidence` provider'ı barındırıyor
(`providers/runtimeCapabilityProviders.ts`). Yerel küçük dil modeli eklendiğinde
**FAST path** cloud'dan yerelde çalışır hale gelir — **mimari değişikliği gerekmez**,
yalnız yeni bir gateway provider'ı kaydedilir. Bu, tasarımın en önemli
gelecek-geçirimlilik özelliğidir.

---

## 20. SES / AUDIO MİMARİSİ

### 20.1 Değişmeyen otorite (K1)

```
EMERGENCY > SAFETY > NAVIGATION > PHONE > MAVI > MEDIA
```

Mavi bu zincirin **beşinci** sırasındadır ve **abonedir**. `REASON_MAVI` sebep
koduyla duck ister, token alır, bitince **kendi token'ıyla** bırakır.
En agresif çarpan kazanır (navigasyon duck'ı açıkken Mavi bitince ses navigasyon
seviyesine döner — mevcut davranış, KEEP).

### 20.2 Mavi konuşurken

| Kaynak | Davranış |
|--------|----------|
| Müzik | duck `0.30` (ISO 22262), 0.10 s rampa |
| Navigasyon talimatı | **Mavi susar** — navigasyon önceliklidir |
| Telefon çağrısı | **Mavi susar** ve tur iptal olur |
| Güvenlik uyarısı | **Mavi kesilir** (`speakSafetyAlert` force + `__SAFETY_LOCK__` bypass) |
| Geri vites / park sensörü | Mavi susar (`REASON_REVERSE_ATTENTION`) |

### 20.3 Full-duplex ses yolu [TASARIM]

```
mic ──► AEC (ref = TTS çıkışı) ──► AGC ──► NS ──► [VAD | Wake | StreamingASR]
                                                        │
TTS ──► AudioTrack ──────────────────────────────────────┘ (referans sinyali)
```

**Tier kararı:** AEC yeterliliği cihaz bazında **ölçülür** (`voiceMicDiagnosticsProbe`
mevcut altyapısıyla). Yetersizse **half-duplex'e döner** — bugünkü davranış korunur.
Bu bir fail-soft, sessiz downgrade'dir ve CAROS LAB'da görünür.

### 20.4 Kendini duymama (self-hearing)

Bugün native tarafta `wakeMicMustYield()` ile **yapısal** çözülmüş (TTS/aktif STT
sürerken wake thread mikrofonu bırakıyor). Full-duplex'te bu yerini **AEC + referans
sinyali + kelime seviyesinde self-echo filtresi**ne bırakır; AEC yoksa mevcut
davranış aynen kalır.

---

## 21. UI DURUM MİMARİSİ (AMBIENT MAVİ)

### 21.1 Durum modeli [TASARIM]

```
IDLE ──► AMBIENT ──► LISTENING ──► UNDERSTANDING ──► SPEAKING ──► IDLE
                          ▲              │
                          │              ├──► ACTION ──────┐
                          │              ├──► CONFIRMATION ┤
                          └── barge-in ──┴──► PROACTIVE ───┘
                                         └──► DEGRADED / ERROR
```

| Durum | Görsel | Ses | Kullanıcıya söylenir mi |
|-------|--------|-----|-------------------------|
| `IDLE` | Yok | — | — |
| `AMBIENT` | Küçük nabız (wake dinliyor) | — | — |
| `LISTENING` | Waveform (mevcut) | — | — |
| `UNDERSTANDING` | Waveform sabitlenir | — | **Metin/ses YOK** (I7) |
| `ACTION` | Domain ikonu + adım ilerlemesi | — | Yalnız uzun iş için (§9.6) |
| `CONFIRMATION` | Onay kartı + parametreler | Soru | Evet |
| `SPEAKING` | Konuşma göstergesi | Cevap | Evet |
| `PROACTIVE` | Farklı (yumuşak) giriş animasyonu | Teklif | Evet |
| `DEGRADED` | Kalıcı küçük rozet | — | Bir kez |
| `ERROR` | Kısa hata | Dürüst hata | Evet |

> **`UNDERSTANDING` bir "thinking" göstergesi DEĞİLDİR** — model düşüncesi,
> aşama adı, plan içeriği **gösterilmez** (I7). Yalnız "seni duydum" görselidir.

### 21.2 İki yüzey

| Yüzey | Ne zaman | İçerik |
|-------|----------|--------|
| **Compact (driving)** | `workload ≥ MODERATE` veya hız > 5 km/h | Tek satır durum + tek satır cevap özeti · dokunmatik hedef ≥ 76 px · **navigasyon/müzik UI'sı KAPANMAZ** (overlay şerit) |
| **Expanded (parked)** | `PARKED` | Tam konuşma geçmişi · kanıt/gerekçe · plan adımları · ayrıntılı cevap |

**Kural:** Mavi **navigasyon veya müzik ekranını kapatmaz**; bunların üstünde
alt/üst şerit olarak yaşar. Tam ekran yalnız `PARKED` + kullanıcı isteğiyle.

### 21.3 Mevcut UI ile ilişki

- `VoiceAssistant.tsx` **korunur**, `MaviSurface` içine taşınır.
- `livingThemeState.CompanionStatus` **4 → 10 duruma** genişletilir
  (aynı saf türetme deseni; yeni store kurulmaz).
- `voiceOverlayShouldAutoClose(followUp)` kilidi **korunur** ve
  `CONFIRMATION`/`ACTION` durumlarını da kapsayacak şekilde genişletilir.
---

## 22. GÜVENLİK / EYLEM POLİTİKASI (ACTION AUTHORITY & SAFETY)

### 22.1 Sınıflar ve kapılar

| Sınıf | Onay | Hareket politikası | Capability kanıtı | Örnek |
|-------|------|--------------------|-------------------|-------|
| `READ` | Yok | `any` | `available` veya `degraded` | hız, yakıt, DTC oku, ETA |
| `SUGGEST` | Yok (yürütme yok) | `any` | — | "yakıt almanı öneririm" |
| `SAFE_DIRECT` | Yok | `any` | `available` | ses, tema, ekran parlaklığı, medya next |
| `PREPARE` | Yok (uygulamaz) | `any` | `available` | rota hesapla, kişi çöz, sıraya al |
| `CONFIRM_THEN_ACT` | **Zorunlu, parametre tekrarlı** | op'a göre | `available` + `confidence ≥ HIGH` | telefon araması, kapı kilidi, DTC sil |
| `RESTRICTED` | Zorunlu | `requires_stopped` | `available` + **authoritative** kaynak | kapı açma, alarm kapatma |
| `PROHIBITED` | — | — | — | ECU write · coding · adaptation · actuator · steering/brake/throttle |

### 22.2 Kapı sırası (değişmez — mevcut `maviActionAuthority` deseni genelleştirilir)

```
1. Workload politikası      (HIGH/CRITICAL'da onay diyaloğu açılmaz → PREPARE'e düşer)
2. Hareket politikası       (motionState; unknown ≠ parked — FAIL-CLOSED)
3. SafetyKernel PRE-GATE    (kritik araç durumu → online kapalı + şablon cevap)
4. AiSafetyGate             (kapsam kararı; HARD_FORBIDDEN daimî ret)
5. ActionAuthority          (defterde var mı · risk · onay gereksinimi)
6. Açık kullanıcı onayı     (gerekiyorsa → needs_confirmation)
7. Capability availability  (yoksa dürüst `unsupported` — sessiz düşme YOK)
8. Execution                (timeout · abort · dedupe · stale)
9. Observation              (VerificationLevel)
10. SafetyKernel POST-GATE  (online cevabın doğrulanması)
```

**Her kapı fail-closed.** Kapının kendisi hata verirse → **ret** (mevcut disiplin).

### 22.3 LLM'in yetkisizliği (I4'ün kod karşılığı)

| Yanlış varsayım | Gerçek |
|-----------------|--------|
| "Model tool çağırabiliyorsa yetkilidir" | Tool router 7 kapılı; `effect` allowlist'i model kararının **dışında** |
| "Model `confirmed:true` gönderebilir" | Onay **yalnız** `pendingActionConfirmation`'dan gelir; model alanı **yok sayılır** |
| "Model risk seviyesi belirtebilir" | Risk **defterden** okunur, model beyanı **yok sayılır** |
| "Model confidence verebilir" | Confidence **kanıttan türetilir** (`maviReasoningEngine` ilkesi) |

**Guard testi [TASARIM]:** LLM çıktısındaki `confirmed`, `risk`, `safetyClass`,
`verificationLevel` alanları parse aşamasında **atılır** (allowlist tabanlı şema).

### 22.4 `phone.call.start` düzeltmesi [BORÇ B8]

Bugün `requiresConfirmation: false` (`maviActionAuthority.ts:208`).
**Hedef:** `CONFIRM_THEN_ACT`, parametre tekrarlı onay ile:

```
"Anne — 0532 *** ** 41. Arayayım mı?"
```

**İstisna:** kullanıcı **numarayı tam söylediyse** ve tek eşleşme varsa
`SAFE_DIRECT`'e düşer (kullanıcı zaten açıkça belirtmiştir).
**Acil durum numaraları** (112 vb.) **her zaman** onaysız ve `PROHIBITED` dışıdır.

### 22.5 `companionEnabled` self-disable düzeltmesi [BORÇ B9b]

`settings.*` capability'sinin operation allowlist'inden **Mavi'nin kendi presence
ve wake ayarları çıkarılır**. Gerekçe: bir asistan kendini sesle kapatıp geri
açamayacak duruma getiremez (fail-closed). Kullanıcı bunu ayarlar ekranından yapar.

---

## 23. HATA VE KURTARMA (FAILURE & RECOVERY)

| # | Senaryo | Tespit | Davranış | Mavi ne der |
|---|---------|--------|----------|-------------|
| 1 | ASR yanlış anladı | Kullanıcı düzeltti / intent confidence düşük | Tur supersede; **tekrar sormaz**, en iyi tahmini onaylatır | *"Beşiktaş mı dedin?"* |
| 2 | Kullanıcı kendini düzeltti | IncrementalUnderstanding entity değişimi | **Son geçerli** entity; iki plan yok | — (sessizce doğru olanı yapar) |
| 3 | Kullanıcı Mavi'yi kesti | BargeIn | `ttsCancel()` < 120 ms · `MaviTurn.supersede()` | **Hiçbir şey** ("affedersin" yok) |
| 4 | LLM timeout | `AbortSignal` | Yol düşürme: DEEP → FAST → offline | *"Şu an cevap alamadım."* |
| 5 | Cloud offline | `aiOfflineReason` sebep kodu | Degraded mode; **sessiz düşme yok** | Bir kez: *"İnternet yok."* |
| 6 | Capability unavailable | Fabric availability | Yürütme **başlamaz** | *"Bu araçta yok."* / *"Şu an bunu bilmiyorum."* |
| 7 | Capability execution failed | `Observation.failureReason` | Adım `failed`; plan devam eder | *"Yapamadım — [bounded sebep]."* |
| 8 | Result unknown | `VerificationLevel = NONE / TRANSPORT_ACK` | **"yaptım" YASAK** | *"Gönderdim ama doğrulayamıyorum."* |
| 9 | Context stale | `ContextDatum.freshness = stale` | Karar kapısına girmez | *"12 dakika önceki ölçüme göre…"* |
| 10 | Çelişkili context | İki kaynak farklı | `unknown`'a düşer | *"Emin değilim."* |
| 11 | Compound kısmi başarısızlık | Adım bazlı `Observation` | Kalan adımlar devam | *"Rotayı açtım; aramayı yapamadım."* |
| 12 | TTS failure | Tüm katmanlar düştü | **Görsel fallback** + hata rozeti | (ekranda metin) |
| 13 | Connection recovered | breaker kapandı | Sessiz; yarım istek **yeniden denenmez** | — |
| 14 | Native STT çöktü | `PluginCall` reject + telemetri | `sttTelemetry` kaydedilir, Vosk/Google yedeği | *"Duyamadım, tekrar söyler misin?"* |
| 15 | Mikrofon izni yok | permission | İzin istenir; **tur düşmez** | *"Mikrofon izni gerekiyor."* |
| 16 | Plan bayat (kuşak değişti) | `generation` uyuşmazlığı | Plan **tümüyle reddedilir** | **Sessiz** (stale bir hata değildir) |
| 17 | Onay TTL doldu | 15 s | Adım `cancelled` | *"Boşver, iptal ettim."* (bir kez) |
| 18 | Aynı komut iki kez (çift STT) | dedupe penceresi | İkincisi `duplicate` | **Sessiz** |

**Genel kural:** Mavi **başarısız işlemi başarılı göstermez** ve
**stale'i hata gibi sunmaz**. Bu iki kural `maviFakeAck.test.ts` ve
`maviStaleAuthority.test.ts` ile zaten kilitli — kilitler genişletilir.

---

## 24. GÜVENLİK VE GİZLİLİK (SECURITY & PRIVACY)

### 24.1 Mikrofon yaşam döngüsü

| Faz | Mikrofon | Veri nereye |
|-----|----------|-------------|
| `IDLE` | **Kapalı** | — |
| `AMBIENT` (wake açık) | Açık, **grammar kısıtlı** (yalnız wake sözleri + `[unk]`) | Cihazdan **çıkmaz** |
| `LISTENING` | Açık, tam | Vosk yerel; **online + izinliyse** WAV bulut STT'ye |
| `SPEAKING` (full-duplex) | Açık, VAD + wake | Cihazdan çıkmaz |
| İzin yok | Kapalı | — |

**Wake gizliliği:** Wake grammar thread'i **transcript üretmez**, yalnız eşleşme
kararı emitler. `wakeForensics` **transcript taşımaz** — yalnız türetilmiş sayılar
(mevcut disiplin, KEEP).

### 24.2 Bulut aktarım sınırı

| Veri | Buluta gider mi |
|------|-----------------|
| Ses (WAV) | **Yalnız** aktif dinlemede + online + anahtar varsa (STT) |
| Transcript | DEEP path'te evet |
| OBD **ham** verisi | **HAYIR** — yalnız yorumlanmış cümle (mevcut Commit-2 garantisi) |
| VIN · plaka | **HAYIR** |
| Konum (koordinat) | **HAYIR** — yalnız `formatLocationContextLine` çıktısı (yer adı) |
| Telefon numarası · kişi adı | **HAYIR** — opak id |
| Hafıza | `sensitiveMemoryGuard` filtresinden geçmiş, etiketli |
| API anahtarı | **HAYIR** (BYOK, `sensitiveKeyStore`) |

### 24.3 Konuşma saklama (retention)

| Katman | Kalıcılık | Silme |
|--------|-----------|-------|
| Ses (PCM/WAV) | **Sıfır** — STT'den sonra bellekten düşer | otomatik |
| TurnMemory | RAM, oturum | uygulama kapanınca |
| TripMemory | RAM + izinli özet | yolculuk sonu |
| LongTermMemory | `safeStorage`, max 15+15 kayıt | *"hepsini unut"* (mevcut) + ayarlar |
| Telemetri | Sayaç/süre/enum — **içerik yok** | halka tampon |

### 24.4 Prompt injection savunması [BORÇ B14 çözümü]

**Bugün:** yalnız hafıza bloğu *"VERİdir, TALİMAT DEĞİLDİR"* etiketli.
**Hedef:** **tüm** dış/kullanıcı-üretimi metin aynı zarfa girer:

```
<UNTRUSTED_DATA source="poi_search" trust="low">
…içerik…
</UNTRUSTED_DATA>
```

Kapsam: POI adları · kişi adları · medya metadata (şarkı/sanatçı adı) · web arama
sonuçları · DTC açıklama metinleri · fleet notları · companion (telefon) mesajları.

**Yapısal savunma (prompt'tan güçlü):** LLM çıktısı **capability çağıramaz**.
Model yalnız `{intent, params}` önerir; şema **allowlist** ile doğrulanır
(bilinmeyen alan **reddedilir** — mevcut `toolRouter` kapı-5 davranışı).
Bu yüzden injection en fazla **yanlış öneri** üretebilir, **yetkisiz eylem üretemez**.

### 24.5 Capability abuse savunması

1. **Rate limit:** capability başına tur/dakika tavanı.
2. **Sequence policy:** tek turda çoklu riskli eylem → `sequenceConfirmationPolicy` reddi (mevcut).
3. **Nonce:** donanım komutları `checkCommandNonce` ile tekrar oynatmaya kapalı (native, mevcut).
4. **Audit trail:** `maviActionTrace` (mevcut bounded aşama halkası) → her kapı kararı kaydedilir.

### 24.6 Denetim izi (audit trail)

`maviActionTrace` genişletilir: `turnId · capabilityId · op · gate decisions[] ·
verification · failureReason · durationMs`. **Argüman değeri, transcript ve
kullanıcı metni bu ize GİRMEZ** (mevcut gizlilik sözleşmesi).

### 24.7 Ticari lisans uyumu (CLAUDE.md)

| Bileşen | Lisans | Durum |
|---------|--------|-------|
| Vosk + TR model | Apache-2.0 | ✅ satılabilir |
| Edge TTS proxy | Birinci taraf servis | ⚠️ **ToS incelemesi gerekli** — üçüncü taraf head unit'e satışta bağımlılık |
| Gemini / Groq / OpenRouter | BYOK | ✅ gömülü anahtar yok |
| Ses klipleri | Üretim kaynağı **belgelenmeli** | ⚠️ **[BORÇ]** klip lisans kütüğü yok |

> **Yeni eklenecek hiçbir model/ses/veri GPL · AGPL · LGPL · SSPL · CC-BY-NC olamaz.**

---

## 25. GÖZLEMLENEBİLİRLİK (OBSERVABILITY)

### 25.1 CAROS LAB zorunluluğu

CLAUDE.md gereği: **gözlemlenemeyen özellik tamamlanmış değildir.**
Mevcut Mavi LAB ekranları: `mavi-console` · `mavi-reasoning-engine` ·
`action-registry` · `stt-mic` · `tool-calling` · `ai-memory`.

**Eklenecek ekranlar [TASARIM] (hepsi salt-okunur, komut göndermez):**

| Ekran | İçerik |
|-------|--------|
| `mavi-latency` | Segment bazlı uçtan uca gecikme dağılımı (p50/p90/p99) |
| `capability-fabric` | Kayıtlı capability'ler · availability · op sayısı · son karar |
| `mavi-turn-trace` | Son N tur: yol (fast/det/deep) · kapı kararları · verification · sonuç |
| `proactive-policy` | Teklifler · skorlar · kabul/ret oranları · suppression listesi |
| `workload-policy` | Anlık workload + girdi sinyalleri (salt-okunur) |
| `context-freshness` | ContextDatum tablosu: değer VAR/YOK · freshness · provenance |

### 25.2 Metrik seti

| Metrik | Tanım | Hedef |
|--------|-------|-------|
| `wakeLatencyMs` | Wake sözü sonu → `AMBIENT`→`LISTENING` | p90 ≤ 250 ms |
| `asrFirstPartialMs` | Konuşma başı → ilk partial | p90 ≤ 300 ms |
| `speechEndToFirstAudioMs` | **Ana metrik** | §26 |
| `interruptionLatencyMs` | Barge-in → TTS sustu | p95 ≤ 120 ms |
| `intentAccuracy` | Doğru intent / toplam (etiketli set) | ≥ 0.93 |
| `capabilityExecSuccess` | `observed ≥ OBSERVED_STARTED` / denenen | ≥ 0.95 |
| `falseConfirmationRate` | "yaptım" dedi ama gözlem yok | **0** (sıfır tolerans) |
| `conversationAbandonment` | Kullanıcı cevap almadan kapattı | ≤ 0.05 |
| `cloudDependencyRate` | DEEP'e giden tur / toplam tur | ≤ 0.35 |
| `proactiveAcceptRate` | Kabul / gösterilen | ≥ 0.40 (altına düşerse eşik yükselir) |
| `recoverySuccessRate` | Hata sonrası aynı turda tamamlanan | ≥ 0.70 |
| `fillerEmissionCount` | Yapay ara söz sayısı | **0** (I11 kilidi) |
| `ackEmittedCount` | Seslendirilen **semantik ACK** sayısı (filler DEĞİL) | hedef YOK — yalnız ayrıştırma |
| `partialCount` | Tur başına işlenen kısmi transkript adedi (F3) | > 0 = streaming akıyor |
| `endpointReason` dağılımı | Cümle-sonu sebebi (bounded enum, F3) | `SEMANTIC_CONFIDENT` payı artmalı |
| `endpointCommanded` | Erken bitirme komutunun GERÇEKTEN gönderildiği tur (F3) | gölge kipte **0** |
| `sttCapability` dağılımı | Yolun bildirdiği akış yeteneği (F3) | sahte streaming = **0** |

### 25.3 Gizlilik sınırı (LAB)

`ToolTelemetry` deseni (mevcut): **argüman ve sonuç taşımaz**.
Aynı kural tüm yeni telemetriye uygulanır: yalnız sabit tanımlayıcı · enum ·
sayaç · süre. **Transcript, prompt, konum, kişi, VIN LAB'a girmez** (yalnız VAR/YOK + adet).

### 25.4 "Kanıtsız bilgi üretme" kuralı

Hiç ölçüm yoksa **"%100 başarılı" yazılmaz** — `KAYNAK YOK` gösterilir
(mevcut `tool-calling` ekranının kuralı, tüm yeni ekranlara uygulanır).

---

## 26. GECİKME BÜTÇESİ (LATENCY BUDGET)

### 26.1 Bugünkü durum [TÜRETİLDİ — saha ölçümü DEĞİL]

Kod sabitlerinden hesaplanan **seri** zincir (online, bulut STT açık):

| Segment | Tipik | Kötü durum |
|---------|-------|-----------|
| VAD endpoint (`VOSK_VAD_SILENCE_MS`) | 1100 ms | 1100 ms |
| Vosk finalize + WAV paketleme | ~150 ms | ~400 ms |
| Bulut STT round-trip | ~700 ms | **6000 ms** (timeout) |
| Beyin (LLM) | ~900 ms | **4500 / 8000 ms** (timeout) |
| Cevap post-gate + kırpma | ~20 ms | ~50 ms |
| TTS sentez (Edge, ilk ses) | ~500 ms | **12000 ms** (timeout) |
| **speech-end → first audio** | **≈ 3400 ms** | **≈ 18–26 s** (üst sınırlar) |

Bu yüzden **1500 ms**'de filler devreye giriyor — yani filler, tipik durumda
neredeyse **her turda** çalışıyor.

> ⚠️ **UNKNOWN:** Gerçek cihaz ölçümü yok. `sttLatencyTelemetry` STT'yi ölçüyor
> ama uçtan uca zincir ölçülmüyor **[BORÇ B15]**. F0 fazının ilk işi budur.

### 26.2 Hedef bütçe

| Yol | Segment | Hedef p50 | Hedef p90 |
|-----|---------|-----------|-----------|
| **DETERMINISTIC** | semantic endpoint | 350 ms | 500 ms |
| | intent + kapılar | 15 ms | 40 ms |
| | capability exec (yerel) | 30 ms | 120 ms |
| | TTS ilk ses (**klip**) | **0 ms** | 60 ms |
| | **speech-end → first audio** | **≤ 400 ms** | **≤ 700 ms** |
| **FAST** | semantic endpoint | 500 ms | 800 ms |
| | streaming LLM ilk token | 250 ms | 600 ms |
| | ilk cümle tamam | 150 ms | 350 ms |
| | TTS ilk chunk | 200 ms | 450 ms |
| | **speech-end → first audio** | **≤ 900 ms** | **≤ 1600 ms** |
| **DEEP** | semantic endpoint | 700 ms | 1100 ms |
| | plan + kapılar | 80 ms | 250 ms |
| | streaming LLM ilk token | 500 ms | 1200 ms |
| | TTS ilk chunk | 250 ms | 550 ms |
| | **speech-end → first audio** | **≤ 1800 ms** | **≤ 3000 ms** |
| **Barge-in** | ses → TTS sustu | **≤ 80 ms** | **≤ 120 ms** |
| **Wake** | söz sonu → dinliyor | ≤ 200 ms | ≤ 300 ms |

### 26.3 Ultra-premium hedef (kuzey yıldızı)

> **DETERMINISTIC yolda `speech-end → first audio` ≤ 400 ms p50.**

Bu, "sözünü bitirir bitirmez cevap başlıyor" hissidir ve premium OEM asistanların
ayırt edici özelliğidir. Ulaşma yolu **model değil mimaridir**: semantic endpointing
(−750 ms) + önceden sentezlenmiş klip (−500 ms) + LLM'i tamamen atlama (−900 ms).

### 26.4 Tier bütçesi

| Tier | Streaming ASR | Full-duplex | Streaming TTS | Hedef p50 (FAST) |
|------|---------------|-------------|---------------|------------------|
| `HIGH` | ✅ | ✅ | ✅ | 900 ms |
| `MID` | ✅ | ✅ (AEC ölçümüne bağlı) | ✅ | 1200 ms |
| `LOW` | ✅ (partial seyrek) | ❌ half-duplex | Klip + tek atım | 1800 ms |

**Kural:** Düşük tier'da feda edilen **zekâ değil, yalnız akış/gösterim**
(CLAUDE.md Performans-Uyarlanabilir Hibrit kuralı).

---

## 27. OEM++ FARKLILAŞTIRICILARI

### 27.1 Benchmark özeti (mimari prensipler — **kopyalanmadı**)

Modern premium otomotiv asistanlarından ve konuşmalı yapay zekâ sistemlerinden
alınan **prensipler**:

| Prensip | Kaynak sınıfı | CarOS'a uyarlaması |
|---------|---------------|--------------------|
| Deterministik komut yolu LLM'i atlar | Premium OEM asistanlar | §10 DETERMINISTIC path |
| Streaming + barge-in kullanıcı kontrolü verir | Modern konuşmalı AI | §9 |
| Domain adapter'ları çekirdekten ayrı | OEM platform mimarileri | §11 Capability Fabric |
| Sürücü dikkati konuşma bütçesini belirler | ISO 15008 / otomotiv HMI | §16 |
| Asistan yeni gerçek üretmez, otoriteleri okur | Dağıtık sistem tasarımı | §8 |
| Offline temel yetenek kaybolmaz | Otomotiv güvenilirlik | §19 |

**CarOS'un asimetrik avantajı:** Tesla/OEM asistanları **kendi** aracını bilir.
CarOS **bilmediği yüzlerce aracı öğrenmek** zorundadır — bu yüzden `capabilityRegistry`,
`dtcAuthority` 4 değerli hüküm ve `playbackTruth` gibi **zero-trust kanıt katmanları**
bir yük değil, **ürünün kendisidir**. Hiçbir OEM'in buna ihtiyacı olmadığı için
hiçbirinde yoktur.

### 27.2 On iki OEM++ farklılaştırıcı

| # | Farklılaştırıcı | Kullanıcı değeri | Teknik gereksinim | Neden premium | Uygulanabilirlik |
|---|-----------------|------------------|-------------------|---------------|------------------|
| **D1** | **Kanıt Seviyeli Dürüstlük** — Mavi "yaptım" ile "gönderdim ama göremiyorum"u ayırt eder | Kullanıcı asistana **güvenir**; sessiz hoparlöre bakıp "çalıyor" yalanını duymaz | `VerificationLevel` tüm domainlere yayılır (§11.2) | Hiçbir asistan bunu yapmaz; hepsi iyimser ACK verir | **YÜKSEK** — `playbackTruth` referans uygulaması hazır |
| **D2** | **Bilmiyorum ≠ Yok** | "Bu araçta klima kontrolü yok" ile "şu an okuyamıyorum" farklı cevaplar | `capabilityRegistry` 6 durumlu status Fabric'e bağlanır | Aftermarket'te araç bilinmez; bu ayrım ürünün temeli | **YÜKSEK** — registry hazır |
| **D3** | **Sub-400ms Deterministik Refleks** | "Sesi kıs" der demez ses kısılır — telefon asistanlarından hızlı | Semantic endpointing + klip TTS + LLM bypass | Algılanan kalitenin **tek en büyük** belirleyicisi | **ORTA** — native partial + endpointer gerekir |
| **D4** | **Tek Cümle, Çok İş** (compound + kısmi dürüstlük) | "Rota aç, sesi kıs, annemi ara" tek nefeste | `executionEngine` (hazır) + Planner | Çoğu asistan tek intent işler; kısmi başarıyı hiçbiri dürüstçe raporlamaz | **YÜKSEK** — motor shadow'da hazır |
| **D5** | **Sürüş Yükü Farkındalığı** | Karmaşık kavşakta Mavi susar, düzlükte sohbet eder | `DriverWorkloadPolicy` + navigation manevra sinyali | Güvenlik + "bu asistan yol biliyor" hissi | **ORTA** — sinyaller mevcut, birleştirme gerek |
| **D6** | **Yol Arkadaşı ≠ Kısıtlama** | Şalter kapalıyken bile Mavi tam yetenekli | Presence policy ayrımı (§15) | Rakiplerde "kişilik modu" kapanınca asistan aptallaşır | **YÜKSEK** — dört guard kaldırılır |
| **D7** | **Offline'da Aynı Ses** | İnternet yokken kişilik değişmez (erkek eSpeak'e düşmez) | 200 ifadelik premium klip sözlüğü + offline intent | Offline'da robotlaşmak premium hissi anında öldürür | **YÜKSEK** — `voiceClips` altyapısı var |
| **D8** | **Araç Kararı LLM'e Sorulmaz** | Arıza hükmü halüsinasyon içermez | `maviReasoningEngine` (LLM'siz) kararı **ezilemez** | Otomotivde halüsinasyon **kabul edilemez**; mimari ile engelleniyor | **YÜKSEK** — motor hazır, kilit testi var |
| **D9** | **Proaktiflik Öğrenir** | Reddedilen öneri türü kendiliğinden susar | `ProactivePolicyEngine` + kaynak bazlı kabul oranı | "Asistan beni tanıyor" hissi; spam'in yapısal sonu | **ORTA** |
| **D10** | **Yolculuk Hafızası** | 3 saat sonra "hani şu bahsettiğin yer" anlaşılır | TripMemory + topic continuity | Uzun yolda gerçek arkadaşlık hissinin **tek** teknik yolu | **ORTA** |
| **D11** | **Bağlam Tazeliğini Söyleyen Asistan** | "12 dakika önceki ölçüme göre motor normaldi" | `ContextDatum.freshness` zorunlu | Zero-trust telemetride **doğruluk = tazelik itirafı** | **YÜKSEK** — disiplin zaten var |
| **D12** | **Genişleyen Zekâ, Sabit Çekirdek** | Yeni CarOS modülü aynı gün Mavi'den kullanılır | Capability Fabric kayıt sözleşmesi | Ürün ömrü boyunca marjinal maliyeti düşürür | **YÜKSEK** |

**Gimmick olarak REDDEDİLENLER (bilinçli):** avatar/3D yüz · duygu tanıma iddiası ·
"AI sürüş koçu puanı" · tıbbi yorgunluk teşhisi · asistanın kendi kendine
rota/hız değiştirmesi · sesli reklam/öneri monetizasyonu.
---

## 28. GEÇİŞ STRATEJİSİ (MIGRATION)

### 28.1 Temel ilke — **STRANGLER FIG, BIG-BANG DEĞİL**

`AI.md` ve CLAUDE.md gereği: **çok-sistemli refactor yasak · atomik patch zorunlu ·
kısmi mantık bırakılmaz.** Bu yüzden geçiş **hat değiştirme** ile değil,
**yetki devri** ile yapılır.

### 28.2 Üç hattın birleşme sırası

```
BUGÜN                          GEÇİŞ                            HEDEF
─────                          ─────                            ─────
HAT-1 canlı (voiceService)  ─► algı sürücüsü olarak kalır  ─►  L1 PERCEPTION
HAT-2 shadow (maviCore)     ─► adım adım takeover          ─►  MCX L0/L4/L7
HAT-3 bayraklı (ai/*)       ─► bayraklar sırayla açılır    ─►  L3 DEEP path
```

### 28.3 Takeover mekanizması (mevcut, kanıtlanmış)

`takeoverArbiter` + `takeoverPolicy` **zaten** eylem bazlı devir için tasarlanmış
ve **fail-open** (hakem hata verirse eski hat çalışır). Geçiş bunu kullanır:

```
her fazda:  allowlist'e N yeni actionId eklenir
            → shadow'da 1 hafta gözlem (LAB'da iki hattın kararı KARŞILAŞTIRILIR)
            → sapma yoksa takeover
            → eski hattın o dalı SİLİNİR (ölü kod bırakılmaz)
```

**Kritik:** Aynı eylem **iki hatta birden** çalışamaz — `maviOwnership` +
`isCommandOwnedByMavi` guard'ı bunu zaten sağlıyor (`useVoiceCommandHandler.ts:32`).

### 28.4 Bayrak disiplini [BORÇ B13 çözümü]

11 bayrak **sonsuza kadar açık kalmaz**. Her bayrak için:
1. Açılma kriteri (ölçülebilir) tanımlanır.
2. Açıldıktan **iki sürüm sonra** bayrak **kaldırılır** ve kod tek yol olur.
3. Kaldırılamayan bayrak = **kararsız özellik** → ya bitirilir ya silinir.

### 28.5 Geri dönüş (rollback) garantisi

Her faz **tek şalterle** geri alınabilir olmalıdır ve şalter kapalıyken davranış
**birebir bugünküdür**. Bu, `MAVI_TAKEOVER_FLAG` ve `aiGatewayFlag` desenlerinin
**zorunlu** hale getirilmesidir.

---

## 29. UYGULAMA FAZLARI (F0 … F13)

> Her faz **atomik**tir, tek başına sevk edilebilir, tek şalterle geri alınabilir
> ve kendi CAROS LAB yüzeyiyle birlikte tamamlanır (CLAUDE.md §Gözlemlenebilirlik).

---

### F0 — GERÇEĞİ ÖLÇ (Uçtan uca gecikme telemetrisi)

- **Amaç:** `speech-end → first audio`'yu gerçek cihazda ölçmek.
- **Neden gerekli:** Bugün bu değer **UNKNOWN**. Ölçmeden optimizasyon yapmak
  CLAUDE.md'nin "kanıtsız özellik yasak" kuralını ihlal eder.
- **Değişecek componentler:** `maviCore/latencyTelemetry` (shadow'dan **ölçüm-only**
  olarak canlıya) · `voiceService` (marker çağrıları) · `ttsService` (ilk-ses marker'ı) ·
  yeni LAB ekranı `mavi-latency`.
- **Korunacak authority:** Hepsi — **davranış değişikliği YOK**, yalnız ölçüm.
- **Bağımlılıklar:** Yok. **İlk faz budur.**
- **Risk:** DÜŞÜK. Ölçüm hot-path'e girmez (marker = tek `performance.now()` çağrısı).
- **Testler:** `maviLatencyTelemetry.test.ts` genişletilir · marker sırası kilidi ·
  ölçümün karar etkilemediği guard testi.
- **Kabul ölçütü:** Gerçek cihazda 50 tur sonunda LAB ekranı p50/p90/p99 gösteriyor;
  segment toplamı uçtan uca değerin **±%5**'i içinde.
- **DONE:** LAB ekranı canlı + `DEVICE_VALIDATION_LEDGER`'a 🔴 madde eklendi +
  gerçek araçta bir sürüşte ölçüm alındı → 🟢.

---

### F1 — YOL ARKADAŞI'NI ŞALTER OLMAKTAN ÇIKAR

- **Amaç:** `roadCompanionEnabled` yalnız presence'ı yönetsin; Mavi kapalıyken de tam yetenekli olsun (I2).
- **Neden gerekli:** Ürün tanımının **en temel ihlali** bu (G2/B3).
- **Değişecek componentler:** `companionChatProvider.ts` dört guard
  (`:2358, :2672, :2785, :2851`) → kaldırılır; presence bir **prompt/ton parametresi**
  olur · `useStore` migration (v-next) · `SettingsPage` metni.
- **Korunacak authority:** `assistantSafetyKernel` PRE/POST gate · `maviTurn` ·
  `maviSpeech` · proaktif motorun presence bağımlılığı (proaktiflik **presence'a bağlı kalır**).
- **Bağımlılıklar:** F0 (regresyon ölçümü için).
- **Risk:** ORTA — presence kapalı kullanıcılarda **AI çağrı hacmi artar** (BYOK maliyeti).
  Azaltım: DETERMINISTIC yol önce denenir; kullanıcıya "AI kullanımı" görünürlüğü.
- **Testler:** `companionEnabled=false` iken beynin **çalıştığı** yeni testler ·
  proaktifin **çalışmadığı** testler · `regression.guards`'a kilit.
- **Kabul ölçütü:** Presence kapalıyken: LLM sohbeti ✅ · compound ✅ · capability ✅ ·
  proaktif sohbet ❌ · güvenlik proaktifi ✅. Beş senaryo cihazda doğrulanır.
- **DONE:** Ayar adı ve açıklaması güncellendi · vizyon belgesi + kütük güncellendi.

---

### F2 — FILLER İMHASI + DÜRÜST ACK POLİTİKASI

- **Amaç:** I11'i koda yazmak.
- **Neden gerekli:** Filler, gecikmeyi örten bir yalandır ve kanıtlanmış şekilde
  cevabı kesmektedir (`voiceService.ts:1691`).
- **Değişecek componentler:** `voiceService.ts:1062-1077` (`THINKING_PHRASES`,
  `_speakThinking`, timer) **silinir** · `voiceService.ts:867` · `commandExecutor.ts:810` ·
  `voiceInfoService.ts:83` · `maviFeedback.ts:50-51` · **`companionChatProvider.ts:2047-2048`
  prompt örneği** (`feedback:"Bakıyorum"` → gerçek bilgi taşıyan örneğe çevrilir).
- **Korunacak authority:** `maviSpeech` tek-`answer` sözleşmesi · `progress` tier'ı
  **kalır** ama yalnız §9.6 kriterini geçen metinler için.
- **Bağımlılıklar:** F0 (filler kalkınca algılanan gecikmenin ölçülmesi).
- **Risk:** ORTA — streaming gelmeden filler kalkarsa **algılanan sessizlik artar**.
  Azaltım: F2 **F3/F4 ile aynı sürümde** sevk edilir; ayrı sevk edilmez.
- **Testler:** `fillerEmissionCount === 0` guard testi · her mevcut filler çağrısı
  için "artık konuşmuyor" testi · §9.6 kriterini geçen ack'lerin **hâlâ** konuştuğu testi.
- **Kabul ölçütü:** 100 turluk cihaz oturumunda `fillerEmissionCount = 0`;
  kullanıcı memnuniyet notu düşmemiş.
- **DONE:** Kilit testi `regression.guards`'ta.

> **🟡 UYGULANDI (2026-08-29) — KOD TAMAM, SAHA BORCU AÇIK.** Kütük: 🔴 #966-#969.
>
> **Yapılanlar (envanterdeki altı kaynağın hepsi):** `voiceService` timer +
> `THINKING_PHRASES` + `_speakThinking` **silindi** · `voiceService:867` →
> `"Araçtan okuyorum."` · `commandExecutor:810` → `` `${sensorQuery} okunuyor` `` ·
> `voiceInfoService:83` → `"Hava durumunu alıyorum."` · `maviFeedback` STAGE
> `understanding`/`planning` satırları **kaldırıldı** (+ `maviVoiceBridge` planlama
> emit'i) · prompt örnekleri anlamlı onaya çevrildi + tek satırlık
> `GECİKME ÖRTME YASAK` kuralı eklendi.
>
> **Envanterde OLMAYAN, uygulamada eklenen üç şey:**
> 1. **Yapısal ayrım:** yeni saf modül `assistant/maviAckPolicy.ts` — içeriksiz
>    bekletme kalıplarını **ÇAPALI (tam eşleşme)** regex'lerle tanır. Çapa kuralın
>    güvenlik özelliğidir: kalkarsa kalıp cümle İÇİNDE eşleşir ve semantik ACK'i de
>    yutar. `maviSpeech` bunu **YALNIZ `progress`** katmanında zorunlu kılar;
>    `answer` (nihai cevap · gerçek hata · belirsizlik sorusu · yetenek reddi)
>    kapıdan HİÇ geçmez.
> 2. **Model sınırı:** `parseBrainJson` içinde `feedback` süzgeci — model prompt
>    kuralına rağmen filler üretirse o metin ne seslendirilir, ne diyalog geçmişine
>    yazılır, ne kısa süreli hafızaya girer.
> 3. **Dürüst metrik:** `filler_trigger` **kaldırılmadı**; damga artık ara sözün
>    seslendirildiği değil **yakalanıp düşürüldüğü** anda basılır → üretimde beklenen
>    değer 0, sıfırdan büyük her değer bir REGRESYON kanıtıdır. Mevcut F0 izine
>    bounded `ack_emitted` + `ackCount` eklendi (ACK filler sayılmasın diye);
>    **yeni telemetri sistemi kurulmadı.**
>
> **Risk kararı (spec'teki "F3/F4 ile aynı sürümde sevk edilir" notuna karşı):**
> F2 **ayrı** sevk edildi. Gerekçe: filler yalnız gecikmeyi örtmüyordu, **cevabın
> kendisini kesiyordu** — yani ürün için net negatifti ve F3'ü beklemek kusuru
> uzatırdı. Algılanan sessizlik artışı bilinçli kabul edildi ve **cihaz doğrulama
> maddesine** yazıldı. Cihazda kabul edilemez çıkarsa çözüm filler'ı geri getirmek
> DEĞİL, F3/F4'ü öne almaktır.
>
> **Test durumu:** tam süit **15931/15931 PASS** · `tsc -b` temiz · lint **0 hata**.
> Kilitler: `maviFillerAbolition.test.ts` (15 kilit) + `regression.guards` (4 kilit).
> **Saha:** `fillerEmissionCount = 0` (100 tur) ölçütü **cihazda doğrulanmadı**.

---

### F3 — STREAMING ASR + SEMANTIC ENDPOINTING

- **Amaç:** Kısmi transkript akışı ve akıllı cümle-sonu tespiti.
- **Neden gerekli:** Endpoint gecikmesi (1100 ms) tek başına bütçenin **~%32**'si.
- **Değişecek componentler:** `CarLauncherPlugin.java` (Vosk aktif dinleme döngüsünde
  `sttPartial` event · `onPartialResults` doldurma) · `voiceService` (partial aboneliği) ·
  yeni `voice/semanticEndpointer.ts` (SAF) · `intentResolver` (partial modu).
- **Korunacak authority:** **Partial hiçbir eylem yetkisi vermez** (K5) ·
  `voiceTuning` zaman hiyerarşisi kilidi (yeni eşiklerle **yeniden kilitlenir**).
- **Bağımlılıklar:** F0.
- **Risk:** YÜKSEK — erken endpoint **kullanıcının sözünü keser** (en kötü UX hatası).
  Azaltım: eşikler **kademeli** (1100 → 900 → 700 → 500 → 350) ve her kademe
  cihazda ölçülür; `prematureEndpointRate` metriği eşik yükseltir.
- **Testler:** `semanticEndpointer` saf birim testleri (TR cümle setleri) ·
  partial→eylem yasağı guard'ı · zaman hiyerarşisi kilidi.
- **Kabul ölçütü:** `prematureEndpointRate ≤ 2%` **ve** deterministik komutta
  endpoint gecikmesi p50 ≤ 450 ms.
- **DONE:** LAB `stt-mic` ekranına partial/endpoint sekmesi eklendi · kütük 🟢.

> **🟡 UYGULANDI (2026-08-29) — KOD TAMAM, SAHA + APK BORCU AÇIK.** Kütük: 🔴 #970-#974.
>
> **Yapılanlar:**
> · `CarLauncherPlugin.java` — Vosk aktif dinleme döngüsü `sttPartial` yayınlıyor
>   (aynı döngü/recognizer, yeni ses yakalama YOK; metin değişiminde ya da ≥160 ms
>   arayla, bounded) · `onPartialResults` gövdesi DOLDURULDU ·
>   `EXTRA_PARTIAL_RESULTS` isteniyor (bayraksız çoğu motor geri çağrıyı hiç
>   çağırmıyordu — gövdeyi doldurmak tek başına YETMEZDİ, envanterde bu eksikti).
> · Yeni **SAF** modül `voice/semanticEndpointer.ts` (import'suz yaprak) ·
>   yeni oturum runtime'ı `voice/sttPartialStream.ts` (DI portlu, kendi timer'ı YOK).
> · `voiceService` kısmi oturumu açar/kapatır; web `interimResults` de AYNI kapıdan geçer.
>
> **Spec'te OLMAYAN, uygulamada eklenen dört şey:**
> 1. **`finalizeSpeechRecognition` native komutu.** Spec endpoint kararını
>    tarifliyordu ama JS'in native oturumu erken bitirebileceği bir yol YOKTU
>    (`stopListening` yalnız JS durumunu değiştiriyor, native döngüye dokunmuyor).
>    Karar JS'te (test edilebilir, Türkçe örüntüler kilitlenebilir), YÜRÜTME
>    native'de. Fail-safe: konuşma GÖRÜLMEDİYSE komut yok sayılır.
> 2. **Sağlayıcı yetenek matrisi** (`STREAMING_WITH_VAD` · `STREAMING_TEXT_ONLY` ·
>    `FINAL_ONLY`). Akustik VAD yalnız Vosk yolunda JS'e açılır; diğerlerinde
>    **sahte sessizlik üretilmez** ve semantik yol yapısal olarak devre dışı kalır.
> 3. **Gölge kip (varsayılan).** Spec "eşikler kademeli (1100→900→700→500→350) ve
>    her kademe cihazda ölçülür" diyor ama ölçümün İLK kademede bile kullanıcıyı
>    kesme riski var. Komut kipi varsayılan KAPALI → karar üretilir ve ölçülür,
>    cihaz davranışı DEĞİŞMEZ. `prematureEndpointRate` kimseyi kesmeden ölçülür.
> 4. **ASKIDA-önce sıralaması** anlam sınıflandırıcısında bir GÜVENLİK
>    değişmezidir ve kilitlidir ("beni eve götür **ama**" → DANGLING).
>
> **Ölçülmemiş olan (dürüstlük):** Gecikme kazancı **İDDİA EDİLMEMİŞTİR.** Komut
> kipi kapalıyken endpoint süresi bugünküyle **aynıdır**; `prematureEndpointRate`
> ve `endpoint p50 ≤ 450 ms` kabul ölçütleri **UNKNOWN**'dır.
>
> **Test/derleme:** tam süit **15962/15962 PASS** · `tsc -b` temiz · lint **0 hata** ·
> `:app:compileDebugJavaWithJavac` **EXIT=0**. Kilitler: `maviStreamingAsr.test.ts`
> (26) + `regression.guards` (5). **APK cihaza kurulup çalıştırılmadı — BUILD/DEVICE
> VALIDATION REQUIRED.**

---

### F4 — STREAMING LLM + STREAMING TTS + OFFLINE KLİP SÖZLÜĞÜ

- **Amaç:** İlk sesin cevabın **tamamını beklememesi**.
- **Neden gerekli:** Bütçenin kalan büyük kısmı burada.
- **Değişecek componentler:** `aiGateway` (`stream:true` + `onToken` yolu **açılır**;
  altyapı `openRouterProvider:440` **hazır**) · `geminiProvider` streaming alt-sürümü ·
  `speechSegment` ile cümle-sınırı flush · `edgeTtsService`/`onlineTtsService` chunk modu ·
  `voiceClips` sözlüğü 200 ifadeye çıkar.
- **Korunacak authority:** `maviSpeech` tek-`answer` (akış **tek answer**tir, çok değil) ·
  `_assistantGen` supersede koruması · çift-token yasağı · `ANSWER_CHAR_LIMIT` sürüş sınırı.
- **Bağımlılıklar:** F2 (filler kalkmış olmalı), F3 (endpoint).
- **Risk:** ORTA — akış ortasında kopma → yarım cümle. Azaltım: cümle sınırında flush
  (kelime ortasında asla) + kopmada dürüst kapanış.
- **Testler:** akış→cümle segmentasyonu birim testi · kopma senaryosu · supersede
  sırasında akışın durduğu testi · offline klip kapsama testi.
- **Kabul ölçütü:** FAST yolda `speechEndToFirstAudioMs` p50 ≤ 900 ms (cihazda) ·
  offline'da ses **kadın kalıyor** (klip kapsama ≥ %80).
- **DONE:** `mavi-latency` LAB'da hedefin altında · kütük 🟢.

---

### F5 — CAPABILITY FABRIC v1 (salt-okunur)

- **Amaç:** `CapabilityContract` katmanı + `capabilityRegistry` bağlantısı; **yalnız READ op'ları**.
- **Neden gerekli:** "bilmiyorum ≠ yok" ayrımı (D2) ve genişletilebilirlik (D12).
- **Değişecek componentler:** yeni `platform/capability/contracts/*` · `capabilityRegistry`
  kaydına `operations` alanı · `ai/tools/maviTools` **Fabric'e taşınır** (5 araç → contract) ·
  yeni LAB ekranı `capability-fabric`.
- **Korunacak authority:** `capabilityRegistry` karar ilkesi (zero-trust, fail-closed) ·
  `toolRouter` 7 kapısı · `AiSafetyGate`.
- **Bağımlılıklar:** Yok (paralel gidebilir).
- **Risk:** DÜŞÜK — salt-okunur.
- **Testler:** contract şema kilidi · `PROHIBITED` kapsam kayıt yasağı guard'ı ·
  `unknown ≠ unavailable` cevap testi.
- **Kabul ölçütü:** En az **6 domain** contract kaydediyor; Mavi "bu araçta yok" ile
  "şu an okuyamıyorum"u ayırt eden 10 senaryoyu geçiyor.
- **DONE:** LAB ekranı canlı · kütük 🔴→🟢.

---

### F6 — MCX TURN + PLAN + EXECUTOR CANLIYA (compound commands)

- **Amaç:** `maviCore`'u shadow'dan çıkarmak; çok adımlı komut.
- **Neden gerekli:** G3 + G5. Yazılmış 6958 satır bugün sıfır değer üretiyor.
- **Değişecek componentler:** `maviLifecycle` (yeni durumlar) · `executionEngine`
  (canlı handler'lar) · `takeoverPolicy` allowlist **kademeli** genişler ·
  `platformCoreMaviVoiceWiring` · yeni `Planner` (compound).
- **Korunacak authority:** `takeoverArbiter` fail-open · `maviOwnership` çift-yürütme
  yasağı · `maviActionAuthority` kapıları · `AiSafetyGate` · `navigationService` claim.
- **Bağımlılıklar:** F5 (capability çözümü).
- **Risk:** **YÜKSEK** — canlı davranış değişir. Azaltım: eylem bazlı kademeli takeover
  (§28.3) · her kademede **shadow karşılaştırma** LAB'ı · tek şalterle geri dönüş.
- **Testler:** mevcut `maviPlanExecutor` / `maviExecutionEngine` / `maviTurnRace` /
  `maviHybridTakeover` testleri genişletilir · compound sıralama/bağımlılık ·
  kısmi başarısızlık cevabı · iptal semantiği · rollback.
- **Kabul ölçütü:** 3 işli compound komut cihazda **her adımı doğru raporlayarak**
  çalışıyor · shadow karşılaştırmada 200 turda **0 sapma** · çift yürütme **0**.
- **DONE:** `mavi-turn-trace` LAB ekranı canlı · eski hattın devralınan dalları **silindi**.

---

### F7 — OBSERVATION & RECONCILIATION GENELLEŞTİRME

- **Amaç:** `VerificationLevel`'ı medya dışındaki tüm domainlere yaymak (D1).
- **Neden gerekli:** G6 — "yaptım" iddiası hâlâ iyimser.
- **Değişecek componentler:** `playbackTruth`'tan `VerificationLevel` **ortak katmana
  yükseltilir** · her `*AuthorityPort` `Observation` döndürür · `ResponseComposer`
  (yeni, saf) — cümleyi **yalnız** Reconciliation'dan kurar.
- **Korunacak authority:** `playbackTruth` **aynen** çalışmaya devam eder (tip taşınır,
  mantık taşınmaz) · `intentExecutionResult` zarfı.
- **Bağımlılıklar:** F5, F6.
- **Risk:** ORTA — bazı domainlerde `TRANSPORT_ACK`'ten fazlası kanıtlanamaz →
  Mavi daha **temkinli** konuşur. Bu **istenen** davranıştır ama kullanıcıya
  "eskiden kesin konuşuyordu" hissi verebilir. Azaltım: dil kalibrasyonu (§EK-A).
- **Testler:** `falseConfirmationRate = 0` guard'ı · her domain için verification
  tavanı testi · "yaptım" kelimesinin izinsiz geçemediği metin testi.
- **Kabul ölçütü:** 200 turluk cihaz oturumunda **sıfır** kanıtsız "yaptım".
- **DONE:** Kilit `regression.guards`'ta.

---

### F8 — DRIVER WORKLOAD POLICY

- **Amaç:** Konuşma davranışını sürüş yüküne bağlamak (D5).
- **Neden gerekli:** G8 — bugün sürüş yükü Mavi'yi hiç etkilemiyor.
- **Değişecek componentler:** yeni `platform/assistant/driverWorkloadPolicy.ts` (SAF) ·
  girdi adaptörü (composition root) · `ResponseComposer` uzunluk kararı ·
  `ProactivePolicyEngine` girdisi · LAB `workload-policy`.
- **Korunacak authority:** `useCognitiveStore` (okunur, **yazılmaz**) ·
  `assistantSafetyKernel` bu politikanın **üstünde**.
- **Bağımlılıklar:** F7.
- **Risk:** ORTA — yanlış yüksek workload Mavi'yi gereksiz susturur.
  Azaltım: hysteresis (CLAUDE.md §2.3) + LAB'da girdi görünürlüğü.
- **Testler:** saf politika birim testleri (girdi matrisi) · güvenlik uyarısının
  `CRITICAL`'da bile konuştuğu guard'ı · hysteresis testi.
- **Kabul ölçütü:** Karmaşık kavşak senaryosunda proaktif konuşma **0**;
  düz otoyolda normal davranış. Cihazda bir rota ile doğrulanır.
- **DONE:** LAB ekranı + kütük 🟢.

---

### F9 — PROACTIVE POLICY ENGINE

- **Amaç:** Tek merkezi proaktiflik kapısı (D9).
- **Neden gerekli:** G9 — kaynaklar bağlanamıyor, spam yapısal olarak engelli değil.
- **Değişecek componentler:** yeni `platform/assistant/proactivePolicyEngine.ts` (SAF) ·
  `companionEngine` **teklif üreticisine** indirgenir (motor olmaktan çıkar) ·
  navigation/vehicle/fleet teklif adaptörleri · LAB `proactive-policy`.
- **Korunacak authority:** `companionEngine` interaction gate mantığı (KEEP, taşınır) ·
  güvenlik tetiklerinin bütçeden bağımsızlığı · `TurnArbiter`.
- **Bağımlılıklar:** F8.
- **Risk:** ORTA — regresyon: mevcut 5 tetik davranışı değişebilir.
  Azaltım: 5 tetiğin mevcut testleri **aynen geçmeli**.
- **Testler:** mevcut companion proaktif testleri **değişmeden** yeşil ·
  spam tavanı testi · suppression/decay testleri.
- **Kabul ölçütü:** `proactiveAcceptRate` ölçülüyor · saatte sesli proaktif tavanı
  aşılmıyor · reddedilen kaynak 3 retten sonra susuyor.
- **DONE:** LAB ekranı + kütük 🟢.

---

### F10 — HAFIZA v2 (Trip + inferred)

- **Amaç:** TripMemory + explicit/inferred ayrımı (D10).
- **Neden gerekli:** G7.
- **Değişecek componentler:** yeni `platform/assistant/tripMemory.ts` ·
  `companionMemory` → `longTermMemory` (explicit) + inferred deposu ·
  `ai/memory/memoryEngine` bayrağı **açılır** ve tek okuma katmanı olur ·
  LAB `ai-memory` genişletilir.
- **Korunacak authority:** `sensitiveMemoryGuard` (okuma yolunda da) ·
  "VERİdir TALİMAT DEĞİLDİR" etiketi · bütçe sınırları.
- **Bağımlılıklar:** F6.
- **Risk:** ORTA — gizlilik. Azaltım: inferred kayıt **hiçbir zaman** PII içermez;
  yolculuk özeti **yalnız izinle** kalıcılaşır.
- **Testler:** decay/correction birim testleri · PII sızıntısı guard'ı ·
  inferred'in eylem gerekçesi olamadığı testi.
- **Kabul ölçütü:** Uzun yolculukta konu devamlılığı 3 senaryoda cihazda doğrulanıyor ·
  kullanıcı düzeltmesi sonrası aynı çıkarım tekrar üretilmiyor.
- **DONE:** LAB + kütük 🟢.

---

### F11 — UI DURUM MİMARİSİ v2

- **Amaç:** 10 durum + compact/expanded yüzey.
- **Neden gerekli:** G10/B11.
- **Değişecek componentler:** `livingThemeState` (`CompanionStatus` genişler) ·
  `VoiceAssistant` → `MaviSurface` · yeni compact şerit · `voiceOverlayShouldAutoClose` genişler.
- **Korunacak authority:** Navigasyon/müzik UI'sının kapanmaması · `AnimationLevel`
  tier disiplini · otomatik kapanma kilidi.
- **Bağımlılıklar:** F6, F8.
- **Risk:** DÜŞÜK-ORTA (görsel regresyon).
- **Testler:** `hudOverlayAnchors` / `hudTopBandLanes` gibi mevcut kilitler yeşil ·
  `UNDERSTANDING`'de model içeriğinin gösterilmediği guard'ı.
- **Kabul ölçütü:** Sürüşte navigasyon ekranı kapanmıyor · 10 durum LAB'dan tetiklenip
  görsel doğrulanıyor.
- **DONE:** Kütük 🟢.

---

### F12 — FULL-DUPLEX BARGE-IN

- **Amaç:** Mavi konuşurken kesilebilmesi (< 120 ms).
- **Neden gerekli:** İnsan gibi konuşmanın son eksik parçası.
- **Değişecek componentler:** `CarLauncherPlugin.java` (TTS sırasında mikrofon
  yaşam döngüsü + AEC referansı) · `voiceService` barge-in olayı · `ttsService` hızlı iptal.
- **Korunacak authority:** `maviTurn` supersede · `wakeMicMustYield` **fallback olarak kalır** ·
  ses hakemliği (K1).
- **Bağımlılıklar:** F3, F4.
- **Risk:** **YÜKSEK** — self-hearing (Mavi kendi sesiyle tetiklenir). Azaltım:
  cihaz bazlı AEC yeterlilik **ölçümü** (`voiceMicDiagnosticsProbe`), yetersizse
  **half-duplex'e otomatik düşme** (davranış bugünküyle aynı olur).
- **Testler:** self-trigger oranı testi · barge-in gecikme ölçümü · fallback yolu testi.
- **Kabul ölçütü:** `interruptionLatencyMs` p95 ≤ 120 ms **ve** self-trigger oranı
  ≤ %0.5; ölçüt tutmayan cihazda otomatik half-duplex.
- **DONE:** `HEAD_UNIT_MATRIX`'e cihaz bazlı AEC sonucu yazıldı · kütük 🟢.

---

### F13 — KONSOLİDASYON (üç hat → tek hat)

- **Amaç:** Ölü kodu silmek, bayrakları kaldırmak, tek Mavi bırakmak.
- **Neden gerekli:** B1/B13 — üç hat kalıcı borçtur.
- **Değişecek componentler:** `voiceService` (karar/route/TTS mantığı çıkar, algı kalır) ·
  `companionChatProvider` (DEEP sağlayıcısına indirgenir) · kaldırılan bayraklar ·
  silinen shadow handler'lar.
- **Korunacak authority:** Hepsi — bu faz **davranış değiştirmez**, yalnız kod siler.
- **Bağımlılıklar:** F1–F12 tamamlanmış olmalı.
- **Risk:** ORTA (silme riski). Azaltım: her silme öncesi **kullanım kanıtı**
  (statik tarama + LAB telemetrisi "bu dal hiç çalışmadı").
- **Testler:** Tüm suite yeşil · `maviLegacyGuard` genişletilir (silinen dalın
  geri gelmesi yasak).
- **Kabul ölçütü:** `voiceService` ≤ 900 satır · `companionChatProvider` ≤ 1200 satır ·
  açık bayrak sayısı ≤ 2 · aynı işi yapan ikinci kod yolu **yok**.
- **DONE:** `OLU_KOD_ENVANTERI` güncellendi · vizyon belgesi "TEK MAVİ" yazıyor.

---

## 30. KABUL KAPILARI (ACCEPTANCE GATES)

### 30.1 Her PR için (zorunlu)

| # | Kapı |
|---|------|
| G-1 | `npm run test` yeşil · `tsc -b` temiz · `npm run lint` temiz |
| G-2 | `regression.guards` **zayıflatılmadı** (kilit sayısı azalmadı) |
| G-3 | Yeni önemli alt sistem → **CAROS LAB salt-okunur ekranı var** |
| G-4 | `DEVICE_VALIDATION_LEDGER`'a 🔴 madde + **ölçülebilir** kabul ölçütü eklendi |
| G-5 | `docs/CAROS_PRO_VIZYONU.md` durum + kalan eksik + sonraki atomik PR güncellendi |
| G-6 | Tek şalterle geri dönülebilir |
| G-7 | Import yan etkisi yok (timer/abonelik/native/singleton) |
| G-8 | Zero-leak: her abonelik/timer'ın cleanup'ı var |
| G-9 | Performans bütçesi: hot-path'e (3 Hz) yeni iş eklenmedi |
| G-10 | Lisans: yeni bağımlılık permissive (MIT/Apache/BSD/ISC/OFL) |

### 30.2 Faz kapıları (ölçülebilir)

| Faz | Kapı |
|-----|------|
| F0 | Uçtan uca gecikme cihazda ölçüldü; segment toplamı ±%5 |
| F1 | Presence kapalı 5 senaryo doğrulandı |
| F2 | `fillerEmissionCount = 0` (100 tur) |
| F3 | `prematureEndpointRate ≤ 2%` · endpoint p50 ≤ 450 ms |
| F4 | FAST p50 ≤ 900 ms · offline klip kapsama ≥ %80 |
| F5 | ≥ 6 domain contract · "bilmiyorum ≠ yok" 10 senaryo |
| F6 | Compound 3 iş · shadow sapma 0 (200 tur) · çift yürütme 0 |
| F7 | `falseConfirmationRate = 0` (200 tur) |
| F8 | Karmaşık kavşakta proaktif 0 |
| F9 | Proaktif tavan aşılmıyor · 3-ret suppression çalışıyor |
| F10 | Konu devamlılığı 3 senaryo · correction kalıcı |
| F11 | Sürüşte nav ekranı kapanmıyor · 10 durum doğrulandı |
| F12 | Barge-in p95 ≤ 120 ms · self-trigger ≤ %0.5 |
| F13 | Bayrak ≤ 2 · ikinci kod yolu yok |

### 30.3 **ÜRÜN HAZIR** kapısı (altı koşulun tamamı)

1. F0–F13 tamam · 2. Tüm faz kapıları **gerçek araçta** 🟢 ·
3. `falseConfirmationRate = 0` · 4. Offline degraded senaryosu doğrulandı ·
5. Güvenlik guard testleri (hard-forbidden · workload · onay) yeşil ·
6. Lisans denetimi (`npx license-checker --summary`) temiz.

---

## 31. ADR KARARLARI

| ADR | Karar | Gerekçe | Reddedilen alternatif |
|-----|-------|---------|-----------------------|
| **ADR-M1** | **Tek Mavi; ayrı sohbet/kontrol asistanı yok** | İki asistan = iki context = kullanıcının hangisiyle konuştuğunu bilmemesi | "Chat Mavi + Command Mavi" |
| **ADR-M2** | **`maviCore` rewrite edilmez; shadow'dan çıkarılır** | 6958 satır test edilmiş doğru tasarım; yeniden yazmak saf kayıp | Sıfırdan yeni çekirdek |
| **ADR-M3** | **Yol Arkadaşı = presence policy, capability şalteri değil** | Ürün tanımının anayasası (I2) | Mevcut `companionEnabled` beyin kapısı |
| **ADR-M4** | **`VerificationLevel` medyadan ortak katmana yükseltilir** | Çalışan referans uygulama var; ikinci model kurmak paralel truth olur | Her domain kendi kanıt modeli |
| **ADR-M5** | **LLM asla capability çağırmaz; yalnız öneri üretir** | Prompt injection'a karşı **yapısal** savunma | Doğrudan tool execution |
| **ADR-M6** | **Filler yasak; semantik ack serbest** | Filler gecikmeyi örten yalandır ve cevabı kesmektedir (ölçülü) | "Kısa filler UX'i iyileştirir" |
| **ADR-M7** | **Semantic endpointing kademeli açılır (1100→350)** | Erken kesme en kötü UX hatası; ölçüm olmadan indirilmez | Tek seferde 350 ms |
| **ADR-M8** | **Full-duplex tier kararıdır; AEC yetersizse half-duplex** | Self-hearing riski cihazdan cihaza değişir | Tüm cihazlarda zorunlu full-duplex |
| **ADR-M9** | **Capability Fabric `capabilityRegistry` üstüne kurulur** | Zero-trust status modeli zaten doğru | Yeni registry |
| **ADR-M10** | **Proaktiflik tek merkezi motorda** | Çok motor = spam ve çelişki | Her modül kendi proaktifini konuşur |
| **ADR-M11** | **Inferred preference eylem gerekçesi olamaz** | Yanlış çıkarım eylem yapınca güven biter | Inferred ile otomatik eylem |
| **ADR-M12** | **`roadCompanion/` yeni klasör; `companion/` telefon kalır** | İsim çakışması gerçek bir kod riski | `companion/` yeniden adlandırma |
| **ADR-M13** | **Streaming önce OpenRouter üzerinden** | SSE + `onToken` **zaten uygulanmış**, kullanılmıyor | Gemini streaming'i önce yazmak |
| **ADR-M14** | **Offline klip sözlüğü 200 ifadeye çıkarılır** | Offline'da kişilik tutarlılığı + sıfır sentez gecikmesi | Offline'da eSpeak'e razı olmak |
| **ADR-M15** | **Bayraklar iki sürümde kaldırılır** | Kalıcı bayrak = kalıcı iki kod yolu = kalıcı borç | Süresiz bayrak |

---

## 32. ASLA YAPMA LİSTESİ

| # | ASLA |
|---|------|
| 1 | **Asla** ikinci bir Mavi / ikinci conversation context kurma |
| 2 | **Asla** Yol Arkadaşı'nı capability şalteri yapma |
| 3 | **Asla** UI'ya tıklayarak/synthetic tap ile CarOS'u kullanma |
| 4 | **Asla** LLM'e doğrudan servis/capability çağırtma |
| 5 | **Asla** gözlemlenmemiş sonucu "yaptım" diye söyleme |
| 6 | **Asla** yapay filler ("bakayım/düşünüyorum/bir saniye") üretme |
| 7 | **Asla** internal reasoning / plan / model adı / tool adı kullanıcıya gösterme |
| 8 | **Asla** yeni truth sistemi kurma (nav/media/vehicle/DTC/audio otoriteleri tektir) |
| 9 | **Asla** `HARD_FORBIDDEN_SCOPES`'u config ile açılabilir yapma |
| 10 | **Asla** steering/brake/throttle/ADAS'a Mavi authority verme |
| 11 | **Asla** bilinmeyen değeri 0/bugün/"sağlıklı" ile doldurma |
| 12 | **Asla** `stale` veriyi taze gibi karar kapısına sokma |
| 13 | **Asla** VIN/plaka/konum/telefon/ham OBD verisini buluta gönderme |
| 14 | **Asla** ham transkripti kalıcı hafızaya yazma |
| 15 | **Asla** LAB ekranından komut gönderme (salt-okunur) |
| 16 | **Asla** LAB'a transcript/prompt/PII taşıma |
| 17 | **Asla** `regression.guards` kilidini zayıflatma/silme |
| 18 | **Asla** hot-path'e (3 Hz hız/RPM) ağır analiz sokma |
| 19 | **Asla** normal sohbeti ağır reasoning pipeline'ından geçirme |
| 20 | **Asla** proaktif teklifi kuyruğa alıp bayat halde konuşma |
| 21 | **Asla** kullanıcının sözünü keserek özür dileme (kesilince sadece sus) |
| 22 | **Asla** onay gerektiren eylemi "kullanıcı zaten istemişti" diye atlama |
| 23 | **Asla** inferred preference ile eylem yapma (yalnız öneri) |
| 24 | **Asla** copyleft (GPL/AGPL/LGPL/SSPL) veya NC lisanslı model/ses/veri ekleme |
| 25 | **Asla** merkezi/gömülü API anahtarı koyma (BYOK) |
| 26 | **Asla** cihazda doğrulanmamış özelliği "çalışıyor" diye sunma |
| 27 | **Asla** çok-sistemli tek seferlik refactor yapma (atomik patch) |
| 28 | **Asla** bir bayrağı süresiz açık bırakma |

---

## 33. NİHAİ MİMARİ SKOR

### 33.1 Bugün: **6.1 / 10**

| Eksen | Ağırlık | Puan | Katkı | Gerekçe |
|-------|---------|------|-------|---------|
| Güvenlik / authority disiplini | 15% | **9.0** | 1.35 | Hard-forbidden · PRE/POST gate · 4 kapı sırası |
| Dürüstlük (truth modeli) | 15% | **6.5** | 0.98 | Medyada mükemmel, diğer domainlerde yok |
| Gerçek zamanlılık | 15% | **2.5** | 0.38 | Tamamen seri; filler ile örtülü |
| Genişletilebilirlik | 10% | **4.0** | 0.40 | Registry var ama bağlı değil; intent'ler sabit |
| Bağlam zekâsı | 10% | **6.0** | 0.60 | Zengin kaynak, zarfsız/parçalı |
| Hafıza | 8% | **4.5** | 0.36 | Explicit var; trip ve inferred yok |
| Proaktiflik | 7% | **6.0** | 0.42 | İyi tasarım, tek motor, bağlanamıyor |
| Offline dayanıklılık | 8% | **7.0** | 0.56 | Vosk + offline sohbet güçlü; ses tutarsız |
| Gözlemlenebilirlik | 7% | **7.5** | 0.53 | LAB + STT telemetri güçlü; uçtan uca yok |
| Kod sağlığı (tek yol) | 5% | **3.0** | 0.15 | **Üç paralel hat** |
| **TOPLAM** | | | **6.13** | |

### 33.2 Hedef (F13 sonrası): **9.2 / 10**

| Eksen | Puan | Neyle |
|-------|------|-------|
| Güvenlik / authority | 9.5 | Fabric safetyClass + guard testleri |
| Dürüstlük | 9.5 | `VerificationLevel` her domainde · `falseConfirmationRate = 0` |
| Gerçek zamanlılık | 9.0 | Streaming + semantic endpoint + full-duplex |
| Genişletilebilirlik | 9.5 | Capability Fabric kayıt sözleşmesi |
| Bağlam zekâsı | 9.0 | `ContextDatum` zarfı + tazelik politikası |
| Hafıza | 8.5 | Turn/Trip/LongTerm + inferred (decay/correction) |
| Proaktiflik | 9.0 | Merkezi policy + öğrenen kabul oranı |
| Offline dayanıklılık | 9.0 | Klip sözlüğü + yerel model hazırlığı |
| Gözlemlenebilirlik | 9.5 | 6 yeni LAB ekranı + uçtan uca metrik |
| Kod sağlığı | 9.0 | Tek hat · bayrak ≤ 2 |
| **TOPLAM** | **9.19** | |

### 33.3 Tek paragraflık karar

> CarOS Pro'nun Mavi'si **eksik değil, dağınıktır.** Repoda dünya sınıfı bir
> güvenlik disiplini (hard-forbidden kapsamlar), dünya sınıfı bir dürüstlük modeli
> (`playbackTruth`), dünya sınıfı bir ses hakemliği (nested duck + token) ve
> tamamen yazılmış ama dondurulmuş bir asistan çekirdeği var. Yapılması gereken
> yeni bir Mavi yazmak değil; **var olan üç Mavi'yi tek otorite altında birleştirmek,
> seri boruyu akışa çevirmek ve Yol Arkadaşı'nı bir şalter olmaktan çıkarıp bir
> davranışa indirgemektir.** Bu üç iş yapıldığında Mavi, "gösteren" değil
> "doğrulayan, yorumlayan, öngören ve karar veren" bir Automotive Intelligence
> Platform olur — ve bunu, hiçbir OEM'in ihtiyaç duymadığı bir şeyi yaparak
> başarır: **bilmediği aracı dürüstçe öğrenerek.**

---

## EK-A · PERSONALITY ENGINE (mimari seviyede politika)

### A.1 Kişilik bir prompt değil, bir politikadır

```ts
interface MaviPersona {
  readonly warmth: number;        // 0..1  — sıcaklık
  readonly verbosity: number;     // 0..1  — uzunluk eğilimi (workload EZER)
  readonly formality: number;     // 0..1  — düşük varsayılan (resmi değil)
  readonly humor: number;         // 0..1  — düşük; sürüşte 0
  readonly initiative: number;    // 0..1  — presence'a bağlı
}
```

### A.2 Kişiliğin **ASLA** ezemeyeceği dört şey

| # | Kural |
|---|-------|
| P1 | **Truth** — sıcak olmak için kanıtsız iddia edilmez |
| P2 | **Safety** — samimiyet için güvenlik uyarısı yumuşatılmaz |
| P3 | **Confidence** — "eminim" yalnız kanıt yeterliyse |
| P4 | **Authority** — kişilik onay/kapı atlatamaz |

### A.3 Dil kalibrasyonu (F7 ile birlikte)

Verification düştükçe dil **daha temkinli** ama **daha soğuk değil**:

| Verification | Soğuk (yanlış) | Doğru |
|--------------|----------------|-------|
| `RENDERING_VERIFIED` | "İşlem tamamlandı." | *"Açtım."* |
| `TRANSPORT_ACK` | "Doğrulanamadı." | *"Gönderdim ama başladığını göremiyorum."* |
| `unavailable` | "Desteklenmiyor." | *"Bu araçta yok maalesef."* |
| `unknown` | "Bilinmiyor." | *"Şu an okuyamıyorum."* |

---

## EK-B · YORGUNLUK / UZUN YOL ARKADAŞLIĞI

### B.1 Kesin sınır

> **Mavi yorgunluk TEŞHİSİ koymaz.** Tıbbi iddia yok, "uykulusun" demez,
> güvenlik otoritesi değildir.

### B.2 Kullanılabilir sinyaller (hepsi mevcut veya planlı)

| Sinyal | Kaynak | Durum |
|--------|--------|-------|
| Yolculuk süresi | `tripLogService` | ✅ mevcut |
| Saat (gece bandı) | sistem | ✅ mevcut |
| Etkileşim sessizliği | `companionEngine` sessizlik takibi | ✅ mevcut |
| Mola aralığı ayarı | `breakReminderIntervalMin` | ✅ mevcut |
| Direksiyon/şerit düzensizliği | CAN / GPS heading varyansı | ⚠️ **[BORÇ]** yok |
| Kamera / göz takibi | `vision/` | ❌ gelecek |

### B.3 Davranış (yalnız üç şey)

1. **Sohbet önerir** — açık uçlu soru (mevcut anti-drowsiness tetiği, KEEP).
2. **Mola önerir** — `informational` proaktif, workload ≤ MODERATE.
3. **Etkileşime girer** — kullanıcı isterse sohbeti sürdürür.

**Yapmadıkları:** alarm çalmaz · aracı yavaşlatmaz · "uykulusun" demez ·
teşhis kaydı tutmaz · buluta yorgunluk verisi göndermez.

### B.4 Presence ile ilişki

Yorgunluk sohbeti `social` sınıfındadır → `roadCompanionEnabled` kapalıyken **yoktur**.
Ancak **mola önerisi `operational`dır** → presence kapalıyken de çalışır.

---

## EK-C · BELGE BAKIM SÖZLEŞMESİ

Bu belge her Mavi PR'ında güncellenir:
1. Etkilenen faz durumu (F0…F13).
2. Ölçülen yeni gecikme değerleri (§26.1 tablosu).
3. Kapanan borç maddeleri (§2.19).
4. Yeni ADR varsa §31'e eklenir.

**Çelişki kuralı:** `DEVICE_VALIDATION_LEDGER` bu belgeyle çelişirse **kütük
kazanır**; bu belge düzeltilir, durum **yükseltilmez**.
