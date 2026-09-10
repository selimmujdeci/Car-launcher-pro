/**
 * Capacitor plugin interface for CarLauncher native bridge.
 * Android implementation: CarLauncherPlugin.java
 */
import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { VehicleHALData } from './vehicleDataLayer/types';
import type { RawSttTelemetry } from './sttLatencyTelemetry';

export interface LaunchAppOptions {
  packageName?: string; // startActivity by package
  action?: string;      // startActivity by intent action
  data?: string;        // optional URI / data for the intent
  category?: string;    // optional standard category (e.g. android.intent.category.APP_MAPS)
}

/**
 * H-4 MCU donanım komutunun NATIVE sonucu (`CarLauncherPlugin.resolveMcuCommand`).
 *
 * `sent:true` YALNIZ paket CAN transportuna gerçekten yazıldığında gelir. Bu, ECU'nun
 * komutu KABUL ETTİĞİ anlamına GELMEZ — yalnız "hatta bırakıldı" kanıtıdır (araç
 * tarafı onayı bugün ölçülmüyor; kütükte açık borç).
 *
 * `sent:false` → `reason` makine-okur: `whitelist_rejected` (komut kodu whitelist'te
 * yok, paket üretilmedi) · `mcu_send_failed` (transport yok veya write başarısız).
 * Alan eksik/bozuk gelirse çağıran FAIL-CLOSED davranır (başarı VARSAYILMAZ).
 */
export interface NativeVehicleCommandResult {
  sent: boolean;
  reason?: string;
}

/**
 * Donanım komutu GERÇEKTEN hatta bırakıldı mı — TEK doğruluk yüklemi.
 *
 * ⚠️ Bilerek `bridge.ts` yerine BURADA durur: `nativeCommandBridge` de bu yüklemi
 * kullanır ve `bridge`i import etseydi obd/store/deepScan zinciri onun grafiğine
 * girerdi (bu tam olarak yaşandı: `soak.remoteCommand` testi yüklenemez oldu).
 * Sözleşme modülü bağımlılıksızdır → her iki yol da paralel kural üretmeden
 * aynı gerçeği kullanır.
 */
export function isNativeCommandSent(native: NativeVehicleCommandResult | null | undefined): boolean {
  return !!native && typeof native === 'object' && native.sent === true;
}

export interface NativeApp {
  name: string;
  packageName: string;
  className: string;
  isSystemApp: boolean;
  /** Base64 PNG data URI (96×96) — native taraftan gelirse emoji bypass */
  icon?: string;
}

export interface GetAppsResult {
  apps: NativeApp[];
}

export interface NativeDeviceStatus {
  btConnected: boolean;
  btDevice: string;      // connected BT device name (empty if none)
  wifiConnected: boolean;
  wifiName: string;      // SSID (requires ACCESS_FINE_LOCATION on API 26+)
  battery: number;       // 0–100
  charging: boolean;     // true when plugged in
}

/* ── OBD types ───────────────────────────────────────────── */

export interface OBDDevice {
  name: string;    // Bluetooth device display name
  address: string; // MAC address (XX:XX:XX:XX:XX:XX)
}

export interface OBDScanResult {
  devices: OBDDevice[];
}

export interface OBDConnectOptions {
  address: string;    // MAC address of the OBD adapter
  /**
   * SAE J1979 Mode 01 PID listesi — native taraf bu PID'leri ELM327'ye sırayla gönderir.
   * Boş bırakılırsa native kendi varsayılan setini kullanır.
   *
   * EV'de ICE PID'leri dahil etme: 0x0C/0x05/0x2F her biri 200 ms NO-DATA timeout
   * yiyor; 3 PID × 200 ms = 600 ms kayıp / döngü. ISO 15031-5 §6.3.3.
   *
   * Örnekler:
   *   ICE/Diesel: ['0x0D', '0x0C', '0x05', '0x2F', '0x11', '0x0F']
   *   EV:         ['0x0D']   ← sadece hız; batarya OEM-specific komutlarla
   */
  pids?: string[];
  /**
   * ELM327 AT SP (Set Protocol) protokol numarası.
   * '0' = otomatik (ATSP0, varsayılan), '6' = ISO 15765-4 CAN 11-bit/500k.
   * T507 gibi ATSP0'da başarısız olan adaptörler için retry denemesinde '6' zorla.
   */
  protocol?: string;
  /**
   * Bluetooth PIN kodu — cihaz eşleştirilmemiş (BOND_NONE) iken silent pairing için.
   * V-LINK, bazı ELM327 klonları: '0000' veya '1234'.
   */
  pin?: string;
  /**
   * Bağlantı taşıma katmanı.
   * 'classic' = Classic Bluetooth SPP/RFCOMM (varsayılan), 'ble' = Bluetooth Low Energy GATT,
   * 'tcp' = WiFi ELM327 (AP modu, address "ip:port" biçiminde — Patch 10).
   * Belirtilmezse native taraf mevcut Classic RFCOMM yolunu kullanır (geriye dönük uyumlu).
   */
  transport?: 'classic' | 'ble' | 'tcp';
}

/**
 * Fired by the native plugin when connection state changes AFTER initial connect.
 * (Initial connection result is signalled by connectOBD() resolve/reject.)
 */
export interface OBDStatusEvent {
  state: 'disconnected' | 'error';
  message?: string;
  /**
   * Patch 1 (obdStatus olay disiplini — reconnect fırtınası fix): native taraf obdStatus'u
   * ÜÇ farklı anlamda yayınlar. Eski native APK bu alanı hiç göndermez (geri-uyum: undefined
   * → 'link_lost' gibi davranılır).
   *   'link_lost'       — pollLoop sırasında RFCOMM/GATT beklenmedik koptu → GERÇEK kopma.
   *   'connect_failed'  — bir connectOBD() DENEMESİ başarısız oldu (zaten reject/catch zincirinde ele alınır).
   *   'user_disconnect' — bizim kendi disconnectOBD() çağrımızın onayı (kullanıcı eylemi veya
   *                       transport-fallback geçişi) — reconnect tetiklememeli.
   */
  reason?: 'link_lost' | 'connect_failed' | 'user_disconnect';
}

/**
 * Per-frame OBD data pushed by the native plugin.
 * A value of -1 means the vehicle does not support that PID (unsupported PID).
 *
 * Standard PIDs (SAE J1979 / ISO 15031-5):
 *   0x0C → rpm          0x0D → speed       0x05 → engineTemp
 *   0x2F → fuelLevel    0x0F → intakeTemp  0x11 → throttle
 *   0x10 → maf          0x0B → manifoldPressure
 *
 * EV / Extended (OEM-specific, varies by manufacturer):
 *   batteryLevel, batteryTemp, range, chargingState, chargingPower, motorPower
 *
 * Diesel extra:
 *   boostPressure (manifold/turbo), egt (exhaust gas temperature)
 */
export interface NativeOBDData {
  // ── Universal (OBD-II standard) ──────────────────────────
  speed: number;        // PID 0x0D — km/h   (-1 = not supported)
  rpm: number;          // PID 0x0C — RPM    (-1 = EV / not supported)
  engineTemp: number;   // PID 0x05 — °C     (-1 = EV / not supported)
  fuelLevel: number;    // PID 0x2F — 0–100% (-1 = EV / not supported)
  headlights?: boolean; // Manufacturer-specific — optional
  throttle?: number;    // PID 0x11 — 0–100% (-1 = not supported)
  intakeTemp?: number;  // PID 0x0F — °C     (-1 = not supported)
  maf?: number;         // PID 0x10 — g/s    (-1 = not supported)
  /** ELM327 ATRV — 12V akü/besleme voltajı (V). SAE PID değil, AT komutu.
   *  -1 = bu turda ölçülmedi/desteklenmiyor (Patch 6 staggered polling). */
  voltage?: number;

  // ── EV / Hybrid ─────────────────────────────────────────
  batteryLevel?: number;      // % SoC (0–100)         (-1 = not supported)
  batteryTemp?: number;       // °C HV battery pack    (-1 = not supported)
  range?: number;             // km remaining           (-1 = not supported)
  chargingState?: 'not_charging' | 'charging' | 'fast_charging' | 'unknown';
  chargingPower?: number;     // kW AC/DC              (-1 = not supported)
  motorPower?: number;        // kW output (can be neg for regen) (-1 = not supported)

  // ── Diesel / Turbo extra ─────────────────────────────────
  boostPressure?: number;     // kPa turbo boost        (-1 = not supported)
  egt?: number;               // °C exhaust gas temp    (-1 = not supported)
}

export interface MediaActionOptions {
  action: 'play' | 'pause' | 'next' | 'previous';
}

export interface SetBrightnessOptions {
  value: number; // 0–255 (Android WindowManager.LayoutParams.screenBrightness)
}

export interface SetVolumeOptions {
  value: number; // 0–15 (Android AudioManager STREAM_MUSIC max index)
}

export interface SpeechRecognitionOptions {
  preferOffline: boolean;     // EXTRA_PREFER_OFFLINE — yalnızca true ise offline'a zorlanır
  /** Offline başarısız olursa online ile bir kez daha denensin mi (varsayılan true).
   *  Head unit'lerde offline TR modeli yok → online fallback şart. Wake word'de false. */
  onlineFallback?: boolean;
  language?: string;          // BCP-47, e.g. 'tr-TR'
  maxResults?: number;
  /** Vosk yazılım kazancı çarpanı — native 1.0–4.0 clamp'ler (varsayılan 2.0).
   *  Tek kaynak: voiceTuning.ts. Verilmezse native varsayılanı (wake word yolu). */
  gain?: number;
  /** Vosk maksimum dinleme penceresi ms — native 5000–20000 clamp'ler (varsayılan 9000).
   *  Sessizlik endpoint'i konuşma bitince daha erken çözer; bu yalnız üst sınır. */
  maxListenMs?: number;
  /** Dinlerken müzik kısılsın mı (varsayılan true). Wake word PASİF döngüsü
   *  false geçer — sürekli %12 duck müziği dinlenemez hâle getiriyordu. */
  duckWhileListening?: boolean;
  /** HİBRİT STT (varsayılan false): true iken Vosk yolu yakaladığı sesi WAV base64
   *  olarak sonuca (audioWav) ekler → JS bulut STT'ye gönderir. Google (telefon) yolu
   *  YOK SAYAR. Yalnız aktif dinleme geçer; wake word/enroll geçmez. */
  returnAudio?: boolean;
  /** OFFLINE KOMUT GRAMMAR'ı (Yol A): verilirse Vosk yalnız bu sözlüğe + "[unk]"a
   *  kısıtlanır → offline komut doğruluğu fırlar. İnternetsizken geçilir; online'da
   *  verilmez (bulut tam dikteyi çözer). Grammar kurulamazsa native full-vocab'a düşer. */
  grammar?: string[];
}

// Faz 5 — grammar-kısıtlı native wake word thread'i (startWakeWordListening)
export interface WakeWordListeningOptions {
  /** Grammar listesi — asistan adından türetilen wake sözleri (küçük harf). */
  phrases: string[];
  /** Yazılım kazancı (native tarafta clamp'lenir, varsayılan VOSK_GAIN_DEFAULT). */
  gain?: number;
}

/** Native wake recorder yaşam döngüsü; metin/PII içermez. */
export interface WakeRecorderStateEvent {
  state: 'STARTING' | 'ACTIVE' | 'PAUSED_FOR_SESSION' | 'RECOVERING' | 'STOPPED' | 'FAILED';
  unexpected?: boolean;
  recoveryAttempt?: number;
}

/** Native 'wakeWord' event'i — grammar thread'i wake sözü duyduğunda düşer. */
export interface WakeWordEvent {
  transcript: string;
  state?: WakeRecorderStateEvent['state'];
  unexpected?: boolean;
  recoveryAttempt?: number;
}

/**
 * MAVI-F3 · Native 'sttPartial' event'i — tanıma SÜRERKEN gelen kısmi transkript.
 *
 * **EYLEM YETKİSİ TAŞIMAZ (spec K5).** Yalnız artımlı anlama ve cümle-sonu
 * (endpoint) kanıtı üretir; hiçbir CarOS eylemi bu olaydan doğamaz.
 *
 * `silenceMs` / `speechMs`: akustik VAD **native'de** ölçülür (JS ölçemez), bu
 * yüzden ölçüm kararı verecek katmana buradan taşınır. Ölçmeyen yollar (Google/
 * sistem STT) **-1** gönderir → JS sahte bir sessizlik UYDURMAZ ve o yolda
 * semantik endpoint'i çalıştırmaz.
 */
export interface SttPartialEvent {
  /** Kısmi metin. Telemetriye/log'a ASLA yazılmaz; yalnız pipeline'da kullanılır. */
  text: string;
  /** Konuşma sonrası sessizlik (ms). **-1 = ölçülmedi** (sahte değer üretilmez). */
  silenceMs: number;
  /** Konuşma başlangıcından bu yana geçen süre (ms). **-1 = ölçülmedi.** */
  speechMs: number;
}

export interface SpeechRecognitionResult {
  transcript: string; // top recognition result
  /**
   * n-best: STT'nin ürettiği alternatif tanımalar (en olası ilk). Beyin STT
   * belirsizliğini bunlardan seçerek çözer. Eski native / tek sonuç → [transcript].
   */
  alternatives?: string[];
  /** HİBRİT STT: returnAudio:true iken Vosk yolunun yakaladığı ses (WAV base64).
   *  Yalnız Vosk yolunda gelir (Google yolu üretmez). JS bulut STT'ye gönderir. */
  audioWav?: string;
  /** STT-LATENCY-2: yalnız native Vosk yolunda gelir (Google yolu üretmez) — bounded
   *  faz zaman damgaları/sayaçlar (transcript/PII/dosya yolu YOK). Süre türetimi
   *  saf src/platform/sttLatencyTelemetry.ts#deriveSttLatencyMetrics ile yapılır. */
  sttTelemetry?: RawSttTelemetry;
}

/* ── Contacts types ──────────────────────────────────────── */

export interface NativeContactPhone {
  number: string;
  type:   'MOBILE' | 'HOME' | 'WORK' | 'OTHER';
}

export interface NativeContact {
  id:     string;
  name:   string;
  phones: NativeContactPhone[];
}

export interface GetContactsResult {
  contacts: NativeContact[];
}

/* ── Passenger control types ─────────────────────────────── */

export interface PassengerServerResult {
  ip:    string;
  port:  number;
  token: string;
}

export interface PassengerStateOptions {
  title:   string;
  artist:  string;
  appName: string;
  playing: boolean;
}

export interface PassengerCommandEvent {
  action: 'play' | 'pause' | 'next' | 'previous';
}

/* ── Media session types ─────────────────────────────────── */

/**
 * Aktif medya oturumu bilgisi — Android MediaSessionManager'dan okunur.
 * Hangi uygulama çalıyorsa (Spotify, YouTube, vb.) bu yapı döner.
 */
export interface NativeMediaInfo {
  packageName: string;  // com.spotify.music, com.google.android.youtube, vb.
  appName:     string;  // kullanıcıya görünen uygulama adı
  title:       string;  // parça / video başlığı
  artist:      string;  // sanatçı / kanal adı
  albumArt?:   string;  // base64 data URI (JPEG)
  playing:     boolean;
  durationMs:  number;  // 0 = bilinmiyor
  positionMs:  number;  // 0 = bilinmiyor
}

