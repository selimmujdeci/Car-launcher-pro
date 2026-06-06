/**
 * CarOS Media Layer — merkezi medya katmanı.
 *
 *   Backend'ler (MediaSession · Spotify Connect · HTML5 stream · yerel MediaPlayer)
 *      ↑ delege
 *   carosMediaLayer  ← tüm sağlayıcıları birleştirir, çalmayı doğru backend'e yönlendirir
 *      ↑ tek arabirim
 *   UI (MediaScreen)  ← yalnızca bu katmanı kullanır
 *
 * UI artık tek tek servisleri (mediaService / streamMusicService / spotify / local)
 * doğrudan import etmez; bu katman üzerinden arar, çalar ve durumu okur.
 */
import { useStore } from '../../store/useStore';
import {
  getLocalMusicState, loadMusicTracks, playAtIndex, localSeek, setLocalOnEnded,
} from '../localMusicService';
import { playStream, streamSeek, setStreamOnEnded, STREAM_PKG } from '../streamMusicService';
import {
  searchSpotifyTracks, playSpotifyTrack, seekSpotify,
} from '../spotify/spotifyService';
import { isSpotifyConnected } from '../spotify/spotifyAuth';
import {
  getMediaState, updateMediaState, next as _nativeNext, previous as _nativePrev,
} from '../mediaService';
import { safeSetRaw, safeGetRaw } from '../../utils/safeStorage';
import { audiusProvider } from './audiusProvider';
import { radioBrowserProvider } from './radioBrowserProvider';
import { jamendoProvider } from './jamendoProvider';
import { archiveProvider, ARCHIVE_SCHEME, resolveArchiveStream } from './archiveProvider';
import { pipedProvider, PIPED_SCHEME } from './pipedProvider';
import {
  playYouTube, youtubeSeek, setYouTubeOnEnded, setYouTubeOnUnplayable, YOUTUBE_PKG,
} from '../youtubeService';
import { timeoutSignal, type ProviderId, type UnifiedTrack } from './providers';
import { isNative } from '../bridge';

const SPOTIFY_PKG = 'com.spotify.music';
const LOCAL_PKG   = 'com.cockpitos.pro';

/**
 * Yabancı/global katalog kaynakları (Audius, Jamendo, Internet Archive).
 * Bunlarda Türk mainstream içerik YOK → şimdilik kapalı (Türkiye odağı).
 * Uygulama dünya çapına çıkınca `true` yap → kaynaklar ve arama chip'leri geri gelir.
 */
export const WORLDWIDE_SOURCES_ENABLED = false;

/* ── Sağlayıcı görünüm bilgileri (rozet / renk) ──────────── */

export const PROVIDER_META: Record<ProviderId, { name: string; color: string }> = {
  spotify: { name: 'Spotify', color: '#1db954' },
  audius:  { name: 'Audius',  color: '#cc0fe0' },
  radio:   { name: 'Radyo',   color: '#f59e0b' },
  local:   { name: 'Cihaz',   color: '#3b82f6' },
  stream:  { name: 'Kaynak',  color: '#22d3ee' },
  jamendo: { name: 'Jamendo', color: '#f4b400' },
  archive: { name: 'Archive', color: '#9b8cff' },
  youtube: { name: 'YouTube', color: '#ff0000' },
};

// Ağ sağlayıcı araması üst timeout'u. pipedProvider instance-başı 6s denediğinden bu
// değer ondan BÜYÜK olmalı — aksi halde yavaş head unit ağında çalışan tek instance'ın
// fetch'i erkenden abort edilir ("Aranıyor…" sonra boş). 5s→8s.
const SEARCH_TIMEOUT_MS = 8000;

/* ── Alaka sıralaması ────────────────────────────────────────
 * Sağlayıcı taban puanı: Spotify (tam katalog + market=TR) en yukarıda; ardından
 * cihaz, özel kaynak, Audius (kullanıcı yüklemesi/yabancı gürültü), radyo.
 * Üzerine metin eşleşmesi eklenir → şarkı adını tek başına yazınca da eşleşen
 * parça üste çıkar (sanatçı adı yazmak gerekmez). */
const _PROVIDER_RANK: Record<ProviderId, number> = {
  youtube: 50, spotify: 48, local: 40, stream: 30, jamendo: 24, audius: 20, archive: 14, radio: 10,
};

