/**
 * queueReconciliation.ts — MÜZİK HUB PAKET A · Kuyruk gerçeğinin uzlaştırılması (SAF).
 *
 * SORUN: UI'ın bildiği kuyruk (`carosMediaLayer._queue`) ile native timeline
 * (ExoPlayer MediaItem listesi) iki AYRI gerçekti. Biri "3. parça çalıyor" derken
 * diğeri başka parçada olabiliyordu ve hiçbir katman bunu FARK ETMİYORDU; kullanıcı
 * "sonraki"ye basınca beklemediği parçaya atlıyordu.
 *
 * BU MODÜL: iki tarafın revizyon + indeks + uzunluk bilgisini karşılaştırır ve
 * sapmayı TİPLİ olarak sınıflandırır. Hiçbir şeyi DÜZELTMEZ (bu pakette otomatik
 * senkronizasyon YOK) — sapmayı GÖRÜNÜR kılar; düzeltme kararı üst katmanındır.
 *
 * DÜRÜSTLÜK: karşılaştırılamayan durum "uyumlu" sayılmaz → `UNKNOWN`. Native
 * otorite yokken "senkron" DENMEZ.
 *
 * SAFLIK: I/O · timer · Date.now · global durum · React importu YOKTUR.
 */

import type { SourceClass } from './sourceCapabilities';

/** Kuyruğun bir taraftaki (UI veya native) gözlenen kimliği. */
export interface QueueView {
  /** Her kuyruk yazımında artan revizyon. */
  readonly revision: number;
  readonly length: number;
  readonly currentIndex: number;
  /** Bu görünümün ait olduğu kaynak (null = bilinmiyor). */
  readonly source: SourceClass | null;
  /** Geçerli öğenin kimliği — yoksa null (uydurma kimlik ÜRETİLMEZ). */
  readonly currentItemId: string | null;
}

export type QueueDrift =
  /** İki taraf aynı gerçeği gösteriyor. */
  | 'IN_SYNC'
  /** Karşılaştırma yapılamadı (otorite yok / veri eksik) — "uyumlu" DEĞİL. */
  | 'UNKNOWN'
  /** UI daha yeni bir kuyruk yazmış; native henüz uygulamamış. */
  | 'UI_AHEAD'
  /** Native daha yeni (ör. bildirimden "sonraki"ye basıldı, UI duymadı). */
  | 'NATIVE_AHEAD'
  /** Aynı revizyon ama indeksler farklı. */
  | 'INDEX_DRIFT'
  /** Aynı revizyon ama uzunluklar farklı. */
  | 'LENGTH_DRIFT'
  /** İki taraf farklı kaynak sınıfı gösteriyor — devir yarım kalmış olabilir. */
  | 'SOURCE_MISMATCH'
  /** Geçerli öğe kimlikleri çelişiyor. */
  | 'ITEM_MISMATCH'
  /** Native kuyruk boşalmış ama UI hâlâ kuyruk olduğunu sanıyor. */
  | 'ITEM_UNAVAILABLE';

export const QUEUE_DRIFT_LABEL: Readonly<Record<QueueDrift, string>> = {
  IN_SYNC: 'UYUMLU',
  UNKNOWN: 'KARŞILAŞTIRILAMADI',
  UI_AHEAD: 'UI İLERİDE',
  NATIVE_AHEAD: 'NATIVE İLERİDE',
  INDEX_DRIFT: 'İNDEKS SAPMASI',
  LENGTH_DRIFT: 'UZUNLUK SAPMASI',
  SOURCE_MISMATCH: 'KAYNAK ÇELİŞKİSİ',
  ITEM_MISMATCH: 'ÖĞE ÇELİŞKİSİ',
  ITEM_UNAVAILABLE: 'NATIVE KUYRUK BOŞ',
} as const;

export interface ReconciliationResult {
  readonly drift: QueueDrift;
  /** Hangi tarafın gerçeği esas alınmalı — sapma varsa native TİMELİNE esastır. */
  readonly authoritative: 'native' | 'ui' | 'none';
  readonly reason: string;
}

function isUsable(v: QueueView | null): v is QueueView {
  return !!v
    && Number.isFinite(v.revision)
    && Number.isFinite(v.length)
    && Number.isFinite(v.currentIndex);
}

/**
 * İki görünümü uzlaştırır. Sapma varsa NATIVE esastır: ses fiilen orada
 * üretiliyor, dolayısıyla kullanıcının duyduğu gerçek odur.
 *
 * @param ui     UI'ın bildiği kuyruk (yoksa null)
 * @param native Native timeline görünümü (otorite yoksa null)
 */
export function reconcileQueue(
  ui: QueueView | null,
  native: QueueView | null,
): ReconciliationResult {
  if (!isUsable(native)) {
    return {
      drift: 'UNKNOWN',
      authoritative: 'none',
      reason: 'Native timeline okunamadı — kuyruk gerçeği BİLİNMİYOR.',
    };
  }
  if (!isUsable(ui)) {
    return {
      drift: 'UNKNOWN',
      authoritative: 'native',
      reason: 'UI kuyruğu okunamadı — yalnız native timeline biliniyor.',
    };
  }

  if (native.length === 0 && ui.length > 0) {
    return {
      drift: 'ITEM_UNAVAILABLE',
      authoritative: 'native',
      reason: 'Native kuyruk boş ama UI dolu kuyruk gösteriyor.',
    };
  }

  if (ui.source && native.source && ui.source !== native.source) {
    return {
      drift: 'SOURCE_MISMATCH',
      authoritative: 'native',
      reason: `UI ${ui.source}, native ${native.source} gösteriyor — devir yarım kalmış olabilir.`,
    };
  }

  if (ui.revision > native.revision) {
    return {
      drift: 'UI_AHEAD',
      authoritative: 'native',
      reason: `UI revizyonu (${ui.revision}) native'den (${native.revision}) ileride — yazım henüz uygulanmadı.`,
    };
  }
  if (native.revision > ui.revision) {
    return {
      drift: 'NATIVE_AHEAD',
      authoritative: 'native',
      reason: `Native revizyon (${native.revision}) UI'dan (${ui.revision}) ileride — dışarıdan (bildirim/medya tuşu) değişmiş olabilir.`,
    };
  }

  if (ui.length !== native.length) {
    return {
      drift: 'LENGTH_DRIFT',
      authoritative: 'native',
      reason: `Aynı revizyonda uzunluklar farklı (UI ${ui.length}, native ${native.length}).`,
    };
  }

  if (
    ui.currentItemId !== null && native.currentItemId !== null
    && ui.currentItemId !== native.currentItemId
  ) {
    return {
      drift: 'ITEM_MISMATCH',
      authoritative: 'native',
      reason: 'Aynı revizyonda geçerli öğe kimlikleri çelişiyor.',
    };
  }

  if (ui.currentIndex !== native.currentIndex) {
    return {
      drift: 'INDEX_DRIFT',
      authoritative: 'native',
      reason: `Aynı revizyonda indeksler farklı (UI ${ui.currentIndex}, native ${native.currentIndex}).`,
    };
  }

  return {
    drift: 'IN_SYNC',
    authoritative: 'native',
    reason: 'Revizyon, uzunluk ve indeks uyuşuyor.',
  };
}

/** Sapma kullanıcıya yansıyacak türden mi (yanlış parça çalma riski). */
export function isUserVisibleDrift(drift: QueueDrift): boolean {
  return drift === 'INDEX_DRIFT'
    || drift === 'ITEM_MISMATCH'
    || drift === 'ITEM_UNAVAILABLE'
    || drift === 'SOURCE_MISMATCH';
}
