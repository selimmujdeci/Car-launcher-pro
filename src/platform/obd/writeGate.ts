/**
 * OBD Write Gate — araca YAZAN her işlemin geçmek zorunda olduğu güvenlik kapısı.
 * (OBD-OS-F0-6)
 *
 * NEDEN: CarOS Pro'nun kullanıcıya verdiği söz "araca zarar vermem"dir. Okuma
 * (Mode 01/03/07/09…) zararsızdır; YAZMA (Mode 04 = DTC hafızasını sil) ECU
 * durumunu KALICI olarak değiştirir: arıza kanıtı silinir, emisyon hazırlık
 * monitörleri (readiness) sıfırlanır → araç muayeneden "hazır değil" diye döner.
 * Seyir halindeyken tetiklenmesi ayrıca sürücüyü ekrana çeker + ECU'yu meşgul eder.
 *
 * Bu modül SAF ve senkron'dur (I/O yok, native yok) — tek görevi KARAR üretmek.
 * Kararı uygulamak (native çağrıyı engellemek) çağıranın sorumluluğudur; kapı
 * `dtcService.clearDTCCodes` içinde ZORUNLU geçilir (bypass yolu yoktur).
 *
 * FAIL-CLOSED: kanıt yoksa REDDET. "Hız bilinmiyor" ≠ "hız sıfır". Bayat veriyle
 * (araç 90 km/h'te ama son paket 10 sn önce geldi) "duruyor" kararı vermek,
 * kapının hiç olmamasından daha tehlikelidir — sahte güven üretir.
 */

/** Yazma reddedilme sebebi — UI'ın kullanıcıya ne söyleyeceğini belirler. */
export type WriteGateDenyReason =
  | 'not_connected'    // OBD bağlı değil → yazma imkânsız
  | 'stale_data'       // son telemetri çok eski → hız iddiası doğrulanamaz
  | 'speed_unknown'    // araç hız PID'ini desteklemiyor/vermiyor
  | 'vehicle_moving'   // araç hareket halinde
  | 'not_confirmed';   // kullanıcı açık onay vermedi

/** Bloke etmeyen ama kullanıcıya söylenmesi gereken durumlar (8-kapı: anlam üret). */
export type WriteGateAdvisory =
  | 'engine_running';  // motor çalışıyor → ECU arızayı anında yeniden yazabilir

export type WriteGateDecision =
  | { allowed: true;  advisories: WriteGateAdvisory[] }
  | { allowed: false; reason: WriteGateDenyReason; userMessage: string; advisories: WriteGateAdvisory[] };

/** Kapının karar verirken kullandığı KANIT — çağıranın iddiası değil, servisin ölçümü. */
export interface WriteGateContext {
  /** OBD bağlantı durumu — 'connected' dışındaki her şey yazmayı bloklar. */
  connectionState: string;
  /** Son OBD hızı (km/h). Negatif/NaN → araç bu PID'i vermiyor (bilinmiyor). */
  speedKmh: number;
  /** Motor devri (RPM). Negatif → bilinmiyor/EV (advisory üretmez, BLOKLAMAZ). */
  rpm: number;
  /** Son gerçek telemetri paketinin Unix ms zamanı. 0 = hiç veri gelmedi. */
  lastSeenMs: number;
  /** Şimdi (Unix ms) — tazelik hesabı için enjekte edilir (saf/test edilebilir). */
  nowMs: number;
  /** Kullanıcı yıkıcı eylemi AÇIKÇA onayladı mı (iki-aşamalı UI onayı). */
  confirmed: boolean;
}

/**
 * Telemetri bu süreden eskiyse "hız 0" iddiası KANIT sayılmaz. 3 sn: OBD poll
 * döngüsü sağlıklıyken ~3 Hz veri akar; 3 sn sessizlik = en az ~9 kayıp paket
 * → bağlantı/ECU sorunlu, o hız değeri artık aracın gerçeğini temsil etmiyor.
 */
export const WRITE_GATE_MAX_DATA_AGE_MS = 3_000;

/**
 * Bu hızın ALTI "duruyor" sayılır. OBD hızı tamsayı km/h yayınlar; 1 km/h eşiği
 * el freni çekili araçta sensör gürültüsüne pay bırakır, yürüme hızını (≥3 km/h)
 * geçirmez.
 */
export const WRITE_GATE_STOPPED_SPEED_KMH = 1;

/**
 * Mode 04 (DTC hafızasını sil) yazma kapısı.
 *
 * Kapılar FAIL-CLOSED sırayla değerlendirilir; ilk düşen kapı kararı verir
 * (en temel önkoşuldan en spesifiğe: bağlantı → kanıt tazeliği → hız → onay).
 */
export function evaluateDtcClearGate(ctx: WriteGateContext): WriteGateDecision {
  const advisories: WriteGateAdvisory[] = [];
  // Motor çalışıyor: BLOKLAMAZ (araç duruyorsa silmek güvenlidir) ama kullanıcıya
  // söylenir — aktif arıza motor çalışırken anında yeniden set edilebilir, kod
  // "geri geldi" diye şaşırmasın. rpm<0 → bilinmiyor/EV → sessiz kal (uydurma yok).
  if (Number.isFinite(ctx.rpm) && ctx.rpm > 0) advisories.push('engine_running');

  const deny = (reason: WriteGateDenyReason, userMessage: string): WriteGateDecision =>
    ({ allowed: false, reason, userMessage, advisories });

  if (ctx.connectionState !== 'connected') {
    return deny('not_connected', 'Araç bağlı değil — arıza hafızası silinemez.');
  }

  // Tazelik: hız/RPM iddiası ancak CANLI telemetriyle kanıtlanır.
  const dataAgeMs = ctx.lastSeenMs > 0 ? ctx.nowMs - ctx.lastSeenMs : Number.POSITIVE_INFINITY;
  if (!(dataAgeMs <= WRITE_GATE_MAX_DATA_AGE_MS)) {
    return deny('stale_data', 'Araç verisi güncel değil — güvenlik gereği silme yapılmadı. Bağlantı düzelince tekrar deneyin.');
  }

  if (!Number.isFinite(ctx.speedKmh) || ctx.speedKmh < 0) {
    return deny('speed_unknown', 'Araç hızı doğrulanamıyor — güvenlik gereği silme yapılmadı.');
  }

  if (ctx.speedKmh >= WRITE_GATE_STOPPED_SPEED_KMH) {
    return deny('vehicle_moving', 'Araç hareket halinde — arıza hafızası yalnızca araç dururken silinebilir.');
  }

  if (!ctx.confirmed) {
    return deny('not_confirmed', 'Bu işlem arıza kanıtını ve emisyon hazırlık verisini kalıcı olarak siler. Onaylamanız gerekiyor.');
  }

  return { allowed: true, advisories };
}
