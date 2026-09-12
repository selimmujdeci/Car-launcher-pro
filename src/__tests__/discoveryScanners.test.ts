/**
 * discoveryScanners.test — P0 Deep PID/DID Explorer Faz-1.
 * Kapsam: standardPidDiscovery (§A — extendedPidService orkestrasyonu),
 *         readOnlyDidScanner (§B/mimari — allowlist + capabilityOutcome sınıflandırma).
 */
import { describe, it, expect, vi } from 'vitest';

import { runStandardPidDiscovery } from '../platform/obd/discovery/standardPidDiscovery';
import { scanDidCandidates, type DidScannerDeps } from '../platform/obd/discovery/readOnlyDidScanner';
import type { DidCandidate } from '../platform/obd/discovery/didCandidateProvider';

/* ── standardPidDiscovery ─────────────────────────────────────────────────── */

describe('standardPidDiscovery — Mode 01 bitmap orkestrasyonu (§A)', () => {
  /** Ortak fake zaman/sleep — deterministik, gerçek bekleme YOK. */
  function makeClock() {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    return { now: () => now, sleep };
  }

  it('#1 desteklenen PID\'leri StandardPidRegistry ile eşler; registry dışı PID SESSİZCE atlanır', async () => {
    const clock = makeClock();
    const unsub = vi.fn();
    const watchPid = vi.fn(() => unsub);
    let calls = 0;
    const getSupportedPids = vi.fn(() => {
      calls++;
      // İlk birkaç çağrı null (keşif sürüyor), sonra STABİL bir küme.
      return calls < 3 ? null : new Set(['04', 'ZZ']); // 'ZZ' registry'de YOK → atlanmalı
    });
    const getPidValue = vi.fn(() => undefined);

    const result = await runStandardPidDiscovery({
      timeoutMs: 5000,
      deps: { watchPid, getSupportedPids, getPidValue, sleep: clock.sleep, now: clock.now },
    });

    expect(result.map((r) => r.pid)).toEqual(['04']); // yalnız registry'de TANIMLI PID raporlanır
    expect(result[0]!.status).toBe('DECODER_KNOWN'); // canlı örnek yok → henüz VERIFIED değil
  });

  it('#2 yalnız çekirdek tetikleyici PID izlenir — ekstra aday PID native trafiğe ZORLANMAZ', async () => {
    const clock = makeClock();
    const unsub = vi.fn();
    const watchPid = vi.fn(() => unsub);
    const getSupportedPids = vi.fn(() => new Set(['04']));
    const getPidValue = vi.fn(() => undefined);

    await runStandardPidDiscovery({
      timeoutMs: 3000,
      deps: { watchPid, getSupportedPids, getPidValue, sleep: clock.sleep, now: clock.now },
    });

    expect(watchPid).toHaveBeenCalledTimes(1);
    expect(watchPid.mock.calls[0]![0]).toBe('0C'); // çekirdek PID — native listeye HİÇ eklenmez
  });

  it('#14 keşif bitince ABONELİK SÖKÜLÜR — çekirdek PID polling AÇIK BIRAKILMAZ', async () => {
    const clock = makeClock();
    const unsub = vi.fn();
    const watchPid = vi.fn(() => unsub);
    const getSupportedPids = vi.fn(() => new Set(['04']));
    const getPidValue = vi.fn(() => undefined);

    await runStandardPidDiscovery({
      timeoutMs: 3000,
      deps: { watchPid, getSupportedPids, getPidValue, sleep: clock.sleep, now: clock.now },
    });

    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it('canlı örneği ÖNCEDEN var olan PID VERIFIED döner (yalnız bit değil, gerçek değer görüldü)', async () => {
    const clock = makeClock();
    const watchPid = vi.fn(() => vi.fn());
    const getSupportedPids = vi.fn(() => new Set(['04']));
    const getPidValue = vi.fn(() => ({ value: 42, def: {} as never, updatedAt: Date.now(), raw: '2A' }));

    const result = await runStandardPidDiscovery({
      timeoutMs: 3000,
      deps: { watchPid, getSupportedPids, getPidValue, sleep: clock.sleep, now: clock.now },
    });

    expect(result[0]!.status).toBe('VERIFIED');
  });

  it('AbortSignal ile erken durur (sonsuz döngü DEĞİL)', async () => {
    const clock = makeClock();
    const watchPid = vi.fn(() => vi.fn());
    const getSupportedPids = vi.fn(() => null); // hiç yakınsamaz
    const getPidValue = vi.fn(() => undefined);
    const ctrl = new AbortController();
    ctrl.abort();

    const result = await runStandardPidDiscovery({
      timeoutMs: 10_000, signal: ctrl.signal,
      deps: { watchPid, getSupportedPids, getPidValue, sleep: clock.sleep, now: clock.now },
    });

    expect(result).toEqual([]); // null supported → boş sonuç, ama TAKILMADI
  });
});

/* ── readOnlyDidScanner ───────────────────────────────────────────────────── */

function makeCandidate(over: Partial<DidCandidate> = {}): DidCandidate {
  return {
    did: 'F190', service: '22', ecuId: 'engine', tx: '7E0', rx: '7E8',
    name: null, hasKnownDecoder: false, compiledDef: null, source: 'auto_did_cache',
    ...over,
  };
}

describe('readOnlyDidScanner — allowlist + capabilityOutcome (§B/mimari)', () => {
  it('#3/#4 allowlist DIŞI servis native\'e HİÇ GÖNDERİLMEZ (write asla)', async () => {
    const readObdDid = vi.fn();
    const deps: DidScannerDeps = { readObdDid, sleep: async () => {}, now: () => 0 };
    const badCandidate = makeCandidate({ service: '2E' as unknown as '22' }); // WriteDataByIdentifier taklidi

    const out = await scanDidCandidates([badCandidate], deps);

    expect(readObdDid).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('#9 negatif yanıt (NEG_7F 0x31 requestOutOfRange) → unsupported', async () => {
    const readObdDid = vi.fn().mockResolvedValue({ data: null, supported: false, kind: 'NEG_7F', nrc: 0x31 });
    const deps: DidScannerDeps = { readObdDid, sleep: async () => {}, now: () => 0 };

    const out = await scanDidCandidates([makeCandidate()], deps);

    expect(out[0]!.outcome).toBe('unsupported');
  });

  it('pozitif yanıt (kind:OK + data) → working', async () => {
    const readObdDid = vi.fn().mockResolvedValue({ data: '4A20', supported: true, kind: 'OK' });
    const deps: DidScannerDeps = { readObdDid, sleep: async () => {}, now: () => 0 };

    const out = await scanDidCandidates([makeCandidate()], deps);

    expect(out[0]!.outcome).toBe('working');
    expect(out[0]!.dataHex).toBe('4A20');
  });

  it('#10 bağlantı koptu (native reject) → timeout (KANIT DEĞİL), throw ETMEZ', async () => {
    const readObdDid = vi.fn().mockRejectedValue(new Error('connection lost'));
    const deps: DidScannerDeps = { readObdDid, sleep: async () => {}, now: () => 0 };

    const out = await scanDidCandidates([makeCandidate(), makeCandidate({ did: 'F187' })], deps);

    expect(out).toHaveLength(2); // ikinci aday da işlendi — tek hata taramayı DURDURMADI
    expect(out.every((o) => o.outcome === 'timeout')).toBe(true);
  });

  it('AbortSignal taramayı erken keser', async () => {
    const readObdDid = vi.fn().mockResolvedValue({ data: '00', supported: true, kind: 'OK' });
    const deps: DidScannerDeps = { readObdDid, sleep: async () => {}, now: () => 0 };
    const ctrl = new AbortController();
    ctrl.abort();

    const out = await scanDidCandidates([makeCandidate()], deps, { signal: ctrl.signal });

    expect(out).toEqual([]);
    expect(readObdDid).not.toHaveBeenCalled();
  });
});
