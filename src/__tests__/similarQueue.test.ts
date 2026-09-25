import { describe, it, expect } from 'vitest';
import { buildSimilarQueue, pipedVideoIdOf } from '../platform/media/pipedProvider';
import type { UnifiedTrack } from '../platform/media/providers';

const yt = (id: string, title: string, subtitle: string): UnifiedTrack =>
  ({ id: `youtube-${id}`, providerId: 'youtube', title, subtitle, streamUrl: `piped://${id}` });

describe('sesli arama kuyruğu — benzer şarkılar (saha 2026-09-25)', () => {
  const sel = yt('a', 'Acem Kızı', 'Sezen Aksu');
  const covers = [yt('b', 'Acem Kızı (Canlı)', 'Zara'), yt('c', 'Mustafa Ceceli - Acem Kızı', 'Mustafa Ceceli'), yt('d', 'ACEM KIZI | Official Video', 'Bengü')];

  it('aynı şarkının başka yorumları kuyruğa girmez', () => {
    const q = buildSimilarQueue(sel, [], covers);
    expect(q.map((t) => t.id)).toEqual(['youtube-a']);
  });

  it('ilgili liste varsa kuyruk benzer şarkılarla dolar', () => {
    const related = [yt('r1', 'Firuze', 'Sezen Aksu'), yt('b', 'Acem Kızı (Canlı)', 'Zara'), yt('r2', 'Gülümse', 'Sezen Aksu')];
    const q = buildSimilarQueue(sel, related, covers);
    expect(q.map((t) => t.id)).toEqual(['youtube-a', 'youtube-r1', 'youtube-r2']);
  });

  it('sanatçı aramasında farklı şarkılar korunur', () => {
    const s = yt('k1', 'Ahmet Kaya - Söyle', 'Ahmet Kaya');
    const q = buildSimilarQueue(s, [], [yt('k2', 'Ahmet Kaya - Kum Gibi', 'Ahmet Kaya'), yt('k3', 'Ahmet Kaya - Başım Belada', 'Ahmet Kaya')]);
    expect(q).toHaveLength(3);
  });

  it('YouTube dışı parçada video kimliği yoktur', () => {
    expect(pipedVideoIdOf(sel)).toBe('a');
    expect(pipedVideoIdOf({ ...sel, streamUrl: 'https://x/y.mp3' })).toBeNull();
  });
});
