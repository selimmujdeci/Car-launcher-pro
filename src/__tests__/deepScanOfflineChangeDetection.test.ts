/**
 * deepScanOfflineChangeDetection.test.ts — W5-3c-1 "Safe Offline Change Detection Handler" kilitleri.
 *
 * KAPSAM: SAF handler iki ÖNCEDEN-VAROLAN baseline'ın ECU kümesi FARKINI hesaplar → `changedEcu`.
 * Aktif ECU/PID/DID sorgusu YOK; persistence/counter DEĞİŞMEZ; firmware DEĞERLENDİRİLMEZ
 * (`changedFirmware` daima false); çıktı bounded+immutable; gizlilik sızıntısı yok.
 *
 * Test izolasyonu: pure handler için fake baseline provider'lar; guard-band uçtan uca kanıtı
 * için gerçek runtime+persistence+orchestrator üzerinden `runOfflinePass` ile koşturma.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createOfflineChangeDetectionHandler,
  createDeepScanOrchestrator,
  DeepScanRuntimeService,
  DeepScanPersistenceStore,
  type ChangeBaseline,
  type PhaseContext,
  type PhaseResult,
  type DeepScanSnapshot,
  type DeepScanStoreIO,
} from '../platform/deepScan';

const HASH = 'a1b2c3d4e5f60718';
const now = () => 4_000_000;

const HANDLER_SRC = readFileSync(
  join(process.cwd(), 'src', 'platform', 'deepScan', 'offlineChangeDetectionHandler.ts'), 'utf8');

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function mkSnap(hash: string | null): DeepScanSnapshot {
  return {
    scanId: 'scan-1', vehicleFingerprintHash: hash, status: 'analyzing', mode: 'CHANGE_CHECK',
    phase: 'change_detection', progressPercent: 0, startedAt: 1, updatedAt: 1, completedAt: null,
    isFirstScan: false, ignitionRequired: true, ignitionConfirmed: null,
    discoveredEcuCount: 0, discoveredPidCount: 0, discoveredDidCount: 0, newDiscoveriesCount: 0,
    changedFirmware: false, changedEcu: false, warnings: [], errorCode: null, reportSummary: null,
  };
}

function mkCtx(hash: string | null, cancelled = false): PhaseContext {
  return Object.freeze({
    phase: 'change_detection',
    mode: 'CHANGE_CHECK',
    snapshot: mkSnap(hash),
    isCancelled: () => cancelled,
  });
}

const bl = (ecus: string[]): ChangeBaseline => ({ ecus });

function handlerWith(prior: ChangeBaseline | null, current: ChangeBaseline | null) {
  return createOfflineChangeDetectionHandler({
    loadPriorBaseline: () => prior,
    loadCurrentBaseline: () => current,
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1) changedEcu doğru hesaplanıyor
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-1 — changedEcu diff', () => {
  it('AYNI ECU kümesi → changedEcu=false, reason=no_change', async () => {
    const r = await handlerWith(bl(['7E0', '7E8']), bl(['7E0', '7E8']))(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(false);
    expect(r.reason).toBe('no_change');
    expect(r.status).toBe('success');
  });

  it('ECU EKLENDİ → changedEcu=true, reason=ecu_set_changed', async () => {
    const r = await handlerWith(bl(['7E0']), bl(['7E0', '7E8']))(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(true);
    expect(r.reason).toBe('ecu_set_changed');
  });

  it('ECU KALDIRILDI → changedEcu=true', async () => {
    const r = await handlerWith(bl(['7E0', '7E8']), bl(['7E0']))(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(true);
  });

  it('NORMALİZASYON: sıra/harf/0x/boşluk farkı DEĞİŞİM SAYILMAZ', async () => {
    const r = await handlerWith(bl(['7E0', '7e8']), bl([' 0x7E8 ', '7E0']))(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(false);
    expect(r.reason).toBe('no_change');
  });

  it('BOŞ prior baseline → changedEcu=false, reason=baseline_incomplete (sahte pozitif yok)', async () => {
    const r = await handlerWith(bl([]), bl(['7E0']))(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(false);
    expect(r.reason).toBe('baseline_incomplete');
  });

  it('BOŞ current baseline → changedEcu=false, reason=baseline_incomplete', async () => {
    const r = await handlerWith(bl(['7E0']), bl([]))(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(false);
    expect(r.reason).toBe('baseline_incomplete');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2) Fail-closed: parmak izi / baseline yok
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-1 — fail-closed', () => {
  it('PARMAK İZİ YOK (hash=null) → changedEcu=false, reason=no_fingerprint, provider ÇAĞRILMAZ', async () => {
    const prior = vi.fn(() => bl(['7E0']));
    const current = vi.fn(() => bl(['7E0', '7E8']));
    const h = createOfflineChangeDetectionHandler({ loadPriorBaseline: prior, loadCurrentBaseline: current });
    const r = await h(mkCtx(null)) as PhaseResult;
    expect(r.changedEcu).toBe(false);
    expect(r.reason).toBe('no_fingerprint');
    expect(prior).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
  });

  it('prior baseline null → reason=baseline_unavailable', async () => {
    const r = await handlerWith(null, bl(['7E0']))(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(false);
    expect(r.reason).toBe('baseline_unavailable');
  });

  it('current baseline null → reason=baseline_unavailable', async () => {
    const r = await handlerWith(bl(['7E0']), null)(mkCtx(HASH)) as PhaseResult;
    expect(r.reason).toBe('baseline_unavailable');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3) Firmware üretilmiyor · immutable · privacy · input immutable
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-1 — firmware / immutability / privacy', () => {
  it('changedFirmware DAİMA false (bu PR firmware değerlendirmez)', async () => {
    for (const [p, c] of [[['7E0'], ['7E0', '7E8']], [['7E0'], ['7E0']], [[], ['7E0']]] as const) {
      const r = await handlerWith(bl([...p]), bl([...c]))(mkCtx(HASH)) as PhaseResult;
      expect(r.changedFirmware).toBe(false);
    }
    const r2 = await handlerWith(null, null)(mkCtx(HASH)) as PhaseResult;
    expect(r2.changedFirmware).toBe(false);
  });

  it('çıktı IMMUTABLE (frozen)', async () => {
    const r = await handlerWith(bl(['7E0']), bl(['7E0', '7E8']))(mkCtx(HASH)) as PhaseResult;
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('çıktı YALNIZ {status, changedEcu, changedFirmware, reason} — ham liste/hash YOK', async () => {
    const r = await handlerWith(bl(['7E0', '7E8']), bl(['7E0']))(mkCtx(HASH)) as PhaseResult;
    expect(Object.keys(r).sort()).toEqual(['changedEcu', 'changedFirmware', 'reason', 'status']);
    const blob = JSON.stringify(r);
    expect(blob).not.toContain('7E0');
    expect(blob).not.toContain('7E8');
    expect(blob).not.toContain(HASH);    // parmak izi hash'i taşınmaz
  });

  it('GİRDİ (ctx + baseline) MUTATE EDİLMEZ; provider hash alır', async () => {
    const priorArr = Object.freeze(['7E0']);
    const currentArr = Object.freeze(['7E0', '7E8']);
    const seen: string[] = [];
    const h = createOfflineChangeDetectionHandler({
      loadPriorBaseline: (hash) => { seen.push(hash); return { ecus: priorArr }; },
      loadCurrentBaseline: (hash) => { seen.push(hash); return { ecus: currentArr }; },
    });
    const ctx = mkCtx(HASH);
    await h(ctx);
    expect(seen).toEqual([HASH, HASH]);
    expect(priorArr).toEqual(['7E0']);           // baseline dizisi değişmedi
    expect(currentArr).toEqual(['7E0', '7E8']);
    expect(ctx.snapshot.vehicleFingerprintHash).toBe(HASH);   // ctx değişmedi
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4) Fail-soft · cancel
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-1 — fail-soft & cancel', () => {
  it('provider THROW → handler throw ETMEZ, reason=baseline_unavailable', async () => {
    const h = createOfflineChangeDetectionHandler({
      loadPriorBaseline: () => { throw new Error('boom'); },
      loadCurrentBaseline: () => bl(['7E0']),
    });
    const r = await h(mkCtx(HASH)) as PhaseResult;
    expect(r.status).toBe('success');
    expect(r.changedEcu).toBe(false);
    expect(r.reason).toBe('baseline_unavailable');
  });

  it('CANCEL: ctx.isCancelled()=true → status=cancelled, provider ÇAĞRILMAZ', async () => {
    const prior = vi.fn(() => bl(['7E0']));
    const h = createOfflineChangeDetectionHandler({ loadPriorBaseline: prior, loadCurrentBaseline: () => bl(['7E8']) });
    const r = await h(mkCtx(HASH, true)) as PhaseResult;
    expect(r.status).toBe('cancelled');
    expect(prior).not.toHaveBeenCalled();
  });

  it('isCancelled THROW → fail-soft (iptal sayılmaz, akış devam eder)', async () => {
    const ctx: PhaseContext = Object.freeze({
      phase: 'change_detection', mode: 'CHANGE_CHECK', snapshot: mkSnap(HASH),
      isCancelled: () => { throw new Error('cancel boom'); },
    });
    const r = await handlerWith(bl(['7E0']), bl(['7E0', '7E8']))(ctx) as PhaseResult;
    expect(r.status).toBe('success');
    expect(r.changedEcu).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5) Kaynak kilidi — saf handler (persistence/kb/runtime IMPORT ETMEZ)
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-1 — saf handler (kaynak kilidi)', () => {
  it('yalnız TİP import eder; persistence/knowledge-base/runtime/native/HAL/EventBus IMPORT ETMEZ', () => {
    const importLines = HANDLER_SRC.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(importLines).not.toMatch(/deepScanPersistence|deepScanRuntimeService|vehicleKnowledgeBase/i);
    expect(importLines).not.toMatch(/obdService|nativePlugin|canbus|Capacitor|supabase|vehicleHal|eventBus|capabilityRegistry/i);
    expect(importLines).toMatch(/import type/);   // yalnız tip bağımlılığı
  });

  it('trigger/wiring dosyalarına DOKUNMAZ (handler bağımsız modül)', () => {
    expect(HANDLER_SRC).not.toContain('platformCoreDeepScanWiring');
    expect(HANDLER_SRC).not.toContain('triggerDeepScanOfflinePass');
    expect(HANDLER_SRC).not.toContain('SystemBoot');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6) UÇTAN UCA guard band — gerçek runOfflinePass ile
 * ═════════════════════════════════════════════════════════════════════ */

