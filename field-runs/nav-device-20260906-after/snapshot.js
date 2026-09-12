(() => {
 const m = __MAP_STORE__.getState().mapInstance;
 const s = m.getStyle();
 const paint = (id, p) => { try { return m.getPaintProperty(id, p); } catch { return null; } };
 const intent = window.__navMapStore ? window.__navMapStore.getState() : null;
 return {
  uiDayNight: window.__navSettings ? __navSettings.getState().settings.dayNightMode : null,
  uiTheme: window.__navSettings ? __navSettings.getState().settings.theme : null,
  domDayNight: document.documentElement.getAttribute('data-day-night')
    || (document.querySelector('[data-day-night]') || {}).getAttribute?.('data-day-night') || null,
  style: s?.name, layers: s?.layers?.length, hasOmv: !!m.getSource('omv'),
  surface: m.getContainer().offsetHeight < 350 ? 'MINI' : 'FULL',
  bg: paint('background', 'background-color'),
  roadPrimary: paint('road-primary', 'line-color'),
  roadSecondary: paint('road-secondary', 'line-color'),
  water: paint('water-fill', 'fill-color'),
  zoom: +m.getZoom().toFixed(3), pitch: +m.getPitch().toFixed(2), bearing: +m.getBearing().toFixed(2),
  tileRenderIntent: intent ? intent.tileRender : null, mapMode: intent ? intent.mapMode : null,
  follow: window.__navFollow ? window.__navFollow() : null,
  counts: (() => { const c = {}; for (const e of (window.__NAV_AFTER__?.events || [])) c[e.op] = (c[e.op] || 0) + 1; return c; })(),
 };
})()
