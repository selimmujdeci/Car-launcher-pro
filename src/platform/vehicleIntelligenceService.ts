/**
 * vehicleIntelligenceService.ts — Sensor Plausibility Engine — T1 + T2 + T3 + T4
 *
 * T1 — Plausibility: imkânsız sıçrama, çapraz sensör, stale PID
 * T2 — Trust 2.0: SPS/jitter bağlantı kalitesi, DCE 2.0 araç karakteri
 * T3 — Termal Bellek: dT/dt tamponu, ısı soak borcu, soğuk çalışma, soğuma verimliliği
 * T4 — Güven Ağırlıklı Sağlık (VHS 2.0):
 *      - Ham mekanik sağlık (plausibilityComponent) vs. güven ağırlıklı sağlık (trust)
 *      - Güven eşiği sertleştirmesi: SERVICE_SOON → trust > 0.8, ATTENTION → trust > 0.6
 *      - Conservative kap: trust < 0.4 → max STRESSED
 *      - 5 saniye yükseltme kilidi: anlık sensör gürültüsü tetiklemeleri önler
 *      - isDiagnosticDegraded: trust < 0.4 veya fidelity < 0.5
 *
 * MALI-400: Float32Array dairesel tamponlar + zaman damgası karşılaştırması.
 */

import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import {
  useVehicleIntelligenceStore,
  type HealthState,
  type ThermalStatus,
} from '../store/useVehicleIntelligenceStore';
import { addEvent } from './communityService';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';
import { useVidStore } from '../store/useVidStore';
import { pushTrail } from './diagnosticTrailCore';

/* ── T1/T2 sabitler ──────────────────────────────────────── */

/**
 * FAZ 14 — artık gerçek tick periyodunu BELİRLEMEZ (o karar runtimeManager
 * scheduler'ının WARM sınıfına ait: §L.0, BALANCED/PERFORMANCE ~666ms,
 * BASIC_JS ~1332ms, POWER_SAVE ~2s, SAFE_MODE ~2.66s). Yalnız _tick()'in İLK
 * çağrısında (henüz önceki tick zaman damgası yokken) `deltaMs` için makul bir
 * başlangıç varsayımı olarak kalır — bootstrap-only, kendini 2. tick'te düzeltir.
 */
const TICK_MS               = 500;
const RPM_JUMP_THRESHOLD    = 4000;
const COOLANT_JUMP_THRESHOLD= 5;
const GPS_OBD_MISMATCH_KMH = 20;
const RPM_LOAD_RPM_FLOOR    = 2000;
const STALE_THRESHOLD_MS   = 5 * 60 * 1000;
const MOVING_KMH            = 5;
const AGGR_ALPHA            = 0.12;
const ECON_ALPHA            = 0.05;
const ECO_RPM_LOW           = 1200;
const ECO_RPM_HIGH          = 2800;
const AGGR_RPM_DELTA        = 600;
const AGGR_SPD_DELTA_KMH    = -12;
const TRUST_PER_FAULT       = 0.10;
const TRUST_PER_STALE       = 0.15;

/* ── T3 sabitler ─────────────────────────────────────────── */

const TEMP_BUF_SIZE         = 120;
const DEBT_ACCUM_RATE       = 0.003;
const DEBT_CLEAR_RATE       = 0.001;
const COOLANT_COLD          = 60;
const COOLANT_WARM          = 80;
const COOLANT_HOT           = 95;
const COOLANT_DEBT_ACCUM    = 100;
const COOLANT_DEBT_CLEAR    = 90;
const COOLANT_OVERHEAT      = 110;
const COOLANT_HEAT_SOAK_DTDT= 2.0;
const COLD_START_RPM_LIMIT  = 3500;
const COOLING_IDEAL_RATE    = 5.0;
const COOLING_EFF_ALPHA     = 0.08;

/* ── T4 sabitler ─────────────────────────────────────────── */

/** Yükseltme kilidi: yeni durum bu süre boyunca tutarlıysa taahhüt edilir */
const STATE_PERSIST_MS      = 5_000;
/** SERVICE_SOON için minimum güven eşiği */
const TRUST_SERVICE_SOON    = 0.80;
/** ATTENTION için minimum güven eşiği */
const TRUST_ATTENTION       = 0.60;
/** Conservative kap eşiği — bu altında max STRESSED */
const TRUST_CONSERVATIVE    = 0.40;
/** isDiagnosticDegraded için fidelity alt sınırı */
const DIAG_FIDELITY_MIN     = 0.50;

/* ── CRM tetikleyici eşikleri ────────────────────────────── */

