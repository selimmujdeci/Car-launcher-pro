/**
 * recoveryNonceBindingW17.test.ts — WAVE 17 · KURTARMA CALLBACK'İ TEK KULLANIMLIK
 * NONCE'A BAĞLANIR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * KALAN AÇIK (Wave 16 · RISK B = PARTIAL)
 *
 * Wave 15 kapısı "bu cihazda açık bir kurtarma var mı?" sorusunu yanıtlıyordu
 * (TTL). Wave 16 buna kimlik karşılaştırması ekledi — ama kimlik ancak oturum
 * KURULDUKTAN SONRA okunabildiği için saldırganın callback'i yine de Supabase
 * sınırına ULAŞIYORDU. Yani:
 *
 *   AKTİF KURTARMA PENCERESİ  !=  CALLBACK KİMLİĞİ
 *   TTL                       !=  BAĞ
 *
 * ── DOĞRU MODEL ───────────────────────────────────────────────────────────
 *   YEREL RASTGELE NONCE  +  BEKLENEN KİMLİK  +  GEÇERLİ RECOVERY TOKEN
 *   +  TEK KULLANIMLIK TÜKETİM   =   BAĞLANMIŞ CALLBACK
 *
 * İki katmanlı kurulur:
 *
 *  1) YEREL NONCE (bu dosyanın ölçtüğü şey)
 *     `redirectTo` içinde geri dönen 128-bit rastgele değer. Saldırgan onu
 *     BİLEMEZ. Supabase sınırına DOKUNMADAN ÖNCE reddedilir — bu aynı zamanda
 *     bir DoS'u da kapatır: yabancı bir callback, kurbanın PKCE verifier'ını
 *     yok ederek meşru kurtarmayı öldüremez.
 *
 *  2) PKCE (sunucu tarafından zorlanır)
 *     `flowType: 'pkce'` ile `resetPasswordForEmail`, cihazda bir
 *     `code_verifier` saklar ve sunucuya yalnız S256 özetini gönderir.
 *     `exchangeCodeForSession` kodu o verifier ile takas eder; başka bir
 *     cihaza ait kod SUNUCUDA reddedilir. Verifier hem başarı hem hata
 *     yolunda silinir → SDK seviyesinde ikinci bir tek-kullanım katmanı.
 *
 *  3) KİMLİK BAĞI (Wave 16) yerinde kalır — derinlik savunması.
 *
 * ── FAIL-CLOSED KRİPTO ────────────────────────────────────────────────────
 * SDK'nın KENDİ yedekleri güvensizdir ve sessizdir:
 *   · `generatePKCEVerifier`  → `crypto` yoksa **Math.random**
 *   · `generatePKCEChallenge` → `crypto.subtle` yoksa **plain** (sır artık
 *     ağda açık gider)
 * Bu yüzden kurtarma başlatılmadan ÖNCE ve callback doğrulanmadan ÖNCE
 * yetenek FİİLEN sınanır; yoksa işlem REDDEDİLİR. "Biraz daha az güvenli
 * ama devam et" YOKTUR.
 *
 * ── KANIT SEVİYESİ (dürüstlük) ────────────────────────────────────────────
 * DAVRANIŞSAL: gerçek `resetPassword` → gerçek depo kaydı →
 * gerçek `handleRecoveryUrl` yolu çalıştırılır. Yalnız Supabase SDK sınırı
 * taklit edilir ve çağrıların GERÇEKTEN yapılıp yapılmadığı ölçülür.
 *
 * ÖLÇÜLMEYEN: nonce'un Supabase e-posta yönlendirmesinden GERİ DÖNDÜĞÜ
 * SUNUCU davranışı. O, projenin kendi Supabase örneği + gerçek e-posta
 * tıklaması ister (CONFIG/DEVICE PENDING). Yanlış çıkarsa sonuç GÜVENSİZ
 * değil, KAPALIdır: nonce gelmez → callback reddedilir.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/** Supabase SDK sınırı. */
