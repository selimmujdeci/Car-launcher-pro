# CAROS PRO MUSIC — NIGHT SHIFT CHECKPOINT

> Gece çalışmasının **devam kaydı**. Yeni oturum bu dosyadan devam eder;
> tamamlanmış turu BAŞTAN çalıştırmaz. Uzun rapor buraya YAZILMAZ — yalnız
> devam etmek için gereken bilgi.

---

## CP-01 · MUSIC F6.1 — DEAD AUDIO PATH CLEANUP

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-02

### Ne yapıldı
- Yeni: `src/platform/media/authority/duckRequest.ts` — kanonik duck **adaptörü**
  (token güvenli, fail-soft, durum tutmaz).
- Migrasyon: `ttsService` · `voiceService` · `voiceClips` · `edgeTtsService` ·
  `onlineTtsService` → `duckMedia/unduckMedia` yerine `requestDuck/release`.
- **Silindi:** `src/platform/audioService.ts` (ölü Web Audio DSP · SVC · AGC ·
  driver-focus · `STREAM_MUSIC` yazıcısı) ve `src/__tests__/cleanup.audio.test.ts`.
- `theaterModeService` — karşılıksız ses profili sorumluluğu kaldırıldı.
- **GERÇEK BUG:** `mediaCommandGateway.applyVolume()` native'e duck DAHİL değer
  yazıyordu → çift duck (%30 yerine %9). `nativeUserVolume()` ile düzeltildi.
- LAB: `media-authority` → `4 · Ses / Ducking` kartına `duck-req` ve
  `duck-req-failed` alanları eklendi (yeni ekran AÇILMADI).

### Test sonucu
- `musicF61DuckAuthority` 8 PASS · `mediaAuthority` 67 PASS ·
  `mediaAuthorityLab` 29 PASS · `regression.guards` **831 PASS** ·
  ses/asistan paketi (10 dosya) 104 PASS.
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Full suite / production build / native build: **KOŞULMADI** (tüm Music kodu
  final olduğunda bir kez koşulacak).

### Açık blocker
- Yok (kod tarafı). Saha gate'leri: kütük **#1100–#1104**.

### Bilinçli kapsam dışı (canlı yollar — ölü DEĞİL)
1. `CarLauncherPlugin.duckMusicForListening()` → `STREAM_MUSIC` doğrudan yazıyor.
2. `radarEngine._fireVoiceAlert` → sistem sesiyle duck ediyor.
3. Native duck reddi JS kaydına geri beslenmiyor (LAB'da ayrışma görünür).

### Sıradaki adım
→ **CP-02 · MUSIC F7 — YOUTUBE EXPERIENCE** (repo gerçeğini ölç → authority map).

---

## CP-02 · MUSIC F7.1 — YOUTUBE KANONİK OYNATMA / TRANSPORT

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)

### Ölçülen kusur
- `carosMediaLayer._playTrack` YouTube'u DOĞRUDAN `playYouTube()` ile başlatıyordu
  (kaynak devri doğrulanmıyor, `CommandTruth` yok).
- `playYouTube` diğer backend'leri "ateşle-unut" durduruyordu (ikinci devir yürütücüsü).
- `mediaCommandGateway.play/pause/seek` KOŞULSUZ native köprüye gidiyordu → backend'i
  native OLMAYAN kaynaklar kapının DIŞINDA sürülüyordu.

### Yapılan
- `sourceCoordinator`: `BackendTransport` + `BackendPlaybackState` + `observe()` +
  `getAdapter()` sözleşmeye eklendi.
- `backendAdapters`: YouTube adaptörüne `observe()` ve `transport` eklendi.
- `youtubeService`: `youtubeResume/youtubePause/getYouTubePlaybackState`; `youtubeSeek`
  artık kabul döner; ad-hoc kaynak durdurma KALDIRILDI.
- `mediaCommandGateway`: play/pause/seek yürütmeyi backend SAHİBİNE dağıtır;
  `observedStateFor` adaptörden okur; transport yoksa `unsupported_capability`.
- `carosMediaLayer`: YouTube `playSource({source:'YOUTUBE'})` ile başlar; seek kapıdan.
- `mediaService.togglePlayPause` YouTube → kapı.

### Test
`musicF71YouTubeAuthority` 7 PASS · `regression.guards` 834 PASS · tsc + lint PASS.

---

## CP-03 · MUSIC F7.2 — SÜRÜŞTE VİDEO GÜVENLİK KAPISI

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED`

### Ölçülen kusur
`videoModeStore` koşulsuzdu; `MediaScreen` video host'unu tüm viewport'a
(`z-index: 2147483000`) yayıyordu — **hiçbir hız/duruş kontrolü YOKTU**.

### Yapılan
- Yeni SAF politika: `src/platform/media/videoSafetyPolicy.ts`
  (`ALLOWED` · `BLOCKED_MOVING` · `BLOCKED_SPEED_UNKNOWN`, histerezis 1/3 km/h).
- `src/hooks/useVideoSafety.ts` — kanonik araç hızını okur, kararı projekte eder.
- `MediaScreen`: video host GÖRÜNÜRLÜĞÜ kapıya bağlandı; gerekçe banner'ı; düğme
  devre dışı + erişilebilir etiket. **SES ETKİLENMEZ.**
- Sesli komut ("video moduna al") engellendiğinde gerekçe toast'ı — sahte onay yok.
- LAB `media-authority`: `Araç hızı (km/h)` + `Video görüntüsü (F7.2)` alanları.

### Test
`musicF72VideoSafety` 8 PASS · `regression.guards` 835 PASS · tsc + lint PASS.

---

## CP-04 · MUSIC F7.3 — KUYRUK-FARKINDA ATLAMA (tek giriş)

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED`

### Ölçülen kusur
`transportControlsFor` atlama düğmelerini YALNIZ `capabilities.supportsQueue` ile
açıyordu. YouTube'da bu (doğru biçimde) `false` → arama sonucu listesinden çalarken
gerçek bir sıra olmasına rağmen **sonraki/önceki düğmeleri çizilmiyordu**; donanım/
bildirim tuşları da kapının `next()`ine gidip `unsupported_capability` ile düşüyordu.

### Yapılan
- `transportControlsFor(..., upperQueueAvailable)` — sıra backend'in VEYA üst
  katmanın olabilir; ikisi de yoksa düğme ÇİZİLMEZ.
- `carosMediaLayer.next/previous(requester?)` tek kuyruk-farkında giriş.
- `MediaScreen` · `SplitScreen` · `TheaterOverlay` · MediaSession donanım tuşları
  hepsi AYNI girişten geçer; her parça yine kanonik kapıdan başlar.
- `mediaService.next/previous(requester?)` provenance geçişi.

