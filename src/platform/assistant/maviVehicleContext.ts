/**
 * maviVehicleContext — Mavi'nin komut başına GERÇEK araç bağlamını çözen SAF katman.
 * (MAVI-M2-VEHICLE-CONTEXT · M1 bulgu #1'i kapatır)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 denetimi (kütük #146) `processTextCommand`'ın ÜRETİMDE hiçbir çağıranda
 * `VehicleContext` almadığını kanıtladı → `isDriving` daima `false` idi ve
 * `useVoiceCommandHandler` sabit `{ speedKmh: 0, isDriving: false }` yazıyordu.
 * Yani ISO 15008 kısaltması, sürüş dispatch'i ve riskli eylem engelleri ÖLÜ koddu.
 *
 * ── ANAYASA ────────────────────────────────────────────────────────────────
 *  1. **"Veri yok" ≠ "araç duruyor".** Bilinmeyen durum `unknown` olarak TAŞINIR;
 *     `false`a çevrilmez. (`obd/writeGate.ts` ile aynı felsefe: kanıt yoksa iddia yok.)
 *  2. **Yeni paralel araç-state YOK.** Canlı okuma bu dosyada DEĞİL; kaynak DI ile
 *     kaydedilir (`setMaviVehicleSnapshotSource`) ve yalnız mevcut meşru servisleri
 *     okur (bkz. `maviVehicleSnapshotSource.ts`). Bu ayrım `assistantSafetyKernel`in
 *     "saf fonksiyon + tek canlı adaptör" desenini izler.
 *  3. **Yeni keyfi eşik YOK.** Tazelik penceresi çağıranın ölçtüğü `obdFreshWindowMs`
 *     (protokol kadansı), GPS için `GPS_STALE_MS`/`GPS_WEAK_ACCURACY_M`
 *     (`vehicleStatusModel`), durma eşiği `WRITE_GATE_STOPPED_SPEED_KMH`
 *     (`obd/writeGate`) — hepsi MEVCUT, gerekçelendirilmiş sabitler.
 *  4. **GPS "duruyor" KANITI SAYILMAZ.** Doppler hızı yalnız HAREKET'i kanıtlayabilir
 *     (güvenlik-pozitif yön). Hayalet/drift okuması "duruyor" derse riskli eylem
 *     yanlışlıkla açılırdı — bu yüzden GPS ile `stopped` ÜRETİLMEZ.
 *  5. **SAF resolver.** `resolveMaviVehicleContext` I/O yapmaz, store yazmaz, `Date.now`
 *     okumaz (`nowMs` enjekte edilir) → tam test edilebilir, deterministik.
 *  6. **Global "son bağlam" alanı YOK.** Bağlam komut başında bir kez çözülür ve o
 *     komut boyunca değişmez (`Object.freeze`). Modülde mutable bağlam TUTULMAZ.
 *
 * SAF/YAN-ETKİSİZ: bu modülü import etmek hiçbir servis başlatmaz (yalnız saf sabit
 * modülleri ve tip importları). Bu, `voiceService`in bağımlılık grafiğini ağırlaştırmaz.
 */

import { GPS_STALE_MS, GPS_WEAK_ACCURACY_M } from '../vehicleStatusModel';
import { WRITE_GATE_STOPPED_SPEED_KMH } from '../obd/writeGate';
import type { VehicleContext } from '../aiVoiceService';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler — hepsi MEVCUT kaynaklardan türer (yeni magic number yok)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `drivingMode: 'driving'` etiketinin alt sınırı (km/h). `smartDrivingEngine.
 * detectDrivingMode` Kademe-1'deki bandın AYNISI — etiket uygulamanın geri kalanıyla
 * tutarlı kalsın diye aynadır. Bu bir GÜVENLİK eşiği DEĞİLDİR (güvenlik kararı
 * `motionState` ile verilir); yalnız sunum etiketidir.
 */
export const MAVI_ACTIVE_DRIVING_KMH = 20;

/**
 * Fiziksel üst sınır — `UnifiedVehicleStore`'un hız güvenlik kapısıyla (`patch.speed
 * <= 300`) AYNI değer. Üstü sensör arızasıdır → kanıt sayılmaz.
 */
export const MAVI_MAX_PLAUSIBLE_KMH = 300;

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/** Aracın hareket durumu — ÜÇ DURUMLU. `unknown` asla `false`a indirgenmez. */
export type MaviMotionState = 'moving' | 'stopped' | 'unknown';

/** Hareket hükmünün hangi kanıta dayandığı (gözlemlenebilirlik — CAROS LAB). */
export type MaviMotionSource = 'obd_speed' | 'gps_doppler' | 'none';

