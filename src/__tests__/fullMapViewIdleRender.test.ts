/**
 * fullMapViewIdleRender.test.ts — FullMapView boşta-render optimizasyonu (saha fix 2026-07-11).
 *
 * SAHA KANITI (gerçek cihaz QA, Xiaomi zircon): tam ekran harita açık, kullanıcı
 * DOKUNMUYOR → process CPU +30sn %64 · +60sn %96 · +2dk %106 · +3dk %210 · +6dk %167;
 * harita kapatılınca 45 sn içinde %20. Yani harita boşta 1.5-2.1 çekirdek yakıyordu.
 *
 * KÖK NEDEN (iki katman):
 *  (1) Idle kapısı GPS GÜRÜLTÜSÜNÜ hareket sanıyordu (park hâlinde ±3 m fix → "10 km/h")
 *      → rAF döngüsü hiç uyumuyordu.
 *  (2) Döngü uyanıkken tick, DEĞİŞİKLİK OLMASA DA `updateUserMarker()` çağırıyordu;
 *      o da koşulsuz `source.setData()` yapar (MapLayerManager.ts:371) → her 60 ms'de
 *      MapLibre repaint. Kamera da 150-500 ms'de bir yeniden hesaplanıyordu.
 *
 * ERİŞİM: FullMapView.tsx maplibre-gl + WebGL import zinciri taşır (jsdom'da yok).
 * Proje konvansiyonu (perf.map.test.ts): import-kilitli kod için SADIK PROTOKOL MODELİ
 * + gerçek kaynak metnine karşı REGRESYON KİLİTLERİ (model ile kod ayrışırsa test düşer).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src', 'components', 'map', 'FullMapView.tsx'),
  'utf8',
);

/* ────────────────────────────────────────────────────────────────────────────
 * FullMapView tick protokolünün SADIK MODELİ
 * (sabitler ve koşullar FullMapView.tsx ile birebir — aşağıdaki kilitler doğrular)
 * ──────────────────────────────────────────────────────────────────────────── */

const MARKER_EPS_M      = 0.3;
const MARKER_EPS_BEAR   = 0.5;
const MARKER_EPS_SPEED  = 0.5;
const CAM_EPS_M         = 0.5;
const CAM_EPS_BEAR      = 0.5;
const STANDSTILL_KMH    = 1.5;
const STANDSTILL_HOLD_M = 5;
const STANDSTILL_BEAR   = 15;
const NO_WORK_IDLE_MS   = 2500;
const IDLE_HYSTERESIS_MS = 2500;
const MARKER_THROTTLE_MS = 60;

const distM = (aLat: number, aLng: number, bLat: number, bLng: number) =>
  Math.hypot((bLat - aLat) * 111_320, (bLng - aLng) * 111_320 * Math.cos((bLat * Math.PI) / 180));
const bearDelta = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180);

interface Fix { lat: number; lng: number; bear: number; speedKmh: number; accuracy: number }

interface Model {
  markerSetDataCount: number;   // = MapLibre repaint sayısı (source.setData)
  cameraUpdateCount:  number;
  rafScheduled:       number;   // rAF reschedule sayısı
  fpsIntervalRunning: boolean;
  loopActive:         boolean;
  timers:             number;   // aktif timer sayısı (zero-leak)
}

