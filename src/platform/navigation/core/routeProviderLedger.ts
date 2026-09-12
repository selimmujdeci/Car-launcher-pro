/**
 * routeProviderLedger — ROTA SAĞLAYICI DENEMELERİNİN DÜRÜST SİCİLİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK (zaman DIŞARIDAN) · React YOK ·
 * ağ YOK. Modül düzeyinde yalnız bounded bir halka tutar —
 * `routeRequestLedger` / `routeProviderReadiness` deseninin AYNISI; YENİ bir
 * store KURULMAZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-10 ölçümü · 2026-08-24, koddan) ─────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `fetchRoute` DÖRT katmanlı bir merdivendir:
 *   Katman 0  yerel OSRM daemon (localhost:5000, yalnız native)
 *   Katman 1-2 uzak OSRM sunucuları (sırayla, fail-fast)
 *   Katman 3  çevrimdışı A* grafiği (Worker)
 *   Katman 4  DÜZ HAT — rota DEĞİLDİR, açıkça etiketlenmiş son çare
 *
 * `_tryServer` zaten ZENGİN hata sınıfları üretiyordu:
 *   `HEADERS_TIMEOUT` · `HTTP 500` · `NO_ROUTES` · `EMPTY_GEOMETRY` ·
 *   `geometry_normalize_failed` · `ROUTE_ORIGIN_TOO_FAR` · `INVALID_COORDS` ·
 *   `Rota bulunamadı (code=…)`
 * …ama `fetchRoute` bunların HEPSİNİ tek bir sayaca indiriyordu:
 *
 *     catch (e) { recordRemoteFailure(); }   // ← tek sayaç, sebep YOK
 *
 * Yani sahada **"hangi sunucu, neden düştü"** sorusunun cevabı YOKTU. Dört
 * farklı sebebin dört farklı sonraki adımı vardır:
 *   · `TIMEOUT`             → ağ/eşik işi (sunucu ayakta, biz beklemedik)
 *   · `HTTP_ERROR`          → sağlayıcı işi (kota, 429, 5xx)
 *   · `NO_ROUTE`            → VERİ işi (o iki nokta arasında yol yok)
 *   · `MALFORMED_GEOMETRY`  → KOD/sağlayıcı sözleşmesi işi
 *
 * ── İKİNCİ ÖLÇÜM: "FALLBACK BAŞARISI" BAŞARI GİBİ GÖRÜNÜYORDU ─────────────
 * `serverUsed` yalnız KAZANANI yazar. İlk sağlayıcı düşüp ikincisi cevap
 * verdiğinde ekranda yalnız ikincisi görünür ve zincir "sağlıklı" okunur.
 * Oysa bu bir DEGRADASYONdur ve ölçülmelidir: birincil sağlayıcı sürekli
 * düşüyorsa ürün her rotada gizli bir gecikme ödüyordur.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · KARAR ÜRETMEZ: sunucu seçmez, yeniden deneme tetiklemez, eşik uygulamaz.
 *  · Kanıt yetmiyorsa `UNKNOWN` — "muhtemelen" YASAK.
 *  · DÜZ HAT bir rota sağlayıcısı DEĞİLDİR ve `SUCCESS` sayılmaz; zincirin
 *    hükmü `DEGRADED_STRAIGHT_LINE`tir (bkz. `summarizeRouteChain`).
 *  · PII TAŞIMAZ: koordinat, hedef adı ve tam URL bu modüle GİRMEZ — yalnız
 *    sunucu ETİKETİ (ana makine adı), sınıf ve süre.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) SAĞLAYICI VE SONUÇ SINIFLARI
   ══════════════════════════════════════════════════════════════════════════ */

/** Rota üretebilen katman. `routeProviderReadiness.RouteSourceKind` ile hizalı. */
export type RouteProviderId =
  | 'LOCAL_DAEMON'
  | 'REMOTE_OSRM'
  | 'OFFLINE_GRAPH'
  /** Rota DEĞİL — açıkça etiketlenmiş son çare. */
  | 'STRAIGHT_LINE';

