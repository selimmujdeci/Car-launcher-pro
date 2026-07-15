/**
 * diagnosticDtcDepthTriage.test.ts — REGRESYON KASASI (Diagnostics PR-1).
 *
 * Kilitlenen iki kanıtlı P0 (denetim 2026-07-12):
 *
 *  1. DTC kodları kabloda `null` gidiyordu. `remoteLogService` `_deepSanitize`
 *     derinlik >= MAX_DEPTH'te KABI (nesne/dizi) düşürür. Zincir:
 *       root(0) → obdDeep(1) → dtc(2) → codes[](3) → kod nesnesi(4)
 *     MAX_DEPTH=4 iken kod nesnesi düşüyor → `codes: [null, null]`.
 *     Aynı derinlikte: `extended.samples[]`, `inspector.timeline[].signals`.
 *
 *  2. DTC varken TRİYAJ TAMAMEN kayboluyordu. `ruleObdDtc` null-guard'sız
 *     `c.code` okur → TypeError → `buildTriageSnapshot` döngüsü kırılır →
 *     `_attachTriage` yutucu catch → `payload.triage` HİÇ yazılmaz → admin
 *     "kritik bulgu yok" görür. Arıza olan tam anda triyaj susuyordu.
 *
 * Ayrıca ölçülür: en zengin fixture'ın payload BYTE boyutu (canlı sunucu
 * tavanı 64 KB — migration 027; aşılırsa gövde `{truncated:true}` kabuğuyla
 * DEĞİŞTİRİLİR = %100 sessiz veri kaybı).
 *
 * Mock deseni: inspectorDiagnosticSend.test.ts / supportSnapshot.test.ts ile
 * birebir aynı (render YOK).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const M = vi.hoisted(() => ({
  pushed: [] as Array<{ type: string; payload: Record<string, unknown> }>,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  pushVehicleEvent: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    M.pushed.push({ type, payload });
  }),
  isDevicePaired: vi.fn(async () => true),
}));

vi.mock('../platform/obdService', () => ({
  getOBDStatusSnapshot: () => ({
    connectionState: 'connected', source: 'ble', vehicleType: 'ice', lastSeenMs: 1765000001000,
  }),
  getOBDDataSnapshot: () => ({
    speed: 82, rpm: 3210, engineTemp: 96, fuelLevel: 42, throttle: 18,
    intakeTemp: 31, boostPressure: -1, batteryLevel: -1, range: -1, motorPower: -1,
  }),
  getTransportStats: () => ({ transport: 'ble', reconnectAttempts: 4, lastDisconnectReason: 'timeout' }),
}));

vi.mock('../platform/obd/ObdHealthMonitor', () => ({
  getObdHealth: () => ({
    connectionQuality: 41, lastPacketAgeMs: 320, isStale: false, reconnectPressure: 0.62,
    sensorReliability: { speed: 0.9, rpm: 0.88, engineTemp: 0.71 },
  }),
}));

/** Keşfedilen katalog-dışı PID'ler — extended.samples[] de derinlik 4'te. */
vi.mock('../platform/obd/extendedPidService', () => ({
  getSupportedPids: () => new Set(['22F190', '221001', '222002']),
  getPidValue: (pid: string) => ({
    def: { name: `EXT_${pid}` }, value: 42.5, updatedAt: 1765000000000,
  }),
}));

/** DTC kaynağı — ARIZA VAR senaryosu (raporun en kritik anı). */
vi.mock('../platform/dtcService', () => ({
  getDTCStateSnapshot: () => ({
    codes: [
      { code: 'P0301', description: 'Silindir 1 tekleme', system: 'engine',   severity: 'critical', possibleCauses: ['buji'] },
      { code: 'P0420', description: 'Katalizör verimi',   system: 'emission', severity: 'warning',  possibleCauses: ['katalizör'] },
    ],
    isReading: false, isClearing: false,
    lastReadAt: 1765000000000, error: null, isStale: false,
  }),
}));

vi.mock('../platform/system/SystemHealthMonitor', () => ({
  healthMonitor: {
    getGlobalHealthSnapshot: () => ({
      appVersion: '2.4.0', overallHealth: 'healthy',
      services: [{ name: 'OBD', healthy: true, restartCount: 0, criticality: 'critical' }],
    }),
  },
}));

vi.mock('../platform/otaUpdateService', () => ({
  useOtaStore: { getState: () => ({ state: 'idle', errorCode: null, release: null, lastCheckTs: 0 }) },
  getCurrentVersionCode: vi.fn(async () => 7),
}));

import {
  reportSupportSnapshot,
  reportDiagnosticSnapshot,
  _resetRemoteLogServiceForTest,
} from '../platform/remoteLogService';
import { buildTriageSnapshot, type TriageSections } from '../platform/diagnosticTriage';
import { clearErrorLog } from '../platform/crashLogger';

