/**
 * mediaAuthoritySources.ts — CAROS LAB · Medya Otoritesi TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter'lar, her biri kendi try/catch'i
 * içinde. HİÇBİR komut göndermez, hiçbir şeyi başlatmaz, timer kurmaz.
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6): parça başlığı · sanatçı ·
 * URI · kapak · kullanıcı verisi BU KATMANDAN GEÇMEZ. Yalnız VAR/YOK, ADET,
 * durum kodu ve süre okunur.
 */

import { getSnapshot } from '../media/authority/nativeAuthorityBridge';
import {
  getMediaAuthorityEvidence, type MediaAuthorityEvidence,
} from '../media/authority/mediaAuthorityEvidence';
import { getActiveSource, getActiveDuckReasons, getEffectiveVolume } from '../media/authority/mediaCommandGateway';
/* MUSIC F6.1: duck İSTEK sayaçları — açık kalmış duck (sızıntı) sahada burada görülür. */
import { getDuckRequestCounters } from '../media/authority/duckRequest';
import { readPersistedRaw, decideRecovery } from '../media/authority/mediaRecovery';
import { reconcileQueue, type QueueDrift } from '../media/authority/queueReconciliation';
import {
  getUiQueueView, getProviderQueueExclusionCount, getLayerProjectionSize,
} from '../media/carosMediaLayer';

import { isKnownSourceClass } from '../media/authority/sourceCapabilities';
import { getProjectedQueueView } from '../media/authority/mediaAuthorityRuntime';
import {
  getLastRecovery, getRecoveryLedger,
} from '../media/authority/queueRecoveryRuntime';
import {
  isHandoverInFlight, isUserCommandInFlight, getAuthorityGeneration,
} from '../media/authority/mediaCommandGateway';
import { getMediaEvents, type MediaEvent } from '../media/authority/mediaAuthorityEvents';
import {
  summarize, latestResults,
  type ScenarioResult, type ValidationSummary,
} from '../media/authority/deviceValidationModel';
import { listSessions, getActiveSession } from '../media/authority/deviceValidationStore';
import { isNative } from '../bridge';
/* MUSIC F8 · sürüş-farkında müzik zekâsı — LAB YALNIZ OKUR.
   `peekDrivingContext` üretim histerezisini İLERLETMEZ; karar üretilmez,
   son karar telemetriden okunur (LAB ikinci otorite olamaz). */
import { peekDrivingContext, getExplicitUserIntentAtMs, isMusicIntelligenceStarted } from '../media/intelligence/musicIntelligenceRuntime';
import { getPreferenceEvidence, MAX_PREFERENCE_ENTRIES } from '../media/intelligence/preferenceEvidence';
import { bestPreferenceFor } from '../media/intelligence/preferenceEvidence';
import { getIntelligenceTelemetry, type IntelligenceTelemetrySnapshot } from '../media/intelligence/intelligenceTelemetry';
/* MUSIC F9 · Mavi müzik niyeti — LAB YALNIZ OKUR: niyet çözmez, komut göndermez. */
import {
  getMusicIntentTelemetry, type MusicIntentTelemetrySnapshot,
} from '../media/intent/musicIntentTelemetry';
/* MUSIC F14 · canlı ses → F9 kablolama kanıtı — LAB YALNIZ OKUR. */
import {
  getMusicVoiceWiringTelemetry, type MusicVoiceWiringSnapshot,
} from '../media/intent/musicVoiceWiringTelemetry';
/* MUSIC F10 · karakter (mood/energy) kanıtı — LAB YALNIZ OKUR: seçim yapmaz. */
import {
  getTraitTelemetry, type TraitTelemetrySnapshot,
} from '../media/traits/traitTelemetry';
import {
  getTraitCacheSize, peekReferenceEvidence, TRAIT_SCHEMA_VERSION,
} from '../media/traits/traitRuntime';
import { PROVIDER_TRAIT_AVAILABILITY } from '../media/traits/traitSources';
import { getMusicLibrarySnapshot } from '../media/musicIndex';
import { getMusicIndexPerfSnapshot } from '../media/musicIndexPerf';
/* MUSIC F13 · favori/koleksiyon otoritesi — LAB YALNIZ OKUR: mutasyon YAPMAZ. */
import { getFavoritesCount } from '../media/collection/musicCollectionAuthority';
import { COLLECTION_SCHEMA_VERSION } from '../media/collection/musicCollectionEntry';
import {
  getMusicCollectionTelemetry, type MusicCollectionTelemetrySnapshot,
} from '../media/collection/musicCollectionTelemetry';
/* MUSIC F15 · playlist otoritesi — LAB YALNIZ OKUR: mutasyon YAPMAZ. */
import { getPlaylistsCount } from '../media/playlist/musicPlaylistAuthority';
import { PLAYLIST_SCHEMA_VERSION } from '../media/playlist/musicPlaylistEntry';
import {
  getMusicPlaylistTelemetry, type MusicPlaylistTelemetrySnapshot,
} from '../media/playlist/musicPlaylistTelemetry';
import { getLyricsCacheSize } from '../media/lyrics/musicLyricsAuthority';
import {
  getSonicCacheSize, getSonicGeneration, isSonicAnalysisRunning, peekSonicDescriptor,
} from '../media/sonic/sonicAnalysisRuntime';
import { SONIC_SCHEMA_VERSION, TEMPO_CONFIDENCE_MIN } from '../media/sonic/sonicDescriptor';
import { getSonicTelemetry, type SonicTelemetrySnapshot } from '../media/sonic/sonicTelemetry';
import {
  getSmartRadioTelemetry, type SmartRadioTelemetrySnapshot,
} from '../media/radio/smartRadioTelemetry';
import { MAX_RADIO_LENGTH, MEASURED_CLAIM_MIN_COUNT } from '../media/radio/smartRadioModel';
import { MAX_RADIO_SCAN } from '../media/radio/smartRadioRuntime';
import {
  getGainTagCacheSize, getLastNormalization, isLoudnessNormalizationStarted,
} from '../media/loudness/loudnessRuntime';
import {
  MAX_ATTENUATION_DB, MIN_ADJUSTMENT_DB, RMS_REFERENCE_DBFS,
} from '../media/loudness/loudnessEvidence';
import {
  getLoudnessTelemetry, type LoudnessTelemetrySnapshot,
} from '../media/loudness/loudnessTelemetry';
import {
  getLastTransitionPolicy, getTransitionPersistCounters, isTransitionPolicyStarted,
} from '../media/transition/transitionRuntime';
import { getTransitionPreference } from '../media/transition/transitionPreference';
import { TRANSITION_CAPABILITIES } from '../media/transition/transitionModel';
import {
  POLICY_ALLOWS_AUTO_RESUME, readRecoveryEvidence,
} from '../media/recovery/recoveryRuntime';
import {
  getRecoveryTelemetry, type RecoveryTelemetrySnapshot,
} from '../media/recovery/recoveryTelemetry';
import {
  getTransitionTelemetry, type TransitionTelemetrySnapshot,
} from '../media/transition/transitionTelemetry';
import { LYRICS_SCHEMA_VERSION } from '../media/lyrics/musicLyricsEntry';
import {
  getMusicLyricsTelemetry, type MusicLyricsTelemetrySnapshot,
} from '../media/lyrics/musicLyricsTelemetry';
import { getLastMusicRefreshOutcome, getMusicRefreshCounters, isMusicRefreshInFlight } from '../media/mediaStoreRefreshExecutor';
import { loadRefreshState } from '../media/mediaStoreRefreshState';
import { getArtworkCacheSnapshot } from '../media/artworkCache';
import {
  getF3TelemetrySnapshot, type F3TelemetrySnapshot,
} from '../media/session/sessionTelemetry';
import {
  observedQueueAgeMs, peekObservedQueueEvidence, OBSERVED_QUEUE_MAX_AGE_MS,
} from '../media/session/observedQueueEvidence';
import { buildListeningProjection } from '../media/session/sessionProjection';
import { getListeningSession } from '../media/session/listeningSession';
import { getDesiredQueue } from '../media/session/playQueue';
import { sourceSupportsQueue } from '../media/session/listeningSessionRuntime';
import {
  getSearchTelemetrySnapshot, type SearchTelemetrySnapshot,
} from '../media/search/searchTelemetry';
import {
  getAudioExperienceTelemetry, getCapabilities as getDspCapabilities,
  getChannelGains, getConfig as getDspConfig, getNativeSnapshot as getDspNativeSnapshot,
  getSafetyPreampDb,
} from '../media/audio/audioExperienceAuthority';
import {
  UNPROBED_CAPABILITIES, type AudioDspCapabilities, type AudioExperienceConfig,
} from '../media/audio/audioExperienceModel';
import type { NativeAudioDspSnapshot } from '../nativePlugin';
import { peekLocalSearchIndex } from '../media/search/localSearchIndex';
/* MUSIC F7.2 · sürüşte video kapısı — LAB ikinci karar ÜRETMEZ, kanonik SAF
   politikayı aynı girdiyle çağırır (histerezissiz anlık karar). */
