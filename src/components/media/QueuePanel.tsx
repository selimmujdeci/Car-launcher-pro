/**
 * QueuePanel.tsx — F4 · Kuyruk yüzeyi (SALT PROJEKSİYON).
 *
 * SINIRLAR (Cross-Domain §14):
 *   · Kendi sıra gerçeğini TUTMAZ — kaynak F3 `PlayQueue`'dur.
 *   · Native köprüyü veya sağlayıcıyı ÇAĞIRMAZ; her mutasyon `queueCommands`
 *     kapısından geçer ve orada native'e yeniden yazılır.
 *   · İyimser güncelleme YOKTUR: satırlar kanonik kuyruk yayınıyla değişir.
 *   · Desteklenmeyen eylem RENDER EDİLMEZ (sönük tuş mezarlığı yok).
 */
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ListMusic, Music2, Trash2, ArrowUp } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { getDesiredQueue, subscribeDesiredQueue } from '../../platform/media/session/playQueue';
import {
  jumpToQueueIndex, playQueueEntryNext, removeQueueEntryAt,
} from '../../platform/media/session/listeningSessionRuntime';
import { getSource } from '../../platform/media/authority/sourceCapabilities';
import type { QueueAlignment } from '../../platform/media/authority/queueReconciliation';
import {
  recordQueueCommit, recordQueueProjection, recordQueueRowRender,
} from '../../platform/media/musicUiPerf';
import {
  buildQueuePanelPresentation, QUEUE_WINDOW_SIZE, type QueueRow,
} from './queuePanelModel';
import type { DrivingMode } from './nowPlayingModel';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly alignment: QueueAlignment;
  readonly sourceLabel: string;
  readonly drivingMode: DrivingMode;
  readonly motionEnabled: boolean;
}

