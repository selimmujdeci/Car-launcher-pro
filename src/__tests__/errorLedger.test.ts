/**
 * errorLedger.test.ts — Diagnostics V2 · PR-2 (ESKİ/YENİ hata ayrımı).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. sessionStartMs sınırı: ts < başlangıç → önceki oturum (activeNow:false,
 *     bootId:null); ts >= başlangıç → bu oturum (activeNow:true, bootId set).
 *  2. Dedup: ctx + NORMALİZE mesaj (rakam/hex/uuid → '#') tek imzada birleşir;
 *     occurrence sayılır, firstSeen/lastSeen doğru.
 *  3. En yeni önce sıralı; sayaçlar (activeNowCount/previousBootCount) tutarlı.
 *  4. Fail-soft: geçersiz/zamansız eleman ELENİR, motor patlamaz.
 *
 * SAHA GERÇEĞİ (2026-07-14): kalıcı ring'teki 7 saatlik OBD:Reconnect/GPS hataları
 * raporu kirletiyordu — bu defter onları activeNow:false olarak ayırır.
 */
import { describe, it, expect } from 'vitest';
import { buildErrorLedger, type RawErrorLike } from '../platform/errorLedger';

const SESSION_START = 1_000_000; // sınır
const CTX = { nowMs: 1_002_000, sessionStartMs: SESSION_START, bootId: 'boot1234' };

describe('buildErrorLedger — PR-2', () => {
  it('eski (önceki boot) hatayı activeNow:false + bootId:null olarak ayırır', () => {
    const errors: RawErrorLike[] = [
      { ts: SESSION_START - 500_000, ctx: 'OBD:Reconnect', msg: 'timeout (3s)', severity: 'error' },
    ];
    const led = buildErrorLedger(errors, CTX);
    expect(led.entries).toHaveLength(1);
    expect(led.entries[0].activeNow).toBe(false);
    expect(led.entries[0].bootId).toBeNull();
    expect(led.entries[0].sessionId).toBeNull();
    expect(led.previousBootCount).toBe(1);
    expect(led.activeNowCount).toBe(0);
  });

  it('bu oturum hatasını activeNow:true + bootId set olarak işaretler', () => {
    const errors: RawErrorLike[] = [
      { ts: SESSION_START + 100, ctx: 'GPS', msg: 'permission denied', severity: 'error' },
    ];
    const led = buildErrorLedger(errors, CTX);
    expect(led.entries[0].activeNow).toBe(true);
    expect(led.entries[0].bootId).toBe('boot1234');
    expect(led.entries[0].sessionId).toBe('boot1234');
    expect(led.currentBootCount).toBe(1);
    expect(led.previousBootCount).toBe(0);
  });

  it('rakam-değişen aynı hatayı TEK imzada birleştirir (occurrence + firstSeen/lastSeen)', () => {
    const errors: RawErrorLike[] = [
      { ts: SESSION_START + 10, ctx: 'HealthMonitor:GPS', msg: 'No heartbeat for 36s' },
      { ts: SESSION_START + 40, ctx: 'HealthMonitor:GPS', msg: 'No heartbeat for 15s' },
      { ts: SESSION_START + 20, ctx: 'HealthMonitor:GPS', msg: 'No heartbeat for 85s' },
    ];
    const led = buildErrorLedger(errors, CTX);
    expect(led.entries).toHaveLength(1);
    const e = led.entries[0];
    expect(e.occurrence).toBe(3);
    expect(e.firstSeen).toBe(SESSION_START + 10);
    expect(e.lastSeen).toBe(SESSION_START + 40);      // en yeni ts
    expect(e.message).toBe('No heartbeat for 15s');    // en yeni örnek temsil eder
    expect(e.signature).toContain('#');                // normalize edilmiş
  });

  it('eski ve yeni karışık → en yeni önce sıralı, sayaçlar tutarlı', () => {
    const errors: RawErrorLike[] = [
      { ts: SESSION_START - 700_000, ctx: 'OBD:Reconnect', msg: 'timeout (3s)' },
      { ts: SESSION_START + 500, ctx: 'DTC:Read', msg: 'DTC_READ_FAILED' },
      { ts: SESSION_START - 300_000, ctx: 'HealthMonitor:GPS', msg: 'No heartbeat for 20s' },
    ];
    const led = buildErrorLedger(errors, CTX);
    expect(led.total).toBe(3);
    expect(led.activeNowCount).toBe(1);
    expect(led.previousBootCount).toBe(2);
    // en yeni (DTC bu oturum) ilk sırada
    expect(led.entries[0].ctx).toBe('DTC:Read');
    expect(led.entries[0].activeNow).toBe(true);
    // lastSeen azalan
    for (let i = 1; i < led.entries.length; i++) {
      expect(led.entries[i - 1].lastSeen).toBeGreaterThanOrEqual(led.entries[i].lastSeen);
    }
  });

  it('fail-soft: geçersiz/zamansız eleman elenir, motor patlamaz', () => {
    const errors = [
      null,
      { ctx: 'NoTs', msg: 'zaman yok' },              // ts yok → atla
      { ts: 'x' as unknown as number, ctx: 'BadTs', msg: 'bozuk' }, // ts sayı değil → atla
      { ts: SESSION_START + 5, ctx: 'OK', msg: 'geçerli' },
    ] as RawErrorLike[];
    const led = buildErrorLedger(errors, CTX);
    expect(led.total).toBe(1);
    expect(led.entries[0].ctx).toBe('OK');
  });

  it('boş/null girdi → boş defter, sayaçlar 0', () => {
    expect(buildErrorLedger(null, CTX).total).toBe(0);
    expect(buildErrorLedger([], CTX).activeNowCount).toBe(0);
  });
});
