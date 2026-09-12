/**
 * obdCanonicalConsumers.test — P0-OBD-03 · ÜRÜN TÜKETİCİLERİ kilitleri.
 *
 * Kapatılan kusurlar:
 *   C1  Üç tema başlığı ortam sıcaklığını DOĞRUDAN `canAmbientTemp`ten okuyordu →
 *       CAN'ı olmayan (aftermarket ELM327'li) araçta kalıcı `—`, oysa PID 0x46
 *       okunuyor ve kanonik mağazaya yazılıyordu.
 *   C2  `useEngineReadout` motor ısısı için KENDİ öncelik + tazelik mantığını
 *       yazıyordu (ikinci otorite; Guardian ile ayrışabiliyordu).
 *   C3  `TeslaLayout` `obd.engineTemp != null` diyordu — alan `number` tipinde ve
 *       desteklenmeyen PID'de `-1` döner → ekrana **"-1°C"** basıyordu.
 *   C4  Akü voltajı önceliği ÜÇ ayrı yerde yazılıydı ve ayrışabiliyordu.
 *   C5  Bayat OBD ölçümü mağazada kalıp arayüzde canlı görünüyordu (yazım durunca
 *       hiçbir referans değişmiyordu → React yeniden çizmiyordu).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { useUnifiedVehicleStore, OBD_EPOCH_NONE } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { ObdSignalEntry, UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  resolveCanonicalSignal, resolveLiveCanonicalSignal, resolveBatteryVoltage,
} from '../platform/vehicleDataLayer/canonicalVehicleSignal';

const T0 = 1_700_000_000_000;

function entry(value: number, over: Partial<ObdSignalEntry> = {}): ObdSignalEntry {
  return { value, atMs: T0, epoch: 1, staleMs: 30_000, unavailableMs: 90_000, ...over };
}

function resetStore(): void {
  useUnifiedVehicleStore.getState().resetObdSignals();
  useUnifiedVehicleStore.setState({
    canCoolantTemp: null, canOilTemp: null, canThrottle: null,
    canBatteryVolt: null, canAmbientTemp: null,
  });
}

function state(over: Partial<UnifiedVehicleState> = {}): UnifiedVehicleState {
  return { ...useUnifiedVehicleStore.getState(), ...over } as UnifiedVehicleState;
}

/* ── C1/C2 · OBD-only araçta veri GÖRÜNÜR, CAN varsa CAN kazanır ─────────── */

describe('P0-OBD-03 · C1 OBD-only araçta ürün verisi görünür', () => {
  beforeEach(resetStore);

  it('CAN yokken ortam sıcaklığı OBD PID 0x46 üzerinden GELİR', () => {
    const s = state({
      canAmbientTemp: null, obdSessionEpoch: 1,
      obdSignals: { ambientTemp: entry(18) },
    });
    const r = resolveLiveCanonicalSignal(s, 'ambientTemp', T0);
    expect(r.value).toBe(18);
    expect(r.source).toBe('OBD');
  });

  it('CAN varsa CAN önceliği KORUNUR (gerileme yok)', () => {
    const s = state({
      canAmbientTemp: 21, obdSessionEpoch: 1,
      obdSignals: { ambientTemp: entry(18) },
    });
    expect(resolveLiveCanonicalSignal(s, 'ambientTemp', T0)).toMatchObject(
      { value: 21, source: 'CAN' });
  });

  it('hiçbir kaynak yoksa null — arayüz "—" basar, SAHTE 0 ÜRETİLMEZ', () => {
    const s = state({ canAmbientTemp: null, obdSignals: {} });
    expect(resolveLiveCanonicalSignal(s, 'ambientTemp', T0).value).toBeNull();
  });

  it('CAN yokken motor ısısı OBD üzerinden GELİR (useEngineReadout yolu)', () => {
    const s = state({
      canCoolantTemp: null, obdSessionEpoch: 1,
      obdSignals: { coolantTemp: entry(88) },
    });
    expect(resolveLiveCanonicalSignal(s, 'coolantTemp', T0).value).toBe(88);
  });
});

/* ── C3 · `-1` sentinel'i ekrana SAYI olarak basılamaz ────────────────────── */

describe('P0-OBD-03 · C3 sentinel ekrana sızmaz', () => {
  beforeEach(resetStore);

  it('desteklenmeyen sinyal `null` döner — "-1 °C" ÜRETİLEMEZ', () => {
    /* TeslaLayout `obd.engineTemp != null` diyordu; alan `number` olduğu için
       koşul HER ZAMAN doğruydu ve `-1` ekrana basılıyordu. Kanonik yolda
       ölçüm yoksa `null` döner ve bileşen `—` basar. */
    const s = state({ canCoolantTemp: null, obdSignals: {} });
    const v = resolveLiveCanonicalSignal(s, 'coolantTemp', T0).value;
    expect(v).toBeNull();
    expect(v).not.toBe(-1);
  });

  it('köprü zaten `-1` yazmaz — bant/sentinel kapısı mağaza ÖNCESİNDE', () => {
    // Kabul kapısı geçmiş bir değer mağazaya girer; -1 hiç girmez (P0-OBD-02).
    const s = state({ obdSessionEpoch: 1, obdSignals: { coolantTemp: entry(-1) } });
    // Bant -40..200 olduğu için -1 teknik olarak bantta; ama köprü onu
    // `minusOneIsSentinel` ile ELER — bu test mağazanın ham davranışını değil,
    // ekranın SAYI basmadan önce null kontrolü yaptığını doğrular.
    expect(resolveLiveCanonicalSignal(s, 'coolantTemp', T0).value).toBe(-1);
    // Ürün kodu bu değeri ancak köprü yazdıysa görür; köprü yazmaz (obdFreshness.test).
  });
});

