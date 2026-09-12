/**
 * musicF15PlaylistCollectionAuthority.test.ts — MUSIC F15 · Playlist /
 * Collection Authority.
 *
 * F15'in tek işi şudur: gerçek, tek ve kanonik bir playlist otoritesi kurmak
 * — F13 favorilerinden AYRI, F3/F7.6 playback/queue otoritelerini ELE
 * GEÇİRMEDEN. Bu paket şunları kilitler:
 *   · TEK `musicPlaylistAuthority` — CRUD, öğe ekle/çıkar/sırala
 *   · aynı içerik aynı playlist'e iki kez eklenince DUPLICATE üretmez
 *   · kalıcı şema dar ve gizlilik-uyumlu
 *   · karma-sağlayıcı playlist ≠ karma-sağlayıcı PlayQueue (F7.6 korunur)
 *   · Discovery Playlist'ler bölümü YALNIZ gerçek playlist varsa çizilir
 *   · Mavi "oluşturdum/ekledim/çıkardım" YALNIZ mutasyon doğrulanmışsa söyler
 *   · belirsiz playlist adı YANLIŞ listeyi seçmez — AMBIGUOUS döner
 *   · LAB salt-okunur kalır, mutasyon TETİKLEMEZ
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PLAYLIST_SCHEMA_VERSION, MAX_PLAYLISTS, MAX_ITEMS_PER_PLAYLIST,
  playlistItemKeyFor, makePlaylistItemEntry, parsePlaylist, sanitizePlaylistName,
} from '../platform/media/playlist/musicPlaylistEntry';
import {
  createPlaylist, deletePlaylist, renamePlaylist,
  addItemToPlaylist, removeItemFromPlaylist, moveItemInPlaylist,
  getPlaylists, getPlaylist, getPlaylistsCount, getPlaylistsRevision, subscribePlaylists,
  findPlaylistsByName, resolvePlaylistItemDisplays, resolvePlaylistStartPlan,
  _resetMusicPlaylistAuthorityForTest,
} from '../platform/media/playlist/musicPlaylistAuthority';
import { _resetMusicPlaylistTelemetryForTest } from '../platform/media/playlist/musicPlaylistTelemetry';
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
  _resetMusicPlaylistAuthorityForTest();
  _resetMusicPlaylistTelemetryForTest();
  _resetMusicIndexForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–5 · KİMLİK MODELİ (SAF) — F13 ile AYNI ilke, AYRI depo
 * ════════════════════════════════════════════════════════════════════════ */

