/**
 * playQueue.ts — F3 · Canonical PlayQueue authority (DESIRED tarafı).
 *
 * Bu modül CarOS'un **istediği** sırayı tutar. Sağlayıcının gerçekten çaldığı sıra
 * BURADA DEĞİLDİR (`ObservedQueue`) ve ikisinin ilişkisi `queueReconciliation`
 * tarafından sınıflandırılır. Desired'ı UI'a "gerçek" diye dayatmak, F0'da
 * kapatılan "UI bir şey gösteriyor, ses başka" kusurunun kuyruk hâlidir.
 *
 * PAZARLIKSIZ SINIRLAR:
 *   · Ses ÜRETMEZ. Native köprüyü ÇAĞIRMAZ. `CarLauncher`/`nativeAuthorityBridge`
 *     importu YOKTUR — çalma yolu yalnız `MediaCommandGateway`'dir.
 *   · Playback truth YAYIMLAMAZ; `CarosPlaybackService` playback truth olarak kalır.
 *   · Kütüphane truth'u ÜRETMEZ; MusicIndex'ten YALNIZ salt-okunur doğrulama okur.
 *   · Desteklenmeyen kuyruk düzenlemesi SAHTE BAŞARI döndürmez → `REJECTED`.
 *   · Bayat (STALE/silinmiş) kütüphane referansı kuyruğa ALINMAZ.
 */

import type { PlayItem } from '../authority/sourceCoordinator';
import {
  getSource, supportsDesignatedItemStart, type SourceClass,
} from '../authority/sourceCapabilities';
import { resolveMusicRef, type MediaRef } from '../musicIndex';
import type { CanonicalMediaIdentity } from './mediaIdentityMatching';

export type QueueEntryOrigin = 'LIBRARY' | 'PROVIDER' | 'RECOVERED';

export interface QueueEntry {
  /** Kuyruk içi kararlı kimlik — aynı parça iki kez eklenebilir, satırlar ayrışır. */
  readonly entryId: string;
  readonly identity: CanonicalMediaIdentity;
  /** Gateway'in çalmak için ihtiyaç duyduğu asgari yük. */
  readonly item: PlayItem;
  readonly origin: QueueEntryOrigin;
  /** Kütüphane kökenli girdiler için doğrulanacak referans. */
  readonly libraryRef: MediaRef | null;
}

export interface DesiredQueue {
  /** Kuyruk kimliği — yeni kuyruk her oluşturulduğunda değişir. */
  readonly queueId: string;
  /** Her mutasyonda artan revizyon (observed ile karşılaştırmanın girdisi). */
  readonly revision: number;
  readonly source: SourceClass | null;
  readonly entries: readonly QueueEntry[];
  readonly currentIndex: number;
}

export type QueueFailureCode =
  | 'unsupported_capability'
  | 'no_active_queue'
  | 'index_out_of_range'
  | 'stale_media_ref'
  | 'empty_input'
  | 'unknown_source';

export type QueueOperationStatus = 'APPLIED' | 'REJECTED' | 'NOOP';

export interface QueueOperationResult {
  readonly status: QueueOperationStatus;
  readonly reason: string;
  readonly failureCode: QueueFailureCode | null;
  /** Reddedilen girdilerin kimlikleri — sessizce düşürme YOKTUR. */
  readonly rejectedEntryIds: readonly string[];
  readonly queue: DesiredQueue;
}

export const EMPTY_DESIRED_QUEUE: DesiredQueue = Object.freeze({
  queueId: '', revision: 0, source: null, entries: Object.freeze([]), currentIndex: -1,
});

let state: DesiredQueue = EMPTY_DESIRED_QUEUE;
let queueSeq = 0;
const subs = new Set<() => void>();

/* ── Kütüphane doğrulama kapısı ───────────────────────────────────────────
 * MusicIndex kütüphane truth'udur. Buradaki tek iş, bir referansın HÂLÂ
 * mevcut olup olmadığını SORMAKTIR; kütüphane durumu burada üretilmez. */
export type LibraryRefValidator = (ref: MediaRef) => boolean;
let validateLibraryRef: LibraryRefValidator = (ref) => resolveMusicRef(ref) !== null;

