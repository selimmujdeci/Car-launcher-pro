/**
 * maviContextSources — bağlam kaynaklarının GERÇEK bağlaması (concrete binding).
 *
 * Saf collector bu dosyayı import ETMEZ; somut servis bağımlılıkları burada
 * izole kalır. TÜM okumalar SALT-OKUNUR anlık görüntülerdir:
 *   - `getOBDDataSnapshot()`      → bellek-içi son snapshot (yeni PID sorgusu YOK)
 *   - `getActiveProtocolClass()`  → aktif protokol sınıfı (enum)
 *   - `getTransportStats()`       → son kopma nedeni (hata KODU) + link sayaçları
 *   - `getObdFreshWindowMs()`     → uygulamanın KENDİ tazelik penceresi
 *   - `onDTCState` tek-seferlik   → son DTC durumu (mevcut senkron son-değer
 *                                    yakalama deseni; yeni abonelik BIRAKILMAZ)
 *
 * Yeni polling/timer/abonelik/OBD komutu OLUŞTURULMAZ.
 */

import { getOBDDataSnapshot, getObdFreshWindowMs, getTransportStats } from '../../../obdService';
import { getActiveProtocolClass } from '../../../obd/activeProtocol';
import { onDTCState } from '../../../dtcService';
import type {
  ContextSources,
  DtcContextSnapshot,
  ObdContextSnapshot,
  ObdSessionSnapshot,
} from '../contextCollector';

/** OBD anlık görüntüsü → collector şekli (ham nesne dışarı taşınmaz). */
function readObd(): ObdContextSnapshot | undefined {
  const d = getOBDDataSnapshot();
  if (!d || typeof d !== 'object') return undefined;
  return {
    // `transportConnected` link gerçeğidir; `connectionState` dört gerçeği tek
    // alana sıkıştırdığı için bağlam için KULLANILMAZ.
    connected:      d.transportConnected === true,
    source:         d.source,
    vehicleType:    d.vehicleType,
    lastSeenMs:     d.lastSeenMs,
    rpm:            d.rpm,
    speed:          d.speed,
    engineTemp:     d.engineTemp,
    fuelLevel:      d.fuelLevel,
    ...(d.batteryVoltage !== undefined ? { batteryVoltage: d.batteryVoltage } : {}),
  };
}

/** Oturum sağlığı: `dataFresh` + transport durumundan TÜRETİLİR (uydurma yok). */
function readSession(): ObdSessionSnapshot | undefined {
  const out: Record<string, unknown> = {};

  try {
    const protocolClass = getActiveProtocolClass();
    if (protocolClass) out['protocolClass'] = protocolClass;
  } catch { /* protokol bilinmiyor → alan yok */ }

  try {
    const d = getOBDDataSnapshot();
    if (d && typeof d === 'object') {
      out['sourceHealth'] = d.transportConnected !== true ? 'unavailable'
                          : d.dataFresh === false        ? 'degraded'
                          : 'healthy';
    }
  } catch { /* sağlık bilinmiyor → alan yok */ }

  try {
    const stats = getTransportStats();
    if (stats && typeof stats.lastDisconnectReason === 'string' && stats.lastDisconnectReason) {
      out['lastDisconnectReason'] = stats.lastDisconnectReason;   // hata KODU (serbest metin değil)
    }
  } catch { /* neden bilinmiyor → alan yok */ }

  return Object.keys(out).length > 0 ? out as ObdSessionSnapshot : undefined;
}

/**
 * DTC son durumu — mevcut SENKRON son-değer yakalama deseni (companionContext
 * ile aynı): abone ol, anlık değeri al, HEMEN çık. Kalıcı abonelik BIRAKILMAZ.
 */
function readDtc(): DtcContextSnapshot | undefined {
  let snapshot: DtcContextSnapshot | undefined;
  try {
    const unsub = onDTCState((s) => {
      snapshot = {
        codes:      (s.codes ?? []).map((c) => c.code),
        lastReadAt: s.lastReadAt,
        isStale:    s.isStale === true,
      };
    });
    unsub();
  } catch { return undefined; }
  return snapshot;
}

/** Üretim kaynak seti — tamamı salt-okunur ve fail-soft. */
export function createMaviContextSources(): ContextSources {
  return {
    readObd,
    readSession,
    readDtc,
    freshWindowMs: () => getObdFreshWindowMs(),
  };
}
