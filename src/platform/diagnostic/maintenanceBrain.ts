/**
 * MaintenanceBrain — Predictive Maintenance Engine  (U-2 / U-2.1)
 *
 * İki metrik hesaplar:
 *
 *   healthScore (0–100):
 *     Kümülatif motor aşınması. Hiçbir bakımla sıfırlanmaz.
 *     RPM stresi, termik stres ve motor yükü zamana yayılarak birikir.
 *     Eşik dinamik: araç tipi + motor hacmine göre ölçeklenir (U-2.1).
 *     < 40 → MAINTENANCE_REQUIRED olayı yayılır.
 *
 *   oilLife (0–100%):
 *     Son yağ değişiminden km bazlı doğrusal düşüş ×  wear çarpanı.
 *     Long-life yağlar %20 daha dirençli → çarpan bölünür (U-2.1).
 *
 * Kalibrasyon girdileri (U-2.1):
 *   VehicleProfile.idleRpm       → RPM sıfır noktası (varsayılan 700)
 *   VehicleProfile.normalTemp    → Termik ceza başlangıcı (varsayılan 90°C)
 *   VehicleProfile.oilType       → Yağ dayanıklılık çarpanı
 *   VehicleProfile.initialWearOffset → İkinci el araç başlangıç aşınması
 *   VehicleProfile.vehicleType   → EV/ICE ömür faktörü
 *   VehicleProfile.engineCapacityL  → Motor hacmi ömür faktörü
 *
 * Kalıcılık:
 *   safeStorage → 'car-health-data' (30s debounced; kapanışta flush)
 *
 * Zaman kaynağı:
 *   performance.now() delta (CLAUDE.md §4: saat zıplamalarına bağımsız).
 */

import { useState, useEffect }                      from 'react';
import { onOBDData }                                from '../obdService';
import { onTripState }                              from '../tripLogService';
import { useStore, type VehicleProfile, type OilType } from '../../store/useStore';
import { safeSetRaw, safeGetRaw }                   from '../../utils/safeStorage';
import { dispatchMaintenanceRequired }              from '../vehicleDataLayer';
import { runtimeManager }                           from '../../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode }                              from '../../core/runtime/runtimeTypes';

/* ── Sabitler ────────────────────────────────────────────────── */

const STORAGE_KEY       = 'car-health-data';
const SAVE_DEBOUNCE_MS  = 30_000;  // 30 s — eMMC write protection
const DEFAULT_OIL_KM    = 10_000;  // km — yapılandırılmamışsa
const DEFAULT_MAX_RPM   =  6_000;
const DEFAULT_IDLE_RPM  =    700;
const DEFAULT_NORM_TEMP =     90;  // °C — çoğu benzinli motor

/**
 * BASE lifetime wear eşiği — araç tipine ve motor hacmine göre ölçeklenir.
 * ~200k km ömür / ort. 60 km/s / 0.30 wear-rate ≈ 3.0 M wear-unit.
 */
const BASE_LIFETIME_WEAR = 3_000_000;

/**
 * Bu wear-seconds birikince yağ ömrü çarpanı maksimuma ulaşır (2×).
 * ~280 sa ağır sürüş ≈ 200 k wear-unit.
 */
const OIL_WEAR_REFERENCE = 200_000;

const MAINTENANCE_ALERT_THRESHOLD = 40;  // healthScore < eşik → olay yay
const MAINTENANCE_ALERT_REARM     = 50;  // histerezis: tekrar silahlan eşiği

/** Degraded modda ağır hesaplama aralığı (2 dakika) — CPU bütçesini sürüşe bırak */
const HEAVY_CALC_THROTTLE_MS = 2 * 60_000;

/* ── Veri tipleri ────────────────────────────────────────────── */

interface PersistedData {
  version:               1;
  cumulativeWear:        number;
  wearSinceOilChange:    number;
  lastKnownOilChangeKm:  number;
  /** initialWearOffset bir kez uygulandı mı? (çift uygulama önleme) */
  offsetApplied:         boolean;
}

export interface BrainState {
  healthScore:    number;  // 0–100
  oilLife:        number;  // 0–100%
  wearRate:       number;  // anlık stres 0–1
  cumulativeWear: number;  // ham birikmiş wear-units
  lifetimeWear:   number;  // bu araç için hesaplanan lifetime eşiği
}

/* ── Kalıcı veri ─────────────────────────────────────────────── */

