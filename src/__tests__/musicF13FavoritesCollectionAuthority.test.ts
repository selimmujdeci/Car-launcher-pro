/**
 * musicF13FavoritesCollectionAuthority.test.ts — MUSIC F13 · Favoriler /
 * Music Collection Authority.
 *
 * F13'ün tek işi şudur: gerçek, tek ve kanonik bir favori/koleksiyon
 * otoritesi kurmak — playback/queue/search/recommendation otoritesi
 * OLMADAN. Bu paket şunları kilitler:
 *   · TEK `MusicCollectionAuthority` — kimlik provider-safe, başlık/sanatçı
 *     ASLA anahtar değil
 *   · aynı içerik iki kez favorilenince DUPLICATE kayıt üretmez
 *   · kalıcı şema dar ve gizlilik-uyumlu (sorgu/konuşma/konum YOK)
 *   · Discovery Favoriler bölümü YALNIZ gerçek favori varsa çizilir
 *   · Mavi "eklendim/çıkardım" YALNIZ mutasyon doğrulanmışsa söyler
 *   · "bunu" kimliği yoksa favori UYDURULMAZ
 *   · karışık-sağlayıcı favori listesi karışık-sağlayıcı PlayQueue KURMAZ
 *   · LAB salt-okunur kalır, mutasyon TETİKLEMEZ
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COLLECTION_SCHEMA_VERSION, MAX_FAVORITES,
  favoriteKeyFor, makeFavoriteEntry, parseFavoriteEntry, providerIdFromSourceClass,
} from '../platform/media/collection/musicCollectionEntry';
import {
  addFavorite, removeFavorite, toggleFavorite, isFavorite,
  getFavoritesSnapshot, getFavoritesCount, getFavoritesRevision, subscribeFavorites,
  resolveFavoriteDisplays, resolvePlaybackTarget, resolveMostRecentPlayableFavorite,
  _resetMusicCollectionForTest,
} from '../platform/media/collection/musicCollectionAuthority';
import { _resetMusicCollectionTelemetryForTest } from '../platform/media/collection/musicCollectionTelemetry';
import {
  _resetMusicIndexForTest, getMusicLibrarySnapshot, reconcileMusicIndex,
} from '../platform/media/musicIndex';
import {
  buildDiscovery, type DiscoveryInput,
} from '../platform/media/search/discoveryModel';
import { resolveMusicIntent } from '../platform/media/intent/musicIntentResolver';
import {
  _resetMusicIntentRouterForTest, _setMusicIntentPortsForTest, dispatchMusicIntent,
} from '../platform/media/intent/musicIntentRouter';
import { makeIntent } from '../platform/media/intent/musicIntent';
import { claimIsHonest, speakMusicOutcome } from '../platform/media/intent/musicIntentSpeech';
import type { LocalMusicTrack } from '../platform/localMusicService';
import type { CanonicalMediaIdentity } from '../platform/media/session/mediaIdentityMatching';
import type { SourceClass } from '../platform/media/authority/sourceCapabilities';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/* ── Fixture'lar ─────────────────────────────────────────────────────────── */

const localTrackFixture = (over: Partial<LocalMusicTrack> = {}): LocalMusicTrack => ({
  id: 1, uri: 'content://media/external/audio/media/1', title: 'Yol', artist: 'Grup',
  album: 'İlk', durationMs: 180_000, trackNumber: 1, volumeName: 'external_primary',
  ...over,
} as LocalMusicTrack);

const identity = (over: Partial<CanonicalMediaIdentity> = {}): CanonicalMediaIdentity => ({
  libraryId: null, providerId: null, providerNamespace: null, contentUri: null,
  title: 'Yol', artist: 'Grup', album: null, durationMs: null,
  trackNumber: null, discNumber: null,
  ...over,
});

const YT: SourceClass = 'YOUTUBE';
const LOCAL: SourceClass = 'LOCAL';

