/**
 * nowPlayingModel.ts — F4 · Now Playing SUNUM modeli (SAF).
 *
 * NE YAPAR: F1 `MusicViewModel` + F3 `ListeningProjection` + sürüş durumunu alır,
 * ekranın çizeceği ŞEYİ döndürür: hangi kontrol render edilecek, progress
 * gösterilebilir mi, süreklilik kullanıcıya NASIL anlatılacak.
 *
 * NE YAPMAZ: playback truth üretmez · komut göndermez · kuyruk gerçeği tutmaz ·
 * süreklilik KARARI vermez (kararı F3 verir, burası yalnız TERCÜME eder).
 *
 * DÜRÜSTLÜK SÖZLEŞMESİ:
 *   · Desteklenmeyen kontrol RENDER EDİLMEZ — "disabled mezarlığı" kurulmaz.
 *   · Süre/konum yoksa sahte `0:00`, sahte slider, sahte yüzde ÜRETİLMEZ.
 *   · Kullanıcıya teknik terim (CARRIED · PROVIDER_DRIFT · RENDERING_VERIFIED)
 *     GÖSTERİLMEZ; bunlar CAROS LAB'a aittir.
 *   · `PLAYING` iddiası yalnız kanonik otoriteden gelir; iyimser üretilmez.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */
import type { SourceCapabilities, SourceClass } from '../../platform/media/authority/sourceCapabilities';
import type { ContinuityState } from '../../platform/media/session/sessionContinuity';
import type { MusicTransportPresentation, MusicViewModel } from './MusicViewModel';

/** Sürüş dikkat düzeyi — mevcut `smartEngine.drivingMode` değerinden okunur. */
export type DrivingMode = 'idle' | 'normal' | 'driving';

/** Hangi transport kontrolü GERÇEKTEN çizilecek. */
export interface TransportControls {
  readonly previous: boolean;
  readonly playPause: boolean;
  readonly next: boolean;
  readonly shuffle: boolean;
  readonly repeat: boolean;
}

export interface ProgressPresentation {
  readonly positionSec: number;
  readonly durationSec: number;
  /** 0–100 arası; yalnız gerçek süre varsa üretilir. */
  readonly percent: number;
  readonly positionLabel: string;
  readonly durationLabel: string;
  /** Kullanıcı çubuğa dokunup konum değiştirebilir mi. */
  readonly seekable: boolean;
}

/** Süreklilik durumunun KULLANICI dilindeki karşılığı. */
export interface ContinuityNotice {
  readonly tone: 'NEUTRAL' | 'INFO' | 'WARN';
  readonly message: string;
  /** Sessiz durumlarda hiç gösterme — gereksiz alarm üretilmez. */
  readonly visible: boolean;
}

export interface NowPlayingPresentation {
  readonly hasContext: boolean;
  readonly transport: MusicTransportPresentation;
  /** Yalnız kanıtlı duyulabilir çalma. Duraklat ikonu bununla seçilir. */
  readonly isPlaying: boolean;
  /** Komut gönderildi ama ses kanıtı YOK — kullanıcıya sakin bir ipucu. */
  readonly awaitingConfirmation: boolean;
  readonly title: string;
  readonly artist: string;
  readonly contextLine: string | null;
  readonly artworkIdentity: string | null;
  readonly sourceLabel: string;
  readonly sourceClass: SourceClass | null;
  readonly controls: TransportControls;
  readonly shuffleOn: boolean;
  readonly repeatMode: 'off' | 'one' | 'all';
  readonly progress: ProgressPresentation | null;
  readonly continuity: ContinuityNotice;
  /** Kuyruk yüzeyi açılabilir mi (tek hareket kuralı bu bayrağa bağlıdır). */
  readonly canOpenQueue: boolean;
  readonly queueSummary: string | null;
  /** Sürüşte kuyruk DÜZENLEME kısıtlanır; okuma ve atlama serbest kalır. */
  readonly queueEditingAllowed: boolean;
  /** Sakin hareket: sürüşte ve düşük performansta animasyon kapanır. */
  readonly motionEnabled: boolean;
  readonly drivingMode: DrivingMode;
}

export interface NowPlayingInput {
  readonly music: MusicViewModel;
  /** F3 projeksiyonu — yalnız OKUNUR. */
  readonly listening: {
    readonly hasSession: boolean;
    readonly continuity: ContinuityState;
    readonly queuePosition: Readonly<{ index: number; length: number }> | null;
    readonly queueEditable: boolean;
    readonly restored: boolean;
  } | null;
  readonly drivingMode: DrivingMode;
  /** Cihaz/kullanıcı hareketi azaltmayı istiyor mu (runtime bütçesi veya OS ayarı). */
  readonly reducedMotion: boolean;
  /**
   * MUSIC F7.3 · Backend'in KENDİ zaman çizelgesi olmasa bile ÜST katmanda
   * gerçek bir çalma sırası var mı (birden fazla öğe).
   *
   * NEDEN: `supportsQueue` backend'in timeline sahibi olup olmadığını söyler
   * (YouTube IFrame'de `false`). Ama kullanıcı bir arama sonucu LİSTESİNDEN
   * çalmaya başladıysa gerçek bir sıra VARDIR ve sonraki/önceki meşrudur —
   * o sıranın sahibi üst katmandır. Bu alan UYDURULMAZ: çağıran onu gerçek
   * kuyruk uzunluğundan ölçer.
   */
  readonly upperQueueAvailable?: boolean;
}

const NO_CONTROLS: TransportControls = Object.freeze({
  previous: false, playPause: false, next: false, shuffle: false, repeat: false,
});

