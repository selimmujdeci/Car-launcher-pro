/**
 * speedAlertRuntime.test.ts — Hız uyarısının ARAÇ TARAFI kilitleri.
 *
 * Kilitlenen ölçülen kusurlar (2026-08-14):
 *  · `set_speed_alert` araç tarafında hiç tanımlı değildi → ayar ULAŞMIYORDU
 *    ama telefon "Kaydedildi ✓" diyordu.
 *  · `updateCurrentSpeed` ürün yolunda SIFIR çağırana sahipti → uzaktan
 *    lock/unlock'un "sürüş sırasında reddet" kapısı KÖRDÜ.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const _onOBDData = vi.fn();
vi.mock('../platform/obdService', () => ({
  onOBDData: (fn: unknown) => _onOBDData(fn),
}));

const _store = new Map<string, string>();
vi.mock('../utils/safeStorage', () => ({
  safeGetRaw: (k: string) => _store.get(k) ?? null,
  safeSetRaw: (k: string, v: string) => { _store.set(k, v); },
}));

vi.mock('../platform/debug', () => ({ logInfo: () => {} }));

import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  normalizeSpeedAlertConfig, evaluateSpeedAlert, isDecidableSpeed,
  applySpeedAlertConfig, getSpeedAlertConfig, startSpeedAlertRuntime,
  setSpeedAlertPushChannel, getSpeedAlertEvidence, _resetSpeedAlertForTest,
  INITIAL_SPEED_ALERT_STATE, SPEED_ALERT_COOLDOWN_MS, SPEED_ALERT_HYSTERESIS_KMH,
  type SpeedAlertConfig, type SpeedAlertState,
} from '../platform/speedAlertRuntime';

const CFG: SpeedAlertConfig = { enabled: true, thresholdKmh: 120 };

/* Çalışan runtime'lar test arasında DURDURULUR: abonelikler modül-global kanıt
   defterini besler, kapatılmazsa bir sonraki testin sayaçlarını kirletirler
   (üründe tek runtime vardır; bu yalnız test hijyenidir). */
let _stopRuntime: (() => void) | null = null;
function start(deps: Parameters<typeof startSpeedAlertRuntime>[0] = {}): () => void {
  _stopRuntime = startSpeedAlertRuntime(deps);
  return _stopRuntime;
}

beforeEach(() => {
  _stopRuntime?.();
  _stopRuntime = null;
  _store.clear();
  _resetSpeedAlertForTest();
  useUnifiedVehicleStore.setState({ speed: null, _vehicleSpeedTs: 0 });
  vi.clearAllMocks();
  _onOBDData.mockReturnValue(() => {});
});

afterEach(() => { _stopRuntime?.(); _stopRuntime = null; });

describe('normalizeSpeedAlertConfig — zero-trust', () => {
  it('telefonun gönderdiği biçimi kabul eder', () => {
    expect(normalizeSpeedAlertConfig({ enabled: true, threshold_kmh: 120 }))
      .toEqual({ enabled: true, thresholdKmh: 120 });
  });

  it('KİLİT: aralık dışı / bozuk yapılandırma REDDEDİLİR (ayar sessizce ölmez)', () => {
    expect(normalizeSpeedAlertConfig({ enabled: true, threshold_kmh: 5 })).toBeNull();
    expect(normalizeSpeedAlertConfig({ enabled: true, threshold_kmh: 500 })).toBeNull();
    expect(normalizeSpeedAlertConfig({ enabled: true, threshold_kmh: Number.NaN })).toBeNull();
    expect(normalizeSpeedAlertConfig({ enabled: 'evet', threshold_kmh: 120 })).toBeNull();
    expect(normalizeSpeedAlertConfig({ threshold_kmh: 120 })).toBeNull();
    expect(normalizeSpeedAlertConfig(null)).toBeNull();
    expect(normalizeSpeedAlertConfig('120')).toBeNull();
  });

  it('KİLİT: geçersiz komut mevcut ayarı BOZMAZ', () => {
    expect(applySpeedAlertConfig({ enabled: true, threshold_kmh: 100 })).toBe(true);
    expect(applySpeedAlertConfig({ enabled: false, threshold_kmh: 9999 })).toBe(false);
    // Eski ayar aynen duruyor — bozuk komut uyarıyı kapatamaz.
    expect(getSpeedAlertConfig()).toEqual({ enabled: true, thresholdKmh: 100 });
  });
});

