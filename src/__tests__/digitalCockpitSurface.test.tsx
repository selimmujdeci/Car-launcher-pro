/**
 * digitalCockpitSurface.test — CarOS Digital Cockpit (HOME'un komşu sayfası).
 *
 * Kapsam:
 *   1. Head unit geometrisi: sınırlar, hiyerarşi, gerçek dokunma alanları
 *   2. Gün/gece AYNI geometri, yalnız token farkı
 *   3. Fail-closed gösterim: ölçülmemiş alan `—`, sahte `0` YOK
 *   4. Swipe kararı: ses jestiyle çakışmaz, sürüşte eşik yükselir
 *   5. HOME dokunulmazlığı: HOME ağacı kokpite BAĞLANMAZ (tek yönlü bağımlılık)
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  COCKPIT_CANVAS, COCKPIT_REGIONS, COCKPIT_RESPONSIVE_TARGETS, COCKPIT_MIN_TOUCH_PX,
  cockpitScale, cockpitTokensFor,
} from '../components/cockpit/cockpitLayout';
import {
  EM_DASH, EMPTY_COCKPIT_STATE, fmtSpeed, fmtRpmThousands, fmtCoolant, fmtRange,
  fmtConsumption, fmtOdometer, fmtAmbient, fmtManeuverDistance,
  coolantFill, fuelFill, rpmFill, gearLabel, driveModeLabel,
} from '../components/cockpit/cockpitDataModel';
import {
  canBeginPageSwipe, classifyPageDrag, resolvePageSwipe, commitDistancePx,
  entrySideForDrag, COMMIT_RATIO_PARKED, COMMIT_RATIO_DRIVING,
} from '../components/cockpit/cockpitSwipeModel';
import { DigitalCockpitScreen } from '../components/cockpit/DigitalCockpitScreen';
import { COCKPIT_REFERENCE_STATE, COCKPIT_REFERENCE_CLOCK } from './fixtures/cockpitReferenceState';

/** Repo deseni: `renderToStaticMarkup` + DOM'a bas, sonra sorgula (ekstra bağımlılık yok). */
function render(node: React.ReactElement): { container: HTMLElement } {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(node);
  return { container };
}

const texts = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('text, [data-cockpit-copy]')].map((n) => (n.textContent ?? '').trim());

/** Yalnız ÖLÇÜM metinleri — devir skalasının sabit etiketleri (0·2·4·6·8) hariç. */
const measurementTexts = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('text:not([data-cockpit-scale]), [data-cockpit-copy]')].map((n) => (n.textContent ?? '').trim());

/** Kaynaktaki YALNIZ import satırları — yorumlardaki ad geçişleri sayılmaz. */
const importLines = (src: string): string =>
  src.split(/\r?\n/).filter((l) => /^\s*import\s|^\s*\}\s*from\s|^\s*from\s/.test(l)).join(' | ');

/* ══════════════════════════════════════════════════════════════════════════
 * 1) GEOMETRİ — head unit sınırları ve gerçek dokunma alanları
 * ════════════════════════════════════════════════════════════════════════ */

