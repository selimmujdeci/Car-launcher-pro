/**
 * tripSessionModel.ts — SEYAHAT OTURUMU (saf).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · global durum YOK ·
 * import YOK. Tüm girdiler dışarıdan → testler deterministiktir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Mavi "3 saattir yoldayız" derken gerçek 40 dakikaydı; kat edilen km de
 * yanlıştı. KÖK: `tripLogService`'te yolculuğu kapatan duruş penceresi YALNIZ
 * `_onGPS`/`_onOBD` gövdesinin İÇİNDE kuruluyor (`_liveClock` yalnız
 * dinleyicilere haber verir, bitiş DEĞERLENDİRMEZ). Araç park edip GPS ve OBD
 * tamamen susunca hiçbir callback gelmez → kapanış zamanlayıcısı hiç kurulmaz
 * → yolculuk açık kalır ve bir sonraki sürüşte AYNI oturum devam eder.
 * `liveDurationMin` monotonik olduğu için park süresini de sayar.
 *
 * ── BU MODELİN İŞİ ────────────────────────────────────────────────────────
 * `tripLogService`'in ÜRETTİĞİ yolculukları ve aralarındaki BOŞLUKLARI tek bir
 * "seyahat"e toplamak. Sürücünün sorduğu şey tekil yolculuk değildir:
 *
 *     08:20 hareket · 08:50 durdu · 09:10 tekrar hareket
 *     → yola çıkalı 50 dk · hareket 30 dk · mola 20 dk
 *
 * ── SAHİPLİK (pazarlıksız) ────────────────────────────────────────────────
 * Bu model HİÇBİR ŞEY ÖLÇMEZ. Her sayı mevcut sahibinden gelir:
 *   · hareket/rölanti/bilinmeyen süre → `tripMetricsAccumulator` (movingMs/idleMs/unknownMs)
 *   · kat edilen mesafe              → `tripLogService` (GPS haversine + OBD yedeği)
 *   · anlık duruş                    → `tripMetricsAccumulator.stopSincePerfMs`
 *
 * SAHİPSİZ OLAN TEK ŞEY, bu modelin GERÇEKTEN türettiği şeydir: **iki yolculuk
 * arasındaki boşluk** — yani MOLA. Bugün bunu kimse tutmuyor.
 *
 * ── BU MODELİN YAPMADIĞI ──────────────────────────────────────────────────
 *  · Mesafe BİRİKTİRMEZ: segment mesafesi dışarıdan KÜMÜLATİF gelir, model
 *    yalnız segment değişiminde MÜHÜRLER → çifte sayım YAPISAL olarak imkânsız.
 *  · Ölü hesaplama (PR-451a) mesafesini EKLEMEZ — o bir projeksiyondur, ölçüm
 *    değil; odometreye de dokunulmaz.
 *  · KALAN rota mesafesini kat edilen mesafe SAYMAZ (ikisi ayrı kavramdır).
 *  · Bilinmeyen süreyi "mola" SAYMAZ — ayrı kovada dürüstçe taşır.
 *  · Her kısa duruşta YENİ oturum açmaz.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir molanın oturumu BİTİRDİĞİ eşik.
 *
 * Neden 45 dk: kullanıcı senaryosundaki 20 dk'lık mola oturumu BİTİRMEMELİ
 * (şart), ama saatler sonraki ayrı bir sürüş de aynı seyahat SAYILMAMALI —
 * "3 saattir yoldayız" kusuru tam olarak buydu. 45 dk yemek/yakıt molasının
 * rahatça üstünde, ayrı bir seyahatin ise altındadır.
 */
export const SESSION_MAX_BREAK_MS = 45 * 60_000;

/** Mola kaydı tavanı — sınırsız dizi büyümesi YOK (bellek sözleşmesi). */
export const MAX_STOP_PERIODS = 50;

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type TripSessionState = 'NOT_STARTED' | 'MOVING' | 'STOPPED';

