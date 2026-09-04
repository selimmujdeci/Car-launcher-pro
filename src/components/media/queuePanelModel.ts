/**
 * queuePanelModel.ts — F4 · Kuyruk yüzeyi SUNUM modeli (SAF).
 *
 * F3 `PlayQueue` istenen sıranın TEK otoritesidir; bu modül onu yalnız OKUR ve
 * çizilebilir satırlara çevirir. İkinci bir kuyruk deposu KURULMAZ, sıra burada
 * yeniden hesaplanmaz, iyimser (optimistic) kuyruk gerçeği üretilmez.
 *
 * PENCERELEME: uzun kütüphane kuyruğunda binlerce satır render edilmez; geçerli
 * öğe çevresinde sınırlı bir pencere çizilir. Pencere bir GÖSTERİM daraltmasıdır,
 * kuyruğun kendisi DEĞİŞMEZ — bu yüzden satırlar gerçek kuyruk indeksini taşır.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */
import type { QueueAlignment } from '../../platform/media/authority/queueReconciliation';
import type { SourceCapabilities } from '../../platform/media/authority/sourceCapabilities';
import type { DesiredQueue, QueueEntry } from '../../platform/media/session/playQueue';
import type { DrivingMode } from './nowPlayingModel';

/** Bir ekranda çizilen en fazla satır — bounded render maliyeti. */
export const QUEUE_WINDOW_SIZE = 60;
/** Geçerli öğenin üstünde tutulan bağlam satırı sayısı. */
const LOOKBACK = 6;

export interface QueueRow {
  readonly entryId: string;
  /** GERÇEK kuyruk indeksi — pencere içindeki konum DEĞİL (komutlar bunu kullanır). */
  readonly index: number;
  /** Kullanıcıya gösterilen 1 tabanlı sıra. */
  readonly ordinal: number;
  readonly title: string;
  readonly artist: string;
  /** Küçük kapak için kimlik; component kendi başına native fetch yapmaz. */
  readonly artworkIdentity: string | null;
  readonly isCurrent: boolean;
  readonly isUpcoming: boolean;
}

/** Kuyruk yüzeyinde hangi eylem GERÇEKTEN çizilecek. */
export interface QueueActions {
  readonly jump: boolean;
  readonly remove: boolean;
  readonly reorder: boolean;
  readonly playNext: boolean;
}

const NO_ACTIONS: QueueActions = Object.freeze({
  jump: false, remove: false, reorder: false, playNext: false,
});

/** Sıra uyumunun KULLANICI dilindeki karşılığı — teknik terim taşımaz. */
export interface QueueOrderNotice {
  readonly message: string;
  readonly visible: boolean;
}

export interface QueuePanelPresentation {
  readonly available: boolean;
  readonly emptyReason: string | null;
  readonly rows: readonly QueueRow[];
  readonly currentIndex: number;
  readonly totalCount: number;
  /** Pencere kuyruğun tamamını göstermiyorsa kullanıcı bunu BİLMELİDİR. */
  readonly windowed: boolean;
  readonly windowStart: number;
  readonly upcomingCount: number;
  readonly actions: QueueActions;
  readonly orderNotice: QueueOrderNotice;
  readonly sourceLabel: string;
}

export interface QueuePanelInput {
  readonly queue: DesiredQueue;
  readonly capabilities: SourceCapabilities | null;
  readonly alignment: QueueAlignment;
  readonly sourceLabel: string;
  readonly drivingMode: DrivingMode;
  /**
   * Kullanıcı listeyi elle inceliyor mu. `true` ise pencere geçerli öğeye ZORLA
   * geri çekilmez — okurken ayağının altından liste kaymaz.
   */
  readonly userBrowsing: boolean;
  /** Kullanıcı incelerken korunan pencere başlangıcı. */
  readonly browsingWindowStart: number;
}

const EMPTY_PRESENTATION = (reason: string, sourceLabel: string): QueuePanelPresentation =>
  Object.freeze({
    available: false, emptyReason: reason, rows: Object.freeze([] as readonly QueueRow[]),
    currentIndex: -1, totalCount: 0, windowed: false, windowStart: 0, upcomingCount: 0,
    actions: NO_ACTIONS,
    orderNotice: Object.freeze({ message: '', visible: false }),
    sourceLabel,
  });

