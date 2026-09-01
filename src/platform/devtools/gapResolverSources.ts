/**
 * gapResolverSources — CAROS LAB · Self-Healing / Gap Resolver TEK okuma katmanı.
 *
 * Desen mevcut LAB turlarıyla AYNI: senkron getter'lar, her biri kendi
 * try/catch'i içinde. **HİÇBİR ŞEY BAŞLATMAZ**: çözüm turu koşturmaz, ölçüm
 * yapmaz, PDU göndermez, boşluk sicilini değiştirmez, timer kurmaz, ağa çıkmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Ham istek/yanıt gövdesi, VIN, konum ve kullanıcı verisi bu katmandan GEÇMEZ.
 * Taşınan tek şey: boşluğun sınıfı, katmanı, künyesi (servis/alt fonksiyon),
 * seçilen ölçüm ve sayaçlardır.
 */

import {
  getGapStates, getResolutionSummary, getResolverRunCount, getResolverDropped,
  MAX_RESOLVER_STATES,
} from '../obd/healing/gapResolverRuntime';
import type { GapState, GapResolutionSummary } from '../obd/healing/gapModel';
import {
  getGapRegistry, getGapRegistryDropped, summarizeGapEvidence,
  getGapRegistryEvicted, getGapEvictionReasons, getGapLedgerNotPersisted,
  getGapLedgerHealth, isGapLedgerLoaded, getGapLedgerRestoredCount,
  getGapLedgerRestoredAt, getGapLedgerSavedAt, getGapLedgerLastSaveOk,
  GAP_LEDGER_SCHEMA_VERSION, MAX_GAP_ENTRIES,
  getGapLedgerScope, getGapLedgerSwitchCount, getGapLedgerDetachedRef,
  getGapLedgerBootAt, getGapLedgerRestoreAttempted, getGapLedgerBlockedWrites,
  hasLegacyUnscopedGapLedger,
} from '../obd/gapRegistry';
import type { GapLedgerScope } from '../obd/gapLedgerScope';
/* P0-VDK-F5G — yetenek bölümü + bölüm kataloğu (salt okuma). */
import {
  getCapabilityScope, getCapabilityStorageKey, getCapabilityHealth,
  getCapabilityBlockedWrites, getCapabilitySwitchCount,
} from '../obd/capability/capabilityStore';
import {
  getVehiclePartitions, getPartitionCatalogHealth, getPartitionLastGcAt,
  getPartitionEvictedTotal, getPartitionPartialGcCount,
  getCorruptPartitionCount, isPartitionCatalogLoaded,
} from '../obd/vehiclePartitionCatalog';
import {
  MAX_VEHICLE_PARTITIONS, type VehiclePartitionEntry,
} from '../obd/vehiclePartitionPolicy';
import type { GapEntry, GapEvidenceCoverage } from '../obd/gapRegistry';
import type { StoreHealth } from '../obd/capability/capabilityStore';
import {
  MAX_ENTRIES_PER_ECU, MAX_ENTRIES_PER_FAMILY,
} from '../obd/gapRetentionPolicy';
import { getCapabilitySummary, getCapabilityEdges as getCapabilityEdgesRef }
  from '../obd/capability/capabilityStore';
import type { CapabilityGraphSummary } from '../obd/capability/capabilityGraph';
import {
  MAX_ATTEMPTS_PER_GAP, MAX_ATTEMPTS_PER_TRIPLE,
} from '../obd/healing/resolutionPolicy';
import { DEFAULT_MAX_GAPS } from '../obd/healing/gapResolverRuntime';
/* P0-VDK-F5B — üretim tetiği kanıtı (salt okuma). */
import {
  getLastHealingTrigger, getHealingTriggerEvidence, healingTriggerEverEvaluated,
  HEALING_BUDGET_SHARE, HEALING_MAX_REQUESTS, HEALING_MIN_RESERVE_REQUESTS,
  MAX_HEALING_RUNS_PER_EPOCH,
} from '../obd/healing/selfHealingTrigger';
import type { HealingTriggerEvidence } from '../obd/healing/selfHealingTrigger';
/* P0-VDK-F5B.1 — üretim servis keşfi kanıtı (salt okuma). */
import {
  getLastProductionDiscovery, productionDiscoveryEverEvaluated,
  DISCOVERY_BUDGET_SHARE, DISCOVERY_MIN_RESERVE_REQUESTS, DISCOVERY_MAX_ECUS,
} from '../obd/healing/productionDiscovery';
import type { ProductionDiscoveryEvidence } from '../obd/healing/productionDiscovery';
/* P0-VDK-F5C — oturum-koşullu iyileştirme kanıtı (salt okuma). */
import {
  getLastSessionHealing, sessionHealingEverEvaluated, SESSION_CHAIN_COST,
} from '../obd/healing/sessionHealing';
import type { SessionHealingEvidence } from '../obd/healing/sessionHealing';

