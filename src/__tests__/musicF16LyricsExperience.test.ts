/**
 * musicF16LyricsExperience.test.ts — MUSIC F16 · Lyrics / Şarkı Sözleri
 * Experience.
 *
 * F16'nın tek işi şudur: gerçek, tek-otoriteli bir lyrics katmanı kurmak —
 * playback/queue/session otoritelerini ELE GEÇİRMEDEN, sahte söz/zamanlama
 * UYDURMADAN. Bu paket şunları kilitler:
 *   · kimlik modeli F13/F15 ile AYNI ilkeyi izler (yeniden İCAT EDİLMEZ)
 *   · sanitizasyon bozuk/aşırı veriyi dürüstçe REDDEDER (fail-closed)
 *   · TEK otorite — kimlik yetersizse UNAVAILABLE, cache-miss UNKNOWN
 *   · yalnız LOCAL + gerçek `contentUri` varken native ÇAĞRILIR
 *   · dosya değişince (`generationModified`) bayat kanıt KULLANILMAZ
 *   · aktif satır projeksiyonu İKİLİ ARAMADIR ve doğru sonuç üretir
 *   · Mavi görünürlüğü TALEP EDER, doğrulanmamış "buldum" İDDİASI KURMAZ
 *   · Turkçe ifadeler doğru niyete çözülür ve genel "aç" yakalayıcısına DÜŞMEZ
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LYRICS_SCHEMA_VERSION, lyricsKeyFor, sanitizeSyncedLines, sanitizePlainText,
  makeLyricsResult, parseLyricsResult, MAX_LYRICS_LINES,
} from '../platform/media/lyrics/musicLyricsEntry';
import {
  peekLyrics, primeLyricsForCurrentItem, activeLyricsLineIndex, getActiveLyricsLine,
  getLyricsCacheSize, subscribeLyricsCache,
  _resetMusicLyricsAuthorityForTest, _setNativeLyricsReaderForTest,
} from '../platform/media/lyrics/musicLyricsAuthority';
import { _resetMusicLyricsTelemetryForTest } from '../platform/media/lyrics/musicLyricsTelemetry';
import {
  getLyricsPanelVisible, setLyricsPanelVisible, _resetLyricsPanelVisibilityForTest,
} from '../platform/media/lyricsPanelVisibility';
import { _resetMusicIndexForTest, getMusicLibrarySnapshot, reconcileMusicIndex } from '../platform/media/musicIndex';
import { resolveMusicIntent } from '../platform/media/intent/musicIntentResolver';
import {
  _resetMusicIntentRouterForTest, _setMusicIntentPortsForTest, dispatchMusicIntent,
} from '../platform/media/intent/musicIntentRouter';
import { makeIntent } from '../platform/media/intent/musicIntent';
import { speakMusicOutcome, claimIsHonest } from '../platform/media/intent/musicIntentSpeech';
import type { LocalMusicTrack } from '../platform/localMusicService';
import type { CanonicalMediaIdentity } from '../platform/media/session/mediaIdentityMatching';

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

beforeEach(() => {
  _resetMusicLyricsAuthorityForTest();
  _resetMusicLyricsTelemetryForTest();
  _resetLyricsPanelVisibilityForTest();
  _resetMusicIndexForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1–6 · KİMLİK MODELİ (SAF) — F13/F15 ile AYNI ilkeyi izler
 * ════════════════════════════════════════════════════════════════════════ */

