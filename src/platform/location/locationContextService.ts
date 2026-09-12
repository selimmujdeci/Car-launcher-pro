/**
 * locationContextService — Mavi'nin konum bağlamı runtime katmanı.
 *
 * Saf modeli (`locationContextModel`) MEVCUT kaynaklara bağlar. Bu dosya
 * HİÇBİR ŞEY ÖLÇMEZ ve HİÇBİR ŞEY YAZMAZ.
 *
 * ── YENİDEN KULLANILAN ZİNCİR (yeni sahip YOK) ────────────────────────────
 *  · Fix          → `gpsService.getGPSState()`        (tek GPS sahibi)
 *  · Sınıflandırma→ `currentLocationCore.classifyLocationFix` (mevcut saf çekirdek)
 *  · Yer adı      → `geocodingService.reverseGeocodeParts` (aynı uç, aynı ToS kapısı)
 *  · DR kanıtı    → `navigationSessionRuntime` anlık görüntüsü (PR-451a, SALT-OKUMA)
 *
 * ── NEDEN ÖNBELLEK ────────────────────────────────────────────────────────
 * Mavi'nin bağlam kurucusu (`buildInterpretedVehicleContext`) SENKRONdur ve
 * yedi ayrı yerden çağrılır; reverse geocode ise AĞ çağrısıdır. Bu yüzden:
 *   · fix · sınıf · DR · kaynak · güven → HER OKUMADA senkron ve TAZE,
 *   · yalnız YER ADI önbellekten gelir ve okuma TALEBİ yenilemeyi tetikler.
 * Böylece Mavi "nerede olduğunu bilmiyor olsa bile" BİLİP BİLMEDİĞİNİ ve ne
 * kadar güvendiğini DAİMA doğru bilir.
 *
 * YENİ ZAMANLAYICI YOK: yenileme talep-tetiklidir (Mavi turu), periyodik değil.
 */

import {
  buildLocationContext, UNAVAILABLE_LOCATION_CONTEXT,
  type LocationContext, type LocationPlaceParts, type FixClass, type DrEvidence,
} from './locationContextModel';
import { classifyLocationFix } from './currentLocationCore';
import { _registerLocationContextReader } from './locationContextAccess';

/** Yer adı bu yaştan sonra yeniden çözülür (adres yavaş değişir). */
const PLACE_TTL_MS = 90_000;
/** Bu mesafeden fazla hareket edildiyse yer adı bayattır (m). */
const PLACE_MOVE_M = 400;
/** Reverse geocode bütçesi — `currentLocationService` ile AYNI. */
const GEOCODE_BUDGET_MS = 3_000;

interface PlaceCache {
  readonly parts: LocationPlaceParts;
  readonly lat: number;
  readonly lon: number;
  readonly atMs: number;
}

let _place: PlaceCache | null = null;
let _inFlight = false;
let _started = false;

/** Kaba mesafe (m) — kısa aralıklarda haversine ile farkı ihmal edilebilir. */
function _distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const M_PER_DEG = 111_320;
  const cosLat = Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const dLat = (bLat - aLat) * M_PER_DEG;
  const dLon = (bLon - aLon) * M_PER_DEG * cosLat;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Yer adını arka planda tazele — bounded, tek uçuş, fail-soft.
 * Sonuç GELMEZSE önbellek DEĞİŞMEZ (sahte yer adı üretilmez).
 */
function _refreshPlace(lat: number, lon: number): void {
  if (_inFlight) return;
  _inFlight = true;
  /* Ağır modüller TEMBEL yüklenir — Mavi'nin bağlam grafiğine girmesinler. */
  void (async () => {
    try {
      const { reverseGeocodeParts } = await import('../geocodingService');
      const parts = await reverseGeocodeParts(lat, lon, GEOCODE_BUDGET_MS);
      if (parts) _place = { parts, lat, lon, atMs: Date.now() };
    } catch { /* ağ/parse — önbellek korunur, uydurma YOK */ } finally {
      _inFlight = false;
    }
  })();
}

