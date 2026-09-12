# CAROS Music Architecture Spec v1

## F0 · Tek Ses Otoritesi

**Durum: CODE PASS / FIELD PENDING**

F0 kod kapanışı tamamlandı. F1 veya başka bir Music fazı, gerçek cihaz/saha
doğrulaması tamamlanmadan başlatılmaz.

### Canonical LOCAL playback yolu

```text
LocalMusicBrowser
  → carosMediaLayer._playTrack
  → playLocalSelection
  → mediaCommandGateway.playSource(LOCAL)
  → nativeAuthorityBridge
  → CarosPlaybackBridge
  → CarosPlaybackService
  → CarosFocusAwarePlayer
```

`localMusicService` discovery, MediaStore, metadata ve UI-library projection
adaptörüdür; canonical playback truth yayımlamaz. Legacy `MediaPlayer` yolu
yalnız `VITE_USE_LEGACY_LOCAL_PLAYER=true` rollback bayrağı altında korunur.
Varsayılan üretim yolu native authority'dir; authority hatasında sessiz legacy
fallback yapılmaz.

### Saha kabulü — açık maddeler

Gerçek Android head unit/araç üzerinde aşağıdakilerin tamamı ölçülmelidir:

- Direksiyon/AVRCP ile play, pause, next ve previous.
- MediaSession bildiriminde LOCAL metadata ve artwork.
- Telefon veya AudioFocus kaybında doğru pause/suppression.
- Navigasyon anonsunda canonical ducking.
- Canonical LOCAL yolunda `STREAM_MUSIC` volume hack'i olmaması.
- LOCAL → STREAM → LOCAL handover.
- Her anda `audibleBackendCount <= 1`.
- Ignition/session recovery ve phantom-playing olmaması.
- Bozuk, exotic veya unsupported local medya için kilitlenmeyen hata davranışı.

Bu maddelerin tamamı sahada geçmeden F0 genel durumu **PARTIAL** kalır. Bir
madde başarısız olursa F0 yeniden açılır; F1 başlatılmaz.

---

## F2 · Yerel Kütüphane Otoritesi (MusicIndex) + Kapak Katmanı

**Durum: CODE PASS / FIELD PENDING** (final code closure: 1 Eylül 2026)

F0 playback otoritesine DOKUNULMADI. F2 yalnız **kütüphane truth'u** ve
**kapak önbelleği** katmanıdır. `MusicIndex` kütüphane truth'udur;
`CarosPlaybackService` playback truth'u olarak KALIR; UI her ikisinin de
salt-okunur projeksiyonudur.

### Kanonik tarama zinciri

```text
MediaStore volumes  (MediaStoreLibraryScanner.volumeFacts)
  → getMediaStoreVolumeFacts        (izin · version · generation · erişilebilirlik)
  → evaluateStorageLifecycle        (attach · detach · reattach · izin geçişi)
  → planMediaStoreRefresh           (UNCHANGED · DELTA · FULL_RECONCILE)
  → queryMusicTracks                (UNCHANGED ise HİÇ ÇAĞRILMAZ)
  → reconcileMusicIndex / applyMusicIndexDelta + pruneMusicVolume
  → saveRefreshState                (YALNIZ başarıda)
  → useMusicLibrary                 (UI projeksiyonu)
```

### Kanonik kapak zinciri

```text
UI (AlbumArtImg)
  → resolveArtwork                  (tek çözümleyici; UI native'i ÇAĞIRMAZ)
  → bellek (URL referansı, bayt değil)
  → artworkDiskCache                (sınırlı kalıcı LRU · 24 MB / 512 girdi)
  → resolveArtworkFile              (bounds → inSampleSize → sampled decode)
  → ArtworkStore                    (.tmp → rename atomik yazım · şema v1 dizini)
  → Capacitor.convertFileSrc        (yerel dosya URL'i — base64 DEĞİL)
```

### Değişmez kurallar

- **UNCHANGED turunda parça sorgusu SIFIRDIR** ve kütüphane revizyonu artmaz.
- **Başarısız tarama kalıcı generation'ı İLERLETMEZ**; bozuk/yabancı şema bütün
  olarak atılır ve tur FULL_RECONCILE'a düşer.
- **Silme TAHMİN EDİLMEZ.** MediaStore tombstone vermez; budama yalnız o volume'un
  ölçülmüş tam `_ID` kümesiyle yapılır.
- **Erişilemeyen volume SİLİNMEZ, STALE olur.** Kütüphane erişilebilirliği bir
  playback durumu DEĞİLDİR; çalan parçayı etkilemez (Cross-Domain §1, §16).
- **API < 30**: `generation` yoksa `null` raporlanır (sahte 0 yazılmaz) ve delta
  hiç denenmez.
- **Kapak hatası fail-soft**: MusicIndex'i ve playback'i ETKİLEYEMEZ.

### Gözlemlenebilirlik

Yeni LAB ekranı AÇILMADI (ekran enflasyonu yasağı). Mevcut `media-authority`
ekranı iki kartla GENİŞLETİLDİ: `11 · Yerel Kütüphane (F2)` ve
`12 · Kapak Önbelleği (F2)`. Her ikisi de salt-okunur; tarama TETİKLEMEZ.
Parça başlığı · sanatçı · albüm · dosya yolu · içerik URI'si bu ekrana GİRMEZ —
yalnız adet, volume kimlik token'ı, durum kodu ve süre okunur.

### Final kod kapanış kanıtı

- F0/F1/F2 ilgili Vitest paketi: **14 dosya / 245 test PASS**.
- TypeScript, F2 değişen dosya lint'i ve Android `testDebugUnitTest`: **PASS**.
- Production web build ve Android `assembleDebug`: **PASS**.
- Bu kapanışta bağlı ADB cihazı bulunmadığından refresh, izin, artwork ve
  LOCAL playback saha metrikleri host sonucu olarak raporlanmaz.

### Saha kabulü — açık maddeler

Kütük #1069–#1076 maddeleri gerçek cihazda ölçülene kadar F2 saha/performance
durumu **PARTIAL** kalır. Çıkarılabilir USB/SD fiziksel olarak yoksa #1071 ve
#1072'nin removable tarafı `DEVICE-REMOVABLE-PENDING` olarak bekler; bu, CODE
PASS'i engellemez ama **SAHADA DOĞRULANDI** demeyi engeller.

---

## F6 · Ses Deneyimi / DSP Otoritesi

**Durum: CODE PASS / DEVICE PENDING** (kod kapanışı: 2 Eylül 2026)

F0 playback otoritesine, `volumePolicy`ye, `duckPolicy`ye ve `sourceCoordinator`a
DOKUNULMADI. F6 yalnız **ses rengi** katmanıdır.

### F6 öncesi ölçülen gerçek

Repo denetiminde şu bulundu ve F6'nın gerekçesi budur:

- Uygulamada **hiçbir `AudioEffect` yoktu** (`Equalizer` · `LoudnessEnhancer` ·
  `Virtualizer` üretim kodunda hiç kullanılmıyordu).
- `audioService.ts` bir **Web Audio** DSP zinciri kuruyordu (10 bant EQ ·
  kompresör "AGC" · Haas gecikmesi · StereoPanner · masterGain · SVC).
- Ama üretimde `connectSource()` **hiç çağrılmıyordu** → zincire hiçbir ses
  kaynağı bağlı değildi. Kanonik oynatma F0 gereği native ExoPlayer'dır ve
  Web Audio zincirini **bypass eder**.
