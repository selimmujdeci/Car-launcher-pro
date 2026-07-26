/**
 * Audius sağlayıcısı — açık API, kimlik gerektirmez, tam parça yasal stream.
 *
 * 1. Discovery host'u https://api.audius.co'dan alınır (round-robin liste).
 * 2. Arama: {host}/v1/tracks/search?query=...&app_name=CarosPro
 * 3. Stream: {host}/v1/tracks/{id}/stream?app_name=CarosPro  (audio src olarak doğrudan kullanılır)
 */
import type { MediaProvider, UnifiedTrack } from './providers';
import { timeoutSignal } from './providers';

const APP_NAME = 'CarosPro';

/* ── Harici yanıt sözleşmesi (GÜVENİLMEZ — her alan opsiyonel) ─────────────
   Şemasız üçüncü taraf JSON'u; alan eksik ya da farklı tipte gelebilir. Bu
   arayüz API'nin ne döndürdüğünü BELGELER, garanti etmez — erişimler bu
   yüzden opsiyonel zincir + varsayılanla korunur. */
interface AudiusTrack {
  id?:      string;
  title?:   string;
  user?:    { name?: string };
  /** Anahtarlar boyut etiketidir: '150x150' · '480x480' · '1000x1000'. */
  artwork?: Record<string, string | undefined>;
}

let _host = '';
let _hostAt = 0;
const HOST_TTL = 10 * 60_000;

async function getHost(): Promise<string> {
  if (_host && Date.now() - _hostAt < HOST_TTL) return _host;
  const res = await fetch('https://api.audius.co', { signal: timeoutSignal(4000) });
  const json = await res.json();
  const hosts: string[] = json?.data ?? [];
  if (hosts.length === 0) throw new Error('Audius host yok');
  _host = hosts[Math.floor(Math.random() * hosts.length)];
  _hostAt = Date.now();
  return _host;
}

export const audiusProvider: MediaProvider = {
  id: 'audius',
  async search(query, signal) {
    const q = query.trim();
    if (!q) return [];
    try {
      const host = await getHost();
      const url  = `${host}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP_NAME}`;
      const res  = await fetch(url, { signal });
      if (!res.ok) return [];
      const json  = await res.json();
      const items = (json?.data ?? []) as AudiusTrack[];
      return items.slice(0, 20).map((t): UnifiedTrack => ({
        id:         `audius-${t.id}`,
        providerId: 'audius',
        title:      t.title ?? 'Parça',
        subtitle:   t.user?.name ?? 'Audius',
        artwork:    t.artwork?.['480x480'] ?? t.artwork?.['150x150'],
        streamUrl:  `${host}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}`,
      }));
    } catch {
      return [];
    }
  },
};
