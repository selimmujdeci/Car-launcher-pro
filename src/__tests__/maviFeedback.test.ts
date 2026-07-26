/**
 * maviFeedback.test.ts — Mavi Çekirdeği Faz-2 · Typed feedback kanalı sözleşmesi.
 *
 * KİLİTLENEN SÖZLEŞME:
 *  1. Aşama feedback: listening/understanding/planning/executing nötr mesaj; idle/speaking → null.
 *  2. Eylem ok → success; DİĞER TÜM durumlar dürüst error/warning — ASLA "yapıldı"/success değil.
 *  3. Plan: completed→success, partial→warning, failed/rejected→error; stale reddi → null (sessiz).
 *  4. Kanal: emit zaman damgalar + tüm dinleyicilere yayar; reset idempotent.
 */
import { describe, it, expect } from 'vitest';
import {
  buildStageFeedback, buildActionFeedback, buildPlanFeedback, createFeedbackChannel,
} from '../platform/maviCore/wiring/maviFeedback';
import type { StepResult, PlanResult, StepStatus } from '../platform/maviCore/executionEngine';

describe('buildStageFeedback — sessiz bırakmama', () => {
  it('aktif aşamalar nötr ara mesaj üretir', () => {
    expect(buildStageFeedback('listening')?.message).toBe('Dinliyorum');
    expect(buildStageFeedback('executing')?.code).toBe('stage_executing');
    expect(buildStageFeedback('understanding')?.severity).toBe('info');
  });

  it('idle/speaking/cancelled → null (kendi sonuç mesajı var)', () => {
    expect(buildStageFeedback('idle')).toBeNull();
    expect(buildStageFeedback('speaking')).toBeNull();
    expect(buildStageFeedback('cancelled')).toBeNull();
  });
});

describe('buildActionFeedback — yapılmış gibi cevap verme YASAK', () => {
  const mk = (status: StepStatus): StepResult => ({ actionId: 'ui.theme.set', status });

  it('ok → success (özel metin varsa onu kullanır)', () => {
    expect(buildActionFeedback(mk('ok')).severity).toBe('success');
    expect(buildActionFeedback(mk('ok'), { successText: 'Tema gece oldu' }).message).toBe('Tema gece oldu');
  });

  it('ok DIŞINDAKİ her durum success DEĞİL + dürüst mesaj', () => {
    const nonOk: StepStatus[] = ['failed', 'timeout', 'denied', 'invalid', 'unknown_action', 'no_handler', 'rolled_back'];
    for (const s of nonOk) {
      const fb = buildActionFeedback(mk(s));
      expect(fb.severity).not.toBe('success');
      expect(['error', 'warning']).toContain(fb.severity);
      expect(fb.code).not.toBe('action_ok');
      expect(fb.message).not.toMatch(/^tamam$|yapıldı|başarıyla/i);
    }
  });

  it('denied → "yapamam"; timeout → dürüst; needs_confirmation → uyarı', () => {
    expect(buildActionFeedback(mk('denied')).message).toMatch(/yapamam/i);
    expect(buildActionFeedback(mk('timeout')).severity).toBe('error');
    expect(buildActionFeedback(mk('needs_confirmation')).severity).toBe('warning');
    expect(buildActionFeedback(mk('duplicate')).severity).toBe('info');
  });

  it('bozuk sonuç → güvenli error', () => {
    expect(buildActionFeedback(undefined as never).severity).toBe('error');
  });
});

describe('buildPlanFeedback', () => {
  const mk = (status: PlanResult['status'], reason?: string): PlanResult =>
    ({ status, steps: [], rolledBack: false, reason });

  it('completed→success, partial→warning, failed→error', () => {
    expect(buildPlanFeedback(mk('completed'))?.severity).toBe('success');
    expect(buildPlanFeedback(mk('partial'))?.severity).toBe('warning');
    expect(buildPlanFeedback(mk('failed'))?.severity).toBe('error');
  });

  it('stale reddi (barge-in) → null (sessiz)', () => {
    expect(buildPlanFeedback(mk('rejected', 'stale_generation'))).toBeNull();
  });

  it('boş plan reddi → dürüst error (sessiz değil)', () => {
    expect(buildPlanFeedback(mk('rejected', 'empty_plan'))?.severity).toBe('error');
  });
});

describe('MaviFeedbackChannel', () => {
  it('emit zaman damgalar + tüm dinleyicilere yayar; last saklanır', () => {
    let t = 500;
    const ch = createFeedbackChannel({ now: () => t });
    const seen: string[] = [];
    const off = ch.subscribe((fb) => seen.push(fb.code));
    t = 1234;
    const fb = ch.emit(buildActionFeedback({ actionId: 'x', status: 'ok' }));
    expect(fb?.at).toBe(1234);
    expect(seen).toEqual(['action_ok']);
    expect(ch.last()?.code).toBe('action_ok');
    off();
    ch.emit(buildStageFeedback('listening'));
    expect(seen.length).toBe(1); // kaldırılan dinleyici duymaz
  });

  it('null/geçersiz emit sessizce yok sayılır', () => {
    const ch = createFeedbackChannel();
    expect(ch.emit(null)).toBeNull();
    expect(ch.emit(buildPlanFeedback({ status: 'rejected', steps: [], rolledBack: false, reason: 'stale_generation' }))).toBeNull();
  });

  it('reset idempotent (dinleyici + last temizlenir)', () => {
    const ch = createFeedbackChannel();
    const seen: string[] = [];
    ch.subscribe((fb) => seen.push(fb.code));
    ch.emit(buildStageFeedback('planning'));
    ch.reset();
    ch.reset();
    expect(ch.last()).toBeNull();            // reset last'ı temizledi
    ch.emit(buildStageFeedback('executing')); // dinleyici yok → yayılmaz
    expect(seen).toEqual(['stage_planning']); // reset sonrası dinleyici duymaz
  });
});
