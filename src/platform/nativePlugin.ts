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

/** Native 'wakeWord' event'i — grammar thread'i wake sözü duyduğunda düşer. */
export interface WakeWordEvent {
  transcript: string;
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
  positionMs?:        number;
  durationMs?:        number;
  buffering?:         boolean;
  playing:            boolean;
  playWhenReady?:     boolean;
  renderingVerified:  boolean;
  recoveryCount?:     number;
  shuffle?:           boolean;
  repeat?:            string;   // off|one|all
  title?:             string;
  artist?:            string;
  artworkUri?:        string;
  currentTrackId?:    string;
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
}

export interface GetMusicTracksResult {
  tracks: LocalMusicTrack[];
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
 * PR-OBD-DIAG-3: native EXTENDED PID poll kanıtı — {@code getObdExtendedPollEvidence}'ın
 * döndürdüğü ham şekil. Tümü bounded; ham yanıt gövdesi YOK (yalnız responseLength) → PII-güvenli.
 */
export interface NativeExtendedPollEvidence {
  present: boolean;
  transport: string;
  burstEnabled: boolean;
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
  startBackgroundService(): Promise<void>;
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
  getMediaArtDataUri(options: { uri: string }): Promise<{ dataUri: string }>;

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

  addListener(
    event: 'mediaAuthorityEvent',
    handler: (data: NativeAuthoritySnapshot) => void,
  ): Promise<PluginListenerHandle>;

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
