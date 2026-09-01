/**
 * performanceProfilerModel — ARCH-06/F1 LAB projeksiyonu (SALT-OKUNUR).
 *
 * ── İKİNCİ OTORİTE DEĞİL ──────────────────────────────────────────────────
 * Hüküm, eşik ve "yavaş/hızlı" kararı burada ÜRETİLMEZ. Bu model yalnız
 * `performanceAggregator`ın topladığı sahiplerden gelen sayıları ekrana
 * taşınabilir hâle getirir; burada hesaplanan hiçbir değer üretim kararına
 * GERİ BESLENMEZ.
 *
 * ── T2 KADEMESİ ───────────────────────────────────────────────────────────
 * Bu fonksiyon PAHALIDIR ve yalnız LAB ekranı MOUNT edildiğinde çağrılır.
 * Kilit testi, üretim kodunun (LAB dışı) bunu çağırmadığını sabitler.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Koordinat · VIN · PDU · ham CAN · transkript · telefon kimliği · medya
 * başlığı bu modele GİRMEZ. Yalnız sayılar, birimler ve kapalı sözlükten
 * gelen sınıf adları taşınır.
 */

import { getPerformanceDiagnosticsSnapshot } from '../perf/performanceAggregator';
import { getTimerInventory } from '../perf/timerInventory';
import { getMemoryInventory } from '../perf/memoryInventory';
import { getBootMilestoneSnapshot } from '../bootTimingRecorder';
import { readCanBridgeMetrics, type CanBridgeMetricsSnapshot } from '../perf/canBridgeMetrics';
import { getHotPathLogAudit } from '../perf/hotPathLogAudit';
import { getMapInstanceEvidence } from '../perf/mapInstanceEvidence';
import { getRenderClassContract } from '../perf/renderClassContract';
import { getBridgePolicy } from '../perf/bridgePolicyContract';
import { getMemoryTrimEvidence } from '../memoryWatchdog';

export interface PerformanceProfilerLabModel {
  readonly sections: ReturnType<typeof getPerformanceDiagnosticsSnapshot>['sections'];
  readonly capturedAt: number | null;
  readonly measuredMetricCount: number;
  readonly totalMetricCount: number;
  readonly milestones: ReturnType<typeof getBootMilestoneSnapshot>['milestones'];
  readonly services: ReturnType<typeof getBootMilestoneSnapshot>['services'];
  readonly timers: ReturnType<typeof getTimerInventory>['timers'];
  readonly memoryResources: ReturnType<typeof getMemoryInventory>['resources'];
  readonly canBridge: CanBridgeMetricsSnapshot;
  readonly hotPathLog: ReturnType<typeof getHotPathLogAudit>;
  readonly mapInstances: ReturnType<typeof getMapInstanceEvidence>;
  readonly renderSurfaces: ReturnType<typeof getRenderClassContract>['surfaces'];
  readonly bridgeSurfaces: ReturnType<typeof getBridgePolicy>['surfaces'];
  readonly memoryTrim: ReturnType<typeof getMemoryTrimEvidence>;
  readonly readOnly: true;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const EMPTY_SNAPSHOT = Object.freeze({
  sections: Object.freeze([]),
  capturedAt: null,
  measuredMetricCount: 0,
  totalMetricCount: 0,
  provenance: Object.freeze([]),
}) as ReturnType<typeof getPerformanceDiagnosticsSnapshot>;

export function getPerformanceProfilerLabModel(): PerformanceProfilerLabModel {
  const snap = safe(() => getPerformanceDiagnosticsSnapshot(), EMPTY_SNAPSHOT);
  const boot = safe(() => getBootMilestoneSnapshot(), null);
  const timers = safe(() => getTimerInventory().timers, []);
  const memory = safe(() => getMemoryInventory().resources, []);
  const canBridge = safe(() => readCanBridgeMetrics(), {
    state: 'UNAVAILABLE' as const,
    reason: 'okuma düştü',
    metrics: null,
  });

  return Object.freeze({
    sections: snap.sections,
    capturedAt: snap.capturedAt,
    measuredMetricCount: snap.measuredMetricCount,
    totalMetricCount: snap.totalMetricCount,
    milestones: boot?.milestones ?? Object.freeze([]),
    services: boot?.services ?? Object.freeze([]),
    timers,
    memoryResources: memory,
    canBridge,
    hotPathLog: safe(() => getHotPathLogAudit(), {
      surfaces: Object.freeze([]), expensivePatterns: Object.freeze([]),
      byRisk: Object.freeze({ P0: 0, P1: 0, P2: 0, P3: 0 }),
      notes: Object.freeze([]), provenance: Object.freeze([]),
    } as ReturnType<typeof getHotPathLogAudit>),
    mapInstances: safe(() => getMapInstanceEvidence(), {
      active: 0, peakConcurrent: 0, createdTotal: 0, destroyedTotal: 0,
      createdByKind: Object.freeze({ FULL: 0, MINI: 0, TRAFFIC: 0, UNKNOWN: 0 }),
      concurrentObserved: false, provenance: Object.freeze([]),
    } as ReturnType<typeof getMapInstanceEvidence>),
    renderSurfaces: safe(() => getRenderClassContract().surfaces, []),
    bridgeSurfaces: safe(() => getBridgePolicy().surfaces, []),
    memoryTrim: safe(() => getMemoryTrimEvidence(), {
      currentLevel: 'NORMAL' as const, lastPressureAt: null, participantCount: 0,
      measuredByteParticipants: 0, participants: Object.freeze([]),
      ladder: Object.freeze([]),
    } as ReturnType<typeof getMemoryTrimEvidence>),
    readOnly: true,
  });
}
