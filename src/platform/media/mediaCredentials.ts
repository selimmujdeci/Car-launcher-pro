/**
 * mediaCredentials — 3. taraf müzik sağlayıcı client_id çözümü (BYOK).
 *
 * Ticari satış kuralı (CLAUDE.md): uygulamaya merkezi/gömülü kimlik konmaz —
 * tüm satılan cihazların tek client_id paylaşması rate-limit/ToS/quota riski
 * yaratır (Spotify dev-mode 25-kullanıcı limiti dahil). Çözüm sıralı öncelik:
 *
 *   1. Kullanıcı ayarı (BYOK)         — runtime override, en yüksek öncelik
 *   2. Build-time env (VITE_*)        — üretici kendi dağıtım build'inde koyar
 *   3. Dev fallback (yalnız DEV)      — geliştirme kolaylığı; production'da YOK
 *
 * Hepsi boşsa getter '' döner → sağlayıcı sessizce devre dışı kalır (fail-soft).
 * client_id gizli değildir (istemcide açıkça görünür); hassas depo gerekmez.
 */

const JAMENDO_KEY = 'media-jamendo-client-id';
const SPOTIFY_KEY = 'media-spotify-client-id';

// Yalnız geliştirme ortamında kullanılan gömülü fallback'ler — production build'de devre dışı.
const DEV_JAMENDO_CLIENT_ID = '65c9241f';
const DEV_SPOTIFY_CLIENT_ID = '7ebfa30f6a924d159a460ee1e6b364ba';

function _userOverride(key: string): string {
  try {
    return (localStorage.getItem(key) ?? '').trim();
  } catch {
    return '';
  }
}

function _envValue(name: 'VITE_JAMENDO_CLIENT_ID' | 'VITE_SPOTIFY_CLIENT_ID'): string {
  const v = import.meta.env[name] as string | undefined;
  return typeof v === 'string' ? v.trim() : '';
}

export function getJamendoClientId(): string {
  return _userOverride(JAMENDO_KEY)
      || _envValue('VITE_JAMENDO_CLIENT_ID')
      || (import.meta.env.DEV ? DEV_JAMENDO_CLIENT_ID : '');
}

export function getSpotifyClientId(): string {
  return _userOverride(SPOTIFY_KEY)
      || _envValue('VITE_SPOTIFY_CLIENT_ID')
      || (import.meta.env.DEV ? DEV_SPOTIFY_CLIENT_ID : '');
}

/** BYOK: kullanıcının girdiği client_id'yi sakla (boş → temizle, dev/env fallback'e döner). */
export function setMediaClientId(provider: 'jamendo' | 'spotify', id: string): void {
  const key = provider === 'jamendo' ? JAMENDO_KEY : SPOTIFY_KEY;
  try {
    const trimmed = id.trim();
    if (trimmed) localStorage.setItem(key, trimmed);
    else localStorage.removeItem(key);
  } catch {
    /* quota — yoksay */
  }
}
