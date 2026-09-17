/**
 * f1GoogleAuthFoundation — ARABAM CEBİMDE F1 KİLİTLERİ.
 *
 * Ölçülen ürün kararı: PWA artık anonim-first DEĞİLDİR. Google ile giriş
 * zorunludur, oturum hatırlanır ve MEVCUT anonim kullanıcının araç sahipliği
 * bu geçişte KAYBOLMAZ.
 *
 * Testler DAVRANIŞA bakar (hangi auth yazıcısı çağrıldı, hangi ekran kuruldu,
 * hangi istek gitti); kaynak-regex tek başına kanıt sayılmaz.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

/* ── Oturum gözlemcisi: gate'i sürmek için tek kaynak ── */
const session = vi.hoisted(() => ({
  value: {
    userId: null as string | null,
    loading: true,
    isAnonymous: false,
    authError: false,
  },
}));
vi.mock('@/hooks/useSessionUser', () => ({
  useSessionUser: () => session.value,
}));

/* ── Ağır PWA çocukları: gate testinin konusu değiller ── */
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => undefined }));
const mounts = vi.hoisted(() => ({ carControl: 0 }));
vi.mock('@/components/dashboard/MobileCarControl', () => ({
  default: () => {
    mounts.carControl += 1;
    return createElement('div', { 'data-testid': 'car-control' });
  },
}));
vi.mock('@/components/pwa/PairingScreen', () => ({
  default: () => createElement('div', { 'data-testid': 'pairing-screen' }),
}));
vi.mock('@/lib/vehicles.service', () => ({ fetchVehicles: vi.fn(async () => []) }));

/* ── Tarayıcı Supabase client'ı: `lib/supabase` GERÇEK kalır ki
   `ensurePwaSession`in yeni sözleşmesi (oturum AÇMAZ) ölçülebilsin. ── */
const browser = vi.hoisted(() => ({
  signInAnonymously: vi.fn(async () => ({ data: { session: null }, error: null })),
  session: null as null | { access_token: string },
}));
vi.mock('@/lib/supabaseBrowser', () => ({
  isSupabaseConfigured: true,
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: browser.session }, error: null }),
      signInAnonymously: browser.signInAnonymously,
    },
  }),
  SUPABASE_AUTH_COOKIE_PREFIX: 'sb-test-auth-token',
}));
vi.mock('@/security/accountCleanup/accountCleanupRuntime', () => ({
  authorizePairingContinuation: async () => ({ allowed: true }),
  evaluateAccountScopedCapability: () => ({ allowed: true }),
}));

/* ── Kanonik çıkış: gerçek koordinatör yerine sonucu sürülebilir casus ── */
const logout = vi.hoisted(() => ({
  fn: vi.fn(async () => ({ ok: true, cleanupId: 'c1', state: 'COMPLETED' })),
}));
vi.mock('@/security/accountCleanup/canonicalLogout', () => ({
  requestCanonicalLogout: logout.fn,
}));

/* AUTH_ERROR ekranı kurtarma yolu sunduğu için temizlik runtime'ını okur. */
vi.mock('@/security/accountCleanup/useAccountCleanupRuntime', () => ({
  useAccountCleanupRuntime: () => ({
    runtime: { retryRecovery: vi.fn(async () => undefined) },
    snapshot: { initialized: true, bootStatus: 'SAFE_TO_START' },
    isBrowser: true,
  }),
}));

import KumandaPage from '@/app/(pwa)/kumanda/page';
import {
  buildPwaOAuthRedirectUrl,
  chooseGoogleEntryMode,
  classifyLinkFailure,
  classifyPwaSession,
  resolveAuthFailureRedirect,
  resolvePwaAuthPhase,
  startGoogleSignIn,
} from '@/lib/pwaAuth';

let host: HTMLDivElement;
let root: Root;

async function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(KumandaPage)); });
}

async function teardown() {
  if (root) await act(async () => { root.unmount(); });
  host?.remove();
}

function find(testId: string): Element | null {
  return host.querySelector(`[data-testid="${testId}"]`);
}

beforeEach(() => {
  session.value = { userId: null, loading: true, isAnonymous: false, authError: false };
  mounts.carControl = 0;
  logout.fn.mockClear();
  logout.fn.mockResolvedValue({ ok: true, cleanupId: 'c1', state: 'COMPLETED' });
});
afterEach(async () => { await teardown(); vi.clearAllMocks(); });

