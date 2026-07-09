/**
 * discoveryCapture.test.ts — Otomatik PID/DID keşif yakalama boru hattı (PR-DISC-1).
 *
 * Kapsananlar (görev tanımı):
 *  - Duplicate discovery oluşmuyor (aynı ECU+mode+PID/DID tek kayıt).
 *  - Registry'deki PID tekrar kaydedilmiyor (bilinen PID atlanır).
 *  - Yeni DID yakalanıyor.
 *  - Hash deduplikasyon çalışıyor (FNV-1a kimlik + bounded eviction).
 *  - Queue davranışı doğru (enqueue/peekAll/drain/bounded/kalıcılık).
 *  - Export JSON doğru (sürümlü zarf).
 *  - Yeni keşifte tanı event'i düşüyor (item 6).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DiscoveryCache,
  DiscoveryQueue,
  DiscoveryCaptureService,
  exportDiscoveryJson,
  buildDiscoveryEnvelope,
  DISCOVERY_EXPORT_SCHEMA,
  createDiscoveryRecord,
  discoveryHash,
  fnv1a,
  type DiscoveryRecord,
  type DiscoveryCaptureOptions,
} from '../platform/obd/discovery';
import { clear as clearDiag, getEvents } from '../platform/obdDiagnosticRecorder';

/** Her testte benzersiz storage anahtarı (kalıcı kuyruk çapraz-kirlenme yok). */
let _k = 0;
const freshQueue = () => new DiscoveryQueue(`test-discovery-${_k++}`, 500);

/** Enjekte edilebilir servis kur (tanı emitörü spy; registry gerçek). */
function makeService(overrides: DiscoveryCaptureOptions = {}) {
  const emit = vi.fn();
  const svc = new DiscoveryCaptureService({
    cache: new DiscoveryCache(),
    queue: freshQueue(),
    emitDiagnostic: emit,
    ...overrides,
  });
  return { svc, emit };
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom */ }
});

/* ── Model / hash ─────────────────────────────────────────────────────────── */

describe('discoveryModel — kimlik & hash', () => {
  it('fnv1a deterministik + 8 hane hex', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });

  it('dedup hash zaman/yanıttan BAĞIMSIZ, kimlikten (ECU+mode+PID/DID+kaynak) türer', () => {
    const base = { discoverySource: 'DID' as const, mode: '22', ecuAddress: '7E8', pidOrDid: 'F190' };
    const a = createDiscoveryRecord({ ...base, timestamp: 1, rawResponse: 'AAA' });
    const b = createDiscoveryRecord({ ...base, timestamp: 999, rawResponse: 'BBB' });
    expect(discoveryHash(a)).toBe(discoveryHash(b)); // aynı kimlik → aynı hash
    // farklı ECU → farklı hash
    const c = createDiscoveryRecord({ ...base, ecuAddress: '7E9' });
    expect(discoveryHash(c)).not.toBe(discoveryHash(a));
  });

  it('createDiscoveryRecord tam şekil + hex normalize (küçük harf/boşluk)', () => {
    const r = createDiscoveryRecord({ pidOrDid: 'f1 90', discoverySource: 'DID', ecuAddress: '7e8', mode: '22' });
    expect(r.pidOrDid).toBe('F190');
    expect(r.ecuAddress).toBe('7E8');
    expect(r.supported).toBe(false);
    expect(r.vehicleProfile).toBe('');
  });
});

/* ── DiscoveryCache — hash dedup ──────────────────────────────────────────── */

