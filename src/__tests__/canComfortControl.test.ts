/**
 * canComfortControl — konfor komutu YALNIZ aracın yankısıyla "yapıldı" der (sahte ACK yok).
 * Araç, store'a yankı yazan sahte native ile taklit edilir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const native = vi.hoisted(() => ({
  setCanComfortSetting: vi.fn(),
  requestCanData: vi.fn(),
  getCanAccess: vi.fn(),
}));
vi.mock('../platform/bridge', () => ({ isNative: true, bridge: {} }));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: native }));

import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  executeComfortCommand, executeComfortCommands, answerCanVehicleInfo, tiresSpeech, tripSpeech, doorsSpeech,
  climateSpeech, massageStrengthTarget, ambientBrightnessTarget, ECHO_TIMEOUT_MS,
} from '../platform/vehicleDataLayer/canComfortControl';
import { evidenceFromVehicleState, reconcileObservation } from '../platform/capability/observation/observationContract';
import { isObservationSource } from '../platform/capability/observation/observationLedger';
import { findByLegacyIntent } from '../platform/capability/fabric/carosCapabilityCatalog';
import { decodeTpms, decodeDriveMode } from '../platform/vehicleDataLayer/raiseRenaultFrames';
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
  native.getCanAccess.mockReset();
  native.getCanAccess.mockResolvedValue(undefined);       // erişim bilinmiyor → eski davranış
});

const access = (full: boolean) => ({
  readLogs: full, canappDebug: full ? 1 : 0, rawTap: full, rawFrames: full ? 40 : 0,
  nwdProfile: '{"carBandKey":"carband_renault","carTypeKey":"cartype_renault_megane"}', nwdMenus: '',
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
  it('"mavi yap, şiddetini artır" → renk 3 + parlaklık 60, ikisi de yankıyla', async () => {
    store().updateCanExtras({ ambient: ambient({ colorIndex: 1, brightness: 50 }) });
    carEchoes();
    const r = await executeComfortCommand({ target: 'ambient', color: 3, level: '+' });
    expect(native.setCanComfortSetting.mock.calls.map((c) => c[0])).toEqual([
      { id: 0x18, value: 3 }, { id: 0x19, value: 60 },
    ]);
    expect(r).toEqual({ status: 'succeeded', text: 'Ambiyans mavi, parlaklık yüzde 60.' });
  });

  it('kapalıyken renk istenirse önce açar', async () => {
    store().updateCanExtras({ ambient: ambient({ on: false, colorIndex: 0 }) });
    carEchoes();
    const r = await executeComfortCommand({ target: 'ambient', color: 1 });
    expect(native.setCanComfortSetting.mock.calls.map((c) => c[0])).toEqual([
      { id: 0x15, value: 1 }, { id: 0x18, value: 1 },
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
    const r = await executeComfortCommand({ target: 'ambient', unavailable: 'color', colorName: 'pembe' });
    expect(r.text).toBe('Ambiyansta pembe yok. Beyaz, yeşil, kırmızı, mavi, mor, turuncu, turkuaz ve sarı seçebilirim.');
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

describe('çoklu konfor komutu', () => {
  it('"masajı aç ve ambiyansı mavi yap" → sırayla, her parça kendi cümlesiyle', async () => {
    store().updateCanExtras({ massage: massage({ driverOn: false }), ambient: ambient({ colorIndex: 1 }) });
    carEchoes();
    const r = await executeComfortCommands([{ target: 'massage', power: 'on' }, { target: 'ambient', color: 3 }]);
    expect(native.setCanComfortSetting.mock.calls.map((c) => c[0])).toEqual([
      { id: 0x90, value: 1 }, { id: 0x18, value: 3 },
    ]);
    expect(r).toEqual({ status: 'succeeded', text: 'Koltuk masajı açıldı: tonik mod, şiddet 4. Ambiyans rengi mavi.' });
  });

  it('bir parça onaylanmazsa bütün "yapıldı" SAYILMAZ (en zayıf durum)', async () => {
    vi.useFakeTimers();
    store().updateCanExtras({ massage: massage({ driverOn: false }), ambient: ambient({ on: true }) });
    native.setCanComfortSetting.mockImplementation(async ({ id }: { id: number }) => {
      const a = store().canAmbient;
      if (id === 0x15 && a) store().updateCanExtras({ ambient: { ...a, on: false, atMs: Date.now() } });
      return { sent: true };                       // masaj yankısı YOK
    });
    const p = executeComfortCommands([{ target: 'massage', power: 'on' }, { target: 'ambient', power: 'off' }]);
    await vi.advanceTimersByTimeAsync(ECHO_TIMEOUT_MS + 200);
    const r = await p;
    expect(r.status).toBe('unconfirmed');
    expect(r.text).toBe('Masaj komutunu gönderdim ama araç onaylamadı. Ambiyans kapatıldı.');
  });
});

describe('gözlem: aracın yankısı bağımsız kanıttır', () => {
  it('yankı → OBSERVED (VEHICLE_STATE); yankısız gönderim → ACCEPTED; gönderilemedi → FAILED', () => {
    const def = findByLegacyIntent('VEHICLE_COMFORT')!;
    expect(def.capabilityId).toBe('vehicle.comfort');
    expect(def.exposedToBrain).toBe(false);                 // beyin öneremez
    const rec = (base: 'EXECUTED' | 'ACCEPTED' | 'FAILED', e: Parameters<typeof evidenceFromVehicleState>[0]) =>
      reconcileObservation({ base, evidence: evidenceFromVehicleState(e), ceiling: def.observationCeiling });
    expect(rec('EXECUTED', 'ECHO_CONFIRMED')).toMatchObject({ level: 'OBSERVED', source: 'VEHICLE_STATE' });
    expect(rec('ACCEPTED', 'SENT_NO_ECHO').level).toBe('ACCEPTED');
    expect(rec('FAILED', 'NOT_SENT').level).toBe('FAILED');
    expect(isObservationSource('VEHICLE_STATE')).toBe(true);
  });
});

describe('erişim seviyesi', () => {
  it('TEMEL mod: komut iletilir, yankı BEKLENMEZ, kurulum dürüstçe söylenir', async () => {
    native.getCanAccess.mockResolvedValue(access(false));
    native.setCanComfortSetting.mockResolvedValue({ sent: true });
    const r = await executeComfortCommand({ target: 'massage', power: 'on' });   // sahte zamanlayıcı YOK → beklemiyor
    expect(native.setCanComfortSetting).toHaveBeenCalledWith({ id: 0x90, value: 1 });
    expect(r.status).toBe('unconfirmed');
    expect(r.text).toBe('Masaj komutunu araca ilettim. Sonucu görebilmem için bir kerelik araç bağlantısı kurulumu gerekiyor.');
  });

  it('TAM mod + çerçeve akıyor + masaj bilgisi hiç gelmiyor → "görünmüyor", YAZMA YOK', async () => {
    vi.useFakeTimers();
    native.getCanAccess.mockResolvedValue(access(true));
    const p = executeComfortCommand({ target: 'massage', power: 'on' });
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await p;
    expect(r.status).toBe('unsupported');
    expect(r.text).toMatch(/koltuk masajı görünmüyor/);
    expect(native.setCanComfortSetting).not.toHaveBeenCalled();
  });

  it('TEMEL modda lastik sorusu → kurulum gerekiyor (sahte "veri yok" değil)', async () => {
    native.getCanAccess.mockResolvedValue(access(false));
    expect(await answerCanVehicleInfo('tires'))
      .toBe('Lastik basıncını okuyabilmem için bir kerelik araç bağlantısı kurulumu gerekiyor.');
    expect(native.requestCanData).not.toHaveBeenCalled();
  });
});

describe('bayat CAN akışı', () => {
  const silent = { ...access(true), sdkAgeMs: 90_000, rawAgeMs: 90_000 };

  it('akış sustuysa "zaten açık" denmez: eski durum yok sayılır, komut iletilir, dürüst ek', async () => {
    vi.useFakeTimers();
    native.getCanAccess.mockResolvedValue(silent);
    store().updateCanExtras({ massage: massage({ driverOn: true, atMs: Date.now() - 60_000 }) });   // eski değer
    native.setCanComfortSetting.mockResolvedValue({ sent: true });
    const p = executeComfortCommand({ target: 'massage', power: 'on' });
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await p;
    expect(native.setCanComfortSetting).toHaveBeenCalledWith({ id: 0x90, value: 1 });
    expect(r).toEqual({ status: 'unconfirmed', text: 'Masaj komutunu araca ilettim. Araçtan şu an veri gelmiyor; sonucu göremiyorum.' });
  });

  it('kapı sorusu bayat akışta "son bilinen" diye etiketlenir', async () => {
    native.getCanAccess.mockResolvedValue(silent);
    store().updateCanExtras({ doors: { frontLeft: false, frontRight: false, rearLeft: false, rearRight: false, trunk: true } });
    expect(await answerCanVehicleInfo('doors')).toBe('Araçtan bir süredir veri gelmiyor. Son bilinen: bagaj açık.');
  });
});

describe('Multi-Sense sürüş modu (saha 2026-10-03, Megane IV)', () => {
  const profile = (versionKey: string) => ({
    readLogs: true, canappDebug: 1, rawTap: true, rawFrames: 40,
    nwdProfile: JSON.stringify({ carBandKey: 'carband_renault', carTypeKey: 'cartype_renault_megane', carVersionKey: versionKey }),
    nwdMenus: '',
  });

  it('modu söyler; değiştirme isteğinde dürüst cevap + şu anki mod, araca YAZMAZ', async () => {
    native.getCanAccess.mockResolvedValue(profile('carversion_renault_megana_2015_15_now_h'));
    store().updateCanExtras({ driveMode: decodeDriveMode([0x00, 0x02], Date.now()) ?? undefined });
    expect(await answerCanVehicleInfo('drive_mode')).toBe('Şu an Sport moddasın.');
    expect(await answerCanVehicleInfo('drive_mode_set'))
      .toBe('Sürüş modunu ben değiştiremem; aracın Multi-Sense düğmesini kullan. Şu an Sport moddasın.');
    expect(native.setCanComfortSetting).not.toHaveBeenCalled();
  });

  it('anlamı kanıtlanmamış araçta (Duster) mod UYDURULMAZ', async () => {
    native.getCanAccess.mockResolvedValue(profile('carversion_dacia_duster_2018_now'));
    store().updateCanExtras({ driveMode: decodeDriveMode([0x00, 0x00], Date.now()) ?? undefined });
    expect(await answerCanVehicleInfo('drive_mode')).toBe('Sürüş modunu araçtan okuyamıyorum.');
  });

  it('kod çözücü: saha değerleri → ad; bilinmeyen değer → ad yok', () => {
    expect([5, 4, 2, 1, 0].map((v) => decodeDriveMode([0, v], 1)?.name)).toEqual(['Eco', 'Perso', 'Sport', 'Comfort', 'Neutral']);
    expect(decodeDriveMode([0, 3], 1)?.name).toBeNull();
  });
});
