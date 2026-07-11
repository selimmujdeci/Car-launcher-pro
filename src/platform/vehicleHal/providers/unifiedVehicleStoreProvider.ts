/**
 * unifiedVehicleStoreProvider — İLK gerçek Vehicle HAL provider kaynağı.
 *
 * KÖPRÜ: (mevcut `useUnifiedVehicleStore` — fused worker/CAN/OBD/GPS) → Vehicle HAL
 * Provider Adapter'ın beklediği `VehicleStoreSource` sözleşmesi. Yalnız bu.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz): `UnifiedVehicleStore` şu alanları taşır —
 *  `speed`(km/h,null=yok) · `rpm`(fused, number|undefined) · `fuel`(%) · `odometer`(km) ·
 *  `reverse` + CAN extras `canRpm`/`canCoolantTemp`/`canOilTemp`/`canThrottle`/
 *  `canBatteryVolt`/`canGearPos`/`canAmbientTemp`/`canTpmsKpa`/`canDoorOpen`/
 *  `canParkingBrake`. **Per-signal source/quality/confidence metadata YOK** ve **gerçek
 *  ignition kaynağı YOK** → bu provider metadata UYDURMAZ, ignition EXPOSE ETMEZ; kaynak/
 *  kalite/confidence yorumu HAL Provider Adapter'a aittir. Store zaten dirty-check dedupe eder.
 *
 * DAVRANIŞ: Store'u SALT-OKUNUR okur; her `getSnapshot()` çağrısında yalnız HAL'in
 * ihtiyaç duyduğu alanları içeren YENİ, dondurulmuş bir alt-küme üretir (store state'i
 * MUTATE EDİLMEZ, referansı dışa verilmez). TPMS yalnız GERÇEK 4-elemanlı numerik tuple
 * varken taşınır (aksi hâlde null). `rpm` undefined ise `null`'a normalize edilir.
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız provider FOUNDATION'ıdır):
 *  - Store'u DOĞRUDAN import ETMEZ (DI ile `store` alır) → import YAN ETKİSİZDİR; provider
 *    OLUŞTURULMADAN store'a ABONE OLMAZ (subscribe yalnız adapter `subscribe()` çağırınca).
 *  - Event Bus'a YAYINLAMAZ · Capability Registry'yi GÜNCELLEMEZ · SystemBoot'a BAĞLANMAZ ·
 *    native/OBD/CAN sorgusu BAŞLATMAZ · poll frekansı DEĞİŞTİRMEZ · UI/SQL YOK · timer YOK.
 *
 * ZERO-LEAK: `subscribe()` idempotent unsubscribe döndürür (alttaki store aboneliği yalnız
 * BİR kez bırakılır); `dispose()` tüm aktif abonelikleri bırakır. FAIL-SOFT: store yoksa/
 * `getState()` throw ederse `getSnapshot()` null döner; subscribe kurulamazsa no-op unsub.
 */

import type { NormalizedVehicleSnapshot, VehicleStoreSource } from '../vehicleHalProviderAdapter';

/* ══════════════════════════════════════════════════════════════════════════
 * DI hedefi — zustand `useUnifiedVehicleStore` yapısal olarak uyar (doğrudan import YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/** Okunacak store alanları (UnifiedVehicleState alt kümesi — salt-okunur). */
export interface UnifiedVehicleStateReadable {
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

/** Zustand benzeri store — yalnız `getState`/`subscribe` gerekir (yapısal DI). */
export interface UnifiedVehicleStoreLike {
  getState: () => UnifiedVehicleStateReadable;
  /** Zustand v5 listener'a (state, prev) geçirir; provider argümanları YOK SAYAR. */
  subscribe: (listener: (state: UnifiedVehicleStateReadable) => void) => (() => void);
}

export interface UnifiedVehicleStoreProviderDeps {
  readonly store: UnifiedVehicleStoreLike | null | undefined;
}

/** VehicleStoreSource + açık yaşam döngüsü (adapter yalnız getSnapshot/subscribe kullanır). */
export interface UnifiedVehicleStoreProvider extends VehicleStoreSource {
  /** Tüm aktif abonelikleri bırakır (İDEMPOTENT). Store'un SAHİBİ DEĞİL. */
  dispose(): void;
  /** Aktif (bırakılmamış) abonelik sayısı — test/teşhis. */
  readonly activeSubscriptionCount: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function _bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

/** Yalnız gerçek 4-elemanlı numerik TPMS tuple'ı geçirir (aksi hâlde null). */
function _tpms(v: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return [v[0], v[1], v[2], v[3]];
}

/** Store state → HAL alt-kümesi (yeni dondurulmuş obje; ignition/metadata UYDURULMAZ). */
function _mapSnapshot(s: UnifiedVehicleStateReadable): NormalizedVehicleSnapshot {
  return Object.freeze({
    speed: _num(s.speed),
    rpm: _num(s.rpm),
    fuel: _num(s.fuel),
    odometer: _num(s.odometer) ?? undefined,
    reverse: _bool(s.reverse),
    canRpm: _num(s.canRpm),
    canCoolantTemp: _num(s.canCoolantTemp),
    canOilTemp: _num(s.canOilTemp),
    canThrottle: _num(s.canThrottle),
    canBatteryVolt: _num(s.canBatteryVolt),
    canGearPos: _num(s.canGearPos),
    canAmbientTemp: _num(s.canAmbientTemp),
    canTpmsKpa: _tpms(s.canTpmsKpa),
    canDoorOpen: _bool(s.canDoorOpen),
    canParkingBrake: _bool(s.canParkingBrake),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Fabrika
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * DI ile `useUnifiedVehicleStore`'u HAL Provider Adapter'ın `VehicleStoreSource`'ına
 * uyarlar. YAN ETKİSİZ: oluşturma store'u OKUMAZ/ABONE OLMAZ (yalnız `getSnapshot()`/
 * `subscribe()` çağrılınca çalışır) → import edilmesi hiçbir davranış değiştirmez.
 */
export function createUnifiedVehicleStoreProvider(
  deps: UnifiedVehicleStoreProviderDeps,
): UnifiedVehicleStoreProvider {
  const store = deps && deps.store ? deps.store : null;
  // Aktif abonelikleri izle (dispose zero-leak + duplicate koruması).
  const unsubs = new Set<() => void>();

  function getSnapshot(): NormalizedVehicleSnapshot | null {
    if (!store) return null;                          // store yok → fail-soft
    let raw: UnifiedVehicleStateReadable | null = null;
    try { raw = store.getState(); } catch { return null; } // getState throw → fail-soft
    if (!raw || typeof raw !== 'object') return null;
    return _mapSnapshot(raw);                          // store state MUTATE EDİLMEZ
  }

  function subscribe(listener: () => void): () => void {
    if (!store) return () => { /* store yok → no-op unsub */ };
    let real: (() => void) | null = null;
    try {
      real = store.subscribe(() => { try { listener(); } catch { /* listener izole */ } });
    } catch {
      real = null;                                     // abonelik kurulamadı → fail-soft
    }
    if (real) unsubs.add(real);
    let done = false;                                  // İDEMPOTENT unsubscribe
    return () => {
      if (done) return;
      done = true;
      if (real) { unsubs.delete(real); try { real(); } catch { /* */ } real = null; }
    };
  }

  function dispose(): void {
    for (const u of unsubs) { try { u(); } catch { /* */ } }
    unsubs.clear();
  }

  return {
    getSnapshot,
    subscribe,
    dispose,
    get activeSubscriptionCount() { return unsubs.size; },
  };
}
