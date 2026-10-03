/** Saha 2026-10-03 (Megane, dikey 768×1024): 16:9 video 768×432 kalıyordu → Yakınlaştır. */
import { describe, it, expect } from 'vitest';
import { videoRegion, VIDEO_ZOOM_FACTOR } from '../platform/youtubeService';

describe('tam ekran video alanı', () => {
  it('sığdır: oynatıcı ekranın tamamı', () => {
    expect(videoRegion(768, 1024, false)).toEqual({ left: 0, top: 0, width: 768, height: 1024 });
  });

  it('yakınlaştır: oynatıcı GERÇEKTEN büyür (ölçek değil) ve ortalanır; yanlar dışarıda', () => {
    const r = videoRegion(768, 1024, true);
    expect(r.width).toBe(768 * VIDEO_ZOOM_FACTOR);
    expect(r.left + r.width / 2).toBe(384);      // ekran ortası = oynatıcı ortası
    expect(r.height).toBe(1024);
    // 16:9 video genişliğe sığar → 1152×648 (eskisi 768×432)
    expect(Math.round((r.width * 9) / 16)).toBe(648);
  });
});
