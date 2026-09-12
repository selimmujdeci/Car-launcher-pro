import { describe, it, expect, vi, afterEach } from 'vitest';
import { Evented, type Map as MapLibreMap } from 'maplibre-gl';
import { bindMapUserInteraction } from '../platform/map/bindMapUserInteraction';
import { buildVectorLayers, vectorStyleName, DAY_PALETTE, NIGHT_PALETTE } from '../platform/mapStyleBuilders';
import { applyMapDayNight, updateMapMood } from '../platform/map/MapLayerManager';
import { setMapNight } from '../platform/mapSourceManager';
import { beginRecenter, completeRecenter, getCameraFollowSnapshot, notifyUserPanStart, notifyUserPanEnd, _resetCameraFollowForTest } from '../platform/navigation/cameraFollowAuthority';

function surface(night: boolean) {
  let layers = buildVectorLayers(night);
  const map = {
    // Ad, canlı palet yolunun da yazması gereken TEŞHİS alanıdır (#482).
    style: { stylesheet: { name: vectorStyleName(night) } },
    getLayer: (id: string) => layers.find(l => l.id === id),
    getSource: (id: string) => id === 'omv' ? {} : undefined,
    isStyleLoaded: () => true,
    setPaintProperty: vi.fn((id: string, key: string, value: unknown) => {
      const layer = layers.find(l => l.id === id)!;
      (layer.paint as Record<string, unknown>)[key] = value;
    }),
    setLayoutProperty: vi.fn((id: string, key: string, value: unknown) => {
      const layer = layers.find(l => l.id === id)!;
      (layer.layout as Record<string, unknown>)[key] = value;
    }),
  };
  return { map: map as unknown as MapLibreMap, layers: () => layers, styleName: () => map.style.stylesheet.name,
    reload: (n: boolean) => { layers = buildVectorLayers(n); map.style.stylesheet.name = vectorStyleName(n); } };
}
function color(s: ReturnType<typeof surface>, id: string, prop: string) {
  return (s.layers().find(l => l.id === id)?.paint as Record<string, unknown>)[prop];
}
function rgb(hex: string) { return `rgb(${[1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(',')})`; }

afterEach(() => { _resetCameraFollowForTest(); vi.useRealTimers(); setMapNight(false); });

describe('Cihaz 2026-09-06: tema yaşam döngüsü', () => {
  it('MINI ve FULL aynı canlı DAY/NIGHT paletine döner; kaynak ve kamera komutu gerekmez', () => {
    const mini = surface(false), full = surface(true);
    for (const night of [true, false, true, false]) {
      for (const s of [mini, full]) applyMapDayNight(night, s.map);
      expect(mini.layers()).toEqual(full.layers());
      const palette = night ? NIGHT_PALETTE : DAY_PALETTE;
      expect(color(mini, 'road-primary', 'line-color')).toBe(rgb(palette.primary));
      expect(color(mini, 'water-fill', 'fill-color')).toBe(palette.water);
    }
  });
  it('canlı palet stil ADINI da günceller — teşhis sözleşmesi bayat kalmaz', () => {
    const s = surface(true);
    expect(s.styleName()).toBe('Vector (Automotive Night)');
    applyMapDayNight(false, s.map);
    expect(s.styleName(), 'boya GÜNDÜZ ama ad GECE kaldı — saha teşhisi yanıltacak')
      .toBe('Vector (Automotive Day)');
    applyMapDayNight(true, s.map);
    expect(s.styleName()).toBe('Vector (Automotive Night)');
  });
  it('yeniden yüklenen eski stil kanonik gündüze döner', () => {
    const s = surface(true);
    applyMapDayNight(false, s.map);
    const expected = structuredClone(s.layers());
    s.reload(true);
    applyMapDayNight(false, s.map);
    expect(s.layers()).toEqual(expected);
  });
  it('mood dedup ikinci yüzeyi veya yeniden yüklenen katmanı atlamaz', () => {
    setMapNight(false);
    const a=surface(false), b=surface(false);
    updateMapMood(a.map, 0.8); updateMapMood(b.map, 0.8);
    expect(color(a,'road-primary','line-color')).toEqual(color(b,'road-primary','line-color'));
    const expected=color(a,'road-primary','line-color');
    a.reload(false); updateMapMood(a.map,0.8);
    expect(color(a,'road-primary','line-color')).toEqual(expected);
  });
});

describe('Cihaz 2026-09-06: kamera olayının kaynağı', () => {
  it('programatik zoom/rotate/pitch takip durumunu ve auto resume zamanlayıcısını değiştirmez', () => {
    _resetCameraFollowForTest();
    const events = new Evented();
    const release=bindMapUserInteraction(events as unknown as MapLibreMap, notifyUserPanStart, () => notifyUserPanEnd(vi.fn()));
    beginRecenter('USER_BUTTON');
    for (const type of ['zoomstart','rotatestart','pitchstart','zoomend','rotateend','pitchend']) events.fire(type);
    expect(getCameraFollowSnapshot().cameraMode).toBe('RECENTERING');
    completeRecenter();
    expect(getCameraFollowSnapshot().autoRecenterPending).toBe(false);
    release();
  });
  it('gerçek pan ve zoom düğmesi askıya alır; mevcut auto resume ve cleanup korunur', () => {
    vi.useFakeTimers(); _resetCameraFollowForTest();
    const events=new Evented(); const recenter=vi.fn();
    const release=bindMapUserInteraction(events as unknown as MapLibreMap, notifyUserPanStart, () => notifyUserPanEnd(recenter));
    for (const prefix of ['drag','zoom','rotate','pitch']) {
      events.fire(`${prefix}start`,{originalEvent:{type:'touchstart'}});
      expect(getCameraFollowSnapshot().cameraMode).toBe('USER_PANNING');
      events.fire(`${prefix}end`,{originalEvent:{type:'touchend'}});
      expect(getCameraFollowSnapshot().cameraMode).toBe('FOLLOW_SUSPENDED');
    }
    vi.advanceTimersByTime(getCameraFollowSnapshot().autoRecenterDelayMs);
    expect(recenter).toHaveBeenCalledTimes(1);
    expect(getCameraFollowSnapshot().cameraMode).toBe('FOLLOWING');
    release();events.fire('dragstart',{originalEvent:{}});
    expect(getCameraFollowSnapshot().cameraMode).toBe('FOLLOWING');
  });
});

