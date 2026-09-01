/**
 * carosLabRefreshModel — CAROS LAB "TÜMÜNÜ YENİLE" SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ (repo A3–A8 deseni): I/O YOK · timer YOK · `Date.now()` YOK ·
 * global durum YOK · React importu YOK. Yalnız tip · etiket · sınıflandırma ·
 * biçimlendirme. Zaman gereken her yerde `nowMs` PARAMETRE olarak gelir.
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * LAB deseni "açılışta tek okuma + elle YENİLE"dir. Bu desen doğru ama sahada
 * pahalı: bir tur ölçüm için geliştirici 5-9 ekranı tek tek açıp her birinde
 * YENİLE'ye basmak zorundaydı. Üstelik iki kanıt önbelleğini (native poll sayacı
 * #523, eleme #524) YALNIZ ilgili ekran açıldığında dolduğu için "TÜMÜNÜ KOPYALA"
 * çıktısı sık sık BAYAT kanıtla alınıyordu (#505 uyarısı bunu söylüyordu ama
 * çözmüyordu).
 *
 * ── SINIR (PAZARLIKSIZ) ────────────────────────────────────────────────────
 * Bu katman YALNIZ MEVCUT OKUMA çağrılarını topluca tetikler. Bağlantı kurmaz,
 * yeniden bağlanmaz, araca komut göndermez, poll/handshake/Deep Scan başlatmaz.
 * "TAZE bağlantı kur" ve H-A gibi araca dokunan ekranlar KAPSAM DIŞIDIR ve
 * bilinçli kullanıcı eylemi olarak kalır.
 */

/* ── Durum sözleşmesi ────────────────────────────────────────────────────── */

/**
 * Bir bölümün yenileme sonucu.
 *
 * `UNAVAILABLE` ile `FAILED` BİLEREK ayrıdır: birincisi "kaynak yok/kanıt yok"
 * (web modu, eski APK, henüz veri üretilmemiş), ikincisi "okuma patladı".
 * İkisini tek kovaya atmak LAB'ın "boş ≠ veri yoktu" ilkesini bozar.
 */
export type CarosLabRefreshStatus =
  /** Hiç çalıştırılmadı — hüküm YOK. */
  | 'PENDING'
  /** Şu an çalışıyor. */
  | 'RUNNING'
  /** Tazelendi ve okunabilir kanıt döndü. */
  | 'REFRESHED'
  /** Okundu ama kaynak/kanıt YOK (sahte 0 üretilmez). */
  | 'UNAVAILABLE'
  /** Okuma hata fırlattı — sessizce atlanmaz. */
  | 'FAILED'
  /** Süre aşımı — asılı kalan çağrı turu kilitlemesin diye kesildi. */
  | 'TIMEOUT';

export const CAROS_LAB_REFRESH_STATUS_LABEL: Readonly<Record<CarosLabRefreshStatus, string>> = {
  PENDING:     'BEKLİYOR',
  RUNNING:     'OKUNUYOR…',
  REFRESHED:   'TAZELENDİ',
  UNAVAILABLE: 'KAYNAK YOK',
  FAILED:      'OKUNAMADI',
  TIMEOUT:     'ZAMAN AŞIMI',
} as const;

/** Rozet tonu — ekran bunu OEM token'ına çevirir (model renk BİLMEZ). */
export type CarosLabRefreshTone = 'ok' | 'muted' | 'warn' | 'bad';

export function refreshStatusTone(s: CarosLabRefreshStatus): CarosLabRefreshTone {
  switch (s) {
    case 'REFRESHED':   return 'ok';
    case 'UNAVAILABLE': return 'muted';
    case 'PENDING':     return 'muted';
    case 'RUNNING':     return 'muted';
    case 'TIMEOUT':     return 'warn';
    case 'FAILED':      return 'bad';
  }
}

/* ── Bölüm kataloğu ──────────────────────────────────────────────────────── */

export type CarosLabRefreshSectionId =
  | 'native-poll-evidence'
  | 'native-elimination'
  | 'poll-cost'
  | 'kwp-recovery'
  | 'poll-scheduler'
  | 'location-engine'
  | 'fix-age-ledger'
  | 'navigation-core'
  | 'eta-jump-ledger'
  | 'address-search';

export interface CarosLabRefreshSectionMeta {
  readonly id: CarosLabRefreshSectionId;
  /** Ekranda görünen Türkçe ad. */
  readonly label: string;
  /** Bu bölümün hangi LAB ekranına karşılık geldiği (izlenebilirlik). */
  readonly screen: string;
  /**
   * `true` = native eklenti çağrısı yapılır (SALT SAYAÇ okuması; araca komut
   * GİTMEZ). `false` = yalnız JS tarafı senkron getter okunur.
   */
  readonly nativePull: boolean;
}