describe('DiscoveryCache — hash-tabanlı dedup', () => {
  it('aynı kimlik ikinci eklemede false (dedup), farklı kimlik true', () => {
    const c = new DiscoveryCache();
    const id = { discoverySource: 'PID' as const, mode: '01', ecuAddress: '7E8', pidOrDid: 'A5' };
    expect(c.add(id)).toBe(true);
    expect(c.add(id)).toBe(false);
    expect(c.has(id)).toBe(true);
    expect(c.add({ ...id, pidOrDid: 'A6' })).toBe(true);
    expect(c.size).toBe(2);
  });

  it('bounded: tavan aşılınca en eski hash düşer (zero-leak)', () => {
    const c = new DiscoveryCache(2);
    c.add({ discoverySource: 'PID', mode: '01', ecuAddress: '7E8', pidOrDid: 'A1' });
    c.add({ discoverySource: 'PID', mode: '01', ecuAddress: '7E8', pidOrDid: 'A2' });
    c.add({ discoverySource: 'PID', mode: '01', ecuAddress: '7E8', pidOrDid: 'A3' }); // A1 düşer
    expect(c.size).toBe(2);
    // A1 düştüğü için yeniden "yeni" sayılır
    expect(c.add({ discoverySource: 'PID', mode: '01', ecuAddress: '7E8', pidOrDid: 'A1' })).toBe(true);
  });

  it('clear tümünü sıfırlar', () => {
    const c = new DiscoveryCache();
    c.add({ discoverySource: 'PID', mode: '01', ecuAddress: '7E8', pidOrDid: 'A5' });
    c.clear();
    expect(c.size).toBe(0);
  });
});

/* ── DiscoveryQueue — offline-first FIFO ──────────────────────────────────── */

describe('DiscoveryQueue — offline-first kuyruk', () => {
  const rec = (pid: string): DiscoveryRecord =>
    createDiscoveryRecord({ pidOrDid: pid, discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });

  it('enqueue + peekAll kopya döner (dış mutasyon sızmaz)', () => {
    const q = freshQueue();
    q.enqueue(rec('A1'));
    q.enqueue(rec('A2'));
    const all = q.peekAll();
    expect(all.map((r) => r.pidOrDid)).toEqual(['A1', 'A2']);
    all.pop(); // kopya — iç durum etkilenmez
    expect(q.size).toBe(2);
  });

  it('drain kuyruğu boşaltır ve içeriği döndürür', () => {
    const q = freshQueue();
    q.enqueue(rec('A1'));
    const drained = q.drain();
    expect(drained).toHaveLength(1);
    expect(q.size).toBe(0);
  });

  it('bounded: tavan aşılınca en eski düşer (FIFO, zero-leak)', () => {
    const q = new DiscoveryQueue(`test-bound-${_k++}`, 2);
    q.enqueue(rec('A1'));
    q.enqueue(rec('A2'));
    q.enqueue(rec('A3')); // A1 düşer
    expect(q.peekAll().map((r) => r.pidOrDid)).toEqual(['A2', 'A3']);
  });

  it('kalıcılık: aynı anahtarla yeni örnek diskten yükler (offline-first)', () => {
    const key = `test-persist-${_k++}`;
    const q1 = new DiscoveryQueue(key, 500);
    q1.enqueue(rec('F1'));
    const q2 = new DiscoveryQueue(key, 500);
    expect(q2.peekAll().map((r) => r.pidOrDid)).toEqual(['F1']);
  });
});

/* ── Export JSON ──────────────────────────────────────────────────────────── */

describe('discoveryExport — yerel JSON', () => {
  it('sürümlü zarf: schema/count/records tutarlı ve geri parse edilebilir', () => {
    const records = [createDiscoveryRecord({ pidOrDid: 'F190', discoverySource: 'DID', mode: '22' })];
    const env = buildDiscoveryEnvelope(records);
    expect(env.schema).toBe(DISCOVERY_EXPORT_SCHEMA);
    expect(env.count).toBe(1);

    const json = exportDiscoveryJson(records);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe(DISCOVERY_EXPORT_SCHEMA);
    expect(parsed.count).toBe(1);
    expect(parsed.records[0].pidOrDid).toBe('F190');
    expect(typeof json).toBe('string');
  });

  it('boş liste → count 0, records []', () => {
    const parsed = JSON.parse(exportDiscoveryJson([]));
    expect(parsed.count).toBe(0);
    expect(parsed.records).toEqual([]);
  });
});

/* ── DiscoveryCaptureService — orkestrasyon ───────────────────────────────── */

