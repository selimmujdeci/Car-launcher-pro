/**
 * canSimulator.ts — T2: araçsız CAN frame simülatörü (TEST-ONLY).
 *
 * Amaç: araç olmadan reverse / kapı / vites / far / el freni / emniyet kemeri
 * sinyallerini deterministik üretmek ve GERÇEK decode → store yolunun
 * doğru tepki verdiğini doğrulamak.
 *
 * Tasarım kuralları (CLAUDE.md + T1 yaklaşımı):
 *   - Yalnız src/__tests__ altında → production bundle'a GİRMEZ (tree-shake).
 *   - Native CAN hot-path'e (K24CanBridge / McuEventSniffer / Java) DOKUNMAZ.
 *   - Gerçek decode fonksiyonlarını kullanır:
 *       ham satır → parseCanLine → decodeFrame → rawCanToAdapterData
 *     Hiçbir production fonksiyonu kopyalanmaz/değiştirilmez.
 *   - Store'a yazma store-agnostik bir `emit` callback'i ile yapılır
 *     (T1'deki playScenario(scenario, emit) deseni) → simülatör store import etmez,
 *     T3/T4 için yeniden kullanılabilir kalır.
 *
 * Not — vites (gear) yolu:
 *   RawCanDecoder TS tarafında gear/gearPos sinyalini ÇÖZMEZ (DecodedCanSignals'da
 *   yoktur); üretimde gearPos native taraftan decode edilip CanAdapterData ile
 *   gelir. Bu yüzden gear frame'leri 'native' tipinde üretilir ve gerçek
 *   applyProfileGate süzgecinden geçirilir — native gearPos teslim yolunu birebir
 *   taklit eder.
 */
import { parseCanLine, decodeFrame } from '../../platform/canBus/RawCanDecoder';
import { rawCanToAdapterData, applyProfileGate } from '../../platform/canBus/ProfileSignalGate';
import type { VehicleCanProfile } from '../../platform/canBus/canProfileTypes';
import type { CanAdapterData } from '../../platform/vehicleDataLayer/types';

// ── Test profili ───────────────────────────────────────────────────────────────
// Gerçek araç verisi DEĞİLDİR; yalnız decode yolunu sürmek için deterministik
// bit/bayt yerleşimi tanımlar. CAN ID'ler index.ts'teki aday kayıtlarıyla uyumlu
// seçilmiştir (0x1D2 reverse bit5, 0x345 kapılar) — gerçeklik hissi için.
export const TEST_CAN_PROFILE: VehicleCanProfile = {
  id:              'test_can_profile',
  version:         '1.0.0',
  make:            '*',
  model:           '*',
  yearFrom:        2000,
  yearTo:          2100,
  protocol:        'CAN11_500',
  confidenceScore: 1.0,
  safetyLevel:     'verified',
  fallbackProfile: null,
  notes:           'TEST-ONLY — gerçek araç profili değildir',
  signals: [
    // Hız (sayısal) — byte[2-3] big-endian × 0.01 km/h
    { name: 'speed', canId: 0x1D0, startByte: 2, length: 2, scale: 0.01, offset: 0, unit: 'km/h' },
    // Geri vites — byte[0] bit5
    { name: 'reverse', canId: 0x1D2, startByte: 0, length: 1, bitOffset: 5, bitMask: 0x20, scale: 1, offset: 0, unit: 'bool' },
    // Kapılar — byte[0] bit0..3 (FL/FR/RL/RR)
    { name: 'doorFl', canId: 0x345, startByte: 0, length: 1, bitOffset: 0, bitMask: 0x01, scale: 1, offset: 0, unit: 'bool' },
    { name: 'doorFr', canId: 0x345, startByte: 0, length: 1, bitOffset: 1, bitMask: 0x02, scale: 1, offset: 0, unit: 'bool' },
    { name: 'doorRl', canId: 0x345, startByte: 0, length: 1, bitOffset: 2, bitMask: 0x04, scale: 1, offset: 0, unit: 'bool' },
    { name: 'doorRr', canId: 0x345, startByte: 0, length: 1, bitOffset: 3, bitMask: 0x08, scale: 1, offset: 0, unit: 'bool' },
    // Far — byte[0] bit0
    { name: 'headlights', canId: 0x470, startByte: 0, length: 1, bitOffset: 0, bitMask: 0x01, scale: 1, offset: 0, unit: 'bool' },
    // El freni — byte[0] bit0
    { name: 'parkingBrake', canId: 0x480, startByte: 0, length: 1, bitOffset: 0, bitMask: 0x01, scale: 1, offset: 0, unit: 'bool' },
    // Emniyet kemeri — byte[0] bit0
    { name: 'seatbelt', canId: 0x4A0, startByte: 0, length: 1, bitOffset: 0, bitMask: 0x01, scale: 1, offset: 0, unit: 'bool' },
  ],
};

