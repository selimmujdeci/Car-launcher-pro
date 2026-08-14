/**
 * enforcementMapSource — `MapSource` sözleşmesinin İLK GERÇEK implementasyonu.
 *
 * Guardian'ın `map` yuvası bugüne kadar BOŞTU: viraj/limit/eğim/tehlike/kamera
 * dilimlerinin hiçbirinin üreticisi yoktu. Bu dosya o yuvanın YALNIZ
 * `speedCamera` dilimini doldurur — diğer dilimler hâlâ üreticisizdir ve öyle
 * olduğu LAB'da açıkça yazar (sahte "map bağlandı" izlenimi verilmez).
 *
 * Zincir: gömülü EGM paketi → `enforcementPointsSource` → burası →
 * `speedCameraAdapter` → `speedCameraWarningRule` → `guardianEngine`.
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · Ağa ÇIKMAZ (karar K5 — cihaz EGM'ye gitmez), timer kurmaz, abonelik açmaz.
 *  · Konum PULL ile okunur (snapshot), yazılmaz, loglanmaz, dışarı verilmez.
 *  · Severity/eşik KARARI vermez — hepsi `guardianEnforcementPolicy`den gelir.
 *  · `read()` ASLA throw etmez; her başarısız kapı SAYILIR (LAB kanıtı).
 *
 * ── FAIL-CLOSED KAPI SIRASI (her biri ayrı sayılır) ─────────────────────────
 *   1. Paket hazır değil            → PACKAGE_NOT_READY
 *   2. Konum yok / koordinat bozuk  → NO_LOCATION
 *   3. Fix yaşı geçersiz/ölü        → STALE_FIX
 *   4. Hız okunamıyor               → NO_SPEED
 *   5. Konum belirsizliği çok büyük → UNCERTAIN_POSITION   ← #508'in izi
 *   6. Yön güvenilmez (yavaş/yok)   → HEADING_UNAVAILABLE
 *   7. Yarıçapta ileride nokta yok  → NO_POINT_AHEAD
 * Yalnız yedisini de geçen okuma bir dilim üretir.
 */

import type { MapSource, RawMapData } from '../mapSource';
import type { RawSpeedCameraData } from '../../adapters/speedCameraAdapter';
import type { SpeedCameraType } from '../../rules/speedCameraWarningRule';
import type { EnforcementPointType } from '../../../enforcement/enforcementPointsPackage';
import {
  isEnforcementPackageReady, queryNearestEnforcementPoint,
} from '../../../enforcement/enforcementPointsSource';
import {
  GUARDIAN_ENFORCEMENT_RADIUS_M,
  GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M,
  GUARDIAN_ENFORCEMENT_AHEAD_HALF_ANGLE_DEG,
  GUARDIAN_ENFORCEMENT_MIN_HEADING_SPEED_MPS,
  GUARDIAN_ENFORCEMENT_MAX_FIX_AGE_MS,
  GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
  GUARDIAN_ENFORCEMENT_SOURCE_ID,
  GUARDIAN_ENFORCEMENT_SEVERITY,
} from '../../runtime/guardianEnforcementPolicy';
import { useUnifiedVehicleStore } from '../../../../vehicleDataLayer/UnifiedVehicleStore';

/* ══════════════════════════════════════════════════════════════════════════
 * Port sözleşmesi
 * ══════════════════════════════════════════════════════════════════════════ */

/** Yakınlık sorgusu için gereken KONUM okuması — hız kaynağından AYRI port,
 *  çünkü `GpsLocationPort` bilinçli olarak koordinat taşımaz. */
export interface EnforcementLocationSnapshot {
  readonly latitude?:        number;
  readonly longitude?:       number;
  readonly accuracyMeters?:  number;
  readonly headingDegrees?:  number;
  /** m/s (`GPSLocation.speed` sözleşmesi). */
  readonly speedMps?:        number;
  readonly timestampMs?:     number;
}

export interface EnforcementLocationPort {
  getLatestLocation(): EnforcementLocationSnapshot | undefined;
}

export interface EnforcementClock { nowMs(): number; }

