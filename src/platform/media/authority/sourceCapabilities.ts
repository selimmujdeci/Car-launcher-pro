/**
 * sourceCapabilities.ts — MÜZİK HUB PAKET A · Kaynak yetenek sözleşmesi (SAF).
 *
 * KURAL: desteklenmeyen davranış SAHTE BAŞARI döndürmez. Bir kaynak seek
 * yapamıyorsa `seek` komutu `unsupported_capability` ile REDDEDİLİR; sessizce
 * yok sayılmaz (eski `carosMediaLayer.seek` harici oturumda sessizce hiçbir şey
 * yapmıyordu — kullanıcı çubuğu sürüklüyor, hiçbir şey olmuyordu).
 *
 * SAFLIK: I/O · timer · Date.now · global durum · React YOK.
 */

export type SourceClass =
  | 'LOCAL'
  | 'STREAM'
  | 'INTERNET_RADIO'
  | 'YOUTUBE'
  | 'SPOTIFY_CONNECT'
  | 'EXTERNAL_MEDIA_SESSION'
  | 'BLUETOOTH_EXTERNAL'
  | 'VIDEO';

/** Kaynağın hangi teknik altyapıda çaldığı — teşhis için ayrı tutulur. */
export type BackendId =
  | 'native_authority'   // CarosPlaybackService (ExoPlayer) — TEK yerel ses otoritesi
  | 'youtube_iframe'
  | 'spotify_connect'
  | 'external_session'   // Android MediaController (başka uygulama)
  | 'native_video';      // Video oynatıcı — müzik otoritesi DEĞİL, focus'a tabidir

export interface SourceCapabilities {
  readonly supportsPlay: boolean;
  readonly supportsPause: boolean;
  readonly supportsSeek: boolean;
  readonly supportsQueue: boolean;
  readonly supportsShuffle: boolean;
  readonly supportsRepeat: boolean;
  readonly supportsPosition: boolean;
  /** Sesin GERÇEKTEN çıktığı teknik olarak doğrulanabiliyor mu. */
  readonly supportsAudibleVerification: boolean;
  readonly supportsOffline: boolean;
  readonly supportsBackground: boolean;
  readonly supportsMetadata: boolean;
  readonly supportsArtwork: boolean;
  /** Durdurma komutunun GERÇEKTEN durdurduğu doğrulanabiliyor mu (handover için). */
  readonly supportsStopVerification: boolean;
}

export interface SourceDescriptor {
  readonly sourceClass: SourceClass;
  readonly backend: BackendId;
  readonly capabilities: SourceCapabilities;
  /** Bu kaynak ses üretiyor mu — video da üretir, ama müzik otoritesi değildir. */
  readonly producesAudio: boolean;
}

const NATIVE_FULL: SourceCapabilities = {
  supportsPlay: true,
  supportsPause: true,
  supportsSeek: true,
  supportsQueue: true,
  supportsShuffle: true,
  supportsRepeat: true,
  supportsPosition: true,
  supportsAudibleVerification: true,   // ExoPlayer render + focus + volume kanıtı
  supportsOffline: true,
  supportsBackground: true,
  supportsMetadata: true,
  supportsArtwork: true,
  supportsStopVerification: true,
};

const NATIVE_STREAM: SourceCapabilities = {
  ...NATIVE_FULL,
  supportsOffline: false,
};

const NATIVE_RADIO: SourceCapabilities = {
  ...NATIVE_FULL,
  // Canlı yayında konum/süre yoktur; seek YAPILAMAZ (uydurma süre gösterilmez).
  supportsSeek: false,
  supportsPosition: false,
  supportsOffline: false,
};

const YOUTUBE_IFRAME: SourceCapabilities = {
  supportsPlay: true,
  supportsPause: true,
  supportsSeek: true,
  supportsQueue: false,          // kuyruk ÜST katmanda (carosMediaLayer) tutulur
  supportsShuffle: false,
  supportsRepeat: false,
  supportsPosition: true,
  supportsAudibleVerification: false, // iframe "PLAYING" der; ses yolu doğrulanamaz
  supportsOffline: false,
  supportsBackground: false,     // WebView arka plana düşünce güvenilmez
  supportsMetadata: true,
  supportsArtwork: true,
  supportsStopVerification: true, // iframe pause state'i okunabilir
};

const SPOTIFY_CONNECT: SourceCapabilities = {
  supportsPlay: true,
  supportsPause: true,
  supportsSeek: true,
  supportsQueue: false,
  supportsShuffle: false,
  supportsRepeat: false,
  supportsPosition: false,       // Connect'ten sürekli pozisyon çekilmiyor
  supportsAudibleVerification: false, // uzak cihazda çalıyor; ses BİZDE değil
  supportsOffline: false,
  supportsBackground: true,
  supportsMetadata: true,
  supportsArtwork: true,
  /**
   * Doğrulanan şey "uzak cihazda durdu" DEĞİL, "BU cihazda artık ses üretmiyor":
   * Spotify uygulaması aynı cihazdaysa MediaSession durumu gözlenir; hiç oturum
   * yoksa zaten bizim ses yolumuzu kullanmıyordur. Devir için gereken kanıt budur.
   */
  supportsStopVerification: true,
};

