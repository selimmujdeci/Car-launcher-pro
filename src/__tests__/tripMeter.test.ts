/**
 * tripMeter.test.ts — RESETLENEBİLİR YOL SAYACI (P0 · AŞAMA A).
 *
 * Kapsam: saf model (tripMeterModel.ts) doğrudan gerçek fonksiyonlarla;
 * runtime servisi (tripMeterService.ts) mock'lu safeStorage + mock'lu
 * UnifiedVehicleStore ile. Long road / tripLogService'e ÇİFT YÖNLÜ yazma
 * olmadığı spy'larla kanıtlanır (senaryo 10).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── safeStorage mock: gerçek bir in-memory map'e yazar/okur (restart testi için) ── */

const _storage = new Map<string, string>();

vi.mock('../utils/safeStorage', () => ({
  safeGetRaw:   vi.fn((key: string) => (_storage.has(key) ? (_storage.get(key) as string) : null)),
  safeSetRaw:   vi.fn((key: string, value: string) => { _storage.set(key, value); }),
  safeFlushKey: vi.fn(),
}));

/* ── UnifiedVehicleStore mock: getState/subscribe/setState + test sürücüleri ── */

interface MockVehicleState { odometer: number; speed: number | null; }
type MockListener = (cur: MockVehicleState, prev: MockVehicleState) => void;

vi.mock('../platform/vehicleDataLayer/UnifiedVehicleStore', () => {
  let state: MockVehicleState = { odometer: 0, speed: null };
  let listener: MockListener | null = null;
  const setStateSpy = vi.fn();

  const useUnifiedVehicleStore = Object.assign(
    {
      getState: () => state,
      subscribe: vi.fn((cb: MockListener) => {
        listener = cb;
        return () => { if (listener === cb) listener = null; };
      }),
      setState: setStateSpy,
    },
    {
      __setOdometer(v: number) {
        const prev = state;
        state = { ...state, odometer: v };
        if (listener) listener(state, prev);
      },
      __setSpeed(v: number | null) {
        state = { ...state, speed: v };
      },
      __reset() {
        state = { odometer: 0, speed: null };
        listener = null;
      },
      __setStateSpy: setStateSpy,
    },
  );

  return { useUnifiedVehicleStore };
});

/* ── tripLogService mock: senaryo 10 için "hiç çağrılmadı" kanıtı ── */

vi.mock('../platform/tripLogService', () => ({
  clearAllTrips: vi.fn(),
  deleteTrip:    vi.fn(),
  startTripLog:  vi.fn(),
  stopTripLog:   vi.fn(),
}));

/* ── Import (mock'lardan sonra) ─────────────────────────────── */

import { safeSetRaw, safeFlushKey } from '../utils/safeStorage';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { clearAllTrips, deleteTrip } from '../platform/tripLogService';
import {
  startTripMeter, stopTripMeter, getTripMeterSnapshot, requestTripMeterReset,
} from '../platform/trip/tripMeterService';
import {
  emptyTripMeter, advanceTripMeter, parseTripMeter, canResetTripMeter,
  formatTripMeterKm, tripMeterGateSpeed, TRIP_METER_PERSISTENCE_VERSION,
} from '../platform/trip/tripMeterModel';
import {
  tripMeterUiPressReset, tripMeterUiCancel, tripMeterUiConfirmed, tripMeterUiSpeedChanged,
} from '../components/trip/tripMeterUiState';

/* ── Kaynak metni kilitleri (jsdom'da React ağacı render EDİLEMEZ — bu proje
      `@testing-library/react` KULLANMAZ; mount ve "yazmıyor" kanıtı ham kaynak
      üzerinden kilitlenir; emsal: capabilityRegistry.test.ts) ─────────────── */

