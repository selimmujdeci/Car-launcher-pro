import { describe, expect, it } from 'vitest';
import {
  _resetMusicUiPerfForTest, getMusicUiPerfSnapshot, markMusicArtworkReady,
  markMusicSnapshotReceived, markNowPlayingInteraction, recordMiniPlayerCommit,
  recordMusicProjection, recordNowPlayingCommit,
} from '../platform/media/musicUiPerf';

describe('F1.1 music UI performance evidence', () => {
  it('keeps bounded p50/p95 timing evidence without a playback timer', () => {
    _resetMusicUiPerfForTest();
    for (let i = 0; i < 80; i += 1) {
      markMusicSnapshotReceived();
      recordMusicProjection(performance.now());
      recordMiniPlayerCommit();
      recordNowPlayingCommit();
    }
    const s = getMusicUiPerfSnapshot();
    expect(s.samples.projection).toBe(64);
    expect(s.samples.miniCommit).toBe(64);
    expect(s.samples.nowPlayingCommit).toBe(64);
    expect(s.p95Ms.projection).not.toBeNull();
  });

  /**
   * F4 GÜNCELLEMESİ (kilit kaldırılmadı, DOĞRU davranışa taşındı).
   *
   * Eski uygulama `nowPlayingOpenMs`'i her okumada `now() - interactionAt` olarak
   * hesaplıyordu; yani değer yüzey açık kaldıkça BÜYÜYORDU ve 5 dakika açık kalan
   * bir Now Playing "300000 ms açılış gecikmesi" olarak raporlanıyordu. Bu bir
   * açılış gecikmesi değil, açık kalma süresidir. Doğru sözleşme: gecikme İLK
   * çizimde ölçülür, orada SABİTLENİR ve sonraki çizimlerle değişmez; çizim hiç
   * olmadıysa ölçüm YAPILMAMIŞTIR (`null` — sahte değer üretilmez).
   */
  it('reports no fabricated artwork/open latency before those lifecycle events', () => {
    _resetMusicUiPerfForTest();
    expect(getMusicUiPerfSnapshot().artworkReadyAfterOpenMs).toBeNull();
    markNowPlayingInteraction();
    markMusicArtworkReady();

    // Henüz hiç çizim olmadı → açılış gecikmesi ÖLÇÜLMEMİŞTİR.
    expect(getMusicUiPerfSnapshot().nowPlayingOpenMs).toBeNull();
    // Kapak hazır olma anı ayrı bir olaydır ve etkileşimden itibaren ölçülür.
    expect(getMusicUiPerfSnapshot().artworkReadyAfterOpenMs).not.toBeNull();

    markMusicSnapshotReceived();
    recordNowPlayingCommit();
    const measured = getMusicUiPerfSnapshot().nowPlayingOpenMs;
    expect(measured).not.toBeNull();

    // Yüzey açık kaldıkça ölçüm BÜYÜMEZ (eski hatanın regresyon kilidi).
    recordNowPlayingCommit();
    recordNowPlayingCommit();
    expect(getMusicUiPerfSnapshot().nowPlayingOpenMs).toBe(measured);
  });
});
