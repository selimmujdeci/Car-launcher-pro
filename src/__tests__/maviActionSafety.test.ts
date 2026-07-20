/**
 * maviActionSafety.test.ts — Mavi Çekirdeği Faz-1 · Eylem güvenlik köprüsü sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Bilinmeyen eylem → DENY (fail-closed).
 *  2. Araç kapsamı → AiSafetyGate'e DELEGE; gate reddederse DENY (ikinci otorite yok).
 *  3. Hard-forbidden (ecu_write…) kapsamlı eylem gate'te reddedilir — kullanıcı onayı açamaz.
 *  4. Düşük risk → ALLOW; orta/yüksek risk → CONFIRM (confirmed=true ise ALLOW).
 *  5. Araç DENY, UX riskini ezer (önce araç kapısı).
 */
import { describe, it, expect } from 'vitest';
import { createAiSafetyGate } from '../platform/aiCore/safetyGate';
import {
  evaluateActionSafety, evaluateActionIdSafety,
} from '../platform/maviCore/actionSafety';
import { createPilotActionRegistry, type ActionDefinition } from '../platform/maviCore/actionRegistry';

const gate = createAiSafetyGate(); // varsayılan: yalnız 'read'

function def(partial: Partial<ActionDefinition>): ActionDefinition {
  return {
    id: 'test.action', title: 't', risk: 'low', reversible: true, timeoutMs: 1000,
    resultContract: 'ack', validate: () => ({ ok: true, errors: [] }),
    ...partial,
  };
}

describe('evaluateActionSafety — fail-closed', () => {
  it('undefined/null def → DENY unknown_action', () => {
    expect(evaluateActionSafety(undefined, gate).outcome).toBe('deny');
    expect(evaluateActionSafety(null, gate).reason).toBe('unknown_action');
  });
});

describe('evaluateActionSafety — araç kapısı delegasyonu (AiSafetyGate)', () => {
  it('vehicleScope=read → gate izin verir → risk kuralına düşer (ALLOW low)', () => {
    const d = evaluateActionSafety(def({ vehicleScope: 'read' }), gate);
    expect(d.outcome).toBe('allow');
  });

  it('vehicleScope=clear_dtc → varsayılan gate (yalnız read) reddeder → DENY', () => {
    const d = evaluateActionSafety(def({ vehicleScope: 'clear_dtc' }), gate);
    expect(d.outcome).toBe('deny');
    expect(d.reason).toBe('vehicle_gate_denied');
    expect(d.gateReason).toBe('not_in_allowed_scopes');
  });

  it('hard-forbidden kapsam → DENY, kullanıcı onayı bile açamaz', () => {
    // clear_dtc izinli bir gate bile ecu_write'ı açamaz (savunma derinliği)
    const permissive = createAiSafetyGate({ allowedScopes: ['read', 'clear_dtc', 'ecu_write'] });
    const d = evaluateActionSafety(def({ vehicleScope: 'ecu_write', risk: 'high' }), permissive, { confirmed: true });
    expect(d.outcome).toBe('deny');
    expect(d.gateReason).toBe('hard_forbidden');
  });

  it('gate yoksa araç-etkili eylem fail-closed DENY', () => {
    const d = evaluateActionSafety(def({ vehicleScope: 'read' }), undefined as never);
    expect(d.outcome).toBe('deny');
    expect(d.reason).toBe('vehicle_gate_unavailable');
  });

  it('araç kapsamsız eylem gate\'e hiç gitmez (UI eylemi)', () => {
    const d = evaluateActionSafety(def({ risk: 'low' }), gate);
    expect(d.outcome).toBe('allow');
    expect(d.gateReason).toBeUndefined();
  });
});

describe('evaluateActionSafety — UX risk sınıfı', () => {
  it('low → ALLOW', () => {
    expect(evaluateActionSafety(def({ risk: 'low' }), gate).outcome).toBe('allow');
  });

  it('medium → CONFIRM; confirmed=true → ALLOW', () => {
    expect(evaluateActionSafety(def({ risk: 'medium' }), gate).outcome).toBe('confirm');
    expect(evaluateActionSafety(def({ risk: 'medium' }), gate, { confirmed: true }).outcome).toBe('allow');
  });

  it('high → CONFIRM; confirmed=true → ALLOW', () => {
    expect(evaluateActionSafety(def({ risk: 'high' }), gate).outcome).toBe('confirm');
    expect(evaluateActionSafety(def({ risk: 'high' }), gate, { confirmed: true }).reason).toBe('confirmed');
  });

  it('araç DENY, UX onayını ezer (önce araç kapısı)', () => {
    // medium + confirmed olsa bile araç kapsamı reddedilirse DENY kazanır
    const d = evaluateActionSafety(def({ risk: 'medium', vehicleScope: 'coding' }), gate, { confirmed: true });
    expect(d.outcome).toBe('deny');
  });
});

describe('evaluateActionIdSafety — defter entegrasyonu', () => {
  const reg = createPilotActionRegistry();

  it('pilot vehicle.health.read → ALLOW (read gate\'ten geçer)', () => {
    expect(evaluateActionIdSafety(reg, gate, 'vehicle.health.read').outcome).toBe('allow');
  });

  it('pilot ui.theme.set → ALLOW (araç kapsamsız, low)', () => {
    expect(evaluateActionIdSafety(reg, gate, 'ui.theme.set').outcome).toBe('allow');
  });

  it('bilinmeyen id → DENY fail-closed', () => {
    const d = evaluateActionIdSafety(reg, gate, 'yok.olan');
    expect(d.outcome).toBe('deny');
    expect(d.reason).toBe('unknown_action');
  });
});
