/**
 * discoveryCapabilitySources — CAROS LAB · Keşif / Yetenek TEK okuma katmanı.
 *
 * Desen mevcut LAB turlarıyla AYNI: senkron getter'lar, her biri kendi
 * try/catch'i içinde. **HİÇBİR ŞEY BAŞLATMAZ**: keşif turu tetiklemez, PDU
 * göndermez, oturum açmaz, timer kurmaz, ağa çıkmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * ECU başlıkları teknik adrestir ve LAB'da zaten gösterilir (mevcut karar);
 * ham yanıt gövdesi, VIN ve konum bu katmandan GEÇMEZ.
 */

import {
  getProbeRecords, getProbeExclusions, getDiscoverySummary,
  getDiscoveryRunCount, getDiscoveryDropped,
} from '../obd/discovery/serviceDiscoveryRuntime';
import type {
  DiscoverySummary, ProbeExclusion, ProbeRecord,
} from '../obd/discovery/serviceProbeModel';
import { summarizeGapRegistry } from '../obd/gapRegistry';
import { genericBridgeAvailable } from '../obd/genericPduTransport';
import { getPduRoutePolicy } from '../obd/pduRouting';

export interface DiscoveryCapabilityRawSnapshot {
  readonly readAt: number;
  readonly records: readonly ProbeRecord[];
  readonly exclusions: readonly ProbeExclusion[];
  readonly summary: DiscoverySummary | null;
  readonly runCount: number | null;
  readonly dropped: number | null;
  readonly gapCounts: Readonly<Record<string, number>> | null;
  readonly genericBridge: boolean | null;
  readonly routePolicy: string | null;
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export function readDiscoveryCapabilitySnapshot(): DiscoveryCapabilityRawSnapshot {
  return {
    readAt: Date.now(),
    records: _safe(getProbeRecords) ?? [],
    exclusions: _safe(getProbeExclusions) ?? [],
    summary: _safe(getDiscoverySummary),
    runCount: _safe(getDiscoveryRunCount),
    dropped: _safe(getDiscoveryDropped),
    gapCounts: _safe(summarizeGapRegistry),
    genericBridge: _safe(genericBridgeAvailable),
    routePolicy: _safe(getPduRoutePolicy),
  };
}
