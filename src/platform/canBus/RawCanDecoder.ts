/**
 * RawCanDecoder.ts
 *
 * ELM327 ATMA modundan gelen ham CAN frame'lerini çözer.
 * Frame formatı: "1D0 8 FF 00 32 00 00 00 00 00\r\n"
 *                 ^ID ^len ^bytes...
 */

import type { VehicleCanProfile, CanSignalDef } from './canProfileTypes';

export interface DecodedCanSignals {
  speed?: number;        // km/h
  rpm?: number;          // devir/dak
  coolant?: number;      // °C
  oilTemp?: number;      // °C
  throttle?: number;     // %
  fuel?: number;         // %
  reverse?: boolean;
  parkingBrake?: boolean;
  doorFl?: boolean;
  doorFr?: boolean;
  doorRl?: boolean;
  doorRr?: boolean;
  headlights?: boolean;
  seatbelt?: boolean;
  battVolt?: number;     // V
}

export interface RawCanFrame {
  id: number;
  bytes: Uint8Array;
}

/** "1D0 8 FF 00 32 00 00 00 00 00" → RawCanFrame | null */
export function parseCanLine(line: string): RawCanFrame | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) return null;

  const id = parseInt(parts[0], 16);
  if (isNaN(id)) return null;

  const len = parseInt(parts[1], 10);
  if (isNaN(len) || len < 1 || len > 8) return null;

  const byteStrs = parts.slice(2, 2 + len);
  if (byteStrs.length < len) return null;

  const bytes = new Uint8Array(byteStrs.map(h => parseInt(h, 16)));
  if (bytes.some(b => isNaN(b))) return null;

  return { id, bytes };
}

/** Ham frame + sinyal tanımı → sayısal değer */
function extractSignalValue(frame: RawCanFrame, sig: CanSignalDef): number | boolean | null {
  if (frame.bytes.length < sig.startByte + sig.length) return null;

  if (sig.bitMask !== undefined && sig.bitOffset !== undefined) {
    // Boolean bit sinyali
    const byte = frame.bytes[sig.startByte];
    return (byte & sig.bitMask) !== 0;
  }

  // Sayısal sinyal — big-endian
  let raw = 0;
  for (let i = 0; i < sig.length; i++) {
    raw = (raw << 8) | frame.bytes[sig.startByte + i];
  }

  if (sig.signed && raw >= (1 << (sig.length * 8 - 1))) {
    raw -= 1 << (sig.length * 8);
  }

  return raw * sig.scale + sig.offset;
}

/**
 * Tek bir CAN frame'ini profile göre çöz.
 * Değişen sinyalleri partial DecodedCanSignals olarak döner.
 */
export function decodeFrame(
  frame: RawCanFrame,
  profile: VehicleCanProfile,
): Partial<DecodedCanSignals> {
  const result: Partial<DecodedCanSignals> = {};

  for (const sig of profile.signals) {
    if (sig.canId !== frame.id) continue;

    const val = extractSignalValue(frame, sig);
    if (val === null) continue;

    switch (sig.name) {
      case 'speed':        if (typeof val === 'number' && val >= 0 && val <= 300) result.speed = val; break;
      case 'rpm':          if (typeof val === 'number' && val >= 0 && val <= 12000) result.rpm = val; break;
      case 'coolant':      if (typeof val === 'number' && val >= -40 && val <= 150) result.coolant = val; break;
      case 'oilTemp':      if (typeof val === 'number' && val >= -40 && val <= 200) result.oilTemp = val; break;
      case 'throttle':     if (typeof val === 'number' && val >= 0 && val <= 100) result.throttle = val; break;
      case 'fuel':         if (typeof val === 'number' && val >= 0 && val <= 100) result.fuel = val; break;
      case 'battVolt':     if (typeof val === 'number' && val >= 8 && val <= 20) result.battVolt = val; break;
      case 'reverse':      if (typeof val === 'boolean') result.reverse = val; break;
      case 'parkingBrake': if (typeof val === 'boolean') result.parkingBrake = val; break;
      case 'doorFl':       if (typeof val === 'boolean') result.doorFl = val; break;
      case 'doorFr':       if (typeof val === 'boolean') result.doorFr = val; break;
      case 'doorRl':       if (typeof val === 'boolean') result.doorRl = val; break;
      case 'doorRr':       if (typeof val === 'boolean') result.doorRr = val; break;
      case 'headlights':   if (typeof val === 'boolean') result.headlights = val; break;
      case 'seatbelt':     if (typeof val === 'boolean') result.seatbelt = val; break;
    }
  }

  return result;
}

/**
 * Çoklu frame akışını işler, tam snapshot döner.
 * ELM327 ATMA çıktısını satır satır besle.
 */
export class CanStreamDecoder {
  private _profile: VehicleCanProfile;
  private _snapshot: DecodedCanSignals = {};
  private _onChange: (signals: DecodedCanSignals) => void;

  constructor(profile: VehicleCanProfile, onChange: (s: DecodedCanSignals) => void) {
    this._profile = profile;
    this._onChange = onChange;
  }

  feedLine(line: string): void {
    const frame = parseCanLine(line);
    if (!frame) return;

    const partial = decodeFrame(frame, this._profile);
    if (Object.keys(partial).length === 0) return;

    this._snapshot = { ...this._snapshot, ...partial };
    this._onChange({ ...this._snapshot });
  }

  reset(): void {
    this._snapshot = {};
  }

  getSnapshot(): DecodedCanSignals {
    return { ...this._snapshot };
  }
}
