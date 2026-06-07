/**
 * ytDownloadService.test.ts — YouTube indirme servisi (gated) testleri.
 *
 * Not: indirme I/O'su (fetch + Capacitor Filesystem) burada test edilmez;
 * saf yardımcılar + bayrak-kapalı guard + registry davranışı doğrulanır.
 * Test ortamında VITE_ENABLE_YT_DOWNLOAD set DEĞİL → YT_DOWNLOAD_ENABLED=false.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllStorage } from './helpers';
import { safeSetRaw } from '../utils/safeStorage';
import {
  YT_DOWNLOAD_ENABLED,
  videoIdFromStreamUrl,
  getDownloads,
  isDownloaded,
  getDownloadUri,
  downloadYouTube,
} from '../platform/media/ytDownloadService';
import { PIPED_SCHEME } from '../platform/media/pipedProvider';

beforeEach(() => {
  clearAllStorage();
});

describe('ytDownloadService — bayrak', () => {
  it('test ortamında varsayılan KAPALI', () => {
    expect(YT_DOWNLOAD_ENABLED).toBe(false);
  });

  it('bayrak kapalıyken downloadYouTube hata atar', async () => {
    await expect(
      downloadYouTube({ videoId: 'abc123', title: 'X', artist: 'Y' }),
    ).rejects.toThrow();
  });
});

describe('ytDownloadService — videoIdFromStreamUrl', () => {
  it('piped:// öneki olan url’den videoId çıkarır', () => {
    expect(videoIdFromStreamUrl(`${PIPED_SCHEME}dQw4w9WgXcQ`)).toBe('dQw4w9WgXcQ');
  });
  it('piped olmayan / boş url → null', () => {
    expect(videoIdFromStreamUrl('https://example.com')).toBeNull();
    expect(videoIdFromStreamUrl(PIPED_SCHEME)).toBeNull();
    expect(videoIdFromStreamUrl(undefined)).toBeNull();
  });
});

describe('ytDownloadService — registry', () => {
  const sample = [
    { id: 'v1', title: 'A', artist: 'Ar', fileUri: 'file:///a.m4a', ext: 'm4a', bytes: 10, downloadedAt: 100 },
    { id: 'v2', title: 'B', artist: 'Br', fileUri: 'file:///b.m4a', ext: 'm4a', bytes: 20, downloadedAt: 200 },
  ];

  beforeEach(() => {
    safeSetRaw('yt-downloads', JSON.stringify(sample), 0, true);
  });

  it('getDownloads en yeni → en eski sıralı döner', () => {
    const list = getDownloads();
    expect(list.map((d) => d.id)).toEqual(['v2', 'v1']);
  });

  it('isDownloaded mevcut/eksik id’yi ayırır', () => {
    expect(isDownloaded('v1')).toBe(true);
    expect(isDownloaded('yok')).toBe(false);
  });

  it('getDownloadUri doğru uri’yi döner, eksikte null', () => {
    expect(getDownloadUri('v2')).toBe('file:///b.m4a');
    expect(getDownloadUri('yok')).toBeNull();
  });

  it('bozuk registry → boş liste (çökmez)', () => {
    safeSetRaw('yt-downloads', '{bozuk', 0, true);
    expect(getDownloads()).toEqual([]);
  });
});
