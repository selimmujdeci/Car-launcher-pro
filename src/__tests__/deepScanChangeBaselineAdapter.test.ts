/**
 * deepScanChangeBaselineAdapter.test.ts — W5-3c-2 "Change Baseline Adapter" kilitleri.
 *
 * KAPSAM: adapter iki SALT-OKUNUR kaynağı (persistence.load + knowledgeBase.get) normalize
 * `ChangeBaseline`'a çevirir. Hiçbir save/active-discovery/ECU-PID-DID isteği YOK. Çıktı
 * bounded+immutable, yalnız normalize ECU kümesi (firmware/VIN/PID/DID TAŞIMAZ). Handler
 * DEĞİŞMEZ; adapter'ın ürettiği veri doğrudan handler'a bağlanabilir.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createChangeBaselineAdapter } from '../platform/deepScan/changeBaselineAdapter';
import {
  createOfflineChangeDetectionHandler,
  type PhaseContext,
  type PhaseResult,
  type DeepScanSnapshot,
} from '../platform/deepScan';

const HASH = 'a1b2c3d4e5f60718';
const ADAPTER_SRC = readFileSync(
  join(process.cwd(), 'src', 'platform', 'deepScan', 'changeBaselineAdapter.ts'), 'utf8');
const HANDLER_SRC = readFileSync(
  join(process.cwd(), 'src', 'platform', 'deepScan', 'offlineChangeDetectionHandler.ts'), 'utf8');

/* ── Fake kaynaklar ─────────────────────────────────────────────────────────── */

function fakePersistence(rec: { discoveredEcus?: readonly string[] } | null) {
  return { load: vi.fn((_h: string) => rec) };
}
function fakeKnowledge(rec: { discoveredEcus?: readonly string[] } | null) {
  return { get: vi.fn((_h: string) => rec) };
}

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
    phase: 'change_detection', mode: 'CHANGE_CHECK', snapshot: mkSnap(hash),
    isCancelled: () => cancelled,
  });
}

