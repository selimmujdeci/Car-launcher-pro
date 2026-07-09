/**
 * discoveryDashboardModel.test.ts — Discovery Dashboard saf görünüm mantığı + servis
 * gözlem katmanı (PR-DISC-3). Discovery/capture/queue davranışının DEĞİŞMEDİĞİ de kilitlenir.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  observationBadges,
  computeSummary,
  filterObservations,
  searchObservations,
  selectVisible,
  computeVirtualWindow,
} from '../components/discovery/discoveryDashboardModel';
import {
  DiscoveryCaptureService,
  DiscoveryCache,
  DiscoveryQueue,
  createDiscoveryRecord,
  type DiscoveryObservation,
} from '../platform/obd/discovery';

/* ── Fixture yardımcısı ───────────────────────────────────────────────────── */
function obs(o: Partial<DiscoveryObservation> & {
  pidOrDid: string; source?: 'PID' | 'DID'; status?: 'new' | 'known';
  seenCount?: number; supported?: boolean; profile?: string; ecu?: string;
}): DiscoveryObservation {
  const record = createDiscoveryRecord({
    pidOrDid: o.pidOrDid,
    discoverySource: o.source ?? 'PID',
    mode: (o.source ?? 'PID') === 'DID' ? '22' : '01',
    ecuAddress: o.ecu ?? '7E8',
    supported: o.supported ?? true,
    vehicleProfile: o.profile ?? '',
    timestamp: o.lastAt ?? 1000,
  });
  return {
    record,
    status: o.status ?? 'new',
    seenCount: o.seenCount ?? 1,
    firstAt: o.firstAt ?? 1000,
    lastAt: o.lastAt ?? 1000,
  };
}

/* ── Rozetler ─────────────────────────────────────────────────────────────── */
describe('observationBadges', () => {
  it('new → NEW; known → KNOWN', () => {
    expect(observationBadges(obs({ pidOrDid: 'A5', status: 'new' }))).toEqual(['NEW']);
    expect(observationBadges(obs({ pidOrDid: 'A5', status: 'known' }))).toEqual(['KNOWN']);
  });
  it('seenCount>1 → DUPLICATE; supported:false → UNSUPPORTED (birleşik)', () => {
    const b = observationBadges(obs({ pidOrDid: 'A5', status: 'new', seenCount: 3, supported: false }));
    expect(b).toContain('NEW');
    expect(b).toContain('DUPLICATE');
    expect(b).toContain('UNSUPPORTED');
  });
});

/* ── Özet ─────────────────────────────────────────────────────────────────── */
describe('computeSummary', () => {
  it('yeni PID/DID, bilinen, duplicate ve son keşif doğru sayılır', () => {
    const list = [
      obs({ pidOrDid: 'A5', source: 'PID', status: 'new', lastAt: 100 }),
      obs({ pidOrDid: 'A6', source: 'PID', status: 'new', seenCount: 2, lastAt: 300 }),
      obs({ pidOrDid: 'F190', source: 'DID', status: 'new', lastAt: 200 }),
      obs({ pidOrDid: '0C', source: 'PID', status: 'known', lastAt: 50 }),
    ];
    const s = computeSummary(list);
    expect(s.newPid).toBe(2);
    expect(s.newDid).toBe(1);
    expect(s.known).toBe(1);
    expect(s.duplicate).toBe(1);
    expect(s.total).toBe(4);
    expect(s.lastAt).toBe(300);
  });
  it('boş liste → sıfırlar + lastAt null', () => {
    expect(computeSummary([])).toEqual({ newPid: 0, newDid: 0, total: 0, duplicate: 0, known: 0, lastAt: null });
  });
});

/* ── Filtre ───────────────────────────────────────────────────────────────── */
describe('filterObservations', () => {
  const list = [
    obs({ pidOrDid: 'A5', source: 'PID', status: 'new' }),
    obs({ pidOrDid: 'F190', source: 'DID', status: 'known' }),
    obs({ pidOrDid: 'A6', source: 'PID', status: 'new', seenCount: 2 }),
  ];
  it('pid/did/new/known/duplicate/all', () => {
    expect(filterObservations(list, 'pid')).toHaveLength(2);
    expect(filterObservations(list, 'did')).toHaveLength(1);
    expect(filterObservations(list, 'new')).toHaveLength(2);
    expect(filterObservations(list, 'known')).toHaveLength(1);
    expect(filterObservations(list, 'duplicate')).toHaveLength(1);
    expect(filterObservations(list, 'all')).toHaveLength(3);
  });
});