- Sonuç: Ayarlar'daki "Crystal Cabin DSP", "Akıllı Ses Dengeleme (AGC)",
  "Sürücü Odaklı Ses" ve "Hıza Bağlı Ses" anahtarları **duyulur hiçbir şeyi
  değiştirmiyordu**. Bu, capability-honesty kuralının açık ihlaliydi ve
  F6'da ürün yüzeyinden KALDIRILDI.
- `audioService.setSvcBaseSystemVolume` de hiç çağrılmıyordu → SVC'nin
  `CarLauncher.setVolume` ile `STREAM_MUSIC` sistem sesine yazan yolu **ölü**
  durumdaydı. F6 bu yolu canlandırmadı (F0'ın "STREAM_MUSIC hack'i yok"
  invaryantı korundu).

### Kanonik DSP zinciri

```text
decoded PCM (ExoPlayer)
  → CarosBalanceAudioProcessor        (denge + güvenlik preamp'i · zincir içi)
  → DefaultAudioSink
  → [audio session] Equalizer         (EQ · ses rengi)
  → [audio session] LoudnessEnhancer  (bounded loudness)
  → ExoPlayer volume = userVolume × duck   (F0 · DEĞİŞMEDİ)
  → output
```

Kaynak normalizasyonu (`volumePolicy.sourceNormalization`) F0'da açılmış bir
**alan olarak duruyor ve F6'da BESLENMEDİ**: elimizde ölçülmüş LUFS/ReplayGain
metadata'sı yok, uydurulmuş bir normalizasyon değeri yazmak yasak. İkinci bir
normalizasyon sistemi de KURULMADI.

### Otorite sınırı

`AudioExperienceAuthority` şunların sahibidir: EQ durumu · preset · loudness ·
denge · DSP yetenek gerçeği · güvenlik (headroom) kazancı · bypass kararı.

Şunların sahibi **değildir** ve onlara yazmaz: playback truth · kullanıcı sesi ·
ducking · kaynak devri. Bu sınır `regression.guards` içinde import grafı
kilidiyle korunur.

### Yetenek dürüstlüğü

| Yetenek | Kaynak | Not |
|---------|--------|-----|
| `supportsEqualizer` · `eqBandCount` · frekanslar · aralık | `Equalizer` (cihaz) | Bant sayısı ARTIRILMAZ; frekansı bilinmeyen bant sayılmaz |
| `supportsLoudness` · tavan | `LoudnessEnhancer` | Ürün tavanı 6 dB; cihaz izin verse de aşılmaz |
| `supportsBalance` | uygulama ses zinciri | İşlemci kurulu; akış formatı ayrı GÖZLEMdir |
| `supportsFader` | — | **DAİMA false** (`stereo_output_only`) — sahte ön/arka kanal yok |
| `supportsVirtualizer` | `Virtualizer` | Yalnız RAPORLANIR; F6'da kontrolü YOK |
| `supportsHardwareDsp` | `AudioEffect.queryEffects` | **DERIVED** — AOSP dışı implementor; kesin donanım iddiası değil |

### Güvenlik (gain) modeli

`headroomDb = -min(12, maxPositiveBand + 0.25·diğerPozitifler + 0.5·loudness)`

Deterministik, sınırlı ve **kullanıcı sesinden ayrı**. Denge yalnız uzak kanalı
kısar; hiçbir kanal 1.0 üstüne çıkarılmaz → denge tek başına clipping üretemez.
Örnek ölçeklemesi tavanda **sature** olur (wrap-around yok).

### Gözlemlenebilirlik

Yeni LAB ekranı AÇILMADI (ekran enflasyonu yasağı). Mevcut `media-authority`
ekranı tek kartla GENİŞLETİLDİ: `17 · Ses Deneyimi / DSP (F6)` — yetenek ·
session/kuşak · attach durumu · bypass gerekçesi · istenen ↔ uygulanan bant
kazançları · güvenlik payı · kanal kazançları · yazım/birleştirme/gecikme
sayaçları · attach/apply düşüşleri · kalıcılık sayaçları. Salt-okunur; hiçbir
probe/apply TETİKLEMEZ.

### Kod kapanış kanıtı

- `musicF6AudioExperience` 49 test · `musicF6AudioSurface` 12 test · PASS.
- İlgili Music paketi (F1–F6 + LAB): 10 dosya / 322 test PASS.
- `regression.guards`: 828 test PASS (3 yeni F6 kilidi dâhil).
- TypeScript `tsc -b` ve değişen dosya lint'i: PASS.
- Android `compileDebugJavaWithJavac` ve `CarosAudioGainTest`: PASS.

### Saha kabulü — açık maddeler

Kütük **#1090–#1099** gerçek cihazda ölçülene kadar F6 saha durumu
**PENDING** kalır. Özellikle #1091 (duyulur EQ), #1092 (fail-safe bypass) ve
#1094 (session değişiminde yeniden bağlanma) geçmeden F6 "çalışıyor" diye
SUNULMAZ.

### Açık borç (F6 kapsamı dışında bırakıldı)

1. **Kaynak normalizasyonu ölçülmedi** — LUFS/ReplayGain kanıtı olmadığı için
   `sourceNormalization` nötr (1.0) bırakıldı.
2. **SVC (hıza bağlı ses)** F6'da uygulanmadı; eski karşılıksız anahtar
   kaldırıldı. Yeniden yapılacaksa kanonik yolu `volumePolicy.speedCompensation`
   alanıdır — ikinci bir gain otoritesi değil.
3. **`audioService.ts` hâlâ duruyor**: TTS/Mavi hattı `duckMedia`/`unduckMedia`
   çağırıyor. Bu çağrılar Web Audio masterGain'ini kısar ve o zincirde kaynak
   olmadığı için bugün **etkisizdir**; kanonik ducking `duckPolicy` +
   `CarosAudioFocusManager` tarafından yapılır. Bu ölü yolun temizliği ayrı bir
   atomik tur olarak açık borçtur (F6'da dokunulmadı — ses hattında gereksiz
   risk alınmadı).
4. **Virtualizer** yalnız raporlanıyor; kontrolü yok.


---

## F6.1 · Ölü Ses Yolu Temizliği / Tek Duck Otoritesi

**Durum: CODE PASS / DEVICE PENDING** (kod kapanışı: 2 Eylül 2026)

F6 DSP mimarisine DOKUNULMADI. Bu tur yalnız F6 raporunda **açık borç 3** olarak
bırakılan ölü ses yolunu kapatır.

### Ölçülen gerçek (F6.1 öncesi)

- `audioService.ts` bir Web Audio zinciri kuruyordu; üretimde `connectSource()`
  hiç çağrılmadığı için o zincire **hiçbir ses kaynağı bağlı değildi**.
- `duckMedia()` / `unduckMedia()` o zincirin `masterGain`'ini kısıyordu →
  **duyulur hiçbir etkisi yoktu**. Yani TTS · Mavi · klip · dinleme sırasında
  müzik **gerçekte kısılmıyordu**.
- Üretim çağrı sayımı: `initAudio · connectSource · setEqBand · setSvcEnabled ·
  setAGCEnabled · setDriverFocus · notifySpeed · setSvcBaseSystemVolume` →
  **0 üretim çağrısı**. Yalnız `duckMedia/unduckMedia` (5 modül) ve
  `theaterModeService`'in ses profili çağrısı canlıydı; ikisi de karşılıksızdı.
