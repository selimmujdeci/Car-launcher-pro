/**
 * visionCoreLease.test.ts — AR ↔ ADAS kamera kiralama sözleşmesi.
 *
 *   · Varsayılan sahip 'ar': eski çağrılar (startVision(video) / stopVision()) aynı davranır.
 *   · İki sahip TEK getUserMedia paylaşır; donanım yalnız SON kira bırakılınca kapanır.
 *   · ADAS kendi gizli işleme öğesini kullanır → AR kapansa da akış sürer.
 *   · İzin beklenirken bırakılan akış sızmaz (açılır açılmaz kapatılır).
 *   · Kamera tercihi değişince akış kiralar korunarak yeniden açılır.
 *   · Seçili kamera yoksa başka kameraya SESSİZCE düşülmez.
 *   · Parça (track) bittiğinde tüm kiralar düşer, durum 'error'.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../core/runtime/AdaptiveRuntimeManager', () => ({
  runtimeManager: {
    getMode: vi.fn(() => 'BALANCED'),
    registerWorker: vi.fn(),
    unregisterWorker: vi.fn(),
    reportFailure: vi.fn(),
  },
}));
vi.mock('../platform/system/SystemBoot', () => ({ systemBoot: { restartService: vi.fn(async () => {}) } }));
vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

type Core = typeof import('../platform/vision/visionCore');
type Store = typeof import('../platform/visionStore');

interface FakeTrack { stop: ReturnType<typeof vi.fn>; applyConstraints: ReturnType<typeof vi.fn>; label: string; getSettings: () => { deviceId: string }; addEventListener: (ev: string, fn: () => void) => void; fire: () => void }

function fakeStream(deviceId = 'cam-back'): { stream: MediaStream; track: FakeTrack } {
  let ended: (() => void) | null = null;
  const track: FakeTrack = {
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => {}),
    label: deviceId,
    getSettings: () => ({ deviceId }),
    addEventListener: (ev, fn) => { if (ev === 'ended') ended = fn; },
    fire: () => ended?.(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

let core: Core;
let store: Store;
let gum: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  gum = vi.fn(async (c: MediaStreamConstraints) => {
    const v = c.video as MediaTrackConstraints;
    const id = typeof v.deviceId === 'object' && v.deviceId && 'exact' in v.deviceId ? String(v.deviceId.exact) : 'cam-back';
    return fakeStream(id).stream;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: gum, enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'cam-back', label: '' }]) },
  });
  core = await import('../platform/vision/visionCore');
  store = await import('../platform/visionStore');
});

afterEach(() => {
  core.disableVision();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const state = (): string => store.useVisionStore.getState().state;
const procEls = (): number => document.querySelectorAll('video[data-vision-proc]').length;

describe('visionCore kamera kiralama', () => {
  it('varsayılan AR sahibi: aç / kapat eski davranış', async () => {
    const video = document.createElement('video');
    await core.startVision(video);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(state()).toBe('active');
    expect(core.getVisionLeaseOwners()).toEqual(['ar']);
    expect(procEls()).toBe(0); // AR-yalnız: gizli öğe maliyeti yok
    const track = (await gum.mock.results[0].value as MediaStream).getVideoTracks()[0] as unknown as FakeTrack;
    core.stopVision();
    expect(track.stop).toHaveBeenCalled();
    expect(state()).toBe('idle');
  });

  it('AR + ADAS tek akışı paylaşır; AR bırakınca kamera ADAS için AÇIK kalır', async () => {
    await core.startVision(null, { owner: 'adas' });
    await core.startVision(document.createElement('video'));
    expect(gum).toHaveBeenCalledTimes(1);
    expect(procEls()).toBe(1);
    const track = (await gum.mock.results[0].value as MediaStream).getVideoTracks()[0] as unknown as FakeTrack;

    core.stopVision(); // AR görünmez oldu (realDriveFindings K kuralı)
    expect(track.stop).not.toHaveBeenCalled();
    expect(state()).toBe('active');
    expect(core.getVisionLeaseOwners()).toEqual(['adas']);

    core.stopVision('adas');
    expect(track.stop).toHaveBeenCalled();
    expect(state()).toBe('idle');
    expect(procEls()).toBe(0);
  });

  it('eşzamanlı açılış tek getUserMedia', async () => {
    await Promise.all([
      core.startVision(document.createElement('video')),
      core.startVision(null, { owner: 'adas' }),
    ]);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(state()).toBe('active');
  });

  it('izin beklenirken bırakılan akış sızmaz', async () => {
    let resolve!: (s: MediaStream) => void;
    const pending = fakeStream();
    gum.mockImplementationOnce(() => new Promise<MediaStream>((r) => { resolve = r; }));
    const p = core.startVision(null, { owner: 'adas' });
    expect(state()).toBe('requesting');
    core.stopVision('adas');
    resolve(pending.stream);
    await p;
    expect(pending.track.stop).toHaveBeenCalled();
    expect(state()).toBe('idle');
  });

  it('bırak → hemen yeniden kirala: iptal edilen açılış yerine yenisi açılır', async () => {
    let resolve!: (s: MediaStream) => void;
    gum.mockImplementationOnce(() => new Promise<MediaStream>((r) => { resolve = r; }));
    const p1 = core.startVision(null, { owner: 'adas' });
    core.stopVision('adas');
    const p2 = core.startVision(null, { owner: 'adas' });
    resolve(fakeStream().stream);
    await Promise.all([p1, p2]);
    expect(gum).toHaveBeenCalledTimes(2);
    expect(state()).toBe('active');
  });

  it('kamera tercihi değişince akış kiralar korunarak yeniden açılır', async () => {
    await core.startVision(null, { owner: 'adas' });
    await core.setVisionCameraPreference('usb-cam-1');
    expect(gum).toHaveBeenCalledTimes(2);
    const c = gum.mock.calls[1][0] as MediaStreamConstraints;
    expect((c.video as MediaTrackConstraints).deviceId).toEqual({ exact: 'usb-cam-1' });
    expect(core.getVisionLeaseOwners()).toEqual(['adas']);
    expect(core.getActiveVisionCamera().deviceId).toBe('usb-cam-1');
    expect(state()).toBe('active');
  });

  it('seçili kamera takılı değil → başka kameraya düşülmez, hata açık', async () => {
    await core.setVisionCameraPreference('usb-cam-missing');
    gum.mockImplementationOnce(async () => { const e = new Error('Requested device not found'); e.name = 'NotFoundError'; throw e; });
    await expect(core.startVision(null, { owner: 'adas' })).rejects.toThrow();
    expect(gum).toHaveBeenCalledTimes(1);
    expect(state()).toBe('error');
    expect(store.useVisionStore.getState().error).toBe('Seçili kamera bulunamadı');
    expect(core.getVisionLeaseOwners()).toEqual([]);
  });

  it('parça bitti (USB çekildi) → tüm kiralar düşer, durum error', async () => {
    await core.startVision(null, { owner: 'adas' });
    await core.startVision(document.createElement('video'));
    const track = (await gum.mock.results[0].value as MediaStream).getVideoTracks()[0] as unknown as FakeTrack;
    track.fire();
    expect(core.getVisionLeaseOwners()).toEqual([]);
    expect(state()).toBe('error');
    expect(procEls()).toBe(0);
  });

  it('ısı bütçesi: yalnız ADAS 640×360@15; AR katılınca 720p@30; AR ayrılınca geri', async () => {
    await core.startVision(null, { owner: 'adas' });
    const c = (gum.mock.calls[0][0] as MediaStreamConstraints).video as MediaTrackConstraints;
    expect(c.width).toEqual({ ideal: 640 });
    expect(c.frameRate).toEqual({ ideal: 15, max: 30 });
    const track = (await gum.mock.results[0].value as MediaStream).getVideoTracks()[0] as unknown as FakeTrack;
    await core.startVision(document.createElement('video'));
    expect(track.applyConstraints).toHaveBeenLastCalledWith(expect.objectContaining({ width: { ideal: 1280 } }));
    core.stopVision();
    expect(track.applyConstraints).toHaveBeenLastCalledWith(expect.objectContaining({ width: { ideal: 640 } }));
    expect(gum).toHaveBeenCalledTimes(1); // profil değişimi akışı yeniden AÇMAZ
  });

  it('akış açıkken yetenek kontrolü durumu idle\'a ÇEKMEZ', async () => {
    await core.startVision(null, { owner: 'adas' });
    expect(await core.checkVisionCapabilities()).toBe(true);
    expect(state()).toBe('active');
  });
});
