/**
 * OBD-OS-F0-5 — TEK RECONNECT OTORİTESİ.
 *
 * KÖK NEDEN (native köprü): CarLauncherPlugin.onStatusChanged state'e BAKMADAN her
 * bildirime `reason:"link_lost"` damgası vuruyordu. Native kendi attemptReconnect()'ini
 * yürütürken önce "reconnecting" der → TS bunu KOPMA sanıp paralel bir reconnect turu
 * başlatır (native'in kurmakta olduğu soketi kapatır = çift motor). Daha kötüsü: native
 * reconnect BAŞARILI olduğunda ("connected") bile TS bunu link kaybı sanıp az önce
 * iyileşmiş bağlantıyı yeniden kuruyordu.
 *
 * Bu dosya DAVRANIŞI kilitler (gerçek obdStatus event akışıyla):
 *   native_reconnecting → TS reconnect/disconnect ÇAĞIRMAZ
 *   native_reconnected  → TS otoriteyi geri alır (izlemeye döner)
 *   link_lost           → TS otoritesi (mevcut davranış korunur)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../platform/nativePlugin';
import { startOBD, stopOBD, getOBDStatusSnapshot, getObdReconnectLifecycle } from '../platform/obdService';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

type StatusEvent = { state?: string; reason?: string; reconnectEpoch?: number };
type Listener = (e: StatusEvent) => void;

/** Kayıtlı obdStatus dinleyicisi — testler native event'i buradan "yayınlar". */
let _statusListener: Listener | null = null;

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    isNativePlatform: vi.fn(() => true),
    scanOBD:       vi.fn(async () => ({ devices: [{ name: 'ELM327 BT', address: '00:11:22:33:44:55' }] })),
    connectOBD:    vi.fn(async () => ({ protocol: '6' })),
    disconnectOBD: vi.fn(async () => undefined),
    setPollingInterval: vi.fn(async () => undefined),
    addListener: vi.fn(async (event: string, cb: Listener) => {
      if (event === 'obdStatus') _statusListener = cb;
      return { remove: vi.fn(async () => undefined) };
    }),
  },
}));

/** Native obdStatus event'i yayınlar (plugin köprüsünün ürettiği şekliyle). */
function emitStatus(e: StatusEvent): void {
  _statusListener?.(e);
}

