/**
 * vehicleHalEventBridge — Vehicle HAL değişikliklerini Platform Event Bus'a aktaran
 * SALT-OKUNUR köprü — FOUNDATION.
 *
 * KÖPRÜ: (Vehicle HAL snapshot/identity değişimi) → PlatformEvent (`vehicle.*`). Yalnız bu.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz): `VehicleHal.subscribe(listener)` listener'a **TAM
 * snapshot** (`revision`/`updatedAt`/`signals[]`) verir — per-signal delta YOK; identity
 * AYRI (`getVehicleIdentity()`), her identity değişiminde de `_emit()` snapshot yayar.
 * HAL zaten value/source/quality/supported/stale değişiminde emit eder. Köprü bu snapshot'ı
 * kendi son-değer haritasıyla DIFF'leyip yalnız GERÇEKTEN değişen sinyalleri yayınlar.
 *
 * YAYINLANAN EVENT'LER (yalnız gerçek HAL verisi varsa):
 *  - `vehicle.signal.changed`  → TRANSIENT (history dışı), yalnız supported sinyal, küçük payload.
 *  - `vehicle.connection.changed` → RETAINED, "en az bir supported sinyal var mı" geçişinde
 *    (HAL'e dayalı gerçek olgu; veri yoksa false kalır → foundation'da SESSİZ).
 *  - `vehicle.ignition.changed` → RETAINED, yalnız ignition supported + boolean değeri değişince.
 *    Foundation'da ignition kaynağı YOK → supported=false → ASLA yayınlanmaz.
 *  - `vehicle.identity.changed` → RETAINED, yalnız identity.supported (fingerprint) + değişince.
 *  `vehicle.health.changed` YAYINLANMAZ: HAL'de health kaynağı YOK (event UYDURULMAZ).
 *
 * NE YAPMAZ (bilinçli): Güvenlik KARARI üretmez (yalnız taşır) · SystemBoot'a BAĞLANMAZ ·
 * provider adapter'ları BAŞLATMAZ · native/OBD/CAN/poll DEĞİŞTİRMEZ · UI/SQL YOK · timer/
 * polling YOK. HAL'i DOĞRUDAN import ETMEZ (yapısal DI) → import YAN ETKİSİZ. Kaynakların
 * SAHİBİ DEĞİL: `dispose()` HAL'i/Bus'ı dispose ETMEZ, yalnız kendi aboneliğini bırakır.
 *
 * ZERO-LEAK: start/stop/dispose İDEMPOTENT; tek abonelik; dispose sonrası callback no-op.
 * FAIL-SOFT: HAL subscribe hatası / Bus publish hatası / tek bozuk sinyal köprüyü çökertmez;
 * public API throw ETMEZ; publish reddedilirse `droppedCount` artar (kaynak servis etkilenmez).
 * PRIVACY: payload yalnız normalize değer + metadata (VIN/MAC/koordinat/ham CAN/anahtar YOK).
 */

import type { PlatformEvent } from '../platformEventBus';

/* ══════════════════════════════════════════════════════════════════════════
 * DI hedefleri — VehicleHal ve PlatformEventBus yapısal olarak uyar (doğrudan import YOK)
 * ════════════════════════════════════════════════════════════════════════ */

type SignalQuality = 'low' | 'medium' | 'high' | 'unknown';
type SignalSource = string;

/** Okunacak HAL sinyali (VehicleSignal alt kümesi — yapısal). */
export interface HalSignalLike {
  readonly id: string;
  readonly value: unknown;
  readonly quality: SignalQuality;
  readonly confidence: number;
  readonly source: SignalSource;
  readonly timestamp: number;
  readonly stale: boolean;
  readonly supported: boolean;
}

export interface HalSnapshotLike {
  readonly revision: number;
  readonly updatedAt: number;
  readonly signals: readonly HalSignalLike[];
}

export interface HalIdentityLike {
  readonly fingerprintHash: string | null;
  readonly protocol: string | null;
  readonly supported: boolean;
}

