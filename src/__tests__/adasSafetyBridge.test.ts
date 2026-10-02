/**
 * adasSafetyBridge.test.ts — ADAS → güvenlik asistanı köprüsü kilitleri.
 *
 * ADAS kararını `adasRuntime` verir; sunumu (öncelik · ton · ses · bant)
 * mevcut güvenlik asistanı yapar. İkinci bir uyarı otoritesi YOK.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSafetyRules } from '../platform/safety/SafetyRuleEngine';
import { SafetyAlertQueue } from '../platform/safety/SafetyAlertQueue';
import { createSafetyStateFromVehicleStore } from '../platform/safety/safetyStateMapper';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { AdasWarningSignal } from '../platform/adas/adasTypes';
import { adasWarningChanged } from '../platform/adas/adasStore';

const NOW = 100_000;
const sig = (over: Partial<AdasWarningSignal>): AdasWarningSignal => ({
  lane: null, forward: null, leadDeparted: false, atPerfMs: NOW, ...over,
});

function alertsFor(adas: AdasWarningSignal, now = NOW, extra: Record<string, unknown> = {}) {
  const v = { ...useUnifiedVehicleStore.getState(), ...extra };
  const { state, updatedAt } = createSafetyStateFromVehicleStore(v, { adas, wallClockMs: Date.now() });
  return evaluateSafetyRules(state, now, updatedAt);
}

describe('ADAS → güvenlik asistanı', () => {
  it('1. çarpışma: kritik bant, öncelik 100', () => {
    const a = alertsFor(sig({ forward: 'collision' }));
    expect(a[0].ruleId).toBe('adas.fcw');
    expect(a[0].level).toBe('critical');
    expect(a[0].screen).toBe('banner');
    expect(a[0].priority).toBe(100);
  });

  it('2. 🔒 çarpışma motor aşırı ısınmasıyla aynı anda → ÖNCE çarpışma', () => {
    const v = useUnifiedVehicleStore.getState();
    const { state, updatedAt } = createSafetyStateFromVehicleStore(v, { adas: sig({ forward: 'collision' }) });
    const out = evaluateSafetyRules({ ...state, coolantTemp: 120 }, NOW, updatedAt);
    expect(out.map((x) => x.ruleId).slice(0, 2)).toEqual(['adas.fcw', 'engine.overheat']);
  });

  it('3. şerit: yöne göre mesaj ve ikon; takip mesafesi ve kalkış uyarı seviyesinde', () => {
    const l = alertsFor(sig({ lane: 'left' }))[0];
    expect(l.ruleId).toBe('adas.ldw');
    expect(l.message).toContain('Soldaki');
    expect(l.icon).toBe('laneLeft');
    expect(alertsFor(sig({ lane: 'right' }))[0].icon).toBe('laneRight');
    expect(alertsFor(sig({ forward: 'headway' }))[0].level).toBe('warning');
    expect(alertsFor(sig({ leadDeparted: true }))[0].ruleId).toBe('adas.lead_departed');
  });

  it('4. 🔒 600 ms\'den eski ADAS sinyali uyarı ÜRETMEZ (donmuş kamera)', () => {
    expect(alertsFor(sig({ forward: 'collision', atPerfMs: NOW - 700 }))).toHaveLength(0);
    expect(alertsFor(sig({ forward: 'collision', atPerfMs: NOW - 500 }))).toHaveLength(1);
  });

  it('5. 🔒 ADAS sinyali verilmezse ADAS kuralları sönük', () => {
    const v = useUnifiedVehicleStore.getState();
    const { state, updatedAt } = createSafetyStateFromVehicleStore(v, {});
    expect(evaluateSafetyRules(state, NOW, updatedAt).filter((x) => x.ruleId.startsWith('adas.'))).toHaveLength(0);
  });

  it('6. kuyruk: çarpışma anında seslendirilir; şerit uyarısı tek kez', () => {
    const q = new SafetyAlertQueue();
    const fcw = alertsFor(sig({ forward: 'collision' }));
    expect(q.update(fcw, NOW).voiceAnnouncementAlert?.ruleId).toBe('adas.fcw');   // debounce yok

    const q2 = new SafetyAlertQueue();
    const ldw = alertsFor(sig({ lane: 'left' }));
    expect(q2.update(ldw, NOW).voiceAnnouncementAlert?.ruleId).toBe('adas.ldw');
    const again = q2.update(ldw, NOW + 5_000);
    expect(again.voiceAnnouncementAlert).toBeNull();                                // tek kez
    expect(again.primaryBannerAlert?.ruleId).toBe('adas.ldw');                       // görsel sürer
  });

  it('7. yalnız uyarı İÇERİĞİ değişimi yeniden hesap tetikler (kalp atışı değil)', () => {
    expect(adasWarningChanged(sig({ lane: 'left' }), sig({ lane: 'left', atPerfMs: NOW + 200 }))).toBe(false);
    expect(adasWarningChanged(sig({}), sig({ forward: 'collision' }))).toBe(true);
  });
});