### Test
`musicF73QueueAwareTransport` 9 PASS · `mediaSkipNoFakeAck` 22 PASS (kilit yeni imzaya
YENİDEN BAĞLANDI, kaldırılmadı) · tsc + lint PASS.

---

## CP-05 · MUSIC F7.4 — SAĞLAYICI (UZAK) KAPAK YOLU

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED`

### Ölçülen kusur
Sağlayıcı kapak kimliği bir `https://` küçük resim adresidir; `resolveArtwork` onu
native MediaStore çözücüsüne gönderiyordu → çözüm düşüyor, **Now Playing kapağı boş
kalıyordu**.

### Yapılan
- `resolveArtwork`: `http(s)` kimlik doğrudan GEÇİRİLİR (`source: 'REMOTE'`); native
  decode ÇAĞRILMAZ, disk/bellek katmanına YAZILMAZ (sahte önbellek iddiası yok).
- LAB: `Uzak kapak geçişi (F7.4)` sayacı.

### Test
`musicF74RemoteArtwork` 5 PASS · F2 kapak paketi 42 PASS · tsc + lint PASS.

### Sıradaki adım
→ **CP-06 · MUSIC F7.5** — sağlayıcı dinleme oturumu (PlayQueue + ListeningSession)
  ve kalan F7 kapanış denetimi.

---