/** HAL kaynağı (DI) — gerçek wiring PR'ı `vehicleHal`'i geçirir. */
export interface VehicleHalSource {
  subscribe: (listener: (snapshot: HalSnapshotLike) => void) => (() => void);
  getSnapshot: () => HalSnapshotLike;
  getVehicleIdentity: () => HalIdentityLike;
}

/** Bus hedefi (DI) — yalnız `publish` gerekir (PlatformEventBus yapısal uyar). */
export interface EventBusPublishTarget {
  publish: (input: {
    name: string;
    payload?: unknown;
    domain?: string;
    source?: string;
    transient?: boolean;
    retained?: boolean;
    vehicleFingerprintHash?: string;
  }) => PlatformEvent | null;
}

export interface VehicleHalEventBridgeDeps {
  readonly hal: VehicleHalSource;
  readonly bus: EventBusPublishTarget;
  readonly now?: () => number;
}

export interface VehicleHalEventBridgeStatus {
  readonly started: boolean;
  readonly disposed: boolean;
  readonly publishedCount: number;
  readonly droppedCount: number;
  readonly lastPublishAt: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

const IGNITION_ID = 'vehicle.ignition';
const MAX_TPMS = 8;                    // TPMS dizi taşması koruması

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

/** Payload için güvenli/küçük değer özeti (raw taşımaz). */
function _valueSummary(value: unknown): number | boolean | number[] | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const nums = value.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(0, MAX_TPMS) as number[];
    return nums.length > 0 ? nums : null;
  }
  return null;
}

