/**
 * safetyAnnouncer birim testleri — FAZ 3B
 *
 * YAKLAŞIM: createSafetyAnnouncerCore + mock deps (speak, chime).
 * React / @testing-library/react KULLANILMAZ.
 * useSafetyAlerts hook'u bu testlerde çağrılmaz.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSafetyAnnouncerCore } from '../platform/safety/safetyAnnouncerCore';
import type { SafetyQueueOutput, SafetyAlert, SafetyLevel } from '../platform/safety/types';

// ── Test yardımcıları ─────────────────────────────────────────────────────────

function makeAlert(overrides: {
  ruleId: string;
  level?: SafetyLevel;
  message?: string;
}): SafetyAlert {
  return {
    ruleId:   overrides.ruleId,
    level:    overrides.level   ?? 'critical',
    message:  overrides.message ?? `${overrides.ruleId} mesajı`,
    icon:     'door',
    screen:   'banner',
    priority: overrides.level === 'warning' ? 55 : 90,
    ts:       Date.now(),
  };
}

function makeOutput(voiceAlert: SafetyAlert | null): SafetyQueueOutput {
  return {
    visibleAlerts:          voiceAlert ? [voiceAlert] : [],
    primaryBannerAlert:     voiceAlert ?? null,
    voiceAnnouncementAlert: voiceAlert,
    muted:                  [],
    suppressed:             [],
  };
}

// ── Testler ───────────────────────────────────────────────────────────────────

describe('createSafetyAnnouncerCore', () => {
  let speak: ReturnType<typeof vi.fn>;
  let chime: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    speak = vi.fn();
    chime = vi.fn();
  });

  // ── voiceAnnouncementAlert gelince konuşur ─────────────────────────────────

  it('voiceAnnouncementAlert gelince speak ve chime çağrılır', () => {
    const core = createSafetyAnnouncerCore({ speak, chime });
    const alert = makeAlert({ ruleId: 'door', level: 'critical' });

    core.announce(makeOutput(alert));

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith(alert.message);
    expect(chime).toHaveBeenCalledTimes(1);
    expect(chime).toHaveBeenCalledWith('critical');
  });

  // ── null alertte konuşmaz ──────────────────────────────────────────────────

  it('null alert gelince speak çağrılmaz', () => {
    const core = createSafetyAnnouncerCore({ speak, chime });
    core.announce(makeOutput(null));

    expect(speak).not.toHaveBeenCalled();
    expect(chime).not.toHaveBeenCalled();
  });

  // ── aynı alert art arda gelince tekrar konuşmaz ────────────────────────────

  it('aynı ruleId arka arkaya gelince speak yalnızca 1 kez çağrılır', () => {
    const core = createSafetyAnnouncerCore({ speak, chime });
    const door = makeAlert({ ruleId: 'door' });

    core.announce(makeOutput(door));
    core.announce(makeOutput(door)); // aynı ruleId, arada null yok

    expect(speak).toHaveBeenCalledTimes(1);
  });

  // ── null arası geçiş sonrası aynı alert yeniden konuşur ───────────────────

  it('null arası geçişten sonra aynı ruleId yeniden konuşur', () => {
    const core = createSafetyAnnouncerCore({ speak, chime });
    const door = makeAlert({ ruleId: 'door' });

    core.announce(makeOutput(door));   // 1. duyuru
    core.announce(makeOutput(null));   // state sıfırla
    core.announce(makeOutput(door));   // tekrar duyuru

    expect(speak).toHaveBeenCalledTimes(2);
  });

  // ── farklı alert gelince konuşur ──────────────────────────────────────────

  it('farklı ruleId gelince her ikisi de konuşur', () => {
    const core = createSafetyAnnouncerCore({ speak, chime });
    const door     = makeAlert({ ruleId: 'door' });
    const overheat = makeAlert({ ruleId: 'overheat', level: 'warning' });

    core.announce(makeOutput(door));
    core.announce(makeOutput(overheat)); // farklı ruleId → konuşur

    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenNthCalledWith(1, door.message);
    expect(speak).toHaveBeenNthCalledWith(2, overheat.message);
  });

  // ── TTS hata atarsa crash olmaz ───────────────────────────────────────────

  it('speak hata atarsa announce throw etmez', () => {
    const throwingSpeak = () => { throw new Error('tts yok'); };
    const core = createSafetyAnnouncerCore({ speak: throwingSpeak, chime });
    const door = makeAlert({ ruleId: 'door' });

    // Throw etmemeli
    expect(() => core.announce(makeOutput(door))).not.toThrow();
  });

  it('chime hata atarsa speak yine çağrılır', () => {
    const throwingChime = () => { throw new Error('audio yok'); };
    const core = createSafetyAnnouncerCore({ speak, chime: throwingChime });
    const door = makeAlert({ ruleId: 'door' });

    expect(() => core.announce(makeOutput(door))).not.toThrow();
    // Chime hatasına rağmen speak çağrılmalı
    expect(speak).toHaveBeenCalledTimes(1);
  });

  // ── unmount sonrası anons yapılmaz ────────────────────────────────────────

  it('dispose sonrası announce speak çağırmaz', () => {
    const core = createSafetyAnnouncerCore({ speak, chime });
    const door = makeAlert({ ruleId: 'door' });

    core.dispose();
    core.announce(makeOutput(door));

    expect(speak).not.toHaveBeenCalled();
    expect(chime).not.toHaveBeenCalled();
  });

  // ── chime seviyesi doğru iletilir (warning) ───────────────────────────────

  it('warning seviyeli alertte chime warning ile çağrılır', () => {
    const core    = createSafetyAnnouncerCore({ speak, chime });
    const warning = makeAlert({ ruleId: 'seatbelt', level: 'warning' });

    core.announce(makeOutput(warning));

    expect(chime).toHaveBeenCalledWith('warning');
  });

  // ── chime önce, speak sonra çağrılır ─────────────────────────────────────

  it('chime speak sırasıyla çağrılır', () => {
    const callOrder: string[] = [];
    const orderedSpeak = vi.fn(() => { callOrder.push('speak'); });
    const orderedChime = vi.fn(() => { callOrder.push('chime'); });
    const core = createSafetyAnnouncerCore({ speak: orderedSpeak, chime: orderedChime });

    core.announce(makeOutput(makeAlert({ ruleId: 'door' })));

    expect(callOrder).toEqual(['chime', 'speak']);
  });
});