/**
 * Yenilenecek bölümler — SIRA ÖNEMLİDİR: native sayaç okumaları ÖNCE gelir,
 * onları OKUYAN türetilmiş anlık görüntüler SONRA. Ters sırada "poll zamanlayıcı"
 * bir önceki turun önbelleğini okur ve bir tur geriden gelir.
 */
export const CAROS_LAB_REFRESH_SECTIONS: readonly CarosLabRefreshSectionMeta[] = [
  { id: 'native-poll-evidence', label: 'Native poll sayacı (extended)', screen: 'Runtime Scheduling', nativePull: true },
  { id: 'native-elimination',   label: 'Extended PID eleme sayacı',     screen: 'Runtime Scheduling', nativePull: true },
  /* B3: hat maliyeti — SALT SAYAÇ okuması, araca hiçbir komut GİTMEZ. */
  { id: 'poll-cost',            label: 'Poll maliyeti (PID + AT)',      screen: 'Runtime Scheduling', nativePull: true },
  { id: 'kwp-recovery',         label: 'KWP kurtarma sayacı',           screen: 'KWP İzleyici',       nativePull: true },
  { id: 'poll-scheduler',       label: 'Poll zamanlayıcı / kanallar',   screen: 'Poll Scheduler',     nativePull: false },
  { id: 'location-engine',      label: 'Konum motoru (hakem)',          screen: 'Location Engine',    nativePull: false },
  { id: 'fix-age-ledger',       label: 'GPS fix yaşı defteri',          screen: 'Uzun Yol Doğrulama', nativePull: false },
  { id: 'navigation-core',      label: 'Navigasyon çekirdeği',          screen: 'Navigation Core',    nativePull: false },
  { id: 'eta-jump-ledger',      label: 'ETA sıçrama defteri',           screen: 'Navigation Core',    nativePull: false },
  { id: 'address-search',       label: 'Adres arama kanıtı',            screen: 'Adres Arama Kanıtı', nativePull: false },
] as const;

/* ── Sonuç kayıtları ─────────────────────────────────────────────────────── */

/** Kaynak katmanının döndürdüğü ham sonuç (zaman damgası ÇALIŞTIRAN tarafından basılır). */
export interface CarosLabRefreshProbe {
  readonly status: Extract<CarosLabRefreshStatus, 'REFRESHED' | 'UNAVAILABLE' | 'FAILED'>;
  /**
   * Tek satırlık kanıt özeti — PII TAŞIMAZ (koordinat, adres metni, hedef adı,
   * VIN yok; yalnız adet · sınıf · süre). Boş bırakılmaz.
   */
  readonly detail: string;
}

export interface CarosLabRefreshResult {
  readonly id: CarosLabRefreshSectionId;
  readonly status: CarosLabRefreshStatus;
  readonly detail: string;
  /** Bu bölümün en son BAŞARIYLA tazelendiği an (ms) — `null` = hiç. */
  readonly okAtMs: number | null;
  /** Bu bölümün en son DENENDİĞİ an (ms) — `null` = hiç. */
  readonly attemptedAtMs: number | null;
  /** Son denemenin süresi (ms) — `null` = hiç denenmedi. */
  readonly durationMs: number | null;
}

export type CarosLabRefreshTrigger = 'manual' | 'auto';

export interface CarosLabRefreshRun {
  readonly running: boolean;
  readonly trigger: CarosLabRefreshTrigger | null;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
  /** Tamamlanan tur sayısı — otomatik yenilemenin ilerlediğinin kanıtı. */
  readonly cycle: number;
  readonly results: readonly CarosLabRefreshResult[];
}

/** Hiç çalışmamış başlangıç durumu — her bölüm BEKLİYOR. */
export function initialRefreshRun(): CarosLabRefreshRun {
  return {
    running: false,
    trigger: null,
    startedAtMs: null,
    finishedAtMs: null,
    cycle: 0,
    results: CAROS_LAB_REFRESH_SECTIONS.map((s) => ({
      id: s.id,
      status: 'PENDING' as CarosLabRefreshStatus,
      detail: 'Bu oturumda hiç tazelenmedi.',
      okAtMs: null,
      attemptedAtMs: null,
      durationMs: null,
    })),
  };
}

/* ── Özet ────────────────────────────────────────────────────────────────── */

export type CarosLabRefreshVerdict =
  | 'NEVER_RUN'
  | 'RUNNING'
  /** Tüm bölümler tazelendi. */
  | 'ALL_REFRESHED'
  /** Bir kısmı tazelendi; kalanı kaynak yok / okunamadı. */
  | 'PARTIAL'
  /** Hiçbir bölüm tazelenemedi. */
  | 'NONE_REFRESHED';