function _loadData(): PersistedData {
  try {
    const raw = safeGetRaw(STORAGE_KEY);
    if (!raw) return _defaultData();
    const d = JSON.parse(raw) as Partial<PersistedData>;
    if (d.version !== 1) return _defaultData();
    return {
      version:             1,
      cumulativeWear:      Number.isFinite(d.cumulativeWear)      ? d.cumulativeWear!      : 0,
      wearSinceOilChange:  Number.isFinite(d.wearSinceOilChange)  ? d.wearSinceOilChange!  : 0,
      lastKnownOilChangeKm: Number.isFinite(d.lastKnownOilChangeKm) ? d.lastKnownOilChangeKm! : 0,
      offsetApplied:       d.offsetApplied === true,
    };
  } catch { return _defaultData(); }
}

function _defaultData(): PersistedData {
  return { version: 1, cumulativeWear: 0, wearSinceOilChange: 0, lastKnownOilChangeKm: 0, offsetApplied: false };
}

/* ── Modül durumu ────────────────────────────────────────────── */

let _persisted:          PersistedData = _loadData();
let _lastTickPerf        = 0;
let _currentOdomKm       = 0;
let _maintenanceFired    = false;
let _running             = false;
let _lastHeavyCalcMs     = 0;    // Adaptive Sync: son ağır hesaplama zamanı
let _unsubRuntime:       (() => void) | null = null;

const INITIAL: BrainState = {
  healthScore: 100, oilLife: 100, wearRate: 0,
  cumulativeWear: _persisted.cumulativeWear,
  lifetimeWear: BASE_LIFETIME_WEAR,
};
let _state = { ...INITIAL };
const _listeners = new Set<(s: BrainState) => void>();

/* ── Araç profili yardımcısı ─────────────────────────────────── */

function _getActiveProfile(): VehicleProfile | undefined {
  const s = useStore.getState().settings;
  if (!s.activeVehicleProfileId) return undefined;
  return s.vehicleProfiles.find((p) => p.id === s.activeVehicleProfileId);
}

function _getOilInterval(): { lastKm: number; intervalKm: number } {
  const { lastOilChangeKm, nextOilChangeKm } = useStore.getState().settings.maintenance;
  const interval = nextOilChangeKm - lastOilChangeKm;
  return {
    lastKm:     lastOilChangeKm,
    intervalKm: interval > 500 ? interval : DEFAULT_OIL_KM,
  };
}

/* ── U-2.1: Lifetime wear ölçekleme ─────────────────────────── */

/**
 * Araç tipine ve motor hacmine göre BASE_LIFETIME_WEAR'ı ölçekler.
 *
 * Araç tipi çarpanı:
 *   EV   → 2.0× (elektrik motoru: çok daha az hareketli parça, düşük termik stres)
 *   PHEV → 1.8× (çoğunlukla EV modunda)
 *   Hybrid → 1.5× (elektrik desteği ICE stresini azaltır)
 *   Diesel → 1.3× (dizel blok daha uzun ömürlü)
 *   ICE/varsayılan → 1.0×
 *
 * Motor hacmi çarpanı (ICE/Hybrid için):
 *   <1.0 L → 0.85 (küçük turbo → spesifik güç yükü yüksek)
 *   1.0–2.0 L → 1.00
 *   2.0–3.0 L → 1.15
 *   >3.0 L   → 1.25 (büyük hacim → daha az spesifik stres)
 */
export function calcLifetimeWear(profile?: VehicleProfile): number {
  const type = profile?.vehicleType;

  const typeMultiplier =
    type === 'ev'     ? 2.0 :
    type === 'phev'   ? 1.8 :
    type === 'hybrid' ? 1.5 :
    type === 'diesel' ? 1.3 : 1.0;

  let capacityMultiplier = 1.0;
  const L = profile?.engineCapacityL;
  // EV'de motor hacmi anlamsız — sadece ICE/Hybrid için uygula
  if (L && L > 0 && type !== 'ev') {
    capacityMultiplier = L < 1.0 ? 0.85 : L < 2.0 ? 1.0 : L < 3.0 ? 1.15 : 1.25;
  }

  return Math.round(BASE_LIFETIME_WEAR * typeMultiplier * capacityMultiplier);
}

/* ── U-2.1: Aşınma hızı — profil tabanlı dinamik eşikler ────── */

/**
 * Anlık motor stres seviyesi (0.0–1.0).
 *
 * RPM stresi  (40%): [idleRpm..maxRpm] → [0..1]
 * Termik stres(25%): normalTemp+10°C altı = 0; üstü üstel artış
 * Yük stresi  (35%): throttle / 100; eksikse RPM tahmini
 *
 * İdleRpm ve normalTemp, aktif VehicleProfile'dan okunur (U-2.1).
 */