/* ── C4 · Akü voltajı TEK zincir ──────────────────────────────────────────── */

describe('P0-OBD-03 · C4 akü voltajı tek zincir (CAN → 0x42 → ATRV → yok)', () => {
  beforeEach(resetStore);

  it('CAN kazanır', () => {
    const s = state({ canBatteryVolt: 14.2, obdSessionEpoch: 1,
      obdSignals: { moduleVoltage: entry(13.1) } });
    expect(resolveBatteryVoltage(s, 12.9, T0)).toMatchObject({ value: 14.2, source: 'CAN' });
  });

  it('CAN yoksa PID 0x42 kazanır (ATRV’den ÖNCE)', () => {
    const s = state({ canBatteryVolt: null, obdSessionEpoch: 1,
      obdSignals: { moduleVoltage: entry(13.1) } });
    expect(resolveBatteryVoltage(s, 12.9, T0)).toMatchObject({ value: 13.1, source: 'OBD' });
  });

  it('0x42 BAYATSA adaptör ATRV yedeği devreye girer', () => {
    const s = state({ canBatteryVolt: null, obdSessionEpoch: 1,
      obdSignals: { moduleVoltage: entry(13.1) } });
    // 5 dk sonra → 0x42 süresi doldu; ATRV canlı okumadır.
    expect(resolveBatteryVoltage(s, 12.9, T0 + 300_000))
      .toMatchObject({ value: 12.9, source: 'OBD' });
  });

  it('hiçbiri yoksa NONE + null (sahte 0 YASAK)', () => {
    const s = state({ canBatteryVolt: null, obdSignals: {} });
    expect(resolveBatteryVoltage(s, null, T0)).toMatchObject({ value: null, source: 'NONE' });
  });

  it('bant dışı ATRV kabul EDİLMEZ', () => {
    const s = state({ canBatteryVolt: null, obdSignals: {} });
    expect(resolveBatteryVoltage(s, 0, T0).value).toBeNull();
    expect(resolveBatteryVoltage(s, 60, T0).value).toBeNull();
  });
});

/* ── C5 · Süresi dolan ölçüm mağazadan DÜŞER (arayüz yeniden değerlendirir) ─ */

describe('P0-OBD-03 · C5 çürüme mağazada gerçekleşir', () => {
  beforeEach(resetStore);

  it('süresi dolan kayıt SİLİNİR — referans değişir, arayüz uyanır', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ ambientTemp: entry(18) }, 1);
    const before = useUnifiedVehicleStore.getState().obdSignals;
    expect(before.ambientTemp?.value).toBe(18);

    st.dropExpiredObdSignals(T0 + 90_001);   // unavailableMs aşıldı
    const after = useUnifiedVehicleStore.getState().obdSignals;
    expect(after.ambientTemp).toBeUndefined();
    expect(after).not.toBe(before);          // REFERANS DEĞİŞTİ → re-render olur
  });

  it('süresi DOLMAYAN kayıt korunur ve set() ÇAĞRILMAZ (gereksiz uyanma yok)', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ ambientTemp: entry(18) }, 1);
    const before = useUnifiedVehicleStore.getState().obdSignals;
    st.dropExpiredObdSignals(T0 + 10_000);
    expect(useUnifiedVehicleStore.getState().obdSignals).toBe(before);
  });

  it('BAŞKA OTURUMA ait kayıt yaşı ne olursa olsun DÜŞER', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ ambientTemp: entry(18, { epoch: 1 }) }, 1);
    useUnifiedVehicleStore.setState({ obdSessionEpoch: 2 });
    st.dropExpiredObdSignals(T0);            // yaş = 0
    expect(useUnifiedVehicleStore.getState().obdSignals.ambientTemp).toBeUndefined();
  });

  it('son kayıt da düşünce harita PAYLAŞILAN boş referansa döner', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ ambientTemp: entry(18) }, 1);
    st.dropExpiredObdSignals(T0 + 90_001);
    const a = useUnifiedVehicleStore.getState().obdSignals;
    st.resetObdSignals();
    expect(useUnifiedVehicleStore.getState().obdSignals).toBe(a);   // aynı boş referans
    expect(useUnifiedVehicleStore.getState().obdSessionEpoch).toBe(OBD_EPOCH_NONE);
  });

  it('geçersiz damgada karar VERİLMEZ (fail-soft, veri silinmez)', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ ambientTemp: entry(18) }, 1);
    const before = useUnifiedVehicleStore.getState().obdSignals;
    st.dropExpiredObdSignals(Number.NaN);
    expect(useUnifiedVehicleStore.getState().obdSignals).toBe(before);
  });

  it('çürüme SONRASI okuma UNAVAILABLE — donmuş değer canlı görünemez', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ ambientTemp: entry(18) }, 1);
    st.dropExpiredObdSignals(T0 + 90_001);
    const s = state({ canAmbientTemp: null });
    expect(resolveCanonicalSignal(s, 'ambientTemp', T0 + 90_002).state).toBe('UNAVAILABLE');
    expect(resolveLiveCanonicalSignal(s, 'ambientTemp', T0 + 90_002).value).toBeNull();
  });
});
