/**
 * AdaptivePollingController — Patch 6 (OBD Core v2).
 *
 * Native FAST grup (hız/RPM) poll periyodunu cihaz sınıfı (DeviceTier) + aktif
 * RuntimeMode'un obdPollingMs değerinden türetir. Native taraf karşılığı:
 * OBDManager.setFastPollMs / BleObdManager.setFastPollMs (CarLauncherPlugin.setObdPollProfile).
 *
 * İki rejim:
 *  - NORMAL (PERFORMANCE/BALANCED, obdPollingMs < 5s): FAST grup cihaz sınıfı tabanına
 *    iner (250-1000ms) → hız/RPM düşük gecikmeyle akar. SLOW grup (temp/fuel/throttle/
 *    intake/boost) ve ATRV zaten native tarafta kademeli (5/10 turda bir) sorgulanır;
 *    UI bildirimi ayrıca obdListenerDebounce ile sınırlıdır — hızlı native poll UI
 *    thread'ine yük BİNDİRMEZ (CLAUDE.md §3 Render Control).
 *  - WEAK HEAD UNIT (BASIC_JS/termal/limp, obdPollingMs >= 5s): native poll moda
 *    birebir uyar — zayıf cihaz Capacitor köprü trafiğiyle boğulmaz; ELM327/BT
 *    bağlantı stabilitesi öncelikli kalır.
 *
 * Saf fonksiyon — yan etkisiz, testlenebilir. Native çağrıyı obdService yapar.
 */

import type { DeviceTier } from '../deviceCapabilities';

export interface ObdPollProfile {
  /** Native FAST grup (010D hız / 010C RPM) poll periyodu, ms. Native taban: 100ms. */
  fastMs: number;
  /**
   * UI bildirim tavanı (Hz) — şu an native tarafta yoksayılır (ileride native-taraflı
   * throttling için saklı); JS tarafında obdListenerDebounce zaten aynı işi görür.
   */
  uiHz: number;
}

/** Weak head unit eşiği: RuntimeMode obdPollingMs bu değerin üstündeyse moda uyulur. */
export const WEAK_MODE_THRESHOLD_MS = 5_000;

/** Cihaz sınıfına göre FAST grup taban periyodu (ms). */
const TIER_FAST_MS: Record<DeviceTier, number> = {
  high: 250,   // 4 Hz — modern head unit, BT bant genişliği bol
  mid:  500,   // 2 Hz
  low:  1_000, // 1 Hz — Mali-400 sınıfı (K24) güvenli taban
};

/** Cihaz sınıfına göre UI bildirim tavanı (Hz). */
const TIER_UI_HZ: Record<DeviceTier, number> = {
  high: 10,
  mid:  5,
  low:  2,
};

/**
 * Aktif cihaz sınıfı + RuntimeMode polling değerinden native poll profili üretir.
 *
 * @param tier          getDeviceTier() sonucu
 * @param modePollingMs runtimeManager.getConfig().obdPollingMs — aktif modun OBD periyodu
 */
export function computeObdPollProfile(tier: DeviceTier, modePollingMs: number): ObdPollProfile {
  // Geçersiz/negatif config değeri → native varsayılanına (3s) sabitle (fail-soft).
  if (!Number.isFinite(modePollingMs) || modePollingMs <= 0) {
    return { fastMs: 3_000, uiHz: TIER_UI_HZ[tier] };
  }
  if (modePollingMs >= WEAK_MODE_THRESHOLD_MS) {
    return { fastMs: modePollingMs, uiHz: 1 };
  }
  return { fastMs: TIER_FAST_MS[tier], uiHz: TIER_UI_HZ[tier] };
}
