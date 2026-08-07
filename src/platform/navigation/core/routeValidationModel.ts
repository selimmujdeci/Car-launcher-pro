/**
 * routeValidationModel.ts — Sağlayıcıdan gelen rotanın SAF kalite/güvenlik kapısı.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Bugüne kadar `routes[0]` KOŞULSUZ kabul ediliyordu; tek denetim başlangıç
 * noktasının 2000 m'den uzak olmamasıydı (o da koordinat takası yakalamak
 * için). Yani sağlayıcı aracı karşı şeride yapıştırıp ilk manevra olarak
 * sahte bir U dönüşü ürettiğinde ürünün bunu FARK EDECEK hiçbir mekanizması
 * yoktu — kullanıcının "saçma yoldan götürüyor" şikâyetinin ikinci kökü budur.
 *
 * ── DÜRÜSTLÜK KURALI ────────────────────────────────────────────────────────
 * Kanıtı OLMAYAN denetim `UNKNOWN` döner; "geçti" SAYILMAZ. Örneğin yol
 * sınıfı / yasak segment verisi OSRM yanıtında güvenilir biçimde yoktur →
 * o denetim UNKNOWN kalır, uydurma "servis yolu kullanımı düşük" ÜRETİLMEZ.
 */

import { hav, segmentBearingDeg, angularDeltaDeg } from './geo';

export type RouteVerdict = 'VALID' | 'DEGRADED' | 'REJECTED' | 'UNKNOWN';
export type CheckStatus  = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export type RouteCheckId =
  | 'STALE_REQUEST' | 'GEOMETRY' | 'ORIGIN_PROXIMITY' | 'START_HEADING'
  | 'REACHES_DESTINATION' | 'METRICS_SANE' | 'DETOUR_RATIO'
  | 'EARLY_UTURN' | 'UTURN_COUNT' | 'SHARP_TURN_BURST' | 'INITIAL_BACKTRACK'
  | 'ROAD_CLASS_MIX';

export interface RouteCheck {
  readonly id: RouteCheckId;
  readonly status: CheckStatus;
  /** Sınırlı, ölçülebilir açıklama — serbest yorum değil. */
  readonly detail: string;
}

export interface ValidationStep {
  readonly maneuverType: string;
  readonly maneuverModifier: string;
  readonly distance: number;
  /** [lon, lat] */
  readonly coordinate: readonly [number, number];
}

export interface RouteCandidate {
  readonly geometry: readonly [number, number][];
  readonly distanceM: number;
  readonly durationS: number;
  readonly steps: readonly ValidationStep[];
}

export interface RouteValidationInput {
  readonly candidate: RouteCandidate;
  readonly originLat: number;
  readonly originLon: number;
  readonly destLat: number;
  readonly destLon: number;
  /** Aracın güvenilen yönü; bilinmiyorsa null (durakta yön gürültüdür). */
  readonly vehicleHeadingDeg: number | null;
  /** İstek yaşam döngüsü bunu bayat işaretlediyse rota UYGULANMAZ. */
  readonly isStaleRequest: boolean;
  /** Sağlayıcı yol sınıfı kanıtı verdi mi (yoksa ilgili denetim UNKNOWN). */
  readonly hasRoadClassEvidence?: boolean;
}

export interface RouteValidationResult {
  readonly verdict: RouteVerdict;
  readonly checks: readonly RouteCheck[];
  readonly failCount: number;
  readonly warnCount: number;
  readonly unknownCount: number;
}

/* ── Eşikler ──────────────────────────────────────────────────────────────── */

