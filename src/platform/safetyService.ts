/**
 * safetyService.ts — Safety Co-Pilot Observer (S1 + S2 + S3)
 *
 * S1 — Fren fizigi (kuru asfalt, μ=0.70):
 *   ReactionDistance = speedMs × 1.5
 *   BrakingDistance  = speedMs² / (2 × μ × g)
 *
 * S2 — Eğri güvenli hız:
 *   maneuverModifier → R (m) → v_safe = √(μ × g × R) × 3.6 (km/h)
 *   CAUTION: hız > v_safe × 0.90  |  INTERVENTION: hız > v_safe × 1.15
 *
 * S3 — Bağlamsal hız ayarı:
 *   _dynamicMu       : WMO hava koduna göre 0.25–0.70 arasında değişir
 *   contextMultiplier: tehlike riski (−%20) + DAB (−%10) faktörleri
 *   recommendedSpeedKmh = curveSafe × contextMultiplier × (1 − weatherPenalty)
 *   INTERVENTION geçişi → speakSafetyAlert() [15s soğuma, 50m dönüş arbirajı]
 */

import { useSafetyStore, type SafetyState } from '../store/useSafetyStore';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { getRouteState } from './routingService';
import { useHazardStore } from '../store/useHazardStore';
import { onWeatherState } from './weatherService';
import { speakSafetyAlert } from './ttsService';

/* ── Fizik sabitleri ─────────────────────────────────────── */

const FRICTION_MU_DRY    = 0.70;  // kuru asfalt referans μ
const GRAVITY_G          = 9.8;   // m/s²
const REACTION_S         = 1.5;   // saniye
const BRAKING_CRITICAL_M = 80;    // ~100 km/h eşdeğeri
const MIN_ACTIVE_KMH     = 5;

/* ── S2: Eğri yarıçapı lookup (metre) ───────────────────── */

const TURN_RADIUS_M: Record<string, number> = {
  'straight':     Infinity,
  'slight right': 250,
  'slight left':  250,
  'right':         60,
  'left':          60,
  'sharp right':   25,
  'sharp left':    25,
  'uturn':          8,
};

const CURVE_WARN_AHEAD_M = 300;   // ileriye bakış ufku (m)
const CAUTION_TRIGGER    = 0.90;  // v_safe × bu oran → CAUTION giriş
const CAUTION_RESET      = 0.78;  // v_safe × bu oran → CAUTION çıkış
const INTV_TRIGGER       = 1.15;  // v_safe × bu oran → INTERVENTION giriş
const INTV_RESET         = 1.00;  // v_safe × bu oran → INTERVENTION çıkış

/* ── S3: Sesli uyarı parametreleri ──────────────────────── */

const INTV_ALERT_COOLDOWN_MS = 15_000;  // aynı event için yeniden uyarı süresi
const TURN_PRIORITY_M        = 50;      // bu mesafeden yakın dönüşte ses atlanır

/* ── Tick hysteresis (S1) ────────────────────────────────── */

const HYSTERESIS_M = 0.5;
let _prevBrakingM  = 0;
let _prevReactionM = 0;

/* ── S3: Dinamik durum ───────────────────────────────────── */

let _dynamicMu:          number     = FRICTION_MU_DRY;
let _weatherSpeedPenalty: number    = 0;          // 0.0–0.40
let _prevSafetyState:    SafetyState = 'CALM';
let _intvLastAlertMs:    number     = 0;
let _unsubWeather:       (() => void) | null = null;

/* ── Observer lifecycle ──────────────────────────────────── */

let _timer:   ReturnType<typeof setInterval> | null = null;
let _running  = false;

/* ── S3: WMO hava kodu → μ + hız cezası ─────────────────── */

/**
 * Open-Meteo WMO kod tablosundan sürtünme ve hız cezasını günceller.
 * Kurallar kuru / yağmurlu / karlı / sisli yol araştırmalarına dayanır.
 */
function _applyWeatherCode(code: number): void {
  if      (code >= 95)                 { _dynamicMu = 0.35; _weatherSpeedPenalty = 0.35; } // fırtına
  else if (code >= 85)                 { _dynamicMu = 0.25; _weatherSpeedPenalty = 0.40; } // karlı sağanak
  else if (code >= 80)                 { _dynamicMu = 0.40; _weatherSpeedPenalty = 0.25; } // şiddetli sağanak
  else if (code >= 71)                 { _dynamicMu = 0.25; _weatherSpeedPenalty = 0.40; } // kar
  else if (code >= 63)                 { _dynamicMu = 0.40; _weatherSpeedPenalty = 0.25; } // orta-yoğun yağmur
  else if (code >= 61)                 { _dynamicMu = 0.50; _weatherSpeedPenalty = 0.20; } // hafif yağmur
  else if (code >= 51)                 { _dynamicMu = 0.55; _weatherSpeedPenalty = 0.15; } // çiseleme
  else if (code === 48 || code === 45) { _dynamicMu = 0.55; _weatherSpeedPenalty = 0.15; } // sis
  else                                 { _dynamicMu = FRICTION_MU_DRY; _weatherSpeedPenalty = 0; }
}

/* ── S2: Eğri güvenli hız hesabı ────────────────────────── */

function _curveSafeKmh(modifier: string): number | null {
  const R = TURN_RADIUS_M[modifier];
  if (R === undefined || !Number.isFinite(R)) return null;
  // _dynamicMu: ıslak/karlı yolda daha küçük → daha düşük güvenli hız
  return Math.sqrt(_dynamicMu * GRAVITY_G * R) * 3.6;
}

/* ── Ana tick ────────────────────────────────────────────── */

