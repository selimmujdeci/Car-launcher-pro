/**
 * vehicleLearningEvidenceStore.test.ts — Kalıcı Öğrenme Kanıtı Deposu (P2-2).
 *
 * Kilitler: save/load kalıcılığı · duplicate yok · observationCount↑ · hash unique birleşim ·
 * vehicleCount=distinct · ECU normalize · firstSeen korunur · lastSeen güncellenir · confidence/
 * status yeniden hesap · bounded(max) LRU · weak strong'dan önce evict · bozuk/eski-şema fail-soft ·
 * throttle/debounce · flush · dispose · girdi mutate edilmez.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  VehicleLearningEvidenceStore,
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceStoreIO,
} from '../platform/vehicleLearningEvidenceStore';
import {
  evidenceConfidence,
  evidenceStatus,
  type LearningEvidence,
} from '../platform/vehicleLearningEngine';

/* ── Test IO (bellek-içi) + yazma sayacı ─────────────────────────────────── */
function makeIO() {
  const mem = new Map<string, string>();
  const writes: string[] = [];
  const io: EvidenceStoreIO = {
    read:   (k) => mem.get(k) ?? null,
    write:  (k, v) => { mem.set(k, v); writes.push(k); },
    remove: (k) => { mem.delete(k); },
  };
  return { io, mem, writes };
}

const BIG_DEBOUNCE = 1_000_000; // gerçek timer test penceresinde asla ateşlenmez

const _stores: VehicleLearningEvidenceStore[] = [];
function store(io: EvidenceStoreIO, maxItems = 512, now = () => 5000) {
  const s = new VehicleLearningEvidenceStore('vle-test', maxItems, BIG_DEBOUNCE, io, now);
  _stores.push(s);
  return s;
}
afterEach(() => { while (_stores.length) _stores.pop()!.dispose(); }); // zero-leak: timer temizle

function ev(over: Partial<LearningEvidence> & { evidenceId?: string } = {}): LearningEvidence {
  return {
    evidenceId:              over.evidenceId ?? 'Renault|6|PID|A5|01',
    manufacturer:            over.manufacturer ?? 'Renault',
    profileHint:             over.profileHint ?? 'Renault',
    protocol:                over.protocol ?? '6',
    discoverySource:         over.discoverySource ?? 'PID',
    pidOrDid:                over.pidOrDid ?? 'A5',
    mode:                    over.mode ?? '01',
    ecuAddresses:            over.ecuAddresses ?? ['7E8'],
    supportingVehicleHashes: over.supportingVehicleHashes ?? ['v1'],
    vehicleCount:            over.vehicleCount ?? 1,
    observationCount:        over.observationCount ?? 1,
    firstSeen:               over.firstSeen ?? 1000,
    lastSeen:                over.lastSeen ?? 1000,
    confidence:              over.confidence ?? 0.3,
    status:                  over.status ?? 'weak',
    createdAt:               over.createdAt ?? 1000,
    updatedAt:               over.updatedAt ?? 1000,
  };
}

/* ── Kalıcılık ────────────────────────────────────────────────────────────── */
describe('save/load kalıcılığı', () => {
  it('flush sonrası aynı IO ile yeni depo diskten yükler', () => {
    const { io } = makeIO();
    const a = store(io);
    a.upsert(ev({ evidenceId: 'k1', supportingVehicleHashes: ['v1'] }));
    a.flush();
    const b = store(io);
    expect(b.size).toBe(1);
    expect(b.get('k1')?.manufacturer).toBe('Renault');
  });
});

/* ── Birleştirme (upsert) ─────────────────────────────────────────────────── */
describe('upsert birleştirme', () => {
  it('aynı evidenceId duplicate oluşturmuyor + observationCount toplanıyor', () => {
    const { io } = makeIO();
    const s = store(io);
    s.upsert(ev({ observationCount: 2 }));
    s.upsert(ev({ observationCount: 3 }));
    expect(s.size).toBe(1);
    expect(s.get('Renault|6|PID|A5|01')?.observationCount).toBe(5);
  });

  it('supportingVehicleHashes unique birleşiyor + vehicleCount distinct hash sayısı', () => {
    const { io } = makeIO();
    const s = store(io);
    s.upsert(ev({ supportingVehicleHashes: ['v1', 'v2'], vehicleCount: 99 })); // input vehicleCount YOK SAYILIR
    s.upsert(ev({ supportingVehicleHashes: ['v2', 'v3'] }));
    const e = s.get('Renault|6|PID|A5|01')!;
    expect(e.supportingVehicleHashes).toEqual(['v1', 'v2', 'v3']);
    expect(e.vehicleCount).toBe(3);
  });

  it('ECU adresleri normalize/unique', () => {
    const { io } = makeIO();
    const s = store(io);
    s.upsert(ev({ ecuAddresses: [' 7e8 ', '0x7E9', '7E8'] }));
    expect(s.get('Renault|6|PID|A5|01')?.ecuAddresses).toEqual(['7E8', '7E9']);
  });

  it('firstSeen korunuyor (min), lastSeen güncelleniyor (max)', () => {
    const { io } = makeIO();
    const s = store(io);
    s.upsert(ev({ firstSeen: 1000, lastSeen: 2000 }));
    s.upsert(ev({ firstSeen: 500, lastSeen: 4000 }));
    const e = s.get('Renault|6|PID|A5|01')!;
    expect(e.firstSeen).toBe(500);
    expect(e.lastSeen).toBe(4000);
  });

  it('confidence/status P1 fonksiyonuyla YENİDEN hesaplanıyor', () => {
    const { io } = makeIO();
    const s = store(io);
    // 3 distinct araç + 2 ECU → strong; input confidence 0.3 YOK SAYILIR.
    const e = s.upsert(ev({ supportingVehicleHashes: ['v1', 'v2', 'v3'], ecuAddresses: ['7E8', '7E9'], observationCount: 4, confidence: 0.3, status: 'weak' }));
    expect(e.status).toBe('strong');
    expect(e.status).toBe(evidenceStatus(3, 2));
    expect(e.confidence).toBeCloseTo(evidenceConfidence(3, 4, 2));
    expect(e.confidence).not.toBe(0.3);
  });

  it('createdAt korunuyor, updatedAt güncelleniyor', () => {
    const { io } = makeIO();
    const s = store(io, 512, () => 9000);
    s.upsert(ev({ createdAt: 1000, updatedAt: 1000 }));
    const e = s.upsert(ev({ updatedAt: 8000 }));
    expect(e.createdAt).toBe(1000);
    expect(e.updatedAt).toBe(8000);
  });
});