function createMapLoop(opts: { navActive?: boolean; driving?: boolean; layerPresent?: boolean } = {}) {
  const m: Model = {
    markerSetDataCount: 0, cameraUpdateCount: 0, rafScheduled: 0,
    fpsIntervalRunning: false, loopActive: false, timers: 0,
  };

  let navActive     = opts.navActive ?? false;
  let driving       = opts.driving ?? false;
  let layerPresent  = opts.layerPresent ?? true;
  let interacting   = false;
  let following     = true;
  let redrawDirty   = true;   // ilk karede force (mount)

  let lastWakeTs = 0;
  let lastWorkTs = 0;
  let lastMarkerUpdate = -Infinity;

  let sMLat = NaN, sMLng = NaN, sMBear = NaN, sMSpeed = NaN;
  let sCLat = NaN, sCLng = NaN, sCBear = NaN, sCSpeed = NaN;

  let fix: Fix | null = null;

  const isIdleNow = (now: number): boolean => {
    if (now - lastWakeTs < IDLE_HYSTERESIS_MS) return false;
    if (navActive)   return false;
    if (driving)     return false;
    if (interacting) return false;
    if (now - lastWorkTs >= NO_WORK_IDLE_MS) return true;   // ← yapılan-iş kapısı
    return false;
  };

  const wake = (now: number) => {
    lastWakeTs = now;
    lastWorkTs = now;
    if (m.loopActive) return;         // duplicate rAF/timer YOK
    m.loopActive = true;
    m.fpsIntervalRunning = true;
    m.timers += 1;                    // fps interval
    m.rafScheduled += 1;
  };

  /** Bir rAF karesi — FullMapView tick'inin birebir karşılığı. */
  const tick = (now: number) => {
    if (!m.loopActive) return;

    if (isIdleNow(now)) {
      m.loopActive = false;
      m.fpsIntervalRunning = false;
      m.timers -= 1;                  // fps interval durur
      return;                         // rAF YENİDEN PLANLANMAZ → uyudu
    }

    // force geçersizleme (kullanıcı pan'i / katman kaybı → self-healing)
    const force = redrawDirty || !layerPresent;
    if (force) {
      sMLat = NaN; sMLng = NaN; sMBear = NaN; sMSpeed = NaN;
      sCLat = NaN; sCLng = NaN; sCBear = NaN; sCSpeed = NaN;
      redrawDirty = false;
      lastWorkTs = now;
    }

    if (fix) {
      const { lat, lng, bear, speedKmh, accuracy } = fix;
      const stationary = !navActive && !driving && speedKmh < STANDSTILL_KMH;
      const moveThresh = stationary ? Math.max(STANDSTILL_HOLD_M, accuracy) : MARKER_EPS_M;
      const bearThresh = stationary ? STANDSTILL_BEAR : MARKER_EPS_BEAR;

      const movedM  = Number.isNaN(sMLat) ? Infinity : distM(sMLat, sMLng, lat, lng);
      const bearD   = Number.isNaN(sMBear) ? Infinity : bearDelta(sMBear, bear);
      const speedD  = Number.isNaN(sMSpeed) ? Infinity : Math.abs(speedKmh - sMSpeed);
      const changed = movedM >= moveThresh || bearD >= bearThresh || speedD >= MARKER_EPS_SPEED;

      if (!interacting && now - lastMarkerUpdate > MARKER_THROTTLE_MS && changed) {
        m.markerSetDataCount += 1;    // updateUserMarker → source.setData → REPAINT
        if (!layerPresent) layerPresent = true;   // self-healing: addUserMarker
        lastMarkerUpdate = now;
        sMLat = lat; sMLng = lng; sMBear = bear; sMSpeed = speedKmh;
        lastWorkTs = now;
      }

      if (!interacting && following) {
        const camMoved = Number.isNaN(sCLat) ? Infinity : distM(sCLat, sCLng, lat, lng);
        const camBearD = Number.isNaN(sCBear) ? Infinity : bearDelta(sCBear, bear);
        const camSpeedD = Number.isNaN(sCSpeed) ? Infinity : Math.abs(speedKmh - sCSpeed);
        if (camMoved >= CAM_EPS_M || camBearD >= CAM_EPS_BEAR || camSpeedD >= MARKER_EPS_SPEED) {
          m.cameraUpdateCount += 1;
          sCLat = lat; sCLng = lng; sCBear = bear; sCSpeed = speedKmh;
          lastWorkTs = now;
        }
      }
    }

    m.rafScheduled += 1;              // rAF yeniden planlandı
  };

  /** N kare koştur (60 fps). */
  const run = (fromMs: number, frames: number) => {
    for (let i = 0; i < frames; i++) tick(fromMs + i * 16.67);
  };

  const unmount = () => {
    if (m.loopActive) { m.loopActive = false; m.fpsIntervalRunning = false; m.timers -= 1; }
  };

  return {
    model: m,
    wake,
    tick,
    run,
    unmount,
    setFix:         (f: Fix) => { fix = f; },
    setNavActive:   (v: boolean) => { navActive = v; },
    setDriving:     (v: boolean) => { driving = v; },
    setInteracting: (v: boolean) => { interacting = v; },
    setFollowing:   (v: boolean) => { following = v; },
    dropLayer:      () => { layerPresent = false; },
    userPan:        () => { redrawDirty = true; },   // _onInteractStart → redrawDirtyRef
    isIdle:         (now: number) => isIdleNow(now),
  };
}