export const ROUTE_PROVIDER_LABEL: Readonly<Record<RouteProviderId, string>> = {
  LOCAL_DAEMON:  'yerel OSRM daemon',
  REMOTE_OSRM:   'uzak OSRM sunucusu',
  OFFLINE_GRAPH: 'çevrimdışı A* grafiği',
  STRAIGHT_LINE: 'düz hat (rota DEĞİL)',
} as const;

/** TEK bir sağlayıcı denemesinin ölçülen sonucu. */
export type RouteAttemptOutcome =
  /** Geçerli rota üretti ve doğrulama kapısından geçti. */
  | 'SUCCESS'
  /** Sağlayıcıya ULAŞILDI ama iki nokta arasında rota YOK (veri boşluğu). */
  | 'NO_ROUTE'
  /** Başlık zaman aşımı — sunucu ayakta olabilir, biz beklemedik. */
  | 'TIMEOUT'
  /** Ağ katmanı hatası (DNS · bağlantı · TLS). */
  | 'NETWORK_ERROR'
  /** HTTP durum hatası (429 · 5xx …) — sağlayıcı konuştu ama reddetti. */
  | 'HTTP_ERROR'
  /** Rota döndü ama geometri BOŞ. */
  | 'EMPTY_GEOMETRY'
  /** Geometri var ama bozuk (normalize edilemedi · başlangıç çok uzak). */
  | 'MALFORMED_GEOMETRY'
  /** Geometri geçerli ama ürünün DOĞRULAMA KAPISI reddetti. */
  | 'VALIDATION_REJECTED'
  /** Yanıt geldi ama istek artık güncel değildi — uygulanmadı. */
  | 'STALE'
  /** Çevrimdışı olduğu için hiç denenmedi. */
  | 'SKIPPED_OFFLINE'
  /** Katman bu ortamda yok (ör. daemon yalnız native'de). */
  | 'UNAVAILABLE'
  /** Zincir daha önce cevap buldu → hiç denenmedi. */
  | 'NOT_ATTEMPTED';

export const ROUTE_OUTCOME_LABEL: Readonly<Record<RouteAttemptOutcome, string>> = {
  SUCCESS:             'rota üretti',
  NO_ROUTE:            'ulaşıldı, rota yok (veri boşluğu)',
  TIMEOUT:             'beklenmedi (başlık zaman aşımı)',
  NETWORK_ERROR:       'ağ hatası',
  HTTP_ERROR:          'HTTP durum hatası',
  EMPTY_GEOMETRY:      'boş geometri',
  MALFORMED_GEOMETRY:  'bozuk geometri',
  VALIDATION_REJECTED: 'doğrulama kapısı reddetti',
  STALE:               'bayat yanıt — uygulanmadı',
  SKIPPED_OFFLINE:     'çevrimdışı — atlandı',
  UNAVAILABLE:         'bu ortamda yok',
  NOT_ATTEMPTED:       'denenmedi',
} as const;

/** Sağlayıcıya GERÇEKTEN ulaşıldı mı — "yol yok" iddiasının ön koşulu. */
export function wasRouteProviderReached(o: RouteAttemptOutcome): boolean {
  return o === 'SUCCESS' || o === 'NO_ROUTE' || o === 'EMPTY_GEOMETRY'
      || o === 'MALFORMED_GEOMETRY' || o === 'VALIDATION_REJECTED' || o === 'HTTP_ERROR';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) HATA METNİ → SINIF
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `_tryServer`in fırlattığı hata metnini kanonik sınıfa çevirir. **SAF.**
 *
 * ⚠️ Metinler `routingService._tryServer` içinde ÜRETİLİR; ikisi birlikte
 * değişmek zorundadır. Tanınmayan metin `NETWORK_ERROR` DEĞİL, en genel
 * gözlemlenebilir sınıf olan `NETWORK_ERROR`a düşürülmeden önce açıkça
 * denenir — eşleşme yoksa `NETWORK_ERROR` döner çünkü `fetch` katmanından
 * gelen tanımsız hatalar pratikte ağ hatalarıdır. Bu varsayım BURADA yazılıdır
 * ki sessiz kalmasın.
 */
