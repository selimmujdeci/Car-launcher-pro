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
  getLocalMusicState, loadMusicTracks, playLocalSelection, localSeek,
} from '../localMusicService';
import { playStream, streamSeek, setStreamOnEnded, STREAM_PKG } from '../streamMusicService';
import {
  searchSpotifyTracks, playSpotifyTrack, seekSpotify,
} from '../spotify/spotifyService';
import { isSpotifyConnected } from '../spotify/spotifyAuth';
import {
  getMediaState, updateMediaState, next as _nativeNext, previous as _nativePrev,
} from '../mediaService';
import type { MediaCommandResult } from '../mediaService';
import type { CommandTruth } from './authority/playbackTruth';
import { safeSetRaw, safeGetRaw } from '../../utils/safeStorage';
import { audiusProvider } from './audiusProvider';
import { pushTrail } from '../diagnosticTrailCore';  // çekirdek: ağır obd/store zinciri GİRMESİN
import { radioBrowserProvider } from './radioBrowserProvider';
import { jamendoProvider } from './jamendoProvider';
import { archiveProvider, ARCHIVE_SCHEME, resolveArchiveStream } from './archiveProvider';
import { pipedProvider, PIPED_SCHEME } from './pipedProvider';
/* MUSIC F7.1: `playYouTube` ARTIK BURADAN ÇAĞRILMAZ — başlatma yetkisi
   `mediaCommandGateway` + YouTube adaptöründedir (tek çalma kapısı). */
import {
  youtubeSeek, setYouTubeOnEnded, setYouTubeOnUnplayable, YOUTUBE_PKG,
} from '../youtubeService';
import { timeoutSignal, type ProviderId, type UnifiedTrack } from './providers';
/* MUSIC F7.6 · Sağlayıcı sırası artık BU KATMANDA TUTULMAZ. Kanonik sıra
   `PlayQueue`, kanonik bağlam `ListeningSession`tır; bu katman yalnız
   projeksiyon okur ve tek öğe yürütür. */
import {
  clearQueue as canonicalClearQueue,
  getCurrentEntry, getDesiredQueue, getDesiredQueueView,
  setCurrentIndex as canonicalSetCurrentIndex,
  type QueueEntry,
} from './session/playQueue';
import {
  advanceQueue, startProviderListening,
} from './session/listeningSessionRuntime';
import {
  buildProviderQueueContext,
  type ProviderTrackInput,
} from './session/providerQueueContext';
import { getSource } from './authority/sourceCapabilities';
import { isNative } from '../bridge';
import { runtimeManager } from '../../core/runtime/AdaptiveRuntimeManager';

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
/**
 * @deprecated F5.1 · **KANONİK ARAMA OTORİTESİ DEĞİLDİR.**
 *
 * Birleşik arama artık `search/musicSearchCoordinator` üzerinden yürür; sıralama
 * `searchRanking`, tekilleştirme `searchDedup`, uygunluk `sourceCapabilities
 * .supportsSearch` kararıdır. Bu fonksiyon yalnız GERİYE UYUMLULUK için durur ve
 * hiçbir üretim yolundan çağrılmaz. Çağrıldığı an sayaca yazılır ve CAROS LAB'da
 * görünür — sessiz bir mimari kaçak bırakılmaz.
 */
