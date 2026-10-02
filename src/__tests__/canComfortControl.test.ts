/**
 * canComfortControl — konfor komutu YALNIZ aracın yankısıyla "yapıldı" der (sahte ACK yok).
 * Araç, store'a yankı yazan sahte native ile taklit edilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const native = vi.hoisted(() => ({
  setCanComfortSetting: vi.fn(),
  requestCanData: vi.fn(),
}));
vi.mock('../platform/bridge', () => ({ isNative: true, bridge: {} }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: native }));

import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  executeComfortCommand, answerCanVehicleInfo, tiresSpeech, tripSpeech, doorsSpeech, climateSpeech,
  massageStrengthTarget, ambientBrightnessTarget, ECHO_TIMEOUT_MS,
} from '../platform/vehicleDataLayer/canComfortControl';
import { decodeTpms } from '../platform/vehicleDataLayer/raiseRenaultFrames';
import type { CanAmbientState, CanMassageState } from '../platform/vehicleDataLayer/raiseRenaultFrames';

const store = () => useUnifiedVehicleStore.getState();
const massage = (m: Partial<CanMassageState>): CanMassageState => ({
  driverOn: false, mode: 2, strength: 3, speed: 5, passengerOn: false, atMs: Date.now(), ...m,
});
const ambient = (a: Partial<CanAmbientState>): CanAmbientState => ({
  on: true, front: true, rear: true, colorIndex: 1, brightness: 50, atMs: Date.now(), ...a,
});

/** Aracı taklit eder: yazılan ayarı store'a yankı olarak geri yazar. */
function carEchoes(): void {
  native.setCanComfortSetting.mockImplementation(async ({ id, value }: { id: number; value: number }) => {
    const m = store().canMassage, a = store().canAmbient;
    if (id === 0x90 && m) store().updateCanExtras({ massage: { ...m, driverOn: value === 1, atMs: Date.now() } });
    if (id === 0x92 && m) store().updateCanExtras({ massage: { ...m, strength: value, atMs: Date.now() } });
    if (id === 0x15 && a) store().updateCanExtras({ ambient: { ...a, on: value === 1, atMs: Date.now() } });
    if (id === 0x18 && a) store().updateCanExtras({ ambient: { ...a, colorIndex: value, atMs: Date.now() } });
    if (id === 0x19 && a) store().updateCanExtras({ ambient: { ...a, brightness: value, atMs: Date.now() } });
    return { sent: true };
  });
}

beforeEach(() => {
  store().resetCanData();
  native.setCanComfortSetting.mockReset();
  native.requestCanData.mockReset();
  native.requestCanData.mockResolvedValue({ sent: true });
});
afterEach(() => { vi.useRealTimers(); });

describe('masaj', () => {
  it('"masajı aç" → yankı gelince "açıldı" (mod + şiddet aracın bildirdiği)', async () => {
    store().updateCanExtras({ massage: massage({ driverOn: false }) });
    carEchoes();
    const r = await executeComfortCommand({ target: 'massage', power: 'on' });
    expect(native.setCanComfortSetting).toHaveBeenCalledWith({ id: 0x90, value: 1 });
    expect(r).toEqual({ status: 'succeeded', text: 'Koltuk masajı açıldı: tonik mod, şiddet 4.' });
  });

  it('zaten açıksa yazmaz, dürüstçe söyler', async () => {
    store().updateCanExtras({ massage: massage({ driverOn: true }) });
    const r = await executeComfortCommand({ target: 'massage', power: 'on' });
    expect(native.setCanComfortSetting).not.toHaveBeenCalled();
    expect(r.status).toBe('already');
  });

  it('kapalıyken "şiddeti artır" → önce açar, sonra bir kademe artırır', async () => {
    store().updateCanExtras({ massage: massage({ driverOn: false, strength: 1 }) });
    carEchoes();
    const r = await executeComfortCommand({ target: 'massage', level: '+' });
    expect(native.setCanComfortSetting.mock.calls.map((c) => c[0])).toEqual([
      { id: 0x90, value: 1 }, { id: 0x92, value: 2 },
    ]);
    expect(r).toEqual({ status: 'succeeded', text: 'Koltuk masajı açıldı: tonik mod, şiddet 3.' });
  });

  it('yankı GELMEZSE "açıldı" DENMEZ', async () => {
    vi.useFakeTimers();
    store().updateCanExtras({ massage: massage({ driverOn: false }) });
    native.setCanComfortSetting.mockResolvedValue({ sent: true });     // araç sessiz
    const p = executeComfortCommand({ target: 'massage', power: 'on' });
    await vi.advanceTimersByTimeAsync(ECHO_TIMEOUT_MS + 100);
    const r = await p;
    expect(r.status).toBe('unconfirmed');
    expect(r.text).not.toMatch(/açıldı/);
  });

  it('şu anki şiddet okunamıyorsa göreli komut UYDURULMAZ', async () => {
    vi.useFakeTimers();
    store().updateCanExtras({ massage: massage({ driverOn: true, strength: null }) });
    const p = executeComfortCommand({ target: 'massage', level: '+' });
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await p;
    expect(r.status).toBe('unknown_state');
    expect(native.setCanComfortSetting).not.toHaveBeenCalled();
  });

  it('hız sesle ayarlanmaz — dürüst cevap, yazma yok', async () => {
    const r = await executeComfortCommand({ target: 'massage', unavailable: 'massage_speed' });
    expect(r.status).toBe('unsupported');
    expect(native.setCanComfortSetting).not.toHaveBeenCalled();
  });
});

