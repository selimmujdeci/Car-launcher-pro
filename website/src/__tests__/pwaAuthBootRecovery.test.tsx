/**
 * pwaAuthBootRecovery — ARABAM CEBİMDE AÇILIŞI ASLA ASILI KALMAZ.
 *
 * ── ÖLÇÜLEN KUSUR (telefonda, 2026-09-17) ────────────────────────────────
 * Yarıda kalmış bir çıkış, hesap temizliğinin auth-yazma kilidini açık
 * bırakıyordu. O durumda `beginAuthSessionOperation()` NULL dönüyor,
 * `useSessionUser` hiçbir durum güncellemesi yapmıyor ve `loading` sonsuza
 * dek `true` kalıyordu → kullanıcı açılış ekranında donuyordu (spinner hiç
 * bitmiyor). Filo panelinde bu durum için kurtarma ekranı vardı, tüketici
 * yüzeyinde YOKTU: kullanıcının hiçbir çıkış yolu kalmıyordu.
 *
 * Bu testler iki invariantı kilitler:
 *   1. Oturum SORULAMASA bile açılış çözülür (sonsuz spinner yasak).
 *   2. Kullanıcıya KANONİK kurtarma yolu sunulur (ikinci temizlik otoritesi yok).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/* ── Auth yazma kilidi sürülebilir olsun ── */
const guard = vi.hoisted(() => ({ blocked: false }));
vi.mock('@/security/accountCleanup/authSessionGenerationGuard', () => ({
  beginAuthSessionOperation: () => (guard.blocked ? null : { id: 'op-1', generation: 1 }),
  canApplyAuthSessionOperation: () => true,
  canApplyCurrentAuthEvent: () => true,
  finishAuthSessionOperation: () => undefined,
  captureAuthSessionGeneration: () => 1,
  canApplyAuthSessionResult: () => true,
  hasPendingAuthSessionOperations: () => false,
}));

const authTarget = vi.hoisted(() => ({ observe: vi.fn(async () => undefined) }));
vi.mock('@/security/accountCleanup/authCleanupTarget', () => ({
  observeAuthCleanupTarget: authTarget.observe,
  captureAuthCleanupTarget: () => null,
}));
vi.mock('@/security/accountCleanup/canonicalLogout', () => ({
  requestCanonicalLogout: vi.fn(async () => ({ ok: true, cleanupId: 'c', state: 'COMPLETED' })),
  requestCanonicalAccountTransition: vi.fn(async () => ({ ok: true, cleanupId: 'c', state: 'COMPLETED' })),
}));

/* ── Supabase: oturum okunabilir ama kilit yüzünden sorulamayacak ── */
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseBrowser: {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
  ensurePwaSession: async () => null,
}));

/* ── Hesap temizlik runtime'ı: kurtarma gerektiren durum sürülebilir ── */
const cleanup = vi.hoisted(() => ({
  bootStatus: 'CLEANUP_RECOVERY_REQUIRED' as string,
  retry: vi.fn(async () => undefined),
  init: vi.fn(async () => undefined),
  order: [] as string[],
}));
vi.mock('@/security/accountCleanup/useAccountCleanupRuntime', () => ({
  useAccountCleanupRuntime: () => ({
    runtime: {
      retryRecovery: async () => { cleanup.order.push('retry'); return cleanup.retry(); },
      initialize: async () => { cleanup.order.push('init'); return cleanup.init(); },
    },
    snapshot: { initialized: true, bootStatus: cleanup.bootStatus },
    isBrowser: true,
  }),
}));

/* ── Ağır PWA çocukları ── */
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => undefined }));
vi.mock('@/components/dashboard/MobileCarControl', () => ({ default: () => null }));
vi.mock('@/components/pwa/PairingScreen', () => ({ default: () => null }));
vi.mock('@/lib/vehicles.service', () => ({ fetchVehicles: vi.fn(async () => []) }));

import { useSessionUser } from '@/hooks/useSessionUser';
import KumandaPage from '@/app/(pwa)/kumanda/page';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  guard.blocked = false;
  cleanup.bootStatus = 'CLEANUP_RECOVERY_REQUIRED';
  cleanup.retry.mockClear();
  cleanup.init.mockClear();
  cleanup.order.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.clearAllMocks();
});

