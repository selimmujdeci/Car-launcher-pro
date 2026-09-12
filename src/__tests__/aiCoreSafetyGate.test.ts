/**
 * aiCoreSafetyGate.test.ts — AI Core Faz-1 · Safety Gate + ortak tip sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME (VİZYON ANAYASASI):
 *  1. Faz-1 varsayılan: yalnız 'read' meşru; gerisi reddedilir.
 *  2. HARD_FORBIDDEN (ecu_write/coding/adaptation/actuator) yapılandırma ile bile açılamaz.
 *  3. Bozuk istek → fail-closed DENY.
 *  4. Aciliyet yardımcıları (maxUrgency/urgencyRank) doğru sıralar.
 */
import { describe, it, expect } from 'vitest';
import {
  AiSafetyGate, createAiSafetyGate, HARD_FORBIDDEN_SCOPES, type AiCapabilityScope,
} from '../platform/aiCore/safetyGate';
import { maxUrgency, urgencyRank, type AiUrgency } from '../platform/aiCore/types';

describe('AiSafetyGate — Faz-1 read-only invaryantı', () => {
  it('varsayılan gate yalnız read izin verir', () => {
    const gate = createAiSafetyGate();
    expect(gate.isReadOnly).toBe(true);
    expect(gate.evaluate({ agentId: 'ai_mechanic', scope: 'read' }).allowed).toBe(true);
    expect(gate.evaluate({ agentId: 'ai_mechanic', scope: 'clear_dtc' }).allowed).toBe(false);
  });

  it('HARD_FORBIDDEN kapsamlar allowedScopes ile verilse bile REDDEDİLİR (savunma derinliği)', () => {
    const gate = new AiSafetyGate({ allowedScopes: ['read', 'ecu_write', 'coding', 'actuator', 'adaptation'] });
    for (const scope of ['ecu_write', 'coding', 'actuator', 'adaptation'] as AiCapabilityScope[]) {
      const d = gate.evaluate({ agentId: 'x', scope });
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('hard_forbidden');
      expect(gate.isScopeAllowed(scope)).toBe(false);
    }
    // read yine geçer, gate hâlâ read-only sayılır (yasak kapsamlar hiç eklenmedi).
    expect(gate.evaluate({ agentId: 'x', scope: 'read' }).allowed).toBe(true);
    expect(gate.isReadOnly).toBe(true);
  });

  it('HARD_FORBIDDEN kümesi tam olarak 4 yazma/etki kapsamını içerir', () => {
    expect([...HARD_FORBIDDEN_SCOPES].sort()).toEqual(['actuator', 'adaptation', 'coding', 'ecu_write']);
    expect(HARD_FORBIDDEN_SCOPES.has('read')).toBe(false);
  });

  it('bozuk/eksik istek → fail-closed DENY', () => {
    const gate = createAiSafetyGate();
    expect(gate.evaluate(undefined as unknown as { agentId: string; scope: AiCapabilityScope }).allowed).toBe(false);
    expect(gate.evaluate({ agentId: 'x', scope: 'bilinmeyen' as AiCapabilityScope }).reason).toBe('invalid_request');
  });

  it('clear_dtc açıkça izinlense de read-only artık false olur ama HARD_FORBIDDEN değil', () => {
    const gate = new AiSafetyGate({ allowedScopes: ['read', 'clear_dtc'] });
    expect(gate.isReadOnly).toBe(false);
    expect(gate.evaluate({ agentId: 'x', scope: 'clear_dtc' }).allowed).toBe(true);
  });

  it('sayaçlar allow/deny takip eder', () => {
    const gate = createAiSafetyGate();
    gate.evaluate({ agentId: 'x', scope: 'read' });
    gate.evaluate({ agentId: 'x', scope: 'coding' });
    expect(gate.stats).toEqual({ allowedCount: 1, deniedCount: 1 });
  });
});

describe('AiUrgency yardımcıları', () => {
  it('maxUrgency güvenlik lehine yükseği seçer', () => {
    expect(maxUrgency('watch', 'critical')).toBe('critical');
    expect(maxUrgency('urgent', 'soon')).toBe('urgent');
    expect(maxUrgency('none', 'none')).toBe('none');
  });

  it('urgencyRank monoton artan', () => {
    const order: AiUrgency[] = ['none', 'watch', 'soon', 'urgent', 'critical'];
    for (let i = 1; i < order.length; i++) {
      expect(urgencyRank(order[i])).toBeGreaterThan(urgencyRank(order[i - 1]));
    }
  });
});
