/**
 * gpsHealthReconcile — GPS sağlığının TEK kanonik sınıflandırıcısı (SAF).
 *
 * ── NEDEN (gerçek sürüş kaydı 2026-08-03) ──────────────────────────────────
 * Araç 86 km/h ile giderken CAROS LAB kaydına şunlar düştü:
 *     "No heartbeat for 20s"  ·  conn=connected  ·  dataFresh=true
 * AYNI snapshot'ta ise: `gpsAlive=true`, `GPS connected=true`,
 * `confidence=0.7`, `lastSignalAt` GÜNCEL.
 *
 * Yani ürün aynı anda iki zıt şey söylüyordu. Sebep: **iki ayrı otorite**
 * birbirini görmüyordu —
 *   (1) `SystemHealthMonitor` heartbeat'i: YAŞ tabanlı ("kaç sn'dir sinyal yok")
 *   (2) HAL/GPS store: fix VARLIĞI tabanlı ("son fix güncel mi")
 * Heartbeat kaynağı ayrıca fix VARIŞINDAN değil store REFERANS DEĞİŞİMİNDEN
 * besleniyordu (bkz. kütük #327) → park hâlinde aynı fix tekrarlanınca beat
 * üretilmiyor, alarm YALAN çalıyordu.
 *
 * Bu modül YENİ bir sağlık motoru DEĞİLDİR: iki mevcut otoritenin çıktısını
 * alıp TEK bir sınıfa indirger. Karar üretmez, ölçüm yapmaz, I/O yapmaz.
 *
 * ── SÖZLEŞME ───────────────────────────────────────────────────────────────
 * • `dataFresh` (gerçek fix defteri) ile heartbeat ÇELİŞİYORSA doğrudan
 *   KAYIP/FAIL üretilmez → `GPS_HEALTH_CONFLICT`. Çelişki bir arıza değil,
 *   bir ÖLÇÜM TUTARSIZLIĞIDIR ve öyle raporlanmalıdır.
 * • Tek gecikmiş callback kayıp sayılmaz (heartbeat eşiği bunu zaten tolere
 *   eder; burada ayrıca fix tazeliğiyle çapraz doğrulanır).
 * • Arka plan askıya alınması ile gerçek sinyal kaybı AYRILIR.
 * • Sebep bilinmiyorsa "tünel" DENMEZ → `GPS_UNKNOWN`.
 * • Ölçülemeyen girdi (null) başarı sayılmaz.
 */

export type GpsHealthClass =
  /** Fix defteri bayat: gerçekten yeni konum gelmiyor. */
  | 'GPS_FIX_STALE'
  /** Heartbeat bayat ama fix tazeliği doğrulanamadı — izleme kanalı sessiz. */
  | 'GPS_HEARTBEAT_STALE'
  /** Sağlayıcı bağlı değil (izin yok / watch kapalı / donanım yok). */
  | 'GPS_PROVIDER_DISCONNECTED'
  /** Uygulama arka planda; OS callback'leri askıya aldı — sinyal kaybı DEĞİL. */
  | 'GPS_BACKGROUND_SUSPENDED'
  /** Önceki bir bayatlıktan sonra taze fix + taze heartbeat geri geldi. */
  | 'GPS_RECOVERED'
  /** İki otorite ÇELİŞİYOR: fix taze ama heartbeat bayat (veya tersi). */
  | 'GPS_HEALTH_CONFLICT'
  /** Ölçülemedi. Başarı DEĞİLDİR. */
  | 'GPS_UNKNOWN';

export interface GpsHealthInput {
  /** Sağlayıcı bağlı mı (watch kurulu + izin var). null = bilinmiyor. */
  connected:        boolean | null;
  /** Son GEÇERLİ fix'in yaşı (ms). null = ölçülmedi. */
  fixAgeMs:         number | null;
  /** Son health heartbeat'inin yaşı (ms). null = ölçülmedi. */
  heartbeatAgeMs:   number | null;
  /** Heartbeat alarm eşiği (ms) — HealthMonitor kaydından gelir. */
  heartbeatDeadlineMs: number;
  /** Fix'in "taze" sayıldığı pencere (ms). */
  fixFreshWindowMs: number;
  /** Uygulama şu an arka planda mı (document.hidden vb.). null = bilinmiyor. */
  backgrounded:     boolean | null;
  /** Bir önceki sınıf — RECOVERED ancak bayatlıktan SONRA üretilir. */
  previous?:        GpsHealthClass;
}

