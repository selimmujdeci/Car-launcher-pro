/**
 * musicF71YouTubeAuthority.test.ts — MUSIC F7.1 · YouTube kanonik oynatma/transport.
 *
 * ÖLÇÜLEN KUSUR (F7.1 öncesi):
 *   1. `carosMediaLayer._playTrack` YouTube'u DOĞRUDAN `playYouTube()` ile
 *      başlatıyordu → kaynak devri doğrulanmıyor, `CommandTruth` üretilmiyordu.
 *   2. `mediaCommandGateway.play/pause/seek` KOŞULSUZ native köprüye gidiyordu →
 *      backend'i native OLMAYAN kaynaklar kapının DIŞINDA sürülüyordu.
 *
 * Bu paket kapının yürütmeyi SAHİBİNE dağıttığını ve dağıtamadığında SESSİZCE
 * YUTMADIĞINI kilitler.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/* Native köprü mock'u — YouTube yolunda HİÇ çağrılmamalı. */
const nativeCalls: { cmd: string }[] = [];

vi.mock('../platform/media/authority/nativeAuthorityBridge', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../platform/media/authority/nativeAuthorityBridge')
  >();
  let seq = 0;
  const snapshot = {
    authorityAvailable: true, activeSource: 'NONE', focusState: 'GRANTED',
    audioRoute: 'SPEAKER', playing: false, renderingVerified: false, queueLength: 0,
  };
  return {
    ...actual,
    getSnapshot: () => snapshot,
    refreshSnapshot: async () => snapshot,
    isRenderingVerified: () => false,
    nextCommandId: (prefix = 'cmd') => { seq += 1; return `${prefix}-${seq}`; },
    command: async (cmd: string) => {
      nativeCalls.push({ cmd });
      return { accepted: true, failureCode: '' };
    },
    startNativeAuthority: async () => {},
    stopNativeAuthority: () => {},
    subscribe: () => () => {},
  };
});

import * as gateway from '../platform/media/authority/mediaCommandGateway';
import type {
  BackendAdapter, BackendPlaybackState, PlayRequest,
} from '../platform/media/authority/sourceCoordinator';
import type { SourceClass } from '../platform/media/authority/sourceCapabilities';

/* ── Sahte backend'ler ───────────────────────────────────────────────────── */

interface FakeYouTube {
  adapter: BackendAdapter;
  calls: string[];
  state: BackendPlaybackState;
  active: boolean;
  transportWorks: boolean;
}

function makeYouTube(): FakeYouTube {
  const f: FakeYouTube = {
    calls: [], state: 'STOPPED', active: false, transportWorks: true,
    adapter: null as unknown as BackendAdapter,
  };
  f.adapter = {
    sourceClass: 'YOUTUBE',
    isActive: () => f.active,
    observe: (): BackendPlaybackState => f.state,
    transport: {
      resume: async () => {
        f.calls.push('resume');
        if (!f.transportWorks) return { accepted: false, failureCode: 'youtube_resume_rejected' };
        f.state = 'PLAYING';
        return { accepted: true, failureCode: null };
      },
      pause: async () => {
        f.calls.push('pause');
        if (!f.transportWorks) return { accepted: false, failureCode: 'youtube_pause_rejected' };
        f.state = 'PAUSED';
        return { accepted: true, failureCode: null };
      },
      seek: async (sec: number) => {
        f.calls.push(`seek:${sec}`);
        return f.transportWorks
          ? { accepted: true, failureCode: null }
          : { accepted: false, failureCode: 'youtube_seek_rejected' };
      },
    },
    stop: async () => {
      f.calls.push('stop');
      f.active = false;
      f.state = 'STOPPED';
      return { accepted: true, verified: true, failureCode: null };
    },
    prepare: async () => { f.calls.push('prepare'); return { ready: true, failureCode: null }; },
    start: async (_r: PlayRequest) => {
      f.calls.push('start');
      f.active = true;
      f.state = 'PLAYING';
      return { accepted: true, started: true, renderingVerified: false, failureCode: null };
    },
  };
  return f;
}

/** Transport SUNMAYAN backend — kapı bunu reddetmeli, yutmamalı. */
function makeTransportlessSpotify(): { adapter: BackendAdapter } {
  return {
    adapter: {
      sourceClass: 'SPOTIFY_CONNECT',
      isActive: () => false,
      stop: async () => ({ accepted: true, verified: true, failureCode: null }),
      prepare: async () => ({ ready: true, failureCode: null }),
      start: async () => ({
        accepted: true, started: true, renderingVerified: false, failureCode: null,
      }),
    },
  };
}