/* ── Bounded LRU ──────────────────────────────────────────────────────────── */
describe('bounded LRU', () => {
  it('max sınırı aşılmıyor', () => {
    const { io } = makeIO();
    const s = store(io, 3);
    for (let i = 0; i < 5; i++) s.upsert(ev({ evidenceId: `k${i}`, status: 'strong', supportingVehicleHashes: ['v1', 'v2', 'v3'], ecuAddresses: ['7E8', '7E9'] }));
    expect(s.size).toBe(3);
  });

  it('weak kayıt strong kayıttan ÖNCE evict ediliyor', () => {
    const { io } = makeIO();
    const s = store(io, 2);
    s.upsert(ev({ evidenceId: 'weakA', supportingVehicleHashes: ['v1'], lastSeen: 9000 }));       // weak, YENİ
    s.upsert(ev({ evidenceId: 'strongB', supportingVehicleHashes: ['a', 'b', 'c'], ecuAddresses: ['7E8', '7E9'], lastSeen: 1000 })); // strong, ESKİ
    s.upsert(ev({ evidenceId: 'strongC', supportingVehicleHashes: ['d', 'e', 'f'], ecuAddresses: ['7E8', '7E9'], lastSeen: 1000 })); // strong → taşma
    expect(s.size).toBe(2);
    expect(s.get('weakA')).toBeNull();        // weak (daha yeni olsa bile) önce silindi
    expect(s.get('strongB')).not.toBeNull();
    expect(s.get('strongC')).not.toBeNull();
  });
});

/* ── Fail-soft yükleme ────────────────────────────────────────────────────── */
describe('fail-soft yükleme', () => {
  it('bozuk storage → boş', () => {
    const { io, mem } = makeIO();
    mem.set('vle-test', '{bozuk-json');
    expect(store(io).size).toBe(0);
  });
  it('eski schema version → boş', () => {
    const { io, mem } = makeIO();
    mem.set('vle-test', JSON.stringify({ schema: EVIDENCE_SCHEMA_VERSION - 1, items: [ev({ evidenceId: 'k1' })] }));
    expect(store(io).size).toBe(0);
  });
});

/* ── Throttle / flush / dispose ───────────────────────────────────────────── */
describe('throttle / flush / dispose', () => {
  it('debounce: ardışık upsert diske hemen yazmaz; flush yazar', () => {
    const { io, writes } = makeIO();
    const s = store(io);
    s.upsert(ev({ evidenceId: 'k1' }));
    s.upsert(ev({ evidenceId: 'k2' }));
    s.upsert(ev({ evidenceId: 'k3' }));
    expect(writes.length).toBe(0);   // debounce beklemede
    s.flush();
    expect(writes.length).toBe(1);   // tek yazım
  });

  it('dispose: bekleyeni yazar + timer temizler (zero-leak); sonra otomatik planlamaz', () => {
    const { io, writes } = makeIO();
    const s = store(io);
    s.upsert(ev({ evidenceId: 'k1' }));
    s.dispose();
    expect(writes.length).toBe(1);   // bekleyen flush edildi
    s.upsert(ev({ evidenceId: 'k2' })); // dispose sonrası otomatik yazma PLANLANMAZ
    expect(writes.length).toBe(1);
  });

  it('clear: bellek + disk temizler', () => {
    const { io, mem } = makeIO();
    const s = store(io);
    s.upsert(ev()); s.flush();
    expect(mem.has('vle-test')).toBe(true);
    s.clear();
    expect(s.size).toBe(0);
    expect(mem.has('vle-test')).toBe(false);
  });
});

/* ── Salt-okunur ──────────────────────────────────────────────────────────── */
describe('salt-okunur', () => {
  it('girdi kaydı MUTATE EDİLMİYOR', () => {
    const { io } = makeIO();
    const s = store(io);
    const input = ev({ ecuAddresses: [' 7e8 '], supportingVehicleHashes: ['v1', 'v1'] });
    const snap = JSON.parse(JSON.stringify(input));
    s.upsert(input);
    expect(input).toEqual(snap);
  });
});
