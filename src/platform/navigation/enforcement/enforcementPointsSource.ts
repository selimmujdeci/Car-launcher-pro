/**
 * enforcementPointsSource — denetim noktası paketinin TEK okuma katmanı.
 *
 * Paketi BİR KEZ yükler (`ensureEnforcementPointsLoaded`), doğrular, indeksler
 * ve bundan sonra tüm sorgular SENKRONDUR. Guardian tik gövdesi ağa ÇIKMAZ.
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · Import-time yan etki YOK: modül yüklenince hiçbir fetch/timer başlamaz.
 *    Yükleme yalnız açıkça çağrılınca olur (SystemBoot/Guardian wiring).
 *  · Tek uçuş (single-flight): eşzamanlı çağrılar AYNI promise'i paylaşır;
 *    aynı paket iki kez indirilmez.
 *  · Zero-leak: timer/abonelik/listener kurulmaz, yeniden deneme döngüsü YOK.
 *    Yükleme düşerse durum `UNAVAILABLE` kalır ve NEDENİ saklanır.
 *  · Cihaz EGM'ye GİTMEZ (karar K5): okunan şey uygulamaya GÖMÜLÜ pakettir.
 *
 * ── DÜRÜSTLÜK ───────────────────────────────────────────────────────────────
 * Yüklenmemiş/bozuk/boş paket → `UNAVAILABLE`. "0 nokta" ASLA "denetim yok"
 * anlamına gelmez ve öyle sunulmaz.
 */

import {
  parseEnforcementPackage, buildEnforcementIndex, findNearestEnforcementPoint,
  filterDrivingRelevantPoints, queryEnforcementPointsInRadius,
  type EnforcementPackage, type EnforcementIndex, type EnforcementHit,
  type EnforcementQuery, type EnforcementRejectReason,
  type EnforcementRadiusHit,
} from './enforcementPointsPackage';

/** Uygulamaya gömülü paketin yolu (public/ altından servis edilir). */
export const ENFORCEMENT_PACKAGE_URL = '/data/enforcement-points.tr.json';

/** Yükleme durumu — "denendi mi" ile "başarılı mı" AYRI tutulur. */
export type EnforcementLoadState = 'IDLE' | 'LOADING' | 'READY' | 'FAILED';

/** Yükleme düştüyse SINIFI (mesaj/URL TAŞINMAZ). */
export type EnforcementFailureKind =
  | 'FETCH_ERROR'
  | 'HTTP_ERROR'
  | 'JSON_ERROR'
  | EnforcementRejectReason;

