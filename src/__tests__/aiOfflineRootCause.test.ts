/**
 * aiOfflineRootCause — "internet var, anahtar geçerli, ama Mavi Offline'a düşüyor"
 * saha hatasının KÖK NEDEN KANITI + regresyon kilidi.
 *
 * SAHA (2026-07-22): ücretli anahtar + aktif internet. Mavi normal konuşuyor,
 * bir süre sonra HİÇBİR kullanıcı işlemi olmadan Offline Mode'a geçiyor; ses
 * kesiliyor, yeni istekler cevapsız. Uygulama yeniden başlatılınca düzeliyor
 * ("yeniden başlatınca düzeliyor" = kusur KALICI DİSKTE değil, MODÜL RAM'inde).
 *
 * Bu dosya iki bağımsız kusuru KİLİTLER:
 *
 *   KUSUR-1 (RATCHET / yarı-açık durum yok):
 *     `_consecFails` yalnız BAŞARI ile sıfırlanıyordu; soğuma penceresi dolunca
 *     sıfırlanmıyordu. Eşik (2) bir kez aşıldıktan sonra sayaç ≥2'de takılı
 *     kalır → sonraki HER TEK hata 90sn'lik tam offline penceresi açar.
 *     Araçta (hücre devri, tünel) tek tük timeout normaldir → asistan pratikte
 *     kalıcı offline olur. Yeniden başlatma sayacı sıfırladığı için "bazen
 *     düzeliyor" hissi doğar.
 *
 *   KUSUR-2 (TEK İSTEK = OFFLINE / yanlış sınıflandırma):
 *     Gateway'in devre kesici portu `NET_FAILURE_KINDS` ile besleniyordu ve bu
 *     küme `server` (5xx) + `rate_limited` (429) İÇERİYORDU. Oysa sunucudan HTTP
 *     yanıtı gelmesi ağın CANLI olduğunun kanıtıdır (gatewayChatBridge'in
 *     NET_DEATH_KINDS sözleşmesi: yalnız network/timeout). Üstelik kesici HER
 *     DENEMEDE besleniyordu: 1 istek × 2 deneme × 2 sağlayıcı = 4 sayım →
 *     TEK BİR 429 kullanıcıyı anında 90sn offline'a kilitliyordu.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  isAiNetHealthy, recordAiNetFailure, recordAiNetSuccess,
  getAiHealthSnapshot, _resetAiHealthForTest,
} from '../platform/aiHealth';
import { createAiGateway } from '../platform/ai/gateway/aiGateway';
import {
  getLastAiOfflineRecord, getAiOfflineHistory, errorKindFromException,
  offlineReasonFromErrorKind, _resetAiOfflineReasonForTest,
} from '../platform/ai/aiOfflineReason';
import type {
  AiErrorKind, AiHealthPort, AiNetworkStatus, AiProvider,
} from '../platform/ai/gateway/types';

/* ── Yardımcı: monotonik saati ileri sarma ─────────────────────────────────── */

let _clock = 0;
function advance(ms: number): void { _clock += ms; }

beforeEach(() => {
  _clock = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => _clock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  _resetAiHealthForTest();
  _resetAiOfflineReasonForTest();
});

/* ── KUSUR-1: ratchet ──────────────────────────────────────────────────────── */

describe('aiHealth — devre kesici yarı-açık (half-open) davranışı', () => {
  it('KİLİT: soğuma penceresi dolunca ardışık hata sayacı SIFIRLANIR', () => {
    recordAiNetFailure();
    recordAiNetFailure();                       // eşik (2) → devre açık
    expect(isAiNetHealthy()).toBe(false);

    advance(90_001);                            // pencere doldu
    expect(isAiNetHealthy()).toBe(true);

    expect(
      getAiHealthSnapshot().consecFails,
      'pencere dolduktan sonra sayaç ≥2 kaldı → sonraki TEK hata 90sn offline açar (ratchet)',
    ).toBe(0);
  });

  it('KİLİT: toparlanmadan sonra TEK ağ hatası devreyi AÇMAZ', () => {
    recordAiNetFailure();
    recordAiNetFailure();
    advance(90_001);
    expect(isAiNetHealthy()).toBe(true);

    recordAiNetFailure();                       // toparlanma sonrası ilk hata
    expect(
      isAiNetHealthy(),
      'tek geçici hata tüm asistanı (STT dahil) yeniden 90sn offline\'a kilitledi',
    ).toBe(true);
  });

  it('eşik korunur: art arda İKİ gerçek ağ hatası devreyi hâlâ açar', () => {
    recordAiNetFailure();
    expect(isAiNetHealthy()).toBe(true);        // tek hata yetmez
    recordAiNetFailure();
    expect(isAiNetHealthy()).toBe(false);       // iki ardışık hata → açık
  });

  it('başarı devreyi kapatır ve sayacı sıfırlar', () => {
    recordAiNetFailure();
    recordAiNetFailure();
    recordAiNetSuccess();
    expect(isAiNetHealthy()).toBe(true);
    expect(getAiHealthSnapshot().consecFails).toBe(0);
  });
});