- **Kanonik `duck()` kapısının üretimde HİÇ çağıranı yoktu** — duck politikası
  vardı, ama hiçbir şey onu kullanmıyordu.

### Kanonik duck zinciri (F6.1 sonrası)

```text
TTS · Mavi · klip · dinleme penceresi
  → duckRequest.requestDuck(reason)        (adaptör · token taşır · durum TUTMAZ)
  → mediaCommandGateway.duck(reason)       (JS politika sahibi · duckPolicy)
  → nativeAuthorityBridge 'duck'
  → CarosPlaybackBridge
  → CarosAudioFocusManager.duck            (nested · token · en agresif kazanır)
  → CarosPlaybackService.applyEffectiveVolume   (userVolume × duck — TEK uygulama)
```

Konuşma kanalı → duck sebebi eşlemesi saf ve deterministiktir:
`SAFETY`/`HAZARD` → `SAFETY` · `NAVIGATION` → `NAVIGATION` ·
`ASSISTANT`/`STATUS`/`HARDWARE`/`NONE` → `MAVI`.

### Bulunan gerçek hata — ÇİFT DUCK

`mediaCommandGateway.applyVolume()` native `setVolume`'a **duck DAHİL** değeri
yazıyordu. Native `CarosPlaybackService.userVolume` alanı ise açıkça *duck
öncesi kullanıcı seviyesidir* ve duck çarpanını **ayrıca** uygular. Bu yol
üretimde ilk kez F6.1'de canlandığı için kusur sahada duyulmamıştı; canlanınca
NAVIGATION duck'ı sesi %30 yerine **%9**'a düşürürdü.

Düzeltme: kapı yalnız **duck öncesi kullanıcı sesini** yazar
(`nativeUserVolume()`); duck'ı **tek sahibi** uygular. `getEffectiveVolume()`
dürüst bir projeksiyon olarak kalır (LAB'da native değerle yan yana gösterilir —
ayrışma gizlenmez).

### Kaldırılanlar

- `src/platform/audioService.ts` — tümüyle silindi (Web Audio DSP · SVC · AGC ·
  driver-focus · `STREAM_MUSIC` yazıcısı). Kanonik ses rengi otoritesi
  `AudioExperienceAuthority`dir.
- `theaterModeService`'in ses profili sorumluluğu — karşılıksızdı; kaldırıldı.
  Güvenlik çıkışı (araç hareket edince Theater Mode kapanır) KORUNDU.
- `cleanup.audio.test.ts` — silinen ölü modülün AudioContext yaşam döngüsünü
  test ediyordu; karşılığı kalmadı. Yerine `regression.guards` içine **üç yeni
  kilit** eklendi (ölü yol geri gelemez · çağıranlar kanonik adaptörü kullanır ·
  adaptör ikinci otorite kuramaz).

### Gözlemlenebilirlik

Yeni LAB ekranı AÇILMADI. Mevcut `media-authority` → `4 · Ses / Ducking` kartı
iki alanla GENİŞLETİLDİ: `Duck isteği (istendi / bırakıldı)` ve
`Duck isteği düşen`. Kalıcı fark = açık kalmış duck (sızıntı); düşen sayacı
0'dan büyükse ducking o cihazda güvenilmez demektir. Salt-okunur.

### Kod kapanış kanıtı

- `musicF61DuckAuthority` 8 test PASS · `mediaAuthority` 67 test PASS
  (yeni çift-duck kilidi dâhil) · `mediaAuthorityLab` 29 test PASS.
- `regression.guards`: 831 test PASS (3 yeni F6.1 kilidi dâhil).
- Ses/asistan hattı paketi (10 dosya): 104 test PASS.
- TypeScript `tsc -b --force` ve değişen dosya lint'i: PASS.

### Saha kabulü — açık maddeler

Kütük **#1100–#1104**. Özellikle #1100 (duyulur ducking) ve #1101 (çift duck
yok) gerçek araçta geçmeden F6.1 "çalışıyor" diye SUNULMAZ.

### Açık borç (F6.1 kapsamı dışında bırakıldı — ölü DEĞİL, CANLI yollar)

1. **`CarLauncherPlugin.duckMusicForListening()`** dinleme sırasında
   `STREAM_MUSIC` sistem sesini DOĞRUDAN yazar. Bu ikinci bir duck yazıcısıdır
   ama **ölü değildir**: üçüncü taraf ses uygulamalarını da kısar ve mikrofon
   temizliği için saha doğrulamalıdır (2026-07-31 · 2026-08-30 notları).
   Kanonik hâle getirmenin doğru yolu TTS/STT için native
   `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` isteğidir — bu bir **native ses
   özelliğidir**, temizlik turu değil. Ayrı tur olarak açık.
2. **`radarEngine._fireVoiceAlert`** radar uyarısında sistem sesini geçici
   düşürür (`systemSettingsService.setVolume`). Aynı gerekçe: canlı yol,
   üçüncü taraf sesini de kapsıyor. (1) çözülmeden kaldırılmaz.
3. **Native duck reddi JS tarafına geri beslenmiyor**: `duck()` native `accepted:
   false` dönerse JS kaydı yine de duruyor → `getActiveDuckReasons()` uygulanmamış
   bir duck'ı raporlayabilir. LAB'da native ve gateway sebepleri **yan yana**
   gösterildiği için ayrışma gizli değildir; mutabakat ayrı bir tur.

---

## F7 · YouTube Deneyimi (F7.1 – F7.6)

**Durum: CODE PASS / DEVICE PENDING** (kod kapanışı: 2 Eylül 2026)

Gömülü YouTube/Piped sistemi **yeniden yazılmadı**. Değişen tek şey, o sistemin
kanonik Music otoritelerinin İÇİNE alınmasıdır.

### F7 öncesi ölçülen gerçek

| Alan | Durum |
|------|-------|
| Arama | ✅ ZATEN kanonik (`searchRegistry` → `pipedProvider` portu) |
| Çalma başlatma | ❌ `carosMediaLayer._playTrack` → `playYouTube()` **doğrudan** |
| Kaynak devri | ❌ `playYouTube` diğer backend'leri "ateşle-unut" durduruyordu |
| Transport | ❌ kapı KOŞULSUZ native köprüye gidiyordu; YouTube kapının DIŞINDAYDI |
| Duraklat düğmesi | ❌ `transport` hiç `PLAYING` olmuyordu → **duraklatılamıyordu** |
| Atlama düğmeleri | ❌ `supportsQueue=false` → **çizilmiyordu** (üst katmanda sıra VARKEN) |
| Kapak | ❌ `https` küçük resim native decode'a gidiyordu → **boş kapak** |
| Sürüşte video | ❌ **hiçbir hız/duruş kontrolü yoktu** (tam ekran, z-index 2147483000) |
| Gözlenen kuyruk | ✅ sağlayıcı timeline'ı yok → kanıt portu boş; **sahte kuyruk üretilmiyor** |
| Playlist | ✅ desteklenmiyor ve **iddia da edilmiyor** |

### Kanonik YouTube zinciri (F7 sonrası)

