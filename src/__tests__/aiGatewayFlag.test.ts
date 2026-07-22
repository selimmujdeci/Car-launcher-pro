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

  it('ORCHESTRATOR alt tercihi: varsayılan KAPALI', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiGateway.enabled', 'true');          // üst şalter açık
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isAiGatewayEnabled()).toBe(true);
    expect(m.isMaviOrchestratorEnabled()).toBe(false);               // alt tercih kapalı
  });

  it('ORCHESTRATOR gateway KAPALIYKEN tek başına açılamaz (fail-closed)', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiOrchestrator.enabled', 'true');     // yalnız alt tercih
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isAiGatewayEnabled()).toBe(false);
    expect(m.isMaviOrchestratorEnabled()).toBe(false);               // üst şalter kapalı → ASLA
  });

  it('ORCHESTRATOR: gateway açık + alt tercih "true" → açılır; setter geri alır', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiGateway.enabled', 'true');
    localStorage.setItem('mavi.aiOrchestrator.enabled', 'true');
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isMaviOrchestratorEnabled()).toBe(true);

    m.setMaviOrchestratorEnabled(false);                             // TEK ayarla rollback
    expect(m.isMaviOrchestratorEnabled()).toBe(false);
    expect(m.isAiGatewayEnabled()).toBe(true);                       // üst hat KORUNUR
  });

  it('CONTEXT: varsayılan KAPALI ve izin YOK', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiGateway.enabled', 'true');
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isMaviContextEnabled()).toBe(false);
    expect(m.getMaviContextConsent()).toBe('off');
  });

  it('CONTEXT: gateway KAPALIYKEN tek başına açılamaz (fail-closed)', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiContext.enabled', 'true');
    localStorage.setItem('mavi.aiContext.consent', 'vehicle_context');
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isMaviContextEnabled()).toBe(false);
  });

  it('CONTEXT: izin YALNIZ tam "vehicle_context" ile verilir (fail-closed)', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    for (const bad of ['true', 'on', 'VEHICLE_CONTEXT', 'evet', '']) {
      localStorage.setItem('mavi.aiContext.consent', bad);
      expect(m.getMaviContextConsent()).toBe('off');
    }
    m.setMaviContextConsent('vehicle_context');
    expect(m.getMaviContextConsent()).toBe('vehicle_context');
    m.setMaviContextConsent('off');
    expect(m.getMaviContextConsent()).toBe('off');          // rollback
  });

  it('CONTEXT: gateway açık + şalter açık → etkin; setter geri alır', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiGateway.enabled', 'true');
    localStorage.setItem('mavi.aiContext.enabled', 'true');
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isMaviContextEnabled()).toBe(true);
    m.setMaviContextEnabled(false);
    expect(m.isMaviContextEnabled()).toBe(false);
    expect(m.isAiGatewayEnabled()).toBe(true);              // üst hat korunur
  });


  it('MEMORY: varsayılan KAPALI ve izin YOK', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiGateway.enabled', 'true');
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isMaviMemoryEnabled()).toBe(false);
    expect(m.getMaviMemoryConsent()).toBe('off');
  });

  it('MEMORY: gateway KAPALIYKEN tek başına açılamaz (fail-closed)', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiMemory.enabled', 'true');
    localStorage.setItem('mavi.aiMemory.consent', 'memory');
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.isMaviMemoryEnabled()).toBe(false);
  });

  it('MEMORY: izni araç bağlamı izninden AYRIDIR', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    localStorage.setItem('mavi.aiContext.consent', 'vehicle_context');
    const m = await import('../platform/ai/gateway/aiGatewayFlag');
    expect(m.getMaviContextConsent()).toBe('vehicle_context');
    expect(m.getMaviMemoryConsent()).toBe('off');          // araç izni hafıza izni DEĞİL
    m.setMaviMemoryConsent('memory');
    expect(m.getMaviMemoryConsent()).toBe('memory');
    m.setMaviMemoryConsent('off');
    expect(m.getMaviMemoryConsent()).toBe('off');          // rollback
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

  it('AI Usta Bilgi Notu — varsayılan KAPALI, zincirleme fail-closed', async () => {
    vi.doMock('../platform/remoteConfigService', () => ({ getFlag: () => false }));
    const m = await import('../platform/ai/gateway/aiGatewayFlag');

    // Her şey kapalı → bilgi notu kapalı.
    expect(m.isMaviMechanicKnowledgeEnabled()).toBe(false);

    // Yalnız bilgi yerel açık ama üst zincir kapalı → HÂLÂ kapalı.
    localStorage.setItem('mavi.aiMechanicKnowledge.enabled', 'true');
    m._resetAiGatewayFlagForTest();
    expect(m.isMaviMechanicKnowledgeEnabled()).toBe(false);

    // Gateway + AI Usta açık → bilgi notu açılır.
    localStorage.setItem('mavi.aiGateway.enabled', 'true');
    localStorage.setItem('mavi.aiMechanic.enabled', 'true');
    m._resetAiGatewayFlagForTest();
    expect(m.isMaviMechanicKnowledgeEnabled()).toBe(true);

    // AI Usta kapanınca bilgi notu da kapanır (zincirleme fail-closed).
    localStorage.removeItem('mavi.aiMechanic.enabled');
    m._resetAiGatewayFlagForTest();
    expect(m.isMaviMechanicKnowledgeEnabled()).toBe(false);
  });
});
