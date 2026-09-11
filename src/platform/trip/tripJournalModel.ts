/**
 * tripJournalModel.ts — KANONİK SEYİR DEFTERİ MODELİ (SAF).
 *
 * ── NE DEĞİLDİR ───────────────────────────────────────────────────────
 * **İKİNCİ TRIP OTORİTESİ DEĞİLDİR.** Yolculuğun ne zaman başlayıp bittiği
 * bugün de yarın da `tripLogService`'in hükmüdür; hareket/rölanti süresi
 * `tripMetricsAccumulator`'ın, mola birleştirme `tripSessionModel`'indir.
 *
 * Bu modül İKİ İŞ yapar ve ikisi de bugün SAHİPSİZDİR:
 *
 *  1. **Seyir durumu projeksiyonu** — mevcut sahiplerin verdiği ham gerçeği
 *     kullanıcıya/Mavi'ye anlatılabilir tek bir duruma indirger
 *     (`PARKED · MOVING · STOPPED_IN_TRIP · TRIP_ENDING · COMPLETED ·
 *     UNKNOWN_DEGRADED`). Kendi başına hiçbir şey ÖLÇMEZ.
 *
 *  2. **Hareket kanıtı kapısı** — "konum bilmek" ile "hareket ediyor olmak"
 *     AYNI ŞEY DEĞİLDİR. Bugün `tripLogService` TEK bir GPS örneği 5 km/h'i
 *     aştığı anda yolculuk açıyor; park hâlindeki bir araçta tek bir bozuk
 *     fix (çok katlı otopark yansıması, soğuk başlangıç hız sıçraması)
 *     sahte yolculuk üretir. Bu kapı, başlangıcın BİRDEN ÇOK bağımsız örneğe
 *     dayanmasını şart koşar.
 *
 * Ayrıca ham kanıt (rota izi · duruşlar · konum) ile TÜRETİLMİŞ özeti
 * (`TripRecord`) ayıran kayıt biçimini tanımlar.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * 1. SEYİR DURUMU
 * ════════════════════════════════════════════════════════════════════════ */

export const TRIP_JOURNAL_STATES = [
  /** Aktif yolculuk YOK ve kanıt TAZE — araç duruyor. */
  'PARKED',
  /** Aktif yolculuk var, araç hareket hâlinde. */
  'MOVING',
  /** Aktif yolculuk var ama araç DURDU — trafik ışığı/mola. Trip KAPANMADI. */
  'STOPPED_IN_TRIP',
  /** Bitiş kanıtı birikiyor (duruş penceresi işliyor) — henüz KAPANMADI. */
  'TRIP_ENDING',
  /** Bu gözlemde `ACTIVE → COMPLETED` geçişi oldu (tek atış). */
  'COMPLETED',
  /** Kanıt yok ya da bayat — hüküm verilemez. */
  'UNKNOWN_DEGRADED',
] as const;
export type TripJournalState = (typeof TRIP_JOURNAL_STATES)[number];

/**
 * Kanıt bayatlık eşiği (ms).
 *
 * `tripLogService.TRIP_SILENCE_END_MS` (15 dk) yolculuğu KAPATAN eşiktir;
 * bu ise "artık hüküm veremem" eşiğidir ve bilinçli olarak çok daha kısadır:
 * 90 sn boyunca ne GPS ne OBD örneği geldiyse "hareket ediyor" da "duruyor"
 * da denemez. İkisi AYNI sayı OLMAMALIDIR — biri kapanış kararı, öteki
 * dürüstlük etiketidir.
 */
export const JOURNAL_EVIDENCE_STALE_MS = 90_000;

/** Seyir durumu türetmek için gereken TEK okuma anı. */
export interface TripJournalStateInput {
  /** Gözlem anı — monotonik. */
  readonly monoMs: number;
  /** `tripLogService` aktif yolculuk tutuyor mu. */
  readonly active: boolean;
  /** GPS **veya** OBD'den son örneğin geldiği monotonik an; hiç yoksa `null`. */
  readonly lastSampleMonoMs: number | null;
  /** İçinde bulunulan duruşun başlangıcı (accumulator); hareketteyse `null`. */
  readonly stopSinceMonoMs: number | null;
  /** Kapanış penceresi (idle timer) İŞLİYOR mu. */
  readonly endPending: boolean;
  /** Bu gözlemde yolculuk KAPANDI mı (tek atış). */
  readonly justCompleted: boolean;
}

