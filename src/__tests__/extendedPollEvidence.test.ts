/**
 * extendedPollEvidence.test — PR-OBD-DIAG-3.
 *
 * Kapsam:
 *  - classifyExtendedPoll: NO_NATIVE_EVIDENCE / NO_PIDS / H1 / H2 / H3(bridge|decode) / H4 / UNKNOWN
 *    (kabul kriterleri §11 birebir).
 *  - getExtendedPollEvidence: native + JS sayaç birleştirmesi, evidenceComplete = present && coherent.
 *  - extendedPidService JS sayaçları: eventsReceived / decodeFailures / valuesStored, reset.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { NativeExtendedPollEvidence } from '../platform/nativePlugin';
import {
  classifyExtendedPoll,
  getExtendedPollEvidence,
  _internals as evInternals,
  type ExtendedJsCounters,
} from '../platform/obd/extendedPollEvidence';
import {
  getExtendedJsCounters,
  notifyObdConnected,
  _internals as pidInternals,
} from '../platform/obd/extendedPidService';

const JS_ZERO: ExtendedJsCounters = { eventsReceived: 0, decodeFailures: 0, valuesStored: 0, valuesCached: 0 };

function native(overrides: Partial<NativeExtendedPollEvidence> & {
  counters?: Partial<NativeExtendedPollEvidence['counters']>;
} = {}): NativeExtendedPollEvidence {
  const counters: NativeExtendedPollEvidence['counters'] = {
    pollCycles: 0, burstCycles: 0, roundRobinCycles: 0,
    attempted: 0, success: 0, noData: 0, busy: 0,
    negativeResponse: 0, error: 0, timeoutNoBytes: 0,
    timeoutPartial: 0, parseFailure: 0, cancelled: 0,
    unknownFailure: 0, callbackEmitted: 0, maxBurstSizeObserved: 0,
    ...(overrides.counters ?? {}),
  };
  return {
    present: true, transport: 'ble', burstEnabled: true,
    configuredPidCount: 7, configuredPidPreview: ['21', '23'],
    counters,
    lastAttemptedPid: null, lastSuccessfulPid: null, lastOutcome: null,
    lastElapsedMs: 0, lastPollAt: 0, coherent: true, lastAttempts: [],
    ...overrides,
    counters,
  };
}

describe('classifyExtendedPoll — H1/H2/H3/H4 karar ağacı', () => {
  it('kanıt yok (null) → NO_NATIVE_EVIDENCE', () => {
    expect(classifyExtendedPoll(null, JS_ZERO).code).toBe('NO_NATIVE_EVIDENCE');
  });

  it('present=false → NO_NATIVE_EVIDENCE', () => {
    expect(classifyExtendedPoll(native({ present: false }), JS_ZERO).code).toBe('NO_NATIVE_EVIDENCE');
  });

  it('configured=0 & attempted=0 → NO_PIDS', () => {
    const ev = native({ configuredPidCount: 0, counters: { attempted: 0 } });
    expect(classifyExtendedPoll(ev, JS_ZERO).code).toBe('NO_PIDS');
  });

  it('H1: configured>0 & attempted=0 → POLL ÇALIŞMADI', () => {
    const ev = native({ configuredPidCount: 7, counters: { attempted: 0 } });
    expect(classifyExtendedPoll(ev, JS_ZERO).code).toBe('H1_POLL_DEAD');
  });

  it('H2: attempted>0 & success=0 & callback=0 → ECU DEĞER ÜRETMEDİ', () => {
    const ev = native({ counters: { attempted: 64, success: 0, callbackEmitted: 0, noData: 51, timeoutNoBytes: 13 } });
    expect(classifyExtendedPoll(ev, JS_ZERO).code).toBe('H2_ECU_SILENT');
  });

  it('H3 köprü: success>0 & callback>0 & JS olay=0 & stored=0 → BRIDGE_GAP', () => {
    const ev = native({ counters: { attempted: 64, success: 5, callbackEmitted: 5 } });
    const js: ExtendedJsCounters = { eventsReceived: 0, decodeFailures: 0, valuesStored: 0, valuesCached: 0 };
    expect(classifyExtendedPoll(ev, js).code).toBe('H3_BRIDGE_GAP');
  });

  it('H3 decode: callback>0 & JS olay>0 ama stored=0 → DECODE_GAP', () => {
    const ev = native({ counters: { attempted: 64, success: 5, callbackEmitted: 5 } });
    const js: ExtendedJsCounters = { eventsReceived: 5, decodeFailures: 5, valuesStored: 0, valuesCached: 0 };
    expect(classifyExtendedPoll(ev, js).code).toBe('H3_DECODE_GAP');
  });

  it('H4: success>0 & callback>0 & stored>0 → HAT SAĞLIKLI', () => {
    const ev = native({ counters: { attempted: 64, success: 40, callbackEmitted: 40 } });
    const js: ExtendedJsCounters = { eventsReceived: 40, decodeFailures: 0, valuesStored: 38, valuesCached: 7 };
    expect(classifyExtendedPoll(ev, js).code).toBe('H4_HEALTHY');
  });
});

describe('getExtendedPollEvidence — birleştirme + evidenceComplete', () => {
  beforeEach(() => {
    evInternals.reset();
    pidInternals.reset();
  });

  it('cache yok → NO_NATIVE_EVIDENCE, evidenceComplete=false', () => {
    const snap = getExtendedPollEvidence();
    expect(snap.present).toBe(false);
    expect(snap.decision.code).toBe('NO_NATIVE_EVIDENCE');
    expect(snap.evidenceComplete).toBe(false);
  });

  it('coherent=true & present → evidenceComplete=true', () => {
    evInternals.setCached(native({ coherent: true, counters: { attempted: 10, success: 3, callbackEmitted: 3 } }));
    const snap = getExtendedPollEvidence();
    expect(snap.present).toBe(true);
    expect(snap.evidenceComplete).toBe(true);
  });

  it('coherent=false → evidenceComplete=false (present olsa bile)', () => {
    evInternals.setCached(native({ coherent: false }));
    expect(getExtendedPollEvidence().evidenceComplete).toBe(false);
  });

  it('JS sayaçları snapshot içine gömülür', () => {
    evInternals.setCached(native({ counters: { attempted: 5, success: 5, callbackEmitted: 5 } }));
    // decode başarılı bir extended değer olayı sür → valuesStored artmalı.
    pidInternals.onExtendedData({ pid: '04', data: '80' });
    const snap = getExtendedPollEvidence();
    expect(snap.js.eventsReceived).toBeGreaterThanOrEqual(1);
    expect(snap.js.valuesStored).toBeGreaterThanOrEqual(1);
  });
});

describe('extendedPidService JS akış sayaçları', () => {
  beforeEach(() => { pidInternals.reset(); });

  it('bilinen PID + geçerli veri → eventsReceived & valuesStored artar', () => {
    pidInternals.onExtendedData({ pid: '04', data: '80' }); // motor yükü, decode OK
    const c = getExtendedJsCounters();
    expect(c.eventsReceived).toBe(1);
    expect(c.valuesStored).toBe(1);
    expect(c.decodeFailures).toBe(0);
    expect(c.valuesCached).toBe(1);
  });

  it('bilinen PID + bozuk veri → decodeFailures artar, valuesStored artmaz', () => {
    pidInternals.onExtendedData({ pid: '04', data: '' }); // NaN → saklanmaz
    const c = getExtendedJsCounters();
    expect(c.eventsReceived).toBe(1);
    expect(c.decodeFailures).toBe(1);
    expect(c.valuesStored).toBe(0);
  });

  it('tanımsız PID → sayaç artmaz (aday değil)', () => {
    pidInternals.onExtendedData({ pid: 'ZZ', data: '80' });
    const c = getExtendedJsCounters();
    expect(c.eventsReceived).toBe(0);
    expect(c.valuesStored).toBe(0);
  });

  it('notifyObdConnected → JS sayaçları sıfırlanır (yeni oturum)', () => {
    pidInternals.onExtendedData({ pid: '04', data: '80' });
    expect(getExtendedJsCounters().valuesStored).toBe(1);
    notifyObdConnected();
    const c = getExtendedJsCounters();
    expect(c.eventsReceived).toBe(0);
    expect(c.valuesStored).toBe(0);
  });
});
