/**
 * urlSessionAuthorityW16.test.ts — WAVE 16 · URL İKİNCİ OTURUM OTORİTESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN YÜZEY
 *
 * Wave 15 (N-4) deep-link kurtarma callback'ini kapalı hale getirdi:
 *   appUrlOpen → handleRecoveryUrl → köken doğrulaması → yerel deneme
 *   tüketimi → ancak o zaman verifyOtp/setSession.
 *
 * ANCAK Supabase auth-js'te İKİNCİ bir oturum kurma yolu vardır ve o yol
 * RoleStore'un kapısından GEÇMEZ:
 *
 *   createClient(...)                       (GoTrueClient constructor)
 *     → this.initializePromise = _initialize()
 *     → parseParametersFromURL(window.location.href)
 *     → _isImplicitGrantCallback(params)   // access_token | error | error_code
 *     → if (isBrowser() && detectSessionInUrl && type !== 'none')
 *          _getSessionFromURL(params)       // → GET /auth/v1/user  (Bearer <token>)
 *                                           // → persistSession ise localStorage'a yaz
 *
 * Yani URL'de `#access_token=...` varsa oturum, CLIENT YARATILIRKEN kurulur.
 * Hiçbir üretim fonksiyonu çağrılmaz; Wave 15 kapısı devreye girmez.
 *
 * ── ERİŞİLEBİLİRLİK (dürüstlük — abartma YOK) ─────────────────────────────
 * ÖLÇÜLDÜ: `RoleStore` YALNIZ head-unit paketindedir; ayrı tarayıcı paketi
 * `src/admin/**` onu HİÇ import etmez. Sevk edilen head-unit'te deep link
 * `appUrlOpen` ile gelir ve `window.location`u DEĞİŞTİRMEZ;
 * `capacitor.config.ts` içinde `server.url` / `allowNavigation` yoktur.
 * Bu nedenle sevkiyattaki WebView'de bu yolun saldırgan tarafından
 * sürülebildiği KANITLANMAMIŞTIR.
 *
 * Gerçek ve kanıtlanmış olan: bayrak, kurtarma için İKİNCİ bir oturum
 * otoritesi yaratır (§6 TEK OTORİTE ihlali) ve `window.location`un
 * etkilenebildiği HER bağlamda — `npm run dev` ile tarayıcıda koşan aynı
 * uygulama, `androidScheme: 'http'` ile dev WebView, ileride eklenecek bir
 * `allowNavigation`/web girişi — doğrudan oturum sabitlemesine dönüşür.
 * Sınıflandırma: DERİNLİK SAVUNMASI + LATENT İKİNCİ OTORİTE.
 * Sevk edilen cihazda aktif sömürülebilirlik İDDİA EDİLMEMEKTEDİR.
 *
 * ── KANIT SEVİYESİ ────────────────────────────────────────────────────────
 * DAVRANIŞSAL. Supabase SDK'sı TAKLİT EDİLMEZ — gerçek @supabase/supabase-js
 * kullanılır. Yalnızca ağ sınırı (`fetch`) gözlenir: URL'deki sentinel
 * token'ın gerçekten oturum kurma çağrısına taşınıp taşınmadığı ölçülür.
 * Gerçek hesap/kimlik bilgisi KULLANILMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Saldırganın ürettiği kimlik malzemesi (sentinel — gerçek token DEĞİL). */
const ATK_ACCESS  = 'W16ATTACKERACCESSTOKENSENTINEL';
const ATK_REFRESH = 'W16ATTACKERREFRESHTOKENSENTINEL';

/** RoleStore'un yapılandırma sabitleri; SDK taklit EDİLMEZ. */
vi.mock('../platform/supabaseClient', () => ({
  SUPABASE_URL:      'https://w16test.supabase.co',
  SUPABASE_ANON_KEY: 'w16-anon-key',
  getSupabaseClient: () => null,
}));

vi.mock('../platform/ai/gateway/aiGatewayAccessRuntime', () => ({
  refreshGatewayAccess: vi.fn(async () => undefined),
}));

/** Ağ sınırında gözlenen istekler. */
interface Seen { url: string; auth: string }
let seen: Seen[] = [];
let realFetch: typeof globalThis.fetch;