/** DR kanıtını PR-451a anlık görüntüsünden OKU (değiştirme YOK). */
function _readDr(): DrEvidence | null {
  try {
    /* Senkron erişim için modül önbelleği kullanılır; ilk çağrıda `null` döner
       ve bir sonraki okumada dolar — sahte DR kanıtı ÜRETİLMEZ. */
    const mod = _navRuntimeMod;
    if (!mod) { void _loadNavRuntime(); return null; }
    const s = mod.getNavigationSessionRuntimeSnapshot();
    return {
      active: s.drState === 'DR_ACTIVE' && s.drTimerRunning,
      confidence: s.drConfidence,
    };
  } catch {
    return null;
  }
}

type NavRuntimeMod = typeof import('../navigation/navigationSessionRuntime');
let _navRuntimeMod: NavRuntimeMod | null = null;
let _navLoading = false;
async function _loadNavRuntime(): Promise<void> {
  if (_navRuntimeMod || _navLoading) return;
  _navLoading = true;
  try {
    _navRuntimeMod = await import('../navigation/navigationSessionRuntime');
  } catch { /* fail-soft — DR kanıtı olmadan da bağlam üretilir */ } finally {
    _navLoading = false;
  }
}

type GpsMod = typeof import('../gpsService');
let _gpsMod: GpsMod | null = null;
let _gpsLoading = false;
async function _loadGps(): Promise<void> {
  if (_gpsMod || _gpsLoading) return;
  _gpsLoading = true;
  try {
    _gpsMod = await import('../gpsService');
  } catch { /* fail-soft */ } finally {
    _gpsLoading = false;
  }
}

/**
 * Konum bağlamını SENKRON oku.
 *
 * Kanıt yoksa `unavailable` döner — konum ASLA uydurulmaz.
 */
export function getLocationContext(): LocationContext {
  try {
    if (!_gpsMod) { void _loadGps(); return UNAVAILABLE_LOCATION_CONTEXT; }
    const gps = _gpsMod.getGPSState();
    const loc = gps.location;

    const cls = classifyLocationFix(loc, Date.now());
    const fixClass = cls.klass as FixClass;
    const fix = cls.fix ?? null;

    /* Yer adı: koordinat varsa tazeliğini denetle ve gerekiyorsa YENİLEMEYİ
       tetikle. Fix hiç yoksa ağa ÇIKILMAZ (boşuna istek yok). */
    let place: LocationPlaceParts | null = null;
    if (fix) {
      const c = _place;
      const stale = c === null
        || (Date.now() - c.atMs) > PLACE_TTL_MS
        || _distM(c.lat, c.lon, fix.latitude, fix.longitude) > PLACE_MOVE_M;
      if (stale) _refreshPlace(fix.latitude, fix.longitude);
      /* Bayat olsa bile ELDEKİ yer adı kullanılır: konum kabaca doğrudur ve
         model bunu zaten `estimated`/güven ile niteler. */
      if (c) place = c.parts;
    }

    return buildLocationContext({
      fixClass,
      ageMs: fix ? fix.ageMs : null,
      accuracyM: fix ? fix.accuracyM : null,
      place,
      dr: _readDr(),
    });
  } catch {
    return UNAVAILABLE_LOCATION_CONTEXT;
  }
}

/* ── Yaşam döngüsü ────────────────────────────────────────── */

/**
 * İdempotent. Okuyucuyu ince kapıya KAYDEDER ve ağır modülleri ısıtır.
 * Abonelik/timer KURMAZ.
 */
export function startLocationContext(): void {
  if (_started) return;
  _started = true;
  try { _registerLocationContextReader(getLocationContext); } catch { /* fail-soft */ }
  void _loadGps();
  void _loadNavRuntime();
}

/** Kaydı geri alır — sökülmüş servis bayat okuma sunmasın. */
export function stopLocationContext(): void {
  if (!_started) return;
  _started = false;
  try { _registerLocationContextReader(null); } catch { /* ignore */ }
}

/** Gözlem yüzeyi (LAB) — kayıt ayakta mı. */
export function isLocationContextRunning(): boolean {
  return _started;
}

/** @internal testler için — önbelleği ve modül tutamaklarını sıfırlar. */
export function _resetLocationContextForTest(): void {
  _place = null;
  _inFlight = false;
  _navRuntimeMod = null;
  _gpsMod = null;
}