/** Sert fren: 500ms içinde ≥18 km/h yavaşlama (~2G deselerasyon) */
const HARD_BRAKE_KMH        = -18;
/** Çukur: 500ms içinde ≥12 km/h anlık hız sapması */
const POTHOLE_BOUNCE_KMH    = 12;
/** Sert fren olayları arasında minimum süre (ms) */
const HARD_BRAKE_COOL_MS    = 30_000;
/** Çukur olayları arasında minimum süre (ms) */
const POTHOLE_COOL_MS       = 15_000;

/* ── Sağlık durum şiddeti haritası (T4) ─────────────────── */

const HEALTH_SEVERITY: Record<HealthState, number> = {
  HEALTHY:      0,
  MONITOR:      1,
  STRESSED:     2,
  ATTENTION:    3,
  SERVICE_SOON: 4,
};

/* ── T4: Durum kalıcılık (yükseltme kilidi) ─────────────── */

let _pendingHealthState:   HealthState = 'HEALTHY';
let _pendingSinceMs:       number      = 0;
let _displayedHealthState: HealthState = 'HEALTHY';

/**
 * Yükseltme kilitleyici: daha yüksek şiddete geçiş için STATE_PERSIST_MS gerekir.
 * İyileşme (şiddet azalması) anında uygulanır — yanlış iyimserlik yok.
 */
function _applyStateHysteresis(rawState: HealthState, nowMs: number): HealthState {
  // Bekleyen durum değişti → sayacı sıfırla
  if (rawState !== _pendingHealthState) {
    _pendingHealthState = rawState;
    _pendingSinceMs     = nowMs;
  }

  const rawIdx  = HEALTH_SEVERITY[rawState];
  const dispIdx = HEALTH_SEVERITY[_displayedHealthState];

  if (rawIdx <= dispIdx) {
    // İyileşme veya aynı → anında uygula
    _displayedHealthState = rawState;
  } else if (nowMs - _pendingSinceMs >= STATE_PERSIST_MS) {
    // Yükseltme → 5s kalıcılık sağlandı, taahhüt et
    _displayedHealthState = rawState;
  }
  // Aksi hâlde: mevcut gösterilen durum korunur

  return _displayedHealthState;
}

/**
 * T4 güven eşiği sertleştirmesi:
 *   trust < TRUST_CONSERVATIVE → max STRESSED (ATTENTION/SERVICE_SOON yasak)
 *   trust ≤ TRUST_ATTENTION    → SERVICE_SOON → ATTENTION veya STRESSED
 *   trust ≤ TRUST_SERVICE_SOON → SERVICE_SOON → ATTENTION
 */
function _applyTrustCaps(state: HealthState, trust: number): HealthState {
  if (trust < TRUST_CONSERVATIVE) {
    // Conservative mod: ATTENTION ve SERVICE_SOON → STRESSED
    return HEALTH_SEVERITY[state] > HEALTH_SEVERITY['STRESSED'] ? 'STRESSED' : state;
  }
  if (state === 'SERVICE_SOON') {
    if (trust <= TRUST_SERVICE_SOON) return trust > TRUST_ATTENTION ? 'ATTENTION' : 'STRESSED';
  }
  if (state === 'ATTENTION' && trust <= TRUST_ATTENTION) {
    return 'STRESSED';
  }
  return state;
}

/* ── T4: Ham mekanik sağlık (güven ağırlığı yok) ─────────── */

/** Sadece plausibility bileşeni — bağlantı kalitesi hariç */
function _deriveHealthRaw(plausComp: number, staleCount: number): HealthState {
  if (plausComp < 0.25 || staleCount >= 3) return 'SERVICE_SOON';
  if (plausComp < 0.45 || staleCount >= 2) return 'ATTENTION';
  if (plausComp < 0.65 || staleCount >= 1) return 'STRESSED';
  if (plausComp < 0.85)                    return 'MONITOR';
  return 'HEALTHY';
}

/** Tam güven (plausibility × fidelity × jitter) */
function _deriveHealthFull(trust: number, staleCount: number): HealthState {
  if (trust < 0.25 || staleCount >= 3) return 'SERVICE_SOON';
  if (trust < 0.45 || staleCount >= 2) return 'ATTENTION';
  if (trust < 0.65 || staleCount >= 1) return 'STRESSED';
  if (trust < 0.85)                    return 'MONITOR';
  return 'HEALTHY';
}

/* ── T2: Dairesel tamponlar ──────────────────────────────── */

const BUF_SIZE   = 10;
const _jBuf      = new Float32Array(BUF_SIZE);
let   _jBufIdx   = 0;
let   _jBufFull  = false;
const _sdBuf     = new Float32Array(BUF_SIZE);
let   _sdBufIdx  = 0;
let   _sdBufFull = false;

