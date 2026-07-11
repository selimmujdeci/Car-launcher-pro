/**
 * vehicleHal — Vehicle Hardware Abstraction Layer (HAL) — FOUNDATION.
 *
 * AMAÇ: CarOS Pro'daki TÜM modüllerin araçla YALNIZ bu katman üzerinden konuşmasını
 * sağlayan tek resmi arayüz. Deep Scan · AI · Navigation · Fleet · Remote · Dashboard
 * ve gelecekteki modüller CAN/ELM327/Hiworld/Native katmanlarını BİLMEZ; yalnız
 * `vehicle.getSignal(id)` / `getSpeed()` gibi standart API'yi kullanır.
 *
 * ⚠️ BUGÜNKÜ DURUM (salt-okunur analiz): Araç verisi Native VHAL (`NativeHALAdapter`) ·
 * CAN (`CanAdapter` → Hiworld/K24/NWD) · OBD (`ObdAdapter` → ELM327) · GPS'ten gelir;
 * `SignalNormalizer` → VAL `NormalizedVehicleData` → `VehicleCompute.worker` füzyonu →
 * `VehicleState` (SAB/postMessage) → `UnifiedVehicleStore`. Aynı veri ~40 dosyada
 * `useUnifiedVehicleStore` + Assistant Context + Battery Service + gauge SAB ile AYRI
 * AYRI okunuyor; per-signal quality/confidence/source/stale/supported/unit veren ORTAK
 * bir `getSignal` API'si YOK. Vehicle HAL bu boşluğu doldurur.
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız FOUNDATION'dır):
 *  - Araç verisi ÜRETMEZ · YORUMLAMAZ (magic sanity eşiği yok, yalnız tip doğrulama).
 *  - Kaynağı GİZLER: hiçbir tüketici CAN/OBD/Hiworld bilmez.
 *  - Gerçek kaynak WIRING'i (VAL/UnifiedVehicleStore → HAL.ingest) AYRI PR'dır → bu
 *    foundation'da enjekte `providers` yoksa TÜM sinyaller `supported=false` döner.
 *  - SystemBoot wiring YOK · native değişmez · yeni OBD komutu/CAN decoder/PID YOK ·
 *    Deep Scan/Capability Registry davranışı DEĞİŞMEZ. Import YAN ETKİSİZDİR (timer/
 *    abonelik/native çağrı/donanım probu yok).
 *
 * KARAR: Veri yoksa `null` / `supported=false` (fail-closed). Stale sinyal taze
 * gösterilmez. ZERO-LEAK: `dispose()` dinleyicileri bırakır. FAIL-SOFT: provider/
 * listener hatası HAL'i çökertmez; public API throw ETMEZ. Bounded · immutable.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type VehicleSignalId =
  | 'vehicle.speed'
  | 'vehicle.rpm'
  | 'vehicle.coolant_temp'
  | 'vehicle.oil_temp'
  | 'vehicle.fuel_level'
  | 'vehicle.battery_voltage'
  | 'vehicle.throttle'
  | 'vehicle.ambient_temp'
  | 'vehicle.odometer'
  | 'vehicle.gear'
  | 'vehicle.reverse'
  | 'vehicle.ignition'
  | 'vehicle.door_state'
  | 'vehicle.parking_brake'
  | 'vehicle.tpms';

export type VehicleSignalSource = 'native' | 'can' | 'obd' | 'deep_scan' | 'inferred' | 'none';

export type SignalQuality = 'low' | 'medium' | 'high' | 'unknown';

export interface VehicleSignal<T = unknown> {
  readonly id: VehicleSignalId;
  readonly value: T | null;
  readonly quality: SignalQuality;
  readonly confidence: number;
  readonly source: VehicleSignalSource;
  readonly timestamp: number;
  readonly stale: boolean;
  readonly unit: string | null;
  readonly supported: boolean;
}

export interface VehicleHalSnapshot {
  readonly revision: number;
  readonly updatedAt: number;
  readonly signals: readonly VehicleSignal[];
}

/** Araç kimliği — HAM VIN DEĞİL: yalnız türetilmiş fingerprint hash + protokol. */
export interface VehicleIdentity {
  readonly fingerprintHash: string | null;
  readonly protocol: string | null;
  readonly supported: boolean;
}