import { decideVideoVisibility } from '../media/videoSafetyPolicy';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';

/** Native tarafın bildirdiği ham durum — hiçbir alan uydurulmaz. */
export interface MediaAuthorityRawSnapshot {
  readonly readAt: number;
  readonly isNativePlatform: boolean;
  /** Native servis erişilebilir mi (false → diğer alanlar ANLAMSIZ). */
  readonly authorityAvailable: boolean;
  readonly activeSourceNative: string;
  readonly activeSourceGateway: string | null;
  readonly focusState: string;
  readonly hasAudioFocus: boolean | null;
  readonly userPaused: boolean | null;
  readonly pausedByFocus: boolean | null;
  readonly playing: boolean;
  readonly playWhenReady: boolean | null;
  readonly renderingVerified: boolean;
  readonly buffering: boolean | null;
  readonly audioRoute: string;
  readonly noisyReceiverActive: boolean | null;
  readonly duckVolume: number | null;
  readonly duckReasonsNative: readonly string[];
  readonly duckReasonsGateway: readonly string[];
  readonly effectiveVolumeNative: number | null;
  readonly effectiveVolumeGateway: number | null;
  /** MUSIC F7.6 · kanonik desired queue sahibi/kaynağı. */
  readonly desiredQueueSource: string;
  readonly desiredQueueLength: number;
  readonly desiredQueueIndex: number;
  /** MUSIC F7.6 · kuyruk girdilerinin kökeni (LIBRARY / PROVIDER / RECOVERED adetleri). */
  readonly desiredQueueOrigins: string;
  /** MUSIC F7.6 · sağlayıcı sınırı nedeniyle kuyruk DIŞINDA kalan satır adedi. */
  readonly providerQueueExcluded: number;
  /** MUSIC F7.6 · medya katmanının SUNUM önbelleği adedi (kuyruk DEĞİL). */
  readonly layerProjectionSize: number;
  /** MUSIC F7.2 · kanonik araç hızı (km/h) — `null` = ölçüm YOK. */
  readonly vehicleSpeedKmh: number | null;
  /** MUSIC F7.2 · video görüntüsü kapısının ANLIK kararı (histerezissiz). */
  readonly videoVisibility: string;
  /** MUSIC F6.1 · duck istek sayaçları (istendi / bırakıldı / düştü). */
  readonly duckRequested: number;
  readonly duckReleased: number;
  readonly duckFailed: number;
  readonly userVolumeNative: number | null;
  readonly queueRevision: number | null;
  readonly queueLength: number | null;
  readonly currentIndex: number | null;
  readonly positionMs: number | null;
  readonly durationMs: number | null;
  readonly shuffle: boolean | null;
  readonly repeat: string;
  readonly lastPauseReason: string;
  readonly lastFailureCode: string;
  readonly recoveryCountNative: number | null;
  /** Parça başlığı DEĞİL — yalnız "metadata var mı" bilgisi. */
  readonly hasTrackMetadata: boolean;
  readonly evidence: MediaAuthorityEvidence;
  /** Kalıcı kurtarma kaydının kararı (içeriği DEĞİL). */
  readonly recoveryDecision: string;
  readonly recoveryItemCount: number | null;
  /* ── Kuyruk uzlaştırma (projeksiyon ↔ native timeline) ────────────────── */
  readonly uiQueueRevision: number | null;
  readonly uiQueueLength: number | null;
  readonly uiQueueIndex: number | null;
  /** Native'e GÖNDERİLEN pencere — uzlaştırmanın gerçek girdisi. */
  readonly projectedRevision: number | null;
  readonly projectedLength: number | null;
  readonly projectedIndex: number | null;
  readonly queueDrift: QueueDrift;
  readonly queueDriftReason: string;
  /* ── PAKET B · Kurtarma ───────────────────────────────────────────────── */
  readonly recoveryOutcome: string;
  readonly recoveryAction: string;
  readonly recoveryCode: string;
  readonly recoveryReason: string;
  readonly recoveryAtMs: number | null;
  /** Devre kesici açık olan sapma imzası sayısı. */
  readonly recoveryBreakersOpen: number;
  readonly recoveryLedgerSize: number;
  readonly handoverInFlight: boolean;
  readonly userCommandInFlight: boolean;
  readonly authorityGeneration: number | null;
  /* ── PAKET B · Olay izi ───────────────────────────────────────────────── */
  readonly eventTotal: number;
  readonly eventDropped: number;
  readonly eventCapacity: number;
  readonly recentEvents: readonly MediaEvent[];
  /* ── PAKET B · Cihaz doğrulama ────────────────────────────────────────── */
  readonly validationSummary: ValidationSummary;
  readonly validationActiveState: string;
  readonly validationActiveScenario: string;
  readonly validationResults: Readonly<Record<string, ScenarioResult>>;
  /* ── F2 · Yerel kütüphane (MusicIndex) ────────────────────────────────
   * GİZLİLİK: parça başlığı · sanatçı · albüm · dosya yolu · içerik URI'si BU
   * KATMANDAN GEÇMEZ. Yalnız ADET, volume TOKEN'ı, durum kodu ve süre okunur. */
  readonly libraryAvailability: 'READY' | 'UNAVAILABLE';
  readonly libraryRevision: number | null;
  readonly libraryTrackCount: number | null;
  readonly libraryStaleCount: number | null;
  readonly libraryAlbumCount: number | null;
  readonly libraryArtistCount: number | null;
  readonly libraryFolderCount: number | null;
  readonly libraryVolumes: readonly LibraryVolumeRow[];
  readonly refreshPersistedSchema: number | null;
  readonly refreshPermissionPersisted: boolean | null;
  readonly refreshLastSuccessAtMs: number | null;
  readonly refreshDecision: string;
  readonly refreshStatus: string;
  readonly refreshReason: string;
  readonly refreshPermissionTransition: string;
  readonly refreshSupportsGeneration: boolean | null;
  readonly refreshTrackQueries: number | null;
  readonly refreshTracksReceived: number | null;
  readonly refreshStaleVolumes: readonly string[];
  readonly refreshPrunedVolumes: readonly string[];
  readonly refreshStatePersisted: boolean | null;
  readonly refreshFailureCode: string;
  readonly refreshInFlight: boolean;
  readonly refreshCounters: Readonly<{
    rounds: number; applied: number; skipped: number; failed: number;
    unavailable: number; trackQueries: number; escalations: number;
  }>;
  readonly indexP50Ms: number | null;
  readonly indexP95Ms: number | null;
  readonly searchP50Ms: number | null;
  readonly searchP95Ms: number | null;
  /* ── F2 · Kapak önbelleği (ArtworkCache) ──────────────────────────────── */
  readonly artworkMemoryEntries: number | null;
  readonly artworkMemoryBytes: number | null;
  readonly artworkMemoryMaxBytes: number | null;
  readonly artworkInFlight: number | null;
  /** MUSIC F7.4 · uzak (sağlayıcı) kapak geçişi adedi — önbelleğe ALINMAZ. */
  readonly artworkRemoteResolved: number | null;
  readonly artworkNativeFileTier: boolean | null;
  readonly artworkDiskHydrated: boolean | null;
  readonly artworkDiskSchema: number | null;
  readonly artworkDiskEntries: number | null;
  readonly artworkDiskBytes: number | null;
  readonly artworkDiskMaxBytes: number | null;
  /* ── F3.2 · Dinleme bağlamı + gözlenen kuyruk kanıtı ──────────────────
   * GİZLİLİK: öğe KİMLİĞİ, başlık, sanatçı ve URI bu katmandan GEÇMEZ.
   * Yalnız ADET, durum kodu, derece, revizyon ve yaş okunur. */
  readonly f3: F3TelemetrySnapshot;
  /** Kanıtın yaşı — canlılık kapısının girdisi (null = hiç kanıt yok). */
  readonly observedAgeMs: number | null;
  readonly observedMaxAgeMs: number;
  /** Kanıt ŞU AN canlı sayılıyor mu (bayatsa uyumlu DENMEZ). */
  readonly observedLive: boolean;
  readonly listeningHasSession: boolean;
  readonly listeningIntent: string;
  readonly listeningOriginSource: string | null;
  readonly listeningCurrentSource: string | null;
  readonly listeningRestored: boolean | null;
  readonly listeningContinuity: string;
  readonly listeningAlignment: string;
  readonly listeningAlignmentReason: string;
  readonly listeningDesiredApplied: boolean | null;
  readonly listeningItemAgreement: string;
  readonly listeningQueueIndex: number | null;
  readonly listeningQueueLength: number | null;
  /* ── F5 · Birleşik arama ──────────────────────────────────────────────
   * GİZLİLİK: sorgu METNİ bu katmandan GEÇMEZ — yalnız uzunluk, adet,
   * durum kodu, gerekçe ve süre okunur. */
  readonly search: SearchTelemetrySnapshot;
  readonly searchIndexRevision: number | null;
  readonly searchIndexRows: number | null;
  /* ── F6 · Ses deneyimi / DSP ──────────────────────────────────────────
   * GİZLİLİK: burada kullanıcı verisi YOKTUR — yalnız yetenek bayrakları,
   * kazanç sayıları, durum kodları ve sayaçlar okunur. */
  readonly dspCaps: AudioDspCapabilities;
  readonly dspConfig: AudioExperienceConfig;
  readonly dspPreampDb: number;
  readonly dspChannelGains: Readonly<{ left: number; right: number }>;
  readonly dspNative: NativeAudioDspSnapshot | null;
  readonly dspTelemetry: ReturnType<typeof getAudioExperienceTelemetry>;