const PARKED: Fix   = { lat: 37.9, lng: 40.2, bear: 0,  speedKmh: 0,  accuracy: 3 };
const DRIVING: Fix  = { lat: 37.9, lng: 40.2, bear: 90, speedKmh: 50, accuracy: 5 };

/* ── 1-3: Boşta render / timer / rAF ─────────────────────────────────────── */

describe('Boşta render — döngü uyur', () => {
  it('1. idle render: değişiklik yoksa MapLibre repaint (setData) ÜRETİLMEZ', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 600);                       // 10 saniye @60fps

    // Mount force'u nedeniyle bir kez çizilir; sonrası SESSİZ.
    expect(map.model.markerSetDataCount).toBe(1);
    expect(map.model.cameraUpdateCount).toBe(1);
  });

  it('2. idle timer: FPS interval döngüyle birlikte DURUR (idle\'da timer yok)', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 600);
    expect(map.model.fpsIntervalRunning).toBe(false);
    expect(map.model.timers).toBe(0);       // zero-leak
  });

  it('3. idle rAF: uyuduktan sonra kare PLANLANMAZ (rAF zinciri kopar)', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 600);
    const scheduledAfterSleep = map.model.rafScheduled;
    map.run(10_000, 600);                   // 10 sn daha
    expect(map.model.rafScheduled).toBe(scheduledAfterSleep);  // hiç artmadı
    expect(map.model.loopActive).toBe(false);
  });

  it('3b. uyku, NO_WORK_IDLE_MS + histerezis sonunda gerçekleşir (erken değil)', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 60);                         // 1 sn
    expect(map.model.loopActive).toBe(true);        // henüz uyumaz
    expect(map.isIdle(1000)).toBe(false);
    expect(map.isIdle(NO_WORK_IDLE_MS + 1)).toBe(true);
  });
});

/* ── 4-5: Kapatma / yeniden açma ─────────────────────────────────────────── */

describe('Kapatma & yeniden açma', () => {
  it('4. map close cleanup: unmount\'ta döngü ve timer\'lar durur', () => {
    const map = createMapLoop();
    map.setFix(DRIVING);
    map.wake(0);
    map.run(0, 30);
    expect(map.model.loopActive).toBe(true);
    map.unmount();
    expect(map.model.loopActive).toBe(false);
    expect(map.model.timers).toBe(0);
    expect(map.model.fpsIntervalRunning).toBe(false);
  });

  it('5. reopen: yeni mount temiz döngü başlatır ve marker\'ı BİR KEZ çizer', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 600);
    map.unmount();

    const again = createMapLoop();          // yeniden açılış
    again.setFix(PARKED);
    again.wake(0);
    again.run(0, 600);
    expect(again.model.markerSetDataCount).toBe(1);
    expect(again.model.loopActive).toBe(false);   // yine uykuya geçer
  });
});

/* ── 6-9: Marker güncelleme ──────────────────────────────────────────────── */

describe('Marker — yalnız gerçekten değişince', () => {
  it('6. marker update: konum değişince çizilir', () => {
    const map = createMapLoop();
    map.setFix(DRIVING);
    map.wake(0);
    map.run(0, 5);
    const before = map.model.markerSetDataCount;

    map.setFix({ ...DRIVING, lat: DRIVING.lat + 0.0002 });   // ~22 m
    map.run(100, 5);
    expect(map.model.markerSetDataCount).toBeGreaterThan(before);
  });

  it('7. marker değişmemişse update YOK (redundant setData elenir)', () => {
    const map = createMapLoop();
    map.setFix(DRIVING);
    map.wake(0);
    map.run(0, 120);                        // 2 sn, aynı fix
    expect(map.model.markerSetDataCount).toBe(1);   // yalnız mount force'u
  });

  it('8. PARK gürültüsü (hız<1.5 km/h, kayma < doğruluk yarıçapı) marker\'ı OYNATMAZ', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 5);
    const before = map.model.markerSetDataCount;

    // ±3 m GPS jitter (doğruluk 3 m, eşik max(5, 3) = 5 m)
    map.setFix({ ...PARKED, lat: PARKED.lat + 0.000027 });   // ~3 m
    map.run(100, 60);
    expect(map.model.markerSetDataCount).toBe(before);       // jitter yutuldu
  });

  it('9. SÜRÜŞTE küçük hareket (0.4 m) marker\'ı günceller — davranış korunur', () => {
    const map = createMapLoop();
    map.setFix(DRIVING);
    map.wake(0);
    map.run(0, 5);
    const before = map.model.markerSetDataCount;

    map.setFix({ ...DRIVING, lat: DRIVING.lat + 0.0000036 });  // ~0.4 m > 0.3 m eşiği
    map.run(100, 10);
    expect(map.model.markerSetDataCount).toBeGreaterThan(before);
  });

  it('9b. park hâlinde büyük gerçek hareket (>5 m) YİNE çizilir', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 5);
    const before = map.model.markerSetDataCount;

    map.setFix({ ...PARKED, lat: PARKED.lat + 0.00009 });     // ~10 m
    map.run(100, 10);
    expect(map.model.markerSetDataCount).toBeGreaterThan(before);
  });
});