export interface EnforcementMapSourceDependencies {
  port:    EnforcementLocationPort;
  clock:   EnforcementClock;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sayaçlar (LAB kanıtı — "neden hiç uyarı çıkmıyor?" sorusunun cevabı)
 * ══════════════════════════════════════════════════════════════════════════ */

export type EnforcementGateReason =
  | 'PACKAGE_NOT_READY'
  | 'NO_LOCATION'
  | 'STALE_FIX'
  | 'NO_SPEED'
  | 'UNCERTAIN_POSITION'
  | 'HEADING_UNAVAILABLE'
  | 'NO_POINT_AHEAD';

export interface EnforcementGateCounters {
  readonly readCount:            number;
  readonly emittedCount:         number;
  readonly packageNotReady:      number;
  readonly noLocation:           number;
  readonly staleFix:             number;
  readonly noSpeed:              number;
  readonly uncertainPosition:    number;
  readonly headingUnavailable:   number;
  readonly noPointAhead:         number;
  /** SON okumada düşülen kapı — hiç okunmadıysa `null`. */
  readonly lastGate:             EnforcementGateReason | null;
  /** SON ölçülen konum belirsizliği (m) — ölçülemediyse `null` (sahte 0 YOK). */
  readonly lastUncertaintyM:     number | null;
  /** SON üretilen dilimin mesafesi (m) — üretilmediyse `null`. */
  readonly lastDistanceM:        number | null;
}

let _readCount = 0;
let _emittedCount = 0;
let _packageNotReady = 0;
let _noLocation = 0;
let _staleFix = 0;
let _noSpeed = 0;
let _uncertainPosition = 0;
let _headingUnavailable = 0;
let _noPointAhead = 0;
let _lastGate: EnforcementGateReason | null = null;
let _lastUncertaintyM: number | null = null;
let _lastDistanceM: number | null = null;

export function getEnforcementGateCounters(): EnforcementGateCounters {
  return {
    readCount:          _readCount,
    emittedCount:       _emittedCount,
    packageNotReady:    _packageNotReady,
    noLocation:         _noLocation,
    staleFix:           _staleFix,
    noSpeed:            _noSpeed,
    uncertainPosition:  _uncertainPosition,
    headingUnavailable: _headingUnavailable,
    noPointAhead:       _noPointAhead,
    lastGate:           _lastGate,
    lastUncertaintyM:   _lastUncertaintyM,
    lastDistanceM:      _lastDistanceM,
  };
}

/** Test izolasyonu — ÜRÜN KODU ÇAĞIRMAZ. */
export function _resetEnforcementGateCountersForTest(): void {
  _readCount = 0; _emittedCount = 0; _packageNotReady = 0; _noLocation = 0;
  _staleFix = 0; _noSpeed = 0; _uncertainPosition = 0; _headingUnavailable = 0;
  _noPointAhead = 0; _lastGate = null; _lastUncertaintyM = null; _lastDistanceM = null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ══════════════════════════════════════════════════════════════════════════ */

function isObject<T>(v: T): v is T & Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * EGM tipi → Guardian kamera tipi. `UNKNOWN` → `'unspecified'`: noktanın
 * VARLIĞI yetkili kaynak tarafından yayımlandı (gözlem), yalnız TÜRÜ
 * belirtilmedi. `'unknown'`a çevirmek olurdu ki o "böyle bir nokta var mı
 * bilmiyorum" demektir ve gerçeği yanlış anlatırdı.
 * `PARKING` buraya HİÇ gelmez — kaynak katmanında sorgu dışı bırakılır.
 */
function toCameraType(type: EnforcementPointType): SpeedCameraType {
  switch (type) {
    case 'AVERAGE_SPEED': return 'average_speed';
    case 'RED_LIGHT':     return 'traffic_light';
    case 'PARKING':       return 'unspecified'; // ulaşılamaz — sözleşme tamlığı
    case 'UNKNOWN':
    default:              return 'unspecified';
  }
}

/**
 * Konum belirsizliğinden GÜVEN türetir (DERIVED). Noktanın VARLIĞI yetkili
 * kaynaktan gelir; belirsiz olan bizim NEREDE olduğumuzdur — bu yüzden güven
 * konum belirsizliğinin fonksiyonudur. Belirsizlik 0 → 1,0; tavanda → 0,0.
 */
function confidenceFromUncertainty(uncertaintyM: number): number {
  const ratio = uncertaintyM / GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M;
  const c = 1 - ratio;
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

function gate(reason: EnforcementGateReason): undefined {
  _lastGate = reason;
  switch (reason) {
    case 'PACKAGE_NOT_READY':   _packageNotReady++;    break;
    case 'NO_LOCATION':         _noLocation++;         break;
    case 'STALE_FIX':           _staleFix++;           break;
    case 'NO_SPEED':            _noSpeed++;            break;
    case 'UNCERTAIN_POSITION':  _uncertainPosition++;  break;
    case 'HEADING_UNAVAILABLE': _headingUnavailable++; break;
    case 'NO_POINT_AHEAD':      _noPointAhead++;       break;
  }
  return undefined;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Concrete source
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Factory DI'yı doğrular (wiring hatası → throw); üretilen `read()` HER ZAMAN
 * fail-soft'tur. Factory port'u OKUMAZ (lazy) ve hiçbir timer kurmaz.
 */
export function createEnforcementMapSource(
  deps: EnforcementMapSourceDependencies,
): MapSource {
  if (!isObject(deps) || !deps.port || typeof deps.port.getLatestLocation !== 'function') {
    throw new RangeError('createEnforcementMapSource: geçerli bir port zorunludur (getLatestLocation fonksiyonu).');
  }
  if (!deps.clock || typeof deps.clock.nowMs !== 'function') {
    throw new RangeError('createEnforcementMapSource: clock zorunludur (nowMs fonksiyonu).');
  }
  const { port, clock } = deps;

  return {
    read(): RawMapData | undefined {
      _readCount++;
      _lastUncertaintyM = null;
      _lastDistanceM = null;

      // 1) Paket hazır mı? Hazır DEĞİLSE bu "denetim yok" DEĞİL "bilinmiyor".
      if (!isEnforcementPackageReady()) return gate('PACKAGE_NOT_READY');

      // 2) Konum
      let snap: EnforcementLocationSnapshot | undefined;
      try { snap = port.getLatestLocation(); } catch { return gate('NO_LOCATION'); }
      if (!isObject(snap)) return gate('NO_LOCATION');
      if (!isFiniteNumber(snap.latitude) || !isFiniteNumber(snap.longitude)) {
        return gate('NO_LOCATION');
      }

      // 3) Fix yaşı
      let now: number;
      try { now = clock.nowMs(); } catch { return gate('STALE_FIX'); }
      if (!isFiniteNumber(now) || !isFiniteNumber(snap.timestampMs)) return gate('STALE_FIX');
      const fixAgeMs = now - snap.timestampMs;
      if (fixAgeMs < 0 || fixAgeMs > GUARDIAN_ENFORCEMENT_MAX_FIX_AGE_MS) return gate('STALE_FIX');

      // 4) Hız (belirsizlik hesabı için ZORUNLU — tahmin edilmez)
      if (!isFiniteNumber(snap.speedMps) || snap.speedMps < 0) return gate('NO_SPEED');

      // 5) Konum belirsizliği = doğruluk + hız × fix yaşı  (#508)
      const accuracyM = isFiniteNumber(snap.accuracyMeters) ? snap.accuracyMeters : NaN;
      if (!isFiniteNumber(accuracyM) || accuracyM < 0) return gate('NO_LOCATION');
      const uncertaintyM = accuracyM + snap.speedMps * (fixAgeMs / 1000);
      _lastUncertaintyM = uncertaintyM;
      if (uncertaintyM > GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M) {
        return gate('UNCERTAIN_POSITION');
      }

      // 6) Yön — düşük hızda heading gürültüdür, fail-closed.
      if (snap.speedMps < GUARDIAN_ENFORCEMENT_MIN_HEADING_SPEED_MPS) {
        return gate('HEADING_UNAVAILABLE');
      }
      if (!isFiniteNumber(snap.headingDegrees)) return gate('HEADING_UNAVAILABLE');

      // 7) Yarıçapta ileride nokta
      const hit = queryNearestEnforcementPoint({
        lat:                   snap.latitude,
        lng:                   snap.longitude,
        radiusMeters:          GUARDIAN_ENFORCEMENT_RADIUS_M,
        headingDegrees:        snap.headingDegrees,
        aheadHalfAngleDegrees: GUARDIAN_ENFORCEMENT_AHEAD_HALF_ANGLE_DEG,
      });
      if (hit === null) return gate('NO_POINT_AHEAD');

      _lastGate = null;
      _emittedCount++;
      _lastDistanceM = hit.distanceMeters;

      const speedCamera: RawSpeedCameraData = {
        // Kimlik koordinat TAŞIMAZ (gözlemlenebilirlik kuralı 6).
        id:             `${GUARDIAN_ENFORCEMENT_SOURCE_ID}:${hit.point.id}`,
        cameraType:     toCameraType(hit.point.type),
        distanceMeters: hit.distanceMeters,
        confidence:     confidenceFromUncertainty(uncertaintyM),
        source:         GUARDIAN_ENFORCEMENT_SOURCE_ID,
        policy: {
          severityByCameraType: GUARDIAN_ENFORCEMENT_SEVERITY,
          minimumConfidence:    GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
        },
      };

      // YALNIZ `speedCamera` dilimi — diğer map dilimlerinin üreticisi hâlâ YOK.
      return { speedCamera };
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gerçek servis bağlaması
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Yetkili `UnifiedVehicleStore` snapshot'ından okuyan gerçek port. Koordinat
 * BU KATMANDA KALIR: yalnız yakınlık sorgusuna girer, Guardian olayına veya
 * LAB'a taşınmaz.
 */
export function createUnifiedStoreEnforcementLocationPort(): EnforcementLocationPort {
  return {
    getLatestLocation(): EnforcementLocationSnapshot | undefined {
      const loc = useUnifiedVehicleStore.getState().location;
      if (!isObject(loc)) return undefined;
      return {
        latitude:       loc.latitude,
        longitude:      loc.longitude,
        accuracyMeters: loc.accuracy,
        headingDegrees: loc.heading,
        speedMps:       loc.speed,
        timestampMs:    loc.timestamp,
      };
    },
  };
}