function _tick(): void {
  const speed   = useUnifiedVehicleStore.getState().speed ?? 0; // km/h
  const speedMs = speed / 3.6;

  // S1 + S3: dinamik μ ile fren mesafesi
  const reaction = speedMs * REACTION_S;
  const braking  = (speedMs * speedMs) / (2 * _dynamicMu * GRAVITY_G);

  // Hysteresis: önemsiz değişimlerde store güncellenmez
  if (
    Math.abs(reaction - _prevReactionM) < HYSTERESIS_M &&
    Math.abs(braking  - _prevBrakingM)  < HYSTERESIS_M
  ) return;

  _prevReactionM = reaction;
  _prevBrakingM  = braking;

  // S3: bağlamsal çarpan — tehlike + sürücü dikkat bütçesi
  const { globalRiskScore, driverAttentionBudget } = useHazardStore.getState();
  let contextMultiplier = 1.0;
  if (globalRiskScore > 0.4)       contextMultiplier *= 0.80; // tehlike: -%20
  if (driverAttentionBudget < 0.4) contextMultiplier *= 0.90; // DAB: -%10
  const totalMultiplier = contextMultiplier * (1.0 - _weatherSpeedPenalty);

  // S2 + S3: eğri tespiti ve durum makinesi
  let state: SafetyState = 'CALM';
  let recommendedSpeed   = speed;

  if (speed > MIN_ACTIVE_KMH) {
    state = 'ATTENTIVE';

    const { distanceToNextTurnMeters, steps, currentStepIndex } = getRouteState();
    const step = steps[currentStepIndex];

    if (step && distanceToNextTurnMeters > 0 && distanceToNextTurnMeters <= CURVE_WARN_AHEAD_M) {
      const rawSafe = _curveSafeKmh(step.maneuverModifier);
      if (rawSafe !== null) {
        // S3: bağlam + hava ayarlı güvenli hız
        recommendedSpeed = rawSafe * totalMultiplier;

        const cautionTrigger = recommendedSpeed * CAUTION_TRIGGER;
        const cautionReset   = recommendedSpeed * CAUTION_RESET;
        const intvTrigger    = recommendedSpeed * INTV_TRIGGER;
        const intvReset      = recommendedSpeed * INTV_RESET;

        // Hysteresis durum makinesi — önceki duruma göre geçiş kararı
        if (_prevSafetyState === 'INTERVENTION') {
          state = speed > intvReset    ? 'INTERVENTION' : 'CAUTION';
        } else if (_prevSafetyState === 'CAUTION') {
          if      (speed > intvTrigger)     state = 'INTERVENTION';
          else if (speed >= cautionTrigger)  state = 'CAUTION';
          else if (speed <  cautionReset)    state = 'ATTENTIVE';
          else                               state = 'CAUTION'; // hold band
        } else {
          if      (speed > intvTrigger)    state = 'INTERVENTION';
          else if (speed > cautionTrigger)  state = 'CAUTION';
        }
      }
    } else if (totalMultiplier < 1.0) {
      // Eğri yok — bağlam kötü (hava/tehlike): mevcut hız üzerine çarpan uygula
      recommendedSpeed = speed * totalMultiplier;
    }

    // S3: INTERVENTION geçişi → sesli uyarı
    if (state === 'INTERVENTION' && _prevSafetyState !== 'INTERVENTION') {
      const now = Date.now();
      if (now - _intvLastAlertMs > INTV_ALERT_COOLDOWN_MS) {
        // Arbitraj: yakın dönüş talimatı varsa (< 50m) sesi atla — nav öncelikli
        const turnImminent = distanceToNextTurnMeters > 0
          && distanceToNextTurnMeters <= TURN_PRIORITY_M;
        if (!turnImminent) {
          _intvLastAlertMs = now;
          speakSafetyAlert('Dikkat! Yavaşlayın.');
        }
      }
    }
  }

  _prevSafetyState = state;

  useSafetyStore.getState().setSafetyMetrics({
    safetyState:         state,
    brakingDistanceM:    braking,
    reactionDistanceM:   reaction,
    recommendedSpeedKmh: recommendedSpeed,
    isBrakingCritical:   braking > BRAKING_CRITICAL_M,
  });
}

/* ── Dışa açık API ───────────────────────────────────────── */

/**
 * Safety Observer'ı başlat.
 * Hava durumu aboneliği de burada açılır.
 * İdempotent — zaten çalışıyorsa yoksayılır.
 */
export function startSafetyObserver(): void {
  if (_running) return;
  _running = true;
  // S3: hava durumu değişikliklerini dinle → _dynamicMu güncelle
  _unsubWeather = onWeatherState((ws) => {
    if (ws.weather) _applyWeatherCode(ws.weather.code);
    else { _dynamicMu = FRICTION_MU_DRY; _weatherSpeedPenalty = 0; }
  });
  _tick();
  _timer = setInterval(_tick, 200);
}

/**
 * Safety Observer'ı durdur ve tüm state'i sıfırla.
 */
export function stopSafetyObserver(): void {
  _running = false;
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
  _unsubWeather?.(); _unsubWeather = null;
  _prevBrakingM        = 0;
  _prevReactionM       = 0;
  _prevSafetyState     = 'CALM';
  _dynamicMu           = FRICTION_MU_DRY;
  _weatherSpeedPenalty = 0;
  _intvLastAlertMs     = 0;
  useSafetyStore.getState().setSafetyMetrics({
    safetyState:         'CALM',
    brakingDistanceM:    0,
    reactionDistanceM:   0,
    recommendedSpeedKmh: 0,
    isBrakingCritical:   false,
  });
}

/** Toplam güvenli durma mesafesi (metre) — UI yardımcısı. */
export function getTotalSafeDistanceM(): number {
  const { brakingDistanceM, reactionDistanceM } = useSafetyStore.getState();
  return brakingDistanceM + reactionDistanceM;
}
