/**
 * adasSupervisor.test.ts — ADAS gözetmeni ve kamera seçimi kilitleri (SAF).
 *
 * Kilitlenen ilke: bir özellik READY değilse o özelliğin uyarısı ÇIKMAZ ve
 * nedeni dürüstçe söylenir; ön (sürücü) kamerası yol kamerası sayılmaz.
 */
import { describe, it, expect } from 'vitest';
import {
  calibrationFor, cameraKeyOf, cameraPhase, composeFeatures, composeOverall, composeWarning,
  laneObservationFromFrame, sameFeatures, turnSignalFrom, type ComposeInput,
} from '../platform/adas/adasSupervisor';
import { classifyCamera, diagnoseUsb, pickAutoCamera, type AdasCameraOption } from '../platform/adas/adasCamera';
import { DEFAULT_ADAS_SETTINGS, type AdasCalibration, type AdasSettings } from '../platform/adas/adasTypes';
import type { LdwOutput } from '../platform/adas/laneDepartureModel';
import type { ForwardOutput } from '../platform/adas/forwardCollisionModel';
import type { NativeCameraHardware } from '../platform/nativePlugin';

const ON: AdasSettings = { ...DEFAULT_ADAS_SETTINGS, enabled: true, consentAtMs: 1 };
const CAL: AdasCalibration = {
  horizonY: 0.4, vanishX: 0.5, centerX: 0.5, laneWidthAtRef: 0.6,
  samples: 200, learnedAtMs: 0, cameraKey: 'label:cam', source: 'auto',
};
const LDW_READY: LdwOutput = {
  warning: null, state: 'READY', reason: null, offsetM: 0, distLeftM: 0.85, distRightM: 0.85,
  lateralMps: 0, turnSignalKnown: false,
};
const FWD_READY: ForwardOutput = {
  forward: null, headwayWarning: false, leadDeparted: false,
  fcwState: 'READY', fcwReason: null, headwayState: 'READY', headwayReason: null,
  leadState: 'READY', leadReason: null, lead: null, detectHz: 8, latencyMs: 100,
};
const base = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  settings: ON, block: null, starting: false, calibration: CAL, direction: 'forward', laneStale: false,
  ldw: LDW_READY, forward: FWD_READY, detector: 'ready', ...over,
});
const stateOf = (i: ComposeInput, f: string) => composeFeatures(i).find((x) => x.feature === f)!;

describe('girdi dönüşümü', () => {
  it('S1. şerit pikselleri (320×180) normalize edilir; bozuk çizgi atılır', () => {
    const o = laneObservationFromFrame([
      { x1: 80, y1: 72, x2: 32, y2: 179, side: 'left', confidence: 1.4 },
      { x1: NaN, y1: 72, x2: 300, y2: 179, side: 'right', confidence: 0.9 },
    ]);
    expect(o.left).toEqual({ x1: 0.25, y1: 0.4, x2: 0.1, y2: 179 / 180, confidence: 1 });
    expect(o.right).toBeNull();
  });

  it('S2. 🔒 sinyal: profil çözmüyorsa unknown (false ≠ kapalı); dörtlü → none', () => {
    expect(turnSignalFrom({ known: false, left: true, right: false, hazard: false })).toBe('unknown');
    expect(turnSignalFrom({ known: true, left: true, right: false, hazard: false })).toBe('left');
    expect(turnSignalFrom({ known: true, left: false, right: true, hazard: false })).toBe('right');
    expect(turnSignalFrom({ known: true, left: true, right: true, hazard: false })).toBe('none');
    expect(turnSignalFrom({ known: true, left: false, right: false, hazard: true })).toBe('none');
  });

  it('S3. 🔒 kalibrasyon yalnız AYNI kameraya uygulanır', () => {
    expect(cameraKeyOf({ deviceId: 'abc', label: ' USB Camera ' })).toBe('label:USB Camera');
    expect(cameraKeyOf({ deviceId: 'abc', label: '' })).toBe('id:abc');
    expect(cameraKeyOf(null)).toBe('auto');
    expect(calibrationFor(CAL, 'label:cam')).toBe(CAL);
    expect(calibrationFor(CAL, 'label:başka')).toBeNull();
    expect(calibrationFor(null, 'label:cam')).toBeNull();
  });

  it('S4. kamera evresi: izin reddi / kamera yok / akış kesildi ayrı nedenlerdir', () => {
    expect(cameraPhase('active', null)).toEqual({ phase: 'running' });
    expect(cameraPhase('degraded', null)).toEqual({ phase: 'running' });
    expect(cameraPhase('requesting', null)).toEqual({ phase: 'starting' });
    expect(cameraPhase('disabled', 'Kamera izni verilmedi')).toEqual({ phase: 'blocked', reason: 'CAMERA_DENIED' });
    expect(cameraPhase('error', 'Requested device not found')).toEqual({ phase: 'blocked', reason: 'NO_CAMERA' });
    expect(cameraPhase('error', 'Kamera akışı kesildi')).toEqual({ phase: 'blocked', reason: 'CAMERA_ERROR' });
  });
});

