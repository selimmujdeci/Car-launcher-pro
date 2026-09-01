/**
 * capabilityLearningSources — CAROS LAB · Araç Öğrenmesi TEK okuma katmanı.
 *
 * Desen mevcut LAB turlarıyla AYNI: senkron getter'lar, her biri kendi
 * try/catch'i içinde. **HİÇBİR ŞEY BAŞLATMAZ**: keşif koşturmaz, PDU göndermez,
 * depoya YAZMAZ, timer kurmaz, ağa çıkmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Kimlikler zaten geri döndürülemez KARMALARDIR; ham VIN/MAC bu katmandan
 * geçmez çünkü depoda da yoktur (`capabilityFingerprint` sözleşmesi).
 */

import {
  getCapabilityEdges, getCapabilityHealth, getCapabilitySummary,
  getSavedRequestCount, getReusedProbeCount, getCapabilityDropped,
  isCapabilityLoaded, CAPABILITY_SCHEMA_VERSION,
} from '../obd/capability/capabilityStore';
import type { StoreHealth } from '../obd/capability/capabilityStore';
import type {
  CapabilityEdge, CapabilityGraphSummary,
} from '../obd/capability/capabilityGraph';

export interface CapabilityLearningRawSnapshot {
  readonly readAt: number;
  readonly edges: readonly CapabilityEdge[];
  readonly summary: CapabilityGraphSummary | null;
  readonly health: StoreHealth | null;
  readonly loaded: boolean | null;
  readonly savedRequests: number | null;
  readonly reusedProbes: number | null;
  readonly dropped: number | null;
  readonly schemaVersion: number;
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export function readCapabilityLearningSnapshot(): CapabilityLearningRawSnapshot {
  const now = Date.now();
  return {
    readAt: now,
    edges: _safe(getCapabilityEdges) ?? [],
    summary: _safe(() => getCapabilitySummary(now)),
    health: _safe(getCapabilityHealth),
    loaded: _safe(isCapabilityLoaded),
    savedRequests: _safe(getSavedRequestCount),
    reusedProbes: _safe(getReusedProbeCount),
    dropped: _safe(getCapabilityDropped),
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
  };
}
