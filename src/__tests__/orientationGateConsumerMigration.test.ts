/**
 * Orientation Sensor Gate — On-Demand Consumer Migration testleri (PR 2/3).
 *
 * Dört yaşam-döngülü tüketici (arAlignment, dashcam, blackBox, deviceApi/sentry
 * accelerometer yolu) artık ham `window.addEventListener` yerine Orientation
 * Sensor Gate üzerinden abone olur. Bu testler: gate acquire/release, tek
 * fiziksel listener paylaşımı, visibility davranışı, event geçişi ve
 * gpsService/smartDrivingEngine'in DEĞİŞMEDİĞİNİ doğrular.
 *
 * ⚠️ Bu PR native samplingPeriod'u düşürmez ve Settings CPU sorununu çözmez
 * (gpsService + smartDrivingEngine hâlâ always-on). Testler yalnız gate
 * abonelik davranışını doğrular.
 */

import {
  getSubscriberCounts,
  getStatus,
  reset as gateReset,
} from '../platform/sensors';
import { startARAlignment, stopARAlignment } from '../platform/arAlignmentService';
import { startDashcam, stopDashcam } from '../platform/dashcamService';
import { startBlackBox } from '../platform/security/blackBoxService';
import { subscribeToAccelerometer } from '../platform/deviceApi';

// Kaynak-metin kilitleri (?raw — transform-time sabit).
import arSrc           from '../platform/arAlignmentService.ts?raw';
import dashSrc         from '../platform/dashcamService.ts?raw';
import blackboxSrc     from '../platform/security/blackBoxService.ts?raw';
import deviceApiSrc    from '../platform/deviceApi.ts?raw';
import gpsSrc          from '../platform/gpsService.ts?raw';
import smartDrivingSrc from '../platform/smartDrivingEngine.ts?raw';
import sentrySrc       from '../platform/security/sentryEngine.ts?raw';

/* ── Ortam kurulumu ────────────────────────────────────────────── */

// jsdom'da DeviceMotion/Orientation tipleri olmayabilir — feature-detect eden
// tüketiciler (deviceApi/blackBox) için tanımla (permission davranışı korunur).
beforeAll(() => {
  const w = window as unknown as Record<string, unknown>;
  if (!('DeviceMotionEvent' in window))      w.DeviceMotionEvent = class extends Event {};
  if (!('DeviceOrientationEvent' in window)) w.DeviceOrientationEvent = class extends Event {};

  // Dashcam için minimal MediaRecorder + getUserMedia mock.
  class FakeRecorder {
    state = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    static isTypeSupported(): boolean { return true; }
    constructor(public stream: unknown, public opts?: unknown) {}
    start(): void {}
    stop(): void {}
    requestData(): void {}
  }
  (globalThis as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
  });
});