describe('özellik durumu ve genel hüküm', () => {
  it('S5. kapalı özellik OFF; sistem kapısı tüm açık özellikleri nedeniyle durdurur', () => {
    const f = composeFeatures(base({ settings: { ...ON, fcw: false }, block: 'REVERSE' }));
    expect(f.map((x) => [x.feature, x.state, x.reason])).toEqual([
      ['ldw', 'UNAVAILABLE', 'REVERSE'], ['fcw', 'OFF', null],
      ['headway', 'UNAVAILABLE', 'REVERSE'], ['leadDeparture', 'UNAVAILABLE', 'REVERSE'],
    ]);
  });

  it('S6. 🔒 donmuş kamera → LDW CAMERA_STALLED (kalibrasyon sürse bile)', () => {
    expect(stateOf(base({ laneStale: true }), 'ldw')).toMatchObject({ state: 'UNAVAILABLE', reason: 'CAMERA_STALLED' });
    expect(stateOf(base({ laneStale: true, calibration: null }), 'ldw').reason).toBe('CAMERA_STALLED');
    expect(stateOf(base({ calibration: null }), 'ldw').state).toBe('CALIBRATING');
    expect(stateOf(base({ calibration: null }), 'fcw').state).toBe('CALIBRATING');
  });

  it('S7. dedektör kurulamadı → ileri özellikler DETECTOR_UNAVAILABLE; yükleniyor → LOADING', () => {
    expect(stateOf(base({ detector: 'unavailable' }), 'fcw').reason).toBe('DETECTOR_UNAVAILABLE');
    expect(stateOf(base({ detector: 'loading', forward: null }), 'headway').reason).toBe('DETECTOR_LOADING');
    expect(stateOf(base({ detector: 'unavailable' }), 'ldw').state).toBe('READY');   // şerit etkilenmez
  });

  it('S8. genel hüküm: kapalı · onay yok · geri vites · engel · başlıyor · kısmen · tam', () => {
    const o = (i: Partial<ComposeInput>) => {
      const c = base(i);
      return composeOverall({ settings: c.settings, features: composeFeatures(c), block: c.block, starting: c.starting });
    };
    expect(o({ settings: DEFAULT_ADAS_SETTINGS })).toEqual({ overall: 'OFF', reason: 'DISABLED' });
    expect(o({ settings: { ...ON, ldw: false, fcw: false, headway: false, leadDeparture: false } }).overall).toBe('OFF');
    expect(o({ settings: { ...ON, consentAtMs: null } })).toEqual({ overall: 'OFF', reason: 'NO_CONSENT' });
    expect(o({ block: 'REVERSE' })).toEqual({ overall: 'DEGRADED', reason: 'REVERSE' });
    expect(o({ block: 'CAMERA_DENIED' })).toEqual({ overall: 'UNAVAILABLE', reason: 'CAMERA_DENIED' });
    expect(o({ starting: true })).toEqual({ overall: 'STARTING', reason: null });
    expect(o({ calibration: null })).toEqual({ overall: 'CALIBRATING', reason: 'CALIBRATING' });
    expect(o({ detector: 'unavailable' })).toEqual({ overall: 'DEGRADED', reason: 'DETECTOR_UNAVAILABLE' });
    expect(o({})).toEqual({ overall: 'ACTIVE', reason: null });
  });

  it('S8b. 🔒 kamera yönü: doğrulanmamış → öğreniyor (uyarı yok); arkaya bakıyor → hiçbir özellik çalışmaz', () => {
    const un = base({ direction: 'unverified', ldw: { ...LDW_READY, warning: 'left' }, forward: { ...FWD_READY, forward: 'collision' } });
    expect(composeFeatures(un).every((f) => f.state === 'CALIBRATING' && f.reason === 'VERIFYING_CAMERA')).toBe(true);
    expect(composeWarning(un.settings, composeFeatures(un), un.ldw, un.forward, 1)).toMatchObject({ lane: null, forward: null });
    expect(composeOverall({ settings: ON, features: composeFeatures(un), block: null, starting: false }))
      .toEqual({ overall: 'CALIBRATING', reason: 'VERIFYING_CAMERA' });

    const back = base({ direction: 'backward', forward: { ...FWD_READY, forward: 'collision' } });
    expect(composeFeatures(back).every((f) => f.reason === 'CAMERA_FACES_BACKWARD')).toBe(true);
    expect(composeWarning(back.settings, composeFeatures(back), back.ldw, back.forward, 1).forward).toBeNull();
    expect(composeOverall({ settings: ON, features: composeFeatures(back), block: null, starting: false }))
      .toEqual({ overall: 'UNAVAILABLE', reason: 'CAMERA_FACES_BACKWARD' });
  });

  it('S9. aynı durum listesi aynı sayılır (gereksiz render yok)', () => {
    expect(sameFeatures(composeFeatures(base()), composeFeatures(base()))).toBe(true);
    expect(sameFeatures(composeFeatures(base()), composeFeatures(base({ laneStale: true })))).toBe(false);
  });
});

