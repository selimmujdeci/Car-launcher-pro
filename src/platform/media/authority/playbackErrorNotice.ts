/**
 * playbackErrorNotice — native çalma servisinin PARÇAYA ÖZGÜ hata olaylarını
 * kullanıcıya dürüst bir bildirim olarak yansıtır.
 *
 * Projeksiyondur: truth üretmez, oynatma komutu göndermez. Atlama kararının
 * sahibi native servistir (`CarosPlaybackService.recoverFromItemError`); burası
 * yalnız "ne oldu"yu söyler. İlk gözlemde sayaç yalnız ÖĞRENİLİR — uygulama
 * açılırken geçmiş hatalar için bildirim gösterilmez.
 */

import type { NativeAuthoritySnapshot } from '../../nativePlugin';

export interface PlaybackErrorNotice {
  readonly type: 'warning' | 'error';
  readonly title: string;
  readonly message: string;
}

export interface PlaybackErrorNoticeStep {
  /** Bir sonraki çağrıda kullanılacak sayaç (`null` = henüz gözlenmedi). */
  readonly count: number | null;
  readonly notice: PlaybackErrorNotice | null;
}

/** SAF: önceki sayaç + yeni görüntü → (yeni sayaç, varsa bildirim). */
export function derivePlaybackErrorNotice(
  prevCount: number | null,
  s: NativeAuthoritySnapshot,
): PlaybackErrorNoticeStep {
  const count = s.authorityAvailable ? s.itemErrorCount : undefined;
  if (typeof count !== 'number') return { count: prevCount, notice: null };
  /* İlk gözlem ya da servis yeniden başladı (sayaç geriledi): yalnız öğren. */
  if (prevCount === null || count <= prevCount) return { count, notice: null };

  const name = s.lastErrorTitle ? `“${s.lastErrorTitle}”` : 'Bir parça';
  switch (s.lastErrorAction) {
    case 'SKIPPED':
      return { count, notice: {
        type: 'warning', title: 'Parça çalınamadı',
        message: `${name} bozuk ya da desteklenmeyen bir dosya — sıradaki parçaya geçildi.`,
      } };
    case 'HALTED':
      return { count, notice: {
        type: 'error', title: 'Çalma durduruldu',
        message: 'Art arda birden çok parça çalınamadı. Dosyaları ya da USB belleği kontrol edin.',
      } };
    default:
      return { count, notice: {
        type: 'warning', title: 'Parça çalınamadı',
        message: `${name} bozuk ya da desteklenmeyen bir dosya.`,
      } };
  }
}