/* ═══════════════════════════════════════════════════════════════════════
 * 1) Kaynak kombinasyonları
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-2 — kaynak kombinasyonları', () => {
  it('persistence BOŞ (load→null) → prior baseline null', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence(null), knowledgeBase: fakeKnowledge({ discoveredEcus: ['7E0'] }) });
    expect(a.loadPriorBaseline(HASH)).toBeNull();
    expect(a.loadCurrentBaseline(HASH)).toEqual({ ecus: ['7E0'] });
  });

  it('knowledge BOŞ (get→null) → current baseline null', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: ['7E0'] }), knowledgeBase: fakeKnowledge(null) });
    expect(a.loadCurrentBaseline(HASH)).toBeNull();
    expect(a.loadPriorBaseline(HASH)).toEqual({ ecus: ['7E0'] });
  });

  it('YALNIZ persistence → prior dolu, current null', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: ['7E0', '7E8'] }), knowledgeBase: fakeKnowledge(null) });
    expect(a.loadPriorBaseline(HASH)?.ecus).toEqual(['7E0', '7E8']);
    expect(a.loadCurrentBaseline(HASH)).toBeNull();
  });

  it('YALNIZ knowledge → prior null, current dolu', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence(null), knowledgeBase: fakeKnowledge({ discoveredEcus: ['7E0'] }) });
    expect(a.loadPriorBaseline(HASH)).toBeNull();
    expect(a.loadCurrentBaseline(HASH)?.ecus).toEqual(['7E0']);
  });

  it('İKİSİ dolu → iki baseline da normalize ECU taşır', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: ['7E0'] }), knowledgeBase: fakeKnowledge({ discoveredEcus: ['7E0', '7E8'] }) });
    expect(a.loadPriorBaseline(HASH)?.ecus).toEqual(['7E0']);
    expect(a.loadCurrentBaseline(HASH)?.ecus).toEqual(['7E0', '7E8']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 2) Normalize · duplicate · null-güvenli
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-2 — normalize & güvenlik', () => {
  it('NORMALİZE: trim/upper/0x kaldırılır', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: [' 0x7e0 ', '7E8'] }), knowledgeBase: fakeKnowledge(null) });
    expect(a.loadPriorBaseline(HASH)?.ecus).toEqual(['7E0', '7E8']);
  });

  it('DUPLICATE kaldırılır (normalize sonrası aynı olanlar)', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: ['7E0', '0x7E0', '7e0', '7E8'] }), knowledgeBase: fakeKnowledge(null) });
    expect(a.loadPriorBaseline(HASH)?.ecus).toEqual(['7E0', '7E8']);
  });

  it('NULL-GÜVENLİ: discoveredEcus undefined / dizi değil → boş ecus', () => {
    const a1 = createChangeBaselineAdapter({ persistence: fakePersistence({}), knowledgeBase: fakeKnowledge(null) });
    expect(a1.loadPriorBaseline(HASH)).toEqual({ ecus: [] });
    const a2 = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: 'x' as unknown as string[] }), knowledgeBase: fakeKnowledge(null) });
    expect(a2.loadPriorBaseline(HASH)).toEqual({ ecus: [] });
  });

  it('geçersiz eleman (non-string / boş) atılır', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: ['7E0', '', '  ', 123 as unknown as string, '7E8'] }), knowledgeBase: fakeKnowledge(null) });
    expect(a.loadPriorBaseline(HASH)?.ecus).toEqual(['7E0', '7E8']);
  });

  it('GEÇERSİZ HASH (boş) → null, kaynak ÇAĞRILMAZ', () => {
    const p = fakePersistence({ discoveredEcus: ['7E0'] });
    const k = fakeKnowledge({ discoveredEcus: ['7E0'] });
    const a = createChangeBaselineAdapter({ persistence: p, knowledgeBase: k });
    expect(a.loadPriorBaseline('')).toBeNull();
    expect(a.loadCurrentBaseline('')).toBeNull();
    expect(p.load).not.toHaveBeenCalled();
    expect(k.get).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 3) Immutable · input mutate edilmiyor · privacy
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-2 — immutability & privacy', () => {
  it('çıktı IMMUTABLE (baseline + ecus dizisi frozen)', () => {
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: ['7E0'] }), knowledgeBase: fakeKnowledge(null) });
    const bl = a.loadPriorBaseline(HASH)!;
    expect(Object.isFrozen(bl)).toBe(true);
    expect(Object.isFrozen(bl.ecus)).toBe(true);
  });

  it('KAYNAK dizisi MUTATE EDİLMEZ', () => {
    const src = Object.freeze(['7E0', '7E8']);
    const a = createChangeBaselineAdapter({ persistence: fakePersistence({ discoveredEcus: src }), knowledgeBase: fakeKnowledge(null) });
    a.loadPriorBaseline(HASH);
    expect(src).toEqual(['7E0', '7E8']);   // değişmedi
  });

  it('PRIVACY: baseline YALNIZ {ecus} — VIN/firmware/PID/DID/signals TAŞIMAZ', () => {
    const rec = { discoveredEcus: ['7E0'], vin: 'WDD12345678901234', firmwareVersions: ['v1'], discoveredPids: { '0C': {} }, supportedModes: ['01'] };
    const a = createChangeBaselineAdapter({ persistence: fakePersistence(rec as unknown as { discoveredEcus?: readonly string[] }), knowledgeBase: fakeKnowledge(null) });
    const bl = a.loadPriorBaseline(HASH)!;
    expect(Object.keys(bl)).toEqual(['ecus']);
    const blob = JSON.stringify(bl);
    expect(blob).not.toContain('WDD12345678901234');
    expect(blob).not.toContain('v1');
    expect(blob).not.toContain('0C');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 4) Fail-soft
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-2 — fail-soft', () => {
  it('persistence.load THROW → null (throw kaçmaz)', () => {
    const a = createChangeBaselineAdapter({
      persistence: { load: () => { throw new Error('disk boom'); } },
      knowledgeBase: fakeKnowledge({ discoveredEcus: ['7E0'] }),
    });
    expect(a.loadPriorBaseline(HASH)).toBeNull();
    expect(a.loadCurrentBaseline(HASH)?.ecus).toEqual(['7E0']);
  });

  it('knowledge.get THROW → null', () => {
    const a = createChangeBaselineAdapter({
      persistence: fakePersistence({ discoveredEcus: ['7E0'] }),
      knowledgeBase: { get: () => { throw new Error('kb boom'); } },
    });
    expect(a.loadCurrentBaseline(HASH)).toBeNull();
  });

  it('varsayılan deps (gerçek boş singleton\'lar) → throw etmeden null döner', () => {
    const a = createChangeBaselineAdapter();
    expect(() => a.loadPriorBaseline(HASH)).not.toThrow();
    expect(() => a.loadCurrentBaseline(HASH)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 5) Handler entegrasyonu — handler DEĞİŞMEDEN yalnız ChangeBaseline görür
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-2 — handler entegrasyonu', () => {
  it('adapter çıktısı handler’a bağlanır → changedEcu doğru; handler yalnız {ecus} görür', async () => {
    const a = createChangeBaselineAdapter({
      persistence: fakePersistence({ discoveredEcus: ['7E0'] }),         // prior
      knowledgeBase: fakeKnowledge({ discoveredEcus: ['7E0', '7E8'] }),  // current
    });
    // Handler'ın gördüğü baseline yalnız {ecus} olmalı.
    expect(Object.keys(a.loadPriorBaseline(HASH)!)).toEqual(['ecus']);

    const handler = createOfflineChangeDetectionHandler(a);
    const r = await handler(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(true);
    expect(r.changedFirmware).toBe(false);   // firmware hâlâ üretilmiyor
    expect(r.reason).toBe('ecu_set_changed');
  });

  it('adapter+handler: aynı ECU seti → değişim yok', async () => {
    const a = createChangeBaselineAdapter({
      persistence: fakePersistence({ discoveredEcus: ['7E0', '7E8'] }),
      knowledgeBase: fakeKnowledge({ discoveredEcus: ['0x7E8', '7e0'] }),   // normalize sonrası aynı
    });
    const r = await createOfflineChangeDetectionHandler(a)(mkCtx(HASH)) as PhaseResult;
    expect(r.changedEcu).toBe(false);
  });

  it('adapter+handler: CANCEL → status cancelled (kaynak okunmaz)', async () => {
    const p = fakePersistence({ discoveredEcus: ['7E0'] });
    const a = createChangeBaselineAdapter({ persistence: p, knowledgeBase: fakeKnowledge({ discoveredEcus: ['7E8'] }) });
    const r = await createOfflineChangeDetectionHandler(a)(mkCtx(HASH, true)) as PhaseResult;
    expect(r.status).toBe('cancelled');
    expect(p.load).not.toHaveBeenCalled();   // iptalde baseline okunmaz
  });
});

/* ═══════════════════════════════════════════════════════════════════════
 * 6) Kaynak kilitleri — salt-okunur, active discovery/write YOK, handler saf kalır
 * ═════════════════════════════════════════════════════════════════════ */

