/**
 * didLearningEngine.test — sahte ECU ile uçtan uca otomatik DID öğrenme.
 *
 * Sahte ECU, 2026-09-23 saha davranışını taklit eder: 2000'de doğrulanabilir maske,
 * üçlü okuma (62 D1 v1 D2 v2 D3 v3), maske dışı DID'e NRC 0x31.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DidLearningEngine, type ReadDidResult } from '../platform/obd/didLearning/didLearningEngine';
import { deleteRecord, listLearnedEcuKeys } from '../platform/obd/didLearning/didLearningStore';
import type { ReferenceKey } from '../platform/obd/didLearning/referenceCatalog';

const hexAscii = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
const h2 = (n: number) => (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

function fakeEcu(clock: { t: number }, opts: { mask?: string; partNo?: string } = {}) {
  const rpmAt = (t: number) => 850 + Math.round(730 * Math.abs(Math.sin(t / 7000)));
  const value = (did: string): string | null => {
    const t = clock.t;
    switch (did) {
      case '2001': return h2(rpmAt(t) * 4);
      case '2002': return '1234';
      case '2003': return (Math.floor(t / 5000) % 2 ? '01' : '00');
      default: return null;
    }
  };
  let requests = 0;
  const read = async ({ did }: { did: string }): Promise<ReadDidResult> => {
    requests++;
    if (did === 'F187') return { data: hexAscii(opts.partNo ?? '237100942S'), supported: true, kind: 'OK' };
    if (did === 'F195') return { data: hexAscii('A600'), supported: true, kind: 'OK' };
    if (did === '2000') return { data: opts.mask ?? 'E0000000', supported: true, kind: 'OK' };
    const ids = did.match(/.{4}/g) ?? [];
    const vals = ids.map(value);
    if (vals.some((v) => v === null)) return { data: null, supported: false, kind: 'NEG_7F', nrc: 0x31 };
    const data = vals.map((v, i) => (i === 0 ? v : ids[i] + v)).join('');
    return { data, supported: true, kind: 'OK' };
  };
  return { read, rpmAt, get requests() { return requests; } };
}

function makeEngine(clock: { t: number }, ecu: ReturnType<typeof fakeEcu>, stopAfterMs: number, onProven: (d: unknown[]) => void) {
  const start = clock.t;
  const refQueue: Array<{ key: ReferenceKey; t: number; value: number }> = [];
  return new DidLearningEngine({
    readObdDid: ecu.read,
    getHealth: () => ({ connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: 0 }),
    listEcus: async () => [{ tx: '7E0', rx: '7E8' }],
    getVinHash: () => 'abc',
    drainReferences: () => { refQueue.push({ key: 'rpm', t: clock.t, value: ecu.rpmAt(clock.t) }); return refQueue.splice(0); },
    onProvenProfile: (f) => onProven(f.dids),
    isEnabled: () => clock.t - start < stopAfterMs,
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    requestGapMs: 400,
    analyzeEveryMs: 30_000,
  });
}

beforeEach(() => {
  for (const k of listLearnedEcuKeys()) deleteRecord(k);
  localStorage.clear();
});

describe('otomatik DID öğrenme — uçtan uca', () => {
  it('🔒 maske doğrulanır, DID\'ler sayılır, sınıflanır; iki oturumda devir DID\'i kanıtlanır', async () => {
    const clock = { t: 1_000_000 };
    const ecu = fakeEcu(clock);
    let published: Array<{ did: string; decode: { a?: number; b?: number } }> = [];

    const e1 = makeEngine(clock, ecu, 10 * 60_000, (d) => { published = d as typeof published; });
    await e1.start();
    const rec1 = e1.records()[0]!;
    expect(rec1.enumeration?.method).toBe('mask_chain');
    expect(Object.keys(rec1.dids).sort()).toEqual(['2001', '2002', '2003']);
    expect(rec1.dids['2002']!.cls).toBe('CONSTANT');
    expect(rec1.dids['2003']!.cls).toBe('FLAG');
    expect(rec1.dids['2001']!.cls).toBe('ANALOG');
    expect(rec1.dids['2001']!.status).toBe('CANDIDATE'); // tek oturum yetmez
    expect(published).toEqual([]);

    clock.t += 3_600_000;
    const e2 = makeEngine(clock, ecu, 10 * 60_000, (d) => { published = d as typeof published; });
    await e2.start();
    const d2001 = e2.records()[0]!.dids['2001']!;
    expect(d2001.status).toBe('PROVEN');
    expect(d2001.proven).toMatchObject({ ref: 'rpm', k: 0.25, o: 0 });
    expect(published.map((d) => d.did)).toEqual(['2001']);
    expect(published[0]!.decode).toMatchObject({ a: 0.25, b: 0 });
  });

  it('çelişen maske (var dediği DID yanıt vermiyor) ZİNCİRE ALINMAZ', async () => {
    const clock = { t: 5_000_000 };
    const ecu = fakeEcu(clock, { mask: 'F0000000', partNo: 'CONTRA01' }); // 2004'ü de "var" diyor ama yok
    const e = makeEngine(clock, ecu, 60_000, () => {});
    await e.start();
    const rec = e.records()[0]!;
    expect(rec.enumeration?.method).toBe('none');
    expect(Object.keys(rec.dids)).toEqual([]);
  });

  it('araç hareket ediyorsa SAYIM başlamaz (yalnız parkta)', async () => {
    const clock = { t: 9_000_000 };
    const ecu = fakeEcu(clock, { partNo: 'MOVING01' });
    const start = clock.t;
    const e = new DidLearningEngine({
      readObdDid: ecu.read,
      getHealth: () => ({ connectionState: 'connected', source: 'real', dataFresh: true, speedKmh: 40 }),
      listEcus: async () => [{ tx: '7E0', rx: '7E8' }],
      getVinHash: () => null,
      drainReferences: () => [],
      onProvenProfile: () => {},
      isEnabled: () => clock.t - start < 60_000,
      now: () => clock.t,
      sleep: async (ms) => { clock.t += ms; },
    });
    await e.start();
    expect(e.records()[0]!.enumeration).toBeNull();
    expect(ecu.requests).toBe(2); // yalnız kimlik (F187 + F195)
  });
});