/** Bir sinyalin capability özeti (HAL-yerel; Capability Registry'nin yerini ALMAZ). */
export interface VehicleSignalCapability {
  readonly id: VehicleSignalId;
  readonly supported: boolean;
  readonly status: 'available' | 'degraded' | 'unsupported';
}

/** ingest/provider girdisi (kısmi; unit/supported HAL tarafından türetilir). */
export interface VehicleSignalInput {
  readonly value?: unknown;
  readonly quality?: SignalQuality;
  readonly confidence?: number;
  readonly source?: VehicleSignalSource;
  readonly timestamp?: number;
}

export interface VehicleIdentityInput {
  readonly fingerprintHash?: unknown;
  readonly protocol?: unknown;
}

export type VehicleSignalProvider = () => VehicleSignalInput | null;

export type VehicleHalListener = (snapshot: VehicleHalSnapshot) => void;

export interface VehicleHalDeps {
  readonly now?: () => number;
  readonly staleMs?: number;
  readonly providers?: Partial<Record<VehicleSignalId, VehicleSignalProvider>>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sinyal kataloğu (birim + değer tipi) — statik, kaynak YOK
 * ════════════════════════════════════════════════════════════════════════ */

type ValueKind = 'number' | 'boolean' | 'number[]';

interface SignalDef { readonly unit: string | null; readonly kind: ValueKind; }

const SIGNAL_CATALOG: Readonly<Record<VehicleSignalId, SignalDef>> = {
  'vehicle.speed':           { unit: 'km/h', kind: 'number' },
  'vehicle.rpm':             { unit: 'rpm',  kind: 'number' },
  'vehicle.coolant_temp':    { unit: '°C',   kind: 'number' },
  'vehicle.oil_temp':        { unit: '°C',   kind: 'number' },
  'vehicle.fuel_level':      { unit: '%',    kind: 'number' },
  'vehicle.battery_voltage': { unit: 'V',    kind: 'number' },
  'vehicle.throttle':        { unit: '%',    kind: 'number' },
  'vehicle.ambient_temp':    { unit: '°C',   kind: 'number' },
  'vehicle.odometer':        { unit: 'km',   kind: 'number' },
  'vehicle.gear':            { unit: null,   kind: 'number' },
  'vehicle.reverse':         { unit: null,   kind: 'boolean' },
  'vehicle.ignition':        { unit: null,   kind: 'boolean' },
  'vehicle.door_state':      { unit: null,   kind: 'boolean' },
  'vehicle.parking_brake':   { unit: null,   kind: 'boolean' },
  'vehicle.tpms':            { unit: 'kPa',  kind: 'number[]' },
};

export const VEHICLE_SIGNAL_IDS: readonly VehicleSignalId[] = Object.freeze(
  Object.keys(SIGNAL_CATALOG) as VehicleSignalId[],
);

const VALID_SIGNAL_IDS: ReadonlySet<string> = new Set(VEHICLE_SIGNAL_IDS);
const VALID_SOURCES: ReadonlySet<string> = new Set<VehicleSignalSource>(['native', 'can', 'obd', 'deep_scan', 'inferred', 'none']);
const VALID_QUALITIES: ReadonlySet<string> = new Set<SignalQuality>(['low', 'medium', 'high', 'unknown']);

export const VEHICLE_HAL_STALE_MS_DEFAULT = 5000;
export const MAX_HAL_LISTENERS = 32;
const MAX_TPMS_LEN = 6;
const MAX_TEXT_CHARS = 40;

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function _quality(v: unknown): SignalQuality {
  return typeof v === 'string' && VALID_QUALITIES.has(v) ? (v as SignalQuality) : 'unknown';
}

function _source(v: unknown): VehicleSignalSource {
  return typeof v === 'string' && VALID_SOURCES.has(v) ? (v as VehicleSignalSource) : 'none';
}

/** Tip doğrulama (YORUMLAMA DEĞİL): geçersiz/NaN → null. */
function _normValue(kind: ValueKind, v: unknown): number | boolean | number[] | null {
  if (v === null || v === undefined) return null;
  if (kind === 'number') return typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (kind === 'boolean') return typeof v === 'boolean' ? v : null;
  // number[]
  if (!Array.isArray(v)) return null;
  const arr: number[] = [];
  for (const x of v) { if (arr.length >= MAX_TPMS_LEN) break; if (typeof x === 'number' && Number.isFinite(x)) arr.push(x); }
  return arr.length > 0 ? arr : null;
}

/** Fingerprint hash doğrulaması — HAM VIN reddedilir (17 karakter), yalnız 8–64 hex. */
function _normFingerprint(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 17) return null;               // VIN uzunluğu — asla kabul etme
  if (!/^[0-9a-fA-F]{8,64}$/.test(s)) return null;
  return s.toLowerCase();
}