/**
 * MÜZİK HUB PAKET A — CarosPlaybackService anlık görüntüsü.
 *
 * `authorityAvailable: false` → servis henüz yok/öldü; DİĞER ALANLAR ANLAMSIZDIR
 * ve "sağlıklı/duraklatılmış" gibi YORUMLANMAZ (sahte 0 üretme yasağı).
 * `renderingVerified` tek gerçek "ses çıkıyor" kanıtıdır: ExoPlayer render
 * ediyor + audio focus bizde + etkin ses > 0.
 */
export interface NativeAuthoritySnapshot {
  authorityAvailable: boolean;
  activeSource:       string;   // LOCAL | STREAM | INTERNET_RADIO | NONE
  focusState:         string;   // NONE|GRANTED|DELAYED|FAILED|LOST|LOST_TRANSIENT|DUCKED
  hasAudioFocus?:     boolean;
  userPaused?:        boolean;
  pausedByFocus?:     boolean;
  duckVolume?:        number;
  duckReasons?:       string[];
  userVolume?:        number;
  effectiveVolume?:   number;
  audioRoute:         string;   // SPEAKER|BLUETOOTH_A2DP|WIRED|UNKNOWN
  noisyReceiver?:     boolean;
  lastPauseReason?:   string;
  lastFailureCode?:   string;
  queueRevision?:     number;
  queueLength?:       number;
  currentIndex?:      number;
  queueEntryIds?:     string[];
  positionMs?:        number;
  durationMs?:        number;
  buffering?:         boolean;
  playing:            boolean;
  playWhenReady?:     boolean;
  /* MUSIC F20 — geçiş kanıtı. Bunlar playback TRUTH'u DEĞİLDİR: `playing` ve
     `renderingVerified` geçiş kazancından ETKİLENMEZ. */
  fadeEnabled?:       boolean;
  fadeOutMs?:         number;
  fadeInMs?:          number;
  /** 1.0 = geçiş yok. Sınır dışında DAİMA 1.0. */
  transitionGain?:    number;
  transitionActive?:  boolean;
  /** ExoPlayer boşluksuz geçişi destekler ve CarOS bunu bozmaz. */
  gaplessSupported?:  boolean;
  renderingVerified:  boolean;
  recoveryCount?:     number;
  shuffle?:           boolean;
  repeat?:            string;   // off|one|all
  title?:             string;
  artist?:            string;
  artworkUri?:        string;
  currentTrackId?:    string;
}

/* ── MUSIC F6 · Ses Deneyimi / DSP köprü tipleri ─────────────────────────
 *
 * Kazançlar native tarafta AudioEffect'in kendi birimiyle (milliBel = dB×100)
 * taşınır; dönüşüm JS otoritesinde TEK noktada yapılır. `probed:false` →
 * cihaz sorgulanamadı; alanlar "yok" demektir, "varsayılan" DEĞİL.
 */
export interface NativeAudioDspCapabilities {
  probed:                  boolean;
  supportsEqualizer:       boolean;
  eqBandCount:             number;
  eqBandFrequenciesHz:     number[];
  eqMinGainMilliBel:       number;
  eqMaxGainMilliBel:       number;
  supportsLoudness:        boolean;
  loudnessMaxMilliBel:     number;
  supportsBalance:         boolean;
  supportsFader:           boolean;
  faderUnsupportedReason:  string;
  supportsVirtualizer:     boolean;
  supportsHardwareDsp:     boolean;
  unavailableReason:       string;
  /** Yeteneğin ölçüldüğü audio session kuşağı — bayat yazımı engeller. */
  generation:              number;
}

export interface NativeAudioDspApplyRequest {
  /** Okunan yetenek kuşağı. Native'de kuşak değiştiyse istek REDDEDİLİR. */
  generation:        number;
  enabled:           boolean;
  bandsMilliBel:     number[];
  loudnessMilliBel:  number;
  /** Güvenlik preamp'i (doğrusal, 0<g<=1). Kullanıcı sesi DEĞİLDİR. */
  preampLinear:      number;
  balance:           number;
}

export interface NativeAudioDspApplyResult {
  applied:     boolean;
  failureCode: string;
  /** Uygulama sonrası gözlenen durum — "gönderdim, oldu saydım" kapatılır. */
  snapshot?:   NativeAudioDspSnapshot;
}

export interface NativeAudioDspSnapshot {
  available:               boolean;
  audioSessionId:          number;
  generation:              number;
  equalizerAttached:       boolean;
  loudnessAttached:        boolean;
  /** Denge/preamp işlemcisi ses zincirinde aktif mi (format uyumu şart). */
  processorActive:         boolean;
  bypass:                  boolean;
  bypassReason:            string;
  appliedBandsMilliBel:    number[];
  appliedLoudnessMilliBel: number;
  appliedPreampLinear:     number;
  appliedBalance:          number;
  attachCount:             number;
  attachFailureCount:      number;
  applyFailureCount:       number;
  lastFailureCode:         string;
  lastApplyLatencyMs:      number;
  lastAttachLatencyMs:     number;
}

/* ── Local music types ───────────────────────────────────── */

/** MediaStore'dan gelen tek şarkı kaydı */
export interface LocalMusicTrack {
  id:          string;
  uri:         string;   // content://media/external/audio/media/<id>
  title:       string;
  artist:      string;
  album:       string;
  albumArtUri: string;   // content://media/external/audio/albumart/<albumId>
  durationMs:  number;
  /** MediaStore contract: null/undefined means provider did not expose it. */
  albumArtist?: string | null;
  mimeType?: string | null;
  relativePath?: string | null;
  sizeBytes?: number | null;
  dateModifiedSec?: number | null;
  generationModified?: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  volumeName?: string | null;
  storageKind?: 'INTERNAL_SHARED' | 'REMOVABLE' | 'UNKNOWN';
  /**
   * MUSIC F10.1 — kütüphane metadata'sı (GERÇEK kanıt, uydurma YOK).
   * `genre` yalnız API 30+ MediaStore sütunundan gelir; yoksa `null`.
   * `year` 0/boş ise `null` gönderilir ("bilinmiyor" ≠ "sıfır").
   */
  genre?: string | null;
  year?: number | null;
}

/** MUSIC F19 — dosyaya gömülü SEVİYE etiketinin kaynağı. */
export type EmbeddedGainSource =
  | 'REPLAYGAIN_TRACK' | 'REPLAYGAIN_ALBUM' | 'R128_TRACK' | 'R128_ALBUM' | 'NONE';

/** MUSIC F10.1 — gömülü etiket (ID3 TBPM / Vorbis BPM) okuma sonucu. */
export interface EmbeddedTraitRow {
  uri: string;
  /** Etiket YOKSA `null` — süre/başlıktan BPM ÜRETİLMEZ. */
  bpm: number | null;
  source: 'ID3_TBPM' | 'VORBIS_BPM' | 'NONE';
  /**
   * MUSIC F19 — ReplayGain/R128 kazancı (dB). Etiket YOKSA `null`.
   * Bu bir ETİKETTİR (dosyayı üreten aracın yazdığı), bizim ölçümümüz DEĞİL —
   * ve **LUFS DEĞİLDİR**; öyle sunulamaz.
   */
  gainDb?: number | null;
  /** ReplayGain tepe değeri (1.0 = tam ölçek). Etiket yoksa `null`. */
  gainPeak?: number | null;
  gainSource?: EmbeddedGainSource;
}

export interface ReadTrackTraitsResult {
  traits: EmbeddedTraitRow[];
  scanned: number;
  /** Toplu iş üst sınırına takıldı mı (kalanlar okunmadı). */
  limited: boolean;
}

/**
 * MUSIC F17 — bir dosyanın SESİNDEN ölçülen ham betimleyici.
 *
 * Bu bir ETİKET okuması DEĞİLDİR (F10.1 öyleydi): dosya decode edilir ve
 * dalga formu ölçülür. Ölçülemeyen alan `null` döner — sahte 0 YOKTUR.
 * **`mood` alanı YOKTUR ve olmayacaktır**: dalga formundan ruh hâli
 * çıkarmak uydurma olurdu (F17 sınırı).
 */
export interface SonicAnalysisRow {
  uri: string;
  /** Ölçüm gerçekten yapıldı mı. `false` ise tüm alanlar `null`. */
  analyzed: boolean;
  reason: 'OK' | 'NO_AUDIO_TRACK' | 'UNSUPPORTED_CODEC' | 'DECODE_FAILED'
  | 'TIMEOUT' | 'TOO_SHORT' | 'SILENT' | 'CANCELLED';
  /** Analizin koştuğu (decimate edilmiş) örnekleme hızı. */
  sampleRate: number | null;
  /** Gerçekten çözümlenen ses süresi (parçanın tamamı DEĞİL). */
  analyzedMs: number;
  peakDbfs: number | null;
  rmsDbfs: number | null;
  crestDb: number | null;
  zeroCrossingRate: number | null;
  spectralCentroidHz: number | null;
  spectralRolloffHz: number | null;
  spectralFlux: number | null;
  onsetRate: number | null;
  /** Otokorelasyon tepesi; güven eşiği JS tarafında zorlanır. */
  tempoBpm: number | null;
  /** 0..1 tepe belirginliği. Düşükse tempo KANIT SAYILMAZ. */
  tempoConfidence: number | null;
  /** 8 bantlık normalize enerji vektörü (toplamı ≈ 1). Boşsa ölçüm yok. */
  bands: number[];
}

export interface AnalyzeTrackAudioResult {
  results: SonicAnalysisRow[];
  scanned: number;
  /** Toplu iş üst sınırına takıldı mı (kalanlar çözümlenmedi). */
  limited: boolean;
  /** Tur ortasında iptal edildi mi (kısmi sonuç kanıt sayılmaz). */
  cancelled: boolean;
  /** İptal kuşağı — eski turun sonucu yeni kuşağa YAZILAMAZ. */
  generation: number;
}

/** MUSIC F16 — SYLT senkron satırı: `ms` milisaniyedir, MPEG-frame ASLA döndürülmez. */
export interface EmbeddedSyncedLyricsLine {
  ms: number;
  text: string;
}

/** MUSIC F16 — gömülü etiket (ID3 USLT/SYLT / Vorbis LYRICS) okuma sonucu. */
export interface EmbeddedLyricsRow {
  uri: string;
  /** Yalnız düz söz bulunduysa dolu (SYNCED bulunduysa `null`). */
  plain: string | null;
  /** Yalnız gerçek milisaniye zaman damgalı SYLT bulunduysa dolu. */
  synced: EmbeddedSyncedLyricsLine[] | null;
  source: 'ID3_USLT' | 'ID3_SYLT' | 'VORBIS_LYRICS' | 'NONE';
}

export interface ReadEmbeddedLyricsResult {
  results: EmbeddedLyricsRow[];
  scanned: number;
  /** Toplu iş üst sınırına takıldı mı (kalanlar okunmadı). */
  limited: boolean;
}

/** One MediaStore volume as the provider currently reports it. */
export interface MediaStoreVolumeFact {
  name: string;
  /** MediaStore.getVersion(volume) — opaque token; null when the platform predates it. */
  version: string | null;
  /** MediaStore.getGeneration(volume) — null when unavailable (forces FULL_RECONCILE). */
  generation: number | null;
  available: boolean;
  storageKind: 'INTERNAL_SHARED' | 'REMOVABLE' | 'UNKNOWN';
}

export interface MediaStoreVolumeFactsResult {
  permissionGranted: boolean;
  /** False on API < 30: no generation column, so delta refresh is impossible. */
  supportsGeneration: boolean;
  volumes: MediaStoreVolumeFact[];
}

export interface QueryMusicTracksOptions {
  volumes: string[];
  mode: 'FULL' | 'DELTA';
  /** volumeName → exclusive lower bound on GENERATION_MODIFIED (DELTA only). */
  sinceGeneration?: Record<string, number>;
  /** Volumes for which the full `_ID` set is also returned, so deletions are observed, not guessed. */
  identityVolumes?: string[];
}

export interface QueryMusicTracksResult {
  tracks: LocalMusicTrack[];
  volumes: MediaStoreVolumeFact[];
  queriedVolumes: string[];
  mode: 'FULL' | 'DELTA';
  /** volumeName → every MediaStore `_ID` currently present on that volume. */
  identities?: Record<string, string[]>;
}

/** Sampled-decode result written to the native artwork cache directory. */
export interface ArtworkFileResult {
  key: string;
  /** Absolute path in the app cache dir; the caller converts it with Capacitor.convertFileSrc. */
  path: string;
  bytes: number;
  width: number;
  height: number;
  sampleSize: number;
  source: 'DISK' | 'DECODED' | 'MISSING';
}

export interface GetMusicTracksResult {
  tracks: LocalMusicTrack[];
  /** Per-volume generation/version facts; no delta deletion claim is made. */
  volumes?: Array<{ name: string; version: string | null; generation: number | null }>;
}

export interface LocalMusicProgressEvent {
  positionMs: number;
  durationMs: number;
  playing:    boolean;
}

/* ── Local video types ───────────────────────────────────── */

/** MediaStore.Video.Media'dan gelen tek video kaydı */
export interface LocalVideoTrack {
  id:         string;
  uri:        string;   // content://media/external/video/media/<id>
  title:      string;
  durationMs: number;
  sizeBytes:  number;
}

export interface GetVideoTracksResult {
  videos: LocalVideoTrack[];
}

/* ── Native Core types ───────────────────────────────────── */

/**
 * Hardware profile returned by getDeviceProfile().
 * Used to auto-detect the correct performance mode on startup.
 */
/**
 * Tek bir sysfs termal bölgesi. `tempC` YOKSA o bölge okunamadı demektir —
 * 0 °C ile "okunamadı" AYRI şeylerdir, bu yüzden alan opsiyoneldir.
 */
export interface NativeThermalZone {
  readonly index: number;
  /** Çekirdeğin verdiği etiket: `cpu_thermal_zone` · `gpu_thermal_zone` · `ddr_thermal_zone` … */
  readonly type?: string;
  /** Celsius. Alan yoksa okuma BAŞARISIZ — tahmin edilmez. */
  readonly tempC?: number;
}

export interface NativeThermalResult {
  readonly zones: readonly NativeThermalZone[];
  /** `tempC` üretebilen bölge sayısı. */
  readonly readableCount: number;
  /** `readableCount > 0` — hiçbir bölge okunamadıysa false. */
  readonly available: boolean;
}

export interface NativeDeviceProfile {
  androidVersion: string;   // e.g. "9", "12"
  sdkInt:         number;   // e.g. 28, 31
  totalRamMb:     number;   // total physical RAM in MB
  isLowRamDevice: boolean;  // ActivityManager.isLowRamDevice()
  screenWidth:    number;   // pixels
  screenHeight:   number;   // pixels
  densityDpi:     number;
  density:        number;   // e.g. 1.5, 2.0, 3.0
  webViewVersion: string;   // Chrome version string or ""
  /** 'low' | 'mid' | 'high' — mapped from RAM + SDK level */
  deviceClass:    'low' | 'mid' | 'high';
}

/**
 * Real screen dimensions from WindowManager.getRealMetrics().
 * More accurate than JS window.screen on old head-unit WebViews.
 */
