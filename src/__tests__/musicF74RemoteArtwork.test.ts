/**
 * musicF74RemoteArtwork.test.ts — MUSIC F7.4 · Sağlayıcı (uzak) kapak yolu.
 *
 * ÖLÇÜLEN KUSUR (F7.4 öncesi): sağlayıcı sonuçlarının kapak kimliği bir
 * `https://` küçük resim adresidir (YouTube `i.ytimg.com` gibi). `resolveArtwork`
 * bu kimliği native çözücüye gönderiyordu; o katman MediaStore `content://`
 * URI'si bekler → çözüm düşüyor ve Now Playing kapağı BOŞ kalıyordu.
 *
 * Kilit: uzak kimlik GEÇİRİLİR, native decode ÇAĞRILMAZ, disk katmanına
 * YAZILMAZ ve kaynak dürüstçe `REMOTE` raporlanır ("önbelleklendi" denmez).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../platform/bridge', () => ({ isNative: true }));

const nativeResolveCalls: string[] = [];

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    resolveArtworkFile: async ({ uri }: { uri: string }) => {
      nativeResolveCalls.push(uri);
      return null;
    },
    getMediaArtDataUri: async ({ uri }: { uri: string }) => {
      nativeResolveCalls.push(`base64:${uri}`);
      return { dataUri: '' };
    },
    deleteArtworkFiles: async () => undefined,
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (p: string) => `file://${p}`,
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
  registerPlugin: () => ({}),
}));

import {
  resolveArtwork, getArtworkCacheSnapshot, _resetArtworkCacheForTest,
} from '../platform/media/artworkCache';

beforeEach(() => {
  nativeResolveCalls.length = 0;
  _resetArtworkCacheForTest();
});

describe('F7.4 · uzak sağlayıcı kapağı', () => {
  it('https kimliği doğrudan çizilebilir URL olarak GEÇİRİLİR', async () => {
    const url = 'https://i.ytimg.com/vi/abc123/mqdefault.jpg';
    const out = await resolveArtwork(url, 'now-playing');
    expect(out.url).toBe(url);
    expect(out.source).toBe('REMOTE');
  });

  it('uzak kapakta native decode HİÇ çağrılmaz', async () => {
    await resolveArtwork('https://i.ytimg.com/vi/abc123/mqdefault.jpg', 'now-playing');
    await resolveArtwork('http://example.invalid/cover.jpg', 'thumbnail');
    expect(nativeResolveCalls, 'uzak kapak native çözücüye gönderilmiş').toEqual([]);
  });

  it('uzak kapak DİSKE/belleğe bayt olarak yazılmaz — sahte önbellek iddiası yok', async () => {
    await resolveArtwork('https://i.ytimg.com/vi/abc123/mqdefault.jpg', 'now-playing');
    const snap = getArtworkCacheSnapshot();
    expect(snap.entries, 'uzak kapak bellek katmanını şişirmiş').toBe(0);
    expect(snap.bytes).toBe(0);
    expect(snap.disk.entries).toBe(0);
    /* Ama GEÇİŞ sayılır — gözlemlenebilirlik dürüst kalır. */
    expect(snap.remoteResolved).toBe(1);
  });

  it('boş kimlik yine MISSING — uydurma kapak yok', async () => {
    const out = await resolveArtwork(null, 'now-playing');
    expect(out.url).toBeNull();
    expect(out.source).toBe('MISSING');
  });

  it('yerel content:// kimliği eski yolunda kalır (F2 regresyonu)', async () => {
    const out = await resolveArtwork('content://media/external/audio/albumart/12', 'now-playing');
    expect(out.source).not.toBe('REMOTE');
    expect(nativeResolveCalls.length, 'yerel kapak native çözücüye gitmemiş')
      .toBeGreaterThan(0);
  });
});