/* ── Arama ────────────────────────────────────────────────────────────────── */
describe('searchObservations', () => {
  const list = [
    obs({ pidOrDid: '242E', source: 'DID', ecu: '7E0', profile: 'Renault Trafic' }),
    obs({ pidOrDid: '8B', source: 'PID', ecu: '7E8', profile: 'DPF test' }),
  ];
  it('boş sorgu → tümü', () => {
    expect(searchObservations(list, '')).toHaveLength(2);
  });
  it('PID/DID, ECU, profil metniyle arama (case-insensitive)', () => {
    expect(searchObservations(list, '242e').map((o) => o.record.pidOrDid)).toEqual(['242E']);
    expect(searchObservations(list, '7E0')).toHaveLength(1);
    expect(searchObservations(list, 'renault')).toHaveLength(1);
    expect(searchObservations(list, 'trafic')).toHaveLength(1);
    expect(searchObservations(list, 'dpf')).toHaveLength(1);
    expect(searchObservations(list, '8b')).toHaveLength(1);
  });
  it('selectVisible: filtre + arama zinciri', () => {
    expect(selectVisible(list, 'did', 'renault')).toHaveLength(1);
    expect(selectVisible(list, 'pid', 'renault')).toHaveLength(0);
  });
});

/* ── Virtualization ───────────────────────────────────────────────────────── */
describe('computeVirtualWindow', () => {
  it('scrollTop 0 → baştan; yalnız görünür+overscan kadar aralık', () => {
    const w = computeVirtualWindow({ scrollTop: 0, rowHeight: 100, viewportHeight: 500, itemCount: 1000, overscan: 2 });
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(9); // ceil(500/100)=5 + overscan*2=4 → 9
    expect(w.offsetY).toBe(0);
    expect(w.totalHeight).toBe(100000); // 1000*100
  });
  it('kaydırınca pencere kayar (offsetY = startIndex*rowHeight)', () => {
    const w = computeVirtualWindow({ scrollTop: 1000, rowHeight: 100, viewportHeight: 500, itemCount: 1000, overscan: 2 });
    expect(w.startIndex).toBe(8);  // floor(1000/100)=10 - 2
    expect(w.offsetY).toBe(800);
    expect(w.endIndex).toBeLessThanOrEqual(1000);
  });
  it('itemCount küçükse endIndex taşmaz', () => {
    const w = computeVirtualWindow({ scrollTop: 0, rowHeight: 100, viewportHeight: 500, itemCount: 3 });
    expect(w.endIndex).toBe(3);
  });
});

/* ── Servis gözlem katmanı — davranış DEĞİŞMEDİ + canlı abonelik ──────────── */
describe('DiscoveryCaptureService — gözlem katmanı (capture kararı değişmez)', () => {
  let _q = 0;
  function svc() {
    return new DiscoveryCaptureService({
      cache: new DiscoveryCache(),
      queue: new DiscoveryQueue(`dash-test-${_q++}`),
      emitDiagnostic: vi.fn(),
    });
  }
  beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });

  it('capture SONUÇLARI değişmedi: new / duplicate / known', () => {
    const s = svc();
    const input = { pidOrDid: 'A5', discoverySource: 'PID' as const, mode: '01', ecuAddress: '7E8' };
    expect(s.capture(input).captured).toBe(true);          // yeni
    expect(s.capture(input)).toEqual({ captured: false, reason: 'duplicate' });
    expect(s.capture({ pidOrDid: '0C', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' }))
      .toEqual({ captured: false, reason: 'known' });       // registry
    expect(s.getCaptured().map((r) => r.pidOrDid)).toEqual(['A5']); // kuyruk aynı
  });

  it('getObservations kimlik başına 1; seenCount artar; status doğru', () => {
    const s = svc();
    s.capture({ pidOrDid: 'A5', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    s.capture({ pidOrDid: 'A5', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' }); // tekrar
    s.capture({ pidOrDid: '0C', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' }); // known
    const o = s.getObservations();
    expect(o).toHaveLength(2); // A5 (seen 2) + 0C (known)
    const a5 = o.find((x) => x.record.pidOrDid === 'A5')!;
    expect(a5.status).toBe('new');
    expect(a5.seenCount).toBe(2);
    expect(o.find((x) => x.record.pidOrDid === '0C')!.status).toBe('known');
  });

  it('subscribe canlı tetiklenir; unsubscribe durdurur; reset gözlemleri temizler', () => {
    const s = svc();
    const cb = vi.fn();
    const un = s.subscribe(cb);
    s.capture({ pidOrDid: 'A5', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    expect(cb).toHaveBeenCalled();
    const callsAfterOne = cb.mock.calls.length;
    un();
    s.capture({ pidOrDid: 'A6', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    expect(cb.mock.calls.length).toBe(callsAfterOne); // abonelik kalktı
    s.reset();
    expect(s.getObservations()).toHaveLength(0);
  });
});