function installFetchProbe(): void {
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    const h = new Headers((init?.headers ?? {}) as HeadersInit);
    seen.push({ url, auth: h.get('Authorization') ?? '' });
    /* GoTrue `/user` BAŞARILI yanıtlamalı; aksi halde oturum hiç kurulmaz ve
       kalıcılık ölçümü (T5) yanlış sebeple yeşile döner — yani kör olur. */
    const body = url.includes('/auth/v1/user')
      ? { id: 'w16-user-id', aud: 'authenticated', role: 'authenticated',
          email: 'w16@test.local', app_metadata: {}, user_metadata: {} }
      : { ok: true };
    return new Response(JSON.stringify(body), {
      status:  200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
}

/** Sentinel token oturum kurma yoluna TAŞINDI mı? */
function sentinelLeaked(): Seen[] {
  return seen.filter((s) => s.url.includes(ATK_ACCESS) || s.auth.includes(ATK_ACCESS));
}

/** persistSession ile localStorage'a yazılan oturum. */
function sentinelPersisted(): string[] {
  const hits: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if ((localStorage.getItem(k) ?? '').includes(ATK_ACCESS)) hits.push(k);
  }
  return hits;
}

/** Adres çubuğunu saldırganın gönderdiği bağlantıya ayarlar. */
function setUrl(pathAndHash: string): void {
  window.history.replaceState({}, '', pathAndHash);
}

/** auth-js `_initialize()` constructor'dan async başlar; bitmesini bekle. */
async function settleInit(auth: unknown): Promise<void> {
  const p = (auth as { initializePromise?: Promise<unknown> }).initializePromise;
  if (p) { try { await p; } catch { /* ağ hatası beklenir */ } }
  for (let i = 0; i < 25; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
}

const FRAGMENT = `#access_token=${ATK_ACCESS}&refresh_token=${ATK_REFRESH}`
  + '&expires_in=3600&token_type=bearer&type=recovery';

beforeEach(() => {
  vi.resetModules();
  seen = [];
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* jsdom */ }
  installFetchProbe();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setUrl('/');
});

// ── T1 · URL PARÇASI DOĞRUDAN OTURUM KURAR ──────────────────────────────────

describe('W16/T1 · URL fragmenti oturum otoritesi OLAMAZ', () => {
  it('adres çubuğundaki access_token admin client yaratılırken tüketilmez', async () => {
    setUrl(`/admin.html${FRAGMENT}`);

    const { getAdminClient } = await import('../platform/roleSystem/RoleStore');
    const client = getAdminClient();
    expect(client, 'admin client kurulamadı — ölçüm kör olurdu').not.toBeNull();
    await settleInit(client!.auth);

    expect(
      sentinelLeaked(),
      'URL fragmentindeki saldırgan token oturum kurma çağrısına taşındı — '
      + 'Wave 15 kapısı devre dışı bırakıldı (ikinci oturum otoritesi)',
    ).toEqual([]);
  });
});

// ── T2 · WAVE 15 KAPISI ATLANIYOR MU ────────────────────────────────────────

describe('W16/T2 · tek oturum otoritesi handleRecoveryUrl kapısıdır', () => {
  it('handleRecoveryUrl HİÇ çağrılmadan oturum malzemesi tüketilmez', async () => {
    setUrl(`/admin.html${FRAGMENT}`);

    const mod = await import('../platform/roleSystem/RoleStore');
    const client = mod.getAdminClient();
    await settleInit(client!.auth);

    /* Yerel kurtarma denemesi AÇILMADI; hiçbir kapı fonksiyonu çağrılmadı. */
    expect(
      sentinelLeaked().length,
      'yerel deneme yokken ve handleRecoveryUrl çağrılmadan oturum kuruldu',
    ).toBe(0);
    expect(mod.useRoleStore.getState().adminAuthState).not.toBe('recovery');
  });
});

// ── T3 · ANA CLIENT: BELİRTİLMEMİŞ BAYRAK VARSAYILAN true ───────────────────

describe('W16/T3 · detectSessionInUrl açıkça kapatılmalı', () => {
  it('GEREKÇE: bayrak belirtilmezse SDK varsayılanı URL üzerinden oturum kurar', async () => {
    setUrl(`/${FRAGMENT}`);

    /* Bayrağı BELİRTMEYEN sözlük — `getSupabaseClient()` fix'ten önce aynen
       böyleydi. Bu ölçüm, açık `false` yazmanın neden zorunlu olduğunu
       kanıtlar: eksik bayrak = SDK varsayılanı = URL otoritesi. */
    const { createClient } = await import('@supabase/supabase-js');
    const c = createClient('https://w16test.supabase.co', 'w16-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await settleInit(c.auth);

    /* Bu halka BİLEREK sızıntı BEKLER: kanıtlanan şey, bayrağı yazmamanın
       güvenli OLMADIĞIdır. Aşağıdaki yapısal kilidin gerekçesi budur.
       Kırmızıya dönerse: SDK varsayılanı değişmiş demektir — o zaman bu
       dosyadaki gerekçe yeniden yazılmalı, kilit gevşetilmemelidir. */
    expect(
      sentinelLeaked().length,
      'SDK artık bayraksız da URL tokenını tüketmiyor — W16 gerekçesi değişti',
    ).toBeGreaterThan(0);
  });

  it('her iki üretim fabrikası da detectSessionInUrl: false belirtir', () => {
    const root = process.cwd();
    const roleStore  = readFileSync(resolve(root, 'src/platform/roleSystem/RoleStore.ts'), 'utf8');
    const supaClient = readFileSync(resolve(root, 'src/platform/supabaseClient.ts'), 'utf8');

    expect(
      roleStore.includes('detectSessionInUrl: false'),
      'admin client URL otomatik yakalamayı hâlâ açık bırakıyor',
    ).toBe(true);
    expect(
      supaClient.includes('detectSessionInUrl: false'),
      'ana client bayrağı belirtmiyor — SDK varsayılanı true devreye girer',
    ).toBe(true);
  });
});

// ── T4 · ÇIKIŞ SONRASI BAYAT URL İLE DİRİLİŞ ────────────────────────────────

describe('W16/T4 · çıkış sonrası bayat URL oturumu diriltemez', () => {
  it('signOut sonrası client yeniden yaratıldığında URL oturumu geri getirmez', async () => {
    const mod = await import('../platform/roleSystem/RoleStore');
    const first = mod.getAdminClient();
    await settleInit(first!.auth);
    await first!.auth.signOut().catch(() => undefined);

    /* Adres çubuğu hâlâ token taşıyor (kullanıcı sekmeyi kapatmadı, yeniledi). */
    setUrl(`/admin.html${FRAGMENT}`);
    seen = [];

    vi.resetModules();
    const mod2 = await import('../platform/roleSystem/RoleStore');
    const second = mod2.getAdminClient();
    await settleInit(second!.auth);

    expect(
      sentinelLeaked(),
      'çıkış yapıldıktan sonra yenileme bayat URL tokenı ile oturumu diriltti',
    ).toEqual([]);
  });
});

// ── T5 · KALICILIK: persistSession true ─────────────────────────────────────

describe('W16/T5 · URL tokenı kalıcı depoya yazılamaz', () => {
  it('admin client persistSession true — URL tokenı localStorage içine düşmez', async () => {
    setUrl(`/admin.html${FRAGMENT}`);

    const { getAdminClient } = await import('../platform/roleSystem/RoleStore');
    await settleInit(getAdminClient()!.auth);

    expect(
      sentinelPersisted(),
      'saldırgan tokenı kalıcı depoya yazıldı — sonraki her açılışta oturum '
      + 'saldırgan hesabına sabitlenir',
    ).toEqual([]);
  });
});

// ── T6 · YOLDAN BAĞIMSIZ ────────────────────────────────────────────────────

describe('W16/T6 · otomatik yakalama yoldan bağımsızdır', () => {
  it('ilgisiz bir yolda gelen auth fragmenti de tüketilmez', async () => {
    setUrl(`/some/unrelated/page${FRAGMENT}`);

    const { getAdminClient } = await import('../platform/roleSystem/RoleStore');
    await settleInit(getAdminClient()!.auth);

    expect(
      sentinelLeaked(),
      'auth fragmenti yola bakılmaksızın tüketiliyor — herhangi bir sayfa '
      + 'oturum kurma yüzeyi olur',
    ).toEqual([]);
  });
});

// ── MEŞRU AKIŞ · token_hash zaten otomatik yakalanmaz ───────────────────────

describe('W16 · meşru kurtarma yolu Wave 15 kapısında kalır', () => {
  it('token_hash taşıyan URL SDK tarafından otomatik tüketilmez', async () => {
    setUrl(`/admin.html?token_hash=${ATK_ACCESS}&type=recovery`);

    const { getAdminClient } = await import('../platform/roleSystem/RoleStore');
    await settleInit(getAdminClient()!.auth);

    expect(
      sentinelLeaked(),
      'token_hash otomatik tüketiliyor — bu yolun tek sahibi handleRecoveryUrl olmalı',
    ).toEqual([]);
  });
});
