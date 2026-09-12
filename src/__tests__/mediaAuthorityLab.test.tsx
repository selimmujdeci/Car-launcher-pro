/**
 * mediaAuthorityLab.test.tsx — CAROS LAB · Medya Otoritesi ekranı DAVRANIŞ KİLİTLERİ.
 *
 * ZORUNLU GÖZLEMLENEBİLİRLİK KURALI (CLAUDE.md): "gözlemlenemeyen özellik
 * tamamlanmış değildir." Bu dosya yedi şartın test edilebilir olanlarını kilitler:
 *   · katalog↔ekran eşlemesi GERÇEKTEN var (PLACEHOLDER değil)
 *   · ekran salt-okunur (komut göndermez, timer kurmaz)
 *   · kanıtsız bilgi ÜRETİLMEZ (UNAVAILABLE; sahte 0 / sahte "sağlıklı" yok)
 *   · gizli veri (başlık · sanatçı · URI · kapak) LAB'a TAŞINMAZ
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CAROS_LAB_TOOLS, getCarosLabTool, isToolOpenable, resolveToolActivation,
} from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';
import {
  buildMediaAuthorityCards, deriveMediaAuthorityVerdict, countByMediaAuthorityClass,
} from '../platform/devtools/mediaAuthorityModel';
import type { MediaAuthorityRawSnapshot } from '../platform/devtools/mediaAuthoritySources';
import { getF3TelemetrySnapshot } from '../platform/media/session/sessionTelemetry';
import { getSearchTelemetrySnapshot } from '../platform/media/search/searchTelemetry';
import { readMediaAuthoritySnapshot } from '../platform/devtools/mediaAuthoritySources';
import { DEVICE_SCENARIOS } from '../platform/media/authority/deviceValidationModel';
import { UNPROBED_CAPABILITIES } from '../platform/media/audio/audioExperienceModel';

/* ── Test fixture: otorite YOK (web / servis başlamadı) ──────────────────── */