export function calcWearRate(
  rpm:      number,
  temp:     number,
  throttle: number,
  profile?: VehicleProfile,
): number {
  const clamp = (v: number, lo: number, hi: number): number =>
    v < lo ? lo : v > hi ? hi : v;

  const idleRpm  = profile?.idleRpm  && profile.idleRpm  > 0 ? profile.idleRpm  : DEFAULT_IDLE_RPM;
  const normTemp = profile?.normalTemp && profile.normalTemp > 0 ? profile.normalTemp : DEFAULT_NORM_TEMP;
  const maxRpm   = profile?.maxRpm   && profile.maxRpm   > 0 ? profile.maxRpm   : DEFAULT_MAX_RPM;

  // RPM: araç boşta devri sıfır noktası, redline maksimum
  const rpmStress = clamp((rpm - idleRpm) / Math.max(maxRpm - idleRpm, 100), 0, 1);

  // Termik: normalTemp + 10°C'ye kadar sıfır ceza; üstü üstel
  // Soğuk motor (normalTemp - 30°C altı): hafif ekstra aşınma
  const coldThreshold = normTemp - 30;
  const hotThreshold  = normTemp + 10;
  const thermalStress =
    temp < coldThreshold ? 0.15 :
    temp < hotThreshold  ? 0 :
    clamp((temp - hotThreshold) / 30, 0, 1);

  // Yük: throttle eksikse (-1) RPM'den kaba tahmin
  const loadStress = throttle < 0 ? rpmStress * 0.55 : clamp(throttle / 100, 0, 1);

  return clamp(rpmStress * 0.40 + loadStress * 0.35 + thermalStress * 0.25, 0, 1.0);
}

/* ── Skor hesaplamaları ──────────────────────────────────────── */

function _calcHealthScore(cumulativeWear: number, lifetimeWear: number): number {
  return Math.max(0, Math.round(100 * (1 - cumulativeWear / lifetimeWear)));
}

/**
 * Yağ ömrü hesabı — U-2.1 yağ tipi çarpanı eklendi.
 *
 * Yağ dayanıklılık faktörü:
 *   conventional → 1.0× (baz)
 *   synthetic    → 1.1× (%10 daha dirençli)
 *   long-life    → 1.2× (%20 daha dirençli — direktif U-2.1 §3)
 *
 * Etki: wearSinceOilChange, oilDurabilityFactor ile bölünür →
 * yağ aynı wear birikiminde daha sağlıklı görünür.
 */
function _calcOilLife(
  currentOdomKm:      number,
  lastOilChangeKm:    number,
  oilIntervalKm:      number,
  wearSinceOilChange: number,
  oilType?:           OilType,
): number {
  const oilDurability =
    oilType === 'long-life'   ? 1.2 :
    oilType === 'synthetic'   ? 1.1 : 1.0;

  const kmRatio      = (currentOdomKm - lastOilChangeKm) / oilIntervalKm;
  const effectiveWear = wearSinceOilChange / oilDurability;
  // Çarpan: 1.0 (normal) → 2.0 (çok ağır sürüş)
  const wearMultiplier = 1.0 + Math.min(effectiveWear / OIL_WEAR_REFERENCE, 1.0);
  return Math.max(0, Math.round(100 * (1 - kmRatio * wearMultiplier)));
}

/* ── Notify ──────────────────────────────────────────────────── */

function _push(partial: Partial<BrainState>): void {
  _state = { ..._state, ...partial };
  _listeners.forEach((fn) => fn(_state));
}

/* ── Ana OBD tick işleyicisi ─────────────────────────────────── */

