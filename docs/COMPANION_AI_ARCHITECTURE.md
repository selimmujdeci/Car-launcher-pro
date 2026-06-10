# CarOS Pro — "Yol Arkadaşım" (Companion AI) Mimari Tasarımı

> Durum: TASARIM — kod yok. Tüm tespitler mevcut kod tabanından doğrulandı
> (dosya/satır referanslı). Tarih: 2026-06-11.
> Felsefe: sesli komut sistemi DEĞİL, gömülü ChatGPT DEĞİL — yanda oturan,
> konuşmak için konuşmayan akıllı yol arkadaşı.

---

## 1. Mevcut Mimari Analizi

### 1.1 Ses giriş hattı (STT)

| Katman | Dosya | Durum |
|---|---|---|
| Native STT | `android/.../CarLauncherPlugin.java` (`startSpeechRecognition`, `runVoskListening`) | Vosk offline TR, özel AudioRecord döngüsü: AGC+NS+AEC donanım efektleri, yazılım kazancı (clamp 1-4x), acceptWaveForm endpoint, müzik ducking (%12) |
| Model | `assets/vosk-model-tr` (~57MB small TR) | Standart yapı; **boot+8sn preload + istek kuyruğu var** (`e191bb1`, cihazda doğrulandı) |
| JS orkestrasyon | `src/platform/voiceService.ts` (38KB) | `startListening` → warmup → failsafe 14sn → `processTextCommand` |
| Ayar tek kaynağı | `src/platform/voiceTuning.ts` | maxListenMs 12sn, gain, failsafe hiyerarşisi |

### 1.2 Komut işleme zinciri (`voiceService.processTextCommand:376`)

