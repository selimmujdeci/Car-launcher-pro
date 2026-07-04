# Asistan ↔ Araç Verisi Entegrasyon Planı (V-serisi)

> Tarih: 2026-07-05 · Dal: `feat/obd-core-v2` · Durum: PLAN (kod yok)
> ROADMAP "entegrasyon dalgası" + "asistan alan-modülü ayrıştırma kararı"nın
> (f87a455) somut uygulama planı. Ön koşul: Patch 12D tamamlanmış olmalı
> (SensorPanel marka verileri + profil yükleme — aynı dosyalara dokunuyor).

## Mevcut durum (2026-07-05 itibarıyla doğrulanmış)

- `feat/assistant-open-app` dalının TAMAMI bu dalın atası (merge-base = dal ucu
  ad921bf) → **çapraz dal çakışması diye bir şey artık YOK**, entegrasyon bu
  dalda devam eder.
- `querySensor(soru)` hazır (Patch 9B + 12B DID köprüsü) ama **hiçbir intent
  çağırmıyor** (yalnız servis + testler).
- `voiceContextBuilder.buildEnrichedCtx` DTC + bakım + CORE OBD snapshot'ını
  topluyor (T-12) — ancak companion beyin zincirinin (Gemini→Groq→Haiku)
  prompt'una ne kadarının ulaştığı V0'da doğrulanacak.
- intentEngine'de araç intent'leri VAR: `CHECK_VEHICLE_HEALTH`, `VEHICLE_STATUS`,
  `CLEAR_DTC_CODES`, `CHECK_MAINTENANCE` — ama sensör-değeri sorusu ("yağ
  sıcaklığı kaç") için intent YOK → beyine düşüyor, beyin de değeri BİLMİYOR.

## İlkeler (pazarlıksız)

1. **Beyin sensör değeri UYDURMAZ.** Sensör-değeri sorusunun cevabı HER ZAMAN
   `querySensor`'dan gelir (taze + deterministik). Beyin yalnız `QUERY_SENSOR`
   komutu döndürür — şemada değer alanı YOKTUR (yapısal garanti, "sahte onay
   yasak" ilkesinin devamı).
2. **Yerel hızlı yol önce.** Sensör soruları offline/deterministik parser'da
   yakalanır; beyin yalnız yerel parser eşleşmezse devreye girer (offline
   hassasiyet dersi + K24 internetsiz gerçeği).
3. **Bağlam = yorum, ham veri değil** (COMPANION_AI_ARCHITECTURE §4). Beyne
   giden araç bağlamı companionContext tarzı Türkçe özet satırlarıdır, ham
   sayı tablosu değil; ≤2 satır token bütçesi.
4. **Boşta sıfır maliyet.** OBD bağlı değilken/asistan kullanılmıyorken hiçbir
   yeni abonelik/zamanlayıcı çalışmaz (Mali-400 sözleşmesi).

## Fazlar (her biri atomik patch + kendi testleri; sıra bağlayıcı)

### V0 — Keşif/doğrulama (kod yok, yarım oturum)
- `buildEnrichedCtx` çıktısının akışını haritala: `voiceService.processTextCommand`
  → hangi sağlayıcıya, hangi alanlar prompt'a giriyor? (companionChatProvider'da
  weather regex var; araç alanlarının kullanımı belirsiz.)
- `_bestLocalParse` / n-best akışında yeni intent'in denenme noktasını sabitle.
- AIVoiceResult komut şemasının (OPEN_APP/OPEN_SCREEN/SET_SETTING) JSON yapısını
  çıkar — QUERY_SENSOR aynı kalıba eklenecek.
- Çıktı: bu dosyanın "V0 bulguları" bölümüne ek (commit).

### V1 — QUERY_SENSOR uçtan uca (asıl bağlama)
- `intentEngine`: yeni `QUERY_SENSOR` IntentType + payload `{ sensorQuery }`.
- Yeni `vehicleIntents.ts` (alan-modülü ayrıştırmasının TOHUMU — ROADMAP kararı):
  "X kaç / ne kadar / nedir / söyle / göster" kalıpları; adayı
  `sensorQueryService.resolveSensor` ile doğrular — çözülemiyorsa intent üretmez
  (UNKNOWN → beyin). n-best alternatifleri de denenir.
- `commandExecutor`: `QUERY_SENSOR` → önce kısa onay ("bakıyorum" — EXTENDED
  taze değer 12s sürebilir, sessizlik ölü sanılır), sonra `await querySensor` →
  `speakFeedback(answer.text)`; `null` → dürüst "şu an okunamıyor" (bağlantı
  yok / desteklenmiyor ayrımı sensorQueryService'ten gelir). VIN gibi uzun metin
  cevaplar TTS'te OKUNMAZ ("ekranda gösteriyorum" + SensorPanel'e yönlendirme —
  ISO 15008).
- Beyin şeması: companionChatProvider komut listesine `QUERY_SENSOR` ekle
  (payload yalnız sensorQuery; değer alanı YOK).
- voiceDiag: mevcut `voice_intent`/`voice_command_execute` aşamaları
  `command='QUERY_SENSOR'` ile düşer (yeni aşama gerekmez).
- Testler/kilitler: parser kalıpları (pozitif + "aç/kapat" fiilleriyle YANLIŞ
  tetiklenmeme negatifleri), executor değer/null/uzun-metin dalları, "beyin
  şemasında QUERY_SENSOR var + değer alanı yok" kilidi, "sensör sorusunda
  overlay follow-up kapanmaz" etkileşim kilidi (voiceOverlayShouldAutoClose
  mevcut kilidiyle çelişmemeli).