/* ── Yardımcılar ─────────────────────────────────────────────── */

interface DtcSection { count?: number; codes?: Array<{ code?: unknown; severity?: unknown; system?: unknown } | null> }
interface ObdDeepSection { dtc?: DtcSection; extended?: { samples?: Array<unknown> } }
interface TriageSection { findings?: Array<{ code?: string; severity?: string }> }

function obdDeepOf(payload: Record<string, unknown>): ObdDeepSection {
  return payload.obdDeep as ObdDeepSection;
}
function triageOf(payload: Record<string, unknown>): TriageSection | undefined {
  return payload.triage as TriageSection | undefined;
}
function payloadBytes(payload: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/** InspectorPanel.buildExportPayload ile aynı şekil (timeline signals = derinlik 4). */
function sampleInspector(): Record<string, unknown> {
  return {
    _meta:   { sanitized: true, noPII: true, exportedAt: '2026-06-10T12:00:00.000Z' },
    runtime: {
      mode: 'NORMAL', fps: 58, tier: 'low', ramMb: 142, blur: 'OFF',
      webgl: true, weakGpu: true, renderer: 'Mali-400 MP',
      workers: [{ key: 'obd', criticality: 'CRITICAL', status: 'alive' }],
    },
    timeline: Array.from({ length: 10 }, (_, i) => ({
      ts: 1765000000000 + i * 1000,
      signals: { spd: 40 + i, rpm: 2100 + i * 10, gear: 3, fuel: 42 },
      env: { therm: 1, mem: 'OK' },
    })),
    network: [{ method: 'GET', url: 'https://api.example.com/tiles', status: 200, durationMs: 120 }],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(1765000002000);
  _resetRemoteLogServiceForTest();
  clearErrorLog();
  M.pushed = [];
});

afterEach(() => {
  clearErrorLog();
  vi.useRealTimers();
});

/* ── KİLİT 1: DTC kodları sanitize'ı SAĞ geçer ───────────────── */

describe('KİLİT — DTC kodları kabloda null DEĞİL (sanitize derinliği)', () => {
  it('obdDeep.dtc.codes[0] null değil; code/severity/system DOLU', async () => {
    const payload = await reportSupportSnapshot();
    const dtc = obdDeepOf(payload).dtc!;

    expect(dtc.count).toBe(2);
    expect(Array.isArray(dtc.codes)).toBe(true);
    expect(dtc.codes).toHaveLength(2);

    const first = dtc.codes![0];
    expect(first).not.toBeNull();          // ← regresyon: eskiden [null, null] gidiyordu
    expect(first).toBeTruthy();
    expect(first!.code).toBe('P0301');
    expect(first!.severity).toBe('critical');
    expect(first!.system).toBe('engine');

    // Hiçbir eleman null/undefined olamaz — "sessiz null" tip yalanı yasak.
    for (const c of dtc.codes!) expect(c).not.toBeNull();
  });

  it('aynı derinlikteki extended.samples[] de sağ kalır (katalog-dışı PID keşfi)', async () => {
    const payload = await reportSupportSnapshot();
    const samples = obdDeepOf(payload).extended!.samples!;

    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(s).not.toBeNull();
    expect((samples[0] as { pid?: string }).pid).toBe('22F190');
  });
});

/* ── KİLİT 2: DTC varken triyaj HAYATTA ──────────────────────── */

describe('KİLİT — DTC varken triyaj kaybolmaz', () => {
  it('payload.triage MEVCUT ve OBD_DTC_PRESENT bulgusu üretiliyor', async () => {
    const payload = await reportSupportSnapshot();
    const triage = triageOf(payload);

    expect(triage).toBeDefined();                     // ← regresyon: eskiden HİÇ yazılmıyordu
    expect(Array.isArray(triage!.findings)).toBe(true);

    const dtcFinding = triage!.findings!.find((f) => f.code === 'OBD_DTC_PRESENT');
    expect(dtcFinding).toBeDefined();
    expect(dtcFinding!.severity).toBe('critical');    // P0301 critical → bulgu critical
  });

  it('triyaj kuralı bozuk DTC verisinde (codes:[null,null]) THROW ETMEZ', () => {
    const sections = {
      obdDeep: { dtc: { count: 2, codes: [null, null] } },
    } as unknown as TriageSections;

    expect(() => buildTriageSnapshot(sections)).not.toThrow();
    const snap = buildTriageSnapshot(sections);
    // count > 0 → "DTC var" kanıtı; kod metni yalnız zenginleştirme → bulgu YİNE üretilir
    expect(snap.findings.some((f) => f.code === 'OBD_DTC_PRESENT')).toBe(true);
  });

  it('TEK bozuk bölüm tüm triyajı düşürmez — diğer kuralların bulguları korunur', () => {
    const sections = {
      // bozuk bölüm: codes elemanları null
      obdDeep: { dtc: { count: 1, codes: [null] } },
      // sağlam bölümler: kendi bulgularını üretmeli
      health:  { overallHealth: 'critical', services: [{ name: 'OBD', healthy: false, restartCount: 3 }] },
      power:   { severity: 'critical', voltageV: 10.9 },
    } as unknown as TriageSections;

    const snap = buildTriageSnapshot(sections);
    const codes = snap.findings.map((f) => f.code);

    expect(codes).toContain('HEALTH_CRITICAL');   // ← eskiden TypeError hepsini yutuyordu
    expect(codes).toContain('POWER_CRITICAL');
    expect(codes).toContain('OBD_DTC_PRESENT');
    expect(snap.topSeverity).toBe('critical');
  });
});

/* ── KİLİT 3: inspector timeline signal nesneleri korunur ────── */

describe('KİLİT — inspector timeline signal nesneleri sanitize sonrası korunur', () => {
  it('timeline[].signals ve env kaybolmaz (derinlik 4 kabı)', async () => {
    const payload = await reportDiagnosticSnapshot(sampleInspector());
    const inspector = payload.inspector as Record<string, unknown>;
    const timeline  = inspector.timeline as Array<Record<string, unknown>>;

    expect(timeline).toHaveLength(10);
    const first = timeline[0]!;
    expect(first.signals).toBeDefined();            // ← regresyon: eskiden komple düşüyordu
    expect((first.signals as { spd: number }).spd).toBe(40);
    expect((first.signals as { rpm: number }).rpm).toBe(2100);
    expect(first.env).toBeDefined();

    // runtime.workers[] de aynı derinlikte
    const runtime = inspector.runtime as Record<string, unknown>;
    const workers = runtime.workers as Array<Record<string, unknown> | null>;
    expect(workers[0]).not.toBeNull();
    expect(workers[0]!.key).toBe('obd');
  });
});

/* ── KİLİT 4: derinlik arttı, redaction DELİNMEDİ ────────────── */

describe('KİLİT — derinlik artışı gizlilik maskelerini delmez', () => {
  it('secret/VIN/MAC/koordinat 5-6 seviye derinde bile sızmaz', async () => {
    const dirty = {
      ...sampleInspector(),
      runtime: {
        mode: 'NORMAL',
        // deny-list her derinlikte uygulanır — 5 seviye derine göm
        a: { b: { c: { d: { lat: 41.0082, lng: 28.9784, vin: 'WVWZZZ1JZXW000001', mac: 'AA:BB:CC:DD:EE:FF', token: 'gizli-jeton' } } } },
        // string içi maskeler (derinlikten bağımsız)
        note: 'VIN WVWZZZ1JZXW000001 · MAC AA:BB:CC:DD:EE:FF · 41.0082, 28.9784 · api_key=sk-canli-1234',
      },
    };

    const payload = await reportDiagnosticSnapshot(dirty);
    const json = JSON.stringify(payload);

    expect(json).not.toContain('WVWZZZ1JZXW000001');   // ham VIN
    expect(json).not.toContain('AA:BB:CC:DD:EE:FF');   // ham MAC
    expect(json).not.toContain('41.0082');             // koordinat
    expect(json).not.toContain('28.9784');
    expect(json).not.toContain('sk-canli-1234');       // api anahtarı
    expect(json).not.toContain('gizli-jeton');         // token değeri

    // maskeler yerinde
    expect(json).toContain('[VIN]');
    expect(json).toContain('[MAC]');
    expect(json).toContain('[COORD]');
    expect(json).toContain('api_key=[MASKED]');
  });
});

/* ── ÖLÇÜM: en zengin fixture payload byte boyutu ────────────── */

describe('ÖLÇÜM — en zengin fixture payload byte bütçesi', () => {
  /** Canlı sunucu tavanı (migration 027). Aşılırsa gövde truncated kabuğuyla DEĞİŞTİRİLİR. */
  const SERVER_CAP_BYTES = 64 * 1024;

  it('support_snapshot (DTC + extended + live + trail + perfSeries) < 64 KB', async () => {
    const payload = await reportSupportSnapshot();
    const bytes = payloadBytes(payload);
    console.info(`[ÖLÇÜM] support_snapshot payload = ${bytes} B (${(bytes / 1024).toFixed(2)} KB)`);
    expect(bytes).toBeLessThan(SERVER_CAP_BYTES);
  });

  it('EN ZENGİN: dev_inspector snapshot (+ inspector timeline/network/workers) < 64 KB', async () => {
    const payload = await reportDiagnosticSnapshot(sampleInspector());
    const bytes = payloadBytes(payload);
    console.info(`[ÖLÇÜM] dev_inspector payload  = ${bytes} B (${(bytes / 1024).toFixed(2)} KB)`);
    expect(bytes).toBeLessThan(SERVER_CAP_BYTES);
  });
});
