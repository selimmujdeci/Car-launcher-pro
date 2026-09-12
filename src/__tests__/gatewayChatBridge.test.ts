/**
 * gatewayChatBridge.test.ts — mevcut AI tüketicileri ile AI Gateway arasındaki köprü.
 *
 * Kilit: konuşma (system + geçmiş + kullanıcı) AYNEN taşınır · boş cevap başarı
 * sayılmaz · DEVRE KESİCİ semantiği korunur (yalnız network/timeout gerçek ağ
 * ölümü) · köprü asla throw etmez · streaming onToken geçirilir.
 *
 * AYRI DOSYA: wiring testleri bu modülü mock'lar; gerçek davranışı burada.
 */

import { describe, it, expect } from 'vitest';
import { askGatewayChat } from '../platform/ai/gateway/gatewayChatBridge';
import type { AiGateway, AiGenerateRequest, AiGenerateResult, AiErrorKind } from '../platform/ai/gateway/types';

/* ── Sahte gateway (yalnız soyutlama — somut sağlayıcı YOK) ────────────────── */

function fakeGateway(result: AiGenerateResult): AiGateway & { seen: AiGenerateRequest[] } {
  const seen: AiGenerateRequest[] = [];
  return {
    seen,
    async generateResponse(request) { seen.push(request); return result; },
  };
}

const okText = (text: string): AiGenerateResult => ({
  ok: true, text, model: 'm', provider: 'p', streamed: false,
});
const errKind = (kind: AiErrorKind): AiGenerateResult => ({
  ok: false, error: { kind, message: 'hata', retryable: false },
});


describe('gatewayChatBridge — konuşma taşıma ve hata semantiği', () => {
  it('system + geçmiş + kullanıcı mesajı SIRASIYLA taşınır', async () => {
    const gw = fakeGateway(okText('cevap'));
    await askGatewayChat({
      gateway: gw,
      system:  'SYS',
      history: [
        { role: 'user',      content: 'ilk soru' },
        { role: 'assistant', content: 'ilk cevap' },
      ],
      user: 'ikinci soru',
    });

    expect(gw.seen[0]?.messages).toEqual([
      { role: 'system',    content: 'SYS' },
      { role: 'user',      content: 'ilk soru' },
      { role: 'assistant', content: 'ilk cevap' },
      { role: 'user',      content: 'ikinci soru' },
    ]);
  });

  it('boş/bozuk geçmiş turları atlanır (istek bozulmaz)', async () => {
    const gw = fakeGateway(okText('x'));
    await askGatewayChat({
      gateway: gw,
      system:  'SYS',
      history: [
        { role: 'user', content: '' },
        null as never,
        { role: 'assistant', content: 'geçerli' },
      ],
      user: 'soru',
    });
    expect(gw.seen[0]?.messages).toEqual([
      { role: 'system',    content: 'SYS' },
      { role: 'assistant', content: 'geçerli' },
      { role: 'user',      content: 'soru' },
    ]);
  });

  it('timeout/maxTokens/temperature yalnız verilince geçer', async () => {
    const bare = fakeGateway(okText('x'));
    await askGatewayChat({ gateway: bare, system: 's', user: 'u' });
    expect(bare.seen[0]).toEqual({ messages: expect.any(Array) });

    const full = fakeGateway(okText('x'));
    await askGatewayChat({ gateway: full, system: 's', user: 'u', timeoutMs: 1234, maxTokens: 55, temperature: 0.4 });
    expect(full.seen[0]?.timeoutMs).toBe(1234);
    expect(full.seen[0]?.maxTokens).toBe(55);
    expect(full.seen[0]?.temperature).toBe(0.4);
  });

  it('başarılı cevap trim edilerek döner', async () => {
    const r = await askGatewayChat({ gateway: fakeGateway(okText('  cevap  ')), system: 's', user: 'u' });
    expect(r).toEqual({ ok: true, text: 'cevap' });
  });

  it('boş metin BAŞARI sayılmaz (uydurma yok) ama ağ ölümü de değildir', async () => {
    const r = await askGatewayChat({ gateway: fakeGateway(okText('   ')), system: 's', user: 'u' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errorKind).toBe('malformed_response'); expect(r.netFailure).toBe(false); }
  });

  it('DEVRE KESİCİ: yalnız network/timeout gerçek ağ ölümüdür', async () => {
    for (const kind of ['network', 'timeout'] as AiErrorKind[]) {
      const r = await askGatewayChat({ gateway: fakeGateway(errKind(kind)), system: 's', user: 'u' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.netFailure).toBe(true);
    }
    // HTTP yanıtı alınan / yerel kapı hataları → ağ CANLI, kesiciye YAZILMAZ
    for (const kind of ['rate_limited', 'auth', 'server', 'invalid_request',
                        'malformed_response', 'no_api_key', 'offline',
                        'circuit_open', 'aborted', 'no_provider'] as AiErrorKind[]) {
      const r = await askGatewayChat({ gateway: fakeGateway(errKind(kind)), system: 's', user: 'u' });
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.netFailure).toBe(false); expect(r.errorKind).toBe(kind); }
    }
  });

  it('gateway throw ederse köprü throw ETMEZ (savunmacı)', async () => {
    const broken: AiGateway = { generateResponse: async () => { throw new Error('patladı'); } };
    const r = await askGatewayChat({ gateway: broken, system: 's', user: 'u' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.errorKind).toBe('unknown'); expect(r.netFailure).toBe(false); }
  });

  it('streaming: onToken gateway seçeneklerine iletilir', async () => {
    let sawOnToken = false;
    const streamingGw: AiGateway = {
      async generateResponse(_req, opts) {
        sawOnToken = typeof opts?.onToken === 'function';
        opts?.onToken?.('mer'); opts?.onToken?.('haba');
        return okText('merhaba');
      },
    };
    const seen: string[] = [];
    const r = await askGatewayChat({ gateway: streamingGw, system: 's', user: 'u', onToken: (t) => seen.push(t) });
    expect(sawOnToken).toBe(true);
    expect(seen).toEqual(['mer', 'haba']);
    expect(r.ok).toBe(true);
  });
});