```text
Unified Search (pipedProvider portu)
  → searchSelection (PROVIDER_PATH)
  → carosMediaLayer.playMedia
  → mediaCommandGateway.playSource({ source: 'YOUTUBE' })
  → sourceCoordinator   (eskiyi DURDUR + DOĞRULA → prepare → start)
  → YouTube adaptörü    (observe · transport)
  → youtubeService      (IFrame player — YALNIZ kendi backend'i)
```

Transport (çal · duraklat · konum) aynı kapıdan geçer ve kapı yürütmeyi
**backend sahibine** dağıtır (`BackendTransport`). Sonraki/önceki, sıranın
sahibine göre yönlendirilir: backend timeline'ı varsa native yol, yoksa üst
katman sırası — her iki hâlde de her parça yine kapıdan başlar.

### Alt turlar

- **F7.1 — Kanonik oynatma/transport.** `BackendTransport` · `observe()` ·
  `getAdapter()` sözleşmesi; kapı native olmayan backend'i sahibine dağıtır;
  transport sunmayan backend `unsupported_capability` ile REDDEDİLİR.
  `playYouTube` artık kaynak devri YAPMAZ.
- **F7.2 — Sürüşte video kapısı.** `videoSafetyPolicy` (SAF): duruş
  KANITLANMADAN görüntü açılmaz (`ALLOWED` · `BLOCKED_MOVING` ·
  `BLOCKED_SPEED_UNKNOWN`, histerezis 1/3 km/h). **Kapı SESE DOKUNMAZ** — müzik
  çalmaya devam eder; gerekçe kullanıcıya GÖSTERİLİR ve sesli komut da sahte
  onay vermez.
- **F7.3 — Kuyruk-farkında atlama (tek giriş).** Sıra ya backend'in ya üst
  katmanındır; ikisi de yoksa düğme ÇİZİLMEZ. Ekran · split · theater ·
  donanım/bildirim tuşları AYNI girişten geçer.
- **F7.4 — Sağlayıcı (uzak) kapak.** `http(s)` kimlik GEÇİRİLİR (`REMOTE`);
  native decode çağrılmaz, disk/bellek katmanına yazılmaz — "önbelleklendi"
  İDDİA EDİLMEZ.
- **F7.5 — IFrame transport sunumu.** IFrame'in KENDİ `PLAYING` olayı bu
  backend için ulaşılabilir en yüksek kanıttır ve transporta yansır. Native
  yolun "doğrulanmamış playing ≠ PLAYING" kuralı **gevşetilmedi**.

### Kod kapanış kanıtı

- `musicF71YouTubeAuthority` 7 · `musicF72VideoSafety` 8 ·
  `musicF73QueueAwareTransport` 13 · `musicF74RemoteArtwork` 5 test PASS.
- Music/media paketi (26 dosya): **525 test PASS**.
- `regression.guards`: **840 test PASS** (F6.1 · F7.1 · F7.2 · F7.4 · F7.5 · F7.6 kilitleri dâhil).
- TypeScript `tsc -b` ve değişen dosya lint'i: PASS.

### Saha kabulü — açık maddeler

Kütük **#1105–#1116**. Özellikle #1105 (kanonik başlatma · tek audible backend),
#1107 (sürüşte video kapalı) ve #1109 (duraklat çalışıyor) geçmeden F7
"çalışıyor" diye SUNULMAZ.

### F7.6 — Sağlayıcı kuyruğu + dinleme oturumu (KARAR VERİLDİ, UYGULANDI)

**Ürün kararı (2026-09-02): Seçenek 1 — SAME-PROVIDER.** Kanonik `PlayQueue`
tek `SourceClass` taşımaya DEVAM EDER; kuyruk **seçilen parçanın kaynak
sınıfıyla sınırlanır**. Karışık-sağlayıcı `PlayQueue` (girdi-başına kaynak)
modeli KURULMADI — devir/uzlaştırma semantiği değişmedi.

#### Ölçülen kusur (F7.6 öncesi)

`carosMediaLayer` içinde `_queue` · `_qIndex` · `_qRevision` adında **mutable
bir sıra** vardı. Kanonik `PlayQueue` yalnız KÜTÜPHANE seçimleri için
kuruluyordu → sağlayıcı tarafında **ikinci bir desired-queue sahibi** doğuyor,
`ListeningSession` hiç başlamıyordu (Cross-Domain §1: one domain = one
authority).

#### Sonrası — kanonik zincir

```text
Arama sonucu / sesli seçim
  → buildProviderQueueContext   (SAF · same-provider sınırı · excludedIds)
  → PlayQueue                   (tek DesiredQueue authority)
  → ListeningSession            (tek oturum authority)
  → MediaCommandGateway → sourceCoordinator → backend → CommandTruth
```

- `carosMediaLayer`'da kalan tek şey **sunum/yönlendirme önbelleğidir**
  (`entryId → UnifiedTrack`): sıra TUTMAZ, imleç TUTMAZ, karar KAYNAĞI DEĞİLDİR.
- Sonraki/önceki `advanceQueue` üzerinden kanonik imleci taşır ve pencereyi
  kapıdan yeniden yazar; **F7.3'te kurulan tek giriş korunur**, ikinci mekanizma
  eklenmemiştir. Kuyruk sonunda **sarma yoktur** — `playQueue.advance` dürüstçe
  reddeder.
- "Kaldığın yerden devam" anlık görüntüsü kanonik kuyruktan **türetilir**;
  kalıcı kayıt canlı gerçek değildir (Cross-Domain §13) ve PLAYING iddia etmez.
- `alignUiQueueIndex` / `getUiQueueView` kanonik imleç ve görünüm üzerinde
  çalışır — katmanın kendi revizyonu/uzunluğu/imleci ARTIK YOKTUR.

#### Same-provider kuralının sınırları

- Sınır **ranking'den SONRA** uygulanır: kullanıcının gördüğü sıra değişmez.
- Dışarıda kalan satırlar **sessizce düşürülmez**: `excludedIds` ile sayılır ve
  LAB'da `Sağlayıcı sınırı (F7.6)` alanında görünür.
- Radyo AYRI semantiktir (canlı yayın, seek/süre yok) → `INTERNET_RADIO` kaynak
  sınıfı ve `RADIO` niyeti taşır; şarkı kuyruğuna karışmaz.
- Tanınmayan sağlayıcıya kaynak sınıfı **uydurulmaz** (`null` → kuyruk kurulmaz,
  parça yine kendi kanonik ön kapısından denenir).

#### Dürüstlük kapıları (değişmedi)

Desired kuyruk kurulması **ObservedQueue kanıtı üretmez**; YouTube/Spotify
gerçek timeline sunamadığı için gözlem `UNAVAILABLE + gerekçe` kalır. Kuyruk
DÜZENLEMESİ (`addToQueue` · `playNext` · `reorder`) bu kaynaklarda hâlâ
`unsupported_capability` ile REDDEDİLİR — yalnız **gezinme** meşrudur
(`supportsDesignatedItemStart`).

#### Kod kapanış kanıtı (F7.6)

- `musicF76ProviderQueueSession` **15 test PASS**.
- `regression.guards` **840 test PASS** (F7.6 kilitleri dâhil: medya katmanı
  kuyruk otoritesi değildir · PlayQueue/ListeningSession tek otorite · UI ve
  sağlayıcı kanonik kuyruğu doğrudan mutasyona uğratamaz).
