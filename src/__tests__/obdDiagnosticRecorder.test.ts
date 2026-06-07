/**
 * obdDiagnosticRecorder.test.ts — OBD Teşhis Timeline kayıt motoru testleri.
 *
 * Kapsam:
 *  - oturum başlatma + sessionId
 *  - event append + kronolojik sıra
 *  - bounded ring buffer (MAX_EVENTS taşması)
 *  - reason → FAILURE_META otomatik doldurma
 *  - MAC maskeleme (gizlilik)
 *  - JSON + metin export
 *  - subscribe/unsubscribe (zero-leak)
 *  - clear / disposeAll
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllStorage } from './helpers';
import {
  startSession,
  setSessionDevice,
  endSession,
  recordDiag,
  getEvents,
  getSession,
  loadLastSession,
  exportJson,
  exportText,
  subscribe,
  registerDisposer,
  disposeAll,
  clear,
  maskMac,
} from '../platform/obdDiagnosticRecorder';

beforeEach(() => {
  clearAllStorage();
  clear();
  startSession();
});

describe('obdDiagnosticRecorder — oturum & kayıt', () => {
  it('startSession sessionId döner ve buffer boş başlar', () => {
    const id = startSession();
    expect(id).toMatch(/^obd-/);
    expect(getEvents()).toHaveLength(0);
  });

  it('recordDiag event ekler, kronolojik sırada okunur', () => {
    recordDiag({ stage: 'scan', status: 'pending' });
    recordDiag({ stage: 'deviceFound', status: 'info' });
    recordDiag({ stage: 'connectClassic', status: 'success' });
    const ev = getEvents();
    expect(ev.map((e) => e.stage)).toEqual(['scan', 'deviceFound', 'connectClassic']);
    expect(ev[0].id).toBe('evt-0');
    expect(ev[2].id).toBe('evt-2');
  });

  it('event zaman damgaları monotonik (tsMonoMs artan)', () => {
    recordDiag({ stage: 'scan', status: 'pending' });
    recordDiag({ stage: 'liveData', status: 'success' });
    const [a, b] = getEvents();
    expect(b.tsMonoMs).toBeGreaterThanOrEqual(a.tsMonoMs);
    expect(typeof a.tsWallMs).toBe('number');
  });
});

describe('obdDiagnosticRecorder — bounded ring buffer', () => {
  it('MAX_EVENTS üstü yazımda en eskiyi düşürür, en yeniyi tutar', () => {
    // MAX_EVENTS = 200; 250 yaz → son 200 kalmalı.
    for (let i = 0; i < 250; i++) {
      recordDiag({ stage: 'retry', status: 'info', technicalMessage: `n=${i}` });
    }
    const ev = getEvents();
    expect(ev).toHaveLength(200);
    // En yeni event'in tech mesajı 249 olmalı; en eski 50.
    expect(ev[ev.length - 1].technicalMessage).toBe('n=249');
    expect(ev[0].technicalMessage).toBe('n=50');
  });
});

describe('obdDiagnosticRecorder — reason → FAILURE_META', () => {
  it('reason verilince userMessage/nextAction/severity otomatik dolar', () => {
    const e = recordDiag({ stage: 'scan', status: 'fail', reason: 'NO_DEVICE_FOUND' });
    expect(e.userMessage).toContain('bulunamadı');
    expect(e.nextAction).toBeTruthy();
    expect(e.severity).toBe('high');
  });

  it('açık userMessage verilirse meta override edilmez', () => {
    const e = recordDiag({ stage: 'bluetooth', status: 'fail', reason: 'BT_OFF', userMessage: 'Özel mesaj' });
    expect(e.userMessage).toBe('Özel mesaj');
  });
});

describe('obdDiagnosticRecorder — MAC maskeleme', () => {
  it('tam MAC ortadan maskelenir', () => {
    expect(maskMac('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:**:**:**:FF');
  });
  it('MAC olmayan string uçlardan kısaltılır', () => {
    expect(maskMac('OBDII-Device-Long')).toMatch(/…/);
  });
  it('setSessionDevice cihaz adresini maskeli saklar', () => {
    setSessionDevice({ name: 'iCar', address: '11:22:33:44:55:66', transport: 'classic' });
    expect(getSession().device?.addrMasked).toBe('11:22:**:**:**:66');
  });
});

describe('obdDiagnosticRecorder — export', () => {
  beforeEach(() => {
    setSessionDevice({ name: 'ELM327', address: 'AA:BB:CC:DD:EE:FF', transport: 'classic' });
    recordDiag({ stage: 'scan', status: 'pending' });
    recordDiag({ stage: 'connectClassic', status: 'fail', reason: 'RFCOMM_ALL_FAILED', command: 'ATZ', durationMs: 1200 });
  });

  it('exportJson geçerli JSON ve maskeli adres içerir', () => {
    const json = JSON.parse(exportJson());
    expect(json.device.addrMasked).toBe('AA:BB:**:**:**:FF');
    expect(json.events).toHaveLength(2);
    // Ham MAC export'ta SIZMAMALI.
    expect(exportJson()).not.toContain('CC:DD:EE');
  });

  it('exportText okunur döküm ve komut/süre içerir', () => {
    const txt = exportText();
    expect(txt).toContain('OBD Teşhis Oturumu');
    expect(txt).toContain('cmd=ATZ');
    expect(txt).toContain('1200ms');
  });

  it('endSession son oturumu kalıcı yazar, loadLastSession okur', () => {
    endSession('failed');
    const last = loadLastSession();
    expect(last?.outcome).toBe('failed');
    expect(last?.events.length).toBe(2);
  });
});

describe('obdDiagnosticRecorder — abonelik & temizlik', () => {
  it('subscribe değişimde tetiklenir, unsubscribe durdurur', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    recordDiag({ stage: 'scan', status: 'pending' });
    expect(cb).toHaveBeenCalled();
    off();
    cb.mockClear();
    recordDiag({ stage: 'retry', status: 'info' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('disposeAll kayıtlı disposer’ları çalıştırır ve aboneleri temizler', () => {
    const disposer = vi.fn();
    registerDisposer(disposer);
    const cb = vi.fn();
    subscribe(cb);
    disposeAll();
    expect(disposer).toHaveBeenCalledTimes(1);
    cb.mockClear();
    recordDiag({ stage: 'scan', status: 'info' });
    expect(cb).not.toHaveBeenCalled();   // abone temizlendi
  });

  it('clear buffer’ı boşaltır', () => {
    recordDiag({ stage: 'scan', status: 'pending' });
    expect(getEvents().length).toBeGreaterThan(0);
    clear();
    expect(getEvents()).toHaveLength(0);
  });
});