/* ── 10-12: Kamera / bearing / rota ──────────────────────────────────────── */

describe('Kamera — yalnız gerçekten değişince', () => {
  it('10. kamera girdileri sabitse setDrivingView ÇAĞRILMAZ', () => {
    const map = createMapLoop({ driving: true });
    map.setFix(DRIVING);
    map.wake(0);
    map.run(0, 300);                        // 5 sn sabit
    expect(map.model.cameraUpdateCount).toBe(1);   // yalnız mount force'u
  });

  it('11. camera update: konum değişince kamera güncellenir (takip korunur)', () => {
    const map = createMapLoop({ driving: true });
    map.setFix(DRIVING);
    map.wake(0);
    map.run(0, 5);
    const before = map.model.cameraUpdateCount;

    map.setFix({ ...DRIVING, lng: DRIVING.lng + 0.0002 });
    map.run(100, 10);
    expect(map.model.cameraUpdateCount).toBeGreaterThan(before);
  });

  it('12. bearing update: yön değişmediyse rotate YOK, değişince VAR', () => {
    const map = createMapLoop({ driving: true });
    map.setFix(DRIVING);
    map.wake(0);
    map.run(0, 60);
    const before = map.model.cameraUpdateCount;

    map.setFix({ ...DRIVING, bear: DRIVING.bear + 0.2 });   // 0.2° < 0.5° eşik
    map.run(1000, 30);
    expect(map.model.cameraUpdateCount).toBe(before);

    map.setFix({ ...DRIVING, bear: DRIVING.bear + 10 });    // gerçek dönüş
    map.run(2000, 30);
    expect(map.model.cameraUpdateCount).toBeGreaterThan(before);
  });
});

/* ── 13-15: Davranış koruması ────────────────────────────────────────────── */

describe('Davranış koruması — dedup hiçbir kullanıcı davranışını yutmaz', () => {
  it('13. kullanıcı pan yaptıktan sonra takip kamerası GERİ MERKEZLER (araç sabit olsa bile)', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 5);
    const before = map.model.cameraUpdateCount;

    map.setInteracting(true);
    map.userPan();                          // _onInteractStart → redrawDirtyRef
    map.run(100, 5);
    map.setInteracting(false);
    map.wake(200);
    map.run(200, 10);

    expect(map.model.cameraUpdateCount).toBeGreaterThan(before);  // yeniden merkezlendi
  });

  it('14. stil/katman düşerse marker MUTLAKA yeniden çizilir (self-healing korunur)', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    map.wake(0);
    map.run(0, 300);                        // uykuya geçti, marker 1 kez çizildi
    const before = map.model.markerSetDataCount;

    map.dropLayer();                        // stil reload → user-vehicle katmanı yok
    map.wake(6000);
    map.run(6000, 10);
    expect(map.model.markerSetDataCount).toBeGreaterThan(before);
  });

  it('15. NAVİGASYON aktifken döngü ASLA uyumaz (iş çıkmasa bile)', () => {
    const map = createMapLoop({ navActive: true });
    map.setFix({ ...DRIVING, speedKmh: 0 });   // kırmızı ışıkta duruyor
    map.wake(0);
    map.run(0, 600);                            // 10 sn
    expect(map.model.loopActive).toBe(true);
    expect(map.isIdle(10_000)).toBe(false);
  });

  it('15b. sürüş modu (drivingMode) açıkken de uyumaz', () => {
    const map = createMapLoop({ driving: true });
    map.setFix({ ...DRIVING, speedKmh: 0 });
    map.wake(0);
    map.run(0, 600);
    expect(map.model.loopActive).toBe(true);
  });
});

