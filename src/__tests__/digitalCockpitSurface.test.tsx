/**
 * digitalCockpitSurface.test — CarOS Digital Cockpit (HOME'un komşu sayfası).
 *
 * Kapsam:
 *   1. Geometri paket otoritesiyle (cockpit.layout.json) BİREBİR mi
 *   2. Gün/gece AYNI geometri, yalnız token farkı
 *   3. Fail-closed gösterim: ölçülmemiş alan `—`, sahte `0` YOK
 *   4. Swipe kararı: ses jestiyle çakışmaz, sürüşte eşik yükselir, ters yön reddedilir
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
  canBeginPageSwipe, classifyPageDrag, resolvePageSwipe, commitDistancePx, edgeBandPx,
  COMMIT_RATIO_PARKED, COMMIT_RATIO_DRIVING,
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
  [...el.querySelectorAll('text')].map((n) => (n.textContent ?? '').trim());

/** Yalnız ÖLÇÜM metinleri — devir skalasının sabit etiketleri (0·2·4·6·8) hariç. */
const measurementTexts = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('text:not([data-cockpit-scale])')].map((n) => (n.textContent ?? '').trim());

/** Kaynaktaki YALNIZ import satırları — yorumlardaki ad geçişleri sayılmaz. */
const importLines = (src: string): string =>
  src.split(/\r?\n/).filter((l) => /^\s*import\s|^\s*\}\s*from\s|^\s*from\s/.test(l)).join(' | ');

/* ══════════════════════════════════════════════════════════════════════════
 * 1) GEOMETRİ — paket otoritesiyle birebir
 * ════════════════════════════════════════════════════════════════════════ */

describe('cockpit geometrisi — cockpit.layout.json ile birebir', () => {
  it('referans tuval 1648×928', () => {
    expect(COCKPIT_CANVAS).toEqual({ width: 1648, height: 928 });
  });

  it('bölge kutuları paket değerleriyle AYNI (tahmin edilmiş koordinat yok)', () => {
    expect(COCKPIT_REGIONS).toEqual({
      topBar:       { x: 0,    y: 0,   w: 1648, h: 74,  z: 90 },
      leftCluster:  { x: 20,   y: 120, w: 445,  h: 520, z: 30 },
      speedCluster: { x: 585,  y: 94,  w: 480,  h: 235, z: 50 },
      rightCluster: { x: 1183, y: 120, w: 445,  h: 520, z: 30 },
      roadScene:    { x: 0,    y: 76,  w: 1648, h: 650, z: 5  },
      maneuverBar:  { x: 500,  y: 635, w: 650,  h: 78,  z: 60 },
      musicCard:    { x: 42,   y: 728, w: 665,  h: 145, z: 60 },
      assistCard:   { x: 940,  y: 728, w: 665,  h: 145, z: 60 },
    });
  });

  it('ölçek formülü: s = min(vw/1648, vh/928)', () => {
    for (const [w, h] of COCKPIT_RESPONSIVE_TARGETS) {
      expect(cockpitScale(w, h)).toBeCloseTo(Math.min(w / 1648, h / 928), 6);
    }
    // Ölçülemeyen viewport → 1'e düşer (sıfır boyutlu ilk kare olmaz).
    expect(cockpitScale(0, 0)).toBe(1);
    expect(cockpitScale(Number.NaN, 600)).toBe(1);
  });

  it('hedef çözünürlüklerde müzik transportu asgari dokunma hedefini korur', () => {
    // Referansta oynat düğmesi 84 px çap; en küçük hedefte bile 56 px kuralına uymalı.
    const smallest = Math.min(...COCKPIT_RESPONSIVE_TARGETS.map(([w, h]) => cockpitScale(w, h)));
    expect(84 * smallest).toBeGreaterThanOrEqual(COCKPIT_MIN_TOUCH_PX * smallest);
    expect(smallest).toBeGreaterThan(0.5); // 1024×600'de bile yarıdan fazla ölçek
  });
});