import teslaSource      from '../components/themes/TeslaLayout.tsx?raw';
import expeditionSource from '../components/themes/ExpeditionLayout.tsx?raw';
import horizonSource    from '../components/themes/HorizonLayout.tsx?raw';
import proSource        from '../components/themes/ProLayout.tsx?raw';
import layoutServicesSource from '../hooks/useLayoutServices.ts?raw';
import tripEngineScreenSource from '../components/devtools/screens/TripEngineScreen.tsx?raw';
import longRoadRecorderSource from '../platform/fieldValidation/longRoadRecorder.ts?raw';
import tripMeterServiceSource from '../platform/trip/tripMeterService.ts?raw';
import tripMeterRowSource from '../components/trip/TripMeterRow.tsx?raw';

/* ── Mock erişimi (yapısal tip, gerçek modül tipini EZMEZ) ──── */

interface MockVehicleControls {
  __setOdometer: (v: number) => void;
  __setSpeed: (v: number | null) => void;
  __reset: () => void;
  __setStateSpy: ReturnType<typeof vi.fn>;
}
const vehicle = useUnifiedVehicleStore as unknown as MockVehicleControls;

/* ── Global cleanup ──────────────────────────────────────────── */

beforeEach(() => {
  stopTripMeter();
  _storage.clear();
  vehicle.__reset();
  vi.clearAllMocks();
});

afterEach(() => {
  stopTripMeter();
});

/* ═══════════════════════════════════════════════════════════════
   SERVİS — gerçek mesafe birikimi
   ═══════════════════════════════════════════════════════════════ */

describe('tripMeterService — mesafe birikimi', () => {
  it('gerçek mesafe artışı toplanıyor (10.0 → 12.5 → 18.0 km)', () => {
    vehicle.__setOdometer(10.0);
    startTripMeter();
    vehicle.__setOdometer(12.5);
    vehicle.__setOdometer(18.0);

    const snap = getTripMeterSnapshot();
    expect(snap.record.distanceKm).toBeCloseTo(8.0, 5); // (12.5-10) + (18-12.5)
  });

  it('uygulama restartı: persist → yeniden yüklenen servis → aynı distanceKm', () => {
    vehicle.__setOdometer(100);
    startTripMeter();
    vehicle.__setOdometer(103.4); // distanceKm 3.4
    stopTripMeter();              // anında mühürler (safeFlushKey)

    // "Yeni process" simülasyonu: gerçek UnifiedVehicleStore odometer'ı da
    // kendi persist'inden aynı kümülatif değerle döner — odometer DEĞİŞMEDİ.
    startTripMeter(); // _load() persisted kaydı okur, sonra ilk okuma delta=0

    const snap = getTripMeterSnapshot();
    expect(snap.restoreState).toBe('RESTORED');
    expect(snap.record.distanceKm).toBeCloseTo(3.4, 5);
  });

  it('process restore: baseline null iken ilk odometre okuması mesafeyi ARTIRMAZ (yalnız tohumlar)', () => {
    vehicle.__setOdometer(77.3);
    startTripMeter();

    const snap = getTripMeterSnapshot();
    expect(snap.record.distanceKm).toBe(0);
    expect(snap.record.baselineOdometerKm).toBeCloseTo(77.3, 5);
    expect(snap.record.state).toBe('READY');
    expect(snap.record.confidence).toBe('HIGH');
  });

  it('duplicate replay: aynı odometre değeri iki kez → mesafe iki katına ÇIKMAZ', () => {
    vehicle.__setOdometer(10);
    startTripMeter();
    vehicle.__setOdometer(12.5); // distanceKm 2.5
    vehicle.__setOdometer(12.5); // duplicate
    vehicle.__setOdometer(12.5); // duplicate

    const snap = getTripMeterSnapshot();
    expect(snap.record.distanceKm).toBeCloseTo(2.5, 5);
  });

  it('GPS jump / odometre gerilemesi → negatif eklenmez, mesafe korunur, confidence MEDIUM', () => {
    vehicle.__setOdometer(10);
    startTripMeter();
    vehicle.__setOdometer(12.5); // distanceKm 2.5, confidence HIGH
    vehicle.__setOdometer(11.0); // geriledi

    const snap = getTripMeterSnapshot();
    expect(snap.record.distanceKm).toBeCloseTo(2.5, 5);
    expect(snap.record.confidence).toBe('MEDIUM');
    expect(snap.record.lastOdometerKm).toBeCloseTo(11.0, 5);
    expect(snap.record.baselineOdometerKm).toBeCloseTo(8.5, 5);
  });

  it('park hâlinde (delta 0) mesafe artmaz', () => {
    vehicle.__setOdometer(20);
    vehicle.__setSpeed(0);
    startTripMeter();
    vehicle.__setOdometer(22); // distanceKm 2
    vehicle.__setOdometer(22); // parked — delta 0
    vehicle.__setOdometer(22); // parked — delta 0

    const snap = getTripMeterSnapshot();
    expect(snap.record.distanceKm).toBeCloseTo(2, 5);
  });
});

