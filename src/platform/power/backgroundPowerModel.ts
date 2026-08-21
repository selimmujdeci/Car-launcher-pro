/**
 * backgroundPowerModel — arka plan güç politikası KARARI (saf çekirdek).
 *
 * ── KÖK NEDEN (SAHADA ÖLÇÜLDÜ 2026-08-20, Redmi Note 13 Pro 5G / telefon) ──
 * Uygulama arka plandayken ve araç park hâlindeyken bile iki pahalı donanım
 * kesintisiz açık kalıyordu:
 *
 *   · GPS — `gpsService` `watchPosition({ enableHighAccuracy: true })` ile
 *     GMS FusedLocationProvider üzerinden **HIGH_ACCURACY @10 s** istiyordu.
 *     `dumpsys location`: `mStarted=true (changed +6h16m ago)`, 86.422 fix,
 *     cihaz 1 g 19 s hareketsizken. 24 saatte **10 s 30 dk GNSS**.
 *     NOT: native `CarLauncherForegroundService` park kısmasını DOĞRU yapıyordu
 *     (listener listesinde yoktu) — kaçak tamamen JS watch'ındaydı.
 *   · Mikrofon — `wakeWordService` native dinleme döngüsü hiç durmuyordu:
 *     `PARTIAL_WAKE_LOCK 'AudioIn' ws=WorkSource{10626}`. 24 saatte
 *     **9 s 20 dk audio + 4 s 55 dk wakelock** → 16 saatte yalnız 169 dk deep
 *     sleep, Doze fiilen hiç çalışmadı. Ölçülen tüketim: **612 mAh/h**
 *     (pil 3598 mAh); ekran KAPALI iken her 5-8 dakikada %1.
 *
 * ── SÖZLEŞME — bu model NE YAPMAZ ────────────────────────────────────────
 *   · I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 *   · Donanıma DOKUNMAZ; yalnız "hangi mod olmalı" sorusunu yanıtlar.
 *   · Head unit davranışını DEĞİŞTİRMEZ: harici güç varken (sürekli beslemeli
 *     head unit her zaman şarjdadır) karar mevcut davranışın aynısıdır.
 *   · Navigasyon otoritesini EZMEZ: rota sürerken kısma YOKTUR — bu, native
 *     tarafta zaten var olan `sNavigationActive` istisnasının JS ikizidir.
 *
 * Kanıtsız iyimserlik üretmemek için `null` girdiler (bilinmiyor) muhafazakâr
 * yorumlanır: bilinmeyen güç kaynağında mikrofona DOKUNULMAZ.
 */

/** JS konum akışının güç modu. */
export type GpsPowerMode =
  /** Mevcut davranış: `enableHighAccuracy: true`, RuntimeEngine aralığı. */
  | 'high'
  /** Kısık: `enableHighAccuracy: false` + uzun aralık — GNSS uyandırılmaz. */
  | 'low';

/** Pasif wake-word mikrofonunun güç modu. */
export type MicPowerMode = 'on' | 'off';

/** Kararın TEK gerekçesi — tanı ekranında ham gösterilir, hüküm içermez. */
export type BackgroundPowerReason =
  /** Rota sürüyor — kısma yok (native `sNavigationActive` ile aynı istisna). */
  | 'navigation_active'
  /** Uygulama ön planda (veya durum bilinmiyor) — kısma yok. */
  | 'foreground'
  /** Arka plan ama harici güç var (head unit / şarj) — kısma yok. */
  | 'external_power'
  /** Arka plan + pil ile çalışıyor — GPS kısılır, mikrofon susar. */
  | 'background_battery'
  /** Arka plan ama güç kaynağı okunamadı — yalnız GPS kısılır. */
  | 'background_power_unknown';

export interface BackgroundPowerInputs {
  /** Uygulama ön planda mı. `null` = okunamadı (Capacitor App yok/hata). */
  readonly appActive: boolean | null;
  /** Canlı navigasyon oturumu var mı. */
  readonly navigationActive: boolean;
  /** Harici güç (şarj/head unit) bağlı mı. `null` = okunamadı (Battery API yok). */
  readonly externalPower: boolean | null;
  /** Kullanıcı ayarında pasif wake açık mı — kapalıysa mikrofon zaten kapalıdır. */
  readonly wakeWordEnabled: boolean;
}

export interface BackgroundPowerDecision {
  readonly gps: GpsPowerMode;
  readonly mic: MicPowerMode;
  readonly reason: BackgroundPowerReason;
}

/**
 * Kısık moddaki konum aralığı (ms).
 *
 * 30 s, `enableHighAccuracy: false` ile birlikte GNSS alıcısını uyandırmadan
 * ağ/pasif konumla akışın SÜRMESİNİ sağlar. Akışı tamamen kesmek yerine kısmak
 * bilinçli bir fail-soft tercihidir: native arka plan servisi izin/ölüm
 * nedeniyle beslemiyorsa bile konum sessizce kaybolmaz.
 */
export const BACKGROUND_GPS_INTERVAL_MS = 30_000;

/**
 * Arka plan güç kararını üretir.
 *
 * Öncelik sırası (ilk eşleşen kazanır):
 *   1. Navigasyon aktif       → tam güç.
 *   2. Ön planda / bilinmiyor → tam güç.
 *   3. Harici güç var         → tam güç (head unit davranışı korunur).
 *   4. Arka plan + pil        → GPS kısık, mikrofon kapalı.
 *   5. Arka plan + güç bilinmiyor → GPS kısık, mikrofona dokunulmaz.
 */
export function decideBackgroundPower(i: BackgroundPowerInputs): BackgroundPowerDecision {
  /** Ayar kapalıysa mikrofon zaten kapalıdır — model onu "açtırmaz". */
  const micWhenAllowed: MicPowerMode = i.wakeWordEnabled ? 'on' : 'off';

  if (i.navigationActive) {
    return { gps: 'high', mic: micWhenAllowed, reason: 'navigation_active' };
  }

  // `null` = okunamadı → ön plan varsayılır (mevcut davranışı bozma).
  if (i.appActive !== false) {
    return { gps: 'high', mic: micWhenAllowed, reason: 'foreground' };
  }

  if (i.externalPower === true) {
    return { gps: 'high', mic: micWhenAllowed, reason: 'external_power' };
  }

  if (i.externalPower === false) {
    return { gps: 'low', mic: 'off', reason: 'background_battery' };
  }

  // Güç kaynağı bilinmiyor: GPS'i kısmak güvenlidir (akış sürer), ama
  // mikrofonu susturmak kullanıcıyı sessizce sağır bırakabilir → dokunma.
  return { gps: 'low', mic: micWhenAllowed, reason: 'background_power_unknown' };
}

/** İki kararın uygulanabilir farkı var mı — gereksiz donanım thrash'ini önler. */
export function isSameDecision(
  a: BackgroundPowerDecision | null,
  b: BackgroundPowerDecision,
): boolean {
  return a !== null && a.gps === b.gps && a.mic === b.mic;
}
