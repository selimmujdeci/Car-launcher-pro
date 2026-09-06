(async () => {
 const res = performance.getEntriesByType('resource').map(r => r.name);
 const out = { settings: false, system: false, mapStore: !!window.__navMapStore };
 const jsAll = res.filter(n => /\/assets\/.*\.js(\?|$)/.test(n) && !/vendor-/.test(n));
 const jsOrdered = [...jsAll.filter(n => /\/(main|index|useStore|mapSourceManager)-/.test(n)),
                    ...jsAll.filter(n => !/\/(main|index|useStore|mapSourceManager)-/.test(n))];
 for (const url of jsOrdered) {
  let mod; try { mod = await import(url); } catch { continue; }
  for (const v of Object.values(mod)) {
   if (typeof v?.getState !== 'function') continue;
   let st; try { st = v.getState(); } catch { continue; }
   if (st && st.settings && typeof st.updateSettings === 'function') { window.__navSettings = v; out.settings = true; }
   if (st && typeof st.setUserOverride === 'function') { window.__navSystem = v; out.system = true; }
   if (st && 'tileRender' in st) { window.__navMapStore = v; out.mapStore = true; }
  }
  if (out.settings && out.system && out.mapStore) break;
 }
 window.__navSetTheme = (target) => {
  __navSettings.getState().updateSettings({ dayNightMode: target, theme: target === 'day' ? 'light' : 'dark' });
  if (window.__navSystem) __navSystem.getState().setUserOverride(120000);
  return target;
 };
 return { ...out, dayNightMode: window.__navSettings ? __navSettings.getState().settings.dayNightMode : null };
})()
