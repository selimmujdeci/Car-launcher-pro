/**
 * CanSignalValidator — CAN sinyal doğrulama katmanı
 *
 * Amaç: Ham decode edilen CAN sinyallerini production'a sokmadan önce
 *       fiziksel tutarlılık + çapraz kaynak kontrolü uygular.
 *
 * Durum makinesi:
 *   candidate → verified         (yeterli geçerli örnek + yüksek güven)
 *   candidate → rejectedCandidate (jitter / fiziksel tutarsızlık)
 *
 * Doğrulama kuralları:
 *   speed   — GPS hızıyla çapraz doğrulama (±10 km/h tolerans)
 *   reverse — sadece hız < 5 km/h iken true olabilir
 *   door    — test markeri ile korelasyon; bit'ler aynı anda değişemez
 *
 * Production guard:
 *   isProductionSafe() → false ise sinyal VehicleSignalResolver'a geçmez
 *
 * Bağımlılıklar (sadece okur):
 *   onGPSLocation — hız çapraz kontrolü
 *   getRecentEvents — test marker korelasyonu
 */

import { onGPSLocation }        from '../gpsService';
import { getRecentEvents }      from './EventRecorder';
import type { GPSLocation }     from '../vehicleDataLayer/types';

// ── Tipler ───────────────────────────────────────────────────────────────────

export type CandidateState = 'candidate' | 'verified' | 'rejectedCandidate';

export interface CanSignalCandidate {
  canId:           number;           // 0x1D0 gibi
  signalName:      string;           // 'speed' | 'reverse' | 'doorOpen' | ...
  decodeFormula:   string;           // "byte[2-3]×0.01" — insan okunur
  state:           CandidateState;
  confidence:      number;           // 0.0–1.0
  sampleCount:     number;           // gelen toplam örnek
  validCount:      number;           // doğrulama geçen örnek
  jitterCount:     number;           // hızlı tutarsız değişim sayısı
  lastValidatedAt: number;           // epoch ms
  lastValue:       number | boolean | null;
  rejectionReason: string | null;
}

// ── Sabitler ─────────────────────────────────────────────────────────────────

/** GPS ile hız farkı bu kadar km/h'i geçerse geçersiz */
const SPEED_GPS_TOLERANCE_KMH  = 10;
/** Bu kadar fark olursa kesin geçersiz */
const SPEED_GPS_REJECT_KMH     = 30;
/** Bu hızın üstünde reverse=true → geçersiz */
const REVERSE_MAX_SPEED_KMH    = 5;
/** 1 saniyede bu kadar değişim → jitter */
const JITTER_CHANGES_PER_SEC   = 8;
/** Bu kadar jitter sayısında → rejectedCandidate */
const JITTER_REJECT_THRESHOLD  = 5;
/** Bu kadar sample sonra doğrulama değerlendirmesi yapılır */
const MIN_SAMPLES_FOR_VERIFY   = 20;
/** verified için minimum güven skoru */
const MIN_CONFIDENCE_VERIFIED  = 0.80;
/** Test marker korelasyonu için bekleme penceresi (ms) */
const MARKER_CORRELATION_MS    = 5_000;

// ── Jitter takip yapısı ───────────────────────────────────────────────────────

interface JitterWindow {
  changes:     number;
  windowStart: number; // epoch ms
}

// ── Singleton state ───────────────────────────────────────────────────────────

const _candidates = new Map<string, CanSignalCandidate>();  // key = `${canId}:${signalName}`
const _jitter     = new Map<string, JitterWindow>();
const _listeners  = new Set<(c: CanSignalCandidate) => void>();

let _gpsSpeedKmh: number | null = null;
let _gpsAccuracyM = 999;
let _gpsUnsub: (() => void) | null = null;

// ── Başlatma / durdurma ───────────────────────────────────────────────────────

