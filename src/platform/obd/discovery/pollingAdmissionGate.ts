/**
 * pollingAdmissionGate — P0 Deep PID/DID Explorer Faz-1 · POLLING GÜVENLİĞİ (§E, SAF).
 *
 * AMAÇ: yeni keşfedilen bir PID/DID'in canlı polling'e katılma HIZINI/ÖNCELİĞİNİ önerir
 * ve kabul (admission) kararı verir. Çekirdek telemetri (RPM/hız/SAFETY PID'leri) HER ZAMAN
 * önceliklidir — bu modül asla FAST sınıfı ÖNERMEZ (yeni/doğrulanmamış veri çekirdek
 * kadansını bozamaz); yalnız VERIFIED adaylar SLOW/ON_DEMAND alır, gerisi DISCOVERY_ONLY'de
 * kalır (yalnız keşif turunda sorgulanır, sürekli polling'e GİRMEZ).
 *
 * SAF: I/O yok — tam test edilebilir.
 */

import type { ProtocolClass } from '../protocolProfile';
import type { DiscoveryStatus } from './discoveryState';
import { isAutoAddEligible } from './discoveryState';

export type PollClass = 'FAST' | 'NORMAL' | 'SLOW' | 'ON_DEMAND' | 'DISCOVERY_ONLY';

/**
 * Bir aday için önerilen poll sınıfı. `FAST` bu kapıdan ASLA çıkmaz (çekirdek PID'lere
 * ayrılmış — keşif katmanının dokunamayacağı sınıf). KWP/ISO9141 (yavaş seri) varsayılan
 * ON_DEMAND'e düşer (sürekli poll hattı boğulmasın); CAN'de SLOW kabul edilir.
 */
export function recommendPollClass(input: {
  status: DiscoveryStatus;
  protocolClass: ProtocolClass;
}): PollClass {
  if (!isAutoAddEligible(input.status)) return 'DISCOVERY_ONLY';
  return input.protocolClass === 'kwp' || input.protocolClass === 'iso9141' ? 'ON_DEMAND' : 'SLOW';
}

export interface AdmissionInput {
  /** Şu an aktif yeni-keşfedilmiş DID poll sayısı. */
  activeDiscoveryDidCount: number;
  /** Aynı anda kabul edilebilecek azami yeni DID sayısı. */
  maxConcurrentNewDids: number;
  /** Çağıran çekirdek poll bütçesinin (RPM/hız/SAFETY) BOZULMADIĞINI onaylar. */
  corePollingBudgetOk: boolean;
}

/** Yeni bir DID'in canlı poll listesine kabul edilip edilemeyeceği (bounded, çekirdek-öncelikli). */
export function canAdmitNewDidPoll(input: AdmissionInput): boolean {
  return input.corePollingBudgetOk === true
    && input.activeDiscoveryDidCount < input.maxConcurrentNewDids;
}

export const DEFAULT_MAX_CONCURRENT_NEW_DIDS = 3;
