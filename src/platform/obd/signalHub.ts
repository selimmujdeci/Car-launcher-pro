/**
 * signalHub — PR-OBD-KWP-1: TEK OTORİTER SİNYAL OKUMA YÜZEYİ.
 *
 * KÖK SORUN: araç verisi üç ayrı depoda yaşıyordu (core → obdService `_current`,
 * extended → extendedPidService `_values`, üretici → manufacturerPidService `_values`)
 * ve her tüketici (UI panelleri, sesli asistan, verdict/prediction) kendi ad-hoc
 * erişimini kuruyordu — provenance/tazelik/confidence tutarsız, "0 mı no-data mı"
 * ayrımı tüketiciye kalmıştı.
 *
 * BU MODÜL depoları TAŞIMAZ (hot-path'e dokunmak yok — 3 Hz yolu aynen akar);
 * okuma anında tek tip {@link SignalEnvelope} zarfı üretir (PULL tabanlı → boşta
 * sıfır maliyet, çağrı başına tek küçük nesne; V8 şekli sabit).
 *
 * SÖZLEŞME (değişmez kurallar):
 *  - SAHTE DEĞER YOK: zarf yalnız depolardaki gerçek ölçümden türetilir.
 *  - "0" ≠ "no_data": değer yoksa value:null (wrapSignal garantisi).
 *  - unsupported / no_data / stale / valid AYRIŞIR — her durumun kanıtı vardır
 *    (bitmap keşfi, native NO_DATA demote, tazelik).
 *  - Her zarf source + updatedAt + ageMs + confidence taşır (provenance).
 *
 * Sinyal adresleme:
 *  - Core:      'speed' | 'rpm' | 'coolant' | 'fuel' | 'throttle' | 'intakeTemp'
 *               | 'boost' | 'voltage'
 *  - Extended:  'pid:5C' (Mode 01 PID hex)
 *  - Üretici:   'did:F190' (Servis 22 DID) / 'did:80' (Servis 21 LID)
 */

import { getOBDDataSnapshot } from '../obdService';
import { getPidValue, getPidStatus } from './extendedPidService';
import { getDidValue, isDidSupported, hasProfile } from './manufacturerPidService';
import { STANDARD_PID_MAP } from './StandardPidRegistry';
import { wrapSignal, type SignalEnvelope, type SignalSource, type SignalState } from './signalEnvelope';

/** Core sinyal tanımı — OBDData alanı + birim + negatif konvansiyonu. */
interface CoreSignalDef {
  field: 'speed' | 'rpm' | 'engineTemp' | 'fuelLevel' | 'throttle' | 'intakeTemp' | 'boostPressure' | 'batteryVoltage';
  unit: string;
  /** -1 = "desteklenmiyor" konvansiyonu bu alanda geçerli mi (speed'de değil: 0 tabanlı). */
  negativeMeansUnsupported: boolean;
  min?: number;
  max?: number;
}

const CORE_SIGNALS: Readonly<Record<string, CoreSignalDef>> = {
  speed:      { field: 'speed',          unit: 'km/h', negativeMeansUnsupported: false, min: 0,   max: 300 },
  rpm:        { field: 'rpm',            unit: 'rpm',  negativeMeansUnsupported: true,  min: 0,   max: 9000 },
  coolant:    { field: 'engineTemp',     unit: '°C',   negativeMeansUnsupported: true,  min: -40, max: 150 },
  fuel:       { field: 'fuelLevel',      unit: '%',    negativeMeansUnsupported: true,  min: 0,   max: 100 },
  throttle:   { field: 'throttle',       unit: '%',    negativeMeansUnsupported: true,  min: 0,   max: 100 },
  intakeTemp: { field: 'intakeTemp',     unit: '°C',   negativeMeansUnsupported: true,  min: -40, max: 120 },
  boost:      { field: 'boostPressure',  unit: 'kPa',  negativeMeansUnsupported: true,  min: 0,   max: 400 },
  voltage:    { field: 'batteryVoltage', unit: 'V',    negativeMeansUnsupported: true,  min: 5,   max: 16 },
};

/** Değersiz zarf — state kanıta göre çağıran tarafından seçilir. */
function deadEnvelope(state: SignalState, source: SignalSource, unit: string): SignalEnvelope {
  return { value: null, state, confidence: 0, source, updatedAt: 0, ageMs: 0, unit };
}

/**
 * Tek otoriter sinyal okuması. Bilinmeyen kimlik → no_data zarfı (fırlatmaz — çağıranın
 * yazım hatası sahte alarm üretmesin; value:null zaten "kullanma" demektir).
 */
export function readSignal(id: string, nowMs = Date.now()): SignalEnvelope {
  // ── Extended: 'pid:XX' ────────────────────────────────────────────────────
  if (id.startsWith('pid:')) {
    const pid = id.slice(4).toUpperCase();
    const def = STANDARD_PID_MAP.get(pid);
    const unit = def?.unit ?? '';
    const status = getPidStatus(pid);
    if (status === 'unsupported') return deadEnvelope('unsupported', 'obd', unit);
    if (status === 'no_data') return deadEnvelope('no_data', 'obd', unit);
    const v = getPidValue(pid);
    if (!v) return deadEnvelope('no_data', 'obd', unit);
    return wrapSignal({
      raw: v.value, source: 'obd', unit, updatedAt: v.updatedAt, nowMs,
      // Extended değerler StandardPidRegistry'de zaten sınır-denetimli decode edilir;
      // negatif konvansiyonu BURADA UYGULANMAZ (yakıt trim gibi gerçek negatifler var).
      negativeMeansUnsupported: false,
      min: def?.min, max: def?.max,
    });
  }

  // ── Üretici: 'did:XXXX' / 'did:XX' ───────────────────────────────────────
  if (id.startsWith('did:')) {
    const did = id.slice(4).toUpperCase();
    const v = getDidValue(did);
    if (v) {
      // Metin DID'i (VIN vb.) sayısal zarfa sığmaz — varlığı 'valid', değeri null-dışı
      // gösterilemez; sayısal olmayanlar için değer null + valid yerine: metinler UI'da
      // doğrudan servis API'sinden okunur. Burada yalnız SAYISAL değere zarf verilir.
      if (typeof v.value === 'number') {
        return wrapSignal({
          raw: v.value, source: 'obd', unit: v.def.unit, updatedAt: v.updatedAt, nowMs,
          negativeMeansUnsupported: false, min: v.def.min, max: v.def.max,
        });
      }
      return deadEnvelope('no_data', 'obd', v.def.unit); // metin DID — sayısal sinyal değil
    }
    if (!hasProfile()) return deadEnvelope('no_data', 'obd', '');
    if (isDidSupported(did) === false) return deadEnvelope('unsupported', 'obd', '');
    return deadEnvelope('no_data', 'obd', '');
  }

  // ── Core ──────────────────────────────────────────────────────────────────
  const def = CORE_SIGNALS[id];
  if (!def) return deadEnvelope('no_data', 'obd', '');
  const snap = getOBDDataSnapshot();
  const raw = snap[def.field];
  const source: SignalSource = snap.source === 'mock' ? 'mock' : 'obd';
  return wrapSignal({
    raw: raw ?? null, source, unit: def.unit,
    updatedAt: snap.lastSeenMs, nowMs,
    negativeMeansUnsupported: def.negativeMeansUnsupported,
    min: def.min, max: def.max,
  });
}

/** Bilinen core sinyal kimlikleri (UI listeleri için). */
export function coreSignalIds(): string[] {
  return Object.keys(CORE_SIGNALS);
}
