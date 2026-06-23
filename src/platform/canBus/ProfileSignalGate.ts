/**
 * ProfileSignalGate.ts — Patch 3 + 4
 *
 * Profil tabanlı sinyal filtresi + güvenlik katmanı.
 *
 * Patch 3 — Temel gate:
 *   • SafeMode: CAN-only alanları discard et, sadece OBD-II güvenli alanları geçir
 *   • rawCanToAdapterData: DecodedCanSignals → CanAdapterData dönüşümü
 *
 * Patch 4 — Güvenlik katmanı:
 *   • SafeModeReason enum — string'den tipi güçlü koda geçiş
 *   • Spike detection + Source quarantine — bozuk kaynak geçici olarak kapatılır
 *   • Confidence drop debounce — ani mod geçişini engeller (2s)
 *   • Unknown CAN ID rate limiter — spam log önler (5 log / 10s penceresi)
 *   • computeEffectiveConfidence — worker ile aynı formül, main-thread için
 *
 * Dokunulmayan bölgeler:
 *   • VehicleCompute.worker — kendi fusion/debounce mekanizmaları korunur
 *   • SignalNormalizer — confidence sabitlerini buraya kopyalamıyoruz,
 *     SIGNAL_SOURCE_DEFAULTS'u import ediyoruz
 *   • VehicleSignalResolver — applyProfileGate() imzası değişmedi
 */

import type { CanAdapterData }            from '../vehicleDataLayer/types';
import type { HandshakeOutcome }           from './VehicleHandshake';
import type { DecodedCanSignals }          from './RawCanDecoder';
import { SIGNAL_SOURCE_DEFAULTS }          from '../vehicleDataLayer/valTypes';

// ── SafeModeReason enum ───────────────────────────────────────────────────────

export const SafeModeReason = {
  NONE:                   'NONE',
  NO_HANDSHAKE:           'NO_HANDSHAKE',
  LOW_PROFILE_CONFIDENCE: 'LOW_PROFILE_CONFIDENCE',
  NO_VIN_MATCH:           'NO_VIN_MATCH',
  PROFILE_LOAD_FAILED:    'PROFILE_LOAD_FAILED',
  SOURCE_QUARANTINED:     'SOURCE_QUARANTINED',
} as const;

export type SafeModeReason = typeof SafeModeReason[keyof typeof SafeModeReason];

// ── Sabitler ─────────────────────────────────────────────────────────────────

const SAFE_MODE_THRESHOLD     = 0.65;
const SAFE_MODE_DEBOUNCE_MS   = 2_000;  // ani düşüş → 2s bekle

// Quarantine: 3 spike / 1s penceresi → 10s karantina
const QUARANTINE_SPIKE_COUNT  = 3;
const QUARANTINE_WINDOW_MS    = 1_000;
const QUARANTINE_DURATION_MS  = 10_000;

// Rate limiter: max 5 bilinmeyen ID logu / 10s penceresi
const RATE_LIMIT_MAX_LOGS     = 5;
const RATE_LIMIT_WINDOW_MS    = 10_000;

// ── Spike sınırları — değer aralığı dışı → invalid spike ─────────────────────

const SPIKE_LIMITS: Partial<Record<keyof CanAdapterData, { min: number; max: number }>> = {
  speed:       { min: 0,   max: 300   },
  rpm:         { min: 0,   max: 12_000 },
  coolantTemp: { min: -40, max: 150   },
  oilTemp:     { min: -40, max: 200   },
  fuel:        { min: 0,   max: 100   },
  throttle:    { min: 0,   max: 100   },
  batteryVolt: { min: 8,   max: 20    },
};

// ── OBD-II güvenli alanlar (Safe Mode'da geçen) ───────────────────────────────

const OBD_SAFE_FIELDS = new Set<keyof CanAdapterData>([
  'speed', 'rpm', 'coolantTemp', 'fuel', 'throttle', 'oilTemp', 'batteryVolt',
]);