describe('evaluateSpeedAlert — saf karar', () => {
  const S = INITIAL_SPEED_ALERT_STATE;

  it('eşik aşılınca bir kez tetiklenir', () => {
    const d = evaluateSpeedAlert(CFG, S, 125, 1_000);
    expect(d.fire).toBe(true);
    expect(d.state.over).toBe(true);
    expect(d.state.lastFiredAtMs).toBe(1_000);
  });

  it('KİLİT: aşım sürerken cooldown dolmadan TEKRAR tetiklenmez', () => {
    const after: SpeedAlertState = { over: true, lastFiredAtMs: 1_000 };
    expect(evaluateSpeedAlert(CFG, after, 130, 1_000 + 60_000).fire).toBe(false);
    // Cooldown dolunca hatırlatma gelir.
    expect(evaluateSpeedAlert(CFG, after, 130, 1_000 + SPEED_ALERT_COOLDOWN_MS).fire).toBe(true);
  });

  it('KİLİT: histerezis — eşiğin hemen altına inmek aşım durumunu BİTİRMEZ', () => {
    const over: SpeedAlertState = { over: true, lastFiredAtMs: 1_000 };
    // 118 km/h: eşiğin altında ama histerezis bandının içinde → hâlâ "over".
    const a = evaluateSpeedAlert(CFG, over, CFG.thresholdKmh - 2, 2_000);
    expect(a.state.over).toBe(true);
    // Bandın altına inince çıkar.
    const b = evaluateSpeedAlert(CFG, over, CFG.thresholdKmh - SPEED_ALERT_HYSTERESIS_KMH - 1, 2_000);
    expect(b.state.over).toBe(false);
    expect(b.fire).toBe(false);
  });

  it('KİLİT: dur-kalk salınımında bildirim YAĞMURU olmaz', () => {
    let st = INITIAL_SPEED_ALERT_STATE;
    let fires = 0;
    // Eşiğin iki yanında 40 kez salın (histerezis bandının İÇİNDE).
    for (let i = 0; i < 40; i++) {
      const speed = i % 2 === 0 ? 122 : 117;
      const d = evaluateSpeedAlert(CFG, st, speed, 10_000 + i * 1_000);
      st = d.state;
      if (d.fire) fires++;
    }
    expect(fires).toBe(1);
  });

  it('KİLİT: hız bilinmiyorsa hüküm ÜRETİLMEZ ve önceki durum korunur', () => {
    const over: SpeedAlertState = { over: true, lastFiredAtMs: 500 };
    const d = evaluateSpeedAlert(CFG, over, undefined, 9_999_999);
    expect(d.fire).toBe(false);
    expect(d.reason).toBe('speed_unknown');
    expect(d.state).toEqual(over);
    // 0 km/h GEÇERLİ ölçümdür — "bilinmiyor" ile karıştırılmaz.
    expect(isDecidableSpeed(0)).toBe(true);
    expect(isDecidableSpeed(undefined)).toBe(false);
    expect(isDecidableSpeed(Number.NaN)).toBe(false);
  });

  it('kapalıyken tetiklenmez ve durum sıfırlanır', () => {
    const over: SpeedAlertState = { over: true, lastFiredAtMs: 1 };
    const d = evaluateSpeedAlert({ enabled: false, thresholdKmh: 120 }, over, 200, 5_000);
    expect(d.fire).toBe(false);
    expect(d.state).toEqual(INITIAL_SPEED_ALERT_STATE);
  });
});