/** @internal test seam — üretimde doğrulama daima MusicIndex'ten okunur. */
export function _setLibraryRefValidatorForTest(fn: LibraryRefValidator | null): void {
  validateLibraryRef = fn ?? ((ref) => resolveMusicRef(ref) !== null);
}

function notify(): void { subs.forEach((fn) => fn()); }

const commit = (next: Omit<DesiredQueue, 'revision'>): DesiredQueue => {
  state = Object.freeze({ ...next, revision: state.revision + 1, entries: Object.freeze([...next.entries]) });
  notify();
  return state;
};

const ok = (reason: string, rejected: readonly string[] = []): QueueOperationResult =>
  Object.freeze({ status: 'APPLIED', reason, failureCode: null, rejectedEntryIds: Object.freeze([...rejected]), queue: state });

const reject = (failureCode: QueueFailureCode, reason: string, rejected: readonly string[] = []): QueueOperationResult =>
  Object.freeze({ status: 'REJECTED', reason, failureCode, rejectedEntryIds: Object.freeze([...rejected]), queue: state });

const noop = (reason: string): QueueOperationResult =>
  Object.freeze({ status: 'NOOP', reason, failureCode: null, rejectedEntryIds: Object.freeze([]), queue: state });

/**
 * Sağlayıcı çok öğeli kuyruk semantiğini destekliyor mu.
 *
 * Desteklemeyen kaynakta (YouTube iframe · Spotify Connect · harici oturum)
 * "sıraya ekle / yeniden sırala / kuyruk indeksine atla" işlemleri CarOS'un
 * niyetinde tutulup sağlayıcıya uygulanmış gibi GÖSTERİLEMEZ → REDDEDİLİR.
 * `playNow` ve `clear` her kaynakta meşrudur (tek öğe çalma / niyeti bırakma).
 */
function supportsQueueOps(source: SourceClass | null): boolean {
  if (source === null) return false;
  try { return getSource(source).capabilities.supportsQueue === true; } catch { return false; }
}

/**
 * F7.6 · Kuyruk GEZİNMESİ (imleç taşıma) bu kaynakta uygulanabilir mi.
 *
 * ÖLÇÜLEN KUSUR: `setCurrentIndex`/`advance` de `supportsQueueOps`a bağlıydı.
 * O kapı BACKEND'in kendi zaman çizelgesini sorar; YouTube ve Spotify'da
 * (doğru biçimde) `false`tur. Ama imleç taşımanın YÜRÜTMESİ backend kuyruğu
 * DEĞİLDİR: `listeningSessionRuntime` mutasyondan sonra pencereyi
 * `playSource({ startIndex })` ile YENİDEN YAZAR ve adaptör o öğeyi çalar.
 * Yani gezinme bu kaynaklarda GERÇEKTEN uygulanıyordu; kapı yanlış soruyu
 * soruyor ve sağlayıcı kuyruklarını gezilemez yapıyordu.
 *
 * Doğru soru: "bu kaynağa HANGİ öğenin çalacağı söylenebiliyor mu"
 * (`supportsDesignatedItemStart`) — değeri adaptörün ölçülen davranışıdır.
 * Harici Android MediaSession'da `false` kalır: orada `prepare`/`start`
 * gerçekten reddedilir, dolayısıyla gezinme SAHTE BAŞARI olurdu.
 *
 * Kuyruk DÜZENLEMESİ (`playNext` · `addToQueue` · `reorder` · `removeAt`)
 * `supportsQueueOps`ta KALIR — orası sağlayıcının kendi sırasına dair bir
 * iddiadır ve F3 kararı DEĞİŞMEMİŞTİR.
 */
function supportsQueueNavigation(source: SourceClass | null): boolean {
  if (source === null) return false;
  try { return supportsDesignatedItemStart(source); } catch { return false; }
}