function _onOBDTick(rpm: number, temp: number, throttle: number): void {
  const nowPerf = performance.now();
  if (_lastTickPerf === 0) { _lastTickPerf = nowPerf; return; }

  const Δt = (nowPerf - _lastTickPerf) / 1000;
  _lastTickPerf = nowPerf;
  if (Δt <= 0 || Δt > 60) return;

  const profile   = _getActiveProfile();
  const wearRate  = calcWearRate(rpm, temp, throttle, profile);
  const wearDelta = wearRate * Δt;

  // Wear biriktirme: her zaman çalışır (hafif, saat-bağımsız)
  _persisted.cumulativeWear     += wearDelta;
  _persisted.wearSinceOilChange += wearDelta;

  // Yağ değişimi tespiti: lightweight, her zaman kontrol et
  const { lastKm, intervalKm } = _getOilInterval();
  if (lastKm !== _persisted.lastKnownOilChangeKm) {
    _persisted.lastKnownOilChangeKm = lastKm;
    _persisted.wearSinceOilChange   = 0;
  }

  // ── Adaptive Sync: SAFE_MODE / BASIC_JS'de ağır hesaplamayı throttle et ──
  // CLAUDE.md §3: CPU bütçesini sürüşe bırak; sağlık skoru 2 dakikada bir güncellenir.
  const mode       = runtimeManager.getMode();
  const isDegraded = mode === RuntimeMode.SAFE_MODE || mode === RuntimeMode.BASIC_JS;
  if (isDegraded) {
    const nowMs = Date.now();
    if (nowMs - _lastHeavyCalcMs < HEAVY_CALC_THROTTLE_MS) return;
    _lastHeavyCalcMs = nowMs;
  }

  // Ağır hesaplamalar: sağlık skoru + yağ ömrü
  const lifetimeWear = calcLifetimeWear(profile);
  const healthScore  = _calcHealthScore(_persisted.cumulativeWear, lifetimeWear);
  const oilLife      = _calcOilLife(
    _currentOdomKm, lastKm, intervalKm,
    _persisted.wearSinceOilChange,
    profile?.oilType,
  );

  _push({ healthScore, oilLife, wearRate, cumulativeWear: _persisted.cumulativeWear, lifetimeWear });

  // MAINTENANCE_REQUIRED — histerezis ile tek tetikleme
  if (!_maintenanceFired && healthScore < MAINTENANCE_ALERT_THRESHOLD) {
    _maintenanceFired = true;
    dispatchMaintenanceRequired(healthScore);
  } else if (_maintenanceFired && healthScore >= MAINTENANCE_ALERT_REARM) {
    _maintenanceFired = false;
  }

  safeSetRaw(STORAGE_KEY, JSON.stringify(_persisted), SAVE_DEBOUNCE_MS);
}

/* ── Public API ──────────────────────────────────────────────── */

export function startMaintenanceBrain(): () => void {
  if (_running) return () => {};
  _running = true;
  _lastTickPerf = 0;

  // Soğuk başlangıç: yağ değişimi km'sini eşitle
  const { lastKm } = _getOilInterval();
  if (_persisted.lastKnownOilChangeKm === 0 && lastKm > 0) {
    _persisted.lastKnownOilChangeKm = lastKm;
  }

  // U-2.1: initialWearOffset — ikinci el araç başlangıç aşınması (bir kez)
  // offsetApplied flag'i tekrar uygulamayı önler (HMR, restart koruması)
  if (!_persisted.offsetApplied) {
    const profile = _getActiveProfile();
    const offset  = profile?.initialWearOffset;
    if (offset && offset > 0 && offset <= 1) {
      const lifetimeWear = calcLifetimeWear(profile);
      _persisted.cumulativeWear = Math.max(
        _persisted.cumulativeWear,
        offset * lifetimeWear,
      );
    }
    _persisted.offsetApplied = true;
    safeSetRaw(STORAGE_KEY, JSON.stringify(_persisted), SAVE_DEBOUNCE_MS);
  }

  const unsubOBD = onOBDData((d) => {
    if (!_running) return;
    if (d.rpm < 0 || d.engineTemp < 0) return;
    _onOBDTick(d.rpm, d.engineTemp, d.throttle);
  });

  const unsubTrip = onTripState((s) => {
    _currentOdomKm = s.totalDistanceKm;
  });

  // Adaptive Sync: mod değişiminde throttle sayacını sıfırla → anlık bir hesaplama yap
  _unsubRuntime = runtimeManager.subscribe(() => { _lastHeavyCalcMs = 0; });

  return () => {
    _running      = false;
    _lastTickPerf = 0;
    _unsubRuntime?.(); _unsubRuntime = null;
    unsubOBD();
    unsubTrip();
  };
}

export function getBrainState(): BrainState { return { ..._state }; }

export function useMaintenanceBrain(): BrainState {
  const [s, setS] = useState<BrainState>(_state);
  useEffect(() => {
    setS(_state);
    _listeners.add(setS);
    return () => { _listeners.delete(setS); };
  }, []);
  return s;
}

/* ── HMR cleanup ─────────────────────────────────────────────── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _running      = false;
    _lastTickPerf = 0;
    _listeners.clear();
  });
}