/* ── 16-17: Duplicate / zero-leak ────────────────────────────────────────── */

describe('Duplicate & zero-leak', () => {
  it('16. duplicate timer/rAF: döngü çalışırken wake() ikinci bir zincir AÇMAZ', () => {
    const map = createMapLoop();
    map.setFix(DRIVING);
    map.wake(0);
    const scheduled = map.model.rafScheduled;
    const timers    = map.model.timers;
    map.wake(10); map.wake(20); map.wake(30);   // arka arkaya wake
    expect(map.model.rafScheduled).toBe(scheduled);
    expect(map.model.timers).toBe(timers);      // tek FPS interval
  });

  it('17. zero-leak: uyku → wake → uyku döngüsünde timer birikmez', () => {
    const map = createMapLoop();
    map.setFix(PARKED);
    for (let cycle = 0; cycle < 5; cycle++) {
      const t0 = cycle * 20_000;
      map.wake(t0);
      map.run(t0, 400);                     // uykuya geç
      expect(map.model.timers).toBe(0);
    }
    expect(map.model.loopActive).toBe(false);
  });
});

/* ── 18-20: Kaynak kilitleri (model ↔ gerçek kod ayrışmasın) ─────────────── */

describe('Regresyon kilitleri — gerçek FullMapView.tsx kaynağı', () => {
  it('18. "yapılan iş" idle kapısı kodda VAR (kök-neden fix\'i geri alınamaz)', () => {
    expect(SRC).toMatch(/NO_WORK_IDLE_MS/);
    expect(SRC).toMatch(/now - lastWorkTs >= NO_WORK_IDLE_MS\)\s*return true/);
  });

  it('19. marker ve kamera DEDUP guard\'ları kodda VAR', () => {
    // updateUserMarker artık koşulsuz çağrılmıyor
    expect(SRC).toMatch(/_markerChanged/);
    expect(SRC).toMatch(/if \(!userInteractingRef\.current && now - lastMarkerUpdate > 60 && _markerChanged\)/);
    // kamera dedup
    expect(SRC).toMatch(/_camChanged/);
    // park gürültüsü tutucusu
    expect(SRC).toMatch(/STANDSTILL_HOLD_M/);
    // force geçersizleme (pan / katman kaybı)
    expect(SRC).toMatch(/redrawDirtyRef/);
    expect(SRC).toMatch(/getLayer\('user-vehicle'\)/);
  });

  it('20. model sabitleri gerçek kodun sabitleriyle AYNI', () => {
    const num = (name: string): number => {
      const m = SRC.match(new RegExp(`const ${name}\\s*=\\s*([0-9.]+)`));
      if (!m) throw new Error(`${name} kaynakta bulunamadı`);
      return Number(m[1]);
    };
    expect(num('MARKER_EPS_M')).toBe(MARKER_EPS_M);
    expect(num('MARKER_EPS_BEAR')).toBe(MARKER_EPS_BEAR);
    expect(num('MARKER_EPS_SPEED')).toBe(MARKER_EPS_SPEED);
    expect(num('CAM_EPS_M')).toBe(CAM_EPS_M);
    expect(num('CAM_EPS_BEAR')).toBe(CAM_EPS_BEAR);
    expect(num('STANDSTILL_KMH')).toBe(STANDSTILL_KMH);
    expect(num('STANDSTILL_HOLD_M')).toBe(STANDSTILL_HOLD_M);
    expect(num('STANDSTILL_BEAR')).toBe(STANDSTILL_BEAR);
    expect(num('NO_WORK_IDLE_MS')).toBe(NO_WORK_IDLE_MS);
    expect(num('IDLE_HYSTERESIS_MS')).toBe(IDLE_HYSTERESIS_MS);
  });

  it('21. cleanup korunuyor: cancelAnimationFrame + FPS interval + timer temizliği', () => {
    expect(SRC).toMatch(/cancelAnimationFrame\(rafId\)/);
    expect(SRC).toMatch(/stopFpsMonitor\(\)/);
    expect(SRC).toMatch(/clearTimeout\(interactTimerRef\.current\)/);
  });

  it('22. import yan etkisiz: test dosyası yalnız kaynağı OKUR, modül import ETMEZ', () => {
    expect(SRC.length).toBeGreaterThan(1000);   // dosya gerçekten okundu
  });
});
