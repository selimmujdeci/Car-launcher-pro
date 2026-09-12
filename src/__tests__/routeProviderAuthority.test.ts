/**
 * P0-NAV-10 — ROTA SAĞLAYICI OTORİTESİ + FALLBACK GERÇEĞİ (KİLİT).
 *
 * ── ÖLÇÜLEN KUSUR (2026-08-24, koddan) ────────────────────────────────────
 * `_tryServer` ZENGİN hata sınıfları üretiyordu (`HEADERS_TIMEOUT` · `HTTP 5xx`
 * · `NO_ROUTES` · `EMPTY_GEOMETRY` · `geometry_normalize_failed` ·
 * `ROUTE_ORIGIN_TOO_FAR` · `INVALID_COORDS`) ama `fetchRoute` hepsini TEK
 * sayaca indiriyordu: `catch { recordRemoteFailure(); }`. Sahada "hangi sunucu,
 * neden düştü" sorusunun cevabı YOKTU — oysa dört sebebin dört farklı sonraki
 * adımı var (eşik/ağ · sağlayıcı kotası · veri boşluğu · KOD).
 *
 * İKİNCİ KUSUR: `serverUsed` yalnız KAZANANI yazar. Birincil sağlayıcı düşüp
 * yedeği kurtardığında zincir "sağlıklı" okunuyordu; oysa bu DEGRADASYONdur.
 *
 * SAF: ağ YOK · timer YOK · cihaz YOK.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  classifyRouteError,
  getRouteProviderLedger,
  recordRouteAttempt,
  recordRouteChainOutcome,
  summarizeRouteChain,
  wasRouteProviderReached,
  ROUTE_ATTEMPT_RING,
  _resetRouteProviderLedgerForTest,
  type RouteAttempt,
  type RouteAttemptOutcome,
  type RouteProviderId,
} from '../platform/navigation/core/routeProviderLedger';

/* ── Yardımcı ────────────────────────────────────────────────────────────── */

let _seq = 0;
const att = (
  provider: RouteProviderId,
  outcome: RouteAttemptOutcome,
  serverLabel: string | null = null,
  requestId = 1,
  ms: number | null = 100,
): RouteAttempt => ({
  requestId, provider, serverLabel, outcome, ms,
  candidateCount: null, rejectedCount: null, atMs: 1_700_000_000_000 + (_seq += 1),
});

beforeEach(() => { _resetRouteProviderLedgerForTest(); _seq = 0; });