export interface GpsHealthVerdict {
  cls: GpsHealthClass;
  /** İnsan-okur tek cümle; teknik kod içermez. */
  reason: string;
  /** Çelişki varsa iki tarafın yaşları — kanıt kaybolmasın. */
  evidence: { fixAgeMs: number | null; heartbeatAgeMs: number | null };
}

const STALE_CLASSES: ReadonlySet<GpsHealthClass> = new Set<GpsHealthClass>([
  'GPS_FIX_STALE', 'GPS_HEARTBEAT_STALE', 'GPS_PROVIDER_DISCONNECTED',
  'GPS_BACKGROUND_SUSPENDED', 'GPS_HEALTH_CONFLICT',
]);

/** İki otoriteyi tek sınıfa indirger. SAF: I/O yok, zaman okumaz. */
export function reconcileGpsHealth(input: GpsHealthInput): GpsHealthVerdict {
  const { connected, fixAgeMs, heartbeatAgeMs, heartbeatDeadlineMs,
          fixFreshWindowMs, backgrounded, previous } = input;
  const evidence = { fixAgeMs, heartbeatAgeMs };

  // Sağlayıcı KESİN bağlı değilse başka hiçbir yorum yapılmaz.
  if (connected === false) {
    return { cls: 'GPS_PROVIDER_DISCONNECTED', reason: 'Konum sağlayıcısı bağlı değil.', evidence };
  }

  const fixKnown = typeof fixAgeMs === 'number' && Number.isFinite(fixAgeMs) && fixAgeMs >= 0;
  const hbKnown  = typeof heartbeatAgeMs === 'number' && Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs >= 0;

  // Hiçbir yaş ölçülemediyse UNKNOWN — "sağlıklı" DEMEYİZ.
  if (!fixKnown && !hbKnown) {
    return { cls: 'GPS_UNKNOWN', reason: 'Ne fix yaşı ne heartbeat yaşı ölçülebildi.', evidence };
  }

  const fixFresh = fixKnown && (fixAgeMs as number) <= fixFreshWindowMs;
  const hbFresh  = hbKnown  && (heartbeatAgeMs as number) <= heartbeatDeadlineMs;

  // İkisi de taze → sağlıklı. Öncesinde bayatlık varsa RECOVERED.
  if (fixFresh && hbFresh) {
    const wasStale = previous !== undefined && STALE_CLASSES.has(previous);
    return wasStale
      ? { cls: 'GPS_RECOVERED', reason: 'Taze fix ve heartbeat birlikte geri geldi.', evidence }
      : { cls: 'GPS_UNKNOWN', reason: 'Sağlıklı — sınıflandırma yalnız bayatlık/çelişki için üretilir.', evidence };
  }

  // Arka plan: OS callback'leri askıya alır. Bu SİNYAL KAYBI DEĞİLDİR.
  if (backgrounded === true) {
    return { cls: 'GPS_BACKGROUND_SUSPENDED', reason: 'Uygulama arka planda; konum callback\'leri askıda.', evidence };
  }

  /* ÇELİŞKİ: fix defteri TAZE ama heartbeat bayat (veya tersi). Gerçek sürüş
     kaydındaki durum tam budur — `dataFresh=true` + "No heartbeat for 20s".
     Doğrudan KAYIP üretmek YASAK: ölçüm zinciri tutarsız, konum değil. */
  if (fixKnown && hbKnown && fixFresh !== hbFresh) {
    return {
      cls: 'GPS_HEALTH_CONFLICT',
      reason: fixFresh
        ? 'Fix taze ama sağlık kalp atışı bayat — izleme zinciri tutarsız.'
        : 'Kalp atışı taze ama fix bayat — konum defteri tutarsız.',
      evidence,
    };
  }

  // Tek taraf ölçülebiliyor ve bayat.
  if (fixKnown && !fixFresh) {
    return { cls: 'GPS_FIX_STALE', reason: 'Yeni geçerli konum gelmiyor.', evidence };
  }
  return { cls: 'GPS_HEARTBEAT_STALE', reason: 'Sağlık kalp atışı bayat; fix tazeliği doğrulanamadı.', evidence };
}
