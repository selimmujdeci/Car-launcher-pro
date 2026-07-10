/**
 * vehicleLearningEvidenceBridge.test.ts — Evidence Write Bridge (P2-6).
 *
 * Kilitler: değişimde computeEvidence çağrılıyor · store'a yazılıyor · duplicate kayıt yok ·
 * aynı araç vehicleCount şişmiyor · observationCount doğru · debounce disk yazımını sınırlıyor ·
 * BASIC_JS seyrek / BALANCED normal · boş+bozuk fail-soft · hata upstream'e sızmıyor ·
 * stop/dispose cleanup · flush kapanışta · start idempotent (duplicate subscription yok).
 */
import { describe, it, expect } from 'vitest';
import {
  VehicleLearningEvidenceBridge,
  BRIDGE_DEBOUNCE_MS_NORMAL,
  BRIDGE_DEBOUNCE_MS_LOW,
  type BridgeTimer,
} from '../platform/vehicleLearningEvidenceBridge';
import {
  VehicleLearningEvidenceStore,
  type EvidenceStoreIO,
} from '../platform/vehicleLearningEvidenceStore';
import { type LearningEvidence } from '../platform/vehicleLearningEngine';

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

/** Enjekte edilebilir manuel zamanlayıcı — test fire()'ı çağırınca callback çalışır. */
function manualTimer() {
  let scheduled: { cb: () => void; ms: number } | null = null;
  let setCount = 0, clearCount = 0;
  const timer: BridgeTimer = {
    set: (cb, ms) => { scheduled = { cb, ms }; setCount++; return { id: setCount }; },
    clear: () => { scheduled = null; clearCount++; },
  };
  return {
    timer,
    fire: () => { const s = scheduled; scheduled = null; s?.cb(); },
    pending: () => scheduled,
    get setCount() { return setCount; },
    get clearCount() { return clearCount; },
  };
}

/** Kaynak yakalayıcı — abone callback'lerini toplar, unsub sayar. */
function captureSource() {
  const cbs: Array<() => void> = [];
  let subCount = 0, unsubCount = 0;
  const source = (cb: () => void) => { cbs.push(cb); subCount++; return () => { unsubCount++; }; };
  return {
    source,
    trigger: () => { for (const cb of cbs) cb(); },
    get subCount() { return subCount; },
    get unsubCount() { return unsubCount; },
  };
}

function ev(over: Partial<LearningEvidence> = {}): LearningEvidence {
  return {
    evidenceId: over.evidenceId ?? 'Renault|6|PID|A5|01',
    manufacturer: 'Renault', profileHint: 'Renault', protocol: '6',
    discoverySource: 'PID', pidOrDid: 'A5', mode: '01',
    ecuAddresses: over.ecuAddresses ?? ['7E8'],
    supportingVehicleHashes: over.supportingVehicleHashes ?? ['v1'],
    vehicleCount: over.vehicleCount ?? 1,
    observationCount: over.observationCount ?? 5,
    firstSeen: over.firstSeen ?? 1000,
    lastSeen: over.lastSeen ?? 2000,
    confidence: over.confidence ?? 0.4,
    status: over.status ?? 'weak',
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 2000,
  };
}

/** Bellek-içi IO ile gerçek Evidence Store (debounce 0 → anında yazım testte kolay). */
function memStore(): VehicleLearningEvidenceStore {
  const mem = new Map<string, string>();
  const io: EvidenceStoreIO = {
    read: (k) => mem.get(k) ?? null,
    write: (k, v) => { mem.set(k, v); },
    remove: (k) => { mem.delete(k); },
  };
  return new VehicleLearningEvidenceStore('test-evidence', 512, 0, io, () => 5000);
}

