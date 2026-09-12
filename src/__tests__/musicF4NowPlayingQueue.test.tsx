/**
 * musicF4NowPlayingQueue.test.tsx — MUSIC F4 kilitleri.
 *
 * Kilitlenen sözleşmeler:
 *   1. Kontrol dürüstlüğü — desteklenmeyen kontrol RENDER EDİLMEZ.
 *   2. İlerleme dürüstlüğü — süre/konum yoksa sahte çubuk ve sahte saat YOK.
 *   3. Süreklilik UX'i — kullanıcıya teknik durum adı GÖSTERİLMEZ.
 *   4. Kuyruk yüzeyi — F3 otoritesini okur, kendi sırasını TUTMAZ, uzun kuyrukta
 *      pencereler, kullanıcı incelerken listeyi zorla geri ÇEKMEZ.
 *   5. Sürüş sözleşmesi — düzenleme kısıtlanır, hareket durur, atlama açık kalır.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  buildNowPlayingPresentation, continuityNotice, formatClock, progressFor,
  transportControlsFor, type DrivingMode, type NowPlayingInput,
} from '../components/media/nowPlayingModel';
import {
  buildQueuePanelPresentation, orderNoticeFor, queueActionsFor, windowStartFor,
  QUEUE_WINDOW_SIZE,
} from '../components/media/queuePanelModel';
import { QueuePanel } from '../components/media/QueuePanel';
import { createMusicViewModel, type MusicViewModel } from '../components/media/MusicViewModel';
import { musicSurfaceVisibilityModel } from '../components/media/musicSurfaceVisibilityModel';
import {
  _resetMusicUiPerfForTest, getMusicUiPerfSnapshot, markMetadataChanged,
  markNowPlayingInteraction, markQueueInteraction, recordMetadataCommit,
  recordNowPlayingCommit, recordQueueCommit, markMusicSnapshotReceived,
} from '../platform/media/musicUiPerf';
import {
  _resetPlayQueueForTest, createQueue, getDesiredQueue, type QueueEntry,
} from '../platform/media/session/playQueue';
import { getSource } from '../platform/media/authority/sourceCapabilities';
import type { MediaState } from '../platform/mediaService';
import type { NativeAuthoritySnapshot } from '../platform/nativePlugin';
import type { ContinuityState } from '../platform/media/session/sessionContinuity';

/* ── Fixture'lar ─────────────────────────────────────────────────────────── */

const media = (over: Partial<MediaState> = {}): MediaState => ({
  playing: false, source: 'local', activePackage: 'com.cockpitos.pro', activeAppName: 'Cihaz Müziği',
  hasSession: true, shuffle: false, repeat: 'off', permissionRequired: false, albumAccentRgb: '1, 2, 3',
  track: { title: 'Yol', artist: 'Grup', albumArt: 'content:///art/1', positionSec: 30, durationSec: 180 },
  ...over,
});

const snapshot = (over: Partial<NativeAuthoritySnapshot> = {}): NativeAuthoritySnapshot => ({
  authorityAvailable: true, activeSource: 'LOCAL', focusState: 'GAIN', audioRoute: 'SPEAKER',
  playing: false, renderingVerified: false, queueLength: 3, ...over,
});

const vmOf = (m: Partial<MediaState> = {}, s: Partial<NativeAuthoritySnapshot> = {}): MusicViewModel =>
  createMusicViewModel(media(m), snapshot(s));

const listeningOf = (over: Partial<NonNullable<NowPlayingInput['listening']>> = {}) => ({
  hasSession: true,
  continuity: 'INTACT' as ContinuityState,
  queuePosition: { index: 2, length: 12 },
  queueEditable: true,
  restored: false,
  ...over,
});

const present = (
  music: MusicViewModel,
  listening: NowPlayingInput['listening'] = listeningOf(),
  drivingMode: DrivingMode = 'idle',
  reducedMotion = false,
) => buildNowPlayingPresentation({ music, listening, drivingMode, reducedMotion });

const entry = (id: string, title = `Parça ${id}`): QueueEntry => ({
  entryId: `${id}#1`,
  identity: {
    libraryId: id, providerId: id, providerNamespace: 'MEDIASTORE', contentUri: `content:///${id}`,
    title, artist: 'Sanatçı', album: 'Albüm', durationMs: 180_000, trackNumber: 1, discNumber: 1,
  },
  item: { id, uri: `content:///${id}`, title, artist: 'Sanatçı' },
  origin: 'LIBRARY', libraryRef: null,
});