function _relevance(t: UnifiedTrack, lc: string): number {
  let s = _PROVIDER_RANK[t.providerId] ?? 0;
  if (!lc) return s;
  const title = t.title.toLowerCase();
  const sub   = (t.subtitle ?? '').toLowerCase();
  if (title === lc)            s += 120;
  else if (title.startsWith(lc)) s += 70;
  else if (title.includes(lc))   s += 40;
  if (sub === lc)              s += 45;
  else if (sub.startsWith(lc)) s += 28;
  else if (sub.includes(lc))   s += 16;
  // Kelime sınırı eşleşmesi: "affetmem" gibi tek kelime şarkı adı da yakalanır
  if (`${title} ${sub}`.split(/\s+/).includes(lc)) s += 35;
  return s;
}

/** Native'de cihaz müzik listesini (henüz yüklenmediyse) yükler. */
export function ensureLocalLoaded(): void {
  if (isNative && getLocalMusicState().tracks.length === 0 && !getLocalMusicState().loading) {
    void loadMusicTracks();
  }
}

/**
 * Tüm sağlayıcılarda birleşik arama.
 * filter: 'all' | 'spotify' | 'audius' | 'radio' | 'local' | <özelKaynakId>
 * Yerel + özel kaynaklar senkron (anında); spotify/audius/radio paralel + timeout.
 */
export async function searchMedia(
  query: string,
  filter: string,
  onPartial?: (partial: UnifiedTrack[]) => void,
): Promise<UnifiedTrack[]> {
  const q  = query.trim();
  const lc = q.toLowerCase();
  const out: UnifiedTrack[] = [];

  // Alaka + sağlayıcı önceliğine göre sıralı kopya (stable: eşit puanlı geliş sırasını korur).
  const snapshot = (): UnifiedTrack[] =>
    out.slice().sort((a, b) => _relevance(b, lc) - _relevance(a, lc));
  const emit = (): void => { if (onPartial) onPartial(snapshot()); };

  // ── SENKRON kaynaklar ÖNCE: ağ beklemeden anında görünür ───────────────
  // Yerel cihaz müziği
  if (filter === 'all' || filter === 'local') {
    getLocalMusicState().tracks.forEach((t, i) => {
      const title  = t.title || t.uri.split('/').pop() || 'Parça';
      const artist = t.artist || t.album || '';
      if (!lc || title.toLowerCase().includes(lc) || artist.toLowerCase().includes(lc)) {
        out.push({ id: `local-${i}`, providerId: 'local', title, subtitle: artist || 'Cihaz', localIndex: i });
      }
    });
  }
  // Özel internet kaynakları (store)
  useStore.getState().settings.customMusicSources.forEach((s) => {
    if (filter !== 'all' && filter !== s.id) return;
    if (!lc || s.name.toLowerCase().includes(lc)) {
      out.push({ id: `stream-${s.id}`, providerId: 'stream', title: s.name, subtitle: 'İnternet akışı', streamUrl: s.url });
    }
  });
  if (out.length) emit(); // yerel + özel sonuçlar ANINDA göster

  // ── AĞ sağlayıcıları: her biri DÖNDÜKÇE sonuç ekler (en yavaşı BEKLEMEZ) ─
  // Önceki davranış: Promise.allSettled tüm sağlayıcıları beklerdi → YouTube
  // 1 sn'de dönse bile radio 5 sn timeout'a kadar kullanıcı boş ekran görürdü
  // ("bir saat arıyor"). Artık her sağlayıcı çözülünce onPartial ile UI güncellenir.
  const tasks: Promise<unknown>[] = [];
  const addTask = (p: Promise<UnifiedTrack[]>): void => {
    tasks.push(p.then((rs) => { if (rs?.length) { out.push(...rs); emit(); } }).catch(() => { /* sağlayıcı hatası → sessiz */ }));
  };
  if (q) {
    if ((filter === 'all' || filter === 'spotify') && isSpotifyConnected()) {
      addTask(searchSpotifyTracks(q).then((rs) => rs.map((t): UnifiedTrack => ({
        id: `spotify-${t.id}`, providerId: 'spotify',
        title: t.title, subtitle: t.artist, artwork: t.albumArt,
        spotifyUri: t.uri, spotifyDurationMs: t.durationMs,
      }))));
    }
    // YouTube (Piped) — Türk içeriği dahil her şey; ana Türkçe kaynak.
    if (filter === 'all' || filter === 'youtube') {
      addTask(pipedProvider.search(q, timeoutSignal(SEARCH_TIMEOUT_MS)));
    }
    if (WORLDWIDE_SOURCES_ENABLED && (filter === 'all' || filter === 'audius')) {
      addTask(audiusProvider.search(q, timeoutSignal(SEARCH_TIMEOUT_MS)));
    }
    if (WORLDWIDE_SOURCES_ENABLED && (filter === 'all' || filter === 'jamendo')) {
      addTask(jamendoProvider.search(q, timeoutSignal(SEARCH_TIMEOUT_MS)));
    }
    if (WORLDWIDE_SOURCES_ENABLED && (filter === 'all' || filter === 'archive')) {
      addTask(archiveProvider.search(q, timeoutSignal(SEARCH_TIMEOUT_MS)));
    }
    if (filter === 'all' || filter === 'radio') {
      addTask(radioBrowserProvider.search(q, timeoutSignal(SEARCH_TIMEOUT_MS)));
    }
  }

  await Promise.allSettled(tasks);
  return snapshot();
}