/**
 * Seyir durumunu türet — SAF, fail-safe.
 *
 * SIRALAMA GEREKÇESİ: `COMPLETED` her şeyin önünde gelir çünkü kapanış
 * gözlemlenmiş bir OLAYDIR, yorum değildir. Ardından kapanış penceresi
 * (`TRIP_ENDING`) gelir: duruş da sürüyor olabilir ama kullanıcıya
 * anlatılması gereken şey yolculuğun bitmek üzere olduğudur.
 *
 * `UNKNOWN_DEGRADED` yalnız kanıt BAYATSA verilir ve **aktif yolculuğu
 * kapatmaz** — kanıt kaybı bir bitiş kanıtı DEĞİLDİR.
 */
export function deriveTripJournalState(input: TripJournalStateInput): TripJournalState {
  if (!input || !_finite(input.monoMs)) return 'UNKNOWN_DEGRADED';
  if (input.justCompleted) return 'COMPLETED';

  const stale = input.lastSampleMonoMs === null
    || !_finite(input.lastSampleMonoMs)
    || (input.monoMs - input.lastSampleMonoMs) >= JOURNAL_EVIDENCE_STALE_MS;

  if (input.active) {
    if (input.endPending) return 'TRIP_ENDING';
    /* Kanıt bayatken "hareket ediyor" DENEMEZ; ama duruş gözlenmişse o
       gözlem hâlâ geçerli bir olgudur (araç durdu, sonra veri kesildi). */
    if (stale) return input.stopSinceMonoMs !== null ? 'STOPPED_IN_TRIP' : 'UNKNOWN_DEGRADED';
    return input.stopSinceMonoMs !== null ? 'STOPPED_IN_TRIP' : 'MOVING';
  }

  /* Aktif yolculuk yok. Kanıt da yoksa "park hâlinde" bir VARSAYIMDIR —
     dürüstçe bilinmiyor denir (§8: uydurma `PARKED` üretilmez). */
  return stale ? 'UNKNOWN_DEGRADED' : 'PARKED';
}

/** Bu durumda bir yolculuk AÇIK mı (kullanıcıya "yoldayız" denebilir mi). */
export function isTripOpen(state: TripJournalState): boolean {
  return state === 'MOVING' || state === 'STOPPED_IN_TRIP' || state === 'TRIP_ENDING';
}