describe('runtime bağlantısı', () => {
  /** `onOBDData`ya kaydedilen dinleyiciyi yakalar. */
  function capture(): (d: { speed?: number }) => void {
    const fn = _onOBDData.mock.calls[0]?.[0];
    expect(typeof fn).toBe('function');
    return fn as (d: { speed?: number }) => void;
  }

  it('KİLİT: tehlikeli komut kapısı her ölçümde BESLENİR (eskiden hiç beslenmiyordu)', () => {
    const onSpeed = vi.fn();
    start({ onSpeed });
    const listener = capture();

    listener({ speed: 42 });
    /* Değerin YANINDA ölçüm ANI da taşınır: kapıda iki besleyici yarışır
       (füzyon otoritesi + yedek OBD) ve eski damgalı örnek taze örneği
       ezmemelidir. Damgasız beslemek o korumayı imkânsız kılardı. */
    expect(onSpeed).toHaveBeenCalledTimes(1);
    const [speed, atMs] = onSpeed.mock.calls[0] as [number, number];
    expect(speed).toBe(42);
    expect(typeof atMs).toBe('number');
    expect(Number.isFinite(atMs)).toBe(true);
  });

  it('KİLİT: kapı FÜZYON hız otoritesinden de beslenir (OBD dongle olmayan araç)', () => {
    const onSpeed = vi.fn();
    start({ onSpeed });

    // OBD akışına HİÇ dokunulmaz — yalnız füzyon hızı yenilenir.
    useUnifiedVehicleStore.setState({ speed: 61, _vehicleSpeedTs: 1 });

    expect(onSpeed).toHaveBeenCalledTimes(1);
    expect(onSpeed.mock.calls[0]?.[0]).toBe(61);
    expect(getSpeedAlertEvidence().fusedFed).toBe(1);
    expect(getSpeedAlertEvidence().obdFed).toBe(0);
  });

  it('KİLİT: füzyon hızı BİLİNMİYORSA kapıya 0 yazılmaz (sahte "duruyor")', () => {
    const onSpeed = vi.fn();
    start({ onSpeed });

    useUnifiedVehicleStore.setState({ speed: null, _vehicleSpeedTs: 2 });

    expect(onSpeed).not.toHaveBeenCalled();
    expect(getSpeedAlertEvidence().unknownSpeed).toBeGreaterThan(0);
  });

  it('KİLİT: hız DEĞİŞMEYEN yamalar örnek üretmez (sabit hızda gürültü yok)', () => {
    const onSpeed = vi.fn();
    useUnifiedVehicleStore.setState({ speed: 80, _vehicleSpeedTs: 10 });
    start({ onSpeed });

    // Hızla ilgisi olmayan bir yama (ör. GPS/CAN alanı) — damga da aynı.
    useUnifiedVehicleStore.setState({ rpm: 2200 });
    expect(onSpeed).not.toHaveBeenCalled();

    // Aynı DEĞER ama TAZE damga = gerçekten yeni ölçüm → işlenir.
    useUnifiedVehicleStore.setState({ speed: 80, _vehicleSpeedTs: 11 });
    expect(onSpeed).toHaveBeenCalledTimes(1);
  });

  it('KİLİT: araç içi uyarı kanalı bağlıysa SÜRÜCÜ de uyarılır (telefon tek muhatap değil)', () => {
    applySpeedAlertConfig({ enabled: true, threshold_kmh: 100 });
    const push = vi.fn();
    const onDriverAlert = vi.fn();
    setSpeedAlertPushChannel(push);
    start({ onDriverAlert });

    capture()({ speed: 131.4 });

    expect(onDriverAlert).toHaveBeenCalledWith(131, 100);
    expect(push).toHaveBeenCalledTimes(1);      // telefon ucu bozulmadı
    expect(getSpeedAlertEvidence().driverAlerts).toBe(1);
    expect(getSpeedAlertEvidence().driverChannelBound).toBe(true);
  });

  it('KİLİT: araç içi uyarı DÜŞERSE telefon bildirimi yine gider (fail-soft)', () => {
    applySpeedAlertConfig({ enabled: true, threshold_kmh: 100 });
    const push = vi.fn();
    setSpeedAlertPushChannel(push);
    start({ onDriverAlert: () => { throw new Error('HMI down'); } });

    expect(() => capture()({ speed: 150 })).not.toThrow();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('KİLİT: araç içi kanal bağlı DEĞİLSE bu LAB\'da görünür (sessiz körlük yok)', () => {
    start({});
    expect(getSpeedAlertEvidence().driverChannelBound).toBe(false);
  });

  it('KİLİT: hız ölçülmemişse kapıya 0 YAZILMAZ (yanlış "duruyor" iddiası)', () => {
    const onSpeed = vi.fn();
    start({ onSpeed });
    const listener = capture();

    listener({ speed: undefined });
    expect(onSpeed).not.toHaveBeenCalled();
  });

  it('eşik aşımında bildirim kanalı gerçek değerlerle çağrılır', () => {
    applySpeedAlertConfig({ enabled: true, threshold_kmh: 100 });
    const push = vi.fn();
    setSpeedAlertPushChannel(push);
    start({});
    const listener = capture();

    listener({ speed: 118.6 });
    expect(push).toHaveBeenCalledWith('speed_alert', {
      speed_kmh: 119, threshold_kmh: 100,
    });
  });

  it('uyarı kapalıyken bildirim GÖNDERİLMEZ', () => {
    applySpeedAlertConfig({ enabled: false, threshold_kmh: 100 });
    const push = vi.fn();
    setSpeedAlertPushChannel(push);
    start({});
    capture()({ speed: 200 });
    expect(push).not.toHaveBeenCalled();
  });

  it('cleanup aboneliği bırakır (zero-leak)', () => {
    const unsub = vi.fn();
    _onOBDData.mockReturnValue(unsub);
    const stop = start({});
    stop();
    expect(unsub).toHaveBeenCalled();
  });

  it('ayar diskten geri yüklenir (araç yeniden başlasa da uyarı yaşar)', () => {
    applySpeedAlertConfig({ enabled: true, threshold_kmh: 140 });
    _resetSpeedAlertForTest();
    expect(getSpeedAlertConfig()).toBeNull();
    start({});
    expect(getSpeedAlertConfig()).toEqual({ enabled: true, thresholdKmh: 140 });
  });
});
