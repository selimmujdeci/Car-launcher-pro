/**
 * supabaseAuthLockContract — SUPABASE KİLİT SÖZLEŞMESİ.
 *
 * ── ÖLÇÜLEN KUSUR (production, 2026-09-17) ───────────────────────────────
 * `canonicalSupabaseAuthLock`, kilit ANINDA alınamadığında generic `Error`
 * fırlatıyordu. auth-js 2.110.1 bu durumu YALNIZ `LockAcquireTimeoutError`
 * türevinden anlar:
 *
 *   GoTrueClient.js · _autoRefreshTokenTick
 *     catch (e) {
 *       if (e instanceof LockAcquireTimeoutError) { ...sessizce atla... }
 *       else { throw e }
 *     }
 *
 * Generic hata `throw e` dalına düşüyordu. Tarayıcı konsolunda görülen:
 *   `Uncaught (in promise) Error: SUPABASE_AUTH_STORAGE_LOCK_UNAVAILABLE`
 * Asıl zarar ÇIKIŞTA ortaya çıkıyordu: hesap temizliği ikinci bir
 * GoTrueClient açıp aynı depolama anahtarının kilidini isteyince bu hata
 * `getSession()` içinde yakalanıp `SERVER_SESSION_READ_FAILED`e dönüşüyor,
 * temizlik `FAILED_BLOCKING` bitiyor ve kullanıcı "Çıkış tamamlanamadı"
 * görüyordu.
 *
 * Bu testler kilit POLİTİKASINI değil, SDK'ya iletilen hata TİPİNİ kilitler:
 * meşgul kilit yine alınmaz.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigatorLockAcquireTimeoutError } from '@supabase/auth-js';

type LockCallback = (lock: { name: string; mode: string } | null) => Promise<unknown>;

/** `ifAvailable` istendiğinde kilidi MEŞGUL gösteren tarayıcı taklidi. */
function stubLockManager(options: { busy: boolean }) {
  const calls: Array<{ name: string; ifAvailable: boolean }> = [];
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        name: string,
        opts: { ifAvailable?: boolean; signal?: AbortSignal },
        callback: LockCallback,
      ) => {
        calls.push({ name, ifAvailable: opts.ifAvailable === true });
        /* Web Locks API sözleşmesi: `ifAvailable` ile kilit meşgulse
           geri çağrı NULL ile çalıştırılır. */
        if (opts.ifAvailable && options.busy) return callback(null);
        return callback({ name, mode: 'exclusive' });
      },
    },
  });
  return calls;
}

async function loadLock() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://lock-contract.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
  const mod = await import('@/lib/supabaseBrowser');
  return mod.canonicalSupabaseAuthLock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('canonicalSupabaseAuthLock · auth-js sözleşmesi', () => {
  it('meşgul kilitte (acquireTimeout=0) Supabase\'in TANIDIĞI hata tipi fırlatılır', async () => {
    stubLockManager({ busy: true });
    const lock = await loadLock();

    let caught: unknown;
    let ran = false;
    try {
      await lock('lock:sb-test-auth-token', 0, async () => { ran = true; return 'x'; });
    } catch (error) {
      caught = error;
    }

    /* KİLİT POLİTİKASI: meşgul kilit alınmaz, iş ÇALIŞTIRILMAZ. */
    expect(ran).toBe(false);
    /* SÖZLEŞME: auth-js `instanceof LockAcquireTimeoutError` ile bakar;
       `NavigatorLockAcquireTimeoutError` o sınıftan türer. Generic `Error`
       fırlatılırsa auth-js hatayı yeniden fırlatır (ölçülen kusur). */
    expect(caught).toBeInstanceOf(NavigatorLockAcquireTimeoutError);
    expect((caught as { isAcquireTimeout?: boolean }).isAcquireTimeout).toBe(true);
  });

  it('kilit müsaitse iş normal çalışır (davranış değişmedi)', async () => {
    const calls = stubLockManager({ busy: false });
    const lock = await loadLock();

    await expect(lock('lock:sb-test-auth-token', 0, async () => 'sonuc'))
      .resolves.toBe('sonuc');
    expect(calls[0]).toMatchObject({ ifAvailable: true });
  });

  it('süreli bekleme (acquireTimeout>0) `ifAvailable` KULLANMAZ — kuyruğa girer', async () => {
    const calls = stubLockManager({ busy: false });
    const lock = await loadLock();

    await expect(lock('lock:sb-test-auth-token', 10_000, async () => 'ok'))
      .resolves.toBe('ok');
    /* Bu yol beklemelidir; `ifAvailable` ile anında vazgeçmemelidir. */
    expect(calls[0]).toMatchObject({ ifAvailable: false });
  });

  it('Web Locks API yoksa kilit SAĞLANMAZ (fail-closed korunur)', async () => {
    vi.stubGlobal('navigator', {});
    const lock = await loadLock();

    await expect(lock('lock:sb-test-auth-token', 0, async () => 'x'))
      .rejects.toThrow('SUPABASE_AUTH_STORAGE_LOCK_UNAVAILABLE');
  });
});
