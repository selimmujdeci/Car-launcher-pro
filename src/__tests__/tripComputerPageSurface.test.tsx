/**
 * tripComputerPageSurface.test.tsx — YOLCULUK BİLGİSAYARI sayfası.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NE KİLİTLENİYOR
 *
 * 1) OTORİTE — sayfa yeni trip motoru/telemetri/yakıt otoritesi KURMAZ;
 *    yalnız `tripLogService` ve aktif araç profilinden OKUR.
 * 2) DÜRÜSTLÜK — UNKNOWN ≠ 0 · ESTIMATED ≠ MEASURED. Kaynağı olmayan alan
 *    sayı değil DURUM gösterir; her değer kaynağıyla birlikte çizilir.
 * 3) ARAÇ İZOLASYONU — araç değişince eski aracın deposu yeni yolculuğa
 *    uygulanmaz; yakıt/maliyet `UNAVAILABLE`a düşer.
 * 4) SAHTE GRAFİK YOK — süre bileşimi ölçülmediyse çubuk çizilmez.
 * 5) JEST — mevcut kilitli davranışların HİÇBİRİ değişmez.
 *
 * Kaynak-metin araması DEĞİL: saf model doğrudan çağrılır, sunum gerçek
 * DOM'a basılır, abonelik gerçek mount/unmount ile sayılır.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  fromActiveTrip, fromCompletedRecord, selectTrip, consumptionL100,
  timeComposition, formatDuration, has, EMPTY_TRIP_COMPUTER,
  type ActiveTripView, type TripComputerState,
} from '../components/cockpit/tripComputerModel';
import { neighborFor, resolvePageSwipe, PAGE_STRIP } from '../components/cockpit/cockpitSwipeModel';

/* ── Trip otoritesi sınırı: abonelik sayılır ───────────────────────────── */
const svc = vi.hoisted(() => ({
  subscribes: 0, unsubscribes: 0, starts: 0,
  state: { active: false, current: null, history: [], totalDistanceKm: 0, totalTrips: 0 } as Record<string, unknown>,
}));

vi.mock('../platform/tripLogService', async () => {
  const React = await import('react');
  return {
    useTripState: () => {
      React.useEffect(() => {
        svc.subscribes++;
        return () => { svc.unsubscribes++; };
      }, []);
      return svc.state;
    },
    startTripLog: () => { svc.starts++; },
    stopTripLog: () => { /* no-op */ },
  };
});

import { TripComputerScreen } from '../components/cockpit/TripComputerScreen';

/* ── Render yardımcıları ───────────────────────────────────────────────── */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  svc.subscribes = 0; svc.unsubscribes = 0; svc.starts = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const CLOCK = { time: '22:28', date: 'Pazar, 20 Eyl' };

function activeTrip(over: Partial<ActiveTripView> = {}): ActiveTripView {
  return {
    startTime: 1_700_000_000_000,
    liveDistanceKm: 126.4,
    liveDurationMin: 102,
    maxSpeedKmh: 118,
    speedSum: 7400, speedCount: 100,
    gpsDistanceKm: 120, obdDistanceKm: 6.4,
    harshBrakeEvents: 1, harshAccelEvents: 2,
    metrics: {
      movingMs: 88 * 60_000, idleMs: 14 * 60_000, unknownMs: 0,
      stopCount: 3, maxRpm: 3200, maxEngineTempC: 92,
      fuelAtStartPct: 70, fuelAtEndPct: 54,
      refuelSuspected: false, obdContinuityBroken: false,
    },
    price: { unitPrice: 49, currency: 'TRY', source: 'MANUAL' },
    ...over,
  };
}

function renderScreen(state: TripComputerState, mode: 'day' | 'night' = 'night',
                      onHome = () => { /* */ }): void {
  act(() => {
    root.render(<TripComputerScreen state={state} mode={mode} clock={CLOCK} onHome={onHome} />);
  });
}