/** Kontak hükmü — `deepScanIgnitionSource.IgnitionState` ile AYNI sözleşme. */
export type MaviIgnitionState = 'on' | 'off' | 'unknown';

/**
 * Resolver'ın SAF girdisi. Tüm alanlar okuma anındaki HAM ölçümlerdir; yorum
 * resolver'da yapılır. `null` = "bu kaynak bu an bilgi vermiyor" (sıfır DEĞİL).
 */
export interface MaviVehicleSnapshot {
  /** `obdService.getObdSpeedFresh()` — protokol kadansına göre zaten tazelik kapılı. */
  readonly obdSpeedFreshKmh: number | null;
  /** `connectionState === 'connected'`. */
  readonly obdConnected: boolean;
  /** Son gerçek telemetri paketinin Unix ms damgası. 0 = hiç veri gelmedi. */
  readonly obdLastSeenMs: number;
  /** `getObdFreshWindowMs()` — aktif poll kadansından türeyen tazelik penceresi. */
  readonly obdFreshWindowMs: number;
  /** GPS Doppler hızı (m/s). */
  readonly gpsSpeedMps: number | null;
  /** GPS fix doğruluğu (m). */
  readonly gpsAccuracyM: number | null;
  /** GPS fix'in Unix ms damgası. */
  readonly gpsFixAtMs: number | null;
  /** CAN/sistem geri vites bayrağı (iki kaynağın OR'u). Kaynak yoksa da `false` gelir. */
  readonly reverseSignal: boolean;
  /** Üç durumlu kontak hükmü. */
  readonly ignition: MaviIgnitionState;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF resolver
 * ════════════════════════════════════════════════════════════════════════ */

function _finiteSpeed(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;   // NaN · Infinity → kanıt yok
  if (v < 0 || v > MAVI_MAX_PLAUSIBLE_KMH) return null;            // negatif/imkânsız → kanıt yok
  return v;
}

/**
 * Snapshot + `now` → dondurulmuş `VehicleContext`. SAF · throw ETMEZ.
 *
 * Karar sırası (en güvenilirden en zayıfa; ilk KANIT kazanır):
 *  1. **OBD hızı** — tekerlek/CAN kaynaklı, `getObdSpeedFresh` ile zaten tazelik kapılı.
 *     Hem `moving` hem `stopped` kanıtı üretebilir (tek meşru "duruyor" kaynağı).
 *  2. **GPS Doppler** — bağımsız kaynak; YALNIZ `moving` kanıtı üretir. Taze fix +
 *     kabul edilebilir doğruluk şartı. "Duruyor" DEMEZ (bkz. anayasa §4).
 *  3. Kanıt yok → `unknown` · `speedKmh: null` (SIFIR YAZILMAZ).
 */
export function resolveMaviVehicleContext(
  snapshot: MaviVehicleSnapshot | null | undefined,
  nowMs: number,
): VehicleContext {
  const s = snapshot ?? null;
  const now = Number.isFinite(nowMs) ? nowMs : 0;

  let motionState: MaviMotionState = 'unknown';
  let motionSource: MaviMotionSource = 'none';
  let speedKmh: number | null = null;

  // ── Telemetri tazeliği (yaş negatifse saat geriye gitmiş → bayat say) ──────
  const ageMs = s && typeof s.obdLastSeenMs === 'number' && s.obdLastSeenMs > 0
    ? now - s.obdLastSeenMs
    : null;
  const window = s && Number.isFinite(s.obdFreshWindowMs) && s.obdFreshWindowMs > 0
    ? s.obdFreshWindowMs
    : null;
  const dataFresh = Boolean(
    s && s.obdConnected && ageMs !== null && window !== null && ageMs >= 0 && ageMs <= window,
  );

  if (s) {
    // 1 — OBD hızı: tek meşru "duruyor" kanıtı.
    const obd = _finiteSpeed(s.obdSpeedFreshKmh);
    if (obd !== null) {
      speedKmh = obd;
      motionSource = 'obd_speed';
      motionState = obd >= WRITE_GATE_STOPPED_SPEED_KMH ? 'moving' : 'stopped';
    } else {
      // 2 — GPS Doppler: YALNIZ hareket kanıtı.
      const fixAge = typeof s.gpsFixAtMs === 'number' && Number.isFinite(s.gpsFixAtMs) && s.gpsFixAtMs > 0
        ? now - s.gpsFixAtMs
        : null;
      const accuracyOk = typeof s.gpsAccuracyM === 'number' && Number.isFinite(s.gpsAccuracyM)
        && s.gpsAccuracyM >= 0 && s.gpsAccuracyM <= GPS_WEAK_ACCURACY_M;
      const fixFresh = fixAge !== null && fixAge >= 0 && fixAge <= GPS_STALE_MS;
      const mps = typeof s.gpsSpeedMps === 'number' && Number.isFinite(s.gpsSpeedMps) && s.gpsSpeedMps >= 0
        ? s.gpsSpeedMps
        : null;
      const gpsKmh = mps !== null ? _finiteSpeed(mps * 3.6) : null;
      if (fixFresh && accuracyOk && gpsKmh !== null && gpsKmh >= WRITE_GATE_STOPPED_SPEED_KMH) {
        speedKmh = gpsKmh;
        motionSource = 'gps_doppler';
        motionState = 'moving';
      }
      // GPS "0 km/h" diyorsa DURUYOR DEMEZ → unknown kalır (anayasa §4).
    }
  }

  // ── Geri vites: pozitif sinyal kanıttır; yoksa ancak CANLI kaynak varken 'false' ──
  const reverseActive: boolean | undefined = s?.reverseSignal === true
    ? true
    : dataFresh ? false : undefined;   // canlı kaynak yok → BİLİNMİYOR (false varsayılmaz)

  // ── Kontak: üç durumlu kaynak birebir taşınır ─────────────────────────────
  const ignitionOn: boolean | undefined = s?.ignition === 'on' ? true
    : s?.ignition === 'off' ? false
      : undefined;

  /* `drivingMode` yalnız SUNUM etiketidir (prompt/telemetri). `unknown` için
     'normal' seçilir — `detectDrivingMode`'un kendi fail-safe'i ile AYNI yön
     ("bilmiyorsak duruyor deme"). Güvenlik kararı DAİMA `motionState` iledir. */
  const drivingMode: VehicleContext['drivingMode'] =
    motionState === 'moving'
      ? ((speedKmh ?? 0) >= MAVI_ACTIVE_DRIVING_KMH ? 'driving' : 'normal')
      : motionState === 'stopped' ? 'idle' : 'normal';

  return Object.freeze({
    speedKmh,
    drivingMode,
    // Eski boolean sözleşme KORUNUR: yalnız DOĞRULANMIŞ hareket `true` üretir.
    // Riskli eylem kapıları `isDriving`e DEĞİL `motionState`e bakar (unknown ≠ parked).
    isDriving: motionState === 'moving',
    motionState,
    motionSource,
    reverseActive,
    ignitionOn,
    dataFresh,
    lastPacketAgeMs: ageMs !== null && ageMs >= 0 ? ageMs : null,
    resolvedAtMs: now,
  });
}

/**
 * Bağlam hiç çözülemediğinde kullanılacak DÜRÜST bilinmeyen bağlam.
 * ⚠️ Bu bir "park halinde" varsayımı DEĞİLDİR — `motionState: 'unknown'` taşır,
 * böylece riskli eylem kapıları fail-closed kalır.
 */
export function unknownMaviVehicleContext(nowMs = 0): VehicleContext {
  return resolveMaviVehicleContext(null, nowMs);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Canlı kaynak kaydı (DI — `setMaviOwnershipResolver` deseniyle birebir)
 * ════════════════════════════════════════════════════════════════════════ */

/** Canlı snapshot okuyucusu. Kayıt: `platformCoreMaviVoiceWiring` (SystemBoot). */
export type MaviVehicleSnapshotSource = () => MaviVehicleSnapshot;

let _source: MaviVehicleSnapshotSource | null = null;

/**
 * Canlı kaynağı kaydeder (idempotent — son kayıt geçerlidir). Kaynak KAYITLI DEĞİLSE
 * `currentMaviVehicleContext` DÜRÜSTÇE `unknown` döner — "parked" varsayılmaz.
 */
export function setMaviVehicleSnapshotSource(source: MaviVehicleSnapshotSource | null): void {
  _source = typeof source === 'function' ? source : null;
}

/** Kayıtlı mı (tanı/guard testi). */
export function hasMaviVehicleSnapshotSource(): boolean {
  return _source !== null;
}

/**
 * **Komut başına TEK çağrı.** Canlı snapshot + saf resolver → immutable bağlam.
 * Kaynak yoksa veya okuma throw ederse → `unknown` (fail-closed, park DEĞİL).
 */
export function currentMaviVehicleContext(nowMs: number = Date.now()): VehicleContext {
  try {
    const src = _source;
    if (!src) return unknownMaviVehicleContext(nowMs);
    return resolveMaviVehicleContext(src(), nowMs);
  } catch {
    return unknownMaviVehicleContext(nowMs);
  }
}

/** @internal — testler arası izolasyon. */
export function _resetMaviVehicleContextForTest(): void {
  _source = null;
}