function _pushJitter(d: number): void {
  _jBuf[_jBufIdx] = d; _jBufIdx = (_jBufIdx + 1) % BUF_SIZE;
  if (_jBufIdx === 0) _jBufFull = true;
}
function _pushSpeedDelta(d: number): void {
  _sdBuf[_sdBufIdx] = d; _sdBufIdx = (_sdBufIdx + 1) % BUF_SIZE;
  if (_sdBufIdx === 0) _sdBufFull = true;
}
function _computeJitter(): number {
  const n = _jBufFull ? BUF_SIZE : _jBufIdx;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += _jBuf[i];
  const mean = sum / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (_jBuf[i] - mean) ** 2;
  return Math.sqrt(v / n);
}
function _computeSmoothness(): number {
  const n = _sdBufFull ? BUF_SIZE : _sdBufIdx;
  if (n < 2) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += _sdBuf[i];
  const mean = sum / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (_sdBuf[i] - mean) ** 2;
  return Math.max(0, 1 - Math.sqrt(v / n) / 10);
}

/* ── T3: Sıcaklık dairesel tamponu ──────────────────────── */

/**
 * FAZ 14 NOTU: eskiden bu tampon "TEMP_BUF_SIZE ör. × TICK_MS=500ms = tam 60s
 * pencere" varsayımıyla dTdt'yi BÖLMEDEN hesaplıyordu (bkz. git geçmişi) — artık
 * scheduler WARM periyodunu moda göre ölçeklediğinden (§L.0: BALANCED ~666ms,
 * BASIC_JS ~1332ms…) bu varsayım YANLIŞ olurdu (120 örnek artık 60s değil,
 * ~80-160s). Bu yüzden her örnekle birlikte GERÇEK zaman damgası (`_tempBufTsMs`)
 * tutulur; dTdt her zaman gerçek geçen dakikaya bölünerek hesaplanır — periyot
 * ne olursa olsun °C/dakika birimi doğru kalır (sessiz zaman hatası önlenir).
 */
const _tempBuf      = new Float32Array(TEMP_BUF_SIZE);
const _tempBufTsMs  = new Float64Array(TEMP_BUF_SIZE); // her örneğin gerçek performance.now() zamanı
let   _tempBufIdx   = 0;
let   _tempBufFull  = false;

function _derivativeAndPush(currentC: number, nowMs: number): number {
  let dTdt = 0;
  if (_tempBufFull) {
    // T_now - T_(yaklaşık TEMP_BUF_SIZE örnek önce) — gerçek aradaki dakikaya bölünür
    const elapsedMin = (nowMs - _tempBufTsMs[_tempBufIdx]) / 60_000;
    dTdt = elapsedMin > 0 ? (currentC - _tempBuf[_tempBufIdx]) / elapsedMin : 0;
  } else if (_tempBufIdx >= 2) {
    const elapsedMin = (nowMs - _tempBufTsMs[0]) / 60_000;
    dTdt = elapsedMin > 0 ? (currentC - _tempBuf[0]) / elapsedMin : 0;
  }
  _tempBuf[_tempBufIdx]     = currentC;
  _tempBufTsMs[_tempBufIdx] = nowMs;
  _tempBufIdx = (_tempBufIdx + 1) % TEMP_BUF_SIZE;
  if (_tempBufIdx === 0) _tempBufFull = true;
  return dTdt;
}

/* ── T3: Termal durum ────────────────────────────────────── */

let _thermalDebt       = 0;
let _maxCoolantTrend   = 0;
let _coolingEfficiency = 0.5;
let _prevCoolantCool: number | null = null;

function _computeThermalStatus(
  coolant: number | null, dTdt: number, debt: number,
  speedKmh: number, throttle: number | null,
): ThermalStatus {
  if (coolant === null)                                            return 'COLD';
  if (coolant >= COOLANT_OVERHEAT)                                return 'OVERHEAT_RISK';
  const highLoad = throttle !== null && throttle > 60;
  if (coolant >= COOLANT_HOT && dTdt > COOLANT_HEAT_SOAK_DTDT && highLoad) return 'HEAT_SOAK';
  if (debt > 0.7)                                                 return 'HEAT_SOAK';
  if (coolant >= COOLANT_HOT && speedKmh < 10)                   return 'HEAT_SOAK';
  if (coolant >= COOLANT_WARM)                                    return 'OPTIMAL';
  if (coolant >= COOLANT_COLD)                                    return 'WARM';
  return 'COLD';
}

/* ── T2: Bağlantı kalitesi ───────────────────────────────── */

function _fidelityFromSps(sps: number): number {
  if (sps >= 5)   return 1.0;
  if (sps >= 2)   return 0.50 + (sps - 2) / 3 * 0.50;
  if (sps >= 0.5) return 0.10 + (sps - 0.5) / 1.5 * 0.40;
  return 0.10;
}
function _jitterToStability(ms: number): number { return 1 / (1 + ms / 200); }

/* ── T2: SPS ölçümü ─────────────────────────────────────── */