- Full unit suite: **791 dosya / 17.518 test PASS** · production build **PASS**.
- Native build/test KOŞULMADI — F7.6 tamamen TypeScript; Java DEĞİŞMEDİ.
- Saha kabulü: kütük **#1113–#1116** (🔴 cihazda test edilmedi).

---

## F8 · Sürüş-Farkında Müzik Zekâsı

**Durum: CODE PASS / DEVICE PENDING** (kod kapanışı: 2 Eylül 2026)

F8, CarOS Music'i sıradan bir çalardan ayıran katmandır: **aracın gerçek
bağlamından** yararlanır, ama bunu kanıta bağlı ve fail-closed yapar. Bir
"AI DJ" DEĞİLDİR — LLM yoktur, bulut yoktur, "ruh hâlini biliyorum" iddiası
yoktur.

### Ölçülen başlangıç durumu (F8 öncesi)

| Alan | Durum |
|------|-------|
| Sürüş kipi | ✅ VAR — `smartDrivingEngine.detectDrivingMode` (1/20 km/h bandı) |
| Kanonik hız | ✅ VAR — `UnifiedVehicleStore.speed` (`null` = ölçülemiyor) |
| Yolculuk | ✅ VAR — `tripLogService.getTripSnapshot` (süre · mesafe) |
| Rehberlik | ✅ VAR — `navigationService.isGuidanceActive` + `distanceSource` |
| Dinleme bağlamı | ✅ VAR — F3 `ListeningSession` (niyet · queueId · kaynak) |
| Geçmiş | ✅ VAR ama SINIRLI — `recentlyPlayed` (12 satır, öneri otoritesi DEĞİL) |
| Müzikte bağlam kullanımı | ❌ YALNIZ satır sayısı kısıtlaması (`drivingMode === 'driving'`) |
| Tercih/alışkanlık kanıtı | ❌ YOK |
| Bağlam → müzik kararı | ❌ YOK |

### Mimari karar — F8 NEYİN sahibidir

F8 **yalnız iki şeyin** sahibidir: **bağlam sınıflandırması** ve **sınırlı yerel
tercih kanıtı**; bunlardan bir **karar** üretir. Sahiplenmediği her şey yerinde
kalır:

```text
UnifiedVehicleStore (hız) · tripLogService (yolculuk) · navigationService (rehberlik)
   └─ salt okuma ─→ drivingContextSources
                      └─→ drivingContextModel (SAF)  ─┐
                                                      ├─→ musicIntelligenceModel (SAF)
   preferenceEvidence (sınırlı · yerel · gizli) ──────┘        │
                                                              ▼
                                                   HOLD · SUGGEST · AUTO_RESUME
                                                              │
                        kullanıcı onayı ──────────────────────┘
                                    └─→ F3 `startLibraryListening` / F7.6 kanonik devam
```

- **Playback truth F0'ın**, kuyruk/oturum F3'ün, arama F5'in, sağlayıcı F7'nin
  KALIR. F8 hiçbirini sahiplenmez, hiçbirine doğrudan komut göndermez.
- **Sürüş durumu için ikinci otorite YOKTUR**: eşikler `detectDrivingMode` ile
  aynı banttadır; F8 yalnız histerezis ekler ve sınıflandırmayı MÜZİK için yorumlar.
- **Yeni global scheduler/god object YOKTUR**: F8 **timer kurmaz, polling yapmaz**.
  Tek gözlem dikişi kanonik `subscribeListeningSession`dır; lifecycle SystemBoot'un
  (`music-intelligence` cleanup kaydı).

### Fail-closed karar politikası (sıra önemlidir)

1. **Ses çıkıyorsa** → `HOLD` (`already_playing`). Çalan müziğe ASLA karışılmaz.
2. **Açık kullanıcı niyeti varsa** (son 20 dk) → `HOLD` (`explicit_user_intent`).
   Açık niyet, geri yükleme DIŞINDA başlayan her dinleme oturumundan türetilir —
   F5/F7 modüllerine F8 çağrısı eklenmez (ters bağımlılık kurulmaz).
3. **Bağlam kanıtsızsa** (hız ölçülemiyor / kova `UNKNOWN`) → `HOLD`.
4. **Kanıt yok/zayıfsa** → `HOLD`. Öneri UYDURULMAZ.
5. Aksi hâlde `SUGGEST`; **yalnız** yolculuk başlangıcı + `HIGH` güven + açık
   oturum yok + ≥3 korunmuş dinleme varsa `AUTO_RESUME`.

`AUTO_RESUME` bile kendiliğinden ses BAŞLATMAZ: kullanıcı çal tuşuna bastığında
*ne* çalınacağını belirler. Kullanıcı dokunmadan müzik başlamaz.

### Tercih kanıtı — sınırlı ve gizlilik-öncelikli

- Anahtar: `${kova}|${niyet}|${kütüphane referansı ?? kaynak sınıfı}`.
- Kova: `${PARKED|CITY|HIGHWAY}_${DAY|NIGHT}` — iki eksen de kanıtlı değilse
  `UNKNOWN` ve **kanıt YAZILMAZ**.
- **"Başlatıldı" tercih kanıtı DEĞİLDİR**; yalnız ≥90 sn korunan dinleme sayılır
  (açıp hemen kapatmak bir tercih değil, bir hatadır).
- Üst sınır **48 satır (LRU)** · TTL **45 gün** · kullanıcı silebilir.
- **SAKLANMAZ:** parça/albüm/sanatçı adı · URI · kapak · arama sorgusu ·
  konuşma içeriği · konum · rota · hedef · sağlayıcı içerik kimliği (video id).
  Sağlayıcı tarafında yalnız KAYNAK SINIFI tutulur → tek dürüst eylem kanonik
  "kaldığın yerden devam"dır, yeni içerik uydurulmaz.
- Şema testle kilitlidir: kalıcı satıra yeni alan eklenirse kilit DÜŞER.

### Kullanıcı yüzeyi

