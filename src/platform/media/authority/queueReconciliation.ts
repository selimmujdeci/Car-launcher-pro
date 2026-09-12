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

/* ══════════════════════════════════════════════════════════════════════════
 * F3 · DESIRED ↔ OBSERVED HİZALAMASI
 *
 * `reconcileQueue` yukarıda revizyon/indeks/uzunluk sapmasını sınıflandırır.
 * F3 bir kavram DAHA ekler: CarOS'un İSTEDİĞİ sıra (`DesiredQueue`) ile
 * sağlayıcının GERÇEKTEN bildirdiği sıranın ÖĞE ÖĞE ilişkisi.
 *
 * Neden ayrı: sağlayıcı kuyruk düzenlemeyi hiç desteklemeyebilir. O durumda
 * "sapma var" demek yanlıştır — sapma değil, YETENEK YOKLUĞUdur; ve CarOS'un
 * istediği sırayı sağlayıcıya uygulanmış gibi göstermek YASAKTIR.
 * ════════════════════════════════════════════════════════════════════════ */

export type QueueAlignment =
  /** İstenen ve gözlenen sıra birebir aynı. */
  | 'MATCHED'
  /** Gözlenen sıra, istenenin bir ÖN EKİ (pencere yazımı — beklenen durum). */
  | 'PREFIX_MATCH'
  /** Sağlayıcı farklı bir sıra sürüyor (dışarıdan değişmiş olabilir). */
  | 'PROVIDER_DRIFT'
  /** Sağlayıcı çok öğeli kuyruk semantiğini hiç desteklemiyor. */
  | 'UNSUPPORTED'
  /** Gözlem yok — "uyumlu" DEĞİL, bilinmiyor. */
  | 'UNKNOWN';

export const QUEUE_ALIGNMENT_LABEL: Readonly<Record<QueueAlignment, string>> = {
  MATCHED: 'BİREBİR',
  PREFIX_MATCH: 'ÖN EK EŞLEŞMESİ',
  PROVIDER_DRIFT: 'SAĞLAYICI SAPMASI',
  UNSUPPORTED: 'SAĞLAYICI KUYRUK DESTEKLEMİYOR',
  UNKNOWN: 'KARŞILAŞTIRILAMADI',
} as const;

export interface QueueAlignmentResult {
  readonly alignment: QueueAlignment;
  readonly reason: string;
  /** Baştan itibaren kaç öğe birebir tuttu. */
  readonly matchedPrefixLength: number;
  readonly desiredLength: number;
  readonly observedLength: number;
  /** İstenen sıra sağlayıcıya UYGULANMIŞ sayılabilir mi (UI iddiası bundan çıkar). */
  readonly desiredApplied: boolean;
}

const alignmentResult = (
  alignment: QueueAlignment, reason: string,
  matchedPrefixLength: number, desiredLength: number, observedLength: number,
  desiredApplied: boolean,
): QueueAlignmentResult => Object.freeze({
  alignment, reason, matchedPrefixLength, desiredLength, observedLength, desiredApplied,
});

/**
 * İstenen kuyruk kimlik dizisini gözlenenle karşılaştırır.
 *
 * @param desiredIds  CarOS'un istediği sıra (öğe kimlikleri)
 * @param observedIds Sağlayıcının bildirdiği sıra; `null` = görünürlük YOK
 * @param supportsQueue Sağlayıcı çok öğeli kuyruk semantiğini destekliyor mu
 */
export function alignDesiredObserved(
  desiredIds: readonly string[],
  observedIds: readonly string[] | null,
  supportsQueue: boolean,
): QueueAlignmentResult {
  if (!supportsQueue) {
    return alignmentResult('UNSUPPORTED',
      'Sağlayıcı çok öğeli kuyruk semantiğini desteklemiyor — istenen sıra ONA UYGULANMADI.',
      0, desiredIds.length, observedIds?.length ?? 0, false);
  }
  if (observedIds === null) {
    return alignmentResult('UNKNOWN',
      'Sağlayıcı kuyruk görünürlüğü yok — istenen sıranın uygulandığı DOĞRULANAMAZ.',
      0, desiredIds.length, 0, false);
  }
  if (desiredIds.length === 0 && observedIds.length === 0) {
    return alignmentResult('MATCHED', 'İki taraf da boş.', 0, 0, 0, true);
  }

  let prefix = 0;
  const limit = Math.min(desiredIds.length, observedIds.length);
  while (prefix < limit && desiredIds[prefix] === observedIds[prefix]) prefix += 1;

  if (prefix === desiredIds.length && prefix === observedIds.length) {
    return alignmentResult('MATCHED', 'İstenen ve gözlenen sıra birebir aynı.',
      prefix, desiredIds.length, observedIds.length, true);
  }
  /* Pencere yazımı: yerel kütüphanede native'e kuyruğun tamamı değil, aktif
     parça çevresindeki pencere yazılır. Gözlenen, istenenin ön ekiyse bu bir
     sapma DEĞİL, bilinen ve kabul edilen bir daraltmadır. */
  if (prefix === observedIds.length && observedIds.length > 0) {
    return alignmentResult('PREFIX_MATCH',
      `Gözlenen sıra istenenin ilk ${prefix} öğesi — pencere yazımı.`,
      prefix, desiredIds.length, observedIds.length, true);
  }
  return alignmentResult('PROVIDER_DRIFT',
    prefix === 0
      ? 'Sağlayıcı ilk öğeden itibaren farklı bir sıra sürüyor.'
      : `Sıra ${prefix}. öğeden sonra ayrışıyor.`,
    prefix, desiredIds.length, observedIds.length, false);
}

/** Sağlayıcı sırası kullanıcıya yanlış gösterilme riski taşıyor mu. */
export function isMisleadingAlignment(alignment: QueueAlignment): boolean {
  return alignment === 'PROVIDER_DRIFT' || alignment === 'UNSUPPORTED';
}

/** Sapma kullanıcıya yansıyacak türden mi (yanlış parça çalma riski). */
export function isUserVisibleDrift(drift: QueueDrift): boolean {
  return drift === 'INDEX_DRIFT'
    || drift === 'ITEM_MISMATCH'
    || drift === 'ITEM_UNAVAILABLE'
    || drift === 'SOURCE_MISMATCH';
}