const sdk = vi.hoisted(() => ({
  /** `resetPasswordForEmail(email, options)` çağrıları. */
  resetCalls:      [] as Array<{ email: string; redirectTo?: string }>,
  /** Oturum kuran çağrılar. */
  exchangeCalls:   [] as string[],
  verifyOtpCalls:  [] as Array<{ token_hash: string; type: string }>,
  setSessionCalls: [] as Array<{ access_token: string; refresh_token: string }>,
  signOutCalls:    0,
  /** `exchangeCodeForSession` hata döndürsün mü? */
  exchangeError:   null as null | { message: string },
  resetError:      null as null | { message: string },
  /** Oturum kurulduktan sonra `getUser()` ile okunan kimlik. */
  sessionEmail:    'admin@test.local' as string | null,
  authListeners:   [] as Array<(event: string) => void>,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: vi.fn(async (email: string, options?: { redirectTo?: string }) => {
        sdk.resetCalls.push({ email, redirectTo: options?.redirectTo });
        return { error: sdk.resetError };
      }),
      exchangeCodeForSession: vi.fn(async (authCode: string) => {
        sdk.exchangeCalls.push(authCode);
        if (!sdk.exchangeError) for (const cb of sdk.authListeners) cb('PASSWORD_RECOVERY');
        return { data: { session: {}, user: {} }, error: sdk.exchangeError };
      }),
      verifyOtp: vi.fn(async (o: { token_hash: string; type: string }) => {
        sdk.verifyOtpCalls.push(o);
        return { error: null };
      }),
      setSession: vi.fn(async (o: { access_token: string; refresh_token: string }) => {
        sdk.setSessionCalls.push(o);
        return { error: null };
      }),
      signOut: vi.fn(async () => { sdk.signOutCalls++; return { error: null }; }),
      getUser: vi.fn(async () => (sdk.sessionEmail
        ? { data: { user: { email: sdk.sessionEmail } }, error: null }
        : { data: { user: null }, error: { message: 'no session' } })),
      onAuthStateChange: vi.fn((cb: (event: string) => void) => {
        sdk.authListeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      }),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      updateUser:         vi.fn(async () => ({ error: null })),
    },
  }),
}));

vi.mock('../platform/supabaseClient', () => ({
  SUPABASE_URL:      'https://w17test.supabase.co',
  SUPABASE_ANON_KEY: 'w17-anon-key',
  getSupabaseClient: () => null,
}));

vi.mock('../platform/ai/gateway/aiGatewayAccessRuntime', () => ({
  refreshGatewayAccess: vi.fn(async () => undefined),
}));

const VICTIM   = 'admin@test.local';
const AUTH_CODE = 'W17_AUTH_CODE_SENTINEL';

async function store() {
  const mod = await import('../platform/roleSystem/RoleStore');
  return mod.useRoleStore;
}

/** Üretimin gerçekten gönderdiği `redirectTo`dan nonce'u çıkarır. */
function nonceFromRedirect(): string | null {
  const r = sdk.resetCalls.at(-1)?.redirectTo;
  if (!r) return null;
  try { return new URL(r).searchParams.get('state'); } catch { return null; }
}

