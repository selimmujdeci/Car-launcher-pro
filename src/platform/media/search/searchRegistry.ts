/**
 * searchRegistry.ts — F5.1 · Üretim kaynak portlarının TEK kayıt noktası.
 *
 * Sağlayıcı modülleri DİNAMİK yüklenir: arama yüzeyi açılmadan ağ sağlayıcı
 * zinciri ana pakete girmesin (düşük-uç bütçesi — F0/F3'teki desenle aynı).
 *
 * PAZARLIKSIZ:
 *   · Yeni sağlayıcı YAZILMAZ; var olanlar sarmalanır.
 *   · Yetenek UYDURULMAZ — uygunluk `sourceCapabilities.supportsSearch` ile,
 *     kullanılabilirlik GÖZLEMLE (oturum/bayrak) belirlenir.
 *   · Ürün politikası DEĞİŞTİRİLMEZ: `WORLDWIDE_SOURCES_ENABLED` kapalıysa
 *     global kataloglar kaydedilmez — ölü/bayrak-kapalı sağlayıcı aktive edilmez.
 *   · Kayıtlı ama kullanılamayan sağlayıcıya sorgu GİTMEZ (koordinatör kapısı).
 */
import { configureSearchSources, type SearchSourcePort } from './musicSearchCoordinator';
import {
  createLocalSearchPort, createProviderSearchPort, createSpotifySearchPort,
} from './searchSources';
import { noteRegistry } from './searchTelemetry';

let configured = false;

/** Ağ sağlayıcısı üst süresi — mevcut katmandaki 8 sn sözleşmesiyle aynı. */
const PROVIDER_TIMEOUT_MS = 8000;

/** Hangi sağlayıcılar kayda GİRDİ ve neden — LAB teşhisi (salt okuma). */
export interface RegistryReport {
  readonly registered: readonly string[];
  /** Kayda ALINMAYANLAR ve gerekçeleri (bayrak kapalı, modül yüklenemedi …). */
  readonly excluded: readonly { readonly providerId: string; readonly reason: string }[];
}

let report: RegistryReport = Object.freeze({
  registered: Object.freeze([]), excluded: Object.freeze([]),
});

export function getSearchRegistryReport(): RegistryReport { return report; }

/**
 * Arama kaynaklarını bir kez kurar. Çift çağrı güvenlidir.
 *
 * Yerel kaynak SENKRON kurulur (kullanıcı ilk harfte sonuç görsün); ağ
 * sağlayıcıları yüklendikçe eklenir.
 */
export async function ensureSearchSourcesConfigured(): Promise<void> {
  if (configured) return;
  configured = true;

  const ports: SearchSourcePort[] = [createLocalSearchPort()];
  const excluded: { providerId: string; reason: string }[] = [];
  configureSearchSources(ports);

  /* ── Türkiye odaklı çekirdek sağlayıcılar ────────────────────────────── */
  try {
    const { pipedProvider } = await import('../pipedProvider');
    ports.push(createProviderSearchPort(pipedProvider, { timeoutMs: PROVIDER_TIMEOUT_MS }));
  } catch { excluded.push({ providerId: 'youtube', reason: 'module_unavailable' }); }

  try {
    const { radioBrowserProvider } = await import('../radioBrowserProvider');
    ports.push(createProviderSearchPort(radioBrowserProvider, { timeoutMs: PROVIDER_TIMEOUT_MS }));
  } catch { excluded.push({ providerId: 'radio', reason: 'module_unavailable' }); }

  /* ── Spotify: oturum GÖZLENİR, varsayılmaz ───────────────────────────── */
  try {
    const [{ isSpotifyConnected }, { searchSpotifyTracks }] = await Promise.all([
      import('../../spotify/spotifyAuth'),
      import('../../spotify/spotifyService'),
    ]);
    ports.push(createSpotifySearchPort({
      isConnected: isSpotifyConnected,
      search: (query, limit) => searchSpotifyTracks(query, limit),
      timeoutMs: PROVIDER_TIMEOUT_MS,
    }));
  } catch { excluded.push({ providerId: 'spotify', reason: 'module_unavailable' }); }

  /* ── Global kataloglar: YALNIZ ürün politikası açıksa ────────────────── */
  let worldwideEnabled = false;
  try {
    ({ WORLDWIDE_SOURCES_ENABLED: worldwideEnabled } = await import('../carosMediaLayer'));
  } catch { worldwideEnabled = false; }

  if (worldwideEnabled) {
    const globals: readonly [string, () => Promise<{ default?: unknown } & Record<string, unknown>>][] = [
      ['audius', () => import('../audiusProvider')],
      ['jamendo', () => import('../jamendoProvider')],
      ['archive', () => import('../archiveProvider')],
    ];
    for (const [id, load] of globals) {
      try {
        const mod = await load();
        const provider = (mod[`${id}Provider`] ?? null) as Parameters<typeof createProviderSearchPort>[0] | null;
        if (provider) ports.push(createProviderSearchPort(provider, { timeoutMs: PROVIDER_TIMEOUT_MS }));
        else excluded.push({ providerId: id, reason: 'export_missing' });
      } catch { excluded.push({ providerId: id, reason: 'module_unavailable' }); }
    }
  } else {
    // Ürün politikası: Türkiye odağında global kataloglar KAPALI. Bayrağı bu
    // katman DEĞİŞTİRMEZ; yalnız gerekçeyi görünür kılar.
    ['audius', 'jamendo', 'archive'].forEach((id) => {
      excluded.push({ providerId: id, reason: 'policy_worldwide_disabled' });
    });
  }

  configureSearchSources(ports);
  report = Object.freeze({
    registered: Object.freeze(ports.map((p) => p.providerId)),
    excluded: Object.freeze(excluded.map((e) => Object.freeze(e))),
  });
  noteRegistry(report.registered.length, report.excluded.length);
}

export function _resetSearchRegistryForTest(): void {
  configured = false;
  report = Object.freeze({ registered: Object.freeze([]), excluded: Object.freeze([]) });
}
