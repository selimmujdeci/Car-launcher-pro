/**
 * aiGatewayProviderUnusable.test.ts — SAHA 2026-09-11 · her turda tekrarlanan
 * `402 Insufficient credits`.
 *
 * ÖLÇÜM (cihaz, ağ izi): zincirin İLK sağlayıcısı (openrouter.ai) 4 turun
 * 4'ünde de deneniyor ve 402 ile düşüyordu — tur başına 0,17-0,78 sn sabit
 * gecikme vergisi. Zincirin `retryable:false` kararı YALNIZ o çağrı içinde
 * geçerliydi; bir sonraki tur sıfırdan deniyordu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAiGateway } from '../platform/ai/gateway/aiGateway';
import type { AiProvider, AiErrorKind } from '../platform/ai/gateway/types';

function mkProvider(id: string, behave: () => { ok: boolean; kind?: AiErrorKind }): {
  provider: AiProvider; calls: () => number;
} {
  let n = 0;
  const provider = {
    id,
    defaultModel: `${id}-model`,
    generate: async () => {
      n++;
      const r = behave();
      return r.ok
        ? { ok: true as const, text: `cevap-${id}`, model: `${id}-model`, attempts: [] }
        : { ok: false as const, error: { kind: r.kind as AiErrorKind, message: 'hata', retryable: false } };
    },
  } as unknown as AiProvider;
  return { provider, calls: () => n };
}

const REQ = { messages: [{ role: 'user' as const, content: 'merhaba' }] };
const net = { isOnline: () => true };

describe('gateway — kullanıcı eylemi bekleyen sağlayıcı bounded süre ATLANIR', () => {
  /* Hafıza gateway ÖRNEĞİNE ait — her test kendi örneğini kurduğu için
     sıfırlama kancasına gerek YOKTUR (izolasyon yapısaldır). */
  beforeEach(() => { vi.restoreAllMocks(); });

  it('SAHA: 402 sonrası AYNI sağlayıcı bir sonraki turda DENENMEZ', async () => {
    const a = mkProvider('krediSiz', () => ({ ok: false, kind: 'insufficient_credit' }));
    const b = mkProvider('calisan',  () => ({ ok: true }));
    const gw = createAiGateway({ providers: [a.provider, b.provider], network: net });

    const t1 = await gw.generateResponse(REQ);
    expect(t1.ok).toBe(true);
    expect(a.calls()).toBe(1);   // ilk turda öğrenildi

    const t2 = await gw.generateResponse(REQ);
    expect(t2.ok).toBe(true);
    expect(a.calls(), 'kredisiz sağlayıcı her turda yeniden deneniyor').toBe(1);
    expect(b.calls()).toBe(2);
  });

  it('kimlik arızası (auth) da aynı şekilde elenir', async () => {
    const a = mkProvider('anahtarsiz', () => ({ ok: false, kind: 'auth' }));
    const b = mkProvider('calisan',    () => ({ ok: true }));
    const gw = createAiGateway({ providers: [a.provider, b.provider], network: net });
    await gw.generateResponse(REQ);
    await gw.generateResponse(REQ);
    expect(a.calls()).toBe(1);
  });

  it('GEÇİCİ arıza elenmez — 429/5xx her turda yeniden denenir', async () => {
    const a = mkProvider('kotali', () => ({ ok: false, kind: 'rate_limited' }));
    const b = mkProvider('calisan', () => ({ ok: true }));
    const gw = createAiGateway({ providers: [a.provider, b.provider], network: net });
    await gw.generateResponse(REQ);
    await gw.generateResponse(REQ);
    expect(a.calls(), 'geçici arıza kalıcı gibi ele alınmış').toBe(2);
  });

  it('FAIL-SOFT: hepsi elenirse hafıza YOK SAYILIR (asistan susmaz)', async () => {
    let kredi = false;
    const a = mkProvider('tek', () => (kredi ? { ok: true } : { ok: false, kind: 'insufficient_credit' }));
    const gw = createAiGateway({ providers: [a.provider], network: net });

    const t1 = await gw.generateResponse(REQ);
    expect(t1.ok).toBe(false);
    kredi = true;                       // kullanıcı bakiye yükledi
    const t2 = await gw.generateResponse(REQ);
    expect(t2.ok, 'tek sağlayıcı elenip asistan kalıcı susmuş').toBe(true);
    expect(a.calls()).toBe(2);
  });
});