/** Rota başlangıcı araçtan bu kadar uzaksa şüpheli, bunun 5 katıysa reddedilir. */
export const ORIGIN_WARN_M = 200;
export const ORIGIN_FAIL_M = 1_000;
/** Rota sonu hedeften bu kadar uzaksa hedefe ULAŞMIYOR demektir. */
export const DEST_WARN_M = 120;
export const DEST_FAIL_M = 500;
/** İlk segment yönü ile araç yönü farkı. */
export const START_HEADING_WARN_DEG = 90;
export const START_HEADING_FAIL_DEG = 150;
/** Bu mesafe içindeki U dönüşü "ters şeride yapışma" işaretidir. */
export const EARLY_UTURN_M = 150;
export const MAX_UTURNS = 2;
/** Art arda keskin dönüş bu aralıktan yakınsa şüpheli. */
export const SHARP_PAIR_M = 40;
/** Kuş uçuşuna oran — altında anlamsız olduğu için ölçülmez. */
export const DETOUR_MIN_CROW_M = 300;
export const DETOUR_WARN_RATIO = 3.0;
export const DETOUR_FAIL_RATIO = 6.0;
/** Ardışık geometri noktaları arası makul üst sınır (m). */
export const MAX_POINT_GAP_M = 5_000;
/** Mantıklı ortalama hız aralığı (km/h). */
export const AVG_SPEED_MIN_KMH = 3;
export const AVG_SPEED_MAX_KMH = 200;
/** Başlangıçta hedeften bu kadar uzaklaşmak "geriye yönlendirme"dir. */
export const BACKTRACK_PROBE_M = 300;
export const BACKTRACK_WARN_M = 150;

function _check(id: RouteCheckId, status: CheckStatus, detail: string): RouteCheck {
  return { id, status, detail };
}

/** Rota üzerinde `targetM` metre ilerideki noktayı döner (yoksa son nokta). */
function _pointAtDistance(
  geometry: readonly [number, number][], targetM: number,
): [number, number] {
  let acc = 0;
  for (let i = 0; i < geometry.length - 1; i++) {
    const d = hav(geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0]);
    if (acc + d >= targetM) return geometry[i + 1] as [number, number];
    acc += d;
  }
  return geometry[geometry.length - 1] as [number, number];
}

/**
 * Rotayı doğrular. Hiçbir yan etkisi yoktur; yalnız hüküm üretir.
 * `REJECTED` bir rota navigation state'e UYGULANMAMALIDIR.
 */