/**
 * Sağlayıcının GERÇEKTEN sürdüğü sıra ile istenen sıra ayrıştığında kullanıcı
 * uyarılır — aksi hâlde "sıralamam uygulandı" sanır ve beklemediği parça çalar.
 * Uyum doğrulanamıyorsa SESSİZ kalınır (bilinmiyor ≠ hata).
 */
export function orderNoticeFor(alignment: QueueAlignment): QueueOrderNotice {
  switch (alignment) {
    case 'PROVIDER_DRIFT':
      return Object.freeze({ message: 'Bu kaynak sırayı kendi belirliyor', visible: true });
    case 'UNSUPPORTED':
      return Object.freeze({ message: 'Bu kaynakta sıra düzenlenemiyor', visible: true });
    default:
      return Object.freeze({ message: '', visible: false });
  }
}

/**
 * Çizilecek pencerenin başlangıcı.
 *
 * Kullanıcı listeyi inceliyorsa korunan başlangıç kullanılır (auto-follow devre
 * dışı); incelemiyorsa geçerli öğe birkaç satır bağlamla üstte tutulur.
 */
export function windowStartFor(input: {
  readonly total: number; readonly currentIndex: number;
  readonly userBrowsing: boolean; readonly browsingWindowStart: number;
  readonly size?: number;
}): number {
  const size = input.size ?? QUEUE_WINDOW_SIZE;
  if (input.total <= size) return 0;
  const maxStart = input.total - size;
  const raw = input.userBrowsing
    ? input.browsingWindowStart
    : Math.max(0, input.currentIndex) - LOOKBACK;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(0, Math.trunc(raw)), maxStart);
}

/** Kuyruk eylemleri — yetenek YOKSA hiç çizilmez, sürüşte düzenleme kapanır. */
export function queueActionsFor(
  capabilities: SourceCapabilities | null, drivingMode: DrivingMode,
): QueueActions {
  if (!capabilities?.supportsQueue) return NO_ACTIONS;
  const editingAllowed = drivingMode !== 'driving';
  return Object.freeze({
    // Atlama sürüşte de açık: tek dokunuş, düşük dikkat, sık istenen eylem.
    jump: true,
    remove: editingAllowed,
    reorder: editingAllowed,
    playNext: editingAllowed,
  });
}

function rowOf(entry: QueueEntry, index: number, currentIndex: number): QueueRow {
  return Object.freeze({
    entryId: entry.entryId,
    index,
    ordinal: index + 1,
    title: entry.item.title || 'Bilinmeyen parça',
    artist: entry.item.artist || 'Sanatçı bilinmiyor',
    artworkIdentity: entry.item.artworkUri ?? entry.item.uri ?? null,
    isCurrent: index === currentIndex,
    isUpcoming: currentIndex >= 0 && index > currentIndex,
  });
}

export function buildQueuePanelPresentation(input: QueuePanelInput): QueuePanelPresentation {
  const { queue, capabilities, alignment, sourceLabel, drivingMode } = input;
  const total = queue.entries.length;
  if (total === 0) {
    return EMPTY_PRESENTATION('Kuyrukta parça yok.', sourceLabel);
  }

  const currentIndex = queue.currentIndex;
  const start = windowStartFor({
    total, currentIndex,
    userBrowsing: input.userBrowsing,
    browsingWindowStart: input.browsingWindowStart,
  });
  const end = Math.min(total, start + QUEUE_WINDOW_SIZE);

  const rows: QueueRow[] = [];
  for (let i = start; i < end; i += 1) {
    const entry = queue.entries[i];
    if (entry) rows.push(rowOf(entry, i, currentIndex));
  }

  return Object.freeze({
    available: true,
    emptyReason: null,
    rows: Object.freeze(rows),
    currentIndex,
    totalCount: total,
    windowed: total > QUEUE_WINDOW_SIZE,
    windowStart: start,
    upcomingCount: currentIndex >= 0 ? Math.max(0, total - currentIndex - 1) : total,
    actions: queueActionsFor(capabilities, drivingMode),
    orderNotice: orderNoticeFor(alignment),
    sourceLabel,
  });
}
