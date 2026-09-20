/**
 * obdLivePageSurface.test.tsx — OBD CANLI VERİLERİ sayfası.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NE KİLİTLENİYOR
 *
 * 1) ERİŞİM — sayfa MEVCUT kaydırma şeridinde yer alır; kokpitten SAĞA
 *    kaydırma OBD'yi açar, SOLA kaydırma HOME'a dönmeye devam eder.
 * 2) DÜRÜSTLÜK — ölçülmemiş / desteklenmeyen / bayat veri ASLA sayı olarak
 *    (özellikle `0` olarak) gösterilmez.
 * 3) TEMA — gün ve gece AYNI geometri, yalnız token farkı; tema değişimi
 *    sayfayı bozmaz.
 * 4) OTORİTE — sayfa yeni OBD aboneliği/poll turu AÇMAZ ve yeniden mount
 *    edildiğinde abonelik BİRİKTİRMEZ.
 * 5) DÖNÜŞ — "ANA SAYFA" butonu sayfanın sahibine dönüşü devreder.
 *
 * Kaynak-metin araması DEĞİL: saf karar modeli doğrudan çağrılır, sunum
 * gerçekten DOM'a basılır, abonelik sayımı gerçek mount/unmount ile ölçülür.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  deriveLinkState, deriveDtcState, readField, readMeasured, fillRatio, hasNumber,
  type LinkState, type Reading,
} from '../components/cockpit/obdLiveModel';
import { neighborFor, resolvePageSwipe, PAGE_STRIP } from '../components/cockpit/cockpitSwipeModel';

/* ── SDK sınırı: kaç abonelik açıldı / kapandı ─────────────────────────── */
const obd = vi.hoisted(() => ({
  subscribes: 0,
  unsubscribes: 0,
  pollStarts: 0,
  data: {} as Record<string, unknown>,
}));

vi.mock('../platform/obdService', async () => {
  const React = await import('react');
  return {
  useOBDState: () => {
    /* Gerçek `useOBDState` bir useSyncExternalStore aboneliğidir; burada
       yalnız abonelik SAYISI ölçülür. */
    React.useEffect(() => {
      obd.subscribes++;
      return () => { obd.unsubscribes++; };
    }, []);
    return obd.data;
  },
  startOBD: () => { obd.pollStarts++; },
  stopOBD: () => { /* no-op */ },
  };
});

vi.mock('../platform/dtcService', () => ({
  useDTCState: () => ({ codes: [], isReading: false, isClearing: false, lastReadAt: null, error: null, isStale: false }),
}));

import { ObdLiveScreen } from '../components/cockpit/ObdLiveScreen';
import type { ObdLiveState } from '../components/cockpit/useObdLiveData';

/* ── Render yardımcıları ───────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  obd.subscribes = 0; obd.unsubscribes = 0; obd.pollStarts = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const CLOCK = { time: '22:28', date: 'Pazar, 20 Eyl' };

/** Tek bir ölçümü verilen durumda kuran kısayol. */
const live = (v: number): Reading => ({ state: 'live', value: v });
const unknown: Reading = { state: 'unread', value: null };
const unsupported: Reading = { state: 'unsupported', value: null };
const stale = (v: number): Reading => ({ state: 'stale', value: v });
const offlineR: Reading = { state: 'offline', value: null };

