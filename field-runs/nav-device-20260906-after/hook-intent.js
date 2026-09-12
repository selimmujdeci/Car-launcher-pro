(() => {
 if (window.__navIntentHooked) return 'already';
 const s = window.__navMapStore;
 if (!s) return { error: 'map store yok' };
 s.subscribe((n, p) => {
  if (n.tileRender !== p.tileRender) __NAV_AFTER__.events.push({ t: performance.now(), wall: Date.now(),
    stage: __NAV_AFTER__.stage, op: 'tileRender-intent', before: p.tileRender, after: n.tileRender,
    caller: new Error().stack ? new Error().stack.split('\n').slice(1, 7).join(' | ') : null });
  if (n.mapMode !== p.mapMode) __NAV_AFTER__.events.push({ t: performance.now(), stage: __NAV_AFTER__.stage,
    op: 'mapMode', before: p.mapMode, after: n.mapMode });
 });
 window.__navIntentHooked = true;
 return { hooked: true, state: { tileRender: s.getState().tileRender, mapMode: s.getState().mapMode } };
})()