export function tripJournalStateLabel(state: TripJournalState): string {
  switch (state) {
    case 'PARKED':           return 'Park hâlinde';
    case 'MOVING':           return 'Yolda';
    case 'STOPPED_IN_TRIP':  return 'Duruşta';
    case 'TRIP_ENDING':      return 'Yolculuk bitiyor';
    case 'COMPLETED':        return 'Yolculuk tamamlandı';
    case 'UNKNOWN_DEGRADED': return 'Bilinmiyor';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. HAREKET KANITI KAPISI
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Yolculuk açmak için gereken ASGARİ bağımsız örnek sayısı.
 *
 * 1 olamaz: tek bir bozuk fix sahte yolculuk açar (ölçülen kusur).
 * 3+ gereksiz geciktirir: gerçek kalkışta ilk metreler kaybolur.
 */
export const MOTION_EVIDENCE_MIN_SAMPLES = 2;

/**
 * Kanıtın DAĞILMASI gereken asgari süre (ms).
 *
 * Aynı saniye içinde gelen iki örnek AYNI fiziksel anı anlatır ve bağımsız
 * kanıt sayılmaz. 1 sn, 1 Hz GPS akışında iki ardışık fix demektir.
 */
export const MOTION_EVIDENCE_MIN_SPAN_MS = 1_000;

/**
 * Kanıtın BAYATLADIĞI pencere (ms).
 *
 * Bu süreden uzun boşluktan sonra gelen örnek eskisiyle aynı hareketi
 * anlatmaz; sayaç sıfırlanır. Aksi halde sabah bir, akşam bir sıçrama
 * birleşip sahte yolculuk açardı.
 */
export const MOTION_EVIDENCE_WINDOW_MS = 20_000;

/** Biriken hareket kanıtı — `tripLogService` yolculuk açmadan ÖNCE tutar. */
export interface MotionEvidence {
  readonly count: number;
  /** İlk kanıtın anı — yolculuk başlangıcı BURADAN alınır (kapı geçildiği an DEĞİL). */
  readonly firstMonoMs: number | null;
  readonly lastMonoMs: number | null;
  /** Kanıtı üreten kaynak sayısı (GPS+OBD ikisi de gördüyse 2). */
  readonly sourceCount: number;
}

export const EMPTY_MOTION_EVIDENCE: MotionEvidence = Object.freeze({
  count: 0, firstMonoMs: null, lastMonoMs: null, sourceCount: 0,
});

export function emptyMotionEvidence(): MotionEvidence {
  return EMPTY_MOTION_EVIDENCE;
}

export interface MotionObservation {
  readonly monoMs: number;
  /** Ölçülen hız; bilinmiyorsa `null` (kanıt SAYILMAZ). */
  readonly speedKmh: number | null;
  readonly source: 'GPS' | 'OBD';
  /** Hareket eşiği (km/h) — `tripLogService.TRIP_START_SPEED_KMH`. */
  readonly thresholdKmh: number;
}

/**
 * Bir örneği kanıta işle.
 *
 * Eşiğin ALTINDAKİ örnek kanıtı **sıfırlar**: araç durduysa birikmiş kanıt
 * artık bir kalkışı anlatmaz. Ölçülemeyen örnek (`null` hız) ise kanıtı
 * ne artırır ne siler — bilinmeyen bir şey delil de değildir, delil aleyhine
 * de değildir.
 */
export function observeMotion(
  prev: MotionEvidence,
  obs: MotionObservation,
): MotionEvidence {
  const base = prev ?? EMPTY_MOTION_EVIDENCE;
  if (!obs || !_finite(obs.monoMs)) return base;
  if (obs.speedKmh === null || !_finite(obs.speedKmh)) return base;

  const threshold = _finite(obs.thresholdKmh) ? obs.thresholdKmh : 0;
  if (obs.speedKmh <= threshold) return EMPTY_MOTION_EVIDENCE;

  /* Pencere doldu → bu örnek YENİ bir kanıt zincirinin ilkidir. */
  const expired = base.lastMonoMs !== null
    && (obs.monoMs - base.lastMonoMs) > MOTION_EVIDENCE_WINDOW_MS;
  if (base.count === 0 || expired) {
    return { count: 1, firstMonoMs: obs.monoMs, lastMonoMs: obs.monoMs, sourceCount: 1 };
  }

  /* Zaman geriye gitti (monotonik olmayan kaynak) → örnek YOK SAYILIR. */
  if (base.lastMonoMs !== null && obs.monoMs < base.lastMonoMs) return base;

  return {
    count: base.count + 1,
    firstMonoMs: base.firstMonoMs,
    lastMonoMs: obs.monoMs,
    /* İki kaynak da gördüyse kanıt daha güçlüdür; tek kaynakta 1 kalır. */
    sourceCount: base.sourceCount >= 2 ? 2 : base.sourceCount,
  };
}

/**
 * Yolculuk açmaya YETECEK kanıt birikti mi.
 *
 * FAIL-CLOSED: kanıt eksikse `false` — "muhtemelen hareket ediyordur"
 * bir kanıt değildir.
 */
export function hasMotionEvidence(ev: MotionEvidence): boolean {
  if (!ev || ev.count < MOTION_EVIDENCE_MIN_SAMPLES) return false;
  if (ev.firstMonoMs === null || ev.lastMonoMs === null) return false;
  return (ev.lastMonoMs - ev.firstMonoMs) >= MOTION_EVIDENCE_MIN_SPAN_MS;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. BİTİŞ GEREKÇESİ
 * ════════════════════════════════════════════════════════════════════════ */

export const TRIP_END_REASONS = [
  /** Duruş penceresi doldu — GERÇEK bitiş kanıtı. */
  'IDLE_WINDOW',
  /** Ne GPS ne OBD; kanıt kaybedildi. Düzgün kapanış SAYILMAZ. */
  'DATA_SILENCE',
  /** Servis durduruldu (uygulama kapanışı) — bitiş GÖZLENMEDİ. */
  'SERVICE_STOPPED',
  /** Çok kısa/çok yakın — kayda değmedi, özet ÜRETİLMEDİ. */
  'DISCARDED_TOO_SHORT',
  'UNKNOWN',
] as const;
export type TripEndReason = (typeof TRIP_END_REASONS)[number];

/** Bu gerekçe GERÇEK bir bitiş kanıtına mı dayanıyor. */
export function isCleanEndReason(reason: TripEndReason): boolean {
  return reason === 'IDLE_WINDOW';
}

export function tripEndReasonLabel(reason: TripEndReason): string {
  switch (reason) {
    case 'IDLE_WINDOW':        return 'Duruş penceresi doldu';
    case 'DATA_SILENCE':       return 'Veri kesildi';
    case 'SERVICE_STOPPED':    return 'Uygulama kapandı';
    case 'DISCARDED_TOO_SHORT': return 'Çok kısa — kaydedilmedi';
    case 'UNKNOWN':            return 'Bilinmiyor';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. ROTA İZİ — SIKIŞTIRMA VE ADAPTİF ÖRNEKLEME
 * ════════════════════════════════════════════════════════════════════════ */

/** Tek rota noktası (ham kanıt — BULUTA GİTMEZ). */
export interface RoutePoint {
  readonly lat: number;
  readonly lon: number;
  /** Yolculuk başlangıcından itibaren ms (mutlak zaman DEĞİL). */
  readonly tOffsetMs: number;
  /** O andaki hız; bilinmiyorsa `null`. */
  readonly speedKmh: number | null;
}

/** Ardışık iki nokta arası ASGARİ mesafe (m) — altı gürültüdür. */
export const ROUTE_MIN_DISTANCE_M = 25;
/**
 * DURURKEN nokta yazma aralığı (ms).
 *
 * Araç dururken saniyelik nokta yazmak deponun çoğunu park kaydına harcar.
 * Duruşun BAŞI ve sonu zaten `stops` kaydında; burada yalnız seyrek bir
 * "hâlâ burada" damgası tutulur.
 */
export const ROUTE_STOPPED_INTERVAL_MS = 120_000;
/** Hareket hâlinde bile azami nokta aralığı (ms) — uzun düz yolda iz kopmasın. */
export const ROUTE_MAX_INTERVAL_MS = 30_000;
/** Yolculuk başına azami nokta — sınırsız büyüme YOK. */
export const ROUTE_MAX_POINTS = 3_000;

export interface RouteSampleDecision {
  readonly record: boolean;
  /** Kaydedilmediyse gerekçe — sessiz atlama YOK. */
  readonly skipReason: 'NO_FIX' | 'TOO_CLOSE' | 'STOPPED_THROTTLE' | 'CAPACITY' | null;
}

export interface RouteSampleInput {
  readonly lat: number | null;
  readonly lon: number | null;
  readonly tOffsetMs: number;
  readonly speedKmh: number | null;
  /** Son KAYDEDİLEN nokta; ilk noktada `null`. */
  readonly last: RoutePoint | null;
  readonly recordedCount: number;
  /** Araç şu an duruyor mu (accumulator hükmü). */
  readonly stopped: boolean;
}

/**
 * Bu fix rota izine yazılmalı mı — ADAPTİF örnekleme.
 *
 * Kural sırası kasıtlı: kapasite → geçerlilik → ilk nokta → duruş kısması →
 * mesafe/zaman. Kapasite en önde çünkü dolu bir defterde başka hiçbir
 * gerekçe yazmayı meşrulaştırmaz.
 */
export function decideRouteSample(input: RouteSampleInput): RouteSampleDecision {
  if (!input) return { record: false, skipReason: 'NO_FIX' };
  if (input.recordedCount >= ROUTE_MAX_POINTS) {
    return { record: false, skipReason: 'CAPACITY' };
  }
  if (!_coord(input.lat, input.lon) || !_finite(input.tOffsetMs)) {
    return { record: false, skipReason: 'NO_FIX' };
  }
  if (input.last === null) return { record: true, skipReason: null };

  const dt = input.tOffsetMs - input.last.tOffsetMs;
  if (dt < 0) return { record: false, skipReason: 'TOO_CLOSE' };

  if (input.stopped) {
    return dt >= ROUTE_STOPPED_INTERVAL_MS
      ? { record: true, skipReason: null }
      : { record: false, skipReason: 'STOPPED_THROTTLE' };
  }

  const distM = haversineMeters(
    input.last.lat, input.last.lon,
    input.lat as number, input.lon as number,
  );
  if (distM >= ROUTE_MIN_DISTANCE_M) return { record: true, skipReason: null };
  if (dt >= ROUTE_MAX_INTERVAL_MS) return { record: true, skipReason: null };
  return { record: false, skipReason: 'TOO_CLOSE' };
}

/** Haversine (m) — mesafe SAHİBİ değildir, yalnız örnekleme kararı içindir. */
export function haversineMeters(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Delta kodlama ─────────────────────────────────────────────────────── */

/** Koordinat çözünürlüğü — 1e5 ≈ 1,1 m. Araç izi için fazlasıyla yeter. */
const COORD_SCALE = 1e5;

/**
 * Sıkıştırılmış rota izi.
 *
 * Mutlak float dizisi yerine **tamsayı delta** tutulur: ardışık noktalar
 * birbirine yakın olduğu için delta'lar küçük sayılardır ve JSON gösterimi
 * ham dizinin birkaç katı küçüktür. Kayıpsız DEĞİLDİR (1e5'e yuvarlanır) ve
 * bu bilinçlidir — 1 metrenin altındaki fark bir araç izinde anlam taşımaz.
 */
export interface EncodedRouteTrace {
  readonly v: 1;
  readonly n: number;
  /** İlk noktanın ölçeklenmiş koordinatı. */
  readonly lat0: number;
  readonly lon0: number;
  /** Ardışık delta'lar (ölçeklenmiş tamsayı). */
  readonly dlat: readonly number[];
  readonly dlon: readonly number[];
  /** Zaman delta'ları (ms). İlk nokta `t0` ile taşınır. */
  readonly t0: number;
  readonly dt: readonly number[];
  /** Hız (km/h, tam sayıya yuvarlı). Bilinmeyen `-1` ile işaretlenir. */
  readonly spd: readonly number[];
}

/** Bilinmeyen hız sentinel'i — `0` KULLANILMAZ (0 km/h gerçek bir ölçümdür). */
export const SPEED_UNKNOWN_SENTINEL = -1;

export function encodeRouteTrace(points: readonly RoutePoint[]): EncodedRouteTrace | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  const valid = points.filter((p) => p && _coord(p.lat, p.lon) && _finite(p.tOffsetMs));
  if (valid.length === 0) return null;

  const first = valid[0] as RoutePoint;
  const lat0 = Math.round(first.lat * COORD_SCALE);
  const lon0 = Math.round(first.lon * COORD_SCALE);
  const t0 = Math.round(first.tOffsetMs);
  let prevLat = lat0;
  let prevLon = lon0;
  let prevT = t0;

  const dlat: number[] = [];
  const dlon: number[] = [];
  const dt: number[] = [];
  const spd: number[] = [_speed(first.speedKmh)];

  for (let i = 1; i < valid.length; i += 1) {
    const p = valid[i] as RoutePoint;
    const la = Math.round(p.lat * COORD_SCALE);
    const lo = Math.round(p.lon * COORD_SCALE);
    const t = Math.round(p.tOffsetMs);
    dlat.push(la - prevLat);
    dlon.push(lo - prevLon);
    dt.push(t - prevT);
    spd.push(_speed(p.speedKmh));
    prevLat = la; prevLon = lo; prevT = t;
  }

  return { v: 1, n: valid.length, lat0, lon0, dlat, dlon, t0, dt, spd };
}

function _speed(v: number | null): number {
  return v === null || !_finite(v) || v < 0
    ? SPEED_UNKNOWN_SENTINEL
    : Math.round(v);
}

/**
 * Kodlanmış izi geri aç.
 *
 * FAIL-SAFE: bozuk/eksik alan gördüğünde **boş dizi** döner — kısmi bir iz
 * "rota buydu" diye sunulamaz.
 */
export function decodeRouteTrace(enc: unknown): readonly RoutePoint[] {
  if (!enc || typeof enc !== 'object') return [];
  const e = enc as Record<string, unknown>;
  if (e.v !== 1) return [];
  const dlat = e.dlat, dlon = e.dlon, dt = e.dt, spd = e.spd;
  if (!Array.isArray(dlat) || !Array.isArray(dlon)
    || !Array.isArray(dt) || !Array.isArray(spd)) return [];
  if (!_finite(e.lat0) || !_finite(e.lon0) || !_finite(e.t0)) return [];
  if (dlat.length !== dlon.length || dlat.length !== dt.length) return [];
  if (spd.length !== dlat.length + 1) return [];

  let la = e.lat0 as number;
  let lo = e.lon0 as number;
  let t = e.t0 as number;
  const out: RoutePoint[] = [{
    lat: la / COORD_SCALE, lon: lo / COORD_SCALE,
    tOffsetMs: t, speedKmh: _readSpeed(spd[0]),
  }];

  for (let i = 0; i < dlat.length; i += 1) {
    const a = dlat[i], b = dlon[i], c = dt[i];
    if (!_finite(a) || !_finite(b) || !_finite(c)) return [];
    la += a as number; lo += b as number; t += c as number;
    out.push({
      lat: la / COORD_SCALE, lon: lo / COORD_SCALE,
      tOffsetMs: t, speedKmh: _readSpeed(spd[i + 1]),
    });
  }
  return out;
}

function _readSpeed(v: unknown): number | null {
  return _finite(v) && (v as number) >= 0 ? (v as number) : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. SEYİR DEFTERİ KAYDI (HAM KANIT)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * KAYIT ŞEMA SÜRÜMÜ.
 *
 * Alan kümesi veya bir alanın anlamı değişirse ARTIRILIR; aksi halde eski
 * ve yeni kayıtlar aynı sanılır.
 */
export const TRIP_JOURNAL_SCHEMA_VERSION = 1;

export interface JournalPoint {
  readonly lat: number;
  readonly lon: number;
}

/** Yolculuk İÇİ duruş — mola/trafik. `tripSessionModel`'in molasından AYRIDIR. */
export interface JournalStop {
  /** Yolculuk başlangıcından itibaren ms. */
  readonly startOffsetMs: number;
  /** Bittiği offset; `null` = duruş yolculuk bitene kadar sürdü. */
  readonly endOffsetMs: number | null;
  readonly durationMs: number;
}

export const JOURNAL_MAX_STOPS = 200;

export interface JournalMotionEvidence {
  readonly sampleCount: number;
  readonly spanMs: number;
  readonly sourceCount: number;
}

export const JOURNAL_EVENT_KINDS = [
  'HARSH_BRAKE', 'HARSH_ACCEL', 'STOP', 'RESUME', 'DATA_GAP',
] as const;
export type JournalEventKind = (typeof JOURNAL_EVENT_KINDS)[number];

export interface JournalEvent {
  readonly kind: JournalEventKind;
  readonly atOffsetMs: number;
  readonly magnitude: number | null;
}

export const JOURNAL_MAX_EVENTS = 300;

/**
 * TAM seyir kaydı — **CİHAZDA KALIR**.
 *
 * ── TÜRETİLMİŞ ÖZETTEN AYRIDIR ────────────────────────────────────────
 * Mesafe · süre · ortalama hız · skor gibi TÜRETİLMİŞ değerler burada
 * YOKTUR; onların tek sahibi `TripRecord`'dur. Burada yalnız o özetin
 * DAYANDIĞI ham kanıt durur. İkisini tek kayıtta birleştirmek, aynı
 * büyüklüğün iki farklı değerinin yan yana yaşamasına ve zamanla
 * ayrışmasına yol açardı.
 *
 * `tripId` ile `TripRecord.id` AYNI anahtardır — birleştirme okuma anında
 * yapılır, kopyalanarak değil.
 */
export interface TripJournalRecord {
  readonly schemaVersion: number;
  readonly tripId: string;
  /** Duvar saati (GÖSTERİM). Süre otoritesi monotonik saattir. */
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly endReason: TripEndReason;
  readonly startLocation: JournalPoint | null;
  readonly endLocation: JournalPoint | null;
  /** Kaba alan adı (ör. "Tarsus"). Çözülemezse `null` — UYDURULMAZ. */
  readonly startArea: string | null;
  readonly endArea: string | null;
  readonly route: EncodedRouteTrace | null;
  readonly stops: readonly JournalStop[];
  readonly motionEvidence: JournalMotionEvidence;
  readonly events: readonly JournalEvent[];
}

/**
 * Kaydı savunmacı oku — bozuk alan **kaydı düşürmez**, yalnız o alanı
 * `null`/boş bırakır. Tek bozuk rota yüzünden bütün yolculuğu kaybetmek
 * kanıt kaybıdır.
 */
export function readTripJournalRecord(raw: unknown): TripJournalRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tripId = typeof r.tripId === 'string' ? r.tripId : '';
  if (tripId.length === 0) return null;
  if (!_finite(r.startedAtMs)) return null;

  const reason = TRIP_END_REASONS.includes(r.endReason as TripEndReason)
    ? (r.endReason as TripEndReason)
    : 'UNKNOWN';

  return {
    schemaVersion: _finite(r.schemaVersion) ? (r.schemaVersion as number) : 0,
    tripId,
    startedAtMs: r.startedAtMs as number,
    endedAtMs: _finite(r.endedAtMs) ? (r.endedAtMs as number) : null,
    endReason: reason,
    startLocation: _readPoint(r.startLocation),
    endLocation: _readPoint(r.endLocation),
    startArea: _readArea(r.startArea),
    endArea: _readArea(r.endArea),
    route: _readRoute(r.route),
    stops: _readStops(r.stops),
    motionEvidence: _readEvidence(r.motionEvidence),
    events: _readEvents(r.events),
  };
}

function _readPoint(v: unknown): JournalPoint | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  return _coord(p.lat, p.lon)
    ? { lat: p.lat as number, lon: p.lon as number }
    : null;
}

function _readArea(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 80) : null;
}

function _readRoute(v: unknown): EncodedRouteTrace | null {
  if (!v || typeof v !== 'object') return null;
  /* Geri açılamıyorsa saklamaya değmez — yarım iz bir iz değildir. */
  return decodeRouteTrace(v).length > 0 ? (v as EncodedRouteTrace) : null;
}

function _readStops(v: unknown): readonly JournalStop[] {
  if (!Array.isArray(v)) return [];
  const out: JournalStop[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (!_finite(s.startOffsetMs)) continue;
    out.push({
      startOffsetMs: s.startOffsetMs as number,
      endOffsetMs: _finite(s.endOffsetMs) ? (s.endOffsetMs as number) : null,
      durationMs: _finite(s.durationMs) && (s.durationMs as number) > 0
        ? (s.durationMs as number) : 0,
    });
    if (out.length >= JOURNAL_MAX_STOPS) break;
  }
  return out;
}

function _readEvidence(v: unknown): JournalMotionEvidence {
  const empty: JournalMotionEvidence = { sampleCount: 0, spanMs: 0, sourceCount: 0 };
  if (!v || typeof v !== 'object') return empty;
  const e = v as Record<string, unknown>;
  return {
    sampleCount: _finite(e.sampleCount) ? (e.sampleCount as number) : 0,
    spanMs: _finite(e.spanMs) ? (e.spanMs as number) : 0,
    sourceCount: _finite(e.sourceCount) ? (e.sourceCount as number) : 0,
  };
}

function _readEvents(v: unknown): readonly JournalEvent[] {
  if (!Array.isArray(v)) return [];
  const out: JournalEvent[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (!JOURNAL_EVENT_KINDS.includes(e.kind as JournalEventKind)) continue;
    if (!_finite(e.atOffsetMs)) continue;
    out.push({
      kind: e.kind as JournalEventKind,
      atOffsetMs: e.atOffsetMs as number,
      magnitude: _finite(e.magnitude) ? (e.magnitude as number) : null,
    });
    if (out.length >= JOURNAL_MAX_EVENTS) break;
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _finite(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function _coord(lat: unknown, lon: unknown): boolean {
  if (!_finite(lat) || !_finite(lon)) return false;
  const a = lat as number, b = lon as number;
  if (a < -90 || a > 90 || b < -180 || b > 180) return false;
  /* Null Island — gerçek bir araç konumu değil, sensör sentineli. */
  return !(a === 0 && b === 0);
}
