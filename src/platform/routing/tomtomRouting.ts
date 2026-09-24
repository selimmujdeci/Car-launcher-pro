/**
 * tomtomRouting — TomTom Routing API (Calculate Route v1) istemcisi ve çözücüsü.
 *
 * NEDEN: herkese açık OSRM sunucuları trafiği bilmez (ETA hep trafiksiz) ve
 * ticari kullanıma uygun değildir. TomTom `traffic=true` ile canlı trafiğe göre
 * rota ve süre verir.
 *
 * ÇIKARILABİLİRLİK (kullanıcı kararı 2026-09-24): TomTom ücretlidir; satışta
 * kaldırılabilir. Bu modül YALNIZ `VITE_TOMTOM_API_KEY` tanımlıyken devreye
 * girer; anahtar yoksa routingService bugünkü OSRM zincirini aynen kullanır.
 * Kaldırmak için anahtarı silmek yeter (kod da tek dosya + tek çağrı yeridir).
 *
 * TEK DÖNÜŞÜM NOKTASI KORUNUR: TomTom talimatları, routingService'in zaten
 * anladığı OSRM adım biçimine (tip/değiştirici/ad/ref/tabela/geometri) çevrilir;
 * Türkçe cümle, tabela yönü ve manevra çapaları mevcut kodla üretilir.
 *
 * DÜRÜSTLÜK:
 *  · Segment süreleri TomTom'un talimat noktalarındaki GERÇEK (trafikli)
 *    kümülatif sürelerinden türetilir: iki talimat arası süre, aradaki
 *    segmentlere mesafe oranıyla dağıtılır. Sabit hız UYDURULMAZ.
 *  · Ücretli yol TomTom `TOLL` bölümünden okunur (sezgisel değil).
 *  · Şerit verisi istenmez → `lanes` yok (UI şerit göstermez).
 */

export const TOMTOM_ROUTING_SERVER = 'tomtom:routing';

/** routingService `OsrmStep` ile YAPISAL olarak uyumlu adım. */
export interface TomTomOsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  destinations?: string;
  maneuver: { type: string; modifier?: string; exit?: number };
  geometry: { coordinates: [number, number][] };
}

export interface TomTomRoute {
  geometry: [number, number][];            // [lon, lat]
  distance: number;                         // m
  duration: number;                         // sn (trafik dahil)
  trafficDelayS: number;
  hasToll: boolean;
  steps: TomTomOsrmStep[];
  /** geometry.length − 1 uzunlukta segment süreleri; türetilemezse null. */
  annotationDurations: number[] | null;
}

interface TtInstruction {
  routeOffsetInMeters?: number;
  travelTimeInSeconds?: number;
  pointIndex?: number;
  maneuver?: string;
  street?: string;
  roadNumbers?: string[];
  signpostText?: string;
  roundaboutExitNumber?: number;
  turnAngleInDecimalDegrees?: number;
}

/** Rota tanımına katkısı olmayan bilgi talimatları — adım ÜRETMEZ. */
const _INFO_ONLY = new Set(['FOLLOW', 'WAYPOINT_REACHED', 'WAYPOINT_LEFT', 'WAYPOINT_RIGHT', 'WAYPOINT_AHEAD']);

function _side(angle: number | undefined, fallback: 'left' | 'right' | null): 'left' | 'right' | null {
  if (typeof angle === 'number' && Number.isFinite(angle) && angle !== 0) return angle > 0 ? 'right' : 'left';
  return fallback;
}

/**
 * TomTom manevra kodu → OSRM tip/değiştirici. Tanınmayan kod UYDURULMAZ:
 * tip olarak aynen taşınır ve Türkçe katman onu nötr "Devam edin" yapar.
 */