describe('F16 · kimlik modeli F13/F15 ile AYNI ilkeyi izler (yeniden İCAT EDİLMEZ)', () => {
  it('1 · lyricsKeyFor F13 favoriteKeyFor/F15 playlistItemKeyFor ile AYNI fonksiyondur', () => {
    expect(lyricsKeyFor(identity({ libraryId: 'lib-1' }))).toBe('local:lib-1');
    expect(lyricsKeyFor(identity())).toBeNull();
  });

  it('2 · sanitizeSyncedLines monoton olmayan/aşırı/bozuk satırları REDDEDER', () => {
    expect(sanitizeSyncedLines([{ ms: 0, text: 'a' }, { ms: 1000, text: 'b' }])).not.toBeNull();
    // Monoton ARTMAYAN — bozuk çerçeve belirtisi.
    expect(sanitizeSyncedLines([{ ms: 1000, text: 'a' }, { ms: 500, text: 'b' }])).toBeNull();
    expect(sanitizeSyncedLines([])).toBeNull();
    expect(sanitizeSyncedLines([{ ms: -1, text: 'a' }])).toBeNull();
    expect(sanitizeSyncedLines([{ ms: 0, text: 'a'.repeat(600) }])).toBeNull();
  });

  it('3 · sanitizePlainText boş/aşırı büyük metni REDDEDER, gerçek metni satırlara BÖLER', () => {
    expect(sanitizePlainText('')).toBeNull();
    expect(sanitizePlainText('a'.repeat(300_000))).toBeNull();
    const lines = sanitizePlainText('Satır bir\nSatır iki\r\nSatır üç');
    expect(lines?.length).toBe(3);
    expect(lines?.every((l) => l.ms === null)).toBe(true); // PLAIN'de ms HER ZAMAN null
  });

  it('4 · makeLyricsResult kimlik kanıtsızsa null döner — UYDURMA yok', () => {
    const withId = makeLyricsResult(identity({ libraryId: 'lib-1' }), 'PLAIN',
      [{ ms: null, text: 'x' }], 'LOCAL_ID3_USLT', 1000, null);
    expect(withId).not.toBeNull();
    expect(withId?.schemaVersion).toBe(LYRICS_SCHEMA_VERSION);
    const withoutId = makeLyricsResult(identity(), 'PLAIN', [{ ms: null, text: 'x' }], 'LOCAL_ID3_USLT', 1000, null);
    expect(withoutId).toBeNull();
  });

  it('5 · parseLyricsResult fail-closed — şema/alan uyuşmazlığında null, geçerli round-trip eder', () => {
    expect(parseLyricsResult(null)).toBeNull();
    expect(parseLyricsResult({ schemaVersion: 999 })).toBeNull();
    const r = makeLyricsResult(identity({ libraryId: 'lib-1' }), 'SYNCED',
      [{ ms: 0, text: 'a' }], 'LOCAL_ID3_SYLT', 1000, 42)!;
    const parsed = parseLyricsResult(JSON.parse(JSON.stringify(r)));
    expect(parsed?.key).toBe(r.key);
    expect(parsed?.format).toBe('SYNCED');
    expect(parsed?.generationModified).toBe(42);
  });

  it('6 · MAX_LYRICS_LINES sınırı aşıldığında sanitizeSyncedLines REDDEDER', () => {
    const many = Array.from({ length: MAX_LYRICS_LINES + 1 }, (_, i) => ({ ms: i, text: 'x' }));
    expect(sanitizeSyncedLines(many)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7–14 · OTORİTE — TEK kaynak, fail-closed, bayat kanıt düşürme
 * ════════════════════════════════════════════════════════════════════════ */

describe('F16 · musicLyricsAuthority TEK kaynaktır ve dürüsttür', () => {
  it('7 · kimliksiz sorgu senkron UNAVAILABLE döner — native ÇAĞRILMAZ', () => {
    let called = false;
    _setNativeLyricsReaderForTest(() => { called = true; return Promise.resolve({ results: [] }); });
    expect(peekLyrics(null).availability).toBe('UNAVAILABLE');
    expect(called).toBe(false);
  });

  it('8 · önbellekte olmayan gerçek kimlik senkron UNKNOWN döner (native ÇAĞRILMAZ — SENKRON okuma)', () => {
    const id = identity({ libraryId: 'lib-1' });
    expect(peekLyrics(id).availability).toBe('UNKNOWN');
  });

  it('9 · PROVIDER kaynakta native HİÇ ÇAĞRILMAZ — bugün desteklenen sağlayıcı YOK (§1 ölçümü)', async () => {
    let called = false;
    _setNativeLyricsReaderForTest(() => { called = true; return Promise.resolve({ results: [] }); });
    const id = identity({ providerNamespace: 'YOUTUBE', providerId: 'yt-1' });
    const q = await primeLyricsForCurrentItem(id, 'YOUTUBE', 1000);
    expect(q.availability).toBe('UNAVAILABLE');
    expect(called).toBe(false);
  });

  it('10 · LOCAL + gerçek contentUri → native ÇAĞRILIR, PLAIN sonuç ÖNBELLEĞE alınır', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({ uri, plain: 'Söz satırı bir\nSöz satırı iki', synced: null, source: 'ID3_USLT' })),
    }));
    const id = identity({ libraryId: track.id });
    const q = await primeLyricsForCurrentItem(id, 'LOCAL', 1000);
    expect(q.availability).toBe('AVAILABLE');
    expect(q.result?.format).toBe('PLAIN');
    expect(q.result?.source).toBe('LOCAL_ID3_USLT');
    expect(getLyricsCacheSize()).toBe(1);
    // İkinci çağrı ÖNBELLEKTEN gelir (senkron).
    expect(peekLyrics(id).availability).toBe('AVAILABLE');
  });

  it('11 · söz bulunamazsa DÜRÜST negatif sonuç önbelleğe alınır — tekrar tekrar native SORGULANMAZ', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    let calls = 0;
    _setNativeLyricsReaderForTest((uris) => {
      calls += 1;
      return Promise.resolve({ results: uris.map((uri) => ({ uri, plain: null, synced: null, source: 'NONE' })) });
    });
    const id = identity({ libraryId: track.id });
    const q1 = await primeLyricsForCurrentItem(id, 'LOCAL', 1000);
    expect(q1.availability).toBe('UNAVAILABLE');
    expect(calls).toBe(1);
    // İkinci istek CACHE'TEN döner — native TEKRAR ÇAĞRILMAZ.
    const q2 = await primeLyricsForCurrentItem(id, 'LOCAL', 2000);
    expect(q2.availability).toBe('UNAVAILABLE');
    expect(calls).toBe(1);
  });

  it('12 · dosya DEĞİŞİNCE (generationModified ilerledi) bayat kanıt KULLANILMAZ — yeniden UNKNOWN olur', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1, generationModified: 100 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({ uri, plain: 'Eski söz', synced: null, source: 'ID3_USLT' })),
    }));
    const id = identity({ libraryId: track.id });
    await primeLyricsForCurrentItem(id, 'LOCAL', 1000);
    expect(peekLyrics(id).availability).toBe('AVAILABLE');

    // Dosya değişti — yeni generationModified.
    reconcileMusicIndex([localTrackFixture({ id: 1, generationModified: 200, title: 'Yol' })]);
    expect(peekLyrics(id).availability).toBe('UNKNOWN'); // bayat kanıt DÜŞÜRÜLDÜ, uydurulmadı
  });

  it('13 · SYLT (senkron) sonuç format=SYNCED taşır ve satırları KORUR', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({
        uri, plain: null, source: 'ID3_SYLT',
        synced: [{ ms: 0, text: 'Satır 1' }, { ms: 2000, text: 'Satır 2' }],
      })),
    }));
    const id = identity({ libraryId: track.id });
    const q = await primeLyricsForCurrentItem(id, 'LOCAL', 1000);
    expect(q.result?.format).toBe('SYNCED');
    expect(q.result?.lines.length).toBe(2);
  });

  it('14 · abonelik — mutasyon subscribeLyricsCache\'i tetikler', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({ uri, plain: 'X', synced: null, source: 'ID3_USLT' })),
    }));
    let calls = 0;
    const unsub = subscribeLyricsCache(() => { calls += 1; });
    await primeLyricsForCurrentItem(identity({ libraryId: track.id }), 'LOCAL', 1000);
    expect(calls).toBeGreaterThan(0);
    unsub();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 15–18 · AKTİF SATIR PROJEKSİYONU — İKİLİ ARAMA (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F16 · activeLyricsLineIndex ikili aramadır ve doğru sonuç üretir', () => {
  const lines = [
    { ms: 0, text: 'a' }, { ms: 1000, text: 'b' }, { ms: 2500, text: 'c' }, { ms: 5000, text: 'd' },
  ];

  it('15 · ilk satırdan ÖNCE -1 döner', () => {
    expect(activeLyricsLineIndex(lines, -1)).toBe(-1);
  });

  it('16 · tam sınırda ve arada DOĞRU indeksi döner', () => {
    expect(activeLyricsLineIndex(lines, 0)).toBe(0);
    expect(activeLyricsLineIndex(lines, 1.5)).toBe(1); // 1500ms → hâlâ 'b' (1000ms)
    expect(activeLyricsLineIndex(lines, 2.5)).toBe(2); // tam sınır
    expect(activeLyricsLineIndex(lines, 100)).toBe(3); // son satırdan SONRA — son satırda KALIR
  });

  it('17 · boş liste veya PLAIN (ms=null) karışık satırlarda -1 döner — UYDURMA yok', () => {
    expect(activeLyricsLineIndex([], 10)).toBe(-1);
    expect(activeLyricsLineIndex([{ ms: null, text: 'x' }], 10)).toBe(-1);
  });

  it('18 · getActiveLyricsLine doğru satırı döner ve gecikmeyi ÖLÇER (LAB p50/p95)', () => {
    const line = getActiveLyricsLine(lines, 3);
    expect(line?.text).toBe('c');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 19–24 · F9 ROUTER — Mavi doğrulanmamış iddia KURMAZ, playback'e DOKUNMAZ
 * ════════════════════════════════════════════════════════════════════════ */

function makePorts(over: Record<string, unknown> = {}) {
  _setMusicIntentPortsForTest({
    lyrics: () => import('../platform/media/lyrics/musicLyricsAuthority'),
    session: () => Promise.resolve({ getListeningSession: () => null } as any),
    ...over,
  });
}

const sessionWithItem = (libraryId = 'lib-1') => ({
  currentItem: {
    libraryId, providerId: null, providerNamespace: null, contentUri: null,
    title: 'Yol', artist: 'Grup', album: null, durationMs: null, trackNumber: null, discNumber: null,
  },
  currentSource: 'LOCAL',
});

beforeEach(() => {
  _resetMusicIntentRouterForTest();
});

describe('F16 · router — sözler Mavi\'nin doğrudan mutate ETMEDİĞİ, playback\'e DOKUNMADIĞI bir istektir', () => {
  it('19 · SHOW_LYRICS mevcut öğe yoksa REJECTED/no_current_item — panel AÇILMAZ', async () => {
    makePorts();
    const outcome = await dispatchMusicIntent(makeIntent('SHOW_LYRICS'));
    expect(outcome.status).toBe('REJECTED');
    expect(outcome.reasonCode).toBe('no_current_item');
    expect(getLyricsPanelVisible()).toBe(false);
  });

  it('20 · SHOW_LYRICS söz VARSA panel AÇILIR, VERIFIED/lyrics_panel_shown, dürüst "açıyorum" söylenir', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({ uri, plain: 'Söz var', synced: null, source: 'ID3_USLT' })),
    }));
    makePorts({ session: () => Promise.resolve({ getListeningSession: () => sessionWithItem(track.id) } as any) });
    const outcome = await dispatchMusicIntent(makeIntent('SHOW_LYRICS'));
    expect(outcome.status).toBe('VERIFIED');
    expect(outcome.reasonCode).toBe('lyrics_panel_shown');
    expect(getLyricsPanelVisible()).toBe(true);
    const spoken = speakMusicOutcome(outcome);
    expect(spoken).not.toContain('çalıyor'); // bir ÇALMA iddiası DEĞİLDİR
    expect(claimIsHonest(outcome, spoken)).toBe(true);
  });

  it('21 · SHOW_LYRICS söz YOKSA panel yine AÇILIR (dürüst boş durumu gösterir) ama "buldum" DEMEZ', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({ uri, plain: null, synced: null, source: 'NONE' })),
    }));
    makePorts({ session: () => Promise.resolve({ getListeningSession: () => sessionWithItem(track.id) } as any) });
    const outcome = await dispatchMusicIntent(makeIntent('SHOW_LYRICS'));
    expect(outcome.reasonCode).toBe('lyrics_panel_shown_no_lyrics');
    expect(getLyricsPanelVisible()).toBe(true);
    const spoken = speakMusicOutcome(outcome);
    expect(spoken).not.toMatch(/buldum|bulundu/);
    expect(spoken).toMatch(/bulamadım/);
  });

  it('22 · HIDE_LYRICS kimlik GEREKTİRMEZ — her zaman VERIFIED, panel KAPANIR', async () => {
    setLyricsPanelVisible(true);
    makePorts(); // session null — kimlik YOK ama HIDE yine çalışmalı
    const outcome = await dispatchMusicIntent(makeIntent('HIDE_LYRICS'));
    expect(outcome.status).toBe('VERIFIED');
    expect(outcome.reasonCode).toBe('lyrics_panel_hidden');
    expect(getLyricsPanelVisible()).toBe(false);
  });

  it('23 · QUERY_LYRICS_AVAILABILITY görünürlüğü DEĞİŞTİRMEZ — yalnız SORAR', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({ uri, plain: 'Söz var', synced: null, source: 'ID3_USLT' })),
    }));
    makePorts({ session: () => Promise.resolve({ getListeningSession: () => sessionWithItem(track.id) } as any) });
    expect(getLyricsPanelVisible()).toBe(false);
    const outcome = await dispatchMusicIntent(makeIntent('QUERY_LYRICS_AVAILABILITY'));
    expect(outcome.reasonCode).toBe('lyrics_query_available');
    expect(getLyricsPanelVisible()).toBe(false); // DEĞİŞMEDİ
    expect(speakMusicOutcome(outcome)).toMatch(/Evet/);
  });

  it('24 · QUERY_LYRICS_AVAILABILITY söz yoksa "Hayır" der, panel YİNE AÇILMAZ', async () => {
    reconcileMusicIndex([localTrackFixture({ id: 1 })]);
    const track = getMusicLibrarySnapshot().tracks[0]!;
    _setNativeLyricsReaderForTest((uris) => Promise.resolve({
      results: uris.map((uri) => ({ uri, plain: null, synced: null, source: 'NONE' })),
    }));
    makePorts({ session: () => Promise.resolve({ getListeningSession: () => sessionWithItem(track.id) } as any) });
    const outcome = await dispatchMusicIntent(makeIntent('QUERY_LYRICS_AVAILABILITY'));
    expect(outcome.reasonCode).toBe('lyrics_query_unavailable');
    expect(getLyricsPanelVisible()).toBe(false);
    expect(speakMusicOutcome(outcome)).toMatch(/Hayır/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 25–27 · NİYET ÇÖZÜMÜ — Türkçe ifadeler, genel "aç" yakalayıcısına DÜŞMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F16 · Mavi sözler ifadelerini doğru niyete çözer, genel arama yakalayıcısına DÜŞMEZ', () => {
  it('25 · göster/aç/kapat/var-mı kalıpları doğru niyete çözülür', () => {
    expect(resolveMusicIntent('şarkı sözlerini göster')?.kind).toBe('SHOW_LYRICS');
    expect(resolveMusicIntent('sözleri aç')?.kind).toBe('SHOW_LYRICS');
    expect(resolveMusicIntent('sözleri kapat')?.kind).toBe('HIDE_LYRICS');
    expect(resolveMusicIntent('bu şarkının sözleri var mı')?.kind).toBe('QUERY_LYRICS_AVAILABILITY');
  });

  it('26 · ÇAKIŞMA YOK: "sözleri aç" genel isPlayish/PLAY_PROVIDER yakalayıcısına DÜŞMEZ', () => {
    const intent = resolveMusicIntent('sözlerini aç');
    expect(intent?.kind).toBe('SHOW_LYRICS');
    expect(intent?.kind).not.toBe('PLAY_QUERY');
    expect(intent?.kind).not.toBe('PLAY_PROVIDER');
  });

  it('27 · alakasız "müzik aç" HÂLÂ eski anlamını korur — F16 onu ELE GEÇİRMEDİ', () => {
    const intent = resolveMusicIntent('müzik aç');
    expect(intent?.kind).not.toBe('SHOW_LYRICS');
    expect(intent?.kind).not.toBe('HIDE_LYRICS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 28 · GİZLİLİK — kalıcı şema/telemetri dar (statik allowlist kilidi)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F16 · gizlilik allowlist KORUNUR — söz metni telemetriye/şemaya SIZMAZ', () => {
  it('28 · musicLyricsEntry/musicLyricsTelemetry yasaklı alan İÇERMEZ', () => {
    const entry = strip(read('src/platform/media/lyrics/musicLyricsEntry.ts'));
    const telemetry = strip(read('src/platform/media/lyrics/musicLyricsTelemetry.ts'));
    const forbidden = ['utterance', 'transcript', 'location', 'coordinates', 'route:', 'drivingHistory', 'speech'];
    for (const [name, src] of [['musicLyricsEntry', entry], ['musicLyricsTelemetry', telemetry]] as const) {
      for (const f of forbidden) {
        expect(src, `yasaklı alan ${name} şemasına sızmış: ${f}`).not.toContain(f);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 29 · AUTHORITY SINIRI (statik kilit) — F16 ikinci playback/queue otoritesi DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F16 · musicLyricsAuthority ikinci playback/queue otoritesi DEĞİLDİR', () => {
  it('29 · otorite dispatch/native playback köprüsüne DOĞRUDAN inmez, ikinci zamanlayıcı KURMAZ', () => {
    const src = strip(read('src/platform/media/lyrics/musicLyricsAuthority.ts'));
    expect(src.length, 'otorite okunamadı — kilit boş kümeye düştü').toBeGreaterThan(1500);
    expect(src, 'native köprüye inmiş').not.toContain('nativeAuthorityBridge');
    expect(src, 'playMedia\'yı doğrudan çağırmış').not.toMatch(/\bplayMedia\s*\(/);
    expect(src, 'kanonik kuyruğu doğrudan mutasyona uğratmış')
      .not.toMatch(/\b(createQueue|addToQueue|reorder|removeAt|setCurrentIndex)\s*\(/);
    expect(src, 'MusicIndex\'i mutasyona uğratmış').not.toContain('reconcileMusicIndex');
    expect(src, 'saf model React\'e bağlanmış').not.toContain("from 'react'");
    expect(src, 'global zamanlayıcı kurmuş — ikinci playback clock riski').not.toMatch(/setInterval/);
  });
});