/* ── KUSUR-2: tek istek = offline ──────────────────────────────────────────── */

function mkProvider(id: string, kind: AiErrorKind, status?: number): AiProvider {
  return {
    id,
    generate: async () => ({
      ok: false as const,
      error: { kind, message: `${id} ${kind}`, retryable: true, ...(status !== undefined ? { status } : {}) },
    }),
  };
}

describe('AI Gateway — devre kesici besleme sözleşmesi', () => {
  it('KİLİT: HTTP yanıtlı hatalar (429/5xx) devre kesiciyi BESLEMEZ', async () => {
    let failures = 0;
    const health: AiHealthPort = {
      isHealthy:     () => true,
      recordSuccess: () => {},
      recordFailure: () => { failures++; },
    };

    const gateway = createAiGateway({
      providers: [mkProvider('p1', 'rate_limited', 429), mkProvider('p2', 'server', 500)],
      health,
      sleep: async () => {},
    });

    const result = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(result.ok).toBe(false);
    expect(
      failures,
      'sunucu YANIT VERDİ (429/5xx) → ağ canlı; kesiciye yazılırsa tek istek 90sn offline yapar',
    ).toBe(0);
  });

  it('KİLİT: gerçek ağ ölümü (network/timeout) İSTEK BAŞINA EN FAZLA BİR KEZ sayılır', async () => {
    let failures = 0;
    const health: AiHealthPort = {
      isHealthy:     () => true,
      recordSuccess: () => {},
      recordFailure: () => { failures++; },
    };

    const gateway = createAiGateway({
      providers: [mkProvider('p1', 'timeout'), mkProvider('p2', 'network')],
      health,
      sleep: async () => {},
    });

    await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(
      failures,
      'her deneme ayrı sayılıyor (2 deneme × 2 sağlayıcı = 4) → tek istek eşiği tek başına aşar',
    ).toBe(1);
  });

  it('kullanıcı iptali (barge-in) kesiciyi BESLEMEZ', async () => {
    let failures = 0;
    const health: AiHealthPort = {
      isHealthy: () => true, recordSuccess: () => {}, recordFailure: () => { failures++; },
    };
    const gateway = createAiGateway({
      providers: [mkProvider('p1', 'aborted')],
      health,
      sleep: async () => {},
    });

    await gateway.generateResponse({ messages: [{ role: 'user', content: 'dur' }] });

    expect(failures, 'barge-in ağ hatası sayıldı → konuşmayı kesen kullanıcı offline\'a düşer').toBe(0);
  });

  it('SAHA SENARYOSU: tek 429 isteği asistanı offline\'a KİLİTLEMEZ', async () => {
    const health: AiHealthPort = {
      isHealthy:     () => isAiNetHealthy(),
      recordSuccess: () => { recordAiNetSuccess(); },
      recordFailure: () => { recordAiNetFailure(); },
    };
    const gateway = createAiGateway({
      providers: [mkProvider('p1', 'rate_limited', 429), mkProvider('p2', 'rate_limited', 429)],
      health,
      sleep: async () => {},
    });

    await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(
      isAiNetHealthy(),
      'ücretli hesapta tek bir 429 → 90sn tam offline (ses kesilir, yeni istekler cevapsız)',
    ).toBe(true);
  });
});

/* ── Düzeltme kuralları: retry · backoff · failover ────────────────────────── */

