/**
 * deepLinkAuthSessionFixationN4.test.ts — MRI N-4 · DEEP-LINK AUTH SESSION FIXATION.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN SALDIRI YÜZEYİ
 *
 * AndroidManifest `carospro://auth/*` şemasını `autoVerify="false"` +
 * BROWSABLE + DEFAULT ile kaydeder. Doğrulanmamış custom URI şeması olduğu
 * için bu intent'i HERHANGİ bir uygulama ya da sürücünün ziyaret ettiği
 * HERHANGİ bir web sayfası tetikleyebilir.
 *
 * Üretim zinciri:
 *   Intent → MainActivity → Capacitor → App.tsx `appUrlOpen`
 *   → (yalnız `url.startsWith('carospro://auth/')`)
 *   → RoleStore.handleRecoveryUrl(url)
 *   → client.auth.verifyOtp({token_hash})  /  client.auth.setSession({tokens})
 *
 * ── N-4 İDDİASI ───────────────────────────────────────────────────────────
 * Callback, bu cihazın BAŞLATTIĞI bir kurtarma denemesine BAĞLI DEĞİLDİR.
 * Yani saldırganın ürettiği bir callback, head-unit'in admin oturumunu
 * saldırganın hesabına SABİTLEYEBİLİR (session fixation / forced login).
 *
 * Doğru güven zinciri şu olmalıdır:
 *   LOCAL LOGIN INTENT → LOCALLY BOUND ATTEMPT → EXPECTED CALLBACK
 *   → ONE-SHOT CONSUMPTION → CANONICAL SESSION AUTHORITY
 * Unsolicited / stale / replayed callback: FAIL CLOSED.
 *
 * ── KANIT SEVİYESİ ────────────────────────────────────────────────────────
 * DAVRANIŞSAL: gerçek `useRoleStore.handleRecoveryUrl` üretim fonksiyonu
 * çalıştırılır; yalnız Supabase SDK sınırı taklit edilir ve oturum değiştiren
 * çağrıların (`setSession` / `verifyOtp`) GERÇEKTEN yapılıp yapılmadığı
 * ölçülür. Gerçek hesap/kimlik bilgisi KULLANILMAZ — sentinel değerler.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Supabase SDK sınırı — oturum değiştiren çağrıları gözlemler. */
const sdk = vi.hoisted(() => ({
  setSessionCalls: [] as Array<{ access_token: string; refresh_token: string }>,
  verifyOtpCalls:  [] as Array<{ token_hash: string; type: string }>,
  signOutCalls:    0,
  /** Sıradaki çağrının döneceği hata (null = başarı). */
  nextError:       null as null | { message: string },
  /**
   * W-16: oturum kurulduktan SONRA `getUser()` ile okunan kimlik. Kapı artık
   * bu kimliği denemeyi başlatan hesaba bağlar; taklit de bunu yansıtmalı.
   */
  sessionEmail:    'admin@test.local' as string | null,
  /** SDK'nın kayıtlı auth-state dinleyicileri (gerçek SDK gibi tetiklenir). */
  authListeners:   [] as Array<(event: string) => void>,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      setSession: vi.fn(async (o: { access_token: string; refresh_token: string }) => {
        sdk.setSessionCalls.push(o);
        return { error: sdk.nextError };
      }),
      verifyOtp: vi.fn(async (o: { token_hash: string; type: string }) => {
        sdk.verifyOtpCalls.push(o);
        /* GERÇEK SDK DAVRANIŞI: recovery doğrulaması başarılıysa
           `PASSWORD_RECOVERY` abonelere DUYURULUR (GoTrueClient.js:1601). */
        if (!sdk.nextError) for (const cb of sdk.authListeners) cb('PASSWORD_RECOVERY');
        return { error: sdk.nextError };
      }),
      signOut: vi.fn(async () => { sdk.signOutCalls++; return { error: null }; }),
      getUser: vi.fn(async () => (sdk.sessionEmail
        ? { data: { user: { email: sdk.sessionEmail } }, error: null }
        : { data: { user: null }, error: { message: 'no session' } })),
      onAuthStateChange: vi.fn((cb: (event: string) => void) => {
        sdk.authListeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      }),
      resetPasswordForEmail: vi.fn(async () => ({ error: sdk.nextError })),
      signInWithPassword:    vi.fn(async () => ({ error: sdk.nextError })),
      updateUser:            vi.fn(async () => ({ error: null })),
    },
  }),
}));

