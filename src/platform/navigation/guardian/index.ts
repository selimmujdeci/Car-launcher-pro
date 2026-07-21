/**
 * Guardian AI Core — Faz A saf çekirdek — genel barrel — GUARDIAN-AI-G1.
 *
 * Yalnız SAF modülleri dışa verir (models/guardianEngine). Wiring katmanı
 * (GPS/OBD/harita/analiz kuralları/Mavi/UI) bu sürümde YOK — bu dosyadan
 * da dışa verilmez.
 */
export type {
  GuardianSeverity,
  GuardianRiskType,
  GuardianRiskEvent,
  GuardianRuleResult,
  GuardianInput,
  GuardianOutput,
} from './models';
export { SEVERITY_ORDER, SEVERITY_WEIGHT } from './models';

export { runGuardian } from './guardianEngine';