describe('F1 · giriş kapısı', () => {
  it('1 — oturum yokken Google giriş ekranı gösterilir', async () => {
    session.value = { userId: null, loading: false, isAnonymous: false, authError: false };
    await render();

    expect(find('pwa-login-screen')).not.toBeNull();
    expect(host.textContent).toContain('Google ile Giriş Yap');
    expect(find('car-control')).toBeNull();
  });

  it('2 — kalıcı geçerli oturumda giriş ekranı GÖSTERİLMEZ, uygulama açılır', async () => {
    session.value = { userId: 'user-a', loading: false, isAnonymous: false, authError: false };
    await render();

    expect(find('pwa-login-screen')).toBeNull();
    /* Kullanıcı doğrudan Arabam Cebimde yüzeyine düşer. */
    expect(find('pwa-logout-button')).not.toBeNull();
    expect(host.textContent).toContain('Arabam Cebimde');
  });

  it('3 — oturum HENÜZ bilinmiyorken giriş ekranı "bir kare" bile gösterilmez', async () => {
    session.value = { userId: null, loading: true, isAnonymous: false, authError: false };
    await render();

    expect(find('pwa-boot-screen')).not.toBeNull();
    expect(find('pwa-login-screen')).toBeNull();

    /* Oturum gelince giriş ekranına DÜŞMEDEN uygulamaya geçilir. */
    session.value = { userId: 'user-a', loading: false, isAnonymous: false, authError: false };
    await act(async () => { root.render(createElement(KumandaPage)); });
    expect(find('pwa-login-screen')).toBeNull();
    expect(find('pwa-logout-button')).not.toBeNull();
  });

  it('3b — oturum SORULAMADIYSA "giriş yapılmamış" denmez (AUTH_ERROR ayrıdır)', async () => {
    session.value = { userId: null, loading: false, isAnonymous: false, authError: true };
    await render();

    expect(find('pwa-auth-error-screen')).not.toBeNull();
    expect(find('pwa-login-screen')).toBeNull();
  });

  it('10 — eski ANONİM kimlik normal giriş yolu SAYILMAZ; giriş istenir', async () => {
    session.value = { userId: 'anon-1', loading: false, isAnonymous: true, authError: false };
    await render();

    expect(find('pwa-login-screen')).not.toBeNull();
    /* Kullanıcı verisinin taşınacağı açıkça söylenir (sessiz kayıp yok). */
    expect(host.textContent).toContain('araçlarınız Google hesabınıza taşınacak');
  });
});

