/**
 * obdLiveModel — OBD CANLI VERİLERİ sayfasının SAF KARAR MODELİ.
 *
 * ── NEDEN AYRI VE SAF ─────────────────────────────────────────────────────
 * Bu sayfanın tek gerçek riski YALAN SÖYLEMEKTİR: ölçülmemiş bir alanı `0`
 * göstermek, araçta hiç bulunmayan bir sensörü "0 g/s" diye sunmak, 12 saat
 * önceki bir okumayı canlı sanmak ya da hiç taranmamış bir ECU için "arıza
 * yok" demek. Bu kararların hepsi burada, React/DOM dışında ve tek yerde
 * verilir ki test edilebilsin.
 *
 * SAF: I/O YOK · DOM YOK · timer YOK · React YOK · global durum YOK.
 *
 * ── KANONİK KAYNAKTAKİ İŞARETLER ──────────────────────────────────────────
 * `OBDData` zaten üç ayrı gerçeği kodlar; bu modül onları UI diline çevirir:
 *   `undefined` → alan HİÇ okunmadı
 *   `-1`        → araç bu PID'i DESTEKLEMİYOR
 *   sayı        → gerçek ölçüm (0 dahil — duran araçta hız GERÇEKTEN 0'dır)
 * Ayrıca `transportConnected` (link) ile `dataFresh` (tazelik) AYRIDIR:
 * ECU'nun susması bağlantının koptuğu anlamına gelmez.
 */

/** Tek bir ölçümün dürüst durumu. */
export type ReadingState =
  /** Taze, gerçek ECU ölçümü. */
  | 'live'
  /** Değer var ama BAYAT — canlı gibi gösterilmez. */
  | 'stale'
  /** Araç bu PID'i desteklemiyor (`-1`). */
  | 'unsupported'
  /** Henüz hiç okunmadı (`undefined`, keşif sürüyor, ya da link veri getirmedi). */
  | 'unread'
  /**
   * Destek bitmask'i PID'i destekli gösteriyor ama ECU DEĞER VERMİYOR.
   * "Araçta yok"tan farklıdır ve kullanıcıya ayrı söylenir
   * (`extendedPidService.getPidStatus` → `no_data`).
   */
  | 'no_data'
  /** OBD bağlı değil — ölçüm GÖSTERİLMEZ. */
  | 'offline';

export interface Reading {
  readonly state: ReadingState;
  /** Yalnız `live` ve `stale` durumlarında sayıdır; aksi hâlde `null`. */
  readonly value: number | null;
}

/** Sayfanın üst düzey bağlantı/tazelik durumu. */
export type LinkState =
  /** Aktarım yok — adaptör takılı değil ya da bağlanmadı. */
  | 'offline'
  /** Aktarım var ama ECU'dan henüz TEK bir geçerli frame gelmedi. */
  | 'waiting'
  /** Veri var ama taze değil. */
  | 'stale'
  /** Taze ECU verisi akıyor. */
  | 'live';

export interface LinkInput {
  /** `OBDData.transportConnected` — RFCOMM/GATT/TCP linki doğrulanmış mı. */
  readonly transportConnected: boolean;
  /** `OBDData.dataFresh` — son ECU verisi taze mi. */
  readonly dataFresh: boolean;
  /** `OBDData.lastSeenMs` — son GEÇERLİ ECU frame'i (0 = hiç). */
  readonly lastSeenMs: number;
  /** `OBDData.source` — `'real' | 'mock' | 'none'`. */
  readonly source: string;
}

/**
 * Link durumu.
 *
 * FAIL-CLOSED: `source` gerçek değilse (mock/none) sayfa CANLI diyemez.
 * Kurtarılmış/önbellekli bir anlık görüntü `dataFresh` ile elenir — bu,
 * sahada ölçülmüş bir kusurun (eski yakıt seviyesini canlı sanmak)
 * düzeltmesidir ve `isObdReadingLive` ile AYNI hükümdür.
 */
export function deriveLinkState(i: LinkInput): LinkState {
  if (!i.transportConnected) return 'offline';
  if (i.source !== 'real') return 'waiting';     // mock/none asla canlı sayılmaz
  if (i.lastSeenMs <= 0) return 'waiting';       // link var, ECU hiç konuşmadı
  return i.dataFresh ? 'live' : 'stale';
}

/**
 * Tek bir sayısal alanı dürüst duruma çevirir.
 *
 * `raw` sözleşmesi `OBDData` ile AYNIDIR: `undefined` = okunmadı,
 * `-1` = desteklenmiyor, diğer her sayı gerçek ölçüm.
 *
 * SIFIR ASLA UYDURULMAZ: `null` döndüğümüz her durumda ekran sayı DEĞİL,
 * durum gösterir.
 */
export function readField(raw: number | undefined | null, link: LinkState): Reading {
  if (link === 'offline') return { state: 'offline', value: null };
  if (raw === undefined || raw === null) return { state: 'unread', value: null };
  if (!Number.isFinite(raw)) return { state: 'unread', value: null };
  if (raw === -1) return { state: 'unsupported', value: null };
  if (link === 'waiting') return { state: 'unread', value: null };
  return { state: link === 'live' ? 'live' : 'stale', value: raw };
}

/**
 * `speed` gibi `-1` nöbetçisi OLMAYAN alanlar için.
 *
 * `OBDData.speed` başlangıçta `0`dır; bu 0 bir ÖLÇÜM DEĞİLDİR. Link henüz
 * veri getirmediyse sayı gösterilmez — duran araçtaki gerçek `0` ile
 * "hiç okunmadı" birbirinden ancak böyle ayrılır.
 */