// ── Frame tipleri ───────────────────────────────────────────────────────────────

/** 'raw' → gerçek parseCanLine/decodeFrame yolundan geçer.
 *  'native' → TS-decode'u olmayan sinyaller (gear gibi) için zaten çözülmüş veri. */
export type CanFrame =
  | { kind: 'raw'; line: string }
  | { kind: 'native'; data: CanAdapterData };

export type Gear = 'P' | 'R' | 'N' | 'D';

// ── Frame kurucuları ────────────────────────────────────────────────────────────

/** Sabit 8 baytlık ham CAN frame satırı kur: "1D2 8 20 00 00 00 00 00 00 00". */
export function buildFrame(canId: number, bytes: readonly number[]): string {
  const LEN = 8;
  const id = canId.toString(16).toUpperCase();
  const out: string[] = new Array(LEN);
  for (let i = 0; i < LEN; i++) {
    const b = i < bytes.length ? (bytes[i] & 0xff) : 0;
    out[i] = b.toString(16).toUpperCase().padStart(2, '0');
  }
  return `${id} ${LEN} ${out.join(' ')}`;
}

const raw = (line: string): CanFrame => ({ kind: 'raw', line });

/** Vites → gearPos. Sistem konvansiyonu: -1=R, 0=N/P, 1..8=ileri. P ve N → 0. */
export function gearToPos(g: Gear): number {
  switch (g) {
    case 'R': return -1;
    case 'D': return 1;
    case 'P':
    case 'N': return 0;
    default:  return 0;
  }
}

/** Deterministik frame fabrikası. */
export const F = {
  reverse:      (on: boolean): CanFrame => raw(buildFrame(0x1D2, [on ? 0x20 : 0x00])),
  doors:        (open: boolean): CanFrame => raw(buildFrame(0x345, [open ? 0x01 : 0x00])),
  headlights:   (on: boolean): CanFrame => raw(buildFrame(0x470, [on ? 0x01 : 0x00])),
  parkingBrake: (on: boolean): CanFrame => raw(buildFrame(0x480, [on ? 0x01 : 0x00])),
  seatbelt:     (on: boolean): CanFrame => raw(buildFrame(0x4A0, [on ? 0x01 : 0x00])),
  gear:         (g: Gear): CanFrame => ({ kind: 'native', data: { gearPos: gearToPos(g) } }),
  /** Profilde tanımlı OLMAYAN CAN ID — geçerli format, çözülecek sinyal yok. */
  unknownId:    (): CanFrame => raw(buildFrame(0x7FF, [0xff, 0xff, 0xff, 0xff])),
  /** parseCanLine'ın null döndüreceği bozuk satırlar (decode edilemez). */
  malformed:    (variant = 0): CanFrame => raw(['GG 8 00 00', '1D2 99 00', '1D2', ''][variant % 4]),
} as const;

// ── Senaryo modeli ──────────────────────────────────────────────────────────────

export interface CanScenario {
  name: string;
  description: string;
  frames: CanFrame[];
}