describe('uyarı sinyali', () => {
  const warn = (i: ComposeInput) => composeWarning(i.settings, composeFeatures(i), i.ldw, i.forward, 1234);

  it('S10. READY özellik uyarısını taşır; kalp atışı damgası her zaman güncel', () => {
    const w = warn(base({ ldw: { ...LDW_READY, warning: 'left' }, forward: { ...FWD_READY, forward: 'collision' } }));
    expect(w).toEqual({ lane: 'left', forward: 'collision', leadDeparted: false, atPerfMs: 1234 });
    expect(warn(base()).atPerfMs).toBe(1234);
  });

  it('S11. 🔒 READY olmayan özellik uyarı ÜRETEMEZ (donmuş kamera, geri vites)', () => {
    const lanes = base({ ldw: { ...LDW_READY, warning: 'left' } });
    expect(warn({ ...lanes, laneStale: true }).lane).toBeNull();
    expect(warn({ ...lanes, block: 'REVERSE' }).lane).toBeNull();
    const fwd = base({ forward: { ...FWD_READY, forward: 'collision', fcwState: 'UNAVAILABLE', fcwReason: 'DETECTOR_TOO_SLOW' } });
    expect(warn(fwd).forward).toBeNull();
  });

  it('S12. FCW kapalı + takip mesafesi açık: çarpışma anında takip uyarısı kaybolmaz', () => {
    const f = { ...FWD_READY, forward: 'collision' as const, headwayWarning: true };
    expect(warn(base({ settings: { ...ON, fcw: false }, forward: f })).forward).toBe('headway');
    expect(warn(base({ settings: { ...ON, fcw: false }, forward: { ...f, headwayWarning: false } })).forward).toBeNull();
    expect(warn(base({ settings: { ...ON, fcw: false, headway: false }, forward: f })).forward).toBeNull();
    expect(warn(base({ settings: { ...ON, leadDeparture: false }, forward: { ...FWD_READY, leadDeparted: true } })).leadDeparted).toBe(false);
  });
});

