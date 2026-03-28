/**
 * Error Bus — uygulama genelinde toast/banner bildirimi sistemi.
 *
 * Kullanım:
 *   showToast({ type: 'error', title: 'OBD Bağlantısı Kesildi', message: '...' });
 *
 * React bileşenlerinde:
 *   const toasts = useToasts();
 */

import { useState, useEffect } from 'react';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

export interface AppToast {
  id:       string;
  type:     ToastType;
  title:    string;
  message?: string;
  /** ms, 0 = kalıcı (kullanıcı kapatana kadar), varsayılan 5000 */
  duration?: number;
}

const _toasts:    AppToast[] = [];
const _listeners = new Set<(t: AppToast[]) => void>();

function _notify(): void {
  const snap = [..._toasts];
  _listeners.forEach((fn) => fn(snap));
}

export function showToast(opts: Omit<AppToast, 'id'>): string {
  const id   = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const toast: AppToast = { duration: 5000, ...opts, id };
  _toasts.push(toast);
  _notify();

  if (toast.duration && toast.duration > 0) {
    setTimeout(() => dismissToast(id), toast.duration);
  }
  return id;
}

export function dismissToast(id: string): void {
  const idx = _toasts.findIndex((t) => t.id === id);
  if (idx >= 0) {
    _toasts.splice(idx, 1);
    _notify();
  }
}

/** Belirli bir type ve title'a sahip tüm toastları kapat */
export function dismissToastByTitle(title: string): void {
  const ids = _toasts.filter((t) => t.title === title).map((t) => t.id);
  ids.forEach(dismissToast);
}

export function useToasts(): AppToast[] {
  const [state, setState] = useState<AppToast[]>([..._toasts]);
  useEffect(() => {
    setState([..._toasts]);
    _listeners.add(setState);
    return () => { _listeners.delete(setState); };
  }, []);
  return state;
}
