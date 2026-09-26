/**
 * lyricsOnline.test.ts — internetten şarkı sözü (LRCLIB) + otorite entegrasyonu.
 *
 * Kilitler: yanlış şarkının sözü GÖSTERİLMEZ (süre/sanatçı eşleşmesi) · LRC
 * zaman damgası doğru çözülür · internet yokluğu "bulunamadı" SAYILMAZ ve
 * bağlantı gelince yeniden denenir · internet sonucu diske YAZILMAZ ·
 * aynı parça için eşzamanlı istek TEK ağ çağrısıdır. Gerçek ağa ÇIKILMAZ.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildLyricsQuery, cleanTitle, lookupLrclib, parseLrc, pickLrclibMatch,
  type LyricsLookupOutcome,
} from '../platform/media/lyrics/lrclibProvider';
import {
  _resetMusicLyricsAuthorityForTest, _setNativeLyricsReaderForTest, _setOnlineLyricsLookupForTest,
  peekLyrics, primeLyricsForCurrentItem,
} from '../platform/media/lyrics/musicLyricsAuthority';
import { _resetMusicIndexForTest, getMusicLibrarySnapshot, reconcileMusicIndex } from '../platform/media/musicIndex';
import type { LocalMusicTrack } from '../platform/localMusicService';
import type { CanonicalMediaIdentity } from '../platform/media/session/mediaIdentityMatching';
import type { AiHttpResponse } from '../platform/ai/nativeHttp';
import {
  _resetConnectivityAuthorityForTest, ingestConnectivityEvidence,
} from '../platform/connectivity/connectivityAuthority';
import { evidenceFromFacts } from '../platform/connectivity/connectivityEvidence';

const identity = (over: Partial<CanonicalMediaIdentity> = {}): CanonicalMediaIdentity => ({
  libraryId: null, providerId: null, providerNamespace: null, contentUri: null,
  title: 'Gidiyorum', artist: 'Sezen Aksu', album: null, durationMs: 243_000,
  trackNumber: null, discNumber: null, ...over,
});

const LRC = '[ar:Sezen Aksu]\n[00:12.50] Gidiyorum\n[00:15.00][01:40.00] Nakarat\n[00:20.3] Son';

describe('LRCLIB · saf yardımcılar', () => {
  it('başlık gürültüsü atılır, anlamlı parantez korunur', () => {
    expect(cleanTitle('Gidiyorum (Official Video)')).toBe('Gidiyorum');
    expect(cleanTitle('Gidiyorum [Resmi Klip] (Canlı)')).toBe('Gidiyorum (Canlı)');
  });

  it('sanatçı yoksa "Sanatçı - Başlık" ayrıştırılır; o da yoksa sorgu KURULMAZ', () => {
    expect(buildLyricsQuery({ title: 'Sezen Aksu - Gidiyorum (Official Video)', artist: null, album: null, durationMs: null }))
      .toEqual({ title: 'Gidiyorum', artist: 'Sezen Aksu', album: null, durationSec: null });
    expect(buildLyricsQuery({ title: 'Gidiyorum', artist: null, album: null, durationMs: 1000 })).toBeNull();
  });

  it('🔒 saha: etikette sanatçı VARKEN başlıktaki "Sanatçı - " öneki atılır; başka önek korunur', () => {
    expect(buildLyricsQuery({ title: 'Rojbin Kizil - LAWO DİNO', artist: 'Rojbin Kizil', album: 'YMusic', durationMs: 170_472 }))
      .toEqual({ title: 'LAWO DİNO', artist: 'Rojbin Kizil', album: 'YMusic', durationSec: 170 });
    expect(buildLyricsQuery({ title: 'Rojbin Kizil feat. Fehîme -- Keçê dînê', artist: 'Rojbin Kizil', album: null, durationMs: null })?.title)
      .toBe('Keçê dînê');
    expect(buildLyricsQuery({ title: 'Yalnızlık Senfonisi - Akustik', artist: 'Sezen Aksu', album: null, durationMs: null })?.title)
      .toBe('Yalnızlık Senfonisi - Akustik');
  });

  it('🔒 LRC: çoklu damga, etiket satırları ve 1–3 haneli kesir doğru ms olur', () => {
    expect(parseLrc(LRC)).toEqual([
      { ms: 12_500, text: 'Gidiyorum' },
      { ms: 15_000, text: 'Nakarat' },
      { ms: 20_300, text: 'Son' },
      { ms: 100_000, text: 'Nakarat' },
    ]);
    expect(parseLrc('damgasız düz metin')).toBeNull();
  });

  it('🔒 süre biliniyorsa ±3 sn dışındaki aday REDDEDİLİR (yanlış şarkı sözü yok)', () => {
    const q = buildLyricsQuery(identity())!;
    const far = { trackName: 'Gidiyorum', artistName: 'Sezen Aksu', duration: 260, syncedLyrics: LRC };
    expect(pickLrclibMatch([far], q)).toBeNull();
    const near = { ...far, duration: 245 };
    expect(pickLrclibMatch([near], q)?.synced?.[0]).toEqual({ ms: 12_500, text: 'Gidiyorum' });
  });

  it('süre bilinmiyorsa başlık + sanatçı BİREBİR tutmalı; enstrümantal atlanır', () => {
    const q = buildLyricsQuery(identity({ durationMs: null }))!;
    expect(pickLrclibMatch([{ trackName: 'Gidiyorum Remix', artistName: 'Sezen Aksu', plainLyrics: 'x' }], q)).toBeNull();
    expect(pickLrclibMatch([{ trackName: 'gidiyorum', artistName: 'SEZEN AKSU', instrumental: true, plainLyrics: 'x' }], q)).toBeNull();
    expect(pickLrclibMatch([{ trackName: 'gidiyorum', artistName: 'SEZEN AKSU', plainLyrics: 'söz' }], q))
      .toEqual({ synced: null, plain: 'söz' });
  });
});

const res = (status: number, body: unknown): AiHttpResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('LRCLIB · ağ sonucu sınıflandırması', () => {
  const q = buildLyricsQuery(identity({ album: 'Gülümse' }))!;

  it('eşleşme → FOUND; 404 → NOT_FOUND; 5xx/istisna → RETRY', async () => {
    const hit = [{ trackName: 'Gidiyorum', artistName: 'Sezen Aksu', duration: 243, syncedLyrics: LRC }];
    expect((await lookupLrclib(q, async () => res(200, hit))).kind).toBe('FOUND');
    expect((await lookupLrclib(q, async () => res(404, {}))).kind).toBe('NOT_FOUND');
    expect((await lookupLrclib(q, async () => res(503, {}))).kind).toBe('RETRY');
    expect((await lookupLrclib(q, async () => { throw new Error('ağ yok'); })).kind).toBe('RETRY');
  });

  it('albümlü arama boşsa albümsüz BİR KEZ daha denenir', async () => {
    const urls: string[] = [];
    const hit = [{ trackName: 'Gidiyorum', artistName: 'Sezen Aksu', duration: 243, plainLyrics: 'söz' }];
    const out = await lookupLrclib(q, async (url) => { urls.push(url); return res(200, url.includes('album_name') ? [] : hit); });
    expect(out.kind).toBe('FOUND');
    expect(urls).toHaveLength(2);
    expect(urls[1]).not.toContain('album_name');
  });
});

describe('otorite · internet yedeği', () => {
  const found: LyricsLookupOutcome = { kind: 'FOUND', lyrics: { synced: parseLrc(LRC), plain: null } };

  beforeEach(() => {
    _resetMusicLyricsAuthorityForTest(); _resetMusicIndexForTest(); _resetConnectivityAuthorityForTest();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('🔒 yerel dosyada gömülü söz yoksa internetten gelir; diske YAZILMAZ', async () => {
    reconcileMusicIndex([{
      id: 1, uri: 'content://media/external/audio/media/1', title: 'Gidiyorum', artist: 'Sezen Aksu',
      album: 'Gülümse', durationMs: 243_000, trackNumber: 1, volumeName: 'external_primary',
    } as LocalMusicTrack]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest(async (uris) => ({ results: uris.map((uri) => ({ uri, plain: null, synced: null, source: 'NONE' })) }));
    _setOnlineLyricsLookupForTest(async () => found);
    const q = await primeLyricsForCurrentItem(identity({ libraryId: track.id, album: 'Gülümse' }), 'LOCAL', 1000);
    expect(q.availability).toBe('AVAILABLE');
    expect(q.result?.source).toBe('ONLINE_LRCLIB');
    expect(q.result?.format).toBe('SYNCED');
    expect(localStorage.getItem('caros.music.f16.lyrics.v1') ?? '').not.toContain('ONLINE_LRCLIB');
    /* 🔒 useSyncExternalStore sözleşmesi: veri değişmedikçe AYNI nesne (saha: React #185). */
    const id = identity({ libraryId: track.id, album: 'Gülümse' });
    expect(peekLyrics(id)).toBe(peekLyrics(id));
    expect(peekLyrics(id).availability).toBe('AVAILABLE');
  });

  it('akış/YouTube parçasında da internet denenir (native ÇAĞRILMAZ)', async () => {
    let nativeCalled = false;
    _setNativeLyricsReaderForTest(async () => { nativeCalled = true; return { results: [] }; });
    _setOnlineLyricsLookupForTest(async () => found);
    const q = await primeLyricsForCurrentItem(identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1' }), 'YOUTUBE', 1000);
    expect(q.result?.source).toBe('ONLINE_LRCLIB');
    expect(nativeCalled).toBe(false);
  });

  it('🔒 internet yoksa "bulunamadı" DENMEZ; bağlantı otoritesi hükmü değiştirince yeniden denenir', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const lookup = vi.fn(async () => found);
    _setOnlineLyricsLookupForTest(lookup);
    const id = identity({ providerNamespace: 'STREAM', providerId: 's-1' });
    const q = await primeLyricsForCurrentItem(id, 'STREAM', 1000);
    expect(q).toMatchObject({ availability: 'UNAVAILABLE', reason: 'RETRY_LATER' });
    expect(lookup).not.toHaveBeenCalled();
    expect(peekLyrics(id).reason).toBe('RETRY_LATER');

    vi.stubGlobal('navigator', { onLine: true });
    /* Kanonik bağlantı otoritesi hükmü değiştirir (Android ağ geri çağrısı: doğrulanmış internet). */
    ingestConnectivityEvidence(evidenceFromFacts({
      source: 'ANDROID_NETWORK_CALLBACK', observedAt: Date.now(), continuous: true,
      facts: {
        present: true, transport: 'WIFI', hasInternetCapability: true, validated: true,
        captivePortal: false, metered: false, downstreamKbps: 8_000, upstreamKbps: 2_000,
      },
    }));
    await vi.waitFor(() => expect(peekLyrics(id).availability).toBe('AVAILABLE'));
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('sunucu hatası da RETRY_LATER olur, kalıcı negatif yazılmaz', async () => {
    _setOnlineLyricsLookupForTest(async () => ({ kind: 'RETRY' }));
    const id = identity({ providerNamespace: 'STREAM', providerId: 's-2' });
    expect((await primeLyricsForCurrentItem(id, 'STREAM', 1000)).reason).toBe('RETRY_LATER');
    _setOnlineLyricsLookupForTest(async () => found);
    expect((await primeLyricsForCurrentItem(id, 'STREAM', 2000)).availability).toBe('AVAILABLE');
  });

  it('🔒 panel ve Mavi aynı anda sorarsa TEK ağ çağrısı yapılır', async () => {
    const lookup = vi.fn(async () => found);
    _setOnlineLyricsLookupForTest(lookup);
    const id = identity({ providerNamespace: 'STREAM', providerId: 's-3' });
    const [a, b] = await Promise.all([
      primeLyricsForCurrentItem(id, 'STREAM', 1000), primeLyricsForCurrentItem(id, 'STREAM', 1000),
    ]);
    expect(a.availability).toBe('AVAILABLE');
    expect(b.availability).toBe('AVAILABLE');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