  /* ── MUSIC F8 · Sürüş-Farkında Müzik Zekâsı ──────────────────────────
   * GİZLİLİK: parça/albüm/sanatçı adı · konum · rota · sağlayıcı içerik
   * kimliği BURADA YOKTUR. Yalnız sınıf adları, sayaçlar ve süreler. */
  readonly f8Started: boolean;
  readonly f8Bucket: string;
  readonly f8Motion: string;
  readonly f8Daypart: string;
  readonly f8Journey: string;
  readonly f8ContextConfidence: string;
  /** `sinyal=DURUM` listesi — sinyal ADI ve durumu, DEĞERİ değil. */
  readonly f8Evidence: string;
  readonly f8Missing: string;
  readonly f8PreferenceEntries: number;
  /** Sabit üst sınır — sınırsız profil YOKTUR. */
  readonly f8PreferenceCap: number;
  readonly f8PreferenceKeptTotal: number;
  /** Bu kovadaki en güçlü aday — yalnız NİYET türü ve sayaç (kimlik değil). */
  readonly f8BucketBest: string;
  /** Açık kullanıcı niyetinin üzerinden geçen süre (ms); yoksa `null`. */
  readonly f8ExplicitIntentAgeMs: number | null;
  readonly f8Telemetry: IntelligenceTelemetrySnapshot;

  /* ── MUSIC F9 · Mavi Müzik Niyeti ─────────────────────────────────────
   * GİZLİLİK: söylenen metin · sorgu · parça adı BURADA YOKTUR. Yalnız niyet
   * TÜRÜ, rota, durum, neden kodu, adet ve süre. */
  readonly f9Telemetry: MusicIntentTelemetrySnapshot;

  /* ── MUSIC F14 · Canlı Ses → F9 Kablolama ─────────────────────────────
   * GİZLİLİK: ASR metni/sesli komut içeriği BURADA YOKTUR — yalnız hit/miss
   * adedi, kapı türü ve "eski çift-yürütme yolu yine çağrıldı mı" anomalisi. */
  readonly f14Telemetry: MusicVoiceWiringSnapshot;

  /* ── MUSIC F10 · Karakter (mood/energy) kanıtı ────────────────────────
   * GİZLİLİK: parça/sanatçı adı BURADA YOKTUR — yalnız provenance etiketi,
   * güven, adet ve süre. */
  readonly f10ReferenceProvenance: string;
  readonly f10ReferenceConfidence: string;
  readonly f10ReferenceEnergy: number | null;
  readonly f10CacheSize: number;
  /** MUSIC F10.1 — GERÇEK gömülü BPM (etiket yoksa `null`; uydurma YOK). */
  readonly f10ReferenceBpm: number | null;
  /** Kanıt şeması sürümü — önbellek geçersizleştirmenin parçası. */
  readonly f10SchemaVersion: number;
  /** Kaynak başına ÖLÇÜLEN trait yeteneği (AVAILABLE/UNSUPPORTED/UNVERIFIED). */
  readonly f10SourceAvailability: string;
  readonly f10Telemetry: TraitTelemetrySnapshot;

  /* ── MUSIC F13 · Favoriler / Koleksiyon ────────────────────────────────
   * GİZLİLİK: parça adı · sanatçı · URI · sesli komut metni BURADA YOKTUR —
   * yalnız VAR/YOK, ADET ve sayaç (rule 6). */
  readonly f13SchemaVersion: number;
  readonly f13Total: number;
  readonly f13Local: number;
  readonly f13Provider: number;
  readonly f13Telemetry: MusicCollectionTelemetrySnapshot;

  /* ── MUSIC F15 · Playlist Otoritesi ────────────────────────────────────
   * GİZLİLİK: playlist adı · parça adı · sanatçı · URI · sesli komut metni
   * BURADA YOKTUR — yalnız VAR/YOK, ADET ve sayaç (rule 6). */
  readonly f15SchemaVersion: number;
  readonly f15PlaylistTotal: number;
  readonly f15ItemTotal: number;
  readonly f15Telemetry: MusicPlaylistTelemetrySnapshot;

  /* ── MUSIC F16 · Şarkı Sözleri Otoritesi ─────────────────────────────────
   * GİZLİLİK: söz metni · satırlar · sorgu · sesli komut metni BURADA
   * YOKTUR — yalnız VAR/YOK, ADET ve sayaç (rule 6). */
  readonly f16SchemaVersion: number;
  readonly f16CacheSize: number;
  readonly f16Telemetry: MusicLyricsTelemetrySnapshot;

  /* ── MUSIC F17 · Ses Ölçümü (Sonic Audio Intelligence) ───────────────────
   * GİZLİLİK: parça adı · sanatçı · URI · dosya yolu BURADA YOKTUR — yalnız
   * sayısal ölçüm, ADET ve durum kodu (rule 6). */
  readonly f17SchemaVersion: number;
  readonly f17TempoConfidenceMin: number;
  readonly f17CacheSize: number;
  readonly f17Generation: number;
  readonly f17Running: boolean;
  /** ÇALAN parçanın ölçümü — yoksa hepsi `null` (uydurma YOK). */
  readonly f17ReferenceMeasured: boolean;
  readonly f17ReferenceTempoBpm: number | null;
  readonly f17ReferenceTempoConfidence: number | null;
  readonly f17ReferenceRmsDbfs: number | null;
  readonly f17ReferenceCrestDb: number | null;
  readonly f17ReferenceCentroidHz: number | null;
  readonly f17ReferenceAnalyzedMs: number | null;
  readonly f17Telemetry: SonicTelemetrySnapshot;

  /* ── MUSIC F18 · Kesintisiz Akış (Smart Radio) ───────────────────────────
   * GİZLİLİK: parça/sanatçı adı · URI · sorgu BURADA YOKTUR — yalnız ADET,
   * iddia SINIFI ve sayaç (rule 6). Akış KALICI DEĞİLDİR: burada gösterilen
   * yalnız SON planın özetidir, bir "radyo state"i DEĞİLDİR. */
  readonly f18MaxLength: number;
  readonly f18MaxScan: number;
  readonly f18MeasuredClaimMinCount: number;
  readonly f18Telemetry: SmartRadioTelemetrySnapshot;