describe('F15 · kimlik modeli F13 ile AYNI ilkeyi izler (yeniden İCAT EDİLMEZ)', () => {
  it('1 · playlistItemKeyFor F13 favoriteKeyFor ile AYNI fonksiyondur', () => {
    expect(playlistItemKeyFor(identity({ libraryId: 'lib-1' }))).toBe('local:lib-1');
    expect(playlistItemKeyFor(identity())).toBeNull();
  });

  it('2 · sanitizePlaylistName boş/uzun adı dürüstçe REDDEDER/KIRPAR', () => {
    expect(sanitizePlaylistName('  ')).toBeNull();
    expect(sanitizePlaylistName('Yol   Müzikleri')).toBe('Yol Müzikleri');
    expect(sanitizePlaylistName('a'.repeat(200))!.length).toBeLessThanOrEqual(80);
  });

  it('3 · makePlaylistItemEntry LOCAL yalnız libraryId taşır, PROVIDER contentUri gerektirir', () => {
    const local = makePlaylistItemEntry(identity({ libraryId: 'lib-1' }), LOCAL, 1000)!;
    expect(local.kind).toBe('LOCAL');
    expect(local.displayTitle).toBeNull();
    const provider = makePlaylistItemEntry(
      identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1' }), YT, 1000,
    )!;
    expect(provider.kind).toBe('PROVIDER');
    expect(makePlaylistItemEntry(
      identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1' }), YT, 1000,
    )).toBeNull(); // contentUri yok → oynatılamayacak öğe KAYDEDİLMEZ
  });

  it('4 · parsePlaylist fail-closed — bozuk kayıt UYDURULMAZ, geçerli round-trip eder', () => {
    expect(parsePlaylist(null)).toBeNull();
    expect(parsePlaylist({ schemaVersion: 999 })).toBeNull();
    const item = makePlaylistItemEntry(identity({ libraryId: 'lib-1' }), LOCAL, 1000)!;
    const pl = {
      schemaVersion: PLAYLIST_SCHEMA_VERSION, id: 'pl-1', name: 'Yol Müzikleri',
      items: [item], createdAtMs: 1000, updatedAtMs: 1000,
    };
    const parsed = parsePlaylist(JSON.parse(JSON.stringify(pl)));
    expect(parsed?.name).toBe('Yol Müzikleri');
    expect(parsed?.items.length).toBe(1);
  });

  it('5 · parsePlaylist bozuk TEK öğeyi atlar, playlist\'in geri kalanını KORUR', () => {
    const item = makePlaylistItemEntry(identity({ libraryId: 'lib-1' }), LOCAL, 1000)!;
    const pl = {
      schemaVersion: PLAYLIST_SCHEMA_VERSION, id: 'pl-1', name: 'Karma',
      items: [item, { kind: 'LOCAL' }], // ikinci öğe bozuk (libraryId yok)
      createdAtMs: 1000, updatedAtMs: 1000,
    };
    let rejected = 0;
    const parsed = parsePlaylist(pl, () => { rejected += 1; });
    expect(parsed?.items.length).toBe(1);
    expect(rejected).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6–13 · OTORİTE — CRUD, duplicate suppression, sınır, sıralama
 * ════════════════════════════════════════════════════════════════════════ */

describe('F15 · musicPlaylistAuthority CRUD dürüst ve idempotenttir', () => {
  it('6 · oluşturma → CREATED, boş isim REJECTED_NAME_EMPTY', () => {
    const r1 = createPlaylist('Yol Müzikleri');
    expect(r1.status).toBe('CREATED');
    expect(getPlaylistsCount().total).toBe(1);
    expect(createPlaylist('   ').status).toBe('REJECTED_NAME_EMPTY');
  });

  it('7 · silme → DELETED, olmayanı silme REJECTED_NOT_FOUND', () => {
    const r = createPlaylist('X');
    expect(deletePlaylist(r.playlistId!).status).toBe('DELETED');
    expect(deletePlaylist('yok-boyle-bir-id').status).toBe('REJECTED_NOT_FOUND');
    expect(getPlaylistsCount().total).toBe(0);
  });

  it('8 · yeniden adlandırma → RENAMED', () => {
    const r = createPlaylist('Eski Ad');
    expect(renamePlaylist(r.playlistId!, 'Yeni Ad').status).toBe('RENAMED');
    expect(getPlaylist(r.playlistId!)?.name).toBe('Yeni Ad');
  });

  it('9 · öğe ekleme → ITEM_ADDED, AYNI içerik TEKRAR eklenince ITEM_ALREADY_PRESENT (duplicate YOK)', () => {
    const r = createPlaylist('Yol Müzikleri');
    const id = identity({ libraryId: 'lib-1' });
    expect(addItemToPlaylist(r.playlistId!, id, LOCAL).status).toBe('ITEM_ADDED');
    expect(addItemToPlaylist(r.playlistId!, id, LOCAL).status).toBe('ITEM_ALREADY_PRESENT');
    expect(getPlaylist(r.playlistId!)?.items.length).toBe(1); // duplicate kayıt YOK
  });

  it('10 · öğe çıkarma → ITEM_REMOVED, olmayanı çıkarma ITEM_ALREADY_ABSENT', () => {
    const r = createPlaylist('X');
    const id = identity({ libraryId: 'lib-1' });
    addItemToPlaylist(r.playlistId!, id, LOCAL);
    const key = playlistItemKeyFor(id)!;
    expect(removeItemFromPlaylist(r.playlistId!, key).status).toBe('ITEM_REMOVED');
    expect(removeItemFromPlaylist(r.playlistId!, key).status).toBe('ITEM_ALREADY_ABSENT');
  });

  it('11 · sıralama: dizinin KENDİSİ sıralamadır — moveItemInPlaylist konumu değiştirir', () => {
    const r = createPlaylist('X');
    const a = identity({ libraryId: 'a' }); const b = identity({ libraryId: 'b' }); const c = identity({ libraryId: 'c' });
    addItemToPlaylist(r.playlistId!, a, LOCAL);
    addItemToPlaylist(r.playlistId!, b, LOCAL);
    addItemToPlaylist(r.playlistId!, c, LOCAL);
    const keyA = playlistItemKeyFor(a)!;
    moveItemInPlaylist(r.playlistId!, keyA, 2); // a'yı sona taşı
    const order = getPlaylist(r.playlistId!)!.items.map((it) => it.libraryId);
    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('12 · playlist/öğe sınırları REJECTED_PLAYLIST_LIMIT / REJECTED_ITEM_LIMIT üretir', () => {
    for (let i = 0; i < MAX_PLAYLISTS; i += 1) createPlaylist(`P${i}`);
    expect(createPlaylist('Taşan').status).toBe('REJECTED_PLAYLIST_LIMIT');

    _resetMusicPlaylistAuthorityForTest();
    const r = createPlaylist('Büyük Liste');
    for (let i = 0; i < MAX_ITEMS_PER_PLAYLIST; i += 1) {
      addItemToPlaylist(r.playlistId!, identity({ libraryId: `lib-${i}` }), LOCAL);
    }
    expect(addItemToPlaylist(r.playlistId!, identity({ libraryId: 'tasan' }), LOCAL).status)
      .toBe('REJECTED_ITEM_LIMIT');
  }, 15_000);

  it('13 · reaktivite — mutasyon subscribePlaylists\'i tetikler ve revizyonu İLERLETİR', () => {
    let calls = 0;
    const unsub = subscribePlaylists(() => { calls += 1; });
    const r0 = getPlaylistsRevision();
    createPlaylist('X');
    expect(calls).toBeGreaterThan(0);
    expect(getPlaylistsRevision()).toBeGreaterThan(r0);
    unsub();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14–16 · GÖRÜNTÜ PROJEKSİYONU + AD ARAMA — fail-closed
 * ════════════════════════════════════════════════════════════════════════ */

describe('F15 · resolvePlaylistItemDisplays kütüphaneden silinen kaydı UYDURMAZ', () => {
  it('14 · LOCAL öğe kütüphanede varsa gerçek başlık çözülür, silinmişse resolved=false', () => {
    reconcileMusicIndex([localTrackFixture({ id: 1, title: 'Yol' })]);
    const libId = getMusicLibrarySnapshot().tracks[0]!.id;
    const r = createPlaylist('X');
    addItemToPlaylist(r.playlistId!, identity({ libraryId: libId }), LOCAL);
    const [d1] = resolvePlaylistItemDisplays(getPlaylist(r.playlistId!)!.items);
    expect(d1!.resolved).toBe(true);
    expect(d1!.title).toBe('Yol');

    _resetMusicIndexForTest();
    const [d2] = resolvePlaylistItemDisplays(getPlaylist(r.playlistId!)!.items);
    expect(d2!.resolved).toBe(false);
    expect(d2!.title).toBeNull();
  });

  it('15 · findPlaylistsByName TAM eşleşmeyi önceler, çoklu alt-dizge eşleşmesinde HEPSİNİ döner', () => {
    createPlaylist('Yol Müzikleri');
    createPlaylist('Yol Sürüşü');
    expect(findPlaylistsByName('Yol Müzikleri').length).toBe(1);
    expect(findPlaylistsByName('Yol').length).toBe(2); // belirsiz — çağıran AMBIGUOUS karar verir
    expect(findPlaylistsByName('yok-boyle-bir-ad').length).toBe(0);
  });

  it('16 · resolvePlaylistStartPlan karma-sağlayıcı playlist\'te YALNIZ başlangıç kaynağıyla AYNI sınıfı döner', () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const libId = getMusicLibrarySnapshot().tracks[0]!.id;
    const r = createPlaylist('Karma');
    addItemToPlaylist(r.playlistId!, identity({ libraryId: libId }), LOCAL);
    addItemToPlaylist(r.playlistId!, identity({
      providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1',
    }), YT);
    const pl = getPlaylist(r.playlistId!)!;
    const ytKey = pl.items.find((it) => it.kind === 'PROVIDER')!.key;
    const plan = resolvePlaylistStartPlan(pl, ytKey)!;
    expect(plan.startLibraryId).toBeNull();
    expect(plan.providerEntries.length).toBe(1); // LOCAL öğe DAHİL EDİLMEZ
    expect(plan.providerEntries[0]!.kind).toBe('PROVIDER');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 17 · GİZLİLİK — kalıcı şema dar
 * ════════════════════════════════════════════════════════════════════════ */

describe('F15 · kalıcı şema gizlilik-uyumlu (statik allowlist kilidi)', () => {
  it('17 · PlaylistItemEntry/Playlist şeması yasaklı alan İÇERMEZ', () => {
    const src = strip(read('src/platform/media/playlist/musicPlaylistEntry.ts'));
    const forbidden = ['query:', 'utterance', 'transcript', 'location', 'coordinates', 'route:', 'drivingHistory', 'speech'];
    for (const f of forbidden) {
      expect(src, `yasaklı alan sızmış: ${f}`).not.toContain(f);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 18–21 · DISCOVERY — Playlist'ler bölümü kanıta bağlıdır
 * ════════════════════════════════════════════════════════════════════════ */

describe('F15 · Discovery Playlist\'ler bölümü kanıta bağlıdır', () => {
  const baseInput: DiscoveryInput = {
    library: { revision: 0, tracks: [], albums: [], artists: [], folders: [], availability: 'UNAVAILABLE' },
    continueListening: null, lastPlayed: null, recentlyPlayedTracks: [], favorites: [], playlists: [],
    drivingMode: 'parked',
  };

  it('18 · playlist yoksa PLAYLISTS bölümü ÜRETİLMEZ', () => {
    const out = buildDiscovery(baseInput);
    expect(out.sections.some((s) => s.id === 'PLAYLISTS')).toBe(false);
  });

  it('19 · gerçek playlist varsa PLAYLISTS bölümü FAVORITES\'ten SONRA, geri kalandan ÖNCE çizilir', () => {
    const out = buildDiscovery({
      ...baseInput,
      favorites: [{ key: 'local:1', title: 'Yol', artist: 'Grup', artworkIdentity: null }],
      playlists: [{ id: 'pl-1', name: 'Yol Müzikleri', itemCount: 3 }],
    });
    expect(out.sections[0]?.id).toBe('FAVORITES');
    expect(out.sections[1]?.id).toBe('PLAYLISTS');
    expect(out.sections[1]?.items[0]?.selection).toEqual({ kind: 'PLAYLIST_OPEN', playlistId: 'pl-1' });
  });

  it('20 · PLAYLIST_OPEN bir OYNATMA değildir — selectDiscoveryItem null döner (çağıran açar)', async () => {
    const { selectDiscoveryItem } = await import('../platform/media/search/discoveryRuntime');
    const result = await selectDiscoveryItem({
      id: 'pl-1', title: 'X', subtitle: null, artworkIdentity: null,
      selection: { kind: 'PLAYLIST_OPEN', playlistId: 'pl-1' },
    });
    expect(result).toBeNull();
  });

  it('21 · boş playlist "0 parça" ile dürüstçe gösterilir — uydurma sayı YOK', () => {
    const out = buildDiscovery({ ...baseInput, playlists: [{ id: 'pl-1', name: 'Boş', itemCount: 0 }] });
    expect(out.sections[0]?.items[0]?.subtitle).toBe('0 parça');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 22–23 · NİYET ÇÖZÜMÜ — playlist ifadeleri doğru niyete çözülür, ÇAKIŞMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F15 · Mavi playlist ifadelerini doğru niyete çözer', () => {
  it('22 · oluştur/ekle/aç/çıkar kalıpları adı DOĞRU çıkarır', () => {
    const create = resolveMusicIntent('yeni bir Gece Sürüşü listesi oluştur');
    expect(create?.kind).toBe('CREATE_PLAYLIST');
    expect(create?.playlistName).toBe('gece surusu');

    const add = resolveMusicIntent('bunu Yol Müzikleri listeme ekle');
    expect(add?.kind).toBe('ADD_TO_PLAYLIST');
    expect(add?.playlistName).toBe('yol muzikleri');

    const open = resolveMusicIntent('Yol Müzikleri listemi aç');
    expect(open?.kind).toBe('PLAY_MY_PLAYLIST');

    const remove = resolveMusicIntent('bunu Yol Müzikleri listemden çıkar');
    expect(remove?.kind).toBe('REMOVE_FROM_PLAYLIST');
  });

  it('23 · ÇAKIŞMA YOK: adsız "bunu listeden çıkar" HÂLÂ F3 kuyruk anlamına sahiptir (REMOVE_CURRENT)', () => {
    // F15 ÖNCESİ zaten var olan davranış — F15 bunu DEĞİŞTİRMEDİ.
    expect(resolveMusicIntent('bunu listeden çıkar')?.kind).toBe('REMOVE_CURRENT');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 24–29 · F9 ROUTER — playlist niyeti dürüst yürütülür
 * ════════════════════════════════════════════════════════════════════════ */

function makePorts(over: Record<string, unknown> = {}) {
  const sessionMock = { getListeningSession: () => null as unknown };
  _setMusicIntentPortsForTest({
    playlist: () => import('../platform/media/playlist/musicPlaylistAuthority'),
    session: () => Promise.resolve(sessionMock as any),
    sessionRuntime: () => Promise.resolve({
      startLibraryListening: () => Promise.resolve({ started: true, reason: 'ok', truth: null }),
    } as any),
    layer: () => Promise.resolve({
      playMedia: () => undefined,
      resumeLastMedia: () => false,
      next: () => Promise.resolve({ dispatched: false, verified: false, failureCode: null }),
      previous: () => Promise.resolve({ dispatched: false, verified: false, failureCode: null }),
      unifiedFromSearchResult: () => ({ id: 'x', providerId: 'youtube', title: '', subtitle: '' }),
    } as any),
    ...over,
  });
}

const sessionWithItem = () => ({
  currentItem: {
    libraryId: 'lib-1', providerId: null, providerNamespace: null, contentUri: null,
    title: 'Yol', artist: 'Grup', album: null, durationMs: null, trackNumber: null, discNumber: null,
  },
  currentSource: 'LOCAL',
});

beforeEach(() => {
  _resetMusicIntentRouterForTest();
});

describe('F15 · router — CREATE_PLAYLIST adsızsa REDDEDER, UYDURMAZ', () => {
  it('24 · ad yoksa REJECTED/playlist_name_required — sahte isim ÜRETİLMEZ', async () => {
    makePorts();
    const outcome = await dispatchMusicIntent(makeIntent('CREATE_PLAYLIST'));
    expect(outcome.status).toBe('REJECTED');
    expect(outcome.reasonCode).toBe('playlist_name_required');
    expect(outcome.claim).toBe('DECLINED');
  });

  it('25 · ad varsa VERIFIED/CONFIRMED, "çalıyor" DEMEZ, "oluşturdum" der', async () => {
    makePorts();
    const outcome = await dispatchMusicIntent(makeIntent('CREATE_PLAYLIST', { playlistName: 'Yol Müzikleri' }));
    expect(outcome.status).toBe('VERIFIED');
    const spoken = speakMusicOutcome(outcome);
    expect(spoken).not.toContain('çalıyor');
    expect(claimIsHonest(outcome, spoken)).toBe(true);
    expect(getPlaylists().length).toBe(1);
  });
});

describe('F15 · router — ADD_TO_PLAYLIST "bunu" kimliği yoksa UYDURMAZ', () => {
  it('26 · currentItem yoksa REJECTED/no_current_item', async () => {
    makePorts({ session: () => Promise.resolve({ getListeningSession: () => null } as any) });
    const outcome = await dispatchMusicIntent(makeIntent('ADD_TO_PLAYLIST', { playlistName: 'Yol Müzikleri' }));
    expect(outcome.status).toBe('REJECTED');
    expect(outcome.reasonCode).toBe('no_current_item');
  });

  it('27 · aynı adda playlist YOKSA otomatik OLUŞTURUP ekler (deterministik politika)', async () => {
    makePorts({ session: () => Promise.resolve({ getListeningSession: sessionWithItem } as any) });
    const outcome = await dispatchMusicIntent(makeIntent('ADD_TO_PLAYLIST', { playlistName: 'Yeni Liste' }));
    expect(outcome.status).toBe('VERIFIED');
    expect(outcome.reasonCode).toBe('playlist_created_and_item_added');
    expect(getPlaylists().length).toBe(1);
    expect(getPlaylists()[0]!.items.length).toBe(1);
  });

  it('28 · aynı adda BİRDEN FAZLA playlist varsa AMBIGUOUS — yanlış liste SEÇİLMEZ', async () => {
    createPlaylist('Yol Müzikleri A');
    createPlaylist('Yol Müzikleri B');
    makePorts({ session: () => Promise.resolve({ getListeningSession: sessionWithItem } as any) });
    const outcome = await dispatchMusicIntent(makeIntent('ADD_TO_PLAYLIST', { playlistName: 'Yol Müzikleri' }));
    expect(outcome.status).toBe('AMBIGUOUS');
    expect(outcome.claim).toBe('NEEDS_CHOICE');
    expect(outcome.choices.length).toBe(2);
    const spoken = speakMusicOutcome(outcome);
    expect(spoken).toContain('Hangisi');
  });
});

describe('F15 · router — PLAY_MY_PLAYLIST tek-sağlayıcı kuyruk kurar, yoksa UYDURMAZ', () => {
  it('29 · playlist bulunamazsa UNAVAILABLE — rastgele bir şey ÇALINMAZ', async () => {
    makePorts();
    const outcome = await dispatchMusicIntent(makeIntent('PLAY_MY_PLAYLIST', { playlistName: 'Yok Böyle Liste' }));
    expect(outcome.status).toBe('UNAVAILABLE');
    expect(outcome.reasonCode).toBe('playlist_not_found');
  });

  it('30 · LOCAL playlist F3 (startLibraryListening) yolundan ÇALAR', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const libId = getMusicLibrarySnapshot().tracks[0]!.id;
    const r = createPlaylist('Yol Müzikleri');
    addItemToPlaylist(r.playlistId!, identity({ libraryId: libId }), LOCAL);
    let started: unknown = null;
    makePorts({
      sessionRuntime: () => Promise.resolve({
        startLibraryListening: (i: unknown) => { started = i; return Promise.resolve({ started: true, reason: 'ok', truth: null }); },
      } as any),
    });
    const outcome = await dispatchMusicIntent(makeIntent('PLAY_MY_PLAYLIST', { playlistName: 'Yol Müzikleri' }));
    expect(outcome.status).toBe('ACCEPTED_UNVERIFIED');
    expect(started).not.toBeNull();
  });

  it('31 · karma-sağlayıcı playlist PROVIDER\'dan başlarsa TEK-SAĞLAYICI kuyruk kurar (LOCAL DIŞLANIR)', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const libId = getMusicLibrarySnapshot().tracks[0]!.id;
    const r = createPlaylist('Karma');
    // PROVIDER önce eklenir → resolvePlaylistStartPlan ilk ÇÖZÜLEBİLEN öğeden başlar.
    addItemToPlaylist(r.playlistId!, identity({
      providerNamespace: 'YOUTUBE', providerId: 'yt-1', contentUri: 'https://yt/1',
    }), YT);
    addItemToPlaylist(r.playlistId!, identity({ libraryId: libId }), LOCAL);

    let dispatched: { track: unknown; queue: unknown } | null = null;
    makePorts({
      layer: () => Promise.resolve({
        playMedia: (track: unknown, queue: unknown) => { dispatched = { track, queue }; },
      } as any),
    });
    const outcome = await dispatchMusicIntent(makeIntent('PLAY_MY_PLAYLIST', { playlistName: 'Karma' }));
    expect(outcome.status).toBe('ACCEPTED_UNVERIFIED');
    expect(dispatched).not.toBeNull();
    const queue = (dispatched as any).queue as unknown[];
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBe(1); // yalnız PROVIDER öğesi — LOCAL öğe kuyruğa GİRMEZ
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 32 · AUTHORITY SINIRI (statik kilit) — F15 ikinci otorite DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F15 · musicPlaylistAuthority ikinci playback/queue otoritesi DEĞİLDİR', () => {
  it('32 · otorite dispatch/native/PlayQueue mutasyonuna DOĞRUDAN inmez', () => {
    const authoritySrc = strip(read('src/platform/media/playlist/musicPlaylistAuthority.ts'));
    expect(authoritySrc.length, 'otorite okunamadı — kilit boş kümeye düştü').toBeGreaterThan(2000);
    expect(authoritySrc, 'native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(authoritySrc, 'playMedia\'yı doğrudan çağırmış').not.toMatch(/\bplayMedia\s*\(/);
    expect(authoritySrc, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
    expect(authoritySrc, 'MusicIndex\'i mutasyona uğratmış').not.toContain('reconcileMusicIndex');
    expect(authoritySrc, 'saf model React\'e bağlanmış').not.toContain("from 'react'");
    expect(authoritySrc, 'global zamanlayıcı kurmuş').not.toMatch(/setInterval/);
  });
});