describe('cockpit geometrisi — 1024×600 head unit', () => {
  it('ana hedefi küçültmeden doldurur', () => {
    expect(COCKPIT_CANVAS).toEqual({ width: 1024, height: 600 });
    expect(cockpitScale(1024, 600)).toBe(1);
  });

  it('bilgi bölgeleri tuval içinde kalır, ana değerler ve medya/sürüş bölgeleri çakışmaz', () => {
    for (const [name, r] of Object.entries(COCKPIT_REGIONS)) {
      expect(r.x, name).toBeGreaterThanOrEqual(0);
      expect(r.y, name).toBeGreaterThanOrEqual(0);
      expect(r.w, name).toBeGreaterThan(0);
      expect(r.h, name).toBeGreaterThan(0);
      expect(r.x + r.w, name).toBeLessThanOrEqual(COCKPIT_CANVAS.width);
      expect(r.y + r.h, name).toBeLessThanOrEqual(COCKPIT_CANVAS.height);
    }
    const { leftCluster: left, speedCluster: speed, rightCluster: right, maneuverBar: nav, musicCard: music, assistCard: driving } = COCKPIT_REGIONS;
    expect(left.x + left.w).toBeLessThan(speed.x);
    expect(speed.x + speed.w).toBeLessThan(right.x);
    expect(speed.y + speed.h).toBeLessThan(nav.y);
    expect(music.x + music.w).toBeLessThan(driving.x);
    expect(speed.x + speed.w / 2).toBe(COCKPIT_CANVAS.width / 2);
  });

  it('ölçek formülü: s = min(vw/1024, vh/600), kırpma yok', () => {
    for (const [w, h] of COCKPIT_RESPONSIVE_TARGETS) {
      expect(cockpitScale(w, h)).toBeCloseTo(Math.min(w / 1024, h / 600), 6);
    }
    // Ölçülemeyen viewport → 1'e düşer (sıfır boyutlu ilk kare olmaz).
    expect(cockpitScale(0, 0)).toBe(1);
    expect(cockpitScale(Number.NaN, 600)).toBe(1);
  });

  it('hedef çözünürlüklerde müzik transportu asgari dokunma hedefini korur', () => {
    const { container } = render(<DigitalCockpitScreen state={COCKPIT_REFERENCE_STATE} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />);
    const controls = [...container.querySelectorAll('button')];
    expect(controls).toHaveLength(3);
    for (const [w, h] of COCKPIT_RESPONSIVE_TARGETS) {
      for (const button of controls) {
        // Önceki test her iki tarafı da küçülterek 35 px hedefi yanlış kabul ediyordu.
        expect(parseFloat(button.style.width) * cockpitScale(w, h)).toBeGreaterThanOrEqual(COCKPIT_MIN_TOUCH_PX);
        expect(parseFloat(button.style.height) * cockpitScale(w, h)).toBeGreaterThanOrEqual(COCKPIT_MIN_TOUCH_PX);
      }
    }
  });
});