/* ── Çalma kuyruğu (stream/Audius/Spotify arama sonuçları için) ────────────
 * mediaService transport'u native MediaSession içindir ve kuyruk bilmez.
 * Bu katman, arama sonucundan çalınca listeyi kuyruk olarak tutar; sonraki/
 * önceki ve seek bu kuyruk üzerinden web'de de çalışır. */
let _queue: UnifiedTrack[] = [];
let _qIndex = -1;

function _isPlayable(t: UnifiedTrack): boolean {
  return !!t.spotifyUri || typeof t.localIndex === 'number' || !!t.streamUrl;
}

/** Tek parçayı doğru backend'e yönlendirir (harici uygulamaya gitmeden). */
function _playTrack(t: UnifiedTrack): void {
  if (t.spotifyUri) {
    void playSpotifyTrack({
      id: t.id, uri: t.spotifyUri, title: t.title, artist: t.subtitle,
      albumArt: t.artwork, durationMs: t.spotifyDurationMs ?? 0,
    });
  } else if (typeof t.localIndex === 'number') {
    void playAtIndex(t.localIndex);
  } else if (t.streamUrl?.startsWith(ARCHIVE_SCHEME)) {
    // Internet Archive: gerçek ses dosyası URL'sini çalmadan hemen önce çöz
    const identifier = t.streamUrl.slice(ARCHIVE_SCHEME.length);
    void resolveArchiveStream(identifier).then((url) => {
      if (url) void playStream(t.title, url, t.subtitle);
    });
  } else if (t.streamUrl?.startsWith(PIPED_SCHEME)) {
    // YouTube: gömülü IFrame oynatıcıda çal (ham stream değil → bot-engeline takılmaz)
    const videoId = t.streamUrl.slice(PIPED_SCHEME.length);
    void playYouTube(videoId, t.title, t.subtitle, t.artwork);
  } else if (t.streamUrl) {
    void playStream(t.title, t.streamUrl, t.subtitle);
  }
}

/**
 * Birleşik çalma. `queue` verilirse (arama sonuç listesi) sonraki/önceki için
 * kuyruk olarak saklanır; verilmezse tek parçalık kuyruk olur.
 */
export function playMedia(t: UnifiedTrack, queue?: UnifiedTrack[]): void {
  const list = (queue ?? [t]).filter(_isPlayable);
  _queue  = list.length ? list : [t];
  _qIndex = Math.max(0, _queue.findIndex((x) => x.id === t.id));
  _ytFailedIds.clear(); // yeni kullanıcı seçimi → eski gömme-hatası geçmişini sıfırla
  _playTrack(t);
  _persistLast(0);
  _startPositionSave();
}

/**
 * Sesli asistan / hızlı çalma — sorguyu (şarkı veya sanatçı adı) TÜM kaynaklarda arar,
 * en iyi eşleşmeyi uygulama İÇİNDE çalar. Kaynak fark etmez (YouTube/Spotify/radyo/cihaz);
 * sonuçlar alaka + sağlayıcı önceliğine göre sıralı geldiğinden ilk çalınabilir sonuç en iyisidir.
 * @param filter Tercih edilen kaynak ('all' = hepsi). Filtreli sonuç çıkmazsa otomatik 'all'a düşer.
 * @returns Çalınan parça veya null (hiç çalınabilir sonuç yoksa).
 */