/* ── Tetikleme & yazım ────────────────────────────────────────────────────── */
describe('trigger + write', () => {
  it('değişim → computeEvidence çağrılıyor + store’a yazılıyor', () => {
    const t = manualTimer();
    const src = captureSource();
    let computeCalls = 0;
    const written: LearningEvidence[] = [];
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => { computeCalls++; return [ev()]; },
      writeEvidence: (e) => { written.push(e); },
      subscribeSources: [src.source],
      timer: t.timer,
    });
    b.start();
    expect(computeCalls).toBe(0);   // boot'ta debounce'lu (henüz çalışmadı)
    src.trigger();                  // VKB/discovery değişimi
    t.fire();                       // debounce doldu
    expect(computeCalls).toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0].evidenceId).toBe('Renault|6|PID|A5|01');
    b.stop();
  });

  it('gerçek store: duplicate kayıt YOK + aynı araç vehicleCount ŞİŞMİYOR + observationCount doğru', () => {
    const t = manualTimer();
    const store = memStore();
    let obs = 5;
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => [ev({ observationCount: obs, supportingVehicleHashes: ['v1'] })],
      writeEvidence: (e) => { store.save(e); },
      subscribeSources: [captureSource().source],
      timer: t.timer,
    });
    b.start();
    b.flush(); // 1. projeksiyon (obs=5)
    b.flush(); // 2. projeksiyon AYNI veri (idempotent — şişmemeli)
    let list = store.list();
    expect(list).toHaveLength(1);                 // duplicate kayıt yok
    expect(list[0].vehicleCount).toBe(1);         // aynı araç → şişmedi
    expect(list[0].observationCount).toBe(5);     // tekrar yazımda ŞİŞMEDİ (save reproject)

    obs = 9;      // VKB büyüdü (computeEvidence daha yüksek obs verir)
    b.flush();
    list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].observationCount).toBe(9);     // doğru arttı
    b.dispose();
  });

  it('farklı araç → vehicleCount computeEvidence’ten yansıyor', () => {
    const t = manualTimer();
    const store = memStore();
    let hashes = ['v1'];
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => [ev({ supportingVehicleHashes: hashes, vehicleCount: hashes.length })],
      writeEvidence: (e) => { store.save(e); },
      subscribeSources: [captureSource().source],
      timer: t.timer,
    });
    b.start(); b.flush();
    expect(store.list()[0].vehicleCount).toBe(1);
    hashes = ['v1', 'v2']; // 2. farklı araç öğrenildi
    b.flush();
    expect(store.list()[0].vehicleCount).toBe(2); // farklı araçta arttı
    b.dispose();
  });
});

/* ── Throttle / debounce ──────────────────────────────────────────────────── */
describe('throttle / debounce', () => {
  it('art arda sinyaller TEK projeksiyona indirgeniyor (disk yazımı sınırlı)', () => {
    const t = manualTimer();
    const src = captureSource();
    let computeCalls = 0;
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => { computeCalls++; return [ev()]; },
      writeEvidence: () => {},
      subscribeSources: [src.source],
      timer: t.timer,
    });
    b.start();          // 1 schedule
    src.trigger();      // +1
    src.trigger();      // +1
    src.trigger();      // +1
    expect(t.setCount).toBe(4);           // her sinyal yeniden planladı
    expect(t.clearCount).toBe(3);         // öncekiler iptal (coalesce)
    expect(computeCalls).toBe(0);         // henüz çalışmadı
    t.fire();
    expect(computeCalls).toBe(1);         // 4 sinyal → 1 projeksiyon
    b.stop();
  });

  it('BASIC_JS(low) DAHA SEYREK, BALANCED/HIGH normal', () => {
    const low = manualTimer();
    const high = manualTimer();
    const bLow = new VehicleLearningEvidenceBridge({ computeEvidence: () => [], timer: low.timer, tier: () => 'low', subscribeSources: [] });
    const bHigh = new VehicleLearningEvidenceBridge({ computeEvidence: () => [], timer: high.timer, tier: () => 'high', subscribeSources: [] });
    bLow.start();
    bHigh.start();
    expect(low.pending()!.ms).toBe(BRIDGE_DEBOUNCE_MS_LOW);
    expect(high.pending()!.ms).toBe(BRIDGE_DEBOUNCE_MS_NORMAL);
    expect(BRIDGE_DEBOUNCE_MS_LOW).toBeGreaterThan(BRIDGE_DEBOUNCE_MS_NORMAL);
    bLow.stop(); bHigh.stop();
  });
});

