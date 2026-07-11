/**
 * deepScanIgnitionSource.test.ts — Deep Scan Ignition Source Foundation birim testleri.
 *
 * Kapsam: kaynak yok→unknown · native/CAN authoritative on/off · yardımcı kaynak (rpm/
 * voltaj/obd) tek başına→unknown · engine_running birleşik kanıt→on · authoritative
 * yardımcıyı ezer · çelişki→unknown · stale kullanılmıyor · saat-geri güvenliği ·
 * fail-soft · bounded · immutability · subscribe/unsubscribe · listener izolasyonu ·
 * reset/dispose zero-leak · import yan etkisizliği · SystemBoot wiring yok · runtime
 * değişmiyor · privacy · manual override prod-kapalı · BASIC_JS ek yük yok.
 */

import { describe, it, expect } from 'vitest';
import {
  createDeepScanIgnitionSource,
  resolveIgnitionState,
  IGNITION_STALE_MS_DEFAULT,
  MAX_IGNITION_EVIDENCE,
  MAX_IGNITION_LISTENERS,
  type IgnitionEvidence,
} from '../platform/deepScan/deepScanIgnitionSource';
import { deepScanRuntimeService } from '../platform/deepScan';
// Kaynak-metin kilidi (transform-time sabit → flake bağışık).
import ignitionSource from '../platform/deepScan/deepScanIgnitionSource.ts?raw';

const NOW = 1_000_000;

function ev(over: Partial<IgnitionEvidence> = {}): IgnitionEvidence {
  return { source: 'native_acc', value: true, confidence: 0.95, observedAt: NOW, ...over };
}

