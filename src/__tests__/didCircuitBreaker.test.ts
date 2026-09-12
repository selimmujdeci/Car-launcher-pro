/**
 * didCircuitBreaker.test.ts — §4 · Üretici DID / CAN ERROR devre kesici DAVRANIŞI.
 *
 * SAHA KUSURU (kütük #142, Dacia Duster): ayarlarda Zoe **EV** profili seçiliyken
 * Duster'da olmayan EV DID'leri sürekli sorgulanıyordu. Her deneme
 * `ATSP7…22xx→CAN ERROR…ATSP6` = 9-10 AT komutu + ~700 ms. `CAN ERROR` bir HAT
 * hatasıdır; `capabilityOutcome` sözleşmesi gereği araç hakkında KANIT DEĞİLDİR →
 * kalıcı kara listeye YAZILAMAZ (kural doğru) → sonsuz tekrar.
 *
 * KİLİTLENEN SÖZLEŞME: oturum kapsamlı, ECU adresi başına devre kesici.
 * Kalıcı yetenek iddiası ÜRETMEZ (zero-trust korunur).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Native `readObdDid` sahtesi — her ECU için ayrı davranış kurulabilir. */
const { calls, behaviour } = vi.hoisted(() => ({
  calls: [] as Array<{ tx: string; did: string }>,
  behaviour: new Map<string, 'can_error' | 'ok' | 'unsupported'>(),
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readObdDid: vi.fn(async (o: { tx: string; rx: string; did: string; service?: string }) => {
      calls.push({ tx: o.tx, did: o.did });
      const mode = behaviour.get(o.tx) ?? 'can_error';
      if (mode === 'can_error') throw new Error('CAN ERROR');
      if (mode === 'unsupported') return { supported: false };
      return { supported: true, data: '0000' };
    }),
  },
}));

// Zamanlayıcı yalnız native platformda kurulur (Mali-400 kuralı) → testte native taklit.
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true } };
});

// Protokol kapısı: testte CAN hattı varmış gibi davran (gerçek export adı).
vi.mock('../platform/obd/activeProtocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/obd/activeProtocol')>();
  return { ...actual, getActiveProtocolClass: () => 'can' };
});

/** Zoe benzeri iki-ECU profili (gerçek saha şekline sadık, 29-bit adresler). */
const _did = (did: string, ecu: string, name: string) => ({
  did, ecu, name, unit: '%', bytes: 2, min: 0, max: 100,
  category: 'test', decode: { fn: 'AB' as const },
});

const PROFILE = {
  id: 'test-ev', brand: 'Test', service: '22',
  source: 'test fixture — didCircuitBreaker.test.ts',
  ecus: [
    { id: 'evc', name: 'EVC', tx: '18DADAF1', rx: '18DAF1DA' },
    { id: 'lbc', name: 'LBC', tx: '18DADBF1', rx: '18DAF1DB' },
  ],
  dids: [
    _did('3064', 'evc', 'Motor Devri'),
    _did('9002', 'lbc', 'SOC'),
    _did('9003', 'lbc', 'SOH'),
  ],
};

type Svc = typeof import('../platform/obd/manufacturerPidService');
let svc: Svc;

/** Zamanlayıcıyı beklemeden N tur döndür (dahili `_tick` timer'a bağlı). */
async function pump(rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(3_000);
  }
}