describe('açılış · auth yazma kilitliyken', () => {
  it('1 — `loading` ÇÖZÜLÜR: sonsuz açılış ekranı oluşmaz', async () => {
    guard.blocked = true;
    const seen: Array<{ loading: boolean; authError: boolean }> = [];

    function Probe() {
      const { loading, authError } = useSessionUser();
      seen.push({ loading, authError });
      return null;
    }

    await act(async () => { root.render(createElement(Probe)); });

    const last = seen[seen.length - 1];
    /* Eski kodda bu dal YOKTU → `loading` sonsuza dek true kalıyordu. */
    expect(last.loading).toBe(false);
    /* "Giriş yapılmamış" DENMEZ — oturum sorulamadı, bilinmezlik taşınır. */
    expect(last.authError).toBe(true);
  });

  it('2 — kilit yokken normal akış bozulmaz', async () => {
    guard.blocked = false;
    const seen: Array<{ loading: boolean; authError: boolean }> = [];

    function Probe() {
      const { loading, authError } = useSessionUser();
      seen.push({ loading, authError });
      return null;
    }

    await act(async () => { root.render(createElement(Probe)); });

    const last = seen[seen.length - 1];
    expect(last.loading).toBe(false);
    expect(last.authError).toBe(false);
  });
});

describe('açılış · kurtarma yolu', () => {
  it('3 — kilitli açılışta kullanıcıya kurtarma düğmesi gösterilir', async () => {
    guard.blocked = true;
    await act(async () => { root.render(createElement(KumandaPage)); });

    /* Sonsuz spinner YERİNE dürüst ekran + çıkış yolu. */
    expect(host.querySelector('[data-testid="pwa-boot-screen"]')).toBeNull();
    expect(host.querySelector('[data-testid="pwa-auth-error-screen"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="pwa-auth-recover-button"]')).not.toBeNull();
    expect(host.textContent).toContain('Güvenli oturum temizliği yarıda kalmış');
    /* Veri güvencesi kullanıcıya SÖYLENİR. */
    expect(host.textContent).toContain('hesabınızda duruyor');
  });

  it('4 — düğme runtime\'ı HAZIRLAYIP kanonik kurtarmayı çağırır', async () => {
    guard.blocked = true;
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    await act(async () => { root.render(createElement(KumandaPage)); });
    const button = host.querySelector('[data-testid="pwa-auth-recover-button"]') as HTMLButtonElement;
    await act(async () => { button.click(); });

    expect(cleanup.init).toHaveBeenCalledTimes(1);
    expect(cleanup.retry).toHaveBeenCalledTimes(1);
    /* SIRA: kurtarma kararı ancak runtime hazırken doğru verilir. */
    expect(cleanup.order).toEqual(['init', 'retry']);
    expect(reload).toHaveBeenCalled();
  });

  it('5 — snapshot henüz CHECKING iken de kurtarma DENENİR (yarış kilitlemez)', async () => {
    guard.blocked = true;
    /* İlk render'da initialize asenkron olduğu için snapshot böyle gelebilir;
       eskiden düğme bu durumda kurtarmayı ATLIYOR ve kullanıcı kilitli
       ekranda kalıyordu. */
    cleanup.bootStatus = 'CHECKING';
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    await act(async () => { root.render(createElement(KumandaPage)); });
    const button = host.querySelector('[data-testid="pwa-auth-recover-button"]') as HTMLButtonElement;
    await act(async () => { button.click(); });

    expect(cleanup.init).toHaveBeenCalledTimes(1);
    expect(cleanup.retry).toHaveBeenCalledTimes(1);
  });

  it('6 — kurtarma da yetmezse kullanıcıya SON ÇARE yolu gösterilir', async () => {
    guard.blocked = true;
    await act(async () => { root.render(createElement(KumandaPage)); });

    /* Kullanıcı hiçbir koşulda mahsur kalmamalı. */
    expect(host.textContent).toContain('verilerini temizleyip');
    expect(host.textContent).toContain('hesabınızda kalır');
  });
});