describe('yol kamerası seçimi', () => {
  const HW: NativeCameraHardware = {
    usbVideo: [{ vendorId: 0x0c45, productId: 0x6366, name: 'USB 2.0 Camera', manufacturer: '' }],
    camera2: [{ id: '0', facing: 'back' }, { id: '1', facing: 'front' }, { id: '2', facing: 'external' }],
    externalCameraSupported: true,
  };
  const opt = (deviceId: string, label: string, hw: NativeCameraHardware | null = HW): AdasCameraOption =>
    ({ deviceId, label, kind: classifyCamera(label, hw) });

  it('S13. etiket + Camera2 yönü: Chromium "facing back" dese de harici kamera USB sayılır', () => {
    expect(classifyCamera('camera2 2, facing back', HW)).toBe('usb');
    expect(classifyCamera('camera2 2, facing back', null)).toBe('back');
    expect(classifyCamera('camera2 0, facing back', HW)).toBe('back');
    expect(classifyCamera('camera2 1, facing front', HW)).toBe('front');
    expect(classifyCamera('USB Camera (0c45:6366)', null)).toBe('usb');
    expect(classifyCamera('', null)).toBe('unknown');
  });

  it('S14. 🔒 otomatik seçim USB → arka → bilinmeyen; ÖN kamera asla', () => {
    const back = opt('b', 'camera2 0, facing back');
    const front = opt('f', 'camera2 1, facing front');
    const usb = opt('u', 'camera2 2, facing back');
    expect(pickAutoCamera([front, back, usb])?.deviceId).toBe('u');
    expect(pickAutoCamera([front, back])?.deviceId).toBe('b');
    expect(pickAutoCamera([front])).toBeNull();
    expect(pickAutoCamera([])).toBeNull();
  });

  it('S14b. 🔒 USB önce; sonra yola baktığı doğrulanan kamera (tür ne olursa); geri görüş asla', () => {
    const back = opt('b', 'camera2 0, facing back');
    const front = opt('f', 'camera2 1, facing front');     // ör. head unit AHD ön kamera girişi "front" bildiriyor
    const usb = opt('u', 'camera2 2, facing back');
    const fwd = { facing: 'forward' as const, atMs: 1 };
    const bwd = { facing: 'backward' as const, atMs: 1 };
    expect(pickAutoCamera([back, front], { 'label:camera2 1, facing front': fwd })?.deviceId).toBe('f');
    expect(pickAutoCamera([back, front, usb], { 'label:camera2 1, facing front': fwd })?.deviceId).toBe('u');
    expect(pickAutoCamera([back, front], { 'label:camera2 0, facing back': bwd })).toBeNull();
    expect(pickAutoCamera([back, usb], { 'label:camera2 2, facing back': bwd })?.deviceId).toBe('b');
  });

  it('S15. USB tanısı: takılı ama Android kamera olarak sunmuyor ayrımı', () => {
    const back = opt('b', 'camera2 0, facing back');
    expect(diagnoseUsb(HW, [back, opt('u', 'camera2 2, facing back')])).toBe('USB_READY');
    expect(diagnoseUsb({ ...HW, camera2: [{ id: '0', facing: 'back' }] }, [opt('b', 'camera2 0, facing back')])).toBe('USB_NOT_EXPOSED');
    expect(diagnoseUsb(null, [back])).toBe('NO_USB');
  });
});
