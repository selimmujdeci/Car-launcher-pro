/**
 * musicF51SearchUnification.test.ts — MUSIC F5.1 kilitleri.
 *
 * Kilitlenen sözleşmeler:
 *   1. Sağlayıcı kaydı — yetenek uydurulmaz, politika bayrağı ezilmez,
 *      kullanılamayan sağlayıcıya sorgu gitmez.
 *   2. Sesli hat KANONİK koordinatörü kullanır — ikinci orkestrasyon/sıralama yok.
 *   3. Belirsiz sonuçta otomatik çalma YOK.
 *   4. Keşif yalnız GERÇEK kanıttan doğar; sahte bölüm/öneri üretilmez.
 *   5. Eski arama yolu authority DEĞİLDİR ve çağrıldığında görünür olur.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetSearchCoordinatorForTest, configureSearchSources, getSearchSnapshot,
  runSearch, searchOnce, type SearchSourcePort,
} from '../platform/media/search/musicSearchCoordinator';
import {
  _resetSearchTelemetryForTest, getSearchTelemetrySnapshot,
} from '../platform/media/search/searchTelemetry';
import {
  isConfidentEnoughToAutoPlay, playByVoiceQuery,
} from '../platform/media/search/voiceSearchIntent';
import { createSpotifySearchPort, createLocalSearchPort } from '../platform/media/search/searchSources';
import { scoreResult } from '../platform/media/search/searchRanking';
import {
  makeProvenance, resultIdFor, type SearchResult,
} from '../platform/media/search/searchResult';
import {
  buildDiscovery, RECENTLY_ADDED_EVIDENCE_RATIO,
} from '../platform/media/search/discoveryModel';
import {
  _resetDiscoveryCacheForTest, getDiscovery, selectDiscoveryItem,
} from '../platform/media/search/discoveryRuntime';
import {
  _resetRecentlyPlayedForTest, clearRecentlyPlayed, getRecentlyPlayed,
  MAX_RECENTLY_PLAYED, rememberPlayed,
} from '../platform/media/search/recentlyPlayed';
import { _resetLocalSearchIndexForTest } from '../platform/media/search/localSearchIndex';
import {
  _resetMusicIndexForTest, getMusicLibrarySnapshot, reconcileMusicIndex,
} from '../platform/media/musicIndex';
import { _resetListeningSessionForTest } from '../platform/media/session/listeningSession';
import {
  _resetListeningHandoverForTest, _setListeningRuntimePortsForTest,
} from '../platform/media/session/listeningSessionRuntime';
import { _resetPlayQueueForTest } from '../platform/media/session/playQueue';
import type { LocalMusicTrack } from '../platform/localMusicService';
import type { CanonicalMediaIdentity } from '../platform/media/session/mediaIdentityMatching';

/* ── Fixture'lar ─────────────────────────────────────────────────────────── */

const localTrack = (over: Partial<LocalMusicTrack> = {}): LocalMusicTrack => ({
  id: 1, uri: 'content://media/external/audio/media/1', title: 'Yol', artist: 'Grup',
  album: 'İlk', durationMs: 180_000, trackNumber: 1, volumeName: 'external_primary',
  ...over,
} as LocalMusicTrack);

const identity = (over: Partial<CanonicalMediaIdentity> = {}): CanonicalMediaIdentity => ({
  libraryId: null, providerId: null, providerNamespace: null, contentUri: null,
  title: 'Yol', artist: 'Grup', album: null, durationMs: 180_000,
  trackNumber: null, discNumber: null,
  ...over,
});

const resultOf = (over: Partial<SearchResult> = {}): SearchResult => Object.freeze({
  resultId: resultIdFor('youtube', 'x'),
  kind: 'TRACK' as const,
  title: 'Yol', artist: 'Grup', album: null, artworkIdentity: null,
  identity: identity({ providerId: 'x', providerNamespace: 'youtube', contentUri: 'piped://x' }),
  libraryTrackId: null,
  availability: 'UNKNOWN' as const,
  provenance: makeProvenance({
    origin: 'PROVIDER', providerId: 'youtube', sourceClass: 'YOUTUBE', observedAtMs: 1,
  }),
  evidence: scoreResult('yol', { title: 'Yol', artist: 'Grup', album: null, availability: 'UNKNOWN' }),
  alternates: Object.freeze([]),
  ...over,
});

