/**
 * ytDownloadService — YouTube ses indirme (SADECE dev/kişisel build).
 *
 * ⚠️ TİCARİ SATIŞA GİRMEZ. Tamamen `VITE_ENABLE_YT_DOWNLOAD` build-time bayrağı
 * arkasındadır; bayrak set EDİLMEDEN alınan (release) build'de bu modülün çağrı
 * yolu ölü-kod olarak elenir → satış paketinde bulunmaz. Bkz. docs/FEATURE_FLAGS.md.
 *
 * Akış: Piped `/streams/<id>` → en iyi audioStream URL → fetch (ilerlemeli) →
 * Capacitor Filesystem (Directory.Data, caros-yt/<id>.<ext>) → kalıcı indirme
 * registry'sine ekle. Çalma, mevcut native playLocalTrack({uri}) ile yapılır
 * (yerel müzik taramasına/MediaStore'a DOKUNMAZ).
 *
 * Yasal not: YouTube içeriğini indirmek YouTube ToS'a aykırıdır; bu özellik
 * yalnızca kişisel kullanım içindir ve satış paketinde yer almaz.
 */

import { resolvePipedStream, PIPED_SCHEME } from './pipedProvider';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';

/** Build-time bayrak — yalnız bu true iken indirme yolu derlemeye dahil edilir. */
export const YT_DOWNLOAD_ENABLED = import.meta.env.VITE_ENABLE_YT_DOWNLOAD === 'true';

const STORE_KEY = 'yt-downloads';
const SUBDIR = 'caros-yt';

export interface YtDownload {
  id:           string;   // videoId
  title:        string;
  artist:       string;
  fileUri:      string;   // native playLocalTrack için oynatılabilir uri
  ext:          string;   // 'm4a' | 'webm'
  bytes:        number;
  downloadedAt: number;
}

export type DownloadProgress = (loaded: number, total: number | null) => void;

/* ── Registry (kalıcı liste) ───────────────────────────────── */

function _load(): YtDownload[] {
  try {
    const raw = safeGetRaw(STORE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as YtDownload[]) : [];
  } catch {
    return [];
  }
}

function _save(list: YtDownload[]): void {
  try { safeSetRaw(STORE_KEY, JSON.stringify(list), 0, true); } catch { /* kota — yoksay */ }
}

/** İndirilmiş tüm parçalar (en yeni → en eski). */
export function getDownloads(): YtDownload[] {
  return _load().slice().sort((a, b) => b.downloadedAt - a.downloadedAt);
}

/** Bu videoId daha önce indirildi mi? */
export function isDownloaded(id: string): boolean {
  return _load().some((d) => d.id === id);
}

/** Verilen videoId'nin indirilmiş dosya uri'si (yoksa null). */
export function getDownloadUri(id: string): string | null {
  return _load().find((d) => d.id === id)?.fileUri ?? null;
}

/** `piped://<id>` stream url'inden videoId çıkarır (değilse null). */
export function videoIdFromStreamUrl(streamUrl: string | undefined): string | null {
  if (streamUrl && streamUrl.startsWith(PIPED_SCHEME)) {
    const id = streamUrl.slice(PIPED_SCHEME.length);
    return id || null;
  }
  return null;
}

/* ── Yardımcılar ───────────────────────────────────────────── */

function _blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Dosya okunamadı'));
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(',');               // "data:...;base64,XXXX"
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(blob);
  });
}

async function _writeFile(id: string, ext: string, blob: Blob): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const base64 = await _blobToBase64(blob);
  const path = `${SUBDIR}/${id}.${ext}`;
  await Filesystem.writeFile({ path, data: base64, directory: Directory.Data, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  return uri;
}

/* ── İndirme ───────────────────────────────────────────────── */

/**
 * Bir YouTube videosunun sesini cihaza indirir ve registry'e ekler.
 * Bayrak kapalıysa derhal hata atar (defansif; çağrı yolu zaten gated).
 */
export async function downloadYouTube(
  opts: { videoId: string; title: string; artist: string },
  onProgress?: DownloadProgress,
): Promise<YtDownload> {
  if (!YT_DOWNLOAD_ENABLED) throw new Error('YT indirme bu build’de kapalı.');

  const existing = _load().find((d) => d.id === opts.videoId);
  if (existing) return existing;            // idempotent

  // 1) En iyi audio stream URL'ini çöz (Piped).
  const streamUrl = await resolvePipedStream(opts.videoId);
  if (!streamUrl) throw new Error('Ses akışı çözülemedi (Piped erişilemedi / bot-engeli).');

  // 2) İndir — ReadableStream ile ilerleme raporla.
  const res = await fetch(streamUrl);
  if (!res.ok || !res.body) throw new Error(`İndirme başarısız: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); loaded += value.length; onProgress?.(loaded, total); }
  }
  const ct = res.headers.get('content-type') ?? '';
  const ext = ct.includes('webm') ? 'webm' : 'm4a';
  const blob = new Blob(chunks as BlobPart[]);

  // 3) Diske yaz + oynatılabilir uri al.
  const fileUri = await _writeFile(opts.videoId, ext, blob);

  // 4) Registry'e ekle.
  const entry: YtDownload = {
    id:           opts.videoId,
    title:        opts.title || opts.videoId,
    artist:       opts.artist || 'YouTube',
    fileUri,
    ext,
    bytes:        loaded,
    downloadedAt: Date.now(),
  };
  _save([..._load().filter((d) => d.id !== entry.id), entry]);
  return entry;
}

/** İndirmeyi siler (dosya + registry kaydı). */
export async function removeDownload(id: string): Promise<void> {
  const list = _load();
  const entry = list.find((d) => d.id === id);
  if (entry) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.deleteFile({ path: `${SUBDIR}/${id}.${entry.ext}`, directory: Directory.Data });
    } catch { /* dosya yok / silinemedi — registry'den yine de çıkar */ }
  }
  _save(list.filter((d) => d.id !== id));
}