/** Kurtarma callback'i kurar. */
function callback(opts: { nonce?: string | null; code?: string | null; base?: string } = {}): string {
  const base = opts.base ?? 'carospro://auth/recovery';
  const p = new URLSearchParams();
  if (opts.nonce !== null && opts.nonce !== undefined) p.set('state', opts.nonce);
  if (opts.code  !== null) p.set('code', opts.code ?? AUTH_CODE);
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** Oturum kuran HERHANGİ bir çağrı yapıldı mı? */
function sessionAttempted(): boolean {
  return sdk.exchangeCalls.length > 0
    || sdk.verifyOtpCalls.length > 0
    || sdk.setSessionCalls.length > 0;
}

/** Bu cihazın başlattığı meşru kurtarma → geçerli callback üretir. */
async function startRecovery(s: Awaited<ReturnType<typeof store>>, email = VICTIM): Promise<string> {
  const ok = await s.getState().resetPassword(email);
  expect(ok, 'kurtarma başlatılamadı — ölçüm kör olurdu').toBe(true);
  const n = nonceFromRedirect();
  expect(n, 'redirectTo bir nonce taşımıyor').toBeTruthy();
  return n!;
}

beforeEach(() => {
  vi.resetModules();
  sdk.resetCalls      = [];
  sdk.exchangeCalls   = [];
  sdk.verifyOtpCalls  = [];
  sdk.setSessionCalls = [];
  sdk.signOutCalls    = 0;
  sdk.exchangeError   = null;
  sdk.resetError      = null;
  sdk.sessionEmail    = VICTIM;
  sdk.authListeners   = [];
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
});

// ── NONCE ÜRETİMİ ───────────────────────────────────────────────────────────

describe('W17 · nonce üretimi', () => {
  it('redirectTo kanonik köken + 128 bit entropili nonce taşır', async () => {
    const s = await store();
    const nonce = await startRecovery(s);

    const url = new URL(sdk.resetCalls[0]!.redirectTo!);
    expect(url.protocol, 'şema değişti — Android intent eşleşmesi kırılır').toBe('carospro:');
    expect(url.host).toBe('auth');
    expect(url.pathname).toBe('/recovery');
    expect(nonce, 'nonce 128 bitten kısa').toMatch(/^[0-9a-f]{32,}$/);
  });

  it('her kurtarma FARKLI nonce üretir', async () => {
    const s = await store();
    const a = await startRecovery(s);
    const b = await startRecovery(s);
    expect(b, 'nonce tekrar ediyor — öngörülebilir').not.toBe(a);
  });

  it('PKCE akışı etkin — kod takası sunucuda doğrulanabilsin', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/platform/roleSystem/RoleStore.ts'), 'utf8');
    expect(
      src.includes("flowType: 'pkce'"),
      'admin client implicit akışta — kurtarma kodu cihaza kriptografik olarak bağlanmaz',
    ).toBe(true);
  });
});

// ── T1 · AKTİF DENEME YOK ───────────────────────────────────────────────────

describe('W17/T1 · aktif deneme yokken DENY', () => {
  it('davetsiz callback Supabase sınırına ULAŞMAZ', async () => {
    const s = await store();
    await s.getState().handleRecoveryUrl(callback({ nonce: 'deadbeefdeadbeefdeadbeefdeadbeef' }));

    expect(sessionAttempted(), 'deneme yokken oturum kurma çağrısı yapıldı').toBe(false);
    expect(s.getState().adminAuthState).not.toBe('recovery');
  });
});

// ── T2 · NONCE EKSİK ────────────────────────────────────────────────────────

describe('W17/T2 · nonce taşımayan callback DENY', () => {
  it('aktif deneme varken bile nonce yoksa reddedilir', async () => {
    const s = await store();
    await startRecovery(s);

    await s.getState().handleRecoveryUrl(callback({ nonce: null }));

    expect(
      sessionAttempted(),
      'nonce taşımayan callback kabul edildi — legacy bypass açık',
    ).toBe(false);
    expect(s.getState().adminAuthState).not.toBe('recovery');
  });
});

// ── T3 · YANLIŞ NONCE ───────────────────────────────────────────────────────

describe('W17/T3 · yanlış nonce DENY', () => {
  it("saldırganın nonce degeri Supabase sınırına ULAŞMAZ", async () => {
    const s = await store();
    await startRecovery(s);

    await s.getState().handleRecoveryUrl(
      callback({ nonce: 'ffffffffffffffffffffffffffffffff' }),
    );

    expect(
      sdk.exchangeCalls,
      'yanlış nonce ile kod takası denendi — bu hem oturum riski hem DoS '
      + "(kurbanın verifier kaydı silinir)",
    ).toEqual([]);
    expect(sessionAttempted()).toBe(false);
  });

  it('yanlış nonce MEŞRU denemeyi HARCAMAZ (DoS yok)', async () => {
    const s = await store();
    const good = await startRecovery(s);

    await s.getState().handleRecoveryUrl(callback({ nonce: 'a'.repeat(32) }));
    /* Kurbanın kendi bağlantısı hâlâ çalışmalı. */
    await s.getState().handleRecoveryUrl(callback({ nonce: good }));

    expect(
      sdk.exchangeCalls,
      'saldırganın başarısız denemesi kurbanın kurtarmasını öldürdü (DoS)',
    ).toEqual([AUTH_CODE]);
    expect(s.getState().adminAuthState).toBe('recovery');
  });
});

// ── T4 · DOĞRU NONCE ────────────────────────────────────────────────────────

