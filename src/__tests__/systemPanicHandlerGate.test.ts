/**
 * systemPanicHandlerGate — E-34 kilidi.
 *
 * DENETİM BULGUSU (docs/ENVANTER_BAGLANTI_DENETIMI_2026-08-12.md · E-34):
 * `initPanicHandler()` yazılmıştı ama ürün yolunda ÇAĞIRANI YOKTU → sahada
 * çöken cihazdan geriye tanı verisi kalmıyordu. Bağlarken iki YENİ risk doğdu
 * ve bu dosya ikisini de kilitler:
 *
 *   1. FIRTINA: `window.onerror` saniyede onlarca kez tetiklenebilir; her
 *      tetikte 6 store serialize edilip diske yazılırsa düşük-uçlu head unit
 *      donar — panik yakalayıcı paniğin KENDİSİ olur.
 *   2. ÇİFT KURULUM: ikinci `initPanicHandler()` kendi hook'unun üzerine yazar
 *      ve `_prevOnError` zinciri kendini çağırır (sonsuz özyineleme).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── Mock'lar — panik yakalayıcı store/depo grafiğinin TAMAMINA dokunur ─────── */

const _setRawImmediate = vi.fn(async () => {});
let _eventHandler: ((e: unknown) => void) | null = null;

vi.mock('../utils/safeStorage', () => ({
  safeSetRawImmediate: (...a: unknown[]) => _setRawImmediate(...(a as [])),
  safeGetRaw: () => null,
}));
vi.mock('../platform/vehicleDataLayer', () => ({
  onVehicleEvent: (fn: (e: unknown) => void) => { _eventHandler = fn; return () => { _eventHandler = null; }; },
  useUnifiedVehicleStore: { getState: () => ({ speed: 0 }) },
}));
vi.mock('../store/useStore',          () => ({ useStore:          { getState: () => ({}) } }));
vi.mock('../store/useSystemStore',    () => ({ useSystemStore:    { getState: () => ({}) } }));
vi.mock('../store/useCognitiveStore', () => ({ useCognitiveStore: { getState: () => ({}) } }));
vi.mock('../store/useSafetyStore',    () => ({ useSafetyStore:    { getState: () => ({}) } }));
vi.mock('../platform/navigationService', () => ({ getNavigationState: () => ({}) }));

describe('E-34 · panik yakalayıcı fırtına kapısı', () => {
  beforeEach(() => {
    vi.resetModules();
    _setRawImmediate.mockClear();
    _eventHandler = null;
  });

  it('🔒 pencere içindeki İKİNCİ tetik diske YAZMAZ ama SAYILIR', async () => {
    const m = await import('../platform/system/SystemPanicHandler');

    await m.capturePanicSnapshot('window.onerror: ilk');
    await m.capturePanicSnapshot('window.onerror: türev');
    await m.capturePanicSnapshot('window.onerror: türev2');

    expect(_setRawImmediate, 'fırtına kapısı yok — her hatada disk yazımı cihazı kilitler')
      .toHaveBeenCalledTimes(1);

    const st = m.getPanicHandlerStatus();
    expect(st.captureCount).toBe(1);
    expect(st.suppressedCount, 'bastırılan tetikler sessizce yutuluyor').toBe(2);
  });

  it('🔒 İLK hata kazanır (kök neden), sonrakiler onu EZMEZ', async () => {
    const m = await import('../platform/system/SystemPanicHandler');

    await m.capturePanicSnapshot('ui_freeze:8s');
    await m.capturePanicSnapshot('window.onerror: türev');

    /* Sebep sınıfı ilk yazılanı gösterir — leading-edge kapısının kanıtı. */
    expect(m.getPanicHandlerStatus().lastReasonKind).toBe('UI_FREEZE');
  });

  it('🔒 sebep SINIFI taşınır, ham mesaj DEĞİL (gizlilik)', async () => {
    const m = await import('../platform/system/SystemPanicHandler');
    await m.capturePanicSnapshot('unhandledrejection: kullanici@ornek.com reddetti');

    const st = m.getPanicHandlerStatus();
    expect(st.lastReasonKind).toBe('UNHANDLED_REJECTION');
    expect(JSON.stringify(st), 'ham sebep metni gözlem yüzeyine sızmış')
      .not.toContain('ornek.com');
  });

  it('🔒 hiç snapshot yoksa sebep NULL kalır (sahte varsayılan YOK)', async () => {
    const m = await import('../platform/system/SystemPanicHandler');
    const st = m.getPanicHandlerStatus();
    expect(st.lastReasonKind).toBeNull();
    expect(st.captureCount).toBe(0);
    expect(st.installed).toBe(false);
  });
});

describe('E-34 · kurulum idempotenttir', () => {
  beforeEach(() => { vi.resetModules(); _eventHandler = null; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('🔒 ikinci kurulum hook zincirini SARMALAMAZ (özyineleme yok)', async () => {
    const m = await import('../platform/system/SystemPanicHandler');

    const stop1 = m.initPanicHandler();
    const afterFirst = window.onerror;
    const stop2 = m.initPanicHandler();

    expect(window.onerror, 'ikinci kurulum hook üzerine yazdı — özyineleme riski')
      .toBe(afterFirst);
    expect(m.getPanicHandlerStatus().installed).toBe(true);

    stop2();  // no-op olmalı: sahibi ilk kurulumdur
    expect(m.getPanicHandlerStatus().installed, 'sahte cleanup gerçek kurulumu düşürdü')
      .toBe(true);

    stop1();
    expect(m.getPanicHandlerStatus().installed).toBe(false);
  });

  it('🔒 cleanup olay aboneliğini ve halka tamponunu bırakır', async () => {
    const m = await import('../platform/system/SystemPanicHandler');

    const stop = m.initPanicHandler();
    expect(_eventHandler, 'olay aboneliği kurulmadı — snapshot olay geçmişi BOŞ kalır')
      .not.toBeNull();

    _eventHandler?.({ type: 'TEST' });
    expect(m.getPanicHandlerStatus().ringSize).toBe(1);

    stop();
    expect(_eventHandler).toBeNull();
    expect(m.getPanicHandlerStatus().ringSize).toBe(0);
  });
});