export const CAN_SCENARIOS = {
  REVERSE_ON:        { name: 'REVERSE_ON',        description: 'Geri vites aktif',        frames: [F.reverse(true)] },
  REVERSE_OFF:       { name: 'REVERSE_OFF',       description: 'Geri vites pasif',        frames: [F.reverse(false)] },
  DOOR_OPEN:         { name: 'DOOR_OPEN',         description: 'Sol ön kapı açık',        frames: [F.doors(true)] },
  DOOR_CLOSED:       { name: 'DOOR_CLOSED',       description: 'Tüm kapılar kapalı',      frames: [F.doors(false)] },
  GEAR_PARK:         { name: 'GEAR_PARK',         description: 'Vites P (park)',          frames: [F.gear('P')] },
  GEAR_REVERSE:      { name: 'GEAR_REVERSE',      description: 'Vites R (geri)',          frames: [F.gear('R')] },
  GEAR_NEUTRAL:      { name: 'GEAR_NEUTRAL',      description: 'Vites N (boş)',           frames: [F.gear('N')] },
  GEAR_DRIVE:        { name: 'GEAR_DRIVE',        description: 'Vites D (sürüş)',         frames: [F.gear('D')] },
  HEADLIGHTS_ON:     { name: 'HEADLIGHTS_ON',     description: 'Farlar açık',             frames: [F.headlights(true)] },
  HEADLIGHTS_OFF:    { name: 'HEADLIGHTS_OFF',    description: 'Farlar kapalı',           frames: [F.headlights(false)] },
  PARKING_BRAKE_ON:  { name: 'PARKING_BRAKE_ON',  description: 'El freni çekili',         frames: [F.parkingBrake(true)] },
  PARKING_BRAKE_OFF: { name: 'PARKING_BRAKE_OFF', description: 'El freni bırakılmış',     frames: [F.parkingBrake(false)] },
  SEATBELT_ON:       { name: 'SEATBELT_ON',       description: 'Emniyet kemeri takılı',   frames: [F.seatbelt(true)] },
  SEATBELT_OFF:      { name: 'SEATBELT_OFF',      description: 'Emniyet kemeri çözülmüş', frames: [F.seatbelt(false)] },
  UNKNOWN_ID:        { name: 'UNKNOWN_ID',        description: 'Profilde olmayan CAN ID', frames: [F.unknownId()] },
  MALFORMED:         { name: 'MALFORMED',         description: 'Decode edilemeyen frame', frames: [F.malformed(0), F.malformed(1), F.malformed(2), F.malformed(3)] },
} as const satisfies Record<string, CanScenario>;

export type CanScenarioKey = keyof typeof CAN_SCENARIOS;

// ── Decode ──────────────────────────────────────────────────────────────────────

/**
 * Tek frame'i GERÇEK decode yolundan geçirip CanAdapterData üretir.
 * - raw: parseCanLine → (null ise fail-soft {}) → decodeFrame → rawCanToAdapterData
 * - native: applyProfileGate (gear gibi zaten çözülmüş sinyaller)
 */
export function decodeCanFrame(frame: CanFrame, profile: VehicleCanProfile): CanAdapterData {
  if (frame.kind === 'native') {
    return applyProfileGate(frame.data);
  }
  const parsed = parseCanLine(frame.line);
  if (!parsed) return {};                       // fail-soft: çözülemeyen frame
  const signals = decodeFrame(parsed, profile); // bilinmeyen ID → boş partial
  return rawCanToAdapterData(signals);
}

/**
 * Senaryo frame'lerini sırayla decode edip `emit`'e geçirir (senkron).
 * `emit` store-agnostiktir: testler burada store action'larını çağırır.
 */
export function playCanScenario(
  scenario: CanScenario,
  profile: VehicleCanProfile,
  emit: (data: CanAdapterData) => void,
): void {
  for (const f of scenario.frames) emit(decodeCanFrame(f, profile));
}
