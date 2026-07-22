/**
 * aiGatewayFlag.test.ts — Mavi AI Gateway rollback şalteri.
 *
 * Kilit: VARSAYILAN KAPALI (mevcut davranış), yalnız tam "true" açar,
 * yapılandırma hatasında fail-closed, değer tur ortasında değişmez (önbellek).
 *
 * AYRI DOSYA: companion wiring testleri bu modülü mock'lar; bayrağın GERÇEK
 * davranışı ancak mock'suz bir dosyada doğrulanabilir.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('aiGatewayFlag — varsayılan KAPALI, tek şalter', () => {
  beforeEach(() => { vi.resetModules(); localStorage.clear(); });

  it('varsayılan KAPALI (uzak bayrak yok, yerel kaldıraç yok)', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    const { isAiGatewayEnabled } = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(isAiGatewayEnabled()).toBe(false);
  });

  it('yerel kaldıraç YALNIZ tam "true" ile açar (fail-closed)', async () => {
    for (const bad of ['1', 'yes', 'TRUE', 'evet', '']) {
      vi.resetModules();
      vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
      localStorage.setItem('mavi.aiGateway.enabled', bad);
      const m = await import('../platform/ai/gateway/aiGatewayFlag');
      expect(m.isAiGatewayEnabled()).toBe(false);
    }
    vi.resetModules();
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiGateway.enabled', 'true');
    const on = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(on.isAiGatewayEnabled()).toBe(true);
  });

  it('uzak bayrak açarsa açılır', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => true }));
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isAiGatewayEnabled()).toBe(true);
  });

  it('getFlag throw ederse KAPALI kalır (fail-closed)', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => { throw new Error('yapılandırma yok'); } }));
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isAiGatewayEnabled()).toBe(false);
  });

  it('değer önbelleğe alınır — tur ortasında değişmez', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isAiGatewayEnabled()).toBe(false);
    localStorage.setItem('mavi.aiGateway.enabled', 'true');
    expect(m.isAiGatewayEnabled()).toBe(false);   // önbellek — tur bütünlüğü
    m._resetAiGatewayFlagForTest();
    expect(m.isAiGatewayEnabled()).toBe(true);
  });
});
