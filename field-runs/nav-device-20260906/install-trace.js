(() => {
 if(window.__NAV_CAMPAIGN__) return 'already installed';
 const root=__MAP_STORE__.getState().mapInstance;
 const trace=window.__NAV_CAMPAIGN__={events:[],stage:'mini-day-baseline',dropped:0};
 const maps=new WeakMap();let nextMap=0;
 const push=e=>{if(trace.events.length<40000)trace.events.push(e);else trace.dropped++;};
 const read=m=>{try {const s=m.getStyle();return {style:s?.name,styleLoaded:m.isStyleLoaded(),sourcesLoaded:m.areTilesLoaded(),zoom:m.getZoom(),pitch:m.getPitch(),bearing:m.getBearing(),moving:m.isMoving(),surface:m.getContainer().offsetHeight<350?'MINI':'FULL'};}catch{return {};}};
 for(const op of ['setStyle','setPaintProperty','setLayoutProperty','easeTo','jumpTo','flyTo','fitBounds']) {
  let p=root;while(p&&!Object.hasOwn(p,op))p=Object.getPrototypeOf(p);if(!p)continue;
  const orig=p[op];p[op]=function(...args){
   if(!maps.has(this)){maps.set(this,++nextMap);this.on('style.load',()=>push({t:performance.now(),wall:Date.now(),stage:trace.stage,map:maps.get(this),op:'style.load',...read(this)}));}
   const before=read(this);let old=null;if(op==='setPaintProperty')try{old=this.getPaintProperty(args[0],args[1]);}catch{}
   let field=null;if(/easeTo|jumpTo|flyTo|fitBounds/.test(op))try{const f=__CAROS_NAV_FIELD__.sample();field={nav:f.nav,fixAge:f.veh.fixAgeMs,speed:f.veh.speedKmh,maneuver:f.route.nextManeuverM,maneuverSource:f.route.distSource};}catch{}
   const options=/To|Bounds/.test(op)?{...args[0],center:undefined}:op==='setStyle'?{name:args[0]?.name}:args;
   const event={t:performance.now(),wall:Date.now(),stage:trace.stage,map:maps.get(this),op,before,old,args:options,field,caller:new Error().stack?.split('\n').slice(2,6).join('\n')};
   const result=orig.apply(this,args);push(event);return result;
  };
 }
 return {installed:true,initial:read(root)};
})()