/** İlk N çağrıda hata, sonrasında başarı üreten sağlayıcı. */
function mkFlakyProvider(
  id: string, failTimes: number, kind: AiErrorKind, status?: number,
): { provider: AiProvider; calls: () => number } {
  let calls = 0;
  return {
    provider: {
      id,
      generate: async () => {
        calls++;
        if (calls <= failTimes) {
          return {
            ok: false as const,
            error: { kind, message: `${id} ${kind}`, retryable: true, ...(status !== undefined ? { status } : {}) },
          };
        }
        return { ok: true as const, text: `${id} yanıtı`, model: 'm', provider: id };
      },
    },
    calls: () => calls,
  };
}

describe('AI Gateway — geçici hatada dayanıklılık', () => {
  it('tek HTTP 500 → AYNI sağlayıcıda yeniden denenir (offline YOK)', async () => {
    const flaky = mkFlakyProvider('p1', 1, 'server', 500);
    const gateway = createAiGateway({
      providers: [flaky.provider],
      health: {
        isHealthy: () => isAiNetHealthy(),
        recordSuccess: () => { recordAiNetSuccess(); },
        recordFailure: () => { recordAiNetFailure(); },
      },
      sleep: async () => {},
    });

    const result = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(result.ok, 'geçici 5xx sonrası tekrar denenmedi').toBe(true);
    expect(flaky.calls()).toBe(2);
    expect(isAiNetHealthy()).toBe(true);
  });

  it('tek HTTP 429 → üstel backoff ile beklenir, sonra başarılı', async () => {
    const waits: number[] = [];
    const flaky = mkFlakyProvider('p1', 1, 'rate_limited', 429);
    const gateway = createAiGateway({
      providers: [flaky.provider],
      sleep: async (ms) => { waits.push(ms); },
    });

    const result = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(result.ok).toBe(true);
    expect(waits, '429 sonrası backoff uygulanmadı').toEqual([400]);
  });

  it('Sağlayıcı A tükendi → Sağlayıcı B\'ye FAILOVER (offline YOK)', async () => {
    const dead    = mkProvider('p1', 'server', 500);
    const healthy = mkFlakyProvider('p2', 0, 'server');
    const gateway = createAiGateway({
      providers: [dead, healthy.provider],
      health: {
        isHealthy: () => isAiNetHealthy(),
        recordSuccess: () => { recordAiNetSuccess(); },
        recordFailure: () => { recordAiNetFailure(); },
      },
      sleep: async () => {},
    });

    const result = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(result.ok, 'sağlıklı ikinci sağlayıcı varken offline\'a düşüldü').toBe(true);
    if (result.ok) expect(result.text).toBe('p2 yanıtı');
    expect(isAiNetHealthy()).toBe(true);
  });

  it('failover BAŞARILI olursa önceki ağ hatası kesiciye YAZILMAZ', async () => {
    let failures = 0;
    const gateway = createAiGateway({
      providers: [mkProvider('p1', 'timeout'), mkFlakyProvider('p2', 0, 'timeout').provider],
      health: { isHealthy: () => true, recordSuccess: () => {}, recordFailure: () => { failures++; } },
      sleep: async () => {},
    });

    const result = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(result.ok).toBe(true);
    expect(failures, 'yedek sağlayıcı cevap verdiği hâlde kesici beslendi').toBe(0);
  });
});

/* ── Gerçek çevrimdışı · otomatik toparlanma ───────────────────────────────── */

describe('Gerçek çevrimdışı ve otomatik dönüş', () => {
  it('uçak modu → istek AĞA ÇIKMADAN `offline` ile reddedilir', async () => {
    let generated = 0;
    const network: AiNetworkStatus = { isOnline: () => false };
    const gateway = createAiGateway({
      providers: [{ id: 'p1', generate: async () => { generated++; return { ok: true as const, text: 'x', model: 'm', provider: 'p1' }; } }],
      network,
      sleep: async () => {},
    });

    const result = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('offline');
    expect(generated, 'cihaz çevrimdışıyken boşuna istek gönderildi').toBe(0);
  });

  it('internet geri gelince istek YENİDEN geçer (kalıcı kilit yok)', async () => {
    let online = false;
    const gateway = createAiGateway({
      providers: [{ id: 'p1', generate: async () => ({ ok: true as const, text: 'döndüm', model: 'm', provider: 'p1' }) }],
      network: { isOnline: () => online },
      sleep: async () => {},
    });

    const offlineResult = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });
    expect(offlineResult.ok).toBe(false);

    online = true;                                  // uçak modu kapandı
    const onlineResult = await gateway.generateResponse({ messages: [{ role: 'user', content: 'selam' }] });
    expect(onlineResult.ok, 'ağ döndüğü hâlde offline kilidi sürüyor').toBe(true);
  });

  it('devre açıkken pencere dolunca kendiliğinden online olunur', async () => {
    recordAiNetFailure();
    recordAiNetFailure();
    expect(isAiNetHealthy()).toBe(false);

    advance(90_001);

    expect(isAiNetHealthy(), 'soğuma dolduğu hâlde offline kaldı').toBe(true);
    expect(getAiHealthSnapshot().blockedForMs).toBe(0);
  });
});