// ── CAN-only alanlar (Safe Mode'da kapatılan) ─────────────────────────────────

const CAN_ONLY_FIELDS: ReadonlyArray<keyof CanAdapterData> = [
  'reverse', 'doorOpen', 'headlightsOn', 'parkingBrake', 'seatbelt',
  'gearPos', 'abs', 'tractionControl', 'stabilityControl',
  'wipers', 'airCondition', 'cruiseControl', 'ambientTemp', 'tpms',
  'highBeam', 'turnLeft', 'turnRight', 'hazard',
];

// ── Karantina: kaynak değil sinyal bazlı ─────────────────────────────────────
// Kaynak bazlı karantina fazla agresiftir: rpm spike'ı speed'i de bloklar.
// Her numeric sinyal alanı bağımsız karantina sayacı tutar.

export type QuarantineSource = 'CAN' | 'OBD' | 'GPS';

interface QuarantineState {
  spikeCount:      number;
  windowStartMs:   number;
  quarantinedUntil: number;  // epoch ms, 0 = aktif değil
}

// ── Modül state (singleton) ───────────────────────────────────────────────────

let _outcome:           HandshakeOutcome | null = null;
// Default: false (pass-through) — handshake Patch 5'te startup akışına bağlanana kadar
// legacy native CAN sinyalleri (reverse/door/gear) kırılmasın.
// setHandshakeOutcome() çağrıldıktan sonra outcome'a göre güncellenir.
let _confirmedSafeMode  = false;
let _safeModeReason:    SafeModeReason = SafeModeReason.NO_HANDSHAKE;
let _blockedFields:     string[] = [];
let _debounceTimer:     ReturnType<typeof setTimeout> | null = null;

// Sinyal bazlı karantina: her spike'lı alan bağımsız izlenir
// key = CanAdapterData field adı (örn. 'rpm', 'speed')
const _signalQuarantine = new Map<string, QuarantineState>();

function _getOrCreateSignalQuarantine(field: string): QuarantineState {
  let state = _signalQuarantine.get(field);
  if (!state) {
    state = { spikeCount: 0, windowStartMs: 0, quarantinedUntil: 0 };
    _signalQuarantine.set(field, state);
  }
  return state;
}

// Rate limiter: canId → { firstSeenAt, logCount }
const _unknownIdLog = new Map<number, { firstSeenAt: number; logCount: number }>();

// ── Dışa açık API ─────────────────────────────────────────────────────────────

/** VehicleHandshake tamamlandıktan sonra çağrılır. */
export function setGateOutcome(outcome: HandshakeOutcome): void {
  const wasSafe = _confirmedSafeMode;
  _outcome = outcome;
  const nowSafe = _rawIsSafeMode();

  if (wasSafe && !nowSafe) {
    // Safe → Normal geçişi: anında onayla (güvenli yön)
    _cancelDebounce();
    _applyNormalMode();
  } else if (!wasSafe && nowSafe) {
    // Normal → Safe geçişi: debounce uygula — ani flip'i önle
    _cancelDebounce();
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      if (_rawIsSafeMode()) _applySafeMode();
    }, SAFE_MODE_DEBOUNCE_MS);
  } else if (nowSafe) {
    // Zaten safe → reason güncelle
    _applySafeMode();
  }
}

/** Mevcut Safe Mode durumu (debounce uygulanmış). */
export function isGateSafeMode(): boolean {
  return _confirmedSafeMode;
}

/** Safe Mode sebebi (enum). */
export function getSafeModeReason(): SafeModeReason {
  return _safeModeReason;
}

/** Safe Mode detayı (human-readable, loglama için). */
export function getSafeModeDetail(): string | null {
  return _confirmedSafeMode ? (_outcome?.reason ?? 'Araç profili bilinmiyor') : null;
}

/** Safe Mode'da kapatılan alan listesi. */
export function getBlockedFields(): readonly string[] {
  return _blockedFields;
}

