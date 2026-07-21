/**
 * vehicleHealthAdapter — GUARDIAN-AI-G11 (Adapter Contracts, Phase 1).
 *
 * Raw platform (araç sağlık sinyalleri) verisini `VehicleHealthRiskInput`e
 * dönüştürür. GERÇEK IO YOK — raw DI ile gelir (OBD/CAN OKUMA burada DEĞİL).
 * FAIL-SOFT: `policy` eksik/bozuk → `undefined`; bozuk numeric sinyal → o alan
 * DROP edilir (kural o sinyal için event üretmez). Girdi MUTASYONA UĞRATILMAZ;
 * Date.now/random/global YOK.
 */
import type { VehicleHealthRiskInput, VehicleHealthSignalsInput, VehicleHealthPolicyInput } from '../rules';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export interface RawVehicleHealthData {
  coolantTemperatureC?:  number;
  oilPressureKpa?:       number;
  brakeWarning?:         boolean;
  batteryVoltage?:       number;
  engineWarningLamp?:    boolean;
  transmissionWarning?:  boolean;
  policy?:               VehicleHealthPolicyInput;
}

export function adaptVehicleHealthInput(raw: RawVehicleHealthData | undefined): VehicleHealthRiskInput | undefined {
  if (!isObject(raw)) return undefined;
  if (!isObject(raw.policy)) return undefined;

  // Yalnız GEÇERLİ sinyaller taşınır — bozuk/eksik olan DROP edilir (fail-soft).
  const signals: VehicleHealthSignalsInput = {};
  if (isFiniteNumber(raw.coolantTemperatureC)) signals.coolantTemperatureC = raw.coolantTemperatureC;
  if (isFiniteNumber(raw.oilPressureKpa))      signals.oilPressureKpa = raw.oilPressureKpa;
  if (isFiniteNumber(raw.batteryVoltage))      signals.batteryVoltage = raw.batteryVoltage;
  if (typeof raw.brakeWarning === 'boolean')        signals.brakeWarning = raw.brakeWarning;
  if (typeof raw.engineWarningLamp === 'boolean')   signals.engineWarningLamp = raw.engineWarningLamp;
  if (typeof raw.transmissionWarning === 'boolean') signals.transmissionWarning = raw.transmissionWarning;

  return { signals, policy: raw.policy };
}
