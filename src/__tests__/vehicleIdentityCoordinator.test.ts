/**
 * vehicleIdentityCoordinator.test.ts — TEK YAYIN OTORİTESİ KİLİTLERİ.
 *
 * Kilitlenen davranışlar:
 *   · kanıtsız gözlem SUNUCUYA GİTMEZ
 *   · aynı kimlik TEKRAR GÖNDERİLMEZ (dedupe) — 3 Hz telemetri tick'i yayın yapmaz
 *   · ağ hatası → backoff'lu retry, BÜTÇE SINIRLI (sonsuz retry YOK)
 *   · çakışma AĞ HATASI DEĞİL → retry YAPILMAZ
 *   · `stop()` sonrası gelen yanıt durumu DEĞİŞTİRMEZ (zero-leak + generation guard)
 *   · sunucu onayı yoksa `VERIFIED` DENMEZ
 */

import { describe, it, expect, vi } from 'vitest';
import {
  VehicleIdentityCoordinator,
  MAX_PUBLISH_ATTEMPTS,
  PUBLISH_BACKOFF_MS,
  IDENTITY_STALE_AFTER_MS,
  type IdentityCoordinatorDeps,
} from '../platform/telemetry/vehicleIdentityCoordinator';
import type { IdentityAck } from '../platform/telemetry/vehicleIdentityReport';
import type { BuildIdentityInput } from '../platform/telemetry/vehicleIdentityObservation';

const NOW = 1_700_000_000_000;
const VIN = 'WVWZZZ1JZ3W386752';
const VIN2 = 'WVWZZZ1KZAW123456';
const FP = 'a1b2c3d4e5f6a7b8';