export function validateRoute(input: RouteValidationInput): RouteValidationResult {
  const checks: RouteCheck[] = [];
  const { candidate: c } = input;

  // ── 0) Bayat istek — başka hiçbir denetime gerek yok ──────────────────────
  if (input.isStaleRequest) {
    checks.push(_check('STALE_REQUEST', 'FAIL', 'Yanıt güncel olmayan bir istekten geldi'));
    return _verdict(checks);
  }
  checks.push(_check('STALE_REQUEST', 'PASS', 'Yanıt en güncel isteğe ait'));

  // ── 1) Geometri geçerliliği ───────────────────────────────────────────────
  const g = c.geometry;
  if (!g || g.length < 2) {
    checks.push(_check('GEOMETRY', 'FAIL', `nokta=${g?.length ?? 0} (en az 2 gerekir)`));
    return _verdict(checks);
  }
  let badPoint = false;
  let maxGap = 0;
  for (let i = 0; i < g.length; i++) {
    const [lon, lat] = g[i];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180) { badPoint = true; break; }
    if (i > 0) {
      const gap = hav(g[i - 1][1], g[i - 1][0], lat, lon);
      if (gap > maxGap) maxGap = gap;
    }
  }
  if (badPoint) {
    checks.push(_check('GEOMETRY', 'FAIL', 'geçersiz koordinat içeriyor'));
    return _verdict(checks);
  }
  checks.push(maxGap > MAX_POINT_GAP_M
    ? _check('GEOMETRY', 'WARN', `en büyük nokta aralığı ${Math.round(maxGap)} m`)
    : _check('GEOMETRY', 'PASS', `${g.length} nokta, en büyük aralık ${Math.round(maxGap)} m`));

  // ── 2) Başlangıç araca yakın mı ───────────────────────────────────────────
  const dOrigin = hav(input.originLat, input.originLon, g[0][1], g[0][0]);
  checks.push(
    dOrigin > ORIGIN_FAIL_M ? _check('ORIGIN_PROXIMITY', 'FAIL', `${Math.round(dOrigin)} m`)
    : dOrigin > ORIGIN_WARN_M ? _check('ORIGIN_PROXIMITY', 'WARN', `${Math.round(dOrigin)} m`)
    : _check('ORIGIN_PROXIMITY', 'PASS', `${Math.round(dOrigin)} m`));

  // ── 3) İlk segment aracın yönüyle uyumlu mu ───────────────────────────────
  // Bu denetim "sahte U dönüşü / karşı şeride yapışma" sınıfının doğrudan ölçüsüdür.
  if (input.vehicleHeadingDeg == null || !Number.isFinite(input.vehicleHeadingDeg)) {
    checks.push(_check('START_HEADING', 'UNKNOWN', 'araç yönü bilinmiyor (durakta yön gürültüdür)'));
  } else {
    const startBearing = segmentBearingDeg(g[0][1], g[0][0], g[1][1], g[1][0]);
    const delta = angularDeltaDeg(input.vehicleHeadingDeg, startBearing);
    checks.push(
      delta > START_HEADING_FAIL_DEG ? _check('START_HEADING', 'FAIL', `${Math.round(delta)}° ters`)
      : delta > START_HEADING_WARN_DEG ? _check('START_HEADING', 'WARN', `${Math.round(delta)}° fark`)
      : _check('START_HEADING', 'PASS', `${Math.round(delta)}° fark`));
  }

  // ── 4) Hedefe ulaşıyor mu ─────────────────────────────────────────────────
  const last = g[g.length - 1];
  const dDest = hav(last[1], last[0], input.destLat, input.destLon);
  checks.push(
    dDest > DEST_FAIL_M ? _check('REACHES_DESTINATION', 'FAIL', `son nokta hedeften ${Math.round(dDest)} m`)
    : dDest > DEST_WARN_M ? _check('REACHES_DESTINATION', 'WARN', `son nokta hedeften ${Math.round(dDest)} m`)
    : _check('REACHES_DESTINATION', 'PASS', `son nokta hedeften ${Math.round(dDest)} m`));

  // ── 5) Mesafe / süre mantıklı mı ──────────────────────────────────────────
  if (!(c.distanceM > 0) || !(c.durationS > 0)) {
    checks.push(_check('METRICS_SANE', 'FAIL',
      `mesafe=${c.distanceM} m süre=${c.durationS} s (pozitif olmalı)`));
  } else {
    const avgKmh = (c.distanceM / c.durationS) * 3.6;
    checks.push(
      (avgKmh < AVG_SPEED_MIN_KMH || avgKmh > AVG_SPEED_MAX_KMH)
        ? _check('METRICS_SANE', 'WARN', `ima edilen ortalama ${avgKmh.toFixed(1)} km/h`)
        : _check('METRICS_SANE', 'PASS', `ima edilen ortalama ${avgKmh.toFixed(1)} km/h`));
  }

  // ── 6) Sapma oranı — "kısa yol dururken absürt uzun rota" ────────────────
  const crow = hav(input.originLat, input.originLon, input.destLat, input.destLon);
  if (crow < DETOUR_MIN_CROW_M) {
    checks.push(_check('DETOUR_RATIO', 'UNKNOWN', `kuş uçuşu ${Math.round(crow)} m — oran anlamsız`));
  } else {
    const ratio = c.distanceM / crow;
    checks.push(
      ratio > DETOUR_FAIL_RATIO ? _check('DETOUR_RATIO', 'FAIL', `${ratio.toFixed(2)}×`)
      : ratio > DETOUR_WARN_RATIO ? _check('DETOUR_RATIO', 'WARN', `${ratio.toFixed(2)}×`)
      : _check('DETOUR_RATIO', 'PASS', `${ratio.toFixed(2)}×`));
  }

  // ── 7) U dönüşleri ────────────────────────────────────────────────────────
  let uturns = 0;
  let earlyUturn = false;
  let travelled = 0;
  for (const st of c.steps) {
    const isU = st.maneuverModifier === 'uturn' || st.maneuverType === 'uturn';
    if (isU) {
      uturns++;
      if (travelled <= EARLY_UTURN_M) earlyUturn = true;
    }
    travelled += Number.isFinite(st.distance) ? st.distance : 0;
  }
  checks.push(earlyUturn
    ? _check('EARLY_UTURN', 'WARN', `ilk ${EARLY_UTURN_M} m içinde U dönüşü — ters şeride yapışma işareti`)
    : _check('EARLY_UTURN', 'PASS', 'başlangıçta U dönüşü yok'));
  checks.push(uturns > MAX_UTURNS
    ? _check('UTURN_COUNT', 'WARN', `${uturns} U dönüşü`)
    : _check('UTURN_COUNT', 'PASS', `${uturns} U dönüşü`));

  // ── 8) Çok kısa aralıkta art arda keskin dönüş ────────────────────────────
  let sharpBurst = 0;
  for (let i = 0; i < c.steps.length - 1; i++) {
    const a = c.steps[i], b = c.steps[i + 1];
    const aSharp = a.maneuverModifier.startsWith('sharp');
    const bSharp = b.maneuverModifier.startsWith('sharp');
    if (aSharp && bSharp && a.distance < SHARP_PAIR_M) sharpBurst++;
  }
  checks.push(sharpBurst > 0
    ? _check('SHARP_TURN_BURST', 'WARN', `${sharpBurst} kez ${SHARP_PAIR_M} m altında ardışık keskin dönüş`)
    : _check('SHARP_TURN_BURST', 'PASS', 'ardışık keskin dönüş yığını yok'));

  // ── 9) Başlangıçta hedeften uzaklaşma (mantıksız geriye yönlendirme) ─────
  if (crow < DETOUR_MIN_CROW_M || c.distanceM < BACKTRACK_PROBE_M) {
    checks.push(_check('INITIAL_BACKTRACK', 'UNKNOWN', 'rota/kuş uçuşu ölçüm için çok kısa'));
  } else {
    const probe = _pointAtDistance(g, BACKTRACK_PROBE_M);
    const dAfter = hav(probe[1], probe[0], input.destLat, input.destLon);
    const away = dAfter - crow;
    checks.push(away > BACKTRACK_WARN_M
      ? _check('INITIAL_BACKTRACK', 'WARN',
          `ilk ${BACKTRACK_PROBE_M} m'de hedeften ${Math.round(away)} m uzaklaşıyor`)
      : _check('INITIAL_BACKTRACK', 'PASS',
          `ilk ${BACKTRACK_PROBE_M} m'de hedefe ${Math.round(-away)} m yaklaşıyor`));
  }

  // ── 10) Yol sınıfı karışımı — KANIT YOKSA UYDURMA ────────────────────────
  checks.push(input.hasRoadClassEvidence
    ? _check('ROAD_CLASS_MIX', 'UNKNOWN',
        'sağlayıcı sınıf verisi taşıyor ama segment-başı eşleme bu turda BAĞLANMADI')
    : _check('ROAD_CLASS_MIX', 'UNKNOWN',
        'yol sınıfı kanıtı yok — servis yolu/ara sokak oranı ÖLÇÜLEMEZ'));

  return _verdict(checks);
}