/**
 * CanAdapterData'yı profile ve karantina durumuna göre filtrele.
 * VehicleSignalResolver.can.onData() içinde çağrılır (Patch 3 bağlantısı).
 *
 * Dönüş: {} (boş) → kaynak karantinadaysa SignalNormalizer hiçbir sinyal üretmez.
 */
export function applyProfileGate(data: CanAdapterData): CanAdapterData {
  // 1. Spike tespiti + sinyal bazlı karantina uygula — kötü alan çıkarılır, diğerleri geçer
  const cleaned = _detectAndFilterSpikes(data);

  // 2. Safe Mode filtresi
  if (_confirmedSafeMode) return _filterToOBDSafe(cleaned);

  return cleaned;
}

/**
 * RawCanDecoder çıktısını CanAdapterData'ya çevir + gate uygula.
 * Bilinmeyen CAN ID'ler rate-limited log ile raporlanır, işlenmez.
 */
export function rawCanToAdapterData(
  signals: DecodedCanSignals,
  unknownIds?: number[],
): CanAdapterData {
  if (unknownIds && unknownIds.length > 0) {
    _rateLimitedLogUnknownIds(unknownIds);
  }

  const raw: CanAdapterData = {
    speed:        signals.speed,
    rpm:          signals.rpm,
    coolantTemp:  signals.coolant,
    fuel:         signals.fuel,
    throttle:     signals.throttle,
    oilTemp:      signals.oilTemp,
    batteryVolt:  signals.battVolt,
    reverse:      signals.reverse,
    doorOpen:     signals.doorFl || signals.doorFr || signals.doorRl || signals.doorRr,
    headlightsOn: signals.headlights,
    parkingBrake: signals.parkingBrake,
    seatbelt:     signals.seatbelt,
  };

  return applyProfileGate(raw);
}

/**
 * Sinyal efektif güveni — main-thread için.
 * Worker'daki _effectiveConf() ile aynı formül; SIGNAL_SOURCE_DEFAULTS'a göre.
 *
 * @param source   Sinyalin kaynağı
 * @param signalTs Sinyalin üretildiği zaman (Date.now() ms)
 * @param nowMs    Şu anki zaman (varsayılan: Date.now())
 */
export function computeEffectiveConfidence(
  source: 'HAL' | 'CAN' | 'OBD' | 'GPS',
  signalTs: number,
  nowMs: number = Date.now(),
): number {
  const cfg = SIGNAL_SOURCE_DEFAULTS[source];
  const age = nowMs - signalTs;
  return cfg.baseConfidence * Math.max(0, 1 - age / cfg.timeoutMs);
}

/**
 * En yüksek efektif güvene sahip kaynağı döner.
 * Worker'ın fusion'unu TAKLIT ETMEZ — sadece gate kararı için kullanılır.
 */
export function selectHighestConfidenceSource(
  candidates: Array<{ source: 'HAL' | 'CAN' | 'OBD' | 'GPS'; signalTs: number }>,
  nowMs: number = Date.now(),
): { source: 'HAL' | 'CAN' | 'OBD' | 'GPS'; confidence: number } | null {
  let best: { source: 'HAL' | 'CAN' | 'OBD' | 'GPS'; confidence: number } | null = null;
  for (const c of candidates) {
    const conf = computeEffectiveConfidence(c.source, c.signalTs, nowMs);
    if (!best || conf > best.confidence) best = { source: c.source, confidence: conf };
  }
  return best;
}

// ── İç yardımcılar ────────────────────────────────────────────────────────────

function _rawIsSafeMode(): boolean {
  if (!_outcome) return true;
  return _outcome.safeMode || _outcome.confidence < SAFE_MODE_THRESHOLD;
}