/** Satır — sıra, kapak, başlık, sanatçı. Aşırı metadata GÖSTERİLMEZ. */
const Row = memo(function Row({
  row, canJump, canRemove, canPlayNext, onJump, onRemove, onPlayNext,
}: {
  readonly row: QueueRow;
  readonly canJump: boolean; readonly canRemove: boolean; readonly canPlayNext: boolean;
  readonly onJump: (index: number) => void;
  readonly onRemove: (index: number) => void;
  readonly onPlayNext: (index: number) => void;
}) {
  const label = `${row.ordinal}. ${row.title} — ${row.artist}`;
  return (
    <li
      data-queue-row={row.index}
      data-queue-current={row.isCurrent ? 'true' : 'false'}
      aria-current={row.isCurrent ? 'true' : undefined}
      className="flex items-center gap-3 rounded-xl px-2"
      style={{
        minHeight: 64,
        /* Geçerli öğe YALNIZ renkle ayrılmaz: kenar çubuğu + kalın metin +
           aria-current birlikte taşır (renk körlüğü ve parlak güneş için). */
        background: row.isCurrent ? 'var(--oem-surface-2, rgba(255,255,255,0.07))' : 'transparent',
        borderLeft: row.isCurrent ? '3px solid var(--oem-amber, #e0a23c)' : '3px solid transparent',
      }}
    >
      <button
        type="button"
        onClick={canJump ? () => onJump(row.index) : undefined}
        disabled={!canJump}
        aria-label={canJump ? `${label} — bu parçaya geç` : label}
        className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent text-left disabled:cursor-default"
        style={{ minHeight: 64 }}
      >
        <span
          aria-hidden
          className="w-6 flex-shrink-0 text-center text-[11px] font-black tabular-nums"
          style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}
        >
          {row.isCurrent ? '▶' : row.ordinal}
        </span>
        <span
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={{ background: 'var(--oem-surface-2, #292d35)' }}
        >
          {row.artworkIdentity
            ? <img src={row.artworkIdentity} alt="" loading="lazy" className="h-full w-full object-cover" />
            : <Music2 aria-hidden className="h-4 w-4" style={{ color: 'var(--oem-ink-3)' }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm"
            style={{
              color: 'var(--oem-ink, #fff)',
              fontWeight: row.isCurrent ? 800 : 600,
            }}
          >
            {row.title}
          </span>
          <span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
            {row.artist}
          </span>
        </span>
      </button>

      {canPlayNext && !row.isCurrent && (
        <button
          type="button"
          onClick={() => onPlayNext(row.index)}
          aria-label={`${row.title} — sıradaki yap`}
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
          style={{ borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink-2)' }}
        >
          <ArrowUp aria-hidden className="h-5 w-5" />
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(row.index)}
          aria-label={`${row.title} — kuyruktan çıkar`}
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
          style={{ borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink-2)' }}
        >
          <Trash2 aria-hidden className="h-5 w-5" />
        </button>
      )}
    </li>
  );
});

export function QueuePanel({
  open, onClose, alignment, sourceLabel, drivingMode, motionEnabled,
}: Props) {
  const queue = useSyncExternalStore(subscribeDesiredQueue, getDesiredQueue, getDesiredQueue);
  /* Kullanıcı listeyi elle inceliyorsa pencere geçerli öğeye ZORLA çekilmez.
     Bu bir presentation state'idir; kuyruk gerçeği DEĞİLDİR. */
  const [browsing, setBrowsing] = useState<{ active: boolean; start: number }>(
    { active: false, start: 0 },
  );

  const presentation = useMemo(() => {
    const startedAt = performance.now();
    const capabilities = queue.source ? (() => {
      try { return getSource(queue.source!).capabilities; } catch { return null; }
    })() : null;
    const out = buildQueuePanelPresentation({
      queue, capabilities, alignment, sourceLabel, drivingMode,
      userBrowsing: browsing.active, browsingWindowStart: browsing.start,
    });
    recordQueueProjection(startedAt);
    return out;
  }, [queue, alignment, sourceLabel, drivingMode, browsing.active, browsing.start]);

  const listRef = useRef<HTMLUListElement>(null);
  const rowRenderStart = useRef(0);
  rowRenderStart.current = performance.now();

  useLayoutEffect(() => {
    if (!open) return;
    recordQueueRowRender(rowRenderStart.current);
    recordQueueCommit(presentation.rows.length);
  });

  /* Auto-follow yalnız kullanıcı listeyi bırakınca yeniden devreye girer;
     kullanıcı kaydırırken liste ayağının altından KAYMAZ. */
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || presentation.totalCount <= QUEUE_WINDOW_SIZE) return;
    setBrowsing((prev) => (prev.active ? prev : { active: true, start: presentation.windowStart }));
  }, [presentation.totalCount, presentation.windowStart]);

  const resumeFollow = useCallback(() => setBrowsing({ active: false, start: 0 }), []);

  const onJump = useCallback((index: number) => { void jumpToQueueIndex(index); }, []);
  const onRemove = useCallback((index: number) => { void removeQueueEntryAt(index); }, []);
  const onPlayNext = useCallback((index: number) => { void playQueueEntryNext(index); }, []);

  if (!open) return null;

  return (
    <section
      data-music-surface="queue"
      aria-label="Çalma kuyruğu"
      className="absolute inset-0 z-20 flex flex-col"
      style={{
        background: 'var(--oem-surface-0, #171a20)',
        transition: motionEnabled ? 'opacity 180ms ease' : 'none',
      }}
    >
      <header
        className="flex flex-shrink-0 items-center gap-3 px-4"
        style={{ minHeight: 64, borderBottom: '1px solid var(--oem-line, rgba(255,255,255,.14))' }}
      >
        <ListMusic aria-hidden className="h-5 w-5" style={{ color: 'var(--oem-ink-2)' }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black" style={{ color: 'var(--oem-ink, #fff)' }}>
            Sırada
          </div>
          <div className="truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
            {presentation.available
              ? `${presentation.upcomingCount} parça · ${presentation.sourceLabel}`
              : presentation.sourceLabel}
          </div>
        </div>
        {browsing.active && (
          <button
            type="button"
            onClick={resumeFollow}
            aria-label="Çalan parçaya dön"
            className="flex-shrink-0 rounded-full border bg-transparent px-4 text-xs font-bold"
            style={{
              minHeight: 48, color: 'var(--oem-ink, #fff)',
              borderColor: 'var(--oem-line, rgba(255,255,255,.14))',
            }}
          >
            Çalana dön
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Kuyruğu kapat"
          className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
          style={{
            width: 48, height: 48,
            borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink)',
          }}
        >
          <ChevronDown aria-hidden className="h-5 w-5" />
        </button>
      </header>

      {presentation.orderNotice.visible && (
        <p
          data-queue-order-notice="true"
          className="flex-shrink-0 px-4 py-2 text-xs"
          style={{ color: 'var(--oem-ink-2, #b9bec8)', background: 'rgba(255,255,255,0.04)' }}
        >
          {presentation.orderNotice.message}
        </p>
      )}

      {!presentation.available ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-sm"
          style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>
          {presentation.emptyReason}
        </p>
      ) : (
        <ul
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto scrollbar-none px-2 py-2"
          style={{ overscrollBehavior: 'contain' }}
        >
          {presentation.rows.map((row) => (
            <Row
              key={row.entryId}
              row={row}
              canJump={presentation.actions.jump}
              canRemove={presentation.actions.remove}
              canPlayNext={presentation.actions.playNext}
              onJump={onJump}
              onRemove={onRemove}
              onPlayNext={onPlayNext}
            />
          ))}
          {presentation.windowed && (
            <li
              className="px-4 py-3 text-center text-xs"
              style={{ color: 'var(--oem-ink-3, rgba(240,235,224,0.52))' }}
            >
              {presentation.totalCount} parçanın {presentation.windowStart + 1}–
              {presentation.windowStart + presentation.rows.length} arası gösteriliyor
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
