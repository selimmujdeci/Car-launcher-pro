(async () => {
 if (window.__NAV_AFTER__) return 'already installed';
 const root = window.__MAP_STORE__.getState().mapInstance;
 if (!root) return 'no map instance';
 const trace = window.__NAV_AFTER__ = { events: [], stage: 'boot', dropped: 0 };
 const maps = new WeakMap(); let nextMap = 0;
 const push = e => { if (trace.events.length < 40000) trace.events.push(e); else trace.dropped++; };
 const paint = (m, id, prop) => { try { return m.getPaintProperty(id, prop); } catch { return null; } };
 const read = m => { try { return {
   style: m.getStyle()?.name,
   styleLoaded: m.isStyleLoaded(),
   zoom: +m.getZoom().toFixed(3), pitch: +m.getPitch().toFixed(2), bearing: +m.getBearing().toFixed(2),
   moving: m.isMoving(),
   surface: m.getContainer().offsetHeight < 350 ? 'MINI' : 'FULL',
   bg: paint(m, 'background', 'background-color'),
   road: paint(m, 'road-primary', 'line-color'),
   water: paint(m, 'water-fill', 'fill-color'),
 }; } catch { return {}; } };
 window.__navRead = read;

 const seen = m => {
  if (maps.has(m)) return maps.get(m);
  const id = ++nextMap; maps.set(m, id);
  m.on('style.load', () => push({ t: performance.now(), wall: Date.now(), stage: trace.stage, map: id, op: 'style.load', ...read(m) }));
  for (const type of ['dragstart','zoomstart','rotatestart','pitchstart','dragend','zoomend','rotateend','pitchend'])
   m.on(type, ev => push({ t: performance.now(), wall: Date.now(), stage: trace.stage, map: id, op: type,
     origin: ev && ev.originalEvent ? 'USER' : 'PROGRAMMATIC',
     originalEventType: ev && ev.originalEvent ? (ev.originalEvent.type || 'unknown') : null,
     follow: window.__navFollow ? window.__navFollow() : null }));
  return id;
 };

 for (const op of ['setStyle','setPaintProperty','setLayoutProperty','easeTo','jumpTo','flyTo','fitBounds']) {
  let p = root; while (p && !Object.hasOwn(p, op)) p = Object.getPrototypeOf(p);
  if (!p) continue;
  const orig = p[op];
  p[op] = function (...args) {
   const id = seen(this);
   const before = read(this);
   const isCam = /easeTo|jumpTo|flyTo|fitBounds/.test(op);
   const options = /To|Bounds/.test(op) ? { ...args[0], center: args[0] && args[0].center ? '(pt)' : undefined }
                 : op === 'setStyle' ? { name: args[0] && args[0].name } : args;
   const event = { t: performance.now(), wall: Date.now(), stage: trace.stage, map: id, op, before, args: options,
     followBefore: isCam && window.__navFollow ? window.__navFollow() : null,
     caller: new Error().stack ? new Error().stack.split('\n').slice(2, 7).join(' | ') : null };
   const result = orig.apply(this, args);
   if (isCam && window.__navFollow) event.followAfter = window.__navFollow();
   push(event);
   return result;
  };
 }
 seen(root);

 // ── tileRender NİYETİ (raster/vector mandalı) ────────────────────────────
 const res = performance.getEntriesByType('resource').map(r => r.name);
 const msUrl = res.find(n => /\/mapSourceManager-/.test(n));
 let intentHooked = false;
 if (msUrl) {
  const mod = await import(msUrl);
  for (const v of Object.values(mod)) {
   if (typeof v?.getState !== 'function') continue;
   if (!('tileRender' in v.getState())) continue;
   window.__navMapStore = v;
   v.subscribe((s, p) => { if (s.tileRender !== p.tileRender) push({ t: performance.now(), wall: Date.now(),
     stage: trace.stage, op: 'tileRender-intent', before: p.tileRender, after: s.tileRender,
     caller: new Error().stack ? new Error().stack.split('\n').slice(1, 7).join(' | ') : null }); });
   intentHooked = true;
  }
 }

 // ── kamera takip otoritesi anlık görüntüsü ───────────────────────────────
 let followHooked = false;
 const jsAll = res.filter(n => /\/assets\/.*\.js(\?|$)/.test(n) && !/vendor-/.test(n));
 const jsOrdered = [...jsAll.filter(n => /\/(main|index|cameraFollow|navigation)-/.test(n)),
                    ...jsAll.filter(n => !/\/(main|index|cameraFollow|navigation)-/.test(n))];
 for (const url of jsOrdered) {
  if (followHooked) break;
  let mod; try { mod = await import(url); } catch { continue; }
  for (const [k, v] of Object.entries(mod)) {
   if (typeof v !== 'function' || v.length !== 0) continue;
   let src; try { src = v.toString(); } catch { continue; }
   if (!/cameraMode/.test(src) || !/autoRecenterPending/.test(src)) continue;
   try { const snap = v(); if (!snap || typeof snap.cameraMode !== 'string') continue; } catch { continue; }
   window.__navFollowRaw = v; window.__navFollowKey = k;
   window.__navFollow = () => { try { const s = v(); return { cameraMode: s.cameraMode, centered: s.isVehicleCentered,
     autoRecenterPending: s.autoRecenterPending, autoDelayMs: s.autoRecenterDelayMs, reason: s.recenterReason,
     panAgeMs: s.lastUserPanAgeMs, followZoom: s.followZoom, listeners: s.listenerCount }; } catch { return null; } };
   followHooked = true; break;
  }
 }
 return { installed: true, intentHooked, followHooked, followKey: window.__navFollowKey || null, initial: read(root),
   follow: window.__navFollow ? window.__navFollow() : null };
})()