/* ══════════════════════════════════════════════════════════════════════════
   1) HATA METNİ → SINIF (routingService._tryServer ile sözleşme)
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-10 › hata sınıflandırması', () => {
  it('`_tryServer`in ÜRETTİĞİ her metin doğru sınıfa düşer', () => {
    /* Bu tablo `routingService._tryServer` içindeki `throw new Error(...)`
       metinleriyle BİREBİR eşleşir. İkisi birlikte değişmek zorundadır. */
    const cases: ReadonlyArray<readonly [string, RouteAttemptOutcome]> = [
      ['HEADERS_TIMEOUT',                                        'TIMEOUT'],
      ['HTTP 429',                                               'HTTP_ERROR'],
      ['HTTP 503',                                               'HTTP_ERROR'],
      ['NO_ROUTES',                                              'NO_ROUTE'],
      ['Rota bulunamadı (code=NoRoute)',                         'NO_ROUTE'],
      ['Rota bulunamadı (code=NoSegment)',                       'NO_ROUTE'],
      ['EMPTY_GEOMETRY',                                         'EMPTY_GEOMETRY'],
      ['geometry_normalize_failed: 1 point(s) after normalize',  'MALFORMED_GEOMETRY'],
      ['ROUTE_ORIGIN_TOO_FAR: first point 2500m from GPS',       'MALFORMED_GEOMETRY'],
      ['INVALID_COORDS: origin lat=NaN',                         'MALFORMED_GEOMETRY'],
    ];
    for (const [msg, want] of cases) {
      expect(classifyRouteError(msg), `"${msg}" yanlış sınıflandı`).toBe(want);
    }
  });

  it('abort sinyalleri ZAMAN AŞIMI sayılır (ağ hatası DEĞİL)', () => {
    expect(classifyRouteError('AbortError')).toBe('TIMEOUT');
    expect(classifyRouteError('TimeoutError: signal timed out')).toBe('TIMEOUT');
  });

  it('tanınmayan / boş hata ağ hatasına düşer (varsayım BELGELİ)', () => {
    expect(classifyRouteError('')).toBe('NETWORK_ERROR');
    expect(classifyRouteError(null)).toBe('NETWORK_ERROR');
    expect(classifyRouteError('Failed to fetch')).toBe('NETWORK_ERROR');
  });

  it('ulaşma tanımı: sağlayıcı KONUŞTUYSA ulaşılmıştır', () => {
    for (const o of ['SUCCESS', 'NO_ROUTE', 'EMPTY_GEOMETRY',
      'MALFORMED_GEOMETRY', 'VALIDATION_REJECTED', 'HTTP_ERROR'] as const) {
      expect(wasRouteProviderReached(o), `${o} ulaşma sayılmadı`).toBe(true);
    }
    for (const o of ['TIMEOUT', 'NETWORK_ERROR', 'STALE',
      'SKIPPED_OFFLINE', 'UNAVAILABLE', 'NOT_ATTEMPTED'] as const) {
      expect(wasRouteProviderReached(o), `${o} yanlışlıkla ulaşma sayıldı`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) ZİNCİR HÜKMÜ — BİRİNCİL Mİ, YEDEK Mİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-10 › zincir hükmü', () => {
  it('ilk denenen katman cevaplarsa BİRİNCİL BAŞARI', () => {
    const c = summarizeRouteChain([att('REMOTE_OSRM', 'SUCCESS', 'srv-a')]);
    expect(c.outcome).toBe('PRIMARY_SUCCESS');
    expect(c.winner).toBe('REMOTE_OSRM');
    expect(c.fallbackReason).toBeNull();
    expect(c.degradedSteps).toBe(0);
  });

  it('birincil düşüp yedek kurtarırsa GİZLİ DEGRADASYON raporlanır', () => {
    const c = summarizeRouteChain([
      att('REMOTE_OSRM', 'TIMEOUT', 'srv-a'),
      att('REMOTE_OSRM', 'SUCCESS', 'srv-b'),
    ]);
    expect(c.outcome).toBe('FALLBACK_SUCCESS');
    expect(c.fallbackReason).toBe('TIMEOUT');
    expect(c.degradedSteps).toBe(1);
    expect(c.winnerLabel).toBe('srv-b');
    expect(c.why).toContain('DEGRADASYON');
  });

  it('DÜZ HAT "başarı" SAYILMAZ — ayrı hüküm sınıfıdır', () => {
    /* Düz hat bir sağlayıcı bile değildir; ona rota muamelesi yapmak
       sürücüye rota olmadığı hâlde rota varmış gibi göstermektir. */
    const c = summarizeRouteChain([
      att('REMOTE_OSRM', 'TIMEOUT', 'srv-a'),
      att('OFFLINE_GRAPH', 'UNAVAILABLE', 'offline-graph'),
      att('STRAIGHT_LINE', 'NO_ROUTE', 'straight-line'),
    ]);
    expect(c.outcome).toBe('DEGRADED_STRAIGHT_LINE');
    expect(c.winner).toBeNull();
    expect(c.fallbackReason).toBe('TIMEOUT');
    expect(c.why).toContain('rota DEĞİLDİR');
  });

  it('ATLANMIŞ katman DEGRADASYON sayılmaz (yanlış alarm yok)', () => {
    /* Çevrimdışıyken uzak sağlayıcı "düşmedi" — zaten denenmedi. Onu
       degradasyon saymak, uçak modunda her rotayı arızalı göstermek olurdu. */
    const c = summarizeRouteChain([
      att('LOCAL_DAEMON', 'UNAVAILABLE', 'localhost:5000'),
      att('REMOTE_OSRM', 'SKIPPED_OFFLINE', null),
      att('OFFLINE_GRAPH', 'SUCCESS', 'offline-graph'),
    ]);
    expect(c.outcome).toBe('PRIMARY_SUCCESS');
    expect(c.degradedSteps).toBe(0);
    expect(c.winner).toBe('OFFLINE_GRAPH');
  });

  it('hiçbir katman üretemezse ve düz hat da yoksa ALL_FAILED', () => {
    const c = summarizeRouteChain([
      att('REMOTE_OSRM', 'HTTP_ERROR', 'srv-a'),
      att('OFFLINE_GRAPH', 'EMPTY_GEOMETRY', 'offline-graph'),
    ]);
    expect(c.outcome).toBe('ALL_FAILED');
    expect(c.fallbackReason).toBe('HTTP_ERROR');
  });

  it('deneme bildirilmediyse hüküm UNKNOWN', () => {
    expect(summarizeRouteChain([]).outcome).toBe('UNKNOWN');
    expect(summarizeRouteChain([att('REMOTE_OSRM', 'NOT_ATTEMPTED')]).outcome).toBe('UNKNOWN');
  });

  it('NOT_ATTEMPTED bir deneme SAYILMAZ', () => {
    const c = summarizeRouteChain([
      att('LOCAL_DAEMON', 'NOT_ATTEMPTED'),
      att('REMOTE_OSRM', 'SUCCESS', 'srv-a'),
    ]);
    expect(c.attemptedCount).toBe(1);
    expect(c.outcome).toBe('PRIMARY_SUCCESS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) YARIŞ DURUMU — GEÇ GELEN YANIT YENİ ROTAYI EZEMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-10 › yarış durumu', () => {
  it('BAYAT yanıt SUCCESS sayılmaz — zincir kazanansız kalır', () => {
    /* İstek A uçarken istek B başlar; A'nın yanıtı SONRA gelir. `_commitRoute`
       `isCurrentRequest` kapısında onu reddeder ve `STALE` yazılır. Zincir
       hükmü bunu BAŞARI saymamalıdır, yoksa "rota geldi" yalanı üretilir. */
    const c = summarizeRouteChain([
      att('REMOTE_OSRM', 'STALE', 'srv-a'),
    ]);
    expect(c.outcome).not.toBe('PRIMARY_SUCCESS');
    expect(c.outcome).toBe('ALL_FAILED');
    expect(c.winner).toBeNull();
  });

  it('defter, YALNIZ EN SON isteğin zincirinden hüküm türetir', () => {
    /* İki isteğin denemeleri karışırsa "birincil mi yedek mi" sorusu anlamını
       yitirir — eski isteğin düşüşü yeni isteği degrade göstermemelidir. */
    recordRouteAttempt(att('REMOTE_OSRM', 'TIMEOUT', 'srv-a', 1));
    recordRouteAttempt(att('REMOTE_OSRM', 'SUCCESS', 'srv-b', 1));
    recordRouteAttempt(att('REMOTE_OSRM', 'SUCCESS', 'srv-a', 2));

    const led = getRouteProviderLedger();
    expect(led.lastChain.outcome).toBe('PRIMARY_SUCCESS');
    expect(led.lastChain.degradedSteps).toBe(0);
    /* Eski isteğin denemeleri KAYBOLMAZ — yalnız hükme karışmaz. */
    expect(led.attempts.length).toBe(3);
  });

  it('sıra KORUNUR — kazanandan önceki düşüşler sayılır', () => {
    const c = summarizeRouteChain([
      att('LOCAL_DAEMON', 'EMPTY_GEOMETRY', 'localhost:5000'),
      att('REMOTE_OSRM', 'HTTP_ERROR', 'srv-a'),
      att('REMOTE_OSRM', 'SUCCESS', 'srv-b'),
    ]);
    expect(c.degradedSteps).toBe(2);
    expect(c.fallbackReason).toBe('EMPTY_GEOMETRY');   // İLK düşüş
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) DEFTER — BOUNDED · FAIL-SOFT · SAYAÇ KAYBI YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('P0-NAV-10 › defter', () => {
  it('halka sınırlıdır ama TOPLAM sayaç kaybolmaz', () => {
    for (let i = 0; i < ROUTE_ATTEMPT_RING + 10; i++) {
      recordRouteAttempt(att('REMOTE_OSRM', 'TIMEOUT', 'srv-a', 1));
    }
    const led = getRouteProviderLedger();
    expect(led.attempts.length).toBe(ROUTE_ATTEMPT_RING);
    /* Halka taşsa da sayaç gerçek toplamı taşır — aksi hâlde uzun bir
       sürüşte kronik zaman aşımı görünmez olurdu. */
    expect(led.counts['REMOTE_OSRM|TIMEOUT']).toBe(ROUTE_ATTEMPT_RING + 10);
  });

  it('gizli degradasyon sayaçları ayrı tutulur', () => {
    recordRouteChainOutcome('FALLBACK_SUCCESS');
    recordRouteChainOutcome('FALLBACK_SUCCESS');
    recordRouteChainOutcome('DEGRADED_STRAIGHT_LINE');
    recordRouteChainOutcome('PRIMARY_SUCCESS');
    const led = getRouteProviderLedger();
    expect(led.fallbackSuccessCount).toBe(2);
    expect(led.straightLineChainCount).toBe(1);
  });

  it('kayıt yolu THROW ETMEZ (teşhis ürünü düşüremez)', () => {
    expect(() => recordRouteAttempt(
      undefined as unknown as RouteAttempt,
    )).not.toThrow();
    expect(() => recordRouteChainOutcome(
      'BOGUS' as unknown as 'PRIMARY_SUCCESS',
    )).not.toThrow();
  });

  it('boş defterde hüküm UNKNOWN — sahte "sağlıklı" YOK', () => {
    const led = getRouteProviderLedger();
    expect(led.lastChain.outcome).toBe('UNKNOWN');
    expect(led.attempts).toEqual([]);
    expect(led.fallbackSuccessCount).toBe(0);
  });
});