/** Native backend — kapının ESKİ yolu değişmedi mi (regresyon). */
function makeNativeLocal(): BackendAdapter {
  let active = false;
  return {
    sourceClass: 'LOCAL',
    isActive: () => active,
    stop: async () => { active = false; return { accepted: true, verified: true, failureCode: null }; },
    prepare: async () => ({ ready: true, failureCode: null }),
    start: async () => {
      active = true;
      return { accepted: true, started: true, renderingVerified: false, failureCode: null };
    },
  };
}

const ITEM = { id: 'youtube-abc', uri: 'piped://abc', title: 'Parça', artist: 'YouTube' };

let yt: FakeYouTube;

beforeEach(() => {
  nativeCalls.length = 0;
  yt = makeYouTube();
  const adapters = new Map<SourceClass, BackendAdapter>([
    ['YOUTUBE', yt.adapter],
    ['LOCAL', makeNativeLocal()],
  ]);
  gateway.__resetGatewayForTest(adapters);
});

describe('F7.1 · YouTube kanonik oynatma', () => {
  it('playSource kaynak devrini yürütür ve CommandTruth üretir', async () => {
    const truth = await gateway.playSource({
      source: 'YOUTUBE', items: [ITEM], startIndex: 0, autoPlay: true,
    });
    expect(truth.outcome).not.toBe('REJECTED');
    expect(truth.sourceId).toBe('YOUTUBE');
    expect(yt.calls).toContain('prepare');
    expect(yt.calls).toContain('start');
    expect(gateway.getActiveSource()).toBe('YOUTUBE');
  });

  it('YouTube aktifken transport NATIVE köprüye GİTMEZ — backend sahibine gider', async () => {
    await gateway.playSource({ source: 'YOUTUBE', items: [ITEM], startIndex: 0, autoPlay: true });
    nativeCalls.length = 0;
    yt.calls.length = 0;

    await gateway.pause();
    await gateway.play();
    await gateway.seek(42);

    expect(yt.calls).toEqual(['pause', 'resume', 'seek:42']);
    const cmds = nativeCalls.map((c) => c.cmd);
    expect(cmds, 'YouTube komutu native ExoPlayer servisine sızmış').not.toContain('pause');
    expect(cmds).not.toContain('play');
    expect(cmds).not.toContain('seek');
  });

  it('gözlenen durum backendden OKUNUR — sahte durum üretilmez', async () => {
    await gateway.playSource({ source: 'YOUTUBE', items: [ITEM], startIndex: 0, autoPlay: true });
    const paused = await gateway.pause();
    expect(paused.observedState).toBe('PAUSED');

    yt.state = 'UNKNOWN';
    const seeked = await gateway.seek(5);
    expect(seeked.observedState, 'okunamayan durum uydurulmuş').toBe('UNKNOWN');
  });

  it('backend transportu REDDEDERSE kapı sahte başarı üretmez', async () => {
    await gateway.playSource({ source: 'YOUTUBE', items: [ITEM], startIndex: 0, autoPlay: true });
    yt.transportWorks = false;
    const t = await gateway.pause();
    expect(t.outcome).toBe('FAILED');
    expect(t.failureCode).toBe('youtube_pause_rejected');
  });

  it('transport SUNMAYAN backend sessizce yutulmaz — unsupported_capability', async () => {
    const spotify = makeTransportlessSpotify();
    gateway.__resetGatewayForTest(new Map<SourceClass, BackendAdapter>([
      ['SPOTIFY_CONNECT', spotify.adapter],
    ]));
    await gateway.playSource({
      source: 'SPOTIFY_CONNECT',
      items: [{ id: 's1', uri: 'spotify:track:1', title: 'X', artist: 'Y' }],
      startIndex: 0, autoPlay: true,
    });
    nativeCalls.length = 0;

    const t = await gateway.pause();
    expect(t.outcome).toBe('FAILED');
    expect(t.failureCode).toBe('unsupported_capability');
    expect(nativeCalls.map((c) => c.cmd), 'komut yanlış backende sızmış').not.toContain('pause');
  });

  it('NATIVE backend yolu DEĞİŞMEDİ (F0 regresyonu)', async () => {
    await gateway.playSource({
      source: 'LOCAL',
      items: [{ id: 'l1', uri: 'content://1', title: 'A', artist: 'B' }],
      startIndex: 0, autoPlay: true,
    });
    nativeCalls.length = 0;

    await gateway.pause();
    await gateway.play();
    await gateway.seek(3);
    expect(nativeCalls.map((c) => c.cmd)).toEqual(['pause', 'play', 'seek']);
  });

  it('YouTube kuyruk komutları dürüstçe reddedilir (kuyruk backendde yok)', async () => {
    await gateway.playSource({ source: 'YOUTUBE', items: [ITEM], startIndex: 0, autoPlay: true });
    const t = await gateway.next();
    expect(t.outcome).toBe('REJECTED');
    expect(t.failureCode).toBe('unsupported_capability');
  });
});