let _obdSampleCount  = 0;
let _lastSpsWindowMs = 0;
let _measuredSps     = 2.0;
let _unsubObd: (() => void) | null = null;
/** VID telemetri pasif aynalama aboneliği (start'ta kurulur, stop'ta temizlenir). */
let _unsubIntel: (() => void) | null = null;
/** Black Box v2 (Patch 5A) — son görülen isDiagnosticDegraded; null=henüz set edilmedi
 *  (ilk değer event üretmez). stop'ta null'a resetlenir. */
let _prevDiagDegraded: boolean | null = null;

/* ── Stale izleyici ──────────────────────────────────────── */

interface StaleEntry { lastValue: unknown; movingMsAccum: number; }
const _stale: Record<string, StaleEntry> = {};

function _trackStale(pid: string, value: unknown, isMoving: boolean, deltaMs: number): boolean {
  if (!(pid in _stale)) { _stale[pid] = { lastValue: value, movingMsAccum: 0 }; return false; }
  const e = _stale[pid];
  if (value !== e.lastValue) { e.lastValue = value; e.movingMsAccum = 0; return false; }
  if (isMoving) e.movingMsAccum += deltaMs;
  return e.movingMsAccum >= STALE_THRESHOLD_MS;
}

/* ── DCE 2.0 ─────────────────────────────────────────────── */

let _aggression    = 0;
let _economy       = 0.5;
let _prevSpdKmh    = 0;
let _prevRpmVal    = 0;
let _wasHardBraking = false;

function _computeEcoEvent(speedKmh: number, throttle: number | null, rpm: number | undefined, spdDelta: number): number {
  const isCoasting = speedKmh > MOVING_KMH && throttle !== null && throttle === 0 && (rpm ?? 0) > 800;
  const isAggrAccel = throttle !== null && throttle > 60 && speedKmh > MOVING_KMH;
  const isStopGo = _wasHardBraking && isAggrAccel;
  _wasHardBraking = spdDelta < AGGR_SPD_DELTA_KMH;
  if (isStopGo)   return 0;
  if (isCoasting) return 1;
  const inEco = rpm !== undefined && rpm >= ECO_RPM_LOW && rpm <= ECO_RPM_HIGH;
  return (speedKmh > MOVING_KMH && inEco) ? 1 : 0;
}

function _updateCharacter(speedKmh: number, rpm: number | undefined, throttle: number | null, coldStartAbuse: boolean) {
  const spdDelta = speedKmh - _prevSpdKmh;
  const rpmDelta = rpm !== undefined ? rpm - _prevRpmVal : 0;
  _pushSpeedDelta(spdDelta);
  let event = 0;
  if (rpmDelta > AGGR_RPM_DELTA)                 event = Math.max(event, 0.30);
  if (spdDelta < AGGR_SPD_DELTA_KMH)             event = Math.max(event, 0.50);
  if (rpmDelta > AGGR_RPM_DELTA && spdDelta < 0) event = 0.60;
  if (coldStartAbuse)                            event = Math.max(event, 0.40);
  _aggression = Math.max(0, Math.min(1, _aggression * (1 - AGGR_ALPHA) + event * AGGR_ALPHA));
  const ecoEvent = _computeEcoEvent(speedKmh, throttle, rpm, spdDelta);
  _economy = Math.max(0, Math.min(1, _economy * (1 - ECON_ALPHA) + ecoEvent * ECON_ALPHA));
  _prevSpdKmh = speedKmh;
  _prevRpmVal = rpm ?? _prevRpmVal;
  return {
    aggression: parseFloat(_aggression.toFixed(3)),
    smoothness: parseFloat(_computeSmoothness().toFixed(3)),
    economy:    parseFloat(_economy.toFixed(3)),
  };
}

/* ── Önceki değerler ─────────────────────────────────────── */

let _prevRpmRaw:     number | null = null;
let _prevCoolantRaw: number | null = null;

/* ── CRM cooldown izleyicileri ───────────────────────────── */

let _crmHardBrakeCoolMs = 0;
let _crmPotholeCoolMs   = 0;
let _prevSpdDeltaCrm    = 0;

/* ── Ana tick ────────────────────────────────────────────── */

let _lastTickMs = 0;