/** Kısa metin temizliği (protokol adı gibi) — MAC/hex/koordinat sızıntısına karşı bounded. */
function _text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '')
    .replace(/-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, '')
    .trim();
  const c = s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) : s;
  return c || null;
}

function _valueEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return a === b;
}

function _freezeSignal(s: VehicleSignal): VehicleSignal {
  return Object.freeze({ ...s, value: Array.isArray(s.value) ? Object.freeze([...s.value]) : s.value });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Vehicle HAL
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleHal {
  private readonly _now: () => number;
  private readonly _staleMs: number;
  private readonly _providers: Partial<Record<VehicleSignalId, VehicleSignalProvider>>;

  private _signals = new Map<VehicleSignalId, VehicleSignal>();
  private _identity: VehicleIdentity = Object.freeze({ fingerprintHash: null, protocol: null, supported: false });
  private readonly _listeners = new Set<VehicleHalListener>();
  private _revision = 0;
  private _disposed = false;

  constructor(deps: VehicleHalDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._staleMs = typeof deps.staleMs === 'number' && deps.staleMs > 0 ? deps.staleMs : VEHICLE_HAL_STALE_MS_DEFAULT;
    this._providers = deps.providers ?? {};
    // Katalog tohumla: tüm sinyaller `supported=false`, value null, source none. Donanım probu YOK.
    for (const id of VEHICLE_SIGNAL_IDS) this._signals.set(id, this._emptySignal(id));
  }

  /* ── Dahili ──────────────────────────────────────────────────────────── */

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  private _emptySignal(id: VehicleSignalId): VehicleSignal {
    return _freezeSignal({
      id, value: null, quality: 'unknown', confidence: 0, source: 'none',
      timestamp: 0, stale: false, unit: SIGNAL_CATALOG[id].unit, supported: false,
    });
  }

  /** Stale hesabı: yaş<0 (saat geri) veya > staleMs → stale. */
  private _isStale(timestamp: number, now: number): boolean {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
    const age = now - timestamp;
    return age < 0 || age > this._staleMs;
  }

  private _emit(): void {
    if (this._disposed || this._listeners.size === 0) return;
    const snap = this.getSnapshot();
    for (const l of [...this._listeners]) {
      try { l(snap); } catch (err) { console.error('[VehicleHal] dinleyici hatası — servis etkilenmedi', err); }
    }
  }

  private _applyInput(id: VehicleSignalId, input: VehicleSignalInput, now: number): boolean {
    const def = SIGNAL_CATALOG[id];
    const source = _source(input.source);
    const value = source === 'none' ? null : _normValue(def.kind, input.value);
    const timestamp = typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) ? input.timestamp : now;
    const next: VehicleSignal = _freezeSignal({
      id,
      value,
      quality: _quality(input.quality),
      confidence: _clamp01(input.confidence),
      source,
      timestamp,
      stale: this._isStale(timestamp, now),
      unit: def.unit,
      supported: source !== 'none',
    });
    const prev = this._signals.get(id);
    this._signals.set(id, next);
    // Değişim: value/source/quality/supported/stale (duplicate event önleme).
    return !prev || !_valueEqual(prev.value, next.value) || prev.source !== next.source ||
      prev.quality !== next.quality || prev.supported !== next.supported || prev.stale !== next.stale;
  }

  /* ── Public API ──────────────────────────────────────────────────────── */

  /** Tek sinyali dışarıdan besler (push). Bilinmeyen id → no-op null. */
  ingestSignal(id: VehicleSignalId, input: VehicleSignalInput): VehicleSignal | null {
    if (this._disposed || !VALID_SIGNAL_IDS.has(id) || !input || typeof input !== 'object') return null;
    const changed = this._applyInput(id, input, this._nowSafe());
    if (changed) { this._revision++; this._emit(); }
    return this._signals.get(id) ?? null;
  }

  /** Toplu besleme (push). */
  ingest(signals: Partial<Record<VehicleSignalId, VehicleSignalInput>>): void {
    if (this._disposed || !signals || typeof signals !== 'object') return;
    const now = this._nowSafe();
    let changed = false;
    for (const id of VEHICLE_SIGNAL_IDS) {
      const input = signals[id];
      if (input && typeof input === 'object') { if (this._applyInput(id, input, now)) changed = true; }
    }
    if (changed) { this._revision++; this._emit(); }
  }

  /** Araç kimliği besler (HAM VIN reddedilir). */
  ingestIdentity(input: VehicleIdentityInput): VehicleIdentity {
    if (this._disposed || !input || typeof input !== 'object') return this._identity;
    const fingerprintHash = _normFingerprint(input.fingerprintHash);
    const protocol = _text(input.protocol);
    const next: VehicleIdentity = Object.freeze({ fingerprintHash, protocol, supported: fingerprintHash !== null });
    const changed = next.fingerprintHash !== this._identity.fingerprintHash || next.protocol !== this._identity.protocol;
    this._identity = next;
    if (changed) { this._revision++; this._emit(); }
    return next;
  }

  /** Sağlayıcılardan çeker (pull, fail-soft) + yeniden hesaplar. İDEMPOTENT. */
  refresh(): VehicleHalSnapshot {
    if (this._disposed) return this.getSnapshot();
    const now = this._nowSafe();
    let changed = false;
    for (const id of VEHICLE_SIGNAL_IDS) {
      const provider = this._providers[id];
      if (typeof provider !== 'function') continue;
      let input: VehicleSignalInput | null = null;
      try { input = provider(); } catch { input = null; }  // kaynak hatası izole
      if (input && typeof input === 'object') { if (this._applyInput(id, input, now)) changed = true; }
    }
    // Stale bayrağını tazele (zaman ilerlemiş olabilir).
    for (const id of VEHICLE_SIGNAL_IDS) {
      const s = this._signals.get(id)!;
      const stale = this._isStale(s.timestamp, now);
      if (stale !== s.stale) { this._signals.set(id, _freezeSignal({ ...s, stale })); changed = true; }
    }
    if (changed) { this._revision++; this._emit(); }
    return this.getSnapshot();
  }

  getSnapshot(): VehicleHalSnapshot {
    const signals = [...this._signals.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return Object.freeze({
      revision: this._revision,
      updatedAt: this._nowSafe(),
      signals: Object.freeze(signals),
    });
  }

  getSignal(id: VehicleSignalId): VehicleSignal | null {
    return this._signals.get(id) ?? null; // zaten frozen
  }

  hasSignal(id: VehicleSignalId): boolean {
    return this._signals.get(id)?.supported === true;
  }

  /* ── Tipli erişimciler (kaynağı gizler) ──────────────────────────────── */

  private _num(id: VehicleSignalId): number | null {
    const s = this._signals.get(id);
    return s && s.supported && typeof s.value === 'number' ? s.value : null;
  }
  private _bool(id: VehicleSignalId): boolean | null {
    const s = this._signals.get(id);
    return s && s.supported && typeof s.value === 'boolean' ? s.value : null;
  }

  getSpeed(): number | null { return this._num('vehicle.speed'); }
  getRPM(): number | null { return this._num('vehicle.rpm'); }
  getCoolantTemp(): number | null { return this._num('vehicle.coolant_temp'); }
  getOilTemp(): number | null { return this._num('vehicle.oil_temp'); }
  getFuelLevel(): number | null { return this._num('vehicle.fuel_level'); }
  getBatteryVoltage(): number | null { return this._num('vehicle.battery_voltage'); }
  getThrottle(): number | null { return this._num('vehicle.throttle'); }
  getAmbientTemp(): number | null { return this._num('vehicle.ambient_temp'); }
  getOdometer(): number | null { return this._num('vehicle.odometer'); }
  getGear(): number | null { return this._num('vehicle.gear'); }
  getReverse(): boolean | null { return this._bool('vehicle.reverse'); }
  getIgnition(): boolean | null { return this._bool('vehicle.ignition'); }
  getDoorState(): boolean | null { return this._bool('vehicle.door_state'); }
  getParkingBrake(): boolean | null { return this._bool('vehicle.parking_brake'); }
  getTpms(): number[] | null {
    const s = this._signals.get('vehicle.tpms');
    return s && s.supported && Array.isArray(s.value) ? [...s.value] : null;
  }

  getVehicleIdentity(): VehicleIdentity {
    return this._identity; // frozen; ham VIN içermez
  }

  /** HAL-yerel capability özeti (Capability Registry'nin YERİNE geçmez). */
  getCapability(id: VehicleSignalId): VehicleSignalCapability {
    const s = this._signals.get(id);
    const supported = s?.supported === true;
    const status: VehicleSignalCapability['status'] = !supported ? 'unsupported' : s!.stale ? 'degraded' : 'available';
    return Object.freeze({ id, supported, status });
  }

  subscribe(listener: VehicleHalListener): () => void {
    if (this._disposed || typeof listener !== 'function') return () => { /* no-op */ };
    if (!this._listeners.has(listener) && this._listeners.size >= MAX_HAL_LISTENERS) return () => { /* no-op */ };
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  /** Açık unsubscribe (subscribe cleanup'ına ek). */
  unsubscribe(listener: VehicleHalListener): void {
    this._listeners.delete(listener);
  }

  get listenerCount(): number {
    return this._listeners.size;
  }

  /** Tüm sinyalleri kataloğa (supported=false) döndürür; kimliği temizler. */
  reset(): void {
    if (this._disposed) return;
    this._signals = new Map();
    for (const id of VEHICLE_SIGNAL_IDS) this._signals.set(id, this._emptySignal(id));
    this._identity = Object.freeze({ fingerprintHash: null, protocol: null, supported: false });
    this._revision++;
    this._emit();
  }

  dispose(): void {
    if (this._disposed) return;
    this._listeners.clear();
    this._signals = new Map();
    this._disposed = true;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Fabrika — DI ile örnek üretir. Yapıcı yalnız statik kataloğu tohumlar (donanım probu/
 * timer/abonelik/native çağrı YOK) → import + oluşturma davranış değiştirmez.
 */
export function createVehicleHal(deps: VehicleHalDeps = {}): VehicleHal {
  return new VehicleHal(deps);
}

/**
 * Uygulama geneli tekil HAL. Sağlayıcı YOK (foundation) → gerçek kaynak wiring (VAL/
 * UnifiedVehicleStore → HAL.ingest) gelene kadar tüm sinyaller `supported=false`.
 * SystemBoot'a BAĞLI DEĞİLDİR.
 */
export const vehicleHal = new VehicleHal();
