/**
 * Offline Tile Downloader — bölge paketi indirici.
 *
 * ── V-07: NE DÜZELDİ ───────────────────────────────────────────────────────
 * Bu modül ÜRÜNÜN ÇİZDİĞİ KAROYU İNDİRMİYORDU. Eski akış OSM'den RASTER
 * `.png` çekiyor ve Service Worker'ın onu yakalamasına güveniyordu; oysa:
 *   · ürün VEKTÖR `.pbf` çiziyor (`VITE_VECTOR_TILE_URL`),
 *   · Service Worker yalnız `/tiles/z/x/y.png` ve `tile.openstreetmap.org`
 *     yakalıyor — `.pbf` HİÇ yakalanmıyor,
 *   · vektör karoların tek deposu `CacheLRUManager` ve oraya HİÇBİR ŞEY
 *     yazılmıyordu.
 * Sonuç: "Türkiye / İstanbul / Ankara / İzmir indir" düğmeleri bayt indiriyor
 * ama harita çevrimdışı yine boş kalıyordu — indirilen veri hiç okunmuyordu.
 *
 * ── YENİ AKIŞ ──────────────────────────────────────────────────────────────
 * Karo adresi CANLI TileJSON'dan çözülür (sağlayıcı yolu sürüm damgalıdır,
 * sabitlenemez — bkz. `vectorTileTemplate`) ve karolar `CacheLRUManager`in
 * TOPLU ISITMA yolundan geçer: canlı harita isteğiyle AYNI önbellek, AYNI
 * manifest, AYNI 0-bayt koruması. İkinci depo YOK.
 *
 * ── DÜRÜSTLÜK: PAKET SÜRÜM DAMGASINA BAĞLIDIR ──────────────────────────────
 * Sağlayıcı veriyi tazeleyince eski adresler bir daha istenmez → paket ölür.
 * `packVersion` bu yüzden durumda taşınır ve panel kullanıcıya söyler.
 */

import { cacheLRUManager } from '../core/storage/CacheLRUManager';
import {
  resolveVectorTileTemplate, tileUrlFrom, type VectorTileTemplate,
} from './map/vectorTileTemplate';

/* ── Bölge tanımları ─────────────────────────────────────── */

export interface TileBbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface TileRegionPreset {
  id: string;
  name: string;
  bbox: TileBbox;
  minZoom: number;
  maxZoom: number;
}

/** Türkiye için önceden tanımlı bölge paketleri */
export const TILE_PRESETS: TileRegionPreset[] = [
  {
    id: 'turkey-overview',
    name: 'Türkiye Genel',
    bbox: { minLat: 35.8, maxLat: 42.2, minLon: 25.6, maxLon: 44.9 },
    minZoom: 5,
    maxZoom: 9,
  },
  {
    id: 'istanbul',
    name: 'İstanbul',
    bbox: { minLat: 40.8, maxLat: 41.35, minLon: 28.5, maxLon: 29.6 },
    minZoom: 10,
    maxZoom: 13,
  },
  {
    id: 'ankara',
    name: 'Ankara',
    bbox: { minLat: 39.75, maxLat: 40.15, minLon: 32.5, maxLon: 33.1 },
    minZoom: 10,
    maxZoom: 13,
  },
  {
    id: 'izmir',
    name: 'İzmir',
    bbox: { minLat: 38.2, maxLat: 38.55, minLon: 26.9, maxLon: 27.35 },
    minZoom: 10,
    maxZoom: 13,
  },
];

/* ── Tile koordinat hesabı ───────────────────────────────── */

function latLonToTileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n  = 2 ** zoom;
  const x  = Math.floor(((lon + 180) / 360) * n);
  const lr = (lat * Math.PI) / 180;
  const y  = Math.floor(((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n);
  return { x, y };
}

export interface TileCoord { z: number; x: number; y: number }

export function getTilesForPreset(preset: TileRegionPreset): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let z = preset.minZoom; z <= preset.maxZoom; z++) {
    const { x: x1, y: y1 } = latLonToTileXY(preset.bbox.maxLat, preset.bbox.minLon, z);
    const { x: x2, y: y2 } = latLonToTileXY(preset.bbox.minLat, preset.bbox.maxLon, z);
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/** Tahmini tile sayısını hesaplar (indirmeden önce göstermek için) */
export function estimateTileCount(preset: TileRegionPreset): number {
  return getTilesForPreset(preset).length;
}

/** Tahmini boyut (MB) — ortalama OSM raster tile ~14 KB. */
export function estimateSizeMB(preset: TileRegionPreset): number {
  return (estimateTileCount(preset) * 14) / 1024;
}

/**
 * Bir merkez nokta etrafında dinamik bölge paketi üretir (herhangi yer / bulunulan bölge).
 * radiusKm yarıçaplı kare bbox; metro kapsaması için varsayılan ~30 km, z10–15.
 * 1° lat ≈ 111 km; lon düzeltmesi enlem kosinüsü ile.
 */
export function buildAreaPreset(
  lat: number,
  lon: number,
  opts?: { radiusKm?: number; minZoom?: number; maxZoom?: number; id?: string; name?: string },
): TileRegionPreset {
  const radiusKm = opts?.radiusKm ?? 30;
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return {
    id:      opts?.id   ?? `area-${lat.toFixed(3)}-${lon.toFixed(3)}`,
    name:    opts?.name ?? 'Bulunduğun Bölge',
    bbox:    { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon },
    minZoom: opts?.minZoom ?? 10,
    maxZoom: opts?.maxZoom ?? 15,
  };
}

/* ── İndirme durumu ──────────────────────────────────────── */

export type DownloadStatus = 'idle' | 'downloading' | 'paused' | 'done' | 'error' | 'cancelled';

export interface DownloadState {
  status:      DownloadStatus;
  presetId:    string | null;
  presetName:  string | null;
  done:        number;
  total:       number;
  failedCount: number;
  /** Önbellekte ZATEN olan ve yeniden indirilmeyen karo sayısı. */
  skipped:     number;
  errorMsg:    string | null;
  startedAt:   number | null;
  /**
   * Paketin ait olduğu sağlayıcı veri sürümü (varsa). Sağlayıcı veriyi
   * tazeleyince bu paket ÖLÜR — kullanıcıya söylenmesi gereken gerçek budur.
   */
  packVersion: string | null;
}

const INITIAL_STATE: DownloadState = {
  status:      'idle',
  presetId:    null,
  presetName:  null,
  done:        0,
  total:       0,
  failedCount: 0,
  skipped:     0,
  errorMsg:    null,
  startedAt:   null,
  packVersion: null,
};

let _state: DownloadState = { ...INITIAL_STATE };
const _listeners = new Set<(s: DownloadState) => void>();

function push(partial: Partial<DownloadState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

export function getDownloadState(): DownloadState { return _state; }

export function subscribeDownloadState(fn: (s: DownloadState) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/* ── Aktif indirme kontrolü ──────────────────────────────── */

let _abortController: AbortController | null = null;

/** Aktif indirmeyi iptal eder */
export function cancelTileDownload(): void {
  _abortController?.abort();
  push({ status: 'cancelled' });
}

/* ── Toplu indirme ───────────────────────────────────────── */

/**
 * Bir preset bölgesi için tüm tile'ları indirir.
 * Service Worker aktifse her fetch otomatik IndexedDB'ye kaydedilir.
 * @returns İndirilen tile sayısı
 */
export async function downloadTileRegion(presetId: string): Promise<void> {
  const preset = TILE_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    push({ status: 'error', errorMsg: 'Bilinmeyen preset: ' + presetId });
    return;
  }
  return downloadTilePreset(preset);
}

/**
 * Herhangi bir bölge paketi (preset veya dinamik buildAreaPreset) için tile indirir.
 * Service Worker aktifse her fetch otomatik IndexedDB'ye kaydedilir → tam offline.
 */
export async function downloadTilePreset(preset: TileRegionPreset): Promise<void> {
  if (_state.status === 'downloading') return; // zaten çalışıyor

  _abortController = new AbortController();
  const { signal } = _abortController;

  push({
    status:      'downloading',
    presetId:    preset.id,
    presetName:  preset.name,
    done:        0,
    total:       0,
    failedCount: 0,
    skipped:     0,
    errorMsg:    null,
    startedAt:   Date.now(),
    packVersion: null,
  });

  try {
    /* ADIM 1 — ÜRÜNÜN ÇİZDİĞİ ADRESİ ÇÖZ.
       Sabit şablon YAZILAMAZ: sağlayıcı yolu sürüm damgalıdır ve damga
       değişince indirilen paket ölü adreste kalır. Çözülemezse İNDİRME
       BAŞLATILMAZ — yanlış adrese indirmek, kullanıcıya "paketin var"
       demenin en kötü biçimidir. */
    const rawUrl = (import.meta.env['VITE_VECTOR_TILE_URL'] ?? '') as string;
    let tpl: VectorTileTemplate | null = null;
    try {
      tpl = await resolveVectorTileTemplate(rawUrl, signal);
    } catch { tpl = null; }

    if (signal.aborted) { push({ status: 'cancelled' }); return; }
    if (!tpl) {
      push({
        status: 'error',
        errorMsg: 'Karo adresi çözülemedi (çevrimdışı olabilirsiniz). İndirme BAŞLATILMADI.',
      });
      return;
    }

    /* ADIM 2 — Sağlayıcının bildirdiği zoom sınırlarına SAYGI.
       Sınır dışı zoom istemek sağlayıcıdan 404 yağdırır ve paketi "başarısız"
       gösterir; oysa hata bizim isteğimizdedir. */
    const zMin = Math.max(preset.minZoom, tpl.minzoom);
    const zMax = Math.min(preset.maxZoom, tpl.maxzoom);
    if (zMin > zMax) {
      push({
        status: 'error',
        errorMsg: `Sağlayıcı bu zoom aralığını sunmuyor (z${tpl.minzoom}-${tpl.maxzoom}).`,
      });
      return;
    }

    const tiles = getTilesForPreset({ ...preset, minZoom: zMin, maxZoom: zMax });
    const urls = tiles.map(({ z, x, y }) => tileUrlFrom(tpl.template, z, x, y));

    push({ total: urls.length, packVersion: tpl.versionHint });

    /* ADIM 3 — ÜRÜNÜN OKUDUĞU DEPOYA yaz (ikinci önbellek YOK). */
    const r = await cacheLRUManager.warmUrls(urls, {
      signal,
      concurrency: 4,
      onTick: (done, total, failed) => push({ done, total, failedCount: failed }),
    });

    push({ skipped: r.skipped });

    if (signal.aborted) {
      push({ status: 'cancelled' });
    } else if (r.done > 0 && r.failed === r.done) {
      /* HİÇBİRİ inmediyse bu "tamamlandı" DEĞİLDİR — sahte başarı yasak. */
      push({ status: 'error', errorMsg: 'Hiçbir karo indirilemedi (ağ veya sağlayıcı hatası).' });
    } else {
      push({ status: 'done' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'İndirme hatası';
    push({ status: 'error', errorMsg: msg });
  } finally {
    _abortController = null;
  }
}

/* ── IndexedDB tile sayısı ───────────────────────────────── */

/** Service Worker'ın IndexedDB'sinde kaç tile olduğunu sayar */
/**
 * Önbellekteki karo sayısı.
 *
 * ⚠️ V-07'de DÜZELTİLDİ: eskiden Service Worker'ın `offline-tiles` IndexedDB'sini
 * sayıyordu — oraya artık HİÇBİR ŞEY yazılmıyor. Panel bu yüzden başarılı bir
 * paketten sonra bile **sonsuza dek 0** gösterirdi (sessiz yalan). Sayaç artık
 * karoların GERÇEKTEN durduğu deponun manifestinden okunur.
 */
export async function getCachedTileCount(): Promise<number> {
  try {
    return cacheLRUManager.getCacheStats().tileCount;
  } catch {
    return 0;
  }
}

/** Önbellekteki toplam bayt — panel "ne kadar yer kaplıyor" der. */
export async function getCachedTileBytes(): Promise<number> {
  try {
    return cacheLRUManager.getCacheStats().totalBytes;
  } catch {
    return 0;
  }
}

/**
 * Çevrimdışı karo verisini siler.
 *
 * ⚠️ V-07'de DÜZELTİLDİ: eskiden SW'nin `offline-tiles` deposunu siliyordu —
 * yani kullanıcı "sil" dediğinde GERÇEK önbellek olduğu gibi kalıyordu.
 */
export async function clearCachedTiles(): Promise<void> {
  try {
    await cacheLRUManager.clearAll();
  } catch { /* fail-soft */ }
}