/** Kütüphane kökenli girdiler MusicIndex'te HÂLÂ var mı — bayat referans girmez. */
function partitionEntries(entries: readonly QueueEntry[]): { fresh: QueueEntry[]; stale: string[] } {
  const fresh: QueueEntry[] = []; const stale: string[] = [];
  for (const e of entries) {
    if (e.origin === 'LIBRARY' && e.libraryRef !== null && !validateLibraryRef(e.libraryRef)) {
      stale.push(e.entryId);
      continue;
    }
    fresh.push(e);
  }
  return { fresh, stale };
}

const clampIndex = (index: number, length: number): number =>
  length === 0 ? -1 : Math.max(0, Math.min(Math.trunc(index), length - 1));

/* ── Okuma ───────────────────────────────────────────────────────────────── */

export function getDesiredQueue(): DesiredQueue { return state; }
export function subscribeDesiredQueue(listener: () => void): () => void {
  subs.add(listener); return () => subs.delete(listener);
}
export function getCurrentEntry(): QueueEntry | null {
  return state.currentIndex >= 0 ? state.entries[state.currentIndex] ?? null : null;
}
/** Uzlaştırmanın girdisi — içerik değil, yalnız kimlik/indeks/uzunluk. */
export function getDesiredQueueView(): {
  revision: number; length: number; currentIndex: number;
  currentItemId: string | null; source: SourceClass | null;
} | null {
  if (state.entries.length === 0) return null;
  const cur = getCurrentEntry();
  return {
    revision: state.revision, length: state.entries.length, currentIndex: state.currentIndex,
    currentItemId: cur ? cur.item.id : null, source: state.source,
  };
}

/* ── Mutasyonlar ─────────────────────────────────────────────────────────── */

/** Yeni kuyruk kurar. Bayat kütüphane referansları DIŞARIDA bırakılır. */
export function createQueue(
  source: SourceClass, entries: readonly QueueEntry[], startIndex = 0,
): QueueOperationResult {
  let descriptorOk = true;
  try { getSource(source); } catch { descriptorOk = false; }
  if (!descriptorOk) return reject('unknown_source', `Bilinmeyen kaynak: ${String(source)}`);

  const { fresh, stale } = partitionEntries(entries);
  if (fresh.length === 0) {
    return reject('empty_input',
      stale.length ? 'Tüm girdiler bayat kütüphane referansı — kuyruk KURULMADI.' : 'Boş kuyruk kurulamaz.',
      stale);
  }

  /* Başlangıç indeksi bayat girdi düşünce KAYMAMALI: kullanıcı hangi parçaya
     bastıysa o çalmalı. İstenen girdi hâlâ varsa yeni konumu bulunur. */
  const wanted = entries[clampIndex(startIndex, entries.length)];
  const mapped = wanted ? fresh.findIndex((e) => e.entryId === wanted.entryId) : -1;

  queueSeq += 1;
  commit({
    queueId: `queue-${queueSeq}`,
    source,
    entries: fresh,
    currentIndex: mapped >= 0 ? mapped : clampIndex(startIndex, fresh.length),
  });
  return ok(
    stale.length ? `Kuyruk kuruldu; ${stale.length} bayat referans alınmadı.` : 'Kuyruk kuruldu.',
    stale,
  );
}

/** Tek öğeyi şimdi çalınacak konuma alır — her kaynakta meşrudur. */
export function playNow(source: SourceClass, entry: QueueEntry): QueueOperationResult {
  const { fresh, stale } = partitionEntries([entry]);
  if (fresh.length === 0) return reject('stale_media_ref', 'Öğe kütüphanede yok — çalınmaz.', stale);

  if (state.entries.length === 0 || state.source !== source) return createQueue(source, fresh, 0);

  const existing = state.entries.findIndex((e) => e.entryId === entry.entryId);
  if (existing >= 0) {
    commit({ ...state, currentIndex: existing });
    return ok('Mevcut kuyruk öğesine geçildi.');
  }
  const insertAt = Math.max(0, state.currentIndex) + (state.currentIndex >= 0 ? 1 : 0);
  const entries = [...state.entries];
  entries.splice(insertAt, 0, fresh[0]!);
  commit({ ...state, entries, currentIndex: insertAt });
  return ok('Öğe kuyruğa alınıp geçerli konuma getirildi.');
}