export interface GapResolverRawSnapshot {
  readonly readAt: number;
  readonly states: readonly GapState[];
  readonly summary: GapResolutionSummary | null;
  readonly runCount: number | null;
  readonly dropped: number | null;
  /** Ham sicil — çözücünün GÖRDÜĞÜ girdi (kaç sinyal beklemede). */
  readonly registry: readonly GapEntry[];
  readonly registryDropped: number | null;
  /** P0-VDK-F5D — kanıt bağı sayımı (fail-closed hükmün girdisi). */
  readonly evidenceCoverage: GapEvidenceCoverage | null;

  /* ── P0-VDK-F5E · KALICILIK ve SAKLAMA ─────────────────────────────────── */
  /** Depo HİÇ okundu mu — `EMPTY` ile "okunmadı" AYNI ŞEY DEĞİLDİR. */
  readonly ledgerLoaded: boolean;
  readonly ledgerHealth: StoreHealth | null;
  readonly ledgerSchemaVersion: number;
  /** Açılışta geri yüklenen satır adedi; okunmadıysa `null`. */
  readonly ledgerRestored: number | null;
  readonly ledgerRestoredAt: number | null;
  readonly ledgerSavedAt: number | null;
  /** Son yazım denemesi; HİÇ yazılmadıysa `null` (≠ başarısız). */
  readonly ledgerLastSaveOk: boolean | null;
  /** Kökeni `live` olmadığı için diske yazılmayan satır adedi. */
  readonly ledgerNotPersisted: number | null;
  readonly evicted: number | null;
  readonly evictionReasons: Readonly<Record<string, number>> | null;
  readonly maxEntries: number;
  readonly maxPerFamily: number;
  readonly maxPerEcu: number;

  /* ── P0-VDK-F5F · ARAÇ KAPSAMI ─────────────────────────────────────────── */
  /** Aktif araç kapsamı — ham VIN İÇERMEZ (parmak izi karması). */
  readonly ledgerScope: GapLedgerScope | null;
  /** Açılış adımı damgası; hiç koşmadıysa `null`. */
  readonly ledgerBootAt: number | null;
  /** Geri yükleme DENENDİ mi — "denenmedi" ile "0 satır" AYRIDIR. */
  readonly ledgerRestoreAttempted: boolean;
  readonly ledgerSwitchCount: number | null;
  /** Araç takasında AYRILAN önceki bölüm referansı. */
  readonly ledgerDetachedRef: string | null;
  /** Kalıcılık kapısı yüzünden yapılmayan yazım adedi. */
  readonly ledgerBlockedWrites: number | null;
  /** F5-E'den kalan KAPSAMSIZ depo var mı (yüklenmez, taşınmaz). */
  readonly legacyUnscopedPresent: boolean | null;

  /* ── P0-VDK-F5G · YETENEK BÖLÜMÜ + BÖLÜM KATALOĞU ──────────────────────── */
  /** Yetenek öğrenmesinin aktif kapsamı — boşluk siciliyle AYNI olmalı. */
  readonly capabilityScope: GapLedgerScope | null;
  readonly capabilityPartitionKey: string | null;
  readonly capabilityHealth: StoreHealth | null;
  readonly capabilityEdgeCount: number | null;
  readonly capabilityBlockedWrites: number | null;
  readonly capabilitySwitchCount: number | null;
  /** Katalog HİÇ okundu mu — `EMPTY` ile "okunmadı" AYNI ŞEY DEĞİLDİR. */
  readonly partitionCatalogLoaded: boolean | null;
  readonly partitionCatalogHealth: StoreHealth | null;
  readonly partitions: readonly VehiclePartitionEntry[];
  readonly maxPartitions: number;
  readonly partitionLastGcAt: number | null;
  readonly partitionEvictedTotal: number | null;
  readonly partitionPartialGc: number | null;
  readonly partitionCorrupt: number | null;
  /** Öğrenme çizgesi özeti — çözümün yetenek çizgesine ETKİSİ için. */
  readonly capability: CapabilityGraphSummary | null;
  readonly maxStates: number;
  readonly maxAttemptsPerTriple: number;
  readonly maxAttemptsPerGap: number;
  readonly maxGapsPerRun: number;

  /* ── P0-VDK-F5B · ÜRETİM TETİĞİ ────────────────────────────────────────── */
  /** Tetik HİÇ değerlendirildi mi — `0` ile KARIŞTIRILMAZ. */
  readonly triggerEverEvaluated: boolean;
  readonly lastTrigger: HealingTriggerEvidence | null;
  readonly triggerHistory: readonly HealingTriggerEvidence[];
  readonly budgetShare: number;
  readonly budgetMaxRequests: number;
  readonly budgetReserve: number;
  readonly maxRunsPerEpoch: number;

  /* ── P0-VDK-F5B.1 · ÜRETİM SERVİS KEŞFİ ────────────────────────────────── */
  readonly discoveryEverEvaluated: boolean;
  readonly lastDiscovery: ProductionDiscoveryEvidence | null;
  readonly discoveryShare: number;
  readonly discoveryReserve: number;
  readonly discoveryMaxEcus: number;