## CP-06 · F7.5 + AĞIR DOĞRULAMA + DOKÜMANTASYON

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED`

### F7.5 (bu turda eklendi)
`MusicViewModel`: gömülü IFrame kaynağında `transport` hiç `PLAYING` olmuyordu →
**YouTube duraklatılamıyordu**. IFrame'in KENDİ `PLAYING` olayı bu backend için
ulaşılabilir en yüksek kanıttır ve artık transporta yansır. **Native yolun
"doğrulanmamış playing ≠ PLAYING" kuralı GEVŞETİLMEDİ** (kilitle korunuyor).

### Yeniden bağlanan kilit (kaldırılmadı)
`arch03HardwareProductionAdoption` — donanım MediaSession `next/previous` artık
kuyruk-farkında girişten geçtiği için kilit metinsel eşleşmeden **gerçek
değişmeze** bağlandı: "ikinci oynatıcı yolu yok + her yol sonunda kapıya iner +
provenance korunur".

### Ağır doğrulama (BİR KEZ koşuldu)
| Kapı | Sonuç |
|------|-------|
| Full unit suite | **17.496 test / 790 dosya — 17.495 PASS, 1 FAIL** (yalnız yukarıdaki kilit; düzeltildi) |
| Kilit + music/media yeniden koşu | **27 dosya / 1.360 test PASS** |
| TypeScript `tsc -b --force` | **PASS** |
| Değişen dosya lint | **PASS** |
| Production build (`npm run build`) | **PASS** (6m 8s) |
| Android `testDebugUnitTest` | **PASS** |
| Android `assembleDebug` | **PASS** (bu oturumda Java DEĞİŞMEDİ) |

### Dokümantasyon
`CAROS_MUSIC_ARCHITECTURE_SPEC_v1.md` (F6.1 + F7 bölümleri) ·
`CAROS_PRO_VIZYONU.md` (MUSIC-F6.1 + MUSIC-F7) ·
`DEVICE_VALIDATION_LEDGER.md` (#1100–#1112).

### Sıradaki adım — KARAR VERİLDİ (2026-09-02)
Sağlayıcı sırasının kanonik `PlayQueue` + `ListeningSession`'a taşınması.
**Seçenek 1 SEÇİLDİ (SAME-PROVIDER):** kuyruk, seçilen parçanın kaynak sınıfıyla
sınırlanır; `PlayQueue` tek `SourceClass` taşımaya devam eder. Seçenek 2
(girdi-başına kaynak / karışık-sağlayıcı kuyruk) **REDDEDİLDİ**.
→ Uygulaması **CP-07**'dedir; bu bölüm tarihsel kayıttır.

---

## CP-07 · MUSIC F7.6 — SAĞLAYICI KUYRUĞU + DİNLEME OTURUMU

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-02

### Checkpoint ↔ repo farkı (ölçüldü)
CP-06 "kullanıcı kararı gerekiyor" diyordu; **repo ilerideydi**. Üretim kodu
zaten taşınmıştı ve baştan uygulanmadı:
- `carosMediaLayer`: `_queue` · `_qIndex` · `_qRevision` **YOK** (yalnız
  `_trackByEntryId` sunum önbelleği kaldı — sıra/imleç tutmaz).
- `session/providerQueueContext.ts` (SAF · same-provider · `excludedIds`) ·
  `listeningSessionRuntime.startProviderListening` · `advanceQueue` MEVCUT.
- LAB `media-authority` F7.6 alanları (kuyruk sahibi · girdi kökeni · sağlayıcı
  sınırı · katman projeksiyonu) MEVCUT.
- **EKSİK olan:** F7.6 hedefli test paketi · kalıcı authority kilitleri ·
  kütük maddeleri · doküman/checkpoint güncellemesi. Bu tur bunları kapattı.

### Bu turda eklenen
- `src/__tests__/musicF76ProviderQueueSession.test.ts` — **15 test**
  (kuyruk · oturum · same-provider · radyo ayrımı · sonraki/önceki · legacy
  sahiplik · observed dürüstlüğü · kalıcı kayıt · bayat commit · fail-closed ·
  LOCAL regresyonu · sesli seçim aynı hat).
- `regression.guards`: 3 kalıcı F7.6 kilidi (medya katmanı kuyruk otoritesi
  DEĞİLDİR · PlayQueue/ListeningSession tek otorite · UI ve sağlayıcı kanonik
  kuyruğu doğrudan mutasyona uğratamaz).
- `sourceCapabilities`: YouTube `supportsQueue` yorumu bayattı ("kuyruk
  carosMediaLayer'da") → kanonik `PlayQueue`ya düzeltildi.
- Kütük **#1113–#1116** (🔴) · spec `§F7.6` · vizyon `MUSIC-F7` güncellendi.

### Test sonucu
- `musicF76ProviderQueueSession` **15 PASS** · `regression.guards` **840 PASS**
- Hedefli music/media paketi (11 dosya): **196 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.

### Ağır doğrulama (F7.6 kodu için BİR KEZ koşuldu)
| Kapı | Sonuç |
|------|-------|
| Full unit suite | **791 dosya / 17.518 test — HEPSİ PASS (0 FAIL)** |
| Production build (`npm run build`) | **PASS** (11m 3s) |
| Native build/test | **KOŞULMADI — GEREKMEDİ:** F7.6 tamamen TypeScript; bu turda Java DEĞİŞMEDİ (son native kanıt CP-06). |

### Açık blocker
- Yok (kod tarafı). Saha gate'leri: kütük **#1105–#1116**.
---

## CP-08 · MUSIC F8 — SÜRÜŞ-FARKINDA MÜZİK ZEKÂSI

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-02

### Ölçülen başlangıç
Bağlam sinyalleri ZATEN vardı (`UnifiedVehicleStore.speed` · `tripLogService` ·
`navigationService.isGuidanceActive` + `distanceSource` · F3 `ListeningSession` ·
`recentlyPlayed`). Müzikte bağlam YALNIZ satır sayısı kısıtlamasına
(`drivingMode === 'driving'`) kullanılıyordu. **Tercih kanıtı ve bağlam→karar
zinciri hiç yoktu.**

### Yeni (hepsi `src/platform/media/intelligence/`)
- `drivingContextModel.ts` — SAF sınıflandırma (histerezisli; hız yoksa `UNKNOWN`).
- `drivingContextSources.ts` — tek okuma katmanı (koordinat/hedef GEÇMEZ).
- `preferenceEvidence.ts` — sınırlı (48 LRU · 45 gün TTL) yerel kanıt; ad · URI ·
  konum · sağlayıcı içerik kimliği SAKLANMAZ; şema testle kilitli.
- `musicIntelligenceModel.ts` — SAF fail-closed karar (HOLD · SUGGEST · AUTO_RESUME).
- `musicIntelligenceRuntime.ts` — TEK dikiş; **timer/polling YOK**, yalnız
  `subscribeListeningSession`; yürütme kanonik F3/F7.6.
- `intelligenceTelemetry.ts` — bounded sayaç + latency.
- UI: `MusicIntelligenceCard` (tek satır, skor/gerekçe göstermez) + keşif yüzeyi +
  bağlam-farkında büyük çal tuşu.
- Lifecycle: `SystemBoot` → `music-intelligence` (cleanup kayıtlı).
- LAB: `media-authority` → `18 · Sürüş-Farkında Müzik (F8)` (**yeni ekran YOK**).

### Kilit kararlar
- **Açık kullanıcı niyeti** geri yükleme dışında başlayan her oturumdan TÜRETİLİR
  → F5/F7'ye F8 çağrısı eklenmedi (ters bağımlılık yok).
- **"Başlatıldı" tercih kanıtı değildir**; ≥90 sn korunan dinleme sayılır.
- **Kullanıcı dokunmadan ses BAŞLAMAZ**; `AUTO_RESUME` yalnız çal tuşunun NE
  çalacağını belirler.

### Test sonucu
- `musicF8DrivingIntelligence` **17 PASS** · `regression.guards` **846 PASS**
  (6 yeni F8 kilidi) · hedefli paket (12 dosya) **1.135 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Güncellenen kilitler (kaldırılmadı): `mediaAuthorityLab` kart listesi 17→18.

### Açık borç (bilinçli)
1. Kontak/yolculuk başlangıcında **UI olmadan** otomatik çalma YOK (arka plan
   aktörü gerektirirdi; timer-kurma yasağı korundu).
2. Mavi entegrasyonu bu fazda YAPILMADI.

### Ağır doğrulama (F8 kodu için BİR KEZ koşuldu)
| Kapı | Sonuç |
|------|-------|
| Full unit suite | **792 dosya / 17.541 test — HEPSİ PASS (0 FAIL)** |
| Production build (`npm run build`) | **PASS** (8m 15s) |
| Native build/test | **KOŞULMADI — GEREKMEDİ:** F8 tamamen TypeScript; bu turda Java DEĞİŞMEDİ. |

### Saha gate'leri
Kütük **#1117–#1122** (🔴). #1119 (çalan müziğe karışmama) ve #1121
(kendiliğinden ses başlamaması) atlanamaz.
---

## CP-09 · MUSIC F9 — MAVİ MUSIC COMPANION

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-02

### Ölçülen başlangıç (repo denetimi)
- CANONICAL: `PLAY_MEDIA`/`PAUSE_MEDIA` (truth'lu) · `playByVoiceQuery` (F5.1) ·
  `maviMediaAuthorityPort` (yalnız taşıma).
- **BYPASS:** `commandExecutor` atlama için `mediaService`e doğrudan iniyordu →
  F7.3 kuyruk-farkında girişi ATLANIYORDU (sağlayıcı kuyruğunda "sonraki" düşüyordu).
- **UNSAFE:** üç ayrı KOŞULSUZ iddia — `"<başlık> çalınıyor"` ·
  `OPEN_MUSIC → 'Müzik açılıyor'` · `_openEmbeddedMusic → 'Müzik açılıyor'`.
- **MISSING:** tek `MusicIntent` sözleşmesi · kuyruk sesli komutları · bağlamsal
  (F8) istekler · kaynak niteleyicisi dürüstlüğü.

### Yeni (hepsi `src/platform/media/intent/`)
`musicIntent.ts` (sözleşme + iddia sınıfı) · `musicIntentResolver.ts` (SAF,
YEREL, bulutsuz) · `musicIntentRouter.ts` (kanonik yönlendirme + bayatlık
nesli) · `musicIntentSpeech.ts` (SAF, teknik kod okumaz) ·
`musicIntentTelemetry.ts` (bounded, metin YAZMAZ).
Ek: F8'e `evaluateForExplicitRequest` (salt okuma) · `carosMediaLayer.next/
previous` artık `MediaCommandResult` döndürür · `unifiedFromSearchResult`
dışa açıldı · LAB `19 · Mavi Müzik Niyeti (F9)`.

### Kilit kararlar
- İddia kanıtı AŞAMAZ: `ACCEPTED_UNVERIFIED` → asla "çalıyor".
- Kaynak niteleyicisi FİLTREdir; **sessiz kaynak değişimi YOK**.
- Belirsizde **kör autoplay YOK** (F5 eşiği korunur, F9 sıralama KURMAZ).
- Bağlamsal istek F8 otomasyon kapılarını aşar, **kanıt kapısını aşmaz**.
- **Mood/tempo ölçümü YOK** → dürüstçe reddedilir (sahte motor kurulmadı).

### Test sonucu
- `musicF9MaviMusicCompanion` **15 PASS** · `regression.guards` **853 PASS**
  (7 yeni F9 kilidi) · hedefli paket (13 dosya) **1.073 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- **Yeniden bağlanan kilitler (kaldırılmadı):** `mediaSkipNoFakeAck` ×4 ·
  `regression.guards` `_playMusicInAppOrFallback` ×1 · `mediaAuthorityLab` 18→19.

### Ağır doğrulama (F9 kodu için BİR KEZ koşuldu)
| Kapı | Sonuç |
|------|-------|
| Full unit suite | **793 dosya / 17.563 test — HEPSİ PASS (0 FAIL)** |
| Production build (`npm run build`) | **PASS** (5m 6s) |
| Native build/test | **KOŞULMADI — GEREKMEDİ:** F9 tamamen TypeScript; bu turda Java DEĞİŞMEDİ. |

### Açık borç (bilinçli)
1. Mood/tempo tabanlı öneri (repoda akustik ölçüm kaynağı YOK).
2. Kanonik playlist modeli yok — `PLAY_PLAYLIST` arama yoluna düşer.
3. `commandParser` eski müzik niyetlerinin F9 sözleşmesine tam göçü.

### Saha gate'leri
Kütük **#1123–#1129** (🔴). #1123 (iddia ↔ gerçek oynatma) ve #1128 (sürüşte
video kapısı + duck) atlanamaz.
---

## CP-10 · MUSIC F10 — MOOD / ENERGY INTELLIGENCE

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / **KANIT KAYNAĞI BAĞLI DEĞİL**)
- **Tarih:** 2026-09-02

### ÖLÇÜM (fazın en önemli bulgusu)
Gerçek trait kaynağı **YOK**:
- LOCAL: `MediaStoreLibraryScanner` projeksiyonunda **GENRE/YEAR sorgulanmıyor**.
- Piped/YouTube: başlık · yükleyen · süre · kapak. Trait yok.
- Spotify: yalnız `/search` + `/me/player/*`; **`audio-features` çağrılmıyor**.

### Yeni (`src/platform/media/traits/`)
`musicTraitEvidence.ts` (sözleşme + zorlanan kurallar) · `traitHeuristics.ts`
(süre + metin ipucu, LOW tavanlı) · `traitSelectionModel.ts` (göreceli/mutlak,
fail-closed) · `traitRuntime.ts` (LRU 512 · tarama 400 · timer YOK) ·
`traitTelemetry.ts` (bounded, metin yazmaz).
Wiring: F9 `runTraitDirected` (CALMER/MORE_ENERGETIC + F8 kanıtsızsa bağlam
hedefli) · `musicIntentSpeech` temkinli/kesin dal · LAB `20 · Karakter / Enerji
Kanıtı (F10)`.

### Kilit kararlar
- BPM yalnız gerçek ölçümden; sezgisel/türetilmiş kaynak BPM YAZAMAZ.
- Sezgisel kanıt `LOW` tavanlı → **bugün kesin dil ULAŞILAMAZ** (bilinçli).
- Göreceli istek referans ister; yoksa `NO_REFERENCE` (sahte kıyas yok).
- Seçim yalnız KİMLİK döndürür; çalma kanonik F3 zincirinden.

### Test sonucu
- `musicF10MoodEnergyIntelligence` **13 PASS** · `regression.guards` **859 PASS**
  (6 yeni F10 kilidi) · hedefli paket (11 dosya) **1.059 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Yeniden bağlanan kilitler (kaldırılmadı): `musicF9` mood reddi artık karakter
  yolundan · `mediaAuthorityLab` kart listesi 19→20.

### Ağır doğrulama (F10 kodu için BİR KEZ koşuldu)
| Kapı | Sonuç |
|------|-------|
| Full unit suite | **794 dosya / 17.582 test — HEPSİ PASS (0 FAIL)** |
| Production build (`npm run build`) | **PASS** (5m) |
| Native build/test | **KOŞULMADI — GEREKMEDİ:** F10 tamamen TypeScript; bu turda Java DEĞİŞMEDİ. |

### AÇIK BORÇ (F10 "tamamlandı" SAYILAMAZ)
1. MediaStore `GENRE`/`YEAR` projeksiyona eklenmedi (native + cihaz doğrulaması).
2. Spotify `audio-features` bağlanmadı (ağ/oran sınırı/politika değerlendirmesi).
3. Sağlayıcı tarafında trait yok — ürün sınırı.

### Saha gate'leri
Kütük **#1130–#1135** (🔴). #1130 (kanıtsızken sahte seçim yok) ve #1135
(gerçek kaynak borcu) kapanmadan F10 "çalışıyor" diye SUNULMAZ.
---

## CP-11 · MUSIC F10.1 — GERÇEK KARAKTER KANITI KAPANIŞI

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-02

### Ölçüm
`androidx.media3` ZATEN bağımlılıkta → gömülü ID3/Vorbis etiketi okunabilir.
MediaStore `GENRE` API 30+ sütunu olarak eklenebilir. Spotify `audio-features`
DOĞRULANAMADI; Piped trait vermiyor.

### Yapılan
- **Native:** `MediaStoreLibraryScanner` projeksiyonuna `GENRE` (sürüm kapılı) +
  `YEAR`; yeni `TrackTraitExtractor` (media3 `MetadataRetriever`, MAX_BATCH 24,
  dosya başına 1,5 sn timeout); `CarLauncherPlugin.readTrackTraits`
  (`mediaLibraryExecutor` — UI thread YOK).
- **TS:** `nativePlugin` sözleşmesi · `MusicTrack.genre/year` ·
  `traitSources.ts` (gömülü BPM + tür adaptörleri + kaynak yetenek tablosu) ·
  `musicTraitEvidence` provenance sırası (`MEASURED_AUDIO`/`EMBEDDED_METADATA`)
  ve **tempo kapısı sıkılaştırıldı** · `traitRuntime` (şema+kuşak anahtarı,
  `primeEmbeddedTraits`, saf `computeTraitEvidence`) · F9 router seçimden önce
  sınırlı prime · LAB kart genişletmesi.

### Bu turda yakalanan GERÇEK kusur
LAB alanı `peekReferenceEvidence` üretim önbelleğine/sayaçlarına YAZIYORDU →
F3.2 salt-okunurluk kilidi yakaladı. Saf hesaplayıcı ayrıştırıldı, kalıcı kilit
eklendi.

### Test sonucu
- `musicF101RealTraitEvidence` **13 PASS** · `regression.guards` **866 PASS**
  (7 yeni F10.1 kilidi) · hedefli paket (12 dosya) **1.084 PASS**
- Full suite **3 shard temiz**: 265+265+265 dosya / **17.602 test PASS**
- Production build **PASS** (6m 42s) · tsc + lint PASS
- Native: `compileDebugJavaWithJavac` · `testDebugUnitTest` · `assembleDebug`
  hepsi **BUILD SUCCESSFUL**

### Test altyapısı düzeltmesi (kök neden ölçüldü)
`hookTimeout` 10 sn → 20 sn. Sebep ürün DEĞİL: soğuk Vite transform 6,99 sn,
sıcak önbellekte import 60 ms. `testTimeout` aynı gerekçeyle zaten 20 sn'ydi;
hook'lar ayrı bütçe kullandığı için kapsam dışında kalmıştı. Hiçbir iddia
zayıflatılmadı.

### Yeniden bağlanan kilit (kaldırılmadı)
`musicF10` BPM kaynağı testi: `LIBRARY_METADATA` artık BPM taşıyamaz
(kural SIKILAŞTI, gevşemedi).

### Saha gate'leri
Kütük **#1136–#1141** (🔴). #1135 kod tarafında kapandı, saha doğrulaması
#1136–#1141'e devredildi.

---

## CP-12 · MUSIC F17 — SONIC AUDIO INTELLIGENCE

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-03

> **Not (devir):** CP-12 öncesi F11–F16 turları bu dosyaya YAZILMADI (önceki
> pencere checkpoint yazmadan kapandı). O turların otoritesi kütük **#1142–#1160**
> ve `musicF11..F16` test paketleridir; F17 onların üstüne kuruldu.

### Ölçülen başlangıç (repo denetimi)
- `MEASURED_AUDIO` provenance F10'dan beri TANIMLI ama **hiç KULLANILMIYORDU**.
- Native tarafta yalnız `TrackTraitExtractor` (media3 `MetadataRetriever`) vardı:
  bu bir **etiket okumasıdır**, dosya DECODE EDİLMİYORDU.
- `traitTelemetry` switch'inde `EMBEDDED_METADATA` dalı YOKTU → F10.1 kanıtı
  `evidenceNone`a düşüyor, LAB onu **"kanıt yok" diye sayıyordu** (gerçek kusur).

### Yeni
- **Native:** `SonicAudioAnalyzer.java` — `MediaExtractor` + `MediaCodec` (AOSP,
  yeni bağımlılık/lisans YOK). Mono downmix + ~11 kHz decimation + 512 nokta
  Hann/FFT. Ölçülenler: peak/RMS dBFS · crest · ZCR · spektral merkez ·
  %85 rolloff · spektral akı · 8 bant normalize enerji · onset zarfı
  otokorelasyonundan tempo + güven. `MAX_BATCH 4` · dosya başına 4 sn bütçe ·
  en çok 20 sn ses · `AtomicInteger` iptal kuşağı.
  `CarLauncherPlugin.analyzeTrackAudio` / `cancelTrackAudioAnalysis` — **ayrı**
  `sonicAnalysisExecutor` havuzu (kütüphane taramasını bile bloklamaz).
- **TS (`src/platform/media/sonic/`):** `sonicDescriptor.ts` (SAF sözleşme +
  enerji proxy + benzerlik) · `sonicAdmissionModel.ts` (SAF kabul kararı) ·
  `sonicSources.ts` (tek okuma katmanı) · `sonicAnalysisRuntime.ts` (tek dikiş:
  LRU 256 · kuşak anahtarı · iptal · in-flight kilidi · sınırlı yeniden deneme) ·
  `sonicTelemetry.ts` (bounded, metin YAZMAZ).
- **F10 zinciri yeniden YAZILMADI:** yalnız yeni ve daha güçlü provenance
  beslendi. `TRAIT_SCHEMA_VERSION` 2 → 3.
- **LAB:** `media-authority` → `24 · Ses Ölçümü / Sonic (F17)` (**yeni ekran YOK**).

### Kilit kararlar
- **Mood ÜRETİLMEZ** — native tarafta böyle bir alan hiç yok; TS'te `mood: null`
  tek atamadır ve kilitle korunur.
- **Zayıf tepe tempo DEĞİLDİR** (`tempoConfidence < 0.35` → tempo düşer).
- **Enerji açıkça PROXY'dir**: girdileri ölçüm, birleştirmesi yorum.
- **Baskı = HİÇ ölçmemek** (§7): termal/bellek baskısında tur boyu 0.
- **Ses ölçümü sesli isteği BLOKLAMAZ** (fire-and-forget); bu istek eldeki
  kanıtla karar verir, sonraki istek ölçümü görür. Beklememek sahte kesinlik
  üretmez — kanıt yoksa iddia da kurulmaz.
- **Sağlayıcı içeriği ölçülemez** (dürüst sınır, kütük #1167).

### Test sonucu
- `musicF17SonicAudioIntelligence` **35 PASS** · `regression.guards` **917 PASS**
  (8 yeni F17 kilidi) · hedefli paket (9 dosya) **271 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Güncellenen kilitler (kaldırılmadı): `mediaAuthorityLab` kart listesi 23→24
  (+ fixture F17 alanları).

### Açık borç (bilinçli)
1. Sağlayıcı (YouTube/Spotify/radyo) içeriği ölçülemiyor — ürün sınırı.
2. Ölçüm yalnız karakter isteği yolundan tetikleniyor; keşif yüzeyinden
   tetikleme F18'de değerlendirilecek.

### Saha gate'leri
Kütük **#1161–#1167** (🔴). #1162 (ses kesilmemesi) ve #1163 (uydurma BPM yok)
atlanamaz.

### Sıradaki adım
→ **F18 · SMART RADIO / ENDLESS MIX** (F17 kanıtı + F10/F8/F13/F15/F5 → F3).

---

## CP-13 · MUSIC F18 — SMART RADIO / ENDLESS MIX

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-03

### Ölçülen başlangıç (repo denetimi)
- CarOS tek parça açıp bitiyordu; "bunun gibi devam et" gibi bir istek
  karşılanamıyordu (resolver'da kalıp YOK, router'da rota YOK).
- `PlayQueue`da `addToQueue` VARDI ama `listeningSessionRuntime`de kütüphane
  parçalarını mevcut kuyruğa ekleyen kanonik bir seam YOKTU → F18 ya kendi
  kuyruk kurucusunu icat edecekti (yasak) ya da çalan parçayı baştan alacaktı.

### Yeni
- `src/platform/media/radio/`: `smartRadioModel.ts` (SAF sıralama politikası +
  iddia sınıfı + kararlı karma) · `smartRadioRuntime.ts` (tek dikiş: plan +
  kanonik yürütme) · `smartRadioTelemetry.ts` (bounded).
- **F3 genişletmesi (yeni otorite DEĞİL):** `appendLibraryTracksToQueue` —
  girdi inşası kanonik `buildLibraryQueueContext`, mutasyon kanonik
  `addToQueue`, native yazım `runQueueCommand` (`forcePlay: false`).
- Niyet: `RadioIntentKind` (4 niyet) + `RADIO_KINDS` + `F18_SMART_RADIO` rotası
  + resolver §1.8 + `runSmartRadio` + `voiceService` dar-güvenli kümesi.
- Konuşma: `radioSpeech` — cümle `claimClass`ı izler.
- **LAB:** `media-authority` → `25 · Kesintisiz Akış / Smart Radio (F18)`.

### Kilit kararlar
- **Smart Radio kuyruk otoritesi DEĞİLDİR:** yalnız aday sırası üretir.
- **Ses varken EKLE, sessizken BAŞLAT** — çalan parça baştan alınmaz (#1119).
- **İddia sınıfı:** `MEASURED` (F17 ölçümü, ≥4 ve adayların ≥%50'si) ·
  `WEAK` · `FALLBACK`. "Benzer/sana özel" YALNIZ `MEASURED`.
- **Rastgelelik YOK:** kanıtsız sıra kararlı karmayla deterministiktir.
- **Havuz yalnız yerel** — karma-sağlayıcı kuyruk üretilmez; kuyruğu
  desteklemeyen kaynakta ekleme dürüstçe reddedilir.
- **Kalıcı radyo state YOK** — her istek ≤40 öğelik sınırlı bir liste üretir.

### Test sonucu
- `musicF18SmartRadioEndlessMix` **24 PASS** · `regression.guards` **924 PASS**
  (7 yeni F18 kilidi) · hedefli paket (14 dosya) **422 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Güncellenen kilitler (kaldırılmadı): `mediaAuthorityLab` kart listesi 24→25.

### Açık borç (bilinçli)
1. Akış yalnız yerel kütüphaneden beslenir (sağlayıcı ölçülemez — F17 #1167).
2. Kuyruk bitmeden otomatik uzatma (gerçek "endless") YOKTUR: kullanıcı
   isteğiyle sınırlı liste üretilir. Otomatik uzatma bir arka plan aktörü
   gerektirirdi (timer-kurma yasağı) — F21'de süreklilik bağlamında yeniden
   değerlendirilecek.

### Saha gate'leri
Kütük **#1168–#1174** (🔴). #1169 (çalan müziğe karışmama) ve #1170 (zayıf
kanıtla iddia kurmama) atlanamaz.

### Sıradaki adım
→ **F19 · LOUDNESS / REPLAYGAIN / VOLUME CONSISTENCY**

---

## CP-14 · MUSIC F19 — LOUDNESS / REPLAYGAIN / VOLUME CONSISTENCY

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-03

### Ölçülen başlangıç (fazın en önemli bulgusu)
`volumePolicy` formülünde `sourceNormalization` alanı **F0'dan beri VARDI ama
HİÇ beslenmiyordu** (daima 1). Yani seviye tutarlılığı kodda tanımlıydı,
üretimde YOKTU. Native tarafta ReplayGain/R128 okuması da yoktu.

### Yeni
- **Native:** `TrackTraitExtractor` GENİŞLETİLDİ (yeni yüzey AÇILMADI) —
  ID3 `TXXX` · MP4/iTunes `----` (`InternalFrame`) · Vorbis/Opus yorumlarından
  `replaygain_track_gain` · `_peak` · `r128_track_gain` (Q7.8 → dB).
  Satırlara `gainDb` · `gainPeak` · `gainSource` eklendi.
- **TS (`src/platform/media/loudness/`):** `loudnessEvidence.ts` (SAF sözleşme +
  `computeNormalization`) · `loudnessRuntime.ts` (tek dikiş, timer YOK, parça
  sınırında) · `loudnessTelemetry.ts` (bounded).
- **Gateway:** `setSourceNormalization` (TEK yazar) + `getSourceNormalization`;
  `nativeUserVolume` artık normalizasyonu İÇERİR, duck'ı hâlâ İÇERMEZ.
- **Lifecycle:** `SystemBoot` → `music-loudness` (cleanup kayıtlı).
- **LAB:** `media-authority` → `26 · Seviye Tutarlılığı (F19)`.

### Kilit kararlar
- **LUFS UYDURULMAZ**: elde ETİKET ya da düz RMS var; ikisi de LUFS değildir.
  RMS referansı (−14 dBFS) mühendislik sabitidir ve saha kalibrasyonu bekler.
- **YALNIZ KISILIR**: pozitif kazanç `BOOST_NOT_SUPPORTED` ile nötr bırakılır
  (headroom/clipping güvenliği). Kısma ≤ 12 dB, çarpan ≥ 0.25.
- **Kullanıcı sesi ve duck DEĞİŞMEZ**; DSP güvenlik preamp'i AYRI kalır.
- **Pumping yok**: karar parça sınırında, bir kez; 1 dB altı fark uygulanmaz;
  çarpan kuantalanır.
- **Kapanışta kısma nötre geri çekilir** (bu turda yakalanan sızıntı).
- Sağlayıcı akışında kanıt YOK → çarpan bir kez nötre yazılır.

### Bu turda yakalanan GERÇEK kusurlar
1. `stopLoudnessNormalization` çarpanı ses yolunda BIRAKIYORDU → nötre geri
   çekme eklendi + kalıcı kilit.
2. İlk gözlem `null` kimlikle atlanıyordu (önceki parçanın kısması sızabilirdi)
   → `trackedId` için `undefined` (hiç değerlendirilmedi) ayrımı eklendi.

### Test sonucu
- `musicF19LoudnessConsistency` **22 PASS** · `regression.guards` **931 PASS**
  (7 yeni F19 kilidi) · hedefli paket (7 dosya) **202 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Güncellenen kilitler (kaldırılmadı): `mediaAuthorityLab` kart listesi 25→26.

### Açık borç (bilinçli)
1. RMS referansı SAHADA kalibre edilmedi (#1176).
2. Sessiz parça yükseltilmiyor — ürün sınırı (#1177).
3. Sağlayıcı akışı normalize edilemiyor (#1180).

### Saha gate'leri
Kütük **#1175–#1181** (🔴). #1178 (kullanıcı sesi/duck değişmemesi) ve #1179
(pumping olmaması) atlanamaz.

### Sıradaki adım
→ **F20 · GAPLESS / CROSSFADE / INTELLIGENT TRANSITIONS**

---

## CP-15 · MUSIC F20 — GAPLESS / CROSSFADE / INTELLIGENT TRANSITIONS

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-03

### Ölçülen platform gerçeği (fazın en önemli bulgusu)
1. **GAPLESS ZATEN VAR** — ExoPlayer kuyruğu `setMediaItems` ile alır ve
   kodlayıcı gecikme/dolgu bilgisini kendisi uygular; CarOS
   `setPauseAtEndOfMediaItems` KULLANMAZ. F20'nin işi **bozmamaktı**.
2. **GERÇEK CROSSFADE MÜMKÜN DEĞİL** — tek `ExoPlayer` örneği vardır; üst üste
   binme ikinci bir player/mikser ister = ikinci playback otoritesi (yasak).
   → `TRUE_CROSSFADE: UNSUPPORTED` olarak dürüstçe yazıldı.
3. **BEAT MATCHING / TIME STRETCH YOK** → `BEAT_MATCHED: UNSUPPORTED`.

### Yeni
- **Native:** `CarosPlaybackService` — `transitionGain` çarpanı
  (`userVolume × duck × transitionGain`), sınırda doğrusal rampa,
  `setTransitionPolicy` komutu, `CarosPlaybackBridge` case'i, diagnostics
  alanları. İzleyici yalnız fade açık + çalarken tikler.
- **TS (`src/platform/media/transition/`):** `transitionModel.ts` (SAF yetenek
  tablosu + politika) · `transitionPreference.ts` (HAFİF kalıcı tercih) ·
  `transitionRuntime.ts` (tek dikiş) · `transitionTelemetry.ts`.
- **Gateway:** `setTransitionPolicy` (ses/kuyruk komutu DEĞİL).
- **Lifecycle:** `SystemBoot` → `music-transition`.
- **UI:** `AudioExperiencePanel` → "Parça geçişi" bölümü (aç/kapa + süre).
  Olmayan crossfade kontrolü ÇİZİLMEZ.
- **LAB:** `media-authority` → `27 · Parça Geçişi (F20)`.

### Kilit kararlar
- Fade **CROSSFADE DEĞİLDİR** ve öyle adlandırılmaz (üst üste binme YOK).
- **Albüm devamlılığında fade UYGULANMAZ** — eser bozulmaz.
- **Canlı içerikte ve duck etkinken geçiş UYGULANMAZ** (TS + native çift kapı).
- **Akıllı kısım yalnız SÜREdir** ve yalnız `MEASURED_AUDIO` kanıtından gelir;
  etiket tempo (F10.1) bu ayarı YAPAMAZ.
- **Varsayılan KAPALI** — duyulur davranış değişikliği kullanıcının kararıdır.
- Geçiş kazancı **playback truth ÜRETMEZ**.

### Bu turda yakalanan GERÇEK kusur
Geçiş tercihi ağır politika modülünde durduğu için `AudioExperiencePanel`
termal/bellek gözcüsünü ve kütüphane indeksini transitif olarak yüklüyordu →
`musicF6AudioSurface` paketi düştü. Tercih hafif `transitionPreference`
modülüne AYRILDI ve sınır kilitle korundu.

### Test sonucu
- `musicF20TransitionExperience` **21 PASS** · `regression.guards` **937 PASS**
  (6 yeni F20 kilidi) · hedefli paket (5 dosya) **1.058 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Güncellenen kilitler (kaldırılmadı): `mediaAuthorityLab` kart listesi 26→27.

### Açık borç (bilinçli)
1. Gerçek crossfade ürün sınırıdır (#1183).
2. Beat hizalama altyapısı yok (#1186).
3. Fade davranışı **cihazda hiç duyulmadı** — #1184 atlanamaz.

### Saha gate'leri
Kütük **#1182–#1188** (🔴).

### Sıradaki adım
→ **F21 · OFFLINE / CACHE / RECOVERY / IGNITION CONTINUITY**

---

## CP-16 · MUSIC F21 — OFFLINE / CACHE / RECOVERY / IGNITION CONTINUITY

- **Durum:** `IMPLEMENTATION COMPLETE — QA REQUIRED` (CODE PASS / DEVICE PENDING)
- **Tarih:** 2026-09-03

### Ölçülen başlangıç
Kurtarma mimarisi ZATEN sağlamdı ve KORUNDU:
- `restoreListeningSession` bağlamı geri yükler ama **ASLA ÇALMAZ**
  (`playbackClaim: 'NONE'`), süreklilik `UNKNOWN` başlar.
- YouTube kuyrukta `piped://<id>` **sentinel** taşır → gerçek adres çalma
  anında çözülür, süresi dolan URL kuyruğa hiç YAZILMAZ.
- Bayat kütüphane girdileri `revalidateAgainstLibrary` ile düşürülür.
- Her önbellek kendi şema sürümünü taşır.

### Kapatılan GERÇEK açık
Doğrudan `http(s)` akış adresi taşıyan sağlayıcı girdileri (Jamendo · Audius ·
doğrudan akış) kalıcı kayda giriyordu ve saatler sonra "canlı" muamelesi
görüyordu → basınca ölen bir satır. Artık geri yüklemede sınıflandırılır ve
düşürülür (sayılarak).

### Yeni (`src/platform/media/recovery/`)
`recoveryModel.ts` (SAF: `classifyEntryFreshness` · `shouldDropOnRestore` ·
`decideAutoResume` · `classifyCacheHealth`) · `recoverySources.ts` (tek okuma:
kontak · ağ · oturum · kuyruk) · `recoveryRuntime.ts` (salt okuma + karar,
ÇALMAZ) · `recoveryTelemetry.ts` (bounded).
Wiring: `restoreListeningSession` tazelik süzgeci + geri yükleme sayaçları.
**LAB:** `media-authority` → `28 · Süreklilik / Kurtarma (F21)`.

### Kilit kararlar
- **Kontak UYDURULMAZ**: kanıt yalnız RPM/akü geriliminden; eşik OBD
  `linkLossLedger` ile BİREBİR aynı (13.0 V). Yoksa `UNKNOWN`.
- **Otomatik devam FAIL-CLOSED** ve üretimde politika **KAPALI**
  (`POLICY_ALLOWS_AUTO_RESUME = false`) → kullanıcı dokunmadan ses BAŞLAMAZ.
- **Kullanıcı niyeti korunur**: duraklatılmış oturum kendiliğinden açılmaz.
- **Çevrimdışı dürüst**: ağ gerektiren kaynakta `OFFER`, yerelde etkisiz.
- **İkinci kurtarma motoru KURULMAZ** (§18) — USB/dosya yolu F2'de kalır.

### Test sonucu
- `musicF21RecoveryContinuity` **20 PASS** · `regression.guards` **943 PASS**
  (6 yeni F21 kilidi) · F3/F7.6/authority paketi **107 PASS**
- `tsc -b --force` PASS · değişen dosya lint PASS.
- Güncellenen kilitler (kaldırılmadı): `mediaAuthorityLab` kart listesi 27→28.

### Açık borç (bilinçli)
1. UI'sız otomatik devam KAPALI — açma yolu bu turda EKLENMEDİ (#1192).
2. Ağ gidip gelmesinde aktif yeniden çözümleme (re-resolve) tetikleyicisi YOK;
   kullanıcı tekrar basınca zaten çalma anında çözülür.
3. Spotify oturum düşmesi sağlayıcı tarafında kalır (F7 sınırı).

### Saha gate'leri
Kütük **#1189–#1195** (🔴). #1190 (phantom PLAYING yok) ve #1192 (kendiliğinden
ses başlamaması) atlanamaz.

### Sıradaki adım
→ **F22 · MUSIC FINAL COMPLETENESS AUDIT + FINAL HEAVY QA**

---

## CP-17 · MUSIC F22 — FINAL COMPLETENESS AUDIT + HEAVY QA

- **Durum:** `QA PASS — PHASE CLOSURE ELIGIBLE` (KOD/BUILD/NATIVE) ·
  **SAHA: PENDING**
- **Tarih:** 2026-09-03

### Denetim kapsamı (F0–F21)
İkinci authority · legacy mutable playback/queue state · ölü media path ·
çift sesli yürütme · sahte başarı/ilerleme iddiası · sağlayıcı doğrudan bypass ·
bayat tamamlama · sınırsız cache/store · gizlilik sızıntısı · desteklenmeyen
yetenek UI'ı · 800×480 taşma · sürüş güvenliği bypass · YouTube/Piped
regresyonu · Mavi kanonik hat açığı · Favorites/Playlist/Lyrics tutarsızlığı ·
DSP/volume/duck çatışması · Smart Radio/Sonic dürüstlüğü · sourceNormalization
truth · transition truth · recovery gap.

### Bulunan ve KAPATILAN gerçek açıklar
1. **Sahte başarı iddiası (#1196):** `musicCommandParser` shuffle dalı
   yürütmeden ÖNCE `"…karışık çalınıyor"` diyordu → `"…çalmayı deniyorum"`.
   Tüm ayrıştırıcı `feedback` metinleri kalıcı kilitle tarandı.
2. **Ölü kod:** `isSonicResolved` (F17) ve `getTransitionCapabilities` (F20)
   hiçbir yerden çağrılmıyordu → kaldırıldı.
3. **Native derleme kusurları (#1197):** `CarLauncherPlugin` içinde
   `SonicAudioAnalyzer` import EDİLMEMİŞTİ (farklı paket) ve
   `JSArray.put(double)` `JSONException` bildirdiği için bant vektörü yazımı
   derlenmiyordu. İkisi de host testinden GÖRÜNMEZDİ.

### Denetimde TEMİZ çıkanlar (kanıtlı)
- UI'dan sağlayıcı/native doğrudan çalma: **0** (kilitlendi).
- Yeni müzik önbelleklerinin hepsi sınırlı (`MAX_*` sabitleri kilitli).
- Telemetri gizlilik allowlist'i: 5 yeni telemetride ad/URI/metin **yok**.
- `SystemBoot` cleanup kaydı: `music-intelligence` · `music-loudness` ·
  `music-transition` (zero-leak).
- Duck token deposu `MAX_DUCK_ENTRIES = 16` ile yapısal olarak sınırlı.

### AĞIR DOĞRULAMA (BİR KEZ koşuldu)
| Kapı | Sonuç |
|------|-------|
| Full unit suite | **806 dosya / 17.949 test — HEPSİ PASS (0 FAIL)** |
| TypeScript (`tsc -b --force`) | **PASS** |
| Lint (değişen 25 dosya) | **PASS** |
| Production build (`npm run build`) | **PASS** (9 dk 25 sn) |
| Android `compileDebugJavaWithJavac` | **BUILD SUCCESSFUL** |
| Android `testDebugUnitTest` | **BUILD SUCCESSFUL** |
| Android `assembleDebug` | **BUILD SUCCESSFUL** |

**Kanıt ↔ diff eşlemesi (dürüstlük notu):** full suite ve production build,
native derleme düzeltmesinden ÖNCE koşuldu. O düzeltme **yalnız iki Java
dosyasını** değiştirdi (`CarLauncherPlugin.java` import satırı ·
`SonicAudioAnalyzer.java` JSON yazımı); TypeScript kaynağına, teste veya Vite
çıktısına DOKUNMADI. Bu yüzden TS tarafı kanıtı geçerlidir ve tekrar
koşulmadı; native kanıtı düzeltme SONRASI diff'e aittir.

### Saha gate'leri
Kütük **#1196–#1198** (🔴). #1198 kod hükmü ile saha hükmünü ayıran kapanış
maddesidir ve saha kampanyası bitene kadar AÇIK kalır.

### Hüküm
- `MUSIC-CODE: PASS` · `MUSIC-BUILD: PASS` · `MUSIC-NATIVE: PASS`
- `MUSIC-DEVICE: PENDING` (#1100–#1198 arası 🔴 maddeler)

---

## CP-18 · PRE-FIELD REPAIR — BUG-1 · BUG-2 · KISA PARÇA FADE-IN

- **Durum:** `IMPLEMENTATION COMPLETE — DEVICE PENDING`
- **Tarih:** 2026-09-03 (telefon ön doğrulaması sonrası)

### Bağımsız doğrulanan üç kök neden
1. **BUG-1:** `getDiagnostics()` altı F20 alanını ÜRETİYOR (satır 769–774), ama
   `CarosPlaybackBridge.snapshotOnMain()` (Java, alan alan allowlist) ve
   `nativeAuthorityBridge.sanitizeAuthoritySnapshot()` (TS allowlist) ikisi de
   TAŞIMIYORDU. `snapshotOnMain` hem `mediaAuthoritySnapshot()` hem
   `emitState()` yolunu besliyor → alanlar HER İKİ yolda da düşüyordu.
2. **BUG-2:** `restoreListeningSession` `src/` içinde **hiçbir üretim
   çağrısına** sahip değildi (yalnız tanım + doküman). `persistNow()` ise
   başlatma/dispatch'te yazıyordu → yaz-ama-okuma.
3. **F20-K:** `MIN_FADE_TRACK_MS` yalnız satır 493'te (`checkFadeOut`)
   kullanılıyordu; `onTransitionToNewItem` süre kontrolü yapmıyordu.

### Yapılan (atomik, üç iş)
- **BUG-1:** iki allowlist'e altı alan eklendi. Yeni telemetri/otorite YOK,
  oynatma davranışı DEĞİŞMEDİ.
- **BUG-2:** F3 sahipliğinde `bootRestoreListeningSession()` — exactly-once
  kapısı (`_bootRestoreRan`, await'ten ÖNCE kapanır), native canlıyken
  (`queueLength > 0`) ATLAR, `playbackClaim: 'NONE'`. Çağıran: `SystemBoot`,
  `startMediaAuthority()` sonrası / müzik zekâ katmanları öncesi.
  `recoveryTelemetry`ye 2 sayaç; LAB'da **mevcut satır genişletildi**
  (yeni kart/satır YOK — kart sayısı 28'de sabit).
- **F20-K:** aynı minimum-süre politikası fade-in'e uygulandı; süre
  bilinmiyorsa FAIL-CLOSED.

### Kilitler
`musicPreFieldRepair.test.ts` **20 PASS** (allowlist geçişi · sanitize ·
truth bağımsızlığı · exactly-once · autoplay yok · phantom PLAYING yok ·
native canlıyken duplicate yok · bozuk kalıcılık fail-closed · bayat adres
süzgeci · kısa parçada iki yönde fade yok · uzun parça davranışı korunuyor) ·
`regression.guards` **951 PASS** (3 yeni kalıcı kilit).

### Doğrulama
`tsc -b --force` PASS · değişen dosya lint PASS · hedefli paket (10 dosya)
**242 PASS** · Android `compileDebugJavaWithJavac` + `testDebugUnitTest`
**BUILD SUCCESSFUL**. **Full suite / production build / assembleDebug
KOŞULMADI** (talimat gereği; final saha kapanışında tek turda).

### Saha gate'leri
Kütük **#1199–#1201** (🔴 · CODE FIXED / DEVICE PENDING).
