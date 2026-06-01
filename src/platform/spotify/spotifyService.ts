/**
 * Spotify Web API servisi — catalog araması + Connect API ile arka planda çalma.
 *
 * Çalma native SDK GEREKTİRMEZ: `PUT /v1/me/player/play` aktif bir Spotify
 * cihazında (arka planda çalışan Spotify uygulaması) seçilen parçayı başlatır.
 * Spotify uygulaması ön plana GELMEZ. Gereksinim: Premium + aktif/erişilebilir cihaz.
 */
import { getValidAccessToken } from './spotifyAuth';
import { updateMediaState } from '../mediaService';
import { showToast } from '../errorBus';

const API = 'https://api.spotify.com/v1';

export interface SpotifyTrack {
  id:       string;
  uri:      string;
  title:    string;
  artist:   string;
  albumArt?: string;
  durationMs: number;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

/** Catalog'da parça arar. Bağlı değilse boş döner. */
export async function searchSpotifyTracks(query: string, limit = 20): Promise<SpotifyTrack[]> {
  const q = query.trim();
  if (!q) return [];
  const headers = await authHeaders();
  if (!headers) return [];
  try {
    // market=TR: sonuçları Türkiye kataloğuna/erişilebilirliğine göre döndürür →
    // Türkçe içerik öne çıkar, ülkede çalınamayan parçalar elenir.
    const params = new URLSearchParams({ q, type: 'track', limit: String(limit), market: 'TR' });
    const res = await fetch(`${API}/search?${params.toString()}`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data?.tracks?.items ?? []) as any[];
    return items.map((t) => ({
      id:         t.id,
      uri:        t.uri,
      title:      t.name,
      artist:     (t.artists ?? []).map((a: any) => a.name).join(', '),
      albumArt:   t.album?.images?.[0]?.url,
      durationMs: t.duration_ms ?? 0,
    }));
  } catch {
    return [];
  }
}

/** Çalan parçada belirtilen konuma atlar (Connect API). Premium + aktif cihaz gerekir. */
export async function seekSpotify(positionMs: number): Promise<void> {
  const headers = await authHeaders();
  if (!headers) return;
  try {
    await fetch(`${API}/me/player/seek?position_ms=${Math.round(positionMs)}`, { method: 'PUT', headers });
  } catch { /* ignore */ }
}

/** Hesabın Premium olup olmadığını döner (null = bilinmiyor / bağlı değil). */
export async function isSpotifyPremium(): Promise<boolean | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API}/me`, { headers });
    if (!res.ok) return null;
    const me = await res.json();
    return me?.product === 'premium';
  } catch {
    return null;
  }
}

/**
 * Seçilen parçayı arka planda çalmaya başlar (Connect API).
 * Aktif cihaz yoksa erişilebilir ilk cihaza transfer eder.
 * Spotify uygulaması ön plana getirilmez.
 */
export async function playSpotifyTrack(track: SpotifyTrack): Promise<void> {
  const headers = await authHeaders();
  if (!headers) {
    showToast({ type: 'info', title: 'Spotify', message: 'Önce Spotify\'a bağlan', duration: 3000 });
    return;
  }

  // Now-playing kartını hemen göster (kullanıcı geri bildirimi)
  updateMediaState({
    playing:       true,
    hasSession:    true,
    source:        'spotify',
    activePackage: 'com.spotify.music',
    activeAppName: 'Spotify',
    track: {
      title:       track.title,
      artist:      track.artist,
      albumArt:    track.albumArt,
      durationSec: track.durationMs / 1000,
      positionSec: 0,
    },
  });

  const playBody = JSON.stringify({ uris: [track.uri] });

  try {
    let res = await fetch(`${API}/me/player/play`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: playBody,
    });

    // 404 = aktif cihaz yok → erişilebilir cihazı bul ve oraya çal
    if (res.status === 404) {
      const dvRes = await fetch(`${API}/me/player/devices`, { headers });
      const dv = dvRes.ok ? await dvRes.json() : { devices: [] };
      const deviceId = (dv.devices ?? [])[0]?.id;
      if (!deviceId) {
        showToast({ type: 'info', title: 'Spotify', message: 'Aktif Spotify cihazı yok — Spotify uygulamasını bir kez açın', duration: 4000 });
        updateMediaState({ playing: false });
        return;
      }
      res = await fetch(`${API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: playBody,
      });
    }

    if (res.status === 403) {
      showToast({ type: 'info', title: 'Spotify', message: 'Bu özellik Spotify Premium gerektirir', duration: 4000 });
      updateMediaState({ playing: false });
      return;
    }
    if (!res.ok && res.status !== 204) {
      updateMediaState({ playing: false });
    }
  } catch {
    updateMediaState({ playing: false });
  }
}