/** Geçerli öğeden hemen sonraya ekler — kuyruk yeteneği ŞART. */
export function playNext(entries: readonly QueueEntry[]): QueueOperationResult {
  if (state.entries.length === 0) return reject('no_active_queue', 'Aktif kuyruk yok.');
  if (!supportsQueueOps(state.source)) {
    return reject('unsupported_capability',
      `${state.source} kuyruk düzenlemeyi desteklemiyor — istek UYGULANMADI (sahte başarı yok).`);
  }
  const { fresh, stale } = partitionEntries(entries);
  if (fresh.length === 0) return reject('empty_input', 'Eklenecek geçerli öğe yok.', stale);

  const next = [...state.entries];
  next.splice(Math.max(0, state.currentIndex) + 1, 0, ...fresh);
  commit({ ...state, entries: next });
  return ok(`${fresh.length} öğe sıradakine eklendi.`, stale);
}

/** Kuyruğun sonuna ekler — kuyruk yeteneği ŞART. */
export function addToQueue(entries: readonly QueueEntry[]): QueueOperationResult {
  if (state.entries.length === 0) return reject('no_active_queue', 'Aktif kuyruk yok.');
  if (!supportsQueueOps(state.source)) {
    return reject('unsupported_capability',
      `${state.source} kuyruk düzenlemeyi desteklemiyor — istek UYGULANMADI (sahte başarı yok).`);
  }
  const { fresh, stale } = partitionEntries(entries);
  if (fresh.length === 0) return reject('empty_input', 'Eklenecek geçerli öğe yok.', stale);

  commit({ ...state, entries: [...state.entries, ...fresh] });
  return ok(`${fresh.length} öğe kuyruğa eklendi.`, stale);
}

export function removeAt(index: number): QueueOperationResult {
  if (state.entries.length === 0) return reject('no_active_queue', 'Aktif kuyruk yok.');
  if (!supportsQueueOps(state.source)) {
    return reject('unsupported_capability', `${state.source} kuyruk düzenlemeyi desteklemiyor.`);
  }
  if (!Number.isFinite(index) || index < 0 || index >= state.entries.length) {
    return reject('index_out_of_range', `Geçersiz indeks: ${String(index)}`);
  }
  const entries = state.entries.filter((_, i) => i !== index);
  /* Çalan öğe silinirse indeks AYNI konumda kalır (bir sonraki öğe oraya kayar);
     öncesinden silinirse geriye kaydırılır. Kuyruk boşalırsa indeks -1 olur. */
  const currentIndex = entries.length === 0 ? -1
    : index < state.currentIndex ? state.currentIndex - 1
      : clampIndex(state.currentIndex, entries.length);
  commit({ ...state, entries, currentIndex });
  return ok('Öğe kuyruktan çıkarıldı.');
}

export function reorder(from: number, to: number): QueueOperationResult {
  if (state.entries.length === 0) return reject('no_active_queue', 'Aktif kuyruk yok.');
  if (!supportsQueueOps(state.source)) {
    return reject('unsupported_capability', `${state.source} yeniden sıralamayı desteklemiyor.`);
  }
  const n = state.entries.length;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || from >= n || to < 0 || to >= n) {
    return reject('index_out_of_range', `Geçersiz taşıma: ${String(from)} → ${String(to)}`);
  }
  if (from === to) return noop('Kaynak ve hedef aynı — değişiklik yok.');

  const entries = [...state.entries];
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved!);

  // Çalan öğe kimliğini KORU: yeniden sıralama parça değiştirmez.
  const currentEntryId = getCurrentEntry()?.entryId ?? null;
  const currentIndex = currentEntryId
    ? entries.findIndex((e) => e.entryId === currentEntryId)
    : state.currentIndex;
  commit({ ...state, entries, currentIndex: currentIndex >= 0 ? currentIndex : clampIndex(state.currentIndex, entries.length) });
  return ok('Kuyruk yeniden sıralandı.');
}

export function clearQueue(): QueueOperationResult {
  if (state.entries.length === 0) return noop('Kuyruk zaten boş.');
  commit({ queueId: state.queueId, source: state.source, entries: [], currentIndex: -1 });
  return ok('Kuyruk temizlendi.');
}

