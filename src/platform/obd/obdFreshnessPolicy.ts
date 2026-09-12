/**
 * obdFreshnessPolicy — P0-OBD-02 · HER SİNYALİN KENDİ TAZELİK SÖZLEŞMESİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * `extendedPidService.getPidStatus(pid, staleMs = 15_000)` TÜM PID'lere AYNI
 * 15 saniyeyi uyguluyordu. Oysa iki yol tamamen farklı kadansta akar:
 *
 *   · ÇEKİRDEK (0x05·0x0B·0x0C·0x0D·0x0F·0x11·0x2F) her FAST turda okunur
 *     (250–1000 ms; zayıf modda 15 s'ye kadar).
 *   · GENİŞLETİLMİŞ round-robin turda **EN FAZLA 1 PID** okur. 16 PID izleniyorsa
 *     bir PID'in SAĞLIKLI yaşı ≈ tur × 16'dır → 1 s'lik turda **~16 s**,
 *     POWER_SAVE'de (15 s tur) **~240 s**.
 *
 * Sonuç: sabit 15 s, mükemmel çalışan yavaş bir PID'i "bayat" ilan ediyordu
 * (SAHTE ALARM) ve aynı anda hızlı bir sinyalin 14 saniyelik gecikmesini
 * "canlı" sayıyordu (SESSİZ YALAN). İki hata da tek sabitten doğuyordu.
 *
 * ── ÇÖZÜM: SINIF + GERÇEK KADANS ──────────────────────────────────────────
 * Eşik iki girdiden türer:
 *   1. Sinyalin KARARININ gerektirdiği tazelik sınıfı (`ObdFreshnessClass`),
 *   2. O sinyalin GERÇEK okuma kadansı (çekirdek pencere ya da rotasyon süresi).
 * Eşik ikisinin BÜYÜĞÜDÜR — yani politika ne fiziksel gerçeği (kadans) ne de
 * kararın ihtiyacını (sınıf) yok sayar.
 *
 * ── İKİ AŞAMA: LIVE → STALE → UNAVAILABLE ─────────────────────────────────
 * Tek eşik yetmez. "Bayat" ile "yok" AYNI ŞEY DEĞİLDİR:
 *   · STALE       → ölçüm GERÇEKTİ ama artık güvenilmez. Değer GÖSTERİLİR
 *                   (bayat etiketiyle), KARARA GİRMEZ.
 *   · UNAVAILABLE → ölçüm o kadar eski ki artık bu aracın durumu hakkında hiçbir
 *                   şey söylemiyor. Değer DÜŞÜRÜLÜR.
 * İkisini birleştirmek, ya donmuş bir sayıyı canlı göstermek (tehlikeli) ya da
 * 3 saniyelik bir boşlukta ekranı boşaltmak (gürültü) olurdu.
 *
 * SAHTE 0 ÜRETİLMEZ: hiçbir durumda "veri yok" bir sayıya çevrilmez.
 */

/**
 * Bir sinyalin KARARININ gerektirdiği tazelik sınıfı.
 *
 * DİKKAT: sınıf, sinyalin ne kadar HIZLI DEĞİŞTİĞİNİ değil, kararın onu ne kadar
 * TAZE İSTEDİĞİNİ söyler. `engineRunTime` her saniye artar ama bakım sayacı için
 * 10 dakikalık bir değer hâlâ kullanışlıdır → `archival`.
 */
export type ObdFreshnessClass =
  | 'hot'      // sürüş anına ait karar (gaz kelebeği · yük · tork)
  | 'medium'   // motor sağlığı (sıcaklıklar · voltaj · trim)
  | 'slow'     // bağlam ve durum (ortam ısısı · baro · MIL · uzun trim)
  | 'archival'; // sayaç/mesafe (bakım · muayene · ikinci el kontrolü)

/** Ölçümün karar açısından durumu. `LIVE`, oturum denetçisinin `OBSERVED`'ına karşılıktır. */
export type ObdFreshnessState = 'LIVE' | 'STALE' | 'UNAVAILABLE';