Keşif ekranında **tek** öneri satırı (`MusicIntelligenceCard`) ve büyük çal
tuşunun bağlam-farkında davranışı. Kullanıcıya **skor · güven · kova · gerekçe
GÖSTERİLMEZ** (bunlar yalnız LAB'dadır); metin yalnız yolculuk bağlamını söyler
("Uzun yol için", "Yola çıkmadan"). Kanıt yoksa satır **çizilmez**.

### CAROS LAB

Yeni ekran AÇILMADI: mevcut `media-authority` ekranına **18 · Sürüş-Farkında
Müzik (F8)** kartı eklendi — bağlam kanıtı · eksik sinyal · güven · tercih
kanıtı · en güçlü aday · son karar · bastıran kapılar · açık niyet yaşı ·
sayaçlar · karar latency'si. LAB **karar üretmez** ve okuması üretim
histerezisini ilerletmez (`peekDrivingContext`).

### Kod kapanış kanıtı (F8)

- `musicF8DrivingIntelligence` **17 test PASS**.
- `regression.guards` **846 test PASS** (6 yeni F8 kilidi dâhil).
- Hedefli music/media/LAB/boot paketi (12 dosya): **1.135 test PASS**.
- TypeScript ve değişen dosya lint: PASS.
- Full unit suite: **792 dosya / 17.541 test PASS** · production build **PASS** (8m 15s).
- Native build/test KOŞULMADI — F8 tamamen TypeScript; Java DEĞİŞMEDİ.
- Saha kabulü: kütük **#1117–#1122** (🔴 cihazda test edilmedi).

### Bilinçli kapsam dışı (açık borç)

- **Kontak/yolculuk başlangıcında UI olmadan otomatik çalma YOK.** Böyle bir
  davranış her zaman açık bir arka plan aktörü gerektirir; F8 timer/polling
  kurmama kararını bozmamak için bunu YAPMADI. Kullanıcı çal tuşuna bastığında
  bağlam-farkında seçim yapılır.
- **Mavi entegrasyonu bu fazda YAPILMADI.** F8'in kararı saf ve okunabilir
  olduğu için Mavi ileride aynı katmanı *requester* olarak kullanabilir; bu tur
  Mavi mimarisine DOKUNMADI.

---

## F9 · Mavi Music Companion

**Durum: CODE PASS / DEVICE PENDING** (kod kapanışı: 2 Eylül 2026)

Mavi'nin müzik tarafı **yeniden yazılmadı**; F0–F8'de kurulan kanonik
otoritelere BAĞLANDI. Mavi burada **requester**dır (Cross-Domain §12): ikinci
playback · kuyruk · arama · sıralama · öneri otoritesi KURULMADI.

### F9 öncesi ölçülen gerçek

| Hat | Durum |
|-----|-------|
| `PLAY_MEDIA` / `PAUSE_MEDIA` | ✅ CANONICAL — `playWithResult` → `CommandTruth` |
| `MEDIA_NEXT` / `MEDIA_PREV` | ❌ **DUPLICATE/BYPASS** — `mediaService`e DOĞRUDAN iniyordu; F7.3 kuyruk-farkında girişi ATLANIYORDU |
| `PLAY_MUSIC_SEARCH` / `_QUERY` | ⚠️ **UNSAFE** — `playByQuery` bir parça döndürünce KOŞULSUZ "<başlık> çalınıyor" |
| `OPEN_MUSIC` (kaynak söylendi) | ⚠️ **UNSAFE** — `play()` ateşle-unut + koşulsuz "Müzik açılıyor" |
| `_openEmbeddedMusic` | ⚠️ **UNSAFE** — `resumeLastMedia()` → koşulsuz "Müzik açılıyor" |
| `playByVoiceQuery` (F5.1) | ✅ CANONICAL — sıralama · kanıt eşiği · AMBIGUOUS/UNAVAILABLE dürüstlüğü |
| `maviMediaAuthorityPort` | ✅ CANONICAL — `CommandTruth → HonestClaim` (yalnız TAŞIMA) |
| Kuyruk sesli komutları | ❌ **MISSING** |
| Bağlamsal istek (F8) | ❌ **MISSING** |
| Kaynak niteleyicisi dürüstlüğü | ⚠️ sessizce kanonik en üste düşüyordu |
| Tek `MusicIntent` sözleşmesi | ❌ **MISSING** — niyetler `commandParser`/executor içine dağılmıştı |

### Kanonik zincir (F9 sonrası)

```text
utterance
  → musicIntentResolver (SAF · YEREL · bulutsuz)
  → MusicIntent (tek sözleşme)
  → musicIntentRouter
      ├─ TAŞIMA      → MediaCommandGateway (F0)  /  next-previous: F7.3 kuyruk-farkında giriş
      ├─ ARAMA       → searchOnce (F5) → selectSearchResult (F5) → F3 oturum / F7.6 sağlayıcı kuyruğu
      ├─ KUYRUK      → listeningSessionRuntime + PlayQueue (F3)
      ├─ DEVAM       → kanonik resume (F3/F7.6)
      ├─ BAĞLAMSAL   → F8 evaluateForExplicitRequest (SALT OKUMA) → applyIntelligenceCandidate
      └─ SES         → gateway setUserVolumePercent / setMuted
  → MusicIntentOutcome (kanonik kanıt + iddia sınıfı)
  → musicIntentSpeech (SAF) → söylenen cümle
```

### İddia ↔ kanıt kilidi (F9'un çekirdeği)

| Kanıt | İddia sınıfı | Söylenebilir |
|-------|--------------|--------------|
| `VERIFIED` | `CONFIRMED` | "çalıyor · durdurdum · geçtim" |
| `ACCEPTED_UNVERIFIED` | `ATTEMPTED` | "başlatmayı deniyorum" — **"çalıyor" DEĞİL** |
| `AMBIGUOUS` | `NEEDS_CHOICE` | "hangisi?" (hiçbir şey başlatılmadı) |
| `REJECTED · UNAVAILABLE · FAILED · NOT_ATTEMPTED` | `DECLINED` | neden + varsa teklif |

`claimIsHonest()` bu sözleşmeyi testte kilitler: `CONFIRMED` dışında hiçbir
derece tamamlanmış eylem cümlesi kuramaz. Teknik neden kodu (`unsupported_
capability` …) **kullanıcıya OKUNMAZ**; LAB'da kalır.

### Ürün kararları

- **Kaynak niteleyicisi = FİLTRE.** Kanonik sıralama (F5) DEĞİŞMEZ; kullanıcı
  kaynağı söylediyse yalnız o kaynağın satırları kalır. Sonuç yoksa **sessiz
  geçiş YOK** → dürüst cevap + alternatif teklifi.
- **Belirsizde kör autoplay YOK.** F5'in kendi kanıt eşiği (`isConfidentEnough
  ToAutoPlay`) kullanılır; F9 kendi sıralamasını KURMAZ.
- **Açık istek F8'in "istenmemiş otomasyon" kapılarını aşar, KANIT kapısını
  aşmaz.** Kanıt yoksa "sana uygun bir şey buldum" DENMEZ.
- **Ruh hâli/tempo ölçümü YOKTUR** → "daha sakin/hareketli" istekleri dürüstçe
  `mood_evidence_unavailable` döner. Sahte bir mood motoru KURULMADI.
- **Sorgusuz "müzik aç" rastgele bir şey çalmaz** → kanonik devam yolu.
- **Kuyrukta olmayan işlem UYDURULMAZ**: `CLEAR_UPCOMING` / sesli
  `ADD_TO_QUEUE` kanonik `PlayQueue`da yoktur → dürüstçe reddedilir.

### Düzeltilen gerçek kusurlar

1. **Sesli atlama sağlayıcı kuyruğunda düşüyordu** — `commandExecutor` F7.3
   girişini atlıyordu. Kanonik giriş artık `MediaCommandResult` döndürür
   (tek giriş korundu, yalnız kanıtı geri verir) ve executor oradan geçer.
2. **Üç ayrı koşulsuz "çalıyor/açılıyor" iddiası** kaldırıldı; hepsi kanıt
   derecesine bağlandı.

### Telemetri / LAB

Yeni ekran AÇILMADI: `media-authority` ekranına **19 · Mavi Müzik Niyeti (F9)**
kartı eklendi — niyet · rota · komut gerçeği · iddia sınıfı · teknik neden kodu ·
kaynak niteleyicisi · sessiz-geçiş-yapılmadı sayacı · netleştirme · bağlam kanıtı ·
kuyruk sonuçları · bayat tur · **iddia uyuşmazlığı (0 olmalı)** · latency.
Söylenen metin · sorgu · parça adı telemetriye YAZILMAZ.

### Kod kapanış kanıtı (F9)

- `musicF9MaviMusicCompanion` **15 test PASS**.
- `regression.guards` **853 test PASS** (7 yeni F9 kilidi dâhil).
- Hedefli music/media/voice paketi (13 dosya): **1.073 test PASS**.
- Yeniden bağlanan kilitler (kaldırılmadı): `mediaSkipNoFakeAck` ×4 ·
  `regression.guards` `_playMusicInAppOrFallback` ×1 · `mediaAuthorityLab` kart
  listesi 18→19.
- TypeScript ve değişen dosya lint: PASS.
- Full unit suite: **793 dosya / 17.563 test PASS** · production build **PASS** (5m 6s).
- Native build/test KOŞULMADI — F9 tamamen TypeScript; Java DEĞİŞMEDİ.
- Saha kabulü: kütük **#1123–#1129** (🔴 cihazda test edilmedi).

### Bilinçli kapsam dışı (açık borç)

- **Mood/tempo tabanlı öneri YOK** — akustik ölçüm kaynağı repoda yoktur;
  uydurmak yerine dürüstçe reddedilir.
- **Çalma listesi (playlist) niyeti** sözleşmede vardır ama kanonik playlist
  modeli olmadığı için arama yoluna düşer.
- **`commandParser` eski müzik niyetleri** yerinde bırakıldı; F9 sözleşmesi
  onların ÜSTÜNDE tek yürütme hattıdır. Parser'ın F9 sözleşmesine tam göçü
  ayrı bir turdur.

---

## F10 · Mood / Energy Intelligence

**Durum: CODE PASS / DEVICE PENDING — ANCAK KANIT KAYNAĞI BAĞLI DEĞİL**
(kod kapanışı: 2 Eylül 2026)

### ÖLÇÜLEN GERÇEK (bu fazın en önemli bulgusu)

| Kaynak | Elde edilebilen trait | Kanıt |
|--------|----------------------|-------|
| LOCAL (MediaStore) | **YOK** | `MediaStoreLibraryScanner` projeksiyonu: `_ID · TITLE · ARTIST · ALBUM · ALBUM_ARTIST · ALBUM_ID · DURATION · MIME_TYPE · RELATIVE_PATH · SIZE · DATE_MODIFIED · TRACK · GENERATION_MODIFIED`. **GENRE ve YEAR sorgulanmıyor; BPM zaten yok.** |
| YouTube / Piped | **YOK** | `pipedProvider`: başlık · yükleyen · süre · küçük resim. |
| Spotify | **YOK (bugün)** | `spotifyService` yalnız `/search` ve `/me/player/*` çağırıyor; `audio-features` (energy/tempo/valence) **çağrılmıyor**. |
| Radyo / diğer | **YOK** | canlı yayın; parça karakteri kavramı yok. |

**Sonuç:** F10 gerçek bir mood/energy ölçümü üzerine kurulamaz. Bu yüzden faz,
*ölçüm uydurmak* yerine **ölçüm geldiğinde hazır olan bir sözleşme** kurar ve
bugün yalnız AÇIKÇA ETİKETLİ zayıf türetimler kullanır.

### Kanıt modeli

`MusicTraitEvidence { energy · tempoBpm · mood · confidence · provenance ·
sourceId · observedAtMs · signals }`

Provenance gücü: `PROVIDER_METADATA > LIBRARY_METADATA > DERIVED_DURATION >
HEURISTIC_TEXT > NONE`. Zorlanan kurallar (çağıran atlayamaz):

- **BPM yalnız gerçek ölçümden** gelir (`mayCarryTempo`); süre/başlık BPM yazamaz.
- **Sezgisel/türetilmiş kanıt `LOW` tavanlıdır** (`MAX_HEURISTIC_CONFIDENCE`).
- **Birleştirme güveni YÜKSELTMEZ**; yalnız sinyal etiketleri birleşir.
- Değersiz kanıt `NONE`a düşer — sahte "var" iddiası yok.
- Modelde parça/sanatçı ADI TAŞINMAZ; yalnız etiket (`text:calm`, `duration:long`).

Bugün beslenen iki port: `DERIVED_DURATION` (uzun parça → sakin eğilimi) ve
`HEURISTIC_TEXT` (akustik/remix gibi yüksek seçicilikli sözcükler). Çelişen
ipuçları (ör. "Akustik Remix") kanıt ÜRETMEZ.

### Seçim (fail-closed)

- `CALMER` / `MORE_ENERGETIC` **GÖRECELİDİR**: çalan parçanın kanıtı yoksa
  `NO_REFERENCE` → sahte kıyas YOK.
- Fark en az `RELATIVE_ENERGY_MARGIN` (0.20) olmalı — algılanmayan fark
  "daha sakin açtım" dedirtmez.
- `FOR_DRIVE` / `NIGHT_CALM` bağlam hedeflidir (referans gerekmez) ama hedef
  banda uzak aday "uygun" SAYILMAZ.
- Kanıtsız adaylar **sessizce düşmez**: sayılır ve LAB'da görünür.
- Seçim güveni referans ile adayın **ZAYIF** olanıdır.

### Kanonik yürütme

```text
"daha sakin bir şey aç"
  → F9 musicIntentResolver → MusicIntent
  → musicIntentRouter.runTraitDirected
  → F10 traitRuntime.selectTrackByTrait  (YALNIZ kimlik döndürür)
  → F3 startLibraryListening → PlayQueue + ListeningSession
  → MediaCommandGateway → F0
```

F10 **çalma başlatmaz**, kuyruğa/kütüphaneye/F8 tercih kanıtına **yazmaz**,
timer kurmaz. Sağlayıcıya/native'e doğrudan komut YOKTUR; gömülü YouTube
deneyimi değişmemiştir.

### Konuşma dürüstlüğü

Kanıt gücü cümlenin gücünü belirler:
`trait_selected_confident` → "Daha sakin bir şey açıyorum."
`trait_selected_tentative` → "Daha sakin olabilecek bir şey deneyeyim."

**Bugün kesin dal ULAŞILAMAZDIR**: sezgisel kanıt `LOW` tavanlı olduğu için
`allowsConfidentClaim` daima `false` döner. Bu bilinçlidir ve LAB'da
`Kesin dil · temkinli dil` sayacıyla görünür.

### CAROS LAB

Yeni ekran AÇILMADI: `media-authority` → **20 · Karakter / Enerji Kanıtı (F10)**
— çalanın kanıt kökeni/güveni/enerjisi · istenen yön · seçim sonucu · fail-closed
neden kodu · seçim güveni · aday/elenen sayıları · kanıt kökeni dağılımı ·
kesin/temkinli dil sayacı · önbellek (satır/isabet/ıska) · latency · uyuşmazlık.

### Kod kapanış kanıtı (F10)

- `musicF10MoodEnergyIntelligence` **13 test PASS**.
- `regression.guards` **859 test PASS** (6 yeni F10 kilidi dâhil).
- Hedefli music/media paketi (11 dosya): **1.059 test PASS**.
- Yeniden bağlanan kilit (kaldırılmadı): `musicF9` mood reddi artık karakter
  yolundan gelir · `mediaAuthorityLab` kart listesi 19→20.
- Full unit suite: **794 dosya / 17.582 test PASS** · production build **PASS** (5m).
- Native build/test KOŞULMADI — F10 tamamen TypeScript; Java DEĞİŞMEDİ.
- Saha kabulü: kütük **#1130–#1135** (🔴 cihazda test edilmedi).

### AÇIK BORÇ — F10 "tamamlandı" SAYILAMAZ

Gerçek trait kaynağı bağlanana kadar bu faz yalnız **mimari olarak** hazırdır:
1. **MediaStore `GENRE`/`YEAR`** projeksiyona eklenmedi (native değişiklik +
   cihaz doğrulaması gerektirir).
2. **Spotify `audio-features`** çağrılmıyor (ağ bütçesi, oran sınırı ve
   sağlayıcı politikası ayrıca değerlendirilmeli).
3. **Sağlayıcı (YouTube/Piped)** hiçbir trait vermiyor — bu bir ürün sınırıdır.
Kütük **#1135** bu borcu açık tutar.

---

## F10.1 · Real Trait Evidence Closure

**Durum: CODE PASS — GERÇEK KANIT BAĞLANDI / SAHA BEKLİYOR**
(kod kapanışı: 2 Eylül 2026)

F10 mimarisi yeniden yazılmadı; #1135'teki boşluk KAPATILDI.

### 1 · Kaynak ölçümü (AVAILABLE / UNSUPPORTED / UNVERIFIED)

| Kaynak | Trait | Sonuç | Kanıt |
|--------|-------|-------|-------|
| LOCAL · MediaStore `GENRE` | tür | **AVAILABLE** (API 30+) | projeksiyona eklendi; API<30'da sorgulanmaz |
| LOCAL · MediaStore `YEAR` | yıl | **AVAILABLE** | projeksiyona eklendi |
| LOCAL · gömülü ID3 `TBPM` / Vorbis `BPM` | **BPM** | **AVAILABLE** | `androidx.media3` zaten bağımlılıkta; `MetadataRetriever` ile okunur |
| LOCAL · ses analizi (tempo/energy ölçümü) | — | **UNAVAILABLE** | yapılmıyor; `MEASURED_AUDIO` provenance KULLANILMIYOR |
| YouTube / Piped | — | **UNSUPPORTED** | yanıt yalnız başlık · yükleyen · süre · kapak |
| Spotify `audio-features` | — | **UNVERIFIED** | güncel sözleşme bu turda doğrulanamadı → varmış gibi DAVRANILMADI |
| Radyo · audius · jamendo · archive · stream | — | **UNAVAILABLE / UNSUPPORTED** | canlı yayın veya trait alanı yok |

### 2 · Kanonik güç sırası (F10.1 §2)

`MEASURED_AUDIO > PROVIDER_METADATA > EMBEDDED_METADATA > LIBRARY_METADATA
> DERIVED_DURATION > HEURISTIC_TEXT > NONE`

Modelde ZORLANAN kurallar (çağıran atlayamaz):
- **BPM yalnız** `MEASURED_AUDIO` · `PROVIDER_METADATA` · `EMBEDDED_METADATA`
  kaynaklarından. **Tür/yıl/süre/başlık BPM YAZAMAZ** (F10'da `LIBRARY_METADATA`
  BPM taşıyabiliyordu — F10.1 bunu SIKILAŞTIRDI).
- Sezgisel/türetilmiş kaynak `LOW` tavanlı.
- Birleştirme güveni **YÜKSELTMEZ**; yalnız güçlü provenance kazanır.
- Değersiz kanıt `NONE`a düşer.

### 3 · BPM truth

Gömülü etiket okunur, **dosya DECODE EDİLMEZ** (`MetadataRetriever`, kap
metadata'sı). 40–250 aralığı dışındaki değer bozuk etikettir → kanıt YOK.
Etiket yoksa `tempoBpm = null`. Tempo GERÇEKTİR; ondan türetilen **enerji bir
ÇIKARIMDIR** ve `MEDIUM` güvenle taşınır. **BPM'den ruh hâli ÜRETİLMEZ.**

### 4 · Energy / mood truth

- Tür (`GENRE`) yalnız **DESTEKLEYİCİ** kanıttır: `LOW` güven, **mood ÜRETMEZ**
  (F10.1 §6 — "rock → enerjik" kesinliği yoktur).
- Tanınmayan tür kanıt DEĞİLDİR ("Bilinmeyen Tür" diye kanıt yoktur).
- `MEASURED_AUDIO` yokken **HIGH** güvenli mood/energy ÜRETİLMEZ; bugün ulaşılan
  en yüksek seçim güveni `MEDIUM`dur (iki tarafta da gömülü BPM varsa).

### 5 · Önbellek / geçersizleştirme (§11)

Anahtar: `TRAIT_SCHEMA_VERSION | canonical id | generationModified`.
Dosya değişirse (yeni kuşak) veya şema sürümü artarsa eski satır KULLANILMAZ.
Gömülü okuma sonucu geldiğinde o parçanın satırları düşürülür. Okunmuş dosya
tekrar OKUNMAZ (etiketsizler `null` olarak işaretlenir). LRU 512 satır.
**İkinci bir MusicIndex kurulmadı** — tür/yıl F2 truth'unun parçasıdır ve trait
katmanı MusicIndex'i MUTATE ETMEZ.

### 6 · Sınırlar / performans

Gömülü okuma yalnız kullanıcı karakter isteği yaptığında çalışır; çalma yolunda
ve periyodik DEĞİLDİR. Toplu iş 24 dosya, dosya başına 1,5 sn zaman aşımı,
native tarafta ayrı arka plan havuzu (`mediaLibraryExecutor`) — UI thread'e
DOKUNULMAZ.

### 7 · LAB

`media-authority` → `20 · Karakter / Enerji Kanıtı (F10)` genişletildi:
**gerçek BPM** · kaynak yetenek tablosu (AVAILABLE/UNSUPPORTED/UNVERIFIED) ·
şema sürümü — mevcut provenance/güven/aday/elenen/önbellek/latency alanlarına ek.
Yeni ekran AÇILMADI.

### 8 · Kod kapanış kanıtı (F10.1)

- `musicF101RealTraitEvidence` **13 test PASS**.
- `regression.guards` **866 test PASS** (7 yeni F10.1 kilidi dâhil).
- Hedefli music/media paketi (12 dosya): **1.084 test PASS**.
- Full suite **3 parçada** (shard) temiz: 265+265+265 dosya / **17.602 test PASS**.
- Production build **PASS** (6m 42s) · `tsc -b --force` PASS · lint PASS.
- Native: `compileDebugJavaWithJavac` **PASS** · `testDebugUnitTest` **PASS** ·
  `assembleDebug` **PASS**.
- Saha kabulü: kütük **#1136–#1141** (🔴 cihazda test edilmedi).

### 9 · Bu turda yakalanan GERÇEK kusur

`peekReferenceEvidence` (LAB alanı) kanıtı `resolveTraitEvidence` ile
üretiyordu → **LAB okuması önbelleğe yazıyor ve üretim sayaçlarını
oynatıyordu**. F3.2'nin "LAB okuması salt-okunurdur" kilidi bunu yakaladı.
Saf `computeTraitEvidence` ayrıştırıldı ve kalıcı kilit eklendi.

### 10 · Açık kalan gerçek sınır

Sağlayıcı tarafı hâlâ kanıtsızdır (`UNSUPPORTED`/`UNVERIFIED`). Sağlayıcı
parçası çalarken karakter isteği kütüphane adaylarına düşer; kütüphanede kanıt
yoksa dürüstçe reddedilir. Kütük **#1141** bu sınırı açık tutar.