export async function playByQuery(query: string, filter: string = 'all'): Promise<UnifiedTrack | null> {
  const q = query.trim();
  if (!q) return null;
  let playable = (await searchMedia(q, filter)).filter(_isPlayable);
  // Belirli kaynakta sonuç yoksa kaynak önemli değil → hepsinde tekrar dene.
  if (playable.length === 0 && filter !== 'all') {
    playable = (await searchMedia(q, 'all')).filter(_isPlayable);
  }
  if (playable.length === 0) return null;
  const top = playable[0];
  playMedia(top, playable);
  return top;
}

/* ── Son çalınan parçayı sakla/sürdür (yeniden açılışta "kaldığın yerden") ──
 * Sayfa yenilenince/uygulama yeniden açılınca bellekteki çalma durumu kaybolur.
 * Son parça + kuyruk + pozisyon safeStorage'a yazılır; play tuşu bundan devam eder. */
const LAST_KEY = 'caros_last_media';

interface LastMedia {
  track:       UnifiedTrack;
  queue:       UnifiedTrack[];
  positionSec: number;
  ts:          number;
}

// Cihaz kütüphanesi 1000+ parça olabilir; tüm kuyruğu her 10sn'de olduğu gibi
// diske yazmak I/O israfıdır (CLAUDE.md §3, "büyük blob localStorage'a yazma" yasağı).
// Aktif parça çevresinde sınırlı bir pencere sakla — resume + birkaç sonraki/önceki yeter.
const MAX_PERSIST_QUEUE = 60;