describe('W17/T4 · doğru nonce PASS', () => {
  it('meşru callback kodu takas eder ve kurtarma açılır', async () => {
    const s = await store();
    const nonce = await startRecovery(s);

    await s.getState().handleRecoveryUrl(callback({ nonce }));

    expect(sdk.exchangeCalls, 'meşru callback reddedildi — kapı ürünü kırıyor')
      .toEqual([AUTH_CODE]);
    expect(s.getState().adminAuthState).toBe('recovery');
    expect(s.getState().authError).toBeNull();
  });
});

// ── T5 · REPLAY ─────────────────────────────────────────────────────────────

describe('W17/T5 · doğru nonce TEK KULLANIMLIK', () => {
  it('aynı callback ikinci kez oturum kuramaz', async () => {
    const s = await store();
    const nonce = await startRecovery(s);

    await s.getState().handleRecoveryUrl(callback({ nonce }));
    expect(sdk.exchangeCalls.length).toBe(1);

    await s.getState().handleRecoveryUrl(callback({ nonce }));
    expect(
      sdk.exchangeCalls.length,
      'tekrar oynatılan callback yeniden kod takas etti — one-shot tüketim yok',
    ).toBe(1);
  });
});

// ── T6 · SÜRESİ DOLMUŞ DENEME ───────────────────────────────────────────────