const SILENT_CONTINUITY: ContinuityNotice = Object.freeze({
  tone: 'NEUTRAL', message: '', visible: false,
});

/** `mm:ss` — negatif ve NaN girdide `--:--` (sahte sıfır üretilmez). */
export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Süreklilik durumunu kullanıcı diline çevirir.
 *
 * `INTACT` ve `UNKNOWN` SESSİZDİR: her şey yolundayken rozet göstermek gürültü,
 * bilinmeyeni uyarıya çevirmek ise gereksiz alarmdır.
 */
export function continuityNotice(state: ContinuityState, restored: boolean): ContinuityNotice {
  switch (state) {
    case 'CARRIED':
      return Object.freeze({ tone: 'INFO' as const, message: 'Dinlemeye devam ediliyor', visible: true });
    case 'DEGRADED':
      return Object.freeze({ tone: 'INFO' as const, message: 'Bazı parçalar bu kaynakta yok', visible: true });
    case 'BROKEN':
      return Object.freeze({ tone: 'WARN' as const, message: 'Bu dinleme burada devam ettirilemiyor', visible: true });
    case 'UNKNOWN':
      /* Yalnız kayıttan dönülen bağlamda tek satırlık sade açıklama; onun
         dışında sessiz kalınır (bilinmiyor ≠ sorun var). */
      return restored
        ? Object.freeze({ tone: 'NEUTRAL' as const, message: 'Kaldığın yerden hazır — çalmak için dokun', visible: true })
        : SILENT_CONTINUITY;
    default:
      return SILENT_CONTINUITY;
  }
}

/**
 * Hangi kontrolün çizileceği. Kaynak yeteneği YOKSA kontrol hiç üretilmez;
 * kullanıcıya kalıcı olarak sönük, hiçbir zaman çalışmayan tuş gösterilmez.
 */
export function transportControlsFor(
  capabilities: SourceCapabilities | null,
  hasContext: boolean,
  drivingMode: DrivingMode,
  upperQueueAvailable = false,
): TransportControls {
  if (!hasContext || !capabilities) return NO_CONTROLS;
  const secondaryAllowed = drivingMode !== 'driving';
  /* MUSIC F7.3: sıra ya BACKEND'in ya da ÜST KATMANIN olabilir. İkisi de yoksa
     düğme ÇİZİLMEZ (karşılıksız kontrol yasağı). */
  const canSkip = capabilities.supportsQueue === true || upperQueueAvailable === true;
  return Object.freeze({
    previous: canSkip,
    playPause: capabilities.supportsPlay === true || capabilities.supportsPause === true,
    next: canSkip,
    /* Sürüşte ikincil kontroller gizlenir: ana transport tek dokunuşta kalsın,
       hedef alanlar büyüsün (dokunma yoğunluğu düşer). */
    shuffle: capabilities.supportsShuffle === true && secondaryAllowed,
    repeat: capabilities.supportsRepeat === true && secondaryAllowed,
  });
}

/**
 * Gerçek ilerleme. Kaynak konum/süre bildiremiyorsa veya süre geçerli değilse
 * `null` döner — çağıran çubuk ve saat ÇİZMEZ.
 */
export function progressFor(
  music: MusicViewModel, capabilities: SourceCapabilities | null,
): ProgressPresentation | null {
  if (!capabilities?.supportsPosition || !music.progress) return null;
  const { positionSec, durationSec } = music.progress;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  const clamped = Math.min(Math.max(0, positionSec), durationSec);
  return Object.freeze({
    positionSec: clamped,
    durationSec,
    percent: (clamped / durationSec) * 100,
    positionLabel: formatClock(clamped),
    durationLabel: formatClock(durationSec),
    seekable: capabilities.supportsSeek === true,
  });
}

/** Now Playing'in çizeceği her şey — tek saf hesap. */
export function buildNowPlayingPresentation(input: NowPlayingInput): NowPlayingPresentation {
  const { music, listening, drivingMode, reducedMotion } = input;
  const hasContext = music.hasListeningContext;
  const capabilities = music.capabilities;

  const queuePosition = listening?.queuePosition ?? null;
  const continuity = listening
    ? continuityNotice(listening.continuity, listening.restored)
    : SILENT_CONTINUITY;

  return Object.freeze({
    hasContext,
    transport: music.transport,
    // Duyulabilirlik iddiası TEK kaynaktan gelir; UI kendi başına PLAYING demez.
    isPlaying: music.isAudiblyPlaying,
    awaitingConfirmation: hasContext && music.transport === 'UNKNOWN',
    title: music.title,
    artist: music.artist,
    contextLine: music.album,
    artworkIdentity: music.artworkUrl,
    sourceLabel: music.sourceLabel,
    sourceClass: music.sourceClass,
    controls: transportControlsFor(
      capabilities, hasContext, drivingMode, input.upperQueueAvailable === true,
    ),
    shuffleOn: music.shuffle,
    repeatMode: music.repeat,
    progress: progressFor(music, capabilities),
    continuity,
    canOpenQueue: Boolean(listening?.hasSession) && (queuePosition?.length ?? 0) > 0,
    queueSummary: queuePosition ? `${queuePosition.index} / ${queuePosition.length}` : null,
    /* Sürüşte düzenleme kapanır (dikkat politikası), okuma ve atlama açık kalır.
       Yetenek yoksa zaten hiçbir düzenleme meşru değildir. */
    queueEditingAllowed: (listening?.queueEditable ?? false) && drivingMode !== 'driving',
    motionEnabled: !reducedMotion && drivingMode !== 'driving',
    drivingMode,
  });
}
