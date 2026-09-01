/**
 * obdDataBridge.test — P0-OBD-01 · OBD Data Bridge kilitleri.
 *
 * Bu testler ÜÇ ölçülmüş kusurun geri dönmesini engeller:
 *   K1  Okunan OBD sinyalleri `extendedPidService` içinde kalıyor, kanonik
 *       mağazaya HİÇ ulaşmıyordu.
 *   K2  `safetyStateMapper` motor ısısını ve akü voltajını YALNIZ CAN'dan
 *       okuyordu → CAN'ı olmayan araçta Guardian kuralları ÖLÜYDÜ.
 *   K3  İzleme tavanı (16) artan PID numarasıyla doluyordu; karar üreten
 *       sinyaller listeye giremiyor, tele hiç gitmeyecek PID'ler slot harcıyordu.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  CANONICAL_OBD_SIGNALS, CANONICAL_OBD_BY_KEY, CANONICAL_OBD_BY_PID,
  CANONICAL_EXTENDED_PID_ORDER, CANONICAL_CORE_SIGNALS,
  selectPrioritizedExtendedPids,
} from '../platform/obd/canonicalObdSignals';
import { STANDARD_PID_MAP } from '../platform/obd/StandardPidRegistry';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  resolveCanonicalSignal, resolveLiveCanonicalSignal, canonicalSignalChanged,
  CANONICAL_SHARED_SIGNALS,
} from '../platform/vehicleDataLayer/canonicalVehicleSignal';
import {
  createSafetyStateFromVehicleStore, safetyRelevantFieldsChanged,
} from '../platform/safety/safetyStateMapper';
import type { UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  buildSignalRow, buildAuthorityLines, summarizeSignals, formatAge,
} from '../platform/devtools/obdBridgeLabModel';
import type { ObdSignalEntry } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { OBD_EPOCH_NONE } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */

function resetStore(): void {
  useUnifiedVehicleStore.getState().resetObdSignals();
  useUnifiedVehicleStore.setState({
    canCoolantTemp: null, canOilTemp: null, canThrottle: null,
    canBatteryVolt: null, canAmbientTemp: null,
  });
}

/** Mapper testleri için minimal ama GERÇEK şekilli store anlık görüntüsü. */
function vehicleState(over: Partial<UnifiedVehicleState> = {}): UnifiedVehicleState {
  return { ...useUnifiedVehicleStore.getState(), ...over } as UnifiedVehicleState;
}

/** Sabit test damgası — testler `Date.now()`a bağlı OLMAMALI. */
const T0 = 1_700_000_000_000;

/** Taze bir ölçüm kaydı (P0-OBD-02 şekli). */
function entry(value: number, over: Partial<ObdSignalEntry> = {}): ObdSignalEntry {
  return {
    value, atMs: T0, epoch: 1, staleMs: 30_000, unavailableMs: 90_000, ...over,
  };
}

/** OBD ölçümü taşıyan store görüntüsü — epoch varsayılan olarak kayıtlarla UYUMLU. */
function obdState(
  signals: Record<string, ObdSignalEntry>,
  over: Partial<UnifiedVehicleState> = {},
): UnifiedVehicleState {
  return vehicleState({ obdSignals: signals, obdSessionEpoch: 1, ...over } as Partial<UnifiedVehicleState>);
}

/* ── 1. Katalog bütünlüğü (uydurma PID yasağı) ────────────────────────────── */

