/**
 * Spotify yapılandırması.
 *
 * Client ID gizli DEĞİLDİR ama BYOK olarak çözülür (bkz. mediaCredentials.ts:
 * getSpotifyClientId — kullanıcı ayarı > VITE env > yalnız DEV fallback). Gömülü
 * merkezi kimlik yok (CLAUDE.md ticari satış kuralı; Spotify dev-mode 25-kullanıcı
 * limiti). Client SECRET ASLA kullanılmaz: client-side akış PKCE'dir, secret gerektirmez.
 *
 * Redirect URI'ler Spotify Developer Dashboard'a eklenmelidir:
 *   - http://127.0.0.1:5173/callback   (tarayıcı / dev)
 *   - com.cockpitos.pro://callback     (APK / cihaz)
 *
 * NOT: Spotify (2025 politikası) loopback redirect'lerde "localhost" kabul ETMEZ;
 * açıkça 127.0.0.1 IP literal'i gerekir. Dev test ederken uygulamayı
 * http://127.0.0.1:5173 üzerinden aç (localhost değil), yoksa redirect reddedilir.
 *
 * Web redirect'i çalışılan KÖKENDEN türetilir: OAuth dönüşü daima aynı köken
 * üzerinde tamamlanır, böylece token localStorage'ı localhost↔127.0.0.1 gibi
 * farklı köken arasında bölünmez (aksi halde "bağlandı ama hâlâ Bağlan diyor").
 */
import { isNative } from '../bridge';

const WEB_ORIGIN =
  typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173';

export const SPOTIFY_REDIRECT_URI = isNative
  ? 'com.cockpitos.pro://callback'
  : `${WEB_ORIGIN}/callback`;

/**
 * İstenen yetkiler:
 *  - arama için özel scope gerekmez (geçerli kullanıcı token'ı yeter)
 *  - user-modify/read-playback-state → Connect API ile arka planda çalma/transfer
 *  - user-read-private → hesap Premium mı tespiti
 */
export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');