function snapshot(over: Partial<MediaAuthorityRawSnapshot> = {}): MediaAuthorityRawSnapshot {
  return {
    readAt: 1_000,
    isNativePlatform: true,
    authorityAvailable: false,
    activeSourceNative: 'NONE',
    activeSourceGateway: null,
    focusState: 'NONE',
    hasAudioFocus: null,
    userPaused: null,
    pausedByFocus: null,
    playing: false,
    playWhenReady: null,
    renderingVerified: false,
    buffering: null,
    audioRoute: 'UNKNOWN',
    noisyReceiverActive: null,
    duckVolume: null,
    duckReasonsNative: [],
    duckReasonsGateway: [],
    effectiveVolumeNative: null,
    effectiveVolumeGateway: null,
    userVolumeNative: null,
    queueRevision: null,
    queueLength: null,
    currentIndex: null,
    positionMs: null,
    durationMs: null,
    shuffle: null,
    repeat: 'off',
    lastPauseReason: '',
    lastFailureCode: '',
    recoveryCountNative: null,
    hasTrackMetadata: false,
    evidence: {
      status: 'UNAVAILABLE',
      counters: {
        commandsTotal: 0, verified: 0, acceptedUnverified: 0, failed: 0,
        timedOut: 0, superseded: 0, rejected: 0, duplicateBackendDetected: 0,
        recoveryCount: 0, handoverTotal: 0, handoverFailed: 0,
      },
      sourceSwitchLatencyMs: null,
      playStartLatencyMs: null,
      lastFailure: null,
      recentCommands: [],
      recordCapacity: 30,
    },
    recoveryDecision: 'YOK (no_saved_state)',
    recoveryItemCount: null,
    uiQueueRevision: null,
    uiQueueLength: null,
    uiQueueIndex: null,
    projectedRevision: null,
    projectedLength: null,
    projectedIndex: null,
    queueDrift: 'UNKNOWN',
    queueDriftReason: 'Native timeline okunamadı.',
    recoveryOutcome: 'HENÜZ ÇALIŞMADI',
    recoveryAction: '',
    recoveryCode: '',
    recoveryReason: '',
    recoveryAtMs: null,
    recoveryBreakersOpen: 0,
    recoveryLedgerSize: 0,
    handoverInFlight: false,
    userCommandInFlight: false,
    authorityGeneration: 0,
    eventTotal: 0,
    eventDropped: 0,
    eventCapacity: 120,
    recentEvents: [],
    validationSummary: {
      total: 0, pass: 0, fail: 0, blocked: 0,
      notRun: DEVICE_SCENARIOS.length,
      coveredScenarios: 0, totalScenarios: DEVICE_SCENARIOS.length,
    },
    validationActiveState: 'idle',
    validationActiveScenario: '',
    validationResults: {},
    /* F2 — yerel kütüphane ve kapak gözlemi. Varsayılan: HİÇ tarama olmamış
       bir cihaz; sahte 'hazır' üretilmez. */
    libraryAvailability: 'UNAVAILABLE',
    libraryRevision: 0,
    libraryTrackCount: 0,
    libraryStaleCount: 0,
    libraryAlbumCount: 0,
    libraryArtistCount: 0,
    libraryFolderCount: 0,
    libraryVolumes: [],
    refreshPersistedSchema: null,
    refreshPermissionPersisted: null,
    refreshLastSuccessAtMs: null,
    refreshDecision: '',
    refreshStatus: '',
    refreshReason: '',
    refreshPermissionTransition: '',
    refreshSupportsGeneration: null,
    refreshTrackQueries: null,
    refreshTracksReceived: null,
    refreshStaleVolumes: [],
    refreshPrunedVolumes: [],
    refreshStatePersisted: null,
    refreshFailureCode: '',
    refreshInFlight: false,
    refreshCounters: {
      rounds: 0, applied: 0, skipped: 0, failed: 0, unavailable: 0, trackQueries: 0, escalations: 0,
    },
    indexP50Ms: null,
    indexP95Ms: null,
    searchP50Ms: null,
    searchP95Ms: null,
    artworkMemoryEntries: 0,
    artworkMemoryBytes: 0,
    artworkMemoryMaxBytes: 2 * 1024 * 1024,
    artworkInFlight: 0,
    artworkNativeFileTier: true,
    artworkDiskHydrated: false,
    artworkDiskSchema: 1,
    artworkDiskEntries: 0,
    artworkDiskBytes: 0,
    artworkDiskMaxBytes: 24 * 1024 * 1024,
    /* F3.2 — dinleme bağlamı kanıtı. Varsayılan: HİÇ gözlem yok (UNAVAILABLE);
       böylece "sahte sağlıklı" bir taban ile test edilmediğimiz kilitlenir. */
    f3: getF3TelemetrySnapshot(),
    observedAgeMs: null,
    observedMaxAgeMs: 15_000,
    observedLive: false,
    listeningHasSession: false,
    listeningIntent: '',
    listeningOriginSource: null,
    listeningCurrentSource: null,
    listeningRestored: null,
    listeningContinuity: 'UNKNOWN',
    listeningAlignment: 'UNKNOWN',
    listeningAlignmentReason: '',
    listeningDesiredApplied: null,
    listeningItemAgreement: 'UNKNOWN',
    listeningQueueIndex: null,
    listeningQueueLength: null,
    /* F5 — birleşik arama kanıtı. Varsayılan: hiç arama yapılmamış cihaz. */
    search: getSearchTelemetrySnapshot(),
    searchIndexRevision: null,
    searchIndexRows: null,
    /* F6 — ses deneyimi / DSP. Varsayılan: HİÇ ölçülmemiş cihaz;
       sahte "DSP hazır" ÜRETİLMEZ. */
    dspCaps: UNPROBED_CAPABILITIES,
    dspConfig: { enabled: true, presetId: 'flat', bandGainsDb: [], loudnessDb: 0, balance: 0 },
    dspPreampDb: 0,
    dspChannelGains: { left: 1, right: 1 },
    dspNative: null,
    dspTelemetry: {
      probeCount: 0, probeFailures: 0, applyRequested: 0, applyCoalesced: 0,
      applySent: 0, applyAccepted: 0, applyRejected: 0, applyErrors: 0,
      staleRejections: 0, revalidations: 0, persistWrites: 0, persistRejected: 0,
      bypassObserved: 0, applyLatencySumMs: 0, applyLatencyMaxMs: 0,
      applyLatencyCount: 0, probeLatencyLastMs: 0, lastFailureCode: '',
      applyLatencyAvgMs: null, capsGeneration: 0, started: false,
    },
    /* MUSIC F8 · sürüş-farkında zekâ. Varsayılan fixture KANITSIZ dünyadır:
       bağlam UNKNOWN, kanıt yok, karar yok — sahte "hazır" üretilmez. */
    f8Started: false,
    f8Bucket: 'UNKNOWN',
    f8Motion: 'UNKNOWN',
    f8Daypart: 'UNKNOWN',
    f8Journey: 'UNKNOWN',
    f8ContextConfidence: 'NONE',
    f8Evidence: 'YOK',
    f8Missing: 'vehicle.speed',
    f8PreferenceEntries: 0,
    f8PreferenceCap: 48,
    f8PreferenceKeptTotal: 0,
    f8BucketBest: 'YOK',
    f8ExplicitIntentAgeMs: null,
    f8Telemetry: {
      counters: {
        evaluations: 0, hold: 0, suggest: 0, autoResume: 0, applied: 0, applyFailed: 0,
        explicitOverrides: 0, notedStarted: 0, notedKept: 0, notedAbandoned: 0,
        droppedUnknownBucket: 0,
      },
      samples: 0, decideP50Ms: null, decideP95Ms: null,
      lastAction: null, lastReason: null, lastSuppressed: [],
      lastBucket: null, lastDecidedAtMs: null,
    },
    /* MUSIC F9 · Mavi müzik niyeti. Varsayılan fixture: hiç niyet çözülmemiş
       dünya — sahte "hazır/başarılı" üretilmez. */
    f9Telemetry: {
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
    },
    /* MUSIC F10 · karakter kanıtı. Varsayılan fixture: hiçbir ölçüm YOK —
       gerçek trait kaynağı bugün bağlı değildir ve sahte kanıt üretilmez. */
    f10ReferenceProvenance: 'NONE',
    f10ReferenceConfidence: 'NONE',
    f10ReferenceEnergy: null,
    f10CacheSize: 0,
    f10ReferenceBpm: null,
    f10SchemaVersion: 2,
    f10SourceAvailability: 'local:AVAILABLE · youtube:UNSUPPORTED · spotify:UNVERIFIED',
    f10Telemetry: {
      counters: {
        requests: 0, selected: 0, noReference: 0, noEvidence: 0, noCandidate: 0,
        evidenceProvider: 0, evidenceLibrary: 0, evidenceDuration: 0,
        evidenceHeuristic: 0, evidenceNone: 0,
        tentativeClaims: 0, confidentClaims: 0,
        cacheHits: 0, cacheMisses: 0, claimMismatch: 0,
      },
      samples: 0, selectP50Ms: null, selectP95Ms: null,
      lastDirection: null, lastStatus: null, lastConfidence: null,
      lastProvenance: null, lastReferenceProvenance: null,
      lastConsidered: null, lastRejectedNoEvidence: null,
      lastRejectedWrongDirection: null, lastReasonCode: null, lastAtMs: null,
    },
    /* MUSIC F13 · favoriler/koleksiyon. Varsayılan fixture: boş koleksiyon —
       gerçek favori YOK, sahte "0 favori var" iddiası ÜRETİLMEZ (0 gerçek). */
    f13SchemaVersion: 1,
    f13Total: 0, f13Local: 0, f13Provider: 0,
    f13Telemetry: {
      counters: {
        added: 0, removed: 0, toggled: 0, alreadyPresent: 0, alreadyAbsent: 0,
        rejectedNoIdentity: 0, rejectedCollectionFull: 0, persistWriteFailures: 0,
        persistLoadRejectedRecords: 0, migrationDrops: 0, unresolvedLocalLookups: 0,
      },
      projectionSamples: 0, projectionP50Ms: null, projectionP95Ms: null,
      lastMutationStatus: null, lastMutationAtMs: null,
      lastLocalCount: null, lastProviderCount: null,
    },
    /* MUSIC F14 · canlı ses → F9 kablolama. Varsayılan fixture: hiç bypass
       denenmedi — sahte "ses bağlandı" iddiası ÜRETİLMEZ (0 gerçek). */
    f14Telemetry: {
      counters: {
        bypassAttempts: 0, bypassHits: 0, bypassMisses: 0,
        legacyTypeReroute: 0, narrowSafeBypass: 0, legacyRouteIntentCalls: 0,
      },
      lastGateAtMs: null,
    },
    /* MUSIC F15 · playlist otoritesi. Varsayılan fixture: boş — gerçek
       playlist YOK, sahte "0 playlist var" iddiası ÜRETİLMEZ (0 gerçek). */
    f15SchemaVersion: 1,
    f15PlaylistTotal: 0, f15ItemTotal: 0,
    f15Telemetry: {
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
    },
    /* MUSIC F16 · lyrics otoritesi. Varsayılan fixture: boş — gerçek kanıt
       YOK, sahte "söz bulundu" iddiası ÜRETİLMEZ (0 gerçek). */
    f16SchemaVersion: 1,
    f16CacheSize: 0,
    f16Telemetry: {
      counters: {
        resolvedAvailablePlain: 0, resolvedAvailableSynced: 0, resolvedUnavailable: 0, resolvedUnknown: 0,
        cacheHits: 0, cacheMisses: 0, cacheStaleDropped: 0, identityMismatchRejected: 0,
        parseFailures: 0, fakeSyncPrevented: 0, persistWriteFailures: 0, persistLoadRejectedRecords: 0,
      },
      syncProjectionSamples: 0, syncProjectionP50Ms: null, syncProjectionP95Ms: null,
      lastFormat: null, lastSource: null, lastAtMs: null,
    },
    /* MUSIC F17 · ses ölçümü. Varsayılan fixture: HİÇ ölçüm yok — kart
       UNAVAILABLE göstermeli, sahte 0 dBFS/BPM ÜRETİLMEMELİ. */
    f17SchemaVersion: 1,
    f17TempoConfidenceMin: 0.35,
    f17CacheSize: 0,
    f17Generation: 0,
    f17Running: false,
    f17ReferenceMeasured: false,
    f17ReferenceTempoBpm: null,
    f17ReferenceTempoConfidence: null,
    f17ReferenceRmsDbfs: null,
    f17ReferenceCrestDb: null,
    f17ReferenceCentroidHz: null,
    f17ReferenceAnalyzedMs: null,
    f17Telemetry: {
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
    },
    /* MUSIC F18 · kesintisiz akış. Varsayılan fixture: hiç plan üretilmedi —
       kart UNAVAILABLE göstermeli, sahte "sana özel akış" İDDİA EDİLMEMELİ. */
    f18MaxLength: 40,
    f18MaxScan: 400,
    f18MeasuredClaimMinCount: 4,
    f18Telemetry: {
      counters: {
        requests: 0, planned: 0, noCandidate: 0, emptyLibrary: 0,
        claimMeasured: 0, claimWeak: 0, claimFallback: 0,
        appended: 0, started: 0, executionRejected: 0, queueUnsupported: 0,
        explicitIntentDeferred: 0, recentExcluded: 0, recentReadmitted: 0, artistSpacing: 0,
      },
      samples: 0, planP50Ms: null, planP95Ms: null,
      lastStatus: null, lastClaim: null, lastSeed: null,
      lastLength: null, lastMeasured: null, lastReasonCode: null, lastAtMs: null,
    },
    /* MUSIC F19 · seviye tutarlılığı. Varsayılan fixture: kanıt YOK —
       çarpan tam 1.0 olmalı ve kart sahte bir kısma GÖSTERMEMELİ. */
    f19Started: false,
    f19ReferenceDbfs: -14,
    f19MaxAttenuationDb: 12,
    f19MinAdjustmentDb: 1,
    f19GainTagCacheSize: 0,
    f19Factor: 1,
    f19AppliedDb: 0,
    f19RequestedDb: null,
    f19Provenance: 'NONE',
    f19Clamped: false,
    f19BypassReason: 'NO_EVIDENCE',
    f19Telemetry: {
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
    },
    /* MUSIC F20 · parça geçişi. Varsayılan fixture: tercih KAPALI, karar
       yok — kart sahte bir "crossfade var" izlenimi VERMEMELİ. */
    f20Started: false,
    f20FadeEnabled: false,
    f20PreferredFadeMs: 1200,
    f20Kind: 'UNKNOWN',
    f20Reason: 'UNKNOWN',
    f20FadeOutMs: 0,
    f20EvidenceBacked: false,
    f20Capabilities: [
      { id: 'GAPLESS', state: 'AVAILABLE' },
      { id: 'BOUNDARY_FADE', state: 'AVAILABLE' },
      { id: 'TRUE_CROSSFADE', state: 'UNSUPPORTED' },
      { id: 'BEAT_MATCHED', state: 'UNSUPPORTED' },
    ],
    f20NativeGain: null,
    f20NativeActive: null,
    f20GaplessSupported: null,
    f20Telemetry: {
      counters: {
        decisions: 0, gapless: 0, fade: 0, none: 0,
        skippedDisabled: 0, skippedLive: 0, skippedDuck: 0,
        evidenceBacked: 0,
        pushAccepted: 0, pushRejected: 0, pushFailed: 0, unchangedSkipped: 0,
        persistWriteFailures: 0, persistLoadRejected: 0,
      },
      lastKind: null, lastReason: null, lastFadeMs: null, lastAtMs: null,
    },
    f20PersistFailures: 0,
    f20PersistRejected: 0,
    /* MUSIC F21 · süreklilik. Varsayılan fixture: oturum geri yüklenmemiş,
       kontak ÖLÇÜLEMEMİŞ — kart sahte bir "devam edilebilir" izlenimi
       VERMEMELİ ve otomatik devam politikası KAPALI görünmeli. */
    f21SessionRestored: false,
    f21PlayableEntries: 0,
    f21UserPaused: false,
    f21Ignition: 'UNKNOWN',
    f21Online: false,
    f21RequiresNetwork: false,
    f21QueueSource: null,
    f21AutoResumePolicy: false,
    f21Telemetry: {
      counters: {
        restoreAttempts: 0, restoreSucceeded: 0, restoreRejected: 0,
        entriesLocal: 0, entriesResolveAtPlay: 0,
        entriesExpiringDropped: 0, entriesUnknownDropped: 0,
        autoResumeHold: 0, autoResumeOffer: 0, autoResumeResume: 0,
        ignitionUnknown: 0, offlineBlocked: 0,
      },
      lastDecision: null, lastReason: null, lastIgnition: null,
      lastOnline: null, lastRestoreRejection: null, lastAtMs: null,
    },
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Katalog ↔ ekran eşlemesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — Medya Otoritesi aracı katalogda ve GERÇEKTEN açılıyor', () => {
  it('katalogda AVAILABLE olarak kayıtlı (runtime kategorisi)', () => {
    const tool = getCarosLabTool('media-authority');
    expect(tool).toBeDefined();
    expect(tool?.category).toBe('runtime');
    expect(tool?.status).toBe('AVAILABLE');
    expect(isToolOpenable(tool ?? null)).toBe(true);
    expect(resolveToolActivation(tool ?? null)).toBe('media-authority');
  });

  it('AVAILABLE olan her araç gibi GERÇEK bir ekrana eşlenir (sahte "hazır" yok)', () => {
    expect(renderAvailableTool('media-authority')).not.toBeNull();
  });

  it('katalogdaki tüm AVAILABLE araçların ekranı vardır — katalog↔kod ayrışması yok', () => {
    const orphans = CAROS_LAB_TOOLS
      .filter((t) => t.status === 'AVAILABLE')
      .filter((t) => renderAvailableTool(t.id) === null)
      .map((t) => t.id);
    expect(orphans).toEqual([]);
  });

  it('katalog notu oynatma komutu göndermediğini açıkça beyan eder', () => {
    const note = getCarosLabTool('media-authority')?.note ?? '';
    expect(note).toContain('GÖNDERMEZ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Fail-closed hüküm — kanıt yoksa "sağlıklı" DENMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — hüküm fail-closed', () => {
  it('otorite yoksa UNAVAILABLE ("duraklatıldı" VARSAYILMAZ)', () => {
    const v = deriveMediaAuthorityVerdict(snapshot());
    expect(v.status).toBe('UNAVAILABLE');
    expect(v.reasons.join(' ')).toContain('BİLİNMİYOR');
  });

  it('web modunda native otorite YOKTUR', () => {
    expect(deriveMediaAuthorityVerdict(snapshot({ isNativePlatform: false })).status)
      .toBe('UNAVAILABLE');
  });

  it('"çalıyor" diyor ama ses kanıtı yoksa → YALNIZ İSTEK', () => {
    const v = deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, playing: true, renderingVerified: false,
      hasAudioFocus: false,
    }));
    expect(v.status).toBe('REQUESTED_ONLY');
    expect(v.reasons.join(' ')).toContain('Ses odağı BİZDE DEĞİL');
  });

  it('render + odak + seviye varsa → SES ÜRETİLİYOR (kanıtlı)', () => {
    expect(deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, playing: true, renderingVerified: true,
    })).status).toBe('RENDERING');
  });

  it('kullanıcı duraklatması ile odak duraklatması AYRI hükümdür', () => {
    expect(deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, userPaused: true,
    })).status).toBe('PAUSED_BY_USER');

    expect(deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, userPaused: false, pausedByFocus: true,
      lastPauseReason: 'focus_loss_transient',
    })).status).toBe('PAUSED_BY_FOCUS');
  });

  it('çift ses kaynağı ihlali HER ŞEYİN ÖNÜNDE raporlanır', () => {
    const v = deriveMediaAuthorityVerdict(snapshot({
      authorityAvailable: true, playing: true, renderingVerified: true,
      evidence: { ...snapshot().evidence, counters: {
        ...snapshot().evidence.counters, duplicateBackendDetected: 1,
      } },
    }));
    // Ses kanıtı olsa BİLE ihlal gizlenmez.
    expect(v.status).toBe('DUPLICATE_BACKEND');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Kanıtsız bilgi üretilmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — bilinmeyen alan UNAVAILABLE, sahte 0 YOK', () => {
  it('otorite yokken NATIVE\'e bağlı hiçbir alan OBSERVED sunulmaz', () => {
    // KİLİDİN ÖZÜ: native servise bağlı kartlar (oynatma gerçeği · ses odağı ·
    // ses/ducking) otorite erişilemezken "ölçüldü" DİYEMEZ. JS tarafında yerel
    // olarak gerçekten sayılan alanlar (gateway kapıları, olay tamponu, kanıt
    // sayaçları, doğrulama kayıtları) bu kuralın DIŞINDADIR — onlar native'den
    // bağımsız ölçümlerdir ve UNAVAILABLE göstermek YANLIŞ olurdu.
    const cards = buildMediaAuthorityCards(snapshot());
    const nativeBackedCards = ['playback', 'focus', 'volume'];
    const jsLocalFields = new Set([
      'duck-reasons-gw', 'vol-eff-gw',
      /* MUSIC F6.1: duck İSTEK sayaçları JS tarafında sayılır (native'den bağımsız). */
      'duck-req', 'duck-req-failed',
      /* MUSIC F7.2: araç hızı ve video kapısı MEDYA otoritesinden BAĞIMSIZDIR —
         medya servisi kapalıyken de ölçülür (kaynağı VehicleDataLayer). */
      'video-speed', 'video-gate',
    ]);

    cards
      .filter((c) => nativeBackedCards.includes(c.id))
      .flatMap((c) => c.fields)
      .filter((f) => !jsLocalFields.has(f.id))
      .forEach((f) => {
        expect(`${f.id}:${f.klass}`).toBe(`${f.id}:UNAVAILABLE`);
      });
  });

  it('otorite kartında yalnız platform ve erişilebilirlik ÖLÇÜLDÜ sayılır', () => {
    const authority = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'authority');
    const observed = authority?.fields.filter((f) => f.klass === 'OBSERVED').map((f) => f.id);
    expect(observed).toEqual(['platform', 'available']);
  });

  it('ölçülmemiş gecikmeler "—" gösterilir (sahte 0 DEĞİL)', () => {
    const truth = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'truth');
    const latency = truth?.fields.find((f) => f.id === 'lat-play');
    expect(latency?.value).toBe('—');
    expect(latency?.klass).toBe('UNAVAILABLE');
  });

  it('kuyruk uzlaştırması karşılaştırılamadığında UNAVAILABLE olur', () => {
    const queue = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'queue');
    const drift = queue?.fields.find((f) => f.id === 'q-drift');
    expect(drift?.value).toBe('KARŞILAŞTIRILAMADI');
    expect(drift?.klass).toBe('UNAVAILABLE');
  });

  it('yirmi sekiz kart da üretilir ve sınıf sayacı tutarlıdır', () => {
    const cards = buildMediaAuthorityCards(snapshot());
    /* F2 kapanışı iki kart EKLEDİ (yeni ekran DEĞİL): yerel kütüphane + kapak.
       F3.2 kapanışı üç kart daha EKLEDİ — yine yeni ekran DEĞİL, mevcut ekran
       GENİŞLETİLDİ (LAB yüzey politikası: ekran enflasyonu yasağı). */
    expect(cards.map((c) => c.id)).toEqual([
      'authority', 'playback', 'focus', 'volume', 'queue', 'truth', 'recovery',
      'queue-recovery', 'events', 'device-validation', 'library', 'artwork',
      'listening-session', 'observed-queue', 'handover-commit',
      // F5 kapanışı bir kart daha EKLEDİ — yine yeni ekran DEĞİL.
      'unified-search',
      // F6 kapanışı ses deneyimi / DSP kartını EKLEDİ — yine yeni ekran DEĞİL.
      'audio-experience',
      /* F8 kapanışı sürüş-farkında müzik kartını EKLEDİ — yine YENİ EKRAN DEĞİL
         (LAB yüzey politikası: ekran enflasyonu yasağı). Kart SALT GÖZLEMDİR:
         karar üretmez, yalnız son kararı ve kanıtı gösterir. */
      'driving-intelligence',
      /* F9 kapanışı Mavi müzik niyeti kartını EKLEDİ — yine YENİ EKRAN DEĞİL.
         Kart salt gözlemdir: niyet çözmez, komut göndermez. */
      'mavi-music-intent',
      /* F10 kapanışı karakter/enerji kanıtı kartını EKLEDİ — yine YENİ EKRAN
         DEĞİL. Kart kanıtın ZAYIFLIĞINI gizlemeden gösterir. */
      'music-traits',
      /* F13 kapanışı favoriler/koleksiyon kartını EKLEDİ — yine YENİ EKRAN
         DEĞİL (LAB yüzey politikası). Kart salt gözlemdir: mutasyon
         tetiklemez, yalnız VAR/YOK + ADET + sayaç gösterir. */
      'music-collection',
      /* F15 kapanışı playlist otoritesi kartını EKLEDİ — yine YENİ EKRAN
         DEĞİL (LAB yüzey politikası). Kart salt gözlemdir: mutasyon
         tetiklemez, yalnız VAR/YOK + ADET + sayaç gösterir. */
      'music-playlist',
      /* F16 kapanışı şarkı sözleri otoritesi kartını EKLEDİ — yine YENİ EKRAN
         DEĞİL (LAB yüzey politikası). Kart salt gözlemdir: söz metni TAŞIMAZ,
         yalnız VAR/YOK + ADET + sayaç gösterir. */
      'music-lyrics',
      /* F17 kapanışı ses ölçümü kartını EKLEDİ — yine YENİ EKRAN DEĞİL (LAB
         yüzey politikası). Kart salt gözlemdir: analiz TETİKLEMEZ, yalnız
         sayısal ölçüm + ADET + sayaç gösterir. */
      'music-sonic',
      /* F18 kapanışı kesintisiz akış kartını EKLEDİ — yine YENİ EKRAN DEĞİL
         (LAB yüzey politikası). Kart salt gözlemdir: plan ÜRETMEZ, yalnız
         ADET + iddia SINIFI + sayaç gösterir. */
      'music-radio',
      /* F19 kapanışı seviye tutarlılığı kartını EKLEDİ — yine YENİ EKRAN
         DEĞİL. Kart salt gözlemdir: normalizasyon UYGULAMAZ. */
      'music-loudness',
      /* F20 kapanışı parça geçişi kartını EKLEDİ — yine YENİ EKRAN DEĞİL.
         Kart salt gözlemdir: politika UYGULAMAZ ve olmayan yeteneği
         (gerçek crossfade) VAR gibi göstermez. */
      'music-transition',
      /* F21 kapanışı süreklilik/kurtarma kartını EKLEDİ — yine YENİ EKRAN
         DEĞİL. Kart salt gözlemdir: kurtarma TETİKLEMEZ, çalma BAŞLATMAZ. */
      'music-recovery',
    ]);
    const counts = countByMediaAuthorityClass(cards);
    const total = cards.reduce((n, c) => n + c.fields.length, 0);
    expect(counts.OBSERVED + counts.DERIVED + counts.UNAVAILABLE + counts.STALE).toBe(total);
  });
});