describe('gün/gece — AYNI geometri, YALNIZ token farkı', () => {
  it('token setleri farklı ama tuval/bölgeler aynı', () => {
    const day = cockpitTokensFor('day');
    const night = cockpitTokensFor('night');
    expect(day.canvas).not.toBe(night.canvas);
    expect(day.textPrimary).not.toBe(night.textPrimary);
    // Vurgu renkleri paket gereği İKİSİNDE DE aynıdır (anlam rengi değişmez).
    expect(day.accentOrange).toBe(night.accentOrange);
    expect(day.accentGreen).toBe(night.accentGreen);
    expect(day.warningRed).toBe(night.warningRed);
  });

  it('iki modda da bölge kutuları birebir aynı yerde çizilir', () => {
    const boxOf = (mode: 'day' | 'night') => {
      const { container } = render(
        <DigitalCockpitScreen state={COCKPIT_REFERENCE_STATE} mode={mode} clock={COCKPIT_REFERENCE_CLOCK} />,
      );
      const out = [...container.querySelectorAll('[data-cockpit-region]')]
        .map((n) => n.getAttribute('data-cockpit-region'))
        .sort();
      return out;
    };
    expect(boxOf('day')).toEqual(boxOf('night'));
    expect(boxOf('day')).toContain('leftCluster');
    expect(boxOf('day')).toContain('rightCluster');
    expect(boxOf('day')).toContain('speedCluster');
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

  it('ADAS sinyali YOKKEN rozet çizilmez, dürüst metin yazılır', () => {
    const { container } = render(
      <DigitalCockpitScreen state={COCKPIT_REFERENCE_STATE} mode="day" clock={COCKPIT_REFERENCE_CLOCK} />,
    );
    expect(COCKPIT_REFERENCE_STATE.laneAssist).toBeNull();
    expect(texts(container)).toContain('Sürüş asistanı sinyali yok');
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
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) SWIPE KARARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('sayfa jesti — mevcut jestlerle çakışmaz, sürüşte kontrollü', () => {
  const VW = 1280;

  it('HOME: jest YALNIZ sağ kenar bandından başlar (iç yatay listeler korunur)', () => {
    const band = edgeBandPx(VW);
    expect(canBeginPageSwipe({ page: 'home', startX: VW - 5, viewportWidth: VW, blocked: false })).toBe(true);
    expect(canBeginPageSwipe({ page: 'home', startX: VW - band + 2, viewportWidth: VW, blocked: false })).toBe(true);
    expect(canBeginPageSwipe({ page: 'home', startX: VW / 2, viewportWidth: VW, blocked: false })).toBe(false);
    expect(canBeginPageSwipe({ page: 'home', startX: 10, viewportWidth: VW, blocked: false })).toBe(false);
  });

  it('Cockpit: geri dönüş jesti her yerden başlayabilir', () => {
    expect(canBeginPageSwipe({ page: 'cockpit', startX: 12, viewportWidth: VW, blocked: false })).toBe(true);
  });

  it('tam ekran yüzey açıkken (blocked) jest HİÇ başlamaz', () => {
    expect(canBeginPageSwipe({ page: 'home', startX: VW - 5, viewportWidth: VW, blocked: true })).toBe(false);
    expect(canBeginPageSwipe({ page: 'cockpit', startX: 400, viewportWidth: VW, blocked: true })).toBe(false);
  });

  it('DİKEY baskın hareket reddedilir — ses jestiyle (VolumeGestureLayer) çakışmaz', () => {
    expect(classifyPageDrag({ page: 'home', dx: -20, dy: -90 })).toBe('rejected');
    expect(classifyPageDrag({ page: 'home', dx: -20, dy: 60 })).toBe('rejected');
    // Yatay baskınlık sağlanınca kabul edilir.
    expect(classifyPageDrag({ page: 'home', dx: -80, dy: 20 })).toBe('engaged');
  });

  it('ters yön reddedilir (HOME\'un solunda sayfa YOK)', () => {
    expect(classifyPageDrag({ page: 'home', dx: 90, dy: 5 })).toBe('rejected');
    expect(classifyPageDrag({ page: 'cockpit', dx: -90, dy: 5 })).toBe('rejected');
    expect(classifyPageDrag({ page: 'cockpit', dx: 90, dy: 5 })).toBe('engaged');
  });

  it('küçük hareket kararsızdır (normal dokunuşlar UI\'ya gider)', () => {
    expect(classifyPageDrag({ page: 'home', dx: -6, dy: 3 })).toBe('pending');
  });

  it('SÜRÜŞTE eşik park hâlinden BELİRGİN yüksektir (yanlışlıkla geçiş olmaz)', () => {
    const parked = commitDistancePx(VW, false);
    const driving = commitDistancePx(VW, true);
    expect(parked).toBeCloseTo(VW * COMMIT_RATIO_PARKED, 5);
    expect(driving).toBeCloseTo(VW * COMMIT_RATIO_DRIVING, 5);
    expect(driving).toBeGreaterThan(parked * 1.5);

    // Park hâlinde geçen mesafe sürüşte GEÇMEZ.
    const dx = -(parked + 10);
    expect(resolvePageSwipe({ page: 'home', dx, viewportWidth: VW, isDriving: false }).committed).toBe(true);
    expect(resolvePageSwipe({ page: 'home', dx, viewportWidth: VW, isDriving: true }).committed).toBe(false);
  });

  it('hızlı fırlatma kabul edilir ama titreme (çok kısa yol) kabul EDİLMEZ', () => {
    const fling = resolvePageSwipe({
      page: 'home', dx: -90, viewportWidth: VW, isDriving: true, velocityPxPerMs: 1.4,
    });
    expect(fling.committed).toBe(true);
    const jitter = resolvePageSwipe({
      page: 'home', dx: -20, viewportWidth: VW, isDriving: false, velocityPxPerMs: 3,
    });
    expect(jitter.committed).toBe(false);
  });

  it('kabul edilen jest doğru hedefe gider', () => {
    expect(resolvePageSwipe({ page: 'home', dx: -600, viewportWidth: VW, isDriving: false }).target).toBe('cockpit');
    expect(resolvePageSwipe({ page: 'cockpit', dx: 600, viewportWidth: VW, isDriving: false }).target).toBe('home');
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
