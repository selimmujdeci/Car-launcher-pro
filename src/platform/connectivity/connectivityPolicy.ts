/**
 * connectivityPolicy.ts — CAROS F7 · operasyon sınıfı → izin kararı (SAF).
 *
 * ── AUTHORITY ≠ POLICY (§15) ────────────────────────────────────────────────
 *   `ConnectivityAuthority`  → "ne doğru?"   (tek gerçek)
 *   `ConnectivityPolicy`     → "bu iş yapılabilir mi?" (operasyona göre)
 *
 * Her servisin kendi `if (state === 'ONLINE')` satırını yazması F7'nin
 * kapatmak istediği borcun ta kendisidir: her online iş AYNI gereksinime
 * sahip DEĞİLDİR. Hafif bir bulut isteği `DEGRADED`de denenebilirken, toplu
 * indirme `ONLINE` + `metered === false` ister.
 *
 * ── TEK BOOLEAN'A GERİ DÖNÜLMEZ ─────────────────────────────────────────────
 * Bu dosya `isOnline()` gibi genel bir bayrak SUNMAZ. Çağıran, işinin
 * GERÇEK ihtiyacını sınıf olarak beyan eder; karar burada verilir.
 */

import type { ConnectivitySnapshot } from './connectivityEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * Operasyon sınıfları
 * ════════════════════════════════════════════════════════════════════════ */

export type ConnectivityOperation =
  /** Yerel ağ/cihaz işi — dış internet GEREKMEZ (ör. Guest Portal, yerel medya). */
  | 'LOCAL_ONLY_OPERATION'
  /** Küçük, tekrar denenebilir bulut isteği — belirsizlikte DENEMEYE değer. */
  | 'LIGHTWEIGHT_INTERNET'
  /** Kullanıcının beklediği etkileşimli bulut çağrısı (AI, arama, STT). */
  | 'CLOUD_INTERACTIVE'
  /** Sürekli akış (canlı ses/veri) — kararsız yolda başlatılmaz. */
  | 'REALTIME_STREAM'
  /** Arka plan senkronizasyonu — kullanıcı beklemiyor. */
  | 'BACKGROUND_SYNC'
  /** Toplu transfer (harita paketi, OTA) — maliyet kanıtı ŞART. */
  | 'BULK_TRANSFER';

export type ConnectivityDenialReason =
  | 'state_unknown'
  | 'offline'
  | 'no_internet_path'
  | 'captive_portal'
  | 'validation_insufficient'
  | 'metered_or_unknown_cost';

export type ConnectivityDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ConnectivityDenialReason };

const ALLOW: ConnectivityDecision = Object.freeze({ allowed: true });

function deny(reason: ConnectivityDenialReason): ConnectivityDecision {
  return Object.freeze({ allowed: false, reason });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karar
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Operasyonun şu anki bağlantı gerçeğiyle yapılabilir olup olmadığı. SAF.
 *
 * ── YEREL İŞ İNTERNETE BAĞLI DEĞİLDİR (§29/§32) ─────────────────────────────
 * `LOCAL_ONLY_OPERATION` her durumda izinlidir: Guest Music portalı, yerel
 * çalma ve yerel Mavi komutları internet YOKKEN de çalışmalıdır. "İnternet
 * yok" ile "yerel ağ yok" AYNI ŞEY DEĞİLDİR.
 *
 * ── BELİRSİZLİK HERKESİ DURDURMAZ ───────────────────────────────────────────
 * `UNKNOWN`/`DEGRADED` mutlak bir engel değildir: geri çekilebilir işler
 * denenip kendi hatalarıyla geri düşebilir (mevcut kuyruk/backoff davranışı
 * korunur). Yalnız pahalı TAAHHÜTLER (canlı akış, toplu transfer) kanıt ister.
 * Bu, migrasyonun mevcut davranışı bozmamasının da anahtarıdır (§37).
 *
 * ── MALİYET FAIL-CLOSED (§17) ───────────────────────────────────────────────
 * `metered === null` ÜCRETSİZ SAYILMAZ. Toplu transfer yalnız açıkça
 * ölçülü-DEĞİL bir yolda izinlidir.
 */
export function canUseConnectivity(
  operation: ConnectivityOperation,
  snapshot: ConnectivitySnapshot,
): ConnectivityDecision {
  /* Yerel iş: dış internet gerçeğinden BAĞIMSIZ. */
  if (operation === 'LOCAL_ONLY_OPERATION') return ALLOW;

  switch (snapshot.state) {
    case 'OFFLINE':
      return deny('offline');
    case 'LOCAL_ONLY':
      return deny('no_internet_path');
    case 'CAPTIVE':
      /* Giriş sayfası internet değildir — hiçbir dış iş denenmez. */
      return deny('captive_portal');
    case 'UNKNOWN':
      /*
       * Kanıt YOK — ama "bilmiyoruz" ile "yok" AYNI ŞEY DEĞİLDİR.
       *
       * ── MİGRASYON GÜVENLİĞİ (§37) ─────────────────────────────────────
       * Migrasyondan önceki tüm tüketiciler YALNIZ `navigator.onLine === false`
       * iken işi atlıyordu; belirsizlikte DENİYORLARDI. `UNKNOWN`da etkileşimli
       * bulut işini bloklamak, native gözlemcinin hiç bağlanmadığı bir ROM'da
       * (kanıt yalnız tarayıcı ipucu → hüküm `UNKNOWN`) AI/STT'yi tamamen
       * öldürürdü. Bu yüzden geri çekilebilir işler `UNKNOWN`da DENENİR ve
       * kendi hatalarıyla geri düşer — mevcut davranış KORUNUR.
       *
       * Pahalı TAAHHÜTLER (canlı akış, toplu transfer) ise kanıtsız
       * başlatılmaz: bunların başarısızlığı ucuz değildir.
       */
      return operation === 'REALTIME_STREAM' || operation === 'BULK_TRANSFER'
        ? deny('state_unknown')
        : ALLOW;
    case 'DEGRADED':
      /* Yol var, doğrulama zayıf: akış ve toplu transfer BAŞLATILMAZ. */
      if (operation === 'REALTIME_STREAM' || operation === 'BULK_TRANSFER') {
        return deny('validation_insufficient');
      }
      return ALLOW;
    case 'ONLINE':
      break;
    default:
      return deny('state_unknown');
  }

  /* ONLINE — geriye yalnız maliyet kapısı kalır. */
  if (operation === 'BULK_TRANSFER' && snapshot.metered !== false) {
    return deny('metered_or_unknown_cost');
  }
  return ALLOW;
}

/** Kısa yardımcı — çağıran yalnız evet/hayır istiyorsa. */
export function isConnectivityAllowed(
  operation: ConnectivityOperation, snapshot: ConnectivitySnapshot,
): boolean {
  return canUseConnectivity(operation, snapshot).allowed;
}
