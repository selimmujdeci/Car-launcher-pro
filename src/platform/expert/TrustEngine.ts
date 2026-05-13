/**
 * TrustEngine — otomotiv diagnostik güven skoru (saf fonksiyon, I/O yok).
 *
 * Girdiler: VIN, ECU tedarikçisi, normalize edilmiş rollback frekansı (0..1).
 * Çıktı: 0–100 skor; skor < WRITE_LOCK_THRESHOLD ise yazım politikası kilitlenir.
 */

export const WRITE_LOCK_THRESHOLD = 70;

/** Maksimum rollback kaynaklı ceza (0–50 bandı). */
const MAX_ROLLBACK_PENALTY = 50;

const TRUSTED_ECU = new Set<string>([
  'BOSCH',
  'CONTINENTAL',
  'DENSO',
  'DELPHI',
  'VDO',
  'SIEMENS',
  'MAGNETI_MARELLI',
]);

const HIGH_RISK_ECU = new Set<string>(['UNKNOWN_AFTERMARKET']);

/** Basit VIN doğrulama: 17 karakter, I/O/Q hariç alfanumerik (ISO 3779 benzeri). */
const VIN_BODY = /^[A-HJ-NPR-Z0-9]{17}$/;

export interface TrustEngineInputs {
  /** Ham veya normalize edilmiş VIN — compute içinde normalizeVin uygulanır */
  vin: string;
  ecuSupplier: string;
  /** 0..1 dışında değerler içeride sıkıştırılır */
  rollbackFrequency: number;
}

export interface TrustEvaluation {
  score:        number;
  writeLocked:  boolean;
  evaluatedAt:  number;
}

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeEcuSupplier(supplier: string): string {
  return supplier.trim().toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

/** Boş veya geçersiz VIN için ceza puanı (0–100 ölçeğinde düşüş). */
export function vinPenaltyPoints(normalizedVin: string): number {
  if (!normalizedVin) return 30;
  if (!VIN_BODY.test(normalizedVin)) return 25;
  return 0;
}

export function ecuSupplierPenaltyPoints(normalizedSupplier: string): number {
  if (!normalizedSupplier) return 20;
  if (HIGH_RISK_ECU.has(normalizedSupplier)) return 45;
  if (TRUSTED_ECU.has(normalizedSupplier)) return 0;
  return 18;
}

export function rollbackPenaltyPoints(rollbackFrequency: number): number {
  const f = Number.isFinite(rollbackFrequency) ? rollbackFrequency : 0;
  const clamped = Math.min(1, Math.max(0, f));
  return clamped * MAX_ROLLBACK_PENALTY;
}

export function computeTrustScore(inputs: TrustEngineInputs): number {
  const vin   = normalizeVin(inputs.vin);
  const ecu   = normalizeEcuSupplier(inputs.ecuSupplier);
  const rb    = Math.min(1, Math.max(0, inputs.rollbackFrequency));
  const total = vinPenaltyPoints(vin) + ecuSupplierPenaltyPoints(ecu) + rollbackPenaltyPoints(rb);
  const raw   = 100 - total;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

export function isWriteLocked(score: number): boolean {
  return score < WRITE_LOCK_THRESHOLD;
}

export function evaluateTrust(inputs: TrustEngineInputs): TrustEvaluation {
  const score = computeTrustScore(inputs);
  return {
    score,
    writeLocked: isWriteLocked(score),
    evaluatedAt: Date.now(),
  };
}