function _applySafeMode(): void {
  const prevReason = _safeModeReason;
  _confirmedSafeMode = true;
  _blockedFields     = [...CAN_ONLY_FIELDS];
  _safeModeReason    = _resolveSafeModeReason();

  if (prevReason !== _safeModeReason || !_confirmedSafeMode) {
    console.warn(
      `[ProfileSignalGate] Safe Mode aktif [${_safeModeReason}] — ` +
      `${_blockedFields.length} CAN sinyal kapatıldı. Detay: ${_outcome?.reason ?? '—'}`,
    );
  }
}

function _applyNormalMode(): void {
  _confirmedSafeMode = false;
  _blockedFields     = [];
  _safeModeReason    = SafeModeReason.NONE;
  _info(`Normal mod — profil: ${_outcome?.profile.id ?? '?'} (conf=${_outcome?.confidence.toFixed(2) ?? '?'})`);
}

function _resolveSafeModeReason(): SafeModeReason {
  if (!_outcome)                               return SafeModeReason.NO_HANDSHAKE;
  if (_outcome.profile.id === 'standard_obd') {
    if (!_outcome.vin)                         return SafeModeReason.NO_VIN_MATCH;
    if (_outcome.confidence < SAFE_MODE_THRESHOLD) return SafeModeReason.LOW_PROFILE_CONFIDENCE;
    return SafeModeReason.PROFILE_LOAD_FAILED;
  }
  if (_outcome.confidence < SAFE_MODE_THRESHOLD) return SafeModeReason.LOW_PROFILE_CONFIDENCE;
  return SafeModeReason.LOW_PROFILE_CONFIDENCE;
}

function _cancelDebounce(): void {
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
}

function _filterToOBDSafe(data: CanAdapterData): CanAdapterData {
  const safe: CanAdapterData = {};
  for (const key of OBD_SAFE_FIELDS) {
    const val = data[key];
    if (val !== undefined) (safe as Record<string, unknown>)[key] = val;
  }
  return safe;
}

// ── Spike tespiti + Sinyal bazlı karantina ───────────────────────────────────
//
// Her alan bağımsız izlenir: rpm spike'ı speed'i bloklamaz.
// 3 spike / 1s → o alan 10s karantinaya alınır → o frame'de undefined döner.

/**
 * Data'daki her numeric alanı spike sınırlarına göre kontrol eder.
 * Spike'lı alan karantinaya alınır → kopyada undefined olarak bırakılır.
 * Karantinası dolmuş alanlar otomatik serbest bırakılır.
 * Diğer tüm alanlar dokunulmadan geçer.
 */
function _detectAndFilterSpikes(data: CanAdapterData): CanAdapterData {
  const now    = Date.now();
  let   result = data as Record<string, unknown>;
  let   copied = false;  // lazy copy — sıfır spike'ta allocation yok

  for (const [field, limits] of Object.entries(SPIKE_LIMITS) as Array<[keyof CanAdapterData, { min: number; max: number }]>) {
    const val = data[field];

    // Boolean veya undefined alanları atla
    if (typeof val !== 'number') continue;

    const state = _getOrCreateSignalQuarantine(field);

    // Karantina süresi dolmuşsa serbest bırak
    if (state.quarantinedUntil > 0 && now >= state.quarantinedUntil) {
      state.quarantinedUntil = 0;
      state.spikeCount       = 0;
      _info(`Sinyal karantina bitti: ${field}`);
    }

    // Aktif karantinadaki alanı discard et
    if (state.quarantinedUntil > 0) {
      if (!copied) { result = { ...data }; copied = true; }
      delete result[field];
      continue;
    }

    // Değer aralıkta — spike sayacı penceresini sıfırla gerekirse
    if (val >= limits.min && val <= limits.max) {
      if (now - state.windowStartMs > QUARANTINE_WINDOW_MS) {
        state.spikeCount    = 0;
        state.windowStartMs = now;
      }
      continue;
    }

    // SPIKE tespit edildi
    _info(`Spike: ${field}=${val} (aralık ${limits.min}–${limits.max})`);
    if (!copied) { result = { ...data }; copied = true; }
    delete result[field];  // bu frame'de discard

    if (now - state.windowStartMs > QUARANTINE_WINDOW_MS) {
      state.spikeCount    = 1;
      state.windowStartMs = now;
    } else {
      state.spikeCount++;
    }

    if (state.spikeCount >= QUARANTINE_SPIKE_COUNT) {
      state.quarantinedUntil = now + QUARANTINE_DURATION_MS;
      state.spikeCount       = 0;
      state.windowStartMs    = now;
      console.warn(
        `[ProfileSignalGate] Sinyal karantinaya alındı: ${field} ` +
        `(${QUARANTINE_SPIKE_COUNT} spike / ${QUARANTINE_WINDOW_MS}ms) — ` +
        `${QUARANTINE_DURATION_MS / 1000}s`,
      );
    }
  }

  return result as CanAdapterData;
}