/* ── Fail-soft ────────────────────────────────────────────────────────────── */
describe('fail-soft', () => {
  it('boş knowledge → fail-soft (yazım yok, çökme yok)', () => {
    const t = manualTimer();
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => [], writeEvidence: () => { throw new Error('yazılmamalı'); },
      subscribeSources: [captureSource().source], timer: t.timer,
    });
    b.start();
    expect(() => b.flush()).not.toThrow();
    expect(b.lastWriteCount).toBe(0);
    b.stop();
  });

  it('bozuk evidence → yalnız geçerli yazılır (fail-soft)', () => {
    const t = manualTimer();
    const written: LearningEvidence[] = [];
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => ([null, { evidenceId: '' }, ev({ evidenceId: 'ok' })] as unknown as LearningEvidence[]),
      writeEvidence: (e) => { written.push(e); },
      subscribeSources: [captureSource().source], timer: t.timer,
    });
    b.start(); b.flush();
    expect(written).toHaveLength(1);
    expect(written[0].evidenceId).toBe('ok');
    b.stop();
  });

  it('köprü hatası OBD/Discovery akışına SIZMIYOR (computeEvidence throw)', () => {
    const t = manualTimer();
    const src = captureSource();
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => { throw new Error('patladı'); },
      writeEvidence: () => {},
      subscribeSources: [src.source], timer: t.timer,
    });
    b.start();
    expect(() => src.trigger()).not.toThrow(); // sinyal callback'i çökmez
    expect(() => t.fire()).not.toThrow();      // projeksiyon fail-soft
    b.stop();
  });

  it('bir kaynak subscribe atarsa diğerleri çalışır', () => {
    const t = manualTimer();
    const good = captureSource();
    const bad = () => { throw new Error('subscribe hata'); };
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => [], writeEvidence: () => {},
      subscribeSources: [bad, good.source], timer: t.timer,
    });
    expect(() => b.start()).not.toThrow();
    expect(good.subCount).toBe(1); // iyi kaynak yine abone oldu
    b.stop();
  });
});

/* ── Lifecycle ────────────────────────────────────────────────────────────── */
describe('lifecycle', () => {
  it('start İDEMPOTENT — ikinci start duplicate subscription oluşturmuyor', () => {
    const t = manualTimer();
    const src = captureSource();
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => [], writeEvidence: () => {},
      subscribeSources: [src.source], timer: t.timer,
    });
    b.start();
    b.start(); // ikinci — abone açmamalı
    expect(src.subCount).toBe(1);
    expect(b.isRunning).toBe(true);
    b.stop();
  });

  it('stop cleanup: unsubscribe + timer temizler', () => {
    const t = manualTimer();
    const src = captureSource();
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => [], writeEvidence: () => {},
      subscribeSources: [src.source], timer: t.timer,
    });
    b.start();
    b.stop();
    expect(src.unsubCount).toBe(1);
    expect(b.isRunning).toBe(false);
    expect(t.pending()).toBeNull();
  });

  it('dispose kapanışta FLUSH ediyor + unsubscribe', () => {
    const t = manualTimer();
    const src = captureSource();
    let computeCalls = 0;
    const written: LearningEvidence[] = [];
    const b = new VehicleLearningEvidenceBridge({
      computeEvidence: () => { computeCalls++; return [ev()]; },
      writeEvidence: (e) => { written.push(e); },
      subscribeSources: [src.source], timer: t.timer,
    });
    b.start();
    b.dispose();
    expect(computeCalls).toBe(1);   // kapanışta final flush projeksiyonu
    expect(written).toHaveLength(1);
    expect(src.unsubCount).toBe(1); // abonelik bırakıldı
    // dispose sonrası schedule no-op (yeni timer planlanmaz)
    src.trigger();
    expect(t.pending()).toBeNull();
  });
});