describe('ambiyans', () => {
  it('"mavi yap, şiddetini artır" → renk 2 + parlaklık 60, ikisi de yankıyla', async () => {
    store().updateCanExtras({ ambient: ambient({ colorIndex: 1, brightness: 50 }) });
    carEchoes();
    const r = await executeComfortCommand({ target: 'ambient', color: 2, level: '+' });
    expect(native.setCanComfortSetting.mock.calls.map((c) => c[0])).toEqual([
      { id: 0x18, value: 2 }, { id: 0x19, value: 60 },
    ]);
    expect(r).toEqual({ status: 'succeeded', text: 'Ambiyans mavi, parlaklık yüzde 60.' });
  });

  it('kapalıyken renk istenirse önce açar', async () => {
    store().updateCanExtras({ ambient: ambient({ on: false, colorIndex: 0 }) });
    carEchoes();
    const r = await executeComfortCommand({ target: 'ambient', color: 6 });
    expect(native.setCanComfortSetting.mock.calls.map((c) => c[0])).toEqual([
      { id: 0x15, value: 1 }, { id: 0x18, value: 6 },
    ]);
    expect(r.text).toBe('Ambiyans açıldı: yeşil, parlaklık yüzde 50.');
  });

  it('native gönderemezse "ulaşamıyorum"', async () => {
    store().updateCanExtras({ ambient: ambient({ on: true }) });
    native.setCanComfortSetting.mockRejectedValue(new Error('UNIMPLEMENTED'));
    const r = await executeComfortCommand({ target: 'ambient', power: 'off' });
    expect(r).toEqual({ status: 'unavailable', text: 'Ambiyansa şu an ulaşamıyorum.' });
  });

  it('araçta olmayan renk → seçenekleri söyler, yazma yok', async () => {
    const r = await executeComfortCommand({ target: 'ambient', unavailable: 'color', colorName: 'sari' });
    expect(r.text).toBe('Ambiyansta sarı yok. Beyaz, kırmızı, mavi, turuncu, mor, gri, yeşil ve turkuaz seçebilirim.');
    expect(native.setCanComfortSetting).not.toHaveBeenCalled();
  });
});

describe('seviye hesabı', () => {
  it('masaj: kullanıcı 1–5 der, kutu 0–4', () => {
    expect(massageStrengthTarget(3, null)).toBe(2);
    expect(massageStrengthTarget(9, null)).toBe(4);
    expect(massageStrengthTarget('+', 4)).toBe(4);
    expect(massageStrengthTarget('-', null)).toBeNull();
  });
  it('ambiyans: 10\'luk adım, 10–100', () => {
    expect(ambientBrightnessTarget(65, null)).toBe(70);
    expect(ambientBrightnessTarget(0, null)).toBe(10);
    expect(ambientBrightnessTarget('+', 95)).toBe(100);
    expect(ambientBrightnessTarget('-', 10)).toBe(10);
  });
});

describe('durum cevapları', () => {
  it('lastik: saha çerçevesi (2,4 / 2,4 / – / 1,9) — ölçülmeyen teker "ölçülmedi"', () => {
    const t = decodeTpms([0x02, 0x4f, 0x4f, 0xff, 0x3f], 1);
    expect(tiresSpeech(t, true)).toBe('Ön sol 2,4, ön sağ 2,4, arka sağ 1,9 bar. Arka sol henüz ölçülmedi.');
    expect(tiresSpeech(t, false)).toMatch(/^Son bildirilen değerler: /);
    expect(tiresSpeech(null, true)).toBe('Lastik basıncı verisi şu an gelmiyor.');
  });

  it('lastik: uyarı yalnız AYNI aksta ≥0,3 bar farkta (ön/arka farkı uyarı değil)', () => {
    const ok = { statusCode: 0, bar: [2.4, 2.4, 2.0, 1.9] as const, atMs: 1 };
    expect(tiresSpeech(ok, true)).not.toMatch(/düşük/);
    const low = { statusCode: 0, bar: [2.4, 2.4, 2.0, 1.6] as const, atMs: 1 };
    expect(tiresSpeech(low, true)).toMatch(/Arka sağ lastik, aynı akstaki diğerinden 0,4 bar düşük/);
  });

  it('yol bilgisayarı / kapı / klima', () => {
    expect(tripSpeech({ avgFuelL100km: 6.1, avgSpeedKmh: 43.3, totalKm: 1590.4, atMs: 1 }))
      .toBe('Yol bilgisayarı: ortalama tüketim 100 kilometrede 6,1 litre, ortalama hız saatte 43 kilometre, toplam 1590 kilometre.');
    expect(doorsSpeech({ frontLeft: true, frontRight: false, rearLeft: false, rearRight: false, trunk: true }))
      .toBe('Ön sol kapı ve bagaj açık.');
    expect(doorsSpeech({ frontLeft: false, frontRight: false, rearLeft: false, rearRight: false, trunk: false }))
      .toBe('Tüm kapılar ve bagaj kapalı.');
    expect(climateSpeech({
      power: true, ac: true, auto: true, dual: false, recirc: false, defrostFront: false, defrostRear: false,
      fanLevel: 3, fanMax: 7, tempDriverC: 22, tempPassengerC: 22,
    })).toBe('Klima açık: otomatik, 22 derece.');
    expect(climateSpeech(null)).toBe('Klima bilgisi şu an gelmiyor.');
  });

  it('lastik sorusu kutudan TAZE değer ister; gelirse etiketsiz söyler', async () => {
    native.requestCanData.mockImplementation(async () => {
      store().updateCanExtras({ tpmsDetail: decodeTpms([0x00, 0x50, 0x50, 0x43, 0x43], Date.now())! });
      return { sent: true };
    });
    const text = await answerCanVehicleInfo('tires');
    expect(native.requestCanData).toHaveBeenCalledWith({ type: 0x61 });
    expect(text).toBe('Ön sol 2,4, ön sağ 2,4, arka sol 2, arka sağ 2 bar.');
  });
});
