/**
 * dtcAiExplanation.test.ts — arıza kayıtlarının yapay zekâ ile açıklanması.
 *
 * Kilitlenen sözleşme: modele YALNIZ ölçülen gerçekler gider (VIN yalnız WMI olarak),
 * "test tamamlanmadı" arıza sayılmaz, üreticiye özgü kodlarda kesin anlam istenmez,
 * kayıt yoksa istek GÖNDERİLMEZ, hata dürüstçe raporlanır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../platform/obdService', () => ({ getObdSessionEpoch: vi.fn(() => 3) }));
vi.mock('../platform/vehicle/vehicleIdentity', () => ({
  getVehicleIdentity: vi.fn(() => ({ state: 'SINGLE', facts: { wmi: 'VF1' } })),
}));
vi.mock('../platform/ai/gateway/concrete/defaultAiGateway', () => ({ getDefaultAiGateway: vi.fn() }));

import { getVehicleIdentity } from '../platform/vehicle/vehicleIdentity';
import {
  buildDtcExplainMessages, explainDtcsWithAi, toPlainExplanation, type DtcExplainItem,
} from '../platform/obd/dtcAiExplanation';
import type { AiGateway, AiGenerateRequest, AiGenerateResult } from '../platform/ai/gateway/types';

/* Saha kayıtları (2026-09-22): şanzıman onaylı U-kodları + motorda "test tamamlanmadı". */
const ITEMS: DtcExplainItem[] = [
  { code: 'U1225', subCode: '86', ecu: 'ECU 7E1', state: 'CONFIRMED_INACTIVE', source: 'UDS' },
  { code: 'U1226', subCode: '86', ecu: 'ECU 7E1', state: 'CONFIRMED_INACTIVE', source: 'UDS' },
  { code: 'P2031', subCode: '16', ecu: 'Motor (ECM)', state: 'TEST_INCOMPLETE', source: 'UDS' },
];

function fakeGateway(result: AiGenerateResult): { gw: AiGateway; calls: AiGenerateRequest[] } {
  const calls: AiGenerateRequest[] = [];
  return {
    calls,
    gw: { generateResponse: vi.fn(async (req: AiGenerateRequest) => { calls.push(req); return result; }) },
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('modele giden mesaj — yalnız ölçülen gerçekler', () => {
  it('🔒 kod · alt kod · ECU · durum etiketi gider; WMI verildiyse eklenir', () => {
    const [sys, user] = buildDtcExplainMessages(ITEMS, 'VF1');
    expect(sys!.role).toBe('system');
    expect(user!.content).toContain('- U1225(86) · ECU 7E1 · ONAYLI (şu an düşmüyor) · kaynak UDS');
    expect(user!.content).toContain('- P2031(16) · Motor (ECM) · TEST TAMAMLANMADI · kaynak UDS');
    expect(user!.content).toContain('WMI) VF1');
  });

  it('🔒 VIN\'in tamamı modele SIZMAZ (yalnız 3 haneli WMI kabul edilir)', () => {
    const [, user] = buildDtcExplainMessages(ITEMS, 'VF1RFB00259328569');
    expect(user!.content).not.toContain('VF1RFB00259328569');
    expect(user!.content).toContain('marka bilinmiyor');
  });

  it('🔒 kurallar: uydurma yok · "test tamamlanmadı" arıza değil · üreticiye özgü kod', () => {
    const [sys] = buildDtcExplainMessages(ITEMS, null);
    expect(sys!.content).toMatch(/UYDURMA/);
    expect(sys!.content).toMatch(/TEST TAMAMLANMADI" arıza DEĞİLDİR/);
    expect(sys!.content).toMatch(/ÜRETİCİYE ÖZGÜDÜR/);
    expect(sys!.content).toMatch(/güvenli olduğunu SÖYLEME/);
  });
});

describe('explainDtcsWithAi', () => {
  it('başarılı yanıt düz metne çevrilir ve model adıyla döner', async () => {
    const { gw, calls } = fakeGateway({
      ok: true, text: '## ŞANZIMAN\n**U1225** iletişim\n- servis', model: 'gemini-x', provider: 'gemini', streamed: false,
    });
    const r = await explainDtcsWithAi(ITEMS, { gateway: gw, vehicleWmi: 'VF1' });
    expect(r).toEqual({ ok: true, text: 'ŞANZIMAN\nU1225 iletişim\n• servis', model: 'gemini-x' });
    expect(calls[0]!.temperature).toBeLessThanOrEqual(0.3);
  });

  it('🔒 kayıt yoksa istek GÖNDERİLMEZ ("temiz araç" yorumu üretilmez)', async () => {
    const { gw } = fakeGateway({ ok: true, text: 'x', model: 'm', provider: 'p', streamed: false });
    const r = await explainDtcsWithAi([], { gateway: gw, vehicleWmi: null });
    expect(r.ok).toBe(false);
    expect(gw.generateResponse).not.toHaveBeenCalled();
  });

  it('anahtar yoksa kullanıcıya ne yapacağı söylenir', async () => {
    const { gw } = fakeGateway({ ok: false, error: { kind: 'no_api_key', message: 'k', retryable: false } as never });
    const r = await explainDtcsWithAi(ITEMS, { gateway: gw, vehicleWmi: null });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/anahtarı tanımlı değil/) });
  });

  it('WMI yalnız tek/doğrulanmış kimlikten gelir; bayat kimlik marka üretmez', async () => {
    const { gw, calls } = fakeGateway({ ok: true, text: 'a', model: 'm', provider: 'p', streamed: false });
    await explainDtcsWithAi(ITEMS, { gateway: gw });
    expect(calls[0]!.messages[1]!.content).toContain('WMI) VF1');

    vi.mocked(getVehicleIdentity).mockReturnValue({ state: 'STALE', facts: { wmi: 'VF1' } } as never);
    await explainDtcsWithAi(ITEMS, { gateway: gw });
    expect(calls[1]!.messages[1]!.content).toContain('marka bilinmiyor');
  });
});

describe('toPlainExplanation', () => {
  it('markdown işaretlerini temizler, içeriği korur', () => {
    expect(toPlainExplanation('# Başlık\n\n\n\n* madde\n**kalın**')).toBe('Başlık\n\n• madde\nkalın');
  });
});
