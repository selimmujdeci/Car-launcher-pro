/**
 * motionSafetyPolicy — TEK hareket-güvenliği kararı (MRI F-03 kapanışı).
 *
 * ── NEDEN (ölçülen kusur, MRI 2026-09-19) ────────────────────────────────
 * Aynı fiziksel eylem (kapı açma) için üç ayrı kural vardı:
 *   · Mavi (`maviActionAuthority`): `requires_stopped` → yalnız DOĞRULANMIŞ
 *     `stopped` geçer; `moving` ve `unknown` reddedilir (fail-closed).
 *   · Uzak komut (`commandListener.judgeMovingGate`): taze hız > 5 km/h → red,
 *     ama hız YOK/BAYAT → `SPEED_UNKNOWN` → **icra ediliyordu** (fail-open).
 *   · Native uyku yolu (`CommandService.java`, dormant): kapı yok.
 * Bilinmeyen/bayat hız bir kanalda "duruyor" sayılırken diğerinde reddediliyordu.
 *
 * ── KURAL ─────────────────────────────────────────────────────────────────
 * Bu modül SAF bir karar fonksiyonudur; telemetri OKUMAZ, timer kurmaz, durum
 * tutmaz. Kanıt dışarıdan gelir (kanonik kaynak: `assistant/maviVehicleContext`
 * → `motionState`, `speedKmh`, `isDriving`). Politika (`any` | `requires_stopped`)
 * eylemin kendi tanımından gelir (`maviActionAuthority.VEHICLE_ACTIONS`) — ikinci
 * bir eylem tablosu KURULMAZ. Her tüketici (Mavi, uzak komut) AYNI fonksiyonu
 * çağırır; farklı karar üretmesi yapısal olarak mümkün değildir.
 *
 * UNKNOWN politikası: `requires_stopped` için `unknown`/bayat/çelişkili kanıt
 * → **BLOCK** (`motion_unverified`). Gerekçe: bu ürün mimarisinde uzak kanal
 * araca hareket kanıtı taşıyamaz ve "ertele" için kanıt gelene dek bekleyecek
 * bir oturum yoktur; onay ise zaten telefonda/Mavi'de ayrı katmandır ve
 * hareket kanıtının yerine GEÇEMEZ. UNKNOWN ≠ STOPPED, UNKNOWN ≠ 0 (§8).
 */

export type MotionPolicy =
  /** Hareket durumu ne olursa olsun yürüyebilir. */
  | 'any'
  /** YALNIZ DOĞRULANMIŞ `stopped`. `moving` VE `unknown` reddedilir (fail-closed). */
  | 'requires_stopped';

/** MAVI-M2 üç durumlu hareket hükmü (`assistant/maviVehicleContext` sözleşmesi). */
export type MotionState = 'moving' | 'stopped' | 'unknown';

/**
 * "Duruyor" sayılabilecek azami hız (km/h). Sürünen araç duruyor değildir; OBD'nin
 * durma kararı (`obd/writeGate`, 1 km/h) ile aynı ailedendir.
 */
export const MOTION_STOPPED_MAX_KMH = 3;

/** Karar girdisi — kanıt; kaynak bu modülün konusu değildir. */
export interface MotionEvidence {
  /** Kanonik üç durumlu hüküm. `undefined` = alan hiç taşınmadı → `unknown` gibi. */
  readonly motionState?: MotionState;
  /** Anlık hız (km/h). `null`/`undefined` = BİLİNMİYOR — 0 DEĞİL. */
  readonly speedKmh?: number | null;
  /** Doğrulanmış sürüş bayrağı (yalnız HAREKET kanıtı üretir, durma kanıtı değil). */
  readonly isDriving?: boolean;
}

export type MotionVerdictReason =
  /** Politika `any` — hareket kapısı bu eylem için yok. */
  | 'not_gated'
  /** Kanonik `stopped` + hiçbir hareket kanıtı yok. */
  | 'verified_stopped'
  /** En az bir kaynak hareket diyor (motionState/isDriving/hız). */
  | 'vehicle_moving'
  /** Kanıt yok, bayat ya da çelişkili — "bilinmiyorsa duruyor varsayma". */
  | 'motion_unverified';

export interface MotionSafetyVerdict {
  readonly allow: boolean;
  readonly reason: MotionVerdictReason;
  /** Teşhis: hareket kanıtı bulundu mu (red gerekçesini ayırır). */
  readonly movingProof: boolean;
}

/**
 * Hareket güvenliği kararı — SAF.
 *
 * Hareket KANITI: üç bağımsız kaynaktan biri bile hareket diyorsa hareket sayılır.
 * Çelişki de kanıttır: `stopped` denip hız yüksekse telemetriye güvenilmez.
 */
export function judgeMotionSafety(policy: MotionPolicy, ev: MotionEvidence | null | undefined): MotionSafetyVerdict {
  if (policy === 'any') return Object.freeze({ allow: true, reason: 'not_gated', movingProof: false });

  const motion = ev?.motionState;
  const speed  = typeof ev?.speedKmh === 'number' && Number.isFinite(ev.speedKmh) ? ev.speedKmh : null;
  const movingProof = motion === 'moving'
    || ev?.isDriving === true
    || (speed !== null && speed > MOTION_STOPPED_MAX_KMH);
  const verifiedStopped = motion === 'stopped' && !movingProof;

  if (verifiedStopped) return Object.freeze({ allow: true, reason: 'verified_stopped', movingProof: false });
  return Object.freeze({
    allow: false,
    reason: movingProof ? 'vehicle_moving' : 'motion_unverified',
    movingProof,
  });
}

/** Kullanıcıya/telefona dönen gerekçe metni — tek yerde (iki kanal aynı cümleyi söyler). */
export function motionVerdictUserMessage(reason: MotionVerdictReason): string {
  switch (reason) {
    case 'vehicle_moving':     return 'Sürüş güvenliği: araç hareket hâlinde — komut reddedildi';
    case 'motion_unverified':  return 'Sürüş güvenliği: araç hareket durumu doğrulanamadı — komut uygulanmadı';
    case 'verified_stopped':   return 'Araç duruyor — komut uygulanabilir';
    case 'not_gated':          return 'Hareket kapısı yok';
  }
}
