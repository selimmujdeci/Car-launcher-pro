/**
 * UnifiedSearchView.tsx — F5 · Birleşik arama yüzeyi (SALT PROJEKSİYON).
 *
 * SINIRLAR:
 *   · Sağlayıcıyı DOĞRUDAN çağırmaz; her sorgu `musicSearchCoordinator`'dan geçer.
 *   · Native köprüyü çağırmaz, kütüphane/kuyruk gerçeği tutmaz.
 *   · Sonuç seçimi kanonik yoldan gider (`searchSelection` → F3 → F0).
 *
 * UX: kullanıcı "önce kaynak seç, sonra ara" modeline zorlanmaz. Kaynak teknik
 * bir detaydır; sonucun yanında küçük bir köken rozeti olarak görünür.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Music2, Search, X } from 'lucide-react';

import {
  getSearchSnapshot, runSearch, cancelSearch, subscribeSearch,
  type SearchSnapshot, type SearchState,
} from '../../platform/media/search/musicSearchCoordinator';
import { ensureSearchSourcesConfigured } from '../../platform/media/search/searchRegistry';
import { selectSearchResult } from '../../platform/media/search/searchSelection';
import {
  clearRecentSearches, getRecentSearches, rememberSearch, type RecentSearch,
} from '../../platform/media/search/recentSearches';
import type { SearchResult } from '../../platform/media/search/searchResult';
import { SEARCH_KIND_LABEL } from '../../platform/media/search/searchResult';
import type { UnifiedTrack } from '../../platform/media/providers';
import type { DrivingMode } from './nowPlayingModel';
import { MusicDiscoverySurface } from './MusicDiscoverySurface';

/** Sürüşte listede gösterilen üst sınır — derin gezinti kısıtlanır. */
const DRIVING_RESULT_LIMIT = 12;
const RESULT_LIMIT = 60;
/** Yazarken sorgu gönderme gecikmesi — her tuşta ağ isteği gitmez. */
const DEBOUNCE_MS = 220;

interface Props {
  /** Sağlayıcı sonucu seçilince kanonik medya katmanına devir (mevcut yol). */
  readonly onPlayProviderResult: (track: UnifiedTrack, queue: UnifiedTrack[]) => void;
  readonly drivingMode: DrivingMode;
  /** "Kaldığın yerden devam" — kanonik devam yolu ÇAĞIRANDA kalır. */
  readonly onResume: () => void;
  /** Yerel bir seçim çalmaya başladı (çağıran Now Playing'e geçebilir). */
  readonly onStarted?: () => void;
}

/** Kaynak kökeni — teknik ad değil, kullanıcının tanıdığı sade etiket. */
const ORIGIN_LABEL: Readonly<Record<string, string>> = {
  local: 'Cihaz', youtube: 'YouTube', spotify: 'Spotify',
  radio: 'Radyo', stream: 'Akış', audius: 'Audius',
  jamendo: 'Jamendo', archive: 'Arşiv',
};

/** Durumun kullanıcı dilindeki karşılığı — teknik durum adı gösterilmez. */
function stateLabel(state: SearchState, resultCount: number): string | null {
  if (state === 'SEARCHING') return 'Aranıyor…';
  if (state === 'PARTIAL') return resultCount > 0 ? 'Aranmaya devam ediliyor…' : 'Aranıyor…';
  if (state === 'DEGRADED' && resultCount > 0) return 'Bazı kaynaklara ulaşılamadı';
  return null;
}

/** Boş sonucun GERÇEK nedeni — hepsi "sonuç bulunamadı" değildir. */
function emptyMessage(snapshot: SearchSnapshot): string | null {
  if (snapshot.results.length > 0) return null;
  if (snapshot.state === 'SEARCHING' || snapshot.state === 'PARTIAL') return null;
  switch (snapshot.emptyReason) {
    case 'NO_QUERY':                 return null;
    case 'NO_RESULTS':               return 'Aradığın müzik bulunamadı.';
    case 'NO_ELIGIBLE_SOURCE':       return 'Şu an aranabilecek bir müzik kaynağı yok.';
    case 'ALL_SOURCES_UNAVAILABLE':  return 'Müzik kaynaklarına şu an ulaşılamıyor.';
    case 'ALL_SOURCES_FAILED':       return 'Arama tamamlanamadı. Bağlantını kontrol edip tekrar dene.';
    default:                         return null;
  }
}

