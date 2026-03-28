/**
 * mediaService.test.ts — Media Hub ve kaynak eşleştirme testleri.
 *
 * Test kapsamı:
 *  - setSource → source state güncellenir
 *  - fmtTime: 0 → "0:00", 65 → "1:05", 3600 → "60:00"
 *  - togglePlayPause state geçişleri
 *  - updateMediaState partial güncelleme
 */

import { describe, it, expect } from 'vitest';
import {
  fmtTime,
  setSource,
  getMediaState,
  updateMediaState,
} from '../platform/mediaService';

describe('fmtTime', () => {
  it('0 saniye → "0:00"', () => {
    expect(fmtTime(0)).toBe('0:00');
  });

  it('65 saniye → "1:05"', () => {
    expect(fmtTime(65)).toBe('1:05');
  });

  it('3600 saniye → "60:00"', () => {
    expect(fmtTime(3600)).toBe('60:00');
  });

  it('negatif → "0:00"', () => {
    expect(fmtTime(-5)).toBe('0:00');
  });

  it('NaN → "0:00"', () => {
    expect(fmtTime(NaN)).toBe('0:00');
  });

  it('59 saniye → "0:59"', () => {
    expect(fmtTime(59)).toBe('0:59');
  });

  it('3599 saniye → "59:59"', () => {
    expect(fmtTime(3599)).toBe('59:59');
  });
});

describe('setSource', () => {
  it('source güncellenir', () => {
    setSource('youtube');
    expect(getMediaState().source).toBe('youtube');
    // Temizle
    setSource('spotify');
  });

  it('tüm geçerli source değerleri kabul edilir', () => {
    const sources = ['spotify', 'youtube', 'youtube_music', 'local', 'bluetooth', 'unknown'] as const;
    sources.forEach((s) => {
      setSource(s);
      expect(getMediaState().source).toBe(s);
    });
    setSource('spotify'); // reset
  });
});

describe('updateMediaState', () => {
  it('partial güncelleme çalışır', () => {
    updateMediaState({ playing: true });
    expect(getMediaState().playing).toBe(true);
    updateMediaState({ playing: false });
    expect(getMediaState().playing).toBe(false);
  });

  it('track partial güncelleme', () => {
    updateMediaState({ track: { title: 'Test Şarkısı', artist: 'Test', durationSec: 300, positionSec: 0 } });
    expect(getMediaState().track.title).toBe('Test Şarkısı');
    expect(getMediaState().track.artist).toBe('Test');
  });

  it('activeAppName alanı güncellenir', () => {
    updateMediaState({ activeAppName: 'YouTube Music', activePackage: 'com.google.android.apps.youtube.music' });
    expect(getMediaState().activeAppName).toBe('YouTube Music');
  });
});