function _verdict(checks: readonly RouteCheck[]): RouteValidationResult {
  let failCount = 0, warnCount = 0, unknownCount = 0, passCount = 0;
  for (const c of checks) {
    if (c.status === 'FAIL') failCount++;
    else if (c.status === 'WARN') warnCount++;
    else if (c.status === 'UNKNOWN') unknownCount++;
    else passCount++;
  }
  const verdict: RouteVerdict =
    failCount > 0 ? 'REJECTED'
    : warnCount > 0 ? 'DEGRADED'
    : passCount > 0 ? 'VALID'
    : 'UNKNOWN';
  return { verdict, checks, failCount, warnCount, unknownCount };
}

/**
 * İki rota adayı arasında seçim — DAHA AZ kusurlu olan kazanır.
 * Eşitlikte kısa süreli tercih edilir (sağlayıcının kendi sıralaması korunur).
 * `REJECTED` adaylar hiç seçilmez; hepsi reddedilmişse `null`.
 */
export function pickBestRoute(
  results: readonly { candidate: RouteCandidate; validation: RouteValidationResult }[],
): { index: number; candidate: RouteCandidate; validation: RouteValidationResult } | null {
  let bestIdx = -1;
  let bestKey: [number, number, number] | null = null;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.validation.verdict === 'REJECTED') continue;
    const key: [number, number, number] = [
      r.validation.failCount,
      r.validation.warnCount,
      r.candidate.durationS > 0 ? r.candidate.durationS : Number.MAX_SAFE_INTEGER,
    ];
    if (bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])) {
      bestKey = key; bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return { index: bestIdx, candidate: results[bestIdx].candidate, validation: results[bestIdx].validation };
}

export const ROUTE_VERDICT_LABEL: Readonly<Record<RouteVerdict, string>> = {
  VALID:    'GEÇERLİ',
  DEGRADED: 'KUSURLU (uygulandı)',
  REJECTED: 'REDDEDİLDİ',
  UNKNOWN:  'DOĞRULANMADI',
} as const;
