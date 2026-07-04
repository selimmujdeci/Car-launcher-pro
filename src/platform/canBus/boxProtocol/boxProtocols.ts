/**
 * boxProtocols.ts — Raise / Hiworld dekoder-kutusu protokol tanımları + sinyal çözümü.
 *
 * BoxFrameParser ham UART byte akışını doğrulanmış BoxFrame'lere böler; buradaki
 * `decode()` fonksiyonları frame'i DecodedCanSignals'a çevirir (RawCanDecoder ile
 * AYNI çıktı şekli → aşağı akış değişmez).
 *
 * ⚠️ safetyLevel: 'experimental' — framing/checksum canbox referansıyla BİRİM-TEST'li,
 * ANCAK sinyal byte-map'leri (scale/offset/bit) firmware sürümüne göre değişebilir.
 * Değerler yine de RawCanDecoder ile aynı fiziksel sınırlarda doğrulanır (out-of-range
 * → düşürülür), böylece yanlış-ölçek bir değer GÖSTERİLMEZ (otomotiv güvenliği).
 * Canlı kullanım öncesi saha frame-capture ile firmware başına DOĞRULANMALI.
 */

import type { DecodedCanSignals } from '../RawCanDecoder';
import {
  BoxFrameParser, raiseChecksum, hiworldChecksum,
  type BoxFrame, type BoxFramingConfig,
} from './BoxFrameParser';

export type BoxProtocolId = 'raise' | 'hiworld';

export interface BoxProtocolDef {
  id: BoxProtocolId;
  label: string;
  framing: BoxFramingConfig;
  decode: (frame: BoxFrame) => Partial<DecodedCanSignals>;
  /** Tümü deneysel — byte-map firmware'e göre değişir, saha-capture ile doğrula. */
  safetyLevel: 'experimental';
}

// ── Sınır doğrulaması (RawCanDecoder ile aynı fiziksel aralıklar) ──────────────
const inRange = (v: number, lo: number, hi: number): number | null =>
  (v >= lo && v <= hi) ? v : null;

// ── Raise ──────────────────────────────────────────────────────────────────────
// Vehicle info (type 0x41) payload (canbox referansı):
//   [0x02, RPM_H, RPM_L, Spd_H, Spd_L, V_H, V_L, T_H, T_L, Odo_H, Odo_M, Odo_L, Fuel]
function decodeRaise(frame: BoxFrame): Partial<DecodedCanSignals> {
  const d = frame.data;
  const out: Partial<DecodedCanSignals> = {};

  if (frame.type === 0x41 && d.length >= 5) {
    const rpm = inRange((d[1] << 8) | d[2], 0, 12000);
    if (rpm !== null) out.rpm = rpm;
    const speed = inRange((d[3] << 8) | d[4], 0, 300);
    if (speed !== null) out.speed = speed;

    if (d.length >= 7) {
      // Voltaj ölçeği firmware'e göre ×1 veya ×0.1 → aralıkta olanı seç.
      const vRaw = (d[5] << 8) | d[6];
      const v = inRange(vRaw, 8, 20) ?? inRange(vRaw / 10, 8, 20);
      if (v !== null) out.battVolt = v;
    }
    if (d.length >= 9) {
      // Sıcaklık ekseni firmware'e göre ham veya −40 offset → aralıkta olanı seç.
      const tRaw = (d[7] << 8) | d[8];
      const t = inRange(tRaw - 40, -40, 150) ?? inRange(tRaw, -40, 150);
      if (t !== null) out.coolant = t;
    }
    if (d.length >= 13) {
      const fuel = inRange(d[12], 0, 100);
      if (fuel !== null) out.fuel = fuel;
    }
  }
  // NOT: Raise type 0x24 (kapı/vites/ışık) bit düzeni referansta belirsiz —
  // uydurmuyoruz; saha-capture ile netleşince eklenecek (sahte tamamlama yok).
  return out;
}

// ── Hiworld ─────────────────────────────────────────────────────────────────────
// Door status (type 0x12) payload: data[2] bit maskesi (canbox referansı).
const HW_DOOR = { FL: 0x80, FR: 0x40, RL: 0x20, RR: 0x10, TAILGATE: 0x08, BONNET: 0x04 };
function decodeHiworld(frame: BoxFrame): Partial<DecodedCanSignals> {
  const d = frame.data;
  const out: Partial<DecodedCanSignals> = {};

  if (frame.type === 0x12 && d.length >= 3) {
    const s = d[2];
    out.doorFl = (s & HW_DOOR.FL) !== 0;
    out.doorFr = (s & HW_DOOR.FR) !== 0;
    out.doorRl = (s & HW_DOOR.RL) !== 0;
    out.doorRr = (s & HW_DOOR.RR) !== 0;
  }
  return out;
}

// ── Registry ─────────────────────────────────────────────────────────────────────
export const BOX_PROTOCOLS: Record<BoxProtocolId, BoxProtocolDef> = {
  raise: {
    id: 'raise',
    label: 'Raise (VW PQ/MQB sınıfı)',
    framing: { sync: [0x2e], order: 'type-size', checksum: raiseChecksum },
    decode: decodeRaise,
    safetyLevel: 'experimental',
  },
  hiworld: {
    id: 'hiworld',
    label: 'Hiworld (VW MQB sınıfı)',
    framing: { sync: [0x5a, 0xa5], order: 'size-type', checksum: hiworldChecksum },
    decode: decodeHiworld,
    safetyLevel: 'experimental',
  },
};

export function listBoxProtocols(): BoxProtocolDef[] {
  return Object.values(BOX_PROTOCOLS);
}

/**
 * BoxCanDecoder — bir kutu protokolü için ham byte akışını sürekli çözer.
 * RawCanDecoder.CanStreamDecoder ile aynı arayüz deseni: feed → onChange(snapshot).
 * Transport (native seri byte'ları TS'e taşıma) AYRIDIR; bu sınıf saf çözücüdür.
 */
export class BoxCanDecoder {
  private readonly _parser: BoxFrameParser;
  private _snapshot: DecodedCanSignals = {};

  constructor(
    protocol: BoxProtocolId,
    onChange: (signals: DecodedCanSignals) => void,
  ) {
    const def = BOX_PROTOCOLS[protocol];
    this._parser = new BoxFrameParser(def.framing, (frame) => {
      const partial = def.decode(frame);
      if (Object.keys(partial).length === 0) return;
      this._snapshot = { ...this._snapshot, ...partial };
      onChange({ ...this._snapshot });
    });
  }

  feed(bytes: Uint8Array | number[]): void {
    this._parser.feed(bytes);
  }

  reset(): void {
    this._parser.reset();
    this._snapshot = {};
  }

  getSnapshot(): DecodedCanSignals {
    return { ...this._snapshot };
  }
}