/** Kuyruk indeksine atlama — kuyruk yeteneği ŞART. */
export function setCurrentIndex(index: number): QueueOperationResult {
  if (state.entries.length === 0) return reject('no_active_queue', 'Aktif kuyruk yok.');
  if (!supportsQueueNavigation(state.source)) {
    return reject('unsupported_capability',
      `${state.source} belirtilen öğeyi çaldıramıyor — imleç taşınmadı (sahte başarı yok).`);
  }
  if (!Number.isFinite(index) || index < 0 || index >= state.entries.length) {
    return reject('index_out_of_range', `Geçersiz indeks: ${String(index)}`);
  }
  if (index === state.currentIndex) return noop('Zaten bu öğedeyiz.');
  commit({ ...state, currentIndex: index });
  return ok('Kuyruk indeksi değişti.');
}

/** Sıradaki/önceki — sarma YOKTUR; kuyruk sonunda dürüstçe REDDEDİLİR. */
export function advance(direction: 1 | -1): QueueOperationResult {
  if (state.entries.length === 0) return reject('no_active_queue', 'Aktif kuyruk yok.');
  if (!supportsQueueNavigation(state.source)) {
    return reject('unsupported_capability',
      `${state.source} belirtilen öğeyi çaldıramıyor — kuyruk gezinmesi UYGULANMADI.`);
  }
  const next = state.currentIndex + direction;
  if (next < 0) return reject('index_out_of_range', 'Kuyruğun başındayız.');
  if (next >= state.entries.length) return reject('index_out_of_range', 'Kuyruğun sonundayız.');
  commit({ ...state, currentIndex: next });
  return ok(direction === 1 ? 'Sonraki öğe.' : 'Önceki öğe.');
}

/**
 * Kütüphane değiştiğinde (F2 yeniden tarama) kuyruğu yeniden doğrular.
 * Bayat girdiler çıkarılır; çalan öğe düşerse indeks kayar ama kuyruk ÖLMEZ.
 */
export function revalidateQueue(): QueueOperationResult {
  if (state.entries.length === 0) return noop('Kuyruk boş — doğrulanacak bir şey yok.');
  const currentEntryId = getCurrentEntry()?.entryId ?? null;
  const { fresh, stale } = partitionEntries(state.entries);
  if (stale.length === 0) return noop('Tüm kuyruk girdileri hâlâ geçerli.');

  const mapped = currentEntryId ? fresh.findIndex((e) => e.entryId === currentEntryId) : -1;
  commit({
    ...state,
    entries: fresh,
    currentIndex: fresh.length === 0 ? -1 : mapped >= 0 ? mapped : clampIndex(state.currentIndex, fresh.length),
  });
  return ok(`${stale.length} bayat girdi kuyruktan çıkarıldı.`, stale);
}

/** Kurtarmadan gelen kuyruğu geri yükler — ÇALMA İDDİASI ÜRETMEZ. */
export function restoreQueue(
  queueId: string, source: SourceClass, entries: readonly QueueEntry[], currentIndex: number,
): QueueOperationResult {
  const { fresh, stale } = partitionEntries(entries);
  if (fresh.length === 0) {
    return reject('empty_input', 'Geri yüklenecek geçerli kuyruk girdisi kalmadı.', stale);
  }
  const wanted = entries[clampIndex(currentIndex, entries.length)];
  const mapped = wanted ? fresh.findIndex((e) => e.entryId === wanted.entryId) : -1;
  commit({
    queueId: queueId || `queue-restored-${(queueSeq += 1)}`,
    source,
    entries: fresh,
    currentIndex: mapped >= 0 ? mapped : clampIndex(currentIndex, fresh.length),
  });
  return ok(
    stale.length ? `Kuyruk geri yüklendi; ${stale.length} bayat girdi alınmadı.` : 'Kuyruk geri yüklendi.',
    stale,
  );
}

export function _resetPlayQueueForTest(): void {
  state = EMPTY_DESIRED_QUEUE; queueSeq = 0; subs.clear();
  validateLibraryRef = (ref) => resolveMusicRef(ref) !== null;
}