export function classifyRouteError(message: unknown): RouteAttemptOutcome {
  const m = typeof message === 'string' ? message : '';
  if (m.length === 0) return 'NETWORK_ERROR';

  if (m.includes('HEADERS_TIMEOUT'))          return 'TIMEOUT';
  if (m.includes('AbortError') || m.includes('TimeoutError')) return 'TIMEOUT';
  if (m.startsWith('HTTP '))                  return 'HTTP_ERROR';
  if (m.includes('NO_ROUTES'))                return 'NO_ROUTE';
  /* OSRM `code` alanı: `NoRoute` · `NoSegment` — ikisi de "yol yok"tur. */
  if (m.includes('Rota bulunamadı'))          return 'NO_ROUTE';
  if (m.includes('EMPTY_GEOMETRY'))           return 'EMPTY_GEOMETRY';
  if (m.includes('geometry_normalize_failed')) return 'MALFORMED_GEOMETRY';
  if (m.includes('ROUTE_ORIGIN_TOO_FAR'))     return 'MALFORMED_GEOMETRY';
  if (m.includes('INVALID_COORDS'))           return 'MALFORMED_GEOMETRY';
  return 'NETWORK_ERROR';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DENEME KAYDI
   ══════════════════════════════════════════════════════════════════════════ */

export interface RouteAttempt {
  /** Bu denemenin ait olduğu rota isteği (`routeRequestLedger` kimliği). */
  readonly requestId: number;
  readonly provider: RouteProviderId;
  /**
   * Sunucunun ana makine etiketi (`routing.openstreetmap.de`). TAM URL, sorgu
   * dizesi ve KOORDİNAT buraya GİRMEZ. Bilinmiyorsa `null`.
   */
  readonly serverLabel: string | null;
  readonly outcome: RouteAttemptOutcome;
  /** Denemenin süresi (ms). Ölçülmediyse `null` — sahte 0 YASAK. */
  readonly ms: number | null;
  /** Sağlayıcının döndürdüğü aday rota sayısı (ana + alternatifler). */
  readonly candidateCount: number | null;
  /** Doğrulama kapısının reddettiği aday sayısı. */
  readonly rejectedCount: number | null;
  readonly atMs: number;
}

/** Defterin tavanı — sınırsız kayıt cihazda bellek sorunudur. */
export const ROUTE_ATTEMPT_RING = 24;

/* ══════════════════════════════════════════════════════════════════════════
   4) ZİNCİR HÜKMÜ — FALLBACK GERÇEĞİ
   ══════════════════════════════════════════════════════════════════════════ */

export type RouteChainOutcome =
  /** Merdivenin İLK denenen katmanı cevap verdi — degradasyon YOK. */
  | 'PRIMARY_SUCCESS'
  /** Bir üst katman düştü, alt katman kurtardı — GİZLİ DEGRADASYON. */
  | 'FALLBACK_SUCCESS'
  /** Hiçbir gerçek sağlayıcı cevap veremedi; düz hat devrede (rota DEĞİL). */
  | 'DEGRADED_STRAIGHT_LINE'
  /** Hiçbir katman bir şey üretmedi. */
  | 'ALL_FAILED'
  /** Kanıt yetersiz — hüküm iddia EDİLMEZ. */
  | 'UNKNOWN';

export const ROUTE_CHAIN_LABEL: Readonly<Record<RouteChainOutcome, string>> = {
  PRIMARY_SUCCESS:       'birincil sağlayıcı cevapladı',
  FALLBACK_SUCCESS:      'yedek katman kurtardı — GİZLİ DEGRADASYON',
  DEGRADED_STRAIGHT_LINE: 'düz hat devrede — GERÇEK ROTA YOK',
  ALL_FAILED:            'hiçbir katman rota üretemedi',
  UNKNOWN:               'kanıt yetersiz — hüküm iddia edilmiyor',
} as const;

export interface RouteChainSummary {
  readonly outcome: RouteChainOutcome;
  /** Rotayı GERÇEKTEN üreten katman; yoksa `null`. */
  readonly winner: RouteProviderId | null;
  readonly winnerLabel: string | null;
  /**
   * Yedeğe düşme sebebi — kazanandan ÖNCE düşen İLK katmanın sonucu.
   * Degradasyon yoksa `null`.
   */
  readonly fallbackReason: RouteAttemptOutcome | null;
  /** Kazanandan önce düşen katman sayısı. */
  readonly degradedSteps: number;
  /** Denenen (yani `NOT_ATTEMPTED` olmayan) katman sayısı. */
  readonly attemptedCount: number;
  readonly why: string;
}

/**
 * Deneme listesinden zincir hükmü türetir. **SAF.**
 *
 * Liste ZAMAN SIRASINDA olmalıdır (merdiven sırası). Sıra bozulursa
 * "birincil mi yedek mi" sorusu anlamını yitirir.
 */
export function summarizeRouteChain(
  attempts: readonly RouteAttempt[],
): RouteChainSummary {
  const tried = attempts.filter((a) => a.outcome !== 'NOT_ATTEMPTED');

  const base = { attemptedCount: tried.length };

  if (tried.length === 0) {
    return {
      outcome: 'UNKNOWN', winner: null, winnerLabel: null,
      fallbackReason: null, degradedSteps: 0, ...base,
      why: 'hiçbir sağlayıcı denemesi bildirilmedi',
    };
  }

  const winIdx = tried.findIndex((a) => a.outcome === 'SUCCESS');

  /* Düz hat bir sağlayıcı DEĞİLDİR: onu "kazanan" saymak, sürücüye rota
     olmadığı hâlde rota varmış gibi göstermektir (tam olarak kaçındığımız
     yalan). Bu yüzden AYRI hüküm sınıfı vardır. */
  const straight = tried.find((a) => a.provider === 'STRAIGHT_LINE');

  if (winIdx < 0) {
    /* Degradasyon sebebi: düz hattan ÖNCEKİ ilk gerçek başarısızlık. */
    const firstReal = tried.find(
      (a) => a.provider !== 'STRAIGHT_LINE' && a.outcome !== 'SKIPPED_OFFLINE'
          && a.outcome !== 'UNAVAILABLE',
    ) ?? tried[0];
    if (straight !== undefined) {
      return {
        outcome: 'DEGRADED_STRAIGHT_LINE',
        winner: null, winnerLabel: null,
        fallbackReason: firstReal.outcome,
        degradedSteps: tried.filter((a) => a.provider !== 'STRAIGHT_LINE').length,
        ...base,
        why: `hiçbir gerçek sağlayıcı rota üretemedi (ilk sebep: `
           + `${ROUTE_OUTCOME_LABEL[firstReal.outcome]}) — düz hat rota DEĞİLDİR`,
      };
    }
    return {
      outcome: 'ALL_FAILED',
      winner: null, winnerLabel: null,
      fallbackReason: firstReal.outcome,
      degradedSteps: tried.length,
      ...base,
      why: `${tried.length} katman denendi, hiçbiri rota üretmedi`,
    };
  }

  const win = tried[winIdx];

  /* Kazanandan ÖNCE gerçekten DENENİP düşen katmanlar degradasyondur.
     `SKIPPED_OFFLINE` / `UNAVAILABLE` bir düşüş DEĞİLDİR — o katman bu
     ortamda zaten yoktu; onu degradasyon saymak yanlış alarm üretirdi. */
  const before = tried.slice(0, winIdx).filter(
    (a) => a.outcome !== 'SKIPPED_OFFLINE' && a.outcome !== 'UNAVAILABLE',
  );

  if (before.length === 0) {
    return {
      outcome: 'PRIMARY_SUCCESS',
      winner: win.provider, winnerLabel: win.serverLabel,
      fallbackReason: null, degradedSteps: 0, ...base,
      why: `${ROUTE_PROVIDER_LABEL[win.provider]} ilk denemede cevapladı`,
    };
  }

  return {
    outcome: 'FALLBACK_SUCCESS',
    winner: win.provider, winnerLabel: win.serverLabel,
    fallbackReason: before[0].outcome,
    degradedSteps: before.length,
    ...base,
    why: `${before.length} katman düştü (ilki: ${ROUTE_OUTCOME_LABEL[before[0].outcome]}), `
       + `${ROUTE_PROVIDER_LABEL[win.provider]} kurtardı — bu bir DEGRADASYONdur`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ÇALIŞMA ZAMANI DEFTERİ (bounded · fail-soft)
   ══════════════════════════════════════════════════════════════════════════ */

let _attempts: RouteAttempt[] = [];
/** Sağlayıcı × sonuç sayacı — halka taşsa bile toplam KAYBOLMASIN. */
const _counts = new Map<string, number>();
let _fallbackSuccessCount = 0;
let _straightLineChainCount = 0;

/**
 * Bir deneme kaydeder. **THROW ETMEZ** — teşhis kaydı rota akışını ASLA bozamaz.
 */
export function recordRouteAttempt(a: RouteAttempt): void {
  try {
    _attempts.push(a);
    if (_attempts.length > ROUTE_ATTEMPT_RING) {
      _attempts = _attempts.slice(_attempts.length - ROUTE_ATTEMPT_RING);
    }
    const key = `${a.provider}|${a.outcome}`;
    _counts.set(key, (_counts.get(key) ?? 0) + 1);
  } catch { /* fail-soft */ }
}

/** Bir rota isteğinin zincir hükmünü kaydeder (toplam sayaçlar için). */
export function recordRouteChainOutcome(o: RouteChainOutcome): void {
  try {
    if (o === 'FALLBACK_SUCCESS') _fallbackSuccessCount += 1;
    if (o === 'DEGRADED_STRAIGHT_LINE') _straightLineChainCount += 1;
  } catch { /* fail-soft */ }
}

export interface RouteProviderLedgerSnapshot {
  readonly attempts: readonly RouteAttempt[];
  /** `provider|outcome` → adet. Halka taşsa bile toplam korunur. */
  readonly counts: Readonly<Record<string, number>>;
  /** EN SON rota isteğinin zincir hükmü. Kayıt yoksa `UNKNOWN`. */
  readonly lastChain: RouteChainSummary;
  /** Yedek katmanın kurtardığı istek sayısı — gizli degradasyonun ölçüsü. */
  readonly fallbackSuccessCount: number;
  /** Düz hatta düşen istek sayısı — GERÇEK ROTA ÜRETİLEMEDİ. */
  readonly straightLineChainCount: number;
}

export function getRouteProviderLedger(): RouteProviderLedgerSnapshot {
  /* Son isteğin denemeleri: en yeni `requestId`ye ait olanlar. Kimlik yoksa
     hüküm UNKNOWN kalır — karışık istekleri tek zincir sanmak yanlış olur. */
  const lastId = _attempts.length > 0 ? _attempts[_attempts.length - 1].requestId : null;
  const lastAttempts = lastId === null
    ? []
    : _attempts.filter((a) => a.requestId === lastId);

  return {
    attempts: _attempts.slice(),
    counts: Object.fromEntries(_counts),
    lastChain: summarizeRouteChain(lastAttempts),
    fallbackSuccessCount: _fallbackSuccessCount,
    straightLineChainCount: _straightLineChainCount,
  };
}

/** Test izolasyonu — defter testler arasında sızmasın. */
export function _resetRouteProviderLedgerForTest(): void {
  _attempts = [];
  _counts.clear();
  _fallbackSuccessCount = 0;
  _straightLineChainCount = 0;
}