export interface EnforcementSourceStatus {
  readonly loadState:          EnforcementLoadState;
  /** Paketin ÜRETİLME anı (ISO) — yoksa `null`. Cihazın "şimdi"si DEĞİL. */
  readonly fetchedAt:          string | null;
  /** Paketteki toplam nokta — hazır DEĞİLSE `null` (sahte 0 YASAK). */
  readonly pointCount:         number | null;
  /** Yakınlık sorgusuna FİİLEN giren nokta sayısı (park ihlali elenir).
   *  `pointCount` ile arasındaki fark sessiz kalmasın diye AYRI gösterilir. */
  readonly queryablePointCount: number | null;
  readonly typeCounts:         Readonly<Record<string, number>> | null;
  readonly sourceId:           string | null;
  readonly schemaVersion:      number | null;
  /** Ayrıştırmada elenen bozuk kayıt sayısı — hazır değilse `null`. */
  readonly droppedPointCount:  number | null;
  readonly failureKind:        EnforcementFailureKind | null;
  /** Yüklemenin BİTTİĞİ an (epoch ms, duvar saati) — hiç bitmediyse `null`. */
  readonly loadedAtWallMs:     number | null;
  /** Yükleme süresi (ms) — ölçülmediyse `null`. */
  readonly loadDurationMs:     number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Modül durumu (tek sahip)
 * ══════════════════════════════════════════════════════════════════════════ */

let _loadState: EnforcementLoadState = 'IDLE';
let _pkg: EnforcementPackage | null = null;
let _index: EnforcementIndex | null = null;
let _droppedPointCount: number | null = null;
let _failureKind: EnforcementFailureKind | null = null;
let _loadedAtWallMs: number | null = null;
let _loadDurationMs: number | null = null;
let _inFlight: Promise<void> | null = null;

/* Sorgu sayaçları — LAB bu katmanın FİİLEN kullanılıp kullanılmadığını görsün. */
let _queryCount = 0;
let _hitCount = 0;

function _nowWall(): number {
  try { return Date.now(); } catch { return 0; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yükleme
 * ══════════════════════════════════════════════════════════════════════════ */

async function _load(url: string): Promise<void> {
  const startedAt = _nowWall();
  _loadState = 'LOADING';
  _failureKind = null;

  let text: string;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      _loadState = 'FAILED';
      _failureKind = 'HTTP_ERROR';
      return;
    }
    text = await res.text();
  } catch {
    _loadState = 'FAILED';
    _failureKind = 'FETCH_ERROR';
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    _loadState = 'FAILED';
    _failureKind = 'JSON_ERROR';
    return;
  }

  const parsed = parseEnforcementPackage(raw);
  if (parsed.pkg === null) {
    _loadState = 'FAILED';
    _failureKind = parsed.reason;
    _droppedPointCount = parsed.droppedPointCount;
    return;
  }

  _pkg = parsed.pkg;
  _index = buildEnforcementIndex(filterDrivingRelevantPoints(parsed.pkg.points));
  _droppedPointCount = parsed.droppedPointCount;
  _loadState = 'READY';
  _loadedAtWallMs = _nowWall();
  _loadDurationMs = Math.max(0, _loadedAtWallMs - startedAt);
}

/**
 * Paketi bir kez yükler. Tekrar çağrılırsa: yükleme sürüyorsa AYNI promise,
 * bitmişse hemen dönen promise. ASLA throw etmez — hata durumu `getStatus()`
 * üzerinden okunur (çağıran fail-soft'tur).
 */
export function ensureEnforcementPointsLoaded(
  url: string = ENFORCEMENT_PACKAGE_URL,
): Promise<void> {
  if (_loadState === 'READY' || _loadState === 'FAILED') return Promise.resolve();
  if (_inFlight !== null) return _inFlight;
  _inFlight = _load(url).finally(() => { _inFlight = null; });
  return _inFlight;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Senkron okuma ucu
 * ══════════════════════════════════════════════════════════════════════════ */

/** Paket hazır mı — "yüklendi" ile "kullanılabilir" AYNI şeydir yalnız burada. */
export function isEnforcementPackageReady(): boolean {
  return _loadState === 'READY' && _index !== null;
}

/** Salt-okunur durum. Her getter kendi try/catch'i içinde — LAB'ın tek ucu. */
export function getEnforcementSourceStatus(): EnforcementSourceStatus {
  try {
    const ready = _loadState === 'READY' && _pkg !== null;
    return {
      loadState:         _loadState,
      fetchedAt:         ready ? (_pkg as EnforcementPackage).fetchedAt : null,
      pointCount:        ready ? (_pkg as EnforcementPackage).count : null,
      queryablePointCount: ready && _index !== null ? _index.points.length : null,
      typeCounts:        ready ? (_pkg as EnforcementPackage).typeCounts : null,
      sourceId:          ready ? (_pkg as EnforcementPackage).sourceId : null,
      schemaVersion:     ready ? (_pkg as EnforcementPackage).schemaVersion : null,
      droppedPointCount: _droppedPointCount,
      failureKind:       _failureKind,
      loadedAtWallMs:    _loadedAtWallMs,
      loadDurationMs:    _loadDurationMs,
    };
  } catch {
    return {
      loadState: 'FAILED', fetchedAt: null, pointCount: null,
      queryablePointCount: null, typeCounts: null,
      sourceId: null, schemaVersion: null, droppedPointCount: null,
      failureKind: 'FETCH_ERROR', loadedAtWallMs: null, loadDurationMs: null,
    };
  }
}

/** Kaç sorgu yapıldı / kaçı nokta buldu — katmanın CANLI olduğunun kanıtı. */
export function getEnforcementQueryCounters(): { queryCount: number; hitCount: number } {
  return { queryCount: _queryCount, hitCount: _hitCount };
}

/**
 * En yakın denetim noktası — SENKRON. Paket hazır değilse `null` döner ve bu
 * "denetim yok" DEĞİL "bilinmiyor" demektir (çağıran ayrımı `isEnforcementPackageReady`
 * ile yapar). ASLA throw etmez.
 */
export function queryNearestEnforcementPoint(query: EnforcementQuery): EnforcementHit | null {
  if (_index === null) return null;
  try {
    _queryCount++;
    const hit = findNearestEnforcementPoint(_index, query);
    if (hit !== null) _hitCount++;
    return hit;
  } catch {
    return null; // fail-soft: sorgu hatası Guardian'ı devirmez
  }
}

/**
 * Yarıçaptaki denetim noktaları — SENKRON (F6).
 *
 * **`null` = paket hazır DEĞİL (ölçülmedi)** · `[]` = ölçüldü, bu yarıçapta
 * nokta YOK. İkisi KARIŞTIRILMAZ — "0 nokta" ASLA "denetim yok" demek değildir.
 *
 * Yön kapısı UYGULAMAZ (bkz. `queryEnforcementPointsInRadius`): "önümde mi"
 * kararı F6'da yol koridorunundur, kuş uçuşu koninin değil. Bu fonksiyon
 * hiçbir şey BAŞLATMAZ ve ASLA throw etmez.
 */
export function queryEnforcementPointsNear(
  lat: number, lng: number, radiusMeters: number,
): readonly EnforcementRadiusHit[] | null {
  if (_index === null) return null;
  try {
    _queryCount++;
    const hits = queryEnforcementPointsInRadius(_index, lat, lng, radiusMeters);
    if (hits.length > 0) _hitCount++;
    return hits;
  } catch {
    return null; // fail-soft: sorgu hatası ufku/Guardian'ı devirmez
  }
}

/** Test izolasyonu — ÜRÜN KODU ÇAĞIRMAZ. */
export function _resetEnforcementSourceForTest(): void {
  _loadState = 'IDLE';
  _pkg = null;
  _index = null;
  _droppedPointCount = null;
  _failureKind = null;
  _loadedAtWallMs = null;
  _loadDurationMs = null;
  _inFlight = null;
  _queryCount = 0;
  _hitCount = 0;
}