  /* ── MUSIC F19 · Seviye Tutarlılığı (Loudness / ReplayGain) ──────────────
   * GİZLİLİK: parça/sanatçı adı · URI BURADA YOKTUR — yalnız sayısal seviye,
   * kaynak ETİKETİ ve sayaç (rule 6). LAB normalizasyon UYGULAMAZ (rule 4). */
  readonly f19Started: boolean;
  readonly f19ReferenceDbfs: number;
  readonly f19MaxAttenuationDb: number;
  readonly f19MinAdjustmentDb: number;
  readonly f19GainTagCacheSize: number;
  readonly f19Factor: number;
  readonly f19AppliedDb: number;
  readonly f19RequestedDb: number | null;
  readonly f19Provenance: string;
  readonly f19Clamped: boolean;
  readonly f19BypassReason: string | null;
  readonly f19Telemetry: LoudnessTelemetrySnapshot;

  /* ── MUSIC F20 · Parça Geçişi (Gapless / Fade) ───────────────────────────
   * GİZLİLİK: parça adı · URI BURADA YOKTUR. LAB politika UYGULAMAZ (rule 4).
   * DÜRÜSTLÜK: gerçek crossfade DESTEKLENMEZ ve öyle GÖSTERİLMEZ. */
  readonly f20Started: boolean;
  readonly f20FadeEnabled: boolean;
  readonly f20PreferredFadeMs: number;
  readonly f20Kind: string;
  readonly f20Reason: string;
  readonly f20FadeOutMs: number;
  readonly f20EvidenceBacked: boolean;
  /** Yetenek tablosu — ÖLÇÜM kaydı, niyet değil. */
  readonly f20Capabilities: readonly { readonly id: string; readonly state: string }[];
  /** Native'in bildirdiği canlı geçiş kanıtı. */
  readonly f20NativeGain: number | null;
  readonly f20NativeActive: boolean | null;
  readonly f20GaplessSupported: boolean | null;
  readonly f20Telemetry: TransitionTelemetrySnapshot;
  readonly f20PersistFailures: number;
  readonly f20PersistRejected: number;

  /* ── MUSIC F21 · Süreklilik / Kurtarma ───────────────────────────────────
   * GİZLİLİK: parça adı · URI BURADA YOKTUR. LAB kurtarma TETİKLEMEZ ve
   * çalma BAŞLATMAZ (rule 4). */
  readonly f21SessionRestored: boolean;
  readonly f21PlayableEntries: number;
  readonly f21UserPaused: boolean;
  readonly f21Ignition: string;
  readonly f21Online: boolean;
  readonly f21RequiresNetwork: boolean;
  readonly f21QueueSource: string | null;
  readonly f21AutoResumePolicy: boolean;
  readonly f21Telemetry: RecoveryTelemetrySnapshot;
}

