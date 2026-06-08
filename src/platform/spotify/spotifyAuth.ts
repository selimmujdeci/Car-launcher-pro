/**
 * Spotify OAuth — Authorization Code with PKCE (client-side, secret'siz).
 *
 * Akış:
 *   beginSpotifyLogin() → Spotify login sayfasına yönlendirir
 *   (kullanıcı onaylar) → redirect_uri?code=... ile geri döner
 *   captureSpotifyRedirect() → kodu token ile değişir (main.tsx boot'ta çağrılır)
 *   getValidAccessToken() → geçerli access token döner (süresi dolduysa yeniler)
 *
 * Token'lar localStorage'da tutulur. Refresh token ile sessiz yenileme yapılır.
 */
import { SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES } from './spotifyConfig';
import { getSpotifyClientId } from '../media/mediaCredentials';

const LS = {
  access:   'spotify_access_token',
  refresh:  'spotify_refresh_token',
  expires:  'spotify_token_expires',
  verifier: 'spotify_pkce_verifier',
  state:    'spotify_oauth_state',
} as const;

const AUTH_URL  = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/* ── PKCE yardımcıları ───────────────────────────────────── */

function randomString(len = 64): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ('0' + b.toString(16)).slice(-2)).join('').slice(0, len);
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

/* ── Token saklama ───────────────────────────────────────── */

interface TokenResponse {
  access_token:  string;
  token_type:    string;
  expires_in:    number;
  refresh_token?: string;
}

function storeTokens(t: TokenResponse): void {
  localStorage.setItem(LS.access, t.access_token);
  localStorage.setItem(LS.expires, String(Date.now() + t.expires_in * 1000));
  if (t.refresh_token) localStorage.setItem(LS.refresh, t.refresh_token);
}

/* ── Public API ──────────────────────────────────────────── */

/** Login akışını başlatır — sayfayı Spotify'a yönlendirir. */
export async function beginSpotifyLogin(): Promise<void> {
  const clientId = getSpotifyClientId();
  if (!clientId) {
    // BYOK: client_id yok → giriş başlatma anlamsız (fail-soft).
    console.warn('[Spotify] client_id tanımlı değil — BYOK (ayar/VITE env) gerekli.');
    return;
  }

  const verifier  = randomString(64);
  const challenge = await pkceChallenge(verifier);
  const state     = randomString(16);
  localStorage.setItem(LS.verifier, verifier);
  localStorage.setItem(LS.state, state);

  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          SPOTIFY_REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
    state,
    scope:                 SPOTIFY_SCOPES,
  });
  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

/**
 * Boot sırasında çağrılır. URL'de ?code= varsa token ile değişir ve URL'yi temizler.
 * Kod yoksa sessizce çıkar.
 */
export async function captureSpotifyRedirect(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const url   = new URL(window.location.href);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return false;

  const clean = () => { try { window.history.replaceState({}, '', '/'); } catch { /* ignore */ } };
  const savedState = localStorage.getItem(LS.state);
  const verifier   = localStorage.getItem(LS.verifier);

  if (!verifier || !state || state !== savedState) { clean(); return false; }

  let ok = false;
  try {
    const body = new URLSearchParams({
      client_id:     getSpotifyClientId(),
      grant_type:    'authorization_code',
      code,
      redirect_uri:  SPOTIFY_REDIRECT_URI,
      code_verifier: verifier,
    });
    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.ok) { storeTokens(await res.json()); ok = true; }
  } catch { /* network error */ }

  localStorage.removeItem(LS.verifier);
  localStorage.removeItem(LS.state);
  clean();
  return ok;
}

/** Refresh token ile access token'ı yeniler. */
async function refreshAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem(LS.refresh);
  if (!refresh) return null;
  try {
    const body = new URLSearchParams({
      client_id:     getSpotifyClientId(),
      grant_type:    'refresh_token',
      refresh_token: refresh,
    });
    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    storeTokens(await res.json());
    return localStorage.getItem(LS.access);
  } catch {
    return null;
  }
}

/** Geçerli (gerekirse yenilenmiş) access token döner; yoksa null. */
export async function getValidAccessToken(): Promise<string | null> {
  const access  = localStorage.getItem(LS.access);
  const expires = Number(localStorage.getItem(LS.expires) || 0);
  if (access && Date.now() < expires - 60_000) return access;
  return refreshAccessToken();
}

export function isSpotifyConnected(): boolean {
  return !!localStorage.getItem(LS.refresh) || !!localStorage.getItem(LS.access);
}

export function disconnectSpotify(): void {
  Object.values(LS).forEach((k) => localStorage.removeItem(k));
}