describe('gün/gece — AYNI geometri, YALNIZ token farkı', () => {
  it('token setleri farklı ama tuval/bölgeler aynı', () => {
    const day = cockpitTokensFor('day');
    const night = cockpitTokensFor('night');
    expect(day.canvas).not.toBe(night.canvas);
    expect(day.textPrimary).not.toBe(night.textPrimary);
    expect(day.surfaceTop).not.toBe(night.surfaceTop);
    expect(day.shelf).not.toBe(night.shelf);
    expect(day.sign).not.toBe(night.sign);
  });

  it('iki modda da bölge kutuları birebir aynı yerde çizilir', () => {
    const boxOf = (mode: 'day' | 'night') => {
      const { container } = render(
        <DigitalCockpitScreen state={COCKPIT_REFERENCE_STATE} mode={mode} clock={COCKPIT_REFERENCE_CLOCK} />,
      );
      const out = [...container.querySelectorAll('[data-cockpit-region]')]
        .map((n) => ({
          name: n.getAttribute('data-cockpit-region'),
          geometry: [...n.querySelectorAll('text, rect, path, circle, line, foreignObject')].map(el =>
            ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'd', 'transform', 'font-size', 'text-anchor']
              .map(attr => el.getAttribute(attr))),
        }));
      return out;
    };
    expect(boxOf('day')).toEqual(boxOf('night'));
    expect(boxOf('day').map(r => r.name)).toEqual(expect.arrayContaining(['leftCluster', 'rightCluster', 'speedCluster']));
  });

  it('her palette ana ve ikincil metinler yüksek kontrastı korur', () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (a: string, b: string) => {
      const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
      return (high + 0.05) / (low + 0.05);
    };
    for (const mode of ['day', 'night'] as const) {
      const t = cockpitTokensFor(mode);
      for (const surface of [t.canvas, t.surfaceTop, t.surfaceBottom, t.shelf]) {
        expect(contrast(t.textPrimary, surface), mode).toBeGreaterThanOrEqual(7);
        expect(contrast(t.textSecondary, surface), mode).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(luminance(cockpitTokensFor('night').sign)).toBeLessThan(luminance(cockpitTokensFor('day').sign));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) FAIL-CLOSED GÖSTERİM
 * ════════════════════════════════════════════════════════════════════════ */

describe('fail-closed biçimlendirme — sahte 0 YASAK', () => {
  it('null her biçimlendiricide em dash üretir', () => {
    expect(fmtSpeed(null)).toBe(EM_DASH);
    expect(fmtRpmThousands(null)).toBe(EM_DASH);
    expect(fmtCoolant(null)).toBe(EM_DASH);
    expect(fmtRange(null)).toBe(EM_DASH);
    expect(fmtConsumption(null)).toBe(EM_DASH);
    expect(fmtOdometer(null)).toBe(EM_DASH);
    expect(fmtAmbient(null)).toBe(EM_DASH);
    expect(fmtManeuverDistance(null)).toBe(EM_DASH);
  });

  it('fiziksel bant dışı okuma ÖLÇÜM SAYILMAZ (0 değil, em dash)', () => {
    expect(fmtSpeed(999)).toBe(EM_DASH);
    expect(fmtSpeed(-1)).toBe(EM_DASH);
    expect(fmtRpmThousands(99_000)).toBe(EM_DASH);
    expect(fmtCoolant(-273)).toBe(EM_DASH);
    expect(fmtConsumption(900)).toBe(EM_DASH);
  });

  it('gerçek 0 ile "bilinmiyor" AYRI: duran araç 0 gösterir', () => {
    expect(fmtSpeed(0)).toBe('0');
    expect(fmtRpmThousands(0)).toBe('0.0');
  });

  it('doluluk oranları ölçüm yoksa 0 değil null döner', () => {
    expect(coolantFill(null)).toBeNull();
    expect(fuelFill(null)).toBeNull();
    expect(rpmFill(null, 8000)).toBeNull();
    expect(coolantFill(92)).toBeCloseTo(0.65, 2);
    expect(fuelFill(65)).toBeCloseTo(0.65, 2);
  });

  it('biçim referansla uyumlu (odometre tr-TR, manevra mesafesi)', () => {
    expect(fmtOdometer(8326)).toBe('8.326 km');
    expect(fmtRpmThousands(1800)).toBe('1.8');
    expect(fmtCoolant(92)).toBe('92°C');
    expect(fmtConsumption(6.1)).toBe('6.1 L/100km');
    expect(fmtManeuverDistance(300)).toBe('300 m');
    expect(fmtManeuverDistance(1500)).toBe('1.5 km');
    expect(fmtManeuverDistance(2340)).toBe('2.3 km');
  });

  it('vites/sürüş modu etiketi uydurulmaz', () => {
    expect(gearLabel(null)).toBeNull();
    expect(gearLabel(undefined)).toBeNull();
    expect(gearLabel(-1)).toBe('R');
    expect(gearLabel(0)).toBe('N/P');   // CAN ikisini ayırmıyor → iddia edilmez
    expect(gearLabel(3)).toBe('D');
    expect(driveModeLabel(null)).toBeNull();
    expect(driveModeLabel('eco')).toBe('ECO');
  });
});

describe('ekran — ölçüm yokken hiçbir sayı UYDURMAZ', () => {
  it('boş durumda em dash çizilir ve "0" ekrana çıkmaz', () => {
    const { container } = render(
      <DigitalCockpitScreen state={EMPTY_COCKPIT_STATE} mode="night"
        clock={{ time: '--:--', date: '' }} />,
    );
    const all = measurementTexts(container);
    expect(all.filter((x) => x === EM_DASH).length).toBeGreaterThanOrEqual(6);
    // Hiçbir metin düz "0" ya da "0 km" gibi sahte bir ölçüm olmamalı.
    expect(all).not.toContain('0');
    expect(all).not.toContain('0 km');
    expect(all).not.toContain('0°C');
  });

  it('hız limiti hükmü yoksa LEVHA HİÇ ÇİZİLMEZ', () => {
    const { container } = render(
      <DigitalCockpitScreen state={EMPTY_COCKPIT_STATE} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />,
    );
    expect(container.querySelector('[data-cockpit-speedlimit]')).toBeNull();
  });

  it('navigasyon yoksa manevra çubuğu HİÇ ÇİZİLMEZ (eski adım gösterilmez)', () => {
    const { container } = render(
      <DigitalCockpitScreen state={EMPTY_COCKPIT_STATE} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />,
    );
    expect(container.querySelector('[data-cockpit-region="maneuverBar"]')).toBeNull();
  });

  it('ADAS authority yok: şerit/araç/takip rozetleri yerine yalnız dekoratif yüzey vardır', () => {
    const { container } = render(
      <DigitalCockpitScreen state={COCKPIT_REFERENCE_STATE} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />,
    );
    expect(COCKPIT_REFERENCE_STATE.laneAssist).toBeNull();
    const horizon = container.querySelector('[data-cockpit-decoration="abstract-horizon"]');
    expect(horizon?.getAttribute('aria-hidden')).toBe('true');
    expect(horizon?.getAttribute('pointer-events')).toBe('none');
    expect(texts(container).join(' ')).not.toMatch(/şerit|radar|takip mesafesi|otonom|asistanı aktif/i);
    const source = readFileSync(resolve('src/components/cockpit/DigitalCockpitScreen.tsx'), 'utf8');
    expect(source).not.toMatch(/state\.laneAssist|state\.followingAssist|skyGrad|roadGrad|RoadScene/);
  });

  it('hız limiti KESİN değilse levha kesikli çizilir', () => {
    const { container } = render(
      <DigitalCockpitScreen
        state={{ ...COCKPIT_REFERENCE_STATE, speedLimitDefinitive: false }}
        mode="day" clock={COCKPIT_REFERENCE_CLOCK} />,
    );
    const sign = container.querySelector('[data-cockpit-speedlimit]');
    expect(sign?.getAttribute('data-cockpit-speedlimit')).toBe('uncertain');
    expect(sign?.querySelector('circle')?.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('referans durumu referans değerleri çizer (pixel-match karşılaştırma tabanı)', () => {
    const { container } = render(
      <DigitalCockpitScreen state={COCKPIT_REFERENCE_STATE} mode="night" clock={COCKPIT_REFERENCE_CLOCK} />,
    );
    const all = texts(container);
    for (const expected of ['72', 'km/h', '80', '1.8', '92°C', '520', '6.1 L/100km',
      '8.326 km', '300 m', 'Gazi Paşa Blv.', 'Leyla', 'Mabel Matiz', 'D', 'ECO', '24°C', '21:11']) {
      expect(all).toContain(expected);
    }
  });

  it('sıfır yakıt/sıcaklık sıfır doluluk taşır; unknown doluluk ve RPM işaretçisi çizmez', () => {
    const zero = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE, fuelLevelPct: 0, coolantTempC: 0, rpm: 0 }} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />).container;
    expect(zero.querySelector('[data-cockpit-value="fuel"]')?.textContent).toBe('%0');
    expect(zero.querySelector('[data-cockpit-fuel-fill]')?.getAttribute('width')).toBe('0');
    expect(zero.querySelector('[data-cockpit-coolant-fill]')?.getAttribute('width')).toBe('0');
    expect(zero.querySelector('[data-cockpit-rpm-marker]')).not.toBeNull();
    const unknown = render(<DigitalCockpitScreen state={EMPTY_COCKPIT_STATE} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />).container;
    expect(unknown.querySelector('[data-cockpit-fuel-fill], [data-cockpit-coolant-fill], [data-cockpit-rpm-marker]')).toBeNull();
  });

  it('bayat sıcaklık sunuma dolu gelse bile canlı sayı gösterilmez', () => {
    const { container } = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE, coolantFreshness: 'STALE' }} mode="night" clock={COCKPIT_REFERENCE_CLOCK} />);
    expect(container.querySelector('[data-cockpit-value="coolant"]')?.textContent).toBe(EM_DASH);
    expect(container.querySelector('[data-cockpit-coolant-fill]')).toBeNull();
    expect(texts(container)).toContain('Veri güncel değil');
  });

  it.each([null, 'unrecognized', 'roundabout'])('yönü bilinmeyen manevra (%s) sağa dönüş uydurmaz', type => {
    const { container } = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE,
      maneuver: { distanceMeters: 300, label: 'Bağlantı', type, modifier: null },
    }} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />);
    expect(container.querySelector('[data-cockpit-maneuver-icon]')).toBeNull();
    expect(container.querySelector('[data-cockpit-maneuver-unknown]')?.textContent).toBe(EM_DASH);
    expect(texts(container)).toContain('300 m');
  });

  it('🔒 dönel kavşak YALNIZ çıkış numarası biliniyorsa simgeyle; numara ve metin gösterilir', () => {
    const { container } = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE,
      maneuver: { distanceMeters: 650, label: 'Cumhuriyet Bulvarı', type: 'roundabout', modifier: 'straight', roundaboutExit: 2 },
    }} mode="night" clock={COCKPIT_REFERENCE_CLOCK} />);
    expect(container.querySelector('[data-cockpit-roundabout-exit="2"]')).not.toBeNull();
    expect(texts(container)).toContain('2. çıkış · Cumhuriyet Bulvarı');
  });

  it('🔒 dönüşe 100 m kala kart vurgulanır; uzakta vurgulanmaz', () => {
    const at = (d: number) => render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE,
      maneuver: { distanceMeters: d, label: 'X', type: 'turn', modifier: 'right' } }} mode="night" clock={COCKPIT_REFERENCE_CLOCK} />).container;
    expect(at(60).querySelector('[data-cockpit-maneuver-imminent="true"]')).not.toBeNull();
    expect(at(400).querySelector('[data-cockpit-maneuver-imminent="true"]')).toBeNull();
  });

  it('yakın ikinci manevra "ardından" olarak gösterilir; bilinmeyen yön gösterilmez', () => {
    const withThen = (then: { type: string | null; modifier: string | null }) => render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE,
      maneuver: { distanceMeters: 200, label: 'X', type: 'turn', modifier: 'right', then } }} mode="night" clock={COCKPIT_REFERENCE_CLOCK} />).container;
    expect(withThen({ type: 'turn', modifier: 'left' }).querySelector('[data-cockpit-maneuver-then]')).not.toBeNull();
    expect(withThen({ type: 'mystery', modifier: null }).querySelector('[data-cockpit-maneuver-then]')).toBeNull();
  });

  it('medya/sürüş yüzeyi: transport jestten muaf ve izinsizken native disabled', () => {
    const { container } = render(<DigitalCockpitScreen state={EMPTY_COCKPIT_STATE} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />);
    expect(container.querySelector('[data-caros-cockpit="screen"]')?.getAttribute('role')).toBe('group');
    for (const button of container.querySelectorAll('button')) {
      expect(button.disabled).toBe(true);
      expect(button.closest('[data-no-page-swipe]')).not.toBeNull();
    }
    expect(texts(container)).toContain('SÜRÜŞ TERCİHİ');
    expect(texts(container)).toContain('Profil değeri');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) SWIPE KARARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('sayfa jesti — mevcut jestlerle çakışmaz, sürüşte kontrollü', () => {
  const VW = 1280;

  it('jest EKRANIN HER YERİNDEN başlayabilir — hem HOME hem Cockpit (saha talebi)', () => {
    expect(canBeginPageSwipe({ blocked: false })).toBe(true);
    // Sabit kenar bandı YOK: tek koşul üstte bloklayan bir yüzeyin olmaması.
  });

  it('tam ekran yüzey açıkken (blocked) jest HİÇ başlamaz', () => {
    expect(canBeginPageSwipe({ blocked: true })).toBe(false);
  });

  it('DİKEY baskın hareket reddedilir — ses jestiyle (VolumeGestureLayer) çakışmaz', () => {
    expect(classifyPageDrag({ page: 'home', dx: 20, dy: -90 })).toBe('rejected');
    expect(classifyPageDrag({ page: 'home', dx: 20, dy: 60 })).toBe('rejected');
    // Yatay baskınlık sağlanınca kabul edilir.
    expect(classifyPageDrag({ page: 'home', dx: 80, dy: 20 })).toBe('engaged');
  });

  it('YÖN DAYATILMAZ: HOME\'da her iki yatay yön de sayfa jestidir', () => {
    // Saha dersi: önce SOLA, sonra SAĞA dayatıldı; ikisinde de kullanıcı açamadı.
    expect(classifyPageDrag({ page: 'home', dx: -90, dy: 5 })).toBe('engaged');
    expect(classifyPageDrag({ page: 'home', dx: 90, dy: 5 })).toBe('engaged');
  });

  it('Cockpit\'te de her iki yatay yön HOME\'a döndürür', () => {
    expect(classifyPageDrag({ page: 'cockpit', dx: 90, dy: 5 })).toBe('engaged');
    expect(classifyPageDrag({ page: 'cockpit', dx: -90, dy: 5 })).toBe('engaged');
  });

  it('giriş kenarı jestten TÜRETİLİR — içerik parmağın gittiği yöne akar', () => {
    expect(entrySideForDrag(-120)).toBe('right'); // parmak sola → sayfa sağdan
    expect(entrySideForDrag(120)).toBe('left');   // parmak sağa → sayfa soldan
  });

  it('küçük hareket kararsızdır (normal dokunuşlar UI\'ya gider)', () => {
    expect(classifyPageDrag({ page: 'home', dx: 6, dy: 3 })).toBe('pending');
  });

  it('SÜRÜŞTE eşik park hâlinden BELİRGİN yüksektir (yanlışlıkla geçiş olmaz)', () => {
    const parked = commitDistancePx(VW, false);
    const driving = commitDistancePx(VW, true);
    expect(parked).toBeCloseTo(VW * COMMIT_RATIO_PARKED, 5);
    expect(driving).toBeCloseTo(VW * COMMIT_RATIO_DRIVING, 5);
    expect(driving).toBeGreaterThan(parked * 1.5);

    // Park hâlinde geçen mesafe sürüşte GEÇMEZ. (HOME → sağa kaydırma: dx > 0.)
    const dx = parked + 10;
    expect(resolvePageSwipe({ page: 'home', dx, viewportWidth: VW, isDriving: false }).committed).toBe(true);
    expect(resolvePageSwipe({ page: 'home', dx, viewportWidth: VW, isDriving: true }).committed).toBe(false);
  });

  it('hızlı fırlatma kabul edilir ama titreme (çok kısa yol) kabul EDİLMEZ', () => {
    const fling = resolvePageSwipe({
      page: 'home', dx: 90, viewportWidth: VW, isDriving: true, velocityPxPerMs: 1.4,
    });
    expect(fling.committed).toBe(true);
    const jitter = resolvePageSwipe({
      page: 'home', dx: 20, viewportWidth: VW, isDriving: false, velocityPxPerMs: 3,
    });
    expect(jitter.committed).toBe(false);
  });

  it('kabul edilen jest doğru hedefe gider', () => {
    expect(resolvePageSwipe({ page: 'home', dx: 600, viewportWidth: VW, isDriving: false }).target).toBe('cockpit');
    expect(resolvePageSwipe({ page: 'cockpit', dx: -600, viewportWidth: VW, isDriving: false }).target).toBe('home');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) HOME DOKUNULMAZLIK KİLİDİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('HOME dokunulmazlığı — bağımlılık TEK YÖNLÜ', () => {
  const readSrc = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

  it('HOME ağacındaki hiçbir dosya kokpiti import ETMEZ', () => {
    for (const f of [
      'src/components/layout/MainLayout.tsx',
      'src/components/layout/NewHomeLayout.tsx',
      'src/components/layout/DockBar.tsx',
      'src/components/themes/TeslaLayout.tsx',
      'src/components/themes/ProLayout.tsx',
      'src/components/themes/HorizonLayout.tsx',
      'src/components/themes/ExpeditionLayout.tsx',
    ]) {
      expect(readSrc(f), `${f} kokpite bağlanmamalı`).not.toMatch(/components\/cockpit/);
    }
  });

  it('gerçekten yatay kaydırılabilen HOME kartları data-no-page-swipe ile korunur (jest artık her yerden başlıyor)', () => {
    // Kenar bandı kısıtı kaldırıldığı için dock/carousel'lerin `touch-action:pan-x`
    // kaydırması sayfa jestine kurban gitmesin.
    for (const f of [
      'src/components/layout/DockBar.tsx',
      'src/components/themes/TeslaLayout.tsx',
      'src/components/themes/ProLayout.tsx',
      'src/components/themes/HorizonLayout.tsx',
      'src/components/themes/ExpeditionLayout.tsx',
    ]) {
      expect(readSrc(f), `${f} touch-action:pan-x kaydırıcısı data-no-page-swipe taşımalı`)
        .toMatch(/data-no-page-swipe/);
    }
  });

  it('DrawerShell KULLANMAYAN düşük z-index tam ekran yüzeyler data-no-page-swipe ile korunur (saha bulgusu)', () => {
    // FullMapView (z=50) · SplitScreen (z=60) · RearViewCamera (z=90) kendi
    // z-index'lerini yönetir ve `isBlockedByDom`'un z≥900 taramasından KAÇAR.
    // ÖLÇÜLDÜ: tam ekran navigasyonun manevra kartı üzerinden başlayan bir
    // kaydırma, bu öznitelik olmadan sayfa jestine kurban gidiyordu.
    for (const f of [
      'src/components/map/FullMapView.tsx',
      'src/components/split/SplitScreen.tsx',
      'src/components/camera/RearViewCamera.tsx',
    ]) {
      expect(readSrc(f), `${f} düşük z-index'li kökü data-no-page-swipe taşımalı`)
        .toMatch(/data-no-page-swipe/);
    }
  });

  it('mini harita ve alt dock kökü sayfa jestinden MUAF (kullanıcı haritayı sağa-sola çekebilmeli)', () => {
    // Saha talebi: harita üstünde yatay çekme = harita pan; dock üstünde = dock kaydırma.
    // Sayfa jesti yalnız bu iki yüzeyin DIŞINDA çalışır.
    expect(readSrc('src/components/map/MiniMapWidget.tsx'), 'mini harita kökü data-no-page-swipe taşımalı')
      .toMatch(/data-no-page-swipe/);

    const dockRoots: Array<[string, RegExp]> = [
      ['src/components/layout/DockBar.tsx', /data-dock="main"[^>]*data-no-page-swipe|data-no-page-swipe[^>]*data-dock="main"/],
      ['src/components/themes/ProLayout.tsx', /data-editable="pro\.dock"[^>]*data-no-page-swipe/],
      ['src/components/themes/TeslaLayout.tsx', /data-editable="tesla\.dock"[^>]*data-no-page-swipe/],
      ['src/components/themes/HorizonLayout.tsx', /data-editable="horizon\.dock"[^>]*data-no-page-swipe/],
      ['src/components/themes/ExpeditionLayout.tsx', /data-editable="expedition\.dock"[^>]*data-no-page-swipe/],
    ];
    for (const [f, re] of dockRoots) {
      expect(readSrc(f), `${f} dock KÖKÜ data-no-page-swipe taşımalı (yalnız iç kaydırıcı yetmez)`)
        .toMatch(re);
    }
  });

  it('kokpit HOME bileşenlerinden HİÇBİRİNİ import etmez (ikinci HOME kurulmaz)', () => {
    for (const f of [
      'src/components/cockpit/DigitalCockpitScreen.tsx',
      'src/components/cockpit/DigitalCockpitPage.tsx',
      'src/components/cockpit/CockpitPager.tsx',
      'src/components/cockpit/useCockpitData.ts',
    ]) {
      // Yorumlarda HOME'dan söz edilebilir; kilit İMPORT bağıyladır.
      expect(importLines(readSrc(f)), `${f} HOME layout'una bağlanmamalı`)
        .not.toMatch(/NewHomeLayout|MainLayout|DockBar|DrawerPanel/);
    }
  });

  it('sunum katmanı HİÇBİR platform servisi import etmez (tek başına render edilebilir)', () => {
    const imports = importLines(readSrc('src/components/cockpit/DigitalCockpitScreen.tsx'));
    expect(imports).not.toMatch(/\.\.\/\.\.\/platform\//);
    expect(imports).not.toMatch(/\.\.\/\.\.\/store\//);
    expect(imports).not.toMatch(/useCockpitData/);
  });

  it('kokpit kendi poll/abonelik/timer otoritesini KURMAZ', () => {
    const src = readSrc('src/components/cockpit/useCockpitData.ts');
    // Yorum satırları hariç gerçek kod: timer/abonelik kurulmuyor.
    const code = src.split(/\r?\n/).filter((l) => !/^\s*[*/]/.test(l)).join(' | ');
    expect(code).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(code).not.toMatch(/watchPosition|addListener|\.subscribe\(/);
  });

  it('kokpit sayfası App kabuğuna KARDEŞ olarak bağlanır (HOME sarmalanmaz)', () => {
    const app = readSrc('src/App.tsx');
    expect(app).toMatch(/<CockpitPager \/>/);
    // MainLayout kokpit tarafından SARILMAMALI.
    expect(app).not.toMatch(/<CockpitPager[^>]*>\s*<MainLayout/);
  });
});

describe('viraj ve hız aşımı (sürüş ekranı)', () => {
  it('🔒 viraj önerisi varsa sarı levha; hız sınırı aşılınca levha kırmızı işaretli', () => {
    const { container } = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE,
      speedKmh: 68, speedLimitKmh: 50, speedOverLimit: true,
      curve: { advisoryKmh: 40, direction: 'right', distanceM: 180 } }} mode="night" clock={COCKPIT_REFERENCE_CLOCK} />);
    expect(container.querySelector('[data-cockpit-curve="right"]')?.textContent).toContain('40');
    expect(container.querySelector('[data-cockpit-overspeed="true"]')).not.toBeNull();
  });

  it('viraj yoksa levha YOK', () => {
    const { container } = render(<DigitalCockpitScreen state={{ ...COCKPIT_REFERENCE_STATE, curve: null }} mode="night" clock={COCKPIT_REFERENCE_CLOCK} />);
    expect(container.querySelector('[data-cockpit-curve]')).toBeNull();
  });
});
