/**
 * boxProtocol testleri — Raise/Hiworld dekoder-kutusu UART çözücü (Faz 4).
 *
 * Framing + checksum + belgelenen payload'lar DETERMİNİSTİK doğrulanır (cihaz
 * gerekmez). Framing canbox referansına dayanır; bu testler o wire-format'ın
 * doğru uygulandığını kilitler. Sinyal byte-map'leri experimental — testler
 * belgelenen düzeni doğrular, firmware-özel doğrulama saha-capture ile yapılır.
 */
import { describe, it, expect } from 'vitest';
import {
  BoxFrameParser, raiseChecksum, hiworldChecksum,
  BoxCanDecoder, BOX_PROTOCOLS, listBoxProtocols,
  type BoxFrame,
} from '../platform/canBus/boxProtocol';

// ── Test yardımcıları: geçerli frame kurucular (parser konvansiyonuyla simetrik) ──
function buildRaise(type: number, data: number[]): Uint8Array {
  const size = data.length;
  const chk = raiseChecksum(type, size, Uint8Array.from(data));
  return Uint8Array.from([0x2e, type, size, ...data, chk]);
}
function buildHiworld(type: number, data: number[]): Uint8Array {
  const size = data.length;
  const chk = hiworldChecksum(type, size, Uint8Array.from(data));
  return Uint8Array.from([0x5a, 0xa5, size, type, ...data, chk]);
}

describe('BoxFrameParser — Raise framing', () => {
  it('geçerli frame çözülür (type + data doğru)', () => {
    const frames: BoxFrame[] = [];
    const p = new BoxFrameParser(BOX_PROTOCOLS.raise.framing, (f) => frames.push(f));
    p.feed(buildRaise(0x41, [0x02, 0x0b, 0xb8, 0x00, 0x50]));
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(0x41);
    expect(Array.from(frames[0].data)).toEqual([0x02, 0x0b, 0xb8, 0x00, 0x50]);
  });

  it('parçalı (split) besleme yeniden birleştirilir', () => {
    const frames: BoxFrame[] = [];
    const p = new BoxFrameParser(BOX_PROTOCOLS.raise.framing, (f) => frames.push(f));
    const full = buildRaise(0x41, [0x02, 0x0b, 0xb8, 0x00, 0x50]);
    p.feed(full.slice(0, 3));   // sync+type+size
    expect(frames).toHaveLength(0);
    p.feed(full.slice(3));      // data+checksum
    expect(frames).toHaveLength(1);
  });

  it('bozuk checksum reddedilir, sonraki geçerli frame yakalanır (resync)', () => {
    const frames: BoxFrame[] = [];
    const p = new BoxFrameParser(BOX_PROTOCOLS.raise.framing, (f) => frames.push(f));
    const bad = buildRaise(0x41, [0x02, 0x0b, 0xb8, 0x00, 0x50]);
    bad[bad.length - 1] ^= 0xff; // checksum boz
    p.feed(bad);
    p.feed(buildRaise(0x24, [0x01, 0x02, 0x03]));
    expect(frames.map((f) => f.type)).toEqual([0x24]);
  });

  it('önündeki çöp byte\'lar atlanır (sync hizalama)', () => {
    const frames: BoxFrame[] = [];
    const p = new BoxFrameParser(BOX_PROTOCOLS.raise.framing, (f) => frames.push(f));
    p.feed([0xff, 0x00, 0x99]); // çöp
    p.feed(buildRaise(0x41, [0x02, 0x00, 0x00, 0x00, 0x00]));
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(0x41);
  });
});

describe('BoxFrameParser — Hiworld framing', () => {
  it('geçerli frame çözülür (size-type sırası)', () => {
    const frames: BoxFrame[] = [];
    const p = new BoxFrameParser(BOX_PROTOCOLS.hiworld.framing, (f) => frames.push(f));
    p.feed(buildHiworld(0x12, [0x00, 0x00, 0xc0, 0, 0, 0, 0]));
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe(0x12);
    expect(frames[0].data.length).toBe(7);
  });

  it('iki frame arka arkaya akışta çözülür', () => {
    const frames: BoxFrame[] = [];
    const p = new BoxFrameParser(BOX_PROTOCOLS.hiworld.framing, (f) => frames.push(f));
    const a = buildHiworld(0x12, [0, 0, 0x80, 0, 0, 0, 0]);
    const b = buildHiworld(0x12, [0, 0, 0x00, 0, 0, 0, 0]);
    p.feed(Uint8Array.from([...a, ...b]));
    expect(frames).toHaveLength(2);
  });
});

describe('checksum formülleri (canbox referansı)', () => {
  it('Raise: (type+size+Σdata) XOR 0xFF', () => {
    // type=0x41 size=1 data=[0x00] → (0x41+1+0)=0x42 → ^0xFF = 0xBD
    expect(raiseChecksum(0x41, 1, Uint8Array.from([0x00]))).toBe(0xbd);
  });
  it('Hiworld: (size+type+Σdata) − 1', () => {
    // size=1 type=0x12 data=[0x00] → (1+0x12+0)=0x13 → −1 = 0x12
    expect(hiworldChecksum(0x12, 1, Uint8Array.from([0x00]))).toBe(0x12);
  });
});

describe('sinyal çözümü (belgelenen payload düzeni)', () => {
  it('Raise 0x41: RPM + hız doğru çözülür ve sınır dışı düşürülür', () => {
    let snap: Record<string, unknown> = {};
    const dec = new BoxCanDecoder('raise', (s) => { snap = s as Record<string, unknown>; });
    // RPM=0x0BB8=3000, Speed=0x0050=80
    dec.feed(buildRaise(0x41, [0x02, 0x0b, 0xb8, 0x00, 0x50]));
    expect(snap.rpm).toBe(3000);
    expect(snap.speed).toBe(80);
  });

  it('Raise 0x41: imkânsız RPM (>12000) gösterilmez (yanlış-ölçek koruması)', () => {
    let snap: Record<string, unknown> = {};
    const dec = new BoxCanDecoder('raise', (s) => { snap = s as Record<string, unknown>; });
    dec.feed(buildRaise(0x41, [0x02, 0xff, 0xff, 0x00, 0x50])); // RPM=65535
    expect(snap.rpm).toBeUndefined();
    expect(snap.speed).toBe(80); // hız yine geçerli
  });

  it('Hiworld 0x12: kapı bit maskesi doğru çözülür', () => {
    let snap: Record<string, unknown> = {};
    const dec = new BoxCanDecoder('hiworld', (s) => { snap = s as Record<string, unknown>; });
    // data[2] = FL(0x80) | RR(0x10) = 0x90 → FL ve RR açık
    dec.feed(buildHiworld(0x12, [0, 0, 0x90, 0, 0, 0, 0]));
    expect(snap.doorFl).toBe(true);
    expect(snap.doorRr).toBe(true);
    expect(snap.doorFr).toBe(false);
    expect(snap.doorRl).toBe(false);
  });
});

describe('registry', () => {
  it('Raise ve Hiworld kayıtlı ve deneysel işaretli', () => {
    const ids = listBoxProtocols().map((p) => p.id).sort();
    expect(ids).toEqual(['hiworld', 'raise']);
    expect(listBoxProtocols().every((p) => p.safetyLevel === 'experimental')).toBe(true);
  });
});