export const CAROS_LAB_REFRESH_VERDICT_LABEL: Readonly<Record<CarosLabRefreshVerdict, string>> = {
  NEVER_RUN:      'HENÜZ ÇALIŞMADI',
  RUNNING:        'ÇALIŞIYOR',
  /* KAPSAM DÜRÜSTLÜĞÜ (2026-08-21 denetimi): eski etiket düz "TÜMÜ TAZELENDİ"ydi
     ve LAB'daki 47 ekranın tamamı hakkında hüküm gibi okunuyordu. Bu tur YALNIZ
     aşağıdaki bölümleri kapsar (bkz. CAROS_LAB_REFRESH_SECTIONS) — diğer ekranlar
     kendi "YENİLE" düğmeleriyle tazelenir. Etiket kapsamı ADIYLA söyler. */
  ALL_REFRESHED:  'KAPSAMIN TÜMÜ TAZELENDİ',
  PARTIAL:        'KISMİ — bazı bölümler okunamadı',
  NONE_REFRESHED: 'HİÇBİRİ TAZELENEMEDİ',
} as const;

/**
 * Bu turun kapsamı — ekranda AÇIKÇA yazılır.
 *
 * "Tümü" kelimesi bir gözlem yüzeyinde tehlikelidir: tazelenmemiş bir ekranın
 * bayat değeri, yeşil bir "tümü tazelendi" rozetinin altında TAZE sanılır.
 * Kapsam sayısı kaynağın kendisinden türetilir (elle yazılmaz → ayrışamaz).
 */
export const CAROS_LAB_REFRESH_SCOPE_NOTE =
  `KAPSAM: bu tur ${CAROS_LAB_REFRESH_SECTIONS.length} kanıt bölümünü tazeler — ` +
  'LAB\'daki diğer ekranlar bu turdan ETKİLENMEZ, kendi YENİLE düğmeleriyle okunur.';

export interface CarosLabRefreshSummary {
  readonly verdict: CarosLabRefreshVerdict;
  readonly refreshed: number;
  readonly unavailable: number;
  readonly failed: number;
  readonly total: number;
  /** Başarısız/kaynaksız bölümlerin id'leri — ekranda ADIYLA gösterilir. */
  readonly problemIds: readonly CarosLabRefreshSectionId[];
}

export function summarizeRefreshRun(run: CarosLabRefreshRun): CarosLabRefreshSummary {
  let refreshed = 0, unavailable = 0, failed = 0, pending = 0;
  const problemIds: CarosLabRefreshSectionId[] = [];

  for (const r of run.results) {
    switch (r.status) {
      case 'REFRESHED':   refreshed += 1; break;
      case 'UNAVAILABLE': unavailable += 1; problemIds.push(r.id); break;
      case 'FAILED':
      case 'TIMEOUT':     failed += 1; problemIds.push(r.id); break;
      default:            pending += 1; break;
    }
  }

  const total = run.results.length;
  let verdict: CarosLabRefreshVerdict;
  if (run.running) verdict = 'RUNNING';
  else if (run.cycle === 0 || pending === total) verdict = 'NEVER_RUN';
  else if (refreshed === total) verdict = 'ALL_REFRESHED';
  else if (refreshed === 0) verdict = 'NONE_REFRESHED';
  else verdict = 'PARTIAL';

  return { verdict, refreshed, unavailable, failed, total, problemIds };
}

/* ── Biçimlendirme ───────────────────────────────────────────────────────── */

/** Yaş metni — MUTLAK zaman damgası sızdırmaz. `null` → "hiç". */
export function formatRefreshAge(atMs: number | null, nowMs: number): string {
  if (atMs === null || !Number.isFinite(atMs)) return 'hiç';
  const d = Math.max(0, nowMs - atMs);
  if (d < 1_000) return `${Math.round(d)} ms önce`;
  if (d < 60_000) return `${(d / 1_000).toFixed(1)} sn önce`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} dk önce`;
  return `${Math.floor(d / 3_600_000)} sa önce`;
}

/* ── Otomatik yenileme bütçesi ───────────────────────────────────────────── */

export type RefreshDeviceTier = 'low' | 'mid' | 'high';

/**
 * Otomatik yenileme aralığı — PERFORMANS-UYARLANABİLİR HİBRİT kuralı.
 *
 * Tur başına maliyet: en çok 3 salt-sayaç native çağrısı + birkaç senkron getter.
 * Sıcak yola (3 Hz hız/RPM) GİRMEZ ve YALNIZ LAB açıkken çalışır — LAB kapalıyken
 * maliyet SIFIRDIR. Düşük uçta (Mali-400 / K24) aralık iki katına yaklaşır.
 */
export function pickAutoRefreshIntervalMs(tier: RefreshDeviceTier): number {
  switch (tier) {
    case 'low':  return 90_000;
    case 'mid':  return 60_000;
    case 'high': return 45_000;
  }
}