export async function searchMedia(
  query: string,
  filter: string,
  onPartial?: (partial: UnifiedTrack[]) => void,
): Promise<UnifiedTrack[]> {
  try {
    const { noteLegacySearchCall } = await import('./search/searchTelemetry');
    noteLegacySearchCall();
  } catch { /* teşhis yazımı akışı bozmaz */ }
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

/* ── MUSIC F7.6 · SIRA SAHİPLİĞİ BU KATMANDAN ALINDI ───────────────────────
 *
 * ÖLÇÜLEN KUSUR: burada `_queue` · `_qIndex` · `_qRevision` adında MUTABLE bir
 * sıra vardı. Kanonik `PlayQueue` yalnız KÜTÜPHANE seçimleri için kuruluyordu →
 * sağlayıcı tarafında İKİNCİ bir desired-queue sahibi oluşuyordu: sırayı da
 * imleci de bu katman kendi yazıyor, `ListeningSession` hiç doğmuyordu.
 *
 * SONRASI: sıra ve imleç `PlayQueue`nun, bağlam `ListeningSession`ındır. Burada
 * kalan tek şey bir **sunum/yönlendirme önbelleğidir**: kuyruk girdisi
 * (`entryId`) → o girdinin UI tanımı (`UnifiedTrack`). Bu önbellek SIRA
 * TUTMAZ, İMLEÇ TUTMAZ ve hiçbir kararın kaynağı DEĞİLDİR; kanonik kuyruk
 * yazıldığında bütün olarak yenilenir.
 *
 * Guard: `regression.guards` bu katmanda yeniden mutable sıra/imleç
 * doğmadığını kilitler. */
const _trackByEntryId = new Map<string, UnifiedTrack>();
/** Sunum önbelleği üst sınırı — kuyruk penceresiyle aynı büyüklük sınıfı. */
const MAX_TRACK_CACHE = 400;

/** Kanonik kuyruğun GEÇERLİ girdisine karşılık gelen UI tanımı (yoksa null). */
function _currentTrack(): UnifiedTrack | null {
  const entry = getCurrentEntry();
  if (!entry) return null;
  return _trackByEntryId.get(entry.entryId) ?? null;
}

function _isPlayable(t: UnifiedTrack): boolean {
  return !!t.spotifyUri || typeof t.localIndex === 'number' || !!t.streamUrl;
}

/** `UnifiedTrack` → kanonik kuyruk kurucusunun beklediği yalın girdi. */
function _toProviderInput(t: UnifiedTrack): ProviderTrackInput {
  return {
    id: t.id,
    providerId: t.providerId,
    title: t.title,
    subtitle: t.subtitle,
    artwork: t.artwork,
    streamUrl: t.streamUrl,
    spotifyUri: t.spotifyUri,
    spotifyDurationMs: t.spotifyDurationMs,
  };
}

/** Sunum önbelleğini kanonik kuyruk girdileriyle YENİDEN kurar (sıra tutmaz). */
function _rebuildTrackCache(entries: readonly QueueEntry[], tracks: readonly UnifiedTrack[]): void {
  _trackByEntryId.clear();
  const byId = new Map(tracks.map((t) => [`${t.providerId}:${t.id}`, t]));
  for (const e of entries) {
    const ns = (e.identity.providerNamespace ?? '').toLowerCase();
    const t = byId.get(`${ns}:${e.identity.providerId ?? ''}`);
    if (t) _trackByEntryId.set(e.entryId, t);
    if (_trackByEntryId.size >= MAX_TRACK_CACHE) break;
  }
}

/** Bu kaynağın KENDİ zaman çizelgesi (kuyruğu) var mı — native ilerletir. */
function _backendOwnsTimeline(): boolean {
  const src = getDesiredQueue().source;
  if (src === null) return false;
  try { return getSource(src).capabilities.supportsQueue === true; } catch { return false; }
}

/**
 * MUSIC F7.1 · YouTube parçasını kanonik komut kapısından başlatır.
 *
 * Sahte başarı üretilmez: kapı reddederse UI/oturum "çalıyor" DEMEZ; hata
 * gömme-engeli kurtarmasına (`_recoverYouTube`) devredilir — bu, kullanıcının
 * "bastım, başlamıyor" yaşamasını engelleyen mevcut davranıştır ve KORUNUR.
 */
async function _playYouTubeViaAuthority(t: UnifiedTrack): Promise<void> {
  const videoId = t.streamUrl?.slice(PIPED_SCHEME.length) ?? '';
  if (!videoId) return;
  try {
    const { playSource } = await import('./authority/mediaCommandGateway');
    const truth = await playSource({
      source: 'YOUTUBE',
      items: [{
        id: t.id,
        uri: `${PIPED_SCHEME}${videoId}`,
        title: t.title,
        artist: t.subtitle,
        artworkUri: t.artwork,
      }],
      startIndex: 0,
      autoPlay: true,
    });
    if (truth.outcome === 'VERIFIED' || truth.outcome === 'ACCEPTED_UNVERIFIED') return;
    /* Kapı başlatamadı → gömme kapalı/oynatılamaz yolu ile aynı kurtarma. */
    void _recoverYouTube(videoId);
  } catch {
    void _recoverYouTube(videoId);
  }
}

/** Tek parçayı doğru backend'e yönlendirir (harici uygulamaya gitmeden). */
function _playTrack(t: UnifiedTrack): void {
  if (t.spotifyUri) {
    void playSpotifyTrack({
      id: t.id, uri: t.spotifyUri, title: t.title, artist: t.subtitle,
      albumArt: t.artwork, durationMs: t.spotifyDurationMs ?? 0,
    });
  } else if (typeof t.localIndex === 'number') {
    void playLocalSelection(t.localIndex);
  } else if (t.streamUrl?.startsWith(ARCHIVE_SCHEME)) {
    // Internet Archive: gerçek ses dosyası URL'sini çalmadan hemen önce çöz
    const identifier = t.streamUrl.slice(ARCHIVE_SCHEME.length);
    void resolveArchiveStream(identifier).then((url) => {
      if (url) void playStream(t.title, url, t.subtitle);
    });
  } else if (t.streamUrl?.startsWith(PIPED_SCHEME)) {
    /* MUSIC F7.1 · YouTube artık KANONİK kapıdan çalar.
     *
     * ÖNCESİ: `playYouTube()` DOĞRUDAN çağrılıyordu. Bu, F0'ın tek-komut-kapısı
     * sözleşmesinin dışında ikinci bir çalma yoluydu: kaynak devri
     * doğrulanmıyor (`audibleBackendCount <= 1` kapı dışından zorlanıyor),
     * `CommandTruth` üretilmiyor ve Mavi "çalıyor" iddiasını kanıtsız kuruyordu.
     *
     * SONRASI: kapı → `sourceCoordinator` (eskiyi DURDUR + DOĞRULA) →
     * YouTube adaptörü `prepare/start`. Gömülü oynatıcı aynı oynatıcıdır;
     * değişen tek şey KİMİN başlattığıdır. */
    void _playYouTubeViaAuthority(t);
  } else if (t.streamUrl) {
    void playStream(t.title, t.streamUrl, t.subtitle);
  }
}

/**
 * MUSIC F7.6 · Birleşik çalma — KANONİK sıra + bağlam kurar.
 *
 * Zincir: `seçim → same-provider kuyruk bağlamı → PlayQueue →
 * ListeningSession → MediaCommandGateway → sourceCoordinator → backend`.
 *
 * Bu fonksiyon artık HİÇBİR sıra/imleç TUTMAZ. `queue` verilirse kullanıcının
 * gördüğü liste kanonik kuyruğa çevrilir (sağlayıcı sınırı `providerQueueContext`
 * içinde uygulanır); verilmezse tek öğeli kuyruk kurulur.
 */
export function playMedia(t: UnifiedTrack, queue?: UnifiedTrack[]): void {
  _ytFailedIds.clear(); // yeni kullanıcı seçimi → eski gömme-hatası geçmişini sıfırla
  _startPositionSave();
  pushTrail('action', 'medya: çal', t.providerId);  // olay izi (PII yok — yalnız kaynak, başlık DEĞİL)

  /* Cihaz kütüphanesi parçası (yalnız "kaldığın yerden devam" yolundan gelir):
     kanonik kütüphane kuyruğu F3'ün `startLibraryListening`ıdır ve o yol
     `MusicIndex` kimliği ister; burada elimizde yalnız bir liste İNDEKSİ var.
     Bu yüzden F0'ın kanonik yerel ön kapısı (`playLocalSelection`) kullanılır;
     sağlayıcı kuyruğu KURULMAZ (yanlış kaynak sınıfı iddiası üretilmez). */
  if (typeof t.localIndex === 'number') {
    _playTrack(t);
    _persistLast(0);
    return;
  }

  const list = (queue ?? [t]).filter(_isPlayable).map(_toProviderInput);
  const context = buildProviderQueueContext(_toProviderInput(t), list);
  if (context === null) {
    /* Tanınmayan/çalınamaz sağlayıcı: kanonik kuyruk KURULMAZ ve sahte bir
       bağlam üretilmez. Tek öğe yine kendi kanonik ön kapısından denenir. */
    _playTrack(t);
    _persistLast(0);
    return;
  }

  const tracks = (queue ?? [t]).filter(_isPlayable);
  _rebuildTrackCache(context.entries, tracks.includes(t) ? tracks : [t, ...tracks]);
  _lastExcludedCount = context.excludedIds.length;

  void startProviderListening(context)
    .then((result) => {
      if (result.started) { _persistLast(0); return; }
      _onProviderStartFailed(t, context.source, result.reason);
    })
    .catch(() => { _onProviderStartFailed(t, context.source, 'provider_listening_threw'); });
}

/**
 * Kanonik başlatma yapılamadı — sahte başarı ÜRETİLMEZ.
 *
 * İki dürüst yol vardır:
 *   1. YouTube'da gömme kapalı/oynatılamaz olabilir → mevcut kurtarma
 *      (`_recoverYouTube`) devreye girer (F7.1'de kurulan davranış KORUNUR).
 *   2. Tarayıcı (dev) modunda akış/radyo kaynaklarının native otoritesi YOKTUR;
 *      `streamMusicService` HTML5 yedeğini orada zaten sürdürür. Bu YALNIZ bir
 *      YÜRÜTME yedeğidir — kuyruk ve oturum kanonik kalır, burada ikinci bir
 *      sıra sahibi doğmaz.
 */
function _onProviderStartFailed(t: UnifiedTrack, source: string, reason: string): void {
  if (source === 'YOUTUBE' && t.streamUrl?.startsWith(PIPED_SCHEME)) {
    void _recoverYouTube(t.streamUrl.slice(PIPED_SCHEME.length));
    return;
  }
  if (!isNative && (source === 'STREAM' || source === 'INTERNET_RADIO')) {
    _playTrack(t);
    _persistLast(0);
    return;
  }
  console.warn('[Media] kanonik sağlayıcı başlatma başarısız:', source, reason);
}

/** Son kuyruk kurulumunda sağlayıcı sınırı nedeniyle DIŞARIDA kalan satır sayısı. */
let _lastExcludedCount = 0;

/** LAB gözlemi — sağlayıcı sınırı kaç satırı kuyruk dışında bıraktı. */
export function getProviderQueueExclusionCount(): number {
  return _lastExcludedCount;
}

/**
 * LAB gözlemi — bu katmanın SUNUM önbelleğindeki girdi sayısı.
 *
 * Bu bir kuyruk DEĞİLDİR (sıra/imleç taşımaz). Sayı kanonik kuyruk
 * uzunluğundan büyükse önbellek bayat kalmış demektir; küçükse bazı satırların
 * UI tanımı çözülememiştir. Her iki durum da teşhis edilebilir olsun diye
 * ayrıca gösterilir.
 */
export function getLayerProjectionSize(): number {
  return _trackByEntryId.size;
}

/** Kaynak filtresi → kanonik sağlayıcı kimliği. Tanınmayan filtre tercih ÜRETMEZ. */
function _filterToProvider(filter: string): ProviderId | null {
  switch (filter) {
    case 'spotify': case 'youtube': case 'radio': case 'local':
    case 'audius': case 'jamendo': case 'archive': case 'stream':
      return filter;
    default: return null;   // 'all' ve özel kaynak kimlikleri → tercih yok
  }
}

/**
 * Kanonik arama sonucu → bu katmanın çalma tanımı. Metadata UYDURULMAZ.
 *
 * F9 (Mavi müzik yönlendiricisi) de AYNI dönüştürücüyü kullanır: sağlayıcı
 * sonucundan çalma tanımı üretmenin ikinci bir yolu KURULMAZ.
 */
export function unifiedFromSearchResult(r: {
  identity: { providerId: string | null; contentUri: string | null };
  resultId: string; title: string; artist: string | null;
  artworkIdentity: string | null;
  provenance: { providerId: ProviderId };
}): UnifiedTrack {
  const uri = r.identity.contentUri;
  return {
    id: r.identity.providerId ?? r.resultId,
    providerId: r.provenance.providerId,
    title: r.title,
    subtitle: r.artist ?? '',
    artwork: r.artworkIdentity ?? undefined,
    ...(uri?.startsWith('spotify:') ? { spotifyUri: uri } : uri ? { streamUrl: uri } : {}),
  };
}

/**
 * Sesli asistan / hızlı çalma — **F5.1'de KANONİK hatta taşındı.**
 *
 * ÖNCESİ: bu fonksiyon `searchMedia` üzerinden AYRI bir orkestrasyon ve AYRI bir
 * sıralama (sağlayıcı popülerlik tablosu) kullanıyordu. Kullanıcının ekranda
 * gördüğü sıra ile sesle çalınan parça FARKLI kurallarla seçiliyordu.
 *
 * SONRASI: `MusicSearchCoordinator.searchOnce` → kanonik sıralama + tekilleştirme
 * → güvenli seçim politikası → `selectSearchResult` → F3 oturum yolu → F0.
 * Yerel sonuç F3'ten çalar; sağlayıcı sonucu BU katmanın kanonik `playMedia`
 * kapısından geçer (sağlayıcıya doğrudan komut YOKTUR).
 *
 * DAVRANIŞ KORUNDU: tercih edilen kaynakta sonuç yoksa kanonik sıranın en üstü
 * kullanılır; hiç sonuç yoksa `null` döner ve çağıran dürüstçe "bulunamadı" der.
 *
 * @returns Çalınan/başlatılan parça; belirsiz veya sonuçsuz durumda `null`.
 */
export async function playByQuery(query: string, filter: string = 'all'): Promise<UnifiedTrack | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const [{ ensureSearchSourcesConfigured }, { playByVoiceQuery }] = await Promise.all([
      import('./search/searchRegistry'),
      import('./search/voiceSearchIntent'),
    ]);
    await ensureSearchSourcesConfigured();
    const outcome = await playByVoiceQuery(q, _filterToProvider(filter));

    if (outcome.outcome === 'STARTED' && outcome.selected) {
      // Yerel kütüphane: çalma F3 oturum yolundan ZATEN başlatıldı.
      return unifiedFromSearchResult(outcome.selected);
    }
    if (outcome.outcome === 'PROVIDER_PATH' && outcome.selected) {
      // Sağlayıcı sonucu: kanonik medya katmanı yönlendirir (doğrudan sağlayıcı
      // çağrısı DEĞİL). Kuyruk, kullanıcının göreceği sonuç listesidir.
      const track = unifiedFromSearchResult(outcome.selected);
      const queue = outcome.snapshot.results
        .filter((r) => r.provenance.origin === 'PROVIDER')
        .map(unifiedFromSearchResult)
        .filter(_isPlayable);
      playMedia(track, queue.length > 0 ? queue : [track]);
      return track;
    }
    /* AMBIGUOUS · NO_RESULT · SOURCES_UNAVAILABLE · STALE · REJECTED:
       otomatik çalma YAPILMAZ. Araçta yanlış parça başlatmak, "bulamadım"
       demekten daha kötüdür. */
    return null;
  } catch {
    // Kanonik hat kurulamadıysa sessizce başarısız ol — sahte çalma iddiası YOK.
    return null;
  }
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