/** Değişiklik imzası (HAL'in kendi değişim tanımıyla hizalı — duplicate önleme). */
function _signalSig(s: HalSignalLike): string {
  const v = Array.isArray(s.value) ? s.value.join(',') : String(s.value);
  return `${v}|${s.quality}|${s.source}|${s.stale}|${s.supported}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Köprü
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleHalEventBridge {
  private readonly _hal: VehicleHalSource;
  private readonly _bus: EventBusPublishTarget;
  private readonly _now: () => number;

  private _unsub: (() => void) | null = null;
  private _started = false;
  private _disposed = false;
  private _publishedCount = 0;
  private _droppedCount = 0;
  private _lastPublishAt: number | null = null;

  private readonly _lastSignalSig = new Map<string, string>();  // signalId → son yayın imzası
  private _lastConnected = false;                               // "en az bir supported sinyal"
  private _lastIgnition: boolean | null = null;                // son yayınlanan ignition değeri
  private _lastIdentitySig: string | null = null;              // fingerprint|protocol

  constructor(deps: VehicleHalEventBridgeDeps) {
    this._hal = deps.hal;
    this._bus = deps.bus;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  }

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  /** HAL'e abone olur + ilk snapshot'ı işler. İDEMPOTENT. */
  start(): void {
    if (this._disposed || this._started) return;
    this._started = true;
    try {
      this._unsub = this._hal.subscribe((snap) => this._onSnapshot(snap));
    } catch {
      this._unsub = null;                        // abonelik kurulamadı → fail-soft
    }
    // İlk durum (retained event'ler doğru başlangıç değerini alsın).
    try { this._onSnapshot(this._hal.getSnapshot()); } catch { /* fail-soft */ }
  }

  private _onSnapshot(snap: HalSnapshotLike): void {
    if (this._disposed || !this._started) return;   // dispose/stop sonrası no-op
    if (!snap || typeof snap !== 'object' || !Array.isArray(snap.signals)) return;

    // 1) Per-signal değişiklik (ignition hariç — o ayrı retained event).
    let anySupported = false;
    for (const s of snap.signals) {
      if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue;
      if (s.supported) anySupported = true;
      if (s.id === IGNITION_ID) continue;          // ignition ayrı ele alınır
      if (!s.supported) { this._lastSignalSig.delete(s.id); continue; } // unsupported → event yok
      const sig = _signalSig(s);
      if (this._lastSignalSig.get(s.id) === sig) continue;              // duplicate → yok
      this._lastSignalSig.set(s.id, sig);
      this._publish('vehicle.signal.changed', {
        signalId: s.id,
        value: _valueSummary(s.value),
        quality: s.quality,
        confidence: typeof s.confidence === 'number' ? s.confidence : 0,
        source: s.source,
        stale: !!s.stale,
        supported: true,
        timestamp: typeof s.timestamp === 'number' ? s.timestamp : this._nowSafe(),
      }, { transient: true });
    }

    // 2) Ignition (retained) — yalnız supported + boolean değeri değişince.
    const ign = snap.signals.find((s) => s && s.id === IGNITION_ID);
    if (ign && ign.supported && typeof ign.value === 'boolean') {
      if (this._lastIgnition !== ign.value) {
        this._lastIgnition = ign.value;
        this._publish('vehicle.ignition.changed', {
          value: ign.value, quality: ign.quality, source: ign.source, stale: !!ign.stale,
        }, { retained: true });
      }
    }
    // ignition supported değilse SESSİZ (kaynak yok → event uydurulmaz).

    // 3) Connection (retained) — "en az bir supported sinyal" geçişi (HAL'e dayalı gerçek olgu).
    if (anySupported !== this._lastConnected) {
      this._lastConnected = anySupported;
      this._publish('vehicle.connection.changed', {
        connected: anySupported,
        supportedSignalCount: snap.signals.reduce((n, s) => n + (s && s.supported ? 1 : 0), 0),
      }, { retained: true });
    }

    // 4) Identity (retained) — yalnız supported (fingerprint) + değişince.
    let identity: HalIdentityLike | null = null;
    try { identity = this._hal.getVehicleIdentity(); } catch { identity = null; }
    if (identity && identity.supported) {
      const sig = `${identity.fingerprintHash ?? ''}|${identity.protocol ?? ''}`;
      if (this._lastIdentitySig !== sig) {
        this._lastIdentitySig = sig;
        this._publish('vehicle.identity.changed', {
          supported: true, protocol: identity.protocol ?? null,
        }, { retained: true, vehicleFingerprintHash: identity.fingerprintHash ?? undefined });
      }
    }
  }

  /** Tek publish sarmalayıcı — fail-soft + sayaç. */
  private _publish(
    name: string,
    payload: unknown,
    opts: { transient?: boolean; retained?: boolean; vehicleFingerprintHash?: string } = {},
  ): void {
    try {
      const ev = this._bus.publish({
        name, payload, domain: 'vehicle', source: 'vehicle_hal',
        transient: opts.transient, retained: opts.retained,
        vehicleFingerprintHash: opts.vehicleFingerprintHash,
      });
      if (ev) { this._publishedCount++; this._lastPublishAt = this._nowSafe(); }
      else { this._droppedCount++; }              // Bus reddetti → kaynak servis etkilenmez
    } catch {
      this._droppedCount++;                        // publish hatası izole
    }
  }

  /** Aboneliği bırakır (İDEMPOTENT). HAL'i dispose ETMEZ. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    if (this._unsub) { try { this._unsub(); } catch { /* */ } this._unsub = null; }
  }

  getStatus(): VehicleHalEventBridgeStatus {
    return Object.freeze({
      started: this._started,
      disposed: this._disposed,
      publishedCount: this._publishedCount,
      droppedCount: this._droppedCount,
      lastPublishAt: this._lastPublishAt,
    });
  }

  getPublishedCount(): number { return this._publishedCount; }
  getDroppedCount(): number { return this._droppedCount; }

  /** Zero-leak: aboneliği bırakır + kilitler. HAL/Bus çağıranındır → dispose EDİLMEZ. */
  dispose(): void {
    if (this._disposed) return;
    this.stop();
    this._lastSignalSig.clear();
    this._disposed = true;
  }

  get isDisposed(): boolean { return this._disposed; }
}

/**
 * Fabrika — DI ile örnek üretir. YAN ETKİSİZ: abonelik/HAL okuma yalnız `start()`'ta →
 * import edilmesi davranış değiştirmez. GLOBAL SINGLETON YOK.
 */
export function createVehicleHalEventBridge(deps: VehicleHalEventBridgeDeps): VehicleHalEventBridge {
  return new VehicleHalEventBridge(deps);
}
