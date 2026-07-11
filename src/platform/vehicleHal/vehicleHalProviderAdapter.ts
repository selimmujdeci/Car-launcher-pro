/**
 * vehicleHalProviderAdapter — Mevcut normalize araç durumunu Vehicle HAL'e aktaran
 * ilk resmi SALT-OKUNUR provider adapter — FOUNDATION.
 *
 * KÖPRÜ: (existing normalized vehicle state) → (Vehicle HAL signal model). Yalnız bu.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz): `UnifiedVehicleStore` (fused worker/CAN/OBD/GPS)
 * şu alanları taşır: `speed`(km/h, null=yok) · `rpm`(fused / `canRpm`) · `fuel`(%) ·
 * `odometer`(km) · `reverse` · CAN extras `canCoolantTemp`/`canOilTemp`/`canThrottle`/
 * `canBatteryVolt`/`canGearPos`/`canAmbientTemp`/`canTpmsKpa`/`canDoorOpen`/`canParkingBrake`.
 * **Per-signal source/quality/confidence metadata YOK** (fused nativeSource bile store'da yok);
 * **gerçek ignition kaynağı YOK.** Store zaten dirty-check ile dedupe eder.
 *
 * DAVRANIŞ: Store'u salt-okunur okur; YALNIZ değişen sinyalleri HAL'e ingest eder (adapter
 * kendi son-değer haritasıyla duplicate ingest yapmaz); tam snapshot'ı her tick yeniden
 * ÜRETMEZ; kaynağı olmayan sinyali (ignition, veri yoksa TPMS) `supported=false` bırakır
 * (ingest ETMEZ). Metadata olmadığından source CAN-adlı alanlarda `can`, füzyon alanlarında
 * `inferred`; confidence VAL SIGNAL_SOURCE_DEFAULTS taban gerekçesiyle muhafazakâr sabit
 * (magic uydurma yok). Provider/HAL hatası HAL'e/çağırana SIZMAZ (fail-soft).
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız köprü FOUNDATION'ıdır):
 *  - Event Bus'a YAYINLAMAZ · Capability Registry'yi GÜNCELLEMEZ · SystemBoot'a BAĞLANMAZ ·
 *    native/OBD/CAN sorgusu BAŞLATMAZ · poll listesi/frekans DEĞİŞTİRMEZ · UI/SQL YOK.
 *  - Store'u DOĞRUDAN import ETMEZ (DI ile `source` alır) → import YAN ETKİSİZDİR; adapter
 *    yalnız açıkça oluşturulup `start()` çağrılınca çalışır. HAL'in SAHİBİ DEĞİLDİR:
 *    `dispose()` HAL'i dispose ETMEZ.
 *
 * ZERO-LEAK: `dispose()`/`stop()` store aboneliğini bırakır; timer açılmaz. FAIL-SOFT:
 * tek sinyal bozuksa diğerleri aktarılır; public API throw ETMEZ; dispose sonrası no-op.
 */