/** Admin client'ın var sayılması için yapılandırma sabitleri. */
vi.mock('../platform/supabaseClient', () => ({
  SUPABASE_URL:      'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  getSupabaseClient: () => null,
}));

vi.mock('../platform/ai/gateway/aiGatewayAccessRuntime', () => ({
  refreshGatewayAccess: vi.fn(async () => undefined),
}));

/** Saldırganın ürettiği kimlik malzemesi (sentinel — gerçek token DEĞİL). */
const ATTACKER_ACCESS  = 'ATTACKER_ACCESS_TOKEN_SENTINEL';
const ATTACKER_REFRESH = 'ATTACKER_REFRESH_TOKEN_SENTINEL';
const ATTACKER_HASH    = 'ATTACKER_TOKEN_HASH_SENTINEL';

const legacyUrl = (a = ATTACKER_ACCESS, r = ATTACKER_REFRESH): string =>
  `carospro://auth/recovery#access_token=${a}&refresh_token=${r}&type=recovery`;
const otpUrl = (h = ATTACKER_HASH): string =>
  `carospro://auth/recovery?token_hash=${h}&type=recovery`;

async function store() {
  const mod = await import('../platform/roleSystem/RoleStore');
  return mod.useRoleStore;
}

/** Oturum değiştiren HERHANGİ bir çağrı yapıldı mı? */
function sessionChanged(): boolean {
  return sdk.setSessionCalls.length > 0 || sdk.verifyOtpCalls.length > 0;
}

beforeEach(() => {
  vi.resetModules();
  sdk.setSessionCalls = [];
  sdk.verifyOtpCalls  = [];
  sdk.signOutCalls    = 0;
  sdk.nextError       = null;
  sdk.sessionEmail    = 'admin@test.local';
  sdk.authListeners   = [];
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
});

// ── R1/R2 · DAVETSİZ CALLBACK ───────────────────────────────────────────────

describe('N-4/R1 · davetsiz callback oturumu DEĞİŞTİREMEZ', () => {
  it('yerel kurtarma denemesi YOKKEN legacy token callback\'i REDDEDİLİR', async () => {
    const s = await store();
    await s.getState().handleRecoveryUrl(legacyUrl());

    expect(
      sdk.setSessionCalls,
      'cihaz hiçbir kurtarma başlatmamışken saldırganın token\'ları ile setSession '
      + 'çağrıldı — head-unit oturumu saldırgan hesabına SABİTLENDİ (session fixation)',
    ).toEqual([]);
    expect(s.getState().adminAuthState).not.toBe('recovery');
  });

  it('yerel deneme YOKKEN token_hash callback\'i REDDEDİLİR', async () => {
    const s = await store();
    await s.getState().handleRecoveryUrl(otpUrl());

    expect(
      sdk.verifyOtpCalls,
      'davetsiz token_hash ile verifyOtp çağrıldı — saldırgan kendi hesabının '
      + 'kurtarma token\'ıyla head-unit oturumunu ele geçirir',
    ).toEqual([]);
    expect(s.getState().adminAuthState).not.toBe('recovery');
  });
});

// ── R3 · KÖKEN DOĞRULAMASI ─────────────────────────────────────────────────

describe('N-4/R3 · yalnız beklenen şema/host/path kabul edilir', () => {
  it('yanlış şema/host/path REDDEDİLİR (yerel deneme açıkken bile)', async () => {
    const s = await store();
    await s.getState().resetPassword('admin@test.local');

    for (const bad of [
      'https://evil.example/auth/recovery#access_token=a&refresh_token=b&type=recovery',
      'carospro://evil/recovery#access_token=a&refresh_token=b&type=recovery',
      'carospro://auth/evil?token_hash=h&type=recovery',
      'carosproX://auth/recovery?token_hash=h&type=recovery',
    ]) {
      await s.getState().handleRecoveryUrl(bad);
    }

    expect(sessionChanged(), `beklenmeyen köken kabul edildi: ${JSON.stringify(
      { setSession: sdk.setSessionCalls, verifyOtp: sdk.verifyOtpCalls })}`).toBe(false);
  });
});

// ── R4 · REPLAY ────────────────────────────────────────────────────────────

