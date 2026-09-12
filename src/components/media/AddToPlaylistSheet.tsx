/**
 * AddToPlaylistSheet.tsx — MUSIC F15 · Now Playing "Playlist'e ekle" seçici.
 *
 * SINIRLAR (Cross-Domain §14):
 *   · Kendi playlist gerçeğini TUTMAZ — kaynak `musicPlaylistAuthority`dir.
 *   · "Bunu" kimliği F3'ün ZATEN var olan `ListeningSession.currentItem`
 *     'ından gelir — burada YENİ bir "şu an çalan" kavramı İCAT EDİLMEZ.
 *   · Mutasyon YALNIZ otorite fonksiyonları üzerinden — playback'e DOKUNMAZ.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ListMusic, Music2, Plus } from 'lucide-react';

import {
  subscribePlaylists, getPlaylists, getPlaylistsRevision,
  createPlaylist, addItemToPlaylist,
} from '../../platform/media/playlist/musicPlaylistAuthority';
import { getListeningSession } from '../../platform/media/session/listeningSession';

const MIN_TOUCH_TARGET_PX = 48;

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AddToPlaylistSheet({ open, onClose }: Props) {
  const revision = useSyncExternalStore(subscribePlaylists, getPlaylistsRevision, getPlaylistsRevision);
  /* getPlaylists() modül-seviyesi otoriteyi OKUR; `revision` kasıtlı bir
     GEÇERSİZ KILMA tetikleyicisidir, doğrudan çağrı argümanı DEĞİLDİR. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playlists = useMemo(() => getPlaylists(), [revision]);
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const handleAdd = useCallback((playlistId: string) => {
    const session = getListeningSession();
    const identity = session?.currentItem ?? null;
    if (!session || !identity) { onClose(); return; }
    addItemToPlaylist(playlistId, identity, session.currentSource);
    onClose();
  }, [onClose]);

  const handleCreateAndAdd = useCallback(() => {
    const session = getListeningSession();
    const identity = session?.currentItem ?? null;
    const clean = nameDraft.trim();
    if (!session || !identity || !clean) { setCreating(false); setNameDraft(''); return; }
    const result = createPlaylist(clean);
    if (result.status === 'CREATED' && result.playlistId) {
      addItemToPlaylist(result.playlistId, identity, session.currentSource);
    }
    setNameDraft('');
    setCreating(false);
    onClose();
  }, [nameDraft, onClose]);

  if (!open) return null;

  const currentTitle = getListeningSession()?.currentItem?.title ?? null;

  return (
    <section
      data-music-surface="add-to-playlist"
      aria-label="Playlist'e ekle"
      className="absolute inset-0 z-30 flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="flex max-h-[80%] flex-col rounded-t-3xl"
        style={{ background: 'var(--oem-surface-0, #171a20)', borderTop: '1px solid var(--oem-line, rgba(255,255,255,.14))' }}
      >
        <header
          className="flex flex-shrink-0 items-center gap-3 px-4"
          style={{ minHeight: 64, borderBottom: '1px solid var(--oem-line, rgba(255,255,255,.14))' }}
        >
          <ListMusic aria-hidden className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--oem-ink-2)' }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black" style={{ color: 'var(--oem-ink, #fff)' }}>
              Playlist&apos;e ekle
            </div>
            {currentTitle && (
              <div className="truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>{currentTitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
            style={{
              width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
              borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink)',
            }}
          >
            <ChevronDown aria-hidden className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-shrink-0 px-4 py-3">
          {creating ? (
            <div className="flex items-center gap-2 rounded-2xl px-3" style={{ minHeight: MIN_TOUCH_TARGET_PX, background: 'var(--oem-surface-2, #292d35)' }}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Yeni playlist adı"
                aria-label="Yeni playlist adı"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--oem-ink, #fff)', height: MIN_TOUCH_TARGET_PX }}
              />
              <button
                type="button"
                onClick={handleCreateAndAdd}
                aria-label="Oluştur ve ekle"
                className="flex-shrink-0 rounded-full font-black text-xs uppercase tracking-widest"
                style={{ height: MIN_TOUCH_TARGET_PX, padding: '0 16px', color: 'var(--oem-amber, #e0a23c)' }}
              >
                Ekle
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="Yeni playlist oluştur ve ekle"
              className="flex w-full items-center gap-3 rounded-2xl border px-3"
              style={{
                minHeight: MIN_TOUCH_TARGET_PX,
                borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink-2, #b9bec8)',
              }}
            >
              <Plus aria-hidden className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm font-bold">Yeni Playlist Oluştur</span>
            </button>
          )}
        </div>

        {playlists.length === 0 ? (
          <p className="flex-1 px-6 pb-6 text-center text-sm" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
            Henüz playlist yok. Yukarıdan yeni bir tane oluşturabilirsin.
          </p>
        ) : (
          <ul className="flex-1 overflow-y-auto scrollbar-none px-2 pb-4" style={{ overscrollBehavior: 'contain' }}>
            {playlists.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => handleAdd(p.id)}
                  aria-label={`${p.name} listesine ekle`}
                  className="flex w-full items-center gap-3 rounded-xl px-2 text-left"
                  style={{ minHeight: 64 }}
                >
                  <span
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'var(--oem-surface-2, #292d35)' }}
                  >
                    <Music2 aria-hidden className="h-4 w-4" style={{ color: 'var(--oem-ink-3)' }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold" style={{ color: 'var(--oem-ink, #fff)' }}>
                      {p.name}
                    </span>
                    <span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
                      {p.items.length} parça
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
