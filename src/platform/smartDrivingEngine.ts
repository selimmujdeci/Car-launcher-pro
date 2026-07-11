import type { DeviceStatus } from './deviceApi';
import type { DrivingMode, _SpeedEstimate } from './smartTypes';
import { DECAY_RATE_PER_S, DECAY_MAX_SEC, ACCEL_MOTION_MS2 } from './smartConstants';
import { subscribeMotion } from './sensors';

/* ── Accelerometer motion detection (TALEP-GÜDÜMLÜ) ──────────
 *
 * DeviceMotionEvent'in yatay bileşeni (yerçekimi hariç) araç hareketini
 * GPS/OBD olmadan tespit eder: fren, ivme, viraj → DrivingMode='normal'.
 *
 * PR 3 talep-güdümlü kapı: İvmeölçer YALNIZ `detectDrivingMode` Kademe 4'te,
 * yani OBD+GPS+decayed hız kaynaklarının HEPSİ yok/stale iken okunur → yardımcı
 * SON-ÇARE fallback. Bu yüzden ham/sürekli abonelik yerine yalnız TAZE güvenilir
 * hız kaynağı YOKKEN Orientation Sensor Gate üzerinden abone olunur; taze kaynak
 * (OBD veya GPS — `recordSpeed` ile beslenen `_lastSpeedEstimate`) varken abonelik
 * BIRAKILIR. Hiç kaynak yokken (ör. GPS fix yok + OBD yok) fail-safe açık kalır.
 * Gate arka planda (visibility hidden) fiziksel listener'ı kendisi söker.
 * İvmeölçer TEK BAŞINA safety-critical karar veya kesin araç hareketi ÜRETMEZ.
 */

let _accelMagnitude      = 0;      // yerçekimsiz yatay ivme büyüklüğü (m/s²)
let _accelFeatureEnabled = false;  // hook mount → özellik açık
let _accelRelease: (() => void) | null = null;  // gate aboneliği aktifse release

function _handleDeviceMotion(e: DeviceMotionEvent): void {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const raw = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
  // Yerçekimini (~9.81 m/s²) çıkar — yalnızca dinamik ivme kalmak için
  _accelMagnitude = Math.abs(raw - 9.81);
}

/**
 * İvmeölçer talebi: yalnız TAZE güvenilir hız kaynağı YOKKEN gerekli.
 * `_lastSpeedEstimate` hem OBD hem GPS ile beslenir (recordSpeed); yaş
 * DECAY_MAX_SEC'i aşarsa kaynak stale sayılır → yardımcı fallback gerekir.
 * (Magic number yok — DECAY_MAX_SEC mevcut decay penceresi sabiti.)
 */
function _accelDemandNeeded(): boolean {
  if (!_lastSpeedEstimate) return true;                          // hiç hız yok → fallback
  const ageSec = (performance.now() - _lastSpeedEstimate.tsMs) / 1000;
  return ageSec > DECAY_MAX_SEC;                                 // stale → fallback
}

/** Talep durumuna göre gate aboneliğini aç/kapat (idempotent). */
function _evaluateAccelDemand(): void {
  if (typeof window === 'undefined' || !window.DeviceMotionEvent) return;  // destek yok — permission davranışı korunur
  const need = _accelFeatureEnabled && _accelDemandNeeded();
  if (need && !_accelRelease) {
    _accelRelease = subscribeMotion(_handleDeviceMotion);       // ham window yerine gate
  } else if (!need && _accelRelease) {
    _accelRelease(); _accelRelease = null;                      // taze kaynak → bırak
    _accelMagnitude = 0;                                        // stale okuma kalmasın
  }
}

/** İvmeölçer özelliğini aç (hook mount). İdempotent. Talep varsa gate'ten abone olur. */
export function attachAccelerometer(): void {
  if (_accelFeatureEnabled) return;
  _accelFeatureEnabled = true;
  _evaluateAccelDemand();                                       // fail-safe: kaynak yoksa acquire
}

/** İvmeölçer özelliğini kapat — HMR cleanup ve app teardown. Gate aboneliğini bırakır. */
export function detachAccelerometer(): void {
  _accelFeatureEnabled = false;
  if (_accelRelease) { _accelRelease(); _accelRelease = null; }
  _accelMagnitude = 0;
}

// HMR cleanup — hot reload'da listener çoğalmasını önler
if (import.meta.hot) {
  import.meta.hot.dispose(() => detachAccelerometer());
}

/* ── Hız kademesi tahmini (Speed decay) ──────────────────────
 *
 * OBD veya GPS bağlantısı kesildiğinde son bilinen hız zamanla azaltılır.
 * Araç durdu mu yoksa yalnızca bağlantı mı kesildi bilgisini ayrıştırır.
 *
 * Bozulma katsayısı: saniyede %8 — 20 sn sonra hız 0'a inmiş sayılır.
 * (Trafik ışığı bekleme süresi ~45 sn → bu aralıkta 'idle' geçişi beklenir.)
 */

let _lastSpeedEstimate: _SpeedEstimate | null = null;