describe('P0-OBD-01 · katalog bütünlüğü', () => {
  it('her kanonik sinyal StandardPidRegistry\'de TANIMLI bir PID\'e bağlanır (uydurma PID YOK)', () => {
    const missing = CANONICAL_OBD_SIGNALS
      .filter((d) => !STANDARD_PID_MAP.has(d.pid))
      .map((d) => `${d.key}=${d.pid}`);
    expect(missing).toEqual([]);
  });

  it('`core` yolundakiler registry\'de core:true, `extended` yolundakiler core değildir', () => {
    for (const d of CANONICAL_OBD_SIGNALS) {
      const reg = STANDARD_PID_MAP.get(d.pid)!;
      if (d.path === 'core') expect(reg.core, `${d.key} core olmalı`).toBe(true);
      else expect(reg.core ?? false, `${d.key} core OLMAMALI`).toBe(false);
    }
  });

  it('anahtar ve PID tekrarı YOKTUR', () => {
    expect(CANONICAL_OBD_BY_KEY.size).toBe(CANONICAL_OBD_SIGNALS.length);
    expect(CANONICAL_OBD_BY_PID.size).toBe(CANONICAL_OBD_SIGNALS.length);
  });

  it('her sinyalin bir KARARI vardır (8 Kapı — yalnız göstermek için sinyal YOK)', () => {
    for (const d of CANONICAL_OBD_SIGNALS) {
      expect(d.decision.trim().length, `${d.key} decision boş`).toBeGreaterThan(10);
      expect(d.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('hedeflenen ölçek korunur: 4 çekirdek + 30 genişletilmiş sinyal', () => {
    expect(CANONICAL_CORE_SIGNALS.length).toBe(4);
    expect(CANONICAL_EXTENDED_PID_ORDER.length).toBe(30);
  });

  it('GÜVENLİK sinyalleri genişletilmiş öncelik sırasının BAŞINDADIR', () => {
    const ext = CANONICAL_OBD_SIGNALS.filter((d) => d.path === 'extended');
    const firstNonSafety = ext.findIndex((d) => !d.safety);
    const lastSafety = ext.map((d) => d.safety).lastIndexOf(true);
    expect(firstNonSafety).toBeGreaterThan(0);
    expect(lastSafety).toBeLessThan(firstNonSafety);
  });

  it('CAN karşılığı bildirilen her sinyal paylaşılan otorite tablosunda VARDIR', () => {
    const shared = new Set<string>(CANONICAL_SHARED_SIGNALS);
    for (const d of CANONICAL_OBD_SIGNALS) {
      if (d.canField === null) continue;
      // batteryVolt otoritesi `moduleVoltage` anahtarıyla beslenir.
      const expected = d.key === 'moduleVoltage' ? 'batteryVolt' : d.key;
      expect(shared.has(expected), `${d.key} otorite tablosunda yok`).toBe(true);
    }
  });
});

/* ── 2. K3 — slot önceliği ────────────────────────────────────────────────── */

describe('P0-OBD-01 · K3 izleme slotu önceliği', () => {
  const decodable = (hex: string) => {
    const d = STANDARD_PID_MAP.get(hex);
    return d !== undefined && !d.core;
  };
  const CORE = new Set([0x0D, 0x0C, 0x05, 0x2F, 0x11, 0x0F, 0x0B]);

  it('tavan dolduğunda karar üreten sinyaller O2 VOLTAJLARINA yenilmez', () => {
    // Gerçekçi bir benzinli araç bitmap'i: düşük numaralı O2 voltajları (14-1B)
    // DAHİL, yüksek değerli 5C/42/46/5E de destekli.
    const supported = new Set<number>([
      0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11,
      0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1F, 0x21,
      0x2C, 0x2D, 0x2E, 0x2F, 0x31, 0x33, 0x3C, 0x41, 0x42, 0x43, 0x44, 0x45,
      0x46, 0x49, 0x4A, 0x4C, 0x51, 0x52, 0x5A, 0x5C, 0x5E,
    ]);
    const picked = selectPrioritizedExtendedPids(supported, CORE, 16, decodable);

    expect(picked.length).toBe(16);
    // ESKİ DAVRANIŞTA bunlar listeye HİÇ giremiyordu:
    for (const mustHave of ['5C', '42', '46', '01', '3C', '5E']) {
      expect(picked, `${mustHave} öncelikli olmalı`).toContain(mustHave);
    }
    // O2 voltajları (14-1B) katalogda YOK → tavanı tüketemezler.
    for (const o2 of ['14', '15', '16', '17', '18', '19', '1A', '1B']) {
      expect(picked).not.toContain(o2);
    }
  });

  it('registry\'de TANIMSIZ destekli PID slot HARCAMAZ', () => {
    // 0x03 (yakıt sistemi durumu) ve 0x13 (O2 varlığı) bilinçli olarak kayıt DIŞI.
    expect(STANDARD_PID_MAP.has('03')).toBe(false);
    expect(STANDARD_PID_MAP.has('13')).toBe(false);
    const supported = new Set<number>([0x03, 0x13, 0x1D, 0x5C, 0x42]);
    const picked = selectPrioritizedExtendedPids(supported, CORE, 16, decodable);
    expect(picked).toEqual(['5C', '42']);
  });

  it('çekirdek poll PID\'leri ve blok bayrakları ASLA seçilmez', () => {
    const supported = new Set<number>([0x00, 0x20, 0x40, 0x0C, 0x0D, 0x05, 0x2F, 0x5C]);
    const picked = selectPrioritizedExtendedPids(supported, CORE, 16, decodable);
    expect(picked).toEqual(['5C']);
  });

  it('kataloga girmemiş ama destekli PID kuyruğa alınır (eski davranış KAYBOLMAZ)', () => {
    // 0x22 (yakıt ray basıncı) katalogda yok ama registry'de var ve destekli.
    const supported = new Set<number>([0x5C, 0x22]);
    const picked = selectPrioritizedExtendedPids(supported, CORE, 16, decodable);
    expect(picked[0]).toBe('5C');       // katalog önceliği ÖNCE
    expect(picked).toContain('22');     // kalan destekli PID kaybolmaz
  });

  it('kanıtsız (desteklenmeyen) PID sorgulanmaz — fail-closed', () => {
    expect(selectPrioritizedExtendedPids(new Set(), CORE, 16, decodable)).toEqual([]);
  });

  it('tavan AŞILMAZ (ELM327 hattı boğulmaz)', () => {
    const all = new Set<number>(
      [...STANDARD_PID_MAP.keys()].map((h) => parseInt(h, 16)),
    );
    expect(selectPrioritizedExtendedPids(all, CORE, 16, decodable).length).toBe(16);
    expect(selectPrioritizedExtendedPids(all, CORE, 4, decodable).length).toBe(4);
  });
});

/* ── 3. K1 — mağaza yazma sözleşmesi ──────────────────────────────────────── */

describe('P0-OBD-01 · K1 kanonik mağaza', () => {
  beforeEach(resetStore);

  it('okunan sinyal mağazaya ULAŞIR', () => {
    useUnifiedVehicleStore.getState().updateObdSignals(
      { oilTemp: entry(92), moduleVoltage: entry(14.1) }, 1,
    );
    const st = useUnifiedVehicleStore.getState();
    expect(st.obdSignals.oilTemp?.value).toBe(92);
    expect(st.obdSignals.moduleVoltage?.value).toBe(14.1);
    expect(st.obdSignals.oilTemp?.atMs).toBe(T0);
    expect(st.obdSessionEpoch).toBe(1);
  });

  it('sonlu olmayan değer/damga YAZILMAZ (sahte veri kapısı)', () => {
    useUnifiedVehicleStore.getState().updateObdSignals({
      oilTemp:     entry(Number.NaN),
      ambientTemp: entry(20, { atMs: Number.POSITIVE_INFINITY }),
    }, 1);
    const st = useUnifiedVehicleStore.getState();
    expect('oilTemp' in st.obdSignals).toBe(false);
    expect('ambientTemp' in st.obdSignals).toBe(false);
  });

  it('değişmeyen yama YENİ referans ÜRETMEZ (abone uyanmaz)', () => {
    useUnifiedVehicleStore.getState().updateObdSignals({ oilTemp: entry(92) }, 1);
    const before = useUnifiedVehicleStore.getState().obdSignals;
    useUnifiedVehicleStore.getState().updateObdSignals({ oilTemp: entry(92) }, 1);
    expect(useUnifiedVehicleStore.getState().obdSignals).toBe(before);
  });

  it('sıfırlama anahtarları KALDIRIR — 0 YAZMAZ (0 °C bir ÖLÇÜMDÜR)', () => {
    useUnifiedVehicleStore.getState().updateObdSignals({ oilTemp: entry(92) }, 1);
    useUnifiedVehicleStore.getState().resetObdSignals();
    const st = useUnifiedVehicleStore.getState();
    expect(st.obdSignals.oilTemp).toBeUndefined();
    expect(Object.keys(st.obdSignals)).toEqual([]);
    expect(st.obdSessionEpoch).toBe(OBD_EPOCH_NONE);
  });

  it('yayılan harita DONDURULMUŞTUR (tüketici mutasyona uğratamaz)', () => {
    useUnifiedVehicleStore.getState().updateObdSignals({ oilTemp: entry(92) }, 1);
    expect(Object.isFrozen(useUnifiedVehicleStore.getState().obdSignals)).toBe(true);
  });

  /* ── P0-OBD-02 · RECONNECT KAPISI ─────────────────────────────────────── */

  it('OTURUM DEĞİŞİNCE eski ölçümler mağazadan DÜŞER (yaşlarına bakılmaz)', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ oilTemp: entry(92), ambientTemp: entry(18) }, 1);
    expect(Object.keys(useUnifiedVehicleStore.getState().obdSignals).sort())
      .toEqual(['ambientTemp', 'oilTemp']);

    // Yeni oturum, YALNIZ bir sinyal geldi → diğeri MİRAS ALINMAZ.
    st.updateObdSignals({ oilTemp: entry(95, { epoch: 2 }) }, 2);
    const after = useUnifiedVehicleStore.getState();
    expect(Object.keys(after.obdSignals)).toEqual(['oilTemp']);
    expect(after.obdSignals.oilTemp?.value).toBe(95);
    expect(after.obdSessionEpoch).toBe(2);
  });

  it('yeni oturumda GEÇERSİZ tek yama gelse bile eski önbellek DÜŞER (fail-closed)', () => {
    const st = useUnifiedVehicleStore.getState();
    st.updateObdSignals({ oilTemp: entry(92) }, 1);
    st.updateObdSignals({ oilTemp: entry(Number.NaN, { epoch: 2 }) }, 2);
    const after = useUnifiedVehicleStore.getState();
    expect(Object.keys(after.obdSignals)).toEqual([]);
    expect(after.obdSessionEpoch).toBe(2);
  });
});

/* ── 4. Tek kanonik otorite ───────────────────────────────────────────────── */

describe('P0-OBD-01 · tek kanonik otorite (CAN → OBD → yok)', () => {
  beforeEach(resetStore);

  it('CAN varsa CAN kazanır', () => {
    const st = obdState({ coolantTemp: entry(91) }, { canCoolantTemp: 88 });
    expect(resolveCanonicalSignal(st, 'coolantTemp', T0)).toEqual(
      { value: 88, source: 'CAN', state: 'LIVE' });
  });

  it('CAN yoksa OBD devreye girer', () => {
    const st = obdState({ coolantTemp: entry(91) }, { canCoolantTemp: null });
    expect(resolveCanonicalSignal(st, 'coolantTemp', T0)).toEqual(
      { value: 91, source: 'OBD', state: 'LIVE' });
  });

  it('BOZUK CAN değeri geçerli OBD ölçümünü ENGELLEMEZ', () => {
    const st = obdState({ moduleVoltage: entry(13.8) }, { canBatteryVolt: 999 });
    expect(resolveCanonicalSignal(st, 'batteryVolt', T0)).toEqual(
      { value: 13.8, source: 'OBD', state: 'LIVE' });
  });

  it('hiçbir kaynak yoksa null + NONE (sahte 0 YASAK)', () => {
    const st = obdState({});
    for (const sig of CANONICAL_SHARED_SIGNALS) {
      expect(resolveCanonicalSignal(st, sig, T0)).toEqual(
        { value: null, source: 'NONE', state: 'UNAVAILABLE' });
    }
  });

  it('CAN otoriteyken OBD’nin değişmesi SONUCU değiştirmez', () => {
    const a = obdState({ coolantTemp: entry(91) }, { canCoolantTemp: 88 });
    const b = obdState({ coolantTemp: entry(95) }, { canCoolantTemp: 88 });
    expect(canonicalSignalChanged(a, b, 'coolantTemp', T0)).toBe(false);
  });

  it('kaynak değişimi (OBD → CAN) aynı değerde bile DEĞİŞİM sayılır', () => {
    const a = obdState({ coolantTemp: entry(90) }, { canCoolantTemp: null });
    const b = obdState({ coolantTemp: entry(90) }, { canCoolantTemp: 90 });
    expect(canonicalSignalChanged(a, b, 'coolantTemp', T0)).toBe(true);
  });
});

/* ── 5. K2 — Guardian kilidi ──────────────────────────────────────────────── */

describe('P0-OBD-01 · K2 Guardian OBD-only araçta artık KÖR DEĞİL', () => {
  beforeEach(resetStore);

  it('CAN yokken OBD motor ısısı ve modül voltajı safety state’e ULAŞIR', () => {
    const v = obdState(
      { coolantTemp: entry(118), moduleVoltage: entry(11.4) },
      { canCoolantTemp: null, canBatteryVolt: null },
    );
    const { state } = createSafetyStateFromVehicleStore(v, { wallClockMs: T0 });
    expect(state.coolantTemp).toBe(118);
    expect(state.batteryVolt).toBe(11.4);
  });

  it('CAN varsa CAN otoritesi KORUNUR (mevcut davranış bozulmadı)', () => {
    const v = obdState(
      { coolantTemp: entry(118), moduleVoltage: entry(11.4) },
      { canCoolantTemp: 90, canBatteryVolt: 14.2 },
    );
    const { state } = createSafetyStateFromVehicleStore(v, { wallClockMs: T0 });
    expect(state.coolantTemp).toBe(90);
    expect(state.batteryVolt).toBe(14.2);
  });

  it('hiç kaynak yoksa null KALIR — sahte uyarı ÜRETİLMEZ', () => {
    const { state } = createSafetyStateFromVehicleStore(obdState({}), { wallClockMs: T0 });
    expect(state.coolantTemp).toBeNull();
    expect(state.batteryVolt).toBeNull();
  });

  it('OBD ısısının değişmesi safety yeniden-hesabını TETİKLER', () => {
    const prev = obdState({ coolantTemp: entry(90) },  { canCoolantTemp: null });
    const next = obdState({ coolantTemp: entry(120) }, { canCoolantTemp: null });
    expect(safetyRelevantFieldsChanged(next, prev, undefined, T0)).toBe(true);
  });

  it('ilgisiz OBD sinyalinin değişmesi safety hesabını TETİKLEMEZ (K24 bütçesi)', () => {
    const prev = obdState({ engineLoad: entry(30) });
    const next = obdState({ engineLoad: entry(70) });
    expect(safetyRelevantFieldsChanged(next, prev, undefined, T0)).toBe(false);
  });

  /* ── P0-OBD-02 · BAYAT VERİYLE KARAR YASAK ────────────────────────────── */

  it('BAYAT motor ısısı Guardian’a ULAŞMAZ (fail-closed)', () => {
    const v = obdState(
      { coolantTemp: entry(118, { staleMs: 30_000, unavailableMs: 90_000 }) },
      { canCoolantTemp: null },
    );
    // 45 sn → STALE penceresinde; değer GÖSTERİLEBİLİR ama karara GİRMEZ.
    const now = T0 + 45_000;
    expect(resolveCanonicalSignal(v, 'coolantTemp', now).state).toBe('STALE');
    expect(createSafetyStateFromVehicleStore(v, { wallClockMs: now }).state.coolantTemp)
      .toBeNull();
  });

  it('resolveLive… BAYAT okumayı da eler (karar yüzeyi)', () => {
    const v = obdState({ coolantTemp: entry(118) }, { canCoolantTemp: null });
    const now = T0 + 45_000;
    expect(resolveCanonicalSignal(v, 'coolantTemp', now).value).toBe(118);
    expect(resolveLiveCanonicalSignal(v, 'coolantTemp', now).value).toBeNull();
  });

  it('DUVAR SAATİ verilmezse OBD tarafı UNAVAILABLE sayılır (fail-closed)', () => {
    const v = obdState({ coolantTemp: entry(118) }, { canCoolantTemp: null });
    expect(createSafetyStateFromVehicleStore(v).state.coolantTemp).toBeNull();
    // CAN yolu bu kuraldan ETKİLENMEZ — damgası olmayan tek yol o.
    const withCan = obdState({}, { canCoolantTemp: 90 });
    expect(createSafetyStateFromVehicleStore(withCan).state.coolantTemp).toBe(90);
  });

  it('ÖNCEKİ OTURUMUN ölçümü karara GİREMEZ (reconnect kapısı)', () => {
    const v = obdState(
      { coolantTemp: entry(118, { epoch: 1 }) },
      { canCoolantTemp: null, obdSessionEpoch: 2 },
    );
    expect(resolveCanonicalSignal(v, 'coolantTemp', T0).source).toBe('NONE');
    expect(createSafetyStateFromVehicleStore(v, { wallClockMs: T0 }).state.coolantTemp)
      .toBeNull();
  });
});

/* ── 6. LAB modeli — üç durum BİRLEŞTİRİLMEZ ──────────────────────────────── */

describe('P0-OBD-01/02 · LAB modeli dürüstlüğü', () => {
  const base = {
    key: 'oilTemp', pid: '5C', name: 'Motor yağı sıcaklığı', unit: '°C',
    path: 'extended' as const, safety: true, cls: 'medium' as const,
    staleMs: 30_000, unavailableMs: 90_000,
  };
  const obs = (over: Record<string, unknown>) =>
    ({ ...base, value: null, ageMs: null, measuredAtMs: null,
       freshness: 'UNAVAILABLE', freshnessReason: 'no_measurement',
       pidStatus: null, ...over }) as Parameters<typeof buildSignalRow>[0];

  it('taze ölçüm LIVE ve ölçüm + yaş + son güncelleme GÖSTERİLİR', () => {
    const r = buildSignalRow(obs({
      value: 92, ageMs: 3_000, measuredAtMs: T0, freshness: 'LIVE',
      freshnessReason: 'ok', pidStatus: 'live',
    }));
    expect(r.state).toBe('LIVE');
    expect(r.verdict).toBe('OK');
    expect(r.reading).toBe('92 °C');
    expect(r.age).toBe('3 sn');
    expect(r.measuredAtMs).toBe(T0);
    expect(r.window).toBe('30 sn');
  });

  it('eski ölçüm STALE — değer KORUNUR ama uyarı verilir', () => {
    const r = buildSignalRow(obs({
      value: 92, ageMs: 45_000, measuredAtMs: T0, freshness: 'STALE',
      freshnessReason: 'ok', pidStatus: 'live',
    }));
    expect(r.state).toBe('STALE');
    expect(r.verdict).toBe('WARN');
    expect(r.reading).toBe('92 °C');           // değer GİZLENMEZ
    expect(r.why).toContain('KARARA GİRMEZ');  // ama karara girmediği YAZILIR
  });

  it('süresi dolan ölçüm UNAVAILABLE ve değer DÜŞÜRÜLÜR', () => {
    const r = buildSignalRow(obs({
      value: null, ageMs: 300_000, measuredAtMs: T0,
      freshness: 'UNAVAILABLE', freshnessReason: 'expired',
    }));
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.reading).toBe('UNAVAILABLE');
  });

  it('ÖNCEKİ OTURUM ölçümü ayrı gerekçeyle işaretlenir', () => {
    const r = buildSignalRow(obs({
      value: null, freshness: 'UNAVAILABLE', freshnessReason: 'session_changed',
    }));
    expect(r.why).toContain('ÖNCEKİ OBD oturumuna');
    expect(r.verdict).toBe('WARN');   // "veri yok" değil, "geçersizleşti"
  });

  it('araç PID’i tanımıyorsa DESTEKLENMİYOR gerekçesi yazılır', () => {
    const r = buildSignalRow(obs({ pidStatus: 'unsupported' }));
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.why).toContain('TANIMIYOR');
    expect(r.reading).toBe('UNAVAILABLE');
  });

  it('bitmap destekli der ama ECU susuyorsa AYRI gerekçe', () => {
    const r = buildSignalRow(obs({ pidStatus: 'no_data' }));
    expect(r.why).toContain('YANIT VERMİYOR');
    expect(r.verdict).toBe('WARN');
  });

  it('henüz kanıt yoksa SORULUYOR — "yok" DEĞİL', () => {
    const r = buildSignalRow(obs({ pidStatus: 'probing' }));
    expect(r.why).toContain('keşif');
  });

  it('ölçüm yokken sahte 0 ve sahte SAAT basılmaz', () => {
    const r = buildSignalRow(obs({}));
    expect(r.reading).toBe('UNAVAILABLE');
    expect(r.age).toBe('—');
    expect(r.measuredAtMs).toBeNull();
  });

  it('yaş biçimlendirmesi: null → "—", 0 ms → "0 ms" (ikisi AYRI)', () => {
    expect(formatAge(null)).toBe('—');
    expect(formatAge(0)).toBe('0 ms');
    expect(formatAge(3_000)).toBe('3 sn');
    expect(formatAge(130_000)).toBe('2 dk 10 sn');
    expect(formatAge(-5)).toBe('—');
  });

  it('özet üç kategoriyi AYRI sayar', () => {
    const rows = [
      buildSignalRow(obs({ value: 92, ageMs: 1_000, freshness: 'LIVE' })),
      buildSignalRow(obs({ value: 92, ageMs: 45_000, freshness: 'STALE' })),
      buildSignalRow(obs({ pidStatus: 'unsupported' })),
    ];
    expect(summarizeSignals(rows)).toEqual({ total: 3, live: 1, stale: 1, missing: 1 });
  });

  it('kaynak yokken otorite satırı UNAVAILABLE der (sahte "sağlıklı" YOK)', () => {
    const lines = buildAuthorityLines([
      { signal: 'oilTemp', source: 'NONE', value: null, state: 'UNAVAILABLE',
        canPresent: false, obdPresent: false },
    ]);
    expect(lines[0].verdict).toBe('UNAVAILABLE');
    expect(lines[0].value).toBe('KAYNAK YOK');
  });

  it('BAYAT otorite satırı açıkça "BAYAT" der ve UYARI verir', () => {
    const lines = buildAuthorityLines([
      { signal: 'coolantTemp', source: 'OBD', value: 92, state: 'STALE',
        canPresent: false, obdPresent: true },
    ]);
    expect(lines[0].value).toContain('BAYAT');
    expect(lines[0].verdict).toBe('WARN');
    expect(lines[0].note).toContain('KULLANMAZ');
  });

  it('gözlem katmanı null iken model UNAVAILABLE üretir — "iyi" VARSAYMAZ', () => {
    expect(buildAuthorityLines(null)[0].verdict).toBe('UNAVAILABLE');
  });
});