export interface NativeScreenMetrics {
  widthPx:    number;
  heightPx:   number;
  densityDpi: number;
  density:    number;
  widthDp:    number;
  heightDp:   number;
}

export interface CallNumberOptions {
  number: string; // Phone number to call (or open in dialer — bkz. CallNumberResult)
}

/**
 * Aramanın GERÇEKTEN başlayıp başlamadığı.
 *
 * `CALL` = `ACTION_CALL` ile arama BAŞLATILDI (CALL_PHONE izni var).
 * `DIAL` = yalnız çevirici numarayla AÇILDI; kullanıcının arama tuşuna basması
 *          gerekir (izin yok). **`DIAL` bir arama DEĞİLDİR** — üst katman bunu
 *          "aranıyor" diye sunamaz (sahte onay yasağı).
 */
export interface CallNumberResult {
  mode: 'CALL' | 'DIAL';
  placed: boolean;
}

/* ── OBD Bluetooth Auto-Pair types ──────────────────────── */

export type OBDBtState =
  | 'IDLE'
  | 'SCANNING'
  | 'CANDIDATE_FOUND'
  | 'TRY_KNOWN_DEVICE'
  | 'TRY_SILENT_PAIR_PIN_0000'
  | 'TRY_SILENT_PAIR_PIN_1234'
  | 'TRY_SILENT_PAIR_PIN_1111'
  | 'TRY_SILENT_PAIR_PIN_6789'
  | 'WAIT_BOND_RESULT'
  | 'OPEN_SPP_SOCKET'
  | 'ELM_DETECT'
  | 'CONNECTED'
  | 'FALLBACK_USER_ACTION_REQUIRED'
  | 'FAILED';

export interface OBDBtStateEvent {
  state:      OBDBtState;
  deviceName: string | null;
  mac:        string | null;
  info:       string | null;
}

export interface SavedOBDDevice {
  mac:  string;
  name: string;
}

/* ── Plugin interface ────────────────────────────────────── */

/* ── OTA types (Commit 4 — download + verify) ─────────────── */

export interface OtaDownloadOptions {
  /** Tam indirme URL'i (https zorunlu) */
  url: string;
  /** ota_releases.sha256 — 64 hex karakter */
  expectedSha256: string;
  /** ota_releases.apk_size — bayt */
  expectedSize: number;
  /** Hedef dosya adı (yalnız [A-Za-z0-9._-], traversal reddi) */
  fileName: string;
  /** Anon-key auth header'ları (apikey/Authorization) — service_role ASLA */
  headers?: Record<string, string>;
}

export interface OtaDownloadResult {
  ok: boolean;
  /** ok=true: doğrulanmış APK'nın mutlak yolu (files/ota/...) */
  path?: string;
  /** ok=true: hesaplanan SHA-256 (lowercase hex) */
  sha256?: string;
  /** ok=true: indirilen bayt */
  size?: number;
  /** ok=false: ERR_INPUT|ERR_DISK|ERR_HTTP|ERR_SIZE|ERR_HASH|ERR_RENAME|ERR_IO */
  errorCode?: string;
  errorMessage?: string;
}