  /* ── P0-VDK-F5C · OTURUM-KOŞULLU İYİLEŞTİRME ───────────────────────────── */
  readonly sessionHealingEverEvaluated: boolean;
  readonly lastSessionHealing: SessionHealingEvidence | null;
  readonly sessionChainCost: number;
}

/** Kenar SAYISI — ham kenarlar LAB anlık görüntüsüne taşınmaz. */
function getCapabilityEdgesLen(): number {
  return getCapabilityEdgesRef().length;
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export function readGapResolverSnapshot(): GapResolverRawSnapshot {
  const now = Date.now();
  return {
    readAt: now,
    states: _safe(getGapStates) ?? [],
    summary: _safe(getResolutionSummary),
    runCount: _safe(getResolverRunCount),
    dropped: _safe(getResolverDropped),
    registry: _safe(getGapRegistry) ?? [],
    registryDropped: _safe(getGapRegistryDropped),
    evidenceCoverage: _safe(summarizeGapEvidence),
    ledgerLoaded: _safe(isGapLedgerLoaded) ?? false,
    ledgerHealth: _safe(getGapLedgerHealth),
    ledgerSchemaVersion: GAP_LEDGER_SCHEMA_VERSION,
    ledgerRestored: _safe(getGapLedgerRestoredCount),
    ledgerRestoredAt: _safe(getGapLedgerRestoredAt) ?? null,
    ledgerSavedAt: _safe(getGapLedgerSavedAt) ?? null,
    ledgerLastSaveOk: _safe(getGapLedgerLastSaveOk) ?? null,
    ledgerNotPersisted: _safe(getGapLedgerNotPersisted),
    evicted: _safe(getGapRegistryEvicted),
    evictionReasons: _safe(getGapEvictionReasons),
    maxEntries: MAX_GAP_ENTRIES,
    maxPerFamily: MAX_ENTRIES_PER_FAMILY,
    maxPerEcu: MAX_ENTRIES_PER_ECU,
    ledgerScope: _safe(getGapLedgerScope),
    ledgerBootAt: _safe(getGapLedgerBootAt) ?? null,
    ledgerRestoreAttempted: _safe(getGapLedgerRestoreAttempted) ?? false,
    ledgerSwitchCount: _safe(getGapLedgerSwitchCount),
    ledgerDetachedRef: _safe(getGapLedgerDetachedRef) ?? null,
    ledgerBlockedWrites: _safe(getGapLedgerBlockedWrites),
    legacyUnscopedPresent: _safe(hasLegacyUnscopedGapLedger),
    capabilityScope: _safe(getCapabilityScope),
    capabilityPartitionKey: _safe(getCapabilityStorageKey) ?? null,
    capabilityHealth: _safe(getCapabilityHealth),
    capabilityEdgeCount: _safe(() => getCapabilityEdgesLen()),
    capabilityBlockedWrites: _safe(getCapabilityBlockedWrites),
    capabilitySwitchCount: _safe(getCapabilitySwitchCount),
    partitionCatalogLoaded: _safe(isPartitionCatalogLoaded),
    partitionCatalogHealth: _safe(getPartitionCatalogHealth),
    partitions: _safe(getVehiclePartitions) ?? [],
    maxPartitions: MAX_VEHICLE_PARTITIONS,
    partitionLastGcAt: _safe(getPartitionLastGcAt) ?? null,
    partitionEvictedTotal: _safe(getPartitionEvictedTotal),
    partitionPartialGc: _safe(getPartitionPartialGcCount),
    partitionCorrupt: _safe(getCorruptPartitionCount),
    capability: _safe(() => getCapabilitySummary(now)),
    maxStates: MAX_RESOLVER_STATES,
    maxAttemptsPerTriple: MAX_ATTEMPTS_PER_TRIPLE,
    maxAttemptsPerGap: MAX_ATTEMPTS_PER_GAP,
    maxGapsPerRun: DEFAULT_MAX_GAPS,
    triggerEverEvaluated: _safe(healingTriggerEverEvaluated) ?? false,
    lastTrigger: _safe(getLastHealingTrigger),
    triggerHistory: _safe(getHealingTriggerEvidence) ?? [],
    budgetShare: HEALING_BUDGET_SHARE,
    budgetMaxRequests: HEALING_MAX_REQUESTS,
    budgetReserve: HEALING_MIN_RESERVE_REQUESTS,
    maxRunsPerEpoch: MAX_HEALING_RUNS_PER_EPOCH,
    discoveryEverEvaluated: _safe(productionDiscoveryEverEvaluated) ?? false,
    lastDiscovery: _safe(getLastProductionDiscovery),
    discoveryShare: DISCOVERY_BUDGET_SHARE,
    discoveryReserve: DISCOVERY_MIN_RESERVE_REQUESTS,
    discoveryMaxEcus: DISCOVERY_MAX_ECUS,
    sessionHealingEverEvaluated: _safe(sessionHealingEverEvaluated) ?? false,
    lastSessionHealing: _safe(getLastSessionHealing),
    sessionChainCost: SESSION_CHAIN_COST,
  };
}
