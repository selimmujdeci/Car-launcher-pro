/**
 * obdLivePageSurface.test.tsx — OBD CANLI VERİLERİ sayfası.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NE KİLİTLENİYOR
 *
 * 1) HİYERARŞİ — büyük gösterge (devir/hız) · aynı dilde küçük göstergeler ·
 *    sağda ikincil liste. Veri sadeleştirmek için SİLİNMEZ.
 * 2) ÖLÇEK OTORİTESİ — ad/birim/alt/üst sınır kanonik `STANDARD_PID_MAP`
 *    kaydından gelir; sayfa kendi PID sözlüğünü KURMAZ, eşik UYDURMAZ.
 * 3) DÜRÜSTLÜK — desteklenmeyen · ECU vermiyor · henüz okunmadı · bayat ·
 *    bağlı değil ayrı ayrı; hiçbiri `0` ile karıştırılmaz.
 * 4) SAHTE DOLULUK YOK — sayaç/mesafe satırlarında seviye çubuğu ÇİZİLMEZ.
 * 5) HESAPLANAN ≠ ÖLÇÜLEN — türetilmiş değerler etiketlenir.
 * 6) OTORİTE — sayfa yeni poll/abonelik KURMAZ ve remount'ta biriktirmez.
 *
 * Kaynak-metin araması DEĞİL: saf model doğrudan çağrılır, sunum gerçek
 * DOM'a basılır, abonelik sayımı gerçek mount/unmount ile ölçülür.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  deriveLinkState, deriveDtcState, readField, readMeasured, fromExtendedStatus,
  deriveFuelProvenance, coverage, fillRatio, type Reading,
} from '../components/cockpit/obdLiveModel';
import {
  OBD_PAGE_CATALOG, entriesForTier, WATCHED_EXTENDED_PIDS, hasMeaningfulRange,
  isCentered, BATTERY_VOLTAGE_KEY,
} from '../components/cockpit/obdPidCatalog';
import { STANDARD_PID_MAP } from '../platform/obd/StandardPidRegistry';
import { neighborFor, resolvePageSwipe } from '../components/cockpit/cockpitSwipeModel';

/* ── SDK sınırı: abonelik/poll sayımı ──────────────────────────────────── */
const obd = vi.hoisted(() => ({
  subscribes: 0, unsubscribes: 0, pollStarts: 0,
  watchCalls: 0, watchReleases: 0,
  data: {} as Record<string, unknown>,
}));

vi.mock('../platform/obdService', async () => {
  const React = await import('react');
  return {
    useOBDState: () => {
      React.useEffect(() => {
        obd.subscribes++;
        return () => { obd.unsubscribes++; };
      }, []);
      return obd.data;
    },
    getFuelCalibrationState: () => ({ scale: 1, rawPct: null, displayPct: null, rawAgeMs: null, rawUsable: false, keyKind: 'none' }),
    startOBD: () => { obd.pollStarts++; },
    stopOBD: () => { /* no-op */ },
  };
});

vi.mock('../platform/dtcService', () => ({
  useDTCState: () => ({ codes: [], isReading: false, isClearing: false, lastReadAt: null, error: null, isStale: false }),
}));

/** Genişletilmiş kanal — izleme açılıyor/kapanıyor mu ölçülür. */
vi.mock('../platform/obd/extendedPidService', () => ({
  watchPid: () => { obd.watchCalls++; return () => { obd.watchReleases++; }; },
  getPidValue: () => undefined,
  getPidStatus: () => 'probing' as const,
}));

import { ObdLiveScreen } from '../components/cockpit/ObdLiveScreen';
import type { ObdLiveState } from '../components/cockpit/useObdLiveData';