function stubPort(input: {
  providerId: SearchSourcePort['providerId'];
  sourceClass: SearchSourcePort['sourceClass'];
  available?: boolean;
  results?: readonly SearchResult[];
  delayMs?: number;
  onSearch?: (q: string) => void;
}): SearchSourcePort {
  return {
    providerId: input.providerId,
    sourceClass: input.sourceClass,
    isAvailable: () => input.available !== false,
    async search(query) {
      input.onSearch?.(query);
      if (input.delayMs) await new Promise((r) => setTimeout(r, input.delayMs));
      return input.results ?? [];
    },
  };
}

/** F3 dispatch kancası — gerçek gateway çağrılmaz, çağrı KANITI toplanır. */
function stubDispatch(): { calls: { source: string; ids: string[] }[] } {
  const calls: { source: string; ids: string[] }[] = [];
  _setListeningRuntimePortsForTest({
    dispatch: async (args) => {
      calls.push({ source: args.source, ids: args.items.map((i) => i.id) });
      return Object.freeze({
        truth: {
          commandId: 'c', sessionId: 's', sourceId: args.source, backend: 'native_authority',
          command: 'playSource', desiredState: 'PLAYING', observedState: 'PLAYING',
          outcome: 'VERIFIED', verificationLevel: 'RENDERING_VERIFIED',
          startedAtMs: 0, endedAtMs: 1, elapsedMs: 1, failureCode: null, retryable: false, stages: [],
        },
        gatewaySessionId: 's', generation: 1,
      });
    },
    persist: () => {},
  });
  return { calls };
}

