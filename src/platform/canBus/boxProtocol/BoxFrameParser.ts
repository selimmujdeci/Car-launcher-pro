/**
 * BoxFrameParser — Aftermarket CANbus DEKODER KUTUSU seri (UART) protokol çözücü.
 *
 * Bağlam: Head unit aracın CAN'ine doğrudan bağlanmaz — araya Raise/Hiworld/NWD
 * gibi bir "dekoder kutusu" girer; kutu araç CAN'ini kendi UART frame'ine çevirir.
 * NWD/SimpleSoft bizde NATIVE çözülür; bu modül Raise/Hiworld gibi framed-UART
 * kutularını TS tarafında çözer (§HEAD_UNIT_MATRIX §5).
 *
 * Framing KAYNAĞI: açık kaynak smartgauges/canbox referans firmware'inin
 * belgelediği wire-format (protokol = telifsiz arayüz gerçeği; C kodu KOPYALANMADI):
 *   Raise    : [0x2E][type][size][data…][chk]   chk = (type+size+Σdata) XOR 0xFF
 *   Hiworld  : [0x5A 0xA5][size][type][data…][chk]  chk = (size+type+Σdata) − 1
 *   (size = payload/data byte sayısı; type ayrı)
 *
 * ⚠️ Framing + checksum BİRİM-TEST'li (deterministik). Sinyal byte-map'leri
 * (boxProtocols.ts) canbox-referanslı ama firmware sürümüne göre değişebilir →
 * saha frame-capture ile DOĞRULANMALI. READ-ONLY: hiçbir yazma/kontrol yok.
 */

export interface BoxFrame {
  /** Mesaj tip byte'ı (ör. Raise 0x41 = araç bilgisi, Hiworld 0x12 = kapı). */
  type: number;
  /** Payload byte'ları (checksum ve başlık hariç). */
  data: Uint8Array;
}

export type BoxByteOrder = 'type-size' | 'size-type';

export interface BoxFramingConfig {
  /** Senkron/başlık byte'ları: Raise [0x2E], Hiworld [0x5A, 0xA5]. */
  sync: number[];
  /** Sync'ten sonraki iki byte'ın sırası. */
  order: BoxByteOrder;
  /** Checksum: (type, size, data) → beklenen checksum byte'ı (0–255). */
  checksum: (type: number, size: number, data: Uint8Array) => number;
}

/** buf içinde sync dizisinin ilk TAM eşleşme indeksi; yoksa −1. */
function indexOfSync(buf: number[], sync: number[]): number {
  outer: for (let i = 0; i + sync.length <= buf.length; i++) {
    for (let j = 0; j < sync.length; j++) {
      if (buf[i + j] !== sync[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// Bozuk/eşleşmeyen akışta buffer sınırsız büyümesin (kötü niyetli/gürültülü hat).
const MAX_BUFFER = 512;

export class BoxFrameParser {
  private _buf: number[] = [];
  private readonly _cfg: BoxFramingConfig;
  private readonly _onFrame: (frame: BoxFrame) => void;

  constructor(cfg: BoxFramingConfig, onFrame: (frame: BoxFrame) => void) {
    this._cfg = cfg;
    this._onFrame = onFrame;
  }

  /** Ham byte akışını besle (kısmi/parçalı okumalar biriktirilir). */
  feed(bytes: Uint8Array | number[]): void {
    for (let i = 0; i < bytes.length; i++) this._buf.push(bytes[i] & 0xff);
    if (this._buf.length > MAX_BUFFER) {
      // Baştan taşan kısmı at — olası kısmi frame'i (son MAX_BUFFER) koru.
      this._buf.splice(0, this._buf.length - MAX_BUFFER);
    }
    this._drain();
  }

  reset(): void {
    this._buf.length = 0;
  }

  private _drain(): void {
    const sync = this._cfg.sync;
    const headerLen = sync.length + 2; // sync + (type,size)

    // Sonsuz döngü koruması: her tur ya frame emit eder ya en az 1 byte atar.
    for (;;) {
      if (this._buf.length < sync.length) return;

      const idx = indexOfSync(this._buf, sync);
      if (idx === -1) {
        // Tam sync yok — olası kısmi sync (son sync.length−1 byte) dışında hepsini at.
        if (this._buf.length >= sync.length) {
          this._buf.splice(0, this._buf.length - (sync.length - 1));
        }
        return;
      }
      if (idx > 0) this._buf.splice(0, idx); // sync başa gelene kadar çöpü at

      if (this._buf.length < headerLen) return; // type+size henüz gelmedi

      const b0 = this._buf[sync.length];
      const b1 = this._buf[sync.length + 1];
      const type = this._cfg.order === 'type-size' ? b0 : b1;
      const size = this._cfg.order === 'type-size' ? b1 : b0;

      const frameLen = headerLen + size + 1; // + data + checksum
      if (this._buf.length < frameLen) return; // tam frame henüz gelmedi

      const data = Uint8Array.from(this._buf.slice(headerLen, headerLen + size));
      const chk = this._buf[frameLen - 1];
      const expected = this._cfg.checksum(type, size, data) & 0xff;

      if (chk === expected) {
        this._onFrame({ type, data });
        this._buf.splice(0, frameLen);
      } else {
        // Checksum tutmadı → sahte sync olabilir; 1 byte at ve yeniden hizalan.
        this._buf.splice(0, 1);
      }
    }
  }
}

/** Raise checksum: (type + size + Σdata) XOR 0xFF. */
export function raiseChecksum(type: number, size: number, data: Uint8Array): number {
  let sum = (type + size) & 0xff;
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]) & 0xff;
  return sum ^ 0xff;
}

/** Hiworld checksum: (size + type + Σdata) − 1. */
export function hiworldChecksum(type: number, size: number, data: Uint8Array): number {
  let sum = (size + type) & 0xff;
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]) & 0xff;
  return (sum - 1) & 0xff;
}