/* ── Render yardımcıları ───────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  obd.subscribes = 0; obd.unsubscribes = 0; obd.pollStarts = 0;
  obd.watchCalls = 0; obd.watchReleases = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const CLOCK = { time: '22:28', date: 'Pazar, 20 Eyl' };

const live = (v: number): Reading => ({ state: 'live', value: v });
const stale = (v: number): Reading => ({ state: 'stale', value: v });
const unknown: Reading      = { state: 'unread', value: null };
const unsupported: Reading  = { state: 'unsupported', value: null };
const noData: Reading       = { state: 'no_data', value: null };
const offlineR: Reading     = { state: 'offline', value: null };

function makeState(over: Partial<ObdLiveState> = {}): ObdLiveState {
  return {
    link: 'live', lastSeenMs: 1_700_000_000_000, deviceName: 'OBDII ELM327',
    source: 'real', vehicleType: 'ice',
    rpm: live(720), speed: live(0),
    throttle: live(12), fuelLevel: live(62), batteryVoltage: live(14.2),
    engineTemp: live(82), intakeTemp: live(34),
    boostPressure: live(34), egt: unsupported,
    fuelProvenance: 'ecu',
    isElectrified: false,
    batteryLevel: unsupported, batteryTemp: unsupported, motorPower: unsupported,
    fuelRemainingL: live(31.4), estimatedRangeKm: live(518),
    extended: {
      '04': live(28), '5A': live(18), '10': live(3.2), '0A': live(320),
      '06': live(-2), '07': live(4),
      '0E': live(12), '5C': live(78), '24': live(1), '14': live(0.74),
      '33': live(101), '5E': live(0.8), '46': live(21), '3C': unsupported,
      '2C': live(0), '2E': live(0), '78': unsupported, '63': live(32),
      '1F': live(428), '21': live(124),
    },
    dtc: 'unscanned', dtcCount: 0, dtcReading: false,
    coverage: { readable: 20, total: 26, live: 20, stale: 0, unsupported: 6, unread: 0 },
    ...over,
  };
}

function renderScreen(state: ObdLiveState, mode: 'day' | 'night' = 'night', onHome = () => { /* */ }): void {
  act(() => {
    root.render(<ObdLiveScreen state={state} mode={mode} clock={CLOCK} onHome={onHome} />);
  });
}

const valueOf = (key: string): string =>
  (container.querySelector(`[data-obd-value="${key}"]`)?.textContent ?? '').trim();
const tileState = (key: string): string | null =>
  container.querySelector(`[data-obd-tile="${key}"]`)?.getAttribute('data-obd-state') ?? null;
const rowEl = (key: string): Element | null => container.querySelector(`[data-obd-row="${key}"]`);
const allText = (): string => container.textContent ?? '';

/* ══════════════════════════════════════════════════════════════════════════
 * KATALOG — ölçek/ad/birim KAYITTAN gelir, sayfa uydurmaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('katalog · kanonik PID kaydına dayanır', () => {
  it('her girdinin adı/birimi/sınırı kayıtla BİREBİR aynıdır', () => {
    let checked = 0;
    for (const e of OBD_PAGE_CATALOG) {
      if (e.key === BATTERY_VOLTAGE_KEY) continue;   // ATRV kayıtta yok (ELM AT komutu)
      const def = STANDARD_PID_MAP.get(e.key);
      expect(def, `${e.key} kayıtta yok — uydurulmuş PID`).toBeDefined();
      expect(e.label).toBe(def!.name);
      expect(e.unit).toBe(def!.unit);
      expect(e.min).toBe(def!.min);
      expect(e.max).toBe(def!.max);
      checked++;
    }
    expect(checked, 'katalog boş — ölçüm kör').toBeGreaterThan(15);
  });

  it('çekirdek PID ayrımı kayıttaki `core` bayrağından gelir', () => {
    for (const e of OBD_PAGE_CATALOG) {
      if (e.key === BATTERY_VOLTAGE_KEY) continue;
      expect(e.core).toBe(STANDARD_PID_MAP.get(e.key)!.core === true);
    }
  });

  it('çekirdek PID ikinci kez genişletilmiş kanaldan SORGULANMAZ', () => {
    for (const pid of WATCHED_EXTENDED_PIDS) {
      expect(STANDARD_PID_MAP.get(pid)?.core, `${pid} hem çekirdek hem izleniyor`).not.toBe(true);
    }
    expect(WATCHED_EXTENDED_PIDS.length, 'genişletilmiş izleme listesi boş').toBeGreaterThan(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T1 / T2 — BÜYÜK GÖSTERGELER
 * ════════════════════════════════════════════════════════════════════════ */