describe('N-4/R4 · callback TEK KULLANIMLIKTIR', () => {
  it('aynı callback ikinci kez oturum değiştiremez', async () => {
    const s = await store();
    await s.getState().resetPassword('admin@test.local');

    await s.getState().handleRecoveryUrl(otpUrl());
    expect(sdk.verifyOtpCalls.length, 'meşru callback kabul edilmedi — kapı fazla sıkı').toBe(1);

    await s.getState().handleRecoveryUrl(otpUrl());
    expect(
      sdk.verifyOtpCalls.length,
      'tekrar oynatılan callback yeniden oturum kurdu — one-shot tüketim yok',
    ).toBe(1);
  });
});

// ── R5 · LOGOUT / İPTAL SONRASI BAYAT CALLBACK ─────────────────────────────

describe('N-4/R5 · logout sonrası bayat callback oturumu DİRİLTEMEZ', () => {
  it('signOutAdmin sonrası gelen eski callback reddedilir', async () => {
    const s = await store();
    await s.getState().resetPassword('admin@test.local');
    await s.getState().signOutAdmin();

    await s.getState().handleRecoveryUrl(otpUrl());

    expect(
      sessionChanged(),
      'çıkış yapıldıktan sonra gelen bayat callback oturumu yeniden açtı '
      + '(session resurrection)',
    ).toBe(false);
  });
});

// ── R7 · BOZUK GİRDİ ───────────────────────────────────────────────────────

describe('N-4/R7 · bozuk callback fail-closed', () => {
  it('eksik/bozuk parametreler oturum değiştirmez ve HATA FIRLATMAZ', async () => {
    const s = await store();
    await s.getState().resetPassword('admin@test.local');

    for (const bad of [
      'carospro://auth/recovery',
      'carospro://auth/recovery?type=recovery',
      'carospro://auth/recovery#type=recovery',
      'carospro://auth/recovery#access_token=onlyone&type=recovery',
      'not-a-url',
      '',
    ]) {
      await expect(s.getState().handleRecoveryUrl(bad)).resolves.not.toThrow();
    }
    expect(sessionChanged(), 'bozuk girdi oturum değiştirdi').toBe(false);
  });
});

// ── R8 · MEVCUT OTURUMUN SESSİZCE DEĞİŞTİRİLMESİ ───────────────────────────

describe('N-4/R8 · mevcut oturum davetsiz callback ile değiştirilemez', () => {
  it('doğrulanmış oturum varken davetsiz callback onu EZEMEZ', async () => {
    const s = await store();
    /* Kurban cihazda doğrulanmış bir yönetici oturumu var. */
    s.setState({ adminAuthState: 'authenticated', syncStatus: 'verified', role: 'super_admin' });

    await s.getState().handleRecoveryUrl(legacyUrl());

    expect(
      sdk.setSessionCalls,
      'davetsiz callback mevcut doğrulanmış oturumu saldırgan kimliğiyle DEĞİŞTİRDİ',
    ).toEqual([]);
    expect(s.getState().syncStatus, 'mevcut oturum durumu bozuldu').toBe('verified');
  });
});

// ── MEŞRU AKIŞ BOZULMAMALI ─────────────────────────────────────────────────

describe('N-4 · meşru kurtarma akışı çalışmaya devam eder', () => {
  it('yerel deneme → doğru callback → oturum kurulur', async () => {
    const s = await store();
    const ok = await s.getState().resetPassword('admin@test.local');
    expect(ok, 'kurtarma başlatılamadı').toBe(true);

    await s.getState().handleRecoveryUrl(otpUrl('LEGIT_HASH'));

    expect(sdk.verifyOtpCalls, 'meşru callback reddedildi — kapı ürünü kırıyor')
      .toHaveLength(1);
    expect(sdk.verifyOtpCalls[0]!.token_hash).toBe('LEGIT_HASH');
    expect(s.getState().adminAuthState).toBe('recovery');
  });

  it('legacy fragment formatı da yerel deneme ile çalışır', async () => {
    const s = await store();
    await s.getState().resetPassword('admin@test.local');

    await s.getState().handleRecoveryUrl(legacyUrl('A_OK', 'R_OK'));

    expect(sdk.setSessionCalls).toHaveLength(1);
    expect(sdk.setSessionCalls[0]).toEqual({ access_token: 'A_OK', refresh_token: 'R_OK' });
  });
});