const valueOf = (k: string): string =>
  (container.querySelector(`[data-trip-value="${k}"]`)?.textContent ?? '').trim();
const cellSource = (k: string): string | null =>
  container.querySelector(`[data-trip-cell="${k}"]`)?.getAttribute('data-trip-source') ?? null;
const heroSource = (k: string): string | null =>
  container.querySelector(`[data-trip-hero="${k}"]`)?.getAttribute('data-trip-source') ?? null;
const allText = (): string => container.textContent ?? '';

/* ══════════════════════════════════════════════════════════════════════════
 * MODEL — kaynak etiketleri
 * ════════════════════════════════════════════════════════════════════════ */

describe('model · her değer kaynağıyla birlikte gelir', () => {
  it('ölçülen ve türetilen ayrılır', () => {
    const s = fromActiveTrip(activeTrip(), { tankL: 50 });
    expect(s.metrics.durationMin.source, 'süre monotonik ölçümdür').toBe('MEASURED');
    expect(s.metrics.maximumSpeedKmh.source, 'tepe hız gözlemdir').toBe('MEASURED');
    expect(s.metrics.averageSpeedKmh.source, 'ortalama hız türetilir').toBe('DERIVED');
    expect(s.metrics.movingTimeMin.source).toBe('MEASURED');
    /* GPS payı baskın → mesafe ÖLÇÜM. */
    expect(s.metrics.distanceKm.source).toBe('MEASURED');
  });

  it('OBD payı baskınsa mesafe TÜRETİLMİŞ sayılır (ölçüm İDDİA EDİLMEZ)', () => {
    const s = fromActiveTrip(activeTrip({ gpsDistanceKm: 2, obdDistanceKm: 124 }), { tankL: 50 });
    expect(s.metrics.distanceKm.source).toBe('DERIVED');
  });

  it('yakıt: ölçülen yüzde + YAPILANDIRILMIŞ depo → TÜRETİLMİŞ litre', () => {
    const s = fromActiveTrip(activeTrip(), { tankL: 50 });
    /* (70-54)% × 50 L = 8,00 L */
    expect(s.metrics.fuelUsedL.value).toBeCloseTo(8, 2);
    expect(s.metrics.fuelUsedL.source, 'yapılandırmaya dayanan değer ÖLÇÜM sayıldı')
      .toBe('DERIVED');
  });

  it('maliyet yalnız fiyat anlık görüntüsü varsa üretilir', () => {
    const withPrice = fromActiveTrip(activeTrip(), { tankL: 50 });
    expect(withPrice.metrics.estimatedCost.value).toBeCloseTo(8 * 49, 1);
    expect(withPrice.currency).toBe('TRY');

    const noPrice = fromActiveTrip(
      activeTrip({ price: { unitPrice: null, currency: null, source: 'UNAVAILABLE' } }),
      { tankL: 50 },
    );
    expect(has(noPrice.metrics.estimatedCost), 'fiyat yokken maliyet uyduruldu').toBe(false);
    expect(noPrice.priceSource, 'kaynak yokken fiyat kaynağı iddia edildi').toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * UNKNOWN ≠ 0
 * ════════════════════════════════════════════════════════════════════════ */

describe('UNKNOWN sıfır DEĞİLDİR', () => {
  it('depo yapılandırılmamışsa yakıt ve maliyet ÜRETİLMEZ', () => {
    const s = fromActiveTrip(activeTrip(), { tankL: null });
    expect(has(s.metrics.fuelUsedL), 'depo yokken litre uyduruldu').toBe(false);
    expect(has(s.metrics.estimatedCost)).toBe(false);
    expect(s.metrics.fuelUsedL.value, 'bilinmeyen değer 0 yazıldı').toBeNull();
  });

  it('yakıt alma şüphesi veya OBD kopukluğu ölçümü GEÇERSİZ kılar', () => {
    const refuel = fromActiveTrip(
      activeTrip({ metrics: { ...activeTrip().metrics, refuelSuspected: true } }), { tankL: 50 });
    expect(has(refuel.metrics.fuelUsedL), 'yakıt alındıysa tüketim hesaplandı').toBe(false);

    const broken = fromActiveTrip(
      activeTrip({ metrics: { ...activeTrip().metrics, obdContinuityBroken: true } }), { tankL: 50 });
    expect(has(broken.metrics.fuelUsedL), 'OBD kopukken tüketim hesaplandı').toBe(false);
  });

  it('hız örneği yoksa ortalama hız ÜRETİLMEZ', () => {
    const s = fromActiveTrip(activeTrip({ speedSum: 0, speedCount: 0 }), { tankL: 50 });
    expect(has(s.metrics.averageSpeedKmh)).toBe(false);
  });

  it('tüketim yalnız hem litre hem anlamlı mesafe varsa hesaplanır', () => {
    const ok = consumptionL100(fromActiveTrip(activeTrip(), { tankL: 50 }).metrics);
    expect(ok.value).toBeCloseTo((8 / 126.4) * 100, 1);
    expect(ok.source, 'tüketim litrenin kaynağından GÜÇLÜ olamaz').toBe('DERIVED');

    const tooShort = consumptionL100(
      fromActiveTrip(activeTrip({ liveDistanceKm: 0.4 }), { tankL: 50 }).metrics);
    expect(has(tooShort), 'çok kısa mesafede oran üretildi').toBe(false);
  });

  /* ── YAKIT HÜKMÜ KANONİK SAHİBİNDEN GELİR ───────────────────────────────
     Bu iki ring, sayfanın kendi yakıt kapısını YENİDEN YAZMADIĞINI kanıtlar:
     ikisi de yalnız `evaluateFuelMeasurement` / `fuelPercentToLitres`
     içinde yaşayan kurallardır. Sayfa kapıları kopyalarsa buradan kaçarlar. */

  it('fiziksel olarak makul olmayan tüketim ÖLÇÜM sayılmaz', () => {
    /* 10 km'de %20 yakıt → %200/100km. Kanonik üst sınır %60/100km. */
    const s = fromActiveTrip(activeTrip({
      liveDistanceKm: 10,
      metrics: { ...activeTrip().metrics, fuelAtStartPct: 80, fuelAtEndPct: 60 },
    }), { tankL: 50 });
    expect(has(s.metrics.fuelUsedL), 'makul olmayan tüketim ölçüm gibi sunuldu').toBe(false);
    expect(s.metrics.fuelUsedL.source).toBe('UNAVAILABLE');
  });

  it('makul olmayan depo hacmi litre ÜRETMEZ', () => {
    /* Depo bir ÖLÇÜM değil kullanıcı girdisidir; 20–200 L dışı girdi hatasıdır. */
    for (const tankL of [5, 400]) {
      const s = fromActiveTrip(activeTrip(), { tankL });
      expect(has(s.metrics.fuelUsedL), `${tankL} L depo ile litre üretildi`).toBe(false);
    }
    /* Banttaki depo ile ölçüm normal akar — ring sadece sınırı sınıyor. */
    expect(has(fromActiveTrip(activeTrip(), { tankL: 50 }).metrics.fuelUsedL)).toBe(true);
  });

  /* ── GELİŞTİRME SUNUM POLİTİKASI ────────────────────────────────────────
     Alan ekranda KALIR ve 0 gösterir; ama bu 0 SUNUMDA üretilir. Domain
     `null`/`UNAVAILABLE` kalmalıdır — aşağıdaki iki ring ikisini birlikte
     kilitler, çünkü tehlike tam olarak bu ikisinin birbirine karışmasıdır. */

  it('ekran: veri akmayan alan ekranda KALIR ve 0 gösterir', () => {
    const s = fromActiveTrip(activeTrip(), { tankL: null });
    renderScreen(s);
    /* SUNUM: alan kaybolmaz, tire değil 0 yazar. */
    expect(container.querySelector('[data-trip-cell="fuelUsed"]'),
      'veri yok diye alan ekrandan kaldırıldı').not.toBeNull();
    expect(valueOf('fuelUsed')).toBe('0,00');
    expect(valueOf('consumption')).toBe('0,0');
    expect(valueOf('cost')).toBe('0,00');
  });

  it('ekrandaki 0 ile GERÇEK 0 domain katmanında BİRLEŞMEZ', () => {
    const s = fromActiveTrip(activeTrip(), { tankL: null });
    /* DOMAIN: sayı üretilmemiştir. Sunum politikası buraya SIZMAZ. */
    expect(s.metrics.fuelUsedL.value, 'model UNAVAILABLE yerine 0 üretti').toBeNull();
    expect(s.metrics.fuelUsedL.source).toBe('UNAVAILABLE');
    expect(s.metrics.estimatedCost.value).toBeNull();
    expect(s.metrics.estimatedCost.source).toBe('UNAVAILABLE');

    /* EKRAN: 0 çizer ama gerçek kaynağı gizlemez — ayrım okunabilir kalır. */
    renderScreen(s);
    expect(cellSource('fuelUsed')).toBe('UNAVAILABLE');
    expect(container.querySelector('[data-trip-src="fuelUsed"]')?.textContent).toBe('veri yok');

    /* Gerçekten ölçülmüş bir alan AYNI ekranda farklı kaynak taşır. */
    expect(cellSource('maxSpeed')).toBe('MEASURED');
  });

  it('ekran: veri yoksa 0 yazılır ama oransal çizim DOLDURULMAZ', () => {
    renderScreen(fromActiveTrip(activeTrip({ speedSum: 0, speedCount: 0 }), { tankL: null }));
    expect(valueOf('avgSpeed')).toBe('0');
    expect(heroSource('avgSpeed')).toBe('UNAVAILABLE');
    /* Sayıya 0 yazmak ile çubuğu doldurmak AYNI iddia değildir. */
    expect(container.querySelector('[data-trip-card="speed"] .tripc-band-fill'),
      'ortalama hız ölçülmemişken hız bandı dolduruldu').toBeNull();
    expect(container.querySelector('[data-trip-card="fuel"] .tripc-band-fill'),
      'yakıt ölçülmemişken depo bandı dolduruldu').toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ESTIMATED ≠ MEASURED — ekranda görünür
 * ════════════════════════════════════════════════════════════════════════ */

describe('kaynak farkı ekranda GÖRÜNÜR', () => {
  it('ölçülen ve hesaplanan değerler farklı etiketlenir', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    expect(heroSource('duration')).toBe('MEASURED');
    expect(heroSource('avgSpeed')).toBe('DERIVED');
    expect(cellSource('maxSpeed')).toBe('MEASURED');
    expect(cellSource('fuelUsed')).toBe('DERIVED');
    expect(allText()).toContain('ölçülen');
    expect(allText()).toContain('hesaplanan');
  });

  it('üç ana değer gerçek ölçümlerle çizilir', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    expect(valueOf('distance')).toBe('126,4');
    expect(valueOf('duration')).toBe('1 sa 42 dk');
    expect(valueOf('avgSpeed')).toBe('74');
    expect(valueOf('maxSpeed')).toBe('118');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ZAMAN BİLEŞİMİ — sahte grafik yok
 * ════════════════════════════════════════════════════════════════════════ */

describe('zaman bileşimi', () => {
  it('ölçülemeyen süre duruşa YAZILMAZ, ayrı kovada kalır', () => {
    const s = fromActiveTrip(activeTrip({
      metrics: { ...activeTrip().metrics, unknownMs: 5 * 60_000 },
    }), { tankL: 50 });
    const c = timeComposition(s.metrics);
    expect(c.movingMin).toBe(88);
    expect(c.idleMin).toBe(14);
    expect(c.unknownMin, 'ölçülemeyen süre kayboldu ya da duruşa eklendi').toBe(5);
    expect(c.totalMin).toBe(107);
  });

  it('ölçüm varsa bileşim çubuğu dolar', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    expect(container.querySelector('[data-trip-bar] .tripc-band-split'),
      'ölçüm varken bileşim çubuğu boş').not.toBeNull();
  });

  it('ölçüm yoksa SAHTE bileşim doldurulmaz', () => {
    const s = fromActiveTrip(activeTrip({
      metrics: { ...activeTrip().metrics, movingMs: -1, idleMs: -1, unknownMs: -1 },
    }), { tankL: 50 });
    renderScreen(s);
    /* Alan (yuva) kalır — politika gereği; DOLGU çizilmez — kanıt gereği. */
    expect(container.querySelector('[data-trip-bar]'), 'bileşim yuvası kaldırıldı').not.toBeNull();
    expect(container.querySelector('[data-trip-bar] .tripc-band-split'),
      'ölçüm yokken sahte bileşim çizildi').toBeNull();
    expect(valueOf('movingMin'), 'ölçülemeyen hareket süresi 0 dk göstermeli').toBe('0 dk');
    expect(allText()).toContain('ölçülmedi');
  });

  it('bileşim çubuğu KRONOLOJİK sıra iddia etmez', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    /* Sistem kronolojik segment tutmuyor; çubuk yalnız TOPLAM ORAN der. */
    expect(allText()).toContain('toplam oran');
  });

  it('SÜREN yolculukta sahte bitiş saati gösterilmez', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    const end = container.querySelector('[data-trip-value="endedAt"]')?.textContent ?? '';
    expect(end, 'süren yolculukta duvar saati bitiş gibi gösterildi').toBe('sürüyor');
    expect(end).not.toMatch(/\d{2}:\d{2}/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ARAÇ İZOLASYONU
 * ════════════════════════════════════════════════════════════════════════ */

describe('araç değişiminde eski veri SIZMAZ', () => {
  it('depo hacmi değişince yakıt yeniden hesaplanır', () => {
    const a = fromActiveTrip(activeTrip(), { tankL: 50 });
    const b = fromActiveTrip(activeTrip(), { tankL: 80 });
    expect(a.metrics.fuelUsedL.value).toBeCloseTo(8, 2);
    expect(b.metrics.fuelUsedL.value, 'eski aracın deposu korunmuş').toBeCloseTo(12.8, 2);
  });

  it('yeni araçta depo yapılandırılmamışsa yakıt UNAVAILABLE olur', () => {
    const s = fromActiveTrip(activeTrip(), { tankL: null });
    expect(s.metrics.fuelUsedL.source, 'eski aracın litresi taşındı').toBe('UNAVAILABLE');
  });

  it('yolculuk yoksa sahte sıfır özet üretilmez', () => {
    const s = selectTrip({ active: false, current: null, history: [] }, { tankL: 50 });
    expect(s).toEqual(EMPTY_TRIP_COMPUTER);
    expect(s.view).toBe('none');
    renderScreen(s);
    expect(container.querySelector('[data-trip-empty]')).not.toBeNull();
    expect(container.querySelector('[data-trip-hero]'), 'yolculuk yokken ana değer çizildi').toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SEÇİM · SEKME YOK
 * ════════════════════════════════════════════════════════════════════════ */

describe('hangi yolculuk gösterilir', () => {
  it('süren yolculuk varsa O gösterilir', () => {
    const s = selectTrip({ active: true, current: activeTrip() as never, history: [] }, { tankL: 50 });
    expect(s.view).toBe('active');
  });

  it('süren yolculuk yoksa SON tamamlanan gösterilir', () => {
    const rec = {
      id: 't1', startTime: 1, endTime: 2, distanceKm: 42, durationMin: 30,
      avgSpeedKmh: 60, maxSpeedKmh: 95, fuelConsumptionL: null, fuelCostTL: null,
      drivingScore: 80, harshEvents: 0,
    };
    const s = selectTrip({ active: false, current: null, history: [rec as never] }, { tankL: 50 });
    expect(s.view).toBe('last');
    expect(s.metrics.distanceKm.value).toBe(42);
    /* Kayıtta litre `null` → UYDURULMAZ. */
    expect(has(s.metrics.fuelUsedL), 'kayıtta olmayan yakıt üretildi').toBe(false);
  });

  it('tamamlanmış yolculuk hükmü KANONİK dönüştürücüden gelir', () => {
    const rec = {
      id: 't2', startTime: 1, endTime: 2, distanceKm: 10, durationMin: 10,
      avgSpeedKmh: 60, maxSpeedKmh: 90, fuelConsumptionL: 1.2, fuelCostTL: 60,
      drivingScore: 90, harshEvents: 0,
      fuelSource: 'MEASURED' as const, costSource: 'DERIVED' as const,
      distanceSource: 'MEASURED' as const,
    };
    const s = fromCompletedRecord(rec as never);
    expect(s.metrics.fuelSource ?? s.metrics.fuelUsedL.source).toBe('MEASURED');
    expect(s.metrics.estimatedCost.source).toBe('DERIVED');
    expect(s.metrics.distanceKm.source).toBe('MEASURED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * TEMA · ABONELİK · JEST
 * ════════════════════════════════════════════════════════════════════════ */

describe('tema', () => {
  it('gece ve gündüz ayrı zemin kullanır, hiyerarşi bozulmaz', () => {
    const s = fromActiveTrip(activeTrip(), { tankL: 50 });

    renderScreen(s, 'night');
    const night = container.querySelector('.tripc') as HTMLElement;
    expect(night.getAttribute('data-trip-theme')).toBe('night');
    expect(night.style.background).toBe('rgb(6, 8, 10)');
    const heroes = container.querySelectorAll('[data-trip-hero]').length;

    renderScreen(s, 'day');
    const day = container.querySelector('.tripc') as HTMLElement;
    expect(day.getAttribute('data-trip-theme')).toBe('day');
    expect(day.style.background).toBe('rgb(231, 234, 238)');
    expect(container.querySelectorAll('[data-trip-hero]').length).toBe(heroes);
    expect(valueOf('distance')).toBe('126,4');
  });
});

describe('abonelik yaşam döngüsü', () => {
  it('sayfa yeni trip motoru BAŞLATMAZ ve abonelik biriktirmez', async () => {
    const { TripComputerPage } = await import('../components/cockpit/TripComputerPage');
    for (let i = 0; i < 5; i++) {
      act(() => { root.render(<TripComputerPage onHome={() => { /* */ }} />); });
      act(() => { root.render(<div />); });
    }
    expect(svc.starts, 'sayfa kendi trip kaydını başlattı').toBe(0);
    expect(svc.subscribes, 'abonelik hiç açılmadı — ölçüm kör').toBeGreaterThan(0);
    expect(svc.unsubscribes, 'abonelik sızdı').toBe(svc.subscribes);
  });
});

describe('jest davranışı korunur', () => {
  it('şerit yolculuk sayfasını UCA ekler', () => {
    expect([...PAGE_STRIP]).toEqual(['trip', 'obd', 'cockpit', 'home']);
  });

  it('kilitli davranışların HİÇBİRİ değişmez', () => {
    expect(neighborFor('home', 600)).toBe('cockpit');
    expect(neighborFor('home', -600)).toBe('cockpit');
    expect(neighborFor('cockpit', -600)).toBe('home');
    expect(neighborFor('cockpit', 600)).toBe('obd');
    expect(neighborFor('obd', -600)).toBe('cockpit');
  });

  it('OBD den SAĞA kaydırma yolculuk sayfasını açar', () => {
    expect(neighborFor('obd', 600)).toBe('trip');
    expect(resolvePageSwipe({ page: 'obd', dx: 600, viewportWidth: 1024, isDriving: false }))
      .toMatchObject({ committed: true, target: 'trip' });
  });

  it('yolculuk ucundadır: her iki yön de OBD ye döner', () => {
    expect(neighborFor('trip', 600)).toBe('obd');
    expect(neighborFor('trip', -600)).toBe('obd');
  });

  it('sürüş güvenliği eşiği DEĞİŞMEDİ', () => {
    expect(resolvePageSwipe({ page: 'obd', dx: 200, viewportWidth: 1024, isDriving: true }).committed)
      .toBe(false);
  });
});

describe('ANA SAYFA butonu', () => {
  it('gerçek bir <button> ve dönüşü sahibine devreder', () => {
    const onHome = vi.fn();
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }), 'night', onHome);
    const btn = container.querySelector('[data-trip-home]') as HTMLButtonElement;
    expect(btn.tagName).toBe('BUTTON');
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});

describe('süre biçimi', () => {
  it('saat ve dakika dürüstçe yazılır, ölçüm yoksa null döner', () => {
    expect(formatDuration(102)).toBe('1 sa 42 dk');
    expect(formatDuration(42)).toBe('42 dk');
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * EKRANDA GÖSTERİLEN YOLCULUK VERİSİ — kapsam kilidi
 * ════════════════════════════════════════════════════════════════════════ */

describe('sayfa yolculuğa ait TÜM ölçümleri gösterir', () => {
  it('sürüş olayları ekrandadır (sert fren · ani hızlanma · duruş)', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    expect(valueOf('harshBrake'), 'sert fren sayısı ekranda yok').toBe('1');
    expect(valueOf('harshAccel'), 'ani hızlanma sayısı ekranda yok').toBe('2');
    expect(valueOf('stopCount'), 'duruş sayısı ekranda yok').toBe('3');
  });

  it('OBD/motor telemetrisi bu sayfada GÖSTERİLMEZ', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    /* Maks devir ve motor sıcaklığı ölçülmüş olsa bile OBD sayfasına aittir. */
    expect(container.querySelector('[data-trip-value="maxRpm"]'),
      'motor devri yolculuk sayfasına sızdı').toBeNull();
    expect(container.querySelector('[data-trip-value="maxEngineTemp"]'),
      'motor sıcaklığı yolculuk sayfasına sızdı').toBeNull();
    expect(allText()).not.toContain('d/dk');
  });

  it('halka dilimleri GERÇEK zaman bileşiminden gelir', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    const ring = container.querySelector('.tripc-ring');
    expect(ring, 'halka çizilmedi').not.toBeNull();
    /* hareket + duruş = iki dilim (ölçülemeyen 0 olduğu için çizilmez) */
    const slices = ring!.querySelectorAll('g circle');
    expect(slices.length, 'dilim sayısı ölçümle uyuşmuyor').toBe(2);
  });

  it('süre bileşimi ölçülmemişse halka dilimi ÇİZİLMEZ', () => {
    renderScreen(fromActiveTrip(activeTrip({
      metrics: { ...activeTrip().metrics, movingMs: -1, idleMs: -1, unknownMs: -1 },
    }), { tankL: 50 }));
    const ring = container.querySelector('.tripc-ring');
    expect(ring!.querySelectorAll('g circle').length, 'ölçüm yokken sahte dilim çizildi').toBe(0);
  });

  it('depo hacmi varsa yakıt depoya oranla gösterilir', () => {
    renderScreen(fromActiveTrip(activeTrip(), { tankL: 50 }));
    expect(allText()).toContain('50 L depo');
    expect(container.querySelector('[data-trip-card="fuel"] .tripc-band-fill')).not.toBeNull();
  });
});