describe('T1-T2 · devir ve hız BÜYÜK göstergedir', () => {
  it('büyük kademe tam olarak motor devri ve araç hızıdır', () => {
    expect(entriesForTier('large').map((e) => e.key)).toEqual(['0C', '0D']);
  });

  it('gerçek değerlerle çizilir ve büyük gösterge işaretini taşır', () => {
    renderScreen(makeState({ rpm: live(2450), speed: live(84) }));
    expect(valueOf('0C')).toBe('2.450');
    expect(valueOf('0D')).toBe('84');
    expect(container.querySelectorAll('.obdlive-gauge-svg--lg').length,
      'büyük gösterge sayısı beklenenden farklı').toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T3-T7 — KÜÇÜK GÖSTERGELER, AYNI GÖRSEL DİL
 * ════════════════════════════════════════════════════════════════════════ */

describe('T3-T7 · önemli ölçümler AYNI dilde küçük gösterge', () => {
  it('soğutma · voltaj · motor yükü · gaz kelebeği · MAF · MAP hepsi mini gauge', () => {
    renderScreen(makeState());
    for (const key of ['05', BATTERY_VOLTAGE_KEY, '04', '11', '10', '0B']) {
      expect(tileState(key), `${key} küçük gösterge olarak çizilmedi`).not.toBeNull();
    }
    expect(valueOf('05')).toBe('82');
    expect(valueOf(BATTERY_VOLTAGE_KEY)).toBe('14,2');
    expect(valueOf('04')).toBe('28');
    expect(valueOf('10')).toBe('3,2');
    expect(valueOf('0B')).toBe('34');
  });

  it('küçük göstergeler büyüklerle AYNI yay geometrisini kullanır', () => {
    renderScreen(makeState());
    const svgs = [...container.querySelectorAll('.obdlive-gauge-svg')];
    expect(svgs.length, 'gösterge bulunamadı').toBeGreaterThan(8);
    for (const s of svgs) {
      expect(s.getAttribute('viewBox'), 'gösterge ailesi bölündü').toBe('0 0 260 246');
    }
  });

  it('0x0B gerçek adıyla EMME MANİFOLDU olarak etiketlenir (turbo DEĞİL)', () => {
    const e = OBD_PAGE_CATALOG.find((x) => x.key === '0B')!;
    expect(e.label).toContain('MAP');
    expect(e.label.toLocaleLowerCase('tr-TR')).not.toContain('turbo');
  });

  it('sıfır merkezli trim ölçümü merkezden açılır', () => {
    const stft = OBD_PAGE_CATALOG.find((x) => x.key === '06')!;
    expect(isCentered(stft), 'yakıt trim sıfır merkezli değil sayılmış').toBe(true);
    renderScreen(makeState());
    expect(valueOf('06')).toBe('-2');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T8-T10 — İKİNCİL LİSTE VE ANLAMLI ARALIK
 * ════════════════════════════════════════════════════════════════════════ */

describe('T8-T10 · ikincil liste ve seviye çubuğu', () => {
  it("düşük öncelikli PID listesi sağda görünür", () => {
    renderScreen(makeState());
    const side = container.querySelector('[data-obd-side]');
    expect(side, 'ikincil liste yok').not.toBeNull();
    for (const key of ['0E', '5C', '33', '1F', '21']) {
      expect(rowEl(key), `${key} listede yok — veri kayboldu`).not.toBeNull();
    }
  });

  it('anlamlı aralıkta seviye çubuğu ÇİZİLİR', () => {
    renderScreen(makeState());
    const bar = container.querySelector('[data-obd-bar="33"]');   // barometrik basınç
    expect(bar, 'anlamlı aralıklı satırda çubuk yok').not.toBeNull();
  });

  it('sayaç/mesafe satırında SAHTE doluluk çizilmez', () => {
    /* Motor çalışma süresi (s) ve MIL mesafesi (km) sürekli artar. */
    expect(hasMeaningfulRange(STANDARD_PID_MAP.get('1F')!), 'süre sayacı çubuklu sayıldı').toBe(false);
    expect(hasMeaningfulRange(STANDARD_PID_MAP.get('21')!), 'mesafe sayacı çubuklu sayıldı').toBe(false);

    renderScreen(makeState());
    expect(container.querySelector('[data-obd-bar="1F"]'), 'süre sayacına sahte çubuk çizildi').toBeNull();
    expect(container.querySelector('[data-obd-bar="21"]'), 'mesafe sayacına sahte çubuk çizildi').toBeNull();
    /* Ama değer yine de gösterilir — veri silinmez. */
    expect(valueOf('1F')).toBe('428');
    expect(valueOf('21')).toBe('124');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T11-T13 — UNKNOWN != ZERO
 * ════════════════════════════════════════════════════════════════════════ */

describe('T11 · okunmamış ölçüm 0 DEĞİLDİR', () => {
  it('model: okunmamış alan sayı taşımaz', () => {
    expect(readField(undefined, 'live')).toEqual({ state: 'unread', value: null });
    expect(fillRatio(readField(undefined, 'live'), 0, 8000)).toBeNull();
  });

  it('ekran: okunmamış devir için 0 ÇİZİLMEZ', () => {
    renderScreen(makeState({ rpm: unknown }));
    expect(valueOf('0C'), 'okunmamış devir 0 gösterildi').not.toBe('0');
    expect(valueOf('0C')).toBe('—');
    expect(allText()).toContain('Henüz okunmadı');
  });
});

describe('T12 · desteklenmeyen ve ECU vermeyen PID ayrı ayrı doğru', () => {
  it('model: -1 desteklenmiyor; genişletilmiş durumlar birebir eşlenir', () => {
    expect(readField(-1, 'live')).toEqual({ state: 'unsupported', value: null });
    expect(fromExtendedStatus('unsupported', undefined, 'live').state).toBe('unsupported');
    expect(fromExtendedStatus('no_data', undefined, 'live').state).toBe('no_data');
    expect(fromExtendedStatus('probing', undefined, 'live').state).toBe('unread');
    expect(fromExtendedStatus('live', 3.2, 'live')).toEqual({ state: 'live', value: 3.2 });
    expect(fromExtendedStatus('live', 3.2, 'offline').state).toBe('offline');
  });

  it('ekran: iki durum FARKLI etiketlenir ve hiçbiri 0 değildir', () => {
    renderScreen(makeState({
      extended: { ...makeState().extended, '10': unsupported, '0A': noData },
    }));
    expect(valueOf('10')).toBe('—');
    expect(valueOf('0A')).toBe('—');
    expect(tileState('10')).toBe('unsupported');
    expect(tileState('0A')).toBe('no_data');
    expect(allText()).toContain('Desteklenmiyor');
    expect(allText()).toContain('ECU vermiyor');
  });
});

describe('T13 · bayat veri CANLI görünmez', () => {
  it('model: tazelik düşerse durum stale olur, değer korunur', () => {
    const link = deriveLinkState({ transportConnected: true, dataFresh: false, lastSeenMs: 5, source: 'real' });
    expect(link).toBe('stale');
    expect(readField(82, link)).toEqual({ state: 'stale', value: 82 });
  });

  it('ekran: bayat ölçüm CANLI rozeti TAŞIMAZ', () => {
    renderScreen(makeState({ link: 'stale', engineTemp: stale(82) }));
    expect(tileState('05')).toBe('stale');
    expect(container.querySelector('[data-obd-link-chip]')?.textContent).toContain('GECİKMİŞ');
  });

  it('mock kaynağı ve susan ECU CANLI sayılmaz', () => {
    expect(deriveLinkState({ transportConnected: true, dataFresh: true, lastSeenMs: 9, source: 'mock' })).toBe('waiting');
    const w = deriveLinkState({ transportConnected: true, dataFresh: true, lastSeenMs: 0, source: 'real' });
    expect(w).toBe('waiting');
    expect(readMeasured(0, w)).toEqual({ state: 'unread', value: null });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T14 — HESAPLANAN VERİ ETİKETLENİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('T14 · hesaplanan/tahmini değerler ECU ölçümü gibi SUNULMAZ', () => {
  it('kalan yakıt ve menzil açıkça etiketlenir', () => {
    renderScreen(makeState());
    const fuel = rowEl('calc-fuel-l');
    const range = rowEl('calc-range-km');
    expect(fuel, 'hesaplanan yakıt satırı yok').not.toBeNull();
    expect(range, 'tahmini menzil satırı yok').not.toBeNull();
    expect(fuel!.textContent).toContain('hesaplanan');
    expect(range!.textContent).toContain('tahmini');
  });

  it('yakıt seviyesi kalibreliyse ham ECU okuması gibi gösterilmez', () => {
    expect(deriveFuelProvenance({ reading: live(62), scale: 1 })).toBe('ecu');
    expect(deriveFuelProvenance({ reading: live(62), scale: 1.18 })).toBe('ecu-calibrated');
    expect(deriveFuelProvenance({ reading: unknown, scale: 1 })).toBe('none');

    renderScreen(makeState({ fuelProvenance: 'ecu-calibrated' }));
    expect(container.querySelector('[data-obd-tile="2F"]')?.textContent).toContain('kalibreli');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T15-T16 — DTC VE DURUM
 * ════════════════════════════════════════════════════════════════════════ */

describe('T15-T16 · DTC ve bağlantı durumu dürüst', () => {
  it('tarama yapılmadan "arıza yok" DENMEZ', () => {
    expect(deriveDtcState({ scanRan: false, count: 0, link: 'live' })).toBe('unscanned');
    expect(deriveDtcState({ scanRan: true, count: 0, link: 'live' })).toBe('clean');
    expect(deriveDtcState({ scanRan: true, count: 3, link: 'live' })).toBe('faults');

    renderScreen(makeState({ dtc: 'unscanned', dtcCount: 0 }));
    expect(valueOf('dtc')).toBe('Henüz taranmadı');
    expect(allText()).not.toContain('Arıza kodu yok');
  });

  it('veri kalitesi gerçek durumlardan sayılır', () => {
    const c = coverage([live(1), live(2), stale(3), unsupported, noData, unknown]);
    expect(c).toEqual({ readable: 3, total: 6, live: 2, stale: 1, unsupported: 2, unread: 1 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BAĞLANTI YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('bağlantı yokken sahte gösterge YOK', () => {
  it('boş durum çizilir; hiçbir gösterge veya liste satırı basılmaz', () => {
    renderScreen(makeState({
      link: 'offline', rpm: offlineR, speed: offlineR, engineTemp: offlineR,
      throttle: offlineR, fuelLevel: offlineR, batteryVoltage: offlineR,
      intakeTemp: offlineR, boostPressure: offlineR,
      fuelRemainingL: offlineR, estimatedRangeKm: offlineR,
      extended: {}, dtc: 'offline',
      coverage: { readable: 0, total: 26, live: 0, stale: 0, unsupported: 0, unread: 26 },
    }));
    expect(container.querySelector('[data-obd-empty]')).not.toBeNull();
    expect(container.querySelectorAll('[data-obd-tile]').length).toBe(0);
    expect(container.querySelectorAll('[data-obd-row]').length).toBe(0);
    expect(container.querySelector('[data-obd-home]'), 'sürücü mahsur kaldı').not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T17-T19 — TEMA VE YERLEŞİM
 * ════════════════════════════════════════════════════════════════════════ */

describe('T17-T19 · gün/gece ve çok PID yerleşimi', () => {
  it('gece teması koyu zemin kullanır', () => {
    renderScreen(makeState(), 'night');
    const el = container.querySelector('.obdlive') as HTMLElement;
    expect(el.getAttribute('data-obd-theme')).toBe('night');
    expect(el.style.background).toBe('rgb(6, 8, 10)');
  });

  it('gündüz teması göz almayan açık zemin kullanır', () => {
    renderScreen(makeState(), 'day');
    const el = container.querySelector('.obdlive') as HTMLElement;
    expect(el.getAttribute('data-obd-theme')).toBe('day');
    expect(el.style.background).toBe('rgb(231, 234, 238)');
  });

  it('tema değişimi hiyerarşiyi ve değerleri BOZMAZ', () => {
    const s = makeState({ rpm: live(2450) });
    renderScreen(s, 'night');
    const nightTiles = container.querySelectorAll('[data-obd-tile]').length;
    const nightRows  = container.querySelectorAll('[data-obd-row]').length;
    const nightRpm   = valueOf('0C');

    renderScreen(s, 'day');
    expect(container.querySelectorAll('[data-obd-tile]').length).toBe(nightTiles);
    expect(container.querySelectorAll('[data-obd-row]').length).toBe(nightRows);
    expect(valueOf('0C')).toBe(nightRpm);
  });

  it('çok sayıda PID aynı sayfada kalır — ayrı sayfaya taşınmaz', () => {
    renderScreen(makeState());
    const tiles = container.querySelectorAll('[data-obd-tile]').length;
    const rows  = container.querySelectorAll('[data-obd-row]').length;
    expect(tiles + rows, 'gösterilen PID sayısı beklenenden az — veri düştü')
      .toBeGreaterThanOrEqual(24);
    expect(container.querySelector('.obdlive-side-scroll'), 'liste kendi içinde kaydırılamıyor')
      .not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T20 — OTORİTE: YENİ POLL YOK, ABONELİK BİRİKMEZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('T20 · sayfa yeni OBD otoritesi kurmaz', () => {
  it('sayfa açılması OBD turu BAŞLATMAZ; izleme kanonik yoldan açılır', async () => {
    const { ObdLivePage } = await import('../components/cockpit/ObdLivePage');
    act(() => { root.render(<ObdLivePage onHome={() => { /* */ }} />); });
    expect(obd.pollStarts, 'sayfa kendi OBD turunu başlattı').toBe(0);
    expect(obd.watchCalls, 'genişletilmiş izleme hiç açılmadı — ölçüm kör')
      .toBe(WATCHED_EXTENDED_PIDS.length);
  });

  it('tekrar tekrar mount/unmount abonelik ve izleme BİRİKTİRMEZ', async () => {
    const { ObdLivePage } = await import('../components/cockpit/ObdLivePage');
    for (let i = 0; i < 5; i++) {
      act(() => { root.render(<ObdLivePage onHome={() => { /* */ }} />); });
      act(() => { root.render(<div />); });
    }
    expect(obd.subscribes).toBeGreaterThan(0);
    expect(obd.unsubscribes, 'OBD aboneliği sızdı').toBe(obd.subscribes);
    expect(obd.watchReleases, 'PID izlemesi sızdı — native liste küçülmedi')
      .toBe(obd.watchCalls);
    expect(obd.pollStarts).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * JEST / ANA SAYFA — önceki turda kilitlenen davranış korunur
 * ════════════════════════════════════════════════════════════════════════ */

describe('erişim ve dönüş davranışı korunur', () => {
  it('kokpitten sağa OBD, sola HOME; sürüş eşiği değişmedi', () => {
    expect(neighborFor('cockpit', 600)).toBe('obd');
    expect(neighborFor('cockpit', -600)).toBe('home');
    expect(resolvePageSwipe({ page: 'cockpit', dx: 200, viewportWidth: 1024, isDriving: true }).committed)
      .toBe(false);
  });

  it('ANA SAYFA gerçek bir <button> ve dönüşü sahibine devreder', () => {
    const onHome = vi.fn();
    renderScreen(makeState(), 'night', onHome);
    const btn = container.querySelector('[data-obd-home]') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});