/**
 * MUSIC F7.6 · "Kaldığın yerden devam" anlık görüntüsü — KANONİK kuyruktan
 * TÜRETİLİR. Bu bir sıra sahipliği DEĞİLDİR: yalnız `PlayQueue` + sunum
 * önbelleği okunur ve sınırlı bir pencere diske yazılır.
 *
 * Kalıcı kayıt CANLI GERÇEK DEĞİLDİR (Cross-Domain §13): geri yüklenmesi
 * "çalıyor" anlamına gelmez, yalnız kullanıcıya devam ÖNERİSİ sunar.
 */
function _persistLast(positionSec: number): void {
  const canonical = getDesiredQueue();
  const track = _currentTrack();
  if (!track || canonical.currentIndex < 0) return;

  const tracks: UnifiedTrack[] = [];
  for (const e of canonical.entries) {
    const t = _trackByEntryId.get(e.entryId);
    if (t) tracks.push(t);
  }
  let queue = tracks;
  if (tracks.length > MAX_PERSIST_QUEUE) {
    const half  = Math.floor(MAX_PERSIST_QUEUE / 2);
    const idx   = Math.max(0, tracks.findIndex((x) => x.id === track.id));
    const start = Math.min(Math.max(0, idx - half), tracks.length - MAX_PERSIST_QUEUE);
    queue = tracks.slice(start, start + MAX_PERSIST_QUEUE);
  }
  const data: LastMedia = { track, queue: queue.length ? queue : [track], positionSec, ts: Date.now() };
  try { safeSetRaw(LAST_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// 10sn'de bir pozisyonu kaydet (CLAUDE.md §3: yüksek frekanslı yazım kısıtlaması).
// FAZ 16 grup-2: sabit setInterval yerine scheduler (§L.0, periodMs API);
// BALANCED/PERFORMANCE'ta 10s AYNEN korunur. fn saf "mevcut çalma pozisyonunu
// oku ve kaydet" anlık görüntüsüdür (tick-sayımına dayalı birikim YOK) →
// periyot düşük-tier'da uzasa da yanlış veri yazılmaz, yalnız kayıt sıklığı
// azalır. deferIdle: eMMC yazımı UI'a öncelikli değil.
let _saveTimer: (() => void) | null = null;
function _startPositionSave(): void {
  if (_saveTimer != null) return;
  _saveTimer = runtimeManager.scheduleTask({
    id: 'media-pos-save', periodMs: 10_000, criticality: 'NORMAL', deferIdle: true,
    fn: () => {
      const st = getMediaState();
      if (st.hasSession) _persistLast(st.track.positionSec || 0);
    },
  });
}

/** Pozisyon-kaydetme timer'ını durdur (Zero-Leak §1) — idempotent. */
function _stopPositionSave(): void {
  if (_saveTimer != null) { _saveTimer(); _saveTimer = null; }
}

// HMR / test re-init'te orphan interval bırakma — modül atılırken timer'ı temizle.
if (import.meta.hot) {
  import.meta.hot.dispose(() => _stopPositionSave());
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

/**
 * Sonraki parça — KUYRUK-FARKINDA tek giriş.
 *
 * MUSIC F7.3: UI düğmeleri, sesli komut ve donanım/bildirim MediaSession
 * tuşları AYNI buraya gelir. Sıra ÜST katmandaysa (arama sonucu listesi —
 * YouTube gibi backend timeline'ı olmayan kaynaklar) buradan ilerler ve
 * her parça yine kanonik kapıdan başlar; sıra BACKEND'inse native yola
 * düşer. İki ayrı "sonraki" davranışı KALMAZ.
 */
export async function next(requester?: string): Promise<MediaCommandResult> {
  /* Sıra BACKEND'in ise (native timeline) ilerletme onun işidir — F0 yolu
     DEĞİŞMEZ. Sıra ÜST katmandaysa kanonik imleç `PlayQueue`da taşınır ve
     yürütme yine kapıdan gider (`advanceQueue`). */
  if (!_backendOwnsTimeline() && getDesiredQueue().entries.length > 1) {
    const r = await advanceQueue(1);
    if (r.applied) _persistLast(0);
    return _queueCommandResult(r);
  }
  return _nativeNext(requester);
}

/** Önceki parça — ilk 3 sn'den sonra baştan başlatır; değilse önceki parçaya geçer. */
export async function previous(requester?: string): Promise<MediaCommandResult> {
  if (getMediaState().track.positionSec > 3) {
    seek(0);
    /* Baştan alma bir ATLAMA değildir; gözlem üretmez ve öyleymiş gibi
       raporlanmaz (sahte doğrulama yok). */
    return { dispatched: true, verified: false, failureCode: null };
  }
  if (!_backendOwnsTimeline() && getDesiredQueue().entries.length > 1) {
    const r = await advanceQueue(-1);
    if (r.applied) _persistLast(0);
    return _queueCommandResult(r);
  }
  return _nativePrev(requester);
}

/**
 * MUSIC F9 · Kuyruk komutu sonucunu KANONİK medya sonucuna çevirir.
 *
 * ÖLÇÜLEN KUSUR (F9 denetimi): bu giriş `void` döndürüyordu; `commandExecutor`
 * bu yüzden atlama için `mediaService.next`i DOĞRUDAN çağırıyor, yani F7.3'te
 * kurulan kuyruk-farkında tek girişi ATLIYORDU. Sağlayıcı arama listesinden
 * çalarken Mavi'nin "sonraki"si `unsupported_capability` ile düşüyordu.
 * Giriş TEK kalır; yalnız kanıtı geri verir.
 */
function _queueCommandResult(r: { applied: boolean; truth: CommandTruth | null;
  queueResult: { failureCode: string | null } }): MediaCommandResult {
  if (!r.applied) {
    return { dispatched: false, verified: false, failureCode: r.queueResult.failureCode ?? 'rejected' };
  }
  const verified = r.truth?.outcome === 'VERIFIED';
  return { dispatched: true, verified, failureCode: verified ? null : (r.truth?.failureCode ?? null) };
}

/** Çalan parçada konuma atlar — aktif backend'e göre yönlendirir. */
export function seek(positionSec: number): void {
  const pkg = getMediaState().activePackage;
  /* MÜZİK HUB PAKET A: uygulama-içi ses otoritede çalıyorsa seek TEK kapıdan
   * geçer. Otorite yoksa (web / servis başlamadı) eski yollar devrededir. */
  if (isNative && (pkg === LOCAL_PKG || pkg === STREAM_PKG)) {
    void import('./authority/mediaCommandGateway')
      .then((gw) => gw.seek(positionSec))
      .catch(() => { /* fail-soft: eski yol aşağıda */ });
    return;
  }
  /* MUSIC F7.1: YouTube seek'i de TEK kapıdan geçer — kapı yürütmeyi backend
     sahibine (IFrame adaptörü) dağıtır. Kapı yüklenemezse eski doğrudan yol
     yalnız FAIL-SOFT yedeğidir. */
  if (pkg === YOUTUBE_PKG) {
    void import('./authority/mediaCommandGateway')
      .then((gw) => gw.seek(positionSec))
      .catch(() => { youtubeSeek(positionSec); });
    return;
  }
  if (pkg === STREAM_PKG)    { streamSeek(positionSec); return; }
  if (pkg === LOCAL_PKG)     { localSeek(positionSec * 1000); return; }
  if (pkg === SPOTIFY_PKG)   { void seekSpotify(positionSec * 1000); return; }
  // Harici native MediaSession'da rastgele seek desteklenmez → yok sayılır.
}

/** UI: sonraki/önceki kontrollerini etkinleştirmek için kuyrukta >1 parça var mı. */
export function hasQueue(): boolean {
  return getDesiredQueue().entries.length > 1;
}

/**
 * MÜZİK HUB PAKET B · UI indeksini native gerçeğe HİZALA (kurtarma eylemi).
 *
 * YALNIZ indeks düzeltilir: kuyruk içeriği korunur, ÇALAN parça DEĞİŞTİRİLMEZ
 * ve hiçbir backend'e komut gönderilmez. Geçersiz indeks yok sayılır.
 */
export function alignUiQueueIndex(nativeIndex: number): void {
  if (!Number.isFinite(nativeIndex)) return;
  const idx = Math.trunc(nativeIndex);
  const canonical = getDesiredQueue();
  if (idx < 0 || idx >= canonical.entries.length) return;
  if (idx === canonical.currentIndex) return;
  /* MUSIC F7.6: hizalama KANONİK imleç üzerinde yapılır — bu katmanda ayrı bir
     imleç YOKTUR. `playQueue.setCurrentIndex` DOĞRUDAN çağrılır (runtime'ın
     kuyruk komutu DEĞİL): kurtarma hiçbir backend'e komut GÖNDERMEZ, yalnız
     projeksiyonu ses üreten gerçeğe hizalar. Desteklemeyen kaynakta kanonik
     kuyruk dürüstçe reddeder ve hizalama YAPILMAZ. */
  canonicalSetCurrentIndex(idx);
}

/**
 * MÜZİK HUB PAKET B · UI kuyruğunu temizle (kurtarma eylemi).
 * Çağıran, native oynatmanın GERÇEKTEN durduğunu doğrulamış olmalıdır.
 */
export function clearUiQueue(): void {
  if (getDesiredQueue().entries.length === 0) return;
  canonicalClearQueue();
  _trackByEntryId.clear();
}

/**
 * MÜZİK HUB PAKET A · UI kuyruğunun SALT-OKUNUR görünümü (uzlaştırma girdisi).
 * Parça başlığı/sanatçı/URL TAŞIMAZ — yalnız kimlik, indeks, uzunluk, revizyon.
 * Hiçbir şeyi başlatmaz, kuyruğu değiştirmez.
 */
export function getUiQueueView(): {
  revision: number; length: number; currentIndex: number; currentItemId: string | null;
} {
  /* MUSIC F7.6: bu bir TÜRETİMDİR — kaynak kanonik `PlayQueue`dur. Katmanın
     kendi revizyonu/uzunluğu/imleci ARTIK YOKTUR. */
  const view = getDesiredQueueView();
  if (!view) return { revision: 0, length: 0, currentIndex: -1, currentItemId: null };
  return {
    revision: view.revision,
    length: view.length,
    currentIndex: view.currentIndex,
    currentItemId: view.currentItemId,
  };
}

// Stream/YouTube parçası doğal bitince kuyruğu otomatik ilerlet.
setStreamOnEnded(() => next());
setYouTubeOnEnded(() => next());
// Cihaz parçası doğal bitince de kuyruğu caros yönetsin (tek tip sonraki/önceki + persist).

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
    if (getDesiredQueue().entries.length > 1) { next(); return; }
    // Sonsuz arama döngüsü koruması — birkaç başarısız denemeden sonra vazgeç (sessiz).
    if (_ytFailedIds.size > 6) return;
    // Tek parça (resume): aynı şarkı için gömülebilir başka YouTube sonucu bul.
    const cur = _currentTrack();
    if (!cur) return;
    const q = `${cur.title} ${cur.subtitle ?? ''}`.trim();
    if (!q) return;
    /* F5.1 · Kurtarma da KANONİK hattı kullanır: ikinci bir sıralama/orkestrasyon
       bırakılmaz. Sonuçlar kanonik sıralamadan gelir, burada yalnız gömülebilir
       (piped) ve daha önce düşmemiş olan aday seçilir. */
    const { ensureSearchSourcesConfigured } = await import('./search/searchRegistry');
    const { searchOnce } = await import('./search/musicSearchCoordinator');
    await ensureSearchSourcesConfigured();
    const canonical = await searchOnce(q);
    const results = canonical.results
      .filter((r) => r.provenance.providerId === 'youtube')
      .map(unifiedFromSearchResult);
    const alt = results.find((t) =>
      _isPlayable(t) &&
      !!t.streamUrl?.startsWith(PIPED_SCHEME) &&
      !_ytFailedIds.has(t.streamUrl.slice(PIPED_SCHEME.length)),
    );
    if (alt) {
      /* MUSIC F7.6: kurtarma da KANONİK kuyruğu yeniden kurar — bu katmanda
         ayrı bir sıra yazılmaz. `playMedia` tek girişten geçer. */
      playMedia(alt, [alt]);
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
