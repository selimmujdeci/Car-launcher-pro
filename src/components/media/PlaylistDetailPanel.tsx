/**
 * PlaylistDetailPanel.tsx — MUSIC F15 · Playlist detay yüzeyi (SALT PROJEKSİYON).
 *
 * SINIRLAR (Cross-Domain §14, F13 `QueuePanel` ile AYNI ilke):
 *   · Kendi playlist gerçeğini TUTMAZ — kaynak `musicPlaylistAuthority`dir.
 *   · Native köprüyü/sağlayıcıyı DOĞRUDAN ÇAĞIRMAZ: LOCAL çalma kanonik F3
 *     `startLibraryListening`den, PROVIDER çalma çağırana (`onPlayProviderResult`
 *     → kanonik medya katmanı) devredilir — `MusicDiscoverySurface`nin F13
 *     favori akışıyla BİREBİR aynı sınır.
 *   · Sürüşte karmaşık düzenleme (yeniden adlandır/sil/sırala) GİZLENİR;
 *     temel oynatma + çıkarma erişilebilir kalır.
 */
import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import {
  ChevronDown, ListMusic, Music2, Trash2, ArrowUp, ArrowDown, Pencil, Check, X as XIcon,
} from 'lucide-react';

import {
  subscribePlaylists, getPlaylist, renamePlaylist, deletePlaylist,
  removeItemFromPlaylist, moveItemInPlaylist, resolvePlaylistItemDisplays,
  type PlaylistItemDisplay,
} from '../../platform/media/playlist/musicPlaylistAuthority';
import { resolvePlaylistStart } from '../../platform/media/search/discoveryRuntime';
import { startLibraryListening } from '../../platform/media/session/listeningSessionRuntime';
import type { UnifiedTrack } from '../../platform/media/providers';
import type { DrivingMode } from './nowPlayingModel';

/** Kritik dokunma hedefi tabanı — 800×480 aftermarket ekran, hiçbir yoğunlukta altına inilmez. */
const MIN_TOUCH_TARGET_PX = 48;

interface Props {
  readonly playlistId: string | null;
  readonly onClose: () => void;
  readonly drivingMode: DrivingMode;
  readonly onStarted?: () => void;
  /** PROVIDER öğesi çalınırken kanonik medya katmanına devir — bkz. F13 deseni. */
  readonly onPlayProviderResult?: (track: UnifiedTrack, queue: UnifiedTrack[]) => void;
}

const Row = memo(function Row({
  display, ordinal, canEdit, onPlay, onRemove, onMoveUp, onMoveDown, isFirst, isLast,
}: {
  readonly display: PlaylistItemDisplay;
  readonly ordinal: number;
  readonly canEdit: boolean;
  readonly onPlay: (key: string) => void;
  readonly onRemove: (key: string) => void;
  readonly onMoveUp: (key: string) => void;
  readonly onMoveDown: (key: string) => void;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const title = display.resolved ? (display.title ?? 'Bilinmeyen parça') : 'Artık bulunamıyor';
  const artist = display.resolved ? display.artist : null;
  return (
    <li
      data-playlist-row={ordinal}
      className="flex items-center gap-3 rounded-xl px-2"
      style={{ minHeight: 64 }}
    >
      <button
        type="button"
        onClick={display.resolved ? () => onPlay(display.key) : undefined}
        disabled={!display.resolved}
        aria-label={`${title}${artist ? ` — ${artist}` : ''}${display.resolved ? ' — çal' : ' — çözülemiyor'}`}
        className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent text-left disabled:cursor-default disabled:opacity-50"
        style={{ minHeight: 64 }}
      >
        <span
          aria-hidden
          className="w-6 flex-shrink-0 text-center text-[11px] font-black tabular-nums"
          style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}
        >
          {ordinal}
        </span>
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={{ background: 'var(--oem-surface-2, #292d35)' }}
        >
          {display.artworkIdentity
            ? <img src={display.artworkIdentity} alt="" loading="lazy" className="h-full w-full object-cover" />
            : <Music2 aria-hidden className="h-4 w-4" style={{ color: 'var(--oem-ink-3)' }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold" style={{ color: 'var(--oem-ink, #fff)' }}>
            {title}
          </span>
          {artist && (
            <span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
              {artist}
            </span>
          )}
        </span>
      </button>

      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => onMoveUp(display.key)}
            disabled={isFirst}
            aria-label={`${title} — yukarı taşı`}
            className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent disabled:opacity-30"
            style={{
              width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
              borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink-2)',
            }}
          >
            <ArrowUp aria-hidden className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onMoveDown(display.key)}
            disabled={isLast}
            aria-label={`${title} — aşağı taşı`}
            className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent disabled:opacity-30"
            style={{
              width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
              borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink-2)',
            }}
          >
            <ArrowDown aria-hidden className="h-5 w-5" />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => onRemove(display.key)}
        aria-label={`${title} — listeden çıkar`}
        className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
        style={{
          width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
          borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink-2)',
        }}
      >
        <Trash2 aria-hidden className="h-5 w-5" />
      </button>
    </li>
  );
});