// ── W-16/RISK B · KİMLİK BAĞI ──────────────────────────────────────────────
//
// Wave 15 kapısı "bu cihazda AÇIK bir deneme var mı" sorusunu yanıtlıyordu —
// yani ZAMAN penceresine dayalıydı. Aynı 30 dakikalık pencerede gelen BAŞKA
// bir hesabın GEÇERLİ callback'i de kabul edilirdi. Wave 16 bağı kimliğe
// taşır: oturum kurulduktan sonra hesap doğrulanır, uyuşmazsa DERHAL kapanır.
//
// DÜRÜSTLÜK: bu kriptografik bir challenge/response DEĞİLDİR (Supabase
// kurtarma akışı cihaza özel bir nonce döndürmez). Sabitlemeyi ÖNLEMEZ,
// KALICI OLMASINI önler.

describe("W-16/RISK B · aynı pencerede gelen YABANCI kimlik kabul edilmez", () => {
  it("başka hesabın geçerli callback'i oturumu sabitleyemez", async () => {
    const s = await store();
    await s.getState().resetPassword("admin@test.local");

    /* Callback geçerli — ama saldırganın KENDİ hesabının oturumunu kurar. */
    sdk.sessionEmail = "attacker@evil.example";
    await s.getState().handleRecoveryUrl(otpUrl());

    expect(sdk.verifyOtpCalls.length, "ölçüm kör — callback hiç işlenmemiş").toBe(1);
    expect(
      s.getState().adminAuthState,
      "yabancı hesabın oturumu kurtarma durumu olarak kabul edildi — cihaz o hesaba sabitlendi",
    ).not.toBe("recovery");
    expect(
      sdk.signOutCalls,
      "kimlik uyuşmazlığında oturum KAPATILMADI — sabitleme kalıcı olur",
    ).toBe(1);
  });

  it("kimlik okunamazsa fail-closed davranır", async () => {
    const s = await store();
    await s.getState().resetPassword("admin@test.local");

    sdk.sessionEmail = null;            // getUser: oturum/kimlik yok
    await s.getState().handleRecoveryUrl(otpUrl());

    expect(s.getState().adminAuthState, "kimlik doğrulanamadan kurtarma açıldı")
      .not.toBe("recovery");
    expect(sdk.signOutCalls, "doğrulanamayan oturum kapatılmadı").toBe(1);
  });

  it("aynı hesap — büyük/küçük harf ve boşluk farkı meşru akışı BOZMAZ", async () => {
    const s = await store();
    await s.getState().resetPassword("  Admin@Test.Local  ");

    sdk.sessionEmail = "admin@test.local";
    await s.getState().handleRecoveryUrl(otpUrl("LEGIT_HASH"));

    expect(s.getState().adminAuthState, "meşru sahip reddedildi — kapı ürünü kırıyor")
      .toBe("recovery");
    expect(sdk.signOutCalls, "meşru oturum kapatıldı").toBe(0);
  });
});

// ── W-16/RISK C · adminAuthState'in TEK YAZARI ─────────────────────────────
//
// `getAdminClient()` ayrıca bir `onAuthStateChange` dinleyicisi kuruyordu ve
// `PASSWORD_RECOVERY` olayında `adminAuthState: 'recovery'` yazıyordu —
// `setTimeout(..., 0)` ile, yani GECİKMELİ. Bu, kapının kimlik reddinden
// SONRA çalışıp reddedilen durumu GERİ KOYABİLİR. Durumun tek yazarı
// `handleRecoveryUrl` olmalıdır (§6 TEK OTORİTE).

describe("W-16/RISK C · reddedilen kurtarma gecikmeli olarak geri gelemez", () => {
  it("kimlik uyuşmazlığından sonra SDK olayı 'recovery' durumunu diriltemez", async () => {
    const s = await store();
    await s.getState().resetPassword("admin@test.local");

    sdk.sessionEmail = "attacker@evil.example";
    await s.getState().handleRecoveryUrl(otpUrl());

    expect(s.getState().adminAuthState, "kapı reddetmemiş — ölçüm kör").not.toBe("recovery");

    /* Gecikmeli yazarın penceresi. */
    await new Promise((r) => setTimeout(r, 10));

    expect(
      s.getState().adminAuthState,
      "SDK olay dinleyicisi, kapı reddettikten SONRA kurtarma durumunu geri koydu — " +
      "adminAuthState'in ikinci yazarı var",
    ).not.toBe("recovery");
  });
});