/** Volume KİMLİK TOKEN'ı taşınır; mount yolu veya kullanıcı içeriği TAŞINMAZ. */
export interface LibraryVolumeRow {
  readonly name: string;
  readonly available: boolean;
  readonly hasVersion: boolean;
  readonly hasGeneration: boolean;
  readonly lastSuccessfulRefreshAt: number | null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Açılışta / elle YENİLE'de çağrılan TEK okuma. */
export function readMediaAuthoritySnapshot(): MediaAuthorityRawSnapshot {
  const readAt = Date.now();
  const s = safe(() => getSnapshot(), {
    authorityAvailable: false, activeSource: 'NONE', focusState: 'NONE',
    audioRoute: 'UNKNOWN', playing: false, renderingVerified: false,
  });

  const recovery = safe(() => {
    const decision = decideRecovery(readPersistedRaw(), readAt);
    return decision.action === 'NONE'
      ? { label: `YOK (${decision.reason})`, count: null as number | null }
      : { label: 'DURAKLATILMIŞ GERİ YÜKLEME', count: decision.state.items.length };
  }, { label: 'OKUNAMADI', count: null as number | null });

  /* Kuyruk uzlaştırma. GİRDİ: native'e GÖNDERİLEN pencere (UI'nin tamamı DEĞİL).
     Yerel müzikte UI kuyruğu binlerce parça olabilirken native'e 120'lik pencere
     yazılır; tüm listeyle karşılaştırma SÜREKLİ yanlış "uzunluk sapması" üretirdi.
     Projeksiyon okunamazsa sonuç "uyumlu" DEĞİL, KARŞILAŞTIRILAMADI olur. */
  const uiQueue = safe(() => getUiQueueView(), null);
  const projected = safe(() => getProjectedQueueView(), null);
  const reconciliation = safe(() => reconcileQueue(
    projected
      ? {
        revision: projected.revision,
        length: projected.length,
        currentIndex: projected.currentIndex,
        source: projected.source,
        currentItemId: projected.currentItemId,
      }
      : null,
    s.authorityAvailable === true
      ? {
        revision: s.queueRevision ?? 0,
        length: s.queueLength ?? 0,
        currentIndex: s.currentIndex ?? -1,
        source: isKnownSourceClass(s.activeSource) ? s.activeSource : null,
        currentItemId: s.currentTrackId ? s.currentTrackId : null,
      }
      : null,
  ), {
    drift: 'UNKNOWN' as QueueDrift,
    authoritative: 'none' as const,
    reason: 'Uzlaştırma okunamadı.',
  });

  /* PAKET B kaynakları — her biri kendi try/catch'i içinde, hiçbiri komut GÖNDERMEZ. */
  const lastRecovery = safe(() => getLastRecovery(), null);
  const ledger = safe(() => getRecoveryLedger(), { entries: [] as const });
  const events = safe(() => getMediaEvents(), {
    events: [] as readonly MediaEvent[], capacity: 0, dropped: 0, total: 0,
  });
  const sessions = safe(() => listSessions(), [] as const);
  const validation = safe(() => summarize(sessions), {
    total: 0, pass: 0, fail: 0, blocked: 0, notRun: 0,
    coveredScenarios: 0, totalScenarios: 0,
  });
  const results = safe(() => latestResults(sessions), {} as Record<string, ScenarioResult>);
  const activeSession = safe(() => getActiveSession(), null);

  /* F2 — kütüphane ve kapak gözlemi. Her okuma kendi try/catch'inde; hiçbir
     tarama TETİKLENMEZ (refreshMusicLibrary BURADAN çağrılmaz). */
  const library = safe(() => getMusicLibrarySnapshot(), null);
  const refreshState = safe(() => loadRefreshState(), null);
  const lastRefresh = safe(() => getLastMusicRefreshOutcome(), null);
  const refreshCounters = safe(() => getMusicRefreshCounters(), {
    rounds: 0, applied: 0, skipped: 0, failed: 0, unavailable: 0, trackQueries: 0, escalations: 0,
  });
  const indexPerf = safe(() => getMusicIndexPerfSnapshot(), null);
  const artwork = safe(() => getArtworkCacheSnapshot(), null);

  /* F3.2 — dinleme bağlamı gözlemi. Hiçbir devir TETİKLENMEZ, hiçbir komut
     GÖNDERİLMEZ; projeksiyon zaten salt-okunurdur ve LAB onu yalnız OKUR. */
  const f3 = safe(() => getF3TelemetrySnapshot(), {
    status: 'UNAVAILABLE' as const,
    counters: {
      observedPublished: 0, observedAvailable: 0, observedUnavailable: 0,
      observedRejected: 0, observedStaleReads: 0,
      alignMatched: 0, alignPrefix: 0, alignDrift: 0, alignUnsupported: 0, alignUnknown: 0,
      continuityCarried: 0, continuityDegraded: 0, continuityBroken: 0, continuityUnknown: 0,
      handoverRequested: 0, handoverVerified: 0, handoverUnverified: 0,
      handoverFailed: 0, handoverRollback: 0,
      sessionCommitted: 0, commitStaleDropped: 0, commitDuplicateDropped: 0, commitRejected: 0,
      queueCommandApplied: 0, queueCommandRejected: 0,
    },
    lastObserved: null, lastAlignment: null, lastFulfillment: null,
    lastIdentityFidelity: null, lastContinuity: null, lastCommitAtMs: null,
    lastDropReason: null, recentHandovers: [], handoverCapacity: 0,
  });
  const observedRaw = safe(() => peekObservedQueueEvidence(), null);
  const observedAge = safe(() => observedQueueAgeMs(readAt), null);
  const observedLive = observedRaw !== null
    && observedRaw.availability === 'AVAILABLE'
    && observedAge !== null
    && observedAge <= OBSERVED_QUEUE_MAX_AGE_MS;
  const listeningSession = safe(() => getListeningSession(), null);
  /* F5 — arama gözlemi. LAB arama TETİKLEMEZ: yalnız son turun kanıtı okunur
     ve indeks `peek` ile bakılır (yeniden KURULMAZ). */
  const search = safe(() => getSearchTelemetrySnapshot(), {
    status: 'UNAVAILABLE' as const,
    counters: {
      queries: 0, emptyQueries: 0, rawResults: 0, normalizedResults: 0,
      dedupMerged: 0, dedupAmbiguousKept: 0, staleResultDrops: 0, cancellations: 0,
      providerFailures: 0, providerUnsupportedSkips: 0, providerUnavailableSkips: 0,
      indexBuilds: 0, selections: 0, selectionRejected: 0,
      voiceQueries: 0, voiceAutoPlayed: 0, voiceAmbiguousHeld: 0, legacySearchCalls: 0,
    },
    localSearchP50Ms: null, localSearchP95Ms: null,
    providerSearchP50Ms: null, providerSearchP95Ms: null,
    firstResultP50Ms: null, completeSearchP50Ms: null, completeSearchP95Ms: null,
    projectionP50Ms: null, indexLookupP50Ms: null, indexLookupP95Ms: null,
    lastGeneration: 0, lastState: null, lastQueryLength: null,
    lastEligibleSources: [], lastIndexRows: null, lastFinalCount: null,
    lastRankingSignals: [], recentSourceRuns: [], sourceRunCapacity: 0,
    registeredProviders: 0, excludedProviders: 0,
    voiceSearchP50Ms: null, voiceSelectionP50Ms: null,
    discoveryProjectionP50Ms: null, discoverySections: null,
    discoveryRows: null, discoverySuppressedSections: null,
  });
  const searchIndex = safe(() => peekLocalSearchIndex(), null);

  /* F6 — ses deneyimi otoritesinin salt-okunur gözlemi. */
  /* MUSIC F8 · bağlam + tercih kanıtı TEK okumada alınır. `peekDrivingContext`
     üretim histerezisini ilerletmez; karar BURADA üretilmez — son karar
     telemetriden okunur (LAB salt gözlem). */
  /* MUSIC F10 · referans (çalan parça) kanıtı — SALT OKUMA, seçim yapmaz. */
  const f10Reference = safe(() => peekReferenceEvidence(), {
    energy: null, tempoBpm: null, mood: null, confidence: 'NONE' as const,
    provenance: 'NONE' as const, sourceId: 'none', observedAtMs: null, signals: [],
  });
  const f8Context = safe(() => peekDrivingContext(), {
    motion: 'UNKNOWN' as const, daypart: 'UNKNOWN' as const, journey: 'UNKNOWN' as const,
    bucket: 'UNKNOWN', confidence: 'NONE' as const, evidence: [], missing: [],
  });
  const f8Preference = safe(() => getPreferenceEvidence(), { entries: [], revision: 0 });
  const f8Best = safe(() => bestPreferenceFor(f8Context.bucket, f8Preference), null);
  const f8ExplicitAt = safe(() => getExplicitUserIntentAtMs(), null);
  const dspCaps = safe(() => getDspCapabilities(), UNPROBED_CAPABILITIES);
  const dspConfig = safe(
    () => getDspConfig(),
    { enabled: false, presetId: 'flat' as const, bandGainsDb: [], loudnessDb: 0, balance: 0 },
  );
  const dspTelemetry = safe(() => getAudioExperienceTelemetry(), {
    probeCount: 0, probeFailures: 0, applyRequested: 0, applyCoalesced: 0,
    applySent: 0, applyAccepted: 0, applyRejected: 0, applyErrors: 0,
    staleRejections: 0, revalidations: 0, persistWrites: 0, persistRejected: 0,
    bypassObserved: 0, applyLatencySumMs: 0, applyLatencyMaxMs: 0,
    applyLatencyCount: 0, probeLatencyLastMs: 0, lastFailureCode: '',
    applyLatencyAvgMs: null, capsGeneration: 0, started: false,
  } as ReturnType<typeof getAudioExperienceTelemetry>);
  /* Projeksiyon KANONİK saf fonksiyondan üretilir (ikinci hesap YOK), ama canlı
     `getListeningProjection` yolundan DEĞİL: o yol hizalama sayacını yazar ve
     LAB okuması hiçbir üretim sayacını DEĞİŞTİRMEMELİDİR. Aynı sebeple bayat
     kanıdı `getObservedQueueEvidence` ile değil, `peek` + yaş kapısıyla eleriz. */
  const listening = safe(() => {
    const queue = getDesiredQueue();
    return buildListeningProjection({
      session: listeningSession,
      queue,
      supportsQueue: sourceSupportsQueue(queue.source ?? listeningSession?.currentSource ?? null),
      observedItemIds: observedLive && observedRaw ? observedRaw.entries : null,
      observedCurrentItemId: observedLive && observedRaw && observedRaw.currentIndex !== null
        ? observedRaw.entries[observedRaw.currentIndex] ?? null
        : null,
    });
  }, null);

  return {
    readAt,
    isNativePlatform: safe(() => isNative, false),
    authorityAvailable: s.authorityAvailable === true,
    activeSourceNative: s.activeSource ?? 'NONE',
    activeSourceGateway: safe(() => getActiveSource(), null),
    focusState: s.focusState ?? 'NONE',
    hasAudioFocus: s.hasAudioFocus ?? null,
    userPaused: s.userPaused ?? null,
    pausedByFocus: s.pausedByFocus ?? null,
    playing: s.playing === true,
    playWhenReady: s.playWhenReady ?? null,
    renderingVerified: s.renderingVerified === true,
    buffering: s.buffering ?? null,
    audioRoute: s.audioRoute ?? 'UNKNOWN',
    noisyReceiverActive: s.noisyReceiver ?? null,
    duckVolume: s.duckVolume ?? null,
    duckReasonsNative: s.duckReasons ?? [],
    duckReasonsGateway: safe(() => getActiveDuckReasons(), []),
    effectiveVolumeNative: s.effectiveVolume ?? null,
    effectiveVolumeGateway: safe(() => getEffectiveVolume(), null),
    desiredQueueSource: safe(() => getDesiredQueue().source ?? 'YOK', 'OKUNAMADI'),
    desiredQueueLength: safe(() => getDesiredQueue().entries.length, 0),
    desiredQueueIndex: safe(() => getDesiredQueue().currentIndex, -1),
    desiredQueueOrigins: safe(() => {
      const counts = { LIBRARY: 0, PROVIDER: 0, RECOVERED: 0 };
      for (const e of getDesiredQueue().entries) counts[e.origin] += 1;
      return `K:${counts.LIBRARY} · S:${counts.PROVIDER} · R:${counts.RECOVERED}`;
    }, 'OKUNAMADI'),
    providerQueueExcluded: safe(() => getProviderQueueExclusionCount(), 0),
    layerProjectionSize: safe(() => getLayerProjectionSize(), 0),
    vehicleSpeedKmh: safe(() => useUnifiedVehicleStore.getState().speed, null),
    videoVisibility: safe(
      () => decideVideoVisibility({
        speedKmh: useUnifiedVehicleStore.getState().speed,
        previous: 'BLOCKED_SPEED_UNKNOWN',
      }),
      'BLOCKED_SPEED_UNKNOWN',
    ),
    duckRequested: safe(() => getDuckRequestCounters().requested, 0),
    duckReleased: safe(() => getDuckRequestCounters().released, 0),
    duckFailed: safe(() => getDuckRequestCounters().failed, 0),
    userVolumeNative: s.userVolume ?? null,
    queueRevision: s.queueRevision ?? null,
    queueLength: s.queueLength ?? null,
    currentIndex: s.currentIndex ?? null,
    positionMs: s.positionMs ?? null,
    durationMs: s.durationMs ?? null,
    shuffle: s.shuffle ?? null,
    repeat: s.repeat ?? 'off',
    lastPauseReason: s.lastPauseReason ?? '',
    lastFailureCode: s.lastFailureCode ?? '',
    recoveryCountNative: s.recoveryCount ?? null,
    // Başlık/sanatçının KENDİSİ değil, yalnız varlığı taşınır.
    hasTrackMetadata: Boolean(s.title) || Boolean(s.artist),
    evidence: safe(() => getMediaAuthorityEvidence(), {
      status: 'UNAVAILABLE',
      counters: {
        commandsTotal: 0, verified: 0, acceptedUnverified: 0, failed: 0,
        timedOut: 0, superseded: 0, rejected: 0, duplicateBackendDetected: 0,
        recoveryCount: 0, recoverySucceeded: 0,
        handoverTotal: 0, handoverFailed: 0,
      },
      sourceSwitchLatencyMs: null,
      playStartLatencyMs: null,
      lastFailure: null,
      recentCommands: [],
      recordCapacity: 0,
    }),
    recoveryDecision: recovery.label,
    recoveryItemCount: recovery.count,
    uiQueueRevision: uiQueue ? uiQueue.revision : null,
    uiQueueLength: uiQueue ? uiQueue.length : null,
    uiQueueIndex: uiQueue ? uiQueue.currentIndex : null,
    projectedRevision: projected ? projected.revision : null,
    projectedLength: projected ? projected.length : null,
    projectedIndex: projected ? projected.currentIndex : null,
    queueDrift: reconciliation.drift,
    queueDriftReason: reconciliation.reason,

    recoveryOutcome: lastRecovery ? lastRecovery.outcome : 'HENÜZ ÇALIŞMADI',
    recoveryAction: lastRecovery ? lastRecovery.decision.action : '',
    recoveryCode: lastRecovery ? lastRecovery.decision.code : '',
    recoveryReason: lastRecovery ? lastRecovery.decision.reason : '',
    recoveryAtMs: lastRecovery ? lastRecovery.appliedAtMs : null,
    recoveryBreakersOpen: ledger.entries.filter(
      (e) => e.breakerOpenUntilMs !== null && e.breakerOpenUntilMs > readAt,
    ).length,
    recoveryLedgerSize: ledger.entries.length,
    handoverInFlight: safe(() => isHandoverInFlight(), false),
    userCommandInFlight: safe(() => isUserCommandInFlight(), false),
    authorityGeneration: safe(() => getAuthorityGeneration(), null),

    eventTotal: events.total,
    eventDropped: events.dropped,
    eventCapacity: events.capacity,
    // Bounded: LAB yalnız SON 30 olayı görür (render maliyeti + bellek).
    recentEvents: events.events.slice(-30),

    validationSummary: validation,
    validationActiveState: activeSession ? activeSession.state : 'idle',
    validationActiveScenario: activeSession ? activeSession.scenarioId : '',
    validationResults: results,

    libraryAvailability: library ? library.availability : 'UNAVAILABLE',
    libraryRevision: library ? library.revision : null,
    libraryTrackCount: library ? library.tracks.length : null,
    libraryStaleCount: library ? library.tracks.filter((x) => x.availability === 'STALE').length : null,
    libraryAlbumCount: library ? library.albums.length : null,
    libraryArtistCount: library ? library.artists.length : null,
    libraryFolderCount: library ? library.folders.length : null,
    libraryVolumes: refreshState
      ? refreshState.volumes.map((v) => Object.freeze({
        name: v.volumeName,
        available: v.available,
        hasVersion: v.version !== null,
        hasGeneration: v.generation !== null,
        lastSuccessfulRefreshAt: v.lastSuccessfulRefreshAt ?? null,
      }))
      : [],
    refreshPersistedSchema: refreshState ? refreshState.schema : null,
    refreshPermissionPersisted: refreshState ? refreshState.permissionGranted : null,
    refreshLastSuccessAtMs: refreshState?.lastSuccessfulRefreshAt ?? null,
    refreshDecision: lastRefresh ? lastRefresh.decision : '',
    refreshStatus: lastRefresh ? lastRefresh.status : '',
    refreshReason: lastRefresh ? lastRefresh.reason : '',
    refreshPermissionTransition: lastRefresh ? lastRefresh.permission : '',
    refreshSupportsGeneration: lastRefresh ? lastRefresh.supportsGeneration : null,
    refreshTrackQueries: lastRefresh ? lastRefresh.trackQueries : null,
    refreshTracksReceived: lastRefresh ? lastRefresh.tracksReceived : null,
    refreshStaleVolumes: lastRefresh ? lastRefresh.staleVolumes : [],
    refreshPrunedVolumes: lastRefresh ? lastRefresh.prunedVolumes : [],
    refreshStatePersisted: lastRefresh ? lastRefresh.statePersisted : null,
    refreshFailureCode: lastRefresh?.failureCode ?? '',
    refreshInFlight: safe(() => isMusicRefreshInFlight(), false),
    refreshCounters,
    indexP50Ms: indexPerf ? indexPerf.indexP50Ms : null,
    indexP95Ms: indexPerf ? indexPerf.indexP95Ms : null,
    searchP50Ms: indexPerf ? indexPerf.searchP50Ms : null,
    searchP95Ms: indexPerf ? indexPerf.searchP95Ms : null,

    artworkMemoryEntries: artwork ? artwork.entries : null,
    artworkMemoryBytes: artwork ? artwork.bytes : null,
    artworkMemoryMaxBytes: artwork ? artwork.maxBytes : null,
    artworkInFlight: artwork ? artwork.inFlight : null,
    artworkRemoteResolved: artwork ? artwork.remoteResolved : null,
    artworkNativeFileTier: artwork ? artwork.nativeFileTier : null,
    artworkDiskHydrated: artwork ? artwork.disk.hydrated : null,
    artworkDiskSchema: artwork ? artwork.disk.schema : null,
    artworkDiskEntries: artwork ? artwork.disk.entries : null,
    artworkDiskBytes: artwork ? artwork.disk.bytes : null,
    artworkDiskMaxBytes: artwork ? artwork.disk.maxBytes : null,

    f3,
    observedAgeMs: observedAge,
    observedMaxAgeMs: OBSERVED_QUEUE_MAX_AGE_MS,
    observedLive,
    listeningHasSession: listening ? listening.hasSession : false,
    listeningIntent: listening && listening.intent ? listening.intent : '',
    listeningOriginSource: listening ? listening.originSource : null,
    listeningCurrentSource: listening ? listening.currentSource : null,
    listeningRestored: listeningSession ? listeningSession.restored : null,
    listeningContinuity: listening ? listening.continuity : 'UNKNOWN',
    listeningAlignment: listening ? listening.alignment : 'UNKNOWN',
    listeningAlignmentReason: listening ? listening.alignmentReason : '',
    listeningDesiredApplied: listening && listening.hasSession ? listening.desiredApplied : null,
    listeningItemAgreement: listening ? listening.currentItemAgreement : 'UNKNOWN',
    listeningQueueIndex: listening && listening.queuePosition ? listening.queuePosition.index : null,
    listeningQueueLength: listening && listening.queuePosition ? listening.queuePosition.length : null,

    search,
    searchIndexRevision: searchIndex ? searchIndex.revision : null,
    searchIndexRows: searchIndex ? searchIndex.rows : null,

    /* F6 — hepsi SENKRON getter; hiçbir probe/apply TETİKLENMEZ.
       LAB ikinci otorite değildir: burada hesaplanan hiçbir değer üretim
       kararına geri beslenmez (CLAUDE.md · LAB mimari sınırı). */
    dspCaps,
    dspConfig,
    dspPreampDb: safe(() => getSafetyPreampDb(), 0),
    dspChannelGains: safe(() => getChannelGains(), { left: 1, right: 1 }),
    dspNative: safe(() => getDspNativeSnapshot(), null),
    dspTelemetry,

    /* MUSIC F8 — okuma SIRASINDA karar üretilmez ve üretim durumu değişmez. */
    f8Started: safe(() => isMusicIntelligenceStarted(), false),
    f8Bucket: f8Context.bucket,
    f8Motion: f8Context.motion,
    f8Daypart: f8Context.daypart,
    f8Journey: f8Context.journey,
    f8ContextConfidence: f8Context.confidence,
    f8Evidence: f8Context.evidence.map((e) => `${e.signal}=${e.state}`).join(' · ') || 'YOK',
    f8Missing: f8Context.missing.length > 0 ? f8Context.missing.join(' · ') : 'YOK',
    f8PreferenceEntries: f8Preference.entries.length,
    f8PreferenceCap: MAX_PREFERENCE_ENTRIES,
    f8PreferenceKeptTotal: f8Preference.entries.reduce((n, e) => n + e.kept, 0),
    f8BucketBest: f8Best === null
      ? 'YOK'
      : `${f8Best.intent} · korundu ${f8Best.kept} · bırakıldı ${f8Best.abandoned}`,
    f8ExplicitIntentAgeMs: f8ExplicitAt === null ? null : Math.max(0, Date.now() - f8ExplicitAt),
    f8Telemetry: safe(() => getIntelligenceTelemetry(), {
      counters: {
        evaluations: 0, hold: 0, suggest: 0, autoResume: 0, applied: 0, applyFailed: 0,
        explicitOverrides: 0, notedStarted: 0, notedKept: 0, notedAbandoned: 0,
        droppedUnknownBucket: 0,
      },
      samples: 0, decideP50Ms: null, decideP95Ms: null,
      lastAction: null, lastReason: null, lastSuppressed: [],
      lastBucket: null, lastDecidedAtMs: null,
    }),

    /* MUSIC F9 — okuma SIRASINDA niyet çözülmez ve komut gönderilmez. */
    f9Telemetry: safe(() => getMusicIntentTelemetry(), {
      counters: {
        resolved: 0, unresolved: 0, dispatched: 0, verified: 0, acceptedUnverified: 0,
        ambiguous: 0, rejected: 0, unavailable: 0, failed: 0, notAttempted: 0,
        sourceQualified: 0, sourceHeld: 0, contextualRequests: 0, contextualFulfilled: 0,
        contextualNoEvidence: 0, queueCommands: 0, queueUnsupported: 0,
        staleDrops: 0, claimMismatch: 0,
      },
      resolveSamples: 0, dispatchSamples: 0,
      resolveP50Ms: null, resolveP95Ms: null, dispatchP50Ms: null, dispatchP95Ms: null,
      lastKind: null, lastRoute: null, lastStatus: null, lastClaim: null,
      lastReasonCode: null, lastSourcePreference: null,
      lastUsedContextEvidence: null, lastAtMs: null,
    }),

    /* MUSIC F14 — okuma SIRASINDA hiçbir bypass kararı verilmez. */
    f14Telemetry: safe(() => getMusicVoiceWiringTelemetry(), {
      counters: {
        bypassAttempts: 0, bypassHits: 0, bypassMisses: 0,
        legacyTypeReroute: 0, narrowSafeBypass: 0, legacyRouteIntentCalls: 0,
      },
      lastGateAtMs: null,
    }),

    /* MUSIC F10 — okuma SIRASINDA seçim yapılmaz ve kanıt YAZILMAZ. */
    f10ReferenceProvenance: f10Reference.provenance,
    f10ReferenceConfidence: f10Reference.confidence,
    f10ReferenceEnergy: f10Reference.energy,
    f10CacheSize: safe(() => getTraitCacheSize(), 0),
    f10ReferenceBpm: f10Reference.tempoBpm,
    f10SchemaVersion: TRAIT_SCHEMA_VERSION,
    f10SourceAvailability: safe(
      () => Object.entries(PROVIDER_TRAIT_AVAILABILITY)
        .map(([k, v]) => `${k}:${v}`).join(' · '),
      'OKUNAMADI',
    ),
    f10Telemetry: safe(() => getTraitTelemetry(), {
      counters: {
        requests: 0, selected: 0, noReference: 0, noEvidence: 0, noCandidate: 0,
        evidenceMeasured: 0, evidenceProvider: 0, evidenceEmbedded: 0,
        evidenceLibrary: 0, evidenceDuration: 0,
        evidenceHeuristic: 0, evidenceNone: 0,
        tentativeClaims: 0, confidentClaims: 0,
        cacheHits: 0, cacheMisses: 0, claimMismatch: 0,
      },
      samples: 0, selectP50Ms: null, selectP95Ms: null,
      lastDirection: null, lastStatus: null, lastConfidence: null,
      lastProvenance: null, lastReferenceProvenance: null,
      lastConsidered: null, lastRejectedNoEvidence: null,
      lastRejectedWrongDirection: null, lastReasonCode: null, lastAtMs: null,
    }),

    /* MUSIC F13 — okuma SIRASINDA mutasyon YAPILMAZ; yalnız VAR/YOK + ADET. */
    f13SchemaVersion: COLLECTION_SCHEMA_VERSION,
    ...safe(() => {
      const c = getFavoritesCount();
      return { f13Total: c.total, f13Local: c.local, f13Provider: c.provider };
    }, { f13Total: 0, f13Local: 0, f13Provider: 0 }),
    f13Telemetry: safe(() => getMusicCollectionTelemetry(), {
      counters: {
        added: 0, removed: 0, toggled: 0, alreadyPresent: 0, alreadyAbsent: 0,
        rejectedNoIdentity: 0, rejectedCollectionFull: 0, persistWriteFailures: 0,
        persistLoadRejectedRecords: 0, migrationDrops: 0, unresolvedLocalLookups: 0,
      },
      projectionSamples: 0, projectionP50Ms: null, projectionP95Ms: null,
      lastMutationStatus: null, lastMutationAtMs: null,
      lastLocalCount: null, lastProviderCount: null,
    }),

    /* MUSIC F15 — okuma SIRASINDA mutasyon YAPILMAZ; yalnız VAR/YOK + ADET. */
    f15SchemaVersion: PLAYLIST_SCHEMA_VERSION,
    ...safe(() => {
      const c = getPlaylistsCount();
      return { f15PlaylistTotal: c.total, f15ItemTotal: c.items };
    }, { f15PlaylistTotal: 0, f15ItemTotal: 0 }),
    f15Telemetry: safe(() => getMusicPlaylistTelemetry(), {
      counters: {
        created: 0, renamed: 0, deleted: 0, itemAdded: 0, itemAlreadyPresent: 0,
        itemRemoved: 0, itemAlreadyAbsent: 0, reordered: 0,
        rejectedNoIdentity: 0, rejectedNotFound: 0, rejectedNameEmpty: 0,
        rejectedPlaylistLimit: 0, rejectedItemLimit: 0,
        persistWriteFailures: 0, persistLoadRejectedRecords: 0, unresolvedLocalLookups: 0,
      },
      projectionSamples: 0, projectionP50Ms: null, projectionP95Ms: null,
      lastMutationStatus: null, lastMutationAtMs: null,
      lastPlaylistCount: null, lastItemTotal: null,
      lastLocalItemCount: null, lastProviderItemCount: null,
    }),

    /* MUSIC F16 — okuma SIRASINDA mutasyon YAPILMAZ; yalnız VAR/YOK + ADET. */
    f16SchemaVersion: LYRICS_SCHEMA_VERSION,
    f16CacheSize: safe(() => getLyricsCacheSize(), 0),
    f16Telemetry: safe(() => getMusicLyricsTelemetry(), {
      counters: {
        resolvedAvailablePlain: 0, resolvedAvailableSynced: 0, resolvedUnavailable: 0, resolvedUnknown: 0,
        cacheHits: 0, cacheMisses: 0, cacheStaleDropped: 0, identityMismatchRejected: 0,
        parseFailures: 0, fakeSyncPrevented: 0, persistWriteFailures: 0, persistLoadRejectedRecords: 0,
      },
      syncProjectionSamples: 0, syncProjectionP50Ms: null, syncProjectionP95Ms: null,
      lastFormat: null, lastSource: null, lastAtMs: null,
    }),

    /* MUSIC F17 — okuma SIRASINDA analiz TETİKLENMEZ ve sayaç DEĞİŞMEZ:
       `peekSonicDescriptor` bilerek sayaçsız okuyucudur (F3.2 sözleşmesi). */
    f17SchemaVersion: SONIC_SCHEMA_VERSION,
    f17TempoConfidenceMin: TEMPO_CONFIDENCE_MIN,
    f17CacheSize: safe(() => getSonicCacheSize(), 0),
    f17Generation: safe(() => getSonicGeneration(), 0),
    f17Running: safe(() => isSonicAnalysisRunning(), false),
    ...safe(() => {
      const item = getListeningSession()?.currentItem ?? null;
      const id = item?.libraryId ?? null;
      const d = id === null ? null : peekSonicDescriptor(id, null);
      if (d === null) return SONIC_REFERENCE_NONE;
      return {
        f17ReferenceMeasured: true,
        f17ReferenceTempoBpm: d.tempoBpm,
        f17ReferenceTempoConfidence: d.tempoConfidence,
        f17ReferenceRmsDbfs: d.rmsDbfs,
        f17ReferenceCrestDb: d.crestDb,
        f17ReferenceCentroidHz: d.spectralCentroidHz,
        f17ReferenceAnalyzedMs: d.analyzedMs,
      };
    }, SONIC_REFERENCE_NONE),
    f17Telemetry: safe(() => getSonicTelemetry(), {
      counters: {
        requested: 0, admitted: 0, deferred: 0, bypassed: 0,
        measured: 0, failedDecode: 0, failedUnsupported: 0, failedTimeout: 0,
        failedTooShort: 0, failedSilent: 0, cancelled: 0, rejectedMalformed: 0,
        tempoAccepted: 0, tempoRejectedWeak: 0,
        cacheHits: 0, cacheMisses: 0, cacheStaleDropped: 0,
        reanalysisPrevented: 0, staleResultDropped: 0,
        nativeUnavailable: 0, nativeErrors: 0,
      },
      samples: 0, runP50Ms: null, runP95Ms: null,
      lastDecision: null, lastReason: null, lastBatchSize: null,
      lastFailure: null, lastTier: null, lastAtMs: null,
    }),

    /* MUSIC F18 — okuma SIRASINDA plan ÜRETİLMEZ (`planSmartRadio` çağrılmaz):
       LAB gözlem yüzeyidir, ikinci bir sıralama otoritesi DEĞİLDİR. */
    f18MaxLength: MAX_RADIO_LENGTH,
    f18MaxScan: MAX_RADIO_SCAN,
    f18MeasuredClaimMinCount: MEASURED_CLAIM_MIN_COUNT,
    f18Telemetry: safe(() => getSmartRadioTelemetry(), {
      counters: {
        requests: 0, planned: 0, noCandidate: 0, emptyLibrary: 0,
        claimMeasured: 0, claimWeak: 0, claimFallback: 0,
        appended: 0, started: 0, executionRejected: 0, queueUnsupported: 0,
        explicitIntentDeferred: 0, recentExcluded: 0, recentReadmitted: 0, artistSpacing: 0,
      },
      samples: 0, planP50Ms: null, planP95Ms: null,
      lastStatus: null, lastClaim: null, lastSeed: null,
      lastLength: null, lastMeasured: null, lastReasonCode: null, lastAtMs: null,
    }),

    /* MUSIC F19 — okuma SIRASINDA normalizasyon UYGULANMAZ: yalnız son
       kararın özeti okunur (LAB ikinci bir ses otoritesi DEĞİLDİR). */
    f19Started: safe(() => isLoudnessNormalizationStarted(), false),
    f19ReferenceDbfs: RMS_REFERENCE_DBFS,
    f19MaxAttenuationDb: MAX_ATTENUATION_DB,
    f19MinAdjustmentDb: MIN_ADJUSTMENT_DB,
    f19GainTagCacheSize: safe(() => getGainTagCacheSize(), 0),
    ...safe(() => {
      const r = getLastNormalization();
      return {
        f19Factor: r.factor,
        f19AppliedDb: r.appliedDb,
        f19RequestedDb: r.requestedDb,
        f19Provenance: r.provenance,
        f19Clamped: r.clamped,
        f19BypassReason: r.bypassReason,
      };
    }, {
      f19Factor: 1, f19AppliedDb: 0, f19RequestedDb: null,
      f19Provenance: 'NONE', f19Clamped: false, f19BypassReason: 'NO_EVIDENCE',
    }),
    f19Telemetry: safe(() => getLoudnessTelemetry(), {
      counters: {
        evaluated: 0,
        evidenceReplayGain: 0, evidenceR128: 0, evidenceMeasured: 0, evidenceNone: 0,
        applied: 0, neutral: 0,
        bypassNoEvidence: 0, bypassBelowThreshold: 0, bypassBoostUnsupported: 0,
        clamped: 0, unchangedSkipped: 0, applyFailures: 0,
      },
      samples: 0, applyP50Ms: null, applyP95Ms: null,
      lastProvenance: null, lastFactor: null, lastAppliedDb: null,
      lastRequestedDb: null, lastBypass: null, lastAtMs: null,
    }),

    /* MUSIC F20 — okuma SIRASINDA politika UYGULANMAZ: yalnız son karar,
       kullanıcı tercihi ve native'in bildirdiği kanıt okunur. */
    f20Started: safe(() => isTransitionPolicyStarted(), false),
    ...safe(() => {
      const pref = getTransitionPreference();
      return { f20FadeEnabled: pref.fadeEnabled, f20PreferredFadeMs: pref.fadeMs };
    }, { f20FadeEnabled: false, f20PreferredFadeMs: 0 }),
    ...safe(() => {
      const policy = getLastTransitionPolicy();
      if (policy === null) {
        return {
          f20Kind: 'UNKNOWN', f20Reason: 'UNKNOWN',
          f20FadeOutMs: 0, f20EvidenceBacked: false,
        };
      }
      return {
        f20Kind: policy.kind,
        f20Reason: policy.reason,
        f20FadeOutMs: policy.fadeOutMs,
        f20EvidenceBacked: policy.evidenceBacked,
      };
    }, {
      f20Kind: 'UNKNOWN', f20Reason: 'UNKNOWN',
      f20FadeOutMs: 0, f20EvidenceBacked: false,
    }),
    f20Capabilities: safe(
      () => TRANSITION_CAPABILITIES.map((c) => ({ id: c.id, state: c.state })),
      [],
    ),
    f20NativeGain: safe<number | null>(() => {
      const g = s.transitionGain;
      return typeof g === 'number' ? g : null;
    }, null),
    f20NativeActive: safe<boolean | null>(() => {
      const a = s.transitionActive;
      return typeof a === 'boolean' ? a : null;
    }, null),
    f20GaplessSupported: safe<boolean | null>(() => {
      const g = s.gaplessSupported;
      return typeof g === 'boolean' ? g : null;
    }, null),
    f20Telemetry: safe(() => getTransitionTelemetry(), {
      counters: {
        decisions: 0, gapless: 0, fade: 0, none: 0,
        skippedDisabled: 0, skippedLive: 0, skippedDuck: 0,
        evidenceBacked: 0,
        pushAccepted: 0, pushRejected: 0, pushFailed: 0, unchangedSkipped: 0,
        persistWriteFailures: 0, persistLoadRejected: 0,
      },
      lastKind: null, lastReason: null, lastFadeMs: null, lastAtMs: null,
    }),
    /* Kalıcılık sayaçları tercih SAHİBİNDEN okunur (tek kaynak). */
    ...safe(() => {
      const c = getTransitionPersistCounters();
      return { f20PersistFailures: c.persistFailures, f20PersistRejected: c.loadRejected };
    }, { f20PersistFailures: 0, f20PersistRejected: 0 }),

    /* MUSIC F21 — okuma SIRASINDA karar ÜRETİLMEZ ve çalma BAŞLATILMAZ:
       `readRecoveryEvidence` yan etkisiz okumadır (telemetriye de yazmaz). */
    ...safe(() => {
      const e = readRecoveryEvidence();
      return {
        f21SessionRestored: e.sessionRestored,
        f21PlayableEntries: e.playableEntries,
        f21UserPaused: e.userPaused,
        f21Ignition: e.ignition,
        f21Online: e.online,
        f21RequiresNetwork: e.requiresNetwork,
        f21QueueSource: e.queueSource,
      };
    }, {
      f21SessionRestored: false, f21PlayableEntries: 0, f21UserPaused: false,
      f21Ignition: 'UNKNOWN', f21Online: false, f21RequiresNetwork: false,
      f21QueueSource: null,
    }),
    f21AutoResumePolicy: POLICY_ALLOWS_AUTO_RESUME,
    f21Telemetry: safe(() => getRecoveryTelemetry(), {
      counters: {
        restoreAttempts: 0, restoreSucceeded: 0, restoreRejected: 0,
        bootRestoreRuns: 0, bootRestoreSkippedNativeLive: 0,
        entriesLocal: 0, entriesResolveAtPlay: 0,
        entriesExpiringDropped: 0, entriesUnknownDropped: 0,
        autoResumeHold: 0, autoResumeOffer: 0, autoResumeResume: 0,
        ignitionUnknown: 0, offlineBlocked: 0,
      },
      lastDecision: null, lastReason: null, lastIgnition: null,
      lastOnline: null, lastRestoreRejection: null, lastAtMs: null,
    }),
  };
}

/** Ölçüm YOKKEN kullanılan sabit — sahte 0 yerine dürüst `null` taşır. */
const SONIC_REFERENCE_NONE = Object.freeze({
  f17ReferenceMeasured: false,
  f17ReferenceTempoBpm: null,
  f17ReferenceTempoConfidence: null,
  f17ReferenceRmsDbfs: null,
  f17ReferenceCrestDb: null,
  f17ReferenceCentroidHz: null,
  f17ReferenceAnalyzedMs: null,
});