describe('DiscoveryCaptureService — yakalama kuralları', () => {
  it('registry\'deki PID (0x0C RPM) YAKALANMAZ (reason: known)', () => {
    const { svc, emit } = makeService();
    const res = svc.capture({ pidOrDid: '0C', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    expect(res).toEqual({ captured: false, reason: 'known' });
    expect(svc.getCaptured()).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('registry\'de OLMAYAN PID yakalanır + tanı event\'i düşer', () => {
    const { svc, emit } = makeService();
    const res = svc.capture({ pidOrDid: 'A5', discoverySource: 'PID', mode: '01', ecuAddress: '7E8', supported: true });
    expect(res.captured).toBe(true);
    expect(svc.getCaptured().map((r) => r.pidOrDid)).toEqual(['A5']);
    expect(emit).toHaveBeenCalledTimes(1); // yeni keşif → tanı event
  });

  it('yeni DID (F190) yakalanır (bilinen DID kümesi boşken)', () => {
    const { svc } = makeService();
    const res = svc.capture({ pidOrDid: 'F190', discoverySource: 'DID', mode: '22', ecuAddress: '7E8', decodedValue: 'VF1...' });
    expect(res.captured).toBe(true);
    expect(svc.getCaptured()[0]?.discoverySource).toBe('DID');
  });

  it('setKnownDids ile profildeki DID artık YAKALANMAZ (reason: known)', () => {
    const { svc, emit } = makeService();
    svc.setKnownDids(['f190']); // küçük harf → normalize
    const res = svc.capture({ pidOrDid: 'F190', discoverySource: 'DID', mode: '22', ecuAddress: '7E8' });
    expect(res).toEqual({ captured: false, reason: 'known' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('DUPLICATE: aynı ECU+mode+PID/DID ikinci gözlemde yakalanmaz (reason: duplicate)', () => {
    const { svc, emit } = makeService();
    const input = { pidOrDid: 'A7', discoverySource: 'PID' as const, mode: '01', ecuAddress: '7E8' };
    expect(svc.capture(input).captured).toBe(true);
    const second = svc.capture({ ...input, rawResponse: 'farklı-yanit', timestamp: 12345 });
    expect(second).toEqual({ captured: false, reason: 'duplicate' });
    expect(svc.getCaptured()).toHaveLength(1);   // tek kayıt
    expect(emit).toHaveBeenCalledTimes(1);        // event yalnız ilk keşifte
  });

  it('farklı ECU aynı PID → AYRI keşif (kimlik ECU\'yu içerir)', () => {
    const { svc } = makeService();
    svc.capture({ pidOrDid: 'A8', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    svc.capture({ pidOrDid: 'A8', discoverySource: 'PID', mode: '01', ecuAddress: '7E9' });
    expect(svc.getCaptured()).toHaveLength(2);
  });

  it('exportJson yakalananları sürümlü zarfta verir', () => {
    const { svc } = makeService();
    svc.capture({ pidOrDid: 'A9', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    const parsed = JSON.parse(svc.exportJson());
    expect(parsed.count).toBe(1);
    expect(parsed.records[0].pidOrDid).toBe('A9');
  });

  it('reset cache + kuyruğu temizler', () => {
    const { svc } = makeService();
    svc.capture({ pidOrDid: 'AA', discoverySource: 'PID', mode: '01', ecuAddress: '7E8' });
    svc.reset();
    expect(svc.getCaptured()).toHaveLength(0);
    expect(svc.capturedCount).toBe(0);
  });
});

/* ── Tanı log entegrasyonu (varsayılan emitör → recordDiag) ───────────────── */

describe('DiscoveryCaptureService — varsayılan tanı event wiring', () => {
  beforeEach(() => clearDiag());

  it('varsayılan emitör yeni keşfi tanı timeline\'ına \'ecuQuery\' event\'i olarak yazar', () => {
    // emitDiagnostic enjekte EDİLMEZ → gerçek recordDiag yolu kullanılır.
    const svc = new DiscoveryCaptureService({ cache: new DiscoveryCache(), queue: freshQueue() });
    svc.capture({ pidOrDid: 'B5', discoverySource: 'PID', mode: '01', ecuAddress: '7E8', request: '01B5', rawResponse: '41B500' });
    const evt = getEvents().find((e) => e.technicalMessage.includes('B5'));
    expect(evt).toBeDefined();
    expect(evt?.stage).toBe('ecuQuery');
    expect(evt?.status).toBe('info');
    expect(evt?.command).toBe('01B5');
  });
});
