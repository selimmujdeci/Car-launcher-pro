/**
 * recoverySources.ts — MUSIC F21 · Süreklilik kanıtlarının TEK okuma katmanı.
 *
 * Desen A3–A8 · F8 · F17 ile birebir aynıdır: senkron getter'lar, her biri
 * kendi try/catch'i içinde, hiçbir şey başlatmaz, timer kurmaz, komut göndermez.
 *
 * OTORİTE SINIRI (Cross-Domain §2 · §10): buradaki hiçbir değer BURADA
 * üretilmez. Araç sinyalleri `UnifiedVehicleStore`un, oturum `ListeningSession`ın,
 * oynatma gerçeği kanonik native snapshot'ın truth'udur; bu modül YALNIZ okur.
 *
 * GİZLİLİK: parça adı · sanatçı · URI · konum BU KATMANDAN GEÇMEZ.
 */

import { useUnifiedVehicleStore } from '../../vehicleDataLayer/UnifiedVehicleStore';
import { getListeningSession } from '../session/listeningSession';
import { getDesiredQueue } from '../session/playQueue';
import { getMusicCanonicalSnapshot } from '../authority/musicCanonicalSnapshot';
import type { IgnitionEvidence } from './recoveryModel';

/**
 * Kontak kapalı sayılan gerilim eşiği — OBD `linkLossLedger` ile AYNI değer.
 *
 * Burada YENİ bir eşik icat EDİLMEZ: aynı gerçeğe iki farklı sayı vermek
 * ikinci bir otorite kurmak olurdu.
 */
export const IGNITION_OFF_VOLTAGE = 13.0;

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined ? fallback : v;
  } catch { return fallback; }
}

/**
 * Kontak kanıtı — **UYDURULMAZ.**
 *
 * Ölçülebilen tek gerçek kaynak araç elektriğidir: motor devri (RPM > 0) ya da
 * akü gerilimi. OBD bağlı değilse ikisi de yoktur → `UNKNOWN`. CarOS'ta
 * ayrı bir "ignition" hattı YOKTUR ve varmış gibi davranılmaz.
 */
export function readIgnitionEvidence(): IgnitionEvidence {
  return safe<IgnitionEvidence>(() => {
    const s = useUnifiedVehicleStore.getState();

    const rpm = typeof s.rpm === 'number' && Number.isFinite(s.rpm) ? s.rpm : null;
    if (rpm !== null && rpm > 0) return 'RUNNING';

    const volt = typeof s.canBatteryVolt === 'number' && Number.isFinite(s.canBatteryVolt)
      ? s.canBatteryVolt : null;
    if (volt !== null) return volt >= IGNITION_OFF_VOLTAGE ? 'RUNNING' : 'OFF';

    /* RPM 0 ölçüldüyse motor durmuştur ama kontak açık olabilir → belirsiz. */
    return 'UNKNOWN';
  }, 'UNKNOWN');
}

/** Ağ erişimi — ölçülemiyorsa `false` (fail-closed: çevrimdışı varsayılır). */
export function readOnline(): boolean {
  return safe<boolean>(
    () => (typeof navigator === 'undefined' ? false : navigator.onLine === true),
    false,
  );
}

/** Kullanıcı AÇIKÇA duraklattı mı — niyet korunur. */
export function readUserPaused(): boolean {
  return safe<boolean>(() => getMusicCanonicalSnapshot().userPaused === true, false);
}

/** Oturum bir KAYITTAN geri yüklendi mi (canlı gözlem DEĞİL). */
export function readSessionRestored(): boolean {
  return safe<boolean>(() => getListeningSession()?.restored === true, false);
}

export interface QueueRecoveryReading {
  readonly entries: number;
  readonly source: string | null;
  /** Kaynağın çalması için ağ gerekiyor mu. */
  readonly requiresNetwork: boolean;
}

/** Ağ gerektiren kaynak sınıfları — yerel dosya çevrimdışı da çalar. */
const NETWORK_SOURCES: readonly string[] = Object.freeze([
  'YOUTUBE', 'SPOTIFY', 'STREAM', 'INTERNET_RADIO',
]);

export function readQueueRecovery(): QueueRecoveryReading {
  return safe<QueueRecoveryReading>(() => {
    const q = getDesiredQueue();
    const source = q.source ?? null;
    return Object.freeze({
      entries: q.entries.length,
      source,
      requiresNetwork: source !== null && NETWORK_SOURCES.includes(source),
    });
  }, Object.freeze({ entries: 0, source: null, requiresNetwork: false }));
}