beforeEach(() => {
  _resetSearchCoordinatorForTest();
  _resetSearchTelemetryForTest();
  _resetLocalSearchIndexForTest();
  _resetMusicIndexForTest();
  _resetRecentlyPlayedForTest();
  _resetDiscoveryCacheForTest();
  clearRecentlyPlayed();   // kalıcı depo testler arasında SIZMAMALI
  _resetListeningSessionForTest();
  _resetListeningHandoverForTest();
  _resetPlayQueueForTest();
  _setListeningRuntimePortsForTest(null);
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(), key: () => null, length: 0,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · SAĞLAYICI KAYDI
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.1 · sağlayıcı kaydı', () => {
  it('Spotify oturumu varken port aranabilir, yokken SKIPPED_UNAVAILABLE olur', async () => {
    let connected = false;
    const calls: string[] = [];
    const port = createSpotifySearchPort({
      isConnected: () => connected,
      search: async (q) => { calls.push(q); return []; },
    });
    configureSearchSources([port]);

    const offline = await runSearch('yol');
    expect(calls).toHaveLength(0);
    expect(offline.sources[0]!.state).toBe('SKIPPED_UNAVAILABLE');
    // Sahte boş sonuç COMPLETE'i YANLIŞ etkilemez.
    expect(offline.emptyReason).toBe('ALL_SOURCES_UNAVAILABLE');

    connected = true;
    await runSearch('yol');
    expect(calls).toEqual(['yol']);
  });

  it('Spotify sonucu kanonik SearchResult\'a normalize edilir ve metadata uydurulmaz', async () => {
    const port = createSpotifySearchPort({
      isConnected: () => true,
      search: async () => [{
        id: 't1', uri: 'spotify:track:t1', title: 'Gülümse',
        artist: 'Sezen Aksu', albumArt: 'https://img/1', durationMs: 210_000,
      }],
    });
    const results = await port.search('gulumse', new AbortController().signal);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      resultId: 'spotify:t1', kind: 'TRACK', title: 'Gülümse', artist: 'Sezen Aksu',
      album: null, availability: 'UNKNOWN',
    });
    expect(results[0]!.provenance).toMatchObject({
      origin: 'PROVIDER', providerId: 'spotify', sourceClass: 'SPOTIFY_CONNECT',
    });
    expect(results[0]!.identity.durationMs).toBe(210_000);
    expect(results[0]!.libraryTrackId).toBeNull();
  });

  it('bir sağlayıcının düşmesi diğerlerini yalıtır', async () => {
    configureSearchSources([
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', results: [resultOf()] }),
      createSpotifySearchPort({
        isConnected: () => true,
        search: async () => { throw new Error('spotify_down'); },
      }),
    ]);
    const snap = await runSearch('yol');
    expect(snap.results).toHaveLength(1);
    expect(snap.state).toBe('DEGRADED');
    expect(snap.sources.find((s) => s.providerId === 'spotify')!.state).toBe('FAILED');
  });

  it('kayıt defteri politikayı EZMEZ — WORLDWIDE kapalıysa global kataloglar dışarıdadır', async () => {
    const { WORLDWIDE_SOURCES_ENABLED } = await import('../platform/media/carosMediaLayer');
    const { _resetSearchRegistryForTest, ensureSearchSourcesConfigured, getSearchRegistryReport } =
      await import('../platform/media/search/searchRegistry');
    _resetSearchRegistryForTest();
    await ensureSearchSourcesConfigured();
    const report = getSearchRegistryReport();

    expect(report.registered).toContain('local');
    if (!WORLDWIDE_SOURCES_ENABLED) {
      ['audius', 'jamendo', 'archive'].forEach((id) => {
        expect(report.registered).not.toContain(id);
        expect(report.excluded.find((e) => e.providerId === id)?.reason)
          .toBe('policy_worldwide_disabled');
      });
    }
    _resetSearchRegistryForTest();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · SESLİ HAT — kanonik birleştirme
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.1 · sesli arama birleştirmesi', () => {
  it('sesli sorgu KANONİK koordinatörden geçer ve kanonik sıralamayı kullanır', async () => {
    const seen: string[] = [];
    configureSearchSources([
      stubPort({
        providerId: 'youtube', sourceClass: 'YOUTUBE', onSearch: (q) => seen.push(q),
        results: [
          resultOf({
            resultId: 'youtube:weak', title: 'Uzun Yolda',
            evidence: scoreResult('yol', { title: 'Uzun Yolda', artist: null, album: null, availability: 'UNKNOWN' }),
          }),
          resultOf({
            resultId: 'youtube:exact', title: 'Yol',
            evidence: scoreResult('yol', { title: 'Yol', artist: null, album: null, availability: 'UNKNOWN' }),
          }),
        ],
      }),
    ]);

    const out = await playByVoiceQuery('yol');
    expect(seen).toEqual(['yol']);
    // Kanonik sıralama: tam başlık eşleşmesi seçilir (sağlayıcı sırası DEĞİL).
    expect(out.selected?.resultId).toBe('youtube:exact');
    expect(out.outcome).toBe('PROVIDER_PATH');
    expect(getSearchTelemetrySnapshot().counters.voiceQueries).toBe(1);
  });

  it('sesli arama ekrandaki arama durumunu DEĞİŞTİRMEZ', async () => {
    configureSearchSources([
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', results: [resultOf()] }),
    ]);
    await runSearch('ekranda');
    const surfaceBefore = getSearchSnapshot();

    await playByVoiceQuery('seste');

    const surfaceAfter = getSearchSnapshot();
    expect(surfaceAfter.query).toBe(surfaceBefore.query);
    expect(surfaceAfter.generation).toBe(surfaceBefore.generation);
  });

  it('belirsiz sonuçta OTOMATİK ÇALMA YAPILMAZ', async () => {
    // Metin kanıtı hiç tutmayan sonuç (matchKind NONE).
    const noMatch = resultOf({
      resultId: 'youtube:none', title: 'Bambaşka Bir Şey',
      evidence: scoreResult('metallica', {
        title: 'Bambaşka Bir Şey', artist: null, album: null, availability: 'UNKNOWN',
      }),
    });
    expect(isConfidentEnoughToAutoPlay(noMatch)).toBe(false);

    configureSearchSources([
      stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', results: [noMatch] }),
    ]);
    const out = await playByVoiceQuery('metallica');
    expect(out.outcome).toBe('AMBIGUOUS');
    expect(getSearchTelemetrySnapshot().counters.voiceAmbiguousHeld).toBe(1);
    expect(getSearchTelemetrySnapshot().counters.voiceAutoPlayed).toBe(0);
  });

  it('yerel sonuç sesli seçildiğinde F3 oturum yolundan çalar', async () => {
    reconcileMusicIndex([localTrack({ id: 1, title: 'Yol' })]);
    const { calls } = stubDispatch();
    configureSearchSources([createLocalSearchPort()]);

    const out = await playByVoiceQuery('yol');

    expect(out.outcome).toBe('STARTED');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.source).toBe('LOCAL');
    expect(getSearchTelemetrySnapshot().counters.voiceAutoPlayed).toBe(1);
    _setListeningRuntimePortsForTest(null);
  });

  it('sonuç yoksa DÜRÜST başarısızlık döner (uydurma çalma yok)', async () => {
    configureSearchSources([stubPort({ providerId: 'youtube', sourceClass: 'YOUTUBE', results: [] })]);
    expect((await playByVoiceQuery('bulunamayacak')).outcome).toBe('NO_RESULT');
  });

  it('kaynaklara ulaşılamıyorsa "sonuç yok" DENMEZ', async () => {
    configureSearchSources([
      stubPort({ providerId: 'spotify', sourceClass: 'SPOTIFY_CONNECT', available: false }),
    ]);
    expect((await playByVoiceQuery('yol')).outcome).toBe('SOURCES_UNAVAILABLE');
  });

  it('tercih edilen kaynakta sonuç yoksa kanonik sıraya düşülür (davranış korunur)', async () => {
    configureSearchSources([
      stubPort({
        providerId: 'youtube', sourceClass: 'YOUTUBE',
        results: [resultOf({ resultId: 'youtube:only', title: 'Yol' })],
      }),
    ]);
    const out = await playByVoiceQuery('yol', 'spotify');
    expect(out.selected?.resultId).toBe('youtube:only');
  });

  it('sesli hattın bayat sonucu güncel durumu bozmaz', async () => {
    configureSearchSources([
      stubPort({
        providerId: 'youtube', sourceClass: 'YOUTUBE', delayMs: 80,
        results: [resultOf({ resultId: 'youtube:eski' })],
      }),
    ]);
    const first = playByVoiceQuery('eski sorgu');
    await new Promise((r) => setTimeout(r, 5));
    const second = await searchOnce('yeni sorgu');
    await first;
    expect(second.query).toBe('yeni sorgu');
    expect(getSearchTelemetrySnapshot().counters.staleResultDrops).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · ESKİ ARAMA YOLU
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.1 · eski arama yolu', () => {
  const readSource = async (relative: string): Promise<string> => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.join(dir, '..', relative);
    expect(fs.existsSync(file), `${relative} bulunamadı — kilit yeniden bağlanmalı`).toBe(true);
    return fs.readFileSync(file, 'utf8');
  };

  it('playByQuery kanonik koordinatörü çağırır — eski orkestrasyonu DEĞİL', async () => {
    const src = await readSource('platform/media/carosMediaLayer.ts');
    const start = src.indexOf('export async function playByQuery');
    expect(start, 'playByQuery bulunamadı — kilit yeniden bağlanmalı').toBeGreaterThan(-1);
    // Fonksiyonun sonu: bir sonraki üst düzey bildirim/bölüm başlığı.
    const rest = src.slice(start);
    const nextDecl = rest.slice(1).search(/\nexport |\n\/\* /);
    const fn = nextDecl > 0 ? rest.slice(0, nextDecl + 1) : rest;
    expect(fn).toContain('playByVoiceQuery');
    expect(fn).not.toContain('searchMedia(');
  });

  it('hiçbir üretim yolu eski searchMedia\'yı çağırmaz', async () => {
    const files = [
      'platform/media/carosMediaLayer.ts',
      'hooks/useVoiceCommandHandler.ts',
      'platform/commandExecutor.ts',
      'components/media/MediaScreen.tsx',
      'components/media/UnifiedSearchView.tsx',
    ];
    for (const f of files) {
      const src = await readSource(f);
      // Tanımın kendisi hariç: hiçbir yerde ÇAĞRI olmamalı.
      const calls = src
        .split('\n')
        .filter((line) => /\bsearchMedia\s*\(/.test(line))
        // Tanımın kendisi ve dokümantasyon satırları bir ÇAĞRI değildir.
        .filter((line) => !/function\s+searchMedia/.test(line))
        .filter((line) => !/^\s*(\*|\/\/)/.test(line));
      expect(calls, `${f} eski arama yolunu çağırıyor`).toEqual([]);
    }
  });

  it('eski yol çağrılırsa GÖRÜNÜR olur (sessiz kaçak yok)', async () => {
    const { searchMedia } = await import('../platform/media/carosMediaLayer');
    expect(getSearchTelemetrySnapshot().counters.legacySearchCalls).toBe(0);
    await searchMedia('', 'local');
    expect(getSearchTelemetrySnapshot().counters.legacySearchCalls).toBe(1);
  });

  it('sesli hat sağlayıcıya DOĞRUDAN çalma komutu göndermez', async () => {
    const src = await readSource('platform/media/search/voiceSearchIntent.ts');
    ['playSpotifyTrack', 'playYouTube', 'nativePlugin', 'pipedProvider', '_PROVIDER_RANK']
      .forEach((forbidden) => expect(src, forbidden).not.toContain(forbidden));
    expect(src).toContain('selectSearchResult');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · KEŞİF YÜZEYİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.1 · keşif kanıtı', () => {
  const noEvidence = {
    continueListening: null, lastPlayed: null,
    recentlyPlayedTracks: [], favorites: [], playlists: [], drivingMode: 'idle' as const,
  };

  it('kanıt yoksa SAHTE bölüm üretilmez', () => {
    const d = buildDiscovery({ library: getMusicLibrarySnapshot(), ...noEvidence });
    expect(d.sections).toHaveLength(0);
    expect(d.emptyReason).toBeTruthy();
  });

  it('gerçek geçmiş varsa "Son çalınanlar" doğar ve çözülemeyen kayıt GÖSTERİLMEZ', () => {
    reconcileMusicIndex([localTrack({ id: 1, title: 'Yol' })]);
    const library = getMusicLibrarySnapshot();
    const trackId = library.tracks[0]!.id;

    const withHistory = buildDiscovery({
      library, ...noEvidence,
      recentlyPlayedTracks: [{ trackId, title: 'Yol', artist: 'Grup', artworkIdentity: null }],
    });
    const section = withHistory.sections.find((s) => s.id === 'RECENTLY_PLAYED');
    expect(section?.items).toHaveLength(1);
    expect(section?.items[0]!.selection).toEqual({ kind: 'TRACK', trackId });

    // Çözülemeyen kayıt runtime tarafından ELENİR (silinmiş parça uydurulmaz).
    clearRecentlyPlayed();
    rememberPlayed({ libraryTrackId: 'yok-boyle-bir-parca', providerRef: null, providerId: 'local' });
    _resetDiscoveryCacheForTest();
    expect(getDiscovery('idle').sections.find((s) => s.id === 'RECENTLY_PLAYED')).toBeUndefined();
  });

  it('"Son eklenenler" YALNIZ generation kanıtı çoğunluktaysa üretilir', () => {
    // Kanıt yok → bölüm yok.
    reconcileMusicIndex([
      localTrack({ id: 1, title: 'A' }),
      localTrack({ id: 2, uri: 'content://media/external/audio/media/2', title: 'B' }),
    ]);
    expect(buildDiscovery({ library: getMusicLibrarySnapshot(), ...noEvidence })
      .sections.find((s) => s.id === 'RECENTLY_ADDED')).toBeUndefined();

    // Kanıt çoğunlukta → bölüm doğar ve EN YENİ önce gelir.
    reconcileMusicIndex([
      localTrack({ id: 1, title: 'Eski', generationModified: 10 } as Partial<LocalMusicTrack>),
      localTrack({
        id: 2, uri: 'content://media/external/audio/media/2', title: 'Yeni',
        generationModified: 99,
      } as Partial<LocalMusicTrack>),
    ]);
    const section = buildDiscovery({ library: getMusicLibrarySnapshot(), ...noEvidence })
      .sections.find((s) => s.id === 'RECENTLY_ADDED');
    expect(section?.items[0]!.title).toBe('Yeni');
    expect(RECENTLY_ADDED_EVIDENCE_RATIO).toBeGreaterThan(0);
  });

  it('sürmekte olan dinleme bağlamı "Devam et" olarak öne gelir', () => {
    reconcileMusicIndex([localTrack({ id: 1 })]);
    const d = buildDiscovery({
      library: getMusicLibrarySnapshot(), ...noEvidence,
      continueListening: { title: 'Yol', artist: 'Grup', artworkIdentity: null },
    });
    expect(d.sections[0]!.id).toBe('CONTINUE_LISTENING');
    expect(d.sections[0]!.items[0]!.selection).toEqual({ kind: 'RESUME' });
  });

  it('sürüşte bölüm yoğunluğu azalır ve klasör gezintisi kapanır', () => {
    reconcileMusicIndex(Array.from({ length: 30 }, (_, i) => localTrack({
      id: i + 1, uri: `content://media/external/audio/media/${i + 1}`,
      title: `T${i}`, album: `Albüm ${i}`, artist: `Sanatçı ${i}`,
    })));
    const library = getMusicLibrarySnapshot();
    const idle = buildDiscovery({ library, ...noEvidence, drivingMode: 'idle' });
    const driving = buildDiscovery({ library, ...noEvidence, drivingMode: 'driving' });
    expect(driving.sections.some((s) => s.id === 'FOLDERS')).toBe(false);
    const idleAlbums = idle.sections.find((s) => s.id === 'ALBUMS')!.items.length;
    const drivingAlbums = driving.sections.find((s) => s.id === 'ALBUMS')!.items.length;
    expect(drivingAlbums).toBeLessThanOrEqual(idleAlbums);
    expect(drivingAlbums).toBeLessThanOrEqual(8);
  });

  it('hiçbir bölüm başlığı AI/öneri iddiası taşımaz', () => {
    reconcileMusicIndex([localTrack({ id: 1, album: 'A', artist: 'B', generationModified: 5 } as Partial<LocalMusicTrack>)]);
    buildDiscovery({ library: getMusicLibrarySnapshot(), ...noEvidence }).sections.forEach((s) => {
      expect(s.title).not.toMatch(/senin için|öneri|beğenebil|sevebil|keşfet/i);
    });
  });

  it('keşif seçimi KANONİK F3 yolundan çalar', async () => {
    reconcileMusicIndex([localTrack({ id: 1, title: 'Yol', album: 'İlk' })]);
    const { calls } = stubDispatch();
    _resetDiscoveryCacheForTest();
    const albums = getDiscovery('idle').sections.find((s) => s.id === 'ALBUMS');
    expect(albums).toBeDefined();

    const started = await selectDiscoveryItem(albums!.items[0]!);
    expect(started?.started).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.source).toBe('LOCAL');
    _setListeningRuntimePortsForTest(null);
  });

  it('RESUME seçimi keşif katmanından çalma BAŞLATMAZ', async () => {
    const { calls } = stubDispatch();
    const out = await selectDiscoveryItem({
      id: 'r', title: 'x', subtitle: null, artworkIdentity: null,
      selection: { kind: 'RESUME' },
    });
    expect(out).toBeNull();
    expect(calls).toHaveLength(0);
    _setListeningRuntimePortsForTest(null);
  });

  it('keşif projeksiyonu kütüphane değişmedikçe yeniden hesaplanmaz', () => {
    reconcileMusicIndex([localTrack({ id: 1, album: 'A', artist: 'B' })]);
    _resetDiscoveryCacheForTest();
    const first = getDiscovery('idle');
    expect(getDiscovery('idle')).toBe(first);          // aynı referans → önbellek
    expect(getDiscovery('driving')).not.toBe(first);   // sürüş kipi girdidir
  });

  it('keşif telemetrisi bastırılan bölümleri sayar', () => {
    _resetDiscoveryCacheForTest();
    getDiscovery('idle');
    const snap = getSearchTelemetrySnapshot();
    expect(snap.discoverySections).not.toBeNull();
    expect(snap.discoverySuppressedSections).not.toBeNull();
    expect(snap.discoverySuppressedSections!).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · SON ÇALINANLAR PROJEKSİYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.1 · son çalınanlar', () => {
  it('bounded kalır ve aynı öğe iki kez EKLENMEZ', () => {
    for (let i = 0; i < MAX_RECENTLY_PLAYED + 6; i += 1) {
      rememberPlayed({ libraryTrackId: `t${i}`, providerRef: null, providerId: 'local' }, i);
    }
    expect(getRecentlyPlayed().length).toBe(MAX_RECENTLY_PLAYED);

    rememberPlayed({ libraryTrackId: 't5', providerRef: null, providerId: 'local' }, 999);
    const entries = getRecentlyPlayed().filter((e) => e.libraryTrackId === 't5');
    expect(entries).toHaveLength(1);
    expect(getRecentlyPlayed()[0]!.libraryTrackId).toBe('t5');
  });

  it('başlık · sanatçı · URI SAKLANMAZ (yalnız kimlik + kaynak + zaman)', () => {
    rememberPlayed({ libraryTrackId: 'media:vol:1', providerRef: null, providerId: 'local' }, 1);
    const serialized = JSON.stringify(getRecentlyPlayed());
    ['Yol', 'Grup', 'content://', 'İlk'].forEach((leak) => {
      expect(serialized).not.toContain(leak);
    });
    expect(getRecentlyPlayed()[0]).toMatchObject({ providerId: 'local', atMs: 1 });
  });

  it('kimliksiz kayıt kabul edilmez', () => {
    clearRecentlyPlayed();
    rememberPlayed({ libraryTrackId: null, providerRef: null, providerId: 'local' }, 1);
    expect(getRecentlyPlayed()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · AUTHORITY GUARD
 * ════════════════════════════════════════════════════════════════════════ */

describe('F5.1 · authority guard', () => {
  const readSource = async (relative: string): Promise<string> => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.join(dir, '..', relative);
    expect(fs.existsSync(file), `${relative} bulunamadı — kilit yeniden bağlanmalı`).toBe(true);
    return fs.readFileSync(file, 'utf8');
  };

  it('keşif yüzeyi iş mantığı taşımaz ve sağlayıcı/native çağırmaz', async () => {
    const src = await readSource('components/media/MusicDiscoverySurface.tsx');
    ['nativePlugin', 'pipedProvider', 'reconcileMusicIndex', 'mediaCommandGateway',
      'createQueue(', 'playSource(',
    ].forEach((forbidden) => expect(src, forbidden).not.toContain(forbidden));
    expect(src).toContain('discoveryRuntime');
  });

  it('keşif çalma otoritesi ÜRETMEZ — seçim F3 yolundan gider', async () => {
    const src = await readSource('platform/media/search/discoveryRuntime.ts');
    expect(src).toContain('startLibraryListening');
    ['mediaCommandGateway', 'nativeAuthorityBridge', 'playMedia(']
      .forEach((forbidden) => expect(src, forbidden).not.toContain(forbidden));
  });

  it('ikinci bir arama koordinatörü YOKTUR', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const searchDir = path.join(dir, '..', 'platform', 'media', 'search');
    expect(fs.existsSync(searchDir)).toBe(true);
    const files = fs.readdirSync(searchDir).filter((f) => f.endsWith('.ts'));
    // Orkestrasyonun sahibi TEK dosyadır: runSearch yalnız orada tanımlanır.
    const definers = files.filter((f) => {
      const src = fs.readFileSync(path.join(searchDir, f), 'utf8');
      return /export\s+(async\s+)?function\s+(runSearch|searchOnce)\b/.test(src);
    });
    expect(definers).toEqual(['musicSearchCoordinator.ts']);
  });

  it('sesli hat kendi normalizasyonunu/sıralamasını ÜRETMEZ', async () => {
    const src = await readSource('platform/media/search/voiceSearchIntent.ts');
    ['toLowerCase(', 'normalize(\'NFD\'', 'function scoreResult', 'function rankResults']
      .forEach((forbidden) => expect(src, forbidden).not.toContain(forbidden));
  });
});