/** Sahte zamanlayıcı — elle ilerletilir (gerçek timer YOK). */
function makeHarness(acks: Array<IdentityAck | null>) {
  const published: unknown[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let now = NOW;
  let i = 0;

  const deps: IdentityCoordinatorDeps = {
    publish: async (obs) => {
      published.push({ vin: obs.vin, hash: obs.fingerprintHash, proto: obs.activeProtocol });
      const ack = acks[Math.min(i, acks.length - 1)];
      i += 1;
      return ack;
    },
    now: () => now,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    clearTimer: (h) => { const idx = h as number; if (timers[idx]) timers[idx].ms = -1; },
  };

  return {
    deps, published, timers,
    setNow: (v: number) => { now = v; },
    /** Bekleyen ilk canlı timer'ı ateşle. */
    fire: () => {
      const t = timers.find((x) => x.ms >= 0);
      if (t) { t.ms = -1; t.fn(); }
    },
    coord: new VehicleIdentityCoordinator(deps),
  };
}

const ok = (over: Partial<IdentityAck> = {}): IdentityAck => ({
  state: 'CREATED', conflict: false, identityConfidence: 0.7,
  reason: null, identityRevision: 1, ...over,
});

function input(over: Partial<BuildIdentityInput> = {}): BuildIdentityInput {
  return {
    nowMs: NOW,
    vid: { vin: VIN, make: 'VW', model: 'Golf', modelYear: 2019,
           activeProtocol: 'CAN', transportVerified: true },
    fingerprint: { hash: FP, confidence: 0.7 },
    ...over,
  };
}

/** Mikrotask kuyruğunu boşalt (queueMicrotask + await zinciri). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('koordinatör · kanıt kapısı', () => {
  it('1. 🔒 kanıtsız gözlem SUNUCUYA GİTMEZ', async () => {
    const h = makeHarness([ok()]);
    h.coord.observe({ nowMs: NOW });
    await flush();
    expect(h.published).toHaveLength(0);
    const s = h.coord.getSnapshot();
    expect(s.publisherState).toBe('SKIPPED');
    expect(s.lastRejection).toBe('NO_EVIDENCE');
  });

  it('2. 🔒 yalnız protokol varsa GİTMEZ', async () => {
    const h = makeHarness([ok()]);
    h.coord.observe({ nowMs: NOW, vid: { activeProtocol: 'CAN', transportVerified: true } });
    await flush();
    expect(h.published).toHaveLength(0);
    expect(h.coord.getSnapshot().lastRejection).toBe('PROTOCOL_UNVERIFIED');
  });

  it('3. 🔒 kanıt varsa TEK kez gönderilir', async () => {
    const h = makeHarness([ok()]);
    h.coord.observe(input());
    await flush();
    expect(h.published).toHaveLength(1);
    expect(h.coord.getSnapshot().publisherState).toBe('PUBLISHED');
    expect(h.coord.getSnapshot().publishedCount).toBe(1);
  });
});

describe('koordinatör · dedupe (3 Hz tick koruması)', () => {
  it('4. 🔒 aynı kimlik 50 kez bildirilse TEK yayın olur', async () => {
    const h = makeHarness([ok()]);
    for (let n = 0; n < 50; n += 1) {
      h.coord.observe(input());
      await flush();
    }
    expect(h.published).toHaveLength(1);
    expect(h.coord.getSnapshot().dedupeSkipCount).toBe(49);
  });

  it('5. 🔒 yalnız confidence oynarsa yayın YAPILMAZ', async () => {
    const h = makeHarness([ok()]);
    h.coord.observe(input());
    await flush();
    h.coord.observe(input({ fingerprint: { hash: FP, confidence: 0.95 } }));
    await flush();
    expect(h.published).toHaveLength(1);
  });

  it('6. 🔒 GERÇEK kimlik değişimi yeni yayın TETİKLER', async () => {
    const h = makeHarness([ok(), ok({ state: 'PROTOCOL_CHANGED', identityRevision: 2 })]);
    h.coord.observe(input());
    await flush();
    h.coord.observe(input({
      vid: { vin: VIN, make: 'VW', model: 'Golf', modelYear: 2019,
             activeProtocol: 'KWP', transportVerified: true },
    }));
    await flush();
    expect(h.published).toHaveLength(2);
    expect(h.coord.getSnapshot().identityRevision).toBe(2);
  });
});

describe('koordinatör · retry ve bütçe', () => {
  it('7. 🔒 ağ hatası → backoff timer kurulur, RETRY_WAIT', async () => {
    const h = makeHarness([null, ok()]);
    h.coord.observe(input());
    await flush();
    const s = h.coord.getSnapshot();
    expect(s.publisherState).toBe('RETRY_WAIT');
    expect(s.retryCount).toBe(1);
    expect(s.lastFailureAtMs).toBe(NOW);
    expect(h.timers[0].ms).toBe(PUBLISH_BACKOFF_MS[0]);
  });

  it('8. 🔒 retry başarılı olunca PUBLISHED', async () => {
    const h = makeHarness([null, ok()]);
    h.coord.observe(input());
    await flush();
    h.fire();
    await flush();
    expect(h.published).toHaveLength(2);
    expect(h.coord.getSnapshot().publisherState).toBe('PUBLISHED');
  });

  it('9. 🔒 SONSUZ RETRY YOK — bütçe tükenince FAILED', async () => {
    const h = makeHarness([null, null, null, null, null, null]);
    h.coord.observe(input());
    await flush();
    for (let n = 0; n < MAX_PUBLISH_ATTEMPTS + 2; n += 1) { h.fire(); await flush(); }
    const s = h.coord.getSnapshot();
    expect(s.publisherState).toBe('FAILED');
    expect(h.published.length).toBe(MAX_PUBLISH_ATTEMPTS);
    // Kanıtsız başarı iddiası YOK.
    expect(s.status).toBe('PENDING');
  });

  it('10. 🔒 backoff basamakları ARTAN', async () => {
    const h = makeHarness([null, null, null, null]);
    h.coord.observe(input());
    await flush();
    const delays: number[] = [h.timers[0].ms];
    h.fire(); await flush();
    delays.push(h.timers[1].ms);
    h.fire(); await flush();
    delays.push(h.timers[2].ms);
    expect(delays).toEqual([...PUBLISH_BACKOFF_MS]);
  });

  it('11. 🔒 yeni kimlik gelirse deneme bütçesi SIFIRLANIR', async () => {
    const h = makeHarness([null, ok()]);
    h.coord.observe(input());
    await flush();
    expect(h.coord.getSnapshot().attemptCount).toBe(1);
    h.coord.observe(input({ vid: { vin: VIN2, transportVerified: true } }));
    await flush();
    expect(h.coord.getSnapshot().attemptCount).toBe(1);   // sıfırlandı, sonra 1'e çıktı
    expect(h.published).toHaveLength(2);
  });

  it('12. 🔒 fırlatan yayıncı da hata sayılır (fail-soft)', async () => {
    const h = makeHarness([ok()]);
    const boom: IdentityCoordinatorDeps = {
      ...h.deps,
      publish: async () => { throw new Error('ağ patladı'); },
    };
    const c = new VehicleIdentityCoordinator(boom);
    expect(() => c.observe(input())).not.toThrow();
    await flush();
    expect(c.getSnapshot().publisherState).toBe('RETRY_WAIT');
  });
});

describe('koordinatör · çakışma', () => {
  const conflictAck = ok({
    state: 'IDENTITY_CONFLICT', conflict: true,
    identityConfidence: 0.3, reason: 'VIN_MISMATCH', identityRevision: 2,
  });

  it('13. 🔒 çakışma CONFLICT durumuna geçer ve sayaç artar', async () => {
    const h = makeHarness([conflictAck]);
    h.coord.observe(input());
    await flush();
    const s = h.coord.getSnapshot();
    expect(s.publisherState).toBe('CONFLICT');
    expect(s.status).toBe('CONFLICT');
    expect(s.conflictCount).toBe(1);
    expect(s.lastConflictReason).toBe('VIN_MISMATCH');
    expect(s.lastAckConfidence).toBe(0.3);
  });

  it('14. 🔒 çakışma AĞ HATASI DEĞİL → retry YAPILMAZ', async () => {
    const h = makeHarness([conflictAck]);
    h.coord.observe(input());
    await flush();
    expect(h.coord.getSnapshot().retryCount).toBe(0);
    expect(h.timers.filter((t) => t.ms >= 0)).toHaveLength(0);
  });

  it('15. 🔒 çakışan kimlik TEKRAR TEKRAR gönderilmez (sonsuz döngü yok)', async () => {
    const h = makeHarness([conflictAck]);
    for (let n = 0; n < 20; n += 1) { h.coord.observe(input()); await flush(); }
    expect(h.published).toHaveLength(1);
  });

  it('16. 🔒 çakışmada sunucu YANITLADI → lastSuccessAtMs damgalanır', async () => {
    const h = makeHarness([conflictAck]);
    h.coord.observe(input());
    await flush();
    expect(h.coord.getSnapshot().lastSuccessAtMs).toBe(NOW);
    expect(h.coord.getSnapshot().lastFailureAtMs).toBeNull();
  });
});

describe('koordinatör · durum dürüstlüğü', () => {
  it('17. 🔒 sunucu onayı YOKSA VERIFIED DENMEZ', async () => {
    const h = makeHarness([null]);
    h.coord.observe(input());
    await flush();
    expect(h.coord.getSnapshot().status).toBe('PENDING');
  });

  it('18. 🔒 onaydan sonra VERIFIED', async () => {
    const h = makeHarness([ok()]);
    h.coord.observe(input());
    await flush();
    expect(h.coord.getSnapshot().status).toBe('VERIFIED');
  });

  it('19. 🔒 gözlem bayatlarsa STALE', async () => {
    const h = makeHarness([ok()]);
    h.coord.observe(input());
    await flush();
    h.setNow(NOW + IDENTITY_STALE_AFTER_MS + 1);
    expect(h.coord.getSnapshot().status).toBe('STALE');
  });

  it('20. 🔒 kanıtsız gözlem UNKNOWN kalır', () => {
    const h = makeHarness([ok()]);
    h.coord.observe({ nowMs: NOW });
    expect(h.coord.getSnapshot().status).toBe('UNKNOWN');
  });

  it('21. 🔒 hiç gözlem yoksa boş anlık görüntü (uydurma değer YOK)', () => {
    const h = makeHarness([ok()]);
    const s = h.coord.getSnapshot();
    expect(s.status).toBe('UNKNOWN');
    expect(s.publisherState).toBe('IDLE');
    expect(s.observation).toBeNull();
    expect(s.lastSuccessAtMs).toBeNull();
    expect(s.lastFailureAtMs).toBeNull();
    expect(s.identityRevision).toBeNull();
  });
});

describe('koordinatör · yaşam döngüsü (zero-leak)', () => {
  it('22. 🔒 stop() sonrası observe HİÇBİR ŞEY yapmaz', async () => {
    const h = makeHarness([ok()]);
    h.coord.stop();
    h.coord.observe(input());
    await flush();
    expect(h.published).toHaveLength(0);
    expect(h.coord.getSnapshot().publisherState).toBe('STOPPED');
  });

  it('23. 🔒 stop() bekleyen retry timer\'ını TEMİZLER', async () => {
    const h = makeHarness([null]);
    h.coord.observe(input());
    await flush();
    expect(h.timers.some((t) => t.ms >= 0)).toBe(true);
    h.coord.stop();
    expect(h.timers.some((t) => t.ms >= 0)).toBe(false);
  });

  it('24. 🔒 stop() SONRASI gelen yanıt durumu DEĞİŞTİRMEZ (generation guard)', async () => {
    let release: ((v: IdentityAck | null) => void) | null = null;
    const h = makeHarness([ok()]);
    const slow: IdentityCoordinatorDeps = {
      ...h.deps,
      publish: () => new Promise<IdentityAck | null>((r) => { release = r; }),
    };
    const c = new VehicleIdentityCoordinator(slow);
    c.observe(input());
    await flush();
    c.stop();
    release?.(ok());          // yanıt kapanmadan SONRA geldi
    await flush();
    expect(c.getSnapshot().publisherState).toBe('STOPPED');
    expect(c.getSnapshot().publishedCount).toBe(0);
  });

  it('25. 🔒 RESTART: yeni koordinatör TEMİZ başlar (durum sızmaz)', async () => {
    const h1 = makeHarness([ok()]);
    h1.coord.observe(input());
    await flush();
    expect(h1.coord.getSnapshot().publishedCount).toBe(1);

    const h2 = makeHarness([ok()]);
    expect(h2.coord.getSnapshot().publishedCount).toBe(0);
    // Restart sonrası aynı kimlik YENİDEN yayınlanır (yeni süreç, dedupe hafızası yok).
    h2.coord.observe(input());
    await flush();
    expect(h2.published).toHaveLength(1);
  });
});

describe('koordinatör · single-flight ve reconnect', () => {
  it('26. 🔒 uçuşta çağrı varken ikinci yayın BAŞLATILMAZ', async () => {
    let release: ((v: IdentityAck | null) => void) | null = null;
    const h = makeHarness([ok()]);
    const slow: IdentityCoordinatorDeps = {
      ...h.deps,
      publish: (obs) => {
        h.published.push({ vin: obs.vin, hash: obs.fingerprintHash, proto: obs.activeProtocol });
        return new Promise<IdentityAck | null>((r) => { release = r; });
      },
    };
    const c = new VehicleIdentityCoordinator(slow);
    c.observe(input());
    await flush();
    expect(h.published).toHaveLength(1);
    // Uçuş sırasında YENİ kimlik gelir → beklemeye alınır, ikinci çağrı AÇILMAZ.
    c.observe(input({ vid: { vin: VIN2, transportVerified: true } }));
    await flush();
    expect(h.published).toHaveLength(1);
    // İlk yanıt gelince bekleyen yayınlanır.
    release?.(ok());
    await flush();
    expect(h.published).toHaveLength(2);
  });

  it('27. 🔒 RECONNECT: aynı kimlik yeniden bildirilse yayın YAPILMAZ', async () => {
    const h = makeHarness([ok()]);
    h.coord.observe(input());
    await flush();
    // Kopma → yeniden bağlanma: aynı VID/parmak izi tekrar gelir.
    h.coord.observe(input({ nowMs: NOW + 60_000 }));
    await flush();
    expect(h.published).toHaveLength(1);
  });

  it('28. 🔒 retry beklerken DAHA YENİ kimlik gelirse O yayınlanır', async () => {
    const h = makeHarness([null, ok()]);
    h.coord.observe(input());
    await flush();
    h.coord.observe(input({ vid: { vin: VIN2, transportVerified: true } }));
    await flush();
    // Yeni kimlik bütçeyi sıfırlayıp hemen gönderildi.
    expect(h.published.length).toBeGreaterThanOrEqual(2);
    expect((h.published[h.published.length - 1] as { vin: string }).vin).toBe(VIN2);
  });
});

describe('koordinatör · tek otorite yapısal kilidi', () => {
  /**
   * Bu test koordinatörde GERÇEK bir açık buldu: `_doPublish` async yolunda
   * üst düzey muhafız yoktu, bu yüzden `now()`/durum hesabı fırlarsa
   * YAKALANMAYAN PROMISE REDDİ oluşuyor ve `_inFlight` sonsuza dek `true`
   * kalıyordu (yayın kalıcı olarak susuyordu). `_guardedPublish` eklendi.
   */
  it('29. 🔒 async yayın yolu ASLA yakalanmayan red üretmez', async () => {
    const h = makeHarness([ok()]);
    const broken: IdentityCoordinatorDeps = {
      ...h.deps,
      now: () => { throw new Error('saat patladı'); },
    };
    const c = new VehicleIdentityCoordinator(broken);
    expect(() => c.observe(input())).not.toThrow();
    await flush();
    expect(() => c.getSnapshot()).not.toThrow();
    // Uçuş kilidi serbest bırakıldı → sonraki kimlik hâlâ denenebilir.
    expect(c.getSnapshot().publisherState).toBe('FAILED');
  });

  it('30. 🔒 observe() SENKRON döner — abonelik yolunda ağ beklenmez', () => {
    const h = makeHarness([ok()]);
    const spy = vi.fn(h.deps.publish);
    const c = new VehicleIdentityCoordinator({ ...h.deps, publish: spy });
    c.observe(input());
    // Aynı tick'te yayın BAŞLAMAMIŞ olmalı (mikrotask'a atıldı).
    expect(spy).not.toHaveBeenCalled();
  });
});