export interface OtaDownloadProgressEvent {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface OtaInstallResult {
  ok: boolean;
  /** install_prompted: sistem kurulum diyaloğu açıldı ·
   *  settings_opened: bilinmeyen-kaynak izni ayarına yönlendirildi (yeniden dene) */
  action?: 'install_prompted' | 'settings_opened';
  /** ERR_INPUT|ERR_NOT_FOUND|ERR_NO_PERMISSION|ERR_BAD_APK|ERR_PACKAGE|
   *  ERR_DOWNGRADE|ERR_SIGNATURE|ERR_NO_INSTALLER|ERR_IO */
  errorCode?: string;
  errorMessage?: string;
}

export interface AppVersionInfo {
  /** PackageManager longVersionCode — version.properties VERSION_CODE'un kurulu hali */
  versionCode: number;
  /** PackageManager versionName — version.properties VERSION_NAME'in kurulu hali */
  versionName: string;
  packageName: string;
}

/**
 * PHONE-HUB P0.5: native salt-okunur donanım gözlemi — {@code getPhoneHubHardwareProbe}'ın
 * döndürdüğü ham şekil.
 *
 * PII YOK (yapısal): cihaz adı · MAC · kişi adı · telefon modeli · pairing key TAŞIYAN ALAN
 * BULUNMAZ. Yalnız sayım ve sabit enum. Adapter adı için bile yalnız "var mı".
 *
 * `present:false` = native metot YOK (eski APK) veya probe patladı → SAHTE varsayılan
 * üretilmez, alanlar okunamadı sayılır.
 */
export interface NativePhoneHubProbe {
  present: boolean;
  schemaVersion?: number;
  /** Duvar-saati damgası (ms). 0/eksik = damga yok. */
  capturedAt?: number;
  platformApiLevel?: number;
  bluetooth?: {
    adapterAvailable: boolean; adapterEnabled: boolean; adapterNamePresent: boolean;
    permConnect: string; permScan: string; permLegacy: string;
    discoveryActive: string;
    /** -1 = okunamadı (0 DEĞİL). */
    bondedDeviceCount: number;
    phoneLikeCount: number; audioLikeCount: number;
    obdLikeCandidateCount: number; unknownClassCount: number;
    evidence: string;
  };
  profiles?: {
    a2dpConnectionState: string; headsetConnectionState: string; gattConnectionState: string;
    a2dpControlAuthority: string; hfpControlAuthority: string; evidence: string;
  };
  vendor?: {
    knownVendorPackageDetected: boolean; knownVendorBroadcastObserved: boolean;
    vendorFamily: string; lastEvidenceAgeMs: number; evidence: string;
  };
  audio?: {
    audioMode: number; musicActive: boolean;
    communicationDeviceType: string; routeAuthority: string; evidence: string;
  };
  /** Sınıflandırılmış hata kodları (yığın izi/dosya yolu YOK). */
  errors?: string[];
}

/**
 * MAVI-STT-LAB-1: native salt-okunur mikrofon + STT zinciri gözlemi —
 * {@code getVoiceMicDiagnostics}'in döndürdüğü ham şekil.
 *
 * PII YOK (YAPISAL): transcript · n-best · wake sözcüğü · grammar KELİMELERİ ·
 * ham ses örneği · kişi adı · konum · VIN · cihaz kimliği TAŞIYAN ALAN BULUNMAZ.
 * Yalnız sabit enum, sayım, normalize RMS skaleri (0..1) ve bounded gerekçe KODU.
 *
 * SENTINEL SÖZLEŞMESİ: `-1` = "ölçüm/uygulanabilirlik YOK" — `0` ile ASLA
 * karıştırılmaz (0 gerçek bir RMS/eşik değeridir).
 *
 * `present:false` = native metot YOK (eski APK) veya hiç ölçüm yapılmadı.
 */
export interface NativeVoiceMicDiagnostics {
  present: boolean;
  schemaVersion?: number;
  /** Duvar-saati damgası (ms). 0/eksik = damga yok. */
  capturedAt?: number;
  /** Hangi yakalama yolu ölçüldü: NONE | ACTIVE_LISTEN | WAKE_WORD. */
  path?: string;
  sessionActive?: boolean;
  sessionStartedAt?: number;
  source?: {
    /** -1 = seçilmedi. */
    selectedSource: number;
    selectedSourceName: string;
    sampleRate: number;
    channelCount: number;
    bufferBytes: number;
    frameSamples: number;
    attempts: { source: number; sourceName: string; outcome: string }[];
    /** SAHA #1255-a · OEM mikrofon yönlendirme ayarı (SALT-OKUNUR, yazılmaz). */
    oem?: { dualMicSettingRead?: boolean; dualMicSetting?: number };
  };
  effects?: {
    probed: boolean;
    aecAvailable: boolean; aecCreated: boolean; aecEnabled: boolean;
    nsAvailable: boolean;  nsCreated: boolean;  nsEnabled: boolean;
    agcAvailable: boolean; agcCreated: boolean; agcEnabled: boolean;
    /** Bounded KOD listesi (ör. "AEC_SETUP_FAILED") — ham exception metni YOK. */
    errors: string[];
  };
  vad?: {
    present: boolean;
    /** -1 = ölçüm yok. */
    lastRms: number;
    /** -1 = taban ÖĞRENİLMEDİ (wake yolunda hiç öğrenilmez). */
    noiseFloor: number;
    effectiveThreshold: number;
    /** -1 = bu yolda uygulanmaz. */
    staticMinThreshold: number;
    floorFactor: number;
    speechDetected: boolean;
    /** Monotonic (elapsedRealtime) ms. 0 = hiç ses paketi yok. */
    lastAudioAtMs: number;
    monotonicNowMs: number;
    sampleCount: number;
    /** Bounded (≤64) normalize RMS örnekleri — HAM SES DEĞİL. */
    samples: number[];
  };
  stt?: {
    wakeEngineActive: boolean;
    activeRecognizerActive: boolean;
    /** static_command | wake_word | confirmation | free. */
    grammarType: string;
    /** -1 = grammar yok (full-vocab). */
    grammarWordCount: number;
    /** success | no_match | timeout | error. Yoksa hiç gelmez. */
    lastResultCategory?: string;
    lastResultAt: number;
  };
  /**
   * WAKE KARAR SAYAÇLARI (native şema 2) — JS'in GÖREMEDİĞİ kararlar.
   *
   * `wakeWordService` yalnız TETİK ANINI alır; "mikrofon hiç açılmadı",
   * "VAD decode'u atladı" ve "çözüldü ama eşleşmedi" JS'ten AYIRT EDİLEMEZ.
   * Bu blok davranışı DEĞİŞTİRMEZ, yalnız görünür kılar.
   *
   * ⚠️ OPSİYONEL: şema 1 APK'sında bu anahtar HİÇ GELMEZ → okuyan taraf
   * "ölçüm yok" demelidir (sahte `0` üretmemeli).
   * Sayaçlar KÜMÜLATİFtir (oturum başında sıfırlanmaz) ve doyurulur.
   */
  wake?: {
    /** Mikrofon hiç açılmadı (TTS / aktif STT / bekleyen çağrı). */
    yieldCount: number;
    /** VAD eşiği altında kalıp decode edilmeyen çerçeve. */
    vadSkipFrames: number;
    /** Gerçekten decode edilen çerçeve. */
    decodeFrames: number;
    /** Metin çözüldü ama wake sözü eşleşmedi (metin TAŞINMAZ). */
    noMatchCount: number;
    /** Eşleşti ve JS'e olay gönderildi. */
    triggerCount: number;
    /** Konuşma başlangıcı → tetik (ms). -1 = ölçüm yok. */
    lastTriggerLatencyMs: number;
    /** `setPartialWords(true)` kurulabildi mi (Vosk yeteneği) — şema 3. */
    partialWordsEnabled?: boolean;
    /** Son EŞLEŞMEDEKİ en düşük kelime güveni ×1000. -1 = güven YOK — şema 3. */
    lastMatchConfMilli?: number;
  };
}

/**
 * PHONE-HUB P0.8: native salt-okunur SAHA DOĞRULAMA gözlemi —
 * {@code getPhoneHubFieldProbe}'ın döndürdüğü ham şekil.
 *
 * P0.5 sözleşmesini ({@link NativePhoneHubProbe}) EZMEZ, yanına EKLENİR. Eski APK'da
 * metot bulunmadığında `present:false` gelir → SAHTE varsayılan üretilmez.
 *
 * PII YOK (yapısal): paket adı · MAC · telefon numarası · kişi adı · parça/sanatçı/
 * albüm adı · bildirim içeriği · ham build fingerprint TAŞIYAN ALAN BULUNMAZ.
 * Yalnız donanım kimliği (üretici/model), sabit enum, sayım ve geri çevrilemez karma.
 */
export interface NativePhoneHubFieldProbe {
  present: boolean;
  schemaVersion?: number;
  /** Duvar-saati damgası (ms). 0/eksik = damga yok. */
  capturedAt?: number;
  identity?: {
    manufacturer: string; model: string; device: string; product: string;
    androidRelease: string; sdkInt: number;
    /** Ham fingerprint DEĞİL — iki segmentlik özet. */
    fingerprintSummary: string;
    /** Geri çevrilemez FNV-1a karma (cihaz kaydı eşleştirmek için). */
    fingerprintHash: string;
    /** 'YES' | 'NO' | 'UNKNOWN' — okunamadı ile "yok" AYRI. */
    automotiveFeature: string; carServicePresent: string; telephonyFeature: string;
    /** -1 = okunamadı (0 DEĞİL). */
    headUnitMarkerCount: number; phoneOemMarkerCount: number;
    vendorFamily: string;
    /** Native'in SAF kuralı — kullanıcı onayı KATILMAMIŞ rol. */
    deviceRoleTechnical: string; deviceRoleConfidence: string;
  };
  call?: {
    dialerClass: string; telecomManagerAvailable: string;
    /** -1 = okunamadı. */
    callVendorMarkerCount: number;
  };
  media?: {
    mediaSessionAccess: string;
    /** -1 = okunamadı (0 oturum DEĞİL). */
    activeSessionCount: number;
    ownerLocalCount: number; ownerSystemCount: number;
    ownerVendorCount: number; ownerOtherCount: number;
    playbackStatePresent: string; metadataPresent: string;
    artworkPresent: string; transportControlsPresent: string;
  };
  /** Sınıflandırılmış hata kodları (yığın izi/dosya yolu YOK). */
  errors?: string[];
}

/**
 * P0-VDK-B3 · POLL MALİYETİ — `getObdPollCost`'un döndürdüğü ham şekil.
 *
 * Kullanıcı/teşhis VERİSİ isteği ile ADAPTÖR YÖNETİM komutu ayrı taşınır: "8 PID +
 * 5 AT" asla tek sayıya indirgenmez. Ölçülmeyen alan `null` gelir (sahte 0 YASAK).
 * Eski APK bu metodu HİÇ taşımaz → çağrı fail-soft, kanıt `UNAVAILABLE`.
 */
export interface NativePollCycleCost {
  cycleId: number;
  sessionEpoch: number;
  burst: boolean;
  diagnosticPayloadRequests: number;
  adapterControlCommands: number;
  headerSwitches: number;
  voltageReads: number;
  protocolChecks: number;
  /** Hiç kullanılmadan bir sonraki ATSH/ATCRA ile ezilen adresleme yazımı. */
  redundantHeaderSwitches: number;
  noResponses: number;
  negativeResponses: number;
  noResponseMs: number;
  payloadMs: number;
  adapterMs: number;
  elapsedMs: number;
  bytesTx: number;
  bytesRx: number;
  /** `null` = ÖLÇÜLMEDİ (bu katmanda retry muhasebesi yok) — 0 DEĞİL. */
  retries: number | null;
  provenance: string;
}

export interface NativePollCost {
  present: boolean;
  sessionEpoch: number;
  cyclesRecorded: number;
  burstCyclesRecorded: number;
  /** Poll turu AÇIK DEĞİLKEN gelen komutlar (handshake · keşif · DTC taraması). */
  unattributedCommands: number;
  totals: {
    diagnosticPayloadRequests: number;
    adapterControlCommands: number;
    headerSwitches: number;
    voltageReads: number;
    protocolChecks: number;
    redundantHeaderSwitches: number;
    noResponses: number;
    negativeResponses: number;
    noResponseMs: number;
    payloadMs: number;
    adapterMs: number;
    bytesTx: number;
    bytesRx: number;
  };
  lastCycle: NativePollCycleCost | null;
  recentCycles: NativePollCycleCost[];
}

/**
 * PR-OBD-DIAG-3: native EXTENDED PID poll kanıtı — {@code getObdExtendedPollEvidence}'ın
 * döndürdüğü ham şekil. Tümü bounded; ham yanıt gövdesi YOK (yalnız responseLength) → PII-güvenli.
 */
export interface NativeExtendedPollEvidence {
  present: boolean;
  transport: string;
  /** Geriye dönük ad — NİYETİ taşır (bkz. `burstIntent`). Hüküm için KULLANILMAZ. */
  burstEnabled: boolean;
  /** B2 · NİYET — scheduler/plugin'in istediği mod; poll turu bunu ezemez. */
  burstIntent?: boolean;
  /** B2 · GÖZLEM — son TAMAMLANAN turun modu. Tarihsel kanıt `counters.burstCycles`. */
  lastCycleWasBurst?: boolean;
  configuredPidCount: number;
  configuredPidPreview: string[];
  counters: {
    pollCycles: number; burstCycles: number; roundRobinCycles: number;
    attempted: number; success: number; noData: number; busy: number;
    negativeResponse: number; error: number; timeoutNoBytes: number;
    timeoutPartial: number; parseFailure: number; cancelled: number;
    unknownFailure: number; callbackEmitted: number; maxBurstSizeObserved: number;
  };
  lastAttemptedPid: string | null;
  lastSuccessfulPid: string | null;
  lastOutcome: string | null;
  lastElapsedMs: number;
  lastPollAt: number;
  coherent: boolean;
  lastAttempts: {
    pid: string; outcome: string; elapsedMs: number;
    responseLength: number; callbackEmitted: boolean;
  }[];
  scheduler?: {
    supportedConfiguredCount: number; activePollCount: number; deferredTotal: number;
    recoveryPauseCount: number; lineBudgetMs: number;
    pids: { pid: string; targetFreshnessMs: number; ageMs: number | null;
      avgRttMs: number; avgAgeMs: number; maxAgeMs: number; deadlineMisses: number; deferred: number;
      /* P0-VDK-B3: kadans penceresi ERTELEME DEĞİLDİR — ayrı sayılır; `agingMs`
         o PID'in açlık yüzünden ne kadar öne çekildiğini gösterir. Eski APK bu
         alanları taşımaz → `undefined` (sahte 0 ÜRETİLMEZ). */
      notYetDue?: number; agingMs?: number;
      attempts: number; successes: number }[];
  };
}

export interface CarLauncherPlugin {
  /** OTA v1: cihazda KURULU gerçek sürüm (PackageManager — drift imkânsız) */
  getAppVersionInfo(): Promise<AppVersionInfo>;
  /** OTA v1: streaming APK indirme + SHA-256/boyut doğrulama (kurulum ayrı) */
  downloadOtaApk(options: OtaDownloadOptions): Promise<OtaDownloadResult>;
  /** OTA v1: güvenli kurulum kapısı — paket/sürüm/imza ön-kontrol + sistem diyaloğu */
  installOtaApk(options: { fileName: string }): Promise<OtaInstallResult>;
  addListener(
    event: 'otaDownloadProgress',
    handler: (data: OtaDownloadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** Native Core: hardware profile for performance-mode detection */
  getDeviceProfile(): Promise<NativeDeviceProfile>;
  /** Native Core: real screen dimensions from WindowManager */
  getScreenMetrics(): Promise<NativeScreenMetrics>;
  /** Aramayı başlatır (CALL_PHONE varsa) ya da çeviriciyi açar — hangisi olduğunu DÖNDÜRÜR. */
  callNumber(options: CallNumberOptions): Promise<CallNumberResult>;

  /** Launcher'ı arka plana al — çift geri basış sonrası çağrılır */
  exitApp(): Promise<void>;
  /**
   * Cihazın sysfs termal bölgelerini OKUR (DEBT-013 · kütük #139).
   * Android termal HAL bu cihaz sınıfında ölü olduğu için tek gerçek kaynak budur.
   * Okunamayan bölgede `tempC` alanı HİÇ GELMEZ — sahte sıcaklık üretilmez.
   */
  readThermal(): Promise<NativeThermalResult>;
  launchApp(options: LaunchAppOptions): Promise<void>;
  getApps(): Promise<GetAppsResult>;
  getDeviceStatus(): Promise<NativeDeviceStatus>;

  // Media playback control
  sendMediaAction(options: MediaActionOptions): Promise<void>;

  // System hardware controls
  setBrightness(options: SetBrightnessOptions): Promise<void>;
  setVolume(options: SetVolumeOptions): Promise<void>;
  /** Cihazın GERÇEK medya sesi (index/max/yüzde) — kütük #1054. */
  getVolume(): Promise<{ value: number; max: number; percent: number }>;

  // Sistem ayar panelleri — WiFi/Bluetooth (Android 10+ doğrudan toggle'ı engeller,
  // panel açmak satışa-uygun tek yol). Opsiyonel: eski plugin sürümlerinde bulunmayabilir.
  openWifiSettings?(): Promise<{ opened: boolean }>;
  openBluetoothSettings?(): Promise<{ opened: boolean }>;
  /** WiFi'yi DOĞRUDAN aç/kapat: eski Android/sistem-app head unit'te uygulanır;
   *  modern telefonda (OS engeli) panele düşer. { enabled } veya { toggle:true }. */
  setWifi?(opts: { enabled?: boolean; toggle?: boolean }): Promise<{ applied: boolean; opened: boolean }>;
  /** Bluetooth'u DOĞRUDAN aç/kapat: aynı mantık (fail-soft panel fallback). */
  setBluetooth?(opts: { enabled?: boolean; toggle?: boolean }): Promise<{ applied: boolean; opened: boolean }>;

  // On-device speech recognition (EXTRA_PREFER_OFFLINE)
  startSpeechRecognition(options: SpeechRecognitionOptions): Promise<SpeechRecognitionResult>;

  // Vosk modelini boot'ta arka planda ısıtır — ilk mikrofon basışı unpack+load
  // maliyetini (zayıf head unit CPU'sunda 20-40 sn) ödemesin. Opsiyonel: eski
  // plugin sürümlerinde bulunmayabilir (çağıran try/catch ile korur).
  preloadVoskModel?(): Promise<{ ready: boolean }>;

  // Faz 5 — Native Refleksler: grammar-kısıtlı kalıcı wake word thread'i.
  // Vosk tam sözlük yerine yalnız wake sözleri + "[unk]" ile çalışır (hız +
  // az yanlış pozitif); tetik 'wakeWord' event'iyle JS'e düşer (partial sonuç,
  // endpoint beklenmez — <200ms refleks). Pasif modda DUCK/audio-focus YOK.
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (wakeWordService
  // yokluğunda eski startSpeechRecognition döngüsüne düşer).
  startWakeWordListening?(options: WakeWordListeningOptions): Promise<void>;
  stopWakeWordListening?(): Promise<void>;
  addListener(
    event: 'wakeWord',
    handler: (data: WakeWordEvent) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Mikrofon RMS (anlık ses seviyesi) akışı — dinleme sırasında dalga formunu
   * besler. `value` 0–1 arası normalize edilmiş genliktir.
   * Eski plugin sürümleri bu olayı YAYINLAMAZ; abonelik yine de güvenlidir
   * (Capacitor bilinmeyen olay için sessizce hiç tetiklemez).
   */
  addListener(
    event: 'rmsData',
    handler: (data: { value: number }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * MAVI-F3 · Kısmi transkript akışı. Eski plugin sürümleri bu olayı YAYINLAMAZ;
   * abonelik yine de güvenlidir (Capacitor bilinmeyen olayı hiç tetiklemez) →
   * o cihazlarda yol `FINAL_ONLY` olarak bildirilir ve davranış bugünküyle
   * BİREBİR aynı kalır.
   */
  addListener(
    event: 'sttPartial',
    handler: (data: SttPartialEvent) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * MAVI-FIELD-1 · Native `TextToSpeech` bu utterance için ÇIKTI ÜRETMEYE
   * başladı (`UtteranceProgressListener.onStart`).
   *
   * KANIT SINIRI: Android hoparlör/DAC başlangıcını API seviyesinde AÇMAZ.
   * Bu olay platformun verdiği EN YAKIN güvenilir playback-start sinyalidir ve
   * `first_audio_confirmed` damgasının native yoldaki TEK kaynağıdır —
   * `speak()` kuyruklaması (PROXY) ile KARIŞTIRILMAZ.
   *
   * Opsiyonel: eski APK'larda olay HİÇ gelmez → native yol `PROXY_ONLY`
   * kanıt seviyesinde kalır ve bu dürüstçe raporlanır (sahte onay üretilmez).
   */
  addListener(
    event: 'ttsStarted',
    handler: (data: { utteranceId: string }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * MAVI-F3 · **SEMANTİK ENDPOINT KOMUTU** — çalışan tanıma oturumunu erken
   * finalize eder (yalnız mikrofonu kapatır; HİÇBİR CarOS eylemi tetiklemez).
   *
   * Opsiyonel: eski plugin sürümlerinde YOKTUR → çağıran `typeof` ile korur ve
   * komut kipi kendiliğinden kapalı kalır (akustik VAD karar vermeye devam eder).
   * `applied:false` bir hata DEĞİLDİR: aktif oturum yoktu demektir.
   */
  finalizeSpeechRecognition?(): Promise<{ applied: boolean }>;

  // OBD-II Bluetooth Serial
  scanOBD(): Promise<OBDScanResult>;
  /**
   * Patch 3: resolve payload'ı ELM327 ATDPN ile okunan aktif protokol numarasını taşıyabilir
   * (ör. `{ protocol: '6' }`) — obdService.ts bunu persist edip sonraki bağlantıda ATSP<n>
   * ile ARAMASIZ bağlanmak için kullanır. Eski native plugin / protokol okunamadıysa `{}`
   * (veya `void`) döner — geri-uyumlu.
   */
  connectOBD(options: OBDConnectOptions): Promise<{ protocol?: string } | void>;
  disconnectOBD(): Promise<void>;
  readDTC(): Promise<{ codes: string[] }>;
  clearDTC(): Promise<void>;

  /**
   * P0-OBD-10 — Mode 04 (DTC hafızasını sil) KANITLI yol.
   *
   * NEDEN AYRI METOT: `clearDTC()` yalnız resolve/reject taşır; ECU'nun NE
   * cevapladığı (ham RX · negatif yanıt kodu · NO DATA mı timeout mu · protokol
   * · süre) plugin sınırında ATILIYORDU. Saha kusuru tam bu kör noktada yaşadı:
   * kullanıcı "sildim ama silinmedi" derken ürün tek bir kanıt üretemiyordu.
   *
   * SÖZLEŞME: ECU'nun OLUMSUZ cevabı ISTISNA DEĞİLDİR — `outcome` alanında
   * resolve ile döner (kanıt kaydedilebilsin diye). YALNIZ taşıma hatası
   * (adaptör bağlı değil / bağlantı koptu) reject eder.
   *
   * `outcome` sözlüğü `dtcClearModel.DtcClearCommandOutcome` ile BİREBİRDİR.
   * Opsiyonel: eski plugin sürümlerinde yoktur (dtcService geri-uyumlu çağırır).
   */
  clearDtcCodes?(): Promise<{
    /** Hatta gönderilen komut — her zaman '04'. */
    tx: string;
    /** ELM327 ham yanıtı (kırpılmış). */
    raw: string;
    /** POSITIVE | NEGATIVE | NO_DATA | NO_RESPONSE | BUS_ERROR | UNSUPPORTED | UNKNOWN */
    outcome: string;
    /** Negatif yanıt kodu (2 hane hex); alan YOKSA ölçülmedi (sahte '00' YAZILMAZ). */
    nrc?: string;
    /** Komut anındaki ATDPN protokolü; alan YOKSA bilinmiyor. */
    protocol?: string;
    /** Komutun uçtan uca süresi (ms). */
    elapsedMs: number;
  }>;

  /**
   * Teşhis: ELM327 ham komut/yanıt trafiği yakalamayı aç/kapat. Açıkken her AT/OBD
   * komut çifti 'obdTraffic' olayı olarak akar (OBD el sıkışması + ham DTC yanıtı —
   * adb'siz, ekrandan-okunur teşhis). Varsayılan KAPALI. Opsiyonel: eski plugin'de yok.
   */
  setObdTrafficCapture?(opts: { enable: boolean }): Promise<{ enabled: boolean }>;

  /**
   * Teşhis HTTP sunucusunu başlatır (sabit port 8899). PC aynı WiFi'dan
   * http://<ip>:8899/ ile ham OBD trafiğini JSON çeker — adb'siz teşhis.
   * Opsiyonel: eski plugin'de yok.
   */
  startDiagServer?(): Promise<{ ip: string; port: number }>;
  stopDiagServer?(): Promise<void>;

  // Patch 11A: Mode 07 (bekleyen) / Mode 0A (kalıcı) DTC. Opsiyonel: eski plugin
  // sürümlerinde bulunmayabilir (dtcService fail-soft çağırır).
  readPendingDTC?(): Promise<{ codes: string[] }>;
  // supported=false → araç/adaptör Mode 0A'yı hiç desteklemiyor (2010 öncesi araçlar) —
  // "kalıcı kod yok" (supported:true, codes:[]) ile KARIŞTIRILMAZ.
  readPermanentDTC?(): Promise<{ codes: string[]; supported: boolean }>;

  /**
   * P0-OBD-09 — TEK DTC SINIFINI HAM yanıtla birlikte okur.
   *
   * NEDEN AYRI METOT: mevcut `readDTC`/`readPendingDTC`/`readPermanentDTC`
   * yalnız ÇÖZÜMLENMİŞ kod döndürür. Çözümleyicinin kendisi hatalı olduğunda
   * (P0-OBD-09 kök nedeni tam olarak buydu) hiçbir ekran o hatayı göremez.
   * Bu metot ham yanıtı da taşır → CAROS LAB "ne geldi / ne çözümlendi"yi
   * YAN YANA gösterebilir. Eski metotlar DEĞİŞMEDİ.
   *
   * `supported:false` YALNIZ açık negatif yanıt (7F) / "?" içindir —
   * "NO DATA" desteklenmiyor DEMEK DEĞİLDİR.
   */
  readDtcClass?(options: { mode: '03' | '07' | '0A' }): Promise<{
    codes: string[];
    raw: string;
    supported: boolean;
    /**
     * P0-OBD-11 — okumanın ÖLÇÜLEN sonucu. `supported` bunu TAŞIYAMAZ: eskiden
     * "NO DATA" (ECU sustu) da "43 00" (ECU cevap verdi, kod yok) da
     * `supported:true, codes:[]` idi → ürün ECU sustuğu anda "temiz" diyordu.
     *
     * OK | NO_RESPONSE | UNSUPPORTED | BUS_ERROR | NO_SID
     * Alan YOKSA eski plugin — TS geri-uyumlu yola düşer.
     */
    outcome?: string;
    /** Bu okumanın uçtan uca süresi (ms). */
    elapsedMs?: number;
    /** Okuma anındaki aktif ATDPN protokolü; alan yoksa bilinmiyor. */
    protocol?: string;
    /**
     * Okuma anındaki KWP kurtarma sayacı. İki okuma arasında ARTMIŞSA tarama
     * ortasında recovery (ATPC/reinit) olmuştur.
     */
    recoveryCount?: number;
  }>;

  // Patch 11B: Mode 02 freeze frame — native yalnız HAM veri döner, çözümleme TS'te
  // (StandardPidRegistry.decode, Mode 01 ile AYNI formül). Opsiyonel: eski plugin.
  readFreezeFrameDtc?(): Promise<{ dtc: string | null }>;
  readFreezeFramePid?(opts: { pid: string }): Promise<{ data: string | null }>;

  // Patch 11C: tek-seferlik jenerik Mode 01 PID okuma — watchPid rotasyonuna dahil
  // olmayan bit/enum PID'ler (01/03/1C) için. Opsiyonel: eski plugin sürümlerinde
  // bulunmayabilir (fail-soft çağrılır).
  readPidOnce?(opts: { pid: string }): Promise<{ data: string | null }>;

  // Patch 12A: UDS Mode 22 (ReadDataByIdentifier) — üretici-özel DID okuma. ECU header
  // (tx/rx, ör. '7E0'/'7E8') native tarafta ATOMİK ayarlanır+restore edilir (bkz.
  // ElmProtocol.withEcuHeader). supported:false → DID desteklenmiyor (7F22 31/33 veya
  // NO DATA) — kalıcı işaretlenmeli, bir daha sorulmamalı. Opsiyonel: eski plugin
  // sürümlerinde bulunmayabilir (manufacturerPidService fail-soft çağırır).
  // PR-OBD-KWP-1 genişletmesi: service '22' (UDS ReadDataByIdentifier, varsayılan) |
  // '21' (KWP ReadDataByLocalIdentifier — Trafic gibi ISO 14230 araçların üretici verisi).
  // tx/rx BOŞ string olabilir → native header'a HİÇ dokunmaz (varsayılan oturum adreslemesi;
  // KWP'de en olası başarı yolu). tx: '' | 3 hane (11-bit CAN) | 6 hane (KWP 3-bayt) | 8 hane (29-bit).
  /**
   * PR-CAP-2: `kind`/`nrc` HAM KANITTIR — kararı TS verir (`capabilityOutcome`).
   * `data`/`supported` eski anlamlarıyla korunur (geriye dönük uyum).
   *
   * `kind`/`nrc` ESKİ APK'da GELMEZ (undefined) → çağıran `nrc: null` ile muhafazakâr
   * dala düşer (kalıcı eleme YOK). Hat hatası burada REJECT'tir (araç yeteneği hakkında
   * kanıt DEĞİL → çağıran 'timeout' sayar ve hiçbir şey öğrenmez).
   */
  readObdDid?(opts: { tx: string; rx: string; did: string; service?: '22' | '21' }): Promise<{
    data: string | null;
    supported: boolean;
    kind?: 'OK' | 'NO_DATA' | 'NEG_7F';
    nrc?: number | null;
  }>;

  // Uygulama içi OBD cihaz tarama (pair gerektirmeden keşfeder)
  startOBDDiscovery(): Promise<void>;
  stopOBDDiscovery(): Promise<void>;

  // Eşleşmiş (bonded) bir OBD cihazının pairing'ini siler (unpair) — taramada
  // kalan eski/erişilemez "Eşli" kaydı kaldırır; sonraki taramada listelenmez.
  forgetOBDDevice(opts: { address: string }): Promise<{ success: boolean }>;

  // Bir cihazın Android bonding (eşleşme) durumunu sorgular — PIN Resilience için:
  // bağlantı sonrası cihaz bonded ise PIN'e bir daha gerek yoktur (bonding kalıcı).
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (obdService try/catch ile çağırır).
  getObdBondState?(opts: { address: string }): Promise<{ bonded: boolean }>;

  // Patch 6 (AdaptivePollingController): FAST grup (hız/RPM) native poll periyodunu
  // cihaz sınıfı + aktif RuntimeMode'a göre günceller. uiHz native'de şu an yoksayılır
  // (ileride native-taraflı throttling için saklı). Opsiyonel: eski plugin sürümlerinde
  // bulunmayabilir (obdService varlık kontrolü + catch ile çağırır — fail-soft).
  setObdPollProfile?(opts: { fastMs: number; uiHz?: number }): Promise<void>;

  /**
   * PR-CAN-RECOVER: CAN ECU-silent kurtarma basamağı. Karar TS'te (eşik/cooldown/backoff/
   * tavan obdService'te); native yalnız komutu uygular. İkisi de SALT oturum komutudur —
   * ECU'ya YAZMAZ.
   *   'protocol_close' → ATPC; ELM bir sonraki istekte protokolü taze kurar (transport'a dokunmaz)
   *   'elm_reinit'     → ATWS + init dizisi (öğrenilmiş ATSP korunur; transport'a dokunmaz)
   * Opsiyonel: eski APK'da YOK → çağıran guard'lar ve basamağı ATLAR (fail-soft).
   */
  recoverObdSession?(opts: { level: 'protocol_close' | 'elm_reinit' }): Promise<{ ok: boolean }>;

  /**
   * PR-KWP-EVID: native KWP ölü-oturum kurtarma kanıtı (bounded sayaç + son durum).
   * Ham log DÖNMEZ. CAN'de status NOT_ATTEMPTED + sayaçlar 0 (kapı KWP'ye özel).
   * Opsiyonel: eski APK'da yok → çağıran null snapshot ile fail-soft.
   */
  getObdKwpRecoveryEvidence?(): Promise<{
    status: string;
    coreNoDataStreak: number;
    maxCoreNoDataStreak: number;
    recoveryCount: number;
    /** #642 — TAVAN kararının baktığı sayaç. Eski APK vermez → alan YOK olabilir. */
    consecutiveFailedRecoveries?: number;
    suppressedCount: number;
    atpcSendFailures: number;
    lastRecoveryAt: number;
    lastRecoveryToFirstPidMs: number;
    killedByDataGate: number;
    protocolAtRecovery: string | null;
    threshold: number;
    maxPerSession: number;
    lastEvent?: 'NONE' | 'NO_DATA' | 'PROMPT_TIMEOUT' | 'PARTIAL_TIMEOUT' | 'ECU_SILENT' |
      'SESSION_RECOVERY' | 'TRANSPORT_RECONNECT' | 'RECOVERED' | 'RECOVERY_FAILED';
    noDataCount?: number;
    promptTimeoutCount?: number;
    partialTimeoutCount?: number;
    ecuSilentCount?: number;
    sessionRecoveryCount?: number;
    transportReconnectCount?: number;
    recoveredCount?: number;
    recoveryFailedCount?: number;
    maxCommandDurationMs?: number;
    maxKeepAliveGapMs?: number;
    keepAliveGapExceededCount?: number;
  }>;

  /** PR-KWP-EVID: JS Data Gate oturumu yıktı → native kanıta işlensin (ateşle-unut). */
  notifyObdDataGateTeardown?(): Promise<void>;

  // Patch 8: EXTENDED grup PID listesi (talep-güdümlü — extendedPidService yönetir).
  // Boş liste = devre dışı (native poll turu ek komut çalıştırmaz, sıfır maliyet).
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (fail-soft çağrılır).
  setObdExtendedPids?(opts: { pids: string[] }): Promise<void>;
  /**
   * ÇEKİRDEK poll PID kümesini oturum İÇİNDE günceller (eski APK'da YOKTUR → opsiyonel).
   * Boş liste = filtre yok (eski davranış), "hiç sorma" DEĞİL.
   */
  setObdCorePids?(opts: { pids: string[] }): Promise<void>;

  // Teşhis BURST modu (OBD Canlı Test ekranı) — açıkken EXTENDED grubunun tüm izlenen
  // PID'leri her poll turunda okunur (hızlı tazeleme). Ekran kapanınca kapatılır.
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (fail-soft çağrılır).
  setObdDiagnosticBurst?(opts: { enable: boolean }): Promise<{ enabled: boolean }>;

  // PR-OBD-DIAG-3: EXTENDED PID poll hattı tanı KANITI — oturumluk bounded sayaçlar
  // (attempted/success/callbackEmitted…) + son 8 deneme. "Tanı Gönder" H1/H2/H3 ayrımı için.
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (fail-soft: kanıt yok → NO_NATIVE_EVIDENCE).
  getObdExtendedPollEvidence?(): Promise<NativeExtendedPollEvidence>;

  /**
   * P0-VDK-B3 — poll hattının GERÇEK maliyeti (salt-okunur; komut TETİKLEMEZ).
   * Opsiyonel: eski APK'da yoktur → fail-soft, "maliyet ÖLÇÜLEMEDİ" (0 DEĞİL).
   */
  getObdPollCost?(): Promise<NativePollCost>;

  /**
   * #524 — extended PID ELEME durumu (salt-okunur teşhis; araca komut GÖNDERMEZ).
   * Sahada izlenen PID sayısı 6'ya düşüyordu ve "neden sorulmuyor" cevapsızdı.
   * Opsiyonel: eski APK'da yok → fail-soft (`unsupported`).
   */
  getObdExtendedElimination?(): Promise<{
    cycle: number; watchedCount: number;
    permanentCount: number; pausedCount: number; everOkCount: number;
    bulkResetCount: number; lastBulkCycle: number;
    stabilizing: boolean; stabilizeCycles: number; suppressedDuringStabilize: number;
    demoteThreshold: number;
    permanentPids: string[];
    pausedRemainingCycles: Record<string, number>;
    pauseLadder: number[];
    reasonNeverOk: string; reasonPaused: string;
  }>;

  /* ── H-A DENEYİ (kütük #518-HA) — ATST yanıt süresi ölçümü ────────────────
     Ürün yolunu DEĞİŞTİRMEZ: poll durmaz, eleme öğrenmesi beslenmez, ayar
     bitişte geri alınır. Native yalnız HAM örnek taşır; analiz TS'te (saf). */
  startPidTimingExperiment?(o: { pids: string[]; rounds: number; stHex: string }):
    Promise<{ started: boolean; reason?: string }>;
  abortPidTimingExperiment?(): Promise<void>;
  /* #523 — ARAYÜZ NATIVE İLE HİZALANDI. Native bu alanları ZATEN gönderiyordu
     (`OBDManager.getPidTimingExperimentJson`: stRestored/B7 · deney penceresi/B5 ·
     sinceConnectMs · readDeadlineMs/B2 · queueWaitMs/B4) ama arayüzde tanımlı
     olmadıkları için köprü onları OKUYAMIYORDU → ekranda "ATST geri alındı:
     UNKNOWN" görünüyordu. Native sağlamdı; eksik olan bu sözleşmeydi. */
  getPidTimingExperiment?(): Promise<{
    status: string; running?: boolean; failReason?: string | null;
    /** B7 — ATST geri alma sonucu: 'true' | 'false' | 'UNKNOWN'. */
    stRestored?: string;
    /** B5 — deney penceresi; sonraki saha okumaları bu trafiği ayırabilsin. */
    experimentStartMs?: number;
    experimentEndMs?: number;
    phases: { phase: string; stApplied: string; stCommandOk: boolean;
              startedAt: number; finishedAt: number;
              /** Aşama bağlantıdan kaç ms sonra başladı. -1 = bilinmiyor. */
              sinceConnectMs?: number;
              /** B2 — okuma deadline'ı (ATST'ye göre ölçeklenir). */
              readDeadlineMs?: number }[];
    samples: { phase: string; pid: string; outcome: string;
               elapsedMs: number; respLen: number;
               /** B4 — kuyrukta bekleme; saf komut süresinden AYRI taşınır. */
               queueWaitMs?: number }[];
  }>;

  // PHONE-HUB P0.5: SALT-OKUNUR donanım gözlemi (Bluetooth adapter/profil/izin,
  // vendor paket varlığı, audio route). Hiçbir şey BAŞLATMAZ: keşif/tarama/eşleştirme/
  // bağlantı/SCO/route değişimi/çağrı/izin isteği YOK. PII TAŞIMAZ (ad/MAC gönderilmez).
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (fail-soft → present:false).
  getPhoneHubHardwareProbe?(): Promise<NativePhoneHubProbe>;

  // PHONE-HUB P0.8: SALT-OKUNUR SAHA DOĞRULAMA gözlemi (cihaz kimliği/rol işaretleri,
  // Telecom-dialer SINIFI, MediaSession erişimi ve anonim sahip sayımı). P0.5 metodunu
  // EZMEZ — yanına eklenir. Hiçbir şey BAŞLATMAZ; medya/çağrı komutu ve izin isteği YOK.
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (fail-soft → present:false).
  getPhoneHubFieldProbe?(): Promise<NativePhoneHubFieldProbe>;

  // MAVI-STT-LAB-1: SALT-OKUNUR mikrofon + STT zinciri gözlemi (AudioSource seçimi,
  // AEC/NS/AGC available/created/enabled, RMS/noise-floor/VAD eşiği, grammar SINIFI
  // ve son sonuç KATEGORİSİ). Mikrofon açmaz/kapatmaz, eşik değiştirmez, motor
  // başlatmaz. Transcript / n-best / ham ses TAŞIMAZ.
  // Opsiyonel: eski plugin sürümlerinde bulunmayabilir (fail-soft → present:false).
  getVoiceMicDiagnostics?(): Promise<NativeVoiceMicDiagnostics>;

  // Bluetooth bağlantı değişiklikleri — araç BT sistemine bağlan/bağlantı kes
  addListener(
    event: 'btChanged',
    handler: (data: { connected: boolean; deviceName: string }) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    event: 'obdDeviceFound',
    handler: (data: {
      name: string;
      address: string;
      bonded: boolean;
      // Opsiyonel — native taraf "classic" (Classic Bluetooth SPP) veya
      // "ble" (Bluetooth Low Energy) gönderir. Eski yol transport olmadan da çalışır.
      transport?: 'classic' | 'ble';
      // BLE reklam paketinde duyurulan GATT servis UUID'leri. İSİMSİZ bir cihaz için
      // tek pozitif OBD kanıtıdır (bkz. obdDiscovery.classifyObdDevice). Classic yolda
      // ve eski plugin sürümlerinde gelmez → undefined.
      serviceUuids?: string[];
    }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'obdDiscoveryFinished',
    handler: (data: { finished: boolean }) => void,
  ): Promise<PluginListenerHandle>;

  // Recovery key store — Android Auto Backup ile yedeklenir, reinstall sonrası geri gelir
  saveRecoveryKey(options: { key: string; value: string }): Promise<void>;
  loadRecoveryKey(options: { key: string }): Promise<{ value: string }>;

  // Device Key Backup — Google'sız, uninstall'a dayanıklı cihaz-içi dosya yedeği.
  // Head unit'lerde (Google Play Services yok) Android Auto Backup hiç oluşmuyor;
  // bu yol paylaşımlı harici depolamaya yazar (uygulama silinse bile kalır).
  deviceKeyBackupWrite(options: { blob: string }): Promise<void>;
  deviceKeyBackupRead(): Promise<{ blob?: string | null }>;
  deviceKeyBackupStatus(): Promise<{ writable: boolean; needsAllFiles: boolean }>;
  requestAllFilesAccess(): Promise<void>;

  /**
   * Kararlı cihaz kimliği (P0-001C) — reinstall'a DAYANIKLI, çünkü SAKLANMAZ:
   * `sha256(salt | SSAID)` olarak TÜRETİLİR. Ham SSAID JS'e çıkmaz.
   *
   * `deviceId: null` + `source: 'UNAVAILABLE'` → SSAID okunamadı (bazı head unit
   * ROM'ları boş döner). Çağıran bu durumda rastgele kimliğe düşer; sahte bir
   * sabit ASLA üretilmez (o ROM'daki tüm cihazlar tek araca çökerdi).
   */
  getStableDeviceId(): Promise<{ deviceId: string | null; source: 'SSAID' | 'UNAVAILABLE' }>;

  // Native TTS — Android TextToSpeech API (WebView speechSynthesis'den daha güvenilir)
  // pitch (P1-1): setPitch() ile perde; varsayılan 1.0. Her çağrı perdeyi sıfırlar
  // (segmentli çağrıdan kalan perde sonraki tek çağrıya sızmasın).
  speak(options: { text: string; rate?: number; pitch?: number }): Promise<void>;
  // Segmentli seslendirme (P0-2): ilk segment QUEUE_FLUSH, sonrakiler QUEUE_ADD,
  // aralara playSilentUtterance(pauseMs). Promise yalnız SON segment bitince çözülür.
  speakSegments(options: {
    segments: { text: string; rate: number; pitch: number; pauseMs: number }[];
  }): Promise<void>;
  ttsStop(): Promise<void>;

  // Android contacts (READ_CONTACTS permission required)
  requestContactsPermission(): Promise<{ contacts: 'granted' | 'denied' | 'prompt' }>;
  getContacts(): Promise<GetContactsResult>;

  // Background GPS + break reminder foreground service
  startBackgroundService(options?: { gpsGeneration?: number }): Promise<void>;
  /** Binds native foreground GPS events to the current canonical JS GPS generation. */
  setBackgroundGpsGeneration(options: { gpsGeneration: number }): Promise<void>;
  stopBackgroundService():  Promise<void>;

  // Special Android system permissions
  checkWriteSettings():     Promise<{ granted: boolean }>;
  requestWriteSettings():   Promise<void>;
  checkNotificationAccess():  Promise<{ granted: boolean }>;
  requestNotificationAccess(): Promise<void>;

  /**
   * Android 12+ BLUETOOTH_CONNECT ve Android 13+ POST_NOTIFICATIONS için
   * runtime izin diyaloğunu tetikler. Uygulama başlangıcında bir kez çağrılır.
   */
  requestAndroid13Permissions(): Promise<{ requested: number }>;

  // Active media session (Android MediaSessionManager)
  getMediaInfo(options?: { preferredPackage?: string }): Promise<NativeMediaInfo>;

  /**
   * URI bazlı kapak resmini base64 data URI olarak çeker.
   * content://, file://, http(s):// destekler. Yerel MediaStore albumart URI'leri için kullanılır.
   * Native tarafta cache'lenir — aynı URI tekrar sorgulanırsa hemen döner.
   */
  getMediaArtDataUri(options: { uri: string; targetPx?: number }): Promise<{ dataUri: string }>;

  /* ── MÜZİK HUB PAKET A — Native Playback Authority ─────────────────────
   * CarosPlaybackService (Media3 ExoPlayer + MediaSession) tek otoritedir.
   * JS'te bu üç metodun TEK tüketicisi nativeAuthorityBridge.ts'tir;
   * bileşenler ve diğer servisler bunları DOĞRUDAN çağırmaz. */

  /** Typed komut gönderir. Yanıt "kabul edildi" demektir, "çalıyor" DEMEZ. */
  mediaAuthorityCommand(options: {
    commandId: string;
    command: string;
    payload?: Record<string, unknown>;
  }): Promise<{ accepted: boolean; failureCode: string }>;

  /** Otoritenin bounded, salt-okunur anlık görüntüsü. */
  mediaAuthoritySnapshot(): Promise<NativeAuthoritySnapshot>;

  /** Servisi başlatır/bağlar ve mediaAuthorityEvent akışını açar (idempotent). */
  mediaAuthorityConnect(): Promise<void>;

  /* ── MUSIC F6 — Ses Deneyimi / DSP ─────────────────────────────────────
   * TEK tüketici `audioExperienceAuthority`'dir; bileşenler, Mavi ve diğer
   * servisler bu üç metodu DOĞRUDAN çağırmaz. Hiçbiri playback komutu
   * göndermez ve hiçbiri kullanıcı sesini (userVolume) değiştirmez. */

  /** Cihazın GERÇEK DSP yüzeyi. Sorgulanamazsa `probed: false` döner. */
  audioDspCapabilities(): Promise<NativeAudioDspCapabilities>;

  /** Ayarı uygular. `applied:false` → hiçbir şey değişmedi (sahte başarı YOK). */
  audioDspApply(options: NativeAudioDspApplyRequest): Promise<NativeAudioDspApplyResult>;

  /** Efekt katmanının bounded, salt-okunur anlık görüntüsü. */
  audioDspSnapshot(): Promise<NativeAudioDspSnapshot>;

  addListener(
    event: 'mediaAuthorityEvent',
    handler: (data: NativeAuthoritySnapshot) => void,
  ): Promise<PluginListenerHandle>;

  /* ── F2 kütüphane tarama sözleşmesi ────────────────────────────────────
   * MediaStore taramasının TEK giriş noktası mediaStoreRefreshExecutor'dır;
   * bileşenler bu üç metodu DOĞRUDAN çağırmaz. */

  /** Görünür volume'lar + version/generation. Parça sorgusu YAPMAZ. */
  getMediaStoreVolumeFacts(): Promise<MediaStoreVolumeFactsResult>;

  /** Planlayıcının verdiği karara göre tam veya delta parça sorgusu. */
  queryMusicTracks(options: QueryMusicTracksOptions): Promise<QueryMusicTracksResult>;
  /** MUSIC F10.1 — gömülü BPM etiketi okur (sınırlı toplu iş, arka plan havuzu). */
  readTrackTraits(options: { uris: string[] }): Promise<ReadTrackTraitsResult>;
  /** MUSIC F16 — gömülü şarkı sözü etiketi okur (sınırlı toplu iş, arka plan havuzu). */
  readEmbeddedLyrics(options: { uris: string[] }): Promise<ReadEmbeddedLyricsResult>;
  /** MUSIC F17 — sesi DECODE edip ölçer (ayrı havuz, sınırlı toplu iş, iptal edilebilir). */
  analyzeTrackAudio(options: { uris: string[]; maxItems?: number }): Promise<AnalyzeTrackAudioResult>;
  /** MUSIC F17 — devam eden ses analizini iptal eder (kuşak artar). */
  cancelTrackAudioAnalysis(): Promise<{ generation: number }>;

  /** Hedef boyuta göre örneklenmiş (sampled) decode → atomik cache dosyası. */
  resolveArtworkFile(options: { uri: string; targetPx: number }): Promise<ArtworkFileResult>;

  /** Disk LRU tahliyesi/geçersizleştirmesi; politika JS tarafındadır. */
  deleteArtworkFiles(options: { keys?: string[]; all?: boolean }): Promise<{ deleted: number }>;

  /** Native artwork cache dizininin salt-okunur sayıları (CAROS LAB). */
  getArtworkCacheStats(): Promise<{ entries: number; bytes: number; schema: number; dir: string }>;

  // Yerel müzik — cihaz depolamasından MediaPlayer ile çalma
  getMusicTracks(): Promise<GetMusicTracksResult>;
  playLocalTrack(options: { uri: string }): Promise<void>;
  pauseLocalTrack(): Promise<void>;
  resumeLocalTrack(): Promise<void>;
  stopLocalTrack(): Promise<void>;
  seekLocalTrack(options: { positionMs: number }): Promise<void>;
  getLocalTrackPosition(): Promise<{ positionMs: number; durationMs: number; playing: boolean }>;
  addListener(event: 'localMusicProgress', handler: (data: LocalMusicProgressEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localMusicStarted',  handler: (data: { durationMs: number; playing: boolean }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localMusicCompleted',handler: (data: Record<string, never>) => void): Promise<PluginListenerHandle>;
  addListener(event: 'localMusicError',    handler: (data: { error: string }) => void): Promise<PluginListenerHandle>;

  // Yerel video — cihaz depolamasından native VideoView overlay ile oynatma
  getVideoTracks(): Promise<GetVideoTracksResult>;
  playVideoNative(options: { uri: string; title?: string }): Promise<void>;
  closeVideoNative(): Promise<void>;
  addListener(event: 'videoStarted',   handler: (data: { durationMs: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'videoCompleted', handler: (data: Record<string, never>) => void): Promise<PluginListenerHandle>;
  addListener(event: 'videoError',     handler: (data: { error: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'videoClosed',    handler: (data: Record<string, never>) => void): Promise<PluginListenerHandle>;

  // Camera2 API — geri görüş kamerası (CAMERA permission required)
  openCamera(options: { facing: 'back' | 'front' }): Promise<{ cameraId: string }>;
  closeCamera(): Promise<void>;
  captureFrame(): Promise<{ imageData: string }>; // base64 JPEG, data URI prefix yok

  // Dashcam kayıt durumunu foreground servis bildirimine yansıt
  setDashcamActive(options: { active: boolean }): Promise<void>;

  /**
   * Navigasyon oturumu durumunu foreground servise bildirir.
   *
   * NEDEN: servisin park kısması (5 dk hareketsizlik → 1 Hz GPS kapanır)
   * navigasyondan habersizdi; uzun ışıkta kısılıp kalkışta ilk ~60 m'yi kör
   * bırakıyordu. Bu bayrak yalnız o kısmayı devre dışı bırakır — konum izni
   * istemez, yeni akış başlatmaz, ikinci bir konum otoritesi KURMAZ.
   */
  setNavigationActive(options: { active: boolean }): Promise<void>;

  /**
   * PIN güvenliği — Android Keystore + EncryptedSharedPreferences
   *
   * Java implementasyonu (CarLauncherPlugin.java):
   *   setPinHash   → EncryptedSharedPreferences.putString("pin_hash", hash)
   *   verifyPin    → hash(attempt).equals(prefs.getString("pin_hash"))
   *   clearPin     → EncryptedSharedPreferences.remove("pin_hash")
   *
   * Bu metodlar TypeScript'te tanımlıdır; Java tarafı yoksa
   * pinService.ts sessionStorage fallback'ine düşer.
   */
  setPinHash(options: { hash: string }): Promise<void>;
  verifyPin(options: { attempt: string }): Promise<{ match: boolean }>;
  clearPin(): Promise<void>;

  /**
   * Expert Trust mühürü — HMAC-SHA256 anahtarı Android Keystore'da tutulur (ham seed WebView'da yok).
   */
  expertTrustHmacSign?(options: { canonical: string }): Promise<{ sigHex: string }>;
  expertTrustHmacVerify?(options: { canonical: string; sigHex: string }): Promise<{ valid: boolean }>;

  addListener(
    event: 'obdStatus',
    handler: (data: OBDStatusEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'obdData',
    handler: (data: NativeOBDData) => void,
  ): Promise<PluginListenerHandle>;
  // Patch 8: EXTENDED grup ham PID sonucu — pid: 2 hane hex ('5C'), data: başlığı
  // soyulmuş ham data hex ('8C'). Çözümleme StandardPidRegistry'de (TS).
  addListener(
    event: 'obdExtendedData',
    handler: (data: { pid: string; data: string }) => void,
  ): Promise<PluginListenerHandle>;
  // PR-OBD-KWP-1: EXTENDED PID oturum-içi demote bildirimi — pid ardışık NO_DATA/7F
  // kanıtıyla turdan düşürüldü (status: 'no_data'). Demote başına TEK olay.
  addListener(
    event: 'obdExtendedPidStatus',
    handler: (data: { pid: string; status: string }) => void,
  ): Promise<PluginListenerHandle>;
  // Teşhis ham trafik: cmd=gönderilen komut, resp=ham yanıt ('⚠ ' öneki=hata),
  // ms=süre, ts=epoch. Yalnız setObdTrafficCapture(true) sonrası akar.
  addListener(
    event: 'obdTraffic',
    handler: (data: { cmd: string; resp: string; ms: number; ts: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'mediaChanged',
    handler: (data: NativeMediaInfo) => void,
  ): Promise<PluginListenerHandle>;

  // Passenger HTTP server — yolcu müzik kontrolü
  startPassengerServer(): Promise<PassengerServerResult>;
  stopPassengerServer(): Promise<void>;
  updatePassengerState(options: PassengerStateOptions): Promise<void>;

  addListener(
    event: 'passengerCommand',
    handler: (data: PassengerCommandEvent) => void,
  ): Promise<PluginListenerHandle>;

  /** Arka planda GPS konum güncellemesi (CarLauncherForegroundService'den) */
  addListener(
    event: 'backgroundLocation',
    handler: (data: {
      lat: number; lng: number;
      speed: number; bearing: number; accuracy: number;
      observationTimestamp: number;
      gpsGeneration: number;
    }) => void,
  ): Promise<PluginListenerHandle>;

  /** Mola hatırlatıcısı — 2 saatlik kesintisiz sürüşte tetiklenir */
  addListener(
    event: 'breakReminder',
    handler: (data: { drivingMinutes: number }) => void,
  ): Promise<PluginListenerHandle>;

  // ── OBD Bluetooth Auto-Pair ──────────────────────────────────────────────
  /**
   * OBD BT otomatik eşleştirme ve bağlantı sürecini başlatır.
   * userConfirmed=true → silent PIN pairing etkin (kullanıcı onayladı).
   * userConfirmed=false → yalnızca bilinen + bonded cihaz denenir.
   */
  startOBDBluetooth?(opts: { userConfirmed: boolean }): Promise<void>;
  stopOBDBluetooth?(): Promise<void>;
  /** FALLBACK_USER_ACTION_REQUIRED durumunda kullanıcı "Bağlan" butonuna bastı. */
  userConnectOBD?(): Promise<void>;
  /** Kayıtlı OBD cihaz bilgisini döner (mac + name). Kayıt yoksa boş obje. */
  getSavedOBDDevice?(): Promise<Partial<SavedOBDDevice>>;
  clearSavedOBD?(): Promise<void>;

  addListener(
    event: 'obdBtState',
    handler: (data: OBDBtStateEvent) => void,
  ): Promise<PluginListenerHandle>;

  startCanBus?(): Promise<void>;
  stopCanBus?(): Promise<void>;
  /** MCU event sniffer — K250/Hiworld keşif modu */
  startMcuSniff?(): Promise<void>;
  stopMcuSniff?(): Promise<void>;
  /**
   * Test protokolü marker — canDiag kanalına "[MARKER] name ts=…" yazar.
   * Fiziksel olay öncesi çağrılır; log korelasyonu için kullanılır.
   */
  insertTestMarker?(opts: { marker: string }): Promise<void>;

  /**
   * ELM327 iCar'ı ATMA (Monitor All) moduna geçirir.
   * OBD bağlı olmalı. Tüm CAN frame'leri canDiag kanalına akar (diff + throttle filtreli).
   * CAN write yapmaz — sadece dinler.
   */
  startRawCanScan?(): Promise<void>;
  stopRawCanScan?(): Promise<void>;
  /** USB serial adaptörler için izin ister (CH340, CP2102, FTDI, CDC ACM) */
  requestUsbCanPermission?(): Promise<{ requested: number }>;

  /** Araç CAN ID yapılandırmasını günceller ve SharedPreferences'a kalıcı yazar. */
  setCanIds?(ids: Partial<CanIdConfig>): Promise<void>;
  /** Mevcut CAN ID yapılandırmasını döner. */
  getCanIds?(): Promise<CanIdConfig>;
  /** CAN sniffer'ı açar/kapatır — aktifken her frame `canRawFrame` olarak emit edilir. */
  setCanSnifferEnabled?(options: { enabled: boolean }): Promise<void>;

  /**
   * ARCH-06/F1 — CAN köprü ÖLÇÜM anlık görüntüsü (SALT-OKUNUR).
   *
   * Yan etkisiz: sayaçları SIFIRLAMAZ, emit tetiklemez, sniffer açmaz.
   * Sayaçlar MONOTONİKTİR — pencere hızı isteyen taraf iki okuma arasındaki
   * FARKI alır. Ham CAN yükü, CAN ID ve sinyal değeri TAŞINMAZ.
   *
   * `?` işareti bilinçlidir: eski APK bu metodu taşımaz → TS tarafı
   * `UNAVAILABLE` gösterir, sahte 0 ÜRETMEZ.
   */
  getCanBridgeMetrics?(): Promise<{
    inputCount: number;
    emitCount: number;
    coalescedOverwriteCount: number;
    dedupSkippedCount: number;
    safetyBypassCount: number;
    snifferEmitCount: number;
    windowMs: number;
    snifferActive: boolean;
  }>;

  // ── Native Guard Bridge ───────────────────────────────────────────────
  /** WebView yaşıyor sinyali — native taraf 3s heartbeat görmezse WebView crashed kabul eder */
  sendHeartbeat?():                                  Promise<void>;
  /** RuntimeMode değişimini native taraf bildirimine yansıt */
  setNativeMode?(opts: { mode: string }):            Promise<void>;
  /** Odometer km değerini Android SharedPreferences'a atomik yaz */
  persistOdometer?(opts: { km: number }):            Promise<void>;
  /** Son persist edilen odometer değerini oku — crash sonrası kurtarma için */
  getPersistedOdometer?():                           Promise<{ km: number }>;

  /* H-4 MCU komutları — CAN bus üzerinden araç kontrolü.
   *
   * ⚠️ Dönüş tipi BİLEREK `void` DEĞİLDİR. `Promise<void>` olduğu sürece native'in
   * bildirdiği `sent` bayrağı TİP SEVİYESİNDE görünmez oluyordu; köprü de onu
   * okumadan `completed` üretiyordu → MCU bağlı değilken kullanıcıya "Kapılar
   * kilitlendi" deniyordu. Sonucu tipe taşımak bu sınıf hatayı derleme zamanında
   * imkânsız kılar. */
  lockDoors():    Promise<NativeVehicleCommandResult>;
  unlockDoors():  Promise<NativeVehicleCommandResult>;
  honkHorn():     Promise<NativeVehicleCommandResult>;
  flashLights():  Promise<NativeVehicleCommandResult>;
  triggerAlarm(): Promise<NativeVehicleCommandResult>;
  stopAlarm():    Promise<NativeVehicleCommandResult>;

  // H-4 Native Command Service — CommandService.java kuyruk okuma
  /** CommandService.java'nın WebView yokken biriktirdiği komut kuyruğunu okur (JSON) */
  getQueuedNativeCommands?(): Promise<{ commands: string }>;
  /** MCU sonuç listesini okur — startup'ta Supabase status sync için */
  getNativeCommandResults?(): Promise<{ results: string }>;
  /** Hem komut kuyruğunu hem sonuç listesini temizler */
  clearNativeCommandQueue?(): Promise<void>;

  /**
   * OBD El Sıkışması — bağlantı ısınma sonrası çağrılır (W5-OBD-PR1).
   * Native katman ham ELM327 yanıtlarını döndürür; ayrıştırma TS'te
   * (`buildHandshakeResult`, tek doğruluk kaynağı). Sorgular:
   *   • `09 02` → Mode 09 PID 02 — VIN (ASCII)
   *   • `01 00` → Mode 01 PID 00 — desteklenen PID bitmask (PIDs 01–20)
   *   • `01 20/40/60/80/A0` → süreklilik-bit'i set ise ek bitmap blokları
   *     (PIDs 21–192). Native, önceki bloğun son bit'i (PID 0x20/0x40 …) set
   *     DEĞİLSE sonraki bloğu HİÇ sormaz → desteklenmeyen PID poll edilmez,
   *     NO-DATA fırtınası oluşmaz.
   *
   * @returns raw09   — `09 02` ham ASCII yanıtı (VIN)
   *          raw0100 — `01 00` ham ASCII yanıtı (zorunlu)
   *          raw0120…raw01A0 — sorgulanmayan blok için boş string ('')
   *
   * Opsiyonel (`?`): eski plugin versiyonlarında graceful degrade için.
   * Native hiçbir exception dışarı sızdırmaz (fail-soft); yine de çağrı
   * başarısız olursa obdService .catch ile yakalar. Eski native yalnız
   * {raw09, raw0100} döndürebilir — ek alanlar undefined (geriye dönük uyumlu).
   */
  performHandshake?(): Promise<{
    raw09:    string;
    raw0100:  string;
    raw0120?: string;
    raw0140?: string;
    raw0160?: string;
    raw0180?: string;
    raw01A0?: string;

    /**
     * P0-OBD-CORE-01B — blok başına YAPILAN deneme sayısı (00,20,40,60,80,A0).
     * `0` = blok HİÇ sorgulanmadı. Bu alan olmadan "boş yanıt" ile "hiç sorulmadı"
     * ayırt edilemez; sahadaki `supportedCount ≈ 15` şüphesi tam olarak bu
     * belirsizlikten doğuyordu. Eski plugin taşımaz → `undefined`.
     */
    blockAttempts?: number[];
    /**
     * Zincirin KESİN OLMAYAN bir yanıt yüzünden durduğu blok indeksi; yoksa `-1`.
     * `>= 0` iken keşif EKSİKTİR → "araç desteklemiyor" çıkarımı YASAKTIR.
     */
    failedBlockIndex?: number;
    /** Native'in blok başına uyguladığı deneme tavanı (gözlem için). */
    maxBlockAttempts?: number;
  }>;

  /**
   * OBD-OS-F2-1: fonksiyonel ECU probu — `ATH1` + `0100` (7DF broadcast). Araçtaki yanıt
   * veren TÜM ECU'ların header'lı HAM cevabı döner; ayrıştırma TS'te (`ecuDiscovery.ts`).
   * Native yanıt başlıklarını (ATH0) MUTLAKA geri kapatır; kapatamazsa reject eder
   * (header açık kalırsa standart poll parse'ı sessizce bozulurdu).
   *
   * Opsiyonel (`?`): eski plugin sürümlerinde yok → çağıran guard'lar (graceful degrade).
   */
  probeEcus?(): Promise<{ raw: string }>;

  /**
   * OBD-OS-F3-5: adaptör kimlik probu — `ATI` + `AT@1` + `STDI` ham yanıtları,
   * `'|'` ile ayrılmış tek dizge (`"ELM327 v1.5|?|?"` gibi; parçalar boş olabilir).
   *
   * NEDEN: piyasadaki "ELM327 v1.5" adaptörlerin çoğu KLONdur ve etiketteki
   * yetenekleri (29-bit adresleme, flow-control) taşımaz. Klonu gerçek sanmak,
   * desteklenmeyen komut göndermeye ve SESSİZ başarısızlığa yol açar — yetenek
   * etiketten değil DAVRANIŞTAN çıkarılır.
   *
   * Ayrıştırma BURADA YAPILMAZ: tek sınıflandırma kaynağı `adapterCapability.ts`.
   * Opsiyonel (`?`): eski plugin sürümlerinde yok → çağıran guard'lar.
   */
  probeAdapterIdentity?(): Promise<{ raw: string }>;

  /**
   * OBD-OS-F2-3: belirli bir ECU'dan DTC okur (fiziksel adresleme, Mode 03/07/0A).
   * Native `withEcuHeader` ile header set → oku → restore ATOMİK yapılır (yanlış ECU'ya
   * sızıntı imkânsız). `supported:false` = ECU o modu desteklemiyor (hata DEĞİL — bilgi).
   *
   * Opsiyonel (`?`): eski plugin sürümlerinde yok → çağıran guard'lar (graceful degrade).
   */
  readDtcFromEcu?(options: { tx: string; rx: string; mode: '03' | '07' | '0A' }): Promise<{
    codes: string[];
    supported: boolean;
    /**
     * P0-OBD-FINAL-01 — HAM yanıt (kırpılmış). Eski APK bu alanı TAŞIMAZ →
     * `undefined`. Boş string "ham geldi ama boştu" demektir; ikisi KARIŞTIRILMAZ.
     */
    raw?: string;
    /**
     * P0-OBD-FINAL-01 — native'in ÖLÇTÜĞÜ sonuç sınıfı:
     * `OK` (pozitif SID geldi — 0 kod olabilir) · `NO_RESPONSE` (ECU SUSTU) ·
     * `UNSUPPORTED` (açık 7F / '?') · `BUS_ERROR` · `NO_SID`.
     *
     * `supported` bu ayrımı TAŞIYAMAZ: "43 00" ile "NO DATA" ikisi de
     * `supported:true, codes:[]` idi — yani ECU sustuğunda ürün "temiz" diyordu.
     * Eski APK'da `undefined` → çağıran eski (kaba) sözleşmeye düşer.
     */
    outcome?: string;
    elapsedMs?: number;
    recoveryCount?: number;
    /** Okuma anındaki aktif ATDPN protokolü; native taşımıyorsa `undefined`. */
    protocol?: string;
  }>;

  /**
   * P0-OBD-05 — SAE J1979 Servis 06 (On-Board Monitoring Test Results). SALT-OKUNUR.
   *
   * İstek `06 <MID>`; olumlu yanıt öneki (`46` + MID) SOYULMUŞ ham hex döner.
   * Çözümleme TS'tedir (`mode06.ts`) — bu dosyanın felsefesi: native KARAR VERMEZ.
   *
   * ÇOK-ÇERÇEVE ZORUNLUDUR: bir test kaydı 9 bayt + servis baytı = 10 bayt, CAN
   * tek çerçevesine (7 bayt) SIĞMAZ. Native mevcut ISO-TP birleştiricisini
   * (`ElmProtocol.splitResponseBodies`) yeniden kullanır — ikinci birleştirici YOK.
   *
   * `kind`: 'OK' | 'NO_DATA' | 'ERROR' — HAM KANITTIR, karar TS'te verilir.
   * NO_DATA "test geçti" DEĞİLDİR; ECU sustu demektir.
   *
   * `tx`/`rx` BOŞ olabilir → native header'a dokunmaz (fonksiyonel adresleme).
   * Dolu ise `withEcuHeader` ile ATOMİK set→oku→restore yapılır (yanlış ECU'ya
   * sızıntı imkânsız — çoklu ECU provenance'ı bu sayede korunur).
   *
   * Opsiyonel (`?`): eski plugin sürümlerinde yok → çağıran fail-soft guard'lar.
   */
  readMode06?(options: { tx: string; rx: string; mid: string }): Promise<{
    data: string | null;
    kind: 'OK' | 'NO_DATA' | 'ERROR';
  }>;

  /**
   * OBD-OS-F3-1: UDS Service 0x19-02 (ReadDTCInformation) — ÜRETİCİ-ÖZEL DTC'ler.
   * Standart Mode 03/07/0A yalnız emisyon (P0…) kodlarını verir; Renault DF…, VAG, BMW
   * kodları burada yaşar. Ham hex ("5902" soyulmuş) döner — ayrıştırma TS'te (`udsDtc.ts`).
   * `supported:false` = ECU 0x19'u desteklemiyor (NRC 0x11/0x12/0x31 → hata DEĞİL).
   */
  readUdsDtcs?(options: { tx: string; rx: string; statusMask?: string }): Promise<{
    raw: string;
    supported: boolean;
  }>;

  /**
   * V-08 — KWP2000 Service 0x18 (ReadDTCByStatus): KWP araçlarda üretici DTC'leri.
   *
   * UDS 0x19'un KWP KARŞILIĞIDIR — KWP araçlarda (Renault sınıfı, çoğu 2000-2008
   * Avrupa aracı) 0x19 YOKTUR. Ham hex döner ("58" soyulmuş); ayrıştırma `kwpDtc.ts`
   * tek kaynağındadır (KWP DTC 2 BAYTTIR, UDS'te 3 — aynı çözücü listeyi kaydırır).
   *
   * `supported:false` = ECU 0x18'i desteklemiyor (hata DEĞİL).
   */
  readKwpDtcs?(options: { tx: string; rx: string }): Promise<{
    raw: string;
    supported: boolean;
  }>;

  /**
   * P0-OBD-FINAL-02 — KWP2000 TANI OTURUMU PROBU (servis 0x10). SALT-OKUNUR KANIT.
   *
   * NEDEN: sahada (Protocol 5 / KWP · ECU 7A) fonksiyonel sorgular cevap verirken
   * FİZİKSEL `817AF1` susuyordu. Sessizliğin iki ayrı nedeni olabilir — ECU o
   * adreste YOK, ya da ECU TANI OTURUMU AÇILMADAN fiziksel isteğe cevap vermiyor.
   * Bu ikisini ayırmanın TEK yolu oturum komutunu KANIT olarak göndermektir.
   *
   * Native `10 81` (ISO 14230-4 standart tanı oturumu) gönderir; pozitif kabul
   * `50 81`. Yanıt yoksa/negatifse `10 C0` (Renault/PSA genişletilmiş oturum,
   * pozitif kabul `50 C0`) denenir. Her ikisi de SALT OTURUM komutudur: ECU'ya
   * YAZMAZ, security access DEĞİLDİR.
   *
   * `withEcuHeader` ile ATOMİK set→gönder→restore yapılır (yanlış ECU'ya sızıntı
   * imkânsız). Ayrıştırma/karar TS'tedir (`kwpSessionProbe.ts` tek kaynak):
   * native yalnız HAM yanıt + ölçülen sonuç sınıfını taşır.
   *
   * Opsiyonel (`?`): eski plugin sürümlerinde yok → çağıran guard'lar
   * (graceful degrade; kanıt yoksa oturum "UNKNOWN" kalır, uydurulmaz).
   */
  /**
   * P0-OBD-DIAG-01 — KWP FİZİKSEL ADRESLEME MATRİSİNİN TEK SATIRI (SALT-OKUMA).
   *
   * `header` (ATSH değeri) ve `request` TS'ten gelir — matrisin tek sahibi
   * `kwpAddressingProbe.ts`tir; native yalnız GÖNDERİR ve ham yanıtı taşır.
   * Native ayrıca kapalı bir servis beyaz listesi uygular: yazma · silme ·
   * reset · security access · rutin hatta ÇIKAMAZ (fail-closed ikinci kapı).
   *
   * Opsiyonel (`?`): eski plugin sürümlerinde yok → çağıran guard'lar; kanıt
   * yoksa adreslenebilirlik UNKNOWN/NOT_ADDRESSABLE KALIR, uydurulmaz.
   */
  probeKwpAddressingRow?(options: {
    header: string;
    request: string;
    /**
     * P0-OBD-DIAG-01/2 — istekten ÖNCE K-line başlatma. `'FAST'` = `ATFI`
     * (ISO 14230-4 hızlı başlatma), `'SLOW'` = `ATSI`. Verilmezse başlatma YOK.
     * Başlatma çalışan oturumu anlık böler; çağıran bunu yalnız hat canlılığı
     * ÖLÇÜLDÜKTEN sonra ister.
     */
    init?: 'FAST' | 'SLOW';
  }): Promise<{
    /** GERÇEKTEN gönderilen istek; gönderilmediyse ''. */
    request: string;
    /** Ham yanıt; yanıt yoksa ''. */
    raw: string;
    /** 'ok' | 'no_response' | 'malformed' | 'transport_error' | 'init_failed' | 'not_attempted' */
    outcome: string;
    /** P0-OBD-DIAG-03: başlatma komutunun (ATFI/ATSI) HAM yanıtı; yoksa alan HİÇ YOK. */
    initRaw?: string;
    error?: string;
  }>;

  probeKwpSession?(options: { tx: string; rx: string }): Promise<{
    /** GERÇEKTEN gönderilen istek ('1081'/'10C0'); gönderilmediyse ''. */
    request: string;
    /** Ham yanıt (kırpılmış); yanıt yoksa ''. */
    raw: string;
    /** 'ok' | 'negative_nrc' | 'no_response' | 'timeout' | 'malformed' | 'transport_error' | 'not_attempted' */
    outcome: string;
    /** Ayrık negatif yanıtın NRC baytı; yoksa alan HİÇ yazılmaz. */
    nrc?: number;
    error?: string;
  }>;

  /** P1-OBD-02: NRC/timeout/malformed ayrımını koruyan salt-okunur gelişmiş DTC köprüsü. */
  readAdvancedDtcs?(options: {
    /** P0-OBD-DIAG-02: '13' = ISO 14230-3 eski nesil readDTC; 0x18 ile AYNI hedef kapısına tabidir. */
    service: '19' | '18' | '13'; subFunction: string; payload: string;
    tx: string; rx: string; targetVerified?: boolean;
    /**
     * P0-VDK-F1C — ISO-TP flow control tuning UYGULA (yalnız service '19').
     * Native ZORLAMAZ: TS adapter capability kanıtına bakarak karar verir.
     * Tuning atomiktir — okuma düşse bile restore ÇALIŞIR.
     */
    isoTpTuning?: boolean;
  }): Promise<{
    raw: string; kind: string;
    outcome: 'ok' | 'negative_nrc' | 'no_response' | 'timeout' | 'malformed' | 'transport_error' | 'not_addressable';
    nrc?: number; error?: string;
    /**
     * P0-VDK-F1B — bu istek sırasında VARSAYILAN DIŞI tanı oturumu açıldı mı.
     * Eski APK bu alanı taşımaz (`undefined`) → keepalive AÇILMAZ (fail-closed).
     */
    sessionOpened?: boolean;
    /** Oturumu açan komut ('1003'/'1081'/'10C0'); açılmadıysa yok. */
    sessionCommand?: string;
    /* ── P0-VDK-F1C: transport kanıtı ─────────────────────────────────── */
    /** Tuning GERÇEKTEN uygulandı mı (üç AT komutu da kabul edildi). */
    tuningApplied?: boolean;
    /** Denenen komutlar + ham yanıtları ("ATFCSH7E0=OK|ATFCSD300000=?"). */
    tuningCommands?: string;
    tuningPreviousMode?: string;
    tuningNewMode?: string;
    /** Restore ÇALIŞTI mı — `false` ise adaptör kirli kalmış OLABİLİR. */
    tuningRestored?: boolean;
    tuningRestoreDetail?: string;
    /** Gövde bayt sayısı (ölçüm). */
    byteCount?: number;
    /** ISO-TP çerçeve sayısı (ölçüm) — truncation ancak bununla görülür. */
    frameCount?: number;
  }>;

  /**
   * P0-VDK-F4A — GENEL SALT-OKUNUR TANI PDU KÖPRÜSÜ.
   *
   * ── NEDEN VAR ────────────────────────────────────────────────────────────
   * Bu köprüde bugüne kadar SERVİSE ÖZEL metotlar vardı; yeni bir salt-okunur
   * servis eklemek yeni bir Java metodu ve YENİ APK demekti. CDDL bir PDU
   * üretebilse bile gönderemiyordu. Bu metot o duvarı kaldırır: **ne
   * sorulacağı çağırandan gelir**, native yalnız GÖNDERİR ve HAM yanıtı döner.
   *
   * ── BU BİR "HEX KONSOLU" DEĞİLDİR ────────────────────────────────────────
   * Native tarafta `DiagnosticServiceGate` İKİNCİ ve SON kapıdır: destructive
   * servisler (04 · 11 · 14 · 27 · 28 · 2E · 2F · 31 · 34-37 · 3B · 85) ve
   * beyaz liste dışındaki HER servis reddedilir — TS/CDDL bozulsa bile hatta
   * tek bayt çıkmaz. Ret hâlinde `outcome: 'denied'` döner ve bu **araç
   * hakkında bir iddia DEĞİLDİR** (`not_supported` ile karıştırılamaz).
   *
   * Eski APK bu metodu TAŞIMAZ (`undefined`) → TS `NOT_SUPPORTED_BY_TRANSPORT`
   * ile fail-closed davranır ve legacy yola düşer.
   */
  sendDiagnosticPdu?(options: {
    /** Servis baytı, 2 hane hex. Beyaz liste dışı = `denied`. */
    service: string;
    /** Alt fonksiyon, 2 hane hex; yoksa boş string. */
    subFunction: string;
    /** Gövde (hex); yoksa boş string. */
    payload: string;
    /** Hedef başlık; fonksiyonel yayın için BOŞ string. */
    tx: string;
    rx: string;
    /**
     * Yanıtta yankılanan istek baytı sayısı — **VERİ**.
     * Olumlu yanıt öneki `SID+0x40` evrensel kuralından üretilir; kaç baytın
     * yankılandığı servise özeldir ve native'de DAL olarak değil, burada VERİ
     * olarak taşınır (19-02 → 1 · 18 → 0 · 22 → 2).
     */
    echoBytes?: number;
    /** KWP FİZİKSEL hedef için ZORUNLU kanıt; yoksa istek gönderilmez. */
    targetVerified?: boolean;
    /** F1-C ISO-TP ayarı; KWP'de native tarafından REDDEDİLİR. */
    isoTpTuning?: boolean;
  }): Promise<{
    raw: string; kind: string;
    outcome: 'ok' | 'negative_nrc' | 'no_response' | 'timeout' | 'malformed'
      | 'transport_error' | 'not_addressable' | 'denied';
    nrc?: number; error?: string;
    /** Kapı gerekçesi: 'OK' | 'SERVICE_NOT_READ_ONLY' | 'SUBFUNCTION_NOT_READ_ONLY'
     *  | 'MALFORMED_REQUEST' | 'ADDRESSING_UNKNOWN' | 'KWP_TARGET_UNVERIFIED'. */
    gate?: string;
    /** Hatta ÇIKAN ham istek (gitmediyse de taşınır — kanıt kaybolmaz). */
    request?: string;
    /** Soyulan olumlu yanıt öneki — parity karşılaştırması için. */
    positiveNeedle?: string;
    latencyMs?: number;
    sessionOpened?: boolean;
    sessionCommand?: string;
    tuningApplied?: boolean;
    tuningCommands?: string;
    tuningPreviousMode?: string;
    tuningNewMode?: string;
    tuningRestored?: boolean;
    tuningRestoreDetail?: string;
    byteCount?: number;
    frameCount?: number;
  }>;

  /**
   * P0-VDK-F1B — TesterPresent (ISO 14229-1 servis 0x3E, alt fonksiyon 0x00).
   *
   * SALT OTURUM CANLI TUTMA: ECU'ya YAZMAZ, rutin çalıştırmaz, security access
   * DEĞİLDİR, hiçbir yetki AÇMAZ. TS bunu YALNIZ oturumun gerçekten açıldığı
   * kanıtlanmış (`sessionOpened: true`) bir ECU için çağırır.
   */
  sendTesterPresent?(options: { tx: string; rx: string }): Promise<{
    raw: string; kind: string;
    outcome: 'ok' | 'negative_nrc' | 'no_response' | 'timeout' | 'transport_error';
    nrc?: number; error?: string;
  }>;

  /** CAN bus araç sinyalleri — read-only, native katmandan gelir */
  addListener(
    event: 'canData',
    handler: (data: CanData) => void,
  ): Promise<PluginListenerHandle>;

  /** CAN bus bağlantı durumu — port açıldı/kapandı bilgisi */
  addListener(
    event: 'canStatus',
    handler: (data: CanStatus) => void,
  ): Promise<PluginListenerHandle>;

  /** CAN sniffer — her CAN frame'ini ham olarak iletir (teşhis için) */
  addListener(
    event: 'canRawFrame',
    handler: (data: CanRawFrame) => void,
  ): Promise<PluginListenerHandle>;

  /** K24 ContentProvider tanı mesajları — Bakım ekranında gösterilir */
  addListener(
    event: 'canDiag',
    handler: (data: { msg: string }) => void,
  ): Promise<PluginListenerHandle>;

  /** Android bellek baskısı — system trim callback (CRITICAL / MODERATE) */
  addListener(
    event: 'memoryPressure',
    handler: (data: { level?: string }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Başka bir uygulamadan paylaşılan konum (WhatsApp/Telegram `geo:`, harita
   * bağlantısı). Ham URI taşınır; ayrıştırma JS'teki saf `geoUriParser`ın işidir.
   */
  addListener(
    event: 'incomingLocation',
    handler: (data: { uri?: string }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Soğuk açılışta bekleyen konum URI'sini alır ve kuyruğu BOŞALTIR.
   * `uri: ''` = bekleyen yok (`null` DÖNMEZ — "yok" ile "okunamadı" karışmasın).
   */
  consumePendingLocation(): Promise<{ uri: string }>;
}

export interface CanData {
  // ── Temel sürüş ──────────────────────────────────────────────────────────
  speed?:            number;    // km/h
  reverse?:          boolean;
  fuel?:             number;    // 0–100 %
  // ── Motor ─────────────────────────────────────────────────────────────────
  rpm?:              number;    // devir/dak
  coolantTemp?:      number;    // soğutucu °C
  oilTemp?:          number;    // motor yağı °C
  throttle?:         number;    // gaz pedalı 0–100 %
  // ── Elektrik ──────────────────────────────────────────────────────────────
  batteryVolt?:      number;    // 12V akü gerilimi (V)
  // ── Vites ─────────────────────────────────────────────────────────────────
  gearPos?:          number;    // -1=R, 0=N/P, 1–8=ileri vitesler
  // ── Çevre ─────────────────────────────────────────────────────────────────
  ambientTemp?:      number;    // dış hava °C
  // ── Kapı / aydınlatma ─────────────────────────────────────────────────────
  doorOpen?:         boolean;
  headlightsOn?:     boolean;
  highBeam?:         boolean;    // uzun far
  turnLeft?:         boolean;    // sol sinyal
  turnRight?:        boolean;    // sağ sinyal
  hazard?:           boolean;    // dörtlü flaşör
  // ── Şasi güvenliği ────────────────────────────────────────────────────────
  abs?:              boolean;
  tractionControl?:  boolean;
  stabilityControl?: boolean;
  // ── Gövde / konfor ────────────────────────────────────────────────────────
  parkingBrake?:     boolean;
  seatbelt?:         boolean;
  wipers?:           boolean;
  airCondition?:     boolean;
  cruiseControl?:    boolean;
  // ── TPMS ──────────────────────────────────────────────────────────────────
  tpms?:             number[];  // [fl, fr, rl, rr] kPa
}

export interface CanStatus {
  connected: boolean;
  mode:      'uart' | 'usb' | 'bluetooth' | 'none'; // dahili UART, USB serial, BT RFCOMM, bağlı değil
  port:      string;                                 // açık port adı veya cihaz tanımı
}

/** Her CAN sinyalinin ağ üzerindeki ID'si. Araç başına yapılandırılır. */
export interface CanIdConfig {
  // Temel sürüş
  speed:    number;  // Hız       (varsayılan: 0x0C9)
  gear:     number;  // Vites yön (varsayılan: 0x0E8)
  fuel:     number;  // Yakıt     (varsayılan: 0x145)
  // Motor
  rpm:      number;  // Motor devri  (varsayılan: 0x316)
  coolant:  number;  // Soğutucu     (varsayılan: 0x294)
  oilTemp:  number;  // Yağ sıcaklığı(varsayılan: 0x280)
  throttle: number;  // Gaz pedalı   (varsayılan: 0x201)
  // Elektrik
  battVolt: number;  // Akü gerilimi (varsayılan: 0x3A0)
  // Vites pozisyonu
  gearPos:  number;  // Vites konum  (varsayılan: 0x1D0)
  // Çevre
  ambient:  number;  // Dış hava     (varsayılan: 0x350)
  // Kapı / far / TPMS
  doors:    number;  // Kapı bitmask (varsayılan: 0x3B0)
  lights:   number;  // Far bitmask  (varsayılan: 0x1A0)
  tpms:     number;  // TPMS kPa     (varsayılan: 0x385)
  // Şasi bayrakları (ABS/TCS/ESC)
  chassis:  number;  // Şasi bayrak  (varsayılan: 0x0C0)
  // Gövde bayrakları (el freni/kemer/silecek/klima/seyir)
  body:     number;  // Gövde bayrak (varsayılan: 0x3D0)
}

/** CAN sniffer'dan gelen ham frame — teşhis/yapılandırma için */
export interface CanRawFrame {
  id:   number;  // integer CAN ID
  hex:  string;  // örn. "0x1A0"
  data: string;  // hex baytlar, örn. "04 00 FF 00"
}

// Plugin is resolved by Capacitor on native; undefined on web (bridge handles fallback)
export const CarLauncher = registerPlugin<CarLauncherPlugin>('CarLauncher');

/* ══════════════════════════════════════════════════════════════════
   VehicleHAL — AAOS VHAL Capacitor Plugin (READ-ONLY)
   Android impl: com.cockpitos.pro.hal.VehicleHALPlugin
   ══════════════════════════════════════════════════════════════ */

/**
 * `getSignal()` dönüş tipi:
 *   • `connected`  — AAOS bağlı mı; false ise diğer alanlar tanımsızdır.
 *   • `VehicleHALData` alanları canonical (km/h, %) birimlerde olmalıdır;
 *     mevcut Java iskeletinde raw AAOS birimleri (m/s, litre) gelir.
 *     NativeHALAdapter bu dönüşümü yaparak VAL pipeline'ına iletir.
 */
export interface VehicleHALPlugin {
  startHAL(): Promise<{ connected: boolean }>;
  stopHAL():  Promise<void>;
  getSignal(): Promise<VehicleHALData & { connected: boolean; ts?: number }>;
}

export const VehicleHAL = registerPlugin<VehicleHALPlugin>('VehicleHAL');