const EXTERNAL_SESSION: SourceCapabilities = {
  supportsPlay: true,
  supportsPause: true,
  supportsSeek: false,           // harici MediaSession'da rastgele seek yok
  supportsQueue: false,
  supportsShuffle: false,
  supportsRepeat: false,
  supportsPosition: true,
  supportsAudibleVerification: false,
  supportsOffline: false,
  supportsBackground: true,
  supportsMetadata: true,
  supportsArtwork: true,
  supportsStopVerification: true, // PlaybackState PAUSED gözlenebilir
};

const BLUETOOTH_EXTERNAL: SourceCapabilities = {
  ...EXTERNAL_SESSION,
  supportsMetadata: true,
  supportsArtwork: false,
  // AVRCP metadata'sı güvenilmez ama Bluetooth MediaSession'ın PlaybackState'i
  // (playing=false) gözlenebilir — devir kanıtı için bu yeterlidir.
  supportsStopVerification: true,
};

const VIDEO_CAPS: SourceCapabilities = {
  supportsPlay: true,
  supportsPause: true,
  supportsSeek: true,
  supportsQueue: false,
  supportsShuffle: false,
  supportsRepeat: false,
  supportsPosition: true,
  supportsAudibleVerification: false,
  supportsOffline: true,
  supportsBackground: false,
  supportsMetadata: false,
  supportsArtwork: false,
  supportsStopVerification: true,
};

export const SOURCE_REGISTRY: Readonly<Record<SourceClass, SourceDescriptor>> = {
  LOCAL: {
    sourceClass: 'LOCAL',
    backend: 'native_authority',
    capabilities: NATIVE_FULL,
    producesAudio: true,
  },
  STREAM: {
    sourceClass: 'STREAM',
    backend: 'native_authority',
    capabilities: NATIVE_STREAM,
    producesAudio: true,
  },
  INTERNET_RADIO: {
    sourceClass: 'INTERNET_RADIO',
    backend: 'native_authority',
    capabilities: NATIVE_RADIO,
    producesAudio: true,
  },
  YOUTUBE: {
    sourceClass: 'YOUTUBE',
    backend: 'youtube_iframe',
    capabilities: YOUTUBE_IFRAME,
    producesAudio: true,
  },
  SPOTIFY_CONNECT: {
    sourceClass: 'SPOTIFY_CONNECT',
    backend: 'spotify_connect',
    capabilities: SPOTIFY_CONNECT,
    producesAudio: true,
  },
  EXTERNAL_MEDIA_SESSION: {
    sourceClass: 'EXTERNAL_MEDIA_SESSION',
    backend: 'external_session',
    capabilities: EXTERNAL_SESSION,
    producesAudio: true,
  },
  BLUETOOTH_EXTERNAL: {
    sourceClass: 'BLUETOOTH_EXTERNAL',
    backend: 'external_session',
    capabilities: BLUETOOTH_EXTERNAL,
    producesAudio: true,
  },
  VIDEO: {
    sourceClass: 'VIDEO',
    backend: 'native_video',
    // Video MÜZİK otoritesine karışmaz ama aynı audio focus politikasına tabidir.
    capabilities: VIDEO_CAPS,
    producesAudio: true,
  },
};

export function getSource(sourceClass: SourceClass): SourceDescriptor {
  return SOURCE_REGISTRY[sourceClass];
}

export function isKnownSourceClass(v: unknown): v is SourceClass {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_REGISTRY, v);
}

/** Komut → gerekli capability eşlemesi. */
export type CapabilityGatedCommand =
  | 'play' | 'pause' | 'stop' | 'seek' | 'next' | 'previous'
  | 'setQueue' | 'setShuffle' | 'setRepeat';

export function requiredCapability(command: CapabilityGatedCommand): keyof SourceCapabilities | null {
  switch (command) {
    case 'play':       return 'supportsPlay';
    case 'pause':      return 'supportsPause';
    case 'seek':       return 'supportsSeek';
    case 'setQueue':   return 'supportsQueue';
    case 'next':       return 'supportsQueue';
    case 'previous':   return 'supportsQueue';
    case 'setShuffle': return 'supportsShuffle';
    case 'setRepeat':  return 'supportsRepeat';
    // stop her kaynakta denenebilir (durdurma hakkı her zaman vardır).
    case 'stop':       return null;
    default:           return null;
  }
}

/** Kaynak bu komutu destekliyor mu — desteklemiyorsa komut REDDEDİLİR. */
export function supportsCommand(sourceClass: SourceClass, command: CapabilityGatedCommand): boolean {
  const cap = requiredCapability(command);
  if (cap === null) return true;
  return SOURCE_REGISTRY[sourceClass].capabilities[cap] === true;
}

/** Kaynağın ulaşabileceği en yüksek kanıt düzeyi (playbackTruth ile uyumlu). */
export function maxVerificationFor(
  sourceClass: SourceClass,
): 'RENDERING_VERIFIED' | 'OBSERVED_STARTED' | 'REMOTE_STATE_OBSERVED' | 'TRANSPORT_ACK' {
  const d = SOURCE_REGISTRY[sourceClass];
  if (d.capabilities.supportsAudibleVerification) return 'RENDERING_VERIFIED';
  if (d.backend === 'spotify_connect' || d.backend === 'external_session') {
    return 'REMOTE_STATE_OBSERVED';
  }
  if (d.backend === 'youtube_iframe' || d.backend === 'native_video') return 'OBSERVED_STARTED';
  return 'TRANSPORT_ACK';
}