### V2 — Araç bağlamı beyne (companion zinciri)
- `buildEnrichedCtx` → companion beyin prompt'una YORUM satırları olarak bağla
  (V0 bulgusuna göre eksik neyse): hız bandı, yakıt %, motor sıcaklık durumu,
  aktif DTC sayısı, bakım uyarısı, aktif rota özeti. companionContext saf
  yorumlayıcı deseni (deterministik, servis import'suz, unit-testli).
- Kural prompt'a yazılır + testle kilitlenir: "sensör değeri sorulursa bağlamdan
  cevap verme, QUERY_SENSOR komutu döndür" (bağlam sohbet farkındalığı içindir:
  "yakıt azalmış, benzinlik arayayım mı" proaktifliği).
- Fail-soft: her kaynak bağımsız try-catch (mevcut desen); OBD yokken bağlam
  satırı üretilmez, prompt kısalır (token tasarrufu).

### V3 — VehicleIntents ayrıştırması (davranış DEĞİŞMEZ)
- Mevcut CHECK_VEHICLE_HEALTH / VEHICLE_STATUS / CLEAR_DTC_CODES /
  CHECK_MAINTENANCE yerel parser kuralları `vehicleIntents.ts`'e taşınır
  (V1 tohumunun üstüne). intentEngine dispatch + tüm mevcut kilitler AYNEN
  geçmeli — bu patch'in tek kanıtı "suite yeşil + davranış birebir".
- Nav/Media/AppControl ayrıştırmaları AYRI patch'ler (bu planın kapsamı dışı;
  ROADMAP'te duruyor).

### V4 — Teşhis derinliği sesli (Patch 11 API'lerinin tüketimi)
- `CHECK_VEHICLE_HEALTH` cevabını zenginleştir: `readDiagnosticStatus`
  (MIL/readiness "muayeneye hazır mı"), Mode 07 bekleyen kodlar; istenirse
  freeze frame "arıza anı" tek cümlelik özeti.
- Bakım beyni kartları + BYOK AI teşhis sentezi (offline'da statik tabloya
  zarif düşüş) — ROADMAP entegrasyon dalgasının kalanı; ayrı planlanabilir.

## Riskler / bilinçli kabuller

- **K24 hibrit TTS**: dinamik sensör cevapları Piper klip bankasında YOK →
  eSpeak yedeğine düşer (kalite düşük ama çalışır). Kabul; sık sorulan
  kalıplar için ileride klip şablonu ("motor sıcaklığı ... derece") düşünülür.
- **12s EXTENDED beklemesi**: "bakıyorum" onayı + overlay açık tutma bunun
  UX çözümü; cihazda sesle doğrulanmadan "bitti" DENMEZ.
- **Beyin kaçağı**: prompt kuralına rağmen beyin değer uydurmayı deneyebilir —
  yapısal önlem şemada değer alanı olmaması; ek kilit V1 testlerinde.
- **Sıralama**: V1 başlamadan 12D ajanının commit'leri beklenir (aynı dosyalar:
  sensorQueryService/manufacturerPidService/SensorPanel).

## Kapsam dışı (bilinçli)

- Wake word / STT değişikliği yok (tek asistan kararı — f87a455).
- intentEngine'in Nav/Media/AppControl bölünmesi (ayrı patch'ler).
- Filo telemetrisi, USB seri, BLE UUID boşlukları (ROADMAP'te ayrı).