/**
 * Sınıf tabanı (ms) — kadans bundan hızlı olsa bile eşik buranın ALTINA İNMEZ.
 *
 * NEDEN TABAN VAR: kadans tek başına eşik olamaz. ELM327 3 Hz okusa bile bir
 * sinyali 300 ms'de "bayat" ilan etmek, tek bir kayıp Bluetooth paketinde ekranı
 * yakıp söndürürdü (kütük: "1-2 sn'lik bağlı/kopuk dalgalanması" kök nedeni aynı
 * sınıf hataydı).
 */
export const FRESHNESS_FLOOR_MS: Readonly<Record<ObdFreshnessClass, number>> = {
  hot:       10_000,
  medium:    30_000,
  slow:     120_000,
  archival: 600_000,
};

/**
 * Genişletilmiş rotasyonda kaç TAM TUR kaçırılmasına izin verilir.
 *
 * 2: bir PID sırası geldiğinde ECU yanıt vermeyebilir (NO_DATA → native o turda
 * atlar). Tek kaçırılan rotasyon "bayat" DEMEK DEĞİLDİR; iki tam tur sessizse
 * gerçekten bir sorun vardır. (`obdRetryPolicy.STALE_MISSED_POLLS` ile aynı fikir,
 * farklı eksen: orada TUR, burada ROTASYON sayılır.)
 */
export const EXT_ROTATION_TOLERANCE = 2;

/**
 * STALE → UNAVAILABLE çarpanı.
 *
 * 3: bayat pencerenin üç katı boyunca hiç ölçüm gelmediyse değer artık aracın
 * GÜNCEL durumu hakkında bilgi taşımaz. Değeri sonsuza dek "bayat" olarak
 * tutmak, ekranda donmuş bir sayının kalması demekti (saha kusuru #607 deseni:
 * OBD 10:27'de koptu, yakıt yüzdesi akşama kadar ekranda durdu).
 */
export const STALE_TO_UNAVAILABLE_FACTOR = 3;

/** Kadans bilinmiyorsa kullanılan güvenli varsayım (ms) — `computeObdPollProfile` tabanı. */
export const FALLBACK_CADENCE_MS = 3_000;

/** Bir sinyalin tazelik eşiklerinin GİRDİSİ. */
export interface FreshnessWindowInput {
  /** Sinyalin tazelik sınıfı. */
  readonly cls: ObdFreshnessClass;
  /** Okuma yolu — rotasyon çarpanı yalnız `extended`'e uygulanır. */
  readonly path: 'core' | 'extended';
  /**
   * ÇEKİRDEK yol için: `obdService.getObdFreshWindowMs()` (protokol tabanı + aktif
   * poll kadansından türeyen uyarlanabilir pencere). Geçersizse taban kullanılır.
   */
  readonly coreWindowMs?: number;
  /** GENİŞLETİLMİŞ yol için: aktif native FAST tur periyodu (ms). */
  readonly cadenceMs?: number;
  /** GENİŞLETİLMİŞ yol için: tele giden PID adedi (round-robin tur uzunluğu). */
  readonly watchedCount?: number;
}

export interface FreshnessWindow {
  /** Bu yaşa kadar `LIVE`. */
  readonly staleMs: number;
  /** Bu yaşa kadar `STALE`; sonrası `UNAVAILABLE`. */
  readonly unavailableMs: number;
}