function memIO() {
  const map = new Map<string, string>();
  const io: DeepScanStoreIO = {
    read: (k) => map.get(k) ?? null,
    write: (k, v) => { map.set(k, v); },
    remove: (k) => { map.delete(k); },
  };
  return io;
}

function realChain() {
  const runtime = new DeepScanRuntimeService({ now });
  const persistence = new DeepScanPersistenceStore('k-cd', 16, 5000, memIO(), now);
  const orch = createDeepScanOrchestrator({ runtime, persistence, now });
  return { runtime, persistence, orch };
}

describe('W5-3c-1 — uçtan uca guard band (runOfflinePass)', () => {
  it('değişim VAR: summary.changedEcu=true; runtime reset; aktif-kayıt/persistence yazımı YOK; counter değişmez', async () => {
    const { runtime, persistence, orch } = realChain();
    const handler = handlerWith(bl(['7E0']), bl(['7E0', '7E8']));

    const ecu = vi.spyOn(runtime, 'recordEcuDiscovery');
    const pid = vi.spyOn(runtime, 'recordPidDiscovery');
    const did = vi.spyOn(runtime, 'recordDidDiscovery');
    const fw = vi.spyOn(runtime, 'recordFirmwareResult');
    const complete = vi.spyOn(persistence, 'completeScan');
    const save = vi.spyOn(persistence, 'saveSnapshot');

    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers: { change_detection: handler } });

    // Değer üretildi (changedEcu pass özetine yansıdı).
    expect(summary.changedEcu).toBe(true);
    const outcome = summary.outcomes.find((o) => o.phase === 'change_detection');
    expect(outcome?.status).toBe('success');

    // AKTİF DISCOVERY YOK.
    expect(ecu).not.toHaveBeenCalled();
    expect(pid).not.toHaveBeenCalled();
    expect(did).not.toHaveBeenCalled();
    expect(fw).not.toHaveBeenCalled();

    // PERSISTENCE DEĞİŞMEZ / COUNTER KİRLENMEZ.
    expect(complete).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(persistence.hasCompletedFullScan(HASH)).toBe(false);
    expect(persistence.load(HASH)).toBeNull();

    // RUNTIME RESET korunur (idle'a döner).
    expect(runtime.getSnapshot().status).toBe('idle');
    expect(runtime.getSnapshot().scanId).toBeNull();
  });

  it('değişim YOK: summary.changedEcu=false', async () => {
    const { orch } = realChain();
    const handler = handlerWith(bl(['7E0', '7E8']), bl(['7E0', '7E8']));
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, handlers: { change_detection: handler } });
    expect(summary.changedEcu).toBe(false);
    expect(summary.changedFirmware).toBe(false);
  });

  it('TIMEOUT: senkron/hızlı handler pass zaman sınırında success verir (timeout değil)', async () => {
    const { orch } = realChain();
    const handler = handlerWith(bl(['7E0']), bl(['7E0', '7E8']));
    const summary = await orch.runOfflinePass({ vehicleFingerprintHash: HASH, phaseTimeoutMs: 50, handlers: { change_detection: handler } });
    const outcome = summary.outcomes.find((o) => o.phase === 'change_detection');
    expect(outcome?.status).toBe('success');
    expect(outcome?.status).not.toBe('timeout');
  });
});