import type { VehicleSignalId, VehicleSignalInput, VehicleSignalSource, SignalQuality } from './vehicleHal';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler (DI — store'a yapısal olarak uyumlu, doğrudan import YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/** HAL hedefi — yalnız `ingestSignal` gerekir (VehicleHal yapısal olarak uyar). */
export interface VehicleHalIngestTarget {
  ingestSignal(id: VehicleSignalId, input: VehicleSignalInput): unknown;
}

/** Okunacak normalize araç durumu (UnifiedVehicleState alt kümesi — yapısal). */
export interface NormalizedVehicleSnapshot {
  readonly speed?: number | null;
  readonly rpm?: number | null;
  readonly fuel?: number | null;
  readonly odometer?: number;
  readonly reverse?: boolean;
  readonly canRpm?: number | null;
  readonly canCoolantTemp?: number | null;
  readonly canOilTemp?: number | null;
  readonly canThrottle?: number | null;
  readonly canBatteryVolt?: number | null;
  readonly canGearPos?: number | null;
  readonly canAmbientTemp?: number | null;
  readonly canTpmsKpa?: readonly [number, number, number, number] | null;
  readonly canDoorOpen?: boolean;
  readonly canParkingBrake?: boolean;
}

/** Store bağlama (DI) — gerçek wiring PR'ı `useUnifiedVehicleStore.getState/subscribe` geçirir. */
export interface VehicleStoreSource {
  getSnapshot: () => NormalizedVehicleSnapshot | null;
  subscribe: (listener: () => void) => (() => void);
}

export interface VehicleHalProviderDeps {
  readonly hal: VehicleHalIngestTarget;
  readonly source: VehicleStoreSource;
  readonly now?: () => number;
}

export interface VehicleHalProviderStatus {
  readonly started: boolean;
  readonly disposed: boolean;
  readonly lastRefreshAt: number | null;
  readonly ingestedSignalCount: number;
  readonly refreshCount: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak/kalite/confidence politikası (VAL SIGNAL_SOURCE_DEFAULTS gerekçeli — magic değil)
 * ════════════════════════════════════════════════════════════════════════ */

const CAN_CONFIDENCE = 0.9;       // VAL CAN base ~0.92 → muhafazakâr
const INFERRED_CONFIDENCE = 0.6;  // füzyon; kesin kaynak bilinmez → daha düşük
const CAN_QUALITY: SignalQuality = 'high';
const INFERRED_QUALITY: SignalQuality = 'medium';

type ExtractResult = { value: number | boolean | number[] } | null;

interface SignalMapSpec {
  readonly id: VehicleSignalId;
  readonly source: VehicleSignalSource;
  readonly quality: SignalQuality;
  readonly confidence: number;
  /** Değer yoksa (kaynak yok) → null → ingest EDİLMEZ (supported=false kalır). */
  readonly extract: (s: NormalizedVehicleSnapshot, live: boolean) => ExtractResult;
}

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Aktif araç kanıtı: en az bir numerik sinyal mevcutsa (boolean sinyaller buna kapılanır). */
function _isLive(s: NormalizedVehicleSnapshot): boolean {
  return _num(s.speed) !== null || _num(s.rpm) !== null || _num(s.canRpm) !== null ||
    _num(s.canCoolantTemp) !== null || _num(s.canBatteryVolt) !== null || _num(s.canGearPos) !== null ||
    _num(s.canThrottle) !== null || _num(s.canOilTemp) !== null || _num(s.canAmbientTemp) !== null ||
    (Array.isArray(s.canTpmsKpa) && s.canTpmsKpa.length === 4);
}

const CAN = (id: VehicleSignalId, extract: SignalMapSpec['extract']): SignalMapSpec =>
  ({ id, source: 'can', quality: CAN_QUALITY, confidence: CAN_CONFIDENCE, extract });
const INF = (id: VehicleSignalId, extract: SignalMapSpec['extract']): SignalMapSpec =>
  ({ id, source: 'inferred', quality: INFERRED_QUALITY, confidence: INFERRED_CONFIDENCE, extract });

/** Sinyal eşleme tablosu. ignition YOK (kaynak yok → supported=false kalır). */
const SIGNAL_MAP: readonly SignalMapSpec[] = [
  INF('vehicle.speed', (s) => { const v = _num(s.speed); return v === null ? null : { value: v }; }),
  INF('vehicle.rpm', (s) => { const v = _num(s.rpm) ?? _num(s.canRpm); return v === null ? null : { value: v }; }),
  INF('vehicle.fuel_level', (s) => { const v = _num(s.fuel); return v === null ? null : { value: v }; }),
  INF('vehicle.odometer', (s) => { const v = _num(s.odometer); return v === null || v <= 0 ? null : { value: v }; }),
  CAN('vehicle.coolant_temp', (s) => { const v = _num(s.canCoolantTemp); return v === null ? null : { value: v }; }),
  CAN('vehicle.oil_temp', (s) => { const v = _num(s.canOilTemp); return v === null ? null : { value: v }; }),
  CAN('vehicle.throttle', (s) => { const v = _num(s.canThrottle); return v === null ? null : { value: v }; }),
  CAN('vehicle.battery_voltage', (s) => { const v = _num(s.canBatteryVolt); return v === null ? null : { value: v }; }),
  CAN('vehicle.gear', (s) => { const v = _num(s.canGearPos); return v === null ? null : { value: v }; }),
  CAN('vehicle.ambient_temp', (s) => { const v = _num(s.canAmbientTemp); return v === null ? null : { value: v }; }),
  CAN('vehicle.tpms', (s) => {
    const t = s.canTpmsKpa;
    if (!Array.isArray(t) || t.length !== 4 || !t.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    return { value: [t[0], t[1], t[2], t[3]] };
  }),
  // Boolean sinyaller: yalnız aktif araç varken (aksi hâlde default false'u kaynak sanma).
  INF('vehicle.reverse', (s, live) => (live && typeof s.reverse === 'boolean' ? { value: s.reverse } : null)),
  CAN('vehicle.door_state', (s, live) => (live && typeof s.canDoorOpen === 'boolean' ? { value: s.canDoorOpen } : null)),
  CAN('vehicle.parking_brake', (s, live) => (live && typeof s.canParkingBrake === 'boolean' ? { value: s.canParkingBrake } : null)),
];

function _valueEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return a === b;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Adapter
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleHalProviderAdapter {
  private readonly _hal: VehicleHalIngestTarget;
  private readonly _source: VehicleStoreSource;
  private readonly _now: () => number;

  private _unsub: (() => void) | null = null;
  private _started = false;
  private _disposed = false;
  private _lastRefreshAt: number | null = null;
  private _refreshCount = 0;
  /** Sinyal başına son ingest edilen değer (duplicate ingest önleme, O(1)). */
  private readonly _last = new Map<VehicleSignalId, number | boolean | number[]>();

  constructor(deps: VehicleHalProviderDeps) {
    this._hal = deps.hal;
    this._source = deps.source;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  }

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  /** Store'a abone olur + ilk refresh. İDEMPOTENT (çift start duplicate abonelik yaratmaz). */
  start(): void {
    if (this._disposed || this._started) return;
    this._started = true;
    try {
      this._unsub = this._source.subscribe(() => this._onChange());
    } catch {
      this._unsub = null;                 // abonelik kurulamadı → fail-soft
    }
    this.refresh();
  }

  private _onChange(): void {
    if (this._disposed || !this._started) return;  // dispose/stop sonrası callback no-op
    this.refresh();
  }

  /** Store snapshot'ını okuyup YALNIZ değişen sinyalleri HAL'e ingest eder. Fail-soft. */
  refresh(): void {
    if (this._disposed) return;
    this._refreshCount++;
    this._lastRefreshAt = this._nowSafe();

    let snap: NormalizedVehicleSnapshot | null = null;
    try { snap = this._source.getSnapshot(); } catch { snap = null; } // store okunamadı → fail-soft
    if (!snap || typeof snap !== 'object') return;

    const live = _isLive(snap);
    const ts = this._nowSafe();

    for (const spec of SIGNAL_MAP) {
      let res: ExtractResult = null;
      try { res = spec.extract(snap, live); } catch { res = null; } // tek sinyal bozuk → diğerleri sürer
      if (res === null) continue;                                    // kaynak yok → ingest yok
      const prev = this._last.get(spec.id);
      if (prev !== undefined && _valueEqual(prev, res.value)) continue; // duplicate → ingest yok
      const input: VehicleSignalInput = {
        value: res.value, source: spec.source, quality: spec.quality, confidence: spec.confidence, timestamp: ts,
      };
      try {
        this._hal.ingestSignal(spec.id, input);
        this._last.set(spec.id, Array.isArray(res.value) ? [...res.value] : res.value); // kopya sakla
      } catch { /* HAL ingest hatası diğer sinyalleri engellemez */ }
    }
  }

  /** Aboneliği bırakır (İDEMPOTENT). HAL'i dispose ETMEZ. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    if (this._unsub) { try { this._unsub(); } catch { /* */ } this._unsub = null; }
  }

  getStatus(): VehicleHalProviderStatus {
    return Object.freeze({
      started: this._started,
      disposed: this._disposed,
      lastRefreshAt: this._lastRefreshAt,
      ingestedSignalCount: this._last.size,
      refreshCount: this._refreshCount,
    });
  }

  getLastRefreshAt(): number | null {
    return this._lastRefreshAt;
  }

  /** Zero-leak: aboneliği bırakır + kilitler. HAL çağıranındır → dispose EDİLMEZ. */
  dispose(): void {
    if (this._disposed) return;
    this.stop();
    this._last.clear();
    this._disposed = true;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Fabrika — DI ile örnek üretir. Yapıcı YAN ETKİSİZ: abonelik/native/store okuma YOK
 * (yalnız `start()`/`refresh()` çağrılınca çalışır) → import edilmesi hiçbir davranış
 * değiştirmez. Store DOĞRUDAN import edilmez (yapısal `source` DI).
 */
export function createVehicleHalProviderAdapter(deps: VehicleHalProviderDeps): VehicleHalProviderAdapter {
  return new VehicleHalProviderAdapter(deps);
}
