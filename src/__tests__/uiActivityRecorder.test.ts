/**
 * uiActivityRecorder.test.ts — "zamansız açılan modal avcısı" kilidi.
 *
 * Garanti: kaydedici DOM'a binen modal/overlay yüzeylerini yakalar ve BAĞLAMA
 * göre (sürüş/geri-vites/kullanıcı-dokunmadan) "zamansız" olanları işaretler.
 * Bu, sürüş sırasında çıkan disclaimer gibi UX bug'larının tanı raporunda
 * görünmesini kilitler.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const vs = vi.hoisted(() => ({ speed: 0 as number | null, reverse: false }));
vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => ({
  useUnifiedVehicleStore: { getState: () => ({ speed: vs.speed, reverse: vs.reverse, location: null }) },
}));

import {
  startUiActivityRecorder,
  getUiActivitySnapshot,
  _resetUiActivityForTest,
} from '../platform/uiActivityRecorder';

let cleanup: (() => void) | null = null;

afterEach(() => {
  if (cleanup) { cleanup(); cleanup = null; }
  _resetUiActivityForTest();
  document.body.innerHTML = '';
  vs.speed = 0;
  vs.reverse = false;
});

function addDialog(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.setAttribute('style', 'position:fixed;z-index:9990');
  document.body.appendChild(el);
  return el;
}

describe('uiActivityRecorder — zamansız modal avcısı', () => {
  it('kurulumda zaten açık modal yüzeyini seed taramasıyla yakalar', () => {
    addDialog();                          // kurulumdan ÖNCE açık (boot-time modal gibi)
    cleanup = startUiActivityRecorder();

    const snap = getUiActivitySnapshot();
    expect(snap.installed).toBe(true);
    expect(snap.openNow.length).toBe(1);
    expect(snap.recent.some((e) => e.action === 'open')).toBe(true);
  });

  it('SÜRÜŞTE açılan modalı ZAMANSIZ işaretler (speed > 5)', () => {
    vs.speed = 60;                        // araç hareket halinde
    addDialog();
    cleanup = startUiActivityRecorder();

    const snap = getUiActivitySnapshot();
    expect(snap.untimelyCount).toBe(1);
    const open = snap.recent.find((e) => e.action === 'open');
    expect(open?.untimely).toBe(true);
    expect(open?.reasons).toContain('sürüşte');
  });

  it('GERİ VİSTE açılan modalı ZAMANSIZ işaretler', () => {
    vs.reverse = true;
    addDialog();
    cleanup = startUiActivityRecorder();

    const open = getUiActivitySnapshot().recent.find((e) => e.action === 'open');
    expect(open?.untimely).toBe(true);
    expect(open?.reasons).toContain('geri-viteste');
  });

  it('park + kullanıcı dokunuşu yakınken ZAMANSIZ değil', () => {
    vs.speed = 0;
    vs.reverse = false;
    addDialog();
    cleanup = startUiActivityRecorder();   // _lastUser = kurulum anı → sinceUserMs ~0

    const snap = getUiActivitySnapshot();
    expect(snap.untimelyCount).toBe(0);
    const open = snap.recent.find((e) => e.action === 'open');
    expect(open?.untimely).toBe(false);
  });

  // SAHA 2026-07-06: DrawerShell gibi yüzeyler KAPALIYKEN DOM'da kalır
  // (transform: translateY(100%) → ekran-dışı) ama ham getBoundingClientRect
  // alanı hâlâ ~%100 → 14 kapalı drawer "açık modal" sayılıp avcı "kurt geldi"
  // bağırıyordu. Görünür-kesişim kapısı bunu eler.
  function addFixedFullscreen(rect: Partial<DOMRect>): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('style', 'position:fixed;z-index:1000');
    el.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON() { /* noop */ }, ...rect,
    }) as DOMRect;
    document.body.appendChild(el);
    return el;
  }

  it('ekran-DIŞI ötelenmiş kapalı drawer AÇIK sayılmaz (görünür-alan ~0)', async () => {
    cleanup = startUiActivityRecorder();
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    // translateY(100%): viewport'un ALTINDA (top=vh) → görünür kesişim 0
    addFixedFullscreen({ left: 0, top: vh, right: vw, bottom: 2 * vh, width: vw, height: vh });
    await new Promise((r) => setTimeout(r, 0)); // MutationObserver mikrotask
    expect(getUiActivitySnapshot().openNow.length).toBe(0);
  });

  it('ekranda GÖRÜNÜR tam-ekran overlay AÇIK sayılır', async () => {
    cleanup = startUiActivityRecorder();
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    addFixedFullscreen({ left: 0, top: 0, right: vw, bottom: vh, width: vw, height: vh });
    await new Promise((r) => setTimeout(r, 0));
    expect(getUiActivitySnapshot().openNow.length).toBe(1);
  });

  it('opacity:0 KAPALI drawer (inset:0 tam-ekran) AÇIK sayılmaz — "|| 1" tuzağı regresyonu', async () => {
    // SAHA 2026-07-06: DrawerShell dış div KAPALIYKEN opacity:0 ama inset:0 tam-ekran
    // → görünür-alan %100, yalnız opacity ayırır. İlk fix `parseFloat(op)||1` yazdı →
    // op=0 falsy → `0||1`=1 → opacity:0 SIZDI (12 kapalı drawer sayıldı). Number.isFinite ayrımı şart.
    cleanup = startUiActivityRecorder();
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    const el = document.createElement('div');
    el.setAttribute('style', 'position:fixed;z-index:1000;opacity:0');
    el.getBoundingClientRect = () => ({
      left: 0, top: 0, right: vw, bottom: vh, width: vw, height: vh, x: 0, y: 0,
      toJSON() { /* noop */ },
    }) as DOMRect;
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    expect(getUiActivitySnapshot().openNow.length).toBe(0);
  });

  it('cleanup kaydediciyi söker (installed=false) — zero-leak', () => {
    cleanup = startUiActivityRecorder();
    expect(getUiActivitySnapshot().installed).toBe(true);
    cleanup();
    cleanup = null;
    expect(getUiActivitySnapshot().installed).toBe(false);
  });
});
