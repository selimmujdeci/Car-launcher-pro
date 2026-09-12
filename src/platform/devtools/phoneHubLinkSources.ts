/**
 * phoneHubLinkSources.ts — Phone Hub canlı bağlantının TEK okuma noktası (P1-A).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. `await` YOK.
 *  · Native anlık görüntü ÖNBELLEKTEN okunur (pull, ekranın elle YENİLE'siyle).
 *  · Sunucu başlatma/durdurma, bağlanma, eşleştirme, tarama — HİÇBİRİ BURADA YOK.
 *  · Her kaynak AYRI try/catch → biri patlarsa diğerleri okunur.
 *
 * ── NEDEN AYRI BİR KATMAN ───────────────────────────────────────────────────
 * Model saftır ve native'i tanımaz; ekran ise native'i doğrudan okusaydı test
 * edilemez hâle gelirdi. Bu katman ikisinin arasındaki TEK kapıdır: testte
 * burası taklit edilir, üretimde önbelleği okur.
 */

import { getPhoneHubLink, getPhoneHubLinkCachedAt } from '../phoneHub/phoneHubLink';
import type { PhoneHubLinkSnapshotRaw } from '../phoneHub/phoneHubLink';

const ABSENT: PhoneHubLinkSnapshotRaw = Object.freeze({ present: false });

function _safe<T>(fn: () => T, fallback: T): T {
  try {
    const value = fn();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Native anlık görüntüyü önbellekten okur.
 *
 * Okuma patlarsa `present:false` döner — eski bir kanıt taze gibi
 * gösterilmez ve sahte varsayılan üretilmez.
 */
export function readPhoneHubLinkSnapshot(): PhoneHubLinkSnapshotRaw {
  const raw = _safe(() => getPhoneHubLink(), ABSENT);
  return raw && typeof raw === 'object' ? raw : ABSENT;
}

/** Önbelleğin JS damgası (ms). 0 = hiç tazelenmedi. */
export function readPhoneHubLinkCachedAt(): number {
  return _safe(() => getPhoneHubLinkCachedAt(), 0);
}