function make(overDeps = {}) {
  return createDeepScanIgnitionSource({ now: () => NOW, ...overDeps });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1–9 · Temel karar mantığı
 * ════════════════════════════════════════════════════════════════════════ */

describe('temel karar mantığı', () => {
  it('1) kaynak yok → unknown / null', () => {
    const snap = resolveIgnitionState([], NOW);
    expect(snap.state).toBe('unknown');
    expect(snap.confirmed).toBeNull();
    expect(snap.primarySource).toBe('none');
  });

  it('2) native ACC on → true', () => {
    const snap = resolveIgnitionState([ev({ source: 'native_acc', value: true })], NOW);
    expect(snap.state).toBe('on');
    expect(snap.confirmed).toBe(true);
    expect(snap.primarySource).toBe('native_acc');
  });

  it('3) native ACC off → false', () => {
    const snap = resolveIgnitionState([ev({ source: 'native_acc', value: false })], NOW);
    expect(snap.state).toBe('off');
    expect(snap.confirmed).toBe(false);
  });

  it('4) CAN ignition on → true', () => {
    const snap = resolveIgnitionState([ev({ source: 'can_ignition', value: true })], NOW);
    expect(snap.confirmed).toBe(true);
    expect(snap.primarySource).toBe('can_ignition');
  });

  it('5) CAN ignition off → false', () => {
    const snap = resolveIgnitionState([ev({ source: 'can_ignition', value: false })], NOW);
    expect(snap.confirmed).toBe(false);
  });

  it('6) RPM tek başına → unknown (yardımcı ONAY VERMEZ)', () => {
    const snap = resolveIgnitionState([ev({ source: 'rpm', value: true, confidence: 0.99 })], NOW);
    expect(snap.state).toBe('unknown');
    expect(snap.confirmed).toBeNull();
    expect(snap.reason).toBe('no_authoritative_evidence');
  });

  it('7) voltaj tek başına → unknown', () => {
    const snap = resolveIgnitionState([ev({ source: 'battery_voltage', value: true, confidence: 0.99 })], NOW);
    expect(snap.confirmed).toBeNull();
  });

  it('8) OBD transport tek başına → unknown', () => {
    const snap = resolveIgnitionState([ev({ source: 'obd_transport', value: true, confidence: 0.99 })], NOW);
    expect(snap.confirmed).toBeNull();
  });

  it('9) engine_running doğrulanmış birleşik kanıt → true', () => {
    const snap = resolveIgnitionState([
      ev({ source: 'engine_running', value: true, confidence: 0.9 }),
      ev({ source: 'rpm', value: true, confidence: 0.9 }),
      ev({ source: 'alternator', value: true, confidence: 0.85 }),
    ], NOW);
    expect(snap.state).toBe('on');
    expect(snap.confirmed).toBe(true);
    expect(snap.primarySource).toBe('engine_running');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10–13 · Öncelik / çelişki / stale / zaman
 * ════════════════════════════════════════════════════════════════════════ */

describe('öncelik, çelişki, zaman güvenliği', () => {
  it('10) taze authoritative yardımcı kaynağı ezer (native off + rpm on → off)', () => {
    const snap = resolveIgnitionState([
      ev({ source: 'native_acc', value: false, confidence: 0.95 }),
      ev({ source: 'rpm', value: true, confidence: 0.99 }),
    ], NOW);
    expect(snap.state).toBe('off');
    expect(snap.confirmed).toBe(false);
    expect(snap.primarySource).toBe('native_acc');
  });

  it('11) iki güvenilir authoritative kaynak çelişirse → unknown (fail-closed)', () => {
    const snap = resolveIgnitionState([
      ev({ source: 'native_acc', value: false, confidence: 0.95 }),
      ev({ source: 'can_ignition', value: true, confidence: 0.92 }),
    ], NOW);
    expect(snap.state).toBe('unknown');
    expect(snap.confirmed).toBeNull();
    expect(snap.reason).toBe('conflict');
  });

  it('12) stale authoritative kaynak onay için kullanılmaz → unknown + stale=true', () => {
    const old = NOW - IGNITION_STALE_MS_DEFAULT - 1;
    const snap = resolveIgnitionState([ev({ source: 'native_acc', value: true, observedAt: old })], NOW);
    expect(snap.state).toBe('unknown');
    expect(snap.confirmed).toBeNull();
    expect(snap.stale).toBe(true);
    expect(snap.reason).toBe('stale_or_low_confidence');
  });

  it('13) saat geriye giderse negatif yaş üretmez → stale (fail-closed)', () => {
    // observedAt gelecekte (now < observedAt) → age<0 → stale
    const snap = resolveIgnitionState([ev({ source: 'native_acc', value: true, observedAt: NOW + 10_000 })], NOW);
    expect(snap.state).toBe('unknown');
    expect(snap.stale).toBe(true);
  });

  it('düşük confidence authoritative onay vermez → unknown', () => {
    const snap = resolveIgnitionState([ev({ source: 'native_acc', value: true, confidence: 0.3 })], NOW);
    expect(snap.confirmed).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 14–17 · Fail-soft / bounded / immutability
 * ════════════════════════════════════════════════════════════════════════ */

describe('fail-soft, bounded, immutability', () => {
  it('14) sağlayıcı throw ederse fail-soft (servis çökmü­yor)', () => {
    const src = make({ providers: [
      () => { throw new Error('kaynak patladı'); },
      () => ev({ source: 'native_acc', value: true }),
    ] });
    expect(() => src.refresh()).not.toThrow();
    expect(src.getConfirmedValue()).toBe(true); // sağlam kaynak değerlendirildi
  });

  it('15) evidence bounded (MAX aşılmaz)', () => {
    const many: IgnitionEvidence[] = Array.from({ length: MAX_IGNITION_EVIDENCE + 20 }, (_, i) =>
      ev({ source: 'rpm', value: true, observedAt: NOW - i }));
    const snap = resolveIgnitionState(many, NOW);
    expect(snap.evidence.length).toBeLessThanOrEqual(MAX_IGNITION_EVIDENCE);
  });

  it('16) snapshot immutable (frozen, mutate atılır)', () => {
    const snap = resolveIgnitionState([ev()], NOW);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.evidence)).toBe(true);
    expect(() => { (snap.evidence as IgnitionEvidence[]).push(ev()); }).toThrow();
  });

  it('17) girdi kanıt objesi mutate edilmiyor', () => {
    const input = ev({ source: 'native_acc', value: true });
    const before = { ...input };
    resolveIgnitionState([input], NOW);
    expect(input).toEqual(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 18–22 · Abonelik / yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

describe('abonelik ve yaşam döngüsü', () => {
  it('18) subscribe/unsubscribe çalışır', () => {
    const src = make();
    let count = 0;
    const unsub = src.subscribe(() => { count++; });
    src.submitEvidence(ev({ source: 'native_acc', value: true }));
    expect(count).toBeGreaterThan(0);
    const after = count;
    unsub();
    src.submitEvidence(ev({ source: 'native_acc', value: false }));
    expect(count).toBe(after); // unsubscribe sonrası çağrılmaz
  });

  it('19) duplicate listener yok', () => {
    const src = make();
    let count = 0;
    const fn = () => { count++; };
    src.subscribe(fn);
    src.subscribe(fn); // aynı fonksiyon
    src.submitEvidence(ev({ source: 'native_acc', value: true }));
    expect(count).toBe(1); // tek kez
  });

  it('20) listener hatası izole (diğer listener + servis etkilenmez)', () => {
    const src = make();
    let good = 0;
    src.subscribe(() => { throw new Error('kötü listener'); });
    src.subscribe(() => { good++; });
    expect(() => src.submitEvidence(ev({ source: 'native_acc', value: true }))).not.toThrow();
    expect(good).toBe(1);
  });

  it('21) reset kanıtları temizler', () => {
    const src = make();
    src.submitEvidence(ev({ source: 'native_acc', value: true }));
    expect(src.getConfirmedValue()).toBe(true);
    src.reset();
    expect(src.getConfirmedValue()).toBeNull();
  });

  it('22) dispose zero-leak — sonrası no-op', () => {
    const src = make();
    src.subscribe(() => { /* */ });
    src.submitEvidence(ev({ source: 'native_acc', value: true }));
    src.dispose();
    expect(src.listenerCount).toBe(0);
    expect(src.isDisposed).toBe(true);
    // dispose sonrası API güvenli no-op
    expect(() => src.submitEvidence(ev())).not.toThrow();
    expect(src.getConfirmedValue()).toBeNull();
  });

  it('start/refresh idempotent — çift refresh aynı sonuç', () => {
    const src = make({ providers: [() => ev({ source: 'can_ignition', value: true })] });
    const a = src.refresh();
    const b = src.refresh();
    expect(a.confirmed).toBe(b.confirmed);
    expect(b.confirmed).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 23–28 · Yalıtım / privacy / manual / performans
 * ════════════════════════════════════════════════════════════════════════ */

describe('yalıtım, privacy, manual override', () => {
  it('23) yapıcı YAN ETKİSİZ — provider construction sırasında çağrılmaz', () => {
    let called = 0;
    const src = make({ providers: [() => { called++; return ev(); }] });
    expect(called).toBe(0);            // constructor provider çağırmadı
    src.refresh();
    expect(called).toBe(1);            // yalnız refresh çağırır
  });

  it('24 & 33) kaynak SystemBoot / runtime servis IMPORT etmez (wiring yok)', () => {
    expect(/from\s+['"][^'"]*SystemBoot['"]/.test(ignitionSource)).toBe(false);
    expect(/from\s+['"]\.\/deepScanRuntimeService['"]/.test(ignitionSource)).toBe(false);
    expect(/from\s+['"]\.\/deepScanModel['"]/.test(ignitionSource)).toBe(true); // yalnız pure model
  });

  it('25) ignition source kullanımı Deep Scan Runtime durumunu DEĞİŞTİRMEZ', () => {
    deepScanRuntimeService.reset();
    const before = deepScanRuntimeService.getSnapshot().status;
    const src = make();
    src.submitEvidence(ev({ source: 'native_acc', value: true }));
    src.getConfirmedValue();
    expect(deepScanRuntimeService.getSnapshot().status).toBe(before); // idle → değişmedi
  });

  it('26) privacy — reason içindeki VIN/koordinat temizlenir, snapshot ham içermez', () => {
    const snap = resolveIgnitionState([
      ev({ source: 'native_acc', value: true, reason: 'arac 1HGCM82633A004352 41.0082,28.9784' }),
    ], NOW);
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain('1HGCM82633A004352'); // VIN redakte
    expect(serialized).not.toContain('41.0082,28.9784');    // koordinat redakte
  });

  it('27) manual override PRODUCTION varsayılan KAPALI (etkisiz)', () => {
    const prod = make(); // allowManualOverride verilmedi → false
    prod.setManualOverride(true);
    expect(prod.getConfirmedValue()).toBeNull(); // override yok sayıldı

    const dev = make({ allowManualOverride: true });
    dev.setManualOverride(true);
    expect(dev.getConfirmedValue()).toBe(true);   // yalnız dev/test'te etkili
    dev.setManualOverride(null);
    expect(dev.getConfirmedValue()).toBeNull();    // kaldırılabilir
  });

  it('28) BASIC_JS — resolver saf/sabit iş; timer açmaz, provider yoksa yük yok', () => {
    const src = make(); // provider yok
    // Timer kanıtı: refresh senkron döner, hiçbir async kaynak beklenmez
    const snap = src.refresh();
    expect(snap.state).toBe('unknown');
    expect(src.listenerCount).toBe(0);
    // MAX listener kapısı da bounded
    expect(MAX_IGNITION_LISTENERS).toBeGreaterThan(0);
  });

  it('submitEvidence aynı kaynağın kanıtını günceller (bounded, kaynak başına tek)', () => {
    const src = make();
    src.submitEvidence(ev({ source: 'native_acc', value: true }));
    const snap = src.submitEvidence(ev({ source: 'native_acc', value: false }));
    expect(snap.confirmed).toBe(false); // son kanıt geçerli
    expect(snap.evidence.filter((e) => e.source === 'native_acc')).toHaveLength(1);
  });
});