export function tomtomManeuverToOsrm(
  maneuver: string, angle?: number,
): { type: string; modifier: string } {
  const m = maneuver.toUpperCase();
  switch (m) {
    case 'DEPART':        return { type: 'depart', modifier: 'straight' };
    case 'ARRIVE':        return { type: 'arrive', modifier: 'straight' };
    case 'ARRIVE_LEFT':   return { type: 'arrive', modifier: 'left' };
    case 'ARRIVE_RIGHT':  return { type: 'arrive', modifier: 'right' };
    case 'STRAIGHT':      return { type: 'continue', modifier: 'straight' };
    case 'KEEP_LEFT':     return { type: 'fork', modifier: 'slight left' };
    case 'KEEP_RIGHT':    return { type: 'fork', modifier: 'slight right' };
    case 'BEAR_LEFT':     return { type: 'turn', modifier: 'slight left' };
    case 'BEAR_RIGHT':    return { type: 'turn', modifier: 'slight right' };
    case 'TURN_LEFT':     return { type: 'turn', modifier: 'left' };
    case 'TURN_RIGHT':    return { type: 'turn', modifier: 'right' };
    case 'SHARP_LEFT':    return { type: 'turn', modifier: 'sharp left' };
    case 'SHARP_RIGHT':   return { type: 'turn', modifier: 'sharp right' };
    case 'MAKE_UTURN':
    case 'TRY_MAKE_UTURN': return { type: 'turn', modifier: 'uturn' };
    case 'ROUNDABOUT_CROSS': return { type: 'roundabout', modifier: 'straight' };
    case 'ROUNDABOUT_LEFT':  return { type: 'roundabout', modifier: 'left' };
    case 'ROUNDABOUT_RIGHT': return { type: 'roundabout', modifier: 'right' };
    /* Dönel kavşakta tam tur = geri dönüş → "U dönüşü yapın". */
    case 'ROUNDABOUT_BACK':  return { type: 'roundabout', modifier: 'uturn' };
    case 'MOTORWAY_EXIT_LEFT':  return { type: 'off ramp', modifier: 'slight left' };
    case 'MOTORWAY_EXIT_RIGHT': return { type: 'off ramp', modifier: 'slight right' };
    case 'TAKE_EXIT': {
      const s = _side(angle, null);
      return { type: 'off ramp', modifier: s ? `slight ${s}` : 'straight' };
    }
    case 'ENTRANCE_RAMP': {
      const s = _side(angle, null);
      return { type: 'on ramp', modifier: s ? `slight ${s}` : 'straight' };
    }
    case 'ENTER_MOTORWAY':
    case 'ENTER_FREEWAY':
    case 'ENTER_HIGHWAY': {
      const s = _side(angle, null);
      return { type: 'merge', modifier: s ? `slight ${s}` : 'straight' };
    }
    case 'SWITCH_PARALLEL_ROAD':
    case 'SWITCH_MAIN_ROAD':  return { type: 'continue', modifier: 'straight' };
    case 'TAKE_FERRY':        return { type: 'notification', modifier: 'straight' };
    default:                  return { type: m.toLowerCase(), modifier: 'straight' };
  }
}