export interface TripPoint {
  readonly lat: number;
  readonly lon: number;
}

/** Bir mola — iki yolculuk arasındaki boşluk. */
export interface TripStopPeriod {
  /** Molanın başladığı monotonik an. */
  readonly startedMonoMs: number;
  /** Bittiği an; `null` = mola HÂLÂ sürüyor. */
  readonly endedMonoMs: number | null;
  /** Kapanmış molanın süresi (ms). Süren molada 0 — süre `project` ile okunur. */
  readonly durationMs: number;
}

/**
 * `tripLogService`'in aktif yolculuğundan okunan KÜMÜLATİF görüntü.
 *
 * `key` segment kimliğidir (yolculuğun monotonik başlangıcı) — DEĞİŞMESİ yeni
 * bir yolculuk demektir ve mühürleme tam orada olur.
 */
export interface TripSessionSegment {
  readonly key: number;
  /** Yolculuğun gerçek başlangıcı — monotonik (oturum başlangıcı buradan gelir). */
  readonly startedMonoMs: number;
  /** Yolculuğun gerçek başlangıcı — duvar saati (yalnız GÖSTERİM). */
  readonly startedWallMs: number;
  /** `tripMetricsAccumulator` kovaları (kümülatif, ms). */
  readonly movingMs: number;
  readonly idleMs: number;
  readonly unknownMs: number;
  /** `tripLogService` kat edilen mesafe (kümülatif, metre). */
  readonly distanceM: number;
  /** İçinde bulunulan duruşun başlangıcı; hareket hâlindeyse `null`. */
  readonly stoppedSinceMonoMs: number | null;
}

/** Tek okuma anı — runtime bunu üretir, model yorumlar. */
export interface TripSessionSample {
  readonly monoMs: number;
  readonly wallMs: number;
  /** `null` = `tripLogService`'te aktif yolculuk YOK (mola ya da henüz başlamadı). */
  readonly segment: TripSessionSegment | null;
  readonly lat: number | null;
  readonly lon: number | null;
}

export interface TripSession {
  /** Oturum kimliği — `null` = henüz hiç hareket edilmedi. */
  readonly sessionId: string | null;
  /** Oturumun başladığı duvar saati (GÖSTERİM) — "yola ne zaman çıktık". */
  readonly startWallMs: number | null;
  /** Oturumun başladığı monotonik an (OTORİTE). */
  readonly startMonoMs: number | null;
  /** En son HAREKET gözlenen monotonik an. */
  readonly lastMotionMonoMs: number | null;
  readonly state: TripSessionState;

  /* ── Mühürlenmiş segmentlerin toplamı (kapanmış yolculuklar) ── */
  readonly sealedMovingMs: number;
  readonly sealedIdleMs: number;
  readonly sealedUnknownMs: number;
  readonly sealedDistanceM: number;
  /** Segmentler ARASI mola toplamı — bu modelin türettiği TEK büyüklük. */
  readonly sealedBreakMs: number;

  /* ── İçinde bulunulan segment (kümülatif, henüz mühürlenmedi) ── */
  readonly currentSegment: TripSessionSegment | null;

  /** Süren molanın başlangıcı; `null` = mola yok. */
  readonly breakSinceMonoMs: number | null;

  readonly startLocation: TripPoint | null;
  readonly currentLocation: TripPoint | null;
  readonly stopPeriods: readonly TripStopPeriod[];
  /** Son örneğin alındığı monotonik an. */
  readonly lastUpdateMonoMs: number | null;
  /** Bu oturumda kaç ayrı yolculuk (segment) birleşti. */
  readonly segmentCount: number;
}