async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('OBD-OS-F0-5 · tek reconnect otoritesi', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    _statusListener = null;
    startOBD('00:11:22:33:44:55');
    await flush();
    vi.mocked(CarLauncher.disconnectOBD).mockClear();
    vi.mocked(CarLauncher.connectOBD).mockClear();
  });
  afterEach(() => {
    stopOBD();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('dinleyici kuruldu (test kablosu sağlam)', () => {
    expect(_statusListener).not.toBeNull();
  });

  it('🔒 KİLİT: native reconnect SÜRERKEN TS paralel tur AÇMAZ', async () => {
    emitStatus({ state: 'reconnecting', reason: 'native_reconnecting' });
    await flush();

    // TS ne soketi kapatır ne yeni bağlantı kurar — otorite native'de.
    expect(CarLauncher.disconnectOBD).not.toHaveBeenCalled();
    expect(CarLauncher.connectOBD).not.toHaveBeenCalled();
    expect(getOBDStatusSnapshot().connectionState).toBe('reconnecting');

    // Backoff turlarını sür: TS'in üstel reconnect zamanlayıcısı çalışmamalı.
    await vi.advanceTimersByTimeAsync(40_000);
    await flush();
    expect(CarLauncher.connectOBD).not.toHaveBeenCalled();
  });

  /* ══════════════════════════════════════════════════════════════════════
     P0-OBD-FINAL-01 — KİLİT BİLİNÇLİ OLARAK GÜNCELLENDİ (kaldırılmadı).
     ══════════════════════════════════════════════════════════════════════
     ESKİ KİLİT: "native reconnect sırasındaki KOPMA bildirimleri TS turu
     başlatmaz" — varsayım, native'in ölü soketi kapatırken ARA bir
     "disconnected" sızdırdığıydı.

     ÖLÇÜM (OBDManager kaynağı): reconnect sırasında hiçbir ara status olayı
     YAYINLANMAZ (`closeStreamsOnly` sessizdir). Reconnect uçuştayken gelen
     "disconnected/link_lost", turun TERMİNAL sonucudur (çağıranın
     `disconnect()` dalı). Eski kilit bu olayı yutuyordu → otorite native'de
     asılı kalıyor, TS yalnız 60 s fail-safe ile uyanıyordu. Sahadaki
     "aynı oturumda tekrar tekrar 60 s timeout" tam olarak buydu.

     YENİ KİLİT: terminal sonuç ANINDA devir teslimdir — 60 s BEKLENMEZ. */
  it('🔒 KİLİT: native reconnect uçuşta iken gelen link_lost TERMİNALDİR — TS 60 s BEKLEMEZ', async () => {
    emitStatus({ state: 'reconnecting', reason: 'native_reconnecting', reconnectEpoch: 1 });
    await flush();

    emitStatus({ state: 'disconnected', reason: 'link_lost' });
    await flush();
    // Yalnız TS'in KENDİ üstel backoff turu kadar ilerle (guard 60 s'e ASLA gelinmez).
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    expect(CarLauncher.connectOBD).toHaveBeenCalled();
    // FAIL-SAFE zamanlayıcısı ATEŞLENMEMİŞ olmalı: sonuç açık olayla geldi.
    expect(getObdReconnectLifecycle().nativeReconnectGuardTimeouts).toBe(0);
    expect(getObdReconnectLifecycle().nativeReconnectInFlight).toBe(false);
  });

  it('🔒 KİLİT: native_reconnect_failed → otorite ANINDA TS\'e döner (60 s ölü pencere YOK)', async () => {
    emitStatus({ state: 'reconnecting', reason: 'native_reconnecting', reconnectEpoch: 1 });
    await flush();
    expect(getObdReconnectLifecycle().nativeReconnectInFlight).toBe(true);

    emitStatus({ state: 'reconnect_failed', reason: 'native_reconnect_failed' });
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    const l = getObdReconnectLifecycle();
    expect(CarLauncher.connectOBD).toHaveBeenCalled();
    expect(l.nativeReconnectInFlight).toBe(false);
    expect(l.nativeReconnectFailed).toBe(1);
    expect(l.nativeReconnectGuardTimeouts).toBe(0);   // 0 DIŞINDAKİ her değer KUSURDUR
    expect(l.nativeReconnectLastOutcome).toBe('failed');
  });

  it('otorite künyesi ÖLÇÜLÜR: tur / başarı sayaçları ve tur kimliği', async () => {
    emitStatus({ state: 'reconnecting', reason: 'native_reconnecting', reconnectEpoch: 7 });
    await flush();
    emitStatus({ state: 'connected', reason: 'native_reconnected' });
    await flush();

    const l = getObdReconnectLifecycle();
    expect(l.nativeReconnectRounds).toBe(1);
    expect(l.nativeReconnectRecovered).toBe(1);
    expect(l.nativeReconnectEpoch).toBe(7);
    expect(l.nativeReconnectLastOutcome).toBe('recovered');
  });

  it('native reconnect BAŞARILI → otorite TS\'e döner, bağlantı YENİDEN KURULMAZ', async () => {
    emitStatus({ state: 'reconnecting', reason: 'native_reconnecting' });
    await flush();
    emitStatus({ state: 'connected', reason: 'native_reconnected' });
    await flush();

    // "connected" bir KOPMA DEĞİLDİR — TS az önce iyileşen bağlantıyı yeniden kurmamalı.
    expect(CarLauncher.connectOBD).not.toHaveBeenCalled();
    expect(CarLauncher.disconnectOBD).not.toHaveBeenCalled();
  });

  it('GERÇEK kopma (link_lost, native turu yokken) → TS otoritesi reconnect eder', async () => {
    emitStatus({ state: 'disconnected', reason: 'link_lost' });
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);   // üstel backoff ilk turu (2s)
    await flush();

    expect(CarLauncher.connectOBD).toHaveBeenCalled();   // mevcut davranış KORUNDU
  });

  it('FAIL-SAFE: native sonuç bildirmezse otorite TS\'e geri döner (sonsuz askıda kalmaz)', async () => {
    emitStatus({ state: 'reconnecting', reason: 'native_reconnecting' });
    await flush();

    // 60 sn guard + TS backoff turu
    await vi.advanceTimersByTimeAsync(70_000);
    await flush();

    expect(CarLauncher.connectOBD).toHaveBeenCalled();   // TS devraldı
  });
});