describe('F1 · çıkış ve hesap değişimi', () => {
  it('4 — çıkış kanonik hesap temizliğini çağırır', async () => {
    session.value = { userId: 'user-a', loading: false, isAnonymous: false, authError: false };
    await render();

    const button = find('pwa-logout-button') as HTMLButtonElement;
    await act(async () => { button.click(); });

    expect(logout.fn).toHaveBeenCalledTimes(1);

    /* Oturum düştüğünde kapı giriş ekranına geçer. */
    session.value = { userId: null, loading: false, isAnonymous: false, authError: false };
    await act(async () => { root.render(createElement(KumandaPage)); });
    expect(find('pwa-login-screen')).not.toBeNull();
  });

  it('4b — temizlik tamamlanmazsa oturum "kapandı" GÖSTERİLMEZ', async () => {
    logout.fn.mockResolvedValue({
      ok: false, cleanupId: 'c1', state: 'FAILED_BLOCKING',
      failureCode: 'AUTH_CLEANUP_TARGET_UNAVAILABLE',
    });
    session.value = { userId: 'user-a', loading: false, isAnonymous: false, authError: false };
    await render();

    const button = find('pwa-logout-button') as HTMLButtonElement;
    await act(async () => { button.click(); });

    expect(host.textContent).toContain('Çıkış tamamlanamadı');
    expect(find('pwa-logout-button')).not.toBeNull(); // hâlâ oturumdayız
  });

  it('5 — çıkış araç SAHİPLİĞİNİ silmez (unlink isteği gitmez)', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    session.value = { userId: 'user-a', loading: false, isAnonymous: false, authError: false };
    await render();

    const button = find('pwa-logout-button') as HTMLButtonElement;
    await act(async () => { button.click(); });

    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes('/api/vehicle/unlink'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('6 — hesap A → B geçişinde ağaç SIFIRDAN kurulur (A durumu B\'ye taşınmaz)', async () => {
    const { useVehicleStore } = await import('@/store/vehicleStore');
    /* A hesabının aracı ekranda: kumanda yüzeyi gerçekten kurulmuş olmalı ki
       "B'ye devredilmiyor" iddiası ölçülebilir olsun. */
    useVehicleStore.setState({
      loading: false,
      error: null,
      activeVehicleId: 'veh-a',
      vehicles: { 'veh-a': { id: 'veh-a', name: 'A Aracı', plate: '01 A 01' } },
    } as never);

    session.value = { userId: 'user-a', loading: false, isAnonymous: false, authError: false };
    await render();
    const afterA = mounts.carControl;
    expect(afterA).toBeGreaterThanOrEqual(1);

    session.value = { userId: 'user-b', loading: false, isAnonymous: false, authError: false };
    await act(async () => { root.render(createElement(KumandaPage)); });

    /* `key={userId}` → eski ağaç sökülür, yenisi kurulur: closure'da kalan
       A verisi B ekranına devredilemez. */
    expect(mounts.carControl).toBeGreaterThan(afterA);
  });
});

describe('F1 · anonim → Google geçişi (sahiplik güvenliği)', () => {
  function clientWith(user: { id: string; is_anonymous?: boolean } | null) {
    const linkIdentity = vi.fn(async () => ({ data: { provider: 'google', url: 'u' }, error: null }));
    const signInWithOAuth = vi.fn(async () => ({ data: { provider: 'google', url: 'u' }, error: null }));
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: user ? { user } : null },
          error: null,
        })),
        linkIdentity,
        signInWithOAuth,
      },
    };
    return { client, linkIdentity, signInWithOAuth };
  }

  it('11 — anonim oturum varken KİMLİK BAĞLANIR, yeni hesap AÇILMAZ', async () => {
    const { client, linkIdentity, signInWithOAuth } = clientWith({ id: 'anon-1', is_anonymous: true });

    const result = await startGoogleSignIn(
      'https://app.example',
      client as unknown as Parameters<typeof startGoogleSignIn>[1],
    );

    expect(result).toEqual({ ok: true, mode: 'LINK_IDENTITY' });
    expect(linkIdentity).toHaveBeenCalledTimes(1);
    /* KRİTİK: `signInWithOAuth` YENİ uid üretir ve anonim araç sahipliğini
       yetim bırakırdı — anonim oturumda ASLA çağrılmamalı. */
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(linkIdentity.mock.calls[0][0]).toMatchObject({
      provider: 'google',
      options: { redirectTo: 'https://app.example/auth/callback?next=%2Fkumanda' },
    });
  });

  it('12 — kimlik bağlama başarısızsa FAIL CLOSED: yeni hesap açılmaz, veri yerinde kalır', async () => {
    const { client, linkIdentity, signInWithOAuth } = clientWith({ id: 'anon-1', is_anonymous: true });
    linkIdentity.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: { code: 'manual_linking_disabled', message: 'disabled' },
    } as never);

    const result = await startGoogleSignIn(
      'https://app.example',
      client as unknown as Parameters<typeof startGoogleSignIn>[1],
    );

    expect(result).toEqual({ ok: false, code: 'MANUAL_LINKING_DISABLED' });
    /* Sessizce temiz girişe DÜŞÜLMEZ; düşseydi anonim araçlar yetim kalırdı. */
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it('12b — Google hesabı başka kullanıcıya bağlıysa da temiz girişe düşülmez', async () => {
    const { client, linkIdentity, signInWithOAuth } = clientWith({ id: 'anon-1', is_anonymous: true });
    linkIdentity.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: { code: 'identity_already_exists', message: 'exists' },
    } as never);

    const result = await startGoogleSignIn(
      'https://app.example',
      client as unknown as Parameters<typeof startGoogleSignIn>[1],
    );

    expect(result).toEqual({ ok: false, code: 'IDENTITY_ALREADY_LINKED' });
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it('11b — oturum hiç yokken temiz Google girişi yapılır', async () => {
    const { client, linkIdentity, signInWithOAuth } = clientWith(null);

    const result = await startGoogleSignIn(
      'https://app.example',
      client as unknown as Parameters<typeof startGoogleSignIn>[1],
    );

    expect(result).toEqual({ ok: true, mode: 'FRESH_SIGN_IN' });
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(linkIdentity).not.toHaveBeenCalled();
  });

  it('11c — oturum OKUNAMAZSA karar verilemez; temiz girişe düşülmez', async () => {
    const { client, linkIdentity, signInWithOAuth } = clientWith(null);
    client.auth.getSession = vi.fn(async () => { throw new Error('storage'); });

    const result = await startGoogleSignIn(
      'https://app.example',
      client as unknown as Parameters<typeof startGoogleSignIn>[1],
    );

    expect(result).toEqual({ ok: false, code: 'SIGN_IN_FAILED' });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(linkIdentity).not.toHaveBeenCalled();
  });
});

