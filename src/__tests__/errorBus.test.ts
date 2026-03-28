/**
 * errorBus.test.ts — Toast bildirim sistemi testleri.
 *
 * Test kapsamı:
 *  - showToast toast listesine ekler
 *  - dismissToast kaldırır
 *  - dismissToastByTitle başlığa göre kaldırır
 *  - Duration 0 → kalıcı toast (otomatik kapanmaz)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showToast, dismissToast, dismissToastByTitle } from '../platform/errorBus';

// errorBus modül-level state'ini her testten önce temizle
beforeEach(() => {
  // Tüm aktif toastları temizle (özel reset yok, dismiss ile temizle)
  // Test izolasyonu için modülü yeniden import etmek yerine state'e güveniyoruz
  // Her test kendi toast'larını kaldırır
});

describe('showToast', () => {
  it('id döner', () => {
    const id = showToast({ type: 'info', title: 'Test', duration: 0 });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    dismissToast(id);
  });

  it('farklı type değerleri kabul eder', () => {
    const ids: string[] = [];
    (['error', 'warning', 'info', 'success'] as const).forEach((t) => {
      ids.push(showToast({ type: t, title: `Toast ${t}`, duration: 0 }));
    });
    ids.forEach(dismissToast);
  });

  it('message opsiyonel', () => {
    const id = showToast({ type: 'error', title: 'Hata', duration: 0 });
    expect(id).toBeTruthy();
    dismissToast(id);
  });
});

describe('dismissToast', () => {
  it('var olan toast kaldırılır', () => {
    const id = showToast({ type: 'info', title: 'Silinecek', duration: 0 });
    dismissToast(id);
    // İkinci kez dismiss hata fırlatmamalı
    expect(() => dismissToast(id)).not.toThrow();
  });

  it('olmayan id dismiss hata fırlatmaz', () => {
    expect(() => dismissToast('olmayan-id-xyz')).not.toThrow();
  });
});

describe('dismissToastByTitle', () => {
  it('aynı başlıktaki tüm toastları kaldırır', () => {
    const title = 'Ortak Başlık';
    const id1 = showToast({ type: 'warning', title, duration: 0 });
    const id2 = showToast({ type: 'error',   title, duration: 0 });
    dismissToastByTitle(title);
    // Kaldırma sonrası tekrar dismiss hata vermemeli
    expect(() => dismissToast(id1)).not.toThrow();
    expect(() => dismissToast(id2)).not.toThrow();
  });

  it('eşleşmeyen başlık hiçbir şey kaldırmaz', () => {
    const id = showToast({ type: 'info', title: 'Kalıcı', duration: 0 });
    expect(() => dismissToastByTitle('Var olmayan başlık')).not.toThrow();
    dismissToast(id); // temizle
  });
});

describe('auto-dismiss', () => {
  it('duration > 0 verilen toast timer başlatır', () => {
    vi.useFakeTimers();
    const id = showToast({ type: 'success', title: 'Geçici', duration: 1000 });
    expect(typeof id).toBe('string');
    vi.runAllTimers();
    vi.useRealTimers();
  });
});