function _persistLast(positionSec: number): void {
  if (_qIndex < 0 || !_queue[_qIndex]) return;
  const track = _queue[_qIndex];
  let queue = _queue;
  if (_queue.length > MAX_PERSIST_QUEUE) {
    const half  = Math.floor(MAX_PERSIST_QUEUE / 2);
    const start = Math.min(Math.max(0, _qIndex - half), _queue.length - MAX_PERSIST_QUEUE);
    queue = _queue.slice(start, start + MAX_PERSIST_QUEUE);
  }
  const data: LastMedia = { track, queue, positionSec, ts: Date.now() };
  try { safeSetRaw(LAST_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// 10sn'de bir pozisyonu kaydet (CLAUDE.md §3: yüksek frekanslı yazım kısıtlaması).
let _saveTimer: ReturnType<typeof setInterval> | null = null;
function _startPositionSave(): void {
  if (_saveTimer != null) return;
  _saveTimer = setInterval(() => {
    const st = getMediaState();
    if (st.hasSession && _qIndex >= 0) _persistLast(st.track.positionSec || 0);
  }, 10_000);
}

export function getLastMedia(): LastMedia | null {
  try {
    const raw = safeGetRaw(LAST_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as LastMedia;
    return d?.track && _isPlayable(d.track) ? d : null;
  } catch { return null; }
}

/** Oturum yokken player'da son parçayı GÖSTER (çalmadan) — kullanıcı ne devam edeceğini görsün. */
export function previewLastMedia(): void {
  if (getMediaState().hasSession) return;
  const last = getLastMedia();
  if (!last) return;
  updateMediaState({
    source: 'unknown',
    activeAppName: PROVIDER_META[last.track.providerId]?.name ?? '',
    track: {
      title: last.track.title, artist: last.track.subtitle,
      albumArt: last.track.artwork, durationSec: 0, positionSec: 0,
    },
  });
}

/** Son parçayı kaldığı yerden çal (play tuşu, aktif oturum yokken bunu çağırır). */
export function resumeLastMedia(): boolean {
  const last = getLastMedia();
  if (!last) return false;
  const doResume = () => {
    playMedia(last.track, last.queue);
    // Pozisyon sürdürme (best-effort): parça yüklenip çalmaya başlayınca atla.
    if (last.positionSec > 5) {
      setTimeout(() => { if (getMediaState().track.title === last.track.title) seek(last.positionSec); }, 2000);
    }
  };
  // Cihaz parçası + liste henüz yüklenmemiş (uygulama yeniden açıldı) → önce yükle, sonra çal.
  if (typeof last.track.localIndex === 'number' && isNative && getLocalMusicState().tracks.length === 0) {
    void loadMusicTracks().then(doResume).catch(() => {});
  } else {
    doResume();
  }
  return true;
}

/** Sonraki parça — kuyruk varsa kuyruktan, yoksa native MediaSession'a düşer. */
export function next(): void {
  if (_queue.length > 1) {
    _qIndex = (_qIndex + 1) % _queue.length;
    _playTrack(_queue[_qIndex]);
    _persistLast(0); // parça değişti → "son parça" anında tazelensin
    return;
  }
  _nativeNext();
}

/** Önceki parça — ilk 3 sn'den sonra baştan başlatır; değilse önceki parçaya geçer. */
export function previous(): void {
  if (getMediaState().track.positionSec > 3) { seek(0); return; }
  if (_queue.length > 1) {
    _qIndex = (_qIndex - 1 + _queue.length) % _queue.length;
    _playTrack(_queue[_qIndex]);
    _persistLast(0);
    return;
  }
  _nativePrev();
}

/** Çalan parçada konuma atlar — aktif backend'e göre yönlendirir. */
export function seek(positionSec: number): void {
  const pkg = getMediaState().activePackage;
  if (pkg === STREAM_PKG)    { streamSeek(positionSec); return; }
  if (pkg === YOUTUBE_PKG)   { youtubeSeek(positionSec); return; }
  if (pkg === LOCAL_PKG)     { localSeek(positionSec * 1000); return; }
  if (pkg === SPOTIFY_PKG)   { void seekSpotify(positionSec * 1000); return; }
  // Harici native MediaSession'da rastgele seek desteklenmez → yok sayılır.
}

/** UI: sonraki/önceki kontrollerini etkinleştirmek için kuyrukta >1 parça var mı. */
export function hasQueue(): boolean {
  return _queue.length > 1;
}

// Stream/YouTube parçası doğal bitince kuyruğu otomatik ilerlet.
setStreamOnEnded(() => next());
setYouTubeOnEnded(() => next());
// Cihaz parçası doğal bitince de kuyruğu caros yönetsin (tek tip sonraki/önceki + persist).
setLocalOnEnded(() => next());

/* ── YouTube "oynatılamaz" kurtarması (gömme kapalı / kaldırılmış) ──────────
 * Resmî Türkçe klipler sık sık gömmeye (embedding) izin vermez → loadVideoById
 * 150/101 hatası verir, video sessizce takılır (kullanıcı: "play'e bastım,
 * başlamıyor"). Bu durumda aynı şarkı için GÖMÜLEBİLİR bir alternatif arayıp
 * çalarız. Çok-parçalı kuyrukta önce sonraki parçaya geçeriz. */
const _ytFailedIds = new Set<string>();
let _ytRecovering = false;

async function _recoverYouTube(failedId: string): Promise<void> {
  if (_ytRecovering) return;
  _ytRecovering = true;
  try {
    if (failedId) _ytFailedIds.add(failedId);
    // Çok-parçalı liste: sonraki parçaya geç (kullanıcı zaten sıralı bir kuyruk çalıyor).
    if (_queue.length > 1) { next(); return; }
    // Sonsuz arama döngüsü koruması — birkaç başarısız denemeden sonra vazgeç (sessiz).
    if (_ytFailedIds.size > 6) return;
    // Tek parça (resume): aynı şarkı için gömülebilir başka YouTube sonucu bul.
    const cur = _queue[_qIndex];
    if (!cur) return;
    const q = `${cur.title} ${cur.subtitle ?? ''}`.trim();
    if (!q) return;
    const results = await searchMedia(q, 'youtube');
    const alt = results.find((t) =>
      _isPlayable(t) &&
      !!t.streamUrl?.startsWith(PIPED_SCHEME) &&
      !_ytFailedIds.has(t.streamUrl.slice(PIPED_SCHEME.length)),
    );
    if (alt) {
      _queue  = [alt];
      _qIndex = 0;
      _playTrack(alt);
      _persistLast(0);
    }
  } catch { /* ignore — fail-soft */ }
  finally { _ytRecovering = false; }
}
setYouTubeOnUnplayable((videoId) => { void _recoverYouTube(videoId); });

/* ── UI'nın tek import noktası — transport + state + spotify bağlanma ────────
 * next/previous/seek BU katmanda tanımlıdır (kuyruk-farkında); diğerleri
 * doğrudan mediaService'ten gelir. */
export {
  useMediaState, togglePlayPause, play,
  fmtTime, startMediaHub, stopMediaHub, toggleShuffle, cycleRepeat,
  setMediaPreferredPackage, pollMediaNow,
} from '../mediaService';
export type { MediaSource } from '../mediaService';
export { isSpotifyConnected, beginSpotifyLogin } from '../spotify/spotifyAuth';
export { ensureYouTubeReady, setYouTubeRegion, YOUTUBE_PKG } from '../youtubeService';
export type { UnifiedTrack, ProviderId } from './providers';
