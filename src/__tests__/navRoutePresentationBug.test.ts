/**
 * navRoutePresentationBug — SAHA KUSURU: "Rota kusurlu" + "Varış bayat" + kırpılan mesafe.
 *
 * ── GÖZLENEN (gerçek Android telefon, navigasyon ekranı) ───────────────────
 * Üstte "Rota kusurlu", altta "VARIŞ BAYAT", mesafe "34…" diye kırpılmış,
 * kalan süre ve varış saati boş, haritada rota çizgisi yok.
 *
 * Bu dosya o karenin ÜÇ ayrı kök nedenini KİLİTLER. Hiçbiri "uyarıyı gizle"
 * ile çözülmez; her biri otoritenin kendi sözleşmesindeki bir hatadır.
 */
import { describe, it, expect } from 'vitest';
import { computeEta } from '../platform/navigation/core/etaModel';
import {
  evaluateNavigationHonesty,
} from '../platform/navigation/core/navigationHonestyModel';
import {
  resolveHudPresentation, HUD_STATE_LABEL,
  type HudPresentationInput,
} from '../platform/navigation/core/hudPresentationModel';
import { formatDistance } from '../platform/navigationService';

/** Rota YOKKEN store'un gerçek hâli (`routingService` INITIAL + clearRoute). */
const NO_ROUTE_STORE = {
  routeRevision: 0,
  durationRevision: -1,
  remainingRouteDurationS: null,
  durationIntegrity: 'MISSING' as const,
  durationSource: 'NONE' as const,
  remainingDistanceM: null,
  rollingAvgKmh: 0,
  stopBufferS: 0,
};

const HUD_BASE: HudPresentationInput = {
  guidanceActive: true,
  rerouting: false,
  distToTurnM: null,
  maneuverDistanceSource: 'UNKNOWN',
  arriveManeuver: false,
  gpsUsable: true,
  accuracyM: 8,
  honestyLevel: 'CLEAN',
  routeVerdictDegraded: false,
  layout: 'LANDSCAPE',
  hasLaneData: false,
  hasNextManeuver: false,
  hasManeuver: false,
  arrived: false,
};

describe('SAHA KUSURU · rota sunumu — üç kök neden', () => {
  /* ── KÖK NEDEN 1 ────────────────────────────────────────────────────────
     "Bayat" iddiası bir SÜRE DİZİSİ varken anlamlıdır: "bu süre başka rota
     sürümüne ait". Hiç rota yokken (INITIAL: rev 0, durationRev -1) süre
     dizisi de YOKTUR — o hâlde durum "bayat" değil "veri yok"tur. */
  it('rota hiç yokken ETA durumu STALE ("bayat") OLMAMALI', () => {
    const v = computeEta({ navActive: true, ...NO_ROUTE_STORE });
    expect(v.etaSeconds).toBeNull();
    /* Kilit: yanlış TEŞHİS üretilmemeli. */
    expect(v.state).not.toBe('STALE');
    expect(v.state).toBe('INSUFFICIENT_ROUTE_DATA');
  });

  it('gerçek bayatlık (süre dizisi var, revizyon uyuşmuyor) hâlâ STALE kalmalı', () => {
    const v = computeEta({
      ...NO_ROUTE_STORE,
      navActive: true,
      remainingRouteDurationS: 600,
      durationIntegrity: 'VALID',
      durationSource: 'OSRM_ANNOTATION',
      routeRevision: 7,
      durationRevision: 6,
    });
    expect(v.state).toBe('STALE');
    expect(v.etaSeconds).toBeNull();
  });

  /* ── KÖK NEDEN 2 ────────────────────────────────────────────────────────
     `honestyLevel` mesafe · ETA · rota chip'lerinin BİRLEŞİK ağırlığıdır.
     HUD onu tek bir etikete indirgerken "Rota kusurlu" diyordu — rota
     kusursuzken bile. Etiket, hükmün KAYNAĞINI yanlış gösteriyordu. */
  it('rota GEÇERLİ iken yalnız ETA kusuru "Rota kusurlu" YAZDIRMAMALI', () => {
    const verdict = evaluateNavigationHonesty({
      numbersVisible: true,
      distanceSource: 'ALONG_ROUTE',   // mesafe kusursuz
      etaState: 'STALE',               // yalnız ETA kusurlu
      etaSource: 'OSRM_ANNOTATION',
      routeVerdict: 'VALID',           // ROTA KUSURSUZ
    });
    expect(verdict.level).toBe('DEGRADED');
    expect(verdict.chips.map((c) => c.id)).toEqual(['eta']);

    const hud = resolveHudPresentation({ ...HUD_BASE, honestyLevel: verdict.level });
    /* Kilit: rota geçerliyken ekranda "Rota kusurlu" YAZMAZ. */
    expect(HUD_STATE_LABEL[hud.state]).not.toBe('Rota kusurlu');
    /* Uyarı GİZLENMEZ — dürüstlük şeridi chip'i taşımaya devam eder. */
    expect(verdict.visible).toBe(true);
  });

  it('rota gerçekten kusurluyken "Rota kusurlu" GÖRÜNMEYE devam etmeli', () => {
    const verdict = evaluateNavigationHonesty({
      numbersVisible: true,
      distanceSource: 'ALONG_ROUTE',
      etaState: 'ROUTE_MODEL',
      etaSource: 'OSRM_ANNOTATION',
      routeVerdict: 'DEGRADED',
    });
    const routeDegraded = verdict.chips.some((c) => c.id === 'route' && c.level === 'DEGRADED');
    expect(routeDegraded).toBe(true);
    const hud = resolveHudPresentation({
      ...HUD_BASE, honestyLevel: verdict.level, routeVerdictDegraded: routeDegraded });
    expect(HUD_STATE_LABEL[hud.state]).toBe('Rota kusurlu');
  });

  /* ── KÖK NEDEN 3 ────────────────────────────────────────────────────────
     `formatDistance` uzun mesafede tek ondalıkta ısrar ediyor: 1.034 km rotada
     "1034.0 km" üretiyor. Bu değer HUD hücresine sığmaz ve `truncate` onu
     "34…" hâline getirir — sahada görülen tam olarak budur. */
  it.each([
    [3_400,     '3.4 km'],    // <100 km: mevcut biçim KORUNUR
    [34_000,    '34.0 km'],   // <100 km: mevcut biçim KORUNUR
    [342_000,   '342 km'],    // >=100 km: ondalık BİLGİ TAŞIMAZ, atılır
    [1_034_000, '1034 km'],   // eski hâli "1034.0 km" = 9 karakter → kırpılırdı
  ])('%d m okunabilir ve kısa biçimlenmeli', (meters, expected) => {
    expect(formatDistance(meters)).toBe(expected);
  });

  it('metre altı eşiği korunur (davranış değişmez)', () => {
    expect(formatDistance(342)).toBe('342 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('hiçbir mesafe biçimi 8 karakteri aşmaz (HUD hücresi kırpmasın)', () => {
    for (const m of [0, 999, 1_000, 9_949, 34_000, 342_000, 1_034_000, 9_999_000]) {
      expect(formatDistance(m).length, `${m} m → ${formatDistance(m)}`).toBeLessThanOrEqual(8);
    }
  });
});