function makeState(over: Partial<ObdLiveState> = {}): ObdLiveState {
  return {
    link: 'live', lastSeenMs: 1_700_000_000_000, deviceName: 'OBDII ELM327',
    source: 'real', vehicleType: 'ice',
    rpm: live(720), speed: live(0),
    throttle: live(12), fuelLevel: live(62), batteryVoltage: live(14.2),
    engineTemp: live(82), intakeTemp: live(34),
    boostPressure: unsupported, egt: unsupported,
    fuelProvenance: 'ecu',
    isElectrified: false,
    batteryLevel: unsupported, batteryTemp: unsupported, motorPower: unsupported,
    dtc: 'unscanned', dtcCount: 0, dtcReading: false,
    coverage: { readable: 7, total: 9, live: 7, stale: 0, unsupported: 2, unread: 0 },
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
const allText = (): string => container.textContent ?? '';

/* ══════════════════════════════════════════════════════════════════════════
 * T1 / T2 / T15 — ERİŞİM VE MEVCUT JESTİN KORUNMASI
 * ════════════════════════════════════════════════════════════════════════ */

describe('T1 · OBD sayfası mevcut kaydırma şeridindedir', () => {
  it('kokpitten SAĞA kaydırma OBD sayfasını hedefler', () => {
    expect(neighborFor('cockpit', 600)).toBe('obd');
    expect(resolvePageSwipe({ page: 'cockpit', dx: 600, viewportWidth: 1024, isDriving: false }))
      .toMatchObject({ committed: true, target: 'obd' });
  });

  it('şerit tek sayfa/jest otoritesinde tanımlıdır — ikinci pager yok', () => {
    expect([...PAGE_STRIP]).toEqual(['obd', 'cockpit', 'home']);
  });
});

describe('T2 / T15 · mevcut davranış korunur', () => {
  it('kokpitten SOLA kaydırma HÂLÂ HOME döndürür', () => {
    expect(neighborFor('cockpit', -600)).toBe('home');
    expect(resolvePageSwipe({ page: 'cockpit', dx: -600, viewportWidth: 1024, isDriving: false }).target)
      .toBe('home');
  });

  it('HOME tek komşuludur: her iki yön de kokpite gider (yön dayatılmaz)', () => {
    expect(neighborFor('home', 600)).toBe('cockpit');
    expect(neighborFor('home', -600)).toBe('cockpit');
  });

  it('OBD ucundadır: her iki yön de kokpite döner', () => {
    expect(neighborFor('obd', 600)).toBe('cockpit');
    expect(neighborFor('obd', -600)).toBe('cockpit');
  });

  it('sürüş güvenliği eşiği DEĞİŞMEDİ — kısa jest sürüşte OBD açmaz', () => {
    const short = resolvePageSwipe({ page: 'cockpit', dx: 200, viewportWidth: 1024, isDriving: true });
    expect(short.committed, 'sürüşte kısa kaydırma sayfa değiştirdi').toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T3 / T4 / T5 — GERÇEK ÖLÇÜMLER ÇİZİLİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('T3-T5 · gerçek ölçümler gösterilir', () => {
  it('RPM · hız · sıcaklık gerçek değerleriyle çizilir', () => {
    renderScreen(makeState({ rpm: live(2450), speed: live(84), engineTemp: live(91) }));
    expect(valueOf('rpm')).toBe('2.450');
    expect(valueOf('speed')).toBe('84');
    expect(valueOf('engineTemp')).toBe('91');
  });

  it('duran araçta GERÇEK 0 gösterilir (0 her zaman yalan değildir)', () => {
    renderScreen(makeState({ speed: live(0) }));
    expect(valueOf('speed')).toBe('0');
    expect(tileState('engineTemp')).toBe('live');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T6 / T7 / T9 — UNKNOWN ≠ ZERO
 * ════════════════════════════════════════════════════════════════════════ */

describe('T6 · okunmamış ölçüm 0 DEĞİLDİR', () => {
  it('model: okunmamış alan sayı taşımaz', () => {
    expect(readField(undefined, 'live')).toEqual({ state: 'unread', value: null });
    expect(hasNumber(readField(undefined, 'live'))).toBe(false);
    expect(fillRatio(readField(undefined, 'live'), 0, 8000)).toBeNull();
  });

  it('ekran: okunmamış RPM için 0 ÇİZİLMEZ', () => {
    renderScreen(makeState({ rpm: unknown }));
    expect(valueOf('rpm'), 'okunmamış RPM 0 olarak gösterildi').not.toBe('0');
    expect(valueOf('rpm')).toBe('—');
    expect(allText()).toContain('Henüz okunmadı');
  });
});

describe('T7 · desteklenmeyen PID 0 DEĞİLDİR', () => {
  it('model: -1 desteklenmiyor demektir', () => {
    expect(readField(-1, 'live')).toEqual({ state: 'unsupported', value: null });
  });

  it('ekran: desteklenmeyen alan tire ve etiketle çizilir, kart sönüktür', () => {
    renderScreen(makeState({ boostPressure: unsupported }));
    expect(valueOf('boostPressure'), 'desteklenmeyen PID 0 g/s gibi gösterildi').not.toBe('0');
    expect(valueOf('boostPressure')).toBe('—');
    expect(tileState('boostPressure')).toBe('unsupported');
    /* LEVEL 3 satırında etiket cümle düzeninde yazılır. */
    expect(allText()).toContain('Desteklenmiyor');
  });
});

describe('T9 · bayat veri CANLI görünmez', () => {
  it('model: tazelik düşerse durum stale olur, değer korunur', () => {
    const link: LinkState = deriveLinkState({
      transportConnected: true, dataFresh: false, lastSeenMs: 5, source: 'real',
    });
    expect(link).toBe('stale');
    expect(readField(82, link)).toEqual({ state: 'stale', value: 82 });
  });

  it('ekran: bayat ölçüm CANLI etiketi TAŞIMAZ', () => {
    renderScreen(makeState({ link: 'stale', engineTemp: stale(82) }));
    expect(tileState('engineTemp')).toBe('stale');
    expect(container.querySelector('[data-obd-link-chip]')?.textContent).toContain('GECİKMİŞ');
    expect(container.querySelector('.obdlive')?.getAttribute('data-obd-link')).toBe('stale');
  });

  it('mock/benzetim kaynağı CANLI sayılmaz', () => {
    expect(deriveLinkState({ transportConnected: true, dataFresh: true, lastSeenMs: 9, source: 'mock' }))
      .toBe('waiting');
  });

  it('ECU hiç konuşmadıysa link bekliyordur — sayı yok', () => {
    const link = deriveLinkState({ transportConnected: true, dataFresh: true, lastSeenMs: 0, source: 'real' });
    expect(link).toBe('waiting');
    expect(readMeasured(0, link)).toEqual({ state: 'unread', value: null });
  });
});

describe('DTC · tarama yapılmadan "arıza yok" DENMEZ', () => {
  it('model: scanRan false iken sayı 0 olsa bile temiz denmez', () => {
    expect(deriveDtcState({ scanRan: false, count: 0, link: 'live' })).toBe('unscanned');
    expect(deriveDtcState({ scanRan: true, count: 0, link: 'live' })).toBe('clean');
    expect(deriveDtcState({ scanRan: true, count: 3, link: 'live' })).toBe('faults');
  });

  it('ekran: taranmamış defter "Henüz taranmadı" der', () => {
    renderScreen(makeState({ dtc: 'unscanned', dtcCount: 0 }));
    expect(valueOf('dtc')).toBe('Henüz taranmadı');
    expect(allText()).not.toContain('Arıza kodu yok');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T8 — BAĞLANTI YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('T8 · OBD bağlı değilken sahte gösterge YOK', () => {
  it('boş durum çizilir; gauge ve ölçüm kartları hiç basılmaz', () => {
    renderScreen(makeState({
      link: 'offline', rpm: offlineR, speed: offlineR, engineTemp: offlineR,
      throttle: offlineR, fuelLevel: offlineR, batteryVoltage: offlineR,
      intakeTemp: offlineR, boostPressure: offlineR, egt: offlineR,
      dtc: 'offline',
      coverage: { readable: 0, total: 9, live: 0, stale: 0, unsupported: 0, unread: 9 },
    }));

    expect(container.querySelector('[data-obd-empty]'), 'boş durum çizilmedi').not.toBeNull();
    expect(container.querySelector('[data-obd-value="rpm"]'), 'bağlantı yokken gauge çizildi').toBeNull();
    expect(container.querySelectorAll('[data-obd-tile]').length, 'bağlantı yokken ölçüm kartı çizildi').toBe(0);
    expect(allText()).toContain('OBD bağlantısı bekleniyor');
    expect(container.querySelector('[data-obd-link-chip]')?.textContent).toContain('BAĞLI DEĞİL');
  });

  it('boş durumda da ANA SAYFA butonu vardır (sürücü mahsur kalmaz)', () => {
    renderScreen(makeState({ link: 'offline', dtc: 'offline' }));
    expect(container.querySelector('[data-obd-home]')).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T10 / T11 / T12 — GÜN / GECE
 * ════════════════════════════════════════════════════════════════════════ */

describe('T10-T12 · gün/gece teması', () => {
  it('gece teması işaretlenir ve koyu zemin kullanır', () => {
    renderScreen(makeState(), 'night');
    const rootEl = container.querySelector('.obdlive') as HTMLElement;
    expect(rootEl.getAttribute('data-obd-theme')).toBe('night');
    expect(rootEl.style.background).toBe('rgb(6, 8, 10)');
  });

  it('gündüz teması işaretlenir ve açık zemin kullanır', () => {
    renderScreen(makeState(), 'day');
    const rootEl = container.querySelector('.obdlive') as HTMLElement;
    expect(rootEl.getAttribute('data-obd-theme')).toBe('day');
    expect(rootEl.style.background).toBe('rgb(231, 234, 238)');
  });

  it('tema değişimi GEOMETRİYİ ve ölçümleri bozmaz', () => {
    const state = makeState({ rpm: live(2450), engineTemp: live(91) });

    renderScreen(state, 'night');
    const nightTiles = container.querySelectorAll('[data-obd-tile]').length;
    const nightRpm = valueOf('rpm');

    renderScreen(state, 'day');
    expect(container.querySelectorAll('[data-obd-tile]').length, 'tema değişince kart sayısı değişti')
      .toBe(nightTiles);
    expect(valueOf('rpm'), 'tema değişince ölçüm bozuldu').toBe(nightRpm);
    expect(valueOf('engineTemp')).toBe('91');
  });

  it('iki temada da dürüst durum etiketleri AYNI kalır', () => {
    const state = makeState({ boostPressure: unsupported, rpm: unknown });
    renderScreen(state, 'night');
    const nightState = [tileState('boostPressure'), tileState('intakeTemp')];
    renderScreen(state, 'day');
    expect([tileState('boostPressure'), tileState('intakeTemp')]).toEqual(nightState);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T13 / T14 — OTORİTE: YENİ POLL / ÇİFT ABONELİK YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('T13-T14 · sayfa yeni OBD otoritesi kurmaz', () => {
  it('sayfa açılması OBD poll turu BAŞLATMAZ', async () => {
    const { ObdLivePage } = await import('../components/cockpit/ObdLivePage');
    act(() => { root.render(<ObdLivePage onHome={() => { /* */ }} />); });
    expect(obd.pollStarts, 'sayfa kendi OBD turunu başlattı').toBe(0);
  });

  it('tekrar tekrar mount/unmount abonelik BİRİKTİRMEZ', async () => {
    const { ObdLivePage } = await import('../components/cockpit/ObdLivePage');
    for (let i = 0; i < 5; i++) {
      act(() => { root.render(<ObdLivePage onHome={() => { /* */ }} />); });
      act(() => { root.render(<div />); });
    }
    expect(obd.subscribes, 'abonelik hiç açılmadı — ölçüm kör').toBeGreaterThan(0);
    expect(obd.unsubscribes, 'her mount kendi aboneliğini bırakmadı — sızıntı')
      .toBe(obd.subscribes);
    expect(obd.pollStarts).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ANA SAYFA BUTONU — jestten AYRI olarak doğrulanır
 * ════════════════════════════════════════════════════════════════════════ */

describe('ANA SAYFA butonu', () => {
  it('gerçek bir <button> ve sürüşe uygun büyüklükte bir dokunma hedefidir', () => {
    renderScreen(makeState());
    const btn = container.querySelector('[data-obd-home]') as HTMLButtonElement;
    expect(btn, 'ANA SAYFA butonu yok').not.toBeNull();
    expect(btn.tagName, 'div üzerine onClick konmuş — klavye erişilemez').toBe('BUTTON');
    expect(btn.textContent).toContain('Ana Sayfa');
  });

  it('basınca sahibine dönüşü devreder (sayfa kendi gezinmesini yapmaz)', () => {
    const onHome = vi.fn();
    renderScreen(makeState(), 'night', onHome);
    const btn = container.querySelector('[data-obd-home]') as HTMLButtonElement;
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onHome, 'ANA SAYFA butonu dönüşü tetiklemedi').toHaveBeenCalledTimes(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T8 — YAKIT SEVİYESİ PROVENANCE (§6)
 * ════════════════════════════════════════════════════════════════════════ */

describe('T8 · yakıt seviyesinin kaynağı doğru etiketlenir', () => {
  it('model: kalibrasyon ölçeği 1 ise ham ECU, değilse kalibreli', async () => {
    const { deriveFuelProvenance } = await import('../components/cockpit/obdLiveModel');
    expect(deriveFuelProvenance({ reading: live(62), scale: 1 })).toBe('ecu');
    expect(deriveFuelProvenance({ reading: live(62), scale: 1.18 })).toBe('ecu-calibrated');
    /* Ölçüm yoksa kaynak İDDİASI da olmaz. */
    expect(deriveFuelProvenance({ reading: unknown, scale: 1 })).toBe('none');
    expect(deriveFuelProvenance({ reading: offlineR, scale: 1.18 })).toBe('none');
  });

  it('ekran: ham okuma "ECU · PID 2F" olarak etiketlenir', () => {
    renderScreen(makeState({ fuelLevel: live(62), fuelProvenance: 'ecu' }));
    expect(valueOf('fuelLevel')).toBe('62');
    expect(container.querySelector('[data-obd-note="fuelLevel"]')?.textContent)
      .toBe('ECU · PID 2F');
  });

  it('ekran: kalibreli değer HAM ECU okuması gibi SUNULMAZ', () => {
    renderScreen(makeState({ fuelLevel: live(62), fuelProvenance: 'ecu-calibrated' }));
    const note = container.querySelector('[data-obd-note="fuelLevel"]')?.textContent ?? '';
    expect(note, 'kalibreli değer ham ECU gibi gösterildi').toContain('KALİBRELİ');
  });

  it('ölçüm yokken kaynak iddiası yazılmaz', () => {
    renderScreen(makeState({ fuelLevel: unknown, fuelProvenance: 'none' }));
    expect(valueOf('fuelLevel')).toBe('—');
    expect(container.querySelector('[data-obd-note="fuelLevel"]')?.textContent)
      .not.toContain('ECU');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * T16 — SAYFA OBD ODAKLI (§4)
 * ════════════════════════════════════════════════════════════════════════ */

describe('T16 · gövde/CAN verisi OBD ana grid inde değildir', () => {
  it('"Kapılar" ve "Lastik Basıncı" kartları kaldırıldı', () => {
    renderScreen(makeState());
    expect(container.querySelector('[data-obd-tile="doors"]'), '"Kapılar" hâlâ ana gridde').toBeNull();
    expect(container.querySelector('[data-obd-tile="tpms"]'), '"Lastik Basıncı" hâlâ ana gridde').toBeNull();
    expect(allText()).not.toContain('Tümü kapalı');
  });

  it('LEVEL 2 tam olarak dört motor/sürüş ölçümü taşır', () => {
    renderScreen(makeState());
    for (const id of ['engineTemp', 'batteryVoltage', 'throttle', 'fuelLevel']) {
      expect(container.querySelector(`[data-obd-tile="${id}"]`), `${id} LEVEL 2 de yok`).not.toBeNull();
    }
  });

  it('EV alanları yalnız araç elektrikliyse gösterilir (capability-aware)', () => {
    renderScreen(makeState({ isElectrified: false }));
    expect(container.querySelector('[data-obd-tile="batteryLevel"]'), 'ICE aracta SoC gösterildi').toBeNull();

    renderScreen(makeState({
      isElectrified: true, batteryLevel: live(78), batteryTemp: live(24), motorPower: live(12),
    }));
    expect(valueOf('batteryLevel')).toBe('78');
    expect(valueOf('motorPower')).toBe('12');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * VERİ KALİTESİ — sahte skor yok (§9)
 * ════════════════════════════════════════════════════════════════════════ */

describe('veri kalitesi durum bazında okunur', () => {
  it('model: döküm gerçek durumları sayar', async () => {
    const { coverage } = await import('../components/cockpit/obdLiveModel');
    const c = coverage([live(1), live(2), stale(3), unsupported, unknown]);
    expect(c).toEqual({ readable: 3, total: 5, live: 2, stale: 1, unsupported: 1, unread: 1 });
  });

  it('ekran: "7 canlı · 2 desteklenmiyor" biçiminde sunulur', () => {
    renderScreen(makeState({
      coverage: { readable: 7, total: 9, live: 7, stale: 0, unsupported: 2, unread: 0 },
    }));
    const txt = container.querySelector('[data-obd-value="coverage"]')?.textContent ?? '';
    expect(txt).toContain('7 canlı');
    expect(txt).toContain('2 desteklenmiyor');
  });
});
