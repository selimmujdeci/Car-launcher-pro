import type { VehicleType, OBDData } from './obdTypes';

function _clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ICE mock starting values
const MOCK_BASE_ICE = {
  speed: 42, rpm: 1450, engineTemp: 90, fuelLevel: 68,
  throttle: 18, intakeTemp: 22, boostPressure: -1, egt: -1,
  batteryLevel: -1, batteryTemp: -1, range: -1,
  chargingState: 'not_charging' as const, chargingPower: -1, motorPower: -1,
  headlights: new Date().getHours() >= 20 || new Date().getHours() < 6,
  doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
  tpms:  { fl: 235, fr: 233, rl: 230, rr: 232 },
  batteryVoltage: 13.8, // alternator şarj ediyor
};

// EV mock starting values
const MOCK_BASE_EV = {
  speed: 42, rpm: -1, engineTemp: -1, fuelLevel: -1,
  throttle: 15, intakeTemp: -1, boostPressure: -1, egt: -1,
  batteryLevel: 74, batteryTemp: 28, range: 185,
  chargingState: 'not_charging' as const, chargingPower: -1, motorPower: 35,
  headlights: new Date().getHours() >= 20 || new Date().getHours() < 6,
  doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
  tpms:  { fl: 240, fr: 238, rl: 236, rr: 237 },
  batteryVoltage: 13.8,
};

// Hybrid / PHEV mock starting values
const MOCK_BASE_HYBRID = {
  speed: 42, rpm: 800, engineTemp: 85, fuelLevel: 55,
  throttle: 12, intakeTemp: 20, boostPressure: -1, egt: -1,
  batteryLevel: 48, batteryTemp: 32, range: 290,
  chargingState: 'not_charging' as const, chargingPower: -1, motorPower: 18,
  headlights: new Date().getHours() >= 20 || new Date().getHours() < 6,
  doors: { fl: false, fr: false, rl: false, rr: false, trunk: false },
  tpms:  { fl: 233, fr: 231, rl: 228, rr: 230 },
  batteryVoltage: 13.8,
};

/**
 * Araç tipine göre mock simülasyon başlangıç veri setini döner.
 * Diesel → ICE şablonunu kullanır (aynı sensör seti).
 * Saf veri fonksiyonu — setInterval veya store'a dokunmaz.
 */
export function getMockInitialData(type: VehicleType): Partial<OBDData> {
  if (type === 'ev')                        return MOCK_BASE_EV;
  if (type === 'hybrid' || type === 'phev') return MOCK_BASE_HYBRID;
  return MOCK_BASE_ICE; // 'ice' | 'diesel'
}

/**
 * Mevcut OBD snapshot'ından bir sonraki simüle tick verisini üretir.
 * Araç tipine göre fiziksel olarak tutarlı rastgele değişimler uygular.
 * Saf — hiçbir module-level state tutmaz.
 */
export function generateMockUpdate(current: OBDData): Partial<OBDData> {
  const hour       = new Date().getHours();
  const headlights = hour >= 20 || hour < 6;
  const type       = current.vehicleType;

  if (type === 'ev') {
    // EV: batarya tükenir, motor gücü değişir, RPM yok
    const newSpeed  = _clamp(Math.round(current.speed + (Math.random() * 14 - 7)), 0, 180);
    const powerDraw = newSpeed > 0
      ? _clamp(Math.round(newSpeed * 0.6 + (Math.random() * 20 - 10)), -30, 150)
      : -5;
    return {
      speed:        newSpeed,
      headlights,
      batteryLevel: _clamp(current.batteryLevel - Math.random() * 0.08, 0, 100),
      batteryTemp:  _clamp(Math.round(current.batteryTemp + (Math.random() * 2 - 1)), 15, 45),
      range:        _clamp(Math.round(current.range - Math.random() * 0.05), 0, 600),
      motorPower:   powerDraw,
      throttle:     _clamp(Math.round(Math.abs(powerDraw) / 1.5), 0, 100),
      rpm: -1, engineTemp: -1, fuelLevel: -1, boostPressure: -1, egt: -1,
    };
  }

  if (type === 'hybrid' || type === 'phev') {
    // Hybrid: hem batarya hem yakıt
    return {
      speed:        _clamp(Math.round(current.speed + (Math.random() * 14 - 7)), 0, 180),
      rpm:          current.speed < 5 ? -1 : _clamp(Math.round(current.rpm + (Math.random() * 200 - 100)), 0, 5000),
      engineTemp:   _clamp(Math.round(current.engineTemp + (Math.random() * 2 - 1)), 60, 105),
      fuelLevel:    _clamp(current.fuelLevel - Math.random() * 0.15, 0, 100),
      batteryLevel: _clamp(current.batteryLevel + (Math.random() * 0.4 - 0.25), 10, 100),
      batteryTemp:  _clamp(Math.round(current.batteryTemp + (Math.random() * 2 - 1)), 15, 45),
      range:        _clamp(Math.round(current.range - Math.random() * 0.04), 0, 800),
      motorPower:   _clamp(Math.round(current.motorPower + (Math.random() * 10 - 5)), -20, 80),
      throttle:     _clamp(Math.round(current.throttle + (Math.random() * 10 - 5)), 0, 100),
      headlights,
    };
  }

  if (type === 'diesel') {
    // Diesel: turbo boost basıncı + EGT ekstra
    return {
      speed:         _clamp(Math.round(current.speed + (Math.random() * 14 - 7)), 0, 180),
      rpm:           _clamp(Math.round(current.rpm + (Math.random() * 300 - 150)), 700, 4500),
      engineTemp:    _clamp(Math.round(current.engineTemp + (Math.random() * 2 - 1)), 70, 110),
      fuelLevel:     _clamp(current.fuelLevel - Math.random() * 0.2, 0, 100),
      throttle:      _clamp(Math.round(current.throttle + (Math.random() * 8 - 4)), 0, 100),
      intakeTemp:    _clamp(Math.round(current.intakeTemp + (Math.random() * 4 - 2)), 15, 65),
      boostPressure: _clamp(Math.round(current.boostPressure + (Math.random() * 6 - 3)), 0, 220),
      egt:           _clamp(Math.round(current.egt + (Math.random() * 20 - 10)), 200, 800),
      headlights,
    };
  }

  // ICE (benzin) — default ('ice' | fallthrough)
  return {
    speed:          _clamp(Math.round(current.speed + (Math.random() * 14 - 7)), 0, 180),
    rpm:            _clamp(Math.round(current.rpm + (Math.random() * 300 - 150)), 650, 7000),
    engineTemp:     _clamp(Math.round(current.engineTemp + (Math.random() * 2 - 1)), 75, 105),
    fuelLevel:      _clamp(current.fuelLevel - Math.random() * 0.3, 0, 100),
    throttle:       _clamp(Math.round(current.throttle + (Math.random() * 10 - 5)), 0, 100),
    intakeTemp:     _clamp(Math.round(current.intakeTemp + (Math.random() * 3 - 1.5)), 10, 55),
    headlights,
    // 12V akü voltajı: alternator şarj → 13.6–14.4V arası küçük dalgalanma
    batteryVoltage: parseFloat(_clamp(
      (current.batteryVoltage ?? 13.8) + (Math.random() * 0.16 - 0.08),
      13.2, 14.6,
    ).toFixed(2)),
  };
}