/** Dışa açık — belirli bir sinyalin karantina durumunu sorgula */
export function isSourceQuarantined(source: QuarantineSource): boolean {
  // Eski API uyumluluğu — kaynak bazlı sorgu: o kaynağın HERHANGİ alanı karantinada mı?
  // Sadece CAN alanları izleniyor; source tipi şimdilik tek anlamlı.
  void source;
  const now = Date.now();
  for (const state of _signalQuarantine.values()) {
    if (state.quarantinedUntil > 0 && now < state.quarantinedUntil) return true;
  }
  return false;
}

// ── Bilinmeyen CAN ID rate limiter ────────────────────────────────────────────

// Harita büyüklük limiti — CAN bus binlerce ID üretebilir, sınırsız büyüme önlenir
const RATE_LIMIT_MAP_CAP = 256;

function _rateLimitedLogUnknownIds(ids: number[]): void {
  const now = Date.now();

  // Cap: limiti aşmadan önce haritayı temizle (eski pencereler gitti)
  if (_unknownIdLog.size >= RATE_LIMIT_MAP_CAP) {
    for (const [id, entry] of _unknownIdLog) {
      if (now - entry.firstSeenAt > RATE_LIMIT_WINDOW_MS) {
        _unknownIdLog.delete(id);
        if (_unknownIdLog.size < RATE_LIMIT_MAP_CAP) break;
      }
    }
    // Hâlâ dolu → tüm haritayı temizle (bellek > log kalitesi)
    if (_unknownIdLog.size >= RATE_LIMIT_MAP_CAP) {
      _unknownIdLog.clear();
    }
  }

  for (const id of ids) {
    let entry = _unknownIdLog.get(id);
    if (!entry) {
      if (_unknownIdLog.size >= RATE_LIMIT_MAP_CAP) continue; // cap doluysa yeni entry açma
      entry = { firstSeenAt: now, logCount: 0 };
      _unknownIdLog.set(id, entry);
    }

    // Pencere süresi geçtiyse sıfırla
    if (now - entry.firstSeenAt > RATE_LIMIT_WINDOW_MS) {
      entry.firstSeenAt = now;
      entry.logCount    = 0;
    }

    if (entry.logCount < RATE_LIMIT_MAX_LOGS) {
      entry.logCount++;
      _info(`Bilinmeyen CAN ID (işlenmedi): 0x${id.toString(16).toUpperCase().padStart(3, '0')}`);
    } else if (entry.logCount === RATE_LIMIT_MAX_LOGS) {
      entry.logCount++; // bir kez "susturuldu" logu yaz, sonra sessiz
      _info(
        `CAN ID 0x${id.toString(16).toUpperCase().padStart(3, '0')} ` +
        `susturuldu — ${RATE_LIMIT_WINDOW_MS / 1000}s penceresi dolana kadar`,
      );
    }
    // entry.logCount > RATE_LIMIT_MAX_LOGS → sessiz
  }
}

// ── Log yardımcıları ──────────────────────────────────────────────────────────


function _info(msg: string): void {
  if (import.meta.env.DEV) console.info(`[ProfileSignalGate] ${msg}`);
}