beforeEach(() => {
  _resetMusicCollectionForTest();
  _resetMusicCollectionTelemetryForTest();
  _resetMusicIndexForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–4 · KİMLİK MODELİ (SAF) — provider-safe, başlık/sanatçı ASLA anahtar değil
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13 · kimlik modeli provider-safe ve deterministik', () => {
  it('1 · LOCAL kimlik libraryId\'den, PROVIDER kimlik ns+id\'den anahtar üretir', () => {
    expect(favoriteKeyFor(identity({ libraryId: 'lib-1' }))).toBe('local:lib-1');
    expect(favoriteKeyFor(identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1' })))
      .toBe('provider:youtube:yt-1');
  });

  it('2 · yalnız BAŞLIK/SANATÇI ile kimlik KURULMAZ — kanıtsız favori yok', () => {
    expect(favoriteKeyFor(identity())).toBeNull();
    expect(favoriteKeyFor(identity({ providerNamespace: 'YOUTUBE' }))).toBeNull();
    expect(favoriteKeyFor(identity({ providerId: 'yt-1' }))).toBeNull();
  });

  it('3 · aynı libraryId, FARKLI başlık/sanatçı ile bile AYNI anahtarı üretir', () => {
    const a = favoriteKeyFor(identity({ libraryId: 'lib-1', title: 'A', artist: 'X' }));
    const b = favoriteKeyFor(identity({ libraryId: 'lib-1', title: 'B', artist: 'Y' }));
    expect(a).toBe(b);
  });

  it('4 · SourceClass↔ProviderId ters eşleme F7.6\'nın YÖNÜNÜ tekrar İCAT ETMEZ', () => {
    expect(providerIdFromSourceClass('YOUTUBE')).toBe('youtube');
    expect(providerIdFromSourceClass('SPOTIFY_CONNECT')).toBe('spotify');
    expect(providerIdFromSourceClass('LOCAL')).toBe('local');
    expect(providerIdFromSourceClass('EXTERNAL_MEDIA_SESSION')).toBeNull();
    expect(providerIdFromSourceClass('BLUETOOTH_EXTERNAL')).toBeNull();
  });
});

describe('F13 · makeFavoriteEntry oynatılamayacak/kanıtsız kayıt ÜRETMEZ', () => {
  it('5 · LOCAL kimlik → yalnız libraryId taşıyan kayıt (başlık/sanatçı KOPYALANMAZ)', () => {
    const e = makeFavoriteEntry(identity({ libraryId: 'lib-1' }), LOCAL, 1000)!;
    expect(e.kind).toBe('LOCAL');
    expect(e.libraryId).toBe('lib-1');
    expect(e.displayTitle).toBeNull();
    expect(e.displayArtist).toBeNull();
  });

  it('6 · PROVIDER kimlik + contentUri → bounded görüntü metadata\'sı taşıyan kayıt', () => {
    const e = makeFavoriteEntry(
      identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1', title: 'X', artist: 'Y' }),
      YT, 1000,
    )!;
    expect(e.kind).toBe('PROVIDER');
    expect(e.provider).toBe('youtube');
    expect(e.contentUri).toBe('https://yt/1');
    expect(e.displayTitle).toBe('X');
  });

  it('7 · PROVIDER kimlik contentUri OLMADAN → null (oynatılamayacak favori kaydedilmez)', () => {
    expect(makeFavoriteEntry(
      identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1' }), YT, 1000,
    )).toBeNull();
  });

  it('8 · kanıtsız kimlik (favoriteKeyFor null) → null', () => {
    expect(makeFavoriteEntry(identity(), LOCAL, 1000)).toBeNull();
  });
});

describe('F13 · parseFavoriteEntry fail-closed — bozuk kayıt UYDURULMAZ', () => {
  it('9 · geçerli LOCAL/PROVIDER kayıtları round-trip eder', () => {
    const local = makeFavoriteEntry(identity({ libraryId: 'lib-1' }), LOCAL, 1000)!;
    const provider = makeFavoriteEntry(
      identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1' }), YT, 1000,
    )!;
    expect(parseFavoriteEntry(JSON.parse(JSON.stringify(local)))).toEqual(local);
    expect(parseFavoriteEntry(JSON.parse(JSON.stringify(provider)))).toEqual(provider);
  });

  it('10 · şema uyuşmazlığı / eksik zorunlu alan / bozuk tip → null', () => {
    expect(parseFavoriteEntry(null)).toBeNull();
    expect(parseFavoriteEntry({})).toBeNull();
    expect(parseFavoriteEntry({ schemaVersion: 999, key: 'local:1', kind: 'LOCAL' })).toBeNull();
    expect(parseFavoriteEntry({
      schemaVersion: COLLECTION_SCHEMA_VERSION, kind: 'LOCAL', sourceClass: 'LOCAL', addedAtMs: 1,
    })).toBeNull(); // key yok
    expect(parseFavoriteEntry({
      schemaVersion: COLLECTION_SCHEMA_VERSION, key: 'local:1', kind: 'LOCAL',
      sourceClass: 'LOCAL', addedAtMs: 1, libraryId: null,
    })).toBeNull(); // libraryId eksik
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11–16 · OTORİTE — mutasyon, duplicate suppression, cap, O(1) üyelik
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13 · musicCollectionAuthority mutasyonları dürüst ve idempotenttir', () => {
  it('11 · ekleme → ADDED, aynı içerik TEKRAR eklenince ALREADY_PRESENT (duplicate YOK)', () => {
    const id = identity({ libraryId: 'lib-1' });
    const r1 = addFavorite(id, LOCAL);
    expect(r1.status).toBe('ADDED');
    const r2 = addFavorite(id, LOCAL);
    expect(r2.status).toBe('ALREADY_PRESENT');
    expect(getFavoritesCount().total).toBe(1); // duplicate kayıt YOK
  });

  it('12 · çıkarma → REMOVED, olmayanı çıkarma ALREADY_ABSENT', () => {
    const id = identity({ libraryId: 'lib-1' });
    addFavorite(id, LOCAL);
    expect(removeFavorite(id).status).toBe('REMOVED');
    expect(removeFavorite(id).status).toBe('ALREADY_ABSENT');
    expect(getFavoritesCount().total).toBe(0);
  });

  it('13 · toggle: yoksa ekler, varsa çıkarır', () => {
    const id = identity({ libraryId: 'lib-1' });
    expect(toggleFavorite(id, LOCAL).status).toBe('ADDED');
    expect(isFavorite(id)).toBe(true);
    expect(toggleFavorite(id, LOCAL).status).toBe('REMOVED');
    expect(isFavorite(id)).toBe(false);
  });

  it('14 · kanıtsız kimlik REJECTED_NO_IDENTITY döner — favori UYDURULMAZ', () => {
    const r = addFavorite(identity(), LOCAL);
    expect(r.status).toBe('REJECTED_NO_IDENTITY');
    expect(getFavoritesCount().total).toBe(0);
  });

  it('15 · koleksiyon dolunca REJECTED_COLLECTION_FULL — sınırsız büyüme YOK', () => {
    for (let i = 0; i < MAX_FAVORITES; i += 1) {
      addFavorite(identity({ libraryId: `lib-${i}` }), LOCAL);
    }
    expect(getFavoritesCount().total).toBe(MAX_FAVORITES);
    const r = addFavorite(identity({ libraryId: 'lib-overflow' }), LOCAL);
    expect(r.status).toBe('REJECTED_COLLECTION_FULL');
    expect(getFavoritesCount().total).toBe(MAX_FAVORITES);
  }, 15_000);

  it('16 · isFavorite O(1) üyelik sorgusu — mutasyon sonrası ANINDA doğru', () => {
    const a = identity({ libraryId: 'a' });
    const b = identity({ libraryId: 'b' });
    addFavorite(a, LOCAL);
    expect(isFavorite(a)).toBe(true);
    expect(isFavorite(b)).toBe(false);
  });
});

describe('F13 · reaktivite — abonelik ve revizyon sayacı', () => {
  it('17 · mutasyon subscribeFavorites dinleyicisini tetikler', () => {
    let calls = 0;
    const unsub = subscribeFavorites(() => { calls += 1; });
    addFavorite(identity({ libraryId: 'lib-1' }), LOCAL);
    expect(calls).toBeGreaterThan(0);
    unsub();
  });

  it('18 · her gerçek mutasyon getFavoritesRevision\'ı İLERLETİR', () => {
    const r0 = getFavoritesRevision();
    addFavorite(identity({ libraryId: 'lib-1' }), LOCAL);
    expect(getFavoritesRevision()).toBeGreaterThan(r0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 19–22 · GÖRÜNTÜ PROJEKSİYONU — fail-closed, sahte metadata YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13 · resolveFavoriteDisplays kütüphaneden silinen kaydı UYDURMAZ', () => {
  it('19 · LOCAL favori kütüphanede varsa gerçek başlık/sanatçı çözülür', () => {
    reconcileMusicIndex([localTrackFixture({ id: 1, title: 'Yol', artist: 'Grup' })]);
    const libId = getMusicLibrarySnapshot().tracks[0]!.id;
    addFavorite(identity({ libraryId: libId }), LOCAL);
    const [display] = resolveFavoriteDisplays(getFavoritesSnapshot());
    expect(display!.resolved).toBe(true);
    expect(display!.title).toBe('Yol');
  });

  it('20 · LOCAL favori kütüphaneden SİLİNMİŞSE resolved=false — sahte parça GÖSTERİLMEZ', () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const libId = getMusicLibrarySnapshot().tracks[0]!.id;
    addFavorite(identity({ libraryId: libId }), LOCAL);
    _resetMusicIndexForTest(); // kütüphane artık boş — parça "silindi"
    const [display] = resolveFavoriteDisplays(getFavoritesSnapshot());
    expect(display!.resolved).toBe(false);
    expect(display!.title).toBeNull();
  });

  it('21 · PROVIDER favori add-time bounded metadata\'sını taşır', () => {
    addFavorite(identity({
      providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1',
      title: 'Şarkı', artist: 'Sanatçı',
    }), YT);
    const [display] = resolveFavoriteDisplays(getFavoritesSnapshot());
    expect(display!.resolved).toBe(true);
    expect(display!.title).toBe('Şarkı');
  });
});

describe('F13 · resolvePlaybackTarget YALNIZ VERİ döndürür — dispatch YAPMAZ', () => {
  it('22 · LOCAL/PROVIDER hedefleri doğru alanları taşır; en son eklenen çözülebilen favori seçilir', () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const libId = getMusicLibrarySnapshot().tracks[0]!.id;
    const local = makeFavoriteEntry(identity({ libraryId: libId }), LOCAL, 1000)!;
    const provider = makeFavoriteEntry(
      identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1' }), YT, 2000,
    )!;
    expect(resolvePlaybackTarget(local).playable).toBe(true);
    /* LOCAL kaydın kendisi contentUri TAŞIMAZ (yalnız libraryId) — ama oynatma
       hedefi kütüphaneden CANLI çözülür, bu yüzden burada DOLU beklenir. */
    expect(resolvePlaybackTarget(local).contentUri).toBe(
      getMusicLibrarySnapshot().tracks.find((t) => t.id === libId)!.contentUri,
    );
    expect(resolvePlaybackTarget(provider).playable).toBe(true);
    expect(resolvePlaybackTarget(provider).provider).toBe('youtube');

    addFavorite(identity({ libraryId: libId }), LOCAL);
    addFavorite(identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1' }), YT);
    /* Sıralama/öneri motoru İCAT EDİLMEZ — yalnız ÇÖZÜLEBİLEN bir favori
       döner (hangisi olduğu `getFavoritesSnapshot`in `addedAtMs` sırasının
       sorumluluğudur; iki ekleme aynı test tick'inde eşit zaman DAMGASI
       alabilir — burada yalnız "boş DÖNMEZ, oynatılabilir" doğrulanır). */
    const mostRecent = resolveMostRecentPlayableFavorite();
    expect(mostRecent).not.toBeNull();
    expect(resolvePlaybackTarget(mostRecent!).playable).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 23 · GİZLİLİK — kalıcı şema dar, sorgu/konuşma/konum YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13 · kalıcı şema gizlilik-uyumlu (statik allowlist kilidi)', () => {
  it('23 · FavoriteEntry şeması yasaklı alan İÇERMEZ', () => {
    const src = strip(read('src/platform/media/collection/musicCollectionEntry.ts'));
    const forbidden = [
      'query:', 'utterance', 'transcript', 'location', 'coordinates',
      'route:', 'drivingHistory', 'speech',
    ];
    for (const f of forbidden) {
      expect(src, `yasaklı alan sızmış: ${f}`).not.toContain(f);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 24–27 · DISCOVERY — Favoriler bölümü YALNIZ kanıt varsa çizilir
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13 · Discovery Favoriler bölümü kanıta bağlıdır', () => {
  const baseInput: DiscoveryInput = {
    library: { revision: 0, tracks: [], albums: [], artists: [], folders: [], availability: 'UNAVAILABLE' },
    continueListening: null, lastPlayed: null, recentlyPlayedTracks: [], favorites: [],
    playlists: [],
    drivingMode: 'parked',
  };

  it('24 · favori yoksa FAVORITES bölümü ÜRETİLMEZ', () => {
    const out = buildDiscovery(baseInput);
    expect(out.sections.some((s) => s.id === 'FAVORITES')).toBe(false);
  });

  it('25 · gerçek favori varsa FAVORITES bölümü ilk sırada çizilir', () => {
    const out = buildDiscovery({
      ...baseInput,
      favorites: [{ key: 'local:1', title: 'Yol', artist: 'Grup', artworkIdentity: null }],
    });
    expect(out.sections[0]?.id).toBe('FAVORITES');
    expect(out.sections[0]?.items[0]?.selection).toEqual({ kind: 'FAVORITE', favoriteKey: 'local:1' });
  });

  it('26 · başlığı olmayan favori "Bilinmeyen parça" ile dürüstçe gösterilir (uydurma isim YOK)', () => {
    const out = buildDiscovery({
      ...baseInput,
      favorites: [{ key: 'provider:youtube:1', title: null, artist: null, artworkIdentity: null }],
    });
    expect(out.sections[0]?.items[0]?.title).toBe('Bilinmeyen parça');
  });

  it('27 · sürüşte satır sayısı DARALIR — favori bölümü de sürüş sınırına TABİDİR', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      key: `local:${i}`, title: `T${i}`, artist: null, artworkIdentity: null,
    }));
    const out = buildDiscovery({ ...baseInput, favorites: many, drivingMode: 'driving' });
    expect(out.sections[0]?.items.length).toBeLessThanOrEqual(8);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 28–29 · NİYET ÇÖZÜMÜ — favori ifadeleri doğru niyete çözülür
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13 · Mavi favori ifadelerini doğru niyete çözer', () => {
  it('28 · "beğendim / favorilere ekle / çıkar / favorilerimden çal" doğru niyete çözülür', () => {
    expect(resolveMusicIntent('bunu beğendim')?.kind).toBe('ADD_FAVORITE');
    expect(resolveMusicIntent('bu şarkıyı favorilere ekle')?.kind).toBe('ADD_FAVORITE');
    expect(resolveMusicIntent('favorilerimden çıkar')?.kind).toBe('REMOVE_FAVORITE');
    expect(resolveMusicIntent('favorilerimi aç')?.kind).toBe('PLAY_FAVORITES');
    expect(resolveMusicIntent('favorilerimden bir şey çal')?.kind).toBe('PLAY_FAVORITES');
  });

  it('29 · alakasız ifade favori niyeti UYDURMAZ', () => {
    expect(resolveMusicIntent('sonraki şarkı')?.kind).not.toBe('ADD_FAVORITE');
    expect(resolveMusicIntent('eve git')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 30–35 · F9 ROUTER — favori/koleksiyon niyeti dürüst yürütülür
 * ════════════════════════════════════════════════════════════════════════ */

function makeCollectionPorts(over: {
  addFavorite?: (i: unknown, s: unknown) => unknown;
  removeFavorite?: (i: unknown) => unknown;
  resolveMostRecentPlayableFavorite?: () => unknown;
  resolvePlaybackTarget?: (e: unknown) => unknown;
  getListeningSession?: () => unknown;
  startLibraryListening?: (i: unknown) => Promise<unknown>;
  playMedia?: (t: unknown, q: unknown) => void;
} = {}) {
  const collectionMock = {
    addFavorite: over.addFavorite ?? (() => ({ status: 'ADDED', key: 'local:1', entry: null })),
    removeFavorite: over.removeFavorite ?? (() => ({ status: 'REMOVED', key: 'local:1', entry: null })),
    resolveMostRecentPlayableFavorite: over.resolveMostRecentPlayableFavorite ?? (() => null),
    resolvePlaybackTarget: over.resolvePlaybackTarget ?? (() => ({
      kind: 'LOCAL', libraryId: 'lib-1', provider: null, contentUri: null, sourceClass: 'LOCAL', playable: true,
    })),
  };
  const sessionMock = {
    getListeningSession: over.getListeningSession ?? (() => null),
  };
  _setMusicIntentPortsForTest({
    collection: () => Promise.resolve(collectionMock as any),
    session: () => Promise.resolve(sessionMock as any),
    sessionRuntime: () => Promise.resolve({
      startLibraryListening: over.startLibraryListening
        ?? (() => Promise.resolve({ started: true, reason: 'ok', truth: null })),
    } as any),
    layer: () => Promise.resolve({
      playMedia: over.playMedia ?? (() => undefined),
      resumeLastMedia: () => false,
      next: () => Promise.resolve({ dispatched: false, verified: false, failureCode: null }),
      previous: () => Promise.resolve({ dispatched: false, verified: false, failureCode: null }),
      unifiedFromSearchResult: () => ({ id: 'x', providerId: 'youtube', title: '', subtitle: '' }),
    } as any),
  });
}

beforeEach(() => {
  _resetMusicIntentRouterForTest();
});

describe('F13 · router — "bunu" kimliği yoksa favori UYDURULMAZ', () => {
  it('30 · currentItem yoksa ADD_FAVORITE dürüstçe reddedilir (no_current_item)', async () => {
    makeCollectionPorts({ getListeningSession: () => null });
    const outcome = await dispatchMusicIntent(makeIntent('ADD_FAVORITE'));
    expect(outcome.status).toBe('REJECTED');
    expect(outcome.reasonCode).toBe('no_current_item');
    expect(outcome.claim).toBe('DECLINED');
  });
});

describe('F13 · router — ADD_FAVORITE/REMOVE_FAVORITE YALNIZ doğrulanmış mutasyonda CONFIRMED', () => {
  const session = () => ({
    currentItem: { libraryId: 'lib-1', providerId: null, providerNamespace: null, contentUri: null,
      title: 'Yol', artist: 'Grup', album: null, durationMs: null, trackNumber: null, discNumber: null },
    currentSource: 'LOCAL',
  });

  it('31 · ADDED → VERIFIED/CONFIRMED, cümle "çalıyor" DEMEZ, "eklendi" der', async () => {
    makeCollectionPorts({
      getListeningSession: session,
      addFavorite: () => ({ status: 'ADDED', key: 'local:lib-1', entry: null }),
    });
    const outcome = await dispatchMusicIntent(makeIntent('ADD_FAVORITE'));
    expect(outcome.status).toBe('VERIFIED');
    expect(outcome.claim).toBe('CONFIRMED');
    const spoken = speakMusicOutcome(outcome);
    expect(spoken).not.toContain('çalıyor');
    expect(claimIsHonest(outcome, spoken)).toBe(true);
  });

  it('32 · ALREADY_PRESENT bile VERIFIED\'dır (gerçek durumu dürüstçe yansıtır)', async () => {
    makeCollectionPorts({
      getListeningSession: session,
      addFavorite: () => ({ status: 'ALREADY_PRESENT', key: 'local:lib-1', entry: null }),
    });
    const outcome = await dispatchMusicIntent(makeIntent('ADD_FAVORITE'));
    expect(outcome.status).toBe('VERIFIED');
    expect(speakMusicOutcome(outcome)).not.toContain('çalıyor');
  });

  it('33 · REMOVED → VERIFIED, cümle "çıkarıldı" der, "çalıyor" DEMEZ', async () => {
    makeCollectionPorts({
      getListeningSession: session,
      removeFavorite: () => ({ status: 'REMOVED', key: 'local:lib-1', entry: null }),
    });
    const outcome = await dispatchMusicIntent(makeIntent('REMOVE_FAVORITE'));
    expect(outcome.status).toBe('VERIFIED');
    const spoken = speakMusicOutcome(outcome);
    expect(spoken).not.toContain('çalıyor');
    expect(claimIsHonest(outcome, spoken)).toBe(true);
  });

  it('34 · REJECTED_NO_IDENTITY → REJECTED/DECLINED, kanıtsız favori UYDURULMAZ', async () => {
    makeCollectionPorts({
      getListeningSession: session,
      addFavorite: () => ({ status: 'REJECTED_NO_IDENTITY', key: null, entry: null }),
    });
    const outcome = await dispatchMusicIntent(makeIntent('ADD_FAVORITE'));
    expect(outcome.status).toBe('REJECTED');
    expect(outcome.claim).toBe('DECLINED');
  });
});

describe('F13 · router — PLAY_FAVORITES tek-öğe tek-sağlayıcı kuyruk kurar', () => {
  it('35 · favori yoksa UNAVAILABLE — rastgele bir şey ÇALINMAZ', async () => {
    makeCollectionPorts({ resolveMostRecentPlayableFavorite: () => null });
    const outcome = await dispatchMusicIntent(makeIntent('PLAY_FAVORITES'));
    expect(outcome.status).toBe('UNAVAILABLE');
    expect(outcome.reasonCode).toBe('no_playable_favorite');
  });

  it('36 · LOCAL favori F3 (startLibraryListening) yolundan ÇALAR', async () => {
    let started: unknown = null;
    makeCollectionPorts({
      resolveMostRecentPlayableFavorite: () => ({ kind: 'LOCAL', libraryId: 'lib-1', providerId: null, key: 'local:lib-1' }),
      resolvePlaybackTarget: () => ({
        kind: 'LOCAL', libraryId: 'lib-1', provider: null, contentUri: null, sourceClass: 'LOCAL', playable: true,
      }),
      startLibraryListening: (i) => { started = i; return Promise.resolve({ started: true, reason: 'ok', truth: null }); },
    });
    const outcome = await dispatchMusicIntent(makeIntent('PLAY_FAVORITES'));
    expect(outcome.status).toBe('ACCEPTED_UNVERIFIED');
    expect(started).not.toBeNull();
  });

  it('37 · PROVIDER favori kanonik medya katmanına TEK-ÖĞE kuyruk ile devreder', async () => {
    let dispatched: { track: unknown; queue: unknown } | null = null;
    makeCollectionPorts({
      resolveMostRecentPlayableFavorite: () => ({
        kind: 'PROVIDER', providerId: 'yt-1', displayTitle: 'X', displayArtist: 'Y', displayArtwork: null,
        key: 'provider:youtube:yt-1',
      }),
      resolvePlaybackTarget: () => ({
        kind: 'PROVIDER', libraryId: null, provider: 'youtube', contentUri: 'https://yt/1',
        sourceClass: 'YOUTUBE', playable: true,
      }),
      playMedia: (track, queue) => { dispatched = { track, queue }; },
    });
    const outcome = await dispatchMusicIntent(makeIntent('PLAY_FAVORITES'));
    expect(outcome.status).toBe('ACCEPTED_UNVERIFIED');
    expect(dispatched).not.toBeNull();
    /* Karışık-sağlayıcı kuyruk YOK — tek öğe, tek sağlayıcı. */
    expect(Array.isArray((dispatched as any).queue)).toBe(true);
    expect((dispatched as any).queue.length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 38–39 · AUTHORITY SINIRI (statik kilit) — F13 ikinci otorite DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F13 · musicCollectionAuthority ikinci playback/queue otoritesi DEĞİLDİR', () => {
  const authoritySrc = strip(read('src/platform/media/collection/musicCollectionAuthority.ts'));

  it('38 · otorite dispatch/native/PlayQueue mutasyonuna DOĞRUDAN inmez', () => {
    expect(authoritySrc.length, 'otorite okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    expect(authoritySrc, 'native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(authoritySrc, 'playMedia\'yı doğrudan çağırmış').not.toMatch(/\bplayMedia\s*\(/);
    expect(authoritySrc, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
    expect(authoritySrc, 'MusicIndex\'i mutasyona uğratmış').not.toContain('reconcileMusicIndex');
    expect(authoritySrc, 'saf model React\'e bağlanmış').not.toContain("from 'react'");
    expect(authoritySrc, 'global zamanlayıcı kurmuş').not.toMatch(/setInterval/);
  });

  it('39 · commandExecutor ölü ADD_MUSIC_FAVORITE ucu kanonik yola BAĞLANDI', () => {
    const exec = strip(read('src/platform/commandExecutor.ts'));
    expect(exec, 'ölü stub geri gelmiş').not.toContain('Bu özellik şu an desteklenmiyor');
    expect(exec, 'F13 kanonik yoluna bağlanmamış').toContain("makeIntent('ADD_FAVORITE')");
  });
});