export function recordSpeed(kmh: number): void {
  // B30: performance.now() monotonic — DST/NTP clock jump'ta hız spike yok
  _lastSpeedEstimate = { kmh, tsMs: performance.now() };
  // Taze güvenilir hız kaynağı geldi → yardımcı ivmeölçer fallback'i bırak
  // (talep-güdümlü kapı). Kaynak yok/stale olduğunda attachAccelerometer veya
  // sonraki değerlendirme yeniden acquire eder.
  _evaluateAccelDemand();
}

function _decayedSpeed(): number | undefined {
  if (!_lastSpeedEstimate) return undefined;
  const ageSec = (performance.now() - _lastSpeedEstimate.tsMs) / 1000;
  if (ageSec > DECAY_MAX_SEC) return 0;
  return Math.round(_lastSpeedEstimate.kmh * Math.pow(DECAY_RATE_PER_S, ageSec));
}

/**
 * 5-kademeli sensör hiyerarşisi ile sürüş modu tespiti.
 *
 * Hiyerarşi (güvenilirlik sırası):
 *   1. OBD hızı    — CAN bus / tekerlek enkoderi, gecikme: 3 s, hata: ±0 km/h
 *   2. GPS hızı    — Doppler ölçümü, bağımsız, EMA filtreli, hata: ±2 km/h
 *   3. Decay hızı  — Son bilinen hız üstel bozulma ile (20 s'de sıfıra iner)
 *   4. İvmeölçer   — GPS/OBD tamamen yoksa hareket tespiti
 *   5. BT + şarj   — Yalnızca hiçbir hız sinyali yoksa; güvenilirlik: düşük
 *
 * ISO 26262 "fail towards safety" prensibi:
 *   Herhangi bir kaynaktan hız > 5 km/h geliyorsa araç hareket halindedir.
 *   Bu durumda alt kademeler bile 'idle' dönemez ("isDefinitelyMoving" guard).
 *
 * Mod eşikleri (km/h):
 *   idle:    speed <  1  (park, zengin animasyonlar)
 *   normal:  1 ≤ speed < 20  (şehir/trafik, orta animasyon)
 *   driving: speed ≥ 20  (yol/otoyol, minimal UI — sürücü güvenliği)
 *
 * @param device    BT bağlantısı ve şarj durumu (Kademe 5 sezgiseli için)
 * @param obdSpeed  OBD hızı km/h — undefined ise bu kademe atlanır
 * @param gpsSpeed  GPS hızı km/h — undefined ise bu kademe atlanır
 */
export function detectDrivingMode(
  device:    Pick<DeviceStatus, 'btConnected' | 'charging'>,
  obdSpeed?: number,
  gpsSpeed?: number,
): DrivingMode {
  // ── ISO 26262 Güvenlik Prensibi: Hız > 5 km/h → kesinlikle hareket ──
  // OBD veya GPS ayrı ayrı > 5 bildirebilir; ikisi çakışsa bile hareket
  // kabul edilir (sensör arızasında "güvenli taraf" = hareket).
  const decayed = _decayedSpeed();
  const isDefinitelyMoving =
    (obdSpeed !== undefined && obdSpeed > 5) ||
    (gpsSpeed !== undefined && gpsSpeed > 5) ||
    (decayed  !== undefined && decayed  > 5);

  // ── Kademe 1: OBD hızı (CAN bus / tekerlek enkoderi — en güvenilir) ─
  if (obdSpeed !== undefined) {
    if (obdSpeed < 1 && !isDefinitelyMoving) return 'idle';
    if (obdSpeed < 20) return 'normal';
    return 'driving';
  }

  // ── Kademe 2: GPS hızı (Doppler — bağımsız kaynak, EMA filtreli) ────
  if (gpsSpeed !== undefined) {
    if (gpsSpeed < 1 && !isDefinitelyMoving) return 'idle';
    if (gpsSpeed < 20) return 'normal';
    return 'driving';
  }

  // ── Kademe 3: Zaman-kademeli son bilinen hız ─────────────────────────
  // Bağlantı geçici kesildi ama araç hâlâ hareket ediyor olabilir.
  if (decayed !== undefined) {
    if (decayed < 1 && !isDefinitelyMoving) return 'idle';
    if (decayed < 20) return 'normal';
    return 'driving';
  }

  // ── Kademe 4: İvmeölçer büyüklüğü ───────────────────────────────────
  // 2.5 m/s² ≈ hafif fren/ivme — GPS/OBD yokken hareket kanıtı.
  if (_accelMagnitude > ACCEL_MOTION_MS2) return 'normal';

  // ── Kademe 5: BT + şarj sezgiseli (son çare, güvenilirlik: düşük) ───
  // Yalnızca hiçbir hız sinyali gelmediğinde çalışır.
  // GÜVENLIK: isDefinitelyMoving true ise bu kademe bile 'idle' dönemez.
  if (isDefinitelyMoving) return 'normal';
  return device.btConnected && device.charging ? 'idle' : 'normal';
}