function _tick(): void {
  const vs    = useUnifiedVehicleStore.getState();
  const intel = useVehicleIntelligenceStore.getState();

  const nowMs   = performance.now();
  const deltaMs = _lastTickMs > 0 ? Math.min(nowMs - _lastTickMs, 2000) : TICK_MS;
  _lastTickMs   = nowMs;

  _pushJitter(deltaMs);

  // T2: SPS 1s penceresi
  const spsElapsed = nowMs - _lastSpsWindowMs;
  if (spsElapsed >= 1000) {
    _measuredSps = _obdSampleCount / (spsElapsed / 1000);
    _obdSampleCount = 0; _lastSpsWindowMs = nowMs;
  }

  const speedKmh = vs.speed ?? 0;
  const rpm      = vs.rpm;
  const coolant  = vs.canCoolantTemp;
  const fuel     = vs.fuel;
  const throttle = vs.canThrottle;
  const gpsMs    = vs.location?.speed ?? null;
  const gpsKmh   = gpsMs !== null ? gpsMs * 3.6 : null;
  const isMoving = speedKmh > MOVING_KMH;

  // ── 1. İmkânsız Sıçrama ──────────────────────────────────────────────
  if (rpm !== undefined && rpm !== null && _prevRpmRaw !== null) {
    const d = Math.abs(rpm - _prevRpmRaw);
    if (d > RPM_JUMP_THRESHOLD)
      intel.updatePlausibility('rpm.jump', { isValid: false, reason: `RPM Δ${d} rpm/500ms` });
    else intel.clearPlausibility('rpm.jump');
  }
  if (rpm !== undefined && rpm !== null) _prevRpmRaw = rpm;

  if (coolant !== null && _prevCoolantRaw !== null) {
    const d = Math.abs(coolant - _prevCoolantRaw);
    if (d > COOLANT_JUMP_THRESHOLD)
      intel.updatePlausibility('coolant.jump', { isValid: false, reason: `Soğutma Δ${d.toFixed(1)}°C/500ms` });
    else intel.clearPlausibility('coolant.jump');
  }
  if (coolant !== null) _prevCoolantRaw = coolant;

  // ── 2. Çapraz Sensör ─────────────────────────────────────────────────
  if (gpsKmh !== null && gpsKmh > GPS_OBD_MISMATCH_KMH && speedKmh === 0)
    intel.updatePlausibility('speed.gps_mismatch', { isValid: false, reason: `GPS ${gpsKmh.toFixed(0)} km/h ama OBD=0` });
  else intel.clearPlausibility('speed.gps_mismatch');

  const isDecelerating = speedKmh < _prevSpdKmh - 2;
  if (rpm !== undefined && rpm !== null && rpm > RPM_LOAD_RPM_FLOOR && throttle !== null && throttle === 0 && !isDecelerating)
    intel.updatePlausibility('rpm.load_mismatch', { isValid: false, reason: `RPM=${rpm} gaz=%0` });
  else intel.clearPlausibility('rpm.load_mismatch');

  // ── 3. Stale PID ─────────────────────────────────────────────────────
  const pidValues: Record<string, unknown> = {
    coolantTemp: coolant, fuel, obdSpeed: vs.speed,
    rpm: (rpm !== undefined && (rpm ?? 0) > 0) ? rpm : null,
  };
  const stalePIDs: string[] = [];
  for (const [pid, val] of Object.entries(pidValues)) {
    if (val === null || val === undefined) {
      if (pid in _stale) delete _stale[pid];
      intel.clearPlausibility(`${pid}.stale`);
      continue;
    }
    if (_trackStale(pid, val, isMoving, deltaMs)) {
      stalePIDs.push(pid);
      intel.updatePlausibility(`${pid}.stale`, { isValid: false, reason: `${pid} 5dk değişmedi` });
    } else intel.clearPlausibility(`${pid}.stale`);
  }
  intel.setStalePIDs(stalePIDs);

  // ── 4. Trust Score 2.0 ────────────────────────────────────────────────
  const report     = useVehicleIntelligenceStore.getState().plausibilityReport;
  const faultCount = Object.values(report).filter((e) => !e.isValid).length;
  const plausComp  = Math.max(0, 1.0 - faultCount * TRUST_PER_FAULT - stalePIDs.length * TRUST_PER_STALE);
  const jitterMs   = _computeJitter();
  const connFidel  = _fidelityFromSps(_measuredSps);
  const jStab      = _jitterToStability(jitterMs);
  const trust      = plausComp * connFidel * jStab;

  // ── 5. T3: Termal Bellek ──────────────────────────────────────────────
  let dTdt = 0;
  if (coolant !== null) dTdt = _derivativeAndPush(coolant, nowMs);
  if (dTdt > _maxCoolantTrend) _maxCoolantTrend = dTdt;

  if (coolant !== null && coolant > COOLANT_DEBT_ACCUM && speedKmh < 10)
    _thermalDebt = Math.min(1, _thermalDebt + DEBT_ACCUM_RATE);
  else if (coolant !== null && coolant < COOLANT_DEBT_CLEAR)
    _thermalDebt = Math.max(0, _thermalDebt - DEBT_CLEAR_RATE);

  // FAZ 14 NOTU: eskiden "* 120" (=60000ms / TICK_MS=500ms) sabit çarpanı
  // her tick'in tam 500ms sürdüğünü varsayıyordu — scheduler artık WARM
  // periyodunu moda göre ölçeklediğinden (666ms/1332ms/…) bu sabit çarpan
  // sessizce YANLIŞ °C/dk oranı üretirdi. Gerçek `deltaMs`den türetilen
  // (60000/deltaMs) oranı periyottan bağımsız doğru sonuç verir.
  if (coolant !== null && _prevCoolantCool !== null && deltaMs > 0) {
    const dropPerMin = (_prevCoolantCool - coolant) * (60_000 / deltaMs);
    if (dropPerMin > 0 && _prevCoolantCool > COOLANT_WARM) {
      const effEvent = Math.min(1, dropPerMin / COOLING_IDEAL_RATE);
      _coolingEfficiency = _coolingEfficiency * (1 - COOLING_EFF_ALPHA) + effEvent * COOLING_EFF_ALPHA;
    }
  }
  _prevCoolantCool = coolant;

  const thermalStatus  = _computeThermalStatus(coolant, dTdt, _thermalDebt, speedKmh, throttle);
  const thermalCap     = _thermalDebt > 0.7 || thermalStatus === 'HEAT_SOAK';
  const coldStartAbuse = coolant !== null && coolant < COOLANT_COLD && (rpm ?? 0) > COLD_START_RPM_LIMIT;

  // ── 6. T4: Güven Ağırlıklı Sağlık (VHS 2.0) ─────────────────────────

  // 6a. Ham mekanik sağlık (bağlantı kalitesi yok — sadece plausibility)
  let rawHealth = _deriveHealthRaw(plausComp, stalePIDs.length);
  if (thermalCap && HEALTH_SEVERITY[rawHealth] < HEALTH_SEVERITY['STRESSED']) rawHealth = 'STRESSED';
  if (coldStartAbuse && rawHealth === 'HEALTHY') rawHealth = 'MONITOR';

  // 6b. Tam güven ağırlıklı sağlık (plausibility × fidelity × jitter)
  let baseHealth = _deriveHealthFull(trust, stalePIDs.length);
  if (thermalCap && HEALTH_SEVERITY[baseHealth] < HEALTH_SEVERITY['STRESSED']) baseHealth = 'STRESSED';
  if (coldStartAbuse && baseHealth === 'HEALTHY') baseHealth = 'MONITOR';

  // 6c. T4 güven eşiği sertleştirmesi (SERVICE_SOON/ATTENTION gereksinimleri)
  const trustCapped = _applyTrustCaps(baseHealth, trust);

  // 6d. T4 yükseltme kilidi (5s kalıcılık)
  const finalHealth = _applyStateHysteresis(trustCapped, nowMs);

  // 6e. isDiagnosticDegraded: bağlantı kalitesi veya trust yetersiz
  const isDiagnosticDegraded = trust < 0.4 || connFidel < DIAG_FIDELITY_MIN;

  // ── 7. CRM Otomatik Tetikleyiciler ───────────────────────────────────
  // _prevSpdKmh burada henüz güncel olmadığı için (speedKmh'e eşitlenmedi)
  // doğru delta değerini verir — _updateCharacter sonrasında sıfır olurdu.
  const _crmSpdDelta = speedKmh - _prevSpdKmh;
  const _crmNow      = Date.now();

  if (isMoving) {
    // Sert fren: deselerasyon eşiği
    if (
      _crmSpdDelta <= HARD_BRAKE_KMH &&
      _crmNow - _crmHardBrakeCoolMs >= HARD_BRAKE_COOL_MS
    ) {
      const loc = vs.location;
      if (loc !== null && loc !== undefined) {
        addEvent('HARD_BRAKE', loc.latitude, loc.longitude, 0.8, {
          spdDeltaKmh: parseFloat(_crmSpdDelta.toFixed(1)),
        });
        _crmHardBrakeCoolMs = _crmNow;
      }
    }

    // Çukur: hız salınım imzası (ardışık zıt yönlü sıçramalar)
    if (
      Math.abs(_crmSpdDelta) >= POTHOLE_BOUNCE_KMH &&
      Math.abs(_prevSpdDeltaCrm) >= POTHOLE_BOUNCE_KMH &&
      Math.sign(_crmSpdDelta) !== Math.sign(_prevSpdDeltaCrm) &&
      _crmNow - _crmPotholeCoolMs >= POTHOLE_COOL_MS
    ) {
      const loc = vs.location;
      if (loc !== null && loc !== undefined) {
        addEvent('POTHOLE', loc.latitude, loc.longitude, 0.8, {
          bumpAmplitude: parseFloat(Math.abs(_crmSpdDelta).toFixed(1)),
        });
        _crmPotholeCoolMs = _crmNow;
      }
    }
  }

  _prevSpdDeltaCrm = _crmSpdDelta;

  // ── 8. DCE 2.0 ───────────────────────────────────────────────────────
  const character = _updateCharacter(speedKmh, rpm, throttle, coldStartAbuse);

  // ── 9. Store dispatch (toplu, minimal render) ─────────────────────────
  intel.updateTrustScore(trust);
  intel.setDiagnosticState(finalHealth, rawHealth, isDiagnosticDegraded);
  intel.setDegradation(trust < 0.4, trust >= 0.4);
  intel.setConnectionMetrics({
    samplesPerSecond:   parseFloat(_measuredSps.toFixed(2)),
    jitterMs:           parseFloat(jitterMs.toFixed(1)),
    connectionFidelity: parseFloat(connFidel.toFixed(3)),
    jitterStability:    parseFloat(jStab.toFixed(3)),
  });
  intel.setThermalMetrics({
    thermalStatus,
    thermalDebt:       parseFloat(_thermalDebt.toFixed(3)),
    coolingEfficiency: parseFloat(_coolingEfficiency.toFixed(3)),
    maxCoolantTrend:   parseFloat(_maxCoolantTrend.toFixed(2)),
    coolantTrendDtDt:  parseFloat(dTdt.toFixed(2)),
  });
  intel.updateDrivingChar(character);
  intel.incrementSampleCount();
}