let _vis: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => _vis });
function setVisibility(v: DocumentVisibilityState): void {
  _vis = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

function motionEvent(x = 1, y = 2, z = 2): Event {
  const e = new Event('devicemotion');
  const acc = { x, y, z };
  (e as unknown as Record<string, unknown>).acceleration = acc;
  (e as unknown as Record<string, unknown>).accelerationIncludingGravity = acc;
  return e;
}

const _cleanups: Array<() => void> = [];

beforeEach(() => {
  _vis = 'visible';
  gateReset();
});
afterEach(() => {
  // Tüketicileri durdur (idempotent) → gate temiz.
  stopARAlignment();
  stopDashcam();
  while (_cleanups.length) { try { _cleanups.pop()!(); } catch { /* ignore */ } }
  gateReset();
  vi.restoreAllMocks();
});

/* ── Testler ───────────────────────────────────────────────────── */

describe('Orientation Gate — On-Demand Consumer Migration (PR 2)', () => {
  /* 1 */
  it('1: arAlignment start gate acquire eder (abs+rel+motion)', () => {
    startARAlignment();
    const c = getSubscriberCounts();
    expect(c.orientationAbsolute).toBe(1);
    expect(c.orientation).toBe(1);
    expect(c.motion).toBe(1);
  });

  /* 2 */
  it('2: arAlignment stop release eder', () => {
    startARAlignment();
    stopARAlignment();
    expect(getSubscriberCounts().total).toBe(0);
  });

  /* 3 */
  it('3: arAlignment duplicate start ekstra abonelik oluşturmaz', () => {
    startARAlignment();
    startARAlignment();
    const c = getSubscriberCounts();
    expect(c.orientationAbsolute).toBe(1);
    expect(c.orientation).toBe(1);
    expect(c.motion).toBe(1);
  });

  /* 4 */
  it('4: dashcam start gate acquire eder (motion)', async () => {
    await startDashcam();
    expect(getSubscriberCounts().motion).toBeGreaterThanOrEqual(1);
  });

  /* 5 */
  it('5: dashcam stop release eder', async () => {
    await startDashcam();
    stopDashcam();
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 6 */
  it('6: blackBox start gate acquire eder (motion)', () => {
    _cleanups.push(startBlackBox());
    expect(getSubscriberCounts().motion).toBeGreaterThanOrEqual(1);
  });

  /* 7 */
  it('7: blackBox stop release eder', () => {
    const stop = startBlackBox();
    stop();
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 8 */
  it('8: deviceApi subscribeToAccelerometer gate kullanır', () => {
    const unsub = subscribeToAccelerometer(() => {});
    _cleanups.push(unsub);
    expect(getSubscriberCounts().motion).toBe(1);
  });

  /* 9 */
  it('9: deviceApi unsubscribe release eder', () => {
    const unsub = subscribeToAccelerometer(() => {});
    unsub();
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 10 — sentry accelerometer yolu deviceApi üzerinden korunur */
  it('10: sentry lifecycle davranışı korunur (subscribeToAccelerometer + _unsubAccel wiring)', () => {
    expect(sentrySrc).toMatch(/_unsubAccel\s*=\s*subscribeToAccelerometer\(_onAccel\)/);
    expect(sentrySrc).toMatch(/_unsubAccel\?\.\(\)/);           // disarm'da release
    expect(sentrySrc).toMatch(/from '\.\.\/deviceApi'/);        // yol değişmedi
  });

  /* 11 */
  it('11: callback event\'i aynen alır (deviceApi x/y/z/total)', () => {
    let got: number[] | null = null;
    const unsub = subscribeToAccelerometer((x, y, z, total) => { got = [x, y, z, total]; });
    _cleanups.push(unsub);
    window.dispatchEvent(motionEvent(1, 2, 2));
    expect(got).toEqual([1, 2, 2, 3]);  // total = sqrt(1+4+4)=3
  });

  /* 12 — permission davranışı korunur */
  it('12: permission davranışı korunur (feature-detect, requestPermission eklenmedi)', () => {
    // Migre dosyalar iOS requestPermission akışı EKLEMEDİ (izin tüketicinin
    // mevcut davranışında kalır); deviceApi/blackBox feature-detect korunur.
    expect(deviceApiSrc).toMatch(/'DeviceMotionEvent' in window/);
    expect(blackboxSrc).toMatch(/'DeviceMotionEvent' in window/);
    for (const src of [arSrc, dashSrc, blackboxSrc, deviceApiSrc]) {
      expect(src).not.toMatch(/requestPermission/);
    }
  });

  /* 13 */
  it('13: hidden durumda fiziksel listener sökülür (kayıt korunur)', () => {
    const unsub = subscribeToAccelerometer(() => {});
    _cleanups.push(unsub);
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
    setVisibility('hidden');
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
    expect(getSubscriberCounts().motion).toBe(1);   // consumer kaydı korunur
  });

  /* 14 */
  it('14: visible dönüşünde aktif tüketici geri bağlanır', () => {
    const unsub = subscribeToAccelerometer(() => {});
    _cleanups.push(unsub);
    setVisibility('hidden');
    setVisibility('visible');
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
  });

  /* 15 */
  it('15: iki tüketici tek fiziksel motion listener paylaşır (duplicate yok)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    startARAlignment();                              // motion consumer #1
    const unsub = subscribeToAccelerometer(() => {}); // motion consumer #2
    _cleanups.push(unsub);
    const motionAdds = addSpy.mock.calls.filter((c) => c[0] === 'devicemotion').length;
    expect(motionAdds).toBe(1);
    expect(getSubscriberCounts().motion).toBe(2);
  });

  /* 16 */
  it('16: bir consumer stop olunca diğeri çalışmaya devam eder', () => {
    let hit = 0;
    startARAlignment();
    const unsub = subscribeToAccelerometer(() => { hit++; });
    _cleanups.push(unsub);
    stopARAlignment();                               // arAlignment motion release
    window.dispatchEvent(motionEvent());
    expect(hit).toBe(1);                             // deviceApi hâlâ çalışıyor
    expect(getStatus().channels.motion.listenerAttached).toBe(true);
  });

  /* 17 */
  it('17: son consumer stop olunca fiziksel listener sökülür', () => {
    startARAlignment();
    const unsub = subscribeToAccelerometer(() => {});
    stopARAlignment();
    unsub();
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
    expect(getSubscriberCounts().motion).toBe(0);
  });

  /* 18 */
  it('18: tüm tüketiciler durunca gate\'te sızıntı yok (zero-leak)', () => {
    startARAlignment();
    const unsub = subscribeToAccelerometer(() => {});
    stopARAlignment();
    unsub();
    expect(getSubscriberCounts().total).toBe(0);
    const s = getStatus();
    expect(s.channels.motion.listenerAttached).toBe(false);
    expect(s.channels.orientation.listenerAttached).toBe(false);
    expect(s.channels.orientationAbsolute.listenerAttached).toBe(false);
  });

  /* 19 — HMR cleanup korunur */
  it('19: arAlignment HMR cleanup korunur (dispose→stopARAlignment)', () => {
    expect(arSrc).toMatch(/import\.meta\.hot[\s\S]*stopARAlignment\(\)/);
  });

  /* 20 */
  it('20: dağıtılan event mutate edilmez', () => {
    const unsub = subscribeToAccelerometer(() => {});
    _cleanups.push(unsub);
    const e = motionEvent();
    const keysBefore = Object.keys(e).length;
    window.dispatchEvent(e);
    expect(Object.keys(e).length).toBe(keysBefore);
  });

  /* 21 — gpsService DEĞİŞMEDİ */
  it('21: gpsService bu PR\'da değişmedi (hâlâ ham compass listener, gate import YOK)', () => {
    expect(gpsSrc).toMatch(/addEventListener\('deviceorientationabsolute'/);
    expect(gpsSrc).not.toMatch(/from '\.\/sensors'/);
    expect(gpsSrc).not.toMatch(/subscribeOrientation|subscribeMotion/);
  });

  /* 22 — smartDrivingEngine DEĞİŞMEDİ */
  it('22: smartDrivingEngine bu PR\'da değişmedi (hâlâ ham devicemotion, gate import YOK)', () => {
    expect(smartDrivingSrc).toMatch(/addEventListener\('devicemotion'/);
    expect(smartDrivingSrc).not.toMatch(/from '\.\/sensors'/);
    expect(smartDrivingSrc).not.toMatch(/subscribeMotion/);
  });

  /* 23 — native sampling rate iddiası yok */
  it('23: migre dosyalar native samplingPeriod düşürme iddiası taşımaz', () => {
    for (const src of [arSrc, dashSrc, blackboxSrc, deviceApiSrc]) {
      expect(src).not.toMatch(/samplingPeriod/i);
    }
  });

  /* 24 — Settings CPU çözümü iddiası yok */
  it('24: migre dosyalar Settings/Ayarlar CPU çözümü iddia etmez', () => {
    for (const src of [arSrc, dashSrc, blackboxSrc, deviceApiSrc]) {
      expect(src).not.toMatch(/Ayarlar.*CPU|Settings.*CPU/i);
    }
  });

  /* 25 — SystemBoot dokunulmadı (migre dosyalar SystemBoot import etmez) */
  it('25: migre dosyalar SystemBoot\'a bağlanmaz', () => {
    for (const src of [arSrc, dashSrc, deviceApiSrc]) {
      expect(src).not.toMatch(/SystemBoot/);
    }
  });

  /* 26 — Platform Kernel PR #55 dokunulmadı */
  it('26: migre dosyalar Platform Kernel\'e bağlanmaz', () => {
    for (const src of [arSrc, dashSrc, blackboxSrc, deviceApiSrc]) {
      expect(src).not.toMatch(/from '[^']*kernel/i);
    }
  });

  /* 27 — Native OBD/CAN yolu korunur (blackBox OBD dinleyicisi değişmedi) */
  it('27: blackBox OBD dinleyicisi (onOBDData) korunur, sensör dışına dokunulmadı', () => {
    expect(blackboxSrc).toMatch(/_startOBDListener/);
    expect(blackboxSrc).toMatch(/onOBDData/);
  });

  /* 28 — tüketiciler ORTAK gate barrel'ını kullanır (yeniden implementasyon yok) */
  it('28: tüm migre tüketiciler ORTAK sensors gate barrel\'ından import eder', () => {
    expect(arSrc).toMatch(/from '\.\/sensors'/);
    expect(dashSrc).toMatch(/from '\.\/sensors'/);
    expect(deviceApiSrc).toMatch(/from '\.\/sensors'/);
    expect(blackboxSrc).toMatch(/from '\.\.\/sensors'/);
  });

  /* 29 — çift visibility listener eklenmedi */
  it('29: migre tüketiciler kendi visibilitychange listener\'ını EKLEMEZ', () => {
    for (const src of [arSrc, dashSrc, blackboxSrc, deviceApiSrc]) {
      expect(src).not.toMatch(/addEventListener\(\s*'visibilitychange'/);
    }
  });

  /* 30 — import yan etkisiz */
  it('30: modül importları sensör aboneliği kurmaz (taze gate boş)', () => {
    // Bu test dosyası tüm tüketicileri import etti; hiçbiri import-zamanında
    // gate'e abone olmadı (yalnız start/subscribe çağrısında).
    expect(getSubscriberCounts().total).toBe(0);
    expect(getStatus().channels.motion.listenerAttached).toBe(false);
  });
});