/* ── 7. Köprü çekirdek yolu — sentinel · canlılık · yazım kısıtı ──────────── */

describe('P0-OBD-01 · köprü çekirdek yolu', () => {
  beforeEach(async () => {
    resetStore();
    const { _bridgeInternals } = await import('../platform/vehicleDataLayer/obdSignalBridge');
    _bridgeInternals.reset();
  });

  /** Canlı, gerçek bir OBD anlık görüntüsü (yalnız köprünün okuduğu alanlar anlamlı). */
  function snapshot(over: Record<string, unknown> = {}) {
    return {
      source: 'real', dataFresh: true, lastSeenMs: 1,
      engineTemp: 88, throttle: 17, intakeTemp: 31, boostPressure: 101,
      ...over,
    } as never;
  }

  it('canlı okuma çekirdek sinyalleri mağazaya TAŞIR', async () => {
    const { _bridgeInternals } = await import('../platform/vehicleDataLayer/obdSignalBridge');
    _bridgeInternals.onCore(snapshot());
    const st = useUnifiedVehicleStore.getState().obdSignals;
    expect(st.coolantTemp?.value).toBe(88);
    expect(st.throttle?.value).toBe(17);
    expect(st.intakeTemp?.value).toBe(31);
    expect(st.manifoldPressure?.value).toBe(101);
    // Her ölçüm KENDİ tazelik penceresini taşır — sınıflar farklı olmalı.
    expect(st.throttle!.staleMs).toBeGreaterThan(0);
    expect(st.coolantTemp!.atMs).toBeGreaterThan(0);
  });

  it('-1 sentinel\'i ("sorulmadı/desteklenmiyor") YAZILMAZ — sahte 0 YOK', async () => {
    const { _bridgeInternals } = await import('../platform/vehicleDataLayer/obdSignalBridge');
    _bridgeInternals.onCore(snapshot({ engineTemp: -1, throttle: -1, intakeTemp: -1 }));
    const st = useUnifiedVehicleStore.getState().obdSignals;
    expect('coolantTemp' in st).toBe(false);
    expect('throttle' in st).toBe(false);
    expect('intakeTemp' in st).toBe(false);
    expect(st.manifoldPressure?.value).toBe(101);  // geçerli olan YAZILDI (fail-soft)
  });

  it('BAYAT/kurtarılmış snapshot ölçüm SAYILMAZ (kütük #427 dersi)', async () => {
    const { _bridgeInternals } = await import('../platform/vehicleDataLayer/obdSignalBridge');
    _bridgeInternals.onCore(snapshot({ dataFresh: false }));
    expect(Object.keys(useUnifiedVehicleStore.getState().obdSignals)).toEqual([]);
    _bridgeInternals.onCore(snapshot({ lastSeenMs: 0 }));
    expect(Object.keys(useUnifiedVehicleStore.getState().obdSignals)).toEqual([]);
  });

  it('MOCK kaynak mağazaya SIZAMAZ', async () => {
    const { _bridgeInternals } = await import('../platform/vehicleDataLayer/obdSignalBridge');
    _bridgeInternals.onCore(snapshot({ source: 'mock' }));
    expect(Object.keys(useUnifiedVehicleStore.getState().obdSignals)).toEqual([]);
  });

  it('yazım kısıtı: ardışık tetikler mağazayı 5 Hz uyandırmaz', async () => {
    const { _bridgeInternals, CORE_WRITE_MIN_MS } =
      await import('../platform/vehicleDataLayer/obdSignalBridge');
    expect(CORE_WRITE_MIN_MS).toBeGreaterThanOrEqual(1_000);
    _bridgeInternals.onCore(snapshot({ throttle: 10 }));
    const first = useUnifiedVehicleStore.getState().obdSignals.throttle;
    _bridgeInternals.onCore(snapshot({ throttle: 80 }));   // hemen ardından
    expect(useUnifiedVehicleStore.getState().obdSignals.throttle).toBe(first);
    expect(first?.value).toBe(10);
  });

  it('teşhis sayacı yazımı GÖRÜR ve elemeyi AYRI sayar', async () => {
    const { _bridgeInternals, getObdBridgeDiagnostics } =
      await import('../platform/vehicleDataLayer/obdSignalBridge');
    expect(getObdBridgeDiagnostics().coreWrites).toBe(0);
    expect(getObdBridgeDiagnostics().lastWriteAtMs).toBeNull();   // sahte 0 YOK
    _bridgeInternals.onCore(snapshot({ engineTemp: -1 }));
    const d = getObdBridgeDiagnostics();
    expect(d.coreWrites).toBe(1);
    expect(d.rejected).toBe(1);
    expect(d.lastWriteAtMs).not.toBeNull();
  });
});
