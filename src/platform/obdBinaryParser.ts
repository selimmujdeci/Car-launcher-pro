/**
 * OBD Binary Fast-Path Parser
 *
 * Motivasyon:
 *   ELM327 poll döngüsünde her 3s'de gelen JSON paketi (~160 byte) Mali-400'de
 *   JSON.parse + nesne tahsisi yapar. Yüksek frekanslı CAN akışında (10-50 Hz)
 *   bu, frame budget'ının %5-8'ini tüketir.
 *
 *   Binary çerçeve: 16 byte sabit boyut — JSON'un %10'u.
 *   DataView: zero-copy erişim, tek pointer hareketi.
 *   JSON.parse tamamen atlanır.
 *
 * Çerçeve Formatı (little-endian, 16 byte):
 *
 *   Offset  Size  Alan            Tür        Ölçek / Offset
 *   ──────  ────  ────────────    ───────    ──────────────────────────────
 *   0       2B    magic           uint16     0xDA7A  — çerçeve doğrulaması
 *   2       1B    version         uint8      1       — format versiyonu
 *   3       1B    field_mask      uint8      bit0=speed, bit1=rpm,
 *                                            bit2=engineTemp, bit3=fuelLevel,
 *                                            bit4=batteryLevel, bit5=headlights
 *   4       2B    speed           uint16     × 0.1 km/h (0–3000 → 0–300 km/h)
 *   6       2B    rpm             uint16     direkt (0–8000)
 *   8       1B    engineTemp      uint8      −40°C offset (0=−40°C, 170=130°C)
 *   9       1B    fuelLevel       uint8      × 0.4% (0–250 → 0–100%)
 *   10      1B    batteryLevel    uint8      × 0.4% (0–250 → 0–100%)
 *   11      1B    flags           uint8      bit0=headlights, bit1=charging
 *   12      4B    padding         —          gelecek alanlar için ayrılmış
 *
 * Bounds Kontrol Stratejisi (CLAUDE.md §2 Buffer Overflow):
 *   - Minimum buffer boyutu: FRAME_SIZE (16 byte) — erişimden önce kontrol
 *   - Her DataView erişimi tam offset + boyut içinde kalmalı
 *   - Magic byte mismatch → null → caller silent-drop yapar
 *   - Değer aralık kontrolü: field_mask'te aktif olmayan alan işlenmez
 */

import type { OBDData } from './obdService';
import { logError } from './crashLogger';

/* ── Çerçeve Sabitleri ───────────────────────────────────────────────────── */

const FRAME_SIZE    = 16;       // minimum geçerli çerçeve boyutu (byte)
const MAGIC         = 0xDA7A;   // 0xDA = "DAta", 0x7A = "cAn" → "DAta cAn"
const FORMAT_VER    = 1;

const FIELD_SPEED       = 1 << 0; // 0x01
const FIELD_RPM         = 1 << 1; // 0x02
const FIELD_ENGINE_TEMP = 1 << 2; // 0x04
const FIELD_FUEL        = 1 << 3; // 0x08
const FIELD_BATTERY     = 1 << 4; // 0x10
const FLAG_HEADLIGHTS   = 1 << 0; // flags byte bit0
// FLAG_CHARGING (bit1) — gelecek versiyonda chargingState derivation için ayrılmış

/* ── Fiziksel Sınır Kontrolleri ─────────────────────────────────────────── */
// ISO 15031-5 §6.3 + araç fizik sınırları

const SPEED_MAX_ENCODED   = 3_000;  // 300.0 km/h × 10
const RPM_MAX             = 8_000;
const ENGINE_TEMP_OFFSET  = 40;     // −40°C baseline
const ENGINE_TEMP_MAX_RAW = 170;    // 170 - 40 = 130°C max
const FUEL_MAX_RAW        = 250;    // 250 × 0.4 = 100%
const BATTERY_MAX_RAW     = 250;

/* ── T507 Parçalı Paket Birikimi ─────────────────────────────────────────── */
// T507 adaptörü 16-byte çerçeveyi 8+8 byte olarak iki ayrı BT paketi halinde
// gönderebilir. Yeterli boyuta ulaşana kadar biriktir.
let _partialBuffer: Uint8Array | null = null;

