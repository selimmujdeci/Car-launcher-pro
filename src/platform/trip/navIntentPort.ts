/**
 * navIntentPort — SEYAHAT OTURUMUNUN navigasyon niyetine SIFIR BAĞIMLILIKLI
 * okuma kapısı.
 *
 * ── NEDEN TERS BAĞIMLILIK ────────────────────────────────────────────────
 * Oturum katmanının `navigationService`i doğrudan import etmesi iki şeyi
 * birden bozardı:
 *   1. `tripSessionService` → `navigationService` kenarı, oturumu okuyan
 *      HER tüketicinin (Mavi bağlamı dâhil) modül grafiğine navigasyonun
 *      tamamını eklerdi — `tripSessionAccess` tam olarak bu yüzden vardır.
 *   2. Yapısal kilit: oturum katmanı rota mesafesini/ETA'sını okumamalıdır
 *      (ikinci mesafe sahibi doğmasın). Kapıyı dar tutmak bunu TİP
 *      düzeyinde garanti eder — buradan mesafe geçemez, yalnız NİYET geçer.
 *
 * Bu modülün ÇALIŞMA ZAMANI bağımlılığı YOKTUR. Okuyucuyu üretim
 * kompozisyon kökü (`useLayoutServices`) kaydeder; navigasyon bu dosyayı
 * bilmez, oturum katmanı da navigasyonu bilmez.
 *
 * FAIL-SOFT / FAIL-HONEST: kayıt yoksa niyet **YOK** sayılır (`routeActive:
 * false`). Kanıtsız bir "yolculuk" iddiası üretmektense sürüş günlüğüne
 * düşmek dürüsttür — CarOS kullanıcının niyetini UYDURMAZ.
 */

/** Navigasyondan okunan TEK şey — mesafe, ETA, rota ve hedef BURAYA GİRMEZ. */
export interface NavIntentReading {
  /** Navigasyon oturumu açık mı (`NavigationState.isNavigating`). */
  readonly routeActive: boolean;
  /**
   * Varış mührünün sırası (`getNavArrivalMark().seq`) — monotonik artar.
   * 0 = hiç varış gözlenmedi.
   */
  readonly arrivalSeq: number;
}

type Reader = () => NavIntentReading;

const NO_INTENT: NavIntentReading = Object.freeze({ routeActive: false, arrivalSeq: 0 });

let _read: Reader | null = null;

/**
 * Okuyucuyu kaydet — YALNIZ üretim kompozisyon kökü çağırır.
 * `null` kaydı sökmek içindir (servis durdurulduğunda bayat okuma kalmasın).
 */
export function registerNavIntentReader(fn: Reader | null): void {
  _read = typeof fn === 'function' ? fn : null;
}

/**
 * Niyeti oku — ASLA throw etmez. Kayıt yoksa ya da okuma düşerse niyet
 * yokluğu döner; sahte bir hedef ÜRETİLMEZ.
 */
export function readNavIntent(): NavIntentReading {
  if (_read === null) return NO_INTENT;
  try {
    const r = _read();
    if (!r || typeof r !== 'object') return NO_INTENT;
    const seq = typeof r.arrivalSeq === 'number' && Number.isFinite(r.arrivalSeq) && r.arrivalSeq > 0
      ? Math.floor(r.arrivalSeq)
      : 0;
    return { routeActive: r.routeActive === true, arrivalSeq: seq };
  } catch {
    return NO_INTENT;
  }
}