/* ═══════════════════════════════════════════════════════════════
   SERVİS — reset güvenlik kapısı
   ═══════════════════════════════════════════════════════════════ */

describe('tripMeterService — reset', () => {
  it('reset: distanceKm 0, resetCount+1, startedAt yeni, meterId AYNI', () => {
    vehicle.__setOdometer(10);
    startTripMeter();
    vehicle.__setOdometer(15); // distanceKm 5
    const before = getTripMeterSnapshot().record;

    vehicle.__setSpeed(0); // park — reset izinli
    const result = requestTripMeterReset();

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('PARKED');

    const after = getTripMeterSnapshot().record;
    expect(after.distanceKm).toBe(0);
    expect(after.resetCount).toBe(before.resetCount + 1);
    expect(after.meterId).toBe(before.meterId);
    expect(after.startedAtMs).not.toBeNull();
  });

  it('reset trip geçmişine, odometer store una veya diğer alanlara DOKUNMAZ', () => {
    vehicle.__setOdometer(10);
    startTripMeter();
    vehicle.__setOdometer(15);
    vehicle.__setSpeed(0);

    requestTripMeterReset();

    expect(vehicle.__setStateSpy).not.toHaveBeenCalled();
    expect(clearAllTrips).not.toHaveBeenCalled();
    expect(deleteTrip).not.toHaveBeenCalled();
    expect(useUnifiedVehicleStore.getState().odometer).toBe(15);
  });

  it('hareket hâlinde reset ENGELLENİR ve storage a YAZILMAZ', () => {
    vehicle.__setOdometer(10);
    startTripMeter();
    vehicle.__setOdometer(15);
    stopTripMeter(); // önceki birikimi mühürle (temiz taban)
    startTripMeter();

    vi.clearAllMocks(); // yalnız reset ANI'nı izole et

    vehicle.__setSpeed(30); // hareket hâlinde
    const result = requestTripMeterReset();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('MOVING');
    expect(safeSetRaw).not.toHaveBeenCalled();
    expect(safeFlushKey).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════
   SAF MODEL — doğrudan
   ═══════════════════════════════════════════════════════════════ */

describe('tripMeterModel — saf fonksiyonlar', () => {
  it('stale/UNKNOWN (null, NaN, negatif odometre) → kayıt DEĞİŞMEZ, 0 YAZILMAZ', () => {
    const seeded = advanceTripMeter(emptyTripMeter('m'), 50, 1000);
    expect(advanceTripMeter(seeded, null, 2000)).toBe(seeded);
    expect(advanceTripMeter(seeded, NaN, 2000)).toBe(seeded);
    expect(advanceTripMeter(seeded, -5, 2000)).toBe(seeded);
  });

  it('canResetTripMeter fail-closed kapısı', () => {
    expect(canResetTripMeter(0)).toEqual({ allowed: true, reason: 'PARKED' });
    expect(canResetTripMeter(30)).toEqual({ allowed: false, reason: 'MOVING' });
    expect(canResetTripMeter(null)).toEqual({ allowed: false, reason: 'SPEED_UNKNOWN' });
  });

  it('bozuk kayıt (version uyumsuz / distanceKm string) → CORRUPT + sıfır kayıt, çökme yok', () => {
    const r1 = parseTripMeter({ persistenceVersion: 999 }, 'default');
    expect(r1.restoreState).toBe('CORRUPT');
    expect(r1.record.distanceKm).toBe(0);
    expect(r1.record.meterId).toBe('default');

    const r2 = parseTripMeter({
      persistenceVersion: TRIP_METER_PERSISTENCE_VERSION,
      meterId: 'default', distanceKm: 'oops', baselineOdometerKm: null, lastOdometerKm: null,
      startedAtMs: null, lastUpdatedAtMs: null, resetCount: 0,
      distanceSource: 'UNAVAILABLE', confidence: 'UNKNOWN', state: 'NO_DISTANCE_SOURCE',
    }, 'default');
    expect(r2.restoreState).toBe('CORRUPT');

    expect(() => parseTripMeter('garbage-string', 'default')).not.toThrow();
    expect(() => parseTripMeter(undefined, 'default')).not.toThrow();
    expect(parseTripMeter(null, 'default').restoreState).toBe('EMPTY');
  });

  it('servis: storage bozuk JSON içerse bile startTripMeter ÇÖKMEZ', () => {
    _storage.set('caros-trip-meter-v1', 'not-json{{{');
    expect(() => startTripMeter()).not.toThrow();
    expect(getTripMeterSnapshot().restoreState).toBe('CORRUPT');
  });

  it('formatTripMeterKm: tr-TR biçimi, tam 1 ondalık', () => {
    expect(formatTripMeterKm(128.44)).toBe('128,4');
    expect(formatTripMeterKm(1248.55)).toBe('1.248,6');
    expect(formatTripMeterKm(null)).toBe('—');
    expect(formatTripMeterKm(NaN)).toBe('—');
  });

  it('tripMeterGateSpeed kapı hükmünü DEĞİŞTİRMEZ (render azaltma güvenli)', () => {
    for (const v of [null, NaN, 0, 0.4, 1, 30, 240, -3]) {
      expect(canResetTripMeter(tripMeterGateSpeed(v))).toEqual(canResetTripMeter(v));
    }
    // Hareket hâlindeki FARKLI hızlar AYNI değeri üretir → yeniden render OLMAZ.
    expect(tripMeterGateSpeed(30)).toBe(tripMeterGateSpeed(90));
    expect(tripMeterGateSpeed(NaN)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════
   UI FAZ MAKİNESİ — onay akışı (saf; React render'ı olmadan)
   ═══════════════════════════════════════════════════════════════ */

describe('tripMeterUiState — reset onay akışı', () => {
  it('park hâlinde: bas → onay açılır; VAZGEÇ → kapanır, SIFIRLA → kapanır', () => {
    expect(tripMeterUiPressReset('idle', 0)).toBe('confirm');
    expect(tripMeterUiCancel('confirm')).toBe('idle');
    expect(tripMeterUiConfirmed('confirm')).toBe('idle');
  });

  it('hareket hâlinde dokunuş HİÇBİR ŞEY açmaz (popup YOK)', () => {
    expect(tripMeterUiPressReset('idle', 30)).toBe('idle');
  });

  it('hız BİLİNMİYORSA fail-closed — onay açılmaz', () => {
    expect(tripMeterUiPressReset('idle', null)).toBe('idle');
    expect(tripMeterUiPressReset('idle', NaN)).toBe('idle');
  });

  it('onay AÇIKKEN araç hareket ederse onay kendiliğinden kapanır', () => {
    expect(tripMeterUiSpeedChanged('confirm', 30)).toBe('idle');
    expect(tripMeterUiSpeedChanged('confirm', null)).toBe('idle');
    expect(tripMeterUiSpeedChanged('confirm', 0)).toBe('confirm');
    // idle fazında hız değişimi hiçbir şey açmaz
    expect(tripMeterUiSpeedChanged('idle', 0)).toBe('idle');
  });
});

/* ═══════════════════════════════════════════════════════════════
   ÜRÜNE BAĞLILIK — "dosya var" YETMEZ: gerçekten mount edilmiş mi?
   ═══════════════════════════════════════════════════════════════ */

describe('TripMeterRow ürün ekranlarına gerçekten bağlı', () => {
  const LAYOUTS: readonly (readonly [string, string])[] = [
    ['TeslaLayout',      teslaSource],
    ['ExpeditionLayout', expeditionSource],
    ['HorizonLayout',    horizonSource],
    ['ProLayout',        proSource],
  ];

  it.each(LAYOUTS)('%s: TripMeterRow import edilmiş VE JSX olarak mount edilmiş', (_name, src) => {
    expect(src).toContain("from '../trip/TripMeterRow'");
    expect(src).toContain('<TripMeterRow');
  });

  it.each(LAYOUTS)('%s: sıfırlanamayan ham "Kilometre" alanı KALDIRILDI', (_name, src) => {
    expect(src).not.toMatch(/label="Kilometre"/);
    expect(src).not.toMatch(/>Kilometre</);
    expect(src).not.toContain('KİLOMETRE<');
  });

  it('servis uygulama açılışında başlatılıyor ve unmount ta durduruluyor (zero-leak)', () => {
    expect(layoutServicesSource).toContain('startTripMeter()');
    expect(layoutServicesSource).toContain('stopTripMeter()');
  });

  it('bileşen HAM hıza abone OLMAZ — kapı denklik sınıfı kullanılır (render bütçesi)', () => {
    expect(tripMeterRowSource).toContain('tripMeterGateSpeed(s.speed)');
    expect(tripMeterRowSource).not.toMatch(/useUnifiedVehicleStore\(\s*\(s\)\s*=>\s*s\.speed\s*\)/);
  });

  it('bileşen MODAL/POPUP açmaz — onay satır içi fazdır', () => {
    expect(tripMeterRowSource).not.toMatch(/\bModal\b/);
    expect(tripMeterRowSource).not.toMatch(/window\.(confirm|alert)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   OTORİTE AYRIMI — saha testi ile yol sayacı birbirine YAZMAZ
   ═══════════════════════════════════════════════════════════════ */

describe('yol sayacı ile saha testi mesafesi ayrı otoritelerdir', () => {
  /** Yorum metni değil, GERÇEK bağımlılık: `from '...'` yolları. */
  const importsOf = (src: string): readonly string[] =>
    [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

  it('saha testi kaydedicisi yol sayacına DOKUNMAZ (otomatik sıfırlama YOK)', () => {
    expect(importsOf(longRoadRecorderSource).some((m) => /tripMeter/i.test(m))).toBe(false);
    expect(longRoadRecorderSource).not.toMatch(/\b(requestTripMeterReset|startTripMeter)\s*\(/);
  });

  it('yol sayacı servisi saha testine / trip geçmişine YAZMAZ', () => {
    const imports = importsOf(tripMeterServiceSource);
    expect(imports.some((m) => /longRoad|fieldValidation/i.test(m))).toBe(false);
    expect(imports.some((m) => /tripLogService/.test(m))).toBe(false);
    // Odometre store'una yazma YOK — yalnız okuma + abonelik.
    expect(tripMeterServiceSource).not.toContain('useUnifiedVehicleStore.setState');
  });

  it('LAB ekranı SALT-OKUNUR: sıfırlama/başlatma çağrısı İÇERMEZ', () => {
    expect(tripEngineScreenSource).toContain('getTripMeterSnapshot');
    expect(tripEngineScreenSource).not.toContain('requestTripMeterReset');
    expect(tripEngineScreenSource).not.toContain('startTripMeter');
    expect(tripEngineScreenSource).not.toContain('stopTripMeter');
  });

  it('LAB ekranı yol sayacı ile saha oturumunu KARŞILAŞTIRIR ama hüküm VERMEZ', () => {
    expect(tripEngineScreenSource).toContain('userTripMeterKm');
    expect(tripEngineScreenSource).toContain('fieldSessionDistanceKm');
    expect(tripEngineScreenSource).toContain('differenceKm');
  });
});