/** `project()` çıktısı — okunmaya hazır, TÜRETİLMİŞ görüntü. */
export interface TripSessionProjection {
  readonly sessionId: string | null;
  readonly state: TripSessionState;
  readonly startWallMs: number | null;
  /** Yola çıkalı geçen toplam süre (ms). */
  readonly elapsedMs: number;
  /** Hareket hâlinde geçen süre (ms) — `tripMetricsAccumulator` otoritesi. */
  readonly movingMs: number;
  /** Mola + rölanti (ms): segment içi duruş + segmentler arası boşluk. */
  readonly stoppedMs: number;
  /** ÖLÇÜLEMEYEN süre — "mola" SAYILMAZ, dürüstçe ayrı taşınır. */
  readonly unknownMs: number;
  /** Kat edilen mesafe (m) — KALAN rota mesafesi DEĞİLDİR. */
  readonly distanceMeters: number;
  readonly startLocation: TripPoint | null;
  readonly currentLocation: TripPoint | null;
  readonly stopPeriods: readonly TripStopPeriod[];
  readonly segmentCount: number;
  /** Süren molanın uzunluğu (ms); mola yoksa 0. */
  readonly currentBreakMs: number;
  /**
   * Süren mola oturum eşiğini AŞTI mı. `true` ise bir sonraki hareket YENİ
   * oturum başlatır — okuyucu "bu seyahat fiilen bitti" diyebilir.
   */
  readonly breakExceededSession: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Negatif/ölçülemeyen süre 0 sayılır — sayaçlar GERİ GİTMEZ. */
function _ms(n: unknown): number {
  return _finite(n) && n > 0 ? n : 0;
}

function _point(lat: unknown, lon: unknown): TripPoint | null {
  if (!_finite(lat) || !_finite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Boş oturum — TÜM anahtarlar baştan tanımlı (V8 hidden-class kararlılığı). */
export function emptyTripSession(): TripSession {
  return {
    sessionId:        null,
    startWallMs:      null,
    startMonoMs:      null,
    lastMotionMonoMs: null,
    state:            'NOT_STARTED',
    sealedMovingMs:   0,
    sealedIdleMs:     0,
    sealedUnknownMs:  0,
    sealedDistanceM:  0,
    sealedBreakMs:    0,
    currentSegment:   null,
    breakSinceMonoMs: null,
    startLocation:    null,
    currentLocation:  null,
    stopPeriods:      [],
    lastUpdateMonoMs: null,
    segmentCount:     0,
  };
}

/** Segment girdisini savunmacı okur; kullanılamazsa `null`. */
function _readSegment(s: unknown): TripSessionSegment | null {
  if (s === null || typeof s !== 'object') return null;
  const g = s as Record<string, unknown>;
  if (!_finite(g['key']) || !_finite(g['startedMonoMs'])) return null;
  return {
    key:            g['key'] as number,
    startedMonoMs:  g['startedMonoMs'] as number,
    startedWallMs:  _finite(g['startedWallMs']) ? (g['startedWallMs'] as number) : 0,
    movingMs:       _ms(g['movingMs']),
    idleMs:         _ms(g['idleMs']),
    unknownMs:      _ms(g['unknownMs']),
    distanceM:      _ms(g['distanceM']),
    stoppedSinceMonoMs: _finite(g['stoppedSinceMonoMs'])
      ? (g['stoppedSinceMonoMs'] as number) : null,
  };
}

/** Mevcut segmenti toplamlara MÜHÜRLE — kümülatif değerler tam burada donar. */
function _seal(session: TripSession): TripSession {
  const cur = session.currentSegment;
  if (cur === null) return session;
  return {
    ...session,
    sealedMovingMs:  session.sealedMovingMs  + cur.movingMs,
    sealedIdleMs:    session.sealedIdleMs    + cur.idleMs,
    sealedUnknownMs: session.sealedUnknownMs + cur.unknownMs,
    sealedDistanceM: session.sealedDistanceM + cur.distanceM,
    currentSegment:  null,
  };
}

/** Yeni oturum aç (segmentin KENDİ başlangıcıyla — gözlem anıyla DEĞİL). */
function _open(seg: TripSessionSegment, sample: TripSessionSample): TripSession {
  const base = emptyTripSession();
  return {
    ...base,
    /* Kimlik monotonik başlangıçtan türer: aynı oturum iki kez açılamaz ve
       `Date.now`/rastgelelik gerekmez (saflık korunur). */
    sessionId:        `session-${Math.round(seg.startedMonoMs)}`,
    startWallMs:      seg.startedWallMs > 0 ? seg.startedWallMs : sample.wallMs,
    startMonoMs:      seg.startedMonoMs,
    lastMotionMonoMs: sample.monoMs,
    state:            seg.stoppedSinceMonoMs === null ? 'MOVING' : 'STOPPED',
    currentSegment:   seg,
    startLocation:    _point(sample.lat, sample.lon),
    currentLocation:  _point(sample.lat, sample.lon),
    lastUpdateMonoMs: sample.monoMs,
    segmentCount:     1,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * İlerletme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Oturumu tek örnekle ilerlet.
 *
 * FAIL-SAFE: ölçülemeyen örnek oturumu DEĞİŞTİRMEZ (geri sarma yok, uydurma
 * yok). Zaman geriye giderse (monotonik olmayan kaynak) örnek YOK SAYILIR.
 */
export function advanceTripSession(
  session: TripSession,
  sample: TripSessionSample,
): TripSession {
  if (!sample || !_finite(sample.monoMs)) return session;
  /* Monotoniklik şartı: geriye giden zaman süre kovalarını bozardı. */
  if (session.lastUpdateMonoMs !== null && sample.monoMs < session.lastUpdateMonoMs) {
    return session;
  }

  const seg = _readSegment(sample.segment);
  const here = _point(sample.lat, sample.lon);

  /* ── A) Aktif yolculuk YOK → MOLA (ya da henüz başlamadı) ─────────────── */
  if (seg === null) {
    if (session.startMonoMs === null) {
      // Hiç hareket edilmedi: oturum AÇILMAZ. Rota kurulması yola çıkmak DEĞİLDİR.
      return session;
    }
    // Segment kapandıysa mühürle ve molayı başlat.
    let next = _seal(session);
    if (next.breakSinceMonoMs === null) {
      const startedAt = session.lastUpdateMonoMs ?? sample.monoMs;
      const periods = next.stopPeriods.length >= MAX_STOP_PERIODS
        ? next.stopPeriods.slice(1)
        : next.stopPeriods;
      next = {
        ...next,
        breakSinceMonoMs: startedAt,
        stopPeriods: [...periods, { startedMonoMs: startedAt, endedMonoMs: null, durationMs: 0 }],
      };
    }
    return {
      ...next,
      state:            'STOPPED',
      currentLocation:  here ?? next.currentLocation,
      lastUpdateMonoMs: sample.monoMs,
    };
  }

  /* ── B) İlk hareket → oturumu AÇ ──────────────────────────────────────── */
  if (session.startMonoMs === null) return _open(seg, sample);

  /* ── C) Yeni segment mi? ──────────────────────────────────────────────── */
  if (session.currentSegment !== null && session.currentSegment.key !== seg.key) {
    // Önceki segment mühürlenmemişse burada mühürlenir (mola görülmeden geçiş).
    session = _seal(session);
  }

  const isNewSegment = session.currentSegment === null;

  if (isNewSegment) {
    const breakStart = session.breakSinceMonoMs;
    const breakMs = breakStart === null ? 0 : Math.max(0, seg.startedMonoMs - breakStart);

    /* Mola oturum eşiğini aştıysa bu ARTIK yeni bir seyahattir. */
    if (breakMs >= SESSION_MAX_BREAK_MS) return _open(seg, sample);

    /* Aynı oturum devam eder: molayı kapat ve toplama ekle. */
    const periods = session.stopPeriods.map((p, i) =>
      i === session.stopPeriods.length - 1 && p.endedMonoMs === null
        ? { startedMonoMs: p.startedMonoMs, endedMonoMs: seg.startedMonoMs, durationMs: breakMs }
        : p,
    );
    session = {
      ...session,
      sealedBreakMs:    session.sealedBreakMs + breakMs,
      breakSinceMonoMs: null,
      stopPeriods:      periods,
      segmentCount:     session.segmentCount + 1,
    };
  }

  /* ── D) Segmenti güncelle (kümülatif — model BİRİKTİRMEZ) ─────────────── */
  const moving = seg.stoppedSinceMonoMs === null;
  return {
    ...session,
    state:            moving ? 'MOVING' : 'STOPPED',
    currentSegment:   seg,
    lastMotionMonoMs: moving ? sample.monoMs : session.lastMotionMonoMs,
    currentLocation:  here ?? session.currentLocation,
    startLocation:    session.startLocation ?? here,
    lastUpdateMonoMs: sample.monoMs,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Okuma (türetme)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Oturumu `monoNow` anına göre yansıt.
 *
 * NEDEN AYRI BİR ADIM: süren mola ve geçen süre ZAMANLA büyür. Bunu ilerletme
 * adımında biriktirmek periyodik bir tick (yeni timer) gerektirirdi; burada
 * OKUMA ANINDA türetilir → **yeni zamanlayıcı kurulmaz**.
 */
export function projectTripSession(
  session: TripSession,
  monoNow: number,
): TripSessionProjection {
  const empty: TripSessionProjection = {
    sessionId: null, state: 'NOT_STARTED', startWallMs: null,
    elapsedMs: 0, movingMs: 0, stoppedMs: 0, unknownMs: 0, distanceMeters: 0,
    startLocation: null, currentLocation: null, stopPeriods: [],
    segmentCount: 0, currentBreakMs: 0, breakExceededSession: false,
  };
  if (!session || session.startMonoMs === null) return empty;
  if (!_finite(monoNow)) return empty;

  const cur = session.currentSegment;
  const movingMs  = session.sealedMovingMs  + (cur ? cur.movingMs  : 0);
  const idleMs    = session.sealedIdleMs    + (cur ? cur.idleMs    : 0);
  const unknownMs = session.sealedUnknownMs + (cur ? cur.unknownMs : 0);
  const distanceM = session.sealedDistanceM + (cur ? cur.distanceM : 0);

  /* Süren mola okuma anına kadar uzar (mühürlenmiş molalar zaten toplamda). */
  const currentBreakMs = session.breakSinceMonoMs === null
    ? 0
    : Math.max(0, monoNow - session.breakSinceMonoMs);

  /* Geçen süre saatten DEĞİL monotonik farktan gelir (saat sıçraması güvenli). */
  const elapsedMs = Math.max(0, monoNow - session.startMonoMs);

  const periods = session.breakSinceMonoMs === null
    ? session.stopPeriods
    : session.stopPeriods.map((p, i) =>
        i === session.stopPeriods.length - 1 && p.endedMonoMs === null
          ? { startedMonoMs: p.startedMonoMs, endedMonoMs: null, durationMs: currentBreakMs }
          : p,
      );

  return {
    sessionId:      session.sessionId,
    state:          session.state,
    startWallMs:    session.startWallMs,
    elapsedMs,
    movingMs,
    /* Mola = segment içi rölanti + segmentler arası boşluk. Bilinmeyen süre
       BURAYA GİRMEZ — ölçülemeyeni "mola" saymak uydurma olurdu. */
    stoppedMs:      idleMs + session.sealedBreakMs + currentBreakMs,
    unknownMs,
    distanceMeters: distanceM,
    startLocation:  session.startLocation,
    currentLocation: session.currentLocation,
    stopPeriods:    periods,
    segmentCount:   session.segmentCount,
    currentBreakMs,
    breakExceededSession: currentBreakMs >= SESSION_MAX_BREAK_MS,
  };
}
