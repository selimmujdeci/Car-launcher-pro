/**
 * connectivityGate.ts — CAROS F7 · tüketiciler için TEK satırlık kanonik kapı.
 *
 * ── NEDEN AYRI BİR DOSYA ────────────────────────────────────────────────────
 * 55 tüketicinin her birine "snapshot al + policy çağır" iki satırı yazmak,
 * zamanla yine kopyalanmış karar mantığı doğurur. Bu dosya o iki adımı TEK
 * çağrıya indirir — ama bir soyutlama KATMANI DEĞİLDİR: kararı hâlâ SAF
 * `canUseConnectivity()` verir, gerçeği hâlâ `ConnectivityAuthority` tutar.
 *
 * ── TEK BOOLEAN'A GERİ DÖNÜŞ DEĞİL ──────────────────────────────────────────
 * Burada `isOnline()` YOKTUR. Çağıran işinin GERÇEK sınıfını beyan etmek
 * ZORUNDADIR; "internet var mı" diye genel bir soru sorulamaz.
 */

import { getConnectivitySnapshot } from './connectivityAuthority';
import {
  canUseConnectivity, type ConnectivityDecision, type ConnectivityOperation,
} from './connectivityPolicy';

/**
 * Bu operasyon ŞU AN yapılabilir mi? Kanonik gerçeği okur, saf politikayı
 * uygular. O(1), yan etkisiz.
 */
export function allowsConnectivity(operation: ConnectivityOperation): boolean {
  return canUseConnectivity(operation, getConnectivitySnapshot()).allowed;
}

/** Gerekçesiyle birlikte karar (log/teşhis için). */
export function decideConnectivity(
  operation: ConnectivityOperation,
): ConnectivityDecision {
  return canUseConnectivity(operation, getConnectivitySnapshot());
}

/**
 * GÖZLEM projeksiyonu — **KARAR DEĞİLDİR**.
 *
 * Teşhis defterleri, LAB satırları ve saha kanıt kayıtları "o an internet
 * erişilebilir görünüyor muydu" sorusunu üçlü mantıkla saklar. Bu fonksiyon
 * SADECE o kaydı üretir; hiçbir çağrı yolu bununla kapatılmaz.
 *
 * · `null`  = ÖLÇÜLMEDİ (`UNKNOWN`) — sahte `false` YAZILMAZ (CLAUDE.md §8).
 * · `false` = OFFLINE / LOCAL_ONLY / CAPTIVE — kullanılabilir dış yol YOK.
 * · `true`  = ONLINE / DEGRADED — yol var (başarı GARANTİSİ değil, §27).
 *
 * ⚠️ Bir işi yapıp yapmamaya karar veriyorsan bu DEĞİL, `allowsConnectivity()`
 * kullanılır: her operasyonun ihtiyacı aynı değildir (§4/§19).
 */
export function observedInternetReachability(): boolean | null {
  const { state } = getConnectivitySnapshot();
  if (state === 'UNKNOWN') return null;
  return state === 'ONLINE' || state === 'DEGRADED';
}
