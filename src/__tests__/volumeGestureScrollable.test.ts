/**
 * volumeGestureScrollable.test.ts — kenar ses jesti kaydırılabilir alanda
 * devreye GİRMEZ (saha 2026-09-23: müzik paneli kaydırılırken ses 0'a iniyordu).
 */
import { describe, it, expect } from 'vitest';
import { startsInScrollable } from '../components/common/volumeGestureGuard';

function box(overflowY: string, scrollH: number, clientH: number): HTMLElement {
  const el = document.createElement('div');
  el.style.overflowY = overflowY;
  Object.defineProperty(el, 'scrollHeight', { value: scrollH });
  Object.defineProperty(el, 'clientHeight', { value: clientH });
  return el;
}

describe('startsInScrollable', () => {
  it('🔒 taşan overflow-y:auto alanın içindeki dokunuş → true (jest kurulmaz)', () => {
    const sc = box('auto', 340, 284);
    const child = document.createElement('button');
    sc.appendChild(child);
    document.body.appendChild(sc);
    expect(startsInScrollable(child)).toBe(true);
    sc.remove();
  });

  it('sığan (taşmayan) kaydırma alanı → false (jest çalışır)', () => {
    const sc = box('auto', 200, 284);
    const child = document.createElement('div');
    sc.appendChild(child);
    document.body.appendChild(sc);
    expect(startsInScrollable(child)).toBe(false);
    sc.remove();
  });

  it('overflow hidden / düz yüzey → false', () => {
    const el = box('hidden', 999, 100);
    document.body.appendChild(el);
    expect(startsInScrollable(el)).toBe(false);
    expect(startsInScrollable(null)).toBe(false);
    el.remove();
  });
});
