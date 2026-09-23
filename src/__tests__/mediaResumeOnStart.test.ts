/**
 * mediaResumeOnStart.test.ts — açılışta müziğe devam (OEM davranışı) KARARI.
 *
 * Kilit: varsayılan DAVRANIŞ DEĞİŞMEZ (duraklatılmış geri yükleme). Kendiliğinden
 * çalma YALNIZ kullanıcı ayarı açıkken, müzik ÇALARKEN kapandıysa ve kullanıcı
 * DURAKLATMAMIŞSA olur. Süresi geçmiş/uzak kaynak kuralları aynen geçerlidir.
 */
import { describe, it, expect } from 'vitest';
import { decideRecovery, RECOVERY_TTL_MS } from '../platform/media/authority/mediaRecovery';

const NOW = 10_000_000;
const saved = (over: Record<string, unknown> = {}): string => JSON.stringify({
  version: 1, source: 'LOCAL', queueRevision: 3,
  items: [{ uri: 'content://media/external/audio/media/1', title: 'Yol' }],
  currentIndex: 0, positionMs: 42_000, shuffle: false, repeat: 'off',
  userPaused: false, lastObservedPlaying: true, savedAtMs: NOW - 60_000, recoveryAttempts: 0,
  ...over,
});

describe('decideRecovery · açılışta devam', () => {
  it('🔒 ayar kapalıyken (varsayılan) çalıyor olsa bile DURAKLATILMIŞ yüklenir', () => {
    const d = decideRecovery(saved(), NOW);
    expect(d.action).toBe('RESTORE_PAUSED');
    expect(d.action !== 'NONE' && d.autoPlay).toBe(false);
  });

  it('ayar açık + çalıyordu + duraklatılmamış → kaldığı yerden ÇALAR', () => {
    const d = decideRecovery(saved(), NOW, { resumeIfWasPlaying: true });
    expect(d.action).toBe('RESTORE_PLAYING');
    if (d.action === 'RESTORE_PLAYING') {
      expect(d.autoPlay).toBe(true);
      expect(d.state.positionMs).toBe(42_000);
    }
  });

  it('🔒 kullanıcı duraklattıysa ayar açık olsa da kendiliğinden ÇALMAZ', () => {
    expect(decideRecovery(saved({ userPaused: true }), NOW, { resumeIfWasPlaying: true }).action)
      .toBe('RESTORE_PAUSED');
  });

  it('kapanırken çalmıyorduysa kendiliğinden ÇALMAZ', () => {
    expect(decideRecovery(saved({ lastObservedPlaying: false }), NOW, { resumeIfWasPlaying: true }).action)
      .toBe('RESTORE_PAUSED');
  });

  it('süresi geçmiş ya da uzak kaynak oturumu ayar açık olsa da geri YÜKLENMEZ', () => {
    expect(decideRecovery(saved({ savedAtMs: NOW - RECOVERY_TTL_MS - 1 }), NOW, { resumeIfWasPlaying: true }).action)
      .toBe('NONE');
    expect(decideRecovery(saved({ source: 'SPOTIFY' }), NOW, { resumeIfWasPlaying: true }).action)
      .toBe('NONE');
  });
});
