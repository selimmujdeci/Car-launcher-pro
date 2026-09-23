/**
 * playbackErrorNotice.test.ts — bozuk/desteklenmeyen parça bildirimi.
 *
 * Kilit: native atlama kararı kullanıcıya DÜRÜSTÇE söylenir; açılışta geçmiş
 * hatalar için bildirim üretilmez; otorite yokken sayaç uydurulmaz.
 */
import { describe, it, expect } from 'vitest';
import { derivePlaybackErrorNotice } from '../platform/media/authority/playbackErrorNotice';
import type { NativeAuthoritySnapshot } from '../platform/nativePlugin';

const snap = (over: Partial<NativeAuthoritySnapshot>): NativeAuthoritySnapshot => ({
  authorityAvailable: true, activeSource: 'LOCAL', focusState: 'GRANTED',
  audioRoute: 'SPEAKER', playing: true, renderingVerified: true, ...over,
});

describe('derivePlaybackErrorNotice', () => {
  it('🔒 ilk gözlemde yalnız sayaç öğrenilir (geçmiş hata için bildirim YOK)', () => {
    const r = derivePlaybackErrorNotice(null, snap({ itemErrorCount: 3, lastErrorAction: 'SKIPPED' }));
    expect(r).toEqual({ count: 3, notice: null });
  });

  it('atlanan parça adıyla bildirilir', () => {
    const r = derivePlaybackErrorNotice(0, snap({
      itemErrorCount: 1, lastErrorAction: 'SKIPPED', lastErrorTitle: 'Bozuk Şarkı',
    }));
    expect(r.count).toBe(1);
    expect(r.notice?.type).toBe('warning');
    expect(r.notice?.message).toContain('“Bozuk Şarkı”');
    expect(r.notice?.message).toContain('sıradaki parçaya geçildi');
  });

  it('art arda sınır aşıldıysa çalmanın durduğu söylenir', () => {
    const r = derivePlaybackErrorNotice(5, snap({ itemErrorCount: 6, lastErrorAction: 'HALTED' }));
    expect(r.notice?.type).toBe('error');
    expect(r.notice?.title).toBe('Çalma durduruldu');
  });

  it('son parça bozuksa geçildi DENMEZ; ad yoksa uydurulmaz', () => {
    const r = derivePlaybackErrorNotice(0, snap({ itemErrorCount: 1, lastErrorAction: 'END', lastErrorTitle: '' }));
    expect(r.notice?.message).toBe('Bir parça bozuk ya da desteklenmeyen bir dosya.');
  });

  it('servis yeniden başladı (sayaç geriledi) → yalnız öğren', () => {
    expect(derivePlaybackErrorNotice(4, snap({ itemErrorCount: 0 }))).toEqual({ count: 0, notice: null });
  });

  it('otorite yokken sayaç değişmez, bildirim yok', () => {
    const r = derivePlaybackErrorNotice(2, snap({ authorityAvailable: false, itemErrorCount: 9 }));
    expect(r).toEqual({ count: 2, notice: null });
  });

  it('eski APK (alan yok) → davranış değişmez', () => {
    expect(derivePlaybackErrorNotice(null, snap({}))).toEqual({ count: null, notice: null });
  });
});