function _hav(a: [number, number], b: [number, number]): number {
  const R = 6_371_000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Talimat noktalarındaki kümülatif süreleri segmentlere dağıtır.
 * Düğümler (pointIndex, t) kesin monoton değilse ya da geometriyi
 * kapsamıyorsa `null` (fail-closed → ETA modeli yedeğe düşer).
 */
export function segmentDurationsFromKnots(
  geometry: readonly [number, number][],
  knots: readonly { idx: number; t: number }[],
): number[] | null {
  const n = geometry.length - 1;
  if (n < 1 || knots.length < 2) return null;
  if (knots[0].idx !== 0 || knots[knots.length - 1].idx !== n) return null;
  const out = new Array<number>(n).fill(0);
  for (let k = 0; k + 1 < knots.length; k++) {
    const a = knots[k], b = knots[k + 1];
    if (!(b.idx >= a.idx) || !(b.t >= a.t)) return null;
    const dt = b.t - a.t;
    if (b.idx === a.idx) { if (dt > 0) return null; continue; }
    let len = 0;
    for (let i = a.idx; i < b.idx; i++) len += _hav(geometry[i], geometry[i + 1]);
    for (let i = a.idx; i < b.idx; i++) {
      out[i] = len > 0 ? dt * (_hav(geometry[i], geometry[i + 1]) / len) : dt / (b.idx - a.idx);
    }
  }
  return out;
}

/** Tek TomTom rotasını çözer; kullanılamazsa `null`. */
export function parseTomTomRoute(raw: unknown): TomTomRoute | null {
  const r = raw as {
    summary?: { lengthInMeters?: number; travelTimeInSeconds?: number; trafficDelayInSeconds?: number };
    legs?: Array<{ points?: Array<{ latitude?: number; longitude?: number }> }>;
    sections?: Array<{ sectionType?: string }>;
    guidance?: { instructions?: TtInstruction[] };
  } | null;
  if (!r || !r.summary || !Array.isArray(r.legs)) return null;
  const distance = r.summary.lengthInMeters;
  const duration = r.summary.travelTimeInSeconds;
  if (typeof distance !== 'number' || typeof duration !== 'number') return null;

  const geometry: [number, number][] = [];
  for (const leg of r.legs) {
    for (const p of leg.points ?? []) {
      if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return null;
      geometry.push([p.longitude, p.latitude]);
    }
  }
  if (geometry.length < 2) return null;
  const last = geometry.length - 1;

  const ins = (r.guidance?.instructions ?? []).filter((i) =>
    typeof i.pointIndex === 'number' && i.pointIndex >= 0 && i.pointIndex <= last && typeof i.maneuver === 'string');

  const knots = ins
    .filter((i) => typeof i.travelTimeInSeconds === 'number')
    .map((i) => ({ idx: i.pointIndex as number, t: i.travelTimeInSeconds as number }));
  const annotationDurations = segmentDurationsFromKnots(geometry, knots);

  const man = ins.filter((i) => !_INFO_ONLY.has((i.maneuver as string).toUpperCase()));
  const steps: TomTomOsrmStep[] = man.map((i, k) => {
    const next = man[k + 1];
    const from = i.pointIndex as number;
    const to = next ? (next.pointIndex as number) : from;
    const { type, modifier } = tomtomManeuverToOsrm(i.maneuver as string, i.turnAngleInDecimalDegrees);
    const refs = (i.roadNumbers ?? []).filter((x) => typeof x === 'string' && x.trim());
    return {
      distance: next ? Math.max(0, (next.routeOffsetInMeters ?? 0) - (i.routeOffsetInMeters ?? 0)) : 0,
      duration: next ? Math.max(0, (next.travelTimeInSeconds ?? 0) - (i.travelTimeInSeconds ?? 0)) : 0,
      name: (i.street ?? '').trim(),
      ...(refs.length ? { ref: refs.join(', ') } : {}),
      ...(i.signpostText ? { destinations: i.signpostText } : {}),
      maneuver: {
        type, modifier,
        ...(typeof i.roundaboutExitNumber === 'number' ? { exit: i.roundaboutExitNumber } : {}),
      },
      geometry: { coordinates: geometry.slice(from, to + 1) },
    };
  });
  if (steps.length === 0) return null;

  return {
    geometry, distance, duration,
    trafficDelayS: r.summary.trafficDelayInSeconds ?? 0,
    hasToll: (r.sections ?? []).some((s) => s.sectionType === 'TOLL'),
    steps,
    annotationDurations,
  };
}

/** Calculate Route isteği URL'i. Anahtar kodlanır; yön yalnız biliniyorsa gönderilir. */
export function tomtomRouteUrl(
  key: string,
  fromLat: number, fromLon: number, toLat: number, toLon: number,
  headingDeg?: number | null,
): string {
  const q = new URLSearchParams({
    key, traffic: 'true', travelMode: 'car', routeType: 'fastest',
    maxAlternatives: '2', instructionsType: 'coded', language: 'tr-TR',
  });
  q.append('sectionType', 'toll');
  if (headingDeg != null && Number.isFinite(headingDeg)) {
    q.set('vehicleHeading', String(((Math.round(headingDeg) % 360) + 360) % 360));
  }
  const pts = `${fromLat.toFixed(6)},${fromLon.toFixed(6)}:${toLat.toFixed(6)},${toLon.toFixed(6)}`;
  return `https://api.tomtom.com/routing/1/calculateRoute/${pts}/json?${q.toString()}`;
}

/**
 * Rotaları getirir. HTTP/ağ/zaman aşımı hatası FIRLATILIR (çağıran sonraki
 * sağlayıcıya geçer); zaman aşımı `TOMTOM_TIMEOUT` olarak işaretlenir —
 * OSRM'in `HEADERS_TIMEOUT` sinyaliyle KARIŞMAZ.
 */
export async function fetchTomTomRoutes(
  key: string,
  fromLat: number, fromLon: number, toLat: number, toLon: number,
  headingDeg: number | null | undefined,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<TomTomRoute[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(tomtomRouteUrl(key, fromLat, fromLon, toLat, toLon, headingDeg), { signal: ctrl.signal });
    } catch (e) {
      throw ctrl.signal.aborted ? new Error('TOMTOM_TIMEOUT') : (e as Error);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { routes?: unknown[] };
    const routes = (data.routes ?? []).map(parseTomTomRoute).filter((x): x is TomTomRoute => x !== null);
    if (routes.length === 0) throw new Error('NO_ROUTES');
    return routes;
  } finally {
    clearTimeout(timer);
  }
}