export function UnifiedSearchView({
  onPlayProviderResult, drivingMode, onResume, onStarted,
}: Props) {
  const [text, setText] = useState('');
  const [recent, setRecent] = useState<readonly RecentSearch[]>(() => getRecentSearches());
  const snapshot = useSyncExternalStore(subscribeSearch, getSearchSnapshot, getSearchSnapshot);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void ensureSearchSourcesConfigured();
    // Zero-leak: yüzey kapanınca uçuşan arama iptal edilir.
    return () => { cancelSearch(); };
  }, []);

  /* Debounce + iptal: eski sorgu yenisini EZEMEZ. Bayatlık kapısı asıl olarak
     koordinatördeki kuşak sayacındadır; buradaki zamanlayıcı yalnız gereksiz
     ağ isteğini önler. */
  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) { cancelSearch(); return; }
    const timer = setTimeout(() => { void runSearch(trimmed); }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const limit = drivingMode === 'driving' ? DRIVING_RESULT_LIMIT : RESULT_LIMIT;
  const shown = useMemo(() => snapshot.results.slice(0, limit), [snapshot.results, limit]);

  const handleSelect = useCallback(async (result: SearchResult) => {
    setRecent(rememberSearch(text));
    const outcome = await selectSearchResult(result, snapshot.results);
    if (outcome.outcome === 'STARTED') { onStarted?.(); return; }
    if (outcome.outcome !== 'PROVIDER_PATH') return;
    /* Sağlayıcı sonucu: kanonik medya katmanına devredilir. UI sağlayıcıya
       DOĞRUDAN komut göndermez — devir çağıranın verdiği kapı üzerinden olur. */
    const toUnified = (r: SearchResult): UnifiedTrack => ({
      id: r.identity.providerId ?? r.resultId,
      providerId: r.provenance.providerId,
      title: r.title,
      subtitle: r.artist ?? '',
      artwork: r.artworkIdentity ?? undefined,
      ...(r.identity.contentUri?.startsWith('spotify:')
        ? { spotifyUri: r.identity.contentUri }
        : r.identity.contentUri
          ? { streamUrl: r.identity.contentUri }
          : {}),
    });
    const queue = snapshot.results
      .filter((r) => r.provenance.origin === 'PROVIDER')
      .map(toUnified);
    onPlayProviderResult(toUnified(result), queue);
    onStarted?.();
  }, [text, snapshot.results, onPlayProviderResult, onStarted]);

  const status = stateLabel(snapshot.state, snapshot.results.length);
  const empty = emptyMessage(snapshot);
  const idle = text.trim().length === 0;
  const showRecent = idle && recent.length > 0;
  const showDiscovery = idle;

  return (
    <div data-music-surface="search" className="h-full flex flex-col overflow-hidden px-5 pt-5">
      {/* Arama alanı — tek yüzey, kaynak sekmesi zorunlu değil. */}
      <div className="flex items-center gap-3 px-4 rounded-2xl glass-card flex-shrink-0"
        style={{ minHeight: 64 }}>
        <Search aria-hidden className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--oem-ink-3)' }} />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Şarkı, sanatçı veya albüm ara…"
          aria-label="Müzik ara"
          className="flex-1 bg-transparent text-base outline-none"
          style={{ color: 'var(--oem-ink)', minHeight: 48 }}
        />
        {text && (
          <button
            type="button"
            onClick={() => { setText(''); cancelSearch(); }}
            aria-label="Aramayı temizle"
            className="flex items-center justify-center rounded-full border-0 bg-transparent"
            style={{ width: 48, height: 48, color: 'var(--oem-ink-3)' }}
          >
            <X aria-hidden className="w-5 h-5" />
          </button>
        )}
      </div>

      {status && (
        <p data-search-status="true" className="flex-shrink-0 px-1 pt-3 text-xs"
          style={{ color: 'var(--oem-ink-2)' }}>
          {status}
        </p>
      )}

      {showRecent && (
        <div className="flex-shrink-0 pt-4">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.25em]"
              style={{ color: 'var(--oem-ink-3)' }}>Son aramalar</span>
            <button
              type="button"
              onClick={() => { clearRecentSearches(); setRecent([]); }}
              aria-label="Son aramaları temizle"
              className="rounded-full border-0 bg-transparent px-3 text-xs"
              style={{ minHeight: 44, color: 'var(--oem-ink-2)' }}
            >
              Temizle
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setText(r.text)}
                className="rounded-full border px-4 text-sm"
                style={{
                  minHeight: 48, color: 'var(--oem-ink)',
                  borderColor: 'var(--oem-line, rgba(255,255,255,.14))',
                }}
              >
                {r.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {empty && (
        <p data-search-empty="true" className="flex flex-1 items-center justify-center px-6 text-center text-sm"
          style={{ color: 'var(--oem-ink-2)' }}>
          {empty}
        </p>
      )}

      {/* Tek yüzey hissi: sorgu boşken KEŞİF, yazmaya başlayınca SONUÇLAR.
          Arama koordinatörü keşif otoritesi DEĞİLDİR — iki projeksiyon yan
          yana yaşar, birbirinin durumunu yazmaz. Alan temizlenince keşif geri
          gelir (arama iptal edilir, durum sıfırlanır). */}
      {showDiscovery && (
        <MusicDiscoverySurface
          drivingMode={drivingMode}
          onResume={onResume}
          onStarted={onStarted}
          onPlayProviderResult={onPlayProviderResult}
        />
      )}

      {shown.length > 0 && (
        <ul className="flex-1 overflow-y-auto scrollbar-none pt-3 pb-3"
          style={{ overscrollBehavior: 'contain' }}>
          {shown.map((r) => (
            <li key={r.resultId} data-search-result={r.resultId}>
              <button
                type="button"
                onClick={() => { void handleSelect(r); }}
                aria-label={`${r.title}${r.artist ? ` — ${r.artist}` : ''} · ${ORIGIN_LABEL[r.provenance.providerId] ?? r.provenance.providerId}`}
                className="flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-2 text-left"
                style={{ minHeight: 64 }}
              >
                <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: 'var(--oem-surface-2, #292d35)' }}>
                  {r.artworkIdentity
                    ? <img src={r.artworkIdentity} alt="" loading="lazy" className="h-full w-full object-cover" />
                    : <Music2 aria-hidden className="h-4 w-4" style={{ color: 'var(--oem-ink-3)' }} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold" style={{ color: 'var(--oem-ink)' }}>
                    {r.title}
                  </span>
                  <span className="block truncate text-xs" style={{ color: 'var(--oem-ink-2)' }}>
                    {r.artist ?? SEARCH_KIND_LABEL[r.kind]}
                  </span>
                </span>
                {/* Köken rozeti — teknik detay kadar, baskın değil. Aynı parça
                    başka kaynaklarda da varsa adet gösterilir. */}
                <span data-search-origin={r.provenance.providerId}
                  className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--oem-ink-3)' }}>
                  {ORIGIN_LABEL[r.provenance.providerId] ?? r.provenance.providerId}
                  {r.alternates.length > 0 ? ` +${r.alternates.length}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