describe('W17/T6 · süresi dolmuş deneme DENY', () => {
  it('TTL geçtikten sonra doğru nonce bile reddedilir', async () => {
    vi.useFakeTimers();
    try {
      const s = await store();
      const nonce = await startRecovery(s);

      vi.advanceTimersByTime(31 * 60_000);          // TTL 30 dk
      await s.getState().handleRecoveryUrl(callback({ nonce }));

      expect(sessionAttempted(), 'süresi dolmuş deneme kabul edildi').toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

// ── T7 · ÇIKIŞ SONRASI BAYAT NONCE ──────────────────────────────────────────

describe('W17/T7 · çıkış/iptal sonrası eski nonce DENY', () => {
  it('signOutAdmin beklentiyi iptal eder', async () => {
    const s = await store();
    const nonce = await startRecovery(s);
    await s.getState().signOutAdmin();

    await s.getState().handleRecoveryUrl(callback({ nonce }));

    expect(
      sessionAttempted(),
      'çıkıştan sonra gelen bayat callback oturumu diriltti',
    ).toBe(false);
  });
});

// ── T8/T9/T10/T11 · KÖKEN VE BOZUK GİRDİ ────────────────────────────────────

describe('W17/T8-T11 · köken doğrulaması ve bozuk girdi', () => {
  it('yanlış şema/host/path doğru nonce ile bile DENY', async () => {
    const s = await store();
    const nonce = await startRecovery(s);

    for (const base of [
      'https://evil.example/auth/recovery',      // T8 şema
      'carospro://evil/recovery',                // T9 host
      'carospro://auth/evil',                    // T10 path
      'carosproX://auth/recovery',               // T8 yakın şema
    ]) {
      await s.getState().handleRecoveryUrl(callback({ nonce, base }));
    }

    expect(sessionAttempted(), 'beklenmeyen köken kabul edildi').toBe(false);
  });

  it('bozuk callback fail-closed ve HATA FIRLATMAZ (T11)', async () => {
    const s = await store();
    await startRecovery(s);

    for (const bad of [
      'carospro://auth/recovery',
      'carospro://auth/recovery?state=',
      'carospro://auth/recovery?code=only',
      'not-a-url',
      '',
    ]) {
      await expect(s.getState().handleRecoveryUrl(bad)).resolves.not.toThrow();
    }
    expect(sessionAttempted(), 'bozuk girdi oturum kurdu').toBe(false);
  });
});

// ── T12 · DOĞRU NONCE + YANLIŞ KİMLİK ───────────────────────────────────────

describe('W17/T12 · nonce doğru ama kimlik yanlışsa DENY', () => {
  it('kimlik uyuşmazlığında oturum DERHAL kapatılır', async () => {
    const s = await store();
    const nonce = await startRecovery(s);

    sdk.sessionEmail = 'attacker@evil.example';
    await s.getState().handleRecoveryUrl(callback({ nonce }));

    expect(s.getState().adminAuthState, 'yabancı kimlik kurtarma olarak kabul edildi')
      .not.toBe('recovery');
    expect(sdk.signOutCalls, 'uyuşmayan oturum kapatılmadı').toBe(1);

    await new Promise((r) => setTimeout(r, 10));   // gecikmeli yazar penceresi
    expect(s.getState().adminAuthState, 'reddedilen durum geri geldi').not.toBe('recovery');
  });
});

// ── T13 · AYNI PENCEREDE YABANCI KURTARMA ───────────────────────────────────

describe('W17/T13 · kurbanın penceresinde yabancı kurtarma DENY', () => {
  it('saldırganın kendi geçerli kodu kurbanın cihazını sabitleyemez', async () => {
    const s = await store();
    await startRecovery(s);                         // kurban kurtarma başlattı

    /* Saldırganın callback'i: kendi geçerli kodu, ama nonce'u bilmiyor. */
    await s.getState().handleRecoveryUrl(
      callback({ nonce: '0'.repeat(32), code: 'ATTACKER_VALID_CODE' }),
    );

    expect(sdk.exchangeCalls, 'saldırganın kodu takas edildi').toEqual([]);
    expect(s.getState().adminAuthState).not.toBe('recovery');
  });
});

// ── T14/T15 · KRİPTO YOKSA FAIL-CLOSED ──────────────────────────────────────

describe('W17/T14-T15 · kripto yoksa FAIL CLOSED', () => {
  let realSubtle: SubtleCrypto;

  beforeEach(() => { realSubtle = globalThis.crypto.subtle; });
  afterEach(() => {
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: realSubtle, configurable: true, writable: true,
    });
  });

  function removeSubtle(): void {
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: undefined, configurable: true, writable: true,
    });
  }

  it('T14 · kurtarma BAŞLATILAMAZ (SDK Math.random/plain yedeğine düşerdi)', async () => {
    const s = await store();
    removeSubtle();

    const ok = await s.getState().resetPassword(VICTIM);

    expect(ok, 'kripto yokken kurtarma başlatıldı — SDK sırrı düz metin gönderir').toBe(false);
    expect(sdk.resetCalls, "kripto yokken Supabase istegi gonderildi").toEqual([]);
  });

  it('T15 · callback DOĞRULANAMAZ', async () => {
    const s = await store();
    const nonce = await startRecovery(s);

    removeSubtle();
    await s.getState().handleRecoveryUrl(callback({ nonce }));

    expect(
      sessionAttempted(),
      'nonce doğrulanamazken callback kabul edildi',
    ).toBe(false);
  });
});

// ── T16 · EŞZAMANLI CALLBACK ────────────────────────────────────────────────

describe('W17/T16 · eşzamanlı iki callback', () => {
  it('yalnız BİRİ otorite kazanır', async () => {
    const s = await store();
    const nonce = await startRecovery(s);

    await Promise.all([
      s.getState().handleRecoveryUrl(callback({ nonce })),
      s.getState().handleRecoveryUrl(callback({ nonce })),
    ]);

    expect(
      sdk.exchangeCalls.length,
      'iki eşzamanlı callback de kod takas etti — tek kullanım yarışa açık',
    ).toBe(1);
  });
});

// ── LEGACY · GÜVENSİZ BİÇİMLER ARTIK KABUL EDİLMEZ ──────────────────────────

describe("W17 · nonce tasimayan legacy biçimler reddedilir", () => {
  it('#access_token fragmenti DENY', async () => {
    const s = await store();
    await startRecovery(s);

    await s.getState().handleRecoveryUrl(
      'carospro://auth/recovery#access_token=A&refresh_token=R&type=recovery',
    );

    expect(sdk.setSessionCalls, 'legacy implicit callback hâlâ oturum kuruyor').toEqual([]);
  });

  it("nonce tasimayan token_hash DENY", async () => {
    const s = await store();
    await startRecovery(s);

    await s.getState().handleRecoveryUrl(
      'carospro://auth/recovery?token_hash=H&type=recovery',
    );

    expect(sdk.verifyOtpCalls, "nonce tasimayan token_hash hâlâ kabul ediliyor").toEqual([]);
  });
});