/* ── Observer lifecycle ──────────────────────────────────── */

/**
 * FAZ 14 — sabit `setInterval(_tick, TICK_MS)` yerine tek tik-wheel scheduler'a
 * taşındı (§L.0, docs/CAROS_VEHICLE_INTELLIGENCE_ARCHITECTURE.md:1176-1241).
 * `_timer` artık bir `clearInterval` handle'ı DEĞİL — `scheduleTask()`'ın
 * döndürdüğü cleanup thunk. WARM sınıfı: BALANCED/PERFORMANCE'ta taban periyot
 * korunur (mod çarpanı=1 → ~666ms — eski 500ms'e yakın), BASIC_JS'te 2× yavaşlar
 * (~1332ms) — düşük-uçta CPU/ısı tasarrufu (CLAUDE.md Performans-Uyarlanabilir
 * Hibrit). `_tick()` içi tüm zaman hesapları delta-time/gerçek-zaman-damgası
 * tabanlı olduğundan (bkz. `_derivativeAndPush`, `dropPerMin` düzeltmeleri)
 * periyot değişimi sonuçların doğruluğunu bozmaz.
 */
let _timer:  (() => void) | null = null;
let _running = false;

export function startVehicleIntelligenceService(): () => void {
  if (_running) return stopVehicleIntelligenceService;
  _running = true; _lastTickMs = 0;
  _lastSpsWindowMs = performance.now(); _obdSampleCount = 0;

  // Black Box v2 — Service Lifecycle event (RAM-only, PII'siz statik etiket).
  // Guard'dan SONRA: mükerrer start erken döner → duplicate event olmaz. Fail-soft.
  try { pushTrail('boot', 'vehicle-intelligence-service:start'); } catch { /* iz servisi akışı bozmaz */ }

  _unsubObd = useUnifiedVehicleStore.subscribe((cur, prev) => {
    if (
      cur.speed          !== prev.speed          ||
      cur.rpm            !== prev.rpm            ||
      cur.fuel           !== prev.fuel           ||
      cur.canCoolantTemp !== prev.canCoolantTemp ||
      cur.canThrottle    !== prev.canThrottle
    ) _obdSampleCount++;
  });

  _tick();
  // FAZ 16 — periodMs=TICK_MS (500): BALANCED/PERFORMANCE'ta (çarpan=1) wheel
  // en yakın tike (666ms) yuvarlar — FAZ 14 delta-time analizi bu sapmanın
  // sonuçları bozmadığını zaten kanıtladı. BASIC_JS'te ×2, vs.
  _timer = runtimeManager.scheduleTask({
    id: 'vehicle-intel', periodMs: TICK_MS, criticality: 'NORMAL', fn: _tick,
  });

  // VID telemetri pasif aynalama (Sprint 4): intel store değişiminde 5 şema alanını
  // VID'ye yansıt. Shallow-guard (JSON key) yalnız gerçek değişimde yazar → mirror
  // hesabı-dışı alan (sampleCount vb.) değişse bile VID'ye gereksiz yazma yapılmaz.
  // Tek-yönlü + fail-soft: VID'den okuma yok, hata tick döngüsünü ASLA etkilemez.
  let lastMirrorKey = '';
  _unsubIntel = useVehicleIntelligenceStore.subscribe((state) => {
    // Black Box v2 (Patch 5A) — diagnostic degraded/recovered geçişleri. Mevcut
    // subscription'ı yeniden kullanır (yeni abonelik YOK); BAĞIMSIZ try/catch → mirror
    // davranışını ETKİLEMEZ. İlk değer event üretmez; yalnız gerçek geçişte statik,
    // PII'siz, fail-soft event.
    try {
      const degraded = state.isDiagnosticDegraded;
      if (_prevDiagDegraded === null) {
        _prevDiagDegraded = degraded;            // ilk gözlem → event YOK
      } else if (degraded !== _prevDiagDegraded) {
        _prevDiagDegraded = degraded;
        pushTrail('error', degraded ? 'diagnostic:degraded' : 'diagnostic:recovered');
      }
    } catch { /* iz mirror/tick akışını asla bozmaz */ }

    try {
      // 1. Extract only the 5 schema fields we want to mirror
      const trustScore = state.telemetryTrustScore;
      const healthState = state.healthState;
      const thermalStatus = state.thermalStatus;
      const isDiagnosticDegraded = state.isDiagnosticDegraded;

      // Filter plausibilityReport to failures only (isValid === false)
      const plausibilityFailures: Record<string, string> = {};
      for (const [k, v] of Object.entries(state.plausibilityReport)) {
        if (v && !v.isValid) {
          plausibilityFailures[k] = v.reason ?? 'Sensor validation failed';
        }
      }

      // 2. Generate a comparison key to check if values actually changed (shallow guard)
      const currentKey = JSON.stringify({ trustScore, healthState, thermalStatus, isDiagnosticDegraded, plausibilityFailures });
      if (currentKey === lastMirrorKey) return;
      lastMirrorKey = currentKey;

      // 3. Mirror to useVidStore (fail-soft wrapper)
      useVidStore.getState().updateTelemetryInfo({
        trustScore,
        healthState,
        thermalStatus,
        isDiagnosticDegraded,
        plausibilityFailures,
      });
    } catch {
      // fail-soft: do not impact the vehicle intelligence tick loop
    }
  });

  return stopVehicleIntelligenceService;
}