export function readMeasured(raw: number | undefined | null, link: LinkState): Reading {
  if (link === 'offline') return { state: 'offline', value: null };
  if (link === 'waiting') return { state: 'unread', value: null };
  if (raw === undefined || raw === null || !Number.isFinite(raw)) {
    return { state: 'unread', value: null };
  }
  return { state: link === 'live' ? 'live' : 'stale', value: raw };
}

/** Arıza kodu defterinin dürüst durumu. */
export type DtcState =
  /** Bu oturumda HİÇ tarama yapılmadı — "arıza yok" DENEMEZ. */
  | 'unscanned'
  /** Tarama yapıldı ve kod bulunmadı. */
  | 'clean'
  /** Tarama yapıldı, kod var. */
  | 'faults'
  /** Bağlantı yok — okunamaz. */
  | 'offline';

export interface DtcInput {
  readonly scanRan: boolean;
  readonly count: number;
  readonly link: LinkState;
}

/**
 * TARAMA YAPILMADAN "0 ARIZA" DENMEZ.
 *
 * `count === 0` tek başına temiz demek değildir: hiç okunmamış bir ECU de
 * sıfır kod bildirir. Ayrım `scanRan` ile yapılır.
 */
export function deriveDtcState(i: DtcInput): DtcState {
  if (i.link === 'offline') return 'offline';
  if (!i.scanRan) return 'unscanned';
  return i.count > 0 ? 'faults' : 'clean';
}

/**
 * Genişletilmiş PID kanalının durumunu sayfanın diline çevirir.
 *
 * `extendedPidService` beş durumu ZATEN ayırıyor; burada yalnız eşleme
 * yapılır — yeni bir tazelik/kapasite otoritesi KURULMAZ.
 */
export function fromExtendedStatus(
  status: 'live' | 'stale' | 'no_data' | 'unsupported' | 'probing',
  value: number | undefined,
  link: LinkState,
): Reading {
  if (link === 'offline') return { state: 'offline', value: null };
  if (status === 'unsupported') return { state: 'unsupported', value: null };
  if (status === 'no_data')     return { state: 'no_data', value: null };
  if (status === 'probing')     return { state: 'unread', value: null };
  if (value === undefined || !Number.isFinite(value)) return { state: 'unread', value: null };
  return { state: status === 'live' ? 'live' : 'stale', value };
}

/** Ölçüm gerçekten bir sayı gösterebiliyor mu? */
export function hasNumber(r: Reading): boolean {
  return r.value !== null && (r.state === 'live' || r.state === 'stale');
}

/**
 * Bir ölçümün 0–1 aralığındaki dolgu oranı (çubuk/ark için).
 * Sayı yoksa `null` — boş ray çizilir, YALANCI dolgu değil.
 */
export function fillRatio(r: Reading, min: number, max: number): number | null {
  if (!hasNumber(r) || max <= min) return null;
  const t = (r.value! - min) / (max - min);
  return Math.max(0, Math.min(1, t));
}

/**
 * Sayfanın veri kalitesi özeti.
 *
 * "7/9" tek başına ne anlama geldiğini söylemez: eksik 2 ölçüm araçta HİÇ
 * YOK mu, yoksa henüz OKUNMADI mı? Kullanıcı için bu fark önemlidir, bu
 * yüzden döküm durum bazında verilir. SAHTE KALİTE SKORU ÜRETİLMEZ —
 * yalnız gerçek durumlar sayılır.
 */
export interface ReadCoverage {
  readonly readable: number;
  readonly total: number;
  readonly live: number;
  readonly stale: number;
  readonly unsupported: number;
  readonly unread: number;
}

export function coverage(readings: readonly Reading[]): ReadCoverage {
  let live = 0, stale = 0, unsupported = 0, unread = 0;
  for (const r of readings) {
    if (r.state === 'live') live++;
    else if (r.state === 'stale') stale++;
    /* "araçta yok" ile "ECU vermiyor" kalite özetinde birlikte sayılır;
       ayrım kartın kendi etiketinde görünür. */
    else if (r.state === 'unsupported' || r.state === 'no_data') unsupported++;
    else if (r.state === 'unread') unread++;
  }
  return { readable: live + stale, total: readings.length, live, stale, unsupported, unread };
}

/**
 * YAKIT SEVİYESİNİN KAYNAĞI.
 *
 * `OBDData.fuelLevel` ham PID 0x2F DEĞİLDİR: kullanıcı kalibrasyonu varsa
 * ham okuma bir ölçekle çarpılarak GÖSTERİM değerine çevrilir
 * (`obdService`: "`_current.fuelLevel` GÖSTERİM değeridir, ham değil").
 * Ekran bunu ham ECU okuması gibi sunmamalıdır.
 */
export type FuelProvenance =
  /** Ham 2F aynen gösteriliyor (ölçek = 1). */
  | 'ecu'
  /** Ham 2F kullanıcı kalibrasyonuyla ölçeklenmiş. */
  | 'ecu-calibrated'
  /** Ölçüm yok — kaynak iddiası da yok. */
  | 'none';

export function deriveFuelProvenance(i: {
  readonly reading: Reading;
  /** `getFuelCalibrationState().scale` — 1 = kalibrasyonsuz. */
  readonly scale: number;
}): FuelProvenance {
  if (!hasNumber(i.reading)) return 'none';
  if (!Number.isFinite(i.scale) || i.scale === 1) return 'ecu';
  return 'ecu-calibrated';
}