beforeEach(() => {
  _resetPlayQueueForTest();
  _resetMusicUiPerfForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · NOW PLAYING — transport dürüstlüğü
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · Now Playing transport', () => {
  it('PLAYING yalnız kanıtlı duyulabilir çalmada iddia edilir', () => {
    const verified = present(vmOf({ playing: true }, { playing: true, renderingVerified: true }));
    expect(verified).toMatchObject({ transport: 'PLAYING', isPlaying: true, awaitingConfirmation: false });
  });

  it('duraklatılmış durum PLAYING ile karışmaz', () => {
    const paused = present(vmOf());
    expect(paused).toMatchObject({ transport: 'PAUSED', isPlaying: false, awaitingConfirmation: false });
  });

  it('komut kabul edildi ama ses kanıtı yoksa iyimser PLAYING ÜRETİLMEZ', () => {
    const unverified = present(vmOf({ playing: true }, { playing: true, renderingVerified: false }));
    expect(unverified).toMatchObject({
      transport: 'UNKNOWN', isPlaying: false, awaitingConfirmation: true,
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · CAPABILITY DÜRÜSTLÜĞÜ — desteklenmeyen kontrol çizilmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · kontrol dürüstlüğü', () => {
  it('yerel kaynakta tüm kontroller açılır', () => {
    expect(transportControlsFor(getSource('LOCAL').capabilities, true, 'idle')).toEqual({
      previous: true, playPause: true, next: true, shuffle: true, repeat: true,
    });
  });

  it('sonraki/önceki desteklenmiyorsa o tuşlar HİÇ üretilmez (sönük tuş yok)', () => {
    // Spotify Connect: kuyruk semantiği yok → prev/next yok, shuffle/repeat yok.
    const controls = transportControlsFor(getSource('SPOTIFY_CONNECT').capabilities, true, 'idle');
    expect(controls).toMatchObject({ previous: false, next: false, shuffle: false, repeat: false });
    expect(controls.playPause).toBe(true);
  });

  it('bağlam yokken hiçbir kontrol üretilmez', () => {
    expect(transportControlsFor(getSource('LOCAL').capabilities, false, 'idle'))
      .toMatchObject({ previous: false, playPause: false, next: false });
  });

  it('sürüşte ikincil kontroller gizlenir, ana transport tek dokunuşta kalır', () => {
    const driving = transportControlsFor(getSource('LOCAL').capabilities, true, 'driving');
    expect(driving).toMatchObject({
      previous: true, playPause: true, next: true, shuffle: false, repeat: false,
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · PROGRESS / SEEK — sahte ilerleme yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · ilerleme dürüstlüğü', () => {
  it('gerçek süre varsa yüzde ve saat üretilir', () => {
    const p = present(vmOf()).progress;
    expect(p).toMatchObject({
      positionSec: 30, durationSec: 180, positionLabel: '0:30', durationLabel: '3:00', seekable: true,
    });
    expect(p?.percent).toBeCloseTo(16.666, 2);
  });

  it('süre yoksa ilerleme HİÇ üretilmez (sahte 0:00 / sahte slider yok)', () => {
    const noDuration = present(vmOf({ track: { title: 'Canlı', artist: 'Radyo', durationSec: 0, positionSec: 0 } }));
    expect(noDuration.progress).toBeNull();
  });

  it('konum bildirmeyen kaynakta ilerleme üretilmez', () => {
    // İnternet radyosu: konum/süre yeteneği yok.
    const radio = vmOf({ source: 'unknown' }, { activeSource: 'INTERNET_RADIO' });
    expect(progressFor(radio, getSource('INTERNET_RADIO').capabilities)).toBeNull();
  });

  it('seek desteklenmiyorsa çubuk gösterilir ama SÜRÜKLENEMEZ', () => {
    const vm = vmOf();
    const p = progressFor(vm, { ...getSource('LOCAL').capabilities, supportsSeek: false });
    expect(p).not.toBeNull();
    expect(p?.seekable).toBe(false);
  });

  it('geçersiz süre biçimlenirken sahte sıfır üretilmez', () => {
    expect(formatClock(Number.NaN)).toBe('--:--');
    expect(formatClock(-5)).toBe('--:--');
    expect(formatClock(65)).toBe('1:05');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · CONTINUITY UX — teknik terim sızmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · süreklilik kullanıcı dili', () => {
  const TECHNICAL = ['CARRIED', 'DEGRADED', 'BROKEN', 'UNKNOWN', 'INTACT', 'DRIFT', 'PREFIX', 'MATCHED'];

  it('her durum insan diline çevrilir ve teknik ad SIZMAZ', () => {
    (['INTACT', 'CARRIED', 'DEGRADED', 'BROKEN', 'UNKNOWN'] as ContinuityState[]).forEach((state) => {
      const notice = continuityNotice(state, false);
      TECHNICAL.forEach((term) => expect(notice.message).not.toContain(term));
    });
  });

  it('CARRIED / DEGRADED / BROKEN kullanıcıya ne olduğunu söyler', () => {
    expect(continuityNotice('CARRIED', false)).toMatchObject({ visible: true, message: 'Dinlemeye devam ediliyor' });
    expect(continuityNotice('DEGRADED', false)).toMatchObject({ visible: true, message: 'Bazı parçalar bu kaynakta yok' });
    expect(continuityNotice('BROKEN', false)).toMatchObject({
      visible: true, tone: 'WARN', message: 'Bu dinleme burada devam ettirilemiyor',
    });
  });

  it('INTACT sessizdir ve UNKNOWN gereksiz alarm ÜRETMEZ', () => {
    expect(continuityNotice('INTACT', false).visible).toBe(false);
    expect(continuityNotice('UNKNOWN', false).visible).toBe(false);
  });

  it('kayıttan dönülen bağlamda UNKNOWN yalnız sade bir açıklama verir', () => {
    const notice = continuityNotice('UNKNOWN', true);
    expect(notice).toMatchObject({ visible: true, tone: 'NEUTRAL' });
    expect(notice.message).not.toMatch(/çalıyor/i);   // geri yükleme çalma iddiası DEĞİL
  });

  it('sunum modeli hiçbir teknik durum adını dışarı vermez', () => {
    const p = present(vmOf(), listeningOf({ continuity: 'DEGRADED' }));
    const surfaceText = [p.title, p.artist, p.sourceLabel, p.continuity.message, p.queueSummary ?? ''].join(' ');
    TECHNICAL.forEach((term) => expect(surfaceText).not.toContain(term));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · KUYRUK MODELİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · kuyruk sunumu', () => {
  const panelOf = (over: Partial<Parameters<typeof buildQueuePanelPresentation>[0]> = {}) =>
    buildQueuePanelPresentation({
      queue: getDesiredQueue(),
      capabilities: getSource('LOCAL').capabilities,
      alignment: 'MATCHED',
      sourceLabel: 'Cihaz',
      drivingMode: 'idle',
      userBrowsing: false,
      browsingWindowStart: 0,
      ...over,
    });

  it('geçerli öğe ve sıradakiler ayırt edilir', () => {
    createQueue('LOCAL', [entry('a'), entry('b'), entry('c')], 1);
    const p = panelOf();
    expect(p.available).toBe(true);
    expect(p.currentIndex).toBe(1);
    expect(p.upcomingCount).toBe(1);
    expect(p.rows.map((r) => [r.ordinal, r.isCurrent, r.isUpcoming])).toEqual([
      [1, false, false], [2, true, false], [3, false, true],
    ]);
  });

  it('boş kuyrukta yüzey kullanılamaz sayılır (sahte satır üretilmez)', () => {
    const p = panelOf();
    expect(p).toMatchObject({ available: false, rows: [], totalCount: 0 });
    expect(p.emptyReason).toBeTruthy();
  });

  it('uzun kuyruk PENCERELENİR ve satırlar GERÇEK kuyruk indeksini taşır', () => {
    const many = Array.from({ length: 500 }, (_, i) => entry(`t${i}`));
    createQueue('LOCAL', many, 300);
    const p = panelOf();
    expect(p.totalCount).toBe(500);
    expect(p.windowed).toBe(true);
    expect(p.rows.length).toBe(QUEUE_WINDOW_SIZE);
    // Geçerli öğe pencerede ve gerçek indeksiyle duruyor.
    const current = p.rows.find((r) => r.isCurrent);
    expect(current?.index).toBe(300);
    expect(p.rows[0]!.index).toBe(p.windowStart);
  });

  it('kullanıcı listeyi incelerken pencere ZORLA geçerli öğeye çekilmez', () => {
    const many = Array.from({ length: 500 }, (_, i) => entry(`t${i}`));
    createQueue('LOCAL', many, 300);
    const browsing = panelOf({ userBrowsing: true, browsingWindowStart: 10 });
    expect(browsing.windowStart).toBe(10);
    expect(browsing.rows.find((r) => r.isCurrent)).toBeUndefined();
    // Kullanıcı bırakınca auto-follow geri gelir.
    expect(panelOf({ userBrowsing: false }).windowStart).toBeGreaterThan(200);
  });

  it('pencere sınırları kuyruk sonunda taşmaz', () => {
    expect(windowStartFor({ total: 10, currentIndex: 9, userBrowsing: false, browsingWindowStart: 0 })).toBe(0);
    expect(windowStartFor({ total: 500, currentIndex: 499, userBrowsing: false, browsingWindowStart: 0 }))
      .toBe(500 - QUEUE_WINDOW_SIZE);
    expect(windowStartFor({ total: 500, currentIndex: 0, userBrowsing: true, browsingWindowStart: -50 })).toBe(0);
    expect(windowStartFor({ total: 500, currentIndex: 0, userBrowsing: true, browsingWindowStart: 9_999 }))
      .toBe(500 - QUEUE_WINDOW_SIZE);
  });

  it('sağlayıcı kuyruk düzenlemeyi desteklemiyorsa HİÇBİR eylem çizilmez', () => {
    createQueue('SPOTIFY_CONNECT', [entry('a')], 0);
    const p = panelOf({ capabilities: getSource('SPOTIFY_CONNECT').capabilities, alignment: 'UNSUPPORTED' });
    expect(p.actions).toEqual({ jump: false, remove: false, reorder: false, playNext: false });
    expect(p.orderNotice).toMatchObject({ visible: true, message: 'Bu kaynakta sıra düzenlenemiyor' });
  });

  it('sürüşte düzenleme kapanır, atlama açık kalır', () => {
    expect(queueActionsFor(getSource('LOCAL').capabilities, 'driving'))
      .toEqual({ jump: true, remove: false, reorder: false, playNext: false });
    expect(queueActionsFor(getSource('LOCAL').capabilities, 'normal'))
      .toEqual({ jump: true, remove: true, reorder: true, playNext: true });
  });

  it('sıra uyumu bilinmiyorsa SESSİZ kalınır; sapmada kullanıcı uyarılır', () => {
    expect(orderNoticeFor('UNKNOWN').visible).toBe(false);
    expect(orderNoticeFor('MATCHED').visible).toBe(false);
    expect(orderNoticeFor('PREFIX_MATCH').visible).toBe(false);
    expect(orderNoticeFor('PROVIDER_DRIFT')).toMatchObject({
      visible: true, message: 'Bu kaynak sırayı kendi belirliyor',
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · KUYRUK YÜZEYİ RENDER'I
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · QueuePanel render', () => {
  const render = (over: Partial<Parameters<typeof QueuePanel>[0]> = {}): string =>
    renderToStaticMarkup(
      <QueuePanel
        open onClose={() => {}} alignment="MATCHED" sourceLabel="Cihaz"
        drivingMode="idle" motionEnabled
        {...over}
      />,
    );

  it('kapalıyken hiçbir şey çizmez (açılış maliyeti ödenmez)', () => {
    expect(render({ open: false })).toBe('');
  });

  it('geçerli öğe yalnız RENKLE değil, aria ve işaretle de ayrılır', () => {
    createQueue('LOCAL', [entry('a'), entry('b')], 1);
    const html = render();
    expect(html).toContain('data-queue-current="true"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('data-queue-row="1"');
  });

  it('her satır ve kontrol erişilebilir etiket taşır', () => {
    createQueue('LOCAL', [entry('a', 'Uzun Parça Adı'), entry('b')], 0);
    const html = render();
    expect(html).toContain('aria-label="Çalma kuyruğu"');
    expect(html).toContain('kuyruktan çıkar');
    expect(html).toContain('sıradaki yap');
    expect(html).toContain('Kuyruğu kapat');
  });

  it('düzenleme desteklenmeyen kaynakta silme/sıralama tuşu HİÇ basılmaz', () => {
    createQueue('SPOTIFY_CONNECT', [entry('a')], 0);
    const html = render({ alignment: 'UNSUPPORTED' });
    expect(html).not.toContain('kuyruktan çıkar');
    expect(html).not.toContain('sıradaki yap');
    expect(html).toContain('Bu kaynakta sıra düzenlenemiyor');
  });

  it('sürüşte silme/sıralama çizilmez ama liste okunabilir kalır', () => {
    createQueue('LOCAL', [entry('a'), entry('b')], 0);
    const html = render({ drivingMode: 'driving' });
    expect(html).not.toContain('kuyruktan çıkar');
    expect(html).toContain('data-queue-row="1"');
  });

  it('uzun kuyrukta yalnız pencere çizilir ve kullanıcı bunu görür', () => {
    createQueue('LOCAL', Array.from({ length: 400 }, (_, i) => entry(`t${i}`)), 0);
    const html = render();
    const rendered = (html.match(/data-queue-row=/g) ?? []).length;
    expect(rendered).toBe(QUEUE_WINDOW_SIZE);
    expect(html).toContain('arası gösteriliyor');
  });

  it('dokunma hedefleri sürüş için yeterince büyük (>= 48px)', () => {
    createQueue('LOCAL', [entry('a')], 0);
    const html = render();
    expect(html).toMatch(/min-height:64px/);
    expect(html).not.toMatch(/height:2[0-9]px/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · SÜRÜŞ / HAREKET / MINIPLAYER GEÇİŞİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · sürüş ve hareket sözleşmesi', () => {
  it('sürüşte hareket durur ve kuyruk düzenleme kapanır', () => {
    const driving = present(vmOf(), listeningOf(), 'driving');
    expect(driving.motionEnabled).toBe(false);
    expect(driving.queueEditingAllowed).toBe(false);
    // Kuyruk yine de AÇILABİLİR: okumak ve atlamak sürüşte meşrudur.
    expect(driving.canOpenQueue).toBe(true);
  });

  it('hareket azaltma isteği sürüş dışında da animasyonu kapatır', () => {
    expect(present(vmOf(), listeningOf(), 'idle', true).motionEnabled).toBe(false);
    expect(present(vmOf(), listeningOf(), 'idle', false).motionEnabled).toBe(true);
  });

  it('kaynak kuyruk düzenlemeyi desteklemiyorsa sürüş dışında da kapalıdır', () => {
    expect(present(vmOf(), listeningOf({ queueEditable: false }), 'idle').queueEditingAllowed).toBe(false);
  });

  it('MiniPlayer görünürlük politikası Now Playing açıkken çakışmaz', () => {
    const music = vmOf();
    expect(musicSurfaceVisibilityModel(music, {
      drawerOpen: false, criticalSurfaceOpen: false, nowPlayingOpen: false,
    })).toBe(true);
    expect(musicSurfaceVisibilityModel(music, {
      drawerOpen: false, criticalSurfaceOpen: false, nowPlayingOpen: true,
    })).toBe(false);
  });

  it('MiniPlayer ve Now Playing AYNI kanonik gerçeği okur (iki gerçek yok)', () => {
    const m = media({ playing: true });
    const s = snapshot({ playing: true, renderingVerified: true });
    const shell = createMusicViewModel(m, s);
    const surface = buildNowPlayingPresentation({
      music: createMusicViewModel(m, s), listening: listeningOf(),
      drivingMode: 'idle', reducedMotion: false,
    });
    expect(shell.isAudiblyPlaying).toBe(surface.isPlaying);
    expect(shell.title).toBe(surface.title);
    expect(shell.sourceLabel).toBe(surface.sourceLabel);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · METADATA / KAYNAK DEĞİŞİMİ + PERFORMANS TELEMETRİSİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · metadata, kaynak değişimi ve telemetri', () => {
  it('kaynak değişimi sunum modeline yansır ve yetenekleri yeniden kapılar', () => {
    const local = present(vmOf());
    const spotify = present(vmOf({ source: 'spotify' }, { activeSource: 'SPOTIFY_CONNECT' }));
    expect(local.sourceClass).toBe('LOCAL');
    expect(spotify.sourceClass).toBe('SPOTIFY_CONNECT');
    expect(local.controls.next).toBe(true);
    expect(spotify.controls.next).toBe(false);
  });

  it('metadata değişimi sunuma yansır ve uzun adlar kırpma için hazırdır', () => {
    const long = 'A'.repeat(240);
    const p = present(vmOf({ track: { title: long, artist: long, durationSec: 100, positionSec: 1 } }));
    expect(p.title).toBe(long);
    expect(p.artist).toBe(long);
    // Model kırpmaz — kırpma sunum katmanının işidir; ama veri BOZULMAZ.
    expect(p.title.length).toBe(240);
  });

  it('boş metadata uydurulmaz ama boş da bırakılmaz', () => {
    const p = present(vmOf({ track: { title: '', artist: '', durationSec: 0, positionSec: 0 } }));
    expect(p.title).toBe('Bilinmeyen parça');
    expect(p.artist).toBe('Sanatçı bilinmiyor');
    expect(p.progress).toBeNull();
  });

  it('kapak yoksa sunum null kimlik verir (uydurma kapak yok)', () => {
    expect(present(vmOf({ track: { title: 'x', artist: 'y', durationSec: 10, positionSec: 0 } })).artworkIdentity)
      .toBeNull();
  });

  it('Now Playing açılış gecikmesi İLK çizimde sabitlenir', () => {
    markMusicSnapshotReceived();
    markNowPlayingInteraction();
    recordNowPlayingCommit();
    const first = getMusicUiPerfSnapshot().nowPlayingOpenMs;
    expect(first).not.toBeNull();
    recordNowPlayingCommit();
    recordNowPlayingCommit();
    const after = getMusicUiPerfSnapshot();
    // Açılış ölçümü sonraki çizimlerle BÜYÜMEZ; render sayacı ayrı tutulur.
    expect(after.nowPlayingOpenMs).toBe(first);
    expect(after.nowPlayingRenders).toBe(3);
  });

  it('kuyruk açılış gecikmesi ve satır maliyeti ayrı ölçülür', () => {
    markMusicSnapshotReceived();
    markQueueInteraction();
    recordQueueCommit(60);
    const snap = getMusicUiPerfSnapshot();
    expect(snap.queueOpenMs).not.toBeNull();
    expect(snap.lastQueueRowCount).toBe(60);
    expect(snap.queueRenders).toBe(1);
  });

  it('metadata commit gecikmesi ölçülmediyse null kalır (sahte 0 yok)', () => {
    expect(getMusicUiPerfSnapshot().metadataCommitMs).toBeNull();
    markMetadataChanged();
    recordMetadataCommit();
    expect(getMusicUiPerfSnapshot().metadataCommitMs).not.toBeNull();
  });

  it('hiç ölçüm yokken tüm yüzdelikler null (uydurma performans yok)', () => {
    _resetMusicUiPerfForTest();
    const snap = getMusicUiPerfSnapshot();
    expect(snap.p50Ms.queueProjection).toBeNull();
    expect(snap.p95Ms.nowPlayingCommit).toBeNull();
    expect(snap.nowPlayingOpenMs).toBeNull();
    expect(snap.queueOpenMs).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · AUTHORITY GUARD — UI ikinci gerçek üretmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · authority guard', () => {
  it('kuyruk yüzeyi kendi sırasını TUTMAZ — kanonik kuyruk değişince satırlar değişir', () => {
    createQueue('LOCAL', [entry('a'), entry('b')], 0);
    const before = buildQueuePanelPresentation({
      queue: getDesiredQueue(), capabilities: getSource('LOCAL').capabilities,
      alignment: 'MATCHED', sourceLabel: 'Cihaz', drivingMode: 'idle',
      userBrowsing: false, browsingWindowStart: 0,
    });
    expect(before.rows).toHaveLength(2);

    createQueue('LOCAL', [entry('a'), entry('b'), entry('c')], 2);
    const after = buildQueuePanelPresentation({
      queue: getDesiredQueue(), capabilities: getSource('LOCAL').capabilities,
      alignment: 'MATCHED', sourceLabel: 'Cihaz', drivingMode: 'idle',
      userBrowsing: false, browsingWindowStart: 0,
    });
    expect(after.rows).toHaveLength(3);
    expect(after.currentIndex).toBe(2);
  });

  it('sunum modeli saf ve yan etkisizdir — iki çağrı aynı sonucu verir', () => {
    const input: NowPlayingInput = {
      music: vmOf(), listening: listeningOf(), drivingMode: 'normal', reducedMotion: false,
    };
    expect(buildNowPlayingPresentation(input)).toEqual(buildNowPlayingPresentation(input));
  });

  it('UI katmanı native köprüyü, sağlayıcıyı veya kuyruk mutasyonunu DOĞRUDAN çağırmaz', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const files = ['QueuePanel.tsx', 'nowPlayingModel.ts', 'queuePanelModel.ts'];

    files.forEach((name) => {
      const file = path.join(dir, '..', 'components', 'media', name);
      // Kör guard koruması: dosya gerçekten var mı — yoksa bu kilit hiçbir şeyi korumuyordur.
      expect(fs.existsSync(file), `${name} bulunamadı — kilit yeniden bağlanmalı`).toBe(true);
      const src = fs.readFileSync(file, 'utf8');
      expect(src, name).not.toContain('nativePlugin');
      expect(src, name).not.toContain('nativeAuthorityBridge');
      expect(src, name).not.toContain('providers');
      // Kuyruk mutasyonu YALNIZ queueCommands kapısından geçer; playQueue'nun
      // yazma API'leri UI'dan doğrudan çağrılmaz (aksi hâlde ekran ve ses ayrışır).
      ['removeAt(', 'reorder(', 'setCurrentIndex(', 'addToQueue(', 'playNext(']
        .forEach((fn) => expect(src, `${name} → ${fn}`).not.toContain(fn));
    });
  });

  it('dinleme bağlamı yokken kuyruk açılamaz ve süreklilik sessiz kalır', () => {
    const p = present(vmOf({ hasSession: false }, { authorityAvailable: false, activeSource: 'NONE', queueLength: 0 }), null);
    expect(p.canOpenQueue).toBe(false);
    expect(p.continuity.visible).toBe(false);
    expect(p.controls).toMatchObject({ previous: false, next: false, playPause: false });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · KUYRUK KOMUT KAPISI — mutasyon native'e YENİDEN YAZILIR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · kuyruk komut kapısı', () => {
  it('atlama kuyruğu değiştirir VE native pencereyi yeniden yazar (ekran/ses ayrışmaz)', async () => {
    const runtime = await import('../platform/media/session/listeningSessionRuntime');
    const calls: { startIndex: number; autoPlay: boolean }[] = [];
    runtime._setListeningRuntimePortsForTest({
      dispatch: async (args) => {
        calls.push({ startIndex: args.startIndex, autoPlay: args.autoPlay });
        return Object.freeze({
          truth: {
            commandId: 'c', sessionId: 'media-session-1', sourceId: args.source,
            backend: 'native_authority', command: 'playSource', desiredState: 'PLAYING',
            observedState: 'PLAYING', outcome: 'VERIFIED', verificationLevel: 'RENDERING_VERIFIED',
            startedAtMs: 0, endedAtMs: 1, elapsedMs: 1, failureCode: null, retryable: false, stages: [],
          },
          gatewaySessionId: 'media-session-1', generation: 1,
        });
      },
      persist: () => {},
    });

    createQueue('LOCAL', [entry('a'), entry('b'), entry('c')], 0);
    const out = await runtime.jumpToQueueIndex(2);

    expect(out.applied).toBe(true);
    expect(getDesiredQueue().currentIndex).toBe(2);
    // Kullanıcının açık niyeti: atlama çalmayı BAŞLATIR.
    expect(calls).toEqual([{ startIndex: 2, autoPlay: true }]);
    expect(out.truth?.outcome).toBe('VERIFIED');
    runtime._setListeningRuntimePortsForTest(null);
  });

  it('desteklenmeyen mutasyon REDDEDİLİR ve native\'e HİÇ komut gitmez', async () => {
    const runtime = await import('../platform/media/session/listeningSessionRuntime');
    const calls: unknown[] = [];
    runtime._setListeningRuntimePortsForTest({
      dispatch: async () => { calls.push(1); throw new Error('çağrılmamalıydı'); },
      persist: () => {},
    });

    createQueue('SPOTIFY_CONNECT', [entry('a'), entry('b')], 0);
    const removed = await runtime.removeQueueEntryAt(1);
    const reordered = await runtime.reorderQueueEntry(0, 1);

    expect(removed).toMatchObject({ applied: false });
    expect(removed.queueResult.failureCode).toBe('unsupported_capability');
    expect(reordered.applied).toBe(false);
    expect(calls).toHaveLength(0);
    // Sahte başarı yok: kuyruk DEĞİŞMEDİ.
    expect(getDesiredQueue().entries.map((e) => e.item.id)).toEqual(['a', 'b']);
    runtime._setListeningRuntimePortsForTest(null);
  });

  it('sıralama/çıkarma duraklatılmış kuyruğu KENDİLİĞİNDEN çalmaya başlatmaz', async () => {
    const runtime = await import('../platform/media/session/listeningSessionRuntime');
    const calls: { autoPlay: boolean }[] = [];
    runtime._setListeningRuntimePortsForTest({
      dispatch: async (args) => {
        calls.push({ autoPlay: args.autoPlay });
        return Object.freeze({
          truth: {
            commandId: 'c', sessionId: 's', sourceId: args.source, backend: 'native_authority',
            command: 'playSource', desiredState: 'PAUSED', observedState: 'PAUSED',
            outcome: 'ACCEPTED_UNVERIFIED', verificationLevel: 'TRANSPORT_ACK',
            startedAtMs: 0, endedAtMs: 1, elapsedMs: 1, failureCode: null, retryable: false, stages: [],
          },
          gatewaySessionId: 's', generation: 1,
        });
      },
      persist: () => {},
    });

    createQueue('LOCAL', [entry('a'), entry('b'), entry('c')], 0);
    await runtime.reorderQueueEntry(2, 0);

    // Ses kanıtı yokken autoPlay ASLA true olmaz.
    expect(calls).toEqual([{ autoPlay: false }]);
    expect(getDesiredQueue().entries.map((e) => e.item.id)).toEqual(['c', 'a', 'b']);
    runtime._setListeningRuntimePortsForTest(null);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 11 · OTOMOTİV DÜZEN + GÜNDÜZ/GECE
 * ════════════════════════════════════════════════════════════════════════ */

describe('F4 · otomotiv düzeni ve tema', () => {
  const readSurface = async (name: string): Promise<string> => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.join(dir, '..', 'components', 'media', name);
    // Kör guard koruması: dosya yoksa kilit hiçbir şeyi korumuyordur.
    expect(fs.existsSync(file), `${name} bulunamadı — kilit yeniden bağlanmalı`).toBe(true);
    return fs.readFileSync(file, 'utf8');
  };

  it('kuyruk yüzeyi tek çözünürlüğe hard-code edilmez', async () => {
    const src = await readSurface('QueuePanel.tsx');
    // Sabit viewport genişliği/yüksekliği YOK; esnek yerleşim kullanılır.
    expect(src).not.toMatch(/width:\s*800px/);
    expect(src).not.toMatch(/height:\s*480px/);
    expect(src).toContain('flex-1');
    expect(src).toContain('overflow-y-auto');
  });

  it('kuyruk yüzeyi renklerini tema otoritesinden alır (gündüz/gece birlikte çalışır)', async () => {
    const src = await readSurface('QueuePanel.tsx');
    expect(src).toContain('--oem-surface-0');
    expect(src).toContain('--oem-ink');
    // Tema dışı sabit siyah/beyaz zemin YOK — gece modunda parlama yaratırdı.
    expect(src).not.toMatch(/background:\s*['"]#fff/i);
    expect(src).not.toMatch(/background:\s*['"]white/i);
  });

  it('800×480 sınıfı ekranda pencere satır sayısı sınırlı kalır', () => {
    createQueue('LOCAL', Array.from({ length: 2_000 }, (_, i) => entry(`t${i}`)), 1_000);
    const p = buildQueuePanelPresentation({
      queue: getDesiredQueue(), capabilities: getSource('LOCAL').capabilities,
      alignment: 'MATCHED', sourceLabel: 'Cihaz', drivingMode: 'idle',
      userBrowsing: false, browsingWindowStart: 0,
    });
    // 2000 satırlık DOM düşük-uç head unit'te kabul edilemez.
    expect(p.rows.length).toBe(QUEUE_WINDOW_SIZE);
    expect(p.rows.length).toBeLessThanOrEqual(64);
  });
});
