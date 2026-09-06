(() => {
 const m = window.__MAP_STORE__ && __MAP_STORE__.getState().mapInstance;
 if (!m) return { hata: 'harita yok' };
 const s = m.getStyle();
 const ids = s.layers.map(l => l.id);
 const rota = ['car-route-shadow','car-route-glow','car-route-case','car-route','car-route-flow',
               'car-route-alt-fill'].filter(id => ids.includes(id));
 // Gerçek id'leri kaçırmamak için desenle de tara
 const desen = ids.filter(id => /route|rota/i.test(id));
 const oku = (id) => { const l = s.layers.find(x => x.id === id); if (!l) return null;
   const p = l.paint || {};
   return { sira: ids.indexOf(id), tip: l.type, renk: p['line-color'],
     gradyan: p['line-gradient'] ? JSON.stringify(p['line-gradient']).slice(0,140) : null,
     opaklik: p['line-opacity'], blur: p['line-blur'],
     genislik: JSON.stringify(p['line-width'] ?? null).slice(0,80),
     gorunur: (l.layout && l.layout.visibility) || 'visible' }; };
 const katmanlar = {};
 for (const id of desen) katmanlar[id] = oku(id);
 // Rota katmanlarının ÜSTÜNDE ne var?
 const enUstRota = Math.max(...desen.map(id => ids.indexOf(id)));
 const ustunde = ids.slice(enUstRota + 1);
 return {
   stil: s.name,
   toplamKatman: ids.length,
   bulunanRotaKatmanlari: desen,
   beklenenAmaYok: rota.length === 0 ? '(sabit id listesi eşleşmedi — desenle bulundu)' : null,
   katmanlar,
   rotaninUstundekiKatmanlar: ustunde,
   zemin: (() => { try { return m.getPaintProperty('background','background-color'); } catch { return null; } })(),
   perfLow: document.documentElement.classList.contains('perf-low'),
   htmlSinif: document.documentElement.className,
   mapMode: window.__navMapStore ? __navMapStore.getState().mapMode : null,
   tileRender: window.__navMapStore ? __navMapStore.getState().tileRender : null,
 };
})()