describe('W5-3c-2 — kaynak kilitleri', () => {
  it('adapter YALNIZ .load()/.get() okur; save/active-record/discovery çağırmaz', () => {
    expect(ADAPTER_SRC).toMatch(/\.load\s*\(/);
    expect(ADAPTER_SRC).toMatch(/\.get\s*\(/);
    expect(ADAPTER_SRC).not.toMatch(/\.saveSnapshot\s*\(/);
    expect(ADAPTER_SRC).not.toMatch(/\.completeScan\s*\(/);
    expect(ADAPTER_SRC).not.toMatch(/\.recordEcuDiscovery\s*\(|\.recordPidDiscovery\s*\(|\.recordDidDiscovery\s*\(|\.recordFirmwareResult\s*\(/);
    expect(ADAPTER_SRC).not.toMatch(/\.recordChangeDetection\s*\(|\.startScan\s*\(|\.runNextPhase\s*\(|_applyResult\s*\(|_finalize\s*\(/);
  });

  it('adapter Event Bus/Capability/HAL/Native/OBD/CAN import ETMEZ', () => {
    const imports = ADAPTER_SRC.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/eventBus|capabilityRegistry|vehicleHal|obdService|nativePlugin|canbus|Capacitor|supabase|assistant|driverDna|prediction/i);
    // Yalnız izinli kaynaklar + tip.
    expect(imports).toMatch(/deepScanPersistence/);
    expect(imports).toMatch(/vehicleKnowledgeBase/);
  });

  it('HANDLER hâlâ persistence/knowledge-base/adapter import ETMEZ (saf kalır, DI korunur)', () => {
    const imports = HANDLER_SRC.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/deepScanPersistence|vehicleKnowledgeBase|changeBaselineAdapter/i);
    expect(imports).toMatch(/import type/);   // yalnız tip
  });

  it('adapter trigger/wiring/SystemBoot’a DOKUNMAZ', () => {
    expect(ADAPTER_SRC).not.toContain('triggerDeepScanOfflinePass');
    expect(ADAPTER_SRC).not.toContain('platformCoreDeepScanWiring');
    expect(ADAPTER_SRC).not.toContain('SystemBoot');
    expect(ADAPTER_SRC).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
  });
});