export function PlaylistDetailPanel({
  playlistId, onClose, drivingMode, onStarted, onPlayProviderResult,
}: Props) {
  const playlist = useSyncExternalStore(
    subscribePlaylists,
    () => (playlistId ? getPlaylist(playlistId) : null),
    () => (playlistId ? getPlaylist(playlistId) : null),
  );
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const canEdit = drivingMode !== 'driving';

  const handlePlay = useCallback((itemKey: string) => {
    if (!playlistId) return;
    const resolution = resolvePlaylistStart(playlistId, itemKey);
    if (resolution.kind === 'LOCAL') {
      void startLibraryListening({
        kind: 'TRACKS', trackIds: resolution.trackIds, startTrackId: resolution.startTrackId,
      }).then((r) => { if (r.started) onStarted?.(); });
    } else if (resolution.kind === 'PROVIDER') {
      onPlayProviderResult?.(resolution.track, [...resolution.queue]);
      onStarted?.();
    }
  }, [playlistId, onStarted, onPlayProviderResult]);

  const handleRemove = useCallback((itemKey: string) => {
    if (playlistId) removeItemFromPlaylist(playlistId, itemKey);
  }, [playlistId]);

  const handleMoveUp = useCallback((itemKey: string) => {
    if (!playlist) return;
    const idx = playlist.items.findIndex((it) => it.key === itemKey);
    if (idx > 0) moveItemInPlaylist(playlist.id, itemKey, idx - 1);
  }, [playlist]);

  const handleMoveDown = useCallback((itemKey: string) => {
    if (!playlist) return;
    const idx = playlist.items.findIndex((it) => it.key === itemKey);
    if (idx >= 0 && idx < playlist.items.length - 1) moveItemInPlaylist(playlist.id, itemKey, idx + 1);
  }, [playlist]);

  const handleDelete = useCallback(() => {
    if (playlist) deletePlaylist(playlist.id);
    onClose();
  }, [playlist, onClose]);

  const startRename = useCallback(() => {
    if (!playlist) return;
    setNameDraft(playlist.name);
    setRenaming(true);
  }, [playlist]);

  const confirmRename = useCallback(() => {
    if (playlist && nameDraft.trim()) renamePlaylist(playlist.id, nameDraft);
    setRenaming(false);
  }, [playlist, nameDraft]);

  if (!playlistId) return null;

  const displays = playlist ? resolvePlaylistItemDisplays(playlist.items) : [];

  return (
    <section
      data-music-surface="playlist-detail"
      aria-label="Playlist detayı"
      className="absolute inset-0 z-20 flex flex-col"
      style={{ background: 'var(--oem-surface-0, #171a20)' }}
    >
      <header
        className="flex flex-shrink-0 items-center gap-3 px-4"
        style={{ minHeight: 64, borderBottom: '1px solid var(--oem-line, rgba(255,255,255,.14))' }}
      >
        <ListMusic aria-hidden className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--oem-ink-2)' }} />
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              aria-label="Playlist adı"
              className="min-w-0 flex-1 rounded-lg px-3 text-sm outline-none"
              style={{
                height: 44, background: 'var(--oem-surface-2)', color: 'var(--oem-ink)',
                border: '1px solid var(--oem-line, rgba(255,255,255,.14))',
              }}
            />
            <button
              type="button"
              onClick={confirmRename}
              aria-label="Adı kaydet"
              className="flex flex-shrink-0 items-center justify-center rounded-full"
              style={{ width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX, color: 'var(--oem-amber, #e0a23c)' }}
            >
              <Check aria-hidden className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              aria-label="Yeniden adlandırmayı iptal et"
              className="flex flex-shrink-0 items-center justify-center rounded-full"
              style={{ width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX, color: 'var(--oem-ink-2)' }}
            >
              <XIcon aria-hidden className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black" style={{ color: 'var(--oem-ink, #fff)' }}>
              {playlist?.name ?? 'Playlist'}
            </div>
            <div className="truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
              {playlist ? `${playlist.items.length} parça` : 'Bulunamadı'}
            </div>
          </div>
        )}
        {!renaming && canEdit && playlist && (
          <>
            <button
              type="button"
              onClick={startRename}
              aria-label="Playlist adını değiştir"
              className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
              style={{
                width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
                borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink-2)',
              }}
            >
              <Pencil aria-hidden className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Playlist'i sil"
              className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
              style={{
                width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
                borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: '#ff6b6b',
              }}
            >
              <Trash2 aria-hidden className="h-5 w-5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Playlist detayını kapat"
          className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
          style={{
            width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
            borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink)',
          }}
        >
          <ChevronDown aria-hidden className="h-5 w-5" />
        </button>
      </header>

      {!canEdit && (
        <p
          data-playlist-driving-notice="true"
          className="flex-shrink-0 px-4 py-2 text-xs"
          style={{ color: 'var(--oem-ink-2, #b9bec8)', background: 'rgba(255,255,255,0.04)' }}
        >
          Sürüşte düzenleme kapalı — çalma ve çıkarma açık kalır.
        </p>
      )}

      {!playlist ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-sm"
          style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
          Bu playlist artık bulunamıyor.
        </p>
      ) : displays.length === 0 ? (
        <p
          data-playlist-empty="true"
          className="flex flex-1 items-center justify-center px-6 text-center text-sm"
          style={{ color: 'var(--oem-ink-2, #b9bec8)' }}
        >
          Bu playlist boş. Now Playing&apos;de &quot;Playlist&apos;e ekle&quot; ile parça ekleyebilirsin.
        </p>
      ) : (
        <ul className="flex-1 overflow-y-auto scrollbar-none px-2 py-2" style={{ overscrollBehavior: 'contain' }}>
          {displays.map((d, i) => (
            <Row
              key={d.key}
              display={d}
              ordinal={i + 1}
              canEdit={canEdit}
              onPlay={handlePlay}
              onRemove={handleRemove}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              isFirst={i === 0}
              isLast={i === displays.length - 1}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