export function stopVehicleIntelligenceService(): void {
  _running = false;

  // Black Box v2 — Service Lifecycle event (RAM-only, PII'siz statik etiket). Fail-soft.
  try { pushTrail('boot', 'vehicle-intelligence-service:stop'); } catch { /* iz servisi akışı bozmaz */ }

  if (_timer !== null) { _timer(); _timer = null; }
  _unsubObd?.(); _unsubObd = null;
  // VID telemetri aynalama aboneliğini temizle (zero-leak).
  _unsubIntel?.(); _unsubIntel = null;
  // Black Box v2 (Patch 5A): degraded izleyiciyi resetle → sonraki start'ın ilk
  // değeri yeniden "ilk gözlem" (event üretmez) sayılsın.
  _prevDiagDegraded = null;

  // T1/T2 sıfırla
  _prevRpmRaw = null; _prevCoolantRaw = null; _lastTickMs = 0;
  _aggression = 0; _economy = 0.5; _prevSpdKmh = 0; _prevRpmVal = 0; _wasHardBraking = false;
  _obdSampleCount = 0; _measuredSps = 2.0;
  _jBuf.fill(0);  _jBufIdx = 0;  _jBufFull = false;
  _sdBuf.fill(0); _sdBufIdx = 0; _sdBufFull = false;
  for (const k of Object.keys(_stale)) delete _stale[k];

  // T3 sıfırla
  _thermalDebt = 0; _maxCoolantTrend = 0; _coolingEfficiency = 0.5; _prevCoolantCool = null;
  _tempBuf.fill(0); _tempBufTsMs.fill(0); _tempBufIdx = 0; _tempBufFull = false;

  // T4 sıfırla
  _pendingHealthState   = 'HEALTHY';
  _pendingSinceMs       = 0;
  _displayedHealthState = 'HEALTHY';

  // CRM cooldown sıfırla
  _crmHardBrakeCoolMs = 0;
  _crmPotholeCoolMs   = 0;
  _prevSpdDeltaCrm    = 0;
}

/* ── DEV yardımcıları ────────────────────────────────────── */

export function injectFault(pid: string): void {
  useVehicleIntelligenceStore.getState().updatePlausibility(pid, {
    isValid: false, reason: '[DEV] Simüle edilmiş sensör hatası',
  });
}

export function clearAllFaults(): void {
  useVehicleIntelligenceStore.getState().reset();
  for (const k of Object.keys(_stale)) delete _stale[k];
  _jBuf.fill(0);  _jBufIdx = 0;  _jBufFull = false;
  _sdBuf.fill(0); _sdBufIdx = 0; _sdBufFull = false;
  _tempBuf.fill(0); _tempBufTsMs.fill(0); _tempBufIdx = 0; _tempBufFull = false;
  _thermalDebt = 0; _maxCoolantTrend = 0; _coolingEfficiency = 0.5;
  _pendingHealthState = 'HEALTHY'; _pendingSinceMs = 0; _displayedHealthState = 'HEALTHY';
}