/** Reconnect ve stopOBD'de birikmiş fragment tamponunu temizler (sızıntı önleme). */
export function clearAccumulatedBuffer(): void {
  _partialBuffer = null;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * 16-byte binary CAN çerçevesini parse eder, OBDData patch olarak döner.
 *
 * Başarısızlık koşulları (null döner):
 *   - Buffer yeterli boyuta ulaşmadı (biriktirildi, sonraki paket bekleniyor)
 *   - Magic byte yanlış
 *   - Bilinmeyen format versiyonu
 *
 * Geçersiz alan değerleri (aralık dışı): field_mask'ten çıkarılır, sessizce atlanır.
 * Caller, null döndüğünde JSON fallback'e geçmeli.
 *
 * @param buffer - ArrayBuffer veya Uint8Array — sıfır kopyalama, direkt erişim
 */
export function parseBinaryOBDFrame(buffer: ArrayBuffer | Uint8Array): Partial<OBDData> | null {
  // ── T507 Parçalı Paket Birleştirme ──────────────────────────────────────
  const incoming = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let workBuffer: Uint8Array;

  if (_partialBuffer !== null) {
    const combined = new Uint8Array(_partialBuffer.length + incoming.length);
    combined.set(_partialBuffer, 0);
    combined.set(incoming, _partialBuffer.length);
    _partialBuffer = null;
    workBuffer = combined;
  } else {
    workBuffer = incoming;
  }

  // Bozuk veya binary olmayan akışta sınırsız büyümeyi engelle
  if (workBuffer.length > FRAME_SIZE * 8) {
    _partialBuffer = null;
    return null;
  }

  if (workBuffer.length < FRAME_SIZE) {
    _partialBuffer = workBuffer; // sonraki paketi bekle
    return null;
  }

  // ── DataView: tek referans, sıfır kopya ─────────────────────────────────
  let view: DataView;
  try {
    view = new DataView(workBuffer.buffer, workBuffer.byteOffset, workBuffer.byteLength);
  } catch {
    return null; // detached buffer guard
  }

  // ── Magic doğrulama ──────────────────────────────────────────────────────
  // Byte 0-1: little-endian uint16
  const magic = view.getUint16(0, true);
  if (magic !== MAGIC) return null;

  // ── Versiyon kontrolü ────────────────────────────────────────────────────
  const version = view.getUint8(2);
  if (version !== FORMAT_VER) {
    // Gelecekte yeni formatlar desteklenebilir; şimdilik bilinmeyeni reddet
    logError('OBDBinary:UnknownVersion', new Error(`format v${version}`));
    return null;
  }

  const fieldMask = view.getUint8(3);
  const flags     = view.getUint8(11);
  const patch: Partial<OBDData> = {};

  // ── Alan: hız ────────────────────────────────────────────────────────────
  if (fieldMask & FIELD_SPEED) {
    const raw = view.getUint16(4, true); // byte 4-5
    if (raw <= SPEED_MAX_ENCODED) {
      patch.speed = raw / 10; // 0.1 km/h hassasiyet
    }
  }

  // ── Alan: devir ──────────────────────────────────────────────────────────
  if (fieldMask & FIELD_RPM) {
    const raw = view.getUint16(6, true); // byte 6-7
    if (raw <= RPM_MAX) {
      patch.rpm = raw;
    }
  }

  // ── Alan: motor sıcaklığı ────────────────────────────────────────────────
  if (fieldMask & FIELD_ENGINE_TEMP) {
    const raw = view.getUint8(8); // byte 8
    if (raw <= ENGINE_TEMP_MAX_RAW) {
      patch.engineTemp = raw - ENGINE_TEMP_OFFSET;
    }
  }

  // ── Alan: yakıt seviyesi ─────────────────────────────────────────────────
  if (fieldMask & FIELD_FUEL) {
    const raw = view.getUint8(9); // byte 9
    if (raw <= FUEL_MAX_RAW) {
      patch.fuelLevel = Math.round(raw * 100 / FUEL_MAX_RAW); // 0-100%
    }
  }

  // ── Alan: batarya seviyesi ───────────────────────────────────────────────
  if (fieldMask & FIELD_BATTERY) {
    const raw = view.getUint8(10); // byte 10
    if (raw <= BATTERY_MAX_RAW) {
      patch.batteryLevel = Math.round(raw * 100 / BATTERY_MAX_RAW);
    }
  }

  // ── Flags ────────────────────────────────────────────────────────────────
  patch.headlights = (flags & FLAG_HEADLIGHTS) !== 0;
  // Future: chargingState derived from FLAG_CHARGING

  return patch;
}

/**
 * Gelen veri binary fast-path için uygun mu?
 * Native plugin binary frame gönderdiğinde data.binaryFrame alanını doldurur.
 *
 * @param data - Native plugin'den gelen ham veri (any, tip kontrolü burada)
 */
export function hasBinaryFrame(data: unknown): data is { binaryFrame: ArrayBuffer | Uint8Array } {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d['binaryFrame'] instanceof ArrayBuffer ||
         d['binaryFrame'] instanceof Uint8Array;
}