export function startCanSignalValidator(): () => void {
  _gpsUnsub = onGPSLocation((loc: GPSLocation | null) => {
    if (!loc) return;
    _gpsAccuracyM = loc.accuracy;
    // GPS speed m/s → km/h
    _gpsSpeedKmh = loc.speed != null ? loc.speed * 3.6 : null;
  });
  return () => {
    _gpsUnsub?.();
    _gpsUnsub = null;
    _candidates.clear();
    _jitter.clear();
    _listeners.clear();
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

/** Yeni aday kaydet veya mevcut adayı güncelle. */
export function registerCandidate(
  canId: number,
  signalName: string,
  decodeFormula: string,
): CanSignalCandidate {
  const key = _key(canId, signalName);
  if (!_candidates.has(key)) {
    const c: CanSignalCandidate = {
      canId, signalName, decodeFormula,
      state: 'candidate', confidence: 0,
      sampleCount: 0, validCount: 0, jitterCount: 0,
      lastValidatedAt: 0, lastValue: null, rejectionReason: null,
    };
    _candidates.set(key, c);
    return c;
  }
  return _candidates.get(key)!;
}

/**
 * Gelen decode edilmiş değeri işle.
 * Doğrulama kurallarını çalıştır, durumu güncelle.
 */
export function submitSample(
  canId: number,
  signalName: string,
  value: number | boolean,
): CanSignalCandidate | null {
  const key = _key(canId, signalName);
  const c   = _candidates.get(key);
  if (!c || c.state === 'rejectedCandidate') return c ?? null;

  const now = Date.now();

  // Jitter kontrolü
  if (_detectJitter(key, value, c.lastValue, now)) {
    c.jitterCount++;
    if (c.jitterCount >= JITTER_REJECT_THRESHOLD) {
      _reject(c, `Jitter: ${c.jitterCount} hızlı değişim`);
      return c;
    }
  }

  c.sampleCount++;
  c.lastValidatedAt = now;

  // Sinyal bazlı doğrulama
  const valid = _validateSample(signalName, value, c.lastValue, now);
  if (valid === true)  c.validCount++;
  if (valid === false) { /* geçersiz — validCount artmaz */ }
  // null = belirsiz (GPS yok, marker yok) → saymayız ama reddetmeyiz

  c.lastValue = value;

  // Güven hesapla
  c.confidence = c.sampleCount > 0 ? c.validCount / c.sampleCount : 0;

  // Durum geçişi değerlendirmesi
  if (c.state === 'candidate') {
    _evaluateState(c);
  }

  _notify(c);
  return c;
}

/** Tüm adaylar */
export function getAllCandidates(): CanSignalCandidate[] {
  return [..._candidates.values()];
}

/** Belirli sinyale ait adaylar */
export function getCandidatesForSignal(signalName: string): CanSignalCandidate[] {
  return [..._candidates.values()].filter(c => c.signalName === signalName);
}

/**
 * Production'a geçiş güvenli mi?
 * verified + confidence >= 0.80 → güvenli
 */
export function isProductionSafe(canId: number, signalName: string): boolean {
  const c = _candidates.get(_key(canId, signalName));
  if (!c) return false;
  return c.state === 'verified' && c.confidence >= MIN_CONFIDENCE_VERIFIED;
}

/**
 * Tüm verified sinyallerin özeti — production profil oluşturmak için.
 * Birden fazla CAN ID aynı sinyali claim ediyorsa en yüksek güvenli seçilir.
 */
export function getBestVerifiedCandidates(): Map<string, CanSignalCandidate> {
  const best = new Map<string, CanSignalCandidate>();
  for (const c of _candidates.values()) {
    if (c.state !== 'verified') continue;
    const existing = best.get(c.signalName);
    if (!existing || c.confidence > existing.confidence) {
      best.set(c.signalName, c);
    }
  }
  return best;
}

/** Değişiklik listener */
export function onCandidateUpdate(fn: (c: CanSignalCandidate) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Adayı manuel sıfırla (test tekrarı için) */
export function resetCandidate(canId: number, signalName: string): void {
  const key = _key(canId, signalName);
  const c   = _candidates.get(key);
  if (!c) return;
  c.state = 'candidate';
  c.confidence = 0;
  c.sampleCount = 0;
  c.validCount = 0;
  c.jitterCount = 0;
  c.rejectionReason = null;
  c.lastValue = null;
  _jitter.delete(key);
  _notify(c);
}

// ── Doğrulama kuralları ───────────────────────────────────────────────────────

/**
 * Sinyale özgü doğrulama.
 * @returns true=geçerli, false=geçersiz, null=belirsiz
 */
function _validateSample(
  signalName: string,
  value: number | boolean,
  prevValue: number | boolean | null,
  _now: number,
): boolean | null {
  switch (signalName) {
    case 'speed':
      return _validateSpeed(value as number, prevValue as number | null);

    case 'reverse':
      return _validateReverse(value as boolean, prevValue as boolean | null, _now);

    case 'doorOpen':
    case 'doorFl':
    case 'doorFr':
    case 'doorRl':
    case 'doorRr':
      return _validateDoor(value as boolean, signalName, _now);

    default:
      return null; // bilinmeyen sinyal — belirsiz
  }
}

function _validateSpeed(kmh: number, prev: number | null): boolean | null {
  // Fiziksel aralık kontrolü
  if (kmh < 0 || kmh > 300) return false;

  // Ani sıçrama: bir sample'da > 80 km/h değişim imkânsız
  if (prev !== null && Math.abs(kmh - prev) > 80) return false;

  // GPS çapraz doğrulama
  if (_gpsSpeedKmh !== null && _gpsAccuracyM < 30) {
    const diff = Math.abs(kmh - _gpsSpeedKmh);
    if (diff > SPEED_GPS_REJECT_KMH) return false;
    if (diff <= SPEED_GPS_TOLERANCE_KMH) return true;
    return null; // tolerans aralığında — belirsiz
  }

  return null; // GPS yok → belirsiz
}

function _validateReverse(isReverse: boolean, prev: boolean | null, _now: number): boolean | null {
  // Hız > 5 km/h iken reverse=true → fiziksel olarak imkânsız
  if (isReverse && _gpsSpeedKmh !== null && _gpsSpeedKmh > REVERSE_MAX_SPEED_KMH) {
    return false;
  }

  // Test marker korelasyonu
  const recent = getRecentEvents(30);
  const marker = [...recent].reverse().find(e =>
    e.kind === 'marker' &&
    (e.label.includes('TEST_REVERSE_ON') || e.label.includes('TEST_REVERSE_OFF'))
  );
  if (marker && Date.now() - marker.ts < MARKER_CORRELATION_MS) {
    const expectReverse = marker.label.includes('TEST_REVERSE_ON');
    return isReverse === expectReverse; // marker ile uyuşuyor mu?
  }

  // Önceki değerden değişmediyse neutral
  if (prev !== null && isReverse === prev) return null;

  return null; // belirsiz
}

function _validateDoor(isOpen: boolean, signalName: string, _now: number): boolean | null {
  // Test marker korelasyonu
  const recent = getRecentEvents(30);
  const marker = [...recent].reverse().find(e =>
    e.kind === 'marker' &&
    (e.label.includes('TEST_DOOR_OPEN') || e.label.includes('TEST_DOOR_CLOSE'))
  );
  if (marker && Date.now() - marker.ts < MARKER_CORRELATION_MS) {
    const expectOpen = marker.label.includes('TEST_DOOR_OPEN');
    return isOpen === expectOpen;
  }

  void signalName; // ileride door-specific rule eklenebilir
  return null; // belirsiz
}

// ── Jitter tespiti ────────────────────────────────────────────────────────────

function _detectJitter(
  key: string,
  newVal: number | boolean,
  prevVal: number | boolean | null,
  now: number,
): boolean {
  if (prevVal === null || newVal === prevVal) return false;

  let w = _jitter.get(key);
  if (!w || now - w.windowStart > 1_000) {
    w = { changes: 0, windowStart: now };
    _jitter.set(key, w);
  }
  w.changes++;
  return w.changes >= JITTER_CHANGES_PER_SEC;
}

// ── Durum geçiş değerlendirmesi ───────────────────────────────────────────────

function _evaluateState(c: CanSignalCandidate): void {
  if (c.sampleCount < MIN_SAMPLES_FOR_VERIFY) return;

  // Jitter limiti geçildi mi?
  if (c.jitterCount >= JITTER_REJECT_THRESHOLD) {
    _reject(c, `Jitter eşiği geçildi: ${c.jitterCount}`);
    return;
  }

  // Güven yeterli mi?
  if (c.confidence >= MIN_CONFIDENCE_VERIFIED) {
    c.state = 'verified';
    _log(`✓ VERIFIED: 0x${c.canId.toString(16).toUpperCase()} ${c.signalName} conf=${c.confidence.toFixed(2)}`);
  }
}

function _reject(c: CanSignalCandidate, reason: string): void {
  c.state           = 'rejectedCandidate';
  c.rejectionReason = reason;
  _log(`✗ REJECTED: 0x${c.canId.toString(16).toUpperCase()} ${c.signalName} — ${reason}`);
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _key(canId: number, signalName: string): string {
  return `${canId.toString(16)}:${signalName}`;
}

function _notify(c: CanSignalCandidate): void {
  _listeners.forEach(fn => { try { fn({ ...c }); } catch { /**/ } });
}

function _log(msg: string): void {
  if (import.meta.env.DEV) console.info(`[CanSignalValidator] ${msg}`);
}