describe('F1 · saf oturum/yönlendirme modeli', () => {
  it('anonim oturum AUTHENTICATED sayılmaz ama kimliği korunur', () => {
    expect(classifyPwaSession({ user: { id: 'a1', is_anonymous: true } } as never))
      .toMatchObject({ phase: 'SIGNED_OUT', userId: 'a1', isAnonymous: true });
    expect(classifyPwaSession({ user: { id: 'g1' } } as never))
      .toMatchObject({ phase: 'AUTHENTICATED', userId: 'g1', isAnonymous: false });
    expect(classifyPwaSession(null)).toMatchObject({ phase: 'SIGNED_OUT', userId: null });
  });

  it('faz sırası: BOOTING önce gelir, AUTH_ERROR SIGNED_OUT ile karışmaz', () => {
    expect(resolvePwaAuthPhase({ loading: true, authError: true, userId: null, isAnonymous: false }))
      .toBe('BOOTING');
    expect(resolvePwaAuthPhase({ loading: false, authError: true, userId: null, isAnonymous: false }))
      .toBe('AUTH_ERROR');
    expect(resolvePwaAuthPhase({ loading: false, authError: false, userId: 'u', isAnonymous: true }))
      .toBe('SIGNED_OUT');
    expect(resolvePwaAuthPhase({ loading: false, authError: false, userId: 'u', isAnonymous: false }))
      .toBe('AUTHENTICATED');
  });

  it('giriş yolu kararı anonim oturumda BAĞLAMA olur', () => {
    expect(chooseGoogleEntryMode({ user: { id: 'a', is_anonymous: true } } as never))
      .toBe('LINK_IDENTITY');
    expect(chooseGoogleEntryMode({ user: { id: 'g' } } as never)).toBe('FRESH_SIGN_IN');
    expect(chooseGoogleEntryMode(null)).toBe('FRESH_SIGN_IN');
  });

  it('bilinmeyen bağlama hatası "başarı" sayılmaz', () => {
    expect(classifyLinkFailure(undefined)).toBe('LINK_FAILED');
    expect(classifyLinkFailure('manual_linking_disabled')).toBe('MANUAL_LINKING_DISABLED');
    expect(classifyLinkFailure('identity_already_exists')).toBe('IDENTITY_ALREADY_LINKED');
  });

  it('10b — `ensurePwaSession` ARTIK oturum AÇMAZ (görünmez anonim giriş kaldırıldı)', async () => {
    browser.session = null;
    browser.signInAnonymously.mockClear();
    const { ensurePwaSession } = await import('@/lib/supabase');

    await expect(ensurePwaSession()).resolves.toBeNull();
    /* Eski davranış burada sessizce anonim uid üretiyordu; giriş kapısını
       anlamsız kılar ve kullanıcıyı kurtarılamaz bir kimliğe bağlardı. */
    expect(browser.signInAnonymously).not.toHaveBeenCalled();

    browser.session = { access_token: 'tok-google' };
    await expect(ensurePwaSession()).resolves.toBe('tok-google');
    expect(browser.signInAnonymously).not.toHaveBeenCalled();
  });

  it('9 — OAuth dönüşü Arabam Cebimde yüzeyine gider; hata da filo login\'ine düşmez', () => {
    expect(buildPwaOAuthRedirectUrl('https://app.example'))
      .toBe('https://app.example/auth/callback?next=%2Fkumanda');
    expect(resolveAuthFailureRedirect('/kumanda', 'expired'))
      .toBe('/kumanda?auth_error=expired');
    /* Filo akışı DEĞİŞMEZ. */
    expect(resolveAuthFailureRedirect('/dashboard', 'expired'))
      .toBe('/login?error=expired');
  });
});

describe('F1 · sahiplik sunucudadır (telefon değişimi · araç limiti)', () => {
  it('7 — yeni cihazda yerel kayıt YOKKEN araçlar sunucudan geri gelir', async () => {
    const { fetchVehicles } = await import('@/lib/vehicles.service');
    const { useVehicleStore } = await import('@/store/vehicleStore');
    /* Telefon değişimi: bu cihazda hiçbir yerel eşleştirme kaydı yok. */
    localStorage.clear();
    useVehicleStore.setState({ vehicles: {}, loading: true, error: null } as never);
    vi.mocked(fetchVehicles).mockResolvedValue([
      { id: 'veh-1', name: 'Megane', plate: '34 AB 34' },
    ] as never);

    await useVehicleStore.getState().initializeFromSupabase();

    /* Kurtarma YEREL DEPODAN değil, hesabın sunucudaki sahipliğinden gelir —
       yeni bir eşleştirme kodu istenmez. */
    expect(Object.keys(useVehicleStore.getState().vehicles)).toEqual(['veh-1']);
    expect(localStorage.getItem('caros_pair_vehicle_id')).toBeNull();
  });

  it('8 — 3 araç limiti SUNUCU otoritesidir; istemci kendi sayımıyla kapı kurmaz', async () => {
    browser.session = { access_token: 'tok-google' };
    const { pairVehicle } = await import('@/lib/pairingService');
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({
        error: 'Bireysel hesapla en fazla 3 araç bağlayabilirsin.',
        code: 'individual_vehicle_limit_reached',
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await pairVehicle('123456');

    /* İstek SUNUCUYA gitti: limit kararı istemcide taklit edilmiyor. */
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/vehicle/link');
    expect(result.success).toBe(false);
    expect(result.code).toBe('individual_vehicle_limit_reached');
    vi.unstubAllGlobals();
  });
});
