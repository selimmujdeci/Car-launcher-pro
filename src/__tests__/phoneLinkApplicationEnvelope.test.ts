/**
 * phoneLinkApplicationEnvelope.test.ts — PHONE LINK F2 · zarf ayrıştırma kilitleri.
 *
 * Kilitlenen güvenlik kapıları: 7 (malformed) · 8 (unknown version) ·
 * 9 (unknown command) · 10 (oversized).
 */

import { describe, it, expect } from 'vitest';
import {
  parseApplicationRequest, buildApplicationResponse, serializeApplicationResponse,
  PHONE_LINK_APP_MESSAGE_VERSION, MAX_APPLICATION_MESSAGE_CHARS,
} from '../platform/phoneLink/phoneLinkApplicationEnvelope';

function req(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-1', type: 'MUSIC_COMMAND', command: 'PLAY', ...over });
}

describe('parseApplicationRequest — geçerli girdi', () => {
  it('geçerli PLAY isteği ayrıştırılır', () => {
    const r = parseApplicationRequest(req());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.command).toBe('PLAY');
      expect(r.request.id).toBe('msg-1');
    }
  });

  it('6 komutun tamamı tanınır', () => {
    for (const c of ['GET_NOW_PLAYING', 'PLAY', 'PAUSE', 'NEXT', 'PREVIOUS', 'GET_QUEUE']) {
      const r = parseApplicationRequest(req({ command: c }));
      expect(r.ok, c).toBe(true);
    }
  });

  it('bilinmeyen EK alan sessizce yok sayılır ama çıktıya taşınmaz', () => {
    /* `__proto__: 'x'` nesne yazımında ÖZELLİK oluşturmaz, prototipi ayarlamaya
       çalışır (CodeQL invalid-prototype-value) → test o anahtarı HİÇ denemiyordu.
       Hesaplanmış anahtar gerçek bir `__proto__` özelliği yaratır (JSON.parse gibi). */
    const r = parseApplicationRequest(req({ extra: 'should-not-leak', ['__proto__']: 'x' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.request).sort()).toEqual(['command', 'id', 'type', 'v']);
    }
  });
});

describe('Gate 7 — malformed envelope reddedilir', () => {
  it('boş dize', () => {
    expect(parseApplicationRequest('').ok).toBe(false);
  });

  it('geçersiz JSON', () => {
    const r = parseApplicationRequest('{not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_MALFORMED');
  });

  it('dizi (obje değil)', () => {
    const r = parseApplicationRequest('[1,2,3]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_MALFORMED');
  });

  it('null', () => {
    const r = parseApplicationRequest('null');
    expect(r.ok).toBe(false);
  });

  it('id alanı eksik', () => {
    const raw = JSON.stringify({ v: 1, type: 'MUSIC_COMMAND', command: 'PLAY' });
    const r = parseApplicationRequest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_MALFORMED');
  });

  it('id yanlış tipte (sayı)', () => {
    const r = parseApplicationRequest(req({ id: 123 }));
    expect(r.ok).toBe(false);
  });

  it('id geçersiz karakter taşıyor (bounded desen dışı)', () => {
    const r = parseApplicationRequest(req({ id: 'has spaces/slash' }));
    expect(r.ok).toBe(false);
  });

  it('id 64 karakteri aşıyor', () => {
    const r = parseApplicationRequest(req({ id: 'a'.repeat(65) }));
    expect(r.ok).toBe(false);
  });
});

describe('Gate 8 — bilinmeyen sürüm reddedilir', () => {
  it('v=2 (henüz desteklenmeyen sürüm)', () => {
    const r = parseApplicationRequest(req({ v: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_UNSUPPORTED');
  });

  it('v eksik', () => {
    const raw = JSON.stringify({ id: 'msg-1', type: 'MUSIC_COMMAND', command: 'PLAY' });
    const r = parseApplicationRequest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_UNSUPPORTED');
  });

  it('v dize olarak gelirse de reddedilir (tip zorlaması YOK)', () => {
    const r = parseApplicationRequest(req({ v: '1' }));
    expect(r.ok).toBe(false);
  });
});

describe('bilinmeyen tür reddedilir (REJECTED_UNSUPPORTED)', () => {
  it('type "VEHICLE_COMMAND" — arbitrary method adı YOK', () => {
    const r = parseApplicationRequest(req({ type: 'VEHICLE_COMMAND' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_UNSUPPORTED');
  });
});

describe('Gate 9 — bilinmeyen komut reddedilir', () => {
  it('"CLEAR_DTC" gibi destructive/ilgisiz bir komut asla kabul edilmez', () => {
    const r = parseApplicationRequest(req({ command: 'CLEAR_DTC' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_UNSUPPORTED');
  });

  it('reflection/method-adı benzeri komut reddedilir', () => {
    const r = parseApplicationRequest(req({ command: 'Runtime.exec' }));
    expect(r.ok).toBe(false);
  });
});

describe('Gate 10 — aşırı büyük yük reddedilir', () => {
  it(`${MAX_APPLICATION_MESSAGE_CHARS} karakteri aşan yük REJECTED_MALFORMED`, () => {
    const huge = req({ id: 'a'.repeat(1) }) + ' '.repeat(MAX_APPLICATION_MESSAGE_CHARS);
    const r = parseApplicationRequest(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('REJECTED_MALFORMED');
  });
});

describe('yanıt zarfı', () => {
  it('ACCEPTED yanıtı sabit alanları taşır', () => {
    const resp = buildApplicationResponse('msg-1', 'ACCEPTED');
    expect(resp).toEqual({ v: PHONE_LINK_APP_MESSAGE_VERSION, id: 'msg-1', status: 'ACCEPTED' });
    expect(serializeApplicationResponse(resp)).toContain('"status":"ACCEPTED"');
  });

  it('result verilirse yanıta eklenir', () => {
    const resp = buildApplicationResponse('msg-1', 'ACCEPTED', { trackId: 't1' });
    expect(resp.result).toEqual({ trackId: 't1' });
  });

  it('serileştirilmiş yanıt hiçbir iç ayrıntı (stack/path) TAŞIMAZ', () => {
    const resp = buildApplicationResponse('msg-1', 'FAILED');
    const text = serializeApplicationResponse(resp);
    expect(text).not.toMatch(/stack|Exception|\.java|\.ts:/i);
  });
});