describe('§4 DID devre kesici — oturum kapsamlı ECU susturma', () => {
  beforeEach(async () => {
    vi.resetModules();
    calls.length = 0;
    behaviour.clear();
    vi.useFakeTimers();
    svc = await import('../platform/obd/manufacturerPidService');
    const r = svc.loadProfile(PROFILE);
    expect(r.ok, `profil yüklenemedi: ${JSON.stringify(r)}`).toBe(true);
  });

  it('sürekli CAN ERROR → ECU bir süre sonra SUSTURULUR (sonsuz tekrar yok)', async () => {
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(40);
    stop();

    const lbcCalls = calls.filter((c) => c.tx === '18DADBF1').length;
    expect(lbcCalls, 'en az bir deneme yapılmalı').toBeGreaterThan(0);
    expect(lbcCalls, 'devre kesici sonsuz tekrarı durdurmalı').toBeLessThanOrEqual(8);
    expect(svc.getMutedEcus()).toContain('18DADBF1');
  });

  it('susturma KALICI kara liste DEĞİL — profil yeniden yüklenince sıfırlanır', async () => {
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(40);
    expect(svc.getMutedEcus()).toContain('18DADBF1');
    stop();

    svc.loadProfile(PROFILE);
    expect(svc.getMutedEcus(), 'yeni oturumda yeniden değerlendirilmeli').toHaveLength(0);
  });

  it('FARKLI ECU etkilenmez — biri susturulunca diğeri sorgulanmaya devam eder', async () => {
    behaviour.set('18DADAF1', 'ok');          // EVC yanıt veriyor
    behaviour.set('18DADBF1', 'can_error');   // LBC hatta yok

    const s1 = svc.watchDid('3064', () => { /* evc */ });
    const s2 = svc.watchDid('9002', () => { /* lbc */ });
    await pump(60);
    s1(); s2();

    expect(svc.getMutedEcus(), 'yalnız hatalı ECU susturulmalı').toEqual(['18DADBF1']);
    const evcAfter = calls.filter((c) => c.tx === '18DADAF1').length;
    expect(evcAfter, 'sağlam ECU sorgulanmaya devam etmeli').toBeGreaterThan(8);
  });

  it('tek BAŞARILI yanıt susturmayı kaldırır (kalıcı ceza yok)', async () => {
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(40);
    expect(svc.getMutedEcus()).toContain('18DADBF1');

    // ECU hatta geri geldi → susturma temizlenmeli. Susturma sorguyu kestiği için
    // yeniden değerlendirme profil yeniden yüklemesiyle olur (oturum sınırı).
    behaviour.set('18DADBF1', 'ok');
    svc.loadProfile(PROFILE);
    const s2 = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(10);
    expect(svc.getMutedEcus(), 'yanıt veren ECU susturulmuş kalmamalı').toHaveLength(0);
    stop(); s2();
  });

  /* ── Yarı-açık (half-open) kurtarma — DENETİM 2026-07-28 ────────────────
   * KUSUR: susturma sorguyu tamamen kesince "başarılı yanıt" hiç gelemezdi →
   * ECU kendini ASLA açamazdı. GEÇİCİ kopma (adaptör resetti/kontak çevrimi)
   * kalıcı sessizliğe dönüşürdü: profil yeniden yüklemesi yalnız AYAR değişince
   * olduğu için pratikte uygulama yeniden başlayana kadar marka DID'i yok. */

  it('YARI-AÇIK: pencere dolunca susturulmuş ECU yeniden YOKLANIR', async () => {
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(10);                                   // 30 sn → susturuldu
    expect(svc.getMutedEcus()).toContain('18DADBF1');
    const atMute = calls.filter((c) => c.tx === '18DADBF1').length;

    await pump(25);                                   // +75 sn → pencere (60 sn) doldu
    stop();
    expect(
      calls.filter((c) => c.tx === '18DADBF1').length,
      'pencere dolunca tek yoklama geçmeli',
    ).toBeGreaterThan(atMute);
  });

  it('YARI-AÇIK yoklama YANIT ALIRSA susturma kalkar — profil yüklemesi GEREKMEZ', async () => {
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(10);
    expect(svc.getMutedEcus()).toContain('18DADBF1');

    behaviour.set('18DADBF1', 'ok');                  // link geri geldi (adaptör yeniden bağlandı)
    await pump(25);                                   // pencere dolar → yoklama → başarı
    stop();
    expect(svc.getMutedEcus(), 'yanıt veren ECU kendini iyileştirmeli').toHaveLength(0);
    expect(svc.getDidValue('9002'), 'değer yeniden akmalı').toBeDefined();
  });

  it('YARI-AÇIK yoklama DÜŞERSE pencere yenilenir — trafik sınırlı kalır', async () => {
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(200);                                  // 600 sn = 10 dk sürekli CAN ERROR
    stop();
    // Sınır kesici olmasa 200 deneme olurdu. Şimdi: 6 (susturmaya kadar) + ~10 yoklama.
    const n = calls.filter((c) => c.tx === '18DADBF1').length;
    expect(n, 'sonsuz tekrar YOK').toBeLessThanOrEqual(6 + 12);
    expect(n, 'tamamen sağır da olmamalı (kurtarma yolu açık)').toBeGreaterThan(6);
    expect(svc.getMutedEcus(), 'düşen yoklama susturmayı sürdürmeli').toContain('18DADBF1');
  });

  it('susturma UYARISI ECU başına BİR kez yazılır (üretimde log seli yok)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* sessiz */ });
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(200);                                  // çok sayıda yeniden susturma
    stop();
    const mutes = warn.mock.calls.filter((c) => String(c[0]).includes('18DADBF1'));
    expect(mutes, 'her yeniden susturmada uyarı yazılmamalı').toHaveLength(1);
    warn.mockRestore();
  });

  it('7F (unsupported) yolu KALICI kalır — devre kesiciyle karışmaz', async () => {
    behaviour.set('18DADBF1', 'unsupported');
    const stop = svc.watchDid('9002', () => { /* izleyici */ });
    await pump(20);
    stop();
    // Araç "bu DID yok" dedi → bu ARAÇ KANITIDIR, kalıcı olarak sorulmaz.
    expect(svc.isDidSupported('9002')).toBe(false);
    // Ama bu bir hat hatası olmadığı için ECU susturulmamalı.
    expect(svc.getMutedEcus()).not.toContain('18DADBF1');
  });
});