/* ══════════════════════════════════════════════════════════════════════════
 * 3c · F6 — Ses deneyimi / DSP gözlemi
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — F6 ses deneyimi dürüstçe gösterilir', () => {
  const dspCard = (over = {}) =>
    buildMediaAuthorityCards(snapshot(over)).find((c) => c.id === 'audio-experience')!;

  it('DSP ölçülmemişse hiçbir alan ÖLÇÜLDÜ sunulmaz', () => {
    const card = dspCard();
    expect(card).toBeTruthy();
    const measured = card.fields.filter((f) => f.klass === 'OBSERVED');
    // Yalnız "ölçüldü mü" cevabının kendisi ve sayaç alanları gözlemdir;
    // hiçbir CİHAZ yeteneği ölçülmüş gibi gösterilmez.
    expect(measured.every((f) => !f.id.startsWith('f6-eq'))).toBe(true);
    expect(card.fields.find((f) => f.id === 'f6-probed')!.value).toBe('HAYIR');
  });

  it('fader alanı gerekçesiyle birlikte taşınır (sahte donanım iddiası yok)', () => {
    const f = dspCard().fields.find((x) => x.id === 'f6-balance')!;
    expect(f.note).toMatch(/Fader KAPALI/);
    expect(f.note).toMatch(/stereo/i);
  });

  it('güvenlik payı alanı kullanıcı sesiyle KARIŞTIRILMAZ', () => {
    const f = dspCard().fields.find((x) => x.id === 'f6-preamp')!;
    expect(f.note).toMatch(/KULLANICI SESİ DEĞİLDİR/);
  });

  it('bypass bir arıza değil güvenlik davranışı olarak açıklanır', () => {
    const f = dspCard().fields.find((x) => x.id === 'f6-bypass')!;
    expect(f.note).toMatch(/OYNATMA DEVAM EDER/);
  });

  it('DSP kartında kullanıcı verisi (parça · sanatçı · URI) TAŞINMAZ', () => {
    const joined = dspCard().fields.map((f) => `${f.label} ${f.value}`).join(' ').toLowerCase();
    expect(joined).not.toMatch(/content:\/\/|http|\.mp3|sanatçı adı/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Gizlilik — kullanıcı verisi LAB'a taşınmaz
 * ════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
 * 3b · PAKET B — kurtarma / olay / doğrulama görünürlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — Paket B alanları dürüstçe gösterilir', () => {
  it('kurtarma hiç çalışmadıysa "HENÜZ ÇALIŞMADI" (sahte başarı YOK)', () => {
    const qr = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'queue-recovery');
    const outcome = qr?.fields.find((f) => f.id === 'qr-outcome');
    expect(outcome?.value).toBe('HENÜZ ÇALIŞMADI');
    expect(outcome?.klass).toBe('UNAVAILABLE');
  });

  it('kurtarma kapıları (kullanıcı komutu / devir) görünür', () => {
    const qr = buildMediaAuthorityCards(snapshot({
      userCommandInFlight: true, handoverInFlight: true,
    })).find((c) => c.id === 'queue-recovery');
    expect(qr?.fields.find((f) => f.id === 'qr-gate-user')?.value).toBe('EVET');
    expect(qr?.fields.find((f) => f.id === 'qr-gate-handover')?.value).toBe('EVET');
  });

  it('düşen olay sayısı gizlenmez ("hiç olmadı" ile karıştırılmaz)', () => {
    const ev = buildMediaAuthorityCards(snapshot({ eventDropped: 7, eventTotal: 200 }))
      .find((c) => c.id === 'events');
    expect(ev?.fields.find((f) => f.id === 'ev-dropped')?.value).toBe('7');
  });

  it('cihaz doğrulama kapsamı KOŞULMADI ile başlar', () => {
    const dv = buildMediaAuthorityCards(snapshot()).find((c) => c.id === 'device-validation');
    expect(dv?.fields.find((f) => f.id === 'dv-pass')?.value).toBe('0');
    expect(dv?.fields.find((f) => f.id === 'dv-notrun')?.value)
      .toBe(String(DEVICE_SCENARIOS.length));
    expect(dv?.fields.find((f) => f.id === 'dv-coverage')?.klass).toBe('UNAVAILABLE');
  });

  it('gönderilen pencere ile UI kuyruğu AYRI alanlardır (yanlış pozitif önleme)', () => {
    const q = buildMediaAuthorityCards(snapshot({
      uiQueueRevision: 2, uiQueueLength: 900, uiQueueIndex: 500,
      projectedRevision: 2, projectedLength: 120, projectedIndex: 60,
    })).find((c) => c.id === 'queue');
    expect(q?.fields.find((f) => f.id === 'q-ui')?.value).toBe('2 / 900 / 500');
    expect(q?.fields.find((f) => f.id === 'q-projected')?.value).toBe('2 / 120 / 60');
  });
});

describe('LAB KİLİT — parça başlığı · sanatçı · URI · kapak LAB\'a GİRMEZ', () => {
  it('anlık görüntü tipinde ham metadata alanı YOKTUR', () => {
    const s = snapshot({ authorityAvailable: true, hasTrackMetadata: true }) as unknown as
      Record<string, unknown>;
    ['title', 'artist', 'artworkUri', 'currentTrackId', 'uri', 'url']
      .forEach((k) => expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(false));
    // Yalnız VAR/YOK bilgisi taşınır.
    expect(typeof s.hasTrackMetadata).toBe('boolean');
  });

  it('kart değerlerinde gerçek metadata sızıntısı olmaz', () => {
    const cards = buildMediaAuthorityCards(snapshot({
      authorityAvailable: true, hasTrackMetadata: true,
    }));
    const values = cards.flatMap((c) => c.fields.map((f) => f.value)).join(' | ');
    expect(values).not.toContain('file://');
    expect(values).not.toContain('http');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Ekran salt-okunur ve zamanlayıcısız
 * ════════════════════════════════════════════════════════════════════════ */

describe('LAB KİLİT — ekran komut GÖNDERMEZ, timer KURMAZ', () => {
  it('ilk render sırasında setInterval/setTimeout KURULMAZ', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { MediaAuthorityScreen } = await import(
      '../components/devtools/screens/MediaAuthorityScreen'
    );

    const html = renderToStaticMarkup(<MediaAuthorityScreen />);
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('OYNATMA GERÇEĞİ');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });

  it('okuma katmanı web modunda bile PATLAMAZ ve dürüst "otorite yok" döner', () => {
    const s = readMediaAuthoritySnapshot();
    expect(s.authorityAvailable).toBe(false);
    expect(s.hasTrackMetadata).toBe(false);
    expect(typeof s.readAt).toBe('number');
  });
});