Sıra (mevcut, değiştirilmeyecek):
1. **Bilişsel pause** — `_voiceCogPaused` (PROTECTION/CRITICAL'da işleme+TTS atlanır, kullanıcıya görünür terminal durum)
2. Bekleyen onay ("evet/hayır") → throttle (1.5sn) → komut zincirleme
3. **Yerel parser** (`commandParser.parseCommandFull`) — ≥1.0 anında, ≥0.7 otomatik, 0.5-0.7 park halinde onaylı
4. **Offline sohbet** (`offlineConversationEngine.tryOfflineConversation:487`) — skorlu anahtar kelime + `CarSnapshot` (OBD hız/yakıt/menzil/TPMS/kapı), `drive(full, short)` ISO 15008 kısaltması
5. **Semantik NLP** (`classifySemantic`) → **genel AI** (`aiVoiceService.askAI:533`)

**Önemli tespit:** Sohbet katmanı zaten var ama *reaktif* (yalnız kullanıcı konuşunca) ve *durumsuz* (tur hafızası yok). Companion'ın getireceği yenilik: **proaktiflik + oturum hafızası + kişilik** — STT/TTS/intent altyapısının tamamı yeniden kullanılır.

### 1.3 AI katmanı (`src/platform/aiVoiceService.ts`)

- Gemini 2.5 Flash (`generativelanguage.googleapis.com`, `responseMimeType: json`, temp 0.1, 3sn timeout) + Claude Haiku alternatifi.
- **BYOK mevcut ve çalışıyor:** anahtar `sensitiveKeyStore.get('geminiApiKey')` (voiceService:440-445), provider `settings.aiVoiceProvider` ('gemini' varsayılan). Merkezi anahtar yok — lisans kuralına uygun.
- `VehicleContext` enjeksiyonu: `buildEnrichedCtx` (voiceContextBuilder.ts) DTC + bakım + OBD anlık verisi; `isDriving` → "≤8 kelime, yalnız TTS" kuralı prompt'a gömülü (NHTSA/ISO 15008).
- Mevcut prompt **intent ayrıştırıcı** (JSON şema, 25 intent) — sohbet prompt'u DEĞİL. Companion için ayrı prompt ailesi gerekir.

### 1.4 TTS (`src/platform/ttsService.ts`)

Native Android TextToSpeech (tr-TR) + web SpeechSynthesis fallback. `speakFeedback`/`speakAlert` üzerinden SystemOrchestrator da kullanıyor. Companion'ın "konuşan" tarafı hazır; ses kalitesi cihazın TTS motoruna bağlı (risk §2.7).

### 1.5 Wake word (`src/platform/wakeWordService.ts`) — EN ZAYIF HALKA

Mevcut implementasyon **companion için kullanılamaz**:
- `nativeLoop()` her 500ms'de **tam STT oturumu** açıyor (`startSpeechRecognition`, 12sn pencere) → sürekli tam Vosk decode = zayıf CPU'da kalıcı %15-30 yük + ısı.
- **Ducking hatası:** `runVoskListening` her oturumda `duckMusicForListening()` çağırır (CarLauncherPlugin.java) → wake word döngüsü açıkken **müzik kalıcı olarak %12'ye kısılır**. Bu tek başına mevcut wake word'ü sahada kullanılmaz yapar.
- Pencereler arası 500ms sağırlık boşluğu; eşleşme `transcript.includes(word)` — güven skoru yok.
- Varsayılan kapalı (`wakeWordEnabled: false`, useStore:305) — doğru karar.

### 1.6 Güvenlik/bilişsel altyapı (`src/store/useCognitiveStore.ts`)

6 mod: IMMERSIVE→AWARE→FOCUSED→PROTECTION→CRITICAL→LIMP_HOME (MODE_RANK sıralı). PROTECTION zaten `'VoiceExtras'` suppress ediyor (satır 28) — companion'ın eğlence katmanı için **hazır kanca**. `CognitivePriorityEngine` modu yönetiyor; voiceService `_voiceCogPaused` ile entegre.

### 1.7 Yolculuk farkındalığı veri kaynakları (hepsi mevcut)

| Veri | Kaynak |
|---|---|
| Gece/gündüz | `settings.dayNightMode` (useDayNightManager saatle senkron) |
| Yolculuk süresi / son mola | `tripLogService` (`TripState`, `onTripState`) — SystemOrchestrator zaten dinliyor |
| Mola hatırlatma | `settings.breakReminderEnabled` + `breakReminderIntervalMin` (alan var) |
| Navigasyon aktif / ETA | `routingService.getRouteState()` |
| Yakıt/menzil/sıcaklık | `obdService.onOBDData` (fuelLevel, estimatedRangeKm) |
| OBD bağlı mı | `getOBDStatusSnapshot().connectionState` |
| Hareket hâlinde mi | `smartEngine.detectDrivingMode` ('idle'/'normal'/'driving') |
| Hava | `weatherService.ts` |
| Sürüş alışkanlığı | `smartEngine` Markov + usage map (uygulama açma kalıpları) |

### 1.8 Remote log deseni (`src/platform/voiceDiagService.ts`)

Kopyalanacak şablon hazır: sabit şema (serbest metin alanı YOK), transcript yerine `transcriptLength`, 64 char alan kırpma, fırtına koruması 60sn/5, `pushVehicleEvent` → at-least-once kuyruk. Companion telemetrisi bu desenin birebir kardeşi olur.

### 1.9 Eksik olanlar (companion'ın gerçek işi)

1. Proaktif konuşma kararı veren motor (ne zaman konuşulur / susulur)
2. Oturum içi konuşma hafızası (çok turlu sohbet)
3. Kişilik/isim/hitap modeli
4. Kullanılabilir wake word (grammar tabanlı yeniden yazım)
5. Ham veri → yorum çeviren katman ("yakıt %23" → "~140 km gidersin")
6. Tekrar önleme (aynı cümleyi söylememe)

---

## 2. Güvenlik Riskleri

| # | Risk | Karşılık |
|---|---|---|
| 2.1 | **Dikkat dağıtma** (ISO 15008/NHTSA) | Mevcut `isDriving → ≤8 kelime` kuralı companion prompt'una da girer; sürüşte yanıt YALNIZ TTS, ekranda uzun metin yok; proaktif konuşma hareket hâlinde ≤2 kısa cümle |
| 2.2 | **Bilişsel aşırı yük** | State machine SAFETY_RESTRICTED durumu MODE_RANK ≥ PROTECTION'a bağlanır (mevcut `VoiceExtras` suppress kancası); bilmece/fıkra/uzun sohbet kapanır, yalnız güvenlik+mola+kritik bilgi |
| 2.3 | **Wake word yanlış tetikleme** (yol gürültüsü, radyo, yolcu) | Grammar-kısıtlı tanıma (§3) + tetikleme sonrası onay sesi + 5sn içinde konuşma gelmezse sessiz iptal; "Mavi" gibi 2 heceli kısa adlar riskli → UI'da 3+ heceli/iki kelimeli öneri ("Hey Mavi") |
| 2.4 | **Sürekli mikrofon = gizlilik** | İşleme %100 cihaz içi (Vosk offline, ağ yok); UI'da kalıcı küçük mikrofon göstergesi; tek dokunuş/`"sustur"` ile MUTED; varsayılan KAPALI |
| 2.5 | **Buluta veri sızması** (Gemini BYOK) | Konum/VIN/plaka ASLA prompt'a girmez (remoteLogService gizlilik kuralıyla aynı disiplin); yalnız yorumlanmış sayısal özet ("yakıt ~%23, ~2 saattir yolda"); konuşma geçmişi yalnız RAM, persist edilmez |
| 2.6 | **TTS-mikrofon geri besleme** (asistan kendi sesini duyar) | Half-duplex kuralı: TTS konuşurken wake word + STT duraklatılır (AEC var ama tek başına yetmez); mevcut ducking altyapısı ters yönde kullanılır |
| 2.7 | **Rahatsızlık/tekrar** | Frequency budget (§5) + son N yanıt parmak izi (tekrar yasak) + `companion_no_response` sonrası üstel backoff; "konuşmak için konuşma" ilkesi scheduler'da yapısal |
| 2.8 | **Kullanıcı API maliyeti** | Proaktif promptlar Gemini'ye GİTMEZ (şablon+yorumlayıcı, §6); Gemini yalnız kullanıcı-başlatan sohbette; maxOutputTokens sınırı; günlük çağrı tavanı |
| 2.9 | **Head unit internetsiz gerçeği** (memory: K24) | V1 çekirdeği %100 offline çalışmak ZORUNDA; Gemini "varsa zenginleştirir" katmanı (§4) |

---

## 3. Wake Word Uygulanabilirliği (gerçekçi değerlendirme)

**Mevcut yol kullanılamaz** (§1.5: tam decode CPU yükü + kalıcı müzik kısma + sağırlık boşlukları).

**Önerilen: Vosk grammar-kısıtlı sürekli tanıyıcı (native, yeni)**
- Vosk `Recognizer(model, rate, grammarJson)` API'si tanımayı verilen kelime listesine kısıtlar: `["mavi", "[unk]"]`. Model zaten RAM'de (preload, `e191bb1`) — **ek RAM maliyeti yok**, decode yükü tam aramaya göre kat kat düşük.
- Ayrı düşük öncelikli native thread; **ducking YOK** (yalnız dinler, müziğe dokunmaz); endpoint'te `[unk]` dışında wake kelimesi görülürse JS'e event (`notifyListeners('wakeWord')`).
- Yarı çift yönlü (half-duplex): TTS konuşurken ve aktif STT oturumunda thread duraklar — mikrofon sahipliği state machine'de tek sahipli (§5).
- Asistan adı değişince grammar yeniden kurulur (ayar → native restart).
- CRITICAL/LIMP_HOME modda thread durur; ekran kapalı/theater modda durur.

**Riskler ve ölçüm şartı:** küçük TR modelinin tek kelimelik grammar isabeti ve K24 Mali-400/zayıf CPU üzerindeki sürekli yükü **cihazda ölçülmeden** ürünleşmez (test planı §10'da CPU/ısı/yanlış-tetikleme metrikleri). Kabul eşiği: <%10 tek çekirdek ortalama, saatte <2 yanlış tetikleme. Geçemezse fallback: wake word yalnız park hâlinde/rölantide aktif, sürüşte buton.

---

## 4. Gemini Entegrasyon Modeli

İki ayrı istek ailesi (mevcut intent hattı DEĞİŞMEZ):

```
Kullanıcı konuşması
  ├── Komut mu? → mevcut zincir (parser → semantic → askAI intent JSON)   [değişmez]
  └── Sohbet mi? → companionChat (YENİ)
        ├── İnternet + Gemini key var → gemini-2.5-flash, sohbet prompt'u
        │     system: kişilik + hitap + yorumlanmış araç özeti + kurallar
        │     history: son 6-8 tur (yalnız RAM)
        │     config: temp ~0.7, maxOutputTokens 120 (sürüşte 60), timeout 6sn
        └── Yok → offline şablon motoru (offlineConversationEngine genişletilir)
```

- **Model seçimi:** Flash yeterli ve doğru (gecikme + kullanıcı maliyeti); Pro gereksiz — sohbet derinliği değil, doğallık + hız kritik. Endpoint/parse deseni `aiVoiceService.askGemini`'den kopyalanır ama JSON şema zorlanmaz (serbest kısa metin + ayrı `mood/intent` alanı).
- **Bağlam enjeksiyonu ham veri DEĞİL yorum:** `companionContext` yorumlayıcıları (örn. `interpretFuel(fuelLevel, rangeKm) → "mevcut sürüşüne göre ~140 km"`) prompt'a İŞLENMİŞ özet verir → "ham veri okumama" ilkesi yapısal olarak garanti (LLM'in eline ham sayı az geçer).
- **Proaktif promptlar Gemini'ye gitmez:** karşılama/mola/yakıt yorumu offline şablon+yorumlayıcıdan üretilir (maliyet + internetsiz head unit + tutarlılık). Gemini yalnız kullanıcı sohbeti sürdürürse devreye girer.
- **Fallback zinciri:** Gemini timeout/hata → aynı turda offline şablona düş (sessiz), `companion_response{provider:'offline'}` loglanır.

---

## 5. State Machine

```
                    ┌──────────────────────────────────────────────┐
                    ▼                                              │
DISABLED ──ayar──▶ DORMANT ──boot/kontak (1 kez)──▶ GREETING ──TTS bitti──▶ IDLE
   ▲                 │  (wake word thread aktif,                      │
   └──ayar kapat─────┘   companion sessiz)                            │
                                                                      ▼
              ┌────────────────────────── IDLE_COMPANION ◀────────────┘
              │   PromptScheduler tick'leri (proaktif karar)          │
              │                                                       │
   wake word /│ mic buton / proaktif tetik                            │ "sustur" /
              ▼                                                       │ gece hassasiyeti
          ENGAGED ◀─────────────┐                                     ▼
   LISTENING → THINKING →       │                                  MUTED
   SPEAKING → FOLLOWUP(8sn) ────┘ (kullanıcı devam ederse)        (oturum boyu /
              │ sessizlik → IDLE                                   süreli)
              ▼
   her durumdan: CognitiveMode ≥ PROTECTION ──▶ SAFETY_RESTRICTED
   (yalnız güvenlik/mola/kritik; mod düşünce önceki duruma döner)
```

**PromptScheduler (proaktif konuşma kararı) — "asla konuşmak için konuşma":**
1. **Koşul motoru** (tetikler): kontak/boot karşılaması (oturumda 1) · trip süresi > X saat ve son moladan > Y dk (`tripLogService` + `breakReminderIntervalMin`) · yakıt menzili < eşik (yorumlu) · varışa < 10 dk · uzun sessizlik + gece (yorgunluk kontrolü, gece hassasiyeti ayarına bağlı)
2. **Frequency budget:** `companionChattiness` → minimum aralık (az=45dk · normal=20dk · sık=10dk); bütçe dolmadan koşul gelirse sessiz drop
3. **Gate zinciri (hepsi geçmeli):** cognitive < PROTECTION · MUTED değil · TTS/STT meşgul değil · medya "prominent" değilse (müzik/video kesilmez, sadece duraklarda) · gece hassasiyeti
4. **Backoff:** `companion_no_response` → sonraki pencere 2x; iki kez üst üste yanıtsız → oturum boyu yalnız güvenlik tetikleri
5. **Tekrar önleme:** üretilen cümlenin normalize parmak izi son 20 yanıtla karşılaştırılır; şablonlar varyantlı

---

## 6. Companion AI Mimarisi (modüller)

```
src/platform/companion/
├── companionEngine.ts     State machine + PromptScheduler. SystemBoot Wave 4'e
│                          named cleanup ile kayıt (VoiceService deseni,
│                          SystemBoot.ts:540; LIMP_HOME'da otomatik durur).
├── companionContext.ts    Yolculuk farkındalığı: tripLog + route + OBD + hava +
│                          dayNight + smartEngine'den SAF YORUMLAYICI fonksiyonlar
│                          (ham→insan dili). buildEnrichedCtx'i sarmalar, bozmaz.
├── companionPersona.ts    Kişilik (4 profil) + assistantName + userCallsign →
│                          şablon seçimi & Gemini system prompt; tekrar-önleme
│                          parmak izi deposu (RAM + safeStorage'da son 20 hash).
├── companionChatProvider.ts  Gemini sohbet çağrısı (aiVoiceService deseni,
│                          sensitiveKeyStore'dan aynı geminiApiKey) + RAM geçmişi.
└── companionDiag.ts       voiceDiagService'in birebir kardeşi (§8).
android: CarLauncherPlugin'e grammar-kısıtlı wake word thread (§3) +
         'wakeWord' event. Mevcut runVoskListening'e DOKUNULMAZ.
```

**Yeniden kullanım haritası:** STT=`voiceService.startListening` (dokunma) · TTS=`ttsService` · komut/sohbet ayrımı=`processTextCommand` zincirinin 4. basamağına companion engaged-hook (sohbet turlarını companionChat'e yönlendirir) · güvenlik=`useCognitiveStore` subscribe · ayar=`useStore.settings`. **Tek yeni native parça wake word thread'i** — gerisi mevcut altyapı üstüne JS katmanı.

---

## 7. Ayarlar Modeli (`useStore.settings`, migration v13→v14)

| Alan | Tip / Varsayılan | Not |
|---|---|---|
| `companionEnabled` | boolean / **false** | Ana anahtar (opt-in) |
| `companionName` | string / 'Mavi' | = wake word (tek kaynak; mevcut `wakeWord` alanıyla birleştirilir) |
| `userCallsign` | string / '' | Boş = hitapsız ("Hoş geldin.") |
| `companionPersonality` | 'sessiz'\|'samimi'\|'neşeli'\|'profesyonel' / 'samimi' | 'sessiz' = yalnız sorulara cevap, proaktif 0 |
| `companionChattiness` | 'az'\|'normal'\|'sik' / 'az' | Frequency budget (§5) |
| `companionWakeWordEnabled` | boolean / false | Mevcut `wakeWordEnabled`'dan migrate |
| `companionNightSensitivity` | boolean / true | Gece proaktif konuşma kısılır (yalnız mola/güvenlik) |

UI: SettingsPage'e "Yol Arkadaşım" paneli (mevcut panel deseni); Gemini anahtarı mevcut AI ayarından gelir, kopyalanmaz.

---

## 8. Remote Log Modeli

`companionDiag.ts` — `voiceDiagService` şablonu, event tipi `companion_diag`:

```
stage: companion_start | companion_prompt | companion_response |
       companion_no_response | companion_mute | companion_safety_mode
```

Sabit şema (serbest metin alanı YOK, 64 char kırpma, fırtına 60sn/5):
`stage · durationMs · trigger('wake_word'|'button'|'proactive') ·
intentClass('greeting'|'smalltalk'|'vehicle_insight'|'break'|'safety') ·
responseType('template'|'gemini') · transcriptLength · personality · bootId · appVersion`

**Transcript ASLA gönderilmez** (voiceDiag ile aynı yapısal garanti: şemada metin alanı yok). Not: Admin Incident Center'ın `INCIDENT_TYPES` filtresine `companion_diag` eklenmeli, yoksa görünmez (IncidentCenter.tsx).

---

## 9. Commit Planı (atomik, AI.md uyumlu)

| # | Commit | İçerik |
|---|---|---|
| 1 | `feat(companion): settings + migration` | 7 alan, v14 migration, Ayarlar paneli (UI iskeleti) |
| 2 | `feat(companion): context interpreters` | companionContext saf yorumlayıcılar + unit testler |
| 3 | `feat(companion): persona + offline templates` | 4 kişilik, hitap, karşılama/hal-hatır/mola/yakıt şablonları, tekrar-önleme |
| 4 | `feat(companion): engine state machine` | PromptScheduler + gate zinciri + SystemBoot Wave 4 kaydı + cognitive subscribe |
| 5 | `feat(companion): wake word v2 (native)` | Grammar-kısıtlı thread, ducking'siz, half-duplex, 'wakeWord' event |
| 6 | `feat(companion): telemetry` | companionDiag + IncidentCenter görünürlüğü + gizlilik testleri |
| 7 | `feat(companion): gemini chat provider` | Sohbet prompt'u, RAM geçmişi, offline fallback (V1'in son halkası / V2 başı) |

Her commit bağımsız çalışır durumda bırakır; 1-4 cihazsız test edilebilir, 5 K24/Duster ölçümü ister.

## 10. Test Planı

- **Unit:** yorumlayıcılar (yakıt→menzil cümlesi sınır değerleri) · scheduler frequency budget + backoff (sanal saat) · tekrar-önleme parmak izi · state machine geçiş tablosu · persona şablon seçimi
- **Integration (mevcut `src/__tests__` desenleri):** "2 saat sürüş + mola yok → tek mola önerisi" (soakHarness sanal saat) · PROTECTION'a geçiş anında ENGAGED→SAFETY_RESTRICTED ve eğlence şablonlarının seçilemezliği · TTS sırasında wake word event'inin yok sayılması (half-duplex)
- **Gizlilik (yapısal):** companion_diag payload'unda serbest metin alanı olmadığının şema testi (voiceDiag testleri örnek)
- **Cihaz (K24 + Duster, manuel checklist):** wake word CPU/ısı (8 saat soak, kabul: <%10 çekirdek) · saatte yanlış tetikleme (<2) · müzik çalarken ducking OLMADIĞI · TTS gecikmesi · `device.webViewVersion` snapshot ile saha teyidi
- **Soak:** 8h sanal-saat companion oturumu — konuşma bütçesi ihlali 0, bellek sızıntısı 0 (leakHarness)

## 11. Minimum V1 (öncelik: bağ kuran üç özellik)

1. **Karşılama + hal-hatır** — kontak/boot'ta kişilik+hitapla tek selamlama; cevap gelirse 1-2 tur offline şablon sohbeti, gelmezse sessizlik. (Commit 1-4)
2. **Araç verisi yorumlama** — "yakıt ne durumda / ne kadar giderim / yorgunum" sorularına yorumlu cevap + tek proaktif tetik: mola önerisi. (Commit 2-4)
3. **"Mavi" wake word** — grammar tabanlı, ducking'siz, half-duplex. (Commit 5)

V1 **%100 offline çalışır** (head unit gerçeği) — Gemini (Commit 7) interneti olan kullanıcıda sohbeti derinleştirir, olmayanda hiçbir şey bozulmaz. Bilmece/fıkra V1'de YOK.

## 12. V2-V3 Yol Haritası

- **V2:** Gemini gerçek sohbet (çok turlu, kişilikli) · bilmece/kısa fıkra (yalnız park/rölanti + IMMERSIVE/AWARE) · kalıcı tercih hafızası (safeStorage: "kahve molası sever", müzik türü) · sürüş alışkanlığı yorumu (smartEngine Markov: "bu saatte genelde X'e gidersin, oraya mı?")
- **V3:** duygusal ton (TTS pitch/rate kişiliğe göre) · görev diyalogları ("yarın sabah yola çıkacağız, yakıt almayı hatırlat") · proaktif rota/hava içgörüleri · alternatif ses karakterleri · wake word için özel küçük model (porcupine benzeri, lisans uygunsa)