/* ── İZLENEBİLİRLİK: sessiz offline YASAK ──────────────────────────────────── */

describe('OFFLINE_REASON izlenebilirliği', () => {
  it('devre her açıldığında künyeli bir sebep kaydı üretilir', () => {
    recordAiNetFailure({ provider: 'openrouter', exceptionType: 'timeout' });
    recordAiNetFailure({
      provider: 'openrouter', model: 'x/y', requestId: 'ai-7',
      latencyMs: 9012, httpStatus: undefined, exceptionType: 'timeout', retries: 1,
    });

    const rec = getLastAiOfflineRecord();
    expect(rec, 'offline\'a düşüldü ama HİÇBİR sebep kaydı üretilmedi (sessiz offline)').not.toBeNull();
    expect(rec?.reason).toBe('NETWORK_TIMEOUT');
    expect(rec?.provider).toBe('openrouter');
    expect(rec?.model).toBe('x/y');
    expect(rec?.requestId).toBe('ai-7');
    expect(rec?.latencyMs).toBe(9012);
    expect(rec?.retries).toBe(1);
    expect(rec?.blockedForMs).toBe(90_000);
    expect(typeof rec?.timestamp).toBe('string');
  });

  it('kayıt yalnız GEÇİŞTE üretilir (zaten açık devre tekrar yazmaz)', () => {
    recordAiNetFailure({ exceptionType: 'network' });
    recordAiNetFailure({ exceptionType: 'network' });
    expect(getAiOfflineHistory()).toHaveLength(1);

    recordAiNetFailure({ exceptionType: 'network' });   // devre zaten açık
    expect(getAiOfflineHistory(), 'açık devrede tekrar tekrar kayıt üretiliyor (log spam)').toHaveLength(1);
  });

  it('sebep kodu eşlemesi hata sınıfını DOĞRU yansıtır', () => {
    expect(offlineReasonFromErrorKind('timeout')).toBe('NETWORK_TIMEOUT');
    expect(offlineReasonFromErrorKind('network')).toBe('NETWORK_UNREACHABLE');
    expect(offlineReasonFromErrorKind('offline')).toBe('DEVICE_OFFLINE');
    expect(offlineReasonFromErrorKind('rate_limited')).toBe('PROVIDER_RATE_LIMITED');
    expect(offlineReasonFromErrorKind('server')).toBe('PROVIDER_SERVER_ERROR');
    expect(offlineReasonFromErrorKind('auth')).toBe('PROVIDER_AUTH_FAILED');
    expect(offlineReasonFromErrorKind('circuit_open')).toBe('PROVIDER_HEALTH_FAILED');
    expect(offlineReasonFromErrorKind('aborted')).toBe('SESSION_ABORTED');
    expect(offlineReasonFromErrorKind('bilinmeyen')).toBe('UNKNOWN');
  });

  it('exception → hata sınıfı eşlemesi (eski gateway\'siz yollar)', () => {
    const abort = new Error('iptal'); abort.name = 'AbortError';
    expect(errorKindFromException(abort)).toBe('timeout');
    expect(errorKindFromException(new TypeError('Failed to fetch'))).toBe('network');
    expect(errorKindFromException(null)).toBe('unknown');
  });

  it('kayıt halkası SINIRLIDIR (bellek sızıntısı yok)', () => {
    for (let i = 0; i < 60; i++) {
      recordAiNetSuccess();                 // devreyi kapat → sonraki çift yeni geçiş üretir
      recordAiNetFailure({ exceptionType: 'network' });
      recordAiNetFailure({ exceptionType: 'network' });
    }
    expect(getAiOfflineHistory().length).toBeLessThanOrEqual(20);
  });
});