function _pos(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Bir sinyalin tazelik pencerelerini hesaplar.
 *
 * ÇEKİRDEK: eşik = max(sınıf tabanı, uyarlanabilir çekirdek pencere).
 *   Çekirdek sinyaller ECU susunca `dataFresh=false` ile zaten düşer; buradaki
 *   pencere o kapının AYNISINI kullanır → iki otorite üretilmez.
 *
 * GENİŞLETİLMİŞ: eşik = max(sınıf tabanı, tur × izlenen PID × rotasyon toleransı).
 *   Formül SAĞLIKLI en kötü durumu modeller: bir PID'in sırası rotasyon başına
 *   BİR KEZ gelir.
 */
export function computeFreshnessWindow(i: FreshnessWindowInput): FreshnessWindow {
  const floor = FRESHNESS_FLOOR_MS[i.cls] ?? FRESHNESS_FLOOR_MS.medium;

  let staleMs: number;
  if (i.path === 'core') {
    staleMs = Math.max(floor, _pos(i.coreWindowMs, 0));
  } else {
    const cadence = _pos(i.cadenceMs, FALLBACK_CADENCE_MS);
    // İzleyici sayısı 0/bilinmiyor → en az 1 tur (0 ile çarpıp eşiği yok etmeyelim).
    const rotation = cadence * Math.max(1, _pos(i.watchedCount, 1)) * EXT_ROTATION_TOLERANCE;
    staleMs = Math.max(floor, rotation);
  }

  return {
    staleMs,
    unavailableMs: staleMs * STALE_TO_UNAVAILABLE_FACTOR,
  };
}

/** Tek bir ölçümün tazelik değerlendirmesinin GİRDİSİ. */
export interface FreshnessInput {
  /** Ölçüm var mı. `false` → koşulsuz `UNAVAILABLE` (sahte değer türetilmez). */
  readonly hasValue: boolean;
  /** Ölçümün alındığı an (Unix ms). `null`/0 → hiç ölçülmedi. */
  readonly measuredAtMs: number | null;
  /** Çağıranın damgası (Unix ms) — bu modül `Date.now()` ÇAĞIRMAZ. */
  readonly nowMs: number;
  /** Pencereler (bkz. `computeFreshnessWindow`). */
  readonly window: FreshnessWindow;
  /**
   * Ölçümün ALINDIĞI OBD oturumunun numarası ve ŞU ANKİ oturum numarası.
   *
   * Eşit değillerse ölçüm **başka bir bağlantıya** aittir → yaşına bakılmaksızın
   * `UNAVAILABLE`. Bu, "reconnect sonrası eski önbellek canlı sayılmasın" kuralının
   * TEK uygulama noktasıdır: adaptör başka bir araca takılmış olabilir ve 2 saniye
   * önce ölçülmüş bir yağ sıcaklığı O ARACA ait olmayabilir.
   * `null` verilirse oturum denetimi UYGULANMAZ (çağıran epoch bilmiyor).
   */
  readonly valueEpoch?: number | null;
  readonly currentEpoch?: number | null;
}

export interface FreshnessVerdict {
  readonly state: ObdFreshnessState;
  /** Ölçümün yaşı (ms); ölçüm yoksa `null` — sahte 0 YOK. */
  readonly ageMs: number | null;
  /** `UNAVAILABLE` ise NEDEN — gözlem yüzeyi bunu aynen gösterir. */
  readonly reason: 'ok' | 'no_measurement' | 'session_changed' | 'expired';
}

/**
 * Tek ölçümün karar durumu. FAIL-CLOSED: şüphede `UNAVAILABLE` döner.
 *
 * Gelecek damga (`measuredAtMs > nowMs`, saat sıçraması) yaşı NEGATİF yapardı ve
 * sonsuza dek "taze" görünürdü — yaş 0'a kırpılır, ama bu bir ÖLÇÜM DEĞİL kırpma
 * olduğu için değer yine de değerlendirilir (saat sıçraması ölçümü geçersiz kılmaz).
 */
export function classifyFreshness(i: FreshnessInput): FreshnessVerdict {
  if (!i.hasValue || i.measuredAtMs === null || !Number.isFinite(i.measuredAtMs) || i.measuredAtMs <= 0) {
    return { state: 'UNAVAILABLE', ageMs: null, reason: 'no_measurement' };
  }

  // Oturum kapısı — yaştan ÖNCE: 1 sn önce ölçülmüş olması onu bu oturuma ait yapmaz.
  if (
    typeof i.valueEpoch === 'number' && typeof i.currentEpoch === 'number' &&
    i.valueEpoch !== i.currentEpoch
  ) {
    return { state: 'UNAVAILABLE', ageMs: null, reason: 'session_changed' };
  }

  const ageMs = Math.max(0, i.nowMs - i.measuredAtMs);
  if (ageMs <= i.window.staleMs)       return { state: 'LIVE',        ageMs, reason: 'ok' };
  if (ageMs <= i.window.unavailableMs) return { state: 'STALE',       ageMs, reason: 'ok' };
  return { state: 'UNAVAILABLE', ageMs, reason: 'expired' };
}
