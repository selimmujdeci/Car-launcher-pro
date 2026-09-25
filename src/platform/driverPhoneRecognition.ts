/**
 * driverPhoneRecognition — sürücüyü telefonundan tanıma.
 *
 * Bir sürücüye bağlanmış telefon (Bluetooth ADRESİ; ad çakışabilir) araca
 * bağlanınca o sürücünün profili kendiliğinden gelir. Karar `decidePhoneSwitch`
 * (SAF); profil geçişi yine tek yazma yolu `switchDriver`dan yapılır.
 *
 * Kurallar:
 *  · Tanınmayan cihaz (OBD adaptörü, kulaklık…) hiçbir şey yapmaz.
 *  · Etkin sürücünün telefonu hâlâ bağlıysa geçiş YOK (iki kişi aynı araçta:
 *    sonradan binen, sürenin profilini ezmez).
 *  · Araç hareket hâlindeyken ekran/ses aniden değişmez: geçiş yapılmaz, sürücüye
 *    haber verilir.
 *  · Karar yalnız BAĞLANMA anında verilir → elle yapılan seçim sürekli ezilmez.
 */
import { CarLauncher } from './nativePlugin';
import { isNative } from './bridge';
import { useStore, type DriverProfile } from '../store/useStore';
import { switchDriver } from './driverProfileService';
import { getObdSpeedFresh } from './obdService';
import { getGPSSpeedKmh } from './gpsService';
import { showToast } from './errorBus';

export interface BtDevice { readonly address: string; readonly name: string }

export type PhoneDecision =
  | { readonly action: 'switch'; readonly driverId: string }
  | { readonly action: 'none'; readonly reason: 'UNKNOWN_DEVICE' | 'ALREADY_ACTIVE' | 'ACTIVE_DRIVER_PRESENT' | 'AMBIGUOUS' }
  | { readonly action: 'deferred'; readonly driverId: string; readonly reason: 'MOVING' };

/** Hareket eşiği (km/s) — ölçülen hız bunun üstündeyse geçiş ertelenir. */
export const MOVING_KMH = 8;

export const normAddr = (a: string): string => a.trim().toUpperCase();

/**
 * Yeni bağlanan cihaz(lar) için karar. `candidates` boot'ta tüm bağlı cihazlar,
 * olay anında yalnız yeni bağlanandır.
 */
export function decidePhoneSwitch(input: {
  drivers: readonly DriverProfile[];
  activeId: string | null;
  connected: ReadonlySet<string>;
  candidates: readonly string[];
  moving: boolean;
}): PhoneDecision {
  const byAddr = new Map<string, DriverProfile>();
  for (const d of input.drivers) if (d.phone?.address) byAddr.set(normAddr(d.phone.address), d);

  const matched = [...new Set(input.candidates.map(normAddr))]
    .map((a) => byAddr.get(a)).filter((d): d is DriverProfile => !!d);
  if (matched.length === 0) return { action: 'none', reason: 'UNKNOWN_DEVICE' };
  if (matched.some((d) => d.id === input.activeId)) return { action: 'none', reason: 'ALREADY_ACTIVE' };

  const active = input.drivers.find((d) => d.id === input.activeId);
  if (active?.phone?.address && input.connected.has(normAddr(active.phone.address))) {
    return { action: 'none', reason: 'ACTIVE_DRIVER_PRESENT' };
  }
  const ids = [...new Set(matched.map((d) => d.id))];
  if (ids.length > 1) return { action: 'none', reason: 'AMBIGUOUS' };
  return input.moving
    ? { action: 'deferred', driverId: ids[0], reason: 'MOVING' }
    : { action: 'switch', driverId: ids[0] };
}

/* ── Çalışma zamanı ─────────────────────────────────────────────────────── */

const _connected = new Map<string, BtDevice>();
const _listeners = new Set<() => void>();
const _notify = () => _listeners.forEach((fn) => { try { fn(); } catch { /* izole */ } });

/** Şu an bağlı BT cihazları (Profiller'de "bu benim telefonum" seçimi için). */
export function getConnectedBtDevices(): BtDevice[] { return [..._connected.values()]; }
export function subscribeConnectedBtDevices(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function _isMoving(): boolean {
  const obd = getObdSpeedFresh();
  if (obd !== null) return obd > MOVING_KMH;
  const gps = getGPSSpeedKmh();
  return gps !== null && gps > MOVING_KMH;
}

function _evaluate(candidates: string[]): void {
  const s = useStore.getState().settings;
  const decision = decidePhoneSwitch({
    drivers: s.driverProfiles ?? [], activeId: s.activeDriverProfileId,
    connected: new Set(_connected.keys()), candidates, moving: _isMoving(),
  });
  if (decision.action === 'none') return;
  const d = (s.driverProfiles ?? []).find((x) => x.id === decision.driverId);
  if (!d) return;
  if (decision.action === 'deferred') {
    showToast({ type: 'info', title: `Telefon tanındı: ${d.name}`, message: 'Araç dururken Profiller\'den geçebilirsin.', duration: 4000 });
    return;
  }
  if (switchDriver(d.id)) {
    showToast({ type: 'success', title: `Hoş geldin, ${d.name}`, message: 'Telefonun tanındı, tercihlerin uygulandı.', duration: 3000 });
  }
}

/** Test/olay girişi — native olayla aynı yol. */
export function handleBtChange(evt: { connected: boolean; deviceName: string; deviceAddress?: string }): void {
  const addr = evt.deviceAddress ? normAddr(evt.deviceAddress) : '';
  if (!addr) return;                       // eski plugin: adres yok → tanıma yok
  if (!evt.connected) { if (_connected.delete(addr)) _notify(); return; }
  _connected.set(addr, { address: addr, name: evt.deviceName || addr });
  _notify();
  _evaluate([addr]);
}

/** Uygulama açılışında zaten bağlı telefonları tohumlar ve bir kez değerlendirir. */
export function seedConnectedDevices(devices: readonly BtDevice[]): void {
  for (const d of devices) if (d?.address) _connected.set(normAddr(d.address), { address: normAddr(d.address), name: d.name || d.address });
  _notify();
  if (devices.length) _evaluate(devices.map((d) => d.address));
}

export function _resetPhoneRecognitionForTest(): void { _connected.clear(); _notify(); }

/** Tek sefer kurulur; dönen fonksiyon aboneliği kaldırır. */
export function startDriverPhoneRecognition(): () => void {
  if (!isNative) return () => {};
  let handle: { remove: () => Promise<void> } | null = null;
  let disposed = false;
  void CarLauncher.addListener('btChanged', handleBtChange).then((h) => {
    if (disposed) void h.remove(); else handle = h;
  }).catch(() => {});
  void CarLauncher.getDeviceStatus().then((st) => {
    if (!disposed && Array.isArray(st.btConnectedDevices)) seedConnectedDevices(st.btConnectedDevices);
  }).catch(() => {});
  return () => { disposed = true; void handle?.remove(); };
}
