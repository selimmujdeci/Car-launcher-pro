/**
 * keyBeamService.ts — "QR Key Beam" oturum yönetimi (araç tarafı).
 *
 * vehicleIdentityService.ts'deki RPC fetch deseniyle aynı yaklaşım: hafif,
 * supabase-js istemcisine bağımlı değil, doğrudan REST RPC.
 *
 * Anahtar (CryptoKey) SADECE bu modülün çağıranındaki RAM'de tutulur — hiçbir
 * safeStorage/sensitiveKeyStore yazımı yapılmaz. Oturum kapanınca (unmount,
 * başarı, süre dolumu) referans GC'ye bırakılır.
 *
 * When VITE_SUPABASE_URL is not set → demo mod, poll her zaman 'pending' döner
 * (araç arayüzü "süresi doldu" ile sonlanır — sahte başarı asla üretilmez).
 */

import {
  generateBeamCode,
  generateBeamKey,
  decryptBeamPayload,
  API_KEY_BEAM_REGEX,
  KEY_BEAM_TTL_MS,
} from './keyBeamCrypto';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const RPC_BASE          = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/rpc` : null;

/**
 * Köprü sayfa URL'si. Prod build'de .env'e VITE_KEY_BEAM_URL girilmezse
 * carospro.com/key-beam kullanılır (website/ aynı Supabase projesine bağlı).
 */
const KEY_BEAM_BASE_URL =
  (import.meta.env.VITE_KEY_BEAM_URL as string | undefined) || 'https://carospro.com/key-beam';

async function _rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) throw new Error('Supabase not configured');
  const res = await fetch(`${RPC_BASE}/${fn}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `RPC ${fn} failed`);
  return data;
}

/* ── Types ──────────────────────────────────────────────────── */

export interface BeamSession {
  code:       string;
  qrUrl:      string;
  expiresAt:  number; // epoch ms
  /** RAM-only — asla persist edilmez, asla loglanmaz. */
  cryptoKey:  CryptoKey;
}

export type BeamPollResult =
  | { status: 'pending' }
  | { status: 'found'; apiKey: string }
  | { status: 'invalid' }
  | { status: 'error' };

/* ── Public API ─────────────────────────────────────────────── */

/** QR beam ile getirilebilen anahtar tipleri — telefon sayfası buna göre
 *  doğru talimatı/link'i gösterir (gemini→aistudio, tavily→app.tavily.com…). */
export type KeyBeamKind = 'gemini' | 'groq' | 'haiku' | 'tavily';

/** Yeni bir kod + tek kullanımlık anahtar üretir. Ağ çağrısı yapmaz (kod yalnızca üretildikten sonra Supabase'e telefon tarafından yazılır).
 *  @param kind Hangi sağlayıcı için (telefon sayfası buna göre "Gemini/Tavily… anahtarını yapıştır" gösterir). Verilmezse eski jenerik davranış. */
export async function createBeamSession(kind?: KeyBeamKind): Promise<BeamSession> {
  const code = generateBeamCode();
  const { cryptoKey, keyB64url } = await generateBeamKey();
  const expiresAt = Date.now() + KEY_BEAM_TTL_MS;
  // exp parametresi URL'de YOK: TTL sunucuda (key_beams.expires_at) ve araçtaki
  // sayaçta zaten uygulanıyor; URL kısaldıkça QR seyrekleşir → araç ekranından
  // telefonla okunabilirlik artar (SAHA 2026-07-03: yoğun QR okunmuyordu).
  // kind: telefon sayfasının doğru sağlayıcı talimatını göstermesi için (kısa).
  const kindParam = kind ? `&kind=${kind}` : '';
  const qrUrl = `${KEY_BEAM_BASE_URL}?code=${code}${kindParam}#k=${keyB64url}`;
  return { code, qrUrl, expiresAt, cryptoKey };
}

/**
 * consume_key_beam RPC'sini bir kez çağırır. Bulunduysa satır sunucuda SİLİNİR
 * (tek kullanımlık garanti) ve ciphertext RAM'deki anahtarla çözülür.
 */
export async function pollBeamOnce(
  session: Pick<BeamSession, 'code' | 'cryptoKey'>,
): Promise<BeamPollResult> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return { status: 'pending' };

  try {
    const data = await _rpc('consume_key_beam', { p_code: session.code }) as {
      found?:      boolean;
      ciphertext?: string;
      iv?:         string;
    };

    if (!data?.found || !data.ciphertext || !data.iv) return { status: 'pending' };

    try {
      const apiKey = await decryptBeamPayload(data.ciphertext, data.iv, session.cryptoKey);
      if (!API_KEY_BEAM_REGEX.test(apiKey)) return { status: 'invalid' };
      return { status: 'found', apiKey };
    } catch {
      return { status: 'invalid' };
    }
  } catch {
    return { status: 'error' };
  }
}
